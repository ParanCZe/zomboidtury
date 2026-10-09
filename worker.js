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
    const chunkMatch = /^\/api\/kino\/iw00\/chunk([01])$/.exec(url.pathname);
    if (chunkMatch) {
      try {
        const part = Number(chunkMatch[1]);
        const u = "https://cdn.vel.gg/packs/kino/main/iw_00.iwd.br/" + part + "?v=b32bfd1562828385";
        const r = await fetch(u, { redirect: "manual" });
        if (!r.ok) return new Response("CDN HTTP " + r.status, { status: 502 });
        const body = await r.arrayBuffer();
        if (body.byteLength > 9437184) return new Response("Chunk too large", { status: 502 });
        return new Response(body, { headers: {
          "Content-Type": "application/octet-stream",
          "Cache-Control": "public, max-age=300",
          "Cross-Origin-Resource-Policy": "same-origin",
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "require-corp",
          "X-Content-Type-Options": "nosniff"
        } });
      } catch (e) {
        return new Response("Chunk proxy failed: " + (e?.message || "unknown"), { status: 502 });
      }
    }
    if (url.pathname === "/api/kino/chunk") {
      try {
        const path = url.searchParams.get("path") || "";
        const partText = url.searchParams.get("part") || "";
        if (!/^[a-zA-Z0-9_./-]{1,160}$/.test(path) || path.includes("..") || !/^(0|[1-9][0-9]{0,2})$/.test(partText)) {
          return new Response("Invalid chunk request", { status: 400 });
        }
        const part = Number(partText);
        const mr = await fetch("https://vel.gg/bo1z/kino/manifest.json", { redirect: "manual", cf: {cacheTtl:120,cacheEverything:true}});
        if (!mr.ok) throw new Error("Manifest upstream HTTP "+mr.status);
        const mf=await mr.json();
        if(mf.map!=="zombie_theater" || !Array.isArray(mf.files)) throw new Error("Unexpected manifest");
        const entry=mf.files.find(x=>x.path===path);
        if(!entry || !Array.isArray(entry.br) || part>=entry.br.length) return new Response("Chunk not in manifest",{status:404});
        const upstreamUrl="https://cdn.vel.gg/packs/kino/"+path+".br/"+part+"?v="+entry.sha256.slice(0,16);
        const r=await fetch(upstreamUrl,{redirect:"manual"});
        if(!r.ok) return new Response("CDN upstream HTTP "+r.status,{status:502});
        if(r.status>=300&&r.status<400) return new Response("Unexpected CDN redirect",{status:502});
        const max=8388608+1048576;
        const length=Number(r.headers.get("content-length")||0);
        if(length>max) return new Response("Chunk exceeds limit",{status:502});
        const bytes=await r.arrayBuffer();
        if(bytes.byteLength>max) return new Response("Chunk exceeds limit",{status:502});
        return new Response(bytes,{headers:{
          "Content-Type":"application/octet-stream",
          "Cache-Control":"public, max-age=300",
          "Cross-Origin-Resource-Policy":"same-origin",
          "Cross-Origin-Opener-Policy":"same-origin",
          "Cross-Origin-Embedder-Policy":"require-corp",
          "X-Content-Type-Options":"nosniff"
        }});
      }catch(e){return new Response("Chunk proxy error: "+(e?.message||"unknown"),{status:502});}
    }
    if (url.pathname === "/api/kino/raw-test") {
      const path = "zone/english/en_code_pre_gfx_mp.ff";
      const expectedSize = 2016;
      const upstreamURL = "https://cdn.vel.gg/packs/kino/" + path;
      try {
        const upstream = await fetch(upstreamURL, { redirect: "manual" });
        if (!upstream.ok) return new Response("RAW upstream HTTP " + upstream.status + " URL " + upstreamURL, {status: 502});
        const bytes = await upstream.arrayBuffer();
        if (bytes.byteLength > 32768) return new Response("RAW test exceeds size limit", {status:502});
        return new Response(bytes, {headers:{
          "Content-Type":"application/octet-stream",
          "X-BO1Z-Expected-Size":String(expectedSize),
          "Cross-Origin-Resource-Policy":"same-origin",
          "Cross-Origin-Opener-Policy":"same-origin",
          "Cross-Origin-Embedder-Policy":"require-corp",
          "X-Content-Type-Options":"nosniff"
        }});
      } catch(e) {return new Response("RAW test failed: "+(e?.message||"unknown"),{status:502});}
    }
    if (url.pathname === "/api/kino/raw") {
      try {
        const path = url.searchParams.get("path") || "";
        if (!/^[a-zA-Z0-9_./-]{1,160}$/.test(path) || path.includes("..")) return new Response("Invalid path",{status:400});
        const mr=await fetch("https://vel.gg/bo1z/kino/manifest.json",{redirect:"manual",cf:{cacheTtl:120,cacheEverything:true}});
        if(!mr.ok)throw new Error("Manifest HTTP "+mr.status);
        const mf=await mr.json();
        if(mf.map!=="zombie_theater" || !Array.isArray(mf.files))throw new Error("Unexpected manifest");
        const entry=mf.files.find(x=>x.path===path);
        if(!entry || entry.class!=="boot" || (Array.isArray(entry.br)&&entry.br.length) || entry.size>64*1048576 || !path.endsWith(".ff")) return new Response("Raw file not allowed",{status:404});
        const upstream=await fetch("https://cdn.vel.gg/packs/kino/"+path,{redirect:"manual"});
        if(!upstream.ok || upstream.status>=300&&upstream.status<400)return new Response("CDN HTTP "+upstream.status,{status:502});
        const bytes=await upstream.arrayBuffer();
        if(bytes.byteLength!==entry.size)return new Response("Raw size mismatch",{status:502});
        return new Response(bytes,{headers:{
          "Content-Type":"application/octet-stream",
          "Cache-Control":"public, max-age=300",
          "Cross-Origin-Resource-Policy":"same-origin",
          "Cross-Origin-Opener-Policy":"same-origin",
          "Cross-Origin-Embedder-Policy":"require-corp",
          "X-Content-Type-Options":"nosniff"
        }});
      }catch(e){return new Response("Raw proxy failed: "+(e?.message||"unknown"),{status:502});}
    }
    // Restrict repository and deployment internals even if an ignore rule is misconfigured.
    if (/(^|\/)\.(?:git|wrangler|env)(?:\/|$)/i.test(url.pathname) ||
        /(?:^|\/)(?:wrangler\.jsonc?|package(?:-lock)?\.json|worker\.js|\.assetsignore)(?:$|\/)/i.test(url.pathname)) {
      return new Response("Not found", { status: 404 });
    }
    // Serve the AutoTest as an actual HTML document on iOS, even when the asset
    // layer assigns a generic downloadable MIME type to .html files.
    const isAutoTest = ["/autotest","/autotest.html","/playtest","/playtest.html"].includes(url.pathname);
    // Cloudflare assets normalize /autotest.html -> /autotest. Do not rewrite
    // /autotest back to .html, or Safari enters a redirect loop.
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    if (isAutoTest && response.ok) {
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.delete("Content-Disposition");
      headers.set("Cache-Control", "no-store");
    }
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};
