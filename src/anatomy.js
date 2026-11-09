import * as THREE from 'three';

/* ======================================================================
   ANATOMÍA DE MANOS Y PIES (para los 7 héroes con esqueleto GLB)
   Los modelos traen un hueso por mano (hand → hand_end) y por pie
   (foot → toe → toe_end). Aquí se completa el esqueleto, al cargar:

   MANO  · carpo (muñeca) → metacarpo (palma) → 4 dedos con falange
           proximal, media y distal · pulgar con SOLO proximal y distal.
   PIE   · tarso → metatarso · dedos: el gordo con SOLO proximal y distal,
           los otros cuatro con proximal, media y distal.

   Cada hueso nuevo nace exactamente en su sitio del modelo en reposo
   (sin cambiar la forma de la malla) y la piel de la mano/pie se reparte
   entre ellos con transiciones suaves, para que doblar dedos, muñeca o
   tobillo no deforme el cuerpo. Las animaciones del GLB no tocan estos
   huesos: los mueve el sistema de agarre (cerrar el puño sobre el mango)
   y el pie al caminar.
   ====================================================================== */

const FINGERS = ['indice', 'corazon', 'anular', 'menique'];
const TOES = ['dedo2', 'dedo3', 'dedo4', 'dedo5'];
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function bindWorld(sk, i) { return sk.skeleton.boneInverses[i].clone().invert(); }
function posOf(m) { return new THREE.Vector3().setFromMatrixPosition(m); }

