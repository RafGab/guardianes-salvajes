import * as THREE from 'three';
import { terrainH } from './terrain.js';
import { clamp, damp, TAU } from './utils.js';
import { pathPoint } from './scenarios/common.js';
import { HEALTH, DESTRUCTIBLE } from './skills/config.js';

const rnd = (a, b) => a + Math.random() * (b - a);

/* ======================================================================
   ROCKSLIDE · desprendimientos de roca
   · Cada cierto tiempo la montaña se desprende: aviso, temblor y nubes de polvo en lo alto de los canales.
   · Las rocas bajan RODANDO por los canales de las pedreras (aceleran con la pendiente, botan, giran y
     levantan polvo) hasta el fondo del valle, donde frenan y se quedan como bloques que cortan el paso
     (se pueden romper con las armas y los poderes; desaparecen al rato).
   · Si una roca alcanza al héroe le hace daño y lo empuja (el escudo la desvía).
   · Entre desprendimientos caen piedras sueltas por los canales.
   · El poder de Tierra frena y rompe las rocas que ruedan cerca del héroe.
   ====================================================================== */
export class RockslideHazard {
  constructor(ctx) {
    this.ctx = ctx;
    this.lanes = (ctx.sc && ctx.sc.rockLanes) || [];
    // longitud de cada canal (para recorrerlo a velocidad real)
    this.len = this.lanes.map((L) => { let s = 0; for (let i = 1; i < L.length; i++) s += Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]); return s; });
    const hz = ctx.hz || 1;
    this.waves = [14, 52, 94, 138, 184, 232, 282, 330].map((t, i) => ({ t: Math.round(t / Math.max(0.8, hz)), dur: 8 + Math.min(4, i), int: Math.min(1, 0.55 + i * 0.08) }));
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.mats = [0x6b6c76, 0x5c5d66, 0x7a7b84].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, flatShading: true }));
    this.geos = [0, 1, 2].map((s) => {
      const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 0.8 + 0.4 * Math.abs(Math.sin(v.x * 7.1 + s * 3 + v.y * 5.3 + v.z * 9.7)); p.setXYZ(i, v.x * k, v.y * k * 0.9, v.z * k); }
      g.computeVertexNormals();
      return g;
    });
    this.reset();
  }

  reset() {
    for (const b of this.rocks || []) this.removeRock(b);
    this.rocks = [];
    this.started = new Set();
    this.active = null;
    this.acc = 0;
    this.pebT = 4;
    this.shake = 0;
    this.t = 0;
  }

  urgentAt() { return false; }

  gauge() {
    if (this.active) return { label: 'ROCAS', pct: this.shake, text: '¡DESPRENDIMIENTO!', danger: true, color: '#9a9ca8' };
    const next = this.waves.find((w) => !this.started.has(w.t));
    const tt = next ? next.t - this.t : 0;
    return { label: 'ROCAS', pct: next ? clamp(1 - tt / 45, 0, 1) : 0, text: next ? `${Math.max(0, Math.ceil(tt))} s` : 'Calma', danger: false, color: '#9a9ca8' };
  }

  // El poder de Tierra frena y rompe las rocas que ruedan cerca
  onPower(type, pos, hero) {
    if (!hero || hero.element !== 'tierra') return;
    for (const b of [...this.rocks]) if (!b.rest && Math.hypot(b.x - pos.x, b.z - pos.z) < 10) this.breakRock(b);
  }

  spawnRock(li, size) {
    if (this.rocks.length > 40) this.removeRock(this.rocks.shift());
    const L = this.lanes[li];
    const mesh = new THREE.Mesh(this.geos[Math.floor(Math.random() * 3)], this.mats[Math.floor(Math.random() * 3)]);
    mesh.scale.setScalar(size);
    mesh.castShadow = true;
    this.group.add(mesh);
    const b = { li, s: 0, v: rnd(2, 4), size, off: rnd(-1.6, 1.6), mesh, x: L[0][0], z: L[0][1], y: terrainH(L[0][0], L[0][1]) + size, hop: 0, vy: 0, rest: false, age: 0, dirx: 0, dirz: 1, run: 0 };
    this.rocks.push(b);
    return b;
  }

  removeRock(b) {
    if (b.prop) { b.prop.dead = true; this.ctx.game.combat.removeProp(b.prop); }
    if (b.solid) { const i = this.ctx.world.dynSolids.indexOf(b.solid); if (i >= 0) this.ctx.world.dynSolids.splice(i, 1); }
    this.group.remove(b.mesh);
  }

  breakRock(b) {
    const i = this.rocks.indexOf(b);
    if (i >= 0) this.rocks.splice(i, 1);
    this.removeRock(b);
    for (let q = 0; q < 10; q++) { this.ctx.fx.rock(b.x, b.y, b.z); if (q % 3 === 0) this.ctx.fx.dustPuff(b.x, b.y, b.z, 1.8); }
  }

  update(dt, t) {
    this.t = t;
    const { ctx } = this;
    const { player, chase, fx, audio, ui } = ctx;
    if (!this.lanes.length) return;
    const P = player.pos;
    // ¿empieza un desprendimiento?
    for (const w of this.waves) {
      if (t >= w.t && !this.started.has(w.t)) {
        this.started.add(w.t);
        const idx = this.waves.indexOf(w);
        // canales cercanos al héroe (y alguno al azar): así se ven y obligan a esquivar
        const order = this.lanes.map((L, i) => [i, Math.min(...L.map((p) => Math.hypot(p[0] - P.x, p[1] - P.z)))]).sort((a, b) => a[1] - b[1]);
        const pick = new Set(order.slice(0, 2 + Math.min(2, idx >> 1)).map((o) => o[0]));
        pick.add(Math.floor(Math.random() * this.lanes.length));
        this.active = { ...w, end: w.t + w.dur, lanes: [...pick] };
        ui.alert(w.int > 0.85 ? '⛰️ ¡GRAN DESPRENDIMIENTO! ¡Aléjate de las laderas!' : '⛰️ ¡DESPRENDIMIENTO DE ROCAS! ¡No te quedes en los canales!', 5000);
        audio.rumble();
        audio.alert();
        if (idx === 0) ctx.tip('start');
        if (idx === 1) ctx.tip('listen');
        if (idx === 3) ctx.tip('after');
        // polvo en lo alto de los canales: el aviso de lo que viene
        for (const li of this.active.lanes) { const [x, z] = this.lanes[li][0]; for (let q = 0; q < 8; q++) fx.dustPuff(x + rnd(-4, 4), terrainH(x, z) + rnd(0, 3), z + rnd(-4, 4), 3); }
      }
    }
    let intensity = 0;
    const a = this.active;
    if (a) {
      const k = (t - a.t) / a.dur;
      intensity = a.int * Math.sin(clamp(k, 0, 1) * Math.PI) ** 0.5;
      this.acc += dt * (1.2 + a.int * 1.6);
      while (this.acc > 1) {
        this.acc -= 1;
        const li = a.lanes[Math.floor(Math.random() * a.lanes.length)];
        this.spawnRock(li, rnd(0.7, 1.4) * (0.8 + a.int * 0.6));
      }
      if (t >= a.end) this.active = null;
    } else {
      // piedras sueltas entre desprendimientos
      this.pebT -= dt;
      if (this.pebT <= 0) { this.pebT = rnd(4, 8); this.spawnRock(Math.floor(Math.random() * this.lanes.length), rnd(0.35, 0.6)); }
    }
    this.shake = damp(this.shake, intensity, 5, dt);
    if (intensity > 0.05) {
      chase.shake(0.18 * intensity);
      if (Math.random() < dt * 3) audio.noiseBurst(0.6, 110, 0.22, 'lowpass');
    }
    ui.setOverlay('dust', this.shake * 0.35);
    // rocas que ruedan
    const q = new THREE.Vector3();
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const b = this.rocks[i];
      b.age += dt;
      if (b.rest) {
        if (b.age > 28) { this.removeRock(b); this.rocks.splice(i, 1); }
        continue;
      }
      const L = this.lanes[b.li], len = this.len[b.li];
      let x, z;
      if (b.s < len) {
        // por el canal: la pendiente la acelera
        const t0 = b.s / len, [x0, z0] = pathPoint(L, t0), [x1, z1] = pathPoint(L, Math.min(1, t0 + 0.02));
        const dx = x1 - x0, dz = z1 - z0, dl = Math.hypot(dx, dz) || 1;
        b.dirx = dx / dl; b.dirz = dz / dl;
        const drop = terrainH(x0, z0) - terrainH(x1, z1);
        b.v = Math.min(19, b.v + clamp(drop / dl, -1, 3) * 9 * dt + dt);
        b.s += b.v * dt;
        x = x0 - b.dirz * b.off; z = z0 + b.dirx * b.off;
      } else {
        // en el fondo del valle: sigue rodando y frena
        b.v = Math.max(0, b.v - 7 * dt);
        b.run += b.v * dt;
        const [xe, ze] = L[L.length - 1];
        x = xe - b.dirz * b.off + b.dirx * b.run; z = ze + b.dirx * b.off + b.dirz * b.run;
        if (b.v <= 0.05) {
          b.rest = true; b.age = 0;
          const gy = terrainH(x, z);
          b.y = gy + b.size * 0.75; b.mesh.position.y = b.y;
          if (b.size > 0.8) {
            b.solid = { x0: x - b.size * 0.75, x1: x + b.size * 0.75, y0: gy - 1, y1: gy + b.size * 1.5, z0: z - b.size * 0.75, z1: z + b.size * 0.75, tag: 'rubble', dyn: true, dx: 0, dy: 0, dz: 0, _q: 0 };
            ctx.world.dynSolids.push(b.solid);
            b.prop = ctx.game.combat.addProp({ x, y: gy, z, radius: b.size * 0.9, hp: DESTRUCTIBLE.debris, height: b.size * 1.5, label: 'Roca', mesh: b.mesh, onBreak: () => this.breakRock(b) });
          }
          continue;
        }
      }
      b.x = x; b.z = z;
      // botes por el terreno irregular
      const gy = terrainH(x, z) + b.size * 0.8;
      if (b.y <= gy + 0.01 && Math.random() < dt * 3 * (b.v / 19)) b.vy = rnd(2, 5);
      b.vy -= 22 * dt;
      b.y = Math.max(gy, b.y + b.vy * dt);
      if (b.y <= gy) { b.vy = 0; if (b.v > 6 && Math.random() < dt * 6) fx.rock(x, gy, z); }
      b.mesh.position.set(x, b.y, z);
      // gira sobre el eje perpendicular a su avance
      q.set(b.dirz, 0, -b.dirx);
      b.mesh.rotateOnWorldAxis(q, (b.v / b.size) * dt);
      if (Math.random() < dt * 5 * Math.min(1, b.v / 8)) fx.dustPuff(x - b.dirx * b.size, gy - b.size * 0.6, z - b.dirz * b.size, 1.4 + b.size);
      // ¿alcanza al héroe?
      const hx = x - P.x, hz = z - P.z;
      if (!b.hitDone && b.size > 0.5 && b.v > 2.5 && Math.hypot(hx, hz) < b.size * 0.9 + 0.5 && Math.abs(b.y - (P.y + 1)) < b.size + 1.2) {
        b.hitDone = true;
        if (ctx.game.shielded) {
          ctx.game.shieldBlock({ x, z });
          this.breakRock(b); continue;
        }
        player.vx = b.dirx * 10 - b.dirz * 4; player.vz = b.dirz * 10 + b.dirx * 4; player.vy = Math.max(player.vy, 5);
        chase.shake(0.45);
        audio.noiseBurst(0.35, 260, 0.45, 'lowpass');
        if (ctx.game.hurtHero(HEALTH.debris * (b.size > 1.1 ? 1.5 : 1), { from: { x, z }, label: '🪨 ¡Roca rodando!', sub: 'No te quedes en los canales de las pedreras · usa un escudo' })) player.crushT = 0.75; // la roca lo aplasta
      }
    }
  }

  dispose() {
    this.reset();
    this.ctx.scene.remove(this.group);
  }
}
