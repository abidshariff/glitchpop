import * as THREE from 'three';

const manifest = fetch(import.meta.env.BASE_URL + 'models/manifest.json').then(r => r.json());
const cache = new Map();

// Shared geometry (each renderer uploads its own GPU copy).
export function loadGeometry(name, { droop } = {}) {
  if (!cache.has(name)) {
    cache.set(name, (async () => {
      const m = (await manifest)[name];
      const buf = await (await fetch(import.meta.env.BASE_URL + 'models/' + m.file)).arrayBuffer();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, 0, m.vertices * 3), 3));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, m.vertices * 12, m.indices), 1));
      if (droop) bendLegs(g, droop);
      g.computeVertexNormals();
      return g;
    })());
  }
  return cache.get(name);
}

// The flexi legs are printed flat; bend everything beyond radius r0 downward into a drape.
function bendLegs(g, { r0, maxAngle }) {
  const p = g.attributes.position;
  let rmax = 0;
  for (let i = 0; i < p.count; i++) rmax = Math.max(rmax, Math.hypot(p.getX(i), p.getZ(i)));
  const k = maxAngle / (rmax - r0);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
    if (r <= r0) continue;
    const s = r - r0, nr = r0 + Math.sin(k * s) / k, dy = (1 - Math.cos(k * s)) / k;
    const f = nr / r;
    p.setXYZ(i, x * f, p.getY(i) - dy, z * f);
  }
}

const mesh = (geo, color, roughness = 0.45) =>
  new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 }));

const LOOP = 8, W = (2 * Math.PI) / LOOP;
const ease = x => x * x * (3 - 2 * x);

/**
 * Every toy exposes:
 *   root      – add this to a scene (origin = centre of base on the plate; scale it to taste)
 *   spin      – child group that turns
 *   mats      – all materials (for fading)
 *   update(s, animated) – animated=true plays the full animation, false is a calm resting pose
 *   natural   – resting height in model units;  anim – height of the full animation range
 *   animCentre – y of the middle of the animation range
 */
