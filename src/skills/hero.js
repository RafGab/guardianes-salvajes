import * as THREE from 'three';
import { LeafStorm, iceMaterials, cometDisc, auroraShield, frostArea } from './magicfx.js';
import { petrifyMaterial } from './powers.js';
import { sandMaterial } from './speedfx2.js';
import { propModel } from '../props.js';
import { Staged, rnd, TAU } from './attack.js';
import { HERO_SKILLS, HERO_BUTTONS } from './config.js';
import { terrainH } from '../terrain.js';
import { Audio3D as audio } from '../audio.js';
import { ui } from '../ui.js';

// HABILIDADES DE LOS HÉROES. Cada una es una lista de etapas PREPARACIÓN → EJECUCIÓN → RECUPERACIÓN.
// La lógica (objetivos, daño, estados) está aquí; lo visual sale de skills/vfx.js y los números de skills/config.js.
// La pose del cuerpo (inclinar, aplastar, girar, desaparecer) se superpone a la animación del modelo mediante player.pose.

import { Skill, DEG, ease, lerp, clamp, V, NEUTRAL, SKIP_TAGS, makeElastic, boneWorld, powerTail } from './base.js';
import { POWER_CLASSES, AIM_MAX, aimPoint, aimShow, aimHide } from './powers.js';
import { POWER2_CLASSES, WindClawsSkill } from './powers2.js';
import { findSwingAnchor, swingStages, SwingMixin } from './swing.js';
import { POWER3_CLASSES } from './powers3.js';
import { SandStorm, WaterGate, SpringWard, puddle, takeGate, returnGate } from './fx3.js';
import { smotherFires } from './envreact.js';
const damp1 = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

