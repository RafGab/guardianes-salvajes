import * as THREE from 'three';
import { rnd, TAU } from './attack.js';
import { Skill, ease, lerp, clamp, V, boneWorld } from './base.js';
import { terrainH } from '../terrain.js';
import { ui } from '../ui.js';
import { douseFires } from './envreact.js';

/* ======================================================================
   PODERES NUEVOS (actualización de habilidades)
   · ÁMBAR — Sobrecarga Eléctrica (escudo): barrera de arcos eléctricos que recorren su silueta.
   · ÁMBAR — Tormenta Eléctrica (especial): nube negra que se carga y descarga lluvia y rayos (apaga el fuego).
   · DONA — grietas carmesí de la Luna de Sangre (crackDecal, la usa BloodMoonSkill en powers.js).
   ====================================================================== */

// puntos de la silueta del héroe (huesos), en orden alrededor del cuerpo; si faltan, un aro alrededor
const SIL = ['head', 'hand_L', 'forearm_L', 'upper_arm_L', 'wing_L_3', 'chest', 'foot_L', 'shin_L', 'root', 'shin_R', 'foot_R', 'spine', 'wing_R_3', 'upper_arm_R', 'forearm_R', 'hand_R'];
function silhouette(sk) {
  const out = [];
  for (const n of SIL) { const w = boneWorld(sk, n); if (w) out.push(w); }
  if (out.length >= 5) return out;
  const p = sk.p, c = [];
  for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; c.push(V(p.pos.x + Math.cos(a) * p.R * 1.2, p.pos.y + p.H * (0.5 + 0.45 * Math.sin(a * 2)), p.pos.z + Math.sin(a) * p.R * 1.2)); }
  return c;
}

