import * as THREE from 'three';

/* ======================================================================
   LIRA LA LINCE · H3.1
   Mejora del modelo GLB de Lira (public/models/lira.glb) construida en código,
   sin herramientas externas. No toca el sistema de juego: solo el modelo.

   · OJOS 3D: globo ocular con iris (verde = eclipse solar, azul = eclipse lunar),
     pupila, reflejo de estrella y brillo; PÁRPADOS 3D que parpadean y forman
     expresiones; mirada que se mueve; marcas de rayo luminosas alrededor.
     (El ojo derecho del GLB era una mancha de textura rota: el ojo 3D lo sustituye.)
   · ACCESORIOS 3D: tres aros luminosos y el colgante de estrella en la oreja,
     y el colgante de los eclipses (sol + media luna) en el pecho.
   · ARMADURA: mapa de emisión azul eléctrico generado desde su propia textura.
   · ANIMACIONES nuevas con su esqueleto: sprint, caída, aterrizaje, esquiva,
     ataque, escudo, habilidad especial e impacto (además de las 7 del GLB).
   · MOVIMIENTO SECUNDARIO: cola expresiva, orejas independientes, parpadeo,
     expresiones, dedos y huellas luminosas al moverse.
   ====================================================================== */

const TAU = Math.PI * 2, S = Math.sin;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// Referencias medidas sobre la malla de Lira (espacio del modelo, en reposo)
const NOSE_X = 0.005;
const BODY_X = -0.085; // línea media del torso de la malla (el esqueleto del GLB está desplazado: x = -0.14)
const EYE_R = { c: V3(-0.089, 0.537, 0.423), n: V3(-0.36, 0.05, 0.93), kind: 'sol' };   // su ojo derecho: verde
const EYE_L = { c: V3(0.090, 0.5365, 0.403), n: V3(0.36, 0.05, 0.93), kind: 'luna' };   // su ojo izquierdo: azul
const EYES_3D = false; // ver upgradeLira
const EYE_RADIUS = 0.044; // medido sobre el ojo verde pintado (≈3,5 cm); centros a ras de la superficie de la cara

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
// Coloca `obj` en el hueso `name` en la posición/orientación dadas en el espacio de la malla en reposo.
// local = (inversa de enlace del hueso) · (transformación en la malla): exacto aunque los huesos tengan escala.
const _M = new THREE.Matrix4(), _P = new THREE.Vector3(), _Q = new THREE.Quaternion(), _Sc = new THREE.Vector3();
function place(sk, bones, obj, name, meshPos, meshQuat = new THREE.Quaternion()) {
  const i = sk.skeleton.bones.findIndex((b) => b.name === name);
  if (i < 0 || !bones[name]) return false;
  _M.compose(meshPos, meshQuat, _Sc.set(1, 1, 1)).premultiply(sk.skeleton.boneInverses[i]); // = B · M (la malla tiene bindMatrix identidad)
  _M.decompose(obj.position, obj.quaternion, obj.scale);
  bones[name].add(obj);
  return true;
}
function bindPos(sk, name) {
  const i = sk.skeleton.bones.findIndex((b) => b.name === name);
  return i < 0 ? null : new THREE.Vector3().setFromMatrixPosition(sk.skeleton.boneInverses[i].clone().invert());
}

