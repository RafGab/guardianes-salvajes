import * as THREE from 'three';
import { clamp, damp, TAU } from './utils.js';
import { loadGLB, cachedGLB, normalizeModel, prepareMeshes, measure } from './glb.js';
import { bossScale, ALLY_SCALE, modelUrl } from './scale.js';

/* ------------------------------------------------------------------ */
/*  Helpers de geometría/material para los modelos de jefes            */
/*  (sin rig de animación completo: grupos que se rotan directamente)  */
/* ------------------------------------------------------------------ */
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...o });
const glow = (hex, k = 2.4) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 10);
const cone = (r, h) => new THREE.ConeGeometry(r, h, 8);
const sph = (r) => new THREE.SphereGeometry(r, 16, 12);
const rnd = (a, b) => a + Math.random() * (b - a);
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

/* ------------------------------------------------------------------ */
/*  Modelos procedurales de los 7 jefes de CATAC 7                     */
/* ------------------------------------------------------------------ */
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
  M(box(0.85, 0.75, 0.75), stone, head);
  M(box(0.5, 0.3, 0.25), dark, head, { y: -0.1, z: 0.45 });
  M(sph(0.1), eye, head, { x: 0.22, y: 0.08, z: 0.4 });
  M(sph(0.1), eye, head, { x: -0.22, y: 0.08, z: 0.4 });
  for (const s of [-1, 1]) { const h = new THREE.Mesh(cone(0.14, 0.95), horn); h.position.set(s * 0.32, 0.45, -0.05); h.rotation.set(0.3, 0, s * 0.55); h.castShadow = true; head.add(h); }
  const limbs = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.95, 0.55, 0);
    torso.add(sh);
    M(cap(0.26, 0.75), stone, sh, { y: -0.4 });
    const el = new THREE.Group();
    el.position.y = -0.85;
    sh.add(el);
    M(cap(0.22, 0.7), moss, el, { y: -0.38 });
    M(sph(0.3), dark, el, { y: -0.78 });
    limbs.push({ sh });
  }
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
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.4, -0.7);
  hips.add(tail);
  M(cap(0.14, 0.6), moss, tail, { y: -0.3, rx: 0.6 });
  root.scale.setScalar(1.55);
  return { root, body, limbs, mats: [stone, moss] };
}

function buildKerberosModel() {
  const fur = std(0x2a2422, { roughness: 1 });
  const ember = std(0x4a2210, { roughness: 0.9 });
  const dark = std(0x120e0c, { roughness: 0.7 });
  const eye = glow(0x2aff6a, 2.8);
  const flame = glow(0xff6a1a, 2.2);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  M(cap(0.75, 1.9), fur, body, { y: 1.1, rx: Math.PI / 2 });
  for (let i = 0; i < 5; i++) M(cone(0.16, 0.5), flame, body, { x: rnd(-0.5, 0.5), y: 1.5 + rnd(-0.1, 0.3), z: rnd(-0.7, 0.7), rx: rnd(-0.4, 0.4) });
  const heads = [];
  for (const s of [-1, 0, 1]) {
    const hg = new THREE.Group();
    hg.position.set(s * 0.55, 1.5, s === 0 ? 1.05 : 0.8);
    hg.rotation.y = s * 0.35;
    body.add(hg);
    M(box(0.55, 0.5, 0.65), fur, hg);
    M(box(0.3, 0.26, 0.4), dark, hg, { y: -0.05, z: 0.42 });
    M(sph(0.07), eye, hg, { x: 0.14, y: 0.12, z: 0.3 });
    M(sph(0.07), eye, hg, { x: -0.14, y: 0.12, z: 0.3 });
    for (const es of [-1, 1]) M(cone(0.1, 0.3), fur, hg, { x: es * 0.2, y: 0.32, rz: es * 0.3 });
    heads.push(hg);
  }
  const legs = [];
  for (const s of [-1, 1]) for (const f of [-1, 1]) {
    const lg = new THREE.Group();
    lg.position.set(s * 0.45, 0.65, f * 0.75);
    body.add(lg);
    M(cap(0.17, 0.75), fur, lg, { y: -0.3 });
    M(box(0.2, 0.18, 0.3), dark, lg, { y: -0.68, z: 0.08 });
    legs.push({ sh: lg });
  }
  const tail = new THREE.Group();
  tail.position.set(0, 1.3, -1.0);
  body.add(tail);
  M(cone(0.14, 0.7), flame, tail, { y: -0.2, rx: Math.PI });
  root.scale.setScalar(1.3);
  return { root, body, heads, limbs: legs, mats: [fur, ember] };
}

