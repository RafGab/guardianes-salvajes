import * as THREE from 'three';
import { terrainH } from './terrain.js';
import { newStatus, tickStatus } from './combat.js';

/* ======================================================================
   SOLDADOS DEL JEFE DE ZONA
   Cada soldado tiene su propio ESQUELETO (jerarquía de huesos THREE.Bone: cadera → columna → pecho → cabeza,
   hombros → brazos → antebrazos, muslos → espinillas → pies) con las piezas del cuerpo unidas a cada hueso, y
   sus propias ANIMACIONES por huesos: reposo, caminar/correr (según su velocidad real), ataque con
   anticipación, impacto y derrota. Persiguen al héroe más cercano (el del jugador o un compañero), atacan
   con su arma y tienen su propia vida (la barra sale sobre su cabeza: ui.npcBars).
   Misma interfaz que el antiguo esbirro (pos, vel, st, radius, hp, hurt, kill...) para que todas las habilidades
   de los héroes (empujar, atraer, ralentizar, enraizar, marcar...) sigan funcionando igual.
   ====================================================================== */

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

function buildRig(color, accent) {
  const armor = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.45, metalness: 0.55, flatShading: true });
  const plate = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.6, flatShading: true, emissive: new THREE.Color(color).multiplyScalar(0.15) });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1a24, roughness: 0.8, flatShading: true });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(2.2), toneMapped: false });
  const mats = [armor, plate, dark, glow];
  const bone = (name, parent, x, y, z) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); if (parent) parent.add(b); return b; };
  const part = (geo, mat, b, o = {}) => { const m = new THREE.Mesh(geo, mat); m.position.set(o.x || 0, o.y || 0, o.z || 0); m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0); if (o.s) m.scale.set(...o.s); m.castShadow = true; b.add(m); return m; };
  // esqueleto (alturas para un soldado de 1,3 m)
  const hips = bone('hips', null, 0, 0.62, 0);
  const spine = bone('spine', hips, 0, 0.12, 0);
  const chest = bone('chest', spine, 0, 0.18, 0);
  const head = bone('head', chest, 0, 0.2, 0.01);
  const sh = [1, -1].map((s) => bone(s > 0 ? 'shoulder_L' : 'shoulder_R', chest, s * 0.2, 0.12, 0));
  const arm = sh.map((b, i) => bone(i ? 'forearm_R' : 'forearm_L', b, 0, -0.22, 0));
  const hand = arm.map((b, i) => bone(i ? 'hand_R' : 'hand_L', b, 0, -0.2, 0.02));
  const th = [1, -1].map((s) => bone(s > 0 ? 'thigh_L' : 'thigh_R', hips, s * 0.1, -0.04, 0));
  const shin = th.map((b, i) => bone(i ? 'shin_R' : 'shin_L', b, 0, -0.27, 0));
  const foot = shin.map((b, i) => bone(i ? 'foot_R' : 'foot_L', b, 0, -0.27, 0));
  // cuerpo: armadura con placas del color del jefe, casco con ojos que brillan
  part(new THREE.CylinderGeometry(0.16, 0.13, 0.2, 7), dark, hips, { y: 0.0 });
  part(new THREE.CylinderGeometry(0.2, 0.16, 0.26, 7), armor, spine, { y: 0.1 });
  part(new THREE.BoxGeometry(0.42, 0.24, 0.26), plate, chest, { y: 0.06 });
  part(new THREE.ConeGeometry(0.08, 0.18, 4), plate, chest, { x: 0.24, y: 0.17, rz: -0.6 });
  part(new THREE.ConeGeometry(0.08, 0.18, 4), plate, chest, { x: -0.24, y: 0.17, rz: 0.6 });
  part(new THREE.IcosahedronGeometry(0.15, 0), armor, head, { y: 0.1, s: [1, 1.05, 1.1] });
  part(new THREE.ConeGeometry(0.05, 0.2, 5), plate, head, { y: 0.28, rx: -0.3 });
  for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.03, 8, 6), glow, head, { x: s * 0.055, y: 0.11, z: 0.13 });
  for (const b of sh) part(new THREE.CapsuleGeometry(0.06, 0.14, 3, 8), armor, b, { y: -0.1 });
  for (const b of arm) part(new THREE.CapsuleGeometry(0.05, 0.13, 3, 8), dark, b, { y: -0.1 });
  for (const b of hand) part(new THREE.SphereGeometry(0.055, 8, 6), plate, b, { y: -0.02 });
  for (const b of th) part(new THREE.CapsuleGeometry(0.07, 0.15, 3, 8), armor, b, { y: -0.13 });
  for (const b of shin) part(new THREE.CapsuleGeometry(0.06, 0.15, 3, 8), dark, b, { y: -0.13 });
  for (const b of foot) part(new THREE.BoxGeometry(0.1, 0.06, 0.18), plate, b, { y: -0.01, z: 0.04 });
  // arma: lanza con punta luminosa en la mano derecha; escudo pequeño en la izquierda
  const weapon = new THREE.Group();
  part(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 6), dark, weapon, { y: 0.15 });
  part(new THREE.ConeGeometry(0.045, 0.18, 4), glow, weapon, { y: 0.66 });
  weapon.rotation.x = Math.PI / 2; weapon.position.set(0, -0.03, 0.05);
  hand[1].add(weapon);
  part(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 8), plate, hand[0], { y: 0, z: 0.05, rx: Math.PI / 2 });
  const skeleton = new THREE.Skeleton([hips, spine, chest, head, ...sh, ...arm, ...hand, ...th, ...shin, ...foot]);
  return { root: hips, skeleton, B: { hips, spine, chest, head, sh, arm, hand, th, shin, foot }, mats, plate, weapon };
}

