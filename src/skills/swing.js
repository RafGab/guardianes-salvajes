import * as THREE from 'three';
import { Skill, DEG, ease, lerp, clamp, V, makeElastic, boneWorld } from './base.js';
import { terrainH } from '../terrain.js';
import { ui } from '../ui.js';
import { Audio3D as audio } from '../audio.js';

/* ======================================================================
   BALANCEO AL ESTILO ARAÑA (cola de Jaglion y lengua de Kairo)
   La cola (Jaglion) o la lengua (Kairo) salen disparadas hacia un punto de anclaje alto del escenario (la parte de arriba de un
   edificio, un muro, una roca o un árbol, por delante del héroe), se enganchan y el héroe queda colgado de
   ellas como un péndulo REAL: cae, gana velocidad, pasa por debajo del anclaje y sube por el otro lado.
   · La cuerda tira un poco al engancharse (tensión elástica) y se va recogiendo durante el balanceo (gana altura).
   · El jugador dirige el balanceo con el movimiento; la cuerda se suelta sola al subir por delante, al pulsar
     otra vez el mismo botón o al saltar, y el héroe sale despedido con la velocidad del péndulo.
   · Encadenable: en pleno balanceo (o en el aire tras soltarse) se puede volver a lanzar en cuanto se recarga,
     y se engancha a un nuevo punto sin perder el impulso.
   · Si choca con una pared o llega al suelo, se suelta de inmediato (nunca atraviesa el escenario).
   ====================================================================== */
const G = 24;                       // gravedad del héroe (player.js)
const SKIP = new Set(['rail', 'fence', 'obstacle', 'log']);
const _d = new THREE.Vector3(), _n = new THREE.Vector3();

// Punto de anclaje alto por delante (o en la dirección en la que vuela el héroe): borde superior de un sólido
export function findSwingAnchor(skill, range = 20, coneDeg = 60) {
  const p = skill.p, w = skill.g.world;
  let fx = Math.sin(p.facing), fz = Math.cos(p.facing);
  const hs = Math.hypot(p.vx || 0, p.vz || 0);
  if (!p.grounded && hs > 4) { fx = p.vx / hs; fz = p.vz / hs; } // en el aire: hacia donde va
  const minDot = Math.cos(coneDeg * DEG);
  const near = w.solidsNear(p.pos.x - range, p.pos.x + range, p.pos.z - range, p.pos.z + range, []);
  let best = null, bs = Infinity;
  for (const s of near) {
    if (SKIP.has(s.tag) || s.dyn) continue;
    const top = s.y1 + (s.tag === 'tree' ? 1.5 : 0); // en los árboles se agarra a la copa
    const rise = top - p.pos.y;
    if (rise < (p.grounded ? 3.5 : 1.8) || rise > 24) continue; // en el aire (encadenando) basta con algo menos de altura
    // punto del borde superior más cercano al héroe, adelantado hacia el sentido de la marcha
    const ax = clamp(p.pos.x + fx * 6, s.x0 + 0.2, s.x1 - 0.2), az = clamp(p.pos.z + fz * 6, s.z0 + 0.2, s.z1 - 0.2);
    const dx = ax - p.pos.x, dz = az - p.pos.z, dist = Math.hypot(dx, dz);
    if (dist < 4.5 || dist > range) continue;
    const dot = (dx * fx + dz * fz) / dist;
    if (dot < minDot) continue;
    const sc = dist * 0.35 - dot * 7 - Math.min(rise, 12) * 0.45;
    if (sc < bs) { bs = sc; best = V(ax, top, az); }
  }
  return best;
}

