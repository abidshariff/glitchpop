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
  const HANDLE_TOP = 102, SLIDE_MIN = HANDLE_TOP + 32, SLIDE_MAX = 238;
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

// Names shown in the cart for each colour option (same order as the swatch buttons)
export const COLOR_NAMES = {
  wand: ['Black & Green', 'Black & White', 'White & Black'],
  egg: ['Green', 'Pink', 'Red', 'White'],
  star: ['Red', 'Orange', 'Green'],
  donut: ['Orange', 'Pink', 'Green', 'Brown'],
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
];
