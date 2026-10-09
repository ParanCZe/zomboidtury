export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/bo1z-icon.png" || url.pathname === "/apple-touch-icon.png") {
      // Native 180x180 PNG icon for iOS Home Screen (no external raster service).
      const W=180,H=180,raw=new Uint8Array(H*(1+W*4));
      const letters={
        B:["11110","10001","10001","11110","10001","10001","11110"],
        O:["01110","10001","10001","10001","10001","10001","01110"],
        1:["00100","01100","00100","00100","00100","00100","01110"],
        Z:["11111","00001","00010","00100","01000","10000","11111"]
      };
      for(let y=0;y<H;y++)for(let x=0;x<W;x++){
        const p=y*(W*4+1)+1+x*4,dx=x-90,dy=y-90,r=Math.sqrt(dx*dx+dy*dy);
        let rgb=r>69&&r<74?[215,173,102]:[12,20,33];
        if(x<5||y<5||x>=W-5||y>=H-5)rgb=[11,19,31];
        const text="BO1Z",step=7,scale=5,left=21,top=72;
        const n=Math.floor((x-left)/(6*scale));
        if(n>=0&&n<text.length){
          const lx=Math.floor((x-left-n*6*scale)/scale),ly=Math.floor((y-top)/scale);
          if(lx>=0&&lx<5&&ly>=0&&ly<7&&letters[text[n]][ly][lx]==="1")rgb=[246,221,173];
        }
        raw[p]=rgb[0];raw[p+1]=rgb[1];raw[p+2]=rgb[2];raw[p+3]=255;
      }
      const adler=(bytes)=>{let a=1,b=0;for(const v of bytes){a=(a+v)%65521;b=(b+a)%65521}return ((b<<16)|a)>>>0};
      const zparts=[Uint8Array.of(0x78,0x01)];
      for(let p=0;p<raw.length;p+=65535){
        const n=Math.min(65535,raw.length-p),l=(~n)&65535,final=p+n===raw.length?1:0;
        zparts.push(Uint8Array.of(final,n&255,n>>>8,l&255,l>>>8),raw.subarray(p,p+n));
      }
      const v=adler(raw);
      zparts.push(Uint8Array.of(v>>>24,(v>>>16)&255,(v>>>8)&255,v&255));
      const pack=(arr)=>{const len=arr.reduce((n,x)=>n+x.length,0),out=new Uint8Array(len);let p=0;for(const x of arr){out.set(x,p);p+=x.length}return out};
      const z=pack(zparts),ihdr=new Uint8Array(13);
      const view=new DataView(ihdr.buffer);view.setUint32(0,W);view.setUint32(4,H);ihdr[8]=8;ihdr[9]=6;
      const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0)}return(c^0xffffffff)>>>0};
      const chunk=(name,data)=>{
        const body=new Uint8Array(4+data.length),out=new Uint8Array(12+data.length);
        for(let i=0;i<4;i++)body[i]=name.charCodeAt(i);
        body.set(data,4);const v=new DataView(out.buffer);v.setUint32(0,data.length);out.set(body,4);v.setUint32(out.length-4,crc(body));return out;
      };
      const png=pack([Uint8Array.of(137,80,78,71,13,10,26,10),chunk("IHDR",ihdr),chunk("IDAT",z),chunk("IEND",new Uint8Array())]);
      return new Response(png,{headers:{"Content-Type":"image/png","Cache-Control":"public, max-age=86400","Cross-Origin-Resource-Policy":"same-origin"}});
    }
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
    // Stream each exact manifest-listed archive block without assuming it is
    // 8 MiB. The CDN's block count is authoritative: localized archives can
    // contain a single block larger than 8 MiB.
    if (url.pathname === "/api/kino/chunk-stream") {
      try {
        const path=url.searchParams.get("path")||"";
        const partText=url.searchParams.get("part")||"";
        if (!/^[a-zA-Z0-9_./-]{1,160}$/.test(path) || path.includes("..") ||
            !/^(0|[1-9][0-9]{0,2})$/.test(partText))
          return new Response("Invalid chunk request",{status:400});
        const part=Number(partText);
        const mr=await fetch("https://vel.gg/bo1z/kino/manifest.json",
          {redirect:"manual",cf:{cacheTtl:120,cacheEverything:true}});
        if(mr.status!==200)throw Error("Manifest HTTP "+mr.status);
        const mf=await mr.json();
        if(mf.map!=="zombie_theater"||!Array.isArray(mf.files))
          throw Error("Unexpected manifest");
        const entry=mf.files.find(x=>x.path===path);
        if(!entry||!Array.isArray(entry.br)||!entry.br.length||
           part>=Math.max(entry.br.length,Math.ceil(entry.size/8388608)))
          return new Response("Chunk not in manifest",{status:404});
        const upstream=await fetch("https://cdn.vel.gg/packs/kino/"+path+".br/"+part+
          "?v="+entry.sha256.slice(0,16),{redirect:"manual"});
        if(upstream.status!==200||!upstream.body)
          return new Response("CDN HTTP "+upstream.status,{status:502});
        // Content-Length might be absent; the browser validates total file
        // size and SHA-256 before treating the download as complete.
        const declared=Number(upstream.headers.get("content-length")||0);
        if(declared>entry.size+1048576)
          return new Response("Chunk exceeds uncompressed file size",{status:502});
        return new Response(upstream.body,{headers:{
          "Content-Type":"application/octet-stream",
          "Cache-Control":"no-store",
          "Cross-Origin-Resource-Policy":"same-origin",
          "Cross-Origin-Opener-Policy":"same-origin",
          "Cross-Origin-Embedder-Policy":"require-corp",
          "X-Content-Type-Options":"nosniff"
        }});
      }catch(e){return new Response("Chunk stream proxy error: "+(e?.message||"unknown"),{status:502})}
    }
    // Stream raw manifest-listed assets directly to OPFS without buffering the
    // whole file in Worker memory, including large files lacking chunk metadata.
    if (url.pathname === "/api/kino/raw-stream") {
      try {
        const path = url.searchParams.get("path") || "";
        if (!/^[a-zA-Z0-9_./-]{1,160}$/.test(path) || path.includes(".."))
          return new Response("Invalid path", {status:400});
        const mr=await fetch("https://vel.gg/bo1z/kino/manifest.json",{
          redirect:"manual",cf:{cacheTtl:120,cacheEverything:true}});
        if(!mr.ok)throw Error("Manifest HTTP "+mr.status);
        const mf=await mr.json();
        if(mf.map!=="zombie_theater" || !Array.isArray(mf.files))
          throw Error("Unexpected manifest");
        const entry=mf.files.find(x=>x.path===path);
        if(!entry || !Number.isSafeInteger(entry.size) || entry.size<=0 ||
           (!path.endsWith(".iwd") && !path.endsWith(".ff")))
          return new Response("Raw path not permitted", {status:404});
        const upstream=await fetch("https://cdn.vel.gg/packs/kino/"+path,{
          redirect:"manual",headers:{"Accept-Encoding":"identity"}});
        if(upstream.status!==200 || !upstream.body)
          return new Response("Raw CDN HTTP "+upstream.status,{status:502});
        const len=Number(upstream.headers.get("content-length")||0);
        if(len && len!==entry.size)return new Response("Raw content-length mismatch",{status:502});
        return new Response(upstream.body,{headers:{
          "Content-Type":"application/octet-stream",
          "Cache-Control":"no-store",
          "Cross-Origin-Resource-Policy":"same-origin",
          "Cross-Origin-Opener-Policy":"same-origin",
          "Cross-Origin-Embedder-Policy":"require-corp",
          "X-Content-Type-Options":"nosniff"
        }});
      }catch(e){return new Response("Raw stream proxy error: "+(e?.message||"unknown"),{status:502});}
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
    const isAutoTest = ["/autotest","/autotest.html","/playtest","/playtest.html","/launcher","/launcher.html"].includes(url.pathname);
    // Cloudflare assets normalize /autotest.html -> /autotest. Do not rewrite
    // /autotest back to .html, or Safari enters a redirect loop.
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    if(url.pathname==="/bo1z.webmanifest")headers.set("Content-Type","application/manifest+json; charset=utf-8");
    if(url.pathname==="/bo1z-sw.js")headers.set("Content-Type","application/javascript; charset=utf-8");
    if(url.pathname==="/bo1z-icon.svg")headers.set("Content-Type","image/svg+xml");
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
