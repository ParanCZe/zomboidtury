// Join transport-sized parts of the compiled Zombies engine.
(function () {
  let loading;
  window.KBZLoadEngine = () => loading ||= (async function () {
  try {
    Module.setStatus('Načítání enginu…');
    const parts = [];
    for (const name of ["blackops.wasm.001", "blackops.wasm.002", "blackops.wasm.003"]) {
      const response = await fetch(new URL(name, document.baseURI), {cache: "no-store"});
      if (!response.ok) throw new Error(name + ': HTTP ' + response.status);
      parts.push(new Uint8Array(await response.arrayBuffer()));
      KBZBootLog('Engine: načten '+name);
    }
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    Module.wasmBinary = bytes;
    KBZBootLog('WebAssembly: kompilace a přidělení 512 MiB paměti');
    const ready = new Promise((resolve, reject) => {
      const previous = Module.onRuntimeInitialized;
      Module.onRuntimeInitialized = () => { try { previous?.(); KBZBootLog('WebAssembly runtime inicializován'); resolve(); } catch (error) { reject(error); } };
      const abort = Module.onAbort;Module.onAbort = why => { abort?.(why);reject(new Error(String(why))); };
      window.__kbRuntimeReject = reject;
    });
    const script = document.createElement('script');
    script.src = new URL('blackops.js?v=fiber-yield-1', document.baseURI).href;
    script.onerror = () => window.__kbRuntimeReject(new Error('Nepodařilo se načíst blackops.js.'));
    document.body.append(script);
    await ready;
  } catch (error) {
    console.error(error);
    Module.setStatus('Chyba načítání enginu: ' + error.message);
    throw error;
  }
  })();
})();
