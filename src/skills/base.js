import * as THREE from 'three';
import { Staged } from './attack.js';
import { terrainH } from '../terrain.js';
import { Audio3D as audio } from '../audio.js';

// BASE COMÚN de las habilidades de los héroes (skills/hero.js y skills/powers.js).
export const DEG = Math.PI / 180;
export const ease = (k) => k * k * (3 - 2 * k);
export const lerp = (a, b, k) => a + (b - a) * k;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const NEUTRAL = { rx: 0, rz: 0, sy: 1, dy: 0, spin: 0, hidden: false, sc: 1 }; // sc: tamaño (gigante de roca)
export const SKIP_TAGS = new Set(['tree', 'rail', 'fence', 'obstacle']);

/* ====================================================================== */
/*  Base                                                                   */
/* ====================================================================== */
export class Skill extends Staged {
  constructor(hs, def) {
    super(hs.g.vfx, hs.g.combat);
    this.hs = hs;
    this.g = hs.g;
    this.p = hs.g.player;
    this.def = def;
    this.pose = this.p.pose;
    this.cdFactor = 1;
    this._lock = false;
    this._script = false;
  }
  // Intenta empezar. Devuelve false si no se puede (no se gasta recarga).
  begin() { return false; }

  get fwd() { return { x: Math.sin(this.p.facing), z: Math.cos(this.p.facing) }; }
  center(h = 0.5) { return V(this.p.pos.x, this.p.pos.y + this.p.H * h, this.p.pos.z); }
  gy(x, z) { return terrainH(x, z); }
  face(x, z) { this.p.facing = Math.atan2(x - this.p.pos.x, z - this.p.pos.z); }
  // Antes inmovilizaba al héroe mientras lanzaba. Ahora NINGUNA habilidad bloquea el movimiento ni los controles:
  // solo se marca que está lanzando (el héroe sigue caminando, corriendo, girando y saltando).
  lock(on) {
    if (on && !this._lock) { this._lock = true; this.p.casting = (this.p.casting || 0) + 1; }
    else if (!on && this._lock) { this._lock = false; this.p.casting = Math.max(0, (this.p.casting || 1) - 1); }
  }
  script(on) {
    this.p.scripted = on;
    this._script = on;
    if (on) { this.p.vx = this.p.vz = this.p.vy = 0; this.p.grounded = false; this.p.support = null; }
  }
  // Suelta al héroe del movimiento guiado con una velocidad de salida
  release(vx = 0, vy = 0, vz = 0) {
    this.script(false);
    this.p.vx = vx; this.p.vy = vy; this.p.vz = vz;
  }
  shake(n) { this.g.chase.shake(n); }
  hit(t, dmg) { this.combat.damage(t, dmg); }
  // daño continuo: solo a los pesados, para no matar de golpe a los esbirros
  dot(t, perSec, dt) { if (t.heavy) this.combat.damage(t, perSec * dt, { quiet: true }); }
  awayFrom(t, x, z) { return { dx: t.pos.x - x, dz: t.pos.z - z }; }
  // empuje continuo equivalente a `speed` m/s (la velocidad del esbirro decae 4/s)
  shove(t, dx, dz, speed, dt) { this.combat.push(t, dx, dz, speed * dt * 4); }

  get v2() { return this.g.vfx2; }
  sfx(name) { audio.sfx(name); }
  // Movimiento extra de huesos (orejas, alas, cola) encima de la animación del modelo
  setBones(fn) { if (this.p.model && this.p.model.bones) { this.p.model.boneFx = fn; this._bones = true; } }
  clearBones() { if (this._bones && this.p.model) this.p.model.boneFx = null; this._bones = false; }
  // Todos los huesos cuyo nombre empieza por `prefix`, en orden (raíz → punta)
  chain(prefix) {
    const b = (this.p.model && this.p.model.bones) || {};
    const out = [];
    for (let k = 1; k <= 12; k++) if (b[`${prefix}${k}`]) out.push(b[`${prefix}${k}`]);
    return out;
  }

  dispose() {
    this.clearBones();
    this.killHandles();
    this.cleanup();
    this.lock(false);
    if (this._script) this.p.scripted = false;
  }
}


