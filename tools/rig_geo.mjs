// Auto-rigging con pesos GEODÉSICOS (distancia medida sobre la superficie de la malla, no en línea recta).
// Pensado para modelos con partes finas muy próximas entre sí que no deben mezclarse al moverse
// (p. ej. el Fénix Oscuro: las plumas bajas del ala casi tocan las plumas de la cola).
// Uso: node rig_geo.mjs MODELO.glb ESPECIFICACION.json SALIDA.glb
// La especificación da la POSICIÓN de cada articulación (como tools/rig.mjs). La jerarquía sale de tools/rigspec.js
// y, para cadenas con nombre ("chains": ["tail_c", ...]), NOMBRE_1 cuelga de root, NOMBRE_k de NOMBRE_(k-1)
// y NOMBRE_end del último eslabón. Huesos sin rotación de reposo (mismo convenio que el resto de modelos del juego).
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { buildParents, primaryChild, groupOf } from './rigspec.js';

const [, , input, specPath, output] = process.argv;
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const J = spec.joints;
const extra = [...(spec.extra || [])];
for (const c of spec.chains || []) {
  for (let k = 1; J[`${c}_${k}`]; k++) {
    extra.push({ name: `${c}_${k}`, parent: k === 1 ? (spec.chainParent?.[c] || 'root') : `${c}_${k - 1}` });
    if (!J[`${c}_${k + 1}`] && J[`${c}_end`]) extra.push({ name: `${c}_end`, parent: `${c}_${k}` });
  }
}
const P = buildParents(J, extra);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const mesh = root.listMeshes()[0];
const prim = mesh.listPrimitives()[0];
const PA = prim.getAttribute('POSITION').getArray();
const NV = PA.length / 3;
const IA = prim.getIndices().getArray();

// --- huesos en orden (padres antes que hijos) ---
const names = Object.keys(J).filter((n) => n === 'root' || P[n]);
const order = [], seen = new Set();
const visit = (n) => { if (seen.has(n)) return; if (P[n]) visit(P[n]); seen.add(n); order.push(n); };
names.forEach(visit);
const NB = order.length;
const seg = order.map((n) => { const c = primaryChild(n, P); return c ? { a: J[n], b: J[c] } : null; });
const RAD = { core: 0.05, leg: 0.03, arm: 0.035, tail: 0.04, wing: 0.06, ear: 0.03 };
const radius = order.map((n) => (spec.radius && spec.radius[n]) || (RAD[groupOf(n)] ?? 0.04));

// --- vértices soldados por posición (las costuras de UV parten la malla; la conectividad real es la de la superficie) ---
const wid = new Int32Array(NV), uniq = [], key = new Map();
for (let v = 0; v < NV; v++) {
  const k = `${Math.round(PA[v * 3] * 1e5)},${Math.round(PA[v * 3 + 1] * 1e5)},${Math.round(PA[v * 3 + 2] * 1e5)}`;
  if (!key.has(k)) { key.set(k, uniq.length); uniq.push(v); }
  wid[v] = key.get(k);
}
const NU = uniq.length;
const UP = new Float32Array(NU * 3);
uniq.forEach((v, i) => { UP[i * 3] = PA[v * 3]; UP[i * 3 + 1] = PA[v * 3 + 1]; UP[i * 3 + 2] = PA[v * 3 + 2]; });
const nbrSet = Array.from({ length: NU }, () => new Set());
for (let t = 0; t < IA.length; t += 3) {
  const a = wid[IA[t]], b = wid[IA[t + 1]], c = wid[IA[t + 2]];
  nbrSet[a].add(b).add(c); nbrSet[b].add(a).add(c); nbrSet[c].add(a).add(b);
}
const nbr = nbrSet.map((s, i) => [...s].filter((x) => x !== i));
const elen = (a, b) => Math.hypot(UP[a * 3] - UP[b * 3], UP[a * 3 + 1] - UP[b * 3 + 1], UP[a * 3 + 2] - UP[b * 3 + 2]);
const dSeg = (i, s) => {
  const px = UP[i * 3], py = UP[i * 3 + 1], pz = UP[i * 3 + 2];
  const ax = s.a[0], ay = s.a[1], az = s.a[2], bx = s.b[0] - ax, by = s.b[1] - ay, bz = s.b[2] - az;
  const l2 = bx * bx + by * by + bz * bz || 1e-12;
  const t = Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by + (pz - az) * bz) / l2));
  return Math.hypot(px - (ax + bx * t), py - (ay + by * t), pz - (az + bz * t));
};

