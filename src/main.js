import * as THREE from 'three';
import { TOYS, COLOR_NAMES } from './toys.js';
import { mountMenu } from './menu-root.tsx';

const params = new URLSearchParams(location.search);
const FROZEN = params.has('t') ? Number(params.get('t')) : null;
const TITLE_LIFT = 52;
let gliding = null;
/** Slow ease-in-out scroll to a page. Scroll-snap and CSS smooth-scroll are paused while it runs. */
function glide(page, ms = 1900) {
  const from = scrollY, to = page * innerHeight, root = document.documentElement;
  if (Math.abs(to - from) < 2) return;
  cancelAnimationFrame(gliding); root.style.scrollSnapType = 'none'; root.style.scrollBehavior = 'auto';
  const t0 = performance.now();
  const stop = () => { cancelAnimationFrame(gliding); gliding = null; root.style.scrollSnapType = ''; root.style.scrollBehavior = ''; removeEventListener('wheel', stop); removeEventListener('touchstart', stop); };
  addEventListener('wheel', stop, { passive: true, once: true }); addEventListener('touchstart', stop, { passive: true, once: true });
  const step = now => {
    const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    scrollTo({ top: from + (to - from) * e, behavior: 'instant' });
    if (k < 1) gliding = requestAnimationFrame(step); else stop();
  };
  gliding = requestAnimationFrame(step);
}
const N = TOYS.length, PAGE_DY = 520;

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(30, 1, 1, 4000);
scene.add(new THREE.AmbientLight(0xffffff, 0.9), new THREE.HemisphereLight(0xffffff, 0xffffff, 0.6));
for (const [c, i, x, y, z] of [[0xffffff, 1.1, 150, 250, 300], [0xffffff, 0.7, -250, 50, 300], [0xffffff, 0.5, -250, 100, -200]]) {
  const l = new THREE.DirectionalLight(c, i); l.position.set(x, y, z); scene.add(l);
}

// one scroll page per toy
const pagesEl = document.getElementById('pages');
TOYS.forEach(() => { const d = document.createElement('section'); d.className = 'page'; pagesEl.appendChild(d); });

