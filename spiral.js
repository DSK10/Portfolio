/* =====================================================================
   Spiral navigation — cards become stations in 3D space.

   Every station sits on a helix around the central axis (where the
   holographic spine renders). Scrolling flies the camera down that helix,
   rotating to face each station in turn.

   Falls back to plain document flow on narrow screens, when the user asks
   for reduced motion, or if anything here fails — the page must stay
   readable first.
   ===================================================================== */
(function () {
  const MOBILE = matchMedia('(max-width: 900px)').matches;
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (MOBILE || REDUCED) return;

  /* Group-level containers, not individual cards — the three flagship cards
     belong in one window together. Anything that genuinely doesn't fit is
     split automatically further down, which keeps siblings adjacent. */
  const STATION_SEL = [
    '.hero-text',
    '.flagship-grid',
    '.about-left', '.about-right',
    '.exp-item',
    '.skills-grid',
    '.projects-grid',
    '.demo-block',
    '.life-group',
    '.contact-inner'
  ].join(',');

  /* Layout config, in one object so the tuner overlay can drive it live.
     The tuner only loads with ?tune=1 — the portfolio never ships it. */
  const CFG = {
    RADIUS:  980,    // orbit radius — wider so a tighter angle still clears
    AXIS_Z:  -820,   // axis pushed away; we watch content orbit the spine
    A_STEP:  30,     // degrees between stations
    Y_STEP:  470,    // vertical drop — spaces them despite the tight angle
    VH_PER:  430,    // scroll distance that advances one station
    VIS_DEG: 37,     // fade out beyond this angle from front
    MAX_H:   0.66,   // a station may occupy this fraction of the viewport
    FIT_CAP: 0.84,   // hard ceiling before a window is scaled down
    FIT_MIN: 0.66,   // never scale below this — legibility floor

    /* Hand-tuned per-window nudges (?tune=1 → copy config JSON).
       Keyed by title rather than index so they survive a rebuild. */
    overrides: {
      '~/hi-imdeepesh-singh':           { scale: 0.84 },
      '~/enterprise-ai-copilot':        { dx:  80, dy:   80, scale: 0.80 },
      '~/about-left':                   { dy: -35 },
      '~/about-left-2':                 { dx: -145, dy: 100 },
      '~/about-right':                  { dx:  10, dy:  -85 },
      '~/exp-item':                     { dx: -145 },
      '~/exp-item-2':                   { dx: -195, dy: -115, scale: 0.84 },
      '~/exp-item-3':                   { dx: -165, dy: -115, scale: 0.78 },
      '~/skyrath-pvt-ltd':              { scale: 0.78 },
      '~/omdena-google-partnered-open-s':{ scale: 0.74 },
      '~/freelancing':                  { dx: -105, dy: 20, scale: 0.86 },
      '~/projects-grid':                { scale: 0.74 },
      '~/projects-grid-2':              { scale: 0.76 },
      '~/projects-grid-3':              { scale: 0.68 },
      '~/projects-grid-4':              { scale: 0.80 },
      '~/projects-grid-5':              { dy: -85, scale: 0.76 },
      '~/projects-grid-6':              { dx: -85, dy: -75 },
      '~/projects-grid-7':              { scale: 0.76 },
      '~/projects-grid-12':             { scale: 0.70 },
      '~/lets-buildsomething-together': { scale: 0.70 }
    }
  };

  /* Below this rendered height a window is a stub — a heading with its body
     collapsed — and is dropped rather than shown empty. */
  const STUB_H = 230;

  /* Content that must never be divided, however tall — these read as one
     unit and splitting them was the thing that looked broken. They get
     scaled to fit instead. */
  const NO_SPLIT = '.hero-text, .flagship-grid';

  /* Lifted out of the window body into a tab strip along the bottom. */
  const TAB_SEL = '.hero-actions-secondary';

  let stations = [], world = null, viewport = null, spacer = null;
  let svg = null, threadPath = null, threadGhost = null, threadHead = null;
  let cam = { a: 0, y: 0 }, target = { a: 0, y: 0 };
  let raf = null, lastFrame = 0, fitAll = null;

  /* Build in three passes:
       1. lift every candidate into a station inside the 3D world
       2. measure THERE (the station width differs from page flow, so
          measuring before the move gives the wrong height)
       3. split anything still too tall, then lay the final set out on the helix
  */
  function build() {
    const nodes = [...document.querySelectorAll(STATION_SEL)];
    if (nodes.length < 5) return false;

    viewport = document.createElement('div');
    viewport.className = 'sp-viewport';
    world = document.createElement('div');
    world.className = 'sp-world';
    viewport.appendChild(world);
    document.body.appendChild(viewport);

    /* Switch the spiral styles on BEFORE anything is measured. Window padding,
       the tab strip and the forced-open accordions all change height, so
       measuring first and styling afterwards sizes every window against a
       layout that never actually renders. */
    document.documentElement.classList.add('sp-on');

    const mk = content => {
      const st = document.createElement('div');
      st.className = 'sp-station';
      world.appendChild(st);
      st.appendChild(content);
      return st;
    };

    let cells = nodes.map(mk);

    // --- pass 2/3: split what doesn't fit, now that widths are real ---
    const limit = innerHeight * CFG.MAX_H;

    /* Heights must all be read BEFORE any mutation. The moment a node is moved
       into a detached clone it has no layout, so measuring lazily mid-split
       returns 0 and everything collapses into one chunk. */
    const H = new Map();
    const measure = el => {
      H.set(el, el.offsetHeight || 0);
      for (const k of el.children) measure(k);
    };
    cells.forEach(st => { const c = st.firstElementChild; if (c) measure(c); });
    const hOf = el => H.get(el) || 0;

    /* Divide `el` into shallow clones that each fit `limit`, recursing through
       wrappers so a single dominating child (an accordion inside .exp-item,
       say) still gets broken up. The wrapper chain is cloned at every level,
       so styling that depends on the parent class survives the split. */
    const divide = el => {
      if (hOf(el) <= limit || !el.children.length) return [el];

      const wrap = piece => {
        const w = el.cloneNode(false);
        w.classList.add('sp-chunk');
        w.appendChild(piece);
        return w;
      };

      const kids = [...el.children];
      // one child carries the whole height — go a level deeper and rewrap
      if (kids.length === 1) return divide(kids[0]).map(wrap);

      const out = [];
      let cur = null, h = 0;
      for (const k of kids) {
        const kh = hOf(k);
        // a single oversized child: divide it, each piece gets its own wrapper
        if (kh > limit && k.children.length) {
          for (const piece of divide(k)) out.push(wrap(piece));
          cur = null; h = 0;
          continue;
        }
        if (!cur || h + kh > limit) {
          cur = el.cloneNode(false);
          cur.classList.add('sp-chunk');
          out.push(cur);
          h = 0;
        }
        cur.appendChild(k);
        h += kh;
      }
      return out.filter(n => n.children.length);
    };

    const next = [];
    for (const st of cells) {
      const content = st.firstElementChild;
      if (!content) { next.push(st); continue; }
      // reads as one unit — scaled to fit later rather than cut in half
      if (content.matches(NO_SPLIT)) { next.push(st); continue; }
      const parts = divide(content);
      if (parts.length === 1 && parts[0] === content) { next.push(st); continue; }
      parts.forEach(p => next.push(mk(p)));
      st.remove();
    }
    cells = next;

    // --- terminal chrome (added after splitting so clones stay clean) ---
    const seen = {};
    const titleFor = el => {
      const h = el.querySelector('h1,h2,h3,.exp-company,.section-heading');
      let t = (h ? h.textContent : '').trim().toLowerCase().replace(/\s+/g, '-');
      if (!t) t = (el.className.match(/[a-z-]+/) || ['section'])[0];
      t = t.replace(/[^a-z0-9-]/g, '')      // '&' etc. leave a gap...
           .replace(/-{2,}/g, '-')          // ...so collapse the doubled dash
           .replace(/^-|-$/g, '')
           .slice(0, 30) || 'section';
      // split chunks share a name — number them so they read as separate files
      seen[t] = (seen[t] || 0) + 1;
      return '~/' + t + (seen[t] > 1 ? '-' + seen[t] : '');
    };

    cells.forEach((st, i) => {
      const content = st.firstElementChild;
      if (!content) return;
      const win = document.createElement('div');
      win.className = 'sp-win';
      win.innerHTML =
        '<div class="sp-win-bar">' +
          '<span class="sp-dot sp-dot--r"></span>' +
          '<span class="sp-dot sp-dot--y"></span>' +
          '<span class="sp-dot sp-dot--g"></span>' +
          '<span class="sp-win-title">' + titleFor(content) + '</span>' +
          '<span class="sp-win-idx">' + String(i + 1).padStart(2, '0') + '</span>' +
        '</div>';
      st.appendChild(win);
      const body = document.createElement('div');
      body.className = 'sp-win-body';
      win.appendChild(body);
      body.appendChild(content);

      /* Action rows read better as a tab strip along the window's foot than
         as buttons floating in the content — and it buys back the vertical
         space that was forcing the hero to split in two. */
      const tabs = content.querySelector(TAB_SEL);
      if (tabs) {
        const bar = document.createElement('div');
        bar.className = 'sp-win-tabs';
        bar.appendChild(tabs);          // moves it, no clone
        win.appendChild(bar);
      }
    });

    /* Drop windows that render as a bare heading. Their text exists in the
       DOM but sits inside a collapsed accordion, so textContent looks healthy
       while the window shows nothing — height is the only honest signal.

       Deliberately runs AFTER titling: surviving windows keep the exact
       titles they were tuned against, so CFG.overrides stays valid. Only the
       displayed index needs renumbering. */
    cells = cells.filter(st => {
      const body = st.querySelector('.sp-win-body');
      if (!body) return true;
      if (body.querySelector('video')) return true;      // demo clips are short by nature
      if (st.offsetHeight >= STUB_H) return true;
      st.remove();
      return false;
    });
    cells.forEach((st, i) => {
      const idx = st.querySelector('.sp-win-idx');
      if (idx) idx.textContent = String(i + 1).padStart(2, '0');
    });

    /* Last resort: a station that genuinely cannot be divided (one long
       paragraph, a fixed-ratio media block) gets scaled down so it always
       fits on screen. Scrolling inside a window is worse than slightly
       smaller type — the floor stops it from becoming unreadable.

       Re-runnable, because web fonts land after build and push heights up;
       measuring only once leaves late-growing windows overflowing. */
    fitAll = () => {
      const cap = innerHeight * CFG.FIT_CAP;
      for (const st of cells) {
        st.style.removeProperty('--sp-scale');       // measure unscaled
        const h = st.offsetHeight;
        if (h > cap) st.style.setProperty('--sp-scale', Math.max(CFG.FIT_MIN, cap / h).toFixed(3));
      }
    };
    fitAll();

    // --- lay the final set out on the helix ---
    stations = cells.map((st, i) => {
      st.dataset.i = i;
      const title = (st.querySelector('.sp-win-title') || {}).textContent || ('#' + i);
      return { el: st, a: 0, y: 0, title, content: st.firstElementChild };
    });
    layout();

    document.querySelectorAll('section, .divider').forEach(s => s.classList.add('sp-collapsed'));

    spacer = document.createElement('div');
    spacer.className = 'sp-spacer';
    spacer.style.height = (stations.length * CFG.VH_PER + innerHeight) + 'px';
    document.body.appendChild(spacer);

    buildThread();
    return true;
  }

  /* Place every station on the helix. Split out from build() so the tuner
     can re-run it after changing a value, without rebuilding the DOM.
     Per-window nudges from CFG.overrides are keyed by title, which stays
     stable across rebuilds where the numeric index does not. */
  function layout() {
    stations.forEach((s, i) => {
      s.a = i * CFG.A_STEP;
      s.y = i * CFG.Y_STEP;
      const o = CFG.overrides[s.title] || {};
      s.el.style.transform =
        `rotateY(${s.a + (o.rot || 0)}deg) ` +
        `translateZ(${CFG.RADIUS + (o.dz || 0)}px) ` +
        `translateY(${s.y + (o.dy || 0)}px) ` +
        `translateX(${o.dx || 0}px)`;
      s.el.style.setProperty('--sp-user-scale', o.scale || 1);
    });
    if (spacer) spacer.style.height = (stations.length * CFG.VH_PER + innerHeight) + 'px';
  }

  /* A curved thread linking every station. Because the stations are CSS-3D
     transformed, their on-screen positions come from getBoundingClientRect —
     far simpler and more accurate than re-deriving the projection by hand. */
  function buildThread() {
    const NS = 'http://www.w3.org/2000/svg';
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'sp-thread');

    const defs = document.createElementNS(NS, 'defs');
    defs.innerHTML =
      '<linearGradient id="spGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%"  stop-color="var(--accent)"   stop-opacity=".05"/>' +
        '<stop offset="45%" stop-color="var(--accent)"   stop-opacity=".85"/>' +
        '<stop offset="100%" stop-color="var(--accent-2)" stop-opacity=".9"/>' +
      '</linearGradient>' +
      '<filter id="spGlow" x="-50%" y="-50%" width="200%" height="200%">' +
        '<feGaussianBlur stdDeviation="4" result="b"/>' +
        '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
      '</filter>';
    svg.appendChild(defs);

    threadGhost = document.createElementNS(NS, 'path');
    threadGhost.setAttribute('class', 'sp-thread-ghost');
    threadPath = document.createElementNS(NS, 'path');
    threadPath.setAttribute('class', 'sp-thread-live');
    threadHead = document.createElementNS(NS, 'circle');
    threadHead.setAttribute('class', 'sp-thread-head');
    threadHead.setAttribute('r', '5');

    svg.append(threadGhost, threadPath, threadHead);
    document.body.appendChild(svg);
  }

  // Catmull-Rom through the points, emitted as cubic beziers
  function curve(pts) {
    if (pts.length < 2) return '';
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i];
      const p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  }

  function drawThread() {
    if (!threadPath) return;
    const k = cam.a / CFG.A_STEP;                      // fractional station index
    // Sample well beyond the visible window — hidden stations still report a
    // rect, so the thread can show the curve wrapping away round the spine.
    const lo = Math.max(0, Math.floor(k) - 7);
    const hi = Math.min(stations.length - 1, Math.ceil(k) + 7);

    const pts = [];
    for (let i = lo; i <= hi; i++) {
      const r = stations[i].el.getBoundingClientRect();
      if (!r.width) continue;
      pts.push([r.left + r.width / 2, r.top + r.height / 2]);
    }
    if (pts.length < 2) { threadPath.setAttribute('d', ''); threadGhost.setAttribute('d', ''); return; }

    const d = curve(pts);
    threadGhost.setAttribute('d', d);
    threadPath.setAttribute('d', d);

    // bloom: reveal the thread up to where we've travelled
    const len = threadPath.getTotalLength();
    const span = hi - lo;
    const frac = span > 0 ? (k - lo) / span : 1;
    threadPath.style.strokeDasharray = len;
    threadPath.style.strokeDashoffset = len * (1 - Math.min(1, Math.max(0, frac)));

    const head = threadPath.getPointAtLength(len * Math.min(1, Math.max(0, frac)));
    threadHead.setAttribute('cx', head.x);
    threadHead.setAttribute('cy', head.y);
  }

  function onScroll() {
    const max = spacer.offsetHeight - innerHeight;
    const t = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    const k = t * (stations.length - 1);
    target.a = k * CFG.A_STEP;
    target.y = k * CFG.Y_STEP;
    if (window.__spineSync) window.__spineSync(t, target.a);

    // If rAF isn't ticking (background tab, throttled device), the eased
    // loop never runs and nothing would ever be positioned. Snap and paint.
    if (performance.now() - lastFrame > 200) { cam.a = target.a; cam.y = target.y; render(); }
  }

  function render() {
    // The axis sits away from the viewer; content orbits it.
    world.style.transform =
      `translateZ(${CFG.AXIS_Z}px) rotateY(${-cam.a}deg) translateY(${-cam.y}px)`;

    for (const s of stations) {
      const d = Math.abs(s.a - cam.a);          // angle from the front
      /* Flat near the front, steep only at the edge. The previous curve
         dimmed everything whenever the camera sat *between* two stations,
         which made the windows read as transparent rather than translucent. */
      const t = Math.min(1, d / CFG.VIS_DEG);
      const o = d >= CFG.VIS_DEG ? 0 : Math.max(0, 1 - Math.pow(t, 2.4));
      s.el.style.opacity = o.toFixed(3);
      s.el.style.pointerEvents = o > 0.5 ? 'auto' : 'none';
      // don't paint what's round the back
      s.el.style.visibility = o < 0.02 ? 'hidden' : 'visible';
    }
    drawThread();
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    lastFrame = performance.now();
    cam.a += (target.a - cam.a) * 0.09;
    cam.y += (target.y - cam.y) * 0.09;
    render();
  }

  // Nav anchors point at sections that no longer sit in the flow — remap
  // each one to the scroll offset of its first station.
  function wireNav() {
    const scrollForStation = i =>
      (i / Math.max(1, stations.length - 1)) * (spacer.offsetHeight - innerHeight);

    document.querySelectorAll('a[href^="#"]').forEach(a => {
      const id = a.getAttribute('href').slice(1);
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      const idx = stations.findIndex(s => target.contains(s.content) || s.content === target
                                          || target === s.content.closest('section'));
      if (idx < 0) return;
      a.addEventListener('click', e => {
        e.preventDefault();
        scrollTo({ top: scrollForStation(idx), behavior: 'smooth' });
      });
    });
  }

  try {
    if (!build()) return;
    wireNav();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', () => {
      spacer.style.height = (stations.length * CFG.VH_PER + innerHeight) + 'px';
      if (fitAll) fitAll();
      onScroll();
    }, { passive: true });

    // web fonts change metrics after build — re-fit once they've landed
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { if (fitAll) fitAll(); });
    }
    onScroll();
    cam.a = target.a; cam.y = target.y;
    render();            // paint immediately, before any rAF
    frame();

    /* Tuner hook. Only ever loaded with ?tune=1, so the shipped portfolio
       never pays for it — the handle itself is inert without the overlay. */
    /* An override whose window was pruned or renamed silently does nothing.
       Say so, rather than leaving it to be discovered by confusion. */
    const live = new Set(stations.map(s => s.title));
    const orphans = Object.keys(CFG.overrides).filter(k => !live.has(k));
    if (orphans.length) console.warn('[spiral] overrides matching no window:', orphans);

    window.__spiral = {
      CFG, stations,
      apply: () => { if (fitAll) fitAll(); layout(); onScroll(); render(); },
      goto: i => scrollTo({
        top: (i / Math.max(1, stations.length - 1)) * (spacer.offsetHeight - innerHeight),
        behavior: 'smooth'
      })
    };
    if (/[?&]tune=1/.test(location.search)) {
      const s = document.createElement('script');
      s.src = 'spiral-tune.js?v=20260804';
      document.body.appendChild(s);
    }
  } catch (e) {
    // never leave the page broken
    document.documentElement.classList.remove('sp-on');
    if (raf) cancelAnimationFrame(raf);
    console.warn('[spiral] disabled:', e);
  }
})();
