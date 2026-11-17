import * as THREE from 'three';
import { CFG, terrainH, setTerrain, smoothstep, lerp, n2, pathDist, pathPoint, refugeHeight, startFlat, setStartSafe, makeDescriptor, placeSigns, paintRefugeAndStart } from './common.js';

export const seed = 7707;

const look = {
  horizon: 0xb8c8d8, zenith: 0x5a6e88, cloudLo: [0.4, 0.44, 0.5], cloudHi: [0.9, 0.94, 1.0], cover: 0.75, fog: 0xb0c0d0, fogD: 0.0062,
  hemi: [0xd4e2f2, 0x5a6a80, 0.78], sun: [0xf0f6ff, 1.8], exposure: 0.92, lightning: false, birds: false,
  precip: { color: [0.95, 0.97, 1.0], alpha: 0.3, speed: 7, len: 0.18, wind: [7, 0, 2.5] }, // nevada visible pero ligera
};

const LAKE = { x: 16, z: -14, r: 26 };
const ROAD = [[0, 68], [-14, 44], [-34, 20], [-38, -12], [-24, -44], [0, -62], [34, -70], [62, -70]];

function alpineTerrain(x, z) {
  let h = 2 + 6 * n2(x, z, 0.02) - 2.6 + 2.4 * n2(x + 40, z, 0.06, 3);
  h += smoothstep(56, 112, Math.hypot(x * 0.8, z + 6)) * (26 + 16 * n2(x, z, 0.03));
  const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
  h = lerp(h, 0.2, smoothstep(LAKE.r + 8, LAKE.r - 2, ld));
  const pd = pathDist(x, z, ROAD);
  h = lerp(h, 1.2 + 0.6 * pd.t * 6, smoothstep(9, 3.5, pd.d) * 0.7);
  h = refugeHeight(h, x, z);
  h = startFlat(h, x, z, 0.5);
  return h;
}

