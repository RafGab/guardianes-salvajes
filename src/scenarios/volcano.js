import { CFG, terrainH, setTerrain, smoothstep, lerp, n2, pathDist, pathPoint, refugeHeight, startFlat, setStartSafe, makeDescriptor, placeSigns, paintRefugeAndStart } from './common.js';

export const seed = 4404;

const look = {
  horizon: 0x8a4a34, zenith: 0x1c1416, cloudLo: [0.1, 0.06, 0.05], cloudHi: [0.5, 0.3, 0.24], cover: 0.6, fog: 0x5c3a2e, fogD: 0.0095,
  hemi: [0xd8905a, 0x2a1a16, 1.05], sun: [0xff9a5a, 2.1], exposure: 1.0, lightning: false, birds: false,
  precip: { color: [0.32, 0.29, 0.27], alpha: 0.42, speed: 5, len: 0.25, wind: [1.5, 0, 0.6] },
};

const CRATER = { x: -8, z: -84, y: 40 };
const RIVERS = [
  [[-8, -70], [-16, -46], [-24, -20], [-30, 6]],
  [[-6, -70], [6, -46], [18, -22], [30, 0]],
  [[-4, -72], [22, -66], [42, -54], [50, -34]],
];

function volcanoTerrain(x, z) {
  const r = Math.hypot(x - CRATER.x, z - CRATER.z);
  let h = 0.8 + 2.2 * n2(x, z, 0.03);
  h += 40 * Math.exp(-((r / 30) ** 2));           // cono
  h -= 9 * Math.exp(-((r / 6.5) ** 2));           // cráter
  h += smoothstep(94, 140, Math.hypot(x, z + 10)) * (12 + 8 * n2(x, z, 0.03));
  for (const path of RIVERS) {
    const pd = pathDist(x, z, path);
    h -= 1.4 * smoothstep(5, 1.5, pd.d) * smoothstep(-90, -50, z);
  }
  h = refugeHeight(h, x, z);
  h = startFlat(h, x, z, 0.8);
  return h;
}

