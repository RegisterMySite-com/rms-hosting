import { parseMapping, kvKey } from "./contract";
import { rewriteHtml } from "./html";
import {
  apexOf,
  devOverrideHost,
  isPlatformHost,
  normalizeHost,
  platformHostSet,
  wwwOf,
} from "./host";
import { badRequest, domainNotSetup, methodNotAllowed, pageNotFound, pausedPage, unavailablePage } from "./pages";
import { safePath } from "./path";
import { rewriteLocation, rewriteTextStream, type RewriteCtx } from "./rewrite";
import { VERSION, type DomainMapping, type Env } from "./types";
import {
  buildUpstreamUrl,
  cacheKeyUrl,
  cssContentType,
  edgeTtl,
  htmlContentType,
  shouldRetryPretty,
  textContentType,
  upstreamHeaders,
} from "./upstream";

const KV_CACHE_TTL = 45;
const UPSTREAM_TIMEOUT_MS = 10_000;

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handle(request, env, ctx);
  },
};

export async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const started = Date.now();
  const url = new URL(request.url);
  const landed = normalizeHost(url.hostname);
  const override = devOverrideHost(request, url, landed, env.DEV_HOST_OVERRIDE);
  const host = override || landed;
  const platform = platformHostSet(env.PLATFORM_HOSTS);
  const pathOnly = url.pathname;

  if (pathOnly === "/__rms/health" || pathOnly === "/__rms/whoami") {
    const response = await internal(request, env, host, pathOnly);
    log(host, pathOnly, null, null, response.status, null, "BYPASS", started);
    return response;
  }

  if (isPlatformHost(landed, platform) && !override) {
    const response = new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
    log(landed, pathOnly, null, null, 404, null, "BYPASS", started);
    return response;
  }

  if (url.protocol === "http:") {
    return redirect(httpsUrl(host, url), 301);
  }

  const lookup = await resolveMapping(env, host);
  if (!lookup) {
    const response = domainNotSetup(host);
    log(host, pathOnly, null, null, 404, null, "BYPASS", started);
    return response;
  }
  if (lookup.redirectTo) {
    const response = redirect(`https://${lookup.redirectTo}${url.pathname}${url.search}`, 301);
    log(host, pathOnly, lookup.mapping.site_id, lookup.mapping.app, 301, null, "BYPASS", started);
    return response;
  }
  const mapping = lookup.mapping;
  if (mapping.status === "paused") {
    const response = pausedPage(host);
    response.headers.set("x-rms-host", mapping.site_id);
    log(host, pathOnly, mapping.site_id, mapping.app, 503, null, "BYPASS", started);
    return response;
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { allow: "GET, HEAD", "cache-control": "no-store" } });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    const response = methodNotAllowed();
    log(host, pathOnly, mapping.site_id, mapping.app, 405, null, "BYPASS", started);
    return response;
  }

  const parsed = safePath(url.pathname);
  if (!parsed.ok) {
    const response = badRequest("Bad path");
    log(host, pathOnly, mapping.site_id, mapping.app, 400, null, "BYPASS", started);
    return response;
  }

  const canon = apexOf(host);
  const rewriteCtx: RewriteCtx = {
    ref: mapping.ref,
    app: mapping.app,
    canonicalHost: canon,
    studioOrigin: env.HTML_STUDIO_ORIGIN,
    wranglerOrigin: env.WRANGLER_ORIGIN,
    wranglerPrefix: env.WRANGLER_PREFIX,
  };

  if (request.method === "GET") {
    const cached = await readCache(host, parsed.path, url.search, mapping.version);
    if (cached) {
      const hit = withProxyHeaders(cached, mapping.site_id, "HIT");
      log(host, parsed.path, mapping.site_id, mapping.app, hit.status, null, "HIT", started);
      return hit;
    }
  }

  let upstream;
  try {
    upstream = await fetchUpstream(request, env, mapping, host, parsed.path, url.search, false);
  } catch (error) {
    console.log(JSON.stringify({ level: "error", host, path: parsed.path, site_id: mapping.site_id, error: String(error) }));
    const response = unavailablePage(host);
    response.headers.set("x-rms-host", mapping.site_id);
    log(host, parsed.path, mapping.site_id, mapping.app, 502, 0, "BYPASS", started);
    return response;
  }

  const pretty = shouldRetryPretty(parsed.path, upstream.response.status, false);
  if (pretty) {
    upstream.response.body?.cancel();
    try {
      upstream = await fetchUpstream(request, env, mapping, host, pretty, url.search, true);
    } catch {
      const response = unavailablePage(host);
      response.headers.set("x-rms-host", mapping.site_id);
      log(host, parsed.path, mapping.site_id, mapping.app, 502, upstream.status, "BYPASS", started);
      return response;
    }
  }

  if (upstream.status === 0 || upstream.status >= 500) {
    console.log(JSON.stringify({
      level: "error",
      host,
      site_id: mapping.site_id,
      upstream_status: upstream.status,
      ms: upstream.ms,
    }));
    upstream.response.body?.cancel();
    const response = unavailablePage(host);
    response.headers.set("x-rms-host", mapping.site_id);
    log(host, parsed.path, mapping.site_id, mapping.app, 502, upstream.status, "BYPASS", started);
    return response;
  }

  let response = sanitize(upstream.response, rewriteCtx, url);
  const type = response.headers.get("content-type");
  const live = mapping.status === "live";
  if (htmlContentType(type) && request.method === "GET") {
    response = rewriteHtml(response, rewriteCtx, parsed.path, "", live);
  } else if (textContentType(type) && request.method === "GET") {
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    response = new Response(rewriteTextStream(response.body, rewriteCtx), { status: response.status, statusText: response.statusText, headers });
  } else if (cssContentType(type)) {
    // Inspection (2026-10-06): HTML Studio exports inline their CSS and use
    // absolute third-party URLs. Wrangler rewrites HTML href/src and injects
    // <base>, but does not prefix url() in CSS. CSS is passed through.
  }
  if (upstream.status === 404 && !htmlContentType(type)) {
    response.body?.cancel();
    const missing = pageNotFound(host);
    missing.headers.set("x-rms-host", mapping.site_id);
    log(host, parsed.path, mapping.site_id, mapping.app, 404, upstream.status, "BYPASS", started);
    return missing;
  }

  const cacheState = await maybeCache(ctx, request, response, host, parsed.path, url.search, mapping.version, env);
  response = withProxyHeaders(response, mapping.site_id, cacheState);
  log(host, parsed.path, mapping.site_id, mapping.app, response.status, upstream.status, cacheState, started);
  count(ctx, env, host, mapping, parsed.path, response.status, started);
  return response;
}

