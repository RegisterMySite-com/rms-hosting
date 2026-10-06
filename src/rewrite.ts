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

export function canonicalUrl(host: string, path: string, search: string): string {
  return `https://${host}${path}${search}`;
}
