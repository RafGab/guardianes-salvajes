import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// Cargador único de modelos .glb (los de public/models están comprimidos con meshopt + texturas webp).
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const promises = new Map();
const loaded = new Map();

export function loadGLB(url) {
  if (!promises.has(url)) {
    promises.set(url, loader.loadAsync(url).then((g) => { loaded.set(url, g); return g; }));
  }
  return promises.get(url);
}

// Devuelve el GLB si ya está cargado (null si aún no): permite usar un modelo de reserva mientras tanto.
export function cachedGLB(url) {
  return loaded.get(url) || null;
}

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _ctr = new THREE.Vector3();

// Caja del objeto en el espacio de su padre actual (metros si la escala ya está aplicada).
export function measure(obj) {
  obj.updateWorldMatrix(true, true);
  _box.setFromObject(obj);
  _box.getSize(_size);
  _box.getCenter(_ctr);
  return { w: _size.x, h: _size.y, l: _size.z, min: _box.min.clone(), max: _box.max.clone(), center: _ctr.clone() };
}

/**
 * Normaliza un modelo: apoya los pies en y=0, lo centra en x/z y lo deja con altura 1.
 * Devuelve { root, naturalH } donde naturalH es la altura original (para informar de la escala aplicada).
 * Así la altura final en metros es, simplemente, root.scale = altura objetivo.
 */
export function normalizeModel(model) {
  const holder = new THREE.Group();
  holder.add(model);
  const m0 = measure(holder);
  const naturalH = Math.max(1e-4, m0.h);
  model.position.sub(new THREE.Vector3(m0.center.x, m0.min.y, m0.center.z));
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(1 / naturalH);
  inner.add(holder);
  root.add(inner);
  return { root, naturalH };
}

// Prepara sombras y devuelve los materiales únicos del modelo (para el destello al recibir un golpe).
export function prepareMeshes(obj) {
  const mats = new Set();
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      if (o.material) mats.add(o.material);
    }
  });
  return [...mats];
}
