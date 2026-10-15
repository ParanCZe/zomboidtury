// Join transport-sized parts of the compiled Zombies engine.
(function () {
  let loading, runtimeScriptInjected = false;
  window.KBZLoadEngine = () => loading ||= (async function () {
  try {
    Module.setStatus('Načítání enginu…');
    const manifestResponse = await fetch(new URL('engine-manifest.json', document.baseURI), {cache:'no-store'});
    if (!manifestResponse.ok) throw new Error('Manifest enginu: HTTP '+manifestResponse.status);
    const build = await manifestResponse.json();
    if (!Number.isSafeInteger(build.wasmBytes) || build.wasmBytes <= 0 ||
        !/^[a-f0-9]{64}$/.test(build.wasmSha256) || !/^[a-f0-9]{64}$/.test(build.runtimeSha256))
      throw new Error('Neplatný manifest enginu. Obnov stránku.');
    KBZBootLog('Engine build: '+build.wasmSha256+'; JS '+build.runtimeSha256);
    const parts = [];
    for (const name of ["blackops.wasm.001", "blackops.wasm.002", "blackops.wasm.003"]) {
      const partURL = new URL(name, document.baseURI);
      partURL.searchParams.set('v',build.wasmSha256);
      const response = await fetch(partURL, {cache: "no-store"});
      if (!response.ok) throw new Error(name + ': HTTP ' + response.status);
      parts.push(new Uint8Array(await response.arrayBuffer()));
      KBZBootLog('Engine: načten '+name);
    }
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    const actualHash = Array.from(digest,n=>n.toString(16).padStart(2,'0')).join('');
    if (bytes.length !== build.wasmBytes || actualHash !== build.wasmSha256)
      throw new Error('SHA-256: integrita enginu nesouhlasí. Na serveru nebo v cache jsou různé verze; zkus načtení znovu.');
    Module.wasmBinary = bytes;
    KBZBootLog('WebAssembly: kompilace a přidělení 512 MiB paměti');
    const ready = new Promise((resolve, reject) => {
      const previous = Module.onRuntimeInitialized;
      Module.onRuntimeInitialized = () => { try { previous?.(); KBZBootLog('WebAssembly runtime inicializován'); resolve(); } catch (error) { reject(error); } };
      const abort = Module.onAbort;Module.onAbort = why => { abort?.(why);reject(new Error(String(why))); };
      window.__kbRuntimeReject = reject;
    });
    const script = document.createElement('script');
    const runtimeURL = new URL('blackops.js', document.baseURI);
    runtimeURL.searchParams.set('v',build.runtimeSha256);
    script.crossOrigin = 'anonymous';
    script.integrity = 'sha256-'+btoa(String.fromCharCode(...build.runtimeSha256.match(/../g).map(n=>parseInt(n,16))));
    script.src = runtimeURL.href;
    script.onerror = () => window.__kbRuntimeReject(new Error('JavaScript enginu nelze načíst nebo neodpovídá ověřenému buildu (integrita SHA-256). Obnov stránku.'));
    runtimeScriptInjected = true;
    document.body.append(script);
    // A failed platform/graphics initialization must not leave the button spinning
    // forever. Three minutes leaves room for slow initial Wasm compilation on iOS.
    let watchdog;
    try {
      await Promise.race([
        ready,
        new Promise((_, reject) => {
          watchdog = setTimeout(() => reject(new Error('WebAssembly se do 180 sekund neinicializovalo. Zkontroluj diagnostiku a obnov stránku.')), 180000);
        })
      ]);
    } finally {
      clearTimeout(watchdog);
    }
  } catch (error) {
    console.error(error);
    // A download failure is safe to retry; after the runtime script is injected,
    // retrying without reloading could initialize the engine twice.
    if (!runtimeScriptInjected) loading = null;
    else window.KBZEngineNeedsReload = true;
    Module.setStatus('Chyba načítání enginu: ' + error.message + (runtimeScriptInjected ? ' Obnov stránku před dalším pokusem.' : ' Stažení lze opakovat.'));
    throw error;
  }
  })();
})();
