import * as THREE from 'three';
import { rnd, TAU } from './attack.js';
import { Skill, DEG, ease, lerp, clamp, V, boneWorld } from './base.js';
import { glowMat } from './vfx2.js';
import { terrainH } from '../terrain.js';
import { ui } from '../ui.js';
import { Trail } from '../weapons/system.js';

// ACTUALIZACIÓN DE BOTONES: animaciones de VELOCIDAD (botón 1), ARMAS (7), Tornados y Garras de Ámbar, Visión de Lira.
// Números en skills/config.js (HERO_SKILLS / HERO_BUTTONS).

const back = (k) => 1 - Math.pow(1 - k, 3);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

/* ---------- recursos compartidos de los efectos de velocidad (se crean una vez) ---------- */
// NILO: chorro de agua de las botas (cono abierto con franjas que bajan) y burbujas
let JET_GEO = null, BUBBLE_GEO = null, CRYST_GEO = null, SPEED_GEO = null;
const JET_MAT = new THREE.ShaderMaterial({
  uniforms: { uT: { value: 0 }, uK: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `varying vec2 vUv; uniform float uT; uniform float uK;
    void main(){
      float flow = fract(vUv.y * 3.0 + uT * 7.0);
      float streak = 0.5 + 0.5 * sin(vUv.x * 37.7 + vUv.y * 6.0 + uT * 3.0);
      float a = (0.28 + 0.45 * smoothstep(0.55, 1.0, flow)) * (0.55 + 0.45 * streak);
      a *= smoothstep(0.0, 0.18, vUv.y) * (0.6 + 0.4 * vUv.y) * uK;
      vec3 c = mix(vec3(0.2, 0.58, 1.0), vec3(0.9, 0.97, 1.0), 0.15 + 0.6 * flow * streak);
      gl_FragColor = vec4(c * 1.2, a * 0.95);
    }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
});
const BUBBLE_MAT = new THREE.MeshStandardMaterial({ color: 0xd8f4ff, emissive: 0x2a7ab8, emissiveIntensity: 0.35, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.45, depthWrite: false });
const BUBBLES = { list: [] };
// KYRA: textura de hielo cristalino (grietas, escarcha y bordes difuminados) y cristales de escarcha
const CRYST_MAT = new THREE.MeshStandardMaterial({ color: 0xcff4ff, emissive: 0x4ab8ff, emissiveIntensity: 0.45, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.88, flatShading: true });
// ÁMBAR: embudo de tornado (se dobla y ondula con el tiempo) y bandas de viento en espiral que suben
const tornadoGeo = (rt, rb, h) => new THREE.CylinderGeometry(rt, rb, h, 28, 12, true);
function tornadoMat(opacity, swirl, phase, ring = false) {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uO: { value: opacity }, uSw: { value: swirl }, uPh: { value: phase }, uRing: { value: ring ? 1 : 0 } },
    vertexShader: `varying vec2 vUv; uniform float uT; uniform float uPh; uniform float uRing;
      void main(){
        vUv = uv; vec3 p = position;
        if (uRing < 0.5) { float h = uv.y; p.x += sin(h * 3.5 + uT * 2.2 + uPh) * 0.14 * h; p.z += cos(h * 3.0 + uT * 1.8 + uPh) * 0.14 * h; }
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `varying vec2 vUv; uniform float uT; uniform float uO; uniform float uSw; uniform float uPh; uniform float uRing;
      void main(){
        float a;
        if (uRing > 0.5) {
          float d = fract(vUv.x * 7.0 - uT * uSw * 0.25 + uPh);
          a = smoothstep(0.0, 0.12, d) * smoothstep(0.7, 0.3, d) * 0.8;
        } else {
          float band = 0.5 + 0.5 * sin(vUv.x * 18.85 + vUv.y * 9.0 - uT * uSw * 4.0 + uPh);
          float fine = 0.5 + 0.5 * sin(vUv.x * 43.98 - vUv.y * 14.0 - uT * uSw * 6.0);
          a = 0.1 + 0.55 * band * band * band + 0.22 * fine * band;
          a *= smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
        }
        vec3 c = mix(vec3(0.7, 0.85, 0.95), vec3(1.0), clamp(a * 1.4, 0.0, 1.0));
        gl_FragColor = vec4(c, a * uO);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}
let ICE_TEX = null;
const ICE_TILE = 2.2; // metros de pista que cubre la textura del hielo
function iceTexture() {
  if (ICE_TEX) return ICE_TEX;
  const W = 256, H = 128, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // base: hielo azul translúcido, más claro en el centro de la pista y difuminado en los bordes
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, 'rgba(90,170,240,0)'); grd.addColorStop(0.1, 'rgba(70,160,240,0.75)'); grd.addColorStop(0.2, 'rgba(140,205,255,0.7)');
  grd.addColorStop(0.5, 'rgba(195,235,255,0.82)'); grd.addColorStop(0.8, 'rgba(140,205,255,0.7)'); grd.addColorStop(0.9, 'rgba(70,160,240,0.75)'); grd.addColorStop(1, 'rgba(90,170,240,0)');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  // borde de escarcha blanca (contorno definido de la pista)
  g.fillStyle = 'rgba(255,255,255,0.55)';
  for (let x = 0; x < W; x += 2) { g.fillRect(x, H * 0.12 + Math.sin(x * 0.3) * 2, 2, 2); g.fillRect(x, H * 0.86 + Math.cos(x * 0.27) * 2, 2, 2); }
  // marcas de patín (dos líneas brillantes) y grietas cristalinas
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2;
  for (const y of [H * 0.38, H * 0.62]) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + 2); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.2;
  for (let i = 0; i < 26; i++) {
    let x = Math.random() * W, y = H * (0.2 + Math.random() * 0.6);
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 4; s++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 22; g.lineTo(x, y); }
    g.stroke();
  }
  // escarcha: puntitos y estrellitas
  for (let i = 0; i < 120; i++) { const y = H * (0.12 + Math.random() * 0.76); g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.6})`; g.fillRect(Math.random() * W, y, 1.5, 1.5); }
  ICE_TEX = new THREE.CanvasTexture(c);
  ICE_TEX.colorSpace = THREE.SRGBColorSpace;
  ICE_TEX.wrapS = THREE.RepeatWrapping;
  return ICE_TEX;
}

/* ====================================================================== */
/*  BOTÓN 1 — VELOCIDAD: capa de animación mientras dura el impulso        */
/*  (la velocidad la da el poder base del héroe en player.js)              */
/* ====================================================================== */
export class SpeedFxSkill extends Skill {
  static background = true;
  begin() {
    this.hero = this.g.hero.id;
    this.idle = 0;
    this.stepT = 0;
    this.trailT = 0;
    this.path = [];            // posiciones recientes (estelas que crecen con la velocidad)
    this.whirls = [];          // remolinos de arena del fénec
    this.last = this.p.pos.clone();
    this.prevFacing = this.p.facing;
    this.start();
    return true;
  }
  build() { return [{ name: 'velocidad', dur: 9999, enter: this.enter, tick: this.tick }]; }
  enter() {
    const p = this.p, c = p.pos;
    const h = this.hero;
    // arranque: cada héroe a su manera
    if (h === 'ambar') { this.vfx.ring(c.x, null, c.z, { r0: 0.4, r1: 4.5, dur: 0.45, color: 0xffffff }); this.sfx('wind'); this.g.chase.fovKick = 12; } // estampido supersónico
    else if (h === 'jago') { this.shake(0.25); this.vfx.dust(c.x, c.y + 0.1, c.z, 10, 2); this.sfx('rumble'); }
    else if (h === 'kairo') { this.sfx('eruption'); }
    else if (h === 'halley') { this.vfx.sand(c.x, c.y + 0.2, c.z, 4); this.sfx('wind'); }
    else if (h === 'nilo') { this.vfx.splash(c.x, c.y + 0.2, c.z, 18, 1.2); this.sfx('wave'); }
    else if (h === 'kyra') { this.vfx.ice(c.x, c.y + 0.3, c.z, 6); this.sfx('chime'); }
    else if (h === 'lira') { this.vfx.leaves(c.x, c.y + 0.3, c.z, [0x6ad04a, 0x3a9a3a, 0xa0e070], 10); this.sfx('flap'); }
  }
  get active() { const p = this.p; return p.boostT > 0 || p.dashT > 0 || (p.surfT > 0 && p.surfing); }
  tick(dt) {
    const p = this.p;
    if (!this.active) { this.idle += dt; if (this.idle > 0.4) { this.endStage(); return; } } else this.idle = 0;
    const sp = Math.hypot(p.vx, p.vz), ref = p.stats.speed * 1.6;
    const k = clamp(sp / ref, 0, 1.3) * (this.active ? 1 : 0.4); // intensidad según lo rápido que va
    const bx = sp > 0.1 ? -p.vx / sp : -Math.sin(p.facing), bz = sp > 0.1 ? -p.vz / sp : -Math.cos(p.facing); // hacia atrás
    this.path.unshift(p.pos.clone());
    if (this.path.length > 40) this.path.pop();
    const turn = (((p.facing - this.prevFacing + Math.PI) % TAU) + TAU) % TAU - Math.PI;
    this.prevFacing = p.facing;
    this.stepT -= dt * (0.8 + sp * 0.35);
    const step = this.stepT <= 0;
    if (step) this.stepT = 1;
    const fn = this[this.hero];
    if (fn) fn.call(this, dt, k, bx, bz, sp, step, turn);
    this.whirls = this.whirls.filter((w) => this.tickWhirl(w, dt));
    if (this.active && k > 0.6) this.g.chase.fovKick = Math.max(this.g.chase.fovKick, 5 * k);
  }
  feet(off = 0, bx = 0, bz = 0) { const p = this.p; return V(p.pos.x + bx * off, p.pos.y + 0.08, p.pos.z + bz * off); }

  // JAGLION — Embestida pétrea: peso, vibración del suelo y fragmentos de roca tras los pies
  jago(dt, k, bx, bz, sp, step) {
    const pose = this.pose;
    pose.rx = Math.max(pose.rx, 0.3 * k); pose.sy = 1 - 0.04 * k;
    if (step && this.p.grounded && sp > 2) {
      const f = this.feet(0.4, bx, bz);
      this.shake(0.07 + 0.08 * k);
      this.vfx.ring(f.x, null, f.z, { r0: 0.2, r1: 1.4 + k, dur: 0.35, color: 0xb89a70, opacity: 0.55, additive: false });
      for (let i = 0; i < 3; i++) this.g.fx.rock(f.x, f.y + 0.1, f.z);
      this.g.fx.dustPuff(f.x, f.y, f.z, 1.6);
      this.sfx('roll');
    }
    if (Math.random() < 0.5 * k) { const f = this.feet(0.6, bx, bz); this.g.fx.dustPuff(f.x + rnd(-0.3, 0.3), f.y, f.z + rnd(-0.3, 0.3), 1.2); }
  }
  // KAIRO — Propulsión de fuego: llamaradas en los pies, se inclina más y la estela se alarga al acelerar
  kairo(dt, k, bx, bz) {
    const pose = this.pose, fx = this.g.fx;
    pose.rx = Math.max(pose.rx, 0.12 + 0.5 * k * k);
    const n = 1 + Math.floor(2.5 * k);
    for (let i = 0; i < n; i++) { const f = this.feet(0.3, bx, bz); fx.flame(f.x + rnd(-0.2, 0.2), f.y + 0.15, f.z + rnd(-0.2, 0.2), 0.55 + 0.45 * k, 0.15); }
    // estela tipo cometa: tanto más larga cuanto más rápido
    const len = Math.floor(4 + 30 * k);
    for (let i = 4; i < Math.min(len, this.path.length); i += 3) {
      if (Math.random() > 0.3) continue;
      const q = this.path[i], s = 1 - i / len;
      fx.flame(q.x, q.y + 0.25 + 0.4 * s, q.z, 0.35 + 0.55 * s * k, 0.1);
      if (Math.random() < 0.3) fx.ember(q.x, q.y + 0.3, q.z, 1);
    }
  }
  // HALLEY — Remolino de arena: se inclina, gira, se vuelve arena en parte y deja remolinos que se deshacen
  halley(dt, k, bx, bz, sp) {
    const pose = this.pose, p = this.p, fx = this.g.fx;
    pose.rx = Math.max(pose.rx, 0.3 * k); pose.spin = Math.sin(this.t * 7) * 0.4 * k; pose.rz = Math.sin(this.t * 7 + 1) * 0.12 * k;
    for (let i = 0; i < 2; i++) fx.mist(p.pos.x + rnd(-0.3, 0.3), p.pos.y + rnd(0.1, p.H), p.pos.z + rnd(-0.3, 0.3), 0xe0bd7a, 0.6 + 0.6 * k); // el cuerpo se deshace en arena
    this.trailT -= dt;
    if (this.trailT <= 0 && sp > 2) { this.trailT = 0.14; const f = this.feet(0.6, bx, bz); this.whirls.push({ x: f.x, y: f.y, z: f.z, t: 0, life: 1.3, r: 0.7 + 0.5 * k, a: rnd(0, TAU) }); }
  }
  tickWhirl(w, dt) { // remolino que gira y se va apagando como la arena de un reloj
    w.t += dt;
    const k = w.t / w.life;
    if (k >= 1) return false;
    w.a += dt * 10;
    const r = w.r * (1 - k * 0.7), fx = this.g.fx;
    for (let i = 0; i < 2; i++) {
      const a = w.a + i * Math.PI, h = (1 - k) * 1.3 * (0.3 + 0.7 * ((w.t * 3 + i * 0.5) % 1));
      fx.sparkle(w.x + Math.cos(a) * r, w.y + h, w.z + Math.sin(a) * r, 0xe8c070, 0.3);
    }
    if (Math.random() < 0.3) fx.dustPuff(w.x, w.y, w.z, 0.8 * (1 - k));
    return true;
  }
  // NILO — Botas propulsoras tipo skyboard: se eleva un poco sobre dos chorros de agua que salen de las botas,
  // se inclina en las curvas y deja una estela de burbujas que van apareciendo a su paso.
  // (Solo visual: la altura es la pose del modelo; la física y la velocidad siguen siendo las del poder base.)
  nilo(dt, k, bx, bz, sp, step, turn) {
    const pose = this.pose, p = this.p, fx = this.g.fx;
    const on = this.active ? 1 : 0;
    // elevación suave que acompaña a la velocidad: 18-28 cm, con un leve vaivén sobre los chorros (no es un vuelo)
    this.lift = damp(this.lift || 0, on * (0.18 + 0.1 * Math.min(1, k)), on ? 5 : 7, dt);
    const lift = this.lift, bob = Math.sin(this.t * 9) * 0.022 * (lift / 0.28);
    pose.dy = lift + bob;
    pose.rx = Math.max(pose.rx, 0.18 * k);
    this.carve = lerp(this.carve || 0, clamp(-turn * 14, -0.3, 0.3) * k, Math.min(1, dt * 7));
    pose.rz = this.carve; // se inclina en las curvas como sobre una tabla
    const jets = this.jets || (this.jets = this.makeJets());
    const gy = p.floorY(p.pos.x, p.pos.z, p.pos.y + 0.5);
    const feet = ['foot_L', 'foot_R'].map((n, i) => {
      const b = boneWorld(this, n);
      if (b) return b;
      const s = i ? -0.14 : 0.14; // modelo de reserva: a cada lado
      return V(p.pos.x + Math.cos(p.facing) * s, p.pos.y + pose.dy + 0.05, p.pos.z - Math.sin(p.facing) * s);
    });
    JET_MAT.uniforms.uT.value = this.t;
    JET_MAT.uniforms.uK.value = Math.min(1, lift / 0.12);
    feet.forEach((f, i) => {
      const j = jets[i], top = f.y - 0.04, h = Math.max(0.02, top - gy);
      j.position.set(f.x + bx * 0.04, top, f.z + bz * 0.04);
      j.scale.set(1, h, 1);
      j.rotation.set(-bz * 0.25 * k, 0, bx * 0.25 * k); // el chorro se inclina hacia atrás al avanzar
      j.visible = lift > 0.02;
      // gotas que salen disparadas hacia abajo y salpicaduras en el suelo
      if (lift > 0.05) {
        fx.spray(f.x + rnd(-0.05, 0.05), top - 0.05, f.z + rnd(-0.05, 0.05), bx * 1.5 + rnd(-0.4, 0.4), -6 - 3 * k, bz * 1.5 + rnd(-0.4, 0.4), 0.8);
        if (Math.random() < 0.6) fx.spray(f.x, gy + 0.04, f.z, bx * 2.5 + rnd(-1.2, 1.2), rnd(0.5, 1.6), bz * 2.5 + rnd(-1.2, 1.2), 0.7);
      }
    });
    // ondas en el suelo bajo las botas
    this.rippleT = (this.rippleT || 0) - dt;
    if (lift > 0.08 && this.rippleT <= 0) {
      this.rippleT = 0.16;
      this.vfx.ring(p.pos.x, gy + 0.03, p.pos.z, { r0: 0.15, r1: 0.9 + 0.4 * k, dur: 0.45, color: 0x6ac0ff, opacity: 0.4 });
    }
    if (lift > 0.05 && Math.random() < 0.25) { const f = this.feet(0.6, bx, bz); fx.mist(f.x, gy + 0.08, f.z, 0xf4fbff, 0.45); } // espuma
    // estela de burbujas: aparecen poco a poco detrás de Nilo, más cuanto más rápido va
    this.bubbleT = (this.bubbleT || 0) - dt * (0.5 + Math.min(1.2, k));
    if (on && sp > 1 && this.bubbleT <= 0) {
      this.bubbleT = 0.05;
      const f = feet[Math.random() < 0.5 ? 0 : 1];
      this.bubble(f.x + bx * 0.25 + rnd(-0.12, 0.12), lerp(gy + 0.05, f.y, Math.random()), f.z + bz * 0.25 + rnd(-0.12, 0.12), 0.025 + Math.random() * 0.04 * (0.6 + k));
    }
  }
  makeJets() {
    if (!JET_GEO) {
      JET_GEO = new THREE.CylinderGeometry(0.045, 0.13, 1, 14, 1, true);
      JET_GEO.translate(0, -0.5, 0); // arriba = la bota, abajo = el suelo
    }
    return [0, 1].map(() => { const m = new THREE.Mesh(JET_GEO, JET_MAT); m.renderOrder = 4; m.frustumCulled = false; this.prop(m); return m; });
  }
  bubble(x, y, z, r) {
    BUBBLES.list = BUBBLES.list.filter((q) => !q.dead && q.t < q.life);
    if (BUBBLES.list.length > 70) return; // tope de burbujas vivas
    if (!BUBBLE_GEO) BUBBLE_GEO = new THREE.SphereGeometry(1, 12, 8);
    const m = new THREE.Mesh(BUBBLE_GEO, BUBBLE_MAT);
    m.position.set(x, y, z);
    m.scale.setScalar(0.001);
    const life = 0.9 + Math.random() * 0.8, rise = 0.25 + Math.random() * 0.5, ph = Math.random() * TAU, fx = this.g.fx;
    const it = this.vfx.add(m, life, (q, dt) => {
      const t = q.t, u = t / life;
      m.position.y += rise * dt;
      m.position.x += Math.sin(t * 7 + ph) * 0.15 * dt;
      m.position.z += Math.cos(t * 6 + ph) * 0.15 * dt;
      const grow = Math.min(1, t / 0.15), pop = u > 0.88 ? 1 + (u - 0.88) * 3 : 1; // crece al nacer y se hincha antes de explotar
      m.scale.setScalar(r * grow * pop);
      if (u >= 0.985 && !q.popped) { q.popped = true; fx.sparkle(m.position.x, m.position.y, m.position.z, 0xdff4ff, 0.3); }
    });
    BUBBLES.list.push(it);
  }
  // KYRA — Deslizamiento sobre hielo: una pista de hielo cristalino que se va formando bajo sus pies, con
  // cristales que brotan y se funden, destellos y vaho frío. Se inclina en las curvas como una esquiadora.
  kyra(dt, k, bx, bz, sp, step, turn) {
    const pose = this.pose, p = this.p, fx = this.g.fx;
    // PATINAJE. Todo se suaviza (sin saltos de pose) y sigue a la velocidad real:
    //  · ARRANQUE: se agacha, apoya el patín y empuja fuerte (estallido de nieve); se inclina más mientras acelera
    //  · DESLIZAMIENTO: zancadas largas; el peso se queda en cada patín un momento (glide) antes de cambiar de lado
    //  · VELOCIDAD: líneas de viento helado que pasan junto a ella y nieve que levanta cada impulso
    const on = this.active ? 1 : 0;
    if (on && p.model) p.model.skate = Math.min(1, Math.max(p.model.skate || 0, k)); // piernas: zancadas largas y lentas
    this.skT = on ? (this.skT || 0) + dt : 0;
    const accel = p.boostT > 0 ? 1 - Math.min(1, p.boostAge / Math.max(0.2, (p.boostRamp || 0.6) * 1.4)) : 0; // 1 al arrancar → 0 a toda velocidad
    if (on && !this.launched && sp > 0.5) { // empujón inicial
      this.launched = true;
      const f = this.feet(0.1, bx, bz);
      for (let i = 0; i < 14; i++) fx.spray(f.x, f.y + 0.08, f.z, bx * rnd(2, 4.5) + rnd(-1.2, 1.2), rnd(0.6, 2.4), bz * rnd(2, 4.5) + rnd(-1.2, 1.2), 0.7);
      for (let i = 0; i < 5; i++) fx.iceShard(f.x, f.y + 0.15, f.z, 0.6);
      this.vfx.ring(f.x, null, f.z, { r0: 0.2, r1: 1.6, dur: 0.45, color: 0xd8f4ff, opacity: 0.55 });
    }
    this.skPh = (this.skPh || 0) + dt * (1.0 + sp * 0.11);   // zancadas más largas cuanto más rápida va
    const s0 = Math.sin(this.skPh * Math.PI), sw = Math.sign(s0) * Math.pow(Math.abs(s0), 0.55); // se mantiene en cada patín
    const crouch = Math.max(accel, this.skT < 0.35 ? 1 - this.skT / 0.35 : 0);
    const turnTo = clamp(-turn * 18, -0.45, 0.45) * k;
    const sm = this.skSm || (this.skSm = { rx: 0, rz: 0, spin: 0, sy: 1 });
    const kk = Math.min(1, dt * 9);
    sm.rx = lerp(sm.rx, (0.16 + 0.16 * k + 0.16 * crouch) * on + (on ? 0 : sm.rx * 0.5), kk);
    sm.rz = lerp(sm.rz, (turnTo + sw * 0.15 * k) * on, kk);
    sm.spin = lerp(sm.spin, sw * 0.1 * k * on, kk);
    sm.sy = lerp(sm.sy, 1 - 0.06 * crouch * on, kk);
    pose.rx = Math.max(pose.rx, sm.rx); pose.rz = sm.rz; pose.spin = sm.spin; pose.sy = Math.min(pose.sy, sm.sy);
    this.carve = sm.rz;
    // en cada impulso: el patín empuja hacia fuera y levanta nieve y esquirlas de hielo hacia atrás
    const side = sw > 0 ? 1 : -1;
    if (this.lastSide !== side && sp > 2) {
      this.lastSide = side;
      const f = this.feet(0.15, bx, bz), ox = -bz * side * 0.35, oz = bx * side * 0.35, n = 4 + Math.round(4 * k);
      for (let i = 0; i < n; i++) fx.spray(f.x + ox, f.y + 0.08, f.z + oz, (bx * 2.4 - bz * side * 1.8) + rnd(-0.6, 0.6), rnd(0.8, 2.2), (bz * 2.4 + bx * side * 1.8) + rnd(-0.6, 0.6), 0.6);
      for (let i = 0; i < 3; i++) fx.iceShard(f.x + ox, f.y + 0.12, f.z + oz, 0.45);
      fx.mist(f.x + ox, f.y + 0.1, f.z + oz, 0xffffff, 0.9);
      this.vfx.ring(f.x + ox, null, f.z + oz, { r0: 0.1, r1: 0.7, dur: 0.35, color: 0xd8f4ff, opacity: 0.45 });
    }
    // líneas de viento helado (sensación de velocidad), más cuanto más rápido va
    this.lineT = (this.lineT || 0) - dt;
    if (on && k > 0.45 && this.lineT <= 0) { this.lineT = 0.05 / k; this.speedLine(bx, bz, k); }
    this.trailT -= dt;
    const moved = Math.hypot(p.pos.x - this.last.x, p.pos.z - this.last.z);
    if (this.trailT <= 0 && sp > 1.5 && moved > 0.25) {
      this.trailT = 0.05;
      if (p.grounded) this.iceSegment(this.last, p.pos, 0.95 + 0.25 * Math.min(1, k)); else this.iceEdge = null; // en el aire no deja hielo
      // destellos sobre el hielo recién formado
      for (let i = 0; i < 2; i++) { const u = Math.random(); fx.sparkle(lerp(this.last.x, p.pos.x, u) + rnd(-0.35, 0.35), p.pos.y + 0.06, lerp(this.last.z, p.pos.z, u) + rnd(-0.35, 0.35), Math.random() < 0.5 ? 0xffffff : 0xa8e8ff, 0.35); }
      this.last.copy(p.pos);
    }
    // cristales de escarcha que brotan a los lados de la pista y se funden
    this.crystT = (this.crystT || 0) - dt;
    if (this.crystT <= 0 && sp > 2) {
      this.crystT = 0.13;
      const s = Math.random() < 0.5 ? -1 : 1, f = this.feet(0.5, bx, bz);
      this.crystal(f.x - bz * s * 0.45, p.floorY(f.x, f.z, p.pos.y + 0.5), f.z + bx * s * 0.45, 0.6 + 0.4 * k);
    }
    // el hielo de atrás sigue brillando un momento (rastro centelleante)
    if (this.path.length > 12 && Math.random() < 0.5) { const q = this.path[8 + Math.floor(Math.random() * (this.path.length - 8))]; fx.sparkle(q.x + rnd(-0.4, 0.4), q.y + 0.05, q.z + rnd(-0.4, 0.4), 0xe8f8ff, 0.2); }
    // nieve en polvo y vaho frío en los patines
    for (let i = 0; i < 2; i++) { const s = (i ? 1 : -1) * 0.4, f = this.feet(0.3, bx, bz); fx.mist(f.x - bz * s, f.y + 0.08, f.z + bx * s, 0xf2fbff, 0.35 + 0.35 * k); }
    if (Math.random() < 0.35 * k) { const f = this.feet(0.4, bx, bz); fx.iceShard(f.x, f.y + 0.15, f.z, 0.4); }
    if (Math.abs(this.carve) > 0.2 && Math.random() < 0.5) { const f = this.feet(0.2, bx, bz), s = Math.sign(this.carve); fx.spray(f.x, f.y + 0.1, f.z, -bz * s * 2, 1.5, bx * s * 2, 0.7); } // nieve que salta en las curvas
  }
  // línea de viento helado: trazo fino que pasa junto a la zorra hacia atrás y se desvanece (0,28 s)
  speedLine(bx, bz, k) {
    const p = this.p;
    if (!SPEED_GEO) { SPEED_GEO = new THREE.PlaneGeometry(1, 0.025); SPEED_GEO.translate(0.5, 0, 0); }
    const m = new THREE.Mesh(SPEED_GEO, new THREE.MeshBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.userData.own = true;
    const sx = -bz, sz = bx, off = rnd(0.35, 0.9) * (Math.random() < 0.5 ? -1 : 1);
    const x0 = p.pos.x - bx * 0.4 + sx * off, y0 = p.pos.y + rnd(0.15, p.H * 0.95), z0 = p.pos.z - bz * 0.4 + sz * off;
    m.position.set(x0, y0, z0);
    m.rotation.order = 'YXZ'; // a lo largo de la marcha (hacia atrás), girada sobre su eje para que se vea desde cualquier lado
    m.rotation.set(rnd(0, Math.PI), Math.atan2(-bz, bx), rnd(-0.08, 0.08));
    const len = 0.8 + 1.4 * k, life = 0.28;
    this.vfx.add(m, life, (it) => {
      const u = it.t / life;
      m.scale.set(len * (0.4 + 0.6 * Math.min(1, u * 3)), 1, 1);
      m.position.set(x0 + bx * u * 2.2, y0, z0 + bz * u * 2.2);
      m.material.opacity = 0.55 * Math.sin(Math.min(1, u) * Math.PI);
    });
  }
  // tramo de pista de hielo entre a y b: aparece estrechito y se ensancha (se va formando), luego se derrite
  // Es una cinta continua: cada tramo empieza exactamente donde acabó el anterior (también en las curvas) y la
  // textura sigue la distancia recorrida, así que las grietas y marcas no se cortan entre tramos.
  iceSegment(a, b, width) {
    const p = this.p, dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 0.01;
    const nx = -dz / len, nz = dx / len; // normal (a la izquierda del avance)
    // borde inicial: el mismo que el borde final del tramo anterior si es contiguo (si no, perpendicular)
    const prev = this.iceEdge && Math.hypot(this.iceEdge.x - a.x, this.iceEdge.z - a.z) < 0.05 ? this.iceEdge : null;
    let ax = nx, az = nz;
    if (prev) { ax = prev.nx; az = prev.nz; } // mismo borde exacto: la cinta no deja huecos en las curvas
    this.iceEdge = { x: b.x, z: b.z, nx, nz };
    const ya = p.floorY(a.x, a.z, p.pos.y + 0.5) + 0.035, yb = p.floorY(b.x, b.z, p.pos.y + 0.5) + 0.035;
    if (Math.abs(ya - yb) > 0.25) { this.iceEdge = null; return; } // escalón (caja, bordillo): la pista se corta, nunca sube en vertical
    const u0 = this.iceU || 0, u1 = u0 + len / ICE_TILE;
    this.iceU = u1 % 64;
    const pos = new Float32Array(12), uv = new Float32Array([u0, 0, u0, 1, u1, 0, u1, 1]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    const full = width * 0.5;
    const setW = (hw) => { // ancho actual: el borde final crece al formarse; el inicial ya coincide con el tramo anterior
      const ha = prev ? full : hw;
      pos.set([a.x - ax * ha, ya, a.z - az * ha, a.x + ax * ha, ya, a.z + az * ha, b.x - nx * hw, yb, b.z - nz * hw, b.x + nx * hw, yb, b.z + nz * hw]);
      geo.attributes.position.needsUpdate = true;
    };
    setW(full * 0.25);
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: iceTexture(), color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.userData.own = true;
    m.renderOrder = 3;
    const life = 2.4;
    this.vfx.add(m, life, (it) => {
      const t = it.t, form = Math.min(1, t / 0.2), e = 1 - Math.pow(1 - form, 3);
      if (form < 1 || !it.full) { setW(full * (0.25 + 0.75 * e)); it.full = form >= 1; }
      const fade = t > life * 0.55 ? 1 - (t - life * 0.55) / (life * 0.45) : 1;
      m.material.opacity = 0.85 * e * fade;
      if (t >= life) geo.dispose(); // último fotograma: se libera su geometría
    });
  }
  crystal(x, y, z, k) {
    if (!CRYST_GEO) CRYST_GEO = new THREE.ConeGeometry(0.05, 0.28, 5);
    const g = new THREE.Group();
    const n = 2 + Math.floor(Math.random() * 2), parts = [];
    for (let i = 0; i < n; i++) {
      const c = new THREE.Mesh(CRYST_GEO, CRYST_MAT);
      c.position.set(rnd(-0.08, 0.08), 0, rnd(-0.08, 0.08));
      c.rotation.set(rnd(-0.5, 0.5), rnd(0, TAU), rnd(-0.5, 0.5));
      const s = (0.6 + Math.random() * 0.7) * k;
      parts.push({ c, s });
      g.add(c);
    }
    g.position.set(x, y, z);
    const life = 1.3;
    this.vfx.add(g, life, (it) => {
      const t = it.t, grow = t < 0.18 ? back(t / 0.18) : t > life - 0.5 ? (life - t) / 0.5 : 1;
      for (const q of parts) { q.c.scale.setScalar(Math.max(0.001, q.s * grow)); q.c.position.y = 0.12 * q.s * grow; }
    });
  }
  // LIRA — Raíces impulsoras: raíces y brotes que aparecen y desaparecen bajo sus pasos
  lira(dt, k, bx, bz, sp, step) {
    const pose = this.pose, fx = this.g.fx;
    pose.rx = Math.max(pose.rx, 0.22 * k);
    if (step && sp > 1.5) {
      const f = this.feet(0.25, bx, bz);
      this.root(f, bx, bz, k);
      fx.dustPuff(f.x, f.y, f.z, 0.8);
    }
    if (Math.random() < 0.5) { const f = this.feet(0.5, bx, bz); fx.sparkle(f.x + rnd(-0.3, 0.3), f.y + 0.2, f.z + rnd(-0.3, 0.3), Math.random() < 0.5 ? 0x7ae05a : 0xb8f080, 0.6); }
  }
  root(f, bx, bz, k) { // raíz curva que brota inclinada hacia atrás (empuja a Lira) y se vuelve a hundir
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 0.9 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x5ac040, roughness: 0.7 });
    const segs = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(this.vfx.cylGeo, mat);
      m.scale.set(0.06 - i * 0.012, 0.32, 0.06 - i * 0.012);
      g.add(m); segs.push(m);
    }
    const sprout = new THREE.Mesh(this.vfx.sphGeo, leaf);
    sprout.scale.set(0.12, 0.05, 0.08);
    g.add(sprout);
    g.traverse((o) => { o.userData.own = true; });
    g.position.set(f.x, f.y - 0.05, f.z);
    g.rotation.y = Math.atan2(bx, bz) + rnd(-0.5, 0.5);
    const life = 0.75, lean = 0.7 + 0.3 * k;
    this.vfx.add(g, life, (it) => {
      const q = it.t / life, h = q < 0.3 ? back(q / 0.3) : 1 - (q - 0.3) / 0.7;
      let x = 0, y = 0;
      segs.forEach((m, i) => { const a = lean * (i + 1) * 0.35; m.position.set(0, y + 0.16 * Math.cos(a) * h, x + 0.16 * Math.sin(a) * h); m.rotation.x = a; m.scale.y = 0.32 * h; y += 0.32 * Math.cos(a) * h; x += 0.32 * Math.sin(a) * h; });
      sprout.position.set(0, y, x); sprout.scale.setScalar(0.12 * h); sprout.scale.y = 0.05 * h;
    });
  }
  // ÁMBAR — Carrera supersónica: propulsores de aire en los pies, nubecillas y remolinos
  ambar(dt, k, bx, bz, sp) {
    const pose = this.pose, p = this.p, fx = this.g.fx;
    pose.rx = Math.max(pose.rx, 0.38 * k);
    for (let i = 0; i < 2; i++) { const f = this.feet(0.25, bx, bz); fx.mist(f.x + rnd(-0.2, 0.2), f.y + 0.15, f.z + rnd(-0.2, 0.2), 0xf0f8ff, 0.6 + 0.7 * k); }
    if (Math.random() < 0.35 * k) { const f = this.feet(1.2, bx, bz); fx.smokePuff(f.x, f.y + rnd(0.2, 1), f.z, 0.8, 0xffffff); } // nubecillas
    this.trailT -= dt;
    if (this.trailT <= 0 && sp > 3) { // remolinos de viento a su paso
      this.trailT = 0.18;
      const f = this.feet(1, bx, bz);
      this.vfx.ring(f.x, f.y + 0.4 + Math.random() * 0.6, f.z, { r0: 0.2, r1: 1.2 + k, dur: 0.4, color: 0xe8f6ff, opacity: 0.5 });
    }
    if (k > 0.9 && Math.random() < 0.2) this.vfx.ring(p.pos.x, p.pos.y + p.H * 0.5, p.pos.z, { r0: 0.3, r1: 1.6, dur: 0.25, color: 0xffffff, opacity: 0.35 }); // barrera del sonido
  }
}

/* ====================================================================== */
/*  ARMAS                                                                  */
/* ====================================================================== */
class WeaponSkill extends Skill {
  aim(range, coneDeg = 45) {
    const p = this.p, t = this.combat.aimTarget(p.pos.x, p.pos.z, p.facing, coneDeg * DEG, range);
    if (t) this.face(t.pos.x, t.pos.z);
    return t;
  }
  get W() { return this.g.weapons; }
  // Saca el arma (si estaba guardada), decide qué movimiento del combo toca y desde qué postura parte el brazo
  draw() {
    const W = this.W;
    this.drawn = W ? W.equip() : false;
    this.step = W ? W.nextStep(this.g.hero.id) : 0;
    this.mul = [1, 0.9, 1.5][this.step];
    this.cdFactor = this.step < 2 ? 0.25 : 1;   // golpes 1 y 2: se pueden encadenar enseguida; el 3.º cierra el combo
    this.armPart = -1;
    const pt = W && W.cur && W.cur.parts[0];
    this.side = pt ? pt.side : -1;
    this.armCur = pt && pt.arm ? { ...pt.arm } : { x: 0, y: 0, f: 0, w: 0, r: 0 };
    this.poseCur = { spin: 0, rx: 0, dy: 0, sy: 1 };
    this.chainReady = false;
    return this.drawn;
  }
  get guard() { return (this.W && this.W.cur && this.W.cur.W.guard) || { x: 0, y: 0, f: 0, w: 0, r: 0 }; }
  /* Etapa de animación: el brazo (x alzar, y cruzar, f codo, w muñeca, r giro del antebrazo) y el cuerpo
     (spin, rx, dy, sy) van desde donde estaban hasta la postura indicada, con la curva `easeFn`.
     Así cada movimiento enlaza con el anterior sin cortes (también entre golpes de un combo). */
  stage(name, dur, to, { spin, rx, dy, sy, easeFn = ease, enter, tick, exit, recover = false } = {}) {
    let from, pf;
    return {
      name, dur,
      enter: () => {
        from = { ...this.armCur };
        pf = { ...this.poseCur };
        if (recover) this.chainReady = true; // desde aquí se puede encadenar el siguiente golpe
        if (enter) enter.call(this);
      },
      tick: (dt, k) => {
        const e = easeFn(k), a = {};
        for (const key of ['x', 'y', 'f', 'w', 'r']) a[key] = lerp(from[key] || 0, to[key] ?? from[key] ?? 0, e);
        this.armCur = a;
        if (this.W) this.W.setArm(a, this.armPart);
        const P = this.pose, pc = this.poseCur;
        pc.spin = spin !== undefined ? lerp(pf.spin, spin, e) : pf.spin * (1 - e);
        pc.rx = rx !== undefined ? lerp(pf.rx, rx, e) : pf.rx * (1 - e);
        pc.dy = dy !== undefined ? lerp(pf.dy, dy, e) : pf.dy * (1 - e);
        pc.sy = sy !== undefined ? lerp(pf.sy, sy, e) : lerp(pf.sy, 1, e);
        P.spin = pc.spin; P.rx = pc.rx; P.dy = pc.dy; P.sy = pc.sy;
        if (tick) tick.call(this, dt, k);
      },
      exit: exit ? () => exit.call(this) : undefined,
    };
  }
  // vuelta a la guardia (recuperación): se puede encadenar el siguiente golpe del combo
  recover(dur) { return this.stage('recuperacion', dur, this.guard, { spin: 0, rx: 0, dy: 0, sy: 1, recover: true }); }
  tipPos(i = 0) { return (this.W && this.W.partTip(i)) || this.center(0.6); }
  impactAt(t, k = 1) { if (this.W) this.W.impact(t.pos.x, t.pos.y + (t.heavy ? t.S.height * 0.45 : 0.7), t.pos.z, k); }
  lunge(v, dt) { const f = this.fwd; this.p.vx += f.x * v * dt * 8; this.p.vz += f.z * v * dt * 8; }
  // tajo en arco: media luna brillante delante del héroe (katana, hacha, garras, guadaña)
  crescent(y, { r = 3, arc = 120, color = 0xffffff, life = 0.25, tilt = 0, width = 0.35, vertical = false } = {}) {
    const p = this.p;
    const geo = new THREE.RingGeometry(r * (1 - width), r, 32, 1, -arc * DEG / 2, arc * DEG);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat);
    m.userData.own = true;
    const g = new THREE.Group();
    g.add(m);
    g.position.set(p.pos.x, y, p.pos.z);
    if (vertical) { m.rotation.y = Math.PI / 2; g.rotation.y = p.facing; m.rotation.z = Math.PI / 2 + tilt; }
    else { m.rotation.x = -Math.PI / 2 + tilt; g.rotation.y = p.facing - Math.PI / 2; m.rotation.z = Math.PI / 2; }
    return this.vfx.add(g, life, (it) => { const k = it.t / life; mat.opacity = 0.55 * (1 - k) * (1 - k); m.scale.setScalar(0.85 + 0.25 * k); if (it.t >= life - 0.001) geo.dispose(); }); // se desvanece rápido: no tapa la escena
  }
  hitArc(range, arcDeg, dmg, force, extra) {
    const p = this.p;
    let n = 0;
    for (const t of this.combat.inCone(p.pos.x, p.pos.z, p.facing, (arcDeg / 2) * DEG, range)) {
      this.hit(t, dmg);
      const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z);
      this.combat.push(t, dx, dz, force);
      if (extra) extra(t);
      n++;
    }
    return n;
  }
  hitRing(radius, dmg, force, extra) {
    const p = this.p;
    let n = 0;
    for (const t of this.combat.inCircle(p.pos.x, p.pos.z, radius)) { this.hit(t, dmg); const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z); this.combat.push(t, dx, dz, force); if (extra) extra(t); n++; }
    return n;
  }
  // partículas de energía que salen del arma mientras se mueve
  energy(color, n = 2, spd = 1.4) {
    const tp = this.tipPos();
    for (let i = 0; i < n; i++) this.g.fx.sparkle(tp.x + rnd(-0.1, 0.1), tp.y + rnd(-0.1, 0.1), tp.z + rnd(-0.1, 0.1), color, spd);
  }
  // remate del combo: destello y onda con los colores del arma
  finisher(color, color2) {
    const p = this.p;
    this.vfx.ring(p.pos.x, p.pos.y + p.H * 0.5, p.pos.z, { r0: 0.4, r1: 3.2, dur: 0.4, color, opacity: 0.75 });
    this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.3, r1: 2.6, dur: 0.5, color: color2, opacity: 0.6 });
    this.shake(0.22);
  }
  dispose() { if (this.W && this.step !== undefined) this.W.endAttack(); super.dispose(); }
}

