import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { rnd, TAU } from './attack.js';
import { Skill, ease, lerp, clamp, V, DEG, boneWorld } from './base.js';
import { ui } from '../ui.js';

/* ======================================================================
   VOYA — EL LEÓN BLANCO DEL ÉTER (octavo héroe)
   Su poder son los ANILLOS DE SATURNO: bandas de energía cósmica (azul de las gemas de su armadura, blanco
   estelar y un leve brillo dorado de polvo de anillo) que giran, golpean, protegen y estallan.
   · Velocidad (botón 1) · Desfase Éter: su cuerpo se deshace en partículas, viaja convertido en energía y
                           reaparece unos metros más allá con una onda dimensional (speedVoya + player.js 'ether').
   · Poder (botón 2)     · Distorsión Dimensional: dobla el espacio sobre el objetivo, levanta y hace girar lo que
                           hay cerca con su gravedad y lo comprime en una onda dimensional (GravityRiftSkill).
   · Escudo (botón 3)    · Regeneración Legendaria: campo protector que absorbe la energía del ambiente y la
                           convierte en vida hasta el 100 % (LegendaryRegenSkill).
   (El Anillo Astral y la Órbita de Saturno siguen en este archivo, aunque ya no van en ningún botón.)
   · Especial (botón 5)  · Corona de Saturno: levita, una gran estructura de anillos gira a su alrededor, se
                           expande barriendo la zona y termina en una descarga de Éter.
   · Arma (botón 4)      · Cetro de Saturno: combo barrido → giro completo → golpe al suelo con onda anular.
   Todas las animaciones mueven el ESQUELETO del modelo (setBones / pose), no solo el cuerpo entero.
   ====================================================================== */

export const ETHER = { blue: 0x6aa8ff, sky: 0xbfd4ff, white: 0xffffff, deep: 0x2a4cff, gold: 0xffe2a8, violet: 0xb8a8ff };

