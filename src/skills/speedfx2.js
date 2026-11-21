import * as THREE from 'three';
import { rnd, TAU } from './attack.js';
import { clamp, lerp, V, boneWorld } from './base.js';
import { Trail } from '../weapons/system.js';
import { cometDisc, speedLines } from './magicfx.js';

// MEJORAS DEL BOTÓN DE VELOCIDAD (se instalan sobre SpeedFxSkill, en powers2.js):
//  · KAIRO — carrera de FUEGO tipo cometa: llamas en los pies, estela de fuego dinámica y chispas, todo por debajo
//    y por detrás (sin resplandor que tape al personaje)
//  · KIRA — brazos de patinadora (equilibrio, compensación en las curvas, codos flexionados), sobre su animación de patinaje
//  · BADA — cuerpo de arena viva: granos que se desprenden y se recomponen, y textura granulada mientras corre
//    (se conserva el remolino de arena de los pies)
//  · ÁMBAR — transformación en tornado eléctrico (alas, bandas de viento, base de turbulencia, estela y disipación)
//  · NILO — skyboard: burbujas con reflejos e irisaciones, de tamaños y trayectorias variadas, y estela de energía bajo las botas
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const FOOT = ['foot_L', 'foot_R'];
const _qI = new THREE.Quaternion(); // giro neutro (reposo de los huesos: el rig no tiene giro de reposo)

// pies del héroe (huesos) o, si el modelo no los tiene, un punto a cada lado
function feetPos(sk) {
  const p = sk.p;
  return FOOT.map((n, i) => {
    const b = boneWorld(sk, n);
    if (b) return b;
    const s = i ? -0.14 : 0.14;
    return V(p.pos.x + Math.cos(p.facing) * s, p.pos.y + (p.pose.dy || 0) + 0.06, p.pos.z - Math.sin(p.facing) * s);
  });
}
// añade un punto a una estela sin que se estire: si el pie salta lejos (teletransporte, caída) la estela empieza de nuevo
function tpush(tr, sk, a, b) {
  if (a.distanceTo(sk.p.pos) > 2.5) return;
  const last = tr.pts[0];
  if (last && last[0].distanceTo(a) > 1.2) tr.pts.length = 0;
  tr.push(a, b);
}
function trails(sk, key, c1, c2, n, gain) {
  if (!sk[key]) { sk[key] = [0, 1].map(() => new Trail(sk.g.scene, c1, c2, n, gain)); (sk._trails || (sk._trails = [])).push(...sk[key]); }
  return sk[key];
}

