import type { AppName } from "./types";

export interface RewriteCtx {
  ref: string;
  app: AppName;
  canonicalHost: string;
  studioOrigin: string;
  wranglerOrigin: string;
  wranglerPrefix: string;
}

function originOf(raw: string): string {
  return raw.replace(/\/+$/, "");
}

export function prefixList(ctx: RewriteCtx): string[] {
  const studio = originOf(ctx.studioOrigin);
  const wrangler = originOf(ctx.wranglerOrigin);
  const prefix = ctx.wranglerPrefix.startsWith("/") ? ctx.wranglerPrefix : `/${ctx.wranglerPrefix}`;
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return [
    `${studio}/${ctx.ref}`,
    `${wrangler}${normalizedPrefix}${ctx.ref}`,
    `${normalizedPrefix}${ctx.ref}`,
    `/${ctx.ref}`,
  ];
}

function stripPrefix(value: string, prefix: string): string | null {
  if (value === prefix) return "/";
  if (value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}?`) || value.startsWith(`${prefix}#`)) {
    const rest = value.slice(prefix.length);
    return rest.startsWith("/") || rest.startsWith("?") || rest.startsWith("#") ? rest : `/${rest}`;
  }
  return null;
}

/** Rewrite an absolute upstream URL or a slug-prefixed root-relative URL. Leave everything else. */
export function rewriteAssetUrl(value: string, ctx: RewriteCtx): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("data:") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("javascript:") ||
    lower.startsWith("blob:") ||
    trimmed.startsWith("#")
  ) {
    return value;
  }
  for (const prefix of prefixList(ctx)) {
    const rest = stripPrefix(trimmed, prefix);
    if (rest === null) continue;
    const path = rest.startsWith("/") ? rest : `/${rest}`;
    return `https://${ctx.canonicalHost}${path}`;
  }
  return value;
}

export function rewriteSrcset(value: string, ctx: RewriteCtx): string {
  return value
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return part;
      const bits = trimmed.split(/\s+/);
      bits[0] = rewriteAssetUrl(bits[0], ctx);
      return bits.join(" ");
    })
    .join(", ");
}

export function rewriteLocation(location: string, ctx: RewriteCtx, requestUrl: URL): string {
  if (location.startsWith("/") && !location.startsWith("//")) {
    const rewritten = rewriteAssetUrl(location, ctx);
    return rewritten === location ? location : rewritten;
  }
  const rewritten = rewriteAssetUrl(location, ctx);
  if (rewritten !== location) return rewritten;
  try {
    const loc = new URL(location, requestUrl);
    const rewrittenAbs = rewriteAssetUrl(loc.href, ctx);
    if (rewrittenAbs !== loc.href) return rewrittenAbs;
  } catch {
    return location;
  }
  return location;
}

export function platformReplacements(ctx: RewriteCtx): { from: string; to: string }[] {
  const studio = originOf(ctx.studioOrigin);
  const wrangler = originOf(ctx.wranglerOrigin);
  const prefix = ctx.wranglerPrefix.startsWith("/") ? ctx.wranglerPrefix : `/${ctx.wranglerPrefix}`;
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const to = `https://${ctx.canonicalHost}/`;
  const studioHost = studio.replace(/^https?:\/\//, "");
  const wranglerHost = wrangler.replace(/^https?:\/\//, "");
  return [
    { from: `${studio}/${ctx.ref}/`, to },
    { from: `${wrangler}${normalizedPrefix}${ctx.ref}/`, to },
    // llms.txt emits the publish host with no scheme: "sites.registermysite.com/<ref>"
    { from: `${studioHost}/${ctx.ref}`, to: ctx.canonicalHost },
    { from: `${wranglerHost}${normalizedPrefix}${ctx.ref}`, to: ctx.canonicalHost },
  ];
}

/** Replace platform publish prefixes in a text body. Full matches only. */
export function rewriteText(body: string, ctx: RewriteCtx): string {
  let out = body;
  for (const { from, to } of platformReplacements(ctx)) {
    if (!from || from === to) continue;
    out = out.split(from).join(to);
  }
  return out;
}

export function rewriteTextStream(body: ReadableStream<Uint8Array> | null, ctx: RewriteCtx): ReadableStream<Uint8Array> | null {
  if (!body) return body;
  const needles = platformReplacements(ctx);
  const keep = Math.max(1, ...needles.map((item) => item.from.length)) - 1;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let carry = "";
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        carry += decoder.decode(chunk, { stream: true });
        const rewritten = rewriteText(carry, ctx);
        if (rewritten.length <= keep) {
          carry = rewritten;
          return;
        }
        controller.enqueue(encoder.encode(rewritten.slice(0, rewritten.length - keep)));
        carry = rewritten.slice(rewritten.length - keep);
      },
      flush(controller) {
        carry += decoder.decode();
        if (carry) controller.enqueue(encoder.encode(rewriteText(carry, ctx)));
      },
    }),
  );
}

/** Canonical link is the canonical host plus the path. No query, no index.html, no double slash. */
export function canonicalUrl(host: string, path: string, _search = ""): string {
  let clean = path || "/";
  clean = clean.replace(/\/{2,}/g, "/");
  if (!clean.startsWith("/")) clean = `/${clean}`;
  clean = clean.replace(/\/index\.html$/i, "/");
  if (!clean) clean = "/";
  return `https://${host}${clean}`;
}