/* ---------- material de ANILLO DE SATURNO: bandas concéntricas que giran, con huecos (división de Cassini) ---------- */
function ringMaterial({ inner = 0.62, color = ETHER.blue, color2 = ETHER.sky, gold = ETHER.gold, opacity = 0.9 } = {}) {
  const U = { uT: { value: 0 }, uK: { value: 1 }, uIn: { value: inner }, uA: { value: new THREE.Color(color) }, uB: { value: new THREE.Color(color2) }, uG: { value: new THREE.Color(gold) }, uO: { value: opacity }, uFlash: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uT; uniform float uK; uniform float uIn; uniform vec3 uA; uniform vec3 uB; uniform vec3 uG; uniform float uO; uniform float uFlash;
      varying vec2 vP;
      float h(float x){ return fract(sin(x * 91.7) * 43758.5453); }
      void main(){
        float r = length(vP), a = atan(vP.y, vP.x);
        float u = clamp((r - uIn) / (1.0 - uIn), 0.0, 1.0);          // 0 borde interior … 1 borde exterior
        // bandas de distinto brillo (como los anillos A, B y C) y la división oscura de Cassini
        float bands = 0.55 + 0.25 * sin(u * 38.0) + 0.2 * sin(u * 91.0 + 1.3);
        float cassini = smoothstep(0.035, 0.0, abs(u - 0.62));
        // grumos de polvo que giran alrededor (el anillo se ve girar)
        float grain = 0.75 + 0.25 * sin(a * 9.0 - uT * 4.0 + u * 7.0) * sin(a * 23.0 + uT * 2.5);
        float edge = smoothstep(0.0, 0.08, u) * smoothstep(1.0, 0.86, u);
        vec3 col = mix(uA, uB, u);
        col = mix(col, uG, 0.22 * smoothstep(0.7, 1.0, u));
        col += vec3(1.0) * (0.35 * smoothstep(0.9, 1.0, u) + uFlash * 0.6);   // borde exterior luminoso
        float alpha = bands * grain * edge * (1.0 - cassini * 0.85) * uO * uK;
        gl_FragColor = vec4(col * (1.2 + uFlash), clamp(alpha, 0.0, 1.0));
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  return { mat, U };
}
const _ringGeos = {};
function ringGeo(inner) { const k = inner.toFixed(2); return _ringGeos[k] || (_ringGeos[k] = new THREE.RingGeometry(inner, 1, 96, 3)); }
// anillo de Saturno listo para la escena (radio 1; se escala). El grupo `g` se orienta; el anillo gira dentro (spin).
export function saturnRing(opts = {}) {
  const inner = opts.inner ?? 0.62;
  const { mat, U } = ringMaterial({ ...opts, inner });
  const m = new THREE.Mesh(ringGeo(inner), mat);
  m.rotation.x = -Math.PI / 2; // plano XZ (horizontal) por defecto
  m.renderOrder = 7;
  m.frustumCulled = false;
  const spin = new THREE.Group(); spin.add(m);
  const g = new THREE.Group(); g.add(spin);
  g.traverse((o) => { o.userData.own = true; });
  return { g, spin, m, U, mat, dispose() { mat.dispose(); } };
}
// halo esférico de energía (núcleo, destellos)
function glowSphere(color, opacity = 0.6) {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.8), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
  m.userData.own = true;
  return m;
}
const cosmic = (g, q, n = 2, spd = 1.6, spread = 0.3) => {
  const cols = [ETHER.sky, ETHER.white, ETHER.blue, ETHER.gold];
  for (let i = 0; i < n; i++) g.fx.sparkle(q.x + rnd(-spread, spread), q.y + rnd(-spread, spread), q.z + rnd(-spread, spread), cols[(Math.random() * cols.length) | 0], spd);
};

/* ---------- silueta translúcida de Voya (copia de su pose actual con material de Éter) ---------- */
function etherGhost(model) {
  const src = model && (model.body || model.root);
  if (!src) return null;
  const copy = SkeletonUtils.clone(src);
  const mats = [];
  copy.traverse((o) => {
    if (o.isLight) { o.visible = false; return; }
    if (!o.isMesh) return;
    o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false;
    o.userData.own = true;
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    const nm = arr.map((m0) => {
      const m = m0.clone();
      m.transparent = true; m.opacity = 0.7; m.depthWrite = false;
      if (m.emissive) { m.emissive = new THREE.Color(ETHER.sky); m.emissiveIntensity = 0.9; }
      mats.push(m);
      return m;
    });
    o.material = Array.isArray(o.material) ? nm : nm[0];
  });
  const g = new THREE.Group();
  g.add(copy);
  g.userData.own = true;
  return { g, copy, mats, dispose() { for (const m of mats) m.dispose(); } };
}
// puntos del cuerpo (huesos) para que las partículas dibujen su silueta
const BODY_PTS = ['head', 'neck', 'chest', 'spine', 'root', 'hand_L', 'hand_R', 'forearm_L', 'forearm_R', 'upper_arm_L', 'upper_arm_R', 'shin_L', 'shin_R', 'foot_L', 'foot_R', 'thigh_L', 'thigh_R', 'tail_3', 'tail_end', 'head_end'];
function bodyPoints(skill) {
  const out = [];
  for (const n of BODY_PTS) { const w = boneWorld(skill, n); if (w) out.push(w); }
  if (!out.length) out.push(skill.center(0.5));
  return out;
}
// onda dimensional: esfera de Éter que crece y se apaga
function etherWave(skill, pos, r1, life = 0.45) {
  const v2 = skill.v2;
  if (!v2) return;
  const sh = v2.shell(pos, { r: 0.3, color: ETHER.deep, rim: ETHER.sky, opacity: 0.7, power: 2.5, core: 0.04, life, seg: 24 });
  sh.onUpdate = (t, e) => {
    sh.mesh.scale.setScalar(0.3 + (r1 - 0.3) * ease(Math.min(1, e)));
    sh.mat.uniforms.uOp.value = 0.7 * (1 - Math.min(1, e));
  };
}

/* ======================================================================
   VELOCIDAD — DESFASE ÉTER (botón 1; lo llama SpeedFxSkill.tick como this.voya)
   DESHACERSE · al pulsar, su cuerpo se vuelve translúcido (silueta de Éter en el punto de partida) y se descompone
                en partículas que salen despedidas hacia atrás.
   VIAJE      · durante una fracción de segundo es pura energía: no se le ve ni se le puede golpear; una estela de
                luz y partículas con la forma de su cuerpo recorre el camino (player.js lo lanza ~10 m, sin
                atravesar paredes).
   REAPARECER · vuelve a materializarse con una onda expansiva dimensional y un destello, y sigue corriendo ×1,9
                el resto del impulso con su estela de partículas cósmicas.
   ====================================================================== */
export function speedVoya(dt, k, bx, bz, sp, step) {
  const p = this.p, pose = this.pose, fx = this.g.fx;
  if (!this._voyaInit) {
    this._voyaInit = true;
    this._phase = p.dashT > 0 ? 'viaje' : 'normal';
    this._phaseT = 0;
    this._prev = p.pos.clone();
    const c = p.pos;
    this.sfx('warp');
    this.shake(0.1);
    if (this.g.playerHitT !== undefined) this.g.playerHitT = Math.max(this.g.playerHitT, 0.45); // en fase no se le puede golpear
    // la silueta translúcida se queda en el punto de partida y se deshace en partículas
    const gh = etherGhost(p.model);
    if (gh) {
      p.model.root.updateMatrixWorld(true);
      gh.g.position.copy(p.model.root.position); gh.g.quaternion.copy(p.model.root.quaternion); gh.g.scale.copy(p.model.root.scale);
      const life = 0.45;
      this.vfx.add(gh.g, life, (it) => {
        const e = Math.min(1, it.t / life);
        gh.copy.scale.set(1 + 0.25 * e, 1 + 0.1 * e, 1 + 0.25 * e);
        for (const m of gh.mats) m.opacity = 0.7 * (1 - e) * (0.8 + 0.2 * Math.sin(it.t * 60));
      });
      this.track({ kill: () => setTimeout(() => gh.dispose(), 600) });
    }
    for (const q of bodyPoints(this)) for (let i = 0; i < 4; i++) fx.spark.emit(q.x, q.y, q.z, bx * rnd(2, 6) + rnd(-1.5, 1.5), rnd(-0.5, 2), bz * rnd(2, 6) + rnd(-1.5, 1.5), rnd(0.35, 0.7), 0.08, 0.02, i % 2 ? ETHER.white : ETHER.sky, ETHER.deep, 1, 0, 0, 1);
    this.vfx.ring(c.x, null, c.z, { r0: 0.3, r1: 2.6, dur: 0.35, color: ETHER.sky, opacity: 0.8 });
    this.vfx.orb(this.center(0.5), { r: 0.45, color: ETHER.sky, opacity: 0.55, life: 0.18, grow: 2 });
  }
  this._phaseT += dt;
  // VIAJE: invisible e invulnerable, convertido en una corriente de energía con la forma de su cuerpo
  if (this._phase === 'viaje') {
    pose.hidden = true;
    const from = this._prev, to = p.pos;
    for (const q of bodyPoints(this)) {
      if (Math.random() < 0.55) cosmic(this.g, q, 1, 0.6, 0.08);
      fx.spark.emit(q.x, q.y, q.z, bx * rnd(1, 3), rnd(-0.3, 0.3), bz * rnd(1, 3), rnd(0.2, 0.4), 0.06, 0.02, Math.random() < 0.5 ? ETHER.white : ETHER.sky, ETHER.blue, 1, 0, 0, 1);
    }
    // rayo de luz que une el tramo recorrido en este fotograma (la estela del teletransporte)
    const a = V(from.x, from.y + p.H * 0.55, from.z), b = V(to.x, to.y + p.H * 0.55, to.z);
    if (a.distanceTo(b) > 0.05) this.vfx.bolt(a, b, { color: ETHER.white, life: 0.2, jag: 0.06, segs: 3 });
    if (p.dashT <= 0 || this._phaseT > 0.5) {
      // REAPARECE: onda expansiva dimensional y destello
      this._phase = 'aparecer'; this._phaseT = 0;
      const c = p.pos;
      this.vfx.ring(c.x, null, c.z, { r0: 0.4, r1: 5.2, dur: 0.5, color: ETHER.sky, opacity: 0.9 });
      this.vfx.ring(c.x, null, c.z, { r0: 0.2, r1: 3.4, dur: 0.4, color: ETHER.gold, opacity: 0.55 });
      etherWave(this, this.center(0.5), 3.8, 0.45);
      this.vfx.orb(this.center(0.55), { r: 0.5, color: ETHER.white, opacity: 0.95, life: 0.18, grow: 3 });
      cosmic(this.g, this.center(0.5), 26, 3.2, 0.5);
      // la onda aparta a los enemigos que estén justo donde reaparece
      for (const t of this.combat.inCircle(c.x, c.z, 2.4)) { const { dx, dz } = this.awayFrom(t, c.x, c.z); this.combat.push(t, dx, dz, 6); }
      this.shake(0.16); this.sfx('chime');
      this.g.chase.fovKick = Math.max(this.g.chase.fovKick, 10);
    }
    this._prev = p.pos.clone();
    return;
  }
  // APARECER: se rematerializa en un instante (crece desde la energía)
  if (this._phase === 'aparecer') {
    const e = clamp(this._phaseT / 0.18, 0, 1);
    pose.sc = lerp(0.82, 1, ease(e)); pose.sy = lerp(1.12, 1, ease(e));
    if (e >= 1) this._phase = 'normal';
  }
  this._prev = p.pos.clone();
  pose.rx = Math.max(pose.rx, 0.22 * k);
  // estela: partículas cósmicas en el camino recorrido (más larga cuanto más rápido)
  const len = Math.floor(6 + 26 * k);
  for (let i = 3; i < Math.min(len, this.path.length); i += 3) {
    if (Math.random() > 0.35) continue;
    const q = this.path[i], s = 1 - i / len;
    cosmic(this.g, V(q.x, q.y + 0.3 + 0.9 * Math.random() * p.H * 0.5, q.z), 1, 0.4 + 0.6 * s, 0.25);
  }
  // pequeños fragmentos de luz que se desprenden del cuerpo
  if (Math.random() < 0.7 * k) {
    const c = V(p.pos.x + bx * 0.3, p.pos.y + p.H * rnd(0.2, 0.85), p.pos.z + bz * 0.3);
    fx.spark.emit(c.x, c.y, c.z, bx * rnd(1, 3) + rnd(-0.5, 0.5), rnd(0, 1), bz * rnd(1, 3) + rnd(-0.5, 0.5), rnd(0.35, 0.6), 0.07, 0.02, Math.random() < 0.5 ? ETHER.white : ETHER.sky, ETHER.deep, 0.9, 0, 0, 1);
  }
  if (step && p.grounded && sp > 2) {
    const f = this.feet(0.2, bx, bz);
    this.vfx.ring(f.x, null, f.z, { r0: 0.25, r1: 1.1 + 0.6 * k, dur: 0.3, color: Math.random() < 0.5 ? ETHER.sky : ETHER.gold, opacity: 0.55 });
  }
}

/* ======================================================================
   PODER — ANILLO ASTRAL (botón 2)
   INVOCAR · alza el brazo derecho: el anillo nace en su mano y crece girando (partículas que convergen).
   LANZAR  · lo lanza con todo el cuerpo: el anillo inclinado como el de Saturno vuela hacia delante (o hacia el
             objetivo), golpea a todos los enemigos que atraviesa, y vuelve a su mano golpeando otra vez.
   RECOGER · lo atrapa y el anillo se disuelve en polvo estelar.
   ====================================================================== */
export class AstralRingSkill extends Skill {
  begin() {
    const d = this.def, p = this.p;
    const t = this.combat.aimTarget(p.pos.x, p.pos.z, p.facing, 40 * DEG, d.range);
    if (t) this.face(t.pos.x, t.pos.z);
    this.start();
    return true;
  }
  build() {
    const d = this.def;
    return [
      { name: 'invocar', dur: d.prep, enter: this.enterSummon, tick: this.tickSummon },
      { name: 'lanzar', dur: d.flightT, enter: this.enterThrow, tick: this.tickFlight },
      { name: 'recoger', dur: d.recover, enter: this.enterCatch, tick: this.tickCatch },
    ];
  }
  hand() { return boneWorld(this, 'hand_end_R') || boneWorld(this, 'hand_R') || this.center(0.75); }
  enterSummon() {
    this.R = saturnRing({ inner: 0.6 });
    this.prop(this.R.g);
    this.track({ kill: () => this.R.dispose() });
    this.core = glowSphere(ETHER.sky, 0.5); this.R.g.add(this.core);
    this.light = new THREE.PointLight(ETHER.blue, 0, 7, 1.8); this.R.g.add(this.light);
    this.armK = 0; this.throwK = 0;
    this.sfx('shimmer');
    // ESQUELETO: brazo derecho alzado (invocar) → lanzamiento con giro del torso → brazo extendido
    this.setBones((B, dt, t, fx) => {
      const a = this.armK, th = this.throwK;
      fx.rot(B.upper_arm_R, 1, 0, 0, -1.9 * a + 0.9 * th); fx.rot(B.upper_arm_R, 0, 0, 1, -0.35 * a);
      fx.rot(B.forearm_R, 1, 0, 0, -0.9 * a * (1 - th));
      fx.rot(B.chest, 0, 1, 0, 0.35 * a - 0.7 * th); fx.rot(B.spine, 0, 1, 0, -0.25 * th);
      fx.rot(B.upper_arm_L, 0, 0, 1, 0.5 * a); fx.rot(B.upper_arm_L, 1, 0, 0, -0.3 * th);
      fx.rot(B.head, 0, 1, 0, -0.2 * th);
      if (B.tail_1) fx.rot(B.tail_1, 0, 1, 0, 0.5 * th);
    });
  }
  tickSummon(dt, k) {
    this.armK = ease(k);
    const q = this.hand(), r = this.def.radius * ease(k);
    this.R.g.position.copy(q).add(V(0, 0.25 * k, 0));
    this.R.g.rotation.set(0.45, this.p.facing, 0.25);
    this.R.g.scale.setScalar(Math.max(0.01, r * 0.55));
    this.R.spin.rotation.y += dt * 9;
    this.R.U.uT.value = this.t; this.R.U.uK.value = k;
    this.core.scale.setScalar(0.18 * k); this.light.intensity = 3 * k;
    // el Éter converge en la mano
    if (Math.random() < 0.9) { const a = rnd(0, TAU), rr = rnd(0.6, 1.2); const s = V(q.x + Math.cos(a) * rr, q.y + rnd(-0.4, 0.6), q.z + Math.sin(a) * rr); this.g.fx.spark.emit(s.x, s.y, s.z, (q.x - s.x) * 3, (q.y - s.y) * 3, (q.z - s.z) * 3, 0.3, 0.05, 0.02, ETHER.sky, ETHER.blue, 0.9, 0, 0, 1); }
    this.pose.rx = -0.08 * k;
  }
  enterThrow() {
    const d = this.def, p = this.p, f = this.fwd;
    this.from = this.hand().clone();
    this.dir = V(f.x, 0, f.z);
    this.out = V(this.from.x + f.x * d.range, this.from.y, this.from.z + f.z * d.range);
    this.hits = new Set();
    this.back = false;
    this.sfx('warp'); this.shake(0.12);
    this.vfx.ring(p.pos.x, p.pos.y + p.H * 0.6, p.pos.z, { r0: 0.3, r1: 2.2, dur: 0.3, color: ETHER.sky, opacity: 0.6 });
  }
  tickFlight(dt, k) {
    const d = this.def, p = this.p;
    this.throwK = k < 0.2 ? ease(k / 0.2) : k > 0.8 ? 1 - ease((k - 0.8) / 0.2) * 0.6 : 1;
    this.armK = 1 - ease(Math.min(1, k * 3));
    // ida (0..0.5) y vuelta (0.5..1) a la mano, que puede haberse movido
    const home = this.hand();
    let pos;
    if (k < 0.5) { const e = ease(k / 0.5); pos = this.from.clone().lerp(this.out, e); }
    else { if (!this.back) { this.back = true; this.hits.clear(); this.sfx('shimmer'); } const e = ease((k - 0.5) / 0.5); pos = this.out.clone().lerp(home, e); }
    pos.y = Math.max(pos.y, this.gy(pos.x, pos.z) + 0.7);
    const R = this.R;
    R.g.position.copy(pos);
    R.g.rotation.set(0.45, p.facing, 0.25);
    R.g.scale.setScalar(d.radius);
    R.spin.rotation.y += dt * 16;
    R.U.uT.value = this.t * 2;
    this.core.scale.setScalar(0.16);
    this.light.intensity = 3.5;
    // estela de polvo de anillo
    cosmic(this.g, pos, 3, 0.9, d.radius * 0.8);
    // golpea a todos los que atraviesa (una vez a la ida y otra a la vuelta)
    for (const t of this.combat.inCircle(pos.x, pos.z, d.radius + 0.3)) {
      if (this.hits.has(t)) continue;
      this.hits.add(t);
      this.hit(t, d.damage);
      const dx = t.pos.x - pos.x, dz = t.pos.z - pos.z;
      this.combat.push(t, dx, dz, d.force);
      const q = V(t.pos.x, t.pos.y + (t.heavy ? t.S.height * 0.45 : 0.7), t.pos.z);
      this.vfx.orb(q, { r: 0.35, color: ETHER.sky, opacity: 0.8, life: 0.15, grow: 1.4 });
      cosmic(this.g, q, 10, 3, 0.4);
      R.U.uFlash.value = 1;
      this.shake(0.08);
    }
    R.U.uFlash.value = Math.max(0, R.U.uFlash.value - dt * 5);
    // también parte los proyectiles enemigos que toca
    for (const pr of this.combat.projectiles || []) {
      if (pr.dead || pr.owner !== 'boss') continue;
      if (pr.pos.distanceTo(pos) < d.radius + pr.radius) { this.combat.killProjectile(pr); cosmic(this.g, pr.pos, 8, 2.5, 0.2); }
    }
  }
  enterCatch() { this.sfx('chime'); cosmic(this.g, this.hand(), 14, 2.4, 0.3); }
  tickCatch(dt, k) {
    this.throwK = 0.4 * (1 - ease(k)); this.armK = 0;
    const q = this.hand();
    this.R.g.position.copy(q);
    this.R.g.scale.setScalar(this.def.radius * 0.5 * (1 - ease(k)) + 0.01);
    this.R.spin.rotation.y += dt * 10;
    this.R.U.uK.value = 1 - k;
    this.light.intensity = 3 * (1 - k);
  }
}

/* ======================================================================
   ESCUDO — ÓRBITA DE SATURNO (botón 3, 4 s de protección como todos los escudos)
   FORMAR   · abre los brazos y alza el pecho: tres anillos nacen de su cuerpo y se abren hasta su órbita.
   ÓRBITA   · los tres anillos (inclinados de forma distinta) giran y se mecen a su alrededor siguiéndole; motas
              de Éter orbitan entre ellos. Los proyectiles que tocan la órbita se desintegran; los enemigos que la
              tocan reciben una descarga y salen despedidos. Un golpe cuerpo a cuerpo hace destellar los anillos.
   DISOLVER · los anillos se cierran sobre él y se deshacen en polvo de estrellas.
   ====================================================================== */
export class SaturnOrbitSkill extends Skill {
  begin() { this.start(); return true; }
  build() {
    const d = this.def;
    return [
      { name: 'formar', dur: d.prep, enter: this.enterForm, tick: (dt, k) => this.place(ease(k), dt, ease(k)) },
      { name: 'orbita', dur: d.exec, tick: this.tickOrbit },
      { name: 'disolver', dur: d.recover, enter: () => { this.sfx('shimmer'); if (this.p.orbitGuard === this.guard) this.p.orbitGuard = null; }, tick: this.tickFade },
    ];
  }
  get rad() { return this.def.radius * Math.max(0.8, this.p.H / 1.85); }
  enterForm() {
    this.rings = [0, 1, 2].map((i) => { const r = saturnRing({ inner: 0.84 - i * 0.04, opacity: 0.85 }); this.prop(r.g); this.track({ kill: () => r.dispose() }); return r; });
    this.tilts = [[0.25, 0], [1.05, 0.6], [-0.95, 2.1]];
    this.light = new THREE.PointLight(ETHER.blue, 0, 8, 1.8); this.prop(this.light);
    this.openK = 0; this.zapT = 0; this.flash = 0;
    this.sfx('warp');
    this.guard = { absorb: (from) => this.absorb(from) };
    this.p.orbitGuard = this.guard;
    // ESQUELETO: brazos abiertos y algo alzados, pecho arriba (postura de barrera); se cierran al disolverse
    this.setBones((B, dt, t, fx) => {
      const e = this.openK, br = 0.04 * Math.sin(t * 3) * e;
      fx.rot(B.upper_arm_L, 0, 0, 1, (0.95 + br) * e); fx.rot(B.upper_arm_R, 0, 0, 1, -(0.95 + br) * e);
      fx.rot(B.upper_arm_L, 1, 0, 0, -0.35 * e); fx.rot(B.upper_arm_R, 1, 0, 0, -0.35 * e);
      fx.rot(B.forearm_L, 1, 0, 0, -0.45 * e); fx.rot(B.forearm_R, 1, 0, 0, -0.45 * e);
      fx.rot(B.chest, 1, 0, 0, -0.12 * e); fx.rot(B.head, 1, 0, 0, -0.1 * e);
      if (B.tail_1) fx.rot(B.tail_1, 1, 0, 0, -0.35 * e);
    });
    const c = this.center(0.5);
    this.vfx.ring(c.x, null, c.z, { r0: 0.3, r1: this.rad + 1, dur: 0.45, color: ETHER.sky, opacity: 0.7 });
  }
  // coloca los tres anillos a su alrededor (k = tamaño 0..1, o = apertura de los brazos)
  place(k, dt, o = 1) {
    if (!this.rings) return;
    this.openK = o;
    const c = this.center(0.52), R = this.rad;
    this.rings.forEach((r, i) => {
      const [tx, ty] = this.tilts[i];
      r.g.position.copy(c);
      r.g.rotation.set(tx + 0.12 * Math.sin(this.t * 1.3 + i), ty + this.t * (0.5 + 0.25 * i), 0.1 * Math.cos(this.t + i));
      r.g.scale.setScalar(Math.max(0.01, R * (0.92 + 0.08 * i) * k));
      r.spin.rotation.y += dt * (3 + i * 1.5) * (i % 2 ? -1 : 1);
      r.U.uT.value = this.t; r.U.uK.value = k; r.U.uFlash.value = this.flash;
    });
    this.flash = Math.max(0, this.flash - dt * 3);
    this.light.position.copy(c);
    this.light.intensity = k * (2.4 + 0.4 * Math.sin(this.t * 7)) + this.flash * 5;
  }
  tickOrbit(dt) {
    const d = this.def, p = this.p, c = this.center(0.52), R = this.rad;
    this.place(1, dt, 1);
    this.pose.sy = 1.02 + 0.01 * Math.sin(this.t * 6);
    // motas de Éter que orbitan entre los anillos
    if (Math.random() < 0.8) { const a = this.t * 3 + rnd(0, TAU), y = rnd(-0.6, 0.6); cosmic(this.g, V(c.x + Math.cos(a) * R, c.y + y * R * 0.7, c.z + Math.sin(a) * R), 1, 0.4, 0.05); }
    // PROYECTILES que tocan la órbita: se desintegran
    for (const pr of this.combat.projectiles || []) {
      if (pr.dead || pr.owner !== 'boss') continue;
      if (pr.pos.distanceTo(c) > R + pr.radius + 0.3) continue;
      this.combat.killProjectile(pr);
      cosmic(this.g, pr.pos, 12, 3, 0.2);
      this.vfx.orb(pr.pos.clone(), { r: 0.3, color: ETHER.sky, opacity: 0.8, life: 0.14, grow: 1.5 });
      this.flash = 1; this.sfx('chime');
      if (this.g.floatAt) this.g.floatAt(p.pos, p.H + 0.4, '🪐 ¡ÓRBITA!', 'block');
    }
    // ENEMIGOS que tocan los anillos: descarga de Éter y empuje hacia fuera
    this.zapT -= dt;
    if (this.zapT <= 0) {
      this.zapT = d.zapEvery;
      for (const t of this.combat.inCircle(p.pos.x, p.pos.z, R + 0.6)) {
        this.hit(t, d.damage);
        const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z);
        this.combat.push(t, dx, dz, d.push);
        const q = V(t.pos.x, t.pos.y + 0.8, t.pos.z);
        this.vfx.bolt(c, q, { color: ETHER.sky, life: 0.1, jag: 0.3, segs: 8 });
        cosmic(this.g, q, 6, 2.2, 0.3);
        this.flash = 1;
      }
    }
  }
  // golpe cuerpo a cuerpo recibido: los anillos destellan y apartan al atacante (la protección la da el botón de escudo)
  absorb(from) {
    if (this.stageName !== 'orbita' && this.stageName !== 'formar') return false;
    this.flash = 1;
    this.sfx('chime');
    const p = this.p;
    cosmic(this.g, this.center(0.6), 14, 3, 0.5);
    if (from) for (const t of this.combat.inCircle(from.x, from.z, 2.2)) { const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z); this.combat.push(t, dx, dz, this.def.push * 1.4); this.hit(t, this.def.damage); }
    return true;
  }
  tickFade(dt, k) {
    this.place(1 - ease(k), dt, 1 - ease(k));
    if (Math.random() < 0.8) cosmic(this.g, this.center(0.5), 3, 2, this.rad * (1 - k));
  }
  cleanup() { if (this.p.orbitGuard === this.guard) this.p.orbitGuard = null; }
}