function buildMedusaModel() {
  const skin = std(0x6a8a62, { roughness: 0.6 });
  const scale = std(0x3a5a34, { roughness: 0.8 });
  const gold = std(0xc8a84a, { metalness: 0.7, roughness: 0.3 });
  const eye = glow(0x7aff5a, 2.6);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  M(cone(0.6, 1.8), scale, body, { y: 0.9 });
  M(cap(0.34, 0.6), skin, body, { y: 1.95 });
  const head = new THREE.Group();
  head.position.y = 2.5;
  body.add(head);
  M(sph(0.32), skin, head);
  M(sph(0.045), eye, head, { x: 0.13, y: 0.04, z: 0.26 });
  M(sph(0.045), eye, head, { x: -0.13, y: 0.04, z: 0.26 });
  const snakes = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const sg = new THREE.Group();
    sg.position.set(Math.cos(a) * 0.22, 0.18, Math.sin(a) * 0.22);
    head.add(sg);
    M(cap(0.05, 0.4), scale, sg, { y: 0.2, rx: 0.5 });
    M(cone(0.04, 0.15), gold, sg, { y: 0.42 });
    snakes.push(sg);
  }
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.45, 2.0, 0);
    body.add(sh);
    M(cap(0.1, 0.55), skin, sh, { y: -0.3 });
    M(sph(0.1), gold, sh, { y: -0.58 });
    arms.push({ sh });
  }
  root.scale.setScalar(1.1);
  return { root, body, snakes, limbs: arms, mats: [skin, scale] };
}

function buildBasiliscoModel() {
  const gold = std(0xc89a3a, { roughness: 0.6, metalness: 0.3 });
  const dark = std(0x5a4018, { roughness: 0.7 });
  const eye = glow(0xff2a2a, 2.8);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const segs = [];
  let z = 0;
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Group();
    s.position.set(0, 0.9 - i * 0.05, z);
    body.add(s);
    const r = 0.55 - i * 0.055;
    M(sph(r), i % 2 ? gold : dark, s, { sz: 1.3 });
    segs.push(s);
    z -= r * 1.5;
  }
  const head = new THREE.Group();
  head.position.set(0, 1.0, 0.9);
  body.add(head);
  M(cone(0.42, 1.0), gold, head, { rx: Math.PI / 2, y: 0, z: 0.1 });
  M(sph(0.09), eye, head, { x: 0.16, y: 0.1, z: 0.5 });
  M(sph(0.09), eye, head, { x: -0.16, y: 0.1, z: 0.5 });
  for (const s of [-1, 1]) M(cone(0.08, 0.4), dark, head, { x: s * 0.2, y: 0.26, rz: s * 0.3 });
  root.scale.setScalar(1.3);
  return { root, body, limbs: [], mats: [gold, dark] };
}

function buildKrakenModel() {
  const skin = std(0x16305a, { roughness: 0.5, metalness: 0.15 });
  const purple = std(0x3a2a6a, { roughness: 0.55 });
  const eye = glow(0xffcc22, 2.6);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  M(sph(0.85), skin, body, { y: 1.5, sy: 1.1 });
  const head = new THREE.Group();
  head.position.y = 2.1;
  body.add(head);
  M(sph(0.5), skin, head);
  M(sph(0.1), eye, head, { x: 0.22, y: 0.05, z: 0.38 });
  M(sph(0.1), eye, head, { x: -0.22, y: 0.05, z: 0.38 });
  const tentacles = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const tg = new THREE.Group();
    tg.position.set(Math.cos(a) * 0.5, 0.9, Math.sin(a) * 0.5);
    body.add(tg);
    const segA = new THREE.Group();
    tg.add(segA);
    M(cap(0.14, 0.7), purple, segA, { y: -0.3, rx: 0.3 });
    const segB = new THREE.Group();
    segB.position.y = -0.7;
    segA.add(segB);
    M(cap(0.1, 0.6), purple, segB, { y: -0.28, rx: 0.4 });
    tentacles.push(tg);
  }
  root.scale.setScalar(1.25);
  return { root, body, tentacles, limbs: [], mats: [skin, purple] };
}

