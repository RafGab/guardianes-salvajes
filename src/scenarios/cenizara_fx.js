import * as THREE from 'three';
import { Batch } from '../kit.js';
import { makeRng } from '../utils.js';
import { terrainH } from '../terrain.js';
import { propInstances } from '../props.js';

/* ======================================================================
   CENIZARA · MODELOS 3D DEL ESCENARIO DEVASTADO (construidos con geometría, sin imágenes planas)
   · Casas quemadas (cuatro estados: en llamas, calcinada, cabaña de madera hundida y ruina)
   · Gasolineras abandonadas, bocas de riego, cabinas telefónicas, contenedores y cubos de basura
   · Árboles quemados variados (secos, en brasas, caídos, partidos y tocones) y restos de ramas
   · Grupos de cristales de magma (instanciados) con base de roca, resplandor y grietas
   · La cueva volcánica del jefe (rocas negras brillantes con magma entre ellas y portal de calor)
   · El volcán: columnas de basalto en las laderas, corona de rocas en el cráter y tres agujas
   · Erupción (runtime): fuente de lava, bombas incandescentes, columna de humo y resplandor
   Todo usa su propio generador aleatorio: el resto del mapa no cambia.
   ====================================================================== */
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

/* ---------- geometrías unidad (centradas) ---------- */
const gBox = new THREE.BoxGeometry(1, 1, 1);
const gCyl = new THREE.CylinderGeometry(1, 1, 1, 10);
const gTrunk = new THREE.CylinderGeometry(0.62, 1, 1, 7);
const gCone = new THREE.ConeGeometry(1, 1, 6);
const gIco = new THREE.IcosahedronGeometry(1, 0);
const gTorus = new THREE.TorusGeometry(1, 0.38, 6, 12);
// prisma de tejado: sección triangular en el plano y-z (base y=0, cumbrera y=1), a lo largo de x
const gPrism = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.rotateY(Math.PI / 2);
  return g;
})();
const hash3 = (x, y, z, s) => { const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + s * 4.137) * 43758.5453; return v - Math.floor(v); };
// roca irregular (icosaedro deformado; los vértices compartidos se mueven igual)
function lumpy(seed, detail = 1, amt = 0.24) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + (hash3(Math.round(v.x * 997), Math.round(v.y * 997), Math.round(v.z * 997), seed) - 0.5) * 2 * amt;
    v.multiplyScalar(k); v.y *= 0.92;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
