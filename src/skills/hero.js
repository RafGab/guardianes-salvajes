import * as THREE from 'three';
import { Staged, rnd, TAU } from './attack.js';
import { HERO_SKILLS } from './config.js';
import { makeTentacle } from './props.js';
import { terrainH } from '../terrain.js';
import { Audio3D as audio } from '../audio.js';
import { ui } from '../ui.js';

// HABILIDADES DE LOS HÉROES. Cada una es una lista de etapas PREPARACIÓN → EJECUCIÓN → RECUPERACIÓN.
// La lógica (objetivos, daño, estados) está aquí; lo visual sale de skills/vfx.js y los números de skills/config.js.
// La pose del cuerpo (inclinar, aplastar, girar, desaparecer) se superpone a la animación del modelo mediante player.pose.

const DEG = Math.PI / 180;
const ease = (k) => k * k * (3 - 2 * k);
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const NEUTRAL = { rx: 0, rz: 0, sy: 1, dy: 0, spin: 0, hidden: false };
const SKIP_TAGS = new Set(['tree', 'rail', 'fence', 'obstacle']);

/* ====================================================================== */
/*  Base                                                                   */
/* ====================================================================== */
class Skill extends Staged {
  constructor(hs, def) {
    super(hs.g.vfx, hs.g.combat);
    this.hs = hs;
    this.g = hs.g;
    this.p = hs.g.player;
    this.def = def;
    this.pose = this.p.pose;
    this.cdFactor = 1;
    this._lock = false;
    this._script = false;
  }
  // Intenta empezar. Devuelve false si no se puede (no se gasta recarga).
  begin() { return false; }

  get fwd() { return { x: Math.sin(this.p.facing), z: Math.cos(this.p.facing) }; }
  center(h = 0.5) { return V(this.p.pos.x, this.p.pos.y + this.p.H * h, this.p.pos.z); }
  gy(x, z) { return terrainH(x, z); }
  face(x, z) { this.p.facing = Math.atan2(x - this.p.pos.x, z - this.p.pos.z); }
  lock(on) {
    if (on && !this.p.locked) { this.p.locked = true; this._lock = true; }
    else if (!on && this._lock) { this.p.locked = false; this._lock = false; }
  }
  script(on) {
    this.p.scripted = on;
    this._script = on;
    if (on) { this.p.vx = this.p.vz = this.p.vy = 0; this.p.grounded = false; this.p.support = null; }
  }
  // Suelta al héroe del movimiento guiado con una velocidad de salida
  release(vx = 0, vy = 0, vz = 0) {
    this.script(false);
    this.p.vx = vx; this.p.vy = vy; this.p.vz = vz;
  }
  shake(n) { this.g.chase.shake(n); }
  hit(t, dmg) { this.combat.damage(t, dmg); }
  // daño continuo: solo a los pesados, para no matar de golpe a los esbirros
  dot(t, perSec, dt) { if (t.heavy) this.combat.damage(t, perSec * dt, { quiet: true }); }
  awayFrom(t, x, z) { return { dx: t.pos.x - x, dz: t.pos.z - z }; }
  // empuje continuo equivalente a `speed` m/s (la velocidad del esbirro decae 4/s)
  shove(t, dx, dz, speed, dt) { this.combat.push(t, dx, dz, speed * dt * 4); }

  dispose() {
    this.killHandles();
    this.cleanup();
    this.lock(false);
    if (this._script) this.p.scripted = false;
  }
}

