import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMat } from './toon.js';
import { TAU, clamp, damp, lerp, makeCanvas, texFromCanvas } from './utils.js';
import { CFG } from './terrain.js';
import { PORTAL_DIM, refugeKeepOut } from './refuge.js';

/* =====================================================================
   PORTAL DE RESCATE ELEMENTAL
   Un único portal por nivel (el del refugio). Su aspecto depende del héroe activo:
   PERSONAJE SELECCIONADO → VARIANTE VISUAL. La mecánica de entrega no cambia:
   el rescate se sigue completando al entrar en el círculo del refugio (CFG.SAFE).
   Todas las variantes comparten la misma "tecnología": arco + 2 columnas + figura
   del animal + campo de energía (shader) + plataforma circular + partículas.
   ===================================================================== */

const W = 2.2;          // semiancho del vano
const HC = 3.8;         // altura de arranque del arco
const COL = PORTAL_DIM.col;
const FIELD_C = new THREE.Vector2(0, 3.0); // centro óptico del campo

export const PORTAL_INFO = {
  roca: { name: 'Santuario de la Montaña', hero: 'jago' },
  fuego: { name: 'Santuario de la Llama', hero: 'kairo' },
  arena: { name: 'Santuario de las Dunas', hero: 'halley' },
  hielo: { name: 'Santuario de Cristal', hero: 'kyra' },
  aire: { name: 'Santuario de las Nubes', hero: 'ambar' },
  agua: { name: 'Santuario de las Corrientes', hero: 'nilo' },
  tierra: { name: 'Santuario de la Vida', hero: 'lira' },
};

/* ---------------- utilidades de construcción ---------------- */
const col3 = (h) => new THREE.Color(h);
const M = (color, o = {}) => toonMat({ color, ...o });
const glow = (color, k = 2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });
const glowT = (color, k = 2, opacity = 0.8) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false, transparent: true, opacity, depthWrite: false });

function add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  if (typeof s === 'number') m.scale.setScalar(s); else m.scale.set(s[0], s[1], s[2]);
  m.castShadow = !mat.transparent && !(mat.isMeshBasicMaterial);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
const grp = (parent, x = 0, y = 0, z = 0, live = false) => {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (live) g.userData.live = true;
  parent.add(g);
  return g;
};
const live = (o) => { o.userData.live = true; return o; };

// Geometrías compartidas
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sph: new THREE.SphereGeometry(1, 18, 14),
  sphLo: new THREE.SphereGeometry(1, 10, 8),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 20),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cone: new THREE.ConeGeometry(1, 1, 16),
  cone6: new THREE.ConeGeometry(1, 1, 6),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  oct: new THREE.OctahedronGeometry(1, 0),
  ico: new THREE.IcosahedronGeometry(1, 0),
  dode: new THREE.DodecahedronGeometry(1, 0),
  tor: new THREE.TorusGeometry(1, 0.12, 10, 32),
  plane: new THREE.PlaneGeometry(1, 1),
};

// Sector de anillo extruido (arcos suaves y dovelas)
function arcSlab(r0, r1, a0, a1, depth, bevel = 0.06, seg = 20) {
  const s = new THREE.Shape();
  s.moveTo(Math.cos(a0) * r1, Math.sin(a0) * r1);
  s.absarc(0, 0, r1, a0, a1, false);
  s.lineTo(Math.cos(a1) * r0, Math.sin(a1) * r0);
  s.absarc(0, 0, r0, a1, a0, true);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: seg });
  g.translate(0, 0, -depth / 2);
  return g;
}
// Arco de dovelas: n bloques con pequeña separación y variación
function archBlocks(parent, mat, { r0 = W, r1 = W + 0.8, depth = 1, n = 9, gap = 0.035, jit = 0, rnd = Math.random, keyMat = null }) {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI + gap, a1 = ((i + 1) / n) * Math.PI - gap;
    const key = i === Math.floor(n / 2);
    const e = jit * (rnd() - 0.5);
    const g = arcSlab(r0 - (key ? 0.08 : 0), r1 + e + (key ? 0.25 : 0), a0, a1, depth + (key ? 0.15 : 0) + jit * rnd() * 0.5, 0.07, 6);
    add(parent, g, key && keyMat ? keyMat : mat, 0, HC, 0);
  }
}
// Perfil torneado
function lathe(points, seg = 20) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), seg);
}
// Plataforma circular común
function platform(root, top, side, ring, { r = PORTAL_DIM.plat, seg = 40, h = 0.16, studs = 8, studMat = null } = {}) {
  add(root, new THREE.CylinderGeometry(r, r + 0.12, h, seg), side, 0, h / 2 - 0.03, 0);
  add(root, new THREE.CylinderGeometry(r - 0.25, r - 0.2, 0.05, seg), top, 0, h - 0.01, 0);
  add(root, new THREE.TorusGeometry(r - 0.55, 0.045, 6, 64), ring, 0, h + 0.02, 0, Math.PI / 2);
  add(root, new THREE.TorusGeometry(1.6, 0.03, 6, 48), ring, 0, h + 0.02, 0, Math.PI / 2);
  for (let i = 0; i < studs; i++) {
    const a = (i / studs) * TAU + Math.PI / studs;
    add(root, GEO.oct, studMat || ring, Math.cos(a) * (r - 0.55), h + 0.06, Math.sin(a) * (r - 0.55), 0, a, 0, [0.12, 0.06, 0.12]);
  }
}
// Cristal facetado
function crystal(parent, mat, x, y, z, s = 1, rz = 0, ry = 0) {
  return add(parent, GEO.oct, mat, x, y, z, 0, ry, rz, [0.22 * s, 0.5 * s, 0.22 * s]);
}
// Hacia el exterior de cada columna: ±1
const SIDES = [-1, 1];

// Fusiona por material todas las mallas estáticas (pocas llamadas de dibujo)
function bake(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const kill = [];
  const m4 = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    for (let p = o; p && p !== root; p = p.parent) if (p.userData.live) return;
    const g = o.geometry.clone();
    m4.multiplyMatrices(inv, o.matrixWorld);
    g.applyMatrix4(m4);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.index) { const idx = []; for (let i = 0; i < g.attributes.position.count; i++) idx.push(i); g.setIndex(idx); }
    g.morphAttributes = {};
    let b = buckets.get(o.material);
    if (!b) { b = { geos: [], shadow: false }; buckets.set(o.material, b); }
    b.geos.push(g);
    b.shadow = b.shadow || o.castShadow;
    kill.push(o);
  });
  for (const o of kill) o.parent.remove(o);
  for (const [mat, b] of buckets) {
    const g = mergeGeometries(b.geos, false);
    b.geos.forEach((x) => x.dispose());
    if (!g) continue;
    const m = new THREE.Mesh(g, mat);
    m.castShadow = b.shadow;
    m.receiveShadow = true;
    root.add(m);
  }
  // los grupos animados (alas, nubes, llamas, lianas...) se fusionan por dentro: se mueven como una sola pieza
  for (const ch of [...root.children]) {
    if (!ch.isGroup || !ch.userData.live || ch.children.length < 2) continue;
    ch.userData.live = false;
    bake(ch);
    ch.userData.live = true;
  }
}

/* ---------------- campo de energía (shader común) ---------------- */
const FIELD_VS = /* glsl */`
varying vec2 vP; varying vec3 vV;
void main(){
  vP = position.xy;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 camL = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  vV = position - camL;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FIELD_FS = /* glsl */`
