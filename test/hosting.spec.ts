import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";
import { parseMapping, kvKey } from "../src/contract";
import { normalizeHost } from "../src/host";
import { handle } from "../src/index";
import { safePath } from "../src/path";
import { rewriteAssetUrl, rewriteSrcset, canonicalUrl, type RewriteCtx } from "../src/rewrite";
import type { Env } from "../src/types";
import { VERSION } from "../src/types";
import { buildUpstreamUrl, cacheKeyUrl } from "../src/upstream";

const SITE = "d9d3a4b2-1111-2222-3333-444444444444";

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DOMAIN_MAP: env.DOMAIN_MAP,
    HTML_STUDIO_ORIGIN: "https://sites.registermysite.com",
    WRANGLER_ORIGIN: "https://wrangler.registermysite.com",
    WRANGLER_PREFIX: "/s/",
    PLATFORM_HOSTS: "registermysite.com,www.registermysite.com,sites.registermysite.com,wrangler.registermysite.com,html-studio.registermysite.com,account.registermysite.com",
    EDGE_CACHE_TTL: "60",
    DEV_HOST_OVERRIDE: "true",
    ...overrides,
  };
}

function studio(body: string, init: ResponseInit = {}): Fetcher {
  return {
    fetch: async () =>
      new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "sf_sid=ses_secret; Path=/; HttpOnly",
          "x-frame-options": "DENY",
          "cache-control": "public, max-age=120",
          ...(init.headers || {}),
        },
        ...init,
        headers: undefined,
      }),
  } as Fetcher;
}

function studioFetch(handler: (req: Request) => Response | Promise<Response>): Fetcher {
  return { fetch: handler } as Fetcher;
}

async function putMap(host: string, value: unknown) {
  await env.DOMAIN_MAP.put(kvKey(host), JSON.stringify(value));
}

const live = {
  site_id: SITE,
  app: "html_studio",
  ref: "nightshade",
  canonical: "apex",
  status: "live",
  version: 3,
  updated_at: "2026-10-06T18:00:00Z",
};

