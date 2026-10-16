/* BO1Z map menu. No download or engine init until the player clicks Start. */
(() => {
  'use strict';
  const html = document.documentElement;
  const host = document.getElementById('bo1z-menu');
  const pick = document.getElementById('pick');
  const status = document.getElementById('status');
  const home = document.getElementById('bm-home');
  const loading = document.getElementById('bm-loading');
  const progress = document.getElementById('bm-progress');
  if (!host || !pick || !status || !home || !loading || !progress) return;

  const defaults = {resolution:'960x540',fps:'30',textures:'standard',audio:'on'};
  const settings = {...defaults};
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('bo1z-menu-settings-v1') || 'null'); }
  catch (_) {}
  for (const key of Object.keys(defaults)) {
    const field = document.getElementById('bm-'+key);
    if (!field) continue;
    if (saved && [...field.options].some(item => item.value === saved[key]))
      settings[key] = saved[key];
    field.value = settings[key];
    field.addEventListener('change', () => {
      settings[key] = field.value;
      try { localStorage.setItem('bo1z-menu-settings-v1', JSON.stringify(settings)); }
      catch (_) {}
    });
  }
  function showPage(viewName) {
    host.querySelectorAll('[data-page]').forEach(view => {
      view.hidden = view.dataset.page !== viewName;
    });
    host.querySelectorAll('[data-view]').forEach(tab => {
      tab.setAttribute('aria-selected',String(tab.dataset.view === viewName));
    });
  }
  host.querySelectorAll('[data-view]').forEach(tab =>
    tab.addEventListener('click', () => showPage(tab.dataset.view)));
  document.getElementById('bm-back').addEventListener('click', () => showPage('maps'));
  host.querySelectorAll('.bm-map:not(:disabled)').forEach(map => {
    map.addEventListener('click', () => {
      host.querySelectorAll('.bm-map').forEach(item =>
        item.setAttribute('aria-pressed',String(item === map)));
    });
  });

  function applySettings() {
    const url = new URL(location.href);
    // Existing preRun consumes these URL parameters after starting Wasm.
    url.searchParams.set('rmode', settings.resolution);
    url.searchParams.set('fps', settings.fps);
    if (settings.textures === 'standard') url.searchParams.set('nohires','1');
    else url.searchParams.delete('nohires');
    if (settings.resolution === '640x360') url.searchParams.set('lowdetail','1');
    else url.searchParams.delete('lowdetail');
    if (settings.audio === 'off') url.searchParams.set('nosnd','1');
    else url.searchParams.delete('nosnd');
    history.replaceState(history.state,'',url.pathname+url.search+url.hash);
  }

  let launching = false;
  function launch() {
    if (launching) return;
    const map = host.querySelector('.bm-map[aria-pressed="true"]');
    if (!map || map.disabled || map.dataset.map !== 'zombie_theater') return;
    launching = true;
    applySettings();
    document.getElementById('bm-start').disabled = true;
    home.hidden = true;
    loading.hidden = false;
    html.classList.remove('menu-open');
    html.classList.add('game-loading');
    progress.textContent = 'Kontroluji soubory Kino der Toten…';
    // The existing one-shot handler owns download, SHA verification,
    // engine loading and execution in that order.
    pick.click();
  }
  function exposeEngine(showDiagnostics = true) {
    host.hidden = true;
    html.classList.remove('menu-open','game-loading');
    document.getElementById('boot-diagnostics').open = showDiagnostics;
    if (window.KBZBootLog && window.KBZBootLog.flush) window.KBZBootLog.flush();
  }
  document.getElementById('bm-start').addEventListener('click',launch);
  document.getElementById('bm-show').addEventListener('click',() => exposeEngine());
  document.getElementById('bm-cancel').addEventListener('click',() => location.reload());

  // Emscripten invokes this when the engine's frame loop starts. Do not leave
  // the full-screen download panel covering the canvas and touch controls.
  if (window.Module) {
    const previous = window.Module.postMainLoop;
    let revealed = false;
    window.Module.postMainLoop = () => {
      if (previous) previous();
      if (!launching || revealed) return;
      revealed = true;
      exposeEngine(false);
    };
  }

  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => {
      if (!loading.hidden && !host.hidden) {
        const message = status.textContent.trim();
        if (message) progress.textContent = message;
      }
    });
    observer.observe(status,{childList:true,characterData:true,subtree:true});
  }
  window.BO1ZMenu = {launch, applySettings, exposeEngine};
})();
