import * as THREE from 'three';
import { makeCanvas, texFromCanvas, makeRng, TAU, lerp } from './utils.js';

const M = (geo, mat, parent, o = {}) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(o.x || 0, o.y || 0, o.z || 0);
  m.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
  m.castShadow = o.shadow !== false;
  if (parent) parent.add(m);
  return m;
};
const sph = (r, w = 14, h = 10, ps = 0, pl = Math.PI * 2, ts = 0, tl = Math.PI) => new THREE.SphereGeometry(r, w, h, ps, pl, ts, tl);
const cap = (r, l, s = 3, rad = 8) => new THREE.CapsuleGeometry(r, l, s, rad);
const cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s);
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.02, ...o });

export const VICTIM_KINDS = {
  perro: { label: 'Perro', animal: true, scale: 1.25, icon: '🐕' },
  gato: { label: 'Gato', animal: true, scale: 1.25, icon: '🐈' },
  ciervo: { label: 'Cervatillo', animal: true, scale: 1.0, icon: '🦌' },
  hombre: { label: 'Hombre', animal: false, scale: 1.25, icon: '👨' },
  mujer: { label: 'Mujer', animal: false, scale: 1.2, icon: '👩' },
  nino: { label: 'Niño', animal: false, scale: 0.95, icon: '👧' },
  anciano: { label: 'Anciano', animal: false, scale: 1.15, icon: '👴' },
};

const SKINS = [0xf1c9a5, 0xd9a27a, 0xb87a55, 0x8a5a3c, 0xf6d5b8];
const SHIRTS = [0x2a9d8f, 0xe76f51, 0x457b9d, 0xf4a261, 0x9b5de5, 0x2ec4b6, 0xe9c46a];
const PANTS = [0x264653, 0x3d405b, 0x5c4033, 0x1d3557];

function human(kind, seed) {
  const r = makeRng(seed);
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  const skin = std(r.pick(SKINS), { roughness: 0.6 });
  const shirt = std(r.pick(SHIRTS));
  const pants = std(r.pick(PANTS));
  const child = kind === 'nino';
  const elder = kind === 'anciano';
  const female = kind === 'mujer' || (child && r.chance(0.5));
  const hairCol = elder ? 0xe8e8ee : r.pick([0x2a1a10, 0x5a3a1a, 0x1a1a1a, 0xc08a3a, 0x7a2a1a]);
  const hairM = std(hairCol, { roughness: 0.9 });

  const legs = [];
  for (const s of [-1, 1]) {
    const lg = new THREE.Group();
    lg.position.set(s * 0.07, 0.42, 0);
    inner.add(lg);
    M(cap(0.055, 0.28), female && !child && r.chance(0.5) ? skin : pants, lg, { y: -0.2 });
    M(new THREE.BoxGeometry(0.1, 0.06, 0.16), std(0x222222), lg, { y: -0.42, z: 0.03 });
    legs.push(lg);
  }
  M(cap(0.115, 0.18), shirt, inner, { y: 0.6, sx: 1.1, sz: 0.8 });
  if (female && !child) M(cone(0.19, 0.24, 10), shirt, inner, { y: 0.42, rx: Math.PI });
  const head = new THREE.Group();
  head.position.y = 0.84;
  inner.add(head);
  const hr = child ? 0.16 : 0.135;
  M(sph(hr, 16, 12), skin, head, { y: hr * 0.7 });
  const eyeM = std(0x111111, { roughness: 0.2 });
  for (const s of [-1, 1]) {
    M(sph(hr * 0.13, 8, 6), eyeM, head, { x: s * hr * 0.4, y: hr * 0.78, z: hr * 0.9, shadow: false });
  }
  M(new THREE.TorusGeometry(hr * 0.28, hr * 0.03, 4, 10, Math.PI), std(0x7a2a2a), head, { y: hr * 0.5, z: hr * 0.92, rz: Math.PI, shadow: false });
  M(sph(hr * 0.09, 6, 5), std(0xd88a80), head, { y: hr * 0.62, z: hr * 1.0, shadow: false });
  // pelo
  if (elder) {
    M(sph(hr * 1.06, 12, 8, 0, TAU, 0, 1.4), hairM, head, { y: hr * 0.8, z: -hr * 0.1, sx: 1.02 });
    M(sph(hr * 0.12), std(0xdddddd), head, { x: hr * 0.4, y: hr * 0.66, z: hr * 0.98, shadow: false });
  } else if (female || child) {
    M(sph(hr * 1.1, 14, 10, 0, TAU, 0, 1.6), hairM, head, { y: hr * 0.75, z: -hr * 0.12 });
    if (r.chance(0.5)) {
      for (const s of [-1, 1]) M(cap(hr * 0.16, hr * 0.7), hairM, head, { x: s * hr * 0.95, y: hr * 0.2, z: -hr * 0.1 });
    } else M(sph(hr * 0.36, 8, 6), hairM, head, { y: hr * 1.75, z: -hr * 0.3 });
  } else {
    M(sph(hr * 1.06, 14, 10, 0, TAU, 0, 1.45), hairM, head, { y: hr * 0.78, z: -hr * 0.06 });
  }
  if (kind === 'hombre' && r.chance(0.6)) {
    M(cone(hr * 1.1, hr * 0.5, 14), std(0xd24a2a), head, { y: hr * 1.5, z: hr * 0.15, rx: -0.12 });
    M(new THREE.CylinderGeometry(hr * 1.25, hr * 1.25, 0.02, 14), std(0xd24a2a), head, { y: hr * 1.3, z: hr * 0.2 });
  }
  const arms = [];
  for (const s of [-1, 1]) {
    const ag = new THREE.Group();
    ag.position.set(s * 0.17, 0.7, 0);
    inner.add(ag);
    M(cap(0.04, 0.24), shirt, ag, { y: -0.14 });
    M(sph(0.045), skin, ag, { y: -0.31 });
    arms.push(ag);
  }
  if (elder) {
    // bastón
    const cane = new THREE.Group();
    cane.position.set(0.02, -0.28, 0.04);
    arms[1].add(cane);
    M(new THREE.CylinderGeometry(0.012, 0.012, 0.75, 6), std(0x5a3a1a), cane, { y: -0.3 });
  }
  return { root, inner, legs, arms, head, animal: false };
}

