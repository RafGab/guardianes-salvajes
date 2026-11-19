import * as THREE from 'three';
import { glintSprite } from './impactfx.js';
import { rnd, TAU } from './attack.js';
import { Skill, DEG, ease, lerp, clamp, V, boneWorld } from './base.js';
import { glowMat } from './vfx2.js';
import { terrainH } from '../terrain.js';
import { ui } from '../ui.js';
import { Trail } from '../weapons/system.js';
import { SPEED2 } from './speedfx2.js';
import { propsNear, captureProp, dropFlung } from './envreact.js';

// ACTUALIZACIÓN DE BOTONES: animaciones de VELOCIDAD (botón 1), ARMAS (7), Tornados y Garras de Ámbar, Visión de Lira.
// Números en skills/config.js (HERO_SKILLS / HERO_BUTTONS).

const back = (k) => 1 - Math.pow(1 - k, 3);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

/* KIRA — PATINAJE SOBRE HIELO (botón de velocidad)
   · cuchillas de patín de hielo bajo cada pie (crecen al arrancar y se deshacen al frenar)
   · el HIELO SE FORMA DELANTE de ella, en la dirección en que avanza: placas de hielo que se congelan en el suelo
     justo antes de que llegue, cristales que brotan y escarcha que salta hacia delante (nunca detrás) */