async function buildWand() {
  const [gs, gp, gh, gt] = await Promise.all([
    loadGeometry('spindle'), loadGeometry('pumpkin'),
    loadGeometry('handle'), loadGeometry('stem'),
  ]);
  // The octopus legs are flexible: they hang down under gravity at rest and fly out flat when the pumpkin spins.
  // The bend runs in the vertex shader; uLeg is the downward bend angle (radians) of the legs.
  const pp = gp.attributes.position; let rmax = 0;
  for (let i = 0; i < pp.count; i++) rmax = Math.max(rmax, Math.hypot(pp.getX(i), pp.getZ(i)));
  const leg = { uLeg: { value: 1.7 }, uR0: { value: 28 }, uRmax: { value: rmax } };
  const pumpkinMat = new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.45, metalness: 0.05 });
  pumpkinMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, leg);
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'uniform float uLeg; uniform float uR0; uniform float uRmax;\nvoid main() {')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        { float r = length(position.xz); float k = uLeg / (uRmax - uR0) + 1e-5; float ph = k * max(0., r - uR0);
          vec2 d = r > 1e-4 ? position.xz / r : vec2(0.);
          float nr = dot(objectNormal.xz, d); float ny = objectNormal.y;
          float nr2 = nr * cos(ph) + ny * sin(ph); float ny2 = -nr * sin(ph) + ny * cos(ph);
          vec2 nt = objectNormal.xz - d * nr;
          objectNormal = vec3(d.x * nr2 + nt.x, ny2, d.y * nr2 + nt.y); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { float r = length(position.xz); float k = uLeg / (uRmax - uR0);
          if (r > uR0 && abs(k) > 1e-4) {
            float e = r - uR0, ph = k * e, y0 = -15.5, yo = position.y - y0;
            float rad = uR0 + sin(ph) / k + yo * sin(ph);
            float down = (1.0 - cos(ph)) / k;
            vec2 d = position.xz / r;
            transformed.xz = d * rad;
            transformed.y = y0 - down + yo * cos(ph);
          } }`)
  };
  const spindle = mesh(gs, 0xb6ff1a), pumpkin = new THREE.Mesh(gp, pumpkinMat), handle = mesh(gh, 0x16161c, 0.35), stem = mesh(gt, 0x6f5034);
  const HANDLE_TOP = 102, SLIDE_MIN = 120, SLIDE_MAX = 262;   // pumpkin body rests right on the handle at the bottom and reaches the star end at the top
  const CYCLE = 12;
  let legX = 1.7, legV = 0, legT = -1;     // leg droop spring state
  // spin angle table: fast mid-slide, slow turn otherwise; normalised to whole turns so the loop has no jump
  const SPIN_STEPS = 1440, spinTab = new Float32Array(SPIN_STEPS + 1);
  for (let i = 0, a = 0; i <= SPIN_STEPS; i++) {
    spinTab[i] = a;
    const t = (i / SPIN_STEPS) * CYCLE; let q = 0;
    if (t < 4) q = Math.sin(Math.PI * t / 4) ** 2; else if (t >= 6 && t < 10) q = Math.sin(Math.PI * (t - 6) / 4) ** 2;
    a += (0.8 + 11 * q) * (CYCLE / SPIN_STEPS);
  }
  const spinK = (2 * Math.PI * Math.round(spinTab[SPIN_STEPS] / (2 * Math.PI))) / spinTab[SPIN_STEPS];
  const spinAt = t => { const f = (t / CYCLE) * SPIN_STEPS, i = Math.min(SPIN_STEPS - 1, Math.floor(f)); return spinK * (spinTab[i] + (spinTab[i + 1] - spinTab[i]) * (f - i)); };
  handle.position.y = 51;
  spindle.position.y = HANDLE_TOP + 92 - 4;
  const pg = new THREE.Group(); pg.add(pumpkin);
  stem.position.y = 3; stem.visible = false; pg.add(stem);
  const model = new THREE.Group(); model.add(handle, spindle, pg);
  const flipG = new THREE.Group(); flipG.position.y = 141; model.position.y = -141; flipG.add(model); // pivot at the wand's middle
  pg.rotation.order = 'ZYX';
  const spin = new THREE.Group(); spin.add(flipG);
  const root = new THREE.Group(); root.add(spin);
  return {
    root, spin, mats: [spindle, pumpkin, handle, stem].map(m => m.material),
    roles: { spindle: spindle.material, handle: handle.material },
    swatchShape: 'wide',
    // swatch = [top, bottom] shown on the button
    variants: [
      { accent: '#9be400', swatch: ['#16161c', '#b6ff1a'], colors: { handle: 0x16161c, spindle: 0xb6ff1a } }, // black + green (default)
      { accent: '#8fb0ff', swatch: ['#16161c', '#f4f4f4'], colors: { handle: 0x16161c, spindle: 0xf4f4f4 } }, // black + white
      { accent: '#ff9ad0', swatch: ['#f4f4f4', '#16161c'], colors: { handle: 0xf4f4f4, spindle: 0x16161c } }, // white + black
    ],
    natural: 282, anim: 282, animCentre: 141,
    update(s, animated) {
      if (animated) {
        // 12 s cycle. Kids play it both ways up, and the pumpkin always slides DOWN with gravity:
        //  A  handle down : pumpkin slides from the star end to the handle end
        //  F1 the wand flips over (handle up)
        //  C  handle up   : pumpkin slides from the handle end to the star end
        //  F2 the wand flips back
        const t = ((s % CYCLE) + CYCLE) % CYCLE;
        let y, flip = 0, p = -1;
        if (t < 4)        { p = t / 4;        y = SLIDE_MAX - (SLIDE_MAX - SLIDE_MIN) * ease(p); }
        else if (t < 6)   { y = SLIDE_MIN;    flip = Math.PI * ease((t - 4) / 2); }
        else if (t < 10)  { p = (t - 6) / 4;  y = SLIDE_MIN + (SLIDE_MAX - SLIDE_MIN) * ease(p); flip = Math.PI; }
        else              { y = SLIDE_MAX;    flip = Math.PI + Math.PI * ease((t - 10) / 2); }
        const q = p < 0 ? 0 : Math.sin(Math.PI * p) ** 2;      // 0 at rest, 1 mid-slide
        flipG.rotation.z = flip;
        pg.rotation.z = 0;                                      // the pumpkin flips with the wand (upside down when the handle is up)
        pg.rotation.y = spinAt(t);
        pg.position.y = y;
        spin.rotation.y = Math.sin(s * 2 * Math.PI / CYCLE) * 0.5;
        // legs fly out flat while spinning and sag toward the floor when slow. Flipped, the floor is on the other side
        // of the pumpkin, so the same sag bends the legs up and over its back instead.
        // Legs are limp: they fall toward the floor whenever the pumpkin is not spinning. Once the wand is turned past sideways
        // the floor is on the other side, so they flop over to that side (full droop, not half). A spring gives them weight.
        const sag = 1.7 - 1.45 * Math.pow(q, 0.7), target = sag * Math.tanh(4 * Math.cos(flip));
        const dt = s - legT; legT = s;
        if (!(dt > 0 && dt < 0.2)) { legX = target; legV = 0; }
        else { const n = Math.ceil(dt / 0.008), h = dt / n; for (let i = 0; i < n; i++) { legV += (62 * (target - legX) - 5.5 * legV) * h; legX += legV * h; } }
        leg.uLeg.value = legX;
      } else {
        flipG.rotation.z = 0; pg.rotation.z = 0;
        spin.rotation.y = s * 0.35; spin.rotation.z = 0;
        pg.rotation.y = s * 0.35;
        pg.position.y = (SLIDE_MIN + SLIDE_MAX) / 2;
        leg.uLeg.value = 1.7;
      }
    },
  };
}

async function buildEgg() {
  const [gi, go] = await Promise.all([loadGeometry('egg_inside'), loadGeometry('egg_outside')]);
  const inside = mesh(gi, 0x44c26a), outside = mesh(go, 0x44c26a);
  const model = new THREE.Group(); model.add(inside, outside); model.position.y = 25; // base at y=0
  model.rotation.y = Math.PI; // raindrop window faces the camera
  const spin = new THREE.Group(); spin.add(model);
  const root = new THREE.Group(); root.add(spin);
  // Twisting the upper shell turns its raindrop window over (or away from) the window in the egg body.
  const CLOSED = Math.PI;
  const hold = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const css = n => '#' + n.toString(16).padStart(6, '0');
  const egg = (hex, dragon, accent) => ({ accent, swatch: [css(hex)], colors: { shell: hex, inside: hex } });
  return {
    root, spin, mats: [inside.material, outside.material],
    roles: { shell: outside.material, inside: inside.material },
    swatchShape: 'square',
    variants: [
      egg(0x44c26a, 0x1f9bff, '#5bd17a'), // green (default), blue dragon
      egg(0xff7eb6, 0x7a5cff, '#ff8fc0'), // pink, violet dragons
      egg(0xe8331f, 0xffd23f, '#ff6a4d'), // red, gold dragons
      egg(0xf4f4f4, 0x3aa0ff, '#9fb4d6'), // white, blue dragons
    ],
    natural: 50, anim: 50, animCentre: 25,
    update(s, animated) {
      const t = (((s % LOOP) + LOOP) % LOOP);
      const open = ease(hold(t, 1.2, 3.6)) - ease(hold(t, 5.0, 7.4));
      // the body (outer shell with the window) never moves; only the inner egg with the scaly cap twists
      inside.rotation.y = CLOSED * (1 - open);
      outside.rotation.y = 0;
      spin.rotation.y = 0;
      spin.rotation.z = 0;
    },
  };
}

// Each concentric ring of the star base is its own piece, so it can spin on its own.
async function loadRings() {
  const m = (await manifest).star_rings;
  const buf = await (await fetch(import.meta.env.BASE_URL + 'models/' + m.file)).arrayBuffer();
  return m.ranges.map(r => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, r.v * 12, r.vn * 3), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, m.vertices * 12 + r.i * 4, r.in), 1));
    g.computeVertexNormals();
    return g;
  });
}

async function buildStar() {
  const [gb, ringGeos] = await Promise.all([loadGeometry('star_body'), loadRings()]);
  const body = mesh(gb, 0xe5231a);
  // The star disc is flexible: it hangs like a skirt when slow and flares open like an umbrella when spun fast.
  // The bend is done in the vertex shader (shared uniform) so it costs nothing per frame.
  const bend = { uBend: { value: 1 }, uR0: { value: 12 }, uRmax: { value: 70 } };
  const flexy = hex => {
    const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, bend);
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', 'uniform float uBend; uniform float uR0; uniform float uRmax;\nvoid main() {')
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          { float r = length(position.xz); float ph = r > uR0 ? uBend : 0.;
            vec2 d = r > 1e-4 ? position.xz / r : vec2(0.);
            float nr = dot(objectNormal.xz, d); float ny = objectNormal.y;
            float nr2 = nr * cos(ph) - ny * sin(ph); float ny2 = nr * sin(ph) + ny * cos(ph);
            vec2 nt = objectNormal.xz - d * nr;
            objectNormal = vec3(d.x * nr2 + nt.x, ny2, d.y * nr2 + nt.y); }`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          { float r = length(position.xz); float a = uBend; float e = max(0., r - uR0);
            float nrad = r <= uR0 ? r : uR0 + e * cos(a);
            transformed.xz = r > 1e-4 ? position.xz * (nrad / r) : position.xz;
            transformed.y = position.y + e * sin(a); }`);
    };
    return m;
  };
  const matA = flexy(0xe5231a), matB = flexy(0xe5231a);
  const rings = ringGeos.map((g, i) => new THREE.Mesh(g, i % 2 ? matB : matA));
  // the disc turns about its own centre so it can hang under gravity whichever way up the toy is
  const DISC_C = -114.2; // disc centre on the rope, in the model's local frame
  const discG = new THREE.Group(); discG.add(...rings); rings.forEach(r => { r.position.y = -DISC_C; });
  const model = new THREE.Group(); model.add(body, discG);
  model.rotation.x = Math.PI; // like the video: loop at the bottom, star disc at the top
  const flipG = new THREE.Group(); flipG.position.y = 148; flipG.add(model); // pivot at the middle of the rope
  const spin = new THREE.Group(); spin.add(flipG);
  const root = new THREE.Group(); root.add(spin);
  const css = n => '#' + n.toString(16).padStart(6, '0');
  const v = (hex, accent) => ({ accent, swatch: [css(hex)], colors: { body: hex, ringA: hex, ringB: hex } });
  const DISC_UP = 1, DISC_DOWN = 136; // disc positions along the rope (local +y = down in the scene)
  const CYCLE = 12, WSPIN = 2 * Math.PI * 1.4;   // spin rate while spiralling (rad/s)
  const smooth = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  // The disc does not spin while the toy is turned over: it spins up at the start of each run and stops before each turn.
  const omega = t => WSPIN * (smooth(t / 0.7) * (1 - smooth((t - 4.0) / 0.45)) + smooth((t - 6) / 0.7) * (1 - smooth((t - 10.05) / 0.45)));
  const SPIN_STEPS = 2400, spinTab = new Float32Array(SPIN_STEPS + 1);
  for (let i = 0, a = 0; i <= SPIN_STEPS; i++) { spinTab[i] = a; a += omega((i / SPIN_STEPS) * CYCLE) * (CYCLE / SPIN_STEPS); }
  const spinK = (2 * Math.PI * Math.round(spinTab[SPIN_STEPS] / (2 * Math.PI))) / spinTab[SPIN_STEPS];
  const spinAt = t => { const f = (t / CYCLE) * SPIN_STEPS, i = Math.min(SPIN_STEPS - 1, Math.floor(f)); return spinK * (spinTab[i] + (spinTab[i + 1] - spinTab[i]) * (f - i)); };
  return {
    root, spin, mats: [body.material, matA, matB],
    roles: { body: body.material, ringA: matA, ringB: matB },
    swatchShape: 'square',
    variants: [v(0xe5231a, '#ff5a4d'), v(0xff6a13, '#ff8a3d'), v(0x7bd62a, '#8be03a')],
    natural: 292, anim: 292, animCentre: 146,
    update(s, animated) {
      // Per 12 s loop:
      //  A  0-4.5s   loop down : the disc spins up and spirals down the rope
      //  F1 4.5-6s   the toy turns over; the disc is NOT spinning
      //  C  6-10.5s  loop up   : the disc spins up again and spirals down the rope
      //  F2 10.5-12s the toy turns back over
      // The wings always hang from the disc like a cone, under gravity: broader when spinning (centrifugal), never inverted.
      // When the toy is turned over they slowly swing through flat to hang toward the new floor.
      const t = ((s % CYCLE) + CYCLE) % CYCLE;
      const D_REST = 0.46, D_FLAT = 0.38;              // wing droop below horizontal, radians: at rest / at full spin
      let pos = (DISC_UP + DISC_DOWN) / 2, flip = 0, sigma = 1;   // sigma: +1 = floor is on the loop side, -1 = floor is on the rope-end side
      if (animated) {
        if (t < 4.5)       { pos = DISC_UP + (DISC_DOWN - DISC_UP) * (t / 4.5);                flip = 0;                        sigma = 1; }
        else if (t < 6)    { pos = DISC_DOWN;                                                  flip = Math.PI * (t - 4.5) / 1.5; sigma = 1 - 2 * smooth((t - 4.9) / 1.1); }
        else if (t < 10.5) { pos = DISC_DOWN + (DISC_UP - DISC_DOWN) * ((t - 6) / 4.5);        flip = Math.PI;                  sigma = -1; }
        else               { pos = DISC_UP;                                                    flip = Math.PI + Math.PI * (t - 10.5) / 1.5; sigma = -1 + 2 * smooth((t - 11.0) / 1.0); }
      }
      const spinFrac = animated ? omega(t) / WSPIN : 0;
      const wing = animated ? sigma * (D_REST - (D_REST - D_FLAT) * spinFrac) : 0.5;
      const theta = animated ? spinAt(t) : s * 0.9;
      flipG.rotation.z = flip;
      discG.rotation.z = 0;
      discG.position.y = DISC_C + pos;
      bend.uBend.value = wing;                                             // wings always hang from the disc in a cone (never inverted)
      body.rotation.y = theta;
      rings.forEach(r => { r.rotation.y = theta; });
      spin.rotation.z = 0; spin.rotation.y = 0;
    },
  };
}

// Squishy spiral ring, rebuilt from separate fins: 80 thin curved plates strung along a closed loop. The loop can stretch, bend into an
// amoeba shape and twist; because the fins keep their size, they spread apart with real gaps when the loop gets longer (like a spring).
async function buildDonut() {
  const FINS = 80;
  const mat = new THREE.MeshStandardMaterial({ color: 0xff9d1c, roughness: 0.38, metalness: 0.05, side: THREE.DoubleSide });
  // one fin: a rounded, slightly cupped plate
  const shape = new THREE.Shape(); shape.absellipse(0, 0, 12, 10, 0, Math.PI * 2, false, 0);
  const fg = new THREE.ExtrudeGeometry(shape, { depth: 1.1, bevelEnabled: true, bevelSize: 0.35, bevelThickness: 0.35, bevelSegments: 2, curveSegments: 28 });
  fg.translate(0, 0, -0.55);
  { const pos = fg.attributes.position; for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); pos.setZ(i, pos.getZ(i) + 0.035 * x * x - 1.6); } }  // cupped like a scoop
  fg.computeVertexNormals();
  const fins = new THREE.InstancedMesh(fg, mat, FINS);
  const spine = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, FINS);   // thin hinge strip joining neighbouring fins
  fins.frustumCulled = false; spine.frustumCulled = false;
  const ring = new THREE.Group(); ring.add(fins, spine);
  const tilt = new THREE.Group(); tilt.add(ring); tilt.rotation.x = 1.15;          // held face-on toward the viewer
  const lift = new THREE.Group(); lift.add(tilt); lift.position.y = 67;
  const spin = new THREE.Group(); spin.add(lift);
  const root = new THREE.Group(); root.add(spin);
  const css = n => '#' + n.toString(16).padStart(6, '0');
  const v = (hex, accent) => ({ accent, swatch: [css(hex)], colors: { donut: hex } });
  const pulse = (t, a, b) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return Math.sin(Math.PI * k) ** 2; };

  const SAMPLES = 480, curve = new Array(SAMPLES);
  const U = new THREE.Vector3(0, 1, 0), dummy = new THREE.Object3D(), m4 = new THREE.Matrix4();
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), N2 = new THREE.Vector3(), B2 = new THREE.Vector3(), T2 = new THREE.Vector3(), B3 = new THREE.Vector3();
  const qs = Array.from({ length: FINS }, () => new THREE.Vector3());
  function layout(open, stretch, saddle, twist, ph) {
    const R = 27 * (1 + 0.8 * open);
    const pts = new Array(SAMPLES), cum = new Float32Array(SAMPLES + 1);
    for (let j = 0; j < SAMPLES; j++) {
      const th = (j / SAMPLES) * Math.PI * 2;
      const r = R * (1 + 0.3 * stretch * Math.cos(2 * th + ph) + 0.11 * open * Math.cos(3 * th + 1.3 * ph) + 0.08 * stretch * Math.cos(th + 0.5 * ph));
      const y = 13 * saddle * Math.cos(2 * th + 0.5 * ph) + 6 * open * Math.sin(3 * th + ph);
      pts[j] = new THREE.Vector3(r * Math.cos(th), y, r * Math.sin(th));
    }
    for (let j = 0; j < SAMPLES; j++) cum[j + 1] = cum[j] + pts[j].distanceTo(pts[(j + 1) % SAMPLES]);
    const total = cum[SAMPLES];
    let j = 0;
    for (let i = 0; i < FINS; i++) {
      const target = (i / FINS) * total;                              // equal spacing along the loop
      while (j < SAMPLES - 1 && cum[j + 1] < target) j++;
      const f = (target - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      const p = pts[j].clone().lerp(pts[(j + 1) % SAMPLES], f);
      T.copy(pts[(j + 2) % SAMPLES]).sub(pts[(j + SAMPLES - 1) % SAMPLES]).normalize();
      N.crossVectors(U, T).normalize(); B.crossVectors(T, N);
      const th = Math.atan2(p.z, p.x), phi = 1.25 * twist * Math.sin(2 * th + ph), cp = Math.cos(phi), sp = Math.sin(phi);
      N2.copy(N).multiplyScalar(cp).addScaledVector(B, sp); B2.copy(B).multiplyScalar(cp).addScaledVector(N, -sp);
      const lean = 0.62, cl = Math.cos(lean), sl = Math.sin(lean);     // fins lean along the loop, like fanned pages
      T2.copy(T).multiplyScalar(cl).addScaledVector(B2, sl); B3.copy(B2).multiplyScalar(cl).addScaledVector(T, -sl);
      m4.makeBasis(N2, B3, T2).setPosition(p); fins.setMatrixAt(i, m4);
      qs[i].copy(p).addScaledVector(N2, -8);                           // hinge point on the inner side
    }
    for (let i = 0; i < FINS; i++) {
      const a = qs[i], b = qs[(i + 1) % FINS];
      dummy.position.copy(a).add(b).multiplyScalar(0.5); dummy.lookAt(b); dummy.scale.set(1.1, 1.1, a.distanceTo(b) + 0.6); dummy.updateMatrix();
      spine.setMatrixAt(i, dummy.matrix);
    }
    fins.instanceMatrix.needsUpdate = true; spine.instanceMatrix.needsUpdate = true;
  }
  layout(0, 0, 0, 0, 0);
  return {
    root, spin, mats: [mat], roles: { donut: mat }, swatchShape: 'square',
    variants: [v(0xff9d1c, '#ffb347'), v(0xf06aa8, '#ff7eb6'), v(0x00ae42, '#3fcf6b'), v(0x6b3f26, '#a06a45')],
    natural: 134, anim: 134, animCentre: 67,
    update(s, animated) {
      const T0 = 10, t = animated ? ((s % T0) + T0) % T0 : 0, W = 2 * Math.PI / T0;
      // rest -> pulled long into an amoeba shape with the fins spread apart -> twisted -> pinched -> released
      const open = animated ? Math.max(pulse(t, 2.0, 6.6), pulse(t, 6.8, 9.6) * 0.65) : 0;
      const stretch = animated ? Math.max(pulse(t, 0.8, 3.4) * 0.6, pulse(t, 2.6, 6.4), pulse(t, 6.6, 9.4) * 0.7) : 0;
      const saddle = animated ? Math.max(pulse(t, 2.4, 6.0), pulse(t, 6.6, 9.4) * 0.8) : 0;
      const twist = animated ? Math.max(pulse(t, 3.2, 6.6) * 0.9, pulse(t, 7.0, 9.6) * 0.5) : 0;
      layout(open, stretch, saddle, twist, animated ? t * W * 2 : 0);
      ring.rotation.y = animated ? Math.sin(t * W) * 0.5 : s * 0.4;
      tilt.rotation.x = 1.15 + (animated ? 0.15 * Math.sin(t * W * 2) : 0);
      spin.rotation.y = animated ? Math.sin(t * W) * 0.25 : 0;
    },
  };
}

async function buildSpiral() {
  // The taller, narrower spiral (green) is the inner piece; the shorter, wider one (orange) is the shell it screws through.
  const [gInner, gShell] = await Promise.all([loadGeometry('cono_outer'), loadGeometry('cono_inner')]);
  const inner = mesh(gInner, 0xe5231a, 0.5), shell = mesh(gShell, 0x17171c, 0.5);   // default: black shell, red inner
  const BASE = 39;                                   // both pieces are centred on the same height when nested
  shell.position.y = BASE; inner.position.y = BASE;
  const slide = new THREE.Group(); slide.add(inner);   // slide.position.y / rotation.y move the inner spiral as a screw
  const model = new THREE.Group(); model.add(shell, slide);
  const spin = new THREE.Group(); spin.add(model);
  const root = new THREE.Group(); root.add(spin);
  const css = n => '#' + n.toString(16).padStart(6, '0');
  const v = (a, b, accent) => ({ accent, swatch: a === b ? [css(a)] : [css(a), css(b)], colors: { shell: a, inner: b } });
  const BK = 0x17171c, WH = 0xf4f4f4, RD = 0xe5231a;
  const K = THREE.MathUtils.degToRad(5.4);              // the blades twist 5.4° per unit of height, so sliding along them = one full turn per ~66 units
  const U = 70, LOOP_S = 12;
  const sm = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  return {
    root, spin, mats: [inner.material, shell.material],
    roles: { inner: inner.material, shell: shell.material },
    swatchShape: 'wide',
    variants: [v(BK, RD, '#ff6a4d'), v(BK, BK, '#8a8f9c'), v(WH, WH, '#c9cfdc'), v(RD, RD, '#ff6a4d'), v(BK, WH, '#c9cfdc')],
    natural: 156, anim: 156, animCentre: 78,
    update(s, animated) {
      const t = animated ? ((s % LOOP_S) + LOOP_S) % LOOP_S : 0;
      // rest -> the inner spiral screws up and out through the shell (one full 360° twist) -> hovers -> screws back through -> rest
      const up = sm((t - 0.8) / 4.2) - sm((t - 6.4) / 4.2);
      slide.position.y = U * up; slide.rotation.y = K * U * up;
    },
  };
}

async function buildDino() {
  // A flat pixel dino rides on two geared wheels. The dino, the two weights and the axle hang together like a pendulum,
  // so the wheels roll underneath and the dino stays upright, leaning slightly as it speeds up and slows down.
  const names = ['dr_dino', 'dr_wheel', 'dr_wheel2', 'dr_weight', 'dr_weight2', 'dr_axle', 'dr_clip'];
  const [gd, gw1, gw2, gk1, gk2, ga, gc] = await Promise.all(names.map(n => loadGeometry(n)));
  const GREEN = 0x2fbf5a, BLUE = 0x1f78d1, BK = 0x17171c, RD = 0xe5231a, WH = 0xf4f4f4;
  const dino = mesh(gd, GREEN, 0.5), wheel1 = mesh(gw1, BLUE, 0.5), wheel2 = mesh(gw2, BLUE, 0.5);
  const weight1 = mesh(gk1, GREEN, 0.5), weight2 = mesh(gk2, GREEN, 0.5), axle = mesh(ga, GREEN, 0.5), clip = mesh(gc, GREEN, 0.5);
  dino.material.side = THREE.DoubleSide;
  // one shared material per colour role, so a colour change reaches every part (dino, weights, axle, clip / both wheels)
  weight1.material = weight2.material = axle.material = clip.material = dino.material; wheel2.material = wheel1.material;
  const PIV = 1.97;                                   // the axle height: the pendulum hangs from here
  const place = (m, x, y, z) => m.position.set(x, y, z);
  place(dino, 2.33, 19.92 - PIV, 6.5); place(weight1, 0, -7.25 - PIV, 10); place(weight2, 0, -7.25 - PIV, 6);
  place(axle, 0, 0, 9.1); place(clip, 0, 0.08 - PIV, -4.6);
  const pend = new THREE.Group(); pend.position.set(0, PIV, 0); pend.add(dino, weight1, weight2, axle, clip);
  place(wheel1, 0, -0.01, -2.25); place(wheel2, 0, -0.01, 15.25);
  const body = new THREE.Group(); body.add(pend, wheel1, wheel2); body.position.y = 25;   // wheel bottoms touch y = 0
  const travel = new THREE.Group(); travel.add(body);
  const spin = new THREE.Group(); spin.add(travel); spin.position.y = 14;   // centred in a taller frame, so the spin and roll never feel cramped
  const root = new THREE.Group(); root.add(spin);
  const css = n => '#' + n.toString(16).padStart(6, '0');
  const v = (a, b, accent) => ({ accent, swatch: [css(a), css(b)], colors: { body: a, wheels: b } });
  const R = 25, L = 52, LOOP_S = 12;
  const sm = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  // path: stand still -> flicked, it spins round on the spot -> rolls away -> wobbles to a stop -> turns round -> rolls back -> turns to face the front
  const pC = t => L * sm((t - 2.2) / 2.8), pF = t => L * sm((t - 7.2) / 2.8);
  const pos = t => pC(t) - pF(t), dist = t => pC(t) + pF(t);          // dist = how far the wheels have rolled forward
  const yawAt = t => 2 * Math.PI * sm((t - 1) / 1.3) + Math.PI * sm((t - 6) / 1.2) + Math.PI * sm((t - 10.2) / 1.3);
  const wob = (t, t0) => (t > t0 ? 0.2 * Math.exp(-1.7 * (t - t0)) * Math.sin(9 * (t - t0)) : 0);   // it rocks back and forth after stopping
  return {
    root, spin, mats: [dino, wheel1, wheel2, weight1, weight2, axle, clip].map(m => m.material),
    roles: { body: dino.material, wheels: wheel1.material },
    swatchShape: 'wide',
    variants: [v(GREEN, BLUE, '#4fd17a'), v(RD, BK, '#ff6a4d'), v(GREEN, WH, '#4fd17a')],
    natural: 118, anim: 118, animCentre: 59,
    update(s, animated) {
      if (!animated) { travel.position.x = 0; wheel1.rotation.z = wheel2.rotation.z = 0; pend.rotation.z = 0; spin.rotation.y = 0.3; return; }
      const t = ((s % LOOP_S) + LOOP_S) % LOOP_S, h = 0.08;
      travel.position.x = pos(t) - L / 2;
      const roll = -dist(t) / R; wheel1.rotation.z = roll; wheel2.rotation.z = roll;      // rolling without slipping
      const acc = (dist(t + h) - 2 * dist(t) + dist(t - h)) / (h * h);
      const flick = t > 1 && t < 1.5 ? -0.25 * Math.sin(Math.PI * (t - 1) / 0.5) : 0;      // a little jolt when it is flicked
      pend.rotation.z = THREE.MathUtils.clamp(acc * 0.0085, -0.3, 0.3) + wob(t, 5.0) + wob(t, 10.0) + flick;
      spin.rotation.y = 0.3 + yawAt(t);
    },
  };
}

async function buildSnake() {
  // An articulated snake printed as 34 separate linked pieces. Each piece is moved as a rigid body along a bending spine,
  // so the snake can uncoil, slither and curl back up.
  const m = (await manifest).snake;
  const buf = await (await fetch(import.meta.env.BASE_URL + 'models/' + m.file)).arrayBuffer();
  const nv = m.vertices;
  const rest = new Float32Array(buf.slice(0, nv * 12));
  const idxBody = new Uint32Array(buf.slice(nv * 12, nv * 12 + m.indices * 4));
  const idxEyes = new Uint32Array(buf.slice(nv * 12 + m.indices * 4, nv * 12 + (m.indices + m.eyeIndices) * 4));
  const pos = new THREE.BufferAttribute(new Float32Array(rest), 3).setUsage(THREE.DynamicDrawUsage);
  const gBody = new THREE.BufferGeometry(); gBody.setAttribute('position', pos); gBody.setIndex(new THREE.BufferAttribute(idxBody, 1));
  gBody.computeVertexNormals();
  const nor = gBody.attributes.normal; nor.setUsage(THREE.DynamicDrawUsage);
  const restN = new Float32Array(nor.array);
  const gEyes = new THREE.BufferGeometry(); gEyes.setAttribute('position', pos); gEyes.setAttribute('normal', nor); gEyes.setIndex(new THREE.BufferAttribute(idxEyes, 1));
  const PINK = 0xff6fae, BLUE = 0x2f8bff;
  const body = mesh(gBody, PINK, 0.42), eyes = mesh(gEyes, 0x101218, 0.25);
  body.frustumCulled = eyes.frustumCulled = false;
  // spine geometry in the snake's own plane (x, z): joint-to-joint links with fixed lengths
  const C = m.centroids.map(c => [c[0], c[2]]), N = C.length;
  const d = [], phi0 = [];
  for (let i = 0; i < N - 1; i++) { const dx = C[i + 1][0] - C[i][0], dz = C[i + 1][1] - C[i][1]; d.push(Math.hypot(dx, dz)); let a = Math.atan2(dz, dx); if (i) { while (a - phi0[i - 1] > Math.PI) a -= 2 * Math.PI; while (a - phi0[i - 1] < -Math.PI) a += 2 * Math.PI; } phi0.push(a); }
  const sArc = [0]; d.forEach(x => sArc.push(sArc[sArc.length - 1] + x));
  const headOf = phi => Array.from({ length: N }, (_, i) => (i === 0 ? phi[0] : i === N - 1 ? phi[N - 2] : (phi[i - 1] + phi[i]) / 2));
  const psi0 = headOf(phi0);
  const restMean = [C.reduce((a, c) => a + c[0], 0) / N, C.reduce((a, c) => a + c[1], 0) / N];
  const REST_W = Math.max(...C.map(c => c[0])) - Math.min(...C.map(c => c[0])), REST_H = Math.max(...C.map(c => c[1])) - Math.min(...C.map(c => c[1]));
  const spin = new THREE.Group(), tilt = new THREE.Group(), model = new THREE.Group();
  model.add(body, eyes); tilt.add(model); tilt.rotation.x = 0.78; spin.add(tilt);
  const root = new THREE.Group(); spin.position.y = 104; root.add(spin);   // offset lives on the inner group so the outer scale applies to it
  const css = n => '#' + n.toString(16).padStart(6, '0');
  const v = (c, accent) => ({ accent, swatch: [css(c)], colors: { body: c } });
  const LOOP_S = 12, sm = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  const phiT = new Float64Array(N - 1), cx = new Float64Array(N), cz = new Float64Array(N), psi = new Float64Array(N);
  const K = 2 * Math.PI / 280;      // wavelength ~280 mm: two gentle S-bends along the body, no loops crossing
  function pose(mix, ph) {
    for (let i = 0; i < N - 1; i++) { const sMid = (sArc[i] + sArc[i + 1]) / 2; const wave = 0.2 + 1.8 * Math.sin(K * sMid - ph); phiT[i] = phi0[i] * (1 - mix) + wave * mix; }
    cx[0] = C[0][0]; cz[0] = C[0][1];
    for (let i = 0; i < N - 1; i++) { cx[i + 1] = cx[i] + d[i] * Math.cos(phiT[i]); cz[i + 1] = cz[i] + d[i] * Math.sin(phiT[i]); }
    let mx = 0, mz = 0; for (let i = 0; i < N; i++) { mx += cx[i]; mz += cz[i]; } mx = mx / N - restMean[0]; mz = mz / N - restMean[1];
    for (let i = 0; i < N; i++) { cx[i] -= mx; cz[i] -= mz; }
    // never let the snake grow bigger than its coiled size on screen
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < N; i++) { x0 = Math.min(x0, cx[i]); x1 = Math.max(x1, cx[i]); z0 = Math.min(z0, cz[i]); z1 = Math.max(z1, cz[i]); }
    const sc = Math.min(1, 1.05 * REST_W / (x1 - x0), 1.05 * REST_H / (z1 - z0));
    model.scale.setScalar(sc); model.position.set(-restMean[0] * sc, 0, -restMean[1] * sc);   // keep the snake's middle on the pivot
    for (let i = 0; i < N; i++) psi[i] = i === 0 ? phiT[0] : i === N - 1 ? phiT[N - 2] : (phiT[i - 1] + phiT[i]) / 2;
  }
  // the head and neck rise off the floor like in the product photo: nose up, looking at the viewer
  const RISE = 6, HEAD_PITCH = 0.8, HEAD_LIFT = 30;
  const rise = k => Math.max(0, 1 - k / RISE);
  let raise = 1;                                   // 0 = flat on the floor, 1 = head fully raised
  function apply() {
    const P = pos.array, Nn = nor.array;
    for (let k = 0; k < N; k++) {
      const a = psi[k] - psi0[k], c = Math.cos(a), s = Math.sin(a), ox = C[k][0], oz = C[k][1], nx = cx[k], nz = cz[k];
      const r = rise(k) * raise, th = HEAD_PITCH * r * (k === 0 ? 1.15 : 1), lift = HEAD_LIFT * r * r * (k === 0 ? 1.1 : 1);
      const ct = Math.cos(th), st = Math.sin(th), fx = -Math.cos(psi[k]), fz = -Math.sin(psi[k]);   // f = direction towards the head
      for (let j = m.ranges[k][0] * 3, e = m.ranges[k][1] * 3; j < e; j += 3) {
        let x = rest[j] - ox, z = rest[j + 2] - oz, y = rest[j + 1];
        let rx = c * x - s * z, rz = s * x + c * z;
        let u = rx * fx + rz * fz;
        const u2 = u * ct - y * st, y2 = y * ct + u * st;
        P[j] = rx + (u2 - u) * fx + nx; P[j + 1] = y2 + lift; P[j + 2] = rz + (u2 - u) * fz + nz;
        const ax = restN[j], ay = restN[j + 1], az = restN[j + 2];
        const qx = c * ax - s * az, qz = s * ax + c * az, qu = qx * fx + qz * fz;
        const qu2 = qu * ct - ay * st, qy2 = ay * ct + qu * st;
        Nn[j] = qx + (qu2 - qu) * fx; Nn[j + 1] = qy2; Nn[j + 2] = qz + (qu2 - qu) * fz;
      }
    }
    pos.needsUpdate = true; nor.needsUpdate = true;
  }
  pose(0, 0); apply();
  return {
    root, spin, mats: [body.material, eyes.material],
    roles: { body: body.material },
    swatchShape: 'square',
    variants: [v(PINK, '#ff8cc0'), v(BLUE, '#5aa2ff')],
    natural: 208, anim: 208, animCentre: 104,
    update(s, animated) {
      if (!animated) { spin.rotation.y = 0.2; return; }
      const t = ((s % LOOP_S) + LOOP_S) % LOOP_S;
      // curled up -> uncurls -> slithers (a wave runs down the body) -> curls back up
      const mix = sm((t - 1.2) / 2.2) - sm((t - 8.6) / 2.4);
      pose(mix, Math.max(0, t - 2.2) * 2.4);
      apply();
      spin.rotation.y = 0.2 + 0.15 * Math.sin(s * 2 * Math.PI / LOOP_S);
    },
  };
}

async function buildBird() {
  // A balancing bird: the bird rests its beak on the tip of a curly green branch and rocks on it like a pendulum.
  const [gb, gs] = await Promise.all([loadGeometry('bird_body'), loadGeometry('bird_stem')]);
  const YELLOW = 0xd9ee2a, PINK = 0xff6f9c, RED = 0xe5382f, GREEN = 0x2fb88a;
  const bird = mesh(gb, YELLOW, 0.5), stem = mesh(gs, GREEN, 0.55);
  bird.material.side = THREE.DoubleSide;
  stem.position.y = 50;                                   // base of the stem sits on y = 0, its tip is at y = 100
  // the bird's own frame: x = wing span, y = towards the tail (-) and beak (+), z = thickness. Its beak tip sits on the pivot.
  const BEAK = new THREE.Vector3(0, 8.4, 1.0);
  const flat = new THREE.Group(); flat.add(bird); bird.position.copy(BEAK).multiplyScalar(-1);
  const lay = new THREE.Group(); lay.add(flat); lay.rotation.x = -Math.PI / 2;      // thickness axis -> up, tail -> towards the viewer
  const droop = new THREE.Group(); droop.add(lay); droop.rotation.x = 0.62;         // the tail fan hangs below the wings
  const rock = new THREE.Group(); rock.add(droop); rock.position.set(0, 100, 0);    // pivot: the tip of the branch
  const model = new THREE.Group(); model.add(stem, rock);
  const spin = new THREE.Group(); spin.add(model);
  const root = new THREE.Group(); root.add(spin);
  const css = n => '#' + n.toString(16).padStart(6, '0');
  const v = (c, accent) => ({ accent, swatch: [css(c)], colors: { bird: c } });
  const LOOP_S = 12;
  // damped swing after each nudge: angle = A * e^(-k t) * sin(w t)
  const swing = (t, t0, A, k, w) => (t < t0 ? 0 : A * Math.exp(-k * (t - t0)) * Math.sin(w * (t - t0)));
  return {
    root, spin, mats: [bird.material, stem.material],
    roles: { bird: bird.material },
    swatchShape: 'square',
    variants: [v(YELLOW, '#e4f24a'), v(PINK, '#ff8fb3'), v(RED, '#ff6a4d')],
    natural: 162, anim: 162, animCentre: 81,
    update(s, animated) {
      if (!animated) {   // menu icon: just the bird, facing the viewer, a little banked so it reads as 3D
        stem.visible = false; rock.rotation.set(0.45, Math.PI + 0.3, 0.12, "YXZ"); model.rotation.set(0, 0, 0); spin.rotation.y = 0; return;
      }
      stem.visible = true;
      const t = ((s % LOOP_S) + LOOP_S) % LOOP_S;
      // From the video: a flick sets the bird spinning on the branch tip. It turns round and round, slowing down, and leans over
      // (banks) towards one side as it goes, so the wings tip up and down as it comes round. A second flick repeats it.
      const PER = 6, F0 = 0.6, W0 = 5.5, KD = 0.4;
      const per = Math.floor((t - F0) / PER), u = t - F0 - per * PER;
      const yaw = per * 4 * Math.PI + W0 * (1 - Math.exp(-KD * u)) / KD;           // two full turns per flick
      const spd = W0 * Math.exp(-KD * u);                                           // current turning speed
      const lean = 0.1 + 0.5 * Math.pow(spd / W0, 0.6);                             // leans more the faster it turns
      const roll = lean * Math.cos(yaw), pitch = lean * 0.55 * Math.sin(yaw);
      rock.rotation.set(pitch, 0.5 + yaw, roll, 'YXZ');
      // the branch itself sways a little with the bird
      model.rotation.z = -roll * 0.05; model.rotation.x = pitch * 0.15;
      spin.rotation.y = 0.3 + 0.2 * Math.sin(s * 2 * Math.PI / LOOP_S);
    },
  };
}

async function buildPass() {
  // Two twisted hourglass pieces: the inner one is slightly smaller and screws up out through the slots of the outer one,
  // which looks impossible. Both are the same shape, so moving it along the axis while turning it keeps it in the slots.
  const [go, gi] = await Promise.all([loadGeometry('pt_outer'), loadGeometry('pt_inner')]);
  const BK = 0x17171c, WH = 0xf4f4f4;
  const outer = mesh(go, BK, 0.45), inner = mesh(gi, WH, 0.45);
  outer.position.y = 30; inner.position.y = 30;
  const slide = new THREE.Group(); slide.add(inner);
  const model = new THREE.Group(); model.add(outer, slide);
  const spin = new THREE.Group(); spin.add(model);
  const root = new THREE.Group(); root.add(spin);
  const css = n => '#' + n.toString(16).padStart(6, '0');
  const v = (a, b, accent) => ({ accent, swatch: a === b ? [css(a)] : [css(a), css(b)], colors: { outer: a, inner: b } });
  const K = THREE.MathUtils.degToRad(1.62) * PASS_DIR;     // the slots twist about 1.6 degrees per mm of height
  const U = 56, LOOP_S = 12;
  const sm = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  return {
    root, spin, mats: [outer.material, inner.material],
    roles: { outer: outer.material, inner: inner.material },
    swatchShape: 'wide',
    variants: [v(BK, WH, '#c9cfdc'), v(BK, BK, '#8a8f9c'), v(WH, WH, '#c9cfdc')],
    natural: 120, anim: 120, animCentre: 60,
    update(s, animated) {
      const t = animated ? ((s % LOOP_S) + LOOP_S) % LOOP_S : 0;
      // nested -> the inner piece screws up and out through the slots -> hangs in the air turning -> screws back in
      const up = sm((t - 0.8) / 3.4) - sm((t - 7.4) / 3.4);
      slide.position.y = U * up; slide.rotation.y = K * U * up;
      spin.rotation.y = animated ? 0.4 + 0.25 * Math.sin(s * 2 * Math.PI / LOOP_S) : 0.4;
    },
  };
}
const PASS_DIR = 1;

async function buildKatana() {
  // A fidget katana: an orange handle hides a stack of four nested black blade strips. One quick swish throws them all out
  // at once (the whole blade whips out and bounces), and it can be swished back in again.
  const [gh, gc, ...gb] = await Promise.all(['kt_handle', 'kt_cap', 'kt_b0', 'kt_b1', 'kt_b2', 'kt_b3'].map(n => loadGeometry(n)));
  const ORANGE = 0xff7a1a, RED = 0xe5231a, BLACK = 0x17171c;
  const handle = mesh(gh, ORANGE, 0.42), cap = mesh(gc, ORANGE, 0.42);
  const bladeMat = new THREE.MeshStandardMaterial({ color: BLACK, roughness: 0.3, metalness: 0.25, side: THREE.DoubleSide });
  // the innermost strip is the tip of the sword: taper its last 26 mm to a slightly narrower, rounded-off tip instead of a blunt square end
  const tipGeo = gb[0].clone(); { const P = tipGeo.attributes.position, L = 26; let y0 = 1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < P.count; i++) { y0 = Math.min(y0, P.getY(i)); z0 = Math.min(z0, P.getZ(i)); z1 = Math.max(z1, P.getZ(i)); }
    const zc = (z0 + z1) / 2;
    for (let i = 0; i < P.count; i++) { const d = (P.getY(i) - y0) / L; if (d < 1) { const k = 0.38 + 0.62 * Math.pow(Math.max(0, d), 1.2); P.setZ(i, zc + (P.getZ(i) - zc) * k); } }
    tipGeo.computeVertexNormals(); }
  const blades = [tipGeo, gb[1], gb[2], gb[3]].map(g => {
    const rest = new Float32Array(g.attributes.position.array), restN = new Float32Array(g.attributes.normal.array);
    const geo = g.clone(); geo.attributes.position.setUsage(THREE.DynamicDrawUsage); geo.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    const m = new THREE.Mesh(geo, bladeMat); m.frustumCulled = false;
    return { m, geo, rest, restN };
  });
  // model axis: y runs along the handle. The guard is at y = -89 (blade exits there), the pommel cap at y = +89.
  const GUARD = -89.3, S = 74;                         // S = how far each segment slides out of the one around it
  cap.position.y = 91;
  const model = new THREE.Group(); model.add(handle, cap, ...blades.map(b => b.m));
  // the sword is held upright (blade end up) and swings forward to the left, so it points left when thrown out
  const flip = new THREE.Group(); flip.add(model); flip.rotation.set(0, -Math.PI / 2, Math.PI);
  const swing = new THREE.Group(); swing.add(flip); flip.position.y = 0;              // pivot: the middle of the handle
  const place = new THREE.Group(); place.add(swing); place.position.set(120, 205, 0);
  const spin = new THREE.Group(); spin.add(place);
  const root = new THREE.Group(); root.add(spin);
  // bend every blade strip along a circular arc past the guard (kap < 0 curves the other way); q[k] is each segment's slide-out 0..1
  function bend(q, kap) {
    const straight = Math.abs(kap) < 1e-6, rr = straight ? 0 : 1 / kap;
    blades.forEach((b, k) => {
      let off = 0; for (let j = k; j < 4; j++) off += S * q[j];
      const P = b.geo.attributes.position.array, N = b.geo.attributes.normal.array, R = b.rest, RN = b.restN;
      for (let i = 0; i < R.length; i += 3) {
        const y = R[i + 1] - off, d = GUARD - y;
        let ny = RN[i + 1], nz = RN[i + 2];
        if (d <= 0 || straight) { P[i] = R[i]; P[i + 1] = y; P[i + 2] = R[i + 2]; }
        else {
          const ph = kap * d, c = Math.cos(ph), sn = Math.sin(ph), z0 = R[i + 2];
          P[i] = R[i]; P[i + 1] = GUARD - rr * sn - z0 * sn; P[i + 2] = rr * (1 - c) + z0 * c;
          const ny2 = ny * c - nz * sn, nz2 = ny * sn + nz * c; ny = ny2; nz = nz2;
        }
        N[i] = RN[i]; N[i + 1] = ny; N[i + 2] = nz;
      }
      b.geo.attributes.position.needsUpdate = true; b.geo.attributes.normal.needsUpdate = true;
    });
  }
  const css = n => '#' + n.toString(16).padStart(6, '0');
  const v = (h, b, accent) => ({ accent, swatch: h === b ? [css(h)] : [css(h), css(b)], colors: { body: h, cap: h, blade: b } });
  const LOOP_S = 7, sm = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  const lerp = (a, b, k) => a + (b - a) * k;
  // the throw: segments fly out together (tiny stagger), overshoot their stops, and snap home
  const springOut = tau => (tau <= 0 ? 0 : 1 - Math.exp(-9 * tau) * (Math.cos(26 * tau) + 0.35 * Math.sin(26 * tau)));
  const T_WIND = 0.3, T_SWISH = 0.7, T_SWISH_END = 1.05, T_BACK = 5.0, T_BACK_END = 6.1;   // short rest after closing, then straight into the next swish
  const q = [0, 0, 0, 0];
  bend(q, 0);
  return {
    root, spin, mats: [handle.material, cap.material, bladeMat],
    roles: { body: handle.material, cap: cap.material, blade: bladeMat },
    swatchShape: 'wide',
    variants: [v(ORANGE, BLACK, '#ff9a4a'), v(BLACK, ORANGE, '#ff9a4a'), v(ORANGE, ORANGE, '#ff9a4a'), v(BLACK, BLACK, '#8a8f9c')],
    natural: 410, anim: 410, animCentre: 205,
    update(s, animated) {
      if (!animated) { bladeMat.color.set(0x9aa0ae); q.fill(0.85); bend(q, 0); swing.rotation.z = 0.78; spin.rotation.y = 0; place.position.set(70, 150, 0); return; }
      // when the product is picked the sword first sits completely closed while it comes out of the printer; the swish starts after that
      const t = (((Math.max(0, s - 1.9)) % LOOP_S) + LOOP_S) % LOOP_S;
      // swing angle: 0 = sword upright, pi/2 = pointing sideways. Pull back a touch, then a fast swish forward that overshoots
      let ang;
      if (t < T_WIND) ang = 0.1 + 0.04 * Math.sin(t * 3);
      else if (t < T_SWISH) ang = lerp(0.1, -0.32, sm((t - T_WIND) / (T_SWISH - T_WIND)));             // wind up (back)
      else if (t < T_BACK) { const u = t - T_SWISH, base = lerp(-0.32, Math.PI / 2, Math.min(1, (u / 0.3) ** 2 * (3 - 2 * Math.min(1, u / 0.3)) * 0.35 + Math.min(1, u / 0.3) * 0.65)); ang = u < 0.3 ? base : Math.PI / 2 + 0.16 * Math.exp(-5 * (u - 0.3)) * Math.cos(9 * (u - 0.3)); }
      else if (t < T_BACK_END) ang = lerp(Math.PI / 2, 0.1, sm((t - T_BACK) / (T_BACK_END - T_BACK)));
      else ang = 0.1;
      swing.rotation.z = ang;
      // segments
      for (let k = 3; k >= 0; k--) {
        const tOut = T_SWISH + 0.06 + (3 - k) * 0.035, tIn = T_BACK + 0.12 + k * 0.12;
        const val = t < tIn ? springOut(t - tOut) : 1 - sm((t - tIn) / 0.55);
        q[k] = Math.min(1.15, Math.max(0, val));
      }
      const kap = 0;                                   // the blade is a rigid, straight sword
      bend(q, kap);
      spin.rotation.y = 0.12 * Math.sin(s * 2 * Math.PI / LOOP_S);
    },
  };
}

async function buildGhosts() {
  // Three slinky ghosts, each printed as one springy spiral. They are pulled up tall, wobble like a spring, and spring back.
  const geos = await Promise.all(['gh_large', 'gh_mid', 'gh_small'].map(n => loadGeometry(n)));
  const X = [-52, 8, 52], BASE_H = 6, WHITE = 0xdcdad2, GLOW = 0xa6f23a;   // a faint warm grey-cream so 'white' separates from the pale page
  const ghosts = geos.map((g, i) => {
    const u = { uS: { value: 1 }, uBase: { value: BASE_H } };
    const mat = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'uniform float uS; uniform float uBase;\nvoid main() {')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          { float h = max(0., position.y - uBase); transformed.y = position.y + h * (uS - 1.0);
            float k = 1.0 - 0.07 * (uS - 1.0); transformed.x *= mix(1.0, k, smoothstep(0., 40., h)); transformed.z *= mix(1.0, k, smoothstep(0., 40., h)); }`);
    };
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.position.x = X[i];
    return { m, u, mat };
  });
  const model = new THREE.Group(); ghosts.forEach(g => model.add(g.m));
  const spin = new THREE.Group(); spin.add(model);
  const root = new THREE.Group(); root.add(spin);
  // side light from the left-front and a low cool fill from the right, so the ring ridges throw clear shadows
  const key = new THREE.DirectionalLight(0xfff1dc, 1.5); key.position.set(-260, 120, 140); root.add(key);
  const fill = new THREE.DirectionalLight(0xbfd2ff, 0.5); fill.position.set(240, 30, 60); root.add(fill);
  const css = n => '#' + n.toString(16).padStart(6, '0');
  const sz = (label, price) => ({ accent: '#9d8cff', swatch: [css(WHITE)], colors: { ghost: WHITE }, label, price });
  const LOOP_S = 12, sm = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  // pull to a stretch, hold, release: a spring bounce that dies out
  const pull = (t, t0, hold, rel, amp) => {
    if (t < t0) return 0;
    if (t < t0 + hold) return amp * sm((t - t0) / hold);
    const tau = t - (t0 + hold + rel * 0);
    return amp * Math.exp(-3.2 * tau) * Math.cos(11 * tau);
  };
  const TIMES = [0.8, 4.2, 7.6], AMP = [1.0, 1.15, 1.5];
  return {
    root, spin, mats: ghosts.map(g => g.mat),
    roles: { ghost: ghosts[0].mat },
    swatchShape: 'square',
    variants: [sz('L', 3), sz('M', 2), sz('S', 1)],
    selected: 0, glowBoost: 0.72,
    natural: 190, anim: 190, animCentre: 80,
    update(s, animated) {
      // menu icon: just the big ghost, centred and facing front
      if (!animated) { ghosts.forEach((g, i) => { g.m.visible = i === 0; g.m.position.x = 0; g.m.rotation.y = 0; g.u.uS.value = 1; }); spin.rotation.y = 0; return; }
      // one ghost at a time: the chosen size (Large by default), at its true size relative to the others, pulled like a slinky
      const sel = this.selected ?? 0;
      const t = ((s % 6) + 6) % 6, amp = [0.95, 1.1, 1.5][sel];
      ghosts.forEach((g, i) => {
        g.m.visible = i === sel; g.m.position.x = 0; g.m.scale.setScalar([1.15, 0.97, 0.58][i]);
        g.u.uS.value = i === sel ? Math.max(0.8, 1 + pull(t, 0.6, 1.0, 0, amp)) : 1;
        g.m.rotation.y = 0.2 * Math.sin(s * 2 * Math.PI / 6);
      });
      spin.rotation.y = animated ? 0.1 * Math.sin(s * 2 * Math.PI / LOOP_S) : -0.2;
    },
  };
}

