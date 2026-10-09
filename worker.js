export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/kino/manifest") {
      try {
        const upstream = await fetch("https://vel.gg/bo1z/kino/manifest.json", {
          headers: { "Accept": "application/json" },
          redirect: "manual",
          cf: { cacheTtl: 120, cacheEverything: true }
        });
        if (upstream.status >= 300 && upstream.status < 400) return new Response("Upstream redirect " + upstream.status + " (not followed)", { status: 502 });
        if (!upstream.ok) return new Response("Upstream HTTP " + upstream.status, { status: 502 });
        const content = await upstream.text();
        if (content.length > 500000) return new Response("Manifest too large", { status: 502 });
        const manifest = JSON.parse(content);
        if (manifest.map !== "zombie_theater" || !Array.isArray(manifest.files)) {
          return new Response("Unexpected manifest", { status: 502 });
        }
        return new Response(content, { headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=120",
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "require-corp",
          "Cross-Origin-Resource-Policy": "same-origin",
          "X-Content-Type-Options": "nosniff"
        } });
      } catch (e) {
        return new Response("Manifest proxy failed: " + (e?.message || "unknown error"), {
          status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      }
    }
    if (url.pathname === "/api/kino/sample") {
      try {
        const upstreamUrl = "https://cdn.vel.gg/packs/kino/localization.txt.br/0?v=a102dfb5515f8fb1";
        const upstream = await fetch(upstreamUrl, {redirect:"manual", headers:{"Accept":"*/*"}});
        if (!upstream.ok) return new Response("CDN upstream HTTP " + upstream.status, { status:502 });
        const bytes = await upstream.arrayBuffer();
        if (bytes.byteLength > 16384) return new Response("Sample unexpectedly large", {status:502});
        return new Response(bytes, {headers:{
          "Content-Type":"application/octet-stream",
          "Cache-Control":"public, max-age=300",
          "Cross-Origin-Resource-Policy":"same-origin",
          "Cross-Origin-Opener-Policy":"same-origin",
          "Cross-Origin-Embedder-Policy":"require-corp",
          "X-Content-Type-Options":"nosniff"
        }});
      } catch(e) {
        return new Response("CDN sample proxy failed: "+(e?.message||"unknown"),{status:502});
      }
    }
    // Restrict repository and deployment internals even if an ignore rule is misconfigured.
    if (/(^|\/)\.(?:git|wrangler|env)(?:\/|$)/i.test(url.pathname) ||
        /(?:^|\/)(?:wrangler\.jsonc?|package(?:-lock)?\.json|worker\.js|\.assetsignore)(?:$|\/)/i.test(url.pathname)) {
      return new Response("Not found", { status: 404 });
    }
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};
