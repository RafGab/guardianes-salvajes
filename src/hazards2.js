import * as THREE from 'three';
import { CFG, terrainH } from './terrain.js';
import { clamp, damp, smoothstep, TAU } from './utils.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const protectedNow = (ctx) => ctx.player.shieldT > 0;

/* ================================================================== */
/*  Volcán: ríos de lava, ceniza y bombas de roca                      */
/* ================================================================== */
export class VolcanoHazard {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.geo = new THREE.CircleGeometry(1, 24);
    this.geo.rotateX(-Math.PI / 2);
    this.lavaMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5a10).multiplyScalar(1.6), transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.coolMat = new THREE.MeshBasicMaterial({ color: 0x2a2624, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.bombGeo = new THREE.IcosahedronGeometry(0.7, 0);
    this.bombMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a20).multiplyScalar(2) });
    this.light = new THREE.PointLight(0xff6a20, 0, 34, 1.5);
    ctx.scene.add(this.light);
    this.reset();
  }

  reset() {
    for (const z of this.pools || []) this.group.remove(z.mesh);
    for (const b of this.bombs || []) this.group.remove(b.mesh);
    this.pools = [];
    this.bombs = [];
    this.fronts = [];
    this.heat = 0;
    this.bombT = 6;
    const hz = this.ctx.hz || 1;
    const paths = this.ctx.sc.lavaPaths || [];
    // cada río de lava nace en el cráter y avanza a intervalos
    paths.forEach((p, i) => this.fronts.push({ path: p, k: 0, delay: 8 + i * 22 / hz, acc: 0, speed: 0.55 * hz }));
    this.fronts.forEach((f) => { if (f.path.length) this.addPool(f.path[0][0], f.path[0][1], 5); });
  }

  addPool(x, z, r) {
    if (this.pools.length > 46) return;
    const m = new THREE.Mesh(this.geo, this.lavaMat);
    m.position.set(x, terrainH(x, z) + 0.12, z);
    m.scale.setScalar(r);
    m.renderOrder = 2;
    this.group.add(m);
    this.pools.push({ x, z, r, y: terrainH(x, z), mesh: m, state: 'hot', out: 0 });
  }

  urgentAt(pos) {
    return this.pools.some((p) => p.state === 'hot' && Math.hypot(pos.x - p.x, pos.z - p.z) < p.r + 7);
  }

  gauge() {
    const hot = this.pools.filter((p) => p.state === 'hot').length;
    return { label: 'LAVA', pct: clamp(hot / 30, 0, 1), text: `${hot} ríos`, danger: hot > 20, color: '#ff6a20' };
  }

  onPower(type, pos) {
    const radius = type === 'surf' ? 11 : type === 'ice' ? 10 : type === 'pillar' ? 4.5 : 0;
    if (!radius) return;
    let n = 0;
    for (const p of this.pools) {
      if (p.state !== 'hot') continue;
      if (Math.hypot(pos.x - p.x, pos.z - p.z) < radius + p.r * 0.5) { p.state = 'cool'; p.mesh.material = this.coolMat; n++; }
    }
    for (let i = 0; i < 20; i++) this.ctx.fx.mist(pos.x + rnd(-3, 3), pos.y + 0.6, pos.z + rnd(-3, 3), 0xffffff, 2.2);
    if (n) {
      this.ctx.addScore(25 * n);
      this.ctx.ui.banner('good', `🪨 ¡Lava enfriada!`, '+' + 25 * n + ' puntos');
    }
  }

  cool(f = 0.5) {
    this.heat = Math.max(0, this.heat - f);
  }

  update(dt, t) {
    const { ctx } = this;
    const { player, fx, camera, world, chase } = ctx;
    const hz = ctx.hz || 1;
    const immune = ctx.hero.element === 'fuego' || protectedNow(ctx);
    world.setFog(world.fogBase * (1 + 0.35 * Math.sin(t * 0.15) * hz * 0.5 + 0.2));
    // avance de la lava
    for (const f of this.fronts) {
      if (t < f.delay || f.k >= f.path.length - 1) continue;
      f.acc += dt * f.speed;
      if (f.acc >= 1) {
        f.acc = 0;
        f.k++;
        const [x, z] = f.path[f.k];
        if (Math.hypot(x - CFG.START.x, z - CFG.START.z) > 16 && Math.hypot(x - CFG.SAFE.x, z - CFG.SAFE.z) > 16) this.addPool(x + rnd(-1.2, 1.2), z + rnd(-1.2, 1.2), rnd(3.6, 5));
      }
    }
    // rocas ardientes
    this.bombT -= dt;
    if (this.bombT <= 0) {
      this.bombT = rnd(3, 6) / hz;
      const a = Math.random() * TAU, r = rnd(6, 30);
      const x = clamp(player.pos.x + Math.cos(a) * r, -100, 100), z = clamp(player.pos.z + Math.sin(a) * r, -100, 100);
      const m = new THREE.Mesh(this.bombGeo, this.bombMat);
      const oy = ctx.sc.crater ? ctx.sc.crater.y : 40;
      const ox = ctx.sc.crater ? ctx.sc.crater.x : 0, oz = ctx.sc.crater ? ctx.sc.crater.z : -40;
      m.position.set(ox, oy, oz);
      this.group.add(m);
      const T = 2.2 + Math.random();
      this.bombs.push({ mesh: m, ox, oy, oz, x, z, tx: x, tz: z, T, age: 0, y0: oy });
      ctx.ui.setOverlay && 0;
    }
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.age += dt;
      const k = clamp(b.age / b.T, 0, 1);
      const gy = terrainH(b.tx, b.tz);
      b.mesh.position.set(b.ox + (b.tx - b.ox) * k, b.y0 + (gy - b.y0) * k * k + Math.sin(k * Math.PI) * 26, b.oz + (b.tz - b.oz) * k);
      b.mesh.rotation.x += dt * 4;
      if (Math.random() < dt * 30) fx.ember(b.mesh.position.x, b.mesh.position.y, b.mesh.position.z, 0.6);
      if (k >= 1) {
        this.group.remove(b.mesh);
        this.bombs.splice(i, 1);
        fx.rock(b.tx, gy + 0.4, b.tz);
        for (let q = 0; q < 6; q++) fx.flame(b.tx + rnd(-1, 1), gy + 0.2, b.tz + rnd(-1, 1), 1.2, 0.1);
        const d = Math.hypot(b.tx - player.pos.x, b.tz - player.pos.z);
        if (d < 3 && !protectedNow(ctx)) {
          const nx = (player.pos.x - b.tx) / (d || 1), nz = (player.pos.z - b.tz) / (d || 1);
          player.vx = nx * 10; player.vz = nz * 10;
          chase.shake(0.4);
          this.heat = Math.min(1, this.heat + 0.4);
          ctx.ui.banner('find', '🌋 ¡Roca ardiente!', 'Mira el cielo y aléjate de la sombra que crece');
          ctx.tip('rocks');
        }
        if (d < 40) ctx.audio.noiseBurst(0.3, 160, 0.4, 'lowpass');
      }
    }
    // charcos de lava
    const camP = camera.position;
    let nearest = null, nd = 1e9;
    for (const p of this.pools) {
      const dCam = Math.hypot(camP.x - p.x, camP.z - p.z);
      if (p.state === 'hot') {
        if (dCam < 100) {
          const n = p.r * dt * 4;
          const whole = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
          for (let k = 0; k < whole; k++) {
            const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * p.r * 0.9;
            fx.flame(p.x + Math.cos(a) * rr, p.y + 0.15, p.z + Math.sin(a) * rr, 1.1, 0.02);
          }
          if (Math.random() < dt * 1.6) fx.smokePuff(p.x, p.y + 1.5, p.z, 2.2, 0x3a3634);
        }
        if (dCam < nd) { nd = dCam; nearest = p; }
        const dp = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
        if (dp < p.r && !immune && player.pos.y < p.y + 2.6) {
          const nx = (player.pos.x - p.x) / (dp || 1), nz = (player.pos.z - p.z) / (dp || 1);
          player.pos.x += nx * 8 * dt; player.pos.z += nz * 8 * dt;
          player.vx = nx * 5; player.vz = nz * 5;
          this.heat = Math.min(1, this.heat + dt * 2.2);
          ctx.tip('lava');
        }
      } else if (dCam < 80 && Math.random() < dt * 2) fx.smokePuff(p.x + rnd(-1, 1) * p.r * 0.5, p.y + 0.5, p.z + rnd(-1, 1) * p.r * 0.5, 1.4, 0x8a8a8a);
    }
    if (nearest) { this.light.position.set(nearest.x, nearest.y + 3, nearest.z); this.light.intensity = damp(this.light.intensity, 30, 5, dt); } else this.light.intensity = damp(this.light.intensity, 0, 5, dt);
    this.heat = Math.max(0, this.heat - dt * 1.1);
    ctx.ui.setOverlay('heat', this.heat * 0.9);
    // ceniza
    if (Math.random() < dt * 50) fx.smoke.emit(camP.x + rnd(-24, 24), camP.y + rnd(0, 14), camP.z + rnd(-24, 24), rnd(1, 3), rnd(-1, -0.2), rnd(-1, 1), 3, 0.16, 0.12, 0x504a46, 0x38322e, 0.5, 0, 0, 0.1);
  }

  dispose() {
    this.ctx.scene.remove(this.group);
    this.ctx.scene.remove(this.light);
  }
}

