import * as THREE from 'three';
import { rnd, TAU } from './attack.js';
import { Skill, DEG, ease, lerp, clamp, V } from './base.js';
import { terrainH } from '../terrain.js';
import { ui } from '../ui.js';
import { douseFires, smotherFires, propsNear, captureProp, dropFlung, wetGround } from './envreact.js';
import { propModel } from '../props.js';
import { auroraShield, frostArea } from './magicfx.js';
import { MirageWard, TsunamiWave, WaterVortex, FoamPool, WaterShield, MagmaGeyser, ObsidianSpikes, CrystalDebris } from './fx4.js';

// PODERES ESPECIALES NUEVOS (3 por héroe; la Zorra Ártica tiene 4).
// Cada poder es una lista de etapas PREPARACIÓN → EJECUCIÓN → RECUPERACIÓN (como skills/hero.js).
// Números en skills/config.js · efectos visuales en skills/vfx.js y skills/vfx2.js · sonidos en audio.js (sfx).
// Los poderes "de fondo" (vuelo, espejismos) no bloquean a los demás: el gestor los lleva aparte.

const back = (k) => 1 - Math.pow(1 - k, 3); // salida rápida y frenada suave

// ESCUDO QUE ACOMPAÑA AL HÉROE: burbuja ajustada a su cuerpo, centrada en él en CADA fotograma (camina, salta y gira
// con él; nunca se queda donde se activó). Translúcida: el modelo se ve siempre. end() la apaga suavemente.
export function followShield(sk, { color, rim, band = 0xffffff, band2 = null, op = 0.34, fin = 0.35 } = {}) {
  const p = sk.p;
  const sh = sk.v2.shell(sk.center(0.5), { r: 1, color, rim, opacity: 0, power: 2.8, core: 0.02, life: 0 });
  const mk = (c) => { const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }); m.userData.own = true; return m; };
  const bm = mk(band), bm2 = mk(band2 ?? band);
  const geo = new THREE.TorusGeometry(1.03, 0.012, 6, 72);
  const t1 = new THREE.Mesh(geo, bm), t2 = new THREE.Mesh(geo, bm2), t3 = new THREE.Mesh(geo, bm);
  sh.mesh.add(t1, t2, t3);
  let endAt = 0;
  sh.onUpdate = (t) => {
    const k = Math.min(1, t / fin) * (endAt ? Math.max(0, 1 - (t - endAt) / 0.45) : 1);
    const s = 1 + 0.025 * Math.sin(t * 7);
    sh.mesh.position.set(p.pos.x, p.pos.y + p.H * 0.52 + (p.pose.dy || 0), p.pos.z);
    sh.mesh.scale.set(p.H * 0.6 * s, p.H * 0.72 * s, p.H * 0.6 * s);
    sh.mat.uniforms.uOp.value = op * k;
    t1.rotation.set(Math.PI / 2 + 0.35 * Math.sin(t * 0.9), t * 1.7, 0);
    t2.rotation.set(0.5 * Math.sin(t * 0.7), -t * 1.3, Math.PI / 2);
    t3.rotation.set(Math.PI / 2 - 0.6, t * 0.8, 0.6);
    bm.opacity = 0.55 * k; bm2.opacity = 0.45 * k;
    if (endAt && t - endAt > 0.5) { geo.dispose(); sh.kill(); }
  };
  return { mesh: sh.mesh, end: () => { if (!endAt && sh.it) endAt = Math.max(0.001, sh.it.t); } };
}
const fadeIO = (k, a = 0.15) => (k < a ? k / a : k > 1 - a ? (1 - k) / a : 1);

/* ====================================================================== */
/*  KOMODO — GÉISER                                                        */
/* ====================================================================== */
export class GeyserSkill extends Skill {
  begin() {
    const d = this.def, p = this.p;
    // anillo de géiseres alrededor + uno bajo cada enemigo cercano
    this.spots = [];
    // sin géiseres entre la cámara y el héroe (taparían la vista)
    const cam = this.g.camera.position, cx = cam.x - p.pos.x, cz = cam.z - p.pos.z, cl = Math.hypot(cx, cz) || 1;
    for (let i = 0; i < d.count * 2 && this.spots.length < d.count; i++) {
      const a = (i / d.count) * TAU * 0.5 + rnd(-0.2, 0.2) + i * 0.37, r = d.ring * rnd(0.6, 1.05);
      const ox = Math.cos(a), oz = Math.sin(a);
      if ((ox * cx + oz * cz) / cl > 0.45) continue;
      this.spots.push({ x: p.pos.x + ox * r, z: p.pos.z + oz * r, delay: rnd(0, 0.45) });
    }
    for (const t of this.combat.inCircle(p.pos.x, p.pos.z, d.ring * 1.6)) this.spots.push({ x: t.pos.x, z: t.pos.z, delay: 0.05, target: true });
    this.start();
    return true;
  }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'preparacion', dur: d.prep, enter: () => { this.lock(true); this.sfx('rumble'); }, tick: (dt, k) => {
        pose.dy = 0.35 * Math.sin(k * Math.PI * 0.5); pose.rx = -0.35 * k; pose.sy = 1 + 0.08 * k; // se alza sobre las patas traseras
        if (Math.random() < 0.4) this.vfx.fire(this.p.pos.x, this.p.pos.y + 0.2, this.p.pos.z, 1, 0.8);
      } },
      { name: 'golpe-y-grietas', dur: d.crackT, enter: this.enterSlam, tick: this.tickCracks },
      { name: 'erupcion', dur: d.exec, enter: this.enterErupt, tick: this.tickErupt },
      { name: 'recuperacion', dur: d.recover, enter: () => this.lock(false), tick: (dt, k) => { pose.sy = lerp(0.92, 1, k); pose.rx = lerp(0.2, 0, k); } },
    ];
  }
  enterSlam() {
    const p = this.p;
    this.shake(0.25); this.sfx('crack');
    this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.5, r1: 4, dur: 0.4, color: 0xff7a2a });
    this.vfx.dust(p.pos.x, p.pos.y + 0.1, p.pos.z, 10, 2);
    // grietas de magma: del héroe hacia cada géiser
    for (const s of this.spots) {
      const dx = s.x - p.pos.x, dz = s.z - p.pos.z, len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const ang = Math.atan2(dx, dz);
      let x = p.pos.x, z = p.pos.z, a = ang;
      const segs = 3;
      for (let i = 0; i < segs; i++) { // grieta quebrada en tramos
        const l = len / segs, na = ang + rnd(-0.35, 0.35);
        this.track(this.v2.crack(x, z, l + 0.3, na, { life: this.def.crackT + 0.6 + s.delay, width: 0.18 + 0.12 * Math.random() }));
        x += Math.sin(na) * l; z += Math.cos(na) * l; a = na;
      }
      this.track(this.vfx.telegraph('disc', { x: s.x, z: s.z, r: this.def.radius, color: 0xff5a1a, opacity: 0.35 })).setProgress(0.2);
    }
  }
  tickCracks(dt, k) {
    this.pose.sy = lerp(1.08, 0.9, Math.min(1, k * 4)); this.pose.rx = lerp(-0.35, 0.2, Math.min(1, k * 4)); this.pose.dy = 0;
    for (const h of this.handles) if (h && h.setProgress) h.setProgress(0.2 + 0.8 * k);
    if (Math.random() < 0.5) { const s = this.spots[Math.floor(Math.random() * this.spots.length)]; this.g.fx.ember(s.x, terrainH(s.x, s.z), s.z, 1); this.g.fx.smokePuff(s.x, terrainH(s.x, s.z) + 0.2, s.z, 0.6, 0x3a2a22); }
  }
  enterErupt() {
    for (const h of this.handles) if (h && h.shape === 'disc') h.kill();
    this.shake(this.def.shake);
    this.sfx('eruption');
    this.hitSet = new Set();
  }
  tickErupt(dt, k) {
    const d = this.def, t = this.t;
    this.p.evadeT = Math.max(this.p.evadeT, 0.15); // ESCUDO: las columnas de magma lo protegen
    this.combat.deflect(this.p.pos.x, this.p.pos.z, d.ring); // y frenan los proyectiles
    this.pose.sy = 0.92; this.pose.rx = 0.2;
    for (const s of this.spots) {
      const lt = t - s.delay;
      if (lt < 0) continue;
      if (!s.g) { // nace el géiser
        s.g = new MagmaGeyser(this.g, s.x, s.z, { r: d.radius * 0.6, h: d.height * rnd(0.75, 1.1), life: d.exec - s.delay + 0.3 }); // columna de magma con volumen, corona y salpicaduras
        this.track(s.g);
        const y = s.g.y;
        this.vfx.ring(s.x, null, s.z, { r0: 0.3, r1: d.radius * 1.8, dur: 0.5, color: 0xffa040 });
        this.vfx.fire(s.x, y + 0.2, s.z, 4, 1.3);
        for (let i = 0; i < 6; i++) this.g.fx.rock(s.x, y + 0.3, s.z);
        this.vfx.sparks(s.x, y + 1, s.z, 0xffc060, 10, 4);
        for (const tg of this.combat.inCircle(s.x, s.z, d.radius)) {
          if (this.hitSet.has(tg)) continue; // cada enemigo recibe un solo golpe de géiser
          this.hitSet.add(tg);
          this.hit(tg, d.damage);
          const { dx, dz } = this.awayFrom(tg, s.x, s.z);
          this.combat.push(tg, dx || 0.1, dz, d.force);
          this.burn(tg, d.burnT, d.burnDps);
        }
      }
      const lk = clamp(lt / 0.25, 0, 1), fall = clamp((lt - (d.exec - s.delay) * 0.6) / ((d.exec - s.delay) * 0.4), 0, 1);
      s.g.setHeight(back(lk) * (1 - fall * 0.85));
      if (Math.random() < 0.22) {
        const hgt = s.g.height;
        this.g.fx.flame(s.x, s.g.y + hgt * rnd(0.2, 0.9), s.z, 1.2, 0.5);
        this.g.fx.ember(s.x, s.g.y + hgt * 0.8, s.z, 1.4);
        if (Math.random() < 0.3) this.g.fx.smokePuff(s.x, s.g.y + hgt, s.z, 1.3, 0x40302a);
      }
    }
  }
  burn(t, secs, dps) {
    const c = this.combat;
    this.linger({ life: secs, update: (dt) => { if (!t.dead) { c.damage(t, dps * dt, { quiet: true }); if (Math.random() < 0.2) this.g.fx.flame(t.pos.x, t.pos.y + 0.4, t.pos.z, 0.6, 0.3); } }, end: () => {} });
  }
}

/* ====================================================================== */
/*  KOMODO — LAVA NEGRA                                                    */
/* ====================================================================== */
export class BlackLavaSkill extends Skill {
  begin() {
    const p = this.p, d = this.def;
    const tgt = this.combat.aimTarget(p.pos.x, p.pos.z, p.facing, 40 * DEG, d.length);
    if (tgt) this.face(tgt.pos.x, tgt.pos.z);
    this.dir = this.fwd;
    this.origin = V(p.pos.x + this.dir.x * 0.8, 0, p.pos.z + this.dir.z * 0.8);
    this.start();
    return true;
  }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'preparacion', dur: d.prep, enter: () => { this.lock(true); this.sfx('hiss'); }, tick: (dt, k) => { // aspira y se encorva
        pose.rx = -0.25 * k; pose.sy = 1 - 0.08 * k;
        const c = this.center(0.55);
        this.g.fx.smokePuff(c.x + this.dir.x * 0.6, c.y, c.z + this.dir.z * 0.6, 0.5, 0x15100e);
      } },
      { name: 'propagacion', dur: d.spreadT, enter: this.enterFlow, tick: this.tickFlow },
      { name: 'recuperacion', dur: d.recover, enter: () => { this.lock(false); this.leaveZone(); if (this.doused) ui.banner('good', `🌑 ¡La lava negra sofoca ${this.doused} ${this.doused > 1 ? 'focos' : 'foco'}!`, `+${30 * this.doused} puntos`); }, tick: (dt, k) => { pose.rx = lerp(0.35, 0, k); pose.sy = lerp(1.05, 1, k); } },
    ];
  }
  // LA LAVA NEGRA CUBRE MUCHO TERRENO: un río principal ancho y largo y, desde su mitad, dos brazos que
  // se abren a los lados. Todo avanza de forma progresiva (primero el río, luego los brazos), con un charco
  // en el origen, grietas incandescentes en las orillas y suelo quemado que queda después.
  enterFlow() {
    const d = this.def;
    const y0 = this.p.pos.y + 0.6, hf = (x, z) => this.p.floorY(x, z, y0), life = d.spreadT + d.zoneT + d.recover;
    const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.z * Math.sin(a), z: v.x * Math.sin(a) + v.z * Math.cos(a) });
    const mid = V(this.origin.x + this.dir.x * d.length * 0.38, 0, this.origin.z + this.dir.z * d.length * 0.38);
    this.flows = [{ o: this.origin, dir: this.dir, len: d.length, w: d.width, t0: 0, t1: 0.8 }];
    for (const a of [-0.65, 0.65]) this.flows.push({ o: mid, dir: rot(this.dir, a), len: d.length * 0.55, w: d.width * 0.6, t0: 0.35, t1: 1 });
    this.flows.push({ o: V(this.origin.x - this.dir.x * 2.5, 0, this.origin.z - this.dir.z * 2.5), dir: this.dir, len: 6, w: d.width * 1.15, t0: 0, t1: 0.3 }); // charco a los pies de Kairo
    for (const f of this.flows) { f.flow = this.v2.lavaFlow(f.o, f.dir, { len: f.len, width: f.w, life, hf }); f.k = 0; f.cracked = 0; }
    this.flow = this.flows[0].flow;
    this.hitSet = new Set();
    this.shake(0.35);
    this.sfx('lava');
    this.vfx.ring(this.origin.x, null, this.origin.z, { r0: 0.5, r1: d.width * 1.2, dur: 0.6, color: 0xff5a10 });
  }
  tickFlow(dt, k) {
    const d = this.def, pose = this.pose;
    pose.rx = 0.35; pose.sy = 1.05; // escupe / empuja la lava hacia delante
    this.shake(0.05 + 0.05 * Math.sin(this.t * 20)); // el suelo retumba mientras se extiende
    for (const f of this.flows) {
      const kk = clamp((k - f.t0) / (f.t1 - f.t0), 0, 1), e = back(kk);
      f.k = e;
      f.flow.setProgress(e);
      if (kk <= 0 || kk >= 1) continue;
      const front = f.len * e, fx = f.o.x + f.dir.x * front, fz = f.o.z + f.dir.z * front, fy = terrainH(fx, fz);
      // la lava negra cubre y sofoca los focos de incendio por donde avanza
      this.doused = (this.doused || 0) + smotherFires(this.g, fx, fz, f.w * 0.65, 'lava');
      // frente de la corriente: humo negro denso, brasas y chispas naranjas a todo lo ancho
      for (let i = 0; i < 4; i++) {
        const s = rnd(-0.5, 0.5) * f.w;
        this.g.fx.smokePuff(fx - f.dir.z * s, fy + 0.4, fz + f.dir.x * s, 1.3, 0x0c0908);
        this.g.fx.ember(fx - f.dir.z * s, fy + 0.2, fz + f.dir.x * s, 1.4);
      }
      if (Math.random() < 0.6) this.vfx.sparks(fx, fy + 0.3, fz, 0xff8a2a, 4, 3.4);
      // grietas incandescentes que se abren en las orillas según avanza
      if (front - f.cracked > 2.2) {
        f.cracked = front;
        for (const sd of [-1, 1]) { const x = fx - f.dir.z * sd * f.w * 0.55, z = fz + f.dir.x * sd * f.w * 0.55; this.v2.crack(x, z, rnd(1.5, 3), Math.atan2(f.dir.x, f.dir.z) + sd * rnd(0.6, 1.3), { life: d.zoneT, width: 0.25, color: 0xff4a10 }); }
      }
    }
    for (const t of this.inFlow()) {
      if (this.hitSet.has(t)) continue;
      this.hitSet.add(t);
      this.hit(t, d.damage);
      this.combat.push(t, this.dir.x, this.dir.z, d.force);
      this.vfx.ring(t.pos.x, null, t.pos.z, { r0: 0.4, r1: 2.6, dur: 0.4, color: 0xff6a1a });
      this.vfx.fire(t.pos.x, t.pos.y + 0.3, t.pos.z, 6, 1.2);
    }
  }
  // enemigos sobre la lava (por donde ya ha llegado cada corriente)
  inFlow() {
    return this.combat.targets().filter((t) => this.flows.some((f) => {
      const px = t.pos.x - f.o.x, pz = t.pos.z - f.o.z, along = px * f.dir.x + pz * f.dir.z;
      if (along < 0 || along > f.len * f.k) return false;
      return Math.abs(px * -f.dir.z + pz * f.dir.x) < f.w * 0.5 + t.radius;
    }));
  }
  // punto al azar sobre la lava
  randomOnLava() {
    const f = this.flows[Math.floor(Math.random() * this.flows.length)], r = Math.random() * f.len * f.k, s = rnd(-0.42, 0.42) * f.w;
    return { x: f.o.x + f.dir.x * r - f.dir.z * s, z: f.o.z + f.dir.z * r + f.dir.x * s };
  }
  // la lava se queda ardiendo un tiempo: ralentiza y quema a quien la pisa
  leaveZone() {
    const d = this.def, fx = this.g.fx;
    let drop = 0, bubble = 0;
    this.linger({
      life: d.zoneT,
      update: (dt) => {
        for (const t of this.inFlow()) { this.combat.slow(t, d.slowF, 0.6); this.combat.damage(t, (t.heavy ? d.dps : d.dps * 0.5) * dt, { quiet: true }); }
        drop -= dt; bubble -= dt;
        while (drop <= 0) { // brasas y humo por toda la superficie (más cuanto más grande)
          drop += 0.025;
          const q = this.randomOnLava(), y = terrainH(q.x, q.z);
          if (Math.random() < 0.5) fx.ember(q.x, y + 0.1, q.z, 1.2); else fx.smokePuff(q.x, y + 0.3, q.z, 0.9, 0x120d0b);
        }
        if (bubble <= 0) { // burbujas que revientan con un destello
          bubble = rnd(0.12, 0.3);
          const q = this.randomOnLava(), y = terrainH(q.x, q.z);
          this.vfx.ring(q.x, y + 0.15, q.z, { r0: 0.1, r1: rnd(0.6, 1.2), dur: 0.35, color: 0xff7a2a });
          for (let i = 0; i < 4; i++) fx.ember(q.x, y + 0.2, q.z, 1.6);
        }
      },
      end: () => this.scorch(),
    });
  }
  // suelo quemado: manchas oscuras que se quedan un rato después de que la lava se enfríe
  scorch() {
    const geo = new THREE.CircleGeometry(1, 20); geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 16; i++) {
      const q = this.randomOnLava(), r = rnd(1.2, 2.6);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0e0a08, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.userData.own = true;
      m.position.set(q.x, terrainH(q.x, q.z) + 0.05, q.z); m.scale.set(r, 1, r * rnd(0.6, 1)); m.rotation.y = rnd(0, 6);
      this.vfx.add(m, 12, (it) => { const k = it.t / 12; m.material.opacity = 0.55 * (k > 0.7 ? (1 - k) / 0.3 : 1); if (Math.random() < 0.02) this.g.fx.smokePuff(m.position.x, m.position.y + 0.3, m.position.z, 0.5, 0x2a2624); });
    }
  }
}

