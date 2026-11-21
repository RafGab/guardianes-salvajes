import * as THREE from 'three';
import { rnd, TAU } from './attack.js';
import { Skill, ease, lerp, clamp, V, boneWorld } from './base.js';
import { terrainH } from '../terrain.js';
import { ui } from '../ui.js';
import { douseFires } from './envreact.js';

/* ======================================================================
   PODERES NUEVOS (actualización de habilidades)
   · ÁMBAR — Aegis del Trueno (escudo): arco semicircular de energía eléctrica delante de ella.
   · ÁMBAR — Tormenta Eléctrica (botón 2): nube negra que se carga y descarga lluvia y rayos (apaga el fuego).
   · DONA — grietas carmesí de la Luna de Sangre (crackDecal, la usa BloodMoonSkill en powers.js).
   ====================================================================== */

/* ---------- AEGIS DEL TRUENO: arco semicircular de energía (barrera frontal) ----------
   Superficie curva que rodea el frente de Ámbar (arcDeg grados) y cuya silueta, vista de frente, es un ARCO:
   alta en el centro y bajando hasta el suelo en los extremos. Espacio local: +Z = delante, Y = arriba, radio 1,
   altura 1 (se escala en place()). uGrow (0..1) la forma desde los extremos hacia el centro; uBreak (0..1) la
   rompe en fragmentos al final; uHitP / uHitT dibujan la onda eléctrica desde el punto de impacto. */
