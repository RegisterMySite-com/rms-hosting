# Inspection notes (2026-10-06)

Probed live. No published HTML Studio slug was discoverable from outside (sitemap only lists the studio host; guessed slugs 404). Wrangler has no public slug either. Asset-path rules come from those probes plus `rms-wrangler` `src/published-site.ts` and the HTML Studio export in `tattoos-export`.

## HTML Studio

- Worker script name in `RegisterMySite-com/html-studio` `wrangler.json`: `html-studio`.
- `https://sites.registermysite.com/` returns the HTML Studio app (same document as `html-studio.registermysite.com`) with `200`, `content-type: text/html`, `cache-control: public, max-age=0, must-revalidate`, and `set-cookie: sf_sid=...; HttpOnly; Secure; SameSite=Lax`.
- An unknown slug (`/this-slug-does-not-exist-rms/`) returns `404` with an empty body and still sets `sf_sid`.
- Studio app assets are root-relative (`/favicon.svg`) and absolute on `html-studio.registermysite.com`. Those are editor assets, not published-site assets.
- `tattoos-export` (an HTML Studio export) inlines CSS and JS. Images and fonts are absolute third-party URLs (`images.unsplash.com`, `fonts.googleapis.com`, `cdn.tailwindcss.com`). `og:image` is absolute. No `/<slug>/` prefix and no `url(/<slug>/...)` in CSS.
- Where published files live: not visible from this repo. `html-studio` `wrangler.json` binds a Durable Object (`APP`) and static assets, no R2. `html-bundler` stores bundles in R2 bucket `html-bundler` and serves `/b/*`, which is a different host. Treat HTML Studio published files as owned by the `html-studio` Worker. This router does not read them.

## Wrangler

- Worker script name: `rms-wrangler`.
- R2 bucket binding `SITES`, bucket name `rms-wrangler-sites`. `servePublishedAsset` looks up `<slug>/<path>` and the unknown-file body is `404 <slug>/<path>` (`text/plain`). That matches the live 404 `404 does-not-exist-rms-probe/index.html`.
- `/s/<slug>` with no trailing slash is a live `301` to `/s/<slug>/` (`location: /s/does-not-exist-rms-probe/`). The helper source says `308`; production is `301`. The proxy rewrites either.
- The helper injects `<base href="/s/<slug>/">` and rewrites relative `href`/`src` to `/s/<slug>/<file>`. It does not rewrite CSS `url()`.
- Response headers on a published file include a strict CSP and `X-Frame-Options: SAMEORIGIN`. No `Set-Cookie` on the 404 probe.
- Files live in R2 (`rms-wrangler-sites`), keyed by `<slug>/<path>`.

## Rewrite rules that came out of this

- HTML only (`text/html`), streamed with `HTMLRewriter`.
- Rewrite `href`, `src`, `action`, `srcset`, `poster`, `data-src`, `content` on `og:url` and `og:image`, and `<base href>`.
- Prefixes stripped: `https://sites.registermysite.com/<ref>`, `https://wrangler.registermysite.com/s/<ref>`, `/<ref>`, `/s/<ref>`.
- Relative URLs and other absolute URLs are left alone. `<base>` plus the prefix rewrite covers Wrangler's rewritten markup.
- Set or replace `<link rel="canonical">` to `https://<canonical host><path>`.
- Drop upstream `noindex` meta and `X-Robots-Tag` only when `status` is `live`.
- CSS is not rewritten. Inspection did not show slug-prefixed `url()` in HTML Studio CSS, and Wrangler does not emit them.
- JS is not rewritten.
- `Set-Cookie` is always stripped (the live studio host sets `sf_sid` on HTML and on 404s).
- Upstream `Content-Security-Policy` is left in place only if we do not strip it. Wrangler's published CSP blocks widgets. The proxy strips `Content-Security-Policy` so customer domains are not locked to Wrangler's CDN list. This is intentional and documented in `APPS-HANDOFF.md`.
- `Accept-Encoding` is not forwarded. Forwarding it makes the runtime hand the Worker a compressed body, which breaks `HTMLRewriter`. The edge still compresses the client response.

## Still true after this Worker

`sites.registermysite.com/<slug>/` and `wrangler.registermysite.com/s/<slug>/` are unchanged. This Worker has no routes on those hosts.