function furTex(base, spot, seed, spots = 0) {
  const c = makeCanvas(128);
  const g = c.getContext('2d');
  const r = makeRng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < spots; i++) {
    g.fillStyle = spot;
    g.beginPath();
    g.ellipse(r.range(0, 128), r.range(0, 128), r.range(3, 7), r.range(3, 6), 0, 0, TAU);
    g.fill();
  }
  for (let i = 0; i < 500; i++) {
    g.strokeStyle = r.chance(0.5) ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.1)';
    const x = r.range(0, 128), y = r.range(0, 128);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 1, y + r.range(3, 7));
    g.stroke();
  }
  return texFromCanvas(c, { repeat: true });
}

function dog(seed) {
  const r = makeRng(seed);
  const cols = [['#c69a63', '#7a5230'], ['#3a2a20', '#1a120c'], ['#e8dcc4', '#b89a6a'], ['#8a8a8a', '#4a4a4a']];
  const [base, dark] = r.pick(cols);
  const fur = new THREE.MeshStandardMaterial({ map: furTex(base, dark, seed, 6), roughness: 0.9 });
  const darkM = std(new THREE.Color(dark), { roughness: 0.9 });
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  M(cap(0.13, 0.32), fur, inner, { y: 0.34, rx: Math.PI / 2, sx: 1, sz: 1.05 });
  const head = new THREE.Group();
  head.position.set(0, 0.46, 0.3);
  inner.add(head);
  M(sph(0.13), fur, head);
  M(sph(0.075), std(0xf0e0c8), head, { y: -0.03, z: 0.11, sx: 1, sz: 1.3 });
  M(sph(0.028, 8, 6), std(0x111111), head, { y: 0.0, z: 0.19 });
  for (const s of [-1, 1]) {
    M(sph(0.026, 8, 6), std(0x111111, { roughness: 0.2 }), head, { x: s * 0.06, y: 0.045, z: 0.11 });
    M(sph(0.06), darkM, head, { x: s * 0.11, y: 0.07, z: -0.02, sy: 1.6, sz: 0.6, rz: s * 0.4 });
  }
  M(new THREE.TorusGeometry(0.11, 0.018, 6, 14), std(0xd22a2a), head, { y: -0.1, z: -0.06, rx: Math.PI / 2 - 0.4 });
  const legs = [];
  for (const [x, z] of [[-0.08, 0.2], [0.08, 0.2], [-0.08, -0.2], [0.08, -0.2]]) {
    const lg = new THREE.Group();
    lg.position.set(x, 0.3, z);
    inner.add(lg);
    M(cap(0.035, 0.18), fur, lg, { y: -0.14 });
    legs.push(lg);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.42, -0.32);
  tail.rotation.x = 0.9;
  inner.add(tail);
  M(cap(0.03, 0.2), fur, tail, { y: 0.1 });
  return { root, inner, legs, head, tail, animal: true, type: 'dog' };
}

