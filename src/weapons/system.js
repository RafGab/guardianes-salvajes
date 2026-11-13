import * as THREE from 'three';
import { WEAPONS } from './models.js';
import { ui } from '../ui.js';

/* ======================================================================
   SISTEMA DE ARMAS
   · Cada héroe tiene SOLO su arma (models.js → WEAPONS). Empieza guardada.
   · Botón ARMA: si está guardada aparece (se materializa en la mano) y ataca;
     si ya está fuera, ataca. Mantener pulsado el botón ARMA o la tecla G la
     guarda (desaparece). También se guarda sola tras un rato sin usarla.
   · El arma cuelga de un soporte unido al HUESO de la mano del esqueleto del
     héroe: sigue todas sus animaciones.
   · Neón permanente (pulso, resplandor, chispas, luz), estelas al atacar,
     destellos al impactar y ráfagas al usar las demás habilidades.
   ====================================================================== */

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _col = new THREE.Color(); // color de la estela (antes se usaba un Vector3 → colores NaN → pantalla negra con el bloom)
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const AUTO_HOLSTER = 20; // s sin usar el arma → se guarda sola
const ZERO = { x: 0, y: 0, f: 0, w: 0 };

const easeBack = (k) => { const c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };

/* Estela luminosa: cinta entre la base y la punta del arma en los últimos fotogramas */
export class Trail {
  constructor(scene, color, color2, n = 22) {
    this.n = n; this.pts = []; this.k = 0; this.scene = scene;
    this.c1 = new THREE.Color(color); this.c2 = new THREE.Color(color2 ?? color);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.userData.own = true;
    scene.add(this.mesh);
  }
  push(a, b) {
    this.pts.unshift([a.clone(), b.clone()]);
    if (this.pts.length > this.n) this.pts.length = this.n;
  }
  update(dt, active) {
    this.k = active ? 1 : Math.max(0, this.k - dt * 5);
    if (!active && this.pts.length) this.pts.pop();
    const on = this.k > 0.01 && this.pts.length > 1;
    this.mesh.visible = on;
    if (!on) return;
    const P = this.mesh.geometry.attributes.position, Cc = this.mesh.geometry.attributes.color;
    const L = this.pts.length;
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[Math.min(i, L - 1)];
      const f = i < L ? Math.pow(1 - i / (L - 1 || 1), 1.4) * this.k : 0;
      P.setXYZ(i * 2, p[0].x, p[0].y, p[0].z);
      P.setXYZ(i * 2 + 1, p[1].x, p[1].y, p[1].z);
      // la base (cerca de la mano) apenas brilla; la punta, a tope
      _col.copy(this.c2).lerp(this.c1, i / this.n).multiplyScalar(f * 0.25);
      Cc.setXYZ(i * 2, _col.r, _col.g, _col.b);
      _col.copy(this.c1).lerp(this.c2, 0.15).multiplyScalar(f * 2.2);
      Cc.setXYZ(i * 2 + 1, _col.r, _col.g, _col.b);
    }
    P.needsUpdate = true; Cc.needsUpdate = true;
  }
  dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

export class WeaponSystem {
  constructor(game) {
    this.g = game;
    this.inst = new Map();     // modelo del héroe → arma montada
    this.cur = null;           // arma del héroe activo
    this.model = null;
    this.out = false;          // ¿el jugador la ha sacado?
    this.idleT = 0;
    this.t = 0;
    this.boost = 0;            // destello (ataques y habilidades)
    this.swingT = 0;
    // la luz del arma está SIEMPRE en la escena (intensidad 0 si no hay arma): añadir o quitar una luz
    // obliga a recompilar todos los materiales del nivel → tirón al sacar el arma
    this.light = new THREE.PointLight(0xffffff, 0, 4.5, 1.8);
    game.scene.add(this.light);
    this.sparkT = 0;
    this.outBy = {};           // cada héroe recuerda si llevaba el arma en la mano
    // capa del brazo (guardia, golpes, defensa): objetivo que fija la habilidad en curso
    this.armTarget = { x: 0, y: 0, f: 0, w: 0 };
    this.armT = 0;          // > 0 mientras una habilidad está mandando el brazo
    this.armPart = -1;      // brazo que manda la habilidad (-1 = todos)
    this.defT = 0;          // > 0: postura de defensa (botón de escudo con el arma fuera)
    // combos: cada pulsación encadenada a tiempo pasa al siguiente movimiento (3 por arma)
    this.comboStep = -1; this.comboHero = null; this.lastEnd = -9;
  }