// --- Dijkstra multi-fuente por hueso: semillas = vértices pegados a su segmento, coste inicial = distancia recta ---
class Heap {
  constructor() { this.k = []; this.v = []; this.lastK = 0; }
  get size() { return this.k.length; }
  push(k, v) { const K = this.k, V = this.v; let i = K.length; K.push(k); V.push(v); while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= k) break; K[i] = K[p]; V[i] = V[p]; i = p; } K[i] = k; V[i] = v; }
  pop() {
    const K = this.k, V = this.v, top = V[0]; this.lastK = K[0];
    const lk = K.pop(), lv = V.pop();
    if (K.length) { let i = 0; const n = K.length; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && K[c + 1] < K[c]) c++; if (K[c] >= lk) break; K[i] = K[c]; V[i] = V[c]; i = c; } K[i] = lk; V[i] = lv; }
    return top;
  }
}
// REGLAS (spec.rules): un hueso no puede influir en vértices fuera de su zona
//   · lado: los huesos _L / de cadenas "l*" solo a la izquierda (+X) y los _R / "r*" solo a la derecha (margen spec.sideMargin)
//   · rules: { "prefijo": { "minY": .., "maxY": .. } } por prefijo de nombre de hueso
const midX = J.root[0], sideM = spec.sideMargin ?? 0.03;
const sideB = order.map((n) => (/_L(_|$)/.test(n) ? 1 : /_R(_|$)/.test(n) ? -1 : /^tail_l/.test(n) ? 1 : /^tail_r/.test(n) ? -1 : 0));
const ruleB = order.map((n) => { let r = null; for (const [pre, v] of Object.entries(spec.rules || {})) if (n.startsWith(pre)) r = v; return r; });
const allowed = (i, b) => {
  const x = UP[i * 3] - midX, y = UP[i * 3 + 1];
  if (sideB[b] && x * sideB[b] < -sideM) return false;
  const r = ruleB[b];
  if (r && ((r.minY !== undefined && y < r.minY) || (r.maxY !== undefined && y > r.maxY))) return false;
  if (r && r.minSideX !== undefined && sideB[b] && x * sideB[b] < r.minSideX) return false; // p. ej. las alas no tocan el centro del cuerpo
  // excl: cajas prohibidas [|x| mín, |x| máx, y mín, y máx] (p. ej. la cresta de la cabeza para las alas)
  if (r && r.excl) { const ax = Math.abs(x); for (const e of r.excl) if (ax >= e[0] && ax <= e[1] && y >= e[2] && y <= e[3]) return false; }
  return true;
};
// La geodésica se limita a los vértices permitidos (el camino no puede atajar por la zona de otro hueso). Si una isla
// de malla queda mal conectada, se usa como respaldo la distancia recta multiplicada por spec.euclidK.
const euclidK = spec.euclidK ?? 3;
const D = [];
let fallback = 0;
for (let b = 0; b < NB; b++) {
  if (!seg[b]) { D.push(null); continue; }
  const d0 = new Float32Array(NU); let dmin = Infinity;
  for (let i = 0; i < NU; i++) { d0[i] = allowed(i, b) ? dSeg(i, seg[b]) : Infinity; if (d0[i] < dmin) dmin = d0[i]; }
  const seedR = Math.max(dmin * 1.3, dmin + (spec.seedSlack ?? 0.012));
  const dist = new Float32Array(NU).fill(Infinity), h = new Heap();
  for (let i = 0; i < NU; i++) if (d0[i] <= seedR) { dist[i] = d0[i]; h.push(d0[i], i); }
  while (h.size) { const u = h.pop(), du = h.lastK; if (du > dist[u]) continue; for (const w of nbr[u]) { if (d0[w] === Infinity) continue; const nd = du + elen(u, w); if (nd < dist[w]) { dist[w] = nd; h.push(nd, w); } } }
  for (let i = 0; i < NU; i++) if (d0[i] !== Infinity && d0[i] * euclidK < dist[i]) { dist[i] = d0[i] * euclidK; fallback++; }
  D.push(dist);
}
console.log(`respaldo por distancia recta: ${fallback} pares vértice-hueso`);

