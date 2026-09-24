import * as THREE from 'three';
import { CFG, terrainH } from './terrain.js';
import { clamp, damp, smoothstep, makeRng, TAU } from './utils.js';
import { VolcanoHazard, HurricaneHazard, SandstormHazard, DroughtHazard } from './hazards2.js';

const rnd = (a, b) => a + Math.random() * (b - a);

/* ================================================================== */
/*  Incendio forestal: focos que se propagan, humo, calor              */
/* ================================================================== */
class FireHazard {
  constructor(ctx) {
    this.ctx = ctx;
    this.zones = [];
    this.MAX = 26;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xff6a20, 0, 26, 1.5);
      ctx.scene.add(l);
      this.lights.push(l);
    }
    this.decalGeo = new THREE.CircleGeometry(1, 28);
    this.decalGeo.rotateX(-Math.PI / 2);
    this.decalMat = new THREE.MeshBasicMaterial({ color: 0x100c0a, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.reset();
  }

  reset() {
    for (const z of this.zones) this.group.remove(z.decal);
    this.zones = [];
    this.spreadT = 5;
    this.heat = 0;
    this.heatTipShown = false;
    this.windOn = false;
    this.acc = 0;
    this.lightAcc = 0;
    this.extinguished = 0;
    const pool = (this.ctx.sc && this.ctx.sc.fireSeedPool) || [[-16, -16], [30, -30], [-42, 18], [18, 12]];
    const cand = pool.filter(([x, z]) => Math.hypot(x - CFG.START.x, z - CFG.START.z) > 26 && Math.hypot(x - CFG.SAFE.x, z - CFG.SAFE.z) > 20);
    for (let i = cand.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cand[i], cand[j]] = [cand[j], cand[i]];
    }
    const n = 3 + Math.round(((this.ctx.level && this.ctx.level.hz) || 1) - 1);
    for (const [x, z] of cand.slice(0, Math.min(cand.length, n + 1))) this.spawn(x, z, 3.5);
  }

  spawn(x, z, r0 = 2.5) {
    if (this.zones.length >= this.MAX) return null;
    const decal = new THREE.Mesh(this.decalGeo, this.decalMat);
    decal.position.set(x, terrainH(x, z) + 0.09, z);
    decal.scale.setScalar(r0);
    decal.renderOrder = 2;
    this.group.add(decal);
    const zn = { x, z, r: r0, rMax: rnd(6, 8.6), state: 'burn', out: 0, decal, y: terrainH(x, z) };
    this.zones.push(zn);
    return zn;
  }

  burning() {
    return this.zones.filter((z) => z.state === 'burn');
  }

  urgentAt(pos) {
    for (const z of this.zones) {
      if (z.state !== 'burn') continue;
      if (Math.hypot(pos.x - z.x, pos.z - z.z) < z.r + 7) return true;
    }
    return false;
  }

  gauge() {
    const n = this.burning().length;
    return { label: 'FUEGO', pct: clamp(n / 20, 0, 1), text: `${n} focos`, danger: n >= 14, color: '#ff7a2a' };
  }

  onPower(type, pos, hero) {
    const radius = type === 'surf' ? 11 : type === 'ice' ? 9.5 : type === 'pillar' ? 5.5 : 0;
    if (!radius) return;
    let n = 0;
    for (const z of this.zones) {
      if (z.state !== 'burn') continue;
      if (Math.hypot(pos.x - z.x, pos.z - z.z) < radius + z.r * 0.5) {
        z.state = 'out';
        z.out = 0;
        n++;
      }
    }
    const fx = this.ctx.fx;
    for (let i = 0; i < 24; i++) fx.mist(pos.x + rnd(-3, 3), pos.y + 0.6, pos.z + rnd(-3, 3), 0xffffff, 2.2);
    if (n) {
      this.extinguished += n;
      this.ctx.addScore(30 * n);
      this.ctx.ui.banner('good', `💧 ¡${n} ${n > 1 ? 'focos apagados' : 'foco apagado'}!`, '+' + 30 * n + ' puntos');
      this.ctx.audio.found();
    }
  }

  update(dt, t) {
    const { ctx } = this;
    const { player, fx, camera, world } = ctx;
    const immune = ctx.hero.element === 'fuego' || player.shieldT > 0;
    const hz = ctx.hz || 1;
    // propagación
    this.spreadT -= dt;
    if (t > 100 && !this.windOn) {
      this.windOn = true;
      ctx.ui.alert('💨 ¡El viento arrecia! El fuego se propaga más rápido', 4500);
      ctx.tip('wind');
    }
    if (this.spreadT <= 0) {
      this.spreadT = (Math.max(2.4, 6.2 - t / 70) * (this.windOn ? 0.75 : 1)) / hz;
      const alive = this.burning();
      if (alive.length && this.zones.length < this.MAX) {
        const src = alive[Math.floor(Math.random() * alive.length)];
        const a = Math.random() * TAU + (this.windOn ? 0 : 0);
        const d = src.r * rnd(1.0, 1.5) + 2.2;
        const nx = src.x + Math.cos(a) * d + (this.windOn ? 2.5 : 0), nz = src.z + Math.sin(a) * d;
        const okBounds = Math.abs(nx) < 104 && Math.abs(nz) < 104 && terrainH(nx, nz) < 15 && Math.hypot(nx - CFG.SAFE.x, nz - CFG.SAFE.z) > 18;
        const okStart = Math.hypot(nx - CFG.START.x, nz - CFG.START.z) > 16;
        const okFar = this.zones.every((z) => Math.hypot(nx - z.x, nz - z.z) > 4.2 || z.state === 'out');
        if (okBounds && okStart && okFar) this.spawn(nx, nz, 2.4);
      }
    }
    // crecimiento, extinción y partículas
    this.acc += dt;
    const camP = camera.position;
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      const dCam = Math.hypot(camP.x - z.x, camP.z - z.z);
      if (z.state === 'burn') {
        z.r += (z.rMax - z.r) * dt * 0.13;
        // el héroe de fuego absorbe las llamas
        if (immune && Math.hypot(player.pos.x - z.x, player.pos.z - z.z) < z.r + 1.5 && player.pos.y < z.y + 3) {
          z.r -= dt * 0.9;
          if (z.r < 1.4) {
            z.state = 'out';
            z.out = 0;
            this.extinguished++;
            ctx.addScore(30);
            ctx.ui.banner('good', '🔥 ¡Fuego absorbido!', '+30 puntos');
          }
        }
        z.decal.scale.setScalar(z.r * 1.05);
        if (dCam < 110) {
          const n = z.r * dt * 11;
          const whole = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
          for (let k = 0; k < whole; k++) {
            const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * z.r * 0.92;
            fx.flame(z.x + Math.cos(a) * rr, z.y + 0.1, z.z + Math.sin(a) * rr, 1.5 + z.r * 0.12, 0.05);
          }
          if (Math.random() < dt * 2.2) fx.smokePuff(z.x + rnd(-1, 1) * z.r * 0.5, z.y + 2.6, z.z + rnd(-1, 1) * z.r * 0.5, 2.6, 0x2c2a28);
          if (Math.random() < dt * 5) fx.ember(z.x + rnd(-1, 1) * z.r, z.y + 1, z.z + rnd(-1, 1) * z.r, 1);
        }
        // calor
        const dp = Math.hypot(player.pos.x - z.x, player.pos.z - z.z);
        const flying = player.pos.y > z.y + 3.2;
        if (dp < z.r && !immune && !flying) {
          const nx = (player.pos.x - z.x) / (dp || 1), nz = (player.pos.z - z.z) / (dp || 1);
          player.pos.x += nx * 7 * dt;
          player.pos.z += nz * 7 * dt;
          player.vx = nx * 5;
          player.vz = nz * 5;
          this.heat = Math.min(1, this.heat + dt * 2.2);
          if (!this.heatTipShown) {
            this.heatTipShown = true;
            ctx.tip('heat');
            ctx.ui.banner('find', '🥵 ¡Demasiado calor!', 'Rodea las llamas, no las cruces');
          }
        }
      } else {
        z.out += dt;
        z.decal.material = z.decal.material;
        if (dCam < 90 && Math.random() < dt * 8) fx.smokePuff(z.x + rnd(-1, 1) * z.r * 0.6, z.y + 0.8, z.z + rnd(-1, 1) * z.r * 0.6, 1.6, 0x9a9a9a);
        if (z.out > 3.2) {
          this.group.remove(z.decal);
          this.zones.splice(i, 1);
        }
      }
    }
    this.heat = Math.max(0, this.heat - dt * 1.2);
    ctx.ui.setOverlay('heat', this.heat * 0.9);
    // luces de los 4 focos más cercanos a la cámara
    const near = this.zones.filter((z) => z.state === 'burn').sort((a, b) => Math.hypot(camP.x - a.x, camP.z - a.z) - Math.hypot(camP.x - b.x, camP.z - b.z));
    this.lights.forEach((l, i) => {
      const z = near[i];
      if (z) {
        l.position.set(z.x, z.y + 2.5, z.z);
        l.intensity = damp(l.intensity, 26 + Math.sin(performance.now() / 90 + i) * 5, 6, dt);
      } else l.intensity = damp(l.intensity, 0, 6, dt);
    });
    // ceniza en el aire
    if (Math.random() < dt * 40) fx.smoke.emit(camP.x + rnd(-25, 25), camP.y + rnd(-2, 14), camP.z + rnd(-25, 25), rnd(1, 3), rnd(0.2, 1), rnd(-1, 1), 3, 0.18, 0.12, 0x3a3630, 0x2a2622, 0.5, 0, 0, 0.1);
  }

  dispose() {
    this.ctx.scene.remove(this.group);
    for (const l of this.lights) this.ctx.scene.remove(l);
  }
}