// ── build plate: small, pale, quiet ──
const PLATE = 150, T = 5;
function plateTexture() {
  const PX = 8, n = PLATE * PX, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, n, n); grad.addColorStop(0, '#f6f7fb'); grad.addColorStop(1, '#e9ebf3');
  g.fillStyle = grad; g.fillRect(0, 0, n, n);
  g.strokeStyle = 'rgba(40,50,90,0.07)'; g.lineWidth = 1.5; g.beginPath();
  for (let mm = 10; mm < PLATE; mm += 10) { g.moveTo(mm * PX, 0); g.lineTo(mm * PX, n); g.moveTo(0, mm * PX); g.lineTo(n, mm * PX); }
  g.stroke();
  g.strokeStyle = 'rgba(40,50,90,0.12)'; g.lineWidth = 3; g.beginPath(); g.arc(n / 2, n / 2, n * 0.34, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const plateTex = plateTexture();
const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c);
})();
function makePlate() {
  const r = 22, w = PLATE, sh = new THREE.Shape(), a = -w / 2, b = w / 2;
  sh.moveTo(a + r, a); sh.lineTo(b - r, a); sh.quadraticCurveTo(b, a, b, a + r); sh.lineTo(b, b - r); sh.quadraticCurveTo(b, b, b - r, b);
  sh.lineTo(a + r, b); sh.quadraticCurveTo(a, b, a, b - r); sh.lineTo(a, a + r); sh.quadraticCurveTo(a, a, a + r, a);
  const g = new THREE.Group();
  const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: T, bevelEnabled: true, bevelSize: 2, bevelThickness: 2, bevelSegments: 5, curveSegments: 18 }),
    new THREE.MeshStandardMaterial({ color: 0xe4e7f0, roughness: 0.55, metalness: 0.05 }));
  slab.rotation.x = -Math.PI / 2; slab.position.y = -T - 2;
  const tg = new THREE.ShapeGeometry(sh, 18), tp = tg.attributes.position, uv = tg.attributes.uv;
  for (let k = 0; k < tp.count; k++) uv.setXY(k, tp.getX(k) / w + 0.5, tp.getY(k) / w + 0.5);
  const top = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: plateTex, emissive: 0xffffff, emissiveMap: plateTex, emissiveIntensity: 0.12, roughness: 0.7, metalness: 0 }));
  top.rotation.x = -Math.PI / 2; top.position.y = 0.05;
  // soft coloured glow + contact shadow under the plate
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(w * 2.3, w * 2.3), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xb6ff1a, transparent: true, opacity: 0.32, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = -T - 6;
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.95, w * 0.95), new THREE.MeshBasicMaterial({ map: glowTex, color: 0x20243a, transparent: true, opacity: 0.16, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -T - 5;
  glow.position.y = -0.6; shadow.position.y = -0.3; shadow.material.opacity = 0.22;
  g.add(glow, shadow); g.userData.glow = glow; return g; // no plate: just a soft glow + contact shadow
}

const setOpacity = (mats, o) => mats.forEach(m => { m.transparent = o < 0.999; m.opacity = o; });
const items = [];
await Promise.all(TOYS.map(async (meta, i) => {
  const toy = await meta.build();
  const holder = new THREE.Group(); holder.position.y = -i * PAGE_DY;
  const plate = makePlate(); holder.add(plate);
  toy.root.scale.setScalar(meta.plateHeight / toy.natural);
  holder.add(toy.root); scene.add(holder);
  const first = toy.variants[0].colors;
  items[i] = { meta, toy, holder, plate, glow: new THREE.Color(toy.variants[0].accent), variant: 0, targets: Object.fromEntries(Object.entries(first).map(([k, v]) => [k, new THREE.Color(v)])) };
}));

// ── colour capsules ──
const swEl = document.getElementById('swatches');
function renderSwatches(i) {
  swEl.replaceChildren();
  items[i].toy.variants.forEach((v, k) => {
    const b = document.createElement('button'); b.className = 'sw ' + (items[i].toy.swatchShape ?? 'square'); b.setAttribute('aria-pressed', k === items[i].variant);
    b.setAttribute('aria-label', `Colour option ${k + 1}`);
    v.swatch.forEach(c => { const h = document.createElement('i'); h.style.background = c; b.appendChild(h); });
    b.onclick = () => {
      items[i].variant = k; items[i].glow.set(v.accent);
      for (const [role, hex] of Object.entries(v.colors)) items[i].targets[role].set(hex);
      [...swEl.children].forEach((e, j) => e.setAttribute('aria-pressed', j === k));
    };
    swEl.appendChild(b);
  });
}

// ── scroll → hero ──
let focus = -1;
const progress = () => scrollY / innerHeight;
let cur = Math.min(N - 1, Math.max(0, Number(params.get('i') ?? progress())));
if (params.has('i')) scrollTo({ top: innerHeight * Number(params.get('i')), behavior: 'instant' });
function setFocus(i) {
  if (i === focus) return; focus = i;
  if (items[i]) { items[i].t0 = clock ? clock.elapsedTime : 0; items[i].lastK = 0; }  // restart this toy's animation from the beginning
  infoEl.classList.add('out'); document.getElementById('buy').classList.add('out'); moveInd();
  setTimeout(() => { renderSwatches(focus); showInfo(); window.__showBuy?.(); infoEl.classList.remove('out'); }, 220);
}

// ── floating glass dock: little picture of each toy ──
async function makeThumb(meta) {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(168, 168, false); r.setPixelRatio(1); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.NoToneMapping; r.setClearColor(0x000000, 0);
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 1, 3000);
  sc.add(new THREE.AmbientLight(0xffffff, 0.9), new THREE.HemisphereLight(0xffffff, 0xffffff, 0.6));
  for (const x of [-220, 220]) { const rl = new THREE.DirectionalLight(0xffffff, 1.6); rl.position.set(x, 120, -260); sc.add(rl); } // rim light: dark parts read on dark glass
  const k = new THREE.DirectionalLight(0xffffff, 1.1); k.position.set(150, 250, 300); sc.add(k);
  const f = new THREE.DirectionalLight(0xffffff, 0.7); f.position.set(-250, 50, 300); sc.add(f);
  const toy = await meta.build(); sc.add(toy.root); toy.update(meta.thumb.t, false);
  const d = (meta.thumb.h * 1.15) / (2 * Math.tan(THREE.MathUtils.degToRad(15)));
  cam.position.set(0, meta.thumb.cy + 8, d); cam.lookAt(0, meta.thumb.cy, 0);
  r.render(sc, cam); const url = r.domElement.toDataURL('image/png'); r.dispose(); r.forceContextLoss(); return url;
}
const thumbs = await Promise.all(TOYS.map(makeThumb));
const menu = mountMenu(document.getElementById('menu-root'),
  TOYS.map((m, i) => ({ id: m.id, label: m.name, image: thumbs[i], accent: items[i].toy.variants[0].accent })),
  i => {  // menu pick: go straight to that product (no sweep through the ones in between)
    cancelAnimationFrame(gliding); const root = document.documentElement;
    root.style.scrollSnapType = 'none'; root.style.scrollBehavior = 'auto';
    scrollTo({ top: i * innerHeight, behavior: 'instant' }); cur = i;
    requestAnimationFrame(() => { root.style.scrollSnapType = ''; root.style.scrollBehavior = ''; });
  });
