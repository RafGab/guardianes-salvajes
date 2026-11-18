import * as THREE from 'three';
import { Audio3D as audio } from '../audio.js';

// EFECTOS MÁGICOS REUTILIZABLES
//  · LeafStorm   — remolino de cientos de hojas otoñales (una sola malla instanciada: una llamada de dibujo)
//  · iceShatter  — un enemigo congelado se rompe en fragmentos de cristal que acaban en destellos
//  · cometDisc   — disco de energía que va pegado bajo cada pie de Kairo
// Todo comparte geometrías y materiales de módulo (se crean una vez): lanzar el efecto muchas veces no
// crea programas de sombreado nuevos ni provoca tirones.

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------ */
/*  HOJAS OTOÑALES                                                     */
/* ------------------------------------------------------------------ */
// naranja, dorado, amarillo, rojo y marrón
export const LEAF_COLORS = [0xe8701c, 0xf0a81e, 0xf6d23c, 0xc8341c, 0x8a4a22, 0xdc8a26, 0xb02a18];
let LEAF_GEO = null, STREAK_TEX = null;
function leafGeo() {
  if (LEAF_GEO) return LEAF_GEO;
  // hoja con punta, nervio central y un poco de curvatura (no es un plano liso)
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.bezierCurveTo(0.34, -0.32, 0.4, 0.12, 0, 0.5);
  s.bezierCurveTo(-0.4, 0.12, -0.34, -0.32, 0, -0.5);
  const g = new THREE.ShapeGeometry(s, 5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, x * x * 0.6); } // ligeramente curvada
  g.computeVertexNormals();
  LEAF_GEO = g;
  return g;
}
function streakTex() {
  if (STREAK_TEX) return STREAK_TEX;
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 64);
  for (let i = 0; i < 22; i++) { // rachas de viento: trazos finos y difuminados
    const y = Math.random() * 64, w = 40 + Math.random() * 150, x0 = Math.random() * 256, a = 0.25 + Math.random() * 0.6;
    const gr = x.createLinearGradient(x0, 0, x0 + w, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(x0, y, w, 1 + Math.random() * 2.5);
    x.fillRect(x0 - 256, y, w, 2);
  }
  STREAK_TEX = new THREE.CanvasTexture(c);
  STREAK_TEX.wrapS = STREAK_TEX.wrapT = THREE.RepeatWrapping;
  return STREAK_TEX;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export class LeafStorm {
  constructor(parent, { n = 320, spare = 160, height = 3.2 } = {}) {
    this.n = n; this.N = n + spare; this.H = height;
    this.mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.75, metalness: 0, emissive: 0x4a2000, emissiveIntensity: 0.45 });
    this.mat.userData.own = true;
    this.mesh = new THREE.InstancedMesh(leafGeo(), this.mat, this.N);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.Color();
    this.L = [];
    for (let i = 0; i < this.N; i++) {
      col.setHex(LEAF_COLORS[i % LEAF_COLORS.length]).multiplyScalar(rnd(0.85, 1.15));
      this.mesh.setColorAt(i, col);
      const h = Math.pow(Math.random(), 0.8);
      this.L.push({
        storm: i < n, free: false, h, r: rnd(0.15, 1), a: rnd(0, TAU), w: rnd(5, 9), ph: rnd(0, TAU),
        sz: Math.random() < 0.15 ? rnd(0.18, 0.26) : rnd(0.06, 0.16), sx: rnd(2, 7), sy: rnd(1, 4), x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 0, s: 0,
        br: rnd(0.08, 0.3), bw: rnd(0.6, 2.2), bob: rnd(0.08, 0.35), bobW: rnd(1.5, 4.5), stray: Math.random() < 0.18 ? rnd(1.25, 1.7) : 1, dir: Math.random() < 0.08 ? -1 : 1,
      });
    }
    this.mesh.instanceColor.needsUpdate = true;
    // NÚCLEO DE VIENTO MÁGICO: dos embudos translúcidos de rachas doradas que giran en sentidos opuestos
    const tex = streakTex();
    this.coreMats = [0xffd27a, 0xffa03a].map((c, i) => {
      const m = new THREE.MeshBasicMaterial({ color: c, map: tex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      m.userData.own = true;
      if (i) { m.map = tex.clone(); m.map.needsUpdate = true; m.map.repeat.set(2, 1); m.userData.ownMap = true; }
      return m;
    });
    this.coreGeo = new THREE.CylinderGeometry(1, 0.28, 1, 24, 1, true); this.coreGeo.translate(0, 0.5, 0);
    this.cores = this.coreMats.map((m) => { const c = new THREE.Mesh(this.coreGeo, m); c.frustumCulled = false; c.renderOrder = 6; return c; });
    this.root = new THREE.Group();
    this.root.add(this.mesh, ...this.cores);
    if (parent) parent.add(this.root);
    this.k = 0; this.t = 0; this.released = false;
    this.c = new THREE.Vector3();
  }
  // r = radio exterior del remolino (m) · k = intensidad (0 nada … 1 completo) · c = centro en el suelo
  update(dt, c, { r = 2, k = 1, h = this.H } = {}) {
    this.t += dt;
    if (c) this.c.copy(c);
    this.k += (k - this.k) * (1 - Math.exp(-6 * dt));
    const t = this.t, C = this.c, K = this.k, M = this.mesh;
    for (let i = 0; i < this.N; i++) {
      const L = this.L[i];
      let x, y, z, s;
      if (L.free) { // hoja suelta: sale despedida, revolotea, cae despacio y se desvanece
        L.t += dt;
        const f = Math.exp(-1.8 * dt);
        L.vx *= f; L.vz *= f; L.vy = L.vy * f - 2.6 * dt; if (L.vy < -1.4) L.vy = -1.4;
        L.x += (L.vx + Math.sin(t * 3 + L.ph) * 0.6) * dt; L.y += L.vy * dt; L.z += (L.vz + Math.cos(t * 2.6 + L.ph) * 0.6) * dt;
        x = L.x; y = L.y; z = L.z;
        s = L.sz * (1 - smooth(L.life * 0.55, L.life, L.t));
        if (L.t >= L.life) { L.free = false; s = 0; }
        _e.set(L.ph + t * L.sx, t * L.sy, Math.sin(t * 6 + L.ph) * 1.2);
      } else if (L.storm && !this.released) { // en el remolino: gira alrededor del núcleo, más ancho arriba
        L.a += dt * L.w * (1.25 - 0.45 * L.r) * L.dir;
        // cada hoja con su propia órbita: respira hacia dentro y fuera, sube y baja, y algunas van sueltas por fuera
        const hh = L.h * h, rr = (0.25 + L.r * (0.35 + 0.65 * L.h)) * r * L.stray * (1 + L.br * Math.sin(t * L.bw + L.ph));
        x = C.x + Math.cos(L.a) * rr; z = C.z + Math.sin(L.a) * rr;
        y = C.y + 0.1 + hh + Math.sin(t * L.bobW + L.ph) * L.bob;
        s = L.sz * K * (0.8 + 0.4 * L.h);
        _e.set(L.ph + Math.sin(t * L.sx * 0.5 + L.ph) * 1.2, -L.a + Math.PI / 2, 0.9 + Math.sin(t * 5 + L.ph) * 0.5); // de canto en el viento, aleteando
      } else { s = 0; x = C.x; y = C.y; z = C.z; }
      _q.setFromEuler(_e); _p.set(x, y, z); _s.setScalar(Math.max(0.0001, s));
      _m.compose(_p, _q, _s);
      M.setMatrixAt(i, _m);
    }
    M.instanceMatrix.needsUpdate = true;
    const ck = this.released ? Math.max(0, K) : K;
    this.cores.forEach((cm, j) => {
      cm.position.set(C.x, C.y + 0.05, C.z);
      cm.scale.set(r * (j ? 0.62 : 0.85), h * (j ? 0.9 : 1.05), r * (j ? 0.62 : 0.85));
      cm.rotation.y += dt * (j ? -11 : 8);
      cm.material.opacity = (j ? 0.14 : 0.2) * ck;
      cm.material.map.offset.x -= dt * (j ? 1.1 : 0.7);
    });
  }
  // EXPLOSIÓN CIRCULAR de hojas en un punto (impacto contra un enemigo): usa las hojas de reserva
  burst(x, y, z, n = 30, power = 1) {
    let got = 0;
    for (let i = this.n; i < this.N && got < n; i++) {
      const L = this.L[i];
      if (L.free) continue;
      const a = rnd(0, TAU), v = rnd(3, 7.5) * power, up = rnd(0.5, 3.5);
      Object.assign(L, { free: true, x: x + Math.cos(a) * 0.3, y: y + rnd(-0.3, 0.6), z: z + Math.sin(a) * 0.3, vx: Math.cos(a) * v, vy: up, vz: Math.sin(a) * v, t: 0, life: rnd(1.1, 1.9) });
      got++;
    }
  }
  // el remolino se deshace: todas sus hojas salen despedidas hacia fuera y caen poco a poco
  release(power = 1) {
    if (this.released) return;
    this.released = true;
    const C = this.c;
    for (let i = 0; i < this.n; i++) {
      const L = this.L[i], rr = Math.max(0.3, (0.25 + L.r * (0.35 + 0.65 * L.h)) * 2);
      const ox = Math.cos(L.a), oz = Math.sin(L.a), v = rnd(3, 8) * power;
      Object.assign(L, { free: true, x: C.x + ox * rr * 0.5, y: C.y + 0.1 + L.h * this.H, z: C.z + oz * rr * 0.5, vx: ox * v - oz * v * 0.5, vy: rnd(0.5, 3), vz: oz * v + ox * v * 0.5, t: 0, life: rnd(1.0, 2.0) });
    }
    this.k = 0.6;
  }
  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    this.mat.dispose();
    for (const m of this.coreMats) { if (m.userData.ownMap) m.map.dispose(); m.dispose(); }
    this.coreGeo.dispose();
    this.mesh.dispose();
  }
}