uniform float uT, uMode, uCharge, uBurst, uOpen, uW, uHC, uSwap;
uniform vec3 uC1, uC2, uC3;
varying vec2 vP; varying vec3 vV;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
float cell(vec2 p){ vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(h21(i + g), h21(i + g + 7.1)); float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return d2 - d1; }
float ang(vec2 q){ return atan(q.y, q.x + 1e-4); }
float pat(vec2 p, float t, out float k){
  vec2 q = p - vec2(0.0, 3.0); float r = length(q); float v = 0.0; k = 0.0;
  if (uMode < 0.5) {            // ROCA: ondas sísmicas + vetas doradas
    float rip = 0.5 + 0.5 * sin(r * 5.0 - t * 2.2 + fbm(p * 1.2) * 2.0);
    float cr = 1.0 - smoothstep(0.0, 0.05, cell(p * 0.9 + vec2(0.0, t * 0.05)));
    float dust = fbm(p * 1.6 + vec2(t * 0.15, -t * 0.1));
    v = rip * 0.55 + cr * 0.45 + dust * 0.3; k = cr * 0.7 + rip * 0.3;
  } else if (uMode < 1.5) {     // FUEGO: llamas que suben
    float n1 = fbm(vec2(p.x * 1.4, p.y * 1.1 - t * 1.8));
    float n2 = fbm(vec2(p.x * 2.6 + 3.0, p.y * 2.2 - t * 2.6));
    float h = p.y / (uHC + uW);
    float f = n1 * 0.7 + n2 * 0.5 - h * 0.55 + 0.12;
    v = smoothstep(0.25, 0.75, f); k = smoothstep(0.5, 0.92, f);
  } else if (uMode < 2.5) {     // ARENA: remolino dorado
    float sw = sin(ang(q) * 3.0 + r * 2.6 - t * 2.4 + fbm(q * 1.5 + t * 0.2) * 2.5);
    v = 0.5 + 0.5 * sw; v *= v;
    v += step(0.93, vn(p * 14.0 + vec2(t * 3.0, 0.0))) * 0.6;
    k = 0.5 + 0.5 * sin(r * 3.0 - t);
  } else if (uMode < 3.5) {     // HIELO: aurora + facetas de cristal
    float cur = sin(p.x * 2.2 + fbm(vec2(p.y * 0.6, t * 0.25)) * 4.0 + t * 0.6);
    float band = smoothstep(0.2, 1.0, cur) * smoothstep(0.5, 4.5, p.y);
    float fac = 1.0 - smoothstep(0.0, 0.05, cell(p * 1.8));
    v = band * 0.8 + fac * 0.5 + 0.15; k = band;
  } else if (uMode < 4.5) {     // AIRE: corrientes de viento
    float st = sin(p.y * 5.0 + fbm(vec2(p.x * 0.8 - t * 1.5, p.y * 0.6)) * 5.0);
    float lines = smoothstep(0.72, 1.0, st);
    float sw = 0.5 + 0.5 * sin(ang(q) * 2.0 - r * 1.5 + t * 3.0);
    v = lines * 0.9 + sw * 0.3; k = lines;
  } else if (uMode < 5.5) {     // AGUA: ondas + cáusticas + remolino
    float rip = 0.5 + 0.5 * sin(r * 7.0 - t * 3.0);
    vec2 w = p * 1.6 + vec2(fbm(p + t * 0.3), fbm(p - t * 0.25)) * 1.5;
    float cau = pow(1.0 - abs(sin(fbm(w * 1.3) * 6.283)), 4.0);
    float swl = 0.5 + 0.5 * sin(ang(q) * 2.0 + r * 2.0 - t * 1.6);
    v = rip * 0.3 + cau * 0.8 + swl * 0.2; k = cau;
  } else {                      // TIERRA: vetas de savia y brotes
    float vein = 1.0 - smoothstep(0.0, 0.07, cell(p * 1.1 + vec2(0.0, -t * 0.15)));
    float gl = fbm(p * 0.9 + vec2(0.0, -t * 0.4));
    float sprout = smoothstep(0.62, 0.8, fbm(p * 2.4 + vec2(t * 0.1, -t * 0.3)));
    v = vein * 0.7 + gl * 0.45 + sprout * 0.4; k = gl * 0.6 + sprout;
  }
  return v;
}
void main(){
  float d = (vP.y < uHC) ? (uW - abs(vP.x)) : (uW - length(vec2(vP.x, vP.y - uHC)));
  d = min(d, vP.y - 0.16);
  float rim = exp(-max(d, 0.0) * 5.0);
  vec3 V = normalize(vV);
  vec2 off = V.xy / max(0.3, abs(V.z)) * 0.7;      // profundidad: segunda capa desplazada por paralaje
  float k1, k2;
  float t = uT * (1.0 + uBurst * 0.8);
  float a1 = pat(vP, t, k1);
  float a2 = pat(vP * 1.35 + off + vec2(4.0, 1.0), t * 0.8, k2);
  float v = a1 + a2 * 0.45;
  vec3 col = mix(uC1, uC2, clamp(k1, 0.0, 1.0));
  col = mix(col, uC2, clamp(a2 * 0.3, 0.0, 1.0));
  col += uC3 * rim * 1.5;
  float alpha = 0.2 + v * 0.36 + rim * 0.6;
  float e = 0.85 + uCharge * 0.55 + uBurst * 1.1 + uSwap * 1.5;
  // apertura en iris para que la persona cruce
  float rr = length(vP - vec2(0.0, 2.4));
  float hole = uOpen * 3.4;
  float iris = smoothstep(hole - 0.4, hole, rr);
  float dr = (rr - hole) * 4.0;
  float ring = exp(-dr * dr) * step(0.01, uOpen);
  alpha *= mix(1.0, iris, 0.8);
  col += uC3 * ring * 1.4;
  alpha = clamp(alpha + ring * 0.45 + uSwap * 0.3, 0.0, 0.92) * smoothstep(0.0, 0.06, d);
  vec3 o = min(col * (0.85 + v * 0.6) * e, vec3(6.0));
  gl_FragColor = vec4(o, alpha);
}`;
const MODE = { roca: 0, fuego: 1, arena: 2, hielo: 3, aire: 4, agua: 5, tierra: 6 };

function openingShape(inset = 0) {
  const w = W - inset;
  const s = new THREE.Shape();
  s.moveTo(-w, 0.16);
  s.lineTo(w, 0.16);
  s.lineTo(w, HC);
  s.absarc(0, HC, w, 0, Math.PI, false);
  s.lineTo(-w, 0.16);
  return s;
}
const FIELD_GEO = new THREE.ShapeGeometry(openingShape(0.02), 32);

function makeField(el, c1, c2, c3) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uT: { value: 0 }, uMode: { value: MODE[el] }, uCharge: { value: 0 }, uBurst: { value: 0 }, uOpen: { value: 0 }, uSwap: { value: 0 },
      uW: { value: W }, uHC: { value: HC },
      uC1: { value: col3(c1) }, uC2: { value: col3(c2) }, uC3: { value: col3(c3) },
    },
    vertexShader: FIELD_VS, fragmentShader: FIELD_FS,
  });
}

/* ---------------- partículas del campo (instanciadas) ---------------- */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
class Motes {
  // mode: orbit | ring | rise | fall | drift | swirl
  constructor(parent, geo, mat, n, mode, o = {}) {
    this.mesh = live(new THREE.InstancedMesh(geo, mat, n));
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this.n = n; this.mode = mode; this.o = o;
    this.ph = new Float32Array(n); this.a = new Float32Array(n); this.b = new Float32Array(n); this.c = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.ph[i] = Math.random() * 100; this.a[i] = Math.random(); this.b[i] = Math.random(); this.c[i] = Math.random(); }
  }
  update(dt, t, boost) {
    const { n, mode, o } = this;
    const size = o.size || 0.1, spd = (o.speed || 1) * (1 + boost * 2.5);
    for (let i = 0; i < n; i++) {
      const a = this.a[i], b = this.b[i], c = this.c[i];
      this.ph[i] += dt * spd * (0.6 + a * 0.8);
      const ph = this.ph[i];
      let x = 0, y = 0, z = 0, sc = 1, rx = ph * 2 * (b - 0.5), ry = ph * 1.5, rz = ph * (a - 0.5) * 2;
      if (mode === 'orbit') {
        const r = (o.r0 ?? 0.6) + a * ((o.r1 ?? 2.0) - (o.r0 ?? 0.6));
        const an = ph * 0.35 + b * TAU;
        x = Math.cos(an) * r; y = FIELD_C.y + Math.sin(an) * r * 0.92; z = (c - 0.5) * (o.zs ?? 0.5) + Math.sin(ph * 1.3) * 0.08;
      } else if (mode === 'ring') {
        const r = (o.r0 ?? 3.2) + a * ((o.r1 ?? 4.0) - (o.r0 ?? 3.2));
        const an = ph * 0.3 + b * TAU;
        x = Math.cos(an) * r; y = FIELD_C.y + Math.sin(an) * r * 0.85; z = (c - 0.5) * 1.6;
        rz = an + Math.PI / 2; rx = 0; ry = Math.sin(ph) * 0.6;
      } else if (mode === 'rise') {
        const u = (ph * 0.12 + b) % 1;
        x = (a - 0.5) * W * 1.7 + Math.sin(ph * 1.7 + c * 6) * 0.18; y = 0.3 + u * 5.6; z = (c - 0.5) * (o.zs ?? 0.6);
        sc = Math.sin(u * Math.PI);
        if (Math.abs(x) > W * 0.95 && y > HC) sc *= 0.3;
      } else if (mode === 'fall') {
        const u = (ph * 0.08 + b) % 1;
        x = (a - 0.5) * W * 2.2 + Math.sin(ph * 0.9 + c * 6) * 0.35; y = 6.4 - u * 6.2; z = (c - 0.5) * (o.zs ?? 1.4);
        sc = Math.min(1, Math.sin(u * Math.PI) * 2);
      } else if (mode === 'drift') {
        const u = (ph * 0.06 + b) % 1;
        x = Math.sin(ph * 0.5 + a * 6) * W * 0.85; y = 0.4 + u * 5.6; z = (c - 0.5) * 0.8 + Math.cos(ph * 0.7) * 0.2;
        sc = Math.sin(u * Math.PI); rx = Math.sin(ph * 2.2) * 0.9; rz = Math.cos(ph * 1.7) * 0.9; ry = ph;
      } else if (mode === 'swirl') {
        const u = (ph * 0.05 + b) % 1;
        const r = 0.4 + a * 1.8 + u * 0.5;
        const an = ph * 1.2 + c * TAU;
        x = Math.cos(an) * r; y = 0.3 + u * 5.6; z = Math.sin(an) * r * 0.35;
        sc = Math.sin(u * Math.PI);
      }
      _p.set(x, y, z);
      _q.setFromEuler(_e.set(rx, ry, rz));
      const s = size * (0.6 + a * 0.8) * sc * (1 + boost * 0.4);
      _s.set(s, s * (o.stretch || 1), s);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ---------------- recorridos de la animación de llegada ---------------- */
// Línea central del marco: base izquierda → arco → base derecha (s ∈ [0,1])
function framePath(s, out) {
  const R = W + 0.42, L1 = HC, L2 = Math.PI * R, tot = L1 * 2 + L2;
  let d = s * tot;
  if (d < L1) return out.set(-R, 0.2 + d, 0);
  d -= L1;
  if (d < L2) { const a = Math.PI - d / R; return out.set(Math.cos(a) * R, HC + Math.sin(a) * R, 0); }
  d -= L2;
  return out.set(R, HC - d + 0.2, 0);
}
class Runners {
  constructor(parent, geo, mat, n, mode) {
    this.mesh = live(new THREE.InstancedMesh(geo, mat, n));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.n = n; this.mode = mode; this.t = -1;
    this.r = Array.from({ length: n }, () => [Math.random(), Math.random(), Math.random()]);
  }
  fire() { this.t = 0; this.mesh.visible = true; }
  update(dt) {
    if (this.t < 0) return;
    this.t += dt;
    const D = 2.2, u = this.t / D;
    if (u >= 1) { this.t = -1; this.mesh.visible = false; return; }
    const { n, mode } = this;
    for (let i = 0; i < n; i++) {
      const [a, b, c] = this.r[i];
      let sc = 1, rx = 0, ry = 0, rz = 0;
      const j = i % (n / 2), side = i < n / 2 ? 0 : 1;
      if (mode === 'arch') {            // llamas que recorren el arco desde las dos bases hasta la clave
        const s = clamp(u * 1.5 - j * 0.04, 0, 1) * 0.5;
        framePath(side ? 1 - s : s, _p);
        _p.z += (c - 0.5) * 0.5;
        sc = (s > 0 && s < 0.5 ? 1 : 0.0001) * (1 - u) * (1 + Math.sin(this.t * 30 + i) * 0.3);
        rz = this.t * 6 + i;
      } else if (mode === 'ring') {     // remolino que rodea el portal
        const an = u * TAU * 1.6 + (i / n) * TAU;
        const r = 3.0 + Math.sin(i) * 0.4;
        _p.set(Math.cos(an) * r, 0.3 + u * 5 + (i % 5) * 0.25, Math.sin(an) * r * 0.75);
        sc = Math.sin(u * Math.PI); ry = an;
      } else if (mode === 'twinkle') {  // cristales y copos que brillan sobre el marco
        framePath(a, _p);
        _p.z += (b - 0.5) * 0.9; _p.x *= 1 + (c - 0.5) * 0.15;
        sc = Math.max(0, Math.sin((u * 3 - b) * Math.PI)) * 1.4; ry = this.t * 3; rz = Math.PI / 4;
      } else if (mode === 'stream') {   // corriente de viento que atraviesa el arco
        _p.set((a - 0.5) * W * 1.6, 0.6 + b * 4.8, lerp(5, -5, ((u * 1.8 + c) % 1)));
        sc = Math.sin(u * Math.PI); rx = Math.PI / 2;
      } else if (mode === 'bubbles') {  // burbujas que recorren la superficie
        const uu = clamp(u * 1.4 - c * 0.4, 0, 1);
        _p.set((a - 0.5) * W * 1.7 + Math.sin(uu * 9 + i) * 0.2, 0.3 + uu * 5.8, (b - 0.5) * 0.4);
        sc = uu > 0 && uu < 1 ? 0.6 + uu : 0.0001;
      } else if (mode === 'spiral') {   // fragmentos que giran e iluminan
        const an = u * 9 + (i / n) * TAU;
        const r = 0.5 + u * 2.4 + a * 0.4;
        _p.set(Math.cos(an) * r, FIELD_C.y + Math.sin(an) * r, (c - 0.5) * 0.6);
        sc = Math.sin(u * Math.PI) * 1.3; rx = an * 2; ry = an;
      } else {                          // 'leaves': hojas que brotan alrededor
        const an = u * TAU * 1.2 + (i / n) * TAU;
        const r = 2.6 + a * 0.9;
        _p.set(Math.cos(an) * r, 0.2 + u * 4.5 + b * 1.2, Math.sin(an) * r * 0.7);
        sc = Math.sin(u * Math.PI) * 1.2; rx = Math.sin(u * 20 + i); ry = an; rz = Math.cos(u * 14 + i);
      }
      _q.setFromEuler(_e.set(rx, ry, rz));
      _s.setScalar(Math.max(0.0001, sc));
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ---------------- figuras de los animales (parte superior) ---------------- */
function eyes(g, mat, dx, y, z, r = 0.07) {
  for (const s of SIDES) add(g, GEO.sphLo, mat, s * dx, y, z, 0, 0, 0, r);
}
function figLion(g, stone, gold, eye) {     // Jaglion: cabeza de león tallada con melena dorada
  add(g, GEO.tor, gold, 0, 0, -0.05, 0, 0, 0, [0.68, 0.68, 2.2]);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    add(g, GEO.cone, gold, Math.cos(a) * 0.78, Math.sin(a) * 0.78, -0.12, 0, 0, a - Math.PI / 2, [0.2, 0.42, 0.14]);
  }
  add(g, GEO.sph, stone, 0, 0, 0.05, 0, 0, 0, [0.55, 0.52, 0.5]);
  add(g, GEO.sph, stone, 0, -0.2, 0.42, 0, 0, 0, [0.3, 0.22, 0.22]);
  add(g, GEO.sph, gold, 0, -0.1, 0.62, 0, 0, 0, [0.1, 0.07, 0.07]);
  for (const s of SIDES) add(g, GEO.sph, stone, s * 0.38, 0.42, 0, 0, 0, 0, [0.16, 0.16, 0.1]);
  add(g, GEO.box, stone, 0, 0.17, 0.42, 0.3, 0, 0, [0.5, 0.08, 0.16]);
  eyes(g, eye, 0.19, 0.08, 0.46);
}
function figKomodo(g, stone, accent, eye) { // Komodo: cabeza de lagarto con cresta de llama
  const skin = M(0x7f9a58), belly = M(0xd8c890);
  add(g, GEO.sph, skin, 0, 0, 0, 0, 0, 0, [0.44, 0.36, 0.55]);                 // cráneo
  add(g, GEO.sph, skin, 0, -0.06, 0.55, 0, 0, 0, [0.32, 0.2, 0.5]);            // hocico largo
  add(g, GEO.sph, belly, 0, -0.2, 0.45, 0, 0, 0, [0.3, 0.1, 0.5]);             // mandíbula clara
  add(g, GEO.box, stone, 0, -0.13, 0.62, 0, 0, 0, [0.5, 0.03, 0.62]);          // línea de la boca (sonrisa)
  for (const s of SIDES) {
    add(g, GEO.sph, skin, s * 0.24, 0.2, 0.28, 0, 0, 0, [0.15, 0.12, 0.16]);   // relieve de los ojos
    add(g, GEO.sph, M(0xffffff), s * 0.27, 0.22, 0.36, 0, 0, 0, 0.1);
    add(g, GEO.sph, eye, s * 0.29, 0.23, 0.43, 0, 0, 0, 0.055);
    add(g, GEO.sph, accent, s * 0.07, -0.02, 1.03, 0, 0, 0, 0.03);            // fosas nasales
  }
  for (let i = 0; i < 6; i++) add(g, GEO.cone, accent, 0, 0.36 + Math.sin(i * 0.6) * 0.06, 0.25 - i * 0.17, -0.35, 0, 0, [0.12, 0.38 + (i < 3 ? i * 0.08 : (5 - i) * 0.08), 0.09]);
  for (const s of SIDES) add(g, GEO.cone, accent, s * 0.32, 0.25, -0.18, -0.9, 0, s * -0.7, [0.08, 0.32, 0.08]);
}
function figFennec(g, stone, accent, eye) { // Feneco: orejas enormes
  add(g, GEO.sph, stone, 0, 0, 0, 0, 0, 0, [0.42, 0.38, 0.4]);
  add(g, GEO.cone, stone, 0, -0.1, 0.45, Math.PI / 2, 0, 0, [0.17, 0.4, 0.15]);
  add(g, GEO.sph, accent, 0, -0.1, 0.66, 0, 0, 0, 0.06);
  for (const s of SIDES) {
    add(g, GEO.cone, stone, s * 0.42, 0.62, -0.02, 0, 0, s * -0.5, [0.3, 1.05, 0.1]);
    add(g, GEO.cone, accent, s * 0.42, 0.6, 0.05, 0, 0, s * -0.5, [0.19, 0.82, 0.04]);
    add(g, GEO.sph, stone, s * 0.27, -0.18, 0.2, 0, 0, 0, [0.16, 0.12, 0.14]);
  }
  eyes(g, eye, 0.16, 0.07, 0.34);
}
function figFox(g, stone, accent, eye) {    // Zorra ártica: hocico fino y mejillas de pelo
  add(g, GEO.sph, stone, 0, 0, 0, 0, 0, 0, [0.42, 0.38, 0.4]);
  add(g, GEO.cone, stone, 0, -0.08, 0.48, Math.PI / 2, 0, 0, [0.18, 0.5, 0.14]);
  add(g, GEO.sph, accent, 0, -0.06, 0.74, 0, 0, 0, 0.055);
  for (const s of SIDES) {
    add(g, GEO.cone, stone, s * 0.25, 0.46, -0.02, 0, 0, s * -0.3, [0.17, 0.48, 0.1]);
    add(g, GEO.cone, accent, s * 0.25, 0.44, 0.04, 0, 0, s * -0.3, [0.1, 0.34, 0.04]);
    add(g, GEO.cone, stone, s * 0.4, -0.2, 0.08, 0, 0, s * 2.1, [0.15, 0.35, 0.12]);
  }
  eyes(g, eye, 0.16, 0.08, 0.33);
}
function figEagle(g, white, gold, eye) {    // Águila con las alas abiertas
  add(g, GEO.sph, white, 0, -0.6, 0, 0, 0, 0, [0.42, 0.62, 0.36]);
  add(g, GEO.sph, white, 0, 0.15, 0.08, 0, 0, 0, [0.32, 0.3, 0.32]);
  add(g, GEO.cone, gold, 0, 0.06, 0.42, Math.PI / 2 + 0.5, 0, 0, [0.1, 0.3, 0.09]);
  eyes(g, eye, 0.15, 0.22, 0.3, 0.05);
  for (const s of SIDES) {
    const w = grp(g, s * 0.3, -0.35, -0.05);
    w.rotation.z = s * 0.35;
    for (let i = 0; i < 7; i++) {
      const L = 0.9 + i * 0.16, a = s * (0.15 + i * 0.13);
      add(w, GEO.box, i % 2 ? gold : white, s * (0.15 + i * 0.27), 0.25 + i * 0.07, -i * 0.01, 0, 0, a + s * 1.2, [0.18, L, 0.06]);
    }
  }
  for (let i = 0; i < 4; i++) add(g, GEO.box, white, (i - 1.5) * 0.12, -1.25, -0.05, 0, 0, (i - 1.5) * 0.2, [0.12, 0.5, 0.05]);
}
function figOtter(g, stone, accent, eye) {  // Nutria: cabeza redonda, bigotes y gota entre las patas
  add(g, GEO.sph, stone, 0, 0, 0, 0, 0, 0, [0.46, 0.4, 0.4]);
  add(g, GEO.sph, stone, 0, -0.14, 0.32, 0, 0, 0, [0.26, 0.17, 0.16]);
  add(g, GEO.sph, accent, 0, -0.08, 0.47, 0, 0, 0, [0.07, 0.05, 0.05]);
  for (const s of SIDES) {
    add(g, GEO.sph, stone, s * 0.36, 0.26, -0.05, 0, 0, 0, [0.1, 0.1, 0.06]);
    for (let k = -1; k <= 1; k++) add(g, GEO.cyl, accent, s * 0.3, -0.13 + k * 0.04, 0.4, 0, 0, Math.PI / 2 + k * 0.15 * s, [0.008, 0.32, 0.008]);
    add(g, GEO.sph, stone, s * 0.16, -0.5, 0.3, 0, 0, 0, [0.12, 0.1, 0.12]);
  }
  add(g, GEO.oct, accent, 0, -0.5, 0.42, 0, 0, 0, [0.12, 0.18, 0.12]);
  eyes(g, eye, 0.16, 0.06, 0.34, 0.06);
}
function figLynx(g, stone, accent, eye, tuft) { // Lince: penachos en las orejas y collar de pelo
  add(g, GEO.sph, stone, 0, 0, 0, 0, 0, 0, [0.46, 0.42, 0.42]);
  add(g, GEO.sph, stone, 0, -0.16, 0.34, 0, 0, 0, [0.24, 0.16, 0.16]);
  add(g, GEO.sph, accent, 0, -0.1, 0.5, 0, 0, 0, [0.07, 0.05, 0.05]);
  for (const s of SIDES) {
    add(g, GEO.cone, stone, s * 0.27, 0.47, 0, 0, 0, s * -0.2, [0.15, 0.42, 0.1]);
    add(g, GEO.cone, tuft, s * 0.31, 0.78, 0, 0, 0, s * -0.2, [0.03, 0.26, 0.03]);
    for (let k = 0; k < 3; k++) add(g, GEO.cone, stone, s * (0.42 + k * 0.04), -0.22 - k * 0.1, 0.06, 0, 0, s * (2.2 + k * 0.25), [0.12, 0.32, 0.1]);
  }
  eyes(g, eye, 0.17, 0.07, 0.36);
}

/* =====================================================================
   LAS SIETE ARQUITECTURAS
   Cada constructor devuelve { root, field, motes, runners, anims[], beacon, light }
   ===================================================================== */
function base(el, colors) {
  const root = new THREE.Group();
  root.name = 'portal-' + el;
  const anims = [];
  const pulses = [];
  const pulse = (mat, amp = 0.25, speed = 2, ph = 0) => { pulses.push({ mat, base: mat.color.clone(), amp, speed, ph }); return mat; };
  const field = makeField(el, colors[0], colors[1], colors[2]);
  const fm = live(new THREE.Mesh(FIELD_GEO, field));
  fm.renderOrder = 2;
  fm.position.z = 0;
  root.add(fm);
  // segunda lámina, ligeramente retrasada: da volumen al campo visto de lado
  const fm2 = live(new THREE.Mesh(FIELD_GEO, field));
  fm2.position.z = -0.22; fm2.scale.set(0.97, 0.985, 1); fm2.renderOrder = 1;
  root.add(fm2);
  return { root, field, anims, pulses, pulse };
}

function buildRoca(mobile) {          // 1. SANTUARIO DE LA MONTAÑA — Jaglion
  const P = base('roca', [0xd89a3a, 0xffd86a, 0xffb020]);
  const { root } = P;
  const stone = M(0xb19a7c), stone2 = M(0x9b8466), light = M(0xcdb796);
  const gold = M(0xffc23a, { emissive: 0x7a4a00, emissiveIntensity: 0.4 });
  const gem = P.pulse(glow(0xffc040, 2.2), 0.3, 2.2);
  const crack = P.pulse(glow(0xffb020, 2.0), 0.35, 1.6, 1);
  const rnd = mulberry(11);
  platform(root, light, stone2, crack, { seg: 11, studMat: gem });
  for (let i = 0; i < 9; i++) {      // rocas sueltas alrededor de la plataforma
    const a = (i / 9) * TAU + 0.3;
    add(root, GEO.dode, i % 2 ? stone : stone2, Math.cos(a) * 3.45, 0.1, Math.sin(a) * 3.45, rnd(), rnd() * 3, 0, [0.35 + rnd() * 0.25, 0.25 + rnd() * 0.2, 0.3 + rnd() * 0.2]);
  }
  for (const s of SIDES) {          // columnas de bloques apilados
    const x = s * COL;
    for (let k = 0; k < 5; k++) {
      const h = 0.78;
      add(root, GEO.box, k % 2 ? stone : stone2, x + (rnd() - 0.5) * 0.08, 0.2 + k * h + h / 2, (rnd() - 0.5) * 0.06, 0, (rnd() - 0.5) * 0.18, 0, [1.05 - k * 0.04, h - 0.04, 1.05 - k * 0.04]);
    }
    add(root, GEO.box, stone2, x, 0.3, 0, 0, 0, 0, [1.45, 0.4, 1.4]);
    add(root, GEO.box, light, x, HC + 0.05, 0, 0, 0, 0, [1.3, 0.28, 1.25]);
    for (const k of [1.2, 2.5]) {   // cristales dorados incrustados
      crystal(root, gem, x - s * 0.55, k, 0.25, 0.55, s * 0.5);
      crystal(root, gem, x + s * 0.1, k + 0.55, 0.56, 0.45, 0.3);
    }
    for (let k = 0; k < 3; k++) add(root, GEO.box, crack, x + (rnd() - 0.5) * 0.4, 0.8 + k * 1.1, 0.535, 0, 0, (rnd() - 0.5) * 1.2, [0.05, 0.5, 0.02]);
    for (let k = 0; k < 3; k++) add(root, GEO.dode, k % 2 ? stone : stone2, x + s * (0.75 + rnd() * 0.3), 0.3 + rnd() * 0.3, (rnd() - 0.5) * 1.6, rnd(), rnd(), 0, 0.3 + rnd() * 0.2);
    // minerales a los lados
    for (let k = 0; k < 3; k++) crystal(root, gem, x + s * (0.95 + k * 0.18), 0.4 + k * 0.08, 0.6 - k * 0.5, 0.7 - k * 0.12, s * (0.4 + k * 0.2));
  }
  archBlocks(root, stone, { r0: W, r1: W + 0.85, depth: 1.05, n: 9, jit: 0.15, rnd, keyMat: light });
  add(root, arcSlab(W + 0.84, W + 0.96, 0.08, Math.PI - 0.08, 0.6, 0.02), gold, 0, HC, 0.25);
  for (let i = 1; i < 9; i++) { const a = (i / 9) * Math.PI; add(root, GEO.box, crack, Math.cos(a) * (W + 0.42), HC + Math.sin(a) * (W + 0.42), 0.54, 0, 0, a, [0.04, 0.6, 0.02]); }
  const fig = grp(root, 0, HC + W + 1.35, 0.2);
  add(fig, GEO.dode, stone2, 0, -0.75, -0.1, 0, 0, 0, [0.7, 0.35, 0.5]);
  figLion(fig, light, gold, gem);
  fig.scale.setScalar(1.55); fig.position.y += 0.4;
  P.motes = (parent) => new Motes(parent, GEO.ico, M(0xb8a080, { emissive: 0xffa020, emissiveIntensity: 0.25 }), mobile ? 14 : 24, 'orbit', { size: 0.13, r0: 0.5, r1: 2.0, speed: 0.6 });
  P.extra = (parent) => new Motes(parent, GEO.oct, glow(0xffd060, 2.4), mobile ? 14 : 26, 'rise', { size: 0.05, speed: 0.6 });
  P.runners = (parent) => new Runners(parent, GEO.ico, glow(0xffc040, 2.6), 26, 'spiral');
  P.runnerScale = 0.16;
  P.beacon = [1.0, 0.72, 0.25];
  P.light = 0xffc060;
  return P;
}

function buildFuego(mobile) {         // 2. SANTUARIO DE LA LLAMA — Komodo
  const P = base('fuego', [0xff4a1a, 0xffc23a, 0xff7a20]);
  const { root, anims } = P;
  const basalt = M(0x5a4e5c), basalt2 = M(0x463c4a), ash = M(0x8a7a80);
  const lava = P.pulse(glow(0xff6a10, 2.2), 0.35, 2.6);
  const gemR = P.pulse(glow(0xff3020, 2.0), 0.3, 1.8, 1), gemO = P.pulse(glow(0xffa020, 2.2), 0.3, 2.0, 2);
  const flameA = glowT(0xff8a20, 2.2, 0.85), flameB = glowT(0xffe060, 2.6, 0.9);
  platform(root, ash, basalt2, lava, { seg: 14, studMat: gemO });
  const flames = [];
  const flame = (parent, x, y, z, s) => {
    const f = grp(parent, x, y, z, true);
    add(f, GEO.cone, flameA, 0, 0.5, 0, 0, 0, 0, [0.32, 1.0, 0.32]);
    add(f, GEO.cone, flameB, 0, 0.38, 0.02, 0, 0, 0, [0.18, 0.7, 0.18]);
    f.scale.setScalar(s);
    flames.push({ f, s, ph: Math.random() * 10 });
    return f;
  };
  for (const s of SIDES) {
    const x = s * COL;
    // columna en forma de llama: tambores que se estrechan y giran
    for (let k = 0; k < 6; k++) {
      const r = 0.55 - k * 0.035;
      add(root, GEO.cyl6, k % 2 ? basalt : basalt2, x, 0.4 + k * 0.6, 0, 0, k * 0.35, 0, [r, 0.62, r]);
      add(root, GEO.cone6, basalt, x + Math.cos(k * 2.1) * r * 0.9, 0.55 + k * 0.6, Math.sin(k * 2.1) * r * 0.9, 0, 0, Math.cos(k * 2.1) * -0.6, [0.14, 0.5, 0.14]);
    }
    add(root, GEO.cyl6, basalt2, x, 0.25, 0, 0, 0, 0, [0.78, 0.4, 0.78]);
    for (let k = 0; k < 4; k++) add(root, GEO.box, lava, x + (k % 2 ? 0.2 : -0.18) * s, 0.7 + k * 0.8, 0.5, 0, 0, (k % 2 ? 0.5 : -0.4), [0.06, 0.55, 0.03]);
    crystal(root, gemR, x, 2.0, 0.55, 0.6);
    crystal(root, gemO, x - s * 0.5, 3.1, 0.25, 0.45, s * 0.4);
    // brasero lateral con fuego mágico
    const bx = x + s * 1.15;
    add(root, GEO.cyl6, basalt2, bx, 0.45, 0.4, 0, 0, 0, [0.22, 0.9, 0.22]);
    add(root, lathe([[0.05, 0], [0.42, 0.12], [0.5, 0.4], [0.4, 0.42], [0.3, 0.2], [0.05, 0.15]], 12), basalt, bx, 0.88, 0.4);
    add(root, GEO.cyl, lava, bx, 1.26, 0.4, 0, 0, 0, [0.36, 0.04, 0.36]);
    flame(root, bx, 1.2, 0.4, 0.95);
    // decoración de llamas de piedra a los lados
    for (let k = 0; k < 3; k++) add(root, GEO.cone, basalt, x + s * (0.65 + k * 0.08), 0.6 + k * 1.1, -0.2, 0, 0, s * -0.35, [0.2, 0.9 - k * 0.15, 0.16]);
  }
  archBlocks(root, basalt, { r0: W, r1: W + 0.75, depth: 0.95, n: 11, jit: 0.08, rnd: mulberry(5), keyMat: basalt2 });
  add(root, arcSlab(W + 0.04, W + 0.14, 0.05, Math.PI - 0.05, 1.0, 0.02), lava, 0, HC, 0);
  for (let i = 0; i < 9; i++) {      // corona de llamas sobre el arco
    const a = 0.25 + (i / 8) * (Math.PI - 0.5);
    add(root, GEO.cone, basalt2, Math.cos(a) * (W + 0.85), HC + Math.sin(a) * (W + 0.85), 0, 0, 0, a - Math.PI / 2, [0.2, 0.55, 0.2]);
    if (i % 2 === 0) flame(root, Math.cos(a) * (W + 1.05), HC + Math.sin(a) * (W + 1.05) - 0.1, 0, 0.4).rotation.z = a - Math.PI / 2;
  }
  const fig = grp(root, 0, HC + W + 1.35, 0.25);
  add(fig, GEO.cyl6, basalt2, 0, -0.65, -0.1, 0, 0, 0, [0.55, 0.3, 0.5]);
  figKomodo(fig, ash, gemO, flameB);
  fig.scale.setScalar(1.55); fig.position.y += 0.4;
  anims.push((t) => {
    for (const q of flames) {
      const k = 1 + Math.sin(t * 9 + q.ph) * 0.1 + Math.sin(t * 15.3 + q.ph * 2) * 0.06;
      q.f.scale.set(q.s * (2 - k), q.s * k, q.s * (2 - k));
    }
  });
  P.motes = (parent) => new Motes(parent, GEO.oct, glow(0xffa030, 2.6), mobile ? 20 : 36, 'rise', { size: 0.05, speed: 1.4 });
  P.runners = (parent) => new Runners(parent, GEO.cone, glowT(0xffa030, 2.6, 0.9), 32, 'arch');
  P.runnerScale = 0.3;
  P.beacon = [1.0, 0.45, 0.12];
  P.light = 0xff7a30;
  return P;
}

function buildArena(mobile) {         // 3. SANTUARIO DE LAS DUNAS — Feneco
  const P = base('arena', [0xe0b066, 0xffe08a, 0xffa848]);
  const { root, anims } = P;
  const sand = M(0xe8c88e), sand2 = M(0xd4ac6c), sand3 = M(0xf3dcae);
  const gemY = P.pulse(glow(0xffd040, 2.2), 0.3, 1.8), gemO = P.pulse(glow(0xff9a30, 2.1), 0.3, 2.2, 1.5);
  const rune = P.pulse(glow(0xffc060, 1.8), 0.3, 1.4);
  platform(root, sand3, sand2, rune, { seg: 40, studMat: gemO });
  for (let i = 0; i < 3; i++) add(root, new THREE.TorusGeometry(3.4 + i * 0.25, 0.1, 6, 40), sand, 0, 0.04, 0, Math.PI / 2, 0, 0, [1, 1, 0.5]);
  // columnas onduladas como dunas
  const prof = [];
  for (let i = 0; i <= 14; i++) { const y = (i / 14) * 3.9; prof.push([0.5 + Math.sin(y * 2.4) * 0.09 + (y < 0.4 ? 0.2 * (1 - y / 0.4) : 0), y]); }
  prof.unshift([0, 0]); prof.push([0, 3.9]);
  const colG = lathe(prof, 18);
  for (const s of SIDES) {
    const x = s * COL;
    add(root, colG, sand, x, 0.1, 0);
    for (let k = 0; k < 4; k++) add(root, GEO.tor, sand2, x, 0.55 + k * 0.95, 0, Math.PI / 2, 0, 0, [0.6, 0.6, 1.2]);
    add(root, GEO.box, sand2, x, HC + 0.05, 0, 0, 0, 0, [1.2, 0.28, 1.15]);
    crystal(root, gemY, x, 1.5, 0.58, 0.55);
    crystal(root, gemO, x, 2.9, 0.56, 0.45);
    // duna lateral con cristales
    add(root, GEO.sph, sand2, x + s * 1.05, 0.05, 0.1, 0, 0, 0, [0.9, 0.55, 1.1]);
    crystal(root, gemY, x + s * 1.2, 0.6, 0.4, 0.8, s * 0.35);
    crystal(root, gemO, x + s * 0.95, 0.5, -0.4, 0.6, s * -0.3);
  }
  add(root, arcSlab(W, W + 0.8, 0, Math.PI, 0.95, 0.12, 32), sand, 0, HC, 0);
  for (let i = 0; i < 5; i++) add(root, arcSlab(W + 0.1 + i * 0.13, W + 0.17 + i * 0.13, 0.05, Math.PI - 0.05, 1.0, 0.01, 32), i % 2 ? sand2 : sand3, 0, HC, 0.04);
  for (let i = 0; i < 7; i++) { const a = (i + 0.5) / 7 * Math.PI; add(root, GEO.sph, rune, Math.cos(a) * (W + 0.42), HC + Math.sin(a) * (W + 0.42), 0.5, 0, 0, 0, 0.07); }
  // grandes orejas de feneco integradas en la parte superior
  for (const s of SIDES) {
    const e = grp(root, s * 1.75, HC + W + 0.55, -0.05);
    e.rotation.z = s * -0.55;
    add(e, GEO.cone, sand, 0, 1.1, 0, 0, 0, 0, [0.85, 2.3, 0.28]);
    add(e, GEO.cone, sand3, 0, 1.0, 0.14, 0, 0, 0, [0.58, 1.85, 0.08]);
    add(e, GEO.cone, P.pulse(glowT(0xffb060, 1.6, 0.6), 0.3, 1.5, s), 0, 1.0, 0.2, 0, 0, 0, [0.3, 1.3, 0.02]);
  }
  const fig = grp(root, 0, HC + W + 1.15, 0.3);
  add(fig, GEO.cyl, sand2, 0, -0.6, -0.1, 0, 0, 0, [0.5, 0.22, 0.45]);
  figFennec(fig, sand3, gemO, gemY);
  fig.scale.setScalar(1.55); fig.position.y += 0.4;
  const veil = live(add(root, new THREE.TorusGeometry(3.6, 0.03, 4, 60), glowT(0xffd080, 1.8, 0.5), 0, 0.08, 0, Math.PI / 2));
  anims.push((t) => { veil.rotation.z = t * 0.4; veil.scale.setScalar(1 + Math.sin(t * 1.4) * 0.02); });
  P.motes = (parent) => new Motes(parent, GEO.oct, glow(0xffd870, 2.4), mobile ? 24 : 44, 'swirl', { size: 0.045, speed: 1.2 });
  P.runners = (parent) => new Runners(parent, GEO.oct, glow(0xffc050, 2.4), 40, 'ring');
  P.runnerScale = 0.09;
  P.beacon = [1.0, 0.8, 0.4];
  P.light = 0xffc070;
  return P;
}

function snowTex() {
  const c = makeCanvas(128), g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.lineWidth = 7; g.lineCap = 'round';
  g.translate(64, 64);
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -54); g.moveTo(0, -30); g.lineTo(-14, -44); g.moveTo(0, -30); g.lineTo(14, -44); g.stroke();
  }
  return texFromCanvas(c);
}
function buildHielo(mobile) {         // 4. SANTUARIO DE CRISTAL — Zorra ártica
  const P = base('hielo', [0x7ac8ff, 0xf0f8ff, 0xb08aff]);
  const { root, anims } = P;
  const ice = M(0xbfe6ff, { transparent: true, opacity: 0.9, emissive: 0x3a7ab0, emissiveIntensity: 0.25 });
  const ice2 = M(0x9ad4ff, { transparent: true, opacity: 0.88, emissive: 0x2a5a9a, emissiveIntensity: 0.3 });
  const snow = M(0xf4f9ff), frost = M(0xdff1ff);
  const glint = P.pulse(glow(0x9ad8ff, 2.2), 0.3, 2.0), violet = P.pulse(glow(0xc0a0ff, 2.0), 0.3, 1.6, 2);
  platform(root, snow, frost, glint, { seg: 6, studMat: violet });
  add(root, new THREE.CylinderGeometry(2.9, 2.9, 0.02, 6), P.pulse(glowT(0xbfe8ff, 1.3, 0.35), 0.2, 1.2), 0, 0.17, 0);
  const rnd = mulberry(23);
  for (const s of SIDES) {
    const x = s * COL;
    // columna: haz de prismas hexagonales con puntas
    add(root, GEO.cyl6, ice, x, 2.0, 0, 0, 0.3, 0, [0.42, 4.0, 0.42]);
    add(root, GEO.cone6, ice, x, 4.25, 0, 0, 0.3, 0, [0.42, 0.6, 0.42]);
    for (let k = 0; k < 4; k++) {
      const a = k * 1.7 + s, h = 1.4 + rnd() * 1.6;
      const px = x + Math.cos(a) * 0.38, pz = Math.sin(a) * 0.38;
      add(root, GEO.cyl6, ice2, px, h / 2 + 0.1, pz, Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12, [0.2, h, 0.2]);
      add(root, GEO.cone6, ice2, px + Math.cos(a) * h * 0.06, h + 0.3, pz + Math.sin(a) * h * 0.06, Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12, [0.2, 0.4, 0.2]);
    }
    add(root, GEO.cyl6, frost, x, 0.25, 0, 0, 0, 0, [0.72, 0.35, 0.72]);
    // grandes cristales a ambos lados
    for (let k = 0; k < 3; k++) {
      const h = 2.6 - k * 0.7;
      add(root, GEO.cyl6, ice, x + s * (0.95 + k * 0.4), h / 2, -0.2 + k * 0.35, 0, 0, s * -(0.25 + k * 0.12), [0.22, h, 0.22]);
      add(root, GEO.cone6, ice, x + s * (0.95 + k * 0.4) + s * Math.sin(0.25 + k * 0.12) * h * 0.5, h + 0.2 - k * 0.05, -0.2 + k * 0.35, 0, 0, s * -(0.25 + k * 0.12), [0.22, 0.45, 0.22]);
    }
    add(root, GEO.sph, snow, x + s * 1.2, 0.05, 0, 0, 0, 0, [0.9, 0.3, 0.9]);
    crystal(root, violet, x, 2.3, 0.45, 0.4);
  }
  // arco de cristal en abanico
  add(root, arcSlab(W, W + 0.55, 0, Math.PI, 0.7, 0.05, 32), ice, 0, HC, 0);
  for (let i = 0; i < 15; i++) {
    const a = (i / 14) * Math.PI, L = 0.5 + Math.sin(a) * 0.75 + rnd() * 0.25;
    add(root, GEO.cone6, i % 2 ? ice : ice2, Math.cos(a) * (W + 0.5 + L / 2), HC + Math.sin(a) * (W + 0.5 + L / 2), (rnd() - 0.5) * 0.3, 0, 0, a - Math.PI / 2, [0.17, L, 0.17]);
  }
  add(root, arcSlab(W - 0.02, W + 0.06, 0.03, Math.PI - 0.03, 0.75, 0.01, 32), glint, 0, HC, 0);
  // copos decorativos
  const flakeM = new THREE.MeshBasicMaterial({ map: snowTex(), color: new THREE.Color(0xdff2ff).multiplyScalar(1.6), transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  for (let i = 0; i < 7; i++) { const a = (i + 0.5) / 7 * Math.PI; add(root, GEO.plane, flakeM, Math.cos(a) * (W + 0.28), HC + Math.sin(a) * (W + 0.28), 0.37, 0, 0, a, 0.32); }
  for (const s of SIDES) for (let k = 0; k < 3; k++) add(root, GEO.plane, flakeM, s * (COL + 0.02), 0.9 + k * 1.1, 0.44, 0, 0, k, 0.3);
  const fig = grp(root, 0, HC + W + 1.45, 0.15);
  add(fig, GEO.cyl6, frost, 0, -0.65, -0.1, 0, 0, 0, [0.5, 0.25, 0.45]);
  figFox(fig, snow, violet, glint);
  fig.scale.setScalar(1.55); fig.position.y += 0.4;
  // aurora sobre el arco
  const aur = live(add(root, new THREE.PlaneGeometry(7, 2.2, 24, 1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; uniform float uT; void main(){ vUv=uv; vec3 p=position; p.z += sin(p.x*1.3+uT*0.8)*0.35; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.); }',
    fragmentShader: 'varying vec2 vUv; uniform float uT; void main(){ float b = 0.5+0.5*sin(vUv.x*14.0+uT*1.3+sin(vUv.x*5.0-uT)*2.0); float a = b*vUv.y*(1.0-vUv.y)*4.0*smoothstep(0.0,0.15,vUv.x)*smoothstep(1.0,0.85,vUv.x)*0.35; vec3 c = mix(vec3(0.3,1.0,0.8), vec3(0.7,0.5,1.0), vUv.x); gl_FragColor=vec4(c*1.4, a); }',
  }), 0, HC + W + 2.4, -0.6));
  anims.push((t) => { aur.material.uniforms.uT.value = t; });
  P.motes = (parent) => new Motes(parent, GEO.plane, flakeM, mobile ? 18 : 32, 'fall', { size: 0.16, speed: 0.8, zs: 1.6 });
  P.extra = (parent) => new Motes(parent, GEO.oct, glow(0xbfe8ff, 2.2), mobile ? 10 : 18, 'orbit', { size: 0.08, r0: 0.6, r1: 2.0, speed: 0.5 });
  P.runners = (parent) => new Runners(parent, GEO.oct, glow(0xe0f4ff, 3.0), 36, 'twinkle');
  P.runnerScale = 0.14;
  P.beacon = [0.55, 0.85, 1.0];
  P.light = 0x9ad8ff;
  return P;
}

function featherGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5); s.quadraticCurveTo(0.22, 0, 0, 0.5); s.quadraticCurveTo(-0.22, 0, 0, -0.5);
  return new THREE.ShapeGeometry(s, 6);
}
function buildAire(mobile) {          // 5. SANTUARIO DE LAS NUBES — Águila
  const P = base('aire', [0x8fd4ff, 0xffffff, 0xffd870]);
  const { root, anims } = P;
  const white = M(0xf8f8f4), cream = M(0xece4d2);
  const gold = M(0xffcf5a, { emissive: 0x7a5200, emissiveIntensity: 0.35 });
  const sky = P.pulse(glow(0x9ad8ff, 2.0), 0.25, 1.6), goldG = P.pulse(glow(0xffd870, 2.0), 0.3, 2.0, 1);
  const cloud = M(0xffffff, { emissive: 0xbad8ff, emissiveIntensity: 0.25 });
  platform(root, white, cream, goldG, { seg: 48, studMat: sky });
  add(root, new THREE.TorusGeometry(3.0, 0.06, 6, 64), gold, 0, 0.18, 0, Math.PI / 2);
  // columnas ligeras y estilizadas
  const prof = [[0, 0], [0.42, 0], [0.42, 0.18], [0.3, 0.3], [0.24, 0.5], [0.2, 2.0], [0.22, 3.4], [0.34, 3.62], [0.4, 3.8], [0, 3.8]];
  const colG = lathe(prof, 20);
  for (const s of SIDES) {
    const x = s * COL;
    add(root, colG, white, x, 0.12, 0);
    for (const y of [0.6, 1.8, 3.0]) add(root, GEO.tor, gold, x, y, 0, Math.PI / 2, 0, 0, [0.24, 0.24, 1]);
    add(root, GEO.box, cream, x, HC + 0.1, 0, 0, 0, 0, [0.95, 0.16, 0.9]);
  }
  add(root, arcSlab(W + 0.05, W + 0.4, 0, Math.PI, 0.5, 0.05, 40), white, 0, HC, 0);
  add(root, arcSlab(W + 0.4, W + 0.5, 0.02, Math.PI - 0.02, 0.3, 0.02, 40), gold, 0, HC, 0);
  // grandes alas que nacen de los laterales
  const fG = featherGeo();
  const wings = [];
  for (const s of SIDES) {
    const w = grp(root, s * (COL + 0.3), HC - 0.2, -0.15, true);
    for (let i = 0; i < 9; i++) {
      const a = 0.25 + i * 0.16, L = 1.3 + Math.sin(i / 8 * Math.PI) * 1.3 + i * 0.05;
      const f = add(w, fG, i % 3 === 1 ? cream : white, s * Math.cos(a) * L * 0.5, Math.sin(a) * L * 0.5 - 0.2, -i * 0.012, 0, 0, s * (a - Math.PI / 2), [1.3, L, 1]);
      f.material.side = THREE.DoubleSide;
      if (i % 2 === 0) add(w, fG, goldG, s * Math.cos(a) * L * 0.5, Math.sin(a) * L * 0.5 - 0.2, 0.01 - i * 0.012, 0, 0, s * (a - Math.PI / 2), [0.15, L * 0.92, 1]);
    }
    wings.push({ w, s });
  }
  white.side = cream.side = THREE.DoubleSide;
  // nubes decorativas
  const clouds = [];
  for (const [x, y, z, s] of [[-3.7, 0.5, 0.6, 0.7], [3.6, 0.6, -0.5, 0.8], [-3.3, 5.0, -0.4, 0.55], [3.4, 5.4, 0.3, 0.6], [0, 0.35, 2.9, 0.45]]) {
    const c = grp(root, x, y, z, true);
    for (let k = 0; k < 4; k++) add(c, GEO.sph, cloud, (k - 1.5) * 0.45 * s, Math.sin(k * 1.9) * 0.15 * s, Math.cos(k * 2.3) * 0.2 * s, 0, 0, 0, (0.45 + (k % 2) * 0.15) * s);
    clouds.push({ c, y, ph: x });
  }
  const fig = grp(root, 0, HC + W + 1.7, 0.1);
  add(fig, GEO.cyl, cream, 0, -1.45, -0.05, 0, 0, 0, [0.4, 0.18, 0.35]);
  figEagle(fig, white, gold, sky);
  fig.scale.setScalar(1.55); fig.position.y += 0.4;
  anims.push((t) => {
    for (const q of wings) q.w.rotation.z = q.s * Math.sin(t * 1.2) * 0.05;
    for (const q of clouds) q.c.position.y = q.y + Math.sin(t * 0.8 + q.ph) * 0.12;
  });
  P.motes = (parent) => new Motes(parent, fG, glowT(0xfff4d0, 1.9, 0.85), mobile ? 14 : 24, 'ring', { size: 0.3, r0: 3.1, r1: 4.0, speed: 0.9 });
  P.extra = (parent) => new Motes(parent, GEO.oct, glow(0xbfe8ff, 2.2), mobile ? 12 : 22, 'orbit', { size: 0.05, r0: 0.4, r1: 2.0, speed: 1.6 });
  P.runners = (parent) => new Runners(parent, GEO.cyl, glowT(0xdff4ff, 2.4, 0.7), 30, 'stream');
  P.runnerScale = [0.03, 1.6, 0.03];
  P.beacon = [0.7, 0.9, 1.0];
  P.light = 0xbfe4ff;
  return P;
}

function waterTex() {
  const c = makeCanvas(64, 256), g = c.getContext('2d');
  g.fillStyle = 'rgba(120,220,255,0.55)'; g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.5})`; g.fillRect(Math.random() * 60, Math.random() * 256, 2 + Math.random() * 4, 18 + Math.random() * 40); }
  const t = texFromCanvas(c, { repeat: true });
  return t;
}
function buildAgua(mobile) {          // 6. SANTUARIO DE LAS CORRIENTES — Nutria
  const P = base('agua', [0x1a9ad8, 0x5af0e0, 0x9af8ff]);
  const { root, anims } = P;
  const riv = M(0x8aa0a8), riv2 = M(0x6f8a94), riv3 = M(0xa8bcc0);
  const aqua = M(0x5ad8e0, { transparent: true, opacity: 0.88, emissive: 0x1a7a90, emissiveIntensity: 0.35 });
  const turq = P.pulse(glow(0x40f0e0, 2.1), 0.3, 1.8), deep = P.pulse(glow(0x3aa8ff, 2.0), 0.3, 1.4, 1);
  platform(root, riv3, riv2, turq, { seg: 40, studMat: deep });
  const pool = live(add(root, new THREE.RingGeometry(2.0, 2.9, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5ad8ff).multiplyScalar(1.3), transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }), 0, 0.175, 0, -Math.PI / 2));
  const rnd = mulberry(31);
  // columnas onduladas de cristal y piedras de río
  for (const s of SIDES) {
    const x = s * COL;
    const prof = [];
    for (let i = 0; i <= 12; i++) { const y = (i / 12) * 3.7; prof.push([0.36 + Math.sin(y * 3.2 + s) * 0.07, y]); }
    prof.unshift([0, 0]); prof.push([0, 3.7]);
    add(root, lathe(prof, 16), aqua, x, 0.15, 0);
    for (let k = 0; k < 6; k++) add(root, GEO.sph, k % 2 ? riv : riv2, x + Math.cos(k * 2.4) * 0.42, 0.3 + k * 0.62, Math.sin(k * 2.4) * 0.42, 0, k, 0, [0.28, 0.17, 0.24]);
    add(root, GEO.sph, riv2, x, 0.25, 0, 0, 0, 0, [0.75, 0.3, 0.7]);
    add(root, GEO.sph, riv3, x, HC + 0.05, 0, 0, 0, 0, [0.62, 0.22, 0.58]);
    crystal(root, turq, x, 1.9, 0.45, 0.5);
    for (let k = 0; k < 3; k++) crystal(root, k % 2 ? deep : turq, x + s * (0.8 + k * 0.25), 0.35, 0.5 - k * 0.5, 0.6 - k * 0.1, s * (0.3 + k * 0.2));
  }
  // arco de piedras de río
  for (let i = 0; i < 12; i++) {
    const a = (i + 0.5) / 12 * Math.PI, r = W + 0.42;
    add(root, GEO.sph, i % 2 ? riv : riv3, Math.cos(a) * r, HC + Math.sin(a) * r, 0, 0, 0, a, [0.5, 0.36 + rnd() * 0.06, 0.48]);
  }
  add(root, arcSlab(W - 0.02, W + 0.1, 0.02, Math.PI - 0.02, 0.85, 0.02, 32), turq, 0, HC, 0);
  for (let i = 0; i < 6; i++) { const a = (i + 0.5) / 6 * Math.PI; add(root, GEO.sph, deep, Math.cos(a) * (W + 0.84), HC + Math.sin(a) * (W + 0.84), 0.15, 0, 0, 0, [0.08, 0.12, 0.08]); }
  // pequeñas cascadas a los lados
  const wt = waterTex();
  const fallM = new THREE.MeshBasicMaterial({ map: wt, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(0xbff4ff).multiplyScalar(1.3) });
  for (const s of SIDES) {
    const x = s * (COL + 0.62);
    add(root, GEO.sph, riv, x, 3.55, 0.25, 0, 0, 0, [0.32, 0.2, 0.32]);
    add(root, new THREE.PlaneGeometry(0.5, 3.4), fallM, x, 1.85, 0.35, 0, 0, 0);
    add(root, GEO.cyl, aqua, x, 0.12, 0.35, 0, 0, 0, [0.45, 0.1, 0.45]);
  }
  const foam = [];
  for (const s of SIDES) { const f = live(add(root, GEO.tor, glowT(0xdff8ff, 1.5, 0.6), s * (COL + 0.62), 0.2, 0.35, Math.PI / 2, 0, 0, 0.35)); foam.push(f); }
  const fig = grp(root, 0, HC + W + 1.4, 0.2);
  add(fig, GEO.sph, riv2, 0, -0.75, -0.1, 0, 0, 0, [0.55, 0.25, 0.5]);
  figOtter(fig, riv3, turq, deep);
  fig.scale.setScalar(1.55); fig.position.y += 0.4;
  anims.push((t) => {
    wt.offset.y = (t * 1.2) % 1;
    pool.rotation.z = t * 0.2;
    pool.material.opacity = 0.45 + Math.sin(t * 2) * 0.1;
    for (const f of foam) { const k = (t * 0.9) % 1; f.scale.setScalar(0.3 + k * 0.35); f.material.opacity = 0.7 * (1 - k); }
  });
  P.motes = (parent) => new Motes(parent, GEO.sphLo, glowT(0xbff8ff, 1.7, 0.6), mobile ? 16 : 30, 'rise', { size: 0.08, speed: 0.9 });
  P.extra = (parent) => new Motes(parent, GEO.oct, glow(0x60f0e0, 2.2), mobile ? 10 : 18, 'orbit', { size: 0.05, r0: 0.4, r1: 2.0, speed: 1.0 });
  P.runners = (parent) => new Runners(parent, GEO.sphLo, glowT(0xdffcff, 2.2, 0.7), 34, 'bubbles');
  P.runnerScale = 0.12;
  P.beacon = [0.3, 0.9, 1.0];
  P.light = 0x60e0ff;
  return P;
}

function leafGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5); s.bezierCurveTo(0.4, -0.2, 0.3, 0.3, 0, 0.5); s.bezierCurveTo(-0.3, 0.3, -0.4, -0.2, 0, -0.5);
  return new THREE.ShapeGeometry(s, 6);
}
function buildTierra(mobile) {        // 7. SANTUARIO DE LA VIDA — Lince
  const P = base('tierra', [0x3aa84a, 0xb8f06a, 0xe0d070]);
  const { root, anims } = P;
  const stone = M(0xa89a84), stone2 = M(0x8f826c), moss = M(0x5aa83a), moss2 = M(0x7ac24a);
  const wood = M(0x8a5a32), wood2 = M(0x6e4628), soil = M(0x7a5a3a);
  const gemG = P.pulse(glow(0x60ff80, 2.1), 0.3, 1.8), sap = P.pulse(glow(0xb8ff6a, 1.9), 0.35, 1.4, 1);
  const rnd = mulberry(41);
  platform(root, moss2, soil, sap, { seg: 36, studMat: gemG });
  for (let i = 0; i < 22; i++) {     // hierba y flores sobre la plataforma
    const a = rnd() * TAU, r = 2.75 + rnd() * 0.5;
    add(root, GEO.cone, i % 3 ? moss : moss2, Math.cos(a) * r, 0.3, Math.sin(a) * r, (rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.4, [0.08, 0.35, 0.08]);
  }
  const petals = [M(0xff8ac0), M(0xffe060), M(0xffffff), M(0xb08aff)];
  const flower = (x, y, z, s = 1) => {
    const pm = petals[Math.floor(rnd() * petals.length)];
    for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; add(root, GEO.sphLo, pm, x + Math.cos(a) * 0.07 * s, y, z + Math.sin(a) * 0.07 * s, 0, 0, 0, [0.06 * s, 0.025 * s, 0.06 * s]); }
    add(root, GEO.sphLo, petals[1], x, y + 0.01, z, 0, 0, 0, 0.035 * s);
  };
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + 0.2; flower(Math.cos(a) * 3.1, 0.2, Math.sin(a) * 3.1, 1.2); }
  for (const s of SIDES) {
    const x = s * COL;
    add(root, GEO.cyl, stone, x, 2.0, 0, 0, 0, 0, [0.46, 3.8, 0.46]);
    add(root, GEO.cyl, stone2, x, 0.3, 0, 0, 0, 0, [0.62, 0.45, 0.62]);
    add(root, GEO.box, stone2, x, HC + 0.05, 0, 0, 0, 0, [1.15, 0.28, 1.1]);
    // raíces que abrazan la columna
    for (let r = 0; r < 3; r++) {
      const pts = [];
      for (let i = 0; i <= 20; i++) { const u = i / 20, a = u * 5.5 + r * 2.1; pts.push(new THREE.Vector3(x + Math.cos(a) * (0.5 + (1 - u) * 0.25), 0.05 + u * 3.6, Math.sin(a) * (0.5 + (1 - u) * 0.25))); }
      pts.unshift(new THREE.Vector3(x + Math.cos(r * 2.1) * 1.4, -0.05, Math.sin(r * 2.1) * 1.4));
      add(root, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.09 - r * 0.012, 6, false), r % 2 ? wood : wood2);
    }
    for (let k = 0; k < 5; k++) add(root, GEO.sphLo, k % 2 ? moss : moss2, x + Math.cos(k * 1.9) * 0.42, 0.8 + k * 0.7, Math.sin(k * 1.9) * 0.42, 0, 0, 0, [0.22, 0.13, 0.2]);
    crystal(root, gemG, x, 2.2, 0.5, 0.55);
    crystal(root, gemG, x + s * 1.1, 0.45, 0.3, 0.7, s * 0.4);
    crystal(root, sap, x + s * 0.9, 0.35, -0.45, 0.5, s * -0.3);
    // tronco cortado lateral con flores
    add(root, GEO.cyl, wood, x + s * 1.2, 0.3, -0.5, 0, 0, 0, [0.32, 0.6, 0.32]);
    add(root, GEO.cyl, M(0xd8b07a), x + s * 1.2, 0.61, -0.5, 0, 0, 0, [0.28, 0.02, 0.28]);
    flower(x + s * 1.2, 0.66, -0.5, 1.4);
    for (let k = 0; k < 4; k++) flower(x + s * (0.5 + rnd() * 0.2), 0.8 + k * 0.8, 0.4, 0.9);
  }
  archBlocks(root, stone, { r0: W, r1: W + 0.75, depth: 0.95, n: 7, jit: 0.1, rnd, keyMat: stone2 });
  for (let i = 0; i < 9; i++) {      // musgo que cubre parte del arco y lianas colgantes
    const a = (i + 0.5) / 9 * Math.PI;
    add(root, GEO.sphLo, i % 2 ? moss : moss2, Math.cos(a) * (W + 0.55), HC + Math.sin(a) * (W + 0.75), 0.1, 0, 0, a, [0.5, 0.18, 0.55]);
    if (i % 3 === 1) flower(Math.cos(a) * (W + 0.55), HC + Math.sin(a) * (W + 0.75) + 0.12, 0.35, 1.3);
  }
  const vines = [];
  for (const a of [0.55, 1.1, 2.05, 2.6]) {
    const v = grp(root, Math.cos(a) * (W + 0.05), HC + Math.sin(a) * (W + 0.05), 0.35, true);
    for (let k = 0; k < 5; k++) add(v, GEO.sphLo, k % 2 ? moss : moss2, 0, -k * 0.18, 0, 0, 0, 0, [0.07, 0.09, 0.07]);
    vines.push(v);
  }
  // rama de madera sobre la clave
  add(root, GEO.cyl, wood, 0, HC + W + 0.75, 0.15, 0, 0, Math.PI / 2, [0.12, 2.6, 0.12]);
  const lf = leafGeo();
  for (let i = 0; i < 8; i++) add(root, lf, i % 2 ? moss : moss2, -1.2 + i * 0.34, HC + W + 0.85 + Math.sin(i) * 0.1, 0.25, -0.5, 0, (i - 3.5) * 0.3, 0.35);
  moss.side = moss2.side = THREE.DoubleSide;
  // raíces mágicas que crecen en la animación de llegada
  const tendr = grp(root, 0, 0, 0, true);
  const tMat = P.pulse(glow(0x9aff6a, 1.8), 0.3, 2);
  for (let r = 0; r < 6; r++) {
    const a0 = (r / 6) * TAU + 0.4, pts = [];
    for (let i = 0; i <= 10; i++) { const u = i / 10; pts.push(new THREE.Vector3(Math.cos(a0 + u * 0.8) * (3.3 - u * 0.6), 0.15 + Math.sin(u * Math.PI) * 0.6 + u * 0.4, Math.sin(a0 + u * 0.8) * (3.3 - u * 0.6))); }
    add(tendr, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.04, 5, false), tMat);
  }
  tendr.scale.setScalar(0.001);
  tendr.visible = false;
  const fig = grp(root, 0, HC + W + 1.45, 0.25);
  add(fig, GEO.cyl, stone2, 0, -0.7, -0.1, 0, 0, 0, [0.5, 0.22, 0.45]);
  figLynx(fig, M(0xc8a878), moss2, gemG, M(0x3a2a1a));
  fig.scale.setScalar(1.55); fig.position.y += 0.4;
  anims.push((t, dt, st) => {
    for (let i = 0; i < vines.length; i++) vines[i].rotation.z = Math.sin(t * 1.3 + i) * 0.12;
    const g = st.burst;
    tendr.visible = g > 0.02;
    tendr.scale.setScalar(Math.max(0.001, Math.min(1, g * 1.6)));
  });
  P.motes = (parent) => new Motes(parent, lf, glowT(0x9af06a, 1.8, 0.85), mobile ? 14 : 26, 'drift', { size: 0.22, speed: 0.8 });
  P.extra = (parent) => new Motes(parent, GEO.oct, glow(0x80ff90, 2.2), mobile ? 10 : 18, 'rise', { size: 0.045, speed: 0.6 });
  P.runners = (parent) => new Runners(parent, lf, glowT(0xb8ff6a, 2.2, 0.9), 34, 'leaves');
  P.runnerScale = 0.3;
  P.beacon = [0.45, 1.0, 0.4];
  P.light = 0x80ff80;
  return P;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const BUILDERS = { roca: buildRoca, fuego: buildFuego, arena: buildArena, hielo: buildHielo, aire: buildAire, agua: buildAgua, tierra: buildTierra };