function buildFenrirModel() {
  const fur = std(0x1a1e28, { roughness: 1 });
  const ice = glow(0x7ad8ff, 2.2);
  const eye = glow(0xb060ff, 2.8);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  M(cap(0.7, 1.8), fur, body, { y: 1.1, rx: Math.PI / 2 });
  for (let i = 0; i < 4; i++) M(cone(0.1, 0.35), ice, body, { x: rnd(-0.4, 0.4), y: 1.35 + rnd(0, 0.3), z: rnd(-0.6, 0.6), rx: rnd(-0.5, 0.5) });
  const head = new THREE.Group();
  head.position.set(0, 1.45, 0.95);
  body.add(head);
  M(box(0.5, 0.42, 0.6), fur, head);
  M(box(0.28, 0.22, 0.34), new THREE.MeshStandardMaterial({ color: 0x0a0c10 }), head, { y: -0.04, z: 0.38 });
  M(sph(0.065), eye, head, { x: 0.13, y: 0.1, z: 0.27 });
  M(sph(0.065), eye, head, { x: -0.13, y: 0.1, z: 0.27 });
  for (const s of [-1, 1]) M(cone(0.1, 0.3), fur, head, { x: s * 0.18, y: 0.3, rz: s * 0.3 });
  const legs = [];
  for (const s of [-1, 1]) for (const f of [-1, 1]) {
    const lg = new THREE.Group();
    lg.position.set(s * 0.42, 0.65, f * 0.7);
    body.add(lg);
    M(cap(0.16, 0.7), fur, lg, { y: -0.28 });
    M(cone(0.12, 0.3), ice, lg, { y: -0.68 });
    legs.push({ sh: lg });
  }
  const tail = new THREE.Group();
  tail.position.set(0, 1.25, -0.9);
  body.add(tail);
  M(cone(0.13, 0.65), ice, tail, { y: -0.2, rx: Math.PI });
  root.scale.setScalar(1.35);
  return { root, body, limbs: legs, mats: [fur] };
}

function buildLongModel() {
  const scale = std(0x7a1a28, { roughness: 0.4, metalness: 0.3 });
  const mane = std(0xe8e0d0, { roughness: 0.8 });
  const eye = glow(0x6ad0ff, 2.8);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const segs = [];
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Group();
    const a = i * 0.55;
    s.position.set(Math.sin(a) * 0.8, 1.6 + i * 0.12, -i * 0.65);
    body.add(s);
    M(sph(0.45 - i * 0.02), scale, s, { sz: 1.4 });
    M(cap(0.08, 0.5), mane, s, { y: 0.3, rx: 0.4 });
    segs.push(s);
  }
  const head = new THREE.Group();
  head.position.set(0, 1.6, 0.65);
  body.add(head);
  M(cone(0.35, 0.9), scale, head, { rx: Math.PI / 2, z: 0.1 });
  M(sph(0.08), eye, head, { x: 0.15, y: 0.08, z: 0.42 });
  M(sph(0.08), eye, head, { x: -0.15, y: 0.08, z: 0.42 });
  for (const s of [-1, 1]) M(cap(0.04, 0.4), mane, head, { x: s * 0.12, y: 0.22, rx: -0.6 });
  root.scale.setScalar(1.2);
  return { root, body, segs, limbs: [], mats: [scale, mane], flies: true };
}