function cat(seed) {
  const r = makeRng(seed);
  const [base, dark] = r.pick([['#8f8f98', '#4a4a52'], ['#e0913a', '#a85a18'], ['#2a2a2e', '#111114'], ['#e8e4dc', '#a8a49c']]);
  const fur = new THREE.MeshStandardMaterial({ map: furTex(base, dark, seed, 14), roughness: 0.9 });
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  M(cap(0.1, 0.26), fur, inner, { y: 0.26, rx: Math.PI / 2 });
  const head = new THREE.Group();
  head.position.set(0, 0.38, 0.24);
  inner.add(head);
  M(sph(0.11), fur, head, { sx: 1.1 });
  M(sph(0.025, 8, 6), std(0xd88a90), head, { y: -0.02, z: 0.105 });
  for (const s of [-1, 1]) {
    M(sph(0.028, 8, 6), std(0x40e060, { emissive: 0x20a040, emissiveIntensity: 0.5 }), head, { x: s * 0.05, y: 0.03, z: 0.095 });
    M(cone(0.04, 0.09, 4), fur, head, { x: s * 0.07, y: 0.12, z: 0, rz: -s * 0.25 });
  }
  const legs = [];
  for (const [x, z] of [[-0.06, 0.15], [0.06, 0.15], [-0.06, -0.15], [0.06, -0.15]]) {
    const lg = new THREE.Group();
    lg.position.set(x, 0.24, z);
    inner.add(lg);
    M(cap(0.028, 0.14), fur, lg, { y: -0.1 });
    legs.push(lg);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.28, -0.26);
  tail.rotation.x = 1.0;
  inner.add(tail);
  M(cap(0.024, 0.3), fur, tail, { y: 0.16 });
  return { root, inner, legs, head, tail, animal: true, type: 'cat' };
}

function deer(seed) {
  const fur = new THREE.MeshStandardMaterial({ map: furTex('#a8703a', '#f0e0c0', seed, 26), roughness: 0.9 });
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  M(cap(0.17, 0.4), fur, inner, { y: 0.62, rx: Math.PI / 2, sx: 0.95 });
  const neck = new THREE.Group();
  neck.position.set(0, 0.7, 0.34);
  neck.rotation.x = 0.7;
  inner.add(neck);
  M(cap(0.075, 0.3), fur, neck, { y: 0.15 });
  const head = new THREE.Group();
  head.position.set(0, 0.34, 0.03);
  neck.add(head);
  M(sph(0.1), fur, head, { sz: 1.2 });
  M(sph(0.06), std(0xf0e0c8), head, { y: -0.04, z: 0.12, sz: 1.3 });
  M(sph(0.028, 8, 6), std(0x111111), head, { y: -0.02, z: 0.19 });
  for (const s of [-1, 1]) {
    M(sph(0.024, 8, 6), std(0x0a0a0a, { roughness: 0.15 }), head, { x: s * 0.07, y: 0.04, z: 0.06 });
    M(sph(0.06), fur, head, { x: s * 0.11, y: 0.08, z: -0.05, sy: 1.8, sz: 0.5, rz: s * 0.8 });
    M(cone(0.012, 0.16, 4), std(0x8a6a4a), head, { x: s * 0.05, y: 0.18, z: -0.04, rz: -s * 0.3 });
  }
  const legs = [];
  for (const [x, z] of [[-0.09, 0.26], [0.09, 0.26], [-0.09, -0.26], [0.09, -0.26]]) {
    const lg = new THREE.Group();
    lg.position.set(x, 0.55, z);
    inner.add(lg);
    M(cap(0.028, 0.44), fur, lg, { y: -0.3 });
    M(cap(0.024, 0.06), std(0x2a1a10), lg, { y: -0.56 });
    legs.push(lg);
  }
  M(sph(0.05, 8, 6), std(0xf5f0e0), inner, { y: 0.66, z: -0.42, sy: 1.3 });
  return { root, inner, legs, head, animal: true, type: 'deer', neck };
}