/* =====================================================================
   SISTEMA: un único portal por nivel con siete apariencias
   ===================================================================== */
export class RescuePortal {
  constructor(game) {
    this.game = game;
    this.variants = {};
    this.el = null;
    this.cur = null;
    this.t = 0;
    this.st = { charge: 0, burst: 0, open: 0, swap: 0, pop: 1 };
    this.walkers = [];
  }

  // Se coloca dentro del refugio del nivel (safeObj), en el emplazamiento calculado por refuge.js
  mount(safeObj, element) {
    if (this.safe === safeObj && this.root) { this.setElement(element, true); return; }
    this.dispose();
    this.safe = safeObj;
    const f = safeObj.portalFrame || { lx: 0, lz: 0, yaw: 0 };
    this.frame = f;
    this.root = new THREE.Group();
    this.root.name = 'rescue-portal';
    this.root.position.set(f.lx, 0, f.lz);
    this.root.rotation.y = f.yaw;
    safeObj.group.add(this.root);
    this.dir = new THREE.Vector2(Math.sin(f.yaw), Math.cos(f.yaw));
    // la columna de luz del refugio nace ahora sobre la figura del portal
    if (safeObj.beacon) safeObj.beacon.position.set(f.lx, 27.5 + 10.2, f.lz);
    if (safeObj.safeLight) safeObj.safeLight.position.set(f.lx + this.dir.x * 1.5, 3, f.lz + this.dir.y * 1.5);
    this.el = null;
    this.setElement(element, true);
  }

