import * as THREE from 'three';

/* ======================================================================
   ARMAS 3D DE CATAC 7 — modelos hechos a partir de las imágenes de referencia
   Cada arma:
     · se construye a su tamaño real (metros), con el punto de agarre en el origen
       y el eje largo en +Y (filo / cabeza hacia +Y, cara principal mirando a +Z);
     · tiene su propio esqueleto (THREE.Bone + THREE.Skeleton): las piezas van
       colgadas de los huesos (empuñadura → guarda → hoja → punta…), así que se
       pueden animar por huesos (los discos y el bumerán giran por su hueso);
     · separa los materiales NEÓN (brillo permanente, emisión > 1 → resplandor/bloom)
       y unos marcadores `trail` (base y punta) para las estelas de los ataques.
   ====================================================================== */

const C = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);

function canvasTex(w, h, draw, { srgb = true, repeat } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
// textura de una forma extruida: sus UV son las coordenadas x,y de la forma → se ajusta al rectángulo [x0,x1]×[y0,y1]
function fitTex(t, x0, x1, y0, y1) {
  t.repeat.set(1 / (x1 - x0), 1 / (y1 - y0));
  t.offset.set(-x0 / (x1 - x0), -y0 / (y1 - y0));
  return t;
}

let _glowTex = null;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  _glowTex = canvasTex(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    r.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  }, { srgb: false });
  return _glowTex;
}

/* ---------------- materiales ---------------- */
const metal = (color, rough = 0.35, met = 0.85, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: met, ...extra });
// neón sólido: no se ve afectado por el tono → supera el umbral del bloom
const neonSolid = (color, k = 2.6) => {
  const m = new THREE.MeshBasicMaterial({ color: C(color, k), toneMapped: false });
  m.userData.neon = { base: k, color: new THREE.Color(color) };
  return m;
};
// neón aditivo (halos, filos de energía)
const neonAdd = (color, k = 2, opacity = 0.9) => {
  const m = new THREE.MeshBasicMaterial({ color: C(color, k), toneMapped: false, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  m.userData.neon = { base: k, color: new THREE.Color(color) };
  return m;
};
// material emisivo (metal/cristal que brilla): su intensidad sube y baja con el pulso neón
const glowStd = (opts, k) => {
  const m = new THREE.MeshStandardMaterial(opts);
  m.userData.neonStd = { base: k ?? opts.emissiveIntensity ?? 1 };
  return m;
};

/* ---------------- piezas ---------------- */
function mesh(geo, mat, parent, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  if (s) (Array.isArray(s) ? m.scale.set(...s) : m.scale.setScalar(s));
  m.castShadow = true;
  parent.add(m);
  return m;
}
function extrude(shape, depth, bevel = 0.004, segs = 2, curve = 24) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segs, steps: 1, curveSegments: curve });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}
function sprite(color, size, parent, pos, opacity = 0.8) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: C(color, 1.6), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  s.scale.setScalar(size);
  s.position.copy(pos);
  s.userData.glow = { size, opacity };
  parent.add(s);
  return s;
}
// rayo animado entre dos puntos locales (se regenera cada pocos centésimos)
class Arc {
  constructor(parent, a, b, color, segs = 10, jag = 0.02) {
    this.a = a; this.b = b; this.segs = segs; this.jag = jag; this.t = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((segs + 1) * 3), 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: C(color, 3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.line.frustumCulled = false;
    parent.add(this.line);
    this.regen();
  }
  regen() {
    const p = this.line.geometry.attributes.position, a = this.a, b = this.b;
    for (let i = 0; i <= this.segs; i++) {
      const k = i / this.segs, j = i === 0 || i === this.segs ? 0 : this.jag;
      p.setXYZ(i, a.x + (b.x - a.x) * k + (Math.random() - 0.5) * j * 2, a.y + (b.y - a.y) * k + (Math.random() - 0.5) * j * 2, a.z + (b.z - a.z) * k + (Math.random() - 0.5) * j);
    }
    p.needsUpdate = true;
  }
  update(dt, power) {
    this.t -= dt;
    if (this.t <= 0) { this.t = 0.045 + Math.random() * 0.06; this.regen(); this.line.visible = Math.random() < 0.55 + power * 0.45; }
    this.line.material.opacity = 0.55 + power * 0.45;
  }
}

/* Esqueleto del arma: cadena de huesos a lo largo de +Y */
function rig(names, ys) {
  const bones = {};
  let parent = null, prevY = 0;
  const list = names.map((n, i) => {
    const b = new THREE.Bone();
    b.name = `w_${n}`;
    b.position.y = ys[i] - prevY;
    prevY = ys[i];
    if (parent) parent.add(b);
    parent = b;
    bones[n] = b;
    return b;
  });
  return { root: list[0], bones, skeleton: new THREE.Skeleton(list) };
}
// coloca una pieza en un hueso usando coordenadas del arma (no del hueso)
function at(bone, obj) {
  bone.updateMatrixWorld(true);
  let y = 0;
  for (let b = bone; b && b.isBone; b = b.parent) y += b.position.y;
  obj.position.y -= y;
  bone.add(obj);
  return obj;
}
function finish(w) {
  w.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.own = true; } });
  return w;
}
function base(name, len, color, color2) {
  const group = new THREE.Group();
  group.name = `arma_${name}`;
  return { name, group, len, color, color2, neon: [], neonStd: [], glows: [], arcs: [], spin: [], trail: null, anim: null };
}
function collect(w) {
  w.group.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      if (m.userData.neon && !w.neon.includes(m)) w.neon.push(m);
      if (m.userData.neonStd && !w.neonStd.includes(m)) w.neonStd.push(m);
    }
    if (o.isSprite && o.userData.glow) w.glows.push(o);
  });
}
const marker = (parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; };

/* ======================================================================
   1 · JAGLION — KATANA: hoja curva negra con grietas de lava naranjas, filo
   de fuego y relámpagos azules; guarda dorada de melena de león, mango
   negro con rombos dorados y pomo con gema naranja.
   ====================================================================== */
