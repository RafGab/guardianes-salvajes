import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makeCanvas, texFromCanvas, makeRng, clamp, lerp, damp, TAU } from './utils.js';

/* ------------------------------------------------------------------ */
/*  Datos de héroes y elementos                                        */
/* ------------------------------------------------------------------ */
export const ELEMENTS = {
  fuego: { name: 'Fuego', icon: '🔥', color: 0xff6a1a, css: '#ff7a2a' },
  agua: { name: 'Agua', icon: '💧', color: 0x22a8ff, css: '#39b4ff' },
  hielo: { name: 'Hielo', icon: '🧊', color: 0x9fe8ff, css: '#a5ecff' },
  tierra: { name: 'Tierra', icon: '🌎', color: 0x3ddc84, css: '#4be08b' },
  aire: { name: 'Aire', icon: '💨', color: 0xbfe6ff, css: '#c6e9ff' },
};

export const HEROES = [
  {
    id: 'yagua', name: 'Yagua', species: 'Jaglión', element: 'tierra', scale: 0.8,
    power: { type: 'pillar', name: 'Pilar de Roca', cd: 5, desc: 'Hace brotar una columna de roca bajo sus pies: una plataforma segura por encima del agua.' },
    stats: { speed: 7.6, jump: 9.0, swim: 3.9, carry: 2 },
    bio: 'Híbrida de leona y jaguar. Ágil, valiente y siempre la primera en llegar cuando alguien pide ayuda.',
  },
  {
    id: 'ambar', name: 'Ámbar', species: 'Halcón arpía', element: 'aire', scale: 0.8,
    power: { type: 'glide', name: 'Ráfaga Celeste', cd: 6, desc: 'Una corriente de aire la lanza hacia el cielo y planea sobre el agua. Mantén SALTAR para seguir planeando.' },
    stats: { speed: 7.2, jump: 9.4, swim: 3.4, carry: 1 },
    bio: 'Exploradora aérea. Ve la catástrofe desde arriba y llega donde nadie más puede.',
  },
  {
    id: 'vorak', name: 'Vorak', species: 'Dragón esmeralda', element: 'fuego', scale: 0.84,
    power: { type: 'dash', name: 'Carga Volcánica', cd: 3.5, desc: 'Se lanza como un meteoro de fuego: gran salto adelante para alcanzar tejados y cruzar huecos.' },
    stats: { speed: 6.2, jump: 8.4, swim: 3.6, carry: 3 },
    bio: 'Dragón guardián de los volcanes. Lento pero imparable: puede cargar con tres rescatados a la vez.',
  },
  {
    id: 'nerea', name: 'Nerea', species: 'Lince eléctrico', element: 'agua', scale: 0.8,
    power: { type: 'surf', name: 'Corriente Veloz', cd: 8, desc: 'Convierte el agua en una autopista: corre sobre la superficie a gran velocidad durante unos segundos.' },
    stats: { speed: 7.3, jump: 8.8, swim: 4.6, carry: 2 },
    bio: 'Rápida como un rayo y experta en mareas. Su guadaña de energía corta las corrientes.',
  },
  {
    id: 'coral', name: 'Coral', species: 'Nutria y ajolote', element: 'agua', scale: 0.74,
    power: { type: 'surf', name: 'Marea Amiga', cd: 7, desc: 'Su ajolote calma las aguas: durante unos segundos corre sobre el agua sin que la corriente la arrastre.' },
    stats: { speed: 6.6, jump: 8.4, swim: 5.0, carry: 3 },
    bio: 'Nadadora nata. Su mochila de rescate le permite ayudar a tres personas en cada viaje.',
  },
  {
    id: 'aurora', name: 'Aurora', species: 'Zorra ártica', element: 'hielo', scale: 0.8,
    power: { type: 'ice', name: 'Puente de Hielo', cd: 6, desc: 'Congela el agua a su alrededor y crea una plataforma de hielo que sube con la inundación.' },
    stats: { speed: 7.0, jump: 8.8, swim: 3.8, carry: 2 },
    bio: 'Nacida en la aurora boreal. Su cola brilla con luz de hielo y su hacha congela lo que toca.',
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers de geometría y materiales                                  */
/* ------------------------------------------------------------------ */
const M = (geo, mat, parent, o = {}) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(o.x || 0, o.y || 0, o.z || 0);
  m.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
  m.castShadow = o.shadow !== false;
  if (parent) parent.add(m);
  return m;
};
const DET = 1.6; // multiplicador de detalle geométrico
const sph = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, Math.round(w * DET), Math.round(h * DET));
const cap = (r, l, s = 4, rad = 10) => new THREE.CapsuleGeometry(r, l, s * 2, Math.round(rad * DET));
const cone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, Math.max(5, Math.round(s * 1.3)));
const cyl = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, Math.round(s * DET));
const rbox = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, 2, r);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const tor = (r, t, rs = 8, ts = 20) => new THREE.TorusGeometry(r, t, rs, ts);

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.08, ...o });
const glow = (hex, k = 2.6) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });
const glowAdd = (hex, k = 2, opacity = 0.9) =>
  new THREE.MeshBasicMaterial({
    color: new THREE.Color(hex).multiplyScalar(k), transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
const furMat = (map, color = 0xffffff, sheen = 0xffe0b0) =>
  new THREE.MeshPhysicalMaterial({
    map, color, roughness: 0.82, metalness: 0, sheen: 1, sheenRoughness: 0.35, sheenColor: new THREE.Color(sheen),
    bumpMap: map.userData.bump || null, bumpScale: 2.2,
  });
const crystalMat = (hex, e = 0.9) =>
  new THREE.MeshPhysicalMaterial({
    color: hex, emissive: hex, emissiveIntensity: e, roughness: 0.12, metalness: 0.1, flatShading: true,
    transparent: true, opacity: 0.9, clearcoat: 1,
  });

/* ------------------------------------------------------------------ */
/*  Texturas procedurales (pelaje, escamas, plumas)                    */
/* ------------------------------------------------------------------ */
function furTex({ base, dark, light, spots = null, spotCol = '#1a0f08', seed = 1, size = 1024, stroke = 1 }) {
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  const r = makeRng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = i % 2 ? dark : light;
    g.globalAlpha = 0.05 + r.next() * 0.09;
    g.beginPath();
    g.ellipse(r.range(0, size), r.range(0, size), r.range(8, 46) * (size / 512), r.range(8, 46) * (size / 512), 0, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  g.lineWidth = 1.4 * stroke * (size / 512);
  const k = size / 512;
  for (let i = 0; i < 9000; i++) {
    const x = r.range(0, size), y = r.range(0, size);
    g.strokeStyle = r.chance(0.5) ? dark : light;
    g.globalAlpha = 0.1 + r.next() * 0.18;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + r.range(-3, 3) * k, y + r.range(3, 8) * k, x + r.range(-3, 3) * k, y + r.range(8, 20) * k);
    g.stroke();
  }
  g.globalAlpha = 1;
  if (spots === 'rosette') {
    for (let i = 0; i < 64 * 3; i++) {
      const x = r.range(0, size), y = r.range(0, size), rad = r.range(15, 27) * k * 0.7;
      g.fillStyle = dark;
      g.globalAlpha = 0.5;
      g.beginPath();
      g.arc(x, y, rad * 0.62, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = spotCol;
      for (let q = 0; q < 9; q++) {
        const a = (q / 9) * TAU + r.range(-0.15, 0.15);
        g.beginPath();
        g.ellipse(x + Math.cos(a) * rad, y + Math.sin(a) * rad, r.range(4, 8) * k * 0.7, r.range(3, 5.5) * k * 0.7, a, 0, TAU);
        g.fill();
      }
    }
  } else if (spots === 'dots') {
    g.fillStyle = spotCol;
    for (let i = 0; i < 260; i++) {
      g.beginPath();
      g.ellipse(r.range(0, size), r.range(0, size), r.range(4, 10) * k * 0.8, r.range(3, 8) * k * 0.8, r.range(0, 3), 0, TAU);
      g.fill();
    }
  }
  const tex = texFromCanvas(c, { repeat: true, aniso: 8 });
  const bc = makeCanvas(size);
  const bg = bc.getContext('2d');
  bg.filter = 'grayscale(1) contrast(1.8)';
  bg.drawImage(c, 0, 0);
  tex.userData.bump = texFromCanvas(bc, { repeat: true, srgb: false, aniso: 8 });
  return tex;
}

function scaleTex({ base = '#13161a', hi = '#33423c', seed = 3, size = 1024, cell = 44 }) {
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  const r = makeRng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  let row = 0;
  for (let y = 0; y < size + cell; y += cell * 0.62) {
    for (let x = (row % 2) * cell * 0.5; x < size + cell; x += cell) {
      const gr = g.createRadialGradient(x, y - cell * 0.15, 1, x, y, cell * 0.62);
      gr.addColorStop(0, hi);
      gr.addColorStop(1, base);
      g.fillStyle = gr;
      g.globalAlpha = 0.55 + r.next() * 0.35;
      g.beginPath();
      g.arc(x, y, cell * 0.6, 0, TAU);
      g.fill();
      g.globalAlpha = 0.7;
      g.strokeStyle = '#020304';
      g.lineWidth = 3;
      g.stroke();
    }
    row++;
  }
  g.globalAlpha = 1;
  const tex = texFromCanvas(c, { repeat: true, aniso: 8 });
  const bc = makeCanvas(size);
  const bg = bc.getContext('2d');
  bg.filter = 'grayscale(1) contrast(1.5)';
  bg.drawImage(c, 0, 0);
  tex.userData.bump = texFromCanvas(bc, { repeat: true, srgb: false, aniso: 8 });
  return tex;
}

function featherTex(c1, c2, tip) {
  const c = makeCanvas(256, 64);
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 256, 0);
  gr.addColorStop(0, c1);
  gr.addColorStop(0.7, c2);
  gr.addColorStop(0.86, tip);
  gr.addColorStop(1, tip);
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = 'rgba(0,0,0,.28)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 32);
  g.lineTo(256, 32);
  g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(255,255,255,.18)';
  for (let x = 6; x < 250; x += 9) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 14, 4);
    g.moveTo(x, 32);
    g.lineTo(x + 14, 60);
    g.stroke();
  }
  return texFromCanvas(c);
}

function snowflakeTex(col = '#bfefff') {
  const c = makeCanvas(128);
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)';
  g.translate(64, 64);
  g.strokeStyle = col;
  g.lineWidth = 6;
  g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -50);
    g.moveTo(0, -30);
    g.lineTo(15, -44);
    g.moveTo(0, -30);
    g.lineTo(-15, -44);
    g.stroke();
  }
  return texFromCanvas(c);
}