  get center() { const S = CFG.SAFE; return { x: S.x + this.frame.lx, z: S.z + this.frame.lz }; }

  build(el) {
    const B = BUILDERS[el] || BUILDERS.roca;
    const mobile = !!(this.game.world && this.game.world.mobile);
    const P = B(mobile);
    const motes = [P.motes(P.root)];
    if (P.extra) motes.push(P.extra(P.root));
    const runners = P.runners(P.root);
    if (P.runnerScale) {
      const rs = P.runnerScale;
      runners.geoScale = Array.isArray(rs) ? rs : [rs, rs, rs];
      runners.mesh.geometry = runners.mesh.geometry.clone().scale(...runners.geoScale);
    }
    bake(P.root);
    P.motesL = motes;
    P.runnersL = runners;
    P.root.visible = false;
    this.root.add(P.root);
    return P;
  }

  // PERSONAJE SELECCIONADO → VARIANTE VISUAL
  setElement(el, silent = false) {
    if (!this.root || !el || el === this.el) return;
    this.el = el;
    if (!this.variants[el]) this.variants[el] = this.build(el);
    for (const k in this.variants) this.variants[k].root.visible = k === el;
    this.cur = this.variants[el];
    const so = this.safe;
    if (so && so.beaconMat && so.beaconMat.uniforms.uCol) so.beaconMat.uniforms.uCol.value.set(...this.cur.beacon);
    if (so && so.safeLight) so.safeLight.color.setHex(this.cur.light);
    if (so && so.ring) so.ring.material.color.setRGB(...this.cur.beacon).multiplyScalar(1.6);
    if (!silent) {
      this.st.swap = 1;
      this.st.pop = 0.82;
      const c = this.center, fx = this.game.fx;
      if (fx) for (let j = 0; j < 24; j++) fx.sparkle(c.x + (Math.random() - 0.5) * 5, CFG.SAFE.y + 0.5 + Math.random() * 6, c.z + (Math.random() - 0.5) * 2, this.cur.light, 2);
    }
  }