// --- pesos: inversa de la distancia geodésica normalizada por el radio del hueso; los 4 más fuertes ---
const power = spec.power ?? 3;
let Wt = new Float32Array(NU * NB);
const keep4 = (row, out) => {
  const idx = []; for (let b = 0; b < NB; b++) if (row[b] > 1e-6) idx.push(b);
  idx.sort((x, y) => row[y] - row[x]); const top = idx.slice(0, 4); let s = 0; for (const b of top) s += row[b];
  out.fill(0); for (const b of top) out[b] = row[b] / (s || 1);
};
const tmp = new Float32Array(NB);
for (let i = 0; i < NU; i++) {
  for (let b = 0; b < NB; b++) tmp[b] = D[b] && isFinite(D[b][i]) ? 1 / (Math.pow(D[b][i] / radius[b], power) + 1e-4) : 0;
  keep4(tmp, Wt.subarray(i * NB, i * NB + NB));
}
// --- suavizado entre vecinos de la superficie ---
for (let it = 0; it < (spec.smooth ?? 3); it++) {
  const nx = new Float32Array(NU * NB);
  for (let i = 0; i < NU; i++) {
    for (let b = 0; b < NB; b++) tmp[b] = Wt[i * NB + b];
    const ns = nbr[i];
    if (ns.length) for (const w of ns) for (let b = 0; b < NB; b++) tmp[b] += Wt[w * NB + b] / ns.length;
    keep4(tmp, nx.subarray(i * NB, i * NB + NB));
  }
  Wt = nx;
}

