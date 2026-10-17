import * as THREE from 'three';
import { clamp, damp } from './utils.js';
import { terrainH } from './terrain.js';
import { MINIONS } from './skills/config.js';
import { ui } from './ui.js';

// COMBATE COMPARTIDO: objetivos (jefes y esbirros), estados (empuje, ralentizar, inmovilizar, cegar, marcar),
// esbirros ligeros y proyectiles. Lo usan las habilidades de los héroes y los ataques de los jefes.

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);

export const newStatus = () => ({ slow: 0, slowF: 1, root: 0, blind: 0, mark: 0 });

// Reduce los contadores de estado de un objetivo
export function tickStatus(st, dt) {
  st.slow = Math.max(0, st.slow - dt);
  if (st.slow <= 0) st.slowF = 1;
  st.root = Math.max(0, st.root - dt);
  st.blind = Math.max(0, st.blind - dt);
  st.mark = Math.max(0, st.mark - dt);
}

/* ------------------------------------------------------------------ */
/*  Esbirro ligero: se puede atraer, empujar, ralentizar, marcar...    */
/* ------------------------------------------------------------------ */
class Minion {
  constructor(combat, x, z) {
    this.combat = combat;
    this.heavy = false;
    this.radius = MINIONS.radius;
    this.pos = new THREE.Vector3(x, terrainH(x, z), z);
    this.vel = new THREE.Vector3();
    this.hp = MINIONS.hp;
    this.st = newStatus();
    this.pullT = 0;
    this.pullTo = new THREE.Vector3();
    this.pullSpeed = 0;
    this.hitCd = 0;
    this.t = Math.random() * 10;
    this.dead = false;
    const body = new THREE.MeshStandardMaterial({ color: 0x3a2a4a, roughness: 0.6, emissive: 0x2a0a3a, emissiveIntensity: 0.6, flatShading: true });
    const eye = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3a5a).multiplyScalar(2) });
    this.group = new THREE.Group();
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), body);
    b.position.y = 0.55;
    b.castShadow = true;
    this.group.add(b);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), eye); e.position.set(s * 0.17, 0.66, 0.4); this.group.add(e); }
    for (const s of [-1, 1]) { const h = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 6), body); h.position.set(s * 0.26, 1.0, 0); h.rotation.z = -s * 0.4; this.group.add(h); }
    this.markRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 24), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    this.markRing.rotation.x = -Math.PI / 2;
    this.markRing.position.y = 0.1;
    this.markRing.visible = false;
    this.group.add(this.markRing);
    combat.scene.add(this.group);
    this.group.position.copy(this.pos);
  }

  update(dt) {
    const c = this.combat;
    const { player } = c.game;
    this.t += dt;
    tickStatus(this.st, dt);
    this.hitCd = Math.max(0, this.hitCd - dt);
    const slow = this.st.slow > 0 ? this.st.slowF : 1;
    if (this.pullT > 0) {
      // atraído por la lengua / la cola: ignora su IA
      this.pullT -= dt;
      const d = new THREE.Vector3().subVectors(this.pullTo, this.pos);
      d.y = 0;
      const l = d.length();
      if (l > 0.6) this.pos.addScaledVector(d, Math.min(1, (this.pullSpeed * dt) / l));
    } else if (this.st.root <= 0) {
      let dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      if (this.st.blind > 0) { dx = Math.sin(this.t * 2.3) * 3; dz = Math.cos(this.t * 1.9) * 3; } // cegado: deambula
      const k = (MINIONS.speed * slow) / (Math.hypot(dx, dz) || 1);
      this.pos.x += dx * k * dt;
      this.pos.z += dz * k * dt;
    }
    // empuje residual
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.vel.multiplyScalar(Math.max(0, 1 - 4 * dt));
    this.pos.y = terrainH(this.pos.x, this.pos.z);
    // contacto con el héroe
    const dpx = player.pos.x - this.pos.x, dpz = player.pos.z - this.pos.z;
    if (this.hitCd <= 0 && Math.hypot(dpx, dpz) < MINIONS.contact + player.R && Math.abs(player.pos.y - this.pos.y) < 1.8) {
      this.hitCd = 1.4;
      c.game.hitPlayer(1, this.pos);
      const l = Math.hypot(dpx, dpz) || 1;
      player.vx += (dpx / l) * 5; player.vz += (dpz / l) * 5;
    }
    this.group.position.copy(this.pos);
    this.group.position.y += Math.sin(this.t * 5) * 0.08;
    this.group.rotation.y = Math.atan2(dpx, dpz);
    this.markRing.visible = this.st.mark > 0;
    if (this.markRing.visible) this.markRing.rotation.z += dt * 3;
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    const c = this.combat;
    c.vfx.sparks(this.pos.x, this.pos.y + 0.6, this.pos.z, 0xb070ff, 10, 3);
    c.vfx.dust(this.pos.x, this.pos.y + 0.2, this.pos.z, 4, 1.2);
    c.game.addScore(MINIONS.score);
    c.scene.remove(this.group);
  }
}

