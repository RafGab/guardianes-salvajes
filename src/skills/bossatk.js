import * as THREE from 'three';
import { Attack, Gaze, rnd, TAU } from './attack.js';
import { BOSS_ATTACKS } from './config.js';
import { makeWall, makeTentacle, makeCloud, makeStatue, makeSnake, spiralTexture } from './props.js';
import { makeBossModel } from '../bosses.js';

// ATAQUES DE FIRMA DE LOS JEFES. Todos siguen TELEGRAFIADO → ATAQUE → IMPACTO/VFX → RECUPERACIÓN.
// Aquí vive la lógica de cada ataque; los números salen de skills/config.js (BOSS_ATTACKS) y lo visual de skills/vfx.js.

const DEG = Math.PI / 180;
const ease = (k) => 1 - Math.pow(1 - k, 3);
const lerp = (a, b, k) => a + (b - a) * k;
const ready = (b, key) => (b.extras?.[key] ?? 0) <= b.t;
const setReady = (b, key, cd) => { (b.extras = b.extras || {})[key] = b.t + cd; };

/* ====================================================================== */
/*  MINOTAURO — Laberinto Sísmico                                          */
/*  Grietas → golpe → muros de piedra que forman pasillos → embestida      */
/* ====================================================================== */
class MinotauroAtk extends Attack {
  build() {
    const c = this.cfg, b = this.b, p = this.player.pos;
    // eje cardinal (los muros van alineados con X o con Z): el del héroe más lejano al jefe
    const dx = p.x - b.pos.x, dz = p.z - b.pos.z;
    this.alongX = Math.abs(dx) > Math.abs(dz);
    this.s = (this.alongX ? dx : dz) >= 0 ? 1 : -1;
    const lat = this.alongX ? p.z : p.x, latC = this.alongX ? b.arena.z : b.arena.x;
    this.lat = Math.max(latC - b.arena.r * 0.5, Math.min(latC + b.arena.r * 0.5, lat));
    this.a0 = this.alongX ? b.pos.x : b.pos.z; // posición del jefe a lo largo del eje
    this.pitch = c.wallGap + c.wallThick;
    this.capA = this.a0 + this.s * c.wallLen;  // muro del fondo (indestructible)
    this.stunned = false;
    this.walls = [];
    this.cross = [];
    this.lane = null;

    return [
      { name: 'telegrafiado', dur: c.telegraph, enter: this.enterTelegraph, tick: this.tickTelegraph },
      { name: 'golpe', dur: 0.3, enter: this.enterSlam, tick: (dt, k) => { this.b.anim.rx = lerp(-0.2, 0.3, ease(k)); } },
      { name: 'muros', dur: c.riseT, enter: this.enterRise, tick: this.tickRise, exit: this.exitRise },
      { name: 'embestida', dur: c.chargeMax, enter: this.enterCharge, tick: this.tickCharge, exit: this.exitCharge },
      { name: 'aturdido', dur: 0, tick: (dt, k) => { this.b.anim.rx = 0.25 * Math.sin(this.t * 14) * (1 - k); } },
      { name: 'recuperacion', dur: c.recover, tick: (dt, k) => { this.b.anim.rx = lerp(0.15, 0, k); this.b.anim.dy = 0; } },
    ];
  }
  w2(a, l) { return this.alongX ? { x: a, z: l } : { x: l, z: a }; }

  enterTelegraph() {
    const c = this.cfg, b = this.b;
    this.slamTg = this.track(this.vfx.telegraph('disc', { x: b.pos.x, z: b.pos.z, r: c.slamRadius, color: 0xff6a1a }));
    const a = this.w2(this.a0, this.lat), z = this.w2(this.capA, this.lat);
    this.lane = this.track(this.vfx.telegraph('strip', { x: a.x, z: a.z, x2: z.x, z2: z.z, width: c.wallGap * 0.92, color: 0xff3a1a }));
    // las grietas marcan dónde saldrán los muros
    this.wallTgs = [];
    for (let k = 0; k < c.walls; k++) {
      const off = (k - (c.walls - 1) / 2) * this.pitch;
      if (!this.wallInArena(off)) continue;
      const p0 = this.w2(this.a0 - this.s * 1.5, this.lat + off), p1 = this.w2(this.capA, this.lat + off);
      this.wallTgs.push(this.track(this.vfx.telegraph('strip', { x: p0.x, z: p0.z, x2: p1.x, z2: p1.z, width: c.wallThick, color: 0xd8a050, opacity: 0.4 })));
    }
    this.crackT = 0;
  }
  wallInArena(off) {
    const m = this.w2(this.a0 + this.s * this.cfg.wallLen * 0.5, this.lat + off), a = this.b.arena;
    return Math.hypot(m.x - a.x, m.z - a.z) < a.r + 4;
  }
  tickTelegraph(dt, k) {
    const b = this.b;
    this.slamTg.setProgress(k);
    this.lane.setProgress(k);
    for (const w of this.wallTgs) w.setProgress(k);
    // el jefe se coloca en el pasillo y se encoge para el golpe
    const cur = this.alongX ? b.pos.z : b.pos.x, nl = cur + (this.lat - cur) * Math.min(1, 5 * dt);
    if (this.alongX) b.pos.z = nl; else b.pos.x = nl;
    b.facing = this.alongX ? (this.s > 0 ? Math.PI / 2 : -Math.PI / 2) : (this.s > 0 ? 0 : Math.PI);
    b.anim.dy = -b.S.height * 0.06 * k;
    b.anim.rx = -0.2 * k;
    this.crackT -= dt;
    if (this.crackT <= 0) { // vibración del suelo y polvo en las grietas
      this.crackT = 0.12;
      this.shake(0.05 + 0.1 * k);
      const a = this.a0 + this.s * rnd(0, this.cfg.wallLen), off = (Math.floor(rnd(0, this.cfg.walls)) - (this.cfg.walls - 1) / 2) * this.pitch, q = this.w2(a, this.lat + off);
      this.vfx.dust(q.x, this.gy(q.x, q.z) + 0.1, q.z, 2, 1.1);
    }
  }
  enterSlam() {
    const b = this.b, c = this.cfg;
    this.slamTg.kill();
    this.shake(0.4); this.boom(0.5, 90, 0.6);
    this.vfx.ring(b.pos.x, null, b.pos.z, { r0: 1, r1: c.slamRadius, dur: 0.5, color: 0xffb060 });
    this.vfx.dust(b.pos.x, this.gy(b.pos.x, b.pos.z) + 0.2, b.pos.z, 12, 2.2);
    if (this.playerInCircle(b.pos.x, b.pos.z, c.slamRadius)) {
      this.hurt();
      this.combat.pushPlayer(this.player.pos.x - b.pos.x, this.player.pos.z - b.pos.z, 10);
    }
  }
  enterRise() {
    const c = this.cfg, b = this.b;
    this.shake(0.3);
    const lingerWalls = [];
    for (let k = 0; k < c.walls; k++) {
      const off = (k - (c.walls - 1) / 2) * this.pitch;
      if (!this.wallInArena(off)) continue;
      const aMin = Math.min(this.a0 - this.s * 1.5, this.capA), aMax = Math.max(this.a0 - this.s * 1.5, this.capA);
      lingerWalls.push(this.makeWallPiece(aMin, aMax, this.lat + off, c.wallH, true));
    }
    // muro del fondo: cierra el pasillo y no se rompe
    const cap = this.makeWallPiece(Math.min(this.capA, this.capA + this.s * c.wallThick), Math.max(this.capA, this.capA + this.s * c.wallThick), this.lat, c.wallH * 1.15, true, c.wallGap + c.wallThick * 2);
    this.cap = cap;
    lingerWalls.push(cap);
    // muros bajos dentro del pasillo: la embestida los rompe
    for (let i = 0; i < c.cross; i++) {
      const a = this.a0 + this.s * (c.wallLen * (0.3 + 0.28 * i));
      const w = this.makeWallPiece(a - c.wallThick / 2, a + c.wallThick / 2, this.lat, c.wallH * 0.72, false, c.wallGap - 0.3);
      w.breakable = true; w.a = a;
      this.cross.push(w);
      lingerWalls.push(w);
    }
    this.walls = lingerWalls;
    const walls = this.walls;
    // los muros sobreviven al ataque (wallLife s) y se hunden al final; los gestiona Combat
    const obj = {
      life: c.wallLife,
      update: () => {
        if (obj.life > 0.9) return;
        for (const w of walls) if (!w.gone) { w.group.scale.y = Math.max(0.01, obj.life / 0.9); w.solid.y1 = w.solid.y0 + w.h * w.group.scale.y; }
      },
      end: () => { for (const w of walls) this.destroyWall(w, false); },
    };
    this.linger(obj);
    this.wallTgs.forEach((w) => w.kill());
    this.lane.kill();
    b.anim.dy = 0;
  }
  // Un tramo de muro: a0..a1 a lo largo del eje, `thick` de ancho lateral. El sólido es un AABB (los muros van alineados con los ejes).
  makeWallPiece(a0, a1, lat, h, solidWall, thickOverride) {
    const c = this.cfg, thick = thickOverride ?? c.wallThick, len = a1 - a0;
    const { group } = makeWall(len, thick, h);
    const mid = this.w2((a0 + a1) / 2, lat);
    const gy = this.gy(mid.x, mid.z);
    group.position.set(mid.x, gy - 0.05, mid.z);
    if (!this.alongX) group.rotation.y = Math.PI / 2;
    group.scale.y = 0.01;
    this.vfx.group.add(group);
    const hx = this.alongX ? len / 2 : thick / 2, hz = this.alongX ? thick / 2 : len / 2;
    const solid = { x0: mid.x - hx, x1: mid.x + hx, y0: gy - 0.2, y1: gy - 0.2, z0: mid.z - hz, z1: mid.z + hz, tag: 'wall', dyn: true, dx: 0, dy: 0, dz: 0, _q: 0 };
    this.ctx.world.dynSolids.push(solid);
    return { group, solid, h: h + 0.2, gone: false, breakable: false };
  }
  destroyWall(w, withFx = true) {
    if (w.gone) return;
    w.gone = true;
    this.vfx.group.remove(w.group);
    const i = this.ctx.world.dynSolids.indexOf(w.solid);
    if (i >= 0) this.ctx.world.dynSolids.splice(i, 1);
    if (withFx) {
      const m = w.group.position;
      this.vfx.dust(m.x, m.y + 0.5, m.z, 10, 2);
      this.vfx.sparks(m.x, m.y + 1, m.z, 0xd8b070, 12, 3);
      this.shake(0.25); this.boom(0.4, 140, 0.4);
    }
  }
  tickRise(dt, k) {
    const e = ease(k);
    for (const w of this.walls) { w.group.scale.y = Math.max(0.01, e); w.solid.y1 = w.solid.y0 + w.h * e; this.ejectPlayerFrom(w.solid); }
    this.shake(0.1);
    if (Math.random() < 0.5) { const m = this.walls[Math.floor(Math.random() * this.walls.length)].group.position; this.vfx.dust(m.x + rnd(-3, 3), m.y + 0.1, m.z + rnd(-3, 3), 2, 1.2); }
  }
  exitRise() { for (const w of this.walls) { w.group.scale.y = 1; w.solid.y1 = w.solid.y0 + w.h; } }