/* ---------------------------------------------------------------------- */
/*  JAGLION — KATANA · combo de esgrima: tajo diagonal → revés → estocada  */
/* ---------------------------------------------------------------------- */
export class KatanaSkill extends WeaponSkill {
  begin() { this.aim(this.def.range + 2); this.draw(); this.start(); return true; }
  build() {
    const d = this.def, extra = this.drawn ? 0.1 : 0;
    const slash = (arc, tilt, mul, vertical = false) => () => {
      this.W.swing(d.swing + 0.1);
      this.sfx('snap');
      const p = this.p;
      this.crescent(p.pos.y + p.H * 0.55, { r: d.range, arc, color: d.color, tilt, vertical });
      this.crescent(p.pos.y + p.H * 0.5, { r: d.range * 0.8, arc: arc * 0.8, color: 0xff8a2a, tilt: tilt * 0.8, width: 0.15, vertical });
      const n = this.hitArc(d.range, arc, d.damage * mul, d.force, (t) => {
        this.impactAt(t);
        this.vfx.sparks(t.pos.x, t.pos.y + 0.8, t.pos.z, 0xffb060, 8, 2.6);
        this.vfx.bolt(this.tipPos(), V(t.pos.x, t.pos.y + 0.8, t.pos.z), { color: 0x6ac8ff, life: 0.12, jag: 0.25, segs: 6 });
      });
      if (n) this.shake(0.15);
    };
    const fire = () => this.energy(0xff7a1a, 2, 1.8);
    if (this.step === 1) return [ // revés horizontal: la hoja vuelve de lado a lado
      this.stage('giro', 0.09 + extra, { x: -1.35, y: 1.1, f: -0.5, w: 0, r: 0.3 }, { spin: 0.6 }),
      this.stage('reves', d.swing * 0.85, { x: -1.35, y: -1.15, f: -0.3, w: 0.35, r: 0.3 }, { spin: -0.8, easeFn: back, enter: slash(d.arcDeg, 0.05, this.mul), tick: () => this.energy(0x6ac8ff, 2, 2) }),
      this.recover(d.recover),
    ];
    if (this.step === 2) return [ // estocada a fondo: recoge el brazo y se lanza hacia delante
      this.stage('recoger', 0.14 + extra, { x: -1.0, y: -0.3, f: -1.6, w: 0, r: 0.2 }, { spin: -0.3, rx: -0.1, tick: fire }),
      this.stage('estocada', 0.16, { x: -1.55, y: 0.05, f: 0, w: 0, r: 0.2 }, { spin: 0.1, rx: 0.25, easeFn: back, tick: (dt, k) => { this.lunge(9 * (1 - k), dt); this.energy(0xffd070, 3, 2.5); }, enter: () => {
        this.W.swing(0.3);
        this.sfx('crack');
        const p = this.p, f = this.fwd;
        this.crescent(p.pos.y + p.H * 0.55, { r: d.range * 1.3, arc: 30, color: 0xffd070, vertical: true, width: 0.12, life: 0.2 });
        this.v2.beam(this.center(0.55), V(p.pos.x + f.x * d.range * 1.5, p.pos.y + p.H * 0.55, p.pos.z + f.z * d.range * 1.5), { r: 0.07, color: 0xff9a3a, opacity: 0.85, life: 0.18 });
        const n = this.hitArc(d.range * 1.4, 40, d.damage * this.mul, d.force * 1.6, (t) => this.impactAt(t, 1.3));
        this.finisher(0xff7a1a, 0x4aa8ff);
        if (n) this.shake(0.25);
      } }),
      this.recover(d.recover + 0.12),
    ];
    return [ // tajo diagonal: de arriba de su lado hacia abajo al lado contrario
      this.stage('guardia', d.prep + extra, { x: -2.2, y: -0.7, f: -0.6, w: 0.4, r: 1.0 }, { spin: -0.35, rx: 0.05, tick: fire }),
      this.stage('tajo', d.swing, { x: -0.6, y: 1.2, f: -0.15, w: -0.4, r: 1.0 }, { spin: 0.9, rx: 0.18, easeFn: back, enter: slash(d.arcDeg, 0.55, this.mul), tick: () => this.energy(0xff7a1a, 2, 2) }),
      this.recover(d.recover),
    ];
  }
}