/* ====================================================================== */
/*  JAGLION — Cola Elástica                                                */
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
    this.rope = this.track(this.vfx.rope({ radius: 0.08, color: 0xe8a040 }));
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
  origin() { return this.center(0.55); }
  hookPoint() {
    const p = this.p, d = this.def;
    if (this.mode === 'swing') return this.anchor;
    if (this.target) return V(this.target.pos.x, this.target.pos.y + (this.target.heavy ? this.target.S.height * 0.45 : 0.6), this.target.pos.z);
    const f = this.fwd;
    return V(p.pos.x + f.x * d.range * 0.7, p.pos.y + p.H * 0.5, p.pos.z + f.z * d.range * 0.7);
  }
  build() {
    const d = this.def, p = this.p, pose = this.pose;
    const st = [{ name: 'preparacion', dur: d.prep, enter: () => { if (this.target) this.face(this.target.pos.x, this.target.pos.z); }, tick: (dt, k) => { pose.rx = -0.25 * k; pose.sy = 1 - 0.06 * k; } }];
    const dist = this.origin().distanceTo(this.hookPoint());
    st.push({ name: 'lanzamiento', dur: Math.max(0.08, dist / d.hookSpeed), enter: () => { audio.whoosh(); }, tick: (dt, k) => {
      const o = this.origin(), h = this.hookPoint();
      this.rope.set(o, o.clone().lerp(h, k));
      pose.rx = lerp(-0.25, 0.3, k);
      pose.sy = 1 + 0.12 * k; // la cola se estira
    } });
    if (this.mode === 'swing') {
      const flight = this.p.pos.distanceTo(this.anchor);
      st.push({ name: 'balanceo', dur: flight / d.swingSpeed, enter: this.enterSwing, tick: this.tickSwing, exit: this.exitSwing });
      st.push({ name: 'estela', dur: d.trailTime, tick: (dt, k) => { this.trail(1 - k); pose.sy = lerp(1.1, 1, k); pose.rx = lerp(0.3, 0, k); } });
    } else if (this.mode === 'pull') {
      st.push({ name: 'atraer', dur: Math.min(0.9, dist / d.pullSpeed + 0.2), tick: this.tickPull, exit: this.exitPull });
    } else if (this.mode === 'hit') {
      st.push({ name: 'golpe', dur: 0.3, enter: this.enterHit, tick: (dt, k) => { this.rope.set(this.origin(), this.hookPoint()); pose.rx = lerp(0.5, 0, k); } });
    } else {
      st.push({ name: 'recoger', dur: Math.max(0.08, dist / d.hookSpeed), tick: (dt, k) => { const o = this.origin(), h = this.hookPoint(); this.rope.set(o, h.clone().lerp(o, k)); pose.sy = lerp(1.1, 1, k); } });
    }
    st.push({ name: 'recuperacion', dur: d.recover, tick: (dt, k) => { this.rope.kill(); pose.rx = lerp(pose.rx, 0, k); pose.sy = lerp(pose.sy, 1, k); } });
    return st;
  }
  // balanceo hacia el anclaje: arco suave, cola tensa y estela de velocidad
  enterSwing() {
    this.from = this.p.pos.clone();
    this.script(true);
    this.face(this.anchor.x, this.anchor.z);
  }
  tickSwing(dt, k) {
    const d = this.def, p = this.p, e = ease(k), dist = this.from.distanceTo(this.anchor);
    p.pos.lerpVectors(this.from, this.anchor, e);
    p.pos.y += Math.sin(k * Math.PI) * d.arc * dist;
    this.rope.set(this.origin(), this.anchor);
    this.pose.rx = 0.5; this.pose.sy = 1.12;
    this.trail(1);
  }
  exitSwing() {
    const d = this.def, f = this.fwd;
    this.p.pos.copy(this.anchor);
    this.release(f.x * d.releaseBoost, d.releaseUp, f.z * d.releaseBoost);
    this.rope.kill();
    this.vfx.ring(this.anchor.x, this.anchor.y, this.anchor.z, { r0: 0.4, r1: 2.4, dur: 0.4, color: 0xffd080 });
  }
  trail(k) {
    const c = this.center(0.5);
    this.vfx.orb(c, { r: 0.28 * k + 0.1, color: 0xffd080, life: 0.3 });
    if (Math.random() < 0.6) this.vfx.sparks(c.x, c.y, c.z, 0xffe0a0, 1, 2);
  }
  // enemigos ligeros: la cola los trae hasta el héroe y los golpea
  tickPull(dt) {
    const t = this.target, p = this.p, f = this.fwd;
    if (t.dead) { this.endStage(); return; }
    this.rope.set(this.origin(), V(t.pos.x, t.pos.y + 0.6, t.pos.z));
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
    this.shake(0.28); audio.noiseBurst(0.25, 300, 0.3, 'lowpass');
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
  }
  tickSpring(dt, k) {
    const s = this.s;
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
    const d = this.def, pose = this.pose, seasons = HERO_SKILLS.kyra.skill.seasons, order = HERO_SKILLS.kyra.skill.order;
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
    const order = HERO_SKILLS.kyra.skill.order, seasons = HERO_SKILLS.kyra.skill.seasons;
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
    this.tongue = this.track(this.vfx.rope({ radius: 0.09, color: 0xff6a8a }));
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
  mouth() { const f = this.fwd; return V(this.p.pos.x + f.x * this.p.R * 0.9, this.p.pos.y + this.p.H * 0.55, this.p.pos.z + f.z * this.p.R * 0.9); }
  build() {
    const d = this.def, pose = this.pose;
    const st = [
      { name: 'preparacion', dur: d.prep, tick: (dt, k) => { pose.rx = -0.18 * k; pose.sy = 1 - 0.05 * k; } },
      { name: 'disparo', dur: d.shootT, enter: () => { audio.whoosh(); }, tick: (dt, k) => { const m = this.mouth(), t = this.tip(); this.tongue.set(m, m.clone().lerp(t, ease(k))); pose.rx = lerp(-0.18, 0.2, k); } },
    ];
    if (this.mode === 'pull') st.push({ name: 'atraer', dur: Math.min(0.9, d.retractT + this.p.pos.distanceTo(this.target.pos) / d.pullSpeed), tick: this.tickPull });
    else if (this.mode === 'propel') {
      const away = this.dest.distanceTo(this.p.pos);
      st.push({ name: 'impulso', dur: Math.max(0.1, away / d.propelSpeed), enter: this.enterPropel, tick: this.tickPropel, exit: this.exitPropel });
    } else st.push({ name: 'recoger', dur: d.retractT, tick: (dt, k) => { const m = this.mouth(), t = this.tip(); this.tongue.set(m, t.clone().lerp(m, ease(k))); } });
    if (this.mode !== 'whiff') st.push({ name: 'giro-de-cola', dur: d.spinT, enter: () => { this.spun = false; this.tongue.kill(); }, tick: this.tickSpin });
    st.push({ name: 'recuperacion', dur: d.recover, tick: (dt, k) => { this.tongue.kill(); pose.spin = 0; pose.rx = lerp(pose.rx, 0, k); pose.sy = lerp(pose.sy, 1, k); } });
    return st;
  }
  tickPull(dt) {
    const t = this.target, p = this.p, f = this.fwd;
    if (t.dead) { this.endStage(); return; }
    const m = this.mouth();
    this.tongue.set(m, V(t.pos.x, t.pos.y + 0.6, t.pos.z));
    const to = V(p.pos.x + f.x * (p.R + t.radius + 0.4), p.pos.y, p.pos.z + f.z * (p.R + t.radius + 0.4));
    this.combat.pull(t, to, this.def.pullSpeed, 0.2);
    if (Math.hypot(t.pos.x - to.x, t.pos.z - to.z) < 0.6) this.endStage();
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
    this.tongue.set(this.mouth(), this.tip());
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

/* ====================================================================== */
/*  LINCE — Mirada del Eclipse (ojo solar / lunar) y Eclipse Total         */
/* ====================================================================== */
class EclipseSkill extends Skill {
  begin() {
    const hs = this.hs;
    this.mode = hs.liraMode;
    hs.liraMode = this.mode === 'solar' ? 'lunar' : 'solar'; // se alternan
    this.start();
    return true;
  }
  build() {
    const d = this.def, pose = this.pose, spec = d[this.mode];
    return [
      { name: 'preparacion', dur: d.prep, tick: (dt, k) => { // el ojo se enciende
        pose.rx = -0.22 * k;
        const h = V(this.p.pos.x, this.p.pos.y + this.p.H * 1.05, this.p.pos.z);
        this.vfx.orb(h, { r: 0.1 + 0.4 * k, color: spec.color, life: 0.18, grow: 1 });
      }, exit: () => this.hs.setBuff({ mode: this.mode, t: spec.duration, spec }) },
      { name: 'recuperacion', dur: d.recover, tick: (dt, k) => { pose.rx = lerp(-0.22, 0, k); } },
    ];
  }
}

class TotalSkill extends Skill {
  begin() { this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose, sk = HERO_SKILLS.lira.skill;
    return [
      { name: 'preparacion', dur: d.prep, tick: (dt, k) => {
        pose.rx = -0.3 * k; pose.sy = 1 + 0.06 * k;
        const h = V(this.p.pos.x, this.p.pos.y + this.p.H * 1.05, this.p.pos.z);
        this.vfx.orb(V(h.x - 0.18, h.y, h.z), { r: 0.1 + 0.4 * k, color: sk.solar.color, life: 0.18, grow: 1 });
        this.vfx.orb(V(h.x + 0.18, h.y, h.z), { r: 0.1 + 0.4 * k, color: sk.lunar.color, life: 0.18, grow: 1 });
      } },
      { name: 'eclipse', dur: d.exec, enter: this.enterTotal, tick: this.tickTotal },
      { name: 'recuperacion', dur: d.recover, tick: (dt, k) => { pose.rx = lerp(-0.3, 0, k); } },
    ];
  }
  enterTotal() {
    const d = this.def, p = this.p, cam = this.g.camera;
    this.hs.setBuff({ mode: 'both', t: d.exec, spec: d });
    this.zoneA = this.track(this.vfx.telegraph('disc', { x: p.pos.x, z: p.pos.z, r: d.radius, color: 0xffd24a, opacity: 0.3 }));
    this.zoneB = this.track(this.vfx.telegraph('disc', { x: p.pos.x, z: p.pos.z, r: d.radius * 0.8, color: 0x8a9aff, opacity: 0.3 }));
    this.zoneA.setProgress(1); this.zoneB.setProgress(1);
    const away = V(p.pos.x - cam.position.x, 0, p.pos.z - cam.position.z).normalize();
    this.vfx.eclipse(cam, V(p.pos.x + away.x * 7, p.pos.y + p.H + 8, p.pos.z + away.z * 7), { r: 3.4, life: d.exec, color: 0xffc24a }); // el eclipse se ve detrás
    this.tickT = 0;
    this.shake(0.25); audio.power('ice');
  }
  tickTotal(dt) {
    const d = this.def, p = this.p;
    this.pose.rx = -0.25; this.pose.sy = 1.04;
    this.zoneA.set(p.pos.x, p.pos.z);
    this.zoneB.set(p.pos.x, p.pos.z);
    this.tickT -= dt;
    if (this.tickT <= 0) {
      this.tickT = d.tick;
      this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 1, r1: d.radius, dur: 0.6, color: Math.random() < 0.5 ? 0xffd24a : 0x8a9aff });
      for (const t of this.combat.inCircle(p.pos.x, p.pos.z, d.radius)) { // combina los dos ojos: ralentiza, marca y daña
        this.combat.slow(t, d.slowF, 1.0);
        this.combat.mark(t, 1.2);
        this.hit(t, d.damage);
      }
    }
    const a = this.t * 1.5;
    this.vfx.orb(V(p.pos.x + Math.cos(a) * 1.3, p.pos.y + p.H * 0.9, p.pos.z + Math.sin(a) * 1.3), { r: 0.25, color: 0xffd24a, life: 0.3 });
    this.vfx.orb(V(p.pos.x - Math.cos(a) * 1.3, p.pos.y + p.H * 0.9, p.pos.z - Math.sin(a) * 1.3), { r: 0.25, color: 0x8a9aff, life: 0.3 });
  }
}