// Péndulo con cuerda elástica entre el héroe y el anclaje
export class Swinger {
  constructor(skill, anchor) {
    const p = skill.p;
    this.sk = skill; this.p = p; this.A = anchor.clone();
    this.v = V(p.vx || 0, Math.min(p.vy || 0, 2), p.vz || 0);
    // tirón inicial hacia delante (hacia el anclaje): la cuerda se tensa y lanza al héroe
    _d.set(anchor.x - p.pos.x, 0, anchor.z - p.pos.z).normalize();
    this.dir = { x: _d.x, z: _d.z };
    this.v.addScaledVector(_d, 7);
    // desde el suelo, el tirón de la cuerda lo despega (salto inicial) para que empiece a balancearse
    if (p.grounded || p.vy <= 0.5) { this.v.y = Math.max(this.v.y, 7.5); p.pos.y += 0.25; }
    // largo de la cuerda: más corto que la distancia y siempre con el punto más bajo del péndulo por encima del
    // suelo → al engancharse, la cuerda elástica TIRA del héroe hacia arriba y hacia el anclaje
    const gyA = terrainH(anchor.x, anchor.z), ground = Math.max(gyA, terrainH(p.pos.x, p.pos.z));
    this.L = clamp(Math.min(p.pos.distanceTo(anchor) * 0.8, anchor.y - ground - 1.4), 2.4, 30);
    this.L0 = this.L;
    this.t = 0;
    this.passed = false;
    this.tug = 1;                    // rebote elástico de la cuerda al engancharse
  }
  // un paso de simulación; devuelve null (sigue) o el motivo para soltarse
  step(dt) {
    const p = this.p, A = this.A, v = this.v, sk = this.sk;
    this.t += dt;
    this.tug = Math.max(0, this.tug - dt * 3);
    // dirección elegida por el jugador (relativa a la cámara): orienta y empuja el balanceo
    const inp = sk.g.input && sk.g.input.moveAxes ? sk.g.input.moveAxes() : { x: 0, y: 0 };
    const yaw = sk.g.chase ? sk.g.chase.yaw : 0, sy = Math.sin(yaw), cy = Math.cos(yaw);
    const mx = -sy * inp.y + cy * inp.x, mz = -cy * inp.y - sy * inp.x;
    v.x += mx * 9 * dt; v.z += mz * 9 * dt;
    v.y -= G * dt;
    const sp = v.length(); if (sp > 32) v.multiplyScalar(32 / sp);
    const prev = p.pos.clone();
    const np = p.pos.clone().addScaledVector(v, dt);
    // la cuerda: no se estira más de su largo (y se va recogiendo poco a poco para ganar altura)
    this.L = Math.max(2.4, this.L - dt * (1.2 + 2.5 * this.tug));
    _d.subVectors(np, A);
    const len = _d.length();
    if (len > this.L) {
      // CUERDA ELÁSTICA: tira hacia el anclaje en proporción a lo que se estira (tensión) y amortigua el rebote;
      // si se estira demasiado, no pasa de ese límite
      _n.copy(_d).divideScalar(len);
      const stretch = len - this.L, vr = v.dot(_n);
      v.addScaledVector(_n, -stretch * 32 * dt);
      if (vr > 0) v.addScaledVector(_n, -vr * Math.min(1, 5 * dt));
      if (stretch > 2.5) { np.copy(A).addScaledVector(_n, this.L + 2.5); if (vr > 0) v.addScaledVector(_n, -vr); }
    }
    // suelo: se suelta al tocarlo
    const gy = p.floorY ? p.floorY(np.x, np.z, np.y + 0.5) : terrainH(np.x, np.z);
    if (np.y < gy + 0.05) {
      np.y = gy + 0.05;
      if (v.y < 0) v.y = 0;
      // al principio roza el suelo mientras la cuerda lo levanta; más tarde, tocar el suelo termina el balanceo
      if (this.t > 0.45) { p.pos.copy(np); return 'suelo'; }
      v.y = Math.max(v.y, 4);
    }
    // paredes: nunca atraviesa el escenario
    const w = sk.g.world, R = p.R * 0.8;
    const hit = w.solidsNear(np.x - R, np.x + R, np.z - R, np.z + R, []).find((s) => !s.dyn && s.tag !== 'tree' && np.x + R > s.x0 && np.x - R < s.x1 && np.z + R > s.z0 && np.z - R < s.z1 && np.y + p.H * 0.6 > s.y0 && np.y + 0.2 < s.y1);
    if (hit) { p.pos.copy(prev); v.x *= -0.15; v.z *= -0.15; return 'pared'; }
    p.pos.copy(np);
    const hs = Math.hypot(v.x, v.z);
    if (hs > 1) p.facing = Math.atan2(v.x, v.z);
    // ¿ya pasó por debajo del anclaje y sube por delante? → se suelta en lo alto del arco
    const ahead = (p.pos.x - A.x) * this.dir.x + (p.pos.z - A.z) * this.dir.z;
    if (ahead > 0.5) this.passed = true;
    if (this.passed && v.y < 1.5 && p.pos.y > A.y - this.L * 0.62) return 'arco';
    if (this.t > 2.6) return 'tiempo';
    return null;
  }
  // inclinación del cuerpo: se echa hacia delante al caer, se estira al pasar por abajo y se inclina en las curvas
  pose(pose) {
    const p = this.p, A = this.A;
    const ang = Math.atan2((p.pos.x - A.x) * this.dir.x + (p.pos.z - A.z) * this.dir.z, A.y - p.pos.y); // 0 = justo debajo
    pose.rx = clamp(-ang * 0.7, -0.9, 0.9);
    const side = this.v.x * this.dir.z - this.v.z * this.dir.x;
    pose.rz = clamp(-side * 0.04, -0.45, 0.45);
    pose.sy = 1.1 + 0.08 * this.tug;
  }
  // velocidad de salida al soltarse: la del péndulo + un pequeño impulso hacia delante y arriba
  releaseVel() {
    const v = this.v.clone(), hs = Math.hypot(v.x, v.z) || 1;
    v.x += (v.x / hs) * 3; v.z += (v.z / hs) * 3;
    v.y = Math.max(v.y, 0) + 5;
    return v;
  }
}