/* ======================================================================
   ESPECIAL — CORONA DE SATURNO (botón 5)
   ASCENSO   · el cielo se oscurece en azul cósmico, Voya levita con los brazos abiertos y, a su alrededor, nace
               una gran estructura de anillos de Saturno (tres anillos concéntricos y un núcleo de luz).
   EXPANSIÓN · los anillos giran cada vez más deprisa y se expanden por la zona: cada frente de anillo golpea y
               empuja a los enemigos que alcanza.
   DESCARGA  · todo el Éter se concentra y estalla: destello, ondas en el suelo y gran daño en el radio.
   DESCENSO  · los anillos se deshacen en polvo de estrellas y Voya vuelve al suelo.
   ====================================================================== */
export class SaturnCrownSkill extends Skill {
  begin() { this.start(); return true; }
  build() {
    const d = this.def;
    return [
      { name: 'ascenso', dur: d.prep, enter: this.enterRise, tick: this.tickRise },
      { name: 'expansion', dur: d.exec, enter: this.enterExpand, tick: this.tickExpand },
      { name: 'descarga', dur: d.burstT, enter: this.enterBurst, tick: this.tickBurst },
      { name: 'descenso', dur: d.recover, tick: this.tickLand },
    ];
  }
  enterRise() {
    const d = this.def;
    this.rings = [0, 1, 2].map((i) => { const r = saturnRing({ inner: 0.7 - i * 0.08, opacity: 0.95, gold: i === 1 ? 0xffd890 : ETHER.gold }); this.prop(r.g); this.track({ kill: () => r.dispose() }); return r; });
    this.core = glowSphere(ETHER.sky, 0.55); this.prop(this.core);
    this.halo = glowSphere(ETHER.blue, 0.18); this.prop(this.halo);
    this.light = new THREE.PointLight(ETHER.blue, 0, d.radius * 2.5, 1.6); this.prop(this.light);
    this.dark = this.v2.ambience({ color: '#0a1240', alpha: 0.35, blend: 'multiply', exposure: 0.9, dur: d.prep + d.exec + d.burstT + d.recover, fin: d.prep * 0.7, fout: d.recover });
    this.liftK = 0; this.armK = 0; this.spinV = 0; this.size = 0; this.fronts = [0, 0, 0];
    this.sfx('aurora');
    ui.banner('find', '🪐 Corona de Saturno', 'Los anillos del Éter se alzan alrededor de Voya…');
    // ESQUELETO: levita con los brazos abiertos en cruz, cabeza alzada y cola estirada; al descargar empuja hacia delante
    this.setBones((B, dt, t, fx) => {
      const a = this.armK, push = this.pushK || 0;
      fx.rot(B.upper_arm_L, 0, 0, 1, 1.35 * a); fx.rot(B.upper_arm_R, 0, 0, 1, -1.35 * a);
      fx.rot(B.upper_arm_L, 1, 0, 0, -0.9 * push); fx.rot(B.upper_arm_R, 1, 0, 0, -0.9 * push);
      fx.rot(B.forearm_L, 0, 0, 1, 0.3 * a); fx.rot(B.forearm_R, 0, 0, 1, -0.3 * a);
      fx.rot(B.chest, 1, 0, 0, -0.2 * a + 0.25 * push); fx.rot(B.head, 1, 0, 0, -0.3 * a + 0.2 * push);
      fx.rot(B.thigh_L, 1, 0, 0, -0.25 * a); fx.rot(B.shin_L, 1, 0, 0, 0.5 * a); // pierna recogida al levitar
      fx.rot(B.thigh_R, 1, 0, 0, 0.1 * a); fx.rot(B.shin_R, 1, 0, 0, 0.25 * a);
      if (B.tail_1) { fx.rot(B.tail_1, 1, 0, 0, -0.4 * a); if (B.tail_3) fx.rot(B.tail_3, 0, 1, 0, 0.3 * Math.sin(t * 4) * a); }
    });
  }
  // el centro de la estructura: sobre Voya (levita)
  hub() { const p = this.p; return V(p.pos.x, p.pos.y + p.H * 0.55 + this.liftK * this.def.lift, p.pos.z); }
  layout(dt) {
    const c = this.hub(), d = this.def;
    this.spinV += dt;
    this.rings.forEach((r, i) => {
      r.g.position.copy(c);
      r.g.rotation.set(0.35 + 0.1 * Math.sin(this.t * 0.8 + i * 2), this.t * 0.3 + i * 0.7, -0.2 + 0.08 * i);
      const s = this.size * (1.6 + i * 0.9) + this.fronts[i];
      r.g.scale.setScalar(Math.max(0.01, s));
      r.spin.rotation.y += dt * (1.5 + this.spinV * 3) * (i % 2 ? -1 : 1);
      r.U.uT.value = this.t * (1 + i * 0.3);
    });
    this.core.position.copy(c); this.halo.position.copy(c);
    this.light.position.copy(c);
    void d;
  }
  tickRise(dt, k) {
    const e = ease(k);
    this.liftK = e; this.armK = e; this.size = e;
    this.pose.dy = this.def.lift * e;
    this.layout(dt);
    this.rings.forEach((r) => { r.U.uK.value = e; });
    this.core.scale.setScalar(0.25 + 0.15 * e); this.halo.scale.setScalar(0.8 * e + 0.01);
    this.light.intensity = 4 * e;
    // el Éter sube desde el suelo hacia el núcleo
    const c = this.hub();
    for (let i = 0; i < 3; i++) { const a = rnd(0, TAU), r = rnd(1.5, 4); const s = V(c.x + Math.cos(a) * r, this.p.pos.y + 0.1, c.z + Math.sin(a) * r); this.g.fx.spark.emit(s.x, s.y, s.z, (c.x - s.x) * 1.5, (c.y - s.y) * 1.5, (c.z - s.z) * 1.5, 0.6, 0.06, 0.02, i % 2 ? ETHER.sky : ETHER.gold, ETHER.deep, 0.9, 0, 0, 1); }
  }
  enterExpand() { this.hitSets = [new Set(), new Set(), new Set()]; this.sfx('vortex'); this.shake(0.15); }
  tickExpand(dt, k) {
    const d = this.def, p = this.p, c = this.hub();
    this.pose.dy = d.lift;
    // cada anillo se expande con un pequeño desfase: su frente barre la zona
    for (let i = 0; i < 3; i++) {
      const ki = clamp((k - i * 0.15) / 0.7, 0, 1), base = this.size * (1.6 + i * 0.9);
      this.fronts[i] = ease(ki) * (d.radius - base);
      const R = base + this.fronts[i];
      // golpe del frente del anillo
      for (const t of this.combat.inCircle(p.pos.x, p.pos.z, R + 0.5)) {
        if (this.hitSets[i].has(t)) continue;
        const dd = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
        if (dd < R - 2.2) continue; // solo el frente
        this.hitSets[i].add(t);
        this.hit(t, d.ringDamage);
        const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z);
        this.combat.push(t, dx, dz, d.ringForce);
        cosmic(this.g, V(t.pos.x, t.pos.y + 0.8, t.pos.z), 8, 2.5, 0.4);
      }
      if (Math.random() < 0.6) { const a = rnd(0, TAU); cosmic(this.g, V(c.x + Math.cos(a) * R, c.y + rnd(-0.3, 0.3), c.z + Math.sin(a) * R), 2, 1, 0.2); }
    }
    this.layout(dt);
    this.core.scale.setScalar(0.4 + 0.25 * k + 0.05 * Math.sin(this.t * 20));
    this.halo.scale.setScalar(0.8 + 0.9 * k);
    this.light.intensity = 4 + 4 * k;
    this.pushK = 0;
    if (Math.random() < 0.5) this.vfx.bolt(c, V(c.x + rnd(-3, 3), c.y + rnd(-1, 2), c.z + rnd(-3, 3)), { color: ETHER.sky, life: 0.08, jag: 0.3, segs: 8 });
  }
  enterBurst() {
    const d = this.def, p = this.p, c = this.hub();
    this.sfx('blast'); this.shake(0.5);
    this.g.chase.fovKick = Math.max(this.g.chase.fovKick || 0, 10);
    this.vfx.orb(c.clone(), { r: 2.5, color: ETHER.white, opacity: 0.9, life: 0.35, grow: 2.2 });
    if (this.v2) this.v2.shell(c.clone(), { r: d.radius * 0.6, color: ETHER.blue, rim: ETHER.white, opacity: 0.6, life: 0.5 });
    for (let i = 0; i < 3; i++) this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.5, r1: d.radius * (0.7 + 0.2 * i), dur: 0.5 + 0.15 * i, color: [ETHER.sky, ETHER.gold, ETHER.white][i], opacity: 0.8 });
    for (const t of this.combat.inCircle(p.pos.x, p.pos.z, d.radius)) {
      this.hit(t, d.damage);
      const { dx, dz } = this.awayFrom(t, p.pos.x, p.pos.z);
      this.combat.push(t, dx, dz, d.force);
      this.vfx.bolt(c, V(t.pos.x, t.pos.y + 0.8, t.pos.z), { color: ETHER.white, life: 0.16, jag: 0.4, segs: 10 });
    }
    cosmic(this.g, c, 40, 6, 1.2);
  }
  tickBurst(dt, k) {
    this.pushK = ease(Math.min(1, k * 3));
    this.fronts = this.fronts.map((f) => f * (1 + dt * 2));
    this.layout(dt);
    this.rings.forEach((r) => { r.U.uK.value = 1 - k; r.U.uFlash.value = 1 - k; });
    this.core.scale.setScalar(0.65 * (1 - k) + 0.01); this.halo.scale.setScalar(1.7 + 2 * k);
    this.halo.material.opacity = 0.18 * (1 - k);
    this.light.intensity = 10 * (1 - k);
  }
  tickLand(dt, k) {
    const e = ease(k);
    this.liftK = 1 - e; this.armK = 1 - e; this.pushK = (1 - e) * 0.6;
    this.pose.dy = this.def.lift * (1 - e);
    this.rings.forEach((r) => { r.g.scale.multiplyScalar(0.97); r.U.uK.value = 0; });
    this.core.scale.setScalar(0.01); this.halo.scale.setScalar(0.01);
    if (Math.random() < 0.5) cosmic(this.g, this.center(0.5), 3, 1.5, 0.8);
  }
  cleanup() { this.pose.dy = 0; }
}