  enterCharge() {
    this.ctx.audio.noiseBurst(0.35, 150, 0.4, 'lowpass');
    this.b.anim.rx = 0.3;
    this.b.anim.dy = 0;
  }
  tickCharge(dt) {
    const c = this.cfg, b = this.b, st = this.stages[this.i];
    const sp = b.st.root > 0 ? 0 : c.chargeSpeed;
    if (this.alongX) b.pos.x += this.s * sp * dt; else b.pos.z += this.s * sp * dt;
    const a = this.alongX ? b.pos.x : b.pos.z;
    for (const w of this.cross) if (!w.gone && (a - w.a) * this.s > -b.S.radius * 0.5) this.destroyWall(w);
    if (this.t > 0.08 && Math.hypot(this.player.pos.x - b.pos.x, this.player.pos.z - b.pos.z) < b.hitDist) {
      this.hurt();
      this.combat.pushPlayer(this.player.pos.x - b.pos.x, this.player.pos.z - b.pos.z, 9);
      st.dur = this.t; // fin de la embestida
    }
    if ((this.capA - a) * this.s <= b.S.radius + 0.4) { // choca con el muro del fondo
      this.stunned = true;
      this.shake(0.5); this.boom(0.6, 80, 0.7);
      const m = this.cap.group.position;
      this.vfx.dust(m.x, m.y + 1, m.z, 14, 2.4);
      this.vfx.ring(b.pos.x, null, b.pos.z, { r0: 1, r1: 6, dur: 0.5, color: 0xc8b090 });
      st.dur = this.t;
    }
    if (Math.random() < 0.6) this.vfx.dust(b.pos.x + rnd(-0.6, 0.6), this.gy(b.pos.x, b.pos.z) + 0.2, b.pos.z + rnd(-0.6, 0.6), 1, 1.2);
    const d0 = Math.hypot(b.pos.x - b.arena.x, b.pos.z - b.arena.z);
    if (d0 > b.arena.r + 3) st.dur = this.t;
  }
  exitCharge() { this.stages[this.i + 1].dur = this.stunned ? this.cfg.stunT : 0; }
}

