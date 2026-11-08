// Aplica la cara rígida a un GLB que YA tiene esqueleto (p. ej. los rigs hechos con otra herramienta).
// Uso: node fixface.mjs ENTRADA.glb SALIDA.glb [radioMul=1]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { applyRigidFace } from './faceFix.mjs';

const [, , input, output, mul] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const prim = root.listMeshes()[0].listPrimitives()[0];
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const names = joints.map((j) => j.getName());
// posición de reposo de cada articulación (acumulando las traslaciones de la jerarquía)
const world = {};
const wp = (n) => {
  const t = n.getTranslation();
  const p = n.getParentNode();
  const pp = p && joints.includes(p) ? wp(p) : [0, 0, 0];
  return [pp[0] + t[0], pp[1] + t[1], pp[2] + t[2]];
};
joints.forEach((j) => { world[j.getName()] = wp(j); });
const POS = prim.getAttribute('POSITION'), JA = prim.getAttribute('JOINTS_0'), WA = prim.getAttribute('WEIGHTS_0');
const NV = POS.getCount();
const pos = new Float32Array(NV * 3), J0 = new Uint16Array(NV * 4), W0 = new Float32Array(NV * 4);
const t4 = [0, 0, 0, 0], t3 = [0, 0, 0];
for (let v = 0; v < NV; v++) { POS.getElement(v, t3); pos.set(t3, v * 3); JA.getElement(v, t4); J0.set(t4, v * 4); WA.getElement(v, t4); W0.set(t4, v * 4); }
const r = applyRigidFace({ names, joints: world, J0, W0, pos, opts: { radiusMul: parseFloat(mul || '1') } });
for (let v = 0; v < NV; v++) { JA.setElement(v, [J0[v * 4], J0[v * 4 + 1], J0[v * 4 + 2], J0[v * 4 + 3]]); WA.setElement(v, [W0[v * 4], W0[v * 4 + 1], W0[v * 4 + 2], W0[v * 4 + 3]]); }
await io.write(output, doc);
console.log(`cara rígida: ${r.changed} vértices (radio ${r.radius?.toFixed(3)}) ->`, output);
