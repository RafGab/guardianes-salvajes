import { CFG, terrainH, setTerrain, smoothstep, lerp, n2, pathDist, pathPoint, refugeHeight, startFlat, setStartSafe, makeDescriptor, placeSigns, paintRefugeAndStart } from './common.js';

export const seed = 7707;

const look = {
  horizon: 0xb8c8d8, zenith: 0x5a6e88, cloudLo: [0.4, 0.44, 0.5], cloudHi: [0.9, 0.94, 1.0], cover: 0.75, fog: 0xb0c0d0, fogD: 0.0088,
  hemi: [0xdce8f4, 0x7a8898, 0.95], sun: [0xf4f8ff, 1.5], exposure: 0.92, lightning: false, birds: false,
  precip: { color: [0.95, 0.97, 1.0], alpha: 0.5, speed: 7, len: 0.22, wind: [7, 0, 2.5] },
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
      if (ld < LAKE.r - 1) return [156, 200, 226];
      if (ld < LAKE.r + 2) return [200, 220, 234];
      const pd = pathDist(x, z, ROAD);
      if (pd.d < 3) return [176, 196, 214];
      if (sl > 1.4) return [134, 138, 146];
      return [230 + 10 * n2(x, z, 0.06), 236 + 8 * n2(x, z, 0.06), 244];
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
      paintRefugeAndStart(g, px, sz, '#dfe8f0');
    },
  });

  return makeDescriptor(K, scene, {
    id: 'ice', look, paint, refugeStyle: 'lodge', mapView: { cx: 0, cz: -15, half: 105 }, windAmp: 1.6,
    extra: { warmSpots: warm, lake: LAKE },
  });
}
