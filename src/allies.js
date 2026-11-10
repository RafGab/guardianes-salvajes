import * as THREE from 'three';
import { HEROES, ELEMENTS, getHeroModel } from './heroes.js';
import { TEAM } from './skills/config.js';

/* ======================================================================
   COMPAÑEROS EN EL COMBATE DE JEFE
   Los tres héroes del equipo luchan A LA VEZ: el jugador controla a uno y los otros dos combaten solos.
   · Usan el mismo modelo, esqueleto y animaciones que cuando los controla el jugador (correr, poder,
     impacto, celebrar), y su vida es la de su ficha del equipo (Team.members) con su barra propia.
   · Eligen el enemigo más cercano (soldados primero si están cerca, si no el jefe), se colocan a distancia,
     atacan con su elemento y se apartan un poco entre sí y del jugador.
   · Al cambiar de héroe (Z/X o tocando la ficha), el que deja el jugador pasa a ser compañero y el elegido
     deja de serlo: la lista se rehace con sync().
   ====================================================================== */

const rnd = (a, b) => a + Math.random() * (b - a);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const ALLY_DMG = { boss: 5, npc: 6 };   // daño por golpe de un compañero (el poder del jugador hace 12 al jefe)

export class Allies {
  constructor(game) {
    this.g = game;
    this.list = [];
  }
  get alive() { return this.list.filter((a) => !a.ko); }

  // rehace la lista: miembros del equipo que no son el héroe del jugador y siguen en pie
  sync(spawnAt = null) {
    const g = this.g, t = g.team;
    if (!t.on || !g.boss) { this.clear(); return; }
    const want = t.members.filter((m, i) => i !== t.active && !m.ko);
    for (const a of this.list.slice()) {
      if (!want.includes(a.member)) {
        if (a.model !== g.player.model) a.model.setVisible(false);
        this.list.splice(this.list.indexOf(a), 1);
      }
    }
    want.forEach((m, k) => {
      if (this.list.some((a) => a.member === m)) return;
      const def = HEROES.find((h) => h.id === m.id);
      const model = getHeroModel(m.id);
      if (model.root.parent !== g.scene) g.scene.add(model.root);
      model.setVisible(true);
      const base = spawnAt || g.player.pos, side = k ? 1 : -1;
      const pos = new THREE.Vector3(base.x + side * 2.2, base.y, base.z + 0.8);
      pos.y = g.player.floorY ? g.player.floorY(pos.x, pos.z, pos.y + 2) : pos.y;
      const a = { id: m.id, member: m, def, model, pos, vel: new THREE.Vector3(), facing: g.player.facing, atkCd: rnd(0.6, 1.4), atkT: 0, hurtT: 0, R: g.player.R, H: model.height || 1.6, ko: false, slot: side * 0.9, speed: 0 };
      this.list.push(a);
      for (let j = 0; j < 18; j++) g.fx.sparkle(pos.x, pos.y + Math.random() * a.H, pos.z, 0xffe070, 2.4);
    });
  }
  clear() {
    for (const a of this.list) if (a.model !== this.g.player.model) a.model.setVisible(false);
    this.list = [];
  }