/* ====================================================================== */
/*  KRAKEN — Abismo Tentacular (+ remolino gigante)                        */
/* ====================================================================== */
class KrakenAtk extends Attack {
  build() {
    const c = this.cfg, b = this.b;
    this.whirl = b.phase >= 2 && ready(b, 'whirl') && Math.random() < 0.55;
    if (this.whirl) { setReady(b, 'whirl', c.whirl.cd); return this.buildWhirl(); }
    this.n = c.zones[Math.min(c.zones.length - 1, b.phase - 1)];
    return [
      { name: 'sombras', dur: c.telegraph, enter: this.enterShadows, tick: this.tickShadows },
      { name: 'tentaculos', dur: c.strikeT, enter: this.enterStrike, tick: this.tickStrike },
      { name: 'mantiene', dur: c.hold, tick: () => { this.setTentacles(c.riseH); } },
      { name: 'retira', dur: 0.45, tick: (dt, k) => { this.setTentacles(c.riseH * (1 - ease(k))); }, exit: this.exitStrike },
      { name: 'recuperacion', dur: c.recover, tick: (dt, k) => { this.b.anim.dy = lerp(this.b.anim.dy, 0, k); } },
    ];
  }
  enterShadows() {
    const c = this.cfg, b = this.b, a = b.aimPoint();
    this.zones = [{ x: a.x, z: a.z }];
    for (let i = 1; i < this.n; i++) {
      const ang = rnd(0, TAU), d = rnd(2.8, 6.8);
      let x = a.x + Math.cos(ang) * d, z = a.z + Math.sin(ang) * d;
      const r0 = Math.hypot(x - b.arena.x, z - b.arena.z);
      if (r0 > b.arena.r * 0.92) { x = b.arena.x + ((x - b.arena.x) / r0) * b.arena.r * 0.92; z = b.arena.z + ((z - b.arena.z) / r0) * b.arena.r * 0.92; }
      this.zones.push({ x, z });
    }
    this.tgs = this.zones.map((z) => this.track(this.vfx.telegraph('disc', { x: z.x, z: z.z, r: c.zoneRadius, color: 0x1a4a9a, opacity: 0.5 })));
    this.tents = [];
  }
  tickShadows(dt, k) {
    this.tgs.forEach((t) => t.setProgress(k));
    this.b.anim.dy = this.b.S.height * 0.05 * k; // se alza sobre el agua
    for (const z of this.zones) if (Math.random() < 0.25) this.vfx.splash(z.x + rnd(-1, 1), this.gy(z.x, z.z) + 0.1, z.z + rnd(-1, 1), 1, 0.4);
    this.faceTowards(this.player.pos.x, this.player.pos.z, dt);
  }
  enterStrike() {
    const c = this.cfg;
    this.zones.forEach((z) => {
      const t = makeTentacle();
      t.group.position.set(z.x, this.gy(z.x, z.z) - 0.1, z.z);
      t.group.rotation.y = rnd(0, TAU);
      this.vfx.group.add(t.group);
      this.track({ kill: () => this.vfx.group.remove(t.group) });
      this.tents.push(t);
    });
    this.tgs.forEach((t) => t.kill());
    this.shake(0.35); this.boom(0.45, 120, 0.5);
    this.hitDone = false;
  }
  setTentacles(h) { for (const t of this.tents) t.setHeight(Math.max(0.05, h)); }
  tickStrike(dt, k) {
    const c = this.cfg;
    this.setTentacles(c.riseH * ease(k));
    if (!this.hitDone && k > 0.5) { // el golpe cae cuando el tentáculo ya está alto
      this.hitDone = true;
      for (const z of this.zones) {
        this.vfx.splash(z.x, this.gy(z.x, z.z) + 0.2, z.z, 18, 1.4);
        this.vfx.ring(z.x, null, z.z, { r0: 0.5, r1: c.zoneRadius + 1.2, dur: 0.5, color: 0x9ad8ff });
        if (this.playerInCircle(z.x, z.z, c.zoneRadius)) { this.hurt(); this.combat.pushPlayer(this.player.pos.x - z.x, this.player.pos.z - z.z, 7); }
      }
    }
  }
  exitStrike() { this.setTentacles(0.05); }

  /* ----- remolino gigante: tira de todo hacia el centro ----- */
  buildWhirl() {
    const w = this.cfg.whirl;
    return [
      { name: 'remolino-aviso', dur: w.telegraph, enter: this.enterWhirlTg, tick: this.tickWhirlTg },
      { name: 'remolino', dur: w.duration, enter: this.enterWhirl, tick: this.tickWhirl },
      { name: 'calma', dur: 0.8, tick: (dt, k) => { this.spiral.material.opacity = 0.7 * (1 - k); this.b.anim.dy = lerp(this.b.anim.dy, 0, k); } },
    ];
  }
  enterWhirlTg() {
    const a = this.b.arena;
    this.cx = a.x; this.cz = a.z;
    this.wtg = this.track(this.vfx.telegraph('disc', { x: this.cx, z: this.cz, r: this.cfg.whirl.radius, color: 0x2a7aff, opacity: 0.35 }));
    this.ctx.ui.alert('🌀 ¡El Kraken abre un remolino! Aléjate del centro', 2600);
  }
  tickWhirlTg(dt, k) {
    this.wtg.setProgress(k);
    this.b.anim.dy = this.b.S.height * 0.08 * k;
    if (Math.random() < 0.5) { const ang = rnd(0, TAU), r = rnd(0.3, 1) * this.cfg.whirl.radius; this.vfx.splash(this.cx + Math.cos(ang) * r, this.gy(this.cx, this.cz) + 0.1, this.cz + Math.sin(ang) * r, 2, 0.5); }
  }
  enterWhirl() {
    const w = this.cfg.whirl, wy = this.ctx.world.waterY;
    this.wtg.kill();
    const tex = spiralTexture();
    this.spiral = new THREE.Mesh(new THREE.CircleGeometry(w.radius, 48), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    this.spiral.rotation.x = -Math.PI / 2;
    this.spiral.position.set(this.cx, Math.max(this.gy(this.cx, this.cz), Number.isFinite(wy) ? wy : 0) + 0.14, this.cz);
    this.spiral.renderOrder = 3;
    this.prop(this.spiral);
    this.shake(0.3); this.boom(0.4, 90, 0.8);
    this.core = this.track(this.vfx.telegraph('disc', { x: this.cx, z: this.cz, r: w.coreRadius, color: 0xff2a3a, opacity: 0.45 }));
    this.core.setProgress(1);
  }
  tickWhirl(dt, k) {
    const w = this.cfg.whirl, p = this.player.pos;
    this.spiral.rotation.z -= dt * (1.6 + 2.4 * k); // gira más rápido a medida que avanza
    const pull = lerp(w.pullMin, w.pullMax, k); // la fuerza crece progresivamente
    const dx = this.cx - p.x, dz = this.cz - p.z, d = Math.hypot(dx, dz);
    if (d < w.radius && !this.player.scripted) {
      this.combat.dragPlayer(dx, dz, pull * (0.45 + 0.55 * (1 - d / w.radius)));
      if (d < w.coreRadius + this.player.R) this.hurtCore();
    }
    for (const m of this.combat.minions) { // los esbirros también caen al centro
      if (m.dead) continue;
      const mx = this.cx - m.pos.x, mz = this.cz - m.pos.z, md = Math.hypot(mx, mz);
      if (md < w.radius) { m.vel.x += (mx / (md || 1)) * pull * 3 * dt; m.vel.z += (mz / (md || 1)) * pull * 3 * dt; if (md < w.coreRadius) this.combat.damage(m, 1); }
    }
    if (Math.random() < 0.7) { const ang = rnd(0, TAU), r = rnd(0.2, 1) * w.radius; this.vfx.splash(this.cx + Math.cos(ang) * r, this.gy(this.cx, this.cz) + 0.1, this.cz + Math.sin(ang) * r, 2, 0.7); }
    this.shake(0.06 + 0.05 * k);
  }
  hurtCore() { this.hurt(); }
}

/* ====================================================================== */
/*  CERBERO — Triple Aliento (fuego / hielo / energía espectral)           */
/* ====================================================================== */
const HEADS = {
  fire: { side: -1, key: 'fire', name: '🔥 Fuego' },
  ghost: { side: 0, key: 'ghost', name: '👻 Espectral' },
  ice: { side: 1, key: 'ice', name: '❄️ Hielo' },
};
class CerberoAtk extends Attack {
  build() {
    const c = this.cfg, b = this.b;
    const triple = b.phase >= 2 && ready(b, 'triple') && Math.random() < 0.5;
    if (triple) {
      setReady(b, 'triple', c.triple.cd);
      return [
        { name: 'triple-aviso', dur: c.triple.telegraph, enter: this.enterTriple, tick: this.tickTriple },
        { name: 'triple-aliento', dur: c.attackT * 1.5, enter: this.enterTripleFire, tick: this.tickTripleFire },
        { name: 'recuperacion', dur: c.recover, tick: (dt, k) => { this.b.anim.rx = lerp(this.b.anim.rx, 0, k); } },
      ];
    }
    const order = ['fire', 'ice', 'ghost'].sort(() => Math.random() - 0.5);
    const n = b.phase >= 3 ? 2 : 1; // en la fase final encadena dos cabezas
    const st = [];
    for (let i = 0; i < n; i++) {
      const key = order[i];
      st.push({ name: `aviso-${key}`, dur: c.telegraph, enter: () => this.enterHead(key), tick: (dt, k) => this.tickHeadTg(key, dt, k) });
      st.push({ name: `aliento-${key}`, dur: c.attackT, enter: () => this.enterHeadFire(key), tick: (dt, k) => this.tickHeadFire(key, dt, k) });
    }
    st.push({ name: 'recuperacion', dur: c.recover, tick: (dt, k) => { this.b.anim.rx = lerp(this.b.anim.rx, 0, k); } });
    return st;
  }
  headPos(side) {
    const b = this.b;
    return this.local(b.S.radius * 0.95, side * b.S.radius * 0.5, this.gy(b.pos.x, b.pos.z) + b.S.height * 0.72);
  }
  spec(key) { return this.cfg[key]; }