/* ------------------------------------------------------------------ */
/*  Piezas reutilizables                                               */
/* ------------------------------------------------------------------ */
function eye(parent, { x, y, z, r = 0.085, iris = '#ffb020', side = 1, lash = false, rim = 0x120a06, glowIris = 0.3 }) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = side * 0.2;
  parent.add(g);
  r *= 1.12;
  M(sph(r * 1.18, 16, 12), std(rim, { roughness: 0.5 }), g, { sz: 0.45, shadow: false });
  M(sph(r, 16, 12), std(0xffffff, { roughness: 0.2 }), g, { sz: 0.55, z: 0.01, shadow: false });
  M(sph(r * 0.8, 16, 12), std(iris, { roughness: 0.15, emissive: iris, emissiveIntensity: glowIris }), g, { sz: 0.6, z: r * 0.3, shadow: false });
  M(sph(r * 0.42, 12, 8), std(0x050505, { roughness: 0.1 }), g, { sz: 0.5, z: r * 0.62, shadow: false });
  M(sph(r * 0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), g, { x: r * 0.26, y: r * 0.3, z: r * 0.8, sz: 0.5, shadow: false });
  if (lash) {
    const lm = std(0x0a0a0a);
    for (let i = 0; i < 3; i++) {
      M(box(r * 0.5, r * 0.09, r * 0.09), lm, g, { x: side * (r * 0.95), y: r * (0.35 - i * 0.05) + r * 0.2, z: r * 0.1, rz: side * (0.35 + i * 0.3), shadow: false });
    }
  }
  return g;
}

function goggles(head, { y = 0.6, z = 0.24, spread = 0.1, glass, strap, rim, tilt = 1.0, r = 0.09, bandR = 0.29 }) {
  M(tor(bandR, 0.02, 6, 28), strap, head, { y: y - 0.06, rx: Math.PI / 2, sz: 1.02, shadow: false });
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(s * spread, y, z);
    g.rotation.x = tilt;
    head.add(g);
    M(cyl(r, r, 0.05, 20), glass, g, { shadow: false });
    M(tor(r + 0.005, 0.017, 6, 20), rim, g, { rx: Math.PI / 2, y: 0.025, shadow: false });
  }
  M(box(spread * 1.2, 0.03, 0.04), rim, head, { y: y + 0.005, z: z + 0.03, rx: 0.4, shadow: false });
}

function addTail(rig, { segs = 7, len = 0.2, r0 = 0.075, r1 = 0.04, mat, base = 0.35, curve = -0.12, pos = [0, -0.02, -0.2], last = null }) {
  let parent = rig.hips;
  const list = [];
  for (let i = 0; i < segs; i++) {
    const p = new THREE.Group();
    if (i === 0) {
      p.position.set(...pos);
      p.rotation.x = base;
    } else {
      p.position.z = -len;
      p.rotation.x = curve;
    }
    parent.add(p);
    const r = lerp(r0, r1, i / Math.max(1, segs - 1));
    M(cap(r, len * 0.9, 3, 8), typeof mat === 'function' ? mat(i) : mat, p, { rx: Math.PI / 2, z: -len / 2 });
    list.push(p);
    parent = p;
  }
  if (last) last(parent);
  rig.tail = list;
  rig.tailBase = list.map((p) => p.rotation.x);
  return list;
}

function toothed(parent, mat, n, r0, r1, h, o = {}) {
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0.5 : i / (n - 1);
    const c = cone(lerp(r0, r1, k), h * lerp(1, 0.6, k), 6);
    M(c, mat, parent, { x: o.x || 0, y: (o.y || 0) + (o.dy || 0) * k, z: (o.z || 0) + (o.dz || 0) * k, rx: o.rx || 0, rz: o.rz || 0 });
  }
}

/* ------------------------------------------------------------------ */
/*  Esqueleto bípedo genérico                                          */
/* ------------------------------------------------------------------ */
const HIP_H = 0.96;

function baseBiped(o) {
  const b = o.bulk || 1;
  const m = o.mats;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = HIP_H;
  body.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);
  const rig = { root, body, hips, torso, b, mats: m, sh: [], el: [], wr: [], hipJ: [], knee: [], ankle: [], tail: [], tailBase: [], ex: {}, anchors: [] };

  M(sph(0.22 * b), m.pelvis || m.suit, hips, { sx: 1.15, sy: 0.8, sz: 0.95, y: -0.02 });
  M(cap(0.2 * b, 0.16), m.abdomen || m.suit, torso, { y: 0.2, sx: 1.05, sz: 0.9 });
  rig.chest = M(cap(0.26 * b, 0.14), m.chest || m.suit, torso, { y: 0.44, sx: 1.2, sz: 0.85 });
  M(cyl(0.09 * b, 0.11 * b, 0.14), m.skin, torso, { y: 0.68 });

  const head = new THREE.Group();
  head.position.set(0, 0.74, 0);
  torso.add(head);
  rig.head = head;

  for (const s of [-1, 1]) {
    const hj = new THREE.Group();
    hj.position.set(s * 0.15 * b * 0.95, -0.02, 0);
    hips.add(hj);
    M(cap(0.115 * b, 0.28), m.thigh, hj, { y: -0.21 });
    const kj = new THREE.Group();
    kj.position.y = -0.42;
    hj.add(kj);
    M(cap(0.1 * b, 0.27), m.shin, kj, { y: -0.2 });
    const aj = new THREE.Group();
    aj.position.y = -0.42;
    kj.add(aj);
    if (o.foot !== 'none') {
      M(rbox(0.19 * b, 0.11, 0.32, 0.04), m.boot, aj, { y: -0.03, z: 0.07 });
      M(rbox(0.2 * b, 0.04, 0.34, 0.02), m.sole, aj, { y: -0.085, z: 0.07 });
    }
    rig.hipJ.push(hj);
    rig.knee.push(kj);
    rig.ankle.push(aj);

    const sj = new THREE.Group();
    sj.position.set(s * (0.3 * b + 0.11), 0.58, 0);
    torso.add(sj);
    M(sph(0.11 * b), m.shoulder || m.upperArm, sj);
    M(cap(0.085 * b, 0.2), m.upperArm, sj, { y: -0.17 });
    const ej = new THREE.Group();
    ej.position.y = -0.34;
    sj.add(ej);
    M(cap(0.075 * b, 0.2), m.foreArm, ej, { y: -0.15 });
    const wj = new THREE.Group();
    wj.position.y = -0.3;
    ej.add(wj);
    M(sph(0.095 * b, 12, 10), m.hand, wj, { y: -0.04 });
    rig.sh.push(sj);
    rig.el.push(ej);
    rig.wr.push(wj);
  }
  // índice 0 = lado x negativo ("derecha" del héroe), 1 = x positivo

  const a1 = new THREE.Group(); a1.position.set(0, 0.34, 0.44); torso.add(a1);
  const a2 = new THREE.Group(); a2.position.set(0, 0.5, -0.4); torso.add(a2);
  const a3 = new THREE.Group(); a3.position.set(0.3, 0.92, -0.05); torso.add(a3);
  rig.anchors = [a1, a2, a3];
  return rig;
}