/* ================================================================== */
/*  Terremoto: réplicas, escombros que caen, grietas y bloqueos        */
/* ================================================================== */
class QuakeHazard {
  constructor(ctx) {
    this.ctx = ctx;
    const hz = ctx.hz || 1, base = [
      { t: 16, dur: 6, int: 0.55 }, { t: 62, dur: 7, int: 0.7 }, { t: 108, dur: 7, int: 0.85 },
      { t: 160, dur: 8, int: 1 }, { t: 214, dur: 8, int: 1 }, { t: 265, dur: 6, int: 0.8 },
    ];
    this.quakes = base.map((q) => ({ ...q, t: Math.round(q.t / Math.max(0.8, hz)) }));
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.95, flatShading: true });
    this.rockMat2 = new THREE.MeshStandardMaterial({ color: 0x6a5a4c, roughness: 0.95, flatShading: true });
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.crackTex = (() => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 64;
      const g = c.getContext('2d');
      g.strokeStyle = '#0a0806';
      g.lineWidth = 5;
      g.lineCap = 'round';
      let x = 4, y = 32;
      g.beginPath();
      g.moveTo(x, y);
      while (x < 250) {
        x += 10 + Math.random() * 18;
        y = 32 + (Math.random() - 0.5) * 34;
        g.lineTo(x, y);
      }
      g.stroke();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    this.crackMat = new THREE.MeshBasicMaterial({ map: this.crackTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.reset();
  }

  reset() {
    for (const d of this.debris || []) this.removeDebris(d);
    for (const o of this.static || []) this.removeStatic(o);
    for (const c of this.cracks || []) this.group.remove(c);
    this.debris = [];
    this.static = [];
    this.cracks = [];
    this.active = null;
    this.spawnAcc = 0;
    this.started = new Set();
    this.shake = 0;
    this.nextQ = this.quakes[0].t;
  }

  removeDebris(d) {
    this.group.remove(d.mesh);
    if (d.solid) {
      const i = this.ctx.world.dynSolids.indexOf(d.solid);
      if (i >= 0) this.ctx.world.dynSolids.splice(i, 1);
    }
  }
  removeStatic(o) {
    this.group.remove(o.mesh);
    const i = this.ctx.world.dynSolids.indexOf(o.solid);
    if (i >= 0) this.ctx.world.dynSolids.splice(i, 1);
  }

  urgentAt() {
    return false;
  }

  gauge() {
    const a = this.active;
    if (a) return { label: 'SISMO', pct: this.shake, text: '¡TIEMBLA!', danger: true, color: '#ffb14a' };
    const next = this.quakes.find((q) => !this.started.has(q.t));
    const tt = next ? next.t - this.t : 0;
    return { label: 'SISMO', pct: next ? clamp(1 - tt / 50, 0, 1) : 0, text: next ? `${Math.max(0, Math.ceil(tt))} s` : 'Calma', danger: false, color: '#ffb14a' };
  }

  onPower() { /* poderes genéricos */ }

  makeRock(size, col2) {
    const m = new THREE.Mesh(this.box, col2 ? this.rockMat2 : this.rockMat);
    m.scale.set(size * rnd(0.8, 1.4), size * rnd(0.6, 1.1), size * rnd(0.8, 1.4));
    m.rotation.set(rnd(0, 0.6), rnd(0, TAU), rnd(0, 0.6));
    m.castShadow = true;
    return m;
  }

  spawnDebris(px, pz, intensity) {
    if (this.debris.length > 34) this.removeDebris(this.debris.shift());
    const a = Math.random() * TAU, r = rnd(3, 26);
    const x = clamp(px + Math.cos(a) * r, -96, 96), z = clamp(pz + Math.sin(a) * r, -100, 96);
    const size = rnd(0.6, 1.5) * (0.7 + intensity * 0.5);
    const mesh = this.makeRock(size, Math.random() < 0.4);
    mesh.position.set(x, rnd(18, 30), z);
    this.group.add(mesh);
    this.debris.push({ mesh, x, z, y: mesh.position.y, vy: 0, size, landed: false, solid: null, age: 0 });
  }

  spawnRubble() {
    const inter = this.ctx.sc?.rubbleSites?.length ? this.ctx.sc.rubbleSites : [[-32, -32], [0, -32], [32, -32], [-32, 0], [0, 0], [32, 0], [-32, 32], [0, 32], [32, 32]];
    const [ix, iz] = inter[Math.floor(Math.random() * inter.length)];
    if (this.static.some((o) => Math.hypot(o.x - ix, o.z - iz) < 10)) return;
    const cx = ix + rnd(-3, 3), cz = iz + rnd(-3, 3);
    const { world, fx } = this.ctx;
    for (let k = 0; k < 5; k++) {
      const w = rnd(1.8, 3.4), h = rnd(1.2, 3.6), d = rnd(1.8, 3.4);
      const x = cx + rnd(-3, 3), z = cz + rnd(-2, 2);
      const m = new THREE.Mesh(this.box, k % 2 ? this.rockMat : this.rockMat2);
      const gy = terrainH(x, z);
      m.scale.set(w, h, d);
      m.position.set(x, gy + h / 2 - 0.1, z);
      m.rotation.y = rnd(0, 0.5);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      const solid = { x0: x - w / 2 * 0.95, x1: x + w / 2 * 0.95, y0: gy - 1, y1: gy + h - 0.1, z0: z - d / 2 * 0.95, z1: z + d / 2 * 0.95, tag: 'rubble', dyn: true, dx: 0, dy: 0, dz: 0, _q: 0 };
      world.dynSolids.push(solid);
      this.static.push({ mesh: m, solid, x, z });
      for (let q = 0; q < 6; q++) fx.dustPuff(x, gy + 0.5, z, 1.8);
    }
  }

  crackAt(x, z) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(rnd(7, 13), 2.4), this.crackMat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rnd(0, TAU);
    m.position.set(x, terrainH(x, z) + 0.1, z);
    m.renderOrder = 3;
    this.group.add(m);
    this.cracks.push(m);
    if (this.cracks.length > 44) this.group.remove(this.cracks.shift());
  }

  update(dt, t) {
    this.t = t;
    const { ctx } = this;
    const { player, chase, fx, audio, ui } = ctx;
    // ¿empieza una réplica?
    for (const q of this.quakes) {
      if (t >= q.t && !this.started.has(q.t)) {
        this.started.add(q.t);
        this.active = { ...q, end: q.t + q.dur };
        this.quakeIndex = this.quakes.indexOf(q);
        ui.alert(q.int > 0.9 ? '🏚️ ¡RÉPLICA FUERTE! ¡Protégete!' : '🏚️ ¡TERREMOTO! ¡Agáchate y protégete!', 5000);
        audio.rumble();
        audio.alert();
        if (this.quakeIndex === 0) ctx.tip('start');
        if (this.quakeIndex === 1) ctx.tip('dropcover');
        if (this.quakeIndex === 3) ctx.tip('aftershock');
        for (let i = 0; i < 4; i++) this.crackAt(player.pos.x + rnd(-26, 26), player.pos.z + rnd(-26, 26));
      }
    }
    let intensity = 0;
    if (this.active) {
      const a = this.active;
      const k = (t - a.t) / a.dur;
      intensity = a.int * Math.sin(clamp(k, 0, 1) * Math.PI) ** 0.6 * clamp(0.75 + 0.25 * (ctx.hz || 1), 0.7, 1.4);
      if (t >= a.end) {
        this.active = null;
        this.spawnRubble();
        if (this.quakeIndex >= 2) this.spawnRubble();
        for (let i = 0; i < 3; i++) this.crackAt(player.pos.x + rnd(-30, 30), player.pos.z + rnd(-30, 30));
      }
    }
    this.shake = damp(this.shake, intensity, 6, dt);
    if (intensity > 0.05) {
      chase.shake(0.32 * intensity);
      if (Math.random() < dt * 4) audio.noiseBurst(0.5, 120, 0.25, 'lowpass');
      // el suelo tiembla: el héroe se tambalea
      player.env.slip = 0.5;
      player.env.speedMul = 0.8;
      player.pos.x += Math.sin(t * 47) * 0.6 * intensity * dt;
      player.pos.z += Math.cos(t * 39) * 0.6 * intensity * dt;
      this.spawnAcc += dt * 6 * intensity;
      while (this.spawnAcc > 1) {
        this.spawnAcc -= 1;
        this.spawnDebris(player.pos.x, player.pos.z, intensity);
      }
      if (Math.random() < dt * 14 * intensity) fx.dustPuff(player.pos.x + rnd(-14, 14), 0.3, player.pos.z + rnd(-14, 14), 2.4);
    } else {
      player.env.slip = 1;
      player.env.speedMul = 1;
    }
    ui.setOverlay('dust', this.shake * 0.5);
    // caída de escombros
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.age += dt;
      if (!d.landed) {
        d.vy -= 24 * dt;
        d.y += d.vy * dt;
        d.mesh.position.y = d.y;
        d.mesh.rotation.x += dt * 2;
        // ¿golpea al héroe?
        const dx = d.x - player.pos.x, dz = d.z - player.pos.z;
        if (!(player.shieldT > 0) && Math.abs(dx) < 1.3 && Math.abs(dz) < 1.3 && d.y < player.pos.y + 2.4 && d.y > player.pos.y - 0.2) {
          const l = Math.hypot(dx, dz) || 1;
          player.vx = -dx / l * 9;
          player.vz = -dz / l * 9;
          chase.shake(0.4);
          audio.noiseBurst(0.3, 300, 0.4, 'lowpass');
          ctx.ui.banner('find', '💥 ¡Cuidado!', 'Aléjate de los objetos que caen');
        }
        const gy = Math.max(terrainH(d.x, d.z), this.supportAt(d.x, d.z, d.y));
        if (d.y - d.size * 0.4 <= gy) {
          d.landed = true;
          d.y = gy + d.size * 0.35;
          d.mesh.position.y = d.y;
          d.mesh.rotation.x = rnd(0, 0.5);
          for (let q = 0; q < 3; q++) fx.dustPuff(d.x, gy + 0.3, d.z, 1.5);
          fx.rock(d.x, gy + 0.5, d.z);
          if (Math.hypot(d.x - player.pos.x, d.z - player.pos.z) < 40) audio.noiseBurst(0.25, 200, 0.3, 'lowpass');
          if (d.size > 0.9) {
            d.solid = { x0: d.x - d.size * 0.6, x1: d.x + d.size * 0.6, y0: gy - 1, y1: gy + d.size * 0.7, z0: d.z - d.size * 0.6, z1: d.z + d.size * 0.6, tag: 'rubble', dyn: true, dx: 0, dy: 0, dz: 0, _q: 0 };
            ctx.world.dynSolids.push(d.solid);
          }
        }
      } else if (d.age > 20 && !d.solid) {
        this.removeDebris(d);
        this.debris.splice(i, 1);
      }
    }
  }

  supportAt(x, z, y) {
    let top = -100;
    const near = this.ctx.world.solidsNear(x - 0.5, x + 0.5, z - 0.5, z + 0.5, this._tmp || (this._tmp = []));
    for (const s of near) if (s.y1 < y - 0.5 && s.y1 > top && s.tag !== 'tree') top = s.y1;
    return top;
  }

  dispose() {
    this.reset();
    this.ctx.scene.remove(this.group);
  }
}