/* ---------------- texturas de los iris ---------------- */
function irisTexture(kind) {
  return canvasTex(512, 512, (g, w) => {
    const c = w / 2;
    g.fillStyle = '#f4efe6'; g.fillRect(0, 0, w, w); // esclerótica (apenas se ve)
    const R = w * 0.47;
    const rg = g.createRadialGradient(c, c, R * 0.15, c, c, R);
    if (kind === 'sol') { rg.addColorStop(0, '#0a3a12'); rg.addColorStop(0.32, '#1f9a3a'); rg.addColorStop(0.7, '#3fe070'); rg.addColorStop(0.93, '#0c5a22'); rg.addColorStop(1, '#06240c'); }
    else { rg.addColorStop(0, '#061a4a'); rg.addColorStop(0.32, '#1a5aff'); rg.addColorStop(0.7, '#5ab8ff'); rg.addColorStop(0.93, '#0a3aa8'); rg.addColorStop(1, '#041640'); }
    g.fillStyle = rg; g.beginPath(); g.arc(c, c, R, 0, TAU); g.fill();
    // fibras del iris
    g.globalAlpha = 0.35;
    for (let i = 0; i < 140; i++) { const a = (i / 140) * TAU + Math.random() * 0.03; g.strokeStyle = kind === 'sol' ? (i % 3 ? '#9aff9a' : '#ffd060') : (i % 3 ? '#bfe6ff' : '#e0e8ff'); g.lineWidth = 1.5; g.beginPath(); g.moveTo(c + Math.cos(a) * R * 0.32, c + Math.sin(a) * R * 0.32); g.lineTo(c + Math.cos(a) * R * (0.75 + Math.random() * 0.2), c + Math.sin(a) * R * (0.75 + Math.random() * 0.2)); g.stroke(); }
    g.globalAlpha = 1;
    if (kind === 'sol') { // eclipse solar: anillo dorado y corona de manchas
      g.strokeStyle = '#ffcc3a'; g.lineWidth = 9; g.beginPath(); g.arc(c, c, R * 0.42, 0, TAU); g.stroke();
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; g.fillStyle = '#1a2a08'; g.beginPath(); g.arc(c + Math.cos(a) * R * 0.86, c + Math.sin(a) * R * 0.86, R * 0.06, 0, TAU); g.fill(); }
    } else { // eclipse lunar: media luna oscura y destellos plateados
      g.fillStyle = 'rgba(4,10,40,0.75)'; g.beginPath(); g.arc(c, c, R * 0.62, -1.9, 1.9, false); g.arc(c + R * 0.16, c, R * 0.52, 1.75, -1.75, true); g.fill();
      for (let i = 0; i < 26; i++) { const a = Math.random() * TAU, r = R * (0.45 + Math.random() * 0.45); g.fillStyle = 'rgba(230,240,255,0.8)'; g.fillRect(c + Math.cos(a) * r, c + Math.sin(a) * r, 3, 3); }
    }
    // pupila y reflejos (uno con forma de estrella)
    g.fillStyle = '#05060a'; g.beginPath(); g.arc(c, c, R * 0.3, 0, TAU); g.fill();
    const star = (x, y, r) => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, rr = i % 2 ? r * 0.35 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill(); };
    g.fillStyle = '#ffffff'; star(c - R * 0.32, c - R * 0.34, R * 0.2);
    g.globalAlpha = 0.85; g.beginPath(); g.arc(c + R * 0.3, c + R * 0.3, R * 0.07, 0, TAU); g.fill(); g.globalAlpha = 1;
  });
}

/* ---------------- ojos, párpados y marcas ---------------- */
function buildEye(spec, sk, bones, furColor) {
  const R = EYE_RADIUS;
  const n = spec.n.clone().normalize();
  const g = new THREE.Group();
  g.name = `ojo_${spec.kind}`;
  // el globo asoma un poco de la cara
  place(sk, bones, g, 'head', spec.c.clone().addScaledVector(n, -R * 0.78), new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), n));
  const ball = new THREE.Group(); g.add(ball); // gira para mirar
  // globo + iris: casquete delantero con proyección plana del iris
  const tex = irisTexture(spec.kind);
  const geo = new THREE.SphereGeometry(R, 40, 28);
  const P = geo.attributes.position, UV = geo.attributes.uv;
  for (let i = 0; i < P.count; i++) UV.setXY(i, 0.5 + P.getX(i) / (2 * R) * 1.05, 0.5 + P.getY(i) / (2 * R) * 1.05);
  geo.rotateX(Math.PI / 2); // el polo de la esfera mira hacia delante (+Z)
  // tras rotar, recalcular UV en el plano XY (mirando a +Z)
  const P2 = geo.attributes.position;
  for (let i = 0; i < P2.count; i++) UV.setXY(i, 0.5 + P2.getX(i) / (2 * R) * 1.05, 0.5 + P2.getY(i) / (2 * R) * 1.05);
  const mat = new THREE.MeshPhysicalMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 });
  const eye = new THREE.Mesh(geo, mat);
  ball.add(eye);
  // párpados (superior e inferior): casquetes de pelaje que giran sobre el globo
  const lidMat = new THREE.MeshStandardMaterial({ color: furColor, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const lidGeo = new THREE.SphereGeometry(R * 1.03, 32, 16, 0, TAU, 0, Math.PI * 0.5);
  const upper = new THREE.Group(), lower = new THREE.Group();
  const um = new THREE.Mesh(lidGeo, lidMat), lm = new THREE.Mesh(lidGeo, lidMat);
  lm.rotation.x = Math.PI; // casquete inferior
  um.rotation.x = -0.35;    // casquete superior: hacia arriba y un poco atrás
  upper.add(um); lower.add(lm);
  g.add(upper, lower);
  // línea de pestañas
  const lash = new THREE.Mesh(new THREE.TorusGeometry(R * 1.08, R * 0.06, 6, 28, Math.PI * 0.9), new THREE.MeshStandardMaterial({ color: 0x140a06, roughness: 0.6 }));
  lash.rotation.z = Math.PI * 0.05;
  um.add(lash); lash.position.set(0, 0, 0); lash.rotation.x = Math.PI / 2 - Math.PI * 0.06;
  // marcas de rayo luminosas alrededor del ojo (doradas = sol, azules = luna)
  const markCol = spec.kind === 'sol' ? 0xffc040 : 0x5ab0ff;
  const markMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(markCol).multiplyScalar(2.2), toneMapped: false, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const side = Math.sign(spec.c.x - NOSE_X); // hacia fuera de la cara
  for (let k = 0; k < 3; k++) {
    const pts = [];
    const a0 = (k === 0 ? 0.6 : k === 1 ? -0.4 : 2.2) + (side < 0 ? Math.PI : 0) * 0;
    let a = a0, r = R * 1.25;
    for (let s = 0; s < 6; s++) { pts.push(V3(Math.cos(a) * r * (side > 0 ? 1 : -1), Math.sin(a) * r, R * 0.55)); a += (Math.random() - 0.3) * 0.35; r += R * (0.25 + Math.random() * 0.2); }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, R * 0.035, 4), markMat);
    g.add(tube);
  }
  return { group: g, ball, upper, lower, eyeMat: mat, markMat, kind: spec.kind };
}