  /* una cabeza */
  enterHead(key) {
    const sp = this.spec(key), h = this.headPos(HEADS[key].side), b = this.b;
    this.aim = Math.atan2(this.player.pos.x - h.x, this.player.pos.z - h.z);
    if (key === 'ghost') {
      this.tg = this.track(this.vfx.telegraph('strip', { x: h.x, z: h.z, x2: h.x + Math.sin(this.aim) * 14, z2: h.z + Math.cos(this.aim) * 14, width: 1.8, color: sp.color, opacity: 0.4 }));
    } else {
      this.tg = this.track(this.vfx.telegraph('cone', { x: h.x, z: h.z, angle: this.aim, half: sp.coneDeg * DEG, range: sp.range, color: sp.color }));
    }
    this.eye = this.vfx.orb(h, { r: 0.2, color: sp.color, life: this.cfg.telegraph, grow: 3 });
    this.ctx.ui.alert(`🐕 Cabeza de ${HEADS[key].name}`, 900);
  }
  tickHeadTg(key, dt, k) {
    const h = this.headPos(HEADS[key].side);
    this.tg.setProgress(k);
    if (k < 0.65) { // sigue al héroe mientras carga y luego fija el aviso
      this.aim = Math.atan2(this.player.pos.x - h.x, this.player.pos.z - h.z);
      this.tg.set(h.x, h.z, key === 'ghost' ? { x2: h.x + Math.sin(this.aim) * 14, z2: h.z + Math.cos(this.aim) * 14 } : { angle: this.aim });
      this.faceTowards(this.player.pos.x, this.player.pos.z, dt, 5);
    }
    this.b.anim.rx = -0.12 * k;
    const sp = this.spec(key);
    this.fx(key, h, 0.3);
  }
  fx(key, h, chance) {
    if (Math.random() > chance) return;
    if (key === 'fire') this.vfx.fire(h.x, h.y - 0.3, h.z, 1, 0.9);
    else if (key === 'ice') this.vfx.ice(h.x, h.y - 0.3, h.z, 1);
    else this.vfx.sparks(h.x, h.y, h.z, 0xb070ff, 2, 1.5);
  }
  enterHeadFire(key) {
    this.hitCd = 0;
    this.shake(0.15); this.boom(0.3, key === 'ice' ? 900 : 200, 0.4);
    this.b.anim.rx = 0.12;
    this.shots = 0;
  }
  // ráfaga de orbes espectrales que persiguen al héroe (se pueden desviar con viento)
  fireGhost() {
    const g = this.spec('ghost'), h = this.headPos(0);
    const dir = new THREE.Vector3(this.player.pos.x - h.x, this.player.pos.y + this.player.H * 0.5 - h.y, this.player.pos.z - h.z).normalize();
    this.combat.fire({ pos: h.clone(), vel: dir.multiplyScalar(g.speed), radius: g.radius, color: g.color, life: g.life, homing: g.homing, light: true });
    this.vfx.sparks(h.x, h.y, h.z, g.color, 5, 2);
  }
  tickHeadFire(key, dt, k) {
    const h = this.headPos(HEADS[key].side), sp = this.spec(key);
    this.hitCd -= dt;
    this.tg.setProgress(1);
    if (key === 'ghost') {
      while (this.shots < 3 && this.t >= this.shots * 0.22) { this.fireGhost(); this.shots++; }
      return;
    }
    // aliento continuo a lo largo del cono
    for (let i = 0; i < 2; i++) {
      const d = rnd(1, sp.range), a = this.aim + rnd(-1, 1) * sp.coneDeg * DEG * 0.7, x = h.x + Math.sin(a) * d, z = h.z + Math.cos(a) * d, y = this.gy(x, z);
      if (key === 'fire') this.vfx.fire(x, y + 0.3, z, 1, 1.4); else this.vfx.ice(x, y + 0.5, z, 1);
    }
    if (this.hitCd <= 0 && this.playerInCone(h.x, h.z, this.aim, sp.coneDeg * DEG, sp.range) && !this.blocked(h.x, h.z, this.player.pos.x, this.player.pos.z)) {
      this.hitCd = 0.5;
      this.hurt();
      if (key === 'ice') this.combat.slowPlayer(sp.slowF, sp.slowT);
    }
  }

