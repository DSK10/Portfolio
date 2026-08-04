/* =====================================================================
   Model tuner — open the site with  ?tune=1
   Adjust the spine + brain live, then hit "Copy config" and paste the
   JSON back to Claude to have the values baked in as defaults.
   Not loaded on a normal visit.
   ===================================================================== */
(function () {
  // Only ever runs on the dedicated tuner page (or with ?tune=1 for a quick
  // check). The portfolio does not load this file at all.
  const ON = /tuner\.html$/.test(location.pathname) || /[?&]tune=1/.test(location.search);
  if (!ON) return;

  const FIELDS = [
    ['— Camera —'],
    ['camFov',        'Field of view',    5,   45,  0.5],
    ['camZ',          'Camera distance',  8,   90,  0.5],
    ['— Spine —'],
    ['spineHeight',   'Column height',    10,  160, 1],
    ['spineX',        'Horizontal offset',-12, 12,  0.1],
    ['startY',        'Start (skull)',   -70,  20,  0.5],
    ['travel',        'Travel to sacrum', 0,   160, 1],
    ['spinDeg',       'Total spin °',     0,   1400, 5],
    ['spineOpacity',  'Bone brightness',  0,   1.5, 0.01],
    ['canvasOpacity', 'Layer opacity',    0,   1,   0.01],
    ['veinStrength',  'Veins / sparks',   0,   2,   0.01],
    ['bgBlur',        'Background blur',  0,   14,  0.5],
    ['— Brain: fit —'],
    ['brainFit',      'Fit in skull',     0.2, 1.2, 0.01],
    ['brainSize',     'Particle size',    0.01,0.6, 0.005],
    ['brainOpacity',  'Brightness',       0,   1,   0.01],
    ['— Brain: move —'],
    ['brainXOff',     'Move X',          -0.8, 0.8, 0.01],
    ['brainYOff',     'Move Y',          -0.8, 0.8, 0.01],
    ['brainZOff',     'Move Z',          -0.8, 0.8, 0.01],
    ['— Brain: rotate —'],
    ['brainRotX',     'Rotate X °',      -180, 180, 1],
    ['brainRotY',     'Rotate Y °',      -180, 180, 1],
    ['brainRotZ',     'Rotate Z °',      -180, 180, 1],
    ['— Brain: motion (0 = locked to skull) —'],
    ['brainSpin',     'Idle drift speed', 0,   0.8, 0.01],
    ['brainCounter',  'Counter-rotation', 0,   1.5, 0.01],
    ['brainPulse',    'Pulse amount',     0,   0.8, 0.01]
  ];

  const wait = setInterval(() => {
    if (!window.__spine) return;
    clearInterval(wait);
    build(window.__spine);
  }, 250);

  function build(API) {
    const box = document.createElement('div');
    box.id = 'tuner';
    box.innerHTML = `
      <header>
        <strong>Model tuner</strong>
        <button data-a="hide" title="Collapse">–</button>
      </header>
      <div class="tn-body"></div>
      <footer>
        <button data-a="copy" class="tn-primary">Copy config</button>
        <button data-a="reset">Reset</button>
        <span class="tn-msg"></span>
      </footer>`;
    document.body.appendChild(box);

    const body = box.querySelector('.tn-body');
    const msg  = box.querySelector('.tn-msg');

    FIELDS.forEach(f => {
      if (f.length === 1) {
        const h = document.createElement('div');
        h.className = 'tn-head'; h.textContent = f[0];
        body.appendChild(h); return;
      }
      const [key, label, min, max, step] = f;
      const row = document.createElement('label');
      row.className = 'tn-row';
      row.innerHTML = `
        <span class="tn-label">${label}</span>
        <input type="range" min="${min}" max="${max}" step="${step}" value="${API.cfg[key]}">
        <input type="number" min="${min}" max="${max}" step="${step}" value="${API.cfg[key]}" class="tn-num">`;
      const [range, num] = row.querySelectorAll('input');
      const set = v => {
        v = parseFloat(v);
        if (Number.isNaN(v)) return;
        range.value = num.value = v;
        API.apply(key, v);
        API.save();
      };
      range.addEventListener('input', e => set(e.target.value));
      num.addEventListener('input',   e => set(e.target.value));
      body.appendChild(row);
    });

    box.addEventListener('click', e => {
      const a = e.target.dataset.a;
      if (a === 'hide') { box.classList.toggle('tn-min'); e.target.textContent = box.classList.contains('tn-min') ? '+' : '–'; }
      if (a === 'reset') API.reset();
      if (a === 'copy') {
        const json = JSON.stringify(API.cfg, null, 2);
        navigator.clipboard.writeText(json)
          .then(() => { msg.textContent = 'copied — paste to Claude'; setTimeout(() => msg.textContent = '', 2600); })
          .catch(() => { console.log(json); msg.textContent = 'see console'; });
      }
    });

    const css = document.createElement('style');
    css.textContent = `
      #tuner{position:fixed;top:76px;right:16px;z-index:9999;width:290px;
        font:12px/1.5 ui-monospace,monospace;color:#e8e7f0;
        background:rgba(10,10,16,.94);backdrop-filter:blur(14px);
        border:1px solid rgba(255,255,255,.16);border-radius:12px;
        box-shadow:0 24px 70px rgba(0,0,0,.6);overflow:hidden}
      #tuner header{display:flex;align-items:center;justify-content:space-between;
        padding:.55rem .7rem;background:rgba(255,255,255,.05);
        border-bottom:1px solid rgba(255,255,255,.1)}
      #tuner header strong{font-size:11px;letter-spacing:.08em;text-transform:uppercase}
      #tuner button{background:rgba(255,255,255,.08);color:inherit;font:inherit;
        border:1px solid rgba(255,255,255,.16);border-radius:6px;padding:.25rem .55rem;cursor:pointer}
      #tuner button:hover{background:rgba(255,255,255,.16)}
      #tuner .tn-primary{background:#5a49e0;border-color:#7c6fff}
      #tuner .tn-body{max-height:60vh;overflow:auto;padding:.5rem .7rem}
      #tuner.tn-min .tn-body,#tuner.tn-min footer{display:none}
      #tuner .tn-head{margin:.6rem 0 .3rem;color:#37e6a7;font-size:10px;letter-spacing:.1em}
      #tuner .tn-row{display:grid;grid-template-columns:1fr;gap:.15rem;margin-bottom:.45rem}
      #tuner .tn-label{color:#a3a1b5;font-size:11px}
      #tuner .tn-row input[type=range]{width:100%;accent-color:#7c6fff}
      #tuner .tn-num{width:100%;background:rgba(255,255,255,.06);color:#fff;
        border:1px solid rgba(255,255,255,.14);border-radius:5px;padding:.2rem .35rem;font:inherit}
      #tuner footer{display:flex;gap:.4rem;align-items:center;padding:.55rem .7rem;
        border-top:1px solid rgba(255,255,255,.1)}
      #tuner .tn-msg{color:#37e6a7;font-size:10px}`;
    document.head.appendChild(css);

    console.info('[tuner] ready — adjust, then "Copy config"');
  }
})();
