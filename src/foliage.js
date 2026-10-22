import * as THREE from 'three';
import { makeRng } from './utils.js';
import { terrainH } from './terrain.js';
import { toonMat } from './toon.js';

// VEGETACIÓN REDONDEADA: arbustos y florecillas que salpican solo las zonas de césped del mapa (se detectan por el color
// del suelo pintado), para dar el aspecto frondoso y colorido de un escenario de fantasía. Son decorativos (no estorban).

const FLOWERS = [0xff8fb8, 0xffd84a, 0xffffff, 0xb59aff, 0xff9a5a];

export function createFoliage(scene, W, { bushes = 260, flowers = 420 } = {}) {
  const gc = W.groundCanvas;
  if (!gc) return null;
  const w = gc.width, h = gc.height;
  const px = gc.getContext('2d').getImageData(0, 0, w, h).data;
  const k = w / 256;
  const grassAt = (x, z) => {
    const i = Math.floor((z + 128) * k) * w + Math.floor((x + 128) * k);
    const o = i * 4;
    if (o < 0 || o + 2 >= px.length) return 0;
    const r = px[o], g = px[o + 1], b = px[o + 2];
    return g > r + 8 && g > b + 8 ? 1 : 0; // verde dominante = césped
  };
  const R = makeRng(7771);
  const spots = [];
  for (let tries = 0; tries < (bushes + flowers) * 14 && spots.length < bushes + flowers; tries++) {
    const x = R.range(-105, 105), z = R.range(-105, 105);
    if (!grassAt(x, z)) continue;
    if (W.solidsNear(x - 1.2, x + 1.2, z - 1.2, z + 1.2, []).length) continue; // lejos de edificios y obstáculos
    spots.push([x, z]);
  }
  if (!spots.length) return null;

  const blob = new THREE.IcosahedronGeometry(1, 1);
  const bushMat = toonMat({ color: 0xffffff });
  const nb = Math.min(bushes, Math.floor(spots.length * 0.4));
  const bushMesh = new THREE.InstancedMesh(blob, bushMat, nb);
  const flowerMesh = new THREE.InstancedMesh(blob, toonMat({ color: 0xffffff }), spots.length - nb);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  spots.forEach(([x, z], i) => {
    const y = terrainH(x, z);
    q.setFromEuler(new THREE.Euler(0, R.range(0, 6.28), 0));
    if (i < nb) { // arbusto: 1-2 bolas verdes con distinto tono
      const r = R.range(0.55, 1.1);
      s.set(r, r * 0.75, r);
      p.set(x, y + r * 0.45, z);
      m.compose(p, q, s);
      bushMesh.setMatrixAt(i, m);
      bushMesh.setColorAt(i, c.setHSL(R.range(0.24, 0.36), R.range(0.5, 0.7), R.range(0.36, 0.5)));
    } else { // florecilla: bolita de color sobre el césped
      const j = i - nb, r = R.range(0.12, 0.2);
      s.set(r, r, r);
      p.set(x, y + 0.25, z);
      m.compose(p, q, s);
      flowerMesh.setMatrixAt(j, m);
      flowerMesh.setColorAt(j, c.set(FLOWERS[Math.floor(R.next() * FLOWERS.length)]));
    }
  });
  bushMesh.castShadow = true;
  bushMesh.instanceMatrix.needsUpdate = true;
  flowerMesh.instanceMatrix.needsUpdate = true;
  if (bushMesh.instanceColor) bushMesh.instanceColor.needsUpdate = true;
  if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;
  scene.add(bushMesh, flowerMesh);
  return { bushMesh, flowerMesh };
}
