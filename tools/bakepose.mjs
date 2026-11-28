// Cambia la pose de reposo de un modelo riggeado en POSE T a brazos caídos (como el resto de héroes del juego):
// gira los brazos con su esqueleto, aplica el skinning a los vértices (posiciones y normales) y guarda la malla SIN
// esqueleto, más la especificación con las articulaciones en su nueva posición (para volver a riggear con rig.mjs).
// Uso: node bakepose.mjs RIG_T.glb SPEC_T.json SALIDA.glb SPEC_SALIDA.json ANGULO
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';

const [, , input, specIn, output, specOut, angArg] = process.argv;
const ANG = Number(angArg || 1.2);
const spec = JSON.parse(fs.readFileSync(specIn, 'utf8'));
const J = spec.joints;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const names = joints.map((j) => j.getName());
const parentOf = new Map();
for (const j of joints) for (const c of j.listChildren()) parentOf.set(c.getName(), j.getName());
// giro de cada hueso (los huesos no tienen rotación de reposo: ejes del personaje)
const ROT = {
  upper_arm_L: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ANG),
  upper_arm_R: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ANG),
};
const world = {};
const getW = (n) => {
  if (world[n]) return world[n];
  const p = parentOf.get(n);
  const pw = p ? getW(p) : new THREE.Matrix4();
  const pj = p ? J[p] : [0, 0, 0];
  const local = new THREE.Matrix4().compose(new THREE.Vector3(J[n][0] - pj[0], J[n][1] - pj[1], J[n][2] - pj[2]), ROT[n] || new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
  return (world[n] = pw.clone().multiply(local));
};
const skinM = names.map((n) => getW(n).clone().multiply(new THREE.Matrix4().makeTranslation(-J[n][0], -J[n][1], -J[n][2])));
const prim = root.listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL');
const JA = prim.getAttribute('JOINTS_0').getArray(), WA = prim.getAttribute('WEIGHTS_0').getArray();
const pa = P.getArray().slice(), na = N ? N.getArray().slice() : null;
const v = new THREE.Vector3(), acc = new THREE.Vector3(), t = new THREE.Vector3(), nacc = new THREE.Vector3(), nm = new THREE.Matrix3();
const nMats = skinM.map((m) => new THREE.Matrix3().getNormalMatrix(m));
for (let i = 0; i < pa.length / 3; i++) {
  v.set(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]); acc.set(0, 0, 0); nacc.set(0, 0, 0);
  for (let k = 0; k < 4; k++) {
    const w = WA[i * 4 + k]; if (!w) continue;
    const b = JA[i * 4 + k];
    acc.addScaledVector(t.copy(v).applyMatrix4(skinM[b]), w);
    if (na) nacc.addScaledVector(t.set(na[i * 3], na[i * 3 + 1], na[i * 3 + 2]).applyMatrix3(nMats[b]), w);
  }
  pa.set([acc.x, acc.y, acc.z], i * 3);
  if (na) { nacc.normalize(); na.set([nacc.x, nacc.y, nacc.z], i * 3); }
}
// costuras de UV: los vértices que estaban en el mismo punto acaban en el mismo punto (sin grietas)
{
  const src = P.getArray(), groups = new Map();
  for (let i = 0; i < src.length / 3; i++) { const k = `${Math.round(src[i * 3] * 1e5)},${Math.round(src[i * 3 + 1] * 1e5)},${Math.round(src[i * 3 + 2] * 1e5)}`; (groups.get(k) || groups.set(k, []).get(k)).push(i); }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    let x = 0, y = 0, z = 0; for (const i of g) { x += pa[i * 3]; y += pa[i * 3 + 1]; z += pa[i * 3 + 2]; }
    x /= g.length; y /= g.length; z /= g.length;
    for (const i of g) pa.set([x, y, z], i * 3);
  }
}
P.setArray(pa); if (na) N.setArray(na);
// quita el esqueleto (se vuelve a crear con rig.mjs sobre la malla en su nueva pose)
prim.setAttribute('JOINTS_0', null); prim.setAttribute('WEIGHTS_0', null);
const meshNode = root.listNodes().find((n) => n.getMesh());
meshNode.setSkin(null);
for (const j of joints) j.dispose();
skin.dispose();
for (const a of root.listAccessors()) if (!a.listParents().some((p) => p !== root)) a.dispose();
await io.write(output, doc);
// articulaciones nuevas
const J2 = {};
for (const n of Object.keys(J)) { const w = names.includes(n) ? getW(n) : null; J2[n] = w ? [new THREE.Vector3().setFromMatrixPosition(w)].map((q) => [q.x, q.y, q.z].map((x) => +x.toFixed(4)))[0] : J[n]; }
fs.writeFileSync(specOut, JSON.stringify({ ...spec, joints: J2 }, null, 1));
console.log('pose de brazos caídos aplicada:', ANG, 'rad ->', output);
