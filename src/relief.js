import * as THREE from 'three';

/* ======================================================================
   RELIEVE 3D A PARTIR DE UNA IMAGEN RECORTADA (con transparencia)
   La imagen NO se modifica: se coloca sobre una malla subdividida que se abomba según su silueta
   (más volumen en el centro de la figura, menos en los bordes) y se ilumina con normales calculadas
   a partir de ese relieve. Así deja de parecer una foto plana: tiene volumen, luz y sombra propias,
   y al moverse la cámara se nota la profundidad.
   Se usa en el menú de mundos (islas) y en la intro (personajes y logo).
   ====================================================================== */

const cache = new WeakMap();

// Mapa de alturas (0..1) a partir del canal alfa y del brillo de la imagen
export function reliefHeight(tex, { size = 128, spread = 0.09, detail = 0.18 } = {}) {
  const img = tex && tex.image;
  if (!img) return null;
  const key = cache.get(img);
  if (key && key[size]) return key[size];
  const W = size, H = Math.max(8, Math.round(size * (img.height / img.width)));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;
  const a = new Float32Array(W * H), l = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) { a[i] = px[i * 4 + 3] / 255; l[i] = (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11) / 255; }
  // abombado: el alfa difuminado varias veces se parece a la distancia al borde (cúpula suave)
  const r = Math.max(1, Math.round(W * spread));
  let h = a.slice();
  const tmp = new Float32Array(W * H);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++) { let s = 0; for (let x = -r; x <= r; x++) s += h[y * W + Math.min(W - 1, Math.max(0, x))]; for (let x = 0; x < W; x++) { tmp[y * W + x] = s / (2 * r + 1); s += h[y * W + Math.min(W - 1, x + r + 1)] - h[y * W + Math.max(0, x - r)]; } }
    for (let x = 0; x < W; x++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x]; for (let y = 0; y < H; y++) { h[y * W + x] = s / (2 * r + 1); s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]; } }
  }
  // detalle fino: las zonas claras sobresalen un poco (espuma, nubes, llamas, rocas iluminadas)
  let mx = 0;
  for (let i = 0; i < W * H; i++) { h[i] = Math.pow(h[i], 0.75) * a[i] + l[i] * detail * a[i]; if (h[i] > mx) mx = h[i]; }
  const data = new Uint8Array(W * H * 4);
  // filas invertidas: la fila 0 de la textura es la de abajo de la imagen (como las texturas de imagen)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (H - 1 - y) * W + x, o = (y * W + x) * 4, v = Math.round((h[i] / (mx || 1)) * 255); data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255; }
  const dt = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  dt.magFilter = THREE.LinearFilter; dt.minFilter = THREE.LinearFilter;
  dt.needsUpdate = true;
  const out = { tex: dt, texel: new THREE.Vector2(1 / W, 1 / H) };
  cache.set(img, { ...(key || {}), [size]: out });
  return out;
}

// Trozos de shader para cualquier ShaderMaterial: desplazan la malla y calculan su normal
export const RELIEF_VS_HEAD = `uniform sampler2D uHeight; uniform vec2 uHTexel; uniform float uDepth; uniform vec2 uSize;
varying vec3 vRN; varying float vRH;
float rH(vec2 q){ return texture2D(uHeight, q).r; }`;
// define `vec3 rp` (posición desplazada) y la normal en el espacio de la vista
export const RELIEF_VS_BODY = `
  float h0 = rH(uv);
  float hx = rH(uv + vec2(uHTexel.x, 0.0)) - rH(uv - vec2(uHTexel.x, 0.0));
  float hy = rH(uv + vec2(0.0, uHTexel.y)) - rH(uv - vec2(0.0, uHTexel.y));
  vec3 rp = position; rp.z += h0 * uDepth;
  vec3 rn = normalize(vec3(-hx * uDepth / (2.0 * uHTexel.x * uSize.x), -hy * uDepth / (2.0 * uHTexel.y * uSize.y), 1.0));
  vRN = normalize(normalMatrix * rn); vRH = h0;`;
// luz de relieve: devuelve un factor que multiplica el color original (luz principal, sombra suave y contorno)
export const RELIEF_FS_HEAD = `varying vec3 vRN; varying float vRH; uniform vec3 uLightDir; uniform float uRelief;
float reliefLight(){
  vec3 n = normalize(vRN);
  float dif = max(dot(n, normalize(uLightDir)), 0.0);
  float occ = mix(0.82, 1.0, smoothstep(0.0, 0.55, vRH));        // los bordes y huecos quedan algo en sombra
  float k = mix(1.0, (0.74 + 0.4 * dif) * occ, uRelief);
  return k;
}
float reliefRim(){ vec3 n = normalize(vRN); return pow(1.0 - clamp(n.z, 0.0, 1.0), 2.0) * uRelief; }`;

export function reliefUniforms(tex, w, h, depth, { size = 128, light = [-0.45, 0.6, 0.65], relief = 1 } = {}) {
  const r = reliefHeight(tex, { size });
  return {
    uHeight: { value: r ? r.tex : null }, uHTexel: { value: r ? r.texel : new THREE.Vector2(0.01, 0.01) },
    uDepth: { value: r ? depth : 0 }, uSize: { value: new THREE.Vector2(w, h) },
    uLightDir: { value: new THREE.Vector3(...light).normalize() }, uRelief: { value: r ? relief : 0 },
  };
}
