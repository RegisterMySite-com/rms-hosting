#!/usr/bin/env bash
# Smoke-check a domain served by rms-hosting.
# Usage: scripts/smoke.sh https://example.com
set -euo pipefail
TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "usage: scripts/smoke.sh https://example.com[/path]" >&2
  exit 2
fi
HEADERS="$(mktemp)"
BODY="$(mktemp)"
trap 'rm -f "$HEADERS" "$BODY"' EXIT
curl -sS -D "$HEADERS" -o "$BODY" -L --max-redirs 0 "$TARGET" || true
STATUS="$(awk 'BEGIN{c=""} /^HTTP/{c=$2} END{print c}' "$HEADERS")"
echo "status: ${STATUS:-unknown}"
echo "x-rms-host: $(awk 'tolower($1)=="x-rms-host:" {print $2}' "$HEADERS" | tr -d '\r')"
echo "x-rms-cache: $(awk 'tolower($1)=="x-rms-cache:" {print $2}' "$HEADERS" | tr -d '\r')"
CANON="$(grep -oE 'rel="canonical" href="[^"]+"' "$BODY" | head -1 || true)"
echo "canonical: ${CANON:-none}"
if grep -qi '^set-cookie:' "$HEADERS"; then
  echo "set-cookie: LEAK"
  grep -i '^set-cookie:' "$HEADERS"
  exit 1
fi
echo "set-cookie: none"
