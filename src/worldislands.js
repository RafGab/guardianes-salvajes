import * as THREE from 'three';

/* ======================================================================
   SELECCIÓN DE MUNDOS · islas flotantes (una por mundo) y la plataforma circular central
   Cada mundo es una isla 3D con su propio fenómeno y su COLOR OFICIAL (levels.js → color):
   Camp Fire (bosque y hoguera), Dust Storm (dunas y remolino de arena), Earthquake Impact (isla partida con
   grietas), Rockslide (pico rocoso con rocas que caen), Hurricane Force (palmeras y vórtice), Tsunami Strike
   (ola gigante), Volcano Fury (volcán en erupción), Glacier Collapse (glaciar de picos de hielo) y, en el centro,
   Apocalia (planeta violeta dentro de una burbuja de energía con todos los elementos a la vez).
   ====================================================================== */
const TAU = Math.PI * 2;
const C = (h) => new THREE.Color(h);
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, flatShading: true, ...o });
const glowM = (color, k = 1.6, o = {}) => new THREE.MeshBasicMaterial({ color: C(color).multiplyScalar(k), toneMapped: false, ...o });
const mesh = (geo, mat, parent, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m; };
const lump = (seed, d = 1, amt = 0.25) => {
  const g = new THREE.IcosahedronGeometry(1, d), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const h = Math.sin(v.x * 12.9 + v.y * 78.2 + v.z * 37.7 + seed * 4.1) * 43758.5; v.multiplyScalar(1 + (h - Math.floor(h) - 0.5) * 2 * amt); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
};
const ROCKG = [1, 2, 3].map((s) => lump(s));
const CONE = new THREE.ConeGeometry(1, 1, 7); CONE.translate(0, 0.5, 0);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 10); CYL.translate(0, 0.5, 0);
const BOX = new THREE.BoxGeometry(1, 1, 1); BOX.translate(0, 0.5, 0);
const SPH = new THREE.SphereGeometry(1, 20, 14);

// base de la isla: tierra arriba y roca colgando debajo (como una isla flotante)
function base(g, top, rock, r = 1.6, under = 2.2) {
  mesh(new THREE.CylinderGeometry(r, r * 0.92, 0.42, 12), std(top), g, 0, -0.21, 0);
  const un = new THREE.ConeGeometry(r * 0.95, under, 9); un.rotateX(Math.PI); un.translate(0, -under / 2 - 0.4, 0);
  mesh(un, std(rock), g);
  for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + 0.4; mesh(ROCKG[i % 3], std(rock), g, Math.cos(a) * r * 0.75, -0.5 - (i % 2) * 0.3, Math.sin(a) * r * 0.75, 0.35, 0.3, 0.35); }
  mesh(ROCKG[0], std(rock), g, 0, -under - 0.65, 0, 0.3, 0.45, 0.3);
}
const pine = (g, x, z, s = 1, col = 0x2f7a3a) => { mesh(CYL, std(0x6a4a2a), g, x, 0, z, 0.06 * s, 0.35 * s, 0.06 * s); mesh(CONE, std(col), g, x, 0.25 * s, z, 0.32 * s, 0.7 * s, 0.32 * s); mesh(CONE, std(col), g, x, 0.6 * s, z, 0.24 * s, 0.55 * s, 0.24 * s); };
const house = (g, x, z, ry, wall, roof, s = 1) => { const h = new THREE.Group(); h.position.set(x, 0, z); h.rotation.y = ry; g.add(h); mesh(BOX, std(wall), h, 0, 0, 0, 0.55 * s, 0.38 * s, 0.45 * s); const pr = new THREE.ConeGeometry(0.45 * s, 0.28 * s, 4); pr.rotateY(Math.PI / 4); pr.translate(0, 0.14 * s, 0); mesh(pr, std(roof), h, 0, 0.38 * s, 0); return h; };