/* ---------------- accesorios ---------------- */
function starShape(r, k = 0.38, n = 4) {
  const s = new THREE.Shape();
  for (let i = 0; i <= n * 2; i++) { const a = (i / (n * 2)) * TAU - Math.PI / 2, rr = i % 2 ? r * k : r; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (i === 0) s.moveTo(x, y); else s.lineTo(x, y); }
  return s;
}
function buildEarJewelry(hero, sk) {
  const out = [];
  const e1 = bindPos(sk, 'ear_L_1'), e2 = bindPos(sk, 'ear_L_2'), e3 = bindPos(sk, 'ear_L_end');
  if (!e1 || !e2) return out;
  const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3a8cff).multiplyScalar(2.4), toneMapped: false });
  const metal = new THREE.MeshStandardMaterial({ color: 0x1a2a4a, metalness: 0.9, roughness: 0.25, emissive: 0x1a5aff, emissiveIntensity: 0.6 });
  // borde exterior de la oreja: hacia fuera de la cabeza (+x para la oreja izquierda)
  const geo = sk.geometry, P = geo.attributes.position, SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight;
  const earIdx = new Set(sk.skeleton.bones.map((b, i) => (/^ear_L/.test(b.name) ? i : -1)).filter((i) => i >= 0));
  const earV = [];
  for (let i = 0; i < P.count; i++) { let w = 0; for (let k = 0; k < 4; k++) if (earIdx.has(SI.getComponent(i, k))) w += SW.getComponent(i, k); if (w > 0.6) earV.push(V3(P.getX(i), P.getY(i), P.getZ(i))); }
  let pts = [e1.clone().lerp(e2, 0.35), e1.clone().lerp(e2, 0.8), e2.clone().lerp(e3 || e2, 0.35)];
  if (earV.length > 30) {
    const ys = earV.map((v) => v.y).sort((a, b) => a - b), y0 = ys[Math.floor(ys.length * 0.1)], y1 = ys[Math.floor(ys.length * 0.75)];
    pts = [0.15, 0.4, 0.65].map((f) => { const y = y0 + (y1 - y0) * f; let best = null; for (const v of earV) if (Math.abs(v.y - y) < 0.02 && (!best || v.x > best.x)) best = v; return best ? best.clone().add(V3(0.004, 0, 0)) : e1.clone(); });
  }
  const boneFor = (i) => (i < 2 ? hero.bones.ear_L_1 : hero.bones.ear_L_2);
  const baseFor = (i) => (i < 2 ? e1 : e2);
  pts.forEach((p, i) => {
    const ring = new THREE.Group();
    const torus = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0034, 8, 20), metal);
    const glow = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0015, 6, 20), neon);
    ring.add(torus, glow);
    place(sk, hero.bones, ring, i < 2 ? 'ear_L_1' : 'ear_L_2', p.clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0, Math.PI / 2)));
    void baseFor; void boneFor;
    out.push(neon);
  });
  // colgante de estrella bajo el aro inferior
  const star = new THREE.Group();
  const sm = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(0.012), { depth: 0.003, bevelEnabled: true, bevelSize: 0.0012, bevelThickness: 0.001, bevelSegments: 1 }), neon);
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.0009, 0.0009, 0.018, 4), metal);
  chain.position.y = 0.012; star.add(sm, chain); sm.position.z = -0.0015;
  place(sk, hero.bones, star, 'ear_L_1', pts[0].clone().add(V3(0.004, -0.03, 0)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)));
  star.scale.multiplyScalar(1.4);
  return { neon: out.concat([neon]), star };
}
function buildPendant(hero, sk) {
  const chestI = sk.skeleton.bones.findIndex((b) => b.name === 'chest');
  const chestBind = bindPos(sk, 'chest'), neckBind = bindPos(sk, 'neck');
  if (chestI < 0 || !chestBind) return null;
  // punto delantero del pecho, bajo el cuello, en la línea media
  const geo = sk.geometry, P = geo.attributes.position, SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight;
  let best = null, bz = -9;
  const yLo = chestBind.y + (neckBind ? (neckBind.y - chestBind.y) * 0.15 : 0.02), yHi = neckBind ? neckBind.y - (neckBind.y - chestBind.y) * 0.25 : chestBind.y + 0.15;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (Math.abs(x - BODY_X) > 0.03 || y < yLo || y > yHi) continue;
    let w = 0; for (let k = 0; k < 4; k++) if (SI.getComponent(i, k) === chestI) w += SW.getComponent(i, k);
    if (w > 0.3 && z > bz) { bz = z; best = V3(x, y, z); }
  }
  if (!best) return null;
  const g = new THREE.Group();
  const at = best.clone().add(V3(0, 0, 0.012));
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc040, metalness: 1, roughness: 0.25, emissive: 0xff9a10, emissiveIntensity: 0.5 });
  const sun = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.0045, 10, 32), gold);
  const core = new THREE.Mesh(new THREE.CircleGeometry(0.016, 28), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd060).multiplyScalar(1.8), toneMapped: false }));
  const moonShape = new THREE.Shape(); moonShape.absarc(0, 0, 0.016, Math.PI * 0.5, Math.PI * 1.5, false); moonShape.absarc(0.007, 0, 0.012, Math.PI * 1.5, Math.PI * 0.5, true);
  const moonMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3a9aff).multiplyScalar(2.4), toneMapped: false });
  const moon = new THREE.Mesh(new THREE.ExtrudeGeometry(moonShape, { depth: 0.003, bevelEnabled: false }), moonMat);
  moon.position.set(0.014, 0, 0.004);
  core.position.z = 0.001;
  g.add(sun, core, moon);
  // cordón hacia el cuello
  const cord = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.0015, 4, 30, Math.PI), new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.5 }));
  cord.position.set(0, 0.06, -0.02); cord.rotation.x = -0.25; g.add(cord);
  place(sk, hero.bones, g, 'chest', at);
  g.scale.multiplyScalar(1.7); // medallón bien visible, como en la referencia
  return { group: g, glow: [core.material, moonMat] };
}