export function createVictim(kind, seed = 1) {
  const info = VICTIM_KINDS[kind];
  const parts = kind === 'perro' ? dog(seed) : kind === 'gato' ? cat(seed) : kind === 'ciervo' ? deer(seed) : human(kind, seed);
  const root = new THREE.Group();
  root.add(parts.root);
  parts.root.scale.setScalar(info.scale);
  const victim = {
    kind, info, seed, root, parts,
    mode: 'wave', t: Math.random() * 10,
    height: kind === 'ciervo' ? 1.2 : kind === 'perro' ? 0.7 : kind === 'gato' ? 0.5 : 1.35 * (kind === 'nino' ? 0.78 : 1),
    state: 'waiting', found: false, rescued: false, marker: null,
    setMode(m) { this.mode = m; },
    update(dt) {
      this.t += dt;
      const t = this.t;
      const p = this.parts;
      const mode = this.mode;
      const inner = p.inner;
      if (!p.animal) {
        if (mode === 'wave') {
          inner.position.y = Math.abs(Math.sin(t * 4)) * 0.04;
          p.arms[0].rotation.z = -2.7 + Math.sin(t * 9) * 0.35;
          p.arms[1].rotation.z = kind === 'nino' ? 2.7 - Math.sin(t * 9 + 1) * 0.35 : 0.2;
          p.arms[1].rotation.x = kind === 'anciano' ? -0.3 : 0;
          p.head.rotation.z = Math.sin(t * 3) * 0.1;
          p.legs.forEach((l) => (l.rotation.x = 0));
        } else if (mode === 'carried') {
          inner.position.y = 0;
          p.arms[0].rotation.set(-1.9, 0, -0.5);
          p.arms[1].rotation.set(-1.9, 0, 0.5);
          p.legs[0].rotation.x = -0.4 + Math.sin(t * 3) * 0.08;
          p.legs[1].rotation.x = -0.25 + Math.sin(t * 3 + 1) * 0.08;
          p.head.rotation.z = 0.15;
        } else if (mode === 'happy') {
          inner.position.y = Math.abs(Math.sin(t * 5)) * 0.08;
          p.arms[0].rotation.z = -2.9 + Math.sin(t * 10) * 0.3;
          p.arms[1].rotation.z = 2.9 - Math.sin(t * 10) * 0.3;
        } else if (mode === 'walk') {
          inner.position.y = Math.abs(Math.sin(t * 8)) * 0.03;
          p.legs[0].rotation.x = Math.sin(t * 8) * 0.6;
          p.legs[1].rotation.x = -Math.sin(t * 8) * 0.6;
          p.arms[0].rotation.set(-Math.sin(t * 8) * 0.5, 0, -0.1);
          p.arms[1].rotation.set(Math.sin(t * 8) * 0.5, 0, 0.1);
        }
      } else {
        if (mode === 'wave') {
          inner.position.y = Math.abs(Math.sin(t * 5)) * 0.05;
          if (p.tail) p.tail.rotation.z = Math.sin(t * 14) * 0.5;
          p.head.rotation.x = Math.sin(t * 5) * 0.2 - 0.1;
          p.legs.forEach((l, i) => (l.rotation.x = Math.sin(t * 5 + i) * 0.15));
        } else if (mode === 'carried') {
          inner.position.y = 0;
          p.legs.forEach((l, i) => (l.rotation.x = 0.5 + Math.sin(t * 2 + i) * 0.05));
          if (p.tail) p.tail.rotation.z = Math.sin(t * 6) * 0.25;
        } else if (mode === 'happy' || mode === 'walk') {
          inner.position.y = Math.abs(Math.sin(t * 7)) * 0.06;
          if (p.tail) p.tail.rotation.z = Math.sin(t * 16) * 0.6;
          if (mode === 'walk') p.legs.forEach((l, i) => (l.rotation.x = Math.sin(t * 9 + (i % 2) * Math.PI) * 0.5));
        }
      }
    },
  };
  return victim;
}