  // Puntos donde esperan los rescatados: detrás del portal (ya lo han cruzado), sin pisar tiendas ni vehículos
  spots(n = 14) {
    if (!this.root) return null;
    const S = CFG.SAFE, f = this.frame;
    const boxes = refugeKeepOut(f.extra);
    const qx = Math.cos(f.yaw), qz = -Math.sin(f.yaw), dx = this.dir.x, dz = this.dir.y;
    const out = [];
    for (const r of [2.4, 3.3, 4.2, 5.1, 6.0]) {
      for (let i = 0; i < 9; i++) {
        const a = (i - 4) * 0.33 + (r % 2) * 0.12;
        const lx = f.lx + qx * Math.sin(a) * r - dx * Math.cos(a) * r;
        const lz = f.lz + qz * Math.sin(a) * r - dz * Math.cos(a) * r;
        if (Math.hypot(lx, lz) > 7.6) continue;
        if (boxes.some((b) => lx > b[0] - 0.4 && lx < b[1] + 0.4 && lz > b[2] - 0.4 && lz < b[3] + 0.4)) continue;
        if (Math.abs(Math.sin(a) * r) > COL - 0.8 && Math.cos(a) * r < 1.2) continue; // junto a las columnas
        out.push([S.x + lx, S.z + lz]);
        if (out.length >= n) return out;
      }
    }
    return out.length >= 6 ? out : null;
  }