/* ---------------------------------------------------------------------- */
/*  KAIRO — MARTILLO · martillazo → barrido lateral → salto y golpe al suelo */
/* ---------------------------------------------------------------------- */
export class HammerSkill extends WeaponSkill {
  begin() { this.aim(this.def.range + this.def.radius); this.draw(); this.start(); return true; }
  build() {
    const d = this.def, extra = this.drawn ? 0.1 : 0;
    if (this.step === 1) return [ // barrido lateral: el peso del martillo arrastra todo el cuerpo
      this.stage('cargar', 0.2 + extra, { x: -1.0, y: -1.1, f: -0.5, r: 0.5 }, { spin: -0.7, sy: 0.96, tick: () => this.energy(0x5aff8a, 2, 1) }),
      this.stage('barrido', 0.22, { x: -1.0, y: 1.2, f: -0.3, r: 0.5 }, { spin: 1.0, easeFn: back, enter: () => {
        this.W.swing(0.3); this.sfx('boom');
        const p = this.p;
        this.crescent(p.pos.y + p.H * 0.45, { r: d.radius, arc: 160, color: 0x5aff8a, width: 0.3 });
        const n = this.hitArc(d.radius, 160, d.damage * this.mul, d.force * 1.4, (t) => { this.impactAt(t); for (let i = 0; i < 3; i++) this.g.fx.gem(t.pos.x, t.pos.y + 0.6, t.pos.z); });
        if (n) this.shake(0.22);
      } }),
      this.recover(d.recover + 0.05),
    ];
    if (this.step === 2) return [ // salto y golpe al suelo (remate)
      this.stage('salto', 0.28 + extra, { x: -2.8, y: 0.1, f: -0.5, r: 0.2 }, { rx: -0.45, dy: 0.9, sy: 1.06, enter: () => { this.p.powerAnim = 1; this.lock(true); }, tick: () => this.energy(0x5aff8a, 3, 1.2) }),
      this.stage('caida', 0.16, { x: -0.6, y: 0.1, f: -0.4, r: 0.2 }, { rx: 0.6, dy: 0, sy: 0.9, easeFn: back, exit: () => { this.slam(1.4); this.finisher(0x3aff6a, 0xffc040); } }),
      this.stage('levantar', d.recover + 0.15, this.guard, { spin: 0, rx: 0, dy: 0, sy: 1, recover: true, enter: () => this.lock(false) }),
    ];
    return [ // martillazo por encima de la cabeza
      this.stage('alzar', d.prep + extra, { x: -2.7, y: 0.1, f: -0.4, r: 0.2 }, { rx: -0.45, dy: 0.3, sy: 1.06, enter: () => { this.p.powerAnim = 1; this.lock(true); }, tick: () => this.energy(0x5aff8a, 2, 1) }),
      this.stage('martillazo', d.slam, { x: -0.7, y: 0.1, f: -0.4, r: 0.2 }, { rx: 0.55, dy: 0, easeFn: back, enter: () => this.W.swing(d.slam + 0.06), exit: () => this.slam(1) }),
      this.stage('recuperacion', d.recover, this.guard, { spin: 0, rx: 0, dy: 0, sy: 1, recover: true, enter: () => this.lock(false) }),
    ];
  }
  slam(k) {
    const d = this.def, p = this.p, f = this.fwd, x = p.pos.x + f.x * d.range, z = p.pos.z + f.z * d.range, y = p.floorY(x, z, p.pos.y + 0.6);
    const R = d.radius * k;
    this.shake(0.3 * k); this.sfx('boom');
    this.vfx.ring(x, y + 0.06, z, { r0: 0.4, r1: R, dur: 0.45, color: 0x5aff8a });
    this.vfx.ring(x, y + 0.1, z, { r0: 0.2, r1: R * 1.4, dur: 0.6, color: 0xffc040, opacity: 0.5 });
    this.W.impact(x, y + 0.3, z, 1.4 * k);
    this.vfx.dust(x, y + 0.1, z, 10, 2);
    for (let i = 0; i < 14; i++) this.g.fx.gem(x + rnd(-1, 1), y + 0.3, z + rnd(-1, 1));
    for (let i = 0; i < 5; i++) this.v2.crack(x, z, rnd(1, R), rnd(0, TAU), { life: 0.9, width: 0.12 });
    for (let i = 0; i < 5; i++) this.g.fx.rock(x, y + 0.2, z);
    for (const t of this.combat.inCircle(x, z, R)) {
      this.hit(t, d.damage * this.mul);
      this.impactAt(t, 0.8);
      const { dx, dz } = this.awayFrom(t, x, z);
      this.combat.push(t, dx || f.x, dz || f.z, d.force * k);
    }
  }
}