function buildCataclismoModel() {
  const core = new THREE.MeshStandardMaterial({ color: 0x2a1a2a, roughness: 0.4, metalness: 0.4, emissive: 0x6a1aff, emissiveIntensity: 0.5 });
  const fireMat = glow(0xff6a1a, 2.4);
  const iceMat = glow(0x7ad8ff, 2.4);
  const rockMat = std(0x7a6a52, { roughness: 0.95 });
  const eye = glow(0xffffff, 3);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  M(sph(0.95), core, body, { y: 1.8 });
  const head = new THREE.Group();
  head.position.y = 2.95;
  body.add(head);
  M(sph(0.5), core, head);
  M(sph(0.1), eye, head, { x: 0.2, y: 0.05, z: 0.4 });
  M(sph(0.1), eye, head, { x: -0.2, y: 0.05, z: 0.4 });
  const shards = [];
  const mats = [fireMat, iceMat, rockMat];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    const sg = new THREE.Group();
    sg.position.set(Math.cos(a) * 1.5, 1.8 + Math.sin(i * 2) * 0.5, Math.sin(a) * 1.5);
    body.add(sg);
    M(cone(0.18, 0.6), mats[i % 3], sg, { rx: rnd(0, 3.14), rz: rnd(0, 3.14) });
    shards.push(sg);
  }
  root.scale.setScalar(1.7);
  return { root, body, shards, limbs: [], mats: [core], fireMat, iceMat, rockMat };
}

// --- Modelos con escala maestra (scale.js): GLB real si ya está cargado; si no, el procedural de reserva ---
function glbModel(gltf, S) {
  const model = gltf.scene.clone(true);
  const { root: nroot, naturalH } = normalizeModel(model); // pies en y=0, centrado, altura 1
  const root = new THREE.Group();
  const body = new THREE.Group();
  const yawHolder = new THREE.Group();
  yawHolder.rotation.y = S.yaw || 0;
  yawHolder.add(nroot);
  body.add(yawHolder);
  root.add(body);
  const mats = prepareMeshes(model);
  return { root, body, limbs: [], mats, flies: !!S.fly, naturalH, unit: S.height, source: 'glb' };
}

function proceduralModel(builder, S) {
  const m = builder();
  m.root.scale.setScalar(1);
  const naturalH = Math.max(1e-3, measure(m.root).h);
  m.naturalH = naturalH;
  m.unit = S.height / naturalH; // escala que lleva el modelo procedural a la altura objetivo
  m.source = 'procedural';
  if (S.fly) m.flies = true;
  return m;
}

export function makeBossModel(kind) {
  const S = bossScale(kind);
  const gltf = S.glb ? cachedGLB(modelUrl(S.glb)) : null;
  return gltf ? glbModel(gltf, S) : proceduralModel(MODEL_BUILDERS[kind], S);
}

// Carga en segundo plano el GLB del jefe y del aliado de un nivel (mientras tanto vale el modelo de reserva).
export function preloadBoss(kind) {
  const S = kind && bossScale(kind);
  if (S && S.glb) loadGLB(modelUrl(S.glb)).catch(() => {});
}
export function preloadAlly(kind) {
  const S = ALLY_SCALE[kind];
  if (S && S.glb) loadGLB(modelUrl(S.glb)).catch(() => {});
}

const MODEL_BUILDERS = { minotauro: buildMinotauroModel, kerberos: buildKerberosModel, medusa: buildMedusaModel, basilisco: buildBasiliscoModel, kraken: buildKrakenModel, fenrir: buildFenrirModel, long: buildLongModel, cataclismo: buildCataclismoModel };