  // golpe recibido por un compañero (en unidades de golpe, como el jugador)
  hit(a, units, from) {
    const g = this.g;
    if (a.ko || g.state !== 'playing' || g.bossIntroT > 0) return;
    if (a.hurtT > 0.35) return; // breve invulnerabilidad tras un golpe
    const phase = g.boss ? g.boss.phase || 1 : 1;
    const n = Math.max(1, Math.round(units * TEAM.hitDamage * (1 + TEAM.phaseScale * (phase - 1))));
    a.member.hp = Math.max(0, a.member.hp - n);
    a.hurtT = 0.6;
    if (from) { const dx = a.pos.x - from.x, dz = a.pos.z - from.z, l = Math.hypot(dx, dz) || 1; a.vel.x += (dx / l) * 4; a.vel.z += (dz / l) * 4; }
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
    const enemies = this.g.combat.enemies();
    let best = null, bd = 1e9;
    for (const e of enemies) {
      const d = Math.hypot(e.pos.x - a.pos.x, e.pos.z - a.pos.z) - (e.radius || 0.5) + (e.heavy ? 4 : 0);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  update(dt) {
    const g = this.g;
    const arena = g.boss && g.boss.arena;
    for (const a of this.list.slice()) {
      a.atkCd = Math.max(0, a.atkCd - dt);
      a.hurtT = Math.max(0, a.hurtT - dt);
      a.atkT = Math.max(0, a.atkT - dt);
      const tgt = g.bossIntroT > 0 ? null : this.pickTarget(a);
      const prev = a.pos.clone();
      let mx = 0, mz = 0;
      if (tgt) {
        const dx = tgt.pos.x - a.pos.x, dz = tgt.pos.z - a.pos.z, d = Math.hypot(dx, dz) || 1;
        const want = (tgt.radius || 0.5) + (tgt.heavy ? 2.6 : 1.3);
        const nx = dx / d, nz = dz / d;
        if (d > want + 0.3) { mx = nx; mz = nz; } else if (d < want - 0.6) { mx = -nx * 0.6; mz = -nz * 0.6; }
        else { mx = -nz * a.slot * 0.35; mz = nx * a.slot * 0.35; } // a distancia: rodea un poco
        a.facing = damp(a.facing, Math.atan2(dx, dz), 8, dt);
        // ataque: anticipación breve (anim. 'power') y golpe elemental
        if (d < want + 0.9 && a.atkCd <= 0) {
          a.atkCd = rnd(1.5, 2.2); a.atkT = 0.55; a.hitAt = 0.3; a.hitTarget = tgt;
        }
        if (a.atkT > 0 && a.hitAt !== null && a.atkT <= 0.55 - a.hitAt) {
          a.hitAt = null;
          const t = a.hitTarget;
          if (t && !t.dead && t.state !== 'dead' && Math.hypot(t.pos.x - a.pos.x, t.pos.z - a.pos.z) < (t.radius || 0.5) + 3.6) {
            const s0 = g.combat.src; g.combat.src = a;
            g.combat.damage(t, t.heavy ? ALLY_DMG.boss : ALLY_DMG.npc);
            g.combat.src = s0;
            const col = ELEMENTS[a.def.element].color, y = t.pos.y + (t.heavy ? (t.S ? t.S.height * 0.45 : 1.2) : 0.8);
            g.vfx.ring(t.pos.x, y, t.pos.z, { r0: 0.2, r1: 1.4, dur: 0.3, color: col });
            for (let j = 0; j < 10; j++) g.fx.sparkle(t.pos.x, y, t.pos.z, col, 2.4);
          }
        }
      } else if (!g.boss || g.boss.state === 'dead') a.facing = damp(a.facing, g.player.facing, 4, dt);
      // separación: no se pisan con el jugador ni entre ellos
      for (const o of [{ pos: g.player.pos }, ...this.list.filter((x) => x !== a)]) {
        const dx = a.pos.x - o.pos.x, dz = a.pos.z - o.pos.z, d = Math.hypot(dx, dz);
        if (d < 1.4 && d > 1e-3) { mx += (dx / d) * (1.4 - d) * 1.5; mz += (dz / d) * (1.4 - d) * 1.5; }
      }
      const sp = (a.def.stats.speed || 6) * 0.75 * (a.atkT > 0 ? 0.2 : 1);
      a.pos.x += mx * sp * dt + a.vel.x * dt; a.pos.z += mz * sp * dt + a.vel.z * dt;
      a.vel.multiplyScalar(Math.max(0, 1 - 5 * dt));
      if (arena) { const d0 = Math.hypot(a.pos.x - arena.x, a.pos.z - arena.z), lim = arena.r * 0.95; if (d0 > lim) { a.pos.x = arena.x + ((a.pos.x - arena.x) / d0) * lim; a.pos.z = arena.z + ((a.pos.z - arena.z) / d0) * lim; } }
      a.pos.y = g.player.floorY ? g.player.floorY(a.pos.x, a.pos.z, a.pos.y + 1.5) : a.pos.y;
      const v = Math.hypot(a.pos.x - prev.x, a.pos.z - prev.z) / Math.max(dt, 1e-4);
      a.speed = damp(a.speed, v / Math.max(1, a.def.stats.speed || 6), 10, dt);
      // mismo modelo y animaciones que cuando lo controla el jugador
      const m = a.model;
      m.root.position.copy(a.pos);
      m.root.rotation.set(0, a.facing, 0);
      m.root.scale.set(1, 1, 1);
      const win = g.allyWin;
      m.update(dt, { speed: a.atkT > 0 ? 0 : a.speed, grounded: true, power: a.atkT > 0 ? 1 : 0, role: a.atkT > 0 ? 'arma' : null, hurt: a.hurtT > 0.3, celebrate: !!win });
    }
  }
}