// Cada tema construye la isla y devuelve una función de animación (t, dt, h = resaltado 0..1)
const THEMES = {
  campfire(g, col) {
    base(g, 0x4a8a3a, 0x5a3a2a);
    for (const [x, z, s] of [[-1, -0.6, 1.1], [-0.7, 0.7, 0.9], [0.9, -0.9, 1.0], [1.1, 0.5, 0.85], [-0.2, -1.2, 0.8], [0.3, 1.15, 0.75]]) pine(g, x, z, s);
    house(g, 0.55, -0.2, 0.4, 0xd8c8a8, 0x8a3a2a, 0.9);
    const tent = new THREE.ConeGeometry(0.3, 0.35, 4); tent.translate(0, 0.17, 0); mesh(tent, std(0xe8853a), g, -0.35, 0, 0.1);
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; mesh(CYL, std(0x5a3a22), g, 0.05 + Math.cos(a) * 0.12, 0.02, 0.4 + Math.sin(a) * 0.12, 0.03, 0.05, 0.03); }
    const fl = [0, 1, 2].map((i) => mesh(CONE, glowM(i ? 0xffb040 : col, 1.8, { transparent: true, opacity: 0.9 }), g, 0.05, 0.03, 0.4, 0.12 - i * 0.03, 0.4 - i * 0.08, 0.12 - i * 0.03));
    const L = new THREE.PointLight(col, 3, 4, 2); L.position.set(0.05, 0.4, 0.4); g.add(L);
    return (t) => { fl.forEach((f, i) => { f.scale.y = (0.4 - i * 0.08) * (1 + 0.25 * Math.sin(t * 9 + i * 2)); f.rotation.y = t * (2 + i); }); L.intensity = 2.5 + Math.sin(t * 11) * 0.8; };
  },
  sandstorm(g, col) {
    base(g, 0xe2c27a, 0x9a7444);
    for (const [x, z, s, ry] of [[-0.6, -0.4, 1, 0.3], [0.7, 0.6, 0.8, 1.2], [0.2, -1, 0.7, 2]]) { const d = new THREE.SphereGeometry(1, 16, 8, 0, TAU, 0, Math.PI / 2); const m = mesh(d, std(0xdcb468), g, x, -0.02, z, 0.65 * s, 0.32 * s, 0.4 * s); m.rotation.y = ry; }
    house(g, 0.75, -0.45, 0.2, 0xc89a62, 0xb07a48, 0.9); house(g, -0.85, 0.65, -0.5, 0xc89a62, 0xb07a48, 0.75);
    mesh(CYL, std(0x4a8a6a), g, 0.1, 0, 0.45, 0.25, 0.04, 0.25); // oasis
    // remolino de arena
    const swirl = new THREE.Group(); g.add(swirl);
    const sm = glowM(col, 1.2, { transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    for (let i = 0; i < 4; i++) { const tr = new THREE.TorusGeometry(1.25 + i * 0.25, 0.05, 6, 48, TAU * 0.7); const m = mesh(tr, sm, swirl, 0, 0.3 + i * 0.32, 0); m.rotation.x = Math.PI / 2 + 0.15; m.rotation.z = i * 1.3; }
    return (t, dt) => { swirl.rotation.y += dt * 1.6; swirl.children.forEach((m, i) => { m.rotation.z += dt * (0.8 + i * 0.3); }); };
  },
  quake(g, col) {
    // isla partida en dos con una grieta luminosa y trozos que flotan
    const halves = [];
    for (const s of [-1, 1]) {
      const h = new THREE.Group(); h.position.x = s * 0.12; g.add(h); halves.push(h);
      const top = new THREE.CylinderGeometry(1.6, 1.5, 0.42, 12, 1, false, s > 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI); top.translate(0, -0.21, 0);
      mesh(top, std(0x6aa84a), h);
      const un = new THREE.ConeGeometry(1.5, 2, 9, 1, false, s > 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI); un.rotateX(Math.PI); un.translate(0, -1.4, 0);
      mesh(un, std(0x6a5a44), h);
      house(h, s * 0.8, s * 0.3, s * 0.3, 0xe0d0b8, 0xb04a2a, 0.85).rotation.z = s * 0.12;
      pine(h, s * 0.9, -0.8 * s, 0.8, 0x3a8a3a);
    }
    mesh(BOX, glowM(col, 1.8), g, 0, -1.6, 0, 0.12, 1.6, 2.8);
    const frags = [];
    for (let i = 0; i < 7; i++) frags.push(mesh(ROCKG[i % 3], std(0x7a6a54), g, (Math.random() - 0.5) * 0.4, -0.6 - Math.random() * 1.4, (Math.random() - 0.5) * 2.6, 0.12 + Math.random() * 0.12));
    return (t) => { halves.forEach((h, i) => { h.position.x = (i ? 1 : -1) * (0.12 + 0.05 * Math.sin(t * 6)); h.rotation.z = (i ? -1 : 1) * 0.02 * Math.sin(t * 13); }); frags.forEach((f, i) => { f.position.y += Math.sin(t * 2 + i) * 0.002; f.rotation.y += 0.01; }); };
  },
  rockslide(g, col) {
    base(g, 0x7a7b84, 0x4e4f58);
    const peak = new THREE.ConeGeometry(1.2, 2.3, 7); peak.translate(0, 1.15, 0);
    mesh(peak, std(col), g, -0.25, 0, -0.2);
    mesh(new THREE.ConeGeometry(0.7, 1.4, 6).translate(0, 0.7, 0), std(0x5c5d66), g, 0.7, 0, -0.5);
    for (let i = 0; i < 6; i++) mesh(ROCKG[i % 3], std(i % 2 ? 0x8a8b94 : 0x6b6c76), g, 0.4 + Math.random() * 0.8, 0.1, 0.4 + Math.random() * 0.6, 0.12 + Math.random() * 0.12);
    house(g, 0.9, 0.85, -0.4, 0x9a9a9e, 0x3a3c44, 0.8);
    pine(g, -1.05, 0.8, 0.7, 0x3a6a3a);
    const rocks = [0, 1, 2].map((i) => ({ m: mesh(ROCKG[i], std(0x8a8b94), g, 0, 0, 0, 0.16), k: i / 3 }));
    return (t) => { for (const r of rocks) { const k = (t * 0.35 + r.k) % 1; r.m.position.set(-0.25 + k * 1.3, 2.2 * (1 - k) + 0.1, -0.2 + k * 0.9); r.m.rotation.x += 0.15; r.m.visible = k < 0.95; } };
  },
  hurricane(g, col) {
    base(g, 0x6ab868, 0x6a5a44);
    for (const [x, z, s] of [[-0.9, -0.3, 1], [-0.5, 0.9, 0.85], [0.9, 0.7, 0.9]]) { const p = new THREE.Group(); p.position.set(x, 0, z); p.rotation.z = 0.35; g.add(p); mesh(CYL, std(0x8a6a3a), p, 0, 0, 0, 0.05 * s, 0.9 * s, 0.05 * s); for (let k = 0; k < 5; k++) { const lf = mesh(BOX, std(0x3a9a4a), p, 0, 0.9 * s, 0, 0.5 * s, 0.03, 0.12 * s); lf.rotation.y = k / 5 * TAU; lf.rotation.z = -0.4; } }
    house(g, 0.6, -0.6, 0.6, 0xe8e0d0, 0x2a6a9a, 0.85);
    // vórtice (embudo del huracán) de color ámbar
    const v = new THREE.Group(); v.position.set(0.1, 0.2, 0); g.add(v);
    const vm = glowM(col, 1.15, { transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    for (let i = 0; i < 6; i++) { const tr = new THREE.TorusGeometry(0.25 + i * 0.22, 0.04, 6, 40, TAU * 0.8); const m = mesh(tr, vm, v, 0, 0.3 + i * 0.42, 0); m.rotation.x = Math.PI / 2; }
    const deb = [0, 1, 2, 3].map((i) => mesh(BOX, std(0x8a6a4a), v, 0, 0, 0, 0.12, 0.05, 0.08));
    return (t, dt) => { v.rotation.y += dt * 3; v.children.forEach((m, i) => { if (m.geometry.type === 'TorusGeometry') m.rotation.z += dt * (2 + i * 0.4); }); deb.forEach((d, i) => { const a = t * 2.5 + i * 1.6, r = 0.8 + i * 0.25; d.position.set(Math.cos(a) * r, 0.6 + i * 0.5, Math.sin(a) * r); d.rotation.x += dt * 4; }); };
  },
  flood(g, col) {
    base(g, 0x5aa84a, 0x5a5044);
    mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.06, 24), std(col, { transparent: true, opacity: 0.85, roughness: 0.2, metalness: 0.2 }), g, 0, 0.05, 0);
    house(g, -0.6, -0.5, 0.2, 0xe0d8c8, 0x3a5a7a, 0.9); house(g, 0.2, -0.95, -0.3, 0xd8c8b0, 0x6a3a2a, 0.8);
    // gran ola que se curva sobre la isla
    const wave = new THREE.Group(); wave.position.set(0.35, 0.05, 0.4); g.add(wave);
    const wg = new THREE.TorusGeometry(0.85, 0.32, 10, 30, Math.PI * 1.25); wg.rotateY(Math.PI / 2);
    mesh(wg, std(col, { roughness: 0.25, metalness: 0.15, emissive: C(col).multiplyScalar(0.25) }), wave, 0, 0.85, 0);
    const foam = new THREE.TorusGeometry(0.85, 0.12, 6, 30, Math.PI * 0.35); foam.rotateY(Math.PI / 2); foam.rotateX(Math.PI * 0.9);
    mesh(foam, std(0xe8fbff), wave, 0, 0.85, 0);
    return (t) => { wave.position.y = 0.05 + Math.sin(t * 1.5) * 0.08; wave.rotation.x = Math.sin(t * 1.5) * 0.08; };
  },
  fire(g, col) {
    base(g, 0x3a2e2a, 0x241c1a);
    const v = new THREE.ConeGeometry(1.25, 1.8, 10, 1, true); v.translate(0, 0.9, 0);
    mesh(new THREE.CylinderGeometry(0.35, 1.25, 1.8, 10).translate(0, 0.9, 0), std(0x2e2624), g);
    mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 12), glowM(col, 2), g, 0, 1.8, 0);
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + 0.5; const s = mesh(BOX, glowM(col, 1.8), g, Math.cos(a) * 0.62, 0.9, Math.sin(a) * 0.62, 0.08, 1.7, 0.06); s.lookAt(0, 3.5, 0); }
    const smoke = [0, 1, 2, 3].map((i) => mesh(SPH, std(0x3a3434, { transparent: true, opacity: 0.75 }), g, 0, 2, 0, 0.25));
    const bombs = [0, 1, 2, 3, 4].map(() => mesh(SPH, glowM(0xffb040, 1.6), g, 0, 2, 0, 0.06));
    const L = new THREE.PointLight(col, 4, 5, 2); L.position.set(0, 2.2, 0); g.add(L);
    return (t) => {
      smoke.forEach((s, i) => { const k = (t * 0.25 + i / 4) % 1; s.position.set(Math.sin(i * 2) * 0.2 + k * 0.4, 1.9 + k * 1.8, 0); s.scale.setScalar(0.2 + k * 0.45); s.material.opacity = 0.75 * (1 - k); });
      bombs.forEach((b, i) => { const k = (t * 0.7 + i / 5) % 1, a = i * 1.3; b.position.set(Math.cos(a) * k * 0.9, 1.85 + Math.sin(k * Math.PI) * 1.1, Math.sin(a) * k * 0.9); });
      L.intensity = 3.5 + Math.sin(t * 7) * 0.8;
    };
  },
  ice(g, col) {
    base(g, 0xf0f8ff, 0x9ab8cc);
    for (const [x, z, h] of [[-0.4, -0.3, 1.8], [0.4, -0.6, 1.3], [0.7, 0.4, 1.0], [-0.8, 0.5, 1.1], [0.0, 0.7, 0.8]]) { const sp = new THREE.ConeGeometry(0.28, h, 5); sp.translate(0, h / 2, 0); mesh(sp, std(col, { roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92, emissive: C(0x9ad8ff).multiplyScalar(0.3) }), g, x, 0, z); }
    for (const [x, z] of [[1.0, -0.2], [-1.1, -0.5]]) pine(g, x, z, 0.7, 0xdfefff);
    const chunks = [0, 1, 2].map((i) => mesh(BOX, std(0xd8f0ff, { roughness: 0.2 }), g, 0, 0, 0, 0.18));
    return (t) => { chunks.forEach((c, i) => { const k = (t * 0.3 + i / 3) % 1; c.position.set(-1.3 + i * 0.4, -0.2 - k * 2.2, 0.9 - i * 0.6); c.rotation.x = k * 3; c.visible = k < 0.9; }); };
  },
  extreme(g, col) {
    // planeta central violeta con un poco de cada catástrofe, dentro de una burbuja de energía
    base(g, 0x5a4a8a, 0x2a2240, 2.0, 2.8);
    const v = new THREE.ConeGeometry(0.7, 1.1, 8); v.translate(0, 0.55, 0); mesh(v, std(0x3a2e3a), g, -0.7, 0, -0.5);
    mesh(SPH, glowM(0xff6a2a, 1.6), g, -0.7, 1.1, -0.5, 0.15);
    mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.05, 20), std(0x2a8aa8, { roughness: 0.2 }), g, 0.75, 0.04, 0.55);
    house(g, 0.6, -0.7, 0.5, 0xd8d0e8, 0x6a3a9a, 0.9); house(g, -0.2, 0.8, -0.3, 0xd0c8e0, 0x6a3a9a, 0.75);
    for (const [x, z] of [[1.3, -0.2], [-1.3, 0.6]]) pine(g, x, z, 0.8, 0x3a8a5a);
    const bub = mesh(new THREE.SphereGeometry(2.7, 48, 32), new THREE.ShaderMaterial({
      uniforms: { uCol: { value: C(col) }, uT: { value: 0 }, uH: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: `uniform vec3 uCol; uniform float uT; uniform float uH; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float rim = pow(f, 2.2);
          float bands = smoothstep(0.92, 1.0, sin(vP.y * 5.0 - uT * 2.0 + sin(vP.x * 2.0 + uT) * 1.5) * 0.5 + 0.5);
          vec3 c = mix(uCol, vec3(1.0), rim * 0.35 + bands * 0.3) * 1.5;
          gl_FragColor = vec4(c, clamp(0.05 + rim * (0.6 + uH * 0.3) + bands * 0.18, 0.0, 0.9)); }`,
    }), g, 0, 0.5, 0);
    bub.renderOrder = 5;
    const ring = new THREE.Group(); g.add(ring);
    for (let i = 0; i < 3; i++) { const r = mesh(new THREE.TorusGeometry(3.1 + i * 0.25, 0.025, 6, 96), glowM(col, 2, { transparent: true, opacity: 0.6 }), ring, 0, 0.5, 0); r.rotation.x = Math.PI / 2 + (i - 1) * 0.35; r.rotation.y = i * 0.8; }
    const bolt = mesh(BOX, glowM(0xe8d0ff, 2.2, { transparent: true, opacity: 0 }), g, 0.4, 1.6, 0.2, 0.04, 1.6, 0.04);
    return (t, dt, h) => { bub.material.uniforms.uT.value = t; bub.material.uniforms.uH.value = h; ring.rotation.y += dt * 0.4; ring.children.forEach((r, i) => { r.rotation.z += dt * (0.3 + i * 0.2); }); const f = Math.sin(t * 1.7) > 0.93 ? 1 : 0; bolt.material.opacity = f * 0.9; bolt.rotation.z = Math.sin(t * 30) * 0.3; };
  },
};