export function build(K, { scene }) {
  setStartSafe({ x: 0, z: 68 }, { x: 62, z: -70, y: 6.4, r: 8 });
  setTerrain(alpineTerrain);
  const rng = K.rng;
  const T = CFG.START, S = CFG.SAFE;
  const rr = (a, b) => a + rng.next() * (b - a);
  const onLake = (x, z, m = 0) => Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + m;
  const free = (x, z) => Math.hypot(x - T.x, z - T.z) > 13 && Math.hypot(x - S.x, z - S.z) > 15;

  // ---- chalets y estación de esquí ----
  const spots = [];
  for (let i = 0; i < 12; i++) {
    const t = 0.1 + (i / 12) * 0.78;
    const p = pathPoint(ROAD, t);
    const side = i % 2 ? 1 : -1;
    const x = p[0] + side * rr(11, 16), z = p[1] + rr(-3, 3);
    if (!free(x, z) || onLake(x, z, 4) || terrainH(x, z) > 12 || spots.some((s) => Math.hypot(s[0] - x, s[1] - z) < 13)) continue;
    spots.push([x, z]);
    const g = terrainH(x, z);
    K.house({ x, z, w: rr(8, 10), d: rr(6, 8), h: 3.4, color: rng.pick([0x8a5a34, 0x9a6a40, 0x7a4a2c]), roofColor: 0xf0f4f8, roof: 'gable', facing: side > 0 ? -Math.PI / 2 : Math.PI / 2, chimney: true, base: g, cand: 'chalets' });
    K.box(x - side * 5.4, g, z, 2.6, 0.5, 5, 0x9a7048, { tag: 'porch' });
    K.cand('balcony', x - side * 5.4, g + 0.52, z, { zone: 'chalets' });
    K.cand('street', x - side * 8, terrainH(x - side * 8, z), z + rr(-2, 2), { zone: 'chalets', type: 'ground' });
  }
  // remonte / estación con torres
  for (let i = 0; i < 4; i++) {
    const x = -60 + i * 7, z = 40 - i * 22, g = terrainH(x, z);
    K.cyl(x, g, z, 0.35, 9, 0x4a4a52, { solid: true, tag: 'pylon' });
    K.box(x, g + 9, z, 2.8, 0.3, 0.3, 0x4a4a52, { solid: false });
    K.box(x, g + 9.3, z, 0.8, 0.4, 0.8, 0xc0392b, { solid: false });
  }
  // lago helado: cabañas de pesca y agujeros
  for (const [ox, oz] of [[-14, -2], [20, -30], [34, -6]]) {
    const x = LAKE.x + ox, z = LAKE.z + oz, g = terrainH(x, z);
    K.box(x, g, z, 3, 2.2, 3, 0x6a5a4a, { tag: 'building' });
    K.prism(x, g + 2.2, z, 3.4, 1.2, 3.4, 0xe8eef4, 0);
    K.cand('street', x + 3.4, g, z + 0.5, { zone: 'lago helado', type: 'ground' });
  }
  for (let i = 0; i < 12; i++) {
    const a = rr(0, 6.28), r = rr(4, LAKE.r - 6);
    const x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r;
    K.cand('street', x, terrainH(x, z), z, { zone: 'lago helado', type: 'ground' });
  }
  // carretera helada
  for (let i = 0; i < 44; i++) {
    const p = pathPoint(ROAD, 0.02 + (i / 44) * 0.95);
    const x = p[0] + rr(-3, 3), z = p[1] + rr(-3, 3);
    K.cand('street', x, terrainH(x, z), z, { zone: 'carretera helada', type: 'ground' });
    if (i % 3 === 0) K.site('road', x + rr(-1.5, 1.5), z + rr(-1.5, 1.5), rr(0, 3.14));
  }
  // puntos de rescate en riscos (piolet / cuerda)
  for (let i = 0; i < 8; i++) {
    const a = rr(0, 6.28), rad = rr(50, 76);
    const x = Math.cos(a) * rad * 1.05, z = -6 + Math.sin(a) * rad;
    if (!free(x, z) || onLake(x, z, 6) || terrainH(x, z) > 20) continue;
    const g = terrainH(x, z);
    K.box(x, g - 0.5, z, 4.2, 3.8, 4.2, 0xdde6ee, { tag: 'rock' });
    K.cand('ledge', x, g + 3.32, z, { zone: 'riscos nevados', needsTool: i % 2 ? 'piolet' : 'rope' });
    K.cand('street', x + 5, terrainH(x + 5, z), z, { zone: 'riscos nevados', type: 'ground' });
  }
  // bosque nevado y rocas
  for (const p of K.scatter(340, { x0: -108, x1: 108, z0: -108, z1: 108 }, { minDist: 3.6, accept: (x, z, h) => free(x, z) && !onLake(x, z, 2) && pathDist(x, z, ROAD).d > 6.5 && h < 22 && spots.every((s) => Math.hypot(s[0] - x, s[1] - z) > 8) })) K.tree('snowpine', p.x, p.z, rr(0.9, 1.4));
  for (const p of K.scatter(50, { x0: -100, x1: 100, z0: -100, z1: 100 }, { minDist: 6, accept: (x, z) => free(x, z) && !onLake(x, z, 1) })) K.rock(p.x, p.z, rr(0.9, 2.4), 0xdfe6ec);
  placeSigns(K, [[4, 62], [-16, 40], [-36, 10], [-30, -30], [-8, -56], [34, -66]]);

  // hogueras (calor): junto a chalets y refugio
  const warm = [[6, 58], [-24, 34]];
  spots.slice(0, 5).forEach((s) => warm.push([s[0] + 5, s[1] + 5]));
  warm.push([LAKE.x - 20, LAKE.z + 4]);

  const paint = () => K.paintGround({
    colorAt: (x, z, h, sl) => {
      const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
      if (ld < LAKE.r * 0.42) { const v = n2(x, z, 0.2); return [78 + 18 * v, 128 + 20 * v, 178 + 18 * v]; } // hielo fino (peligro): azul oscuro
      if (ld < LAKE.r - 1) { const v = n2(x, z, 0.12); return [120 + 26 * v, 172 + 22 * v, 210 + 14 * v]; } // hielo del lago
      if (ld < LAKE.r + 2) return [196, 218, 234];
      const pd = pathDist(x, z, ROAD);
      if (pd.d < 2.6) return [150 + 10 * n2(x, z, 0.3), 168 + 10 * n2(x, z, 0.3), 188];   // nieve pisada del camino
      if (pd.d < 3.6) return [196, 210, 224];                                             // borde del camino
      if (sl > 1.4) return [110 + 14 * n2(x, z, 0.1), 114 + 14 * n2(x, z, 0.1), 126];     // roca desnuda
      const big = n2(x, z, 0.035), fine = n2(x + 50, z, 0.18), sh = 1 - 0.16 * Math.min(1, sl); // sombra en las laderas
      return [(212 + 22 * big + 8 * fine) * sh, (222 + 18 * big + 6 * fine) * sh, (236 + 12 * big) * Math.min(1, sh + 0.06)];
    },
    draw: (g, px, sz) => {
      g.strokeStyle = 'rgba(255,255,255,.55)';
      g.lineWidth = sz(0.3);
      for (let i = 0; i < 26; i++) {
        const a = rr(0, 6.28), r = rr(2, LAKE.r - 3);
        const x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r;
        g.beginPath();
        g.moveTo(px(x), px(z));
        for (let k = 0; k < 4; k++) g.lineTo(px(x + rr(-8, 8)), px(z + rr(-8, 8)));
        g.stroke();
      }
      // grietas del hielo fino: más marcadas (zona peligrosa)
      g.strokeStyle = 'rgba(30,60,100,.6)';
      g.lineWidth = sz(0.22);
      for (let i = 0; i < 22; i++) {
        const a = rr(0, 6.28), r = rr(0, LAKE.r * 0.45);
        const x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r;
        g.beginPath(); g.moveTo(px(x), px(z));
        for (let k = 0; k < 5; k++) g.lineTo(px(x + rr(-5, 5)), px(z + rr(-5, 5)));
        g.stroke();
      }
      // borde del hielo fino: anillo discontinuo de aviso
      g.setLineDash([sz(1.4), sz(1)]); g.strokeStyle = 'rgba(40,80,130,.55)'; g.lineWidth = sz(0.45);
      g.beginPath(); g.arc(px(LAKE.x), px(LAKE.z), sz(LAKE.r * 0.43), 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      // fisuras sueltas en la nieve de las laderas (relieve)
      g.strokeStyle = 'rgba(120,140,170,.45)'; g.lineWidth = sz(0.18);
      for (let i = 0; i < 70; i++) {
        const x = rr(-100, 100), z = rr(-100, 100);
        if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 4 || pathDist(x, z, ROAD).d < 5) continue;
        g.beginPath(); g.moveTo(px(x), px(z));
        for (let k = 0; k < 3; k++) g.lineTo(px(x + rr(-3, 3)), px(z + rr(-3, 3)));
        g.stroke();
      }
      paintRefugeAndStart(g, px, sz, '#dfe8f0');
    },
  });

  // ---- relieve 3D y lectura del tablero: seracs de hielo, ventisqueros, hielo brillante del lago y avisos ----
  const deco = new THREE.Group(); deco.name = 'glaciar';
  scene.add(deco);
  // hielo del lago: una capa lisa con reflejos suaves del sol sobre el suelo pintado
  const sheen = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r - 1.2, 64), new THREE.MeshStandardMaterial({ color: 0xa8d4f0, roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.32, depthWrite: false }));
  sheen.rotation.x = -Math.PI / 2; sheen.position.set(LAKE.x, terrainH(LAKE.x, LAKE.z) + 0.04, LAKE.z); sheen.receiveShadow = true;
  deco.add(sheen);
  // seracs y bloques de hielo azul (contrastan con la nieve blanca); los grandes son sólidos
  const iceGeo = new THREE.IcosahedronGeometry(1, 0);
  const iceMat = new THREE.MeshStandardMaterial({ color: 0x8cc6e8, roughness: 0.18, metalness: 0.08, emissive: 0x1a4a70, emissiveIntensity: 0.18, flatShading: true });
  const iceMat2 = new THREE.MeshStandardMaterial({ color: 0xbfe2f6, roughness: 0.25, metalness: 0.05, flatShading: true });
  const seracs = [];
  for (const p of K.scatter(46, { x0: -100, x1: 100, z0: -100, z1: 100 }, { minDist: 9, accept: (x, z, h) => free(x, z) && pathDist(x, z, ROAD).d > 8 && h < 18 && Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r * 0.55 && spots.every((s) => Math.hypot(s[0] - x, s[1] - z) > 9) })) seracs.push(p);
  // también una corona de bloques alrededor del lago helado
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2 + rr(-0.1, 0.1), r = LAKE.r + rr(2.5, 4.5); const x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r; if (free(x, z) && pathDist(x, z, ROAD).d > 7) seracs.push({ x, z, small: true }); }
  const n = seracs.length * 3;
  const im = new THREE.InstancedMesh(iceGeo, iceMat, n), im2 = new THREE.InstancedMesh(iceGeo, iceMat2, n);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), Sc = new THREE.Vector3();
  let c1 = 0, c2 = 0;
  for (const p of seracs) {
    const g = terrainH(p.x, p.z), big = p.small ? 0.55 : rr(0.8, 1.5);
    for (let j = 0; j < 3; j++) {
      const ox = rr(-1.2, 1.2) * big, oz = rr(-1.2, 1.2) * big, h = (j === 0 ? rr(1.6, 2.6) : rr(0.6, 1.4)) * big, w = rr(0.6, 1.1) * big;
      E.set(rr(-0.25, 0.25), rr(0, 6.28), rr(-0.25, 0.25)); Q.setFromEuler(E);
      V.set(p.x + ox, g + h * 0.55, p.z + oz); Sc.set(w, h, w * rr(0.7, 1.1));
      M.compose(V, Q, Sc);
      if (j === 1) im2.setMatrixAt(c2++, M); else im.setMatrixAt(c1++, M);
      if (j === 0 && !p.small) K.solid(p.x + ox - w * 0.7, p.x + ox + w * 0.7, g - 1, g + h * 1.4, p.z + oz - w * 0.7, p.z + oz + w * 0.7, 'rock');
    }
    // ventisquero: montón de nieve al pie del serac, del lado del viento
    K.ico(p.x - 1.2 * big, g - 0.1, p.z - 0.8 * big, 2.2 * big, 0.45 * big, 1.5 * big, 0xe6eef6);
  }
  im.count = c1; im2.count = c2;
  for (const m of [im, im2]) { m.castShadow = true; m.receiveShadow = true; deco.add(m); }
  // ventisqueros sueltos con dos tonos de nieve (relieve suave que proyecta sombra)
  for (const p of K.scatter(70, { x0: -104, x1: 104, z0: -104, z1: 104 }, { minDist: 7, accept: (x, z, h) => free(x, z) && pathDist(x, z, ROAD).d > 5.5 && h < 20 && Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r + 2 })) {
    const g = terrainH(p.x, p.z), s = rr(1.2, 2.6);
    K.ico(p.x, g - 0.15, p.z, s * rr(1.2, 2), s * rr(0.25, 0.4), s, rng.next() < 0.5 ? 0xeef4fa : 0xd6e2ee, { ry: rr(0, 6.28) });
  }
  // avisos de hielo fino: postes con banderolas alrededor de la zona peligrosa del lago
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, r = LAKE.r * 0.47, x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r, g = terrainH(x, z);
    K.cyl(x, g, z, 0.06, 1.5, 0x4a4a52);
    K.box(x + 0.22, g + 1.2, z, 0.42, 0.26, 0.03, i % 2 ? 0xc0392b : 0xf0f4f8, { solid: false });
  }

  return makeDescriptor(K, scene, {
    id: 'ice', look, paint, refugeStyle: 'lodge', mapView: { cx: 0, cz: -15, half: 105 }, windAmp: 1.6,
    extra: { warmSpots: warm, lake: LAKE },
  });
}
