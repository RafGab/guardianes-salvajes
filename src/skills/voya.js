import * as THREE from 'three';
import { rnd, TAU } from './attack.js';
import { Skill, ease, lerp, clamp, V, DEG, boneWorld } from './base.js';
import { ui } from '../ui.js';

/* ======================================================================
   VOYA — EL LEÓN BLANCO DEL ÉTER (octavo héroe)
   Su poder son los ANILLOS DE SATURNO: bandas de energía cósmica (azul de las gemas de su armadura, blanco
   estelar y un leve brillo dorado de polvo de anillo) que giran, golpean, protegen y estallan.
   · Velocidad (botón 1) · Impulso Etéreo: estela de partículas cósmicas y fragmentos de luz (speedVoya).
   · Poder (botón 2)     · Anillo Astral: invoca un anillo que gira, sale disparado, golpea y vuelve a su mano.
   · Escudo (botón 3)    · Órbita de Saturno: tres anillos orbitales a su alrededor bloquean proyectiles y golpes
                           y apartan a los enemigos que los tocan (4 s, como todos los escudos).
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

/* ======================================================================
   VELOCIDAD — IMPULSO ETÉREO (efecto del botón 1; lo llama SpeedFxSkill.tick como this.voya)
   Se inclina hacia delante con los brazos atrás (esqueleto), un anillo de luz destella bajo los pies con cada
   zancada y deja una estela de partículas cósmicas y pequeños fragmentos de luz que se apagan poco a poco.
   ====================================================================== */
export function speedVoya(dt, k, bx, bz, sp, step) {
  const p = this.p, pose = this.pose, fx = this.g.fx;
  if (!this._voyaInit) {
    this._voyaInit = true;
    const c = p.pos;
    this.vfx.ring(c.x, null, c.z, { r0: 0.3, r1: 3.6, dur: 0.45, color: ETHER.sky, opacity: 0.8 });
    this.vfx.ring(c.x, null, c.z, { r0: 0.2, r1: 2.4, dur: 0.35, color: ETHER.gold, opacity: 0.5 });
    this.sfx('warp');
    // esqueleto: brazos echados hacia atrás y pecho adelantado mientras dura el impulso (si ningún poder mueve los huesos)
    const m = p.model;
    if (m && m.bones && !m.boneFx) {
      this._voyaBones = (B, dt2, t, bfx) => {
        const e = clamp(this._voyaK || 0, 0, 1);
        bfx.rot(B.upper_arm_L, 1, 0, 0, 0.55 * e); bfx.rot(B.upper_arm_R, 1, 0, 0, 0.55 * e);
        bfx.rot(B.upper_arm_L, 0, 0, 1, 0.25 * e); bfx.rot(B.upper_arm_R, 0, 0, 1, -0.25 * e);
        bfx.rot(B.chest, 1, 0, 0, 0.18 * e); bfx.rot(B.head, 1, 0, 0, -0.2 * e);
        if (B.tail_1) bfx.rot(B.tail_1, 1, 0, 0, -0.5 * e); // la cola se estira detrás
      };
      m.boneFx = this._voyaBones;
      this.track({ kill: () => { if (m.boneFx === this._voyaBones) m.boneFx = null; } });
    }
  }
  this._voyaK = lerp(this._voyaK || 0, this.active ? k : 0, Math.min(1, dt * 6));
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
  // con cada zancada, un anillo orbital destella bajo los pies
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
