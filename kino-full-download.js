(function(){
"use strict";
const CHUNK=8388608;
const MB=1048576;
const valid=e=>e&&typeof e.path==="string"&&/^[a-zA-Z0-9_./-]{1,160}$/.test(e.path)&&!e.path.includes("..")&&Number.isSafeInteger(e.size)&&e.size>0&&/^[0-9a-f]{64}$/i.test(e.sha256)&&(!e.br||Array.isArray(e.br));
const memKey=e=>"bo1z-verified:"+e.path;
function fmt(n){return(n/MB).toFixed(1)+" MiB"}
async function target(root,path){const parts=path.split("/");let d=root;for(const p of parts.slice(0,-1))d=await d.getDirectoryHandle(p,{create:true});return d.getFileHandle(parts.at(-1),{create:true})}
async function shaFile(file){const h=new window.bo1zSHA256(),r=file.stream().getReader();try{for(;;){const x=await r.read();if(x.done)break;h.update(x.value)}}finally{r.releaseLock()}return h.hex()}
function record(e,f){try{localStorage.setItem(memKey(e),JSON.stringify({sha:e.sha256,size:e.size,time:f.lastModified}))}catch{}}
function resetRecord(e){try{localStorage.removeItem(memKey(e))}catch{}}
async function existsVerified(h,e){
const f=await h.getFile();if(f.size!==e.size)return false;
let memo=null;try{memo=JSON.parse(localStorage.getItem(memKey(e))||"null")}catch{}
if(memo&&memo.sha===e.sha256&&memo.size===e.size&&memo.time===f.lastModified)return true;
const actual=await shaFile(f);if(actual.toLowerCase()!==e.sha256.toLowerCase()){resetRecord(e);return false}record(e,f);return true;
}
async function append(h,bytes,position){
const out=await h.createWritable({keepExistingData:position!==0});
try{if(position===0)await out.truncate(0);await out.write({type:"write",position,data:bytes});await out.close()}
catch(e){try{await out.abort()}catch{}throw e}
}
async function shrink(h,length){const out=await h.createWritable({keepExistingData:true});try{await out.truncate(length);await out.close()}catch(e){try{await out.abort()}catch{}throw e}}

function partKey(e){return "bo1z-part-resume-v3:"+e.path}
function clearPart(e){try{localStorage.removeItem(partKey(e))}catch{}}
function resumePart(e,file){
 try{
  const s=JSON.parse(localStorage.getItem(partKey(e))||"null");
  if(s && s.sha===e.sha256 && s.count===e.br.length && s.size===file.size &&
    s.lastModified===file.lastModified && Number.isInteger(s.next) &&
    s.next>=0 && s.next<=Math.max(e.br.length,Math.ceil(e.size/CHUNK)))return s;
 }catch{}
 return null;
}
function markPart(e,next,file){
 try{localStorage.setItem(partKey(e),JSON.stringify({
  sha:e.sha256,count:e.br.length,next,size:file.size,lastModified:file.lastModified
 }))}catch{}
}
async function streamPart(h,e,i,offset,ctx){
 let last;
 for(let attempt=1;attempt<=(ctx.recovery?1:4);attempt++){
  if(ctx.cancelled?.())throw Error("Stahování pozastaveno");
  try{
   const url="/api/kino/chunk-stream?path="+encodeURIComponent(e.path)+"&part="+i;
   const r=await fetch(url,{cache:"no-store"});
   if(!r.ok)throw Error(e.path+" blok "+(i+1)+": HTTP "+r.status+" "+(await r.text()).slice(0,150));
   if(!r.body)throw Error("Odpověď bloku nepodporuje stream");
   const writer=await h.createWritable({keepExistingData:offset!==0});
   const reader=r.body.getReader();let bytes=0;
   try{
    if(offset===0)await writer.truncate(0);
    for(;;){
     if(ctx.cancelled?.())throw Error("Stahování pozastaveno");
     const {done,value}=await reader.read();if(done)break;
     bytes+=value.length;
     if(offset+bytes>e.size)throw Error("Blok překračuje velikost souboru v manifestu: "+e.path);
     await writer.write({type:"write",position:offset+bytes-value.length,data:value});
     ctx.progress(e,offset+bytes);
    }
    if(bytes===0)throw Error("Prázdný blok archivu");
    await writer.close();
   }catch(err){
    try{await reader.cancel()}catch{}
    try{await writer.abort()}catch{}
    throw err;
   }finally{reader.releaseLock()}
   return offset+bytes;
  }catch(e2){
   last=e2;
   if(ctx.cancelled?.())throw e2;
   if(attempt<4)await new Promise(done=>setTimeout(done,1000*attempt));
  }
 }
 throw last;
}
async function rawFile(h,e,ctx){
let last;for(let tries=1;tries<=3;tries++){
try{
 const r=await fetch("/api/kino/raw-stream?path="+encodeURIComponent(e.path),{cache:"no-store"});
 if(!r.ok)throw Error("Raw stream HTTP "+r.status+" "+(await r.text()).slice(0,100));
 if(!r.body)throw Error("iOS prohlížeč nepodporuje streamování");
 const reader=r.body.getReader(),writer=await h.createWritable();let bytes=0;
 try{await writer.truncate(0);
  for(;;){if(ctx.cancelled?.())throw Error("Stahování pozastaveno");const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>e.size)throw Error("Raw soubor je větší než manifest");await writer.write(value);ctx.progress(e,bytes)}
  await writer.close();
 }catch(err){try{await reader.cancel()}catch{}try{await writer.abort()}catch{}throw err}finally{reader.releaseLock()}
 if(bytes!==e.size)throw Error("Raw soubor je neúplný: "+bytes+" / "+e.size);return;
}catch(e){last=e;if(ctx.cancelled?.())throw e;if(tries<3)await new Promise(done=>setTimeout(done,tries*1000))}
}
throw last;
}
async function eachFile(root,e,ctx){
 const h=await target(root,e.path),before=await h.getFile();
 if(await existsVerified(h,e)){clearPart(e);ctx.completed(e,true);return}
 resetRecord(e);
 if(!e.br?.length){
  clearPart(e);
  await rawFile(h,e,ctx);
 }else{
  // The manifest's br count may omit an 8MiB tail on localized IWD archives.
  // Preserve complete parts and try CDN recovery before raw archive fallback.
  const state=resumePart(e,before);
  let offset=state?.size||0,next=state?.next||0;
  if(!state && before.size!==0)await shrink(h,0);
  if(offset>e.size || next>Math.max(e.br.length,Math.ceil(e.size/CHUNK))){
   offset=0;next=0;clearPart(e);await shrink(h,0);
  }
  ctx.progress(e,offset);
  for(let i=next;i<e.br.length && offset<e.size;i++){
   if(ctx.cancelled?.())throw Error("Stahování pozastaveno");
   offset=await streamPart(h,e,i,offset,ctx);
   markPart(e,i+1,await h.getFile());
  }
  if(offset<e.size){
   ctx.status("Manifest neobsahuje celý archiv "+e.path+
    ". Zkouším získat chybějících "+(e.size-offset)+" bajtů.");
   let tailError=null;
   const upper=Math.max(e.br.length,Math.ceil(e.size/CHUNK));
   const startPart=Math.max(next,e.br.length);
   for(let i=startPart;i<upper && offset<e.size;i++){
    try{
     offset=await streamPart(h,e,i,offset,{...ctx,recovery:true});
     markPart(e,i+1,await h.getFile());
    }catch(error){tailError=error;break}
   }
   if(offset<e.size){
    ctx.status("Z CDN dorazilo "+offset+"/"+e.size+
     " bajtů "+e.path+". Zkouším přímý archiv.");
    try{
     await rawFile(h,e,ctx);
     offset=(await h.getFile()).size;
     clearPart(e);
    }catch(error){
     throw Error("Zdroj neposkytuje celý archiv "+e.path+
      ": získáno "+offset+"/"+e.size+" bajtů. "+
      "Chybí "+(e.size-offset)+" bajtů. "+
      "Další blok: "+(tailError?.message||"není dostupný")+
      "; přímý archiv: "+error.message+
      ". Ostatní uložená data se nemažou.");
    }
   }
  }
 }
 const finished=await h.getFile();
 if(finished.size!==e.size)throw Error("Neúplný "+e.path+": "+finished.size+"/"+e.size);
 ctx.status("Ověřuji SHA-256: "+e.path);
 const digest=await shaFile(finished);
 if(digest.toLowerCase()!==e.sha256.toLowerCase()){
  resetRecord(e);clearPart(e);
  throw Error("SHA-256 nesouhlasí u "+e.path+"; archiv musí být stažen znovu");
 }
 clearPart(e);record(e,finished);ctx.completed(e,false);
}
async function downloadAll(ctx){
if(typeof window.bo1zSHA256!=="function")throw Error("Chybí streamovací SHA-256");
const res=await fetch("/api/kino/manifest",{cache:"no-store"});
if(!res.ok)throw Error("Manifest HTTP "+res.status);
const manifest=await res.json();
if(manifest.map!=="zombie_theater"||!Array.isArray(manifest.files)||!manifest.files.length||!manifest.files.every(valid))throw Error("Neplatný manifest herních dat");
const files=[...manifest.files].sort((a,b)=>{
 const priority=e=>/localized.*\.iwd$/i.test(e.path)?0:/\.iwd$/i.test(e.path)?1:/\.ff$/i.test(e.path)?2:3;
 return priority(a)-priority(b)||a.size-b.size;
});
const all=files.reduce((n,x)=>n+x.size,0);
const root=await (await navigator.storage.getDirectory()).getDirectoryHandle("pack-kino",{create:true});
try{await navigator.storage.persist?.()}catch{}
const quota=await navigator.storage.estimate?.();if(quota)ctx.log?.("STORAGE",fmt(quota.usage||0),"of",fmt(quota.quota||0));
ctx.log?.("FULL PACKAGE",files.length,"souborů",fmt(all));
let completed=0,skipped=0;
for(let i=0;i<files.length;i++){
 if(ctx.cancelled?.())throw Error("Stahování pozastaveno");
 const e=files[i];ctx.status("Soubor "+(i+1)+"/"+files.length+": "+e.path+" ("+fmt(e.size)+")");
 await eachFile(root,e,{
  cancelled:ctx.cancelled,
  status:ctx.status,
  progress:(f,n)=>ctx.progress?.({path:f.path,filesDone:i,filesTotal:files.length,done:completed+n,total:all,fileBytes:n,fileSize:f.size}),
  completed:(f,exists)=>{completed+=f.size;if(exists)skipped++;ctx.progress?.({path:f.path,filesDone:i+1,filesTotal:files.length,done:completed,total:all,fileBytes:f.size,fileSize:f.size})}
 });
}
ctx.log?.("FULL PACKAGE VERIFIED",files.length,"files",fmt(completed),"preexisting",skipped);
return {files:files.length,bytes:completed,reused:skipped};
}
window.bo1zDownloadAllKino=downloadAll;
})();