// columna de basalto: prisma hexagonal ahusado con las caras algo irregulares
function pillarGeo(seed) {
  const g = new THREE.CylinderGeometry(0.72, 1, 1, 6, 3), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + (hash3(Math.round(v.x * 997), Math.round(v.y * 997), Math.round(v.z * 997), seed) - 0.5) * 0.28;
    p.setXYZ(i, v.x * k, v.y, v.z * k);
  }
  g.computeVertexNormals();
  return g;
}
const ROCKS = [1, 2, 3, 4, 5].map((s) => lumpy(s));
// bloque de roca volcánica de la referencia: alto y redondeado, con caras planas grandes (facetas)
function lavaRockGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, v = new THREE.Vector3();
  const cuts = Array.from({ length: 9 }, (_, i) => { const a = hash3(i, seed, 1, 3) * TAU, b = Math.acos(hash3(i, seed, 2, 7) * 1.6 - 0.8); return [new THREE.Vector3(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)), 0.78 + hash3(i, seed, 3, 5) * 0.14]; });
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + (hash3(Math.round(v.x * 997), Math.round(v.y * 997), Math.round(v.z * 997), seed) - 0.5) * 0.16;
    v.multiplyScalar(k);
    for (const [n, d] of cuts) { const h = v.dot(n); if (h > d) v.addScaledVector(n, d - h); } // planos que tallan las facetas
    if (v.y < -0.75) v.y = -0.75 + (v.y + 0.75) * 0.3; // base algo plana para asentarse en el suelo
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
const LAVA_ROCKS = [21, 22, 23, 24, 25, 26].map((s) => lavaRockGeo(s));
const LAVA_TONES = [0x262a31, 0x2e323a, 0x1f2228, 0x34363c];
// material de la roca volcánica: negro azulado, satinado, con grietas de magma que brillan (Voronoi 3D)
function lavaRockMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.18, flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uT = FXT;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      varying vec3 vRP;`).replace('#include <begin_vertex>', `#include <begin_vertex>
      vRP = (modelMatrix * vec4(position, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vRP; uniform float uT;
      vec3 h33(vec3 p){ p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6))); return fract(sin(p) * 43758.5453); }
      float vEdge(vec3 x){ vec3 p = floor(x), f = fract(x); float d1 = 8.0, d2 = 8.0;
        for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec3 b = vec3(float(i), float(j), float(k)); vec3 r = b - f + h33(p + b); float d = dot(r, r); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
        return sqrt(d2) - sqrt(d1); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 q = vRP * 0.62; q += (h33(floor(vRP * 2.3)) - 0.5) * 0.06 + sin(vRP.yzx * 2.1) * 0.09; // grietas irregulares
        float e1 = vEdge(q), e2 = vEdge(q * 2.2 + 7.3);
        float c1 = 1.0 - smoothstep(0.02, 0.085, e1);
        float c2 = (1.0 - smoothstep(0.015, 0.04, e2)) * smoothstep(0.35, 0.05, e1) * 0.8; // ramitas que salen de las grandes
        float crack = max(c1, c2);
        float core = 1.0 - smoothstep(0.0, 0.03, e1);
        float halo = (1.0 - smoothstep(0.0, 0.22, e1)) * 0.22;      // el calor tiñe un poco la roca junto a la grieta
        float pulse = 0.85 + 0.15 * sin(uT * 1.7 + vRP.x * 0.7 + vRP.z * 0.5);
        diffuseColor.rgb *= 1.0 - crack * 0.7;
        totalEmissiveRadiance += (mix(vec3(0.95, 0.22, 0.0), vec3(1.0, 0.62, 0.08), core) * crack * 1.55 + vec3(0.5, 0.08, 0.0) * halo) * pulse;
      }`);
  };
  m.customProgramCacheKey = () => 'lava-rock';
  return m;
}
const CRAGS = [11, 12, 13, 14, 15].map((s) => lumpy(s, 1, 0.42));
const PILLARS = [1, 2, 3].map((s) => pillarGeo(s));

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, ord = 'YXZ') => new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, ord)), _s.set(sx, sy, sz));
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k);

// Marco local (posición + giro, con inclinación opcional) para construir objetos por piezas
function mkFrame(add, base) {
  const F = {
    base,
    pt: (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyMatrix4(base),
    put: (geo, lx, ly, lz, sx, sy, sz, col, o = {}) => add(geo, o.key || 'flat', base.clone().multiply(M(lx, ly, lz, o.rx || 0, o.ry || 0, o.rz || 0, sx, sy, sz, o.ord)), col),
    box: (lx, ly, lz, sx, sy, sz, col, o) => F.put(gBox, lx, ly, lz, sx, sy, sz, col, o),
    cyl: (lx, ly, lz, r, h, col, o) => F.put(gCyl, lx, ly, lz, r, h, r, col, o),
    // cilindro (ahusado) entre dos puntos locales: radio r en a, más fino en b
    seg: (a, b, r, col, geo = gTrunk, key = 'flat') => {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
      if (L < 1e-4) return;
      const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
      add(geo, key, base.clone().multiply(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(r, L, r))), col);
    },
    sub: (lx, ly, lz, ry = 0, rx = 0, rz = 0) => mkFrame(add, base.clone().multiply(M(lx, ly, lz, rx, ry, rz))),
  };
  return F;
}

/* ---------- paleta ---------- */
const PAL = { trim: 0xe2dccf, soot: 0x2a2421, char: 0x1d1715, stone: 0x6c6965, brick: 0x6a3a2e, wood: 0x7a5a3a, woodD: 0x4a3424, glass: 0x1a2027, fire: 0xff7426, fireY: 0xffae46, ash: 0x8c8680, ember: 0xff5a14, metal: 0x5a5e62, black: 0x161414 };
const SIDING = [0xd8d2c6, 0xcbbca2, 0xa9b2b7, 0xd2c4ae, 0xb7a793];
const ROOFS = [0x3b3c41, 0x4a4f56, 0x55403a, 0x333538];
// letras de 3×5 para los rótulos
const FONT = { G: ['###', '#..', '#.#', '#.#', '###'], A: ['.#.', '#.#', '###', '#.#', '#.#'], S: ['###', '#..', '###', '..#', '###'], O: ['###', '#.#', '#.#', '#.#', '###'], L: ['#..', '#..', '#..', '#..', '###'], N: ['#.#', '###', '###', '#.#', '#.#'], E: ['###', '#..', '##.', '#..', '###'], I: ['###', '.#.', '.#.', '.#.', '###'], T: ['###', '.#.', '.#.', '.#.', '.#.'], F: ['###', '#..', '##.', '#..', '#..'], R: ['##.', '#.#', '##.', '#.#', '#.#'], P: ['##.', '#.#', '##.', '#..', '#..'] };
function text(F, str, cx, cy, lz, px, col, o = {}) {
  const wch = 4 * px, x0 = cx - (str.length * wch - px) / 2;
  [...str].forEach((ch, i) => {
    const gl = FONT[ch]; if (!gl) return;
    gl.forEach((row, r) => [...row].forEach((c, k) => { if (c === '#') F.box(x0 + i * wch + k * px + px / 2, cy + (2 - r) * px, lz, px * 0.96, px * 0.96, 0.03, col, o); }));
  });
}

/* ======================================================================
   CREADOR: recibe el contexto de cenizara.js y devuelve los constructores
   ====================================================================== */
export function createCenizaraFX(C) {
  const { K, scene, extra } = C;
  const G = (x, z) => terrainH(x, z);
  const R = makeRng(C.seed || 7331);
  const R2 = makeRng((C.seed || 7331) + 77); // rocas volcánicas y arco de los orcos (no mueven lo demás)
  const add = (geo, key, m, col) => K.batch.add(geo, key, m, col);
  // lote propio de rocas brillantes (cueva y volcán) y su resplandor
  const rockBatch = new Batch();
  const radd = (geo, key, m, col) => rockBatch.add(geo, key, m, col);
  const W = (x, y, z, ry = 0, rx = 0, rz = 0) => mkFrame(add, M(x, y, z, rx, ry, rz));
  const WR = (x, y, z, ry = 0, rx = 0, rz = 0) => mkFrame(radd, M(x, y, z, rx, ry, rz));
  const lists = { seco: [], fuego: [], crys: [], rocas: [] };
  const deferred = [];        // árboles: se construyen al final (si nada los ha tapado)
  const clears = [];          // huellas de los objetos nuevos (para no dejar candidatos dentro)
  const flame = (p, s) => extra.flames.push([p.x, p.y, p.z, s]);
  const smoke = (p, col = 0x2a2420) => extra.fumaroles.push([p.x, p.y, p.z, col]);
  const light = (p, col, i, d) => extra.lights.push([p.x, p.y, p.z, col, i, d]);
  // sólido alineado con los ejes que envuelve un rectángulo local del marco
  const solidRect = (F, x0, x1, z0, z1, y0, y1, tag = 'static') => {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity, e = Infinity, f = -Infinity;
    for (const lx of [x0, x1]) for (const lz of [z0, z1]) for (const ly of [y0, y1]) { const p = F.pt(lx, ly, lz); a = Math.min(a, p.x); b = Math.max(b, p.x); c = Math.min(c, p.z); d = Math.max(d, p.z); e = Math.min(e, p.y); f = Math.max(f, p.y); }
    clears.push({ x0: a, x1: b, z0: c, z1: d });
    return K.solid(a, b, e, f, c, d, tag);
  };
  const clearRect = (F, x0, x1, z0, z1) => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const lx of [x0, x1]) for (const lz of [z0, z1]) { const p = F.pt(lx, 0, lz); a = Math.min(a, p.x); b = Math.max(b, p.x); c = Math.min(c, p.z); d = Math.max(d, p.z); } clears.push({ x0: a, x1: b, z0: c, z1: d }); };

  /* ---------------- detalles comunes ---------------- */
  const planks = (F, n, rx0, rx1, rz0, rz1, cols = [PAL.wood, PAL.woodD, PAL.char]) => {
    for (let i = 0; i < n; i++) F.box(R.range(rx0, rx1), 0.05 + R.range(0, 0.12), R.range(rz0, rz1), R.range(1.0, 2.6), 0.07, R.range(0.14, 0.26), R.pick(cols), { ry: R.range(0, 3.2), rz: R.range(-0.12, 0.12), rx: R.range(-0.1, 0.1) });
  };
  const rubble = (F, n, cx, cz, s, cols = [0x5a524c, 0x4a4442, 0x6e6864, 0x3a3230]) => {
    for (let i = 0; i < n; i++) F.put(gIco, cx + R.range(-1.4, 1.4) * s, R.range(0.05, 0.3) * s, cz + R.range(-1.4, 1.4) * s, R.range(0.25, 0.6) * s, R.range(0.15, 0.4) * s, R.range(0.25, 0.6) * s, R.pick(cols), { ry: R.range(0, 3) });
  };
  const ashPile = (F, lx, lz, s) => F.put(gIco, lx, 0.08, lz, 1.4 * s, 0.35 * s, 1.1 * s, R.chance(0.5) ? 0x9a948e : 0x6e6864, { ry: R.range(0, 3) });
  const embers = (F, n, cx, cz, rad, y = 0.06) => { for (let i = 0; i < n; i++) F.put(gIco, cx + R.range(-rad, rad), y, cz + R.range(-rad, rad), R.range(0.08, 0.2), 0.05, R.range(0.08, 0.2), R.chance(0.5) ? PAL.ember : PAL.fireY, { key: 'glow' }); };
  const siding = (F, wid, y0, y1, col) => { for (let y = y0 + 0.36; y < y1 - 0.1; y += 0.38) F.box(0, y, 0.012, wid - 0.12, 0.035, 0.03, shade(col, 0.8)); };
  // ventana con marco, alféizar, cruceta o cristales rotos; si arde, fuego dentro y hollín encima
  const windowAt = (F, lx, ly, ww, wh, fire, broken) => {
    F.box(lx, ly, -0.02, ww, wh, 0.08, fire ? (R.chance(0.5) ? PAL.fire : PAL.fireY) : PAL.glass, { key: fire ? 'glow' : 'flat' });
    F.box(lx, ly + wh / 2 + 0.07, 0.04, ww + 0.26, 0.14, 0.1, PAL.trim);
    F.box(lx, ly - wh / 2 - 0.07, 0.07, ww + 0.36, 0.12, 0.18, PAL.trim);
    for (const s of [-1, 1]) F.box(lx + s * (ww / 2 + 0.07), ly, 0.04, 0.12, wh, 0.1, PAL.trim);
    if (!broken) { F.box(lx, ly, 0.03, 0.05, wh, 0.05, PAL.trim); F.box(lx, ly + wh * 0.12, 0.03, ww, 0.05, 0.05, PAL.trim); }
    else for (let i = 0; i < 3; i++) F.box(lx + R.range(-0.35, 0.35) * ww, ly + R.range(-0.35, 0.35) * wh, 0.03, R.range(0.12, 0.3), R.range(0.2, 0.4), 0.02, 0x6a7680, { rz: R.range(-0.8, 0.8) });
    if (fire) { F.box(lx, ly + wh / 2 + 0.8, 0.012, ww * 0.95, 1.1, 0.02, PAL.soot); if (R.chance(0.6)) flame(F.pt(lx, ly + wh * 0.2, 0.35), R.range(0.55, 0.9)); }
    else if (R.chance(0.4)) for (const s of [-1, 1]) F.box(lx + s * (ww / 2 + 0.36), ly, 0.05, 0.42, wh + 0.1, 0.06, R.pick([0x2a2e30, 0x3a2a24, 0x46504a]), { rz: s < 0 && broken ? 0.25 : 0 });
  };

  /* ================= CASAS QUEMADAS ================= */
  // tejado a dos aguas (cumbrera a lo largo de x) con huecos quemados donde se ven las vigas
  const roofAt = (F, w, d, H, rh, col, holes) => {
    const a = Math.atan2(rh, d / 2), ov = 0.45, L = (d / 2 + ov) / Math.cos(a), nseg = 4, sw = (w + 0.8) / nseg;
    F.put(gPrism, 0, H, 0, w, rh, d, 0x2a2220);
    for (const s of [1, -1]) {
      for (let k = 0; k < nseg; k++) {
        const lx = -(w + 0.8) / 2 + sw * (k + 0.5), cy = H + (rh - ov * Math.tan(a)) / 2 + 0.09, cz = s * (d / 2 + ov) / 2;
        if (holes.has(`${s},${k}`)) {
          for (let i = 0; i < 3; i++) F.box(lx - sw / 2 + (i + 0.5) * sw / 3, cy - 0.05, cz, 0.13, 0.15, L * R.range(0.55, 1), PAL.char, { rx: s * a });
          flame(F.pt(lx, H + rh * 0.45, s * d / 4), R.range(0.9, 1.3));
          if (R.chance(0.6)) smoke(F.pt(lx, H + rh * 0.6, s * d / 4));
          continue;
        }
        F.box(lx, cy, cz, sw + 0.02, 0.16, L, col, { rx: s * a });
        for (const f of [0.28, 0.55, 0.8]) F.box(lx, H - ov * Math.tan(a) + f * (rh + ov * Math.tan(a)) + 0.19, s * (d / 2 + ov) * (1 - f), sw, 0.04, 0.05, shade(col, 0.7), { rx: s * a });
        if (R.chance(0.35)) F.box(lx + R.range(-0.4, 0.4), cy + 0.1, cz + R.range(-0.5, 0.5), R.range(0.6, 1.4), 0.02, R.range(0.6, 1.2), PAL.soot, { rx: s * a });
      }
      F.box(0, H + rh + 0.06, 0, w + 0.85, 0.12, 0.22, shade(col, 0.6));
    }
  };
  const chimney = (F, lx, lz, top) => { F.box(lx, (top - 0.2) / 2, lz, 0.7, top + 0.2, 0.7, PAL.brick); F.box(lx, top + 0.05, lz, 0.86, 0.14, 0.86, PAL.stone); };
  const porch = (F, w, d, roofCol) => {
    const pd = 1.8, pz = d / 2 + pd / 2, ez = d / 2 + pd - 0.15;
    F.box(0, 0.3, pz, w * 0.86, 0.22, pd, PAL.wood);
    for (const px of [-w * 0.41, -w * 0.14, w * 0.14, w * 0.41]) F.box(px, 0.41 + 1.2, ez, 0.16, 2.4, 0.16, PAL.trim);
    F.box(0, 2.95, pz + 0.1, w * 0.9, 0.14, pd + 0.5, roofCol, { rx: 0.2 });
    for (const [a, b] of [[-w * 0.41, -0.8], [0.8, w * 0.41]]) {
      F.box((a + b) / 2, 1.3, ez, b - a, 0.08, 0.08, PAL.trim);
      F.box((a + b) / 2, 0.55, ez, b - a, 0.06, 0.06, PAL.trim);
      for (let x = a + 0.14; x < b; x += 0.28) if (R.chance(0.88)) F.box(x, 0.92, ez, 0.05, 0.74, 0.05, R.chance(0.15) ? PAL.char : PAL.trim);
    }
    F.box(0, 0.12, d / 2 + pd + 0.3, 1.5, 0.24, 0.5, PAL.stone);
  };
  const houseBody = (F, w, d, H, col, fireP) => {
    F.box(0, -0.05, 0, w + 0.16, 1.0, d + 0.16, PAL.stone);
    F.box(0, (H + 0.45) / 2, 0, w, H - 0.45, d, col);
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) F.box(cx * w / 2, (H + 0.45) / 2, cz * d / 2, 0.18, H - 0.45, 0.18, PAL.trim);
    const walls = [[F.sub(0, 0, d / 2 + 0.001, 0), w], [F.sub(-w / 2 - 0.001, 0, 0, -Math.PI / 2), d], [F.sub(w / 2 + 0.001, 0, 0, Math.PI / 2), d], [F.sub(0, 0, -d / 2 - 0.001, Math.PI), w]];
    walls.slice(0, 3).forEach(([S, wd]) => siding(S, wd, 0.45, H, col));
    return walls;
  };
  // casa de dos plantas (o una) en llamas: tejado con un hueco quemado, porche, chimenea y fuego en las ventanas
  const houseBurning = (F, w, d) => {
    const stories = R.chance(0.6) ? 2 : 1, hs = 2.7, H = 0.45 + stories * hs, col = R.pick(SIDING), roof = R.pick(ROOFS), rh = d * 0.45;
    const walls = houseBody(F, w, d, H, col);
    if (stories > 1) F.box(0, 0.45 + hs, 0, w + 0.06, 0.14, d + 0.06, PAL.trim);
    const fireP = 0.72;
    // hollín: manchas negras en la parte alta de las fachadas y junto a las esquinas
    for (const [Sd, wd] of walls.slice(0, 3)) for (let i = 0; i < R.int(2, 4); i++) Sd.box(R.range(-0.4, 0.4) * wd, R.range(0.55, 0.9) * H, 0.022, R.range(0.9, 2.4), R.range(0.8, 1.8), 0.02, R.chance(0.6) ? PAL.soot : 0x3a302c);
    for (let s = 0; s < stories; s++) {
      const ly = 0.45 + s * hs + 1.4;
      const [Fr] = walls[0];
      const xs = s === 0 ? [-w * 0.3, w * 0.3] : [-w * 0.3, 0, w * 0.3];
      for (const lx of xs) windowAt(Fr, lx, ly, 1.0, 1.25, R.chance(fireP), R.chance(0.4));
      for (const [Sd] of [walls[1], walls[2]]) for (const lx of [-d * 0.2, d * 0.2]) if (R.chance(0.75)) windowAt(Sd, lx, ly, 0.9, 1.15, R.chance(fireP), R.chance(0.4));
    }
    // puerta (algunas arrancadas y apoyadas contra el porche)
    const [Fr] = walls[0];
    Fr.box(0, 0.45 + 1.08, 0.02, 1.25, 2.3, 0.08, PAL.trim);
    if (R.chance(0.5)) Fr.box(0, 0.45 + 1.03, 0.05, 1.0, 2.1, 0.06, PAL.fire, { key: 'glow' }), Fr.box(0.4, 0.45 + 0.95, 0.5, 0.95, 2.0, 0.07, PAL.woodD, { rz: 0.12, rx: -0.3 });
    else Fr.box(0, 0.45 + 1.03, 0.05, 1.0, 2.1, 0.07, R.pick([PAL.woodD, 0x5a2a20, 0x2a3a4a]));
    if (R.chance(0.65)) porch(F, w, d, roof);
    else F.box(0, 0.2, d / 2 + 0.4, 1.6, 0.4, 0.7, PAL.stone);
    const holes = new Set([`${R.pick([1, -1])},${R.int(0, 3)}`]);
    if (R.chance(0.4)) holes.add(`${R.pick([1, -1])},${R.int(0, 3)}`);
    roofAt(F, w, d, H, rh, roof, holes);
    chimney(F, w * 0.28, -d * 0.12, H + rh + 0.7);
    if (stories > 1 && R.chance(0.4)) { // balcón con barandilla de hierro
      const bz = d / 2 + 0.55;
      F.box(0, 0.45 + hs + 0.05, bz, 2.2, 0.12, 1.1, PAL.stone);
      F.box(0, 0.45 + hs + 1.0, bz + 0.5, 2.2, 0.06, 0.06, PAL.black);
      for (let x = -1.05; x <= 1.06; x += 0.18) F.box(x, 0.45 + hs + 0.55, bz + 0.5, 0.03, 0.9, 0.03, PAL.black);
    }
    flame(F.pt(R.range(-w, w) * 0.3, H + 0.2, d / 2 + 0.2), 1.2);
    smoke(F.pt(0, H + rh + 1, 0), 0x2a2622);
    light(F.pt(0, 2, d / 2 + 1.5), 0xff6a20, 12, 16);
    planks(F, 7, -w / 2 - 1, w / 2 + 1, d / 2 + 1, d / 2 + 3.2);
    ashPile(F, R.range(-w, w) * 0.4, -d / 2 - 1.2, 0.8);
    return H + rh;
  };
  // casa calcinada: paredes ennegrecidas, el tejado quemado (solo quedan las vigas) y fuego dentro
  const houseGutted = (F, w, d) => {
    const stories = R.chance(0.5) ? 2 : 1, hs = 2.7, H = 0.45 + stories * hs, col = R.pick(SIDING), rh = d * 0.45, t = 0.26;
    F.box(0, -0.05, 0, w + 0.16, 1.0, d + 0.16, PAL.stone);
    const wall = (S, len) => {
      const n = 4, sl = len / n;
      for (let k = 0; k < n; k++) {
        const top = H - (R.chance(0.45) ? R.range(0.3, 1.6) : 0), lx = -len / 2 + sl * (k + 0.5);
        const mid = 0.45 + (top - 0.45) * 0.55;
        S.box(lx, (0.45 + mid) / 2, -t / 2, sl + 0.01, mid - 0.45, t, col);
        S.box(lx, (mid + top) / 2, -t / 2, sl + 0.01, top - mid, t, R.chance(0.5) ? PAL.soot : 0x3a322e);
        S.box(lx, top + 0.06, -t / 2, sl * R.range(0.5, 0.9), 0.12, t + 0.04, PAL.char, { rz: R.range(-0.2, 0.2) });
      }
      siding(S, len, 0.45, 0.45 + (H - 0.45) * 0.5, col);
    };
    const walls = [[F.sub(0, 0, d / 2, 0), w], [F.sub(-w / 2, 0, 0, -Math.PI / 2), d], [F.sub(w / 2, 0, 0, Math.PI / 2), d], [F.sub(0, 0, -d / 2, Math.PI), w]];
    walls.forEach(([S, len]) => wall(S, len));
    for (let s = 0; s < stories; s++) {
      const ly = 0.45 + s * hs + 1.4;
      for (const lx of [-w * 0.3, w * 0.3]) windowAt(walls[0][0], lx, ly, 1.0, 1.25, R.chance(0.6), true);
      for (const [Sd] of [walls[1], walls[2]]) windowAt(Sd, 0, ly, 0.9, 1.15, R.chance(0.5), true);
    }
    walls[0][0].box(0, 0.45 + 1.03, 0.02, 1.1, 2.1, 0.08, PAL.fire, { key: 'glow' });
    // interior: ceniza, vigas caídas y brasas
    F.box(0, 0.48, 0, w - 0.6, 0.08, d - 0.6, PAL.ash);
    for (let i = 0; i < 4; i++) F.box(R.range(-w, w) * 0.25, 0.5 + R.range(0.4, 1.6), R.range(-d, d) * 0.2, R.range(2.5, 4.5), 0.18, 0.18, PAL.char, { ry: R.range(0, 3), rz: R.range(-0.5, 0.5) });
    embers(F, 10, 0, 0, w * 0.35, 0.55);
    // vigas del tejado (pares en A), algunas rotas; y un trozo de tejado que aún resiste
    const a = Math.atan2(rh, d / 2), L = (d / 2) / Math.cos(a);
    for (let x = -w / 2 + 0.45; x < w / 2; x += 0.85) {
      if (R.chance(0.35)) continue;
      for (const s of [1, -1]) if (R.chance(0.8)) { const f = R.range(0.55, 1); F.box(x, H + rh / 2 - (1 - f) * rh / 2, s * (d / 4) * (2 - f), 0.14, 0.16, L * f, PAL.char, { rx: s * a }); }
    }
    F.box(R.range(-1, 1), H + rh, 0, w * R.range(0.5, 0.85), 0.16, 0.16, PAL.char);
    {
      const lx = R.range(-w, w) * 0.2, sw = w * 0.4, ov = 0.4, LL = (d / 2 + ov) / Math.cos(a);
      F.box(lx, H + (rh - ov * Math.tan(a)) / 2 + 0.09, -(d / 2 + ov) / 2, sw, 0.16, LL, R.pick(ROOFS), { rx: -a });
    }
    chimney(F, -w * 0.3, -d * 0.1, H + rh + 0.4);
    for (let i = 0; i < 3; i++) flame(F.pt(R.range(-w, w) * 0.3, 0.8, R.range(-d, d) * 0.25), R.range(1.0, 1.5));
    smoke(F.pt(0, H, 0), 0x241e1c); smoke(F.pt(w * 0.25, H + 0.5, 0), 0x3a3230);
    light(F.pt(0, 2.5, 0), 0xff5a14, 14, 16);
    planks(F, 8, -w / 2 - 1.5, w / 2 + 1.5, d / 2 + 0.5, d / 2 + 3);
    rubble(F, 6, w * 0.4, d / 2 + 1.4, 0.8);
    return H;
  };
  // cabaña de madera hundida (inclinada, con el tejado caído hacia un lado y tablones por el suelo)
  const houseShack = (F0, w0, d0) => {
    const w = Math.min(w0, 7), d = 5, h = 2.7, lean = R.pick([-1, 1]) * R.range(0.07, 0.13);
    const F = F0.sub(0, 0, 0, 0, R.range(-0.04, 0.04), lean);
    const wood = [0x7a5c3e, 0x6a4e34, 0x8a6a48, 0x5a4230];
    F.box(0, h / 2 - 0.3, 0, w - 0.2, h + 0.6, d - 0.2, 0x3a2a1e);
    // tablas verticales en el frente y horizontales en los lados
    const Fr = F.sub(0, 0, d / 2, 0), Lf = F.sub(-w / 2, 0, 0, -Math.PI / 2), Rt = F.sub(w / 2, 0, 0, Math.PI / 2);
    for (let x = -w / 2 + 0.17; x < w / 2; x += 0.32) { const hh = h + 0.6 + R.range(-0.15, 0.1); if (R.chance(0.93)) Fr.box(x, hh / 2 - 0.3, 0.02, 0.3, hh, 0.06, R.pick(wood)); }
    for (const S of [Lf, Rt]) for (let y = -0.1; y < h + 0.3; y += 0.3) if (R.chance(0.9)) S.box(R.range(-0.1, 0.1), y, 0.02, d - 0.1, 0.28, 0.06, R.pick(wood), { rz: R.range(-0.03, 0.03) });
    Fr.box(-w * 0.22, 1.65, 0.05, 1.5, 1.0, 0.05, 0x0c0a0a);  // hueco de la ventana
    for (const yy of [1.1, 2.2]) Fr.box(-w * 0.22, yy, 0.07, 1.7, 0.1, 0.05, PAL.woodD, { rz: R.range(-0.25, 0.25) });
    Fr.box(w * 0.18, 1.05, 0.05, 1.0, 2.1, 0.05, 0x9a8a6a); // puerta de tablones claros
    for (const yy of [0.5, 1.6]) Fr.box(w * 0.18, yy, 0.09, 1.1, 0.12, 0.05, PAL.woodD, { rz: 0.2 });
    Fr.box(-w / 2 + 0.6, 0.9, 0.35, 0.3, 2.0, 0.05, R.pick(wood), { rz: 0.5, rx: -0.2 }); // tabla suelta colgando
    // tejado a dos aguas hundido: un faldón cae casi hasta el suelo
    const a = 0.55, L = d / 2 + 0.9;
    F.put(gPrism, 0, h + 0.3, 0, w, 1.4, d, 0x5a4230);
    for (const s of [1, -1]) {
      const droop = s === 1 ? R.range(0.25, 0.45) : 0;
      F.box(0, h + 0.95 - droop * 0.9, s * L / 2.2, w + 1.0, 0.14, L, R.pick([0x8a6a4a, 0x7a5a3c]), { rx: s * (a + droop) });
      for (let x = -w / 2; x < w / 2 + 0.5; x += 0.42) F.box(x, h + 1.05 - droop * 0.9, s * L / 2.2, 0.06, 0.05, L, 0x5a4026, { rx: s * (a + droop) });
    }
    // valla de estacas, troncos y montón de tablones
    for (let i = 0; i < 4; i++) F0.box(w / 2 + 0.7, 0.55, d / 2 - 0.3 - i * 0.32, 0.1, 1.1 + R.range(-0.15, 0.15), 0.22, R.pick(wood), { rz: R.range(-0.15, 0.15) });
    F0.seg([w / 2 + 0.4, 0.2, d / 2 + 0.8], [w / 2 + 2.2, 0.2, d / 2 + 0.2], 0.18, 0x8a6a48, gCyl);
    planks(F0, 18, -w / 2 - 1.5, w / 2 + 1.5, d / 2 + 0.2, d / 2 + 2.6, wood);
    if (R.chance(0.5)) { flame(F0.pt(-w * 0.3, 0.4, d / 2 + 1.2), 0.8); smoke(F0.pt(0, h + 1, 0), 0x3a3230); }
    return h + 1.5;
  };
  // ruina: solo quedan muros bajos y la chimenea, vigas caídas, escombros y brasas
  const houseRuin = (F, w, d) => {
    const col = R.pick(SIDING), t = 0.28;
    F.box(0, -0.05, 0, w + 0.16, 1.0, d + 0.16, PAL.stone);
    const walls = [[F.sub(0, 0, d / 2, 0), w], [F.sub(-w / 2, 0, 0, -Math.PI / 2), d], [F.sub(w / 2, 0, 0, Math.PI / 2), d], [F.sub(0, 0, -d / 2, Math.PI), w]];
    walls.forEach(([S, len], wi) => {
      const n = 5, sl = len / n;
      for (let k = 0; k < n; k++) {
        if (R.chance(0.2)) continue;
        const top = 0.45 + R.range(0.3, wi === 3 ? 3.2 : 2.2), lx = -len / 2 + sl * (k + 0.5);
        S.box(lx, (0.45 + top) / 2, -t / 2, sl + 0.01, top - 0.45, t, R.chance(0.6) ? col : PAL.soot);
        S.box(lx + R.range(-0.3, 0.3), top + 0.1, -t / 2, sl * 0.5, 0.2, t, shade(col, 0.6), { rz: R.range(-0.4, 0.4) });
      }
    });
    chimney(F, w * 0.3, -d / 2 + 0.5, 5.2);
    F.box(0, 0.48, 0, w - 0.6, 0.08, d - 0.6, PAL.ash);
    for (let i = 0; i < 5; i++) F.box(R.range(-w, w) * 0.3, 0.6 + R.range(0, 1.2), R.range(-d, d) * 0.3, R.range(2.5, 5), 0.2, 0.2, PAL.char, { ry: R.range(0, 3), rz: R.range(-0.45, 0.45) });
    rubble(F, 12, 0, 0, 1.2);
    embers(F, 12, 0, 0, w * 0.4, 0.55);
    for (let i = 0; i < 2; i++) flame(F.pt(R.range(-w, w) * 0.3, 0.6, R.range(-d, d) * 0.3), R.range(0.6, 1.0));
    smoke(F.pt(0, 1, 0), 0x3a3230);
    planks(F, 6, -w / 2 - 1, w / 2 + 1, d / 2 + 0.6, d / 2 + 2.6);
    return 3.2;
  };
  const HOUSES = { burning: houseBurning, gutted: houseGutted, shack: houseShack, ruin: houseRuin };
  // casa quemada en una parcela de la ciudad (face 0: la fachada mira a +z)
  const house = (x, z, face, variant, w, zone, g = G(x, z)) => {
    const d = 6.2, F = W(x, g, z, face);
    const top = HOUSES[variant](F, w, d);
    solidRect(F, -w / 2, w / 2, -d / 2, d / 2, -0.5, variant === 'ruin' ? 1.4 : Math.min(top - 1, 6.2), 'building');
    const c = Math.abs(Math.cos(face)), s = Math.abs(Math.sin(face));
    K.buildings.push({ x, z, w: w * c + d * s, d: w * s + d * c, h: top, roofY: g + top, kind: zone, solid: null });
  };

  /* ================= GASOLINERA ABANDONADA ================= */
  const gasStation = (x, z, ry, ruined) => {
    const g = G(x, z), F = W(x, g, z, ry), white = 0xd8d4cc, red = 0xb02a20, conc = 0x8a8682;
    F.box(0, -0.15, 0, 14, 0.4, 11.5, 0x5c5a58);
    for (let i = 0; i < 6; i++) F.box(R.range(-5, 5), 0.055, R.range(-4, 5), R.range(0.8, 2.2), 0.01, R.range(0.6, 1.8), 0x2a2826, { ry: R.range(0, 3) });
    // marquesina sobre cuatro columnas (en la ruinosa una columna se ha partido y la marquesina se ha venido abajo)
    const cols = [[-3.6, -0.6], [3.6, -0.6], [-3.6, 3.4], [3.6, 3.4]];
    cols.forEach(([cx, cz], i) => {
      if (ruined && i === 3) { F.box(cx, 0.8, cz, 0.5, 1.6, 0.5, conc); for (let k = 0; k < 4; k++) F.box(cx + R.range(-0.2, 0.2), 1.6 + R.range(0, 0.25), cz + R.range(-0.2, 0.2), 0.18, 0.4, 0.18, 0x4a4644, { rz: R.range(-0.5, 0.5) }); rubble(F, 6, cx + 1, cz + 0.6, 0.7); }
      else { F.box(cx, 2.45, cz, 0.5, 4.9, 0.5, white); F.box(cx, 0.4, cz, 0.56, 0.8, 0.56, red); if (R.chance(0.5)) F.box(cx, 1.6, cz + 0.27, 0.4, 1.4, 0.02, PAL.soot); }
      solidRect(F, cx - 0.3, cx + 0.3, cz - 0.3, cz + 0.3, -0.5, ruined && i === 3 ? 1.7 : 4.9, 'pillar');
    });
    const Cn = ruined ? F.sub(0, 3.6, 1.4, 0, 0.05, -0.33) : F.sub(0, 5.2, 1.4, 0);
    Cn.box(0, 0, 0, 10.4, 0.6, 6.4, 0xe0dcd4);
    Cn.box(0, 0, 3.22, 10.5, 0.46, 0.06, red); Cn.box(0, 0, -3.22, 10.5, 0.46, 0.06, red);
    for (const s of [-1, 1]) Cn.box(s * 5.22, 0, 0, 0.06, 0.46, 6.5, red);
    Cn.box(0, -0.31, 0, 10.2, 0.02, 6.2, 0x9a968e);
    for (let i = 0; i < 6; i++) Cn.box(-3.75 + i * 1.5, -0.33, R.pick([-1.6, 1.6]), 0.9, 0.04, 0.4, R.chance(0.3) ? 0xfff0c0 : 0x3a3a3a, { key: 'flat' });
    for (let i = 0; i < 5; i++) Cn.box(R.range(-4.5, 4.5), R.range(-0.2, 0.2), 3.26, R.range(0.6, 1.8), R.range(0.2, 0.45), 0.02, PAL.soot);
    text(Cn, 'GAS', -3.2, -0.08, 3.27, 0.11, 0xf2ece0);
    if (ruined) for (let i = 0; i < 4; i++) Cn.box(R.range(-4, 4), 0.32, R.range(-2.5, 2.5), R.range(0.8, 1.8), 0.05, R.range(0.6, 1.4), 0x5a5652, { rz: R.range(-0.3, 0.3), rx: R.range(-0.3, 0.3) });
    // islas de surtidores
    for (const ix of [-1.8, 1.8]) {
      F.box(ix, 0.1, 1.4, 0.95, 0.2, 4.2, conc);
      F.box(ix, 0.3, 1.4, 0.3, 0.2, 0.3, 0xd8b020);
      for (const pz of [0.3, 2.5]) {
        const burnt = R.chance(0.5), down = ruined && R.chance(0.35);
        const pc = burnt ? 0x3a3634 : white, hc = burnt ? 0x2a2624 : red;
        const P = down ? F.sub(ix + 0.7, 0.35, pz, 0, 0, Math.PI / 2 - 0.12) : F.sub(ix, 0.2, pz, 0);
        P.box(0, 0.85, 0, 0.62, 1.7, 0.9, pc);
        P.box(0, 1.85, 0, 0.68, 0.3, 0.96, hc);
        for (const s of [-1, 1]) { P.box(s * 0.32, 1.35, 0, 0.02, 0.36, 0.52, burnt ? 0x1a1a1a : 0x2a3a3a); P.box(s * 0.32, 0.9, 0.18, 0.02, 0.28, 0.2, 0x3a3a3a); }
        P.box(0.36, 1.05, -0.3, 0.1, 0.25, 0.12, PAL.black);
        P.seg([0.4, 1.0, -0.3], [0.5, 0.3, -0.1], 0.035, PAL.black, gCyl);
        P.seg([0.5, 0.3, -0.1], [0.42, 0.55, 0.32], 0.035, PAL.black, gCyl);
        solidRect(F, ix - 0.45, ix + 0.45, pz - 0.5, pz + 0.5, -0.5, down ? 0.9 : 2.1, 'pump');
        if (burnt && R.chance(0.6)) flame(F.pt(ix, down ? 0.8 : 2.2, pz), R.range(0.7, 1.1));
      }
    }
    // poste con el cartel de precios (dañado)
    {
      const P = F.sub(6.0, 0, 4.6, 0, 0, ruined ? 0.14 : 0.03);
      P.box(0, 3.3, 0, 0.32, 6.6, 0.32, 0x4a4a4c);
      const Sg = P.sub(0, 6.9, 0, 0);
      Sg.box(0, 0, 0, 2.2, 2.6, 0.45, red);
      Sg.box(0, 0.8, 0.24, 1.9, 0.75, 0.03, 0xf0e8d8);
      text(Sg, 'GAS', 0, 0.55, 0.26, 0.1, red);
      for (let i = 0; i < 3; i++) Sg.box(0, -0.15 - i * 0.42, 0.24, 1.8, 0.32, 0.03, i === 1 && ruined ? 0x050505 : 0x1a1a1a);
      for (let i = 0; i < 3; i++) Sg.box(0.45, -0.15 - i * 0.42, 0.26, 0.7, 0.18, 0.02, R.chance(0.5) ? 0xffb040 : 0x5a3a20, { key: 'glow' });
      Sg.box(R.range(-0.6, 0.6), R.range(-0.8, 0.8), 0.25, 0.9, 0.7, 0.02, PAL.soot, { rz: R.range(0, 3) });
      solidRect(F, 5.8, 6.2, 4.4, 4.8, -0.5, 6, 'pole');
    }
    // tienda quemada al fondo
    {
      const sx = -2.2, sz = -4.25, sw = 7.4, sd = 2.9, sh = 3.3;
      F.box(sx, sh / 2, sz, sw, sh, sd, R.pick([0xcfc8bc, 0xb8b0a4]));
      F.box(sx, sh + 0.25, sz, sw + 0.2, 0.5, sd + 0.2, 0x4a4644);
      F.box(sx, sh - 0.35, sz + sd / 2 + 0.04, sw, 0.6, 0.06, red);
      const Fr = F.sub(sx, 0, sz + sd / 2 + 0.01, 0);
      for (const lx of [-2.6, -1.0, 1.6, 2.8]) windowAt(Fr, lx, 1.4, 1.2, 1.6, R.chance(0.5), true);
      Fr.box(0.3, 1.1, 0.0, 1.0, 2.2, 0.06, PAL.fire, { key: 'glow' });
      Fr.box(0, sh * 0.6, 0.02, sw * 0.8, 1.3, 0.02, PAL.soot);
      solidRect(F, sx - sw / 2, sx + sw / 2, sz - sd / 2, sz + sd / 2, -0.5, sh + 0.5, 'building');
      flame(F.pt(sx + 0.3, 1.2, sz + sd / 2 + 0.3), 1.2); smoke(F.pt(sx, sh + 0.6, sz), 0x241e1c);
      light(F.pt(sx, 2, sz + sd / 2 + 1.5), 0xff6a20, 12, 14);
    }
    // neumáticos, bidones y escombros
    for (let i = 0; i < 4; i++) F.put(gTorus, R.range(-6, -4.5), 0.14 + i * 0.26, R.range(4.2, 5.2), 0.34, 0.34, 0.34, 0x1a1a1a, { rx: Math.PI / 2 });
    for (let i = 0; i < 3; i++) { const bx = 5.6 + R.range(-0.4, 0.4), bz = -2 + i * 0.75; if (R.chance(0.3)) F.put(gCyl, bx, 0.3, bz, 0.3, 0.9, 0.3, 0x8a2a1a, { rz: Math.PI / 2, ry: R.range(0, 3) }); else F.cyl(bx, 0.45, bz, 0.3, 0.9, R.pick([0x8a2a1a, 0x2a4a6a, 0x3a3a3a])); }
    rubble(F, 8, R.range(-4, 4), 5.4, 0.8);
    if (ruined) { flame(F.pt(3.6, 1.9, 3.4), 1.4); smoke(F.pt(3.6, 2.5, 3.4), 0x241e1c); }
    clearRect(F, -7, 7, -5.75, 5.75);
  };

  /* ================= BOCA DE RIEGO (HIDRANTE) ================= */
  const hydrant = (x, z, ry) => {
    const g = G(x, z), tilt = R.chance(0.25) ? R.range(0.12, 0.35) : 0;
    const F = W(x, g, z, ry, tilt, 0), col = R.pick([0xb8261c, 0xc8a020, 0xb8261c, 0xa83020]), dark = shade(col, 0.4), nut = 0x5a5654;
    F.cyl(0, 0.04, 0, 0.25, 0.08, 0x4a4644);
    F.cyl(0, 0.4, 0, 0.16, 0.66, col);
    F.cyl(0, 0.17, 0, 0.168, 0.22, dark);                 // hollín en la base
    F.cyl(0, 0.62, 0, 0.2, 0.06, col);
    F.cyl(0, 0.75, 0, 0.17, 0.18, col);
    F.put(gIco, 0, 0.86, 0, 0.16, 0.09, 0.16, col);
    F.put(gCyl, 0, 0.95, 0, 0.055, 0.07, 0.055, nut);
    for (const s of [-1, 1]) { F.put(gCyl, s * 0.21, 0.48, 0, 0.075, 0.12, 0.075, col, { rz: Math.PI / 2 }); F.put(gCyl, s * 0.285, 0.48, 0, 0.055, 0.035, 0.055, nut, { rz: Math.PI / 2 }); }
    F.put(gCyl, 0, 0.45, 0.21, 0.095, 0.14, 0.095, col, { rx: Math.PI / 2 }); F.put(gCyl, 0, 0.45, 0.29, 0.07, 0.03, 0.07, nut, { rx: Math.PI / 2 });
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; F.cyl(Math.cos(a) * 0.21, 0.09, Math.sin(a) * 0.21, 0.025, 0.03, nut); }
    if (R.chance(0.5)) F.box(R.range(-0.06, 0.06), 0.55, 0.15, 0.12, 0.2, 0.02, dark);
    if (R.chance(0.3)) F.put(gIco, 0.5, 0.01, 0.4, 0.9, 0.02, 0.6, 0x3a4048); // charco de agua
    K.solid(x - 0.3, x + 0.3, g - 0.3, g + 0.95, z - 0.3, z + 0.3, 'hydrant');
    clears.push({ x0: x - 0.4, x1: x + 0.4, z0: z - 0.4, z1: z + 0.4 });
  };

  /* ================= CABINA TELEFÓNICA ================= */
  const booth = (x, z, ry, state) => {
    const g = G(x, z);
    const F = state === 'down' ? W(x, g + 0.58, z, ry, Math.PI / 2 - 0.06, 0) : W(x, g, z, ry, state === 'lean' ? R.range(-0.08, 0.08) : 0, state === 'lean' ? R.pick([-1, 1]) * R.range(0.16, 0.28) : 0);
    const col = R.pick([0xa01e18, 0x6e7478, 0x3a5a7a]), burnt = R.chance(0.5), fc = burnt ? shade(col, 0.45) : col, glass = 0x46566a;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) F.box(sx * 0.5, 1.2, sz * 0.5, 0.1, 2.4, 0.1, fc);
    F.box(0, 2.47, 0, 1.18, 0.14, 1.18, fc);
    F.box(0, 2.27, 0, 1.1, 0.26, 1.1, 0x2a5aa8);
    F.box(0, 2.27, 0, 1.12, 0.07, 1.12, 0xe8e8e8);
    F.box(0, 0.05, 0, 1.12, 0.1, 1.12, 0x3a3a3a);
    // paneles bajos y cristales (rotos o ausentes)
    const sides = [[0, -0.5, 0], [-0.5, 0, Math.PI / 2], [0.5, 0, -Math.PI / 2]];
    for (const [lx, lz, rr] of sides) {
      const S = F.sub(lx, 0, lz, rr);
      S.box(0, 0.35, 0, 0.92, 0.55, 0.05, fc);
      const k = R.next();
      if (k < 0.35) S.box(0, 1.45, 0, 0.9, 1.5, 0.03, glass);
      else if (k < 0.75) for (let i = 0; i < 3; i++) S.box(R.range(-0.35, 0.35), R.chance(0.5) ? 0.78 : 2.05, 0, R.range(0.15, 0.32), R.range(0.12, 0.3), 0.025, glass, { rz: R.range(-0.7, 0.7) });
      S.box(0, 1.45, 0.02, 0.9, 0.04, 0.04, fc);
    }
    // teléfono, auricular colgando y estante
    F.box(0, 1.45, -0.42, 0.34, 0.52, 0.12, 0x2a2a2c);
    F.box(-0.05, 1.5, -0.355, 0.16, 0.16, 0.02, 0x8a8a8a);
    F.box(0.21, 1.15, -0.36, 0.07, 0.26, 0.08, PAL.black, { rz: 0.15 });
    F.seg([0.14, 1.3, -0.37], [0.21, 1.02, -0.36], 0.012, PAL.black, gCyl);
    F.box(0, 1.02, -0.36, 0.6, 0.04, 0.2, fc);
    // puerta abierta o arrancada
    if (R.chance(0.6)) F.box(0.33, 1.2, 0.94, 0.95, 2.1, 0.05, fc, { ry: 1.15 });
    else F.box(R.range(0.6, 1.2), state === 'down' ? 0.3 : 0.04, R.range(0.9, 1.4), 0.95, 0.05, 2.1, fc, { ry: R.range(-0.5, 0.5) });
    if (burnt) for (let i = 0; i < 3; i++) F.box(R.range(-0.4, 0.4), R.range(0.8, 2.2), 0.52, R.range(0.2, 0.5), R.range(0.3, 0.8), 0.02, PAL.soot);
    const Gd = W(x, g, z, ry);
    for (let i = 0; i < 7; i++) Gd.box(R.range(-1.4, 1.4), 0.02, R.range(-1.4, 1.4), R.range(0.08, 0.22), 0.02, R.range(0.05, 0.16), R.chance(0.6) ? 0x8a9aa8 : 0xe8e4dc, { ry: R.range(0, 3) });
    if (state === 'down') solidRect(Gd, -0.65, 0.65, -0.2, 2.5, -0.5, 1.2, 'booth');
    else solidRect(Gd, -0.6, 0.6, -0.6, 0.6, -0.5, 2.5, 'booth');
  };

  /* ================= CONTENEDORES Y CUBOS DE BASURA ================= */
  const dumpster = (x, z, ry, state) => {
    const g = G(x, z), tipped = state === 'tipped';
    const F = tipped ? W(x, g + 0.98, z, ry, 0, Math.PI / 2) : W(x, g, z, ry, 0, state === 'dented' ? R.range(-0.08, 0.08) : 0);
    const base = R.pick([0x2e5a3c, 0x2a4a78, 0x55595c, 0x6a3a22, 0x3a6a5a]), col = state === 'fire' ? shade(base, 0.45) : base, dk = shade(col, 0.7);
    F.box(0, 0.76, 0, 1.9, 1.12, 1.2, col);
    F.box(0, 1.33, 0, 2.0, 0.08, 1.3, dk);
    for (const lx of [-0.6, 0, 0.6]) for (const s of [-1, 1]) F.box(lx, 0.76, s * 0.61, 0.08, 1.0, 0.05, dk);
    for (const s of [-1, 1]) F.box(s * 0.97, 0.55, 0, 0.06, 0.2, 1.0, 0x222222);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) F.put(gCyl, sx * 0.75, 0.1, sz * 0.45, 0.1, 0.08, 0.1, PAL.black, { rx: Math.PI / 2 });
    const open = state === 'fire' || tipped || R.chance(0.4);
    for (const s of [-1, 1]) {
      if (open && (s === 1 || state === 'fire')) F.box(s * 0.475, 1.36 + 0.6, -0.6 - 0.2, 0.93, 0.05, 1.28, shade(col, 0.6), { rx: -1.9 + R.range(-0.2, 0.2) });
      else F.box(s * 0.475, 1.39, 0, 0.93, 0.05, 1.28, shade(col, 0.6), { rx: state === 'dented' ? R.range(-0.15, 0.1) : 0 });
    }
    if (state === 'dented') for (let i = 0; i < 2; i++) F.put(gIco, R.range(-0.6, 0.6), R.range(0.5, 1.0), 0.6, 0.3, 0.25, 0.08, shade(col, 0.55));
    const Gd = W(x, g, z, ry);
    if (state === 'fire') {
      F.box(0, 1.25, 0, 1.7, 0.12, 1.0, PAL.fire, { key: 'glow' });
      for (let i = 0; i < 5; i++) F.put(gIco, R.range(-0.7, 0.7), 1.3, R.range(-0.4, 0.4), 0.25, 0.18, 0.25, PAL.char);
      for (let i = 0; i < 4; i++) F.box(R.range(-0.8, 0.8), R.range(0.5, 1.2), 0.62, R.range(0.3, 0.6), R.range(0.3, 0.6), 0.02, PAL.soot);
      flame(F.pt(0, 1.45, 0), 1.3); flame(F.pt(0.45, 1.45, 0.2), 0.9); smoke(F.pt(0, 1.9, 0), 0x2a2420);
      light(F.pt(0, 2, 0), 0xff6a20, 9, 11);
    }
    if (tipped || state === 'fire') for (let i = 0; i < 8; i++) Gd.put(gIco, R.range(-1.2, 1.2), 0.15, R.range(0.9, 2.2), R.range(0.18, 0.35), R.range(0.15, 0.3), R.range(0.18, 0.35), R.pick([0x1a1a1a, 0x2a2a2a, 0x6a5a40, 0xd8d0c0]), { ry: R.range(0, 3) });
    if (tipped) solidRect(Gd, -1.4, -0.1, -0.65, 0.65, -0.5, 1.95, 'dumpster');
    else solidRect(Gd, -1.0, 1.0, -0.65, 0.65, -0.5, 1.45, 'dumpster');
  };
  const bin = (x, z, ry, down) => {
    const g = G(x, z), F = down ? W(x, g + 0.36, z, ry, Math.PI / 2, 0) : W(x, g, z, ry);
    const col = R.pick([0x2e6a3a, 0x5a5a5e, 0x2a4a8a, 0xb89a20, 0x6a3a22]);
    F.box(0, 0.55, 0, 0.62, 0.95, 0.7, col);
    F.box(0, 1.06, -0.02, 0.66, 0.06, 0.76, shade(col, 0.7), { rx: down ? -0.6 : 0 });
    for (const s of [-1, 1]) F.put(gCyl, s * 0.24, 0.1, -0.36, 0.1, 0.07, 0.1, PAL.black, { rz: Math.PI / 2 });
    if (down) for (let i = 0; i < 4; i++) W(x, g, z, ry).put(gIco, R.range(-0.5, 0.5), 0.1, R.range(1.0, 1.8), 0.18, 0.14, 0.18, R.pick([0x1a1a1a, 0x6a5a40, 0xd8d0c0]));
    K.solid(x - 0.45, x + 0.45, g - 0.3, g + (down ? 0.75 : 1.1), z - 0.45, z + 0.45, 'bin');
    clears.push({ x0: x - 0.5, x1: x + 0.5, z0: z - 0.5, z1: z + 0.5 });
  };

  /* ================= ÁRBOLES QUEMADOS ================= */
  // sustituye a los árboles muertos sencillos: consume los mismos números del generador del mapa (rng)
  const fallen = (F, L, r0, wood = R.pick([0x2e2420, 0x3a2c22, 0x261d19])) => {
    F.put(gTrunk, L / 2, 0, 0, r0, L, r0, wood, { rz: -Math.PI / 2 });
    F.put(ROCKS[R.int(0, 4)], -0.05, 0.05, 0, 0.3, r0 * 3.0, r0 * 3.0, 0x3a2c22);
    for (let i = 0; i < 4; i++) { const a = R.range(0, TAU); F.seg([0, 0, 0], [-0.3, Math.cos(a) * r0 * 4, Math.sin(a) * r0 * 4], r0 * 0.3, 0x2a2018); }
    for (let i = 0; i < R.int(3, 5); i++) {
      const t = R.range(0.35, 0.92), a = R.range(-1.2, 1.2) + (R.chance(0.5) ? 0 : Math.PI), l = R.range(0.8, 2.2);
      const dy = Math.cos(a), dz = Math.sin(a); if (dy < -0.2) continue;
      const A = [t * L, 0, 0], B = [t * L + l * 0.6, dy * l, dz * l];
      F.seg(A, B, r0 * R.range(0.25, 0.4), wood);
      if (R.chance(0.5)) F.seg(B, [B[0] + 0.5, B[1] + R.range(0.2, 0.6), B[2] + R.range(-0.4, 0.4)], r0 * 0.15, wood);
    }
    for (let i = 0; i < 4; i++) F.box(R.range(0.2, 0.9) * L, r0 * R.range(0.4, 0.9), R.pick([-1, 1]) * r0 * 0.75, R.range(0.15, 0.35), 0.05, 0.1, PAL.ember, { key: 'glow', ry: R.range(-0.4, 0.4) });
  };
  const tree = (x, z, s = 1, type = null, { rngRy = null } = {}) => {
    const k = R.next(), t = type || (k < 0.38 ? 'seco' : k < 0.55 ? 'fuego' : k < 0.75 ? 'caido' : k < 0.88 ? 'partido' : 'tocon');
    deferred.push({ x, z, t, s, ry: rngRy ?? R.range(0, TAU), tilt: [R.range(-0.1, 0.1), R.range(-0.1, 0.1)], lean: R.chance(0.2) ? R.range(0.15, 0.3) : 0, h: R.range(0, 1) });
  };
  const buildTree = (T) => {
    const { x, z, s, ry } = T, g = G(x, z);
    if (T.t === 'seco' || T.t === 'fuego') {
      const h = (T.t === 'seco' ? 4.6 + T.h * 3 : 5 + T.h * 2.6) * s;
      (T.t === 'seco' ? lists.seco : lists.fuego).push({ x, y: g - 0.15, z, h, ry, rx: T.tilt[0] + T.lean, rz: T.tilt[1] });
      K.solid(x - 0.35, x + 0.35, g - 1, g + h * 0.55, z - 0.35, z + 0.35, 'tree');
      if (T.t === 'fuego' && R.chance(0.35)) flame({ x, y: g + 0.3, z }, 0.5);
      for (let i = 0; i < R.int(1, 3); i++) { const a = R.range(0, TAU), d = R.range(1.2, 2.8); W(x + Math.cos(a) * d, G(x + Math.cos(a) * d, z + Math.sin(a) * d) + 0.06, z + Math.sin(a) * d, R.range(0, TAU)).put(gTrunk, 0, 0, 0, 0.07, R.range(0.8, 1.6), 0.07, R.pick([PAL.char, 0x4a3828]), { rz: Math.PI / 2 }); }
    } else if (T.t === 'caido') {
      const L = (4.5 + T.h * 3.5) * s, r0 = (0.22 + R.range(0, 0.16)) * s, F = W(x, g + r0 * 0.75, z, ry, 0, R.range(-0.04, 0.06));
      fallen(F, L, r0);
      const c = Math.cos(ry), sn = Math.sin(ry), x2 = x + c * L * 0.85, z2 = z - sn * L * 0.85;
      K.solid(Math.min(x, x2) - r0, Math.max(x, x2) + r0, g - 0.5, g + r0 * 1.6, Math.min(z, z2) - r0, Math.max(z, z2) + r0, 'log');
    } else if (T.t === 'partido') {
      const hs = (1.6 + T.h * 1.8) * s, r0 = (0.3 + R.range(0, 0.12)) * s, F = W(x, g - 0.1, z, ry);
      F.put(gTrunk, 0, hs / 2, 0, r0, hs, r0, PAL.char);
      for (let i = 0; i < 5; i++) { const a = R.range(0, TAU); F.put(gCone, Math.cos(a) * r0 * 0.5, hs + 0.25, Math.sin(a) * r0 * 0.5, r0 * 0.3, R.range(0.3, 0.9), r0 * 0.3, PAL.char, { rx: R.range(-0.3, 0.3), rz: R.range(-0.3, 0.3) }); }
      F.put(gIco, 0, hs + 0.05, 0, r0 * 0.75, 0.06, r0 * 0.75, PAL.ember, { key: 'glow' });
      const F2 = W(x + 0.9 * Math.cos(ry + 0.6), g + r0 * 0.6, z - 0.9 * Math.sin(ry + 0.6), ry + 0.6, 0, 0.05);
      fallen(F2, (3 + T.h * 2) * s, r0 * 0.6);
      K.solid(x - r0, x + r0, g - 1, g + hs, z - r0, z + r0, 'tree');
      if (R.chance(0.5)) flame({ x, y: g + hs, z }, 0.45);
    } else {
      const hs = (0.5 + T.h * 0.6) * s, r0 = (0.38 + R.range(0, 0.18)) * s, F = W(x, g - 0.05, z, ry);
      F.put(gTrunk, 0, hs / 2, 0, r0, hs, r0, PAL.char);
      F.put(gIco, 0, hs + 0.02, 0, r0 * 0.8, 0.07, r0 * 0.8, PAL.ember, { key: 'glow' });
      for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + R.range(-0.3, 0.3); F.seg([0, 0.15, 0], [Math.cos(a) * r0 * 2.6, -0.1, Math.sin(a) * r0 * 2.6], r0 * 0.3, 0x2a2018); }
      flame({ x, y: g + hs + 0.1, z }, 0.45);
      K.solid(x - r0, x + r0, g - 1, g + hs, z - r0, z + r0, 'tree');
    }
  };

  /* ================= CRISTALES DE MAGMA ================= */
  const TINTS = [0xffffff, 0xffffff, 0xffb070, 0xff8a5a, 0x9a6a5a];
  // cristal suelto (el mismo que usaba el mapa): se guarda para dibujarlo instanciado
  const crystalInst = (it) => lists.crys.push(it);
  const crystalCluster = (x, z, size = 1, y = null, { solid = size >= 0.9, lit = size >= 1.4 } = {}) => {
    const g = y ?? G(x, z), tint = R.pick(TINTS), n = (K.mobile ? R.int(3, 5) : R.int(4, 7)) + (size > 1.5 ? 2 : 0);
    for (let i = 0; i < n; i++) {
      const a = R.range(0, TAU), d = i === 0 ? 0 : R.range(0.4, 1.3) * size, lean = i === 0 ? R.range(0, 0.15) : R.range(0.2, 0.6);
      const h = (i === 0 ? R.range(2.4, 3.4) : R.range(0.7, 2.2)) * size;
      lists.crys.push({ x: x + Math.cos(a) * d, y: g - 0.2 * size, z: z + Math.sin(a) * d, h, sx: R.range(0.8, 1.15), ry: R.range(0, TAU), rx: Math.sin(a) * lean, rz: -Math.cos(a) * lean, o: 'XZY', c: R.chance(0.8) ? tint : R.pick(TINTS) });
    }
    const F = W(x, g, z, R.range(0, TAU));
    for (let i = 0; i < 4; i++) F.put(ROCKS[R.int(0, 4)], R.range(-1, 1) * size, 0.1, R.range(-1, 1) * size, R.range(0.4, 0.8) * size, R.range(0.25, 0.5) * size, R.range(0.4, 0.8) * size, R.pick([0x241e1c, 0x2e2624, 0x1a1616]), { ry: R.range(0, 3) });
    F.put(gIco, 0, 0.03, 0, 1.6 * size, 0.04, 1.6 * size, 0xff4a10, { key: 'glow' });
    for (let i = 0; i < 3; i++) { const a = R.range(0, TAU); crackAt(x + Math.cos(a) * size * 1.4, z + Math.sin(a) * size * 1.4, R.range(2, 4) * size, a); }
    if (solid) K.solid(x - 1.1 * size, x + 1.1 * size, g - 1, g + 1.6 * size, z - 1.1 * size, z + 1.1 * size, 'rock');
    if (lit) light({ x, y: g + 2 * size, z }, 0xff4a20, 7 * size, 9 * size);
    clears.push({ x0: x - 1.2 * size, x1: x + 1.2 * size, z0: z - 1.2 * size, z1: z + 1.2 * size });
  };
  // grieta de magma en el suelo (zigzag de luz que sigue el terreno)
  const crackAt = (x, z, len, a0) => {
    let cx = x, cz = z, a = a0;
    for (let i = 0; i < Math.ceil(len / 1.2); i++) {
      a += R.range(-0.6, 0.6);
      const nx = cx + Math.cos(a) * 1.2, nz = cz + Math.sin(a) * 1.2, mx = (cx + nx) / 2, mz = (cz + nz) / 2;
      add(gBox, 'glow', M(mx, G(mx, mz) + 0.03, mz, 0, -a, 0, 1.3, 0.05, R.range(0.1, 0.24)), R.chance(0.3) ? 0xffb03a : 0xff5a14);
      cx = nx; cz = nz;
    }
  };
  // roca de lava (modelo de Tripo ligero) con llamas
  const lavaRock = (x, z, h) => {
    const g = G(x, z);
    lists.rocas.push({ x, y: g - 0.15, z, h, ry: R.range(0, TAU) });
    K.solid(x - h * 0.42, x + h * 0.42, g - 1, g + h * 0.38, z - h * 0.42, z + h * 0.42, 'rock');
    light({ x, y: g + h * 0.7, z }, 0xff6a20, 6, 9);
    clears.push({ x0: x - h * 0.5, x1: x + h * 0.5, z0: z - h * 0.5, z1: z + h * 0.5 });
  };

  /* ================= CUEVA VOLCÁNICA (entrada al jefe) ================= */
  // mx, mz: centro de la boca; y0: suelo de la terraza; floorM: suelo en la boca (rampa)
  const cave = ({ mx, mz, y0, floorM, depth = 5.4, width = 6.4, arena }) => {
    const rock = [0x0e0c0c, 0x141111, 0x1a1615, 0x0a0909];
    // cada «roca» son varios peñascos irregulares apretados, con vetas de magma por las juntas
    const B = (x, y, z, sx, sy, sz, c = null) => {
      const n = sx > 2.2 ? 3 : sx > 1.5 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const k = n === 1 ? 1 : R.range(0.55, 0.8), ox = n === 1 ? 0 : R.range(-0.45, 0.45) * sx, oy = n === 1 ? 0 : R.range(-0.3, 0.35) * sy, oz = n === 1 ? 0 : R.range(-0.45, 0.45) * sz;
        WR(x + ox, y + oy, z + oz, R.range(0, TAU), R.range(-0.4, 0.4), R.range(-0.4, 0.4)).put(CRAGS[R.int(0, 4)], 0, 0, 0, sx * k * R.range(0.85, 1.15), sy * k * R.range(0.7, 1.0), sz * k * R.range(0.85, 1.15), c ?? R.pick(rock), { key: 'rock' });
      }
      if (R.chance(0.7)) WR(x, y + R.range(-0.3, 0.3) * sy, z + sz * 0.8, R.range(0, TAU), R.range(-0.6, 0.6), R.range(-1.2, 1.2)).put(gBox, 0, 0, 0, sx * R.range(0.6, 1.2), 0.06, 0.1, R.chance(0.4) ? 0xffb03a : 0xff5a14, { key: 'glow' });
    };
    const hw = width / 2, z1 = mz - depth, top = y0 + 5.2;
    // núcleo de magma: brilla entre las rocas
    for (const [x, y, z, r] of [[mx + 6.4, y0 + 3.4, mz - 4.4, 1.7], [mx + 1, top + 1.8, mz - 2.8, 1.4], [mx + 7.6, y0 + 2, mz - 7.2, 1.4], [mx - 1.5, top + 1.0, mz - 1.4, 0.9]]) WR(x, y, z).put(ROCKS[0], 0, 0, 0, r, r * 0.9, r, 0xb8300a, { key: 'glow' });
    // jambas de la boca y dintel (forman el arco)
    for (const s of [-1, 1]) {
      B(mx + s * (hw + 1.6), floorM + 1.2, mz + 0.4, 1.9, 1.7, 1.8);
      B(mx + s * (hw + 1.4), floorM + 3.6, mz + 0.1, 1.7, 1.6, 1.7);
      B(mx + s * (hw + 2.1), floorM + 0.6, mz + 1.6, 1.4, 1.1, 1.3);
      B(mx + s * (hw + 1.7), y0 + 2.2, mz - 2.6, 2.0, 2.4, 2.4);
      B(mx + s * (hw + 1.6), y0 + 2.0, z1 + 0.6, 1.9, 2.2, 1.8);
    }
    for (let i = 0; i < 4; i++) B(mx - hw + 0.6 + i * (width - 1.2) / 3, top + 1.0 + R.range(-0.2, 0.3), mz + R.range(-0.2, 0.3), 1.6, 1.3, 1.6);
    for (let i = 0; i < 4; i++) B(mx - hw + 0.8 + i * (width - 1.6) / 3, top + 1.3, mz - 2.6, 1.8, 1.5, 1.9);
    for (let i = 0; i < 3; i++) B(mx - hw + 1.2 + i * (width - 2.4) / 2, top + 1.0, z1 + 0.8, 1.7, 1.3, 1.6);
    // la gran masa de la cueva (más al este: al oeste empieza la arena del jefe)
    for (const [x, y, z, r] of [[mx + 7.5, y0 + 3.2, mz - 1.5, 3.6], [mx + 8.5, y0 + 5.5, mz - 5, 3.8], [mx + 6, y0 + 2.2, mz - 7.8, 2.8], [mx + 3.2, top + 3.2, mz - 3.2, 3.0], [mx - 2, top + 2.6, mz - 2.2, 2.6], [mx + 10.5, y0 + 1.8, mz - 2.2, 2.4], [mx - 6.3, y0 + 1.6, mz - 1.0, 2.0], [mx - 6.6, y0 + 3.4, mz - 2.4, 1.8], [mx + 1.2, top + 4.8, mz - 3.6, 2.2], [mx + 5.2, top + 3.8, mz - 6.2, 2.4]]) {
      const ax = x - arena.x, az = z - arena.z;
      if (Math.hypot(ax, az) < arena.r + r * 0.6) continue;
      B(x, y, z, r, r * R.range(0.8, 1.0), r * R.range(0.85, 1.05));
    }
    // piedras sueltas al pie
    for (let i = 0; i < 12; i++) { const a = R.range(-0.4, Math.PI + 0.4), d = R.range(5, 9), x = mx + Math.cos(a) * d, z = mz + Math.sin(a) * d * 0.6 + 0.5; if (Math.abs(x - mx) < hw + 0.5 && z > mz - 1) continue; B(x, G(x, z) + 0.2, z, R.range(0.4, 0.9), R.range(0.3, 0.6), R.range(0.4, 0.9)); }
    // grietas incandescentes por la cara de la cueva
    for (let i = 0; i < 14; i++) { const a = R.range(0, Math.PI), r = R.range(4, 8); WR(mx + Math.cos(a) * r, y0 + R.range(1, 7), mz - 2 + Math.sin(a) * 0.5 - R.range(0, 3), R.range(0, TAU), R.range(-0.5, 0.5), R.range(-1, 1)).put(gBox, 0, 0, 0, R.range(0.8, 2), 0.08, 0.12, R.chance(0.4) ? 0xffb03a : 0xff5a14, { key: 'glow' }); }
    // marco del portal del jefe (al fondo de la cueva): anillo de cristales y velo de calor
    crystalCluster(mx - hw + 0.4, mz - depth + 0.6, 0.6, y0, { solid: false, lit: false });
    crystalCluster(mx + hw - 0.4, mz - depth + 0.6, 0.6, y0, { solid: false, lit: false });
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) lists.crys.push({ x: mx + s * (hw - 0.1), y: floorM + 1.0 + i * 1.3, z: mz - 1.2 - i * 0.9, h: R.range(0.9, 1.6), ry: R.range(0, TAU), rx: R.range(-0.3, 0.3), rz: -s * R.range(0.6, 1.1), o: 'XZY', c: 0xffffff });
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.6, 4.6, 1, 1), new THREE.ShaderMaterial({
      uniforms: { uT: FXT }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uT; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main(){
          vec2 c = vUv - vec2(0.5, 0.42); float arch = length(c * vec2(1.0, 0.8));
          float sw = n(vec2(vUv.x * 4.0 + sin(uT * 0.7) * 0.4, vUv.y * 3.0 - uT * 0.9)) * 0.6 + n(vec2(vUv.x * 9.0, vUv.y * 7.0 - uT * 1.7)) * 0.4;
          float ring = smoothstep(0.52, 0.40, arch) * (0.35 + 0.65 * smoothstep(0.18, 0.46, arch));
          float a = ring * (0.25 + 0.75 * sw) * smoothstep(0.0, 0.12, vUv.y);
          vec3 col = mix(vec3(1.0, 0.25, 0.04), vec3(1.0, 0.75, 0.3), sw);
          gl_FragColor = vec4(col * a * 1.3, a);
        }`,
    }));
    veil.position.set(mx, y0 + 2.3, mz - depth + 0.25);
    veil.renderOrder = 3;
    scene.add(veil);
    // luces, fuego y humo
    light({ x: mx, y: floorM + 2.6, z: mz + 1.2 }, 0xff6a20, 18, 22);
    light({ x: mx, y: y0 + 2.2, z: mz - depth + 1 }, 0xff3a0a, 16, 12);
    for (const s of [-1, 1]) flame({ x: mx + s * (hw + 0.3), y: floorM + 0.3, z: mz + 0.9 }, 1.0);
    smoke({ x: mx + 6, y: top + 6, z: mz - 4 }, 0x241e1c); smoke({ x: mx + 1, y: top + 4, z: mz - 3 }, 0x3a3230);
    // colisiones: paredes de la boca, techo (alto, se pasa por debajo) y la masa del este
    K.solid(mx - hw - 3.6, mx - hw + 0.05, y0 - 1, top + 2, mz - 3.0, mz + 2.2, 'rock');
    K.solid(mx + hw - 0.05, mx + hw + 9.5, y0 - 1, top + 4, mz - 9.5, mz + 2.2, 'rock');
    K.solid(mx - hw, mx + hw, top - 0.2, top + 4, z1 + 0.2, mz + 1.4, 'rock');
  };

  /* ================= EL VOLCÁN: COLUMNAS, CORONA DEL CRÁTER Y AGUJAS ================= */
  const volcano = ({ V, coneR, avoid }) => {
    const rockC = [0x1e1a19, 0x26211f, 0x1a1615, 0x2c2624];
    const F0 = mkFrame(radd, new THREE.Matrix4());
    const pillar = (x, z, h, r, lean, solid = true) => {
      const gx = G(x, z), dx = x - V.x, dz = z - V.z, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl;
      const A = [x - ux * 0.5, gx - 2.5, z - uz * 0.5], Bt = [x + ux * Math.sin(lean) * h, gx - 2.5 + Math.cos(lean) * h, z + uz * Math.sin(lean) * h];
      F0.seg(A, Bt, r, R.pick(rockC), PILLARS[R.int(0, 2)], 'vrock');
      WR(Bt[0], Bt[1] - 0.2, Bt[2], R.range(0, TAU)).put(ROCKS[R.int(0, 4)], 0, 0, 0, r * 0.75, r * 0.45, r * 0.75, R.pick(rockC), { key: 'vrock' });
      if (r > 2.5 && R.chance(0.45)) F0.seg([A[0] + ux * r * 0.78, A[1] + 2.5, A[2] + uz * r * 0.78], [Bt[0] + ux * r * 0.55, Bt[1] - h * 0.25, Bt[2] + uz * r * 0.55], 0.12, 0xff5a14, gCyl, 'glow');
      if (solid) K.solid(x - r * 0.75, x + r * 0.75, gx - 2, gx - 2.5 + h * 0.85, z - r * 0.75, z + r * 0.75, 'rock');
    };
    // columnas de basalto agrupadas por las laderas (entre los ríos de lava)
    let placed = 0;
    for (let i = 0; i < 260 && placed < 46; i++) {
      const a = R.range(0, TAU), r = R.range(17, coneR - 6), x = V.x + Math.cos(a) * r, z = V.z + Math.sin(a) * r;
      if (avoid(x, z, 4)) continue;
      const big = R.chance(0.55), h = (big ? R.range(11, 20) : R.range(6, 11)) * (1.2 - r / coneR * 0.5), rad = big ? R.range(3.2, 5.4) : R.range(1.8, 3.0);
      pillar(x, z, h, rad, R.range(0.04, 0.2));
      placed++;
      for (let k = 0; k < R.int(1, 3); k++) { const b = a + R.range(-0.12, 0.12), r2 = r + R.range(-4, 4), x2 = V.x + Math.cos(b) * r2, z2 = V.z + Math.sin(b) * r2; if (!avoid(x2, z2, 3)) pillar(x2, z2, h * R.range(0.45, 0.8), rad * R.range(0.55, 0.8), R.range(0.08, 0.25)); }
    }
    // corona de rocas dentadas en el borde del cráter (con huecos por donde se derrama la lava y el del sendero)
    for (let i = 0; i < 30; i++) {
      const a = i / 30 * TAU + R.range(-0.05, 0.05), r = V.crater + R.range(1.4, 3.4), x = V.x + Math.cos(a) * r, z = V.z + Math.sin(a) * r;
      if (avoid(x, z, 1.4, true)) continue;
      pillar(x, z, R.range(5, 9.5), R.range(1.6, 2.8), R.range(0.25, 0.5), false);
    }
    // las tres agujas negras de la cima (como en la referencia)
    for (const a of [-Math.PI / 2 - 0.75, -Math.PI / 2 + 0.05, -Math.PI / 2 + 0.8]) {
      const r = V.crater + 4.5, x = V.x + Math.cos(a) * r, z = V.z + Math.sin(a) * r, gx = G(x, z), h = R.range(16, 22);
      F0.seg([x, gx - 3, z], [x + Math.cos(a) * 3, gx + h, z + Math.sin(a) * 3], R.range(3.2, 4.2), 0x141111, PILLARS[R.int(0, 2)], 'vrock');
      F0.put(gCone, x + Math.cos(a) * 3.2, gx + h + 2.6, z + Math.sin(a) * 3.2, 2.6, 5.5, 2.6, 0x100d0d, { key: 'vrock', rz: -Math.cos(a) * 0.2, rx: Math.sin(a) * 0.2 });
      for (let k = 0; k < 4; k++) WR(x + R.range(-1, 1), gx + R.range(3, h - 2), z + R.range(-1, 1), R.range(0, TAU), 0, R.range(-1.2, 1.2)).put(gBox, 0, 0, 0, R.range(2, 4), 0.14, 0.2, 0xff5a14, { key: 'glow' });
    }
    // anillo interior incandescente del cráter
    for (let i = 0; i < 24; i++) { const a = i / 24 * TAU, r = V.crater - 1.2, x = V.x + Math.cos(a) * r, z = V.z + Math.sin(a) * r; WR(x, V.lake + 0.4, z, -a).put(gBox, 0, 0, 0, 0.6, 1.2, 3.2, 0xff8a2a, { key: 'glow' }); }
  };


  /* ================= ROCAS VOLCÁNICAS (según la imagen de referencia) =================
     Bloques de roca negra azulada, facetados y algo brillantes, partidos en placas por una red de grietas por las
     que asoma el magma (naranja con el centro amarillo). Las grietas las dibuja el material (diagrama de Voronoi
     en 3D sobre la superficie), así cada roca tiene su propio dibujo de grietas. */
  const lavaRockAt = (x, y, z, sx, sy, sz, ry = R2.range(0, TAU), tilt = 0.12) => {
    WR(x, y, z, ry, R2.range(-tilt, tilt), R2.range(-tilt, tilt)).put(LAVA_ROCKS[R2.int(0, LAVA_ROCKS.length - 1)], 0, 0, 0, sx, sy, sz, R2.pick(LAVA_TONES), { key: 'lava' });
  };
  // formación: 'boulder' (un bloque grande), 'cluster' (varios bloques) o 'spire' (bloque alto)
  const lavaFormation = (x, z, s = 1, kind = 'boulder') => {
    const g = G(x, z);
    if (kind === 'spire') {
      lavaRockAt(x, g + 1.6 * s, z, 1.0 * s, 2.3 * s, 0.9 * s, undefined, 0.08);
      lavaRockAt(x + 0.9 * s, g + 0.35 * s, z + 0.5 * s, 0.55 * s, 0.5 * s, 0.5 * s);
      K.solid(x - 0.9 * s, x + 0.9 * s, g - 1, g + 3.6 * s, z - 0.9 * s, z + 0.9 * s, 'rock');
    } else if (kind === 'cluster') {
      lavaRockAt(x, g + 0.85 * s, z, 1.1 * s, 1.25 * s, 1.0 * s);
      for (let i = 0; i < R2.int(2, 4); i++) { const a = R2.range(0, TAU), d = R2.range(1.2, 1.9) * s, k = R2.range(0.35, 0.7); lavaRockAt(x + Math.cos(a) * d, g + 0.6 * k * s, z + Math.sin(a) * d, k * s, k * 1.1 * s, k * 0.95 * s); }
      K.solid(x - 1.1 * s, x + 1.1 * s, g - 1, g + 1.9 * s, z - 1.1 * s, z + 1.1 * s, 'rock');
    } else {
      lavaRockAt(x, g + 1.0 * s, z, 1.15 * s, 1.35 * s, 1.0 * s);
      K.solid(x - 1.0 * s, x + 1.0 * s, g - 1, g + 2.1 * s, z - 0.9 * s, z + 0.9 * s, 'rock');
    }
    if (s >= 1.1) light({ x, y: g + 1.2 * s, z }, 0xff5a14, 5 * s, 7 * s);
    if (R2.chance(0.35)) flame({ x: x + R2.range(-0.5, 0.5) * s, y: g + 0.3, z: z + R2.range(-0.5, 0.5) * s }, 0.45);
    clears.push({ x0: x - 1.5 * s, x1: x + 1.5 * s, z0: z - 1.5 * s, z1: z + 1.5 * s });
  };

  /* ================= EL ARCO DE LOS ORCOS =================
     Dos torres de celosía rojas (postes, travesaños, cruces en X, almenas, tejado a cuatro aguas y pináculo) y entre
     ellas un gran arco de roca volcánica agrietada. cx, cz: centro del vano; ry: orientación (el paso va a lo largo
     de z local); y0: suelo. Se pasa por debajo. */
  const orcArch = ({ cx, cz, ry = 0, y0, span = 13.6 }) => {
    const F = W(cx, y0, cz, ry), red = 0xa8321e, redD = 0x7a2414, redL = 0xc84a2a, hw = span / 2;
    for (const s of [-1, 1]) {
      const tx = s * hw, T = F.sub(tx, 0, 0, 0), w = 2.4, H = 12;
      for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { T.box(px * w / 2, H / 2, pz * w / 2, 0.3, H, 0.3, red); T.box(px * w / 2, 0.35, pz * w / 2, 0.5, 0.7, 0.5, redD); }
      for (let y = 1.6; y < H; y += 2.1) {
        for (const pz of [-1, 1]) T.box(0, y, pz * w / 2, w + 0.2, 0.22, 0.24, redL);
        for (const px of [-1, 1]) T.box(px * w / 2, y, 0, 0.24, 0.22, w + 0.2, redL);
        if (y + 2.1 < H) for (const pz of [-1, 1]) for (const d of [-1, 1]) T.box(0, y + 1.05, pz * w / 2, 0.12, 2.6, 0.12, redD, { rz: d * 0.72 });
        if (y + 2.1 < H) for (const px of [-1, 1]) for (const d of [-1, 1]) T.box(px * w / 2, y + 1.05, 0, 0.12, 2.6, 0.12, redD, { rx: d * 0.72 });
      }
      T.box(0, H / 2, 0, w - 0.3, H, w - 0.3, 0x3a1a12);                       // interior oscuro
      T.box(0, H + 0.15, 0, w + 0.7, 0.3, w + 0.7, red);                        // remate
      for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) T.box(px * (w / 2 + 0.2), H + 0.55, pz * (w / 2 + 0.2), 0.35, 0.55, 0.35, red);
      T.put(gCone, 0, H + 1.6, 0, 1.75, 1.9, 1.75, redD, { ry: Math.PI / 4 });
      T.box(0, H + 2.9, 0, 0.18, 1.2, 0.18, red);
      T.put(gCone, 0, H + 3.75, 0, 0.32, 0.9, 0.32, redL);
      for (const d of [-1, 1]) T.put(gCone, d * 0.25, H + 3.1, 0, 0.12, 0.5, 0.12, redL, { rz: -d * 0.9 });
      T.cyl(0, H + 0.45, 0, 0.5, 0.3, 0x2a1a14);
      flame(T.pt(0, H + 0.7, 0), 1.0);
      solidRect(T, -w / 2 - 0.2, w / 2 + 0.2, -w / 2 - 0.2, w / 2 + 0.2, -0.5, H + 0.6, 'pillar');
      // pie de piedras volcánicas
      for (let i = 0; i < 7; i++) { const a = R2.range(0, TAU), d = R2.range(1.4, 2.4); const p = T.pt(Math.cos(a) * d, 0, Math.sin(a) * d); lavaRockAt(p.x, y0 + R2.range(0.1, 0.35), p.z, R2.range(0.35, 0.7), R2.range(0.3, 0.55), R2.range(0.35, 0.7)); }
    }
    // las patas de roca del arco (pegadas a las torres) y la gran masa de roca de arriba
    for (const s of [-1, 1]) {
      for (let k = 0; k < 4; k++) { const p = F.pt(s * (hw - 1.9 + R2.range(-0.2, 0.25)), 0, R2.range(-0.4, 0.4)); lavaRockAt(p.x, y0 + 1.0 + k * 1.9, p.z, R2.range(1.0, 1.3), R2.range(1.1, 1.4), R2.range(0.95, 1.2), undefined, 0.2); }
      const p = F.pt(s * (hw - 1.6), 0, 0);
      K.solid(Math.min(p.x, F.pt(s * (hw - 3.0), 0, 0).x) - 0.3, Math.max(p.x, F.pt(s * (hw - 3.0), 0, 0).x) + 0.3, y0 - 1, y0 + 8, p.z - 1.3, p.z + 1.3, 'rock');
    }
    for (let i = 0; i < 9; i++) { const t = i / 8, p = F.pt(-hw + 1.6 + t * (span - 3.2), 0, R2.range(-0.5, 0.5)); lavaRockAt(p.x, y0 + 8.9 + Math.sin(t * Math.PI) * 1.3 + R2.range(-0.3, 0.3), p.z, R2.range(1.2, 1.7), R2.range(1.0, 1.4), R2.range(1.1, 1.5), undefined, 0.3); }
    for (let i = 0; i < 4; i++) { const p = F.pt(R2.range(-hw + 3, hw - 3), 0, R2.range(-0.3, 0.3)); lavaRockAt(p.x, y0 + 11.0 + R2.range(0, 0.8), p.z, R2.range(0.8, 1.2), R2.range(0.9, 1.6), R2.range(0.8, 1.1), undefined, 0.4); }
    { const a = F.pt(-hw + 2, 0, -1.6), b = F.pt(hw - 2, 0, 1.6); K.solid(Math.min(a.x, b.x), Math.max(a.x, b.x), y0 + 7.6, y0 + 12.5, Math.min(a.z, b.z), Math.max(a.z, b.z), 'rock'); }
    light(F.pt(0, 7.5, 0), 0xff5a14, 14, 16);
    clearRect(F, -hw - 1.6, hw + 1.6, -2.4, 2.4);
  };

  /* ================= FINAL: se dibuja todo lo instanciado y los árboles diferidos ================= */
  const finalize = ({ free }) => {
    for (const T of deferred) {
      const big = T.t === 'caido' ? 0.8 : 1.0;
      if (!free(T.x, T.z, big, big)) continue;
      if (clears.some((c) => T.x > c.x0 - 0.8 && T.x < c.x1 + 0.8 && T.z > c.z0 - 0.8 && T.z < c.z1 + 0.8)) continue;
      buildTree(T);
    }
    const mobile = K.mobile;
    for (const [name, list, shadow] of [['arbolseco_lo', lists.seco, !mobile], ['arbolfuego_lo', lists.fuego, !mobile], ['cristal_lo', lists.crys, false], ['rocas_lo', lists.rocas, !mobile]]) {
      const m = propInstances(name, list, { shadow });
      if (m) scene.add(m);
    }
    const mats = {
      rock: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.22, flatShading: true }),
      vrock: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.0, flatShading: true }),
      lava: lavaRockMaterial(),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    };
    rockBatch.build(scene, mats, { glow: { cast: false, receive: false }, rock: { cast: !mobile }, vrock: { cast: !mobile }, lava: { cast: !mobile } });
    // candidatos y coleccionables que quedaban dentro de los objetos nuevos se descartan
    const inClear = (x, z) => clears.some((c) => x > c.x0 - 0.3 && x < c.x1 + 0.3 && z > c.z0 - 0.3 && z < c.z1 + 0.3);
    for (let i = K.cands.length - 1; i >= 0; i--) { const c = K.cands[i]; if ((c.type === 'street' || c.type === 'clearing') && inClear(c.x, c.z)) K.cands.splice(i, 1); }
    return { inClear };
  };

  const treeNear = (x, z, r) => deferred.some((T) => Math.hypot(T.x - x, T.z - z) < r);
  return { R, R2, treeNear, lavaFormation, orcArch, tree, crystalInst, crystalCluster, crackAt, lavaRock, house, gasStation, hydrant, booth, dumpster, bin, cave, volcano, finalize, clears };
}

