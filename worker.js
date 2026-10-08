export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