function katana(L) {
  const w = base('katana', L, 0xff7a1a, 0x3aa0ff);
  const R = rig(['grip', 'guard', 'blade', 'mid', 'tip'], [0, 0.15, 0.2, 0.55, 0.95]);
  w.group.add(R.root); w.skeleton = R.skeleton; w.bones = R.bones;
  const cx = (t) => 0.075 * t * t;          // curvatura (el lomo va hacia +x)
  const yb = (t) => 0.17 + 0.81 * t;
  const wd = (t) => 0.046 * (1 - 0.2 * t);
  const sh = new THREE.Shape();
  const N = 30;
  sh.moveTo(cx(0) + wd(0) * 0.5, yb(0));
  for (let i = 1; i <= N; i++) { const t = i / N; sh.lineTo(cx(t) + wd(t) * (t > 0.92 ? 0.5 - (t - 0.92) * 5.5 : 0.5), yb(t)); }
  sh.lineTo(cx(1) - 0.004, yb(1) + 0.012); // punta (kissaki)
  for (let i = N; i >= 0; i--) { const t = i / N; if (t > 0.94) continue; sh.lineTo(cx(t) - wd(t) * 0.5, yb(t)); }
  sh.closePath();
  const X0 = -0.04, X1 = 0.11, Y0 = 0.16, Y1 = 1.0;
  const bladeMap = fitTex(canvasTex(256, 1024, (g, cw, ch) => {
    g.fillStyle = '#16120f'; g.fillRect(0, 0, cw, ch);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${60 + Math.random() * 30},${40 + Math.random() * 20},${30},0.25)`; g.fillRect(Math.random() * cw, Math.random() * ch, 2, 6); }
    // grabados (runas) en el centro
    g.strokeStyle = '#3a2a1a'; g.lineWidth = 6;
    for (let y = 120; y < ch - 80; y += 95) { g.beginPath(); g.moveTo(cw * 0.45, y); g.lineTo(cw * 0.62, y + 28); g.lineTo(cw * 0.45, y + 56); g.moveTo(cw * 0.52, y + 10); g.lineTo(cw * 0.7, y + 10); g.stroke(); }
  }), X0, X1, Y0, Y1);
  const bladeEm = fitTex(canvasTex(256, 1024, (g, cw, ch) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch);
    // filo de fuego (lado −x → izquierda del lienzo)
    const gr = g.createLinearGradient(0, 0, cw * 0.5, 0);
    gr.addColorStop(0, '#ffd070'); gr.addColorStop(0.18, '#ff7a1a'); gr.addColorStop(0.5, 'rgba(120,30,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
    // grietas de lava
    g.strokeStyle = '#ff6a10'; g.lineWidth = 3;
    for (let k = 0; k < 26; k++) { let x = cw * (0.25 + Math.random() * 0.4), y = Math.random() * ch; g.beginPath(); g.moveTo(x, y); for (let s = 0; s < 6; s++) { x += (Math.random() - 0.5) * 30; y += 10 + Math.random() * 18; g.lineTo(x, y); } g.stroke(); }
    // relámpagos azules junto al lomo (derecha)
    g.strokeStyle = '#5ab8ff'; g.lineWidth = 3;
    for (let k = 0; k < 14; k++) { let x = cw * (0.62 + Math.random() * 0.2), y = Math.random() * ch * 0.75; g.beginPath(); g.moveTo(x, y); for (let s = 0; s < 7; s++) { x += (Math.random() - 0.5) * 24; y += 8 + Math.random() * 14; g.lineTo(x, y); } g.stroke(); }
  }, { srgb: true }), X0, X1, Y0, Y1);
  const bladeMat = glowStd({ color: 0xffffff, map: bladeMap, emissive: 0xffffff, emissiveMap: bladeEm, emissiveIntensity: 1.6, metalness: 0.75, roughness: 0.32 }, 1.6);
  at(R.bones.blade, mesh(extrude(sh, 0.012, 0.004, 2), bladeMat, new THREE.Group()));
  // filo de fuego neón (tubo a lo largo del borde cortante) y lomo de rayo azul
  const edgePts = [], spinePts = [];
  for (let i = 0; i <= 24; i++) { const t = (i / 24) * 0.97; edgePts.push(new THREE.Vector3(cx(t) - wd(t) * 0.5 - 0.002, yb(t), 0)); spinePts.push(new THREE.Vector3(cx(t) + wd(t) * 0.5 + 0.001, yb(t), 0)); }
  at(R.bones.blade, mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edgePts), 48, 0.0042, 6), neonSolid(0xff8a2a, 2.8), new THREE.Group()));
  at(R.bones.blade, mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edgePts), 48, 0.012, 6), neonAdd(0xff5a10, 1.4, 0.35), new THREE.Group()));
  at(R.bones.blade, mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spinePts.slice(0, 16)), 32, 0.0026, 5), neonSolid(0x4aa8ff, 2.4), new THREE.Group()));
  for (let i = 0; i < 4; i++) { const t0 = 0.08 + i * 0.22; w.arcs.push(new Arc(R.bones.blade, new THREE.Vector3(cx(t0) + 0.02, yb(t0) - 0.2, 0.008), new THREE.Vector3(cx(t0 + 0.16) + 0.015, yb(t0 + 0.16) - 0.2, 0.008), 0x6ac8ff, 8, 0.012)); }
  // habaki y guarda de melena de león
  const gold = metal(0xc8902a, 0.3, 1);
  const darkGold = metal(0x8a5a1a, 0.4, 1);
  mesh(new THREE.BoxGeometry(0.06, 0.035, 0.03), gold, R.bones.guard, { y: 0.02 });
  mesh(new THREE.TorusGeometry(0.05, 0.014, 8, 20), gold, R.bones.guard, { rx: Math.PI / 2 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    mesh(new THREE.ConeGeometry(0.016, 0.085, 5), i % 2 ? gold : darkGold, R.bones.guard, { x: Math.cos(a) * 0.06, z: Math.sin(a) * 0.06, y: -0.01, rz: -Math.cos(a) * 1.25, rx: Math.sin(a) * 1.25 });
  }
  mesh(new THREE.SphereGeometry(0.03, 12, 8), gold, R.bones.guard, { y: -0.012, s: [1.2, 0.6, 1.2] });
  // mango negro trenzado con rombos dorados
  const wrap = canvasTex(128, 512, (g, cw, ch) => {
    g.fillStyle = '#121010'; g.fillRect(0, 0, cw, ch);
    g.strokeStyle = '#c8902a'; g.lineWidth = 5;
    for (let y = -ch; y < ch * 2; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(cw, y + 64); g.moveTo(cw, y); g.lineTo(0, y + 64); g.stroke(); }
    g.fillStyle = '#ff7a1a'; for (let y = 32; y < ch; y += 64) { g.beginPath(); g.arc(cw / 2, y, 5, 0, 7); g.fill(); }
  });
  mesh(new THREE.CylinderGeometry(0.021, 0.023, 0.28, 14), new THREE.MeshStandardMaterial({ map: wrap, roughness: 0.75, metalness: 0.2 }), R.bones.grip, { y: 0.0 });
  mesh(new THREE.TorusGeometry(0.023, 0.006, 6, 14), gold, R.bones.grip, { y: 0.13, rx: Math.PI / 2 });
  // pomo: garra dorada con gema naranja
  mesh(new THREE.CylinderGeometry(0.028, 0.022, 0.04, 10), gold, R.bones.grip, { y: -0.155 });
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; mesh(new THREE.ConeGeometry(0.009, 0.05, 4), gold, R.bones.grip, { x: Math.cos(a) * 0.022, z: Math.sin(a) * 0.022, y: -0.19, rx: Math.PI + Math.sin(a) * 0.5, rz: -Math.cos(a) * 0.5 }); }
  mesh(new THREE.SphereGeometry(0.019, 14, 10), neonSolid(0xff8a20, 2.2), R.bones.grip, { y: -0.185 });
  sprite(0xff8a20, 0.09, R.bones.grip, new THREE.Vector3(0, -0.185, 0), 0.7);
  sprite(0xff7a1a, 0.16, R.bones.tip, new THREE.Vector3(cx(1) - 0.005, 0.03, 0), 0.6);
  w.trail = { base: marker(R.bones.blade, cx(0.05), 0.0, 0), tip: marker(R.bones.tip, cx(1), 0.03, 0), color: 0xff7a1a, color2: 0x4aa8ff, width: 1 };
  collect(w);
  w.group.scale.setScalar(L);
  return finish(w);
}

/* ======================================================================
   2 · KYRA — HACHA DE CRISTAL: doble hoja de cristal facetado azul/violeta
   con borde de luces, núcleo hexagonal con copo de nieve, gemas moradas,
   púas de hielo y mango de cristal.
   ====================================================================== */
function crystalTex(c1, c2, c3) {
  return canvasTex(512, 512, (g, cw, ch) => {
    g.fillStyle = c1; g.fillRect(0, 0, cw, ch);
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * cw, y = Math.random() * ch, s = 20 + Math.random() * 60;
      g.fillStyle = [c1, c2, c3, '#ffffff'][Math.floor(Math.random() * 3.2)];
      g.globalAlpha = 0.25 + Math.random() * 0.45;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + s * (Math.random() - 0.3), y + s * Math.random()); g.lineTo(x + s * (Math.random() - 0.8), y + s * (Math.random() - 0.2)); g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.5;
    for (let i = 0; i < 70; i++) { g.beginPath(); g.moveTo(Math.random() * cw, Math.random() * ch); g.lineTo(Math.random() * cw, Math.random() * ch); g.stroke(); }
  });
}
function snowflakeTex(color = '#9ff0ff') {
  return canvasTex(256, 256, (g, cw, ch) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch);
    g.translate(cw / 2, ch / 2);
    g.strokeStyle = color; g.lineWidth = 9; g.lineCap = 'round'; g.shadowColor = color; g.shadowBlur = 14;
    for (let i = 0; i < 6; i++) {
      g.rotate(Math.PI / 3);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -98);
      for (const d of [38, 64]) { g.moveTo(0, -d); g.lineTo(-22, -d - 20); g.moveTo(0, -d); g.lineTo(22, -d - 20); }
      g.stroke();
    }
  });
}
function axe(L) {
  const w = base('hacha', L, 0x5aa8ff, 0xc06aff);
  const R = rig(['grip', 'shaft', 'head', 'bladeL', 'bladeR'], [0, 0.25, 0.43, 0.43, 0.43]);
  // las dos hojas cuelgan de la cabeza (no en cadena)
  R.bones.head.remove(R.bones.bladeL); R.bones.bladeL.remove(R.bones.bladeR);
  R.bones.head.add(R.bones.bladeL, R.bones.bladeR); R.bones.bladeL.position.set(0, 0, 0); R.bones.bladeR.position.set(0, 0, 0);
  R.bones.bladeL.scale.setScalar(0.8); R.bones.bladeR.scale.setScalar(0.8);
  w.group.add(R.root); w.skeleton = R.skeleton; w.bones = R.bones;
  const HY = 0.43; // altura de la cabeza respecto al agarre
  const crys = glowStd({ color: 0xbfd0ff, map: crystalTex('#3a5cff', '#7a5aff', '#5ad0ff'), emissive: 0x4a6aff, emissiveMap: crystalTex('#1a2a9a', '#6a3aff', '#3ab0ff'), emissiveIntensity: 1.3, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.9, flatShading: true }, 1.3);
  // hojas en forma de media luna con puntas
  const blade = (side) => {
    const s = new THREE.Shape();
    const p = (x, y) => [side * x, y];
    s.moveTo(...p(0.05, 0.07));
    s.quadraticCurveTo(...p(0.12, 0.2), ...p(0.07, 0.36));       // punta superior
    s.quadraticCurveTo(...p(0.33, 0.27), ...p(0.4, 0.02));        // filo exterior
    s.quadraticCurveTo(...p(0.36, -0.22), ...p(0.16, -0.34));     // punta inferior
    s.quadraticCurveTo(...p(0.2, -0.16), ...p(0.06, -0.08));      // curva interior
    s.closePath();
    return s;
  };
  const dots = [];
  for (const side of [-1, 1]) {
    const bone = side < 0 ? R.bones.bladeL : R.bones.bladeR;
    const sh = blade(side);
    const geo = extrude(sh, 0.035, 0.012, 2, 20);
    fitTex(crys.map, -0.4, 0.4, -0.35, 0.36); fitTex(crys.emissiveMap, -0.4, 0.4, -0.35, 0.36);
    mesh(geo, crys, bone, { y: 0 });
    // borde luminoso
    const pts = sh.getSpacedPoints(60).map((v) => new THREE.Vector3(v.x, v.y, 0));
    const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: C(0xd8a0ff, 2.4), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, toneMapped: false }));
    outline.material.userData.neon = { base: 2.4, color: new THREE.Color(0xd8a0ff) };
    for (const z of [0.03, -0.03]) { const o = outline.clone(); o.position.z = z; bone.add(o); }
    for (let i = 0; i < pts.length; i += 3) dots.push(pts[i].clone().add(new THREE.Vector3(0, 0, 0)));
    // luces del borde (puntitos brillantes como en el diseño)
    const pg = new THREE.BufferGeometry().setFromPoints(dots.splice(0));
    const pm = new THREE.PointsMaterial({ map: glowTexture(), color: C(0xe8b0ff, 2), size: 0.05, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    pm.userData.neon = { base: 2, color: new THREE.Color(0xe8b0ff) };
    for (const z of [0.032, -0.032]) { const pp = new THREE.Points(pg, pm); pp.position.z = z; bone.add(pp); }
    sprite(0x6aa0ff, 0.38, bone, new THREE.Vector3(side * 0.22, 0.0, 0), 0.32);
  }
  // núcleo hexagonal oscuro con copo de nieve
  const dark = metal(0x2a2c36, 0.45, 0.8);
  mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 6), dark, R.bones.head, { rx: Math.PI / 2, ry: 0 });
  mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.064, 6), metal(0x14161e, 0.3, 0.9), R.bones.head, { rx: Math.PI / 2 });
  const flake = new THREE.MeshBasicMaterial({ map: snowflakeTex(), color: C(0xffffff, 2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  flake.userData.neon = { base: 2, color: new THREE.Color(0xffffff) };
  for (const z of [0.034, -0.034]) mesh(new THREE.CircleGeometry(0.06, 6), flake, R.bones.head, { z, ry: z < 0 ? Math.PI : 0 });
  const gem = neonSolid(0xb05aff, 1.8);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; mesh(new THREE.OctahedronGeometry(0.02), gem, R.bones.head, { x: Math.cos(a) * 0.085, y: Math.sin(a) * 0.085, z: 0.03, s: [1, 1, 0.6] }); }
  const ice = glowStd({ color: 0x9ae8ff, emissive: 0x3ab8ff, emissiveIntensity: 1.2, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.9, flatShading: true });
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; mesh(new THREE.ConeGeometry(0.014, 0.06, 4), ice, R.bones.head, { x: Math.cos(a) * 0.1, y: Math.sin(a) * 0.1, rz: a - Math.PI / 2 }); }
  sprite(0x8ae8ff, 0.22, R.bones.head, new THREE.Vector3(0, 0, 0.04), 0.55);
  // mango de cristal con escamas moradas
  const shaftMat = glowStd({ color: 0x9ab8ff, emissive: 0x5a6aff, emissiveIntensity: 1.1, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.92 });
  mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.86, 10), shaftMat, R.bones.grip, { y: 0.0 });
  mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.8, 6), neonSolid(0xe0f0ff, 1.6), R.bones.grip, { y: 0.0 });
  for (let i = 0; i < 9; i++) { const a = i * 2.3; mesh(new THREE.OctahedronGeometry(0.026), i % 3 ? crys : gem, R.bones.shaft, { y: 0.1 + (i % 3) * 0.03, x: Math.cos(a) * 0.026, z: Math.sin(a) * 0.026, s: [0.7, 1.4, 0.7] }); }
  mesh(new THREE.TorusGeometry(0.029, 0.006, 6, 14), metal(0x60626e, 0.3, 1), R.bones.grip, { y: 0.06, rx: Math.PI / 2 });
  // pomo de púas con copo
  mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 6), dark, R.bones.grip, { y: -0.44 });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; mesh(new THREE.ConeGeometry(0.012, 0.05, 4), i % 2 ? ice : gem, R.bones.grip, { x: Math.cos(a) * 0.04, z: Math.sin(a) * 0.04, y: -0.45, rz: -Math.cos(a) * 1.4, rx: Math.sin(a) * 1.4 }); }
  mesh(new THREE.ConeGeometry(0.022, 0.07, 5), ice, R.bones.grip, { y: -0.5, rx: Math.PI });
  for (const z of [0.026, -0.026]) mesh(new THREE.CircleGeometry(0.028, 6), flake, R.bones.grip, { y: -0.44, z, ry: z < 0 ? Math.PI : 0 });
  w.arcs.push(new Arc(R.bones.bladeR, new THREE.Vector3(0.1, 0.25, 0.025), new THREE.Vector3(0.35, -0.05, 0.025), 0x9ae0ff, 9, 0.02));
  w.arcs.push(new Arc(R.bones.bladeL, new THREE.Vector3(-0.1, 0.25, -0.025), new THREE.Vector3(-0.35, -0.05, -0.025), 0xc08aff, 9, 0.02));
  w.trail = { base: marker(R.bones.head, 0, 0, 0), tip: marker(R.bones.bladeR, 0.4, 0.02, 0), color: 0x6ab0ff, color2: 0xc06aff, width: 1 };
  void HY;
  collect(w);
  w.group.scale.setScalar(L);
  return finish(w);
}

/* ======================================================================
   3 · KAIRO — MARTILLO DE ESMERALDA: cabeza de cristales verdes con montura
   dorada de púas, gran gema central, mango de cuero con bandas doradas y
   gemas, pomo dorado con cristal.
   ====================================================================== */
function hammer(L) {
  const w = base('martillo', L, 0x3aff6a, 0xffc040);
  const R = rig(['grip', 'shaft', 'collar', 'head'], [0, 0.2, 0.42, 0.56]);
  w.group.add(R.root); w.skeleton = R.skeleton; w.bones = R.bones;
  const gold = metal(0xd0962a, 0.3, 1);
  const leather = canvasTex(128, 512, (g, cw, ch) => {
    g.fillStyle = '#4a2a18'; g.fillRect(0, 0, cw, ch);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(20,10,5,${Math.random() * 0.3})`; g.fillRect(Math.random() * cw, Math.random() * ch, 3, 3); }
    g.strokeStyle = '#d0962a'; g.lineWidth = 12;
    for (let y = -ch; y < ch * 2; y += 110) { g.beginPath(); g.moveTo(0, y); g.lineTo(cw, y + 90); g.stroke(); }
    g.strokeStyle = '#7a4a1a'; g.lineWidth = 3;
    for (let y = -ch; y < ch * 2; y += 110) { g.beginPath(); g.moveTo(0, y + 14); g.lineTo(cw, y + 104); g.stroke(); }
  });
  mesh(new THREE.CylinderGeometry(0.027, 0.03, 0.8, 12), new THREE.MeshStandardMaterial({ map: leather, roughness: 0.8, metalness: 0.1 }), R.bones.grip, { y: 0.12 });
  const emer = glowStd({ color: 0x5aff7a, emissive: 0x18c040, emissiveIntensity: 1.5, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.92, flatShading: true }, 1.5);
  const gemN = neonSolid(0x5aff8a, 2.2);
  for (const y of [0.05, 0.25, 0.42]) {
    mesh(new THREE.TorusGeometry(0.032, 0.009, 6, 14), gold, R.bones.grip, { y, rx: Math.PI / 2 });
  }
  for (const y of [0.25, 0.42]) for (const s of [-1, 1]) mesh(new THREE.OctahedronGeometry(0.02), gemN, R.bones.grip, { y, z: s * 0.034, s: [0.8, 1.3, 0.5] });
  // collar dorado
  at(R.bones.collar, mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.07, 8), gold, new THREE.Group(), { y: 0.48 }));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; at(R.bones.collar, mesh(new THREE.ConeGeometry(0.012, 0.04, 4), gold, new THREE.Group(), { x: Math.cos(a) * 0.045, z: Math.sin(a) * 0.045, y: 0.5, rz: -Math.cos(a) * 1.3, rx: Math.sin(a) * 1.3 })); }
  // cabeza: núcleo de escamas verdes oscuras cubierto de cristales
  const H = R.bones.head;
  mesh(new THREE.IcosahedronGeometry(0.13, 1), metal(0x1a4a2a, 0.5, 0.4, { flatShading: true }), H, { s: [1.5, 1, 1] });
  const rand = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  for (let i = 0; i < 46; i++) {
    const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(r * Math.cos(a) * 1.5, u, r * Math.sin(a)).normalize();
    const len = 0.07 + rand() * 0.09;
    const c = mesh(new THREE.ConeGeometry(0.03 + rand() * 0.02, len, 5), emer, H);
    c.position.copy(dir.clone().multiply(new THREE.Vector3(0.19, 0.12, 0.12)).addScaledVector(dir, len * 0.35));
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }
  // montura dorada con gran gema en ambas caras
  for (const s of [-1, 1]) {
    const fr = mesh(new THREE.TorusGeometry(0.075, 0.016, 6, 4), gold, H, { z: s * 0.13, rz: Math.PI / 4 });
    void fr;
    mesh(new THREE.OctahedronGeometry(0.07), gemN, H, { z: s * 0.13, s: [0.75, 1, 0.35] });
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; mesh(new THREE.ConeGeometry(0.018, 0.06, 4), gold, H, { x: Math.cos(a) * 0.1, y: Math.sin(a) * 0.1, z: s * 0.12, rz: a - Math.PI / 2 }); }
    sprite(0x5aff8a, 0.24, H, new THREE.Vector3(0, 0, s * 0.16), 0.6);
  }
  // remates dorados en los extremos (caras de golpe)
  for (const s of [-1, 1]) {
    mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.05, 8), gold, H, { x: s * 0.2, rz: s * Math.PI / 2 });
    mesh(new THREE.OctahedronGeometry(0.05), emer, H, { x: s * 0.25, s: [0.7, 1, 1] });
  }
  sprite(0x3aff6a, 0.55, H, new THREE.Vector3(0, 0, 0), 0.35);
  // pomo
  mesh(new THREE.CylinderGeometry(0.04, 0.032, 0.06, 8), gold, R.bones.grip, { y: -0.29 });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; mesh(new THREE.ConeGeometry(0.012, 0.045, 4), gold, R.bones.grip, { x: Math.cos(a) * 0.04, z: Math.sin(a) * 0.04, y: -0.3, rz: -Math.cos(a) * 1.5, rx: Math.sin(a) * 1.5 }); }
  mesh(new THREE.OctahedronGeometry(0.035), emer, R.bones.grip, { y: -0.35, s: [0.8, 1.6, 0.8] });
  w.arcs.push(new Arc(H, new THREE.Vector3(-0.2, 0.08, 0.1), new THREE.Vector3(0.2, 0.1, 0.1), 0x8aff9a, 10, 0.03));
  w.arcs.push(new Arc(H, new THREE.Vector3(-0.18, -0.08, -0.1), new THREE.Vector3(0.2, -0.06, -0.1), 0xc0ff6a, 10, 0.03));
  w.trail = { base: marker(H, -0.24, 0, 0), tip: marker(H, 0.24, 0, 0), color: 0x3aff6a, color2: 0xffc040, width: 1 };
  collect(w);
  w.group.scale.setScalar(L);
  return finish(w);
}

