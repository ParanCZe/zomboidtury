// Regression checks for the deployed browser shell. These are NOT gameplay tests.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const vm = require('node:vm');

test('all browser scripts and inline launch scripts parse', () => {
  for (const filename of ['blackops.js','engine-loader.js','kino-pack.js','sha256-stream.js','mobile-keys.js','mobile-ui.js','bo1z-menu.js','web_fs.js','coi-serviceworker.js']) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(filename, 'utf8'), {filename}));
  }
  const html = fs.readFileSync('index.html', 'utf8');
  let inline = 0;
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    if (!match[1].trim()) continue;
    inline++;
    assert.doesNotThrow(() => new vm.Script(match[1], {filename: 'index.html inline #' + inline}));
  }
  assert.ok(inline >= 5, 'Expected launch scripts in index.html');
  for (const name of ['blackops.js','web_fs.js','sha256-stream.js','kino-pack.js','engine-loader.js','mobile-keys.js','mobile-ui.js','mobile.css','bo1z-menu.js','bo1z-menu.css','coi-serviceworker.js'])
    assert.ok(fs.existsSync(name), 'Missing browser dependency: ' + name);
});

test('published Wasm segments match pinned engine and required exports', () => {
  const meta = JSON.parse(fs.readFileSync('ENGINE_BUILD.json'));
  const parts = ['blackops.wasm.001','blackops.wasm.002','blackops.wasm.003'].map(name => fs.readFileSync(name));
  const binary = Buffer.concat(parts);
  assert.equal(binary.length, meta.wasmBytes, 'Published engine length is inconsistent');
  assert.equal(crypto.createHash('sha256').update(binary).digest('hex'), meta.wasmSha256, 'Published engine is not the pinned build');
  assert.equal(WebAssembly.validate(binary), true, 'Published engine is invalid WebAssembly');
  const names = new Set(WebAssembly.Module.exports(new WebAssembly.Module(binary)).map(x => x.name));
  for (const name of ['__main_argc_argv','KBMobile_Reset','KBMobile_Enable','KBMobile_Key','KBMobile_Look','KBMobile_Pointer','asyncify_start_unwind','asyncify_stop_unwind'])
    assert.ok(names.has(name), 'Missing required engine export: ' + name);
});

test('game data manifest is internally consistent, case-insensitive and path-safe', () => {
  const manifest = JSON.parse(fs.readFileSync('kino-manifest.json', 'utf8'));
  assert.equal(manifest.map, 'zombie_theater');
  assert.ok(Array.isArray(manifest.files) && manifest.files.length >= 30);
  const paths = new Set();
  let bytes = 0;
  for (const entry of manifest.files) {
    assert.match(entry.path, /^[a-zA-Z0-9_./-]+$/);
    assert.ok(!entry.path.startsWith('/') && !entry.path.split('/').includes('..'));
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(entry.size) && entry.size > 0);
    assert.ok(!paths.has(entry.path.toLowerCase()), 'Duplicate normalized filename: ' + entry.path);
    paths.add(entry.path.toLowerCase());
    bytes += entry.size;
  }
  // The manifest also describes optional video streams not present in files[].
  // Do not confuse the complete manifest budget with the core game pack.
  assert.ok(bytes <= manifest.total_bytes, 'Core game pack exceeds total declared content');
  const backgroundBytes = manifest.files.filter(f => f.class === 'background').reduce((n,f) => n + f.size,0);
  assert.equal(backgroundBytes, manifest.class_bytes.background, 'Background file class mismatch');
  assert.ok(paths.has('zone/common/code_post_gfx.ff'), 'Required render fastfile absent');
  assert.ok(paths.has('main/localized_english_iw04.iwd'), 'Required localized archive absent');
});