/* ---------------------------------------------------------------------- */
/*  HALLEY — LANZA MORADA · estocada con proyección → doble estocada → embestida */
/* ---------------------------------------------------------------------- */
export class SpearSkill extends WeaponSkill {
  begin() { this.target = this.aim(this.def.range, this.def.coneDeg * 2); this.draw(); this.start(); return true; }
  build() {
    const d = this.def, extra = this.drawn ? 0.1 : 0;
    const back1 = { x: -0.7, y: -0.3, f: -1.5, r: 0.3 }, out1 = { x: -1.55, y: 0.05, f: 0, r: 0.3 };
    const charge = (dt, k) => { const tp = this.tipPos(); this.vfx.orb(tp, { r: 0.04 + 0.08 * k, color: 0xb050ff, life: 0.08 }); this.energy(0xd890ff, 1, 0.8); };
    if (this.step === 1) return [ // doble estocada rápida
      this.stage('recoger', 0.1 + extra, back1, { spin: -0.2, tick: charge }),
      this.stage('estocada1', 0.1, out1, { spin: 0.1, rx: 0.12, easeFn: back, enter: () => this.poke(0.8), tick: (dt, k) => this.lunge(5 * (1 - k), dt) }),
      this.stage('recoger2', 0.08, back1, { spin: -0.1 }),
      this.stage('estocada2', 0.1, out1, { spin: 0.15, rx: 0.12, easeFn: back, enter: () => this.poke(0.8), tick: (dt, k) => this.lunge(5 * (1 - k), dt) }),
      this.recover(d.recover),
    ];
    if (this.step === 2) return [ // embestida: corre con la lanza por delante y atraviesa a todos en su camino
      this.stage('apuntar', 0.16 + extra, { x: -1.1, y: -0.2, f: -0.9, r: 0.3 }, { rx: -0.1, spin: -0.2, tick: charge }),
      this.stage('embestida', 0.3, out1, { rx: 0.3, easeFn: (k) => k, enter: () => { this.W.swing(0.38); this.sfx('crack'); this.hitSet = new Set(); }, tick: (dt, k) => {
        this.lunge(16 * (1 - k * 0.5), dt);
        const p = this.p, f = this.fwd;
        for (const t of this.combat.inCircle(p.pos.x + f.x * 1.2, p.pos.z + f.z * 1.2, 1.3)) { if (this.hitSet.has(t)) continue; this.hitSet.add(t); this.hit(t, d.damage * this.mul); this.combat.push(t, f.x, f.z, d.force * 1.5); this.impactAt(t, 1.2); }
        this.energy(0xd890ff, 3, 2.4);
        if (Math.random() < 0.6) this.g.fx.gem(p.pos.x, p.pos.y + p.H * 0.5, p.pos.z);
      }, exit: () => { this.finisher(0xb050ff, 0xe8c0ff); this.projectile(1.3); } }),
      this.recover(d.recover + 0.1),
    ];
    return [ // estocada y proyección de cristal violeta
      this.stage('cargar', d.prep + extra, back1, { rx: -0.08, spin: -0.25, enter: () => { this.p.powerAnim = 1; }, tick: charge }),
      this.stage('estocada', d.thrust, out1, { rx: 0.12, spin: 0.15, easeFn: back, enter: () => { this.poke(1); this.projectile(1); }, tick: (dt, k) => this.lunge(7 * (1 - k), dt) }),
      this.recover(d.recover),
    ];
  }
  poke(k) {
    const d = this.def, p = this.p, f = this.fwd;
    this.W.swing(0.18); this.sfx('crack');
    for (const t of this.combat.inCone(p.pos.x, p.pos.z, p.facing, 25 * DEG, d.reach)) { this.hit(t, d.damage * this.mul * k); this.impactAt(t); this.combat.push(t, f.x, f.z, d.force); }
    this.vfx.orb(this.tipPos().clone(), { r: 0.14, color: 0xd890ff, opacity: 0.8, life: 0.12, grow: 1.2 });
  }
  // proyección de la punta: un rayo de cristal violeta que atraviesa
  projectile(k) {
    const d = this.def, p = this.p, f = this.fwd;
    const m = this.tipPos().clone();
    const t = this.target && !this.target.dead ? this.target : this.combat.aimTarget(p.pos.x, p.pos.z, p.facing, d.coneDeg * DEG, d.range);
    const to = t ? V(t.pos.x, t.pos.y + (t.heavy ? t.S.height * 0.5 : 0.6), t.pos.z) : V(m.x + f.x * d.range, m.y, m.z + f.z * d.range);
    const dir = to.clone().sub(m).normalize();
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.11 * k, 0.55 * k, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd0a0ff).multiplyScalar(2.6), toneMapped: false }));
    core.rotation.x = Math.PI / 2;
    const halo = new THREE.Mesh(new THREE.ConeGeometry(0.2 * k, 0.8 * k, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9a30ff).multiplyScalar(1.6), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    halo.rotation.x = Math.PI / 2;
    g.add(core, halo);
    g.traverse((o) => { o.userData.own = true; });
    g.position.copy(m);
    g.lookAt(to);
    const combat = this.combat, vfx = this.vfx, fx = this.g.fx, W = this.W, life = d.range / d.speed, hits = new Set(), mul = this.mul;
    let left = d.pierce;
    vfx.add(g, life, (it, dt) => {
      g.position.addScaledVector(dir, d.speed * dt);
      g.rotateZ(dt * 14);
      vfx.orb(g.position.clone(), { r: 0.16 * k, color: 0xb050ff, life: 0.22 });
      if (Math.random() < 0.8) fx.sparkle(g.position.x, g.position.y, g.position.z, Math.random() < 0.5 ? 0xd890ff : 0x8a2aff, 1.2);
      if (left <= 0) { it.t = life; return; }
      for (const tt of combat.inCircle(g.position.x, g.position.z, 0.6 * k)) {
        if (hits.has(tt) || Math.abs(g.position.y - tt.pos.y - (tt.heavy ? tt.S.height * 0.5 : 0.6)) > (tt.heavy ? tt.S.height : 1.6)) continue;
        hits.add(tt); left--;
        combat.damage(tt, d.damage * mul);
        combat.push(tt, dir.x, dir.z, d.force);
        W.impact(g.position.x, g.position.y, g.position.z, 1);
        for (let i = 0; i < 6; i++) fx.gem(g.position.x, g.position.y, g.position.z);
      }
    });
    this.v2.beam(m, m.clone().addScaledVector(dir, 2.2), { r: 0.06, color: 0xd890ff, opacity: 0.8, life: 0.16 });
  }
}

