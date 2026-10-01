import * as THREE from 'three';
import { clamp, damp, lerp, TAU } from './utils.js';

/* ------------------------------------------------------------------ */
/*  Modelos procedurales de jefes (sencillos: sin rig de animación     */
/*  completo, solo grupos que se rotan/escala directamente)            */
/* ------------------------------------------------------------------ */
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...o });
const glow = (hex, k = 2.4) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 10);
const cone = (r, h) => new THREE.ConeGeometry(r, h, 8);
const sph = (r) => new THREE.SphereGeometry(r, 16, 12);
const M = (geo, mat, parent, o = {}) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(o.x || 0, o.y || 0, o.z || 0);
  m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
  m.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  m.castShadow = true;
  m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
};

/* ---- Minotauro: guardián de la tierra ---- */
function buildMinotauroModel() {
  const stone = std(0x8a7c5a, { roughness: 0.95 });
  const moss = std(0x4a6a34, { roughness: 1 });
  const dark = std(0x2a2420, { roughness: 0.8 });
  const horn = std(0xd8c8a0, { roughness: 0.5, metalness: 0.1 });
  const eye = glow(0xff8a1a, 2.6);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = 1.5;
  body.add(hips);
  M(cap(0.75, 1.0), stone, hips, { y: 0.55 });
  M(sph(0.9), moss, hips, { y: 0.1, sy: 0.6, sz: 1.1 });
  const torso = new THREE.Group();
  torso.position.y = 1.5;
  hips.add(torso);
  M(cap(0.85, 1.1), stone, torso, { y: 0.2 });
  M(sph(0.5), moss, torso, { y: 0.7, sz: 1.2 });

  const head = new THREE.Group();
  head.position.y = 1.55;
  torso.add(head);
  M(box(0.85, 0.75, 0.75), stone, head, { y: 0 });
  M(box(0.5, 0.3, 0.25), dark, head, { y: -0.1, z: 0.45 });
  M(sph(0.1), eye, head, { x: 0.22, y: 0.08, z: 0.4 });
  M(sph(0.1), eye, head, { x: -0.22, y: 0.08, z: 0.4 });
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(cone(0.14, 0.95), horn);
    h.position.set(s * 0.32, 0.45, -0.05);
    h.rotation.set(0.3, 0, s * 0.55);
    h.castShadow = true;
    head.add(h);
  }
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.95, 0.55, 0);
    torso.add(sh);
    M(cap(0.26, 0.75), stone, sh, { y: -0.4 });
    const el = new THREE.Group();
    el.position.y = -0.85;
    sh.add(el);
    M(cap(0.22, 0.7), moss, el, { y: -0.38 });
    const fist = M(sph(0.3), dark, el, { y: -0.78 });
    arms.push({ sh, el, fist, side: s });
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const hj = new THREE.Group();
    hj.position.set(s * 0.4, -0.3, 0);
    hips.add(hj);
    M(cap(0.3, 0.8), stone, hj, { y: -0.45 });
    const kj = new THREE.Group();
    kj.position.y = -0.9;
    hj.add(kj);
    M(cap(0.26, 0.75), moss, kj, { y: -0.4 });
    M(box(0.45, 0.22, 0.6), dark, kj, { y: -0.84, z: 0.1 });
    legs.push({ hj, kj, side: s });
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.4, -0.7);
  hips.add(tail);
  M(cap(0.14, 0.6), moss, tail, { y: -0.3, rx: 0.6 });

  root.scale.setScalar(1.55);
  return { root, body, head, arms, legs, hips, torso, mats: { stone, moss, eye } };
}

/* ------------------------------------------------------------------ */
/*  Clase genérica de jefe: máquina de estados + combate               */
/* ------------------------------------------------------------------ */
const rnd = (a, b) => a + Math.random() * (b - a);