/* ------------------------------------------------------------------ */
/*  ROTURA DE HIELO (enemigo congelado destruido)                      */
/* ------------------------------------------------------------------ */
let ICE = null;
function iceKit() {
  if (ICE) return ICE;
  ICE = {
    geo: new THREE.OctahedronGeometry(1, 0),
    geo2: new THREE.TetrahedronGeometry(1, 0),
    mat: new THREE.MeshStandardMaterial({ color: 0xd8f4ff, emissive: 0x4ab8ff, emissiveIntensity: 0.55, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.85, flatShading: true }),
    crack: new THREE.LineBasicMaterial({ color: 0xcff4ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
  };
  return ICE;
}
export function iceMaterials() { const K = iceKit(); return [K.mat]; }
// grietas luminosas: líneas quebradas azules y blancas que recorren el bloque de hielo
function crackLines(cx, cy, cz, h) {
  const pts = [];
  for (let b = 0; b < 9; b++) {
    let x = cx, y = cy + rnd(-0.2, 0.2) * h, z = cz;
    const a = rnd(0, TAU), up = rnd(-0.8, 0.8);
    for (let s = 0; s < 4; s++) {
      const nx = x + Math.cos(a + rnd(-0.6, 0.6)) * h * 0.13, ny = y + up * h * 0.12 + rnd(-0.06, 0.06) * h, nz = z + Math.sin(a + rnd(-0.6, 0.6)) * h * 0.13;
      pts.push(x, y, z, nx, ny, nz); x = nx; y = ny; z = nz;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}
export function iceShatter(game, x, y, z, h = 1.8) {
  const vfx = game.vfx, fx = game.fx, K = iceKit();
  const cy = y + h * 0.5;
  // 1) GRIETAS: el bloque se agrieta con líneas luminosas un instante antes de romperse
  const cg = crackLines(x, cy, z, h), cl = new THREE.LineSegments(cg, K.crack.clone());
  cl.material.userData.own = true; cl.renderOrder = 9;
  vfx.add(cl, 0.22, (it) => { cl.material.opacity = 1 - it.t / 0.22; if (it.t >= 0.219) cg.dispose(); });
  // 2) DESTELLO y onda helada
  if (vfx.orb) vfx.orb(new THREE.Vector3(x, cy, z), { r: h * 0.3, color: 0xcff4ff, opacity: 0.5, life: 0.22, grow: 1.2 });
  if (vfx.ring) { vfx.ring(x, null, z, { r0: 0.3, r1: 2.6 * (h / 1.8), dur: 0.45, color: 0x9fe6ff, opacity: 0.7 }); vfx.ring(x, null, z, { r0: 0.2, r1: 1.6 * (h / 1.8), dur: 0.35, color: 0xffffff, opacity: 0.6 }); }
  // 3) FRAGMENTOS CRISTALINOS que salen despedidos, giran, caen y se deshacen en partículas brillantes
  const grp = new THREE.Group(), F = [];
  const n = 26;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(i % 3 ? K.geo : K.geo2, K.mat);
    const a = rnd(0, TAU), up = rnd(-0.2, 1), v = rnd(2.5, 6.5) * Math.sqrt(h / 1.8);
    const s = rnd(0.05, 0.16) * (h / 1.8);
    m.position.set(x + Math.cos(a) * 0.2, y + rnd(0.15, 0.95) * h, z + Math.sin(a) * 0.2);
    m.scale.set(s, s * rnd(1.2, 2.4), s);
    m.rotation.set(rnd(0, TAU), rnd(0, TAU), 0);
    grp.add(m);
    F.push({ m, vx: Math.cos(a) * v, vy: up * v + 2, vz: Math.sin(a) * v, rx: rnd(-12, 12), rz: rnd(-12, 12), s, gone: false });
  }
  const LIFE = 1.0;
  vfx.add(grp, LIFE, (it, dt) => {
    const t = it.t;
    for (const f of F) {
      if (f.gone) continue;
      f.vy -= 14 * dt;
      f.m.position.x += f.vx * dt; f.m.position.y += f.vy * dt; f.m.position.z += f.vz * dt;
      if (f.m.position.y < y + 0.05 && f.vy < 0) { f.m.position.y = y + 0.05; f.vy *= -0.35; f.vx *= 0.5; f.vz *= 0.5; }
      f.m.rotation.x += f.rx * dt; f.m.rotation.z += f.rz * dt;
      const k = 1 - smooth(0.45, 1, t / LIFE);
      f.m.scale.set(f.s * k, f.s * 1.8 * k, f.s * k);
      if (t > 0.45 && !f.gone && Math.random() < 0.06) { fx.sparkle(f.m.position.x, f.m.position.y, f.m.position.z, Math.random() < 0.5 ? 0xeaffff : 0x8fdcff, 1.2); }
      if (k <= 0.02) { f.gone = true; fx.sparkle(f.m.position.x, f.m.position.y, f.m.position.z, 0xcff4ff, 1.5); }
    }
  });
  for (let i = 0; i < 14; i++) fx.sparkle(x + rnd(-0.4, 0.4), y + rnd(0.2, 1) * h, z + rnd(-0.4, 0.4), [0xffffff, 0xbff0ff, 0x7ad8ff][i % 3], 3.5);
  if (fx.snow) for (let i = 0; i < 6; i++) fx.snow(x + rnd(-0.6, 0.6), y + rnd(0.3, 1) * h, z + rnd(-0.6, 0.6));
  if (game.chase) game.chase.shake(0.12);
  audio.sfx('shatter'); // sonido cristalino
}

/* ------------------------------------------------------------------ */
/*  COMETA DE ENERGÍA BAJO UN PIE (Kairo)                              */
/* ------------------------------------------------------------------ */
let GLOW_TEX = null;
function glowTex() {
  if (GLOW_TEX) return GLOW_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(225,245,255,0.95)'); g.addColorStop(0.42, 'rgba(90,170,255,0.55)'); g.addColorStop(0.7, 'rgba(40,110,255,0.18)'); g.addColorStop(1, 'rgba(20,60,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  GLOW_TEX = new THREE.CanvasTexture(c);
  return GLOW_TEX;
}
// disco luminoso horizontal (bajo la zapatilla) + núcleo brillante: devuelve { group, set(pos, k, flash) , dispose }
export function cometDisc(parent) {
  const tex = glowTex();
  const mk = (op) => { const m = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }); m.userData.own = true; return m; };
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mk(0));
  disc.rotation.x = -Math.PI / 2;
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xcfeaff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  core.material.userData.own = true;
  const ringM = mk(0); ringM.color.setHex(0x5aa8ff);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 32), ringM);
  ring.rotation.x = -Math.PI / 2;
  const g = new THREE.Group();
  g.add(disc, core, ring);
  for (const o of [disc, core, ring]) { o.renderOrder = 7; o.frustumCulled = false; }
  parent.add(g);
  return {
    group: g,
    set(pos, k, flash, t) {
      g.position.copy(pos);
      g.visible = k > 0.01 || flash > 0.01;
      const s = 0.42 + 0.12 * Math.sin(t * 40) + 0.55 * flash;
      disc.scale.set(s * 1.25, s, 1);
      disc.material.opacity = Math.min(1, 0.85 * k + 0.6 * flash);
      core.scale.setScalar(0.22 + 0.25 * flash + 0.04 * Math.sin(t * 55));
      core.position.y = 0.04;
      core.material.opacity = Math.min(1, 0.9 * k + flash);
      ring.scale.setScalar(0.6 + 1.6 * flash);
      ring.material.opacity = 0.9 * flash;
    },
    dispose() {
      if (g.parent) g.parent.remove(g);
      disc.geometry.dispose(); ring.geometry.dispose();
      disc.material.dispose(); ring.material.dispose(); core.material.dispose();
    },
  };
}