/* ------------------------------------------------------------------ */
/*  Clase base: máquina de estados y combate, compartida por los 7     */
/*  jefes. Cada subclase solo define nombre, modelo, color y ritmo.    */
/* ------------------------------------------------------------------ */
export class BossBase {
  constructor(kind, ctx, arena, flavor) {
    this.kind = kind;
    this.ctx = ctx;
    this.arena = arena; // { x, z, r }
    this.name = flavor.name; this.icon = flavor.icon; this.color = flavor.color; this.cssColor = flavor.cssColor;
    this.chargeName = flavor.chargeName; this.slamName = flavor.slamName; this.S = bossScale(kind); // dimensiones objetivo (scale.js)
    this.model = makeBossModel(kind);
    this.baseScale = this.model.unit;
    this.reach = Math.max(4.6, this.S.radius + 3.6); // alcance del golpe del héroe, medido desde el centro del jefe
    this.hitDist = this.S.radius + 0.9; // contacto de la embestida con el héroe
    this.slamBase = Math.max(6, this.S.radius * 1.8 + 3.5); // radio base de la onda
    ctx.scene.add(this.model.root);
    this.flyHeight = this.model.flies ? (this.S.fly ?? 5.5) : 0;
    this.pos = new THREE.Vector3(arena.x, this.groundY(arena.x, arena.z) + this.flyHeight, arena.z - arena.r * 0.6);
    this.facing = 0;
    this.hpMax = flavor.hpMax || 100;
    this.hp = this.hpMax;
    this.phase = 1;
    this.state = 'enter';
    this.t = 0;
    this.stateT = 0;
    this.cd = 1.6;
    this.invuln = 0.6;
    this.hitFlash = 0;
    this.deathT = 0;

    const ringGeo = new THREE.RingGeometry(0.1, 1, 40);
    this.ringMesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.ringMesh.rotation.x = -Math.PI / 2;
    ctx.scene.add(this.ringMesh);
    this.ringMesh.visible = false;
    const arrowGeo = new THREE.ConeGeometry(0.6, 1.8, 4);
    this.arrowMesh = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.8 }));
    this.arrowMesh.rotation.x = Math.PI / 2;
    ctx.scene.add(this.arrowMesh);
    this.arrowMesh.visible = false;

    ctx.ui.alert(`${this.icon} ¡${this.name} aparece!`, 4000);
    ctx.ui.banner('find', `${this.icon} Usa tu poder (Q) cerca de él para golpearlo`, `Esquiva su ${this.chargeName.toLowerCase()} y su ${this.slamName.toLowerCase()}`);
  }

  groundY(x, z) {
    return this.ctx.world.groundY ? this.ctx.world.groundY(x, z) : 0;
  }
  urgentAt() { return false; }
  gauge() {
    return { label: this.name.toUpperCase(), pct: clamp(this.hp / this.hpMax, 0, 1), text: this.state === 'dead' ? 'Derrotado' : `${Math.ceil((this.hp / this.hpMax) * 100)}%`, danger: this.state !== 'dead', color: this.cssColor, isBoss: true };
  }

  onPlayerAttack(ppos) {
    if (this.state === 'dead' || this.state === 'enter' || this.invuln > 0) return false;
    const d = Math.hypot(ppos.x - this.pos.x, ppos.z - this.pos.z);
    if (d > this.reach) return false;
    this.takeDamage(12);
    return true;
  }

  takeDamage(n) {
    if (this.state === 'dead') return;
    this.hp = Math.max(0, this.hp - n);
    this.hitFlash = 0.25;
    this.invuln = 0.35;
    this.ctx.chase.shake(0.18);
    this.ctx.audio.noiseBurst(0.2, 260, 0.35, 'lowpass');
    for (let i = 0; i < 10; i++) this.ctx.fx.sparkle(this.pos.x + rnd(-0.6, 0.6), this.pos.y + 1.2, this.pos.z + rnd(-0.6, 0.6), this.color, 1.6);
    this.ctx.game.addScore(15);
    const newPhase = this.hp <= this.hpMax * 0.33 ? 3 : this.hp <= this.hpMax * 0.66 ? 2 : 1;
    if (newPhase !== this.phase) {
      this.phase = newPhase;
      this.state = 'enrage';
      this.stateT = 0;
      this.invuln = 1.0;
      this.ctx.ui.alert(newPhase === 3 ? `${this.icon} ¡${this.name} desata su furia final!` : `${this.icon} ¡${this.name} se enfurece!`, 2600);
      this.ctx.audio.alert();
    }
    if (this.hp <= 0) {
      this.state = 'dead';
      this.deathT = 0;
      this.ctx.ui.banner('good', `🏆 ¡${this.name} derrotado!`, 'El camino está libre');
      this.ctx.audio.success();
    }
  }

  pickAttack() {
    return Math.random() < 0.55 ? 'charge' : 'slam';
  }

  update(dt) {
    const { ctx } = this;
    const { player } = ctx;
    this.t += dt;
    this.stateT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    const speedMul = 0.85 + (this.phase - 1) * 0.22;
    const faceTo = (x, z) => { this.facing = damp(this.facing, Math.atan2(x - this.pos.x, z - this.pos.z), 6, dt); };

    if (this.state === 'dead') {
      this.deathT += dt;
      this.model.root.position.y = this.groundY(this.pos.x, this.pos.z) + this.flyHeight * Math.max(0, 1 - this.deathT * 0.8) - Math.min(this.S.height * 0.4, this.deathT * this.S.height * 0.18);
      this.model.root.rotation.z = Math.min(1.1, this.deathT * 0.9);
      this.ringMesh.visible = false;
      this.arrowMesh.visible = false;
      this.syncTransform(true);
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
      const d = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      if (d > Math.max(7, this.reach + 2.5)) {
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
      const mid = new THREE.Vector3(this.pos.x, this.groundY(this.pos.x, this.pos.z) + 0.4, this.pos.z).addScaledVector(new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)), this.S.radius + 2.2);
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
      const speed = 14 + (this.phase - 1) * 1.6;
      this.pos.x += this.chargeDir.x * speed * dt;
      this.pos.z += this.chargeDir.z * speed * dt;
      const d0 = Math.hypot(this.pos.x - this.arena.x, this.pos.z - this.arena.z);
      if (d0 > this.arena.r) {
        const nx = (this.pos.x - this.arena.x) / d0, nz = (this.pos.z - this.arena.z) / d0;
        this.pos.x = this.arena.x + nx * this.arena.r;
        this.pos.z = this.arena.z + nz * this.arena.r;
        this.state = 'recover'; this.stateT = 0;
      }
      const dp = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      if (dp < this.hitDist && this.stateT > 0.08) {
        ctx.game.hitPlayer(1, this.pos);
        this.state = 'recover'; this.stateT = 0;
      }
      if (this.stateT > 1.3) { this.state = 'recover'; this.stateT = 0; }
      if (!this.model.flies) for (let i = 0; i < 2; i++) this.ctx.fx.dustPuff(this.pos.x + rnd(-0.5, 0.5), this.groundY(this.pos.x, this.pos.z) + 0.2, this.pos.z + rnd(-0.5, 0.5), 1.1);
      this.syncTransform();
      return;
    }
    if (this.state === 'tg_slam') {
      faceTo(player.pos.x, player.pos.z);
      const dur = 0.9 - (this.phase - 1) * 0.1;
      const radius = this.slamBase + (this.phase - 1) * 0.6;
      this.ringMesh.visible = true;
      this.ringMesh.position.set(this.pos.x, this.groundY(this.pos.x, this.pos.z) + 0.08, this.pos.z);
      this.ringMesh.scale.setScalar(radius);
      this.ringMesh.material.opacity = 0.18 + 0.35 * (this.stateT / dur);
      if (this.stateT >= dur) { this.state = 'slam'; this.stateT = 0; this.slamRadius = radius; }
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
        for (let i = 0; i < 16; i++) {
          const a = Math.random() * TAU, r = Math.random() * this.slamRadius;
          this.ctx.fx.sparkle(this.pos.x + Math.cos(a) * r, this.groundY(this.pos.x, this.pos.z) + 0.6, this.pos.z + Math.sin(a) * r, this.color, 1.8);
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
    const gy = this.groundY(this.pos.x, this.pos.z) + this.flyHeight;
    this.model.root.position.set(this.pos.x, gy, this.pos.z);
    this.model.root.rotation.y = this.facing;
    const bob = this.state === 'idle' ? Math.sin(this.t * 2.2) * 0.04 : 0;
    this.model.body.position.y = bob + (this.model.flies ? Math.sin(this.t * 1.4) * 0.3 : 0);
    const windup = this.state === 'tg_charge' || this.state === 'tg_slam';
    const kScale = 1 + (windup ? Math.sin(this.stateT * 14) * 0.04 : 0) + (this.state === 'charge' ? 0.06 : 0);
    this.model.root.scale.setScalar(this.baseScale * kScale);
    for (const limb of this.model.limbs || []) {
      const raise = this.state === 'tg_slam' || this.state === 'slam' ? -2.2 : this.state === 'charge' ? -0.6 : -0.2;
      limb.sh.rotation.x = damp(limb.sh.rotation.x, raise, 8, 0.016);
    }
    for (const mesh of this.model.mats || []) {
      mesh.emissive = mesh.emissive || new THREE.Color(0);
      mesh.emissive.setRGB(this.hitFlash, this.hitFlash * 0.3, 0);
      mesh.emissiveIntensity = 1;
    }
    if (this.model.shards) {
      this.model.shards.forEach((sg, i) => {
        const a = (i / this.model.shards.length) * TAU + this.t * 0.8;
        sg.position.set(Math.cos(a) * 1.5, 1.8 + Math.sin(this.t + i * 2) * 0.5, Math.sin(a) * 1.5);
        sg.rotation.y += 0.04;
      });
    }
  }

  dispose() {
    this.ctx.scene.remove(this.model.root);
    this.ctx.scene.remove(this.ringMesh);
    this.ctx.scene.remove(this.arrowMesh);
  }
}