/* ====================================================================== */
/*  JAGLION — Cola Elástica (extensión → agarre → balanceo → trepado)      */
/*  La cola real se recoge y sale una cola elástica de muchas articulaciones */
/*  desde el propio hueso de la cola.                                      */
/* ====================================================================== */
// Textura del pelaje de Jaglion para la cola elástica: naranja tostado con rosetas oscuras
let JAG_TEX = null;
function jaguarFurTex() {
  if (JAG_TEX) return JAG_TEX;
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, '#b4561a'); g.addColorStop(0.5, '#d4742a'); g.addColorStop(1, '#b4561a');
  x.fillStyle = g; x.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${90 + Math.random() * 80},${40 + Math.random() * 30},10,0.25)`; x.fillRect(Math.random() * 128, Math.random() * 256, 1.5, 4); } // pelo
  const ros = (cx, cy, r) => { // roseta: anillo roto oscuro con el centro algo más oscuro que el pelaje
    for (const ox of [-128, 0, 128]) {
      x.fillStyle = 'rgba(150,64,18,0.8)'; x.beginPath(); x.ellipse(cx + ox, cy, r * 0.7, r * 0.6, 0, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#2a140a'; x.lineWidth = r * 0.42;
      for (let k = 0; k < 3; k++) { const a0 = k * 2.1 + Math.random() * 0.6; x.beginPath(); x.ellipse(cx + ox, cy, r, r * 0.8, Math.random(), a0, a0 + 1.5); x.stroke(); }
    }
  };
  for (let i = 0; i < 16; i++) ros(Math.random() * 128, Math.random() * 256, 11 + Math.random() * 7);
  for (let i = 0; i < 40; i++) { x.fillStyle = '#2a140a'; x.beginPath(); x.arc(Math.random() * 128, Math.random() * 256, 1.5 + Math.random() * 2, 0, Math.PI * 2); x.fill(); } // motas
  JAG_TEX = new THREE.CanvasTexture(c);
  JAG_TEX.colorSpace = THREE.SRGBColorSpace;
  JAG_TEX.wrapS = JAG_TEX.wrapT = THREE.RepeatWrapping;
  return JAG_TEX;
}
class TailSkill extends Skill {
  begin() {
    const d = this.def, p = this.p;
    this.target = this.combat.aimTarget(p.pos.x, p.pos.z, p.facing, d.coneDeg * DEG, d.range);
    if (this.target) this.mode = this.target.heavy ? 'hit' : 'pull';
    else {
      // BALANCEO AL ESTILO ARAÑA (skills/swing.js) hacia un anclaje alto y lejano; si el saliente está cerca,
      // la cola sigue sirviendo para TREPAR a él como siempre
      const ledge = this.findAnchor(), web = findSwingAnchor(this, d.range + 4, 60);
      const ledgeNear = ledge && Math.hypot(ledge.x - p.pos.x, ledge.z - p.pos.z) < 6;
      if (ledge && (ledgeNear || !web)) { this.anchor = ledge; this.mode = 'swing'; }
      else if (web) { this.anchor = web; this.mode = 'web'; this.cdFactor = 0.3; this.swingColor = 0xffd080; } // recarga corta: se encadena
      else this.mode = 'whiff';
    }
    if (this.mode === 'whiff') { this.cdFactor = d.whiffCdFactor; ui.banner('find', '🪢', 'No hay nada al alcance de la cola'); }
    // cola con el pelaje de Jaglion (naranja con rosetas oscuras) y su borla al final; sale de la grupa y
    // forma un arco natural (hacia atrás, por encima del lomo y hacia el objetivo)
    this.rope = makeElastic(this, { n: d.segments || 30, r0: 0.11, r1: 0.075, rough: 0.9, tipR: 0.15, map: jaguarFurTex(), tipColor: 0x7a3410, uvRepeat: 4 });
    const rope = this.rope;
    rope.set = (a, b, o = {}) => this.whip(a, b, o);
    const tb = this.chain('tail_');
    if (tb.length > 1) this.setBones((bones, dt, t, fx) => fx.scale(tb[1], 0.04)); // la cola real se recoge dentro de la elástica
    this.start();
    return true;
  }
  // Saliente al que engancharse: parte alta de un sólido delante del héroe (como la cuerda de rescate)
  findAnchor() {
    const d = this.def, p = this.p, w = this.g.world, f = this.fwd, minDot = Math.cos(d.coneDeg * DEG);
    const near = w.solidsNear(p.pos.x - d.range, p.pos.x + d.range, p.pos.z - d.range, p.pos.z + d.range, []);
    let best = null, bs = Infinity;
    for (const s of near) {
      if (SKIP_TAGS.has(s.tag) || s.x1 - s.x0 < 1.2 || s.z1 - s.z0 < 1.2) continue;
      const rise = s.y1 - p.pos.y;
      if (rise < d.anchorMinRise || rise > d.anchorMaxRise) continue;
      const tx = clamp(p.pos.x, s.x0 + 0.5, s.x1 - 0.5), tz = clamp(p.pos.z, s.z0 + 0.5, s.z1 - 0.5);
      const dx = tx - p.pos.x, dz = tz - p.pos.z, dist = Math.hypot(dx, dz);
      if (dist < d.anchorMinDist || dist > d.range) continue;
      if ((dx * f.x + dz * f.z) / dist < minDot) continue;
      const sc = dist - ((dx * f.x + dz * f.z) / dist) * 4 + Math.abs(rise - 6) * 0.2;
      if (sc < bs) { bs = sc; best = V(tx, s.y1 + 0.05, tz); }
    }
    return best;
  }
  // la cola sale de la GRUPA: del segundo hueso de la cola, que está en la superficie del cuerpo
  // (tail_1 queda dentro de la cadera); en el modelo de reserva, de detrás del cuerpo
  origin() {
    const b = boneWorld(this, 'tail_2') || boneWorld(this, 'tail_1');
    if (b) return b;
    const f = this.fwd;
    return V(this.p.pos.x - f.x * this.p.R, this.p.pos.y + this.p.H * 0.45, this.p.pos.z - f.z * this.p.R);
  }
  // trayectoria de la cola: arranca en la dirección de la cola real, sube en arco y llega a la punta
  whip(a, b, { wobble = 0, phase = 0, waves = 2 } = {}) {
    const t3 = boneWorld(this, 'tail_3'), f = this.fwd;
    const td = t3 ? t3.clone().sub(a) : V(-f.x, -0.3, -f.z);
    if (td.lengthSq() < 1e-6) td.set(-f.x, -0.3, -f.z);
    td.normalize();
    const L = a.distanceTo(b);
    const c1 = a.clone().addScaledVector(td, 0.35 + L * 0.12); c1.y += 0.25 + L * 0.1;
    const c2 = b.clone().lerp(a, 0.35); c2.y += 0.3 + L * 0.22;
    this.rope.curve(a, c1, c2, b, { wobble, phase, waves });
  }
  hookPoint() {
    const p = this.p, d = this.def;
    if (this.mode === 'swing') return this.anchor;
    if (this.target) return V(this.target.pos.x, this.target.pos.y + (this.target.heavy ? this.target.S.height * 0.45 : 0.6), this.target.pos.z);
    const f = this.fwd;
    return V(p.pos.x + f.x * d.range * 0.7, p.pos.y + p.H * 0.5, p.pos.z + f.z * d.range * 0.7);
  }
  build() {
    const d = this.def, p = this.p, pose = this.pose;
    const st = [{ name: 'espera', dur: d.delay || 0 }, // espera de activación (0,5 s, skills/config.js): luego todo sigue igual
      { name: 'preparacion', dur: d.prep, enter: () => { if (this.target) this.face(this.target.pos.x, this.target.pos.z); }, tick: (dt, k) => {
      pose.rx = -0.25 * k; pose.sy = 1 - 0.06 * k;
      const o = this.origin(), f = this.fwd; // la cola se enrosca hacia arriba antes de salir
      this.rope.set(o, V(o.x - f.x * 0.4, o.y + 0.9 * k, o.z - f.z * 0.4), { wobble: 0.12, phase: this.t * 20, waves: 1 });
    } }];
    const dist = this.origin().distanceTo(this.hookPoint());
    // extensión: sale disparada, ondula y se pasa un poco antes de tensarse
    st.push({ name: 'extension', dur: Math.max(0.12, dist / d.hookSpeed), enter: () => { audio.whoosh(); this.sfx('flap'); }, tick: (dt, k) => {
      const o = this.origin(), h = this.hookPoint(), e = 1 - Math.pow(1 - k, 3) + 0.1 * Math.sin(k * Math.PI) * k;
      this.rope.set(o, o.clone().lerp(h, Math.min(1.08, e)), { wobble: (d.wobble || 0.5) * (1 - k * 0.7), phase: this.t * 26, waves: 2.5 });
      pose.rx = lerp(-0.25, 0.3, k);
      pose.sy = 1 + 0.12 * k;
    }, exit: () => this.grab() });
    if (this.mode === 'web') {
      return [...st.slice(0, 2), ...swingStages(this, { color: 0xffd080, shoot: d.hookSpeed }),
        { name: 'recuperacion', dur: d.recover, enter: () => { this.rope.kill(); this.clearBones(); }, tick: (dt, k) => { pose.rx = lerp(pose.rx, 0, k); pose.sy = lerp(pose.sy, 1, k); } }];
    }
    if (this.mode === 'swing') {
      st.push({ name: 'balanceo', dur: Math.max(0.35, this.p.pos.distanceTo(this.anchor) / d.swingSpeed * 1.25), enter: this.enterSwing, tick: this.tickSwing });
      st.push({ name: 'trepado', dur: d.climbT || 0.35, tick: this.tickClimb, exit: this.exitClimb });
      st.push({ name: 'estela', dur: d.trailTime, tick: (dt, k) => { this.rope.kill(); this.trail(1 - k); pose.sy = lerp(1.1, 1, k); pose.rx = lerp(0.3, 0, k); } });
    } else if (this.mode === 'pull') {
      st.push({ name: 'atraer', dur: Math.min(0.9, dist / d.pullSpeed + 0.2), tick: this.tickPull, exit: this.exitPull });
    } else if (this.mode === 'hit') {
      st.push({ name: 'golpe', dur: 0.3, enter: this.enterHit, tick: (dt, k) => { this.rope.set(this.origin(), this.hookPoint(), { wobble: 0.3 * (1 - k), phase: this.t * 30 }); pose.rx = lerp(0.5, 0, k); } });
    }
    // retracción: vuelve ondulando hasta su sitio
    st.push({ name: 'retraccion', dur: Math.max(0.12, dist / d.hookSpeed * 0.8), tick: (dt, k) => {
      if (this.rope.dead) return;
      const o = this.origin(), h = this.lastTip || this.hookPoint();
      this.rope.set(o, h.clone().lerp(o, ease(k)), { wobble: 0.35 * (1 - k), phase: this.t * 22, waves: 3 });
      pose.sy = lerp(pose.sy, 1, k);
    } });
    st.push({ name: 'recuperacion', dur: d.recover, enter: () => { this.rope.kill(); this.clearBones(); }, tick: (dt, k) => { pose.rx = lerp(pose.rx, 0, k); pose.sy = lerp(pose.sy, 1, k); } });
    return st;
  }
  // la punta se agarra: enrollado, polvo y sonido
  grab() {
    if (this.mode === 'whiff') return;
    const h = this.hookPoint();
    this.sfx('stick');
    this.vfx.ring(h.x, h.y + 0.05, h.z, { r0: 0.15, r1: 0.9, dur: 0.35, color: 0xffd080 });
    this.vfx.ring(h.x, h.y + 0.25, h.z, { r0: 0.15, r1: 0.7, dur: 0.3, color: 0xffd080 });
    this.vfx.dust(h.x, h.y, h.z, 4, 1);
  }
  // balanceo: péndulo bajo el anclaje hasta colgar del borde
  enterSwing() {
    const p = this.p, a = this.anchor;
    this.from = p.pos.clone();
    this.script(true);
    this.face(a.x, a.z);
    const hx = this.from.x - a.x, hz = this.from.z - a.z, hl = Math.hypot(hx, hz) || 1;
    this.dirH = { x: hx / hl, z: hz / hl };
    this.u0 = hl; this.w0 = this.from.y - a.y;
    this.u1 = 0.75; this.w1 = Math.max(-p.H * 0.95, terrainH(a.x + this.dirH.x * 0.75, a.z + this.dirH.z * 0.75) + 0.2 - a.y);
    this.r0 = Math.hypot(this.u0, this.w0); this.r1 = Math.hypot(this.u1, this.w1);
    this.a0 = Math.atan2(this.w0, this.u0); this.a1 = Math.atan2(this.w1, this.u1);
  }
  swingPos(k) {
    const a = this.anchor, e = ease(k);
    const ang = lerp(this.a0, this.a1, e), r = lerp(this.r0, this.r1, e);
    const u = Math.cos(ang) * r, w = Math.sin(ang) * r - Math.sin(k * Math.PI) * 0.18 * this.r0; // el péndulo baja y vuelve a subir
    return V(a.x + this.dirH.x * u, Math.max(terrainH(a.x + this.dirH.x * u, a.z + this.dirH.z * u) + 0.05, a.y + w), a.z + this.dirH.z * u);
  }
  tickSwing(dt, k) {
    const p = this.p;
    p.pos.copy(this.swingPos(k));
    this.rope.set(this.origin(), this.anchor, { wobble: 0.04, phase: this.t * 10, sag: 0.05 });
    this.pose.rx = lerp(0.6, -0.2, k); this.pose.sy = 1.12; this.pose.rz = Math.sin(k * Math.PI) * 0.15;
    this.trail(1);
  }
  // trepado: sube por la cola hasta lo alto del saliente
  tickClimb(dt, k) {
    const p = this.p, from = this.swingPos(1), a = this.anchor, e = ease(k);
    p.pos.lerpVectors(from, a, e);
    p.pos.y += Math.sin(e * Math.PI) * 0.45;
    const o = this.origin();
    this.rope.set(o, a, { wobble: 0.02, phase: this.t * 8 });
    this.pose.rx = lerp(-0.5, 0.2, k); this.pose.sy = lerp(1.08, 1, k); this.pose.rz = 0;
    if (k > 0.85) this.rope.kill();
  }
  exitClimb() {
    const d = this.def, f = this.fwd;
    this.p.pos.copy(this.anchor);
    this.release(f.x * d.releaseBoost * 0.5, d.releaseUp * 0.6, f.z * d.releaseBoost * 0.5);
    this.rope.kill();
    this.vfx.ring(this.anchor.x, this.anchor.y, this.anchor.z, { r0: 0.4, r1: 2.4, dur: 0.4, color: 0xffd080 });
    this.vfx.dust(this.anchor.x, this.anchor.y + 0.1, this.anchor.z, 6, 1.4);
  }
  trail(k) { // estela de velocidad discreta (no debe tapar al héroe)
    const c = this.center(0.5);
    this._tr = (this._tr || 0) + 1;
    if (this._tr % 3 === 0) this.vfx.orb(c, { r: 0.12 * k + 0.05, color: 0xffd080, opacity: 0.35, life: 0.25 });
    if (Math.random() < 0.35) this.vfx.sparks(c.x, c.y, c.z, 0xffe0a0, 1, 1.5);
  }
  // enemigos ligeros: la cola los trae hasta el héroe y los golpea
  tickPull(dt) {
    const t = this.target, p = this.p, f = this.fwd;
    if (t.dead) { this.endStage(); return; }
    this.lastTip = V(t.pos.x, t.pos.y + 0.6, t.pos.z);
    this.rope.set(this.origin(), this.lastTip, { wobble: 0.08, phase: this.t * 18, sag: 0.25 });
    const to = V(p.pos.x + f.x * (p.R + t.radius + 0.2), p.pos.y, p.pos.z + f.z * (p.R + t.radius + 0.2));
    this.combat.pull(t, to, this.def.pullSpeed, 0.2);
    this.pose.rx = 0.2; this.pose.sy = 1.05;
    if (Math.hypot(t.pos.x - to.x, t.pos.z - to.z) < 0.5) this.endStage();
  }
  exitPull() {
    const t = this.target;
    if (t.dead) return;
    this.hit(t, this.def.damage);
    const f = this.fwd;
    this.combat.push(t, f.x, f.z, this.def.force);
    this.shake(0.15);
    this.vfx.sparks(t.pos.x, t.pos.y + 0.6, t.pos.z, 0xffd080, 10, 3);
    this.vfx.ring(t.pos.x, null, t.pos.z, { r0: 0.4, r1: 2.2, dur: 0.3, color: 0xffd080 });
  }
  // enemigos pesados: azote de la cola con daño y empuje
  enterHit() {
    const t = this.target, d = this.def;
    this.hit(t, d.damage);
    this.combat.push(t, t.pos.x - this.p.pos.x, t.pos.z - this.p.pos.z, d.force);
    this.shake(0.28); audio.noiseBurst(0.25, 300, 0.3, 'lowpass'); this.sfx('snap');
    this.vfx.sparks(t.pos.x, t.pos.y + t.S.height * 0.45, t.pos.z, 0xffd080, 14, 3.4);
    this.vfx.ring(t.pos.x, null, t.pos.z, { r0: 0.6, r1: 3.4, dur: 0.4, color: 0xffd080 });
  }
}

/* ====================================================================== */
/*  FENECO — Haboob Auricular                                              */
/* ====================================================================== */
class HaboobSkill extends Skill {
  begin() {
    this.start();
    return true;
  }
  makeEars() {
    // con el rig real (huesos de las orejas) el aleteo lo hace la animación 'power'; las orejas dibujadas son solo el modelo de reserva
    this.realEars = !!(this.p.model.mixer && this.p.model.clips && this.p.model.clips.power);
    if (this.realEars) return;
    const H = this.p.H, g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xe8c890, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    this.earMats = [mat];
    this.ears = [-1, 1].map((s) => {
      const e = new THREE.Mesh(this.vfx.sphGeo, mat);
      e.scale.set(H * 0.05, H * 0.34, H * 0.16);
      const pivot = new THREE.Group();
      pivot.position.set(s * H * 0.13, H * 0.88, 0);
      e.position.y = H * 0.26;
      pivot.add(e);
      g.add(pivot);
      return { pivot, s };
    });
    this.p.model.root.add(g);
    this.earGroup = g;
    this.track({ kill: () => { this.p.model.root.remove(g); mat.dispose(); } });
  }
  flap(t, amount) { // orejas exageradas: aleteo rápido
    if (this.realEars) { this.p.powerAnim = amount > 0.2 ? 1 : this.p.powerAnim; return; }
    for (const e of this.ears) { e.pivot.rotation.z = -e.s * (0.45 + amount * Math.sin(t * 24)); e.pivot.rotation.x = 0.15 * Math.sin(t * 24 + 1); }
  }
  // HABOOB: la tormenta nace delante del feneco mientras él la invoca (las orejas aspiran la arena y la lanzan por
  // una corriente que las une a la tormenta), crece, avanza bajo su control y al final se abre, sube y se aclara
  // hasta desaparecer (sin encogerse de golpe). Mecánica intacta: avance, empuje, cegado, daño y desvío.
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'preparacion', dur: d.prep, enter: () => { this.lock(true); this.makeEars(); this.makeStorm(); audio.whoosh(); }, tick: (dt, k) => {
        pose.sy = 1 - 0.1 * k; pose.rx = 0.25 * k; // planta las patas y se inclina
        pose.rz = d.earShake * Math.sin(this.t * 30) * k;
        this.flap(this.t, 0.6 * k);
        this.gather(dt, k);
        this.storm.update(dt, { grow: 0.45 * k, fade: 1, yaw: this.yaw });
        this.storm.updateLink(dt, this.earPos(), V(this.pos.x, this.pos.y + 2.4, this.pos.z), k);
      } },
      { name: 'tormenta', dur: d.exec, enter: this.enterStorm, tick: this.tickStorm, exit: this.exitStorm },
      { name: 'recuperacion', dur: d.recover, tick: (dt, k) => {
        pose.sy = lerp(0.9, 1, k); pose.rx = lerp(0.25, 0, k); this.flap(this.t, 0.5 * (1 - k));
        this.advance(dt * (1 - k));
        this.storm.update(dt, { grow: 1, fade: this.fadeAt * (1 - k), yaw: this.yaw });
        this.storm.updateLink(dt, this.earPos(), V(this.pos.x, this.pos.y + 2.4, this.pos.z), 0);
      } },
    ];
  }
  earPos() { const h = boneWorld(this, 'head_end') || this.center(0.95); return h; }
  makeStorm() {
    const d = this.def, p = this.p, f = this.fwd;
    this.dir = { x: f.x, z: f.z };
    this.yaw = Math.atan2(f.x, f.z);
    this.pos = V(p.pos.x + f.x * 2.6, 0, p.pos.z + f.z * 2.6);
    this.pos.y = this.gy(this.pos.x, this.pos.z);
    this.storm = new SandStorm(d.width, 5.2);
    this.storm.group.position.copy(this.pos);
    this.prop(this.storm.group);
    this.prop(this.storm.link);
    this.track({ kill: () => this.storm.dispose() });
    this.fadeAt = 1;
  }
  // formación: remolinos de arena que se levantan alrededor del feneco y se dejan arrastrar hacia la tormenta
  gather(dt, k) {
    const p = this.p, fx = this.g.fx;
    for (let i = 0; i < 2; i++) {
      const a = this.t * 7 + i * Math.PI, r = 1.8 - 1.2 * k;
      fx.mist(p.pos.x + Math.cos(a) * r, p.pos.y + 0.2 + k * 0.8, p.pos.z + Math.sin(a) * r, 0xe0bd7a, 0.6 + 0.4 * k);
    }
    if (Math.random() < 0.6) this.g.fx.dustPuff(this.pos.x + rnd(-1.5, 1.5), this.pos.y, this.pos.z + rnd(-1.5, 1.5), 1.2 + k);
  }
  advance(dt) {
    const d = this.def;
    this.pos.x += this.dir.x * d.speed * dt; this.pos.z += this.dir.z * d.speed * dt;
    this.pos.y = damp1(this.pos.y, this.gy(this.pos.x, this.pos.z), 8, dt);
    this.storm.group.position.copy(this.pos);
  }
  enterStorm() {
    audio.noiseBurst(0.9, 500, 0.3, 'bandpass');
    this.shake(0.2);
    this.vfx.ring(this.pos.x, null, this.pos.z, { r0: 0.5, r1: this.def.width * 0.9, dur: 0.6, color: 0xe0bd7a, opacity: 0.6, additive: false });
  }
  tickStorm(dt, k) {
    const d = this.def, pose = this.pose;
    if (this._lock && this.t > d.rootT) this.lock(false);
    this.advance(dt);
    // crece del 45 % al 100 % en 0,45 s; en el último 30 % empieza a disiparse
    const grow = 0.45 + 0.55 * Math.min(1, this.t / 0.45);
    this.fadeAt = k > 0.7 ? 1 - ((k - 0.7) / 0.3) * 0.55 : 1;
    this.storm.update(dt, { grow, fade: this.fadeAt, yaw: this.yaw });
    // mientras está plantado la controla con las orejas (corriente de arena); luego la suelta poco a poco
    const control = this._lock ? 1 : Math.max(0, 1 - (this.t - d.rootT) / 0.4);
    this.storm.updateLink(dt, this.earPos(), V(this.pos.x, this.pos.y + 2.4, this.pos.z), control);
    pose.sy = lerp(1, 0.9, control); pose.rx = 0.25 * control; pose.rz = d.earShake * Math.sin(this.t * 30) * control;
    this.flap(this.t + 1, 0.9 * Math.max(0.3, control));
    const r = d.width * 0.5;
    for (const t of this.combat.inCircle(this.pos.x, this.pos.z, r)) { // empuja, ciega y daña
      const { dx, dz } = this.awayFrom(t, this.pos.x, this.pos.z);
      this.shove(t, this.dir.x * 2 + dx * 0.2, this.dir.z * 2 + dz * 0.2, d.push, dt);
      this.combat.blind(t, d.blindT);
      this.dot(t, d.damage, dt);
    }
    this.combat.deflect(this.pos.x, this.pos.z, d.deflectRadius); // desvía proyectiles ligeros
    if (d.clearsObstacles) this.clearObstacles(this.pos.x, this.pos.z, r);
    // la tormenta de arena cubre las llamas y apaga los focos de incendio por los que pasa
    this.doused = (this.doused || 0) + smotherFires(this.g, this.pos.x, this.pos.z, r, 'sand');
    // RELÁMPAGOS dentro de la tormenta de arena (electricidad estática del haboob) y granos que brillan
    this.boltT = (this.boltT || 0) - dt;
    if (this.boltT <= 0 && this.fadeAt > 0.5) {
      this.boltT = rnd(0.12, 0.26);
      const a1 = rnd(0, TAU), a2 = a1 + rnd(0.8, 2.2), r1 = r * rnd(0.2, 0.8), r2 = r * rnd(0.2, 0.8);
      const A = V(this.pos.x + Math.cos(a1) * r1, this.pos.y + rnd(2.2, 4.6), this.pos.z + Math.sin(a1) * r1);
      const B = V(this.pos.x + Math.cos(a2) * r2, this.pos.y + rnd(0.6, 3), this.pos.z + Math.sin(a2) * r2);
      this.vfx.bolt(A, B, { color: Math.random() < 0.5 ? 0xfff0c0 : 0xffc870, life: 0.12, jag: 0.6, segs: 8 });
      this.vfx.orb(B, { r: 0.35, color: 0xffe0a0, opacity: 0.8, life: 0.14, grow: 2 });
    }
    for (let i = 0; i < 2; i++) { const a = rnd(0, TAU), rr = r * Math.sqrt(Math.random()); this.g.fx.sparkle(this.pos.x + Math.cos(a) * rr, this.pos.y + rnd(0.4, 4), this.pos.z + Math.sin(a) * rr, i ? 0xffd890 : 0xfff4d0, 1.2); }
    // polvo que levanta en la base y estela de arena detrás de la tormenta
    this.sandT = (this.sandT || 0) - dt;
    if (this.sandT <= 0) {
      this.sandT = 0.05;
      const fx = this.g.fx, a = rnd(0, TAU), rr = r * Math.sqrt(Math.random());
      fx.dustPuff(this.pos.x + Math.cos(a) * rr, this.pos.y + 0.1, this.pos.z + Math.sin(a) * rr, 1.6 * this.fadeAt);
      fx.mist(this.pos.x - this.dir.x * r * 0.8 + rnd(-r, r) * 0.5, this.pos.y + rnd(0.3, 2.5), this.pos.z - this.dir.z * r * 0.8 + rnd(-r, r) * 0.5, 0xd8b070, 1.4 * this.fadeAt);
    }
  }
  clearObstacles(x, z, r) {
    const w = this.g.world;
    for (const o of [...w.obstacles]) {
      if (!o.alive || o.breakBy !== 'wind') continue;
      if (Math.hypot(o.x - x, o.z - z) < r + 1) w.breakObstacle(o);
    }
  }
  exitStorm() {
    for (let i = 0; i < 8; i++) this.g.fx.mist(this.pos.x + rnd(-2, 2), this.pos.y + rnd(0.5, 3), this.pos.z + rnd(-2, 2), 0xe0c890, 1.8); // la arena se dispersa en el aire
    if (this.doused) ui.banner('good', `🌪️ ¡El Haboob apaga ${this.doused} ${this.doused > 1 ? 'focos' : 'foco'}!`, `+${30 * this.doused} puntos`);
  }
}

/* ====================================================================== */
/*  ZORRA ÁRTICA — Colas de las Cuatro Estaciones                          */
/* ====================================================================== */
const SEASON_ICON = { spring: '🌸', summer: '☀️', autumn: '🍂', winter: '❄️' };

class SeasonsSkill extends Skill {
  begin() {
    const d = this.def, hs = this.hs;
    this.key = d.order[hs.seasonIdx % d.order.length];
    hs.seasonIdx++;
    this.s = d.seasons[this.key];
    const p = this.p, tgt = this.combat.aimTarget(p.pos.x, p.pos.z, p.facing, 45 * DEG, this.s.range || 8);
    if (tgt) this.face(tgt.pos.x, tgt.pos.z);
    const fr = this.fwd, reach = tgt ? Math.hypot(tgt.pos.x - p.pos.x, tgt.pos.z - p.pos.z) : (this.s.range || 8) * 0.8;
    this.at = V(p.pos.x + fr.x * reach, 0, p.pos.z + fr.z * reach);
    this.at.y = this.gy(this.at.x, this.at.z);
    // PRIMAVERA = ESCUDO: la naturaleza crece alrededor de la propia zorra (no a lo lejos)
    if (this.key === 'spring') { this.at = p.pos.clone(); this.at.y = p.floorY(p.pos.x, p.pos.z, p.pos.y + 0.5); }
    ui.alert(`${this.s.label}`, 900);
    this.start();
    return true;
  }
  build() {
    const d = this.def, s = this.s, pose = this.pose, key = this.key;
    const exec = { spring: { dur: s.duration, enter: this.enterSpring, tick: this.tickSpring },
      summer: { dur: Math.max(d.exec, s.burnT), enter: this.enterSummer, tick: this.tickSummer },
      autumn: { dur: s.duration, enter: this.enterAutumn, tick: this.tickAutumn },
      winter: { dur: d.exec, enter: this.enterWinter, tick: this.tickWinter } }[key];
    return [
      { name: 'preparacion', dur: d.prep, tick: (dt, k) => { // la cola de la estación brilla y se alza
        pose.rx = -0.2 * k; pose.sy = 1 + 0.05 * k;
        const c = this.center(0.45);
        this.vfx.orb(V(c.x - Math.sin(this.p.facing) * 0.4, c.y, c.z - Math.cos(this.p.facing) * 0.4), { r: 0.15 + 0.35 * k, color: s.color, life: 0.18 });
      } },
      { name: 'ejecucion', ...exec },
      { name: 'recuperacion', dur: d.recover, tick: (dt, k) => { pose.rx = lerp(0.1, 0, k); } },
    ];
  }
  /* primavera: ESCUDO NATURAL. La zorra se queda de pie sobre un suelo rosa en flor y a su alrededor brotan árboles,
     arbustos y flores que forman una muralla, con una cúpula de energía verde-rosa. Dentro: los enemigos quedan
     enraizados y reciben daño (como siempre); la barrera los empuja hacia fuera y desvía los proyectiles. */
  enterSpring() {
    const s = this.s;
    const ward = new SpringWard(s.radius);
    ward.group.position.copy(this.at);
    ward.fitGround((x, z) => this.p.floorY(x, z, this.at.y + 1.5));
    this.ward = ward;
    this.prop(ward.group);
    this.track({ kill: () => ward.dispose() });
    this.vfx.ring(this.at.x, null, this.at.z, { r0: 0.3, r1: s.radius * 1.15, dur: 0.6, color: 0xff9ad0, opacity: 0.7 });
    this.vfx.petals(this.at.x, this.at.y + 0.5, this.at.z, 14);
    audio.whoosh();
    this.sfx('chime');
  }
  tickSpring(dt, k) {
    const s = this.s, at = this.at, fx = this.g.fx, gy = (x, z) => this.p.floorY(x, z, at.y + 1);
    const fade = k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1;
    this.ward.update(dt, { fade, groundY: gy });
    this.pose.dy = 0; // de pie, apoyada en el suelo
    // la barrera: dentro, enraizados y daño (mecánica original); empujados hacia fuera; proyectiles desviados
    for (const t of this.combat.inCircle(at.x, at.z, s.radius)) {
      this.combat.root(t, 0.4); this.dot(t, s.damage, dt);
      const { dx, dz } = this.awayFrom(t, at.x, at.z);
      this.shove(t, dx, dz, 6, dt);
    }
    this.combat.deflect(at.x, at.z, s.radius);
    // pétalos que giran alrededor y chispas de energía que suben por la cúpula
    const a = this.t * 2.2;
    for (let i = 0; i < 2; i++) { const aa = a + i * Math.PI + rnd(-0.3, 0.3), r = s.radius * rnd(0.55, 1); fx.sparkle(at.x + Math.cos(aa) * r, at.y + rnd(0.2, 2.6), at.z + Math.sin(aa) * r, Math.random() < 0.6 ? 0xffa8d8 : 0x9aff9a, 0.5); }
    if (Math.random() < 0.3) this.vfx.petals(at.x, at.y + 0.6, at.z, 1);
    if (fade < 1 && Math.random() < 0.4) this.vfx.petals(at.x + rnd(-2, 2), at.y + 1, at.z + rnd(-2, 2), 2); // al recogerse sueltan pétalos
  }
  /* verano: ola de calor alrededor del héroe */
  enterSummer() {
    const s = this.s, c = this.p.pos;
    this.at = c.clone();
    this.vfx.ring(c.x, null, c.z, { r0: 0.5, r1: s.radius, dur: 0.6, color: s.color });
    this.vfx.ring(c.x, null, c.z, { r0: 0.2, r1: s.radius * 0.7, dur: 0.45, color: 0xff6a1a });
    this.vfx.fire(c.x, c.y + 0.2, c.z, 14, 1.6);
    this.shake(0.15); audio.noiseBurst(0.3, 400, 0.5, 'lowpass');
    for (const t of this.combat.inCircle(c.x, c.z, s.radius)) {
      this.hit(t, s.damage);
      const { dx, dz } = this.awayFrom(t, c.x, c.z);
      this.combat.push(t, dx, dz, s.force);
    }
  }
  tickSummer(dt) {
    const s = this.s, c = this.p.pos;
    for (const t of this.combat.inCircle(c.x, c.z, s.radius)) this.dot(t, s.damage * 0.35, dt);
    if (Math.random() < 0.5) this.vfx.fire(c.x + rnd(-s.radius, s.radius) * 0.6, c.y, c.z + rnd(-s.radius, s.radius) * 0.6, 1, 1.1);
  }
  /* otoño: remolino de hojas que empuja */
  enterAutumn() {
    const s = this.s;
    this.cone = new THREE.Mesh(new THREE.CylinderGeometry(s.radius * 0.9, s.radius * 0.35, 3.4, 14, 1, true), new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    this.cone.position.set(this.at.x, this.at.y + 1.7, this.at.z);
    this.prop(this.cone);
    this.zone = this.track(this.vfx.telegraph('disc', { x: this.at.x, z: this.at.z, r: s.radius, color: s.color, opacity: 0.25 }));
    this.zone.setProgress(1);
    audio.whoosh();
  }
  tickAutumn(dt, k) {
    const s = this.s;
    this.cone.rotation.y += dt * 8;
    for (const t of this.combat.inCircle(this.at.x, this.at.z, s.radius)) {
      const { dx, dz } = this.awayFrom(t, this.at.x, this.at.z);
      this.shove(t, dx - dz * 0.8, dz + dx * 0.8, s.force, dt); // sale despedido en espiral
      this.dot(t, s.damage, dt);
    }
    const a = this.t * 7;
    this.vfx.leaves(this.at.x + Math.cos(a) * s.radius * 0.5, this.at.y + rnd(0.2, 2.4), this.at.z + Math.sin(a) * s.radius * 0.5, undefined, 3);
  }
  /* invierno: cono de escarcha que ralentiza */
  enterWinter() {
    const s = this.s, p = this.p;
    const cone = this.vfx.telegraph('cone', { x: p.pos.x, z: p.pos.z, angle: p.facing, half: s.coneDeg * DEG, range: s.range, color: s.color, opacity: 0.5 });
    cone.setProgress(1);
    this.track(cone);
    this.vfx.ice(p.pos.x + Math.sin(p.facing) * 3, p.pos.y + 0.8, p.pos.z + Math.cos(p.facing) * 3, 8);
    audio.power('ice');
    this.shake(0.1);
    for (const t of this.combat.inCone(p.pos.x, p.pos.z, p.facing, s.coneDeg * DEG, s.range)) {
      this.combat.slow(t, s.slowF, s.slowT);
      this.hit(t, s.damage);
      const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z);
      this.combat.push(t, dx, dz, s.force);
      this.vfx.ice(t.pos.x, t.pos.y + 0.6, t.pos.z, 4);
    }
  }
  tickWinter(dt) {
    const p = this.p, s = this.s;
    if (Math.random() < 0.6) { const d = rnd(1, s.range), a = p.facing + rnd(-1, 1) * s.coneDeg * DEG; this.vfx.ice(p.pos.x + Math.sin(a) * d, p.pos.y + 0.6, p.pos.z + Math.cos(a) * d, 1); }
  }
}

// RUEDA DE LAS ESTACIONES (primavera, verano, OTOÑO e invierno): las cuatro colas giran y combinan los cuatro efectos.
// CARGA → DIRECCIÓN → LANZAMIENTO: 1.ª pulsación = las cuatro esferas se reúnen y giran a su alrededor (carga);
// el jugador la orienta con las teclas de dirección (franja y círculo en el suelo); 2.ª pulsación = la rueda sale
// rodando en esa dirección y aplica sus cuatro efectos por donde pasa hasta el punto elegido.
class WheelSkill extends Skill {
  begin() { this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose, seasons = HERO_SKILLS.kyra.skill.seasons, order = HERO_SKILLS.kyra.skill.wheelOrder;
    const range = d.range || 10;
    return [
      { name: 'preparacion', dur: d.prep, enter: this.enterGather, tick: (dt, k) => { pose.rx = -0.2 * k; this.orbit(0.4 + (1 - k) * 2.6, this.t * 3, 0.3 + 0.7 * k); aimShow(this, range, d.radius, 0xffffff); } },
      // CARGADA: las esferas giran a su alrededor esperando la orden; el jugador elige la dirección
      { name: 'contener', dur: AIM_MAX, enter: () => { ui.banner('find', '☸️ Rueda de las Estaciones cargada', 'Oriéntala con las teclas de dirección y pulsa otra vez el botón para lanzarla'); audio.sfx && audio.sfx('shimmer'); },
        tick: (dt) => { pose.rx = -0.15; pose.sy = 1 + 0.02 * Math.sin(this.t * 6); this.orbit(1.6 + 0.15 * Math.sin(this.t * 4), this.t * 5, 1); aimShow(this, range, d.radius, 0xffffff); },
        exit: () => { this.to = aimPoint(this, range); this.wc = this.center(0.5); aimHide(this); } },
      { name: 'rueda', dur: d.exec, enter: () => { this.tickT = 0; this.shake(0.3); audio.power('ice'); this.wFrom = this.wc.clone(); }, tick: (dt, k) => {
        // la rueda avanza rodando hasta el punto elegido (despacio al final) y gira sobre sí misma
        const e = 1 - Math.pow(1 - Math.min(1, k * 1.6), 2);
        this.wc.set(lerp(this.wFrom.x, this.to.x, e), 0, lerp(this.wFrom.z, this.to.z, e));
        this.wc.y = this.gy(this.wc.x, this.wc.z) + 0.9;
        pose.spin = 0; pose.rx = k < 0.15 ? 0.35 : 0.12; pose.sy = 1.02; // gesto de lanzamiento y la mira
        this.orbit(2.2, this.t * d.spinSpeed * 0.9, 1, this.wc);
        this.tickT -= dt;
        if (this.tickT <= 0) { this.tickT = d.tick; this.pulse(order, seasons); }
        for (const t of this.combat.inCircle(this.wc.x, this.wc.z, d.radius)) this.combat.root(t, 0.2); // la rueda sujeta mientras gira
      }, exit: () => {
        this.vfx.ring(this.wc.x, null, this.wc.z, { r0: 1, r1: d.radius * 1.2, dur: 0.5, color: 0xffd27a, opacity: 0.6 });
        if (this.storm) { this.storm.release(1); this.storm.burst(this.wc.x, this.gy(this.wc.x, this.wc.z) + 1, this.wc.z, 70, 1.1); }
        for (let i = 0; i < 14; i++) this.g.fx.sparkle(this.wc.x + rnd(-1.5, 1.5), this.gy(this.wc.x, this.wc.z) + rnd(0.4, 2.4), this.wc.z + rnd(-1.5, 1.5), i % 2 ? 0xffd86a : 0xfff2b0, 3);
      } },
      { name: 'recuperacion', dur: d.recover, tick: (dt, k) => { pose.spin = 0; pose.rx = lerp(0.12, 0, k); this.orbit(2.2 * (1 - k), this.t * 4, 1 - k, this.wc); } },
    ];
  }
  get canRecast() { return this.stageName === 'contener'; }
  recast() {
    if (this.stageName !== 'contener') return false;
    this.endStage();
    if (this.g.armButton) this.g.armButton(this.key); // la recarga cuenta desde el lanzamiento
    return true;
  }
  update(dt) { this._dt = dt; return super.update(dt); }
  cleanup() { aimHide(this); }
  /* REMOLINO MÁGICO DE HOJAS OTOÑALES (solo cambia el efecto visual: etapas, daño, alcance y lógica son los mismos).
     Cientos de hojas naranjas, doradas, amarillas, rojas y marrones giran alrededor de un núcleo de viento dorado:
     se forman alrededor de la zorra al cargar, viajan con la rueda hacia los enemigos y, al golpear, estallan en un
     círculo de hojas con destellos dorados que caen y se desvanecen poco a poco. */
  enterGather() {
    const S = new LeafStorm(null, { n: 720, spare: 380, height: 2.8 }); // muchas más hojas (antes 300)
    this.storm = S;
    // el remolino vive como efecto propio: al terminar la habilidad, sus últimas hojas siguen cayendo y se apagan solas
    let fade = 0;
    this.vfx.add(S.root, 0, (it, dt) => {
      if (this.storm === S) return; // mientras dura la habilidad, lo mueve ella
      S.update(dt, null, { r: 1.5, k: 0 });
      fade += dt;
      if (fade > 2.1) { S.dispose(); this.vfx.kill(it); }
    });
    this.track({ kill: () => { this.storm = null; } });
    this.hitOnce = new Set();
    this.orbs = [];
    audio.whoosh();
  }
  // mueve el remolino: r = radio, k = intensidad, at = centro de la rueda (o la propia zorra)
  orbit(r, a0, k, at = null) {
    const S = this.storm;
    if (!S) return;
    const c = at || this.p.pos, gy = at ? this.gy(c.x, c.z) : this.p.pos.y;
    S.update(this._dt || 1 / 60, V(c.x, gy, c.z), { r: Math.max(0.3, r * 0.95), k, h: 1.2 + r * 0.75 });
    if (Math.random() < 0.45 * k) { // destellos dorados y partículas mágicas dentro del remolino
      const a = rnd(0, TAU), rr = r * rnd(0.2, 0.9);
      this.g.fx.sparkle(c.x + Math.cos(a) * rr, gy + rnd(0.3, 1.2 + r * 0.7), c.z + Math.sin(a) * rr, Math.random() < 0.6 ? 0xffd86a : 0xfff2b0, 0.9);
    }
  }
  // pulso: aplica los cuatro efectos de siempre (daño, raíces, ralentización y empuje) con aspecto de hojarasca
  pulse(order, seasons) {
    const d = this.def, c = this.wc ? V(this.wc.x, this.gy(this.wc.x, this.wc.z), this.wc.z) : this.p.pos;
    this.vfx.ring(c.x, null, c.z, { r0: 1, r1: d.radius, dur: 0.5, color: 0xf0a83a, opacity: 0.45 });
    if (this.storm) this.storm.burst(c.x, c.y + 0.6, c.z, 12, 0.7);
    for (const t of this.combat.inCircle(c.x, c.z, d.radius)) {
      // IMPACTO: explosión circular de hojas sobre el enemigo (grande la primera vez, pequeña en los siguientes pulsos)
      const first = !this.hitOnce.has(t);
      this.hitOnce.add(t);
      if (this.storm) this.storm.burst(t.pos.x, t.pos.y + 0.8, t.pos.z, first ? 55 : 14, first ? 1 : 0.6);
      if (first) {
        this.vfx.ring(t.pos.x, null, t.pos.z, { r0: 0.3, r1: 2.4, dur: 0.45, color: 0xffc85a, opacity: 0.7 });
        for (let i = 0; i < 8; i++) this.g.fx.sparkle(t.pos.x + rnd(-0.5, 0.5), t.pos.y + rnd(0.4, 1.6), t.pos.z + rnd(-0.5, 0.5), i % 2 ? 0xffd86a : 0xffffff, 2.5);
      }
      const { dx, dz } = this.awayFrom(t, c.x, c.z);
      this.hit(t, d.damage);
      this.combat.root(t, d.rootT);
      this.combat.slow(t, d.slowF, d.slowT);
      this.combat.push(t, dx, dz, d.force);
    }
  }
}

/* ====================================================================== */
/*  ÁGUILA — Picado del Trueno                                             */
/* ====================================================================== */
class DiveSkill extends Skill {
  begin() {
    const d = this.def, p = this.p;
    const tgt = this.combat.aimTarget(p.pos.x, p.pos.z, p.facing, 40 * DEG, d.range);
    let x, z;
    if (tgt) {
      const dx = p.pos.x - tgt.pos.x, dz = p.pos.z - tgt.pos.z, l = Math.hypot(dx, dz) || 1, back = Math.min(l, tgt.radius * 0.7 + 0.6);
      x = tgt.pos.x + (dx / l) * back; z = tgt.pos.z + (dz / l) * back;
    } else {
      const f = this.fwd;
      x = p.pos.x + f.x * d.range * 0.6; z = p.pos.z + f.z * d.range * 0.6;
    }
    this.land = V(x, p.floorY(x, z, p.pos.y + d.ascendHeight), z);
    this.face(x, z);
    this.start();
    return true;
  }
  /* MÁQUINA DE ESTADOS: preparación → ascenso (animación original) → DESCENSO DIRIGIDO (espera la confirmación)
     → picado → impacto → recuperación. El picado solo empieza con la segunda pulsación del botón. */
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'preparacion', dur: d.prep, enter: () => { this.lock(true); audio.whoosh(); }, tick: (dt, k) => { pose.sy = 1 - 0.1 * k; pose.rx = -0.3 * k; } },
      { name: 'ascenso', dur: d.charge, enter: this.enterAscend, tick: this.tickAscend },
      { name: 'descenso', dur: d.waitMax || 9, enter: this.enterAim, tick: this.tickAim, exit: () => { if (this.t >= (d.waitMax || 9) - 0.001) this.cancelled = true; } },
      { name: 'picado', dur: 1, enter: this.enterDive, tick: this.tickDive },
      { name: 'impacto', dur: 0.35, enter: this.enterImpact, tick: (dt, k) => { pose.sy = lerp(0.8, 1, k); pose.rx = lerp(0.3, 0, k); } },
      { name: 'recuperacion', dur: d.recover, tick: (dt, k) => { pose.sy = 1; } },
    ];
  }
  get canRecast() { return this.stageName === 'descenso'; }
  recast() {
    if (this.stageName !== 'descenso') return false;
    this.endStage(); // CONFIRMADO: ahora sí, el picado hacia el punto elegido
    if (this.g.armButton) this.g.armButton(this.key);
    return true;
  }
  enterAscend() {
    const d = this.def;
    this.from = this.p.pos.clone();
    this.script(true);
    this.mark = this.track(this.vfx.telegraph('disc', { x: this.land.x, z: this.land.z, r: d.waveRadius * 0.55, color: 0x6ad0ff, opacity: 0.5 })); // señal clara del punto de impacto
  }
  tickAscend(dt, k) {
    const d = this.def, p = this.p, e = ease(k);
    p.pos.set(this.from.x, this.from.y + d.ascendHeight * e, this.from.z);
    this.mark.setProgress(k);
    this.pose.rx = -0.4; this.pose.sy = 1 + 0.05 * k;
    if (Math.random() < 0.8) { // la electricidad crece alrededor del cuerpo
      const c = this.center(0.5);
      this.vfx.bolt(c, V(c.x + rnd(-1.4, 1.4), c.y + rnd(-1, 1.2), c.z + rnd(-1.4, 1.4)), { color: 0xbfe8ff, life: 0.1, jag: 0.3, segs: 5 });
    }
  }
  enterAim() {
    this.top = this.p.pos.clone();
    this.ready = 0;
    ui.banner('find', '⚡ Picado preparado', 'Dirígelo con las teclas de dirección y pulsa otra vez el botón para lanzar el ataque');
    audio.sfx && audio.sfx('shimmer');
  }
  // DESCENSO DIRIGIDO: baja despacio envuelta en rayos; las teclas mueven el punto de impacto (siempre a la vista)
  tickAim(dt, k) {
    const d = this.def, p = this.p, pose = this.pose, g = this.g;
    const ax = g.input && g.input.moveAxes ? g.input.moveAxes() : { x: 0, y: 0 }, yaw = g.chase.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const mx = fx * ax.y + rx * ax.x, mz = fz * ax.y + rz * ax.x;
    if (Math.hypot(mx, mz) > 0.05) {
      this.land.x += mx * d.steerSpeed * dt; this.land.z += mz * d.steerSpeed * dt;
      const ox = this.land.x - this.from.x, oz = this.land.z - this.from.z, l = Math.hypot(ox, oz);
      if (l > d.range) { this.land.x = this.from.x + (ox / l) * d.range; this.land.z = this.from.z + (oz / l) * d.range; }
      this.land.y = p.floorY(this.land.x, this.land.z, this.land.y + 4);
    }
    // va bajando poco a poco (sin llegar al suelo) y se orienta hacia el objetivo
    const floor = p.floorY(p.pos.x, p.pos.z, p.pos.y), hover = floor + d.hoverH;
    p.pos.y = Math.max(hover, p.pos.y - d.descendSpeed * dt);
    p.facing = Math.atan2(this.land.x - p.pos.x, this.land.z - p.pos.z);
    pose.rx = 0.35 + 0.08 * Math.sin(this.t * 6); pose.sy = 1.05;
    this.mark.set(this.land.x, this.land.z, {}); this.mark.setProgress(0.6 + 0.4 * (0.5 + 0.5 * Math.sin(this.t * 8))); // señal parpadeante: listo, esperando la orden
    // RAYOS: alrededor del cuerpo y sobre la zona de impacto (cada vez más intensos)
    const c = this.center(0.5), I = Math.min(1, 0.4 + this.t * 0.5);
    if (Math.random() < 0.7 * I) this.vfx.bolt(c, V(c.x + rnd(-1.6, 1.6), c.y + rnd(-1.2, 1.4), c.z + rnd(-1.6, 1.6)), { color: 0xbfe8ff, life: 0.09, jag: 0.35, segs: 6 });
    if (Math.random() < 0.35 * I) { const a = rnd(0, TAU), r = rnd(0, d.waveRadius * 0.5), gx = this.land.x + Math.cos(a) * r, gz = this.land.z + Math.sin(a) * r, gy = this.gy(gx, gz); this.vfx.bolt(V(gx, gy + rnd(3, 6), gz), V(gx, gy + 0.1, gz), { color: 0x9ad8ff, life: 0.1, jag: 0.5, segs: 7 }); }
    if (Math.random() < 0.25) this.vfx.bolt(c, V(this.land.x, this.land.y + 0.3, this.land.z), { color: 0x6ad0ff, life: 0.06, jag: 0.4, segs: 8 }); // hilo de energía hacia el objetivo
    if (Math.random() < 0.3) this.vfx.orb(c, { r: 0.35 + 0.2 * I, color: 0x9ad8ff, opacity: 0.4, life: 0.15 });
  }
  enterDive() {
    if (this.cancelled) { // no se confirmó: baja a tierra sin atacar
      const p = this.p; this.land = V(p.pos.x, p.floorY(p.pos.x, p.pos.z, p.pos.y), p.pos.z);
      ui.banner('find', '⚡', 'Picado cancelado: no se confirmó el ataque');
    }
    this.p.facing = Math.atan2(this.land.x - this.p.pos.x, this.land.z - this.p.pos.z);
    this.diveFrom = this.p.pos.clone();
    this.stages[this.i].dur = Math.max(0.12, this.diveFrom.distanceTo(this.land) / (this.cancelled ? 5 : this.def.diveSpeed));
    this.mark.setProgress(1);
    audio.noiseBurst(0.3, 800, 0.4, 'bandpass');
  }
  tickDive(dt, k) {
    const p = this.p;
    p.pos.lerpVectors(this.diveFrom, this.land, k * k * (1.4 - 0.4 * k));
    if (this.cancelled) { this.pose.rx = 0.15; this.pose.sy = 1; return; } // baja planeando, sin picado
    this.pose.rx = 1.35; this.pose.sy = 1.18;
    const c = this.center(0.5);
    this.vfx.orb(c, { r: 0.5, color: 0xbfe8ff, life: 0.25 });
    this.vfx.bolt(c, V(c.x + rnd(-1, 1), c.y + 1.4, c.z + rnd(-1, 1)), { color: 0x9ad8ff, life: 0.08, jag: 0.3, segs: 4 });
  }
  enterImpact() {
    const d = this.def, p = this.p, l = this.land;
    p.pos.copy(l);
    this.release(0, 0, 0);
    this.lock(false);
    this.mark.kill();
    if (this.cancelled) return; // sin confirmación no hay impacto
    this.shake(d.shake); audio.noiseBurst(0.5, 200, 0.6, 'lowpass');
    this.vfx.ring(l.x, null, l.z, { r0: 0.6, r1: d.waveRadius, dur: 0.55, color: 0xffffff });
    this.vfx.ring(l.x, null, l.z, { r0: 0.3, r1: d.waveRadius * 0.8, dur: 0.45, color: 0x6ad0ff });
    this.vfx.dust(l.x, l.y + 0.2, l.z, 14, 2.4);
    for (let i = 0; i < 6; i++) { // rayos radiales
      const a = (i / 6) * TAU + rnd(-0.2, 0.2);
      this.vfx.bolt(V(l.x, l.y + 0.3, l.z), V(l.x + Math.cos(a) * d.waveRadius, l.y + 0.3, l.z + Math.sin(a) * d.waveRadius), { jag: 0.7, life: 0.25, segs: 8 });
    }
    for (const t of this.combat.inCircle(l.x, l.z, d.waveRadius)) {
      this.hit(t, d.damage);
      const { dx, dz } = this.awayFrom(t, l.x, l.z);
      this.combat.push(t, dx, dz, d.force);
    }
    this.combat.deflect(l.x, l.z, d.waveRadius);
    const w = this.g.world;
    for (const o of [...w.obstacles]) if (o.alive && o.breakBy === 'wind' && Math.hypot(o.x - l.x, o.z - l.z) < d.waveRadius) w.breakObstacle(o);
  }
}

/* ====================================================================== */
/*  ÁGUILA — PICADO DE GARRAS DEL TRUENO (botón 5, especial)               */
/*  FUSIÓN REAL del Picado del Trueno y las Garras de Viento: un solo      */
/*  ataque en el que las garras de energía se cargan con el rayo del       */
/*  ascenso, van por delante en el picado y, al impactar, los tres         */
/*  zarpazos lanzan cuchillas de viento ELECTRIFICADAS (cada enemigo que   */
/*  tocan recibe un rayo); el zarpazo doble final las lanza en círculo.    */
/*  Conserva del picado: ascenso, descenso dirigido con confirmación,      */
/*  onda y rayos del impacto. De las garras: garras en las manos, estelas, */
/*  patadas, zarpazos y cuchillas.                                         */
/* ====================================================================== */
const clawEase = (k) => 1 - Math.pow(1 - k, 3);
class FusionDiveSkill extends DiveSkill {
  begin() {
    if (!super.begin()) return false;
    this.clawDef = { ...this.def.claws, electric: true };
    return true;
  }
  build() {
    const d = this.def, pose = this.pose, base = super.build();
    const by = (n) => base.find((s) => s.name === n);
    const wrap = (s, extra) => { const tk = s.tick; s.tick = (dt, k) => { if (tk) tk.call(this, dt, k); extra(dt, k); }; return s; };
    // PREPARACIÓN: aparecen las garras de energía (azules: ya llevan el rayo)
    const prep = by('preparacion'), pe = prep.enter;
    prep.enter = () => { pe.call(this); this.enterClaws(); if (this.clawMat) this.clawMat.color.set(0xbfe4ff); this.wind = 0; };
    wrap(prep, (dt, k) => { this.wind = ease(k) * 0.6; });
    // ASCENSO Y DESCENSO DIRIGIDO: el rayo se acumula en las garras (chispas y arcos entre las dos manos)
    const zapClaws = (I) => {
      this.charge(I);
      const L = boneWorld(this, 'hand_L'), R = boneWorld(this, 'hand_R');
      if (L && R && Math.random() < 0.35 * I) this.vfx.bolt(L, R, { color: 0x9fd0ff, life: 0.06, jag: 0.15, segs: 6 });
    };
    wrap(by('ascenso'), (dt, k) => { this.wind = 0.6 + 0.4 * k; zapClaws(0.5 + 0.5 * k); });
    wrap(by('descenso'), () => { this.wind = 1; zapClaws(1); });
    // PICADO: cae con las garras por delante (brazos extendidos) y estelas en las dos manos
    const dive = by('picado'), de = dive.enter;
    dive.enter = () => { de.call(this); if (!this.cancelled) { this.sw = { arm: 'B', tilt: 0, n: 2 }; this.phase = 'corte'; } };
    wrap(dive, () => { if (!this.cancelled) this.swK = 0.55; });
    // IMPACTO: la onda y los rayos del picado; las garras se preparan para el primer zarpazo
    const imp = by('impacto'), ie = imp.enter;
    imp.enter = () => { ie.call(this); this.phase = 'sigue'; if (!this.cancelled) { const L = this.land; this.vfx.orb(V(L.x, L.y + 0.8, L.z), { r: 1.1, color: 0xbfe4ff, opacity: 0.55, life: 0.18 }); } };
    // ZARPAZOS ELECTRIFICADOS (derecha → abanico, izquierda → abanico, doble → círculo completo)
    const C = d.claws, spread = C.spreadDeg * DEG;
    const SW = [
      { arm: 'R', tilt: 0.75, fan: [-1, 0, 1] },
      { arm: 'L', tilt: -0.75, fan: [-1, 0, 1] },
      { arm: 'B', tilt: 0, ring: C.ring || 8 },
    ];
    const combo = [];
    const skip = () => { if (this.cancelled) this.stages[this.i].dur = 0.001; };
    SW.forEach((s, i) => {
      const wind = i === 0 ? 0.08 : 0.11, cut = 0.09, follow = i === SW.length - 1 ? 0.2 : 0.06;
      combo.push({ name: `garra-carga${i}`, dur: wind, enter: () => { skip(); this.sw = s; this.phase = 'carga'; }, tick: (dt, k) => { if (this.cancelled) return; this.swK = -ease(k); pose.spin = (s.arm === 'R' ? -0.35 : s.arm === 'L' ? 0.35 : 0) * ease(k); pose.rx = 0.1; } });
      combo.push({ name: `garra-corte${i}`, dur: cut, enter: () => {
        skip(); if (this.cancelled) return;
        this.phase = 'corte';
        const f = this.p.facing;
        const angs = s.ring ? Array.from({ length: s.ring }, (_, j) => f + (j / s.ring) * TAU) : s.fan.map((o) => f + o * spread);
        this.slash({ ...s, angs }, i);
        this.kickHit(s);
        // el rayo acompaña cada zarpazo: arco desde la garra hacia delante y, en el último, una descarga en círculo
        const h = boneWorld(this, s.arm === 'L' ? 'hand_L' : 'hand_R') || this.center(0.6);
        this.vfx.bolt(h, V(h.x + Math.sin(f) * 2.4, h.y - 0.2, h.z + Math.cos(f) * 2.4), { color: 0xcfe6ff, life: 0.1, jag: 0.4, segs: 8 });
        if (s.ring) { const p = this.p; this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.5, r1: C.range * 0.45, dur: 0.4, color: 0x9fd0ff }); this.shake(0.18); }
      }, tick: (dt, k) => { if (this.cancelled) return; this.swK = -1 + 2 * clawEase(k); pose.spin = (s.arm === 'R' ? lerp(-0.35, 0.45, clawEase(k)) : s.arm === 'L' ? lerp(0.35, -0.45, clawEase(k)) : 0); pose.rx = 0.18 + (s.arm === 'B' ? 0.12 * k : 0); pose.dy = s.arm === 'B' ? 0.35 * Math.sin(k * Math.PI * 0.5) : 0; } });
      combo.push({ name: `garra-sigue${i}`, dur: follow, enter: () => { skip(); this.phase = 'sigue'; }, tick: (dt, k) => { if (this.cancelled) return; this.swK = 1 - 0.4 * ease(k); pose.dy = s.arm === 'B' ? 0.35 * (1 - ease(k)) : 0; } });
    });
    const rec = by('recuperacion');
    const out = base.filter((s) => s !== rec);
    out.push(...combo, { name: 'recuperacion', dur: d.recover, enter: () => { this.phase = 'fin'; }, tick: (dt, k) => { this.swK = 0.6 * (1 - ease(k)); this.wind = 1 - ease(k); pose.spin = lerp(pose.spin || 0, 0, k); pose.rx = lerp(0.15, 0, k); pose.sy = 1; this.clawK = 1 - ease(k); } });
    return out;
  }
  update(dt) {
    const done = super.update(dt);
    if (this.claws) this.tickClaws(dt);
    return done;
  }
}
for (const m of ['enterClaws', 'charge', 'slash', 'kickHit', 'tickClaws']) FusionDiveSkill.prototype[m] = WindClawsSkill.prototype[m];

/* ====================================================================== */
/*  DRAGÓN DE KOMODO — Lengua Camaleónica                                  */
/*  Lengua elástica de muchas articulaciones: sale, se pasa y rebota,      */
/*  se pega al objetivo y se recoge ondulando.                             */
/* ====================================================================== */
class TongueSkill extends Skill {
  begin() {
    const d = this.def, p = this.p;
    this.target = this.combat.aimTarget(p.pos.x, p.pos.z, p.facing, d.coneDeg * DEG, d.range);
    if (this.target) {
      this.face(this.target.pos.x, this.target.pos.z);
      if (this.target.heavy) {
        const dx = p.pos.x - this.target.pos.x, dz = p.pos.z - this.target.pos.z, l = Math.hypot(dx, dz) || 1, back = this.target.radius + p.R + 0.5;
        this.dest = V(this.target.pos.x + (dx / l) * back, this.target.pos.y, this.target.pos.z + (dz / l) * back);
        this.dest.y = this.gy(this.dest.x, this.dest.z);
        this.mode = 'propel';
      } else this.mode = 'pull';
    } else {
      // BALANCEO: sin enemigo delante, la lengua prefiere engancharse a un punto alto y balancear a Kairo
      const a = findSwingAnchor(this, d.swingRange || 22, d.swingConeDeg || 65);
      if (a) { this.anchor = a; this.mode = 'swing'; this.cdFactor = d.swingCdFactor || 0.35; this.swingColor = 0xff7aa0; }
      else {
        const s = this.findSurface();
        if (s) { this.dest = s; this.mode = 'propel'; } else this.mode = 'whiff';
      }
    }
    if (this.mode === 'whiff') { this.cdFactor = 0.45; ui.banner('find', '👅', 'No hay nada al alcance de la lengua'); }
    this.tongue = makeElastic(this, { n: d.segments || 32, r0: 0.07, r1: 0.05, color: 0xff5a7c, rough: 0.22, emissive: 0x3a0010, tipR: 0.11 });
    this.rope = this.tongue; // el balanceo (swing.js) mueve la misma lengua
    { const set = this.tongue.set; this._tipNow = V(); this.tongue.set = (a, b, o) => { this._tipNow.copy(b); set(a, b, o); }; } // recuerda la punta
    this.mouthOff = this.measureMouth();
    if (this.mode === 'swing') this.fork = this.makeFork();
    this.start();
    return true;
  }
  // PUNTA BÍFIDA del Komodo: dos puntas finas que se abren al final de la lengua (solo en el balanceo,
  // donde la lengua se ve larga y tensa)
  makeFork() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xff5a7c, roughness: 0.25, emissive: 0x3a0010 });
    const geo = new THREE.ConeGeometry(0.035, 0.26, 6); geo.translate(0, 0.13, 0); geo.rotateX(Math.PI / 2);
    const grp = new THREE.Group();
    for (const s of [-1, 1]) { const m = new THREE.Mesh(geo, mat); m.rotation.y = s * 0.38; grp.add(m); }
    grp.visible = false;
    this.g.scene.add(grp);
    this.track({ kill: () => { this.g.scene.remove(grp); geo.dispose(); mat.dispose(); } });
    return grp;
  }
  // coloca la punta bífida en el extremo de la lengua, apuntando en su dirección
  placeFork(from, to) {
    const f = this.fork; if (!f) return;
    if (this.tongue.dead) { f.visible = false; return; }
    f.visible = true; f.position.copy(to);
    f.lookAt(to.x * 2 - from.x, to.y * 2 - from.y, to.z * 2 - from.z);
  }
  origin() { return this.mouth(); }
  // Superficie válida delante: avanza por el rayo hasta chocar con un sólido y propone dónde aterrizar
  findSurface() {
    const d = this.def, p = this.p, f = this.fwd, w = this.g.world, ym = p.pos.y + p.H * 0.5;
    let prev = null;
    for (let r = p.R + 0.5; r <= d.range; r += 0.5) {
      const x = p.pos.x + f.x * r, z = p.pos.z + f.z * r;
      const near = w.solidsNear(x - 0.15, x + 0.15, z - 0.15, z + 0.15, []);
      const s = near.find((q) => !SKIP_TAGS.has(q.tag) && x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1 && ym > q.y0 && ym < q.y1);
      if (s && prev) {
        if (r < d.surfaceMinDist) return null;
        const rise = s.y1 - p.pos.y;
        if (rise > 0.9 && rise < 7 && s.x1 - s.x0 > 1 && s.z1 - s.z0 > 1) { // sube encima
          return V(clamp(x, s.x0 + 0.5, s.x1 - 0.5), s.y1 + 0.05, clamp(z, s.z0 + 0.5, s.z1 - 0.5));
        }
        return V(prev.x, p.floorY(prev.x, prev.z, p.pos.y + 1), prev.z); // se acerca hasta la pared
      }
      prev = { x, z };
    }
    return null;
  }
  tip() {
    const p = this.p, d = this.def, f = this.fwd;
    if (this.mode === 'pull') return V(this.target.pos.x, this.target.pos.y + 0.6, this.target.pos.z);
    if (this.mode === 'propel') return this.target ? V(this.target.pos.x, this.target.pos.y + this.target.S.height * 0.45, this.target.pos.z) : V(this.dest.x, this.dest.y + 0.4, this.dest.z);
    return V(p.pos.x + f.x * d.range * 0.6, p.pos.y + p.H * 0.45, p.pos.z + f.z * d.range * 0.6);
  }
  // BOCA DEL DRAGÓN: el hueso de la cabeza apunta hacia arriba (head_end es la coronilla), así que la boca
  // se mide una vez delante de la cabeza, en el morro, y se guarda en el espacio del hueso: así sigue a la
  // cabeza en todas las animaciones y se ve bien desde cualquier ángulo de cámara
  measureMouth() {
    const m = this.p.model, hb = m && m.bones && m.bones.head;
    if (!hb) return null;
    m.root.updateMatrixWorld(true);
    const s = (m.height || 1.9) / 1.9;
    const h = m.root.worldToLocal(hb.getWorldPosition(V(0, 0, 0)));
    const w = m.root.localToWorld(V(h.x, h.y - 0.03 * s, h.z + 0.25 * s)); // morro, un poco por debajo de la nariz
    return hb.worldToLocal(w);
  }
  mouth() {
    const f = this.fwd, hb = this.p.model && this.p.model.bones && this.p.model.bones.head;
    if (hb && this.mouthOff) { this.p.model.root.updateMatrixWorld(true); return hb.localToWorld(this.mouthOff.clone()); }
    const b = boneWorld(this, 'head_end');
    if (b) return b.add(V(f.x * 0.12, -0.05, f.z * 0.12));
    return V(this.p.pos.x + f.x * this.p.R * 0.9, this.p.pos.y + this.p.H * 0.55, this.p.pos.z + f.z * this.p.R * 0.9);
  }
  build() {
    const d = this.def, pose = this.pose, ov = d.overshoot || 0.12, wob = d.wobble || 0.45;
    if (this.mode === 'swing') return this.buildSwing();
    const st = [
      { name: 'espera', dur: d.delay || 0 }, // espera de activación (0,5 s, igual que la cola de Jaglion)
      { name: 'preparacion', dur: d.prep, enter: () => { if (this.target && !this.target.dead) this.face(this.target.pos.x, this.target.pos.z); }, tick: (dt, k) => { pose.rx = -0.18 * k; pose.sy = 1 - 0.05 * k; } },
      // extensión: rápida, se pasa del objetivo y rebota (elasticidad)
      { name: 'extension', dur: d.shootT * 1.4, enter: () => { audio.whoosh(); this.sfx('slurp'); }, tick: (dt, k) => {
        const m = this.mouth(), t = this.tip(), e = 1 - Math.pow(1 - k, 3) + ov * Math.sin(k * Math.PI) * k;
        this.tongue.set(m, m.clone().lerp(t, e), { wobble: wob * (1 - k), phase: this.t * 34, waves: 2.5 });
        pose.rx = lerp(-0.18, 0.22, k);
      }, exit: () => this.stick() },
    ];
    if (this.mode === 'pull') st.push({ name: 'agarre-y-retraccion', dur: Math.min(0.9, d.retractT + this.p.pos.distanceTo(this.target.pos) / d.pullSpeed), tick: this.tickPull });
    else if (this.mode === 'propel') {
      const away = this.dest.distanceTo(this.p.pos);
      st.push({ name: 'impulso', dur: Math.max(0.1, away / d.propelSpeed), enter: this.enterPropel, tick: this.tickPropel, exit: this.exitPropel });
    } else st.push({ name: 'retraccion', dur: d.retractT, tick: (dt, k) => { const m = this.mouth(), t = this.tip(); this.tongue.set(m, t.clone().lerp(m, ease(k)), { wobble: wob * 0.8 * Math.sin(k * Math.PI), phase: this.t * 28, waves: 3 }); } });
    if (this.mode !== 'whiff') st.push({ name: 'giro-de-cola', dur: d.spinT, enter: () => { this.spun = false; this.tongue.kill(); this.sfx('snap'); }, tick: this.tickSpin });
    st.push({ name: 'recuperacion', dur: d.recover, tick: (dt, k) => { this.tongue.kill(); pose.spin = 0; pose.rx = lerp(pose.rx, 0, k); pose.sy = lerp(pose.sy, 1, k); } });
    return st;
  }
  /* MODO BALANCEO (lengua del Komodo): breve preparación (estira el cuello y abre la boca), la lengua sale de la
     boca hacia el punto alto, se clava con su punta bífida y Kairo se balancea como un péndulo (swing.js).
     Al soltarse remata con su giro de cola si cae cerca de enemigos. */
  buildSwing() {
    const d = this.def, pose = this.pose;
    const sw = swingStages(this, { color: 0xff7aa0, shoot: 46 });
    for (const s of sw) { // la punta bífida sigue a la lengua en cada fase
      const tk = s.tick;
      s.tick = (dt, k) => { tk(dt, k); const o = this.mouth(); this.placeFork(o, this._forkTip(o)); };
    }
    return [
      { name: 'preparacion', dur: d.prep, enter: () => this.face(this.anchor.x, this.anchor.z), tick: (dt, k) => { pose.rx = -0.25 * k; pose.sy = 1 - 0.05 * k; } },
      ...sw,
      { name: 'recuperacion', dur: d.recover, enter: () => { this.tongue.kill(); if (this.fork) this.fork.visible = false; }, tick: (dt, k) => { pose.rx = lerp(pose.rx, 0, k); pose.sy = lerp(pose.sy, 1, k); } },
    ];
  }
  // punta visible de la lengua mientras sale o se recoge (último punto del tubo)
  _forkTip(o) { return this._tipNow || this.anchor || o; }
  // la punta se pega al objetivo: salpicadura rosa y chasquido
  stick() {
    if (this.mode === 'whiff') return;
    const t = this.tip();
    this.sfx('stick');
    this.vfx.ring(t.x, t.y, t.z, { r0: 0.1, r1: 1.1, dur: 0.3, color: 0xff7aa0 });
    this.vfx.sparks(t.x, t.y, t.z, 0xffa0c0, 10, 2.4);
    this.vfx.orb(t, { r: 0.35, color: 0xff6a9a, life: 0.25, grow: 1 });
  }
  tickPull(dt, k) {
    const t = this.target, p = this.p, f = this.fwd;
    if (t.dead) { this.endStage(); return; }
    const m = this.mouth();
    // tensa y con un leve rebote mientras arrastra
    this.tongue.set(m, V(t.pos.x, t.pos.y + 0.6, t.pos.z), { wobble: 0.08 * Math.sin(this.t * 20), phase: this.t * 18, sag: 0.15 });
    const to = V(p.pos.x + f.x * (p.R + t.radius + 0.4), p.pos.y, p.pos.z + f.z * (p.R + t.radius + 0.4));
    this.combat.pull(t, to, this.def.pullSpeed, 0.2);
    this.pose.rx = -0.12; // tira con el cuello
    if (Math.hypot(t.pos.x - to.x, t.pos.z - to.z) < 0.6) { this.sfx('slurp'); this.endStage(); }
  }
  enterPropel() {
    this.from = this.p.pos.clone();
    this.script(true);
    this.face(this.dest.x, this.dest.z);
  }
  tickPropel(dt, k) {
    const e = ease(k), p = this.p;
    p.pos.lerpVectors(this.from, this.dest, e);
    p.pos.y += Math.sin(k * Math.PI) * 0.6;
    this.tongue.set(this.mouth(), this.tip(), { wobble: 0.05, phase: this.t * 12 });
    this.pose.rx = 0.5; this.pose.sy = 1.1;
    this.vfx.orb(this.center(0.5), { r: 0.3, color: 0xffb070, life: 0.25 });
  }
  exitPropel() {
    const f = this.fwd, top = this.dest.y > this.from.y + 0.9;
    this.p.pos.copy(this.dest);
    this.release(f.x * 2, top ? 3 : 0, f.z * 2);
  }
  // giro final de la cola: golpea en círculo
  tickSpin(dt, k) {
    const d = this.def, p = this.p;
    this.pose.spin = k * TAU * 1.0; this.pose.rx = 0.1; this.pose.sy = 1;
    if (!this.spun && k > 0.4) {
      this.spun = true;
      this.shake(0.2); audio.noiseBurst(0.3, 400, 0.3, 'lowpass');
      this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.8, r1: d.spinRadius + 0.6, dur: 0.35, color: 0xffc080 });
      this.vfx.dust(p.pos.x, p.pos.y + 0.2, p.pos.z, 8, 1.8);
      for (const t of this.combat.inCircle(p.pos.x, p.pos.z, d.spinRadius)) {
        this.hit(t, d.spinDamage);
        const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z);
        this.combat.push(t, dx, dz, d.spinForce);
      }
    }
  }
}

/* ====================================================================== */
/*  NUTRIA — Blink Acuático                                                */
/* ====================================================================== */
class BlinkSkill extends Skill {
  begin() {
    const d = this.def, p = this.p, w = this.g.world;
    const dxm = p.dirX, dzm = p.dirZ, ml = Math.hypot(dxm, dzm);
    const dir = ml > 0.1 ? { x: dxm / ml, z: dzm / ml } : this.fwd; // hacia donde se mueve, o hacia donde mira
    this.dir = dir;
    for (let r = d.distance; r >= 2; r -= 0.5) { // la distancia más larga que tenga hueco libre
      const x = p.pos.x + dir.x * r, z = p.pos.z + dir.z * r;
      const fy = p.floorY(x, z, p.pos.y + 1.2);
      if (fy - p.pos.y > 1.3) continue;
      const near = w.solidsNear(x - p.R - d.minClear, x + p.R + d.minClear, z - p.R - d.minClear, z + p.R + d.minClear, []);
      if (near.some((s) => !SKIP_TAGS.has(s.tag) && s.y0 < fy + p.H * 0.8 && s.y1 > fy + 0.55)) continue;
      this.dest = V(x, fy, z);
      break;
    }
    if (!this.dest) { ui.banner('find', '💧', 'No hay espacio libre para aparecer'); return false; }
    this.from = p.pos.clone();
    this.start();
    return true;
  }
  // HIDROTELETRANSPORTE: se funde girando en un remolino de agua, viaja dentro de un arco de agua y sale disparada
  // de un géiser en el destino. Los efectos de agua viven por su cuenta (vfx) y se desvanecen con suavidad aunque
  // la habilidad ya haya terminado; la Nutria solo está oculta mientras viaja.
  build() {
    const d = this.def, pose = this.pose, tv = d.travelT || 0;
    return [
      { name: 'desvanecer', dur: d.vanishT, enter: () => {
        this.lock(true);
        const c = this.from;
        this.makeGate();
        this.vfx.splash(c.x, c.y + 0.3, c.z, 12, 0.8);
        audio.splash();
      }, tick: (dt, k) => {
        // se funde en el agua: se aplasta, se encoge, se hunde un poco y gira con el remolino; solo deja de verse
        // cuando ya es un charco (al final de la etapa), nunca antes de completar la transformación
        const e = ease(k);
        pose.sy = lerp(1, 0.08, e); pose.sc = lerp(1, 0.55, e); pose.dy = -0.25 * e; pose.spin = e * TAU * 1.25; pose.rx = 0.15 * Math.sin(k * Math.PI);
        pose.hidden = k > 0.97;
        if (Math.random() < 0.8) { const c = this.from, a = this.t * 14; this.g.fx.spray(c.x + Math.cos(a) * 0.6, c.y + 0.2, c.z + Math.sin(a) * 0.6, -Math.cos(a) * 1.5, 1.5, -Math.sin(a) * 1.5, 0.8); } // gotas que el remolino absorbe
      } },
      ...(tv > 0 ? [{ name: 'viaje', dur: tv, tick: () => { pose.hidden = true; } }] : []),
      { name: 'aparecer', dur: d.appearT, enter: this.enterAppear, tick: (dt, k) => {
        // el agua se reúne y reconstruye su cuerpo: crece desde el géiser, se estira y se asienta con un rebote
        const e = ease(k);
        pose.hidden = false; pose.dy = lerp(0.45, 0, e);
        pose.sc = lerp(0.55, 1, 1 - Math.pow(1 - k, 3));
        pose.sy = k < 0.5 ? lerp(0.2, 1.12, ease(k / 0.5)) : lerp(1.12, 1, ease((k - 0.5) / 0.5));
        pose.spin = (1 - e) * -TAU * 0.5;
        // gotas que vuelven hacia ella desde el charco (el agua se junta)
        const b = this.dest, fx = this.g.fx;
        if (k < 0.8) for (let i = 0; i < 2; i++) { const a = rnd(0, TAU), r = rnd(0.7, 1.3); fx.spray(b.x + Math.cos(a) * r, b.y + rnd(0.1, 0.5), b.z + Math.sin(a) * r, -Math.cos(a) * r * 3, rnd(1, 2.5), -Math.sin(a) * r * 3, 0.6); }
      } },
      { name: 'recuperacion', dur: d.recover, tick: () => { pose.hidden = false; pose.sc = 1; } },
    ];
  }
  // efectos de agua del viaje completo, en su propia línea de tiempo (1,5 s)
  makeGate() {
    const d = this.def, a = this.from.clone(), b = this.dest.clone(), tv = d.travelT || 0;
    const T0 = d.vanishT, T1 = T0 + tv, T2 = T1 + d.appearT, LIFE = T2 + 1.0;
    const gate = takeGate();
    gate.setArc(a, b, 1.6 + 0.12 * a.distanceTo(b));
    if (!gate.head) { gate.head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 14), gate.vMat); gate.geos.push(gate.head.geometry); gate.group.add(gate.head); }
    const head = gate.head;
    const fx = this.g.fx, vfx = this.vfx;
    let splashed = false;
    vfx.add(gate.group, LIFE, (it, dt) => {
      const t = it.t, sm = (x0, x1) => clamp((t - x0) / (x1 - x0), 0, 1);
      const vortex = Math.min(sm(0, T0 * 0.6), 1 - sm(T1, T1 + 0.25));
      const arcHead = sm(T0 * 0.7, T1 + 0.04);
      const arc = Math.min(sm(T0 * 0.6, T0 * 0.9), 1 - sm(T2, T2 + 0.6));
      const geyser = Math.min(sm(T1 - 0.04, T1 + 0.12), 1 - sm(T2 - 0.05, T2 + 0.5));
      const poolA = 0.85 * Math.min(sm(0, 0.12), 1 - sm(T1, T1 + 0.7)), poolB = 0.85 * Math.min(sm(T1 - 0.05, T1 + 0.1), 1 - sm(T2 + 0.2, LIFE));
      gate.update(dt, { a, b, vortex, arc, arcHead, geyser, poolA, poolB });
      // la "gota" que viaja por el arco
      const u = sm(T0 * 0.7, T1 + 0.02);
      head.visible = u > 0 && u < 1;
      if (head.visible) { gate.pointOnArc(u, head.position); head.scale.setScalar(0.6 + 0.6 * Math.sin(u * Math.PI)); if (Math.random() < 0.8) fx.spray(head.position.x, head.position.y, head.position.z, 0, -1, 0, 0.7); }
      if (!splashed && t >= T1) { splashed = true; fx.splash(b.x, b.y + 0.2, b.z, 22, 1.4); vfx.ring(b.x, null, b.z, { r0: 0.3, r1: 3.2, dur: 0.6, color: 0x8ae0ff }); vfx.ring(b.x, null, b.z, { r0: 0.2, r1: 2.0, dur: 0.8, color: 0xffffff, opacity: 0.5 }); }
      if (geyser > 0.2 && Math.random() < 0.7) fx.spray(b.x + rnd(-0.3, 0.3), b.y + 0.3 + geyser * 2, b.z + rnd(-0.3, 0.3), rnd(-1.5, 1.5), 1 + geyser * 3, rnd(-1.5, 1.5), 1);
      if (t >= LIFE - 0.001) returnGate(gate); // vuelve a la reserva (no se destruye)
    });
    vfx.ring(a.x, null, a.z, { r0: 0.2, r1: 2.4, dur: 0.6, color: 0x8ae0ff });
  }
  enterAppear() {
    const p = this.p, to = this.dest;
    p.pos.copy(to);
    p.vx = this.dir.x * 6; p.vz = this.dir.z * 6; p.vy = 0;
    this.lock(false);
    this.makeTrail(this.from, to);
  }
  // estela de agua: salpicaduras y ondas; empuja y ralentiza a los enemigos que la cruzan
  makeTrail(a, b) {
    const d = this.def, dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1, ux = dx / len, uz = dz / len;
    // estela visible: charcos de bordes suaves a lo largo del camino (misma anchura que la zona que frena)
    for (let r = 0.3; r <= len; r += 0.9) {
      const x = a.x + ux * r, z = a.z + uz * r, y = this.p.floorY(x, z, Math.max(a.y, b.y) + 1);
      puddle(this.vfx, x, y, z, d.trailWidth * 0.55, d.trailTime);
      if (r % 1.8 < 0.9) this.vfx.ring(x, null, z, { r0: 0.2, r1: d.trailWidth * 0.8, dur: 0.9, color: 0xbfeaff, opacity: 0.4 });
    }
    const combat = this.combat, vfx = this.vfx, gy = this.gy;
    let drop = 0;
    this.linger({
      life: d.trailTime,
      update: (dt) => {
        for (const t of combat.targets()) {
          const px = t.pos.x - a.x, pz = t.pos.z - a.z, k = clamp((px * ux + pz * uz) / len, 0, 1);
          const cx = a.x + ux * k * len, cz = a.z + uz * k * len;
          if (Math.hypot(t.pos.x - cx, t.pos.z - cz) < d.trailWidth * 0.5 + t.radius) {
            combat.slow(t, d.trailSlowF, d.trailSlowT);
            combat.push(t, ux, uz, d.trailForce * dt * 4);
          }
        }
        drop -= dt;
        if (drop <= 0) { drop = 0.12; const r = Math.random() * len; vfx.splash(a.x + ux * r, gy(a.x + ux * r, a.z + uz * r) + 0.15, a.z + uz * r, 2, 0.4); }
      },
      end: () => {},
    });
  }
}

Object.defineProperties(TailSkill.prototype, Object.getOwnPropertyDescriptors(SwingMixin));
Object.defineProperties(TongueSkill.prototype, Object.getOwnPropertyDescriptors(SwingMixin));
const SKILLS = { tail: TailSkill, haboob: HaboobSkill, seasons: SeasonsSkill, wheel: WheelSkill, dive: DiveSkill, fusiondive: FusionDiveSkill, tongue: TongueSkill, blink: BlinkSkill, ...POWER_CLASSES, ...POWER2_CLASSES, ...POWER3_CLASSES };

/* ====================================================================== */
/*  Gestor: una habilidad principal a la vez + poderes de fondo (vuelo,    */
/*  espejismos) que conviven con ella                                      */
/* ====================================================================== */
export class HeroSkills {
  constructor(game) {
    this.g = game;
    this.cur = null;
    this.bg = [];          // poderes de fondo activos
    this.seasonIdx = 0;
  }

  // Habilidades del héroe para la barra: [{ id, key, icon, name, cd }]
  // en el orden de HERO_BUTTONS (botones 2..N; el botón 1 de velocidad es el poder base)
  entries(heroId) {
    const set = HERO_SKILLS[heroId], order = HERO_BUTTONS[heroId];
    if (!set || !order) return [];
    return order.filter(([key]) => set[key]).map(([key, role]) => { const def = set[key]; return { id: `hs:${key}`, key, icon: def.icon, name: def.name, cd: def.cd, hs: true, role }; });
  }
  // animación del botón de velocidad (se superpone mientras dura el impulso del poder base)
  startSpeedFx() {
    if (this.bg.some((b) => b.key === '_speed')) return;
    const sk = new SKILLS.speedfx(this, { id: 'speedfx' });
    sk.key = '_speed';
    if (sk.begin()) this.bg.push(sk);
  }
  get busy() { return !!this.cur; }
  // ¿Hay una habilidad con esta clave en marcha? (para iluminar su botón mientras está activa)
  isActive(key) { return !!((this.cur && this.cur.key === key) || this.bg.some((b) => b.key === key)); }

  reset() {
    if (this._tail) { this._tail.h.end(); this._tail = null; }
    if (this.cur) { this.cur.dispose(); this.cur = null; }
    for (const b of this.bg) b.dispose();
    this.bg.length = 0;
    this.seasonIdx = 0;
    if (this.g.vfx2) this.g.vfx2.clear();
    const p = this.g.player;
    Object.assign(p.pose, NEUTRAL);
    p.fly = null; p.moveMul = 1; p.speedBuff = 1; p.animMul = 1; p.casting = 0;
    if (p.model) p.model.boneFx = null;
    if (this.g.weapons) this.g.weapons.reset(); // el héroe empieza siempre con el arma guardada
    this._needWarm = true; // se precompila en el primer fotograma de juego (con el escenario y sus luces ya completos)
  }
  // PRECOMPILACIÓN: los sombreadores de los poderes del héroe se preparan al empezar la partida, no la primera vez
  // que se lanzan (así ningún poder —hidroteletransporte, tormenta de hojas, congelación, roca, arena…— da un tirón).
  // Se hace una vez por héroe: los objetos temporales se añaden, se compilan y se retiran en el mismo instante.
  prewarm() {
    const g = this.g, R = g.renderer, p = g.player, id = g.hero && g.hero.id;
    if (!R || !R.compile || !id || !g.scene || !g.camera || !p) return;
    const key = id + ':' + (p.model && p.model.root ? p.model.root.uuid : '-');
    if (this._warm === key) return;
    this._warm = key;
    const temps = [], passes = [];
    const skinned = [];
    if (p.model && p.model.root) p.model.root.traverse((o) => { if (o.isSkinnedMesh && o.material && !Array.isArray(o.material)) skinned.push(o); });
    // pasada con otro material en el cuerpo del héroe (variante con esqueleto del sombreador) y vuelta al suyo
    const bodyPass = (mk) => passes.push(() => { const old = skinned.map((o) => o.material); skinned.forEach((o) => { o.material = mk(o.material); }); return () => skinned.forEach((o, i) => { const m = o.material; o.material = old[i]; if (m !== old[i] && m.userData.own) m.dispose(); }); });
    const add = (obj, done) => { g.scene.add(obj); temps.push(() => { g.scene.remove(obj); if (done) done(); }); };
    try {
      if (id === 'nilo') {
        const gate = takeGate();
        gate.setArc(p.pos.clone(), p.pos.clone().add(V(3, 0, 0)), 2);
        for (const o of [gate.vortex, gate.geyser, gate.arc]) o.visible = true;
        add(gate.group, () => returnGate(gate));
        puddle(g.vfx, p.pos.x, p.pos.y, p.pos.z, 0.5, 0.05); // estela de charcos (se apaga sola)
      }
      if (id === 'kyra') {
        const S = new LeafStorm(null, { n: 8, spare: 4 });
        S.update(1 / 60, p.pos.clone(), { r: 1, k: 1 });
        add(S.root, () => S.dispose());
        const sh = auroraShield(g.scene); sh.set(p.pos.clone(), 1, 1, 0.5, 0); temps.push(() => sh.dispose());
        const ar = frostArea(g.scene, 8); ar.set(p.pos.x, p.pos.y, p.pos.z, 1, 0); temps.push(() => ar.dispose());
        const ice = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), iceMaterials()[0]);
        add(ice, () => ice.geometry.dispose());
        if (g.frost) { const sh = new THREE.Mesh(g.frost.sGeo, g.frost.sMat); add(sh); const cr = new THREE.Mesh(g.frost.cGeo, g.frost.cMat); add(cr); bodyPass(() => g.frost.mat); }
      }
      if (id === 'kairo') { const d = cometDisc(g.scene); d.set(p.pos, 1, 1, 0); temps.push(() => d.dispose()); }
      if (id === 'jago') {
        const rock = propModel('roca');
        if (rock) { rock.position.copy(p.pos); add(rock); }
        const U = { uRise: { value: 0 }, uAmt: { value: 1 }, uFeet: { value: 0 }, uHt: { value: 1 }, uGlow: { value: 0 } };
        bodyPass((m) => petrifyMaterial(m, U, 6));
      }
      if (id === 'halley') { const U = { uSand: { value: 0 }, uST: { value: 0 }, uSNS: { value: 4 }, uLvl: { value: 1 }, uFeet: { value: 0 }, uHt: { value: 1 } }; bodyPass((m) => sandMaterial(m, U)); }
      // se compila con el MISMO destino que el dibujo real (el composer: espacio de color lineal, sin tone mapping);
      // si no, los sombreadores precompilados no coincidirían con los que usa la partida
      const rt = g.getMainRT ? g.getMainRT() : null, prevRT = R.getRenderTarget();
      if (rt) R.setRenderTarget(rt);
      try {
        R.compile(g.scene, g.camera);
        for (const pass of passes) { const undo = pass(); try { R.compile(g.scene, g.camera); } finally { undo(); } }
      } finally { R.setRenderTarget(prevRT); }
    } catch (e) { console.warn("precompilación de poderes:", e); } // si algo falla, el poder se compila al usarlo (como antes)
    for (const f of temps) { try { f(); } catch (e) { /* nada */ } }
  }

  /* KIRA — CADA PODER SALE DE SU COLA. Se ve qué cola usa: se alza y se orienta durante la preparación/carga
     (con un brillo de su color en la punta), da un latigazo justo cuando se lanza el poder y vuelve a su sitio
     en la recuperación. Las otras tres colas siguen con su movimiento natural. No cambia ningún poder. */
  tailOfPower(dt) {
    const g = this.g, TAILS = { skill: ['pink', 0xff8ad0], special: ['orange', 0xffa030], solstice: ['red', 0xff5a2a], aurora: ['blue', 0x6ad0ff] };
    const s = this.cur || this.bg.find((b) => TAILS[b.key]);
    const hero = g.hero && g.hero.id;
    if (this._tail && (!s || s !== this._tail.sk)) { this._tail.h.end(); this._tail = null; }
    if (!s || hero !== 'kyra' || !TAILS[s.key]) return;
    if (!this._tail) { const h = powerTail(s, TAILS[s.key][0]); if (!h) return; this._tail = { sk: s, h, stage: '', col: TAILS[s.key][1], glowT: 0 }; }
    const T = this._tail, st = T.h.st, name = s.stageName;
    const charging = /preparacion|aura-solar|canalizar|contener/.test(name);
    const launch = /ejecucion|rueda|lanzamiento|zona-polar|expansion/.test(name);
    if (name !== T.stage) { if (launch && !/ejecucion|rueda|lanzamiento|zona-polar|expansion/.test(T.stage)) st.whip = 1; T.stage = name; }
    st.k = charging ? Math.min(1, (st.k || 0) + dt * 4) : launch ? 1 : Math.max(0, st.k - dt * 3);
    // brillo del poder en la punta de la cola (de su color) mientras se carga y al lanzarlo
    T.glowT -= dt;
    if ((charging || st.whip > 0.3) && T.glowT <= 0) {
      T.glowT = 0.05;
      const tip = T.h.tip(new THREE.Vector3());
      g.vfx.orb(tip, { r: 0.06 + 0.07 * st.k + 0.12 * st.whip, color: T.col, opacity: 0.6, life: 0.2 });
      if (Math.random() < 0.5) g.fx.sparkle(tip.x, tip.y, tip.z, T.col, 0.8);
    }
  }
  // ¿Este poder está activo y admite una segunda pulsación? (saltar a un espejismo, aterrizar, salir de la roca)
  canRecast(key) { return !!this.recastTarget(key); }
  recastTarget(key) {
    for (const s of [this.cur, ...this.bg]) if (s && s.key === key && s.recast && s.canRecast) return s;
    return null;
  }
  recast(key) { const s = this.recastTarget(key); return s ? s.recast() : false; }

  // Devuelve false (no se pudo usar) o { cdFactor }
  use(key) {
    const g = this.g, hero = g.hero && g.hero.id, def = HERO_SKILLS[hero] && HERO_SKILLS[hero][key];
    if (!def) return false;
    const Cls = SKILLS[def.id];
    if (!Cls) return false;
    if (Cls.background) {
      if (this.bg.some((b) => b.key === key)) return false;
    } else if (this.cur) {
      // combo de arma: pulsar otra vez mientras se recupera del golpe encadena el siguiente movimiento
      if (this.cur.key === key && this.cur.chainReady) { this.cur.dispose(); this.cur = null; }
      else if (this.cur.key === key) return false;
      // las habilidades NO se bloquean entre sí: la que estaba en curso sigue en segundo plano y empieza la nueva
      else { this.bg.push(this.cur); this.cur = null; }
    }
    // ENCADENAR BALANCEOS (cola de Jaglion, lengua de Kairo): si cuelga de la cuerda y lanza otra habilidad de
    // balanceo, se suelta con el impulso del péndulo y la nueva se engancha a otro punto sin perder la velocidad
    if (Cls.prototype.letGo) this.letGoSwing();
    const p = this.g.player, wasScripted = p.scripted;
    const sk = new Cls(this, def);
    sk.key = key;
    if (!sk.begin()) { sk.dispose(); return false; }
    // solo dos movimientos guiados (cola, lengua, picado, blink, remolino) no pueden mover al héroe a la vez:
    // en ese caso la nueva espera; todas las demás combinaciones funcionan juntas
    if (wasScripted && sk._script) {
      sk._script = false; sk.dispose(); p.scripted = true;
      ui.banner('find', def.icon, 'Espera a terminar el movimiento en curso');
      return false;
    }
    sk.role = (HERO_BUTTONS[hero] || []).find(([k]) => k === key)?.[1] || null; // papel del botón (solo para animar al héroe)
    if (Cls.background) this.bg.push(sk); else this.cur = sk;
    // CLON AZUL de Bada: los poderes de fondo pueden reaccionar a un poder recién lanzado (lo copia a su lado)
    for (const b of this.bg) if (b !== sk && b.onHeroSkill) b.onHeroSkill(key, def, Cls, sk.role);
    // con el arma fuera, las demás habilidades también hacen estallar su energía
    const role = (HERO_BUTTONS[hero] || []).find(([k]) => k === key);
    if (g.weapons && !(role && role[1] === 'arma')) g.weapons.skillBurst();
    if (g.weapons && role && role[1] === 'escudo') g.weapons.defend(1.4); // con el arma fuera: postura de defensa
    return { cdFactor: sk.cdFactor };
  }

  // ¿Hay un balanceo en curso? (para dejar lanzar la otra herramienta aunque el héroe vaya guiado)
  get swinging() { return [this.cur, ...this.bg].some((s) => s && s.swinging); }
  letGoSwing() { let ok = false; for (const s of [this.cur, ...this.bg]) if (s && s.swinging && s.letGo('boton')) ok = true; return ok; }

  update(dt) {
    if (this._needWarm) { this._needWarm = false; this.prewarm(); }
    const p = this.g.player;
    Object.assign(p.pose, NEUTRAL);
    const c = this.g.combat;
    for (let i = this.bg.length - 1; i >= 0; i--) { const b = this.bg[i]; c.src = b; const done = b.update(dt); c.src = null; if (done) { b.dispose(); this.bg.splice(i, 1); } }
    if (this.cur) { c.src = this.cur; const done = this.cur.update(dt); c.src = null; if (done) { this.cur.dispose(); this.cur = null; } }
    this.tailOfPower(dt);
    p.skillRole = (this.cur && this.cur.role) || (this.bg.find((b) => b.role && b.role !== 'velocidad') || {}).role || null;
  }
}