/* ======================================================================
   4 · ÁMBAR — DOS DISCOS: espiral de cuchillas doradas alrededor de un aro
   oscuro de escamas con anillos rojos de energía y núcleo rojo brillante.
   ====================================================================== */
export function disc(D) {
  const w = base('disco', D, 0xff3a1a, 0xffc020);
  const R = rig(['hub', 'spin'], [0, 0]);
  w.group.add(R.root); w.skeleton = R.skeleton; w.bones = R.bones;
  const S = R.bones.spin;
  const face = canvasTex(512, 512, (g, cw, ch) => {
    g.fillStyle = '#1a0a08'; g.fillRect(0, 0, cw, ch);
    g.translate(cw / 2, ch / 2);
    for (let r = 250; r > 40; r -= 26) { for (let a = 0; a < 40; a++) { g.fillStyle = (a + r) % 2 ? '#2a1410' : '#3a1a12'; g.beginPath(); g.arc(0, 0, r, (a / 40) * 6.283, ((a + 0.8) / 40) * 6.283); g.arc(0, 0, r - 22, ((a + 0.8) / 40) * 6.283, (a / 40) * 6.283, true); g.fill(); } }
  });
  const faceEm = canvasTex(512, 512, (g, cw, ch) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch);
    g.translate(cw / 2, ch / 2);
    g.shadowColor = '#ff2a10'; g.shadowBlur = 16;
    for (const [r, lw] of [[210, 7], [160, 5], [110, 6], [70, 4]]) { g.strokeStyle = '#ff3a1a'; g.lineWidth = lw; g.beginPath(); g.arc(0, 0, r, 0, 6.283); g.stroke(); }
    g.lineWidth = 4;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283; g.beginPath(); g.moveTo(Math.cos(a) * 70, Math.sin(a) * 70); g.lineTo(Math.cos(a) * 210, Math.sin(a) * 210); g.stroke(); }
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, 60); rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.4, '#ff6a3a'); rg.addColorStop(1, 'rgba(255,40,10,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 60, 0, 6.283); g.fill();
  });
  const core = glowStd({ color: 0xffffff, map: face, emissive: 0xffffff, emissiveMap: faceEm, emissiveIntensity: 2.2, roughness: 0.45, metalness: 0.6 }, 2.2);
  const side = metal(0x2a1410, 0.5, 0.7);
  mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 40), [side, core, core], S, { rx: Math.PI / 2 });
  mesh(new THREE.SphereGeometry(0.045, 16, 12), neonSolid(0xff4a2a, 3), S, { s: [1, 1, 0.7] });
  sprite(0xff3a1a, 0.42, S, new THREE.Vector3(0, 0, 0), 0.75);
  // cuchillas doradas en espiral (molinete)
  const goldBlade = glowStd({ color: 0xffc030, emissive: 0xff9a10, emissiveIntensity: 0.55, metalness: 0.9, roughness: 0.22 }, 0.55);
  const bs = new THREE.Shape();
  bs.moveTo(0, -0.03); bs.quadraticCurveTo(0.14, -0.06, 0.27, 0.07); bs.quadraticCurveTo(0.17, 0.0, 0.06, 0.05);
  bs.lineTo(0.09, 0.02); bs.lineTo(0.0, 0.035); bs.closePath();
  const bg = extrude(bs, 0.018, 0.005, 1, 16);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const m = mesh(bg, goldBlade, S, { rz: a });
    m.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, (i % 2 ? 0.006 : -0.006));
    m.rotation.z = a + 0.9;
  }
  // estelas rojas de giro (arcos de energía)
  const arcMat = neonAdd(0xff2a10, 2.2, 0.85);
  for (let i = 0; i < 3; i++) mesh(new THREE.TorusGeometry(0.46 - i * 0.04, 0.006, 4, 40, 1.4), arcMat, S, { rz: i * 2.1 });
  w.spin.push({ bone: S, speed: 3.2 });
  w.trail = { base: marker(S, 0, 0, 0), tip: marker(R.bones.hub, 0.42, 0, 0), color: 0xff3a1a, color2: 0xffc020, width: 0.6 };
  collect(w);
  w.group.scale.setScalar(D);
  return finish(w);
}

