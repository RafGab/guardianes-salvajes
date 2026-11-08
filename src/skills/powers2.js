import * as THREE from 'three';
import { rnd, TAU } from './attack.js';
import { Skill, DEG, ease, lerp, clamp, V, boneWorld } from './base.js';
import { glowMat } from './vfx2.js';
import { terrainH } from '../terrain.js';
import { ui } from '../ui.js';

// ACTUALIZACIÓN DE BOTONES: animaciones de VELOCIDAD (botón 1), ARMAS (7), Tornados y Garras de Ámbar, Visión de Lira.
// Números en skills/config.js (HERO_SKILLS / HERO_BUTTONS).

const back = (k) => 1 - Math.pow(1 - k, 3);

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
  // NILO — Botas propulsoras: chorros de agua hacia abajo, pequeños saltos, burbujas y espuma
  nilo(dt, k, bx, bz, sp) {
    const pose = this.pose, p = this.p, fx = this.g.fx;
    pose.dy = Math.abs(Math.sin(this.t * 6.5)) * 0.35 * k; pose.rx = Math.max(pose.rx, 0.25 * k);
    const y = p.pos.y + pose.dy;
    for (let i = 0; i < 3; i++) fx.spray(p.pos.x + rnd(-0.15, 0.15), y + 0.15, p.pos.z + rnd(-0.15, 0.15), bx * 2 + rnd(-0.5, 0.5), -5 - 3 * k, bz * 2 + rnd(-0.5, 0.5), 1.1);
    if (pose.dy < 0.05 && sp > 2) { fx.splash(p.pos.x, p.pos.y + 0.1, p.pos.z, 3, 0.5); }
    if (Math.random() < 0.7) { const f = this.feet(0.8, bx, bz); fx.sparkle(f.x + rnd(-0.4, 0.4), f.y + rnd(0.1, 0.6), f.z + rnd(-0.4, 0.4), 0xbfeaff, 0.5); } // burbujas
    if (Math.random() < 0.4) { const f = this.feet(0.5, bx, bz); fx.mist(f.x, f.y + 0.1, f.z, 0xffffff, 0.6); } // espuma
  }
  // KYRA — Deslizamiento sobre hielo: pista de hielo bajo los pies, curvas inclinadas y nieve en polvo
  kyra(dt, k, bx, bz, sp, step, turn) {
    const pose = this.pose, p = this.p, fx = this.g.fx;
    pose.rx = Math.max(pose.rx, 0.22 * k);
    this.carve = lerp(this.carve || 0, clamp(-turn * 18, -0.45, 0.45) * k, Math.min(1, dt * 8));
    pose.rz = this.carve; // se inclina en las curvas como una esquiadora
    this.trailT -= dt;
    if (this.trailT <= 0 && sp > 1.5) {
      this.trailT = 0.1;
      const a = this.last.clone();
      this.vfx.strip(V(a.x, p.floorY(a.x, a.z, p.pos.y + 0.5), a.z), V(p.pos.x, p.pos.y, p.pos.z), { width: 0.9, color: 0xcff4ff, opacity: 0.6, life: 1.6 });
      this.last.copy(p.pos);
    }
    for (let i = 0; i < 2; i++) { const s = (i ? 1 : -1) * 0.5, f = this.feet(0.3, bx, bz); fx.mist(f.x - bz * s, f.y + 0.1, f.z + bx * s, 0xffffff, 0.5 + 0.5 * k); }
    if (Math.random() < 0.6) { const f = this.feet(0.4, bx, bz); fx.iceShard(f.x, f.y + 0.2, f.z, 0.5); }
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
  // tajo en arco: media luna brillante delante del héroe (katana, hacha, garras)
  crescent(y, { r = 3, arc = 120, color = 0xffffff, life = 0.25, tilt = 0, width = 0.35, vertical = false } = {}) {
    const p = this.p, f = this.fwd;
    const geo = new THREE.RingGeometry(r * (1 - width), r, 32, 1, -arc * DEG / 2, arc * DEG);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat);
    m.userData.own = true;
    const g = new THREE.Group();
    g.add(m);
    g.position.set(p.pos.x, y, p.pos.z);
    if (vertical) { m.rotation.y = Math.PI / 2; g.rotation.y = p.facing; m.rotation.z = Math.PI / 2 + tilt; }
    else { m.rotation.x = -Math.PI / 2 + tilt; g.rotation.y = p.facing - Math.PI / 2; m.rotation.z = Math.PI / 2; }
    void f;
    return this.vfx.add(g, life, (it) => { const k = it.t / life; mat.opacity = 0.9 * (1 - k); m.scale.setScalar(0.85 + 0.25 * k); if (it.t >= life - 0.001) geo.dispose(); });
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
}