function defineBoss(kind, flavor) {
  return class extends BossBase {
    constructor(ctx, arena) {
      super(kind, ctx, arena, flavor);
    }
  };
}

export const Minotauro = defineBoss('minotauro', { name: 'Minotauro', icon: '👹', color: 0xff6a1a, cssColor: '#ff8a1a', chargeName: 'Embestida', slamName: 'Golpe sísmico' });
export const Kerberos = defineBoss('kerberos', { name: 'Kerberos', icon: '🐕‍🦺', color: 0xff4a1a, cssColor: '#ff5a1a', chargeName: 'Mordisco en carga', slamName: 'Aliento de fuego' });
export const Medusa = defineBoss('medusa', { name: 'Medusa', icon: '🐍', color: 0x3aff6a, cssColor: '#4aff7a', chargeName: 'Zarpazo de serpientes', slamName: 'Mirada petrificante' });
export const Basilisco = defineBoss('basilisco', { name: 'Basilisco', icon: '🐉', color: 0xd8b020, cssColor: '#e0b830', chargeName: 'Embestida desde la arena', slamName: 'Tormenta de arena' });
export const Kraken = defineBoss('kraken', { name: 'Kraken', icon: '🐙', color: 0x2a6aff, cssColor: '#3a8aff', chargeName: 'Golpe de tentáculo', slamName: 'Ola gigante' });
export const Fenrir = defineBoss('fenrir', { name: 'Fenrir', icon: '🐺', color: 0x8ad0ff, cssColor: '#9ad8ff', chargeName: 'Embestida helada', slamName: 'Aullido de hielo' });
export const Long = defineBoss('long', { name: 'Long', icon: '🐲', color: 0x5ac8ff, cssColor: '#6ad0ff', chargeName: 'Picado aéreo', slamName: 'Tormenta de rayos' });
// El jefe final de Apocalia no es un monstruo más: es el propio Cataclismo que ha conectado
// todas las catástrofes de la campaña. Más vida y más ritmo que el resto (mismo framework).
export const Cataclismo = defineBoss('cataclismo', { name: 'El Cataclismo', icon: '☄️', color: 0x9a3cff, cssColor: '#b05aff', chargeName: 'Embestida del vacío', slamName: 'Onda elemental', hpMax: 190 });