/* Fases del balanceo comunes a la cola de Jaglion y a la lengua de Kairo. La habilidad aporta:
   origin() (de dónde sale la cuerda), this.rope (makeElastic), this.anchor y su color de impacto. */
export function swingStages(sk, { color = 0xffd080, shoot = 40, label = 'balanceo' } = {}) {
  const pose = sk.pose;
  const dist = sk.origin().distanceTo(sk.anchor);
  return [
    // extensión: sale disparada ondulando y se pasa un poco antes de clavarse
    { name: 'extension', dur: Math.max(0.1, dist / shoot), enter: () => { audio.whoosh(); sk.sfx('flap'); }, tick: (dt, k) => {
      const o = sk.origin(), e = 1 - Math.pow(1 - k, 3) + 0.08 * Math.sin(k * Math.PI) * k;
      sk.rope.set(o, o.clone().lerp(sk.anchor, Math.min(1.06, e)), { wobble: 0.45 * (1 - k * 0.7), phase: sk.t * 26, waves: 2.5 });
      pose.rx = lerp(0, -0.25, k); pose.sy = 1 + 0.1 * k;
    }, exit: () => {
      const a = sk.anchor;
      sk.sfx('stick');
      sk.vfx.ring(a.x, a.y + 0.05, a.z, { r0: 0.15, r1: 1.0, dur: 0.35, color });
      sk.vfx.dust(a.x, a.y, a.z, 5, 1.2);
      sk.swinger = new Swinger(sk, a);
      sk.script(true);
      sk.swinging = true;
      sk.shake(0.06);
    } },
    // balanceo: péndulo con física hasta que se suelta (lo alto del arco, botón, salto, suelo o pared)
    { name: label, dur: 9999, tick: (dt) => {
      const S = sk.swinger; if (!S) { sk.endStage(); return; }
      // salto: flanco de la tecla (una pulsación que ya venía de antes no suelta la cuerda)
      const I = sk.g.input, held = !!(I && (I.keys.has('Space') || (I.touch && I.touch.jumpHeld) || (I.pad && I.pad.jump)));
      const jump = held && sk._jh === false; sk._jh = held;
      const why = S.step(dt) || (sk.letGoReq ? 'boton' : null) || (jump ? 'salto' : null);
      // la cuerda tensa (con un rebote elástico al principio) entre el origen y el anclaje
      sk.rope.set(sk.origin(), sk.anchor, { wobble: 0.12 * S.tug, phase: sk.t * 30, sag: 0.04 * (1 - S.tug) });
      S.pose(pose);
      sk._tr = (sk._tr || 0) + 1;
      if (sk._tr % 3 === 0) { const c = sk.center(0.5); sk.vfx.orb(c, { r: 0.1, color, opacity: 0.3, life: 0.22 }); }
      if (why) { sk.letGo(why); sk.endStage(); }
    } },
    // suelta: la cuerda vuelve a su sitio mientras el héroe vuela con el impulso
    { name: 'suelta', dur: 0.22, tick: (dt, k) => {
      if (sk.rope.dead) return;
      const o = sk.origin(), h = sk.lastTip || sk.anchor;
      sk.rope.set(o, h.clone().lerp(o, ease(k)), { wobble: 0.3 * (1 - k), phase: sk.t * 22, waves: 3 });
      if (k > 0.95) sk.rope.kill();
    } },
  ];
}

// Mezcla para las habilidades de balanceo (cola de Jaglion y lengua de Kairo): soltar a mitad del balanceo y encadenar
export const SwingMixin = {
  get canRecast() { return !!this.swinging; },
  recast() { if (!this.swinging) return false; this.letGoReq = true; return true; },
  // suelta al héroe con la velocidad del péndulo (puede llamarse desde fuera para encadenar otro enganche)
  letGo(why = 'boton') {
    if (!this.swinging) return false;
    this.swinging = false;
    const S = this.swinger, v = why === 'pared' ? V(S.v.x, Math.min(S.v.y, 0), S.v.z) : why === 'suelo' ? V(S.v.x * 0.6, 0, S.v.z * 0.6) : S.releaseVel();
    this.lastTip = this.anchor.clone();
    this.release(v.x, v.y, v.z);
    this.p.grounded = false;
    if (why === 'arco' || why === 'boton' || why === 'salto') {
      const c = this.center(0.5);
      this.vfx.ring(c.x, c.y, c.z, { r0: 0.3, r1: 1.6, dur: 0.3, color: this.swingColor || 0xffd080 });
      audio.whoosh();
    }
    if (this.stageName !== 'suelta' && this.stageName !== 'extension') this.endStage();
    return true;
  },
};