/* ------------------------------------------------------------------ */
/*  1. YAGUA — Jaglión (Fuego)                                         */
/* ------------------------------------------------------------------ */
function buildYagua() {
  const tex = furTex({ base: '#d98a2c', dark: '#a85a18', light: '#f0b458', spots: 'rosette', spotCol: '#1c0e06', seed: 11 });
  const fur = furMat(tex);
  const cream = furMat(furTex({ base: '#f3dfb8', dark: '#d8bd8c', light: '#fff4dc', seed: 12 }), 0xffffff, 0xffffff);
  const suit = std(0x17181b, { roughness: 0.5, metalness: 0.35 });
  const dark = std(0x0c0c0e, { roughness: 0.6 });
  const orange = glow(0xff7a1a, 2.4);
  const strap = std(0x3a2418, { roughness: 0.8 });
  const mats = { skin: fur, suit, thigh: suit, shin: suit, upperArm: suit, foreArm: fur, hand: dark, boot: dark, sole: std(0xff7a1a, { emissive: 0xff5a10, emissiveIntensity: 0.6 }) };
  const rig = baseBiped({ mats });
  const { torso, head, hips } = rig;

  // Cabeza
  M(sph(0.34, 22, 16), fur, head, { y: 0.3, sx: 1.06, sy: 0.95, sz: 0.96 });
  M(sph(0.16, 16, 12), cream, head, { y: 0.2, z: 0.29, sx: 1.25, sy: 0.8, sz: 0.9 });
  M(sph(0.1, 12, 10), cream, head, { y: 0.1, z: 0.27, sx: 1.2, sy: 0.7 });
  M(sph(0.045, 10, 8), std(0x4a2218), head, { y: 0.272, z: 0.415, sx: 1.4, sy: 0.8 });
  M(box(0.012, 0.06, 0.01), dark, head, { y: 0.225, z: 0.425 });
  M(box(0.1, 0.008, 0.01), dark, head, { x: 0.05, y: 0.185, z: 0.425, rz: -0.25 });
  M(box(0.1, 0.008, 0.01), dark, head, { x: -0.05, y: 0.185, z: 0.425, rz: 0.25 });
  for (const s of [-1, 1]) {
    eye(head, { x: s * 0.135, y: 0.35, z: 0.265, r: 0.09, iris: '#ffb020', side: s, lash: true });
    M(box(0.14, 0.032, 0.04), dark, head, { x: s * 0.145, y: 0.46, z: 0.29, rz: s * 0.3, ry: s * 0.3 });
    M(sph(0.125, 12, 10), dark, head, { x: s * 0.255, y: 0.58, z: -0.05, sz: 0.4 });
    M(sph(0.11, 12, 10), fur, head, { x: s * 0.255, y: 0.58, z: -0.02, sz: 0.4 });
    M(sph(0.07, 10, 8), std(0xc98878), head, { x: s * 0.255, y: 0.58, z: 0.01, sz: 0.3 });
    // marca facial (roseta bajo el ojo)
    M(tor(0.03, 0.009, 5, 12), dark, head, { x: s * 0.16, y: 0.24, z: 0.3, ry: s * 0.3 });
    // cachetes
    for (let k = 0; k < 3; k++) M(cone(0.045, 0.16, 6), cream, head, { x: s * (0.3 + k * 0.01), y: 0.14 - k * 0.04, z: 0.1 - k * 0.05, rz: s * -1.9, ry: 0 });
  }
  // Melena
  const maneCols = ['#e39a35', '#c67a20', '#f2b04c', '#8a4a14', '#d98a2c'];
  const rr = makeRng(5);
  for (let i = 0; i < 52; i++) {
    const phi = rr.range(1.0, Math.PI) * (rr.chance(0.5) ? 1 : -1);
    const e = rr.range(-0.7, 1.15);
    const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(e), Math.sin(e), Math.cos(phi) * Math.cos(e));
    const back = Math.abs(phi) / Math.PI;
    const len = 0.24 + back * 0.2 + rr.range(0, 0.08);
    const tip = dir.clone().add(new THREE.Vector3(0, -0.28 - back * 0.25, -0.15 * back)).normalize();
    const c = cone(0.075 + back * 0.02, len, 6);
    const mesh = new THREE.Mesh(c, std(maneCols[i % 5], { roughness: 0.9 }));
    mesh.position.copy(new THREE.Vector3(0, 0.3, 0).addScaledVector(dir, 0.27)).addScaledVector(tip, len / 2);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip);
    mesh.castShadow = true;
    head.add(mesh);
  }
  for (let i = 0; i < 7; i++) {
    const a = (i - 3) * 0.2;
    const c = new THREE.Mesh(cone(0.06, 0.32, 6), std(maneCols[(i + 1) % 5], { roughness: 0.9 }));
    c.position.set(Math.sin(a) * 0.2, 0.62 + Math.cos(a * 2) * 0.03, 0.12 - Math.abs(a) * 0.05);
    c.rotation.set(-1.1, 0, -a * 1.1);
    c.castShadow = true;
    head.add(c);
  }
  goggles(head, { y: 0.6, z: 0.22, spread: 0.11, glass: std(0x12363a, { metalness: 0.9, roughness: 0.08 }), strap: std(0x2a1a10), rim: std(0xb87333, { metalness: 0.8, roughness: 0.35 }) });

  // Torso: correas y detalles naranjas
  for (const s of [-1, 1]) {
    M(box(0.055, 0.5, 0.03), strap, torso, { x: s * 0.14, y: 0.44, z: 0.232, rz: s * 0.06 });
    M(box(0.014, 0.44, 0.03), orange, torso, { x: s * 0.14, y: 0.44, z: 0.238, rz: s * 0.06 });
    M(sph(0.13, 12, 10), suit, rig.sh[s < 0 ? 0 : 1], { y: 0.03, sx: 1.25, sy: 0.75, sz: 1.1 });
    M(rbox(0.19, 0.17, 0.1, 0.04), suit, rig.knee[s < 0 ? 0 : 1], { z: 0.1, y: 0.05 });
    M(box(0.03, 0.09, 0.01), orange, rig.knee[s < 0 ? 0 : 1], { z: 0.155, y: 0.05 });
    M(box(0.14, 0.03, 0.02), orange, rig.wr[s < 0 ? 0 : 1], { y: 0.03, z: 0.09, rx: 0.1 });
  }
  M(box(0.36, 0.045, 0.03), strap, torso, { y: 0.52, z: 0.226 });
  M(tor(0.235, 0.032, 6, 28), std(0x2a1a10), hips, { rx: Math.PI / 2, y: 0.07, sz: 0.95 });
  M(rbox(0.1, 0.07, 0.03, 0.015), std(0xb87333, { metalness: 0.8, roughness: 0.3 }), hips, { y: 0.07, z: 0.225 });
  M(tor(0.05, 0.012, 6, 12), orange, hips, { x: 0.13, y: 0.02, z: 0.24 });
  for (const s of [-1, 1]) M(rbox(0.09, 0.09, 0.07, 0.02), strap, hips, { x: s * 0.24, y: 0.02, z: 0.06 });
  M(tor(0.115, 0.045, 6, 18), std(0x0e0e10), torso, { y: 0.66, rx: Math.PI / 2 });
  // reloj
  const watch = new THREE.Group();
  watch.position.set(0, -0.02, 0.08);
  rig.wr[1].add(watch);
  M(cyl(0.06, 0.06, 0.035, 16), std(0x707880, { metalness: 0.9, roughness: 0.2 }), watch, { rz: Math.PI / 2, x: 0.08, y: 0.03 });
  M(cyl(0.045, 0.045, 0.01, 16), glow(0x66ddff, 1.6), watch, { rz: Math.PI / 2, x: 0.1, y: 0.03 });

  // Mochila con planeador plegado
  const pack = new THREE.Group();
  pack.position.set(0, 0.46, -0.3);
  torso.add(pack);
  M(rbox(0.42, 0.5, 0.15, 0.04), suit, pack);
  const sail = new THREE.Shape();
  sail.moveTo(-0.2, 0); sail.lineTo(0.2, 0); sail.lineTo(0.34, 0.85); sail.lineTo(-0.34, 0.85); sail.closePath();
  const sailMesh = new THREE.Mesh(new THREE.ShapeGeometry(sail), std(0x1b1c20, { side: THREE.DoubleSide, roughness: 0.4, metalness: 0.4 }));
  sailMesh.position.set(0, 0.05, -0.1);
  sailMesh.rotation.x = -0.15;
  sailMesh.castShadow = true;
  pack.add(sailMesh);
  for (const s of [-1, 1]) M(box(0.028, 0.92, 0.028), orange, pack, { x: s * 0.27, y: 0.45, z: -0.13, rz: s * -0.16, rx: -0.15 });
  const tri = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.09, 3), glow(0xff8a2a, 2.2));
  tri.position.set(0, 0.5, -0.115);
  tri.rotation.set(Math.PI / 2, 0, 0);
  pack.add(tri);

  // Cola
  addTail(rig, {
    segs: 9, len: 0.2, r0: 0.075, r1: 0.05, mat: (i) => (i > 6 ? std(0x1a0f08, { roughness: 0.9 }) : fur), base: 0.3, curve: -0.11, pos: [0, 0, -0.2],
    last: (p) => {
      M(sph(0.075, 10, 8), std(0x1a0f08, { roughness: 0.95 }), p, { z: -0.24, sz: 1.5 });
    },
  });
  rig.parts = { hair: null };
  return rig;
}

/* ------------------------------------------------------------------ */
/*  2. ÁMBAR — Águila arpía (Fuego)                                    */
/* ------------------------------------------------------------------ */
function makeFeatherGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.06);
  s.lineTo(0.82, -0.07);
  s.quadraticCurveTo(1.08, 0, 0.82, 0.07);
  s.lineTo(0, 0.06);
  s.closePath();
  const g = new THREE.ShapeGeometry(s, 6);
  const uv = g.attributes.uv;
  const p = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 1.08, (p.getY(i) + 0.07) / 0.14);
  return g;
}

function buildAmbar() {
  const suitGloss = std(0x0d0d10, { roughness: 0.25, metalness: 0.55 });
  const yellow = std(0xffc400, { roughness: 0.3, metalness: 0.4, emissive: 0xff9000, emissiveIntensity: 0.35 });
  const cream = furMat(furTex({ base: '#f6efe0', dark: '#d9cbb0', light: '#ffffff', seed: 21 }), 0xffffff, 0xffffff);
  const darkFeather = std(0x18130e, { roughness: 0.6 });
  const beakMat = std(0xffb400, { roughness: 0.3 });
  const red = glow(0xff2a1a, 2.6);
  const mats = { skin: cream, suit: suitGloss, thigh: suitGloss, shin: suitGloss, upperArm: suitGloss, foreArm: suitGloss, hand: darkFeather, boot: yellow, sole: darkFeather, chest: suitGloss };
  const rig = baseBiped({ mats, foot: 'none' });
  const { torso, head, hips } = rig;

  // Cabeza de águila
  M(sph(0.33, 22, 16), cream, head, { y: 0.3, sx: 1.05, sy: 1.0, sz: 1.0 });
  for (let i = 0; i < 14; i++) {
    const a = (i / 13 - 0.5) * 2.2;
    const c = new THREE.Mesh(cone(0.06, 0.28, 6), i % 3 === 0 ? std(0xffd45a, { roughness: 0.8 }) : cream);
    c.position.set(Math.sin(a) * 0.26, 0.56 + Math.cos(a) * 0.05, -0.05 - Math.abs(a) * 0.08);
    c.rotation.set(-0.7, 0, -a * 0.9);
    c.castShadow = true;
    head.add(c);
  }
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
    M(cone(0.06, 0.24, 6), cream, head, { x: s * (0.28 + k * 0.01), y: 0.32 - k * 0.07, z: -0.02 - k * 0.04, rz: s * -1.5 - k * 0.2, ry: s * 0.4 });
  }
  M(cone(0.115, 0.34, 10), beakMat, head, { y: 0.2, z: 0.4, rx: Math.PI / 2, sx: 0.8 });
  M(cone(0.05, 0.14, 8), std(0xe08800, { roughness: 0.3 }), head, { y: 0.12, z: 0.53, rx: Math.PI / 2 + 0.7 });
  M(cone(0.085, 0.24, 10), std(0xf0a000, { roughness: 0.3 }), head, { y: 0.13, z: 0.37, rx: Math.PI / 2 - 0.05, sx: 0.85 });
  M(box(0.02, 0.02, 0.2), std(0x3a2400), head, { y: 0.175, z: 0.42 });
  for (const s of [-1, 1]) {
    eye(head, { x: s * 0.15, y: 0.36, z: 0.24, r: 0.095, iris: '#ff2222', side: s, lash: true, glowIris: 0.6 });
    M(box(0.16, 0.035, 0.05), std(0x5a4632), head, { x: s * 0.16, y: 0.475, z: 0.26, rz: s * 0.35 });
  }
  goggles(head, { y: 0.6, z: 0.2, spread: 0.11, glass: std(0x9a4a00, { metalness: 0.9, roughness: 0.05, emissive: 0xff8a00, emissiveIntensity: 0.4 }), strap: yellow, rim: yellow });
  for (const s of [-1, 1]) {
    M(rbox(0.06, 0.12, 0.12, 0.02), yellow, head, { x: s * 0.33, y: 0.34, z: 0 });
    M(box(0.01, 0.08, 0.02), glow(0xffaa00, 2.2), head, { x: s * 0.365, y: 0.34, z: 0 });
  }

  // Traje: placas amarillas y arnés
  M(rbox(0.3, 0.3, 0.06, 0.03), yellow, torso, { y: 0.45, z: 0.215 });
  const tri = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.1, 3), glow(0xffcc33, 1.8));
  tri.position.set(0, 0.46, 0.25);
  tri.rotation.set(Math.PI / 2, 0, Math.PI);
  torso.add(tri);
  for (const s of [-1, 1]) {
    const i = s < 0 ? 0 : 1;
    M(box(0.05, 0.55, 0.03), darkFeather, torso, { x: s * 0.17, y: 0.44, z: 0.236, rz: s * 0.08 });
    M(rbox(0.2, 0.1, 0.2, 0.03), yellow, rig.hipJ[i], { y: -0.16, z: 0.02 });
    M(rbox(0.17, 0.17, 0.09, 0.03), yellow, rig.knee[i], { z: 0.09, y: 0.06 });
    M(rbox(0.16, 0.09, 0.16, 0.03), yellow, rig.el[i], { y: -0.08 });
    M(sph(0.12, 12, 10), yellow, rig.sh[i], { y: 0.02, sx: 1.2, sy: 0.7 });
    // garras
    const ank = rig.ankle[i];
    M(sph(0.1, 10, 8), yellow, ank, { y: -0.04, z: 0.03, sy: 0.7, sz: 1.2 });
    for (let k = -1; k <= 1; k++) {
      M(cone(0.032, 0.2, 6), yellow, ank, { x: k * 0.06, y: -0.07, z: 0.17, rx: Math.PI / 2 + 0.25 });
      M(cone(0.018, 0.08, 6), darkFeather, ank, { x: k * 0.06, y: -0.1, z: 0.29, rx: Math.PI / 2 + 0.6 });
    }
    M(cone(0.03, 0.14, 6), yellow, ank, { y: -0.07, z: -0.1, rx: -Math.PI / 2 - 0.3 });
    M(sph(0.005, 4, 4), yellow, ank, { y: -0.11 });
  }
  M(tor(0.235, 0.03, 6, 28), darkFeather, hips, { rx: Math.PI / 2, y: 0.07, sz: 0.95 });
  M(tor(0.055, 0.012, 6, 12), std(0xbbbbbb, { metalness: 0.9, roughness: 0.3 }), hips, { x: 0.2, y: -0.02, z: 0.2 });

  // Plumas de cola
  const tailG = new THREE.Group();
  tailG.position.set(0, -0.02, -0.22);
  hips.add(tailG);
  const fg = makeFeatherGeometry();
  const ftex = featherTex('#ffe35a', '#ffc400', '#1a1208');
  const fmat = new THREE.MeshStandardMaterial({ map: ftex, side: THREE.DoubleSide, roughness: 0.7 });
  for (let i = 0; i < 7; i++) {
    const a = (i - 3) * 0.2;
    const f = new THREE.Mesh(fg, fmat);
    f.scale.set(0.5, 1.3, 1);
    f.rotation.set(Math.PI / 2, 0, 0);
    const holder = new THREE.Group();
    holder.rotation.set(0.2, a, 0);
    holder.add(f);
    f.rotation.set(-Math.PI / 2, Math.PI / 2, 0);
    f.position.set(0, 0, 0);
    tailG.add(holder);
  }

  // Alas
  const wings = [];
  const wingMat = fmat;
  for (const s of [-1, 1]) {
    const wg = new THREE.Group();
    wg.position.set(s * 0.2, 0.58, -0.2);
    wg.scale.x = s;
    torso.add(wg);
    const feathers = [];
    const N = 10;
    for (let i = 0; i < N; i++) {
      const holder = new THREE.Group();
      holder.position.y = i * 0.012;
      const f = new THREE.Mesh(fg, wingMat);
      f.rotation.x = -Math.PI / 2;
      f.scale.set(lerp(1.5, 0.85, i / (N - 1)), 1.9, 1);
      f.castShadow = true;
      holder.add(f);
      wg.add(holder);
      feathers.push({ holder, open: lerp(-0.28, 0.85, i / (N - 1)), folded: lerp(1.15, 1.45, i / (N - 1)) });
    }
    const disc = new THREE.Group();
    disc.position.set(0.72, 0.03, -0.1);
    wg.add(disc);
    M(tor(0.19, 0.02, 6, 28), red, disc, { rx: Math.PI / 2, shadow: false });
    M(tor(0.12, 0.014, 6, 24), red, disc, { rx: Math.PI / 2, shadow: false });
    M(new THREE.CircleGeometry(0.1, 20), glowAdd(0xff3a1a, 2.4, 0.85), disc, { rx: -Math.PI / 2, shadow: false });
    wings.push({ group: wg, feathers, disc, side: s });
  }
  rig.ex.wings = wings;
  rig.ex.wingOpen = 0;
  addTail(rig, { segs: 1, len: 0.1, mat: cream, pos: [0, 0, -0.1] });
  rig.tail = [];
  return rig;
}