/* ---------------------------------------------------------------------- */
/*  COLA DEL PODER (Kira): cada poder sale de SU cola                      */
/*  tail_pink (primavera) · tail_red (Solsticio, verano) ·                 */
/*  tail_orange (otoño, Rueda) · tail_blue (Aurora Polar, invierno)        */
/*  st.k = 0 reposo … 1 alzada y orientada; st.whip = latigazo del         */
/*  lanzamiento (se apaga solo). Las demás colas siguen con su animación.  */
/* ---------------------------------------------------------------------- */
export function powerTail(skill, color) {
  const m = skill.p.model;
  if (!m || !m.bones) return null;
  const chain = [];
  for (let k = 1; k <= 8; k++) if (m.bones[`tail_${color}_${k}`]) chain.push(m.bones[`tail_${color}_${k}`]);
  // modelo de UNA sola cola (Zorra Ártica H3): todos los poderes salen de esa cola (el brillo sigue siendo el de su poder)
  let tailPre = `tail_${color}_`;
  if (!chain.length) { tailPre = 'tail_'; for (let k = 1; k <= 8; k++) if (m.bones[`tail_${k}`]) chain.push(m.bones[`tail_${k}`]); }
  if (!chain.length) return null;
  // dirección de reposo de la cola (espacio del cuerpo: los huesos no tienen giro de reposo)
  const dir = new THREE.Vector3();
  for (let i = 1; i < chain.length; i++) dir.add(chain[i].position);
  const end = m.bones[`${tailPre}end`]; if (end) dir.add(end.position);
  if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1);
  dir.normalize();
  // eje para LEVANTARLA (hacia arriba) y, al final, curvarla por encima del cuerpo hacia delante
  const lift = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
  if (lift.lengthSq() < 0.05) lift.crossVectors(dir, new THREE.Vector3(0, 0, 1));
  lift.normalize();
  const st = { k: 0, whip: 0, kk: 0, ww: 0 };
  const side = new THREE.Vector3().crossVectors(dir, lift).normalize();
  // las OTRAS tres colas: se calman mientras esta lanza el poder (no se confunden con la protagonista)
  const others = [];
  for (const c of ['pink', 'red', 'orange', 'blue']) if (c !== color) for (let k = 1; k <= 8; k++) if (m.bones[`tail_${c}_${k}`]) others.push(m.bones[`tail_${c}_${k}`]);
  const qI = new THREE.Quaternion();
  // PERSONALIDAD DE CADA COLA (su estación): primavera ondula suave como una rama en flor, verano chisporrotea
  // como una llama, otoño gira en remolino como las hojas y el invierno se alza rígida y cristalina
  const STYLE = {
    pink: (i, t) => [Math.sin(t * 3 - i * 0.6) * 0.14, Math.sin(t * 1.6 - i * 0.5) * 0.12],
    red: (i, t) => [Math.sin(t * 15 - i * 1.4) * 0.07 + Math.sin(t * 9 - i) * 0.05, Math.sin(t * 11 - i * 1.1) * 0.06],
    orange: (i, t) => [Math.sin(t * 5.5 - i * 0.75) * 0.17, Math.cos(t * 5.5 - i * 0.75) * 0.17],
    blue: (i, t) => [Math.sin(t * 1.4 - i * 0.3) * 0.04, Math.sin(t * 0.9) * 0.03],
  };
  const LIFT = { pink: 1, red: 1.15, orange: 1, blue: 1.3 };
  const style = STYLE[color] || STYLE.pink, liftK = LIFT[color] || 1;
  const fn = (B, dt, t, fx) => {
    st.kk += (st.k - st.kk) * (1 - Math.exp(-10 * dt)); // transición suave entre reposo y lanzamiento
    st.ww += (st.whip - st.ww) * (1 - Math.exp(-18 * dt));
    st.whip *= Math.exp(-5 * dt);
    for (const b of others) b.quaternion.slerp(qI, 0.55 * st.kk);
    const n = chain.length;
    chain.forEach((b, i) => {
      const w = (i + 1) / n, [s1, s2] = style(i, t);
      const a = st.kk * liftK * (0.2 + 0.16 * i) + st.ww * 0.38 * w + s1 * st.kk;
      fx.rot(b, lift.x, lift.y, lift.z, a);
      if (s2) fx.rot(b, side.x, side.y, side.z, s2 * st.kk);
    });
  };
  m.tailFx = fn;
  return {
    st, chain,
    // punta de la cola en el mundo (para el brillo del poder)
    tip(out = new THREE.Vector3()) { m.root.updateMatrixWorld(true); return (end || chain[chain.length - 1]).getWorldPosition(out); },
    end() { if (m.tailFx === fn) m.tailFx = null; },
  };
}

