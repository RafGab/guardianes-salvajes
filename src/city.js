import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng, makeCanvas, texFromCanvas, smoothstep, clamp, fbm, lerp, TAU } from './utils.js';

export const CFG = {
  P: 32,
  GRID: 4,
  BLOCK_HALF: 11,
  CITY_HALF: 64,
  SAFE: { x: 0, z: -96, y: 10.2, r: 8 },
  START: { x: 0, z: 62 },
  GROUND_BLOCK: 0.16,
  MAP: { x0: -128, z0: -128, size: 256, n: 256 },
  MISSION_TIME: 360,
  WATER0: 0.1,
  WATER_BASE: 6.2,
  SURGE: 1.25,
  SURGE_T: 120,
};

/* ------------------------------------------------------------------ */
/*  Altura del terreno (calles bajas, aceras altas, colinas, refugio)  */
/* ------------------------------------------------------------------ */
export function terrainH(x, z) {
  const cheb = Math.max(Math.abs(x), Math.abs(z));
  const lx = ((((x + 64) % 32) + 32) % 32) - 16;
  const lz = ((((z + 64) % 32) + 32) % 32) - 16;
  const d = Math.max(Math.abs(lx), Math.abs(lz));
  const inGrid = 1 - smoothstep(58, 66, cheb);
  const curb = smoothstep(11.9, 10.4, d);
  let h = -0.02 + curb * 0.18 * inGrid;
  const r = Math.hypot(x, z);
  h += smoothstep(66, 100, cheb) * 0.6;
  h += smoothstep(98, 150, r) * (15 + 9 * fbm(x * 0.03 + 7, z * 0.03 + 3));
  const dx = x - CFG.SAFE.x, dz = z - CFG.SAFE.z;
  const dd = Math.hypot(dx, dz);
  const gauss = 10.2 * Math.exp(-(dd * dd) / (2 * 15 * 15));
  const plateau = smoothstep(12, 7, dd);
  h = Math.max(h, lerp(gauss, 10.2, plateau));
  return h;
}

/* ------------------------------------------------------------------ */
/*  Lote de geometrías estáticas fusionadas (menos draw calls)         */
/* ------------------------------------------------------------------ */
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
export function M4(x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  return _m.clone();
}