  /* las tres cabezas a la vez: tres zonas de peligro */
  enterTriple() {
    const c = this.cfg, b = this.b;
    this.base = Math.atan2(this.player.pos.x - b.pos.x, this.player.pos.z - b.pos.z);
    this.cones = [];
    for (const [i, key] of ['fire', 'ghost', 'ice'].entries()) {
      const sp = this.spec(key), a = this.base + (i - 1) * c.triple.spread * DEG, h = this.headPos(HEADS[key].side);
      const half = (c.triple.spread / 3) * DEG;
      const range = key === 'ghost' ? 12 : sp.range;
      this.cones.push({ key, a, half, range, h, tg: this.track(this.vfx.telegraph('cone', { x: h.x, z: h.z, angle: a, half, range, color: sp.color })) });
      this.vfx.orb(h, { r: 0.2, color: sp.color, life: c.triple.telegraph, grow: 3.5 });
    }
    this.ctx.ui.alert('🐕 ¡Triple Aliento! Busca el hueco entre las tres llamaradas', 2200);
  }
  tickTriple(dt, k) {
    for (const c of this.cones) { c.tg.setProgress(k); c.h = this.headPos(HEADS[c.key].side); this.fx(c.key, c.h, 0.25); }
    this.faceTowards(this.b.pos.x + Math.sin(this.base) * 10, this.b.pos.z + Math.cos(this.base) * 10, dt, 3);
    this.b.anim.rx = -0.16 * k;
    this.shake(0.04 + 0.05 * k);
  }
  enterTripleFire() {
    this.hitCd = 0;
    this.shake(0.4); this.boom(0.5, 160, 0.7);
    this.b.anim.rx = 0.15;
  }
  tickTripleFire(dt) {
    this.hitCd -= dt;
    for (const c of this.cones) {
      const sp = this.spec(c.key);
      for (let i = 0; i < 2; i++) {
        const d = rnd(1, c.range), a = c.a + rnd(-1, 1) * c.half, x = c.h.x + Math.sin(a) * d, z = c.h.z + Math.cos(a) * d, y = this.gy(x, z);
        if (c.key === 'fire') this.vfx.fire(x, y + 0.3, z, 1, 1.4); else if (c.key === 'ice') this.vfx.ice(x, y + 0.5, z, 1); else this.vfx.sparks(x, y + 0.8, z, 0xb070ff, 3, 2);
      }
      if (this.hitCd <= 0 && this.playerInCone(c.h.x, c.h.z, c.a, c.half, c.range) && !this.blocked(c.h.x, c.h.z, this.player.pos.x, this.player.pos.z)) {
        this.hitCd = 0.5;
        this.hurt();
        if (c.key === 'ice') this.combat.slowPlayer(sp.slowF, sp.slowT);
      }
    }
  }
}

/* ====================================================================== */
/*  BASILISCO — Mirada Petrificante                                        */
/* ====================================================================== */
class BasiliscoAtk extends Attack {
  build() {
    const c = this.cfg;
    return [
      { name: 'ojos', dur: c.telegraph, enter: this.enterEyes, tick: this.tickEyes },
      { name: 'mirada', dur: c.duration, enter: this.enterGaze, tick: this.tickGaze },
      { name: 'recuperacion', dur: c.recover, tick: (dt, k) => { this.b.anim.dy = lerp(this.b.anim.dy, 0, k); } },
    ];
  }
  eyes() { return this.local(this.b.S.radius * 0.9, 0, this.headY); }
  enterEyes() {
    const c = this.cfg, b = this.b;
    this.gaze = new Gaze(this, { range: c.range, half: c.coneDeg * DEG, track: c.track, exposure: c.exposure, petrifyT: c.petrifyT, fade: c.fade });
    this.tg = this.track(this.vfx.telegraph('cone', { x: b.pos.x, z: b.pos.z, angle: b.facing, half: this.gaze.half, range: c.range, color: 0xffd23a, opacity: 0.3 }));
    this.ctx.ui.alert('🐉 ¡Los ojos del Basilisco brillan! Ponte a cubierto', 2200);
  }
  tickEyes(dt, k) {
    const e = this.eyes();
    this.faceTowards(this.player.pos.x, this.player.pos.z, dt, 5);
    this.tg.set(this.b.pos.x, this.b.pos.z, { angle: this.b.facing });
    this.tg.setProgress(k * 0.5);
    if (Math.random() < 0.35) this.vfx.orb(e, { r: 0.1 + 0.5 * k, color: 0xffe060, life: 0.25, grow: 1.5 });
    this.b.anim.dy = this.b.S.height * 0.05 * k; // se alza
  }
  enterGaze() {
    this.gaze.facing = this.b.facing;
    this.shake(0.2); this.boom(0.3, 600, 0.5);
  }
  tickGaze(dt) {
    const g = this.gaze, b = this.b;
    g.step(dt, this.cfg.track);
    this.tg.set(b.pos.x, b.pos.z, { angle: g.facing });
    this.tg.setProgress(0.5 + 0.5 * Math.min(1, g.exp / this.cfg.exposure)); // se llena según la exposición del héroe
    const e = this.eyes();
    this.vfx.orb(e, { r: 0.35, color: 0xffe060, life: 0.12 });
    for (let i = 0; i < 2; i++) { // energía a lo largo del cono
      const d = rnd(1.5, this.cfg.range), a = g.facing + rnd(-1, 1) * g.half, x = b.pos.x + Math.sin(a) * d, z = b.pos.z + Math.cos(a) * d;
      this.vfx.sparks(x, this.gy(x, z) + rnd(0.3, 1.8), z, 0xffd23a, 1, 1.2);
    }
  }
}

/* ====================================================================== */
/*  DRAGÓN LONG — Danza de la Tormenta                                     */
/* ====================================================================== */
class LongAtk extends Attack {
  build() {
    const c = this.cfg;
    return [
      { name: 'danza', dur: c.danceT + c.strikeTelegraph + 0.5, enter: this.enterDance, tick: this.tickDance, exit: this.exitDance },
      { name: 'barrido-aviso', dur: c.sweepTelegraph, enter: this.enterSweepTg, tick: this.tickSweepTg },
      { name: 'barrido', dur: 2.2, enter: this.enterSweep, tick: this.tickSweep, exit: this.exitSweep },
      { name: 'recuperacion', dur: c.recover, tick: (dt, k) => { this.b.anim.rx = lerp(this.b.anim.rx, 0, k); this.b.anim.dy = lerp(this.b.anim.dy, 0, k); } },
    ];
  }
  enterDance() {
    const c = this.cfg, b = this.b, a = b.arena;
    this.clouds = [];
    this.strikes = [];
    const a0 = Math.atan2(b.pos.z - a.z, b.pos.x - a.x);
    for (let i = 0; i < c.clouds; i++) {
      const ang = a0 + (i / c.clouds) * TAU + rnd(-0.2, 0.2), r = a.r * rnd(0.45, 0.75);
      const x = a.x + Math.cos(ang) * r, z = a.z + Math.sin(ang) * r;
      const cl = makeCloud(c.cloudR);
      cl.group.position.set(x, this.gy(x, z) + c.cloudH, z);
      cl.group.scale.setScalar(0.01);
      this.vfx.group.add(cl.group);
      this.track({ kill: () => this.vfx.group.remove(cl.group) });
      this.clouds.push({ x, z, ...cl, grow: 0, flash: 0, visited: false });
    }
    // orden del vuelo: serpentea de nube en nube por el contorno
    this.legT = c.danceT / c.clouds;
    this.from = { x: b.pos.x, z: b.pos.z };
    this.ctx.ui.alert('🐲 ¡Long vuela entre las nubes! Los rayos caerán donde estés', 2400);
  }
  tickDance(dt) {
    const c = this.cfg, b = this.b, t = this.t;
    for (const cl of this.clouds) { cl.grow = Math.min(1, cl.grow + dt * 1.6); cl.group.scale.setScalar(cl.grow); cl.flash = Math.max(0, cl.flash - dt * 2); cl.mat.emissive.setRGB(cl.flash * 0.9, cl.flash * 0.9, cl.flash * 1.2); }
    if (t < c.danceT) {
      const li = Math.min(c.clouds - 1, Math.floor(t / this.legT)), lk = (t - li * this.legT) / this.legT;
      const from = li === 0 ? this.from : this.clouds[li - 1], to = this.clouds[li];
      const dx = to.x - from.x, dz = to.z - from.z, len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len;
      const wob = Math.sin(lk * Math.PI * 2) * 3.2 * Math.sin(lk * Math.PI); // serpentea
      const px = lerp(from.x, to.x, lk) + nx * wob, pz = lerp(from.z, to.z, lk) + nz * wob;
      b.facing = Math.atan2(px - b.pos.x, pz - b.pos.z);
      b.pos.x = px; b.pos.z = pz;
      b.anim.dy = (c.cloudH - b.S.fly) * Math.sin(lk * Math.PI) * 0.8;
      b.anim.rx = -0.25 * Math.cos(lk * Math.PI * 2);
      if (lk > 0.82 && !to.visited) this.passCloud(to);
    } else {
      b.anim.dy = lerp(b.anim.dy, 0, 3 * dt);
    }
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.t += dt;
      s.tg.setProgress(s.t / c.strikeTelegraph);
      if (Math.random() < 0.3) this.vfx.sparks(s.x, this.gy(s.x, s.z) + 0.3, s.z, 0xbfe8ff, 1, 1);
      if (s.t >= c.strikeTelegraph) { this.land(s); s.tg.kill(); this.strikes.splice(i, 1); }
    }
  }
  passCloud(cl) {
    const c = this.cfg, p = this.player.pos, g = this.ctx.world;
    cl.visited = true;
    cl.flash = 1;
    const cy = this.gy(cl.x, cl.z) + c.cloudH;
    // ráfaga fuerte: empuja al héroe si está cerca de la nube
    const d = Math.hypot(p.x - cl.x, p.z - cl.z);
    if (d < 7) this.combat.pushPlayer(p.x - cl.x, p.z - cl.z, c.gust * (1 - d / 8));
    this.vfx.ring(cl.x, cy, cl.z, { r0: 0.5, r1: 7, dur: 0.6, color: 0xbfe8ff });
    this.vfx.bolt(new THREE.Vector3(cl.x, cy, cl.z), new THREE.Vector3(cl.x + rnd(-2, 2), cy - 2.5, cl.z + rnd(-2, 2)), { jag: 0.4 });
    this.boom(0.3, 700, 0.3);
    // y marca el punto donde caerá un rayo
    const a = this.b.aimPoint();
    this.strikes.push({ x: a.x, z: a.z, cloud: cl, t: 0, tg: this.track(this.vfx.telegraph('disc', { x: a.x, z: a.z, r: c.strikeRadius, color: 0x9ad0ff, opacity: 0.5 })) });
  }
  land(s) {
    const c = this.cfg, cy = this.gy(s.cloud.x, s.cloud.z) + c.cloudH, top = new THREE.Vector3(s.x, cy, s.z), low = new THREE.Vector3(s.x, this.gy(s.x, s.z) + 0.2, s.z);
    this.vfx.bolt(top, low, { jag: 0.9, life: 0.28, segs: 12 });
    this.vfx.ring(s.x, null, s.z, { r0: 0.5, r1: c.strikeRadius + 1, dur: 0.45, color: 0xd8f0ff });
    this.vfx.sparks(s.x, low.y + 0.5, s.z, 0xbfe8ff, 14, 3);
    this.shake(0.3); this.boom(0.5, 400, 0.4);
    if (this.playerInCircle(s.x, s.z, c.strikeRadius)) this.hurt();
    s.cloud.flash = 1;
  }
  exitDance() { this.strikes.forEach((s) => s.tg.kill()); this.clouds.forEach((cl) => { cl.group.visible = false; }); }