  // Animación de llegada: el campo se ilumina, se abre en iris y la persona lo cruza
  welcome(v) {
    if (!this.cur) return;
    this.st.burst = 1;
    this.st.open = Math.max(this.st.open, 0.001);
    this.openT = 2.6;
    this.cur.runnersL.fire();
    if (v && v.root) {
      const c = this.center, p = v.root.position;
      const side = (p.x - c.x) * this.dir.x + (p.z - c.z) * this.dir.y >= 0 ? 1 : -1;
      const front = [c.x + this.dir.x * 1.6 * side, c.z + this.dir.y * 1.6 * side];
      const back = [c.x - this.dir.x * 1.4 * side, c.z - this.dir.y * 1.4 * side];
      v.via = [front, back];
      this.walkers.push({ v, side, crossed: false, age: 0 });
    }
  }

  arrive(v) {
    const { fx, vfx } = this.game;
    const p = v.root.position, col = this.cur ? this.cur.light : 0xffffff;
    if (vfx) vfx.ring(p.x, null, p.z, { r0: 0.3, r1: 2.0, dur: 0.8, color: col });
    if (fx) for (let j = 0; j < 18; j++) fx.sparkle(p.x, p.y + 0.3 + Math.random() * 1.4, p.z, col, 2.2);
    this.st.burst = Math.max(this.st.burst, 0.6);
  }