/* ====================================================================== */
/*  LINCE — UMBRA (eclipse solar)                                          */
/* ====================================================================== */
export class UmbraSkill extends Skill {
  begin() { this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'oscurecer', dur: d.prep, enter: this.enterDark, tick: this.tickDark },
      { name: 'energia-oscura', dur: d.exec, enter: this.enterBurst, tick: this.tickBurst },
      { name: 'recuperacion', dur: d.recover, enter: () => { this.lock(false); this.amb.end(); }, tick: (dt, k) => { pose.dy = lerp(0.5, 0, k); pose.rx = lerp(-0.2, 0, k); } },
    ];
  }
  enterDark() {
    const d = this.def, total = d.prep + d.exec + d.recover + 0.6;
    this.lock(true);
    this.amb = this.v2.ambience({ color: '#1a1030', alpha: 0.62, blend: 'multiply', exposure: 0.55, dur: total, fin: d.prep, fout: 0.9 });
    this.sun = this.v2.skyBody('sun', { size: 10, life: total, glow: 0xffd070 });
    this.moon = this.v2.shadowDisc(this.sun, 10.4);
    this.corona = this.v2.coronaRing(this.sun, 10, 0xffe0a0);
    this.sfx('dark');
    // ESCUDO SOLAR: la rodea y la sigue durante todo el eclipse (oro, naranja y la corona del sol)
    this.shield = followShield(this, { color: 0x3a1a00, rim: 0xffc84a, band: 0xffd070, band2: 0xff8a20, op: 0.42 });
    this.p.shieldFx = (this.p.shieldFx || 0) + 1;
  }
  cleanup() { if (this.shield) { this.shield.end(); this.shield = null; this.p.shieldFx = Math.max(0, (this.p.shieldFx || 1) - 1); } }
  tickDark(dt, k) {
    const pose = this.pose;
    pose.rx = -0.25 * k; pose.dy = 0.5 * ease(k); // se eleva un poco, mirando al cielo
    // la sombra de la luna avanza sobre el disco solar
    this.moon.position.x = lerp(7, 0, ease(k));
    this.moon.position.y = lerp(2.5, 0, ease(k));
    this.moon.material.opacity = Math.min(1, k * 3);
    this.corona.material.opacity = Math.max(0, (k - 0.75) / 0.25) * 0.9;
    this.sun.haloMul = 1 - 0.8 * ease(k); // al taparse el sol se apaga su resplandor
    const c = this.center(0.6);
    if (Math.random() < 0.7) this.g.fx.smokePuff(c.x + rnd(-1, 1), c.y + rnd(-0.5, 0.5), c.z + rnd(-1, 1), 0.7, 0x05030a);
    if (Math.random() < 0.4) this.vfx.sparks(c.x, c.y, c.z, 0xffd24a, 2, 1.2);
  }
  enterBurst() {
    this.moon.position.set(0, 0, 0.05);
    this.corona.material.opacity = 0.9;
    this.pulseI = 0;
    this.nextPulse = 0;
    this.dome = this.track(this.v2.shell(this.center(0.5), { r: 1, color: 0x000000, rim: 0xffc84a, opacity: 0.95, power: 3.2, core: 0.55, additive: false, life: this.def.exec }));
  }
  tickBurst(dt, k) {
    const d = this.def, p = this.p, pose = this.pose;
    p.evadeT = Math.max(p.evadeT, 0.15); // ESCUDO: oculta en la oscuridad del eclipse
    pose.dy = 0.5; pose.rx = -0.2; pose.spin = Math.sin(this.t * 3) * 0.2;
    this.corona.rotation.z += dt * 0.5;
    this.corona.material.opacity = 0.75 + 0.2 * Math.sin(this.t * 10);
    const pk = (this.t % (d.exec / d.pulses)) / (d.exec / d.pulses);
    this.dome.mesh.position.copy(this.center(0.5));
    this.dome.mesh.scale.setScalar(1 + d.radius * ease(pk));
    this.dome.mat.uniforms.uOp.value = 0.9 * (1 - pk);
    if (this.t >= this.nextPulse && this.pulseI < d.pulses) { // pulso de energía oscura
      this.pulseI++;
      this.nextPulse += d.exec / d.pulses;
      this.shake(0.18);
      this.sfx('boom');
      this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.6, r1: d.radius, dur: 0.7, color: 0xffc84a });
      this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.3, r1: d.radius * 0.85, dur: 0.6, color: 0x2a1040, additive: false, opacity: 0.6 });
      for (let i = 0; i < 18; i++) { const a = rnd(0, TAU), r = rnd(1, d.radius); this.g.fx.smokePuff(p.pos.x + Math.cos(a) * r, p.pos.y + 0.4, p.pos.z + Math.sin(a) * r, 1, 0x06040c); }
      for (const t of this.combat.inCircle(p.pos.x, p.pos.z, d.radius)) {
        this.hit(t, d.damage);
        this.combat.blind(t, d.blindT);
        this.combat.mark(t, d.markT);
        this.vfx.sparks(t.pos.x, t.pos.y + 0.8, t.pos.z, 0xffd24a, 8, 2.4);
      }
    }
  }
}

/* ====================================================================== */
/*  LINCE — PENUMBRA (eclipse lunar)                                       */
/* ====================================================================== */
export class PenumbraSkill extends Skill {
  begin() { this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'invocar', dur: d.prep, enter: this.enterCall, tick: (dt, k) => {
        pose.rx = -0.3 * k; pose.sy = 1 + 0.05 * k;
        this.sphere.mesh.scale.setScalar(0.2 + d.radius * back(k));
        this.sphere.mesh.position.copy(this.center(0.45));
        this.moonShade(k * 0.4);
      } },
      { name: 'esfera-lunar', dur: d.exec, enter: () => { this.p.speedBuff = d.speedMul; this.waveT = 0; }, tick: this.tickSphere, exit: () => { this.p.speedBuff = 1; } },
      { name: 'disolver', dur: d.recover, enter: () => { if (this.shield) this.shield.end(); }, tick: (dt, k) => {
        pose.rx = lerp(-0.1, 0, k);
        this.sphere.mesh.position.copy(this.center(0.45));
        this.sphere.mesh.scale.setScalar(d.radius * (1 + 0.3 * k));
        this.sphere.mat.uniforms.uOp.value = 0.6 * (1 - k);
      }, exit: () => this.amb.end() },
    ];
  }
  enterCall() {
    const d = this.def, total = d.prep + d.exec + d.recover + 0.4;
    this.amb = this.v2.ambience({ color: '#3a4a78', alpha: 0.35, blend: 'multiply', exposure: 0.85, dur: total, fin: 0.6, fout: 0.6 });
    this.moon = this.v2.skyBody('moon', { size: 8.5, life: total, glow: 0xb8c8ff, side: -0.45 });
    // sombra de la Tierra sobre la luna: tono gris-cobrizo que avanza (eclipse lunar, no tapa: tiñe)
    this.shade = this.v2.shadowDisc(this.moon, 8.8);
    this.shade.material.color.set(0x5a3020);
    this.sphere = this.track(this.v2.shell(this.center(0.45), { r: 0.2, color: 0x2a3a6a, rim: 0xe0e8ff, opacity: 0.6, power: 2.4, core: 0.08, life: total }));
    this.sfx('moon');
    // ESCUDO LUNAR: plata y azul de la luna, ajustado a su cuerpo y siguiéndola en todo momento
    this.shield = followShield(this, { color: 0x101a40, rim: 0xd8e4ff, band: 0xe8eeff, band2: 0x8aa0ff, op: 0.4 });
    this.p.shieldFx = (this.p.shieldFx || 0) + 1;
  }
  cleanup() { if (this.shield) { this.shield.end(); this.shield = null; this.p.shieldFx = Math.max(0, (this.p.shieldFx || 1) - 1); } }
  moonShade(k) {
    this.shade.position.x = lerp(-8, 0, ease(k));
    this.shade.material.opacity = 0.55 * Math.min(1, k * 2);
  }
  tickSphere(dt, k) {
    const d = this.def, p = this.p, pose = this.pose;
    pose.rx = -0.1;
    const c = this.center(0.45);
    this.sphere.mesh.position.copy(c);
    this.sphere.mesh.scale.setScalar(d.radius * (1 + 0.03 * Math.sin(this.t * 6)));
    this.sphere.mat.uniforms.uOp.value = 0.55 + 0.1 * Math.sin(this.t * 4);
    this.moonShade(0.4 + 0.6 * k);
    p.evadeT = Math.max(p.evadeT, 0.15); // la esfera lunar anula los golpes
    this.combat.deflect(p.pos.x, p.pos.z, d.radius); // y devuelve los proyectiles
    for (const t of this.combat.inCircle(p.pos.x, p.pos.z, d.radius)) {
      this.combat.slow(t, d.slowF, 0.5);
      this.dot(t, d.damage, dt);
      if (!t.heavy) { const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z); this.shove(t, dx, dz, d.force, dt); }
    }
    this.waveT -= dt;
    if (this.waveT <= 0) { // onda de luz plateada
      this.waveT = d.wave;
      this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.5, r1: d.radius * 1.5, dur: 0.9, color: 0xd8e4ff, opacity: 0.7 });
      this.vfx.ring(p.pos.x, p.pos.y + p.H * 0.5, p.pos.z, { r0: 0.4, r1: d.radius, dur: 0.7, color: 0x8aa0ff, opacity: 0.5 });
    }
    const a = this.t * 2.2;
    for (let i = 0; i < 2; i++) { // motas de luz lunar que orbitan
      const aa = a + i * Math.PI;
      this.vfx.orb(V(c.x + Math.cos(aa) * d.radius * 0.8, c.y + Math.sin(aa * 1.7) * 1.2, c.z + Math.sin(aa) * d.radius * 0.8), { r: 0.16, color: 0xe8eeff, life: 0.35 });
    }
    if (Math.random() < 0.3) this.g.fx.smokePuff(c.x + rnd(-2, 2), p.pos.y + 0.2, c.z + rnd(-2, 2), 0.7, 0x1a2040);
  }
}

/* ====================================================================== */
/*  LINCE — LUNA DE SANGRE                                                 */
/* ====================================================================== */
export class BloodMoonSkill extends Skill {
  begin() { this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'luna-roja', dur: d.prep, enter: this.enterMoon, tick: this.tickCharge },
      // CARGADA: se queda en el suelo con la energía contenida hasta que el jugador vuelve a pulsar el botón
      { name: 'contener', dur: 1e9, enter: this.enterHold, tick: this.tickHold },
      { name: 'onda-carmesi', dur: d.exec, enter: this.enterWave, tick: this.tickWave },
      { name: 'recuperacion', dur: d.recover, enter: () => { this.amb.end(); this.amb2.end(); this.moon.end(); }, tick: (dt, k) => { this.throwK = 1 - ease(k); this.chargeK = 0; pose.rx = lerp(0.12, 0, k); pose.sy = lerp(0.96, 1, k); } },
    ];
  }
  get canRecast() { return this.stageName === 'contener'; }
  recast() {
    if (this.stageName !== 'contener') return false;
    this.endStage();
    if (this.g.armButton) this.g.armButton(this.key); // el poder y su recarga cuentan desde el lanzamiento
    return true;
  }
  cleanup() { if (this.moon && this.moon.end) this.moon.end(); if (this.amb) { this.amb.end(); this.amb2.end(); } }
  enterMoon() {
    const d = this.def;
    this.amb = this.v2.ambience({ color: '#ff1a10', alpha: 0.45, blend: 'multiply', exposure: 0.85, dur: 1e6, fin: d.prep * 0.8, fout: 1.2 });
    this.amb2 = this.v2.ambience({ color: '#ff2a2a', alpha: 0.14, blend: 'screen', exposure: 1, dur: 1e6, fin: d.prep, fout: 1.2 });
    this.moon = this.v2.skyBody('blood', { size: 24, dist: 55, hold: true, glow: 0xff2010 });
    this.sfx('blood');
    this.shake(0.08);
    this.chargeK = 0; this.throwK = 0;
    this.setBones((B, dt, t, fx) => this.chargeBones(B, fx, t));
  }
  // postura de concentración EN EL SUELO: pies plantados, rodillas flexionadas, manos juntas delante del pecho
  // (al lanzar, los brazos se abren hacia delante y arriba)
  chargeBones(B, fx, t) {
    const e = this.chargeK || 0, th = this.throwK || 0, br = 0.04 * Math.sin(t * 3.2) * e; // respiración contenida
    for (const S of ['L', 'R']) {
      const sg = S === 'L' ? 1 : -1;
      fx.rot(B[`upper_arm_${S}`], 1, 0, 0, -0.85 * e - 0.9 * th + br);
      fx.rot(B[`upper_arm_${S}`], 0, 0, 1, sg * (0.35 * e - 0.25 * th));
      fx.rot(B[`forearm_${S}`], 1, 0, 0, -1.1 * e * (1 - th) - 0.15 * th);
      fx.rot(B[`thigh_${S}`], 1, 0, 0, -0.22 * e);
      fx.rot(B[`shin_${S}`], 1, 0, 0, 0.38 * e);
    }
    fx.rot(B.spine || B.spine_1, 1, 0, 0, 0.1 * e - 0.08 * th);
  }
  handsPos() {
    const m = this.p.model;
    const L = m && m.bones && m.bones.hand_L, R = m && m.bones && m.bones.hand_R;
    if (!L || !R) return this.center(0.55);
    m.root.updateMatrixWorld(true);
    const a = L.getWorldPosition(this._ha || (this._ha = new THREE.Vector3())), b = R.getWorldPosition(this._hb || (this._hb = new THREE.Vector3()));
    return V((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  }
  tickCharge(dt, k) {
    const pose = this.pose;
    this.chargeK = ease(Math.min(1, k / 0.4));
    pose.dy = 0; pose.spin = 0; pose.rx = 0.1 * this.chargeK; pose.sy = 1 - 0.04 * this.chargeK; // en el suelo: baja el centro de gravedad
    const h = this.handsPos(), c = this.center(0.45);
    for (let i = 0; i < 3; i++) { // la energía roja llega en espiral desde el suelo hasta sus manos
      const a = this.t * 5 + i * (TAU / 3), r = 3.2 * (1 - k) + 0.35;
      this.vfx.orb(V(h.x + Math.cos(a) * r, lerp(this.p.pos.y + 0.1, h.y, k) + Math.sin(a * 2) * 0.2, h.z + Math.sin(a) * r), { r: 0.12 + 0.08 * k, color: 0xff2a2a, life: 0.35 });
    }
    if (Math.random() < 0.35) this.vfx.sparks(c.x, c.y, c.z, 0xff3a3a, 2, 1.4);
    if (k > 0.6 && Math.random() < 0.15) { const m = this.moon.group.position; this.vfx.bolt(V(m.x, m.y, m.z), V(h.x, h.y, h.z), { color: 0xff3020, life: 0.1, jag: 2, segs: 12 }); }
  }
  enterHold() {
    this.holdOrb = this.track(this.v2.shell(this.handsPos(), { r: 0.3, color: 0x400006, rim: 0xff3a2a, opacity: 0.85, power: 1.6, core: 0.3, life: 0 }));
    this.aura = this.track(this.v2.shell(this.center(0.5), { r: 1, color: 0x200002, rim: 0xff2a20, opacity: 0.0, power: 3, core: 0.02, life: 0 }));
    ui.banner('find', '🔴 Luna de Sangre cargada', 'Pulsa otra vez el botón para lanzarla');
    this.sfx('shimmer');
  }
  tickHold(dt) {
    const pose = this.pose, t = this.t;
    this.chargeK = 1;
    pose.dy = 0; pose.spin = 0; pose.rx = 0.1; pose.sy = 0.96 + 0.01 * Math.sin(t * 3.2);
    const h = this.handsPos(), pul = 1 + 0.12 * Math.sin(t * 9) + 0.06 * Math.sin(t * 23);
    const grow = Math.min(1, t / 2); // la energía sigue concentrándose mientras espera
    this.holdOrb.mesh.position.copy(h);
    this.holdOrb.mesh.scale.setScalar((0.26 + 0.12 * grow) * pul);
    this.aura.mesh.position.copy(this.center(0.5));
    this.aura.mesh.scale.set(this.p.H * 0.62, this.p.H * 0.72, this.p.H * 0.62);
    this.aura.mat.uniforms.uOp.value = 0.22 + 0.06 * Math.sin(t * 6);
    if (Math.random() < 0.5) { const a = rnd(0, TAU), r = rnd(0.6, 1.4); this.vfx.orb(V(h.x + Math.cos(a) * r, h.y + rnd(-0.5, 0.5), h.z + Math.sin(a) * r), { r: 0.06, color: 0xff4a3a, life: 0.3 }); }
    if (Math.random() < 0.06) { const m = this.moon.group.position; this.vfx.bolt(V(m.x, m.y, m.z), V(h.x, h.y, h.z), { color: 0xff3020, life: 0.08, jag: 1.8, segs: 10 }); }
  }
  enterWave() {
    const d = this.def, p = this.p;
    this.throwK = 1;
    if (this.holdOrb) { this.holdOrb.kill(); this.holdOrb = null; }
    if (this.aura) { this.aura.kill(); this.aura = null; }
    this.shake(0.6); this.sfx('blast');
    this.g.chase.fovKick = 10;
    for (let i = 0; i < 4; i++) this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.5 + i, r1: d.radius * (1 - i * 0.12), dur: 0.7 + i * 0.25, color: i % 2 ? 0x8a0008 : 0xff2a2a, opacity: 0.9 });
    this.wave = this.track(this.v2.shell(this.center(0.4), { r: 1, color: 0x400005, rim: 0xff3030, opacity: 0.9, power: 1.6, core: 0.12, life: d.exec }));
    const hitNow = this.combat.inCircle(p.pos.x, p.pos.z, d.radius);
    for (const t of hitNow) {
      this.hit(t, d.damage);
      const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z);
      this.combat.push(t, dx, dz, d.force);
    }
    // rayos de la luna: uno por enemigo (los demás caen alrededor, solo efecto)
    const m = this.moon.group.position, tg = this.combat.targets();
    for (let i = 0; i < d.bolts; i++) {
      const t = tg[i];
      const at = t ? V(t.pos.x, t.pos.y + 0.6, t.pos.z) : V(p.pos.x + rnd(-d.radius, d.radius) * 0.7, p.pos.y, p.pos.z + rnd(-d.radius, d.radius) * 0.7);
      this.vfx.bolt(V(m.x, m.y, m.z), at, { color: 0xff2a1a, life: 0.3, jag: 2.6, segs: 14 });
      this.v2.beam(V(at.x, terrainH(at.x, at.z), at.z), V(at.x, terrainH(at.x, at.z) + 14, at.z), { r: 0.6, color: 0xff2a20, opacity: 0.8, life: 0.9 });
      if (t) this.hit(t, d.boltDamage);
    }
    for (const t of hitNow) this.combat.mark(t, d.markT); // marca DESPUÉS del golpe: el siguiente ataque del equipo hace +50 %
    for (let i = 0; i < 30; i++) { const a = rnd(0, TAU), r = rnd(0, d.radius); this.vfx.sparks(p.pos.x + Math.cos(a) * r, p.pos.y + 0.3, p.pos.z + Math.sin(a) * r, 0xff2a2a, 1, 3); }
  }
  tickWave(dt, k) {
    const d = this.def;
    this.chargeK = 1 - ease(k); this.throwK = 1;
    this.pose.dy = 0; this.pose.rx = 0.12; this.pose.spin = 0; this.pose.sy = 0.96;
    this.wave.mesh.position.copy(this.center(0.4));
    this.wave.mesh.scale.set(d.radius * back(k), d.radius * 0.45 * back(k), d.radius * back(k));
    this.wave.mat.uniforms.uOp.value = 0.9 * (1 - k);
    if (Math.random() < 0.6) { const a = rnd(0, TAU), r = d.radius * back(k); this.g.fx.smokePuff(this.p.pos.x + Math.cos(a) * r, this.p.pos.y + 0.3, this.p.pos.z + Math.sin(a) * r, 1.2, 0x400008); }
  }
}

