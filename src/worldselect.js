import * as THREE from 'three';

/* ======================================================================
   SELECCIÓN DE MUNDOS · universo espacial con portales mágicos flotantes
   · Fondo: nebulosas animadas, estrellas que titilan, planetas a distintas distancias y polvo de energía
   · Un portal 3D por cada nivel EXISTENTE (LEVELS), en arco y con profundidad. Dentro de cada portal se ve
     una vista real de su mundo (capturada del propio escenario 3D: public/img/worlds/<id>.jpg)
   · Pasar el cursor: el portal se ilumina, crece y lanza una onda de energía. Clic: la cámara se acerca,
     se muestra la descripción y el botón «ENTRAR AL MUNDO». Entrar: la cámara atraviesa el portal y se abre
     el mundo real con el sistema de carga de siempre (pickMission → loadLevel).
   ====================================================================== */
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Color de energía de cada mundo (según su catástrofe)
const WORLD_COL = {
  campfire: 0xff8a2a, quake: 0xc89a5a, fire: 0xff5a1a, volcano: 0xff3a3a, sandstorm: 0xffc860,
  flood: 0x3aa8ff, drought: 0xffd23a, ice: 0x8ae8ff, hurricane: 0x2ae0c8, extreme: 0xc66aff,
};

/* ---------------- shaders ---------------- */
const NOISE = `
// ruido simplex 3D (Ashima / Stefan Gustavson, MIT): estable en cualquier GPU
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
float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * (0.5 + 0.5 * snoise(p)); p *= 2.03; a *= 0.5; } return s; }`;

