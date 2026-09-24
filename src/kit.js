import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng, makeCanvas, texFromCanvas, smoothstep, clamp, fbm, lerp, TAU } from './utils.js';
import { CFG, terrainH } from './terrain.js';
import { M4 } from './city.js';

export { M4 };

/* ------------------------------------------------------------------ */
/*  Lote de geometrías fusionadas                                      */
/* ------------------------------------------------------------------ */
export class Batch {
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
const unitPrism = (() => {
  // prisma triangular para tejados a dos aguas (x: -0.5..0.5, base y=0, cumbrera y=1 a lo largo de z)
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0);
  s.lineTo(0.5, 0);
  s.lineTo(0, 1);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
})();

/* ------------------------------------------------------------------ */
/*  Geometrías de árboles y plantas (instanciadas)                     */
/* ------------------------------------------------------------------ */
function colored(parts) {
  const geos = parts.map(([geo, matrix, color]) => {
    let g = geo.clone();
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(matrix);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (g.attributes.uv) g.deleteAttribute('uv');
    return g;
  });
  return mergeGeometries(geos, false);
}
const TREE_GEO = {};
function treeGeo(kind) {
  if (TREE_GEO[kind]) return TREE_GEO[kind];
  let g;
  if (kind === 'pine' || kind === 'snowpine') {
    const snow = kind === 'snowpine';
    g = colored([
      [unitCyl, M4(0, -0.1, 0, 0.3, 3.4, 0.3), 0x4a3524],
      [unitCone, M4(0, 1.6, 0, 2.5, 2.6, 2.5), snow ? 0x9fb0a4 : 0x2f5a30],
      [unitCone, M4(0, 3.5, 0, 2.0, 2.3, 2.0), snow ? 0xe6eef3 : 0x386a36],
      [unitCone, M4(0, 5.2, 0, 1.4, 2.0, 1.4), snow ? 0xf2f6fa : 0x3f7a3c],
      [unitCone, M4(0, 6.6, 0, 0.9, 1.6, 0.9), snow ? 0xffffff : 0x4a8a44],
    ]);
  } else if (kind === 'broad') {
    g = colored([
      [unitCyl, M4(0, -0.1, 0, 0.3, 3.2, 0.3), 0x5a3f2a],
      [unitIco, M4(0, 4.4, 0, 2.0, 1.8, 2.0), 0x4a8a3a],
      [unitIco, M4(0.9, 3.6, 0.5, 1.4, 1.2, 1.4), 0x3f7d3a],
      [unitIco, M4(-0.8, 5.2, -0.3, 1.3, 1.1, 1.3), 0x58a044],
    ]);
  } else if (kind === 'palm') {
    const parts = [];
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      parts.push([unitCyl, M4(Math.sin(t * 1.1) * 0.9 * t, i * 1.1, 0, 0.26 - t * 0.08, 1.2, 0.26 - t * 0.08, 0, 0, -0.16 * t), 0x9a7a4a]);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      parts.push([unitCone, M4(Math.sin(1.1) * 0.9 + Math.cos(a) * 1.5, 6.3 - 0.35, Math.sin(a) * 1.5, 0.32, 3.4, 0.32, 0, Math.sin(a) * 1.25, -Math.cos(a) * 1.25), k % 2 ? 0x3a8a3a : 0x4a9a44]);
    }
    parts.push([unitIco, M4(Math.sin(1.1) * 0.9, 6.0, 0, 0.32, 0.32, 0.32), 0x5a3a20]);
    g = colored(parts);
  } else if (kind === 'dead') {
    g = colored([
      [unitCyl, M4(0, -0.1, 0, 0.26, 4.4, 0.26), 0x6a5a4a],
      [unitCyl, M4(0.5, 2.6, 0, 0.11, 2.0, 0.11, 0, 0, -0.9), 0x6a5a4a],
      [unitCyl, M4(-0.4, 3.2, 0.2, 0.1, 1.7, 0.1, 0, 0, 0.9), 0x6a5a4a],
      [unitCyl, M4(0.1, 3.9, -0.4, 0.09, 1.4, 0.09, 0.6, 0.8, 0), 0x5a4a3a],
    ]);
  } else if (kind === 'cactus') {
    g = colored([
      [unitCyl, M4(0, -0.05, 0, 0.42, 3.6, 0.42), 0x3f8a4a],
      [unitIco, M4(0, 3.55, 0, 0.42, 0.42, 0.42), 0x3f8a4a],
      [unitCyl, M4(0.8, 1.3, 0, 0.26, 1.7, 0.26), 0x4a9a52],
      [unitCyl, M4(0.42, 1.2, 0, 0.3, 0.3, 0.26, 0, 0, Math.PI / 2), 0x4a9a52],
      [unitCyl, M4(-0.8, 1.9, 0, 0.26, 1.3, 0.26), 0x4a9a52],
      [unitCyl, M4(-0.42, 1.8, 0, 0.3, 0.3, 0.26, 0, 0, Math.PI / 2), 0x4a9a52],
    ]);
  } else {
    g = colored([[unitIco, M4(0, 0.6, 0, 0.9, 0.7, 0.9), 0x5a7a3a], [unitIco, M4(0.5, 0.4, 0.3, 0.6, 0.5, 0.6), 0x6a8a44]]);
  }
  TREE_GEO[kind] = g;
  return g;
}
const TREE_COLLIDER = { pine: [0.4, 8], snowpine: [0.4, 8], broad: [0.4, 7], palm: [0.35, 7], dead: [0.3, 5], cactus: [0.5, 3.6], shrub: [0.6, 1.2] };