/* ---------- burbuja de energía con chispazos (escudo de sobrecarga) ---------- */
let _shGeo = null;
function overloadShell() {
  if (!_shGeo) _shGeo = new THREE.SphereGeometry(1, 32, 20);
  const U = { uT: { value: 0 }, uK: { value: 0 }, uHit: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uT; uniform float uK; uniform float uHit; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float n(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
      void main(){
        float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        // venas eléctricas inestables que se mueven por la superficie
        float v = abs(n(vP * 4.0 + vec3(0.0, uT * 3.0, 0.0)) - 0.5);
        float vein = smoothstep(0.06, 0.0, v) * (0.6 + 0.4 * sin(uT * 40.0 + vP.y * 9.0));
        float flick = 0.75 + 0.25 * sin(uT * 31.0) * sin(uT * 17.0);
        vec3 col = mix(vec3(0.25, 0.55, 1.0), vec3(0.85, 0.95, 1.0), vein) * (1.0 + 2.0 * uHit);
        gl_FragColor = vec4(col, (fr * 0.45 + vein * 0.8) * uK * flick + uHit * fr * 0.6);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(_shGeo, mat);
  m.renderOrder = 6;
  return { m, U, mat };
}

/* ======================================================================
   ÁMBAR — SOBRECARGA ELÉCTRICA (escudo)
   Una barrera de energía eléctrica la envuelve: arcos que recorren continuamente su silueta y se conectan entre
   sí, ramificaciones que saltan hacia fuera, pulsos de energía y una burbuja inestable. Al recibir un golpe, el
   escudo responde con una descarga más intensa hacia el atacante. Los enemigos que se acercan reciben chispazos.
   (La protección es la del botón de escudo: 4 s sin daño, igual que los demás escudos.)
   ====================================================================== */
export class OverloadShieldSkill extends Skill {
  begin() { this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'carga', dur: d.prep, enter: this.enterCharge, tick: (dt, k) => { this.place(ease(k)); pose.sy = 1 + 0.04 * k; this.arcs(dt, 0.4 + 0.6 * k); } },
      { name: 'escudo', dur: d.exec, tick: this.tickShield },
      { name: 'descarga', dur: d.recover, enter: () => { this.sfx('crack'); this.burst(null, 0.6); }, tick: (dt, k) => { this.place(1 - k); this.arcs(dt, 1 - k); } },
    ];
  }
  enterCharge() {
    this.sh = overloadShell();
    this.prop(this.sh.m);
    this.zapT = 0; this.arcT = 0; this.pulseT = 0;
    this.sfx('crack');
    this.p.elecGuard = { hit: (from) => this.burst(from, 1) };
    // la energía nace en sus manos y se extiende por el cuerpo
    const c = this.center(0.55);
    this.vfx.ring(this.p.pos.x, null, this.p.pos.z, { r0: 0.3, r1: 2.4, dur: 0.35, color: 0x6ab4ff });
    this.vfx.orb(c, { r: 0.6, color: 0x9fd0ff, opacity: 0.6, life: 0.2 });
  }
  cleanup() { if (this.p.elecGuard) this.p.elecGuard = null; }
  place(k) {
    const p = this.p, S = this.sh;
    if (!S) return;
    S.m.position.set(p.pos.x, p.pos.y + p.H * 0.5, p.pos.z);
    S.m.scale.set(p.H * 0.62, p.H * 0.66, p.H * 0.62);
    S.U.uT.value = this.t; S.U.uK.value = k;
    S.U.uHit.value = Math.max(0, S.U.uHit.value - 1 / 60 * 3);
  }
  // arcos que recorren la silueta: unen puntos vecinos del cuerpo (con ramas que saltan hacia fuera)
  arcs(dt, k) {
    this.arcT -= dt;
    if (this.arcT > 0 || k < 0.05) return;
    this.arcT = 0.045;
    const pts = silhouette(this), n = pts.length;
    for (let j = 0; j < 2; j++) {
      const i = Math.floor(Math.random() * n), a = pts[i], b = pts[(i + 1 + Math.floor(Math.random() * 2)) % n];
      this.vfx.bolt(a, b, { color: Math.random() < 0.5 ? 0x5aa8ff : 0xcfeaff, life: 0.07, jag: 0.1, segs: 7 });
    }
    if (Math.random() < 0.5 * k) { // ramificación hacia la burbuja
      const a = pts[Math.floor(Math.random() * n)], c = this.center(0.5), dir = a.clone().sub(c).normalize();
      this.vfx.bolt(a, a.clone().addScaledVector(dir, this.p.H * rnd(0.25, 0.45)).add(V(rnd(-0.2, 0.2), rnd(-0.2, 0.2), rnd(-0.2, 0.2))), { color: 0x8ac4ff, life: 0.06, jag: 0.15, segs: 5 });
    }
  }
  tickShield(dt) {
    const p = this.p, d = this.def;
    this.place(1);
    this.arcs(dt, 1);
    this.pose.sy = 1.03 + 0.02 * Math.sin(this.t * 20);
    // pulsos de energía
    this.pulseT -= dt;
    if (this.pulseT <= 0) { this.pulseT = 0.5; this.vfx.ring(p.pos.x, p.pos.y + p.H * 0.5, p.pos.z, { r0: p.H * 0.4, r1: p.H * 0.75, dur: 0.3, color: 0x7ab8ff, opacity: 0.5 }); }
    if (Math.random() < 0.5) this.g.fx.spark.emit(p.pos.x + rnd(-0.4, 0.4), p.pos.y + rnd(0.2, p.H), p.pos.z + rnd(-0.4, 0.4), rnd(-1, 1), rnd(0, 1.5), rnd(-1, 1), rnd(0.15, 0.3), 0.05, 0.01, 0xdff0ff, 0x3a8cff, 0.9, 0, -1, 1);
    // chispazos a los enemigos que se acercan
    this.zapT -= dt;
    if (this.zapT <= 0) {
      this.zapT = 0.45;
      for (const t of this.combat.inCircle(p.pos.x, p.pos.z, d.radius)) {
        this.vfx.bolt(this.center(0.55), V(t.pos.x, t.pos.y + 0.7, t.pos.z), { color: 0x6ab4ff, life: 0.1, jag: 0.35, segs: 9 });
        this.hit(t, d.damage);
        const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z);
        this.combat.push(t, dx, dz, d.push);
      }
    }
  }
  // descarga intensa (al recibir un golpe, o al terminar): rayos hacia el impacto, destello y onda
  burst(from, k = 1) {
    const p = this.p, c = this.center(0.55);
    if (this.sh) this.sh.U.uHit.value = 1;
    const dirTo = from ? V(from.x - p.pos.x, 0, from.z - p.pos.z).normalize() : null;
    for (let i = 0; i < 7; i++) {
      const a = dirTo ? Math.atan2(dirTo.z, dirTo.x) + rnd(-0.7, 0.7) : rnd(0, TAU), r = p.H * rnd(0.9, 1.6) * k;
      this.vfx.bolt(c, V(c.x + Math.cos(a) * r, c.y + rnd(-0.6, 0.8), c.z + Math.sin(a) * r), { color: i % 2 ? 0x5aa8ff : 0xffffff, life: 0.12, jag: 0.35, segs: 9 });
    }
    this.vfx.ring(p.pos.x, p.pos.y + p.H * 0.5, p.pos.z, { r0: 0.4, r1: p.H * 1.6 * k, dur: 0.3, color: 0x9fd0ff });
    this.g.fx.sparkle(c.x, c.y, c.z, 0xcfeaff, 3);
    this.shake(0.08 * k);
    if (from) {
      this.sfx('crack');
      for (const t of this.combat.inCircle(from.x, from.z, 2.5)) { this.hit(t, this.def.damage * 2); const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z); this.combat.push(t, dx, dz, this.def.push * 1.5); }
    }
  }
}

