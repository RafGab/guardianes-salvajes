import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { M4 } from './city.js';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
unitBox.translate(0, 0.5, 0);
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 12);
unitCyl.translate(0, 0.5, 0);

export function mergeParts(parts) {
  const geos = parts.map(([geo, matrix, color]) => {
    const g = geo.clone();
    g.applyMatrix4(matrix);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  });
  return mergeGeometries(geos, false);
}

export function carGeometry(color) {
  const wheels = [[-1.3, 0.34, -0.92], [1.3, 0.34, -0.92], [-1.3, 0.34, 0.92], [1.3, 0.34, 0.92]];
  const parts = [
    [unitBox, M4(0, 0.2, 0, 4.2, 0.72, 1.9), color],
    [unitBox, M4(-0.15, 0.85, 0, 2.3, 0.62, 1.72), 0x2a3846],
    [unitBox, M4(-0.15, 1.42, 0, 2.2, 0.1, 1.66), color],
    [unitBox, M4(2.11, 0.42, -0.6, 0.06, 0.16, 0.34), new THREE.Color(0xfff2c0).multiplyScalar(2.5)],
    [unitBox, M4(2.11, 0.42, 0.6, 0.06, 0.16, 0.34), new THREE.Color(0xfff2c0).multiplyScalar(2.5)],
    [unitBox, M4(-2.11, 0.42, -0.6, 0.06, 0.16, 0.34), new THREE.Color(0xff2a1a)],
    [unitBox, M4(-2.11, 0.42, 0.6, 0.06, 0.16, 0.34), new THREE.Color(0xff2a1a)],
  ];
  for (const [x, y, z] of wheels) parts.push([unitCyl, M4(x, y - 0.34, z, 0.34, 0.26, 0.34, 0, Math.PI / 2), 0x151515]);
  return mergeParts(parts);
}

export function busGeometry() {
  const parts = [
    [unitBox, M4(0, 0.35, 0, 9.4, 2.5, 2.6), 0xe0a020],
    [unitBox, M4(0, 1.5, 0, 9.42, 0.9, 2.62), 0x243848],
    [unitBox, M4(0, 2.85, 0, 9.2, 0.15, 2.4), 0xc8901a],
    [unitBox, M4(4.7, 0.6, 0, 0.06, 0.4, 2.0), new THREE.Color(0xfff2c0).multiplyScalar(2.5)],
  ];
  for (const x of [-3, 3]) for (const z of [-1.2, 1.2]) parts.push([unitCyl, M4(x, 0, z, 0.45, 0.32, 0.45, 0, Math.PI / 2), 0x151515]);
  return mergeParts(parts);
}

export function raftGeometry() {
  const parts = [[unitBox, M4(0, 0.1, 0, 3.2, 0.2, 3.0), 0x9a7048]];
  for (let i = -1; i <= 1; i++) parts.push([unitBox, M4(i * 1.0, 0.2, 0, 0.9, 0.08, 3.06), 0x7a5230]);
  for (const x of [-1.4, 1.4]) parts.push([unitCyl, M4(x, -0.2, 0, 0.42, 3.0, 0.42, 0, 0, Math.PI / 2), 0x3a6ea8]);
  return mergeParts(parts);
}

export function crateGeometry() {
  return mergeParts([
    [unitBox, M4(0, 0, 0, 1.1, 1.1, 1.1), 0xa9793f],
    [unitBox, M4(0, 0.5, 0, 1.16, 0.1, 1.16), 0x6a4a2a],
    [unitBox, M4(0, 0, 0, 1.16, 0.1, 1.16), 0x6a4a2a],
  ]);
}
export function barrelGeometry(color) {
  return mergeParts([
    [unitCyl, M4(0, 0, 0, 0.32, 0.9, 0.32), color],
    [unitCyl, M4(0, 0.2, 0, 0.34, 0.06, 0.34), 0x2a2a2a],
    [unitCyl, M4(0, 0.6, 0, 0.34, 0.06, 0.34), 0x2a2a2a],
  ]);
}
export function logGeometry() {
  return mergeParts([[unitCyl, M4(0, 0, 0, 0.26, 3.2, 0.26, 0, 0, Math.PI / 2), 0x6a4a30], [unitCyl, M4(1.62, -0.05, 0, 0.27, 0.05, 0.27, 0, 0, Math.PI / 2), 0xb08a5a]]);
}


export function boatGeometry(color = 0xf4f4f0) {
  const parts = [
    [unitBox, M4(0, 0, 0, 5.6, 0.9, 2.2), color],
    [unitBox, M4(0.4, 0.9, 0, 2.2, 1.1, 1.8), 0xe8e8e0],
    [unitBox, M4(0.4, 2.0, 0, 2.3, 0.12, 1.9), 0xc0392b],
    [unitBox, M4(2.9, 0, 0, 1.2, 0.85, 1.2), color],
    [unitBox, M4(-1.9, 0.9, 0, 0.9, 0.5, 1.8), 0x2e86c1],
  ];
  return mergeParts(parts);
}
export function tumbleGeometry() {
  return mergeParts([[new THREE.IcosahedronGeometry(0.7, 0), M4(0, 0.7, 0), 0x9a7a4a], [new THREE.IcosahedronGeometry(0.5, 0), M4(0.2, 0.9, 0.1), 0xb08a5a]]);
}
export function plankGeometry() {
  return mergeParts([[unitBox, M4(0, 0, 0, 2.6, 0.12, 0.5), 0x9a7048], [unitBox, M4(0, 0.1, 0, 0.3, 0.05, 0.55), 0x6a4a2a]]);
}
