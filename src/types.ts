export const VERSION = "1.1.0";

export type AppName = "html_studio" | "wrangler";
export type Canonical = "apex" | "www";
export type SiteStatus = "live" | "paused";

export interface DomainMapping {
  site_id: string;
  app: AppName;
  ref: string;
  canonical: Canonical;
  status: SiteStatus;
  version: number;
  updated_at?: string;
}

export interface Env {
  DOMAIN_MAP: KVNamespace;
  HTML_STUDIO?: Fetcher;
  WRANGLER?: Fetcher;
  HOSTING_ANALYTICS?: AnalyticsEngineDataset;
  HTML_STUDIO_ORIGIN: string;
  WRANGLER_ORIGIN: string;
  WRANGLER_PREFIX: string;
  PLATFORM_HOSTS: string;
  EDGE_CACHE_TTL: string;
  DEV_HOST_OVERRIDE: string;
}

export interface UpstreamResult {
  response: Response;
  status: number;
  ms: number;
  via: "binding" | "fetch";
}