export function augmentSkeleton(model) {
  let sk = null;
  model.traverse((o) => { if (o.isSkinnedMesh && !sk) sk = o; });
  if (!sk) return null;
  const skel = sk.skeleton;
  const names = skel.bones.map((b) => b.name);
  const idx = (n) => names.indexOf(n);
  const g = sk.geometry;
  const P = g.attributes.position, N = P.count;
  // pesos de piel editables (4 por vértice, en coma flotante)
  const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const si = new Uint16Array(N * 4), sw = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) for (let k = 0; k < 4; k++) { si[i * 4 + k] = SI.getComponent(i, k); sw[i * 4 + k] = SW.getComponent(i, k); }
  // LIMPIEZA DE PESOS CRUZADOS: los rigs automáticos mezclan a veces el brazo (o el ala) con el muslo o la
  // espinilla donde la mano cuelga junto a la pierna. Al separar brazo y pierna esos vértices se estiran como
  // varillas (Ámbar al abrir las alas). Cada vértice se queda solo con la cadena dominante.
  // brazo lejano (antebrazo, mano, ala a partir del 2.º segmento) frente a cadera, columna y piernas (el hombro sí mezcla con el pecho)
  const upperRe = /^(forearm|hand|wing_[LR]_([2-9]|end))/, lowerRe = /^(root|spine|thigh|shin|foot|toe)/;
  const isUp = names.map((n) => upperRe.test(n)), isLow = names.map((n) => lowerRe.test(n));
  const isWing = names.map((n) => /^wing/.test(n));
  let cleaned = 0;
  // posición de reposo de cada hueso: el vértice se queda con la cadena cuyo hueso tiene más cerca
  // (la mano junto a la cadera es de la mano; la cadera junto a la mano es de la cadera)
  const bonePos = skel.boneInverses.map((m) => new THREE.Vector3().setFromMatrixPosition(m.clone().invert()));
  const vp = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    let wu = 0, wl = 0, du = 1e9, dl = 1e9, wing = false;
    vp.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(sk.bindMatrix);
    for (let k = 0; k < 4; k++) {
      const b = si[i * 4 + k], w = sw[i * 4 + k];
      if (w <= 0) continue;
      if (isUp[b]) { wu += w; du = Math.min(du, vp.distanceTo(bonePos[b])); if (isWing[b]) wing = true; } else if (isLow[b]) { wl += w; dl = Math.min(dl, vp.distanceTo(bonePos[b])); }
    }
    if (wu <= 0.01 || wl <= 0.01) continue;
    // plumas del ala: gana el hueso más cercano (si no, quedan pegadas al cuerpo y se estiran al abrir el ala);
    // brazo y mano: gana la cadena con más peso (por distancia, la piel del torso pasaba al antebrazo)
    const dropLow = wing ? du <= dl : wu >= wl;
    let tot = 0;
    for (let k = 0; k < 4; k++) { const b = si[i * 4 + k]; if (dropLow ? isLow[b] : isUp[b]) sw[i * 4 + k] = 0; tot += sw[i * 4 + k]; }
    if (tot > 0) for (let k = 0; k < 4; k++) sw[i * 4 + k] /= tot;
    cleaned++;
  }
  const used = new Uint8Array(N);
  if (g.index) for (const v of g.index.array) used[v] = 1; else used.fill(1);
  const pos = (i, v) => v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(sk.bindMatrix);
  const wOf = (i, set) => { let w = 0; for (let k = 0; k < 4; k++) if (set.has(si[i * 4 + k])) w += sw[i * 4 + k]; return w; };

  const newBones = [], newInv = [];
  const addBone = (name, parentIdxOrBone, at, parentBW) => {
    const b = new THREE.Bone();
    b.name = name;
    const local = at.clone().applyMatrix4(parentBW.clone().invert());
    b.position.copy(local);
    b.userData.anat = true;
    const bw = parentBW.clone().multiply(new THREE.Matrix4().makeTranslation(local.x, local.y, local.z));
    const parent = typeof parentIdxOrBone === 'number' ? skel.bones[parentIdxOrBone] : parentIdxOrBone;
    parent.add(b);
    newBones.push(b); newInv.push(bw.clone().invert());
    b.userData.bw = bw;
    return { bone: b, index: skel.bones.length + newBones.length - 1, bw };
  };
  // reasigna la parte `share` de los pesos de `from` a los huesos [b1 (1-β), b2 (β)]
  const reassign = (i, from, b1, b2, beta) => {
    let share = 0;
    for (let k = 0; k < 4; k++) if (from.has(si[i * 4 + k])) { share += sw[i * 4 + k]; sw[i * 4 + k] = 0; }
    if (share <= 0) return;
    const list = [];
    for (let k = 0; k < 4; k++) if (sw[i * 4 + k] > 0) list.push([si[i * 4 + k], sw[i * 4 + k]]);
    list.push([b1, share * (1 - beta)]);
    if (beta > 0.001) list.push([b2, share * beta]);
    list.sort((x, y) => y[1] - x[1]);
    const top = list.slice(0, 4);
    const tot = top.reduce((s, x) => s + x[1], 0) || 1;
    for (let k = 0; k < 4; k++) { si[i * 4 + k] = top[k] ? top[k][0] : 0; sw[i * 4 + k] = top[k] ? top[k][1] / tot : 0; }
  };
  const out = { hands: {}, feet: {} };
  const v = new THREE.Vector3();

  /* ---------------- MANOS ---------------- */
  for (const S of ['L', 'R']) {
    const hi = idx(`hand_${S}`), he = idx(`hand_end_${S}`);
    if (hi < 0 || he < 0) continue;
    const HBW = bindWorld(sk, hi);
    let H0 = posOf(HBW);
    const H1 = posOf(bindWorld(sk, he));
    let a = H1.clone().sub(H0).normalize();
    let hl = H1.distanceTo(H0) || 1e-3;
    const fi = idx(`forearm_${S}`), ui = idx(`upper_arm_${S}`);
    const set = new Set([hi, he]);
    const armSet = new Set(fi >= 0 ? [hi, he, fi] : [hi, he]);
    // el puño: vértices del brazo más allá de la muñeca y cerca del eje de la mano
    // (en algunos modelos casi todo el peso del puño lo lleva el antebrazo)
    const verts = [];
    for (let i = 0; i < N; i++) {
      if (!used[i]) continue;
      const wh = wOf(i, set);
      if (wh < 0.35 && wOf(i, armSet) < 0.6) continue;
      pos(i, v).sub(H0);
      const t = v.dot(a), r = v.clone().addScaledVector(a, -t).length();
      if (wh >= 0.35 || (t > 0.05 * hl && t < 2.6 * hl && r < 1.4 * hl)) verts.push(i);
    }
    if (verts.length < 20 && fi >= 0) {
      // respaldo: en algunos rigs automáticos el hueso de la mano queda fuera de la malla.
      // El puño es entonces el extremo del brazo: los vértices del brazo más alejados del codo.
      const E = posOf(bindWorld(sk, fi));
      const d = H0.clone().sub(E).normalize();
      const seg = H0.distanceTo(E) || 0.1;
      const chain = new Set([fi, hi, he, ...(ui >= 0 ? [ui] : [])]);
      const cand = [];
      let maxT = -1e9;
      for (let i = 0; i < N; i++) {
        if (!used[i] || wOf(i, chain) < 0.6) continue;
        const t = pos(i, v).sub(E).dot(d);
        if (t > 0) { cand.push([i, t]); maxT = Math.max(maxT, t); }
      }
      const fist = 0.45 * seg;
      verts.length = 0;
      for (const [i, t] of cand) if (t > maxT - fist) verts.push(i);
      H0 = E.clone().addScaledVector(d, maxT - fist); a = d; hl = fist;
      armSet.clear(); for (const b of chain) armSet.add(b);
      set.clear(); for (const b of chain) set.add(b);
    }
    if (verts.length < 20) continue;
    // centro del puño y eje lateral (anchura de la mano, del meñique al pulgar) por componentes principales
    const C = new THREE.Vector3();
    for (const i of verts) C.add(pos(i, v));
    C.divideScalar(verts.length);
    let xx = 0, xy = 0, yy = 0;
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    e1.set(0, 0, 1).addScaledVector(a, -a.z); if (e1.lengthSq() < 1e-4) e1.set(1, 0, 0).addScaledVector(a, -a.x); e1.normalize();
    e2.crossVectors(a, e1).normalize();
    for (const i of verts) { pos(i, v).sub(C); const p1 = v.dot(e1), p2 = v.dot(e2); xx += p1 * p1; xy += p1 * p2; yy += p2 * p2; }
    const ang = 0.5 * Math.atan2(2 * xy, xx - yy);
    const w = e1.clone().multiplyScalar(Math.cos(ang)).addScaledVector(e2, Math.sin(ang)).normalize();
    if (w.z < 0) w.negate(); // el pulgar mira hacia delante (con el brazo relajado)
    const n = new THREE.Vector3().crossVectors(a, w).normalize();
    // extensión de la mano a lo largo de los dedos (t) y a lo ancho (u)
    const ts = [], us = [];
    for (const i of verts) { pos(i, v); ts.push(v.clone().sub(H0).dot(a)); us.push(v.clone().sub(C).dot(w)); }
    const sorted = (arr) => arr.slice().sort((x, y) => x - y);
    const st = sorted(ts), su = sorted(us);
    const q = (arr, f) => arr[Math.floor((arr.length - 1) * f)];
    const t0 = q(st, 0.02), t1 = q(st, 0.98), L = Math.max(1e-4, t1 - t0);
    const u0 = q(su, 0.03), u1 = q(su, 0.97), U = Math.max(1e-4, u1 - u0);
    // punto de la mano: tf a lo largo (0 muñeca … 1 yemas), uf a lo ancho (0 meñique … 1 pulgar), pasando por el centro del puño
    const cT = C.clone().sub(H0).dot(a);
    const at = (tf, uf, nOff = 0) => C.clone().addScaledVector(a, t0 + tf * L - cT).addScaledVector(w, u0 + uf * U).addScaledVector(n, nOff);
    // huesos
    const carpo = addBone(`carpo_${S}`, hi, at(0.04, 0.45), HBW);
    const meta = addBone(`metacarpo_${S}`, carpo.bone, at(0.3, 0.45), carpo.bw);
    const bands = [[0.6, 0.78], [0.42, 0.6], [0.22, 0.42], [0.0, 0.22]]; // índice, corazón, anular, meñique (u)
    const fingers = FINGERS.map((nm, f) => {
      const uc = (bands[f][0] + bands[f][1]) / 2;
      const prox = addBone(`falange_proximal_${nm}_${S}`, meta.bone, at(0.56, uc), meta.bw);
      const med = addBone(`falange_media_${nm}_${S}`, prox.bone, at(0.72, uc), prox.bw);
      const dist = addBone(`falange_distal_${nm}_${S}`, med.bone, at(0.86, uc), med.bw);
      return { band: bands[f], prox, med, dist };
    });
    const thProx = addBone(`falange_proximal_pulgar_${S}`, meta.bone, at(0.22, 0.88), meta.bw);
    const thDist = addBone(`falange_distal_pulgar_${S}`, thProx.bone, at(0.5, 0.9), thProx.bw);
    // piel: cada vértice de la mano pasa a su hueso, mezclado con el anterior cerca de la articulación
    let k = 0;
    for (const i of verts) {
      const tf = (ts[k] - t0) / L, uf = (us[k] - u0) / U; k++;
      if (uf > 0.8 && tf < 0.75 && tf > 0.08) { // pulgar (2 falanges)
        if (tf < 0.48) reassign(i, armSet, thProx.index, meta.index, 1 - smooth(0.12, 0.3, tf));
        else reassign(i, armSet, thDist.index, thProx.index, 1 - smooth(0.48, 0.58, tf));
        continue;
      }
      if (tf < 0.18) { reassign(i, set, carpo.index, carpo.index, 0); continue; }
      if (tf < 0.5) { reassign(i, armSet, meta.index, carpo.index, 1 - smooth(0.16, 0.3, tf)); continue; }
      const fu = Math.min(0.999, Math.max(0, uf));
      const F = fingers.find((x) => fu >= x.band[0] && fu < x.band[1]) || (fu >= 0.78 ? fingers[0] : fingers[3]);
      if (tf < 0.68) reassign(i, armSet, F.prox.index, meta.index, 1 - smooth(0.5, 0.6, tf));
      else if (tf < 0.83) reassign(i, armSet, F.med.index, F.prox.index, 1 - smooth(0.68, 0.76, tf));
      else reassign(i, armSet, F.dist.index, F.med.index, 1 - smooth(0.83, 0.9, tf));
    }
    // ejes de flexión en el espacio local de los huesos (todos comparten la orientación del hueso de la mano)
    const qInv = new THREE.Quaternion(); new THREE.Vector3(); HBW.decompose(new THREE.Vector3(), qInv, new THREE.Vector3()); qInv.invert();
    const wL = w.clone().applyQuaternion(qInv).normalize(), aL = a.clone().applyQuaternion(qInv).normalize(), nL = n.clone().applyQuaternion(qInv).normalize();
    // sentido de cierre: el que acerca la yema al centro del puño
    const tipP = at(0.95, 0.5), joint = at(0.56, 0.5);
    const test = (sg) => tipP.clone().sub(joint).applyAxisAngle(w, sg * 0.4).add(joint).distanceTo(C);
    const curlSign = test(1) < test(-1) ? 1 : -1;
    const thTip = at(0.6, 0.9), thJ = at(0.22, 0.88);
    const thTest = (sg) => thTip.clone().sub(thJ).applyAxisAngle(a, sg * 0.4).add(thJ).distanceTo(C);
    const thumbSign = thTest(1) < thTest(-1) ? 1 : -1;
    const gripLocal = C.clone().applyMatrix4(meta.bw.clone().invert()); // centro del puño en el espacio del metacarpo
    out.hands[S] = {
      carpo: carpo.bone, metacarpo: meta.bone, fingers: fingers.map((f) => [f.prox.bone, f.med.bone, f.dist.bone]), thumb: [thProx.bone, thDist.bone],
      axis: { w: wL, a: aL, n: nL }, curlSign, thumbSign, gripLocal, verts: verts.length,
    };
  }

  /* ---------------- PIES ---------------- */
  for (const S of ['L', 'R']) {
    const fo = idx(`foot_${S}`), to = idx(`toe_${S}`), te = idx(`toe_end_${S}`);
    if (fo < 0 || to < 0) continue;
    const FBW = bindWorld(sk, fo), TBW = bindWorld(sk, to);
    const F0 = posOf(FBW); let T0 = posOf(TBW); const T1 = te >= 0 ? posOf(bindWorld(sk, te)) : T0.clone().add(T0.clone().sub(F0).multiplyScalar(0.5));
    // tarso y metatarso (piel del hueso del pie)
    const tarso = addBone(`tarso_${S}`, fo, F0.clone(), FBW);
    const meta = addBone(`metatarso_${S}`, tarso.bone, F0.clone().lerp(T0, 0.5), tarso.bw);
    const fset = new Set([fo]);
    const af = T0.clone().sub(F0); const lf = af.length() || 1e-4; af.normalize();
    for (let i = 0; i < N; i++) {
      if (!used[i] || wOf(i, fset) < 0.3) continue;
      const tf = pos(i, v).sub(F0).dot(af) / lf;
      reassign(i, fset, meta.index, tarso.index, 1 - smooth(0.38, 0.58, tf));
    }
    // dedos del pie (piel del hueso del dedo)
    const at2 = T1.clone().sub(T0); let lt = at2.length() || 1e-4; at2.normalize();
    const tset = new Set(te >= 0 ? [to, te] : [to]);
    const footSet = new Set(te >= 0 ? [fo, to, te, tarso.index, meta.index] : [fo, to, tarso.index, meta.index]);
    let toeParent = to, toeBW = TBW;
    const tv = [];
    for (let i = 0; i < N; i++) {
      if (!used[i]) continue;
      const wt = wOf(i, tset);
      if (wt >= 0.3) { tv.push(i); continue; }
      // dedos pesados al hueso del pie: los que quedan por delante de la articulación del dedo
      if (wOf(i, footSet) >= 0.6 && pos(i, v).sub(T0).dot(at2) > 0.05 * lt) tv.push(i);
    }
    if (tv.length < 10) {
      // respaldo: rig automático con el pie pesado a la espinilla y el hueso del dedo fuera de la malla.
      // Se localiza la planta (los vértices más bajos de esa pierna) y los dedos en su parte delantera.
      const shi = idx(`shin_${S}`);
      const chain = new Set([...footSet, ...(shi >= 0 ? [shi] : [])]);
      const cand = [];
      let minY = 1e9;
      for (let i = 0; i < N; i++) {
        if (!used[i] || wOf(i, chain) < 0.6) continue;
        pos(i, v);
        if (Math.sign(v.x) !== Math.sign(F0.x || 1)) continue;
        cand.push(i); minY = Math.min(minY, v.y);
      }
      const band = 0.09, sole = [];
      let zmin = 1e9, zmax = -1e9;
      const cen = new THREE.Vector3();
      for (const i of cand) { pos(i, v); if (v.y < minY + band) { sole.push(i); zmin = Math.min(zmin, v.z); zmax = Math.max(zmax, v.z); cen.add(v); } }
      if (sole.length > 20) {
        cen.divideScalar(sole.length);
        T0 = new THREE.Vector3(cen.x, minY + band * 0.35, zmin + 0.6 * (zmax - zmin));
        at2.set(0, 0, 1); lt = Math.max(0.02, zmax - T0.z);
        tv.length = 0;
        for (const i of sole) if (pos(i, v).z > T0.z - 0.05 * lt) tv.push(i);
        tset.clear(); footSet.clear(); for (const b of chain) { tset.add(b); footSet.add(b); }
        toeParent = meta.bone; toeBW = meta.bw;
      }
    }
    const side = new THREE.Vector3().crossVectors(at2, new THREE.Vector3(0, 1, 0)); if (side.lengthSq() < 1e-4) side.set(1, 0, 0); side.normalize();
    if (side.x * Math.sign(T0.x || 1) > 0) side.negate(); // `side` apunta hacia dentro (dedo gordo)
    if (tv.length < 10) { out.feet[S] = { tarso: tarso.bone, metatarso: meta.bone, toes: [], axis: null, tv: tv.length }; continue; }
    let umin = 1e9, umax = -1e9;
    const tu = tv.map((i) => { pos(i, v).sub(T0); const u = v.dot(side); umin = Math.min(umin, u); umax = Math.max(umax, u); return [v.dot(at2) / lt, u]; });
    const UU = Math.max(1e-4, umax - umin);
    const toeAt = (tf, uf) => T0.clone().addScaledVector(at2, tf * lt).addScaledVector(side, umin + uf * UU);
    // dedo gordo (lado interior, 2 falanges) y los otros cuatro (3 falanges)
    const bigP = addBone(`falange_proximal_dedo_gordo_${S}`, toeParent, toeAt(0.1, 0.88), toeBW);
    const bigD = addBone(`falange_distal_dedo_gordo_${S}`, bigP.bone, toeAt(0.55, 0.88), bigP.bw);
    const tb = [[0.55, 0.75], [0.37, 0.55], [0.18, 0.37], [0, 0.18]];
    const small = TOES.map((nm, f) => {
      const uc = (tb[f][0] + tb[f][1]) / 2;
      const p = addBone(`falange_proximal_${nm}_${S}`, toeParent, toeAt(0.08, uc), toeBW);
      const m = addBone(`falange_media_${nm}_${S}`, p.bone, toeAt(0.4, uc), p.bw);
      const d = addBone(`falange_distal_${nm}_${S}`, m.bone, toeAt(0.68, uc), m.bw);
      return { band: tb[f], p, m, d };
    });
    tv.forEach((i, k) => {
      const [tf, uRaw] = tu[k], uf = (uRaw - umin) / UU;
      const fs = tf > 0.05 ? footSet : tset;
      if (uf >= 0.75) { if (tf < 0.55) reassign(i, fs, bigP.index, bigP.index, 0); else reassign(i, fs, bigD.index, bigP.index, 1 - smooth(0.55, 0.65, tf)); return; }
      const T = small.find((x) => uf >= x.band[0] && uf < x.band[1]) || small[3];
      if (tf < 0.4) reassign(i, fs, T.p.index, T.p.index, 0);
      else if (tf < 0.68) reassign(i, fs, T.m.index, T.p.index, 1 - smooth(0.4, 0.5, tf));
      else reassign(i, fs, T.d.index, T.m.index, 1 - smooth(0.68, 0.76, tf));
    });
    const qInv = new THREE.Quaternion(); toeBW.decompose(new THREE.Vector3(), qInv, new THREE.Vector3()); qInv.invert();
    out.feet[S] = { tarso: tarso.bone, metatarso: meta.bone, toes: [[bigP.bone, bigD.bone], ...small.map((x) => [x.p.bone, x.m.bone, x.d.bone])], axis: side.clone().applyQuaternion(qInv).normalize() };
  }

  if (!newBones.length) return null;
  // esqueleto ampliado y pesos nuevos
  const bones = skel.bones.concat(newBones);
  const inv = skel.boneInverses.concat(newInv);
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  sk.bind(new THREE.Skeleton(bones, inv), sk.bindMatrix);
  out.added = newBones.length;
  out.cleaned = cleaned;
  out.mesh = sk;
  return out;
}

