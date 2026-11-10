import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { terrainH } from '../terrain.js';

// EFECTOS VISUALES DE LOS PODERES ESPECIALES (segunda capa, junto a skills/vfx.js).
// Solo mallas, sombreadores y ambiente: la lógica de juego vive en skills/powers.js.
// Todo lo que se crea aquí se registra en vfx.add(...) para que el juego lo limpie solo.

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (k) => k * k * (3 - 2 * k);

/* ------------------------------------------------------------------ */
/*  Ruido común para los sombreadores                                  */
/* ------------------------------------------------------------------ */
const NOISE = /* glsl */`
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1,0)), u.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), u.x), u.y); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

function own(m) { m.userData.own = true; m.traverse && m.traverse((o) => { o.userData.own = true; }); return m; }

// Material brillante con borde (fresnel): esferas, cúpulas, rayos de luz
export function glowMat({ color = 0xffffff, rim = 0xffffff, opacity = 0.8, power = 2.2, core = 0.15, additive = true, fadeY = 0, side = THREE.FrontSide } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side, fog: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uRim: { value: new THREE.Color(rim) }, uOp: { value: opacity }, uPow: { value: power }, uCore: { value: core }, uFadeY: { value: fadeY }, uT: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uRim; uniform float uOp; uniform float uPow; uniform float uCore; uniform float uFadeY; uniform float uT;
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPow);
        vec3 c = mix(uColor, uRim, f); float a = (uCore + f) * uOp;
        if (uFadeY > 0.0) a *= smoothstep(0.0, uFadeY, vUv.y) * smoothstep(1.0, 1.0 - uFadeY, vUv.y);
        gl_FragColor = vec4(c, clamp(a, 0.0, 1.0)); }`,
  });
}