/* ======================================================================
   ÁMBAR — TORMENTA ELÉCTRICA (especial)
   FASE 1 · Ámbar alza un brazo al cielo: sobre ella se forma una gran nube negra que acumula electricidad, con
   relámpagos internos cada vez más intensos que iluminan el entorno.
   FASE 2 · La nube descarga: lluvia y rayos que caen sobre la zona (buscan a los enemigos), con destellos,
   truenos y luz. La lluvia APAGA EL FUEGO de la zona (poder de Ámbar contra el fuego: Tormenta Eléctrica).
   ====================================================================== */
let _cloudGeo = null;
export class ElectricStormSkill extends Skill {
  begin() {
    const p = this.p, f = this.fwd, d = this.def;
    this.c = V(p.pos.x + f.x * d.ahead, 0, p.pos.z + f.z * d.ahead);
    this.c.y = terrainH(this.c.x, this.c.z);
    this.start();
    return true;
  }
  build() {
    const d = this.def;
    return [
      { name: 'acumular', dur: d.prep, enter: this.enterCharge, tick: this.tickCharge },
      { name: 'tormenta', dur: d.exec, enter: this.enterStorm, tick: this.tickStorm },
      { name: 'disipar', dur: d.recover, tick: (dt, k) => { this.armK = 1 - ease(k); this.cloudAt(1 - ease(k), 0.2 * (1 - k)); } },
    ];
  }
  cloudTop() { return this.p.pos.y + this.def.height; }
  enterCharge() {
    const d = this.def;
    if (!_cloudGeo) _cloudGeo = new THREE.IcosahedronGeometry(1, 2);
    this.mat = new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 1, emissive: 0x9aa8d0, emissiveIntensity: 0, transparent: true, opacity: 0.95, flatShading: true });
    this.cloud = new THREE.Group();
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU + rnd(-0.2, 0.2), r = i === 0 ? 0 : rnd(1.5, d.radius * 0.55);
      const m = new THREE.Mesh(_cloudGeo, this.mat);
      m.position.set(Math.cos(a) * r, rnd(-0.4, 0.6), Math.sin(a) * r);
      m.scale.set(rnd(2, 3.4), rnd(1.1, 1.7), rnd(2, 3.4));
      this.cloud.add(m);
    }
    this.cloud.scale.setScalar(0.01);
    this.prop(this.cloud);
    // luz de los relámpagos: ilumina el escenario con cada descarga
    this.light = new THREE.PointLight(0x9fc8ff, 0, d.radius * 3.5, 1.6);
    this.prop(this.light);
    this.dark = this.v2.ambience({ color: '#1a2238', alpha: 0.35, blend: 'multiply', exposure: 0.85, dur: d.prep + d.exec + d.recover, fin: d.prep * 0.8, fout: d.recover });
    this.flashK = 0; this.innerT = 0;
    this.armK = 0;
    this.sfx('wind');
    // un brazo alzado hacia el cielo, el otro algo abierto
    this.setBones((B, dt, t, fx) => {
      const e = this.armK;
      fx.rot(B.upper_arm_R, 1, 0, 0, -2.7 * e); fx.rot(B.upper_arm_R, 0, 0, 1, -0.25 * e);
      fx.rot(B.forearm_R, 1, 0, 0, -0.2 * e);
      fx.rot(B.upper_arm_L, 0, 0, 1, 0.45 * e);
      fx.rot(B.wing_R_1, 0, 0, 1, -0.5 * e); fx.rot(B.wing_L_1, 0, 0, 1, 0.3 * e);
      fx.rot(B.head, 1, 0, 0, -0.35 * e);  // mira a la nube
    });
    ui.banner('find', '⛈️ Tormenta Eléctrica', 'La nube se carga de electricidad…');
  }
  // nube encima de Ámbar (sigue a la heroína) con su tamaño k y brillo interno g
  cloudAt(k, g) {
    const p = this.p, H = this.cloudTop();
    this.cloud.position.set(lerp(p.pos.x, this.c.x, 0.5), H, lerp(p.pos.z, this.c.z, 0.5));
    this.cloud.scale.setScalar(Math.max(0.01, k));
    this.cloud.rotation.y += 0.004;
    this.mat.opacity = 0.95 * Math.min(1, k * 1.5);
    this.flashK = Math.max(0, this.flashK - 1 / 60 * 6);
    this.mat.emissiveIntensity = g * 0.05 + this.flashK * this.flashK * 0.55; // nube negra: solo se ilumina con los relámpagos
    this.light.position.copy(this.cloud.position).y -= 1;
    this.light.intensity = (g * 3 + this.flashK * 26) * k;
  }
  innerBolt(power) {
    const o = this.cloud.position, R = this.def.radius * 0.5;
    const a = V(o.x + rnd(-R, R), o.y + rnd(-0.6, 0.4), o.z + rnd(-R, R)), b = V(o.x + rnd(-R, R), o.y + rnd(-0.8, 0.3), o.z + rnd(-R, R));
    this.vfx.bolt(a, b, { color: 0xbfe0ff, life: 0.09, jag: 0.6, segs: 10 });
    this.flashK = Math.max(this.flashK, 0.35 * power);
  }
  tickCharge(dt, k) {
    this.armK = ease(Math.min(1, k * 2.5));
    this.cloudAt(ease(Math.min(1, k * 1.4)), 0.15 + 0.6 * k);
    this.innerT -= dt;
    if (this.innerT <= 0) { this.innerT = lerp(0.35, 0.06, k); this.innerBolt(k); if (Math.random() < k * 0.5) this.sfx('crack'); }
    // energía que sube del brazo alzado a la nube
    const h = boneWorld(this, 'hand_R') || this.center(1.05);
    if (Math.random() < 0.3 + 0.5 * k) this.g.fx.spark.emit(h.x, h.y, h.z, rnd(-0.5, 0.5), rnd(3, 6), rnd(-0.5, 0.5), rnd(0.3, 0.6), 0.06, 0.02, 0xdff0ff, 0x3a8cff, 0.9, 0, -4, 1);
    if (k > 0.55 && Math.random() < 0.08) this.vfx.bolt(h, V(this.cloud.position.x, this.cloud.position.y - 1, this.cloud.position.z), { color: 0x8ac4ff, life: 0.08, jag: 0.8, segs: 10 });
  }
  enterStorm() {
    this.strikeT = 0; this.douseT = 0;
    this.doused = 0;
    this.sfx('boom');
    this.shake(0.15);
    ui.banner('find', '⛈️ ¡Tormenta!', 'Lluvia y rayos sobre la zona');
  }
  strike(at) {
    const top = V(this.cloud.position.x + rnd(-1.5, 1.5), this.cloud.position.y - 0.8, this.cloud.position.z + rnd(-1.5, 1.5));
    this.vfx.bolt(top, at, { color: 0xcfe6ff, life: 0.18, jag: 1.1, segs: 16 });
    this.vfx.bolt(top, at, { color: 0x6aa8ff, life: 0.12, jag: 1.6, segs: 12 });
    this.vfx.ring(at.x, null, at.z, { r0: 0.3, r1: 2.6, dur: 0.35, color: 0x9fd0ff });
    this.vfx.orb(V(at.x, at.y + 0.3, at.z), { r: 0.8, color: 0xdff0ff, opacity: 0.8, life: 0.12 });
    this.vfx.sparks(at.x, at.y + 0.2, at.z, 0xcfe6ff, 8, 3.5);
    this.flashK = 1;
    if (Math.random() < 0.6) this.sfx('crack');
    this.shake(0.06);
    if (Math.random() < 0.35) this.v2.ambience({ color: '#ffffff', alpha: 0.22, blend: 'screen', exposure: 1, dur: 0.06, fin: 0.01, fout: 0.12 }); // destello del relámpago
    for (const t of this.combat.inCircle(at.x, at.z, this.def.strikeR)) {
      this.hit(t, this.def.boltDamage);
      const { dx, dz } = this.awayFrom(t, at.x, at.z);
      this.combat.push(t, dx, dz, 4);
    }
  }
  tickStorm(dt, k) {
    const d = this.def, fx = this.g.fx;
    this.armK = 1;
    this.cloudAt(1, 0.7);
    const o = this.cloud.position, R = d.radius;
    // LLUVIA: gotas que caen de la nube sobre toda la zona
    for (let i = 0; i < 26; i++) {
      const a = rnd(0, TAU), r = Math.sqrt(Math.random()) * R, x = o.x + Math.cos(a) * r, z = o.z + Math.sin(a) * r;
      fx.water.emit(x, o.y - 0.8 - rnd(0, 2), z, rnd(-0.3, 0.3), -rnd(14, 18), rnd(-0.3, 0.3), rnd(0.35, 0.6), 0.035, 0.03, 0xbfd8ff, 0x8ab0e0, 0.6, 0, 0, 0);
    }
    if (Math.random() < 0.5) { const a = rnd(0, TAU), r = Math.sqrt(Math.random()) * R, x = o.x + Math.cos(a) * r, z = o.z + Math.sin(a) * r; this.g.fx.splash(x, terrainH(x, z), z, 2, 0.3); }
    // RAYOS: buscan a los enemigos de la zona; si no hay, caen repartidos
    this.strikeT -= dt;
    if (this.strikeT <= 0) {
      this.strikeT = 1 / d.boltsPerSec * rnd(0.6, 1.4);
      const foes = this.combat.inCircle(o.x, o.z, R + 1);
      const t = foes.length && Math.random() < 0.7 ? foes[Math.floor(Math.random() * foes.length)] : null;
      let at;
      if (t) at = V(t.pos.x, t.pos.y + 0.2, t.pos.z);
      else { const a = rnd(0, TAU), r = Math.sqrt(Math.random()) * R; at = V(o.x + Math.cos(a) * r, 0, o.z + Math.sin(a) * r); at.y = terrainH(at.x, at.z); }
      this.strike(at);
    }
    this.innerT -= dt;
    if (this.innerT <= 0) { this.innerT = 0.12; this.innerBolt(0.6); }
    // la lluvia apaga el fuego de la zona
    this.douseT -= dt;
    if (this.douseT <= 0) { this.douseT = 0.4; this.doused += douseFires(this.g, o.x, o.z, R); }
  }
}

