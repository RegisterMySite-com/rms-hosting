import { canonicalUrl, rewriteAssetUrl, rewriteSrcset, type RewriteCtx } from "./rewrite";

export function rewriteHtml(response: Response, ctx: RewriteCtx, path: string, search: string, live: boolean): Response {
  let sawCanonical = false;
  const canonical = canonicalUrl(ctx.canonicalHost, path, search);
  const rewriter = new HTMLRewriter()
    .on("base", {
      element(el) {
        const href = el.getAttribute("href");
        if (!href) return;
        const next = rewriteAssetUrl(href, ctx);
        el.setAttribute("href", next === href ? `https://${ctx.canonicalHost}/` : next);
      },
    })
    .on("link", {
      element(el) {
        const rel = (el.getAttribute("rel") || "").toLowerCase();
        if (rel.split(/\s+/).includes("canonical")) {
          sawCanonical = true;
          el.setAttribute("href", canonical);
        }
        rewriteAttr(el, "href", ctx);
      },
    })
    .on("a, area, form", {
      element(el) {
        rewriteAttr(el, "href", ctx);
        rewriteAttr(el, "action", ctx);
      },
    })
    .on("img, script, iframe, source, video, audio, embed, track", {
      element(el) {
        rewriteAttr(el, "src", ctx);
        rewriteAttr(el, "poster", ctx);
        rewriteSrcsetAttr(el, ctx);
        rewriteAttr(el, "data-src", ctx);
      },
    })
    .on("meta", {
      element(el) {
        const prop = (el.getAttribute("property") || el.getAttribute("name") || "").toLowerCase();
        if (prop === "og:url" || prop === "og:image") rewriteAttr(el, "content", ctx);
        if (live && prop === "robots") {
          const content = (el.getAttribute("content") || "").toLowerCase();
          if (content.includes("noindex")) el.remove();
        }
      },
    })
    .on("head", {
      element(el) {
        el.onEndTag((end) => {
          if (!sawCanonical) end.before(`<link rel="canonical" href="${canonical}">`, { html: true });
        });
      },
    });
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  if (live) headers.delete("x-robots-tag");
  return rewriter.transform(new Response(response.body, { status: response.status, headers }));
}

function rewriteAttr(el: Element, name: string, ctx: RewriteCtx) {
  const value = el.getAttribute(name);
  if (!value) return;
  const next = rewriteAssetUrl(value, ctx);
  if (next !== value) el.setAttribute(name, next);
}

function rewriteSrcsetAttr(el: Element, ctx: RewriteCtx) {
  const value = el.getAttribute("srcset");
  if (!value) return;
  const next = rewriteSrcset(value, ctx);
  if (next !== value) el.setAttribute("srcset", next);
}