export function build(K, { scene }) {
  setStartSafe({ x: 0, z: 64 }, { x: 62, z: -50, y: 7.2, r: 8 });
  setTerrain(volcanoTerrain);
  const rng = K.rng;
  const T = CFG.START, S = CFG.SAFE;
  const rr = (a, b) => a + rng.next() * (b - a);
  const nearRiver = (x, z, d = 5) => RIVERS.some((p) => pathDist(x, z, p).d < d);
  const free = (x, z) => Math.hypot(x - T.x, z - T.z) > 13 && Math.hypot(x - S.x, z - S.z) > 14 && Math.hypot(x - CRATER.x, z - CRATER.z) > 24;

  // ---- pueblo al pie del volcán ----
  const stone = [0x8a7a6a, 0x7a6e62, 0x9a8a78, 0x6a5e54];
  const roofs = [0x4a3028, 0x5a3a2a, 0x3a2a24];
  const spots = [];
  for (let i = 0; i < 16; i++) {
    const x = rr(-50, 50), z = rr(-30, 46);
    if (!free(x, z) || nearRiver(x, z, 7) || spots.some((s) => Math.hypot(s[0] - x, s[1] - z) < 14)) continue;
    spots.push([x, z]);
    const w = rr(7, 10), d = rr(6, 8);
    const tall = rng.chance(0.3);
    K.house({ x, z, w, d, h: tall ? 6 : 3.3, color: rng.pick(stone), roofColor: rng.pick(roofs), roof: tall ? 'flat' : 'gable', facing: rng.pick([0, Math.PI]), chimney: rng.chance(0.5), cand: 'casas del pueblo' });
    const g = terrainH(x, z);
    K.box(x, g, z + d / 2 + 1.6, 3, 0.45, 2, 0x7a6a58, { tag: 'porch' });
    K.cand('balcony', x, g + 0.47, z + d / 2 + 1.6, { zone: 'casas del pueblo' });
    K.cand('street', x + rr(-3, 3), terrainH(x, z + d / 2 + 5), z + d / 2 + 5, { zone: 'calles del pueblo', type: 'ground' });
  }
  // plaza, fuente y establo
  const px = 4, pz = 26;
  K.cyl(px, terrainH(px, pz), pz, 3, 0.8, 0x8a8a86, { solid: true, tag: 'fountain' });
  for (let k = 0; k < 6; k++) K.cand('street', px + rr(-9, 9), terrainH(px, pz), pz + rr(-7, 7), { zone: 'plaza del pueblo', type: 'ground' });
  // caminos de tierra hasta el refugio
  const road = [[0, 60], [10, 34], [26, 8], [40, -14], [56, -34], [62, -50]];
  for (let i = 0; i < 34; i++) {
    const p = pathPoint(road, i / 34);
    const x = p[0] + rr(-3, 3), z = p[1] + rr(-3, 3);
    K.cand('street', x, terrainH(x, z), z, { zone: 'camino de evacuación', type: 'ground' });
    if (i % 3 === 0) K.site('road', x + rr(-1.5, 1.5), z + rr(-1.5, 1.5), rr(0, 3.14));
  }
  // islas de roca entre la lava (sólo con escudo)
  for (const path of RIVERS) for (const t of [0.4, 0.7]) {
    const p = pathPoint(path, t);
    const x = p[0] + rr(-1.2, 1.2), z = p[1] + rr(-1.2, 1.2);
    if (!free(x, z)) continue;
    const g = terrainH(x, z);
    K.box(x, g - 0.5, z, 4, 1.4, 4, 0x3a3230, { tag: 'rock' });
    K.cand('ledge', x, g + 0.92, z, { zone: 'islas de roca', needsTool: 'shield' });
  }
  // salientes de roca en la ladera (cuerda)
  for (let i = 0; i < 6; i++) {
    const a = rr(0, Math.PI * 2), rad = rr(20, 30);
    const x = CRATER.x + Math.cos(a) * rad, z = CRATER.z + Math.sin(a) * rad;
    if (!free(x, z) || Math.hypot(x - T.x, z - T.z) < 40) continue;
    const g = terrainH(x, z);
    K.box(x, g - 0.5, z, 4, 3.6, 4, 0x5a4e46, { tag: 'rock' });
    K.cand('ledge', x, g + 3.12, z, { zone: 'laderas del volcán', needsTool: 'rope' });
    K.cand('street', x + 5, terrainH(x + 5, z), z, { zone: 'laderas del volcán', type: 'ground' });
  }
  // ceniza, rocas y árboles muertos
  for (const p of K.scatter(70, { x0: -100, x1: 100, z0: -100, z1: 100 }, { minDist: 7, accept: (x, z, h) => free(x, z) && !nearRiver(x, z, 5) && h < 14 && pathDist(x, z, road).d > 5 })) K.tree(rng.chance(0.6) ? 'dead' : 'shrub', p.x, p.z, rr(0.8, 1.3));
  for (const p of K.scatter(80, { x0: -100, x1: 100, z0: -100, z1: 60 }, { minDist: 6, accept: (x, z) => free(x, z) && !nearRiver(x, z, 4) })) K.rock(p.x, p.z, rr(0.9, 2.8), rng.pick([0x3a3432, 0x4a4240, 0x5a504a]));
  placeSigns(K, [[6, 56], [16, 36], [30, 10], [44, -12], [56, -32], [-14, 20]]);

  const paint = () => K.paintGround({
    colorAt: (x, z, h, sl) => {
      const r = Math.hypot(x - CRATER.x, z - CRATER.z);
      if (r < 8) return [80, 24, 12];
      if (r < 34 && sl > 0.7) return [44, 38, 36];
      if (r < 34) return [60, 52, 48];
      if (nearRiver(x, z, 3.2) && z < 10) return [30, 22, 22];
      const pd = pathDist(x, z, road);
      if (pd.d < 3) return [128, 108, 86];
      if (h > 12) return [58, 52, 48];
      return [82 + 26 * n2(x, z, 0.07), 74 + 22 * n2(x, z, 0.07), 68 + 18 * n2(x, z, 0.09)];
    },
    draw: (g, px2, sz) => {
      g.lineCap = 'round';
      for (const path of RIVERS) {
        g.strokeStyle = 'rgba(255,90,20,.32)';
        g.lineWidth = sz(3.2);
        g.beginPath();
        path.forEach((q, i) => (i ? g.lineTo(px2(q[0]), px2(q[1])) : g.moveTo(px2(q[0]), px2(q[1]))));
        g.stroke();
        g.strokeStyle = 'rgba(20,12,10,.55)';
        g.lineWidth = sz(5.5);
        g.globalCompositeOperation = 'destination-over';
        g.stroke();
        g.globalCompositeOperation = 'source-over';
      }
      paintRefugeAndStart(g, px2, sz);
    },
  });

  return makeDescriptor(K, scene, {
    id: 'volcano', look, paint, refugeStyle: 'bunker', mapView: { cx: 0, cz: -15, half: 105 }, windAmp: 0.8,
    extra: { lavaPaths: RIVERS, crater: CRATER, noSpawn: (x, z) => RIVERS.some((p) => pathDist(x, z, p).d < 4.5) && z < 20 },
  });
}
