import { CFG, terrainH, setTerrain, smoothstep, lerp, n2, pathDist, pathPoint, refugeHeight, startFlat, setStartSafe, makeDescriptor, placeSigns, paintRefugeAndStart } from './common.js';

export const seed = 5505;

const look = {
  horizon: 0x6a8296, zenith: 0x1a2430, cloudLo: [0.08, 0.1, 0.13], cloudHi: [0.5, 0.56, 0.62], cover: 0.7, fog: 0x6a8296, fogD: 0.0085,
  hemi: [0xa8bcd0, 0x3a4048, 1.15], sun: [0xe8eef6, 1.9], exposure: 0.95, lightning: true,
  precip: { color: [0.75, 0.82, 0.9], alpha: 0.42, speed: 38, len: 1.1, wind: [10, 0, 4] },
};

const SHORE = (z) => 66 + 5 * Math.sin(z * 0.06);
const AVENUE = [[-56, 66], [-50, 30], [-40, -6], [-34, -40], [-60, -50]];

function coastTerrain(x, z) {
  let h = 0.5 + 1.0 * n2(x, z, 0.03);
  h += smoothstep(-20, -108, x) * 6;                                 // colinas al oeste
  h += smoothstep(-40, -110, z) * 5;
  const beach = smoothstep(SHORE(z) - 26, SHORE(z) + 4, x);
  h = lerp(h, -0.2, beach * 0.55);
  h = lerp(h, -3.2, smoothstep(SHORE(z) + 2, SHORE(z) + 22, x));       // fondo marino
  h = refugeHeight(h, x, z);
  h = startFlat(h, x, z, 0.5);
  return h;
}