/* ------------------------------------------------------------------ */
/*  3. VORAK — Reptil esmeralda (Tierra)                               */
/* ------------------------------------------------------------------ */
function buildVorak() {
  const stex = scaleTex({ base: '#101317', hi: '#36463f', seed: 31 });
  const skin = new THREE.MeshStandardMaterial({ map: stex, bumpMap: stex.userData.bump, bumpScale: 3, roughness: 0.45, metalness: 0.15 });
  const gtex = scaleTex({ base: '#0f3a22', hi: '#2f8a4c', seed: 32, cell: 56 });
  const greenScale = new THREE.MeshStandardMaterial({ map: gtex, bumpMap: gtex.userData.bump, bumpScale: 3, roughness: 0.4, metalness: 0.3 });
  const gold = std(0xd9a441, { metalness: 0.9, roughness: 0.3 });
  const emerald = crystalMat(0x19e070, 1.1);
  const leather = std(0x4a2a1a, { roughness: 0.8 });
  const dark = std(0x0a0c0e, { roughness: 0.5 });
  const mats = { skin, suit: skin, thigh: greenScale, shin: greenScale, upperArm: skin, foreArm: skin, hand: skin, boot: greenScale, sole: gold, chest: skin, abdomen: skin, pelvis: greenScale };
  const rig = baseBiped({ mats, bulk: 1.28, foot: 'none' });
  const { torso, head, hips } = rig;

  // Cabeza de reptil
  M(sph(0.3, 20, 14), skin, head, { y: 0.3, sx: 1.05, sy: 0.9, sz: 1.05 });
  M(sph(0.17, 16, 12), skin, head, { y: 0.22, z: 0.36, sx: 0.95, sy: 0.72, sz: 1.7 });
  M(sph(0.13, 12, 10), skin, head, { y: 0.1, z: 0.32, sx: 0.9, sy: 0.5, sz: 1.5 });
  for (const s of [-1, 1]) {
    M(sph(0.022, 8, 6), dark, head, { x: s * 0.06, y: 0.3, z: 0.63 });
    M(sph(0.11, 12, 10), greenScale, head, { x: s * 0.2, y: 0.42, z: 0.13, sx: 1, sy: 0.6, sz: 1.3, rz: s * -0.3 });
    eye(head, { x: s * 0.17, y: 0.38, z: 0.27, r: 0.11, iris: '#2a90ff', side: s * 0.6, glowIris: 0.5 });
    // dientes
    for (let i = 0; i < 5; i++) M(cone(0.012, 0.045, 5), std(0xf0f0e0), head, { x: s * (0.05 + i * 0.012), y: 0.135, z: 0.34 + i * 0.07, rx: Math.PI });
  }
  // lengua
  M(box(0.06, 0.018, 0.42), std(0xd070b8, { roughness: 0.3 }), head, { x: 0.07, y: 0.15, z: 0.68, ry: -0.35, rz: -0.1 });
  M(box(0.025, 0.014, 0.1), std(0xd070b8), head, { x: 0.2, y: 0.14, z: 0.86, ry: 0.15 });
  // cuernos dorados
  for (let i = 0; i < 6; i++) {
    const a = (i - 2.5) * 0.28;
    const h = 0.26 + (i === 2 || i === 3 ? 0.14 : 0);
    const c = new THREE.Mesh(cone(0.045, h, 6), gold);
    c.position.set(Math.sin(a) * 0.24, 0.6 + (i === 2 || i === 3 ? 0.06 : 0), -0.02);
    c.rotation.set(-0.3, 0, -a * 0.9);
    c.castShadow = true;
    head.add(c);
  }
  for (let i = 0; i < 7; i++) {
    const c = new THREE.Mesh(cone(0.05, 0.2, 5), emerald);
    c.position.set(0, 0.55 - i * 0.02, -0.12 - i * 0.055);
    c.rotation.x = -0.9 - i * 0.05;
    head.add(c);
  }
  M(rbox(0.5, 0.05, 0.12, 0.02), gold, head, { y: 0.55, z: 0.12, rx: -0.3, sx: 0.7 });

  // Torso
  for (const s of [-1, 1]) {
    M(box(0.06, 0.6, 0.03), leather, torso, { x: s * 0.18, y: 0.44, z: 0.27, rz: s * -0.25 });
    M(box(0.06, 0.6, 0.03), leather, torso, { x: s * 0.06, y: 0.44, z: 0.275, rz: s * 0.25 });
  }
  M(tor(0.31, 0.04, 6, 28), leather, hips, { rx: Math.PI / 2, y: 0.08, sz: 0.95 });
  M(rbox(0.16, 0.13, 0.05, 0.02), gold, hips, { y: 0.08, z: 0.31 });
  M(new THREE.OctahedronGeometry(0.06), emerald, hips, { y: 0.08, z: 0.34 });
  // hombrera grande derecha + izquierda
  for (const s of [-1, 1]) {
    const big = s < 0;
    const i = big ? 0 : 1;
    const g = new THREE.Group();
    g.position.set(0, 0.05, 0);
    rig.sh[i].add(g);
    M(sph(big ? 0.23 : 0.18, 12, 10), greenScale, g, { sy: 0.7, sx: 1.2, y: 0.02 });
    M(tor(big ? 0.2 : 0.16, 0.03, 6, 18), gold, g, { rx: Math.PI / 2, y: 0.02, sx: 1.2 });
    for (let k = 0; k < (big ? 5 : 3); k++) {
      const c = new THREE.Mesh(cone(0.05, big ? 0.32 : 0.2, 5), emerald);
      const a = (k / (big ? 4 : 2) - 0.5) * 1.6;
      c.position.set(s * (0.12 + Math.abs(a) * 0.05), 0.15 + (k === 2 ? 0.08 : 0), a * 0.1);
      c.rotation.set(a * 0.5, 0, s * -0.45 + (k === 2 ? s * 0.4 : 0));
      g.add(c);
    }
    M(new THREE.OctahedronGeometry(0.07), emerald, g, { x: s * 0.03, y: 0.13, z: 0.16, sy: 1.5 });
    // brazales
    M(rbox(0.22, 0.22, 0.22, 0.05), greenScale, rig.el[i], { y: -0.15 });
    M(tor(0.115, 0.022, 6, 16), gold, rig.el[i], { y: -0.06, rx: Math.PI / 2 });
    M(tor(0.115, 0.022, 6, 16), gold, rig.el[i], { y: -0.24, rx: Math.PI / 2 });
    M(new THREE.OctahedronGeometry(0.05), emerald, rig.el[i], { y: -0.15, z: 0.12 });
    // grebas y placas doradas
    M(rbox(0.26, 0.28, 0.2, 0.04), greenScale, rig.knee[i], { y: -0.14, z: 0.03 });
    M(rbox(0.2, 0.22, 0.08, 0.03), gold, rig.knee[i], { y: 0.02, z: 0.14 });
    M(rbox(0.28, 0.16, 0.2, 0.04), gold, rig.hipJ[i], { y: -0.14 });
    // garras
    const ank = rig.ankle[i];
    M(rbox(0.26, 0.11, 0.3, 0.04), skin, ank, { y: -0.035, z: 0.06 });
    for (let k = -1; k <= 1; k++) M(cone(0.032, 0.2, 6), dark, ank, { x: k * 0.08, y: -0.05, z: 0.26, rx: Math.PI / 2 + 0.35 });
  }
  // Cola gruesa con cristales
  addTail(rig, {
    segs: 9, len: 0.24, r0: 0.16, r1: 0.04, mat: skin, base: 0.05, curve: -0.05, pos: [0, -0.05, -0.2],
    last: (p) => M(cone(0.07, 0.3, 6), gold, p, { z: -0.28, rx: -Math.PI / 2 }),
  });
  rig.tail.forEach((p, i) => {
    if (i > 0 && i < 8) {
      const c = new THREE.Mesh(cone(0.05 - i * 0.003, 0.2 - i * 0.012, 5), i % 2 ? emerald : gold);
      c.position.set(0, 0.13 - i * 0.012, -0.12);
      c.rotation.x = -0.35;
      p.add(c);
    }
  });
  // Espinas dorsales
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(cone(0.04, 0.16, 5), i % 2 ? gold : emerald);
    c.position.set(0, 0.68 - i * 0.12, -0.29 * 1.28 + i * 0.01);
    c.rotation.x = -0.5;
    torso.add(c);
  }

  // Martillo de guerra
  const hammer = new THREE.Group();
  hammer.position.set(-0.03, -0.04, 0.03);
  rig.wr[0].add(hammer);
  M(cyl(0.04, 0.04, 2.0, 8), std(0x4a2a3a, { roughness: 0.5 }), hammer, { y: 0.55 });
  for (let i = 0; i < 4; i++) M(tor(0.05, 0.016, 6, 12), gold, hammer, { y: -0.2 + i * 0.35, rx: Math.PI / 2 });
  const head2 = new THREE.Group();
  head2.position.set(0, 1.62, 0);
  hammer.add(head2);
  M(new THREE.IcosahedronGeometry(0.46, 1), crystalMat(0x0e7a3a, 0.5), head2, { sx: 1.05, sy: 1.15, sz: 0.85 });
  for (let i = 0; i < 12; i++) {
    const d = new THREE.Vector3().setFromSphericalCoords(1, Math.acos(1 - 2 * ((i + 0.5) / 12)), i * 2.4);
    const c = new THREE.Mesh(cone(0.07, 0.36, 5), i % 3 === 0 ? gold : emerald);
    c.position.copy(d).multiplyScalar(0.5).multiply(new THREE.Vector3(1.05, 1.15, 0.85));
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    c.castShadow = true;
    head2.add(c);
  }
  M(tor(0.34, 0.03, 6, 22), gold, head2, { rx: Math.PI / 2, sx: 1.05, sz: 0.85 });
  rig.ex.weapon = hammer;
  rig.ex.weaponRest = { y: 0 };
  return rig;
}

