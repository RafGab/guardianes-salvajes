import * as THREE from 'three';
import { BOSS_ATTACKS } from './config.js';
import { terrainH } from '../terrain.js';

// BASE de los ataques de firma de los jefes. Cada ataque es una lista de etapas:
//   TELEGRAFIADO (aviso claro) → ATAQUE → IMPACTO/VFX → RECUPERACIÓN
// Un ataque potente nunca ocurre sin su aviso: el jugador puede aprender a esquivarlo.

export const rnd = (a, b) => a + Math.random() * (b - a);
export const TAU = Math.PI * 2;
const CFG_KEY = { kerberos: 'cerbero' };

// Máquina de etapas común a los ataques de jefe y a las habilidades de los héroes:
// una lista de etapas { name, dur, enter(), tick(dt, k), exit() } que se recorren en orden.
export class Staged {
  constructor(vfx, combat) {
    this.vfx = vfx;
    this.combat = combat;
    this.handles = [];   // avisos y efectos que se limpian solos al terminar
    this.i = -1;
    this.t = 0;
    this.stages = [];
  }
  build() { return []; }
  cleanup() {}
  start() {
    this.stages = this.build();
    this.next();
  }
  next() {
    this.i++;
    this.t = 0;
    const s = this.stages[this.i];
    if (s && s.enter) s.enter.call(this);
  }
  // true cuando ha terminado
  update(dt) {
    const s = this.stages[this.i];
    if (!s) return true;
    this.t += dt;
    if (s.tick) s.tick.call(this, dt, Math.min(1, this.t / Math.max(0.001, s.dur)));
    if (this.t >= s.dur) {
      if (s.exit) s.exit.call(this);
      this.next();
    }
    return this.i >= this.stages.length;
  }
  get stageName() { return this.stages[this.i] ? this.stages[this.i].name : 'fin'; }
  // Fuerza el final de la etapa actual (p. ej. la embestida choca antes de tiempo)
  endStage() { const s = this.stages[this.i]; if (s) s.dur = this.t; }

  track(h) { this.handles.push(h); return h; }
  // Añade una malla suelta a la escena y devuelve un manejador que la retira (se limpia al terminar)
  prop(obj) {
    this.vfx.group.add(obj);
    return this.track({ obj, kill: () => { this.vfx.group.remove(obj); } });
  }
  linger(o) { return this.combat.linger(o); }
  killHandles() {
    for (const h of this.handles) { if (!h) continue; if (h.kill) h.kill(); else this.vfx.kill(h); } // h: manejador propio o ítem de Vfx
    this.handles.length = 0;
  }
}

export class Attack extends Staged {
  constructor(boss) {
    super(boss.ctx.game.vfx, boss.ctx.game.combat);
    this.b = boss;
    this.ctx = boss.ctx;
    this.g = boss.ctx.game;
    this.player = boss.ctx.player;
    this.cfg = BOSS_ATTACKS[CFG_KEY[boss.kind] || boss.kind] || {};
    this.solids = [];    // sólidos temporales (muros, estatuas)
  }

  shake(n) { this.ctx.chase.shake(n); }
  boom(vol = 0.4, freq = 120, dur = 0.5) { this.ctx.audio.noiseBurst(dur, freq, vol, 'lowpass'); } // noiseBurst(dur, freq, vol, tipo)
  get headY() { return this.gy(this.b.pos.x, this.b.pos.z) + this.b.flyHeight + this.b.S.height * 0.75; }
  // Posición del mundo a `fwd` metros delante del jefe y `side` a su derecha, a la altura `y`
  local(fwd, side, y) {
    const b = this.b, f = b.facing;
    return new THREE.Vector3(b.pos.x + Math.sin(f) * fwd + Math.cos(f) * side, y, b.pos.z + Math.cos(f) * fwd - Math.sin(f) * side);
  }
  dispose() {
    this.killHandles();
    this.cleanup();
    for (const s of this.solids) this.removeSolid(s);
    this.solids.length = 0;
    this.b.anim.dy = 0; this.b.anim.rx = 0; this.b.anim.sy = 1; this.b.anim.spin = 0;
  }

