import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { terrainH } from '../terrain.js';
import { cloudMat } from './fx3.js';

/* ======================================================================
   EFECTOS AVANZADOS DE HABILIDADES (4.ª tanda)
   · MirageWard  — ESPEJISMOS de la Fénec: copias ilusorias que orbitan a su
                   alrededor, la protegen desde todas las direcciones y se
                   interponen y estallan al recibir un golpe (escudo real)
   · TsunamiWave — TSUNAMI de la Nutria: ola con volumen y sombreador de agua
                   (profundidad, translucidez, espuma, vetas), cortina de
                   espuma en la cresta y lengua de espuma por delante
   · WaterVortex — columna de agua que gira alrededor de la Nutria mientras
                   acumula energía
   · FoamPool    — charco de espuma que queda en el suelo tras la rompiente
   · WaterShield — MAELSTROM de la Nutria: cúpula de agua en remolino que la protege
   Todo usa geometrías y materiales propios que se liberan en dispose().
   ====================================================================== */

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const lerp = (a, b, k) => a + (b - a) * k;
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };

const NOISE = /* glsl */`
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1,0)), u.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), u.x), u.y); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

/* ================================================================== */
/*  FÉNEC — ESCUDO DE ESPEJISMOS                                       */
/* ================================================================== */
// Material de ilusión: la copia conserva sus colores, pero se tiñe, brilla en el
// borde (fresnel), muestra líneas de interferencia y se vuelve translúcida.
function illusionize(m0, U) {
  const m = m0.clone();
  m.transparent = true; m.depthWrite = false;
  m.opacity = 1;
  if (m.emissive) { m.emissive = new THREE.Color(0x6a2aa8); m.emissiveIntensity = 0.35; }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMT = U.uMT; sh.uniforms.uMCol = U.uMCol; sh.uniforms.uMOp = U.uMOp; sh.uniforms.uMFlash = U.uMFlash;
    const lit = sh.fragmentShader.includes('vViewPosition') && sh.fragmentShader.includes('#include <normal_fragment_begin>');
    sh.fragmentShader = 'uniform float uMT; uniform vec3 uMCol; uniform float uMOp; uniform float uMFlash;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `
      #include <dithering_fragment>
      float rimF = ${lit ? '1.0 - abs(dot(normalize(normal), normalize(vViewPosition)))' : '0.5'};
      float scan = 0.82 + 0.18 * sin(gl_FragCoord.y * 0.85 - uMT * 38.0);
      float band = smoothstep(0.92, 1.0, sin(gl_FragCoord.y * 0.045 + uMT * 6.0)); // franja de interferencia que recorre la figura
      vec3 col = mix(gl_FragColor.rgb, uMCol, 0.38) * scan + uMCol * (pow(rimF, 2.2) * 1.7 + band * 0.55);
      col = mix(col, vec3(1.0), uMFlash);
      gl_FragColor = vec4(col, gl_FragColor.a * uMOp * (0.42 + 0.58 * pow(rimF, 0.9) + band * 0.3 + uMFlash));`);
  };
  m.customProgramCacheKey = () => 'mirage-illusion-' + (m0.type || '');
  return m;
}

// Copia animada del héroe: un clon del esqueleto que copia la pose del original
// (con un retraso propio, para que cada espejismo se mueva como un eco).
class Echo {
  constructor(src, tint, opacity) {
    this.U = { uMT: { value: 0 }, uMCol: { value: new THREE.Color(tint) }, uMOp: { value: opacity }, uMFlash: { value: 0 } };
    this.copy = SkeletonUtils.clone(src);
    this.mats = [];
    this.bones = [];
    this.copy.traverse((o) => {
      if (o.isBone) this.bones.push(o);
      if (o.isLight) { o.visible = false; return; }
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = false;
      o.renderOrder = 3;
      o.userData.own = true;
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      const nm = arr.map((m0) => { const m = illusionize(m0, this.U); this.mats.push(m); return m; });
      o.material = Array.isArray(o.material) ? nm : nm[0];
    });
    this.group = new THREE.Group();
    this.group.add(this.copy);
    this.base = this.copy.scale.clone();
  }
  pose(frame) {
    if (!frame) return;
    const n = Math.min(this.bones.length, frame.length / 7);
    for (let i = 0; i < n; i++) {
      const b = this.bones[i], k = i * 7;
      b.position.set(frame[k], frame[k + 1], frame[k + 2]);
      b.quaternion.set(frame[k + 3], frame[k + 4], frame[k + 5], frame[k + 6]);
    }
  }
  dispose() { for (const m of this.mats) m.dispose(); }
}

export class MirageWard {
  // g: juego · p: jugador · n: número de espejismos · radius: radio de la órbita · life: duración
  constructor(g, p, { n = 3, radius = 2.3, life = 6.5, tint = 0xc89aff, gold = 0xffd890 } = {}) {
    this.g = g; this.p = p; this.n = n; this.R = radius; this.life = life;
    this.tint = tint; this.gold = gold;
    this.t = 0; this.rot = p.facing; this.ending = 0; this.done = false;
    this.group = new THREE.Group();
    g.vfx.group.add(this.group);
    this.src = p.model.body || p.model.root;
    this.srcBones = [];
    this.src.traverse((o) => { if (o.isBone) this.srcBones.push(o); });
    // historial de poses (para el retraso de cada eco)
    this.hist = []; this.histMax = 26;
    this.record();
    this.mirrors = [];
    for (let i = 0; i < n; i++) {
      const main = new Echo(this.src, tint, 0.9), trail = new Echo(this.src, gold, 0.32);
      this.group.add(main.group, trail.group);
      const a = this.rot + (i / n) * TAU;
      this.mirrors.push({ i, main, trail, ang: a, tAng: a, trailAng: a, alive: true, state: 'spawn', st: 0, r: 0, blinkT: rnd(1.2, 2.2) + i * 0.4, delay: 3 + i * 4, x: p.pos.x, y: p.pos.y, z: p.pos.z, from: null });
    }
    this.buildDome();
  }
  get alive() { return this.mirrors.filter((m) => m.alive && m.state !== 'shatter'); }

  record() {
    const B = this.srcBones, f = new Float32Array(B.length * 7);
    for (let i = 0; i < B.length; i++) { const b = B[i], k = i * 7; f[k] = b.position.x; f[k + 1] = b.position.y; f[k + 2] = b.position.z; f[k + 3] = b.quaternion.x; f[k + 4] = b.quaternion.y; f[k + 5] = b.quaternion.z; f[k + 6] = b.quaternion.w; }
    this.hist.unshift(f);
    if (this.hist.length > this.histMax) this.hist.pop();
  }
  frame(delay) { return this.hist[Math.min(this.hist.length - 1, delay)]; }

  // Cúpula de distorsión (bruma de calor violeta y dorada) y círculo rúnico en el suelo
  buildDome() {
    const H = Math.max(1.6, this.p.H * 1.35), R = this.R + 0.45;
    this.domeGeo = new THREE.CylinderGeometry(R, R * 0.9, H, 48, 1, true);
    this.domeGeo.translate(0, H / 2, 0);
    this.domeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uT: { value: 0 }, uOp: { value: 0 }, uHit: { value: 0 }, uHitAng: { value: 0 }, uA: { value: new THREE.Color(this.tint) }, uB: { value: new THREE.Color(this.gold) } },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: NOISE + `uniform float uT; uniform float uOp; uniform float uHit; uniform float uHitAng; uniform vec3 uA; uniform vec3 uB;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){
          float x = vUv.x * 6.2831853;
          float haze = fbm(vec2(vUv.x * 14.0 + uT * 0.4, vUv.y * 3.0 - uT * 1.6));
          float bands = smoothstep(0.55, 0.95, sin(vUv.y * 38.0 - uT * 7.0 + haze * 6.0) * 0.5 + 0.5);
          float facing = abs(dot(normalize(vN), normalize(vV)));
          float edge = pow(1.0 - facing, 2.0);
          float vert = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
          float d = abs(atan(sin(x - uHitAng), cos(x - uHitAng)));
          float hit = uHit * (1.0 - smoothstep(0.0, 1.4, d)) * (0.6 + 0.4 * sin(vUv.y * 30.0 - uT * 30.0));
          vec3 c = mix(uA, uB, haze) * (0.35 + bands * 0.65) + vec3(1.0) * hit;
          float a = (edge * 0.7 + bands * 0.18 + haze * 0.08) * vert * uOp + hit * vert;
          gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
        }`,
    });
    this.dome = new THREE.Mesh(this.domeGeo, this.domeMat);
    this.dome.renderOrder = 5;
    this.group.add(this.dome);

    this.runeGeo = new THREE.RingGeometry(this.R - 0.35, this.R + 0.55, 96, 1);
    this.runeGeo.rotateX(-Math.PI / 2);
    this.runeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uT: { value: 0 }, uOp: { value: 0 }, uA: { value: new THREE.Color(this.tint) }, uB: { value: new THREE.Color(this.gold) }, uR0: { value: this.R - 0.35 }, uR1: { value: this.R + 0.55 } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uT; uniform float uOp; uniform vec3 uA; uniform vec3 uB; uniform float uR0; uniform float uR1; varying vec3 vP;
        void main(){
          float r = length(vP.xz), q = (r - uR0) / (uR1 - uR0), a = atan(vP.z, vP.x);
          float line = smoothstep(0.08, 0.0, abs(q - 0.3)) + smoothstep(0.06, 0.0, abs(q - 0.78));
          float seg = step(0.5, fract(a * 6.0 / 6.2831853 * 4.0 + uT * 0.35)) * smoothstep(0.12, 0.0, abs(q - 0.54));
          float tick = smoothstep(0.9, 1.0, sin(a * 36.0 - uT * 2.0)) * smoothstep(0.2, 0.0, abs(q - 0.54));
          float glow = (1.0 - abs(q - 0.5) * 2.0) * 0.18;
          vec3 c = mix(uA, uB, 0.5 + 0.5 * sin(a * 3.0 + uT));
          gl_FragColor = vec4(c * 0.7, (line * 0.5 + seg * 0.4 + tick * 0.45 + glow * 0.5) * uOp);
        }`,
    });
    this.rune = new THREE.Mesh(this.runeGeo, this.runeMat);
    this.rune.renderOrder = 4;
    this.group.add(this.rune);
  }

  fx() { return this.g.fx; }
  puff(x, y, z, big = 1) {
    const fx = this.g.fx;
    for (let i = 0; i < Math.round(5 * big); i++) fx.mist(x + rnd(-0.5, 0.5), y + rnd(0.2, 1.5), z + rnd(-0.5, 0.5), Math.random() < 0.5 ? 0xe8c8ff : 0xffe6b0, 1.1 * big);
    for (let i = 0; i < Math.round(8 * big); i++) fx.sparkle(x + rnd(-0.4, 0.4), y + rnd(0.2, 1.4), z + rnd(-0.4, 0.4), Math.random() < 0.5 ? this.tint : this.gold, 2.2 * big);
  }

  // Un golpe llega desde `from`: el espejismo más cercano a esa dirección se interpone y lo absorbe.
  absorb(from) {
    const live = this.alive;
    if (!live.length || this.ending) return false;
    const p = this.p.pos;
    const hitAng = from ? Math.atan2(from.x - p.x, from.z - p.z) : this.rot;
    let best = live[0], bd = Infinity;
    for (const m of live) { const d = Math.abs(angDiff(m.ang, hitAng)); if (d < bd) { bd = d; best = m; } }
    best.state = 'shatter'; best.st = 0; best.hitAng = hitAng;
    this.domeMat.uniforms.uHit.value = 1;
    this.domeMat.uniforms.uHitAng.value = Math.atan2(Math.sin(hitAng), Math.cos(hitAng)); // ángulo del cilindro (u) ≈ atan2(x, z)
    this.g.chase.shake(0.12);
    return true;
  }

  // Halley salta al espejismo más alineado con su mirada; devuelve su posición
  takeForBlink() {
    const live = this.alive;
    if (!live.length) return null;
    const f = this.p.facing;
    let best = live[0], bd = Infinity;
    for (const m of live) { const d = Math.abs(angDiff(m.ang, f)); if (d < bd) { bd = d; best = m; } }
    const pos = new THREE.Vector3(best.x, best.y, best.z);
    best.state = 'shatter'; best.st = 0.12; best.hitAng = best.ang; best.quiet = true;
    return { pos, facing: best.ang };
  }

  end() { if (!this.ending) this.ending = 0.0001; }

  update(dt) {
    if (this.done) return true;
    this.t += dt;
    const p = this.p, P = p.pos, t = this.t;
    this.record();
    const live = this.alive;
    // la órbita gira despacio; los vivos se reparten de nuevo cuando uno cae
    this.rot += dt * 1.1;
    live.forEach((m, j) => { m.tAng = this.rot + (j / live.length) * TAU + m.i * 0.0001; });
    const fadeIn = clamp01(t / 0.35);
    let endK = 0;
    if (this.ending) { this.ending += dt; endK = clamp01(this.ending / 0.45); }
    const domeOp = fadeIn * (1 - endK) * (live.length ? 1 : 0.4);
    const du = this.domeMat.uniforms, ru = this.runeMat.uniforms;
    du.uT.value = t; ru.uT.value = t;
    du.uOp.value = lerp(du.uOp.value, domeOp * 0.55, Math.min(1, dt * 8));
    ru.uOp.value = lerp(ru.uOp.value, domeOp * 0.6, Math.min(1, dt * 8));
    du.uHit.value = Math.max(0, du.uHit.value - dt * 3.2);
    const gy = Math.max(terrainH(P.x, P.z), P.y - 3);
    this.dome.position.set(P.x, P.y - 0.05, P.z);
    this.dome.scale.setScalar(1 - endK * 0.6 + 0.04 * Math.sin(t * 3));
    this.rune.position.set(P.x, Math.min(P.y, gy + 0.6) + 0.06, P.z);
    this.rune.rotation.y = -t * 0.6;
    this.rune.scale.setScalar(lerp(0.4, 1, easeOut(fadeIn)) * (1 - endK * 0.7));

    for (const m of this.mirrors) {
      if (!m.alive) continue;
      m.st += dt;
      const E = m.main, T = m.trail;
      E.U.uMT.value = t + m.i * 1.7; T.U.uMT.value = t + m.i * 1.7 + 0.5;
      // ángulo, radio y altura
      if (m.state !== 'shatter') m.ang += angDiff(m.ang, m.tAng) * Math.min(1, dt * 6);
      let r = this.R * (1 + 0.07 * Math.sin(t * 2.3 + m.i * 2.1)), op = 0.9, flash = 0, stretch = 1;
      if (m.state === 'spawn') {
        const k = clamp01(m.st / 0.42);
        r *= easeOut(k);
        op = 0.25 + 0.65 * k;
        flash = (1 - k) * 0.8;
        if (k >= 1) { m.state = 'guard'; this.puff(m.x, m.y, m.z, 0.6); }
      } else if (m.state === 'guard') {
        // desaparece y reaparece en otro punto del círculo (ilusión inestable)
        m.blinkT -= dt;
        if (m.blinkT <= 0 && !m.blinking) { m.blinking = 0.0001; this.puff(m.x, m.y, m.z, 0.5); }
        if (m.blinking) {
          m.blinking += dt;
          const b = m.blinking;
          op = b < 0.1 ? 0.9 * (1 - b / 0.1) : b < 0.22 ? 0 : 0.9 * clamp01((b - 0.22) / 0.12);
          if (b >= 0.1 && !m.jumped) { m.jumped = true; m.ang += rnd(0.7, 1.2) * (Math.random() < 0.5 ? -1 : 1); m.trailAng = m.ang; }
          if (b >= 0.22 && !m.landed) { m.landed = true; flash = 0.8; this.puff(P.x + Math.sin(m.ang) * r, P.y, P.z + Math.cos(m.ang) * r, 0.7); }
          if (b >= 0.34) { m.blinking = 0; m.jumped = m.landed = false; m.blinkT = rnd(1.6, 2.6); }
        }
      } else if (m.state === 'shatter') {
        // se lanza hacia el golpe, destella y estalla en arena y cristales de luz
        const k = clamp01(m.st / 0.3);
        if (!m.quiet) { m.ang += angDiff(m.ang, m.hitAng) * Math.min(1, dt * 20); r = lerp(this.R, this.R * 0.62, easeOut(clamp01(m.st / 0.1))); }
        flash = k < 0.35 ? 1 : 1 - (k - 0.35) / 0.65;
        op = 1 - k;
        stretch = 1 + k * 0.9;
        if (!m.burst && m.st >= 0.1) {
          m.burst = true;
          const hx = P.x + Math.sin(m.ang) * r, hz = P.z + Math.cos(m.ang) * r, hy = m.y + p.H * 0.55;
          this.puff(hx, m.y, hz, 1.6);
          const fx = this.g.fx, ox = Math.sin(m.hitAng), oz = Math.cos(m.hitAng);
          for (let i = 0; i < 14; i++) fx.spray(hx, hy, hz, ox * rnd(2, 6) + rnd(-2, 2), rnd(1, 4), oz * rnd(2, 6) + rnd(-2, 2), 0.7); // el golpe se desvía hacia fuera
          this.g.vfx.ring(hx, null, hz, { r0: 0.3, r1: 2.6, dur: 0.45, color: this.gold });
          this.g.vfx.ring(hx, null, hz, { r0: 0.2, r1: 1.6, dur: 0.35, color: this.tint });
          if (this.g.vfx2) this.g.vfx2.shell(new THREE.Vector3(hx, hy, hz), { r: 1.1, color: this.tint, rim: 0xffffff, opacity: 0.7, life: 0.3 });
        }
        if (k >= 1) { m.alive = false; E.group.visible = false; T.group.visible = false; continue; }
      }
      if (endK > 0) { r *= 1 - endK; op *= 1 - endK; flash = Math.max(flash, endK * 0.6); stretch *= 1 + endK * 0.5; }
      op *= fadeIn > 0 ? 1 : 0;
      m.x = P.x + Math.sin(m.ang) * r; m.z = P.z + Math.cos(m.ang) * r;
      m.y = P.y + 0.06 * Math.sin(t * 2.6 + m.i);
      // distorsión óptica: la figura tiembla, se estira y se desplaza
      const jit = 0.04 + flash * 0.08;
      E.group.position.set(m.x + rnd(-jit, jit) * 0.5, m.y, m.z + rnd(-jit, jit) * 0.5);
      E.group.rotation.y = m.ang; // mira hacia fuera: guarda a Halley desde su lado
      E.copy.scale.set(E.base.x * (1 + 0.035 * Math.sin(t * 23 + m.i) - (stretch - 1) * 0.35), E.base.y * (1 + 0.05 * Math.sin(t * 17 + m.i * 3)) * stretch, E.base.z * (1 + 0.035 * Math.cos(t * 21)));
      E.U.uMOp.value = op; E.U.uMFlash.value = flash;
      E.pose(this.frame(m.delay));
      // rastro: un eco dorado más tenue que llega con retraso
      m.trailAng += angDiff(m.trailAng, m.ang) * Math.min(1, dt * 3.2);
      const tr = r * 0.97;
      T.group.position.set(P.x + Math.sin(m.trailAng) * tr, m.y, P.z + Math.cos(m.trailAng) * tr);
      T.group.rotation.y = m.trailAng;
      T.copy.scale.copy(E.copy.scale);
      const lag = Math.abs(angDiff(m.trailAng, m.ang));
      T.U.uMOp.value = op * clamp01(0.15 + lag * 1.8) * 0.5; T.U.uMFlash.value = flash * 0.5;
      T.pose(this.frame(m.delay + 8));
      // granos de arena brillante que se desprenden
      if (op > 0.2 && Math.random() < dt * 9) this.g.fx.sparkle(m.x + rnd(-0.3, 0.3), m.y + rnd(0.1, p.H), m.z + rnd(-0.3, 0.3), Math.random() < 0.5 ? this.tint : this.gold, 0.7);
    }
    if (endK >= 1) { this.done = true; return true; }
    return false;
  }

  dispose() {
    this.g.vfx.group.remove(this.group);
    for (const m of this.mirrors) { m.main.dispose(); m.trail.dispose(); }
    this.domeGeo.dispose(); this.domeMat.dispose(); this.runeGeo.dispose(); this.runeMat.dispose();
    this.done = true;
  }
}