  /* barrido ondulado por casi toda la arena */
  enterSweepTg() {
    const c = this.cfg, b = this.b, a = b.arena;
    const ang = Math.atan2(b.pos.z - a.z, b.pos.x - a.x);
    const R = a.r * 0.92;
    this.A = { x: a.x + Math.cos(ang) * R, z: a.z + Math.sin(ang) * R };
    this.B = { x: a.x - Math.cos(ang) * R, z: a.z - Math.sin(ang) * R };
    const dx = this.B.x - this.A.x, dz = this.B.z - this.A.z;
    this.len = Math.hypot(dx, dz);
    this.nx = -dz / this.len; this.nz = dx / this.len;
    this.pathAt = (u) => ({ x: this.A.x + dx * u + this.nx * Math.sin(u * TAU * c.sweepWaves) * c.sweepAmp, z: this.A.z + dz * u + this.nz * Math.sin(u * TAU * c.sweepWaves) * c.sweepAmp });
    this.segs = [];
    const N = 22;
    for (let i = 0; i < N; i++) {
      const p0 = this.pathAt(i / N), p1 = this.pathAt((i + 1) / N);
      this.segs.push(this.track(this.vfx.telegraph('strip', { x: p0.x, z: p0.z, x2: p1.x, z2: p1.z, width: c.sweepHit * 1.6, color: 0x6ad0ff, opacity: 0.4 })));
    }
    this.ctx.ui.alert('🐲 ¡Long va a barrer la arena! Mira la trayectoria ondulada', 2400);
  }
  tickSweepTg(dt, k) {
    const b = this.b;
    this.segs.forEach((s, i) => s.setProgress(Math.min(1, Math.max(0, k * 1.5 - (i / this.segs.length) * 0.5))));
    const e = lerp(b.pos.x, this.A.x, Math.min(1, 3 * dt)), f = lerp(b.pos.z, this.A.z, Math.min(1, 3 * dt));
    b.pos.x = e; b.pos.z = f;
    b.facing = Math.atan2(this.pathAt(0.02).x - this.A.x, this.pathAt(0.02).z - this.A.z);
    b.anim.dy = this.cfg.sweepAmp * 0.06 * k;
    this.shake(0.03 + 0.04 * k);
  }
  enterSweep() {
    this.u = 0;
    this.hitDone = false;
    this.boom(0.5, 300, 0.8);
    this.shake(0.25);
  }
  tickSweep(dt) {
    const c = this.cfg, b = this.b, st = this.stages[this.i];
    this.u = Math.min(1, this.u + (c.sweepSpeed * (b.st.root > 0 ? 0.0 : 1) * dt) / this.len);
    const p = this.pathAt(this.u), q = this.pathAt(Math.min(1, this.u + 0.01));
    b.pos.x = p.x; b.pos.z = p.z;
    b.facing = Math.atan2(q.x - p.x, q.z - p.z);
    b.anim.rx = -0.3;
    b.anim.dy = 0.4;
    if (!this.hitDone && Math.hypot(this.player.pos.x - p.x, this.player.pos.z - p.z) < c.sweepHit + this.player.R) {
      this.hitDone = true;
      this.hurt();
      this.combat.pushPlayer(this.player.pos.x - p.x, this.player.pos.z - p.z, 11);
    }
    this.vfx.dust(p.x, this.gy(p.x, p.z) + 0.3, p.z, 2, 1.6);
    this.vfx.sparks(p.x, this.gy(p.x, p.z) + 1.2, p.z, 0xbfe8ff, 2, 2);
    if (this.u >= 1) st.dur = this.t;
  }
  exitSweep() { this.segs.forEach((s) => s.kill()); }
}

/* ====================================================================== */
/*  MEDUSA — Corona de Serpientes                                          */
/* ====================================================================== */
class MedusaAtk extends Attack {
  build() {
    const c = this.cfg, g = c.gaze;
    const st = [
      { name: 'serpientes', dur: c.aimT, enter: this.enterSnakes, tick: this.tickSnakes },
      { name: 'salva', dur: c.snakes * c.volleyGap + 0.5, enter: () => { this.fired = 0; }, tick: this.tickVolley },
    ];
    if (this.b.phase >= 2 || Math.random() < 0.5) {
      st.push({ name: 'mirada-aviso', dur: g.telegraph, enter: this.enterGazeTg, tick: this.tickGazeTg });
      st.push({ name: 'mirada', dur: g.duration, enter: this.enterGaze, tick: this.tickGaze, exit: this.exitGaze });
    }
    st.push({ name: 'recuperacion', dur: c.recover, tick: () => { this.hideSnakes(); } });
    return st;
  }
  headPos() { return this.local(this.b.S.radius * 0.4, 0, this.headY); }
  enterSnakes() {
    const c = this.cfg;
    this.snakes = [];
    for (let i = 0; i < c.snakes; i++) {
      const s = makeSnake(0x3f8f3f);
      s.group.scale.setScalar(0.01);
      this.vfx.group.add(s.group);
      this.track({ kill: () => this.vfx.group.remove(s.group) });
      this.snakes.push({ ...s, ang: (i / c.snakes) * TAU });
    }
    this.ctx.ui.alert('🐍 ¡Los cabellos de Medusa se alzan! Cuidado con los proyectiles', 2200);
  }
  tickSnakes(dt, k) {
    const h = this.headPos(), p = this.player.pos;
    this.faceTowards(p.x, p.z, dt, 6);
    this.snakes.forEach((s, i) => {
      const a = s.ang + this.t * 1.2, r = 0.9 * this.b.S.radius + 0.5;
      s.group.position.set(h.x + Math.cos(a) * r, h.y + 0.5 + 0.5 * Math.sin(this.t * 4 + i), h.z + Math.sin(a) * r);
      s.group.scale.setScalar(ease(k) * 1.2);
      s.group.lookAt(p.x, p.y + 1, p.z);
      s.group.rotateX(Math.PI / 2);
      s.eyeMat.color.set(0x9aff6a).multiplyScalar(1 + 3 * k); // los ojos brillan antes de disparar
    });
  }
  tickVolley(dt) {
    const c = this.cfg, p = this.player.pos;
    this.snakes.forEach((s) => { s.group.lookAt(p.x, p.y + 1, p.z); s.group.rotateX(Math.PI / 2); });
    while (this.fired < c.snakes && this.t >= this.fired * c.volleyGap) {
      const s = this.snakes[this.fired], from = s.group.position.clone();
      const dir = new THREE.Vector3(p.x - from.x, p.y + this.player.H * 0.5 - from.y, p.z - from.z).normalize();
      dir.x += rnd(-0.06, 0.06); dir.z += rnd(-0.06, 0.06);
      dir.normalize();
      this.combat.fire({ pos: from, vel: dir.multiplyScalar(c.shot.speed), radius: c.shot.radius, color: c.shot.color, life: c.shot.life, light: true });
      this.vfx.sparks(from.x, from.y, from.z, c.shot.color, 4, 1.6);
      this.fired++;
    }
  }
  hideSnakes() { this.snakes.forEach((s) => s.group.scale.setScalar(Math.max(0.01, s.group.scale.x - 0.05))); }