/* ====================================================================== */
/*  FÉNEC — ESPEJISMOS (de fondo: no bloquea los demás poderes)            */
/* ====================================================================== */
export class MirageSkill extends Skill {
  static background = true;
  begin() {
    if (!this.p.model) return false;
    this.start();
    return true;
  }
  build() {
    const d = this.def, pose = this.pose;
    return [
      // ACTIVACIÓN: Halley vibra con el calor, el aire se distorsiona y la arena gira hacia ella
      { name: 'calor', dur: d.prep, enter: this.enterHeat, tick: (dt, k) => {
        pose.sy = 1 + 0.06 * Math.sin(this.t * 40) * k; pose.rz = 0.05 * Math.sin(this.t * 33) * k; // tiembla con el calor
        const p = this.p.pos, a = this.t * 14, r = 2.4 * (1 - k) + 0.4;
        for (let i = 0; i < 2; i++) { const b = a + i * Math.PI; this.g.fx.sparkle(p.x + Math.sin(b) * r, p.y + 0.3 + k * this.p.H * 0.6, p.z + Math.cos(b) * r, i ? 0xc89aff : 0xffd890, 0.6); }
      }, exit: this.spawn },
      // PROTECCIÓN: los espejismos orbitan a su alrededor y absorben los golpes
      { name: 'espejismos', dur: d.life, tick: this.tickLive },
      // DESACTIVACIÓN: los espejismos vuelven a ella y se desvanecen
      { name: 'disipar', dur: 0.5, enter: () => { if (this.ward) this.ward.end(); this.sfx('shimmer'); }, tick: (dt) => { if (this.ward) this.ward.update(dt); }, exit: this.fadeOut },
    ];
  }
  enterHeat() {
    const p = this.p.pos;
    this.sfx('shimmer');
    this.vfx.ring(p.x, null, p.z, { r0: 3.2, r1: 0.6, dur: this.def.prep, color: 0xc89aff, opacity: 0.6 });
    this.vfx.ring(p.x, null, p.z, { r0: 2.4, r1: 0.4, dur: this.def.prep, color: 0xffd890, opacity: 0.5 });
  }
  spawn() {
    const d = this.def, p = this.p;
    this.ward = new MirageWard(this.g, p, { n: d.copies, radius: d.radius, life: d.life });
    this.track({ kill: () => { if (this.ward) { this.ward.dispose(); this.ward = null; } } });
    p.mirageGuard = this;
    const q = p.pos;
    this.sfx('warp');
    this.vfx.sand(q.x, q.y + 0.3, q.z, 4);
    this.vfx.ring(q.x, null, q.z, { r0: 0.4, r1: d.radius + 1.2, dur: 0.5, color: 0xffd890 });
    this.vfx.ring(q.x, null, q.z, { r0: 0.3, r1: d.radius + 0.6, dur: 0.4, color: 0xc89aff });
    if (this.v2) this.v2.shell(new THREE.Vector3(q.x, q.y + p.H * 0.5, q.z), { r: d.radius, color: 0xc89aff, rim: 0xffe6b0, opacity: 0.5, life: 0.35 });
    ui.banner('find', '🪞', `Los espejismos absorben ${d.copies} golpes · vuelve a pulsar para saltar a uno`);
  }
  tickLive(dt) {
    const w = this.ward;
    if (!w) { this.endStage(); return; }
    w.update(dt);
    if (w.alive.length) this.p.evadeT = Math.max(this.p.evadeT, 0.15); // ESCUDO: mientras quede un espejismo, Halley no recibe daño
    else this.endStage();
  }
  // El juego avisa de un golpe bloqueado: un espejismo se interpone, lo absorbe y estalla
  absorb(from) {
    if (this.stageName !== 'espejismos' || !this.ward) return false;
    if (!this.ward.absorb(from)) return false;
    this.sfx('warp');
    return true;
  }
  fadeOut() {
    const q = this.p.pos;
    this.vfx.ring(q.x, null, q.z, { r0: 0.3, r1: 2.2, dur: 0.4, color: 0xffd890, opacity: 0.6 });
    this.vfx.sparks(q.x, q.y + this.p.H * 0.5, q.z, 0xe8c8ff, 10, 2);
  }
  get canRecast() { return this.stageName === 'espejismos' && this.ward && this.ward.alive.length > 0; }
  // teletransporte: el héroe desaparece en una distorsión y aparece en el espejismo, que estalla en arena
  recast() {
    const d = this.def, p = this.p;
    const tgt = this.ward && this.ward.takeForBlink();
    if (!tgt) return false;
    const from = p.pos.clone();
    this.vfx.sand(from.x, from.y + 0.3, from.z, 4);
    this.vfx.ring(from.x, null, from.z, { r0: 0.3, r1: 2.4, dur: 0.4, color: 0xffd890 });
    this.vfx.strip(from, tgt.pos, { width: 0.6, color: 0xffe0a0, opacity: 0.35, life: 0.5 });
    p.pos.copy(tgt.pos);
    p.facing = tgt.facing;
    p.vx = p.vz = 0; p.vy = 0;
    p.evadeT = Math.max(p.evadeT, 0.8); // ESCUDO: al saltar al espejismo esquiva los golpes
    this.sfx('warp');
    const q = p.pos;
    this.vfx.sand(q.x, q.y + 0.3, q.z, 8);
    this.vfx.ring(q.x, null, q.z, { r0: 0.4, r1: d.burstRadius, dur: 0.5, color: 0xffc870 });
    this.vfx.sparks(q.x, q.y + 0.5, q.z, 0xfff0c0, 14, 3);
    for (const t of this.combat.inCircle(q.x, q.z, d.burstRadius)) { this.combat.blind(t, d.blindT); this.hit(t, d.damage); }
    return true;
  }
  cleanup() {
    if (this.p.mirageGuard === this) this.p.mirageGuard = null;
  }
}

/* ====================================================================== */
/*  VUELO (Águila: alas · Fénec: orejas) — de fondo                        */
/* ====================================================================== */
export class FlightSkill extends Skill {
  static background = true;
  begin() {
    const p = this.p;
    if (p.fly) return false;
    if (p.swimming) { ui.banner('find', this.def.icon, 'No puedes despegar desde el agua'); return false; }
    this.ears = this.def.id === 'ears';
    this.wings = this.chain('wing_L_').length ? { L: this.chain('wing_L_'), R: this.chain('wing_R_') } : null;
    this.earB = this.chain('ear_L_').length ? { L: this.chain('ear_L_'), R: this.chain('ear_R_') } : null;
    this.start();
    return true;
  }
  build() {
    const d = this.def, pose = this.pose;
    return [
      // OREJAS: primero CARGA (las orejas se abren y baten cada vez más rápido, la energía crece a su alrededor)
      ...(this.ears && d.chargeT ? [{ name: 'carga', dur: d.chargeT, enter: this.enterCharge, tick: this.tickCharge }] : []),
      { name: 'despegue', dur: d.takeoffT, enter: this.enterTakeoff, tick: (dt, k) => { pose.sy = k < 0.5 ? 1 - 0.18 * (k / 0.5) : lerp(0.82, 1.08, (k - 0.5) / 0.5); this.flapRate = 1.6; } },
      { name: 'vuelo', dur: 9999, enter: this.enterFly, tick: this.tickFly },
      { name: 'aterrizaje', dur: 0.4, enter: this.enterLand, tick: (dt, k) => { pose.sy = k < 0.4 ? lerp(1, 0.84, k / 0.4) : lerp(0.84, 1, (k - 0.4) / 0.6); } },
    ];
  }
  enterCharge() {
    this.flapRate = 0.2; this.flapPh = 0;
    this.setBones(this.bonesFx.bind(this));
    ui.banner('find', '👂', `Cargando el vuelo… (${this.def.chargeT} s)`);
    this.sfx('wind');
    this.chT = 0;
  }
  tickCharge(dt, k) {
    const p = this.p, pose = this.pose, fx = this.g.fx;
    this.flapRate = 0.2 + 1.4 * k * k;              // las orejas se preparan: cada vez baten más rápido
    pose.sy = 1 - 0.08 * Math.sin(Math.min(1, k * 1.2) * Math.PI * 0.5); pose.dy = -0.03 * k; // se agacha un poco, lista para saltar
    // energía que se acumula alrededor de las orejas y bajo sus pies (crece con la carga)
    this.chT -= dt;
    if (this.chT <= 0) {
      this.chT = 0.06;
      const c = this.center(0.95), a = rnd(0, TAU), r = 0.9 - 0.6 * k;
      fx.sparkle(c.x + Math.cos(a) * r, c.y + rnd(-0.2, 0.3), c.z + Math.sin(a) * r, Math.random() < 0.5 ? 0xffe0a0 : 0xffffff, 0.5);
      this.vfx.orb(this.center(0.95), { r: 0.1 + 0.35 * k, color: 0xffd890, opacity: 0.25 + 0.3 * k, life: 0.15 });
      if (Math.random() < 0.4) this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 1.6 - k, r1: 0.3, dur: 0.3, color: 0xffd890, opacity: 0.4 });
    }
    if (Math.random() < 0.3 * k) this.vfx.sand(p.pos.x, p.pos.y + 0.05, p.pos.z, 1);
    if (k > 0.33 && !this.ch1) { this.ch1 = true; this.sfx('flap'); }
    if (k > 0.66 && !this.ch2) { this.ch2 = true; this.sfx('flap'); }
  }
  enterTakeoff() {
    const p = this.p;
    this.flapRate = 1;
    this.flapPh = this.flapPh || 0;
    this.setBones(this.bonesFx.bind(this));
    this.sfx(this.ears ? 'flap' : 'wind');
    if (this.ears) this.vfx.sand(p.pos.x, p.pos.y + 0.1, p.pos.z, 5);
    else this.vfx.dust(p.pos.x, p.pos.y + 0.1, p.pos.z, 12, 2);
    this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.4, r1: 4, dur: 0.5, color: this.ears ? 0xffd890 : 0xcfefff });
  }
  enterFly() {
    const d = this.def, p = this.p;
    p.fly = { kind: d.id, t: 0, max: d.flyT, speed: d.speed, climb: d.climb, sink: d.sink, ceil: d.ceil, lean: this.ears ? 0.25 : 0.75, minT: 0.6 };
    if (!this.ears && d.levels) { p.fly.levels = d.levels; p.fly.level = 1; } // águila: tres niveles de altura
    p.vy = d.climb * 1.4;
    p.grounded = false; p.support = null;
    if (!this.ears) { this.camWas = { dist: this.g.chase.distTarget }; ui.banner('find', '🦅', d.levels ? 'SALTAR = subir de nivel (3 alturas) · V o Ctrl = bajar · L = aterrizar · SPRINT = más rápido' : 'SALTAR = subir · suelta = planear · SPRINT = más rápido · baja al suelo para aterrizar'); }
    else ui.banner('find', '👂', 'Mantén SALTAR para subir');
    this.flapT = 0;
  }
  tickFly(dt) {
    const d = this.def, p = this.p, pose = this.pose, f = p.fly;
    if (!f || f.kind !== d.id) { this.endStage(); return; }
    const climbing = p.vy > 0.8, k = Math.min(1, Math.hypot(p.vx, p.vz) / d.speed);
    const lv = f.levels ? (f.ending ? 0 : f.level) : 2;
    // el águila aletea más cerca del suelo y planea con las alas abiertas en lo alto; el fénec aletea sin parar
    this.flapRate = climbing ? 1.5 : this.ears ? 1 : f.ending ? 0.9 : [0.9, 0.7, 0.45, 0.22][lv] + 0.3 * (1 - k);
    if (this.ears) { pose.rz = 0.12 * Math.sin(this.t * 2.3); pose.dy = 0.06 * Math.sin(this.t * d.flap * 0.5); } // cuelga y se balancea bajo las orejas
    else pose.rz = clamp(-(p.vx * Math.cos(p.facing) - p.vz * Math.sin(p.facing)) * 0.03, -0.35, 0.35);
    // sonido de aleteo
    this.flapT -= dt * this.flapRate;
    if (this.flapT <= 0) { this.flapT = this.ears ? 0.18 : 0.42; if (this.ears || climbing) this.sfx('flap'); }
    const c = this.center(0.6);
    if (this.ears) { if (Math.random() < 0.35) this.vfx.sparks(c.x, c.y + p.H * 0.4, c.z, 0xffe0a0, 1, 1); }
    else if (Math.random() < 0.4) this.g.fx.mist(c.x - Math.sin(p.facing) * 0.8, c.y, c.z - Math.cos(p.facing) * 0.8, 0xe8f6ff, 0.5); // estela de aire
    if (this.ears && f.max - f.t < 1.2 && Math.random() < 0.2) ui.alert('👂 ¡Se cansan las orejas!', 700);
    // cámara aérea del águila: se aleja y mira desde arriba para explorar el mapa
    if (!this.ears) {
      const ch = this.g.chase;
      const cd = f.levels && d.camDists ? (lv ? d.camDists[lv - 1] : d.camDists[0]) : d.camDist, cp = f.levels && d.camPitches ? (lv ? d.camPitches[lv - 1] : d.camPitches[0]) : d.camPitch;
      ch.distTarget = lerp(ch.distTarget, cd, Math.min(1, dt * 1.5));
      if (ch.pitch < cp || f.levels) ch.pitch = lerp(ch.pitch, cp, Math.min(1, dt * 1.2));
      if (f.levels) pose.rx = (pose.rx || 0) + (lv === 3 ? -0.08 : 0) + (f.ending ? 0.12 : 0); // en lo alto, cuerpo estirado; al bajar, se inclina hacia el suelo
    }
  }
  enterLand() {
    const p = this.p;
    this.sfx('land');
    if (this.ears) this.vfx.sand(p.pos.x, p.pos.y + 0.1, p.pos.z, 6);
    else this.vfx.dust(p.pos.x, p.pos.y + 0.1, p.pos.z, 10, 2);
    this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.3, r1: 3, dur: 0.45, color: this.ears ? 0xffd890 : 0xffffff });
    this.restoreCam();
  }
  restoreCam() { if (this.camWas) { this.g.chase.distTarget = this.p.cam.dist; this.camWas = null; } }
  // aleteo de alas u orejas encima de la animación
  bonesFx(bones, dt, t, fx) {
    this.flapPh = (this.flapPh || 0) + dt * this.def.flap * 0.4 * (this.flapRate || 1);
    const ph = this.flapPh, s = Math.sin(ph);
    if (this.wings) { // alas: batido amplio que se curva en la punta; planeo = alas abiertas y quietas
      const amp = 0.35 + 0.45 * Math.min(1, this.flapRate);
      this.wings.L.forEach((b, i) => fx.rot(b, 0, 0, 1, (s * amp - 0.1) * (i === 0 ? 1 : 0.45) + Math.sin(ph - i * 0.6) * 0.15 * i * 0.3));
      this.wings.R.forEach((b, i) => fx.rot(b, 0, 0, 1, -((s * amp - 0.1) * (i === 0 ? 1 : 0.45) + Math.sin(ph - i * 0.6) * 0.15 * i * 0.3)));
    }
    if (this.earB) { // orejas: se abren hacia los lados y baten como hélices
      const open = 0.85, amp = 0.4;
      this.earB.L.forEach((b, i) => { fx.rot(b, 0, 0, 1, i === 0 ? -(open + s * amp) : -s * amp * 0.4); fx.rot(b, 1, 0, 0, Math.cos(ph) * 0.25); });
      this.earB.R.forEach((b, i) => { fx.rot(b, 0, 0, 1, i === 0 ? open + s * amp : s * amp * 0.4); fx.rot(b, 1, 0, 0, Math.cos(ph) * 0.25); });
    }
  }
  get canRecast() { return false; } // el águila aterriza con V (o Ctrl) desde el nivel 1; las orejas se cansan solas
  recast() { if (this.p.fly) this.p.fly.ending = true; ui.banner('find', '🦅', 'Aterrizando…'); return true; }
  dispose() {
    this.restoreCam();
    if (this.p.fly && this.p.fly.kind === this.def.id) this.p.fly = null;
    super.dispose();
  }
}

/* ====================================================================== */
/*  ZORRA ÁRTICA — AURORA POLAR                                            */
/* ====================================================================== */
export class AuroraSkill extends Skill {
  begin() { this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    return [
      // INVOCACIÓN: pose de invocación; el ESCUDO de aurora la envuelve poco a poco, nieve y cristales flotando
      // y energía que se acumula bajo sus patas
      { name: 'canalizar', dur: d.prep, enter: this.enterCall, tick: this.tickCall },
      { name: 'zona-polar', dur: d.exec, enter: this.enterZone, tick: this.tickZone },
      { name: 'recuperacion', dur: d.recover, enter: () => { this.lock(false); }, tick: (dt, k) => { pose.rx = lerp(-0.15, 0, k); pose.dy = lerp(0.1, 0, k); this.tickZone(dt, 1); } },
    ];
  }
  /* ESCUDO DE AURORA + ÁREA DE CONGELACIÓN (efectos con su propia vida: duran toda la congelación, más que la
     habilidad, y siempre centrados en Kira, se mueva o no). El aro del suelo marca el radio REAL (d.radius):
     todo lo que esté dentro queda congelado 5 s; lo de fuera, no. */
  enterCall() {
    const d = this.def, p = this.p;
    const fin = d.freezeIn ?? 0.45, hold = d.freezeHold ?? 5, fout = d.freezeOut ?? 0.9;
    const total = d.prep + fin + hold + fout;
    this.lock(true);
    this.amb = this.v2.ambience({ color: '#3a5a8a', alpha: 0.22, blend: 'multiply', exposure: 0.8, dur: total, fin: d.prep, fout: 1.2 }); // luz polar suave: el escudo resalta
    this.sfx('aurora');
    const shield = auroraShield(this.vfx.group), area = frostArea(this.vfx.group, d.radius, terrainH);
    const T0 = d.prep, END = total, sk = this;
    this.shieldK = 0;
    this.vfx.add(new THREE.Group(), END, (it) => {
      const t = it.t, c = p.pos;
      // escudo: crece en la invocación, se mantiene mientras dura la congelación y se apaga suavemente al final
      const ks = Math.min(1, t / T0) * (t > END - 0.8 ? Math.max(0, (END - t) / 0.8) : 1);
      sk.shieldK = ks;
      const pulse = 1 + 0.03 * Math.sin(t * 5);
      shield.set(V(c.x, c.y + p.H * 0.5 + (p.pose.dy || 0), c.z), p.H * 0.48 * pulse, p.H * 0.62 * pulse, 0.85 * ks, t);
      // área: aparece al liberar el poder (se expande en 0,35 s) y desaparece con el deshielo
      const ka = t < T0 ? 0 : Math.min(1, (t - T0) / 0.35) * (t > END - fout ? Math.max(0, (END - t) / fout) : 1);
      const gy = p.floorY ? p.floorY(c.x, c.z, c.y + 0.5) : terrainH(c.x, c.z);
      area.set(c.x, gy, c.z, ka, t);
      if (ka > 0.3 && Math.random() < 0.6) { // escarcha y destellos dentro del área
        const a = rnd(0, TAU), r = Math.sqrt(Math.random()) * d.radius;
        sk.g.fx.sparkle(c.x + Math.cos(a) * r, gy + rnd(0.1, 1.6), c.z + Math.sin(a) * r, [0x60ffa0, 0x40e0ff, 0xa070ff, 0xe8fbff][Math.floor(Math.random() * 4)], 0.6);
      }
      if (t >= END - 0.001) { shield.dispose(); area.dispose(); }
    });
  }
  tickCall(dt, k) {
    const p = this.p, pose = this.pose, fx = this.g.fx, e = ease(k);
    pose.rx = -0.45 * e; pose.dy = 0.25 * e; // mira al cielo con las colas alzadas
    // la energía se concentra bajo sus patas: anillos que se cierran hacia ella
    if (Math.random() < 0.35) this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 2.6, r1: 0.4, dur: 0.35, color: Math.random() < 0.5 ? 0x7ae8ff : 0xa07aff, opacity: 0.5 });
    // nieve y cristales de hielo que flotan a su alrededor
    for (let i = 0; i < 2; i++) { const a = rnd(0, TAU), r = rnd(0.5, 1.6); fx.sparkle(p.pos.x + Math.cos(a) * r, p.pos.y + rnd(0.2, p.H * 1.2), p.pos.z + Math.sin(a) * r, Math.random() < 0.5 ? 0xe8fbff : 0x8fe4ff, 0.6); }
    if (Math.random() < 0.5) fx.iceShard(p.pos.x + rnd(-1, 1), p.pos.y + rnd(0.3, 1.4), p.pos.z + rnd(-1, 1), 0.6);
  }
  enterZone() {
    const d = this.def, p = this.p;
    // LIBERACIÓN: el frío se expande desde ella hasta el aro (radio real) en ondas de colores de aurora
    const fin = d.freezeIn ?? 0.45, hold = d.freezeHold ?? 5, fout = d.freezeOut ?? 0.9;
    // CONGELACIÓN EN EL ÁREA: todo lo que entre en el radio mientras dura queda congelado EXACTAMENTE 5 s
    if (this.g.frost) this.g.frost.start(fin + hold + fout, { fin, fout, area: { center: () => p.pos, r: d.radius } });
    [0x3a8cff, 0x40f0ff, 0x40ffd0, 0xa070ff, 0x60ffa0].forEach((col, i) => this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.4, r1: d.radius * (1 - i * 0.04), dur: 0.5 + i * 0.08, color: col, opacity: 0.55 }));
    this.sfx('chime');
    this.shake(0.22);
    this.lock(false); // ella puede moverse: el escudo y el área la siguen
    this.tickT = 0; this.freezeT = d.freezeEvery * 0.5;
  }
  tickZone(dt) {
    const d = this.def, g = this.g, p = this.p, at = p.pos; // el área va centrada en Kira
    // dentro del área (siempre lo está): sus recargas avanzan más rápido, como antes
    for (const id in g.toolCd) if (g.toolCd[id] > 0) g.toolCd[id] = Math.max(0, g.toolCd[id] - dt * d.cdHeal);
    p.cd = Math.max(0, p.cd - dt * d.cdHeal);
    for (const t of this.combat.inCircle(at.x, at.z, d.radius)) { this.combat.slow(t, d.slowF, 0.6); this.dot(t, d.damage, dt); }
    this.freezeT -= dt;
    if (this.freezeT <= 0) { // pulso de congelación dentro del aro
      this.freezeT = d.freezeEvery;
      this.vfx.ring(at.x, null, at.z, { r0: 0.5, r1: d.radius, dur: 0.7, color: 0xa0f0ff, opacity: 0.6 });
      for (const t of this.combat.inCircle(at.x, at.z, d.radius)) {
        this.combat.root(t, d.freezeT);
        this.vfx.ice(t.pos.x, t.pos.y + 0.4, t.pos.z, 6);
      }
    }
    if (Math.random() < 0.4) { const a = rnd(0, TAU), r = Math.sqrt(Math.random()) * d.radius, x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r; g.fx.iceShard(x, terrainH(x, z) + 0.2, z, 0.8); }
  }
}

