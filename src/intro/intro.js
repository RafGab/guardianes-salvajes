import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Score } from './score.js';

/* ======================================================================
   CATAC 7 · INTRO CINEMATOGRÁFICA
   Narrativa: «Algo despierta en la oscuridad». Unos ojos se encienden (Lira) y, uno a uno, los siete
   guardianes despiertan rodeados de su elemento: agua (Nilo), arena (Halley), aire (Ámbar), hielo y
   estaciones (Kyra). La música crece; el líder (Jago) cae con un impacto y el fuego (Kairo) estalla.
   Un montaje rítmico los une, se reúnen en formación… silencio… y se revela el logotipo CATAC 7.
   Las imágenes originales no se alteran: solo se recortan de su fondo negro (máscara), se colocan en un
   espacio 3D (parallax real con la cámara) y se iluminan con luz, niebla, partículas y destellos.
   ====================================================================== */
const DUR = 52;
const H = 10; // altura de cada personaje en el espacio 3D
const IMG = '/img/intro/';
// cara de cada guardián en su imagen (u, v desde arriba-izquierda) y escala relativa en la formación
const HERO = {
  lira: { face: [0.5, 0.235], s: 0.95 },
  nilo: { face: [0.5, 0.21], s: 0.9 },
  halley: { face: [0.5, 0.25], s: 0.84 },
  ambar: { face: [0.44, 0.15], s: 1.02 },
  kyra: { face: [0.5, 0.2], s: 0.97 },
  jago: { face: [0.49, 0.155], s: 1.0 },
  kairo: { face: [0.5, 0.19], s: 1.05 },
};
const ORDER = ['nilo', 'halley', 'ambar', 'kyra', 'jago', 'kairo', 'lira'];
const ease = (k) => k * k * (3 - 2 * k);
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const C = (h) => new THREE.Color(h);

/* ---------------- shaders ---------------- */
const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SNOISE = `
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857; vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z); vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0; vec4 s1 = floor(b1) * 2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0); m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * (0.5 + 0.5 * snoise(p)); p *= 2.02; a *= 0.5; } return s; }`;

// personaje: imagen original + luz de contorno, barrido de luz y aparición (sin deformar ni recolorear)
const HERO_FS = `uniform sampler2D map; uniform vec2 uTexel; uniform float uExp; uniform float uAlpha; uniform float uRim; uniform vec3 uRimCol;
uniform float uSweep; uniform vec3 uSweepCol; uniform float uFlash; uniform float uRefl; uniform float uReveal; uniform float uRevealOn; uniform float uGlint; varying vec2 vUv;
void main(){
  vec4 tx = texture2D(map, vUv);
  float a = tx.a;
  vec2 o = uTexel * 7.0; float s = 0.0;
  s += texture2D(map, vUv + vec2(o.x, 0.0)).a; s += texture2D(map, vUv - vec2(o.x, 0.0)).a;
  s += texture2D(map, vUv + vec2(0.0, o.y)).a; s += texture2D(map, vUv - vec2(0.0, o.y)).a;
  s += texture2D(map, vUv + o).a; s += texture2D(map, vUv - o).a;
  s += texture2D(map, vUv + vec2(o.x, -o.y)).a; s += texture2D(map, vUv + vec2(-o.x, o.y)).a;
  float edge = clamp(a * (1.0 - s / 8.0) * 3.0, 0.0, 1.0);
  vec3 col = tx.rgb;
  col += uRimCol * edge * uRim;
  float d = vUv.x * 0.62 + (1.0 - vUv.y) * 0.38 - uSweep;
  col += uSweepCol * exp(-d * d * 500.0) * 0.32 * a;
  // destello en el metal (logo): solo en zonas claras y poco saturadas
  float l = dot(tx.rgb, vec3(0.299, 0.587, 0.114)); float sat = max(tx.r, max(tx.g, tx.b)) - min(tx.r, min(tx.g, tx.b));
  float dg = vUv.x * 0.8 + vUv.y * 0.35 - uGlint;
  col += vec3(1.0) * exp(-dg * dg * 400.0) * smoothstep(0.35, 0.8, l) * (1.0 - sat) * 1.4 * a;
  col = col * uExp + uFlash * a;
  float vis = a;
  if (uRevealOn > 0.5) {
    float front = uReveal - vUv.x;
    vis = a * smoothstep(-0.005, 0.03, front);
    float fr = exp(-front * front * 1400.0);
    col += vec3(0.75, 0.9, 1.0) * fr * 2.5 * a;
    vis = max(vis, a * fr);
  }
  if (uRefl > 0.0) vis *= uRefl * (1.0 - smoothstep(0.0, 0.32, vUv.y));
  gl_FragColor = vec4(col, vis * uAlpha * smoothstep(0.0, 0.2, uExp));
}`;

// fondo: niebla de color animada con una luz principal detrás del personaje
const BG_FS = `uniform float uT; uniform vec3 uA; uniform vec3 uB; uniform vec3 uKey; uniform vec2 uKeyPos; uniform float uKeyI; uniform vec2 uOff; uniform float uLevel; varying vec2 vUv;
${SNOISE}
void main(){
  vec2 p = vUv * vec2(2.2, 1.2) + uOff;
  float n = fbm(vec3(p * 1.6, uT * 0.05));
  float n2 = fbm(vec3(p * 3.4 + 7.0, uT * 0.08));
  vec3 col = mix(uA, uB, smoothstep(0.35, 0.9, n) * (0.5 + 0.5 * n2)) * 0.55;
  vec2 dk = (vUv - uKeyPos) * vec2(1.8, 1.0);
  float k = exp(-dot(dk, dk) * 7.0);
  col += uKey * (k * 0.32 + pow(k, 6.0) * 0.35) * uKeyI * (0.7 + 0.6 * n2);
  col *= 0.35 + 0.65 * smoothstep(1.1, 0.2, vUv.y) ;
  gl_FragColor = vec4(col * uLevel, 1.0);
}`;

// haz de luz volumétrico
const BEAM_FS = `uniform float uT; uniform vec3 uCol; uniform float uI; uniform float uSeed; varying vec2 vUv;
${SNOISE}
void main(){
  float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float along = smoothstep(0.0, 0.5, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
  float st = 0.5 + 0.5 * snoise(vec3(vUv.x * 7.0 + uSeed, vUv.y * 1.5 - uT * 0.25, uT * 0.1));
  float v = pow(max(across, 0.0), 2.2) * along * (0.45 + 0.55 * st);
  gl_FragColor = vec4(uCol * v * uI, 1.0);
}`;

