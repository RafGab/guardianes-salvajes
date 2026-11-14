import * as THREE from 'three';
import { loadGLB, cachedGLB, normalizeModel, prepareMeshes } from './glb.js';
import { modelUrl } from './scale.js';

/* ======================================================================
   OBJETOS 3D DEL ESCENARIO (public/models/props)
   · porsche: deportivo para los coches de Camp Fire. Se pinta de varios colores: el sombreador cambia
     solo el tono de la carrocería (el rojo original), sin tocar cristales, ruedas ni detalles oscuros.
   · casa: casa de entramado de madera integrada en el pueblo de Camp Fire.
   Se cargan al arrancar (como los héroes) para que el escenario los tenga listos al construirse.
   ====================================================================== */
const FILES = { porsche: 'props/porsche.glb', casa: 'props/casa.glb' };

export function preloadProps() {
  return Promise.all(Object.values(FILES).map((f) => loadGLB(modelUrl(f)).catch(() => null)));
}

// modelo normalizado (pies en y=0, centrado, altura 1) o null si aún no está cargado
export function propModel(name) {
  const g = cachedGLB(modelUrl(FILES[name]));
  if (!g) return null;
  const { root } = normalizeModel(g.scene.clone(true));
  prepareMeshes(root);
  root.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
  return root;
}

// colores de carrocería: [tono 0..1, saturación, brillo] (el original es rojo)
export const CAR_PAINTS = {
  rojo: null,
  azul: [0.6, 1.0, 0.95],
  amarillo: [0.14, 1.0, 1.35],
  verde: [0.37, 0.95, 0.75],
  blanco: [0.0, 0.04, 1.9],
  negro: [0.0, 0.15, 0.22],
  plata: [0.58, 0.06, 1.25],
  naranja: [0.07, 1.0, 1.2],
  morado: [0.78, 0.85, 0.8],
  turquesa: [0.48, 0.9, 1.0],
};

const paintCache = new Map();
function paintMaterial(src, paint) {
  const key = src.uuid + ':' + paint.join(',');
  if (paintCache.has(key)) return paintCache.get(key);
  const m = src.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPaint = { value: new THREE.Vector3(...paint) };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uPaint;
        vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1.0e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)),d/(q.x+e),q.x); }
        vec3 hsv2rgb(vec3 c){ vec3 p=abs(fract(c.xxx+vec3(1.,2./3.,1./3.))*6.-3.); return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 hsv = rgb2hsv(diffuseColor.rgb);
          float hd = min(hsv.x, 1.0 - hsv.x);                       // distancia al rojo
          float body = (1.0 - smoothstep(0.05, 0.1, hd)) * smoothstep(0.35, 0.55, hsv.y) * smoothstep(0.03, 0.08, hsv.z);
          vec3 painted = hsv2rgb(vec3(uPaint.x, hsv.y * uPaint.y, min(0.8, hsv.z * uPaint.z))); // sin pasarse de brillo (el blanco no deslumbra)
          diffuseColor.rgb = mix(diffuseColor.rgb, painted, body);
        }`);
  };
  m.customProgramCacheKey = () => 'car-paint';
  paintCache.set(key, m);
  return m;
}

// Coche deportivo de `len` metros de largo pintado del color indicado (mira a +Z)
export function paintedCar(paintName, len = 4.1) {
  const root = propModel('porsche');
  if (!root) return null;
  const paint = CAR_PAINTS[paintName];
  if (paint) root.traverse((o) => { if (o.isMesh) o.material = paintMaterial(o.material, paint); });
  const g = new THREE.Group();
  root.scale.setScalar(len * 0.285); // el modelo mide 1 de largo por 0,285 de alto: normalizado a altura 1, su largo es 1/0,285
  g.add(root);
  return g;
}