let ICE_TEX = null;
function iceTex() {
  if (ICE_TEX) return ICE_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d'), g = x.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, 'rgba(235,250,255,0.95)'); g.addColorStop(0.55, 'rgba(170,225,255,0.8)'); g.addColorStop(0.85, 'rgba(120,200,255,0.45)'); g.addColorStop(1, 'rgba(120,200,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = 1.4;
  for (let i = 0; i < 9; i++) { // grietas del hielo
    let px = 128, py = 128; const a = Math.random() * Math.PI * 2;
    x.beginPath(); x.moveTo(px, py);
    for (let s = 0; s < 5; s++) { px += Math.cos(a + (Math.random() - 0.5) * 0.9) * 20; py += Math.sin(a + (Math.random() - 0.5) * 0.9) * 20; x.lineTo(px, py); }
    x.stroke();
  }
  ICE_TEX = new THREE.CanvasTexture(c);
  return ICE_TEX;
}
let ICE_GEO = null;
function iceAhead(sk, x, z, r, rot) {
  if (!ICE_GEO) { ICE_GEO = new THREE.CircleGeometry(1, 20); ICE_GEO.rotateX(-Math.PI / 2); }
  const p = sk.p, y = p.floorY ? p.floorY(x, z, p.pos.y + 1) : terrainH(x, z);
  const m = new THREE.Mesh(ICE_GEO, new THREE.MeshStandardMaterial({ map: iceTex(), color: 0xe8f8ff, emissive: 0x3a90c8, emissiveIntensity: 0.25, roughness: 0.08, metalness: 0.3, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
  m.material.userData.own = true;
  m.position.set(x, y + 0.03, z); m.rotation.y = rot; m.renderOrder = 3;
  const life = 1.5;
  sk.vfx.add(m, life, (it) => {
    const t = it.t, g = Math.min(1, t / 0.16); // se congela en un instante (crece desde el centro)
    m.scale.set(r * (1 - Math.pow(1 - g, 3)), 1, r * 0.8 * (1 - Math.pow(1 - g, 3)));
    m.material.opacity = 0.9 * (t > life - 0.5 ? (life - t) / 0.5 : 1);
  });
  sk.g.fx.iceShard(x, y + 0.1, z, 0.7);
}

/* ---------- recursos compartidos de los efectos de velocidad (se crean una vez) ---------- */
// NILO: chorro de agua de las botas (cono abierto con franjas que bajan) y burbujas
let JET_GEO = null, BUBBLE_GEO = null, SPEED_GEO = null;
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
    else if (h === 'kyra') { this.sfx('chime'); } // la carga de nieve la hace su propio efecto (kyra())
    // lira (Dona): la entrada bajo tierra la hace su propio efecto (lira())
  }
  get active() { const p = this.p; return p.boostT > 0 || p.dashT > 0 || (p.surfT > 0 && p.surfing); }
  tick(dt) {
    const p = this.p;
    if (!this.active) { this.idle += dt; if (this.idle > (this.hero === 'kyra' ? 0.9 : this.hero === 'halley' ? 2.2 : 0.4)) { this.endStage(); return; } } else this.idle = 0; // la nieve de Kyra se disipa poco a poco
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
    if (this.active && k > 0.6 && this.hero !== 'kairo') this.g.chase.fovKick = Math.max(this.g.chase.fovKick, 5 * k); // el cometa de Kairo no da sensación de cohete
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
  // KYRA (Zorra ártica) — SUPERVELOCIDAD DE NIEVE: una corriente mágica de nieve se forma bajo sus pies y la lleva.
  // No corre ni se vuelve hielo: la nieve es la protagonista. Fases:
  //  1 CARGA: se agacha y la nieve empieza a girar en remolinos alrededor de sus pies
  //  2 ACELERACIÓN: sale disparada con un estallido de nieve hacia atrás
  //  3 DESPLAZAMIENTO: postura aerodinámica sobre la corriente (estela 3D blanca y azul hielo que sigue su
  //    trayectoria), copos y remolinos, se inclina en las curvas y da pequeños saltos sobre la nieve
  //  4 DESACELERACIÓN: la corriente pierde fuerza, la nieve se dispersa hacia los lados y los copos se apagan
  // (Solo visual: la velocidad es la del poder de siempre; el modelo y sus colores no cambian.)
  kyra(dt, k, bx, bz, sp, step, turn) {
    const pose = this.pose, p = this.p, fx = this.g.fx;
    const on = this.active ? 1 : 0;
    const S = this.snow || (this.snow = { t: 0, I: 0, launched: false, hopT: 1.1, hop: 0, whirlT: 0, ended: false });
    S.t += dt;
    // intensidad de la corriente: sube al arrancar y baja en el último medio segundo del impulso
    const fadeOut = p.boostT > 0 ? Math.min(1, p.boostT / 0.6) : 0;
    const want = on * fadeOut;
    S.I = damp(S.I, want, want > S.I ? 6 : 4, dt);
    const I = S.I;
    const charge = S.t < 0.35 ? 1 - S.t / 0.35 : 0;                 // fase 1
    if (on && p.model) p.model.skate = Math.min(1, Math.max(p.model.skate || 0, 0.4 + 0.6 * k)); // la carrera casi se detiene: las piernas patinan (zancadas de kyraArms)
    // ---- pose: preparación agachada → aerodinámica, inclinada en las curvas, montada sobre la corriente
    const sm = this.skSm || (this.skSm = { rx: 0, rz: 0, sy: 1, dy: 0 });
    const kk = Math.min(1, dt * 8);
    this.carve = lerp(this.carve || 0, clamp(-turn * 18, -0.45, 0.45) * k * on, kk);
    S.hopT -= dt * (0.6 + 0.5 * k);
    if (S.hopT <= 0 && I > 0.6 && p.grounded && sp > 3) { S.hopT = 1 + Math.random() * 0.6; S.hop = 0.001; } // pequeño salto sobre la nieve
    let hopY = 0;
    if (S.hop > 0) {
      S.hop += dt / 0.42;
      hopY = Math.sin(Math.min(1, S.hop) * Math.PI) * 0.32;
      if (S.hop >= 1) { S.hop = 0; const f = this.feet(0, bx, bz); for (let i = 0; i < 10; i++) fx.spray(f.x, f.y + 0.1, f.z, rnd(-2, 2), rnd(0.8, 2.2), rnd(-2, 2), 0.7); this.vfx.ring(f.x, null, f.z, { r0: 0.2, r1: 1.3, dur: 0.35, color: 0xffffff, opacity: 0.5 }); }
    }
    sm.rx = lerp(sm.rx, (0.1 + 0.3 * charge + 0.24 * I * (1 - charge)) * (on || I > 0.05 ? 1 : 0), kk);
    sm.sy = lerp(sm.sy, 1 - 0.1 * charge - 0.05 * I, kk);
    sm.dy = lerp(sm.dy, 0.12 * I * (1 - charge), kk); // va montada sobre la corriente, un poco por encima del suelo
    pose.rx = Math.max(pose.rx, sm.rx); pose.rz = this.carve; pose.sy = Math.min(pose.sy, sm.sy); pose.dy = sm.dy + hopY;
    const f0 = this.feet(0, bx, bz);
    // ---- fase 1: la nieve gira alrededor de los pies y acumula energía
    if (charge > 0 && on) {
      const a = S.t * 16;
      for (let i = 0; i < 3; i++) { const aa = a + i * 2.09, r = 0.55 - 0.25 * (1 - charge); fx.mist(f0.x + Math.cos(aa) * r, f0.y + 0.1 + i * 0.12, f0.z + Math.sin(aa) * r, 0xffffff, 0.6); }
      if (Math.random() < 0.6) fx.sparkle(f0.x + rnd(-0.5, 0.5), f0.y + rnd(0.1, 0.6), f0.z + rnd(-0.5, 0.5), Math.random() < 0.5 ? 0xffffff : 0xa8e0ff, 0.6);
      S.whirlT -= dt; if (S.whirlT <= 0) { S.whirlT = 0.09; this.vfx.ring(f0.x, f0.y + 0.08 + Math.random() * 0.3, f0.z, { r0: 0.15, r1: 0.8, dur: 0.3, color: 0xdff4ff, opacity: 0.55 }); }
    }
    // ---- fase 2: estallido al salir disparada
    if (on && !S.launched && charge <= 0 && sp > 0.5) {
      S.launched = true;
      for (let i = 0; i < 26; i++) fx.spray(f0.x, f0.y + 0.08, f0.z, -bx * rnd(2.5, 6) + rnd(-1.5, 1.5), rnd(0.6, 2.8), -bz * rnd(2.5, 6) + rnd(-1.5, 1.5), 0.8);
      for (let i = 0; i < 6; i++) fx.mist(f0.x - bx * rnd(0, 1.2), f0.y + 0.2, f0.z - bz * rnd(0, 1.2), 0xffffff, 1.6);
      this.vfx.ring(f0.x, null, f0.z, { r0: 0.3, r1: 2.6, dur: 0.45, color: 0xffffff, opacity: 0.6 });
      this.g.chase.fovKick = Math.max(this.g.chase.fovKick, 9);
      this.sfx('wind');
    }
    // ---- fase 3: estela 3D de nieve que sigue la trayectoria, copos y remolinos
    const st = this.stream || (this.stream = this.makeStream());
    this.updateStream(st, 0, dt); // (la antigua corriente de nieve quedaba DETRÁS: ya no se muestra)
    this.skateBlades(I, dt);
    if (I > 0.1) {
      const ax = -bx, az = -bz; // dirección de avance
      // el suelo se congela DELANTE de ella: placas de hielo que aparecen justo antes de que llegue
      this.iceT = (this.iceT || 0) - dt * (0.7 + sp * 0.12);
      if (this.iceT <= 0 && sp > 1) {
        this.iceT = 0.11;
        const d = rnd(1.0, 1.9) + sp * 0.07, s = rnd(-0.3, 0.3);
        iceAhead(this, p.pos.x + ax * d - az * s, p.pos.z + az * d + ax * s, rnd(0.55, 0.85) * (0.75 + 0.35 * I), p.facing + rnd(-0.4, 0.4));
      }
      // escarcha y cristales que brotan por delante de las cuchillas
      const n = 1 + Math.round(2 * I);
      for (let i = 0; i < n; i++) { const d = rnd(0.5, 1.6), s = rnd(-0.4, 0.4); fx.spray(p.pos.x + ax * d - az * s, f0.y + 0.08, p.pos.z + az * d + ax * s, ax * rnd(0.5, 1.6), rnd(0.6, 1.6), az * rnd(0.5, 1.6), 0.5 + 0.25 * I); }
      if (Math.random() < 0.7 * I) { const d = rnd(0.6, 2.2); fx.sparkle(p.pos.x + ax * d + rnd(-0.4, 0.4), f0.y + rnd(0.05, 0.5), p.pos.z + az * d + rnd(-0.4, 0.4), Math.random() < 0.5 ? 0xffffff : 0xa8e0ff, 0.5); }
      if (Math.random() < 0.35 * I) { const d = rnd(0.8, 1.8); fx.iceShard(p.pos.x + ax * d + rnd(-0.3, 0.3), f0.y + 0.08, p.pos.z + az * d + rnd(-0.3, 0.3), 0.6); }
      if (Math.abs(this.carve) > 0.18 && Math.random() < 0.6) { const s = Math.sign(this.carve); fx.spray(f0.x + ax * 0.3, f0.y + 0.1, f0.z + az * 0.3, -bz * s * 2.6, 1.6, bx * s * 2.6, 0.75); } // el hielo salta en las curvas, hacia fuera
      this.lineT = (this.lineT || 0) - dt;
      if (k > 0.45 && this.lineT <= 0) { this.lineT = 0.06 / k; this.speedLine(bx, bz, k); }
    }
    // ---- fase 4: al frenar, la nieve se dispersa hacia ambos lados
    if (S.launched && !S.ended && (fadeOut < 0.5 || !on)) {
      S.ended = true;
      for (let s = -1; s <= 1; s += 2) for (let i = 0; i < 14; i++) fx.spray(f0.x, f0.y + 0.1, f0.z, -bz * s * rnd(2, 4.5) + bx * rnd(-0.5, 1), rnd(0.8, 2.4), bx * s * rnd(2, 4.5) + bz * rnd(-0.5, 1), 0.8);
      for (let i = 0; i < 8; i++) fx.mist(f0.x + rnd(-1, 1), f0.y + 0.2, f0.z + rnd(-1, 1), 0xffffff, 1.2);
      for (let i = 0; i < 12; i++) fx.sparkle(f0.x + rnd(-1.2, 1.2), f0.y + rnd(0.1, 0.9), f0.z + rnd(-1.2, 1.2), Math.random() < 0.5 ? 0xffffff : 0xa8e0ff, 0.4);
    }
  }
  // CUCHILLAS DE PATÍN: hoja de acero helado con borde luminoso y soporte bajo cada pie (hueso foot_L / foot_R)
  skateBlades(I, dt) {
    const p = this.p, B = p.model && p.model.bones;
    if (!B || !B.foot_L) return;
    if (!this._blades) {
      const steel = new THREE.MeshStandardMaterial({ color: 0xd8ecff, metalness: 0.9, roughness: 0.18, emissive: 0x3a7ab8, emissiveIntensity: 0.25 });
      const glow = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      steel.userData.own = glow.userData.own = true;
      const bladeGeo = new THREE.BoxGeometry(0.014, 0.045, 0.34), edgeGeo = new THREE.BoxGeometry(0.02, 0.008, 0.36), postGeo = new THREE.BoxGeometry(0.03, 0.05, 0.03);
      this._bladeRes = [steel, glow, bladeGeo, edgeGeo, postGeo];
      this._blades = ['L', 'R'].map((s) => {
        const bone = B[`foot_${s}`], g = new THREE.Group();
        const blade = new THREE.Mesh(bladeGeo, steel); blade.position.y = -0.035;
        const edge = new THREE.Mesh(edgeGeo, glow); edge.position.y = -0.058;
        const tip = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 6, 12, Math.PI), steel); tip.rotation.y = Math.PI / 2; tip.position.set(0, -0.03, 0.17); tip.geometry.userData.mine = true;
        for (const z of [-0.09, 0.09]) { const q = new THREE.Mesh(postGeo, steel); q.position.set(0, 0, z); g.add(q); }
        g.add(blade, edge, tip);
        for (const o of [blade, edge, tip]) o.castShadow = o !== edge;
        bone.add(g);
        return { g, bone, s };
      });
    }
    const v = new THREE.Vector3();
    for (const b of this._blades) {
      // escala del hueso en el mundo → la cuchilla mide siempre lo mismo (en metros); bajo la suela, algo adelantada
      b.bone.getWorldScale(v);
      const ws = v.x || 1, k = Math.max(0.0001, I);
      b.g.scale.set(k / ws, k / ws, k / ws);
      // el tobillo está a 0,075 (unidades del modelo) sobre la suela: la cuchilla queda justo bajo la suela y sigue al pie
      b.g.position.set(0, -0.075 + 0.045 / ws, 0.06 / ws);
      b.g.visible = I > 0.02;
    }
  }
  // corriente de nieve: una cinta abombada (sección en arco) que recorre las últimas posiciones de Kyra
  makeStream() {
    const N = 34, M = 7;
    const pos = new Float32Array(N * M * 3), uv = new Float32Array(N * M * 2), idx = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { uv[(i * M + j) * 2] = j / (M - 1); uv[(i * M + j) * 2 + 1] = i / (N - 1); }
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < M - 1; j++) { const a = i * M + j, b = a + M; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const u = { uT: { value: 0 }, uK: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uT; uniform float uK;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          float across = vUv.x, along = vUv.y;
          float flow = 0.5 + 0.5 * sin(along * 38.0 - uT * 16.0 + sin(across * 9.0 + uT * 3.0) * 2.2);
          float swirl = 0.5 + 0.5 * sin(across * 14.0 + along * 22.0 - uT * 10.0);
          float flake = step(0.93, h(floor(vec2(across * 40.0, along * 120.0 - uT * 30.0))));
          vec3 white = vec3(0.97, 0.99, 1.0), ice = vec3(0.6, 0.84, 1.0);
          vec3 col = mix(ice, white, 0.35 + 0.65 * flow * swirl) + flake * 0.4;
          float edge = smoothstep(0.0, 0.22, across) * smoothstep(1.0, 0.78, across);
          float a = edge * (1.0 - along) * (0.45 + 0.55 * flow) * uK;
          gl_FragColor = vec4(col, clamp(a + flake * edge * (1.0 - along) * uK * 0.5, 0.0, 0.95));
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false; m.renderOrder = 4;
    this.prop(m);
    return { m, geo, pos, u, N, M };
  }
  updateStream(st, I, dt) {
    st.u.uT.value += dt; st.u.uK.value = I;
    st.m.visible = I > 0.02 && this.path.length > 2;
    if (!st.m.visible) return;
    const { N, M, pos } = st, P = this.path, p = this.p;
    for (let i = 0; i < N; i++) {
      const q = P[Math.min(P.length - 1, i)], q2 = P[Math.min(P.length - 1, i + 1)] || q;
      let dx = q.x - q2.x, dz = q.z - q2.z; const l = Math.hypot(dx, dz);
      if (l < 1e-4) { dx = Math.sin(p.facing); dz = Math.cos(p.facing); } else { dx /= l; dz /= l; }
      const nx = -dz, nz = dx, u = i / (N - 1);
      const w = (0.7 + 0.25 * I) * (1 - u * 0.7), hh = (0.4 * I) * (1 - u) * (0.85 + 0.15 * Math.sin(this.t * 9 + i * 0.7));
      for (let j = 0; j < M; j++) {
        const v = j / (M - 1), s = (v - 0.5) * 2, o = (i * M + j) * 3;
        pos[o] = q.x + nx * s * w; pos[o + 1] = q.y + 0.03 + Math.sin(v * Math.PI) * hh; pos[o + 2] = q.z + nz * s * w;
      }
    }
    st.geo.attributes.position.needsUpdate = true;
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
  // DONA (Lince) — VELOCIDAD BAJO TIERRA: se zambulle en el suelo, avanza por debajo levantando un montículo de
  // tierra que deja un surco removido y emerge varios metros más adelante con una explosión de tierra, polvo y rocas.
  // (Solo visual: la velocidad y el recorrido son los del poder de siempre; el modelo no cambia, solo se oculta bajo tierra.)
  lira(dt, k, bx, bz, sp) {
    const p = this.p, pose = this.pose, fx = this.g.fx;
    const st = this.dig || (this.dig = { ph: this.active && sp > 0.3 ? 'dive' : 'none', t: 0, clodT: 0 });
    st.t += dt;
    const gy = p.floorY(p.pos.x, p.pos.z, p.pos.y + 0.5), H = p.H || 1.6;
    if (st.ph === 'none') return;
    if (st.ph === 'dive') {
      if (st.t <= dt) this.digBurst(p.pos.x, gy, p.pos.z, 0.7, bx, bz); // entrada: la tierra se abre
      const e = ease(Math.min(1, st.t / 0.24));
      pose.dy = -H * 1.1 * e; pose.rx = Math.max(pose.rx, 0.9 * e); // se lanza de cabeza al suelo
      if (Math.random() < 0.7) fx.dustPuff(p.pos.x, gy, p.pos.z, 1.1);
      if (st.t >= 0.24) { st.ph = 'under'; st.t = 0; }
      return;
    }
    if (st.ph === 'under') {
      pose.hidden = true; pose.dy = -H * 1.1;
      // emerge antes de que se acabe el impulso, o si salta / cae / se detiene
      if (!this.active || p.boostT < 0.35 || (!p.grounded && st.t > 0.15) || (sp < 0.5 && st.t > 0.3)) { st.ph = 'out'; st.t = 0; this.digBurst(p.pos.x, gy, p.pos.z, 1.25, bx, bz); return; }
      const m = this.mound || (this.mound = this.makeMound());
      m.visible = true;
      m.position.set(p.pos.x, gy - 0.05, p.pos.z);
      m.rotation.y = p.facing;
      const w = 1 + Math.sin(this.t * 22) * 0.06;
      m.scale.set(0.55 * w, (0.3 + 0.08 * Math.min(1, k)) * (2 - w), 0.75 * w);
      m.children.forEach((c, i) => { c.position.y = c.userData.y + Math.abs(Math.sin(this.t * 14 + i * 1.7)) * 0.25; c.rotation.x += dt * 6; });
      // la tierra salta por encima del montículo y por detrás
      if (Math.random() < 0.6) fx.rock(p.pos.x - bx * 0.2, gy + 0.25, p.pos.z - bz * 0.2);
      for (let i = 0; i < 2; i++) fx.dustPuff(p.pos.x + bx * 0.6 + rnd(-0.3, 0.3), gy, p.pos.z + bz * 0.6 + rnd(-0.3, 0.3), 1.2 + 0.4 * k);
      this.shake(0.03 + 0.03 * k);
      // surco de tierra removida que se va asentando
      st.clodT -= dt;
      if (st.clodT <= 0 && sp > 1) { st.clodT = 0.045; this.clod(p.pos.x + bx * 0.5 + rnd(-0.15, 0.15), gy, p.pos.z + bz * 0.5 + rnd(-0.15, 0.15), 0.7 + 0.4 * k); }
      if (Math.random() < 0.12) this.track(this.v2.crack(p.pos.x + bx * 0.8, p.pos.z + bz * 0.8, 0.9, Math.atan2(-bx, -bz) + rnd(-0.6, 0.6), { life: 1.1, width: 0.1, color: 0x3a2a1a }));
      return;
    }
    if (st.ph === 'out') { // sale disparada del suelo con un pequeño salto
      if (this.mound) this.mound.visible = false;
      const u = Math.min(1, st.t / 0.38), e = 1 - Math.pow(1 - u, 3);
      pose.dy = -H * 1.1 * (1 - e) + Math.sin(u * Math.PI) * 0.55;
      pose.rx = Math.max(pose.rx, -0.35 * (1 - u));
      if (st.t >= 0.38) st.ph = 'done';
    }
  }
  // montículo de tierra que avanza sobre Dona mientras va bajo tierra
  makeMound() {
    const g = new THREE.Group();
    const earth = new THREE.MeshStandardMaterial({ color: 0x5a4026, roughness: 1, flatShading: true });
    const stone = new THREE.MeshStandardMaterial({ color: 0x7a6a58, roughness: 0.95, flatShading: true });
    const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), earth);
    dome.scale.set(1, 1, 1.2); g.add(dome);
    const rock = new THREE.IcosahedronGeometry(0.22, 0);
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(rock, i % 2 ? stone : earth);
      const a = (i / 6) * TAU;
      c.position.set(Math.cos(a) * 0.7, 0.6, Math.sin(a) * 0.8); c.userData.y = 0.55 + (i % 3) * 0.12;
      c.scale.setScalar(0.7 + (i % 3) * 0.3);
      g.add(c);
    }
    g.traverse((o) => { o.castShadow = true; o.userData.own = true; });
    this.prop(g);
    return g;
  }
  // terrón del surco: brota un poco y se hunde poco a poco
  clod(x, y, z, k) {
    if (!this._clodGeo) { this._clodGeo = new THREE.IcosahedronGeometry(0.2, 0); this._clodMat = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 1, flatShading: true }); }
    const m = new THREE.Mesh(this._clodGeo, this._clodMat);
    m.position.set(x, y, z);
    m.rotation.set(rnd(0, TAU), rnd(0, TAU), 0);
    const s = (0.7 + Math.random() * 0.8) * k, life = 1.6;
    m.scale.setScalar(0.001);
    this.vfx.add(m, life, (it) => { const t = it.t, g = t < 0.12 ? t / 0.12 : 1 - Math.max(0, (t - 0.7) / (life - 0.7)); m.scale.set(s * g, s * g * 0.55, s * g); m.position.y = y - (1 - g) * 0.1; });
  }
  // la tierra se abre (entrada) o estalla (salida): polvo, rocas, terrones, grietas y onda
  digBurst(x, y, z, k, bx, bz) {
    const fx = this.g.fx;
    for (let i = 0; i < Math.round(10 * k); i++) fx.rock(x, y + 0.2, z);
    for (let i = 0; i < Math.round(8 * k); i++) fx.dustPuff(x + rnd(-0.8, 0.8) * k, y, z + rnd(-0.8, 0.8) * k, 1.5 + k);
    for (let i = 0; i < Math.round(8 * k); i++) { const a = rnd(0, TAU), r = rnd(0.3, 1.1) * k; this.clod(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0.9 + 0.5 * k); }
    for (let i = 0; i < 5; i++) this.track(this.v2.crack(x, z, 1.1 * k + 0.4, (i / 5) * TAU + rnd(-0.3, 0.3), { life: 1.4, width: 0.13, color: 0x3a2a1a }));
    this.vfx.ring(x, null, z, { r0: 0.3, r1: 2.2 + 2.2 * k, dur: 0.45, color: 0x9a7a52, opacity: 0.6, additive: false });
    this.shake(0.12 + 0.2 * k);
    this.sfx(k > 1 ? 'crack' : 'rumble');
    void bx; void bz;
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

// mejoras del botón de velocidad (speedfx2.js): Kairo, Kira (brazos), Bada, Ámbar y Nilo
{
  const P = SpeedFxSkill.prototype, kyra0 = P.kyra, nilo0 = P.nilo;
  Object.assign(P, { kairo: SPEED2.kairo, halley: SPEED2.halley, ambar: SPEED2.ambar, sandBody: SPEED2.sandBody, bubble2: SPEED2.bubble2, kyraArms: SPEED2.kyraArms, niloPlus: SPEED2.niloPlus, cleanup: SPEED2.cleanup });
  P.kyra = function (dt, k, bx, bz, sp, step, turn) { kyra0.call(this, dt, k, bx, bz, sp, step, turn); this.kyraArms(dt, k, sp); };
  P.nilo = function (dt, k, bx, bz, sp, step, turn) { nilo0.call(this, dt, k, bx, bz, sp, step, turn); this.niloPlus(dt, k, bx, bz, sp); };
  // las burbujas de la estela de Nilo usan el nuevo diseño (reflejos, irisaciones y trayectorias variadas)
  P.bubble = function (x, y, z, r) { const p = this.p, s = Math.hypot(p.vx, p.vz) || 1; this.bubble2(x, y, z, r * 1.15, -p.vx / s * 0.5, -p.vz / s * 0.5); };
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
    // filo de luz blanca en el borde exterior del tajo: el golpe se ve más rápido y con más energía
    const geo2 = new THREE.RingGeometry(r * 0.97, r * 1.03, 32, 1, -arc * DEG / 2, arc * DEG);
    const mat2 = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
    const m2 = new THREE.Mesh(geo2, mat2);
    m2.userData.own = true;
    m2.rotation.copy(m.rotation);
    g.add(m2);
    const tp = this.tipPos();
    for (let i = 0; i < 6; i++) this.g.fx.sparkle(tp.x, tp.y, tp.z, i % 2 ? color : 0xffffff, 2.4);
    return this.vfx.add(g, life, (it) => { const k = it.t / life; mat.opacity = 0.7 * (1 - k) * (1 - k); mat2.opacity = 0.6 * (1 - k) * (1 - k); m.scale.setScalar(0.85 + 0.25 * k); m2.scale.setScalar(0.85 + 0.27 * k); if (it.t >= life - 0.001) { geo.dispose(); geo2.dispose(); } }); // se desvanece rápido: no tapa la escena
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
      this.W.swing(d.swing + 0.16); // estela de la hoja algo más larga
      this.sfx('snap');
      const p = this.p;
      this.crescent(p.pos.y + p.H * 0.55, { r: d.range, arc, color: d.color, tilt, vertical });
      this.crescent(p.pos.y + p.H * 0.5, { r: d.range * 0.8, arc: arc * 0.8, color: 0xff8a2a, tilt: tilt * 0.8, width: 0.15, vertical });
      this.crescent(p.pos.y + p.H * 0.6, { r: d.range * 1.12, arc: arc * 0.9, color: 0x6ac8ff, tilt: tilt * 1.1, width: 0.06, vertical, life: 0.18 }); // filo de energía azul (lava y trueno)
      this.katanaFlash(0.8);
      const n = this.hitArc(d.range, arc, d.damage * mul, d.force, (t) => this.katanaImpact(t, 1));
      if (n) { this.shake(0.15); this.g.chase.fovKick = Math.max(this.g.chase.fovKick, 2); }
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
        const n = this.hitArc(d.range * 1.4, 40, d.damage * this.mul, d.force * 1.6, (t) => this.katanaImpact(t, 1.6));
        this.finisher(0xff7a1a, 0x4aa8ff);
        this.katanaFinale();
        if (n) this.shake(0.3);
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

/* EFECTOS DE COMBATE DE LA KATANA (Jaglion): destello en el filo al cortar, impacto con fuerza (destello,
   onda, chispas de lava, rayo azul y una sacudida breve) y un remate final con onda de energía y rayos. */
Object.assign(KatanaSkill.prototype, {
  katanaFlash(k = 1) {
    const tp = this.tipPos();
    if (this.vfx.orb) this.vfx.orb(tp.clone(), { r: 0.25 * k, color: 0xffd8a0, opacity: 0.85, life: 0.12, grow: 1.5 });
    for (let i = 0; i < 5; i++) this.g.fx.spark.emit(tp.x, tp.y, tp.z, rnd(-3, 3), rnd(-1, 3), rnd(-3, 3), 0.25, 0.08, 0.02, 0xffffff, 0xff7a1a, 1, 0, 6, 2);
  },
  katanaImpact(t, k = 1) {
    this.impactAt(t, k);
    const y = t.pos.y + (t.heavy ? t.S.height * 0.45 : 0.8), at = V(t.pos.x, y, t.pos.z);
    if (this.vfx.orb) this.vfx.orb(at.clone(), { r: 0.45 * k, color: 0xffc080, opacity: 0.85, life: 0.16, grow: 1.4 });
    this.vfx.ring(t.pos.x, y, t.pos.z, { r0: 0.2, r1: 1.4 * k, dur: 0.22, color: 0xff8a2a, opacity: 0.8 });
    this.vfx.ring(t.pos.x, null, t.pos.z, { r0: 0.3, r1: 1.6 * k, dur: 0.35, color: 0x6ac8ff, opacity: 0.5 });
    this.vfx.sparks(t.pos.x, y, t.pos.z, 0xffb060, Math.round(10 * k), 2.8 * k);
    for (let i = 0; i < 6; i++) this.g.fx.ember(t.pos.x + rnd(-0.3, 0.3), y, t.pos.z + rnd(-0.3, 0.3), 1);
    this.vfx.bolt(this.tipPos(), at.clone(), { color: 0x6ac8ff, life: 0.12, jag: 0.25, segs: 6 });
    this.shake(0.06 * k);
  },
  // REMATE: onda de energía que barre el suelo, columna de luz en el filo y rayos radiales
  katanaFinale() {
    const p = this.p, c = V(p.pos.x, p.pos.y + 0.2, p.pos.z);
    this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.5, r1: 6, dur: 0.5, color: 0xff7a1a, opacity: 0.75 });
    this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.3, r1: 4.5, dur: 0.6, color: 0x4aa8ff, opacity: 0.6 });
    for (let i = 0; i < 6; i++) { const a = p.facing + (i - 2.5) * 0.35, r = rnd(3, 5.5); this.vfx.bolt(c.clone(), V(p.pos.x + Math.sin(a) * r, p.pos.y + 0.3, p.pos.z + Math.cos(a) * r), { color: i % 2 ? 0x6ac8ff : 0xffb060, life: 0.2, jag: 0.5, segs: 7 }); }
    const tp = this.tipPos();
    this.v2.beam(tp, V(tp.x, tp.y + 4, tp.z), { r: 0.12, color: 0xffd070, opacity: 0.7, life: 0.2 });
    for (let i = 0; i < 12; i++) this.g.fx.flame(p.pos.x + rnd(-1.2, 1.2), p.pos.y + 0.2, p.pos.z + rnd(-1.2, 1.2), 0.6, 0.2);
    this.g.chase.fovKick = Math.max(this.g.chase.fovKick, 5);
  },
});

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
  begin() {
    // con la MIRA activa: dispara hacia la retícula (objetivo fijado o punto apuntado); sin ella, apuntado automático
    const ai = this.g.aimSys && this.g.aimSys.on ? this.g.aimSys.info : null;
    this.aimed = ai ? { point: ai.point.clone(), target: ai.target } : null;
    if (this.aimed) { this.target = this.aimed.target; this.face(this.aimed.point.x, this.aimed.point.z); }
    else this.target = this.aim(this.def.range, this.def.coneDeg * 2);
    this.draw(); this.start(); return true;
  }
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
    const t = this.aimed ? (this.aimed.target && !this.aimed.target.dead ? this.aimed.target : null) : this.target && !this.target.dead ? this.target : this.combat.aimTarget(p.pos.x, p.pos.z, p.facing, d.coneDeg * DEG, d.range);
    const to = t ? V(t.pos.x, t.pos.y + (t.heavy ? t.S.height * 0.5 : 0.6), t.pos.z) : this.aimed ? this.aimed.point.clone() : V(m.x + f.x * d.range, m.y, m.z + f.z * d.range);
    if (this.aimed && !t && to.distanceTo(m) < 1) to.addScaledVector(V(f.x, 0, f.z), d.range); // punto demasiado cerca: sigue de frente
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
    // destello de agua que acompaña al bumerán en vuelo
    this.glint = glintSprite(0x9af0ff);
    this.glint.visible = true; this.glint.material.opacity = 0.9;
    this.g.scene.add(this.glint);
    this.track({ kill: () => { this.g.scene.remove(this.glint); this.glint.material.dispose(); } });
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
    if (this.glint) { this.glint.position.copy(pos); this.glint.scale.setScalar((0.9 + 0.3 * Math.sin(this.t * 40)) * pw); this.glint.material.rotation = this.t * 8; }
    if (Math.random() < 0.6) this.g.fx.spray(pos.x, pos.y, pos.z, 0, 0.5, 0, 0.8);
    if (Math.random() < 0.5) this.g.fx.splash(pos.x, pos.y, pos.z, 2, 0.4);
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
    // REMATE con los dos discos aún en el aire: los llama de vuelta y los relanza juntos en cuanto llegan a sus alas
    this.recall = false;
    if (parts.length && !ready.length) {
      if (this.step !== 2) return false; // fuera del remate: se espera a que vuelvan (como antes)
      this.recall = true;
      parts.forEach((pt) => { pt.recall = true; });
    }
    // COMBO DE DISCOS (mismo sistema de combos que las demás armas: W.nextStep, ritmo de pulsación):
    //  1.º golpe → un disco con un ala · 2.º → el otro disco con la otra ala · 3.º (remate) → los discos que
    //  estén en sus alas a la vez, más rápidos y con curva. Así puede encadenar lanzamientos seguidos.
    const pick = (pref) => (ready.includes(pref) ? [pref] : [ready[0]]);
    this.which = this.recall ? parts.map((_, i) => i) : !ready.length ? [0] : this.step === 2 ? ready : pick(this.step === 1 ? 1 : 0);
    this.wing = !!(parts[0] && parts[0].wing);
    this.start();
    return true;
  }
  build() {
    const d = this.def, extra = this.drawn ? 0.12 : 0;
    this.armPart = this.which.length > 1 ? -1 : this.which[0];
    const both = this.which.length > 1;
    const call = this.recall ? [{ name: 'llamar', dur: 1.4, tick: () => { // las alas se abren y los discos vuelven volando
      this.energy(0xffc020, 1, 1);
      if (this.W.cur.parts.every((pt) => pt.home)) this.endStage();
    } }] : [];
    if (this.wing) {
      this.thrown = false;
      const sideSpin = both ? 0 : (this.W.cur.parts[this.which[0]].side > 0 ? 0.35 : -0.35); // el cuerpo acompaña al ala que lanza
      return [...call,
        // el ala se abre hacia fuera y atrás (carga)
        this.stage('apuntar', d.prep + extra + (both ? 0.08 : 0), { x: 0.85, y: -0.45, f: -0.25, w: 0.1 }, { spin: -sideSpin, rx: -0.05, tick: () => this.energy(0xff4a2a, 1, 0.8) }),
        // barrido rápido hacia delante: el disco sale a mitad del gesto, con la velocidad del ala
        this.stage('lanzar', 0.16, { x: 0.3, y: 1.35, f: 0.55, w: -0.3 }, { spin: sideSpin * 0.8, rx: 0.12, easeFn: back, tick: (dt, k) => {
          if (!this.thrown && k >= 0.45) { this.thrown = true; this.which.forEach((i, n) => this.throwDisc(i, n)); if (this.step === 2) this.finisher(0xff3a1a, 0xffc020); }
        } }),
        this.recover(d.recover + 0.08),
      ];
    }
    return [...call,
      this.stage('apuntar', d.prep + extra + (this.step === 2 ? 0.1 : 0), { x: -0.8, y: -0.45, f: -0.3 }, { spin: this.step === 1 ? 0.5 : -0.5, enter: () => { this.p.powerAnim = 1; }, tick: () => this.energy(0xff4a2a, 2, 1) }),
      this.stage('lanzar', 0.12, { x: -0.8, y: 0.4, f: -0.3 }, { spin: this.step === 1 ? -0.3 : 0.4, easeFn: back, enter: () => { this.which.forEach((i, k) => this.throwDisc(i, k)); if (this.step === 2) this.finisher(0xff3a1a, 0xffc020); } }),
      this.recover(d.recover),
    ];
  }
  throwDisc(idx, order) {
    const d = this.def, p = this.p, f = this.fwd, W = this.W;
    const part = W.cur && W.cur.parts[idx];
    if (part && !part.home) return; // ya está volando
    if (part) part.recall = false;
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
    const trail = new Trail(this.g.scene, 0xff3a1a, 0xffc020, 26, 0.6); // estela más larga y viva
    const glow = new Trail(this.g.scene, 0xffe080, 0xff5a1a, 14, 0.35);
    const fast = this.step === 2 ? 1.25 : 1; // el remate sale más rápido
    // salida: destello y chispas en el ala (sensación de potencia)
    vfxOut(this, startP);
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
      if (spin) spin.rotation.z += dt * (back ? 22 : 46); // gira mucho más rápido al ir lanzado
      if (!back) g.quaternion.slerp(qFly, Math.min(1, dt * 14)); // se aplana al salir (sin giro brusco)
      light = back ? Math.max(0, light - dt / 0.15) : 1; // al volver: se apaga en 0,15 s, sin cortes bruscos
      W.partLight(idx, light);
      const r = 0.2, a = it.t * 30;
      if (!back) { trail.push(V(g.position.x + Math.cos(a) * r, g.position.y, g.position.z + Math.sin(a) * r), V(g.position.x - Math.cos(a) * r, g.position.y, g.position.z - Math.sin(a) * r)); glow.push(V(g.position.x, g.position.y + 0.08, g.position.z), V(g.position.x, g.position.y - 0.08, g.position.z)); }
      trail.update(dt, !back); glow.update(dt, !back);
      if (!back && Math.random() < 0.5) fx.spark.emit(g.position.x, g.position.y, g.position.z, -dir.x * 4 + rnd(-1, 1), rnd(-0.5, 1), -dir.z * 4 + rnd(-1, 1), 0.25, 0.07, 0.02, 0xffe080, 0xff3a1a, 0.9, 0, 0, 2); // chispas de energía
      if (!back && Math.random() < 0.7) fx.sparkle(g.position.x, g.position.y, g.position.z, Math.random() < 0.5 ? 0xff3a1a : 0xffc020, 1.2);
      if (part && part.recall && !back) { back = true; part.recall = false; } // llamado para el remate
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
          // IMPACTO: destello, onda, chispas y una pequeña sacudida
          vfx.ring(target.pos.x, to.y, target.pos.z, { r0: 0.2, r1: 1.6, dur: 0.3, color: 0xff3a1a });
          vfx.ring(target.pos.x, null, target.pos.z, { r0: 0.2, r1: 1.2, dur: 0.35, color: 0xffc020, opacity: 0.6 });
          if (vfx.orb) vfx.orb(to.clone(), { r: 0.45, color: 0xffd080, opacity: 0.8, life: 0.18, grow: 1.2 });
          vfx.sparks(to.x, to.y, to.z, 0xffb040, 10, 3);
          this.shake(0.06);
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
      // el remate curva su trayectoria (los dos discos se abren en arco y convergen)
      if (fast > 1 && !target) { const c = order ? -1 : 1; dir.x += -dir.z * c * dt * 1.4; dir.z += dir.x * c * dt * 1.4; dir.normalize(); }
      g.position.addScaledVector(dir, d.speed * fast * dt);
      travelled += d.speed * fast * dt;
      if (!target && travelled > d.range) back = true;
    });
    // al terminar su vuelo, el disco reaparece en la mano
    let finished = false;
    const orig = it0.onUpdate;
    it0.onUpdate = (it, dt) => { orig(it, dt); if (!finished && it.t >= LIFE - 0.001) { finished = true; trail.dispose(); glow.dispose(); W.partLight(idx, 0); W.setHome(idx, true); } };
  }
}