/* ================================================================== */
/*  Tormenta de hielo: ventisca, viento, suelo helado y frío           */
/* ================================================================== */
class IceHazard {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.warm = [];
    const spots = (ctx.sc && ctx.sc.warmSpots) || [[0, 50], [-30, 30], [30, 10], [-30, -18], [30, -34], [0, -52], [-6, -78]];
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x3a2a24, roughness: 0.7, metalness: 0.4 });
    const emberMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff8a30).multiplyScalar(2.2) });
    spots.forEach(([x, z], i) => {
      const y = terrainH(x, z);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 1.1, 14), barrelMat);
      b.position.set(x, y + 0.55, z);
      b.castShadow = true;
      this.group.add(b);
      const e = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.06, 14), emberMat);
      e.position.set(x, y + 1.08, z);
      this.group.add(e);
      const ring = new THREE.Mesh(new THREE.RingGeometry(5.4, 6, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff9a40).multiplyScalar(1.3), transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, y + 0.14, z);
      this.group.add(ring);
      const solid = { x0: x - 0.6, x1: x + 0.6, y0: y - 1, y1: y + 1.1, z0: z - 0.6, z1: z + 0.6, tag: 'barrel', dyn: true, dx: 0, dy: 0, dz: 0, _q: 0 };
      ctx.world.dynSolids.push(solid);
      const light = i < 3 ? new THREE.PointLight(0xff8a30, 0, 22, 1.5) : null;
      if (light) { light.position.set(x, y + 2, z); this.group.add(light); }
      this.warm.push({ x, y, z, light, solid });
    });
    this.reset();
  }

  reset() {
    this.cold = 0.05;
    this.coldTip = false;
    this.slideTip = false;
    this.wind = { x: 0, z: 0 };
    this.acc = 0;
  }

  urgentAt() {
    return false;
  }

  gauge() {
    return { label: 'FRÍO', pct: this.cold, text: `${Math.round(this.cold * 100)}%`, danger: this.cold > 0.75, color: '#7ad0ff' };
  }

  onPower(type, pos, hero) {
    if (hero.element === 'fuego' && type === 'dash') {
      this.cold = Math.max(0, this.cold - 0.35);
      for (let i = 0; i < 26; i++) this.ctx.fx.flame(pos.x + rnd(-1, 1), pos.y + 0.4, pos.z + rnd(-1, 1), 1.3, 0.3);
      this.ctx.ui.banner('good', '🔥 ¡Calor!', 'El frío baja un poco');
    }
  }

  update(dt, t) {
    const { ctx } = this;
    const { player, fx, world, ui, hero } = ctx;
    // rachas de viento y nevadas intensas
    const gust = clamp(Math.sin(t * 0.21) * 0.6 + Math.sin(t * 0.83 + 1) * 0.35 + 0.45, 0, 1);
    const whiteout = Math.pow((Math.sin(t * 0.11 + 4.0) + 1) / 2, 3);
    world.setFog(world.fogBase + 0.019 * whiteout);
    const ang = 0.6;
    this.wind.x = Math.cos(ang) * gust * 4.6;
    this.wind.z = Math.sin(ang) * gust * 4.6;
    player.env.wind = this.wind;
    if (world.rain) world.rain.uniforms.uWind.value.set(6 + gust * 14, 0, 2 + gust * 5);
    const icy = hero.element !== 'hielo' && !(player.climbT > 0);
    player.env.slip = icy ? 0.32 : 1;
    const hz = ctx.hz || 1;
    if (icy && !this.slideTip && t > 20) {
      this.slideTip = true;
      ctx.tip('ice');
    }
    if (whiteout > 0.55 && !this.wtip) {
      this.wtip = true;
      ctx.tip('visibility');
    }
    // frío
    let rate = 0.0065 * hz * (1 + gust * 1.2);
    if (hero.element === 'fuego') rate *= 0.25;
    if (player.shieldT > 0) rate *= 0.3;
    let warmNear = false;
    for (const w of this.warm) {
      if (Math.hypot(player.pos.x - w.x, player.pos.z - w.z) < 6 && Math.abs(player.pos.y - w.y) < 4) warmNear = true;
    }
    const S = CFG.SAFE;
    if (Math.hypot(player.pos.x - S.x, player.pos.z - S.z) < S.r + 2 && player.pos.y > S.y - 2.5) warmNear = true;
    this.cold = clamp(this.cold + (warmNear ? -0.11 : rate) * dt, 0, 1);
    if (this.cold > 0.5 && !this.coldTip) {
      this.coldTip = true;
      ctx.tip('cold');
      ui.banner('find', '🥶 ¡Tienes frío!', 'Acércate a una hoguera o al refugio');
    }
    player.env.speedMul = this.cold > 0.75 ? Math.max(0.55, 1 - (this.cold - 0.75) * 1.8) : 1;
    ui.setOverlay('cold', Math.max(0, (this.cold - 0.45) * 1.6));
    // fuego de las hogueras
    const camP = ctx.camera.position;
    for (const w of this.warm) {
      if (Math.hypot(camP.x - w.x, camP.z - w.z) < 70) {
        if (Math.random() < dt * 20) fx.flame(w.x + rnd(-0.25, 0.25), w.y + 1.1, w.z + rnd(-0.25, 0.25), 0.9, 0.05);
        if (Math.random() < dt * 5) fx.ember(w.x, w.y + 1.2, w.z, 0.8);
      }
      if (w.light) w.light.intensity = damp(w.light.intensity, 9 + Math.sin(performance.now() / 110) * 2, 6, dt);
    }
    // copos brillantes cerca
    if (Math.random() < dt * 18) fx.snow(player.pos.x, player.pos.y + 1, player.pos.z);
  }

  dispose() {
    for (const w of this.warm) {
      const i = this.ctx.world.dynSolids.indexOf(w.solid);
      if (i >= 0) this.ctx.world.dynSolids.splice(i, 1);
    }
    this.ctx.scene.remove(this.group);
  }
}

