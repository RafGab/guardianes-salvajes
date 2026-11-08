import * as THREE from 'three';
import { Staged, rnd, TAU } from './attack.js';
import { HERO_SKILLS, HERO_BUTTONS } from './config.js';
import { makeTentacle } from './props.js';
import { terrainH } from '../terrain.js';
import { Audio3D as audio } from '../audio.js';
import { ui } from '../ui.js';

// HABILIDADES DE LOS HÉROES. Cada una es una lista de etapas PREPARACIÓN → EJECUCIÓN → RECUPERACIÓN.
// La lógica (objetivos, daño, estados) está aquí; lo visual sale de skills/vfx.js y los números de skills/config.js.
// La pose del cuerpo (inclinar, aplastar, girar, desaparecer) se superpone a la animación del modelo mediante player.pose.

import { Skill, DEG, ease, lerp, clamp, V, NEUTRAL, SKIP_TAGS, makeElastic, boneWorld } from './base.js';
import { POWER_CLASSES } from './powers.js';
import { POWER2_CLASSES } from './powers2.js';

/* ====================================================================== */
/*  JAGLION — Cola Elástica (extensión → agarre → balanceo → trepado)      */
/*  La cola real se recoge y sale una cola elástica de muchas articulaciones */
/*  desde el propio hueso de la cola.                                      */
/* ====================================================================== */
class TailSkill extends Skill {
  begin() {
    const d = this.def, p = this.p;
    this.target = this.combat.aimTarget(p.pos.x, p.pos.z, p.facing, d.coneDeg * DEG, d.range);
    if (this.target) this.mode = this.target.heavy ? 'hit' : 'pull';
    else {
      this.anchor = this.findAnchor();
      this.mode = this.anchor ? 'swing' : 'whiff';
    }
    if (this.mode === 'whiff') { this.cdFactor = d.whiffCdFactor; ui.banner('find', '🪢', 'No hay nada al alcance de la cola'); }
    this.rope = makeElastic(this, { n: d.segments || 30, r0: 0.13, r1: 0.05, color: 0xc8913e, rough: 0.85, tipR: 0.09 });
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
  // la cola sale del hueso de la cola (o de detrás del cuerpo en el modelo de reserva)
  origin() {
    const b = boneWorld(this, 'tail_1');
    if (b) return b;
    const f = this.fwd;
    return V(this.p.pos.x - f.x * this.p.R, this.p.pos.y + this.p.H * 0.45, this.p.pos.z - f.z * this.p.R);
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
    const st = [{ name: 'preparacion', dur: d.prep, enter: () => { if (this.target) this.face(this.target.pos.x, this.target.pos.z); }, tick: (dt, k) => {
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
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'preparacion', dur: d.prep, enter: () => { this.lock(true); this.makeEars(); audio.whoosh(); }, tick: (dt, k) => {
        pose.sy = 1 - 0.1 * k; pose.rx = 0.25 * k; // planta las patas y se inclina
        pose.rz = d.earShake * Math.sin(this.t * 30) * k;
        this.flap(this.t, 0.6 * k);
        if (Math.random() < 0.5) { const c = this.center(0.1); this.vfx.sand(c.x, c.y, c.z, 1); }
      } },
      { name: 'tormenta', dur: d.exec, enter: this.enterStorm, tick: this.tickStorm, exit: this.exitStorm },
      { name: 'recuperacion', dur: d.recover, tick: (dt, k) => { pose.sy = lerp(0.9, 1, k); pose.rx = lerp(0.25, 0, k); this.flap(this.t, 0.5 * (1 - k)); } },
    ];
  }
  enterStorm() {
    const d = this.def, p = this.p, f = this.fwd;
    this.dir = { x: f.x, z: f.z };
    this.pos = V(p.pos.x + f.x * 2, 0, p.pos.z + f.z * 2);
    const g = new THREE.Group();
    this.layers = [0.62, 0.45, 0.3].map((r, i) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(d.width * r * 1.25, d.width * r * 0.6, 3.6, 16, 1, true), new THREE.MeshBasicMaterial({ color: i === 1 ? 0xc89a58 : 0xe0bd7a, transparent: true, opacity: 0.3 - i * 0.05, depthWrite: false, side: THREE.DoubleSide }));
      m.userData.own = true;
      m.position.y = 1.8;
      g.add(m);
      return m;
    });
    this.stormGroup = g;
    this.prop(g);
    audio.noiseBurst(0.9, 500, 0.3, 'bandpass');
    this.shake(0.15);
  }
  tickStorm(dt, k) {
    const d = this.def, pose = this.pose;
    if (this._lock && this.t > d.rootT) this.lock(false);
    this.pos.x += this.dir.x * d.speed * dt; this.pos.z += this.dir.z * d.speed * dt;
    this.pos.y = this.gy(this.pos.x, this.pos.z);
    this.stormGroup.position.copy(this.pos);
    this.layers.forEach((m, i) => { m.rotation.y += dt * (9 - i * 2) * (i % 2 ? -1 : 1); });
    pose.sy = 0.9; pose.rx = 0.25; pose.rz = d.earShake * Math.sin(this.t * 30);
    this.flap(this.t + 1, 0.9);
    const r = d.width * 0.5;
    for (const t of this.combat.inCircle(this.pos.x, this.pos.z, r)) { // empuja, ciega y daña
      const { dx, dz } = this.awayFrom(t, this.pos.x, this.pos.z);
      this.shove(t, this.dir.x * 2 + dx * 0.2, this.dir.z * 2 + dz * 0.2, d.push, dt);
      this.combat.blind(t, d.blindT);
      this.dot(t, d.damage, dt);
    }
    this.combat.deflect(this.pos.x, this.pos.z, d.deflectRadius); // desvía proyectiles ligeros
    if (d.clearsObstacles) this.clearObstacles(this.pos.x, this.pos.z, r);
    this.sandT = (this.sandT || 0) - dt;
    if (this.sandT <= 0) { this.sandT = 0.06; this.vfx.sand(this.pos.x + rnd(-r, r), this.pos.y + 0.4, this.pos.z + rnd(-r, r), 2); }
    // la cola de la tormenta: el viento sigue arrastrando arena
    if (k > 0.8) this.stormGroup.scale.setScalar(lerp(1, 0.3, (k - 0.8) / 0.2));
  }
  clearObstacles(x, z, r) {
    const w = this.g.world;
    for (const o of [...w.obstacles]) {
      if (!o.alive || o.breakBy !== 'wind') continue;
      if (Math.hypot(o.x - x, o.z - z) < r + 1) w.breakObstacle(o);
    }
  }
  exitStorm() { this.vfx.sand(this.pos.x, this.pos.y + 0.5, this.pos.z, 6); }
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
  /* primavera: enredaderas que inmovilizan */
  enterSpring() {
    const s = this.s;
    this.vines = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + rnd(-0.3, 0.3), r = i === 0 ? 0 : rnd(0.4, 1) * s.radius;
      const v = makeTentacle(0x3fae4a);
      v.group.position.set(this.at.x + Math.cos(a) * r, this.gy(this.at.x + Math.cos(a) * r, this.at.z + Math.sin(a) * r) - 0.1, this.at.z + Math.sin(a) * r);
      v.group.rotation.set(rnd(-0.3, 0.3), rnd(0, TAU), rnd(-0.3, 0.3));
      v.group.scale.setScalar(0.55);
      this.prop(v.group);
      this.vines.push({ ...v, h: rnd(1.6, 2.6) });
    }
    this.zone = this.track(this.vfx.telegraph('disc', { x: this.at.x, z: this.at.z, r: s.radius, color: s.color, opacity: 0.3 }));
    this.zone.setProgress(1);
    this.vfx.petals(this.at.x, this.at.y + 0.5, this.at.z, 10);
    audio.whoosh();
    this.sfx('rumble');
    this.growGreens();
  }
  // árboles y montículos vegetales que brotan del suelo (y se vuelven a hundir al acabar)
  growGreens() {
    const s = this.s, trunkM = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.9 });
    const leafs = [0x4cb84a, 0x6ad050, 0x3a9a40].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, flatShading: true }));
    const flower = new THREE.MeshStandardMaterial({ color: 0xff9ad0, roughness: 0.6, emissive: 0x401020 });
    this.greens = [];
    const place = (r0, r1) => { const a = rnd(0, TAU), r = rnd(r0, r1); const x = this.at.x + Math.cos(a) * r, z = this.at.z + Math.sin(a) * r; return { x, z, y: this.gy(x, z) }; };
    for (let i = 0; i < (s.trees || 6); i++) {
      const q = place(0.6, s.radius * 0.95), g = new THREE.Group(), h = rnd(1.4, 2.4);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, h, 7), trunkM);
      trunk.position.y = h / 2; trunk.castShadow = true;
      g.add(trunk);
      for (let j = 0; j < 3; j++) { const f = new THREE.Mesh(new THREE.IcosahedronGeometry(rnd(0.45, 0.7), 0), leafs[j % 3]); f.position.set(rnd(-0.3, 0.3), h + rnd(-0.1, 0.4), rnd(-0.3, 0.3)); f.castShadow = true; g.add(f); }
      for (let j = 0; j < 4; j++) { const b = new THREE.Mesh(this.vfx.sphGeo, flower); b.scale.setScalar(0.08); b.position.set(rnd(-0.5, 0.5), h + rnd(0, 0.5), rnd(-0.5, 0.5)); g.add(b); }
      g.position.set(q.x, q.y, q.z);
      g.rotation.y = rnd(0, TAU);
      this.prop(g);
      this.greens.push({ g, delay: i * 0.07 + rnd(0, 0.1), tree: true });
    }
    for (let i = 0; i < (s.mounds || 4); i++) { // montañitas vegetales
      const q = place(0.5, s.radius * 0.8), m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2), leafs[i % 3]);
      m.scale.set(rnd(0.7, 1.1), 1, rnd(0.7, 1.1));
      m.position.set(q.x, q.y - 0.02, q.z);
      m.castShadow = true;
      this.prop(m);
      this.greens.push({ g: m, delay: rnd(0, 0.2), mound: rnd(0.5, 0.9) });
    }
    this.track({ kill: () => { trunkM.dispose(); leafs.forEach((m) => m.dispose()); flower.dispose(); for (const q of this.greens) q.g.traverse((o) => { if (o.geometry && o.geometry !== this.vfx.sphGeo) o.geometry.dispose(); }); } });
  }
  tickSpring(dt, k) {
    const s = this.s;
    for (const q of this.greens || []) { // brotan con un pequeño rebote y se hunden al final
      const lt = clamp((this.t - q.delay) / 0.45, 0, 1), grow = lt < 1 ? 1 - Math.pow(1 - lt, 3) * Math.cos(lt * 6) : 1, sink = k > 0.82 ? 1 - (k - 0.82) / 0.18 : 1;
      const v = Math.max(0.001, grow * sink);
      if (q.tree) q.g.scale.set(Math.max(0.001, 0.5 + 0.5 * v), v, Math.max(0.001, 0.5 + 0.5 * v));
      else q.g.scale.y = Math.max(0.001, q.mound * v);
      if (lt > 0 && lt < 0.2 && Math.random() < 0.3) this.vfx.dust(q.g.position.x, q.g.position.y + 0.1, q.g.position.z, 2, 1);
    }
    this.vines.forEach((v, i) => v.setHeight(v.h * ease(clamp(this.t * 3 - i * 0.08, 0, 1)) * (k > 0.85 ? (1 - k) / 0.15 : 1)));
    for (const t of this.combat.inCircle(this.at.x, this.at.z, s.radius)) { this.combat.root(t, 0.4); this.dot(t, s.damage, dt); }
    if (Math.random() < 0.25) this.vfx.petals(this.at.x, this.at.y + 0.5, this.at.z, 2);
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

// RUEDA DE LAS ESTACIONES: las cuatro colas giran y combinan los cuatro efectos en un ataque circular
class WheelSkill extends Skill {
  begin() { this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose, seasons = HERO_SKILLS.kyra.skill.seasons, order = HERO_SKILLS.kyra.skill.wheelOrder;
    return [
      { name: 'preparacion', dur: d.prep, enter: this.enterGather, tick: (dt, k) => { pose.rx = -0.2 * k; this.orbit(0.4 + (1 - k) * 2.6, this.t * 3, 0.3 + 0.7 * k); } },
      { name: 'rueda', dur: d.exec, enter: () => { this.tickT = 0; this.shake(0.3); audio.power('ice'); }, tick: (dt, k) => {
        pose.spin = this.t * d.spinSpeed; pose.rx = 0.12; pose.sy = 1.04;
        this.orbit(2.2, this.t * d.spinSpeed * 0.9, 1);
        this.tickT -= dt;
        if (this.tickT <= 0) { this.tickT = d.tick; this.pulse(order, seasons); }
        for (const t of this.combat.inCircle(this.p.pos.x, this.p.pos.z, d.radius)) this.combat.root(t, 0.2); // la rueda sujeta mientras gira
      }, exit: () => { this.vfx.ring(this.p.pos.x, null, this.p.pos.z, { r0: 1, r1: d.radius * 1.2, dur: 0.5, color: 0xffffff }); } },
      { name: 'recuperacion', dur: d.recover, tick: (dt, k) => { pose.spin = 0; pose.rx = lerp(0.12, 0, k); this.orbit(2.2 * (1 - k), this.t * 4, 1 - k); } },
    ];
  }
  enterGather() {
    const order = HERO_SKILLS.kyra.skill.wheelOrder, seasons = HERO_SKILLS.kyra.skill.seasons;
    this.orbs = order.map((key) => {
      const m = new THREE.Mesh(this.vfx.sphGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(seasons[key].color).multiplyScalar(1.6), transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.userData.own = true;
      m.scale.setScalar(0.28);
      this.prop(m);
      return m;
    });
    audio.whoosh();
  }
  orbit(r, a0, k) {
    const c = this.center(0.5);
    this.orbs.forEach((m, i) => {
      const a = a0 + (i / this.orbs.length) * TAU;
      m.position.set(c.x + Math.cos(a) * r, c.y + Math.sin(a * 2) * 0.15, c.z + Math.sin(a) * r);
      m.scale.setScalar(0.3 * k + 0.05);
      if (Math.random() < 0.7) this.vfx.orb(m.position, { r: 0.22, color: m.material.color.getHex(), life: 0.3 });
    });
  }
  // pulso: los cuatro efectos a la vez
  pulse(order, seasons) {
    const d = this.def, c = this.p.pos;
    this.vfx.ring(c.x, null, c.z, { r0: 1, r1: d.radius, dur: 0.5, color: seasons[order[Math.floor(this.t / d.tick) % 4]].color });
    this.vfx.petals(c.x, c.y + 0.5, c.z, 3);
    this.vfx.fire(c.x, c.y + 0.3, c.z, 2, 1);
    this.vfx.leaves(c.x, c.y + 1, c.z, undefined, 3);
    this.vfx.ice(c.x, c.y + 0.6, c.z, 2);
    for (const t of this.combat.inCircle(c.x, c.z, d.radius)) {
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
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'preparacion', dur: d.prep, enter: () => { this.lock(true); audio.whoosh(); }, tick: (dt, k) => { pose.sy = 1 - 0.1 * k; pose.rx = -0.3 * k; } },
      { name: 'ascenso', dur: d.charge, enter: this.enterAscend, tick: this.tickAscend },
      { name: 'picado', dur: 1, enter: this.enterDive, tick: this.tickDive },
      { name: 'impacto', dur: 0.35, enter: this.enterImpact, tick: (dt, k) => { pose.sy = lerp(0.8, 1, k); pose.rx = lerp(0.3, 0, k); } },
      { name: 'recuperacion', dur: d.recover, tick: (dt, k) => { pose.sy = 1; } },
    ];
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
  enterDive() {
    this.p.facing = Math.atan2(this.land.x - this.p.pos.x, this.land.z - this.p.pos.z);
    this.diveFrom = this.p.pos.clone();
    this.stages[this.i].dur = Math.max(0.12, this.diveFrom.distanceTo(this.land) / this.def.diveSpeed);
    this.mark.setProgress(1);
    audio.noiseBurst(0.3, 800, 0.4, 'bandpass');
  }
  tickDive(dt, k) {
    const p = this.p;
    p.pos.lerpVectors(this.diveFrom, this.land, k * k * (1.4 - 0.4 * k));
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
      const s = this.findSurface();
      if (s) { this.dest = s; this.mode = 'propel'; } else this.mode = 'whiff';
    }
    if (this.mode === 'whiff') { this.cdFactor = 0.45; ui.banner('find', '👅', 'No hay nada al alcance de la lengua'); }
    this.tongue = makeElastic(this, { n: d.segments || 32, r0: 0.1, r1: 0.065, color: 0xff5a7c, rough: 0.22, emissive: 0x3a0010, tipR: 0.15 });
    this.start();
    return true;
  }
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
  // boca: punta del hueso de la cabeza (o delante del cuerpo en el modelo de reserva)
  mouth() {
    const f = this.fwd, b = boneWorld(this, 'head_end');
    if (b) return b.add(V(f.x * 0.12, -0.05, f.z * 0.12));
    return V(this.p.pos.x + f.x * this.p.R * 0.9, this.p.pos.y + this.p.H * 0.55, this.p.pos.z + f.z * this.p.R * 0.9);
  }
  build() {
    const d = this.def, pose = this.pose, ov = d.overshoot || 0.12, wob = d.wobble || 0.45;
    const st = [
      { name: 'preparacion', dur: d.prep, tick: (dt, k) => { pose.rx = -0.18 * k; pose.sy = 1 - 0.05 * k; } },
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
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'desvanecer', dur: d.vanishT, enter: () => {
        this.lock(true);
        const c = this.from;
        this.vfx.splash(c.x, c.y + 0.3, c.z, 18, 1.1);
        this.vfx.ring(c.x, null, c.z, { r0: 0.3, r1: 2.6, dur: 0.5, color: 0x8ae0ff });
        audio.splash();
      }, tick: (dt, k) => { pose.sy = lerp(1, 0.15, ease(k)); pose.spin = k * TAU; pose.hidden = k > 0.65; } },
      { name: 'aparecer', dur: d.appearT, enter: this.enterAppear, tick: (dt, k) => { pose.hidden = false; pose.sy = k < 0.55 ? lerp(0.15, 1.15, k / 0.55) : lerp(1.15, 1, (k - 0.55) / 0.45); pose.spin = (1 - k) * -TAU * 0.5; } },
      { name: 'recuperacion', dur: d.recover, tick: () => { pose.hidden = false; } },
    ];
  }
  enterAppear() {
    const d = this.def, p = this.p, to = this.dest;
    p.pos.copy(to);
    p.vx = this.dir.x * 6; p.vz = this.dir.z * 6; p.vy = 0;
    this.lock(false);
    this.vfx.splash(to.x, to.y + 0.3, to.z, 20, 1.3);
    this.vfx.ring(to.x, null, to.z, { r0: 0.3, r1: 3, dur: 0.55, color: 0x8ae0ff });
    this.makeTrail(this.from, to);
  }
  // estela de agua: salpicaduras y ondas; empuja y ralentiza a los enemigos que la cruzan
  makeTrail(a, b) {
    const d = this.def, dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1, ux = dx / len, uz = dz / len;
    this.vfx.strip(a, b, { width: d.trailWidth, color: 0x5ac8ff, opacity: 0.5, life: d.trailTime });
    for (let r = 0.5; r < len; r += 1.6) {
      const x = a.x + ux * r, z = a.z + uz * r;
      this.vfx.ring(x, null, z, { r0: 0.2, r1: d.trailWidth * 0.9, dur: 0.9, color: 0xbfeaff, opacity: 0.5 });
      this.vfx.splash(x, this.gy(x, z) + 0.2, z, 3, 0.5);
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

const SKILLS = { tail: TailSkill, haboob: HaboobSkill, seasons: SeasonsSkill, wheel: WheelSkill, dive: DiveSkill, tongue: TongueSkill, blink: BlinkSkill, ...POWER_CLASSES, ...POWER2_CLASSES };

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

  reset() {
    if (this.cur) { this.cur.dispose(); this.cur = null; }
    for (const b of this.bg) b.dispose();
    this.bg.length = 0;
    this.seasonIdx = 0;
    if (this.g.vfx2) this.g.vfx2.clear();
    const p = this.g.player;
    Object.assign(p.pose, NEUTRAL);
    p.fly = null; p.moveMul = 1; p.speedBuff = 1;
    if (p.model) p.model.boneFx = null;
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
    } else if (this.cur) { ui.banner('find', def.icon, 'Termina primero la habilidad en curso'); return false; }
    const sk = new Cls(this, def);
    sk.key = key;
    if (!sk.begin()) { sk.dispose(); return false; }
    if (Cls.background) this.bg.push(sk); else this.cur = sk;
    return { cdFactor: sk.cdFactor };
  }

  update(dt) {
    const p = this.g.player;
    Object.assign(p.pose, NEUTRAL);
    const c = this.g.combat;
    for (let i = this.bg.length - 1; i >= 0; i--) { const b = this.bg[i]; c.src = b; const done = b.update(dt); c.src = null; if (done) { b.dispose(); this.bg.splice(i, 1); } }
    if (this.cur) { c.src = this.cur; const done = this.cur.update(dt); c.src = null; if (done) { this.cur.dispose(); this.cur = null; } }
  }
}