/* ---------------------------------------------------------------------- */
/*  NILO — BUMERÁN · lanzamiento a la derecha → a la izquierda → lanzamiento potente */
/* ---------------------------------------------------------------------- */
export class BoomerangSkill extends WeaponSkill {
  begin() { this.aim(this.def.dist); this.draw(); this.start(); return true; }
  build() {
    const d = this.def, extra = this.drawn ? 0.12 : 0;
    this.curve = this.step === 1 ? -1 : 1;
    this.power = this.step === 2 ? 1.4 : 1;
    const wind = this.step === 1 ? { x: -1.9, y: 0.8, f: -0.7, r: -0.5 } : { x: -2.3, y: -0.6, f: -0.6, r: 0.4 };
    const rel = this.step === 1 ? { x: -1.1, y: -0.6, f: -0.1, r: -0.5 } : { x: -1.1, y: 0.5, f: -0.1, r: 0.4 };
    return [
      this.stage('apuntar', d.prep + extra + (this.step === 2 ? 0.12 : 0), wind, { spin: this.step === 1 ? 0.5 : -0.5, enter: () => { this.p.powerAnim = 1; }, tick: () => this.energy(0x3ad8ff, this.step === 2 ? 3 : 1, 0.9) }),
      this.stage('lanzar', 0.1, rel, { spin: 0, easeFn: back, enter: this.enterFly }),
      this.stage('vuelo', d.flightT * (this.step === 2 ? 1.25 : 1), this.guard, { tick: this.tickFly, exit: this.catch }),
      this.recover(d.recover),
    ];
  }
  enterFly() {
    const W = this.W, pr = W.projectile(0);
    const g = pr ? pr.group : new THREE.Group();
    if (this.power > 1) g.scale.multiplyScalar(1.25);
    this.mesh = { obj: g, it: this.vfx.add(g, 0), kill: () => this.vfx.kill(this.mesh.it) };
    this.track(this.mesh);
    W.setHome(0, false); // el de la mano desaparece mientras vuela
    this.trail = new Trail(this.g.scene, 0x3ad8ff, 0x9af0ff, 26);
    this.track({ kill: () => this.trail.dispose() });
    this.o = this.p.pos.clone();
    this.dir = this.fwd;
    this.hitOut = new Set(); this.hitBack = new Set();
    this.sfx('flap');
    this.g.vfx.orb(this.tipPos(), { r: 0.2, color: 0x3ad8ff, life: 0.15, grow: 1.5 });
  }
  tickFly(dt, k) {
    const d = this.def, p = this.p, u = k, pw = this.power;
    // trayectoria en lazo: sale hacia delante abriéndose a un lado y vuelve a la mano del héroe
    const fwdD = d.dist * pw * Math.sin(u * Math.PI), side = this.curve * d.width * pw * Math.sin(u * TAU) * 0.5;
    const sx = -this.dir.z, sz = this.dir.x;
    const home = V(p.pos.x, p.pos.y + p.H * 0.6, p.pos.z), start = V(this.o.x, this.o.y + p.H * 0.6, this.o.z);
    const base = start.clone().lerp(home, u);
    const pos = V(base.x + this.dir.x * fwdD + sx * side, base.y + Math.sin(u * Math.PI) * 0.6, base.z + this.dir.z * fwdD + sz * side);
    const g = this.mesh.obj;
    g.position.copy(pos);
    g.rotation.set(-Math.PI / 2 + 0.25, 0, g.rotation.z + dt * 26 * this.curve); // gira plano, como un bumerán de verdad
    const r = 0.36 * pw;
    this.trail.push(V(pos.x + Math.cos(g.rotation.z) * r, pos.y, pos.z - Math.sin(g.rotation.z) * r), V(pos.x - Math.cos(g.rotation.z) * r, pos.y, pos.z + Math.sin(g.rotation.z) * r));
    this.trail.update(dt, true);
    if (Math.random() < 0.6) this.g.fx.spray(pos.x, pos.y, pos.z, 0, 0.5, 0, 0.8);
    if (Math.random() < 0.5) this.g.fx.sparkle(pos.x, pos.y, pos.z, u < 0.5 ? 0x3ad8ff : 0x9af0ff, 1);
    if (pw > 1 && !this.burst && u > 0.5) { this.burst = true; this.vfx.splash(pos.x, pos.y, pos.z, 18, 1.2); this.vfx.ring(pos.x, pos.y, pos.z, { r0: 0.3, r1: 3, dur: 0.4, color: 0x3ad8ff }); for (const t of this.combat.inCircle(pos.x, pos.z, 3)) { this.hit(t, d.damage * 0.6); this.impactAt(t); } }
    const set = u < 0.5 ? this.hitOut : this.hitBack;
    for (const t of this.combat.inCircle(pos.x, pos.z, d.hitRadius * pw)) {
      if (set.has(t)) continue;
      set.add(t);
      this.hit(t, d.damage * this.mul);
      this.combat.push(t, this.dir.x * (u < 0.5 ? 1 : -1), this.dir.z * (u < 0.5 ? 1 : -1), d.force);
      this.vfx.splash(t.pos.x, t.pos.y + 0.7, t.pos.z, 8, 0.8);
      this.impactAt(t);
      this.sfx('stick');
    }
  }
  catch() {
    this.mesh.kill();
    this.W.setHome(0, true); // vuelve a su mano
    this.sfx('stick');
    this.vfx.splash(this.p.pos.x, this.p.pos.y + this.p.H * 0.6, this.p.pos.z, 6, 0.5);
    if (this.power > 1) this.finisher(0x3ad8ff, 0xff3a2a);
  }
  dispose() { if (this.W) this.W.setHome(0, true); super.dispose(); }
}

