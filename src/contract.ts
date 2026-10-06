import type { AppName, Canonical, DomainMapping, SiteStatus } from "./types";

const APPS = new Set<AppName>(["html_studio", "wrangler"]);
const CANONICAL = new Set<Canonical>(["apex", "www"]);
const STATUS = new Set<SiteStatus>(["live", "paused"]);

export function kvKey(host: string): string {
  return `host:${host}`;
}

/**
 * Accept the full contract, and the smaller shape the account Worker was
 * originally told to write (`{ app, ref, site_id }`). Missing canonical,
 * status, and version get safe defaults so a partial write still routes.
 * Unknown app, bad JSON, or a missing ref/site_id is a miss.
 */
export function parseMapping(raw: string | null): { ok: true; mapping: DomainMapping } | { ok: false; reason: string } {
  if (!raw) return { ok: false, reason: "empty" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!value || typeof value !== "object") return { ok: false, reason: "not_object" };
  const row = value as Record<string, unknown>;
  const app = row.app;
  const ref = typeof row.ref === "string" ? row.ref.trim() : "";
  const siteId = typeof row.site_id === "string" ? row.site_id.trim() : "";
  if (!APPS.has(app as AppName)) return { ok: false, reason: "unknown_app" };
  if (!ref || ref.includes("/") || ref.includes("..") || ref.includes("\\")) return { ok: false, reason: "bad_ref" };
  if (!siteId) return { ok: false, reason: "missing_site_id" };
  const canonical = CANONICAL.has(row.canonical as Canonical) ? (row.canonical as Canonical) : "apex";
  const status = STATUS.has(row.status as SiteStatus) ? (row.status as SiteStatus) : "live";
  const version = typeof row.version === "number" && Number.isFinite(row.version) ? row.version : 1;
  const updated = typeof row.updated_at === "string" ? row.updated_at : undefined;
  return {
    ok: true,
    mapping: {
      site_id: siteId,
      app: app as AppName,
      ref,
      canonical,
      status,
      version,
      updated_at: updated,
    },
  };
}
