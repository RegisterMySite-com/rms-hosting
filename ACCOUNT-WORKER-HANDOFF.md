# Account Worker handoff

Paste this into the `registermysite-account` chat. `rms-hosting` is the hosting router. It stores no files and it never writes `DOMAIN_MAP`.

## Bindings it expects

- Worker script name: `rms-hosting`
- KV binding `DOMAIN_MAP`: the same namespace id the account Worker writes
- Service binding `HTML_STUDIO` → script `html-studio`
- Service binding `WRANGLER` → script `rms-wrangler`

## DOMAIN_MAP

See `CONTRACT.md`. Writer rules:

1. Key is `host:<hostname>` (lowercase, no port, no trailing dot, punycode). Write both the apex and `www` keys.
2. Value is JSON: `{ site_id, app, ref, canonical, status, version, updated_at }`.
3. `app` is `html_studio` or `wrangler`. `ref` is that app's publish slug.
4. On republish, slug change, or app switch, bump `version`. The edge cache key is `https://<host><path>?<query>&__v=<version>`. Without a bump, the previous response can stick for `EDGE_CACHE_TTL` seconds (60) on top of KV's ~60s propagation.
5. Pause: set `status` to `paused` (503). Turn off: detach both Custom Domains, delete both KV keys, restore the owner's DNS records.

## Attach hostnames (Workers Custom Domains)

Custom Domains are an exact hostname match. Attach both the apex and `www`. They create the DNS record and the certificate. A proxied CNAME of the apex or `www` to `sites.registermysite.com` will conflict — delete those records first. The zone must be in this account and active.

Docs checked 2026-10-06: [Attach to domain](https://developers.cloudflare.com/api/operations/worker-domain-attach-to-domain).

```bash
# Attach
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/domains" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "hostname": "ryanswansontattoos.com",
    "service": "rms-hosting",
    "zone_id": "'"$ZONE_ID"'",
    "environment": "production"
  }'

# Repeat for www.ryanswansontattoos.com

# List, to get the domain id
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/domains" \
  -H "Authorization: Bearer $CF_API_TOKEN"

# Detach
curl -X DELETE "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/domains/$DOMAIN_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN"
```

Response `result.id` is the domain id used to detach. Certificate issuance is asynchronous (often a few minutes, sometimes longer). Until it is active the hostname can fail TLS.

## Token permissions

The Attach Domain API documents `Workers Scripts Write`. Also grant:

- Zone Read (resolve `zone_id`, confirm the zone is active)
- DNS Write / DNS Edit (delete the conflicting proxied apex and `www` CNAMEs before attach, restore them when hosting turns off)
- Workers Scripts Read (confirm `rms-hosting` is deployed)

Account Worker token names that match the dashboard: Workers Scripts Write, Zone Read, DNS Write.

## Hosting check

After attach and a KV write:

```bash
curl -sS -D - "https://<domain>/__rms/whoami"
```

Expect `200`, `x-rms-host: <site_id>`, and body `{ "site_id", "app", "canonical" }`. `Cache-Control: no-store`. A miss is `404`.

`GET /__rms/health` returns `{ ok, version, host, mapped }` and is safe to poll. It does not prove the Custom Domain certificate is ready.

## Do not

- Do not point customer CNAMEs at `sites.registermysite.com` once the Custom Domain is attached.
- Do not write site files into this Worker.
- Do not add routes for `sites.registermysite.com`, `wrangler.registermysite.com`, or other platform hosts on `rms-hosting`.
