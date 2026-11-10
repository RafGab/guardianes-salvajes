import * as THREE from 'three';

/* ======================================================================
   EFECTOS AVANZADOS DE HABILIDADES (3.ª tanda)
   · SandStorm  — haboob del Feneco: muro de arena con volumen y profundidad
   · WaterGate  — hidroteletransporte de la Nutria: remolino, arco de agua y géiser
   · SpringWard — escudo de primavera de la Zorra: suelo rosa y naturaleza protectora
   Todo usa geometrías y materiales propios que se liberan en dispose(), y
   shaders ligeros (ruido de valor, 3 octavas) en pocas mallas grandes.
   ====================================================================== */

const TAU = Math.PI * 2;
const NOISE = /* glsl */`
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1,0)), u.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), u.x), u.y); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ s += a * vnoise(p); p *= 2.07; a *= 0.5; } return s; }
`;
const ease = (k) => 1 - Math.pow(1 - k, 3);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/* ---------------------------------------------------------------- */
/*  Material de "volumen" (arena o agua): nubes de ruido que fluyen  */
/*  · densidad con deformación del dominio → bocanadas que se mueven */
/*  · bordes suaves según el ángulo de visión → sin siluetas duras   */
/*  · el vértice se hincha con el ruido → la superficie respira      */
/* ---------------------------------------------------------------- */
export function cloudMat({ dark = 0x7a5530, light = 0xf0d49a, opacity = 0.8, scale = 3, rise = 0.35, swirl = 0.12, puff = 0.18, additive = false, rim = 0.0, vertical = true } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uT: { value: 0 }, uOp: { value: opacity }, uScale: { value: scale }, uRise: { value: rise }, uSwirl: { value: swirl },
      uPuff: { value: puff }, uDark: { value: new THREE.Color(dark) }, uLight: { value: new THREE.Color(light) }, uRim: { value: rim }, uSpread: { value: 0 }, uVert: { value: vertical ? 1 : 0 },
    },
    vertexShader: NOISE + `uniform float uT; uniform float uPuff; uniform float uSpread;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vUv = uv;
        vec3 p = position;
        float n = vnoise(vec2(uv.x * 9.0 + uT * 0.6, uv.y * 5.0 - uT * 0.9));
        p += normal * (n - 0.35) * uPuff * (0.4 + uv.y) + normal * uSpread * (0.4 + uv.y);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: NOISE + `uniform float uT; uniform float uOp; uniform float uScale; uniform float uRise; uniform float uSwirl; uniform float uRim; uniform float uVert;
      uniform vec3 uDark; uniform vec3 uLight;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vec2 q = vec2(vUv.x * uScale * 2.0 + uT * uSwirl, vUv.y * uScale - uT * uRise);
        vec2 w = vec2(fbm(q + vec2(0.0, uT * 0.15)), fbm(q + vec2(5.2, 1.3)));
        float d = fbm(q + w * 1.6);
        float dens = smoothstep(0.28, 0.72, d);
        float y = vUv.y;
        float vert = mix(1.0, smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(0.62, 1.0, y)), uVert);
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float soft = smoothstep(0.0, 0.55, facing);
        float a = (0.25 + 0.75 * dens) * vert * soft * uOp;
        vec3 c = mix(uDark, uLight, clamp(dens * 0.75 + y * 0.45, 0.0, 1.0));
        c += uRim * pow(1.0 - facing, 3.0) * uLight;
        gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
      }`,
  });
}

// punto suave para las partículas (granos de arena, gotas)
let DOT = null;
function dotTex() {
  if (DOT) return DOT;
  const S = 32, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.45, 'rgba(255,255,255,0.7)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  DOT = new THREE.CanvasTexture(c);
  return DOT;
}
// textura radial (sombra / mancha en el suelo)
const radialTexCache = {};
function radialTex(key, stops) {
  if (radialTexCache[key]) return radialTexCache[key];
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (radialTexCache[key] = t);
}

/* ================================================================== */
/*  FENECO — HABOOB: muro de arena que se forma, avanza y se disipa    */
/* ================================================================== */
export class SandStorm {
  constructor(width, height = 5.2) {
    this.w = width; this.h = height;
    this.group = new THREE.Group();
    this.mats = []; this.geos = [];
    const dome = (sx, sy, sz, mat) => {
      const geo = new THREE.SphereGeometry(1, 40, 18, 0, TAU, 0, Math.PI / 2);
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(sx, sy, sz); m.renderOrder = 4; m.frustumCulled = false;
      this.geos.push(geo); this.mats.push(mat); this.group.add(m);
      return m;
    };
    // tres capas de muro (de fuera a dentro): profundidad real al mirar a través de la tormenta
    this.layers = [
      dome(width * 0.62, height, width * 0.48, cloudMat({ dark: 0x8a5e30, light: 0xf2d8a0, opacity: 0.55, scale: 2.6, rise: 0.45, swirl: 0.22, puff: 0.5 })),
      dome(width * 0.48, height * 0.86, width * 0.36, cloudMat({ dark: 0x6a4424, light: 0xe0b878, opacity: 0.7, scale: 3.2, rise: 0.6, swirl: -0.3, puff: 0.35 })),
      dome(width * 0.32, height * 0.7, width * 0.24, cloudMat({ dark: 0x5a3820, light: 0xd0a060, opacity: 0.8, scale: 4.0, rise: 0.8, swirl: 0.45, puff: 0.25 })),
    ];
    // embudo central: el corazón giratorio del haboob
    const fGeo = new THREE.CylinderGeometry(width * 0.2, width * 0.06, height * 0.95, 28, 8, true);
    fGeo.translate(0, height * 0.475, 0);
    this.funnelMat = cloudMat({ dark: 0x7a5028, light: 0xffe2a8, opacity: 0.6, scale: 5, rise: 1.4, swirl: 1.1, puff: 0.15, rim: 0.25 });
    this.funnel = new THREE.Mesh(fGeo, this.funnelMat);
    this.funnel.renderOrder = 5; this.funnel.frustumCulled = false;
    this.geos.push(fGeo); this.mats.push(this.funnelMat); this.group.add(this.funnel);
    // sombra de arena en el suelo
    const sGeo = new THREE.CircleGeometry(width * 0.8, 40);
    sGeo.rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({ map: radialTex('sand', [[0, 'rgba(90,60,30,0.75)'], [0.6, 'rgba(120,85,45,0.45)'], [1, 'rgba(120,85,45,0)']]), transparent: true, depthWrite: false, opacity: 0 });
    this.shadow = new THREE.Mesh(sGeo, this.shadowMat);
    this.shadow.position.y = 0.05; this.shadow.renderOrder = 3;
    this.geos.push(sGeo); this.mats.push(this.shadowMat); this.group.add(this.shadow);
    // granos de arena que giran dentro del muro (profundidad y densidad) — un solo objeto Points
    const N = 650; this.N = N;
    this.ps = new Float32Array(N * 4); // ángulo, radio (0-1), altura (0-1), velocidad
    for (let i = 0; i < N; i++) { this.ps[i * 4] = Math.random() * TAU; this.ps[i * 4 + 1] = Math.sqrt(Math.random()); this.ps[i * 4 + 2] = Math.random(); this.ps[i * 4 + 3] = 0.6 + Math.random() * 0.8; }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.pMat = new THREE.PointsMaterial({ map: dotTex(), color: 0xe2bc7a, size: 0.2, transparent: true, opacity: 0, depthWrite: false });
    this.points = new THREE.Points(pg, this.pMat);
    this.points.frustumCulled = false; this.points.renderOrder = 6;
    this.geos.push(pg); this.mats.push(this.pMat); this.group.add(this.points);
    // corriente de arena de las orejas a la tormenta (en coordenadas del mundo): el feneco la controla
    const M = 170; this.M = M;
    this.ls = new Float32Array(M * 2); // posición a lo largo (0-1), fase
    for (let i = 0; i < M; i++) { this.ls[i * 2] = Math.random(); this.ls[i * 2 + 1] = Math.random() * TAU; }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 3), 3));
    this.lMat = new THREE.PointsMaterial({ map: dotTex(), color: 0xffd896, size: 0.14, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.link = new THREE.Points(lg, this.lMat);
    this.link.frustumCulled = false; this.link.renderOrder = 7;
    this.geos.push(lg); this.mats.push(this.lMat);
    this.t = 0;
  }
  // corriente de arena: curva de `from` (orejas) a `to` (cima de la tormenta), intensidad k
  updateLink(dt, from, to, k) {
    const P = this.link.geometry.attributes.position, mx = (from.x + to.x) / 2, mz = (from.z + to.z) / 2, my = Math.max(from.y, to.y) + 1.6;
    for (let i = 0; i < this.M; i++) {
      let u = this.ls[i * 2] + dt * (0.9 + (i % 7) * 0.05);
      if (u > 1) u -= 1;
      this.ls[i * 2] = u;
      const a = 1 - u, b = u, ph = this.ls[i * 2 + 1] + this.t * 6, sw = 0.25 * Math.sin(u * Math.PI);
      const x = a * a * from.x + 2 * a * b * mx + b * b * to.x, y = a * a * from.y + 2 * a * b * my + b * b * to.y, z = a * a * from.z + 2 * a * b * mz + b * b * to.z;
      P.setXYZ(i, x + Math.cos(ph) * sw, y + Math.sin(ph * 1.3) * sw, z + Math.sin(ph) * sw);
    }
    P.needsUpdate = true;
    this.lMat.opacity = 0.85 * clamp01(k);
    this.link.visible = k > 0.01;
  }
  // grow: 0→1 al formarse · fade: 1→0 al disiparse (se abre, sube y se aclara: nunca se encoge de golpe)
  update(dt, { grow = 1, fade = 1, yaw = 0 } = {}) {
    this.t += dt;
    const g = ease(clamp01(grow)), f = clamp01(fade), spread = 1 - f;
    this.group.rotation.y = yaw;
    const sy = 0.15 + 0.85 * g;
    this.layers.forEach((m, i) => {
      const u = m.material.uniforms;
      u.uT.value = this.t + i * 3.1;
      u.uOp.value = [0.55, 0.7, 0.8][i] * g * f;
      u.uSpread.value = spread * (1.2 + i * 0.4);
      m.rotation.y = this.t * (0.35 - i * 0.22);
      m.position.y = spread * 1.2;
      m.scale.y = [this.h, this.h * 0.86, this.h * 0.7][i] * sy * (1 + spread * 0.25);
    });
    const fu = this.funnelMat.uniforms;
    fu.uT.value = this.t; fu.uOp.value = 0.6 * g * f; fu.uSpread.value = spread * 0.8;
    this.funnel.rotation.y -= dt * 4;
    this.funnel.scale.set(0.6 + 0.4 * g + spread * 0.6, sy, 0.6 + 0.4 * g + spread * 0.6);
    this.shadowMat.opacity = 0.8 * g * f;
    this.shadow.scale.setScalar(0.5 + 0.5 * g + spread * 0.4);
    // granos: giran más rápido cerca del centro, suben en espiral y vuelven a entrar por abajo
    const P = this.points.geometry.attributes.position, W = this.w, H = this.h * sy;
    for (let i = 0; i < this.N; i++) {
      const o = i * 4, r = this.ps[o + 1], s = this.ps[o + 3];
      let a = this.ps[o] + dt * (2.2 - r * 1.3) * s, h = this.ps[o + 2] + dt * 0.16 * s;
      if (h > 1) { h -= 1; this.ps[o + 1] = Math.sqrt(Math.random()); }
      this.ps[o] = a; this.ps[o + 2] = h;
      const R = r * (0.55 + 0.45 * h) * (1 + spread * 0.8);
      P.setXYZ(i, Math.cos(a) * R * W * 0.6, h * H * 0.95 + spread * 1.5 * h, Math.sin(a) * R * W * 0.45);
    }
    P.needsUpdate = true;
    this.pMat.opacity = 0.9 * g * f;
  }
  dispose() { for (const g of this.geos) g.dispose(); for (const m of this.mats) m.dispose(); }
}

/* ================================================================== */
/*  NUTRIA — HIDROTELETRANSPORTE                                       */
/*  remolino que la absorbe · arco de agua que viaja · géiser que la   */
/*  devuelve · ondas en el suelo                                       */
/* ================================================================== */
export function waterMat(opacity = 0.75) {
  return cloudMat({ dark: 0x1a6ad8, light: 0xd8f6ff, opacity, scale: 3.5, rise: -1.6, swirl: 1.2, puff: 0.06, rim: 0.6 });
}
export class WaterGate {
  constructor() {
    this.group = new THREE.Group();
    this.geos = []; this.mats = [];
    // remolino (embudo invertido) que se forma bajo la Nutria
    const vGeo = new THREE.CylinderGeometry(1.1, 0.15, 1.6, 32, 6, true);
    vGeo.translate(0, 0.8, 0);
    this.vMat = waterMat(0.8);
    this.vortex = new THREE.Mesh(vGeo, this.vMat);
    this.vortex.renderOrder = 5; this.vortex.frustumCulled = false;
    // géiser de llegada (columna que sube y la devuelve)
    const gGeo = new THREE.CylinderGeometry(0.35, 0.7, 1, 28, 6, true);
    gGeo.translate(0, 0.5, 0);
    this.gMat = waterMat(0.85);
    this.geyser = new THREE.Mesh(gGeo, this.gMat);
    this.geyser.renderOrder = 5; this.geyser.frustumCulled = false;
    // charcos (círculos de agua) en el origen y el destino
    const pGeo = new THREE.CircleGeometry(1.4, 40); pGeo.rotateX(-Math.PI / 2);
    const pTex = radialTex('water', [[0, 'rgba(120,210,255,0.85)'], [0.55, 'rgba(60,160,240,0.55)'], [0.8, 'rgba(200,240,255,0.7)'], [1, 'rgba(120,200,255,0)']]);
    this.poolA = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ map: pTex, transparent: true, depthWrite: false, opacity: 0 }));
    this.poolB = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ map: pTex, transparent: true, depthWrite: false, opacity: 0 }));
    for (const m of [this.poolA, this.poolB]) { m.renderOrder = 3; this.mats.push(m.material); }
    this.geos.push(vGeo, gGeo, pGeo); this.mats.push(this.vMat, this.gMat);
    this.group.add(this.vortex, this.geyser, this.poolA, this.poolB);
    this.arc = null;
    this.t = 0;
  }
  // arco de agua entre a y b (tubo que sigue una parábola): el agua "lleva" a la Nutria
  setArc(a, b, height = 2.2) {
    const pts = [];
    for (let i = 0; i <= 24; i++) { const u = i / 24; pts.push(new THREE.Vector3(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u + Math.sin(u * Math.PI) * height + 0.3, a.z + (b.z - a.z) * u)); }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.22, 10, false);
    this.arcMat = cloudMat({ dark: 0x2a80e8, light: 0xffffff, opacity: 0, scale: 6, rise: 0, swirl: -3.2, puff: 0.08, rim: 0.7, additive: false, vertical: false });
    this.arc = new THREE.Mesh(geo, this.arcMat);
    this.arc.renderOrder = 6; this.arc.frustumCulled = false;
    this.geos.push(geo); this.mats.push(this.arcMat);
    this.group.add(this.arc);
    this.curve = new THREE.CatmullRomCurve3(pts);
  }
  // k* en 0..1 · cada pieza aparece y desaparece con suavidad
  update(dt, { a, b, vortex = 0, arc = 0, arcHead = 1, geyser = 0, poolA = 0, poolB = 0 }) {
    this.t += dt;
    for (const m of [this.vMat, this.gMat, this.arcMat]) if (m) m.uniforms.uT.value = this.t;
    this.vortex.position.set(a.x, a.y + 0.02, a.z);
    this.vortex.visible = vortex > 0.01;
    this.vMat.uniforms.uOp.value = 0.85 * vortex;
    this.vortex.scale.set(0.4 + 0.6 * vortex, 0.3 + 0.7 * vortex, 0.4 + 0.6 * vortex);
    this.vortex.rotation.y -= dt * 9;
    this.geyser.position.set(b.x, b.y, b.z);
    this.geyser.visible = geyser > 0.01;
    this.gMat.uniforms.uOp.value = 0.9 * Math.min(1, geyser * 1.5);
    this.geyser.scale.set(0.6 + 0.5 * geyser, 0.2 + 2.6 * geyser, 0.6 + 0.5 * geyser);
    this.geyser.rotation.y += dt * 6;
    this.poolA.position.set(a.x, a.y + 0.04, a.z); this.poolA.material.opacity = poolA; this.poolA.scale.setScalar(0.6 + 0.5 * poolA);
    this.poolB.position.set(b.x, b.y + 0.04, b.z); this.poolB.material.opacity = poolB; this.poolB.scale.setScalar(0.6 + 0.5 * poolB);
    if (this.arc) {
      this.arc.visible = arc > 0.01;
      this.arcMat.uniforms.uOp.value = 0.8 * arc;
      // el arco se "dibuja" desde el origen hasta la cabeza del agua (drawRange del tubo)
      const idx = this.arc.geometry.index.count, n = Math.floor(idx * clamp01(arcHead) / 6) * 6;
      this.arc.geometry.setDrawRange(0, Math.max(6, n));
    }
  }
  pointOnArc(u, out = new THREE.Vector3()) { return this.curve ? this.curve.getPoint(clamp01(u), out) : out; }
  dispose() { for (const g of this.geos) g.dispose(); for (const m of this.mats) m.dispose(); }
}

// charco de agua de bordes suaves (estela del hidroteletransporte): aparece, brilla y se seca poco a poco
let PUDDLE_GEO = null;
export function puddle(vfx, x, y, z, r, life) {
  if (!PUDDLE_GEO) { PUDDLE_GEO = new THREE.CircleGeometry(1, 32); PUDDLE_GEO.rotateX(-Math.PI / 2); }
  const tex = radialTex('puddle', [[0, 'rgba(110,200,255,0.75)'], [0.5, 'rgba(70,170,245,0.55)'], [0.78, 'rgba(210,245,255,0.6)'], [1, 'rgba(120,200,255,0)']]);
  const m = new THREE.Mesh(PUDDLE_GEO, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.userData.own = true;
  m.position.set(x, y + 0.04, z);
  m.renderOrder = 3;
  const ph = Math.random() * TAU;
  return vfx.add(m, life, (it) => {
    const t = it.t, k = t / life;
    m.material.opacity = Math.min(1, t / 0.15) * (k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1) * 0.85;
    m.scale.set(r * (1 + 0.04 * Math.sin(t * 3 + ph)), 1, r * (0.85 + 0.04 * Math.cos(t * 2.6 + ph)));
  });
}

/* ================================================================== */
/*  ZORRA — ESCUDO DE PRIMAVERA                                        */
/*  suelo rosa bajo sus pies · anillo de árboles, arbustos y flores    */
/*  que crecen a su alrededor · cúpula de energía verde-rosa (barrera) */
/* ================================================================== */
let blossomTex = null;
function blossomTexture() {
  if (blossomTex) return blossomTex;
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,170,215,0.95)'); grd.addColorStop(0.7, 'rgba(255,140,200,0.9)'); grd.addColorStop(0.9, 'rgba(255,190,225,0.6)'); grd.addColorStop(1, 'rgba(255,190,225,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  // pétalos y florecillas pintadas
  for (let i = 0; i < 260; i++) {
    const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * S * 0.44, x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
    g.save(); g.translate(x, y); g.rotate(Math.random() * TAU);
    g.fillStyle = ['#ffd6ec', '#ff9fd0', '#ffffff', '#ffb8de'][i % 4];
    g.beginPath(); g.ellipse(0, 0, 6 + Math.random() * 6, 3 + Math.random() * 2, 0, 0, TAU); g.fill();
    if (i % 9 === 0) { g.fillStyle = '#ffe36a'; g.beginPath(); g.arc(0, 0, 3, 0, TAU); g.fill(); }
    g.restore();
  }
  // anillo de energía en el borde (la barrera)
  g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 6;
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.43, 0, TAU); g.stroke();
  blossomTex = new THREE.CanvasTexture(c);
  blossomTex.colorSpace = THREE.SRGBColorSpace;
  return blossomTex;
}
export class SpringWard {
  constructor(radius) {
    this.r = radius;
    this.group = new THREE.Group();
    this.geos = []; this.mats = [];
    const own = (geo, mat) => { this.geos.push(geo); this.mats.push(mat); return new THREE.Mesh(geo, mat); };
    // suelo rosa (anillos concéntricos: se adapta a la forma del terreno con fitGround)
    const fGeo = new THREE.RingGeometry(0.001, radius * 1.15, 64, 8); fGeo.rotateX(-Math.PI / 2);
    this.floor = own(fGeo, new THREE.MeshBasicMaterial({ map: blossomTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.floor.position.y = 0.04; this.floor.renderOrder = 3;
    this.group.add(this.floor);
    // cúpula de la barrera: verde-rosa, solo se ve en el borde (no tapa a la zorra)
    const dGeo = new THREE.SphereGeometry(radius * 1.05, 40, 20, 0, TAU, 0, Math.PI / 2);
    this.domeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 }, uA: { value: 0 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform float uT; uniform float uA; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
        void main(){
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
          // celdas de hoja (hexágonos suaves) que recorren la cúpula hacia arriba
          vec2 q = vec2(vUv.x * 28.0, vUv.y * 9.0 - uT * 0.6);
          vec2 cell = abs(fract(q) - 0.5);
          float vein = smoothstep(0.42, 0.5, max(cell.x, cell.y));
          float wave = 0.5 + 0.5 * sin(vUv.y * 18.0 - uT * 3.0);
          vec3 c = mix(vec3(0.45, 1.0, 0.55), vec3(1.0, 0.55, 0.85), vUv.y + 0.2 * wave);
          float a = (f * 0.9 + vein * 0.18 * (0.4 + wave)) * smoothstep(0.0, 0.1, vUv.y) * uA;
          gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
        }`,
    });
    this.dome = own(dGeo, this.domeMat);
    this.dome.renderOrder = 6;
    this.group.add(this.dome);
    // vegetación: anillo de árboles en flor, arbustos y flores (crecen de dentro afuera)
    const trunkM = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.9 });
    const blossomM = [0xffa8d8, 0xff8cc8, 0xffc8e4].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, flatShading: true, emissive: 0x3a0820, emissiveIntensity: 0.4 }));
    const leafM = [0x4cb84a, 0x6ad050].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, flatShading: true }));
    const petalM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, emissive: 0xff6ab0, emissiveIntensity: 0.25 });
    const coreM = new THREE.MeshStandardMaterial({ color: 0xffe36a, roughness: 0.5 });
    this.mats.push(trunkM, ...blossomM, ...leafM, petalM, coreM);
    const sph = new THREE.IcosahedronGeometry(1, 1), cone = new THREE.ConeGeometry(1, 1, 6), cyl = new THREE.CylinderGeometry(0.06, 0.13, 1, 7);
    cyl.translate(0, 0.5, 0); cone.translate(0, 0.5, 0);
    this.geos.push(sph, cone, cyl);
    this.plants = [];
    const nTrees = 7;
    for (let i = 0; i < nTrees; i++) { // árboles en flor formando la muralla
      const a = (i / nTrees) * TAU + 0.2, g = new THREE.Group(), h = 1.7 + Math.random() * 0.7;
      const trunk = new THREE.Mesh(cyl, trunkM); trunk.scale.set(1, h, 1); g.add(trunk);
      for (let j = 0; j < 4; j++) { const b = new THREE.Mesh(sph, blossomM[(i + j) % 3]); b.scale.setScalar(0.42 + Math.random() * 0.22); b.position.set((Math.random() - 0.5) * 0.6, h + (Math.random() - 0.2) * 0.4, (Math.random() - 0.5) * 0.6); g.add(b); }
      g.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      g.rotation.y = -a + Math.PI / 2; g.rotation.z = -0.12; // se inclinan un poco hacia dentro, como protegiéndola
      this.group.add(g);
      this.plants.push({ g, delay: 0.1 + i * 0.06, kind: 'tree', a });
    }
    for (let i = 0; i < 10; i++) { // arbustos entre los árboles
      const a = ((i + 0.5) / 10) * TAU, m = new THREE.Mesh(sph, leafM[i % 2]);
      const g = new THREE.Group(); g.add(m);
      m.scale.set(0.55, 0.45, 0.55); m.position.y = 0.3;
      g.position.set(Math.cos(a) * radius * 0.92, 0, Math.sin(a) * radius * 0.92);
      this.group.add(g);
      this.plants.push({ g, delay: 0.25 + i * 0.03, kind: 'bush' });
    }
    for (let i = 0; i < 16; i++) { // flores en el suelo rosa
      const a = Math.random() * TAU, r = radius * (0.3 + Math.random() * 0.55), g = new THREE.Group();
      const stem = new THREE.Mesh(cyl, leafM[0]); stem.scale.set(0.25, 0.32, 0.25); g.add(stem);
      for (let k = 0; k < 5; k++) { const p = new THREE.Mesh(sph, petalM); p.scale.set(0.07, 0.025, 0.045); const pa = (k / 5) * TAU; p.position.set(Math.cos(pa) * 0.07, 0.33, Math.sin(pa) * 0.07); p.rotation.y = -pa; g.add(p); }
      const core = new THREE.Mesh(sph, coreM); core.scale.setScalar(0.04); core.position.y = 0.34; g.add(core);
      g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      this.group.add(g);
      this.plants.push({ g, delay: 0.05 + Math.random() * 0.4, kind: 'flower' });
    }
    this.group.traverse((o) => { if (o.isMesh && o !== this.floor && o !== this.dome) o.castShadow = true; });
    this.t = 0;
  }
  // el suelo rosa sigue el terreno (laderas, bordillos): cada vértice se coloca a la altura del suelo real
  fitGround(groundY) {
    const P = this.floor.geometry.attributes.position, o = this.group.position;
    for (let i = 0; i < P.count; i++) P.setY(i, groundY(o.x + P.getX(i), o.z + P.getZ(i)) - o.y + 0.05);
    P.needsUpdate = true;
    this.floor.geometry.computeBoundingSphere();
    this.floor.position.y = 0;
  }
  // grow 0..1 (entrada), fade 1..0 (salida: la vegetación se recoge y la cúpula se desvanece)
  update(dt, { grow = 1, fade = 1, groundY } = {}) {
    this.t += dt;
    const f = clamp01(fade);
    this.floor.scale.setScalar(Math.max(0.001, ease(clamp01(this.t / 0.45)) * (0.6 + 0.4 * f)));
    this.floor.material.opacity = f;
    for (const p of this.plants) {
      const lt = clamp01((this.t - p.delay) / 0.55);
      const pop = lt < 1 ? 1 - Math.pow(1 - lt, 3) * Math.cos(lt * 5) : 1; // brota con un pequeño rebote
      const v = Math.max(0.001, pop * f);
      p.g.scale.set(v, v, v);
      if (p.kind === 'tree') p.g.rotation.z = -0.12 * v + Math.sin(this.t * 1.6 + p.delay * 20) * 0.03; // se mece con la brisa
      if (groundY) p.g.position.y = groundY(p.g.position.x + this.group.position.x, p.g.position.z + this.group.position.z) - this.group.position.y;
    }
    this.domeMat.uniforms.uT.value = this.t;
    this.domeMat.uniforms.uA.value = 0.85 * ease(clamp01((this.t - 0.25) / 0.5)) * f;
    this.dome.scale.setScalar(0.85 + 0.15 * ease(clamp01((this.t - 0.25) / 0.5)) + (1 - f) * 0.1);
    void grow;
  }
  dispose() { for (const g of this.geos) g.dispose(); for (const m of this.mats) m.dispose(); }
}
