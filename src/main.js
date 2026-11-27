import { buildFloaters } from './floaters.js';
import * as THREE from 'three';
import { TOYS, COLOR_NAMES } from './toys.js';
import { mountMenu } from './menu-root.tsx';

const params = new URLSearchParams(location.search);
const FROZEN = params.has('t') ? Number(params.get('t')) : null;
const TITLE_LIFT = 52;
const N = TOYS.length;

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
  const holder = new THREE.Group(); holder.visible = false;
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

// ── landing ⇄ hero: pick an icon in the printer → the printer goes out of focus, the product comes out of it and plays until the visitor clicks away ──
let focus = -1;          // product picked (-1 = landing)
let shown = -1;          // product currently drawn (stays set while it goes back into the printer)
let prog = 0;            // 0 = inside the printer … 1 = presented
let uiOn = false, pickedAt = 0;
const EMERGE_S = 1.5, ease = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const menuHost = document.getElementById('menu-root'), chooseEl = document.getElementById('choose');
const setUI = on => [document.getElementById('info'), document.getElementById('swatches'), document.getElementById('buy'), document.getElementById('closebtn')].forEach(e => e.classList.toggle('out', !on));
function selectToy(i) {
  if (focus >= 0 || prog > 0) return;
  focus = shown = i; pickedAt = performance.now(); uiOn = false; items[i].t0 = clock.elapsedTime;   // animation starts from its first frame as it comes out
  document.getElementById('name').textContent = TOYS[i].name; renderSwatches(i); showBuy(); setUI(false);
}
function closeToy() { if (focus < 0) return; focus = -1; uiOn = false; setUI(false); }
// the product only closes from the Close button (or Esc), so a stray tap elsewhere never dismisses it
document.getElementById('closebtn').onclick = closeToy;
addEventListener('keydown', e => { if (e.key === 'Escape' && focus >= 0 && !drawer.classList.contains('on')) closeToy(); });

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
const menu = mountMenu(menuHost, TOYS.map((m, i) => ({ id: m.id, label: m.name, image: thumbs[i], accent: items[i].toy.variants[0].accent })), selectToy);
const placeChoose = () => { chooseEl.style.top = menuHost.getBoundingClientRect().bottom + 30 + 'px'; };
menuHost.addEventListener('fit', placeChoose); new ResizeObserver(placeChoose).observe(menuHost); placeChoose();
const infoEl = document.getElementById('info');