// LÍNEAS DE VELOCIDAD en los bordes de la pantalla (capa HTML muy ligera, sin coste en la escena 3D)
let SPEED_EL = null;
export function speedLines(k) {
  if (!SPEED_EL) {
    if (k <= 0.01) return;
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const x = c.getContext('2d');
    x.translate(256, 256);
    for (let i = 0; i < 140; i++) {
      const a = Math.random() * TAU, r0 = 150 + Math.random() * 60, r1 = r0 + 60 + Math.random() * 120;
      x.strokeStyle = `rgba(${Math.random() < 0.5 ? '200,230,255' : '120,180,255'},${0.25 + Math.random() * 0.5})`;
      x.lineWidth = 0.6 + Math.random() * 1.8;
      x.beginPath(); x.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); x.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); x.stroke();
    }
    SPEED_EL = document.createElement('div');
    Object.assign(SPEED_EL.style, {
      position: 'fixed', inset: '-10%', pointerEvents: 'none', zIndex: 5, opacity: 0,
      backgroundImage: `url(${c.toDataURL()})`, backgroundSize: 'cover', backgroundPosition: 'center',
      maskImage: 'radial-gradient(ellipse at center, transparent 38%, #000 72%)', WebkitMaskImage: 'radial-gradient(ellipse at center, transparent 38%, #000 72%)',
      transition: 'opacity 0.25s',
    });
    document.body.appendChild(SPEED_EL);
  }
  SPEED_EL.style.opacity = String(Math.min(0.75, k * 0.75));
  if (k > 0.01) SPEED_EL.style.transform = `scale(${1 + Math.random() * 0.05}) rotate(${(Math.random() - 0.5) * 4}deg)`;
}

