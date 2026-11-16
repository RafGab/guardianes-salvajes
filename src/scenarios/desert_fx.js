import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { terrainH } from './common.js';

/* ======================================================================
   DUST STORM (Haboura) · elementos 3D del desierto
   · Cactus de varias formas (saguaros con brazos, cactus barril, chumberas y cactus columna)
   · Matorrales y grupos de vegetación desértica, plantas secas y rodadoras
   · Montañas rocosas (mesas y farallones de estratos) en el horizonte, formaciones erosionadas
     (chimeneas de hada y arcos) y paredes de cañón a lo largo del río seco
   · Oasis en 3D: lámina de agua con reflejos y ondas, juncos, nenúfares, piedras de la orilla y más palmeras
   · Arena que corre con el viento a ras de suelo (partículas ligeras)
   Todo va fusionado en pocas mallas (colores por vértice) para no pesar en el rendimiento, y se coloca lejos
   de la pista, las casas, el inicio y el refugio para no bloquear rutas ni zonas jugables.
   ====================================================================== */
const C = (h) => new THREE.Color(h);

// pieza con color por vértice y transformación aplicada (para fusionar)
function part(geo, color, m) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(m);
  const n = g.attributes.position.count, col = new Float32Array(n * 3), c = C(color);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
const M = (x, y, z, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
// irregularidad en los vértices (roca erosionada)
function jitter(geo, amt, seed = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone(), p = g.attributes.position, key = new Map();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = `${x.toFixed(3)}|${y.toFixed(3)}|${z.toFixed(3)}`;
    if (!key.has(k)) { const h = Math.sin(x * 12.9898 * seed + y * 78.233 + z * 37.719) * 43758.5453; key.set(k, (h - Math.floor(h)) - 0.5); }
    const j = key.get(k);
    p.setXYZ(i, x * (1 + j * amt), y * (1 + j * amt * 0.4), z * (1 + j * amt));
  }
  g.computeVertexNormals();
  return g;
}