export function build(K, { scene }) {
  setStartSafe({ x: 6, z: 62 }, { x: -72, z: -62, y: 9, r: 8 });
  setTerrain(coastTerrain);
  const rng = K.rng;
  const T = CFG.START, S = CFG.SAFE;
  const rr = (a, b) => a + rng.next() * (b - a);
  const free = (x, z) => Math.hypot(x - T.x, z - T.z) > 13 && Math.hypot(x - S.x, z - S.z) > 15;
  const pastel = [0xe8c8a8, 0xd8e0e8, 0xf0d890, 0xc8a8a8, 0xa8c8b8, 0xe8b8a0];
  const roofs = [0xb04a34, 0x3a7a8a, 0x8a4a34, 0x5a6a7a];

  // ---- barrio costero: cuadrícula suave ----
  const cells = [];
  for (let gx = -30; gx <= 46; gx += 19) for (let gz = -56; gz <= 44; gz += 19) {
    const x = gx + rr(-3, 3), z = gz + rr(-3, 3);
    if (!free(x, z) || x > SHORE(z) - 14) continue;
    const w = rr(8, 11), d = rr(7, 9), tall = rng.chance(0.28);
    K.house({ x, z, w, d, h: tall ? 7 : 3.6, color: rng.pick(pastel), roofColor: rng.pick(roofs), roof: tall ? 'flat' : 'gable', facing: rng.pick([0, Math.PI]), cand: 'casas costeras', base: Math.max(terrainH(x, z), 0.5) });
    cells.push({ x, z });
    const g = terrainH(x, z + d / 2 + 2.4);
    K.box(x, g, z + d / 2 + 1.6, 3.2, 0.5, 2.2, 0x9a7a58, { tag: 'porch' });
    K.cand('balcony', x, g + 0.52, z + d / 2 + 1.6, { zone: 'porches' });
    K.cand('street', x + rr(-3, 3), terrainH(x, z + d / 2 + 5.5), z + d / 2 + 5.5, { zone: 'calles del barrio', type: 'ground' });
    if (rng.chance(0.5)) K.site('road', x + rr(-4, 4), z + d / 2 + 5.5, 0);
  }
  // ---- casas sobre pilotes en la playa ----
  for (let i = 0; i < 6; i++) {
    const z = -40 + i * 15, x = SHORE(z) - 6;
    if (!free(x, z)) continue;
    const g = Math.max(terrainH(x, z), -0.2);
    for (const [ox, oz] of [[-2.6, -2], [2.6, -2], [-2.6, 2], [2.6, 2]]) K.cyl(x + ox, g - 1.2, z + oz, 0.2, 2.4, 0x6a4a2e);
    K.box(x, g + 1.2, z, 7, 0.3, 6, 0x9a7a58, { tag: 'deck' });
    K.box(x, g + 1.5, z, 5.2, 2.6, 4.6, rng.pick(pastel), { tag: 'building' });
    K.prism(x, g + 4.1, z, 6, 1.7, 5.4, rng.pick(roofs), Math.PI / 2);
    K.cand('balcony', x + 3.3, g + 1.52, z + 2.2, { zone: 'casas sobre pilotes' });
    K.cand('street', x - 4.5, terrainH(x - 4.5, z), z, { zone: 'playa', type: 'ground' });
  }
  // ---- muelle ----
  const pz = -10;
  K.box(SHORE(pz) + 22, 0.2, pz, 46, 0.4, 5, 0x8a6a48, { tag: 'dock' });
  for (let x = SHORE(pz) + 2; x < SHORE(pz) + 44; x += 5) {
    K.cyl(x, -3.2, pz - 2.2, 0.25, 3.8, 0x5a4a38);
    K.cyl(x, -3.2, pz + 2.2, 0.25, 3.8, 0x5a4a38);
    K.cand('street', x, 0.62, pz + rr(-1.2, 1.2), { zone: 'muelle', type: 'ground' });
  }
  // ---- faro (refugio alto) y palmeras ----
  for (const p of K.scatter(80, { x0: -100, x1: 100, z0: -100, z1: 96 }, { minDist: 6, accept: (x, z, h) => free(x, z) && h > 0 && x < SHORE(z) - 4 && cells.every((c) => Math.hypot(c.x - x, c.z - z) > 8) && pathDist(x, z, AVENUE).d > 4 })) {
    K.tree('palm', p.x, p.z, rr(0.9, 1.4));
    if (rng.chance(0.18)) K.site('road', p.x + 3.5, p.z, rr(0, 3.14));
  }
  for (const p of K.scatter(30, { x0: -100, x1: 100, z0: -100, z1: 100 }, { minDist: 6, accept: (x, z, h) => free(x, z) && h > 0.2 })) K.tree('shrub', p.x, p.z, rr(0.8, 1.4));
  for (const p of K.scatter(18, { x0: -100, x1: 100, z0: -100, z1: 96 }, { minDist: 8, accept: (x, z, h) => free(x, z) && x > SHORE(z) - 22 })) K.rock(p.x, p.z, rr(0.8, 1.8), 0x8a8478);
  // avenida principal
  for (let i = 0; i < 40; i++) {
    const p = pathPoint(AVENUE, 0.02 + (i / 40) * 0.94);
    const x = p[0] + rr(-3, 3), z = p[1] + rr(-3, 3);
    K.cand('street', x, terrainH(x, z), z, { zone: 'avenida principal', type: 'ground' });
    if (i % 4 === 0) K.site('road', x + rr(-1.5, 1.5), z, rr(0, 3.14));
  }
  // salientes en el faro-colina
  for (let i = 0; i < 4; i++) {
    const x = -66 + i * 6 + rr(-2, 2), z = -30 - i * 6;
    const g = terrainH(x, z);
    K.box(x, g - 0.5, z, 4, 3.6, 4, 0x7a746a, { tag: 'rock' });
    K.cand('ledge', x, g + 3.12, z, { zone: 'acantilado', needsTool: 'rope' });
  }
  placeSigns(K, [[10, 58], [-8, 34], [-30, 8], [-40, -20], [-52, -44], [26, 24]]);

  const paint = () => K.paintGround({
    colorAt: (x, z, h, sl) => {
      if (h < -0.1) return [206, 190, 150];
      if (x > SHORE(z) - 8) return [220, 204, 164];
      const pd = pathDist(x, z, AVENUE);
      if (pd.d < 3.2) return [120, 118, 112];
      if (h > 6) return [86, 108, 60];
      return [90 + 30 * n2(x, z, 0.08), 128 + 26 * n2(x, z, 0.08), 78 + 14 * n2(x, z, 0.1)];
    },
    draw: (g, px, sz) => paintRefugeAndStart(g, px, sz),
  });

  return makeDescriptor(K, scene, {
    id: 'hurricane', look, paint, refugeStyle: 'lodge', mapView: { cx: 0, cz: -15, half: 105 }, windAmp: 3,
    water: { mode: 'rise', base: 0.05, max: 3.6, pow: 1.5, amp: 2.4, surgeAt: 210, surge: 1.4, colors: { shallow: 0x3a8a9a, deep: 0x123a4a, mud: 0x6a6a58 } },
    extra: { windCover: false },
  });
}
