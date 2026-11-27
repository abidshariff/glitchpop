import * as THREE from 'three';

/** Subtle floating toys for the welcome screen: little dinosaurs, pumpkins and glossy dots. */
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05, ...extra });

function pumpkin() {
  // a pumpkin octopus: ribbed pumpkin body with eight curling tentacles
  const g = new THREE.Group(), body = mat(0xff7a1a), legMat = mat(0xff8a2e);
  const geo = new THREE.SphereGeometry(1, 36, 24), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), th = Math.atan2(z, x), rib = 1 + 0.09 * Math.cos(th * 9);
    p.setXYZ(i, x * rib, y * 0.82, z * rib);
  }
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, body));
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.34, 10), mat(0x5b8a2b)); stem.position.y = 0.86; stem.rotation.z = 0.2; g.add(stem);
  for (const sx of [-0.36, 0.36]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), mat(0xffffff)); e.position.set(sx, 0.12, 0.88); const pu = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), mat(0x14161f)); pu.position.set(0, 0, 0.1); e.add(pu); g.add(e); }
  const legs = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, pivot = new THREE.Group(); pivot.position.set(Math.cos(a) * 0.55, -0.62, Math.sin(a) * 0.55); pivot.rotation.y = -a;
    const pts = [[0, 0, 0], [0.22, -0.32, 0], [0.4, -0.7, 0.05], [0.34, -1.05, 0.14], [0.14, -1.28, 0.1], [0.06, -1.4, 0]].map(v => new THREE.Vector3(...v));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.1, 8), legMat);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), legMat); tip.position.copy(pts[5]);
    pivot.add(tube, tip); g.add(pivot); legs.push(pivot);
  }
  g.userData.legs = legs; g.position.y = 0.5;
  const wrap = new THREE.Group(); wrap.add(g); wrap.userData.legs = legs; return wrap;
}

function dino(color) {
  const g = new THREE.Group(), m = mat(color, { flatShading: true }), plate = mat(0xffc24a, { flatShading: true });
  const add = (geo, x, y, z, mt = m, s = [1, 1, 1], r = [0, 0, 0]) => { const o = new THREE.Mesh(geo, mt); o.position.set(x, y, z); o.scale.set(...s); o.rotation.set(...r); g.add(o); return o; };
  add(new THREE.SphereGeometry(0.62, 14, 10), 0, 0, 0, m, [1.35, 0.9, 0.85]);                         // body
  add(new THREE.ConeGeometry(0.42, 1.5, 10), -1.25, -0.05, 0, m, [1, 1, 0.8], [0, 0, Math.PI / 2 + 0.12]);   // tail
  add(new THREE.CylinderGeometry(0.2, 0.3, 0.8, 8), 0.82, 0.5, 0, m, [1, 1, 1], [0, 0, -0.5]);           // neck
  add(new THREE.SphereGeometry(0.34, 12, 10), 1.12, 0.92, 0, m, [1.25, 0.9, 0.9]);                          // head
  add(new THREE.SphereGeometry(0.06, 8, 6), 1.3, 1.02, 0.26, mat(0x14161f)); add(new THREE.SphereGeometry(0.06, 8, 6), 1.3, 1.02, -0.26, mat(0x14161f));
  for (const [x, z] of [[0.5, 0.34], [0.5, -0.34], [-0.5, 0.34], [-0.5, -0.34]]) add(new THREE.CylinderGeometry(0.15, 0.13, 0.5, 8), x, -0.6, z);
  for (let i = 0; i < 5; i++) add(new THREE.ConeGeometry(0.17, 0.4, 4), 0.55 - i * 0.38, 0.52 - Math.abs(i - 2) * 0.07, 0, plate, [0.7, 1, 0.5]);   // back plates
  return g;
}

export function buildFloaters() {
  const group = new THREE.Group(), list = [];
  const place = (obj, size, x, y, z, spin) => {
    obj.scale.multiplyScalar(size); const h = new THREE.Group(); const legs = obj.userData.legs; h.add(obj); group.add(h);
    list.push({ h, legs, x, y, z, ax: 5 + Math.random() * 7, ay: 5 + Math.random() * 8, f: 0.25 + Math.random() * 0.35, ph: Math.random() * 6.3, spin, tilt: Math.random() * 0.5 });
  };
  const spots = [[-150, 70, -20], [152, 78, -30], [-154, -64, 0], [148, -72, -10], [-92, 98, -50], [96, -98, -30], [-112, -94, -40], [86, 102, -40]];
  const dinoCols = [0x35c77f, 0x4b8dff, 0xb36bff, 0xff7aa8];
  spots.slice(0, 4).forEach((s, i) => place(dino(dinoCols[i]), 6.5, ...s, 0.35));
  spots.slice(4).forEach((s, i) => place(pumpkin(), 5 + (i % 2) * 1, ...s, 0.5));
  const dotCols = [0x19c37d, 0x2f7dff, 0xff8a3d, 0xa35bff, 0xff6fa3];
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2, r = 95 + Math.random() * 80;
    place(new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat(dotCols[i % 5], { roughness: 0.2 })), 1.1 + Math.random() * 1.7, Math.cos(a) * r * 1.2, Math.sin(a) * r * 0.62, -60 + Math.random() * 90, 0);
  }
  return {
    group,
    update(t) { for (const o of list) {
      if (o.legs) o.legs.forEach((l, i) => { l.rotation.z = Math.sin(t * 1.6 + i * 0.8 + o.ph) * 0.22; }); o.h.position.set(o.x + Math.sin(t * o.f + o.ph) * o.ax, o.y + Math.cos(t * o.f * 0.8 + o.ph) * o.ay, o.z); o.h.rotation.set(o.tilt + t * 0.12 * o.spin, t * 0.35 * o.spin + o.ph, Math.sin(t * 0.3 + o.ph) * 0.2 * o.spin); } },
  };
}