/* ------------------------------------------------------------------ */
/*  Texturas de fachada (edificios de ciudad)                          */
/* ------------------------------------------------------------------ */
export function makeFacadeTextures(scale = 1) {
  const S = Math.round(512 * scale);
  const c = makeCanvas(S), e = makeCanvas(S);
  const g = c.getContext('2d'), ge = e.getContext('2d');
  const r = makeRng(77);
  const k = S / 512;
  g.fillStyle = '#e4dfd4';
  g.fillRect(0, 0, S, S);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, S, S);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x = (16 + col * 128) * k, y = (18 + row * 128) * k, w = 96 * k, h = 84 * k;
      g.fillStyle = 'rgba(70,60,50,.55)';
      g.fillRect(x - 6 * k, y - 6 * k, w + 12 * k, h + 12 * k);
      const lit = r.chance(0.34);
      const grd = g.createLinearGradient(x, y, x + w, y + h);
      if (lit) { grd.addColorStop(0, '#ffe0a0'); grd.addColorStop(1, '#f2b466'); }
      else { grd.addColorStop(0, '#41566b'); grd.addColorStop(0.5, '#1f2c3a'); grd.addColorStop(1, '#2c3d4f'); }
      g.fillStyle = grd;
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(40,35,30,.8)';
      g.fillRect(x + w / 2 - 2 * k, y, 4 * k, h);
      g.fillRect(x, y + h * 0.55, w, 3 * k);
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.fillRect(x - 8 * k, y + h + 6 * k, w + 16 * k, 6 * k);
      if (lit) {
        ge.fillStyle = '#ffb056';
        ge.fillRect(x, y, w, h);
        ge.fillStyle = '#000';
        ge.fillRect(x + w / 2 - 2 * k, y, 4 * k, h);
      }
    }
  }
  return { map: texFromCanvas(c, { repeat: true, aniso: 4 }), em: texFromCanvas(e, { repeat: true, aniso: 4 }) };
}