const BOSSES = { minotauro: Minotauro, kerberos: Kerberos, medusa: Medusa, basilisco: Basilisco, kraken: Kraken, fenrir: Fenrir, long: Long, cataclismo: Cataclismo };

export function createBoss(kind, ctx, arena) {
  const C = BOSSES[kind];
  if (!C) return null;
  return new C(ctx, arena);
}

/* ------------------------------------------------------------------ */
/*  VOYA — aliada no jugable (León Blanco + Éter)                      */
/*  No es un protagonista jugable ni combate directamente al jefe:     */
/*  aparece en Apocalia y protege al jugador con escudos de Éter,      */
/*  coherente con su ficha ("la verdadera fuerza... es la protección") */
/* ------------------------------------------------------------------ */
function buildVoyaModel() {
  const fur = std(0xe8e8ec, { roughness: 0.7 });
  const armor = std(0x9aa0ac, { roughness: 0.3, metalness: 0.75 });
  const ether = glow(0x5ad0ff, 2.6);
  const eye = glow(0x5ad0ff, 3);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  M(cap(0.34, 0.6), armor, body, { y: 1.15 });
  M(sph(0.42), fur, body, { y: 1.75, sy: 0.9 });
  const head = new THREE.Group();
  head.position.y = 2.25;
  body.add(head);
  M(sph(0.28), fur, head);
  M(sph(0.045), eye, head, { x: 0.12, y: 0.04, z: 0.24 });
  M(sph(0.045), eye, head, { x: -0.12, y: 0.04, z: 0.24 });
  for (let i = 0; i < 16; i++) {
    const a = rnd(0, TAU);
    M(cone(0.03, 0.3), fur, head, { x: Math.cos(a) * 0.3, y: 0.1 + rnd(-0.1, 0.2), z: Math.sin(a) * 0.3, rx: rnd(-0.3, 0.3), rz: rnd(-0.3, 0.3) });
  }
  const shieldArm = new THREE.Group();
  shieldArm.position.set(-0.5, 1.3, 0.1);
  body.add(shieldArm);
  M(new THREE.CircleGeometry(0.42, 24), armor, shieldArm, { ry: Math.PI / 2 });
  M(new THREE.RingGeometry(0.3, 0.36, 24), ether, shieldArm, { ry: Math.PI / 2 });
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.75 + i * 0.22, 0.02, 6, 24), ether);
    r.rotation.x = Math.PI / 2 + i * 0.5;
    body.add(r);
    rings.push(r);
  }
  root.scale.setScalar(1.25);
  return { root, body, rings, mats: [fur, armor] };
}

