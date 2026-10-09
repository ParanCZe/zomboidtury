const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
function setup({corrupt=false, missing=false}={}) {
  const data=Buffer.from('Kino fixture data');
  const entry={path:'zone/Common/test.ff',size:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};
  const records=new Map();let fetches=0,aborts=0;
  const directory={getFileHandle:async name=>{
    if(!records.has(name))records.set(name,new Blob([]));
    return {getFile:async()=>records.get(name),createWritable:async()=>{
      const parts=[];return {write:async part=>parts.push(part),close:async()=>records.set(name,new Blob(parts)),abort:async()=>{aborts++;}};
    }};
  }};
  const context={window:{},navigator:{storage:{getDirectory:async()=>({getDirectoryHandle:async()=>directory})}},document:{baseURI:'https://test.invalid/zomboidtury/'},URL,Uint8Array,Uint32Array,DataView,Map,Set,console,
    fetch:async url=>{
      if(url.pathname.endsWith('/manifest.json'))return {ok:!missing,status:missing?404:200,json:async()=>({map:'zombie_theater',version:'test',files:[entry]})};
      fetches++;const b=Buffer.from(data);if(corrupt)b[0]^=1;return {ok:true,body:new Blob([b]).stream()};
    }
  };
  vm.createContext(context);vm.runInContext(fs.readFileSync('sha256-stream.js','utf8'),context);vm.runInContext(fs.readFileSync('kino-pack.js','utf8'),context);
  const bridge={norm:s=>s.toLowerCase(),ready:false,index:new Map(),dirs:new Set()};
  return {context,bridge,records,entry,data,get fetches(){return fetches;},get aborts(){return aborts;}};
}
(async()=>{
  const ok=setup();const count=await ok.context.window.KBZPack.open(ok.bridge,()=>{});assert.equal(count,1);assert.equal(ok.bridge.ready,true);assert.equal(ok.fetches,1);assert(ok.bridge.dirs.has('zone/common'));
  const file=ok.bridge.index.get('zone/common/test.ff');assert(Buffer.from(await file.arrayBuffer()).equals(ok.data));
  // Reuse the validated File snapshot without fetching again.
  await ok.context.window.KBZPack.open(ok.bridge,()=>{});assert.equal(ok.fetches,1);
  const bad=setup({corrupt:true});await assert.rejects(bad.context.window.KBZPack.open(bad.bridge,()=>{}),/SHA-256/);assert.equal(bad.bridge.ready,false);assert.equal(bad.aborts,1);
  const missing=setup({missing:true});await assert.rejects(missing.context.window.KBZPack.open(missing.bridge,()=>{}),/HTTP 404/);assert.equal(missing.fetches,0);
  const sha=new ok.context.window.bo1zSHA256();for(let i=0;i<1000;i++)sha.update(Uint8Array.of(i%256));assert.equal(sha.hex(),crypto.createHash('sha256').update(Buffer.from(Array.from({length:1000},(_,i)=>i%256))).digest('hex'));
  console.log('Kino pack streaming, SHA-256, abort and missing-data handling: PASS');
})();