function moveInd() { menu.setActive(focus); }
const infoEl = document.getElementById('info');
function showInfo() {
  const m = TOYS[focus];
  document.getElementById('name').textContent = m.name;
}


function resize() {
  renderer.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
}
addEventListener('resize', () => { resize(); moveInd(); }); resize();

setFocus(Math.round(cur)); moveInd(); showInfo(); infoEl.classList.remove('out');
// ── shop: price, quantity and add to cart ──
const buyEl = document.getElementById('buy'), qval = document.getElementById('qval'), cartEl = document.getElementById('cart');
const qtyOf = TOYS.map(() => 1);
const cart = {};                                   // one line per toy AND colour: 'toyIndex:variantIndex' -> quantity
const linesOf = () => Object.entries(cart).filter(([, q]) => q > 0).map(([k, q]) => { const [i, v] = k.split(':').map(Number); return { k, i, v, q }; });
const money = n => '$' + n;
function showBuy() {
  const m = TOYS[focus];
  document.getElementById('price').innerHTML = `<span class="cur">$</span>${m.price}`;
  qval.textContent = qtyOf[focus]; document.getElementById('qminus').disabled = qtyOf[focus] <= 1;
  buyEl.classList.remove('out');
}
function showCart() {
  const L = linesOf(), n = L.reduce((a, l) => a + l.q, 0), total = L.reduce((a, l) => a + l.q * TOYS[l.i].price, 0);
  document.getElementById('cartn').textContent = n; document.getElementById('carttotal').textContent = money(total);
}
document.getElementById('qminus').onclick = () => { qtyOf[focus] = Math.max(1, qtyOf[focus] - 1); showBuy(); };
document.getElementById('qplus').onclick = () => { qtyOf[focus] = Math.min(99, qtyOf[focus] + 1); showBuy(); };
document.getElementById('add').onclick = e => {
  const key = `${focus}:${items[focus].variant}`;     // the colour that is selected right now
  cart[key] = (cart[key] ?? 0) + qtyOf[focus]; qtyOf[focus] = 1; showBuy(); showCart();
  const b = e.currentTarget, lab = document.getElementById('addlabel');
  b.classList.add('done'); lab.textContent = 'Added'; cartEl.classList.add('bump');
  setTimeout(() => { b.classList.remove('done'); lab.textContent = 'Add to cart'; cartEl.classList.remove('bump'); }, 1300);
};
window.__showBuy = showBuy; showBuy(); showCart();

