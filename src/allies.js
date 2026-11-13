import * as THREE from 'three';
import { HEROES, ELEMENTS, getHeroModel } from './heroes.js';
import { TEAM } from './skills/config.js';
import { ui } from './ui.js';

/* ======================================================================
   COMPAÑEROS EN EL COMBATE DE JEFE
   El jugador controla a UN héroe; los otros dos del equipo combaten a su lado como compañeros:
   · Llevan su arma en la mano y eligen enemigo (soldados primero si están cerca, si no el jefe).
   · ATAQUES VISIBLES: tajo con el arma (arco de luz + impacto), proyectil elemental que sale de su
     mano, viaja hasta el enemigo y estalla, y cada cierto tiempo su PODER (el de su ficha) en área.
   · Reciben daño de los enemigos (su barra verde baja) y pueden caer K.O.
   · Usan el mismo modelo, esqueleto y animaciones que cuando los controla el jugador.
   · Al cambiar de héroe (Z/X o tocando la ficha) el elegido pasa a ser el del jugador y el que sale
     sigue combatiendo como compañero: la lista se rehace con sync().
   ====================================================================== */

const rnd = (a, b) => a + Math.random() * (b - a);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const dampAngle = (a, b, k, dt) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * (1 - Math.exp(-k * dt)); };
const DMG = { melee: [5, 6], bolt: [4, 5], power: [9, 11] };   // [jefe, soldado]
const SLASH_GEO = new THREE.RingGeometry(0.75, 1.0, 24, 1, -1.1, 2.2);