  enterGazeTg() {
    const g = this.cfg.gaze, b = this.b;
    this.gaze = new Gaze(this, { range: g.range, half: g.coneDeg * DEG, track: 0.7, exposure: g.exposure, petrifyT: g.petrifyT, fade: g.fade });
    this.tg = this.track(this.vfx.telegraph('cone', { x: b.pos.x, z: b.pos.z, angle: b.facing, half: this.gaze.half, range: g.range, color: 0x7aff5a, opacity: 0.3 }));
    this.ctx.ui.alert('🐍 ¡Mirada de Medusa! Ponte detrás de una columna o una estatua', 2400);
  }
  tickGazeTg(dt, k) {
    this.faceTowards(this.player.pos.x, this.player.pos.z, dt, 5);
    this.tg.set(this.b.pos.x, this.b.pos.z, { angle: this.b.facing });
    this.tg.setProgress(k * 0.5);
    const h = this.headPos();
    if (Math.random() < 0.4) this.vfx.orb(h, { r: 0.1 + 0.4 * k, color: 0x9aff6a, life: 0.2, grow: 1.5 });
    this.hideSnakes();
  }
  enterGaze() { this.gaze.facing = this.b.facing; this.shake(0.15); }
  tickGaze(dt) {
    const g = this.gaze, b = this.b;
    g.step(dt, 0.7);
    this.tg.set(b.pos.x, b.pos.z, { angle: g.facing });
    this.tg.setProgress(0.5 + 0.5 * Math.min(1, g.exp / this.cfg.gaze.exposure));
    this.vfx.orb(this.headPos(), { r: 0.3, color: 0x9aff6a, life: 0.1 });
    for (let i = 0; i < 2; i++) { const d = rnd(1.5, this.cfg.gaze.range), a = g.facing + rnd(-1, 1) * g.half, x = b.pos.x + Math.sin(a) * d, z = b.pos.z + Math.cos(a) * d; this.vfx.sparks(x, this.gy(x, z) + rnd(0.3, 1.8), z, 0x7aff5a, 1, 1.2); }
  }
  // al terminar la mirada el suelo se llena de estatuas temporales: cambian el espacio disponible
  exitGaze() {
    const c = this.cfg, b = this.b, p = this.player.pos, made = [];
    for (let i = 0, tries = 0; i < c.statues && tries < 40; tries++) {
      const ang = rnd(0, TAU), r = b.arena.r * rnd(0.3, 0.85), x = b.arena.x + Math.cos(ang) * r, z = b.arena.z + Math.sin(ang) * r;
      if (Math.hypot(x - p.x, z - p.z) < 3.2 || Math.hypot(x - b.pos.x, z - b.pos.z) < b.S.radius + 2.5 || made.some((m) => Math.hypot(m.x - x, m.z - z) < 4)) continue;
      made.push({ x, z });
      i++;
    }
    const statues = made.map((m) => this.makeStatuePiece(m.x, m.z));
    const obj = {
      life: c.statueLife,
      update: () => { for (const s of statues) s.group.scale.y = Math.max(0.01, Math.min(1, obj.life / 0.8, (c.statueLife - obj.life) / 0.5)); }, // surgen y se hunden
      end: () => statues.forEach((s) => this.removeStatue(s)),
    };
    this.linger(obj);
    this.shake(0.2);
  }
  makeStatuePiece(x, z) {
    const c = this.cfg, st = makeStatue(c.statueR, c.statueH), gy = this.gy(x, z);
    st.group.position.set(x, gy - 0.05, z);
    st.group.rotation.y = rnd(0, TAU);
    st.group.scale.y = 0.01;
    this.vfx.group.add(st.group);
    const solid = { x0: x - c.statueR, x1: x + c.statueR, y0: gy - 0.2, y1: gy + c.statueH, z0: z - c.statueR, z1: z + c.statueR, tag: 'statue', dyn: true, dx: 0, dy: 0, dz: 0, _q: 0 };
    this.ctx.world.dynSolids.push(solid);
    this.ejectPlayerFrom(solid);
    this.vfx.dust(x, gy + 0.2, z, 8, 1.6);
    this.vfx.sparks(x, gy + 1, z, 0x9aa0aa, 8, 2);
    return { group: st.group, solid };
  }
  removeStatue(s) {
    this.vfx.group.remove(s.group);
    const i = this.ctx.world.dynSolids.indexOf(s.solid);
    if (i >= 0) this.ctx.world.dynSolids.splice(i, 1);
    this.vfx.dust(s.group.position.x, s.group.position.y + 0.3, s.group.position.z, 6, 1.4);
  }
}

/* ====================================================================== */
/*  FENRIR — Devorador del Eclipse (fase solar → lunar → eclipse)          */
/* ====================================================================== */
class FenrirAtk extends Attack {
  build() {
    const c = this.cfg, b = this.b;
    this.lunar = b.phase >= 2;
    this.eclipse = b.phase >= 3;
    this.swipes = b.phase === 1 ? 3 : b.phase === 2 ? 3 : 4;
    this.hist = [];
    this.events = [];
    this.copies = [];
    const st = [];
    if (this.lunar) st.push({ name: 'invocacion', dur: 0.7, enter: this.enterCopies, tick: this.tickSummon });
    if (this.eclipse) st.push({ name: 'eclipse', dur: 0.6, enter: this.enterEclipse, tick: (dt, k) => this.dim(c.eclipse.sunDim, k) });
    for (let i = 0; i < this.swipes; i++) {
      st.push({ name: 'garra-aviso', dur: c.solar.swipeTelegraph, enter: this.enterSwipeTg, tick: this.tickSwipeTg });
      st.push({ name: 'garra-salto', dur: 0.5, enter: this.enterDash, tick: this.tickDash });
      st.push({ name: 'garra', dur: 0.28, enter: this.enterHit, tick: (dt, k) => { this.b.anim.rx = lerp(0.3, 0, k); } });
    }
    if (this.lunar) st.push({ name: 'ecos', dur: c.lunar.delays[c.lunar.copies - 1] + 0.9, tick: this.tickEcho });
    st.push({ name: 'recuperacion', dur: c.recover, tick: (dt, k) => { this.dim(this.eclipse ? c.eclipse.sunDim : 1, 1 - k); } });
    return st;
  }
  update(dt) { // guarda el historial de posiciones para que los ecos lunares repitan sus movimientos con retraso
    const b = this.b;
    this.clock = (this.clock || 0) + dt;
    this.hist.push({ t: this.clock, x: b.pos.x, z: b.pos.z, f: b.facing });
    while (this.hist.length > 2 && this.hist[1].t < this.clock - 3) this.hist.shift();
    this.stepCopies();
    return super.update(dt);
  }