// ── cart drawer + payment QR codes (images live in /public/pay/) ──
const PAY = [['venmo', 'Venmo'], ['cashapp', 'Cash App'], ['zelle', 'Zelle']];
const EXT = ['png', 'jpg', 'jpeg', 'webp'];
let payTab = 0;
const drawer = document.getElementById('drawer'), scrim = document.getElementById('scrim');
const thumbOf = i => thumbs[i];
function renderDrawer() {
  const L = linesOf(), total = L.reduce((a, l) => a + l.q * TOYS[l.i].price, 0);
  document.getElementById('dtotal').textContent = money(total);
  const chip = sw => `<span class="chip">${sw.map(c => `<i style="background:${c}"></i>`).join('')}</span>`;
  // one block per product, with a sub-line for every colour of it
  const rows = TOYS.map((m, i) => {
    const subs = L.filter(l => l.i === i); if (!subs.length) return '';
    const qty = subs.reduce((a, l) => a + l.q, 0);
    return `<div class="prod"><div class="line head"><img src="${thumbOf(i)}" alt=""><div class="nm">${m.name}<small>${money(m.price)} each</small></div>
      <div class="pq">&times; ${qty}</div><div class="amt">${money(qty * m.price)}</div></div>
      ${subs.map(({ k, v, q }) => `<div class="line sub"><div class="nm">${chip(items[i].toy.variants[v].swatch)}${COLOR_NAMES[m.id]?.[v] ?? 'Colour ' + (v + 1)}</div>
        <div class="st"><button data-d="-1" data-k="${k}" aria-label="Less">&minus;</button><output>${q}</output><button data-d="1" data-k="${k}" aria-label="More">+</button></div>
        <div class="amt">${money(q * m.price)}</div></div>`).join('')}</div>`;
  }).join('');
  document.getElementById('lines').innerHTML = rows || '<div class="empty">Your cart is empty.</div>';
  const [id, label] = PAY[payTab];
  document.getElementById('tabs').innerHTML = PAY.map(([k, l], j) => `<button role="tab" aria-selected="${j === payTab}" data-t="${j}">${l}</button>`).join('');
  const qr = document.getElementById('qr');
  qr.innerHTML = `<div class="frame"><img alt="${label} QR code" data-ext="0" src="/pay/${id}.png"></div><div class="note">Scan to pay <b>${money(total)}</b> with ${label}</div>`;
  const img = qr.querySelector('img');
  img.onerror = () => {
    const n = +img.dataset.ext + 1;
    if (n < EXT.length) { img.dataset.ext = n; img.src = `/pay/${id}.${EXT[n]}`; }
    else img.parentElement.innerHTML = `<div class="miss">${label} QR image not found.<br>Add <b>public/pay/${id}.png</b></div>`;
  };
}
function openDrawer(on) {
  if (on) renderDrawer();
  drawer.classList.toggle('on', on); scrim.classList.toggle('on', on); drawer.setAttribute('aria-hidden', String(!on));
  if (on) document.getElementById('dclose').focus(); else cartEl.focus();
}
cartEl.onclick = () => openDrawer(true);
scrim.onclick = () => openDrawer(false);
document.getElementById('dclose').onclick = () => openDrawer(false);
addEventListener('keydown', e => { if (e.key === 'Escape' && drawer.classList.contains('on')) openDrawer(false); });
document.getElementById('tabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { payTab = +b.dataset.t; renderDrawer(); } };
document.getElementById('lines').onclick = e => {
  const b = e.target.closest('[data-k]'); if (!b) return;
  cart[b.dataset.k] = Math.max(0, cart[b.dataset.k] + +b.dataset.d); showCart(); renderDrawer();
};
var clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), s = FROZEN ?? clock.elapsedTime;
  cur += (progress() - cur) * (FROZEN !== null ? 1 : 1 - Math.exp(-dt * 3.5));
  setFocus(Math.min(N - 1, Math.max(0, Math.round(cur))));
  const kc = 1 - Math.exp(-dt * 10);
  items.forEach((it, i) => {
    const d = Math.abs(cur - i);
    setOpacity(it.toy.mats, Math.max(0, 1 - d * 1.6));
    it.holder.visible = d < 1.2;
    if (!it.holder.visible) return;
    for (const [role, col] of Object.entries(it.targets)) it.toy.roles[role].color.lerp(col, kc);
    it.plate.userData.glow.material.color.lerp(it.glow, kc);
    {
      // aura: a soft halo that swells and brightens while the page glides, then settles
      const g = it.plate.userData.glow, move = Math.min(1, Math.abs(progress() - cur) * 2.2);
      it.aura = (it.aura ?? 0) + (move - (it.aura ?? 0)) * (1 - Math.exp(-dt * 4));
      g.material.opacity = 0.32 + 0.4 * it.aura; g.scale.setScalar(1 + 0.45 * it.aura);
    }
    it.toy.update(FROZEN !== null ? s : s - (it.t0 ?? 0), true);
  });
  // camera glides down the stack of plates; each plate is one page
  const y = -cur * PAGE_DY, narrow = cam.aspect < 1;
  // Layout: the title's top lines up with the top of the printer; the hero fits between the title and the printer's bottom.
  const printerEl = document.querySelector('#menu-root nav');
  const pr = printerEl ? printerEl.getBoundingClientRect() : { top: 0, bottom: 0, height: 0 };
  if (pr.height > 0) {
    const titleTop = Math.max(70, pr.top - TITLE_LIFT);   // title rides a little above the printer's top edge
    infoEl.style.top = titleTop + 'px';
    const titleBottom = titleTop + infoEl.offsetHeight;
    const R0 = titleBottom + 26, R1 = pr.bottom - 96;   // leave room for the buy bar under the hero
    const i0 = Math.min(N - 1, Math.max(0, Math.floor(cur))), i1 = Math.min(N - 1, i0 + 1), f = cur - i0;
    const H = TOYS[i0].plateHeight * (1 - f) + TOYS[i1].plateHeight * f;
    cam.position.set(0, y + (narrow ? 190 : 120), narrow ? 640 : 430); cam.lookAt(0, y + 62, 0);
    const proj = yy => (1 - new THREE.Vector3(0, y + yy, 0).project(cam).y) / 2 * innerHeight;
    const offX = -innerWidth * 0.07;
    cam.zoom = 1; cam.setViewOffset(innerWidth, innerHeight, offX, 0, innerWidth, innerHeight); cam.updateProjectionMatrix();
    const span = proj(0) - proj(H);
    cam.zoom = Math.max(0.3, Math.min(2, (R1 - R0) / span)); cam.updateProjectionMatrix();
    const mid = (proj(0) + proj(H)) / 2;
    cam.setViewOffset(innerWidth, innerHeight, offX, -((R0 + R1) / 2 - mid), innerWidth, innerHeight);
    swEl.style.top = (R0 + R1) / 2 + 'px';
    // buy bar sits just under the hero's actual base on screen (front edge, with perspective), so it never overlaps the animation
    const front = new THREE.Vector3(0, y, 22).project(cam);
    const baseY = (1 - front.y) / 2 * innerHeight;
    buyEl.style.top = Math.min(innerHeight - 74, Math.max(R0 + 120, baseY + 22)) + 'px';
  }
  renderer.render(scene, cam);
  requestAnimationFrame(frame);
}
frame();
window.__ready = true;

