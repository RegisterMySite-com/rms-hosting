const HOST_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/;

/** Lowercase, strip a trailing dot, drop a port. URL.hostname is already punycode. */
export function normalizeHost(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith("[")) return host;
  const colon = host.lastIndexOf(":");
  if (colon > -1 && host.indexOf(":") === colon) host = host.slice(0, colon);
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

export function isValidHost(host: string): boolean {
  return HOST_RE.test(host);
}

export function apexOf(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

export function wwwOf(host: string): string {
  const apex = apexOf(host);
  return `www.${apex}`;
}

export function canonicalHost(host: string, canonical: "apex" | "www"): string {
  return canonical === "www" ? wwwOf(host) : apexOf(host);
}

export function platformHostSet(raw: string | undefined): Set<string> {
  return new Set(
    (raw || "")
      .split(",")
      .map((h) => normalizeHost(h))
      .filter(Boolean),
  );
}

export function isPlatformHost(host: string, platform: Set<string>): boolean {
  return platform.has(host) || host.endsWith(".workers.dev");
}

export function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * Dev host override is honored only when the var is exactly "true" AND the
 * request landed on workers.dev or localhost. A customer domain never honors
 * it, even if the var is flipped in production.
 */
export function devOverrideHost(request: Request, url: URL, envHost: string, overrideFlag: string): string | null {
  if (overrideFlag !== "true") return null;
  if (!envHost.endsWith(".workers.dev") && !isLocalHost(envHost)) return null;
  const header = request.headers.get("x-rms-dev-host");
  const query = url.searchParams.get("__host");
  const raw = header || query;
  if (!raw) return null;
  const host = normalizeHost(raw);
  if (!isValidHost(host)) return null;
  if (host.endsWith(".workers.dev") || host === "localhost" || host.endsWith(".registermysite.com") || host === "registermysite.com") {
    return null;
  }
  return host;
}