async function buildAlien() {
  // A cute articulated alien. The head (with its dark eyes) turns and nods on the neck while the body sways.
  const [gb, gh, ge] = await Promise.all(['al_body', 'al_head', 'al_eyes'].map(n => loadGeometry(n)));
  const GREEN = 0x2fcf7c;
  const body = mesh(gb, GREEN, 0.5), head = mesh(gh, GREEN, 0.5), eyes = mesh(ge, 0x101218, 0.25);
  const NECK = 3.5;                                                   // height of the neck joint
  const headG = new THREE.Group(); headG.position.y = NECK; head.position.y = -NECK; eyes.position.y = -NECK; headG.add(head, eyes);
  const model = new THREE.Group(); model.add(body, headG); model.position.y = 25.1;   // feet on y = 0
  const sway = new THREE.Group(); sway.add(model);
  const spin = new THREE.Group(); spin.add(sway);
  const root = new THREE.Group(); root.add(spin);
  const css = n => '#' + n.toString(16).padStart(6, '0');
  const v = (c, accent) => ({ accent, swatch: [css(c)], colors: { body: c } });
  const LOOP_S = 10;
  return {
    root, spin, mats: [body.material, head.material, eyes.material],
    roles: { body: body.material, head: head.material },
    swatchShape: 'square',
    variants: [v(GREEN, '#5fe0a0'), v(0xa7adb8, '#c9cfdc'), v(0xff8a8a, '#ffa8a8'), v(0x7a52e0, '#9d85f0')],
    natural: 58, anim: 58, animCentre: 29,
    update(s, animated) {
      const k = 2 * Math.PI / LOOP_S;
      if (!animated) { spin.rotation.y = 0.45; headG.rotation.set(0, 0.25, 0); sway.rotation.set(0, 0, 0); return; }
      spin.rotation.y = 0.9 * Math.sin(s * k);                          // turns to show off every side
      headG.rotation.set(0.12 * Math.sin(s * k * 3), 0.55 * Math.sin(s * k * 2 + 0.6), 0.1 * Math.sin(s * k * 3 + 1.2));   // curious head tilts and nods
      sway.rotation.set(0.03 * Math.sin(s * k * 3), 0, 0.05 * Math.sin(s * k * 2));
      model.position.y = 25.1 + 0.5 * Math.abs(Math.sin(s * k * 3));    // a little bounce
    },
  };
}

