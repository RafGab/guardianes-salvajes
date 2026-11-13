import { CFG, terrainH, setTerrain, smoothstep, lerp, n2, gauss, pathDist, pathPoint, refugeHeight, startFlat, setStartSafe, makeDescriptor, placeSigns, paintRefugeAndStart } from './common.js';

/* ======================================================================
   NIVEL 1 · CAMP FIRE — inspirado en Paradise (California) y el incendio de 2018
   Mundo de aventura con estética de dibujo animado:
   · Bosque de pinos gigantes (sur, inicio) con la Secuoya Gigante (secreto: su copa)
   · Río con puente, piedras para saltar y troncos flotantes; lago con muelle e isla
   · Cascada al oeste con una cueva secreta detrás del agua
   · Pueblo de Paradise: calles, casas, escuela, iglesia, gasolinera y depósito de agua
   · Cresta del Feather (este) atravesada por el Túnel del Minero (secreto)
   · Laderas quemadas y el Barranco de las Brasas con plataformas de roca
   · Campamento de rescate en la colina norte (zona segura)
   ====================================================================== */
export const seed = 1811;

const look = {
  horizon: 0xf0a060, zenith: 0x3a6ab0, cloudLo: [0.5, 0.32, 0.2], cloudHi: [0.98, 0.78, 0.6], cover: 0.22, fog: 0xd89a6a, fogD: 0.0052,
  hemi: [0xffe0b8, 0x4a5a3a, 1.3], sun: [0xffc890, 2.8], exposure: 1.02, lightning: false, birds: true, precip: null,
};

const WATER_Y = -0.6;
// Carretera principal (la "Skyway"): del bosque al puente, cruza el pueblo y sube al campamento
const ROAD = [[0, 96], [3, 76], [-3, 58], [1, 44], [1, 24], [6, 8], [8, -10], [8, -32], [6, -54], [2, -76], [0, -96]];
// Río (de la cascada, al oeste, hacia el este)
const RIVER = [[-80, 25], [-68, 30], [-50, 34], [-28, 31], [-8, 35], [14, 31], [36, 36], [58, 31], [80, 36], [100, 31], [124, 33]];
const LAKE = { x: -50, z: 51, r: 11 };
const ISLAND = { x: -52, z: 52 };
// Senderos del bosque (solo pintados): al lago y la cascada (oeste) y al barranco (este)
const TRAIL_W = [[-1, 84], [-16, 80], [-28, 70], [-34, 60], [-36, 46]];
const TRAIL_F = [[-30, 70], [-46, 68], [-64, 60], [-72, 46], [-80, 36], [-86, 28]];
const TRAIL_E = [[3, 80], [24, 74], [44, 70], [60, 70], [70, 64]];
// Pueblo de Paradise
const TOWN = { x0: -32, x1: 54, z0: -62, z1: 8, y: 1.5 };
const CROSS = [-4, -24, -44];          // calles transversales
const SIDE = [-16, 34];                // calles laterales
// Cueva tras la cascada (hueco dentro del macizo oeste)
const CAVE = { x0: -101, x1: -88, z0: 18, z1: 30, floor: 0.4, ceil: 6 };
// Túnel del Minero a través de la cresta este
const TUN = { z: -24, x0: 50, x1: 80, half: 2.6, floor: 1.6, ceil: 5.2 };
const RAV = { z: 72, x0: 66, x1: 106, half: 3.4 };

const box2 = (x, z, x0, x1, z0, z1, e) => smoothstep(x0 - e, x0 + e, x) * smoothstep(x1 + e, x1 - e, x) * smoothstep(z0 - e, z0 + e, z) * smoothstep(z1 + e, z1 - e, z);

function roadY(z) {
  if (z > 30) return 0.8;
  if (z > -56) return lerp(0.9, TOWN.y, smoothstep(26, 8, z));
  return lerp(TOWN.y, 10.4, smoothstep(-56, -90, z));
}
function ridgeH(x, z) {
  return 12 * Math.exp(-((x - 64) ** 2) / (2 * 5.2 * 5.2)) * smoothstep(16, 6, z) * smoothstep(-92, -78, z);
}
function townMask(x, z) { return box2(x, z, TOWN.x0, TOWN.x1, TOWN.z0, TOWN.z1, 5); }