// Isla de un mundo: grupo, función de animación y piezas para el resaltado
export function buildIsland(L) {
  const col = new THREE.Color(L.color || '#8ab8ff');
  const hex = col.getHex();
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const anim = (THEMES[L.id] || THEMES.campfire)(body, hex);
  // anillo de luz bajo la isla y halo del color del mundo
  const center = L.id === 'extreme';
  const R = center ? 3.4 : 2.2;
  const ringM = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.6), transparent: true, opacity: 0.55, toneMapped: false, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.12, R, 64), ringM); ring.rotation.x = -Math.PI / 2; ring.position.y = -0.2; g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(R + 0.2, R + 0.26, 64, 1, 0, TAU * 0.82), ringM.clone()); ring2.rotation.x = -Math.PI / 2; ring2.position.y = -0.2; g.add(ring2);
  // columna de luz del color del mundo al seleccionarlo
  const beamM = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.4), transparent: true, opacity: 0, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.85, R * 0.95, 14, 32, 1, true), beamM); beam.position.y = 5; g.add(beam);
  const light = new THREE.PointLight(col, 0, 9, 1.6); light.position.set(0, 2.5, 1.5); g.add(light);
  // zona de clic (invisible) para elegir el mundo
  const hit = new THREE.Mesh(new THREE.SphereGeometry(center ? 3 : 2.1, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.4;
  g.add(hit);
  return { g, body, anim, ring, ring2, ringM, beam, beamM, light, hit, col, center };
}

/* ---------------- plataforma circular de energía (como un reloj de engranajes) ---------------- */
export function buildPlatform() {
  const u = { uT: { value: 0 }, uCol: { value: new THREE.Color(0x4a8aff) }, uSelA: { value: -10 }, uSel: { value: 0 } };
  const m = new THREE.Mesh(new THREE.CircleGeometry(15, 128), new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uT; uniform vec3 uCol; uniform float uSelA; uniform float uSel; varying vec2 vP;
      float ring(float r, float c, float w){ return smoothstep(w, 0.0, abs(r - c)); }
      void main(){
        float r = length(vP), a = atan(vP.y, vP.x);
        float v = 0.0;
        v += ring(r, 3.6, 0.08) * 0.9 + ring(r, 4.0, 0.03) * 0.6;
        v += ring(r, 9.0, 0.05) * 0.5 + ring(r, 11.6, 0.12) * 0.9 + ring(r, 12.2, 0.03) * 0.7 + ring(r, 14.6, 0.05) * 0.5;
        // marcas de reloj y dientes de engranaje
        float ticks = smoothstep(0.9, 1.0, abs(sin(a * 30.0))) * step(11.7, r) * step(r, 12.15);
        float big = smoothstep(0.985, 1.0, abs(sin(a * 4.0 + 0.785))) * step(11.4, r) * step(r, 12.8) * 0.5;
        float gear = smoothstep(0.3, 0.6, sin(a * 18.0 + uT * 0.3)) * step(4.0, r) * step(r, 4.6);
        float gear2 = smoothstep(0.4, 0.7, sin(a * 40.0 - uT * 0.15)) * step(14.6, r) * step(r, 14.9);
        v += ticks * 0.8 + big * 0.9 + gear * 0.35 + gear2 * 0.4;
        // círculos de engranajes decorativos
        for (int i = 0; i < 6; i++) { float ga = float(i) * 1.047 + uT * 0.05; vec2 c = vec2(cos(ga), sin(ga)) * 7.2; float d = length(vP - c); v += ring(d, 1.6, 0.04) * 0.35 + smoothstep(0.3, 0.6, sin(atan(vP.y - c.y, vP.x - c.x) * 12.0 + uT * 0.4)) * step(1.6, d) * step(d, 1.85) * 0.25; }
        // haz hacia el mundo elegido
        float da = abs(mod(a - uSelA + 3.14159, 6.28318) - 3.14159);
        float beam = uSel * smoothstep(0.35, 0.0, da) * step(4.0, r) * step(r, 11.6) * (0.35 + 0.25 * sin(r * 2.0 - uT * 5.0));
        float glow = smoothstep(15.0, 0.0, r) * 0.18 + smoothstep(4.0, 0.0, r) * 0.25;
        vec3 c = uCol * (v + glow) + mix(uCol, vec3(1.0), 0.3) * beam;
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  m.rotation.x = -Math.PI / 2;
  return { mesh: m, u };
}