/* ======================================================================
   PODER — DISTORSIÓN DIMENSIONAL Y MANIPULACIÓN DE GRAVEDAD (botón 2)
   EXTENDER  · Voya extiende la mano hacia el objetivo (o hacia delante): sobre él el espacio se dobla — una lente
               de Éter que oscurece y curva la luz, ondas que se propagan y grietas luminosas que se abren en el aire.
   GRAVEDAD  · con la mano abierta controla la gravedad: los enemigos cercanos se elevan y giran alrededor de la
               distorsión junto con fragmentos de roca arrancados del suelo; reciben daño continuo.
   COMPRIMIR · cierra el puño: la gravedad comprime el espacio y todo cae hacia el centro de la distorsión.
   ONDA      · el espacio se libera en una poderosa onda de energía dimensional: gran daño y empuje en el radio.
   Todas las poses mueven el esqueleto (setBones).
   ====================================================================== */
const ROCK_GEOS = [new THREE.IcosahedronGeometry(1, 0), new THREE.DodecahedronGeometry(1, 0), new THREE.OctahedronGeometry(1, 0)];
export class GravityRiftSkill extends Skill {
  begin() {
    const d = this.def, p = this.p;
    // objetivo: el que tiene delante; si no, el enemigo más cercano a su alrededor; si no hay, el punto de delante
    let t = this.combat.aimTarget(p.pos.x, p.pos.z, p.facing, 45 * DEG, d.range);
    if (!t) { let bd = d.range * 0.7; for (const e of this.combat.enemies()) { const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z); if (dd < bd) { bd = dd; t = e; } } }
    let x, z;
    if (t) { x = t.pos.x; z = t.pos.z; this.face(x, z); }
    else { const f = this.fwd; x = p.pos.x + f.x * d.ahead; z = p.pos.z + f.z * d.ahead; }
    this.c = V(x, this.gy(x, z) + d.lift, z);
    this.start();
    return true;
  }
  build() {
    const d = this.def;
    return [
      { name: 'extender', dur: d.prep, enter: this.enterReach, tick: this.tickReach },
      { name: 'gravedad', dur: d.exec, enter: this.enterGravity, tick: this.tickGravity },
      { name: 'comprimir', dur: d.compressT, enter: this.enterCompress, tick: this.tickCompress },
      { name: 'onda', dur: d.recover, enter: this.enterWave, tick: this.tickWave },
    ];
  }
  hand() { return boneWorld(this, 'hand_end_R') || boneWorld(this, 'hand_R') || this.center(0.7); }
  enterReach() {
    const c = this.c;
    this.armK = 0; this.fist = 0; this.held = new Map(); this.rocks = [];
    // LENTE: esfera oscura con borde de luz (el espacio curvado) + núcleo
    this.lens = this.v2.shell(c, { r: 0.1, color: ETHER.deep, rim: ETHER.sky, opacity: 0.85, power: 1.6, core: 0.22, additive: false, life: 99, seg: 40 });
    this.halo = this.v2.shell(c, { r: 0.1, color: ETHER.violet, rim: ETHER.white, opacity: 0.6, power: 3.5, core: 0, life: 99, seg: 40 });
    this.track({ kill: () => { this.lens.kill(); this.halo.kill(); } });
    this.light = new THREE.PointLight(ETHER.blue, 0, 12, 1.6); this.light.position.copy(c); this.prop(this.light);
    // anillo de Saturno tumbado alrededor de la distorsión (el horizonte de la gravedad)
    this.R = saturnRing({ inner: 0.78, opacity: 0.7 }); this.R.g.position.copy(c); this.prop(this.R.g);
    this.track({ kill: () => this.R.dispose() });
    this.rippleT = 0; this.crackT = 0; this.zapT = 0;
    this.sfx('vortex'); this.sfx('warp');
    if (this.v2.ambience) this.v2.ambience({ color: '#0a1446', alpha: 0.32, blend: 'multiply', dur: this.def.prep + this.def.exec + this.def.compressT + 0.4, fin: 0.4, fout: 0.6 });
    // ESQUELETO: brazo derecho extendido hacia la distorsión con la palma abierta; el izquierdo atrás para
    // equilibrar; el torso gira hacia el objetivo y la cabeza mira la distorsión. El puño se cierra al comprimir.
    this.setBones((B, dt, t, fx) => {
      const a = this.armK, f = this.fist, tr = 0.03 * Math.sin(t * 22) * a; // la mano tiembla por el esfuerzo
      fx.rot(B.upper_arm_R, 1, 0, 0, -1.45 * a + tr); fx.rot(B.upper_arm_R, 0, 0, 1, -0.15 * a);
      fx.rot(B.forearm_R, 1, 0, 0, -0.15 * a - 0.35 * f);
      if (B.hand_R) fx.rot(B.hand_R, 1, 0, 0, 0.5 * a - 0.4 * f);
      fx.rot(B.upper_arm_L, 0, 0, 1, 0.55 * a); fx.rot(B.upper_arm_L, 1, 0, 0, 0.35 * a);
      fx.rot(B.forearm_L, 1, 0, 0, -0.5 * a);
      fx.rot(B.chest, 0, 1, 0, -0.3 * a); fx.rot(B.spine, 0, 1, 0, -0.15 * a); fx.rot(B.chest, 1, 0, 0, -0.08 * a + 0.12 * f);
      fx.rot(B.head, 1, 0, 0, -0.08 * a);
      if (B.tail_1) fx.rot(B.tail_1, 1, 0, 0, -0.4 * a);
      if (B.ear_L_1) { fx.rot(B.ear_L_1, 1, 0, 0, -0.3 * a); fx.rot(B.ear_R_1, 1, 0, 0, -0.3 * a); }
    });
    // fragmentos de roca que la gravedad arrancará del suelo
    const mat = new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 0.85, metalness: 0.05, emissive: new THREE.Color(ETHER.blue), emissiveIntensity: 0.25, flatShading: true });
    this.track({ kill: () => mat.dispose() });
    for (let i = 0; i < this.def.rocks; i++) {
      const m = new THREE.Mesh(ROCK_GEOS[i % ROCK_GEOS.length], mat);
      m.userData.own = true; m.castShadow = true;
      const a = (i / this.def.rocks) * TAU + rnd(-0.3, 0.3), r = rnd(1.4, this.def.radius * 0.8);
      const gx = c.x + Math.cos(a) * r, gz = c.z + Math.sin(a) * r;
      const s = rnd(0.12, 0.32);
      m.scale.set(s * rnd(0.8, 1.3), s * rnd(0.7, 1.1), s * rnd(0.8, 1.3));
      m.position.set(gx, this.gy(gx, gz) - s, gz);
      m.visible = false;
      this.prop(m);
      this.rocks.push({ m, a, r, h: rnd(-0.8, 1.6), spd: rnd(0.9, 1.6) * (Math.random() < 0.5 ? 1 : -1), sp: V(rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)), y0: m.position.y, up: 0 });
    }
  }
  // la lente del espacio curvado: tamaño, ondas y grietas de luz
  drawLens(dt, size, wob = 1) {
    const c = this.c, t = this.t;
    this.lens.mesh.position.copy(c); this.halo.mesh.position.copy(c);
    const s = size * (1 + 0.05 * Math.sin(t * 9) * wob);
    this.lens.mesh.scale.set(s, s * (1 + 0.04 * Math.sin(t * 13)), s);
    this.halo.mesh.scale.setScalar(s * 1.35);
    this.R.g.position.copy(c);
    this.R.g.rotation.set(0.35 + 0.08 * Math.sin(t * 1.7), t * 0.6, 0.12 * Math.cos(t * 1.3));
    this.R.g.scale.setScalar(Math.max(0.01, size * 2.4));
    this.R.spin.rotation.y += dt * 5;
    this.R.U.uT.value = t; this.R.U.uK.value = Math.min(1, size);
    this.light.intensity = 2 + 4 * size;
    // ondas: cáscaras de Éter que salen del centro (el espacio se dobla en capas)
    this.rippleT -= dt;
    if (this.rippleT <= 0 && size > 0.05) { this.rippleT = 0.16; etherWave(this, c, size * 3.2, 0.5); }
    // grietas luminosas que se abren en el aire alrededor de la distorsión
    this.crackT -= dt;
    if (this.crackT <= 0 && size > 0.05) {
      this.crackT = 0.05;
      const dir = V(rnd(-1, 1), rnd(-0.7, 0.9), rnd(-1, 1)).normalize();
      const a = c.clone().addScaledVector(dir, size * 0.9), b = c.clone().addScaledVector(dir, size * rnd(1.8, 3.2));
      this.vfx.bolt(a, b, { color: Math.random() < 0.6 ? ETHER.white : ETHER.sky, life: 0.12, jag: 0.35, segs: 7 });
    }
  }
  tickReach(dt, k) {
    this.armK = ease(Math.min(1, k * 1.6));
    this.drawLens(dt, ease(k) * 0.9);
    // un hilo de Éter une la palma con la distorsión
    if (Math.random() < 0.7) this.vfx.bolt(this.hand(), this.c, { color: ETHER.sky, life: 0.08, jag: 0.25, segs: 8 });
    if (Math.random() < 0.9) cosmic(this.g, this.hand(), 1, 0.8, 0.1);
  }
  enterGravity() { this.sfx('rumble'); this.shake(0.12); for (const r of this.rocks) r.m.visible = true; }
  // atrapa y eleva a los enemigos ligeros (los jefes, demasiado pesados, solo quedan frenados y reciben el daño)
  holdTargets(dt, k) {
    const d = this.def, c = this.c;
    for (const t of this.combat.inCircle(c.x, c.z, d.radius)) {
      if (t.prop) continue;
      let h = this.held.get(t);
      if (!h) { h = { a: Math.atan2(t.pos.z - c.z, t.pos.x - c.x), spin: rnd(2, 4) * (Math.random() < 0.5 ? 1 : -1), lift: 0 }; this.held.set(t, h); }
      if (t.heavy) { this.combat.slow(t, 0.5, 0.4); continue; }
      this.combat.root(t, 0.3);
      h.lift = Math.min(d.liftMax, h.lift + dt * 2.2);
      t.liftY = h.lift + 0.15 * Math.sin(this.t * 4 + h.a);
      t.liftSpin = (t.liftSpin || 0) + dt * h.spin;
      // gira alrededor de la distorsión y se acerca poco a poco
      const dx = t.pos.x - c.x, dz = t.pos.z - c.z, r = Math.hypot(dx, dz);
      const ang = Math.atan2(dz, dx) + dt * 1.6, nr = Math.max(1.2, r - dt * 1.2);
      this.combat.push(t, c.x + Math.cos(ang) * nr - t.pos.x, c.z + Math.sin(ang) * nr - t.pos.z, Math.min(6, Math.hypot(c.x + Math.cos(ang) * nr - t.pos.x, c.z + Math.sin(ang) * nr - t.pos.z) * 4));
    }
  }
  tickGravity(dt, k) {
    const d = this.def, c = this.c;
    this.armK = 1;
    this.drawLens(dt, 0.9 + 0.1 * Math.sin(this.t * 5));
    this.holdTargets(dt, k);
    // daño continuo de la gravedad
    this.zapT -= dt;
    if (this.zapT <= 0) {
      this.zapT = d.tickEvery;
      for (const t of this.held.keys()) if (!t.dead) { this.hit(t, d.tickDamage); const q = V(t.pos.x, t.pos.y + (t.liftY || 0) + 0.8, t.pos.z); this.vfx.bolt(c, q, { color: ETHER.sky, life: 0.1, jag: 0.3, segs: 8 }); cosmic(this.g, q, 4, 1.6, 0.3); }
    }
    // las rocas se arrancan del suelo, levitan y orbitan alrededor de la distorsión
    for (const r of this.rocks) {
      r.up = Math.min(1, r.up + dt * 1.4);
      r.a += dt * r.spd * (0.6 + 0.6 * r.up);
      const e = ease(r.up), y = lerp(r.y0, c.y + r.h, e);
      r.m.position.set(c.x + Math.cos(r.a) * r.r, y + 0.1 * Math.sin(this.t * 3 + r.a), c.z + Math.sin(r.a) * r.r);
      r.m.rotation.x += dt * r.sp.x * e; r.m.rotation.y += dt * r.sp.y * e; r.m.rotation.z += dt * r.sp.z * e;
      if (r.up < 0.3 && Math.random() < 0.15) this.g.fx.dustPuff(r.m.position.x, r.y0 + 0.1, r.m.position.z, 0.8);
    }
    if (Math.random() < 0.8) { const a = rnd(0, TAU), rr = rnd(1, d.radius); cosmic(this.g, V(c.x + Math.cos(a) * rr, c.y + rnd(-1, 1.5), c.z + Math.sin(a) * rr), 1, 0.5, 0.05); }
    if (Math.random() < 0.5) this.vfx.bolt(this.hand(), c, { color: ETHER.sky, life: 0.07, jag: 0.3, segs: 8 });
    this.pose.rx = -0.04;
  }
  enterCompress() { this.sfx('dark'); this.shake(0.2); this.from = this.rocks.map((r) => r.m.position.clone()); }
  tickCompress(dt, k) {
    const c = this.c, e = ease(k);
    this.fist = e;
    // el espacio se comprime: la lente se encoge y brilla, todo cae hacia el centro
    this.drawLens(dt, lerp(0.9, 0.3, e), 2);
    this.lens.mat.uniforms.uOp.value = 0.85 + 0.15 * e;
    this.rocks.forEach((r, i) => { r.m.position.lerpVectors(this.from[i], c, e * 0.85); r.m.rotation.x += dt * 12; r.m.scale.multiplyScalar(1 - dt * 0.6); });
    for (const [t, h] of this.held) { if (t.dead || t.heavy) continue; t.liftY = h.lift * (1 - 0.4 * e); this.combat.pull(t, c, 6, 0.1); }
    if (Math.random() < 0.9) this.vfx.bolt(this.hand(), c, { color: ETHER.white, life: 0.06, jag: 0.2, segs: 6 });
    this.pose.rx = 0.06 * e;
  }
  enterWave() {
    const d = this.def, c = this.c, p = this.p;
    // ONDA DIMENSIONAL: destello, ondas esféricas y en el suelo, grietas, daño y empuje en el radio
    this.sfx('blast'); this.sfx('boom'); this.shake(0.45);
    this.vfx.orb(c.clone(), { r: 0.8, color: ETHER.white, opacity: 1, life: 0.25, grow: 5 });
    etherWave(this, c, d.radius + 1.5, 0.55);
    etherWave(this, c, (d.radius + 1.5) * 0.65, 0.4);
    const gy = this.gy(c.x, c.z);
    this.vfx.ring(c.x, null, c.z, { r0: 0.5, r1: d.radius * 1.7, dur: 0.6, color: ETHER.sky, opacity: 0.9 });
    this.vfx.ring(c.x, null, c.z, { r0: 0.3, r1: d.radius * 1.2, dur: 0.5, color: ETHER.gold, opacity: 0.6 });
    for (let i = 0; i < 8; i++) this.v2.crack(c.x, c.z, rnd(2, d.radius), (i / 8) * TAU + rnd(-0.2, 0.2), { life: 1.2, width: 0.18, color: ETHER.sky });
    for (let i = 0; i < 12; i++) { const dir = V(rnd(-1, 1), rnd(-0.4, 1), rnd(-1, 1)).normalize(); this.vfx.bolt(c, c.clone().addScaledVector(dir, rnd(2, 4.5)), { color: ETHER.white, life: 0.18, jag: 0.4, segs: 9 }); }
    cosmic(this.g, c, 40, 4.5, 0.6);
    for (const t of this.combat.inCircle(c.x, c.z, d.radius + 1)) {
      this.hit(t, d.damage);
      const { dx, dz } = this.awayFrom(t, c.x, c.z);
      this.combat.push(t, dx, dz, d.force);
    }
    // los objetivos sueltos caen; las rocas salen despedidas
    this.drop = [...this.held.keys()].map((t) => ({ t, y: t.liftY || 0 }));
    this.held.clear();
    this.flying = this.rocks.map((r) => ({ r, v: V(rnd(-1, 1), rnd(0.3, 1.2), rnd(-1, 1)).normalize().multiplyScalar(rnd(9, 15)) }));
    this.lens.mesh.visible = false; this.halo.mesh.visible = false;
    void gy; void p;
  }
  tickWave(dt, k) {
    this.armK = 1 - ease(k); this.fist = 1 - ease(k);
    for (const o of this.drop) { if (!o.t.dead) o.t.liftY = o.y * (1 - ease(Math.min(1, k * 3))); }
    for (const f of this.flying) { f.v.y -= 22 * dt; f.r.m.position.addScaledVector(f.v, dt); f.r.m.rotation.x += dt * 9; f.r.m.scale.multiplyScalar(Math.max(0, 1 - dt * 2.2)); }
    this.R.g.scale.setScalar(Math.max(0.01, (1 - k) * 2.8)); this.R.U.uK.value = 1 - k; this.R.U.uFlash.value = 1 - k;
    this.light.intensity = 6 * (1 - k);
  }
  cleanup() {
    // nadie se queda flotando aunque la habilidad se corte
    for (const t of this.combat.targets()) if (t.liftY) { t.liftY = 0; }
  }
}