function campTerrain(x, z) {
  // ondulación suave de base (siempre por encima del agua)
  let h = 0.7 + 2.6 * n2(x, z, 0.022) + 1.1 * n2(x + 40, z - 20, 0.06, 3);
  // montañas que cierran el mapa
  const cheb = Math.max(Math.abs(x), Math.abs(z));
  h += smoothstep(86, 112, cheb) * (18 + 12 * n2(x, z, 0.03));
  // macizo oeste (de donde nace la cascada): meseta alta
  const mz = smoothstep(-22, -8, z) * smoothstep(82, 66, z);
  h = lerp(h, 15 + 0.8 * n2(x, z, 0.08), smoothstep(-70, -86, x) * mz);
  // cresta este (Feather) y meseta del barranco
  h += ridgeH(x, z);
  h += 4.6 * smoothstep(58, 68, x) * smoothstep(46, 54, z);
  // pueblo llano
  h = lerp(h, TOWN.y, townMask(x, z));
  // carretera
  const pd = pathDist(x, z, ROAD);
  h = lerp(h, roadY(pd.z), smoothstep(9, 4, pd.d) * 0.95);
  // Túnel del Minero: pasillo excavado en la cresta
  const tz = smoothstep(TUN.half + 0.7, TUN.half - 0.1, Math.abs(z - TUN.z)) * smoothstep(TUN.x0 - 2, TUN.x0 + 3, x) * smoothstep(TUN.x1 + 2, TUN.x1 - 3, x);
  h = lerp(h, TUN.floor, tz);
  // Barranco de las Brasas
  const rv = smoothstep(RAV.half + 1.2, RAV.half - 0.2, Math.abs(z - RAV.z)) * smoothstep(RAV.x0 - 2, RAV.x0 + 4, x) * smoothstep(RAV.x1 + 2, RAV.x1 - 4, x);
  h = lerp(h, 0.2, rv);
  // río: cauce, orillas de arena y transición
  const rd = pathDist(x, z, RIVER).d;
  const bank = 0.3;
  let rh = rd < 4 ? -2.6 : rd < 7 ? lerp(-2.6, bank, smoothstep(4, 7, rd)) : bank;
  h = lerp(rh, h, smoothstep(11, 18, rd));
  if (rd < 11) h = rh;
  // la carretera sube a las orillas para llegar al puente
  if (pd.d < 6 && rd > 5) h = Math.max(h, lerp(h, roadY(pd.z), smoothstep(6, 3.5, pd.d)));
  // lago e isla
  const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (ld < LAKE.r + 7) {
    const lh = ld < LAKE.r ? lerp(-3.2, -2.2, smoothstep(0, LAKE.r, ld)) : lerp(-2.2, bank, smoothstep(LAKE.r, LAKE.r + 3, ld));
    h = Math.min(h, lerp(lh, h, smoothstep(LAKE.r + 3, LAKE.r + 7, ld)));
  }
  h = Math.max(h, gauss(x, z, ISLAND.x, ISLAND.z, 2.2, 1.0) - 0.3 + (Math.hypot(x - ISLAND.x, z - ISLAND.z) < 3.4 ? 0 : -9));
  // poza de la cascada
  h = Math.min(h, -3 + 3.3 * smoothstep(1.5, 4.5, Math.hypot(x - -80, z - 25)) + (Math.hypot(x - -80, z - 25) > 4.5 ? 9 : 0));
  // acantilado vertical de la cascada: el macizo llega hasta x = -88 (la garganta del río acaba ahí)
  h = lerp(h, 15 + 0.8 * n2(x, z, 0.08), smoothstep(-87.2, -88.4, x) * mz);
  // hueco de la cueva tras la cascada (lo tapan muros y techo de roca)
  const cv = smoothstep(CAVE.x0 - 1.2, CAVE.x0 + 0.2, x) * smoothstep(CAVE.z0 - 1.6, CAVE.z0 - 0.2, z) * smoothstep(CAVE.z1 + 1.6, CAVE.z1 + 0.2, z) * (x < -86 ? 1 : 0);
  h = lerp(h, CAVE.floor, cv);
  // meseta del campamento (solo cerca: la función general no admite alturas bajo cero, como el río)
  if (Math.hypot(x - CFG.SAFE.x, z - CFG.SAFE.z) < 50) h = refugeHeight(h, x, z);
  h = startFlat(h, x, z, 0.8);
  return h;
}

