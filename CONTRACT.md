# DOMAIN_MAP contract

Shared KV namespace between `registermysite-account` (writer) and `rms-hosting` (reader only).
`rms-hosting` never writes this namespace.

KV reads are eventually consistent. `rms-hosting` reads with `cacheTtl: 45` (minimum allowed is 30; the default is 60). A publish, pause, or app switch can take up to about 60 seconds to show up on every Cloudflare location. Negative lookups are cached too, so a brand-new key has the same delay.

## Key

`host:<hostname>`

- lowercase
- no port
- no trailing dot
- punycode for IDNs (`URL.hostname` form)
- one key for the apex and one key for `www`

Examples: `host:ryanswansontattoos.com`, `host:www.ryanswansontattoos.com`

## Value

```json
{
  "site_id": "d9d3a4b2-1111-2222-3333-444444444444",
  "app": "html_studio",
  "ref": "nightshade",
  "canonical": "apex",
  "status": "live",
  "version": 3,
  "updated_at": "2026-10-06T18:00:00Z"
}
```

| Field | Required | Values |
| --- | --- | --- |
| `site_id` | yes | stable id of the site. Returned as `x-rms-host` and by `GET /__rms/whoami`. |
| `app` | yes | `html_studio` or `wrangler`. Anything else is a miss. |
| `ref` | yes | HTML Studio publish slug, or Wrangler deploy slug. No slashes. |
| `canonical` | no | `apex` (default) or `www`. `www` always 301s to the bare domain. The bare domain is the canonical host. |
| `status` | no | `live` (default) or `paused`. Paused serves a branded 503 with `Retry-After`. |
| `version` | no | integer, default `1`. Bump on republish, slug change, or app switch. It is part of the edge cache key, so old HTML stops matching. |
| `updated_at` | no | ISO-8601 timestamp. Informational. |

Bad JSON, a non-object, an unknown `app`, or a missing `site_id` / `ref` is a miss. `rms-hosting` logs the host and the reason, then serves the branded "Domain not set up yet" page.

## Differences from the shape the account Worker was told to write

The account Worker was told: key = host, value `{ app, ref, site_id }`.

| Topic | Account Worker was told | This contract |
| --- | --- | --- |
| Key | `host` (bare hostname) | `host:<hostname>` |
| `canonical` | absent | optional, default `apex` |
| `status` | absent | optional, default `live` |
| `version` | absent | optional, default `1`. Bump it or edge cache keeps the previous site for up to `EDGE_CACHE_TTL` (60s) plus KV delay. |
| `updated_at` | absent | optional |

`rms-hosting` accepts the smaller value and fills the defaults. It does **not** accept a bare hostname key. The account Worker must write `host:<hostname>`.

## Hosting check

`GET https://<domain>/__rms/whoami` returns `200` and `{ site_id, app, ref, canonical, version }` with `x-rms-host: <site_id>` and `Cache-Control: no-store`. `canonical` is the configured host (`example.com` or `www.example.com`), not the host that was requested. An unmapped host returns `404`.

`GET /__rms/health` returns `{ mapped, status, app, ref, version, canonical }`. `version` is the worker version. `canonical` is the configured host, or `null` when the host is not mapped.
