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
  };
  const spindle = mesh(gs, 0xb6ff1a), pumpkin = new THREE.Mesh(gp, pumpkinMat), handle = mesh(gh, 0x16161c, 0.35), stem = mesh(gt, 0x6f5034);
  const HANDLE_TOP = 102, SLIDE_MIN = 120, SLIDE_MAX = 262;   // pumpkin body rests right on the handle at the bottom and reaches the star end at the top
  const CYCLE = 12;
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
        const sag = 1.7 - 1.45 * Math.pow(q, 0.7), g = Math.cos(flip);
        leg.uLeg.value = sag * (g >= 0 ? g : g * 0.5);
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
  const flipG = new THREE.Group(); flipG.position.y = 120.1; flipG.add(model); // pivot at the middle of the rope
  const spin = new THREE.Group(); spin.add(flipG);
  const root = new THREE.Group(); root.add(spin);
  const css = n => '#' + n.toString(16).padStart(6, '0');
  const v = (hex, accent) => ({ accent, swatch: [css(hex)], colors: { body: hex, ringA: hex, ringB: hex } });
  // spin speed ramps up and down once per loop; the integral is closed-form so the loop is seamless (6 turns per loop)
  const DISC_UP = 34, DISC_DOWN = 150; // disc positions along the rope (local +y = down in the scene)
  const CYCLE = 12;
  const SPIN_STEPS = 1440, spinTab = new Float32Array(SPIN_STEPS + 1);
  for (let i = 0, a = 0; i <= SPIN_STEPS; i++) {
    spinTab[i] = a;
    const t = (i / SPIN_STEPS) * CYCLE; let q = 0;
    if (t < 4) q = Math.sin(Math.PI * t / 4) ** 2; else if (t >= 6 && t < 10) q = Math.sin(Math.PI * (t - 6) / 4) ** 2;
    a += (1.0 + 13 * q) * (CYCLE / SPIN_STEPS);
  }
  const spinK = (2 * Math.PI * Math.round(spinTab[SPIN_STEPS] / (2 * Math.PI))) / spinTab[SPIN_STEPS];
  const spinAt = t => { const f = (t / CYCLE) * SPIN_STEPS, i = Math.min(SPIN_STEPS - 1, Math.floor(f)); return spinK * (spinTab[i] + (spinTab[i + 1] - spinTab[i]) * (f - i)); };
  return {
    root, spin, mats: [body.material, matA, matB],
    roles: { body: body.material, ringA: matA, ringB: matB },
    swatchShape: 'square',
    variants: [v(0xe5231a, '#ff5a4d'), v(0xff6a13, '#ff8a3d'), v(0x7bd62a, '#8be03a')],
    natural: 240.2, anim: 240.2, animCentre: 120.1,
    update(s, animated) {
      // Two steady spirals per 12 s loop, one in each orientation, joined by a quick half turn:
      //  A  0-4.5s   loop down : the disc spirals down the rope, rope end -> loop, at constant speed
      //  F1 4.5-6s   the toy turns over (steady turn, anticlockwise)
      //  C  6-10.5s  loop up   : the disc spirals down again, loop -> rope end
      //  F2 10.5-12s the toy turns back over
      // Nothing eases or reverses: every part moves at a constant rate.
      const t = ((s % CYCLE) + CYCLE) % CYCLE;
      const B = 0.7;                                   // wing angle, radians (+ toward the loop, - toward the rope end)
      let pos = (DISC_UP + DISC_DOWN) / 2, flip = 0, wing = 0.62;
      if (animated) {
        if (t < 4.5)       { const p = t / 4.5;          pos = DISC_UP + (DISC_DOWN - DISC_UP) * p;      flip = 0;                          wing = -B + 2 * B * p; }
        else if (t < 6)    { const p = (t - 4.5) / 1.5;  pos = DISC_DOWN;                                flip = Math.PI * p;                wing = B; }
        else if (t < 10.5) { const p = (t - 6) / 4.5;    pos = DISC_DOWN + (DISC_UP - DISC_DOWN) * p;    flip = Math.PI;                    wing = B - 2 * B * p; }
        else               { const p = (t - 10.5) / 1.5; pos = DISC_UP;                                  flip = Math.PI + Math.PI * p;      wing = -B; }
      }
      const theta = animated ? 2 * Math.PI * 12 * (t / CYCLE) : s * 0.9;   // constant spin, 12 turns per loop
      flipG.rotation.z = flip;
      discG.rotation.z = 0;
      discG.position.y = DISC_C + pos;
      bend.uBend.value = wing;                                             // wings fall from pointing up to pointing down on each run
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
  model.add(body, eyes); tilt.add(model); tilt.rotation.x = 1.12; spin.add(tilt);
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
  function apply() {
    const P = pos.array, Nn = nor.array;
    for (let k = 0; k < N; k++) {
      const a = psi[k] - psi0[k], c = Math.cos(a), s = Math.sin(a), ox = C[k][0], oz = C[k][1], nx = cx[k], nz = cz[k];
      for (let j = m.ranges[k][0] * 3, e = m.ranges[k][1] * 3; j < e; j += 3) {
        const x = rest[j] - ox, z = rest[j + 2] - oz;
        P[j] = c * x - s * z + nx; P[j + 1] = rest[j + 1]; P[j + 2] = s * x + c * z + nz;
        const ax = restN[j], az = restN[j + 2];
        Nn[j] = c * ax - s * az; Nn[j + 1] = restN[j + 1]; Nn[j + 2] = s * ax + c * az;
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

// Names shown in the cart for each colour option (same order as the swatch buttons)
export const COLOR_NAMES = {
  wand: ['Black & Green', 'Black & White', 'White & Black'],
  egg: ['Green', 'Pink', 'Red', 'White'],
  star: ['Red', 'Orange', 'Green'],
  donut: ['Orange', 'Pink', 'Green', 'Brown'],
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
    build: buildStar, duration: 12, price: 10, plateHeight: 138, demoHeight: 110, thumb: { cy: 120, h: 262, t: 0 } },
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
];