const SKILLS = { tail: TailSkill, haboob: HaboobSkill, seasons: SeasonsSkill, wheel: WheelSkill, dive: DiveSkill, tongue: TongueSkill, blink: BlinkSkill, eclipse: EclipseSkill, total: TotalSkill };

/* ====================================================================== */
/*  Gestor: una habilidad activa a la vez + efectos persistentes del Lince */
/* ====================================================================== */
export class HeroSkills {
  constructor(game) {
    this.g = game;
    this.cur = null;
    this.buff = null;
    this.seasonIdx = 0;
    this.liraMode = 'solar';
  }

  // Habilidades del héroe para la barra: [{ id, key, icon, name, cd }]
  entries(heroId) {
    const set = HERO_SKILLS[heroId];
    if (!set) return [];
    return Object.entries(set).map(([key, def]) => ({ id: `hs:${key}`, key, icon: def.icon, name: def.name, cd: def.cd, hs: true }));
  }
  get busy() { return !!this.cur; }

  reset() {
    if (this.cur) { this.cur.dispose(); this.cur = null; }
    this.endBuff();
    this.seasonIdx = 0;
    this.liraMode = 'solar';
    Object.assign(this.g.player.pose, NEUTRAL);
  }

  // Devuelve false (no se pudo usar) o { cdFactor }
  use(key) {
    const g = this.g, hero = g.hero && g.hero.id, def = HERO_SKILLS[hero] && HERO_SKILLS[hero][key];
    if (!def) return false;
    if (this.cur) { ui.banner('find', def.icon, 'Termina primero la habilidad en curso'); return false; }
    const Cls = SKILLS[def.id];
    const sk = new Cls(this, def);
    if (!sk.begin()) { sk.dispose(); return false; }
    this.cur = sk;
    return { cdFactor: sk.cdFactor };
  }