function resize() {
  renderer.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); placeChoose();
}
addEventListener('resize', resize); resize();
setUI(false);
// ── shop: price, quantity and add to cart ──
const buyEl = document.getElementById('buy'), qval = document.getElementById('qval'), cartEl = document.getElementById('cart');
const qtyOf = TOYS.map(() => 1);
const cart = {};                                   // one line per toy AND colour: 'toyIndex:variantIndex' -> quantity
const linesOf = () => Object.entries(cart).filter(([, q]) => q > 0).map(([k, q]) => { const [i, v] = k.split(':').map(Number); return { k, i, v, q }; });
const money = n => '$' + n;
function showBuy() {
  if (focus < 0) return;
  const m = TOYS[focus];
  document.getElementById('price').innerHTML = `<span class="cur">$</span>${m.price}`;
  qval.textContent = qtyOf[focus]; document.getElementById('qminus').disabled = qtyOf[focus] <= 1;
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
  qr.innerHTML = `<div class="frame"><img alt="${label} QR code" data-ext="0" src="${import.meta.env.BASE_URL}pay/${id}.png"></div><div class="note">Scan to pay <b>${money(total)}</b> with ${label}</div>`;
  const img = qr.querySelector('img');
  img.onerror = () => {
    const n = +img.dataset.ext + 1;
    if (n < EXT.length) { img.dataset.ext = n; img.src = `${import.meta.env.BASE_URL}pay/${id}.${EXT[n]}`; }
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
const floaters = buildFloaters(); scene.add(floaters.group);
let started = false, startedAt = 0;
menuHost.style.visibility = 'hidden';
function startTour() {
  if (started) return; started = true; startedAt = clock.elapsedTime;
  document.getElementById('twel').classList.remove('on'); document.body.classList.remove('intro');
  menuHost.style.visibility = 'visible';
  const base = menuHost.style.transform;
  menuHost.animate([{ opacity: 0, transform: `${base} translateY(40px) scale(.9)` }, { opacity: 1, transform: base }], { duration: 1100, delay: 500, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
  setTimeout(() => started && menu.setDoorOpen(true), 1700); bumpIdle();   // the door swings open once, then stays open
}
document.getElementById('tstart').onclick = startTour;

// ── kiosk reset: after a quiet spell (or on demand) the cart is emptied and the page returns to the welcome screen ──
const IDLE_S = params.has('idle') ? Number(params.get('idle')) : 90;
let resetting = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// order: product goes back in → door closes → printer slips away → welcome screen returns
async function resetAll() {
  if (resetting || !started) return; resetting = true; clearTimeout(idleTimer);
  closeToy(); openDrawer(false);
  for (const k of Object.keys(cart)) delete cart[k];
  qtyOf.fill(1); payTab = 0;
  items.forEach(it => { const v0 = it.toy.variants[0]; it.variant = 0; it.glow.set(v0.accent); for (const [r, hex] of Object.entries(v0.colors)) it.targets[r].set(hex); });
  showCart();
  while (prog > 0) await sleep(60);
  await sleep(250); menu.setDoorOpen(false);
  await sleep(1750);
  const base = menuHost.style.transform;
  await menuHost.animate([{ opacity: 1, transform: base }, { opacity: 0, transform: `${base} translateY(40px) scale(.9)` }], { duration: 800, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' }).finished;
  menuHost.style.visibility = 'hidden'; menuHost.getAnimations().forEach(an => an.cancel());
  started = false; floaters.group.visible = true; floaters.group.scale.setScalar(1);
  document.body.classList.add('intro'); document.getElementById('twel').classList.add('on');
  resetting = false;
}
window.__reset = resetAll;
let idleTimer = 0;
const bumpIdle = () => { clearTimeout(idleTimer); if (started && !resetting && IDLE_S > 0) idleTimer = setTimeout(resetAll, IDLE_S * 1000); };
['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, bumpIdle, { passive: true }));
document.getElementById('startover').onclick = resetAll;
addEventListener('keydown', e => { if (e.key === 'Home' && e.shiftKey) resetAll(); });
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), s = FROZEN ?? clock.elapsedTime;
  const goal = focus >= 0 ? 1 : 0;
  prog += Math.sign(goal - prog) * Math.min(Math.abs(goal - prog), dt / EMERGE_S);
  if (prog === 0 && focus < 0) shown = -1;
  const u = ease(prog);
  if (focus >= 0 && prog >= 1 && !uiOn) { uiOn = true; setUI(true); }
  const busy = focus >= 0 || prog > 0;
  menuHost.style.pointerEvents = busy || !started || resetting ? 'none' : ''; menu.setBusy(busy); menuHost.classList.toggle('locked', busy || !started || resetting);
  menuHost.style.filter = u > 0.001 ? `blur(${(u * 20).toFixed(2)}px) brightness(${(1 + 0.35 * u).toFixed(3)})` : '';
  menuHost.style.opacity = (1 - 0.74 * u).toFixed(3);
  const introK = started && !resetting ? Math.min(1, Math.max(0, (clock.elapsedTime - startedAt - 1.7) / 0.8)) : 0;
  chooseEl.style.opacity = introK * (1 - Math.min(1, u * 2.5));
  const kc = 1 - Math.exp(-dt * 10);
  items.forEach((it, i) => {
    it.holder.visible = i === shown;
    if (i !== shown) return;
    setOpacity(it.toy.mats, Math.min(1, u * 3));
    for (const [role, col] of Object.entries(it.targets)) it.toy.roles[role].color.lerp(col, kc);
    it.plate.userData.glow.material.color.lerp(it.glow, kc);
    it.plate.userData.glow.material.opacity = 0.32 * Math.min(1, u * 1.5);
    it.toy.update(FROZEN !== null ? s : s - (it.t0 ?? 0), true);
  });
  if (shown >= 0) {
    if (started) floaters.group.visible = false;
    const it = items[shown], H = it.meta.plateHeight, narrow = cam.aspect < 1;
    // hero fits between the title and the buy bar, centred on the page
    const titleTop = Math.max(92, innerHeight * 0.115);
    infoEl.style.top = titleTop + 'px';
    // small / portrait screens: colours sit in a row above the price bar instead of down the side, so nothing can overlap
    const rowUI = innerWidth < 900 || innerHeight < 620;
    const narrowUI = innerWidth < 520, BUY_TOP = innerHeight - (narrowUI ? 108 : 84), SW_TOP = BUY_TOP - 62;
    const R0 = titleTop + infoEl.offsetHeight + 26, R1 = rowUI ? SW_TOP - 18 : innerHeight - 112;
    cam.position.set(0, narrow ? 190 : 120, narrow ? 640 : 430); cam.lookAt(0, 62, 0);
    const proj = yy => (1 - new THREE.Vector3(0, yy, 0).project(cam).y) / 2 * innerHeight;
    cam.zoom = 1; cam.clearViewOffset(); cam.updateProjectionMatrix();
    const span = proj(0) - proj(H);
    cam.zoom = Math.max(0.3, Math.min(2, (R1 - R0) * 0.88 / span)); cam.updateProjectionMatrix();
    const mid = (proj(0) + proj(H)) / 2;
    // it comes out of the printer's middle and settles into the hero position
    const target = innerHeight * 0.47 + ((R0 + R1) / 2 - innerHeight * 0.47) * u;
    cam.setViewOffset(innerWidth, innerHeight, 0, -(target - mid), innerWidth, innerHeight);
    const sc = 0.28 + 0.72 * u; it.holder.scale.setScalar(sc); it.holder.position.y = H * 0.5 * (1 - sc);
    if (rowUI) { Object.assign(swEl.style, { top: SW_TOP + 'px', left: '50%', right: 'auto', transform: 'translateX(-50%)', flexDirection: 'row' }); }
    else { Object.assign(swEl.style, { top: (R0 + R1) / 2 + 'px', left: '', right: '', transform: '', flexDirection: '' }); }
    const front = new THREE.Vector3(0, 0, 22).project(cam);
    buyEl.style.top = rowUI ? BUY_TOP + 'px' : Math.min(innerHeight - 74, Math.max(R0 + 120, (1 - front.y) / 2 * innerHeight + 22)) + 'px';
    // Close sits on its own, just to the right of the buy bar (under it on narrow phones)
    { const br = buyEl.getBoundingClientRect(), cb = document.getElementById('closebtn');
      if (innerWidth - br.right > 84) { cb.style.left = br.right + 16 + 'px'; cb.style.top = br.bottom - cb.offsetHeight - 6 + 'px';   /* same base line as the bar */ }
      else { cb.style.left = br.left + br.width / 2 - 24 + 'px'; cb.style.top = br.bottom + 4 + 'px'; } }
    renderer.render(scene, cam);
  } else if (floaters.group.visible) {
    // welcome: a few toys drift about behind the logo; they shrink away once the tour starts
    const k = started ? Math.max(0, 1 - (clock.elapsedTime - startedAt) / 1.1) : 1;
    floaters.group.scale.setScalar(Math.max(0.0001, ease(k))); if (started && k <= 0) floaters.group.visible = false;
    floaters.update(s, cam.aspect);
    cam.position.set(0, 0, 430); cam.lookAt(0, 0, 0); cam.zoom = 1; cam.clearViewOffset(); cam.updateProjectionMatrix();
    renderer.render(scene, cam);
  } else renderer.clear();
  requestAnimationFrame(frame);
}
frame();
window.__ready = true;
if (params.has('i')) { startTour(); setTimeout(() => selectToy(Number(params.get('i'))), 3200); }


// ── leaving by accident: warn before a refresh / close if there is something in progress ──
addEventListener('beforeunload', e => {
  const busy = started && !resetting && (focus >= 0 || linesOf().length > 0 || drawer.classList.contains('on'));
  if (busy) { e.preventDefault(); e.returnValue = ''; return ''; }
});