export class Minotauro {
  constructor(ctx, arena) {
    this.kind = 'minotauro';
    this.name = 'Minotauro';
    this.ctx = ctx;
    this.arena = arena; // { x, z, r }
    this.model = buildMinotauroModel();
    ctx.scene.add(this.model.root);
    this.pos = new THREE.Vector3(arena.x, this.groundY(arena.x, arena.z), arena.z - arena.r * 0.6);
    this.facing = 0;
    this.hpMax = 100;
    this.hp = this.hpMax;
    this.phase = 1;
    this.state = 'enter';
    this.t = 0;
    this.stateT = 0;
    this.cd = 1.6;
    this.invuln = 0.6;
    this.hitFlash = 0;
    this.telegraph = null; // { kind, group }
    this.deathT = 0;
    this.ring = null;

    const ringGeo = new THREE.RingGeometry(0.1, 1, 40);
    this.ringMesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff4a1a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.ringMesh.rotation.x = -Math.PI / 2;
    ctx.scene.add(this.ringMesh);
    this.ringMesh.visible = false;

    const arrowGeo = new THREE.ConeGeometry(0.6, 1.8, 4);
    this.arrowMesh = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0xff3a1a, transparent: true, opacity: 0.8 }));
    this.arrowMesh.rotation.x = Math.PI / 2;
    ctx.scene.add(this.arrowMesh);
    this.arrowMesh.visible = false;

    ctx.ui.alert('👹 ¡El Minotauro bloquea la salida!', 4000);
    ctx.ui.banner('find', '👹 Usa tu poder (Q) cerca de él para golpearlo', 'Esquiva sus embestidas y evita sus golpes de tierra');
  }

  groundY(x, z) {
    return this.ctx.world.groundY ? this.ctx.world.groundY(x, z) : 0;
  }

  urgentAt() {
    return false;
  }

  gauge() {
    return { label: this.name.toUpperCase(), pct: clamp(this.hp / this.hpMax, 0, 1), text: this.state === 'dead' ? 'Derrotado' : `${Math.ceil((this.hp / this.hpMax) * 100)}%`, danger: this.state !== 'dead', color: '#ff8a1a', isBoss: true };
  }

  onPlayerAttack(ppos) {
    if (this.state === 'dead' || this.state === 'enter' || this.invuln > 0) return false;
    const d = Math.hypot(ppos.x - this.pos.x, ppos.z - this.pos.z);
    if (d > 4.6) return false;
    this.takeDamage(12, ppos);
    return true;
  }

  takeDamage(n, fromPos) {
    if (this.state === 'dead') return;
    this.hp = Math.max(0, this.hp - n);
    this.hitFlash = 0.25;
    this.invuln = 0.35;
    this.ctx.chase.shake(0.18);
    this.ctx.audio.noiseBurst(0.2, 260, 0.35, 'lowpass');
    for (let i = 0; i < 10; i++) this.ctx.fx.dustPuff(this.pos.x + rnd(-0.6, 0.6), this.pos.y + 1.2, this.pos.z + rnd(-0.6, 0.6), 1.4);
    this.ctx.fx.rock(this.pos.x, this.pos.y + 1.4, this.pos.z);
    this.ctx.game.addScore(15);
    const newPhase = this.hp <= this.hpMax * 0.33 ? 3 : this.hp <= this.hpMax * 0.66 ? 2 : 1;
    if (newPhase !== this.phase) {
      this.phase = newPhase;
      this.state = 'enrage';
      this.stateT = 0;
      this.invuln = 1.0;
      this.ctx.ui.alert(newPhase === 3 ? '👹 ¡El Minotauro ruge con furia final!' : '👹 ¡El Minotauro se enfurece!', 2600);
      this.ctx.audio.alert();
    }
    if (this.hp <= 0) {
      this.state = 'dead';
      this.deathT = 0;
      this.ctx.ui.banner('good', '🏆 ¡Minotauro derrotado!', 'El camino está libre');
      this.ctx.audio.success();
    }
  }

  // Elige al azar el siguiente ataque según la fase
  pickAttack() {
    const r = Math.random();
    return r < 0.55 ? 'charge' : 'slam';
  }

  update(dt) {
    const { ctx } = this;
    const { player } = ctx;
    this.t += dt;
    this.stateT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    const speedMul = 0.85 + (this.phase - 1) * 0.22;

    const faceTo = (x, z) => {
      this.facing = damp(this.facing, Math.atan2(x - this.pos.x, z - this.pos.z), 6, dt);
    };

    if (this.state === 'dead') {
      this.deathT += dt;
      this.model.root.position.y = -Math.min(1.6, this.deathT * 0.6);
      this.model.root.rotation.z = Math.min(1.1, this.deathT * 0.9);
      this.ringMesh.visible = false;
      this.arrowMesh.visible = false;
      this.syncTransform();
      return;
    }

    if (this.state === 'enter') {
      const tz = this.arena.z - this.arena.r * 0.15;
      this.pos.z = damp(this.pos.z, tz, 2.4, dt);
      faceTo(player.pos.x, player.pos.z);
      if (Math.abs(this.pos.z - tz) < 0.3) { this.state = 'idle'; this.stateT = 0; this.cd = 1.4; }
      this.syncTransform();
      return;
    }

    if (this.state === 'enrage') {
      if (this.stateT > 0.9) { this.state = 'idle'; this.stateT = 0; this.cd = 0.6; }
      faceTo(player.pos.x, player.pos.z);
      this.syncTransform();
      return;
    }

    if (this.state === 'idle') {
      faceTo(player.pos.x, player.pos.z);
      // deambula ligeramente hacia el jugador sin salir del arena
      const d = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      if (d > 7) {
        const nx = (player.pos.x - this.pos.x) / d, nz = (player.pos.z - this.pos.z) / d;
        this.pos.x += nx * 2.2 * speedMul * dt;
        this.pos.z += nz * 2.2 * speedMul * dt;
      }
      this.cd -= dt;
      if (this.cd <= 0) {
        const kind = this.pickAttack();
        this.state = kind === 'charge' ? 'tg_charge' : 'tg_slam';
        this.stateT = 0;
        this.targetPos = new THREE.Vector3(player.pos.x, 0, player.pos.z);
      }
      this.syncTransform();
      return;
    }

    if (this.state === 'tg_charge') {
      faceTo(this.targetPos.x, this.targetPos.z);
      const dur = 1.1 - (this.phase - 1) * 0.15;
      this.arrowMesh.visible = true;
      const ang = Math.atan2(this.targetPos.x - this.pos.x, this.targetPos.z - this.pos.z);
      const mid = new THREE.Vector3(this.pos.x, this.groundY(this.pos.x, this.pos.z) + 0.4, this.pos.z).addScaledVector(new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)), 3.2);
      this.arrowMesh.position.copy(mid);
      this.arrowMesh.rotation.y = ang;
      this.arrowMesh.material.opacity = 0.35 + 0.45 * Math.abs(Math.sin(this.t * 10));
      if (this.stateT >= dur) {
        this.state = 'charge';
        this.stateT = 0;
        this.chargeDir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
        this.arrowMesh.visible = false;
        this.ctx.audio.noiseBurst(0.3, 150, 0.4, 'lowpass');
      }
      this.syncTransform();
      return;
    }

    if (this.state === 'charge') {
      const speed = (14 + (this.phase - 1) * 1.6);
      this.pos.x += this.chargeDir.x * speed * dt;
      this.pos.z += this.chargeDir.z * speed * dt;
      // límites del arena
      const d0 = Math.hypot(this.pos.x - this.arena.x, this.pos.z - this.arena.z);
      if (d0 > this.arena.r) {
        const nx = (this.pos.x - this.arena.x) / d0, nz = (this.pos.z - this.arena.z) / d0;
        this.pos.x = this.arena.x + nx * this.arena.r;
        this.pos.z = this.arena.z + nz * this.arena.r;
        this.state = 'recover';
        this.stateT = 0;
      }
      const dp = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      if (dp < 2.1 && this.stateT > 0.08) {
        ctx.game.hitPlayer(1, this.pos);
        this.state = 'recover';
        this.stateT = 0;
      }
      if (this.stateT > 1.3) { this.state = 'recover'; this.stateT = 0; }
      for (let i = 0; i < 2; i++) this.ctx.fx.dustPuff(this.pos.x + rnd(-0.5, 0.5), this.groundY(this.pos.x, this.pos.z) + 0.2, this.pos.z + rnd(-0.5, 0.5), 1.1);
      this.syncTransform();
      return;
    }

    if (this.state === 'tg_slam') {
      faceTo(player.pos.x, player.pos.z);
      const dur = 0.9 - (this.phase - 1) * 0.1;
      const radius = 6 + (this.phase - 1) * 0.6;
      this.ringMesh.visible = true;
      this.ringMesh.position.set(this.pos.x, this.groundY(this.pos.x, this.pos.z) + 0.08, this.pos.z);
      this.ringMesh.scale.setScalar(radius);
      this.ringMesh.material.opacity = 0.18 + 0.35 * (this.stateT / dur);
      if (this.stateT >= dur) {
        this.state = 'slam';
        this.stateT = 0;
        this.slamRadius = radius;
      }
      this.syncTransform();
      return;
    }

    if (this.state === 'slam') {
      this.ringMesh.visible = false;
      if (this.stateT < 0.12) {
        const dp = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
        if (dp < this.slamRadius) {
          const nx = (player.pos.x - this.pos.x) / (dp || 1), nz = (player.pos.z - this.pos.z) / (dp || 1);
          ctx.game.hitPlayer(1, this.pos);
          player.vx = nx * 10; player.vz = nz * 10;
        }
        ctx.chase.shake(0.3);
        for (let i = 0; i < 18; i++) {
          const a = Math.random() * TAU, r = Math.random() * this.slamRadius;
          this.ctx.fx.dustPuff(this.pos.x + Math.cos(a) * r, this.groundY(this.pos.x + Math.cos(a) * r, this.pos.z + Math.sin(a) * r) + 0.1, this.pos.z + Math.sin(a) * r, 1.6);
        }
        this.ctx.audio.noiseBurst(0.4, 100, 0.5, 'lowpass');
      }
      if (this.stateT > 0.6) { this.state = 'recover'; this.stateT = 0; }
      this.syncTransform();
      return;
    }

    if (this.state === 'recover') {
      if (this.stateT > 0.7) { this.state = 'idle'; this.stateT = 0; this.cd = rnd(1.4, 2.4) - (this.phase - 1) * 0.3; }
      this.syncTransform();
      return;
    }

    this.syncTransform();
  }

  syncTransform() {
    const gy = this.groundY(this.pos.x, this.pos.z);
    this.model.root.position.set(this.pos.x, gy, this.pos.z);
    this.model.root.rotation.y = this.facing;
    const bob = this.state === 'idle' ? Math.sin(this.t * 2.2) * 0.04 : 0;
    this.model.body.position.y = bob;
    const windup = this.state === 'tg_charge' || this.state === 'tg_slam';
    const kScale = 1 + (windup ? Math.sin(this.stateT * 14) * 0.04 : 0) + (this.state === 'charge' ? 0.06 : 0);
    this.model.root.scale.setScalar(1.55 * kScale);
    for (const arm of this.model.arms) {
      const raise = this.state === 'tg_slam' || this.state === 'slam' ? -2.4 : this.state === 'charge' ? -0.6 : -0.2;
      arm.sh.rotation.x = damp(arm.sh.rotation.x, raise, 8, 0.016);
    }
    for (const mesh of [this.model.mats.stone, this.model.mats.moss]) {
      mesh.emissive = mesh.emissive || new THREE.Color(0);
      mesh.emissive.setRGB(this.hitFlash, this.hitFlash * 0.3, 0);
      mesh.emissiveIntensity = 1;
    }
  }

  dispose() {
    this.ctx.scene.remove(this.model.root);
    this.ctx.scene.remove(this.ringMesh);
    this.ctx.scene.remove(this.arrowMesh);
  }
}

const BOSSES = { minotauro: Minotauro };

export function createBoss(kind, ctx, arena) {
  const C = BOSSES[kind];
  if (!C) return null;
  return new C(ctx, arena);
}