/* ------------------------------------------------------------------ */
/*  Texturas pintadas en lienzo (sol, luna, luna de sangre)            */
/* ------------------------------------------------------------------ */
const texCache = {};
function discTex(kind) {
  if (texCache[kind]) return texCache[kind];
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const R = S * 0.46;
  if (kind === 'sun') {
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, R);
    gr.addColorStop(0, '#fffbe8'); gr.addColorStop(0.55, '#ffe27a'); gr.addColorStop(0.92, '#ffb02a'); gr.addColorStop(1, 'rgba(255,140,20,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(S / 2, S / 2, R, 0, TAU); g.fill();
  } else {
    const blood = kind === 'blood';
    const gr = g.createRadialGradient(S * 0.44, S * 0.42, R * 0.1, S / 2, S / 2, R);
    gr.addColorStop(0, blood ? '#ff7a5a' : '#f4f6ff'); gr.addColorStop(0.7, blood ? '#c0201a' : '#c8cce0'); gr.addColorStop(1, blood ? '#5a0606' : '#8a90a8');
    g.fillStyle = gr; g.beginPath(); g.arc(S / 2, S / 2, R, 0, TAU); g.fill();
    // cráteres
    let seed = 7;
    const rr = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 22; i++) {
      const a = rr() * TAU, d = Math.sqrt(rr()) * R * 0.85, cr = R * (0.04 + rr() * 0.13);
      const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
      g.fillStyle = blood ? 'rgba(70,0,0,0.35)' : 'rgba(90,96,120,0.35)';
      g.beginPath(); g.arc(x, y, cr, 0, TAU); g.fill();
      g.fillStyle = blood ? 'rgba(255,150,120,0.18)' : 'rgba(255,255,255,0.25)';
      g.beginPath(); g.arc(x - cr * 0.2, y - cr * 0.2, cr * 0.7, 0, TAU); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache[kind] = t;
  return t;
}
function haloTex() {
  if (texCache.halo) return texCache.halo;
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  texCache.halo = new THREE.CanvasTexture(c);
  return texCache.halo;
}

/* ================================================================== */
export class Vfx2 {
  constructor(game) {
    this.g = game;
    this.vfx = game.vfx;
    this.layers = [];     // capas de ambiente (tinte de pantalla + exposición)
    this.expMul = 1;      // multiplicador de exposición de las capas (lo aplica main.js)
    this.shardGeo = new THREE.OctahedronGeometry(1, 0);
    this.rockGeo = (() => { // roca irregular (bola del Jaglion, piedras)
      const gg = new THREE.IcosahedronGeometry(1, 2), p = gg.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = 0.86 + 0.22 * Math.sin(v.x * 5.1 + v.y * 3.3) * Math.cos(v.z * 4.2 - v.y * 2.1); v.multiplyScalar(n); p.setXYZ(i, v.x, v.y, v.z); }
      gg.computeVertexNormals();
      return gg;
    })();
  }
  get cam() { return this.g.camera; }
  get scene() { return this.g.scene; }

  /* ---------------- AMBIENTE: tinte de pantalla y exposición ---------------- */
  // color CSS, alpha máximo, modo de mezcla CSS, exposición (multiplica), duración, entrada y salida (s)
  ambience({ color = '#000', alpha = 0.5, blend = 'multiply', exposure = 1, dur = 3, fin = 0.8, fout = 0.8 } = {}) {
    const stage = document.getElementById('stage');
    const el = document.createElement('div');
    el.className = 'amb-tint';
    el.style.cssText = `position:absolute;inset:0;pointer-events:none;background:${color};mix-blend-mode:${blend};opacity:0;z-index:2;`;
    if (stage) stage.appendChild(el);
    const L = { el, alpha, exposure, dur, fin, fout, t: 0, k: 0, dead: false };
    L.end = () => { if (!L.dead && L.t < L.dur - L.fout) L.t = Math.max(L.t, L.dur - L.fout); };
    this.layers.push(L);
    return L;
  }
  // La exposición final la calcula main.js en cada fotograma: exposición del escenario × zona de entrega × expMul.
  // (Antes se escribía aquí directamente en el renderizador y el ajuste de la zona de entrega la pisaba.)
  update(dt) {
    let exp = 1;
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const L = this.layers[i];
      L.t += dt;
      const k = L.t < L.fin ? L.t / L.fin : L.t > L.dur - L.fout ? Math.max(0, (L.dur - L.t) / L.fout) : 1;
      L.k = ease(clamp(k, 0, 1));
      L.el.style.opacity = String(L.alpha * L.k);
      exp *= 1 + (L.exposure - 1) * L.k;
      if (L.t >= L.dur) { L.el.remove(); L.dead = true; this.layers.splice(i, 1); }
    }
    this.expMul = exp;
  }
  clear() {
    for (const L of this.layers) L.el.remove();
    this.layers.length = 0;
    this.expMul = 1;
  }

  /* ---------------- CIELO: astro que mira a la cámara ---------------- */
  // Se coloca detrás del héroe (visto desde la cámara), alto en el cielo. kind: sun | moon | blood
  skyBody(kind, { size = 9, dist = 46, life = 4, glow = 0xffc860, side = 0 } = {}) {
    const g = new THREE.Group();
    // siempre visible (va en la franja alta del encuadre, lejos del héroe): no lo tapan árboles ni edificios
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: discTex(kind), transparent: true, depthWrite: false, depthTest: false, fog: false, opacity: 0 }));
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(size * 3.2, size * 3.2), new THREE.MeshBasicMaterial({ map: haloTex(), color: glow, transparent: true, depthWrite: false, depthTest: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    disc.renderOrder = 8; halo.renderOrder = 7;
    halo.position.z = -0.05;
    g.add(halo, disc);
    own(g);
    const h = { group: g, disc, halo, k: 0, rise: 0, extra: [] };
    const cam = this.cam, fwd = new THREE.Vector3(), cu = new THREE.Vector3(), cr = new THREE.Vector3();
    // siempre en la parte alta del encuadre (side: -1 izquierda … 1 derecha), sale desde abajo al aparecer
    const place = () => {
      cam.getWorldDirection(fwd);
      cu.set(0, 1, 0).applyQuaternion(cam.quaternion);
      cr.set(1, 0, 0).applyQuaternion(cam.quaternion);
      const th = Math.tan((cam.fov * Math.PI) / 360);
      fwd.addScaledVector(cu, th * (0.1 + 0.6 * h.rise)).addScaledVector(cr, th * cam.aspect * 0.55 * side).normalize();
      g.position.copy(cam.position).addScaledVector(fwd, dist);
      g.quaternion.copy(cam.quaternion);
    };
    h.it = this.vfx.add(g, life, (it) => {
      const k = it.t / life;
      h.k = k < 0.15 ? k / 0.15 : k > 0.85 ? (1 - k) / 0.15 : 1;
      h.rise = ease(clamp(k / 0.25, 0, 1));
      place();
      disc.material.opacity = h.k;
      halo.material.opacity = 0.55 * h.k * (h.haloMul ?? 1);
      if (h.onUpdate) h.onUpdate(it.t, k, h.k);
    });
    place();
    h.kill = () => this.vfx.kill(h.it);
    return h;
  }
  // Sombra que cubre el sol (eclipse solar): devuelve la malla para moverla
  shadowDisc(body, size) {
    const m = own(new THREE.Mesh(new THREE.CircleGeometry(size * 0.5, 48), new THREE.MeshBasicMaterial({ color: 0x05030a, transparent: true, depthWrite: false, depthTest: false, fog: false, opacity: 0 })));
    m.position.z = 0.05;
    m.renderOrder = 9;
    body.group.add(m);
    return m;
  }
  coronaRing(body, size, color = 0xffd890) {
    const m = own(new THREE.Mesh(new THREE.RingGeometry(size * 0.5, size * 0.95, 64), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, depthTest: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0, side: THREE.DoubleSide })));
    m.position.z = 0.08;
    m.renderOrder = 10;
    body.group.add(m);
    return m;
  }

  /* ---------------- AURORA POLAR: cortinas de luz que ondulan ---------------- */
  aurora(center, { life = 6, y0 = 6, y1 = 30 } = {}) {
    const g = new THREE.Group();
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uT: { value: 0 }, uA: { value: 0 } },
      vertexShader: `uniform float uT; varying vec2 vUv; varying float vW;
        void main(){ vUv = uv; vec3 p = position;
          float w = sin(uv.x * 18.0 + uT * 0.9) * 1.6 + sin(uv.x * 41.0 - uT * 1.7) * 0.6;
          p.x += normal.x * w * (0.3 + uv.y); p.z += normal.z * w * (0.3 + uv.y);
          p.y += sin(uv.x * 9.0 + uT * 0.6) * 1.5 * uv.y; vW = w;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: NOISE + `uniform float uT; uniform float uA; varying vec2 vUv; varying float vW;
        void main(){
          // rayos verticales finos y contrastados que se mueven despacio
          float r1 = fbm(vec2(vUv.x * 90.0 + uT * 0.35, uT * 0.12));
          float r2 = fbm(vec2(vUv.x * 37.0 - uT * 0.2, 3.0 + uT * 0.07));
          float rays = pow(clamp(r1 * 0.65 + r2 * 0.55, 0.0, 1.0), 3.0) * 2.2;
          // borde inferior nítido y brillante; se desvanece hacia arriba
          float y = vUv.y;
          float vert = smoothstep(0.0, 0.05, y) * (0.35 + 0.65 * exp(-y * 4.0)) * (1.0 - smoothstep(0.75, 1.0, y));
          vec3 green = vec3(0.2, 1.0, 0.5), teal = vec3(0.1, 0.9, 0.95), blue = vec3(0.3, 0.45, 1.0), violet = vec3(0.8, 0.3, 1.0);
          float s = fract(vUv.x * 1.5 + uT * 0.02);
          vec3 c = mix(green, teal, smoothstep(0.05, 0.35, y));
          c = mix(c, mix(blue, violet, s), smoothstep(0.35, 0.8, y));
          float edge = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
          float a = clamp(rays * vert * edge, 0.0, 1.0) * uA;
          gl_FragColor = vec4(c * (1.4 + 0.3 * vW), a * 0.85); }`,
    });
    // cortinas en arco alrededor de la cámara, a lo lejos y en lo alto: se ven como una banda de luz en el cielo
    const curtains = [[-1.35, -0.25, 30, 0], [-0.7, 0.55, 36, 2], [0.2, 1.35, 32, 1], [-0.25, 0.85, 42, 4]];
    curtains.forEach(([a0, a1, R, yo]) => {
      const segs = 120, pos = [], nor = [], uv = [], idx = [];
      for (let s = 0; s <= segs; s++) {
        const u = s / segs, a = a0 + (a1 - a0) * u;
        const x = Math.sin(a) * R, z = -Math.cos(a) * R;
        pos.push(x, y0 + yo, z, x, y1 + yo * 1.5, z);
        nor.push(Math.sin(a), 0, -Math.cos(a), Math.sin(a), 0, -Math.cos(a));
        uv.push(u, 0, u, 1);
        if (s < segs) { const b = s * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      g.add(m);
    });
    own(g);
    const cam = this.cam, f = new THREE.Vector3();
    const follow = () => {
      cam.getWorldDirection(f);
      // la base de las cortinas queda un poco por encima del centro del encuadre, mire donde mire la cámara
      const e = Math.asin(clamp(f.y, -1, 1)), want = e + ((cam.fov * Math.PI) / 360) * 0.4;
      g.position.set(cam.position.x, cam.position.y + Math.tan(want) * 34 - y0, cam.position.z);
      g.rotation.y = Math.atan2(-f.x, -f.z) + yaw;
    };
    let yaw = 0;
    follow();
    const h = { group: g, mat };
    h.it = this.vfx.add(g, life, (it) => {
      const k = it.t / life;
      mat.uniforms.uT.value = it.t;
      mat.uniforms.uA.value = k < 0.2 ? k / 0.2 : k > 0.8 ? (1 - k) / 0.2 : 1;
      yaw = Math.sin(it.t * 0.15) * 0.08; // deriva lenta
      follow();
    });
    h.kill = () => this.vfx.kill(h.it);
    return h;
  }

  /* ---------------- CADENA ELÁSTICA: lengua del Komodo y cola del Jaglion ---------------- */
  // Tubo deformable que pasa por una lista de puntos (se reescribe cada fotograma)
  tube({ n = 28, radial = 10, r0 = 0.1, r1 = 0.06, color = 0xff6a8a, rough = 0.35, emissive = 0x000000, tipR = 0 } = {}) {
    const verts = n * radial;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    const idx = [];
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = a + radial, d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
    geo.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05, emissive, emissiveIntensity: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    const grp = new THREE.Group();
    grp.add(mesh);
    let tip = null;
    if (tipR > 0) { tip = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat); grp.add(tip); }
    own(grp);
    const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3();
    const h = { group: grp, mesh, mat, n, visible: true, radius: (u) => r0 + (r1 - r0) * u };
    h.set = (pts) => { // pts: n vectores
      N.set(0, 0, 0);
      for (let i = 0; i < n; i++) {
        const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        T.subVectors(b, a); if (T.lengthSq() < 1e-8) T.set(0, 0, 1); T.normalize();
        if (i === 0 || N.lengthSq() < 0.5) { N.crossVectors(T, Math.abs(T.y) > 0.9 ? tmp.set(1, 0, 0) : UP).normalize(); }
        else { N.sub(tmp.copy(T).multiplyScalar(N.dot(T))).normalize(); } // transporte paralelo
        B.crossVectors(T, N);
        const r = h.radius(i / (n - 1));
        for (let j = 0; j < radial; j++) {
          const ang = (j / radial) * TAU, c = Math.cos(ang), s = Math.sin(ang);
          const k = (i * radial + j) * 3;
          const nx = N.x * c + B.x * s, ny = N.y * c + B.y * s, nz = N.z * c + B.z * s;
          pos[k] = p.x + nx * r; pos[k + 1] = p.y + ny * r; pos[k + 2] = p.z + nz * r;
          nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.normal.needsUpdate = true;
      if (tip) { tip.position.copy(pts[n - 1]); tip.scale.setScalar(tipR); }
    };
    h.show = (v) => { grp.visible = v; h.visible = v; };
    h.it = this.vfx.add(grp, 0);
    h.kill = () => { this.vfx.kill(h.it); geo.dispose(); };
    return h;
  }

  /* ---------------- VOLCÁNICO: grietas, géiseres y lava negra ---------------- */
  crack(x, z, len, ang, { life = 1.6, width = 0.22, color = 0xff6a1a } = {}) {
    const m = own(new THREE.Mesh(this.vfx.planeGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4 })));
    m.position.set(x + Math.sin(ang) * len * 0.5, terrainH(x + Math.sin(ang) * len * 0.5, z + Math.cos(ang) * len * 0.5) + 0.06, z + Math.cos(ang) * len * 0.5);
    m.rotation.y = ang + Math.PI / 2;
    m.scale.set(len, 1, width);
    m.renderOrder = 4;
    return this.vfx.add(m, life, (it) => {
      const k = it.t / life;
      m.scale.x = len * ease(clamp(k * 3, 0, 1));
      m.material.opacity = (k < 0.7 ? 0.95 : (1 - k) / 0.3) * (0.75 + 0.25 * Math.sin(it.t * 30));
    });
  }
  // Columna de energía volcánica: devuelve un manejador con setHeight(k)
  geyser(x, z, { r = 1.0, h = 7, life = 1.6 } = {}) {
    const y = terrainH(x, z);
    const g = new THREE.Group();
    // magma opaco con vetas brillantes (sin mezcla aditiva: sobre suelos claros quemaría la imagen a blanco)
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { uT: { value: 0 }, uA: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: NOISE + `uniform float uT; uniform float uA; varying vec2 vUv;
        void main(){ float n = fbm(vec2(vUv.x * 8.0, vUv.y * 3.0 - uT * 4.0));
          float vein = smoothstep(0.55, 0.8, n);
          vec3 dark = vec3(0.35, 0.05, 0.02), hot = vec3(1.0, 0.42, 0.06), white = vec3(1.0, 0.85, 0.45);
          vec3 c = mix(dark, hot, smoothstep(0.25, 0.6, n));
          c = mix(c, white, vein * 0.7);
          float a = smoothstep(1.0, 0.6, vUv.y) * (0.7 + 0.3 * n) * uA;
          gl_FragColor = vec4(c, a); }`,
    });
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r, 1, 18, 1, true), mat);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.25, r * 0.45, 1, 12, 1, true), mat);
    outer.position.y = core.position.y = 0.5;
    const pivot = new THREE.Group();
    pivot.add(outer, core);
    g.add(pivot);
    own(g);
    g.position.set(x, y, z);
    const hd = { group: g, y, x, z, height: 0 };
    hd.setHeight = (k) => { hd.height = h * k; pivot.scale.set(1 + 0.15 * Math.sin(k * 20), Math.max(0.01, h * k), 1 + 0.15 * Math.sin(k * 20)); };
    hd.setHeight(0.01);
    hd.it = this.vfx.add(g, life, (it) => {
      mat.uniforms.uT.value = it.t;
      outer.rotation.y += 0.06; core.rotation.y -= 0.09;
      const k = it.t / life;
      mat.uniforms.uA.value = k > 0.7 ? (1 - k) / 0.3 : 1;
    });
    hd.kill = () => this.vfx.kill(hd.it);
    return hd;
  }
  // Río de lava negra que crece por el suelo (geometría que sigue el terreno). progress 0..1
  lavaFlow(a, dir, { len = 12, width = 3.2, life = 6, hf = terrainH } = {}) { // hf: altura del suelo (sube por bordillos y plataformas bajas)
    const segL = 40, segW = 6, pos = [], uv = [], idx = [];
    const sx = -dir.z, sz = dir.x;
    for (let i = 0; i <= segL; i++) for (let j = 0; j <= segW; j++) {
      const u = i / segL, v = j / segW;
      const wv = width * (0.75 + 0.25 * Math.sin(u * 9.0)) * (u > 0.85 ? 1 - (u - 0.85) / 0.15 * 0.6 : 1);
      const x = a.x + dir.x * u * len + sx * (v - 0.5) * wv, z = a.z + dir.z * u * len + sz * (v - 0.5) * wv;
      pos.push(x, hf(x, z) + 0.08 + Math.sin(v * Math.PI) * 0.12, z);
      uv.push(u, v);
      if (i < segL && j < segW) { const b = i * (segW + 1) + j; idx.push(b, b + segW + 1, b + 1, b + 1, b + segW + 1, b + segW + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 }, uP: { value: 0 }, uA: { value: 1 }, uL: { value: len } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: NOISE + `uniform float uT; uniform float uP; uniform float uA; uniform float uL; varying vec2 vUv;
        void main(){
          if (vUv.x > uP) discard;
          vec2 q = vec2(vUv.x * uL * 0.7 - uT * 0.35, vUv.y * 3.0);
          float n = fbm(q * 1.4);
          float vein = 1.0 - smoothstep(0.02, 0.09, abs(fbm(q * 2.2 + 3.1) - 0.5));
          vec3 rock = mix(vec3(0.02, 0.015, 0.02), vec3(0.12, 0.09, 0.08), n);
          vec3 hot = mix(vec3(1.0, 0.3, 0.02), vec3(1.0, 0.75, 0.25), n);
          float front = smoothstep(uP - 0.08, uP, vUv.x);
          float edge = 1.0 - smoothstep(0.0, 0.22, min(vUv.y, 1.0 - vUv.y));
          float glow = clamp(vein * (0.6 + 0.4 * sin(uT * 6.0 + vUv.x * 30.0)) + front * 0.9 + edge * 0.55, 0.0, 1.0);
          vec3 c = mix(rock, hot * 1.6, glow);
          float a = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y) * uA;
          gl_FragColor = vec4(c, a); }`,
    });
    const m = own(new THREE.Mesh(geo, mat));
    m.renderOrder = 3;
    m.frustumCulled = false;
    const h = { mesh: m, mat, progress: 0 };
    h.setProgress = (k) => { h.progress = k; mat.uniforms.uP.value = k; };
    h.it = this.vfx.add(m, life, (it) => {
      mat.uniforms.uT.value = it.t;
      const k = it.t / life;
      mat.uniforms.uA.value = k > 0.8 ? (1 - k) / 0.2 : 1;
    });
    h.kill = () => this.vfx.kill(h.it);
    return h;
  }

  /* ---------------- CÚPULAS Y ESFERAS DE ENERGÍA ---------------- */
  shell(pos, { r = 3, color = 0xffffff, rim = 0xffffff, opacity = 0.7, power = 2, core = 0.1, additive = true, life = 2, seg = 32 } = {}) {
    const mat = glowMat({ color, rim, opacity, power, core, additive });
    const m = own(new THREE.Mesh(new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)), mat));
    m.position.copy(pos);
    m.scale.setScalar(r);
    m.renderOrder = 5;
    const h = { mesh: m, mat };
    h.it = this.vfx.add(m, life, (it) => { mat.uniforms.uT.value = it.t; if (h.onUpdate) h.onUpdate(it.t, it.t / (life || 1)); });
    h.kill = () => this.vfx.kill(h.it);
    return h;
  }
  // Rayo de luz vertical o inclinado (cilindro que se desvanece por los extremos)
  beam(from, to, { r = 0.4, color = 0xffd060, opacity = 0.7, life = 1 } = {}) {
    const d = new THREE.Vector3().subVectors(to, from), len = d.length();
    const mat = glowMat({ color, rim: 0xffffff, opacity, power: 1.2, core: 0.35, fadeY: 0.25, side: THREE.DoubleSide });
    const m = own(new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.6, 1, 14, 1, true), mat));
    m.position.copy(from).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    m.scale.set(1, len, 1);
    return this.vfx.add(m, life, (it) => { const k = it.t / life; mat.uniforms.uOp.value = opacity * (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8); });
  }

  /* ---------------- OLA (tsunami): lámina con perfil que se riza ---------------- */
  wave(origin, dir, { width = 12, life = 4 } = {}) {
    const W = 36, P = 26;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array((W + 1) * (P + 1) * 3), col = new Float32Array((W + 1) * (P + 1) * 4);
    const idx = [];
    for (let i = 0; i < W; i++) for (let j = 0; j < P; j++) { const a = i * (P + 1) + j, b = a + P + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4)); // con transparencia: la espalda de la ola se funde con el suelo
    const deep = new THREE.Color(0x0a3a7a), mid = new THREE.Color(0x1f9ad0), foam = new THREE.Color(0xeefaff), c = new THREE.Color();
    for (let i = 0; i <= W; i++) for (let j = 0; j <= P; j++) {
      const v = j / P, k = (i * (P + 1) + j) * 4, u = Math.abs(i / W - 0.5) * 2;
      c.copy(deep).lerp(mid, clamp(v * 1.5, 0, 1)).lerp(foam, clamp((v - 0.6) / 0.25, 0, 1));
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      col[k + 3] = clamp(v / 0.3, 0, 1) * clamp((1 - u) / 0.15, 0, 1); // bordes y espalda transparentes
    }
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, transparent: true, opacity: 0.86, side: THREE.DoubleSide, shininess: 30, specular: 0x2a4a60, depthWrite: true });
    const m = own(new THREE.Mesh(geo, mat));
    m.frustumCulled = false;
    m.castShadow = false;
    const sx = -dir.z, sz = dir.x;
    const h = { mesh: m, mat, front: origin.clone() };
    // height: altura de la cresta; curl: rizo (0..1); dist: avance desde el origen
    h.shape = (height, curl, dist) => {
      const fx = origin.x + dir.x * dist, fz = origin.z + dir.z * dist;
      h.front.set(fx, 0, fz);
      for (let i = 0; i <= W; i++) {
        const u = i / W - 0.5, wx = fx + sx * u * width, wz = fz + sz * u * width;
        const hh = height * (1 - Math.pow(Math.abs(u) * 2, 3) * 0.55) * (0.92 + 0.08 * Math.sin(u * 13 + dist));
        const gy = terrainH(wx, wz);
        for (let j = 0; j <= P; j++) {
          const v = j / P;
          // perfil: espalda larga e inclinada que sube hasta la cresta y se riza hacia delante
          // perfil: espalda corta que sube empinada hasta la cresta, que se riza hacia delante
          let back = -(1 - v) * hh * 0.85, up = Math.pow(Math.sin(v * Math.PI * 0.5), 1.6) * hh;
          if (v > 0.68) { const q = (v - 0.68) / 0.32, a = q * Math.PI * 1.25 * curl; back += Math.sin(a) * hh * 0.5; up = hh * (0.93 + 0.07 * (1 - q)) - (1 - Math.cos(a)) * hh * 0.42; }
          const k = (i * (P + 1) + j) * 3;
          pos[k] = wx + dir.x * back; pos[k + 1] = gy + up + 0.02; pos[k + 2] = wz + dir.z * back;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
    };
    h.shape(0.01, 0, 0);
    h.it = this.vfx.add(m, life, () => {});
    h.kill = () => { this.vfx.kill(h.it); geo.dispose(); };
    return h;
  }

  /* ---------------- REMOLINO (maelstrom): embudo en espiral con núcleo oscuro ---------------- */
  whirlpool(x, z, { r = 7, life = 5, y = terrainH(x, z) } = {}) {
    y += 0.08;
    const g = new THREE.Group();
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { uT: { value: 0 }, uA: { value: 0 } },
      vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: NOISE + `uniform float uT; uniform float uA; varying vec2 vP;
        void main(){ float r = length(vP), a = atan(vP.y, vP.x);
          float sp = sin(a * 5.0 + log(r + 0.2) * 9.0 - uT * 7.0);
          float n = fbm(vec2(a * 3.0 + uT, r * 2.0 - uT * 2.0));
          vec3 deep = vec3(0.0, 0.03, 0.08), water = vec3(0.05, 0.4, 0.7), foam = vec3(0.85, 0.97, 1.0);
          vec3 c = mix(deep, water, smoothstep(0.6, ${(r * 0.8).toFixed(2)}, r));
          c = mix(c, foam, smoothstep(0.55, 1.0, sp * 0.5 + 0.5) * smoothstep(0.5, 2.5, r) * (0.5 + n));
          float core = 1.0 - smoothstep(0.2, 1.4, r);
          c = mix(c, vec3(0.0), core);
          float a2 = smoothstep(${r.toFixed(2)}, ${(r * 0.75).toFixed(2)}, r) * uA;
          gl_FragColor = vec4(c, a2 * 0.92); }`,
    });
    // embudo: disco hundido hacia el centro (cono invertido, visto desde arriba)
    const segR = 24, segA = 64, pos = [], idx = [];
    for (let i = 0; i <= segR; i++) for (let j = 0; j <= segA; j++) {
      const rr = (i / segR) * r, aa = (j / segA) * TAU;
      pos.push(Math.cos(aa) * rr, 0.02 + 0.03 * (i / segR), Math.sin(aa) * rr); // a ras de suelo: la profundidad la da el sombreado
      if (i < segR && j < segA) { const b = i * (segA + 1) + j; idx.push(b, b + segA + 1, b + 1, b + 1, b + segA + 1, b + segA + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const funnel = new THREE.Mesh(geo, mat);
    funnel.renderOrder = 3;
    g.add(funnel);
    // paredes de agua en espiral que suben girando alrededor del núcleo
    const wallMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { uT: mat.uniforms.uT, uA: mat.uniforms.uA },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: NOISE + `uniform float uT; uniform float uA; varying vec2 vUv;
        void main(){ float sp = sin(vUv.x * 6.2832 * 4.0 + vUv.y * 7.0 - uT * 9.0);
          float n = fbm(vec2(vUv.x * 12.0 - uT * 2.0, vUv.y * 4.0));
          vec3 c = mix(vec3(0.03, 0.3, 0.55), vec3(0.85, 0.97, 1.0), smoothstep(0.4, 1.0, sp * 0.5 + 0.5) * (0.6 + 0.6 * n));
          float a = pow(1.0 - vUv.y, 1.3) * (0.35 + 0.35 * smoothstep(0.0, 1.0, sp * 0.5 + 0.5)) * uA;
          gl_FragColor = vec4(c, a); }`,
    });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, 1.1, 2.6, 64, 8, true), wallMat);
    wall.position.y = 1.3;
    wall.renderOrder = 4;
    g.add(wall);
    const wall2 = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, 0.7, 3.6, 48, 8, true), wallMat);
    wall2.position.y = 1.8;
    wall2.renderOrder = 4;
    g.add(wall2);
    // núcleo: agujero negro con borde de luz azul
    const coreMat = glowMat({ color: 0x000000, rim: 0x3ab0ff, opacity: 1, power: 3, core: 0.9, additive: false });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 18), coreMat);
    core.position.y = 0.2;
    g.add(core);
    own(g);
    g.position.set(x, y, z);
    const h = { group: g, mat, core, x, z, y };
    h.it = this.vfx.add(g, life, (it) => {
      const k = it.t / life;
      mat.uniforms.uT.value = it.t;
      const a = k < 0.15 ? k / 0.15 : k > 0.85 ? (1 - k) / 0.15 : 1;
      mat.uniforms.uA.value = a;
      g.scale.set(0.3 + 0.7 * ease(Math.min(1, k / 0.15)) * (k > 0.85 ? a : 1) + 0.0001, 1, 0.3 + 0.7 * ease(Math.min(1, k / 0.15)) * (k > 0.85 ? a : 1) + 0.0001);
      core.scale.setScalar(0.6 + 0.4 * a + 0.08 * Math.sin(it.t * 12));
      g.rotation.y -= 0.05;
      wall2.rotation.y -= 0.04;
    });
    h.kill = () => this.vfx.kill(h.it);
    return h;
  }

  /* ---------------- FRAGMENTOS (obsidiana, roca): malla instanciada ---------------- */
  shards(n, { obsidian = true, life = 4 } = {}) {
    const mat = obsidian
      ? new THREE.MeshStandardMaterial({ color: 0x07060c, roughness: 0.06, metalness: 0.55, emissive: 0x1a0a2e, emissiveIntensity: 0.35, envMapIntensity: 2.4, flatShading: true })
      : new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 0.9, flatShading: true });
    const m = own(new THREE.InstancedMesh(this.shardGeo, mat, n));
    m.castShadow = true;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const h = { mesh: m, n, dummy: new THREE.Object3D() };
    h.setAt = (i, p, rot, s) => { const d = h.dummy; d.position.copy(p); d.rotation.copy(rot); d.scale.copy(s); d.updateMatrix(); m.setMatrixAt(i, d.matrix); };
    h.commit = () => { m.instanceMatrix.needsUpdate = true; };
    h.it = this.vfx.add(m, life, () => {});
    h.kill = () => this.vfx.kill(h.it);
    return h;
  }
  rockBall(r) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8c7a62, roughness: 0.95, flatShading: true, emissive: 0x2a1a0a, emissiveIntensity: 0.15 });
    const m = own(new THREE.Mesh(this.rockGeo, mat));
    m.scale.setScalar(r);
    m.castShadow = true;
    const h = { mesh: m };
    h.it = this.vfx.add(m, 0);
    h.kill = () => this.vfx.kill(h.it);
    return h;
  }

  /* ---------------- ESPEJISMO: copia del héroe que brilla con el calor ---------------- */
  mirage(model, pos, facing, { life = 6 } = {}) {
    const src = model.body || model.root;
    const copy = SkeletonUtils.clone(src); // copia la pose actual del esqueleto
    const mats = [];
    copy.traverse((o) => {
      if (o.isLight) { o.visible = false; return; }
      if (!o.isMesh) return;
      o.castShadow = false;
      o.userData.own = true;
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      const nm = arr.map((m0) => {
        const m = m0.clone();
        m.transparent = true; m.opacity = 0.55; m.depthWrite = false;
        if (m.emissive) { m.emissive = new THREE.Color(0xffb050); m.emissiveIntensity = 0.45; }
        mats.push(m);
        return m;
      });
      o.material = Array.isArray(o.material) ? nm : nm[0];
    });
    const g = new THREE.Group();
    g.add(copy);
    g.position.copy(pos);
    g.rotation.y = facing;
    const h = { group: g, pos: g.position, alive: true, k: 1 };
    h.it = this.vfx.add(g, life, (it) => {
      // distorsión de calor: la figura tiembla, se estira y parpadea
      const t = it.t;
      copy.scale.set(1 + 0.04 * Math.sin(t * 23), 1 + 0.06 * Math.sin(t * 17 + 1), 1 + 0.04 * Math.cos(t * 21));
      copy.position.x = 0.05 * Math.sin(t * 31);
      const k = t / life, fade = k < 0.08 ? k / 0.08 : k > 0.85 ? (1 - k) / 0.15 : 1;
      for (const m of mats) m.opacity = (0.62 + 0.25 * Math.sin(t * 11) * Math.sin(t * 7.3)) * fade * h.k;
    });
    h.kill = () => { h.alive = false; this.vfx.kill(h.it); for (const m of mats) m.dispose(); };
    return h;
  }
}