class Batch {
  constructor() {
    this.map = new Map();
  }
  add(geo, key, matrix, color) {
    let g = geo.clone();
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(matrix);
    if (!g.attributes.color) {
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      const c = color instanceof THREE.Color ? color : new THREE.Color(color === undefined ? 0xffffff : color);
      for (let i = 0; i < n; i++) {
        arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    let l = this.map.get(key);
    if (!l) this.map.set(key, (l = []));
    l.push(g);
  }
  build(scene, materials, opts = {}) {
    const meshes = {};
    for (const [key, list] of this.map) {
      const merged = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(merged, materials[key]);
      const o = opts[key] || {};
      mesh.castShadow = o.cast !== false;
      mesh.receiveShadow = o.receive !== false;
      scene.add(mesh);
      meshes[key] = mesh;
      list.forEach((g) => g.dispose());
    }
    return meshes;
  }
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
unitBox.translate(0, 0.5, 0);
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10);
unitCyl.translate(0, 0.5, 0);
const unitCone = new THREE.ConeGeometry(1, 1, 8);
unitCone.translate(0, 0.5, 0);
const unitIco = new THREE.IcosahedronGeometry(1, 0);

/* ------------------------------------------------------------------ */
/*  Texturas                                                            */
/* ------------------------------------------------------------------ */
function makeFacadeTextures() {
  const S = 512;
  const c = makeCanvas(S);
  const e = makeCanvas(S);
  const g = c.getContext('2d');
  const ge = e.getContext('2d');
  const r = makeRng(77);
  g.fillStyle = '#e4dfd4';
  g.fillRect(0, 0, S, S);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(60,50,40,${r.range(0.02, 0.06)})`;
    g.fillRect(r.range(0, S), r.range(0, S), r.range(2, 8), r.range(40, 200));
  }
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 16 + col * 128, y = 18 + row * 128, w = 96, h = 84;
      g.fillStyle = 'rgba(70,60,50,.55)';
      g.fillRect(x - 6, y - 6, w + 12, h + 12);
      const lit = r.chance(0.34);
      const grd = g.createLinearGradient(x, y, x + w, y + h);
      if (lit) {
        grd.addColorStop(0, '#ffe0a0');
        grd.addColorStop(1, '#f2b466');
      } else {
        grd.addColorStop(0, '#41566b');
        grd.addColorStop(0.5, '#1f2c3a');
        grd.addColorStop(1, '#2c3d4f');
      }
      g.fillStyle = grd;
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(40,35,30,.8)';
      g.fillRect(x + w / 2 - 2, y, 4, h);
      g.fillRect(x, y + h * 0.55, w, 3);
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.fillRect(x - 8, y + h + 6, w + 16, 6);
      if (lit) {
        ge.fillStyle = '#ffb056';
        ge.fillRect(x, y, w, h);
        ge.fillStyle = '#000';
        ge.fillRect(x + w / 2 - 2, y, 4, h);
      }
    }
  }
  return { map: texFromCanvas(c, { repeat: true, aniso: 8 }), em: texFromCanvas(e, { repeat: true, aniso: 8 }) };
}

export function paintGround(parkBlocks, plazaBlocks) {
  const S = 2048;
  const c = makeCanvas(S);
  const g = c.getContext('2d');
  const px = (v) => ((v + 128) / 256) * S;
  const sz = (v) => (v / 256) * S;
  // hierba con ruido (baja resolución escalada)
  const nc = makeCanvas(256);
  const ng = nc.getContext('2d');
  const id = ng.createImageData(256, 256);
  for (let j = 0; j < 256; j++) {
    for (let i = 0; i < 256; i++) {
      const n = fbm(i * 0.05, j * 0.05, 4);
      const n2 = fbm(i * 0.3 + 40, j * 0.3, 2);
      const k = (j * 256 + i) * 4;
      id.data[k] = 82 + n * 40 + n2 * 14;
      id.data[k + 1] = 112 + n * 42 + n2 * 16;
      id.data[k + 2] = 66 + n * 22;
      id.data[k + 3] = 255;
    }
  }
  ng.putImageData(id, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(nc, 0, 0, S, S);
  // asfalto de toda la cuadrícula
  g.fillStyle = '#34373b';
  g.fillRect(px(-70), px(-70), sz(140), sz(140));
  const r = makeRng(5);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${r.chance(0.5) ? '255,255,255' : '0,0,0'},${r.range(0.02, 0.06)})`;
    g.fillRect(px(r.range(-70, 70)), px(r.range(-70, 70)), r.range(2, 8), r.range(2, 8));
  }
  // manzanas: acera
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const cx = (i - 1.5) * 32, cz = (j - 1.5) * 32;
      g.fillStyle = '#9da0a2';
      g.fillRect(px(cx - 11.6), px(cz - 11.6), sz(23.2), sz(23.2));
      g.fillStyle = '#767a7d';
      g.fillRect(px(cx - 10.4), px(cz - 10.4), sz(20.8), sz(20.8));
      const key = `${i},${j}`;
      if (parkBlocks.has(key)) {
        g.fillStyle = '#5b8a45';
        g.fillRect(px(cx - 10.4), px(cz - 10.4), sz(20.8), sz(20.8));
        for (let k = 0; k < 500; k++) {
          g.fillStyle = `rgba(${r.chance(0.5) ? '30,70,20' : '150,190,90'},${r.range(0.05, 0.14)})`;
          g.fillRect(px(cx + r.range(-10.4, 10.4)), px(cz + r.range(-10.4, 10.4)), r.range(3, 14), r.range(3, 14));
        }
        g.strokeStyle = '#c9c0a8';
        g.lineWidth = sz(0.9);
        g.beginPath();
        g.moveTo(px(cx - 10.4), px(cz));
        g.lineTo(px(cx + 10.4), px(cz));
        g.moveTo(px(cx), px(cz - 10.4));
        g.lineTo(px(cx), px(cz + 10.4));
        g.stroke();
      } else if (plazaBlocks.has(key)) {
        g.fillStyle = '#b8a888';
        g.fillRect(px(cx - 10.4), px(cz - 10.4), sz(20.8), sz(20.8));
        g.strokeStyle = 'rgba(80,60,40,.35)';
        g.lineWidth = 1;
        for (let k = -10; k <= 10; k += 2) {
          g.beginPath();
          g.moveTo(px(cx + k), px(cz - 10.4));
          g.lineTo(px(cx + k), px(cz + 10.4));
          g.moveTo(px(cx - 10.4), px(cz + k));
          g.lineTo(px(cx + 10.4), px(cz + k));
          g.stroke();
        }
      }
    }
  }
  // marcas viales
  g.fillStyle = '#d8cf8a';
  for (const cz of [-64, -32, 0, 32, 64]) {
    for (let x = -66; x < 66; x += 4) {
      if (Math.abs((((x + 64) % 32) + 32) % 32 - 16) < 6.5) continue;
      g.fillRect(px(x), px(cz - 0.12), sz(2), sz(0.24));
    }
  }
  for (const cx of [-64, -32, 0, 32, 64]) {
    for (let z = -66; z < 66; z += 4) {
      if (Math.abs((((z + 64) % 32) + 32) % 32 - 16) < 6.5) continue;
      g.fillRect(px(cx - 0.12), px(z), sz(0.24), sz(2));
    }
  }
  g.fillStyle = 'rgba(235,235,225,.75)';
  for (const cz of [-32, 0, 32]) {
    for (const cx of [-32, 0, 32]) {
      for (let k = -3.6; k <= 3.6; k += 1.2) {
        g.fillRect(px(cx + k - 0.3), px(cz - 8.4), sz(0.6), sz(2.2));
        g.fillRect(px(cx + k - 0.3), px(cz + 6.2), sz(0.6), sz(2.2));
        g.fillRect(px(cx - 8.4), px(cz + k - 0.3), sz(2.2), sz(0.6));
        g.fillRect(px(cx + 6.2), px(cz + k - 0.3), sz(2.2), sz(0.6));
      }
    }
  }
  // plaza del refugio
  const S0 = CFG.SAFE;
  g.fillStyle = '#b4b7b4';
  g.beginPath();
  g.arc(px(S0.x), px(S0.z), sz(9), 0, TAU);
  g.fill();
  g.strokeStyle = '#e8e8e0';
  g.lineWidth = sz(0.35);
  g.beginPath();
  g.arc(px(S0.x), px(S0.z), sz(6.4), 0, TAU);
  g.stroke();
  g.fillStyle = '#e8e8e0';
  g.font = `bold ${sz(6)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('H', px(S0.x), px(S0.z));
  return { tex: texFromCanvas(c, { aniso: 8 }), canvas: c };
}

/* ------------------------------------------------------------------ */
/*  Geometría de fachada con UV por metro                              */
/* ------------------------------------------------------------------ */
function facadeBox(w, h, d, tint, topColor) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const col = new Float32Array(pos.count * 3);
  const dark = new THREE.Color(0x222222);
  g.userData.tint = true;
  for (let i = 0; i < pos.count; i++) {
    const ny = nor.getY(i), nx = nor.getX(i);
    let c;
    if (Math.abs(ny) > 0.5) {
      uv.setXY(i, 0.006, 0.006);
      c = ny > 0 ? topColor : dark;
    } else {
      const along = Math.abs(nx) > 0.5 ? pos.getZ(i) + d / 2 : pos.getX(i) + w / 2;
      uv.setXY(i, along / 16, pos.getY(i) / 12.8);
      c = tint;
    }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/* ------------------------------------------------------------------ */
/*  Construcción de la ciudad                                          */
/* ------------------------------------------------------------------ */
export function buildCity(scene, { quality = 'high' } = {}) {
  const rng = makeRng(2024);
  const batch = new Batch();
  const solids = [];
  const buildings = [];
  const roofs = [];
  const porches = [];
  const signs = [];
  const treeSpots = [];
  const carSlots = [];
  const kiosks = [];
  const landings = [];
  const G = CFG.GROUND_BLOCK;

  const addSolid = (x0, x1, y0, y1, z0, z1, tag = 'static') => {
    const s = { x0, x1, y0, y1, z0, z1, tag, dyn: false, dx: 0, dy: 0, dz: 0, _q: 0 };
    solids.push(s);
    return s;
  };
  const addBox = (cx, y0, cz, w, h, d, color, { key = 'flat', solid = true, tag = 'static', ry = 0 } = {}) => {
    batch.add(unitBox, key, M4(cx, y0, cz, w, h, d, ry), color);
    if (solid) return addSolid(cx - w / 2, cx + w / 2, y0 - 0.5, y0 + h, cz - d / 2, cz + d / 2, tag);
    return null;
  };

  const facade = makeFacadeTextures();
  const wallColors = ['#e8d8c0', '#d9c2a5', '#c9d4d8', '#e6c9c0', '#cfd8c0', '#d8cfe0', '#f0e6c8', '#e0b89a', '#b8c8d8'];
  const layout = [
    ['midPair', 'tower', 'park', 'lowRow'],
    ['lowRow', 'plaza', 'midPair', 'tower'],
    ['tower', 'lot', 'lowRow', 'park'],
    ['park', 'lowRow', 'midPair', 'lot'],
  ];
  const parkBlocks = new Set();
  const plazaBlocks = new Set();
  const blocks = [];

  /* ---------- helpers de construcción ---------- */
  function addBuilding({ x, z, w, d, h, kind, bi, bj, tint }) {
    const t = new THREE.Color(tint);
    const roofCol = new THREE.Color(0x4a4d52);
    batch.add(facadeBox(w, h, d, t, roofCol), 'facade', M4(x, G, z));
    const roofY = G + h + 0.35;
    // losa y pretil
    batch.add(unitBox, 'flat', M4(x, G + h, z, w + 0.5, 0.35, d + 0.5), 0x6b6e73);
    const pc = 0x9a9ca0;
    batch.add(unitBox, 'flat', M4(x, roofY, z - d / 2 - 0.05, w + 0.5, 0.45, 0.2), pc);
    batch.add(unitBox, 'flat', M4(x, roofY, z + d / 2 + 0.05, w + 0.5, 0.45, 0.2), pc);
    batch.add(unitBox, 'flat', M4(x - w / 2 - 0.05, roofY, z, 0.2, 0.45, d + 0.5), pc);
    batch.add(unitBox, 'flat', M4(x + w / 2 + 0.05, roofY, z, 0.2, 0.45, d + 0.5), pc);
    const sol = addSolid(x - w / 2 - 0.25, x + w / 2 + 0.25, G - 1, roofY, z - d / 2 - 0.25, z + d / 2 + 0.25, 'building');
    const b = { x, z, w, d, h, roofY, kind, bi, bj, solid: sol };
    buildings.push(b);
    roofs.push({ b, kind, roofY, x, z });
    // franja comercial oscura en planta baja
    batch.add(unitBox, 'flat', M4(x, G, z + d / 2 + 0.03, w * 0.9, 2.6, 0.06), 0x2a3038);
    batch.add(unitBox, 'flat', M4(x, G, z - d / 2 - 0.03, w * 0.9, 2.6, 0.06), 0x2a3038);
    // toldo
    if (rng.chance(0.7)) {
      const ac = rng.pick([0xc0392b, 0x2e86c1, 0xd4a017, 0x27ae60, 0xe67e22]);
      batch.add(unitBox, 'flat', M4(x, G + 2.9, z + d / 2 + 0.6, w * 0.8, 0.12, 1.4, 0, -0.2), ac);
    }
    return b;
  }

  function roofProps(b) {
    const { x, z, w, d, roofY } = b;
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const px = x + rng.range(-w / 2 + 1.4, w / 2 - 1.4);
      const pz = z + rng.range(-d / 2 + 1.4, d / 2 - 1.4);
      // mantener libre el centro donde puede haber un rescatable
      if (Math.abs(px - x) < 2 && Math.abs(pz - z) < 2) continue;
      addBox(px, roofY, pz, rng.range(1.2, 2.0), rng.range(0.8, 1.3), rng.range(1, 1.6), rng.pick([0x9aa0a6, 0x8a9096, 0xb0b4b8]), { solid: false });
    }
    if (rng.chance(0.55) && w > 8) {
      const tx = x + w / 2 - 1.8, tz = z + d / 2 - 1.8;
      for (const [ox, oz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) batch.add(unitBox, 'flat', M4(tx + ox, roofY, tz + oz, 0.12, 1.4, 0.12), 0x4a4a4a);
      batch.add(unitCyl, 'flat', M4(tx, roofY + 1.4, tz, 0.95, 1.4, 0.95), 0x8a6a4a);
      batch.add(unitCone, 'flat', M4(tx, roofY + 2.8, tz, 1.0, 0.6, 1.0), 0x5a3a2a);
    }
    if (rng.chance(0.5)) batch.add(unitCyl, 'flat', M4(x - w / 2 + 1, roofY, z - d / 2 + 1, 0.05, rng.range(2.5, 5), 0.05), 0x505050);
  }

  function fireEscape(b, side, color = 0x4a3a34) {
    const n = Math.floor((b.roofY - G - 0.3) / 2.2);
    for (let k = 1; k <= n; k++) {
      const top = G + k * 2.2;
      const off = (k % 2 ? -1 : 1) * 1.4;
      let cx, cz, w, d;
      if (side === 'S') { cx = b.x + off; cz = b.z + b.d / 2 + 0.65; w = 2.8; d = 1.3; }
      else if (side === 'N') { cx = b.x + off; cz = b.z - b.d / 2 - 0.65; w = 2.8; d = 1.3; }
      else if (side === 'E') { cx = b.x + b.w / 2 + 0.65; cz = b.z + off; w = 1.3; d = 2.8; }
      else { cx = b.x - b.w / 2 - 0.65; cz = b.z + off; w = 1.3; d = 2.8; }
      addBox(cx, top - 0.6, cz, w, 0.6, d, color, { tag: 'landing' });
      landings.push({ x: cx, z: cz, top, b });
      // barandillas visuales
      const rc = 0x7a6a60;
      if (side === 'S') batch.add(unitBox, 'flat', M4(cx, top, cz + d / 2 - 0.05, w, 0.9, 0.06), rc);
      else if (side === 'N') batch.add(unitBox, 'flat', M4(cx, top, cz - d / 2 + 0.05, w, 0.9, 0.06), rc);
      else if (side === 'E') batch.add(unitBox, 'flat', M4(cx + w / 2 - 0.05, top, cz, 0.06, 0.9, d), rc);
      else batch.add(unitBox, 'flat', M4(cx - w / 2 + 0.05, top, cz, 0.06, 0.9, d), rc);
    }
  }

  function stairs(x, z, dx, dz, width, y0, top, n, color = 0x8a8d90) {
    const rise = (top - y0) / n;
    const run = 0.42;
    for (let i = 0; i < n; i++) {
      const cx = x + dx * run * (i + 0.5);
      const cz = z + dz * run * (i + 0.5);
      const w = dx !== 0 ? run : width;
      const d = dz !== 0 ? run : width;
      const h = rise * (i + 1);
      batch.add(unitBox, 'flat', M4(cx, y0, cz, w, h, d), color);
      addSolid(cx - w / 2, cx + w / 2, y0 - 0.5, y0 + h, cz - d / 2, cz + d / 2, 'stairs');
    }
  }

  function crateStack(x, z) {
    addBox(x, G, z, 1.5, 2.6, 1.5, 0x9a6a3a, { tag: 'crate' });
    batch.add(unitBox, 'flat', M4(x, G + 1.3, z, 1.56, 0.08, 1.56), 0x6a4a2a);
    addBox(x + 1.5, G, z + 0.3, 1.3, 1.3, 1.3, 0xb07a44, { tag: 'crate' });
  }

  function tree(x, z, s = 1) {
    const y = terrainH(x, z);
    batch.add(unitCyl, 'trees', M4(x, y - 0.1, z, 0.28 * s, 3.4 * s, 0.28 * s), 0x5a3f2a);
    const greens = [0x3f7d3a, 0x4a8f3e, 0x2f6a34, 0x58a044];
    const sp = [[0, 4.6, 0, 1.9], [0.9, 3.7, 0.5, 1.4], [-0.8, 5.5, -0.3, 1.3], [-0.5, 3.9, 0.9, 1.2]];
    for (const [ox, oy, oz, r] of sp) batch.add(unitIco, 'trees', M4(x + ox * s, y + oy * s, z + oz * s, r * s, r * s * 0.9, r * s, rng.range(0, 3)), rng.pick(greens));
    addSolid(x - 0.35 * s, x + 0.35 * s, y - 1, y + 7 * s, z - 0.35 * s, z + 0.35 * s, 'tree');
  }

  function bench(x, z, ry) {
    batch.add(unitBox, 'flat', M4(x, G, z, ry ? 0.5 : 2, 0.5, ry ? 2 : 0.5), 0x6a4a2a);
    addSolid(x - (ry ? 0.25 : 1), x + (ry ? 0.25 : 1), G - 1, G + 0.5, z - (ry ? 1 : 0.25), z + (ry ? 1 : 0.25), 'bench');
  }

  /* ---------- tipos de manzana ---------- */
  function blockTower(cx, cz, bi, bj) {
    const w = rng.range(12, 14.5), d = rng.range(12, 14.5);
    const h = rng.pick([16, 19.2, 22.4]);
    const b = addBuilding({ x: cx + rng.range(-1, 1), z: cz + rng.range(-1, 1), w, d, h, kind: 'tower', bi, bj, tint: rng.pick(wallColors) });
    roofProps(b);
    fireEscape(b, rng.pick(['S', 'N', 'E', 'W']));
    return [b];
  }
  function blockMid(cx, cz, bi, bj) {
    const res = [];
    const hs = rng.chance(0.5) ? [9.6, 12.8] : [12.8, 9.6];
    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? -1 : 1;
      const w = 10, d = 19;
      const b = addBuilding({ x: cx + s * 5.2, z: cz, w, d, h: hs[k], kind: hs[k] < 10 ? 'mid9' : 'mid12', bi, bj, tint: rng.pick(wallColors) });
      roofProps(b);
      if (hs[k] < 10) {
        const n = Math.round((b.roofY - G) / 0.42);
        stairs(b.x + s * (w / 2 + 0.9), b.z + d / 2 - 0.6, 0, -1, 1.6, G, b.roofY, n);
      } else fireEscape(b, s < 0 ? 'W' : 'E');
      res.push(b);
    }
    return res;
  }
  function blockLow(cx, cz, bi, bj) {
    const res = [];
    const hs = rng.pick([[3.2, 6.4, 3.2], [6.4, 3.2, 3.2], [3.2, 3.2, 6.4]]);
    const porchIdx = rng.pick([0, 1, 2].filter((i) => hs[i] < 5));
    for (let k = 0; k < 3; k++) {
      const w = 6.6, d = 17;
      const b = addBuilding({ x: cx + (k - 1) * 7.0, z: cz, w, d, h: hs[k], kind: hs[k] > 5 ? 'low6' : 'low3', bi, bj, tint: rng.pick(wallColors) });
      roofProps(b);
      res.push(b);
      const sgn = cz > 0 ? -1 : 1; // frente hacia el centro del mapa
      if (hs[k] > 5) {
        const n = Math.round((b.roofY - G) / 0.42);
        stairs(b.x - 3.2, b.z + sgn * (d / 2 + 0.85), 1, 0, 1.6, G, b.roofY, n);
      } else if (k === porchIdx) {
        const py = G + 2.3;
        addBox(b.x, py - 0.25, b.z + sgn * (d / 2 + 0.95), 3.4, 0.3, 1.9, 0x7a5a3a, { tag: 'porch' });
        for (const ox of [-1.5, 1.5]) batch.add(unitBox, 'flat', M4(b.x + ox, G, b.z + sgn * (d / 2 + 1.7), 0.14, 2.05, 0.14), 0x5a3a2a);
        porches.push({ x: b.x, z: b.z + sgn * (d / 2 + 0.95), y: py, b });
      } else {
        crateStack(b.x + 1.2, b.z + sgn * (d / 2 + 1.0));
      }
    }
    return res;
  }
  function blockPark(cx, cz, bi, bj) {
    parkBlocks.add(`${bi},${bj}`);
    for (let i = 0; i < 7; i++) {
      const tx = cx + rng.range(-8.5, 8.5), tz = cz + rng.range(-8.5, 8.5);
      if (Math.abs(tx - cx) < 2 || Math.abs(tz - cz) < 2) continue;
      tree(tx, tz, rng.range(0.9, 1.3));
    }
    bench(cx + 4, cz + 1.6, 0);
    bench(cx - 4, cz - 1.6, 0);
    bench(cx + 1.6, cz - 5, 1);
    // quiosco con azotea
    const kx = cx - 6, kz = cz + 6;
    addBox(kx, G, kz, 3.2, 2.6, 3.2, 0xd8b048, { tag: 'kiosk' });
    batch.add(unitBox, 'flat', M4(kx, G + 2.6, kz, 3.8, 0.2, 3.8), 0xb03a2e);
    kiosks.push({ x: kx, z: kz, top: G + 2.6 });
    // juegos infantiles: bloque bajo
    addBox(cx + 6, G, cz - 6, 2.4, 0.9, 2.4, 0x3a8fd0, { tag: 'play' });
  }
  function blockPlaza(cx, cz, bi, bj) {
    plazaBlocks.add(`${bi},${bj}`);
    // fuente
    batch.add(unitCyl, 'flat', M4(cx, G, cz, 3.6, 0.9, 3.6), 0x9a9a98);
    batch.add(unitCyl, 'flat', M4(cx, G + 0.9, cz, 0.5, 2.2, 0.5), 0x8a8a88);
    batch.add(unitCyl, 'flat', M4(cx, G + 3.0, cz, 1.4, 0.25, 1.4), 0x9a9a98);
    batch.add(unitCyl, 'flat', M4(cx, G + 0.85, cz, 3.3, 0.06, 3.3), 0x3a7a90);
    addSolid(cx - 3.4, cx + 3.4, G - 1, G + 0.9, cz - 3.4, cz + 3.4, 'fountain');
    // puestos de mercado
    for (const [ox, oz] of [[-7, -6], [7, -6], [-7, 6], [7, 6]]) {
      const c = rng.pick([0xc0392b, 0x2e86c1, 0xd4a017, 0x27ae60]);
      addBox(cx + ox, G, cz + oz, 3, 1.0, 1.6, 0x8a6a4a, { tag: 'stall' });
      for (const [px, pz] of [[-1.5, -0.8], [1.5, -0.8], [-1.5, 0.8], [1.5, 0.8]]) batch.add(unitBox, 'flat', M4(cx + ox + px, G, cz + oz + pz, 0.1, 2.5, 0.1), 0x4a4a4a);
      batch.add(unitBox, 'flat', M4(cx + ox, G + 2.5, cz + oz, 3.4, 0.14, 2.2, 0, -0.12), c);
    }
    for (const [ox, oz] of [[-8.5, 0], [8.5, 0], [0, -8.5], [0, 8.5]]) tree(cx + ox, cz + oz, 1.1);
    // estatua
    batch.add(unitBox, 'flat', M4(cx, G, cz - 8, 1.6, 1.4, 1.6), 0x8a8a88);
    batch.add(unitCyl, 'flat', M4(cx, G + 1.4, cz - 8, 0.4, 2.4, 0.4), 0xb08a4a);
    addSolid(cx - 0.8, cx + 0.8, G - 1, G + 3.8, cz - 8.8, cz - 7.2, 'statue');
  }
  function blockLot(cx, cz, bi, bj) {
    // contenedores apilables
    const cols = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd4a017, 0x8e44ad];
    const spots = [[-6, -6, 0], [-6, 0, 0], [5, 6, 1]];
    for (const [ox, oz, rot] of spots) {
      const w = rot ? 2.4 : 6, d = rot ? 6 : 2.4;
      addBox(cx + ox, G, cz + oz, w, 2.6, d, rng.pick(cols), { tag: 'container' });
      if (rng.chance(0.7)) addBox(cx + ox + (rot ? 0 : 0.6), G + 2.6, cz + oz + (rot ? 0.6 : 0), w, 2.6, d, rng.pick(cols), { tag: 'container' });
    }
    addBox(cx + 6, G, cz - 5, 1.6, 1.3, 1.6, 0xb07a44, { tag: 'crate' });
    addBox(cx + 6, G, cz - 3.2, 1.6, 2.6, 1.6, 0x9a6a3a, { tag: 'crate' });
    // barreras
    for (let k = -2; k <= 2; k++) batch.add(unitBox, 'flat', M4(cx + k * 3.5, G, cz + 9.4, 2.4, 0.9, 0.5), 0xd8d8d0);
  }

  const blockInfo = [];
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const cx = (i - 1.5) * CFG.P, cz = (j - 1.5) * CFG.P;
      const type = layout[j][i];
      let bs = [];
      if (type === 'tower') bs = blockTower(cx, cz, i, j);
      else if (type === 'midPair') bs = blockMid(cx, cz, i, j);
      else if (type === 'lowRow') bs = blockLow(cx, cz, i, j);
      else if (type === 'park') blockPark(cx, cz, i, j);
      else if (type === 'plaza') blockPlaza(cx, cz, i, j);
      else if (type === 'lot') blockLot(cx, cz, i, j);
      blockInfo.push({ i, j, cx, cz, type, buildings: bs });
    }
  }

  /* ---------- farolas ---------- */
  const lampGlow = new THREE.Color(0xffd28a).multiplyScalar(3);
  for (const line of [-64, -32, 0, 32, 64]) {
    for (let t = -60; t <= 60; t += 16) {
      for (const [x, z, ax] of [[t + 8, line + 5.6, 0], [line + 5.6, t + 8, 1]]) {
        if (Math.abs(x) > 66 || Math.abs(z) > 66) continue;
        batch.add(unitCyl, 'flat', M4(x, G, z, 0.09, 6.2, 0.09), 0x3a3d40);
        const dx = ax ? -1 : 0, dz = ax ? 0 : -1;
        batch.add(unitBox, 'flat', M4(x + dx * 0.6, G + 6.1, z + dz * 0.6, ax ? 1.3 : 0.1, 0.1, ax ? 0.1 : 1.3), 0x3a3d40);
        batch.add(unitBox, 'glow', M4(x + dx * 1.2, G + 5.98, z + dz * 1.2, 0.5, 0.12, 0.3), lampGlow);
      }
    }
  }

  /* ---------- árboles exteriores ---------- */
  const rt = makeRng(31);
  for (let i = 0; i < 110; i++) {
    const a = rt.range(0, TAU), r = rt.range(70, 122);
    const x = Math.cos(a) * r + rt.range(-8, 8), z = Math.sin(a) * r + rt.range(-8, 8);
    if (Math.hypot(x - CFG.SAFE.x, z - CFG.SAFE.z) < 12) continue;
    tree(x, z, rt.range(1, 1.7));
  }
  // árboles en el borde de la ciudad (entre ciudad y colinas)
  for (let i = 0; i < 26; i++) {
    const s = rt.chance(0.5) ? 1 : -1;
    const along = rt.range(-64, 64);
    const off = rt.range(68, 78);
    if (rt.chance(0.5)) tree(along, s * off, rt.range(1, 1.4)); else tree(s * off, along, rt.range(1, 1.4));
  }

  /* ---------- carteles educativos ---------- */
  const signSpots = [
    { x: 4.8, z: 55, ry: 0, tip: 'sign_start' },
    { x: -27, z: 26, ry: 0, tip: 'sign_1' },
    { x: 27, z: -6, ry: 0, tip: 'sign_2' },
    { x: -5, z: -30, ry: 0, tip: 'sign_3' },
    { x: 37, z: -38, ry: 0, tip: 'sign_4' },
    { x: -5, z: -70, ry: 0, tip: 'sign_5' },
  ];
  for (const s of signSpots) signs.push({ ...s, y: terrainH(s.x, s.z), used: false });

  /* ---------- refugio ---------- */
  const S0 = CFG.SAFE;
  const safe = new THREE.Group();
  safe.position.set(S0.x, S0.y, S0.z);
  scene.add(safe);
  const cyM = (r, h, col, o = {}) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), new THREE.MeshStandardMaterial({ color: col, roughness: 0.8, ...o }));
  const disc = cyM(9, 0.3, 0xa8aaa8);
  disc.position.y = -0.1;
  disc.receiveShadow = true;
  safe.add(disc);
  // tiendas
  const tentMat = [0xf0f0e8, 0xe8853a, 0xf0f0e8];
  [[-6.5, -3], [-6.5, 3], [6.5, 3.5]].forEach(([x, z], i) => {
    const t = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.4, 4), new THREE.MeshStandardMaterial({ color: tentMat[i], roughness: 0.9 }));
    t.position.set(x, 1.4, z);
    t.rotation.y = Math.PI / 4;
    t.castShadow = true;
    safe.add(t);
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 3.4), new THREE.MeshStandardMaterial({ color: tentMat[i], roughness: 0.9 }));
    base.position.set(x, 0.2, z);
    base.rotation.y = Math.PI / 4;
    safe.add(base);
  });
  // ambulancia
  const amb = new THREE.Group();
  amb.position.set(5.5, 0, -4);
  amb.rotation.y = -0.4;
  safe.add(amb);
  const ab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.8, 4.2), new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.4 }));
  ab.position.y = 1.15;
  ab.castShadow = true;
  amb.add(ab);
  const ac = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.5, 1.4), new THREE.MeshStandardMaterial({ color: 0xd42020, roughness: 0.4 }));
  ac.position.set(0, 1.1, 0.4);
  amb.add(ac);
  const light = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2020).multiplyScalar(3) }));
  light.position.set(0, 2.15, 1.3);
  amb.add(light);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.7, 0.16), new THREE.MeshBasicMaterial({ color: 0xd42020 }));
  cross.position.set(0, 1.3, -1.5);
  amb.add(cross);
  const wheelM = new THREE.MeshStandardMaterial({ color: 0x151515 });
  for (const [x, z] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 14), wheelM);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.4, z);
    amb.add(w);
  }
  addSolid(S0.x + 4.4, S0.x + 6.6, S0.y - 1, S0.y + 2.2, S0.z - 6.2, S0.z - 1.8, 'ambulance');
  // helicóptero
  const heli = new THREE.Group();
  heli.position.set(-2.5, 0, -6.5);
  heli.rotation.y = 0.5;
  safe.add(heli);
  const hb = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd42a20, roughness: 0.35, metalness: 0.3 }));
  hb.scale.set(1, 0.9, 1.6);
  hb.position.y = 1.5;
  hb.castShadow = true;
  heli.add(hb);
  const hg = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 10), new THREE.MeshStandardMaterial({ color: 0x223a4a, roughness: 0.05, metalness: 0.9 }));
  hg.scale.set(1, 0.85, 1);
  hg.position.set(0, 1.75, 1.2);
  heli.add(hg);
  const boom = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 4), new THREE.MeshStandardMaterial({ color: 0xd42a20 }));
  boom.position.set(0, 1.7, -3.4);
  boom.castShadow = true;
  heli.add(boom);
  const rotor = new THREE.Group();
  rotor.position.set(0, 2.8, 0);
  heli.add(rotor);
  for (let i = 0; i < 2; i++) {
    const bl = new THREE.Mesh(new THREE.BoxGeometry(9, 0.05, 0.35), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    bl.rotation.y = i * Math.PI / 2;
    rotor.add(bl);
  }
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.25, 2.0, -5.3);
  heli.add(tailRotor);
  tailRotor.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.6, 0.2), new THREE.MeshStandardMaterial({ color: 0x222222 })));
  for (const x of [-0.9, 0.9]) {
    const sk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 3.2), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    sk.position.set(x, 0.15, 0.2);
    heli.add(sk);
  }
  addSolid(S0.x - 4.6, S0.x - 0.6, S0.y - 1, S0.y + 3, S0.z - 8.6, S0.z - 4.4, 'heli');
  // bandera y cartel
  const pole = cyM(0.08, 7, 0xdddddd);
  pole.position.set(0, 3.5, 6);
  safe.add(pole);
  const flagGeo = new THREE.PlaneGeometry(2.6, 1.5, 12, 4);
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: 0x2ecc71, side: THREE.DoubleSide, roughness: 0.7, emissive: 0x0a4a20, emissiveIntensity: 0.4 }));
  flag.position.set(1.4, 6.0, 6);
  safe.add(flag);
  const cv = makeCanvas(512, 128);
  const cg = cv.getContext('2d');
  cg.fillStyle = '#11803f';
  cg.fillRect(0, 0, 512, 128);
  cg.fillStyle = '#fff';
  cg.font = 'bold 64px sans-serif';
  cg.textAlign = 'center';
  cg.textBaseline = 'middle';
  cg.fillText('REFUGIO  +', 256, 68);
  const signB = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: texFromCanvas(cv), toneMapped: false }));
  signB.position.set(0, 3.4, 8.2);
  safe.add(signB);
  const signP = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.2, 0.2), new THREE.MeshStandardMaterial({ color: 0x223322 }));
  signP.position.set(0, 3.4, 8.08);
  safe.add(signP);
  // baliza
  const beaconMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec2 vUv; uniform float uTime; void main(){ float a = pow(1.0-vUv.y,1.6)*0.5*(0.75+0.25*sin(uTime*2.0+vUv.y*10.0)); gl_FragColor=vec4(vec3(0.2,1.0,0.6)*2.0,a); }`,
  });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 55, 24, 1, true), beaconMat);
  beacon.position.set(0, 27.5, 0);
  safe.add(beacon);
  const ring = new THREE.Mesh(new THREE.RingGeometry(7.4, 8, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x30ff90).multiplyScalar(1.6), transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  safe.add(ring);
  const safeLight = new THREE.PointLight(0x40ffa0, 4, 30, 1.6);
  safeLight.position.set(0, 3, 0);
  safe.add(safeLight);

  return {
    batch, solids, buildings, roofs, porches, signs, blockInfo, carSlots, kiosks, landings,
    parkBlocks, plazaBlocks, facade, addSolid, addBox, M4, unitBox, unitCyl, unitCone, unitIco, G,
    safeObj: { group: safe, rotor, tailRotor, flag, ring, beaconMat, safeLight },
  };
}