/* ------------------------------------------------------------------ */
/*  4. NEREA — Lince eléctrico (Agua)                                  */
/* ------------------------------------------------------------------ */
function buildNerea() {
  const tex = furTex({ base: '#ff6d1a', dark: '#c94a08', light: '#ff9440', spots: 'dots', spotCol: '#2a0e04', seed: 41 });
  const fur = furMat(tex, 0xffffff, 0xffb070);
  const cream = furMat(furTex({ base: '#f6d9b0', dark: '#dcb888', light: '#fff0d8', seed: 42 }), 0xffffff, 0xffffff);
  const armor = std(0x0b0d14, { roughness: 0.35, metalness: 0.6 });
  const armor2 = std(0x1a2030, { roughness: 0.4, metalness: 0.5 });
  const blue = glow(0x2a8cff, 2.8);
  const dark = std(0x08090c, { roughness: 0.5 });
  const mats = { skin: fur, suit: armor, thigh: armor, shin: armor2, upperArm: armor, foreArm: armor2, hand: dark, boot: armor, sole: std(0x101216), chest: armor };
  const rig = baseBiped({ mats });
  const { torso, head, hips } = rig;

  M(sph(0.32, 22, 16), fur, head, { y: 0.3, sx: 1.08, sy: 0.95, sz: 0.98 });
  M(sph(0.14, 14, 12), cream, head, { y: 0.2, z: 0.27, sx: 1.2, sy: 0.8, sz: 0.9 });
  M(sph(0.045, 10, 8), std(0x5a2a2a), head, { y: 0.255, z: 0.385, sx: 1.4, sy: 0.8 });
  M(box(0.1, 0.008, 0.01), dark, head, { x: 0.05, y: 0.175, z: 0.395, rz: -0.35 });
  M(box(0.1, 0.008, 0.01), dark, head, { x: -0.05, y: 0.175, z: 0.395, rz: 0.35 });
  for (const s of [-1, 1]) {
    eye(head, { x: s * 0.13, y: 0.34, z: 0.25, r: 0.095, iris: '#28d04a', side: s, lash: true, glowIris: 0.5 });
    M(box(0.14, 0.04, 0.05), dark, head, { x: s * 0.14, y: 0.455, z: 0.27, rz: s * 0.2 });
    // patillas
    for (let k = 0; k < 3; k++) M(cone(0.055, 0.22, 6), fur, head, { x: s * (0.3 + k * 0.02), y: 0.14 - k * 0.05, z: 0.04 - k * 0.05, rz: s * -1.7, ry: s * 0.2 });
    // orejas grandes con borlas
    const ear = new THREE.Group();
    ear.position.set(s * 0.22, 0.56, -0.02);
    ear.rotation.z = -s * 0.3;
    head.add(ear);
    M(cone(0.17, 0.62, 8), fur, ear, { y: 0.28, sz: 0.55 });
    M(cone(0.12, 0.5, 8), cream, ear, { y: 0.26, z: 0.05, sz: 0.3 });
    M(cone(0.045, 0.24, 6), dark, ear, { y: 0.66 });
    for (let k = 0; k < 3; k++) M(tor(0.028, 0.006, 5, 10), std(0xdddddd, { metalness: 0.9, roughness: 0.2 }), ear, { x: s * 0.06, y: 0.1 + k * 0.15, z: 0, ry: Math.PI / 2 });
    // marcas negras
    M(box(0.09, 0.012, 0.01), dark, head, { x: s * 0.2, y: 0.26, z: 0.27, rz: s * 0.5, ry: s * 0.4 });
    M(box(0.09, 0.012, 0.01), dark, head, { x: s * 0.21, y: 0.23, z: 0.26, rz: s * 0.2, ry: s * 0.4 });
  }
  for (let i = 0; i < 6; i++) {
    const a = (i - 2.5) * 0.15;
    const c = new THREE.Mesh(cone(0.05, 0.22, 6), i % 2 ? fur : cream);
    c.position.set(Math.sin(a) * 0.16, 0.62, 0.12);
    c.rotation.set(-0.9, 0, -a);
    head.add(c);
  }

  // Torso con capucha azul y placas
  M(tor(0.15, 0.06, 6, 18), std(0x1a4aa8, { roughness: 0.6 }), torso, { y: 0.66, rx: Math.PI / 2 });
  M(rbox(0.32, 0.3, 0.06, 0.03), armor2, torso, { y: 0.45, z: 0.215 });
  M(box(0.24, 0.02, 0.01), blue, torso, { y: 0.52, z: 0.25 });
  M(box(0.02, 0.24, 0.01), blue, torso, { y: 0.42, z: 0.25 });
  for (const s of [-1, 1]) {
    const i = s < 0 ? 0 : 1;
    M(sph(0.135, 12, 10), armor2, rig.sh[i], { y: 0.03, sx: 1.2, sy: 0.75, sz: 1.1 });
    M(box(0.018, 0.16, 0.01), blue, rig.sh[i], { x: s * 0.13, y: 0.05, z: 0.08 });
    M(rbox(0.2, 0.22, 0.2, 0.04), armor2, rig.el[i], { y: -0.14 });
    M(box(0.025, 0.18, 0.01), blue, rig.el[i], { y: -0.14, z: 0.11 });
    M(sph(0.135, 12, 10), armor2, rig.knee[i], { z: 0.1, y: 0.05, sz: 0.8 });
    M(tor(0.09, 0.012, 6, 16), blue, rig.knee[i], { z: 0.14, y: 0.05 });
    M(rbox(0.16, 0.17, 0.2, 0.03), armor2, rig.hipJ[i], { y: -0.17 });
    M(box(0.02, 0.1, 0.01), blue, rig.hipJ[i], { x: s * 0.06, y: -0.17, z: 0.105 });
    M(rbox(0.2, 0.06, 0.34, 0.03), armor2, rig.ankle[i], { y: -0.05, z: 0.08 });
    M(box(0.14, 0.02, 0.01), blue, rig.ankle[i], { y: -0.07, z: 0.245 });
  }
  M(tor(0.235, 0.035, 6, 28), std(0x1a2030, { metalness: 0.6 }), hips, { rx: Math.PI / 2, y: 0.07, sz: 0.95 });
  M(rbox(0.12, 0.08, 0.04, 0.02), std(0xc0c8d8, { metalness: 0.9, roughness: 0.25 }), hips, { y: 0.07, z: 0.225 });
  for (const s of [-1, 1]) M(rbox(0.1, 0.1, 0.07, 0.02), armor2, hips, { x: s * 0.24, y: 0.02, z: 0.05 });

  addTail(rig, {
    segs: 7, len: 0.2, r0: 0.11, r1: 0.14, mat: (i) => (i === 6 ? dark : i % 2 ? fur : std(0x3a1408, { roughness: 0.9 })), base: 0.25, curve: -0.14, pos: [0, 0, -0.2],
    last: (p) => M(sph(0.13, 10, 8), std(0x140804, { roughness: 0.95 }), p, { z: -0.12, sz: 1.3 }),
  });

  // Guadaña eléctrica
  const scythe = new THREE.Group();
  scythe.position.set(0, -0.04, 0.02);
  rig.wr[0].add(scythe);
  M(cyl(0.028, 0.03, 1.5, 8), std(0x0c0c12, { metalness: 0.7, roughness: 0.3 }), scythe, { y: 0.45 });
  M(cyl(0.05, 0.05, 0.16, 10), blue, scythe, { y: 0.2 });
  const blade = M(new THREE.TorusGeometry(0.62, 0.045, 6, 28, Math.PI * 0.72), glow(0x40a8ff, 2.6), scythe, { y: 1.12, x: 0.0, rz: 1.65, sz: 0.5 });
  M(new THREE.TorusGeometry(0.62, 0.075, 6, 28, Math.PI * 0.72), glowAdd(0x2a7cff, 1.3, 0.35), scythe, { y: 1.12, rz: 1.65, sz: 0.5, shadow: false });
  M(cyl(0.07, 0.07, 0.14, 10), armor, scythe, { y: 1.22 });
  rig.ex.weapon = scythe;
  return rig;
}

