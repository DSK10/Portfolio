/* ===================================================================
   Holographic spine — WebGL
   Model: "The human spinal column" by 3D (scratchi), CC-BY-4.0
   https://sketchfab.com/3d-models/the-human-spinal-column-bcd9eee09ce044ef98a69c315aa792e2

   Loads lazily, degrades to nothing on weak devices, and is driven
   entirely by scroll position: rotate + descend = spiral.
   =================================================================== */
(function () {
  const canvas = document.getElementById('spine-canvas');
  if (!canvas) return;

  // ES modules are blocked on file:// (origin "null"), so the 3D scene can
  // only run over http/https. Say so plainly instead of failing silently.
  if (location.protocol === 'file:') {
    console.info(
      '%c[spine] 3D scene skipped — ES modules are blocked on file://\n' +
      'Serve the folder instead:  python -m http.server 8000\n' +
      'then open  http://localhost:8000',
      'color:#8b7cff'
    );
    return;
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = navigator.connection && (navigator.connection.saveData ||
                   /2g/.test(navigator.connection.effectiveType || ''));
  const lowCore  = (navigator.hardwareConcurrency || 8) <= 4;
  const lowMem   = (navigator.deviceMemory || 8) <= 4;

  const narrow = matchMedia('(max-width: 900px)').matches;

  /* Bail entirely on weak devices / data saver — the CSS glow still shows.
     On phones a single weak signal is enough: the AND below let mid-range
     handsets (8 cores, 4GB) through, and they are exactly the devices that
     struggle with a full-screen WebGL background. */
  if (saveData || (lowCore && lowMem) || (narrow && (lowCore || lowMem))) return;

  let gl = null;
  try { gl = canvas.getContext('webgl2') || canvas.getContext('webgl'); } catch (e) {}
  if (!gl) return;

  const CDN = 'https://cdn.jsdelivr.net/npm/three@0.169.0';

  let scene, camera, renderer, spine, clock, raf = null, brainRef = null, controls = null;
  // ---- Tunable values. `?tune=1` opens a live panel that edits these. ----
  const DEFAULTS = {
    camFov: 13.5, camZ: 56,
    spineHeight: 74, spineX: -0.3,
    startY: -34, travel: 70, spinDeg: 575,
    spineOpacity: 0.42, canvasOpacity: 0.45, veinStrength: 0.85, bgBlur: 3,
    brainFit: 0.97, brainSize: 0.27, brainOpacity: 0.45,
    brainXOff: -0.01, brainYOff: 0.03, brainZOff: 0.02,
    brainRotX: -87, brainRotY: 0, brainRotZ: 0,
    brainSpin: 0, brainCounter: 0, brainPulse: 0.30
  };
  let CFG = Object.assign({}, DEFAULTS);
  try { Object.assign(CFG, JSON.parse(localStorage.getItem('spineCfg') || '{}')); } catch (e) {}

  let START_Y = CFG.startY;
  let TRAVEL  = CFG.travel;

  let target = { rot: 0, y: START_Y };
  let current = { rot: 0, y: START_Y };

  async function init() {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    /* It's a blurred background at 0.45 opacity, so resolution buys nothing
       visually but costs fill rate linearly. On a 3x phone, capping at 1
       instead of 1.75 is roughly a third of the pixels per frame. */
    renderer.setPixelRatio(Math.min(devicePixelRatio, narrow ? 1 : 1.75));
    renderer.setSize(innerWidth, innerHeight, false);

    scene  = new THREE.Scene();
    // Telephoto framing. The column is ~74 units tall and ~31 deep, so a wide
    // lens close enough to frame two vertebrae would sit inside the mesh.
    // 12° at z=34 gives ~7 units of visible height (≈2 vertebrae) from outside.
    camera = new THREE.PerspectiveCamera(CFG.camFov, innerWidth / innerHeight, 0.1, 400);
    camera.position.set(0, 0, CFG.camZ);
    clock  = new THREE.Clock();

    // --- holographic material: fresnel rim + drifting scanlines ---
    const css = getComputedStyle(document.documentElement);
    const hex = n => new THREE.Color(css.getPropertyValue(n).trim() || '#8b7cff');

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime:   { value: 0 },
        uCoreCol:{ value: hex('--accent') },
        uRimCol: { value: hex('--accent-2') },
        uVeinCol:{ value: hex('--accent-2') },
        uVein:   { value: CFG.veinStrength },
        uOpacity:{ value: CFG.spineOpacity }
      },
      vertexShader: `
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        varying vec3 vPosW;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vPosW   = wp.xyz;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vViewDir = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform vec3  uCoreCol;
        uniform vec3  uRimCol;
        uniform vec3  uVeinCol;
        uniform float uOpacity;
        uniform float uVein;
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        varying vec3 vPosW;

        // narrow travelling band along the column
        float band(float y, float speed, float offset, float width) {
          float p = fract(y * 0.055 - uTime * speed + offset);
          float d = min(abs(p - 0.5), 0.5);
          return exp(-pow(d / width, 2.0));
        }

        // cheap hash for the electric crackle
        float hash(vec3 p) {
          return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        }

        void main() {
          // fresnel: brightest where the surface turns away from the camera
          float f = 1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir)));
          f = pow(clamp(f, 0.0, 1.0), 2.2);

          float scan  = smoothstep(0.42, 0.5, abs(fract(vPosW.y * 9.0 - uTime * 0.5) - 0.5));
          float sweep = smoothstep(0.0, 1.0, sin(vPosW.y * 1.4 - uTime * 1.1) * 0.5 + 0.5);

          // --- veins: three pulses running the length of the column ---
          float pulse = band(vPosW.y, 0.055, 0.00, 0.055)
                      + band(vPosW.y, 0.085, 0.41, 0.038) * 0.75
                      + band(vPosW.y, 0.032, 0.73, 0.070) * 0.55;

          // veins hug the surface: strongest where the fresnel already glows
          float vein = pulse * (0.35 + f * 1.5);

          // --- electricity: sparse, fast crackle riding the pulses ---
          vec3  cell   = floor(vPosW * 26.0) + floor(uTime * 14.0);
          float spark  = step(0.988, hash(cell)) * pulse * 2.2;
          float arc    = step(0.9975, hash(cell * 1.7)) * 1.4;

          vec3 col = mix(uCoreCol, uRimCol, f);
          col += uRimCol  * sweep * 0.22;
          col += uVeinCol * (vein * 1.5 + spark + arc) * uVein;

          float a = (0.10 + f * 1.0) * uOpacity;
          a *= 0.72 + scan * 0.28;
          a += (vein * 0.55 + spark * 0.7 + arc * 0.5) * uVein * uOpacity;

          gl_FragColor = vec4(col, a);
        }`
    });

    const draco = new DRACOLoader();
    draco.setDecoderPath(`${CDN}/examples/jsm/libs/draco/`);
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    loader.load('models/spine.glb', (gltf) => {
      spine = gltf.scene;
      spine.traverse(o => { if (o.isMesh) { o.material = mat; o.frustumCulled = false; } });

      // Normalise. Order matters: centre the model inside its parent first,
      // then scale the PARENT — scaling the same object you offset leaves the
      // translation un-scaled and throws it outside the frustum.
      const box  = new THREE.Box3().setFromObject(spine);
      const size = box.getSize(new THREE.Vector3());
      const mid  = box.getCenter(new THREE.Vector3());
      spine.position.sub(mid);                 // geometry now centred on origin

      const holder = new THREE.Group();
      holder.add(spine);
      // Camera sees ~6.2 world units of height at z=9 / fov 38.
      // Scaling the full column to ~74 units puts roughly two vertebrae
      // in frame at any moment.
      holder.scale.setScalar(CFG.spineHeight / (size.y || 1));
      holder.position.x = CFG.spineX;
      holder.userData.baseY = size.y;
      scene.add(holder);
      spine = holder;

      addBrain(THREE, spine, holder).catch(e => {
        window.__brain = 'THREW: ' + e.message;
        console.warn('[brain] failed:', e);
      });

      // verify it actually landed in view
      const check = new THREE.Box3().setFromObject(holder);
      console.info('[spine] bounds', check.min.toArray().map(n => +n.toFixed(2)),
                                     check.max.toArray().map(n => +n.toFixed(2)));

      // Reveal without depending on a CSS transition completing — a
      // transition started while the tab is hidden can stay stuck at 0.
      canvas.style.transition = 'none';
      canvas.classList.add('is-ready');
      canvas.style.opacity = getComputedStyle(document.documentElement)
        .getPropertyValue('--spine-opacity').trim() || '0.85';
      requestAnimationFrame(() => { canvas.style.transition = ''; });

      draco.dispose();
      current.y = START_Y;   // framed on the skull to begin with
      onScroll();

      // Paint one frame immediately so the buffer is never empty, even if
      // rAF is subsequently throttled.
      renderer.render(scene, camera);
      loop();
    }, undefined, () => { /* load failed — CSS glow remains */ });

    // Mouse-orbit, but only on the tuner page — never on the portfolio.
    if (/tuner\.html$/.test(location.pathname)) {
      try {
        const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
        const host = document.getElementById('scroller') || renderer.domElement;
        controls = new OrbitControls(camera, host);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.enableZoom = false;      // wheel keeps travelling the column
        controls.enablePan  = true;
        controls.rotateSpeed = 0.7;
        window.__spine.controls = controls;
        window.__spine.resetView = () => {
          controls.target.set(0, 0, 0);
          camera.position.set(0, 0, CFG.camZ);
          controls.update();
          renderer.render(scene, camera);
        };
      } catch (e) { /* orbit is optional */ }
    }

    addEventListener('resize', onResize, { passive: true });
    addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop(); else loop();
    });

    function onResize() {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      // rotating a phone can cross the breakpoint — re-apply the cap
      renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth <= 900 ? 1 : 1.75));
      renderer.setSize(innerWidth, innerHeight, false);
    }
  }

  /* Brain: a 26k-point cloud fitted inside the skull's own bounding box,
     so it scales with whatever the model actually is rather than magic numbers. */
  async function addBrain(THREE, model, holder) {
    window.__brain = 'start';
    let skull = null;
    model.traverse(o => { if (o.isMesh && /skull/i.test(o.name)) skull = o; });
    if (!skull) { window.__brain = 'no skull mesh'; return; }

    const res = await fetch('models/brain.bin');
    if (!res.ok) { window.__brain = 'fetch ' + res.status; return; }
    const buf = await res.arrayBuffer();

    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'BRNP') { window.__brain = 'bad magic ' + magic; return; }

    const n = dv.getUint32(4, true);
    const lo = [dv.getFloat32(8, true),  dv.getFloat32(12, true), dv.getFloat32(16, true)];
    const sz = [dv.getFloat32(20, true), dv.getFloat32(24, true), dv.getFloat32(28, true)];
    const q = new Int16Array(buf, 32, n * 3);

    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        pos[i * 3 + k] = lo[k] + ((q[i * 3 + k] + 32768) / 65535) * sz[k];
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    /* Three-colour speckle, drawn from the theme palette so it follows the
       light/dark tokens. Each point is randomly assigned one of the three. */
    const css = getComputedStyle(document.documentElement);
    // Per-token fallbacks: a shared default would silently collapse a missing
    // variable into a duplicate colour and quietly leave only two.
    const palette = [['--accent-2', '#37e6a7'],
                     ['--accent',   '#8b7cff'],
                     ['--accent-3', '#ff7a6b']]
      .map(([v, fb]) => new THREE.Color(css.getPropertyValue(v).trim() || fb));
    const weights = [0.60, 0.28, 0.12];      // mostly mint, some violet, a little coral

    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      const c = palette[r < weights[0] ? 0 : r < weights[0] + weights[1] ? 1 : 2];
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingBox();

    const mat = new THREE.PointsMaterial({
      size: CFG.brainSize,
      sizeAttenuation: true,
      vertexColors: true,          // per-point colour from the attribute above
      transparent: true,
      opacity: CFG.brainOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const brain = new THREE.Points(geo, mat);

    /* Fit inside the cranium using the skull's own LOCAL geometry bounds and
       parent the brain to the skull. Measuring with setFromObject would give
       world coordinates, which are wrong once assigned as a local position
       under a scaled, translated parent. */
    skull.geometry.computeBoundingBox();
    const sb = skull.geometry.boundingBox;
    const ss = sb.getSize(new THREE.Vector3());
    const sc = sb.getCenter(new THREE.Vector3());
    const bb = geo.boundingBox.getSize(new THREE.Vector3());
    const k  = Math.min(ss.x / bb.x, ss.y / bb.y, ss.z / bb.z) * CFG.brainFit;

    brain.scale.setScalar(k);
    const bc = geo.boundingBox.getCenter(new THREE.Vector3()).multiplyScalar(k);
    brain.position.copy(sc).sub(bc);
    brain.position.x += ss.x * CFG.brainXOff;
    brain.position.y += ss.y * CFG.brainYOff;
    brain.position.z += ss.z * CFG.brainZOff;
    brain.rotation.set(
      CFG.brainRotX * Math.PI / 180,
      CFG.brainRotY * Math.PI / 180,
      CFG.brainRotZ * Math.PI / 180
    );

    skull.add(brain);                    // inherits the skull's transform
    brainRef = brain;
    window.__brain = `ok ${n}pts k=${k.toFixed(3)} local=${brain.position.toArray().map(v=>v.toFixed(1))} skullSize=${ss.toArray().map(v=>v.toFixed(1))}`;
    if (renderer) renderer.render(scene, camera);
  }

  function onScroll() {
    const max = document.documentElement.scrollHeight - innerHeight;
    const t = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    apply(t, t * 575);
  }

  let lastTick = 0;

  function apply(t, degrees) {
    // match the spiral camera so the column turns with the content
    target.rot = degrees * Math.PI / 180;
    // Move the model past the camera so the view travels from the skull at
    // the top to the sacrum at the bottom as the page scrolls down.
    target.y = START_Y + t * TRAVEL;

    // If rAF isn't running the eased loop never catches up — snap and draw.
    if (renderer && performance.now() - lastTick > 200) {
      current.rot = target.rot; current.y = target.y;
      if (spine) { spine.rotation.y = current.rot; spine.position.y = current.y; }
      renderer.render(scene, camera);
    }
  }

  // spiral.js drives this when it is active
  window.__spineSync = (t, deg) => apply(t, deg);

  function stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

  function loop() {
    if (raf || !renderer) return;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      lastTick = performance.now();
      const t = clock.getElapsedTime();
      if (controls) controls.update();

      if (spine) {
        // ease toward the scroll target so it glides rather than snaps
        current.rot += (target.rot - current.rot) * 0.075;
        current.y   += (target.y   - current.y)   * 0.075;
        spine.rotation.y = current.rot;
        spine.rotation.z = Math.sin(t * 0.25) * 0.05;   // gentle idle sway
        spine.position.y = current.y + Math.sin(t * 0.6) * 0.06;
      }
      if (brainRef) {
        const D = Math.PI / 180;
        // The brain is a child of the skull, so it already inherits every
        // rotation the column makes. Only touch rotation here if the user has
        // explicitly asked for drift — otherwise leave the static offset alone
        // so the two stay locked together and can be aligned.
        if (CFG.brainSpin || CFG.brainCounter) {
          brainRef.rotation.x = CFG.brainRotX * D;
          brainRef.rotation.z = CFG.brainRotZ * D;
          brainRef.rotation.y = CFG.brainRotY * D
                              - current.rot * CFG.brainCounter
                              + t * CFG.brainSpin;
        }
        brainRef.material.opacity =
          CFG.brainOpacity * (1 - CFG.brainPulse + Math.sin(t * 1.5) * CFG.brainPulse);
      }
      scene.traverse(o => { if (o.isMesh) o.material.uniforms.uTime.value = t; });
      renderer.render(scene, camera);
    };
    tick();
  }

  /* Live-tuning API. Only used by tune.js (loaded with ?tune=1). */
  window.__spine = {
    cfg: CFG,
    defaults: DEFAULTS,
    apply(k, v) {
      CFG[k] = v;
      if (!renderer) return;
      switch (k) {
        case 'camFov': camera.fov = v; camera.updateProjectionMatrix(); break;
        case 'camZ':
          camera.position.setLength(v);
          if (controls) controls.update();
          break;
        case 'spineX': if (spine) spine.position.x = v; break;
        case 'spineHeight':
          if (spine && spine.userData.baseY) spine.scale.setScalar(v / spine.userData.baseY);
          break;
        case 'startY': START_Y = v; break;
        case 'travel': TRAVEL = v; break;
        case 'veinStrength':
          scene.traverse(o => { if (o.isMesh && o.material.uniforms) o.material.uniforms.uVein.value = v; });
          break;
        case 'bgBlur':
          document.documentElement.style.setProperty('--bg-blur', v + 'px');
          break;
        case 'spineOpacity':
          scene.traverse(o => { if (o.isMesh && o.material.uniforms) o.material.uniforms.uOpacity.value = v; });
          break;
        case 'canvasOpacity':
          document.documentElement.style.setProperty('--spine-opacity', v);
          canvas.style.opacity = v;
          break;
        case 'brainSize':    if (brainRef) brainRef.material.size = v; break;
        case 'brainOpacity': if (brainRef) brainRef.material.opacity = v; break;
        case 'brainFit':
        case 'brainXOff':
        case 'brainYOff':
        case 'brainZOff':
        case 'brainRotX':
        case 'brainRotY':
        case 'brainRotZ':    this.refitBrain(); break;
      }
      onScroll();
      renderer.render(scene, camera);
    },
    refitBrain() {
      if (!brainRef || !brainRef.parent) return;
      const skull = brainRef.parent;
      const sb = skull.geometry.boundingBox;
      // plain maths so this doesn't need THREE re-imported here
      const sx = sb.max.x - sb.min.x, sy = sb.max.y - sb.min.y, sz = sb.max.z - sb.min.z;
      const gb = brainRef.geometry.boundingBox;
      const bx = gb.max.x - gb.min.x, by = gb.max.y - gb.min.y, bz = gb.max.z - gb.min.z;
      const k = Math.min(sx / bx, sy / by, sz / bz) * CFG.brainFit;
      brainRef.scale.setScalar(k);
      brainRef.position.set(
        (sb.min.x + sb.max.x) / 2 - ((gb.min.x + gb.max.x) / 2) * k + sx * CFG.brainXOff,
        (sb.min.y + sb.max.y) / 2 - ((gb.min.y + gb.max.y) / 2) * k + sy * CFG.brainYOff,
        (sb.min.z + sb.max.z) / 2 - ((gb.min.z + gb.max.z) / 2) * k + sz * CFG.brainZOff
      );
      const D = Math.PI / 180;
      brainRef.rotation.set(CFG.brainRotX * D, CFG.brainRotY * D, CFG.brainRotZ * D);
    },
    save() { localStorage.setItem('spineCfg', JSON.stringify(CFG)); },
    reset() { localStorage.removeItem('spineCfg'); location.reload(); },
    redraw() { if (renderer) renderer.render(scene, camera); }
  };

  // Start once the hero is on screen — but never depend solely on the
  // observer: it can be deferred (background tabs, some mobile browsers),
  // which would leave the scene permanently uninitialised.
  let started = false;
  const start = () => { if (started) return; started = true; io.disconnect(); init(); };

  const hero = document.querySelector('.hero') || document.body;
  const io = new IntersectionObserver(
    (entries) => { if (entries.some(e => e.isIntersecting)) start(); },
    { rootMargin: '200px' }
  );
  io.observe(hero);

  // Direct check — if it is already visible, don't wait to be told.
  const visibleNow = () => {
    const r = hero.getBoundingClientRect();
    return r.top < innerHeight + 200 && r.bottom > -200;
  };
  if (visibleNow()) start();
  else {
    const onScrollStart = () => { if (visibleNow()) { removeEventListener('scroll', onScrollStart); start(); } };
    addEventListener('scroll', onScrollStart, { passive: true });
  }
})();