/* ---------------- armadura: emisión azul eléctrico desde su textura ---------------- */
function buildArmorGlow(material) {
  const img = material.map && material.map.image;
  if (!img || !img.width) return null;
  const W = Math.min(1024, img.width);
  const c = document.createElement('canvas'); c.width = W; c.height = W;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, W, W);
  const d = x.getImageData(0, 0, W, W), a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    const r = a[i] / 255, g = a[i + 1] / 255, b = a[i + 2] / 255;
    const blue = b > 0.5 && b > r * 2.2 && b > g * 1.2;
    const k = blue ? clamp((b - 0.5) * 3, 0, 1) : 0;
    a[i] = 30 * k; a[i + 1] = 120 * k; a[i + 2] = 255 * k; a[i + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = material.map.flipY;
  t.channel = material.map.channel;
  return t;
}

/* ---------------- animaciones (convención del rig: huesos sin rotación de reposo) ---------------- */
const FPS = 30;
const _e = new THREE.Euler(), _q = new THREE.Quaternion();
function makeClip(name, duration, pose, bones, rootBase) {
  const frames = Math.round(duration * FPS);
  const times = new Float32Array(frames + 1);
  const rot = {};
  const rootPos = new Float32Array((frames + 1) * 3);
  for (let f = 0; f <= frames; f++) {
    const t = f / frames;
    times[f] = t * duration;
    const p = pose(t);
    for (const [b, e] of Object.entries(p.bones)) {
      if (!bones[b]) continue;
      _q.setFromEuler(_e.set(e[0] || 0, e[1] || 0, e[2] || 0, 'XYZ'));
      (rot[b] = rot[b] || new Float32Array((frames + 1) * 4)).set([_q.x, _q.y, _q.z, _q.w], f * 4);
    }
    rootPos.set([rootBase.x + (p.dx || 0), rootBase.y + (p.dy || 0), rootBase.z + (p.dz || 0)], f * 3);
  }
  const tracks = Object.entries(rot).map(([b, v]) => {
    for (let f = 0; f <= frames; f++) if (!v[f * 4] && !v[f * 4 + 1] && !v[f * 4 + 2] && !v[f * 4 + 3]) v[f * 4 + 3] = 1;
    return new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, v);
  });
  tracks.push(new THREE.VectorKeyframeTrack('root.position', times, rootPos));
  return new THREE.AnimationClip(name, duration, tracks);
}
const merge = (...o) => Object.assign({}, ...o);
const tail = (t, amp, speed = 1, lift = 0) => { const o = {}; for (let i = 1; i <= 5; i++) { const ph = t * TAU * speed - i * 0.7; o['tail_' + i] = [lift + S(ph * 0.5) * amp * 0.25, S(ph) * amp, 0]; } return o; };
const ears = (t, amp, speed = 1, back = 0) => { const o = {}; for (let i = 1; i <= 2; i++) { const ph = t * TAU * speed - i * 0.5; o['ear_L_' + i] = [back + S(ph + 0.6) * amp * 0.4, 0, -S(ph) * amp]; o['ear_R_' + i] = [back + S(ph + 0.6) * amp * 0.4, 0, S(ph + 0.4) * amp]; } return o; };
const gait = (t, k) => {
  const a = t * TAU, swing = 0.55 * k, knee = 0.7 * k, sl = S(a), sr = S(a + Math.PI);
  return {
    dy: Math.abs(S(a)) * 0.022 * k,
    bones: {
      thigh_L: [-sl * swing, 0, 0], thigh_R: [-sr * swing, 0, 0],
      shin_L: [Math.max(0, S(a + 1.2)) * knee, 0, 0], shin_R: [Math.max(0, S(a + 1.2 + Math.PI)) * knee, 0, 0],
      foot_L: [sl * 0.25 * k, 0, 0], foot_R: [sr * 0.25 * k, 0, 0],
      upper_arm_L: [sl * 0.6 * k, 0, -0.12], upper_arm_R: [sr * 0.6 * k, 0, 0.12],
      forearm_L: [-0.3 - Math.max(0, -sl) * 0.5 * k, 0, 0], forearm_R: [-0.3 - Math.max(0, -sr) * 0.5 * k, 0, 0],
      spine: [0.06 * k, S(a) * 0.1 * k, 0], chest: [0.03 * k, -S(a) * 0.08 * k, 0], head: [-0.05 * k + S(a * 2) * 0.03, -S(a) * 0.05, 0],
    },
  };
};
const bell = (t, a, b) => (t < a ? t / a : t > b ? Math.max(0, (1 - t) / (1 - b)) : 1); // sube, se mantiene, baja