// capa de niebla baja (deriva lateral: parallax)
const FOG_FS = `uniform float uT; uniform vec3 uCol; uniform float uI; uniform float uSeed; varying vec2 vUv;
${SNOISE}
void main(){
  float n = fbm(vec3(vUv.x * 3.0 + uT * 0.04 + uSeed, vUv.y * 1.6, uT * 0.06));
  float m = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.45, vUv.y) * smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
  gl_FragColor = vec4(uCol, smoothstep(0.35, 0.9, n) * m * uI);
}`;

// suelo oscuro con brillo de color bajo el personaje
const GROUND_FS = `uniform vec3 uCol; uniform float uI; uniform vec2 uC; varying vec2 vUv;
void main(){ vec2 d = (vUv - 0.5) * 140.0 - uC; float r = length(d * vec2(1.0, 1.6));
  float g = exp(-r * r * 0.012) * uI; float fade = smoothstep(70.0, 10.0, length((vUv - 0.5) * 140.0));
  gl_FragColor = vec4(uCol * g * 0.5 + vec3(0.004, 0.005, 0.01) * fade, (0.85 * fade + g * 0.3)); }`;

// rayos de luz radiales (detrás del logo)
const RAYS_FS = `uniform float uT; uniform vec3 uCol; uniform float uI; varying vec2 vUv;
${SNOISE}
void main(){ vec2 p = vUv - 0.5; float r = length(p); float a = atan(p.y, p.x);
  float ray = pow(0.5 + 0.5 * snoise(vec3(a * 3.0, uT * 0.15, 0.0)), 3.0) + 0.5 * pow(0.5 + 0.5 * snoise(vec3(a * 9.0, uT * 0.3, 4.0)), 4.0);
  float v = ray * smoothstep(0.5, 0.05, r) * smoothstep(0.0, 0.08, r) + exp(-r * r * 60.0) * 0.6;
  gl_FragColor = vec4(uCol * v * uI, 1.0); }`;

// partículas con desenfoque de profundidad (bokeh fuera del plano de foco)
const PART_VS = `attribute float aSize; attribute vec4 aCol; uniform float uPR; uniform float uFocus; varying vec4 vCol; varying float vBlur;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float dist = -mv.z;
  float blur = clamp(abs(dist - uFocus) / max(uFocus, 1.0) * 1.6, 0.0, 1.6);
  vBlur = blur; vCol = aCol; vCol.a /= (1.0 + blur * 2.5);
  gl_PointSize = aSize * uPR * (300.0 / max(dist, 0.5)) * (1.0 + blur * 2.2); gl_Position = projectionMatrix * mv; }`;
const PART_FS = `varying vec4 vCol; varying float vBlur;
void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float core = smoothstep(1.0, mix(0.15, 0.75, clamp(vBlur, 0.0, 1.0)), d);
  gl_FragColor = vec4(vCol.rgb, vCol.a * core); }`;

// postproducción cinematográfica: bandas, viñeta, grano, aberración cromática, fundidos, destellos y estela anamórfica
const CINE = {
  uniforms: { tDiffuse: { value: null }, uFade: { value: 1 }, uFlash: { value: 0 }, uFlashCol: { value: new THREE.Color(1, 1, 1) }, uT: { value: 0 }, uAspect: { value: 1.78 }, uBars: { value: 1 }, uStreak: { value: 0 }, uStreakCol: { value: new THREE.Color(0.4, 0.7, 1) } },
  vertexShader: VS,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uFade, uFlash, uT, uAspect, uBars, uStreak; uniform vec3 uFlashCol, uStreakCol; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r = length(c);
      vec2 off = c * r * 0.006;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= mix(1.0, smoothstep(0.95, 0.25, r * 1.15), 0.75);
      col += (h(vUv * 900.0 + uT * 37.0) - 0.5) * 0.035;
      col += uStreakCol * exp(-pow(c.y * 90.0, 2.0)) * smoothstep(0.55, 0.0, abs(c.x)) * uStreak;
      col = col * (1.0 - uFade) + uFlashCol * uFlash;
      float want = 2.39; float bar = max(0.0, (1.0 - uAspect / want) * 0.5) * uBars;
      if (vUv.y < bar || vUv.y > 1.0 - bar) col = vec3(0.0);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/* ---------------- partículas ---------------- */
class Particles {
  constructor(n, blending) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.base = new Float32Array(n * 4); this.kind = new Uint8Array(n); this.ph = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.u = { uPR: { value: Math.min(window.devicePixelRatio || 1, 2) }, uFocus: { value: 15 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: PART_VS, fragmentShader: PART_FS, transparent: true, depthWrite: false, blending }));
    this.points.frustumCulled = false;
    this.g = g; this.i = 0;
  }
  clear() { this.life.fill(0); this.col.fill(0); }
  spawn(p, v, col, a, size, life, kind = 0) {
    const i = this.i; this.i = (this.i + 1) % this.n;
    this.pos.set(p, i * 3); this.vel.set(v, i * 3);
    this.base[i * 4] = col.r; this.base[i * 4 + 1] = col.g; this.base[i * 4 + 2] = col.b; this.base[i * 4 + 3] = a;
    this.size[i] = size; this.life[i] = life; this.max[i] = life; this.kind[i] = kind; this.ph[i] = Math.random() * 6.28;
  }
  update(dt, t) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      const k = this.kind[i], j = i * 3;
      if (k === 1) { this.vel[j] += Math.sin(t * 1.3 + this.ph[i]) * dt * 1.2; this.vel[j + 2] += Math.cos(t * 1.1 + this.ph[i]) * dt * 0.8; } // remolino suave
      if (k === 2) { this.vel[j + 1] -= 9.8 * dt; } // gravedad (escombros)
      if (k === 3) { this.vel[j] *= 1 - dt * 0.6; this.vel[j + 1] *= 1 - dt * 0.6; this.vel[j + 2] *= 1 - dt * 0.6; } // frenado (estallido)
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const lf = this.life[i] / this.max[i];
      const fade = Math.min(1, lf * 4) * Math.min(1, (1 - lf) * 6);
      const fl = k === 4 ? 0.6 + 0.4 * Math.sin(t * 18 + this.ph[i] * 7) : 1; // parpadeo de brasa
      this.col[i * 4] = this.base[i * 4]; this.col[i * 4 + 1] = this.base[i * 4 + 1]; this.col[i * 4 + 2] = this.base[i * 4 + 2];
      this.col[i * 4 + 3] = this.base[i * 4 + 3] * fade * fl;
    }
    this.g.attributes.position.needsUpdate = true; this.g.attributes.aCol.needsUpdate = true; this.g.attributes.aSize.needsUpdate = true;
  }
}