/* ---------------------------------------------------------------------- */
/*  CADENA ELÁSTICA (lengua del Komodo, cola del Jaglion)                  */
/*  Un tubo de muchas articulaciones entre dos puntos: se comba, ondula y  */
/*  rebota. set(a, b, { wobble, phase, sag, waves }) cada fotograma.       */
/* ---------------------------------------------------------------------- */
const UPV = new THREE.Vector3(0, 1, 0);
export function makeElastic(skill, { n = 28, r0 = 0.1, r1 = 0.06, color = 0xff6a8a, rough = 0.3, emissive = 0x000000, tipR = 0, map = null, tipColor = null, uvRepeat = 6 } = {}) {
  const tube = skill.v2.tube({ n, r0, r1, color, rough, emissive, tipR, map, tipColor, uvRepeat });
  const pts = Array.from({ length: n }, () => new THREE.Vector3());
  const dir = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
  let dead = false;
  const h = {
    tube,
    set(a, b, { wobble = 0, phase = 0, sag = 0, waves = 2 } = {}) {
      if (dead) return;
      dir.subVectors(b, a);
      const len = dir.length() || 0.001;
      dir.divideScalar(len);
      side.crossVectors(dir, UPV);
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
      side.normalize();
      up.crossVectors(side, dir).normalize();
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1), env = Math.sin(u * Math.PI);
        const w = wobble * env * Math.sin(u * Math.PI * waves * 2 - phase);
        const w2 = wobble * 0.5 * env * Math.cos(u * Math.PI * waves * 1.3 - phase * 1.2);
        pts[i].copy(a).addScaledVector(dir, len * u).addScaledVector(side, w).addScaledVector(up, w2 - sag * env * len * 0.12);
      }
      tube.set(pts);
      tube.show(true);
    },
    // curva de Bézier cúbica a → c1 → c2 → b (sale en la dirección de c1 y llega desde c2), con ondulación
    curve(a, c1, c2, b, { wobble = 0, phase = 0, waves = 2 } = {}) {
      if (dead) return;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1), v = 1 - u, w0 = v * v * v, w1 = 3 * v * v * u, w2 = 3 * v * u * u, w3 = u * u * u;
        pts[i].set(a.x * w0 + c1.x * w1 + c2.x * w2 + b.x * w3, a.y * w0 + c1.y * w1 + c2.y * w2 + b.y * w3, a.z * w0 + c1.z * w1 + c2.z * w2 + b.z * w3);
      }
      if (wobble) {
        dir.subVectors(b, a); if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1); dir.normalize();
        side.crossVectors(dir, UPV); if (side.lengthSq() < 1e-4) side.set(1, 0, 0); side.normalize();
        for (let i = 1; i < n; i++) { const u = i / (n - 1), env = Math.sin(u * Math.PI); pts[i].addScaledVector(side, wobble * env * Math.sin(u * Math.PI * waves * 2 - phase)); }
      }
      tube.set(pts);
      tube.show(true);
    },
    get dead() { return dead; },
    hide() { if (!dead) tube.show(false); },
    kill() { if (!dead) { dead = true; tube.kill(); } },
  };
  skill.track(h);
  return h;
}
// Posición en el mundo de un hueso del héroe (o null si no existe)
export function boneWorld(skill, name, out = new THREE.Vector3()) {
  const b = skill.p.model && skill.p.model.bones && skill.p.model.bones[name];
  if (!b) return null;
  skill.p.model.root.updateMatrixWorld(true);
  return b.getWorldPosition(out);
}