/* ------------------------------------------------------------------ */
/*  5. CORAL — Nutria + ajolote (Agua)                                 */
/* ------------------------------------------------------------------ */
function buildCoral() {
  const fur = furMat(furTex({ base: '#7b5238', dark: '#4e3020', light: '#a4744e', seed: 51 }), 0xffffff, 0xe0b890);
  const cream = furMat(furTex({ base: '#e9cdaa', dark: '#c9a880', light: '#fff0da', seed: 52 }), 0xffffff, 0xffffff);
  const red = std(0xd4141c, { roughness: 0.4, metalness: 0.15 });
  const red2 = std(0xa00c14, { roughness: 0.5 });
  const dark = std(0x141414, { roughness: 0.6 });
  const cyan = glow(0x30d0ff, 2.6);
  const pink = new THREE.MeshStandardMaterial({ color: 0xff9ad0, emissive: 0xff5aa8, emissiveIntensity: 0.6, roughness: 0.5 });
  const mats = { skin: fur, suit: red, thigh: fur, shin: red, upperArm: red, foreArm: fur, hand: dark, boot: red, sole: std(0xf0f0f0), chest: red, abdomen: red, pelvis: dark };
  const rig = baseBiped({ mats, bulk: 1.12 });
  const { torso, head, hips } = rig;

  M(sph(0.38, 24, 18), fur, head, { y: 0.32, sx: 1.05, sy: 0.95, sz: 1.0 });
  M(sph(0.2, 16, 12), cream, head, { y: 0.19, z: 0.28, sx: 1.25, sy: 0.75, sz: 0.85 });
  M(sph(0.05, 10, 8), std(0x140c0c), head, { y: 0.27, z: 0.44, sx: 1.4, sy: 0.9 });
  M(box(0.1, 0.008, 0.01), dark, head, { x: 0.05, y: 0.16, z: 0.445, rz: -0.3 });
  M(box(0.1, 0.008, 0.01), dark, head, { x: -0.05, y: 0.16, z: 0.445, rz: 0.3 });
  for (const s of [-1, 1]) {
    eye(head, { x: s * 0.16, y: 0.38, z: 0.28, r: 0.125, iris: '#8a3cff', side: s, glowIris: 0.7 });
    M(sph(0.09, 12, 10), fur, head, { x: s * 0.3, y: 0.62, z: -0.05, sz: 0.6 });
    M(sph(0.055, 10, 8), std(0x4a2c20), head, { x: s * 0.3, y: 0.62, z: -0.02, sz: 0.4 });
    for (let k = 0; k < 3; k++) M(cyl(0.004, 0.004, 0.34, 4), std(0xf4ecdc), head, { x: s * 0.2, y: 0.2 - k * 0.025, z: 0.36, rz: Math.PI / 2 + s * (k - 1) * 0.16, ry: s * 0.2 });
  }
  goggles(head, { y: 0.66, z: 0.2, spread: 0.13, r: 0.12, bandR: 0.32, glass: std(0x40b8ff, { metalness: 1, roughness: 0.03, emissive: 0x1070c0, emissiveIntensity: 0.35 }), strap: red2, rim: std(0xff8a20, { metalness: 0.6, roughness: 0.35 }) });

  // Ajolote sobre la cabeza
  const axo = new THREE.Group();
  axo.position.set(0, 0.86, -0.02);
  head.add(axo);
  M(sph(0.14, 14, 10), pink, axo, { sy: 0.6, sz: 1.5 });
  M(sph(0.11, 14, 10), pink, axo, { y: 0.04, z: 0.2, sy: 0.85, sz: 0.95 });
  for (const s of [-1, 1]) {
    M(sph(0.022, 8, 6), dark, axo, { x: s * 0.06, y: 0.08, z: 0.28 });
    const gills = [];
    for (let k = 0; k < 3; k++) {
      const gl = new THREE.Group();
      gl.position.set(s * 0.09, 0.07 + k * 0.03, 0.17 - k * 0.02);
      gl.rotation.z = -s * (0.7 + k * 0.25);
      axo.add(gl);
      M(cone(0.025, 0.2, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7ac0).multiplyScalar(1.5) }), gl, { y: 0.1 });
      gills.push(gl);
    }
    (rig.ex.gills ||= []).push(...gills);
  }
  M(new THREE.SphereGeometry(0.06, 8, 6), pink, axo, { y: 0.0, z: -0.28, sz: 2, sy: 0.3, sx: 1.6 });
  M(tor(0.09, 0.02, 6, 14, Math.PI), std(0xff8a20), axo, { y: 0.08, z: 0.26, rx: 0.3, sx: 0.9 });
  rig.ex.axo = axo;

  // Mochila: tanque azul + cuentas
  const pack = new THREE.Group();
  pack.position.set(0, 0.48, -0.32);
  torso.add(pack);
  M(rbox(0.46, 0.42, 0.18, 0.05), red2, pack);
  M(cyl(0.11, 0.11, 0.5, 14), new THREE.MeshPhysicalMaterial({ color: 0x2ac8ff, emissive: 0x1090ff, emissiveIntensity: 0.9, roughness: 0.1, transmission: 0.2, transparent: true, opacity: 0.85 }), pack, { x: 0.28, y: 0.0, z: -0.02 });
  M(cyl(0.115, 0.115, 0.05, 14), red, pack, { x: 0.28, y: 0.27, z: -0.02 });
  M(cyl(0.115, 0.115, 0.05, 14), red, pack, { x: 0.28, y: -0.27, z: -0.02 });
  for (let i = 0; i < 8; i++) M(sph(0.028, 8, 6), cyan, torso, { x: -0.18 + Math.sin(i * 0.7) * 0.03, y: 0.62 - i * 0.07, z: 0.24 + Math.cos(i * 0.9) * 0.03 });
  for (const s of [-1, 1]) {
    const i = s < 0 ? 0 : 1;
    M(box(0.06, 0.55, 0.03), dark, torso, { x: s * 0.17, y: 0.44, z: 0.236, rz: s * 0.08 });
    M(rbox(0.19, 0.17, 0.09, 0.04), std(0x3a3d44, { roughness: 0.5 }), rig.knee[i], { z: 0.1, y: 0.05 });
    M(sph(0.12, 12, 10), red2, rig.sh[i], { y: 0.03, sx: 1.2, sy: 0.75, sz: 1.1 });
    M(rbox(0.16, 0.06, 0.16, 0.02), std(0xffffff), rig.wr[i], { y: 0.03 });
  }
  M(tor(0.26, 0.035, 6, 28), dark, hips, { rx: Math.PI / 2, y: 0.07, sz: 0.95 });

  // Cola de nutria: ancha, plana
  addTail(rig, {
    segs: 7, len: 0.22, r0: 0.13, r1: 0.06, mat: (i) => (i > 5 ? new THREE.MeshStandardMaterial({ color: 0x40d8ff, emissive: 0x20a8ff, emissiveIntensity: 1.2 }) : fur), base: 0.08, curve: -0.05, pos: [0, -0.02, -0.22],
  });

  // Caracola-bumerán
  const shell = new THREE.Group();
  shell.position.set(0, -0.06, 0.06);
  shell.rotation.x = -1.2;
  rig.wr[0].add(shell);
  M(cone(0.15, 0.6, 10), std(0xf0a090, { roughness: 0.4 }), shell, { y: 0.3, rz: 0 });
  for (let i = 0; i < 4; i++) M(tor(0.12 - i * 0.02, 0.015, 5, 14), std(0xd4141c), shell, { y: 0.14 + i * 0.12, rx: Math.PI / 2 });
  M(sph(0.06, 8, 6), cyan, shell, { y: 0.62 });
  rig.ex.weapon = shell;
  return rig;
}

/* ------------------------------------------------------------------ */
/*  6. AURORA — Zorra ártica (Hielo)                                   */
/* ------------------------------------------------------------------ */
function buildAurora() {
  const fur = furMat(furTex({ base: '#e8eef8', dark: '#b8c8e4', light: '#ffffff', seed: 61 }), 0xffffff, 0xcfe4ff);
  const red = std(0xd8141c, { roughness: 0.4, metalness: 0.15 });
  const red2 = std(0xa00c14, { roughness: 0.5 });
  const black = std(0x101014, { roughness: 0.5, metalness: 0.2 });
  const ice = glow(0x7ad8ff, 2.4);
  const mats = { skin: fur, suit: red, thigh: black, shin: black, upperArm: red, foreArm: red, hand: red, boot: red, sole: black, chest: red, abdomen: red, pelvis: black };
  const rig = baseBiped({ mats });
  const { torso, head, hips } = rig;

  M(sph(0.31, 22, 16), fur, head, { y: 0.3, sx: 1.06, sy: 0.95, sz: 0.98 });
  M(sph(0.13, 14, 12), fur, head, { y: 0.2, z: 0.3, sx: 0.9, sy: 0.75, sz: 1.5 });
  M(sph(0.04, 10, 8), std(0x101018), head, { y: 0.245, z: 0.5, sx: 1.2, sy: 0.9 });
  M(box(0.1, 0.008, 0.01), black, head, { x: 0.05, y: 0.16, z: 0.44, rz: -0.35 });
  M(box(0.1, 0.008, 0.01), black, head, { x: -0.05, y: 0.16, z: 0.44, rz: 0.35 });
  for (const s of [-1, 1]) {
    eye(head, { x: s * 0.12, y: 0.35, z: 0.24, r: 0.095, iris: '#b040ff', side: s, lash: true, glowIris: 0.8 });
    M(box(0.13, 0.03, 0.04), std(0x8898b8), head, { x: s * 0.13, y: 0.455, z: 0.26, rz: s * 0.25 });
    const ear = new THREE.Group();
    ear.position.set(s * 0.2, 0.55, -0.03);
    ear.rotation.z = -s * 0.35;
    head.add(ear);
    M(cone(0.15, 0.5, 8), fur, ear, { y: 0.24, sz: 0.5 });
    M(cone(0.1, 0.4, 8), std(0x5aa8ff, { emissive: 0x2a78ff, emissiveIntensity: 0.6 }), ear, { y: 0.22, z: 0.04, sz: 0.3 });
    for (let k = 0; k < 3; k++) M(cone(0.05, 0.2, 6), fur, head, { x: s * (0.27 + k * 0.01), y: 0.15 - k * 0.05, z: 0.05 - k * 0.05, rz: s * -1.8, ry: s * 0.3 });
  }
  goggles(head, { y: 0.6, z: 0.2, spread: 0.11, glass: std(0x3a6cff, { metalness: 0.9, roughness: 0.05, emissive: 0x6a3aff, emissiveIntensity: 0.7 }), strap: red2, rim: red });
  const flake = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.13), new THREE.MeshBasicMaterial({ map: snowflakeTex(), transparent: true, color: new THREE.Color(1.6, 2, 2.6) }));
  flake.position.set(0, 0.67, 0.29);
  flake.rotation.x = -0.35;
  head.add(flake);

  // Chaqueta roja, cinturón con copo
  M(rbox(0.36, 0.14, 0.08, 0.03), red2, torso, { y: 0.66, z: 0.1 });
  M(cyl(0.16, 0.18, 0.12, 14), red, torso, { y: 0.66 });
  M(box(0.02, 0.52, 0.01), std(0x181818), torso, { y: 0.44, z: 0.235 });
  M(tor(0.235, 0.035, 6, 28), std(0x2a2a30, { metalness: 0.5 }), hips, { rx: Math.PI / 2, y: 0.07, sz: 0.95 });
  M(rbox(0.14, 0.11, 0.04, 0.02), std(0x707888, { metalness: 0.8, roughness: 0.3 }), hips, { y: 0.07, z: 0.225 });
  const buckle = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({ map: snowflakeTex('#cfeaff'), transparent: true, color: new THREE.Color(1.8, 2.2, 2.8) }));
  buckle.position.set(0, 0.07, 0.25);
  hips.add(buckle);
  const fluff = furMat(furTex({ base: '#ffffff', dark: '#dde6f4', light: '#ffffff', seed: 62 }), 0xffffff, 0xffffff);
  for (const s of [-1, 1]) {
    const i = s < 0 ? 0 : 1;
    M(sph(0.125, 12, 10), red, rig.sh[i], { y: 0.03, sx: 1.2, sy: 0.75, sz: 1.1 });
    M(rbox(0.17, 0.2, 0.17, 0.04), red2, rig.el[i], { y: -0.14 });
    M(sph(0.135, 12, 10), red, rig.knee[i], { z: 0.1, y: 0.05, sz: 0.85 });
    M(rbox(0.2, 0.2, 0.2, 0.04), red, rig.hipJ[i], { y: -0.2 });
    // bota alta con cuello de piel
    M(cyl(0.11, 0.12, 0.26, 12), red, rig.knee[i], { y: -0.3 });
    M(tor(0.12, 0.05, 8, 16), fluff, rig.knee[i], { y: -0.18, rx: Math.PI / 2 });
    for (let k = 0; k < 5; k++) M(box(0.1, 0.012, 0.012), std(0xffffff), rig.knee[i], { y: -0.28 + k * 0.045, z: 0.115, rz: 0.3 * (k % 2 ? 1 : -1) });
    M(cyl(0.05, 0.05, 0.14, 10), fur, rig.wr[i], { y: 0.04, rz: 0 }, );
  }

  // Cola enorme con degradado de aurora
  const tailG = new THREE.Group();
  tailG.position.set(0, -0.02, -0.2);
  tailG.rotation.x = 0.5;
  hips.add(tailG);
  const tcols = [0xdfe9ff, 0xa8d8ff, 0x86a8ff, 0xb090ff, 0xd8a8ff];
  for (let i = 0; i < 9; i++) {
    const k = i / 8;
    const seg = new THREE.Group();
    seg.position.set(0, 0.06 + k * 0.55, -0.15 - Math.sin(k * 2.2) * 0.35);
    tailG.add(seg);
    const col = new THREE.Color(tcols[i % tcols.length]);
    const m = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.25 + k * 0.5, roughness: 0.85, transparent: true, opacity: 0.94 });
    M(sph(0.22 - k * 0.07 + Math.sin(i * 1.7) * 0.02, 12, 10), m, seg, { sx: 0.9, sy: 1.25, sz: 1.3, rx: -0.6 });
  }
  rig.ex.auroraTail = tailG;
  rig.tail = [tailG];
  rig.tailBase = [0.5];

  // Hacha de hielo
  const axe = new THREE.Group();
  axe.position.set(0, -0.05, 0.02);
  rig.wr[0].add(axe);
  M(cyl(0.035, 0.035, 1.6, 8), std(0x8898b8, { metalness: 0.8, roughness: 0.3 }), axe, { y: 0.48 });
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0, -0.12); bladeShape.lineTo(0.55, -0.34); bladeShape.lineTo(0.72, 0.02); bladeShape.lineTo(0.5, 0.46); bladeShape.lineTo(0, 0.14); bladeShape.closePath();
  const bg = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 });
  const bm = new THREE.MeshPhysicalMaterial({ color: 0x8fd8ff, emissive: 0x3a8aff, emissiveIntensity: 0.8, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.88, flatShading: true });
  const head2 = new THREE.Group();
  head2.position.set(0, 1.12, -0.025);
  axe.add(head2);
  M(bg, bm, head2);
  const bg2 = M(bg, bm, head2, { sx: -1 });
  const flake2 = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), new THREE.MeshBasicMaterial({ map: snowflakeTex('#e0f4ff'), transparent: true, color: new THREE.Color(2, 2.4, 3), side: THREE.DoubleSide }));
  flake2.position.set(0, 0, 0.06);
  head2.add(flake2);
  for (let i = 0; i < 5; i++) M(cone(0.03, 0.16, 5), bm, axe, { y: -0.3 + i * 0.05, x: Math.sin(i * 2.4) * 0.05, z: Math.cos(i * 2.4) * 0.05, rz: Math.sin(i) * 0.6, rx: Math.cos(i * 2) * 0.6 });
  rig.ex.weapon = axe;

  // Mochila con cuerda
  const pack = new THREE.Group();
  pack.position.set(0, 0.46, -0.3);
  torso.add(pack);
  M(rbox(0.4, 0.42, 0.16, 0.05), red2, pack);
  M(tor(0.15, 0.045, 6, 16), std(0x8a5a3a, { roughness: 0.9 }), pack, { z: -0.12, y: -0.05 });
  M(tor(0.11, 0.045, 6, 16), std(0x9a6a4a, { roughness: 0.9 }), pack, { z: -0.14, y: 0.05 });
  M(cyl(0.05, 0.05, 0.2, 8), glow(0x60c8ff, 1.5), pack, { x: -0.16, y: 0.26, z: -0.06, rz: 0.2 });
  return rig;
}