/* ======================================================================
   DONA — GRIETAS CARMESÍ (Luna de Sangre, fase de carga)
   Mancha plana en el suelo con un dibujo de grietas ramificadas; un sombreador las va revelando desde el centro
   (uReveal 0 → 1) y hace latir la energía roja que sale de ellas. Devuelve también puntos sobre las grietas
   para que broten partículas de ellas.
   ====================================================================== */
let _crackTex = null, _crackPts = null;
function crackTexture() {
  if (_crackTex) return _crackTex;
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  _crackPts = [];
  const branch = (x, y, a, len, w, depth) => {
    let cx = x, cy = y;
    const steps = Math.round(len / 10);
    for (let i = 0; i < steps; i++) {
      a += rnd(-0.45, 0.45);
      const nx = cx + Math.cos(a) * 10, ny = cy + Math.sin(a) * 10;
      g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, w * (1 - i / steps * 0.7)); g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(nx, ny); g.stroke();
      if (i % 3 === 0) _crackPts.push([(nx / S - 0.5) * 2, (ny / S - 0.5) * 2]);
      if (depth < 3 && Math.random() < 0.13) branch(nx, ny, a + (Math.random() < 0.5 ? 1 : -1) * rnd(0.5, 1.1), len * rnd(0.3, 0.55), w * 0.6, depth + 1);
      cx = nx; cy = ny;
      if (Math.hypot(cx - S / 2, cy - S / 2) > S * 0.48) break;
    }
  };
  for (let i = 0; i < 9; i++) branch(S / 2, S / 2, (i / 9) * TAU + rnd(-0.2, 0.2), S * rnd(0.4, 0.5), 7, 0);
  _crackTex = new THREE.CanvasTexture(c);
  return _crackTex;
}
export function crackDecal(radius) {
  const tex = crackTexture();
  const U = { uMap: { value: tex }, uReveal: { value: 0 }, uT: { value: 0 }, uOp: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uReveal; uniform float uT; uniform float uOp; varying vec2 vUv;
      void main(){
        float c = texture2D(uMap, vUv).r;
        float d = length(vUv - 0.5) * 2.0;
        float shown = smoothstep(uReveal + 0.03, uReveal - 0.05, d);        // se extiende desde el centro
        float front = smoothstep(0.12, 0.0, abs(d - uReveal)) * step(d, uReveal + 0.03);
        float pulse = 0.7 + 0.3 * sin(uT * 9.0 - d * 14.0);
        vec3 col = mix(vec3(0.35, 0.0, 0.02), vec3(1.0, 0.18, 0.1), c) * (pulse + front * 1.5);
        float a = c * shown * (0.75 + 0.25 * pulse) + front * c;
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uOp);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -4,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 3;
  m.userData.own = true;
  return { m, U, mat, pts: _crackPts, radius, dispose() { m.geometry.dispose(); mat.dispose(); } };
}

export const POWER3_CLASSES = { overload: OverloadShieldSkill, estorm: ElectricStormSkill };