/* Pose de los huesos nuevos (cada fotograma, después de la animación del GLB).
   grip 0 = mano relajada · 1 = puño cerrado sobre el mango · walk = fase de la zancada */
const _q = new THREE.Quaternion();
export function poseAnatomy(an, { gripL = 0, gripR = 0, fistL = 0, fistR = 0, wristL = 0, wristR = 0, walk = 0, speed = 0, grounded = true } = {}) {
  if (!an) return;
  for (const S of ['L', 'R']) {
    const h = an.hands[S];
    if (h) {
      const gr = Math.max(S === 'L' ? gripL : gripR, S === 'L' ? fistL : fistR); // agarre del arma o puño (expresión)
      const c = h.curlSign;
      const relax = 0.12;
      h.fingers.forEach((ch, f) => {
        const spread = (f - 1.5) * 0.02;
        const k = relax + gr * (0.42 - f * 0.02);
        ch[0].quaternion.setFromAxisAngle(h.axis.w, c * k * 1.0);
        ch[1].quaternion.setFromAxisAngle(h.axis.w, c * k * 1.15);
        ch[2].quaternion.setFromAxisAngle(h.axis.w, c * k * 0.9);
        _q.setFromAxisAngle(h.axis.n, spread * (1 - gr));
        ch[0].quaternion.multiply(_q);
      });
      h.thumb[0].quaternion.setFromAxisAngle(h.axis.a, h.thumbSign * (0.08 + gr * 0.3));
      h.thumb[1].quaternion.setFromAxisAngle(h.axis.w, c * (0.06 + gr * 0.28));
      const wr = S === 'L' ? wristL : wristR;
      h.carpo.quaternion.setFromAxisAngle(h.axis.w, wr);
    }
    const ft = an.feet[S];
    if (ft && ft.axis) {
      // los dedos se doblan hacia arriba al despegar el pie y se relajan al apoyar
      const ph = S === 'L' ? walk : walk + Math.PI;
      const push = grounded ? Math.max(0, Math.sin(ph)) * Math.min(1, speed) : 0.15;
      ft.toes.forEach((ch) => {
        ch[0].quaternion.setFromAxisAngle(ft.axis, -0.35 * push);
        if (ch[1]) ch[1].quaternion.setFromAxisAngle(ft.axis, 0.12 * push);
        if (ch[2]) ch[2].quaternion.setFromAxisAngle(ft.axis, 0.08 * push);
      });
      ft.metatarso.quaternion.setFromAxisAngle(ft.axis, -0.08 * push);
    }
  }
}
