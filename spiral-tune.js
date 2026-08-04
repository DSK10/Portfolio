/* =====================================================================
   Spiral layout tuner — dev only.

   Loaded exclusively by spiral.js when the URL carries ?tune=1, so the
   shipped portfolio never downloads or runs a byte of this. It cannot
   live on a separate page the way the model tuner does, because it needs
   the real content at its real size — that IS the thing being tuned.

   Global sliders drive CFG. Per-window nudges are keyed by title, so they
   survive a rebuild even if station indices shift. "Copy config" emits
   JSON to paste back into spiral.js.
   ===================================================================== */
(function () {
  const S = window.__spiral;
  if (!S) return console.warn('[tune] spiral not initialised');

  const { CFG, stations } = S;
  const LS = 'spiralTune';

  // restore a previous session so a browser reload doesn't lose the work
  try {
    const saved = JSON.parse(localStorage.getItem(LS) || 'null');
    if (saved) Object.assign(CFG, saved, { overrides: saved.overrides || {} });
  } catch (e) { /* corrupt entry — ignore and start clean */ }

  const GLOBALS = [
    ['RADIUS',  400, 1800, 10,   'orbit radius'],
    ['AXIS_Z', -2000,  200, 10,  'axis depth'],
    ['A_STEP',    5,   90,  1,   'degrees / station'],
    ['Y_STEP',  100, 1200, 10,   'vertical drop'],
    ['VH_PER',  150, 1200, 10,   'scroll per station'],
    ['VIS_DEG',  10,   90,  1,   'visible cone'],
    ['MAX_H',   0.3,  1.6, 0.02, 'split threshold *'],
    ['FIT_CAP', 0.5,  1.2, 0.02, 'scale ceiling'],
    ['FIT_MIN', 0.4,    1, 0.02, 'scale floor']
  ];

  const PER = [
    ['dx',    -800, 800, 5, 0],
    ['dy',    -800, 800, 5, 0],
    ['dz',    -800, 800, 5, 0],
    ['rot',    -60,  60, 1, 0],
    ['scale',  0.4, 1.6, 0.02, 1]
  ];

  const css = `
  #sptune{position:fixed;top:0;right:0;bottom:0;width:310px;z-index:9999;
    background:#0b0b12f2;backdrop-filter:blur(14px);border-left:1px solid #2a2a3a;
    font:11px/1.5 ui-monospace,Menlo,monospace;color:#cfd0dd;
    overflow-y:auto;padding:12px 14px 40px;}
  #sptune h4{margin:14px 0 6px;font-size:10px;letter-spacing:.12em;
    text-transform:uppercase;color:#7c6fff}
  #sptune .row{display:grid;grid-template-columns:74px 1fr 46px;gap:6px;
    align-items:center;margin:3px 0}
  #sptune label{color:#9a9bb0;overflow:hidden;text-overflow:ellipsis}
  #sptune input[type=range]{width:100%;accent-color:#7c6fff}
  #sptune output{text-align:right;color:#37e6a7}
  #sptune select,#sptune button{width:100%;padding:6px;margin:4px 0;
    background:#16161f;color:#cfd0dd;border:1px solid #2f2f42;border-radius:5px;
    font:inherit;cursor:pointer}
  #sptune button:hover{border-color:#7c6fff}
  #sptune .note{color:#6b6c80;margin:6px 0}
  #sptune .hd{display:flex;justify-content:space-between;align-items:center}
  #sptune .x{width:auto;padding:2px 8px;margin:0}`;
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));

  const panel = document.createElement('div');
  panel.id = 'sptune';
  document.body.appendChild(panel);

  /* MAX_H changes how content is split, which can only happen at build
     time — so it needs a reload rather than a live re-layout. */
  const needsReload = new Set(['MAX_H']);
  let dirtyBuild = false;

  const slider = (key, min, max, step, get, set, hint) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<label title="${hint || key}">${key}</label>
      <input type="range" min="${min}" max="${max}" step="${step}">
      <output></output>`;
    const inp = row.querySelector('input'), out = row.querySelector('output');
    const sync = () => { inp.value = get(); out.textContent = (+get()).toFixed(step < 1 ? 2 : 0); };
    inp.addEventListener('input', () => {
      set(parseFloat(inp.value));
      out.textContent = (+inp.value).toFixed(step < 1 ? 2 : 0);
      if (needsReload.has(key)) { dirtyBuild = true; reloadBtn.style.borderColor = '#ff7a6b'; }
      else S.apply();
      persist();
    });
    sync();
    return { row, sync };
  };

  const persist = () => { try { localStorage.setItem(LS, JSON.stringify(CFG)); } catch (e) {} };

  // ---- global section ----
  const h1 = document.createElement('div');
  h1.className = 'hd';
  h1.innerHTML = '<h4>spiral layout</h4>';
  panel.appendChild(h1);

  const syncers = [];
  GLOBALS.forEach(([k, min, max, step, hint]) => {
    const s = slider(k, min, max, step, () => CFG[k], v => CFG[k] = v, hint);
    panel.appendChild(s.row); syncers.push(s.sync);
  });

  const reloadBtn = document.createElement('button');
  reloadBtn.textContent = '↻ reload (apply split threshold)';
  reloadBtn.onclick = () => location.reload();
  panel.appendChild(reloadBtn);
  panel.insertAdjacentHTML('beforeend',
    '<div class="note">* split threshold only takes effect on reload — it changes how content is chunked.</div>');

  // ---- per-window section ----
  panel.insertAdjacentHTML('beforeend', '<h4>this window</h4>');

  const pick = document.createElement('select');
  stations.forEach((s, i) => pick.appendChild(
    Object.assign(document.createElement('option'), { value: i, textContent: String(i + 1).padStart(2, '0') + '  ' + s.title })));
  panel.appendChild(pick);

  const jump = document.createElement('button');
  jump.textContent = '→ scroll to this window';
  jump.onclick = () => S.goto(+pick.value);
  panel.appendChild(jump);

  const ovr = () => {
    const t = stations[+pick.value].title;
    return CFG.overrides[t] || (CFG.overrides[t] = {});
  };

  const perSync = [];
  PER.forEach(([k, min, max, step, dflt]) => {
    const s = slider(k, min, max, step,
      () => (ovr()[k] !== undefined ? ovr()[k] : dflt),
      v => { ovr()[k] = v; });
    panel.appendChild(s.row); perSync.push(s.sync);
  });

  // keep the per-window sliders showing the selected window's values
  pick.addEventListener('change', () => { perSync.forEach(f => f()); S.goto(+pick.value); });

  const clear = document.createElement('button');
  clear.textContent = '⌫ reset this window';
  clear.onclick = () => {
    delete CFG.overrides[stations[+pick.value].title];
    perSync.forEach(f => f()); S.apply(); persist();
  };
  panel.appendChild(clear);

  // follow the scroll position so the dropdown tracks what's on screen
  addEventListener('scroll', () => {
    let best = 0, bo = -1;
    stations.forEach((s, i) => { const o = +s.el.style.opacity; if (o > bo) { bo = o; best = i; } });
    if (+pick.value !== best) { pick.value = best; perSync.forEach(f => f()); }
  }, { passive: true });

  // ---- export ----
  panel.insertAdjacentHTML('beforeend', '<h4>export</h4>');

  const out = document.createElement('button');
  out.textContent = '⧉ copy config JSON';
  out.onclick = async () => {
    // drop no-op overrides so the exported config stays readable
    const clean = {};
    for (const [k, v] of Object.entries(CFG.overrides)) {
      const keep = Object.entries(v).filter(([kk, vv]) =>
        !(kk === 'scale' ? vv === 1 : vv === 0));
      if (keep.length) clean[k] = Object.fromEntries(keep);
    }
    const json = JSON.stringify({ ...CFG, overrides: clean }, null, 2);
    try { await navigator.clipboard.writeText(json); out.textContent = '✓ copied — paste it to Claude'; }
    catch (e) { console.log(json); out.textContent = '✓ logged to console'; }
    setTimeout(() => out.textContent = '⧉ copy config JSON', 2600);
  };
  panel.appendChild(out);

  const wipe = document.createElement('button');
  wipe.textContent = '⌫ reset everything';
  wipe.onclick = () => { localStorage.removeItem(LS); location.reload(); };
  panel.appendChild(wipe);

  panel.insertAdjacentHTML('beforeend',
    '<div class="note">Changes are saved in this browser as you drag, so a reload keeps them. Hit copy when it looks right.</div>');

  console.log('[tune] ready —', stations.length, 'windows');
})();