/* ======================================================================
   ERUPCIÓN (runtime): fuente de lava, bombas, chorros, columna de humo, resplandor y luz
   ====================================================================== */
export const FXT = { value: 0 };
const SMOKE_VS = `attribute float aSize; attribute float aAlpha; attribute float aHeat; attribute float aSeed;
uniform float uScale; uniform float uFogD; varying float vA; varying float vHeat; varying float vSeed; varying float vFog;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float d = max(-mv.z, 1.0);
  float ps = aSize * uScale / d; gl_PointSize = min(ps, 1000.0); vA = aAlpha * (1.0 - smoothstep(650.0, 1000.0, ps)); vHeat = aHeat; vSeed = aSeed; float f = d * uFogD; vFog = 1.0 - exp(-f * f); }`;
const SMOKE_FS = `uniform vec3 uFogC; varying float vA; varying float vHeat; varying float vSeed; varying float vFog;
float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main(){ vec2 p = gl_PointCoord - 0.5; float r = length(p);
  float nn = n(p * 4.0 + vSeed * 13.0) * 0.6 + n(p * 9.0 - vSeed * 7.0) * 0.4;
  float a = smoothstep(0.5, 0.15, r + (nn - 0.5) * 0.3); if (a < 0.01) discard;
  vec3 smoke = mix(vec3(0.06, 0.05, 0.05), vec3(0.22, 0.19, 0.18), clamp(nn * 0.9 - p.y * 0.8, 0.0, 1.0));
  vec3 hot = vec3(1.0, 0.36, 0.08) * (0.7 + nn * 0.6);
  vec3 col = mix(smoke, hot, clamp(vHeat * (0.55 + p.y * 1.2), 0.0, 1.0));
  col = mix(col, uFogC, vFog * 0.25);
  gl_FragColor = vec4(col, a * vA); }`;

function radialTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Eruption {
  constructor(game, E) {
    this.g = game; this.E = E; this.t = 0;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    const mobile = !!E.mobile;
    // ---- columna de humo (puntos con textura procedural) ----
    const N = this.N = mobile ? 90 : 150;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 3); this.size = new Float32Array(N); this.alpha = new Float32Array(N); this.heat = new Float32Array(N); this.seed = new Float32Array(N);
    this.p = Array.from({ length: N }, (_, i) => ({ age: 1e9, life: 1, vy: 0, s0: 1, dx: 0, dz: 0, x: 0, y: 0, z: 0 }));
    for (let i = 0; i < N; i++) this.seed[i] = Math.random();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aHeat', new THREE.BufferAttribute(this.heat, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    const fog = game.scene.fog;
    this.smokeMat = new THREE.ShaderMaterial({ uniforms: { uScale: { value: 400 }, uFogD: { value: fog ? fog.density : 0 }, uFogC: { value: fog ? fog.color.clone() : new THREE.Color(0x3e241e) } }, vertexShader: SMOKE_VS, fragmentShader: SMOKE_FS, transparent: true, depthWrite: false });
    this.smoke = new THREE.Points(geo, this.smokeMat);
    this.smoke.frustumCulled = false; this.smoke.renderOrder = 5;
    this.group.add(this.smoke);
    // precarga: la columna ya está formada al empezar
    for (let k = 0; k < N; k++) { this.spawnSmoke(k); const P = this.p[k], T = P.life * (k / N); for (let s = 0; s < T; s += 0.5) this.stepSmoke(P, 0.5); }
    this.emitAcc = 0;
    // ---- bombas de lava (instanciadas, estiradas según la velocidad) ----
    const B = this.NB = mobile ? 90 : 170;
    this.bombs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), B);
    this.bombs.frustumCulled = false;
    this.b = Array.from({ length: B }, () => ({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1 }));
    const col = new THREE.Color();
    for (let i = 0; i < B; i++) { col.setRGB(1.1 + Math.random() * 0.6, 0.22 + Math.random() * 0.38, 0.03 + Math.random() * 0.05); this.bombs.setColorAt(i, col); this.bombs.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); }
    this.group.add(this.bombs);
    this.bombAcc = 0;
    // ---- chorros de la fuente de lava (conos aditivos) ----
    const jm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 0.32, 0.05), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const jg = new THREE.ConeGeometry(1, 1, 10, 1, true); jg.translate(0, 0.5, 0); jg.rotateX(Math.PI);  jg.translate(0, 1, 0);
    this.jets = [0, 1, 2, 3].map((i) => { const m = new THREE.Mesh(jg, jm); m.position.set(E.x + (i - 1.5) * 1.6, E.y, E.z + (i % 2 ? 1.2 : -1.2)); m.renderOrder = 4; this.group.add(m); return m; });
    // ---- resplandor del cráter (visible desde todo el mapa) ----
    const tex = radialTexture();
    this.glows = [[46, 0.7, 5], [110, 0.22, 14], [24, 0.8, 2]].map(([s, o, y]) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(1.0, 0.34, 0.07), blending: THREE.AdditiveBlending, transparent: true, opacity: o, depthWrite: false, toneMapped: false, fog: false })); sp.scale.set(s, s, 1); sp.position.set(E.x, E.y + y, E.z); sp.renderOrder = 6; sp.userData.o = o; this.group.add(sp); return sp; });
    // ---- luz de la erupción ----
    this.light = new THREE.PointLight(0xff6a20, 0, 200, 1.4);
    this.light.position.set(E.x, E.y + 14, E.z);
    this.group.add(this.light);
    this.burst = 0; this.nextBurst = 3;
    this.m4 = new THREE.Matrix4(); this.qq = new THREE.Quaternion(); this.vv = new THREE.Vector3(); this.ss = new THREE.Vector3(); this.pp = new THREE.Vector3();
  }
  spawnSmoke(i, strong = false) {
    const E = this.E, P = this.p[i];
    P.age = 0; P.life = (strong ? 24 : 30) + Math.random() * 10;
    P.x = E.x + (Math.random() - 0.5) * 6; P.y = E.y + 3 + Math.random() * 3; P.z = E.z + (Math.random() - 0.5) * 6;
    P.vy = (strong ? 10 : 6.5) + Math.random() * 2.5; P.s0 = 10 + Math.random() * 6;
    P.dx = 1.1 + Math.random() * 0.8; P.dz = 0.6 + Math.random() * 0.6; P.sp = (Math.random() - 0.5) * 2;
  }
  stepSmoke(P, dt) {
    P.age += dt;
    P.y += P.vy * dt; P.vy = Math.max(1.0, P.vy - dt * 0.35);
    const k = Math.min(1, P.age / 14);
    P.x += (P.dx * k + Math.sin(P.age * 0.3 + P.sp) * 0.5) * dt; P.z += (P.dz * k) * dt;
  }
  update(dt) {
    const E = this.E, g = this.g, cam = g.camera.position, fx = g.fx;
    this.t += dt; FXT.value = this.t;
    const t = this.t;
    // pulsos de la erupción
    this.nextBurst -= dt;
    if (this.nextBurst <= 0) { this.burst = 1.6; this.nextBurst = 5 + Math.random() * 5; const dc = Math.hypot(cam.x - E.x, cam.z - E.z); if (dc < 170) g.chase.shake(0.025 * (1 - dc / 170)); }
    this.burst = Math.max(0, this.burst - dt);
    const bk = this.burst > 0 ? 1 : 0;
    // humo
    const r = g.renderer, h = r ? r.domElement.height : 720;
    this.smokeMat.uniforms.uScale.value = h / (2 * Math.tan((g.camera.fov * Math.PI / 180) / 2));
    this.emitAcc += dt * (this.N / 32) * (bk ? 2.2 : 1);
    for (let i = 0; i < this.N; i++) {
      const P = this.p[i];
      if (P.age >= P.life && this.emitAcc >= 1) { this.emitAcc -= 1; this.spawnSmoke(i, bk); }
      if (P.age < P.life) this.stepSmoke(P, dt);
      const k = P.age / P.life, alive = P.age < P.life;
      this.pos[i * 3] = P.x; this.pos[i * 3 + 1] = P.y; this.pos[i * 3 + 2] = P.z;
      this.size[i] = alive ? P.s0 + P.age * 2.2 : 0;
      this.alpha[i] = alive ? Math.min(1, P.age / 1.5) * Math.min(1, (1 - k) * 3) * 0.94 : 0;
      this.heat[i] = Math.exp(-P.age / 3.5);
    }
    this.emitAcc = Math.min(this.emitAcc, 4);
    const ga = this.smoke.geometry.attributes;
    ga.position.needsUpdate = ga.aSize.needsUpdate = ga.aAlpha.needsUpdate = ga.aHeat.needsUpdate = true;
    // bombas de lava
    this.bombAcc += dt * (bk ? 120 : 16);
    const near = Math.hypot(cam.x - E.x, cam.z - E.z) < 140;
    for (let i = 0; i < this.NB; i++) {
      const b = this.b[i];
      if (!b.on && this.bombAcc >= 1) {
        this.bombAcc -= 1;
        const a = Math.random() * Math.PI * 2, sp = (bk ? 4 : 2) + Math.random() * (bk ? 10 : 6);
        b.on = true; b.x = E.x + (Math.random() - 0.5) * 4; b.y = E.y + 1; b.z = E.z + (Math.random() - 0.5) * 4;
        b.vx = Math.cos(a) * sp; b.vz = Math.sin(a) * sp; b.vy = (bk ? 26 : 18) + Math.random() * (bk ? 16 : 14); b.s = 0.22 + Math.random() * (bk ? 0.6 : 0.38);
      }
      if (!b.on) continue;
      b.vy -= 21 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.vy < 0 && b.y < terrainH(b.x, b.z) + 0.3) {
        b.on = false;
        if (near && Math.random() < 0.5) { fx.flame(b.x, b.y, b.z, 1.2, 0.3); if (Math.random() < 0.4) fx.smokePuff(b.x, b.y + 0.5, b.z, 2.2, 0x3a3230); }
        this.bombs.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
        continue;
      }
      this.vv.set(b.vx, b.vy, b.vz); const sp = this.vv.length(); this.vv.divideScalar(sp || 1);
      this.qq.setFromUnitVectors(UP, this.vv);
      this.ss.set(b.s, b.s * (1 + sp * 0.07), b.s);
      this.bombs.setMatrixAt(i, this.m4.compose(this.pp.set(b.x, b.y, b.z), this.qq, this.ss));
    }
    this.bombAcc = Math.min(this.bombAcc, 6);
    this.bombs.instanceMatrix.needsUpdate = true;
    // chorros
    this.jets.forEach((j, i) => { const hh = (bk ? 16 : 7) + 4 * Math.sin(t * 3.1 + i * 1.7) + 3 * Math.sin(t * 7.3 + i); j.scale.set(1.3 + 0.4 * Math.sin(t * 5 + i), Math.max(2, hh), 1.3 + 0.4 * Math.cos(t * 4 + i)); j.rotation.set(0.12 * Math.sin(t * 1.3 + i), 0, 0.12 * Math.cos(t * 1.1 + i * 2)); });
    // resplandor y luz
    const fl = 0.85 + 0.1 * Math.sin(t * 6.3) + 0.06 * Math.sin(t * 15.7) + bk * 0.35;
    this.glows.forEach((s) => { s.material.opacity = s.userData.o * fl; });
    this.light.intensity = 260 * fl;
    // el cráter escupe llamas y humo cuando la cámara está cerca
    if (near && Math.random() < dt * (bk ? 14 : 5)) fx.flame(E.x + (Math.random() - 0.5) * 8, E.y + 1, E.z + (Math.random() - 0.5) * 8, 2.4, 0.4);
  }
  dispose() { if (this.group.parent) this.group.parent.remove(this.group); }
}
