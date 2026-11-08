// Auto-rigging: construye el esqueleto, calcula los pesos de piel y escribe un GLB con rig.
// Uso: node rig.mjs MODELO.glb ESPECIFICACION.json SALIDA.glb
// La especificación solo da la posición (x,y,z) de cada articulación; la jerarquía sale de tools/rigspec.js.
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { buildParents, primaryChild, sideOf, groupOf } from './rigspec.js';
import { applyRigidFace } from './faceFix.mjs';

const [, , input, specPath, output] = process.argv;
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const J = spec.joints;
const extra = spec.extra || [];
const P = buildParents(J, extra);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const mesh = root.listMeshes()[0];
const prim = mesh.listPrimitives()[0];
const POS = prim.getAttribute('POSITION');
const NV = POS.getCount();
const IDX = prim.getIndices();

// --- huesos en orden (padres antes que hijos) ---
const names = Object.keys(J).filter((n) => n === 'root' || P[n]);
const order = [];
const seen = new Set();
const visit = (n) => { if (seen.has(n)) return; if (P[n]) visit(P[n]); seen.add(n); order.push(n); };
names.forEach(visit);
const idxOf = Object.fromEntries(order.map((n, i) => [n, i]));
const NB = order.length;

// --- segmentos para los pesos: articulación → articulación hija principal ---
const seg = order.map((n) => {
  const a = J[n];
  const c = primaryChild(n, P);
  let b = c ? J[c] : null;
  if (!b) return null; // huesos finales: no aportan pesos
  let a2 = a;
  if (n === 'root') a2 = [a[0], a[1] - (spec.pelvisDrop ?? 0.07), a[2]]; // la pelvis queda por debajo del hueso raíz
  return { a: a2, b };
});
const scaleOf = (n) => (spec.radius && spec.radius[n]) || (groupOf(n) === 'core' ? 0.11 : groupOf(n) === 'leg' ? 0.075 : groupOf(n) === 'arm' ? 0.06 : groupOf(n) === 'tail' ? 0.07 : groupOf(n) === 'wing' ? 0.09 : 0.05);
const radius = order.map(scaleOf);
const group = order.map(groupOf);
const side = order.map(sideOf);
const midX = J.root[0];
const hipY = Math.max(...['thigh_L', 'thigh_R'].filter((n) => J[n]).map((n) => J[n][1]), -1);

// --- pesos por proximidad con reglas ---
const pv = [0, 0, 0];
const W = new Float32Array(NV * NB);
const pos = new Float32Array(NV * 3);
for (let v = 0; v < NV; v++) { POS.getElement(v, pv); pos[v * 3] = pv[0]; pos[v * 3 + 1] = pv[1]; pos[v * 3 + 2] = pv[2]; }
const dist2Seg = (px, py, pz, s) => {
  const ax = s.a[0], ay = s.a[1], az = s.a[2], bx = s.b[0] - ax, by = s.b[1] - ay, bz = s.b[2] - az;
  const l2 = bx * bx + by * by + bz * bz || 1e-9;
  let t = ((px - ax) * bx + (py - ay) * by + (pz - az) * bz) / l2;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + bx * t), dy = py - (ay + by * t), dz = pz - (az + bz * t);
  return dx * dx + dy * dy + dz * dz;
};
const power = spec.power ?? 3;
for (let v = 0; v < NV; v++) {
  const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
  const raw = new Float32Array(NB);
  for (let b = 0; b < NB; b++) {
    if (!seg[b]) continue;
    let d = Math.sqrt(dist2Seg(px, py, pz, seg[b])) / radius[b];
    const sd = side[b];
    if (sd !== 0 && group[b] !== 'wing') { const dx = (px - midX) * sd; if (dx < -0.03) d *= 1 + Math.min(4, (-dx - 0.03) * 40); } // el lado contrario cuesta más
    if (group[b] === 'leg' && py > hipY + 0.02) d *= 1 + (py - hipY) * 14;  // las piernas no capturan la barriga
    if (group[b] === 'arm' && sd !== 0 && py < (spec.armMinY ?? 0.2)) d *= 3; // los brazos no capturan los pies
    raw[b] = 1 / (Math.pow(d, power) + 1e-3);
  }
  // los 4 más fuertes
  const top = [];
  for (let b = 0; b < NB; b++) if (raw[b] > 0) top.push(b);
  top.sort((a, b) => raw[b] - raw[a]);
  let s = 0;
  const keep = top.slice(0, 4);
  for (const b of keep) s += raw[b];
  for (const b of keep) W[v * NB + b] = raw[b] / s;
}