/* ------------------------------------------------------------------ */
/*  Mapa de alturas para el shader del agua                            */
/* ------------------------------------------------------------------ */
export function bakeHeightMap(buildings) {
  const { x0, z0, size, n } = CFG.MAP;
  const cell = size / n;
  const H = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) H[j * n + i] = terrainH(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell);
  }
  for (const b of buildings) {
    const i0 = Math.floor((b.x - b.w / 2 - 0.3 - x0) / cell), i1 = Math.ceil((b.x + b.w / 2 + 0.3 - x0) / cell);
    const j0 = Math.floor((b.z - b.d / 2 - 0.3 - z0) / cell), j1 = Math.ceil((b.z + b.d / 2 + 0.3 - z0) / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (i >= 0 && j >= 0 && i < n && j < n) H[j * n + i] = Math.max(H[j * n + i], b.roofY);
  }
  const half = new Uint16Array(n * n);
  for (let k = 0; k < n * n; k++) half[k] = THREE.DataUtils.toHalfFloat(H[k]);
  const tex = new THREE.DataTexture(half, n, n, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { tex, data: H };
}

/* ------------------------------------------------------------------ */
/*  Malla de terreno                                                    */
/* ------------------------------------------------------------------ */
export function buildTerrain(scene, groundTex) {
  const seg = 256;
  const geo = new THREE.PlaneGeometry(256, 256, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainH(x, z);
    pos.setY(i, h);
    const rock = smoothstep(5, 15, h) * 0.7;
    const cheb = Math.max(Math.abs(x), Math.abs(z));
    const outside = smoothstep(66, 80, cheb);
    const tint = lerp(1, 0.92, outside);
    col[i * 3] = lerp(tint, 0.66, rock);
    col[i * 3 + 1] = lerp(tint, 0.62, rock);
    col[i * 3 + 2] = lerp(tint, 0.56, rock);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: groundTex, vertexColors: true, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
