import { CFG, terrainH, setTerrain, smoothstep, n2, pathDist, pathPoint, refugeHeight, startFlat, setStartSafe, makeDescriptor, placeSigns, paintRefugeAndStart } from './common.js';

/* ======================================================================
   MUNDO 4 · ROCKSLIDE — avalancha de roca en el valle minero de Pedregal
   · Un valle largo (sur → norte) encajado entre dos paredes de roca gris oscura (#6B6C76), con crestas
     dentadas, pedreras y canales por los que bajan las rocas.
   · El pueblo minero en el fondo del valle: casas de piedra (algunas aplastadas por bloques caídos), la
     entrada de la mina con raíles y vagonetas, redes y barreras de contención (algunas reventadas).
   · Los desprendimientos (hazards3.js) lanzan rocas que bajan rodando por los canales hasta el pueblo.
   · Inicio al sur; el refugio de rescate en el extremo norte del valle.
   ====================================================================== */
export const seed = 5150;

const look = {
  horizon: 0xb4b8c2, zenith: 0x4a5468, cloudLo: [0.42, 0.43, 0.47], cloudHi: [0.82, 0.83, 0.87], cover: 0.72, fog: 0x9c9ea8, fogD: 0.0062,
  hemi: [0xdfe2ea, 0x4a4a54, 1.1], sun: [0xfff2e0, 2.0], exposure: 1.0, lightning: false, birds: true,
  precip: { color: [0.62, 0.62, 0.64], alpha: 0.16, speed: 2.4, len: 0.12, wind: [0.9, 0, 0.3] },
};

const ROCK = 0x6b6c76;                                   // color de identidad del mundo
const cx = (z) => 8 * Math.sin(z * 0.025);              // eje del valle
// canales de las pedreras: de la cresta al fondo del valle (lado oeste -1 y este +1)
const LANES = [];
for (const s of [-1, 1]) for (const z0 of [-38, -12, 14, 40]) {
  const zz = z0 + (s > 0 ? 6 : 0);
  LANES.push([[cx(zz) + s * 60, zz - 4], [cx(zz) + s * 44, zz - 1], [cx(zz + 2) + s * 28, zz + 2], [cx(zz + 5) + s * 15, zz + 5], [cx(zz + 7) + s * 7, zz + 7]]);
}

function rockslideTerrain(x, z) {
  const u = Math.abs(x - cx(z));
  let h = 2 + 1.1 * n2(x, z, 0.05);
  const wall = smoothstep(22, 64, u);
  h += wall * (36 + 10 * n2(x, z, 0.035)) + smoothstep(30, 62, u) * 7 * n2(x, z, 0.14); // paredes con crestas dentadas
  h += smoothstep(-74, -108, z) * 26 + smoothstep(90, 118, z) * 18;                        // cierran el valle
  for (const L of LANES) { const d = pathDist(x, z, L).d; if (d < 5 && u > 12) h -= 2.2 * smoothstep(5, 1.2, d) * smoothstep(12, 24, u); } // canales
  h = refugeHeight(h, x, z);
  h = startFlat(h, x, z, 2);
  return h;
}