/* ======================================================================
   ESCUDO — REGENERACIÓN LEGENDARIA (botón 3; 4 s de protección total, como todos los escudos)
   ACTIVAR    · un campo de Éter envuelve todo su cuerpo (esfera de energía con anillo de Saturno a su alrededor).
   ABSORBER   · el escudo atrae la energía del ambiente: partículas de luz que convergen hacia Voya desde todas
                partes y recorren su cuerpo de los pies a la cabeza como una corriente regeneradora.
   REGENERAR  · sobre su cabeza aparece una barra de vida holográfica que se rellena hasta el 100 %; la vida real
                del héroe sube con ella (sin botiquines). El escudo brilla más cuanto más se recupera.
   COMPLETAR  · al llegar al 100 %, destello de energía que confirma la recuperación total; el campo se disuelve.
   ====================================================================== */
function holoBar() {
  const W = 256, H = 72;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, blending: THREE.AdditiveBlending });
  const s = new THREE.Sprite(mat);
  s.userData.own = true; s.renderOrder = 20; s.scale.set(1.5, 0.42, 1);
  let last = -1;
  const draw = (pct, t) => {
    const key = Math.round(pct * 200) + (Math.floor(t * 20) % 2) * 1000;
    if (key === last) return; last = key;
    x.clearRect(0, 0, W, H);
    // marco holográfico
    x.strokeStyle = 'rgba(159,192,255,0.95)'; x.lineWidth = 3; x.strokeRect(8, 26, W - 16, 30);
    x.fillStyle = 'rgba(42,76,255,0.25)'; x.fillRect(8, 26, W - 16, 30);
    // relleno con líneas de barrido
    const w = (W - 22) * pct;
    const g = x.createLinearGradient(11, 0, 11 + w, 0); g.addColorStop(0, 'rgba(106,168,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0.95)');
    x.fillStyle = g; x.fillRect(11, 29, w, 24);
    x.fillStyle = 'rgba(255,255,255,0.18)'; for (let i = 0; i < 24; i += 4) x.fillRect(11, 29 + i, w, 1);
    // texto
    x.font = 'bold 22px sans-serif'; x.textAlign = 'center'; x.fillStyle = 'rgba(220,232,255,1)';
    x.fillText(`VIDA ${Math.round(pct * 100)} %`, W / 2, 20);
    tex.needsUpdate = true;
  };
  return { s, draw, dispose() { tex.dispose(); mat.dispose(); } };
}
export class LegendaryRegenSkill extends Skill {
  begin() {
    const r = this.g.hpRef;
    this.hp0 = r ? r.hp : 0; this.max = r ? r.max : 100;
    this.start();
    return true;
  }
  build() {
    const d = this.def;
    return [
      { name: 'activar', dur: d.prep, enter: this.enterOn, tick: this.tickOn },
      { name: 'regenerar', dur: d.exec, tick: this.tickRegen },
      { name: 'completar', dur: d.recover, enter: this.enterDone, tick: this.tickDone },
    ];
  }
  get rad() { return this.def.radius * Math.max(0.8, this.p.H / 1.85); }
  enterOn() {
    const c = this.center(0.5);
    this.field = this.v2.shell(c, { r: 0.1, color: ETHER.blue, rim: ETHER.sky, opacity: 0.55, power: 2.2, core: 0.05, life: 99, seg: 40 });
    this.track({ kill: () => this.field.kill() });
    this.R = saturnRing({ inner: 0.86, opacity: 0.75 }); this.prop(this.R.g); this.track({ kill: () => this.R.dispose() });
    this.bar = holoBar(); this.prop(this.bar.s); this.track({ kill: () => this.bar.dispose() });
    this.light = new THREE.PointLight(ETHER.sky, 0, 7, 1.8); this.prop(this.light);
    this.openK = 0; this.glow = 0; this.flowT = 0; this.healed = 0;
    this.sfx('shimmer'); this.sfx('aurora');
    this.vfx.ring(c.x, null, c.z, { r0: 0.3, r1: this.rad + 1.2, dur: 0.45, color: ETHER.sky, opacity: 0.75 });
    // ESQUELETO: brazos algo abiertos con las palmas hacia fuera, pecho y cabeza arriba (recibe la energía)
    this.setBones((B, dt, t, fx) => {
      const e = this.openK, br = 0.05 * Math.sin(t * 2.4) * e;
      fx.rot(B.upper_arm_L, 0, 0, 1, (0.6 + br) * e); fx.rot(B.upper_arm_R, 0, 0, 1, -(0.6 + br) * e);
      fx.rot(B.forearm_L, 0, 0, 1, 0.35 * e); fx.rot(B.forearm_R, 0, 0, 1, -0.35 * e);
      fx.rot(B.chest, 1, 0, 0, -0.14 * e); fx.rot(B.head, 1, 0, 0, -0.22 * e);
      if (B.tail_1) fx.rot(B.tail_1, 1, 0, 0, -0.25 * e);
    });
  }
  place(dt, size) {
    const c = this.center(0.5), R = this.rad, t = this.t;
    this.field.mesh.position.copy(c);
    this.field.mesh.scale.set(R * size * 0.75, R * size * (1.05 + 0.02 * Math.sin(t * 5)), R * size * 0.75);
    this.field.mat.uniforms.uOp.value = (0.35 + 0.45 * this.glow) * Math.min(1, size);
    this.field.mat.uniforms.uRim.value.setHex(ETHER.sky).lerp(new THREE.Color(ETHER.white), this.glow * 0.6);
    this.R.g.position.copy(c).add(V(0, -this.p.H * 0.3 + this.p.H * 0.6 * (0.5 + 0.5 * Math.sin(t * 1.6)), 0)); // el anillo recorre el cuerpo arriba y abajo
    this.R.g.rotation.set(0.12 * Math.sin(t * 1.1), t * 0.8, 0.1 * Math.cos(t * 1.4));
    this.R.g.scale.setScalar(Math.max(0.01, R * 0.62 * size));
    this.R.spin.rotation.y += dt * 4;
    this.R.U.uT.value = t; this.R.U.uK.value = Math.min(1, size); this.R.U.uFlash.value = this.glow * 0.5;
    this.light.position.copy(c); this.light.intensity = size * (1.5 + 3.5 * this.glow);
    const top = this.center(1); this.bar.s.position.set(top.x, top.y + 0.55, top.z);
  }
  // la energía del ambiente converge en Voya y sube por su cuerpo
  absorbFx(dt, k) {
    const p = this.p, c = this.center(0.5), fx = this.g.fx;
    const n = 2 + Math.floor(3 * k);
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), r = rnd(2.5, 5), s = V(c.x + Math.cos(a) * r, c.y + rnd(-0.6, 1.8), c.z + Math.sin(a) * r);
      fx.spark.emit(s.x, s.y, s.z, (c.x - s.x) * 2.2, (c.y - s.y) * 2.2, (c.z - s.z) * 2.2, 0.45, 0.07, 0.02, Math.random() < 0.5 ? ETHER.white : ETHER.sky, ETHER.blue, 1, 0, 0, 1);
    }
    // corriente regeneradora: espiral de luz de los pies a la cabeza
    this.flowT += dt * 2.2;
    for (let j = 0; j < 2; j++) {
      const u = (this.flowT + j * 0.5) % 1, a = u * TAU * 3 + j * Math.PI;
      cosmic(this.g, V(p.pos.x + Math.cos(a) * 0.45, p.pos.y + u * p.H, p.pos.z + Math.sin(a) * 0.45), 1, 0.3, 0.03);
    }
  }
  tickOn(dt, k) {
    this.openK = ease(k); this.glow = 0;
    this.place(dt, ease(k));
    this.bar.s.material.opacity = k;
    this.bar.draw(this.hpPct(), this.t);
    this.absorbFx(dt, 0.4 * k);
  }
  hpPct() { const r = this.g.hpRef; return r ? clamp(r.hp / (r.max || 1), 0, 1) : 1; }
  tickRegen(dt, k) {
    const r = this.g.hpRef;
    // la vida sube progresivamente hasta el 100 % al final de esta etapa (sin botiquines)
    if (r && !r.ko && r.hp > 0 && r.hp < r.max) {
      const target = lerp(this.hp0, r.max, ease(k));
      if (target > r.hp) { this.healed += target - r.hp; r.hp = Math.min(r.max, target); this.g.hpDirty = true; }
    }
    this.openK = 1;
    this.glow = this.hpPct();
    this.place(dt, 1);
    this.bar.s.material.opacity = 1;
    this.bar.draw(this.hpPct(), this.t);
    this.absorbFx(dt, 0.6 + 0.4 * k);
    this.pose.sy = 1.02 + 0.01 * Math.sin(this.t * 6);
  }
  enterDone() {
    const r = this.g.hpRef, c = this.center(0.55), p = this.p;
    if (r && !r.ko && r.hp > 0) { if (r.hp < r.max) { this.healed += r.max - r.hp; r.hp = r.max; } this.g.hpDirty = true; if (this.g.saveHp) this.g.saveHp(true); }
    // destello que confirma la recuperación total
    this.vfx.orb(c.clone(), { r: 0.7, color: ETHER.white, opacity: 1, life: 0.25, grow: 4 });
    etherWave(this, c, this.rad * 2.4, 0.5);
    this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.4, r1: 4.5, dur: 0.6, color: ETHER.sky, opacity: 0.9 });
    this.vfx.ring(p.pos.x, null, p.pos.z, { r0: 0.2, r1: 3, dur: 0.5, color: ETHER.gold, opacity: 0.6 });
    cosmic(this.g, c, 34, 3.4, 0.6);
    if (this.g.floatAt) this.g.floatAt(p.pos, p.H + 0.75, this.healed >= 1 ? `+${Math.round(this.healed)} · 100 %` : '100 %', 'heal');
    try { ui.hpHeal(); } catch (e) { /* sin interfaz */ }
    this.sfx('chime'); this.shake(0.12);
    this.glow = 1;
  }
  tickDone(dt, k) {
    this.openK = 1 - ease(k);
    this.glow = 1 - k;
    this.place(dt, 1 - ease(k));
    this.bar.s.material.opacity = 1 - k;
    this.bar.draw(this.hpPct(), this.t);
  }
}

