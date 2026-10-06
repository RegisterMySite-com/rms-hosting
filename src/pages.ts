const LOGO = "https://uploads.registermysite.com/registermysite-logo.gif";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&" + "amp;";
      case "<":
        return "&" + "lt;";
      case ">":
        return "&" + "gt;";
      case '"':
        return "&" + "quot;";
      default:
        return "&" + "#39;";
    }
  });
}

function page(opts: { title: string; heading: string; body: string; host?: string }): string {
  const host = opts.host ? escapeHtml(opts.host) : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)}</title>
  <meta name="robots" content="noindex" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: #07080a; color: #e2e8f0;
      font-family: "Space Grotesk", system-ui, sans-serif;
    }
    main {
      width: min(520px, calc(100% - 32px));
      background: #12121a; border: 1px solid #23232e; border-radius: 16px;
      padding: 32px 28px;
    }
    img { width: 148px; height: auto; }
    h1 { font-size: 1.45rem; margin: 18px 0 8px; letter-spacing: -0.02em; }
    p { margin: 0 0 14px; line-height: 1.5; color: #cbd5e1; }
    .host { color: #5eead4; word-break: break-all; }
    a { color: #2dd4bf; }
    .links { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 18px; }
  </style>
</head>
<body>
  <main>
    <img src="${LOGO}" alt="RegisterMySite" />
    <h1>${escapeHtml(opts.heading)}</h1>
    ${opts.body}
    ${host ? `<p class="host">${host}</p>` : ""}
  </main>
</body>
</html>`;
}

export function brandedResponse(status: number, html: string, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "SAMEORIGIN");
  return new Response(html, { status, headers });
}

export function domainNotSetup(host: string): Response {
  return brandedResponse(
    404,
    page({
      title: "Domain not set up yet",
      heading: "Domain not set up yet",
      host,
      body: `<p>This domain is connected to RegisterMySite but no site is published to it yet.</p>
        <div class="links">
          <a href="https://account.registermysite.com/dashboard">Open the dashboard</a>
          <a href="https://registermysite.com/guides/">Read the guides</a>
        </div>`,
    }),
  );
}

export function pageNotFound(host: string): Response {
  return brandedResponse(
    404,
    page({
      title: "Page not found",
      heading: "Page not found",
      host,
      body: `<p>That page is not on this site.</p>`,
    }),
  );
}

export function pausedPage(host: string): Response {
  return brandedResponse(
    503,
    page({
      title: "This site is paused",
      heading: "This site is paused",
      host,
      body: `<p>The owner paused this site in RegisterMySite. It will be back when they turn hosting on.</p>`,
    }),
    { "retry-after": "300" },
  );
}

export function unavailablePage(host: string): Response {
  return brandedResponse(
    502,
    page({
      title: "Site temporarily unavailable",
      heading: "Site temporarily unavailable",
      host,
      body: `<p>The published site did not respond. Try again in a minute.</p>`,
    }),
  );
}

export function methodNotAllowed(): Response {
  return new Response("Method not allowed", {
    status: 405,
    headers: {
      allow: "GET, HEAD",
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

export function badRequest(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
  });
}