export class Soldier {
  constructor(combat, x, z, cat, { color = 0xb070ff, accent = 0xff3a5a, kind = 'esbirro' } = {}) {
    this.combat = combat;
    this.heavy = false; this.npc = true; this.soldier = true;
    this.kind = kind; this.cat = cat;
    this.scale = cat.scale;
    this.radius = 0.5 * cat.scale;
    this.barH = 1.55 * cat.scale;
    this.pos = new THREE.Vector3(x, terrainH(x, z), z);
    this.vel = new THREE.Vector3();
    this.hp = cat.hp; this.hpMax = cat.hp;
    this.st = newStatus();
    this.pullT = 0; this.pullTo = new THREE.Vector3(); this.pullSpeed = 0;
    this.t = Math.random() * 10; this.dead = false; this.flash = 0;
    this.facing = 0; this.phase = 0; this.speed = 0;
    this.state = 'spawn'; this.stateT = 0; this.atkCd = rnd(0.8, 1.6); this.hurtT = 0;
    this.slot = Math.random() * TAU; // ángulo propio alrededor del objetivo: así no se amontonan
    this.color = color;
    this.rig = buildRig(color, accent);
    this.group = new THREE.Group();
    this.group.add(this.rig.root);
    // anillo rojo bajo los pies: enemigo activo (y amarillo si está marcado)
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 28), new THREE.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.04;
    this.group.add(this.ring);
    this.group.scale.setScalar(this.scale);
    this.group.position.copy(this.pos);
    combat.scene.add(this.group);
  }

  // héroe más cercano (jugador o compañero)
  target() {
    const g = this.combat.game, hs = g.heroTargets ? g.heroTargets() : [{ pos: g.player.pos, R: g.player.R, isPlayer: true }];
    let best = null, bd = 1e9;
    for (const h of hs) { const d = Math.hypot(h.pos.x - this.pos.x, h.pos.z - this.pos.z); if (d < bd) { bd = d; best = h; } }
    return best;
  }

  update(dt) {
    if (this.dead) return;
    this.t += dt; this.stateT += dt;
    tickStatus(this.st, dt);
    this.atkCd = Math.max(0, this.atkCd - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    const slow = this.st.slow > 0 ? this.st.slowF : 1;
    const tg = this.target();
    const prev = this.pos.clone();
    if (this.state === 'spawn') { if (this.stateT > 0.6 && !(this.combat.game.bossIntroT > 0)) this.setState('move'); } // esperan junto al jefe durante su presentación
    else if (this.pullT > 0) { // atraído por la lengua / la cola: ignora su IA
      this.pullT -= dt;
      const d = new THREE.Vector3().subVectors(this.pullTo, this.pos); d.y = 0;
      const l = d.length();
      if (l > 0.6) this.pos.addScaledVector(d, Math.min(1, (this.pullSpeed * dt) / l));
    } else if (tg && this.state === 'move' && this.st.root <= 0) {
      // se coloca a distancia de ataque, cada uno por su lado del objetivo
      const reach = 1.05 + (tg.R || 0.4);
      let gx = tg.pos.x + Math.sin(this.slot) * reach, gz = tg.pos.z + Math.cos(this.slot) * reach;
      if (this.st.blind > 0) { gx = this.pos.x + Math.sin(this.t * 2.3) * 3; gz = this.pos.z + Math.cos(this.t * 1.9) * 3; } // cegado: deambula
      const dx = gx - this.pos.x, dz = gz - this.pos.z, l = Math.hypot(dx, dz);
      const sp = Math.min(l * 3, this.cat.speed * 1.25) * slow;
      if (l > 0.05) { this.pos.x += (dx / l) * sp * dt; this.pos.z += (dz / l) * sp * dt; }
      const dt0 = Math.hypot(tg.pos.x - this.pos.x, tg.pos.z - this.pos.z);
      if (dt0 < reach + 0.35 && this.atkCd <= 0 && this.st.blind <= 0) { this.setState('windup'); this.atkTarget = tg; }
      this.slot += dt * 0.25; // rodea poco a poco
    }
    // ataque: anticipación (se ve venir) → golpe con la lanza → recuperación
    if (this.state === 'windup' && this.stateT > 0.42) {
      this.setState('strike');
      const h = this.atkTarget;
      if (h && Math.hypot(h.pos.x - this.pos.x, h.pos.z - this.pos.z) < 1.7 + (h.R || 0.4)) {
        const g = this.combat.game;
        if (g.hitHero) g.hitHero(h, this.cat.hit, this.pos); else g.hitPlayer(this.cat.hit, this.pos);
        const tip = new THREE.Vector3(); this.rig.weapon.getWorldPosition(tip);
        this.combat.vfx.sparks(tip.x, tip.y + 0.3, tip.z, 0xffd0a0, 8, 2);
      }
    }
    if (this.state === 'strike' && this.stateT > 0.18) this.setState('recover');
    if (this.state === 'down' && this.stateT > 1.15) this.setState('getup');   // derribado: se levanta
    if (this.state === 'getup' && this.stateT > 0.45) { this.setState('move'); this.atkCd = rnd(0.6, 1.2); }
    if (this.state === 'recover' && this.stateT > 0.35) { this.setState('move'); this.atkCd = rnd(1.3, 2.0); }
    // empuje residual
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.vel.multiplyScalar(Math.max(0, 1 - 4 * dt));
    this.pos.y = terrainH(this.pos.x, this.pos.z);
    const v = Math.hypot(this.pos.x - prev.x, this.pos.z - prev.z) / Math.max(dt, 1e-4);
    this.speed = damp(this.speed, v, 10, dt);
    // mira a su objetivo (o hacia donde va)
    const look = tg ? Math.atan2(tg.pos.x - this.pos.x, tg.pos.z - this.pos.z) : this.facing;
    let d = look - this.facing; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * Math.min(1, dt * 8);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.facing;
    this.animate(dt);
    // destello al recibir daño y anillo de enemigo activo / marcado
    this.flash = Math.max(0, this.flash - dt);
    const fl = this.flash > 0 ? 1 : 0;
    this.rig.plate.emissive.setRGB(fl + 0.15 * ((this.color >> 16) & 255) / 255, fl * 0.9 + 0.15 * ((this.color >> 8) & 255) / 255, fl * 0.9 + 0.15 * (this.color & 255) / 255);
    this.ring.material.color.setHex(this.st.mark > 0 ? 0xffd24a : 0xff3a3a);
    this.ring.material.opacity = 0.45 + 0.3 * Math.sin(this.t * 5);
  }
  setState(s) { this.state = s; this.stateT = 0; }

  // ANIMACIÓN POR HUESOS (rotaciones locales de cada hueso)
  animate(dt) {
    const B = this.rig.B, k = Math.min(1, this.speed / (this.cat.speed * 1.1));
    this.phase += dt * (2 + this.speed * 3.2);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    // caminar / correr: piernas, brazos al contrario y el cuerpo se balancea
    let hipY = 0.62 + Math.abs(c) * 0.03 * k + Math.sin(this.t * 2.2) * 0.008, lean = 0.12 * k;
    const legs = [s * 0.75 * k, -s * 0.75 * k];
    B.th[0].rotation.x = -legs[0]; B.th[1].rotation.x = -legs[1];
    B.shin[0].rotation.x = Math.max(0, Math.sin(this.phase + 1.2)) * 1.0 * k;
    B.shin[1].rotation.x = Math.max(0, Math.sin(this.phase + 1.2 + Math.PI)) * 1.0 * k;
    B.foot[0].rotation.x = legs[0] * 0.3; B.foot[1].rotation.x = legs[1] * 0.3;
    let armL = legs[1] * 0.6, armR = -0.5 + legs[0] * 0.3, foreR = -0.6, foreL = -0.3, chestX = 0, spineY = s * 0.08 * k, headX = 0;
    // ataque
    if (this.state === 'windup') { const e = Math.min(1, this.stateT / 0.42); armR = -0.5 - 2.0 * e; foreR = -1.2 * e - 0.4; chestX = -0.25 * e; spineY = -0.35 * e; lean -= 0.1 * e; }
    else if (this.state === 'strike') { const e = Math.min(1, this.stateT / 0.18); armR = -2.5 + 2.3 * e; foreR = -1.6 + 1.4 * e; chestX = -0.25 + 0.55 * e; spineY = -0.35 + 0.7 * e; lean += 0.25 * e; }
    else if (this.state === 'recover') { const e = Math.min(1, this.stateT / 0.35); armR = -0.2 - 0.3 * e; foreR = -0.2 - 0.4 * e; chestX = 0.3 * (1 - e); spineY = 0.35 * (1 - e); }
    else if (this.state === 'spawn') { const e = Math.min(1, this.stateT / 0.6); hipY = 0.2 + 0.42 * e; lean = 0.6 * (1 - e); }
    else if (this.state === 'down') { const e = Math.min(1, this.stateT / 0.25); hipY = 0.62 - 0.45 * e; lean = -1.35 * e; armL = -1.4 * e; armR = -1.8 * e; foreL = foreR = -0.4; headX = 0.4 * e; B.th[0].rotation.x = B.th[1].rotation.x = -1.1 * e; B.shin[0].rotation.x = B.shin[1].rotation.x = 0.5 * e; } // de espaldas en el suelo
    else if (this.state === 'getup') { const e = Math.min(1, this.stateT / 0.45); hipY = 0.17 + 0.45 * e; lean = -1.35 + 1.5 * e; B.th[0].rotation.x = B.th[1].rotation.x = -1.1 * (1 - e); B.shin[0].rotation.x = B.shin[1].rotation.x = 0.5 * (1 - e) + 0.6 * Math.sin(e * Math.PI); }
    // impacto: se encoge hacia atrás
    if (this.hurtT > 0) { const h = Math.sin((this.hurtT / 0.28) * Math.PI); chestX -= 0.45 * h; headX -= 0.4 * h; lean -= 0.2 * h; }
    B.hips.position.y = hipY;
    B.hips.rotation.x = lean;
    B.spine.rotation.y = spineY;
    B.chest.rotation.x = chestX;
    B.head.rotation.x = headX + Math.sin(this.t * 1.7) * 0.04;
    B.sh[0].rotation.x = armL; B.sh[0].rotation.z = 0.15;
    B.sh[1].rotation.x = armR; B.sh[1].rotation.z = -0.15;
    B.arm[0].rotation.x = foreL; B.arm[1].rotation.x = foreR;
  }

  hurt(n) {
    if (this.dead) return;
    this.hp = Math.max(0, this.hp - n);
    this.flash = 0.12; this.hurtT = 0.28;
    // REACCIÓN SEGÚN EL GOLPE: uno flojo le hace encogerse; uno fuerte lo derriba y sale despedido hacia atrás
    const g = this.combat.game, from = g.player ? g.player.pos : null;
    if (from) { const dx = this.pos.x - from.x, dz = this.pos.z - from.z, l = Math.hypot(dx, dz) || 1, f = n >= 9 ? 7 : 2.5; this.vel.x += (dx / l) * f; this.vel.z += (dz / l) * f; }
    if (n >= 9 && this.hp > 0 && this.state !== 'down' && this.state !== 'getup') {
      this.setState('down');
      this.combat.vfx.dust && this.combat.vfx.dust(this.pos.x, this.pos.y + 0.2, this.pos.z, 5, 1.2);
      if (g.floatAt) g.floatAt(this.pos, this.barH + 0.5, '¡DERRIBADO!', 'big');
    } else if (this.state === 'windup' && Math.random() < 0.5) this.setState('recover'); // a veces el golpe le interrumpe
    if (this.hp <= 0) this.kill();
  }

  // DERROTA: cae hacia atrás, se desvanece y desaparece de la batalla
  kill() {
    if (this.dead) return;
    this.dead = true; this.hp = 0;
    const c = this.combat, g = this.group, B = this.rig.B, mats = this.rig.mats;
    c.vfx.sparks(this.pos.x, this.pos.y + 0.7, this.pos.z, this.color, 16, 3);
    if (c.vfx.ring) c.vfx.ring(this.pos.x, null, this.pos.z, { r0: 0.3, r1: 1.8 * this.scale, dur: 0.45, color: this.color });
    c.game.addScore(this.cat.score);
    for (const m of mats) { m.transparent = true; }
    this.ring.visible = false;
    const life = 1.2, ry = g.rotation.y, base = this.pos.y;
    c.scene.remove(g);
    g.position.copy(this.pos); g.rotation.y = ry;
    c.vfx.add(g, life, (it) => {
      const t = it.t, k = Math.min(1, t / 0.55), e = 1 - Math.pow(1 - k, 3);
      B.hips.rotation.x = -1.35 * e;                      // cae de espaldas
      B.hips.position.y = 0.62 - 0.45 * e;
      B.th[0].rotation.x = -0.6 * e; B.th[1].rotation.x = -0.9 * e; B.shin[0].rotation.x = 0.6 * e; B.shin[1].rotation.x = 0.9 * e;
      B.sh[0].rotation.x = -1.4 * e; B.sh[1].rotation.x = -1.2 * e; B.head.rotation.x = 0.4 * e;
      const fade = t > 0.7 ? 1 - (t - 0.7) / 0.5 : 1;
      for (const m of mats) m.opacity = Math.max(0, fade);
      g.position.y = base - Math.max(0, t - 0.8) * 0.6;
      if (t >= life - 0.001) { g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); for (const m of mats) m.dispose(); }
    });
    if (c.game.onNpcDefeated) c.game.onNpcDefeated(this);
  }
}
