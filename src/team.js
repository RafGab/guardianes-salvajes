import { TEAM } from './skills/config.js';

// EQUIPO DE COMBATE: hasta 3 héroes, cada uno con su vida. Solo uno está en el campo; los demás esperan en reserva
// (y se recuperan poco a poco). La estatura de cada héroe es siempre la oficial (scale.js): aquí no se toca.
export class Team {
  constructor() {
    this.members = [];
    this.active = 0;
    this.switchT = 0;
    this.graceT = 0;
    this.lastHit = 0;
  }
  clear() { this.members = []; this.active = 0; this.switchT = 0; this.graceT = 0; }
  set(ids) {
    this.members = ids.slice(0, TEAM.size).map((id) => ({ id, hp: TEAM.hp, max: TEAM.hp, ko: false }));
    this.active = 0;
    this.switchT = 0;
    this.graceT = 0;
  }
  get on() { return this.members.length > 0; }
  get current() { return this.members[this.active]; }
  get anyAlive() { return this.members.some((m) => !m.ko); }
  indexOf(id) { return this.members.findIndex((m) => m.id === id); }

  // Daño al héroe en el campo. Devuelve { ko, wipe }
  hit(n) {
    const m = this.current;
    if (!m || m.ko) return { ko: false, wipe: false };
    m.hp = Math.max(0, m.hp - n);
    this.lastHit = n;
    if (m.hp <= 0) { m.ko = true; return { ko: true, wipe: !this.anyAlive }; }
    return { ko: false, wipe: false };
  }
  // Siguiente héroe disponible en la dirección dada (null si no hay otro)
  nextIndex(dir = 1) {
    const n = this.members.length;
    for (let k = 1; k < n; k++) {
      const i = (this.active + dir * k + n * 4) % n;
      if (!this.members[i].ko) return i;
    }
    return null;
  }
  update(dt) {
    this.switchT = Math.max(0, this.switchT - dt);
    this.graceT = Math.max(0, this.graceT - dt);
    this.members.forEach((m, i) => {
      if (i !== this.active && !m.ko) m.hp = Math.min(m.max, m.hp + TEAM.benchRegen * dt);
    });
  }
}