/* ====================================================================== */
/*  ZORRA ÁRTICA — SOLSTICIO DE VERANO                                     */
/* ====================================================================== */
// KIRA — CARGA, DIRECCIÓN Y LANZAMIENTO (Solsticio y Rueda de las Estaciones)
// 1.ª pulsación: carga (el poder aún no sale). Mientras está cargado, el jugador la orienta con las teclas de
// dirección (una franja y un círculo en el suelo marcan hacia dónde y dónde caerá). 2.ª pulsación: se lanza en esa
// dirección. Si espera demasiado (AIM_MAX s) se lanza solo hacia donde mira.
export const AIM_MAX = 10;
export function aimPoint(sk, range) {
  const p = sk.p, f = sk.fwd;
  // si hay un enemigo justo en la línea de tiro (cono estrecho), el poder va a él; si no, a la distancia máxima
  const t = sk.combat.aimTarget(p.pos.x, p.pos.z, p.facing, 12 * DEG, range);
  const d = t ? Math.min(range, Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z)) : range;
  const x = p.pos.x + f.x * d, z = p.pos.z + f.z * d;
  return V(x, p.floorY(x, z, p.pos.y + 2), z);
}
export function aimShow(sk, range, r, color) {
  const p = sk.p, at = aimPoint(sk, range);
  if (!sk.aimStrip) {
    sk.aimStrip = sk.track(sk.vfx.telegraph('strip', { x: p.pos.x, z: p.pos.z, x2: at.x, z2: at.z, width: 1.1, color, opacity: 0.28 }));
    sk.aimDisc = sk.track(sk.vfx.telegraph('disc', { x: at.x, z: at.z, r, color, opacity: 0.22 }));
  }
  sk.aimStrip.set(p.pos.x, p.pos.z, { x2: at.x, z2: at.z }); sk.aimStrip.setProgress(0.5 + 0.5 * Math.sin(sk.t * 5) * 0.5 + 0.25);
  sk.aimDisc.set(at.x, at.z, { r }); sk.aimDisc.setProgress(1);
  return at;
}
export function aimHide(sk) {
  for (const k of ['aimStrip', 'aimDisc']) if (sk[k]) { sk[k].kill(); sk[k] = null; }
}
export class SolsticeSkill extends Skill {
  begin() { this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'aura-solar', dur: d.prep, enter: this.enterAura, tick: (dt, k) => { this.tickAura(dt, k); aimShow(this, d.range, d.radius, 0xffc040); } },
      // CARGADO: espera la orden del jugador; mientras, se orienta con las teclas de dirección
      { name: 'contener', dur: AIM_MAX, enter: this.enterHold, tick: this.tickHold, exit: () => { this.at = aimPoint(this, d.range); aimHide(this); } },
      { name: 'lanzamiento', dur: d.fly, enter: this.enterThrow, tick: this.tickThrow },
      { name: 'expansion', dur: d.exec, enter: this.enterBurst, tick: this.tickBurst },
      { name: 'recuperacion', dur: d.recover, enter: () => { this.lock(false); this.amb.end(); if (this.sun && this.sun.end) this.sun.end(); }, tick: (dt, k) => { pose.dy = lerp(0.6, 0, ease(k)); pose.rx = lerp(0.15, 0, k); } },
    ];
  }
  get canRecast() { return this.stageName === 'contener'; }
  recast() {
    if (this.stageName !== 'contener') return false;
    this.endStage();
    if (this.g.armButton) this.g.armButton(this.key); // el escudo y su recarga cuentan desde el lanzamiento
    return true;
  }
  cleanup() { aimHide(this); if (this.amb) this.amb.end(); if (this.sun && this.sun.end) this.sun.end(); }
  enterHold() {
    ui.banner('find', '🌞 Solsticio cargado', 'Oriéntalo con las teclas de dirección y pulsa otra vez el botón para lanzarlo');
    this.sfx('shimmer');
  }
  tickHold(dt) {
    this.tickAura(dt, 1);
    aimShow(this, this.def.range, this.def.radius, 0xffc040);
  }
  // el sol cargado sale de sus manos y vuela hasta el punto elegido
  enterThrow() {
    const c = this.center(0.6);
    this.from = c.clone();
    this.ball = this.track(this.v2.shell(c, { r: 0.5, color: 0xff8a10, rim: 0xffe070, opacity: 0.9, power: 1.6, core: 0.3, life: 0 }));
    this.sfx('whoosh');
  }
  tickThrow(dt, k) {
    const a = this.from, b = this.at, e = ease(k);
    const x = lerp(a.x, b.x, e), z = lerp(a.z, b.z, e), y = lerp(a.y, b.y + 0.8, e) + Math.sin(k * Math.PI) * 1.6;
    this.ball.mesh.position.set(x, y, z);
    this.ball.mesh.scale.setScalar(0.7 + 0.5 * k);
    this.pose.rx = 0.15; this.pose.dy = 0.6 * (1 - k * 0.3);
    if (Math.random() < 0.8) this.vfx.sparks(x, y, z, 0xffe080, 2, 1.4);
  }
  enterAura() {
    const d = this.def, total = 60; // dura lo que tarde en lanzarse; se apaga al terminar
    this.lock(true);
    this.amb = this.v2.ambience({ color: '#ffb040', alpha: 0.2, blend: 'screen', exposure: 1.18, dur: total, fin: d.prep, fout: 0.9 });
    this.aura = this.track(this.v2.shell(this.center(0.5), { r: 0.6, color: 0xff8a10, rim: 0xffe070, opacity: 0.8, power: 1.8, core: 0.25, life: 0 }));
    this.sun = this.v2.skyBody('sun', { size: 12, hold: true, glow: 0xffa030, side: 0.4 });
    this.sfx('sun');
    this.rayA = 0;
  }
  tickAura(dt, k) {
    const d = this.def, pose = this.pose, c = this.center(0.5);
    this.p.evadeT = Math.max(this.p.evadeT, 0.15); // ESCUDO: el aura solar la protege
    this.combat.deflect(this.p.pos.x, this.p.pos.z, 3);
    pose.dy = 0.6 * ease(k); pose.rx = 0.15 * Math.sin(this.t * 4) * k; pose.sy = 1 + 0.06 * k;
    this.aura.mesh.position.copy(c);
    this.aura.mesh.scale.setScalar(0.7 + 0.9 * k + 0.08 * Math.sin(this.t * 14));
    // rayos solares que giran a su alrededor
    this.rayA += dt * 2.5;
    if (Math.random() < 0.6) {
      const a = this.rayA + rnd(0, TAU);
      this.v2.beam(c, V(c.x + Math.cos(a) * 5, c.y + rnd(-0.5, 2.5), c.z + Math.sin(a) * 5), { r: 0.12, color: 0xffd060, opacity: 0.55, life: 0.25 });
    }
    if (Math.random() < 0.7) this.vfx.sparks(c.x, c.y, c.z, 0xffe080, 2, 1.8);
    if (Math.random() < 0.4) this.vfx.ring(c.x, null, c.z, { r0: 0.5, r1: 2.5, dur: 0.5, color: 0xffb030, opacity: 0.4 }); // ondas de calor
  }
  enterBurst() {
    const d = this.def, p = this.at; // la expansión solar ocurre donde cae el sol lanzado (no alrededor de ella)
    this.shake(0.4); this.sfx('blast');
    this.g.chase.fovKick = 6;
    if (this.ball) { this.ball.mesh.visible = false; }
    const bc = V(p.x, p.y + 0.8, p.z);
    this.dome = this.track(this.v2.shell(bc, { r: 1, color: 0xff7a10, rim: 0xfff0a0, opacity: 0.7, power: 1.6, core: 0.12, life: d.exec }));
    for (let i = 0; i < d.rays; i++) {
      const a = (i / d.rays) * TAU, c = bc;
      this.v2.beam(c, V(c.x + Math.cos(a) * d.radius * 1.2, c.y + 0.5, c.z + Math.sin(a) * d.radius * 1.2), { r: 0.3, color: 0xffc040, opacity: 0.6, life: 0.7 });
    }
    this.vfx.ring(p.x, null, p.z, { r0: 0.5, r1: d.radius, dur: 0.6, color: 0xffd060 });
    this.vfx.ring(p.x, null, p.z, { r0: 0.5, r1: d.radius * 0.8, dur: 0.8, color: 0xff6a10 });
    this.vfx.fire(p.x, p.y + 0.2, p.z, 18, 1.4);
    const c = this.combat;
    for (const t of c.inCircle(p.x, p.z, d.radius)) {
      this.hit(t, d.damage);
      const { dx, dz } = this.awayFrom(t, p.x, p.z);
      c.push(t, dx, dz, d.force);
      this.linger({ life: d.burnT, update: (dt) => { if (!t.dead) { c.damage(t, d.burnDps * dt, { quiet: true }); if (Math.random() < 0.2) this.g.fx.flame(t.pos.x, t.pos.y + 0.4, t.pos.z, 0.6, 0.3); } }, end: () => {} });
    }
  }
  tickBurst(dt, k) {
    const d = this.def;
    this.p.evadeT = Math.max(this.p.evadeT, 0.15);
    this.pose.dy = 0.6; this.pose.rx = 0.15;
    this.aura.mesh.position.copy(this.center(0.5));
    this.aura.mesh.scale.setScalar(Math.max(0.01, 1.6 * (1 - k)));
    this.dome.mesh.position.set(this.at.x, this.at.y + 0.6, this.at.z);
    this.dome.mesh.scale.set(d.radius * back(k), d.radius * 0.6 * back(k), d.radius * back(k));
    this.dome.mat.uniforms.uOp.value = 0.85 * (1 - k);
    if (Math.random() < 0.7) { const a = rnd(0, TAU), r = d.radius * back(k); this.g.fx.flame(this.at.x + Math.cos(a) * r, this.at.y + 0.2, this.at.z + Math.sin(a) * r, 0.8, 0.3); }
  }
}

const Maelstrom_DEBRIS = { geo: null, mat: null }; // rocas y fragmentos que arranca el remolino (compartidos)

