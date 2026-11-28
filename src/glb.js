import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { IS_TOUCH } from './platform.js';

// Cargador único de modelos .glb (los de public/models están comprimidos con meshopt + texturas webp).
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const promises = new Map();
const loaded = new Map();

export function loadGLB(url) {
  if (!promises.has(url)) {
    promises.set(url, loader.loadAsync(url).then((g) => { if (IS_TOUCH) shrinkTextures(g.scene, MOBILE_TEX); loaded.set(url, g); return g; }));
  }
  return promises.get(url);
}

// MÓVILES: los 8 héroes, los jefes y los objetos llevan texturas de 2048 px (≈ 22 MB de memoria gráfica cada una).
// Todas juntas superan la memoria de muchos teléfonos y el navegador cierra la página. En los dispositivos
// táctiles se reducen a 1024 px al cargarlas (4 veces menos memoria; en pantalla de móvil no se nota).
const MOBILE_TEX = 1024;
function shrinkTextures(root, max) {
  const done = new Set();
  root.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) for (const k in m) {
      const t = m[k];
      if (!t || !t.isTexture || done.has(t)) continue;
      done.add(t);
      const img = t.image, w = img && img.width, h = img && img.height;
      if (!w || !h || Math.max(w, h) <= max) continue;
      try {
        const s = max / Math.max(w, h), c = document.createElement('canvas');
        c.width = Math.round(w * s); c.height = Math.round(h * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        if (img.close) img.close(); // libera la imagen original (ImageBitmap)
        t.image = c;
        t.needsUpdate = true;
      } catch (e) { /* si no se puede reducir, se queda como estaba */ }
    }
  });
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