function req(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

describe("host and path", () => {
  it("normalizes uppercase hosts and trailing dots", () => {
    expect(normalizeHost("Example.COM.")).toBe("example.com");
    expect(normalizeHost("WWW.Example.com:443")).toBe("www.example.com");
  });

  it("rejects traversal, encoded dots, and double encoding", () => {
    expect(safePath("/../etc").ok).toBe(false);
    expect(safePath("/%2e%2e/etc").ok).toBe(false);
    expect(safePath("/%252e%252e/etc").ok).toBe(false);
    expect(safePath("/..%2f..%2fetc").ok).toBe(false);
    expect(safePath("/about").ok).toBe(true);
    expect(safePath("/about/")).toEqual({ ok: true, path: "/about/" });
    expect(safePath("/")).toEqual({ ok: true, path: "/" });
  });

  it("builds upstream urls for both apps", () => {
    const e = baseEnv();
    expect(buildUpstreamUrl("html_studio", "nightshade", "/about", "?x=1", e).url).toBe(
      "https://sites.registermysite.com/nightshade/about?x=1",
    );
    expect(buildUpstreamUrl("wrangler", "nightshade", "/", "", e).url).toBe(
      "https://wrangler.registermysite.com/s/nightshade/",
    );
  });

  it("versions the cache key", () => {
    expect(cacheKeyUrl("example.com", "/a", "?q=1", 3)).toBe("https://example.com/a?q=1&__v=3");
    expect(cacheKeyUrl("example.com", "/", "", 4)).toBe("https://example.com/?__v=4");
  });
});

describe("contract", () => {
  it("rejects malformed json and unknown apps", () => {
    expect(parseMapping("{").ok).toBe(false);
    expect(parseMapping(JSON.stringify({ app: "other", ref: "a", site_id: "b" })).ok).toBe(false);
  });

  it("defaults the fields the account worker may omit", () => {
    const parsed = parseMapping(JSON.stringify({ app: "wrangler", ref: "demo", site_id: SITE }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.mapping.canonical).toBe("apex");
      expect(parsed.mapping.status).toBe("live");
      expect(parsed.mapping.version).toBe(1);
    }
  });
});

describe("rewrite", () => {
  const ctx: RewriteCtx = {
    ref: "nightshade",
    app: "html_studio",
    canonicalHost: "example.com",
    studioOrigin: "https://sites.registermysite.com",
    wranglerOrigin: "https://wrangler.registermysite.com",
    wranglerPrefix: "/s/",
  };

  it("rewrites prefixed absolute and root-relative urls and leaves others", () => {
    expect(rewriteAssetUrl("https://sites.registermysite.com/nightshade/app.css", ctx)).toBe("https://example.com/app.css");
    expect(rewriteAssetUrl("/s/nightshade/app.css", ctx)).toBe("https://example.com/app.css");
    expect(rewriteAssetUrl("/nightshade/app.css", ctx)).toBe("https://example.com/app.css");
    expect(rewriteAssetUrl("styles.css", ctx)).toBe("styles.css");
    expect(rewriteAssetUrl("https://images.unsplash.com/photo.jpg", ctx)).toBe("https://images.unsplash.com/photo.jpg");
    expect(rewriteSrcset("/nightshade/a.jpg 1x, https://cdn.example/b.jpg 2x", ctx)).toBe(
      "https://example.com/a.jpg 1x, https://cdn.example/b.jpg 2x",
    );
    expect(canonicalUrl("example.com", "/about/index.html", "?x=1")).toBe("https://example.com/about/");
    expect(canonicalUrl("example.com", "//", "")).toBe("https://example.com/");
  });
});

describe("handler", () => {
  beforeEach(async () => {
    const listed = await env.DOMAIN_MAP.list();
    await Promise.all(listed.keys.map((key) => env.DOMAIN_MAP.delete(key.name)));
  });

  it("answers health and hides platform hosts", async () => {
    const health = await handle(req("https://rms-hosting.example.workers.dev/__rms/health"), baseEnv(), createExecutionContext());
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ mapped: false, version: VERSION, canonical: null });
    const blocked = await handle(req("https://sites.registermysite.com/"), baseEnv(), createExecutionContext());
    expect(blocked.status).toBe(404);
  });

  it("redirects www to apex, apex to www, and http to https", async () => {
    await putMap("example.com", live);
    await putMap("www.other.com", { ...live, canonical: "www" });
    const www = await handle(req("https://www.example.com/about?x=1"), baseEnv(), createExecutionContext());
    expect(www.status).toBe(301);
    expect(www.headers.get("location")).toBe("https://example.com/about?x=1");
    const apex = await handle(req("https://other.com/"), baseEnv(), createExecutionContext());
    expect(apex.status).toBe(301);
    expect(apex.headers.get("location")).toBe("https://www.other.com/");
    const http = await handle(req("http://example.com/about"), baseEnv(), createExecutionContext());
    expect(http.status).toBe(301);
    expect(http.headers.get("location")).toBe("https://example.com/about");
  });

  it("301s www to apex when both keys exist and canonical is omitted", async () => {
    const minimal = { app: "html_studio", ref: "rms-pubtest", site_id: SITE };
    await putMap("rmsflowtest1006.site", minimal);
    await putMap("www.rmsflowtest1006.site", minimal);
    const www = await handle(req("https://www.rmsflowtest1006.site/"), baseEnv(), createExecutionContext());
    expect(www.status).toBe(301);
    expect(www.headers.get("location")).toBe("https://rmsflowtest1006.site/");
    const who = await handle(req("https://www.rmsflowtest1006.site/__rms/whoami"), baseEnv(), createExecutionContext());
    expect(who.status).toBe(200);
    expect(await who.json()).toMatchObject({ canonical: "rmsflowtest1006.site", app: "html_studio", ref: "rms-pubtest", version: VERSION });
    const health = await handle(req("https://rmsflowtest1006.site/__rms/health"), baseEnv(), createExecutionContext());
    expect(await health.json()).toEqual({
      mapped: true,
      status: "live",
      app: "html_studio",
      ref: "rms-pubtest",
      version: VERSION,
      canonical: "rmsflowtest1006.site",
    });
  });

  it("blocks methods other than GET and HEAD", async () => {
    await putMap("example.com", live);
    const post = await handle(req("https://example.com/", { method: "POST" }), baseEnv(), createExecutionContext());
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
    const opt = await handle(req("https://example.com/", { method: "OPTIONS" }), baseEnv(), createExecutionContext());
    expect(opt.status).toBe(204);
  });

  it("returns 400 for traversal", async () => {
    await putMap("example.com", live);
    const res = await handle(req("https://example.com/..%2f..%2fetc"), baseEnv(), createExecutionContext());
    expect(res.status).toBe(400);
  });

  it("strips set-cookie, rewrites location and html, and sets the site id", async () => {
    await putMap("example.com", live);
    const html = `<!doctype html><html><head>
      <base href="/s/nightshade/">
      <meta property="og:url" content="https://sites.registermysite.com/nightshade/">
      <meta name="robots" content="noindex">
      </head><body>
      <a href="/nightshade/about">about</a>
      <img src="https://sites.registermysite.com/nightshade/a.jpg" srcset="/nightshade/a.jpg 1x, https://cdn.example/b.jpg 2x">
      </body></html>`;
    const binding = studioFetch((input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/jump")) {
        return new Response(null, { status: 301, headers: { location: "https://sites.registermysite.com/nightshade/next", "set-cookie": "sf_sid=nope" } });
      }
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "sf_sid=ses_secret; Path=/; HttpOnly",
          "x-frame-options": "DENY",
          "cache-control": "public, max-age=120",
        },
      });
    });
    const ctx = createExecutionContext();
    const res = await handle(req("https://example.com/"), baseEnv({ HTML_STUDIO: binding }), ctx);
    await waitOnExecutionContext(ctx);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-rms-host")).toBe(SITE);
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(text).toContain('href="https://example.com/about"');
    expect(text).toContain('src="https://example.com/a.jpg"');
    expect(text).toContain('srcset="https://example.com/a.jpg 1x, https://cdn.example/b.jpg 2x"');
    expect(text).toContain('property="og:url" content="https://example.com/"');
    expect(text).toContain('rel="canonical" href="https://example.com/"');
    expect(text).not.toContain("noindex");
    expect(text).toContain('href="https://example.com/"');

    const jump = await handle(req("https://example.com/jump"), baseEnv({ HTML_STUDIO: binding }), createExecutionContext());
    expect(jump.status).toBe(301);
    expect(jump.headers.get("location")).toBe("https://example.com/next");
    expect(jump.headers.get("set-cookie")).toBeNull();
  });

  it("rewrites platform Location headers for studio and wrangler", async () => {
    await putMap("example.com", live);
    const studioRedirect = studioFetch((input) => {
      const url = typeof input === "string" ? input : input.url;
      const location = url.includes("/rel") ? "/nightshade/x" : "https://sites.registermysite.com/nightshade/x";
      const status = url.includes("/rel") ? 302 : 301;
      return new Response(null, { status, headers: { location } });
    });
    const abs = await handle(req("https://example.com/go"), baseEnv({ HTML_STUDIO: studioRedirect }), createExecutionContext());
    expect(abs.status).toBe(301);
    expect(abs.headers.get("location")).toBe("https://example.com/x");
    const rel = await handle(req("https://example.com/rel"), baseEnv({ HTML_STUDIO: studioRedirect }), createExecutionContext());
    expect(rel.status).toBe(302);
    expect(rel.headers.get("location")).toBe("https://example.com/x");

    await putMap("wrangler.example", { ...live, app: "wrangler" });
    const wranglerRedirect = studioFetch((input) => {
      const url = typeof input === "string" ? input : input.url;
      const location = url.includes("/rel") ? "/s/nightshade/x" : "https://wrangler.registermysite.com/s/nightshade/x";
      return new Response(null, { status: 301, headers: { location } });
    });
    const wabs = await handle(req("https://wrangler.example/go"), baseEnv({ WRANGLER: wranglerRedirect }), createExecutionContext());
    expect(wabs.headers.get("location")).toBe("https://wrangler.example/x");
    const wrel = await handle(req("https://wrangler.example/rel"), baseEnv({ WRANGLER: wranglerRedirect }), createExecutionContext());
    expect(wrel.headers.get("location")).toBe("https://wrangler.example/x");
  });

  it("rewrites sitemap and robots bodies and drops the query from canonical", async () => {
    await putMap("example.com", live);
    const html = `<!doctype html><html><head>
      <link rel="canonical" href="https://sites.registermysite.com/nightshade/?x=1">
      <link rel="alternate" href="https://sites.registermysite.com/nightshade/feed.xml">
      <meta name="twitter:url" content="https://sites.registermysite.com/nightshade/">
      </head><body></body></html>`;
    const binding = studioFetch((input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/sitemap.xml")) {
        return new Response(`<url><loc>https://sites.registermysite.com/nightshade/</loc></url>`, {
          headers: { "content-type": "application/xml" },
        });
      }
      if (url.includes("/robots.txt")) {
        return new Response("Sitemap: https://sites.registermysite.com/nightshade/sitemap.xml\n", {
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    });
    const page = await handle(req("https://example.com/?x=1"), baseEnv({ HTML_STUDIO: binding }), createExecutionContext());
    const text = await page.text();
    expect(text.match(/rel="canonical"/g)?.length).toBe(1);
    expect(text).toContain('rel="canonical" href="https://example.com/"');
    expect(text).toContain('rel="alternate" href="https://example.com/feed.xml"');
    expect(text).toContain('name="twitter:url" content="https://example.com/"');
    expect(text).not.toContain("sites.registermysite.com");
    const sitemap = await handle(req("https://example.com/sitemap.xml"), baseEnv({ HTML_STUDIO: binding }), createExecutionContext());
    expect(await sitemap.text()).toBe("<url><loc>https://example.com/</loc></url>");
    const robots = await handle(req("https://example.com/robots.txt"), baseEnv({ HTML_STUDIO: binding }), createExecutionContext());
    expect(await robots.text()).not.toContain("sites.registermysite.com");
  });

  it("serves branded 404, 503, and 502 pages", async () => {
    const missing = await handle(req("https://unmapped.example/"), baseEnv(), createExecutionContext());
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-robots-tag")).toBe("noindex");
    expect(await missing.text()).toContain("Domain not set up yet");

    await putMap("paused.example", { ...live, status: "paused" });
    const paused = await handle(req("https://paused.example/"), baseEnv(), createExecutionContext());
    expect(paused.status).toBe(503);
    expect(paused.headers.get("retry-after")).toBe("300");

    await putMap("down.example", live);
    const boom = studioFetch(() => new Response("nope", { status: 502, headers: { "content-type": "text/plain" } }));
    const down = await handle(req("https://down.example/"), baseEnv({ HTML_STUDIO: boom }), createExecutionContext());
    expect(down.status).toBe(502);
    expect(await down.text()).toContain("Site temporarily unavailable");
  });

  it("uses the branded page for a plain upstream 404 and keeps an html 404", async () => {
    await putMap("plain.example", { ...live, app: "wrangler" });
    const plain = studioFetch(() => new Response("404 nightshade/index.html", { status: 404, headers: { "content-type": "text/plain" } }));
    const res = await handle(req("https://plain.example/"), baseEnv({ WRANGLER: plain }), createExecutionContext());
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Page not found");

    await putMap("custom.example", live);
    const custom = studioFetch(() => new Response("<html><title>Missing</title></html>", { status: 404, headers: { "content-type": "text/html" } }));
    const html = await handle(req("https://custom.example/gone"), baseEnv({ HTML_STUDIO: custom }), createExecutionContext());
    expect(html.status).toBe(404);
    expect(await html.text()).toContain("Missing");
  });

  it("falls back to fetch when the service binding is missing", async () => {
    await putMap("example.com", live);
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      return new Response(`fetched ${url}`, { headers: { "content-type": "text/plain", "cache-control": "public, max-age=30" } });
    }) as typeof fetch;
    try {
      const res = await handle(req("https://example.com/"), baseEnv(), createExecutionContext());
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("https://example.com/");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("treats malformed kv as a miss", async () => {
    await env.DOMAIN_MAP.put(kvKey("bad.example"), "{not json");
    const res = await handle(req("https://bad.example/"), baseEnv(), createExecutionContext());
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Domain not set up yet");
  });

  it("escapes the host on branded pages", async () => {
    const res = await handle(req("https://evil.example/"), baseEnv({ DEV_HOST_OVERRIDE: "true" }), createExecutionContext());
    const text = await res.text();
    expect(text).not.toContain("<script>");
  });
});