test('KBFS resolves Windows paths and cached OPFS Blob byte ranges', async () => {
  const context = {Module: {}, window: {}, console};
  context.window.Module = context.Module;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('web_fs.js','utf8'), context);
  const bridge = context.Module.KBFS;
  bridge.index.set('main/iw_00.iwd', new Blob([Uint8Array.from([4,5,6,7,8,9])]));
  bridge.dirs.add('main');
  const id = await bridge.open('C:\\Games\\BlackOps\\main\\IW_00.IWD');
  assert.ok(id > 0);
  assert.equal(await bridge.size(id), 6);
  assert.equal(bridge.preadCached(id, 1, 3), null);
  assert.deepEqual(Array.from(await bridge.pread(id, 1, 3)), [5,6,7]);
  assert.deepEqual(Array.from(bridge.preadCached(id, 2, 3)), [6,7,8]);
  assert.deepEqual(Array.from(bridge.listDir('main','iwd',null,false)), ['iw_00.iwd']);
  const diag = bridge.snapshot();
  assert.equal(diag.openedArchives,1);
  assert.equal(diag.readCalls,1);
  assert.equal(diag.cachedReads,1);
  assert.ok(diag.dirListings >= 1);
  assert.match(diag.lastOp, /listDir/);
  bridge.close(id);
  assert.equal(await bridge.size(id), -1);
});

test('loader retries a partial network failure, then loads the complete Wasm only once', async () => {
  const source = fs.readFileSync('engine-loader.js', 'utf8');
  let failPart = true, appended = 0, requests = [];
  const moduleObject = {setStatus: () => {}, onRuntimeInitialized: null};
  const context = {window: {}, Module: moduleObject, Uint8Array, URL, console, setTimeout, clearTimeout,
    KBZBootLog: () => {},
    document: {
      baseURI:'https://test.invalid/zomboidtury/',
      createElement:()=>({}),
      body:{append:() => {appended++; queueMicrotask(() => moduleObject.onRuntimeInitialized?.());}}
    },
    fetch:async url => {
      const name = url.pathname.split('/').pop();
      requests.push(name);
      if (name === 'blackops.wasm.002' && failPart) return {ok:false,status:503};
      return {ok:true,arrayBuffer:async() => Uint8Array.of(name.endsWith('001')?1:name.endsWith('002')?2:3).buffer};
    }
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  await assert.rejects(context.window.KBZLoadEngine(), /HTTP 503/);
  failPart = false;
  await context.window.KBZLoadEngine();
  assert.deepEqual(Array.from(moduleObject.wasmBinary),[1,2,3]);
  assert.equal(appended,1,'Never inject the runtime script twice');
  await context.window.KBZLoadEngine();
  assert.equal(appended,1,'Never initialize the runtime twice');
  assert.equal(requests.filter(name => name === 'blackops.wasm.001').length,2);
});

test('BO1Z menu opens before download and offers only installed maps', () => {
  const html = fs.readFileSync('index.html','utf8');
  const menu = fs.readFileSync('bo1z-menu.js','utf8');
  assert.match(html, /class="menu-open"/, 'First paint must be the menu, not a game download');
  assert.match(html, /id="bo1z-menu"/);
  assert.match(html, /id="bm-start"/);
  assert.match(html, /data-map="zombie_theater"/);
  assert.match(html, /data-map="zombie_pentagon"[^>]*disabled/);
  assert.match(html, /data-map="zombie_cosmodrome"[^>]*disabled/);
  assert.ok(html.indexOf('id="bo1z-menu"') < html.indexOf('id="kberr"'), 'Menu should render before the engine');
  assert.match(html, /src="bo1z-menu.js\?v=/);
  assert.match(menu, /pick\.click\(\)/, 'Only the Start button can enter the existing engine loader');
  assert.doesNotMatch(menu, /\bfetch\s*\(/, 'Menu must never fetch game data just by opening the page');
  assert.match(menu, /searchParams\.set\('rmode'/, 'Video settings must be passed to preRun');
  assert.match(menu, /searchParams\.set\('fps'/, 'FPS must be passed to preRun');
});