/* ---------------- guion de planos ---------------- */
// cada plano: personajes, ambiente (colores, luz, haces, partículas) y movimiento de cámara
const ATM = {
  void: { a: '#020306', b: '#0a1220', key: '#3a6aaa', keyI: 0.25, keyPos: [0.5, 1.0], rim: '#7ab8ff', beam: '#6a9ad8', beamI: 0.12, fog: '#4a6a9a', fogI: 0.12, emit: ['dust'] },
  lira: { a: '#03060e', b: '#0d2038', key: '#2a6aff', keyI: 0.8, keyPos: [0.5, 0.62], rim: '#5aa8ff', beam: '#4a8aff', beamI: 0.35, fog: '#2a4a8a', fogI: 0.25, emit: ['dust', 'bolts'] },
  nilo: { a: '#020c16', b: '#0a3352', key: '#1ab0ff', keyI: 0.9, keyPos: [0.5, 0.6], rim: '#6ad0ff', beam: '#3ab8ff', beamI: 0.45, fog: '#1a6a9a', fogI: 0.3, emit: ['bubbles', 'dust'] },
  halley: { a: '#0c0612', b: '#2e1438', key: '#a050ff', keyI: 0.85, keyPos: [0.4, 0.6], rim: '#c890ff', beam: '#ffa040', beamI: 0.4, fog: '#6a3a5a', fogI: 0.3, emit: ['sand'] },
  ambar: { a: '#100902', b: '#3e2806', key: '#ffb030', keyI: 1.0, keyPos: [0.5, 0.75], rim: '#ffe090', beam: '#ffd070', beamI: 0.6, fog: '#8a6a2a', fogI: 0.25, emit: ['gold', 'wind'] },
  kyra: { a: '#08050f', b: '#26123a', key: '#ff5ad0', keyI: 0.8, keyPos: [0.35, 0.6], rim: '#9ad0ff', beam: '#6ab0ff', beamI: 0.4, fog: '#6a4a9a', fogI: 0.3, emit: ['snow', 'petals', 'leaves'] },
  jago: { a: '#0e0602', b: '#36180a', key: '#ff7020', keyI: 1.0, keyPos: [0.5, 0.55], rim: '#ffa050', beam: '#ff8a3a', beamI: 0.5, fog: '#7a4a2a', fogI: 0.35, emit: ['dust', 'sparks'] },
  kairo: { a: '#120302', b: '#480e04', key: '#ff4010', keyI: 1.1, keyPos: [0.5, 0.45], rim: '#ffb030', beam: '#ff6a20', beamI: 0.55, fog: '#8a2a0a', fogI: 0.35, emit: ['embers'] },
  lineup: { a: '#05040b', b: '#1c1232', key: '#ff8a3a', keyI: 0.9, keyPos: [0.5, 0.55], rim: '#ffd0a0', beam: '#8ab0ff', beamI: 0.45, fog: '#4a3a6a', fogI: 0.3, emit: ['multi'] },
  logo: { a: '#01030a', b: '#081a3a', key: '#2a70ff', keyI: 1.0, keyPos: [0.5, 0.52], rim: '#6ab0ff', beam: '#3a8aff', beamI: 0.0, fog: '#1a3a7a', fogI: 0.25, emit: ['logo'] },
};
function faceXY(id, img) { const f = HERO[id].face, w = H * img.aspect; return [(f[0] - 0.5) * w, (1 - f[1]) * H]; }

export class CinematicIntro {
  constructor({ onDone } = {}) {
    this.onDone = onDone;
    this.active = false;
    this.buildDom();
  }

