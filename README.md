# rms-hosting

Thin Cloudflare Worker that serves a customer's domain from the site they published in HTML Studio or Wrangler. It stores no files and it only reads `DOMAIN_MAP`.

```
customer host  →  rms-hosting  →  service binding  →  html-studio  /<slug>/…
                                         or         →  rms-wrangler /s/<slug>/…
```

## Commands

```bash
cd rms-hosting
npm install
npm test

# Reuse the account Worker's namespace. Do not create a second one if it exists.
npx wrangler kv namespace list
# If the account Worker has none yet:
npx wrangler kv namespace create DOMAIN_MAP
# Put that id in wrangler.toml ([[kv_namespaces]] id).

npx wrangler deploy
# No --env. No secrets today.

# After a Custom Domain is attached and a KV row is written:
scripts/smoke.sh https://example.com
```

Deploy needs `wrangler login` or `CLOUDFLARE_API_TOKEN`. Token permissions: Workers Scripts Write (deploy), Workers KV Storage Read (the shared namespace), and Account Settings Read. Attaching customer hostnames is the account Worker's job; that token also needs Zone Read and DNS Write. See `ACCOUNT-WORKER-HANDOFF.md`.

## Bindings

| Binding | Target |
| --- | --- |
| `DOMAIN_MAP` | shared KV with `registermysite-account` (read only here) |
| `HTML_STUDIO` | service `html-studio` |
| `WRANGLER` | service `rms-wrangler` |
| `HOSTING_ANALYTICS` | optional Analytics Engine dataset `rms_hosting` |

If a service binding is missing, the Worker falls back to `fetch(ORIGIN + path)` and logs a warning. Same-zone public Worker-to-Worker subrequests can fail, so the binding is the real path.

`DEV_HOST_OVERRIDE=true` honors `?__host=` or `X-RMS-Dev-Host` only on `*.workers.dev` and localhost. A customer domain ignores it.

## Limits

- KV is eventually consistent, about 60 seconds, including negative lookups. Reads use `cacheTtl: 45`.
- Edge cache key includes `version`. Bump it on republish or the previous response can live for `EDGE_CACHE_TTL` (60s).
- Custom Domain certificates are issued asynchronously, often a few minutes.
- Only GET and HEAD are proxied. Forms post to forms.registermysite.com or Edgeform.
- No default CSP, so widgets keep working. HSTS is set without `includeSubDomains`.