const ARC_U = 28, ARC_V = 12;
// altura relativa del borde en el punto u (-1..1): vista de frente la silueta es un SEMICÍRCULO exacto
const arcTop = (u, half) => { const x = Math.sin(u * half) / Math.sin(half); return Math.sqrt(Math.max(0, 1 - x * x)); };
let _arcGeo = null, _arcHalf = 0;
function arcGeometry(halfRad) {
  if (_arcGeo && _arcHalf === halfRad) return _arcGeo;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= ARC_V; j++) for (let i = 0; i <= ARC_U; i++) {
    const u = i / ARC_U * 2 - 1, v = j / ARC_V, th = u * halfRad, top = arcTop(u, halfRad);
    pos.push(Math.sin(th), v * top, Math.cos(th));
    uv.push(i / ARC_U, v);
  }
  for (let j = 0; j < ARC_V; j++) for (let i = 0; i < ARC_U; i++) { const a = j * (ARC_U + 1) + i, b = a + 1, c = a + ARC_U + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  _arcGeo = g; _arcHalf = halfRad;
  return g;
}
function aegisArc(halfRad) {
  const U = { uT: { value: 0 }, uK: { value: 0 }, uGrow: { value: 0 }, uBreak: { value: 0 }, uHit: { value: 0 }, uHitT: { value: 0 }, uHitP: { value: new THREE.Vector2(0.5, 0.5) } };
  const mat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: `uniform float uT; uniform float uBreak; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vUv = uv; vec3 p = position;
        // distorsión muy sutil: el aire cargado hace temblar la superficie
        p += normal * (sin(uv.x * 40.0 + uT * 9.0) * sin(uv.y * 23.0 - uT * 7.0) * 0.012 + uBreak * 0.25 * uv.y);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uT; uniform float uK; uniform float uGrow; uniform float uBreak; uniform float uHit; uniform float uHitT; uniform vec2 uHitP;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        float x = vUv.x * 2.0 - 1.0, y = vUv.y;
        // se forma desde los extremos (donde nacen los arcos) hacia el centro
        float grow = smoothstep(1.0 - uGrow * 1.08, 1.06 - uGrow * 1.08, 1.0 - abs(x));
        // filamentos eléctricos entrelazados que recorren la superficie (dos familias en diagonales opuestas)
        float f1 = abs(n(vec2(vUv.x * 14.0 + y * 3.0 + uT * 2.2, y * 4.0 - uT * 1.6)) - 0.5);
        float f2 = abs(n(vec2(vUv.x * 10.0 - y * 4.0 - uT * 1.7, y * 5.0 + uT * 2.3) + 7.3) - 0.5);
        float fil = smoothstep(0.045, 0.0, f1) + smoothstep(0.04, 0.0, f2) * 0.8;
        // borde superior del arco y extremos: conexiones más intensas
        float rim = smoothstep(0.86, 1.0, y) * 2.2 + smoothstep(0.8, 1.0, abs(x)) * (1.0 - y) * 1.6;
        float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float flick = 0.85 + 0.15 * sin(uT * 23.0) * sin(uT * 13.0);         // varía la intensidad sin parpadeos fuertes
        // ONDA ELÉCTRICA desde el punto de impacto (anillo que se expande por el arco)
        float dh = distance(vec2(vUv.x * 2.6, y), vec2(uHitP.x * 2.6, uHitP.y));
        float wave = uHit * smoothstep(0.09, 0.0, abs(dh - uHitT * 1.6)) * (1.0 - uHitT);
        // al desaparecer, el arco se rompe en fragmentos que se apagan
        float brk = 1.0 - smoothstep(uBreak - 0.12, uBreak, n(vec2(vUv.x * 9.0, y * 6.0)) * 0.9 + 0.05);
        // azul eléctrico intenso de fondo, azul celeste en los filamentos y destellos blancos (mezcla normal: el
        // color no se tiñe con el escenario de detrás)
        vec3 deep = vec3(0.05, 0.3, 1.0), sky = vec3(0.4, 0.78, 1.0), white = vec3(1.0);
        float hot = clamp(fil * 0.5 + rim * 0.55 + wave * 1.2, 0.0, 1.0);
        vec3 col = mix(mix(deep, sky, clamp(fil, 0.0, 1.0)), white, hot * 0.75) * 1.25;
        float a = (0.1 + fr * 0.2 + fil * 0.55 + rim * 0.45 + wave) * flick * grow * uK;
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.92) * (uBreak > 0.0 ? brk : 1.0));
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const m = new THREE.Mesh(arcGeometry(halfRad), mat);
  m.renderOrder = 6;
  return { m, U, mat };
}

/* ======================================================================
   ÁMBAR — AEGIS DEL TRUENO (escudo, botón 3)
   ACTIVACIÓN · abre las alas con fuerza, la corriente recorre sus plumas, pequeño impulso del cuerpo y, delante de
   ella, varios arcos eléctricos que salen de las alas se conectan hasta formar la barrera (de los extremos al centro).
   MANTENIMIENTO · arco semicircular FRONTAL (no una esfera) que la sigue y mira hacia donde mira ella: filamentos en
   movimiento, intensidad que varía un poco, descargas entre segmentos, núcleos de luz en los puntos de conexión y
   extremos más intensos; luz dinámica azul. Ámbar sigue moviéndose con una postura de guardia natural.
   BLOQUEO · los proyectiles que tocan la superficie se destruyen: onda eléctrica circular desde el punto de impacto,
   rayos que recorren el arco y chispas hacia fuera. Los golpes cuerpo a cuerpo también disparan la onda y una
   descarga contra el atacante (la protección total del botón de escudo, 4 s, se mantiene como en todos los escudos).
   DESAPARICIÓN · los arcos se separan y se deshacen en partículas azules y blancas; la electricidad vuelve a las alas.
   ====================================================================== */
export class OverloadShieldSkill extends Skill {
  begin() { this.start(); return true; }
  build() {
    const d = this.def, pose = this.pose;
    return [
      { name: 'activacion', dur: d.prep, enter: this.enterCharge, tick: this.tickCharge },
      { name: 'escudo', dur: d.exec, enter: () => { this.formed = true; }, tick: this.tickShield },
      { name: 'desaparicion', dur: d.recover, enter: this.enterFade, tick: this.tickFade },
    ];
  }
  // geometría del arco en el mundo
  get arcR() { return this.def.arcR * (this.p.H / 1.9); }
  get arcH() { return this.def.arcH * this.p.H; }
  // punto del arco (u = -1..1 a lo largo, v = 0..1 de altura) en el mundo
  arcPoint(u, v) {
    const p = this.p, th = u * this.half, R = this.arcR, top = arcTop(u, this.half), f = this.yaw;
    const lx = Math.sin(th) * R, lz = Math.cos(th) * R, cs = Math.cos(f), sn = Math.sin(f);
    return V(p.pos.x + lx * cs + lz * sn, p.pos.y + 0.05 + v * top * this.arcH, p.pos.z - lx * sn + lz * cs);
  }
  wingTips() {
    const out = [];
    for (const n of ['wing_L_3', 'wing_R_3', 'wing_L_2', 'wing_R_2']) { const w = boneWorld(this, n); if (w) out.push(w); if (out.length === 2) break; }
    if (out.length < 2) { const c = this.center(0.7), f = this.fwd; out.length = 0; out.push(V(c.x - f.z * 0.6, c.y, c.z + f.x * 0.6), V(c.x + f.z * 0.6, c.y, c.z - f.x * 0.6)); }
    return out;
  }
  enterCharge() {
    const d = this.def;
    this.half = (d.arcDeg / 2) * Math.PI / 180;
    this.yaw = this.p.facing;
    this.sh = aegisArc(this.half);
    this.prop(this.sh.m);
    this.light = new THREE.PointLight(0x6ab4ff, 0, 7, 1.8);
    this.prop(this.light);
    this.zapT = 0; this.arcT = 0; this.hitK = 0; this.wingK = 0; this.formed = false;
    this.sfx('crack');
    this.p.elecGuard = { hit: (from) => this.burst(from, 1) };
    // ALAS: se abren con fuerza (activación), guardia natural con las alas algo adelantadas (mantenimiento) y se
    // recogen al final (la electricidad vuelve a ellas)
    this.setBones((B, dt, t, fx) => {
      const k = this.wingK || 0, flut = Math.sin(t * 30) * 0.03 * k;
      for (const [S, sg] of [['L', 1], ['R', -1]]) {
        for (let i = 1; i <= 4; i++) { const b = B[`wing_${S}_${i}`]; if (!b) continue; fx.rot(b, 0, 0, 1, sg * (0.55 * k + flut) * (i === 1 ? 1 : 0.4)); fx.rot(b, 0, 1, 0, -sg * 0.35 * k * (i === 1 ? 1 : 0.5)); }
      }
      if (B.chest) fx.rot(B.chest, 1, 0, 0, -0.1 * k); // pecho abierto: postura de guardia
    });
  }
  tickCharge(dt, k) {
    const p = this.p, pose = this.pose;
    // alas que se abren con un movimiento potente (sobrepasa un poco y se asienta) + pequeño impulso del cuerpo
    this.wingK = k < 0.55 ? ease(k / 0.55) * 1.15 : lerp(1.15, 1, ease((k - 0.55) / 0.45));
    pose.sy = 1 + 0.06 * Math.sin(Math.min(1, k * 1.6) * Math.PI); pose.rx = -0.12 * Math.sin(k * Math.PI);
    this.place(k > 0.3 ? ease((k - 0.3) / 0.7) : 0, dt);
    this.sh.U.uGrow.value = k > 0.3 ? ease((k - 0.3) / 0.7) : 0;
    // la corriente recorre sus plumas
    const W = this.wingTips(), c = this.center(0.7);
    if (Math.random() < 0.8) for (const w of W) this.vfx.bolt(c, w, { color: Math.random() < 0.5 ? 0x5aa8ff : 0xcfeaff, life: 0.06, jag: 0.12, segs: 6 });
    // varios arcos salen de las alas y se conectan delante, de los extremos hacia el centro, hasta cerrar la barrera
    if (k > 0.3) {
      const g = ease((k - 0.3) / 0.7);
      for (const [i, w] of W.entries()) { const u = (i ? 1 : -1) * (1 - g); if (Math.random() < 0.7) this.vfx.bolt(w, this.arcPoint(u, rnd(0.4, 1)), { color: 0x9fd0ff, life: 0.07, jag: 0.25, segs: 8 }); }
    }
  }
  enterFade() {
    this.formed = false;
    this.sfx('crack');
    if (this.p.elecGuard) this.p.elecGuard = null;
  }
  tickFade(dt, k) {
    // los arcos se separan y se deshacen en partículas azules y blancas; la energía vuelve a las alas
    this.sh.U.uBreak.value = ease(k);
    this.place(1 - k * k, dt);
    this.wingK = 1 - ease(k);
    const W = this.wingTips(), fx = this.g.fx;
    for (let i = 0; i < 3; i++) {
      const q = this.arcPoint(rnd(-1, 1), rnd(0.1, 1)), w = W[i % W.length], s = 2.2;
      fx.spark.emit(q.x, q.y, q.z, (w.x - q.x) * s, (w.y - q.y) * s, (w.z - q.z) * s, rnd(0.3, 0.45), 0.06, 0.02, Math.random() < 0.5 ? 0xffffff : 0x9fd0ff, 0x3a8cff, 0.9, 0, 0, 1);
    }
    if (Math.random() < 0.5 * (1 - k)) { const w = W[Math.random() < 0.5 ? 0 : 1]; this.vfx.bolt(this.arcPoint(rnd(-1, 1), rnd(0.3, 1)), w, { color: 0x9fd0ff, life: 0.06, jag: 0.2, segs: 6 }); }
  }
  cleanup() { if (this.p.elecGuard) this.p.elecGuard = null; }
  // coloca el arco delante de Ámbar: sigue su posición y gira con suavidad hacia donde mira
  place(k, dt = 1 / 60) {
    const p = this.p, S = this.sh;
    if (!S) return;
    const da = Math.atan2(Math.sin(p.facing - this.yaw), Math.cos(p.facing - this.yaw));
    this.yaw += da * Math.min(1, dt * 12);
    S.m.position.set(p.pos.x, p.pos.y + 0.05, p.pos.z);
    S.m.rotation.set(0, this.yaw, 0);
    S.m.scale.set(this.arcR, this.arcH, this.arcR);
    S.U.uT.value = this.t; S.U.uK.value = k;
    this.hitK = Math.max(0, this.hitK - dt * 2.2);
    S.U.uHit.value = this.hitK > 0 ? 1 : 0; S.U.uHitT.value = 1 - this.hitK;
    // luz dinámica que acompaña al escudo (y destella con cada impacto)
    const c = this.arcPoint(0, 0.5);
    this.light.position.copy(c);
    this.light.intensity = k * (2.2 + 0.4 * Math.sin(this.t * 17)) + this.hitK * 6;
  }
  tickShield(dt) {
    const p = this.p, d = this.def, pose = this.pose;
    this.wingK = 1;
    this.place(1, dt);
    this.sh.U.uGrow.value = 1;
    pose.sy = 1.02 + 0.01 * Math.sin(this.t * 9); // respiración de guardia (sin quedarse rígida)
    // DESCARGAS ENTRE SEGMENTOS del arco y en los extremos (pocas: no tapan a los enemigos)
    this.arcT -= dt;
    if (this.arcT <= 0) {
      this.arcT = 0.06;
      const u = rnd(-0.95, 0.95), v = rnd(0.3, 1);
      this.vfx.bolt(this.arcPoint(u, v), this.arcPoint(clamp(u + rnd(-0.35, 0.35), -1, 1), clamp(v + rnd(-0.3, 0.3), 0.1, 1)), { color: Math.random() < 0.5 ? 0x5aa8ff : 0xdff0ff, life: 0.06, jag: 0.12, segs: 6 });
      if (Math.random() < 0.5) { const e = Math.random() < 0.5 ? -1 : 1; this.vfx.bolt(this.arcPoint(e, 0.02), this.arcPoint(e * 0.88, 0.55), { color: 0xcfeaff, life: 0.07, jag: 0.15, segs: 6 }); }
    }
    // NÚCLEOS LUMINOSOS en los puntos de conexión (extremos y cima)
    if (Math.random() < 0.4) for (const u of [-1, 0, 1]) { const q = this.arcPoint(u * 0.98, u ? 0.04 : 1); this.vfx.orb(q, { r: 0.06 + 0.03 * Math.random(), color: 0xbfe4ff, opacity: 0.4, life: 0.08 }); }
    this.blockProjectiles();
    // chispazos a los enemigos que se acercan por delante
    this.zapT -= dt;
    if (this.zapT <= 0) {
      this.zapT = 0.45;
      for (const t of this.combat.inCircle(p.pos.x, p.pos.z, d.radius)) {
        if (!this.inFront(t.pos.x, t.pos.z)) continue;
        this.vfx.bolt(this.arcPoint(this.uOf(t.pos.x, t.pos.z), 0.5), V(t.pos.x, t.pos.y + 0.7, t.pos.z), { color: 0x6ab4ff, life: 0.1, jag: 0.35, segs: 9 });
        this.hit(t, d.damage);
        const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z);
        this.combat.push(t, dx, dz, d.push);
      }
    }
  }
  // ¿está el punto dentro del ángulo que cubre el arco? y su posición a lo largo del arco (-1..1)
  angleOf(x, z) { const a = Math.atan2(x - this.p.pos.x, z - this.p.pos.z); return Math.atan2(Math.sin(a - this.yaw), Math.cos(a - this.yaw)); }
  inFront(x, z) { return Math.abs(this.angleOf(x, z)) <= this.half; }
  uOf(x, z) { return clamp(this.angleOf(x, z) / this.half, -1, 1); }
  // PROYECTILES: los que tocan la superficie del arco se destruyen y hacen saltar la onda desde ese punto
  blockProjectiles() {
    const p = this.p, R = this.arcR, list = this.combat.projectiles || [];
    for (const pr of list) {
      if (pr.dead || pr.owner !== 'boss') continue;
      const dx = pr.pos.x - p.pos.x, dz = pr.pos.z - p.pos.z, dist = Math.hypot(dx, dz);
      if (Math.abs(dist - R) > pr.radius + 0.45 || !this.inFront(pr.pos.x, pr.pos.z)) continue;
      const u = this.uOf(pr.pos.x, pr.pos.z), top = arcTop(u, this.half) * this.arcH, hy = pr.pos.y - p.pos.y;
      if (hy < -0.2 || hy > top + pr.radius) continue;
      this.combat.killProjectile(pr);
      this.impact(u, clamp(hy / Math.max(0.1, top), 0, 1), 0.7);
      this.sfx('crack');
      if (this.g.floatAt) this.g.floatAt(p.pos, p.H + 0.4, '🛡️ ¡BLOQUEADO!', 'block');
    }
  }
  // impacto en el arco: onda circular desde el punto, rayos que recorren el arco y chispas hacia fuera
  impact(u, v, k = 1) {
    const S = this.sh; if (!S) return;
    this.hitK = 1;
    S.U.uHitP.value.set((u + 1) / 2, v);
    const q = this.arcPoint(u, v), p = this.p, out = V(q.x - p.pos.x, 0, q.z - p.pos.z).normalize();
    for (let i = 0; i < 4; i++) { const u2 = clamp(u + rnd(-0.7, 0.7), -1, 1); this.vfx.bolt(q, this.arcPoint(u2, clamp(v + rnd(-0.4, 0.4), 0.05, 1)), { color: i % 2 ? 0x5aa8ff : 0xffffff, life: 0.1, jag: 0.25, segs: 8 }); }
    for (let i = 0; i < 8; i++) this.g.fx.spark.emit(q.x, q.y, q.z, out.x * rnd(2, 4) + rnd(-1, 1), rnd(-0.5, 2), out.z * rnd(2, 4) + rnd(-1, 1), rnd(0.2, 0.35), 0.05, 0.015, 0xffffff, 0x4a9cff, 0.9, 0, -2, 1);
    this.vfx.orb(q, { r: 0.16 * k, color: 0xbfe4ff, opacity: 0.45, life: 0.1 });
    this.shake(0.05 * k);
  }
  // golpe recibido (escudo del botón): la onda nace en el punto del arco que mira al atacante y una descarga le responde
  burst(from, k = 1) {
    const p = this.p;
    if (!this.sh) return;
    const u = from ? this.uOf(from.x, from.z) : 0;
    this.impact(u, 0.5, k);
    this.g.fx.sparkle(p.pos.x, p.pos.y + p.H * 0.6, p.pos.z, 0xcfeaff, 2);
    if (from) {
      this.sfx('crack');
      const q = this.arcPoint(u, 0.5);
      this.vfx.bolt(q, V(from.x, (from.y ?? p.pos.y) + 0.7, from.z), { color: 0xcfe6ff, life: 0.12, jag: 0.4, segs: 10 });
      for (const t of this.combat.inCircle(from.x, from.z, 2.5)) { this.hit(t, this.def.damage * 2); const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z); this.combat.push(t, dx, dz, this.def.push * 1.5); }
    }
  }
}

/* ======================================================================
   ÁMBAR — TORMENTA ELÉCTRICA (botón 2, poder)
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