/* ======================================================================
   ARMA — CETRO DE SATURNO (botón 4). Se registra desde powers2.js (necesita la base de las armas).
   Combo: 1 · barrido horizontal con estela anular · 2 · giro completo (golpea alrededor) · 3 · golpe al suelo:
   el anillo del cetro se desprende y se expande como una onda que derriba a los enemigos cercanos.
   ====================================================================== */
export function makeSaturnStaffSkill(WeaponSkill, back) {
  return class SaturnStaffSkill extends WeaponSkill {
    begin() { this.aim(this.def.reach + 2); this.draw(); this.start(); return true; }
    build() {
      const d = this.def, extra = this.drawn ? 0.1 : 0;
      const glow = () => this.energy(ETHER.sky, 2, 1.6);
      const sweep = (arc, mul) => () => {
        this.W.swing(d.swing + 0.14);
        this.sfx('snap');
        const p = this.p;
        this.crescent(p.pos.y + p.H * 0.55, { r: d.reach, arc, color: ETHER.blue });
        this.crescent(p.pos.y + p.H * 0.6, { r: d.reach * 1.1, arc: arc * 0.9, color: ETHER.gold, width: 0.08, life: 0.18 });
        const n = this.hitArc(d.reach, arc, d.damage * mul, d.force, (t) => { this.impactAt(t); cosmic(this.g, V(t.pos.x, t.pos.y + 0.8, t.pos.z), 6, 2.2, 0.3); });
        if (n) this.shake(0.12);
      };
      if (this.step === 1) return [ // giro completo: el cetro barre a su alrededor
        this.stage('girar', 0.1 + extra, { x: -1.2, y: 1.0, f: -0.4, w: 0, r: 0.2 }, { spin: 0.5, tick: glow }),
        this.stage('giro', d.swing * 1.4, { x: -1.25, y: -1.0, f: -0.3, w: 0.3, r: 0.2 }, { spin: -TAU + 0.5, easeFn: back, enter: () => {
          this.W.swing(d.swing * 1.6); this.sfx('warp');
          const p = this.p;
          this.crescent(p.pos.y + p.H * 0.5, { r: d.reach, arc: 359, color: ETHER.blue, life: 0.3 });
          this.hitRing(d.reach, d.damage * this.mul, d.force, (t) => this.impactAt(t));
        }, tick: glow }),
        this.recover(d.recover),
      ];
      if (this.step === 2) return [ // golpe al suelo con onda anular
        this.stage('alzar', 0.16 + extra, { x: -2.4, y: 0.1, f: -0.6, w: 0, r: 0.2 }, { rx: -0.15, sy: 1.04, tick: glow }),
        this.stage('golpe', d.swing, { x: -0.9, y: 0.05, f: -0.2, w: 0.4, r: 0.2 }, { rx: 0.3, dy: -0.06, easeFn: back, exit: () => this.slam() }),
        this.recover(d.recover + 0.08),
      ];
      return [ // barrido horizontal
        this.stage('preparar', d.prep + extra, { x: -0.9, y: 0.9, f: -0.9, w: 0, r: 0.2 }, { spin: 0.35, rx: -0.05, enter: () => { this.p.powerAnim = 1; }, tick: glow }),
        this.stage('barrido', d.swing, { x: -1.2, y: -1.0, f: -0.3, w: 0.3, r: 0.2 }, { spin: -0.45, easeFn: back, enter: sweep(d.arcDeg, this.mul) }),
        this.recover(d.recover),
      ];
    }
    slam() {
      const d = this.def, p = this.p, f = this.fwd;
      const c = V(p.pos.x + f.x * 1.2, p.pos.y, p.pos.z + f.z * 1.2);
      this.sfx('boom'); this.shake(0.3);
      this.vfx.ring(c.x, null, c.z, { r0: 0.3, r1: d.ringR, dur: 0.5, color: ETHER.sky, opacity: 0.85 });
      this.vfx.ring(c.x, null, c.z, { r0: 0.2, r1: d.ringR * 0.75, dur: 0.4, color: ETHER.gold, opacity: 0.6 });
      // el anillo del cetro se desprende y se expande a ras de suelo
      const R = saturnRing({ inner: 0.8 });
      R.g.position.set(c.x, this.gy(c.x, c.z) + 0.15, c.z);
      this.vfx.add(R.g, 0.55, (it) => { const k = it.t / 0.55; R.g.scale.setScalar(0.3 + d.ringR * ease(k)); R.spin.rotation.y += 0.25; R.U.uT.value = it.t; R.U.uK.value = 1 - k; if (it.t >= 0.549) R.dispose(); });
      for (const t of this.combat.inCircle(c.x, c.z, d.ringR)) {
        this.hit(t, d.damage * this.mul * 1.2);
        const { dx, dz } = this.awayFrom(t, c.x, c.z);
        this.combat.push(t, dx, dz, d.force * 1.6);
        this.impactAt(t, 1.2);
      }
      cosmic(this.g, V(c.x, c.y + 0.3, c.z), 24, 4, 0.6);
      this.finisher(ETHER.blue, ETHER.gold);
    }
  };
}
