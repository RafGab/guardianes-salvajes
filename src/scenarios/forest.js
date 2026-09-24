import { CFG, terrainH, setTerrain, smoothstep, lerp, n2, pathDist, pathPoint, refugeHeight, startFlat, setStartSafe, makeDescriptor, placeSigns, paintRefugeAndStart } from './common.js';

export const seed = 2201;

const look = {
  horizon: 0xb2703f, zenith: 0x2a1e1c, cloudLo: [0.14, 0.08, 0.05], cloudHi: [0.66, 0.4, 0.2], cover: 0.18, fog: 0x9a6236, fogD: 0.0085,
  hemi: [0xe8a870, 0x3a2a1c, 1.2], sun: [0xffb070, 2.7], exposure: 1.0, lightning: false, birds: false, precip: null,
};

const ROAD = [[0, 70], [7, 44], [-8, 16], [4, -10], [-6, -38], [1, -66], [0, -92]];

function roadH(t) {
  return 0.3 + 6.2 * Math.pow(t, 1.3);
}

function forestTerrain(x, z) {
  const r = Math.hypot(x, z);
  let h = 1.4 + 6.5 * n2(x, z, 0.02) + 3 * n2(x + 50, z - 30, 0.05, 3) - 3.2;
  h += smoothstep(60, 118, r) * (15 + 12 * n2(x, z, 0.03));
  const pd = pathDist(x, z, ROAD);
  h = lerp(h, roadH(pd.t), smoothstep(13, 4.5, pd.d) * 0.92);
  h = refugeHeight(h, x, z);
  h = startFlat(h, x, z, 0.35);
  return h;
}