const BUILDERS = { yagua: buildYagua, ambar: buildAmbar, vorak: buildVorak, nerea: buildNerea, coral: buildCoral, aurora: buildAurora };

/* ------------------------------------------------------------------ */
/*  Modelo animable                                                    */
/* ------------------------------------------------------------------ */
export class HeroModel {
  constructor(def) {
    this.def = def;
    this.rig = BUILDERS[def.id]();
    this.root = new THREE.Group();
    this.root.add(this.rig.root);
    this.rig.root.scale.setScalar(def.scale);
    this.t = Math.random() * 10;
    this.phase = 0;
    this.spin = 0;
    this.glowPulse = 0;
    this.light = new THREE.PointLight(ELEMENTS[def.element].color, 0.35, 10, 1.6);
    this.light.position.set(0, 1.4, 0.6);
    this.root.add(this.light);
    const r = this.rig;
    this.j = {
      hips: r.hips, torso: r.torso, head: r.head,
      thR: r.hipJ[0], thL: r.hipJ[1], knR: r.knee[0], knL: r.knee[1], anR: r.ankle[0], anL: r.ankle[1],
      shR: r.sh[0], shL: r.sh[1], elR: r.el[0], elL: r.el[1],
    };
    this.rot = {};
    for (const k in this.j) this.rot[k] = [0, 0, 0];
    this.hipY = HIP_H;
    this.weaponUp = 0;
    this.height = 2.34 * def.scale;
  }

  setVisible(v) {
    this.root.visible = v;
  }

  update(dt, s = {}) {
    this.t += dt;
    const t = this.t;
    const r = this.rig;
    const run = clamp(s.speed || 0, 0, 1.7);
    const swim = !!s.swimming;
    const air = !s.grounded && !swim && !s.surfing;
    this.phase += dt * (3 + run * 7) * (run > 0.05 ? 1 : 0.0);
    const ph = this.phase;
    const sn = Math.sin(ph);
    const T = {};
    for (const k in this.j) T[k] = [0, 0, 0];
    let hipY = HIP_H, bodyLean = 0, headX = 0;
    const carrying = s.carrying || 0;
    const rescue = s.rescue || 0;
    const cele = s.celebrate ? 1 : 0;
    const power = s.power || 0;

    // Base de reposo
    T.shR[2] = -0.1; T.shL[2] = 0.1;
    T.elR[0] = -0.15; T.elL[0] = -0.15;

    if (swim) {
      bodyLean = 1.25;
      headX = -1.05;
      const sp = clamp(run, 0.2, 1.2);
      const sw = this.phase * 0.9;
      T.shR[0] = -1.7 + Math.sin(sw) * 1.0 * sp; T.shL[0] = -1.7 - Math.sin(sw) * 1.0 * sp;
      T.elR[0] = -0.3 - Math.max(0, Math.cos(sw)) * 0.8; T.elL[0] = -0.3 - Math.max(0, -Math.cos(sw)) * 0.8;
      T.thR[0] = Math.sin(sw * 1.5) * 0.45; T.thL[0] = -Math.sin(sw * 1.5) * 0.45;
      T.knR[0] = 0.2 + Math.max(0, Math.sin(sw * 1.5)) * 0.5; T.knL[0] = 0.2 + Math.max(0, -Math.sin(sw * 1.5)) * 0.5;
      hipY = HIP_H - 0.02;
    } else if (s.dashing) {
      bodyLean = 1.1;
      T.shR[0] = 1.2; T.shL[0] = 1.2; T.shR[2] = -0.2; T.shL[2] = 0.2;
      T.thR[0] = 0.6; T.thL[0] = 0.9; T.knR[0] = 0.3; T.knL[0] = 0.5;
      headX = -0.6;
    } else if (s.gliding) {
      bodyLean = 0.95;
      T.shR[0] = -0.4; T.shL[0] = -0.4; T.shR[2] = -1.3; T.shL[2] = 1.3;
      T.thR[0] = 0.5; T.thL[0] = 0.4; T.knR[0] = 0.2; T.knL[0] = 0.2;
      headX = -0.7;
    } else if (air) {
      const up = (s.vy || 0) > 0;
      T.thR[0] = -0.55; T.thL[0] = 0.15; T.knR[0] = 1.0; T.knL[0] = 0.55;
      if (up) {
        T.shR[0] = -2.4; T.shL[0] = -2.4; T.shR[2] = -0.25; T.shL[2] = 0.25;
      } else {
        T.shR[0] = -0.4; T.shL[0] = -0.4; T.shR[2] = -1.2; T.shL[2] = 1.2;
      }
      bodyLean = 0.1;
    } else if (s.surfing) {
      bodyLean = 0.35;
      T.thR[0] = -0.3; T.thL[0] = 0.5; T.knR[0] = 0.6; T.knL[0] = 0.3;
      T.shR[0] = -0.8; T.shL[0] = -0.2; T.shR[2] = -0.7; T.shL[2] = 0.7;
      hipY = HIP_H - 0.1;
    } else {
      // Caminar / correr / reposo
      const amp = 0.95 * Math.min(run, 1.2);
      T.thR[0] = -sn * amp; T.thL[0] = sn * amp;
      T.knR[0] = (0.1 + Math.max(0, Math.sin(ph + 0.9)) * 1.05) * Math.min(run * 1.2, 1);
      T.knL[0] = (0.1 + Math.max(0, -Math.sin(ph + 0.9)) * 1.05) * Math.min(run * 1.2, 1);
      const aa = 0.85 * Math.min(run, 1.2);
      T.shR[0] = sn * aa; T.shL[0] = -sn * aa;
      T.elR[0] = -0.2 - run * 0.55; T.elL[0] = -0.2 - run * 0.55;
      hipY = HIP_H - Math.abs(Math.sin(ph)) * 0.05 * Math.min(run, 1.3) + Math.sin(t * 2) * 0.006 * (1 - Math.min(run, 1));
      bodyLean = 0.12 * run + Math.abs(sn) * 0.02;
    }

    if (r.ex.weapon && !swim) {
      T.shR[0] *= 0.4;
    }
    if (carrying > 0 && !swim) {
      T.shR[0] = -1.0; T.shL[0] = -1.0; T.elR[0] = -1.5; T.elL[0] = -1.5;
      T.shR[2] = 0.25; T.shL[2] = -0.25;
    }
    if (power > 0) {
      const k = Math.sin(clamp(power, 0, 1) * Math.PI);
      T.shR[0] = lerp(T.shR[0], -2.9, k); T.shL[0] = lerp(T.shL[0], -2.9, k);
      T.shR[2] = lerp(T.shR[2], -0.4, k); T.shL[2] = lerp(T.shL[2], 0.4, k);
      T.elR[0] = lerp(T.elR[0], -0.2, k); T.elL[0] = lerp(T.elL[0], -0.2, k);
      headX = lerp(headX, -0.4, k);
      this.glowPulse = Math.max(this.glowPulse, k);
    }
    if (rescue > 0) {
      const c = Math.sin(clamp(rescue, 0, 1) * Math.PI);
      hipY -= c * 0.42;
      T.thR[0] = lerp(T.thR[0], -1.3, c); T.thL[0] = lerp(T.thL[0], -1.3, c);
      T.knR[0] = lerp(T.knR[0], 1.7, c); T.knL[0] = lerp(T.knL[0], 1.7, c);
      T.shR[0] = lerp(T.shR[0], -1.3 - (1 - c) * 1.2, c); T.shL[0] = lerp(T.shL[0], -1.3 - (1 - c) * 1.2, c);
      T.elR[0] = lerp(T.elR[0], -0.5, c); T.elL[0] = lerp(T.elL[0], -0.5, c);
      bodyLean += c * 0.4;
    }
    if (cele) {
      const b = Math.abs(Math.sin(t * 6));
      hipY += b * 0.12;
      T.shR[0] = -3.0; T.shL[0] = -3.0; T.shR[2] = -0.5; T.shL[2] = 0.5;
      T.elR[0] = -0.3 + Math.sin(t * 12) * 0.3; T.elL[0] = -0.3 - Math.sin(t * 12) * 0.3;
      T.thR[0] = -0.2; T.thL[0] = -0.2; T.knR[0] = 0.3 + b * 0.4; T.knL[0] = 0.3 + b * 0.4;
      headX = -0.35;
      this.spin += dt * 3.2;
    } else {
      this.spin = damp(this.spin, Math.round(this.spin / TAU) * TAU, 6, dt);
    }
    r.body.rotation.y = this.spin;

    T.hips[0] = bodyLean;
    T.head[0] = headX + (swim ? 0 : Math.sin(t * 0.9) * 0.02);
    T.head[1] = swim ? 0 : Math.sin(t * 0.6) * 0.06;
    T.torso[1] = swim ? 0 : (s.dashing ? 0 : -Math.sin(ph) * 0.12 * Math.min(run, 1.2));
    T.torso[0] = -bodyLean * 0.25;

    const k = 16;
    for (const key in this.j) {
      const o = this.j[key], rot = this.rot[key], tg = T[key];
      rot[0] = damp(rot[0], tg[0], k, dt);
      rot[1] = damp(rot[1], tg[1], k, dt);
      rot[2] = damp(rot[2], tg[2], k, dt);
      o.rotation.set(rot[0], rot[1], rot[2]);
    }
    this.hipY = damp(this.hipY, hipY, 18, dt);
    r.hips.position.y = this.hipY;
    // respiración
    r.torso.scale.y = 1 + Math.sin(t * 2.2) * 0.012;

    // cola
    const wag = 0.16 + run * 0.12 + cele * 0.3 + (swim ? 0.1 : 0);
    for (let i = 0; i < r.tail.length; i++) {
      const p = r.tail[i];
      if (r.ex.auroraTail) {
        p.rotation.x = r.tailBase[0] + Math.sin(t * 1.6) * 0.06 - run * 0.15;
        p.rotation.y = Math.sin(t * 1.3) * 0.1;
      } else {
        p.rotation.y = Math.sin(t * 2.4 - i * 0.55) * wag * (0.5 + i * 0.12);
        if (i === 0) p.rotation.x = r.tailBase[0] * (1 - run * 0.3) + (swim ? -0.2 : 0);
      }
    }

    // extras específicos
    if (r.ex.wings) {
      const open = s.gliding ? 1 : air ? 0.55 : cele ? 0.8 : power > 0 ? 1 : 0.0;
      r.ex.wingOpen = damp(r.ex.wingOpen, open, 7, dt);
      const w = r.ex.wingOpen;
      const flap = s.gliding ? Math.sin(t * 3) * 0.08 : air ? Math.sin(t * 14) * 0.35 * w : Math.sin(t * 2) * 0.03;
      for (const wing of r.ex.wings) {
        wing.group.rotation.z = wing.side * (0.25 + w * 0.15 + flap);
        wing.group.rotation.y = wing.side * (w * 0.15 - 0.05);
        for (const f of wing.feathers) {
          f.holder.rotation.y = lerp(f.folded, f.open, w);
          f.holder.rotation.z = lerp(0.05, -0.08, w);
        }
        wing.disc.rotation.y += dt * 4;
        wing.disc.visible = w > 0.15;
        wing.disc.scale.setScalar(0.4 + w * 0.6);
      }
    }
    if (r.ex.gills) r.ex.gills.forEach((g, i) => (g.rotation.x = Math.sin(t * 4 + i) * 0.25));
    if (r.ex.axo) r.ex.axo.rotation.z = Math.sin(t * 1.4) * 0.05;
    if (r.ex.weapon && s.surfing) r.ex.weapon.rotation.z = Math.sin(t * 8) * 0.05;

    this.glowPulse = damp(this.glowPulse, 0, 3, dt);
    this.light.intensity = 0.35 + this.glowPulse * 5;
  }

