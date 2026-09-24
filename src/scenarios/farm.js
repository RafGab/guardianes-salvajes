import { CFG, terrainH, setTerrain, smoothstep, lerp, n2, pathDist, pathPoint, refugeHeight, startFlat, setStartSafe, makeDescriptor, placeSigns, paintRefugeAndStart } from './common.js';

export const seed = 8808;

const look = {
  horizon: 0xe8c88a, zenith: 0x5a86b8, cloudLo: [0.5, 0.42, 0.3], cloudHi: [1, 0.9, 0.7], cover: 0.12, fog: 0xe0c48a, fogD: 0.0048,
  hemi: [0xfff0c8, 0x8a6a3a, 1.5], sun: [0xffe6a8, 3.0], exposure: 1.05, lightning: false, precip: null,
};

const RES = { x: 8, z: -24, r: 30 };            // embalse casi vacío
const ROAD = [[0, 68], [14, 40], [-10, 14], [-30, -10], [-44, -40], [-30, -70], [4, -90]];

function farmTerrain(x, z) {
  let h = 1.4 + 3.4 * n2(x, z, 0.018) - 1.2;
  h += smoothstep(66, 120, Math.hypot(x, z + 10)) * (16 + 10 * n2(x, z, 0.03));
  const rd = Math.hypot(x - RES.x, z - RES.z);
  h = lerp(h, -3.4, smoothstep(RES.r, RES.r - 14, rd));           // cubeta del embalse
  h -= 1.2 * smoothstep(RES.r + 6, RES.r, rd) * smoothstep(RES.r - 20, RES.r - 2, rd);
  const pd = pathDist(x, z, ROAD);
  h = lerp(h, 1.4, smoothstep(6, 2.5, pd.d) * 0.6);
  h = refugeHeight(h, x, z);
  h = startFlat(h, x, z, 1.0);
  return h;
}