/* ---------- material con textura de arena (granos que fluyen hacia atrás); no cambia la forma ni los colores base ---------- */
export function sandMaterial(src, U) {
  const m = src.clone();
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSOP; varying float vSWY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSOP = position;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvSWY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uSand; uniform float uST; uniform float uSNS; varying vec3 vSOP;
        uniform float uLvl; uniform float uFeet; uniform float uHt; varying float vSWY;
        float sH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 sp = vSOP * uSNS;
        float grain = sH(floor(sp * 22.0));                                         // granos finos
        float flow = 0.5 + 0.5 * sin(sp.z * 9.0 + sp.y * 5.0 + uST * 7.0);          // ondas de arena que recorren el cuerpo
        float k = uSand * (0.55 + 0.45 * flow);
        vec3 sand = mix(vec3(0.86, 0.7, 0.45), vec3(0.72, 0.55, 0.32), grain);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * (0.82 + 0.36 * grain), 0.6 * uSand); // textura granulada
        diffuseColor.rgb = mix(diffuseColor.rgb, sand * (0.6 + 0.6 * dot(diffuseColor.rgb, vec3(0.33))), 0.28 * k);
        // RELOJ DE ARENA: lo que queda por encima del nivel de arena se ha deshecho en granos (borde granulado, no liso)
        if (uLvl < 0.999) {
          float hh = (vSWY - uFeet) / max(0.01, uHt);
          float edge = uLvl * 1.12 - hh - sH(floor(sp * 30.0)) * 0.07;
          if (edge < 0.0) discard;
          float band = 1.0 - smoothstep(0.0, 0.05, edge);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.76, 0.5), band * 0.85);
        }`);
  };
  m.customProgramCacheKey = () => 'sandbody-' + (src.customProgramCacheKey ? src.customProgramCacheKey() : src.type);
  m.userData.own = true;
  return m;
}

export const SPEED2 = {
  // ---------------- KAIRO: CARRERA SUPERSÓNICA CON DOS COMETAS DE FUEGO ----------------
  // Exactamente DOS cometas de fuego, uno bajo cada zapatilla, que siguen cada uno a su pie (huesos foot_L / foot_R):
  // brasa ardiente naranja con núcleo amarillo, llamas bajas que salen de los pies y se quedan atrás, estela de fuego
  // propia de cada pie (nunca unidas) y chispas/brasas hacia atrás. Al apoyar un pie, su cometa destella y suelta
  // una pequeña explosión de chispas. Las llamas son cortas y van hacia atrás: el cuerpo se ve siempre entero.
  // Zancadas mucho más rápidas, líneas de velocidad en los bordes de la pantalla. El cuerpo se ve siempre entero.
  kairo(dt, k, bx, bz, sp) {
    const pose = this.pose, p = this.p, fx = this.g.fx;
    const on = this.active ? 1 : 0;
    pose.rx = Math.max(pose.rx, 0.1 + 0.22 * k * k); // se inclina con la velocidad, pero se le ve bien el cuerpo
    // ZANCADAS RAPIDÍSIMAS: el ciclo de carrera va más deprisa que su velocidad (piernas a ritmo supersónico)
    this.kAnim = damp(this.kAnim || 1, on ? 1.45 : 1, on ? 6 : 4, dt);
    p.animMul = this.kAnim;
    const feet = feetPos(this);
    const tr = trails(this, '_cometTr', 0xff3a08, 0xffb020, 22, 0.34);
    const C = this._comets || (this._comets = [0, 1].map(() => ({ d: cometDisc(this.g.scene, { disc: 0xff6a14, core: 0xffe08a, ring: 0xff8a20 }), flash: 0, prevY: null, k: 0 })));
    const gy0 = p.pos.y;
    this.burstCd = (this.burstCd ?? 0.4) - dt;
    this.burstGlow = Math.max(0, (this.burstGlow || 0) - dt * 2.2);
    // CHORRO DE COMBUSTIÓN continuo en la parte baja de la espalda (siempre por detrás: nunca tapa el cuerpo)
    if (on && sp > 3) {
      const bkX = p.pos.x + bx * p.R * 0.9, bkZ = p.pos.z + bz * p.R * 0.9, bkY = gy0 + p.H * 0.38;
      const nj = 1 + Math.round(2 * k + 3 * this.burstGlow);
      for (let j = 0; j < nj; j++) fx.fire.emit(bkX + rnd(-0.06, 0.06), bkY + rnd(-0.06, 0.06), bkZ + rnd(-0.06, 0.06), bx * rnd(3, 6) * (0.6 + k), rnd(-0.2, 0.5), bz * rnd(3, 6) * (0.6 + k), rnd(0.18, 0.3), rnd(0.18, 0.3) * (1 + this.burstGlow), 0.04, 0xffe080, 0xff3000, 0.85, 0, 0, 1.5);
      if (Math.random() < 0.4 + 0.5 * k) fx.spark.emit(bkX, bkY, bkZ, bx * rnd(4, 8), rnd(0, 1.2), bz * rnd(4, 8), rnd(0.2, 0.4), 0.06, 0.01, 0xfff0b0, 0xff5a10, 0.95, 0, 3, 2);
    }
    feet.forEach((f, i) => {
      const c = C[i];
      c.k = damp(c.k, on && sp > 1 ? Math.min(1, 0.5 + 0.6 * k) : 0, 10, dt);
      const lift = Math.max(0, f.y - gy0); // altura del pie sobre el suelo
      // APOYO: el pie baja y toca el suelo → destello intenso y explosión de chispas
      if (c.prevY !== null && on && lift < 0.1 && c.prevY >= 0.1) {
        c.flash = 1;
        // CARRERA DE COMBUSTIÓN: a gran velocidad, cada pocas zancadas el apoyo del pie dispara una explosión de
        // propulsión por detrás que lo lanza hacia delante (sincronizada con la pisada, no es un efecto suelto)
        if (this.burstCd <= 0 && sp > 4 && k > 0.35) this.kairoBurst(bx, bz, k);
        for (let j = 0; j < 7; j++) { const a = rnd(0, TAU), v = rnd(1.5, 3.5); fx.spark.emit(f.x, gy0 + 0.05, f.z, Math.cos(a) * v + bx * 2, rnd(0.6, 2), Math.sin(a) * v + bz * 2, rnd(0.18, 0.35), 0.07, 0.015, 0xfff0b0, 0xff4a10, 1, 0, 6, 1); }
        if (this.vfx.ring) this.vfx.ring(f.x, gy0 + 0.04, f.z, { r0: 0.1, r1: 0.7, dur: 0.18, color: 0xff8a20, opacity: 0.8 });
      }
      c.prevY = lift;
      c.flash = Math.max(0, c.flash - dt * 7);
      // el cometa va pegado a la suela (sigue el pie cuando se levanta)
      const pos = V(f.x + bx * 0.04, Math.min(f.y, gy0 + 0.9) - 0.03, f.z + bz * 0.04);
      c.d.set(pos, c.k, c.flash, this.t);
      // estela luminosa de ESE pie (cada pie la suya)
      tpush(tr[i], this, V(pos.x + bx * 0.05, pos.y + 0.01, pos.z + bz * 0.05), V(pos.x + bx * 0.08, pos.y + 0.12 + 0.05 * k, pos.z + bz * 0.08));
      tr[i].update(dt, on && sp > 1.5);
      if (!on || c.k < 0.05) return;
      // LLAMAS en el pie: lenguas de fuego cortas y bajas que se quedan atrás (cola del cometa), nunca suben por el cuerpo
      const nf = 2 + Math.round(2 * k);
      for (let j = 0; j < nf; j++) fx.fire.emit(pos.x + rnd(-0.07, 0.07), pos.y + 0.03, pos.z + rnd(-0.07, 0.07), bx * rnd(1.5, 3.5) * (0.5 + k), rnd(0.25, 0.8), bz * rnd(1.5, 3.5) * (0.5 + k), rnd(0.2, 0.34), rnd(0.22, 0.32), 0.04, 0xffd060, 0xff2a00, 0.9, 0, 0, 1.5);
      // chispas y brasas que salen disparadas hacia atrás
      const n = 1 + Math.round(2 * k);
      for (let j = 0; j < n; j++) fx.spark.emit(pos.x + rnd(-0.05, 0.05), pos.y + 0.02, pos.z + rnd(-0.05, 0.05), bx * rnd(3, 6) * (0.5 + k), rnd(0.2, 1), bz * rnd(3, 6) * (0.5 + k), rnd(0.15, 0.3), 0.06, 0.01, 0xfff0b0, 0xff4a10, 0.95, 0, 3, 2);
    });
    // líneas de velocidad (y sensación de desenfoque en los bordes) según lo rápido que va
    speedLines(on ? clamp((sp - 3) / 9, 0, 1) : 0);
  },

  // explosión de propulsión flamígera por detrás de Kairo: bola de fuego, onda, chispas, humo y empujón real
  kairoBurst(bx, bz, k) {
    const p = this.p, fx = this.g.fx, gy = p.pos.y;
    this.burstCd = 0.75 - 0.3 * k;     // cada vez más seguidas cuanto más rápido va
    this.burstGlow = 1;
    // la explosión nace DETRÁS de Kairo y sale hacia atrás: nunca tapa su cuerpo
    const x = p.pos.x + bx * p.R * 1.8, z = p.pos.z + bz * p.R * 1.8, y = gy + p.H * 0.3;
    // bola de fuego que se expande hacia atrás (cono de llamas)
    for (let j = 0; j < 22; j++) {
      const a = rnd(0, TAU), sp = rnd(0.5, 2.2);
      fx.fire.emit(x, y, z, bx * rnd(6, 11) + Math.cos(a) * sp, rnd(0.2, 1.6), bz * rnd(6, 11) + Math.sin(a) * sp, rnd(0.22, 0.4), rnd(0.25, 0.42), 0.05, 0xfff0a0, 0xff2a00, 0.95, 0, 0, 1.5);
    }
    for (let j = 0; j < 16; j++) { const a = rnd(0, TAU), v = rnd(2, 6); fx.spark.emit(x, y, z, bx * rnd(6, 11) + Math.cos(a) * v * 0.4, rnd(0.5, 3.5), bz * rnd(6, 11) + Math.sin(a) * v * 0.4, rnd(0.25, 0.5), 0.07, 0.015, 0xfff4c0, 0xff4a10, 1, 0, 6, 1); }
    for (let j = 0; j < 4; j++) fx.dust.emit(x + bx * 0.6, y, z + bz * 0.6, bx * rnd(1, 2.5), rnd(0.4, 1.2), bz * rnd(1, 2.5), rnd(0.6, 1.0), 0.3, 0.9, 0x5a4a42, 0x2a2420, 0.45, 0, 0, 1);
    if (this.vfx.ring) this.vfx.ring(x + bx * 0.6, gy + 0.05, z + bz * 0.6, { r0: 0.2, r1: 1.6 + k, dur: 0.28, color: 0xff7a20, opacity: 0.85 });
    // EMPUJÓN hacia delante: la explosión lo impulsa de verdad (luego vuelve a su velocidad de carrera)
    const f = 4 + 4 * k;
    p.vx -= bx * f; p.vz -= bz * f;
    this.g.chase.shake(0.04 + 0.04 * k);
    if (this.sfx) this.sfx('land');
  },

  // ---------------- KIRA: BRAZOS DE PATINADORA ----------------
  // capa encima de su patinaje (corriente de nieve): no la sustituye
  kyraArms(dt, k, sp) {
    const S = this.skA || (this.skA = { ph: 0, open: 0, carve: 0 });
    const on = this.active ? 1 : 0;
    S.open = damp(S.open, on * Math.min(1, 0.45 + 0.6 * k), on ? 4 : 3, dt); // los brazos se abren poco a poco y vuelven solos
    S.ph += dt * (2.2 + Math.min(10, sp) * 0.28);                              // ritmo de los empujes de patinaje
    S.carve = damp(S.carve, this.carve || 0, 6, dt);
    if (!this._skBones) {
      this._skBones = true;
      this.setBones((B, dt2, t, fx) => {
        const o = S.open;
        if (o < 0.01) return;
        const ph = S.ph, sw = Math.sin(ph), sw2 = Math.sin(ph * 2 + 0.6), c = S.carve;
        for (const side of ['L', 'R']) {
          const sg = side === 'L' ? 1 : -1;
          const alt = sw * sg;                         // brazos alternos (como el empuje de cada pierna)
          const outer = clamp(-c * sg * 1.6, -0.5, 0.5); // en las curvas, el brazo exterior sube para equilibrar
          fx.rot(B[`upper_arm_${side}`], 0, 0, 1, sg * o * (0.55 + 0.12 * sw2 + outer));  // abre los brazos (equilibrio)
          fx.rot(B[`upper_arm_${side}`], 1, 0, 0, o * (-0.25 - 0.32 * alt));             // vaivén delante / detrás
          fx.rot(B[`forearm_${side}`], 1, 0, 0, o * (-0.42 - 0.16 * Math.sin(ph + 0.5) * sg)); // codo ligeramente flexionado
          fx.rot(B[`hand_${side}`], 0, 0, 1, sg * o * 0.18 * Math.sin(ph + 1.1));          // las manos siguen el movimiento con retraso
        }
        fx.rot(B.spine || B.spine_1, 0, 1, 0, o * 0.14 * sw);  // los hombros acompañan cada empuje
        fx.rot(B.spine || B.spine_1, 0, 0, 1, o * (0.05 * sw2 - c * 0.25)); // oscilación y equilibrio en las curvas
        fx.rot(B.neck || B.head, 0, 1, 0, -o * 0.08 * sw);     // la cabeza mantiene la mirada al frente
        // ZANCADAS DE PATINADORA: las piernas dejan la carrera y patinan. Postura baja con las rodillas flexionadas;
        // cada pierna empuja hacia fuera (lateral, casi estirada) mientras la otra se desliza recogida bajo el cuerpo,
        // con las cuchillas siempre paralelas al suelo. Se mezcla con la carrera según `o` (al frenar vuelve a correr).
        const lean = 0.3; // inclinación del cuerpo hacia delante (pose.rx de la carrera sobre hielo)
        for (const side of ['L', 'R']) {
          const th = B[`thigh_${side}`], sh = B[`shin_${side}`], ft = B[`foot_${side}`];
          if (!th || !sh) continue;
          if (o > 0.5) { th.quaternion.slerp(_qI, (o - 0.5) * 2); sh.quaternion.slerp(_qI, (o - 0.5) * 2); if (ft) ft.quaternion.slerp(_qI, (o - 0.5) * 2); }
          const sg = side === 'L' ? 1 : -1, push = Math.max(0, Math.sin(ph + (side === 'L' ? 0 : Math.PI)));
          const ep = push * push * (3 - 2 * push);
          const thx = o * (-0.5 * (1 - ep) + 0.12 * ep), shx = o * (0.8 * (1 - ep) + 0.15 * ep);
          fx.rot(th, 1, 0, 0, thx);                    // muslo: delante (deslizando) o algo atrás (empujando)
          fx.rot(th, 0, 0, 1, sg * o * 0.42 * ep);     // empuje hacia fuera
          fx.rot(sh, 1, 0, 0, shx);                    // rodilla flexionada al deslizar, casi estirada al empujar
          if (ft) fx.rot(ft, 1, 0, 0, -(thx + shx) + o * lean * 0.6); // la cuchilla, plana sobre el hielo
        }
      });
    }
    this.pose.rz += Math.sin(S.ph) * 0.03 * S.open; // pequeño balanceo de patinadora
  },

  // ---------------- BADA: CUERPO DE ARENA VIVA ----------------
  halley(dt, k, bx, bz, sp) {
    const pose = this.pose, p = this.p, fx = this.g.fx, on = this.active ? 1 : 0;
    pose.rx = Math.max(pose.rx, 0.3 * k); pose.spin = Math.sin(this.t * 7) * 0.4 * k; pose.rz = Math.sin(this.t * 7 + 1) * 0.12 * k;
    // remolino de arena de los pies (el de siempre)
    this.trailT -= dt;
    if (this.trailT <= 0 && sp > 2) { this.trailT = 0.14; const f = this.feet(0.6, bx, bz); this.whirls.push({ x: f.x, y: f.y, z: f.z, t: 0, life: 1.3, r: 0.7 + 0.5 * k, a: rnd(0, TAU) }); }
    // textura granulada en el cuerpo, más evidente cuanto más rápido (y desaparece poco a poco al terminar)
    const U = this.sandU || (this.sandU = this.sandBody());
    if (U) { U.uSand.value = damp(U.uSand.value, on * clamp(0.35 + 0.65 * k, 0, 1), on ? 4 : 1.4, dt); U.uST.value = this.t; } // al parar se va poco a poco (reloj de arena)
    // ARENA DELANTE Y DETRÁS: nubes de arena que la acompañan mientras corre (solo efecto visual: no cambia su física)
    if (on && sp > 1) {
      const vx = p.vx, vz = p.vz, nF = 1 + Math.round(2 * k);
      for (let i = 0; i < nF; i++) { // por delante: arena levantada que avanza con ella
        const d = rnd(0.5, 1.3), s = rnd(-0.45, 0.45);
        fx.dust.emit(p.pos.x - bx * d - bz * s, p.pos.y + rnd(0.05, 0.5), p.pos.z - bz * d + bx * s, vx * rnd(0.75, 0.95), rnd(0.2, 0.7), vz * rnd(0.75, 0.95), rnd(0.35, 0.6), 0.16, 0.5, 0xe0c080, 0xd6a84f, 0.4, 0, 0, 1);
      }
      for (let i = 0; i < nF; i++) { // por detrás: estela de arena que se queda atrás
        const d = rnd(0.4, 1.4), s = rnd(-0.5, 0.5);
        fx.dust.emit(p.pos.x + bx * d - bz * s, p.pos.y + rnd(0.05, 0.6), p.pos.z + bz * d + bx * s, vx * rnd(0.1, 0.35), rnd(0.3, 0.9), vz * rnd(0.1, 0.35), rnd(0.6, 1.0), 0.2, 0.7, 0xe0c080, 0xc89a58, 0.38, 0, 0, 1);
      }
    }
    // RELOJ DE ARENA: la arena que conserva su cuerpo ES el tiempo de carrera que le queda.
    //  · al empezar está entera; mientras corre se desmorona de arriba abajo en granos que caen (proporcional al
    //    tiempo restante: con muy poco tiempo queda casi deshecha)
    //  · al acabarse el tiempo caen los últimos granos (desaparece del todo un instante)
    //  · y se reconstruye de los pies a la cabeza con la arena que se vuelve a juntar, lista para otra carrera
    if (!U) return;
    const H = this.hg || (this.hg = { lvl: 1, ph: 'full' });
    if (on) {
      const left = clamp(p.boostT / Math.max(0.01, p.boostDur || 5), 0, 1);
      H.lvl = damp(H.lvl, 0.06 + 0.94 * left, 10, dt); H.ph = 'run';
    } else if (H.ph === 'run') H.ph = 'fall';
    if (H.ph === 'fall') { H.lvl = Math.max(0, H.lvl - dt / 0.35); if (H.lvl <= 0) { H.ph = 'build'; this.sfx && this.sfx('wind'); } }
    else if (H.ph === 'build') { H.lvl = Math.min(1, H.lvl + dt / 1.2); if (H.lvl >= 1) H.ph = 'full'; }
    U.uLvl.value = H.lvl >= 0.999 ? 1 : H.lvl;
    U.uFeet.value = p.pos.y; U.uHt.value = p.H;
    // el arma que lleva a la espalda también se deshace en arena cuando el nivel baja de su altura (y vuelve con ella)
    const WI = this.g.weapons && this.g.weapons.inst && p.model ? this.g.weapons.inst.get(p.model) : null;
    if (WI) { const show = H.lvl > 0.72; for (const pt of WI.parts) if (pt.w.group.visible !== show) { pt.w.group.visible = show; this._wHid = WI; if (!show) fx.dust.emit(p.pos.x, p.pos.y + p.H * 0.7, p.pos.z, 0, -0.3, 0, 0.6, 0.25, 0.5, 0xe0c080, 0xd0a868, 0.5, 0, 0, 1); } }
    const frontY = p.pos.y + p.H * Math.min(1, H.lvl * 1.12), R = p.R || 0.3;
    const sandCol = () => (Math.random() < 0.5 ? 0xe2bf7a : 0xc89a58);
    if (H.ph === 'run' || H.ph === 'fall') {
      // granos que se desprenden del borde de arena y caen hacia abajo como en un reloj de arena (física de caída)
      const n = H.ph === 'fall' ? 22 : Math.round(8 + 10 * k);
      for (let i = 0; i < n; i++) {
        const a = rnd(0, TAU), r = R * rnd(0.2, 0.95), y = H.ph === 'fall' ? p.pos.y + rnd(0.05, p.H * Math.max(0.05, H.lvl)) : frontY + rnd(-0.05, 0.1);
        const v = on ? rnd(0.6, 2.2) : 0.2;
        fx.water.emit(p.pos.x + Math.cos(a) * r, y, p.pos.z + Math.sin(a) * r, bx * v + Math.cos(a) * 0.2, rnd(-0.2, 0.3), bz * v + Math.sin(a) * 0.2, rnd(0.45, 0.8), rnd(0.03, 0.05), 0.012, sandCol(), 0xb8884a, 0.95, 0, 9, 0.4);
      }
      // la arena que cae forma un montoncito a sus pies que se dispersa
      if (Math.random() < 0.5) { const a = rnd(0, TAU), v = rnd(0.3, 0.9); fx.dust.emit(p.pos.x + Math.cos(a) * 0.15, p.pos.y + 0.04, p.pos.z + Math.sin(a) * 0.15, Math.cos(a) * v, 0.05, Math.sin(a) * v, rnd(0.5, 0.9), 0.12, 0.35, 0xe2bf7a, 0xd6a84f, 0.4, 0, 0, 1); }
    } else if (H.ph === 'build') {
      // la arena vuelve: granos que suben del suelo y se juntan en el borde que se va reconstruyendo
      for (let i = 0; i < 12; i++) {
        const a = rnd(0, TAU), r = rnd(0.5, 1.1), t = rnd(0.25, 0.4);
        const sx = p.pos.x + Math.cos(a) * r, sz = p.pos.z + Math.sin(a) * r, ty = frontY - p.pos.y;
        fx.water.emit(sx, p.pos.y + 0.05, sz, -Math.cos(a) * r / t, ty / t + 4.5 * t, -Math.sin(a) * r / t, t, rnd(0.03, 0.05), 0.02, sandCol(), 0xe8c88a, 0.95, 0.6, 9, 0);
      }
    }
  },

    sandBody() {
    const m = this.p.model;
    if (!m || !m.root) return null;
    const U = { uSand: { value: 0 }, uST: { value: 0 }, uSNS: { value: 4 }, uLvl: { value: 1 }, uFeet: { value: 0 }, uHt: { value: 1 } };
    const cache = new Map();
    this._sandSwaps = [];
    m.root.traverse((o) => {
      if (!o.isSkinnedMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const out = mats.map((mm) => { if (!cache.has(mm.uuid)) cache.set(mm.uuid, sandMaterial(mm, U)); return cache.get(mm.uuid); });
      this._sandSwaps.push({ o, mat: o.material });
      o.material = Array.isArray(o.material) ? out : out[0];
    });
    this._sandMats = [...cache.values()];
    if (!this._sandSwaps.length) return null;
    // escala del ruido según el tamaño del modelo
    const box = new THREE.Box3().setFromObject(m.root), h = box.max.y - box.min.y;
    U.uSNS.value = 3.5 / Math.max(0.05, h / (m.root.scale.y || 1));
    return U;
  },

  // ---------------- ÁMBAR: TORNADO ELÉCTRICO (transformación completa) ----------------
  // FASES (estado propio en this._tw; se basan en el tiempo, no en la velocidad, para que siempre sean fluidas):
  //  · TRANSFORMACIÓN (0,55 s): recoge las alas hacia el cuerpo, se encoge y empieza a girar despacio; el giro
  //    acelera y las bandas de viento nacen desde el suelo hacia arriba (el torbellino lo generan sus alas)
  //  · TORNADO: Ámbar gira rápido en el centro con las alas medio abiertas y barridas hacia atrás (forman parte
  //    del remolino); cuatro bandas de aire semitransparentes giran a distintas velocidades y sentidos, la parte de
  //    arriba se mueve de forma orgánica e irregular, base de turbulencia pegada al suelo, plumas de su color,
  //    arcos eléctricos, polvo y estela de viento detrás. El embudo se inclina hacia donde avanza.
  //  · FINAL (0,8 s): pierde intensidad, las bandas se separan y se dispersan, las partículas se apagan, el giro
  //    frena hasta mirar al frente y despliega las alas con naturalidad. Se puede seguir jugando desde el primer instante.
  // Cómodo de jugar: la cámara NO gira (solo gira el modelo), sin sacudidas continuas y con efectos transparentes
  // que dejan ver el escenario, los obstáculos y la dirección de avance.
  ambar(dt, k, bx, bz, sp) {
    const pose = this.pose, p = this.p, fx = this.g.fx, on = this.active;
    const T = this._funnel || (this._funnel = ambarFunnel(this.g.scene));
    const W = this._tw || (this._tw = { ph: 'form', t: 0, rate: 0, ang: 0, k: 0, out: 0, featherCol: ambarFeatherColor(p) });
    if (on && W.ph === 'out') { W.ph = 'tornado'; W.t = 0; } // vuelve a activarla mientras se deshacía
    if (!on && W.ph !== 'out') { W.ph = 'out'; W.t = 0; W.burst = false; }
    W.t += dt;
    const FORM = 0.55, OUT = 0.8;
    let grow, spread = 0, wingFold, wingOpen;
    if (W.ph === 'form') {
      const u = Math.min(1, W.t / FORM);
      grow = u * u * (3 - 2 * u);                         // las bandas nacen del suelo hacia arriba
      W.rate = lerp(1.5, 22, u * u);                      // el giro acelera progresivamente
      wingFold = Math.min(1, u * 2.2); wingOpen = Math.max(0, (u - 0.5) * 2) * 0.55; // primero recoge, luego abre barridas
      pose.sy = 1 - 0.08 * Math.sin(u * Math.PI);
      if (u >= 1) { W.ph = 'tornado'; W.t = 0; }
    } else if (W.ph === 'tornado') {
      grow = 1;
      W.rate = damp(W.rate, 20 + 6 * Math.min(1, k), 4, dt);
      wingFold = 1; wingOpen = 0.55;
    } else {
      const u = Math.min(1, W.t / OUT);
      grow = 1; spread = u;                               // las corrientes se separan y se dispersan
      W.rate = lerp(W.rate, 0, Math.min(1, dt * 4.5));    // el giro frena
      wingFold = 1 - u; wingOpen = 0.55 + 0.6 * Math.sin(u * Math.PI) * (1 - u * 0.4); // despliega las alas
    }
    const target = W.ph === 'out' ? 0 : W.ph === 'form' ? grow : 0.6 + 0.4 * Math.min(1, k);
    if (W.ph === 'out') { if (W.k0 == null) W.k0 = W.k; W.k = W.k0 * (1 - spread) * (1 - spread); } else { W.k0 = null; W.k = damp(W.k, target, 8, dt); }
    // GIRO DEL CUERPO (solo el modelo: la cámara no gira). Al final busca la vuelta completa más cercana: mira al frente
    W.ang += W.rate * dt;
    if (W.ph === 'out' && W.rate < 3) W.ang = damp(W.ang, Math.round(W.ang / TAU) * TAU, 6, dt);
    pose.spin = (pose.spin || 0) + W.ang;
    pose.rx = Math.max(pose.rx, 0.1 * W.k);
    pose.dy = (pose.dy || 0) + 0.14 * W.k + Math.sin(this.t * 6) * 0.04 * W.k; // flota dentro del remolino
    this.ambarWings(wingFold, wingOpen, W);
    // EMBUDO: posición, inclinación hacia la marcha (suavizada) y tamaño de la heroína
    const H = p.H * 1.6, R = p.H * 0.62;
    T.lx = damp(T.lx || 0, -bx * clamp(sp / 18, 0, 0.32), 6, dt); T.lz = damp(T.lz || 0, -bz * clamp(sp / 18, 0, 0.32), 6, dt);
    T.group.position.set(p.pos.x, p.pos.y, p.pos.z);
    T.group.rotation.set(T.lz, 0, -T.lx);
    T.group.scale.set(R, H, R);
    T.spin += dt * W.rate * 0.5;
    T.bands.forEach((b, i) => { b.rotation.y = T.spin * b.userData.sp; });
    T.base.rotation.z = -T.spin * 0.6;
    T.base.scale.setScalar(1 + spread * 0.9);
    T.U.uT.value = this.t; T.U.uK.value = W.k; T.U.uGrow.value = grow; T.U.uSpread.value = spread;
    T.group.visible = W.k > 0.01;
    if (W.ph === 'out' && W.t > OUT) { T.group.visible = false; return; }
    if (W.k < 0.02) return;
    const I = W.k * (W.ph === 'out' ? 0.6 : 1); // menos partículas al deshacerse
    // ARCOS ELÉCTRICOS que recorren el embudo (de una banda a otra) y alguno que salta al suelo
    this.boltT = (this.boltT || 0) - dt;
    if (W.ph !== 'out' && this.boltT <= 0) {
      this.boltT = 0.05 + Math.random() * 0.06;
      const ring = (u) => { const a = T.spin * (u < 0.5 ? 1 : -0.7) + rnd(0, TAU), r = R * (0.35 + 0.75 * u); return V(p.pos.x + Math.cos(a) * r, p.pos.y + H * u * grow, p.pos.z + Math.sin(a) * r); };
      const u0 = rnd(0.05, 0.8);
      this.vfx.bolt(ring(u0), ring(Math.min(1, u0 + rnd(0.15, 0.35))), { color: Math.random() < 0.5 ? 0x5ab0ff : 0xbfe4ff, life: 0.08, jag: 0.22, segs: 8 });
      if (Math.random() < 0.2) { const a = rnd(0, TAU), r = rnd(0.6, 1.6); this.vfx.bolt(ring(rnd(0.05, 0.3)), V(p.pos.x + Math.cos(a) * r, p.pos.y + 0.03, p.pos.z + Math.sin(a) * r), { color: 0x7ac4ff, life: 0.07, jag: 0.25, segs: 6 }); }
    }
    // RÁFAGAS DE VIENTO en espiral (pocas: no llenan la pantalla); al deshacerse salen despedidas hacia fuera
    const nW = Math.round(1 + 2.5 * I);
    for (let i = 0; i < nW; i++) {
      const a = rnd(0, TAU), u = rnd(0, grow), r = R * (0.4 + 0.8 * u) * (1 + spread), tg = 4 + 6 * W.k, outV = spread * 6;
      if (Math.random() < 0.5) fx.mist(p.pos.x + Math.cos(a) * r, p.pos.y + H * u, p.pos.z + Math.sin(a) * r, 0xeaf4ff, 0.3 + 0.25 * W.k);
      fx.spark.emit(p.pos.x + Math.cos(a) * r, p.pos.y + H * u, p.pos.z + Math.sin(a) * r, -Math.sin(a) * tg + Math.cos(a) * outV - bx * sp * 0.4, rnd(1, 3), Math.cos(a) * tg + Math.sin(a) * outV - bz * sp * 0.4, rnd(0.2, 0.35), 0.06, 0.02, 0xdff0ff, 0x4a9cff, 0.85, 0, -2, 1);
    }
    // PLUMAS del color de Ámbar arrastradas por el remolino (identidad del águila)
    if (Math.random() < 0.35 * I) {
      const a = rnd(0, TAU), u = rnd(0.2, 0.8) * grow, r = R * (0.5 + 0.6 * u), tg = 5 + 5 * W.k;
      fx.spark.emit(p.pos.x + Math.cos(a) * r, p.pos.y + H * u, p.pos.z + Math.sin(a) * r, -Math.sin(a) * tg - bx * sp * 0.3, rnd(0.5, 1.8), Math.cos(a) * tg - bz * sp * 0.3, rnd(0.5, 0.8), 0.09, 0.05, W.featherCol, W.featherCol, 0.9, 0, -1.5, 0);
    }
    // TURBULENCIA EN LA BASE: polvo que el remolino levanta y arrastra a ras de suelo
    if (Math.random() < 0.55 * I) { const a = rnd(0, TAU), r = rnd(0.5, 1.4) * (1 + spread); fx.dust.emit(p.pos.x + Math.cos(a) * r, p.pos.y + 0.05, p.pos.z + Math.sin(a) * r, -Math.sin(a) * 3.2 + Math.cos(a) * spread * 3, rnd(0.5, 1.4), Math.cos(a) * 3.2 + Math.sin(a) * spread * 3, rnd(0.5, 0.8), 0.18, 0.6, 0xd8d0c0, 0xb8b0a0, 0.35, 0, 0, 1); }
    // ESTELA DE VIENTO detrás del tornado: dos corrientes a los lados y anillos de aire que se quedan atrás
    const tr = trails(this, '_windTr', 0xcfe6ff, 0xffffff, 18, 0.32);
    const sx = -bz, sz = bx; // lateral
    [-1, 1].forEach((sd, i) => {
      const h = p.pos.y + H * (i ? 0.62 : 0.32) * grow, rr = R * (i ? 0.95 : 0.7) * (1 + spread * 0.5);
      tpush(tr[i], this, V(p.pos.x + sx * rr * sd, h - 0.06, p.pos.z + sz * rr * sd), V(p.pos.x + sx * rr * sd, h + 0.06, p.pos.z + sz * rr * sd));
      tr[i].update(dt, W.ph !== 'out' && sp > 2);
    });
    this.trailT -= dt;
    if (this.trailT <= 0 && sp > 3 && W.ph !== 'out') { this.trailT = 0.22; this.vfx.ring(p.pos.x + bx * 0.9, p.pos.y + 0.15, p.pos.z + bz * 0.9, { r0: 0.3, r1: 1.3 + 0.6 * k, dur: 0.35, color: 0x9fd0ff, opacity: 0.35 }); }
    if (W.ph === 'out' && !W.burst) { // al soltar el torbellino: un último anillo de aire que se abre
      W.burst = true;
      this.vfx.ring(p.pos.x, null, p.pos.z, { r0: R, r1: R * 3.2, dur: 0.6, color: 0xcfe6ff, opacity: 0.45 });
    }
  },
  // ALAS DE ÁMBAR durante el tornado: fold = recogidas hacia el cuerpo (0..1); open = abiertas y barridas hacia atrás
  ambarWings(fold, open, W) {
    const m = this.p.model;
    if (!m || !m.bones) return;
    if (!W.wings) { const L = [], R = []; for (let i = 1; i <= 12; i++) { if (m.bones['wing_L_' + i]) L.push(m.bones['wing_L_' + i]); if (m.bones['wing_R_' + i]) R.push(m.bones['wing_R_' + i]); } W.wings = { L, R }; }
    if (!W.wings.L.length) return;
    // capa de huesos propia; solo se instala si ninguna otra habilidad está moviendo los huesos en ese momento
    if (!W.fx) {
      W.fx = (bones, dt, t, tools) => {
        const f = W.fold || 0, o = W.open || 0, flut = Math.sin(t * 38) * 0.05 * o; // vibración de las plumas con el viento
        W.wings.L.forEach((b, i) => { tools.rot(b, 0, 0, 1, (-0.5 * f + 0.25 * o) * (i ? 0.5 : 1) + flut); tools.rot(b, 0, 1, 0, (0.55 * f - 0.25 * o) * (i ? 0.6 : 1)); });
        W.wings.R.forEach((b, i) => { tools.rot(b, 0, 0, 1, -((-0.5 * f + 0.25 * o) * (i ? 0.5 : 1) + flut)); tools.rot(b, 0, 1, 0, -(0.55 * f - 0.25 * o) * (i ? 0.6 : 1)); });
      };
    }
    W.fold = fold; W.open = open;
    if (!m.boneFx) m.boneFx = W.fx;
  },

  // ---------------- NILO: SKYBOARD (capa añadida a sus botas de agua) ----------------
  niloPlus(dt, k, bx, bz, sp) {
    const p = this.p, fx = this.g.fx, on = this.active ? 1 : 0, lift = this.lift || 0;
    const feet = feetPos(this);
    // estela de energía bajo las botas (deslizamiento sobre una superficie invisible)
    const tr = trails(this, '_boardTr', 0x2ab8ff, 0xc8f4ff, 20, 0.38);
    const gy = p.floorY ? p.floorY(p.pos.x, p.pos.z, p.pos.y + 0.5) : p.pos.y;
    feet.forEach((f, i) => {
      const y = lerp(gy + 0.04, f.y - 0.03, 0.55);
      tpush(tr[i], this, V(f.x - bz * 0.07, y, f.z + bx * 0.07), V(f.x + bz * 0.07, y, f.z - bx * 0.07));
      tr[i].update(dt, on && lift > 0.05 && sp > 1);
    });
    if (!on || lift < 0.05) return;
    // en cada paso, un pequeño racimo de burbujas sale de debajo de la bota (más cuanto más rápido)
    this.stepB = (this.stepB || 0) - dt * (1.6 + 0.35 * sp);
    if (this.stepB <= 0) {
      this.stepB = 1;
      const f = feet[(this.stepI = (this.stepI || 0) ^ 1)];
      const n = 2 + Math.round(3 * Math.min(1.2, k));
      for (let i = 0; i < n; i++) this.bubble2(f.x + rnd(-0.1, 0.1), lerp(gy + 0.04, f.y - 0.05, Math.random()), f.z + rnd(-0.1, 0.1), rnd(0.03, 0.09) * (0.7 + 0.5 * k), bx, bz);
    }
    if (Math.random() < 0.35 * k) { const f = feet[Math.random() < 0.5 ? 0 : 1]; fx.spark.emit(f.x, gy + 0.06, f.z, bx * rnd(1, 2.5), rnd(0.2, 0.8), bz * rnd(1, 2.5), rnd(0.2, 0.4), 0.06, 0.02, 0xdff8ff, 0x3ab0ff, 0.8, 0, -1, 1); }
  },
  // burbuja con reflejos: sube, oscila con su propia trayectoria, se queda flotando un momento y explota
  bubble2(x, y, z, r, bx, bz) {
    const L = (this._bub || (this._bub = []));
    for (let i = L.length - 1; i >= 0; i--) if (L[i].dead || L[i].t >= L[i].life) L.splice(i, 1);
    if (L.length > 60) return;
    const m = new THREE.Mesh(BUB_GEO(), BUB_MAT);
    m.position.set(x, y, z);
    m.scale.setScalar(0.001);
    m.renderOrder = 6;
    const life = 1 + Math.random() * 1.1, rise = 0.15 + Math.random() * 0.45, drift = rnd(0.4, 1.4), ph = Math.random() * TAU, wob = rnd(4, 9), amp = rnd(0.08, 0.22), fx = this.g.fx;
    const it = this.vfx.add(m, life, (q, dt) => {
      const t = q.t, u = t / life, slow = Math.exp(-t * 2.5);
      m.position.x += (bx * drift * slow + Math.sin(t * wob + ph) * amp) * dt;
      m.position.z += (bz * drift * slow + Math.cos(t * wob * 0.8 + ph) * amp) * dt;
      m.position.y += rise * dt * (0.4 + 0.6 * (1 - slow));
      const grow = 1 - Math.pow(1 - Math.min(1, t / 0.18), 3), pop = u > 0.9 ? 1 + (u - 0.9) * 2.5 : 1;
      const sq = 1 + 0.08 * Math.sin(t * 11 + ph); // se deforma un poco al flotar
      m.scale.set(r * grow * pop * sq, r * grow * pop / sq, r * grow * pop * sq);
      if (u >= 0.985 && !q.popped) { q.popped = true; fx.spark.emit(m.position.x, m.position.y, m.position.z, 0, 0.6, 0, 0.25, 0.1, 0.02, 0xffffff, 0x9fe0ff, 0.8, 0, 0, 1); }
    });
    L.push(it);
  },

  cleanup() {
    if (this._blades) { // cuchillas de patín de Kira
      for (const b of this._blades) { b.g.traverse((o) => { if (o.geometry && o.geometry.userData.mine) o.geometry.dispose(); }); b.bone.remove(b.g); }
      for (const r of this._bladeRes) r.dispose();
      this._blades = null;
    }
    if (this._comets) { for (const c of this._comets) c.d.dispose(); this._comets = null; }
    if (this._funnel) { this._funnel.dispose(); this._funnel = null; }
    if (this._tw) { if (this.p.model && this.p.model.boneFx === this._tw.fx) this.p.model.boneFx = null; this._tw = null; } // alas de Ámbar
    if (this._wHid) { for (const pt of this._wHid.parts) pt.w.group.visible = true; this._wHid = null; }
    if (this.hero === 'kairo') { speedLines(0); this.p.animMul = 1; }
    for (const t of this._trails || []) t.dispose();
    this._trails = null; this._cometTr = this._voltTr = this._boardTr = this._windTr = null;
    if (this._sandSwaps) { for (const s of this._sandSwaps) s.o.material = s.mat; this._sandSwaps = null; }
    if (this._sandMats) { for (const m of this._sandMats) m.dispose(); this._sandMats = null; }
    if (this._origCleanup) this._origCleanup();
  },
};

// COLOR DE LAS PLUMAS de Ámbar: el color medio de los materiales de su propio modelo (no se inventa ningún color)
function ambarFeatherColor(p) {
  const c = new THREE.Color(0, 0, 0); let n = 0;
  if (p.model && p.model.root) p.model.root.traverse((o) => { const ms = o.isMesh && o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) if (m.color && !m.transparent) { c.add(m.color); n++; } });
  if (!n) return 0xd8b080;
  c.multiplyScalar(1 / n);
  return c.getHex();
}

// TORNADO DE ÁMBAR: cuatro bandas de aire (embudos abiertos de distinto radio) que giran a distintas velocidades y
// en sentidos alternos, con vetas de viento en espiral, chispazos eléctricos y una parte de arriba orgánica (el
// borde superior se ondula con ruido). Debajo, un disco de turbulencia pegado al suelo. Un solo juego de uniformes:
// uGrow (0..1) hace nacer las bandas del suelo hacia arriba, uSpread (0..1) las separa y dispersa al final.
let _funGeo = null, _baseGeo = null;
function ambarFunnel(scene) {
  if (!_funGeo) { _funGeo = new THREE.CylinderGeometry(1.25, 0.32, 1, 40, 14, true); _funGeo.translate(0, 0.5, 0); }
  if (!_baseGeo) _baseGeo = new THREE.RingGeometry(0.25, 1.7, 48, 3);
  const U = { uT: { value: 0 }, uK: { value: 0 }, uGrow: { value: 0 }, uSpread: { value: 0 } };
  const NOISE = `float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }`;
  const mk = (dir, tint, seed, alpha) => new THREE.ShaderMaterial({
    uniforms: { ...U, uDir: { value: dir }, uTint: { value: new THREE.Color(tint) }, uSeed: { value: seed }, uA: { value: alpha } },
    vertexShader: `uniform float uT; uniform float uSpread; uniform float uSeed; varying vec2 vUv; ${NOISE}
      void main(){
        vUv = uv; vec3 p = position; float y = uv.y, a = uv.x * 6.2831;
        // la parte de arriba se ondula de forma orgánica (más cuanto más arriba) y cada banda a su ritmo
        float wob = (n(vec2(a * 1.5 + uT * 1.7 + uSeed * 7.0, y * 2.0 - uT * 0.8)) - 0.5) * 0.45 * y * y;
        float sway = sin(uT * 2.3 + uSeed * 5.0 + y * 3.0) * 0.08 * y;
        p.xz *= 1.0 + wob + uSpread * (0.7 + uSeed * 0.9);                 // al final se separan hacia fuera
        p.x += sway; p.y *= 1.0 + uSpread * 0.35 * uSeed;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform float uT; uniform float uK; uniform float uDir; uniform float uGrow; uniform float uSpread; uniform float uSeed; uniform float uA; uniform vec3 uTint; varying vec2 vUv; ${NOISE}
      void main(){
        float y = vUv.y;
        // vetas de viento en espiral que suben girando
        float s1 = n(vec2(vUv.x * 9.0 + y * 4.0 * uDir - uT * 2.5 * uDir + uSeed * 3.0, y * 3.0 - uT * 1.2));
        float s2 = n(vec2(vUv.x * 17.0 - y * 6.0 * uDir + uT * 3.5 * uDir, y * 5.0 + uSeed));
        float streak = smoothstep(0.55, 0.95, s1 * 0.7 + s2 * 0.5);
        // chispazos eléctricos que recorren las bandas
        float zap = step(0.988, n(vec2(vUv.x * 40.0 + floor(uT * 16.0) * 3.1 + uSeed * 11.0, y * 20.0)));
        // nace del suelo hacia arriba; borde superior irregular (no un corte limpio)
        float top = 0.78 + 0.2 * n(vec2(vUv.x * 7.0 + uT * 0.9, uSeed * 4.0));
        float edge = smoothstep(0.0, 0.1, y) * (1.0 - smoothstep(top - 0.22, top, y));
        float grow = 1.0 - smoothstep(uGrow * 1.05 - 0.12, uGrow * 1.05, y);
        // al dispersarse, la banda se rompe en jirones antes de desaparecer
        float tear = uSpread > 0.0 ? smoothstep(uSpread * 1.1 - 0.25, uSpread * 1.1, n(vec2(vUv.x * 6.0, y * 4.0 + uSeed * 9.0))) : 1.0;
        vec3 col = mix(uTint, vec3(1.0), streak * 0.6) + vec3(0.5, 0.8, 1.0) * zap * 1.6;
        gl_FragColor = vec4(col, (streak * 0.8 + 0.08 + zap * 0.8) * edge * grow * tear * uK * uA);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const group = new THREE.Group();
  // [radio, velocidad de giro (signo = sentido), color, transparencia] — de dentro a fuera
  const SPEC = [[0.62, 1.35, 0x4a90ff, 0.75], [0.85, -0.95, 0x7ab4ff, 0.8], [1.02, 0.7, 0x9cc8ff, 0.7], [1.2, -0.45, 0xdcecff, 0.45]];
  const bands = SPEC.map(([r, spd, col, a], i) => {
    const m = new THREE.Mesh(_funGeo, mk(Math.sign(spd), col, i / SPEC.length, a));
    m.scale.set(r, 1 - i * 0.05, r);
    m.userData.sp = spd; m.renderOrder = 5;
    group.add(m);
    return m;
  });
  // BASE DE TURBULENCIA: disco de aire y polvo que gira a ras de suelo
  const baseMat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uT; uniform float uK; uniform float uSpread; varying vec2 vP; ${NOISE}
      void main(){
        float r = length(vP), a = atan(vP.y, vP.x);
        float sw = n(vec2(a * 3.0 + r * 4.0 - uT * 5.0, r * 3.0)) * 0.7 + n(vec2(a * 7.0 - r * 6.0 + uT * 3.0, r * 6.0)) * 0.4;
        float ring = smoothstep(0.25, 0.6, r) * (1.0 - smoothstep(1.1, 1.7, r));
        vec3 col = mix(vec3(0.85, 0.82, 0.76), vec3(0.75, 0.88, 1.0), 0.5);
        gl_FragColor = vec4(col, smoothstep(0.45, 0.9, sw) * ring * uK * 0.55 * (1.0 - uSpread));
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const base = new THREE.Mesh(_baseGeo, baseMat);
  base.rotation.x = -Math.PI / 2; base.position.y = 0.04; base.renderOrder = 5;
  const baseHolder = new THREE.Group(); baseHolder.add(base);
  group.add(baseHolder);
  group.visible = false;
  scene.add(group);
  return {
    group, bands, base, U, k: 0, spin: 0,
    dispose() { scene.remove(group); for (const b of bands) b.material.dispose(); baseMat.dispose(); },
  };
}

// burbuja: borde brillante (Fresnel), irisaciones de película fina, reflejo de luz y centro casi transparente
let _bubGeo = null;
const BUB_GEO = () => _bubGeo || (_bubGeo = new THREE.SphereGeometry(1, 16, 12));
const BUB_MAT = new THREE.ShaderMaterial({
  uniforms: {},
  vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vN; varying vec3 vV;
    void main(){
      vec3 n = normalize(vN); float f = 1.0 - abs(dot(n, normalize(vV)));
      float rim = pow(f, 2.2);
      vec3 iri = 0.5 + 0.5 * cos(6.2831 * (f * 1.6 + vec3(0.0, 0.33, 0.67)));     // película fina: colores del arcoíris en el borde
      vec3 col = mix(vec3(0.75, 0.92, 1.0), iri, 0.45) * (0.35 + 0.9 * rim);
      float spec = pow(max(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0), 60.0);  // reflejo de luz
      float spec2 = pow(max(dot(n, normalize(vec3(0.5, -0.3, 0.8))), 0.0), 30.0) * 0.4;
      col += vec3(1.0) * (spec + spec2);
      float a = clamp(0.06 + 0.7 * rim + spec, 0.0, 0.9);
      gl_FragColor = vec4(col, a);
    }`,
  transparent: true, depthWrite: false, toneMapped: false,
});
