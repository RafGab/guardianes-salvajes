import * as THREE from 'three';
import { CFG, terrainH } from './terrain.js';
import { clamp, damp, smoothstep, TAU } from './utils.js';
import { HEALTH } from './skills/config.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const protectedNow = (ctx) => ctx.player.shieldT > 0;

/* ================================================================== */
/*  Huracán                                                            */
/* ================================================================== */
export class HurricaneHazard {
  constructor(ctx, { debrisOnly = false } = {}) {
    this.ctx = ctx;
    this.debrisOnly = debrisOnly;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.wind = { x: 0, z: 0 };
    this.mats = [new THREE.MeshStandardMaterial({ color: 0x9a7048, roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: 0x5a6a78, roughness: 0.6, metalness: 0.4 })];
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.reset();
  }

  reset() {
    for (const d of this.debris || []) this.group.remove(d.mesh);
    this.debris = [];
    this.lull = 0;
    this.fallT = 12;
    this.spawnT = 3;
    this.eyeShown = false;
    this.eye = { t0: 150, t1: 185 };
    this.strength = 0;
    this.hit = 0;
  }

  urgentAt() { return false; }

  gauge() {
    const s = this.strength;
    const inEye = this.inEye;
    return { label: 'VIENTO', pct: clamp(s, 0, 1), text: inEye ? 'OJO' : `${Math.round(40 + s * 110)} km/h`, danger: s > 0.8, color: '#9ad0ff' };
  }

  onPower() {}

  gust() { this.lull = 4; this.ctx.ui.banner('good', '🌀 ¡Viento contra viento!', 'Una calma breve a tu alrededor'); }

  update(dt, t) {
    const { ctx } = this;
    const { player, world, chase, fx } = ctx;
    const hz = ctx.hz || 1;
    this.inEye = t > this.eye.t0 && t < this.eye.t1;
    if (this.inEye && !this.eyeShown) { this.eyeShown = true; ctx.ui.alert('🌀 Ojo del huracán: calma engañosa… el viento volverá', 4500); ctx.tip('eye'); }
    let base = clamp(0.35 + (t / 260) * 0.55, 0, 1) * (0.7 + 0.3 * hz);
    if (this.inEye) base *= 0.08 + 0.1 * (1 - smoothstep(0, 8, Math.min(t - this.eye.t0, this.eye.t1 - t)));
    if (t >= this.eye.t1 && t < this.eye.t1 + 10) base = Math.min(1, base * 1.25);
    const gust = clamp(0.75 + Math.sin(t * 0.9) * 0.15 + Math.sin(t * 2.3 + 1) * 0.1, 0.4, 1.2);
    this.lull = Math.max(0, this.lull - dt);
    const lullK = this.lull > 0 ? 0.25 : 1;
    this.strength = damp(this.strength, base, 2, dt);
    const s = this.strength * gust * lullK;
    const ang = 0.5 + Math.sin(t * 0.05) * 0.5;
    const prot = player.shieldT > 0 ? 0.35 : 1;
    const airK = ctx.hero.element === 'aire' ? 0.6 : 1;
    this.wind.x = Math.cos(ang) * s * 6.5 * prot * airK;
    this.wind.z = Math.sin(ang) * s * 6.5 * prot * airK;
    player.env.wind = this.wind;
    world.windAmp.value = 1 + s * 5;
    if (world.rain) world.rain.uniforms.uWind.value.set(10 + s * 26, 0, 4 + s * 9);
    if (!this.debrisOnly) {
      world.setFog(world.fogBase * (1 + s * 0.7));
      if (t > 20) ctx.tip('wind');
      if (t > 80) ctx.tip('surge');
    }
    if (world.sun) world.sun.intensity = 0.7 + (this.inEye ? 1.4 : 0);
    // objetos voladores
    this.spawnT -= dt;
    if (this.spawnT <= 0 && !this.inEye) {
      this.spawnT = rnd(1.6, 3.2) / (hz * (0.4 + s));
      if (this.debris.length < 16) {
        const dirx = Math.cos(ang), dirz = Math.sin(ang);
        const m = new THREE.Mesh(this.box, this.mats[Math.floor(Math.random() * 3)]);
        m.scale.set(rnd(0.5, 1.4), rnd(0.2, 0.9), rnd(0.5, 1.4));
        const x = player.pos.x - dirx * 42 + rnd(-14, 14), z = player.pos.z - dirz * 42 + rnd(-14, 14);
        m.position.set(x, terrainH(x, z) + rnd(1, 4), z);
        m.castShadow = true;
        this.group.add(m);
        this.debris.push({ mesh: m, vx: dirx * (18 + s * 10), vz: dirz * (18 + s * 10), vy: rnd(0, 3), spin: rnd(2, 6), life: 0 });
      }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life += dt;
      d.mesh.position.x += d.vx * dt;
      d.mesh.position.z += d.vz * dt;
      d.mesh.position.y += (d.vy + Math.sin(d.life * 3) * 1.5) * dt;
      d.mesh.rotation.x += d.spin * dt; d.mesh.rotation.z += d.spin * 0.7 * dt;
      const dx = d.mesh.position.x - player.pos.x, dz = d.mesh.position.z - player.pos.z, dy = d.mesh.position.y - (player.pos.y + 1);
      if (dx * dx + dz * dz < 1.3 && Math.abs(dy) < 1.6 && this.hit <= 0 && (protectedNow(ctx) || ctx.game.shielded)) { this.hit = 0.6; ctx.game.shieldBlock(d.mesh.position); }
      if (dx * dx + dz * dz < 1.3 && Math.abs(dy) < 1.6 && this.hit <= 0 && !protectedNow(ctx)) {
        this.hit = 1.2;
        ctx.game.hurtHero(HEALTH.flying, { from: d.mesh.position });
        const l = Math.hypot(d.vx, d.vz) || 1;
        player.vx = (d.vx / l) * 9; player.vz = (d.vz / l) * 9;
        chase.shake(0.4);
        ctx.audio.noiseBurst(0.3, 300, 0.4, 'lowpass');
        ctx.ui.banner('find', '💥 ¡Objeto volando!', 'Ponte a cubierto detrás de un edificio');
        ctx.tip('debris');
      }
      if (d.life > 7 || Math.hypot(d.mesh.position.x - player.pos.x, d.mesh.position.z - player.pos.z) > 70) { this.group.remove(d.mesh); this.debris.splice(i, 1); }
    }
    this.hit -= dt;
    // palmeras que caen y bloquean el paso
    if (!this.debrisOnly) {
      this.fallT -= dt;
      const sites = ctx.sc.sites;
      if (this.fallT <= 0 && sites.length && !this.inEye) {
        this.fallT = rnd(14, 24) / hz;
        const cand = sites.filter((si) => Math.hypot(si.x - player.pos.x, si.z - player.pos.z) > 12 && Math.hypot(si.x - player.pos.x, si.z - player.pos.z) < 55 && Math.hypot(si.x - CFG.START.x, si.z - CFG.START.z) > 14 && Math.hypot(si.x - CFG.SAFE.x, si.z - CFG.SAFE.z) > 14);
        if (cand.length) {
          const si = cand[Math.floor(Math.random() * cand.length)];
          world.addObstacle({ kind: 'trunk', x: si.x, z: si.z, breakBy: 'axe', ry: si.ry || 0, size: 1.1 });
          fx.dustPuff(si.x, terrainH(si.x, si.z) + 0.5, si.z, 2.6);
          if (Math.hypot(si.x - player.pos.x, si.z - player.pos.z) < 45) { ctx.audio.noiseBurst(0.5, 140, 0.5, 'lowpass'); ctx.ui.banner('find', '🌴 ¡Cae una palmera!', 'El hacha 🪓 despeja el camino'); }
        }
      }
    }
  }

