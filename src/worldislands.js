import * as THREE from 'three';
import { RELIEF_VS_HEAD, RELIEF_VS_BODY, RELIEF_FS_HEAD, reliefUniforms } from './relief.js';

/* ======================================================================
   SELECCIÓN DE MUNDOS · un mundo flotante por nivel y la plataforma circular central
   Cada mundo usa SU IMAGEN (public/img/islands/<id>.webp, recortada de su fondo negro) convertida en un
   elemento 3D: la imagen se coloca sobre una malla con relieve (volumen según su silueta, luz y sombra
   propias, ver relief.js) que se gira suavemente hacia la cámara para que se note la profundidad.
   Alrededor: contorno de neón y un remolino de energía bajo sus pies, ambos del COLOR OFICIAL del mundo
   (levels.js → color), con chispas de ese mismo color. La imagen original no se recolorea.
   ====================================================================== */
const TAU = Math.PI * 2;
const loader = new THREE.TextureLoader();
const MARGIN = 0.09; // margen alrededor de la imagen para el halo de neón (fracción del tamaño)

const CARD_VS = `${RELIEF_VS_HEAD}
uniform float uM; varying vec2 vUv;
void main(){
  vUv = (uv - uM) / (1.0 - 2.0 * uM);
  ${RELIEF_VS_BODY}
  gl_Position = projectionMatrix * modelViewMatrix * vec4(rp, 1.0);
}`;
const CARD_FS = `${RELIEF_FS_HEAD}
uniform sampler2D map; uniform vec3 uCol; uniform float uH; uniform float uDim; uniform float uT; uniform float uLoaded; varying vec2 vUv;
float A(vec2 q){ return (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) ? 0.0 : texture2D(map, q).a; }
void main(){
  vec4 tx = (vUv.x < 0.0 || vUv.y < 0.0 || vUv.x > 1.0 || vUv.y > 1.0) ? vec4(0.0) : texture2D(map, vUv);
  // halo de neón: alfa difuminado alrededor de la silueta (solo FUERA de la imagen, no la tapa)
  float s = 0.0;
  for (int i = 0; i < 12; i++) { float a = float(i) * 0.5236; vec2 d = vec2(cos(a), sin(a));
    s += A(vUv + d * 0.025) * 0.5 + A(vUv + d * 0.05) * 0.32 + A(vUv + d * 0.085) * 0.18; }
  s /= 12.0;
  float halo = smoothstep(0.02, 0.6, s) * (1.0 - tx.a);
  float pulse = 0.85 + 0.15 * sin(uT * 2.4);
  vec3 neon = mix(uCol, vec3(1.0), 0.18 * smoothstep(0.35, 0.8, s));
  float ha = halo * (0.55 + 0.45 * uH) * pulse;
  // la imagen con luz y sombra de relieve; contorno interior con el color del mundo
  vec3 col = tx.rgb * reliefLight() + uCol * reliefRim() * 0.35 * tx.a;
  col *= 1.0 - uDim * 0.45;
  float a = tx.a + ha * (1.0 - tx.a);
  vec3 outc = (col * tx.a + neon * 1.25 * ha * (1.0 - tx.a)) / max(a, 0.001);
  if (a < 0.01) discard;
  gl_FragColor = vec4(outc, a * uLoaded);
}`;