/* ---------------------------------------------------------------------- */
/*  KYRA — HACHA DE CRISTAL · hachazo → barrido horizontal → torbellino de hielo */
/* ---------------------------------------------------------------------- */
export class AxeSkill extends WeaponSkill {
  begin() { this.aim(this.def.range + 2); this.draw(); this.start(); return true; }
  build() {
    const d = this.def, extra = this.drawn ? 0.1 : 0;
    const frost = () => this.energy(0x9ae0ff, 2, 0.9);
    if (this.step === 1) return [ // barrido horizontal
      this.stage('cargar', 0.14 + extra, { x: -1.2, y: -1.0, f: -0.4, r: 0.5 }, { spin: -0.6, tick: frost }),
      this.stage('barrido', d.chop + 0.04, { x: -1.2, y: 1.2, f: -0.3, r: 0.5 }, { spin: 0.9, easeFn: back, enter: () => {
        this.W.swing(0.26); this.sfx('crack');
        const p = this.p;
        this.crescent(p.pos.y + p.H * 0.5, { r: d.range, arc: 140, color: 0x9ae8ff });
        this.crescent(p.pos.y + p.H * 0.55, { r: d.range * 0.85, arc: 120, color: 0xc06aff, width: 0.12, life: 0.2 });
        this.hitArc(d.range, 140, d.damage * this.mul, d.force, (t) => { this.combat.slow(t, d.slowF, d.slowT); this.vfx.ice(t.pos.x, t.pos.y + 0.6, t.pos.z, 3); this.impactAt(t); });
      } }),
      this.recover(d.recover),
    ];
    if (this.step === 2) return [ // torbellino: gira sobre sí misma con el hacha extendida
      this.stage('cargar', 0.14 + extra, { x: -1.4, y: -0.6, f: -0.2, r: 0.5 }, { spin: -0.4, sy: 0.95, tick: frost }),
      this.stage('torbellino', 0.45, { x: -1.4, y: 0.6, f: -0.2, r: 0.5 }, { spin: TAU, easeFn: (k) => k, enter: () => { this.W.swing(0.5); this.sfx('wind'); this.hitSet = new Set(); }, tick: (dt, k) => {
        const p = this.p;
        if (Math.random() < 0.7) this.vfx.ice(p.pos.x + rnd(-1.5, 1.5), p.pos.y + 0.4, p.pos.z + rnd(-1.5, 1.5), 1);
        for (const t of this.combat.inCircle(p.pos.x, p.pos.z, d.range)) { if (this.hitSet.has(t)) continue; this.hitSet.add(t); this.hit(t, d.damage * this.mul); this.combat.slow(t, d.slowF, d.slowT * 1.5); this.impactAt(t); const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z); this.combat.push(t, dx, dz, d.force); }
      }, exit: () => { const p = this.p; this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.3, r1: d.range * 1.5, dur: 0.5, color: 0xbff0ff }); this.vfx.ice(p.pos.x, p.pos.y + 0.3, p.pos.z, 10); this.finisher(0x6ab0ff, 0xc06aff); } }),
      this.recover(d.recover + 0.1),
    ];
    return [ // hachazo vertical
      this.stage('alzar', d.prep + extra, { x: -2.6, y: -0.2, f: -0.5, r: 1.4 }, { rx: -0.5, sy: 1.05, enter: () => { this.p.powerAnim = 1; }, tick: frost }),
      this.stage('hachazo', d.chop, { x: -0.6, y: 0.3, f: -0.5, r: 1.4 }, { rx: 0.55, easeFn: back, enter: () => { this.sfx('crack'); this.W.swing(d.chop + 0.08); }, exit: this.chop }),
      this.recover(d.recover),
    ];
  }
  chop() {
    const d = this.def, p = this.p, f = this.fwd, x = p.pos.x + f.x * d.range * 0.6, z = p.pos.z + f.z * d.range * 0.6;
    this.shake(0.18);
    this.crescent(p.pos.y + p.H * 0.5, { r: d.range, arc: d.arcDeg, color: 0x9ae8ff, vertical: true, life: 0.22 });
    this.crescent(p.pos.y + p.H * 0.5, { r: d.range * 0.85, arc: d.arcDeg * 0.8, color: 0xc06aff, vertical: true, life: 0.2, width: 0.12 });
    this.vfx.ice(x, p.pos.y + 0.3, z, 6);
    this.vfx.ring(x, null, z, { r0: 0.3, r1: 2.2, dur: 0.4, color: 0xbff0ff });
    this.W.impact(x, p.pos.y + 0.4, z, 1.1);
    this.hitArc(d.range, d.arcDeg, d.damage * this.mul, d.force, (t) => { this.combat.slow(t, d.slowF, d.slowT); this.vfx.ice(t.pos.x, t.pos.y + 0.6, t.pos.z, 3); this.impactAt(t); });
  }
}

/* ---------------------------------------------------------------------- */
/*  LIRA — GUADAÑA DE RAYO · barrido con onda → revés amplio → siega en giro */
/* ---------------------------------------------------------------------- */
export class ScytheSkill extends WeaponSkill {
  begin() { this.aim(this.def.range, 40); this.draw(); this.start(); return true; }
  build() {
    const d = this.def, extra = this.drawn ? 0.1 : 0;
    const spark = () => this.energy(0x8ad8ff, 2, 1);
    if (this.step === 1) return [ // revés amplio
      this.stage('girar', 0.12 + extra, { x: -1.2, y: 1.3, f: -0.3, r: 0.4 }, { spin: 1.0, tick: spark }),
      this.stage('reves', d.swing, { x: -1.2, y: -1.3, f: -0.2, r: 0.4 }, { spin: -1.0, easeFn: back, enter: () => this.reap(200, false), tick: () => this.energy(0xbfeeff, 3, 2.2) }),
      this.recover(d.recover),
    ];
    if (this.step === 2) return [ // siega en giro: una vuelta completa con anillo de rayos
      this.stage('cargar', 0.14 + extra, { x: -1.3, y: -1.0, f: -0.2, r: 0.4 }, { spin: -0.5, sy: 0.95, tick: spark }),
      this.stage('siega', 0.42, { x: -1.3, y: 0.9, f: -0.2, r: 0.4 }, { spin: TAU, easeFn: (k) => k, enter: () => { this.W.swing(0.5); this.sfx('zap'); this.hitSet = new Set(); }, tick: (dt, k) => {
        const p = this.p;
        for (const t of this.combat.inCircle(p.pos.x, p.pos.z, d.reach * 1.15)) { if (this.hitSet.has(t)) continue; this.hitSet.add(t); this.hit(t, d.damage * this.mul); this.impactAt(t); this.vfx.bolt(this.tipPos(), V(t.pos.x, t.pos.y + 0.8, t.pos.z), { color: 0x8ad8ff, life: 0.14, jag: 0.3, segs: 7 }); }
        if (Math.random() < 0.5) { const a = rnd(0, TAU); this.vfx.bolt(V(p.pos.x, p.pos.y + p.H * 0.5, p.pos.z), V(p.pos.x + Math.cos(a) * d.reach, p.pos.y + 0.2, p.pos.z + Math.sin(a) * d.reach), { color: 0x9adcff, life: 0.08, jag: 0.3, segs: 6 }); }
      }, exit: () => { const p = this.p; this.vfx.ring(p.pos.x, p.pos.y + 0.3, p.pos.z, { r0: 0.5, r1: d.reach * 1.6, dur: 0.45, color: 0x3a9aff }); this.finisher(0x3a9aff, 0xbfeeff); } }),
      this.recover(d.recover + 0.1),
    ];
    return [ // barrido amplio con onda de rayo
      this.stage('cargar', d.prep + extra, { x: -1.2, y: -1.2, f: -0.2, r: 0.4 }, { spin: -0.8, enter: () => { this.p.powerAnim = 1; this.sfx('zap'); }, tick: spark }),
      this.stage('barrido', d.swing, { x: -1.2, y: 1.4, f: -0.2, r: 0.4 }, { spin: 1.4, rx: 0.15, easeFn: back, enter: () => this.reap(d.arcDeg, true), tick: () => this.energy(0xbfeeff, 3, 2.2) }),
      this.recover(d.recover),
    ];
  }
  reap(arc, wave) {
    const d = this.def, p = this.p, f = this.fwd;
    this.W.swing(d.swing + 0.12);
    this.sfx('snap');
    this.crescent(p.pos.y + p.H * 0.5, { r: d.reach, arc, color: 0x3a9aff, tilt: 0.1 });
    this.crescent(p.pos.y + p.H * 0.55, { r: d.reach * 0.9, arc: arc * 0.9, color: 0xbfeeff, tilt: 0.15, width: 0.1, life: 0.2 });
    const n = this.hitArc(d.reach, arc, d.damage * this.mul, d.force, (t) => { this.impactAt(t); this.vfx.bolt(this.tipPos(), V(t.pos.x, t.pos.y + 0.8, t.pos.z), { color: 0x8ad8ff, life: 0.14, jag: 0.3, segs: 7 }); });
    if (n) this.shake(0.14);
    if (!wave) return;
    // onda de rayo: media luna que vuela hacia delante y atraviesa
    const geo = new THREE.RingGeometry(1.1, 1.6, 32, 1, -0.9, 1.8);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5ab0ff).multiplyScalar(2.2), transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const waveM = new THREE.Mesh(geo, mat);
    waveM.rotation.x = -Math.PI / 2; waveM.rotation.z = Math.PI / 2;
    const g = new THREE.Group(); g.add(waveM); g.userData.own = true; waveM.userData.own = true;
    g.position.set(p.pos.x + f.x * 0.6, p.pos.y + p.H * 0.45, p.pos.z + f.z * 0.6);
    g.rotation.y = p.facing - Math.PI / 2;
    const combat = this.combat, vfx = this.vfx, W = this.W, life = d.range / d.speed, hits = new Set();
    vfx.add(g, life, (it, dt) => {
      g.position.x += f.x * d.speed * dt; g.position.z += f.z * d.speed * dt;
      const k = it.t / life;
      mat.opacity = 0.85 * (1 - k * k); g.scale.setScalar(1 + k * 0.6);
      if (Math.random() < 0.5) vfx.bolt(V(g.position.x - f.z * 1.3, g.position.y, g.position.z + f.x * 1.3), V(g.position.x + f.z * 1.3, g.position.y, g.position.z - f.x * 1.3), { color: 0x9adcff, life: 0.06, jag: 0.25, segs: 7 });
      for (const t of combat.inCircle(g.position.x, g.position.z, 1.5)) {
        if (hits.has(t)) continue;
        hits.add(t);
        combat.damage(t, d.waveDamage);
        W.impact(t.pos.x, t.pos.y + 0.7, t.pos.z, 0.8);
      }
      if (it.t >= life - 0.001) geo.dispose();
    });
  }
}