export function makeAllyModel(kind) {
  const S = ALLY_SCALE[kind];
  const gltf = S.glb ? cachedGLB(modelUrl(S.glb)) : null;
  return gltf ? glbModel(gltf, S) : proceduralModel(buildVoyaModel, S);
}

export class Voya {
  constructor(ctx) {
    this.ctx = ctx;
    this.model = makeAllyModel('voya');
    this.model.root.scale.setScalar(this.model.unit);
    this.S = ALLY_SCALE.voya;
    ctx.scene.add(this.model.root);
    this.t = 0;
    this.shieldCd = 4; // primer escudo pronto tras aparecer
    ctx.ui.alert('🦁 ¡Voya acude a proteger a los guardianes!', 4200);
    ctx.ui.banner('good', '🦁 Voya', '"La verdadera fuerza no está en el ataque, sino en la protección." Te protegerá con escudos de Éter durante el combate.');
  }
  update(dt) {
    const { ctx } = this;
    const { player } = ctx;
    this.t += dt;
    const ang = this.t * 0.5;
    const ox = Math.cos(ang) * 3.2, oz = Math.sin(ang) * 3.2;
    const gy = this.ctx.world.groundY ? this.ctx.world.groundY(player.pos.x + ox, player.pos.z + oz) : player.pos.y;
    this.model.root.position.set(player.pos.x + ox, gy + 0.3 + Math.sin(this.t * 1.4) * 0.15, player.pos.z + oz);
    this.model.root.rotation.y = -ang + Math.PI / 2;
    for (const r of this.model.rings || []) r.rotation.z += dt * 0.6;
    this.shieldCd -= dt;
    if (this.shieldCd <= 0 && player.shieldT < 1) {
      this.shieldCd = rnd(13, 17);
      player.shieldT = Math.max(player.shieldT, 5);
      for (let i = 0; i < 20; i++) ctx.fx.sparkle(player.pos.x + rnd(-1, 1), player.pos.y + rnd(0.5, 1.8), player.pos.z + rnd(-1, 1), 0x5ad0ff, 2);
      ctx.audio.power('surf');
      ctx.ui.banner('good', '🦁 ¡Escudo de Éter!', 'Voya te protege unos segundos');
    }
  }
  dispose() {
    this.ctx.scene.remove(this.model.root);
  }
}

export function createAlly(kind, ctx) {
  if (kind === 'voya') return new Voya(ctx);
  return null;
}