/* ================================================================== */
/*  Huracán: viento, ojo de la tormenta, objetos voladores y palmeras  */
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
      if (dx * dx + dz * dz < 1.3 && Math.abs(dy) < 1.6 && this.hit <= 0 && !protectedNow(ctx)) {
        this.hit = 1.2;
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
    world.setFog(world.fogBase * (1 + this.whiteout * 3.4));
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
    if (Math.random() < dt * 30) fx.dustPuff(player.pos.x + rnd(-18, 18), 0.4 + terrainH(player.pos.x, player.pos.z), player.pos.z + rnd(-18, 18), 2.4);
    ctx.ui.setOverlay('dust', this.whiteout * 0.5);
  }

  dispose() {
    this.ctx.scene.remove(this.group);
    this.ctx.player.env.wind = null;
    this.ctx.world.windAmp.value = this.ctx.sc.windAmp ?? 1;
  }
}

/* ================================================================== */
/*  Sequía: calor creciente, sombra y agua refrescan                   */
/* ================================================================== */
export class DroughtHazard {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.devilMat = new THREE.MeshBasicMaterial({ color: 0xcfb890, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
    this.devilGeo = new THREE.CylinderGeometry(0.4, 2.2, 9, 12, 1, true);
    this.reset();
  }

  reset() {
    for (const d of this.devils || []) this.group.remove(d.mesh);
    this.devils = [];
    const spots = this.ctx.sc.dustDevilAt || [[-20, 0], [24, -30], [-10, -60]];
    for (const [x, z] of spots) {
      const m = new THREE.Mesh(this.devilGeo, this.devilMat);
      this.group.add(m);
      this.devils.push({ mesh: m, x, z, ph: rnd(0, TAU), r: rnd(10, 18), cx: x, cz: z });
    }
    this.heat = 0.05;
    this.tipped = false;
    this.wind = { x: 0, z: 0 };
  }

  urgentAt() { return false; }

  gauge() {
    return { label: 'CALOR', pct: this.heat, text: `${Math.round(this.heat * 100)}%`, danger: this.heat > 0.75, color: '#ffb14a' };
  }

  onPower(type, pos) {
    if (type === 'surf' || type === 'ice') { this.heat = Math.max(0, this.heat - 0.3); this.ctx.ui.banner('good', '💧 ¡Refresco!', 'El calor baja un poco'); }
  }

  cool(f = 0.5) {
    this.heat = Math.max(0, this.heat - f * 0.6);
    this.ctx.ui.banner('good', '💧 ¡Agua fresca!', 'El calor baja');
  }

  update(dt, t) {
    const { ctx } = this;
    const { player, hero, world, fx } = ctx;
    const hz = ctx.hz || 1;
    const P = player.pos;
    let rate = 0.0055 * hz * (1 + smoothstep(0, 200, t) * 0.5);
    if (hero.element === 'agua' || hero.element === 'hielo') rate *= 0.55;
    if (hero.element === 'fuego') rate *= 0.4;
    let cooler = false;
    for (const s of ctx.sc.shadeSpots || []) if (Math.hypot(P.x - s[0], P.z - s[1]) < (s[2] || 5) && Math.abs(P.y - terrainH(s[0], s[1])) < 6) cooler = true;
    for (const s of ctx.sc.waterSpots || []) if (Math.hypot(P.x - s[0], P.z - s[1]) < (s[2] || 6)) cooler = true;
    const S = CFG.SAFE;
    if (Math.hypot(P.x - S.x, P.z - S.z) < S.r + 2 && P.y > S.y - 2.5) cooler = true;
    if (player.shieldT > 0) rate *= 0.3;
    this.heat = clamp(this.heat + (cooler ? -0.1 : rate) * dt, 0, 1);
    if (this.heat > 0.5 && !this.tipped) { this.tipped = true; ctx.tip('heat'); ctx.ui.banner('find', '🥵 ¡Mucho calor!', 'Busca sombra o agua'); }
    player.env.speedMul = this.heat > 0.7 ? Math.max(0.55, 1 - (this.heat - 0.7) * 1.5) : 1;
    ctx.ui.setOverlay('heat', Math.max(0, (this.heat - 0.4) * 0.9));
    world.setFog(world.fogBase * (1 + 0.4 * Math.sin(t * 0.2)));
    // remolinos de polvo que empujan un poco
    this.wind.x = 0; this.wind.z = 0;
    for (const d of this.devils) {
      d.ph += dt * 0.35;
      d.x = d.cx + Math.cos(d.ph) * d.r; d.z = d.cz + Math.sin(d.ph * 1.3) * d.r;
      d.mesh.position.set(d.x, terrainH(d.x, d.z) + 4.5, d.z);
      d.mesh.rotation.y += dt * 4;
      if (Math.random() < dt * 10) fx.dustPuff(d.x, terrainH(d.x, d.z) + 0.6, d.z, 1.8);
      const dx = P.x - d.x, dz = P.z - d.z, dd = Math.hypot(dx, dz);
      if (dd < 6 && player.shieldT <= 0) { this.wind.x += (-dz / (dd || 1)) * 4; this.wind.z += (dx / (dd || 1)) * 4; }
    }
    player.env.wind = this.wind;
  }

  dispose() {
    this.ctx.scene.remove(this.group);
    this.ctx.player.env.wind = null;
  }
}