/* ---------------------------------------------------------------------- */
/*  ÁMBAR — DOS DISCOS · disco derecho → disco izquierdo → los dos a la vez */
/* ---------------------------------------------------------------------- */
// ÁMBAR — DOS DISCOS. Cada disco va sujeto por su ala (weapons/system.js · attachWing). El lanzamiento lo hace el ala:
// se abre hacia atrás, barre hacia delante y suelta el disco a mitad del barrido; el disco vuelve al mismo punto del
// ala y se queda sujeto sin saltos. Para que nada se pause ni se reinicie:
//  · no se dispara la animación 'power' del modelo (aleteaba las alas y luego saltaba de golpe a 'idle');
//  · solo se lanza un disco que esté en el ala (antes se podía relanzar uno en vuelo → copias y apariciones bruscas).
export class DiscSkill extends WeaponSkill {
  begin() {
    this.aim(this.def.range, 35);
    this.draw();
    const W = this.W, parts = (W && W.cur && W.cur.parts) || [];
    const ready = parts.map((pt, i) => (pt.home ? i : -1)).filter((i) => i >= 0);
    if (parts.length && !ready.length) return false; // los dos discos están volando: se espera a que vuelvan
    // cada lanzamiento suelta LOS DOS discos (uno por ala), cada uno hacia su propio objetivo
    this.which = ready.length ? ready : [0];
    this.wing = !!(parts[0] && parts[0].wing);
    this.start();
    return true;
  }
  build() {
    const d = this.def, extra = this.drawn ? 0.12 : 0;
    this.armPart = this.which.length > 1 ? -1 : this.which[0];
    const both = this.which.length > 1;
    if (this.wing) {
      this.thrown = false;
      const sideSpin = both ? 0 : (this.W.cur.parts[this.which[0]].side > 0 ? 0.35 : -0.35); // el cuerpo acompaña al ala que lanza
      return [
        // el ala se abre hacia fuera y atrás (carga)
        this.stage('apuntar', d.prep + extra + (both ? 0.08 : 0), { x: 0.85, y: -0.45, f: -0.25, w: 0.1 }, { spin: -sideSpin, rx: -0.05, tick: () => this.energy(0xff4a2a, 1, 0.8) }),
        // barrido rápido hacia delante: el disco sale a mitad del gesto, con la velocidad del ala
        this.stage('lanzar', 0.16, { x: 0.3, y: 1.35, f: 0.55, w: -0.3 }, { spin: sideSpin * 0.8, rx: 0.12, easeFn: back, tick: (dt, k) => {
          if (!this.thrown && k >= 0.45) { this.thrown = true; this.which.forEach((i, n) => this.throwDisc(i, n)); if (this.step === 2) this.finisher(0xff3a1a, 0xffc020); }
        } }),
        this.recover(d.recover + 0.08),
      ];
    }
    return [
      this.stage('apuntar', d.prep + extra + (this.step === 2 ? 0.1 : 0), { x: -0.8, y: -0.45, f: -0.3 }, { spin: this.step === 1 ? 0.5 : -0.5, enter: () => { this.p.powerAnim = 1; }, tick: () => this.energy(0xff4a2a, 2, 1) }),
      this.stage('lanzar', 0.12, { x: -0.8, y: 0.4, f: -0.3 }, { spin: this.step === 1 ? -0.3 : 0.4, easeFn: back, enter: () => { this.which.forEach((i, k) => this.throwDisc(i, k)); if (this.step === 2) this.finisher(0xff3a1a, 0xffc020); } }),
      this.recover(d.recover),
    ];
  }
  throwDisc(idx, order) {
    const d = this.def, p = this.p, f = this.fwd, W = this.W;
    const part = W.cur && W.cur.parts[idx];
    if (part && !part.home) return; // ya está volando
    const pr = W.projectile(idx);
    const g = pr ? pr.group : new THREE.Group();
    const spin = pr && pr.spin;
    const startP = part ? W.partCenter(part, new THREE.Vector3()) : this.center(0.6);
    g.position.copy(startP);
    // orientación de vuelo (plano, ligeramente inclinado) y la del disco en el ala, para el regreso suave
    const qFly = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.3, 0, 0));
    const qHold = new THREE.Quaternion(), qTmp = new THREE.Quaternion();
    if (part) { part.w.group.getWorldQuaternion(g.quaternion); g.quaternion.slerp(qFly, 0.5); }
    W.setHome(idx, false);
    W.swing(0.25);
    this.sfx('wind');
    const trail = new Trail(this.g.scene, 0xff3a1a, 0xffc020, 20);
    const combat = this.combat, vfx = this.vfx, sfx = (n) => this.sfx(n), fx = this.g.fx, dmg = d.damage * this.mul;
    const hit = new Set();
    // con los dos discos, cada uno busca un enemigo distinto
    const cands = combat.targets().filter((t) => !t.dead && Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) < d.range).sort((a, b) => Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) - Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z));
    let target = order > 0 && cands[order] ? cands[order] : combat.aimTarget(p.pos.x, p.pos.z, p.facing, 35 * DEG, d.range);
    let bounces = d.bounces, travelled = 0, back = false;
    const dir = V(f.x - (order ? f.z * 0.3 : 0), 0, f.z + (order ? f.x * 0.3 : 0)).normalize();
    // LUZ SOLO AL LANZAR: el disco se enciende al salir disparado y se apaga en cuanto emprende el regreso
    let light = 1;
    W.partLight(idx, 1);
    const LIFE = 8; // margen de sobra: el disco siempre vuelve antes (antes, a los 5 s desaparecía en el aire)
    const it0 = vfx.add(g, LIFE, (it, dt) => {
      if (spin) spin.rotation.z += dt * 30;
      if (!back) g.quaternion.slerp(qFly, Math.min(1, dt * 14)); // se aplana al salir (sin giro brusco)
      light = back ? Math.max(0, light - dt / 0.15) : 1; // al volver: se apaga en 0,15 s, sin cortes bruscos
      W.partLight(idx, light);
      const r = 0.2, a = it.t * 30;
      if (!back) trail.push(V(g.position.x + Math.cos(a) * r, g.position.y, g.position.z + Math.sin(a) * r), V(g.position.x - Math.cos(a) * r, g.position.y, g.position.z - Math.sin(a) * r));
      trail.update(dt, !back);
      if (!back && Math.random() < 0.7) fx.sparkle(g.position.x, g.position.y, g.position.z, Math.random() < 0.5 ? 0xff3a1a : 0xffc020, 1.2);
      if (back) { // vuelve exactamente al punto del ala (o de la mano) que lo sujeta
        const home = part ? W.partCenter(part, V()) : V(p.pos.x, p.pos.y + p.H * 0.55, p.pos.z);
        dir.subVectors(home, g.position);
        const l = dir.length();
        // al acercarse se va girando hasta la orientación con la que lo sujeta el ala: el relevo no se nota
        if (part && l < 2.5) { part.w.group.getWorldQuaternion(qHold); qTmp.copy(g.quaternion).slerp(qHold, Math.min(1, dt * 10 + (1 - l / 2.5) * 0.3)); g.quaternion.copy(qTmp); }
        const step = Math.max(d.speed * 1.1, Math.hypot(p.vx, p.vz) + 8) * dt; // siempre alcanza a Ámbar aunque corra
        if (l <= step + 0.05) { g.position.copy(home); it.t = LIFE; return; }
        g.position.addScaledVector(dir.divideScalar(l), step);
        return;
      }
      if (target && !target.dead) {
        const to = V(target.pos.x, target.pos.y + (target.heavy ? target.S.height * 0.5 : 0.6), target.pos.z);
        dir.subVectors(to, g.position);
        const l = dir.length();
        if (l < 0.6) { // impacto y rebote al siguiente
          combat.damage(target, dmg);
          hit.add(target);
          vfx.ring(target.pos.x, to.y, target.pos.z, { r0: 0.2, r1: 1.4, dur: 0.3, color: 0xff3a1a });
          W.impact(to.x, to.y, to.z, 1);
          sfx('stick');
          if (bounces-- > 0) {
            let best = null, bd = d.bounceRange;
            for (const t of combat.targets()) { if (hit.has(t)) continue; const dd = Math.hypot(t.pos.x - target.pos.x, t.pos.z - target.pos.z); if (dd < bd) { bd = dd; best = t; } }
            target = best;
          } else target = null;
          if (!target) back = true;
          return;
        }
        dir.divideScalar(l);
      }
      g.position.addScaledVector(dir, d.speed * dt);
      travelled += d.speed * dt;
      if (!target && travelled > d.range) back = true;
    });
    // al terminar su vuelo, el disco reaparece en la mano
    let finished = false;
    const orig = it0.onUpdate;
    it0.onUpdate = (it, dt) => { orig(it, dt); if (!finished && it.t >= LIFE - 0.001) { finished = true; trail.dispose(); W.partLight(idx, 0); W.setHome(idx, true); } };
  }
}

/* ====================================================================== */
/*  ÁMBAR — ESCUDO: TORNADOS ENVOLVENTES                                   */
/* ====================================================================== */
export class TornadoShieldSkill extends Skill {
  begin() { this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'invocar', dur: d.prep, enter: this.enterCall, tick: (dt, k) => { pose.rx = -0.2 * k; pose.spin = k * TAU * 0.5; this.place(back(k), 1, dt); } },
      { name: 'escudo', dur: d.exec, tick: this.tickShield },
      { name: 'disipar', dur: d.recover, tick: (dt, k) => { pose.spin = 0; this.place(1 - k, 1 + 0.6 * k, dt); } },
    ];
  }
  enterCall() {
    const d = this.def;
    this.sfx('wind');
    this.torn = [];
    this.ang = 0;
    // cada tornado: tres embudos con remolinos que suben (shader), de dentro afuera, y una base de polvo
    for (let i = 0; i < d.count; i++) {
      const g = new THREE.Group();
      const layers = [[0.62, 0.1, 2.9, 0.55, 1], [0.44, 0.07, 2.6, 0.8, -1.4], [0.26, 0.04, 2.3, 1, 2]].map(([rt, rb, h, op, sw]) => {
        const mat = tornadoMat(op, sw, i * 1.7);
        const m = new THREE.Mesh(tornadoGeo(rt, rb, h), mat);
        m.userData.own = true;
        m.renderOrder = 5;
        g.add(m);
        return m;
      });
      this.prop(g);
      this.torn.push({ g, layers, a0: (i / d.count) * TAU, ph: Math.random() * TAU });
    }
    // corrientes de aire: anillos de viento discontinuos que giran alrededor del águila a distintas alturas
    this.currents = [0.5, 1.2, 1.9].map((h, i) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(d.orbit * (0.82 + i * 0.1), 0.025, 6, 96), tornadoMat(0.7, 3 + i, i * 2.3, true));
      m.userData.own = true;
      m.rotation.x = Math.PI / 2;
      m.renderOrder = 5;
      this.prop(m);
      return { m, h, tilt: rnd(-0.18, 0.18) };
    });
    this.ringT = 0;
  }
  // los tornados orbitan a su alrededor siguiendo al águila (también en el aire); k = tamaño, rr = escala del radio
  place(k, rr = 1, dt = 1 / 60) {
    const d = this.def, p = this.p;
    this.ang += dt * 2.4; // vuelta completa cada ~2,6 s, igual a cualquier velocidad de fotogramas
    const y = p.pos.y;
    for (const t of this.torn) {
      const a = this.ang + t.a0, r = d.orbit * rr * (1 + 0.04 * Math.sin(this.t * 3 + t.ph));
      t.g.position.set(p.pos.x + Math.cos(a) * r, y + 1.45 * k, p.pos.z + Math.sin(a) * r);
      t.g.scale.set(k, k, k);
      t.g.rotation.set(Math.cos(a) * 0.12, 0, -Math.sin(a) * 0.12); // ligeramente abiertos hacia fuera
      for (const m of t.layers) m.material.uniforms.uT.value = this.t;
    }
    for (const c of this.currents || []) {
      c.m.position.set(p.pos.x, y + c.h * k, p.pos.z);
      c.m.rotation.set(Math.PI / 2 + c.tilt, 0, -this.ang * 1.3);
      c.m.scale.setScalar(Math.max(0.001, k) * rr);
      c.m.material.uniforms.uT.value = this.t;
      c.m.material.uniforms.uO.value = 0.7 * Math.min(1, k);
    }
  }
  dispose() {
    for (const t of this.torn || []) for (const m of t.layers) { m.geometry.dispose(); m.material.dispose(); }
    for (const c of this.currents || []) { c.m.geometry.dispose(); c.m.material.dispose(); }
    this.torn = []; this.currents = [];
    super.dispose();
  }
  tickShield(dt) {
    const d = this.def, p = this.p, c = this.combat;
    this.pose.spin = 0;
    this.place(1 + 0.05 * Math.sin(this.t * 9), 1, dt);
    // polvo y hojas que suben en espiral por cada embudo
    for (const t of this.torn) {
      if (Math.random() < 0.55) {
        const h = Math.random(), a = this.t * 9 + h * 8 + t.ph, rr = 0.12 + 0.5 * h, q = t.g.position;
        this.g.fx.sparkle(q.x + Math.cos(a) * rr, q.y - 1.45 + h * 2.8, q.z + Math.sin(a) * rr, Math.random() < 0.7 ? 0xf2fbff : 0xc8e8ff, 0.35);
      }
      if (Math.random() < 0.2) { const q = t.g.position; this.g.fx.mist(q.x + rnd(-0.3, 0.3), q.y - 1.3, q.z + rnd(-0.3, 0.3), 0xe8f4fb, 0.6); } // remolino de aire en la base
    }
    p.evadeT = Math.max(p.evadeT, 0.15);       // protegida
    c.deflect(p.pos.x, p.pos.z, d.radius);       // devuelve los proyectiles
    for (const t of c.inCircle(p.pos.x, p.pos.z, d.radius)) { // aparta a los enemigos
      const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z);
      if (t.heavy) this.dot(t, d.damage, dt);
      else this.shove(t, dx - dz * 0.6, dz + dx * 0.6, d.push, dt);
    }
    // corrientes de aire circulares que envuelven al águila
    for (let i = 0; i < 2; i++) { const a = this.t * 6 + i * Math.PI + rnd(-0.2, 0.2), r = d.orbit * rnd(0.6, 1.2); this.g.fx.mist(p.pos.x + Math.cos(a) * r, p.pos.y + rnd(0.2, 2.2), p.pos.z + Math.sin(a) * r, 0xf0f8ff, 0.7); }
    this.ringT -= dt;
    if (this.ringT <= 0) { this.ringT = 0.35; this.vfx.ring(p.pos.x, p.pos.y + rnd(0.3, 1.8), p.pos.z, { r0: d.orbit * 0.6, r1: d.orbit * 1.4, dur: 0.5, color: 0xe8f6ff, opacity: 0.45 }); }
    if (Math.random() < 0.06) this.sfx('flap');
  }
}