/* ====================================================================== */
/*  JAGLION — TRANSFORMACIÓN EN ROCA (botón VELOCIDAD)                     */
/*  Misma mecánica de siempre (transformarse → rodar controlado por el     */
/*  jugador → volver a su forma; segunda pulsación = salir antes).         */
/*  Animación: anticipación (se agacha y recoge brazos y piernas), se      */
/*  enrosca mientras la roca le cubre (fragmentos que se juntan), cae con  */
/*  peso, rueda sin deslizar (giro = distancia / radio), se inclina con    */
/*  la inercia, rebota al aterrizar y se abre al recuperar su forma.       */
/* ====================================================================== */
const dampK = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2); // Bézier "ease in-out"
const easeOutBack = (k, s = 1.6) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
let BLOB_TEX = null;
function blobTex() { // sombra de contacto: mancha oscura de bordes suaves
  if (BLOB_TEX) return BLOB_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  BLOB_TEX = new THREE.CanvasTexture(c);
  return BLOB_TEX;
}
export class RockSkill extends Skill {
  begin() { this.start(); return true; }
  build() {
    const d = this.def;
    return [
      { name: 'transformacion', dur: d.transformT, enter: this.enterTransform, tick: this.tickTransform },
      { name: 'rodar', dur: d.rollT, enter: this.enterRoll, tick: this.tickRoll, exit: this.exitRoll },
      { name: 'recuperar-forma', dur: d.recover, enter: this.enterRecover, tick: this.tickRecover },
    ];
  }
  ballR() { return this.p.H * 0.5 * this.def.radius; }
  // la bola: un grupo que se aplasta y se inclina (inercia) y, dentro, la roca que rueda
  makeBall() {
    const R = this.ballR();
    const real = propModel('roca');
    let rock;
    if (real) {
      // ROCA 3D DEL ARCHIVO roca.glb: se respetan su malla y sus materiales (color, normales y rugosidad).
      // El modelo llega normalizado (base en y=0, altura 1, ≈1 de ancho): se escala a diámetro 2 y se baja 1 para
      // que su CENTRO quede en el pivote → gira sobre su eje real y, con el grupo a escala R, mide R de radio.
      rock = new THREE.Group();
      real.scale.setScalar(2);
      real.position.y = -1;
      real.rotation.set(rnd(0, TAU), rnd(0, TAU), 0); // cada transformación muestra otra cara de la roca
      real.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (!this.rockSrcMat) this.rockSrcMat = o.material; } });
      rock.add(real);
      const sm = this.rockSrcMat || {};
      this.chunkMat = new THREE.MeshStandardMaterial({ map: sm.map || null, normalMap: sm.normalMap || null, color: sm.map ? 0xffffff : 0x8c7a62, roughness: 0.95, flatShading: true });
      this.chunkMat.userData.own = true;
      this._pg = new THREE.DodecahedronGeometry(1, 0);
    } else {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8c7a62, roughness: 0.95, flatShading: true, emissive: 0x2a1a0a, emissiveIntensity: 0.12 });
    mat.userData.own = true;
    rock = new THREE.Mesh(this.v2.rockGeo, mat);
    rock.castShadow = true; rock.receiveShadow = true;
    // placas y aristas de roca encima de la esfera: se ve como un cuerpo de piedra, no como una bola lisa
    const pm = [0x6b5a48, 0x7a6a56, 0x544638].map((c) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, flatShading: true }); m.userData.own = true; return m; });
    const pg = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 14; i++) {
      const u = rnd(-1, 1), a = rnd(0, TAU), s = Math.sqrt(1 - u * u);
      const m = new THREE.Mesh(pg, pm[i % 3]);
      m.position.set(Math.cos(a) * s * 0.86, u * 0.86, Math.sin(a) * s * 0.86);
      m.scale.set(rnd(0.16, 0.24), rnd(0.07, 0.11), rnd(0.16, 0.24));
      m.lookAt(m.position.clone().multiplyScalar(2)); m.castShadow = true;
      rock.add(m);
    }
    this._pg = pg;
    this.chunkMat = pm[0];
    }
    const grp = new THREE.Group();
    grp.add(rock);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, opacity: 0 }));
    blob.material.userData.own = true;
    blob.rotation.x = -Math.PI / 2; blob.renderOrder = 2;
    this.prop(grp); this.prop(blob);
    this.grp = grp; this.rock = rock; this.blob = blob;
    this.roll = new THREE.Quaternion();
    this.sq = 0; this.sqV = 0;         // muelle de aplastamiento (impactos)
    this.tilt = new THREE.Vector2();   // inclinación por inercia
    this.lastV = new THREE.Vector2(this.p.vx, this.p.vz);
    this.last = this.p.pos.clone();
    grp.scale.setScalar(0.0001);
    return R;
  }
  // brazos y piernas recogidos hacia el torso (k = 0 normal … 1 enroscado)
  tuckBones(B, fx) {
    const k = this.tuck || 0;
    for (const S of ['L', 'R']) {
      const sg = S === 'L' ? 1 : -1;
      fx.rot(B[`upper_arm_${S}`], 1, 0, 0, -0.7 * k);
      fx.rot(B[`upper_arm_${S}`], 0, 0, 1, -sg * 0.35 * k);
      fx.rot(B[`forearm_${S}`], 1, 0, 0, -1.6 * k);
      fx.rot(B[`thigh_${S}`], 1, 0, 0, -1.0 * k);
      fx.rot(B[`shin_${S}`], 1, 0, 0, 1.5 * k);
    }
    fx.rot(B.spine || B.spine_1, 1, 0, 0, 0.55 * k);
  }
  updBlob(R, k) {
    const p = this.p, gy = p.floorY ? p.floorY(p.pos.x, p.pos.z, p.pos.y + 0.5) : terrainH(p.pos.x, p.pos.z);
    const h = Math.max(0, p.pos.y - gy);
    this.blob.position.set(p.pos.x, gy + 0.04, p.pos.z);
    this.blob.scale.setScalar(R * 2.3 * (1 + h * 0.25));
    this.blob.material.opacity = k * clamp(1 - h * 0.35, 0.15, 1);
  }
  // PIEDRA SOBRE SU PROPIO CUERPO: los materiales del héroe se clonan con el frente de roca (el mismo sombreador del
  // Gigante de Roca) que sube de los pies a la cabeza; el modelo original no se toca y se restaura al terminar
  stoneBody() {
    const p = this.p;
    this.U = { uRise: { value: 0 }, uAmt: { value: 1 }, uFeet: { value: p.pos.y }, uHt: { value: p.H }, uGlow: { value: 0 } };
    this.swaps = [];
    if (!p.model || !p.model.root) return;
    const cache = new Map();
    p.model.root.traverse((o) => {
      if (!o.isMesh || !o.material || o.userData.weapon || (o.parent && o.parent.userData && o.parent.userData.weapon)) return;
      if (!o.isSkinnedMesh && !o.userData.body) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const sz = o.geometry.boundingBox.getSize(new THREE.Vector3()), ns = 6 / Math.max(0.05, Math.max(sz.x, sz.y, sz.z));
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const out = mats.map((m) => { const key = m.uuid + ns.toFixed(2); if (!cache.has(key)) cache.set(key, petrifyMaterial(m, this.U, ns)); return cache.get(key); });
      this.swaps.push({ o, mat: o.material });
      o.material = Array.isArray(o.material) ? out : out[0];
    });
    this.newMats = [...cache.values()];
  }
  cleanup() {
    if (this.swaps) { for (const s of this.swaps) s.o.material = s.mat; this.swaps = null; }
    if (this.newMats) { for (const m of this.newMats) m.dispose(); this.newMats = null; }
    if (this.chunkMat && this.chunkMat.userData.own) { this.chunkMat.dispose(); this.chunkMat = null; }
    this.pose.sc = 1;
  }
  enterTransform() {
    this.lock(true);
    this.makeBall();
    this.stoneBody();
    this.tuck = 0;
    this.setBones((B, dt, t, fx) => this.tuckBones(B, fx));
    this.sfx('crack');
    this.crk = 0;
    // fragmentos de roca que se separan del suelo y se juntan alrededor de su cuerpo
    const p = this.p, R = this.ballR(), m = this.chunkMat;
    this.chunks = [];
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Mesh(this._pg, m), a = rnd(0, TAU), r = rnd(1.2, 2.2);
      c.scale.setScalar(rnd(0.12, 0.2) * R / 0.85);
      this.prop(c);
      this.chunks.push({ c, x0: Math.cos(a) * r, z0: Math.sin(a) * r, d: rnd(0, 0.2), spin: rnd(4, 9) });
    }
    this.landed = false;
  }
  tickTransform(dt, k) {
    const pose = this.pose, p = this.p, R = this.ballR();
    // FASE A — ANTICIPACIÓN (0–30 %): flexiona las piernas, baja el centro de gravedad y empieza a comprimirse
    const a = easeInOut(clamp(k / 0.3, 0, 1));
    // FASE B — PIEDRA (12–72 %): la roca sube de los pies a la cabeza con grietas finas y brillo interior suave
    if (this.U) {
      this.U.uFeet.value = p.pos.y; this.U.uHt.value = p.H;
      this.U.uRise.value = 1.1 * easeInOut(clamp((k - 0.12) / 0.6, 0, 1));
      this.U.uGlow.value = 0.35 * Math.sin(clamp((k - 0.2) / 0.8, 0, 1) * Math.PI);
    }
    // ...y se enrosca y comprime hasta una forma casi esférica (25–90 %)
    const c = easeInOut(clamp((k - 0.25) / 0.65, 0, 1));
    this.tuck = Math.max(a * 0.55, c);
    pose.sy = lerp(1, 0.86, a) * lerp(1, 0.66, c);
    pose.sc = lerp(1, 0.78, c);         // se compacta (de su altura a la de la roca), siempre con los pies en el suelo
    pose.rx = 0.25 * a + 0.9 * c;      // se inclina hacia delante (no hacia atrás): rueda hacia donde mira
    pose.dy = -0.06 * a;
    pose.hidden = k > 0.9;              // desaparece cuando la roca ya lo envuelve por completo (sin parpadeos)
    // grietas que crujen mientras se petrifica
    if (k > 0.2 && k < 0.75) { this.crk -= dt; if (this.crk <= 0) { this.crk = 0.22; this.sfx('crack'); } }
    // FASE C — LA ROCA (55–100 %): la roca real crece desde dentro del cuerpo de piedra con un pequeño rebote
    const g = clamp((k - 0.55) / 0.45, 0, 1), s = R * Math.max(0.0001, easeOutBack(g, 1.2));
    this.grp.scale.set(s * (1 + 0.12 * (1 - g)), s * (1 - 0.18 * (1 - g)), s * (1 + 0.12 * (1 - g)));
    this.grp.position.set(p.pos.x, p.pos.y + R * lerp(1.15, 1, g) - 0.06 * a, p.pos.z);
    this.rock.quaternion.setFromAxisAngle(V(Math.cos(p.facing), 0, -Math.sin(p.facing)), c * 1.6);
    this.roll.copy(this.rock.quaternion);
    for (const q of this.chunks) { // fragmentos que vuelan hacia el cuerpo y se integran en la bola
      const u = clamp((k - q.d) / 0.75, 0, 1), e = easeInOut(u);
      q.c.visible = u < 1;
      q.c.position.set(p.pos.x + q.x0 * (1 - e), p.pos.y + 0.15 + R * (1.6 * Math.sin(e * Math.PI) * 0.5 + e), p.pos.z + q.z0 * (1 - e));
      q.c.rotation.set(this.t * q.spin, this.t * q.spin * 0.7, 0);
    }
    this.updBlob(R, clamp(k * 2, 0, 1));
    // partículas suaves: polvo bajo los pies al agacharse, chinas de piedra que se desprenden mientras se petrifica
    if (k < 0.35 && Math.random() < 0.35) this.g.fx.dustPuff(p.pos.x + rnd(-0.6, 0.6), p.pos.y + 0.05, p.pos.z + rnd(-0.6, 0.6), 0.5);
    if (k > 0.2 && k < 0.85 && Math.random() < 0.3) this.g.fx.rock(p.pos.x + rnd(-0.3, 0.3), p.pos.y + p.H * rnd(0.2, 0.8) * (pose.sc || 1), p.pos.z + rnd(-0.3, 0.3));
    if (k > 0.55 && Math.random() < 0.3) this.g.fx.dustPuff(p.pos.x + rnd(-R, R), p.pos.y + 0.1, p.pos.z + rnd(-R, R), 0.6);
  }
  enterRoll() {
    const p = this.p, R = this.ballR();
    this.lock(false);
    for (const q of this.chunks) q.c.visible = false;
    p.moveMul = 1;
    this.rollAge = 0;
    this.gPrev = null; this.slPrev = 0;
    this.hitCd = new Map();
    this.rollSnd = 0;
    this.tuck = 1;
    this.pose.sc = 1;
    // cae con todo su peso: aplastamiento, polvo y una sacudida corta
    this.impact(0.55, 0.16);
    this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.4, r1: 2.6, dur: 0.4, color: 0xc8b090, opacity: 0.5 });
    for (let i = 0; i < 6; i++) this.g.fx.dustPuff(p.pos.x + rnd(-R, R), p.pos.y + 0.1, p.pos.z + rnd(-R, R), 0.9);
    this.wasGround = true; this.airVy = 0;
  }
  // impacto: el muelle de aplastamiento recibe un empujón (k = fuerza 0..1)
  impact(k, shake) {
    this.sqV -= 6 * k;
    if (shake) this.shake(shake);
  }
  tickRoll(dt) {
    const d = this.def, p = this.p, pose = this.pose, R = this.ballR();
    pose.hidden = true;
    // ACELERACIÓN PROGRESIVA (peso e inercia): arranca despacio y alcanza su velocidad en accelT s, con pequeñas
    // variaciones naturales de velocidad (nunca constante como una máquina)
    this.rollAge += dt;
    const acc = easeInOut(clamp(this.rollAge / (d.accelT || 0.9), 0, 1));
    p.moveMul = (1 + (d.speedMul - 1) * acc) * (1 + 0.035 * Math.sin(this.t * 2.3) + 0.025 * Math.sin(this.t * 5.7 + 1));
    p.evadeT = Math.max(p.evadeT, 0.15); // la coraza de roca anula los golpes
    // GIRO = distancia recorrida / radio (sobre el suelo real): la bola nunca patina ni gira en vacío
    const mx = p.pos.x - this.last.x, mz = p.pos.z - this.last.z, dist = Math.hypot(mx, mz);
    this.last.copy(p.pos);
    if (dist > 1e-4 && dist < 3) {
      const ax = V(mz / dist, 0, -mx / dist);
      this.roll.premultiply(new THREE.Quaternion().setFromAxisAngle(ax, dist / R));
      this.rock.quaternion.copy(this.roll);
    }
    const sp = dist / Math.max(dt, 1e-3);
    // INERCIA: al acelerar, frenar o girar, la masa se inclina un poco (y vuelve con un muelle suave)
    const ax2 = (p.vx - this.lastV.x) / Math.max(dt, 1e-3), az2 = (p.vz - this.lastV.y) / Math.max(dt, 1e-3);
    this.lastV.set(p.vx, p.vz);
    const tx = clamp(-az2 * 0.006, -0.16, 0.16), tz = clamp(ax2 * 0.006, -0.16, 0.16);
    this.tilt.x = dampK(this.tilt.x, tx, 6, dt); this.tilt.y = dampK(this.tilt.y, tz, 6, dt);
    // muelle de aplastamiento (impactos) bien amortiguado: sin temblores
    this.sqV += (-60 * this.sq - 9 * this.sqV) * dt; this.sq += this.sqV * dt;
    const sq = clamp(this.sq, -0.28, 0.2);
    const wob = 0.012 * Math.sin(this.t * 13) * Math.min(1, sp / 8); // pequeña vibración natural de la roca al rodar rápido
    this.grp.scale.set(R * (1 - sq * 0.6), R * (1 + sq + wob), R * (1 - sq * 0.6));
    this.grp.rotation.set(this.tilt.x, 0, this.tilt.y);
    // BACHES: al pasar por irregularidades del terreno (cambio brusco de pendiente) la roca vibra un poco y suelta polvo
    const gyN = terrainH(p.pos.x, p.pos.z);
    if (p.grounded && this.gPrev !== null && dist > 1e-3) {
      const sl = (gyN - this.gPrev) / dist, dsl = Math.abs(sl - this.slPrev);
      if (dsl > 0.18 && sp > 2) {
        this.impact(Math.min(0.3, dsl * 0.5));
        if (Math.random() < 0.6) this.g.fx.dustPuff(p.pos.x, p.pos.y + 0.06, p.pos.z, 0.5);
        if (Math.random() < 0.25) this.g.fx.rock(p.pos.x, p.pos.y + 0.12, p.pos.z);
      }
      this.slPrev = sl;
    }
    this.gPrev = gyN;
    this.grp.position.set(p.pos.x, p.pos.y + R * (1 + sq), p.pos.z);
    this.updBlob(R, 1);
    // ATERRIZAJE: tras un salto o una caída, golpe proporcional a la velocidad de caída (fragmentos y polvo)
    if (!p.grounded) this.airVy = Math.min(this.airVy, p.vy);
    if (p.grounded && !this.wasGround) {
      const f = clamp(-this.airVy / 14, 0.15, 1);
      this.impact(f, 0.05 + 0.18 * f);
      for (let i = 0; i < 4 + Math.round(6 * f); i++) this.g.fx.rock(p.pos.x + rnd(-R, R) * 0.6, p.pos.y + 0.2, p.pos.z + rnd(-R, R) * 0.6);
      for (let i = 0; i < 3; i++) this.g.fx.dustPuff(p.pos.x + rnd(-R, R), p.pos.y + 0.1, p.pos.z + rnd(-R, R), 0.8 + f);
      if (f > 0.4) this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.3, r1: 2 + 2 * f, dur: 0.35, color: 0xc8b090, opacity: 0.45 });
      this.sfx('roll');
      this.airVy = 0;
    }
    this.wasGround = p.grounded;
    if (p.grounded && sp > 3) {
      const ux = mx / (dist || 1), uz = mz / (dist || 1);
      // polvo que levanta detrás (menos en línea recta, más al girar o frenar en seco)
      const lat = Math.min(1, Math.hypot(ax2, az2) / 40);
      if (Math.random() < 0.3 + 0.5 * lat) this.g.fx.dustPuff(p.pos.x - ux * R, p.pos.y + 0.08, p.pos.z - uz * R, 0.8 + 0.6 * lat);
      if (Math.random() < 0.08 + 0.2 * lat) this.g.fx.rock(p.pos.x - ux * R * 0.8, p.pos.y + 0.15, p.pos.z - uz * R * 0.8);
      this.rollSnd -= dt;
      if (this.rollSnd <= 0) { this.rollSnd = 0.45; this.sfx('roll'); this.shake(d.shake * 0.5); }
    }
    // arrolla a los enemigos
    for (const [t, c] of this.hitCd) this.hitCd.set(t, c - dt);
    for (const t of this.combat.inCircle(p.pos.x, p.pos.z, R + 0.2)) {
      if ((this.hitCd.get(t) || 0) > 0 || sp < 2) continue;
      this.hitCd.set(t, d.hitEvery);
      this.hit(t, d.hitDamage);
      this.combat.push(t, p.vx || 0.1, p.vz, d.hitForce);
      this.impact(0.35, 0.2); this.sfx('stick');
      this.vfx.ring(t.pos.x, null, t.pos.z, { r0: 0.4, r1: 2.4, dur: 0.35, color: 0xd8c0a0, opacity: 0.6 });
      for (let i = 0; i < 6; i++) this.g.fx.rock(t.pos.x, t.pos.y + 0.5, t.pos.z);
    }
  }
  exitRoll() {
    this.p.moveMul = 1;
  }
  // RECUPERAR SU FORMA: la roca se abre en fragmentos y Jaglion se despliega con un pequeño rebote (seguimiento)
  enterRecover() {
    const p = this.p, R = this.ballR();
    this.sfx('crack');
    this.shake(0.14);
    for (let i = 0; i < 12; i++) this.g.fx.rock(p.pos.x + rnd(-R, R) * 0.5, p.pos.y + R, p.pos.z + rnd(-R, R) * 0.5);
    for (let i = 0; i < 5; i++) this.g.fx.dustPuff(p.pos.x + rnd(-R, R), p.pos.y + 0.1, p.pos.z + rnd(-R, R), 0.9);
    this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.3, r1: 2.4, dur: 0.4, color: 0xd8c0a0, opacity: 0.5 });
  }
  tickRecover(dt, k) {
    const pose = this.pose, p = this.p, R = this.ballR();
    const open = easeOutBack(clamp(k / 0.7, 0, 1), 1.3); // se despliega y se pasa un poco (rebote)
    pose.hidden = k < 0.12;
    this.tuck = clamp(1 - open, 0, 1);
    pose.sy = lerp(0.6, 1, open);
    pose.sc = lerp(0.78, 1, clamp(open, 0, 1));
    if (this.U) { this.U.uFeet.value = p.pos.y; this.U.uRise.value = 1.1 * (1 - easeInOut(clamp((k - 0.15) / 0.75, 0, 1))); this.U.uGlow.value = 0; }
    pose.rx = 0.6 * (1 - easeInOut(clamp(k / 0.8, 0, 1)));
    const s = R * Math.max(0.0001, 1 - easeInOut(clamp(k / 0.35, 0, 1)));
    this.grp.scale.setScalar(s);
    this.grp.position.set(p.pos.x, p.pos.y + R, p.pos.z);
    this.updBlob(R, 1 - k);
  }
  get canRecast() { return this.stageName === 'rodar'; }
  recast() { this.endStage(); return true; }
  dispose() { this.p.moveMul = 1; if (this._pg) { this._pg.dispose(); this._pg = null; } super.dispose(); }
}


