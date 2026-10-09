// Join transport-sized parts of the compiled Zombies engine.
(function () {
  let loading;
  window.KBZLoadEngine = () => loading ||= (async function () {
  try {
    Module.setStatus('Načítání enginu…');
    const parts = [];
    for (const name of ["blackops.wasm.001", "blackops.wasm.002", "blackops.wasm.003"]) {
      const response = await fetch(new URL(name, document.baseURI));
      if (!response.ok) throw new Error(name + ': HTTP ' + response.status);
      parts.push(new Uint8Array(await response.arrayBuffer()));
    }
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    Module.wasmBinary = bytes;
    const ready = new Promise((resolve, reject) => {
      const previous = Module.onRuntimeInitialized;
      Module.onRuntimeInitialized = () => { previous?.(); resolve(); };
      const abort = Module.onAbort;Module.onAbort = why => { abort?.(why);reject(new Error(String(why))); };
      window.__kbRuntimeReject = reject;
    });
    const script = document.createElement('script');
    script.src = new URL('blackops.js', document.baseURI).href;
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
