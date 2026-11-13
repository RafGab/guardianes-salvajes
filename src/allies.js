import * as THREE from 'three';
import { HEROES } from './heroes.js';
import { getHeroModel } from './heroes.js';

/* ======================================================================
   COMPAÑEROS EN EL COMBATE DE JEFE
   El jugador controla a UN héroe; los otros dos del equipo se quedan en el campo como compañeros
   disponibles: no atacan por su cuenta (no es un grupo automático), se mantienen detrás del héroe activo,
   mirando al jefe, y descansan (recuperan vida poco a poco, como en reserva).
   · Usan el mismo modelo, esqueleto y animaciones que cuando los controla el jugador.
   · Cada uno conserva su vida (Team.members) y lleva su barra verde con el nombre.
   · Al cambiar de héroe (Z/X o tocando la ficha) el elegido entra en el sitio del jugador y el que
     sale ocupa su hueco entre los compañeros: la lista se rehace con sync().
   ====================================================================== */

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const dampAngle = (a, b, k, dt) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * (1 - Math.exp(-k * dt)); };

export class Allies {
  constructor(game) {
    this.g = game;
    this.list = [];
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
      const a = { id: m.id, member: m, def, model, pos, facing: g.player.facing, R: g.player.R, H: model.height || 1.6, ko: false, side, speed: 0 };
      this.list.push(a);
      for (let j = 0; j < 18; j++) g.fx.sparkle(pos.x, pos.y + Math.random() * a.H, pos.z, 0xffe070, 2.4);
    });
  }
  clear() {
    for (const a of this.list) if (a.model !== this.g.player.model) a.model.setVisible(false);
    this.list = [];
  }

  // hueco de un compañero: detrás del héroe activo (respecto al jefe) y a un lado
  slotPos(side) {
    const g = this.g, p = g.player.pos, b = g.boss ? g.boss.pos : null;
    let fx = Math.sin(g.player.facing), fz = Math.cos(g.player.facing);
    if (b) { const dx = b.x - p.x, dz = b.z - p.z, l = Math.hypot(dx, dz) || 1; fx = dx / l; fz = dz / l; }
    const x = p.x - fx * 3 + -fz * side * 2.6, z = p.z - fz * 3 + fx * side * 2.6;
    const arena = g.boss && g.boss.arena;
    const out = new THREE.Vector3(x, p.y, z);
    if (arena) { const d0 = Math.hypot(out.x - arena.x, out.z - arena.z), lim = arena.r * 0.95; if (d0 > lim) { out.x = arena.x + ((out.x - arena.x) / d0) * lim; out.z = arena.z + ((out.z - arena.z) / d0) * lim; } }
    out.y = g.player.floorY ? g.player.floorY(out.x, out.z, p.y + 2) : p.y;
    return out;
  }

  update(dt) {
    const g = this.g;
    for (const a of this.list) {
      const prev = a.pos.clone();
      const goal = this.slotPos(a.side);
      const dx = goal.x - a.pos.x, dz = goal.z - a.pos.z, d = Math.hypot(dx, dz);
      const sp = (a.def.stats.speed || 6) * 0.8;
      if (d > 0.4) { const k = Math.min(1, (sp * dt * Math.min(1, d / 1.5)) / d); a.pos.x += dx * k * Math.min(1, d); a.pos.z += dz * k * Math.min(1, d); }
      a.pos.y = goal.y;
      const v = Math.hypot(a.pos.x - prev.x, a.pos.z - prev.z) / Math.max(dt, 1e-4);
      a.speed = damp(a.speed, v / Math.max(1, a.def.stats.speed || 6), 10, dt);
      // mira hacia donde camina; parado, hacia el jefe
      const look = v > 0.6 ? Math.atan2(a.pos.x - prev.x, a.pos.z - prev.z) : g.boss ? Math.atan2(g.boss.pos.x - a.pos.x, g.boss.pos.z - a.pos.z) : g.player.facing;
      a.facing = dampAngle(a.facing, look, 6, dt);
      const m = a.model;
      m.root.position.copy(a.pos);
      m.root.rotation.set(0, a.facing, 0);
      m.root.scale.set(1, 1, 1);
      m.update(dt, { speed: a.speed, grounded: true, celebrate: !!g.allyWin });
    }
  }
}