  /* ---------------- DOM: capa, puerta de inicio y botón de saltar ---------------- */
  buildDom() {
    const el = document.createElement('div');
    el.id = 'intro';
    el.innerHTML = `<canvas id="intro-cv"></canvas>
      <div id="intro-gate" class="intro-gate"><div class="ig-dot"></div><div class="ig-txt">PULSA PARA COMENZAR</div><div class="ig-sub">🔊 con sonido</div></div>
      <button id="intro-skip" class="intro-skip" type="button">SALTAR ›</button>`;
    document.body.appendChild(el);
    this.el = el; this.cv = el.querySelector('#intro-cv');
    this.gate = el.querySelector('#intro-gate'); this.skipBtn = el.querySelector('#intro-skip');
    this.skipBtn.onclick = (e) => { e.stopPropagation(); this.finish(true); };
    this.onKey = (e) => { if (!this.playing) return; if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); this.finish(true); } };
    window.addEventListener('keydown', this.onKey);
  }

  // Muestra la capa negra con «Pulsa para comenzar»; el primer gesto arranca la intro con sonido
  showGate() {
    this.active = true;
    this.el.classList.add('show');
    this.gate.classList.add('show');
    const go = (e) => {
      if (e && e.target === this.skipBtn) return;
      ['pointerdown', 'keydown', 'touchend'].forEach((n) => window.removeEventListener(n, go, true));
      if (e && e.type === 'keydown' && (e.code === 'Escape')) { this.finish(true); return; }
      this.play();
    };
    ['pointerdown', 'keydown', 'touchend'].forEach((n) => window.addEventListener(n, go, true));
  }

  async play() {
    this.active = true; this.playing = true;
    this.el.classList.add('show', 'playing');
    this.gate.classList.remove('show');
    let seen = false; try { seen = localStorage.getItem('catac7_intro_seen') === '1'; } catch (e) { /* */ }
    this.skipBtn.classList.toggle('show', true);
    this.skipBtn.classList.toggle('late', !seen);
    try { this.score = new Score(); } catch (e) { this.score = null; }
    if (!this.three) await this.setup();
    this.reset();
    if (this.score) this.score.play(0.25);
    this.clock0 = performance.now() / 1000 + 0.25;
    this.last = performance.now() / 1000;
    const loop = () => { if (!this.playing) return; this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }

  async setup() {
    const r = new THREE.WebGLRenderer({ canvas: this.cv, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    r.toneMapping = THREE.NoToneMapping; // los colores de las imágenes se respetan
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.r = r;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 400);
    this.scene.add(this.cam);
    // texturas
    const loader = new THREE.TextureLoader();
    const load = (n) => new Promise((res) => loader.load(IMG + n + '.webp', (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; res(t); }, undefined, () => res(null)));
    const names = [...ORDER, 'logo'];
    const texs = await Promise.all(names.map(load));
    this.tex = {}; names.forEach((n, i) => { this.tex[n] = texs[i]; });
    // fondo pegado a la cámara (siempre llena el encuadre)
    this.bgU = { uT: { value: 0 }, uA: { value: C('#000') }, uB: { value: C('#000') }, uKey: { value: C('#000') }, uKeyPos: { value: new THREE.Vector2(0.5, 0.6) }, uKeyI: { value: 0 }, uOff: { value: new THREE.Vector2() }, uLevel: { value: 1 } };
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: this.bgU, vertexShader: VS, fragmentShader: BG_FS, depthWrite: false, depthTest: false }));
    bg.position.z = -150; bg.renderOrder = -10; this.cam.add(bg); this.bg = bg;
    // suelo
    this.groundU = { uCol: { value: C('#000') }, uI: { value: 0 }, uC: { value: new THREE.Vector2() } };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.ShaderMaterial({ uniforms: this.groundU, vertexShader: VS, fragmentShader: GROUND_FS, transparent: true, depthWrite: false }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.renderOrder = -5; this.scene.add(ground);
    // haces de luz volumétricos
    this.beams = [0, 1, 2].map((k) => {
      const u = { uT: { value: 0 }, uCol: { value: C('#fff') }, uI: { value: 0 }, uSeed: { value: k * 13.1 } };
      const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 40), new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.renderOrder = -3; this.scene.add(m);
      return { m, u, k };
    });
    // niebla en capas (detrás y delante, a ras de suelo)
    this.fogs = [[-6, 1.0], [-14, 1.3], [3.5, 0.6]].map(([z, sc], k) => {
      const u = { uT: { value: 0 }, uCol: { value: C('#fff') }, uI: { value: 0 }, uSeed: { value: k * 5.3 } };
      const m = new THREE.Mesh(new THREE.PlaneGeometry(80 * sc, 9 * sc), new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: FOG_FS, transparent: true, depthWrite: false }));
      m.position.set(0, 2.6 * sc, z); m.renderOrder = z > 0 ? 6 : -2; this.scene.add(m);
      return { m, u, z };
    });
    // rayos del logo
    this.raysU = { uT: { value: 0 }, uCol: { value: C('#3a8aff') }, uI: { value: 0 } };
    this.rays = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShaderMaterial({ uniforms: this.raysU, vertexShader: VS, fragmentShader: RAYS_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.rays.position.set(0, 5, -3); this.rays.renderOrder = -1; this.scene.add(this.rays);
    // onda expansiva
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 96), new THREE.MeshBasicMaterial({ color: 0x8ac8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.ring.position.set(0, 5, 0.5); this.scene.add(this.ring);
    // personajes (y su reflejo en el suelo)
    this.cards = {};
    for (const n of [...ORDER, 'logo']) {
      const t = this.tex[n]; if (!t) continue;
      const aspect = t.image.width / t.image.height;
      const mk = (refl) => {
        const u = { map: { value: t }, uTexel: { value: new THREE.Vector2(1 / t.image.width, 1 / t.image.height) }, uExp: { value: 0 }, uAlpha: { value: 1 }, uRim: { value: 0 }, uRimCol: { value: C('#fff') }, uSweep: { value: -2 }, uSweepCol: { value: C('#fff') }, uFlash: { value: 0 }, uRefl: { value: refl ? 0.22 : 0 }, uReveal: { value: 0 }, uRevealOn: { value: 0 }, uGlint: { value: -2 } };
        const w = n === 'logo' ? 18 : H * aspect, h = n === 'logo' ? 18 / aspect : H;
        const geo = new THREE.PlaneGeometry(w, h); geo.translate(0, h / 2, 0);
        const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: HERO_FS, transparent: true, depthWrite: false }));
        if (refl) { m.scale.y = -1; m.renderOrder = 0; } else m.renderOrder = 2;
        m.visible = false; this.scene.add(m);
        return { m, u };
      };
      const main = mk(false), refl = n === 'logo' ? null : mk(true);
      this.cards[n] = { main, refl, aspect, w: n === 'logo' ? 18 : H * aspect };
    }
    // partículas: luminosas (aditivas) y sólidas (escombros, polvo)
    this.glow = new Particles(2600, THREE.AdditiveBlending);
    this.solid = new Particles(900, THREE.NormalBlending);
    this.scene.add(this.glow.points, this.solid.points);
    // postproducción
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.cam));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.42, 0.45, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.cine = new ShaderPass(CINE);
    this.composer.addPass(this.cine);
    this.three = true;
    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  resize() {
    if (!this.r) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.r.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
    this.cine.uniforms.uAspect.value = w / h;
    // el fondo pegado a la cámara llena el encuadre
    const d = 150, hh = 2 * d * Math.tan(THREE.MathUtils.degToRad(70) / 2);
    this.bg.scale.set(hh * (w / h) * 0.6, hh * 0.6, 1);
  }

  reset() {
    this.shot = null; this.cut = -1; this.emitAcc = {}; this.shake = 0; this.flash = 0; this.lastT = 0;
    this.glow.clear(); this.solid.clear();
    for (const n in this.cards) { const c = this.cards[n]; c.main.m.visible = false; if (c.refl) c.refl.m.visible = false; }
    this.cine.uniforms.uFade.value = 1;
  }

  /* ---------------- guion ---------------- */
  // Devuelve el plano activo y su progreso
  shotAt(t) {
    const S = [
      ['void', 0, 3], ['lira', 3, 10], ['nilo', 10, 14.5], ['halley', 14.5, 19], ['ambar', 19, 23.5], ['kyra', 23.5, 28],
      ['jago', 28, 31.5], ['kairo', 31.5, 35], ['montage', 35, 37.38], ['lineup', 37.38, 40], ['pause', 40, 41.2], ['logo', 41.2, DUR],
    ];
    for (const s of S) if (t >= s[1] && t < s[2]) return { id: s[0], t0: s[1], t1: s[2], k: (t - s[1]) / (s[2] - s[1]), lt: t - s[1] };
    return { id: 'end', t0: DUR, t1: DUR + 1, k: 1, lt: 0 };
  }

  setAtmosphere(name, instant = true) {
    const A = ATM[name] || ATM.void;
    this.atm = A;
    const u = this.bgU;
    u.uA.value.set(A.a); u.uB.value.set(A.b); u.uKey.value.set(A.key); u.uKeyI.value = A.keyI; u.uKeyPos.value.set(...A.keyPos);
    for (const b of this.beams) { b.u.uCol.value.set(A.beam); b.u.uI.value = A.beamI; }
    for (const f of this.fogs) { f.u.uCol.value.set(A.fog); f.u.uI.value = A.fogI * (f.z > 0 ? 0.6 : 1); }
    this.groundU.uCol.value.set(A.key); this.groundU.uI.value = 0.9;
    void instant;
  }

  showOnly(list, place = {}) {
    for (const n in this.cards) {
      const c = this.cards[n], on = list.includes(n);
      c.main.m.visible = on; if (c.refl) c.refl.m.visible = on;
      if (!on) continue;
      const p = place[n] || { x: 0, z: 0, s: 1 };
      for (const part of [c.main, c.refl]) {
        if (!part) continue;
        part.m.position.set(p.x, n === 'logo' ? 0.5 : 0, p.z);
        part.m.scale.set(p.s, part === c.refl ? -p.s : p.s, p.s);
        part.m.rotation.set(0, 0, 0);
        part.u.uRimCol.value.set(this.atm.rim);
        part.u.uRevealOn.value = n === 'logo' ? 1 : 0;
      }
    }
  }

  // emisores de partículas según el ambiente del plano
  emit(dt, t, name, center) {
    const A = ATM[name]; if (!A) return;
    const cx = center ? center.x : 0, cz = center ? center.z : 0;
    const R = (a, b) => a + Math.random() * (b - a);
    const rate = (key, perSec, fn) => { this.emitAcc[key] = (this.emitAcc[key] || 0) + dt * perSec; while (this.emitAcc[key] >= 1) { this.emitAcc[key]--; fn(); } };
    const col = (h) => C(h);
    for (const e of A.emit) {
      if (e === 'dust') rate('dust', 40, () => this.glow.spawn([cx + R(-14, 14), R(0, 14), cz + R(-10, 12)], [R(-0.2, 0.2), R(-0.05, 0.25), R(-0.1, 0.1)], col(Math.random() < 0.5 ? '#cfe0ff' : '#ffe0c0'), R(0.15, 0.4), R(0.04, 0.09), R(4, 8), 1));
      if (e === 'bolts' && Math.random() < dt * 1.5) for (let k = 0; k < 6; k++) this.glow.spawn([cx + R(-3, 3), R(5, 10), cz + R(-1, 1)], [R(-3, 3), R(-3, 3), R(-1, 1)], col(Math.random() < 0.5 ? '#6ab0ff' : '#ffe060'), 0.9, R(0.05, 0.1), R(0.2, 0.5), 3);
      if (e === 'bubbles') rate('bub', 70, () => this.glow.spawn([cx + R(-10, 10), R(-1, 2), cz + R(-6, 8)], [R(-0.2, 0.2), R(1.2, 3), R(-0.2, 0.2)], col('#9ae0ff'), R(0.25, 0.6), R(0.06, 0.16), R(4, 7), 1));
      if (e === 'sand') rate('sand', 150, () => this.glow.spawn([cx + R(10, 16), R(0, 11), cz + R(-6, 7)], [R(-11, -6), R(-0.5, 0.6), R(-0.5, 0.5)], col(Math.random() < 0.7 ? '#ffc070' : '#d090ff'), R(0.12, 0.32), R(0.025, 0.06), R(2.2, 3.5), 0));
      if (e === 'wind') rate('wind', 120, () => this.glow.spawn([cx + R(-14, -9), R(0, 13), cz + R(-5, 8)], [R(12, 18), R(1, 3), 0], col('#fff4d0'), R(0.12, 0.3), R(0.03, 0.05), R(1.3, 2), 0));
      if (e === 'gold') rate('gold', 90, () => this.glow.spawn([cx + R(-6, 6), R(0, 3), cz + R(-3, 4)], [R(-0.6, 0.6), R(2, 4.5), R(-0.4, 0.4)], col(Math.random() < 0.5 ? '#ffd060' : '#fff0a0'), R(0.5, 0.9), R(0.04, 0.09), R(2.5, 4), 1));
      if (e === 'snow') rate('snow', 110, () => this.glow.spawn([cx + R(-12, 12), R(9, 15), cz + R(-6, 8)], [R(-0.6, 0.6), R(-1.6, -0.7), R(-0.3, 0.3)], col('#e8f4ff'), R(0.5, 0.9), R(0.04, 0.09), R(6, 9), 1));
      if (e === 'petals') rate('pet', 45, () => this.glow.spawn([cx + R(-12, 2), R(8, 14), cz + R(-5, 7)], [R(0.5, 1.6), R(-1.2, -0.5), R(-0.3, 0.3)], col('#ff8ad8'), R(0.55, 0.9), R(0.06, 0.11), R(6, 9), 1));
      if (e === 'leaves') rate('lea', 25, () => this.glow.spawn([cx + R(0, 12), R(1, 8), cz + R(-4, 6)], [R(-1, 0.4), R(-0.3, 0.8), R(-0.3, 0.3)], col('#ff8a2a'), R(0.6, 0.9), R(0.05, 0.1), R(4, 7), 4));
      if (e === 'sparks') rate('spk', 60, () => this.glow.spawn([cx + R(-6, 6), R(0, 2), cz + R(-3, 4)], [R(-1, 1), R(1.5, 4), R(-0.5, 0.5)], col(Math.random() < 0.6 ? '#ff9a3a' : '#ffd080'), R(0.6, 1), R(0.03, 0.07), R(1.5, 3), 4));
      if (e === 'embers') rate('emb', 200, () => this.glow.spawn([cx + R(-9, 9), R(-0.5, 2), cz + R(-5, 6)], [R(-0.8, 0.8), R(2.5, 6.5), R(-0.6, 0.6)], col(Math.random() < 0.5 ? '#ff6a1a' : (Math.random() < 0.6 ? '#ffb030' : '#fff0a0')), R(0.6, 1), R(0.03, 0.09), R(1.5, 3.2), 4));
      if (e === 'multi') rate('mul', 160, () => { const cs = ['#ff7a2a', '#3ab8ff', '#c070ff', '#ffd060', '#ff6ad0', '#ff4010', '#4a8aff']; this.glow.spawn([cx + R(-22, 22), R(-0.5, 3), cz + R(-12, 6)], [R(-0.5, 0.5), R(2, 5), R(-0.4, 0.4)], col(cs[(Math.random() * 7) | 0]), R(0.5, 0.9), R(0.04, 0.09), R(2, 3.5), 4); });
      if (e === 'logo') rate('lg', 80, () => this.glow.spawn([R(-16, 16), R(-2, 3), R(-8, 6)], [R(-0.4, 0.4), R(1, 2.6), R(-0.2, 0.2)], col(Math.random() < 0.65 ? '#5aa8ff' : '#ff9a3a'), R(0.4, 0.8), R(0.03, 0.07), R(3, 5.5), 4));
    }
  }

  burst(center, cols, n = 160, speed = 9, solid = false) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * 1.2, s = speed * (0.4 + Math.random() * 0.8);
      const v = [Math.cos(a) * Math.cos(e) * s, Math.abs(Math.sin(e)) * s * 0.9 + 1.5, Math.sin(a) * Math.cos(e) * s * 0.6];
      if (solid) this.solid.spawn([center.x + (Math.random() - 0.5), center.y, center.z], v, C(cols[k % cols.length]), 0.9, 0.06 + Math.random() * 0.1, 1.2 + Math.random(), 2);
      else this.glow.spawn([center.x, center.y, center.z], v, C(cols[k % cols.length]), 1, 0.04 + Math.random() * 0.07, 0.8 + Math.random() * 1.2, 3);
    }
  }
  dustCloud(center, col, n = 60) {
    for (let k = 0; k < n; k++) { const a = Math.random() * 6.28, s = 3 + Math.random() * 6; this.solid.spawn([center.x, 0.3 + Math.random() * 0.6, center.z], [Math.cos(a) * s, 0.5 + Math.random() * 1.5, Math.sin(a) * s * 0.5], C(col), 0.35, 0.5 + Math.random() * 0.6, 1.4 + Math.random() * 1.2, 3); }
  }

  /* ---------------- fotograma ---------------- */
  frame(debugT = null, debugDt = null) {
    const now = performance.now() / 1000;
    const dt = debugDt ?? Math.min(0.05, now - this.last); this.last = now;
    let t = debugT ?? (this.score && this.score.ctx.state === 'running' ? this.score.time : now - this.clock0);
    if (t < 0) t = 0;
    if (t >= DUR) { if (debugT == null) this.finish(false); return; }
    const S = this.shotAt(t);
    const cine = this.cine.uniforms;
    cine.uT.value = t;
    // cambio de plano: preparar escena
    if (!this.shot || this.shot.id !== S.id) this.enterShot(S, t);
    this.shot = S;
    const cam = this.cam;
    const P = new THREE.Vector3(), L = new THREE.Vector3();
    let fov = 35, focus = 16, fade = 0, emitName = S.id, center = { x: 0, z: 0 };
    const set = (p0, l0, p1, l1, k) => { P.lerpVectors(new THREE.Vector3(...p0), new THREE.Vector3(...p1), k); L.lerpVectors(new THREE.Vector3(...l0), new THREE.Vector3(...l1), k); };
    const card = (n) => this.cards[n];
    const heroU = (n) => card(n).main.u;
    const k = S.k, lt = S.lt, len = S.t1 - S.t0;
    // fundidos de entrada/salida de cada plano
    const inOut = (fi = 0.35, fo = 0.35) => clamp01(lt / fi) * clamp01((len - lt) / fo);
    switch (S.id) {
      case 'void': {
        set([0, 6, 30], [0, 6, 0], [0, 6.2, 27], [0, 6.3, 0], ease(k));
        fade = 1 - 0.85 * clamp01(lt / 2.5);
        emitName = 'void'; focus = 12;
        break;
      }
      case 'lira': {
        const [fx, fy] = faceXY('lira', card('lira'));
        // 3–7 s: los ojos se encienden en la oscuridad (empuje lento) · 7–10 s: retroceso revelando a Lira
        if (lt < 4.2) set([fx + 0.5, fy + 0.05, 4.4], [fx, fy - 0.05, 0], [fx + 0.1, fy, 3.5], [fx, fy, 0], easeInOut(lt / 4.2));
        else set([fx + 0.1, fy, 3.5], [fx, fy, 0], [1.2, 5.6, 19], [0, 5.2, 0], easeInOut(clamp01((lt - 4.2) / 2.6)));
        const u = heroU('lira');
        u.uExp.value = clamp01((lt - 0.2) / 2.4) * clamp01((len - lt) / 0.5);
        card('lira').refl.u.uExp.value = u.uExp.value;
        u.uSweep.value = -0.4 + clamp01((lt - 0.3) / 2.6) * 1.6;
        u.uSweepCol.value.set('#9ad0ff');
        const zap = Math.max(Math.exp(-Math.pow((lt - 2.5) * 9, 2)), Math.exp(-Math.pow((lt - 4.5) * 9, 2)));
        u.uRim.value = 0.25 + zap * 1.2;
        this.flash = Math.max(this.flash, zap * 0.12);
        focus = P.distanceTo(L);
        fade = clamp01(1 - lt / 1.2) * 0.4;
        break;
      }
      case 'nilo': {
        const [fx, fy] = faceXY('nilo', card('nilo'));
        set([0.6, 1.4, 10], [0.2, 1.6, 0], [0, fy - 0.4, 9.2], [fx, fy, 0], easeInOut(k)); // panorámica vertical: de las botas a la cara
        const u = heroU('nilo'); u.uExp.value = inOut(0.45, 0.4); card('nilo').refl.u.uExp.value = u.uExp.value; u.uRim.value = 0.35;
        u.uSweep.value = 1.6 - k * 2.2; u.uSweepCol.value.set('#7ad8ff');
        focus = 9.5;
        break;
      }
      case 'halley': {
        set([-8, 5.2, 19], [-1.2, 5.4, 0], [7, 5.6, 17], [0.9, 5.4, 0], easeInOut(k)); // travelling lateral
        const u = heroU('halley'); u.uExp.value = inOut(0.35, 0.35); card('halley').refl.u.uExp.value = u.uExp.value; u.uRim.value = 0.4;
        u.uSweep.value = -0.5 + k * 2.2; u.uSweepCol.value.set('#ffc080');
        focus = 18;
        break;
      }
      case 'ambar': {
        set([0, 0.7, 21], [0, 6.2, 0], [0.6, 2.6, 12.5], [-0.2, 7.4, 0], easeOut(k)); // contrapicado heroico
        fov = 35 - k * 3;
        const u = heroU('ambar'); u.uExp.value = inOut(0.35, 0.35); card('ambar').refl.u.uExp.value = u.uExp.value; u.uRim.value = 0.45;
        u.uSweep.value = -0.4 + k * 2; u.uSweepCol.value.set('#fff0b0');
        focus = 14;
        break;
      }
      case 'kyra': {
        const a = -0.3 + 0.6 * easeInOut(k), d = 15.5 - k * 2; // cámara envolvente
        set([Math.sin(a) * d, 6.2, Math.cos(a) * d], [0, 6.0, 0], [Math.sin(a) * d, 6.2, Math.cos(a) * d], [0, 6.0, 0], 0);
        card('kyra').main.m.rotation.y = a * 0.85; card('kyra').refl.m.rotation.y = a * 0.85; // el personaje sigue de frente a la cámara
        const u = heroU('kyra'); u.uExp.value = inOut(0.35, 0.3); card('kyra').refl.u.uExp.value = u.uExp.value; u.uRim.value = 0.4;
        u.uSweep.value = 1.5 - k * 2; u.uSweepCol.value.set('#ffd0f0');
        focus = d;
        break;
      }
      case 'jago': {
        set([0.4, 4.6, 9.5], [0, 6.4, 0], [0, 6.0, 15], [0, 6.0, 0], easeOut(clamp01(lt / 1.6))); // impacto: el líder llega y la cámara retrocede
        this.shake = Math.max(this.shake * Math.exp(-dt * 4), 0);
        const u = heroU('jago'); u.uExp.value = clamp01(lt / 0.12) * clamp01((len - lt) / 0.3); card('jago').refl.u.uExp.value = u.uExp.value;
        u.uRim.value = 0.5; u.uSweep.value = -0.3 + clamp01(lt / 1.4) * 1.8; u.uSweepCol.value.set('#ffb070');
        focus = P.distanceTo(L);
        break;
      }
      case 'kairo': {
        const kk = easeOut(clamp01(lt / 1.2));
        set([-10, 5.4, 13], [-4, 6.5, 0], [0.8, 6.2, 12.5], [0.3, 6.8, 0], kk); // barrido rápido que se frena sobre Kairo
        set([P.x, P.y, P.z], [L.x, L.y, L.z], [0.6, 6.6, 10.5], [0.3, 7.2, 0], easeInOut(clamp01((lt - 1.2) / (len - 1.2))) * 0.6);
        const u = heroU('kairo'); u.uExp.value = inOut(0.15, 0.25) * 0.8; card('kairo').refl.u.uExp.value = u.uExp.value; // sus llamas ya son muy luminosas
        u.uRim.value = 0.55 + 0.25 * Math.sin(t * 23) * Math.sin(t * 7); u.uSweep.value = 1.6 - clamp01(lt / 1.6) * 2.2; u.uSweepCol.value.set('#ffd080');
        focus = 12;
        break;
      }
      case 'montage': {
        const i = Math.min(6, Math.floor(lt / 0.34)), n = ORDER[i], sub = (lt - i * 0.34) / 0.34;
        if (i !== this.cut) { this.cut = i; this.setAtmosphere(n); this.showOnly([n]); this.flash = 0.55; this.glow.clear(); }
        const [fx, fy] = faceXY(n, card(n));
        set([fx + 0.4, fy - 0.1, 4.6], [fx, fy, 0], [fx + 0.15, fy, 3.9], [fx, fy, 0], sub);
        const u = heroU(n); u.uExp.value = 1; card(n).refl.u.uExp.value = 1; u.uRim.value = 0.5; u.uSweep.value = -2;
        emitName = n; focus = 4.2;
        break;
      }
      case 'lineup': {
        set([-19, 3.2, 19], [-4, 5.2, -3], [15, 5.6, 24], [3, 5.4, -3], easeInOut(k)); // travelling ante los siete guardianes
        for (const n of ORDER) {
          const c = card(n), u = c.main.u;
          u.uExp.value = clamp01(lt / 0.25); c.refl.u.uExp.value = u.uExp.value; u.uRim.value = 0.4;
          u.uSweep.value = -0.6 + clamp01((lt - 1.2) / 1.2) * 2.4; u.uSweepCol.value.set('#ffffff');
          const ry = Math.atan2(P.x - c.main.m.position.x, P.z - c.main.m.position.z) * 0.8;
          c.main.m.rotation.y = ry; c.refl.m.rotation.y = ry;
        }
        center = { x: 0, z: -4 }; focus = 22;
        fade = clamp01((lt - (len - 0.18)) / 0.18);
        break;
      }
      case 'pause': {
        set([0, 5, 30], [0, 5, 0], [0, 5, 30], [0, 5, 0], 0);
        fade = 1;
        emitName = null;
        break;
      }
      case 'logo': {
        set([0, 5.2, 34], [0, 5.0, 0], [0, 5.0, 27.5], [0, 5.0, 0], easeOut(clamp01(lt / 9)));
        const c = card('logo'), u = c.main.u;
        u.uReveal.value = -0.05 + easeOut(clamp01(lt / 1.25)) * 1.12;
        u.uExp.value = 1;
        u.uRim.value = 0.3 + Math.exp(-lt * 2) * 1.2;
        u.uFlash.value = Math.exp(-lt * 3.5) * 0.25;
        u.uGlint.value = lt > 3 ? -0.4 + ((lt - 3.3) % 3) * 0.75 : -2;
        this.raysU.uI.value = clamp01(lt / 0.6) * (0.55 + Math.exp(-lt * 1.5) * 1.5);
        this.raysU.uT.value = t;
        this.rays.rotation.z = lt * 0.03;
        const rk = clamp01(lt / 1.4);
        this.ring.scale.setScalar(1 + rk * 26); this.ring.material.opacity = (1 - rk) * 0.85 * (lt < 1.4 ? 1 : 0);
        cine.uStreak.value = Math.exp(-lt * 2.2) * 1.4 + 0.12;
        fade = clamp01((lt - 9.3) / 1.4);
        focus = 30; emitName = 'logo';
        this.bgU.uKeyI.value = 0.4 + Math.exp(-lt * 1.2) * 1.6 + 0.15 * Math.sin(lt * 1.3);
        break;
      }
      default: break;
    }
    // temblor de cámara
    if (this.shake > 0.001) { P.x += (Math.random() - 0.5) * this.shake; P.y += (Math.random() - 0.5) * this.shake; L.x += (Math.random() - 0.5) * this.shake * 0.5; this.shake *= Math.exp(-dt * 5); }
    // respiración de cámara (cámara al hombro muy sutil)
    P.x += Math.sin(t * 0.7) * 0.04; P.y += Math.sin(t * 0.53) * 0.03;
    cam.position.copy(P); cam.lookAt(L);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    // fondo, haces, niebla y suelo
    this.bgU.uT.value = t; this.bgU.uOff.value.set(P.x * 0.004, P.y * 0.004);
    this.bgU.uLevel.value = S.id === 'pause' ? 0 : 1;
    this.beams.forEach((b) => {
      b.u.uT.value = t;
      b.m.position.set(center.x + (b.k - 1) * 4.5, 14, center.z - 5 - b.k * 1.5);
      b.m.rotation.set(0, 0, (b.k - 1) * 0.22 + Math.sin(t * 0.2 + b.k) * 0.05);
      b.m.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(P.x - b.m.position.x, P.z - b.m.position.z)));
    });
    this.fogs.forEach((f) => { f.u.uT.value = t; f.m.position.x = center.x; f.m.position.z = center.z + f.z; });
    this.groundU.uC.value.set(center.x, -center.z);
    // partículas
    if (emitName) this.emit(dt, t, emitName, center);
    this.glow.u.uFocus.value = focus; this.solid.u.uFocus.value = focus;
    this.glow.update(dt, t); this.solid.update(dt, t);
    // destellos y fundidos
    this.flash *= Math.exp(-dt * 7);
    cine.uFlash.value = this.flash;
    cine.uFade.value = Math.max(fade, S.id === 'end' ? 1 : 0);
    if (S.id !== 'logo') cine.uStreak.value *= Math.exp(-dt * 4);
    this.composer.render(dt);
  }

  // Pruebas: dibuja el fotograma del segundo t (simulando los segundos anteriores para las partículas)
  async preview(t) {
    if (!this.three) await this.setup();
    this.el.classList.add('show'); this.gate.classList.remove('show');
    this.reset();
    for (let x = Math.max(0, t - 2.5); x < t; x += 1 / 30) this.frame(x, 1 / 30);
    this.frame(t, 1 / 30);
  }

  enterShot(S, t) {
    void t;
    const card = (n) => this.cards[n];
    this.cut = -1;
    this.raysU.uI.value = 0; this.ring.material.opacity = 0;
    const solo = ['lira', 'nilo', 'halley', 'ambar', 'kyra', 'jago', 'kairo'];
    if (S.id === 'void') { this.setAtmosphere('void'); this.showOnly([]); }
    else if (solo.includes(S.id)) {
      this.setAtmosphere(S.id); this.showOnly([S.id]);
      if (S.id !== 'lira') this.flash = Math.max(this.flash, 0.35);
      if (S.id === 'jago') { // el líder cae: impacto, polvo y rocas
        this.shake = 0.9; this.flash = 0.8; this.cine.uniforms.uFlashCol.value.set('#ffd0a0');
        this.dustCloud({ x: 0, z: 0 }, '#6a4a34', 90);
        this.burst({ x: 0, y: 0.5, z: 0 }, ['#4a3a2e', '#6a5040', '#2e241c'], 120, 10, true);
        this.burst({ x: 0, y: 1, z: 0 }, ['#ff9a3a', '#ffd080'], 120, 9);
      } else this.cine.uniforms.uFlashCol.value.set('#ffffff');
      if (S.id === 'kairo') { this.burst({ x: 0, y: 2, z: 0 }, ['#ff6a1a', '#ffb030', '#fff0a0'], 220, 10); this.shake = 0.35; }
    } else if (S.id === 'montage') { this.glow.clear(); }
    else if (S.id === 'lineup') {
      this.setAtmosphere('lineup');
      const xs = [-15, -10, -5, 0, 5, 10, 15], line = ['halley', 'kairo', 'kyra', 'jago', 'lira', 'ambar', 'nilo'];
      const place = {};
      line.forEach((n, i) => { place[n] = { x: xs[i] * 0.95, z: -Math.abs(i - 3) * 2.6, s: HERO[n].s }; });
      this.showOnly(line, place);
      this.flash = 0.6; this.cine.uniforms.uFlashCol.value.set('#ffffff');
      this.glow.clear();
    } else if (S.id === 'pause') { this.showOnly([]); this.glow.clear(); this.solid.clear(); }
    else if (S.id === 'logo') {
      this.setAtmosphere('logo');
      this.showOnly(['logo']);
      this.flash = 1.0; this.cine.uniforms.uFlashCol.value.set('#cfe4ff');
      this.shake = 0.5;
      this.burst({ x: 0, y: 5, z: 0.5 }, ['#8ac8ff', '#ffffff', '#ffb050', '#3a8aff'], 420, 16);
    }
    void card;
  }

  finish(skipped) {
    if (!this.active) return;
    this.playing = false; this.active = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.score) { this.score.stop(skipped ? 0.4 : 0.2); this.score = null; }
    try { localStorage.setItem('catac7_intro_seen', '1'); } catch (e) { /* */ }
    this.el.classList.add('out');
    setTimeout(() => { this.el.classList.remove('show', 'playing', 'out'); this.skipBtn.classList.remove('show'); }, 900);
    if (this.onDone) this.onDone(skipped);
  }
}