  /* ---------------- montaje en el esqueleto ---------------- */
  handBones(model, side) {
    const B = model.bones;
    if (B && B[`hand_${side}`]) return { hand: B[`hand_${side}`], end: B[`hand_end_${side}`] || null, upper: B[`upper_arm_${side}`] || null, fore: B[`forearm_${side}`] || null };
    const r = model.rig;
    if (r && r.wr) return { hand: r.wr[side === 'R' ? 0 : 1] || r.wr[0], end: null, upper: null, fore: null };
    return null;
  }
  // Pone el modelo en el primer fotograma de su animación de reposo (para calcular el agarre)
  refPose(model) {
    if (!model.mixer || !model.clips || !model.clips.idle) return () => {};
    model.mixer.stopAllAction();
    const a = model.mixer.clipAction(model.clips.idle);
    a.reset(); a.setEffectiveWeight(1); a.play();
    model.mixer.update(0);
    return () => { a.stop(); model.action = null; model.actionName = ''; };
  }
  attach(model, heroId) {
    const W = WEAPONS[heroId];
    if (!W) return null;
    const frame = model.body || model.root;
    const restore = this.refPose(model);
    const savedRot = model.root.rotation.clone(), savedScale = model.root.scale.clone(), savedLean = frame.rotation.clone();
    model.root.rotation.set(0, 0, 0); model.root.scale.set(1, 1, 1);
    if (frame !== model.root) frame.rotation.x = 0;
    model.root.updateMatrixWorld(true);
    const sides = W.dual ? ['R', 'L'] : [W.hand];
    const parts = [];
    for (const side of sides) {
      // ÁMBAR: cada disco lo sujeta su ala (articulación de la muñeca del ala, por fuera del borde de las plumas)
      if (W.holdBy === 'wing' && this.attachWing(model, W, side, frame, parts)) continue;
      const hb = this.handBones(model, side);
      if (!hb) continue;
      const w = W.build();
      const an = model.anatomy && model.anatomy.hands[side];
      if (an) {
        // AGARRE REAL: el arma cuelga del metacarpo (la palma) y su mango pasa por el centro del puño,
        // a lo ancho de la mano (del meñique al pulgar): los dedos se cierran alrededor de él.
        const Y = an.axis.w.clone().normalize();
        const X = an.axis.a.clone().multiplyScalar(W.axisX || 1);
        X.addScaledVector(Y, -X.dot(Y)).normalize();
        const Z = new THREE.Vector3().crossVectors(X, Y).normalize();
        _m.makeBasis(X, Y, Z);
        const holder = new THREE.Group();
        holder.name = `soporte_${W.id}_${side}`;
        holder.quaternion.setFromRotationMatrix(_m);
        holder.position.copy(an.gripLocal);
        if (W.tilt) holder.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), W.tilt));
        if (W.gripOffset) holder.position.add(new THREE.Vector3(...W.gripOffset).applyQuaternion(holder.quaternion).multiplyScalar(1 / this.boneScale(an.metacarpo)));
        holder.scale.setScalar(1 / this.boneScale(an.metacarpo));
        holder.add(w.group);
        holder.visible = false;
        an.metacarpo.add(holder);
        hb.hand.getWorldPosition(_a); frame.worldToLocal(_a);
        parts.push({ w, holder, side: Math.sign(_a.x) || (side === 'R' ? -1 : 1), S: side, bones: hb, scale: w.group.scale.x, home: true });
        continue;
      }
      // punto de agarre: el centro del puño (entre la mano y la punta de la mano)
      hb.hand.getWorldPosition(_a);
      if (hb.end) { hb.end.getWorldPosition(_b); _a.lerp(_b, 0.55); }
      frame.worldToLocal(_c.copy(_a));
      const sx = Math.sign(_c.x) || (side === 'R' ? -1 : 1); // lado real de esa mano (+x = izquierda del personaje)
      if (W.dual) { _c.x += sx * 0.13; _c.y += 0.02; _c.z += 0.05; } // los discos flotan junto a la mano, por fuera
      frame.localToWorld(_a.copy(_c));
      // orientación deseada en el espacio del personaje → espacio del hueso
      const dir = new THREE.Vector3(...W.dir).normalize();
      const fc = new THREE.Vector3(...W.face);
      if (W.dual || fc.x !== 0) fc.x *= -sx * (W.dual ? -1 : 1); // la cara mira hacia fuera de ese lado
      fc.addScaledVector(dir, -fc.dot(dir)).normalize();
      const xx = new THREE.Vector3().crossVectors(dir, fc).normalize();
      _m.makeBasis(xx, dir, fc);
      const qLocal = new THREE.Quaternion().setFromRotationMatrix(_m);
      frame.getWorldQuaternion(_q);
      _q.multiply(qLocal);                       // orientación en el mundo
      hb.hand.getWorldQuaternion(_q2);
      const holder = new THREE.Group();
      holder.name = `soporte_${W.id}_${side}`;
      holder.quaternion.copy(_q2.invert().multiply(_q));
      holder.position.copy(hb.hand.worldToLocal(_a.clone()));
      hb.hand.getWorldScale(_s);
      holder.scale.setScalar(1 / (_s.x || 1));
      holder.add(w.group);
      holder.visible = false;
      hb.hand.add(holder);
      parts.push({ w, holder, side: sx, S: side, bones: hb, scale: w.group.scale.x, home: true });
    }
    this.attachBack(model, W, frame, parts);
    model.root.rotation.copy(savedRot); model.root.scale.copy(savedScale); frame.rotation.copy(savedLean);
    restore();
    model.root.updateMatrixWorld(true);
    const inst = { heroId, model, W, parts, k: 0, arm: { x: 0, y: 0, f: 0, w: 0 }, grip: 0, trails: parts.map((p) => new Trail(this.g.scene, p.w.trail.color, p.w.trail.color2)) };
    this.inst.set(model, inst);
    // capa del brazo: se aplica en cada fotograma después de la animación del modelo
    model.armFx = (bones, dt, t, fx) => this.applyArm(inst, dt, fx);
    return inst;
  }
  // Disco sujeto por el ala: va colgado del hueso de la muñeca del ala (wing_X_3), justo por fuera del borde de las
  // plumas, de canto y mirando hacia fuera. Las plumas de la punta (wing_X_4) se curvan por debajo para sujetarlo.
  attachWing(model, W, side, frame, parts) {
    const B = model.bones || {};
    const w1 = B[`wing_${side}_1`], w2 = B[`wing_${side}_2`], w3 = B[`wing_${side}_3`], w4 = B[`wing_${side}_4`];
    if (!w1 || !w3 || !w4) return false;
    const w = W.build();
    const H = model.height || 1.6;
    w3.getWorldPosition(_a); w4.getWorldPosition(_b);
    _a.lerp(_b, W.wingAt ?? 0.4);
    frame.worldToLocal(_c.copy(_a));
    const sx = Math.sign(_c.x) || (side === 'R' ? -1 : 1);
    const off = W.wingOffset || [0.06, 0, 0.05];
    _c.x += sx * off[0] * H; _c.y += off[1] * H; _c.z += off[2] * H;
    frame.localToWorld(_a.copy(_c));
    const dir = new THREE.Vector3(0, 1, 0), fc = new THREE.Vector3(sx, 0, 0.2).normalize(); // de canto, con la cara hacia fuera
    const xx = new THREE.Vector3().crossVectors(dir, fc).normalize();
    _m.makeBasis(xx, dir, fc);
    const qLocal = new THREE.Quaternion().setFromRotationMatrix(_m);
    frame.getWorldQuaternion(_q);
    _q.multiply(qLocal);
    w3.getWorldQuaternion(_q2);
    const holder = new THREE.Group();
    holder.name = `soporte_${W.id}_ala_${side}`;
    holder.quaternion.copy(_q2.invert().multiply(_q));
    holder.position.copy(w3.worldToLocal(_a.clone()));
    w3.getWorldScale(_s);
    holder.scale.setScalar(1 / (_s.x || 1));
    holder.add(w.group);
    holder.visible = false;
    w3.add(holder);
    parts.push({ w, holder, side: sx, S: side, bones: { hand: w3, wing: [w1, w2, w3, w4] }, scale: w.group.scale.x, home: true, wing: true });
    return true;
  }
  // FUNDA EN LA ESPALDA: soporte unido al pecho donde descansa el arma guardada (sigue a la animación).
  // Armas largas en diagonal; armas dobles (discos, cuchillas) una a cada lado de la espalda.
  attachBack(model, W, frame, parts) {
    const B = model.bones || {};
    const bone = B.chest || B.spine || null;
    if (!bone) return;
    const H = model.height || 1.6;
    bone.getWorldPosition(_a); frame.worldToLocal(_c.copy(_a));
    parts.forEach((pt, i) => {
      const sx = pt.side || 1, multi = parts.length > 1;
      const p = _c.clone();
      p.z -= H * (W.backOut ?? 0.12);                  // detrás de la espalda
      p.y += H * (W.backUp ?? 0.0);
      p.x += multi ? sx * H * 0.09 : 0;
      frame.localToWorld(_a.copy(p));
      const dir = multi ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0.55, 1, 0).normalize(); // larga: en diagonal
      const fc = new THREE.Vector3(0, 0, -1);
      const xx = new THREE.Vector3().crossVectors(dir, fc).normalize();
      _m.makeBasis(xx, dir, fc);
      frame.getWorldQuaternion(_q);
      _q.multiply(new THREE.Quaternion().setFromRotationMatrix(_m));
      bone.getWorldQuaternion(_q2);
      const back = new THREE.Group();
      back.name = `funda_${W.id}_${i}`;
      back.quaternion.copy(_q2.invert().multiply(_q));
      back.position.copy(bone.worldToLocal(_a.clone()));
      back.scale.setScalar(1 / this.boneScale(bone));
      back.visible = false;
      bone.add(back);
      pt.back = back;
      pt.mount = 'hand';
    });
  }
  // Mueve el arma entre la mano y la funda de la espalda (con un destello en cada punto)
  mountTo(pt, where) {
    if (!pt.back || pt.mount === where) return;
    const from = (pt.mount === 'back' ? pt.back : pt.holder).getWorldPosition(new THREE.Vector3());
    (where === 'back' ? pt.back : pt.holder).add(pt.w.group);
    pt.mount = where;
    const to = (where === 'back' ? pt.back : pt.holder).getWorldPosition(new THREE.Vector3());
    if (this.g.fx && pt.holder.parent && this.g.player.model && this.g.player.model.root.visible) {
      const col = this.cur ? this.cur.W.color : 0xffffff;
      for (let j = 0; j < 6; j++) { const k = j / 5; this.g.fx.sparkle(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, from.z + (to.z - from.z) * k, col, 1.2); }
    }
  }
  // Arma de un COMPAÑERO (héroe del equipo que no controla el jugador): en la mano mientras combate
  holdFor(model, heroId) {
    const inst = this.get(model, heroId);
    if (!inst || inst === this.cur) return inst;
    inst.k = 1; inst.kb = 0;
    for (const pt of inst.parts) {
      if (!pt.home) continue;
      if (pt.back) { this.mountTo(pt, 'hand'); pt.back.visible = false; }
      pt.holder.visible = true;
      pt.w.group.scale.setScalar(pt.scale);
      for (const s of pt.w.glows) s.visible = true;
    }
    return inst;
  }
  // Guarda el arma en la espalda al instante (cambio de héroe, inicio de misión)
  stow(inst) {
    inst.k = 0; inst.kb = 1;
    for (const pt of inst.parts) {
      if (!pt.home) continue;
      if (pt.back) { this.mountTo(pt, 'back'); pt.back.visible = true; pt.w.group.scale.setScalar(pt.scale * (inst.W.backScale ?? 0.85)); for (const s of pt.w.glows) s.visible = false; }
      pt.holder.visible = false;
    }
    for (const tr of inst.trails) { tr.pts.length = 0; tr.update(0, false); }
  }
  boneScale(b) { b.updateWorldMatrix(true, false); b.getWorldScale(_s); const r = this.g.player && this.g.player.model && this.g.player.model.root; void r; return _s.x || 1; }

  /* ---------------- brazo: guardia, golpes y defensa ---------------- */
  // la habilidad en curso fija la postura del brazo (x = alzar hacia delante, y = barrer: + hacia el otro lado,
  // f = codo, w = muñeca); si deja de fijarla, el brazo vuelve con suavidad a la guardia
  setArm(o, part = -1) { this.armTarget.x = o.x || 0; this.armTarget.y = o.y || 0; this.armTarget.f = o.f || 0; this.armTarget.w = o.w || 0; this.armT = 0.12; this.armPart = part; }
  defend(t = 1) { if (this.out) this.defT = Math.max(this.defT, t); }
  applyArm(inst, dt, fx) {
    const active = this.cur === inst && inst.k > 0.02;
    const W = inst.W, s = inst.arm;
    const show = active && inst.parts.some((p) => p.holder.visible);
    for (let i = 0; i < inst.parts.length; i++) {
      const pt = inst.parts[i];
      let tg = ZERO, rate = 7;
      if (active && this.armT > 0 && (this.armPart < 0 || this.armPart === i)) { tg = this.armTarget; rate = 26; }
      else if (active && this.out && this.defT > 0) { tg = W.defense || W.guard; rate = 14; }
      else if (active && this.out) tg = W.guard || ZERO;
      const st = pt.arm || (pt.arm = { x: 0, y: 0, f: 0, w: 0 });
      const k = 1 - Math.exp(-rate * dt);
      st.x += (tg.x - st.x) * k; st.y += (tg.y - st.y) * k; st.f += ((tg.f || 0) - st.f) * k; st.w += ((tg.w || 0) - st.w) * k;
      st.r = (st.r || 0) + ((tg.r || 0) - (st.r || 0)) * k;
      const hb = pt.bones;
      if (pt.wing) { // ALA: x = abrir hacia fuera, y = barrer hacia delante, f = doblar el codo del ala, w = curvar la punta
        const [w1, w2, , w4] = hb.wing, sd = pt.side;
        if (Math.abs(st.x) + Math.abs(st.y) + Math.abs(st.f) > 0.002) {
          fx.rot(w1, 0, 1, 0, -sd * st.y);
          fx.rot(w1, 0, 0, 1, sd * st.x);
          if (w2 && st.f) fx.rot(w2, 0, 1, 0, -sd * st.f);
        }
        // agarre: mientras sujeta el disco, las plumas de la punta se curvan por debajo de él
        pt.hold = (pt.hold || 0) + ((show && pt.home ? 1 : 0) - (pt.hold || 0)) * (1 - Math.exp(-12 * dt));
        if (w4 && pt.hold > 0.01) fx.rot(w4, 0, 0, 1, sd * (0.5 + (st.w || 0)) * pt.hold);
        continue;
      }
      const us = W.upperScale ?? 1; // Ámbar: sus alas van unidas al brazo → el hombro se mueve poco (sin estirar plumas)
      if (Math.abs(st.x) + Math.abs(st.y) + Math.abs(st.f) + Math.abs(st.r) > 0.002 && hb.upper) {
        fx.rot(hb.upper, 0, 1, 0, -pt.side * st.y * us);
        fx.rot(hb.upper, 1, 0, 0, st.x * us);
        if (hb.fore && st.f) fx.rot(hb.fore, 1, 0, 0, st.f);
        // r: giro del antebrazo sobre su eje (pronación / supinación) → orienta el mango
        if (hb.fore && hb.end && st.r) {
          inst.model.root.updateMatrixWorld(true);
          hb.hand.getWorldPosition(_a); hb.fore.getWorldPosition(_b);
          _c.subVectors(_a, _b).normalize();
          (inst.model.body || inst.model.root).getWorldQuaternion(_q).invert();
          _c.applyQuaternion(_q);
          fx.rot(hb.fore, _c.x, _c.y, _c.z, -pt.side * st.r);
        }
      }
      // dedos cerrados sobre el mango (y muñeca) — los huesos de la mano de src/anatomy.js
      const hp = inst.model.handPose;
      if (hp) {
        const key = `grip${pt.S}`;
        hp[key] += ((show && pt.home ? 1 : 0) - hp[key]) * (1 - Math.exp(-12 * dt));
        hp[`wrist${pt.S}`] = st.w;
      }
    }
    void s;
  }
  // combos: devuelve el movimiento que toca (0, 1, 2) y lo deja apuntado
  nextStep(id) {
    const chain = this.comboHero === id && this.comboStep >= 0 && this.comboStep < 2 && this.t - this.lastEnd < 0.8;
    this.comboStep = chain ? this.comboStep + 1 : 0;
    this.comboHero = id;
    return this.comboStep;
  }
  endAttack() { this.lastEnd = this.t; }
  get(model, heroId) { return this.inst.get(model) || this.attach(model, heroId); }

  /* ---------------- estado ---------------- */
  get isOut() { return this.out; }
  get def() { const h = this.g.hero; return h ? WEAPONS[h.id] : null; }
  // Saca el arma (si no lo estaba). Devuelve true si acaba de aparecer.
  equip() {
    const p = this.g.player, hero = this.g.hero;
    if (!p || !p.model || !hero) return false;
    this.idleT = 0;
    if (this.out && this.cur) return false;
    this.cur = this.get(p.model, hero.id);
    if (!this.cur) return false;
    this.out = true;
    this.cur.k = Math.min(this.cur.k, 0.02);
    for (const pt of this.cur.parts) { pt.holder.visible = true; pt.home = true; }
    this.boost = 1.4;
    this.flashAll(1.2);
    ui.setWeaponOut(true, this.def && this.def.name);
    return true;
  }
  holster(instant = false) {
    if (!this.out && !instant) return false;
    this.out = false;
    if (this.cur) {
      if (instant) this.stow(this.cur);
      else this.flashAll(0.6);
    }
    ui.setWeaponOut(false, this.def && this.def.name);
    return true;
  }
  toggle() { return this.out ? (this.holster(), false) : this.equip(); }
  reset() {
    for (const inst of this.inst.values()) { inst.k = 0; for (const pt of inst.parts) { pt.holder.visible = false; pt.home = true; } for (const tr of inst.trails) { tr.pts.length = 0; tr.update(0, false); } }
    this.out = false; this.cur = null; this.boost = 0; this.swingT = 0; this.idleT = 0;
    this.armT = 0; this.defT = 0; this.comboStep = -1; this.lastEnd = -9;
    for (const inst of this.inst.values()) { for (const pt of inst.parts) pt.arm = null; if (inst.model.handPose) Object.assign(inst.model.handPose, { gripL: 0, gripR: 0, wristL: 0, wristR: 0 }); }
    if (this.light.parent !== this.g.scene) this.g.scene.add(this.light);
    this.light.intensity = 0;
    ui.setWeaponOut(false);
  }

  /* ---------------- ganchos para las habilidades ---------------- */
  // ataque en curso: estela durante `dur` segundos y brillo intenso
  swing(dur = 0.3) { if (!this.out) return; this.swingT = Math.max(this.swingT, dur); this.boost = Math.max(this.boost, 1); this.idleT = 0; }
  // al usar cualquier otra habilidad con el arma fuera: ráfaga de energía del arma
  skillBurst() {
    if (!this.out || !this.cur) return;
    this.idleT = 0;
    this.boost = Math.max(this.boost, 1.3);
    const vfx = this.g.vfx, col = this.cur.W.color;
    for (const pt of this.cur.parts) {
      if (!pt.home) continue;
      const c = this.partCenter(pt, _a);
      vfx.ring(c.x, c.y, c.z, { r0: 0.15, r1: 1.4, dur: 0.35, color: col, opacity: 0.7 });
      vfx.orb(c.clone(), { r: 0.14, color: col, opacity: 0.75, life: 0.22, grow: 1.5 });
      for (let i = 0; i < 10; i++) this.g.fx.sparkle(c.x, c.y, c.z, i % 2 ? col : this.cur.W.color2, 2.6);
      // efecto propio de cada arma
      const fx = this.g.fx, tip = pt.w.trail.tip.getWorldPosition(_b);
      switch (this.cur.W.id) {
        case 'katana': for (let i = 0; i < 6; i++) { fx.flame(tip.x, tip.y, tip.z, 0.6, 0.15); fx.ember(c.x, c.y, c.z, 1); } vfx.bolt(c.clone(), tip.clone().add(new THREE.Vector3(0, 0.6, 0)), { color: 0x6ac8ff, life: 0.15, jag: 0.2, segs: 6 }); break;
        case 'axe': for (let i = 0; i < 6; i++) fx.iceShard(tip.x, tip.y, tip.z, 0.8); break;
        case 'hammer': for (let i = 0; i < 8; i++) fx.gem(tip.x, tip.y, tip.z); vfx.ring(this.g.player.pos.x, null, this.g.player.pos.z, { r0: 0.3, r1: 2.4, dur: 0.4, color: 0x5aff8a, opacity: 0.6 }); break;
        case 'disc': vfx.ring(c.x, c.y, c.z, { r0: 0.3, r1: 0.9, dur: 0.3, color: 0xffc020, opacity: 0.8 }); break;
        case 'scythe': vfx.bolt(tip.clone(), tip.clone().add(new THREE.Vector3(0, 1.2, 0)), { color: 0x8ad8ff, life: 0.16, jag: 0.25, segs: 7 }); vfx.bolt(c.clone(), tip.clone(), { color: 0xbfeeff, life: 0.12, jag: 0.15, segs: 5 }); break;
        case 'boomerang': fx.splash(c.x, c.y, c.z, 8, 0.5); break;
        case 'spear': for (let i = 0; i < 6; i++) fx.gem(tip.x, tip.y, tip.z); vfx.orb(tip.clone(), { r: 0.3, color: 0xd890ff, life: 0.25, grow: 2 }); break;
      }
    }
  }
  // destello en el punto de impacto (con los colores del arma)
  impact(x, y, z, k = 1) {
    const W = this.def;
    if (!W) return;
    const vfx = this.g.vfx;
    vfx.orb(new THREE.Vector3(x, y, z), { r: 0.2 * k, color: W.color, opacity: 0.8, life: 0.16, grow: 1.6 });
    vfx.orb(new THREE.Vector3(x, y, z), { r: 0.16 * k, color: 0xffffff, life: 0.12, grow: 1.5 });
    vfx.ring(x, y, z, { r0: 0.1, r1: 1.3 * k, dur: 0.28, color: W.color2, opacity: 0.8 });
    for (let i = 0; i < 10 * k; i++) this.g.fx.sparkle(x, y, z, i % 3 ? W.color : W.color2, 3.2);
    this.boost = Math.max(this.boost, 1.1);
  }
  // centro (mundo) de una parte del arma
  partCenter(pt, out = new THREE.Vector3()) {
    const tr = pt.w.trail;
    tr.base.getWorldPosition(out); tr.tip.getWorldPosition(_b);
    return out.lerp(_b, 0.5);
  }
  partTip(i = 0, out = new THREE.Vector3()) {
    const pt = this.cur && this.cur.parts[i];
    if (!pt) return null;
    return pt.w.trail.tip.getWorldPosition(out);
  }
  // armas arrojadizas: la de la mano desaparece mientras vuela la copia
  setHome(i, on) { const pt = this.cur && this.cur.parts[i]; if (pt) { pt.home = on; if (on && !this.cur.W.lightOnThrow) this.flashPart(pt, 0.8); } } // los discos de Ámbar vuelven apagados
  // copia del arma para lanzarla (comparte geometrías y materiales)
  projectile(i = 0) {
    const pt = this.cur && this.cur.parts[i];
    if (!pt) return null;
    const g = pt.w.group.clone(true);
    g.traverse((o) => { o.userData.own = false; }); // materiales compartidos con el arma de la mano: no se liberan al desaparecer
    g.scale.setScalar(pt.scale);
    return { group: g, color: pt.w.trail.color, color2: pt.w.trail.color2, spin: g.getObjectByName('w_spin') };
  }
  // Brillo de una pieza (0 = apagada, 1 = encendida). Los materiales los comparte la copia lanzada, así que
  // esto también ilumina o apaga el disco que va volando.
  partLight(i, k) {
    const pt = this.cur && this.cur.parts[i];
    if (!pt) return;
    const w = pt.w;
    for (const m of w.neon) {
      const d = m.userData.neon;
      // los neones sólidos se quedan con su color oscuro; los halos aditivos desaparecen
      const lo = m.blending === THREE.AdditiveBlending ? 0 : 0.22;
      m.color.copy(d.color).multiplyScalar(d.base * (lo + (1 - lo) * k));
    }
    for (const m of w.neonStd) m.emissiveIntensity = m.userData.neonStd.base * k;
    for (const s of w.glows) { const d = s.userData.glow; s.visible = k > 0.02; s.material.opacity = d.opacity * k; s.scale.setScalar(d.size * (0.8 + 0.3 * k)); }
  }
  get partCount() { return this.cur ? this.cur.parts.length : 0; }
  // hueso del brazo que empuña (para animar el golpe)
  armBones(i = 0) { const pt = this.cur && this.cur.parts[i]; return pt ? pt.bones : null; }
  // destello de aparición / desaparición
  flashPart(pt, k) {
    const c = this.partCenter(pt, _a), W = this.cur.W;
    this.g.vfx.orb(c.clone(), { r: 0.12 * k, color: W.color, opacity: 0.7, life: 0.2, grow: 1.6 });
    this.g.vfx.ring(c.x, c.y, c.z, { r0: 0.05, r1: 0.9 * k, dur: 0.3, color: W.color2, opacity: 0.8 });
    // espiral de partículas a lo largo del arma
    pt.w.trail.base.getWorldPosition(_b); pt.w.trail.tip.getWorldPosition(_c);
    for (let i = 0; i < 16; i++) { _a.copy(_b).lerp(_c, i / 15); this.g.fx.sparkle(_a.x, _a.y, _a.z, i % 2 ? W.color : W.color2, 1.6); }
  }
  flashAll(k) { if (this.cur) { this.g.scene.updateMatrixWorld(); for (const pt of this.cur.parts) this.flashPart(pt, k); } }

  /* ---------------- fotograma ---------------- */
  update(dt) {
    this.t += dt;
    const p = this.g.player;
    const model = p && p.model;
    // cambio de héroe: el arma del anterior desaparece al instante
    if (model !== this.model) {
      // el héroe que sale guarda su arma en la espalda (cada héroe recuerda si la llevaba en la mano)
      if (this.model) { const old = this.inst.get(this.model); if (old) this.stow(old); if (this.heroId) this.outBy[this.heroId] = this.out; }
      this.model = model;
      this.heroId = this.g.hero ? this.g.hero.id : null;
      if (this.out) this.out = false;
      ui.setWeaponOut(false, this.def && this.def.name);
      this.cur = null;
      if (model && this.heroId && this.outBy[this.heroId]) this.equip();
    }
    // el arma va SIEMPRE con su héroe: en la mano o guardada en la funda de la espalda
    if (!this.cur && model && this.g.hero && WEAPONS[this.g.hero.id]) { this.cur = this.get(model, this.g.hero.id); if (this.cur && !this.out) this.stow(this.cur); }
    const inst = this.cur;
    this.armT = Math.max(0, this.armT - dt);
    this.defT = Math.max(0, this.defT - dt);
    if (!inst) { this.light.intensity = 0; return; }
    if (this.out) { this.idleT += dt; if (this.idleT > AUTO_HOLSTER && this.swingT <= 0) this.holster(); }
    // TRANSICIÓN FUNDA ⇄ MANO: al sacarla, se desvanece de la espalda y se materializa en la mano (rebote);
    // al guardarla, se encoge en la mano y aparece en la funda de la espalda
    if (inst.kb == null) inst.kb = 0;
    if (this.out) {
      if (inst.kb > 0) { inst.kb = Math.max(0, inst.kb - dt * 7); inst.k = 0; }
      else inst.k = Math.min(1, inst.k + dt * 3.2);
    } else {
      inst.k = Math.max(0, inst.k - dt * 4.5);
      if (inst.k <= 0) inst.kb = Math.min(1, inst.kb + dt * 4);
    }
    const target = this.out ? 1 : 0;
    const swim = !!p.swimming;
    const show = inst.k > 0.001 && !swim;
    const sk = target ? easeBack(inst.k) : inst.k * inst.k;
    this.swingT = Math.max(0, this.swingT - dt);
    this.boost = Math.max(0, this.boost - dt * 1.6);
    const pulse = 1 + 0.16 * Math.sin(this.t * 3.1) + 0.06 * Math.sin(this.t * 11.7) + this.boost * 0.9;
    let n = 0;
    const onBack = inst.kb > 0.001 || (!this.out && inst.k <= 0.001);
    for (let i = 0; i < inst.parts.length; i++) {
      const pt = inst.parts[i], w = pt.w;
      if (pt.back) {
        if (onBack && pt.home) {
          this.mountTo(pt, 'back');
          pt.holder.visible = false;
          pt.back.visible = !swim;
          w.group.scale.setScalar(pt.scale * (inst.W.backScale ?? 0.85) * Math.max(0.001, easeBack(inst.kb)));
          for (const s of w.glows) s.visible = false; // guardada: sin resplandor
          inst.trails[i].update(dt, false);
          continue;
        }
        this.mountTo(pt, 'hand');
        pt.back.visible = false;
      }
      pt.holder.visible = show && pt.home;
      w.group.scale.setScalar(pt.scale * Math.max(0.001, sk));
      if (!pt.holder.visible) { inst.trails[i].update(dt, false); continue; }
      // armas que solo se iluminan al lanzarlas (discos de Ámbar): en la mano, apagadas
      if (inst.W.lightOnThrow) { this.partLight(i, 0); inst.trails[i].update(dt, false); for (const sp of w.spin) sp.bone.rotation.z += dt * sp.speed; continue; }
      n++;
      for (const m of w.neon) { const d = m.userData.neon; m.color.copy(d.color).multiplyScalar(d.base * pulse); }
      for (const m of w.neonStd) m.emissiveIntensity = m.userData.neonStd.base * pulse;
      for (const s of w.glows) { const d = s.userData.glow; s.visible = true; s.scale.setScalar(d.size * (0.9 + 0.12 * Math.sin(this.t * 4 + d.size * 10) + this.boost * 0.7)); s.material.opacity = Math.min(1, d.opacity * (0.85 + this.boost * 0.5)); }
      for (const a of w.arcs) a.update(dt, Math.min(1, this.boost));
      for (const sp of w.spin) sp.bone.rotation.z += dt * sp.speed * (1 + this.boost * 3);
      // estela durante los ataques
      if (this.swingT > 0) { w.trail.base.getWorldPosition(_a); w.trail.tip.getWorldPosition(_b); inst.trails[i].push(_a, _b); }
      inst.trails[i].update(dt, this.swingT > 0);
      // chispas de energía que se desprenden del arma
      this.sparkT -= dt;
      if (this.sparkT <= 0 && w.glows.length) {
        this.sparkT = 0.09 - Math.min(0.06, this.boost * 0.05);
        const gl = w.glows[Math.floor(Math.random() * w.glows.length)];
        gl.getWorldPosition(_a);
        this.g.fx.sparkle(_a.x + (Math.random() - 0.5) * 0.1, _a.y + (Math.random() - 0.5) * 0.1, _a.z + (Math.random() - 0.5) * 0.1, Math.random() < 0.6 ? inst.W.color : inst.W.color2, 0.45 + this.boost);
      }
    }
    // luz del arma (ilumina al héroe y al entorno cercano)
    if (n) {
      this.partCenter(inst.parts[0], _a);
      this.light.position.copy(_a);
      this.light.color.setHex(inst.W.color);
      this.light.intensity = (0.9 * pulse + this.boost * 3) * sk;
    } else this.light.intensity = 0;
  }
}