export function build(K, { scene }) {
  setStartSafe({ x: 0, z: 68 }, { x: 4, z: -92, y: 8.4, r: 8 });
  setTerrain(farmTerrain);
  const rng = K.rng;
  const T = CFG.START, S = CFG.SAFE;
  const rr = (a, b) => a + rng.next() * (b - a);
  const inRes = (x, z, m = 0) => Math.hypot(x - RES.x, z - RES.z) < RES.r + m;
  const free = (x, z) => Math.hypot(x - T.x, z - T.z) > 13 && Math.hypot(x - S.x, z - S.z) > 15;

  // ---- granjas: casa, granero y silo ----
  const farms = [[-40, 38], [42, 30], [-58, -22], [50, -50], [-14, 46]];
  for (const [fx, fz] of farms) {
    if (!free(fx, fz) || inRes(fx, fz, 4)) continue;
    const g = terrainH(fx, fz);
    K.house({ x: fx, z: fz, w: 9, d: 7, h: 3.4, color: 0xd8c8a0, roofColor: 0x8a4a2a, roof: 'gable', base: g, cand: 'granjas', chimney: true });
    K.cand('street', fx + 1, terrainH(fx + 1, fz + 6), fz + 6, { zone: 'granjas', type: 'ground' });
    const bx = fx + 14, bz = fz + 2, bg = terrainH(bx, bz);
    K.box(bx, bg - 1, bz, 10, 7.4, 8, 0x9a3a2a, { tag: 'building' });
    K.prism(bx, bg + 6.4, bz, 8.6, 3, 10.6, 0x5a4a44, Math.PI / 2);
    K.cand('street', bx, terrainH(bx, bz + 6.5), bz + 6.5, { zone: 'graneros', type: 'ground' });
    K.box(bx - 3, bg + 3, bz + 4.4, 3, 0.3, 1.6, 0x8a6a48, { tag: 'ledge' });
    K.cand('ledge', bx - 3, bg + 3.32, bz + 4.4, { zone: 'graneros', needsTool: 'rope' });
    K.cyl(fx - 10, g - 1, fz - 6, 2.2, 10, 0xc0c4c8, { solid: true, tag: 'silo' });
    K.cone(fx - 10, g + 9, fz - 6, 2.5, 1.8, 0x8a8e92);
    K.fence(fx - 16, fz + 12, fx + 8, fz + 12);
    // pesebre / bebedero seco para animales
    K.box(fx + 3, g, fz + 11, 3.2, 0.7, 1, 0x7a5a38, { tag: 'trough' });
    K.cand('street', fx + 3, g, fz + 9.8, { zone: 'corrales', type: 'ground' });
    K.cand('street', fx - 3, g, fz + 9.8, { zone: 'corrales', type: 'ground' });
  }
  // ---- embalse seco: casi sin agua, barcas varadas ----
  for (let i = 0; i < 4; i++) {
    const a = rr(0, 6.28), r = rr(6, 18);
    const x = RES.x + Math.cos(a) * r, z = RES.z + Math.sin(a) * r, g = terrainH(x, z);
    K.box(x, g, z, 4.4, 0.7, 1.6, 0x8a5a38, { tag: 'boat', ry: rr(0, 3) });
    K.cand('roof', x, g + 0.72, z, { zone: 'lecho del embalse' });
  }
  for (let i = 0; i < 16; i++) {
    const a = rr(0, 6.28), r = rr(4, RES.r - 4);
    const x = RES.x + Math.cos(a) * r, z = RES.z + Math.sin(a) * r;
    K.cand('street', x, terrainH(x, z), z, { zone: 'lecho del embalse', type: 'ground' });
  }
  // presa y torre de toma
  const dz = RES.z + RES.r + 1, dg = terrainH(RES.x, dz);
  K.box(RES.x, dg - 1, dz, 40, 4.4, 4.4, 0x9a9a94, { tag: 'dam' });
  K.cand('street', RES.x + rr(-10, 10), dg + 3.42, dz, { zone: 'presa', type: 'ground' });
  // campos secos con surcos, pajares y árboles muertos
  for (let i = 0; i < 26; i++) {
    const x = rr(-80, 80), z = rr(-80, 60);
    if (!free(x, z) || inRes(x, z, 6) || pathDist(x, z, ROAD).d < 5) continue;
    K.box(x, terrainH(x, z), z, 2.4, 1.8, 2.4, 0xd8b860, { tag: 'hay' });
    K.cand('roof', x, terrainH(x, z) + 1.82, z, { zone: 'campos de heno' });
    if (i % 2) K.site('road', x + 4, z, rr(0, 3));
  }
  for (const p of K.scatter(60, { x0: -100, x1: 100, z0: -100, z1: 100 }, { minDist: 8, accept: (x, z, h) => free(x, z) && !inRes(x, z, 3) && pathDist(x, z, ROAD).d > 5 && h < 16 })) K.tree(rng.chance(0.5) ? 'dead' : 'shrub', p.x, p.z, rr(0.8, 1.3));
  for (const p of K.scatter(38, { x0: -100, x1: 100, z0: -100, z1: 100 }, { minDist: 7, accept: (x, z) => free(x, z) && !inRes(x, z, 2) })) K.rock(p.x, p.z, rr(0.9, 2.4), 0x9a8a72);
  for (let i = 0; i < 44; i++) {
    const p = pathPoint(ROAD, 0.02 + (i / 44) * 0.95);
    const x = p[0] + rr(-3, 3), z = p[1] + rr(-3, 3);
    K.cand('street', x, terrainH(x, z), z, { zone: 'camino rural', type: 'ground' });
    if (i % 3 === 0) K.site('road', x + rr(-1.5, 1.5), z + rr(-1.5, 1.5), rr(0, 3.14));
  }
  // sombra: árboles y graneros; agua: bebederos
  const shade = farms.map(([x, z]) => [x + 14, z + 2, 7]).concat(farms.map(([x, z]) => [x, z, 6]));
  const waterSpots = [[RES.x, RES.z, 7], [RES.x + 4, RES.z + 4, 4]];
  placeSigns(K, [[4, 62], [12, 38], [-10, 12], [-30, -12], [-42, -40], [-28, -68]]);

  const paint = () => K.paintGround({
    colorAt: (x, z, h, sl) => {
      const rd = Math.hypot(x - RES.x, z - RES.z);
      if (rd < 5) return [80, 110, 112];
      if (rd < RES.r - 8) return [150 + 20 * n2(x, z, 0.08), 124 + 14 * n2(x, z, 0.08), 96];
      if (rd < RES.r) return [180, 150, 104];
      const pd = pathDist(x, z, ROAD);
      if (pd.d < 3) return [190, 168, 120];
      if (h > 12) return [140, 120, 90];
      return [196 + 20 * n2(x, z, 0.05), 168 + 14 * n2(x, z, 0.05), 100 + 10 * n2(x, z, 0.08)];
    },
    draw: (g, px, sz) => {
      // grietas del suelo seco
      g.strokeStyle = 'rgba(70,46,26,.55)';
      g.lineWidth = sz(0.22);
      for (let i = 0; i < 70; i++) {
        const a = rr(0, 6.28), r = rr(2, RES.r - 4);
        let x = RES.x + Math.cos(a) * r, z = RES.z + Math.sin(a) * r;
        g.beginPath();
        g.moveTo(px(x), px(z));
        for (let k = 0; k < 5; k++) { x += rr(-3, 3); z += rr(-3, 3); g.lineTo(px(x), px(z)); }
        g.stroke();
      }
      // surcos
      g.strokeStyle = 'rgba(120,80,40,.25)';
      for (const [fx, fz] of farms) for (let k = 0; k < 8; k++) { g.beginPath(); g.moveTo(px(fx + 18), px(fz - 12 + k * 2.2)); g.lineTo(px(fx + 38), px(fz - 12 + k * 2.2)); g.stroke(); }
      paintRefugeAndStart(g, px, sz, '#e0d0a8');
    },
  });

  return makeDescriptor(K, scene, {
    id: 'drought', look, paint, refugeStyle: 'farm', mapView: { cx: 0, cz: -15, half: 105 }, windAmp: 0.7,
    water: { mode: 'rise', base: -2.4, max: -2.1, pow: 1, amp: 0.4, colors: { shallow: 0x7a8a6a, deep: 0x3a5048, mud: 0x8a7a5a } },
    extra: { shadeSpots: shade, waterSpots, dustDevilAt: [[-26, 10], [30, -40], [-10, -66]] },
  });
}
