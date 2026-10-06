export type SafePath = { ok: true; path: string } | { ok: false; reason: string };

/**
 * Collapse a request path so it cannot escape the slug prefix.
 * Rejects `..`, encoded `%2e%2e`, and double-encoded `%252e%252e`.
 */
export function safePath(pathname: string): SafePath {
  if (!pathname.startsWith("/")) return { ok: false, reason: "relative" };
  if (pathname.includes("\\") || pathname.includes("\0")) return { ok: false, reason: "illegal" };
  let decoded = pathname;
  for (let i = 0; i < 2; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return { ok: false, reason: "bad_encoding" };
    }
    if (next === decoded) break;
    decoded = next;
  }
  if (decoded.includes("..") || decoded.includes("\\") || decoded.includes("\0")) {
    return { ok: false, reason: "traversal" };
  }
  const trailing = decoded.length > 1 && decoded.endsWith("/");
  const parts = decoded.split("/");
  const kept: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") return { ok: false, reason: "traversal" };
    kept.push(part);
  }
  const joined = `/${kept.join("/")}`;
  if (trailing && joined !== "/") return { ok: true, path: `${joined}/` };
  return { ok: true, path: joined || "/" };
}

export function hasExtension(path: string): boolean {
  const last = path.slice(path.lastIndexOf("/") + 1);
  return last.includes(".") && !last.startsWith(".");
}

export function withTrailingSlash(path: string): string {
  if (path.endsWith("/")) return path;
  return `${path}/`;
}
