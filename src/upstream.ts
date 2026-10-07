import type { AppName, Env } from "./types";
import { hasExtension, withTrailingSlash } from "./path";

export interface UpstreamTarget {
  url: string;
  binding: "HTML_STUDIO" | "WRANGLER";
}

export function buildUpstreamUrl(app: AppName, ref: string, path: string, search: string, env: Env): UpstreamTarget {
  if (app === "html_studio") {
    const origin = env.HTML_STUDIO_ORIGIN.replace(/\/+$/, "");
    return { url: `${origin}/${ref}${path}${search}`, binding: "HTML_STUDIO" };
  }
  const origin = env.WRANGLER_ORIGIN.replace(/\/+$/, "");
  const prefix = env.WRANGLER_PREFIX.startsWith("/") ? env.WRANGLER_PREFIX : `/${env.WRANGLER_PREFIX}`;
  const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return { url: `${origin}${normalized}${ref}${path}${search}`, binding: "WRANGLER" };
}

const FORWARD = ["accept", "accept-language", "if-none-match", "if-modified-since", "range", "user-agent"];

export function upstreamHeaders(request: Request, host: string, siteId: string): Headers {
  const headers = new Headers();
  for (const name of FORWARD) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("x-rms-hosted-for", host);
  headers.set("x-rms-site-id", siteId);
  return headers;
}

export function cacheKeyUrl(host: string, path: string, search: string, version: number): string {
  const joiner = search ? "&" : "?";
  return `https://${host}${path}${search}${joiner}__v=${version}`;
}

export function edgeTtl(cacheControl: string | null, cap: number): number | null {
  if (!cacheControl) return cap;
  if (/no-store|private|no-cache/i.test(cacheControl)) return null;
  const match = cacheControl.match(/max-age=(\d+)/i);
  if (!match) return cap;
  return Math.min(Number(match[1]), cap);
}

export function shouldRetryPretty(path: string, status: number, alreadyRetried: boolean): string | null {
  if (alreadyRetried || status !== 404) return null;
  if (path === "/" || path.endsWith("/") || hasExtension(path)) return null;
  return withTrailingSlash(path);
}

export function htmlContentType(contentType: string | null): boolean {
  return !!contentType && contentType.toLowerCase().includes("text/html");
}

export function cssContentType(contentType: string | null): boolean {
  return !!contentType && contentType.toLowerCase().includes("text/css");
}

export function textContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const type = contentType.toLowerCase();
  return (
    type.includes("text/plain") ||
    type.includes("text/markdown") ||
    type.includes("application/xml") ||
    type.includes("text/xml") ||
    type.includes("application/rss+xml") ||
    type.includes("application/json")
  );
}