export function build(K, { scene }) {
  setStartSafe({ x: 0, z: 76 }, { x: cx(-62), z: -62, y: 3.2, r: 8 });
  setTerrain(rockslideTerrain);
  const rng = K.rng;
  const T = CFG.START, S = CFG.SAFE;
  const rr = (a, b) => a + rng.next() * (b - a);
  const G = (x, z) => terrainH(x, z);
  const road = []; for (let z = 76; z >= -62; z -= 6) road.push([cx(z), z]);
  const laneD = (x, z) => Math.min(...LANES.map((L) => pathDist(x, z, L).d));
  const free = (x, z, r = 6) => Math.hypot(x - T.x, z - T.z) > 13 + r && Math.hypot(x - S.x, z - S.z) > 15 + r && !K.solids.some((s) => s.x0 < x + r && s.x1 > x - r && s.z0 < z + r && s.z1 > z - r && s.y1 > G(x, z) + 0.3);
  const stone = [0x8a8a90, 0x7a7a82, 0x9a9890, 0x6e6e76, 0x8c8478];
  const roofs = [0x3a3c44, 0x4a4c54, 0x2e3036, 0x5a4a40];
  const grays = [0x6b6c76, 0x5c5d66, 0x7a7b84, 0x4e4f58];

  // ---- el pueblo minero en el fondo del valle ----
  const houses = [];
  for (let i = 0; i < 40 && houses.length < 16; i++) {
    const z = rr(-44, 62), side = rng.chance(0.5) ? 1 : -1, x = cx(z) + side * rr(10, 17);
    if (!free(x, z, 6) || laneD(x, z) < 7 || houses.some((h) => Math.hypot(h[0] - x, h[1] - z) < 13)) continue;
    houses.push([x, z]);
    const w = rr(7, 9.5), d = rr(6, 7.5), tall = rng.chance(0.3), face = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    K.house({ x, z, w, d, h: tall ? 6 : 3.4, color: rng.pick(stone), roofColor: rng.pick(roofs), roof: tall ? 'flat' : 'gable', facing: face, chimney: rng.chance(0.6), cand: 'casas del pueblo minero' });
    const g = G(x, z), fx = x - side * (w / 2 + 1.6);
    K.box(fx, g, z, 2, 0.45, 3, 0x6a6058, { tag: 'porch' });
    K.cand('balcony', fx, g + 0.47, z, { zone: 'casas del pueblo minero' });
    K.cand('street', x - side * (w / 2 + 4.5), G(x - side * (w / 2 + 4.5), z), z + rr(-2, 2), { zone: 'calles del pueblo', type: 'ground' });
    // algunas casas, aplastadas por un bloque caído de la montaña
    if (rng.chance(0.35)) {
      const s2 = rr(2.2, 3.2);
      K.ico(x + side * rr(0, 2), g + (tall ? 6 : 3.4) + s2 * 0.4, z + rr(-1.5, 1.5), s2, s2 * 0.85, s2, rng.pick(grays), { ry: rr(0, 3) });
      for (let k = 0; k < 6; k++) K.ico(x + rr(-5, 5), g + rr(0, 0.4), z + rr(-4, 4), rr(0.4, 1), rr(0.3, 0.7), rr(0.4, 1), rng.pick(grays), { ry: rr(0, 3) });
    }
  }
  // plaza con fuente y la báscula de la mina
  { const pz = 22, px = cx(pz) + 6; K.cyl(px, G(px, pz), pz, 2.6, 0.8, 0x8a8a86, { solid: true, tag: 'fountain' }); for (let k = 0; k < 5; k++) K.cand('street', px + rr(-7, 7), G(px, pz), pz + rr(-6, 6), { zone: 'plaza del pueblo', type: 'ground' }); }

  // ---- la entrada de la mina (ladera oeste) con raíles y vagonetas ----
  {
    const mz = -24, mx = cx(mz) - 21, g = G(mx, mz), wood = 0x6a4a2e;
    K.box(mx - 1.6, g, mz, 5, 5.5, 8, 0x4a4b52, { tag: 'rock' });
    K.box(mx + 1.2, g, mz, 0.7, 4.2, 0.7, wood, { tag: 'post' }); K.box(mx + 1.2, g, mz + 3.6, 0.7, 4.2, 0.7, wood, { tag: 'post' });
    K.box(mx + 1.2, g + 4.2, mz + 1.8, 0.8, 0.7, 4.6, wood, { solid: false });
    K.box(mx + 0.95, g, mz + 1.8, 0.2, 3.9, 3.0, 0x0c0c0e, { solid: false });                  // boca oscura
    for (let i = 0; i < 9; i++) { const x = mx + 2 + i * 1.6; K.box(x, G(x, mz + 1.8) + 0.05, mz + 1.8, 0.25, 0.12, 2.0, wood, { solid: false }); }
    for (const dz of [0.6, 3.0]) K.box(mx + 9, G(mx + 9, mz + dz) + 0.18, mz + dz, 15, 0.1, 0.12, 0x4a4a4e, { solid: false });
    for (const [ox, full] of [[4.5, true], [9.5, false]]) {
      const x = mx + ox, gg = G(x, mz + 1.8);
      K.box(x, gg + 0.3, mz + 1.8, 2.0, 1.1, 1.5, 0x5a3a26, { tag: 'crate' });
      if (full) K.ico(x, gg + 1.45, mz + 1.8, 0.9, 0.45, 0.65, 0x3a3a40);
      K.cand('roof', x, gg + 1.42, mz + 1.8, { zone: 'mina de Pedregal' });
    }
    for (let k = 0; k < 4; k++) K.cand('street', mx + rr(4, 12), G(mx + 6, mz), mz + rr(-3, 6), { zone: 'mina de Pedregal', type: 'ground' });
  }

  // ---- redes y barreras de contención en las laderas (algunas reventadas) ----
  for (const L of LANES) {
    const [x, z] = pathPoint(L, 0.55), [x2, z2] = pathPoint(L, 0.6), a = Math.atan2(z2 - z, x2 - x) + Math.PI / 2;
    // (las redes y postes de contención ya no se construyen: tapaban la vista; los sorteos se conservan)
    const broken = rng.chance(0.5), g = G(x, z), skip = () => {};
    if (broken) for (let r = 0; r < 3; r++) skip(x + rr(-1, 1), g, z + rr(-1, 1), rr(3, 5), -a + rr(-0.6, 0.6));
    K.cand('ledge', x + Math.cos(a) * 3.2, g + 0.05, z + Math.sin(a) * 3.2, { zone: 'pedreras', needsTool: 'rope' });
  }
  // ---- salientes rocosos con cuerda y repisas en las paredes ----
  for (let i = 0; i < 10; i++) {
    const z = rr(-60, 66), side = rng.chance(0.5) ? 1 : -1, x = cx(z) + side * rr(30, 42);
    if (!free(x, z, 3) || laneD(x, z) < 6) continue;
    const g = G(x, z);
    K.box(x, g - 0.5, z, 4.2, 3.4, 4.2, rng.pick(grays), { tag: 'rock' });
    K.cand('ledge', x, g + 2.92, z, { zone: 'repisas de la pared', needsTool: 'rope' });
  }
  // ---- bloques caídos, pedregal, pinos y matorrales ----
  for (const p of K.scatter(90, { x0: -100, x1: 100, z0: -90, z1: 90 }, { minDist: 6, accept: (x, z) => free(x, z, 2) && pathDist(x, z, road).d > 4 })) K.rock(p.x, p.z, rr(0.9, 3.2), rng.pick(grays));
  for (const L of LANES) for (let t = 0.1; t < 1; t += 0.12) { const [x, z] = pathPoint(L, t); K.rock(x + rr(-2.5, 2.5), z + rr(-2.5, 2.5), rr(0.4, 1.0), rng.pick([0x9a9ca4, 0x8a8c94]), { solidBox: false }); }
  for (const p of K.scatter(55, { x0: -100, x1: 100, z0: -90, z1: 90 }, { minDist: 7, accept: (x, z, h) => free(x, z, 2) && laneD(x, z) > 6 && pathDist(x, z, road).d > 5 && h < 26 })) K.tree(rng.chance(0.65) ? 'pine' : 'shrub', p.x, p.z, rr(0.8, 1.2));
  // ---- camino de evacuación (sur → norte) ----
  for (let i = 0; i < 30; i++) {
    const p = pathPoint(road, i / 30), x = p[0] + rr(-2.5, 2.5), z = p[1] + rr(-2.5, 2.5);
    if (Math.hypot(x - S.x, z - S.z) < 13) continue;
    K.cand('street', x, G(x, z), z, { zone: 'camino del valle', type: 'ground' });
    if (i % 3 === 0) K.site('road', x + rr(-1.5, 1.5), z + rr(-1.5, 1.5), rr(0, 3.14));
  }
  placeSigns(K, [[cx(70) + 5, 70], [cx(40) + 5, 30], [cx(5) + 5, 5], [cx(-20) + 5, -20], [cx(-44) + 5, -44], [cx(56) - 6, 56]]);

  const paint = () => K.paintGround({
    colorAt: (x, z, h, sl) => {
      const u = Math.abs(x - cx(z)), a = n2(x, z, 0.08);
      if (laneD(x, z) < 3.2 && u > 10) return [118 + 14 * a, 118 + 14 * a, 124 + 12 * a];        // pedrera más clara
      if (pathDist(x, z, road).d < 2.8) return [124, 112, 96];
      if (sl > 0.9 || u > 34) return [62 + 18 * a, 63 + 18 * a, 72 + 18 * a];                 // roca gris oscura (#6B6C76)
      if (u > 22) return [84 + 14 * a, 85 + 14 * a, 94 + 14 * a];
      return [98 + 20 * a, 112 + 18 * a, 88 + 14 * a];                                          // fondo del valle con hierba rala
    },
    draw: (g, px, sz) => paintRefugeAndStart(g, px, sz, '#9a9ca4'),
  });

  return makeDescriptor(K, scene, {
    id: 'rockslide', look, paint, refugeStyle: 'mine', mapView: { cx: 0, cz: 5, half: 105 }, windAmp: 0.8,
    extra: { rockLanes: LANES, worldColor: ROCK, noSpawn: (x, z) => laneD(x, z) < 3 && Math.abs(x - cx(z)) > 12 },
  });
}