// remolino de neón bajo cada mundo (como un portal de energía visto desde arriba)
const VORTEX_FS = `uniform float uT; uniform vec3 uCol; uniform float uH; uniform float uDim; varying vec2 vP;
float hsh(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
void main(){
  float r = length(vP), a = atan(vP.y, vP.x);
  float sw = a * 3.0 + r * 7.0 - uT * (1.6 + uH * 1.4);
  float b1 = pow(0.5 + 0.5 * sin(sw), 5.0), b2 = pow(0.5 + 0.5 * sin(a * 5.0 - r * 11.0 + uT * 2.3), 7.0);
  float body = smoothstep(0.18, 0.5, r) * smoothstep(1.0, 0.72, r);
  float edge = exp(-pow((r - 0.86) * 16.0, 2.0)) + 0.6 * exp(-pow((r - 0.95) * 30.0, 2.0));
  float inner = smoothstep(0.5, 0.0, r) * 0.35;
  float v = body * (b1 * 0.75 + b2 * 0.45) + edge * 1.1 + inner;
  float spark = step(0.985, hsh(floor(vec2(a * 30.0, r * 20.0 - uT * 3.0)))) * body;
  vec3 col = uCol * (1.3 + uH * 0.8) * (0.6 + v) + mix(uCol, vec3(1.0), 0.55) * (pow(edge, 3.0) * 0.6 + b1 * b2 * body * 0.5 + spark);
  float al = clamp(v * (0.75 + uH * 0.25), 0.0, 1.0) * (1.0 - uDim * 0.5) * smoothstep(1.0, 0.93, r);
  gl_FragColor = vec4(col, al);
}`;