/* ====================================================================== */
/*  ÁMBAR — GARRAS DE VIENTO: tres cortes de aire con forma de garra       */
/* ====================================================================== */
export class WindClawsSkill extends WeaponSkill {
  begin() { this.aim(this.def.range, 35); this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'concentrar', dur: d.prep, enter: () => { this.p.powerAnim = 1; this.sfx('wind'); }, tick: (dt, k) => {
        pose.rx = -0.25 * k; pose.spin = -0.4 * k;
        const c = this.center(0.4), f = this.fwd; // las garras se recubren de viento afilado
        for (let i = 0; i < 2; i++) this.g.fx.mist(c.x + f.x * 0.4 + rnd(-0.2, 0.2), c.y, c.z + f.z * 0.4 + rnd(-0.2, 0.2), 0xe0f4ff, 0.4);
        if (Math.random() < 0.5) this.vfx.sparks(c.x + f.x * 0.4, c.y, c.z + f.z * 0.4, 0xffffff, 1, 1);
      } },
      { name: 'zarpazo', dur: 0.15, enter: this.slash, tick: (dt, k) => { pose.spin = lerp(-0.4, 0.7, back(k)); pose.rx = 0.25; } },
      { name: 'recuperacion', dur: d.recover, tick: (dt, k) => { pose.spin = lerp(0.7, 0, ease(k)); pose.rx = lerp(0.25, 0, k); } },
    ];
  }
  slash() {
    const d = this.def, p = this.p, combat = this.combat, vfx = this.vfx;
    this.sfx('snap'); this.shake(0.12);
    for (let i = 0; i < d.cuts; i++) {
      const off = (i - (d.cuts - 1) / 2), ang = p.facing + off * d.spreadDeg * DEG * 0.35;
      const dir = V(Math.sin(ang), 0, Math.cos(ang)), side = V(-dir.z, 0, dir.x);
      // cada corte: media luna vertical, ligeramente desplazada a un lado (tres zarpas paralelas)
      const geo = new THREE.RingGeometry(0.75, 1.05, 24, 1, -0.9, 1.8);
      const mat = new THREE.MeshBasicMaterial({ color: 0xe8f8ff, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      const m = new THREE.Mesh(geo, mat);
      m.userData.own = true;
      const g = new THREE.Group();
      m.rotation.y = Math.PI / 2; m.rotation.z = -0.5;
      g.add(m);
      g.position.set(p.pos.x + side.x * off * 0.55 + dir.x * 0.8, p.pos.y + p.H * 0.55, p.pos.z + side.z * off * 0.55 + dir.z * 0.8);
      g.rotation.y = ang;
      const hits = new Set(), life = d.range / d.speed;
      vfx.add(g, life, (it, dt) => {
        g.position.addScaledVector(dir, d.speed * dt);
        const k = it.t / life;
        mat.opacity = 0.95 * (1 - k * k);
        g.scale.setScalar(1 + 0.4 * k);
        if (Math.random() < 0.5) this.g.fx.mist(g.position.x, g.position.y, g.position.z, 0xf0f8ff, 0.4);
        for (const t of combat.inCircle(g.position.x, g.position.z, d.width * 0.5)) {
          if (hits.has(t)) continue;
          hits.add(t);
          combat.damage(t, d.damage);
          combat.push(t, dir.x, dir.z, d.force);
          vfx.sparks(g.position.x, g.position.y, g.position.z, 0xffffff, 6, 2.6);
        }
        if (it.t >= life - 0.02) geo.dispose();
      });
    }
  }
}

/* ====================================================================== */
/*  LIRA — VISIÓN ESPECIAL                                                 */
/*  Ve a través del entorno: enemigos, trampas, personas y animales        */
/*  ocultos y los puntos débiles del jefe (que recibe +50 % de daño).      */
/* ====================================================================== */
const iconCache = {};
function iconTex(emoji, ring) {
  const key = emoji + ring;
  if (iconCache[key]) return iconCache[key];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(64, 64, 54, 0, TAU);
  g.fillStyle = 'rgba(8,16,24,0.55)'; g.fill();
  g.lineWidth = 8; g.strokeStyle = ring; g.stroke();
  g.font = '64px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(emoji, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  iconCache[key] = t;
  return t;
}
export class VisionSkill extends Skill {
  begin() { this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'activar-ojos', dur: d.prep, enter: () => { this.sfx('shimmer'); }, tick: (dt, k) => { pose.rx = -0.15 * k; this.eyes(k); } },
      { name: 'vision', dur: d.exec, enter: this.enterVision, tick: this.tickVision },
      { name: 'recuperacion', dur: d.recover, enter: () => { if (this.amb) this.amb.end(); }, tick: (dt, k) => { this.eyes(1 - k); } },
    ];
  }
  // los ojos brillan con luz verde-dorada
  eyes(k) {
    const p = this.p, f = this.fwd, h = boneWorld(this, 'head') || V(p.pos.x, p.pos.y + p.H * 0.9, p.pos.z);
    const sx = -f.z, sz = f.x;
    for (const s of [-1, 1]) this.vfx.orb(V(h.x + f.x * p.H * 0.09 + sx * s * p.H * 0.045, h.y + p.H * 0.03, h.z + f.z * p.H * 0.09 + sz * s * p.H * 0.045), { r: 0.03 + 0.06 * k, color: 0xb8ff6a, life: 0.06 });
  }
  enterVision() {
    const d = this.def;
    this.amb = this.v2.ambience({ color: '#1a3a2a', alpha: 0.45, blend: 'multiply', exposure: 0.85, dur: d.exec + d.recover + 0.2, fin: 0.25, fout: 0.35 });
    // al abrir los ojos, el tiempo del entorno se detiene (5 s fijos, game.startTimeStop); el cronómetro sigue
    if (d.timeStop) this.g.startTimeStop(d.timeStop, this.p.pos);
    this.marks = new Map(); // objeto observado → sprite
    this.scanT = 0;
    this.pulse = 0;
    this.scan(true);
  }
  sprite(key, emoji, ring, size) {
    if (this.marks.has(key)) return this.marks.get(key);
    const mat = new THREE.SpriteMaterial({ map: iconTex(emoji, ring), depthTest: false, depthWrite: false, transparent: true, opacity: 0 });
    const s = new THREE.Sprite(mat);
    s.userData.own = true;
    s.renderOrder = 20;
    s.scale.setScalar(size);
    const it = this.vfx.add(s, 0);
    const h = { s, it, size, kill: () => this.vfx.kill(it), seen: true };
    this.track(h);
    this.marks.set(key, h);
    return h;
  }
  // busca todo lo que hay alrededor (a través de las paredes)
  scan(first) {
    const d = this.def, p = this.p, g = this.g, R = d.range;
    for (const h of this.marks.values()) h.seen = false;
    let ne = 0, nt = 0, nv = 0;
    const near = (x, z) => Math.hypot(x - p.pos.x, z - p.pos.z) < R;
    for (const t of this.combat.enemies()) {
      if (!near(t.pos.x, t.pos.z)) continue;
      ne++;
      const h = this.sprite(t, t.heavy ? '👹' : '👾', '#ff4a4a', t.heavy ? 1.6 : 0.9);
      h.seen = true; h.at = () => V(t.pos.x, t.pos.y + (t.heavy ? t.S.height + (t.flyHeight || 0) + 0.8 : 1.6), t.pos.z);
      if (t.heavy) { // punto débil del jefe
        const w = this.sprite('weak' + t.kind, '🎯', '#ffd24a', 1.1);
        w.seen = true; w.at = () => V(t.pos.x, t.pos.y + t.S.height * 0.55 + (t.flyHeight || 0), t.pos.z); w.pulse = true;
      }
    }
    for (const o of g.world.obstacles || []) { // trampas y obstáculos
      if (!o.alive || !near(o.x, o.z)) continue;
      nt++;
      const h = this.sprite(o, '⚠️', '#ffb02a', 0.9);
      h.seen = true; h.at = () => V(o.x, terrainH(o.x, o.z) + 2.2, o.z);
    }
    const hz = g.hazards;
    if (hz) {
      for (const z of hz.zones || []) if (z.state === 'burn' && near(z.x, z.z)) { nt++; const h = this.sprite(z, '🔥', '#ff6a1a', 0.8); h.seen = true; h.at = () => V(z.x, terrainH(z.x, z.z) + 1.6, z.z); }
      for (const q of hz.pools || []) if (q.state === 'hot' && near(q.x, q.z)) { nt++; const h = this.sprite(q, '🌋', '#ff6a1a', 0.8); h.seen = true; h.at = () => V(q.x, terrainH(q.x, q.z) + 1.4, q.z); }
    }
    for (const v of g.victims || []) { // personas y animales escondidos
      if (v.state !== 'waiting' || !v.wpos || !near(v.wpos.x, v.wpos.z)) continue;
      nv++;
      const h = this.sprite(v, v.info && v.info.icon ? v.info.icon : '🧍', '#6aff9a', 1);
      h.seen = true; h.at = () => V(v.wpos.x, v.wpos.y + (v.height || 1.6) + 0.9, v.wpos.z);
    }
    for (const [key, h] of this.marks) if (!h.seen) { h.kill(); this.marks.delete(key); }
    if (first) ui.banner('find', '👁️', `Visión: ${ne} enemigos · ${nt} trampas · ${nv} por rescatar`);
  }
  tickVision(dt, k) {
    const d = this.def;
    this.eyes(1);
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = 0.5; this.scan(false); }
    this.pulse += dt;
    const fade = Math.min(1, this.t / 0.3) * (k > 0.9 ? (1 - k) / 0.1 : 1);
    for (const h of this.marks.values()) {
      if (!h.at) continue;
      h.s.position.copy(h.at());
      h.s.material.opacity = 0.95 * fade;
      const s = h.pulse ? h.size * (1 + 0.18 * Math.sin(this.pulse * 8)) : h.size * (1 + 0.05 * Math.sin(this.pulse * 4));
      h.s.scale.setScalar(s);
    }
    // el punto débil queda expuesto: el jefe recibe más daño mientras Lira lo ve
    for (const t of this.combat.enemies()) if (t.heavy && Math.hypot(t.pos.x - this.p.pos.x, t.pos.z - this.p.pos.z) < d.range) this.combat.mark(t, 0.3);
  }
}

export const POWER2_CLASSES = {
  speedfx: SpeedFxSkill, katana: KatanaSkill, hammer: HammerSkill, spear: SpearSkill, boomerang: BoomerangSkill,
  axe: AxeSkill, scythe: ScytheSkill, disc: DiscSkill, tornado: TornadoShieldSkill, claws: WindClawsSkill, vision: VisionSkill,
};