// --- JOINTS_0 / WEIGHTS_0 (todas las copias de un vértice soldado comparten pesos: sin grietas en las costuras) ---
const J0 = new Uint16Array(NV * 4), W0 = new Float32Array(NV * 4);
const usage = new Float32Array(NB);
for (let v = 0; v < NV; v++) {
  const row = Wt.subarray(wid[v] * NB, wid[v] * NB + NB);
  const idx = []; for (let b = 0; b < NB; b++) if (row[b] > 1e-5) idx.push(b);
  idx.sort((x, y) => row[y] - row[x]);
  let s = 0;
  for (let k = 0; k < 4 && k < idx.length; k++) { J0[v * 4 + k] = idx[k]; W0[v * 4 + k] = row[idx[k]]; s += row[idx[k]]; }
  if (s <= 0) { J0[v * 4] = 0; W0[v * 4] = 1; s = 1; }
  for (let k = 0; k < 4; k++) { W0[v * 4 + k] /= s; usage[J0[v * 4 + k]] += W0[v * 4 + k]; }
}
// CORTE ENTRE GRUPOS (spec.cut): donde dos partes que se mueven por separado se tocan y la malla las une (p. ej. las
// plumas bajas del ala sobre la punta curvada de la cola), los triángulos de la frontera se estirarían como láminas.
// Cada vértice se queda solo con los huesos de su grupo dominante y cada triángulo de la frontera pasa ENTERO al grupo
// de la mayoría: sus vértices del otro lado se duplican con los pesos de ese grupo → se separan limpiamente.
// spec.cut = { "groups": { "WL": ["wing_L"], "T": ["tail_"] }, "apart": [["WL", "T"]] }
let J0o = J0, W0o = W0;
if (spec.cut) {
  const grpOf = (n) => { for (const [g, pres] of Object.entries(spec.cut.groups)) if (pres.some((p) => n.startsWith(p))) return g; return null; };
  const grpB = order.map(grpOf);
  const apartSet = new Set(spec.cut.apart.flatMap(([a, b]) => [a + '|' + b, b + '|' + a]));
  const apart = (a, b) => !!a && !!b && a !== b && apartSet.has(a + '|' + b);
  const domOf = (v) => { let b = 0; for (let k = 1; k < 4; k++) if (W0[v * 4 + k] > W0[v * 4 + b]) b = k; return grpB[J0[v * 4 + b]]; };
  for (let v = 0; v < NV; v++) {
    const d = domOf(v); let s = 0;
    for (let k = 0; k < 4; k++) { if (W0[v * 4 + k] > 0 && apart(d, grpB[J0[v * 4 + k]])) W0[v * 4 + k] = 0; s += W0[v * 4 + k]; }
    if (s > 0) for (let k = 0; k < 4; k++) W0[v * 4 + k] /= s;
  }
  const dom = Array.from({ length: NV }, (_, v) => domOf(v));
  const idxArr = Array.from(IA);
  const dup = new Map(), extraV = [];
  let cut = 0;
  for (let t = 0; t < idxArr.length; t += 3) {
    const vs = [idxArr[t], idxArr[t + 1], idxArr[t + 2]], gs = vs.map((v) => dom[v]);
    if (!(apart(gs[0], gs[1]) || apart(gs[1], gs[2]) || apart(gs[0], gs[2]))) continue;
    const count = {}; gs.forEach((g) => { count[g] = (count[g] || 0) + 1; });
    const own = Object.keys(count).sort((x, y) => count[y] - count[x])[0];
    const src = vs[gs.map(String).indexOf(own)];
    for (let k = 0; k < 3; k++) {
      if (String(gs[k]) === own || !apart(gs[k], dom[src])) continue;
      const key = vs[k] + ':' + src;
      if (!dup.has(key)) { dup.set(key, NV + extraV.length); extraV.push({ from: vs[k], w: src }); }
      idxArr[t + k] = dup.get(key);
    }
    cut++;
  }
  if (extraV.length) {
    const NE = NV + extraV.length;
    for (const sem of prim.listSemantics()) {
      const acc = prim.getAttribute(sem), arr = acc.getArray(), es = acc.getElementSize();
      const out = new arr.constructor(NE * es); out.set(arr);
      extraV.forEach((e, i) => { for (let c = 0; c < es; c++) out[(NV + i) * es + c] = arr[e.from * es + c]; });
      acc.setArray(out);
    }
    J0o = new Uint16Array(NE * 4); J0o.set(J0); W0o = new Float32Array(NE * 4); W0o.set(W0);
    extraV.forEach((e, i) => { for (let c = 0; c < 4; c++) { J0o[(NV + i) * 4 + c] = J0[e.w * 4 + c]; W0o[(NV + i) * 4 + c] = W0[e.w * 4 + c]; } });
    prim.getIndices().setArray(NE > 65535 ? new Uint32Array(idxArr) : new Uint16Array(idxArr));
  }
  console.log(`corte entre grupos: ${cut} triángulos, ${extraV.length} vértices duplicados`);
}
const buffer = root.listBuffers()[0];
prim.setAttribute('JOINTS_0', doc.createAccessor('JOINTS_0').setType('VEC4').setArray(J0o).setBuffer(buffer));
prim.setAttribute('WEIGHTS_0', doc.createAccessor('WEIGHTS_0').setType('VEC4').setArray(W0o).setBuffer(buffer));

// --- nodos de hueso, jerarquía y skin ---
const nodes = {};
for (const n of order) { const p = P[n], wp = J[n], pp = p ? J[p] : [0, 0, 0]; nodes[n] = doc.createNode(n).setTranslation([wp[0] - pp[0], wp[1] - pp[1], wp[2] - pp[2]]); }
for (const n of order) if (P[n]) nodes[P[n]].addChild(nodes[n]);
root.listScenes()[0].addChild(nodes.root);
const skin = doc.createSkin('rig');
const ibm = new Float32Array(NB * 16);
order.forEach((n, i) => { skin.addJoint(nodes[n]); ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -J[n][0], -J[n][1], -J[n][2], 1], i * 16); });
skin.setInverseBindMatrices(doc.createAccessor('ibm').setType('MAT4').setArray(ibm).setBuffer(buffer));
skin.setSkeleton(nodes.root);
const meshNode = root.listNodes().find((nd) => nd.getMesh() === mesh);
meshNode.setSkin(skin);
const mt = meshNode.getMatrix(), ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
if (mt.some((x, i) => Math.abs(x - ident[i]) > 1e-4)) console.warn('AVISO: el nodo de la malla tiene transformación; revisa que las articulaciones estén en su espacio local');
await io.write(output, doc);
console.log(`rig geodésico: ${NB} huesos, ${NV} vértices (${NU} soldados) ->`, output);
console.log('peso por hueso:', order.map((n, i) => `${n}:${Math.round(usage[i])}`).join(' '));