// Mundo flotante: grupo, función de animación y piezas para el resaltado
export function buildIsland(L) {
  const col = new THREE.Color(L.color || '#8ab8ff');
  const center = L.id === 'extreme';
  const g = new THREE.Group();
  const body = new THREE.Group(); // gira (remolino de neón)
  g.add(body);
  const W = 3.3; // anchura de la imagen del mundo (Apocalia se escala desde worldselect)
  const R = 1.8;
  // remolino de neón del color oficial
  const vu = { uT: { value: 0 }, uCol: { value: col }, uH: { value: 0 }, uDim: { value: 0 } };
  const vortex = new THREE.Mesh(new THREE.CircleGeometry(R, 96), new THREE.ShaderMaterial({
    uniforms: vu, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy / ${R.toFixed(2)}; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: VORTEX_FS,
  }));
  vortex.rotation.x = -Math.PI / 2; vortex.position.y = -0.25; vortex.renderOrder = 1;
  body.add(vortex);
  // anillos finos de neón (los usa worldselect para el resaltado)
  const ringM = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.4), transparent: true, opacity: 0.55, toneMapped: false, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(R + 0.12, R + 0.18, 96), ringM); ring.rotation.x = -Math.PI / 2; ring.position.y = -0.24; g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(R + 0.34, R + 0.38, 96, 1, 0, TAU * 0.8), ringM.clone()); ring2.rotation.x = -Math.PI / 2; ring2.position.y = -0.24; g.add(ring2);
  // la imagen del mundo con relieve 3D y halo de neón
  const cu = { map: { value: null }, uCol: { value: col }, uH: { value: 0 }, uDim: { value: 0 }, uT: { value: 0 }, uM: { value: MARGIN }, uLoaded: { value: 0 },
    ...reliefUniforms(null, 1, 1, 0) };
  const card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 96, 96), new THREE.ShaderMaterial({ uniforms: cu, vertexShader: CARD_VS, fragmentShader: CARD_FS, transparent: true, depthWrite: true, toneMapped: false, side: THREE.DoubleSide }));
  card.rotation.order = 'YXZ';
  card.renderOrder = 2;
  card.visible = false;
  g.add(card);
  loader.load(`/img/islands/${L.id}.webp`, (t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const aspect = t.image.height / t.image.width, h = W * aspect, fw = W / (1 - 2 * MARGIN), fh = h / (1 - 2 * MARGIN);
    card.geometry.dispose();
    card.geometry = new THREE.PlaneGeometry(fw, fh, 96, 96);
    card.position.y = h * 0.5 - 0.5; // la base rocosa de la imagen se apoya sobre el remolino
    const ru = reliefUniforms(t, fw, fh, 0.32, { size: 112 });
    for (const k in ru) cu[k].value = ru[k].value;
    cu.map.value = t; cu.uLoaded.value = 1;
    card.visible = true;
  });
  // columna de luz del color del mundo al seleccionarlo
  const beamM = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.4), transparent: true, opacity: 0, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.85, R * 0.95, 14, 32, 1, true), beamM); beam.position.y = 5; g.add(beam);
  const light = new THREE.PointLight(col, 0, 9, 1.6); light.position.set(0, 2.5, 1.5); g.add(light);
  // zona de clic (invisible) para elegir el mundo
  const hit = new THREE.Mesh(new THREE.SphereGeometry(1.75, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 1.2;
  g.add(hit);
  const wp = new THREE.Vector3();
  // la imagen mira siempre hacia la cámara (solo en horizontal) con un leve vaivén que deja ver su volumen
  card.onBeforeRender = (r, s, cam) => {
    g.getWorldPosition(wp);
    card.rotation.y = Math.atan2(cam.position.x - wp.x, cam.position.z - wp.z) + Math.sin(cu.uT.value * 0.5 + wp.x) * 0.14;
    card.rotation.x = -0.62; // inclinada hacia la cámara, que mira desde arriba
    card.updateMatrixWorld();
  };
  const anim = (t, dt, h) => { cu.uT.value = t; cu.uH.value = h; vu.uT.value = t; vu.uH.value = h; };
  const setDim = (d) => { cu.uDim.value = d; vu.uDim.value = d; };
  return { g, body, anim, setDim, ring, ring2, ringM, beam, beamM, light, hit, col, center, card };
}

/* ---------------- plataforma circular de energía (como un reloj de engranajes) ---------------- */
export function buildPlatform() {
  const u = { uT: { value: 0 }, uCol: { value: new THREE.Color(0x4a8aff) }, uSelA: { value: -10 }, uSel: { value: 0 } };
  const m = new THREE.Mesh(new THREE.CircleGeometry(15, 128), new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uT; uniform vec3 uCol; uniform float uSelA; uniform float uSel; varying vec2 vP;
      float ring(float r, float c, float w){ return smoothstep(w, 0.0, abs(r - c)); }
      void main(){
        float r = length(vP), a = atan(vP.y, vP.x);
        float v = 0.0;
        v += ring(r, 3.6, 0.08) * 0.9 + ring(r, 4.0, 0.03) * 0.6;
        v += ring(r, 9.0, 0.05) * 0.5 + ring(r, 11.6, 0.12) * 0.9 + ring(r, 12.2, 0.03) * 0.7 + ring(r, 14.6, 0.05) * 0.5;
        // marcas de reloj y dientes de engranaje
        float ticks = smoothstep(0.9, 1.0, abs(sin(a * 30.0))) * step(11.7, r) * step(r, 12.15);
        float big = smoothstep(0.985, 1.0, abs(sin(a * 4.0 + 0.785))) * step(11.4, r) * step(r, 12.8) * 0.5;
        float gear = smoothstep(0.3, 0.6, sin(a * 18.0 + uT * 0.3)) * step(4.0, r) * step(r, 4.6);
        float gear2 = smoothstep(0.4, 0.7, sin(a * 40.0 - uT * 0.15)) * step(14.6, r) * step(r, 14.9);
        v += ticks * 0.8 + big * 0.9 + gear * 0.35 + gear2 * 0.4;
        // círculos de engranajes decorativos
        for (int i = 0; i < 6; i++) { float ga = float(i) * 1.047 + uT * 0.05; vec2 c = vec2(cos(ga), sin(ga)) * 7.2; float d = length(vP - c); v += ring(d, 1.6, 0.04) * 0.35 + smoothstep(0.3, 0.6, sin(atan(vP.y - c.y, vP.x - c.x) * 12.0 + uT * 0.4)) * step(1.6, d) * step(d, 1.85) * 0.25; }
        // haz hacia el mundo elegido
        float da = abs(mod(a - uSelA + 3.14159, 6.28318) - 3.14159);
        float beam = uSel * smoothstep(0.35, 0.0, da) * step(4.0, r) * step(r, 11.6) * (0.35 + 0.25 * sin(r * 2.0 - uT * 5.0));
        float glow = smoothstep(15.0, 0.0, r) * 0.18 + smoothstep(4.0, 0.0, r) * 0.25;
        vec3 c = uCol * (v + glow) + mix(uCol, vec3(1.0), 0.3) * beam;
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  m.rotation.x = -Math.PI / 2;
  return { mesh: m, u };
}