export function build(K, { scene }) {
  setStartSafe({ x: 0, z: 96 }, { x: 0, z: -98, y: 10.4, r: 8 });
  setTerrain(campTerrain);
  const rng = K.rng;
  const S = CFG.SAFE, T = CFG.START;
  const rr = (a, b) => a + rng.next() * (b - a);
  const G = (x, z) => terrainH(x, z);
  const coll = []; // coleccionables: piñas doradas y medallas de lugares secretos
  const pine = (x, y, z) => coll.push({ x, y: y + 0.9, z, kind: 'cone' });
  const pineG = (x, z) => pine(x, G(x, z), z);
  const roadD = (x, z) => pathDist(x, z, ROAD).d;
  const riverD = (x, z) => pathDist(x, z, RIVER).d;
  const inTown = (x, z) => x > TOWN.x0 - 2 && x < TOWN.x1 + 2 && z > TOWN.z0 - 2 && z < TOWN.z1 + 2;
  const nearSafe = (x, z, r = 15) => Math.hypot(x - S.x, z - S.z) < r;
  const nearStart = (x, z, r = 12) => Math.hypot(x - T.x, z - T.z) < r;
  const streetD = (x, z) => {
    let d = 1e9;
    for (const zs of CROSS) if (x > TOWN.x0 && x < TOWN.x1) d = Math.min(d, Math.abs(z - zs));
    for (const xs of SIDE) if (z > TOWN.z0 && z < TOWN.z1) d = Math.min(d, Math.abs(x - xs));
    return d;
  };
  const burnCenters = [[-30, 66], [26, 64], [86, -22], [92, 4], [80, -58], [-28, -74], [30, -74], [24, -14], [-20, -38]];
  const burnAt = (x, z) => Math.max(...burnCenters.map((b) => Math.exp(-((x - b[0]) ** 2 + (z - b[1]) ** 2) / (2 * 9 * 9))));
  const nearTunnel = (x, z) => x > TUN.x0 - 7 && x < TUN.x1 + 4 && Math.abs(z - TUN.z) < 6.5;
  const eastBurn = (x, z) => x > 70 && x < 104 && z < 24 && z > -86;

  /* ================= RÍO, PUENTE, PIEDRAS Y LAGO ================= */
  K.bridge({ x0: 1, z0: 22, x1: 1, z1: 45, width: 7, deckY: 1.0, color: 0x9a6a3e, rail: 0x6a4224, name: 'puente de la Skyway' });
  // piedras para cruzar saltando (al oeste del puente)
  for (let i = 0; i < 6; i++) {
    const z = 25.6 + i * 2.5, x = -24 + Math.sin(i * 1.3) * 0.8;
    K.cyl(x, -3, z, 0.95, 3.2, 0x8a8680, { solid: true, tag: 'stone' });
    if (i % 2) pine(x, 0.2, z);
  }
  // muelle del lago
  K.box(-36.5, -2.6, 48, 2.4, 3.0, 9, 0x9a6a3e, { tag: 'dock' });
  for (const dz of [-4, 0, 4]) K.cyl(-35.2, -2.8, 48 + dz, 0.16, 3.6, 0x5a3a20);
  K.cand('street', -36.5, 0.42, 45, { zone: 'muelle del lago', type: 'ground' });
  // barca varada y boyas
  K.box(-40, -0.75, 56, 1.6, 0.5, 3.6, 0xd8452a, { solid: false });
  // isla del lago: piñas
  pine(ISLAND.x, G(ISLAND.x, ISLAND.z), ISLAND.z);
  pine(ISLAND.x + 1.4, G(ISLAND.x + 1.4, ISLAND.z - 1), ISLAND.z - 1);
  K.tree('broad', ISLAND.x - 1, ISLAND.z + 1.2, 0.8);
  // orillas: candidatos y piñas
  for (let i = 0; i < 18; i++) {
    const p = pathPoint(RIVER, 0.05 + i * 0.05);
    const side = i % 2 ? 1 : -1;
    const x = p[0] + rr(-2, 2), z = p[1] + side * 9;
    if (inTown(x, z) || Math.abs(x - 1) < 6) continue;
    K.cand('street', x, G(x, z), z, { zone: 'orilla del río', type: 'ground' });
    if (i % 3 === 0) pineG(x + 2, z);
  }
  // cañas y rocas de la orilla
  for (const p of K.scatter(60, { x0: -86, x1: 108, z0: 14, z1: 50 }, { minDist: 3.5, accept: (x, z) => { const d = riverD(x, z); return d > 7.2 && d < 10.5 && Math.abs(x - 1) > 6; } })) {
    if (rng.chance(0.6)) K.tree('shrub', p.x, p.z, rr(0.6, 1.1)); else K.rock(p.x, p.z, rr(0.5, 1.0), 0x9a948a, { solidBox: false });
  }

  /* ================= CASCADA Y CUEVA SECRETA ================= */
  const rock = 0x8a7c70, rockD = 0x6a5e56;
  K.box((CAVE.x0 + CAVE.x1) / 2, -1, CAVE.z0 - 1, CAVE.x1 - CAVE.x0 + 2, 16.2, 2, rock, { tag: 'cave' });
  K.box((CAVE.x0 + CAVE.x1) / 2, -1, CAVE.z1 + 1, CAVE.x1 - CAVE.x0 + 2, 16.2, 2, rock, { tag: 'cave' });
  K.box(CAVE.x0 - 1, -1, (CAVE.z0 + CAVE.z1) / 2, 2, 16.2, CAVE.z1 - CAVE.z0 + 4, rock, { tag: 'cave' });
  K.box((CAVE.x0 + CAVE.x1) / 2, CAVE.ceil, (CAVE.z0 + CAVE.z1) / 2, CAVE.x1 - CAVE.x0, 15.2 - CAVE.ceil, CAVE.z1 - CAVE.z0, rockD, { tag: 'cave' });
  K.box(-87, 14.3, 24, 2.2, 0.9, 11, rock, { solid: false }); // labio de roca de la cascada
  for (let i = 0; i < 9; i++) K.ico(rr(CAVE.x0, CAVE.x1), 15.2, rr(CAVE.z0 - 2, CAVE.z1 + 2), rr(1, 2.2), rr(0.5, 1.2), rr(1, 2.2), rock);
  // cristales luminosos y setas de la cueva
  for (let i = 0; i < 12; i++) {
    const x = rr(CAVE.x0 + 1, CAVE.x1 - 2), z = rng.chance(0.5) ? CAVE.z0 + rr(0.3, 1.2) : CAVE.z1 - rr(0.3, 1.2);
    K.ico(x, CAVE.floor + rr(0.2, 1.4), z, 0.3, rr(0.6, 1.1), 0.3, rng.chance(0.5) ? 0x6ae8ff : 0xb68aff, { key: 'glow', ry: rr(0, 3) });
  }
  for (let i = 0; i < 6; i++) { const x = CAVE.x0 + 1 + i * 2, z = CAVE.z0 + 1.2; K.cyl(x, CAVE.floor, z, 0.08, 0.35, 0xf0e0c0); K.ico(x, CAVE.floor + 0.42, z, 0.28, 0.14, 0.28, 0xff7a4a, { key: 'glow' }); }
  // tesoro del fondo: un pequeño altar de piedra con la medalla
  K.box(CAVE.x0 + 1.8, CAVE.floor, 24, 1.6, 0.6, 1.6, 0x9a8e82, { tag: 'altar' });
  coll.push({ x: CAVE.x0 + 1.8, y: CAVE.floor + 1.5, z: 24, kind: 'medal', secret: 'cascada' });
  for (const [x, z] of [[-91, 21], [-94, 27], [-97, 21]]) pine(x, CAVE.floor, z);
  K.cand('clearing', -92, CAVE.floor, 25, { zone: 'cueva de la cascada', type: 'ground' });
  // piedras en la poza que llevan detrás del agua
  for (const [x, z] of [[-77.5, 29.5], [-80.5, 30.2], [-83.6, 29.4]]) K.cyl(x, -3, z, 0.85, 3.25, 0x8a8680, { solid: true, tag: 'stone' });

  /* ================= PUEBLO DE PARADISE ================= */
  const wallCols = [0xf2d8a8, 0xbfe0f2, 0xf6c2b6, 0xd8ecb0, 0xffe6a0, 0xd6c8f0, 0xf4f0e6];
  const roofCols = [0xc0392b, 0x2e6fb0, 0x3a8a4a, 0x8a4a2a, 0x6a4a8a];
  const lots = [];
  for (const zs of CROSS) for (const side of [1, -1]) for (const x of [-25, -7, 23, 45]) lots.push({ x, z: zs + side * 6.6, face: side > 0 ? Math.PI : 0, zs });
  const special = {
    '23,-30.6': 'school', '-7,-50.6': 'church', '45,-10.6': 'gas', '-25,-30.6': 'tower', '23,-10.6': 'shops', '-7,-10.6': 'shops',
  };
  const burnedLots = new Set(['23,2.6', '-25,-17.4', '45,-37.4', '-7,-37.4', '45,-50.6']);
  const crate = (x, z, h = 1.3) => { const g = G(x, z); K.box(x, g, z, 1.6, h, 1.6, 0x9a7040, { tag: 'crate' }); return g + h; };
  for (const L of lots) {
    const key = `${L.x},${Math.round(L.z * 10) / 10}`;
    const kind = special[key];
    const fz = L.face === 0 ? 1 : -1; // dirección hacia la calle
    if (kind === 'school') {
      K.house({ x: L.x, z: L.z, w: 15, d: 7.5, h: 4.2, color: 0xffd46a, roofColor: 0x8a5a3a, roof: 'flat', facing: L.face, cand: 'escuela de Paradise' });
      const top = crate(L.x - 9, L.z + fz * 1.5, 1.4); crate(L.x - 9, L.z - fz * 0.4, 2.8);
      for (let k = -2; k <= 2; k++) pine(L.x + k * 2.6, TOWN.y + 4.5, L.z);
      K.box(L.x, TOWN.y + 4.5, L.z - fz * 3.2, 0.12, 2.6, 0.12, 0xdddddd, { solid: false }); // mástil
      K.box(L.x + 0.6, TOWN.y + 6.4, L.z - fz * 3.2, 1.1, 0.7, 0.05, 0x2e86c1, { solid: false });
      void top;
    } else if (kind === 'church') {
      K.house({ x: L.x, z: L.z, w: 8, d: 10, h: 4.6, color: 0xf4f0e6, roofColor: 0x8a3a2a, roof: 'gable', facing: L.face, cand: 'iglesia' });
      K.box(L.x, TOWN.y, L.z - fz * 6, 2.6, 10, 2.6, 0xf4f0e6, { tag: 'building' });
      K.cone(L.x, TOWN.y + 10, L.z - fz * 6, 1.9, 4, 0x8a3a2a);
      K.box(L.x, TOWN.y + 7.4, L.z - fz * 4.68, 0.9, 1.3, 0.05, 0x3a2a1a, { solid: false });
    } else if (kind === 'gas') {
      // gasolinera: marquesina sobre 4 pilares y tienda
      for (const [ox, oz] of [[-4, -2], [4, -2], [-4, 2], [4, 2]]) K.box(L.x + ox, TOWN.y, L.z + oz, 0.45, 4.2, 0.45, 0xeeeeee, { tag: 'pillar' });
      K.box(L.x, TOWN.y + 4.2, L.z, 10.5, 0.55, 6, 0xd8452a, { tag: 'canopy' });
      for (const ox of [-1.6, 1.6]) K.box(L.x + ox, TOWN.y, L.z, 0.8, 1.6, 0.6, 0x2e86c1, { tag: 'pump' });
      crate(L.x + 6.2, L.z + 2.4, 1.3); crate(L.x + 6.2, L.z + 0.6, 2.6);
      K.cand('roof', L.x - 2, TOWN.y + 4.77, L.z, { zone: 'gasolinera' });
      pine(L.x + 2, TOWN.y + 4.75, L.z); pine(L.x - 3.5, TOWN.y + 4.75, L.z);
    } else if (kind === 'tower') {
      // depósito de agua con escalera de cajas en espiral (plataforma secreta de piñas arriba)
      for (const [ox, oz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) K.cyl(L.x + ox, TOWN.y, L.z + oz, 0.22, 9, 0x8a8a8a);
      K.box(L.x, TOWN.y + 9, L.z, 6, 0.4, 6, 0x6a6a6a, { tag: 'deck' });
      K.cyl(L.x, TOWN.y + 9.4, L.z, 2.3, 3.6, 0x7ab0d0, { solid: true, tag: 'tank' });
      K.cone(L.x, TOWN.y + 13, L.z, 2.5, 1.2, 0x5a8aa8);
      for (let k = 0; k < 7; k++) {
        const a = k * 0.64 + 0.4, rad = 5.0; // ningún escalón queda bajo la plataforma (no se golpea la cabeza)
        const px = L.x + Math.cos(a) * rad, pz = L.z + Math.sin(a) * rad, y = TOWN.y + 1.25 * (k + 1);
        K.box(px, y - 0.35, pz, 1.8, 0.35, 1.8, 0xb08850, { tag: 'step' });
        if (k % 2) pine(px, y, pz);
      }
      pine(L.x + 2.6, TOWN.y + 9.4, L.z + 2.6); pine(L.x - 2.6, TOWN.y + 9.4, L.z - 2.6);
    } else if (kind === 'shops') {
      K.house({ x: L.x, z: L.z, w: 12, d: 6.5, h: 3.4, color: rng.pick(wallCols), roofColor: 0x6a5a4a, roof: 'flat', facing: L.face, cand: 'tejados del pueblo' });
      crate(L.x + 7.2, L.z + fz * 1.2, 1.3); crate(L.x + 7.2, L.z - fz * 0.5, 2.6);
      K.box(L.x, TOWN.y + 2.5, L.z + fz * 3.6, 11, 0.12, 1.4, rng.pick(roofCols), { solid: false }); // toldo
      pine(L.x - 3, TOWN.y + 3.7, L.z); pine(L.x + 3, TOWN.y + 3.7, L.z);
    } else if (burnedLots.has(key)) {
      // casa quemada: paredes ennegrecidas sin tejado y vigas caídas
      K.house({ x: L.x, z: L.z, w: 8, d: 6, h: 2.6, color: 0x3a3230, roofColor: 0x222, roof: 'none', facing: L.face, cand: 'casas quemadas' });
      K.box(L.x - 1, TOWN.y + 2.6, L.z, 7.5, 0.25, 0.3, 0x1e1816, { solid: false, ry: 0.25 });
      K.box(L.x + 1.4, TOWN.y + 2.6, L.z + 1, 0.3, 0.25, 5, 0x1e1816, { solid: false, ry: -0.2 });
      K.cand('street', L.x + rr(-2, 2), TOWN.y, L.z + fz * 4.6, { zone: 'casas quemadas', type: 'ground' });
    } else {
      const roof = rng.chance(0.8) ? 'gable' : 'flat';
      K.house({ x: L.x, z: L.z, w: rr(7.5, 9), d: 6, h: rr(2.9, 3.4), color: rng.pick(wallCols), roofColor: rng.pick(roofCols), roof, facing: L.face, chimney: rng.chance(0.4), cand: 'casas de Paradise' });
      // porche y valla del jardín
      K.box(L.x, TOWN.y, L.z + fz * 3.6, 3.4, 0.35, 1.3, 0xb08860, { tag: 'porch' });
      K.cand('balcony', L.x + 0.8, TOWN.y + 0.36, L.z + fz * 3.6, { zone: 'porches' });
      if (rng.chance(0.6)) K.tree('broad', L.x + rr(-3.5, 3.5) + 4.5, L.z - fz * 0.5, rr(0.6, 0.85));
    }
    // buzón
    K.box(L.x - 3.4, TOWN.y, L.z + fz * 4.9, 0.12, 1.0, 0.12, 0x5a4a3a, { solid: false });
    K.box(L.x - 3.4, TOWN.y + 1.0, L.z + fz * 4.9, 0.4, 0.3, 0.55, rng.pick([0x2e6fb0, 0xc0392b, 0x3a8a4a]), { solid: false });
  }
  // farolas, bocas de riego y coches aparcados
  const carCols = [0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x8e44ad];
  const car = (x, z, ry, col) => {
    const g = G(x, z);
    K.box(x, g + 0.25, z, 1.9, 0.85, 4.1, col, { tag: 'car', ry });
    K.box(x, g + 1.1, z, 1.7, 0.7, 2.2, 0xa8d8ee, { solid: false, ry });
    for (const [ox, oz] of [[-0.85, -1.3], [0.85, -1.3], [-0.85, 1.3], [0.85, 1.3]]) {
      const c = Math.cos(ry), s = Math.sin(ry);
      K.cyl(x + ox * c + oz * s, g, z - ox * s + oz * c, 0.36, 0.5, 0x1a1a1a);
    }
    K.cand('roof', x, g + 1.12, z, { zone: 'coches abandonados' });
  };
  for (const zs of CROSS) {
    for (let x = -26; x <= 50; x += 15) {
      K.cyl(x, TOWN.y, zs - 2.6, 0.1, 4.2, 0x3a3a3a);
      K.box(x, TOWN.y + 4.2, zs - 2.2, 0.3, 0.18, 1.0, 0xffe6a0, { key: 'glow', solid: false });
    }
    car(rr(-24, -18), zs + 1.2, Math.PI / 2, rng.pick(carCols));
    car(rr(38, 48), zs - 1.2, Math.PI / 2, rng.pick(carCols));
    K.cyl(16, TOWN.y, zs + 2.4, 0.22, 0.75, 0xd8452a);
    for (let i = 0; i < 4; i++) { const x = -28 + i * 22 + rr(-3, 3); K.cand('street', x, TOWN.y, zs + rr(-1, 1), { zone: 'calles del pueblo', type: 'street' }); }
    for (let x = -22; x <= 48; x += 10) if (Math.abs(x - 8) > 3) pine(x, TOWN.y, zs);
  }
  car(11, -18, 0.1, 0xc0392b); car(4.5, -40, -0.08, 0xecf0f1);
  // piñas por la Skyway
  for (let i = 0; i < 16; i++) { const p = pathPoint(ROAD, 0.04 + i * 0.058); if (!nearSafe(p[0], p[1], 14) && !nearStart(p[0], p[1], 6)) pineG(p[0] + (i % 2 ? 1.2 : -1.2), p[1]); }
  // cartel de bienvenida del pueblo
  K.box(-1, TOWN.y, 12, 0.25, 1.6, 0.25, 0x6a4a2a, { solid: false });
  K.box(6, TOWN.y, 12, 0.25, 1.6, 0.25, 0x6a4a2a, { solid: false });
  K.box(2.5, TOWN.y + 1.6, 12, 8, 1.4, 0.3, 0x2e7a4a, { solid: false });
  // árboles de las calles y del borde del pueblo
  for (const p of K.scatter(70, { x0: TOWN.x0 - 8, x1: TOWN.x1 + 6, z0: TOWN.z0 - 8, z1: TOWN.z1 + 6 }, { minDist: 6, accept: (x, z) => streetD(x, z) > 3 && roadD(x, z) > 5 && !lots.some((L) => Math.abs(L.x - x) < 9 && Math.abs(L.z - z) < 5.5) && !nearSafe(x, z, 16) && !nearTunnel(x, z) && (x < -20 || x > 40 || z > 2 || z < -56) })) {
    K.tree(rng.chance(0.55) ? 'pine' : 'broad', p.x, p.z, rr(0.9, 1.3));
  }

  /* ================= TÚNEL DEL MINERO ================= */
  for (let x = TUN.x0 + 4; x <= TUN.x1 - 4; x += 1.5) {
    const top = Math.max(G(x, TUN.z - TUN.half - 1.2), G(x, TUN.z + TUN.half + 1.2));
    if (top < TUN.ceil + 0.8) continue;
    K.box(x, TUN.ceil, TUN.z, 1.55, top - TUN.ceil, TUN.half * 2 + 2.6, rockD, { tag: 'cave' });
    K.box(x, top, TUN.z, 1.6, 0.22, TUN.half * 2 + 2.8, 0x6aa848, { solid: false }); // hierba encima: el túnel no se nota desde fuera
    if (rng.chance(0.4)) K.ico(x, top + 0.5, TUN.z + rr(-2.5, 2.5), rr(0.7, 1.1), rr(0.5, 0.8), rr(0.7, 1.1), 0x5a8a3a);
    // paredes invisibles: la cámara no se sale del túnel
    for (const s of [-1, 1]) K.solid(x - 0.8, x + 0.8, TUN.floor - 0.5, top, TUN.z + s * (TUN.half + 0.2) - 0.25, TUN.z + s * (TUN.half + 0.2) + 0.25, 'cave');
  }
  // vigas de mina, raíles y faroles
  for (let x = TUN.x0 + 6; x <= TUN.x1 - 6; x += 5) {
    for (const s of [-1, 1]) K.box(x, TUN.floor, TUN.z + s * (TUN.half - 0.25), 0.3, TUN.ceil - TUN.floor, 0.3, 0x6a4a2a, { solid: false });
    K.box(x, TUN.ceil - 0.35, TUN.z, 0.3, 0.3, TUN.half * 2, 0x6a4a2a, { solid: false });
    K.ico(x, TUN.ceil - 0.8, TUN.z + 1.6, 0.18, 0.24, 0.18, 0xffc060, { key: 'glow' });
  }
  for (const s of [-0.6, 0.6]) K.box((TUN.x0 + TUN.x1) / 2, TUN.floor, TUN.z + s, TUN.x1 - TUN.x0 - 8, 0.08, 0.1, 0x6a6a6a, { solid: false });
  K.box(64, TUN.floor, TUN.z - 1, 1.6, 1.0, 2.4, 0x5a5a5a, { tag: 'cart' }); // vagoneta
  coll.push({ x: 64, y: TUN.floor + 2.0, z: TUN.z - 1, kind: 'medal', secret: 'tunel' });
  for (const x of [57, 61, 68, 72]) pine(x, TUN.floor, TUN.z + 1);
  K.cand('street', 69, TUN.floor, TUN.z - 0.8, { zone: 'túnel del minero', type: 'ground' });
  // arbustos que esconden la entrada oeste
  for (const dz of [-3.6, 3.6]) K.tree('shrub', TUN.x0 + 3, TUN.z + dz, 1.4);

  /* ================= LADERAS QUEMADAS (ESTE) ================= */
  for (const p of K.scatter(110, { x0: 70, x1: 108, z0: -86, z1: 22 }, { minDist: 4, accept: (x, z, h) => h < 14 && Math.abs(z - TUN.z) > 5 })) {
    const b = burnAt(p.x, p.z);
    K.tree(b > 0.35 || rng.chance(0.6) ? 'dead' : 'pine', p.x, p.z, rr(0.9, 1.4));
  }
  for (const p of K.scatter(26, { x0: 72, x1: 106, z0: -84, z1: 20 }, { minDist: 7, accept: (x, z) => !nearTunnel(x, z) })) K.rock(p.x, p.z, rr(0.8, 2), 0x5a524a);
  for (let i = 0; i < 12; i++) {
    const x = rr(74, 104), z = rr(-80, 18);
    if (G(x, z) > 12) continue;
    K.cand(i % 3 ? 'street' : 'clearing', x, G(x, z), z, { zone: 'laderas quemadas', type: i % 3 ? 'ground' : 'clearing' });
    if (i % 2) pineG(x + 1.5, z);
  }
  // cabaña del guarda forestal (este)
  K.house({ x: 88, z: -40, w: 7, d: 6, h: 3, color: 0x8a5a34, roofColor: 0x4a2a1a, roof: 'gable', facing: -Math.PI / 2, chimney: true, cand: 'cabaña del guarda' });
  K.cand('street', 83, G(83, -40), -40, { zone: 'cabaña del guarda', type: 'ground' });

  /* ================= BARRANCO DE LAS BRASAS ================= */
  // plataformas de roca que cruzan el barranco (norte ↔ sur)
  for (const [i, xc] of [[0, 78], [1, 94]]) {
    const yTop = Math.min(G(xc, RAV.z - RAV.half - 2.5), G(xc, RAV.z + RAV.half + 2.5)) - 0.4;
    [-2.6, 0, 2.6].forEach((dz, k) => {
      const z = RAV.z + dz, x = xc + (k === 1 ? (i ? -1 : 1) : 0);
      const top = yTop - (k === 1 ? 0.6 : 0);
      K.cyl(x, -0.5, z, 1.05, top + 0.5, 0x8a6a5a, { solid: true, tag: 'pillar' });
      pine(x, top, z);
    });
  }
  // brasas que brillan en el fondo
  for (let i = 0; i < 34; i++) K.ico(rr(RAV.x0 + 3, RAV.x1 - 3), 0.25, RAV.z + rr(-2.2, 2.2), rr(0.25, 0.6), 0.12, rr(0.25, 0.6), rng.pick([0xff6a1a, 0xff9a2a, 0xffc040]), { key: 'glow' });
  for (const p of K.scatter(40, { x0: 62, x1: 108, z0: 50, z1: 104 }, { minDist: 5, accept: (x, z) => Math.abs(z - RAV.z) > RAV.half + 3 && pathDist(x, z, TRAIL_E).d > 4 })) K.tree(rng.chance(0.5) ? 'dead' : 'pine', p.x, p.z, rr(1, 1.6));
  for (const x of [72, 84, 100]) for (const s of [-1, 1]) { const z = RAV.z + s * (RAV.half + 4); K.cand('street', x, G(x, z), z, { zone: 'barranco de las brasas', type: 'ground' }); }

  /* ================= BOSQUE DE PINOS GIGANTES (SUR) ================= */
  const SEQ = { x: -36, z: 82 };
  const inClear = (x, z) => [[-14, 66], [18, 86], [30, 58], [-56, 84], [-20, 98]].some(([cx, cz]) => Math.hypot(x - cx, z - cz) < 6);
  const giant = K.scatter(190, { x0: -108, x1: 60, z0: 44, z1: 108 }, {
    minDist: 6.5,
    accept: (x, z, h) => roadD(x, z) > 7 && riverD(x, z) > 12 && Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r + 6 && !nearStart(x, z, 14) && !inClear(x, z) && Math.hypot(x - SEQ.x, z - SEQ.z) > 9 && h < 18
      && pathDist(x, z, TRAIL_W).d > 3.5 && pathDist(x, z, TRAIL_F).d > 3.5 && pathDist(x, z, TRAIL_E).d > 3.5,
  });
  for (const p of giant) K.tree(burnAt(p.x, p.z) > 0.5 ? 'dead' : rng.chance(0.85) ? 'pine' : 'broad', p.x, p.z, rr(1.5, 2.5));
  for (const p of K.scatter(90, { x0: -104, x1: 60, z0: 44, z1: 106 }, { minDist: 4, accept: (x, z) => roadD(x, z) > 4 && riverD(x, z) > 9 && !nearStart(x, z, 9) })) K.tree('shrub', p.x, p.z, rr(0.8, 1.5));
  // troncos caídos para saltar por los senderos
  for (const [x, z, ry] of [[-22, 77, 0.4], [-44, 68, 1.2], [14, 77, -0.3], [36, 72, 1.4], [-64, 62, 0.6]]) {
    const g = G(x, z);
    K.box(x, g, z, 5.5, 0.9, 0.9, 0x6a4a2e, { tag: 'log', ry });
    pine(x, g + 0.9, z);
  }
  // claros del bosque: rescates
  for (const [cx, cz] of [[-14, 66], [18, 86], [30, 58], [-56, 84], [-20, 98]]) {
    for (let k = 0; k < 2; k++) { const x = cx + rr(-3, 3), z = cz + rr(-3, 3); K.cand('clearing', x, G(x, z), z, { zone: 'bosque de pinos gigantes', type: 'clearing' }); }
    pineG(cx, cz);
  }
  // campamento de excursionistas abandonado
  K.box(18, G(18, 86), 88.5, 2.6, 1.3, 2.6, 0x3a8ad8, { tag: 'tent' });
  K.cone(18, G(18, 86) + 1.3, 88.5, 1.9, 1.0, 0x2e6fb0);
  // La Secuoya Gigante: escalera de tablones en espiral alrededor del tronco hasta la casa del árbol
  {
    const g = G(SEQ.x, SEQ.z);
    K.cyl(SEQ.x, g - 0.5, SEQ.z, 1.9, 27, 0x7a4a2e, { solid: true, tag: 'trunk' });
    K.cyl(SEQ.x, g - 0.5, SEQ.z, 2.6, 1.6, 0x6a3a22);
    for (const [ox, oy, oz, s] of [[0, 29, 0, 6.5], [3.5, 26.5, 1.5, 4.5], [-3.5, 27, -1.5, 4.8], [1, 32, -2, 4.2], [-1.5, 25.5, 3, 4]]) K.ico(SEQ.x + ox, g + oy, SEQ.z + oz, s, s * 0.72, s, rng.pick([0x3f8a3c, 0x4a9a44, 0x2f7a34]), { key: 'flat' });
    let y = 0;
    for (let k = 0; k < 16; k++) {
      const a = k * 0.62 + 0.12, rad = 4.3; // el último tablón queda alineado con el borde de la plataforma
      y = 1.15 * (k + 1);
      const px = SEQ.x + Math.cos(a) * rad, pz = SEQ.z + Math.sin(a) * rad;
      K.box(px, g + y - 0.3, pz, 1.9, 0.3, 1.25, 0xc08850, { tag: 'plank', ry: -a });
      K.box(SEQ.x + Math.cos(a) * 2.9, g + y - 0.42, SEQ.z + Math.sin(a) * 2.9, 2.0, 0.16, 0.22, 0x6a4a2a, { solid: false, ry: -a }); // soporte clavado al tronco
      if (k % 3 === 1) pine(px, g + y, pz);
    }
    // casa del árbol en lo alto: plataforma alrededor del tronco con barandilla y bandera
    const top = g + y + 1.2;
    K.box(SEQ.x, top - 0.35, SEQ.z, 5.8, 0.35, 5.8, 0xb08050, { tag: 'deck' });
    for (const [ox, oz] of [[-2.75, -2.75], [2.75, -2.75], [-2.75, 2.75], [2.75, 2.75]]) K.cyl(SEQ.x + ox, top, SEQ.z + oz, 0.12, 1.0, 0x6a4a2a);
    for (const [ox, oz, w, d] of [[0, -2.75, 5.6, 0.1], [0, 2.75, 5.6, 0.1], [2.75, 0, 0.1, 5.6]]) K.box(SEQ.x + ox, top + 0.85, SEQ.z + oz, w, 0.1, d, 0x6a4a2a, { solid: false });
    K.box(SEQ.x + 2.2, top, SEQ.z + 2.2, 0.1, 3.2, 0.1, 0xdddddd, { solid: false });
    K.box(SEQ.x + 2.75, top + 2.6, SEQ.z + 2.2, 1.1, 0.7, 0.05, 0xd8452a, { solid: false });
    coll.push({ x: SEQ.x + 2.3, y: top + 1.0, z: SEQ.z - 0.4, kind: 'medal', secret: 'secuoya' });
    pine(SEQ.x, top, SEQ.z - 2.4); pine(SEQ.x, top, SEQ.z + 2.4);
    K.extra.seqTop = top;
  }
  // piñas por los senderos
  for (const tr of [TRAIL_W, TRAIL_F, TRAIL_E]) for (let i = 1; i < 6; i++) { const p = pathPoint(tr, i / 6); pineG(p[0], p[1]); }

  /* ================= COLINA NORTE Y BOSQUE OESTE ================= */
  for (const p of K.scatter(150, { x0: -108, x1: 60, z0: -108, z1: 12 }, {
    minDist: 4.5,
    accept: (x, z, h) => !inTown(x, z) && roadD(x, z) > 6 && !nearSafe(x, z, 16) && riverD(x, z) > 11 && h < 17 && !(x < -70 && z > -14) && !nearTunnel(x, z),
  })) K.tree(burnAt(p.x, p.z) > 0.5 ? 'dead' : rng.chance(0.7) ? 'pine' : 'broad', p.x, p.z, rr(1.1, 1.9));
  for (const p of K.scatter(24, { x0: -100, x1: 60, z0: -100, z1: 8 }, { minDist: 8, accept: (x, z) => !inTown(x, z) && roadD(x, z) > 6 && !nearSafe(x, z, 16) && !nearTunnel(x, z) })) K.rock(p.x, p.z, rr(0.8, 2), 0x8a8278);
  for (let i = 0; i < 14; i++) {
    const p = pathPoint(ROAD, 0.78 + i * 0.012);
    const x = p[0] + (i % 2 ? 7 : -7) + rr(-2, 2), z = p[1] + rr(-2, 2);
    if (nearSafe(x, z, 22)) continue;
    K.cand('street', x, G(x, z), z, { zone: 'colina norte', type: 'ground' });
  }
  for (const [x, z] of [[-40, -10], [-60, -30], [-50, -60], [-80, -50], [-30, -84], [30, -80], [44, -66]]) {
    if (G(x, z) > 14) continue;
    K.cand('clearing', x, G(x, z), z, { zone: 'bosque oeste', type: 'clearing' });
    pineG(x + 1.5, z + 1);
  }
  // camión de bomberos y helicóptero junto al campamento de rescate
  {
    const x = 12, z = -84, g = G(x, z);
    K.box(x, g, z, 2.4, 2.2, 6.5, 0xd42020, { tag: 'truck', ry: 0.3 });
    K.box(x, g + 2.2, z, 1.2, 0.3, 5, 0xdddddd, { solid: false, ry: 0.3 });
    const hx = -14, hz = -88, hg = G(hx, hz);
    K.box(hx, hg, hz, 5.5, 0.25, 5.5, 0x4a4a4a, { tag: 'pad' });
    K.box(hx, hg + 0.25, hz, 2, 1.6, 3.6, 0xf1c40f, { solid: false });
    K.box(hx, hg + 2.0, hz, 7, 0.08, 0.3, 0x2a2a2a, { solid: false });
  }

  /* ================= SEÑALES Y LUGARES SECRETOS ================= */
  placeSigns(K, [0.04, 0.2, 0.36, 0.5, 0.66, 0.82].map((t) => { const p = pathPoint(ROAD, t); return [p[0] + 5, p[1]]; }));
  const secrets = [
    { id: 'cascada', name: 'Cueva tras la Cascada', x0: CAVE.x0, x1: CAVE.x1 - 0.5, z0: CAVE.z0, z1: CAVE.z1, y0: -1, y1: 6 },
    { id: 'secuoya', name: 'Casa del Árbol de la Secuoya', x0: SEQ.x - 3.6, x1: SEQ.x + 3.6, z0: SEQ.z - 3.6, z1: SEQ.z + 3.6, y0: K.extra.seqTop - 0.6, y1: K.extra.seqTop + 4 },
    { id: 'tunel', name: 'Túnel del Minero', x0: 56, x1: 72, z0: TUN.z - TUN.half, z1: TUN.z + TUN.half, y0: 0, y1: TUN.ceil },
  ];
  const caves = [
    { x0: CAVE.x0, x1: CAVE.x1 + 0.5, z0: CAVE.z0, z1: CAVE.z1, y1: CAVE.ceil, light: [CAVE.x0 + 4, CAVE.floor + 3, 24, 0x7ad8ff] },
    { x0: TUN.x0 + 4, x1: TUN.x1 - 4, z0: TUN.z - TUN.half - 0.5, z1: TUN.z + TUN.half + 0.5, y1: TUN.ceil, light: [64, TUN.floor + 3, TUN.z, 0xffb060] },
  ];
  // troncos flotantes que van y vienen por el río (cruce este)
  const logs = [0, 1, 2].map((k) => ({ x: 88, z: 31.4 + k * 2.7, amp: 4.5, sp: 0.55 + k * 0.08, ph: k * 2.1, y: WATER_Y + 0.1 }));

  /* ================= PINTURA DEL SUELO ================= */
  const paint = () => K.paintGround({
    colorAt: (x, z, h, sl) => {
      const rd = riverD(x, z);
      if (sl > 1.4 && h > 2.5) return [128, 116, 104]; // paredes de roca (acantilado de la cascada, gargantas)
      if (rd < 11 || Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 3) return h < WATER_Y + 0.4 ? [150, 140, 104] : [214, 196, 140];
      if (Math.hypot(x - ISLAND.x, z - ISLAND.z) < 3.4) return [214, 196, 140];
      if (x > CAVE.x0 - 1 && x < CAVE.x1 && z > CAVE.z0 - 1 && z < CAVE.z1 + 1) return [104, 94, 86];
      if (Math.abs(z - RAV.z) < RAV.half + 0.6 && x > RAV.x0 && x < RAV.x1) return [70, 34, 22];
      const pd = pathDist(x, z, ROAD);
      if (pd.d < 2.9) return inTown(x, z) ? [70, 72, 78] : [168, 132, 88];
      if (inTown(x, z) && streetD(x, z) < 1.7) return [76, 78, 84];
      if (inTown(x, z) && streetD(x, z) < 2.5) return [196, 190, 176];
      for (const tr of [TRAIL_W, TRAIL_F, TRAIL_E]) if (pathDist(x, z, tr).d < 1.6) return [176, 140, 92];
      if (Math.abs(z - TUN.z) < TUN.half && x > TUN.x0 && x < TUN.x1) return [110, 92, 74];
      const burn = Math.max(burnAt(x, z), eastBurn(x, z) ? 0.55 : 0);
      if (burn > 0.5) return [48 + 10 * n2(x, z, 0.2), 40, 34];
      if (sl > 1.15 || h > 13) return [150, 136, 118];
      if (inTown(x, z)) return [98 + 20 * n2(x, z, 0.1), 172, 72];
      return [72 + 34 * n2(x, z, 0.08), 138 + 30 * n2(x, z, 0.07), 56 + 14 * n2(x, z, 0.1)];
    },
    draw: (g, px, sz) => {
      // línea central amarilla de la Skyway en el pueblo
      g.strokeStyle = 'rgba(255,214,70,.85)';
      g.lineWidth = sz(0.25);
      g.setLineDash([sz(2), sz(1.6)]);
      g.beginPath();
      for (let i = 0; i <= 120; i++) {
        const q = pathPoint(ROAD, i / 120);
        if (!inTown(q[0], q[1])) continue;
        g.lineTo(px(q[0]), px(q[1]));
      }
      g.stroke();
      g.setLineDash([]);
      // pasos de cebra
      g.fillStyle = 'rgba(240,240,240,.8)';
      for (const zs of CROSS) for (let k = -2; k <= 2; k++) g.fillRect(px(4 + k * 1.1 + 0.4 - 0.3), px(zs - 1.4), sz(0.6), sz(2.8));
      paintRefugeAndStart(g, px, sz);
    },
  });

  return makeDescriptor(K, scene, {
    id: 'campfire', look, paint, refugeStyle: 'camp', mapView: { cx: 0, cz: 0, half: 112 }, windAmp: 1.2, hazard: 'fire', allowObstacles: false,
    water: { mode: 'rise', base: WATER_Y, max: WATER_Y, pow: 1, amp: 0.7, colors: { shallow: 0x46b4d0, deep: 0x15607a, mud: 0x6aa090 } },
    extra: {
      fireSeedPool: burnCenters.concat([[84, 72], [96, 70], [40, -50], [-40, 20]]),
      roadPts: ROAD,
      noSpawn: (x, z) => Math.hypot(x - SEQ.x, z - SEQ.z) < 4,
      campfire: {
        collectibles: coll, secrets, caves, logs,
        waterfall: { x: -86.3, z0: 19.2, z1: 28.8, y0: WATER_Y - 0.2, y1: 15.0 },
        stream: { x0: -128, x1: -87, z: 24, w: 4.2, y: 15.28 },
      },
    },
  });
}