/* ====================================================================== */
/*  ÁMBAR — ESCUDO: TORNADOS ENVOLVENTES                                   */
/* ====================================================================== */
// destello de salida de un disco (en el ala que lo lanza)
function vfxOut(sk, at) {
  sk.vfx.ring(at.x, at.y, at.z, { r0: 0.1, r1: 0.9, dur: 0.18, color: 0xffc020, opacity: 0.7 });
  if (sk.vfx.orb) sk.vfx.orb(at.clone(), { r: 0.3, color: 0xffe0a0, opacity: 0.8, life: 0.14, grow: 1 });
  for (let i = 0; i < 6; i++) sk.g.fx.sparkle(at.x, at.y, at.z, i % 2 ? 0xff3a1a : 0xffc020, 2.2);
}
const TORN_DEB = { geo: null, mat: null }; // piedras, ramas y hojas que arrancan los tornados (compartidas)
export class TornadoShieldSkill extends Skill {
  begin() { this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'invocar', dur: d.prep, enter: this.enterCall, tick: (dt, k) => { pose.rx = -0.2 * k; pose.spin = k * TAU * 0.5; this.place(back(k), 1, dt); } },
      { name: 'escudo', dur: d.exec, tick: this.tickShield },
      { name: 'disipar', dur: d.recover, enter: () => this.releaseDebris(), tick: (dt, k) => { pose.spin = 0; this.place(1 - k, (this.rr || 1) + 0.6 * k, dt); } },
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
    this.rr = 1;
    this.gatherDebris();
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
  /* FUERZA DE SUCCIÓN CON FÍSICA: los objetos cercanos (los del escenario que se pueden arrastrar y piedras, ramas
     y hojas que arranca del suelo) se aceleran hacia la tormenta, se elevan y giran a su alrededor, cada uno con su
     radio, altura, velocidad y giro propios. Al terminar, la fuerza se apaga poco a poco y caen con gravedad,
     rebotando y quedándose en el suelo (no desaparecen de golpe ni atraviesan el terreno). */
  gatherDebris() {
    const g = this.g, p = this.p, d = this.def;
    this.debris = [];
    for (const pr of propsNear(g, p.pos.x, p.pos.z, d.radius * 1.6)) { const it = captureProp(g, pr); if (it) this.debris.push(this.initDebris(it)); }
    // piedras, ramas y hojas del suelo
    if (!TORN_DEB.geo) {
      TORN_DEB.geo = [new THREE.DodecahedronGeometry(1, 0), new THREE.BoxGeometry(0.25, 0.25, 2.2), new THREE.PlaneGeometry(1, 0.7)];
      TORN_DEB.mat = [new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 0.95, flatShading: true }), new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: 0x8aa04a, roughness: 0.8, side: THREE.DoubleSide })];
    }
    const n = 12;
    for (let i = 0; i < n; i++) {
      const kind = i % 4 === 0 ? 1 : i % 3 === 0 ? 2 : 0, a = rnd(0, TAU), r = rnd(2.5, d.radius * 1.4);
      const x = p.pos.x + Math.cos(a) * r, z = p.pos.z + Math.sin(a) * r;
      const m = new THREE.Mesh(TORN_DEB.geo[kind], TORN_DEB.mat[kind]);
      const s = kind === 0 ? rnd(0.12, 0.3) : kind === 1 ? rnd(0.35, 0.6) : rnd(0.25, 0.45);
      m.scale.setScalar(s); m.castShadow = true;
      m.position.set(x, terrainH(x, z) + s * 0.5, z);
      m.rotation.set(rnd(0, TAU), rnd(0, TAU), rnd(0, TAU));
      g.scene.add(m);
      this.debris.push(this.initDebris({ mesh: m, size: s * (kind === 1 ? 2 : 1), spin: new THREE.Vector3(rnd(-4, 4), rnd(-4, 4), rnd(-4, 4)), own: true }));
      this.g.fx.dustPuff(x, terrainH(x, z) + 0.1, z, 0.8);
    }
  }
  initDebris(it) {
    const d = this.def;
    it.vel = new THREE.Vector3(0, 0, 0);
    it.orbitR = d.orbit * rnd(0.85, 1.45); // cada uno con su órbita, altura y velocidad
    it.orbitH = rnd(0.6, 3.4);
    it.wSpeed = rnd(4, 8) * (Math.random() < 0.85 ? 1 : 1.3);
    it.phase = rnd(0, TAU);
    it.delay = rnd(0, 0.5);                // no arrancan todos a la vez
    return it;
  }
  tickDebris(dt, strength) {
    const p = this.p;
    for (const it of this.debris || []) {
      it.delay -= dt;
      if (it.delay > 0) continue;
      const m = it.mesh, dx = m.position.x - p.pos.x, dz = m.position.z - p.pos.z, r = Math.hypot(dx, dz) || 0.001;
      const ux = dx / r, uz = dz / r;
      // fuerza radial hacia su órbita + empuje tangencial (giro) + sustentación hacia su altura, con amortiguación
      const R = it.orbitR * (this.rr || 1), wantY = p.pos.y + it.orbitH + 0.25 * Math.sin(this.t * 2 + it.phase);
      const fr = (R - r) * 9, ft = it.wSpeed * 2.6 - (it.vel.x * -uz + it.vel.z * ux) * 1.8, fy = (wantY - m.position.y) * 7;
      it.vel.x += (ux * fr - uz * ft) * strength * dt;
      it.vel.z += (uz * fr + ux * ft) * strength * dt;
      it.vel.y += (fy * strength - 18 * (1 - strength)) * dt;
      it.vel.multiplyScalar(Math.exp(-1.6 * dt));
      m.position.addScaledVector(it.vel, dt);
      const gy = terrainH(m.position.x, m.position.z) + it.size * 0.35;
      if (m.position.y < gy) { m.position.y = gy; it.vel.y = Math.max(0, it.vel.y); }
      const tumble = 0.6 + Math.min(2, it.vel.length() * 0.15);
      m.rotation.x += it.spin.x * dt * tumble; m.rotation.y += it.spin.y * dt * tumble; m.rotation.z += it.spin.z * dt * tumble;
    }
  }
  // al terminar: pierden la fuerza poco a poco (se abren hacia fuera con su propia inercia) y caen con gravedad
  releaseDebris() {
    if (!this.debris || !this.debris.length) return;
    const items = this.debris; this.debris = [];
    for (const it of items) { it.vel.y = Math.max(it.vel.y, 1.5); it.vel.x *= 0.8; it.vel.z *= 0.8; }
    dropFlung(this.g, items, 12);
  }
  dispose() {
    this.releaseDebris();
    for (const t of this.torn || []) for (const m of t.layers) { m.geometry.dispose(); m.material.dispose(); }
    for (const c of this.currents || []) { c.m.geometry.dispose(); c.m.material.dispose(); }
    this.torn = []; this.currents = [];
    super.dispose();
  }
  tickShield(dt) {
    const d = this.def, p = this.p, c = this.combat;
    this.pose.spin = 0;
    // SE ABREN Y SE CIERRAN: abiertos (lejos, Ámbar bien visible en el centro) ↔ cerrados (pegados a ella, protección)
    const cyc = 0.5 + 0.5 * Math.sin(this.t * (TAU / 2.4) - Math.PI / 2), open = cyc * cyc * (3 - 2 * cyc);
    this.rr = lerp(0.72, 1.4, open);
    if (this.wasOpen !== undefined && open < 0.15 && this.wasOpen >= 0.15) { this.sfx('wind'); this.shake(0.12); this.vfx.ring(p.pos.x, p.pos.y + 1, p.pos.z, { r0: d.orbit * 1.4, r1: d.orbit * 0.5, dur: 0.35, color: 0xe8f6ff, opacity: 0.5 }); } // se cierran con fuerza
    this.wasOpen = open;
    this.place(1 + 0.05 * Math.sin(this.t * 9) + 0.15 * (1 - open), this.rr, dt);
    this.tickDebris(dt, 1);
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
  // GARRAS DE VIENTO: tres zarpazos encadenados (derecha, izquierda y doble), con las garras como protagonistas.
  // Cada zarpazo: preparación (el brazo sube y se carga atrás), corte rápido en diagonal con estela en las garras y
  // recuperación; en el instante del corte salen cuchillas de viento comprimido en la dirección del movimiento.
  begin() { this.aim(this.def.range, 35); this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    const SW = [ // brazo, inclinación del corte (rad), cuchillas que lanza
      { arm: 'R', tilt: 0.75, n: 1 },
      { arm: 'L', tilt: -0.75, n: 1 },
      { arm: 'B', tilt: 0, n: 2 },
    ];
    const st = [{ name: 'concentrar', dur: d.prep, enter: this.enterClaws, tick: (dt, k) => { this.wind = ease(k); pose.rx = 0.12 * k; pose.sy = 1 - 0.05 * k; this.charge(k); } }];
    SW.forEach((s, i) => {
      const wind = i === 0 ? 0.08 : 0.11, cut = 0.09, follow = i === SW.length - 1 ? 0.18 : 0.06;
      st.push({ name: `carga${i}`, dur: wind, enter: () => { this.sw = s; this.phase = 'carga'; }, tick: (dt, k) => { this.swK = -ease(k); pose.spin = (s.arm === 'R' ? -0.35 : s.arm === 'L' ? 0.35 : 0) * ease(k); pose.rx = 0.1; } });
      st.push({ name: `corte${i}`, dur: cut, enter: () => { this.phase = 'corte'; this.slash(s, i); this.kickHit(s); }, tick: (dt, k) => { this.swK = -1 + 2 * back(k); pose.spin = (s.arm === 'R' ? lerp(-0.35, 0.45, back(k)) : s.arm === 'L' ? lerp(0.35, -0.45, back(k)) : 0); pose.rx = 0.18 + (s.arm === 'B' ? 0.12 * k : 0); pose.dy = s.arm === 'B' ? 0.35 * Math.sin(k * Math.PI * 0.5) : 0; } });
      st.push({ name: `sigue${i}`, dur: follow, enter: () => { this.phase = 'sigue'; }, tick: (dt, k) => { this.swK = 1 - 0.4 * ease(k); pose.dy = s.arm === 'B' ? 0.35 * (1 - ease(k)) : 0; } });
    });
    st.push({ name: 'recuperacion', dur: d.recover, enter: () => { this.phase = 'fin'; }, tick: (dt, k) => { this.swK = 0.6 * (1 - ease(k)); this.wind = 1 - ease(k); pose.spin = lerp(pose.spin, 0, k); pose.rx = lerp(0.15, 0, k); this.clawK = 1 - ease(k); } });
    return st;
  }
  // garras de energía en las manos (tres cuchillas curvas por mano) y estelas que siguen su recorrido
  enterClaws() {
    this.p.powerAnim = 1; this.sfx('wind');
    this.swK = 0; this.wind = 0; this.clawK = 1; this.sw = null;
    const mat = new THREE.MeshBasicMaterial({ color: 0xe8f8ff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    mat.userData.own = true;
    const geo = new THREE.ConeGeometry(0.025, 0.28, 4); geo.translate(0, 0.14, 0); geo.rotateX(Math.PI / 2);
    this._cgeo = geo;
    this.claws = {};
    for (const S of ['L', 'R']) {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(geo, mat); m.position.set((i - 1) * 0.05, 0, 0); m.rotation.set(-0.35, (i - 1) * 0.18, 0); g.add(m); }
      this.prop(g); this.claws[S] = g;
    }
    this.clawMat = mat;
    this.trails = ['L', 'R'].map(() => new Trail(this.g.scene, 0xbfe8ff, 0xffffff, 14, 0.5));
    this.track({ kill: () => { for (const t of this.trails) t.dispose(); if (this._cgeo) this._cgeo.dispose(); } });
    // brazos: guardia con las garras delante → carga (brazo atrás y arriba) → corte en diagonal hacia el lado contrario
    this.setBones((B, dt, t, fx) => {
      const w = this.wind || 0, s = this.sw, k = this.swK || 0;
      for (const S of ['L', 'R']) {
        const sg = S === 'L' ? 1 : -1, act = s && (s.arm === S || s.arm === 'B') ? 1 : 0;
        const up = act ? (k < 0 ? -k : 0) : 0, cut = act ? Math.max(0, k) : 0;
        fx.rot(B[`upper_arm_${S}`], 1, 0, 0, -0.7 * w - 1.0 * up - 0.5 * cut);          // sube el brazo al cargar
        fx.rot(B[`upper_arm_${S}`], 0, 0, 1, sg * (0.25 * w + 0.6 * up - 0.75 * cut));   // y lo cruza por delante al cortar
        fx.rot(B[`forearm_${S}`], 1, 0, 0, -0.9 * w - 0.6 * up + 0.7 * cut);           // el codo se abre en el golpe (latigazo)
        fx.rot(B[`hand_${S}`], 0, 0, 1, sg * (0.3 * up - 0.4 * cut));                   // la muñeca acompaña el arco
      }
      fx.rot(B.spine || B.spine_1, 0, 1, 0, s ? (s.arm === 'R' ? -0.3 : s.arm === 'L' ? 0.3 : 0) * k : 0); // el torso gira con el zarpazo
      // PATADAS COORDINADAS CON LOS ZARPAZOS: con el zarpazo derecho patea la pata izquierda y al revés (como un
      // luchador); en el doble zarpazo final salta y patea con las dos. Cada patada: recoge la pata (muslo arriba,
      // rodilla flexionada), la extiende con fuerza hacia delante y la recoge de nuevo. La cadera y el pecho
      // compensan para no perder el equilibrio.
      const kick = s ? (s.arm === 'R' ? 'L' : s.arm === 'L' ? 'R' : 'B') : null;
      for (const S of ['L', 'R']) {
        const act = kick && (kick === S || kick === 'B') ? 1 : 0;
        const ch = act ? (k < 0 ? -k : Math.max(0, 1 - k) * 0.4) : 0, ext = act ? Math.max(0, k) : 0;
        fx.rot(B[`thigh_${S}`], 1, 0, 0, -(0.9 * ch + 1.25 * ext) * w);          // muslo arriba (recoger) y adelante (patear)
        fx.rot(B[`shin_${S}`], 1, 0, 0, (1.25 * ch + 0.1 * ext) * w);           // rodilla flexionada → pata extendida
        if (B[`foot_${S}`]) fx.rot(B[`foot_${S}`], 1, 0, 0, (-0.4 * ch + 0.35 * ext) * w); // garras por delante en el golpe
        fx.rot(B[`thigh_${S}`], 0, 0, 1, (S === 'L' ? 1 : -1) * 0.12 * ext * w); // la patada se abre un poco hacia fuera
      }
      if (kick) fx.rot(B.chest || B.spine, 1, 0, 0, -0.12 * Math.max(0, k) * w);       // el pecho se echa atrás al patear (equilibrio)
    });
  }
  charge(k) {
    for (const S of ['L', 'R']) {
      const h = boneWorld(this, `hand_${S}`);
      if (h && Math.random() < 0.6) this.g.fx.spark.emit(h.x + rnd(-0.08, 0.08), h.y + rnd(-0.08, 0.08), h.z + rnd(-0.08, 0.08), rnd(-0.6, 0.6), rnd(0, 0.8), rnd(-0.6, 0.6), 0.25, 0.06, 0.02, 0xffffff, 0x8ad0ff, 0.8, 0, 0, 2);
    }
    void k;
  }
  update(dt) {
    const done = super.update(dt);
    // garras y estelas pegadas a las manos (siguen cualquier animación)
    if (this.claws) for (const [i, S] of ['L', 'R'].entries()) {
      const h = boneWorld(this, `hand_${S}`), g = this.claws[S];
      if (!h) { g.visible = false; continue; }
      const f = this.p.facing;
      g.visible = (this.clawK ?? 1) > 0.05;
      g.position.copy(h).add(V(Math.sin(f) * 0.06, 0, Math.cos(f) * 0.06));
      g.rotation.set(0, f, 0);
      g.scale.setScalar(Math.max(0.001, (this.wind || 0.2) * (this.clawK ?? 1)));
      const tip = V(h.x + Math.sin(f) * 0.32, h.y, h.z + Math.cos(f) * 0.32);
      this.trails[i].push(h, tip);
      const s = this.sw, on = this.phase === 'corte' && s && (s.arm === S || s.arm === 'B');
      this.trails[i].update(dt, on || this.phase === 'sigue' && s && (s.arm === S || s.arm === 'B'));
    }
    if (this.clawMat) this.clawMat.opacity = 0.9 * (this.clawK ?? 1);
    return done;
  }
  // la patada también golpea: un pequeño impacto de aire delante de la pata (mismo daño de su zarpazo, no más)
  kickHit(s) {
    const p = this.p, f = this.fwd, x = p.pos.x + f.x * 1.1, z = p.pos.z + f.z * 1.1;
    const foot = boneWorld(this, s.arm === 'R' ? 'foot_L' : 'foot_R') || V(x, p.pos.y + 0.6, z);
    this.vfx.ring(foot.x, foot.y, foot.z, { r0: 0.1, r1: 0.8, dur: 0.16, color: 0xe8f8ff, opacity: 0.5 });
    for (let i = 0; i < 4; i++) this.g.fx.mist(foot.x + f.x * 0.3, foot.y, foot.z + f.z * 0.3, 0xeef8ff, 0.4);
    for (const t of this.combat.inCircle(x, z, 0.9)) this.combat.push(t, f.x, f.z, 3);
  }
  // en el instante del corte: cuchillas de viento comprimido que salen en la dirección de la garra
  slash(s, i) {
    const d = this.def, p = this.p, combat = this.combat, vfx = this.vfx;
    this.sfx('snap'); this.shake(0.08 + 0.05 * i);
    const t = this.combat.aimTarget(p.pos.x, p.pos.z, p.facing, 30 * DEG, d.range);
    if (t) this.face(t.pos.x, t.pos.z);
    for (let j = 0; j < s.n; j++) {
      const off = s.n > 1 ? (j - 0.5) : 0, ang = p.facing + off * d.spreadDeg * DEG * 0.5;
      const dir = V(Math.sin(ang), 0, Math.cos(ang)), side = V(-dir.z, 0, dir.x);
      const g = new THREE.Group();
      // filo: media luna estrecha y nítida + halo de aire más ancho y suave (sin deslumbrar)
      const edgeG = new THREE.RingGeometry(0.92, 1.0, 32, 1, -1.0, 2.0), airG = new THREE.RingGeometry(0.62, 1.0, 32, 1, -1.0, 2.0);
      const edge = new THREE.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const air = new THREE.MeshBasicMaterial({ color: 0x9fd8f8, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
      edge.userData.own = air.userData.own = true;
      const m1 = new THREE.Mesh(edgeG, edge), m2 = new THREE.Mesh(airG, air);
      for (const m of [m1, m2]) { m.rotation.y = Math.PI / 2; m.rotation.z = -0.4; }
      const tiltG = new THREE.Group(); tiltG.rotation.z = s.tilt + off * 0.4; // inclinado como el zarpazo
      tiltG.add(m1, m2); g.add(tiltG);
      const sx = s.arm === 'R' ? -0.25 : s.arm === 'L' ? 0.25 : off * 0.5;
      g.position.set(p.pos.x + side.x * sx + dir.x * 0.9, p.pos.y + p.H * 0.6, p.pos.z + side.z * sx + dir.z * 0.9);
      g.rotation.y = ang;
      const hits = new Set(), life = d.range / d.speed;
      vfx.add(g, life, (it, dt) => {
        g.position.addScaledVector(dir, d.speed * dt);
        const k = it.t / life;
        edge.opacity = 0.85 * (1 - k * k); air.opacity = 0.28 * (1 - k);
        g.scale.setScalar(1 + 0.5 * k);
        tiltG.rotation.x += dt * 2; // gira un poco sobre sí misma (aire en movimiento)
        if (Math.random() < 0.35) this.g.fx.mist(g.position.x - dir.x * 0.5, g.position.y, g.position.z - dir.z * 0.5, 0xeef8ff, 0.35);
        for (const tg of combat.inCircle(g.position.x, g.position.z, d.width * 0.5)) {
          if (hits.has(tg)) continue;
          hits.add(tg);
          combat.damage(tg, d.damage);
          combat.push(tg, dir.x, dir.z, d.force);
          vfx.sparks(g.position.x, g.position.y, g.position.z, 0xffffff, 6, 2.4);
        }
        if (it.t >= life - 0.02) { edgeG.dispose(); airG.dispose(); }
      });
    }
    // corte en el aire junto a la garra (arco blanco breve)
    const h = boneWorld(this, s.arm === 'L' ? 'hand_L' : 'hand_R');
    if (h) this.vfx.ring(h.x, h.y, h.z, { r0: 0.2, r1: 1.2, dur: 0.18, color: 0xe8f8ff, opacity: 0.4 });
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