// Names shown in the cart for each colour option (same order as the swatch buttons)
export const COLOR_NAMES = {
  wand: ['Black & Green', 'Black & White', 'White & Black'],
  egg: ['Green', 'Pink', 'Red', 'White'],
  star: ['Red', 'Orange', 'Green'],
  donut: ['Orange', 'Pink', 'Green', 'Brown'],
  alien: ['Green', 'Grey', 'Pink', 'Purple'],
  ghosts: ['Large', 'Medium', 'Small'],
  katana: ['Orange & Black', 'Black & Orange', 'Orange', 'Black'],
  pass: ['Black & White', 'Black', 'White'],
  bird: ['Yellow', 'Pink', 'Red'],
  snake: ['Pink', 'Blue'],
  dino: ['Green & Blue', 'Red & Black', 'Green & White'],
  spiral: ['Black & Red', 'Black', 'White', 'Red', 'Black & White'],
};

export const TOYS = [
  { id: 'wand', name: 'Pumpkin Spinner Wand', short: 'Pumpkin Wand',
    tag: 'Spin & slide', blurb: 'A jack-o’-lantern on a twisted spindle. Move the wand and the pumpkin spins up and down the spiral.',
    build: buildWand, duration: 12, price: 8, plateHeight: 138, demoHeight: 110, thumb: { cy: 141, h: 272, t: 0 } },
  { id: 'egg', name: 'Raindrop Dragon Egg', short: 'Dragon Egg',
    tag: 'Twist to open', blurb: 'Turn the scaly top shell and the raindrop window opens. Twist it back and the egg closes.',
    build: buildEgg, duration: 8, price: 10, plateHeight: 112, demoHeight: 90, thumb: { cy: 25, h: 54, t: 0.5 } },
  { id: 'star', name: 'Spinner Fidget Star', short: 'Fidget Star',
    tag: '', blurb: '',
    build: buildStar, duration: 12, price: 10, plateHeight: 138, demoHeight: 110, thumb: { cy: 146, h: 288, t: 0 } },
  { id: 'donut', name: 'Squishy Spiral Donut', short: 'Spiral Donut',
    tag: '', blurb: '',
    build: buildDonut, duration: 10, price: 5, plateHeight: 120, demoHeight: 110, thumb: { cy: 67, h: 112, t: 1 } },
  { id: 'spiral', name: 'Conoidal Spiral Fidget', short: 'Spiral Fidget',
    tag: '', blurb: '',
    build: buildSpiral, duration: 12, price: 5, plateHeight: 130, demoHeight: 110, thumb: { cy: 39, h: 80, t: 0 } },
  { id: 'dino', name: 'Dino Run Balancing Wheel', short: 'Dino Run',
    tag: '', blurb: '',
    build: buildDino, duration: 12, price: 5, plateHeight: 118, demoHeight: 110, thumb: { cy: 52, h: 112, t: 0 } },
  { id: 'snake', name: 'Articulated Snake', short: 'Snake',
    tag: '', blurb: '',
    build: buildSnake, duration: 12, price: 6, plateHeight: 128, demoHeight: 110, thumb: { cy: 78, h: 215, t: 0 } },
  { id: 'bird', name: 'Balancing Bird', short: 'Balancing Bird',
    tag: '', blurb: '',
    build: buildBird, duration: 12, price: 3, plateHeight: 128, demoHeight: 110, thumb: { cy: 98, h: 112, t: 0 } },
  { id: 'pass', name: 'Impossible Passthrough', short: 'Passthrough',
    tag: '', blurb: '',
    build: buildPass, duration: 12, price: 5, plateHeight: 126, demoHeight: 110, thumb: { cy: 30, h: 76, t: 0 } },
  { id: 'katana', name: 'Dragonite Katana', short: 'Katana',
    tag: '', blurb: '',
    build: buildKatana, duration: 7, price: 12, plateHeight: 132, demoHeight: 110, thumb: { cy: 150, h: 340, t: 0 } },
  { id: 'ghosts', name: 'Slinky Ghosts', short: 'Slinky Ghosts',
    tag: '', blurb: '',
    build: buildGhosts, duration: 6, price: 3, plateHeight: 124, demoHeight: 110, thumb: { cy: 37, h: 92, t: 0 } },
  { id: 'alien', name: 'Cute Alien', short: 'Cute Alien',
    tag: '', blurb: '',
    build: buildAlien, duration: 10, price: 5, plateHeight: 124, demoHeight: 110, thumb: { cy: 28, h: 62, t: 0 } },
];