async function internal(request: Request, env: Env, host: string, path: string): Promise<Response> {
  const headers = {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-rms-version": VERSION,
  };
  const lookup = await resolveMapping(env, host);
  const mapping = lookup?.mapping || null;
  const canonical = mapping ? apexOf(host) : null;
  if (path === "/__rms/health") {
    return Response.json(
      {
        mapped: !!mapping,
        status: mapping?.status ?? null,
        app: mapping?.app ?? null,
        ref: mapping?.ref ?? null,
        version: VERSION,
        canonical,
      },
      { headers },
    );
  }
  if (!mapping) return Response.json({ error: "not_mapped", version: VERSION }, { status: 404, headers });
  return Response.json(
    { site_id: mapping.site_id, app: mapping.app, ref: mapping.ref, canonical, version: VERSION },
    { headers: { ...headers, "x-rms-host": mapping.site_id } },
  );
}

async function readMapping(env: Env, host: string): Promise<DomainMapping | null> {
  const raw = await env.DOMAIN_MAP.get(kvKey(host), { cacheTtl: KV_CACHE_TTL });
  const parsed = parseMapping(raw);
  if (!parsed.ok) {
    if (raw) console.log(JSON.stringify({ level: "error", host, reason: parsed.reason }));
    return null;
  }
  return parsed.mapping;
}

async function resolveMapping(env: Env, host: string): Promise<{ mapping: DomainMapping; redirectTo?: string } | null> {
  const direct = await readMapping(env, host);
  const sibling = host.startsWith("www.") ? apexOf(host) : wwwOf(host);
  const mapping = direct || (await readMapping(env, sibling));
  if (!mapping) return null;
  // The bare domain is the canonical host. A www KV row with canonical "www"
  // is the www record, not a preference, so it still redirects.
  if (host.startsWith("www.")) return { mapping, redirectTo: apexOf(host) };
  return { mapping };
}