  update(dt, ctx = {}) {
    if (!this.root || !this.cur) return;
    this.t += dt;
    const st = this.st, P = this.cur, t = this.t;
    // 1. detección de llegada: el héroe se acerca con rescatados
    const near = ctx.carrying && ctx.dSafe < CFG.SAFE.r + 10;
    st.charge = damp(st.charge, near ? 1 : ctx.carrying ? 0.3 : 0, 2.5, dt);
    st.burst = Math.max(0, st.burst - dt * 0.55);
    // sigue abierto mientras alguien esté cruzando (máx. 9 s por si una persona se queda atascada)
    if (this.walkers.some((w) => !w.crossed && w.age < 9)) this.openT = Math.max(this.openT, 0.6);
    for (const w of this.walkers) w.age += dt;
    if (this.openT > 0) { this.openT -= dt; st.open = damp(st.open, 1, 4, dt); } else st.open = damp(st.open, 0, 2.5, dt);
    st.swap = Math.max(0, st.swap - dt * 1.6);
    st.pop = damp(st.pop, 1, 6, dt);
    const pop = st.pop + Math.sin(Math.min(1, (1 - st.pop) * 6)) * 0.02;
    P.root.scale.setScalar(pop);
    const u = P.field.uniforms;
    u.uT.value = t; u.uCharge.value = st.charge; u.uBurst.value = st.burst; u.uOpen.value = st.open; u.uSwap.value = st.swap;
    const k = st.charge * 0.35 + st.burst * 1.1 + st.swap * 0.8;
    for (const q of P.pulses) q.mat.color.copy(q.base).multiplyScalar(1 + q.amp * Math.sin(t * q.speed + q.ph) + k);
    for (const a of P.anims) a(t, dt, st);
    const boost = st.charge * 0.3 + st.burst;
    for (const m of P.motesL) m.update(dt, t, boost);
    P.runnersL.update(dt);
    // la persona cruza el campo de energía → llegada segura
    if (this.walkers.length) {
      const c = this.center;
      for (let i = this.walkers.length - 1; i >= 0; i--) {
        const w = this.walkers[i], p = w.v.root.position;
        const sd = ((p.x - c.x) * this.dir.x + (p.z - c.z) * this.dir.y) * w.side;
        if (!w.crossed && sd < 0) { w.crossed = true; this.arrive(w.v); }
        if (w.crossed && !w.v.via) this.walkers.splice(i, 1);
        else if (w.v.state !== 'delivered') this.walkers.splice(i, 1);
      }
    }
  }

  dispose() {
    if (this.root && this.root.parent) this.root.parent.remove(this.root);
    for (const k in this.variants) {
      this.variants[k].root.traverse((o) => {
        if (o.geometry && !Object.values(GEO).includes(o.geometry) && o.geometry !== FIELD_GEO) o.geometry.dispose();
      });
    }
    this.variants = {};
    this.root = null;
    this.cur = null;
    this.el = null;
    this.walkers = [];
  }
}