// JAGLION — KATANA
export class KatanaSkill extends WeaponSkill {
  begin() { this.aim(this.def.range + 2); this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'guardia', dur: d.prep, enter: () => { this.p.powerAnim = 1; }, tick: (dt, k) => { pose.spin = -0.6 * k; pose.rx = 0.1 * k; } },
      { name: 'tajo', dur: d.swing, enter: () => {
        this.sfx('snap');
        this.crescent(this.p.pos.y + this.p.H * 0.55, { r: d.range, arc: d.arcDeg, color: d.color, tilt: 0.15 });
        this.crescent(this.p.pos.y + this.p.H * 0.5, { r: d.range * 0.8, arc: d.arcDeg * 0.8, color: 0xffffff, tilt: 0.1, width: 0.15 });
        const n = this.hitArc(d.range, d.arcDeg, d.damage, d.force, (t) => this.vfx.sparks(t.pos.x, t.pos.y + 0.8, t.pos.z, 0xe0f0ff, 8, 2.6));
        if (n) this.shake(0.15);
      }, tick: (dt, k) => { pose.spin = lerp(-0.6, 1.1, back(k)); pose.rx = 0.18; } },
      { name: 'recuperacion', dur: d.recover, tick: (dt, k) => { pose.spin = lerp(1.1, 0, ease(k)); pose.rx = lerp(0.18, 0, k); } },
    ];
  }
}
// KAIRO — MARTILLO
export class HammerSkill extends WeaponSkill {
  begin() { this.aim(this.def.range + this.def.radius); this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'alzar', dur: d.prep, enter: () => { this.p.powerAnim = 1; this.lock(true); }, tick: (dt, k) => { pose.rx = -0.45 * ease(k); pose.dy = 0.45 * Math.sin(k * Math.PI * 0.5); pose.sy = 1 + 0.06 * k; } },
      { name: 'martillazo', dur: d.slam, tick: (dt, k) => { pose.rx = lerp(-0.45, 0.55, back(k)); pose.dy = lerp(0.45, 0, k); }, exit: this.impact },
      { name: 'recuperacion', dur: d.recover, enter: () => this.lock(false), tick: (dt, k) => { pose.rx = lerp(0.55, 0, ease(k)); pose.sy = lerp(0.92, 1, k); } },
    ];
  }
  impact() {
    const d = this.def, p = this.p, f = this.fwd, x = p.pos.x + f.x * d.range, z = p.pos.z + f.z * d.range, y = p.floorY(x, z, p.pos.y + 0.6);
    this.shake(0.3); this.sfx('boom');
    this.vfx.ring(x, y + 0.06, z, { r0: 0.4, r1: d.radius, dur: 0.45, color: 0xff8a3a });
    this.vfx.dust(x, y + 0.1, z, 10, 2);
    this.vfx.fire(x, y + 0.1, z, 6, 1.1);
    for (let i = 0; i < 5; i++) this.v2.crack(x, z, rnd(1, d.radius), rnd(0, TAU), { life: 0.9, width: 0.12 });
    for (let i = 0; i < 5; i++) this.g.fx.rock(x, y + 0.2, z);
    for (const t of this.combat.inCircle(x, z, d.radius)) {
      this.hit(t, d.damage);
      const { dx, dz } = this.awayFrom(t, x, z);
      this.combat.push(t, dx || f.x, dz || f.z, d.force);
    }
  }
}
// HALLEY — RIFLE
export class RifleSkill extends WeaponSkill {
  begin() { this.target = this.aim(this.def.range, this.def.coneDeg * 2); this.start(); return true; }
  muzzle() {
    const b = boneWorld(this, 'weapon_end') || boneWorld(this, 'weapon');
    if (b) return b;
    const f = this.fwd;
    return V(this.p.pos.x + f.x * 0.6, this.p.pos.y + this.p.H * 0.6, this.p.pos.z + f.z * 0.6);
  }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'apuntar', dur: d.prep, enter: () => { this.p.powerAnim = 1; }, tick: (dt, k) => { pose.rx = -0.06 * k; this.vfx.orb(this.muzzle(), { r: 0.06 + 0.1 * k, color: 0xffd890, life: 0.08 }); } },
      { name: 'disparo', dur: 0.12, enter: this.shoot, tick: (dt, k) => { pose.rx = -0.18 * (1 - k); } },
      { name: 'recuperacion', dur: d.recover, tick: (dt, k) => { pose.rx = lerp(-0.06, 0, k); } },
    ];
  }
  shoot() {
    const d = this.def, p = this.p, f = this.fwd, m = this.muzzle();
    const t = this.target && !this.target.dead ? this.target : this.combat.aimTarget(p.pos.x, p.pos.z, p.facing, d.coneDeg * DEG, d.range);
    const to = t ? V(t.pos.x, t.pos.y + (t.heavy ? t.S.height * 0.5 : 0.6), t.pos.z) : V(m.x + f.x * d.range, m.y, m.z + f.z * d.range);
    this.sfx('crack');
    this.vfx.orb(m, { r: 0.35, color: 0xfff0b0, life: 0.1, grow: 1 }); // fogonazo
    this.vfx.bolt(m, to, { color: 0xffd070, life: 0.12, jag: 0.03, segs: 3 }); // trazadora de arena
    this.v2.beam(m, to, { r: 0.05, color: 0xffd890, opacity: 0.8, life: 0.18 });
    this.vfx.sand(to.x, to.y, to.z, 2);
    if (t) {
      this.hit(t, d.damage);
      this.combat.push(t, f.x, f.z, d.force);
      this.vfx.sparks(to.x, to.y, to.z, 0xffe0a0, 8, 2.4);
    }
  }
}
// NILO — BUMERÁN (ida y vuelta)
export class BoomerangSkill extends WeaponSkill {
  begin() { this.aim(this.def.dist); this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'lanzar', dur: d.prep, enter: () => { this.p.powerAnim = 1; }, tick: (dt, k) => { pose.spin = -0.5 * k; } },
      { name: 'vuelo', dur: d.flightT, enter: this.enterFly, tick: this.tickFly, exit: () => { this.mesh.kill(); this.sfx('stick'); this.vfx.splash(this.p.pos.x, this.p.pos.y + this.p.H * 0.6, this.p.pos.z, 6, 0.5); } },
      { name: 'recuperacion', dur: d.recover, tick: (dt, k) => { pose.spin = 0; } },
    ];
  }
  enterFly() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2ab0c8, roughness: 0.35, metalness: 0.3, emissive: 0x0a4a5a, emissiveIntensity: 0.6 });
    for (const s of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.13), mat); arm.position.set(s * 0.22, 0, 0.1); arm.rotation.y = s * 0.55; g.add(arm); }
    g.traverse((o) => { o.userData.own = true; });
    this.mesh = { obj: g, it: this.vfx.add(g, 0), kill: () => this.vfx.kill(this.mesh.it) };
    this.track(this.mesh);
    this.o = this.p.pos.clone();
    this.dir = this.fwd;
    this.hitOut = new Set(); this.hitBack = new Set();
    this.sfx('flap');
  }
  tickFly(dt, k) {
    const d = this.def, p = this.p, u = k;
    // trayectoria en lazo: sale hacia delante abriéndose a un lado y vuelve a la mano del héroe
    const fwdD = d.dist * Math.sin(u * Math.PI), side = d.width * Math.sin(u * TAU) * 0.5;
    const sx = -this.dir.z, sz = this.dir.x;
    const home = V(p.pos.x, p.pos.y + p.H * 0.6, p.pos.z), start = V(this.o.x, this.o.y + p.H * 0.6, this.o.z);
    const base = start.clone().lerp(home, u);
    const pos = V(base.x + this.dir.x * fwdD + sx * side, base.y + Math.sin(u * Math.PI) * 0.6, base.z + this.dir.z * fwdD + sz * side);
    const g = this.mesh.obj;
    g.position.copy(pos); g.rotation.y += dt * 28; g.rotation.z = 0.25;
    if (Math.random() < 0.6) this.g.fx.spray(pos.x, pos.y, pos.z, 0, 0.5, 0, 0.8); // gotas de agua
    const set = u < 0.5 ? this.hitOut : this.hitBack;
    for (const t of this.combat.inCircle(pos.x, pos.z, d.hitRadius)) {
      if (set.has(t)) continue;
      set.add(t);
      this.hit(t, d.damage);
      this.combat.push(t, this.dir.x * (u < 0.5 ? 1 : -1), this.dir.z * (u < 0.5 ? 1 : -1), d.force);
      this.vfx.splash(t.pos.x, t.pos.y + 0.7, t.pos.z, 8, 0.8);
      this.sfx('stick');
    }
  }
}
// KYRA — HACHA
export class AxeSkill extends WeaponSkill {
  begin() { this.aim(this.def.range + 2); this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'alzar', dur: d.prep, enter: () => { this.p.powerAnim = 1; }, tick: (dt, k) => { pose.rx = -0.5 * ease(k); pose.sy = 1 + 0.05 * k; } },
      { name: 'hachazo', dur: d.chop, enter: () => this.sfx('crack'), tick: (dt, k) => { pose.rx = lerp(-0.5, 0.55, back(k)); }, exit: this.impact },
      { name: 'recuperacion', dur: d.recover, tick: (dt, k) => { pose.rx = lerp(0.55, 0, ease(k)); pose.sy = 1; } },
    ];
  }
  impact() {
    const d = this.def, p = this.p, f = this.fwd, x = p.pos.x + f.x * d.range * 0.6, z = p.pos.z + f.z * d.range * 0.6;
    this.shake(0.18);
    this.crescent(p.pos.y + p.H * 0.5, { r: d.range, arc: d.arcDeg, color: 0x9ae8ff, vertical: true, life: 0.22 });
    this.vfx.ice(x, p.pos.y + 0.3, z, 6);
    this.vfx.ring(x, null, z, { r0: 0.3, r1: 2.2, dur: 0.4, color: 0xbff0ff });
    this.hitArc(d.range, d.arcDeg, d.damage, d.force, (t) => { this.combat.slow(t, d.slowF, d.slowT); this.vfx.ice(t.pos.x, t.pos.y + 0.6, t.pos.z, 3); });
  }
}
// LIRA — BALLESTA
export class CrossbowSkill extends WeaponSkill {
  begin() { this.aim(this.def.range, 30); this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'cargar', dur: d.prep, enter: () => { this.p.powerAnim = 1; }, tick: (dt, k) => { pose.rx = -0.08 * k; const c = this.center(0.6); this.vfx.orb(V(c.x + this.fwd.x * 0.5, c.y, c.z + this.fwd.z * 0.5), { r: 0.05 + 0.08 * k, color: 0x8aff7a, life: 0.08 }); } },
      { name: 'disparo', dur: 0.1, enter: this.fire, tick: (dt, k) => { pose.rx = -0.15 * (1 - k); } },
      { name: 'recuperacion', dur: d.recover, tick: () => {} },
    ];
  }
  fire() {
    const d = this.def, p = this.p, f = this.fwd, c = this.center(0.6);
    const start = V(c.x + f.x * 0.5, c.y, c.z + f.z * 0.5);
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), new THREE.MeshBasicMaterial({ color: 0xd8ffb0 }));
    shaft.rotation.x = Math.PI / 2;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8aff7a).multiplyScalar(2) }));
    head.rotation.x = Math.PI / 2; head.position.z = 0.48;
    g.add(shaft, head);
    g.traverse((o) => { o.userData.own = true; });
    g.position.copy(start);
    g.rotation.y = p.facing;
    this.sfx('snap');
    const hits = new Set(), combat = this.combat, vfx = this.vfx, life = d.range / d.speed;
    let left = d.pierce;
    vfx.add(g, life, (it, dt) => {
      g.position.x += f.x * d.speed * dt; g.position.z += f.z * d.speed * dt;
      vfx.orb(g.position, { r: 0.09, color: 0x8aff7a, life: 0.2 }); // estela verde
      if (left <= 0) { it.t = life; return; }
      for (const t of combat.inCircle(g.position.x, g.position.z, 0.5)) {
        if (hits.has(t)) continue;
        hits.add(t); left--;
        combat.damage(t, d.damage);
        vfx.sparks(g.position.x, g.position.y, g.position.z, 0xb0ff90, 10, 2.6);
        vfx.leaves(t.pos.x, t.pos.y + 0.5, t.pos.z, [0x7ae05a, 0x3aa03a], 4);
      }
    });
  }
}
// ÁMBAR — DISCO FUTURISTA (rebota entre enemigos)
export class DiscSkill extends WeaponSkill {
  begin() { this.aim(this.def.range, 35); this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'lanzar', dur: d.prep, enter: () => { this.p.powerAnim = 1; }, tick: (dt, k) => { pose.spin = -0.7 * k; } },
      { name: 'disco', dur: 0.12, enter: this.throwDisc, tick: (dt, k) => { pose.spin = lerp(-0.7, 0.4, k); } },
      { name: 'recuperacion', dur: d.recover, tick: (dt, k) => { pose.spin = lerp(0.4, 0, k); } },
    ];
  }
  throwDisc() {
    const d = this.def, p = this.p, f = this.fwd, c = this.center(0.6);
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 24), new THREE.MeshStandardMaterial({ color: 0xdff4ff, metalness: 0.8, roughness: 0.2, emissive: 0x2a8aff, emissiveIntensity: 0.8 }));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.04, 8, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6ad0ff).multiplyScalar(2.2) }));
    rim.rotation.x = Math.PI / 2;
    g.add(disc, rim);
    g.traverse((o) => { o.userData.own = true; });
    g.position.set(c.x + f.x * 0.6, c.y, c.z + f.z * 0.6);
    this.sfx('wind');
    const combat = this.combat, vfx = this.vfx, sfx = (n) => this.sfx(n);
    const hit = new Set();
    let target = combat.aimTarget(p.pos.x, p.pos.z, p.facing, 35 * DEG, d.range), bounces = d.bounces, dir = V(f.x, 0, f.z), travelled = 0;
    vfx.add(g, 4, (it, dt) => {
      g.rotation.y += dt * 25;
      if (Math.random() < 0.7) vfx.orb(g.position, { r: 0.14, color: 0x8adcff, life: 0.18 });
      if (target && !target.dead) {
        const to = V(target.pos.x, target.pos.y + (target.heavy ? target.S.height * 0.5 : 0.6), target.pos.z);
        dir.subVectors(to, g.position);
        const l = dir.length();
        if (l < 0.6) { // impacto y rebote al siguiente
          combat.damage(target, d.damage);
          hit.add(target);
          vfx.ring(target.pos.x, to.y, target.pos.z, { r0: 0.2, r1: 1.4, dur: 0.3, color: 0x8adcff });
          vfx.sparks(to.x, to.y, to.z, 0xbfeaff, 8, 2.4);
          sfx('stick');
          if (bounces-- > 0) {
            let best = null, bd = d.bounceRange;
            for (const t of combat.targets()) { if (hit.has(t)) continue; const dd = Math.hypot(t.pos.x - target.pos.x, t.pos.z - target.pos.z); if (dd < bd) { bd = dd; best = t; } }
            target = best;
          } else target = null;
          if (!target) it.t = Math.max(it.t, 3.75);
          return;
        }
        dir.divideScalar(l);
      }
      g.position.addScaledVector(dir, d.speed * dt);
      travelled += d.speed * dt;
      if (!target && travelled > d.range) it.t = Math.max(it.t, 3.8);
    });
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
      { name: 'invocar', dur: d.prep, enter: this.enterCall, tick: (dt, k) => { pose.rx = -0.2 * k; pose.spin = k * TAU * 0.5; this.place(k); } },
      { name: 'escudo', dur: d.exec, tick: this.tickShield },
      { name: 'disipar', dur: d.recover, tick: (dt, k) => { pose.spin = 0; this.place(1 - k, 1 + k); } },
    ];
  }
  enterCall() {
    const d = this.def;
    this.sfx('wind');
    this.torn = [];
    for (let i = 0; i < d.count; i++) {
      const mat = glowMat({ color: 0x9ad4f0, rim: 0xffffff, opacity: 0.32, power: 1.8, core: 0.06, fadeY: 0.15, side: THREE.DoubleSide });
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.1, 2.8, 20, 6, true), mat);
      m.userData.own = true;
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.05, 2.4, 16, 4, true), mat);
      inner.userData.own = true;
      const g = new THREE.Group();
      g.add(m, inner);
      this.prop(g);
      this.torn.push({ g, m, inner, a: (i / d.count) * TAU });
    }
    this.ringT = 0;
  }
  // los tornados orbitan a su alrededor; k = tamaño, rr = escala del radio de órbita
  place(k, rr = 1) {
    const d = this.def, p = this.p;
    for (const t of this.torn) {
      t.a += 0.06;
      const r = d.orbit * rr;
      t.g.position.set(p.pos.x + Math.cos(t.a) * r, p.floorY(p.pos.x, p.pos.z, p.pos.y + 0.5) + 1.6 * k, p.pos.z + Math.sin(t.a) * r);
      t.g.scale.set(k, k, k);
      t.m.rotation.y += 0.5; t.inner.rotation.y -= 0.7;
    }
  }
  tickShield(dt) {
    const d = this.def, p = this.p, c = this.combat;
    this.pose.spin = 0;
    this.place(1 + 0.05 * Math.sin(this.t * 9));
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
    this.amb = this.v2.ambience({ color: '#1a3a2a', alpha: 0.45, blend: 'multiply', exposure: 0.85, dur: d.exec + d.recover + 0.4, fin: 0.4, fout: 0.5 });
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
    for (const t of this.combat.targets()) {
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
    for (const t of this.combat.targets()) if (t.heavy && Math.hypot(t.pos.x - this.p.pos.x, t.pos.z - this.p.pos.z) < d.range) this.combat.mark(t, 0.3);
  }
}

export const POWER2_CLASSES = {
  speedfx: SpeedFxSkill, katana: KatanaSkill, hammer: HammerSkill, rifle: RifleSkill, boomerang: BoomerangSkill,
  axe: AxeSkill, crossbow: CrossbowSkill, disc: DiscSkill, tornado: TornadoShieldSkill, claws: WindClawsSkill, vision: VisionSkill,
};