export function createDesertFX(scene, K, { OASIS, TRACK, RIVERS, free, pathDist, rng, houses }) {
  const rr = (a, b) => a + rng.next() * (b - a);
  const group = new THREE.Group(); group.name = 'desierto3d';
  scene.add(group);
  const mobile = K.mobile;
  const clearOf = (x, z, m = 0) => free(x, z) && pathDist(x, z, TRACK).d > 6 + m && Math.hypot(x - OASIS.x, z - OASIS.z) > 15 + m && houses.every((p) => Math.hypot(p[0] - x, p[1] - z) > 8 + m);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true });
  const finish = (parts, name, { cast = true } = {}) => {
    if (!parts.length) return null;
    const mesh = new THREE.Mesh(mergeGeometries(parts, false), mat);
    mesh.name = name; mesh.castShadow = cast && !mobile; mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  /* ---------------- cactus ---------------- */
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1); cyl.translate(0, 0.5, 0);
  const cap = new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const sph = new THREE.SphereGeometry(1, 10, 8);
  const ribs = new THREE.CylinderGeometry(1, 1, 1, 12, 1); ribs.translate(0, 0.5, 0);
  const green = [0x4f7a3a, 0x5c8a42, 0x47703a, 0x668f48], flower = [0xe05a7a, 0xf0c040, 0xf08a3a];
  const cactusParts = [];
  const saguaro = (x, z, s) => {
    const g = terrainH(x, z), c = green[Math.floor(rng.next() * green.length)], h = rr(3.2, 5.2) * s, r = 0.32 * s;
    cactusParts.push(part(cyl, c, M(x, g - 0.2, z, r, h, r)), part(cap, c, M(x, g - 0.2 + h, z, r, r * 0.9, r)));
    const arms = 1 + Math.floor(rng.next() * 2.4);
    for (let i = 0; i < arms; i++) {
      const side = i % 2 ? -1 : 1, a = rr(0, 6.28) * 0 + (side > 0 ? 0 : Math.PI) + rr(-0.5, 0.5), y0 = g + h * rr(0.35, 0.6), out = rr(0.6, 0.9) * s, up = rr(0.9, 1.6) * s, ar = r * 0.72;
      const ox = Math.cos(a), oz = Math.sin(a);
      // codo horizontal y brazo hacia arriba
      const arm = new THREE.Matrix4().compose(new THREE.Vector3(x, y0, z), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(ox, 0, oz)), new THREE.Vector3(ar, out, ar));
      cactusParts.push(part(cyl, c, arm));
      cactusParts.push(part(cyl, c, M(x + ox * out, y0 - ar * 0.3, z + oz * out, ar, up, ar)));
      cactusParts.push(part(cap, c, M(x + ox * out, y0 - ar * 0.3 + up, z + oz * out, ar, ar * 0.9, ar)));
    }
    if (rng.next() < 0.4) cactusParts.push(part(sph, flower[Math.floor(rng.next() * 3)], M(x, g - 0.2 + h + r * 0.8, z, r * 0.35)));
    K.solid(x - r, x + r, g - 1, g + h, z - r, z + r, 'tree');
  };
  const barrel = (x, z, s) => {
    const g = terrainH(x, z), c = green[Math.floor(rng.next() * green.length)];
    cactusParts.push(part(ribs, c, M(x, g - 0.1, z, 0.5 * s, 0.7 * s, 0.5 * s)), part(cap, c, M(x, g + 0.6 * s, z, 0.5 * s, 0.35 * s, 0.5 * s)));
    if (rng.next() < 0.6) for (let i = 0; i < 4; i++) { const a = i * 1.57; cactusParts.push(part(sph, flower[i % 3], M(x + Math.cos(a) * 0.18 * s, g + 0.88 * s, z + Math.sin(a) * 0.18 * s, 0.1 * s))); }
  };
  const pear = (x, z, s) => { // chumbera: palas ovaladas unas sobre otras
    const g = terrainH(x, z), c = green[Math.floor(rng.next() * green.length)];
    const pads = [[0, 0.45, 0, 0], [0.32, 0.95, 0.05, 0.5], [-0.3, 0.95, -0.05, -0.45], [0.05, 1.45, 0.1, 0.15], [0.55, 1.4, 0, 0.9]];
    pads.forEach(([px, py, pz, rz], i) => { if (i > 2 && rng.next() < 0.4) return; cactusParts.push(part(sph, c, M(x + px * s, g + py * s, z + pz * s, 0.32 * s, 0.42 * s, 0.09 * s, 0, rr(0, 6.28) * 0.2, rz))); });
    if (rng.next() < 0.6) cactusParts.push(part(sph, 0xc8384a, M(x + 0.1 * s, g + 1.9 * s, z, 0.07 * s)));
  };
  const organ = (x, z, s) => { // cactus columna: varios tallos que salen de la base
    const g = terrainH(x, z), c = green[Math.floor(rng.next() * green.length)];
    for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.28, d = i ? 0.28 * s : 0, h = rr(1.6, 2.8) * s, r = 0.15 * s; cactusParts.push(part(cyl, c, M(x + Math.cos(a) * d, g - 0.1, z + Math.sin(a) * d, r, h, r, Math.sin(a) * 0.12, 0, Math.cos(a) * 0.12)), part(cap, c, M(x + Math.cos(a) * (d + h * 0.12), g - 0.1 + h, z + Math.sin(a) * (d + h * 0.12), r, r, r))); }
  };
  const kinds = [saguaro, barrel, pear, organ];
  // cactus sueltos y en grupos
  for (const p of K.scatter(mobile ? 60 : 110, { x0: -104, x1: 104, z0: -104, z1: 104 }, { minDist: 6, accept: (x, z) => clearOf(x, z) })) {
    const f = rng.next() < 0.35 ? saguaro : kinds[Math.floor(rng.next() * kinds.length)];
    f(p.x, p.z, rr(0.8, 1.25));
    if (rng.next() < 0.35) for (let i = 0; i < 2; i++) { const a = rr(0, 6.28), d = rr(1.4, 2.6); const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d; if (clearOf(x, z, -2)) (rng.next() < 0.5 ? barrel : pear)(x, z, rr(0.6, 0.95)); }
  }
  finish(cactusParts, 'cactus');

  /* ---------------- matorrales, plantas secas y rodadoras ---------------- */
  const bushParts = [];
  const ico = new THREE.IcosahedronGeometry(1, 0), cone = new THREE.ConeGeometry(1, 1, 5); cone.translate(0, 0.5, 0);
  const shrub = [0x7a7a42, 0x8a8a4a, 0x6a6a3a, 0x9a8a52], dry = [0xb09060, 0xa08050, 0xc0a070];
  for (const p of K.scatter(mobile ? 90 : 170, { x0: -106, x1: 106, z0: -106, z1: 106 }, { minDist: 4, accept: (x, z) => clearOf(x, z, -2) })) {
    const g = terrainH(p.x, p.z), n = 2 + Math.floor(rng.next() * 4), tone = rng.next() < 0.6 ? shrub : dry;
    for (let i = 0; i < n; i++) { const s = rr(0.3, 0.75); bushParts.push(part(ico, tone[Math.floor(rng.next() * tone.length)], M(p.x + rr(-0.9, 0.9), g + s * 0.35, p.z + rr(-0.9, 0.9), s, s * 0.7, s, 0, rr(0, 6.28)))); }
    if (rng.next() < 0.3) for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28; bushParts.push(part(cone, 0x8a9a4a, M(p.x + Math.cos(a) * 0.2, g, p.z + Math.sin(a) * 0.2, 0.06, rr(0.5, 0.9), 0.06, Math.sin(a) * 0.4, 0, Math.cos(a) * 0.4))); } // planta de hojas finas
  }
  finish(bushParts, 'matorral', { cast: false });

  /* ---------------- montañas rocosas, formaciones erosionadas y cañón ---------------- */
  const rockParts = [];
  const strata = [0xb0704a, 0xc0845a, 0xa0603e, 0xc89a6a, 0x985a3c];
  const prism = (sides) => { const g = new THREE.CylinderGeometry(1, 1, 1, sides, 1); g.translate(0, 0.5, 0); return g; };
  const rockG = [prism(7), prism(9), prism(6)].map((g, i) => jitter(g, 0.22, i + 1));
  // mesa: estratos apilados que se estrechan (farallón con capas de colores)
  const mesa = (x, z, R, H) => {
    const g = terrainH(x, z) - 1.5, layers = 3 + Math.floor(rng.next() * 3);
    let y = g, r = R;
    for (let i = 0; i < layers; i++) {
      const h = (H / layers) * rr(0.8, 1.2);
      rockParts.push(part(rockG[i % 3], strata[(i + Math.floor(rng.next() * 2)) % strata.length], M(x + rr(-0.06, 0.06) * R, y, z + rr(-0.06, 0.06) * R, r, h, r * rr(0.8, 1.05), 0, rr(0, 6.28))));
      y += h; r *= rr(0.82, 0.96);
    }
    rockParts.push(part(rockG[1], 0x8a5236, M(x, y, z, r * 1.04, 0.5, r * 1.04, 0, rr(0, 6.28))));
  };
  // montañas en el horizonte (fuera de la zona de juego)
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rr(-0.12, 0.12), d = rr(118, 140), x = Math.cos(a) * d, z = Math.sin(a) * d;
    mesa(x, z, rr(10, 20), rr(18, 34));
    if (rng.next() < 0.6) mesa(x + rr(-14, 14), z + rr(-14, 14), rr(5, 9), rr(10, 20));
  }
  // chimeneas de hada (pilares erosionados con sombrero) y arcos dentro del desierto, lejos de las rutas
  const hoodoo = (x, z, s) => {
    const g = terrainH(x, z) - 0.3; let y = g;
    for (let i = 0; i < 3; i++) { const h = rr(1.4, 2.4) * s, r = (0.9 - i * 0.18) * s; rockParts.push(part(rockG[i % 3], strata[i % strata.length], M(x, y, z, r, h, r, 0, rr(0, 6.28)))); y += h * 0.95; }
    rockParts.push(part(rockG[0], 0x7a4a30, M(x, y, z, 1.1 * s, 0.6 * s, 1.0 * s, rr(-0.1, 0.1), rr(0, 6.28))));
    K.solid(x - 0.9 * s, x + 0.9 * s, g - 1, y + 0.6 * s, z - 0.9 * s, z + 0.9 * s, 'rock');
  };
  let hoodoos = 0;
  for (const p of K.scatter(30, { x0: -96, x1: 96, z0: -96, z1: 96 }, { minDist: 16, accept: (x, z) => clearOf(x, z, 4) && Math.hypot(x, z) > 38 })) { if (hoodoos++ > (mobile ? 10 : 18)) break; hoodoo(p.x, p.z, rr(0.8, 1.4)); if (rng.next() < 0.5) hoodoo(p.x + rr(-3, 3), p.z + rr(-3, 3), rr(0.5, 0.8)); }
  // arcos de roca naturales
  for (let i = 0, made = 0; i < 20 && made < 3; i++) {
    const x = rr(-90, 90), z = rr(-90, 70);
    if (!clearOf(x, z, 8) || Math.hypot(x, z) < 45) continue;
    made++;
    const g = terrainH(x, z) - 0.4, ry = rr(0, 6.28), span = rr(5, 8), hgt = rr(5, 7), c = strata[made % strata.length];
    const ox = Math.cos(ry) * span / 2, oz = -Math.sin(ry) * span / 2;
    rockParts.push(part(rockG[0], c, M(x - ox, g, z - oz, 1.4, hgt, 1.2, 0, ry)), part(rockG[2], c, M(x + ox, g, z + oz, 1.4, hgt, 1.2, 0, ry)));
    rockParts.push(part(rockG[1], strata[(made + 1) % strata.length], M(x - ox, g + hgt, z - oz, 1.3, span, 1.1, 0, ry, -Math.PI / 2)));
    for (const s of [-1, 1]) K.solid(x + s * ox - 1.4, x + s * ox + 1.4, g - 1, g + hgt + 1.5, z + s * oz - 1.4, z + s * oz + 1.4, 'rock');
  }
  // paredes del cañón donde el río seco se hunde (borde del mapa)
  for (const R of RIVERS) {
    for (let t = 0; t < R.canyon.length; t++) {
      const [x, z, nx, nz, depth] = R.canyon[t];
      if (depth < 2) continue;
      for (const s of [-1, 1]) {
        const wx = x + nx * s * (5.5 + rr(0, 1.5)), wz = z + nz * s * (5.5 + rr(0, 1.5));
        const g = terrainH(wx, wz) - depth - 1;
        rockParts.push(part(rockG[t % 3], strata[t % strata.length], M(wx, g, wz, rr(2.2, 3.4), depth + rr(1.5, 4), rr(2.2, 3.4), 0, rr(0, 6.28))));
      }
    }
  }
  finish(rockParts, 'rocas');

  /* ---------------- acumulaciones de arena (montoncitos al pie de rocas y casas) ---------------- */
  const moundParts = [], dome = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  for (const p of K.scatter(mobile ? 40 : 80, { x0: -104, x1: 104, z0: -104, z1: 104 }, { minDist: 6, accept: (x, z) => free(x, z) && pathDist(x, z, TRACK).d > 4 && Math.hypot(x - OASIS.x, z - OASIS.z) > 14 })) {
    const g = terrainH(p.x, p.z), s = rr(1.2, 2.6);
    moundParts.push(part(dome, rng.next() < 0.5 ? 0xe0bc80 : 0xcfa66c, M(p.x, g - 0.15, p.z, s * rr(1.4, 2.1), s * rr(0.3, 0.45), s, 0, rr(0, 6.28))));
  }
  const mounds = new THREE.Mesh(mergeGeometries(moundParts, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mounds.receiveShadow = true; mounds.castShadow = !mobile; group.add(mounds);

  /* ---------------- OASIS 3D ---------------- */
  const oy = terrainH(OASIS.x, OASIS.z), WY = 0.55; // nivel del agua: rodea el islote central del oasis
  const wu = { uT: { value: 0 } };
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x2a9ab0, roughness: 0.06, metalness: 0.25, transparent: true, opacity: 0.86 });
  waterMat.onBeforeCompile = (sh) => {
    sh.uniforms.uT = wu.uT;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uT; varying vec3 vWP;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 q = vWP.xz;
        float w1 = sin(q.x * 1.7 + uT * 1.6) + sin(q.y * 2.1 - uT * 1.3) + sin((q.x + q.y) * 2.9 + uT * 2.2) * 0.5;
        normal = normalize(normal + vec3(cos(q.x * 1.7 + uT * 1.6) * 0.05, 0.0, cos(q.y * 2.1 - uT * 1.3) * 0.05));`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float rr = length(vWP.xz - vec2(${OASIS.x.toFixed(1)}, ${OASIS.z.toFixed(1)}));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.75, 0.95, 0.9), smoothstep(7.2, 8.0, rr) * 0.45); // orilla clara
        gl_FragColor.rgb += vec3(0.9, 1.0, 1.0) * pow(max(0.0, sin(rr * 3.0 - uT * 1.5)), 24.0) * 0.12; // ondas`);
  };
  const water = new THREE.Mesh(new THREE.CircleGeometry(8.1, 64), waterMat);
  water.rotation.x = -Math.PI / 2; water.position.set(OASIS.x, WY, OASIS.z); water.receiveShadow = true;
  water.onBeforeRender = () => { wu.uT.value = performance.now() / 1000; };
  group.add(water);
  const oasisParts = [];
  // piedras de la orilla, juncos y nenúfares
  for (let i = 0; i < 26; i++) { const a = (i / 26) * 6.28 + rr(-0.1, 0.1), r = rr(7.9, 8.8), x = OASIS.x + Math.cos(a) * r, z = OASIS.z + Math.sin(a) * r, s = rr(0.3, 0.7); oasisParts.push(part(ico, rng.next() < 0.5 ? 0x9a8a72 : 0x7a6e5e, M(x, terrainH(x, z) + s * 0.2, z, s * 1.3, s * 0.6, s, 0, rr(0, 6.28)))); }
  for (let i = 0; i < 40; i++) {
    const a = rr(0, 6.28), r = rr(7.2, 9.4), x = OASIS.x + Math.cos(a) * r, z = OASIS.z + Math.sin(a) * r, g = Math.max(WY, terrainH(x, z));
    for (let k = 0; k < 4; k++) oasisParts.push(part(cone, k % 2 ? 0x5a8a3a : 0x6a9a44, M(x + rr(-0.3, 0.3), g - 0.05, z + rr(-0.3, 0.3), 0.05, rr(0.9, 1.7), 0.05, rr(-0.15, 0.15), 0, rr(-0.15, 0.15))));
  }
  for (let i = 0; i < 9; i++) { const a = rr(0, 6.28), r = rr(5.4, 7.4), x = OASIS.x + Math.cos(a) * r, z = OASIS.z + Math.sin(a) * r; oasisParts.push(part(new THREE.CylinderGeometry(1, 1, 0.04, 10), 0x3f8a3a, M(x, WY + 0.02, z, rr(0.35, 0.55), 1, rr(0.35, 0.55))), part(sph, 0xf0f0f0, M(x + 0.1, WY + 0.08, z, 0.09))); }
  // hierba verde alrededor del agua
  for (let i = 0; i < 70; i++) { const a = rr(0, 6.28), r = rr(8.6, 12.5), x = OASIS.x + Math.cos(a) * r, z = OASIS.z + Math.sin(a) * r; oasisParts.push(part(cone, rng.next() < 0.5 ? 0x5a9a3a : 0x7aaa4a, M(x, terrainH(x, z) - 0.05, z, 0.12, rr(0.3, 0.6), 0.12, 0, rr(0, 6.28)))); }
  finish(oasisParts, 'oasis', { cast: false });
  // más palmeras (una segunda corona) para que el oasis destaque de lejos
  for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.28 + 0.4, r = rr(12.5, 14.5); K.tree('palm', OASIS.x + Math.cos(a) * r, OASIS.z + Math.sin(a) * r, rr(1.1, 1.5)); }
  // luz suave sobre el oasis (reflejo del agua)
  const ol = new THREE.PointLight(0x9ae8e0, 6, 18, 2); ol.position.set(OASIS.x, oy + 2.5, OASIS.z); group.add(ol);

  /* ---------------- arena que corre con el viento (a ras de suelo) ---------------- */
  const N = mobile ? 900 : 2200, pos = new Float32Array(N * 3), ph = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = rr(-110, 110); pos[i * 3 + 2] = rr(-110, 110); pos[i * 3 + 1] = terrainH(pos[i * 3], pos[i * 3 + 2]) + rr(0.05, 1.4); ph[i] = rng.next(); }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pg.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  const su = { uT: { value: 0 }, uPR: { value: Math.min(window.devicePixelRatio || 1, 2) } };
  const sand = new THREE.Points(pg, new THREE.ShaderMaterial({
    uniforms: su, transparent: true, depthWrite: false,
    vertexShader: `attribute float aPh; uniform float uT; uniform float uPR; varying float vA;
      void main(){ vec3 p = position; float k = fract(aPh * 7.0 + uT * (0.05 + aPh * 0.06));
        p.x += (k - 0.5) * 28.0; p.z += (k - 0.5) * 10.0 + sin(uT + aPh * 40.0) * 0.6; p.y += sin(k * 3.14159) * 0.6;
        vA = sin(k * 3.14159) * (0.35 + 0.4 * aPh);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = (1.5 + aPh * 2.5) * uPR * (40.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(0.86, 0.7, 0.46, smoothstep(0.5, 0.1, d) * vA); }`,
  }));
  sand.frustumCulled = false;
  sand.onBeforeRender = () => { su.uT.value = performance.now() / 1000; };
  group.add(sand);
  return group;
}