// ── guided tour: a big floating box. Each product slides in, plays one full animation loop while its colours change on their own,
//    then slides out and the next one slides in. It only opens when the visitor presses the button. ──
const tourBtn = document.getElementById('tour'), tourBox = document.getElementById('tourbox'), tourScrim = document.getElementById('tourscrim');
const tCanvas = document.getElementById('tourcv');
let tRenderer2 = null, tScene2 = null, tRenderer = null, tScene = null, tCam = null, tToys = null, tRaf = 0, tState = null;
const IN_S = 1.1, OUT_S = 0.9;                       // slide durations (seconds)
const easeIO = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

function addLights(sc) {
  sc.add(new THREE.AmbientLight(0xffffff, 0.9), new THREE.HemisphereLight(0xffffff, 0xffffff, 0.6));
  for (const [i, x, y, z] of [[1.1, 150, 250, 300], [0.7, -250, 50, 300], [0.5, -250, 100, -200]]) { const l = new THREE.DirectionalLight(0xffffff, i); l.position.set(x, y, z); sc.add(l); }
}
let tPrinter = null, tDoor = null, tSteps = [];
function buildPrinter() {
  const g = new THREE.Group(), W = 118, H = 156, D = 100, t = 7;
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, metalness: 0.55, roughness: 0.38 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xc9ced8, metalness: 0.8, roughness: 0.3 });
  const wall = new THREE.MeshStandardMaterial({ color: 0xe9ecf2, roughness: 0.9, emissive: 0x8a909c, emissiveIntensity: 0.35 });
  const led = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const box = (w, h, d, m, x, y, z, par = g) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); par.add(b); return b; };
  box(W, t, D, alu, 0, H / 2 - t / 2, 0);
  box(W, t + 6, D, dark, 0, -H / 2 + (t + 6) / 2, 0);
  box(t, H, D, dark, -W / 2 + t / 2, 0, 0); box(t, H, D, dark, W / 2 - t / 2, 0, 0);
  box(W, H, 3, wall, 0, 0, -D / 2 + 1.5);
  box(W - 2 * t - 8, 3, D - 28, alu, 0, -22, 0);                   // build plate
  box(W - 2 * t, 1.5, 3, led, 0, H / 2 - t - 2, D / 2 - 6);        // light strip
  const lamp = new THREE.PointLight(0xffffff, 1.4, 260); lamp.position.set(0, 20, 30); g.add(lamp);
  // brand strip
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64; const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.font = '600 34px Helvetica, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  if ('letterSpacing' in c) c.letterSpacing = '8px'; c.fillText('CREALITY 3D', 256, 34);
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(64, 8), new THREE.MeshBasicMaterial({ map: tx, transparent: true }));
  lab.position.set(0, -H / 2 + 6, D / 2 + 0.3); g.add(lab);
  // hinged glass door (left hinge)
  const door = new THREE.Group(); door.position.set(-W / 2, 0, D / 2 + 1);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(W - 4, H - 22, 1.4), new THREE.MeshStandardMaterial({ color: 0x8d99ad, transparent: true, opacity: 0.26, metalness: 0.2, roughness: 0.1, depthWrite: false }));
  glass.position.set(W / 2, 0, 0); door.add(glass);
  box(W, 3, 3, alu, W / 2, (H - 22) / 2, 0, door); box(W, 3, 3, alu, W / 2, -(H - 22) / 2, 0, door);
  box(3, H - 22, 3, alu, 0, 0, 0, door); box(3, H - 22, 3, alu, W, 0, 0, door);
  box(3, 34, 6, alu, W - 12, 0, 4, door);
  g.add(door); tDoor = door;
  return g;
}
async function ensureTour() {
  if (tRenderer) return;
  tRenderer = new THREE.WebGLRenderer({ canvas: tCanvas, antialias: true, alpha: true });
  tRenderer.setPixelRatio(Math.min(devicePixelRatio, 2)); tRenderer.outputColorSpace = THREE.SRGBColorSpace; tRenderer.toneMapping = THREE.NoToneMapping;
  tRenderer.setClearColor(0x000000, 0);
  tScene = new THREE.Scene(); tCam = new THREE.PerspectiveCamera(30, 1, 1, 4000);
  addLights(tScene);
  // the printer lives on its own canvas behind the products so it can be blurred (out of focus) while a product presents itself
  tRenderer2 = new THREE.WebGLRenderer({ canvas: document.getElementById('tourcv2'), antialias: true, alpha: true });
  tRenderer2.setPixelRatio(Math.min(devicePixelRatio, 2)); tRenderer2.outputColorSpace = THREE.SRGBColorSpace; tRenderer2.toneMapping = THREE.NoToneMapping; tRenderer2.setClearColor(0x000000, 0);
  tScene2 = new THREE.Scene(); addLights(tScene2);
  tPrinter = buildPrinter(); tPrinter.visible = false; tScene2.add(tPrinter);
  tToys = await Promise.all(TOYS.map(async meta => {
    const toy = await meta.build();
    const sc = (meta.plateHeight * 1.08) / toy.natural;
    toy.root.scale.setScalar(sc); toy.root.position.y = -(meta.plateHeight * 1.08) / 2;
    const holder = new THREE.Group(); holder.add(toy.root); holder.visible = false; tScene.add(holder);
    return { meta, toy, holder, col: toy.variants.map(v => Object.fromEntries(Object.entries(v.colors).map(([k, h]) => [k, new THREE.Color(h)]))) };
  }));
}
function tResize() {
  if (!tRenderer) return;
  const w = tCanvas.clientWidth, h = tCanvas.clientHeight; if (!w || !h) return;
  tRenderer.setSize(w, h, false); tRenderer2.setSize(w, h, false); tCam.aspect = w / h; tCam.updateProjectionMatrix();
  tCam.position.set(0, 0, 340 * Math.max(1, 1.15 / tCam.aspect)); tCam.lookAt(0, 0, 0);
}
function tourDots(on = -1) { document.getElementById('tdots').innerHTML = TOYS.map((_, i) => `<i class="${i === on ? 'on' : ''}"></i>`).join(''); }
// timeline: welcome → printer appears → door opens → (product comes out → plays → goes back) × products → door closes
const OUT_D = 1.4, BACK_D = 1.2;
function buildSteps() {
  const s = [{ k: 'welcome', d: Infinity }, { k: 'printer', d: 1.6 }, { k: 'open', d: 1.5 }];
  TOYS.forEach((m, i) => s.push({ k: 'out', d: OUT_D, i }, { k: 'play', d: m.duration, i }, { k: 'back', d: BACK_D, i }));
  s.push({ k: 'close', d: 1.5 }, { k: 'end', d: 0.9 });
  return s;
}
const twel = document.getElementById('twel'), ttBox = document.querySelector('#tourbox .tt');
function enterStep(st) {
  twel.classList.toggle('on', st.k === 'welcome');
  tPrinter.visible = st.k !== 'welcome';
  tToys.forEach((t, k) => { t.holder.visible = st.i === k; });
  if (st.k === 'out') {
    const T = tToys[st.i]; for (const [r, c] of Object.entries(T.col[0])) T.toy.roles[r].color.copy(c);
    document.getElementById('ttitle').textContent = T.meta.name; ttBox.classList.add('on'); tourDots(st.i); tState.v = -1;
  }
  if (st.k === 'back') ttBox.classList.remove('on');
  if (st.k === 'close') tourDots(-1);
}
const backOut = k => { const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
function tourFrame() {
  tRaf = requestAnimationFrame(tourFrame);
  if (!tState) return;
  const now = performance.now() / 1000, dt = Math.min(0.05, now - (tState.last ?? now)); tState.last = now;
  let st = tSteps[tState.n];
  while (now - tState.t0 >= st.d) {
    tState.t0 += st.d; tState.n++;
    if (tState.n >= tSteps.length) { closeTour(); return; }
    st = tSteps[tState.n]; enterStep(st);
  }
  const el = now - tState.t0, k = Math.min(1, el / st.d), n = tState.n, last = tSteps.length - 2;
  const door = n < 2 ? 0 : n === 2 ? easeIO(k) : n < last ? 1 : n === last ? 1 - easeIO(k) : 0;
  tDoor.rotation.y = -1.75 * door;
  const u = st.k === 'out' ? easeIO(k) : st.k === 'play' ? 1 : st.k === 'back' ? 1 - easeIO(k) : 0;
  const ps = st.k === 'printer' ? Math.max(0.001, backOut(k)) : n < 1 ? 0.001 : 1;
  tPrinter.scale.setScalar(ps * 0.82); tPrinter.position.set(0, 0, -260 * u);
  if (st.i !== undefined) {
    const T = tToys[st.i], D = T.meta.duration;
    T.holder.scale.setScalar(0.28 + 0.72 * u); T.holder.position.set(0, 0, -6 * (1 - u));
    const tt = st.k === 'out' ? el : st.k === 'play' ? OUT_D + el : OUT_D + D + el;
    T.toy.update(tt, true);
    const nv = T.toy.variants.length, vi = Math.min(nv - 1, Math.floor(Math.min(tt, OUT_D + D - 0.01) / ((OUT_D + D) / nv)));
    const kk = 1 - Math.exp(-dt * 5);
    for (const [role, col] of Object.entries(T.col[vi])) T.toy.roles[role].color.lerp(col, kk);
  }
  const cv2 = tRenderer2.domElement; cv2.style.filter = u > 0.001 ? `blur(${(u * 9).toFixed(2)}px)` : ''; cv2.style.opacity = 1 - 0.25 * u;
  tRenderer2.render(tScene2, tCam); tRenderer.render(tScene, tCam);
}
async function openTour() {
  if (tState) return;
  tourBtn.disabled = true; tourBtn.querySelector('span').textContent = 'Loading…';
  await ensureTour();
  tourBtn.disabled = false; tourBtn.querySelector('span').textContent = 'Take the tour';
  tourBox.classList.add('on'); tourScrim.classList.add('on'); tourBox.setAttribute('aria-hidden', 'false'); document.documentElement.style.overflow = 'hidden';
  tSteps = buildSteps(); tResize(); tourDots(-1);
  tState = { n: 0, t0: performance.now() / 1000, v: -1 }; enterStep(tSteps[0]);
  cancelAnimationFrame(tRaf); tourFrame(); document.getElementById('tclose').focus();
}
function closeTour() {
  tState = null; cancelAnimationFrame(tRaf); twel.classList.remove('on'); ttBox.classList.remove('on');
  tourBox.classList.remove('on'); tourScrim.classList.remove('on'); tourBox.setAttribute('aria-hidden', 'true'); document.documentElement.style.overflow = '';
  tourBtn.focus();
}
tourBtn.onclick = openTour;
document.getElementById('tstart').onclick = () => { if (tState && tState.n === 0) { tSteps[0].d = 0; tState.t0 = performance.now() / 1000; } };
document.getElementById('tclose').onclick = closeTour; tourScrim.onclick = closeTour;
addEventListener('keydown', e => { if (e.key === 'Escape' && tState) closeTour(); });
addEventListener('resize', tResize);