/* ================================================================== */
/*  NUTRIA — TSUNAMI                                                   */
/* ================================================================== */
const WATER_VS = /* glsl */`
  varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main(){
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
    vec4 mv = viewMatrix * w;
    vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const WAVE_FS = NOISE + /* glsl */`
  uniform float uT; uniform float uOp; uniform float uFoam; uniform vec2 uDir; uniform vec3 uDeep; uniform vec3 uMid; uniform vec3 uLight; uniform vec3 uSun;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main(){
    float v = vUv.y, u = vUv.x;
    vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
    // ondulaciones que suben por la cara de la ola
    float rip = fbm(vec2(u * 26.0, v * 7.0 - uT * 2.4));
    float rip2 = vnoise(vec2(u * 70.0 + uT * 0.6, v * 18.0 - uT * 4.0));
    n = normalize(n + vec3(rip - 0.5, 0.0, rip2 - 0.5) * 0.35);
    float facing = clamp(abs(dot(n, normalize(vV))), 0.0, 1.0);
    float fres = pow(1.0 - facing, 3.0);
    // color: fondo oscuro → azul → turquesa translúcido cerca de la cresta
    vec3 c = mix(uDeep, uMid, smoothstep(0.0, 0.7, v));
    float thin = smoothstep(0.45, 0.85, v) * (0.4 + 0.6 * (1.0 - facing));
    c = mix(c, uLight, thin * 0.7);
    float dif = clamp(dot(n, normalize(uSun)) * 0.5 + 0.5, 0.0, 1.0);
    c *= 0.65 + 0.5 * dif;
    vec3 hv = normalize(normalize(uSun) + normalize(vV));
    float spec = pow(clamp(dot(n, hv), 0.0, 1.0), 60.0) * 1.4;
    c += vec3(spec) + fres * vec3(0.55, 0.8, 1.0) * 0.6;
    // espuma: cresta, vetas que caen por la cara y bordes laterales
    float fn = fbm(vec2(u * 18.0 + uT * 0.3, v * 5.0 - uT * 1.5));
    float crest = smoothstep(0.74, 0.9, v + (fn - 0.5) * 0.22);
    float streak = smoothstep(0.58, 0.86, fbm(vec2(u * 22.0 + v * 3.0, v * 2.2 + uT * 1.8))) * smoothstep(0.3, 0.8, v) * 0.45;
    float side = 1.0 - smoothstep(0.0, 0.12, min(u, 1.0 - u));
    float foam = clamp((crest + streak + side * 0.6 * (fn + 0.3)) * uFoam, 0.0, 1.0);
    c = mix(c, vec3(0.95, 0.99, 1.0), foam);
    float a = smoothstep(0.0, 0.28, v) * smoothstep(0.0, 0.08, min(u, 1.0 - u));
    a *= mix(0.8, 1.0, foam) * uOp;
    // vista desde detrás de la ola (la cámara sigue a la nutria): más translúcida para no tapar el combate
    float behind = smoothstep(0.05, -0.6, dot(normalize(vV.xz), uDir));
    a *= mix(1.0, 0.42, behind);
    gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
  }`;
const FOAM_FS = NOISE + /* glsl */`
  uniform float uT; uniform float uOp; uniform float uScale;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main(){
    vec2 q = vW.xz * uScale;
    float f = fbm(q + vec2(uT * 0.4, -uT * 0.7));
    float cells = smoothstep(0.42, 0.7, fbm(q * 2.3 - vec2(uT * 0.9, uT * 0.2)));
    float edge = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y) * smoothstep(0.0, 0.12, min(vUv.x, 1.0 - vUv.x));
    float a = (cells * 0.75 + f * 0.35) * edge * uOp;
    vec3 c = mix(vec3(0.62, 0.86, 0.98), vec3(1.0), cells);
    gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
  }`;

function waterMat() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: true, side: THREE.DoubleSide, fog: false,
    uniforms: { uT: { value: 0 }, uOp: { value: 0.94 }, uFoam: { value: 1 }, uDir: { value: new THREE.Vector2(0, 1) }, uDeep: { value: new THREE.Color(0x06305e) }, uMid: { value: new THREE.Color(0x157fc0) }, uLight: { value: new THREE.Color(0x5fe0ea) }, uSun: { value: new THREE.Vector3(0.4, 0.8, 0.35) } },
    vertexShader: WATER_VS, fragmentShader: WAVE_FS,
  });
}
function foamMat(op = 0.9, scale = 0.55) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { uT: { value: 0 }, uOp: { value: op }, uScale: { value: scale } },
    vertexShader: WATER_VS, fragmentShader: FOAM_FS,
  });
}

export class TsunamiWave {
  // origin: dónde nace la ola · dir: hacia dónde avanza (unitario) · width: anchura
  constructor(origin, dir, { width = 12 } = {}) {
    this.o = origin.clone(); this.dir = { x: dir.x, z: dir.z }; this.width = width;
    this.front = origin.clone();
    this.group = new THREE.Group();
    this.t = 0; this.op = 1;
    const W = this.W = 56, P = this.P = 34;
    // cuerpo de la ola
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array((W + 1) * (P + 1) * 3);
    const uv = new Float32Array((W + 1) * (P + 1) * 2), idx = [];
    for (let i = 0; i <= W; i++) for (let j = 0; j <= P; j++) { const k = (i * (P + 1) + j) * 2; uv[k] = i / W; uv[k + 1] = j / P; }
    for (let i = 0; i < W; i++) for (let j = 0; j < P; j++) { const a = i * (P + 1) + j, b = a + P + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.mat = waterMat();
    this.mat.uniforms.uDir.value.set(dir.x, dir.z);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.group.add(this.mesh);
    // cortina de espuma y rocío que se levanta de la cresta
    this.lipGeo = this.stripGeo(W, 4);
    this.lipMat = cloudMat({ dark: 0xbfe6ff, light: 0xffffff, opacity: 0.75, scale: 4.5, rise: 1.6, swirl: 0.3, puff: 0.25 });
    this.lip = new THREE.Mesh(this.lipGeo, this.lipMat);
    this.lip.frustumCulled = false; this.lip.renderOrder = 6;
    this.group.add(this.lip);
    // lengua de espuma que corre por el suelo delante de la ola
    this.skirtGeo = this.stripGeo(W, 4);
    this.skirtMat = foamMat(0.9, 0.5);
    this.skirt = new THREE.Mesh(this.skirtGeo, this.skirtMat);
    this.skirt.frustumCulled = false; this.skirt.renderOrder = 3;
    this.group.add(this.skirt);
    this.shape(0.01, 0, 0);
  }
  stripGeo(W, R) {
    const g = new THREE.BufferGeometry(), pos = new Float32Array((W + 1) * (R + 1) * 3), uv = new Float32Array((W + 1) * (R + 1) * 2), idx = [];
    for (let i = 0; i <= W; i++) for (let j = 0; j <= R; j++) { const k = (i * (R + 1) + j) * 2; uv[k] = i / W; uv[k + 1] = j / R; }
    for (let i = 0; i < W; i++) for (let j = 0; j < R; j++) { const a = i * (R + 1) + j, b = a + R + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
    g.userData.R = R;
    return g;
  }
  // height: altura de la cresta · curl: rizo (0..1.4) · dist: avance desde el origen · lipK: fuerza de la cortina de espuma
  shape(height, curl, dist, lipK = 1) {
    const { W, P, pos, dir, width } = this, sx = -dir.z, sz = dir.x;
    const fx = this.o.x + dir.x * dist, fz = this.o.z + dir.z * dist;
    this.front.set(fx, 0, fz);
    this.height = height;
    const t = this.t;
    const lip = this.lipGeo.attributes.position.array, lr = this.lipGeo.userData.R;
    const sk = this.skirtGeo.attributes.position.array, sr = this.skirtGeo.userData.R;
    for (let i = 0; i <= W; i++) {
      const u = i / W - 0.5;
      // el frente no es recto: unos tramos se adelantan y otros rompen antes
      const lead = Math.sin(u * 9 + dist * 0.35) * 0.5 + Math.sin(u * 23 - t * 1.3) * 0.25;
      const wx = fx + sx * u * width + dir.x * lead, wz = fz + sz * u * width + dir.z * lead;
      const hh = height * (1 - Math.pow(Math.abs(u) * 2, 2.6) * 0.6) * (0.9 + 0.1 * Math.sin(u * 13 + dist * 0.8 + t * 1.5));
      const gy = terrainH(wx, wz);
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j <= P; j++) {
        const v = j / P;
        // perfil: espalda larga con volumen que sube hasta la cresta; el labio se riza hacia delante
        let back = -Math.pow(1 - v, 1.25) * hh * 1.35, up = Math.pow(Math.sin(v * Math.PI * 0.5), 1.4) * hh;
        if (v > 0.62) { const q = (v - 0.62) / 0.38, a = q * Math.PI * 1.25 * curl; back += Math.sin(a) * hh * 0.55; up = hh * (0.94 + 0.06 * (1 - q)) - (1 - Math.cos(a)) * hh * 0.45; }
        const k = (i * (P + 1) + j) * 3;
        pos[k] = wx + dir.x * back; pos[k + 1] = gy + up + 0.03; pos[k + 2] = wz + dir.z * back;
        if (j === P) { cx = pos[k]; cy = pos[k + 1]; cz = pos[k + 2]; }
      }
      // cortina de espuma: sube desde la cresta y se inclina hacia delante
      for (let j = 0; j <= lr; j++) {
        const v = j / lr, k = (i * (lr + 1) + j) * 3, h = v * hh * 0.42 * lipK, f = v * v * hh * 0.25;
        lip[k] = cx + dir.x * f; lip[k + 1] = cy - hh * 0.06 + h; lip[k + 2] = cz + dir.z * f;
      }
      // lengua de espuma por delante, pegada al suelo
      for (let j = 0; j <= sr; j++) {
        const v = j / sr, ahead = -0.6 + v * (2.2 + hh * 0.45), x = wx + dir.x * ahead, z = wz + dir.z * ahead, k = (i * (sr + 1) + j) * 3;
        sk[k] = x; sk[k + 1] = terrainH(x, z) + 0.06; sk[k + 2] = z;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.lipGeo.attributes.position.needsUpdate = true;
    this.lipGeo.computeVertexNormals();
    this.skirtGeo.attributes.position.needsUpdate = true;
    this.lip.visible = lipK > 0.02 && height > 0.6;
    this.skirt.visible = dist > 0.2 && height > 0.5;
  }
  // punto de la cresta en la posición lateral s (-0.5..0.5)
  crestAt(s, out = new THREE.Vector3()) {
    const i = Math.round((s + 0.5) * this.W), k = (i * (this.P + 1) + this.P) * 3;
    return out.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]);
  }
  setOpacity(o) { this.op = o; }
  update(dt, { foam = 1 } = {}) {
    this.t += dt;
    this.mat.uniforms.uT.value = this.t; this.mat.uniforms.uOp.value = 0.94 * this.op; this.mat.uniforms.uFoam.value = foam;
    this.lipMat.uniforms.uT.value = this.t; this.lipMat.uniforms.uOp.value = 0.75 * this.op;
    this.skirtMat.uniforms.uT.value = this.t; this.skirtMat.uniforms.uOp.value = 0.9 * this.op;
  }
  dispose() {
    this.geo.dispose(); this.mat.dispose(); this.lipGeo.dispose(); this.lipMat.dispose(); this.skirtGeo.dispose(); this.skirtMat.dispose();
  }
}

// Columna de agua en espiral alrededor de la Nutria mientras acumula energía
export class WaterVortex {
  constructor(r = 1.5, h = 3.2) {
    this.group = new THREE.Group();
    this.r = r; this.h = h;
    this.geos = []; this.mats = [];
    const mk = (rr, hh, op, sc) => {
      const g = new THREE.CylinderGeometry(rr, rr * 1.25, hh, 40, 6, true);
      g.translate(0, hh / 2, 0);
      const m = cloudMat({ dark: 0x0c5a9a, light: 0x9ff0ff, opacity: op, scale: sc, rise: -1.4, swirl: 0.9, puff: 0.12, rim: 0.6 });
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = 5;
      this.geos.push(g); this.mats.push(m); this.group.add(mesh);
      return mesh;
    };
    this.outer = mk(r, h, 0.62, 3);
    this.inner = mk(r * 0.7, h * 0.85, 0.5, 4.5);
    // anillo de energía en el suelo que se cierra
    const rg = new THREE.RingGeometry(0.92, 1, 64); rg.rotateX(-Math.PI / 2);
    const rm = new THREE.MeshBasicMaterial({ color: 0x8ae8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.ring = new THREE.Mesh(rg, rm); this.geos.push(rg); this.mats.push(rm); this.group.add(this.ring);
    this.t = 0;
  }
  update(dt, k, x, y, z) {
    this.t += dt;
    this.group.position.set(x, y, z);
    const grow = easeOut(clamp01(k * 1.4));
    this.outer.scale.set(1 - k * 0.25, grow, 1 - k * 0.25); this.outer.rotation.y += dt * (3 + k * 6);
    this.inner.scale.set(1 - k * 0.3, grow * 1.05, 1 - k * 0.3); this.inner.rotation.y -= dt * (4 + k * 8);
    for (const m of this.mats) if (m.uniforms) { m.uniforms.uT.value = this.t * 1.5; m.uniforms.uOp.value = (m === this.mats[0] ? 0.62 : 0.5) * clamp01(k * 3); }
    this.ring.scale.setScalar(lerp(5, 1.3, easeOut(k))); this.ring.material.opacity = 0.7 * Math.sin(Math.PI * clamp01(k));
    this.ring.position.y = 0.08;
  }
  dispose() { for (const g of this.geos) g.dispose(); for (const m of this.mats) m.dispose(); }
}

// Charco de espuma que se queda en el suelo tras la rompiente y se va deshaciendo
export class FoamPool {
  constructor(x, z, r, dir) {
    const S = 18, g = new THREE.PlaneGeometry(r * 2, r * 2.6, S, S);
    g.rotateX(-Math.PI / 2);
    const a = g.attributes.position.array, ca = Math.atan2(dir.x, dir.z);
    const cs = Math.cos(ca), sn = Math.sin(ca);
    for (let i = 0; i < a.length; i += 3) {
      const lx = a[i], lz = a[i + 2], wx = x + lx * cs + lz * sn, wz = z - lx * sn + lz * cs;
      a[i] = wx; a[i + 2] = wz; a[i + 1] = terrainH(wx, wz) + 0.07;
    }
    g.computeVertexNormals();
    // uv radial: el borde se desvanece
    const uv = g.attributes.uv.array;
    for (let i = 0; i < uv.length; i += 2) { const dx = uv[i] - 0.5, dy = uv[i + 1] - 0.5, d = Math.min(1, Math.hypot(dx, dy) * 2); uv[i] = 0.5; uv[i + 1] = 0.55 * (1 - d); }
    this.geo = g; this.mat = foamMat(0.85, 0.42);
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.renderOrder = 3; this.mesh.frustumCulled = false;
    this.t = 0;
  }
  update(dt, k) { this.t += dt; this.mat.uniforms.uT.value = this.t * 0.6; this.mat.uniforms.uOp.value = 0.85 * (1 - k); }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

/* ================================================================== */
/*  NUTRIA — MAELSTROM: ESCUDO DE AGUA                                 */
/* ================================================================== */
// Cúpula de agua en remolino que envuelve a la Nutria y la sigue:
//  · se forma desde el suelo en espiral (el agua sube con un frente de espuma)
//  · superficie de agua con corrientes en espiral, cáusticas y brillo de borde
//  · tres corrientes helicoidales que giran a su alrededor y un anillo de espuma en el suelo
//  · cada golpe bloqueado lanza una onda que recorre la cúpula desde el punto de impacto
//  · al final parpadea, y al romperse el agua cae desde arriba y sale en una ola
export class WaterShield {
  constructor(g, p, { radius = 1.9, height = 2.6 } = {}) {
    this.g = g; this.p = p; this.R = radius; this.Hh = height;
    this.t = 0; this.grow = 0; this.fall = 0; this.hitIdx = 0;
    this.group = new THREE.Group();
    g.vfx.group.add(this.group);
    this.geos = []; this.mats = [];
    this.buildDome(); this.buildCurrents(); this.buildFoam();
  }

  buildDome() {
    const R = this.R, Hh = this.Hh;
    const geo = new THREE.SphereGeometry(1, 72, 48);
    this.geos.push(geo);
    const hits = [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 1, 9));
    this.domeU = {
      uT: { value: 0 }, uOp: { value: 0 }, uGrow: { value: 0 }, uFall: { value: 0 }, uWarn: { value: 0 },
      uScale: { value: new THREE.Vector3(R, Hh / 2, R) }, uHits: { value: hits },
      uDeep: { value: new THREE.Color(0x0a4f96) }, uLight: { value: new THREE.Color(0x6fe2ff) }, uFoam: { value: new THREE.Color(0xeafcff) },
    };
    const vs = `uniform float uT; uniform vec3 uScale; uniform vec4 uHits[4];
      varying vec3 vP; varying vec3 vN; varying vec3 vV; varying float vRip;
      void main(){
        vec3 n = normalize(position);
        float th = atan(n.x, n.z);
        float rip = 0.0;
        for (int i = 0; i < 4; i++) { float d = acos(clamp(dot(n, normalize(uHits[i].xyz)), -1.0, 1.0)); float a = uHits[i].w;
          rip += exp(-pow((d - a * 3.2) * 7.0, 2.0)) * max(0.0, 1.0 - a * 1.1); }
        vRip = rip;
        float wave = sin(th * 5.0 + n.y * 6.0 - uT * 4.0) * 0.025 + sin(th * 9.0 - n.y * 4.0 + uT * 3.0) * 0.012;
        vec3 p = n * (1.0 + wave + rip * 0.07);
        vP = n;
        vec4 mv = modelViewMatrix * vec4(p * uScale, 1.0);
        vN = normalize(normalMatrix * (n / uScale));
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`;
    const fs = NOISE + `uniform float uT; uniform float uOp; uniform float uGrow; uniform float uFall; uniform float uWarn;
      uniform vec3 uDeep; uniform vec3 uLight; uniform vec3 uFoam; uniform float uBack;
      varying vec3 vP; varying vec3 vN; varying vec3 vV; varying float vRip;
      void main(){
        float h = vP.y * 0.5 + 0.5;
        float th = atan(vP.x, vP.z) / 6.2831853 + 0.5;
        vec2 sp = vec2(th * 3.0 + h * 1.4 - uT * 0.35, h * 2.2 - uT * 0.25);
        float flow = fbm(sp * vec2(4.0, 3.0));
        float streak = sin((th * 6.0 + h * 3.2 - uT * 1.1) * 6.2831853 + flow * 5.0) * 0.5 + 0.5;
        streak = smoothstep(0.72, 1.0, streak);
        float caus = pow(fbm(sp * 9.0 + flow * 2.0), 3.0) * 2.4;
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float edge = pow(1.0 - facing, 2.2);
        float front = uGrow * 1.12 - 0.06 + (flow - 0.5) * 0.08;
        float top = 1.0 - uFall * 1.15 + (flow - 0.5) * 0.1;
        float vis = smoothstep(front, front - 0.04, h) * smoothstep(top + 0.04, top - 0.02, h);
        float lip = exp(-pow((h - front) * 26.0, 2.0)) * step(uGrow, 0.995) + exp(-pow((h - top) * 22.0, 2.0)) * step(0.001, uFall);
        float flick = 1.0 - uWarn * (0.5 + 0.5 * sin(uT * 26.0));
        vec3 c = mix(uDeep, uLight, clamp(flow * 0.9 + edge * 0.8, 0.0, 1.0));
        c += uFoam * (streak * 0.55 + caus * 0.35 + vRip * 1.4 + lip * 1.2);
        float a = (0.16 + edge * 0.62 + streak * 0.22 + caus * 0.12) * flick + vRip * 0.9 + lip * 0.8;
        a *= vis * uOp * mix(1.0, 0.45, uBack);
        gl_FragColor = vec4(c, clamp(a, 0.0, 0.95));
      }`;
    const mk = (side, back, order) => {
      const m = new THREE.ShaderMaterial({ uniforms: { ...this.domeU, uBack: { value: back } }, vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, side, fog: false });
      this.mats.push(m);
      const mesh = new THREE.Mesh(geo, m); mesh.renderOrder = order; mesh.frustumCulled = false; this.group.add(mesh);
      return mesh;
    };
    this.back = mk(THREE.BackSide, 1, 4);
    this.front = mk(THREE.FrontSide, 0, 6);
  }

  // Tres corrientes helicoidales que rodean la cúpula
  buildCurrents() {
    const R = this.R, Hh = this.Hh, N = 90, turns = 1.35;
    this.curU = { uT: { value: 0 }, uOp: { value: 0 }, uGrow: { value: 0 }, uFall: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.curU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: NOISE + `uniform float uT; uniform float uOp; uniform float uGrow; uniform float uFall; varying vec2 vUv;
        void main(){
          float along = vUv.x, across = abs(vUv.y - 0.5) * 2.0;
          float body = 1.0 - smoothstep(0.35, 1.0, across);
          float pulse = 0.55 + 0.45 * sin((along * 5.0 - uT * 2.2) * 6.2831853);
          float n = vnoise(vec2(along * 30.0 - uT * 6.0, vUv.y * 4.0));
          float vis = smoothstep(uGrow + 0.02, uGrow - 0.06, along) * (uFall > 0.001 ? smoothstep(1.0 - uFall + 0.02, 1.0 - uFall - 0.06, along) : 1.0);
          float tip = smoothstep(0.0, 0.08, along) * (1.0 - smoothstep(0.9, 1.0, along));
          vec3 c = mix(vec3(0.25, 0.75, 1.0), vec3(0.92, 1.0, 1.0), pulse * n);
          gl_FragColor = vec4(c, body * (0.35 + 0.65 * pulse * n) * vis * tip * uOp);
        }`,
    });
    this.mats.push(mat);
    this.currents = new THREE.Group(); this.group.add(this.currents);
    for (let k = 0; k < 3; k++) {
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const s = i / N, y = s * Hh * 0.96, a = k / 3 * TAU + s * turns * TAU;
        const yy = (y / (Hh / 2)) - 1, r = R * 1.04 * Math.sqrt(Math.max(0.06, 1 - yy * yy));
        const w = 0.16 + 0.1 * Math.sin(s * Math.PI);
        const cx = Math.sin(a) * r, cz = Math.cos(a) * r;
        pos.push(cx, y - w * 0.6, cz, cx, y + w * 0.6, cz);
        uv.push(s, 0, s, 1);
        if (i < N) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      this.geos.push(g);
      const m = new THREE.Mesh(g, mat); m.renderOrder = 7; m.frustumCulled = false; this.currents.add(m);
    }
  }

  // Anillo de espuma en el suelo, en la base de la cúpula
  buildFoam() {
    const R = this.R;
    const g = new THREE.RingGeometry(R * 0.7, R * 1.45, 96, 3); g.rotateX(-Math.PI / 2);
    this.geos.push(g);
    this.foamU = { uT: { value: 0 }, uOp: { value: 0 }, uR0: { value: R * 0.7 }, uR1: { value: R * 1.45 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.foamU, transparent: true, depthWrite: false, fog: false,
      vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: NOISE + `uniform float uT; uniform float uOp; uniform float uR0; uniform float uR1; varying vec2 vP;
        void main(){
          float r = length(vP), k = (r - uR0) / (uR1 - uR0);
          float a = atan(vP.x, vP.y);
          float f = fbm(vec2(a * 3.0 + uT * 1.6 - r * 1.5, r * 3.0 - uT * 0.8));
          float foam = smoothstep(0.42, 0.75, f) * (1.0 - smoothstep(0.55, 1.0, k)) * smoothstep(0.0, 0.25, k);
          vec3 c = mix(vec3(0.35, 0.8, 1.0), vec3(1.0), foam);
          gl_FragColor = vec4(c, (foam * 0.85 + 0.12 * (1.0 - k)) * uOp);
        }`,
    });
    this.mats.push(m);
    this.foam = new THREE.Mesh(g, m); this.foam.renderOrder = 3; this.foam.position.y = 0.05; this.group.add(this.foam);
  }

  // Un golpe bloqueado: onda que recorre la cúpula desde el punto de impacto
  impact(from) {
    const P = this.p.pos;
    let dx = 0, dz = 1;
    if (from) { dx = from.x - P.x; dz = from.z - P.z; }
    const l = Math.hypot(dx, dz) || 1;
    const h = this.domeU.uHits.value[this.hitIdx++ % 4];
    h.set(dx / l, 0.15, dz / l, 0);
    const R = this.R, y = P.y + this.Hh * 0.55;
    const x = P.x + (dx / l) * R, z = P.z + (dz / l) * R;
    for (let i = 0; i < 10; i++) this.g.fx.spray(x, y, z, (dx / l) * rnd(1, 4) + rnd(-1.5, 1.5), rnd(1, 4), (dz / l) * rnd(1, 4) + rnd(-1.5, 1.5), 1);
    this.g.fx.sparkle(x, y, z, 0xd8f6ff, 2.4);
  }

  // grow: aparición (0..1) · warn: aviso de fin (0..1) · fall: ruptura (0..1)
  update(dt, { grow = 1, warn = 0, fall = 0 } = {}) {
    this.t += dt;
    const P = this.p.pos, t = this.t;
    this.group.position.set(P.x, P.y, P.z);
    this.grow = grow; this.fall = fall;
    const pop = grow < 1 ? 0.82 + 0.18 * easeOut(grow) + 0.06 * Math.sin(grow * Math.PI) : 1 + 0.015 * Math.sin(t * 3.2);
    const spread = 1 + fall * 0.18;
    const u = this.domeU;
    u.uT.value = t; u.uGrow.value = grow; u.uFall.value = fall; u.uWarn.value = warn;
    u.uOp.value = 1 - fall * 0.4;
    u.uScale.value.set(this.R * pop * spread, (this.Hh / 2) * pop, this.R * pop * spread);
    for (const m of [this.back, this.front]) m.position.y = this.Hh / 2 - 0.12;
    for (const h of u.uHits.value) h.w = Math.min(9, h.w + dt);
    this.curU.uT.value = t; this.curU.uGrow.value = grow; this.curU.uFall.value = fall;
    this.curU.uOp.value = (1 - warn * 0.5 * (0.5 + 0.5 * Math.sin(t * 26))) * (1 - fall);
    this.currents.rotation.y += dt * (2.6 + (1 - grow) * 6);
    this.currents.scale.setScalar(pop * spread);
    this.foamU.uT.value = t; this.foamU.uOp.value = Math.min(1, grow * 1.5) * (1 - fall * 0.5);
    this.foam.scale.setScalar(0.6 + 0.4 * easeOut(grow) + fall * 0.9);
    // gotas que resbalan por la cúpula, y agua que sube en espiral mientras se forma
    const R = this.R * pop;
    if (fall <= 0 && grow > 0.6 && Math.random() < dt * 14) {
      const a = rnd(0, TAU); this.g.fx.spray(P.x + Math.sin(a) * R, P.y + 0.15, P.z + Math.cos(a) * R, Math.sin(a) * 1.2 + Math.cos(a) * 2, rnd(1, 2.5), Math.cos(a) * 1.2 - Math.sin(a) * 2, 0.7);
    }
    if (grow < 1 && Math.random() < dt * 40) {
      const a = t * 9 + rnd(-0.3, 0.3); this.g.fx.spray(P.x + Math.sin(a) * R, P.y + grow * this.Hh, P.z + Math.cos(a) * R, Math.cos(a) * 2, rnd(2, 4), -Math.sin(a) * 2, 0.9);
    }
  }

  dispose() {
    this.g.vfx.group.remove(this.group);
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