async function fetchUpstream(
  request: Request,
  env: Env,
  mapping: DomainMapping,
  host: string,
  path: string,
  search: string,
  _retried: boolean,
): Promise<{ response: Response; status: number; ms: number; via: "binding" | "fetch" }> {
  const target = buildUpstreamUrl(mapping.app, mapping.ref, path, search, env);
  const headers = upstreamHeaders(request, host, mapping.site_id);
  const init: RequestInit = { method: request.method, headers, redirect: "manual" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const started = Date.now();
  try {
    const binding = mapping.app === "html_studio" ? env.HTML_STUDIO : env.WRANGLER;
    let response: Response;
    let via: "binding" | "fetch";
    if (binding) {
      response = await binding.fetch(target.url, { ...init, signal: controller.signal });
      via = "binding";
    } else {
      console.log(JSON.stringify({ level: "warn", message: "service_binding_missing", binding: target.binding, host }));
      response = await fetch(target.url, { ...init, signal: controller.signal });
      via = "fetch";
    }
    return { response, status: response.status, ms: Date.now() - started, via };
  } finally {
    clearTimeout(timer);
  }
}

function sanitize(response: Response, ctx: RewriteCtx, requestUrl: URL): Response {
  const headers = new Headers(response.headers);
  for (const key of [...headers.keys()]) {
    if (
      key === "set-cookie" ||
      key === "set-cookie2" ||
      key === "x-frame-options" ||
      key === "content-security-policy" ||
      key === "content-security-policy-report-only"
    ) {
      headers.delete(key);
    }
  }
  const location = headers.get("location");
  if (location) headers.set("location", rewriteLocation(location, ctx, requestUrl));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function withProxyHeaders(response: Response, siteId: string, cache: "HIT" | "MISS" | "BYPASS"): Response {
  const headers = new Headers(response.headers);
  headers.set("x-rms-host", siteId);
  headers.set("x-rms-cache", cache);
  headers.set("x-rms-version", VERSION);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "SAMEORIGIN");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("strict-transport-security", "max-age=31536000");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function readCache(host: string, path: string, search: string, version: number): Promise<Response | null> {
  try {
    const key = new Request(cacheKeyUrl(host, path, search, version));
    return (await caches.default.match(key)) || null;
  } catch {
    return null;
  }
}

async function maybeCache(
  ctx: ExecutionContext,
  request: Request,
  response: Response,
  host: string,
  path: string,
  search: string,
  version: number,
  env: Env,
): Promise<"MISS" | "BYPASS"> {
  if (request.method !== "GET") return "BYPASS";
  if (![200, 301, 404].includes(response.status)) return "BYPASS";
  const cap = Number(env.EDGE_CACHE_TTL || "60") || 60;
  const ttl = edgeTtl(response.headers.get("cache-control"), cap);
  if (ttl === null || ttl <= 0) return "BYPASS";
  try {
    const key = new Request(cacheKeyUrl(host, path, search, version));
    const storedHeaders = new Headers(response.headers);
    storedHeaders.delete("set-cookie");
    storedHeaders.set("cache-control", `public, max-age=${ttl}`);
    const stored = new Response(response.clone().body, { status: response.status, headers: storedHeaders });
    ctx.waitUntil(caches.default.put(key, stored));
    return "MISS";
  } catch {
    return "BYPASS";
  }
}

function redirect(location: string, status: number): Response {
  return new Response(null, {
    status,
    headers: { location, "cache-control": "no-store" },
  });
}

function httpsUrl(host: string, url: URL): string {
  return `https://${host}${url.pathname}${url.search}`;
}

function log(
  host: string,
  path: string,
  siteId: string | null,
  app: string | null,
  status: number,
  upstreamStatus: number | null,
  cache: string,
  started: number,
) {
  console.log(JSON.stringify({
    host,
    path,
    site_id: siteId,
    app,
    status,
    upstream_status: upstreamStatus,
    cache,
    ms: Date.now() - started,
  }));
}

function count(ctx: ExecutionContext, env: Env, host: string, mapping: DomainMapping, path: string, status: number, started: number) {
  if (!env.HOSTING_ANALYTICS) return;
  try {
    ctx.waitUntil(Promise.resolve(env.HOSTING_ANALYTICS.writeDataPoint({
      indexes: [host],
      blobs: [mapping.app, mapping.site_id, path.slice(0, 256)],
      doubles: [status, Date.now() - started],
    })));
  } catch {
    // Analytics is optional.
  }
}