  update(dt) {
    const p = this.g.player;
    Object.assign(p.pose, NEUTRAL);
    if (this.cur && this.cur.update(dt)) { this.cur.dispose(); this.cur = null; }
    this.updateBuff(dt);
  }

  /* ----- Lince: ojo solar / ojo lunar / ambos (eclipse total) ----- */
  setBuff(b) {
    this.endBuff();
    this.buff = { ...b, tick: 0, evade: 0, ring: 0 };
    const c = this.g.combat, p = this.g.player, s = b.spec;
    if (b.mode === 'solar') c.damageMul = s.damageMul;
    else if (b.mode === 'lunar') p.speedBuff = s.speedMul;
    else { c.damageMul = s.markMul; p.speedBuff = s.speedMul; }
    audio.found();
  }
  endBuff() {
    if (!this.buff) return;
    this.g.combat.damageMul = 1;
    this.g.player.speedBuff = 1;
    this.buff = null;
  }
  updateBuff(dt) {
    const b = this.buff;
    if (!b) return;
    const g = this.g, c = g.combat, p = g.player, s = b.spec, vfx = g.vfx;
    b.t -= dt;
    if (b.t <= 0) { this.endBuff(); return; }
    const solar = b.mode === 'solar' || b.mode === 'both', lunar = b.mode === 'lunar' || b.mode === 'both';
    const head = V(p.pos.x, p.pos.y + p.H * 1.1 + 0.15 * Math.sin(b.t * 5), p.pos.z);
    if (solar) vfx.orb(V(head.x + (lunar ? -0.16 : 0), head.y, head.z), { r: 0.17, color: 0xffd24a, life: 0.12 });
    if (lunar) vfx.orb(V(head.x + (solar ? 0.16 : 0), head.y, head.z), { r: 0.17, color: 0x8a9aff, life: 0.12 });
    b.tick -= dt;
    b.ring -= dt;
    if (b.tick <= 0) {
      b.tick = 0.35;
      if (solar && b.mode === 'solar') for (const t of c.targets()) if (Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) < s.markRange) c.mark(t, 0.9); // marca a los enemigos
      if (lunar && b.mode === 'lunar') for (const t of c.targets()) if (Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) < s.range) c.slow(t, s.slowF, 0.7); // los enfría
    }
    if (b.ring <= 0) {
      b.ring = 0.6;
      if (b.mode === 'solar') for (const t of c.targets()) if (t.st.mark > 0) vfx.ring(t.pos.x, null, t.pos.z, { r0: t.radius * 0.8, r1: t.radius * 1.4 + 0.5, dur: 0.5, color: 0xffd24a, opacity: 0.6 });
    }
    if (b.mode === 'lunar') { // esquiva automática cada cierto tiempo
      b.evade -= dt;
      if (b.evade <= 0) {
        b.evade = s.evadeEvery;
        p.evadeT = 0.7;
        vfx.ring(p.pos.x, p.pos.y + 0.6, p.pos.z, { r0: 0.3, r1: 2, dur: 0.5, color: 0x8a9aff });
        vfx.sparks(p.pos.x, p.pos.y + p.H * 0.6, p.pos.z, 0x8a9aff, 8, 2.4);
      }
    }
  }
}