export function build(K, { scene }) {
  setStartSafe({ x: 0, z: 62 }, { x: 0, z: -96, y: 10.2, r: 8 });
  setTerrain(forestTerrain);
  const rng = K.rng;
  const S = CFG.SAFE, T = CFG.START;
  const rr = (a, b) => a + rng.next() * (b - a);

  // ---- claros del bosque (zonas de rescate) ----
  const clearings = [];
  for (let i = 0; i < 16; i++) {
    const p = pathPoint(ROAD, 0.08 + (i / 16) * 0.82);
    const side = i % 2 ? 1 : -1;
    const x = p[0] + side * rr(14, 30), z = p[1] + rr(-6, 6);
    if (Math.hypot(x - T.x, z - T.z) < 16 || Math.hypot(x - S.x, z - S.z) < 20) continue;
    if (terrainH(x, z) > 11) continue;
    clearings.push({ x, z });
  }
  const inClearing = (x, z) => clearings.some((c) => Math.hypot(c.x - x, c.z - z) < 6.5);

  // ---- bosque instanciado ----
  const burnCenters = [[-34, 8], [30, -24], [-24, -50]];
  const burnAt = (x, z) => Math.max(...burnCenters.map((b) => Math.exp(-((x - b[0]) ** 2 + (z - b[1]) ** 2) / (2 * 11 * 11))));
  const pts = K.scatter(420, { x0: -108, x1: 108, z0: -108, z1: 108 }, {
    minDist: 3.4,
    accept: (x, z, h) => pathDist(x, z, ROAD).d > 6.5 && Math.hypot(x - T.x, z - T.z) > 12 && Math.hypot(x - S.x, z - S.z) > 13 && !inClearing(x, z) && h < 17,
  });
  for (const p of pts) {
    const b = burnAt(p.x, p.z);
    if (b > 0.55) K.tree(rng.chance(0.75) ? 'dead' : 'pine', p.x, p.z, rr(0.85, 1.2));
    else K.tree(rng.chance(0.68) ? 'pine' : rng.chance(0.7) ? 'broad' : 'shrub', p.x, p.z, rr(0.85, 1.4));
  }
  // arbustos y rocas
  for (const p of K.scatter(90, { x0: -100, x1: 100, z0: -100, z1: 100 }, { minDist: 5, accept: (x, z) => pathDist(x, z, ROAD).d > 4 && Math.hypot(x - T.x, z - T.z) > 10 })) K.tree('shrub', p.x, p.z, rr(0.8, 1.6));
  for (const p of K.scatter(46, { x0: -100, x1: 100, z0: -100, z1: 100 }, { minDist: 6, accept: (x, z) => pathDist(x, z, ROAD).d > 5 && Math.hypot(x - T.x, z - T.z) > 12 })) K.rock(p.x, p.z, rr(0.8, 2.2), 0x7a746a);

  // ---- cabañas con porche ----
  const cabinSpots = [0.22, 0.42, 0.6, 0.78];
  cabinSpots.forEach((t, i) => {
    const p = pathPoint(ROAD, t);
    const side = i % 2 ? -1 : 1;
    const x = p[0] + side * 12.5, z = p[1];
    const g = terrainH(x, z);
    K.house({ x, z, w: 8, d: 6.5, h: 3.1, color: 0x8a5a34, roofColor: 0x5a3a24, roof: 'gable', facing: side > 0 ? -Math.PI / 2 : Math.PI / 2, chimney: true, base: g });
    // porche de madera
    K.box(x - side * 5.2, g, z, 2.6, 0.5, 5, 0x9a7048, { tag: 'porch' });
    K.cand('balcony', x - side * 5.2, g + 0.52, z, { zone: 'cabañas' });
    K.cand('street', x - side * 7.5, terrainH(x - side * 7.5, z), z + rr(-2, 2), { zone: 'cabañas', type: 'ground' });
    // leñera
    K.box(x + side * 1, g, z + 5.2, 3, 1.4, 1, 0x6a4a2e, { tag: 'crate' });
  });

  // ---- refugios de animales (cobertizos con heno) ----
  for (const c of clearings.slice(0, 5)) {
    const g = terrainH(c.x, c.z);
    K.box(c.x, g, c.z - 2.6, 5.6, 2.6, 0.3, 0x7a5a34, { tag: 'shed' });
    K.box(c.x - 2.8, g, c.z, 0.3, 2.6, 5.2, 0x7a5a34, { tag: 'shed' });
    K.box(c.x + 2.8, g, c.z, 0.3, 2.6, 5.2, 0x7a5a34, { tag: 'shed' });
    K.box(c.x, g + 2.6, c.z, 6.2, 0.25, 5.8, 0x4a3a28, { solid: false });
    K.box(c.x - 1, g, c.z - 1.2, 1.4, 0.9, 1.2, 0xd8c060, { tag: 'hay' });
    K.cand('street', c.x + 0.6, g, c.z + 0.8, { zone: 'refugios de animales', type: 'ground' });
  }

  // ---- atalaya de vigilancia y salientes rocosos (necesitan cuerda) ----
  for (const t of [0.35, 0.65]) {
    const p = pathPoint(ROAD, t);
    const x = p[0] + (t < 0.5 ? 22 : -22), z = p[1];
    const g = terrainH(x, z);
    for (const [ox, oz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) K.cyl(x + ox, g - 0.2, z + oz, 0.14, 7.4, 0x6a4a2e);
    K.box(x, g + 7, z, 4.2, 0.3, 4.2, 0x8a6a40, { tag: 'ledge' });
    K.box(x, g + 7.3, z, 4.2, 1.0, 0.2, 0x8a6a40, { solid: false });
    K.box(x, g + 8.3, z, 4.8, 0.2, 4.8, 0x5a3a24, { solid: false });
    K.cand('ledge', x, g + 7.32, z, { zone: 'atalaya', needsTool: 'rope' });
  }
  for (const c of clearings.slice(5, 11)) {
    const g = terrainH(c.x + 5, c.z);
    K.box(c.x + 5, g, c.z, 4, 3.8, 4, 0x7a746a, { tag: 'rock' });
    K.cand('ledge', c.x + 5, g + 3.82, c.z, { zone: 'salientes rocosos', needsTool: 'rope' });
  }

  // ---- candidatos: camino, claros, zonas quemadas ----
  for (let i = 0; i < 40; i++) {
    const p = pathPoint(ROAD, 0.05 + (i / 40) * 0.88);
    const x = p[0] + rr(-3, 3), z = p[1] + rr(-3, 3);
    K.cand('street', x, terrainH(x, z), z, { zone: 'camino forestal', type: 'ground' });
  }
  for (const c of clearings) for (let k = 0; k < 2; k++) {
    const x = c.x + rr(-3, 3), z = c.z + rr(-3, 3);
    K.cand('clearing', x, terrainH(x, z), z, { zone: 'claros', type: 'clearing' });
  }
  for (const b of burnCenters) for (let k = 0; k < 4; k++) {
    const x = b[0] + rr(-8, 8), z = b[1] + rr(-8, 8);
    K.cand('street', x, terrainH(x, z), z, { zone: 'zona quemada', type: 'ground' });
  }
  // troncos y ramas que estorban en el camino
  for (let i = 0; i < 20; i++) {
    const p = pathPoint(ROAD, 0.08 + rng.next() * 0.8);
    K.site('road', p[0] + rr(-2.5, 2.5), p[1], rr(0, 3.14));
  }
  placeSigns(K, [0.06, 0.22, 0.4, 0.58, 0.75, 0.9].map((t) => { const p = pathPoint(ROAD, t); return [p[0] + 4.2, p[1]]; }));

  const paint = () => K.paintGround({
    colorAt: (x, z, h, sl) => {
      const pd = pathDist(x, z, ROAD);
      if (pd.d < 2.8) return [138, 108, 72];
      if (pd.d < 4.2) return [112, 96, 62];
      const burn = burnAt(x, z);
      if (burn > 0.5) return [34, 30, 26];
      if (inClearing(x, z)) return [112, 130, 62];
      if (sl > 1.1 || h > 16) return [112, 106, 98];
      return [58 + 30 * n2(x, z, 0.08), 84 + 26 * n2(x, z, 0.08), 44 + 14 * n2(x, z, 0.1)];
    },
    draw: (g, px, sz) => {
      g.fillStyle = 'rgba(210,180,120,.16)';
      g.lineWidth = sz(0.7);
      g.strokeStyle = 'rgba(200,170,110,.22)';
      g.beginPath();
      for (let i = 0; i <= 70; i++) {
        const q = pathPoint(ROAD, i / 70);
        if (i === 0) g.moveTo(px(q[0]), px(q[1])); else g.lineTo(px(q[0]), px(q[1]));
      }
      g.stroke();
      paintRefugeAndStart(g, px, sz);
    },
  });

  return makeDescriptor(K, scene, {
    id: 'fire', look, paint, refugeStyle: 'camp', mapView: { cx: 0, cz: -15, half: 105 }, windAmp: 1.4,
    extra: {
      fireSeedPool: burnCenters.concat([[-30, -20], [26, 6], [-40, 34], [22, -56], [-14, -70], [34, 30], [-26, 60], [16, 28]]),
      roadPts: ROAD,
    },
  });
}