function buildClips(bones, rootBase) {
  const mk = (n, d, p) => makeClip(n, d, p, bones, rootBase);
  return {
    // SPRINT (botón de velocidad): zancada larga, torso inclinado, cola estirada y orejas atrás
    sprint: mk('sprint', 0.45, (t) => { const g = gait(t, 2.4); return { dy: g.dy, bones: merge(g.bones, { spine: [0.32, S(t * TAU) * 0.14, 0], head: [-0.25, 0, 0] }, tail(t, 0.12, 2, -0.35), ears(t, 0.08, 2, -0.75)) }; }),
    // CAÍDA: piernas hacia el suelo, brazos abiertos para equilibrarse, cola arriba
    fall: mk('fall', 0.8, (t) => ({ bones: merge({ thigh_L: [-0.35, 0, 0.08], thigh_R: [-0.15, 0, -0.08], shin_L: [0.5, 0, 0], shin_R: [0.3, 0, 0], foot_L: [-0.2, 0, 0], foot_R: [-0.2, 0, 0], upper_arm_L: [-1.1 + S(t * TAU) * 0.12, 0, -0.9], upper_arm_R: [-1.1 + S(t * TAU + 1) * 0.12, 0, 0.9], forearm_L: [-0.3, 0, 0], forearm_R: [-0.3, 0, 0], spine: [0.1, 0, 0], head: [0.25, 0, 0] }, tail(t, 0.3, 2, 0.5), ears(t, 0.25, 3, 0.4)) })),
    // ATERRIZAJE: amortigua flexionando rodillas y vuelve a erguirse
    land: mk('land', 0.35, (t) => { const k = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7; return { dy: -0.12 * k, bones: merge({ thigh_L: [-0.95 * k, 0, 0.1], thigh_R: [-0.95 * k, 0, -0.1], shin_L: [1.5 * k, 0, 0], shin_R: [1.5 * k, 0, 0], foot_L: [-0.55 * k, 0, 0], foot_R: [-0.55 * k, 0, 0], spine: [0.35 * k, 0, 0], upper_arm_L: [0.3 * k, 0, -0.6 * k], upper_arm_R: [0.3 * k, 0, 0.6 * k], head: [-0.3 * k, 0, 0] }, tail(t, 0.2, 1, -0.4 * k), ears(t, 0.1, 1, -0.4 * k)) }; }),
    // ESQUIVA: se agacha y gira el torso, la cola hace de contrapeso
    dodge: mk('dodge', 0.4, (t) => { const k = Math.sin(t * Math.PI); return { dy: -0.1 * k, bones: merge({ thigh_L: [-0.8 * k, 0, 0.3 * k], thigh_R: [-0.3 * k, 0, -0.2 * k], shin_L: [1.1 * k, 0, 0], shin_R: [0.9 * k, 0, 0], spine: [0.45 * k, 0.5 * k, 0.2 * k], chest: [0.1 * k, 0.3 * k, 0], upper_arm_L: [-0.6 * k, 0, -1.0 * k], upper_arm_R: [0.4 * k, 0, 0.5 * k], head: [-0.2 * k, -0.4 * k, 0] }, tail(t, 0.5, 1, 0.1), ears(t, 0.1, 2, -0.6 * k)) }; }),
    // ATAQUE: zancada al frente y giro de cadera (el brazo del arma lo lleva la capa del arma)
    attack: mk('attack', 0.55, (t) => { const k = bell(t, 0.25, 0.6); return { dy: -0.05 * k, bones: merge({ thigh_L: [-0.75 * k, 0, 0.1], thigh_R: [0.45 * k, 0, -0.1], shin_L: [0.6 * k, 0, 0], shin_R: [0.5 * k, 0, 0], foot_R: [0.3 * k, 0, 0], spine: [0.2 * k, -0.45 * k, 0], chest: [0.05 * k, -0.3 * k, 0], upper_arm_L: [-0.5 * k, 0, -0.4 * k], head: [-0.1 * k, 0.4 * k, 0] }, tail(t, 0.25, 2, 0.25 * k), ears(t, 0.08, 2, 0.25 * k)) }; }),
    // ESCUDO: guardia baja y firme, brazos cruzados delante, orejas atrás y cola envolviendo
    shield: mk('shield', 1.2, (t) => ({ dy: -0.07 + S(t * TAU) * 0.005, bones: merge({ thigh_L: [-0.55, 0, 0.2], thigh_R: [-0.3, 0, -0.2], shin_L: [0.85, 0, 0], shin_R: [0.65, 0, 0], foot_L: [-0.25, 0, 0], foot_R: [-0.2, 0, 0], spine: [0.28, 0, 0], chest: [0.1, 0, 0], upper_arm_L: [-1.25, 0.4, 0.55], upper_arm_R: [-1.25, -0.4, -0.55], forearm_L: [-1.3, 0, 0], forearm_R: [-1.3, 0, 0], head: [-0.15, 0, 0] }, tail(t, 0.12, 1, -0.2), ears(t, 0.05, 1, -0.65)) })),
    // HABILIDAD ESPECIAL: se eleva de puntillas, abre los brazos, mira al cielo y concentra energía
    special: mk('special', 1.0, (t) => { const k = bell(t, 0.3, 0.75); return { dy: 0.05 * k + S(t * TAU * 2) * 0.01 * k, bones: merge({ thigh_L: [-0.05, 0, 0.12 * k], thigh_R: [-0.05, 0, -0.12 * k], foot_L: [0.5 * k, 0, 0], foot_R: [0.5 * k, 0, 0], spine: [-0.15 * k, 0, 0], chest: [-0.15 * k, 0, 0], upper_arm_L: [-0.4 * k, 0, -1.4 * k], upper_arm_R: [-0.4 * k, 0, 1.4 * k], forearm_L: [-0.2 * k, 0, 0], forearm_R: [-0.2 * k, 0, 0], head: [0.35 * k, 0, 0] }, tail(t, 0.35, 2, 0.6 * k), ears(t, 0.3, 4, 0.35 * k)) }; }),
    // IMPACTO: retrocede, se protege con los brazos, orejas planas
    hit: mk('hit', 0.4, (t) => { const k = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8; return { dz: -0.04 * k, bones: merge({ spine: [-0.3 * k, 0.15 * k, 0], chest: [-0.15 * k, 0, 0], head: [-0.3 * k, -0.2 * k, 0], upper_arm_L: [-0.9 * k, 0, -0.3 * k], upper_arm_R: [-0.7 * k, 0, 0.3 * k], forearm_L: [-1.2 * k, 0, 0], forearm_R: [-1.1 * k, 0, 0], thigh_L: [0.2 * k, 0, 0], thigh_R: [-0.3 * k, 0, 0], shin_R: [0.4 * k, 0, 0] }, tail(t, 0.6, 3, -0.3 * k), ears(t, 0.05, 2, -1.0 * k)) }; }),
  };
}