/* ====================================================================== */
/*  JAGLION — GIGANTE DE ROCA (botón ESCUDO)                               */
/*  Es SU MISMO MODELO (malla, esqueleto, cabeza, melena, orejas y cola)   */
/*  que crece ×1,75 y se convierte en piedra: la roca sube de los pies a   */
/*  la cabeza conservando sus rasgos (la piedra toma las luces y sombras   */
/*  de su pelaje y su traje), con placas de roca integradas en los brazos, */
/*  grietas finas y un brillo interior muy suave. El colisionador y la     */
/*  cámara crecen con él; al terminar recupera su tamaño sin saltos.       */
/* ====================================================================== */
const STONE_VS = `
  vec4 gwp = modelMatrix * vec4(transformed, 1.0);
  vGWY = gwp.y;
  vGOP = position * uNS;
`;
const STONE_FS_HEAD = `
  uniform float uRise; uniform float uAmt; uniform float uFeet; uniform float uHt; uniform float uGlow;
  varying float vGWY; varying vec3 vGOP;
  float gHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float gNoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(gHash(i), gHash(i + vec3(1,0,0)), f.x), mix(gHash(i + vec3(0,1,0)), gHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(gHash(i + vec3(0,0,1)), gHash(i + vec3(1,0,1)), f.x), mix(gHash(i + vec3(0,1,1)), gHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
`;
export function petrifyMaterial(src, U, ns) {
  const m = src.clone();
  m.userData.own = true;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { uNS: { value: ns } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uNS; varying float vGWY; varying vec3 vGOP;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n' + STONE_VS);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + STONE_FS_HEAD)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float gH = clamp((vGWY - uFeet) / uHt, 0.0, 1.2);
        float gStone = (1.0 - smoothstep(uRise - 0.07, uRise, gH)) * uAmt;       // frente de roca que sube de los pies a la cabeza
        float gN = gNoise(vGOP * 3.0) * 0.6 + gNoise(vGOP * 9.0) * 0.4;
        float gLum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));               // conserva los rasgos (claros y oscuros de su diseño)
        vec3 gRock = mix(vec3(0.36, 0.31, 0.26), vec3(0.58, 0.52, 0.44), gN);    // piedra natural con variaciones de color
        gRock = mix(gRock, vec3(0.3, 0.32, 0.33), smoothstep(0.62, 0.8, gNoise(vGOP * 1.7))); // vetas minerales grises
        vec3 gStoneCol = gRock * (0.45 + 1.15 * gLum);
        float gCr = 1.0 - smoothstep(0.0, 0.035, abs(gNoise(vGOP * 4.5 + 7.0) - 0.5));  // grietas pequeñas y controladas
        gStoneCol *= 1.0 - 0.45 * gCr;
        float gEdge = smoothstep(uRise - 0.07, uRise - 0.02, gH) * (1.0 - smoothstep(uRise - 0.02, uRise, gH)) * uAmt;
        diffuseColor.rgb = mix(diffuseColor.rgb, gStoneCol, gStone) + vec3(0.25, 0.18, 0.1) * gEdge;
        float gGlowK = gCr * gStone * uGlow;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance = mix(totalEmissiveRadiance, totalEmissiveRadiance * 0.25, gStone) + vec3(1.0, 0.42, 0.08) * gGlowK * 0.55;`);
    if (!/roughnessmap_fragment/.test(sh.fragmentShader)) return;
    sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.92, gStone);');
  };
  m.customProgramCacheKey = () => 'petrify-' + (src.customProgramCacheKey ? src.customProgramCacheKey() : src.type);
  return m;
}

const damp1 = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export class GiantSkill extends Skill {
  begin() {
    if (!this.p.model || !this.p.model.root) return false;
    this.start();
    return true;
  }
  build() {
    const d = this.def;
    return [
      { name: 'transformacion', dur: d.prep, enter: this.enterGrow, tick: this.tickGrow },
      { name: 'gigante', dur: d.exec, enter: this.enterGiant, tick: this.tickGiant },
      { name: 'recuperar-tamano', dur: d.recover, enter: this.enterShrink, tick: this.tickShrink },
    ];
  }
  enterGrow() {
    const p = this.p, d = this.def;
    this.H0 = p.H; this.R0 = p.R; this.cam0 = { ...p.cam };
    this.chase0 = { dist: this.g.chase.distTarget, aim: this.g.chase.aim };
    this.sc = 1; this.stoneRise = 0;
    // materiales petrificables (clones: el modelo original no se toca y se restaura al terminar)
    this.U = { uRise: { value: 0 }, uAmt: { value: 1 }, uFeet: { value: p.pos.y }, uHt: { value: p.H }, uGlow: { value: 0 } };
    this.swaps = [];
    const cache = new Map();
    p.model.root.traverse((o) => {
      if (!o.isMesh || !o.material || o.userData.weapon || (o.parent && o.parent.userData && o.parent.userData.weapon)) return;
      if (!o.isSkinnedMesh && !o.userData.body) return; // solo el cuerpo del héroe (no armas ni efectos)
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const sz = o.geometry.boundingBox.getSize(new THREE.Vector3()), ns = 6 / Math.max(0.05, Math.max(sz.x, sz.y, sz.z));
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const out = mats.map((m) => { const key = m.uuid + ns.toFixed(2); if (!cache.has(key)) cache.set(key, petrifyMaterial(m, this.U, ns)); return cache.get(key); });
      this.swaps.push({ o, mat: o.material });
      o.material = Array.isArray(o.material) ? out : out[0];
    });
    this.newMats = [...cache.values()];
    // placas de roca integradas en los brazos (las mismas de Jaglion, pegadas a sus huesos; crecen con él)
    this.armor = ObsidianSkill.prototype.buildArmor.call(this);
    this.stanceK = 0; this.punchK = 0; this.giantK = 0;
    this.setBones((B, dt, t, fx) => this.giantBones(B, fx, t));
    this.stepAcc = 0; this.hitCd = new Map();
    this.sfx('rumble');
  }
  // postura: firme y baja al empezar; de gigante, hombros adelantados y brazos algo abiertos y pesados
  giantBones(B, fx, t) {
    const e = this.stanceK || 0, gk = this.giantK || 0, pu = this.punchK || 0, br = Math.sin(t * 1.6) * 0.04 * gk; // respiración pesada
    for (const S of ['L', 'R']) {
      const sg = S === 'L' ? 1 : -1;
      fx.rot(B[`upper_arm_${S}`], 1, 0, 0, -0.55 * e - 0.15 * gk - 1.1 * pu + br);
      fx.rot(B[`upper_arm_${S}`], 0, 0, 1, sg * 0.22 * gk);
      fx.rot(B[`forearm_${S}`], 1, 0, 0, -0.9 * e - 0.35 * gk + 0.7 * pu);
      fx.rot(B[`thigh_${S}`], 1, 0, 0, -0.3 * e);
      fx.rot(B[`shin_${S}`], 1, 0, 0, 0.45 * e);
    }
    fx.rot(B.spine || B.spine_1, 1, 0, 0, 0.1 * e + 0.08 * gk + 0.22 * pu - br * 0.5);
    fx.rot(B.neck || B.head, 1, 0, 0, -0.12 * gk); // levanta la cabeza: pose imponente
  }
  // tamaño actual: escala del modelo, colisionador, velocidad de la animación y cámara
  setScale(s) {
    const p = this.p, d = this.def;
    this.sc = s;
    this.pose.sc = s;
    p.H = this.H0 * s;
    p.R = this.R0 * (1 + (s - 1) * 0.8);
    p.animMul = 1 / s; // zancadas largas y pesadas (el ciclo de pasos se ralentiza con el tamaño: sin patinar)
    const ch = this.g.chase;
    ch.distTarget = this.chase0.dist * (1 + 0.62 * (s - 1));
    ch.aim = this.chase0.aim * (1 + 0.85 * (s - 1));
    this.U.uHt.value = p.H;
    this.U.uFeet.value = p.pos.y;
    void d;
  }
  tickGrow(dt, k) {
    const pose = this.pose, d = this.def, fx = this.g.fx, p = this.p;
    // FASE 1 (0–25 %): posición firme, baja el centro de gravedad
    this.stanceK = easeInOut(clamp(k / 0.25, 0, 1)) * (1 - 0.6 * easeInOut(clamp((k - 0.75) / 0.25, 0, 1)));
    pose.sy = 1 - 0.07 * this.stanceK; pose.rx = 0.1 * this.stanceK;
    // FASE 2 (10–95 %): la roca cubre su cuerpo siguiendo su anatomía, de los pies a la cabeza (FASE 4: la cabeza al final)
    this.U.uRise.value = 1.08 * easeInOut(clamp((k - 0.1) / 0.85, 0, 1));
    this.U.uGlow.value = 0.6 * clamp((k - 0.4) / 0.6, 0, 1);
    // FASE 3 (30–90 %): crece progresivamente (curva suave, sin saltos de escala)
    this.setScale(1 + (d.scale - 1) * easeInOut(clamp((k - 0.3) / 0.6, 0, 1)));
    // las placas de roca brotan en los brazos
    const a = clamp((k - 0.25) / 0.6, 0, 1);
    for (const q of this.armor) {
      const g = clamp((a - q.at) / 0.14, 0, 1), e = g < 1 ? 1 + 0.25 * Math.sin(g * Math.PI) : 1;
      q.m.scale.copy(q.s).multiplyScalar(Math.max(0.0001, g * e));
      if (g > 0 && !q.on) q.on = true;
    }
    this.shake(0.03 + 0.05 * k);
    this.stoneWeapon(); // el arma se vuelve piedra con el mismo frente de roca que el cuerpo
    void fx; void p;
  }
  // ARMA DE PIEDRA: las piezas sólidas del arma usan el mismo material petrificado (mismo frente de roca, que sube
  // de los pies a la cabeza y baja al terminar); los brillos de energía del arma se apagan mientras es de piedra.
  // Se revisa en cada fotograma por si el arma se saca durante la transformación. Al terminar, todo vuelve a su material.
  stoneWeapon() {
    const W = this.g.weapons, inst = W && W.inst && this.p.model ? W.inst.get(this.p.model) : null;
    this.wSwaps = this.wSwaps || new Map(); this.wGlow = this.wGlow || new Map();
    if (inst) for (const pt of inst.parts) pt.w.group.traverse((o) => { // en la mano o guardada a la espalda
      if (this.wSwaps.has(o) || this.wGlow.has(o) || o.userData.stoneSkip) return;
      const m = o.material;
      if (o.isMesh && m && !Array.isArray(m) && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) && !m.transparent) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const sz = o.geometry.boundingBox.getSize(new THREE.Vector3()), ns = 6 / Math.max(0.05, Math.max(sz.x, sz.y, sz.z));
        const pm = petrifyMaterial(m, this.U, ns);
        this.wSwaps.set(o, m); o.material = pm; this.newMats.push(pm);
      } else if (o.isMesh || o.isSprite || o.isLine || o.isPoints) this.wGlow.set(o, o.visible);
    });
    // brillo del arma: se apaga cuando la piedra lo alcanza (frente por encima de la mitad del cuerpo)
    const off = this.U.uRise.value > 0.55;
    if (W) W.stoneHide = off;
    for (const [o, vis] of this.wGlow) o.visible = off ? false : vis;
  }
  restoreWeapon() {
    if (this.g.weapons) this.g.weapons.stoneHide = false;
    if (this.wSwaps) { for (const [o, m] of this.wSwaps) o.material = m; this.wSwaps.clear(); }
    if (this.wGlow) { for (const [o, vis] of this.wGlow) o.visible = vis; this.wGlow.clear(); }
  }
  // FASE 5: recupera el equilibrio, levanta la cabeza y da un pisotón que hace temblar el suelo
  enterGiant() {
    const p = this.p, d = this.def;
    this.U.uRise.value = 1.1;
    this.sfx('boom'); this.shake(0.4); // (sin polvo ni tierra: solo la roca sólida de su cuerpo)
    for (const t of this.combat.inCircle(p.pos.x, p.pos.z, d.slamRadius)) {
      this.hit(t, d.slamDamage * 0.5);
      const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z);
      this.combat.push(t, dx, dz, d.slamForce * 0.6);
    }
    p.speedBuff = d.speedMul;
  }
  tickGiant(dt, k) {
    const pose = this.pose, d = this.def, p = this.p, fx = this.g.fx;
    this.stanceK = damp1(this.stanceK, 0, 4, dt);
    this.giantK = Math.min(1, this.giantK + dt * 2.5);
    this.setScale(d.scale);
    this.stoneWeapon();
    this.U.uGlow.value = 0.55 + 0.15 * Math.sin(this.t * 2.2);
    // idle: respiración pesada (el pecho sube y baja un poco)
    const hs = Math.hypot(p.vx, p.vz);
    pose.sy = 1 + 0.012 * Math.sin(this.t * 1.6) * (hs < 0.5 ? 1 : 0.3);
    // GIRAR CON INERCIA: el cuerpo se inclina un poco hacia el lado del giro
    const turn = angDiff(p.facing, this.lastFacing ?? p.facing) / Math.max(dt, 1e-3);
    this.lastFacing = p.facing;
    this.lean = damp1(this.lean || 0, clamp(-turn * 0.03, -0.1, 0.1), 5, dt);
    pose.rz = this.lean;
    // reacción al recibir un golpe (el escudo lo para, pero la masa se balancea)
    if (p.blockT > 0) { pose.rx = -0.06 * Math.sin((p.blockT / 0.35) * Math.PI); this.shake(0.08); }
    // PASOS CONTUNDENTES: cada zancada (más larga con el tamaño) hace temblar el suelo y levanta polvo
    if (p.grounded && hs > 0.6) {
      this.stepAcc += hs * dt;
      const stride = 1.15 * d.scale;
      if (this.stepAcc > stride) {
        this.stepAcc -= stride;
        this.side = -(this.side || 1);
        const fx_ = Math.cos(p.facing) * 0.35 * this.side, fz_ = -Math.sin(p.facing) * 0.35 * this.side;
        this.shake(d.stepShake); this.sfx('land'); // pasos pesados: tiembla la cámara, sin polvo ni tierra
        void fx_; void fz_;
      }
    }
    // los enemigos que choca salen despedidos (pequeño daño)
    for (const [t, c] of this.hitCd) this.hitCd.set(t, c - dt);
    for (const t of this.combat.inCircle(p.pos.x, p.pos.z, p.R + 0.8)) {
      if ((this.hitCd.get(t) || 0) > 0) continue;
      this.hitCd.set(t, 0.7);
      this.hit(t, d.bodyDamage);
      const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z);
      this.combat.push(t, dx, dz, d.bodyPush);
      this.vfx.ring(t.pos.x, null, t.pos.z, { r0: 0.3, r1: 1.8, dur: 0.3, color: 0xc8a878, opacity: 0.5 });
    }
    // ATAQUE FINAL: preparación (levanta los puños) y golpe pesado al suelo justo antes de volver a su tamaño
    const wind = clamp((k - 0.72) / 0.2, 0, 1), down = clamp((k - 0.92) / 0.08, 0, 1);
    this.punchK = easeInOut(wind) * (1 - easeInOut(down)) - 0.25 * easeInOut(down);
    if (down > 0 && !this.slammed) {
      this.slammed = true;
      this.sfx('boom'); this.shake(0.5); // golpe al suelo: sin grietas, rocas ni polvo levantándose
      for (const t of this.combat.inCircle(p.pos.x, p.pos.z, d.slamRadius)) {
        this.hit(t, d.slamDamage);
        const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z);
        this.combat.push(t, dx, dz, d.slamForce);
      }
    }
  }
  enterShrink() {
    this.p.speedBuff = 1;
    this.sfx('crack');
  }
  // RECUPERACIÓN: vuelve a su tamaño poco a poco y la piedra se retira de la cabeza a los pies
  tickShrink(dt, k) {
    const d = this.def, p = this.p;
    this.punchK = damp1(this.punchK, 0, 8, dt);
    this.giantK = 1 - easeInOut(k);
    this.setScale(1 + (d.scale - 1) * (1 - easeInOut(k)));
    this.U.uRise.value = 1.1 * (1 - easeInOut(k));
    this.U.uGlow.value = 0.5 * (1 - k);
    for (const q of this.armor || []) q.m.scale.copy(q.s).multiplyScalar(Math.max(0.0001, 1 - easeInOut(Math.min(1, k * 1.4)))); // las placas se recogen
    this.stoneWeapon();
    void p;
  }
  cleanup() {
    const p = this.p;
    if (this.swaps) { for (const s of this.swaps) s.o.material = s.mat; this.swaps = null; }
    this.restoreWeapon(); // el arma recupera su material y sus brillos
    if (this.newMats) { for (const m of this.newMats) m.dispose(); this.newMats = null; }
    if (this.armor) for (const q of this.armor) if (q.m.parent) q.m.parent.remove(q.m);
    if (this.H0) { p.H = this.H0; p.R = this.R0; }
    p.animMul = 1; p.speedBuff = 1;
    if (this.chase0) { this.g.chase.distTarget = this.chase0.dist; this.g.chase.aim = this.chase0.aim; }
  }
}

/* ====================================================================== */
/*  JAGLION — OBSIDIANA: AVALANCHA DE ROCA                                 */
/* ====================================================================== */
export class ObsidianSkill extends Skill {
  begin() {
    const p = this.p, d = this.def;
    const tgt = this.combat.aimTarget(p.pos.x, p.pos.z, p.facing, 40 * DEG, d.length);
    if (tgt) this.face(tgt.pos.x, tgt.pos.z);
    this.dir = this.fwd;
    this.o = V(p.pos.x - this.dir.x * 1.5, 0, p.pos.z - this.dir.z * 1.5);
    this.start();
    return true;
  }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'invocar', dur: d.prep, enter: this.enterCall, tick: this.tickCall },
      { name: 'avalancha', dur: d.exec, enter: this.enterRun, tick: this.tickRun },
      { name: 'recuperacion', dur: d.recover, enter: () => { this.lock(false); this.shatter(); this.crumbleArmor(); }, tick: (dt, k) => { pose.rx = lerp(0.3, 0, k); pose.sy = lerp(0.92, 1, k); this.stanceK = 1 - k; this.punchK = 1 - k; } },
    ];
  }
  // 1) POSTURA DE COMBATE: se agacha, adelanta el cuerpo y sube los puños en guardia
  // 2) Mientras tanto los brazos se recubren de enormes placas de roca (del hombro al puño)
  // 3) Cuando la armadura está completa, golpea el suelo y brotan las estalactitas
  enterCall() {
    this.lock(true);
    this.sfx('rumble');
    this.shake(0.15);
    const d = this.def;
    this.stanceK = 0; this.punchK = 0;
    this.strip = this.track(this.vfx.telegraph('strip', { x: this.o.x, z: this.o.z, x2: this.o.x + this.dir.x * d.length, z2: this.o.z + this.dir.z * d.length, width: d.width, color: 0x6a40a0, opacity: 0.3 }));
    this.armor = this.buildArmor();
    this.setBones((B, dt, t, fx) => this.stanceBones(B, fx));
  }
  tickCall(dt, k) {
    const pose = this.pose;
    this.stanceK = ease(Math.min(1, k / 0.35));
    pose.rx = 0.16 * this.stanceK; pose.sy = 1 - 0.08 * this.stanceK; pose.dy = -0.05 * this.stanceK; // postura firme, agachada y adelantada
    this.strip.setProgress(k);
    this.shake(0.03 + 0.06 * k);
    // las placas de roca van cubriendo los brazos, del hombro al puño
    const fx = this.g.fx, a = clamp((k - 0.2) / 0.7, 0, 1);
    for (const q of this.armor) {
      const g = clamp((a - q.at) / 0.14, 0, 1), e = g < 1 ? 1 + 0.25 * Math.sin(g * Math.PI) : 1; // crece con un pequeño rebote
      q.m.scale.copy(q.s).multiplyScalar(Math.max(0.0001, g * e));
      if (g > 0 && !q.on) { q.on = true; q.m.getWorldPosition(this._wp || (this._wp = new THREE.Vector3())); fx.dustPuff(this._wp.x, this._wp.y - 0.1, this._wp.z, 0.6); if (Math.random() < 0.5) fx.rock(this._wp.x, this._wp.y, this._wp.z); }
    }
    if (a > 0 && a < 1 && Math.random() < 0.35) this.sfx('roll');
    if (Math.random() < 0.4) { const s = rnd(-0.5, 0.5) * this.def.width; this.g.fx.rock(this.o.x - this.dir.z * s, terrainH(this.o.x, this.o.z) + 0.2, this.o.z + this.dir.x * s); }
  }
  // huesos: guardia de combate (brazos delante y codos flexionados, rodillas dobladas) y el golpe al suelo
  stanceBones(B, fx) {
    const e = this.stanceK || 0, pu = this.punchK || 0;
    for (const S of ['L', 'R']) {
      fx.rot(B[`upper_arm_${S}`], 1, 0, 0, -0.95 * e - 0.55 * pu);
      fx.rot(B[`forearm_${S}`], 1, 0, 0, -1.35 * e * (1 - 0.75 * pu));
      fx.rot(B[`thigh_${S}`], 1, 0, 0, -0.32 * e);
      fx.rot(B[`shin_${S}`], 1, 0, 0, 0.5 * e);
    }
    fx.rot(B.spine || B.spine_1, 1, 0, 0, 0.12 * e + 0.25 * pu);
  }
  // placas de roca pegadas a los huesos de los brazos (siguen cualquier animación) y un guantelete en cada puño
  buildArmor() {
    const B = this.p.model && this.p.model.bones, out = [];
    if (!B) return out;
    const H = this.p.H || 1.8;
    const mats = [0x6b5a48, 0x544638, 0x7a6a56].map((c) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, metalness: 0.02, flatShading: true }); m.userData.own = true; return m; });
    const geo = new THREE.DodecahedronGeometry(1, 0), geo2 = new THREE.IcosahedronGeometry(1, 0);
    const ws = new THREE.Vector3(), dir = new THREE.Vector3(), up = new THREE.Vector3(), side = new THREE.Vector3();
    const segs = [['upper_arm', 'forearm', 3, 0.075, 0], ['forearm', 'hand', 4, 0.085, 0.4]];
    for (const S of ['L', 'R']) {
      for (const [bn, cn, n, sz, at0] of segs) {
        const b = B[`${bn}_${S}`], c = B[`${cn}_${S}`];
        if (!b || !c) continue;
        b.updateWorldMatrix(true, false); b.getWorldScale(ws);
        const inv = 1 / (ws.x || 1), len = c.position.length() || 0.1;
        dir.copy(c.position).normalize();
        up.set(0, 0, 1); if (Math.abs(dir.dot(up)) > 0.9) up.set(1, 0, 0);
        side.crossVectors(dir, up).normalize(); up.crossVectors(side, dir).normalize();
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          for (let j = 0; j < 3; j++) { // tres placas alrededor del brazo
            const a = j * 2.094 + i * 0.6, r = H * 0.05 * inv;
            const m = new THREE.Mesh(j === 1 ? geo2 : geo, mats[(i + j) % 3]);
            m.position.copy(dir).multiplyScalar(len * t).addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r);
            m.rotation.set(i * 1.7 + j, j * 2.1, i * 0.9);
            const k = H * sz * inv * (0.85 + 0.3 * t);
            const s = new THREE.Vector3(k, k * 0.6, k * 1.35);
            m.scale.setScalar(0.0001); m.castShadow = true;
            b.add(m);
            out.push({ m, s, at: at0 + (t * 0.4) * (bn === 'forearm' ? 1 : 0.9) + j * 0.03, on: false });
          }
        }
        if (cn === 'hand') { // guantelete: un gran bloque de roca sobre el puño
          const m = new THREE.Mesh(geo, mats[1]);
          m.position.copy(c.position).multiplyScalar(1.02);
          const k = H * 0.1 * inv;
          b.add(m); m.scale.setScalar(0.0001); m.castShadow = true;
          out.push({ m, s: new THREE.Vector3(k * 1.1, k * 0.95, k * 1.1), at: 0.86, on: false });
        }
      }
    }
    for (const q of out) this.track({ kill: () => { if (q.m.parent) q.m.parent.remove(q.m); } });
    this.track({ kill: () => { mats.forEach((m) => m.dispose()); geo.dispose(); geo2.dispose(); } });
    return out;
  }
  // al terminar, las placas se resquebrajan y caen en pedazos
  crumbleArmor() {
    const fx = this.g.fx, wp = new THREE.Vector3();
    for (const q of this.armor || []) {
      q.m.getWorldPosition(wp);
      fx.rock(wp.x, wp.y, wp.z);
      if (Math.random() < 0.4) fx.dustPuff(wp.x, wp.y - 0.2, wp.z, 0.7);
      if (q.m.parent) q.m.parent.remove(q.m);
    }
    this.armor = [];
    this.sfx('crack');
  }
  enterRun() {
    const d = this.def;
    this.strip.kill();
    this.punchK = 0; this.stanceK = 1;
    // golpe: los puños de roca caen contra el suelo delante de Jaglion
    const p = this.p, fx = this.g.fx, hx = p.pos.x + this.dir.x * 0.9, hz = p.pos.z + this.dir.z * 0.9, hy = terrainH(hx, hz);
    for (let i = 0; i < 10; i++) fx.rock(hx, hy + 0.2, hz);
    for (let i = 0; i < 6; i++) fx.dustPuff(hx + rnd(-0.6, 0.6), hy, hz + rnd(-0.6, 0.6), 1.8);
    this.vfx.ring(hx, null, hz, { r0: 0.3, r1: 3.5, dur: 0.4, color: 0xb89a70, opacity: 0.6, additive: false });
    this.pose.rx = 0.3; this.pose.dy = 0; this.pose.sy = 0.92;
    this.shake(d.shake);
    this.sfx('avalanche');
    this.sh = this.track(this.v2.shards(d.shards, { obsidian: true, life: d.exec + d.recover + 0.5 }));
    // ESTALACTITAS: púas de obsidiana que brotan del suelo al paso del frente, y fragmentos que saltan
    this.spikes = this.track(new ObsidianSpikes(this.g, 72, d.exec + d.recover + 0.6));
    this.debris = this.track(new CrystalDebris(this.g, 200, d.exec + d.recover + 2));
    this.nextRow = 1.5;
    // cada fragmento: posición lateral, retraso, tamaño, giro
    this.parts = Array.from({ length: d.shards }, () => ({
      s: rnd(-0.5, 0.5) * d.width, lag: rnd(0, 3.2), h: rnd(0, 1.6), size: rnd(0.25, 0.9),
      rot: new THREE.Euler(rnd(0, TAU), rnd(0, TAU), rnd(0, TAU)), spin: rnd(2, 7), scl: new THREE.Vector3(),
    }));
    this.hitSet = new Set();
    this.tmpP = new THREE.Vector3();
  }
  tickRun(dt, k) {
    const d = this.def, ux = this.dir.x, uz = this.dir.z;
    this.punchK = Math.min(1, this.t / 0.14); this.stanceK = 1;
    this.pose.rx = 0.3; this.pose.sy = 0.92;
    const front = d.length * ease(k) + 1;
    for (let i = 0; i < this.parts.length; i++) {
      const q = this.parts[i];
      const along = Math.max(0, front - q.lag);
      const x = this.o.x + ux * along - uz * q.s, z = this.o.z + uz * along + ux * q.s;
      const bounce = Math.abs(Math.sin(along * 0.9 + q.lag * 3)) * 0.9 * (1 - q.lag / 3.2);
      this.tmpP.set(x, terrainH(x, z) + q.size * 0.6 + q.h * (1 - q.lag / 3.2) + bounce, z);
      q.rot.x += dt * q.spin; q.rot.z += dt * q.spin * 0.7;
      const grow = clamp(along / 2, 0, 1);
      q.scl.set(q.size * 0.7, q.size * 1.4, q.size * 0.8).multiplyScalar(grow);
      this.sh.setAt(i, this.tmpP, q.rot, q.scl);
    }
    this.sh.commit();
    // frente: polvo, destellos cristalinos y vibración
    const fx = this.o.x + ux * front, fz = this.o.z + uz * front, fy = terrainH(fx, fz);
    // filas de estalactitas que brotan inclinadas hacia delante, con grieta violeta y esquirlas
    while (this.nextRow < front && this.nextRow < d.length) {
      const r = this.nextRow, n = 3;
      for (let j = 0; j < n; j++) {
        const s = ((j + rnd(0.15, 0.85)) / n - 0.5) * d.width * 0.95, x = this.o.x + ux * r - uz * s, z = this.o.z + uz * r + ux * s;
        const tilt = rnd(0.25, 0.55), side = rnd(-0.25, 0.25);
        this.spikes.add(x, z, { h: rnd(1.3, 2.9) * (1 - Math.abs(s) / d.width * 0.55), w: rnd(0.34, 0.6), tiltX: tilt * (uz >= 0 ? 1 : -1) * Math.abs(uz) + side * ux, tiltZ: -tilt * ux + side * uz });
        this.debris.burst(x, terrainH(x, z) + 0.2, z, 2, 0.8, 0.14);
      }
      this.track(this.v2.crack(this.o.x + ux * (r - 1.1), this.o.z + uz * (r - 1.1), 1.3, Math.atan2(ux, uz) + rnd(-0.3, 0.3), { life: d.exec - this.t + d.recover + 0.4, width: 0.16, color: 0x8a50ff }));
      this.nextRow += rnd(0.9, 1.3);
    }
    for (let i = 0; i < 3; i++) { const s = rnd(-0.5, 0.5) * d.width; this.g.fx.dustPuff(fx - uz * s, fy + 0.2, fz + ux * s, 1.8); }
    // la avalancha de estalactitas aplasta y apaga los focos de incendio que encuentra a su paso
    this.doused = (this.doused || 0) + smotherFires(this.g, fx, fz, d.width * 0.6, 'rock');
    if (Math.random() < 0.6) this.vfx.sparks(fx, fy + 1, fz, 0xc8a0ff, 3, 3);
    if (Math.random() < 0.4) this.g.fx.rock(fx, fy + 0.5, fz);
    this.shake(0.12);
    for (const t of this.combat.targets()) {
      if (this.hitSet.has(t)) continue;
      const px = t.pos.x - this.o.x, pz = t.pos.z - this.o.z, along = px * ux + pz * uz, side = Math.abs(-px * uz + pz * ux);
      if (along < front && along > front - 4 && side < d.width * 0.5 + t.radius) {
        this.hitSet.add(t);
        this.hit(t, d.damage);
        this.combat.push(t, ux, uz, d.force);
        this.combat.root(t, d.rootT);
        this.shake(0.3); this.sfx('crack');
        this.vfx.ring(t.pos.x, null, t.pos.z, { r0: 0.5, r1: 3, dur: 0.4, color: 0xb080ff });
        this.vfx.sparks(t.pos.x, t.pos.y + 0.8, t.pos.z, 0xe0d0ff, 12, 3.5);
        this.debris.burst(t.pos.x, t.pos.y + 0.8, t.pos.z, 12, 1.1, 0.2); // impacto: estalla en esquirlas
        this.g.fx.dustPuff(t.pos.x, t.pos.y + 0.3, t.pos.z, 2);
      }
    }
  }
  // al detenerse, la obsidiana estalla en cristales
  shatter() {
    const d = this.def, ux = this.dir.x, uz = this.dir.z;
    this.sfx('crack');
    if (this.doused) ui.banner('good', `🖤 ¡Las estalactitas apagan ${this.doused} ${this.doused > 1 ? 'focos' : 'foco'}!`, `+${30 * this.doused} puntos`);
    for (let i = 0; i < 24; i++) {
      const r = rnd(0, d.length), s = rnd(-0.5, 0.5) * d.width, x = this.o.x + ux * r - uz * s, z = this.o.z + uz * r + ux * s;
      this.vfx.sparks(x, terrainH(x, z) + 0.6, z, i % 2 ? 0xd8c8ff : 0x8a60c0, 2, 2.4);
    }
    const sh = this.sh, parts = this.parts, tmp = new THREE.Vector3();
    // las estalactitas estallan en fragmentos y los bloques sueltan esquirlas
    if (this.spikes) this.spikes.shatterAll(this.debris);
    if (this.debris) for (let i = 0; i < parts.length; i += 4) { sh.mesh.getMatrixAt(i, sh.dummy.matrix); tmp.setFromMatrixPosition(sh.dummy.matrix); this.debris.spawn(tmp.x, tmp.y, tmp.z, rnd(-3, 3), rnd(2, 6), rnd(-3, 3), parts[i].size * 0.35); }
    let t = 0;
    this.linger({ life: 0.5, update: (dt) => { // los fragmentos se hunden y encogen
      t += dt;
      for (let i = 0; i < parts.length; i++) { parts[i].scl.multiplyScalar(Math.max(0, 1 - dt * 3)); sh.mesh.getMatrixAt(i, sh.dummy.matrix); sh.dummy.matrix.decompose(tmp, sh.dummy.quaternion, sh.dummy.scale); sh.setAt(i, tmp, parts[i].rot, parts[i].scl); }
      sh.commit();
    }, end: () => {} });
  }
}

/* ====================================================================== */
/*  NUTRIA — TSUNAMI                                                       */
/* ====================================================================== */
export class TsunamiSkill extends Skill {
  begin() {
    const p = this.p, d = this.def;
    const tgt = this.combat.aimTarget(p.pos.x, p.pos.z, p.facing, 40 * DEG, d.length);
    if (tgt) this.face(tgt.pos.x, tgt.pos.z);
    this.dir = this.fwd;
    this.o = V(p.pos.x - this.dir.x * 3.5, 0, p.pos.z - this.dir.z * 3.5); // la ola nace DETRÁS de la nutria
    this.vh = d.visH || d.height; // altura visual de la ola (la zona de impacto sigue usando d.height)
    this.start();
    return true;
  }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'acumulacion', dur: d.gatherT, enter: this.enterGather, tick: this.tickGather },
      { name: 'formacion', dur: d.formT, enter: this.enterForm, tick: this.tickForm },
      { name: 'avance', dur: d.travelT, enter: this.enterTravel, tick: this.tickTravel },
      { name: 'rompiente', dur: d.crashT, enter: this.enterCrash, tick: this.tickCrash },
      { name: 'recuperacion', dur: d.recover, enter: () => this.lock(false), tick: (dt, k) => { pose.dy = lerp(pose.dy, 0, k); pose.rx = lerp(pose.rx, 0, k); pose.rz = 0; pose.spin = 0; } },
    ];
  }
  enterGather() {
    const d = this.def, ch = this.g.chase;
    this.lock(true);
    this.cam0 = { dist: ch.distTarget, pitch: ch.pitch };
    ch.distTarget = Math.max(ch.distTarget, 13); // la cámara se eleva para ver formarse la ola detrás de la nutria
    // la ola (cuerpo de agua con volumen, cortina de espuma y lengua de espuma)
    const wv = this.wave = new TsunamiWave(this.o, this.dir, { width: d.width });
    this.vfx.group.add(wv.group);
    this.track({ kill: () => { this.vfx.group.remove(wv.group); wv.dispose(); } });
    // columna de agua que gira alrededor de la nutria mientras acumula energía
    const vx = this.vortex = new WaterVortex(1.5, Math.max(2.6, this.p.H * 2.2));
    this.vfx.group.add(vx.group);
    this.vortexH = this.track({ kill: () => { if (this.vortex) { this.vfx.group.remove(vx.group); vx.dispose(); this.vortex = null; } } });
    this.sfx('wave');
    this.hitSet = new Set();
  }
  liftCam(dt) { const ch = this.g.chase; if (ch.pitch < 0.75) ch.pitch = lerp(ch.pitch, 0.75, Math.min(1, dt * 3)); }
  dispose() {
    if (this.cam0) { this.g.chase.distTarget = this.cam0.dist; this.g.chase.pitch = this.cam0.pitch; this.cam0 = null; }
    if (this.carried && this.carried.length) { dropFlung(this.g, this.carried, 6); this.carried = []; } // si se interrumpe, lo arrastrado cae donde esté
    super.dispose();
  }
  // PREPARACIÓN: la nutria se agacha y alza los brazos; el agua gira a su alrededor y corre hacia atrás, donde la ola empieza a crecer
  tickGather(dt, k) {
    const d = this.def, pose = this.pose, p = this.p, vh = this.vh;
    this.liftCam(dt);
    pose.rx = -0.35 * k; pose.dy = -0.12 * Math.sin(Math.PI * Math.min(1, k * 1.6)) + 0.3 * k * k; // se agacha y luego se eleva
    pose.rz = 0.035 * Math.sin(this.t * 38) * k; // tiembla de pura fuerza
    this.wave.shape(vh * 0.3 * ease(k), 0, 0, 0.3 * k);
    this.wave.update(dt, { foam: 0.6 + 0.4 * k });
    if (this.vortex) this.vortex.update(dt, k, p.pos.x, p.pos.y, p.pos.z);
    if (Math.random() < 0.8) { const s = rnd(-0.5, 0.5) * d.width; this.vfx.splash(this.o.x - this.dir.z * s, terrainH(this.o.x, this.o.z) + 0.2, this.o.z + this.dir.x * s, 2, 0.6); }
    // gotas y destellos que suben en espiral alrededor de la nutria
    for (let i = 0; i < 2; i++) {
      const a = this.t * 9 + i * Math.PI, r = lerp(2.6, 1.1, k);
      this.g.fx.spray(p.pos.x + Math.cos(a) * r, p.pos.y + 0.1, p.pos.z + Math.sin(a) * r, -Math.cos(a) * 2, 3 + k * 3, -Math.sin(a) * 2, 0.9);
    }
    if (Math.random() < 0.5) this.g.fx.sparkle(p.pos.x + rnd(-1, 1), p.pos.y + rnd(0.3, p.H * 1.6), p.pos.z + rnd(-1, 1), 0x9ff0ff, 1.2);
    // el agua corre por el suelo hacia la ola
    if (Math.random() < 0.6) this.g.fx.spray(p.pos.x + rnd(-2, 2), p.pos.y + 0.1, p.pos.z + rnd(-2, 2), -this.dir.x * 5, 0.5, -this.dir.z * 5, 1);
    this.shake(0.03 * k);
  }
  enterForm() {
    const p = this.p.pos;
    this.shake(0.15);
    this.vfx.ring(p.x, null, p.z, { r0: 0.6, r1: 4.5, dur: 0.45, color: 0x8ae8ff });
    this.vfx.splash(p.x, p.y + 0.4, p.z, 18, 1.2);
  }
  // FORMACIÓN: la columna estalla hacia atrás y la ola se alza enorme detrás de la nutria
  tickForm(dt, k) {
    const vh = this.vh, p = this.p;
    this.pose.rx = -0.35; this.pose.dy = 0.3 + 0.2 * k; this.pose.rz = 0.02 * Math.sin(this.t * 40);
    this.liftCam(dt);
    if (this.vortex) { this.vortex.update(dt, 1 - k, p.pos.x, p.pos.y, p.pos.z); this.vortex.group.scale.set(1 + k * 1.5, 1 - k * 0.6, 1 + k * 1.5); }
    this.wave.shape(vh * lerp(0.3, 1, back(k)), 0.45 * k, 0, k);
    this.wave.update(dt, { foam: 1 });
    // chorros que saltan de la nutria a la ola
    for (let i = 0; i < 3; i++) this.g.fx.spray(p.pos.x + rnd(-0.8, 0.8), p.pos.y + rnd(0.5, 1.5), p.pos.z + rnd(-0.8, 0.8), -this.dir.x * rnd(5, 9), rnd(4, 7), -this.dir.z * rnd(5, 9), 1.2);
    this.crest(0.6);
  }
  enterTravel() {
    this.shake(0.25); this.pose.spin = 0;
    this.sfx('boom');
    this.vortexH.kill();
    this.carried = []; this.doused = 0; this.lastWet = 0; this.ringT = 0; this.mistT = 0;
  }
  // AVANCE: la ola arrasa hacia delante; la nutria cabalga los primeros metros
  tickTravel(dt, k) {
    const d = this.def, pose = this.pose, vh = this.vh;
    pose.rx = 0.25; pose.dy = 0.5; pose.rz = 0;
    const dist = d.length * ease(k);
    this.wave.shape(vh * (1 + 0.05 * Math.sin(this.t * 6)), 0.45 + 0.5 * k, dist, 1);
    this.wave.update(dt, { foam: 1 });
    this.crest(1);
    // la nutria cabalga la ola los primeros metros
    if (k < 0.35) { const f = this.wave.front; this.p.pos.x = lerp(this.p.pos.x, f.x - this.dir.x * 1.2, 0.15); this.p.pos.z = lerp(this.p.pos.z, f.z - this.dir.z * 1.2, 0.15); }
    // arrastra y golpea a los enemigos en el frente
    const f = this.wave.front, ux = this.dir.x, uz = this.dir.z;
    for (const t of this.combat.targets()) {
      const px = t.pos.x - f.x, pz = t.pos.z - f.z, along = px * ux + pz * uz, side = Math.abs(-px * uz + pz * ux);
      if (along < 1.5 && along > -d.height * 1.5 && side < d.width * 0.5 + t.radius) {
        if (!this.hitSet.has(t)) { this.hitSet.add(t); this.hit(t, d.damage); this.impact(t); }
        this.shove(t, ux, uz, d.carry, dt);
      }
    }
    this.shake(0.05);
    this.worldTick(dt, dist);
  }
  // IMPACTO: el agua revienta contra el enemigo
  impact(t) {
    const q = t.pos, ux = this.dir.x, uz = this.dir.z;
    this.vfx.splash(q.x, q.y + 1, q.z, 22, 1.6);
    for (let i = 0; i < 10; i++) this.g.fx.spray(q.x, q.y + rnd(0.5, 2), q.z, ux * rnd(3, 8) + rnd(-2, 2), rnd(3, 7), uz * rnd(3, 8) + rnd(-2, 2), 1.3);
    for (let i = 0; i < 4; i++) this.g.fx.mist(q.x + rnd(-1, 1), q.y + rnd(0.5, 2), q.z + rnd(-1, 1), 0xffffff, 1.6);
    this.vfx.ring(q.x, null, q.z, { r0: 0.5, r1: 3.2, dur: 0.4, color: 0xcfefff });
    if (this.v2) this.v2.shell(new THREE.Vector3(q.x, q.y + 1, q.z), { r: 1.4, color: 0x6ad0ff, rim: 0xffffff, opacity: 0.6, life: 0.25 });
    this.shake(0.14);
    this.sfx('stick');
  }
  // LA OLA EN EL ESCENARIO: apaga los incendios que cruza, arrastra escombros y troncos, y deja el suelo mojado
  worldTick(dt, dist) {
    const d = this.def, f = this.wave.front, ux = this.dir.x, uz = this.dir.z, g = this.g, vh = this.vh;
    this.doused += douseFires(g, f.x, f.z, d.width * 0.55);
    for (const pr of propsNear(g, f.x, f.z, d.width * 0.5)) {
      const it = captureProp(g, pr);
      if (!it) continue;
      it.side = clamp((-(pr.pos.x - f.x) * uz + (pr.pos.z - f.z) * ux), -d.width * 0.45, d.width * 0.45);
      it.h = rnd(0.4, 0.8);
      this.carried.push(it);
      this.vfx.splash(pr.pos.x, pr.pos.y + 0.8, pr.pos.z, 14, 1.4);
      this.sfx('stick');
    }
    for (const it of this.carried) { // los objetos ruedan dentro de la ola, a su misma velocidad
      const m = it.mesh, x = f.x - uz * it.side - ux * 0.8, z = f.z + ux * it.side - uz * 0.8;
      m.position.set(x, terrainH(x, z) + vh * it.h + Math.sin(this.t * 5 + it.side) * 0.3, z);
      m.rotation.x += it.spin.x * dt; m.rotation.z += it.spin.z * dt;
    }
    if (dist - this.lastWet > 3.5) { // estela mojada que se seca poco a poco
      this.lastWet = dist;
      for (const s of [-0.22, 0.22]) { const x = f.x - uz * (s + rnd(-0.08, 0.08)) * d.width - ux * 2, z = f.z + ux * (s + rnd(-0.08, 0.08)) * d.width - uz * 2; wetGround(g, x, z, d.width * rnd(0.32, 0.4), rnd(8, 11)); }
    }
    this.ringT -= dt;
    if (this.ringT <= 0) { this.ringT = 0.22; this.vfx.ring(f.x + ux * 1.5, null, f.z + uz * 1.5, { r0: 0.6, r1: d.width * 0.45, dur: 0.45, color: 0xa8e4ff }); } // onda expansiva a ras de suelo
    // bruma que queda flotando detrás de la cresta
    this.mistT -= dt;
    if (this.mistT <= 0) { this.mistT = 0.09; const s = rnd(-0.45, 0.45) * d.width, x = f.x - uz * s - ux * vh * 0.8, z = f.z + ux * s - uz * vh * 0.8; g.fx.mist(x, terrainH(x, z) + vh * rnd(0.5, 1.1), z, 0xeaf8ff, 1.6); }
  }
  crest(k) { // espuma, salpicaduras y burbujas en la cresta
    const ux = this.dir.x, uz = this.dir.z, vh = this.vh, c = this._c || (this._c = new THREE.Vector3());
    for (let i = 0; i < 6; i++) {
      this.wave.crestAt(rnd(-0.48, 0.48), c);
      this.g.fx.spray(c.x, c.y, c.z, ux * rnd(3, 6) * k, rnd(1.5, 4), uz * rnd(3, 6) * k, 1.5);
      if (Math.random() < 0.35) this.g.fx.mist(c.x, c.y + 0.3, c.z, 0xffffff, 1.5);
      if (Math.random() < 0.3) this.g.fx.sparkle(c.x - ux * 2, c.y - vh * 0.5, c.z - uz * 2, 0xbfeaff, 0.6); // burbujas
    }
  }
  // ROMPIENTE: la ola se curva, cae y estalla en espuma
  enterCrash() {
    this.sfx('boom'); this.shake(0.35);
    const f = this.wave.front, ux = this.dir.x, uz = this.dir.z, g = this.g, d = this.def;
    // lo arrastrado sale despedido hacia delante y se queda en el suelo
    for (const it of this.carried || []) it.vel = new THREE.Vector3(ux * rnd(5, 9), rnd(3, 6), uz * rnd(5, 9));
    if (this.carried && this.carried.length) dropFlung(g, this.carried, 8);
    this.carried = [];
    this.doused += douseFires(g, f.x + ux * 3, f.z + uz * 3, d.width * 0.7);
    wetGround(g, f.x, f.z, d.width * 0.45, 10);
    if (this.doused) {
      ui.banner('good', `💧 ¡El tsunami apaga ${this.doused} ${this.doused > 1 ? 'focos' : 'foco'}!`, `+${30 * this.doused} puntos`);
      this.sfx('chime');
    }
    // charco de espuma que se queda en el suelo y se deshace poco a poco
    const pool = new FoamPool(f.x + ux * 2, f.z + uz * 2, d.width * 0.55, this.dir), life = 3;
    pool.mesh.userData.own = true;
    this.vfx.add(pool.mesh, life, (it, dt) => { pool.update(dt, it.t / life); if (it.t + dt >= life) pool.geo.dispose(); });
    for (let i = 0; i < 10; i++) { const s = rnd(-0.5, 0.5) * d.width, x = f.x - uz * s + ux * 1.5, z = f.z + ux * s + uz * 1.5; g.fx.mist(x, terrainH(x, z) + rnd(0.5, 2.5), z, 0xffffff, 2.6); }
  }
  tickCrash(dt, k) { // la ola cae y se deshace en espuma
    const d = this.def, vh = this.vh;
    this.wave.shape(vh * (1 - ease(k)) + 0.01, 0.95 + 0.45 * k, d.length + k * 2, 1 - k);
    this.wave.setOpacity(1 - k);
    this.wave.update(dt, { foam: 1 + k });
    const f = this.wave.front;
    for (let i = 0; i < 6; i++) { const s = rnd(-0.5, 0.5) * d.width; this.vfx.splash(f.x - this.dir.z * s, terrainH(f.x, f.z) + 0.3, f.z + this.dir.x * s, 3, 1.4); }
    if (k < 0.1) this.vfx.ring(f.x, null, f.z, { r0: 1, r1: d.width * 0.7, dur: 0.6, color: 0xcfefff });
  }
}

/* ====================================================================== */
/*  NUTRIA — MAELSTROM (escudo de agua + remolino de absorción)            */
/* ====================================================================== */
export class MaelstromSkill extends Skill {
  static background = true;
  begin() {
    const p = this.p;
    this.at = V(p.pos.x, 0, p.pos.z);
    this.at.y = p.floorY(this.at.x, this.at.z, p.pos.y + 1);
    this.start();
    return true;
  }
  build() {
    const d = this.def, pose = this.pose;
    return [
      // ACTIVACIÓN: se abre el remolino bajo la Nutria, que se eleva girando mientras el agua cierra la cúpula
      { name: 'formar', dur: d.prep, enter: this.enterForm, tick: (dt, k) => {
        pose.spin = back(k) * TAU; pose.rx = -0.15 * Math.sin(k * Math.PI);
        this.hover(dt, back(k));
        if (this.shield) this.shield.update(dt, { grow: back(k) });
        this.p.evadeT = Math.max(this.p.evadeT, 0.15);
      }, exit: this.closeDome },
      // PROTECCIÓN: la Nutria flota sobre el remolino dentro de la cúpula; el remolino absorbe todo hacia su centro
      { name: 'escudo', dur: d.exec, enter: () => { this.pose.spin = 0; this.pose.rx = 0; }, tick: this.tickShield },
      // RUPTURA: la cúpula cae, el remolino colapsa y lo absorbido sale despedido
      { name: 'romper', dur: d.recover, enter: this.enterBreak, tick: (dt, k) => {
        this.hover(dt, 1 - back(k));
        if (this.shield) this.shield.update(dt, { fall: back(k) });
      } },
    ];
  }
  // la Nutria queda suspendida en el aire sobre el centro del remolino, sostenida por su energía
  hover(dt, k) {
    const p = this.p, d = this.def;
    p.pos.x = this.at.x; p.pos.z = this.at.z;
    p.pos.y = this.at.y + d.hover * k + 0.12 * k * Math.sin((this.tt = (this.tt || 0) + dt) * 3);
    p.vx = p.vz = p.vy = 0;
  }
  enterForm() {
    const p = this.p, d = this.def, at = this.at;
    this.script(true);
    // EL REMOLINO ORIGINAL: embudo en espiral con paredes de agua y núcleo oscuro bajo la Nutria
    this.wp = this.v2.whirlpool(at.x, at.z, { r: d.radius, life: d.prep + d.exec + d.recover, y: at.y });
    this.track({ kill: () => this.vfx.kill(this.wp.it) });
    this.shield = new WaterShield(this.g, p, { radius: d.shieldR, height: Math.max(2.3, p.H * d.shieldH) });
    this.track({ kill: () => { if (this.shield) { this.shield.dispose(); this.shield = null; } } });
    p.waterGuard = this;
    this.sfx('vortex');
    this.vfx.splash(at.x, at.y + 0.3, at.z, 20, 1.4);
    this.vfx.ring(at.x, null, at.z, { r0: 0.5, r1: d.radius, dur: 0.6, color: 0x5ac8ff });
  }
  closeDome() {
    const p = this.p, q = p.pos, d = this.def;
    this.sfx('chime');
    this.vfx.ring(this.at.x, null, this.at.z, { r0: d.shieldR * 0.8, r1: d.shieldR * 2.4, dur: 0.45, color: 0xbfeaff });
    if (this.v2) this.v2.shell(new THREE.Vector3(q.x, q.y + p.H * 0.6, q.z), { r: d.shieldR * 1.05, color: 0x8ad8ff, rim: 0xffffff, opacity: 0.5, life: 0.3 });
    ui.banner('find', '🌀', 'Maelstrom: el escudo bloquea los golpes y el remolino lo absorbe todo');
  }
  tickShield(dt) {
    const d = this.def, p = this.p, c = this.combat, sh = this.shield, at = this.at;
    if (!sh) { this.endStage(); return; }
    this.hover(dt, 1);
    const left = d.exec - this.t;
    sh.update(dt, { grow: 1, warn: left < 1 ? 1 - left : 0 });
    p.evadeT = Math.max(p.evadeT, 0.15);           // ESCUDO: los golpes no le hacen daño
    c.deflect(p.pos.x, p.pos.z, d.shieldR + 0.4);  // los proyectiles rebotan en la cúpula
    this.absorbWorld(dt);
    // SUCCIÓN: los enemigos giran en espiral hacia el centro; en el núcleo oscuro los esbirros desaparecen
    if (!this.touch) this.touch = new Map();
    for (const t of c.targets()) {
      const dx = at.x - t.pos.x, dz = at.z - t.pos.z, dist = Math.hypot(dx, dz);
      if (dist > d.radius + t.radius) continue;
      const k = 1 - dist / (d.radius + t.radius);
      const tx = dx - dz * 0.9, tz = dz + dx * 0.9;
      if (t.heavy) c.push(t, tx, tz, d.pull * (0.5 + k) * dt * 2);
      else this.shove(t, tx, tz, d.pull * (0.6 + 1.6 * k), dt);
      this.dot(t, d.dps, dt);
      c.slow(t, 0.6, 0.4);
      if (dist < d.shieldR + t.radius) { const last = this.touch.get(t) || 0; if (this.t - last > 0.5) { this.touch.set(t, this.t); sh.impact(t.pos); } }
      if (dist < d.coreRadius + t.radius && !t.heavy) { this.vfx.splash(t.pos.x, t.pos.y + 0.5, t.pos.z, 10, 1); c.damage(t, 99); }
    }
    // los proyectiles enemigos también caen al remolino
    for (const pr of c.projectiles) if (!pr.dead && pr.owner === 'boss' && Math.hypot(pr.pos.x - at.x, pr.pos.z - at.z) < d.radius) { pr.vel.x += (at.x - pr.pos.x) * dt * 3; pr.vel.z += (at.z - pr.pos.z) * dt * 3; }
    // corrientes circulares: espuma y burbujas que giran hacia el centro
    for (let i = 0; i < 3; i++) {
      const a = this.t * 4 + rnd(0, TAU), r = rnd(1, d.radius);
      const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
      this.g.fx.spray(x, at.y + 0.2, z, -Math.sin(a) * 5 - Math.cos(a) * 2, 0.4, Math.cos(a) * 5 - Math.sin(a) * 2, 1);
    }
    if (Math.random() < 0.4) this.g.fx.sparkle(at.x + rnd(-1, 1), at.y + rnd(0.2, 2), at.z + rnd(-1, 1), 0x9ad8ff, 0.8);
    if (Math.random() < 0.3) this.g.fx.mist(at.x + rnd(-2, 2), at.y + 0.6, at.z + rnd(-2, 2), 0x9ac8e8, 1.2);
    this.shake(0.03);
  }
  // EL REMOLINO EN EL ESCENARIO: absorbe escombros, rocas y troncos cercanos, que giran en espiral y suben
  // por el embudo; también apaga los fuegos que alcanza
  absorbWorld(dt) {
    const d = this.def, at = this.at, g = this.g;
    if (!this.orbit) { this.orbit = []; this.doused = 0; }
    this.tearUp(dt);
    this.doused += douseFires(g, at.x, at.z, d.radius);
    for (const pr of propsNear(g, at.x, at.z, d.radius * 1.35)) {
      const it = captureProp(g, pr);
      if (!it) continue;
      it.a = Math.atan2(pr.pos.z - at.z, pr.pos.x - at.x);
      it.r = Math.hypot(pr.pos.x - at.x, pr.pos.z - at.z);
      it.h = 0.2;
      this.orbit.push(it);
      this.vfx.splash(pr.pos.x, pr.pos.y + 0.5, pr.pos.z, 12, 1.2);
    }
    // FUERZA GRAVITATORIA: todo lo atrapado gira en espiral cada vez más deprisa, se acerca al centro, baja por el
    // embudo y el núcleo oscuro lo traga (desaparece con una pequeña salpicadura)
    for (let i = this.orbit.length - 1; i >= 0; i--) {
      const it = this.orbit[i], R = d.radius, k = 1 - Math.min(1, it.r / R);
      it.age = (it.age || 0) + dt;
      const lift = Math.min(1, it.age / 0.6);                      // primero se despega del suelo y empieza a flotar
      it.a += dt * (1.2 + 7 * k * k) * lift;                         // gira más rápido cuanto más cerca del centro
      it.r = Math.max(0, it.r - dt * (0.5 + 3.2 * k * k) * lift);    // la succión crece al acercarse
      const hTop = it.debris ? 1.2 + it.size : 2.2;
      it.h = k < 0.7 ? lerp(it.h, hTop * Math.sin(Math.min(1, k / 0.7) * Math.PI * 0.5 + 0.15), Math.min(1, dt * 2)) : it.h - dt * (2 + 6 * (k - 0.7)); // sube flotando y cae por el embudo
      const m = it.mesh;
      m.position.set(at.x + Math.cos(it.a) * it.r, at.y + Math.max(-0.6, it.h), at.z + Math.sin(it.a) * it.r);
      const tumble = 1 + 3 * k;
      m.rotation.x += it.spin.x * dt * tumble; m.rotation.y += it.spin.y * dt * 2 * tumble; m.rotation.z += it.spin.z * dt * tumble;
      const shrink = k > 0.75 ? Math.max(0, 1 - (k - 0.75) / 0.25) : 1;
      m.scale.copy(it.s0).multiplyScalar(Math.max(0.001, (1 - 0.25 * k) * shrink));
      if (Math.random() < dt * 5) g.fx.spray(m.position.x, m.position.y, m.position.z, -Math.sin(it.a) * 2, 0.6, Math.cos(it.a) * 2, 0.7);
      if (it.r < d.coreRadius * 0.6 || shrink <= 0.02) { // absorbido
        g.fx.spray(at.x, at.y + 0.2, at.z, rnd(-1, 1), rnd(1, 3), rnd(-1, 1), 0.9);
        g.fx.sparkle(at.x + rnd(-0.3, 0.3), at.y + 0.3, at.z + rnd(-0.3, 0.3), 0x9ad8ff, 0.6);
        g.scene.remove(m); if (it.debris) { /* geometría y material compartidos */ } else m.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        this.orbit.splice(i, 1);
        this.absorbed = (this.absorbed || 0) + 1;
      }
    }
    for (let i = 0; i < 2; i++) { const a = this.t * 7 + i * Math.PI, r = 0.6 + Math.random() * 0.6; g.fx.spray(at.x + Math.cos(a) * r, at.y + 0.3, at.z + Math.sin(a) * r, -Math.sin(a) * 2, rnd(4, 7), Math.cos(a) * 2, 1.1); }
  }
  // arranca del suelo rocas, piedras y fragmentos cercanos (del color del terreno) y los atrapa en el remolino
  tearUp(dt) {
    const d = this.def, at = this.at, g = this.g;
    if (!Maelstrom_DEBRIS.geo) {
      Maelstrom_DEBRIS.geo = [new THREE.DodecahedronGeometry(1, 0), new THREE.IcosahedronGeometry(1, 0), new THREE.BoxGeometry(1.6, 0.5, 0.7)];
      Maelstrom_DEBRIS.mat = [0x6a6258, 0x847a6c, 0x5a4a3a, 0x8a6a48].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, flatShading: true }));
    }
    this.tearT = (this.tearT || 0) - dt;
    const alive = this.orbit.filter((o) => o.debris).length;
    if (this.tearT > 0 || alive > 22) return;
    this.tearT = 0.09;
    const a = rnd(0, TAU), r = d.radius * rnd(0.8, 1.25), x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r, y = terrainH(x, z);
    const kind = Math.floor(Math.random() * 3), size = kind === 2 ? rnd(0.12, 0.22) : rnd(0.1, 0.32);
    const m = new THREE.Mesh(Maelstrom_DEBRIS.geo[kind], Maelstrom_DEBRIS.mat[kind === 2 ? 2 + Math.floor(Math.random() * 2) : Math.floor(Math.random() * 2)]);
    m.scale.set(size * rnd(0.8, 1.3), size * rnd(0.6, 1), size * rnd(0.8, 1.3));
    m.position.set(x, y + 0.05, z);
    m.castShadow = true;
    g.scene.add(m);
    this.orbit.push({ mesh: m, size, s0: m.scale.clone(), spin: new THREE.Vector3(rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)), a, r, h: 0.05, debris: true });
    g.fx.dustPuff(x, y + 0.05, z, 0.6); // la tierra se levanta donde arranca
  }
  // El juego avisa de un golpe bloqueado: la onda recorre la cúpula desde el impacto
  absorb(from) {
    if (!this.shield || this.stageName === 'romper') return false;
    this.shield.impact(from);
    this.sfx('slurp');
    return true;
  }
  // las rocas arrancadas que aún giran se hunden en el núcleo (no salen despedidas: comparten geometría)
  swallowDebris() {
    if (!this.orbit) return;
    for (const it of this.orbit) if (it.debris) this.g.scene.remove(it.mesh);
    this.orbit = this.orbit.filter((it) => !it.debris);
  }
  enterBreak() {
    const d = this.def, p = this.p, at = this.at, g = this.g;
    if (p.waterGuard === this) p.waterGuard = null;
    this.swallowDebris();
    // lo absorbido sale despedido en todas direcciones y cae alrededor
    for (const it of this.orbit || []) { const a = it.a + 0.6; it.vel = new THREE.Vector3(Math.cos(a) * rnd(6, 10), rnd(5, 9), Math.sin(a) * rnd(6, 10)); }
    if (this.orbit && this.orbit.length) dropFlung(g, this.orbit, 8);
    this.orbit = [];
    this.sfx('boom'); this.shake(0.35);
    this.vfx.splash(at.x, at.y + 0.4, at.z, 30, 2);
    this.vfx.ring(at.x, null, at.z, { r0: d.radius * 0.6, r1: d.radius * 1.8, dur: 0.9, color: 0x5ac8ff });
    this.vfx.ring(at.x, null, at.z, { r0: 0.5, r1: d.radius * 1.1, dur: 0.6, color: 0xbfeaff });
    for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; g.fx.spray(p.pos.x + Math.cos(a) * d.shieldR, p.pos.y + rnd(0.3, 2), p.pos.z + Math.sin(a) * d.shieldR, Math.cos(a) * rnd(4, 7), rnd(1, 4), Math.sin(a) * rnd(4, 7), 1.2); }
    wetGround(g, at.x, at.z, d.radius * 0.8, 10);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; wetGround(g, at.x + Math.cos(a) * d.radius * 0.9, at.z + Math.sin(a) * d.radius * 0.9, rnd(1.4, 2.2), rnd(7, 10)); }
    for (const t of this.combat.inCircle(at.x, at.z, d.radius)) {
      this.hit(t, d.collapseDamage);
      const { dx, dz } = this.awayFrom(t, at.x, at.z);
      this.combat.push(t, dx || 0.1, dz, d.collapseForce);
    }
    if (this.doused) ui.banner('good', `💧 ¡El remolino apaga ${this.doused} ${this.doused > 1 ? 'focos' : 'foco'}!`, `+${30 * this.doused} puntos`);
  }
  dispose() {
    this.swallowDebris();
    if (this.orbit && this.orbit.length) { dropFlung(this.g, this.orbit, 6); this.orbit = []; }
    super.dispose();
  }
  cleanup() {
    if (this.p.waterGuard === this) this.p.waterGuard = null;
    if (this._script) { this.script(false); this.p.vy = 0; } // vuelve a caer suavemente al suelo
  }
}

export const POWER_CLASSES = {
  geyser: GeyserSkill, blacklava: BlackLavaSkill,
  umbra: UmbraSkill, penumbra: PenumbraSkill, bloodmoon: BloodMoonSkill,
  mirage: MirageSkill, ears: FlightSkill, flight: FlightSkill,
  aurora: AuroraSkill, solstice: SolsticeSkill,
  rock: RockSkill, obsidian: ObsidianSkill, giant: GiantSkill,
  tsunami: TsunamiSkill, maelstrom: MaelstromSkill,
};
