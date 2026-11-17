import * as THREE from 'three';
import { rnd, TAU } from './attack.js';
import { clamp, lerp, V, boneWorld } from './base.js';
import { Trail } from '../weapons/system.js';

// MEJORAS DEL BOTÓN DE VELOCIDAD (se instalan sobre SpeedFxSkill, en powers2.js):
//  · KAIRO — carrera cometaria: llamas pequeñas en los pies y una estela tipo cometa Halley por detrás y por debajo
//    (sin resplandor que tape al personaje)
//  · KIRA — brazos de patinadora (equilibrio, compensación en las curvas, codos flexionados), sobre su animación de patinaje
//  · BADA — cuerpo de arena viva: granos que se desprenden y se recomponen, y textura granulada mientras corre
//    (se conserva el remolino de arena de los pies)
//  · ÁMBAR — rayos azules en los pies y estela eléctrica azul
//  · NILO — skyboard: burbujas con reflejos e irisaciones, de tamaños y trayectorias variadas, y estela de energía bajo las botas
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const FOOT = ['foot_L', 'foot_R'];

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
function sandMaterial(src, U) {
  const m = src.clone();
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSOP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSOP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uSand; uniform float uST; uniform float uSNS; varying vec3 vSOP;
        float sH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 sp = vSOP * uSNS;
        float grain = sH(floor(sp * 22.0));                                         // granos finos
        float flow = 0.5 + 0.5 * sin(sp.z * 9.0 + sp.y * 5.0 + uST * 7.0);          // ondas de arena que recorren el cuerpo
        float k = uSand * (0.55 + 0.45 * flow);
        vec3 sand = mix(vec3(0.86, 0.7, 0.45), vec3(0.72, 0.55, 0.32), grain);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * (0.82 + 0.36 * grain), 0.6 * uSand); // textura granulada
        diffuseColor.rgb = mix(diffuseColor.rgb, sand * (0.6 + 0.6 * dot(diffuseColor.rgb, vec3(0.33))), 0.28 * k);`);
  };
  m.customProgramCacheKey = () => 'sandbody-' + (src.customProgramCacheKey ? src.customProgramCacheKey() : src.type);
  m.userData.own = true;
  return m;
}

export const SPEED2 = {
  // ---------------- KAIRO: CARRERA LLAMEANTE (cometa Halley) ----------------
  kairo(dt, k, bx, bz, sp) {
    const pose = this.pose, p = this.p, fx = this.g.fx;
    pose.rx = Math.max(pose.rx, 0.1 + 0.28 * k * k); // se inclina con la velocidad, pero se le ve bien el cuerpo
    const on = this.active ? 1 : 0;
    const feet = feetPos(this);
    // estela del cometa: dos colas que salen de los talones, por debajo y por detrás (cálidas, poco brillo)
    const tr = trails(this, '_cometTr', 0xff7a1a, 0xffd27a, 26, 0.32);
    feet.forEach((f, i) => {
      const gy = Math.min(f.y, p.pos.y + 0.12);
      tpush(tr[i], this, V(f.x + bx * 0.12, gy + 0.02, f.z + bz * 0.12), V(f.x + bx * 0.18, gy + 0.17 + 0.06 * k, f.z + bz * 0.18));
      tr[i].update(dt, on && sp > 1.5);
      if (!on) return;
      // llamas de energía en los pies: pequeñas, cortas y hacia atrás (no forman una capa de luz alrededor)
      const n = 1 + Math.round(1.5 * k);
      for (let j = 0; j < n; j++) fx.fire.emit(f.x + rnd(-0.06, 0.06), f.y + 0.02, f.z + rnd(-0.06, 0.06), bx * rnd(2, 4.5) * (0.5 + k), rnd(0.1, 0.7), bz * rnd(2, 4.5) * (0.5 + k), rnd(0.18, 0.32), 0.26, 0.06, 0xffd890, 0xff4a0a, 0.55, 0, 0, 2);
    });
    if (!on) return;
    // núcleo del cometa en la cola: chispas pequeñas y algún fragmento incandescente que se queda atrás
    if (Math.random() < 0.6 * k) {
      const q = this.path[Math.min(this.path.length - 1, 3 + Math.floor(Math.random() * 10))];
      if (q) fx.spark.emit(q.x + rnd(-0.2, 0.2), q.y + rnd(0.05, 0.3), q.z + rnd(-0.2, 0.2), bx * rnd(0.5, 1.5), rnd(0.3, 1.2), bz * rnd(0.5, 1.5), rnd(0.35, 0.6), 0.09, 0.02, 0xffd070, 0xff5010, 0.8, 0, -1, 1);
    }
    if (Math.random() < 0.25 * k) { const q = this.path[Math.min(this.path.length - 1, 8)]; if (q) fx.smokePuff(q.x, q.y + 0.15, q.z, 0.35, 0x3a2a22); } // humo tenue al final de la cola
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
    if (U) { U.uSand.value = damp(U.uSand.value, on * clamp(0.35 + 0.65 * k, 0, 1), on ? 4 : 2.5, dt); U.uST.value = this.t; }
    // granos que se desprenden del cuerpo (espalda, brazos, orejas y cola) y se quedan atrás siguiendo su movimiento;
    // la cara y los ojos se dejan libres para que siempre sea reconocible
    const I = U ? U.uSand.value : on * k;
    if (I < 0.03) return;
    const B = p.model && p.model.bones;
    const src = this.sandSrc || (this.sandSrc = ['spine', 'spine_1', 'upper_arm_L', 'upper_arm_R', 'forearm_L', 'forearm_R', 'ear_L1', 'ear_R1', 'ear_L2', 'ear_R2', 'tail1', 'tail2', 'tail3', 'thigh_L', 'thigh_R'].filter((n) => B && B[n]));
    const n = Math.round(4 + 10 * I);
    for (let i = 0; i < n; i++) {
      let x, y, z;
      const name = src.length ? src[Math.floor(Math.random() * src.length)] : null;
      const w = name && boneWorld(this, name, this._sw || (this._sw = new THREE.Vector3()));
      if (w) { x = w.x + rnd(-0.07, 0.07); y = w.y + rnd(-0.07, 0.07); z = w.z + rnd(-0.07, 0.07); }
      else { x = p.pos.x + rnd(-0.25, 0.25); y = p.pos.y + rnd(0.3, p.H * 0.85); z = p.pos.z + rnd(-0.25, 0.25); }
      const v = rnd(1.5, 3.5) * (0.4 + I);
      fx.water.emit(x, y, z, bx * v + rnd(-0.3, 0.3), rnd(-0.1, 0.5), bz * v + rnd(-0.3, 0.3), rnd(0.4, 0.8), rnd(0.035, 0.06), 0.015, Math.random() < 0.5 ? 0xe2bf7a : 0xc89a58, 0xb8884a, 0.95, 0, -2.5, 1.2);
    }
    // de vez en cuando una zona se dispersa en una nubecilla y se vuelve a juntar
    if (Math.random() < 0.12 * I && src.length) { const w = boneWorld(this, src[Math.floor(Math.random() * src.length)]); if (w) fx.dust.emit(w.x, w.y, w.z, bx * 1.2, 0.2, bz * 1.2, 0.5, 0.18, 0.4, 0xe0c080, 0xd0a868, 0.35, 0, 0, 1); }
  },
  sandBody() {
    const m = this.p.model;
    if (!m || !m.root) return null;
    const U = { uSand: { value: 0 }, uST: { value: 0 }, uSNS: { value: 4 } };
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

  // ---------------- ÁMBAR: RAYOS AZULES Y ESTELA ELÉCTRICA ----------------
  ambar(dt, k, bx, bz, sp) {
    const pose = this.pose, p = this.p, fx = this.g.fx, on = this.active ? 1 : 0;
    pose.rx = Math.max(pose.rx, 0.38 * k);
    const feet = feetPos(this);
    const tr = trails(this, '_voltTr', 0x2a6bff, 0x9fd8ff, 22, 0.42);
    feet.forEach((f, i) => {
      tpush(tr[i], this, V(f.x + bx * 0.1, f.y + 0.03, f.z + bz * 0.1), V(f.x + bx * 0.14, f.y + 0.2, f.z + bz * 0.14));
      tr[i].update(dt, on && sp > 1.5);
    });
    if (!on) return;
    // pequeños rayos que saltan alrededor de los pies (más en cada zancada)
    this.boltT = (this.boltT || 0) - dt;
    if (this.boltT <= 0) {
      this.boltT = 0.05 + Math.random() * 0.05;
      const f = feet[Math.random() < 0.5 ? 0 : 1], a = rnd(0, TAU), r = rnd(0.25, 0.5);
      this.vfx.bolt(V(f.x, f.y + 0.05, f.z), V(f.x + Math.cos(a) * r + bx * 0.3, f.y + rnd(-0.02, 0.25), f.z + Math.sin(a) * r + bz * 0.3), { color: 0x3a8cff, life: 0.07, jag: 0.12, segs: 6 });
    }
    // partículas eléctricas que se desprenden de los pies
    for (const f of feet) if (Math.random() < 0.7) fx.spark.emit(f.x, f.y + 0.05, f.z, bx * rnd(1, 3) + rnd(-1, 1), rnd(0.3, 1.6), bz * rnd(1, 3) + rnd(-1, 1), rnd(0.15, 0.3), 0.07, 0.02, 0xbfe4ff, 0x2a6bff, 0.9, 0, -2, 1);
    // un arco a lo largo de la estela de vez en cuando
    if (k > 0.5 && Math.random() < 0.12) { const a = this.path[2], b = this.path[Math.min(this.path.length - 1, 9)]; if (a && b) this.vfx.bolt(V(a.x, a.y + 0.1, a.z), V(b.x, b.y + 0.1, b.z), { color: 0x4a9cff, life: 0.08, jag: 0.3, segs: 8 }); }
    // estela de viento de siempre, más suave para que destaque la electricidad
    if (Math.random() < 0.5) { const f = this.feet(0.25, bx, bz); fx.mist(f.x + rnd(-0.2, 0.2), f.y + 0.15, f.z + rnd(-0.2, 0.2), 0xe8f2ff, 0.45 + 0.4 * k); }
    this.trailT -= dt;
    if (this.trailT <= 0 && sp > 3) { this.trailT = 0.22; const f = this.feet(1, bx, bz); this.vfx.ring(f.x, f.y + 0.3 + Math.random() * 0.5, f.z, { r0: 0.2, r1: 1 + k, dur: 0.35, color: 0x9fd0ff, opacity: 0.35 }); }
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
    for (const t of this._trails || []) t.dispose();
    this._trails = null; this._cometTr = this._voltTr = this._boardTr = null;
    if (this._sandSwaps) { for (const s of this._sandSwaps) s.o.material = s.mat; this._sandSwaps = null; }
    if (this._sandMats) { for (const m of this._sandMats) m.dispose(); this._sandMats = null; }
    if (this._origCleanup) this._origCleanup();
  },
};

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