/* ------------------------------------------------------------------ */
/*  Combat                                                             */
/* ------------------------------------------------------------------ */
export class Combat {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.vfx = game.vfx;
    this.minions = [];
    this.projectiles = [];
    this.lingering = [];
    this.damageMul = 1; // lo sube el Ojo Solar del Lince
    this.spawnT = 0;
    this._stoneAmt = 0;
    this._stoneMats = null;
    this.projGeo = new THREE.SphereGeometry(1, 12, 10);
  }

  reset() {
    for (const m of this.minions) { if (!m.dead) this.scene.remove(m.group); }
    this.minions.length = 0;
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles.length = 0;
    this.clearLingering();
    this.damageMul = 1;
    this.spawnT = 0;
    this.setStone(0);
  }

  /* ---------- objetivos ---------- */
  targets() {
    const out = [];
    const b = this.game.boss;
    if (b && b.state !== 'dead' && b.state !== 'enter') out.push(b);
    for (const m of this.minions) if (!m.dead) out.push(m);
    return out;
  }
  // Objetivos dentro de un círculo (se cuenta el radio del cuerpo)
  inCircle(x, z, r) {
    return this.targets().filter((t) => Math.hypot(t.pos.x - x, t.pos.z - z) < r + t.radius);
  }
  // Objetivos dentro de un cono (ángulo de frente en radianes, medio ángulo, alcance)
  inCone(x, z, facing, half, range) {
    const fx = Math.sin(facing), fz = Math.cos(facing);
    return this.targets().filter((t) => {
      const dx = t.pos.x - x, dz = t.pos.z - z;
      const d = Math.hypot(dx, dz);
      if (d > range + t.radius) return false;
      if (d < 0.01) return true;
      const ang = Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1));
      return ang <= half + Math.atan2(t.radius, Math.max(d, 0.5));
    });
  }
  // El objetivo más cercano dentro del cono de puntería
  aimTarget(x, z, facing, half, range) {
    let best = null, bd = 1e9;
    for (const t of this.inCone(x, z, facing, half, range)) {
      const d = Math.hypot(t.pos.x - x, t.pos.z - z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  /* ---------- efectos sobre objetivos ---------- */
  damage(t, n, { quiet = false } = {}) {
    if (!t || (t.dead)) return;
    const mul = (t.st.mark > 0 ? 1.5 : 1) * this.damageMul;
    if (t.heavy) t.takeDamage(n * mul, quiet);
    else { t.hp -= n; if (t.hp <= 0) t.kill(); }
  }
  push(t, dx, dz, force) {
    const l = Math.hypot(dx, dz) || 1;
    const k = t.heavy ? 0.1 : 1; // los jefes casi no se mueven
    if (t.heavy) { t.kbx = (t.kbx || 0) + (dx / l) * force * k; t.kbz = (t.kbz || 0) + (dz / l) * force * k; }
    else { t.vel.x += (dx / l) * force; t.vel.z += (dz / l) * force; }
  }
  slow(t, f, s) {
    const sec = t.heavy ? s * 0.7 : s;
    t.st.slow = Math.max(t.st.slow, sec);
    t.st.slowF = Math.min(t.st.slowF, t.heavy ? Math.max(f, 0.55) : f);
  }
  root(t, s) { t.st.root = Math.max(t.st.root, t.heavy ? s * 0.5 : s); }
  blind(t, s) { t.st.blind = Math.max(t.st.blind, s); }
  mark(t, s) { t.st.mark = Math.max(t.st.mark, s); }
  // Atrae a un esbirro ligero hasta un punto (los pesados no se pueden atraer)
  pull(t, toPos, speed, secs = 0.5) {
    if (t.heavy) return false;
    t.pullTo.copy(toPos); t.pullSpeed = speed; t.pullT = secs;
    return true;
  }

  /* ---------- efectos sobre el héroe ---------- */
  hurtPlayer(from) { this.game.hitPlayer(1, from); }
  slowPlayer(f, s) { const p = this.game.player; p.slowT = Math.max(p.slowT, s); p.slowF = Math.min(p.slowF, f); }
  petrifyPlayer(s, fade = 1) { const p = this.game.player; if (p.petrifyT > 0.3 || p.shieldT > 0) return; p.petrifyT = s; p.petrifyFade = fade; ui.banner('find', '🗿 ¡Petrificado!', 'No puedes moverte unos segundos'); }
  pushPlayer(dx, dz, force) { const p = this.game.player; const l = Math.hypot(dx, dz) || 1; p.vx += (dx / l) * force; p.vz += (dz / l) * force; }
  // Tirón continuo (m/s) mientras se llame cada fotograma: remolino, ráfagas de viento
  dragPlayer(dx, dz, speed) { const p = this.game.player; const l = Math.hypot(dx, dz) || 1; p.driftX += (dx / l) * speed; p.driftZ += (dz / l) * speed; }

  /* ---------- objetos que sobreviven al ataque que los creó (muros, estatuas...) ---------- */
  // obj: { life, update?(dt), end() } — se retiran solos al agotarse la vida o al limpiar el combate
  linger(obj) { this.lingering.push(obj); return obj; }
  clearLingering() {
    for (const o of this.lingering) o.end();
    this.lingering.length = 0;
  }

  // Piedra: oscurece y apaga el color del modelo del héroe (amt 0..1) — desaparece progresivamente al terminar
  setStone(amt) {
    const model = this.game.player && this.game.player.model;
    if (!model) return;
    if (!this._stoneMats || this._stoneModel !== model) {
      this._stoneModel = model;
      this._stoneMats = [];
      model.root.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m.color) continue;
          if (!m.userData.stoneBase) m.userData.stoneBase = { c: m.color.clone(), r: m.roughness, mt: m.metalness };
          this._stoneMats.push(m);
        }
      });
    }
    if (Math.abs(amt - this._stoneAmt) < 0.004) return;
    this._stoneAmt = amt;
    const stone = new THREE.Color(0.46, 0.46, 0.5);
    for (const m of this._stoneMats) {
      const b = m.userData.stoneBase;
      m.color.copy(b.c).lerp(stone, amt);
      if (m.roughness !== undefined) m.roughness = b.r + (1 - b.r) * amt;
      if (m.metalness !== undefined) m.metalness = b.mt * (1 - amt);
    }
  }

  /* ---------- esbirros ---------- */
  spawnMinions(n, around) {
    const b = this.game.boss;
    const arena = b ? b.arena : { x: around.x, z: around.z, r: 12 };
    for (let i = 0; i < n && this.minions.filter((m) => !m.dead).length < MINIONS.max; i++) {
      const a = Math.random() * TAU, r = arena.r * rnd(0.55, 0.95);
      const m = new Minion(this, arena.x + Math.cos(a) * r, arena.z + Math.sin(a) * r);
      this.minions.push(m);
      this.vfx.sparks(m.pos.x, m.pos.y + 0.5, m.pos.z, 0xb070ff, 8, 2.5);
    }
  }

  /* ---------- proyectiles ---------- */
  // owner: 'boss' (daña al héroe) | 'hero' (daña a los enemigos). light = se puede desviar con viento.
  fire({ pos, vel, radius = 0.6, color = 0xb070ff, life = 4, owner = 'boss', light = true, homing = 0, damage = 8 }) {
    const mesh = new THREE.Mesh(this.projGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2) }));
    mesh.scale.setScalar(radius);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    const halo = new THREE.Mesh(this.projGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(1.9);
    mesh.add(halo);
    const p = { mesh, pos: mesh.position, vel: vel.clone(), radius, life, owner, light, homing, damage, color, dead: false };
    this.projectiles.push(p);
    return p;
  }
  // Desvía los proyectiles ligeros que haya dentro de un círculo (los devuelve contra los enemigos)
  deflect(x, z, r) {
    let n = 0;
    for (const p of this.projectiles) {
      if (p.dead || !p.light || p.owner !== 'boss') continue;
      if (Math.hypot(p.pos.x - x, p.pos.z - z) < r) {
        p.vel.multiplyScalar(-1);
        p.owner = 'hero';
        p.life = Math.max(p.life, 2.5);
        this.vfx.sparks(p.pos.x, p.pos.y, p.pos.z, 0xffe9a0, 8, 2);
        n++;
      }
    }
    return n;
  }
  killProjectile(p) {
    p.dead = true;
    this.scene.remove(p.mesh);
    this.vfx.sparks(p.pos.x, p.pos.y, p.pos.z, p.color, 8, 2.4);
  }

  /* ---------- actualización ---------- */
  update(dt) {
    const g = this.game;
    const { player } = g;
    // esbirros: aparecen mientras dura el combate de jefe
    if (g.boss && g.boss.state !== 'dead' && g.boss.state !== 'enter') {
      this.spawnT += dt;
      if (this.spawnT >= (this.firstDone ? MINIONS.spawnEvery : MINIONS.firstAt)) {
        this.spawnT = 0;
        this.firstDone = true;
        this.spawnMinions(g.boss.phase >= 2 ? 2 : 1, player.pos);
      }
    } else { this.spawnT = 0; this.firstDone = false; }
    for (let i = this.minions.length - 1; i >= 0; i--) {
      const m = this.minions[i];
      if (m.dead) { this.minions.splice(i, 1); continue; }
      m.update(dt);
    }
    for (let i = this.lingering.length - 1; i >= 0; i--) {
      const o = this.lingering[i];
      o.life -= dt;
      if (o.update) o.update(dt);
      if (o.life <= 0) { o.end(); this.lingering.splice(i, 1); }
    }
    // proyectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.dead) { this.projectiles.splice(i, 1); continue; }
      p.life -= dt;
      if (p.homing > 0 && p.owner === 'boss') {
        const dx = player.pos.x - p.pos.x, dz = player.pos.z - p.pos.z, dy = player.pos.y + player.H * 0.5 - p.pos.y;
        const l = Math.hypot(dx, dz, dy) || 1, sp = p.vel.length();
        p.vel.x += (dx / l) * sp * p.homing * dt * 2; p.vel.z += (dz / l) * sp * p.homing * dt * 2; p.vel.y += (dy / l) * sp * p.homing * dt * 2;
        p.vel.setLength(sp);
      }
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.rotation.y += dt * 4;
      if (p.life <= 0 || Math.abs(p.pos.x) > 130 || Math.abs(p.pos.z) > 130) { this.killProjectile(p); continue; }
      const gy = terrainH(p.pos.x, p.pos.z);
      if (p.pos.y < gy + 0.1) { this.killProjectile(p); continue; }
      if (p.owner === 'boss') {
        const dx = player.pos.x - p.pos.x, dz = player.pos.z - p.pos.z, dy = player.pos.y + player.H * 0.5 - p.pos.y;
        if (Math.hypot(dx, dz) < p.radius + player.R && Math.abs(dy) < player.H * 0.6 + p.radius) { this.killProjectile(p); g.hitPlayer(1, p.pos); }
      } else {
        for (const t of this.targets()) {
          if (Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) < t.radius + p.radius) { this.damage(t, t.heavy ? 8 : 2, { quiet: false }); this.killProjectile(p); break; }
        }
      }
    }
    // piedra del héroe (petrificado)
    if (player.petrifyT > 0) this.setStone(player.petrifyT > player.petrifyFade ? 1 : player.petrifyT / player.petrifyFade);
    else if (this._stoneAmt > 0) this.setStone(0);
  }
}