/* ------------------------------------------------------------------ */
/*  AURORA POLAR — ESCUDO Y ÁREA DE CONGELACIÓN (Kira)                 */
/* ------------------------------------------------------------------ */
// ESCUDO: burbuja de energía polar que envuelve todo su cuerpo, con cortinas de aurora (azul, verde y violeta)
// que ondulan y suben por ella; borde brillante (Fresnel) y centro casi transparente para que Kira se vea.
let SHIELD_GEO = null;
export function auroraShield(parent) {
  if (!SHIELD_GEO) SHIELD_GEO = new THREE.SphereGeometry(1, 48, 32);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uT: { value: 0 }, uOp: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform float uT;
      void main(){ vec3 p = position; p += normal * 0.035 * sin(p.y * 7.0 + uT * 3.0 + atan(p.z, p.x) * 3.0);
        vP = position; vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform float uT; uniform float uOp;
      void main(){
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(f, 2.3);
        float a = atan(vP.z, vP.x);
        // cortinas de aurora: bandas verticales que ondulan y suben
        float c1 = 0.5 + 0.5 * sin(a * 6.0 + vP.y * 3.0 - uT * 1.6 + sin(vP.y * 4.0 + uT) * 1.2);
        float c2 = 0.5 + 0.5 * sin(a * 11.0 - vP.y * 5.0 + uT * 2.3);
        float rays = pow(c1, 3.0) * 0.8 + pow(c2, 6.0) * 0.5;
        float h = vP.y * 0.5 + 0.5;
        vec3 blue = vec3(0.25, 0.55, 1.0), green = vec3(0.25, 1.0, 0.65), violet = vec3(0.75, 0.35, 1.0);
        vec3 col = mix(green, blue, smoothstep(0.15, 0.6, h + 0.15 * sin(a * 2.0 + uT)));
        col = mix(col, violet, smoothstep(0.55, 0.95, h + 0.1 * c2));
        float alpha = (rim * 0.85 + rays * (0.12 + 0.35 * rim) + 0.04) * uOp;
        gl_FragColor = vec4(col * (1.0 + rays * 0.8), alpha);
      }`,
  });
  const m = new THREE.Mesh(SHIELD_GEO, mat);
  m.renderOrder = 7; m.frustumCulled = false;
  parent.add(m);
  return {
    mesh: m, mat,
    set(pos, sx, sy, op, t) { m.position.copy(pos); m.scale.set(sx, sy, sx); mat.uniforms.uOp.value = op; mat.uniforms.uT.value = t; m.visible = op > 0.002; },
    dispose() { if (m.parent) m.parent.remove(m); mat.dispose(); },
  };
}

// ÁREA DE CONGELACIÓN: suelo helado dentro del radio REAL de la habilidad, aro de energía en el borde y
// cristales de hielo que brotan a lo largo del aro. Se centra en Kira cada fotograma (la sigue si se mueve).
let FLOOR_TEX = null;
function frostFloorTex() {
  if (FLOOR_TEX) return FLOOR_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d'), g = x.createRadialGradient(256, 256, 20, 256, 256, 256);
  g.addColorStop(0, 'rgba(225,245,255,0.55)'); g.addColorStop(0.7, 'rgba(170,220,255,0.6)'); g.addColorStop(0.93, 'rgba(200,240,255,0.85)'); g.addColorStop(1, 'rgba(200,240,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  x.strokeStyle = 'rgba(255,255,255,0.7)'; x.lineWidth = 1.5;
  for (let i = 0; i < 26; i++) { // grietas de hielo que salen del centro
    let px = 256, py = 256; const a = Math.random() * TAU;
    x.beginPath(); x.moveTo(px, py);
    for (let s = 0; s < 9; s++) { px += Math.cos(a + (Math.random() - 0.5) * 0.8) * 26; py += Math.sin(a + (Math.random() - 0.5) * 0.8) * 26; x.lineTo(px, py); }
    x.stroke();
  }
  for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.5})`; const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * 230; x.fillRect(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, 2, 2); } // escarcha
  FLOOR_TEX = new THREE.CanvasTexture(c);
  return FLOOR_TEX;
}
export function frostArea(parent, r, heightAt = null) {
  // suelo helado y aro de energía que SE ADAPTAN AL RELIEVE (en pendientes no quedan enterrados ni flotando)
  const g = new THREE.Group();
  const NG = 36, floorGeo = new THREE.PlaneGeometry(2, 2, NG, NG); floorGeo.rotateX(-Math.PI / 2);
  const base = floorGeo.attributes.position.array.slice(); // rejilla de -1..1 (se escala por el radio)
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ map: frostFloorTex(), color: 0xe8f8ff, emissive: 0x2a78b8, emissiveIntensity: 0.25, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
  floor.renderOrder = 3;
  const NR = 160, ringGeo = new THREE.BufferGeometry();
  const rp = new Float32Array((NR + 1) * 2 * 3), ri = [];
  for (let i = 0; i < NR; i++) { const a0 = i * 2, b0 = a0 + 2; ri.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1); }
  ringGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3)); ringGeo.setIndex(ri);
  const ring2Geo = ringGeo.clone();
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x8ae8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const ring = new THREE.Mesh(ringGeo, ringMat), ring2 = new THREE.Mesh(ring2Geo, ringMat.clone()); ring2.material.color.setHex(0xb08aff);
  const cGeo = new THREE.ConeGeometry(0.07, 0.5, 5); cGeo.translate(0, 0.25, 0);
  const cMat = new THREE.MeshStandardMaterial({ color: 0xcfefff, emissive: 0x3ab8ff, emissiveIntensity: 0.45, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.85, flatShading: true });
  const crystals = [];
  for (let i = 0; i < 28; i++) { const c = new THREE.Mesh(cGeo, cMat), a = (i / 28) * TAU + Math.random() * 0.1; c.userData.a = a; c.userData.s = 0.6 + Math.random() * 0.9; c.rotation.set(Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35); g.add(c); crystals.push(c); }
  g.add(floor, ring, ring2);
  for (const o of [ring, ring2, floor]) o.frustumCulled = false;
  ring.renderOrder = ring2.renderOrder = 6;
  parent.add(g);
  const H = heightAt || (() => 0);
  let lx = 1e9, lz = 1e9, lk = -1, ly = 0;
  const shape = (cx, cy, cz, k) => {
    const P = floorGeo.attributes.position.array, R = r * Math.max(0.0001, k);
    for (let i = 0; i < P.length; i += 3) { const x = base[i] * R, z = base[i + 2] * R; P[i] = x; P[i + 2] = z; P[i + 1] = H(cx + x, cz + z) - cy + 0.05; }
    floorGeo.attributes.position.needsUpdate = true; floorGeo.computeBoundingSphere();
    for (const [geo, rr, w, up] of [[ringGeo, r, 0.07, 0.09], [ring2Geo, r * 0.975, 0.035, 0.14]]) {
      const A = geo.attributes.position.array;
      for (let i = 0; i <= NR; i++) {
        const a = (i / NR) * TAU, ca = Math.cos(a), sa = Math.sin(a);
        for (let j = 0; j < 2; j++) { const q = rr + (j ? w : -w), x = ca * q, z = sa * q, o = (i * 2 + j) * 3; A[o] = x; A[o + 1] = H(cx + x, cz + z) - cy + up; A[o + 2] = z; }
      }
      geo.attributes.position.needsUpdate = true; geo.computeBoundingSphere();
    }
    for (const c of crystals) { const a = c.userData.a, x = Math.cos(a) * r, z = Math.sin(a) * r; c.position.set(x, H(cx + x, cz + z) - cy, z); }
  };
  return {
    group: g,
    // k: aparición (0..1), t: tiempo; (x, y, z) = centro sobre el suelo
    set(x, y, z, k, t) {
      g.position.set(x, y, z);
      // el relieve se recalcula solo si se ha movido o mientras el área se expande
      if (Math.hypot(x - lx, z - lz) > 0.12 || Math.abs(y - ly) > 0.05 || (k < 1 && Math.abs(k - lk) > 0.02)) { shape(x, y, z, k < 1 ? k : 1); lx = x; lz = z; ly = y; lk = k; }
      floor.material.opacity = 0.75 * k;
      ring.material.opacity = 0.95 * k * (0.75 + 0.25 * Math.sin(t * 6));
      ring2.material.opacity = 0.5 * k;
      for (const c of crystals) c.scale.setScalar(Math.max(0.0001, c.userData.s * k));
      g.visible = k > 0.002;
    },
    dispose() { if (g.parent) g.parent.remove(g); floorGeo.dispose(); floor.material.dispose(); ringGeo.dispose(); ring2Geo.dispose(); ringMat.dispose(); ring2.material.dispose(); cGeo.dispose(); cMat.dispose(); },
  };
}