export class Allies {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.bolts = [];
  }
  get alive() { return this.list.filter((a) => !a.ko); }

  // rehace la lista: miembros del equipo que no son el héroe del jugador y siguen en pie
  sync() {
    const g = this.g, t = g.team;
    if (!t.on || !g.boss) { this.clear(); return; }
    const want = t.members.filter((m, i) => i !== t.active && !m.ko);
    for (const a of this.list.slice()) {
      if (!want.includes(a.member)) {
        if (a.model !== g.player.model) a.model.setVisible(false);
        this.list.splice(this.list.indexOf(a), 1);
      }
    }
    want.forEach((m) => {
      if (this.list.some((a) => a.member === m)) return;
      const used = this.list.map((a) => a.side);
      const side = used.includes(-1) ? 1 : -1;
      const def = HEROES.find((h) => h.id === m.id);
      const model = getHeroModel(m.id);
      if (model.root.parent !== g.scene) g.scene.add(model.root);
      model.setVisible(true);
      const pos = this.slotPos(side);
      const power = (g.skills.entries(m.id).find((e) => e.role === 'poder') || {}).name || 'Poder';
      const a = { id: m.id, member: m, def, model, pos, vel: new THREE.Vector3(), facing: g.player.facing, R: g.player.R, H: model.height || 1.6, ko: false, side, speed: 0,
        atkCd: rnd(0.8, 1.6), atkT: 0, kind: null, hitDone: false, hurtT: 0, powerCd: rnd(6, 10), power, col: ELEMENTS[def.element].color };
      this.list.push(a);
      g.weapons.holdFor(model, m.id); // su arma, en la mano
      for (let j = 0; j < 18; j++) g.fx.sparkle(pos.x, pos.y + Math.random() * a.H, pos.z, 0xffe070, 2.4);
    });
  }
  clear() {
    for (const a of this.list) if (a.model !== this.g.player.model) a.model.setVisible(false);
    this.list = [];
    for (const b of this.bolts) this.g.scene.remove(b.g);
    this.bolts = [];
  }

  // hueco de un compañero junto al héroe activo (si no tiene enemigo al que atacar)
  slotPos(side) {
    const g = this.g, p = g.player.pos, b = g.boss ? g.boss.pos : null;
    let fx = Math.sin(g.player.facing), fz = Math.cos(g.player.facing);
    if (b) { const dx = b.x - p.x, dz = b.z - p.z, l = Math.hypot(dx, dz) || 1; fx = dx / l; fz = dz / l; }
    const out = new THREE.Vector3(p.x - fx * 1.5 - fz * side * 2.6, p.y, p.z - fz * 1.5 + fx * side * 2.6);
    this.clampArena(out);
    out.y = g.player.floorY ? g.player.floorY(out.x, out.z, p.y + 2) : p.y;
    return out;
  }
  clampArena(v) {
    const arena = this.g.boss && this.g.boss.arena;
    if (!arena) return;
    const d0 = Math.hypot(v.x - arena.x, v.z - arena.z), lim = arena.r * 0.95;
    if (d0 > lim) { v.x = arena.x + ((v.x - arena.x) / d0) * lim; v.z = arena.z + ((v.z - arena.z) / d0) * lim; }
  }

  // golpe recibido por un compañero (en unidades de golpe, como el jugador)
  hit(a, units, from) {
    const g = this.g;
    if (a.ko || g.state !== 'playing' || g.bossIntroT > 0 || a.hurtT > 0.35) return;
    const phase = g.boss ? g.boss.phase || 1 : 1;
    const n = Math.max(1, Math.round(units * TEAM.hitDamage * 0.8 * (1 + TEAM.phaseScale * (phase - 1))));
    a.member.hp = Math.max(0, a.member.hp - n);
    a.hurtT = 0.6;
    if (from) { const dx = a.pos.x - from.x, dz = a.pos.z - from.z, l = Math.hypot(dx, dz) || 1; a.vel.x += (dx / l) * 5; a.vel.z += (dz / l) * 5; }
    for (let j = 0; j < 10; j++) g.fx.sparkle(a.pos.x, a.pos.y + a.H * 0.6, a.pos.z, 0xff5a4a, 2.4);
    g.floatAt(a.pos, a.H + 0.3, `-${n}`, 'taken');
    g.hpDirty = true;
    if (a.member.hp <= 0) this.down(a);
  }
  down(a) {
    const g = this.g;
    a.ko = true; a.member.ko = true;
    for (let j = 0; j < 26; j++) g.fx.sparkle(a.pos.x, a.pos.y + Math.random() * a.H, a.pos.z, 0xff6a5a, 2.6);
    g.vfx.ring(a.pos.x, null, a.pos.z, { r0: 0.4, r1: 2.2, dur: 0.6, color: 0xff6a5a });
    a.model.setVisible(false);
    this.list.splice(this.list.indexOf(a), 1);
    if (g.onAllyDown) g.onAllyDown(a);
  }

  // enemigo para un compañero: un soldado cercano si lo hay; si no, el jefe
  pickTarget(a) {
    let best = null, bd = 1e9;
    for (const e of this.g.combat.enemies()) {
      if (e.dead || e.state === 'dead') continue;
      const d = Math.hypot(e.pos.x - a.pos.x, e.pos.z - a.pos.z) - (e.radius || 0.5) + (e.heavy ? 4 : 0);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  aimY(t) { return t.pos.y + (t.heavy ? (t.S ? t.S.height * 0.5 : 1.2) : 0.8); }
  dmg(t, kind) { return DMG[kind][t.heavy ? 0 : 1]; }
  damage(a, t, n) {
    const c = this.g.combat, s0 = c.src;
    c.src = a; c.damage(t, n); c.src = s0;
  }

  update(dt) {
    const g = this.g;
    const fighting = g.state === 'playing' && !(g.bossIntroT > 0) && !g.allyWin;
    for (const a of this.list.slice()) {
      a.atkCd -= dt; a.powerCd -= dt;
      a.hurtT = Math.max(0, a.hurtT - dt);
      a.atkT = Math.max(0, a.atkT - dt);
      const prev = a.pos.clone();
      const tgt = fighting ? (a.atkT > 0 && a.tgt && !a.tgt.dead && a.tgt.state !== 'dead' ? a.tgt : this.pickTarget(a)) : null;
      let goal = null;
      if (tgt) {
        // decide el próximo ataque: poder (si está listo), proyectil o tajo con el arma
        if (!a.plan) a.plan = a.powerCd <= 0 ? 'power' : Math.random() < 0.35 ? 'bolt' : 'melee';
        const range = a.plan === 'melee' ? (tgt.radius || 0.5) + 1.6 : a.plan === 'bolt' ? 8 : 6;
        const dx = tgt.pos.x - a.pos.x, dz = tgt.pos.z - a.pos.z, d = Math.hypot(dx, dz);
        a.facing = dampAngle(a.facing, Math.atan2(dx, dz), 10, dt);
        if (a.atkT <= 0) {
          if (d > range) goal = new THREE.Vector3(tgt.pos.x - (dx / d) * (range - 0.3), 0, tgt.pos.z - (dz / d) * (range - 0.3));
          else if (a.atkCd <= 0) this.startAttack(a, tgt, a.plan);
          else { const s = a.side; goal = new THREE.Vector3(a.pos.x - (dz / d) * s * 1.2, 0, a.pos.z + (dx / d) * s * 1.2); } // espera su turno rodeando
        }
        this.tickAttack(a, dt);
      } else if (!g.allyWin) goal = this.slotPos(a.side);
      // movimiento (más lento mientras golpea) y separación entre héroes
      let mx = 0, mz = 0;
      if (goal) { const dx = goal.x - a.pos.x, dz = goal.z - a.pos.z, d = Math.hypot(dx, dz); if (d > 0.3) { mx = dx / d; mz = dz / d; } }
      for (const o of [{ pos: g.player.pos }, ...this.list.filter((x) => x !== a)]) {
        const dx = a.pos.x - o.pos.x, dz = a.pos.z - o.pos.z, d = Math.hypot(dx, dz);
        if (d < 1.4 && d > 1e-3) { mx += (dx / d) * (1.4 - d) * 1.5; mz += (dz / d) * (1.4 - d) * 1.5; }
      }
      const sp = (a.def.stats.speed || 6) * 0.8 * (a.atkT > 0 ? 0.15 : 1);
      a.pos.x += mx * sp * dt + a.vel.x * dt; a.pos.z += mz * sp * dt + a.vel.z * dt;
      a.vel.multiplyScalar(Math.max(0, 1 - 5 * dt));
      // no atraviesan a los enemigos
      for (const e of g.combat.enemies()) {
        if (e.dead || e.state === 'dead') continue;
        const R = (e.heavy ? (e.S ? e.S.radius : 1.2) * 0.85 : e.radius || 0.5) + a.R;
        const dx = a.pos.x - e.pos.x, dz = a.pos.z - e.pos.z, d = Math.hypot(dx, dz);
        if (d < R && d > 1e-4) { a.pos.x = e.pos.x + (dx / d) * R; a.pos.z = e.pos.z + (dz / d) * R; }
      }
      this.clampArena(a.pos);
      a.pos.y = g.player.floorY ? g.player.floorY(a.pos.x, a.pos.z, a.pos.y + 1.5) : a.pos.y;
      const v = Math.hypot(a.pos.x - prev.x, a.pos.z - prev.z) / Math.max(dt, 1e-4);
      a.speed = damp(a.speed, v / Math.max(1, a.def.stats.speed || 6), 10, dt);
      if (!tgt && v < 0.6 && g.boss) a.facing = dampAngle(a.facing, Math.atan2(g.boss.pos.x - a.pos.x, g.boss.pos.z - a.pos.z), 5, dt);
      const m = a.model;
      m.root.position.copy(a.pos);
      m.root.rotation.set(0, a.facing, 0);
      m.root.scale.set(1, 1, 1);
      // mismas animaciones que con el jugador: correr, poder / ataque con el arma, impacto y celebración
      const atk = a.atkT > 0;
      m.update(dt, { speed: atk ? 0 : a.speed, grounded: true, power: atk ? 1 : 0, role: atk ? (a.kind === 'melee' ? 'arma' : 'poder') : null, hurt: a.hurtT > 0.3, celebrate: !!g.allyWin });
    }
    this.updateBolts(dt);
  }

  /* ---------------- ataques ---------------- */
  startAttack(a, t, kind) {
    a.kind = kind; a.tgt = t; a.plan = null; a.hitDone = false;
    a.atkT = kind === 'power' ? 0.9 : kind === 'bolt' ? 0.55 : 0.5;
    a.atkCd = kind === 'power' ? rnd(1.2, 1.8) : rnd(0.9, 1.5);
    if (kind === 'power') {
      a.powerCd = rnd(9, 13);
      ui.battleLog(`${ELEMENTS[a.def.element].icon} ${a.def.name}: ${a.power}`, 'hero');
      this.g.floatAt(a.pos, a.H + 0.6, `${ELEMENTS[a.def.element].icon} ${a.power}`, 'pick');
      for (let j = 0; j < 24; j++) this.g.fx.sparkle(a.pos.x + rnd(-0.6, 0.6), a.pos.y + rnd(0, a.H * 1.3), a.pos.z + rnd(-0.6, 0.6), a.col, 2.6); // carga de energía
      this.g.vfx.ring(a.pos.x, null, a.pos.z, { r0: 0.3, r1: 1.8, dur: 0.5, color: a.col });
    }
  }
  tickAttack(a, dt) {
    if (a.atkT <= 0 || a.hitDone) return;
    const g = this.g, t = a.tgt, total = a.kind === 'power' ? 0.9 : a.kind === 'bolt' ? 0.55 : 0.5, el = total - a.atkT;
    const at = a.kind === 'power' ? 0.45 : a.kind === 'bolt' ? 0.25 : 0.22; // momento del golpe / disparo
    if (el < at) return;
    a.hitDone = true;
    if (!t || t.dead || t.state === 'dead') return;
    const ty = this.aimY(t);
    if (a.kind === 'melee') {
      if (Math.hypot(t.pos.x - a.pos.x, t.pos.z - a.pos.z) > (t.radius || 0.5) + 2.6) return;
      this.slash(a);
      this.damage(a, t, this.dmg(t, 'melee'));
      this.impact(t.pos.x, ty, t.pos.z, a.col, 1);
    } else if (a.kind === 'bolt') {
      this.fireBolt(a, t);
    } else {
      // PODER: estalla sobre el enemigo y alcanza a los que estén cerca
      const R = 3.6;
      g.vfx.ring(t.pos.x, null, t.pos.z, { r0: 0.5, r1: R + 1, dur: 0.6, color: a.col });
      g.vfx.ring(t.pos.x, ty, t.pos.z, { r0: 0.3, r1: R, dur: 0.45, color: 0xffffff });
      if (g.vfx2 && g.vfx2.beam) g.vfx2.beam(new THREE.Vector3(t.pos.x, t.pos.y, t.pos.z), new THREE.Vector3(t.pos.x, t.pos.y + 9, t.pos.z), { r: 1.1, color: a.col, opacity: 0.55, life: 0.6 });
      for (let j = 0; j < 40; j++) g.fx.sparkle(t.pos.x + rnd(-R, R) * 0.6, t.pos.y + rnd(0, 3), t.pos.z + rnd(-R, R) * 0.6, j % 3 ? a.col : 0xffffff, 3.4);
      g.chase.shake(0.3);
      for (const e of g.combat.enemies()) {
        if (e.dead || e.state === 'dead') continue;
        if (Math.hypot(e.pos.x - t.pos.x, e.pos.z - t.pos.z) < R + (e.radius || 0.5)) this.damage(a, e, this.dmg(e, 'power'));
      }
    }
  }
  // arco de luz del tajo con el arma
  slash(a) {
    const g = this.g;
    const m = new THREE.Mesh(SLASH_GEO, new THREE.MeshBasicMaterial({ color: new THREE.Color(a.col).multiplyScalar(2), transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.userData.own = true;
    const f = { x: Math.sin(a.facing), z: Math.cos(a.facing) };
    m.position.set(a.pos.x + f.x * 0.9, a.pos.y + a.H * 0.55, a.pos.z + f.z * 0.9);
    m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2 + 0.3, a.facing, 0);
    m.scale.setScalar(1.6);
    g.vfx.add(m, 0.22, (it) => { const k = it.t / 0.22; m.material.opacity = 0.9 * (1 - k); m.scale.setScalar(1.6 + k * 0.6); m.rotation.z = -1.2 + k * 2.4; });
  }
  impact(x, y, z, col, k) {
    const g = this.g;
    g.vfx.orb(new THREE.Vector3(x, y, z), { r: 0.25 * k, color: col, opacity: 0.85, life: 0.18, grow: 1.8 });
    g.vfx.orb(new THREE.Vector3(x, y, z), { r: 0.18 * k, color: 0xffffff, life: 0.12, grow: 1.6 });
    g.vfx.ring(x, y, z, { r0: 0.1, r1: 1.4 * k, dur: 0.3, color: col });
    for (let i = 0; i < 12 * k; i++) g.fx.sparkle(x, y, z, i % 3 ? col : 0xffffff, 3.2);
  }
  // proyectil elemental: sale de la mano del compañero, viaja hasta el enemigo y estalla al tocarlo
  fireBolt(a, t) {
    const g = this.g;
    const grp = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(a.col).multiplyScalar(2.6), toneMapped: false }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(a.col).multiplyScalar(1.4), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    grp.add(core, halo);
    const f = { x: Math.sin(a.facing), z: Math.cos(a.facing) };
    grp.position.set(a.pos.x + f.x * 0.6, a.pos.y + a.H * 0.6, a.pos.z + f.z * 0.6);
    g.scene.add(grp);
    g.vfx.ring(grp.position.x, grp.position.y, grp.position.z, { r0: 0.1, r1: 0.9, dur: 0.25, color: a.col }); // destello al salir
    this.bolts.push({ g: grp, a, t, life: 2.2, col: a.col });
  }
  updateBolts(dt) {
    const g = this.g;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i], t = b.t;
      b.life -= dt;
      const gone = !t || t.dead || t.state === 'dead';
      const to = gone ? null : new THREE.Vector3(t.pos.x, this.aimY(t), t.pos.z);
      if (to) {
        const d = to.clone().sub(b.g.position), l = d.length();
        if (l < (t.radius || 0.5) * 0.8 + 0.4) { // impacto
          this.impact(to.x, to.y, to.z, b.col, 1.3);
          this.damage(b.a, t, this.dmg(t, 'bolt'));
          g.scene.remove(b.g); this.bolts.splice(i, 1); continue;
        }
        b.g.position.addScaledVector(d.normalize(), Math.min(l, 17 * dt));
      }
      b.g.children[1].scale.setScalar(1 + 0.2 * Math.sin(b.life * 30));
      g.fx.sparkle(b.g.position.x, b.g.position.y, b.g.position.z, b.col, 0.8); // estela
      if (b.life <= 0 || gone) { g.scene.remove(b.g); this.bolts.splice(i, 1); }
    }
  }
}