  anchorFor(index) {
    return this.rig.anchors[index] || this.rig.anchors[0];
  }
}

/* ------------------------------------------------------------------ */
/*  Modelos GLB reales (opcional): public/models/manifest.json         */
/*  Sustituyen al modelo procedural si existen                         */
/* ------------------------------------------------------------------ */
class GLBHero {
  constructor(def, gltf, cfg) {
    this.def = def;
    this.root = new THREE.Group();
    this.t = 0;
    this.phase = 0;
    this.spin = 0;
    this.glowPulse = 0;
    const model = gltf.scene;
    const targetH = cfg.height || 1.85;
    let box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    model.scale.multiplyScalar(targetH / Math.max(0.001, size.y));
    box = new THREE.Box3().setFromObject(model);
    model.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const holder = new THREE.Group();
    holder.rotation.y = cfg.yaw || 0;
    holder.add(model);
    this.body = new THREE.Group();
    this.body.add(holder);
    this.root.add(this.body);
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        if (o.material) o.material.envMapIntensity = 1.1;
      }
    });
    this.height = targetH;
    const mk = (x, y, z) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      this.body.add(g);
      return g;
    };
    this.rig = { anchors: [mk(0, targetH * 0.42, targetH * 0.3), mk(0, targetH * 0.52, -targetH * 0.22), mk(targetH * 0.16, targetH * 0.86, 0)], ex: {} };
    this.light = new THREE.PointLight(ELEMENTS[def.element].color, 0.35, 10, 1.6);
    this.light.position.set(0, 1.4, 0.6);
    this.root.add(this.light);
    this.clips = {};
    if (gltf.animations && gltf.animations.length) {
      this.mixer = new THREE.AnimationMixer(model);
      const pick = (re) => gltf.animations.find((a) => re.test(a.name));
      const idle = pick(/idle|stand|breath/i) || gltf.animations[0];
      this.clips = {
        idle, run: pick(/run|sprint/i) || pick(/walk/i) || idle, walk: pick(/walk/i) || pick(/run/i) || idle,
        swim: pick(/swim/i), jump: pick(/jump|fall|air/i), cele: pick(/cele|dance|victory|win/i), power: pick(/power|cast|attack|spell/i),
      };
      this.action = null;
      this.actionName = '';
    }
  }
  setVisible(v) {
    this.root.visible = v;
  }
  play(name, fade = 0.25, speed = 1) {
    const clip = this.clips[name];
    if (!clip) return false;
    if (this.actionName !== name) {
      const next = this.mixer.clipAction(clip);
      next.reset().fadeIn(fade).play();
      if (this.action) this.action.fadeOut(fade);
      this.action = next;
      this.actionName = name;
    }
    this.action.timeScale = speed;
    return true;
  }
  update(dt, s = {}) {
    this.t += dt;
    const run = clamp(s.speed || 0, 0, 1.7);
    const swim = !!s.swimming;
    const air = !s.grounded && !swim && !s.surfing;
    this.phase += dt * (3 + run * 7) * (run > 0.05 ? 1 : 0);
    if (this.mixer) {
      let name = 'idle', sp = 1;
      if (s.celebrate && this.clips.cele) name = 'cele';
      else if (swim && this.clips.swim) name = 'swim';
      else if (air && this.clips.jump) name = 'jump';
      else if (s.power > 0.2 && this.clips.power) name = 'power';
      else if (run > 0.15) { name = run > 0.8 ? 'run' : 'walk'; sp = clamp(run * 1.1, 0.5, 1.6); }
      this.play(name, 0.22, sp);
      this.mixer.update(dt);
    }
    // movimiento procedural adicional (inclinación y rebote) que se suma a las animaciones del GLB
    const b = this.body;
    const bob = this.mixer ? 0 : Math.abs(Math.sin(this.phase)) * 0.07 * Math.min(run, 1.3);
    let lean = 0.14 * run;
    let y = bob;
    if (swim) { lean = 1.2; y = -0.25; }
    else if (s.gliding) lean = 0.9;
    else if (s.dashing) lean = 1.0;
    else if (air) lean = 0.15;
    if (s.rescue > 0) { y -= Math.sin(clamp(s.rescue, 0, 1) * Math.PI) * 0.35; lean += 0.3 * Math.sin(clamp(s.rescue, 0, 1) * Math.PI); }
    if (s.celebrate) { y += Math.abs(Math.sin(this.t * 6)) * 0.15; this.spin += dt * 3.2; }
    else this.spin = damp(this.spin, Math.round(this.spin / TAU) * TAU, 6, dt);
    b.rotation.x = damp(b.rotation.x, lean, 12, dt);
    b.rotation.y = this.spin;
    b.position.y = damp(b.position.y, y, 14, dt);
    if (s.power > 0) this.glowPulse = Math.max(this.glowPulse, Math.sin(clamp(s.power, 0, 1) * Math.PI));
    this.glowPulse = damp(this.glowPulse, 0, 3, dt);
    this.light.intensity = 0.35 + this.glowPulse * 5;
  }
  anchorFor(i) {
    return this.rig.anchors[i] || this.rig.anchors[0];
  }
}

const cache = {};
const glbCache = {};
export function getHeroModel(id) {
  if (glbCache[id]) return glbCache[id];
  if (!cache[id]) cache[id] = new HeroModel(HEROES.find((h) => h.id === id));
  return cache[id];
}
export function hasGLB(id) {
  return !!glbCache[id];
}
export async function preloadGLBHeroes() {
  let manifest = {};
  try {
    const r = await fetch('/models/manifest.json', { cache: 'no-store' });
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) manifest = await r.json();
  } catch (e) { /* sin manifest: se usan los modelos procedurales */ }
  const loader = new GLTFLoader();
  for (const def of HEROES) {
    const cfg = manifest[def.id];
    if (!cfg || !cfg.file) continue;
    try {
      const gltf = await loader.loadAsync('/models/' + cfg.file);
      glbCache[def.id] = new GLBHero(def, gltf, cfg);
    } catch (e) {
      console.warn('No se pudo cargar el GLB de', def.id, e);
    }
  }
  return Object.keys(glbCache);
}
