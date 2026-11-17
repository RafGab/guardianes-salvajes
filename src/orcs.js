import * as THREE from 'three';
import { Soldier } from './soldier.js';
import { terrainH, CFG } from './terrain.js';
import { NPC_KINDS } from './skills/config.js';

/* ======================================================================
   ORCOS DE LOS TABLEROS
   Campamentos de orcos (el modelo 3D del soldado, public/models/props/soldado.glb) repartidos por algunos
   mundos. Cada orco usa el mismo esqueleto, animaciones, barra de vida, reacción al daño y derrota que los
   soldados del jefe (soldier.js), así que todas las armas y poderes de los héroes les afectan igual, cada uno
   con su propio efecto.
   · Patrullan alrededor de su campamento; si el héroe entra en su rango (AGGRO) le persiguen y le atacan.
   · Si el héroe se aleja mucho de su campamento (LEASH), vuelven a patrullar.
   · Aurora Polar (Kira): los orcos alcanzados se quedan congelados (no se mueven ni atacan) y al terminar
     siguen como antes si les queda vida.
   ====================================================================== */
// campamentos por mundo (solo en algunos tableros)
export const ORC_WORLDS = { sandstorm: 2, quake: 2, rockslide: 3, fire: 2, extreme: 3 };
const AGGRO = 11, LEASH = 26;
const rnd = (a, b) => a + Math.random() * (b - a);
const SKIP = new Set(['tree', 'rail', 'fence', 'obstacle']);

class Orc extends Soldier {
  constructor(combat, x, z, cat, home) {
    super(combat, x, z, cat, { accent: 0xff4a3a, kind: cat === NPC_KINDS.orcoJefe ? 'bruto' : 'orco', glb: 'soldado' });
    this.orc = true;
    this.home = home;
    this.aggro = false;
    this.frozenUntil = 0;
    this.patrol = new THREE.Vector3(x, 0, z);
    this.patrolT = rnd(0, 3);
    this.state = 'move';
    this.ice = null;
  }
  get frozen() { return performance.now() < this.frozenUntil; }
  // CONGELADO (Aurora Polar): no se mueve ni ataca durante `secs` segundos reales, cubierto de hielo
  // (el bloque de hielo, los cristales de los pies y el resplandor azul los pone la congelación general: freeze.js)
  freeze(secs) {
    if (this.dead) return;
    this.thawed = false;
    this.frozenUntil = Math.max(this.frozenUntil, performance.now() + secs * 1000);
    if (this.state === 'windup' || this.state === 'strike') this.setState('move');
    const vfx = this.combat.vfx;
    if (vfx.ice) vfx.ice(this.pos.x, this.pos.y + 0.6, this.pos.z, 6);
  }
  target() {
    const g = this.combat.game, p = g.player;
    if (this.aggro && p) return super.target();
    return { pos: this.patrol, R: 0, patrol: true };
  }
  update(dt) {
    if (this.dead) return;
    const g = this.combat.game, p = g.player;
    // congelado: inmóvil y sin atacar (el hielo se va al terminar)
    if (this.frozen) { this.speed = 0; this.flash = 0; this.group.position.copy(this.pos); return; }
    if (this.frozenUntil && !this.thawed) { this.thawed = true; this.st.slow = Math.max(this.st.slow, 0.9); this.st.slowF = Math.min(this.st.slowF, 0.4); } // recupera el movimiento poco a poco
    // detección del héroe
    if (p && g.state === 'playing') {
      const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z), dh = Math.hypot(p.pos.x - this.home.x, p.pos.z - this.home.z);
      if (!this.aggro && (d < AGGRO || this.hp < this.hpMax) && dh < LEASH) {
        this.aggro = true; this.atkCd = Math.max(this.atkCd, 0.5);
        if (g.floatAt) g.floatAt(this.pos, this.barH + 0.5, '¡!', 'big');
        for (const o of this.combat.orcs) if (o !== this && !o.dead && o.home === this.home) o.aggro = true; // avisa a su campamento
      } else if (this.aggro && (dh > LEASH + 6 || d > LEASH)) { this.aggro = false; this.hp = Math.min(this.hpMax, this.hp + this.hpMax * 0.3); }
    } else this.aggro = false;
    // patrulla tranquila alrededor del campamento
    if (!this.aggro) {
      this.patrolT -= dt;
      if (this.patrolT <= 0) { this.patrolT = rnd(3, 6); const a = rnd(0, Math.PI * 2), r = rnd(1, 5); this.patrol.set(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r); }
      this.atkCd = Math.max(this.atkCd, 0.4); // patrullando no ataca
      this.st.slow = Math.max(this.st.slow, 0.1); this.st.slowF = Math.min(this.st.slowF, 0.35); // camina despacio
    }
    super.update(dt);
  }
  // DERROTA: además de caer y desvanecerse, se rompe en fragmentos
  kill() {
    if (this.dead) return;
    const fx = this.combat.game.fx;
    if (fx && !this.iced) for (let i = 0; i < 8; i++) fx.rock(this.pos.x + rnd(-0.4, 0.4), this.pos.y + rnd(0.4, 1.4), this.pos.z + rnd(-0.4, 0.4));
    if (this.combat.vfx.dust) this.combat.vfx.dust(this.pos.x, this.pos.y + 0.5, this.pos.z, 8, 1.6);
    if (this.ice) this.ice.visible = false;
    super.kill();
  }
}

// Coloca los campamentos de orcos del mundo actual (lejos del inicio, en terreno firme y despejado)
export function spawnOrcs(game) {
  const combat = game.combat, w = game.world, id = game.mission && game.mission.id;
  const n = ORC_WORLDS[id];
  if (!n) return;
  const S = CFG.START, tmp = [], camps = [];
  const victims = game.victims || [];
  for (let tries = 0; tries < 600 && camps.length < n; tries++) {
    const a = Math.random() * Math.PI * 2, r = rnd(24, 78);
    const x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r;
    if (Math.abs(x) > 100 || Math.abs(z) > 100) continue;
    const th = terrainH(x, z);
    if (w.hasWater && th < w.waterY + 0.3) continue;
    let flat = true;
    for (const [ox, oz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) if (Math.abs(terrainH(x + ox, z + oz) - th) > 1.4) flat = false;
    if (!flat) continue;
    if (w.solidsNear && w.solidsNear(x - 3.5, x + 3.5, z - 3.5, z + 3.5, tmp).some((s) => !SKIP.has(s.tag) && s.y1 > th + 0.3 && s.y0 < th + 2)) continue;
    if (camps.some((c) => Math.hypot(c.x - x, c.z - z) < 26)) continue;
    if (victims.some((v) => v.root && Math.hypot(v.root.position.x - x, v.root.position.z - z) < 9)) continue;
    camps.push(new THREE.Vector3(x, th, z));
  }
  camps.forEach((home, ci) => {
    const count = 2 + (ci % 2);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rnd(0, 0.6), r = rnd(1.2, 2.6);
      const cat = i === count - 1 && count === 3 ? NPC_KINDS.orcoJefe : NPC_KINDS.orco;
      const o = new Orc(combat, home.x + Math.cos(a) * r, home.z + Math.sin(a) * r, cat, home);
      o.facing = Math.random() * Math.PI * 2;
      combat.orcs.push(o);
    }
  });
}