const SKY_VS = `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FS = `uniform float uT; varying vec3 vDir; ${NOISE}
void main(){
  vec3 d = normalize(vDir);
  vec3 col = mix(vec3(0.008, 0.01, 0.035), vec3(0.03, 0.015, 0.07), d.y * 0.5 + 0.5);
  // banda galáctica
  float band = exp(-pow(dot(d, normalize(vec3(0.25, 1.0, 0.35))) * 3.2, 2.0));
  float n1 = fbm(d * 3.0 + vec3(uT * 0.01, 0.0, uT * 0.006));
  float n2 = fbm(d * 6.0 - vec3(0.0, uT * 0.008, 0.0) + n1 * 1.5);
  col += vec3(0.32, 0.16, 0.5) * band * smoothstep(0.45, 0.9, n2) * 0.85;
  col += vec3(0.95, 0.75, 0.55) * band * pow(n2, 6.0) * 1.1;
  // nebulosas de color
  float nA = smoothstep(0.56, 0.98, fbm(d * 2.2 + vec3(4.0, uT * 0.004, 1.0)));
  float nB = smoothstep(0.58, 0.98, fbm(d * 2.6 + vec3(-3.0, 2.0, uT * 0.005)));
  col += vec3(0.85, 0.2, 0.55) * nA * 0.42 + vec3(0.15, 0.45, 0.95) * nB * 0.38;
  col += vec3(1.0, 0.55, 0.25) * pow(nA * nB, 1.5) * 0.6;
  // polvo oscuro que recorta la nebulosa
  col *= 1.0 - 0.45 * smoothstep(0.55, 0.8, fbm(d * 8.0 + 10.0)) * band;
  gl_FragColor = vec4(col, 1.0);
}`;

const STAR_VS = `attribute float aSize; attribute float aPh; attribute vec3 aCol; uniform float uT; uniform float uPR; varying vec3 vCol; varying float vA;
void main(){ vCol = aCol; vA = 0.55 + 0.45 * sin(uT * (1.0 + aPh * 2.0) + aPh * 40.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uPR * (0.8 + 0.4 * vA); gl_Position = projectionMatrix * mv; }`;
const STAR_FS = `varying vec3 vCol; varying float vA;
void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); float core = smoothstep(0.5, 0.0, d);
  float cross = max(smoothstep(0.06, 0.0, abs(p.x)) , smoothstep(0.06, 0.0, abs(p.y))) * smoothstep(0.5, 0.1, d) * 0.6;
  gl_FragColor = vec4(vCol * (core * core + cross) * vA * 1.6, 1.0); }`;

const DUST_VS = `attribute float aPh; attribute vec3 aCol; uniform float uT; uniform float uPR; varying vec3 vCol; varying float vA;
void main(){ vec3 p = position; p.y = mod(p.y + uT * (0.25 + aPh * 0.4) + 20.0, 40.0) - 20.0; p.x += sin(uT * 0.3 + aPh * 30.0) * 0.6;
  vCol = aCol; vA = smoothstep(20.0, 12.0, abs(p.y)) * (0.5 + 0.5 * sin(uT * 2.0 + aPh * 50.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = (3.0 + aPh * 5.0) * uPR * (30.0 / -mv.z); gl_Position = projectionMatrix * mv; }`;
const DUST_FS = `varying vec3 vCol; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vCol * smoothstep(0.5, 0.0, d) * vA, 1.0); }`;

const PORTAL_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PORTAL_FS = `uniform sampler2D uMap; uniform float uT; uniform float uHover; uniform float uLock; uniform float uDim; uniform float uWarp; uniform vec3 uCol; varying vec2 vUv;
void main(){
  vec2 c = vUv - 0.5; float r = length(c) * 2.0; float a = atan(c.y, c.x);
  // remolino suave en el borde, más fuerte al entrar
  float sw = (1.0 - r) * 0.0 + pow(r, 3.0) * (0.55 + uHover * 0.3) + uWarp * (1.0 - r) * 2.5;
  float aa = a + sw * sin(uT * 0.7) * 0.6 + uWarp * uT * 2.0;
  vec2 uv = vec2(cos(aa), sin(aa)) * length(c) * (0.92 - uHover * 0.06 - uWarp * 0.3) + 0.5;
  uv += vec2(sin(uT * 0.25), cos(uT * 0.2)) * 0.012;
  vec3 img = texture2D(uMap, uv).rgb;
  float l = dot(img, vec3(0.299, 0.587, 0.114));
  img = mix(img, vec3(l) * vec3(0.55, 0.6, 0.75), uLock * 0.85);
  img *= mix(1.0, 0.45, uLock) * mix(1.0, 0.32, uDim);
  // velo de energía con ondas
  float wave = sin(r * 22.0 - uT * 4.0 + a * 3.0) * 0.5 + 0.5;
  vec3 col = img + uCol * pow(r, 5.0) * (0.7 + uHover * 0.5) + uCol * wave * pow(r, 8.0) * 0.5;
  col += uCol * (1.0 - r) * uWarp * 1.5;
  float edge = smoothstep(1.0, 0.94, r);
  gl_FragColor = vec4(col * 0.9, edge);
}`;

const RING_VS = `attribute float aPh; uniform float uT; uniform float uR; uniform float uPR; uniform float uBoost; varying float vA;
void main(){ float ang = aPh * 6.2831 + uT * (0.35 + fract(aPh * 7.0) * 0.6) * (fract(aPh * 13.0) > 0.5 ? 1.0 : -1.0);
  float rr = uR + sin(uT * 1.7 + aPh * 30.0) * 0.18 + fract(aPh * 31.0) * 0.35;
  vec3 p = vec3(cos(ang) * rr, sin(ang) * rr, sin(uT * 2.0 + aPh * 20.0) * 0.25);
  vA = (0.4 + 0.6 * fract(aPh * 17.0)) * (0.6 + uBoost);
  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = (2.0 + fract(aPh * 23.0) * 4.0) * uPR * (12.0 / -mv.z) * (1.0 + uBoost * 0.4); gl_Position = projectionMatrix * mv; }`;
const RING_FS = `uniform vec3 uCol; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(mix(uCol, vec3(1.0), 0.35) * smoothstep(0.5, 0.0, d) * vA, 1.0); }`;

/* ---------------- texturas procedurales ---------------- */
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTex = canvasTex(128, 128, (g) => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});
const runeTex = canvasTex(1024, 64, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.fillStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 3;
  for (let i = 0; i < 48; i++) {
    const x = (i / 48) * w + 6, y = h / 2;
    const k = (i * 7919) % 5;
    g.beginPath();
    if (k === 0) { g.moveTo(x, y - 14); g.lineTo(x + 8, y + 14); g.lineTo(x + 16, y - 14); }
    else if (k === 1) { g.arc(x + 8, y, 9, 0, TAU); }
    else if (k === 2) { g.moveTo(x, y); g.lineTo(x + 16, y); g.moveTo(x + 8, y - 14); g.lineTo(x + 8, y + 14); }
    else if (k === 3) { g.rect(x + 2, y - 8, 12, 16); }
    else { g.moveTo(x, y + 12); g.lineTo(x + 8, y - 12); g.lineTo(x + 16, y + 12); g.closePath(); }
    g.stroke();
  }
  g.fillRect(0, 2, w, 2); g.fillRect(0, h - 4, w, 2);
});
runeTex.wrapS = THREE.RepeatWrapping;
function planetTex(c1, c2, c3, seed) {
  return canvasTex(512, 256, (g, w, h) => {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, c1); gr.addColorStop(0.5, c2); gr.addColorStop(1, c1);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) {
      const y = rnd() * h, bh = 3 + rnd() * 18;
      g.fillStyle = i % 3 ? c3 : c2; g.globalAlpha = 0.18 + rnd() * 0.3;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.02 + i) * bh * 0.4);
      g.lineTo(w, y + bh); g.lineTo(0, y + bh); g.fill();
    }
    g.globalAlpha = 1;
  });
}

/* ====================================================================== */
export class WorldSelect {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 2000);
    this.t = 0;
    this.portals = [];
    this.hover = -1;
    this.sel = -1;
    this.phase = 'idle';
    this.yaw = 0; this.yawT = 0;
    this.camPos = new THREE.Vector3(0, 2.4, 16);
    this.camLook = new THREE.Vector3(0, 1.2, 0);
    this.fov = 52;
    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-9, -9);
    this.pr = Math.min(window.devicePixelRatio || 1, 2);
    this.texLoader = new THREE.TextureLoader();
    this.buildSpace();
  }

  /* ---------------- universo ---------------- */
  buildSpace() {
    const S = this.scene;
    this.skyU = { uT: { value: 0 } };
    S.add(new THREE.Mesh(new THREE.SphereGeometry(900, 48, 32), new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false })));
    // estrellas
    const N = 4200, pos = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N), col = new Float32Array(N * 3);
    const tints = [[1, 1, 1], [0.75, 0.85, 1], [1, 0.85, 0.7], [0.9, 0.8, 1]];
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * TAU, r = 600 + Math.random() * 200;
      pos[i * 3] = Math.sqrt(1 - u * u) * Math.cos(a) * r; pos[i * 3 + 1] = u * r; pos[i * 3 + 2] = Math.sqrt(1 - u * u) * Math.sin(a) * r;
      size[i] = Math.random() < 0.03 ? 5 + Math.random() * 6 : 1 + Math.random() * 2.6;
      ph[i] = Math.random();
      const tc = tints[i % 4]; col.set(tc, i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    sg.setAttribute('aPh', new THREE.BufferAttribute(ph, 1)); sg.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    this.starU = { uT: { value: 0 }, uPR: { value: this.pr } };
    S.add(new THREE.Points(sg, new THREE.ShaderMaterial({ uniforms: this.starU, vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    // polvo de energía alrededor de los portales
    const D = 700, dp = new Float32Array(D * 3), dph = new Float32Array(D), dc = new Float32Array(D * 3);
    const dcols = [[0.5, 0.7, 1], [1, 0.6, 0.9], [1, 0.8, 0.5], [0.6, 1, 0.95]];
    for (let i = 0; i < D; i++) {
      dp[i * 3] = (Math.random() - 0.5) * 70; dp[i * 3 + 1] = (Math.random() - 0.5) * 40; dp[i * 3 + 2] = -40 + Math.random() * 56;
      dph[i] = Math.random(); dc.set(dcols[i % 4], i * 3);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3)); dg.setAttribute('aPh', new THREE.BufferAttribute(dph, 1)); dg.setAttribute('aCol', new THREE.BufferAttribute(dc, 3));
    this.dustU = { uT: { value: 0 }, uPR: { value: this.pr } };
    const dust = new THREE.Points(dg, new THREE.ShaderMaterial({ uniforms: this.dustU, vertexShader: DUST_VS, fragmentShader: DUST_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    dust.frustumCulled = false;
    S.add(dust);
    // luz cinematográfica: estrella cálida lateral + relleno frío
    S.add(new THREE.AmbientLight(0x3a3a6a, 0.6));
    const key = new THREE.DirectionalLight(0xffd8b0, 2.4); key.position.set(-60, 30, 20); S.add(key);
    const rim = new THREE.DirectionalLight(0x6aa8ff, 1.4); rim.position.set(50, -10, -60); S.add(rim);
    // sol lejano
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc890, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sun.position.set(-260, 90, -420); sun.scale.setScalar(220); S.add(sun);
    // planetas a distintas distancias
    this.planets = [];
    const mk = (r, x, y, z, tex, ring, spin, tilt = 0.3) => {
      const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.z = tilt;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 40), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 }));
      g.add(m);
      const atm = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: ring ? 0xffb07a : 0x7ab8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35 }));
      atm.scale.setScalar(r * 2.9); g.add(atm);
      if (ring) {
        const rg = new THREE.RingGeometry(r * 1.4, r * 2.3, 96);
        const rm = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ map: canvasTex(256, 8, (c, w, h) => { for (let i = 0; i < w; i++) { c.fillStyle = `rgba(${220 - (i % 40)},${180 - (i % 30)},${140},${0.15 + 0.5 * Math.abs(Math.sin(i * 0.11))})`; c.fillRect(i, 0, 1, h); } }), transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.8 }));
        // UV radial para el anillo
        const p = rg.attributes.position, uv = rg.attributes.uv;
        for (let i = 0; i < p.count; i++) { const d = Math.hypot(p.getX(i), p.getY(i)); uv.setXY(i, (d - r * 1.4) / (r * 0.9), 0.5); }
        rm.rotation.x = Math.PI / 2 - 0.25; g.add(rm);
      }
      this.scene.add(g);
      this.planets.push({ g, m, spin });
    };
    mk(55, 250, 160, -440, planetTex('#5a2a6a', '#c86a9a', '#ffd0a0', 11), true, 0.02, 0.35);
    mk(24, -170, -120, -280, planetTex('#1a3a6a', '#3a8ad8', '#bfe8ff', 23), false, 0.05, -0.2);
    mk(9, 100, -64, -170, planetTex('#6a3a1a', '#d88a3a', '#ffe0a0', 37), false, 0.09, 0.1);
    mk(110, -470, 280, -820, planetTex('#1a4a3a', '#3aa87a', '#c8ffd8', 51), false, 0.008, 0.5);
    mk(4, -64, 58, -120, planetTex('#4a4a5a', '#9a9ab0', '#e8e8f0', 71), false, 0.12, 0);
  }

  /* ---------------- portales ---------------- */
  buildPortals(levels, isUnlocked) {
    for (const p of this.portals) { this.scene.remove(p.g); p.label.remove(); }
    this.portals = [];
    const n = levels.length;
    // dos arcos (anfiteatro): delante y abajo los primeros mundos, detrás y arriba los siguientes
    const rows = n > 6 ? 2 : 1, perRow = Math.ceil(n / rows);
    this.arc = { cx: 0, cz: 7, R: 15, span: 1.9 };
    const rowDef = [{ R: 15, span: Math.min(1.9, 0.48 * (perRow - 1)), y: 0 }, { R: 21, span: Math.min(1.5, 0.38 * (perRow - 1)), y: 5.2 }];
    const labels = document.getElementById('ws-labels');
    labels.innerHTML = '';
    levels.forEach((L, i) => {
      const col = new THREE.Color(WORLD_COL[L.id] || 0x8ab8ff);
      const row = Math.floor(i / perRow), idx = i - row * perRow, m = Math.min(perRow, n - row * perRow);
      const rd = rowDef[row];
      const k = m > 1 ? idx / (m - 1) - 0.5 : 0;
      const a = k * rd.span;
      const g = new THREE.Group();
      const base = new THREE.Vector3(this.arc.cx + Math.sin(a) * rd.R, rd.y + Math.abs(k) * 1.2 + Math.sin(i * 1.7) * 0.3, this.arc.cz - Math.cos(a) * rd.R);
      g.position.copy(base);
      g.userData.s0 = 1.3; // portales grandes
      g.lookAt(this.arc.cx, base.y, this.arc.cz + 6);
      const locked = !isUnlocked(L.n);
      const tex = this.texLoader.load(`/img/worlds/${L.id}.jpg`); tex.colorSpace = THREE.SRGBColorSpace;
      const u = { uMap: { value: tex }, uT: { value: Math.random() * 10 }, uHover: { value: 0 }, uLock: { value: locked ? 1 : 0 }, uDim: { value: 0 }, uWarp: { value: 0 }, uCol: { value: col } };
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1.55, 72), new THREE.ShaderMaterial({ uniforms: u, vertexShader: PORTAL_VS, fragmentShader: PORTAL_FS, transparent: true, depthWrite: false }));
      disc.userData.i = i;
      g.add(disc);
      // marco de energía: aro principal, aro de runas que gira y aro fino exterior
      const frameM = new THREE.MeshStandardMaterial({ color: 0x1a1a2a, emissive: col, emissiveIntensity: 1.4, metalness: 0.7, roughness: 0.3 });
      const frame = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.085, 16, 96), frameM);
      g.add(frame);
      const runesM = new THREE.MeshBasicMaterial({ map: runeTex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.75 });
      const runeGeo = new THREE.RingGeometry(1.74, 1.98, 96, 1);
      { const p = runeGeo.attributes.position, uv = runeGeo.attributes.uv; for (let j = 0; j < p.count; j++) { const ang = Math.atan2(p.getY(j), p.getX(j)); const d = Math.hypot(p.getX(j), p.getY(j)); uv.setXY(j, (ang / TAU + 0.5) * 3, (d - 1.74) / 0.24); } }
      const runes = new THREE.Mesh(runeGeo, runesM);
      g.add(runes);
      const outer = new THREE.Mesh(new THREE.TorusGeometry(2.08, 0.022, 8, 120), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending }));
      g.add(outer);
      // cristales que flotan en el marco
      const gems = [];
      for (let j = 0; j < 4; j++) {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: col, emissiveIntensity: 2.2 }));
        g.add(gem); gems.push(gem);
      }
      // halo
      const glowM = new THREE.SpriteMaterial({ map: glowTex, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 });
      const glow = new THREE.Sprite(glowM); glow.scale.setScalar(7.5); glow.position.z = -0.15;
      g.add(glow);
      // partículas en órbita
      const PN = 90, pph = new Float32Array(PN), ppos = new Float32Array(PN * 3);
      for (let j = 0; j < PN; j++) pph[j] = Math.random();
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(ppos, 3)); pg.setAttribute('aPh', new THREE.BufferAttribute(pph, 1));
      const pu = { uT: { value: 0 }, uR: { value: 1.85 }, uPR: { value: this.pr }, uBoost: { value: 0 }, uCol: { value: col } };
      const parts = new THREE.Points(pg, new THREE.ShaderMaterial({ uniforms: pu, vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      parts.frustumCulled = false;
      g.add(parts);
      // onda de energía al pasar el cursor
      const wave = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.75, 96), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      g.add(wave);
      this.scene.add(g);
      // etiqueta del nombre (HTML, nítida)
      const label = document.createElement('div');
      label.className = 'ws-label' + (locked ? ' locked' : '');
      label.innerHTML = `<span class="wl-n">${locked ? '🔒' : L.icon} NIVEL ${L.n}</span><span class="wl-name">${L.name}</span>`;
      label.style.setProperty('--wc', '#' + col.getHexString());
      labels.appendChild(label);
      this.portals.push({ i, L, g, base, ang: a, disc, u, frame, frameM, runes, runesM, outer, gems, glow, glowM, pu, wave, waveT: 9, label, locked, col, ph: Math.random() * TAU, h: 0, s: 1 });
    });
  }

  /* ---------------- apertura / cierre ---------------- */
  open({ levels, isUnlocked, stars, rewardOf, bestOf, onEnter, startIndex = 0 }) {
    this.levels = levels; this.isUnlocked = isUnlocked; this.stars = stars; this.rewardOf = rewardOf; this.bestOf = bestOf; this.onEnter = onEnter;
    this.buildPortals(levels, isUnlocked);
    this.root = document.getElementById('missions');
    this.info = document.getElementById('ws-info');
    this.enterBtn = document.getElementById('ws-enter');
    this.flash = document.getElementById('ws-flash');
    this.flash.classList.remove('on');
    this.flash.style.opacity = '';
    this.sel = -1; this.hover = -1; this.phase = 'idle';
    this.focus = clamp(startIndex, 0, levels.length - 1);
    this.yaw = this.yawT = this.focusYaw(this.focus) * this.panScale();
    this.camPos.set(0, 9, 34); // entrada: la cámara llega desde lejos
    this.fov = 70;
    this.showInfo(-1);
    this.active = true;
    this.bind();
  }
  close() {
    this.active = false;
    this.unbind();
  }
  focusYaw(i) { return this.portals[i] ? this.portals[i].ang : 0; }
  // en pantallas estrechas el arco no cabe entero: la cámara gira para seguir al portal elegido
  panScale() { const asp = this.camera.aspect; return asp >= 1.6 ? 0 : asp >= 1.15 ? 0.45 : 0.85; }

  bind() {
    if (this._b) return;
    const el = document.getElementById('missions');
    const pt = (e) => { this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1); };
    let down = null;
    this._b = {
      move: (e) => { pt(e); if (down && Math.abs(e.clientX - down.x) > 6) { down.drag = true; this.yawT = clamp(down.yaw - (e.clientX - down.x) * 0.004, -this.arc.span / 2, this.arc.span / 2); } },
      down: (e) => { if (e.target.closest?.('button, .ws-info')) return; pt(e); down = { x: e.clientX, yaw: this.yawT, drag: false }; },
      up: (e) => {
        if (!down) return;
        const wasDrag = down.drag; down = null;
        if (wasDrag || e.target.closest?.('button, .ws-info')) return;
        pt(e); const h = this.pick();
        if (h >= 0) this.select(h); else if (this.phase === 'idle') this.select(-1);
      },
      key: (e) => {
        if (!this.active || this.phase === 'entering') return;
        const n = this.portals.length;
        if (e.code === 'ArrowRight' || e.code === 'KeyD') this.select(this.sel < 0 ? this.focus : Math.min(n - 1, this.sel + 1));
        else if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.select(this.sel < 0 ? this.focus : Math.max(0, this.sel - 1));
        else if ((e.code === 'Enter' || e.code === 'Space') && this.sel >= 0) { e.preventDefault(); this.enter(); }
        else if (e.code === 'Escape' && this.sel >= 0) this.select(-1);
      },
      wheel: (e) => { if (this.sel < 0) this.yawT = clamp(this.yawT + e.deltaY * 0.0012, -this.arc.span / 2, this.arc.span / 2); },
    };
    el.addEventListener('pointermove', this._b.move);
    el.addEventListener('pointerdown', this._b.down);
    window.addEventListener('pointerup', this._b.up);
    window.addEventListener('keydown', this._b.key);
    el.addEventListener('wheel', this._b.wheel, { passive: true });
    this.enterBtn.onclick = () => this.enter();
    const step = (d) => { if (this.phase === 'entering') return; const n = this.portals.length; const base = this.sel < 0 ? this.focus - (d > 0 ? 1 : -1) * 0 : this.sel; this.select(clamp(this.sel < 0 ? base : base + d, 0, n - 1)); };
    document.getElementById('ws-prev').onclick = () => step(-1);
    document.getElementById('ws-next').onclick = () => step(1);
  }
  unbind() {
    if (!this._b) return;
    const el = document.getElementById('missions');
    el.removeEventListener('pointermove', this._b.move);
    el.removeEventListener('pointerdown', this._b.down);
    window.removeEventListener('pointerup', this._b.up);
    window.removeEventListener('keydown', this._b.key);
    el.removeEventListener('wheel', this._b.wheel);
    this._b = null;
  }

  pick() {
    this.ray.setFromCamera(this.mouse, this.camera);
    const hits = this.ray.intersectObjects(this.portals.map((p) => p.disc), false);
    return hits.length ? hits[0].object.userData.i : -1;
  }

  select(i) {
    if (this.phase === 'entering') return;
    this.sel = i;
    if (i >= 0) { this.focus = i; this.yawT = this.focusYaw(i) * this.panScale(); }
    this.showInfo(i);
  }

  showInfo(i) {
    const info = this.info;
    this.root.classList.toggle('has-sel', i >= 0);
    if (i < 0) { info.classList.remove('show'); this.enterBtn.disabled = true; this.enterBtn.textContent = 'ENTRAR AL MUNDO'; return; }
    const p = this.portals[i], L = p.L;
    const st = this.stars(L.id);
    const rw = this.rewardOf(L);
    info.style.setProperty('--wc', '#' + p.col.getHexString());
    info.innerHTML = `<div class="wi-kicker">${L.kicker}</div><div class="wi-name">${L.icon} ${L.name}</div><div class="wi-place">${L.place}</div>
      <p class="wi-desc">${L.desc}</p>
      <div class="wi-meta"><span>Dificultad ${'🔥'.repeat(Math.ceil(L.n / 2))}</span><span>${[0, 1, 2].map((k) => (k < st ? '⭐' : '☆')).join('')}</span>${rw ? `<span>Premio: ${rw.icon} ${rw.name}</span>` : ''}<span>Ideal: ${this.bestOf(L)}</span></div>
      ${p.locked ? `<div class="wi-lock">🔒 Completa el nivel ${L.n - 1} para abrir este portal</div>` : ''}`;
    info.classList.add('show');
    this.enterBtn.disabled = p.locked;
    this.enterBtn.textContent = p.locked ? '🔒 PORTAL CERRADO' : 'ENTRAR AL MUNDO';
  }

  // Transición: la cámara viaja hacia el portal, lo atraviesa y se abre el mundo real
  enter() {
    if (this.sel < 0 || this.phase === 'entering') return;
    const p = this.portals[this.sel];
    if (p.locked) return;
    this.phase = 'entering';
    this.enterT = 0;
    this.root.classList.add('entering');
    this.flash.style.setProperty('--wc', '#' + p.col.getHexString());
  }

  /* ---------------- actualización ---------------- */
  setSize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    this.skyU.uT.value = t; this.starU.uT.value = t; this.dustU.uT.value = t;
    for (const pl of this.planets) { pl.m.rotation.y += dt * pl.spin; pl.g.position.y += Math.sin(t * 0.1 + pl.spin * 50) * dt * 0.3; }
    // cursor sobre un portal
    const h = this.phase === 'entering' ? -1 : this.pick();
    if (h !== this.hover) {
      if (h >= 0) { const p = this.portals[h]; p.waveT = 0; }
      this.hover = h;
      document.body.style.cursor = h >= 0 ? 'pointer' : '';
    }
    // portales
    for (const p of this.portals) {
      const isH = p.i === this.hover, isS = p.i === this.sel;
      p.h = damp(p.h, isH || isS ? 1 : 0, 8, dt);
      const dim = this.sel >= 0 && !isS ? 1 : 0;
      p.u.uDim.value = damp(p.u.uDim.value, dim, 5, dt);
      p.u.uHover.value = p.h; p.u.uT.value += dt;
      p.s = damp(p.s, 1 + p.h * 0.1, 8, dt);
      p.g.position.set(p.base.x, p.base.y + Math.sin(t * 0.8 + p.ph) * 0.22, p.base.z);
      p.g.scale.setScalar(p.s * 1.3);
      p.runes.rotation.z += dt * (0.25 + p.h * 0.8);
      p.outer.rotation.z -= dt * 0.15;
      p.frameM.emissiveIntensity = (p.locked ? 0.4 : 1.2) + p.h * (isS ? 0.5 : 1.2) + Math.sin(t * 2 + p.ph) * 0.2;
      const dm = 1 - p.u.uDim.value * 0.75;
      p.frameM.emissiveIntensity *= dm;
      p.runesM.opacity = ((p.locked ? 0.25 : 0.65) + p.h * 0.35) * dm;
      p.outer.material.opacity = 0.7 * dm;
      p.glowM.opacity = ((p.locked ? 0.16 : 0.36) + (isS ? 0.05 : p.h * 0.3)) * (1 - p.u.uDim.value * 0.6);
      p.pu.uT.value = t + p.ph * 10; p.pu.uBoost.value = p.h;
      p.gems.forEach((gm, j) => { const a = t * 0.6 + (j / 4) * TAU + p.ph; gm.position.set(Math.cos(a) * 2.25, Math.sin(a) * 2.25, 0.1); gm.rotation.y += dt * 2; gm.rotation.x += dt; });
      if (p.waveT < 1.2) {
        p.waveT += dt;
        const k = p.waveT / 1.2;
        p.wave.scale.setScalar(1 + k * 0.9);
        p.wave.material.opacity = (1 - k) * 0.9;
      } else p.wave.material.opacity = 0;
    }
    // cámara
    this.yaw = damp(this.yaw, this.yawT, 3.5, dt);
    const A = this.arc;
    const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
    let wantFov = 52;
    if (this.phase === 'entering') {
      const p = this.portals[this.sel];
      this.enterT += dt;
      const k = clamp(this.enterT / 1.6, 0, 1);
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(p.g.quaternion); // normal hacia la cámara
      const from = p.g.position.clone().addScaledVector(n, 5.5);
      const to = p.g.position.clone().addScaledVector(n, -2.5);
      const e = k * k * (3 - 2 * k);
      wantPos.lerpVectors(from, to, Math.pow(e, 1.6));
      wantLook.copy(p.g.position).addScaledVector(n, -6);
      wantFov = lerp(48, 105, Math.pow(k, 2.2));
      p.u.uWarp.value = k;
      p.runes.rotation.z += dt * k * 6;
      this.flash.style.opacity = String(clamp((k - 0.62) / 0.3, 0, 1));
      this.camPos.lerp(wantPos, 1 - Math.exp(-10 * dt));
      this.camLook.lerp(wantLook, 1 - Math.exp(-10 * dt));
      this.fov = damp(this.fov, wantFov, 8, dt);
      if (k >= 1 && !this.done) {
        this.done = true;
        const i = this.sel;
        setTimeout(() => { this.done = false; this.onEnter && this.onEnter(i); }, 60);
      }
    } else if (this.sel >= 0) {
      const p = this.portals[this.sel];
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(p.g.quaternion);
      const asp = this.camera.aspect;
      const d = asp < 1 ? 12 : 8.6;
      wantPos.copy(p.g.position).addScaledVector(n, d); wantPos.y += 0.5;
      // deja hueco a la derecha para el panel de información (en pantallas anchas)
      const side = new THREE.Vector3(n.z, 0, -n.x);
      if (asp >= 1.15) wantPos.addScaledVector(side, 1.9);
      wantLook.copy(p.g.position); if (asp >= 1.15) wantLook.addScaledVector(side, 1.9);
      if (asp < 1.15) wantLook.y -= 1.2;
      wantFov = 48;
    } else {
      const asp = this.camera.aspect;
      const back = asp >= 1.6 ? 7 : asp >= 1.15 ? 6 : 3;
      const dir = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      wantPos.set(A.cx - dir.x * back, 3.2 + Math.sin(t * 0.25) * 0.3, A.cz - dir.z * back);
      wantLook.set(A.cx + dir.x * A.R, 2.6, A.cz + dir.z * A.R);
      wantFov = asp >= 1.6 ? 62 : asp >= 1.15 ? 64 : 66;
    }
    if (this.phase !== 'entering') {
      this.camPos.lerp(wantPos, 1 - Math.exp(-3 * dt));
      this.camLook.lerp(wantLook, 1 - Math.exp(-3.5 * dt));
      this.fov = damp(this.fov, wantFov, 3, dt);
    }
    const cam = this.camera;
    cam.position.copy(this.camPos);
    cam.position.x += Math.sin(t * 0.21) * 0.15; cam.position.y += Math.sin(t * 0.17) * 0.1;
    cam.lookAt(this.camLook);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    // etiquetas bajo cada portal
    const v = new THREE.Vector3();
    const W = window.innerWidth, H = window.innerHeight;
    for (const p of this.portals) {
      v.set(0, -2.4, 0).multiplyScalar(1).applyMatrix4(p.g.matrixWorld);
      v.project(cam);
      const vis = v.z < 1 && Math.abs(v.x) < 1.2 && this.phase !== 'entering';
      p.label.style.transform = `translate(-50%, 0) translate(${((v.x + 1) / 2) * W}px, ${((1 - v.y) / 2) * H}px) scale(${0.85 + p.h * 0.25})`;
      p.label.style.opacity = vis ? String(this.sel >= 0 && this.sel !== p.i ? 0.25 : 1) : '0';
      p.label.classList.toggle('hot', p.i === this.hover || p.i === this.sel);
    }
  }
}