// --- suavizado de pesos entre vértices vecinos (evita saltos bruscos) ---
const nTri = IDX.getCount() / 3;
const adj = Array.from({ length: NV }, () => []);
const tri = [0, 0, 0];
for (let t = 0; t < nTri; t++) {
  const a = IDX.getScalar(t * 3), b = IDX.getScalar(t * 3 + 1), c = IDX.getScalar(t * 3 + 2);
  adj[a].push(b, c); adj[b].push(a, c); adj[c].push(a, b);
}
const iters = spec.smooth ?? 3;
let cur = W;
for (let it = 0; it < iters; it++) {
  const nxt = new Float32Array(NV * NB);
  for (let v = 0; v < NV; v++) {
    const ns = adj[v];
    const tmp = nxt.subarray(v * NB, v * NB + NB);
    for (let b = 0; b < NB; b++) tmp[b] = cur[v * NB + b] * 2;
    for (let k = 0; k < ns.length; k++) { const u = ns[k] * NB; for (let b = 0; b < NB; b++) tmp[b] += cur[u + b] / ns.length * 2 * 0.5; }
    // limitar a 4 y normalizar
    const idx = Array.from({ length: NB }, (_, i) => i).filter((i) => tmp[i] > 1e-4).sort((a, b) => tmp[b] - tmp[a]).slice(0, 4);
    let s = 0; for (const i of idx) s += tmp[i];
    const o = new Float32Array(NB);
    for (const i of idx) o[i] = tmp[i] / s;
    for (let b = 0; b < NB; b++) nxt[v * NB + b] = o[b];
  }
  cur = nxt;
}

// --- atributos JOINTS_0 / WEIGHTS_0 ---
const J0 = new Uint16Array(NV * 4), W0 = new Float32Array(NV * 4);
for (let v = 0; v < NV; v++) {
  const idx = [];
  for (let b = 0; b < NB; b++) if (cur[v * NB + b] > 1e-4) idx.push(b);
  idx.sort((a, b) => cur[v * NB + b] - cur[v * NB + a]);
  let s = 0;
  for (let k = 0; k < 4 && k < idx.length; k++) { J0[v * 4 + k] = idx[k]; W0[v * 4 + k] = cur[v * NB + idx[k]]; s += W0[v * 4 + k]; }
  if (s <= 0) { J0[v * 4] = 0; W0[v * 4] = 1; s = 1; }
  for (let k = 0; k < 4; k++) W0[v * 4 + k] /= s;
}
// cara rígida: los rasgos de la cara no se deforman (tools/faceFix.mjs)
const face = applyRigidFace({ names: order, joints: J, J0, W0, pos, opts: spec.face || {} });
console.log(`cara rígida: ${face.changed} vértices (radio ${face.radius?.toFixed(3)})`);
const buffer = root.listBuffers()[0];
prim.setAttribute('JOINTS_0', doc.createAccessor('JOINTS_0').setType('VEC4').setArray(J0).setBuffer(buffer));
prim.setAttribute('WEIGHTS_0', doc.createAccessor('WEIGHTS_0').setType('VEC4').setArray(W0).setBuffer(buffer));

// --- nodos de hueso, jerarquía y skin ---
const nodes = {};
for (const n of order) {
  const node = doc.createNode(n);
  const p = P[n];
  const wp = J[n], pp = p ? J[p] : [0, 0, 0];
  node.setTranslation([wp[0] - pp[0], wp[1] - pp[1], wp[2] - pp[2]]);
  nodes[n] = node;
}
for (const n of order) if (P[n]) nodes[P[n]].addChild(nodes[n]);
const scene = root.listScenes()[0];
scene.addChild(nodes.root);
const skin = doc.createSkin('rig');
const ibm = new Float32Array(NB * 16);
order.forEach((n, i) => {
  skin.addJoint(nodes[n]);
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -J[n][0], -J[n][1], -J[n][2], 1];
  ibm.set(m, i * 16);
});
skin.setInverseBindMatrices(doc.createAccessor('ibm').setType('MAT4').setArray(ibm).setBuffer(buffer));
skin.setSkeleton(nodes.root);
// el nodo con la malla usa el skin
const meshNode = root.listNodes().find((nd) => nd.getMesh() === mesh);
meshNode.setSkin(skin);
const mt = meshNode.getMatrix();
const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
if (mt.some((x, i) => Math.abs(x - ident[i]) > 1e-4)) console.warn('AVISO: el nodo de la malla tiene transformación; revisa que las articulaciones estén en su espacio local');

await io.write(output, doc);
console.log(`rig: ${NB} huesos, ${NV} vértices ->`, output);
