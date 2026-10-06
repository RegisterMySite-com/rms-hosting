# Apps handoff

Short paste-in prompts. Do not change `/api/internal/provision`, Wrangler `/api/import`, `/api/import/latest`, or `import --studio`, or HTML Studio's Publish slug, GitHub Desk, widgets, chatbots, analytics, page sections, SEO, templates, or undo/redo.

## HTML Studio (`html-studio`)

Paste:

> Published pages served at `https://sites.registermysite.com/<slug>/` are now also fetched by the `rms-hosting` Worker over a Service Binding and shown on the customer's domain. Please keep the publish flow as it is, and make these response tweaks if they are not already true:
>
> - Emit asset paths as relative (`styles.css`) or root-relative under the slug (`/<slug>/styles.css`). Do not emit `https://sites.registermysite.com/...` or `https://html-studio.registermysite.com/...` inside a published page.
> - Do not set `sf_sid` (or any `Set-Cookie`) on published-site responses. The session cookie is for the editor. `rms-hosting` strips `Set-Cookie`, but it should not be set.
> - Do not 302/301 a published page to `html-studio.registermysite.com` or `sites.registermysite.com`.
> - Treat `X-RMS-Hosted-For` and `X-RMS-Site-Id` as informational. Do not use them for auth.
> - Do not add `noindex` on a live published slug. Preview hosts can keep it; the proxy removes it only for `status: live`.

## Wrangler (`rms-wrangler`)

Paste:

> `rms-hosting` proxies `https://wrangler.registermysite.com/s/<slug>/` onto customer domains via a Service Binding. Keep deploy and `/s/<slug>/` as they are. Two things that already help, please keep them:
>
> - `published-site.ts` injects `<base href="/s/<slug>/">` and rewrites relative `href`/`src` to `/s/<slug>/...`. The proxy strips that prefix. Relative paths with a trailing-slash base also work if you would rather stop rewriting.
> - Unknown files return `404 <slug>/<path>` as `text/plain`. Keep that, or return the site's own `404.html` as `text/html` if you want the customer's 404.
>
> Please do not:
>
> - 302 to `wrangler.registermysite.com` for a published asset.
> - Set cookies on `/s/<slug>/` responses.
> - Trust `X-RMS-Hosted-For` or `X-RMS-Site-Id` for auth.
>
> The published-site CSP (`script-src` limited to a few CDNs) is stripped by the proxy so customer widgets, chatbots, and analytics keep working. You can leave the CSP on the `/s/` host.

## What we found (2026-10-06)

See `FINDINGS.md`.