/* ------------------------------------------------------------------ */
/*  Kit de construcción                                                */
/* ------------------------------------------------------------------ */
export function createKit({ scene, seed = 1, mobile = false } = {}) {
  const rng = makeRng(seed);
  const batch = new Batch();
  const solids = [], buildings = [], cands = [], sites = [], signs = [];
  const treeList = {};
  const density = mobile ? 0.55 : 1;
  const K = { rng, batch, solids, buildings, cands, sites, signs, density, mobile, extra: {} };

  const solid = (x0, x1, y0, y1, z0, z1, tag = 'static') => {
    const s = { x0, x1, y0, y1, z0, z1, tag, dyn: false, dx: 0, dy: 0, dz: 0, _q: 0 };
    solids.push(s);
    return s;
  };
  K.solid = solid;

  K.box = (cx, y0, cz, w, h, d, color, { key = 'flat', solid: sol = true, tag = 'static', ry = 0 } = {}) => {
    batch.add(unitBox, key, M4(cx, y0, cz, w, h, d, ry), color);
    if (!sol) return null;
    if (ry) {
      const e = Math.abs(Math.cos(ry)) * w / 2 + Math.abs(Math.sin(ry)) * d / 2;
      const f = Math.abs(Math.sin(ry)) * w / 2 + Math.abs(Math.cos(ry)) * d / 2;
      return solid(cx - e, cx + e, y0 - 0.5, y0 + h, cz - f, cz + f, tag);
    }
    return solid(cx - w / 2, cx + w / 2, y0 - 0.5, y0 + h, cz - d / 2, cz + d / 2, tag);
  };
  K.cyl = (cx, y0, cz, r, h, color, { key = 'flat', solid: sol = false, tag = 'static' } = {}) => {
    batch.add(unitCyl, key, M4(cx, y0, cz, r, h, r), color);
    return sol ? solid(cx - r, cx + r, y0 - 0.5, y0 + h, cz - r, cz + r, tag) : null;
  };
  K.cone = (cx, y0, cz, r, h, color, { key = 'flat' } = {}) => batch.add(unitCone, key, M4(cx, y0, cz, r, h, r), color);
  K.ico = (cx, cy, cz, sx, sy, sz, color, { key = 'flat', ry = 0 } = {}) => batch.add(unitIco, key, M4(cx, cy, cz, sx, sy, sz, ry), color);
  K.prism = (cx, y0, cz, w, h, d, color, ry = 0) => batch.add(unitPrism, 'flat', M4(cx, y0, cz, w, h, d, ry), color);

  K.rock = (x, z, s = 1, color = 0x7a746a, { solidBox = true } = {}) => {
    const y = terrainH(x, z);
    const sx = s * rng.range(0.8, 1.3), sy = s * rng.range(0.6, 1.1), sz = s * rng.range(0.8, 1.3);
    batch.add(unitIco, 'flat', M4(x, y + sy * 0.3, z, sx, sy, sz, rng.range(0, 3)), color);
    if (solidBox && s > 1.1) solid(x - sx * 0.8, x + sx * 0.8, y - 1, y + sy * 1.0, z - sz * 0.8, z + sz * 0.8, 'rock');
  };

  K.tree = (kind, x, z, s = 1) => {
    if (!treeList[kind]) treeList[kind] = [];
    const y = terrainH(x, z);
    treeList[kind].push({ x, y: y - 0.1, z, s, ry: rng.range(0, TAU), tint: rng.range(0.85, 1.12) });
    const [r, h] = TREE_COLLIDER[kind] || [0.4, 6];
    if (kind !== 'shrub') solid(x - r * s, x + r * s, y - 1, y + h * s, z - r * s, z + r * s, 'tree');
  };
  K.treeCount = () => Object.values(treeList).reduce((a, l) => a + l.length, 0);

  // Construye InstancedMesh para los árboles registrados
  K.buildTrees = (sceneRef, material) => {
    const meshes = [];
    const m4 = new THREE.Matrix4();
    for (const kind in treeList) {
      const list = treeList[kind];
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(treeGeo(kind), material, list.length);
      const col = new THREE.Color();
      list.forEach((t, i) => {
        m4.compose(new THREE.Vector3(t.x, t.y, t.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.ry, 0)), new THREE.Vector3(t.s, t.s * (kind === 'shrub' ? 1 : 1), t.s));
        mesh.setMatrixAt(i, m4);
        col.setRGB(t.tint, t.tint, t.tint);
        mesh.setColorAt(i, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = !mobile;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      sceneRef.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  };

  K.cand = (type, x, y, z, extra = {}) => {
    cands.push({ type, x, y, z, ...extra });
  };
  K.site = (kind, x, z, ry = 0, extra = {}) => sites.push({ kind, x, z, ry, ...extra });

  K.sign = (x, z, tip) => signs.push({ x, z, ry: 0, tip, y: terrainH(x, z), used: false });

  /* ---------- edificios sencillos (casas, cabañas, adobe...) ---------- */
  K.house = ({ x, z, w = 8, d = 7, h = 3.4, color = 0xd8c8a8, roofColor = 0x8a4a2a, roof = 'gable', facing = 0, base = null, window = 0x2a3038, door = 0x4a2f1c, chimney = false, cand: zone = 'casa', roofCand = true } = {}) => {
    const g0 = base ?? Math.max(terrainH(x, z), terrainH(x - w / 2, z - d / 2), terrainH(x + w / 2, z + d / 2), terrainH(x - w / 2, z + d / 2), terrainH(x + w / 2, z - d / 2));
    K.box(x, g0 - 2, z, w, h + 2, d, color, { tag: 'building' });
    // puerta y ventanas en la cara frontal
    const c = Math.cos(facing), s = Math.sin(facing);
    const front = (lx, ly, lw, lh, col) => {
      const px = x + c * lx + s * (d / 2 + 0.03), pz = z - s * lx + c * (d / 2 + 0.03);
      K.batch.add(unitBox, 'flat', M4(px, g0 + ly, pz, lw * Math.abs(c) + 0.06 * Math.abs(s), lh, lw * Math.abs(s) + 0.06 * Math.abs(c), 0), col);
    };
    front(0, 0, 1.1, 2.1, door);
    front(-w * 0.3, 1.1, 1.0, 1.0, window);
    front(w * 0.3, 1.1, 1.0, 1.0, window);
    const roofY = g0 + h;
    let topY = roofY;
    if (roof === 'gable') {
      const rh = Math.min(w, d) * 0.42;
      const along = w >= d;
      if (along) K.prism(x, roofY, z, d + 1.0, rh, w + 1.0, roofColor, Math.PI / 2 + (facing === 0 ? 0 : 0));
      else K.prism(x, roofY, z, w + 1.0, rh, d + 1.0, roofColor, 0);
      topY = roofY;
    } else if (roof === 'flat') {
      K.box(x, roofY, z, w + 0.4, 0.3, d + 0.4, roofColor, { solid: false });
      K.box(x, roofY + 0.3, z - d / 2, w + 0.4, 0.5, 0.2, color, { solid: false });
      K.box(x, roofY + 0.3, z + d / 2, w + 0.4, 0.5, 0.2, color, { solid: false });
      topY = roofY + 0.3;
      if (roofCand) K.cand('roof', x + K.rng.range(-w * 0.15, w * 0.15), topY + 0.02, z + K.rng.range(-d * 0.15, d * 0.15), { zone });
    } else if (roof === 'dome') {
      K.ico(x, roofY, z, w * 0.5, h * 0.35, d * 0.5, roofColor);
    }
    if (chimney) K.box(x + w * 0.25, roofY, z - d * 0.2, 0.7, 2.2, 0.7, 0x6a5a50, { solid: false });
    const b = { x, z, w, d, h, roofY: topY, kind: zone, solid: null };
    buildings.push(b);
    return b;
  };

  /* ---------- puentes ---------- */
  K.bridge = ({ x0, z0, x1, z1, width = 7, deckY = 0.45, color = 0x8a7a66, rail = 0x5a5048, piers = true, name = 'puente' } = {}) => {
    const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    const w = alongX ? len : width, d = alongX ? width : len;
    K.box(cx, deckY - 0.32, cz, w, 0.32, d, color, { tag: 'bridge' });
    const rw = alongX ? len : 0.25, rd = alongX ? 0.25 : len;
    for (const s of [-1, 1]) {
      const rx = alongX ? cx : cx + s * (width / 2 - 0.12), rz = alongX ? cz + s * (width / 2 - 0.12) : cz;
      K.box(rx, deckY, rz, rw, 1.0, rd, rail, { tag: 'rail' });
    }
    if (piers) {
      const n = Math.max(2, Math.floor(len / 9));
      for (let i = 0; i <= n; i++) {
        const t = -len / 2 + (len * i) / n;
        const px = alongX ? cx + t : cx, pz = alongX ? cz : cz + t;
        K.cyl(px, -4, pz, 0.6, 4 + deckY - 0.3, 0x6a6660);
      }
    }
    for (let k = -2; k <= 2; k += 2) {
      const t = k * (len / 6);
      K.cand('bridge', alongX ? cx + t : cx + rng.range(-1.5, 1.5), deckY + 0.02, alongX ? cz + rng.range(-1.5, 1.5) : cz + t, { zone: name });
    }
  };

  K.fence = (x0, z0, x1, z1, h = 1.1, color = 0x8a6a48, sol = true) => {
    const n = Math.max(1, Math.floor(Math.hypot(x1 - x0, z1 - z0) / 2.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = lerp(x0, x1, t), pz = lerp(z0, z1, t);
      K.cyl(px, terrainH(px, pz) - 0.1, pz, 0.08, h, color);
    }
    const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0);
    const gy = terrainH((x0 + x1) / 2, (z0 + z1) / 2);
    K.batch.add(unitBox, 'flat', M4((x0 + x1) / 2, gy + h * 0.6, (z0 + z1) / 2, len, 0.08, 0.08, -ang), color);
    K.batch.add(unitBox, 'flat', M4((x0 + x1) / 2, gy + h * 0.25, (z0 + z1) / 2, len, 0.08, 0.08, -ang), color);
    if (sol) {
      const mx = Math.abs(Math.cos(ang)) * len / 2 + 0.1, mz = Math.abs(Math.sin(ang)) * len / 2 + 0.1;
      solid((x0 + x1) / 2 - mx, (x0 + x1) / 2 + mx, gy - 1, gy + h, (z0 + z1) / 2 - mz, (z0 + z1) / 2 + mz, 'fence');
    }
  };

  K.scatter = (n, { x0 = -110, x1 = 110, z0 = -110, z1 = 110 } = {}, { minDist = 4, accept = () => true, tries = 40 } = {}) => {
    const pts = [];
    const N = Math.round(n * density);
    for (let i = 0; i < N; i++) {
      for (let t = 0; t < tries; t++) {
        const x = rng.range(x0, x1), z = rng.range(z0, z1);
        if (!accept(x, z, terrainH(x, z))) continue;
        if (pts.some((p) => Math.hypot(p.x - x, p.z - z) < minDist)) continue;
        pts.push({ x, z });
        break;
      }
    }
    return pts;
  };

  /* ---------- pintura del terreno ---------- */
  K.paintGround = ({ colorAt, draw, size = mobile ? 1024 : 2048 }) => {
    const N = 256;
    const nc = makeCanvas(N);
    const ng = nc.getContext('2d');
    const id = ng.createImageData(N, N);
    const half = 128;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = -half + i + 0.5, z = -half + j + 0.5;
        const h = terrainH(x, z);
        const sl = Math.hypot(terrainH(x + 1, z) - terrainH(x - 1, z), terrainH(x, z + 1) - terrainH(x, z - 1)) * 0.5;
        const [r, g, b] = colorAt(x, z, h, sl);
        const n1 = fbm(i * 0.31 + 20, j * 0.31, 2) - 0.5;
        const k = (j * N + i) * 4;
        id.data[k] = clamp(r + n1 * 26, 0, 255);
        id.data[k + 1] = clamp(g + n1 * 26, 0, 255);
        id.data[k + 2] = clamp(b + n1 * 22, 0, 255);
        id.data[k + 3] = 255;
      }
    }
    ng.putImageData(id, 0, 0);
    const c = makeCanvas(size);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.drawImage(nc, 0, 0, size, size);
    const px = (v) => ((v + 128) / 256) * size;
    const sz = (v) => (v / 256) * size;
    // grano fino
    const r = makeRng(9);
    for (let i = 0; i < 7000; i++) {
      g.fillStyle = `rgba(${r.chance(0.5) ? '255,255,255' : '0,0,0'},${r.range(0.02, 0.06)})`;
      g.fillRect(r.range(0, size), r.range(0, size), r.range(1.5, 6), r.range(1.5, 6));
    }
    if (draw) draw(g, px, sz);
    return { tex: texFromCanvas(c, { aniso: 4 }), canvas: c };
  };

  return K;
}

export { unitBox, unitCyl, unitCone, unitIco };
