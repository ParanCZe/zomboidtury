// Bind the generated JS glue and Wasm from this deployment, never a browser's
// previously cached runtime. Run before browser tests and Pages assembly.
'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const pinned=JSON.parse(fs.readFileSync('ENGINE_BUILD.json','utf8'));
const bytes=Buffer.concat(['001','002','003'].map(n=>fs.readFileSync('blackops.wasm.'+n)));
if(bytes.length!==pinned.wasmBytes || hash(bytes)!==pinned.wasmSha256)
  throw new Error('Published engine does not match ENGINE_BUILD.json');
const manifest={wasmBytes:bytes.length,wasmSha256:hash(bytes),runtimeSha256:hash(fs.readFileSync('blackops.js'))};
fs.writeFileSync('engine-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log('Verified JS/Wasm deployment manifest:',manifest.wasmSha256);