  /* --- luz del eclipse --- */
  lights() {
    if (!this._lights) {
      this._lights = [];
      this.ctx.scene.traverse((o) => { if (o.isDirectionalLight || o.isHemisphereLight || o.isAmbientLight) this._lights.push({ l: o, i: o.intensity }); });
    }
    return this._lights;
  }
  dim(f, k) { for (const L of this.lights()) L.l.intensity = lerp(L.i, L.i * f, Math.min(1, Math.max(0, k))); }
  cleanup() {
    for (const L of this._lights || []) L.l.intensity = L.i;
    this.copies.forEach((c) => { this.ctx.scene.remove(c.root); c.mats.forEach((m) => m.dispose()); });
    this.copies.length = 0;
  }
  enterEclipse() {
    const b = this.b, cam = this.ctx.camera;
    const away = new THREE.Vector3(b.pos.x - cam.position.x, 0, b.pos.z - cam.position.z).normalize();
    const pos = new THREE.Vector3(b.pos.x + away.x * 8, this.gy(b.pos.x, b.pos.z) + b.S.height + 12, b.pos.z + away.z * 8);
    this.track(this.vfx.eclipse(cam, pos, { r: 4.2, life: 99, color: 0xffc24a }));
    this.ctx.ui.alert('🌑 ¡El eclipse cubre la arena!', 2200);
    this.shake(0.3);
  }

  /* --- ecos lunares: copias espectrales que repiten sus garras --- */
  enterCopies() {
    const l = this.cfg.lunar;
    for (let i = 0; i < l.copies; i++) {
      const m = makeBossModel('fenrir');
      const mats = [];
      m.root.traverse((o) => {
        if (!o.isMesh) return;
        const mat = new THREE.MeshBasicMaterial({ color: 0x9ab0ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
        o.material = mat; o.castShadow = false;
        mats.push(mat);
      });
      this.ctx.scene.add(m.root);
      this.copies.push({ root: m.root, unit: m.unit, mats, delay: l.delays[i], alpha: 0 });
    }
    this.ctx.ui.alert('🌙 ¡Ecos lunares! Repiten sus garras con retraso', 2400);
  }
  tickSummon(dt, k) { for (const c of this.copies) c.alpha = this.cfg.lunar.alpha * k; this.stepCopies(); }
  stepCopies() {
    if (!this.copies.length) return;
    for (const c of this.copies) {
      const target = this.clock - c.delay;
      let h = this.hist[0];
      for (let i = this.hist.length - 1; i >= 0; i--) if (this.hist[i].t <= target) { h = this.hist[i]; break; }
      c.root.position.set(h.x, this.gy(h.x, h.z), h.z);
      c.root.rotation.y = h.f;
      c.root.scale.setScalar(c.unit);
      c.mats.forEach((m) => { m.opacity = c.alpha; });
    }
    // las garras que repiten los ecos
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (!e.warned && this.clock >= e.at - 0.4) {
        e.warned = true;
        e.tg = this.track(this.vfx.telegraph('cone', { x: e.x, z: e.z, angle: e.f, half: this.cfg.solar.swipeArc * 0.5 * DEG, range: this.cfg.solar.swipeRange, color: 0x8a9aff, opacity: 0.35 }));
      }
      if (e.tg) e.tg.setProgress(Math.min(1, (this.clock - (e.at - 0.4)) / 0.4));
      if (this.clock >= e.at) {
        if (e.tg) e.tg.kill();
        this.swipeAt(e.x, e.z, e.f, 0x8a9aff);
        this.events.splice(i, 1);
      }
    }
  }
  tickEcho(dt, k) { for (const c of this.copies) c.alpha = this.cfg.lunar.alpha * (1 - Math.max(0, (k - 0.75) / 0.25)); this.stepCopies(); }

  /* --- garras solares: rápidas y con aviso corto --- */
  enterSwipeTg() {
    const c = this.cfg.solar, b = this.b, a = b.aimPoint();
    const dx = a.x - b.pos.x, dz = a.z - b.pos.z, d = Math.hypot(dx, dz) || 1;
    this.dir = { x: dx / d, z: dz / d };
    const stand = b.S.radius + 0.8;
    const dist = Math.max(0, d - stand);
    this.end = { x: b.pos.x + this.dir.x * dist, z: b.pos.z + this.dir.z * dist };
    const r = Math.hypot(this.end.x - b.arena.x, this.end.z - b.arena.z);
    if (r > b.arena.r) { this.end.x = b.arena.x + ((this.end.x - b.arena.x) / r) * b.arena.r; this.end.z = b.arena.z + ((this.end.z - b.arena.z) / r) * b.arena.r; }
    this.f = Math.atan2(this.dir.x, this.dir.z);
    this.tg = this.track(this.vfx.telegraph('cone', { x: this.end.x, z: this.end.z, angle: this.f, half: c.swipeArc * 0.5 * DEG, range: c.swipeRange, color: 0xffb02a }));
    this.vfx.orb(new THREE.Vector3(b.pos.x, this.headY, b.pos.z), { r: 0.6, color: 0xffd24a, life: c.swipeTelegraph, grow: 2 });
  }
  tickSwipeTg(dt, k) {
    this.tg.setProgress(k);
    this.b.facing = this.f;
    this.b.anim.rx = -0.2 * k;
    this.b.anim.dy = -this.b.S.height * 0.05 * k;
    if (Math.random() < 0.5) this.vfx.sparks(this.b.pos.x, this.gy(this.b.pos.x, this.b.pos.z) + 1.2, this.b.pos.z, 0xffd24a, 1, 2);
  }
  enterDash() { this.from = { x: this.b.pos.x, z: this.b.pos.z }; this.dashT = Math.hypot(this.end.x - this.from.x, this.end.z - this.from.z) / (19 * this.cfg.solar.chargeSpeedMul); this.boom(0.25, 700, 0.2); }
  tickDash(dt) {
    const b = this.b, st = this.stages[this.i];
    const k = Math.min(1, this.t / Math.max(0.05, this.dashT));
    b.pos.x = lerp(this.from.x, this.end.x, k); b.pos.z = lerp(this.from.z, this.end.z, k);
    b.anim.rx = 0.15; b.anim.dy = 0;
    this.vfx.sparks(b.pos.x, this.gy(b.pos.x, b.pos.z) + 1, b.pos.z, 0xffd24a, 2, 2.4);
    this.vfx.dust(b.pos.x, this.gy(b.pos.x, b.pos.z) + 0.2, b.pos.z, 1, 1.2);
    if (k >= 1) st.dur = this.t;
  }
  enterHit() {
    this.tg.kill();
    this.swipeAt(this.b.pos.x, this.b.pos.z, this.f, 0xffc24a);
    for (const c of this.copies) this.events.push({ x: this.b.pos.x, z: this.b.pos.z, f: this.f, at: this.clock + c.delay });
  }
  swipeAt(x, z, f, color) {
    const c = this.cfg.solar;
    this.shake(0.22); this.boom(0.35, 500, 0.25);
    this.vfx.ring(x + Math.sin(f) * 2, null, z + Math.cos(f) * 2, { r0: 0.5, r1: c.swipeRange * 0.8, dur: 0.3, color });
    for (let i = 0; i < 10; i++) { const a = f + rnd(-1, 1) * c.swipeArc * 0.5 * DEG, d = rnd(1.5, c.swipeRange); this.vfx.sparks(x + Math.sin(a) * d, this.gy(x, z) + rnd(0.5, 1.8), z + Math.cos(a) * d, color, 1, 3); }
    if (this.playerInCone(x, z, f, c.swipeArc * 0.5 * DEG, c.swipeRange)) { this.hurt(); this.combat.pushPlayer(this.player.pos.x - x, this.player.pos.z - z, 8); }
  }
}

export const SIGS = {
  minotauro: MinotauroAtk,
  kraken: KrakenAtk,
  kerberos: CerberoAtk,
  basilisco: BasiliscoAtk,
  long: LongAtk,
  medusa: MedusaAtk,
  fenrir: FenrirAtk,
};