/* ================================================================== */
export class FloodHazard {
  constructor(ctx) { this.ctx = ctx; }
  reset() {}
  update() {}
  urgentAt() { return false; }
  gauge() { return null; }
  onPower() {}
  dispose() {}
}

// Catástrofe final: sismos + incendios + viento con objetos voladores a la vez
class ExtremeHazard {
  constructor(ctx) {
    this.ctx = ctx;
    this.parts = [new QuakeHazard(ctx), new FireHazard(ctx), new HurricaneHazard(ctx, { debrisOnly: true })];
    this.focus = 0;
  }
  reset() { this.parts.forEach((p) => p.reset()); }
  urgentAt(pos) { return this.parts.some((p) => p.urgentAt(pos)); }
  onPower(a, b, c) { this.parts.forEach((p) => p.onPower(a, b, c)); }
  gust(...a) { this.parts[2].gust(...a); }
  cool(f) { this.parts[1].heat = Math.max(0, this.parts[1].heat - f); }
  gauge() {
    const q = this.parts[0].gauge(), f = this.parts[1].gauge();
    return this.parts[0].active || (q.pct > 0.7) ? q : f.pct > 0.1 ? f : q;
  }
  update(dt, t) {
    this.parts[0].update(dt, t);
    this.parts[1].update(dt, t);
    this.parts[2].update(dt, t);
  }
  dispose() { this.parts.forEach((p) => p.dispose()); }
}

export function createHazards(scenario, ctx) {
  switch (scenario) {
    case 'fire': return new FireHazard(ctx);
    case 'quake': return new QuakeHazard(ctx);
    case 'ice': return new IceHazard(ctx);
    case 'volcano': return new VolcanoHazard(ctx);
    case 'hurricane': return new HurricaneHazard(ctx);
    case 'sandstorm': return new SandstormHazard(ctx);
    case 'drought': return new DroughtHazard(ctx);
    case 'extreme': return new ExtremeHazard(ctx);
    default: return new FloodHazard(ctx);
  }
}