  dispose() {
    this.ctx.scene.remove(this.group);
    if (this.ctx.player.env) this.ctx.player.env.wind = null;
    this.ctx.world.windAmp.value = this.ctx.sc.windAmp ?? 1;
  }
}

/* ================================================================== */
/*  Tormenta de arena: oleadas de niebla, matojos rodantes, dunas       */
/* ================================================================== */
export class SandstormHazard {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.wind = { x: 0, z: 0 };
    this.tumbleMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 1, flatShading: true });
    this.tumbleGeo = new THREE.IcosahedronGeometry(0.8, 0);
    this.reset();
  }

  reset() {
    for (const w of this.weeds || []) this.group.remove(w.mesh);
    this.weeds = [];
    this.clearT = 0;
    this.spawnT = 5;
    this.driftT = 25;
    this.hit = 0;
    this.whiteout = 0;
  }

  urgentAt() { return false; }

  gauge() {
    return { label: 'VISIBILIDAD', pct: clamp(1 - this.whiteout, 0, 1), text: this.whiteout > 0.6 ? 'BAJA' : 'MEDIA', danger: this.whiteout > 0.75, color: '#e8c078' };
  }

  onPower() {}

  gust() { this.clearT = 6; this.ctx.ui.banner('good', '🌀 ¡Viento despeja la arena!', 'La visibilidad mejora unos segundos'); }

  update(dt, t) {
    const { ctx } = this;
    const { player, world, chase, fx } = ctx;
    const hz = ctx.hz || 1;
    // oleadas de arena: la visibilidad cae y vuelve
    const wave = Math.pow((Math.sin(t * 0.13 + 0.6) + 1) / 2, 2.2) * (0.6 + 0.25 * hz);
    this.clearT = Math.max(0, this.clearT - dt);
    const target = this.clearT > 0 ? 0 : clamp(wave, 0, 1);
    this.whiteout = damp(this.whiteout, target, 1.5, dt);
    world.setFog(world.fogBase * (1 + this.whiteout * 1.3)); // antes ×3,4: la niebla de arena ocultaba enemigos y personas
    if (this.whiteout > 0.55) ctx.tip('lost');
    const ang = 0.4 + Math.sin(t * 0.07) * 0.25;
    const s = 0.4 + this.whiteout * 0.7;
    this.wind.x = Math.cos(ang) * s * 3.4;
    this.wind.z = Math.sin(ang) * s * 3.4;
    player.env.wind = this.wind;
    if (world.rain) world.rain.uniforms.uWind.value.set(9 + s * 12, 0, 3 + s * 4);
    world.windAmp.value = 1 + s * 2;
    // matojos rodantes
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = rnd(4, 8) / hz;
      if (this.weeds.length < 8) {
        const dirx = Math.cos(ang), dirz = Math.sin(ang);
        const x = player.pos.x - dirx * 36 + rnd(-16, 16), z = player.pos.z - dirz * 36 + rnd(-16, 16);
        const m = new THREE.Mesh(this.tumbleGeo, this.tumbleMat);
        m.scale.set(1.2, 1, 1.2);
        this.group.add(m);
        this.weeds.push({ mesh: m, x, z, vx: dirx * rnd(6, 10), vz: dirz * rnd(6, 10), life: 0, ph: rnd(0, TAU) });
      }
    }
    for (let i = this.weeds.length - 1; i >= 0; i--) {
      const w = this.weeds[i];
      w.life += dt;
      w.x += w.vx * dt; w.z += w.vz * dt;
      const gy = terrainH(w.x, w.z);
      w.mesh.position.set(w.x, gy + 0.9 + Math.abs(Math.sin(w.life * 5 + w.ph)) * 0.5, w.z);
      w.mesh.rotation.x += dt * 6; w.mesh.rotation.z += dt * 4;
      const dx = w.x - player.pos.x, dz = w.z - player.pos.z;
      if (dx * dx + dz * dz < 1.6 && this.hit <= 0 && !protectedNow(ctx)) {
        this.hit = 1;
        ctx.game.hurtHero(HEALTH.weed, { from: { x: w.x, z: w.z } });
        player.vx = w.vx * 0.9; player.vz = w.vz * 0.9;
        chase.shake(0.2);
      }
      if (Math.random() < dt * 8) fx.dustPuff(w.x, gy + 0.4, w.z, 1.2);
      if (w.life > 12 || Math.hypot(dx, dz) > 70) { this.group.remove(w.mesh); this.weeds.splice(i, 1); }
    }
    this.hit -= dt;
    // dunas nuevas tapan el camino (se despejan con viento)
    this.driftT -= dt;
    const sites = ctx.sc.sites;
    if (this.driftT <= 0 && sites.length && ctx.world.sc.windCover) {
      this.driftT = rnd(18, 28) / hz;
      const cand = sites.filter((si) => { const d = Math.hypot(si.x - player.pos.x, si.z - player.pos.z); return d > 12 && d < 50 && Math.hypot(si.x - CFG.START.x, si.z - CFG.START.z) > 14 && Math.hypot(si.x - CFG.SAFE.x, si.z - CFG.SAFE.z) > 14; });
      if (cand.length) {
        const si = cand[Math.floor(Math.random() * cand.length)];
        world.addObstacle({ kind: 'sand', x: si.x, z: si.z, breakBy: 'wind', ry: si.ry || 0, size: 1.2 });
        fx.dustPuff(si.x, terrainH(si.x, si.z) + 0.5, si.z, 3);
        ctx.ui.banner('find', '🏜️ ¡Una duna tapa el camino!', 'El viento 🌀 la despeja');
      }
    }
    // nubes de polvo a ras de suelo, lejos de la cámara (no delante de la vista)
    if (Math.random() < dt * 12) { const a = rnd(0, Math.PI * 2), r = rnd(7, 20), x = player.pos.x + Math.cos(a) * r, z = player.pos.z + Math.sin(a) * r; if ((x - player.pos.x) * (ctx.camera.position.x - player.pos.x) + (z - player.pos.z) * (ctx.camera.position.z - player.pos.z) < 0) fx.dustPuff(x, 0.3 + terrainH(x, z), z, 1.8); }
    ctx.ui.setOverlay('dust', this.whiteout * 0.18); // velo de polvo en pantalla muy suave
  }

  dispose() {
    this.ctx.scene.remove(this.group);
    this.ctx.player.env.wind = null;
    this.ctx.world.windAmp.value = this.ctx.sc.windAmp ?? 1;
  }
}