/* ---------------- huellas luminosas ---------------- */
let _pawTex = null;
function pawTexture() {
  if (_pawTex) return _pawTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath(); g.ellipse(64, 80, 26, 22, 0, 0, TAU); g.fill();
  for (const [x, y] of [[30, 44], [52, 30], [76, 30], [98, 44]]) { g.beginPath(); g.ellipse(x, y, 11, 14, 0, 0, TAU); g.fill(); }
  _pawTex = new THREE.CanvasTexture(c);
  return _pawTex;
}

/* ======================================================================
   Mejora del héroe GLB (se llama desde GLBHero, después del esqueleto y la anatomía)
   ====================================================================== */
export function upgradeLira(hero, model) {
  let sk = null;
  model.traverse((o) => { if (o.isSkinnedMesh && !sk) sk = o; });
  if (!sk || !hero.bones.head) return null;
  const mat = sk.material;
  // armadura con emisión azul eléctrico
  const glowTex = buildArmorGlow(mat);
  if (glowTex) { mat.emissiveMap = glowTex; mat.emissive = new THREE.Color(0xffffff); mat.emissiveIntensity = 0.9; mat.needsUpdate = true; }
  // ojos 3D
  void bindPos;
  const fur = new THREE.Color(0xd9662a);
  // Los ojos 3D se hicieron para el modelo anterior (su ojo derecho era una mancha rota). El diseño definitivo
  // (H2.5) ya trae los dos ojos pintados (verde y azul), así que se conserva su cara tal cual.
  const eyes = EYES_3D ? [buildEye(EYE_R, sk, hero.bones, fur), buildEye(EYE_L, sk, hero.bones, fur)] : [];
  // accesorios
  const ear = buildEarJewelry(hero, sk);
  const pendant = buildPendant(hero, sk);
  // animaciones nuevas
  const clips = buildClips(hero.bones, hero.bones.root.position.clone());
  // estado del movimiento secundario
  const st = {
    blinkT: 2, blink: 0, gaze: V3(0, 0, 0), gazeT: 1, lid: 1, lidTilt: 0, still: 0,
    earTw: { L: 0, R: 0 }, earT: 3, expr: 'neutral', paws: [], stepPh: 0, lastFoot: 0, t: 0,
  };
  const qa = new THREE.Quaternion(), ax = new THREE.Vector3(1, 0, 0), az = new THREE.Vector3(0, 0, 1), ay = new THREE.Vector3(0, 1, 0);
  const addRot = (bone, axis, ang) => { if (bone && ang) bone.quaternion.multiply(qa.setFromAxisAngle(axis, ang)); };

  function expression(s) {
    if (s.hurt) return 'dolor';
    if (s.celebrate) return 'feliz';
    if (s.role === 'especial' || (s.power || 0) > 0.2) return 'sorpresa';
    if (s.role === 'arma' || s.role === 'escudo' || s.armed) return 'concentrada';
    return 'neutral';
  }
  const EXPR = { // apertura de párpados, inclinación (cejas), orejas atrás, alegría de la cola
    neutral: { lid: 1, tilt: 0, ear: 0, wag: 0 },
    feliz: { lid: 0.72, tilt: -0.12, ear: 0.15, wag: 0.4 },
    concentrada: { lid: 0.82, tilt: 0.22, ear: 0.2, wag: -0.2 },
    dolor: { lid: 0.45, tilt: -0.2, ear: -0.9, wag: 0 },
    sorpresa: { lid: 1.15, tilt: -0.05, ear: 0.35, wag: 0.1 },
  };

  function update(dt, s, run) {
    st.t += dt;
    const ex = EXPR[expression(s)];
    // parpadeo
    st.blinkT -= dt;
    if (st.blinkT <= 0) { st.blink = 0.14; st.blinkT = 2.2 + Math.random() * 3.5; if (Math.random() < 0.2) st.blinkT = 0.25; }
    st.blink = Math.max(0, st.blink - dt);
    const blinkK = st.blink > 0 ? Math.sin((1 - st.blink / 0.14) * Math.PI) : 0;
    st.lid = damp(st.lid, ex.lid, 10, dt);
    st.lidTilt = damp(st.lidTilt, ex.tilt, 8, dt);
    const open = clamp(st.lid * (1 - blinkK), 0, 1.2);
    // mirada: pequeños movimientos rápidos de los ojos
    st.gazeT -= dt;
    if (st.gazeT <= 0) { st.gazeT = 0.8 + Math.random() * 2.2; st.gaze.set((Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.2, 0); }
    for (const e of eyes) {
      e.ball.rotation.x = damp(e.ball.rotation.x, -st.gaze.y, 18, dt);
      e.ball.rotation.y = damp(e.ball.rotation.y, st.gaze.x, 18, dt);
      // párpado superior: abierto = girado hacia atrás (bajo la ceja); cerrado = cubre el ojo
      const side = e.kind === 'sol' ? -1 : 1;
      e.upper.rotation.set(-0.15 + (1 - Math.min(1, open)) * 1.45 - Math.max(0, open - 1) * 0.5, 0, side * st.lidTilt);
      e.lower.rotation.set(0.5 - (1 - Math.min(1, open)) * 1.4, 0, 0);
      const lidsOn = open < 0.97; // los párpados solo se ven al parpadear o con una expresión
      e.upper.visible = lidsOn; e.lower.visible = lidsOn && open < 0.35;
      e.eyeMat.emissiveIntensity = 0.3 + 0.15 * Math.sin(st.t * 2.4) + (s.role ? 0.25 : 0);
      e.markMat.opacity = 0.65 + 0.3 * Math.sin(st.t * 3 + (e.kind === 'sol' ? 0 : 1.7));
    }
    // brillo de la armadura y joyas
    if (glowTex) mat.emissiveIntensity = 0.8 + 0.2 * Math.sin(st.t * 2) + (s.role ? 0.4 : 0);
    // orejas: postura según la expresión + tics independientes
    st.earT -= dt;
    if (st.earT <= 0) { st.earT = 2.5 + Math.random() * 4; st.earTw[Math.random() < 0.5 ? 'L' : 'R'] = 0.3; }
    for (const side of ['L', 'R']) {
      st.earTw[side] = Math.max(0, st.earTw[side] - dt);
      const tw = st.earTw[side] > 0 ? Math.sin((1 - st.earTw[side] / 0.3) * Math.PI) * 0.45 : 0;
      const b1 = hero.bones[`ear_${side}_1`], b2 = hero.bones[`ear_${side}_2`];
      addRot(b1, ax, ex.ear * 0.6);
      addRot(b1, az, (side === 'L' ? -1 : 1) * tw);
      addRot(b2, ax, ex.ear * 0.4);
    }
    // cola expresiva: feliz = meneo amplio, concentrada = alzada y quieta, impaciente = la punta golpea
    const moving = run > 0.15;
    st.still = moving || s.role ? 0 : st.still + dt;
    for (let i = 1; i <= 5; i++) {
      const b = hero.bones['tail_' + i];
      if (!b) continue;
      addRot(b, ay, Math.sin(st.t * 5 - i * 0.6) * ex.wag * 0.12 * i / 3);
      if (ex.wag < 0) addRot(b, ax, ex.wag * 0.35);
      if (st.still > 5 && i >= 4) addRot(b, ay, Math.sin(st.t * 11) * 0.35 * Math.max(0, Math.sin(st.t * 0.9))); // impaciente
    }
    // dedos: puño firme en guardia o con el escudo; relajados (con un leve movimiento) el resto del tiempo
    const hp = hero.handPose;
    if (hp) {
      const fist = s.role === 'escudo' || s.role === 'arma' || s.hurt ? 1 : 0.15 + 0.08 * Math.sin(st.t * 1.3);
      hp.fistL = damp(hp.fistL || 0, fist, 10, dt);
      hp.fistR = damp(hp.fistR || 0, fist, 10, dt);
    }
    // huellas luminosas (verde y azul) en cada paso
    const scene = hero.root.parent;
    if (scene && s.grounded && moving && !s.swimming) {
      const ph = Math.floor(hero.phase / Math.PI);
      if (ph !== st.stepPh) {
        st.stepPh = ph;
        st.lastFoot ^= 1;
        const foot = hero.bones[st.lastFoot ? 'foot_L' : 'foot_R'];
        if (foot) {
          const p = new THREE.Vector3(); foot.getWorldPosition(p);
          const m = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshBasicMaterial({ map: pawTexture(), color: new THREE.Color(st.lastFoot ? 0x3aff7a : 0x3a9aff).multiplyScalar(1.8), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
          m.rotation.x = -Math.PI / 2; m.rotation.z = hero.root.rotation.y + Math.PI;
          m.position.set(p.x, hero.root.position.y + 0.03, p.z);
          scene.add(m);
          st.paws.push({ m, t: 0 });
        }
      }
    }
    for (let i = st.paws.length - 1; i >= 0; i--) {
      const pw = st.paws[i]; pw.t += dt;
      pw.m.material.opacity = 0.8 * Math.max(0, 1 - pw.t / 1.4);
      if (pw.t > 1.4) { pw.m.removeFromParent(); pw.m.geometry.dispose(); pw.m.material.dispose(); st.paws.splice(i, 1); }
    }
  }
  return { clips, update, eyes, ear, pendant, glowTex };
}
