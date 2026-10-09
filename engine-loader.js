// Join the two transport-sized parts of the unchanged compiled engine.
(async function () {
  try {
    Module.setStatus('Načítání enginu…');
    const parts = [];
    for (const name of ['blackops.wasm.001', 'blackops.wasm.002']) {
      const response = await fetch(new URL(name, document.baseURI));
      if (!response.ok) throw new Error(name + ': HTTP ' + response.status);
      parts.push(new Uint8Array(await response.arrayBuffer()));
    }
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    Module.wasmBinary = bytes;
    const script = document.createElement('script');
    script.src = new URL('blackops.js', document.baseURI).href;
    script.onerror = () => Module.setStatus('Nepodařilo se načíst blackops.js.');
    document.body.append(script);
  } catch (error) {
    console.error(error);
    Module.setStatus('Chyba načítání enginu: ' + error.message);
  }
})();