  /* ---------- utilidades ---------- */
  gy(x, z) { return terrainH(x, z); }
  faceTowards(x, z, dt, rate = 6) {
    const want = Math.atan2(x - this.b.pos.x, z - this.b.pos.z);
    let d = want - this.b.facing;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    this.b.facing += d * Math.min(1, rate * dt);
  }
  // ¿Está el héroe dentro del cono? (se tiene en cuenta su radio)
  playerInCone(x, z, facing, half, range) {
    const p = this.player.pos;
    const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
    if (d > range + this.player.R) return false;
    if (d < 0.4) return true;
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx * Math.sin(facing) + dz * Math.cos(facing)) / d)));
    return ang <= half + Math.atan2(this.player.R, d);
  }
  playerInCircle(x, z, r) {
    const p = this.player.pos;
    return Math.hypot(p.x - x, p.z - z) < r + this.player.R;
  }
  hurt() { this.combat.hurtPlayer(this.b.pos); }

  // ¿Hay un sólido grande entre dos puntos? Sirve de refugio contra miradas y rayos
  blocked(ax, az, bx, bz) {
    const w = this.ctx.world;
    const near = w.solidsNear(Math.min(ax, bx) - 1, Math.max(ax, bx) + 1, Math.min(az, bz) - 1, Math.max(az, bz) + 1, []);
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(2, Math.ceil(d / 0.7));
    for (let i = 1; i < n; i++) {
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
      const y = this.gy(x, z) + 1.0;
      for (const s of near) {
        if (s.tag === 'tree' || s.tag === 'rail' || s.tag === 'fence' || s.tag === 'obstacle') continue;
        if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1 && y > s.y0 && y < s.y1 && s.y1 - this.gy(x, z) > 1.2) return true;
      }
    }
    return false;
  }

  addSolid(x0, x1, z0, z1, y0, y1, tag = 'wall') {
    const s = { x0, x1, y0, y1, z0, z1, tag, dyn: true, dx: 0, dy: 0, dz: 0, _q: 0, temp: true };
    this.ctx.world.dynSolids.push(s);
    this.solids.push(s);
    return s;
  }
  removeSolid(s) {
    const i = this.ctx.world.dynSolids.indexOf(s);
    if (i >= 0) this.ctx.world.dynSolids.splice(i, 1);
  }
  // Empuja al héroe fuera de un sólido que acaba de aparecer encima
  ejectPlayerFrom(s) {
    const p = this.player.pos, R = this.player.R;
    if (p.x > s.x0 - R && p.x < s.x1 + R && p.z > s.z0 - R && p.z < s.z1 + R && p.y < s.y1 - 0.2) {
      const dl = p.x - s.x0, dr = s.x1 - p.x, db = p.z - s.z0, dt2 = s.z1 - p.z;
      const m = Math.min(dl, dr, db, dt2);
      if (m === dl) p.x = s.x0 - R - 0.05; else if (m === dr) p.x = s.x1 + R + 0.05;
      else if (m === db) p.z = s.z0 - R - 0.05; else p.z = s.z1 + R + 0.05;
    }
  }
}

// Mirada petrificante compartida por Basilisco y Medusa: el héroe acumula "exposición" dentro del cono
// (si no hay refugio en medio); al llenarse queda petrificado y la piedra se desvanece progresivamente.
export class Gaze {
  constructor(atk, { range, half, track, exposure, petrifyT, fade, color }) {
    Object.assign(this, { atk, range, half, track, exposure, petrifyT, fade, color });
    this.exp = 0;
    this.facing = atk.b.facing;
    this.cd = 0;
  }
  headPos() {
    const b = this.atk.b;
    const f = new THREE.Vector3(Math.sin(b.facing), 0, Math.cos(b.facing));
    return new THREE.Vector3(b.pos.x + f.x * b.S.radius * 0.95, this.atk.gy(b.pos.x, b.pos.z) + b.S.height * 0.78 + b.flyHeight, b.pos.z + f.z * b.S.radius * 0.95);
  }
  // Un paso de la mirada activa. Devuelve true si en este paso se ha petrificado al héroe.
  step(dt, dtTrack) {
    const a = this.atk, b = a.b, p = a.player.pos;
    // el cono sigue al héroe con velocidad limitada (se puede esquivar)
    const want = Math.atan2(p.x - b.pos.x, p.z - b.pos.z);
    let d = want - this.facing;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    this.facing += Math.max(-dtTrack, Math.min(dtTrack, d * 2)) * dt;
    b.facing = this.facing;
    const inside = a.playerInCone(b.pos.x, b.pos.z, this.facing, this.half, this.range) && !a.blocked(b.pos.x, b.pos.z, p.x, p.z);
    this.exp = inside ? this.exp + dt : Math.max(0, this.exp - dt * 1.6);
    if (inside && this.exp >= this.exposure) {
      this.exp = 0;
      a.combat.petrifyPlayer(this.petrifyT, this.fade);
      return true;
    }
    return false;
  }
}