/* ======================================================================
   5 · LIRA — GUADAÑA DE RAYO: asta negra con anillos y orbes azules, cabeza
   de placas blindadas con un gran "ojo" de energía y hoja curva que brilla
   azul eléctrico rodeada de relámpagos.
   ====================================================================== */
function scythe(L) {
  const w = base('guadana', L, 0x2a8aff, 0x9adcff);
  const R = rig(['grip', 'shaft', 'neck', 'head', 'blade', 'tip'], [0, 0.2, 0.45, 0.58, 0.6, 0.62]);
  w.group.add(R.root); w.skeleton = R.skeleton; w.bones = R.bones;
  const dark = metal(0x26282e, 0.45, 0.85);
  const plate = metal(0x3a3c44, 0.35, 0.9);
  const blue = neonSolid(0x3a9aff, 2.6);
  const wrap = canvasTex(64, 256, (g, cw, ch) => { g.fillStyle = '#121418'; g.fillRect(0, 0, cw, ch); g.strokeStyle = '#2a2e36'; g.lineWidth = 6; for (let y = 0; y < ch; y += 18) { g.beginPath(); g.moveTo(0, y); g.lineTo(cw, y + 10); g.stroke(); } }, { repeat: [1, 3] });
  mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.86, 10), new THREE.MeshStandardMaterial({ map: wrap, roughness: 0.7, metalness: 0.3 }), R.bones.grip, { y: 0.0 });
  for (const y of [-0.2, 0.18, 0.33]) { mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 10), plate, R.bones.grip, { y }); mesh(new THREE.TorusGeometry(0.031, 0.006, 6, 16), blue, R.bones.grip, { y, rx: Math.PI / 2 }); }
  // pomo con orbe
  mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.07, 8), plate, R.bones.grip, { y: -0.45 });
  mesh(new THREE.SphereGeometry(0.03, 14, 10), blue, R.bones.grip, { y: -0.47, z: 0.03 });
  sprite(0x3a9aff, 0.14, R.bones.grip, new THREE.Vector3(0, -0.47, 0.035), 0.8);
  // cuello: placas blindadas que se curvan hacia el lado de la hoja (−x)
  const neckPts = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; neckPts.push(new THREE.Vector3(-0.09 * t * t, 0.43 + 0.17 * t, 0)); }
  neckPts.forEach((p, i) => { if (i % 1 === 0) at(R.bones.neck, mesh(new THREE.BoxGeometry(0.075, 0.045, 0.06), i % 2 ? plate : dark, new THREE.Group(), { x: p.x, y: p.y, rz: -0.6 * (i / 6) })); });
  for (const [x, y, r] of [[0.0, 0.47, 0.022], [-0.03, 0.54, 0.026]]) { at(R.bones.neck, mesh(new THREE.SphereGeometry(r, 14, 10), blue, new THREE.Group(), { x, y, z: 0.035 })); }
  // gran "ojo": aro y núcleo de energía
  const eye = new THREE.Group(); eye.position.set(-0.11, 0.62, 0); at(R.bones.head, eye);
  mesh(new THREE.TorusGeometry(0.06, 0.018, 8, 24), plate, eye);
  mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.045, 24), dark, eye, { rx: Math.PI / 2 });
  mesh(new THREE.SphereGeometry(0.036, 16, 12), blue, eye, { z: 0.02 });
  mesh(new THREE.SphereGeometry(0.036, 16, 12), blue, eye, { z: -0.02 });
  sprite(0x3a9aff, 0.26, eye, new THREE.Vector3(0, 0, 0.03), 0.85);
  // hoja curva: lomo oscuro, filo azul eléctrico
  const bs = new THREE.Shape();
  bs.moveTo(-0.08, 0.67);
  bs.quadraticCurveTo(0.25, 0.76, 0.5, 0.55);          // lomo (parte de arriba)
  bs.quadraticCurveTo(0.6, 0.42, 0.62, 0.22);           // hacia la punta
  bs.quadraticCurveTo(0.52, 0.42, 0.34, 0.52);          // filo (curva interior)
  bs.quadraticCurveTo(0.12, 0.6, -0.08, 0.57);
  bs.closePath();
  const bx0 = -0.1, bx1 = 0.65, by0 = 0.2, by1 = 0.78;
  const bmap = fitTex(canvasTex(512, 512, (g, cw, ch) => {
    g.fillStyle = '#1c2230'; g.fillRect(0, 0, cw, ch);
    const gr = g.createLinearGradient(0, 0, cw, ch); gr.addColorStop(0, '#2a3a5a'); gr.addColorStop(0.5, '#3a6aff'); gr.addColorStop(1, '#dff4ff');
    g.globalAlpha = 0.6; g.fillStyle = gr; g.fillRect(0, 0, cw, ch); g.globalAlpha = 1;
    g.strokeStyle = '#9adcff'; g.lineWidth = 4; g.beginPath(); g.moveTo(cw * 0.34, ch * 0.3); g.lineTo(cw * 0.42, ch * 0.18); g.lineTo(cw * 0.5, ch * 0.3); g.closePath(); g.stroke();
  }), bx0, bx1, by0, by1);
  const bem = fitTex(canvasTex(512, 512, (g, cw, ch) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch);
    // brillo del filo: la parte inferior de la hoja (y baja en el lienzo = abajo)
    const gr = g.createLinearGradient(0, ch * 0.05, 0, ch * 0.75); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.55, '#1a5aff'); gr.addColorStop(1, '#c8f0ff');
    g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
    g.strokeStyle = '#bff0ff'; g.lineWidth = 3;
    for (let k = 0; k < 18; k++) { let x = Math.random() * cw, y = ch * (0.3 + Math.random() * 0.5); g.beginPath(); g.moveTo(x, y); for (let s = 0; s < 6; s++) { x += 10 + Math.random() * 25; y += (Math.random() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); }
    g.lineWidth = 5; g.beginPath(); g.moveTo(cw * 0.34, ch * 0.7); g.lineTo(cw * 0.42, ch * 0.82); g.lineTo(cw * 0.5, ch * 0.7); g.closePath(); g.stroke();
  }), bx0, bx1, by0, by1);
  // (la textura del lienzo va de arriba abajo; el eje y de la forma va de abajo arriba)
  bmap.flipY = true; bem.flipY = true;
  const bmat = glowStd({ color: 0xffffff, map: bmap, emissive: 0xffffff, emissiveMap: bem, emissiveIntensity: 2, metalness: 0.7, roughness: 0.25 }, 2);
  at(R.bones.blade, mesh(extrude(bs, 0.014, 0.005, 2, 28), bmat, new THREE.Group()));
  // filo neón (borde interior)
  const edge = new THREE.Path(); edge.moveTo(0.62, 0.22); edge.quadraticCurveTo(0.52, 0.42, 0.34, 0.52); edge.quadraticCurveTo(0.12, 0.6, -0.04, 0.58);
  const ep = edge.getSpacedPoints(40).map((v) => new THREE.Vector3(v.x, v.y, 0));
  at(R.bones.blade, mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ep), 60, 0.005, 6), neonSolid(0xbfeeff, 2.8), new THREE.Group()));
  at(R.bones.blade, mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ep), 60, 0.016, 6), neonAdd(0x2a7aff, 1.6, 0.4), new THREE.Group()));
  // placas del lomo
  for (let i = 0; i < 5; i++) { const t = i / 5; at(R.bones.blade, mesh(new THREE.BoxGeometry(0.06, 0.03, 0.03), plate, new THREE.Group(), { x: -0.02 + t * 0.42, y: 0.69 + Math.sin(t * Math.PI) * 0.03 - t * 0.06, rz: -0.25 * t })); }
  // relámpagos alrededor de la hoja
  const pts = [[0.0, 0.7], [0.22, 0.72], [0.42, 0.62], [0.56, 0.42], [0.62, 0.24]];
  for (let i = 0; i < pts.length - 1; i++) w.arcs.push(new Arc(R.bones.blade, new THREE.Vector3(pts[i][0], pts[i][1] - 0.6 + 0.02, 0.012), new THREE.Vector3(pts[i + 1][0], pts[i + 1][1] - 0.6 + 0.02, 0.012), 0x8ad8ff, 9, 0.03));
  w.arcs.forEach((a) => { a.a.y += 0; });
  sprite(0x2a8aff, 0.32, R.bones.tip, new THREE.Vector3(0.6, -0.36, 0), 0.6);
  w.trail = { base: marker(R.bones.blade, 0.2, 0.0, 0), tip: marker(R.bones.blade, 0.62, -0.38, 0), color: 0x3a9aff, color2: 0xbfeeff, width: 1 };
  collect(w);
  w.group.scale.setScalar(L);
  return finish(w);
}

