(function () {
  'use strict';
  let inFlight;
  const mib = n => Math.round(n / 1048576);
  async function hashFile(file) {
    const hash = new window.bo1zSHA256();
    const reader = file.stream().getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      hash.update(value);
    }
    return hash.hex();
  }
  async function download(fs, progress) {
    if (!navigator.storage?.getDirectory) throw new Error('Safari neposkytuje místní úložiště OPFS.');
    const response = await fetch(new URL('game/manifest.json', document.baseURI));
    if (!response.ok) throw new Error('Herní balíček na serveru ještě není připravený (HTTP ' + response.status + ').');
    const manifest = await response.json();
    if (manifest.map !== 'zombie_theater' || !Array.isArray(manifest.files)) throw new Error('Neplatný manifest Kino.');
    const storage = await navigator.storage.getDirectory();
    const directory = await storage.getDirectoryHandle('kino-' + manifest.version, { create: true });
    const total = manifest.files.reduce((n, file) => n + file.size, 0);
    let completed = 0;
    const indexed = new Map(), dirs = new Set();
    for (const entry of manifest.files) {
      if (entry.path.startsWith('/') || entry.path.split('/').some(p => p === '..' || p === '')) throw new Error('Neplatná cesta v manifestu.');
      const handle = await directory.getFileHandle(encodeURIComponent(entry.path), { create: true });
      let file = await handle.getFile();
      const valid = file.size === entry.size && await hashFile(file) === entry.sha256;
      if (!valid) {
        const url = new URL('game/' + entry.path.split('/').map(encodeURIComponent).join('/'), document.baseURI);
        const result = await fetch(url);
        if (!result.ok || !result.body) throw new Error(entry.path + ': HTTP ' + result.status);
        const writable = await handle.createWritable();
        const reader = result.body.getReader();
        const hash = new window.bo1zSHA256();
        let loaded = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            loaded += value.length;
            if (loaded > entry.size) throw new Error('Nesprávná velikost: ' + entry.path);
            hash.update(value);
            await writable.write(value);
            progress('Kino: ' + mib(completed + loaded) + ' / ' + mib(total) + ' MiB — ' + entry.path);
          }
          if (loaded !== entry.size || hash.hex() !== entry.sha256) throw new Error('Kontrola SHA-256 selhala: ' + entry.path);
          await writable.close();
        } catch (error) { await writable.abort().catch(() => {}); throw error; }
        file = await handle.getFile();
      }
      completed += entry.size;
      progress('Kino: ' + mib(completed) + ' / ' + mib(total) + ' MiB');
      const path = fs.norm(entry.path); indexed.set(path, file);
      const parts = path.split('/');for(let i=1;i<parts.length;i++) dirs.add(parts.slice(0,i).join('/'));
    }
    fs.index = indexed; fs.dirs = dirs; fs.rootName = 'kino'; fs.ready = true;
    return indexed.size;
  }
  window.KBZPack = {
    hashFile,
    open(fs, progress) {
      if (!inFlight) inFlight = download(fs, progress).catch(error => { inFlight = null; throw error; });
      return inFlight;
    }
  };
})();