/* ======================================================================
   6 · NILO — BUMERÁN: centro rojo con la "A" azul, círculos y triángulo
   azules, remaches, y puntas de madera clara por placas.
   ====================================================================== */
export function boomerang(Sz) {
  const w = base('bumeran', Sz, 0x2ac8ff, 0xff3a2a);
  const R = rig(['grip', 'spin'], [0, 0]);
  w.group.add(R.root); w.skeleton = R.skeleton; w.bones = R.bones;
  // línea central (el codo en el origen)
  const cl = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.5, -0.22, 0), new THREE.Vector3(-0.2, -0.12, 0), new THREE.Vector3(0.08, 0.0, 0), new THREE.Vector3(0.25, 0.2, 0), new THREE.Vector3(0.3, 0.5, 0)]);
  const N = 40, left = [], right = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, p = cl.getPointAt(t), tg = cl.getTangentAt(t), n = new THREE.Vector2(-tg.y, tg.x);
    const wd = 0.085 * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
    left.push(new THREE.Vector2(p.x + n.x * wd, p.y + n.y * wd));
    right.push(new THREE.Vector2(p.x - n.x * wd, p.y - n.y * wd));
  }
  const sh = new THREE.Shape();
  sh.moveTo(left[0].x, left[0].y);
  left.forEach((v) => sh.lineTo(v.x, v.y));
  // punta redondeada
  const pe = cl.getPointAt(1);
  sh.quadraticCurveTo(pe.x + 0.06, pe.y + 0.07, right[N].x, right[N].y);
  for (let i = N; i >= 0; i--) sh.lineTo(right[i].x, right[i].y);
  const ps = cl.getPointAt(0);
  sh.quadraticCurveTo(ps.x - 0.09, ps.y - 0.02, left[0].x, left[0].y);
  const X0 = -0.62, X1 = 0.45, Y0 = -0.36, Y1 = 0.66;
  const toC = (x, y, cw, ch) => [((x - X0) / (X1 - X0)) * cw, (1 - (y - Y0) / (Y1 - Y0)) * ch];
  const draw = (g, cw, ch, em) => {
    g.fillStyle = em ? '#000' : '#e8c48a'; g.fillRect(0, 0, cw, ch);
    if (!em) { // vetas de madera
      for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(150,100,50,${Math.random() * 0.35})`; g.lineWidth = 1 + Math.random() * 2; g.beginPath(); const y = Math.random() * ch; g.moveTo(0, y); g.bezierCurveTo(cw * 0.3, y + 20, cw * 0.6, y - 20, cw, y + 10); g.stroke(); }
    }
    // tramo rojo central (t 0.22 → 0.72)
    g.beginPath();
    for (let i = 9; i <= 29; i++) g.lineTo(...toC(left[i].x + (left[i].x - right[i].x) * 0.1, left[i].y + (left[i].y - right[i].y) * 0.1, cw, ch));
    for (let i = 29; i >= 9; i--) g.lineTo(...toC(right[i].x - (left[i].x - right[i].x) * 0.1, right[i].y - (left[i].y - right[i].y) * 0.1, cw, ch));
    g.closePath();
    g.fillStyle = em ? '#000' : '#e0281e'; g.fill();
    if (!em) { g.strokeStyle = '#7a1a10'; g.lineWidth = 4; g.stroke(); }
    // separaciones de placas de madera y remaches
    if (!em) {
      g.strokeStyle = '#8a5a2a'; g.lineWidth = 3;
      for (const i of [4, 33, 37]) { g.beginPath(); g.moveTo(...toC(left[i].x, left[i].y, cw, ch)); g.lineTo(...toC(right[i].x, right[i].y, cw, ch)); g.stroke(); }
      g.fillStyle = '#5a6a7a';
      for (const i of [2, 7, 12, 18, 24, 31, 35, 39]) { const c = cl.getPointAt(i / N); for (const s of [-1, 1]) { const q = toC(c.x + (left[i].x - c.x) * 0.6 * s, c.y + (left[i].y - c.y) * 0.6 * s, cw, ch); g.beginPath(); g.arc(q[0], q[1], 7, 0, 7); g.fill(); g.fillStyle = '#c8d0d8'; g.beginPath(); g.arc(q[0] - 2, q[1] - 2, 2.5, 0, 7); g.fill(); g.fillStyle = '#5a6a7a'; } }
    }
    // dibujos azules (brillan en el mapa de emisión)
    const blue = em ? '#38c8ff' : '#28a8f0';
    g.fillStyle = blue; g.strokeStyle = em ? '#000' : '#0a4a8a'; g.lineWidth = 3;
    const A = cl.getPointAt(0.62), a = toC(A.x, A.y, cw, ch);
    g.save(); g.translate(a[0], a[1]); g.rotate(-0.7);
    g.font = 'bold 120px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('A', 0, 4); if (!em) g.strokeText('A', 0, 4);
    g.restore();
    for (const [t, r] of [[0.42, 26], [0.33, 14], [0.36, 12], [0.5, 8]]) { const c = cl.getPointAt(t), q = toC(c.x, c.y, cw, ch); g.beginPath(); g.arc(q[0] + (t === 0.36 ? 30 : 0), q[1] + (t === 0.36 ? -24 : 0), r, 0, 7); g.fill(); }
    const T = cl.getPointAt(0.3), tq = toC(T.x, T.y, cw, ch);
    g.beginPath(); g.moveTo(tq[0] - 22, tq[1] + 28); g.lineTo(tq[0] + 20, tq[1] + 28); g.lineTo(tq[0], tq[1]); g.closePath(); g.fill();
    // franjas azules del borde interior
    for (let i = 20; i <= 28; i += 2) { const c1 = toC(right[i].x * 0.7 + cl.getPointAt(i / N).x * 0.3, right[i].y * 0.7 + cl.getPointAt(i / N).y * 0.3, cw, ch); g.fillRect(c1[0] - 9, c1[1] - 7, 18, 14); }
    // punta superior: botón azul con aro rojo
    const E = cl.getPointAt(0.93), eq = toC(E.x, E.y, cw, ch);
    if (!em) { g.fillStyle = '#e0281e'; g.beginPath(); g.arc(eq[0], eq[1], 26, 0, 7); g.fill(); }
    g.fillStyle = blue; g.beginPath(); g.arc(eq[0], eq[1], 18, 0, 7); g.fill();
  };
  const map = fitTex(canvasTex(1024, 1024, (g, cw, ch) => draw(g, cw, ch, false)), X0, X1, Y0, Y1);
  const em = fitTex(canvasTex(1024, 1024, (g, cw, ch) => draw(g, cw, ch, true)), X0, X1, Y0, Y1);
  map.flipY = true; em.flipY = true;
  const mat = glowStd({ color: 0xffffff, map, emissive: 0xffffff, emissiveMap: em, emissiveIntensity: 1.8, roughness: 0.42, metalness: 0.15 }, 1.8);
  const geo = extrude(sh, 0.04, 0.014, 3, 40);
  const body = mesh(geo, mat, R.bones.spin);
  body.userData.isBoomerang = true;
  // filo de energía de agua alrededor (neón cian, sutil en reposo)
  const outline = sh.getSpacedPoints(120).map((v) => new THREE.Vector3(v.x, v.y, 0));
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(outline, true), 160, 0.006, 5, true), neonAdd(0x3ad8ff, 1.8, 0.75), R.bones.spin);
  sprite(0x3ac8ff, 0.32, R.bones.spin, new THREE.Vector3(cl.getPointAt(0.62).x, cl.getPointAt(0.62).y, 0.03), 0.45);
  w.trail = { base: marker(R.bones.spin, ps.x, ps.y, 0), tip: marker(R.bones.spin, pe.x, pe.y, 0), color: 0x3ad8ff, color2: 0xff3a2a, width: 0.7 };
  collect(w);
  w.group.scale.setScalar(Sz);
  return finish(w);
}

/* ======================================================================
   7 · HALLEY — LANZA MORADA: asta oscura con líneas neón moradas, anillas
   doradas, cuerpo blindado con el triángulo morado, tubo paralelo, y punta
   de cristal violeta facetado que resplandece.
   ====================================================================== */
function spear(L) {
  const w = base('lanza', L, 0xa040ff, 0xffb040);
  const R = rig(['grip', 'shaft', 'collar', 'head', 'tip'], [0, 0.18, 0.4, 0.5, 0.64]);
  w.group.add(R.root); w.skeleton = R.skeleton; w.bones = R.bones;
  const dark = metal(0x2a1a32, 0.4, 0.8);
  const dark2 = metal(0x3a2440, 0.35, 0.85);
  const gold = metal(0xc8862a, 0.3, 1);
  const purple = neonSolid(0xb050ff, 2.6);
  const lines = canvasTex(64, 512, (g, cw, ch) => { g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch); g.fillStyle = '#c060ff'; g.fillRect(cw * 0.42, 0, cw * 0.16, ch); for (let y = 30; y < ch; y += 90) g.fillRect(0, y, cw, 8); }, { repeat: [3, 1] });
  const shaftMat = glowStd({ color: 0x3a2440, roughness: 0.4, metalness: 0.8, emissive: 0xffffff, emissiveMap: lines, emissiveIntensity: 1.6 }, 1.6);
  mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.84, 12), shaftMat, R.bones.grip, { y: 0.06 });
  for (const y of [-0.3, -0.12, 0.2, 0.4]) mesh(new THREE.TorusGeometry(0.028, 0.007, 6, 16), gold, R.bones.grip, { y, rx: Math.PI / 2 });
  // cuerpo blindado con el triángulo
  const body = new THREE.Group(); body.position.y = 0.12; R.bones.grip.add(body);
  mesh(new THREE.BoxGeometry(0.075, 0.2, 0.06), dark, body);
  mesh(new THREE.BoxGeometry(0.085, 0.06, 0.07), dark2, body, { y: 0.11 });
  mesh(new THREE.BoxGeometry(0.06, 0.04, 0.075), dark2, body, { y: -0.1 });
  for (const z of [0.031, -0.031]) {
    mesh(new THREE.TorusGeometry(0.03, 0.006, 4, 3), purple, body, { z, rz: Math.PI / 2 });
    mesh(new THREE.BoxGeometry(0.008, 0.16, 0.002), purple, body, { x: 0.03, z });
    mesh(new THREE.BoxGeometry(0.008, 0.16, 0.002), purple, body, { x: -0.03, z });
  }
  sprite(0xb050ff, 0.18, body, new THREE.Vector3(0, 0, 0.04), 0.55);
  // tubo paralelo con remates dorados
  mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 8), dark2, R.bones.grip, { x: 0.06, y: 0.18 });
  for (const y of [-0.06, 0.43]) mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 8), gold, R.bones.grip, { x: 0.06, y });
  mesh(new THREE.BoxGeometry(0.06, 0.03, 0.03), dark2, R.bones.grip, { x: 0.035, y: 0.33 });
  // collar dorado
  at(R.bones.collar, mesh(new THREE.CylinderGeometry(0.04, 0.032, 0.06, 10), gold, new THREE.Group(), { y: 0.48 }));
  at(R.bones.collar, mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.04, 10), dark2, new THREE.Group(), { y: 0.52 }));
  // punta de cristal violeta
  const crys = glowStd({ color: 0xd0a0ff, emissive: 0x9a30ff, emissiveIntensity: 2, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85, flatShading: true }, 2);
  const tipG = new THREE.Group(); tipG.position.y = 0.54; at(R.bones.head, tipG);
  mesh(new THREE.ConeGeometry(0.075, 0.26, 4), crys, tipG, { y: 0.15, ry: Math.PI / 4, s: [1, 1, 0.55] });
  mesh(new THREE.ConeGeometry(0.075, 0.05, 4), crys, tipG, { y: 0.0, rx: Math.PI, ry: Math.PI / 4, s: [1, 1, 0.55] });
  mesh(new THREE.ConeGeometry(0.03, 0.2, 4), neonSolid(0xe0b0ff, 2.6), tipG, { y: 0.13, ry: Math.PI / 4, s: [1, 1, 0.5] });
  const eg = new THREE.EdgesGeometry(new THREE.ConeGeometry(0.076, 0.262, 4));
  const el = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: C(0xe8c0ff, 2.4), transparent: true, blending: THREE.AdditiveBlending, toneMapped: false }));
  el.material.userData.neon = { base: 2.4, color: new THREE.Color(0xe8c0ff) };
  el.position.y = 0.15; el.rotation.y = Math.PI / 4; el.scale.set(1, 1, 0.55); tipG.add(el);
  for (const s of [-1, 1]) mesh(new THREE.ConeGeometry(0.02, 0.07, 4), crys, tipG, { x: s * 0.05, y: 0.04, rz: -s * 0.7, s: [1, 1, 0.5] });
  sprite(0xb050ff, 0.36, R.bones.tip, new THREE.Vector3(0, 0.05, 0), 0.75);
  // pomo
  mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.05, 10), gold, R.bones.grip, { y: -0.37 });
  mesh(new THREE.SphereGeometry(0.022, 12, 8), purple, R.bones.grip, { y: -0.4 });
  w.arcs.push(new Arc(tipG, new THREE.Vector3(0, 0.02, 0.02), new THREE.Vector3(0, 0.27, 0.0), 0xd890ff, 8, 0.02));
  w.trail = { base: marker(R.bones.collar, 0, 0.1, 0), tip: marker(R.bones.tip, 0, 0.16, 0), color: 0xb050ff, color2: 0xe8c0ff, width: 0.8 };
  collect(w);
  w.group.scale.setScalar(L);
  return finish(w);
}

/* ======================================================================
   Catálogo: arma de cada héroe, tamaño y cómo se sujeta.
   dir / face: hacia dónde apunta el eje +Y del arma y su cara +Z, en el
   espacio del personaje (x = su izquierda, y = arriba, z = delante),
   con el personaje en reposo. hand: 'R' / 'L' (mano que la empuña).
   ====================================================================== */
export const WEAPONS = {
  jago:   { id: 'katana',    name: 'Katana',        build: () => katana(1.05),   hand: 'R', dir: [0, 0.35, 1], face: [-1, 0, 0], color: 0xff7a1a, color2: 0x4aa8ff },
  kyra:   { id: 'axe',       name: 'Hacha',         build: () => axe(0.9),       hand: 'L', dir: [0, 1, 0.35], face: [0, 0, 1], color: 0x6ab0ff, color2: 0xc06aff },
  kairo:  { id: 'hammer',    name: 'Martillo',      build: () => hammer(1.15),   hand: 'R', dir: [0, 1, 0.45], face: [1, 0, 0], color: 0x3aff6a, color2: 0xffc040 },
  ambar:  { id: 'disc',      name: 'Dos discos',    build: () => disc(0.36),     hand: 'R', dual: true, dir: [0, 1, 0], face: [1, 0, 0], color: 0xff3a1a, color2: 0xffc020 },
  lira:   { id: 'scythe',    name: 'Guadaña',       build: () => scythe(1.15),   hand: 'R', dir: [0, 1, 0.12], face: [-1, 0, 0], color: 0x3a9aff, color2: 0xbfeeff },
  nilo:   { id: 'boomerang', name: 'Bumerán',       build: () => boomerang(0.62), hand: 'L', dir: [0, 1, 0.5], face: [1, 0, 0], color: 0x3ad8ff, color2: 0xff3a2a },
  halley: { id: 'spear',     name: 'Lanza morada',  build: () => spear(0.88),    hand: 'R', dir: [0, 1, 0.2], face: [1, 0, 0], color: 0xb050ff, color2: 0xe8c0ff },
};
