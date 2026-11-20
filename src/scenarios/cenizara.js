import * as THREE from 'three';
import { propAt } from '../props.js';
import { CFG, terrainH, setTerrain, smoothstep, lerp, n2, pathDist, pathPoint, refugeHeight, setStartSafe, makeDescriptor, placeSigns, paintRefugeAndStart } from './common.js';
import { lavaMaterial } from './cenizara_rt.js';
import { createCenizaraFX } from './cenizara_fx.js';

/* ======================================================================
   NIVEL 3 · CENIZARA — el volcán de fuego y la ciudad arrasada
   Dos grandes zonas conectadas (de sur a norte):
   · LA CIUDAD DESTRUIDA (sur, inicio): calles cubiertas de ceniza, casas en ruinas, edificios a medio derrumbar,
     coches volcados, el camión de bomberos, charcos y grietas de magma, rocas volcánicas caídas sobre las casas,
     la Torre del Reloj derrumbada (secreto) y la ciudad alta del oeste con el Templo de Lava y su cripta (secreto).
   · EL RÍO DE LAVA que corta el mapa de oeste a este: se cruza por el Puente de Lava, por las balsas de basalto
     (plataformas móviles + cuerda) o por la escalera de madera en llamas del este.
   · EL VOLCÁN (norte): tres terrazas de roca volcánica separadas por paredes de basalto (rampas, ascensores de
     piedra, cuerdas y géiseres para subir), dos ríos de lava que caen en cascada de terraza en terraza, cráteres
     secundarios, el lago de lava con la Isla de Obsidiana (secreto), la cueva volcánica del jefe (antes la Puerta de
     Kerberos) con sus soldados, el portal de rescate en la terraza alta y el gran cono en erupción con su cráter de
     lava (secreto en el borde), columnas de basalto, coladas y la columna de humo.
   · El héroe empieza en la terraza volcánica del este, de cara al volcán, tras un sobrevuelo cinematográfico.
   · Casas quemadas, gasolineras, bocas de riego, cabinas, contenedores, árboles quemados y cristales: cenizara_fx.js.
   Coleccionables y secretos con el mismo sistema que Camp Fire (piñas doradas y medallas, CampFireRuntime);
   los mecanismos del escenario (plataformas, aspas de fuego, cuerdas, géiseres, lava) los anima cenizara_rt.js.
   ====================================================================== */
export const seed = 2201;

const look = {
  horizon: 0xa24a26, zenith: 0x1a1214, cloudLo: [0.12, 0.06, 0.05], cloudHi: [0.62, 0.3, 0.18], cover: 0.55, fog: 0x3e241e, fogD: 0.0048,
  hemi: [0xff9a6a, 0x1e1412, 1.0], sun: [0xffa060, 2.2], exposure: 1.0, lightning: false, birds: false,
  precip: { color: [0.36, 0.33, 0.31], alpha: 0.34, speed: 4, len: 0.22, wind: [1.2, 0, 0.5] },
};

/* ---------- medidas del mundo ---------- */
const CITY_Y = 1.5, T1Y = 6.4, T2Y = 11.4, T3Y = 16.4;
const LAVA_Y = -0.7, RIVER_FLOOR = -1.8, RIVER_HALF = 4.6, BANK = 7.5;
const W1 = -14, W2 = -30;                                       // paredes entre terrazas (z)
const UPPER_X = -58;                                            // pared de la ciudad alta (x)
const RIVER = [[-132, 12], [-96, 16], [-64, 11], [-30, 15], [0, 14], [30, 12], [62, 16], [96, 11], [132, 14]];
const VOLC = { x: 0, z: -122, R: 54, H: 70, crater: 11, floor: 61, lake: 62.2 };
const CRATERS = [{ x: -28, z: -3, r: 5 }, { x: 32, z: -4, r: 5 }];   // cráteres secundarios (T1)
const LAKE = { x: 42, z: -22, r: 7, island: 1.8 };                    // lago de lava de la T2
const PUDDLES = [[-8, 58.4, 2.2], [36, 41.4, 2.0], [60, 78.6, 2.4], [-38, 81.6, 2.0], [22, 88, 2.2], [-24, 39.2, 1.8], [-74, 34, 2.0]];
// ríos de lava que bajan del cono y caen de terraza en terraza hasta el río
const STREAMS = [
  [[-40, -80], [-50, -62], [-54, -44], [-56, -30], [-58, -14], [-60, 2], [-61, 9]],
  [[40, -84], [52, -64], [58, -46], [60, -30], [62, -14], [64, 2], [65, 9]],
];
const CONE_STREAMS = [
  [[-5, -113], [-18, -102], [-30, -91], [-40, -80]],
  [[5, -113], [20, -102], [32, -93], [40, -84]],
];
// rampas: [x0, x1, z0, z1, y0 (en z0), y1 (en z1)]
const RAMPS = [
  [-4.2, 4.2, 42, 25, CITY_Y, T1Y],          // terraplén de la avenida hasta el Puente de Lava
  [-15, -9, -6, -20, T1Y, T2Y],              // rampa A (T1 → T2)
  [9, 15, -22, -36, T2Y, T3Y],               // rampa B (T2 → T3)
];
const UPRAMP = { x0: -60, x1: -46, z0: 37, z1: 43 };            // rampa de la ciudad alta (sube hacia el oeste)
const ROAD = [[0, 106], [0, 42], [0, 25], [0, 3], [-6, -2], [-12, -6], [-12, -20], [0, -22], [12, -22], [12, -36], [6, -46], [0, -58], [0, -66]];
const CROSS = [80, 60, 40];
const SIDE = [-30, 30];
const ARENA = { x: 0, z: -50, r: 14 };
// MIRADOR VOLCÁNICO del este (grietas, cristales y árboles quemados con vista al volcán). El héroe aparece en el
// portal de rescate, como en todos los mapas; CFG.START sigue siendo la plaza de la ciudad (orienta el refugio).
const OLD_START = { x: 0, z: 100 };
const NEW_START = { x: 86, z: -3 };
// coladas de lava nuevas que bajan del cráter por las laderas (como en la referencia del volcán)
const CONE_FLOWS = [
  [[10, -121], [24, -118], [36, -113], [45, -107]],
  [[-10, -121], [-24, -117], [-36, -112], [-45, -105]],
  [[7, -131], [18, -142], [29, -154]],
  [[-7, -131], [-18, -143], [-28, -156]],
  [[0, -134], [3, -148], [-1, -162]],
];
// SOBREVUELO INICIAL: la cámara recorre la ciudad arrasada, el río de lava, la cueva y el volcán en erupción
// y termina detrás del héroe (cada punto: [posición de la cámara, punto al que mira])
const FLYOVER = {
  dur: 16, blend: 3.2, keys: [
    [[0, 78, 178], [0, 58, -122]],
    [[-46, 34, 114], [-10, 6, 66]],
    [[-26, 17, 72], [20, 4, 54]],
    [[14, 21, 30], [6, 8, -2]],
    [[32, 30, -10], [12, 19, -36]],
    [[-36, 58, -66], [0, 72, -122]],
    [[24, 104, -82], [0, 72, -124]],
    [[36, 34, -24], [0, 40, -112]],
  ],
};

const riverZ = (x) => {
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1];
    if (x <= bx) return lerp(az, bz, Math.max(0, (x - ax) / (bx - ax)));
  }
  return RIVER[RIVER.length - 1][1];
};
const terraceY = (z) => (z < W2 ? T3Y : z < W1 ? T2Y : T1Y);
const terraceSmooth = (z) => T1Y + (T2Y - T1Y) * smoothstep(W1 + 0.6, W1 - 0.6, z) + (T3Y - T2Y) * smoothstep(W2 + 0.6, W2 - 0.6, z);
const volcR = (x, z) => Math.hypot(x - VOLC.x, z - VOLC.z);
const coneH = (r) => T3Y + VOLC.H * Math.pow(Math.max(0, 1 - r / VOLC.R), 1.35);

function cenizaraTerrain(x, z) {
  const rz = riverZ(x), dz = z - rz;
  let h;
  if (dz < -BANK) {
    // terrazas del volcán
    h = terraceSmooth(z) + 0.25 * n2(x, z, 0.09);
    for (const s of STREAMS) { const d = pathDist(x, z, s).d; if (d < 3.6) h -= 1.3 * smoothstep(3.6, 2.2, d); }
    for (const c of CRATERS) { const r = Math.hypot(x - c.x, z - c.z); h += 2.6 * Math.exp(-((r / 4.6) ** 2)) - 3.4 * Math.exp(-((r / 1.7) ** 2)); }
    const lr = Math.hypot(x - LAKE.x, z - LAKE.z);
    if (lr < LAKE.r + 1.5) h = lerp(T2Y - 1.3, h, smoothstep(LAKE.r - 0.6, LAKE.r + 1.5, lr));
    if (lr < LAKE.island + 0.8) h = lerp(T2Y + 0.35, h, smoothstep(LAKE.island, LAKE.island + 0.8, lr));
    // el gran cono y su cráter
    const r = volcR(x, z);
    if (r < VOLC.R) {
      let c = coneH(r) + 1.6 * n2(x, z, 0.08) * (1 - r / VOLC.R) + 1.2 * Math.sin(Math.atan2(z - VOLC.z, x - VOLC.x) * 9) * smoothstep(VOLC.R, 20, r) * smoothstep(8, 18, r);
      if (r < VOLC.crater + 3) c = lerp(VOLC.floor, c, smoothstep(VOLC.crater - 3, VOLC.crater + 1, r));
      for (const s of CONE_STREAMS) { const d = pathDist(x, z, s).d; if (d < 2.6) c -= 0.7 * smoothstep(2.6, 1, d); }
      for (const s of CONE_FLOWS) { const d = pathDist(x, z, s).d; if (d < 2.2) c -= 0.5 * smoothstep(2.2, 0.8, d); }
      h = Math.max(h, c);
    }
  } else if (dz > BANK) {
    // ciudad (y ciudad alta al oeste)
    h = CITY_Y + 0.3 * n2(x, z, 0.06);
    h = lerp(h, T1Y + 0.2 * n2(x, z, 0.1), smoothstep(UPPER_X + 0.6, UPPER_X - 0.6, x));
    for (const [px, pz, pr] of PUDDLES) { const d = Math.hypot(x - px, z - pz); if (d < pr + 1) h -= 0.45 * smoothstep(pr + 1, pr - 0.4, d); }
  } else {
    // cauce del río de lava
    const d = Math.abs(dz);
    const south = lerp(CITY_Y, T1Y, smoothstep(UPPER_X + 0.6, UPPER_X - 0.6, x));
    h = d < RIVER_HALF ? RIVER_FLOOR : lerp(RIVER_FLOOR, dz > 0 ? south : T1Y, smoothstep(RIVER_HALF, BANK, d));
  }
  // rampas
  for (const [x0, x1, z0, z1, y0, y1] of RAMPS) {
    const zl = Math.min(z0, z1), zh = Math.max(z0, z1);
    const m = smoothstep(x0 - 1.2, x0 + 0.2, x) * smoothstep(x1 + 1.2, x1 - 0.2, x) * smoothstep(zl - 1.2, zl + 0.2, z) * smoothstep(zh + 1.2, zh - 0.2, z);
    if (m > 0) h = lerp(h, lerp(y0, y1, Math.min(1, Math.max(0, (z - z0) / (z1 - z0)))), m);
  }
  {
    const U = UPRAMP;
    const m = smoothstep(U.x0 - 1.2, U.x0 + 0.2, x) * smoothstep(U.x1 + 1.2, U.x1 - 0.2, x) * smoothstep(U.z0 - 1.2, U.z0 + 0.2, z) * smoothstep(U.z1 + 1.2, U.z1 - 0.2, z);
    if (m > 0) h = lerp(h, lerp(CITY_Y, T1Y, Math.min(1, Math.max(0, (U.x1 - x) / (U.x1 - U.x0 - 2)))), m);
  }
  // montañas que cierran el mapa
  h += smoothstep(96, 120, Math.abs(x)) * (20 + 10 * n2(x, z, 0.03));
  h += smoothstep(104, 126, z) * (16 + 8 * n2(x, z, 0.04));
  h += smoothstep(-96, -124, z) * smoothstep(34, 60, Math.abs(x)) * (14 + 8 * n2(x, z, 0.04));
  if (Math.hypot(x - CFG.SAFE.x, z - CFG.SAFE.z) < 40) h = refugeHeight(h, x, z);
  h = lerp(h, CITY_Y, smoothstep(22, 12, Math.hypot(x - OLD_START.x, z - OLD_START.z))); // plaza de la ciudad (antiguo inicio)
  return h;
}

/* ---------- geometría de la lava (cinta a lo largo de un camino, discos) ---------- */
function ribbon(samples, half) {
  // samples: [{x, z, y}] ; la v avanza con la distancia recorrida (la lava fluye a lo largo)
  const pos = [], uv = [], idx = [];
  let acc = 0;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i], q = samples[Math.min(samples.length - 1, i + 1)], o = samples[Math.max(0, i - 1)];
    let tx = q.x - o.x, tz = q.z - o.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    if (i > 0) acc += Math.hypot(p.x - samples[i - 1].x, p.z - samples[i - 1].z, p.y - samples[i - 1].y);
    const hw = p.half ?? half;
    pos.push(p.x - tz * hw, p.y, p.z + tx * hw, p.x + tz * hw, p.y, p.z - tx * hw);
    uv.push(0, acc / 4, 1, acc / 4);
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function disc(r) {
  const g = new THREE.CircleGeometry(r, 36);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r * 0.5, uv.getY(i) * r * 0.5);
  return g;
}

export function build(K, { scene }) {
  setStartSafe({ x: 0, z: 100 }, { x: 0, z: -66, y: T3Y, r: 8 });
  setTerrain(cenizaraTerrain);
  const rng = K.rng;
  const S = CFG.SAFE, T = CFG.START;
  const rr = (a, b) => a + rng.next() * (b - a);
  const G = (x, z) => terrainH(x, z);
  const roadD = (x, z) => pathDist(x, z, ROAD).d;
  const nearStart = (x, z, r = 12) => Math.hypot(x - T.x, z - T.z) < r;
  const nearSafe = (x, z, r = 14) => Math.hypot(x - S.x, z - S.z) < r;
  const arenaFree = (x, z, pad = 0) => Math.hypot(x - ARENA.x, z - ARENA.z) > ARENA.r + pad;
  const inCity = (x, z) => z > riverZ(x) + BANK + 1;
  const onTerrace = (x, z) => z < riverZ(x) - BANK;
  const streamD = (x, z) => Math.min(...STREAMS.map((s) => pathDist(x, z, s).d));
  const coneStreamD = (x, z) => Math.min(...CONE_STREAMS.map((s) => pathDist(x, z, s).d), ...CONE_FLOWS.map((s) => pathDist(x, z, s).d));
  const nearNew = (x, z, r) => Math.hypot(x - NEW_START.x, z - NEW_START.z) < r;
  // pasillo de vista desde el inicio hasta el volcán: ahí no se ponen árboles nuevos (que no tapen la erupción)
  const inStartView = (x, z) => {
    const dx = VOLC.x - NEW_START.x, dz = VOLC.z - NEW_START.z, L = Math.hypot(dx, dz), px = x - NEW_START.x, pz = z - NEW_START.z;
    const along = (px * dx + pz * dz) / L, side = Math.abs(px * dz - pz * dx) / L;
    return along > -4 && along < 95 && side < 4 + along * 0.08;
  };
  const lavaNear = (x, z, pad = 0) => Math.abs(z - riverZ(x)) < BANK + pad || (onTerrace(x, z) && streamD(x, z) < 3.4 + pad) || coneStreamD(x, z) < 2.4 + pad
    || Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 1 + pad || CRATERS.some((c) => Math.hypot(x - c.x, z - c.z) < 2.6 + pad) || volcR(x, z) < VOLC.crater + 1 + pad
    || PUDDLES.some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < pr + 0.8 + pad);
  const free = (x, z, w = 2, d = 2, y = null) => {
    const g = y ?? G(x, z);
    return !K.solids.some((so) => so.x0 < x + w / 2 && so.x1 > x - w / 2 && so.z0 < z + d / 2 && so.z1 > z - d / 2 && so.y1 > g + 0.3 && so.y0 < g + 2.5);
  };
  const cand = (type, x, y, z, extra) => { if (!lavaNear(x, z, 0.6) || extra?.over) K.cand(type, x, y, z, extra); };
  const coll = [];
  const cone = (x, y, z) => coll.push({ x, y: y + 0.9, z, kind: 'cone' });
  const coneG = (x, z) => cone(x, G(x, z), z);
  const props = [];
  const prop = (name, h, x, y, z, ry = 0, tilt = null) => {
    const m = propAt(name, h, x, y, z, ry);
    if (!m) return null;
    if (tilt) { m.rotation.x = tilt[0]; m.rotation.z = tilt[1]; }
    scene.add(m);
    props.push(m);
    return m;
  };
  const extra = { platforms: [], blades: [], ropes: [], geysers: [], obstacles: [], fumaroles: [], flames: [], lights: [], guards: [], beacons: [], falls: [] };
  // modelos 3D nuevos del escenario devastado (con su propio generador aleatorio: el resto del mapa no se mueve)
  const fx = createCenizaraFX({ K, scene, extra, seed: 9091 });
  // árbol quemado en lugar del árbol muerto sencillo (consume los mismos números aleatorios que K.tree)
  const deadTree = (x, z, s) => { rng.range(0, 6.283); rng.range(0.85, 1.12); if (!nearNew(x, z, 8) && !inStartView(x, z)) fx.tree(x, z, s); };
  const rock = (x, z, s, c) => { if (nearNew(x, z, 8)) { for (let i = 0; i < 4; i++) rng.next(); return; } K.rock(x, z, s, c); };
  // ejecuta un trozo del diseño anterior sin dibujar nada (para consumir los mismos números aleatorios)
  const dry = (fn) => {
    const keep = { box: K.box, ico: K.ico, house: K.house, prism: K.prism, cyl: K.cyl, cone: K.cone, solid: K.solid };
    const fl = extra.flames; let cap = null;
    K.box = K.ico = K.prism = K.cyl = K.cone = K.solid = () => null;
    K.house = (o) => { cap = o; return {}; };
    extra.flames = [];
    try { fn(); } finally { Object.assign(K, keep); extra.flames = fl; }
    return cap;
  };

  /* ================= LAVA: RÍO, RÍOS DEL VOLCÁN, LAGO, CRÁTERES Y CHARCOS ================= */
  const lavaMeshes = new THREE.Group();
  scene.add(lavaMeshes);
  const LM = lavaMaterial();
  const addLava = (geo, flow = 1) => { const m = new THREE.Mesh(geo, flow === 1 ? LM.flow : LM.pool); m.renderOrder = 1; m.receiveShadow = false; lavaMeshes.add(m); return m; };
  {
    const s = [];
    for (let x = -134; x <= 134; x += 2) s.push({ x, z: riverZ(x), y: LAVA_Y });
    addLava(ribbon(s, RIVER_HALF + 0.9));
  }
  // ríos que bajan de las terrazas: la cinta sigue la terraza y cae en vertical en cada pared (cascadas de lava)
  STREAMS.forEach((path) => {
    const s = [];
    for (let t = 0; t <= 1.0001; t += 0.004) {
      const [x, z] = pathPoint(path, t);
      const rz = riverZ(x);
      let y = z < rz - BANK ? terraceY(z) - 0.55 : LAVA_Y;
      if (z > rz - BANK - 1.2 && z < rz - BANK) y = LAVA_Y; // cae al río por la pared de la orilla
      s.push({ x, z, y });
    }
    addLava(ribbon(s, 2.3));
    // cascadas: dónde cruzan las paredes (para el resplandor y las salpicaduras)
    for (let i = 1; i < s.length; i++) if (s[i].y < s[i - 1].y - 2) extra.falls.push({ x: s[i].x, z: s[i].z, y0: s[i].y, y1: s[i - 1].y });
  });
  CONE_STREAMS.forEach((path) => {
    const s = [];
    for (let t = 0; t <= 1.0001; t += 0.01) { const [x, z] = pathPoint(path, t); s.push({ x, z, y: G(x, z) + 0.12, half: 1.4 + t * 0.8 }); }
    addLava(ribbon(s, 1.6));
  });
  // coladas nuevas: nacen anchas en el borde del cráter y se van enfriando (estrechando) ladera abajo
  CONE_FLOWS.forEach((path) => {
    const s = [];
    for (let t = 0; t <= 1.0001; t += 0.01) { const [x, z] = pathPoint(path, t); s.push({ x, z, y: G(x, z) + 0.12, half: 1.5 * (1 - smoothstep(0.55, 1, t)) + 0.2 }); }
    addLava(ribbon(s, 1.4));
  });
  { const m = addLava(disc(VOLC.crater - 1.5), 0); m.position.set(VOLC.x, VOLC.lake, VOLC.z); }
  { const m = addLava(disc(LAKE.r + 0.6), 0); m.position.set(LAKE.x, T2Y - 0.45, LAKE.z); }
  for (const c of CRATERS) { const m = addLava(disc(1.9), 0); m.position.set(c.x, T1Y - 0.7, c.z); }
  for (const [px, pz, pr] of PUDDLES) { const m = addLava(disc(pr + 0.2), 0); m.position.set(px, (px < UPPER_X ? T1Y : CITY_Y) - 0.18, pz); }
  const lavaPools = [
    { x: VOLC.x, z: VOLC.z, r: VOLC.crater - 1.6, y: VOLC.lake },
    { x: LAKE.x, z: LAKE.z, r: LAKE.r, y: T2Y - 0.45, hole: LAKE.island + 0.2 },
    ...CRATERS.map((c) => ({ x: c.x, z: c.z, r: 1.8, y: T1Y - 0.7 })),
    ...PUDDLES.map(([px, pz, pr]) => ({ x: px, z: pz, r: pr, y: (px < UPPER_X ? T1Y : CITY_Y) - 0.18 })),
  ];
  extra.lights.push([VOLC.x, VOLC.lake + 4, VOLC.z, 0xff5a10, 60, 48], [0, 3, 14, 0xff6a20, 26, 30], [LAKE.x, T2Y + 2, LAKE.z, 0xff6a20, 22, 22], [-58, T1Y + 3, -14, 0xff5a10, 18, 20], [62, T1Y + 3, -14, 0xff5a10, 18, 20], [-40, 2, 14, 0xff6a20, 18, 22]);

  /* ================= PAREDES DE BASALTO ENTRE NIVELES ================= */
  const basalt = 0x2c2624, basaltL = 0x3e3430, vein = 0xff5a14;
  const wallRun = (x0, x1, zc, y0, y1, depth = 1.4) => {
    for (let x = x0; x < x1 - 0.01; x += 5) {
      const xe = Math.min(x1, x + 5), cx = (x + xe) / 2;
      K.box(cx, y0, zc, xe - x + 0.05, y1 - y0, depth, rng.chance(0.5) ? basalt : basaltL, { tag: 'wall' });
      // remate irregular y vetas de magma en la cara
      K.ico(cx + rr(-1.5, 1.5), y1 + 0.1, zc + rr(-0.3, 0.3), rr(1, 1.8), rr(0.3, 0.6), rr(0.6, 0.9), basalt);
      if (rng.chance(0.45)) K.box(cx + rr(-1.5, 1.5), y0 + rr(1, (y1 - y0) * 0.7), zc + depth / 2 + 0.02, rr(0.8, 2.2), 0.12, 0.06, vein, { key: 'glow', solid: false, ry: rr(-0.6, 0.6) });
    }
  };
  const gaps = (x0, x1, holes) => {
    const out = []; let a = x0;
    for (const [h0, h1] of holes.sort((p, q) => p[0] - q[0])) { if (h0 > a) out.push([a, h0]); a = Math.max(a, h1); }
    if (a < x1) out.push([a, x1]);
    return out;
  };
  const streamX = (zc) => STREAMS.map((s) => { for (let t = 0; t < 1; t += 0.002) { const p = pathPoint(s, t); if (p[1] > zc) return p[0]; } return null; }).filter((v) => v !== null);
  for (const [a, b] of gaps(-114, 114, [[-15.5, -8.5], ...streamX(W1).map((x) => [x - 2.6, x + 2.6])])) wallRun(a, b, W1, T1Y - 1, T2Y);
  for (const [a, b] of gaps(-114, 114, [[8.5, 15.5], ...streamX(W2).map((x) => [x - 2.6, x + 2.6])])) wallRun(a, b, W2, T2Y - 1, T3Y);
  // pared de la orilla norte del río (sigue el cauce); los ríos de lava caen al río por sus huecos
  {
    const holes = STREAMS.map((s) => s[s.length - 1][0]).map((x) => [x - 2.8, x + 2.8]);
    for (let x = -114; x < 114; x += 4) {
      if (holes.some(([a, b]) => x + 4 > a && x < b)) continue;
      const cx = x + 2, zc = riverZ(cx) - BANK + 0.2;
      K.box(cx, RIVER_FLOOR, zc, 4.3, T1Y - RIVER_FLOOR, 1.6, rng.chance(0.5) ? basalt : basaltL, { tag: 'wall' });
      if (rng.chance(0.5)) K.box(cx + rr(-1, 1), rr(0, 4), zc + 0.82, rr(1, 2.5), 0.12, 0.06, vein, { key: 'glow', solid: false, ry: rr(-0.5, 0.5) });
    }
  }
  // pared de la ciudad alta (oeste)
  for (const [a, b] of gaps(riverZ(UPPER_X) + BANK + 2, 96, [[UPRAMP.z0 - 0.5, UPRAMP.z1 + 0.5]])) {
    for (let z = a; z < b - 0.01; z += 5) {
      const ze = Math.min(b, z + 5), cz = (z + ze) / 2;
      K.box(UPPER_X, CITY_Y - 1, cz, 1.4, T1Y - CITY_Y + 1, ze - z + 0.05, 0x5a5048, { tag: 'wall' });
      K.box(UPPER_X, T1Y, cz, 1.6, 0.35, ze - z, 0x6a6058, { solid: false }); // albardilla de piedra
    }
  }

  /* ================= CIUDAD DESTRUIDA ================= */
  const wallCols = [0x6a625a, 0x5a524c, 0x7a6e62, 0x4a4442, 0x8a7a68];
  const sooty = [0x2e2826, 0x3a3230, 0x262220];
  const ash = 0x9a948e, ashD = 0x6e6864;
  const rubble = (x, z, n = 6, s = 1, y = null) => {
    const g = y ?? G(x, z);
    for (let i = 0; i < n; i++) K.ico(x + rr(-1.6, 1.6) * s, g + rr(0, 0.4), z + rr(-1.6, 1.6) * s, rr(0.3, 0.8) * s, rr(0.2, 0.5) * s, rr(0.3, 0.8) * s, rng.pick([0x5a524c, 0x4a4442, 0x6e6864, 0x3a3230]));
  };
  const ashPile = (x, z, s = 1, y = null) => K.ico(x, (y ?? G(x, z)) + 0.1, z, 1.6 * s, 0.45 * s, 1.3 * s, rng.chance(0.5) ? ash : ashD, { ry: rr(0, 3) });
  // roca volcánica caída (bomba) con grietas incandescentes
  const bomb = (x, y, z, s = 1.6, solid = true) => {
    K.ico(x, y, z, s, s * 0.85, s, 0x241e1c, { ry: rr(0, 3) });
    for (let i = 0; i < 5; i++) { const a = rr(0, 6.3); K.box(x + Math.cos(a) * s * 0.75, y + rr(-0.3, 0.5) * s, z + Math.sin(a) * s * 0.75, s * rr(0.6, 1.1), 0.08, 0.1, vein, { key: 'glow', solid: false, ry: a + 1.57 }); }
    if (solid) K.solid(x - s * 0.8, x + s * 0.8, y - s, y + s * 0.8, z - s * 0.8, z + s * 0.8, 'rock');
    extra.flames.push([x, y + s * 0.6, z, 0.6]);
  };
  // grieta de magma en el suelo (zigzag de luz)
  const crack = (x, z, len = 6, ry = 0, y = null) => {
    let cx = x, cz = z, a = ry;
    for (let i = 0; i < Math.ceil(len / 1.4); i++) {
      a += rr(-0.6, 0.6);
      const nx = cx + Math.cos(a) * 1.4, nz = cz + Math.sin(a) * 1.4;
      K.box((cx + nx) / 2, (y ?? G((cx + nx) / 2, (cz + nz) / 2)) + 0.02, (cz + nz) / 2, 1.5, 0.05, rr(0.12, 0.26), rng.chance(0.3) ? 0xffb03a : vein, { key: 'glow', solid: false, ry: -a });
      cx = nx; cz = nz;
    }
  };
  // casa en ruinas (varias formas)
  // Las casas de cajas sencillas (carcasa, derrumbada y cubierta de ceniza) se sustituyen por casas quemadas en 3D
  // (en llamas, calcinadas, cabañas hundidas y ruinas). El diseño anterior se «ejecuta en seco» solo para consumir
  // los mismos números aleatorios, así el resto del mapa queda exactamente igual.
  const HOUSE_OF = { shell: 'gutted', ash: 'burning' };
  const ruin = (x, z, face, kind, zone) => {
    const g = G(x, z), fz = face === 0 ? 1 : -1;
    if (kind === 'tall') {
      // edificio de dos plantas a medio derrumbar: una mitad entera, la otra caída en escombros
      const w = 9, d = 6.6, h = 6.4;
      K.box(x - w / 4, g, z, w / 2, h, d, rng.pick(wallCols), { tag: 'building' });
      for (let i = 0; i < 4; i++) K.box(x + w / 4 + rr(-1.6, 1.6), g, z + rr(-2, 2), rr(1, 2), rr(1.5, 4), rr(1, 2.2), rng.pick(wallCols), { tag: 'building' });
      for (const fy of [1.3, 4.2]) for (const k of [-1, 1]) K.box(x - w / 4 + k * 1.2, g + fy, z + fz * (d / 2 + 0.03), 1.0, 1.3, 0.06, 0x120e0c, { solid: false });
      rubble(x + w / 4, z + fz * 2, 8, 1.2, g);
      K.buildings.push({ x: x - w / 4, z, w: w / 2, d, h, roofY: g + h, kind: zone, solid: null });
      cand('roof', x - w / 4, g + h + 0.02, z, { zone });
      cone(x - w / 4, g + h, z);
      if (rng.chance(0.6)) bomb(x - w / 4 + rr(-1, 1), g + h + 0.9, z + rr(-1, 1), 1.3);
    } else {
      const cap = dry(() => {
        if (kind === 'shell') {
      K.house({ x, z, w: rr(7.5, 9), d: 6.2, h: rr(2.8, 3.4), color: rng.pick(sooty), roofColor: 0x1a1616, roof: 'none', facing: face, cand: zone, base: g });
      K.box(x - 1, g + 2.8, z, 7.4, 0.25, 0.3, 0x1e1816, { solid: false, ry: rr(-0.3, 0.3) });
      K.box(x + 1.2, g + 2.6, z + 0.8, 0.3, 0.25, 5, 0x1e1816, { solid: false, ry: rr(-0.3, 0.3) });
      ashPile(x + rr(-2, 2), z + rr(-1.5, 1.5), 0.8, g);
      extra.flames.push([x + rr(-2, 2), g + 0.4, z + rr(-1.5, 1.5), 1]);
        } else if (kind === 'collapsed') {
      K.house({ x, z, w: rr(7.5, 9), d: 6.2, h: rr(1.4, 1.9), color: rng.pick(wallCols), roofColor: 0x3a302a, roof: 'none', facing: face, cand: zone, base: g });
      rubble(x, z, 10, 1.4, g + 1.2);
      K.box(x + rr(-2, 2), g + 1.5, z, rr(4, 6), 0.3, 3, 0x4a3a2a, { solid: false, ry: rr(-0.5, 0.5) }); // tejado hundido
        } else {
      // casa cubierta de ceniza con el tejado gris
      K.house({ x, z, w: rr(7.5, 9), d: 6.2, h: rr(2.9, 3.3), color: rng.pick(wallCols), roofColor: 0x6a6460, roof: 'gable', facing: face, chimney: rng.chance(0.4), cand: zone, base: g });
      ashPile(x + rr(-2, 2), z, 1.1, g + 3.6);
      if (rng.chance(0.5)) bomb(x + rr(-2.5, 2.5), g + 4.4, z + rr(-1, 1), rr(1.1, 1.5), false);
        }
      });
      fx.house(x, z, face, HOUSE_OF[kind] || (fx.R.chance(0.5) ? 'shack' : 'ruin'), cap ? cap.w : 8.2, zone, g);
    }
    { const cx = x + rr(-2.5, 2.5), cz = z + fz * 5.2; cand('street', cx, G(cx, cz), cz, { zone: 'calles de Cenizara', type: 'street' }); }
  };
  const lots = [];
  for (const zs of CROSS) for (const side of [1, -1]) for (const x of [-46, -16, 16, 46, 76]) lots.push({ x, z: zs + side * 6.8, face: side > 0 ? Math.PI : 0 });
  const kinds = ['shell', 'collapsed', 'tall', 'ash'];
  const special = { '46,33.2': 'tower', '-16,46.8': 'linkA', '-16,33.2': 'linkB', '16,66.8': 'station' };
  for (const L of lots) {
    const key = `${L.x},${L.z}`;
    if (nearStart(L.x, L.z, 16)) continue;
    const sp = special[key];
    if (sp === 'tower') continue; // la Torre del Reloj se construye aparte
    if (sp === 'linkA' || sp === 'linkB') {
      // dos edificios de tejado plano unidos por una pasarela de tablones sobre la calle
      const g = G(L.x, L.z), h = 6.2;
      K.box(L.x, g, L.z, 10, h, 6.6, rng.pick(wallCols), { tag: 'building' });
      K.box(L.x, g + h, L.z, 10.4, 0.25, 7, 0x4a4442, { tag: 'roof' });
      for (const fy of [1.3, 4.1]) for (const k of [-3, 0, 3]) K.box(L.x + k, g + fy, L.z + (sp === 'linkA' ? -3.33 : 3.33), 1.1, 1.3, 0.06, 0x120e0c, { solid: false });
      K.buildings.push({ x: L.x, z: L.z, w: 10, d: 6.6, h, roofY: g + h + 0.25, kind: 'tejados conectados', solid: null });
      cand('roof', L.x + 3, g + h + 0.27, L.z, { zone: 'tejados conectados' });
      for (const k of [-3, 0, 3]) cone(L.x + k, g + h + 0.25, L.z);
      if (sp === 'linkB') {
        // escalera de cajas quemadas por la cara oeste
        K.box(L.x - 6.2, g, L.z + 1.2, 1.8, 2.2, 1.8, 0x5a3a24, { tag: 'crate' });
        K.box(L.x - 6.2, g, L.z - 0.8, 1.8, 4.3, 1.8, 0x5a3a24, { tag: 'crate' });
        cone(L.x - 6.2, g + 4.3, L.z - 0.8);
      }
      continue;
    }
    if (sp === 'station') {
      // parque de bomberos derrumbado
      const g = G(L.x, L.z);
      K.box(L.x - 3, g, L.z + 1, 6, 5.2, 6.6, 0x8a3a2a, { tag: 'building' });
      K.box(L.x + 3, g, L.z + 2.4, 4, 2.2, 3.8, 0x7a3428, { tag: 'building' });
      rubble(L.x + 3, L.z - 1.5, 9, 1.3, g);
      K.box(L.x - 3, g + 3.4, L.z - 2.3, 4.6, 0.7, 0.08, 0xe8e0d0, { solid: false }); // rótulo
      K.buildings.push({ x: L.x - 3, z: L.z + 1, w: 6, d: 6.6, h: 5.2, roofY: g + 5.2, kind: 'parque de bomberos', solid: null });
      cand('roof', L.x - 3, g + 5.22, L.z + 1, { zone: 'parque de bomberos' });
      extra.flames.push([L.x + 3, g + 2.4, L.z + 2.4, 1.2]);
      continue;
    }
    ruin(L.x, L.z, L.face, rng.pick(kinds), 'casas en ruinas');
  }
  // LA TORRE DEL RELOJ (derrumbada a medias): se sube con la cuerda; arriba, la medalla
  const TOWER = { x: 46, z: 33.2, w: 6, h: 14 };
  {
    const g = G(TOWER.x, TOWER.z), top = g + TOWER.h;
    K.box(TOWER.x, g, TOWER.z, TOWER.w, TOWER.h, TOWER.w, 0x7a6a5a, { tag: 'building' });
    K.box(TOWER.x, top, TOWER.z, TOWER.w + 0.6, 0.35, TOWER.w + 0.6, 0x5a4a3e, { tag: 'deck' });
    for (const [ox, oz, w, d] of [[0, 3.1, 6.6, 0.4], [0, -3.1, 6.6, 0.4], [3.1, 0, 0.4, 4]]) K.box(TOWER.x + ox, top + 0.35, TOWER.z + oz, w, 0.8, d, 0x6a5a4c, { tag: 'rail' });
    for (const s of [-1, 1]) K.box(TOWER.x + s * 3.05, top - 4.5, TOWER.z, 0.08, 2.4, 2.4, 0xe8dcc0, { solid: false }); // esfera del reloj
    for (const s of [-1, 1]) K.box(TOWER.x + s * 3.1, top - 3.4, TOWER.z, 0.06, 1.1, 0.12, 0x2a2420, { solid: false, ry: 0 });
    // la parte alta se ha desplomado sobre la calle
    for (let i = 0; i < 4; i++) K.box(TOWER.x + 6 + i * 2.6, g, TOWER.z + rr(-1.5, 1.5), 2.4, rr(1.2, 2.2), 2.6, 0x7a6a5a, { tag: 'rubble', ry: rr(-0.4, 0.4) });
    rubble(TOWER.x + 8, TOWER.z, 10, 1.6, g);
    K.buildings.push({ x: TOWER.x, z: TOWER.z, w: TOWER.w, d: TOWER.w, h: TOWER.h, roofY: top + 0.35, kind: 'Torre del Reloj', solid: null });
    K.cand('ledge', TOWER.x + 1, top + 0.37, TOWER.z, { zone: 'Torre del Reloj', needsTool: 'rope' });
    coll.push({ x: TOWER.x + 1.2, y: top + 1.6, z: TOWER.z + 1.2, kind: 'medal', secret: 'torre' });
    cone(TOWER.x - 1.5, top + 0.35, TOWER.z - 1.5); cone(TOWER.x - 1.5, top + 0.35, TOWER.z + 1.5);
    extra.ropes.push({ name: 'Torre del Reloj', bottom: [TOWER.x - 3.9, g, TOWER.z], top: [TOWER.x - 1.0, top + 0.35, TOWER.z], edge: [TOWER.x - 2.7, top + 0.35, TOWER.z], anchor: [TOWER.x - 3.1, top + 0.5, TOWER.z] });
    K.extra.towerTop = top;
  }
  // pasarela de tablones entre los dos edificios unidos (cruza la calle z = 40)
  {
    const y = G(-16, 40) + 6.45;
    for (let z = 36.2; z <= 43.8; z += 0.9) K.box(-16 + rr(-0.15, 0.15), y - 0.2, z, 2.4, 0.2, 0.8, rng.pick([0x8a6440, 0x7a5636, 0x6a4a2e]), { tag: 'plank' });
    for (const s of [-1.3, 1.3]) K.box(-16 + s, y, 40, 0.12, 0.9, 7.6, 0x5a3a24, { tag: 'rail' });
    for (const z of [37.5, 40, 42.5]) cone(-16, y, z);
  }
  // camión de bomberos: en la calle, junto al parque y a una casa que aún arde (cuenta la historia del incendio)
  {
    const x = 18, z = 60.4, ry = 0.14, g = G(x, z), H = 3.4;
    if (prop('camion', H, x, g - 0.02, z, ry)) {
      K.solid(x - 3.9, x + 3.9, g - 0.5, g + 2.6, z - 1.9, z + 1.9, 'truck');
      cand('roof', x + 1, g + 2.65, z, { zone: 'camión de bomberos' });
      cone(x - 1.5, g + 2.95, z);
      // manguera tendida hacia la casa en llamas y charco de agua evaporándose
      for (let i = 0; i < 7; i++) K.box(x - 3 - i * 1.2, g + 0.06, z - 2.2 - i * 0.7, 1.3, 0.12, 0.14, 0xc8b070, { solid: false, ry: -0.5 + Math.sin(i) * 0.3 });
      extra.beacons.push([x - 3.4 * Math.cos(ry) + 0.3, g + H * 0.86, z + 3.4 * Math.sin(ry) - 0.5], [x - 3.4 * Math.cos(ry) + 0.3, g + H * 0.86, z + 3.4 * Math.sin(ry) + 0.5]);
      extra.fumaroles.push([x - 10, g, z - 6.5, 0xb8b8b8]);
    }
  }
  // coches volcados (modelo de Tripo) por las calles
  const flipped = [[-22, 81.6, 0.25], [27, 79, -0.4], [-6, 61.8, 1.4], [52, 58.2, 0.15], [-38, 38.6, -0.3], [66, 41, 2.8], [8, 92, 0.5], [-44, 62, 1.9], [84, 59, 0.6]];
  for (const [x, z, ry] of flipped) {
    if (lavaNear(x, z, 0.5) || !free(x, z, 4.6, 4.6)) continue;
    const g = G(x, z);
    if (!prop('autofuego', 1.9, x, g - 0.05, z, ry)) break;
    const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry)), ex = (4.4 * c + 2.1 * s) / 2, ez = (4.4 * s + 2.1 * c) / 2;
    K.solid(x - ex, x + ex, g - 0.5, g + 1.3, z - ez, z + ez, 'car');
    cand('roof', x, g + 1.32, z, { zone: 'coches volcados' });
    extra.flames.push([x + rr(-1, 1), g + 1.2, z + rr(-0.5, 0.5), 0.8]);
  }
  // charcos de lava, grietas y rocas volcánicas por las calles
  for (const zs of CROSS) {
    crack(rr(-50, -20), zs + rr(-1.5, 1.5), rr(6, 10), rr(-0.4, 0.4));
    crack(rr(20, 50), zs + rr(-1.5, 1.5), rr(6, 10), rr(2.7, 3.5));
    // farolas: unas en pie, torcidas o caídas sobre la acera
    for (let x = -50; x <= 90; x += 14) {
      const z = zs - 3.6;
      if (lavaNear(x, z) || Math.abs(x) < 4) continue;
      if (rng.chance(0.45)) {
        K.cyl(x, CITY_Y, z, 0.1, 4.2, 0x2a2a2a);
        K.box(x, CITY_Y + 4.2, z + 0.4, 0.3, 0.16, 1.0, rng.chance(0.4) ? 0xffd080 : 0x3a3a3a, { key: rng.chance(0.4) ? 'glow' : 'flat', solid: false });
      } else {
        K.cyl(x, CITY_Y, z, 0.12, rr(0.5, 1.2), 0x2a2a2a);
        K.box(x + 2, CITY_Y + 0.12, z + rr(-0.6, 0.6), 4.0, 0.16, 0.16, 0x2a2a2a, { solid: false, ry: rr(-0.4, 0.4) });
      }
    }
    for (let i = 0; i < 4; i++) { const x = -48 + i * 34 + rr(-4, 4), z = zs + rr(-1.5, 1.5); cand('street', x, G(x, z), z, { zone: 'calles de Cenizara', type: 'street' }); }
    for (let x = -44; x <= 90; x += 11) if (Math.abs(x) > 4 && !lavaNear(x, zs)) coneG(x, zs + (x % 2 ? 1.5 : -1.5));
  }
  for (const [x, z] of [[-30, 70], [30, 50], [8, 70], [-8, 32], [70, 70], [62, 30]]) crack(x, z, rr(8, 12), rr(0, 6));
  for (const [x, z] of [[-30, 88], [30, 68], [60, 48], [72, 88], [-36, 52]]) if (free(x, z, 3, 3) && !lavaNear(x, z)) bomb(x, G(x, z) + 0.9, z, rr(1.4, 2.0));
  for (const zs of CROSS) for (let x = -52; x <= 92; x += 8) if (rng.chance(0.5) && Math.abs(x) > 5) ashPile(x + rr(-2, 2), zs + rng.pick([-3.4, 3.4]), rr(0.5, 0.9));
  // árboles quemados en las aceras y patios
  for (const p of K.scatter(70, { x0: -56, x1: 96, z0: 24, z1: 100 }, {
    minDist: 5, accept: (x, z) => !lavaNear(x, z, 1) && roadD(x, z) > 4.5 && !nearStart(x, z, 10) && free(x, z, 3, 3) && !lots.some((L) => Math.abs(L.x - x) < 6.5 && Math.abs(L.z - z) < 4.5) && !CROSS.some((zs) => Math.abs(z - zs) < 3.2) && inCity(x, z),
  })) deadTree(p.x, p.z, rr(0.8, 1.3));
  // la avenida principal: candidatos, piñas y cartel de la ciudad
  for (let i = 0; i < 12; i++) { const z = 96 - i * 5, x = rr(-3, 3); if (z < 44) break; cand('street', x, G(x, z), z, { zone: 'avenida del volcán', type: 'street' }); if (i % 2) coneG(i % 4 === 1 ? 2 : -2, z); }
  // (el cartel de la ciudad —dos postes y un tablero de madera, igual que el de Camp Fire— se ha retirado: estorbaba)

  /* ================= CIUDAD ALTA: TEMPLO DE LAVA Y CRIPTA ================= */
  {
    const tx = -80, tz = 56, H = 12;
    // el templo (modelo de Tripo) mira a la ciudad (+X); su plataforma baja se sube trepando
    if (prop('templo', H, tx, T1Y - 0.15, tz, Math.PI / 2)) {
      K.solid(tx - 10, tx + 10, T1Y - 1, T1Y + 2.0, tz - 9, tz + 9, 'temple');
      K.solid(tx - 6.5, tx + 3.5, T1Y - 1, T1Y + 9.5, tz - 5.5, tz + 5.5, 'temple');
      K.buildings.push({ x: tx, z: tz, w: 20, d: 18, h: 2, roofY: T1Y + 2.0, kind: 'Templo de Lava', solid: null });
      for (const [ox, oz] of [[7.5, -7], [7.5, 7], [-8, -7.5], [-8, 7.5], [8.5, 0]]) { cone(tx + ox, T1Y + 2.0, tz + oz); }
      cand('balcony', tx + 7.5, T1Y + 2.02, tz - 4, { zone: 'Templo de Lava' });
      extra.flames.push([tx + 9, T1Y + 0.5, tz - 4, 1.4], [tx + 9, T1Y + 0.5, tz + 4, 1.4], [tx, T1Y + 9, tz, 1.6]);
      extra.lights.push([tx + 10, T1Y + 3, tz, 0xff7a2a, 16, 22]);
    }
    // braseros a los lados de la escalinata
    for (const s of [-1, 1]) { K.cyl(tx + 12, T1Y, tz + s * 5, 0.6, 1.2, 0x3a302a); K.cyl(tx + 12, T1Y + 1.2, tz + s * 5, 0.75, 0.25, 0x241e1c); extra.flames.push([tx + 12, T1Y + 1.5, tz + s * 5, 1.2]); }
    // la cripta: mausoleo de piedra al norte del templo; la entrada la tapan tablones quemados
    const C = { x0: -87, x1: -80.6, z0: 39.8, z1: 45.8, h: 3.4 };
    const cy = T1Y;
    K.box((C.x0 + C.x1) / 2, cy, C.z0, C.x1 - C.x0, C.h, 0.6, 0x6a6258, { tag: 'cave' });
    K.box((C.x0 + C.x1) / 2, cy, C.z1, C.x1 - C.x0, C.h, 0.6, 0x6a6258, { tag: 'cave' });
    K.box(C.x0, cy, (C.z0 + C.z1) / 2, 0.6, C.h, C.z1 - C.z0, 0x6a6258, { tag: 'cave' });
    K.box(C.x1, cy, C.z0 + 1.05, 0.6, C.h, 1.5, 0x6a6258, { tag: 'cave' });
    K.box(C.x1, cy, C.z1 - 1.05, 0.6, C.h, 1.5, 0x6a6258, { tag: 'cave' });
    K.box((C.x0 + C.x1) / 2, cy + C.h, (C.z0 + C.z1) / 2, C.x1 - C.x0 + 0.8, 0.5, C.z1 - C.z0 + 0.8, 0x5a5248, { tag: 'cave' });
    K.prism((C.x0 + C.x1) / 2, cy + C.h + 0.5, (C.z0 + C.z1) / 2, C.x1 - C.x0 + 0.8, 1.2, C.z1 - C.z0 + 0.8, 0x4a4238, Math.PI / 2);
    K.box(-85.6, cy, 42.8, 1.4, 0.7, 1.4, 0x8a7e72, { tag: 'altar' });
    coll.push({ x: -85.6, y: cy + 1.6, z: 42.8, kind: 'medal', secret: 'cripta' });
    for (const z of [41, 44.6]) cone(-83, cy, z);
    for (let i = 0; i < 5; i++) K.ico(rr(-86.5, -81.5), cy + rr(0.2, 1.6), rng.chance(0.5) ? 40.3 : 45.3, 0.2, rr(0.4, 0.8), 0.2, 0xff6a1a, { key: 'glow' });
    extra.obstacles.push({ kind: 'planks', x: -79.9, z: 42.8, y: cy, ry: Math.PI / 2, size: 0.95 });
    extra.crypt = C;
    // columnas rotas, casas de piedra en ruinas y árboles de lava
    for (const [x, z, h] of [[-66, 52, 3.2], [-66, 60, 1.4], [-66, 68, 4.4], [-66, 76, 2.1], [-92, 72, 2.8], [-70, 84, 3.6]]) { K.cyl(x, T1Y, z, 0.55, h, 0x8a8074, { solid: true, tag: 'column' }); K.cyl(x, T1Y + h, z, 0.7, 0.3, 0x7a7064); }
    K.box(-64, T1Y + 0.3, 64, 4.2, 0.6, 1.1, 0x8a8074, { solid: false, ry: 0.6 }); // fuste caído
    for (const [x, z] of [[-74, 82], [-90, 86], [-86, 30]]) {
      K.house({ x, z, w: 7, d: 6, h: rr(1.6, 2.6), color: 0x7a7064, roofColor: 0x3a302a, roof: 'none', facing: Math.PI / 2, cand: 'ciudad alta', base: G(x, z) });
      rubble(x + 2, z, 6, 1.1, G(x, z) + 1);
    }
    for (const [x, z, h] of [[-70, 30, 7], [-94, 46, 6.5], [-68, 90, 7.5], [-92, 62, 6], [-76, 70, 6.8]]) {
      if (prop('arbolava', h, x, G(x, z) - 0.1, z, rr(0, 6.3))) K.solid(x - 0.5, x + 0.5, G(x, z) - 1, G(x, z) + 4, z - 0.5, z + 0.5, 'tree');
    }
    for (let i = 0; i < 8; i++) { const x = rr(-94, -64), z = rr(28, 90); if (free(x, z, 2, 2) && !lavaNear(x, z)) cand(i % 2 ? 'clearing' : 'street', x, G(x, z), z, { zone: 'ciudad alta', type: i % 2 ? 'clearing' : 'ground' }); }
    for (let i = 0; i < 7; i++) coneG(UPRAMP.x1 - 1.5 - i * 2, 40 + (i % 2 ? 1.2 : -1.2));
    extra.ropes.push({ name: 'Muralla de la ciudad alta', bottom: [UPPER_X + 1.9, CITY_Y, 72], top: [UPPER_X - 3.2, T1Y, 72], edge: [UPPER_X - 1.6, T1Y, 72], anchor: [UPPER_X - 0.7, T1Y + 0.4, 72] });
    cone(UPPER_X - 3.2, T1Y, 74);
    extra.blades.push({ x: -68, z: 40, y: T1Y, len: 3.6, sp: 1.3, h: 0.95 });
  }

  /* ================= EL RÍO DE LAVA: TRES FORMAS DE CRUZARLO ================= */
  // 1 · el Puente de Lava (modelo de Tripo) en la avenida principal
  {
    const H = 10.56, base = T1Y - 0.70 * H; // el tablero del modelo está al 70 % de su altura
    if (prop('puente', H, 0, base, 14, Math.PI / 2)) {
      // tablero transitable y barandillas (el modelo mide 2,08 × 0,70 de su altura)
      K.solid(-3.1, 3.1, T1Y - 1.2, T1Y, 2.4, 25.6, 'bridge');
      for (const s of [-1, 1]) K.solid(s * 3.1 - 0.35, s * 3.1 + 0.35, T1Y, T1Y + 1.1, 3, 25, 'rail');
    } else {
      K.box(0, T1Y - 0.4, 14, 6.4, 0.4, 23, 0x3a2e2a, { tag: 'bridge' });
    }
    for (const z of [6, 10, 14, 18, 22]) cone(z % 8 ? 1.4 : -1.4, T1Y, z);
    K.cand('bridge', 1, T1Y + 0.02, 18, { zone: 'Puente de Lava' });
    K.cand('bridge', -1, T1Y + 0.02, 9, { zone: 'Puente de Lava' });
  }
  // 2 · balsas de basalto (plataformas móviles) y cuerda para subir a la terraza
  {
    const x = -40, rz = riverZ(x);
    K.box(x, CITY_Y - 3, rz + 6.9, 7, 3, 3, 0x3a3230, { tag: 'jetty' });             // embarcadero sur
    K.box(x, CITY_Y - 3, rz - 6.1, 7, 3, 1.8, 0x3a3230, { tag: 'ledge' });           // repisa norte, al pie de la pared
    for (const s of [-1, 1]) extra.platforms.push({ x: x + s * 1.6, z: rz, y: CITY_Y - 0.15, w: 2.8, d: 2.8, axis: 'z', amp: 3.9, sp: 0.55, ph: s > 0 ? 0 : Math.PI, kind: 'raft' });
    extra.ropes.push({ name: 'Pared de la orilla', bottom: [x, CITY_Y, rz - 6.1], top: [x, T1Y, rz - BANK - 3.4], edge: [x, T1Y, rz - BANK - 1.6], anchor: [x, T1Y + 0.4, rz - BANK - 0.4] });
    cone(x, CITY_Y, rz + 6.9); cone(x + 1.6, CITY_Y + 0.4, rz + 2); cone(x - 1.6, CITY_Y + 0.4, rz - 2); cone(x, CITY_Y, rz - 6.1);
  }
  // 3 · la escalera de madera en llamas del este (sube de la ciudad a la terraza sobre el río)
  {
    const x = 58, rz = riverZ(x), z0 = rz + BANK + 2.5, z1 = rz - BANK - 0.2, n = 13;
    for (let i = 0; i <= n; i++) {
      const k = i / n, z = lerp(z0, z1, k), y = lerp(CITY_Y, T1Y, Math.min(1, k * 1.12));
      K.box(x + rr(-0.1, 0.1), y - 0.25, z, 3.6, 0.25, (z0 - z1) / n + 0.1, i % 3 === 1 ? 0x2a1e18 : rng.pick([0x8a6440, 0x6a4a2e]), { tag: 'plank' });
      if (i % 2 === 0) for (const s of [-1.9, 1.9]) { K.cyl(x + s, Math.min(y, LAVA_Y) - 1, z, 0.16, y - Math.min(y, LAVA_Y) + 2, 0x3a2a1e); if (i % 4 === 0) extra.flames.push([x + s, y + 1, z, 0.9]); }
    }
    for (const s of [-1.9, 1.9]) {
      for (let i = 0; i < n; i++) { const k = (i + 0.5) / n, z = lerp(z0, z1, k), y = lerp(CITY_Y, T1Y, Math.min(1, k * 1.12)); K.box(x + s, y + 0.75, z, 0.12, 0.12, (z0 - z1) / n + 0.05, 0x4a3424, { tag: 'rail' }); }
    }
    for (let i = 1; i < n; i += 3) { const k = i / n; cone(x, lerp(CITY_Y, T1Y, Math.min(1, k * 1.12)), lerp(z0, z1, k)); }
    extra.obstacles.push({ kind: 'planks', x, z: z0 + 1.4, y: CITY_Y, ry: 0, size: 1.2 });
    extra.lights.push([x, T1Y, rz, 0xff7a2a, 14, 20]);
    K.cand('bridge', x, lerp(CITY_Y, T1Y, 0.5) + 0.02, rz, { zone: 'escalera en llamas', over: true });
  }

  /* ================= TERRAZA 1: CRÁTERES, GÉISERES Y LA TORRE CAÍDA ================= */
  const crystals = (x, z, n = 4, s = 1, y = null) => {
    for (let i = 0; i < n; i++) {
      const a = rr(0, 6.3), d = rr(0, 1.3) * s, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      fx.crystalInst({ h: rr(1.2, 2.8) * s, x: px, y: (y ?? G(px, pz)) - 0.25, z: pz, ry: rr(0, 6.3), rx: rr(-0.35, 0.35), rz: rr(-0.35, 0.35), o: 'XYZ' });
    }
    if (s >= 1) K.solid(x - 1.1 * s, x + 1.1 * s, (y ?? G(x, z)) - 1, (y ?? G(x, z)) + 1.6 * s, z - 1.1 * s, z + 1.1 * s, 'rock');
  };
  const tree = (x, z, h = 7) => { if (prop('arbolava', h, x, G(x, z) - 0.1, z, rr(0, 6.3))) K.solid(x - 0.5, x + 0.5, G(x, z) - 1, G(x, z) + 4, z - 0.5, z + 0.5, 'tree'); };
  for (const c of CRATERS) {
    for (let i = 0; i < 9; i++) { const a = i / 9 * 6.28, x = c.x + Math.cos(a) * 3.6, z = c.z + Math.sin(a) * 3.6; K.ico(x, G(x, z) + 0.3, z, rr(0.7, 1.2), rr(0.6, 1), rr(0.7, 1.2), 0x2a2220); }
    extra.fumaroles.push([c.x, T1Y - 0.4, c.z, 0x4a4442]);
    extra.lights.push([c.x, T1Y + 1.5, c.z, 0xff5a10, 10, 14]);
    coneG(c.x + 4.6, c.z); coneG(c.x - 4.6, c.z);
  }
  // torre de vigilancia derrumbada
  {
    const x = 16, z = -8, g = G(x, z);
    K.cyl(x, g - 0.2, z, 2.2, 4.6, 0x6a6258, { solid: true, tag: 'tower' });
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28; K.box(x + Math.cos(a) * 1.9, g + 4.4, z + Math.sin(a) * 1.9, 1, rr(0.3, 1.6), 1, 0x6a6258, { solid: false, ry: a }); }
    for (let i = 0; i < 3; i++) K.box(x + 4 + i * 2.4, g, z + 2 + i * 0.6, 2.2, 2.0, 2.4, 0x6a6258, { tag: 'rubble', ry: 0.3 + i * 0.2 });
    cone(x, g + 4.4, z);
    cand('ledge', x, g + 4.42, z, { zone: 'torre caída' });
  }
  // paso estrecho entre rocas cerrado por un tronco quemado: detrás, un escondite con piñas
  {
    const x = 44, z = -9;
    K.box(x - 2.6, T1Y, z, 2.2, 4.2, 6, 0x2c2624, { tag: 'rock' });
    K.box(x + 2.6, T1Y, z, 2.2, 4.2, 6, 0x2c2624, { tag: 'rock' });
    K.box(x, T1Y, z - 4, 7.4, 4.2, 2, 0x2c2624, { tag: 'rock' });
    extra.obstacles.push({ kind: 'trunk', x, z: z + 3.4, y: T1Y, ry: 0, size: 0.8 });
    for (const dz of [-1.6, 0, 1.6]) cone(x, T1Y, z + dz);
    crystals(x, z - 1.6, 3, 0.6, T1Y);
  }
  for (const [x, z] of [[-48, -6], [-20, 2], [8, -2], [26, 4], [52, 0], [-8, -10], [36, -11]]) if (!lavaNear(x, z, 1) && free(x, z, 3, 3)) crystals(x, z, 4, rr(0.8, 1.1));
  for (const [x, z] of [[-36, 2], [-50, -10], [22, -12], [48, 4], [-14, 4], [6, -12]]) if (!lavaNear(x, z, 1) && free(x, z, 2, 2)) tree(x, z, rr(6, 8));
  for (const p of K.scatter(40, { x0: -108, x1: 108, z0: -13, z1: 6 }, { minDist: 5, accept: (x, z) => onTerrace(x, z) && !lavaNear(x, z, 1) && roadD(x, z) > 4 && free(x, z, 2, 2) && z > -13 })) {
    if (rng.chance(0.5)) deadTree(p.x, p.z, rr(0.8, 1.2)); else rock(p.x, p.z, rr(0.8, 1.8), 0x2a2422);
  }
  for (let i = 0; i < 14; i++) { const x = rr(-100, 100), z = rr(-12, 3); if (onTerrace(x, z) && !lavaNear(x, z, 1) && free(x, z, 2, 2)) { cand(i % 3 ? 'street' : 'clearing', x, G(x, z), z, { zone: 'terraza de las cenizas', type: i % 3 ? 'ground' : 'clearing' }); if (i % 2) coneG(x + 1.4, z); } }
  for (const [x, z] of [[-60, -8], [-30, -12], [0, -6], [40, 2], [70, -6], [90, -2], [-80, -4]]) crack(x, z, rr(6, 10), rr(0, 6));
  extra.geysers.push({ x: -46, z: -11.4, y: T1Y, launch: 16.5, name: 'Géiser de la pared' }, { x: 6, z: 0, y: T1Y, launch: 11 }, { x: 70, z: -2, y: T1Y, launch: 12 }, { x: -80, z: -8, y: T1Y, launch: 12 });
  coneG(-46, -13); cone(-46, T2Y, -16.4); cone(-46, T2Y, -18);
  extra.blades.push({ x: -6, z: -2, y: T1Y, len: 3.4, sp: 1.25, h: 0.95 });
  extra.platforms.push({ x: -32, z: -11.9, y: T1Y, w: 3, d: 2.4, axis: 'y', amp: (T2Y - T1Y) / 2, sp: 0.75, ph: 0, kind: 'lift', pause: 1.2 });
  extra.ropes.push({ name: 'Pared de la terraza', bottom: [24, T1Y, -12.4], top: [24, T2Y, -17.4], edge: [24, T2Y, -15.6], anchor: [24, T2Y + 0.4, -14.6] });
  cone(24, T2Y, -18.6);

  /* ================= TERRAZA 2: LAGO DE LAVA, AGUJAS DE OBSIDIANA Y ASPAS ================= */
  {
    // Isla de Obsidiana en el centro del lago: se llega con dos plataformas que cruzan la lava
    K.cyl(LAKE.x, T2Y - 2, LAKE.z, LAKE.island, 2.4, 0x1e1a1a, { solid: true, tag: 'island' });
    crystals(LAKE.x - 0.6, LAKE.z - 0.8, 3, 0.5, T2Y + 0.4);
    coll.push({ x: LAKE.x + 0.4, y: T2Y + 1.9, z: LAKE.z + 0.4, kind: 'medal', secret: 'isla' });
    extra.platforms.push({ x: LAKE.x - 4.4, z: LAKE.z, y: T2Y - 0.05, w: 2.4, d: 2.4, axis: 'x', amp: 1.25, sp: 0.7, ph: 0, kind: 'raft' });
    extra.platforms.push({ x: LAKE.x + 4.4, z: LAKE.z, y: T2Y - 0.05, w: 2.4, d: 2.4, axis: 'x', amp: 1.25, sp: 0.7, ph: Math.PI, kind: 'raft' });
    cone(LAKE.x - 4.4, T2Y + 0.3, LAKE.z); cone(LAKE.x + 4.4, T2Y + 0.3, LAKE.z);
    for (let i = 0; i < 10; i++) { const a = i / 10 * 6.28, x = LAKE.x + Math.cos(a) * (LAKE.r + 1.6), z = LAKE.z + Math.sin(a) * (LAKE.r + 1.6); if (z < W1 - 1 && z > W2 + 1 && Math.abs(Math.sin(a)) > 0.45) K.ico(x, G(x, z) + 0.2, z, rr(0.6, 1), rr(0.4, 0.8), rr(0.6, 1), 0x241e1c); }
  }
  // agujas de obsidiana (con un montón de ramas quemadas que tapa un escondite)
  for (const [x, z, h] of [[-30, -17, 7], [-34, -19, 4.5], [-27, -21, 5.5], [-64, -24, 6], [-80, -20, 8], [26, -26, 6.5], [72, -20, 7], [88, -26, 5], [-96, -24, 6]]) {
    K.cone(x, G(x, z) - 0.5, z, rr(1.2, 1.8), h, 0x1a1616);
    K.solid(x - 0.9, x + 0.9, G(x, z) - 1, G(x, z) + h * 0.7, z - 0.9, z + 0.9, 'rock');
  }
  extra.obstacles.push({ kind: 'branch', x: -30.6, z: -19.6, y: G(-30.6, -19.6), ry: 0.8, size: 1 });
  cone(-31.4, G(-31.4, -20.6), -20.6); cone(-30.2, G(-30.2, -21.6), -21.6);
  for (const [x, z] of [[-48, -22], [-16, -26], [4, -16], [30, -16], [60, -22], [-88, -16], [96, -18]]) if (!lavaNear(x, z, 1) && free(x, z, 3, 3)) crystals(x, z, 4, rr(0.8, 1.1));
  for (const [x, z] of [[-44, -18], [-6, -27], [20, -27], [66, -27], [-74, -27]]) if (!lavaNear(x, z, 1) && free(x, z, 2, 2)) tree(x, z, rr(6, 7.5));
  for (const p of K.scatter(30, { x0: -108, x1: 108, z0: -29, z1: -15 }, { minDist: 6, accept: (x, z) => !lavaNear(x, z, 1) && roadD(x, z) > 4 && free(x, z, 2, 2) })) ashPile(p.x, p.z, rr(0.6, 1.2));
  for (let i = 0; i < 12; i++) { const x = rr(-100, 100), z = rr(-28, -16); if (!lavaNear(x, z, 1) && free(x, z, 2, 2)) { cand(i % 3 ? 'street' : 'clearing', x, G(x, z), z, { zone: 'campos de obsidiana', type: i % 3 ? 'ground' : 'clearing' }); if (i % 2) coneG(x, z + 1.4); } }
  for (const [x, z] of [[-70, -22], [-20, -18], [40, -28], [80, -16]]) crack(x, z, rr(6, 9), rr(0, 6));
  extra.geysers.push({ x: -10, z: -26, y: T2Y, launch: 11 }, { x: 54, z: -17, y: T2Y, launch: 11 }, { x: -60, z: -18, y: T2Y, launch: 12 });
  extra.blades.push({ x: 0, z: -22, y: T2Y, len: 3.6, sp: -1.35, h: 0.95 });
  extra.platforms.push({ x: -22, z: -28.6 + 0.65, y: T2Y, w: 3, d: 2.2, axis: 'y', amp: (T3Y - T2Y) / 2, sp: 0.7, ph: 1.4, kind: 'lift', pause: 1.2 });
  extra.ropes.push({ name: 'Pared alta', bottom: [-40, T2Y, -28.4], top: [-40, T3Y, -33.4], edge: [-40, T3Y, -31.6], anchor: [-40, T3Y + 0.4, -30.6] });
  cone(-40, T3Y, -34.6);
  // pasarelas de tablones sobre los ríos de lava de las terrazas
  for (const zc of [-6, -22, -42]) for (const s of STREAMS) {
    let px = null; for (let t = 0; t < 1; t += 0.002) { const p = pathPoint(s, t); if (p[1] > zc) { px = p[0]; break; } }
    if (px === null) continue;
    const y = terraceY(zc);
    for (let i = -3; i <= 3; i++) K.box(px + i * 0.95, y - 0.12, zc + rr(-0.1, 0.1), 0.85, 0.2, 2.4, rng.pick([0x8a6440, 0x6a4a2e, 0x2a1e18]), { tag: 'plank' });
    for (const s2 of [-1.15, 1.15]) K.box(px, y + 0.1, zc + s2, 6.6, 0.12, 0.12, 0x4a3424, { tag: 'rail' });
    cone(px, y, zc);
  }

  /* ================= TERRAZA 3: CUEVA VOLCÁNICA DEL JEFE, PORTAL Y PLATAFORMAS COLGANTES ================= */
  // La antigua Puerta de Kerberos (dos pilares y un arco) se sustituye por la entrada a una cueva volcánica en el mismo
  // sitio, en lo alto de la rampa B: se sigue pasando por dentro hacia la terraza alta y la arena del jefe. Los dos
  // soldados de Kerberos (los orcos) siguen guardando la entrada.
  {
    const mx = 12, mz = -33.6;
    fx.cave({ mx, mz, y0: T3Y, floorM: G(mx, mz), arena: ARENA });
    // hilo de lava que sale de la cueva y baja junto a la rampa (como en la referencia)
    {
      const s = [];
      for (const [x, z] of [[14.5, -38.4], [14.6, -36], [14.7, -33.5], [14.8, -31], [14.85, -28.5], [14.85, -25], [14.8, -22.5]]) s.push({ x, z, y: G(x, z) + 0.07, half: 0.32 });
      addLava(ribbon(s, 0.32));
    }
    for (const x of [7.4, 16.6]) {
      const z = -31.3, g = G(x, z);
      const m = prop('soldado', 2.3, x, g, z, 0);
      if (m) { extra.guards.push(m); K.solid(x - 0.45, x + 0.45, g - 0.5, g + 2.1, z - 0.4, z + 0.4, 'guard'); }
    }
  }
  // EL ARCO DE LOS ORCOS: al pie de la rampa B (terraza 2), anuncia la subida a la cueva del jefe que guardan los orcos
  fx.orcArch({ cx: 12, cz: -19.6, ry: 0, y0: T2Y });
  // el portal de rescate: anillo de obsidiana y cristales de magma alrededor (solo al norte y a los lados:
  // la arena del jefe queda despejada)
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.05 + i * 0.1125) + Math.PI, x = S.x + Math.cos(a) * 13, z = S.z + Math.sin(a) * 13;
    if (!arenaFree(x, z, 1)) continue;
    const h = rr(3.5, 6.5);
    K.box(x, G(x, z) - 0.3, z, 1.5, h, 1.5, 0x1e1a1a, { tag: 'pillar', ry: a });
    if (i % 2 === 0) { prop('cristal', rr(1.6, 2.4), x, G(x, z) + h - 0.4, z, rr(0, 6), [rr(-0.2, 0.2), rr(-0.2, 0.2)]); extra.flames.push([x, G(x, z) + h + 0.2, z, 0.7]); }
  }
  for (const [x, z] of [[-16, -76], [16, -74], [-22, -60], [22, -62]]) if (arenaFree(x, z, 2)) crystals(x, z, 5, 1.1);
  for (const [x, z] of [[-26, -70], [26, -70], [-30, -44], [32, -44]]) if (arenaFree(x, z, 2) && !lavaNear(x, z, 1)) tree(x, z, rr(7, 8.5));
  // columnas de basalto
  for (const [cx, cz] of [[-36, -50], [44, -40], [-70, -40], [80, -46]]) {
    for (let i = 0; i < 7; i++) { const x = cx + rr(-3, 3), z = cz + rr(-3, 3), h = rr(1.5, 5); if (!lavaNear(x, z, 0.5)) K.cyl(x, G(x, z) - 0.3, z, rr(0.5, 0.9), h, rng.pick([0x2a2422, 0x342c2a]), { solid: true, tag: 'column' }); }
  }
  // plataformas colgantes que suben y bajan hasta el mirador de cristal (este de la terraza alta)
  {
    const lx = 42, lz = -56, top = T3Y + 7;
    K.box(lx, T3Y - 0.5, lz, 6, top - T3Y + 0.5, 6, 0x2a2422, { tag: 'rock' });
    crystals(lx + 1.4, lz - 1.4, 4, 0.8, top);
    for (const [ox, oz] of [[-1.6, 1.4], [0.4, 1.6], [1.8, -0.2]]) cone(lx + ox, top, lz + oz);
    K.cand('ledge', lx - 1.2, top + 0.02, lz, { zone: 'mirador de cristal', needsTool: 'rope' });
    extra.platforms.push({ x: 31, z: lz, y: T3Y + 1.2, w: 2.4, d: 2.4, axis: 'y', amp: 1.2, sp: 0.8, ph: 0, kind: 'hang' });
    extra.platforms.push({ x: 35.2, z: lz, y: T3Y + 3.5, w: 2.4, d: 2.4, axis: 'y', amp: 1.3, sp: 0.8, ph: 1.6, kind: 'hang' });
    cone(31, T3Y + 2.6, lz); cone(35.2, T3Y + 5, lz);
    // vigas de las que cuelgan las cadenas
    K.box(33, T3Y + 13, lz, 8.5, 0.6, 0.6, 0x1a1616, { solid: false });
    for (const x of [28.6, 37.6]) K.box(x, T3Y - 0.2, lz + 1.6, 0.6, 13.6, 0.6, 0x1a1616, { tag: 'pillar' });
  }
  for (let i = 0; i < 16; i++) { const x = rr(-96, 96), z = rr(-90, -34); if (onTerrace(x, z) && volcR(x, z) > VOLC.R + 2 && !lavaNear(x, z, 1) && arenaFree(x, z, 1) && !nearSafe(x, z, 12) && free(x, z, 2, 2)) { cand(i % 3 ? 'street' : 'clearing', x, G(x, z), z, { zone: 'terraza del portal', type: i % 3 ? 'ground' : 'clearing' }); if (i % 2) coneG(x, z); } }
  for (const p of K.scatter(26, { x0: -100, x1: 100, z0: -96, z1: -32 }, { minDist: 7, accept: (x, z) => volcR(x, z) > VOLC.R && !lavaNear(x, z, 1) && arenaFree(x, z, 2) && !nearSafe(x, z, 16) && roadD(x, z) > 5 && free(x, z, 2, 2) })) {
    if (rng.chance(0.5)) deadTree(p.x, p.z, rr(0.9, 1.3)); else rock(p.x, p.z, rr(1, 2.2), 0x241e1c);
  }
  extra.geysers.push({ x: -50, z: -76, y: G(-50, -76), launch: 12 }, { x: 62, z: -70, y: G(62, -70), launch: 12 });
  // sendero al cráter (cerrado por tablones al principio) y el secreto del borde del cráter
  extra.obstacles.push({ kind: 'planks', x: -12, z: -74, y: G(-12, -74), ry: 0.3, size: 1.1 });
  K.box(-15.2, G(-15.2, -74) - 0.5, -74.6, 2.2, 3.2, 2.2, 0x241e1c, { tag: 'rock' });
  K.box(-8.8, G(-8.8, -73.4) - 0.5, -73.4, 2.2, 3.2, 2.2, 0x241e1c, { tag: 'rock' });
  const TRAIL = [[-12, -74], [-18, -84], [-10, -92], [-16, -100], [-6, -106], [0, -112]];
  for (let i = 1; i < 12; i++) { const p = pathPoint(TRAIL, i / 12); coneG(p[0], p[1]); }
  {
    const rx = 0, rz = VOLC.z + VOLC.crater + 1.4;
    coll.push({ x: rx, y: G(rx, rz) + 1.6, z: rz, kind: 'medal', secret: 'crater' });
    K.cand('ledge', rx + 1.5, G(rx + 1.5, rz) + 0.02, rz, { zone: 'borde del cráter', needsTool: 'rope' });
  }
  extra.fumaroles.push([-28, G(-28, -96), -96, 0x3a3634], [26, G(26, -100), -100, 0x3a3634], [-40, G(-40, -62), -62, 0x5a5654], [48, G(48, -78), -78, 0x5a5654], [-8, G(-8, -40), -40, 0x5a5654]);

  /* ================= CANDIDATOS POR LA RUTA, SEÑALES Y SITIOS ================= */
  for (let i = 0; i < 30; i++) {
    const p = pathPoint(ROAD, 0.36 + (i / 30) * 0.58);
    const x = p[0] + rr(-2.5, 2.5), z = p[1] + rr(-2.5, 2.5);
    if (nearSafe(x, z, 13)) continue;
    if (Math.abs(x) < 3.5 && z > 2 && z < 26) continue; // el puente ya tiene los suyos
    cand('street', x, G(x, z), z, { zone: 'camino del volcán', type: 'ground' });
  }
  for (let i = 0; i < 18; i++) {
    const p = pathPoint(ROAD, 0.04 + (i / 18) * 0.86);
    if (Math.abs(p[1] - 14) < 13) continue; // no sobre el puente
    K.site('road', p[0] + rr(-2, 2), p[1], rr(0, 3.14));
  }
  placeSigns(K, [[5, 96], [5, 46], [5, -2], [-17, -20], [17, -24], [20, -40]]);

  /* ================= OBJETOS DE TRIPO AÑADIDOS: HOSPITAL, AMBULANCIA, HELICÓPTERO, ÁRBOLES, TRONCOS, ROCAS Y MONTAÑAS ================= */
  // Se colocan al final y sin usar el generador aleatorio, así no cambia nada de lo que ya estaba en el mapa.
  // Cada objeto busca su sitio libre más cercano (sin lava, sin otros sólidos, lejos de caminos, arena, inicio y portal).
  {
    const TRY = [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2], [3, 3], [-3, -3], [3, -3], [-3, 3], [5, 0], [-5, 0], [0, 5], [0, -5]];
    const spot = (x, z, w, d, { pad = 1, road = 4 } = {}) => {
      for (const [ox, oz] of TRY) {
        const px = x + ox, pz = z + oz;
        if (lavaNear(px, pz, pad) || roadD(px, pz) < road + Math.max(w, d) / 2 || !arenaFree(px, pz, Math.max(w, d) / 2 + 1) || nearSafe(px, pz, 14 + Math.max(w, d) / 2) || nearStart(px, pz, 12 + Math.max(w, d) / 2) || !free(px, pz, w, d)) continue;
        return [px, pz];
      }
      return null;
    };
    // árbol seco y árbol de lava: tronco sólido
    const treeAt = (name, x, z, h, ry) => { const p = spot(x, z, 2.6, 2.6); if (!p) return; const g = G(p[0], p[1]); if (prop(name, h, p[0], g - 0.12, p[1], ry)) K.solid(p[0] - 0.55, p[0] + 0.55, g - 1, g + h * 0.6, p[1] - 0.55, p[1] + 0.55, 'tree'); };
    for (const [x, z, h, ry] of [[34, 95, 6.5, 0.4], [-34, 94, 6, 2.2], [89, 70, 7, 4.1], [-98, 38, 6.5, 1.1], [-70, 3, 6, 5.2], [82, 2, 6.5, 0.9], [-62, -58, 7, 3.3], [70, -90, 6.5, 1.7]]) treeAt('arbolseco', x, z, h, ry);
    for (const [x, z, h, ry] of [[-56, -24, 6.5, 0.7], [92, -22, 7, 2.6], [-58, -82, 7.5, 4.4], [74, -58, 7, 1.2], [-98, 82, 6.5, 5.6], [-90, -40, 7, 3.1]]) treeAt('arbolfuego', x, z, h, ry);
    // troncos cortados y caídos (bajos, se pasan por encima)
    for (const [x, z, ry] of [[8, 75, 0.3], [-88, 76, 1.9], [62, -9, 4.2], [-24, -46, 2.6], [-76, -6, 5.1]]) { const p = spot(x, z, 4.4, 4.4, { road: 3 }); if (p) prop('troncos', 1.0, p[0], G(p[0], p[1]) - 0.08, p[1], ry); }
    // rocas de lava con llamas: en las orillas del río, junto a los cráteres y en las faldas del volcán
    for (const [x, z, h, ry] of [[-20, riverZ(-20) + BANK + 3, 2.4, 0.5], [32, riverZ(32) + BANK + 3, 2.2, 2.1], [-88, riverZ(-88) + BANK + 3, 2.6, 4.0], [-28, -8.5, 2.0, 1.4], [32, 1.5, 2.2, 3.6], [-26, -92, 2.8, 0.2], [26, -94, 2.6, 5.0], [86, -30, 2.4, 2.8]]) {
      const p = spot(x, z, 2.6, 2.6, { pad: 0.4, road: 3 });
      if (!p) continue;
      const g = G(p[0], p[1]);
      if (prop('rocas', h, p[0], g - 0.15, p[1], ry)) { K.solid(p[0] - h * 0.42, p[0] + h * 0.42, g - 1, g + h * 0.38, p[1] - h * 0.42, p[1] + h * 0.42, 'rock'); extra.lights.push([p[0], g + h * 0.7, p[1], 0xff6a20, 7, 10]); }
    }
    // montañas de lava: grandes peñascos medio hundidos en las faldas del volcán (la parte de abajo queda enterrada)
    // (en los bordes del mapa, donde el terreno ya empieza a subir hacia las montañas que lo cierran)
    for (const [x, z, h, ry] of [[-100, -64, 14, 0.6], [101, -44, 15, 2.4], [-101, -2, 11, 4.2]]) {
      const p = spot(x, z, 0.7 * h, 0.7 * h, { pad: 1.5, road: 6 });
      if (!p) continue;
      let g = G(p[0], p[1]);
      for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283; g = Math.min(g, G(p[0] + Math.cos(a) * 0.8 * h, p[1] + Math.sin(a) * 0.8 * h)); } // el punto más bajo de su borde: así no queda ningún lado al aire
      const base = g - 0.5 * h, top = base + 0.69 * h;
      if (prop('montana', h, p[0], base, p[1], ry)) K.solid(p[0] - 0.62 * h, p[0] + 0.62 * h, g - 1, top, p[1] - 0.6 * h, p[1] + 0.6 * h, 'rock');
    }
    // el hospital abandonado al fondo de la ciudad, mirando a las calles; en su azotea, el helicóptero de rescate
    {
      const x = 61, z = 97, H = 9, g = G(x, z);
      if (prop('hospital', H, x, g - 0.1, z, Math.PI)) {
        const roof = g - 0.1 + 0.78 * H;
        K.solid(x - 9.4, x + 9.4, g - 1, roof, z - 0.9, z + 4.9, 'building');          // bloque principal (detrás)
        for (const sx of [-8.6, 8.6]) K.solid(x + sx - 0.9, x + sx + 0.9, g - 1, roof, z - 4.6, z - 0.9, 'building'); // alas delanteras
        K.buildings.push({ x, z: z + 2, w: 18.8, d: 5.8, h: roof - g, roofY: roof, kind: 'hospital abandonado', solid: null });
        if (prop('helicoptero', 3.2, x + 1, roof - 0.05, z + 2.2, Math.PI / 2)) K.solid(x - 2.5, x + 4.5, roof - 0.2, roof + 2.2, z + 0.9, z + 3.5, 'heli');
        extra.flames.push([x - 6, g + 0.4, z - 3.4, 1.0]);
        extra.fumaroles.push([x + 7, roof, z + 3, 0x6a6662]);
      }
      // ambulancia aparcada de cualquier manera delante del hospital, con las luces de emergencia encendidas
      const ax = 58, az = 87.6, ary = 2.75, ag = G(ax, az);
      if (free(ax, az, 5.4, 5.4) && prop('ambulancia', 2.5, ax, ag - 0.03, az, ary)) {
        const c = Math.abs(Math.cos(ary)), s = Math.abs(Math.sin(ary)), ex = (2.8 * c + 5.1 * s) / 2, ez = (2.8 * s + 5.1 * c) / 2;
        K.solid(ax - ex, ax + ex, ag - 0.5, ag + 2.4, az - ez, az + ez, 'car');
        cand('roof', ax, ag + 2.45, az, { zone: 'ambulancia' });
        const fx = Math.sin(ary) * 1.6, fz = Math.cos(ary) * 1.6, lx = Math.cos(ary) * 0.6, lz = -Math.sin(ary) * 0.6;
        extra.beacons.push([ax + fx + lx, ag + 2.45, az + fz + lz], [ax + fx - lx, ag + 2.45, az + fz - lz]);
      }
    }
  }

  /* ================= TRANSFORMACIÓN VISUAL: VOLCÁN, INICIO, VEGETACIÓN, CRISTALES Y CIUDAD ================= */
  // Todo con el generador propio de los modelos nuevos (fx.R): no cambia nada de lo que ya estaba colocado.
  {
    const R = fx.R;
    const collNear = (x, z, r) => coll.some((c) => Math.hypot(c.x - x, c.z - z) < r);
    const okGround = (x, z, w = 2, d = 2, pad = 1) => !lavaNear(x, z, pad) && free(x, z, w, d) && arenaFree(x, z, Math.max(w, d) / 2 + 1) && !nearSafe(x, z, 14 + Math.max(w, d) / 2) && !nearNew(x, z, 5 + Math.max(w, d) / 2) && !collNear(x, z, Math.max(w, d) / 2 + 0.6);
    // busca el sitio válido más cercano en anillos alrededor del punto pedido
    const near = (x, z, test, step = 1.5, rings = 4) => {
      if (test(x, z)) return [x, z];
      for (let k = 1; k <= rings; k++) for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283 + k, px = x + Math.cos(a) * k * step, pz = z + Math.sin(a) * k * step; if (test(px, pz)) return [px, pz]; }
      return null;
    };
    const inCave = (x, z) => x > 0 && x < 30 && z > -46 && z < -28;

    // --- EL VOLCÁN: columnas de basalto, corona del cráter, agujas y grietas de magma ---
    fx.volcano({
      V: VOLC, coneR: VOLC.R, avoid: (x, z, pad, rim = false) => {
        if (pathDist(x, z, TRAIL).d < 5 + pad) return true;
        if (Math.hypot(x - VOLC.x, z - (VOLC.z + VOLC.crater + 1.4)) < 7 + pad) return true; // sendero y secreto del borde del cráter
        if (coneStreamD(x, z) < 2.6 + pad) return true;
        if (onTerrace(x, z) && streamD(x, z) < 3.6 + pad && volcR(x, z) > VOLC.R - 8) return true;
        if (!rim && (volcR(x, z) < VOLC.crater + 5 || volcR(x, z) > VOLC.R - 3)) return true;
        return nearSafe(x, z, 22) || !arenaFree(x, z, 4);
      },
    });
    // venas de magma que se ramifican desde las coladas por las laderas
    const flows = [...CONE_STREAMS, ...CONE_FLOWS];
    for (let i = 0; i < 26; i++) {
      const path = R.pick(flows), t = R.range(0.12, 0.85);
      let [x, z] = pathPoint(path, t);
      const [x2, z2] = pathPoint(path, Math.min(1, t + 0.02));
      let a = Math.atan2(z2 - z, x2 - x) + (R.chance(0.5) ? 1 : -1) * R.range(0.5, 1.2);
      const s = [];
      for (let k = 0; k < R.int(5, 10); k++) {
        if (volcR(x, z) > VOLC.R - 2 || pathDist(x, z, TRAIL).d < 3) break;
        s.push({ x, z, y: G(x, z) + 0.09, half: 0.2 * (1 - k / 12) });
        a += R.range(-0.45, 0.45); x += Math.cos(a) * 1.3; z += Math.sin(a) * 1.3;
      }
      if (s.length > 2) addLava(ribbon(s, 0.2));
    }
    // grietas en la base del cono
    for (let i = 0; i < 18; i++) {
      const a = R.range(0, 6.283), r = VOLC.R + R.range(-5, 6), x = VOLC.x + Math.cos(a) * r, z = VOLC.z + Math.sin(a) * r;
      if (!onTerrace(x, z) || nearSafe(x, z, 18) || !arenaFree(x, z, 3) || pathDist(x, z, TRAIL).d < 4 || lavaNear(x, z, 0.5) || roadD(x, z) < 3) continue;
      fx.crackAt(x, z, R.range(5, 10), a + Math.PI / 2 + R.range(-0.5, 0.5));
    }

    // --- ZONA DE INICIO: terreno volcánico con grietas, cristales, árboles quemados, roca de lava y fumarolas ---
    {
      const NS = NEW_START, fl = Math.hypot(VOLC.x - NS.x, VOLC.z - NS.z), fw = [(VOLC.x - NS.x) / fl, (VOLC.z - NS.z) / fl], rt = [-fw[1], fw[0]];
      const P = (f, r) => [NS.x + fw[0] * f + rt[0] * r, NS.z + fw[1] * f + rt[1] * r];
      const ok = (w) => (x, z) => !lavaNear(x, z, 1) && free(x, z, w, w) && Math.hypot(x - NS.x, z - NS.z) > 4.5 && !collNear(x, z, w);
      const heading = Math.atan2(fw[1], fw[0]);
      let p;
      if ((p = near(...P(8, -6), ok(3.4), 1.2))) fx.crystalCluster(p[0], p[1], 1.7);
      if ((p = near(...P(6, 5), ok(2.4), 1.2))) fx.crystalCluster(p[0], p[1], 1.1);
      if ((p = near(...P(2, -9), ok(2.5), 1.2))) fx.tree(p[0], p[1], 1.15, 'fuego');
      if ((p = near(...P(-3, 8), ok(2.5), 1.2))) fx.tree(p[0], p[1], 1.0, 'partido');
      if ((p = near(...P(-1, -5.5), ok(2.5), 1.2))) fx.tree(p[0], p[1], 1.0, 'caido');
      if ((p = near(...P(-2, 11), ok(3), 1.2))) fx.lavaRock(p[0], p[1], 2.4);
      for (const s of [-1, 1]) { const [x, z] = P(3, s * 2.2); fx.crackAt(x, z, R.range(6, 9), heading + s * 0.2); }
      { const [x, z] = P(11, -2); fx.crackAt(x, z, 7, heading - 0.6); }
      { const [x, z] = P(5, -3.5); extra.fumaroles.push([x, G(x, z), z, 0x5a5654]); }
      { const [x, z] = P(1, 7); extra.fumaroles.push([x, G(x, z), z, 0x3a3634]); }
      { const [x, z] = P(4, 0); extra.lights.push([x, G(x, z) + 2.5, z, 0xff6a20, 10, 16]); }
    }

    // --- MÁS VEGETACIÓN QUEMADA (árboles secos, en brasas, caídos, partidos y tocones) ---
    {
      const NT = Math.round(75 * K.density);
      for (let i = 0, n = 0; i < NT * 10 && n < NT; i++) {
        const city = i % 3 === 0;
        const x = city ? R.range(-56, 96) : R.range(-104, 104), z = city ? R.range(24, 100) : R.range(-96, 4);
        if (city) { if (!inCity(x, z) || roadD(x, z) < 4.5 || CROSS.some((zs) => Math.abs(z - zs) < 3.2) || lots.some((L) => Math.abs(L.x - x) < 6.5 && Math.abs(L.z - z) < 4.5) || nearStart(x, z, 10)) continue; }
        else if (!onTerrace(x, z) || volcR(x, z) < VOLC.R + 1 || roadD(x, z) < 4 || inCave(x, z)) continue;
        if (!okGround(x, z, 2.6, 2.6) || fx.treeNear(x, z, 4) || inStartView(x, z)) continue;
        fx.tree(x, z, R.range(0.85, 1.3));
        n++;
      }
    }

    // --- MÁS CRISTALES DE MAGMA: junto a la cueva, los ríos de lava, el pie del volcán, el inicio y la ciudad ---
    {
      const CR = [];
      const crys = (x, z, s) => {
        if (K.mobile && R.next() < 0.45) return; // en el móvil, menos grupos sueltos (rendimiento)
        const p = near(x, z, (px, pz) => okGround(px, pz, 2.4 * s, 2.4 * s) && !inCave(px, pz) && roadD(px, pz) > 2.5 && !CR.some(([cx, cz]) => Math.hypot(cx - px, cz - pz) < 5));
        if (p) { fx.crystalCluster(p[0], p[1], s); CR.push(p); }
      };
      for (const [x, z, s] of [[2.6, -31.9, 1.1], [28.6, -35.5, 1.6], [28.2, -42, 1.2]]) if (!lavaNear(x, z, 0.5) && free(x, z, 2 * s, 2 * s) && arenaFree(x, z, 2 * s)) { fx.crystalCluster(x, z, s); CR.push([x, z]); }
      for (const path of STREAMS) for (let t = 0.12; t < 0.95; t += 0.1) {
        if (R.chance(0.35)) continue;
        const [x, z] = pathPoint(path, t), [x2, z2] = pathPoint(path, t + 0.01), dx = x2 - x, dz = z2 - z, l = Math.hypot(dx, dz) || 1, side = R.chance(0.5) ? 1 : -1, off = R.range(5.5, 8);
        crys(x - dz / l * off * side, z + dx / l * off * side, R.range(0.8, 1.5));
      }
      for (let i = 0; i < 16; i++) { const a = R.range(Math.PI * 0.05, Math.PI * 0.95), r = VOLC.R + R.range(2, 9); crys(VOLC.x + Math.cos(a) * r, VOLC.z + Math.sin(a) * r, R.range(1.2, 2.2)); }
      for (const [x, z] of [[-30, 70], [30, 50], [8, 70], [-8, 32], [70, 70], [62, 30]]) crys(x + R.range(-4, 4), z + R.range(-4, 4), R.range(0.6, 0.9));
      for (let i = 0; i < 12; i++) crys(R.range(-100, 100), R.range(-28, 2), R.range(0.7, 1.3));
    }

    // --- ROCAS VOLCÁNICAS (según la imagen de referencia): bloques, grupos y agujas con grietas de magma ---
    {
      const R2 = fx.R2;
      const KIND = ['boulder', 'cluster', 'cluster', 'spire', 'boulder'];
      const placeRock = (x, z, s, kind) => { const p = near(x, z, (px, pz) => okGround(px, pz, 3.2 * s, 3.2 * s) && !inCave(px, pz) && roadD(px, pz) > 3 && !inStartView(px, pz)); if (p) fx.lavaFormation(p[0], p[1], s, kind); };
      // junto a la cueva y al arco de los orcos, en el mirador del este y al pie del volcán
      for (const [x, z, s, k] of [[30, -30.5, 1.2, 'spire'], [-6, -33, 1.0, 'cluster'], [-4, -18, 0.9, 'boulder'], [28, -19, 1.1, 'cluster'], [96, -9, 1.3, 'spire'], [76, 3, 0.9, 'boulder'], [-30, -80, 1.6, 'spire'], [32, -82, 1.5, 'cluster']]) placeRock(x, z, s, k);
      const NR = Math.round(26 * K.density);
      for (let i = 0, n = 0; i < NR * 12 && n < NR; i++) {
        const x = R2.range(-104, 104), z = i % 4 === 0 ? R2.range(24, 98) : R2.range(-96, 4);
        if (z > 20 ? !inCity(x, z) || CROSS.some((zs) => Math.abs(z - zs) < 4) || lots.some((L) => Math.abs(L.x - x) < 7.5 && Math.abs(L.z - z) < 5.5) || nearStart(x, z, 12) : !onTerrace(x, z) || volcR(x, z) < VOLC.R - 4) continue;
        if (!okGround(x, z, 3.6, 3.6) || inCave(x, z) || roadD(x, z) < 4 || inStartView(x, z) || fx.treeNear(x, z, 3)) continue;
        fx.lavaFormation(x, z, R2.range(0.7, 1.4), R2.pick(KIND));
        n++;
      }
    }

    // --- CIUDAD: gasolineras, bocas de riego, cabinas telefónicas y contenedores en llamas ---
    {
      const stationOk = (ry) => (x, z) => { const along = Math.abs(Math.cos(ry)) > 0.5, w = along ? 14 : 11.5, d = along ? 11.5 : 14; return !lavaNear(x, z, 3) && free(x, z, w, d) && !coll.some((c) => Math.abs(c.x - x) < w / 2 + 0.5 && Math.abs(c.z - z) < d / 2 + 0.5); };
      for (const [x, z, ry, ruined] of [[-31, 70, 0, false], [61, 70, Math.PI, true]]) { const p = near(x, z, stationOk(ry), 1, 3); if (p) fx.gasStation(p[0], p[1], ry, ruined); }
      const small = (w) => (x, z) => !lavaNear(x, z, 0.6) && free(x, z, w, w) && roadD(x, z) > 2.2 && !collNear(x, z, w / 2 + 0.6);
      for (const zs of CROSS) for (const x of [-38, -24, -4, 8, 24, 38, 54, 68, 86]) {
        if (R.chance(0.35)) continue;
        const z = zs + (R.chance(0.5) ? 3.0 : -3.0);
        if (small(0.9)(x, z)) fx.hydrant(x, z, R.range(0, 6.283));
      }
      for (const [x, z] of [[-27.5, 83.4], [26.5, 63.4], [-4.5, 43.4], [57.5, 56.6], [-55, 63.4], [88, 83.4], [-34, 36.6]]) {
        const p = near(x, z, small(1.7), 0.8, 3);
        if (p) fx.booth(p[0], p[1], R.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]) + R.range(-0.2, 0.2), R.pick(['up', 'up', 'lean', 'lean', 'down']));
      }
      const DST = ['fire', 'tipped', 'fire', 'dented', 'normal', 'fire'];
      let nd = 0;
      for (const L of lots) {
        if (R.chance(0.4)) continue;
        const side = R.chance(0.5) ? 1 : -1, fz = L.face === 0 ? 1 : -1;
        const x = L.x + side * R.range(6.4, 7.4), z = L.z + fz * R.range(-1.2, 1.2);
        if (lavaNear(x, z, 0.6) || !free(x, z, 2.4, 1.9) || roadD(x, z) < 3 || collNear(x, z, 1.8)) continue;
        fx.dumpster(x, z, Math.PI / 2 * R.int(0, 3) + R.range(-0.25, 0.25), DST[nd++ % DST.length]);
        if (R.chance(0.6)) { const bx = x + R.range(-1.2, 1.2), bz = z + fz * R.range(1.8, 2.6); if (small(0.9)(bx, bz)) fx.bin(bx, bz, R.range(0, 6.283), R.chance(0.35)); }
      }
    }
    fx.finalize({ free });
  }

  /* ================= PINTURA DEL SUELO ================= */
  const paint = () => K.paintGround({
    colorAt: (x, z, h, sl) => {
      const rz = riverZ(x), dz = z - rz;
      if (Math.abs(dz) < RIVER_HALF + 0.6) return [60, 18, 8];
      const lr = Math.hypot(x - LAKE.x, z - LAKE.z);
      if (lr < LAKE.r + 0.4 && lr > LAKE.island) return [60, 18, 8];
      const sd = onTerrace(x, z) ? streamD(x, z) : 99, cd = coneStreamD(x, z);
      if (sd < 2.4 || cd < 1.8) return [60, 18, 8];
      const glow = Math.min(sd - 2.4, cd - 1.8, Math.abs(dz) - RIVER_HALF - 0.6, lr - LAKE.r - 0.4);
      const scorch = glow < 2.5 ? (2.5 - glow) / 2.5 : 0;
      const pd = pathDist(x, z, ROAD).d;
      const r = volcR(x, z);
      let c;
      if (pd < 2.8) c = inCity(x, z) ? [64, 62, 62] : [74, 62, 54];
      else if (inCity(x, z)) {
        if (x < UPPER_X) c = [120 + 14 * n2(x, z, 0.2), 110, 98];
        else if (CROSS.some((zs) => Math.abs(z - zs) < 2.4) || SIDE.some((xs) => Math.abs(x - xs) < 2.2)) c = [74, 72, 72];
        else { const a = n2(x, z, 0.12); c = [118 + 40 * a, 114 + 38 * a, 110 + 36 * a]; }
      } else if (Math.abs(dz) < BANK + 0.5) c = [30, 24, 22];
      else if (r < VOLC.R) { const k = r / VOLC.R, a = n2(x, z, 0.1); c = [30 + 22 * (1 - k) * a, 24 + 6 * a, 24]; if (r < VOLC.crater + 4) c = [86, 30, 16]; }
      else if (sl > 1.4) c = [26, 22, 22];
      else { const a = n2(x, z, 0.09); c = a > 0.64 ? [112, 106, 102] : [32 + 20 * a, 27 + 15 * a, 27 + 13 * a]; }
      if (scorch > 0) c = [c[0] + (170 - c[0]) * scorch * 0.6, c[1] + (60 - c[1]) * scorch * 0.6, c[2] + (20 - c[2]) * scorch * 0.6];
      return c;
    },
    draw: (g, px, sz) => {
      // sendero al cráter
      g.strokeStyle = 'rgba(150,120,96,.55)';
      g.lineWidth = sz(1.3);
      g.setLineDash([sz(1.6), sz(1.2)]);
      g.beginPath();
      TRAIL.forEach(([x, z], i) => (i ? g.lineTo(px(x), px(z)) : g.moveTo(px(x), px(z))));
      g.stroke();
      g.setLineDash([]);
      paintRefugeAndStart(g, px, sz, '#5a4a44');
    },
  });

  const secrets = [
    { id: 'cripta', name: 'Cripta del Templo de Lava', x0: extra.crypt.x0 + 0.3, x1: extra.crypt.x1 - 0.3, z0: extra.crypt.z0 + 0.3, z1: extra.crypt.z1 - 0.3, y0: T1Y - 1, y1: T1Y + 3 },
    { id: 'torre', name: 'Torre del Reloj', x0: TOWER.x - 3.2, x1: TOWER.x + 3.2, z0: TOWER.z - 3.2, z1: TOWER.z + 3.2, y0: K.extra.towerTop - 0.5, y1: K.extra.towerTop + 4 },
    { id: 'isla', name: 'Isla de Obsidiana', x0: LAKE.x - LAKE.island, x1: LAKE.x + LAKE.island, z0: LAKE.z - LAKE.island, z1: LAKE.z + LAKE.island, y0: T2Y - 0.5, y1: T2Y + 3 },
    { id: 'crater', name: 'Borde del Cráter', x0: -6, x1: 6, z0: VOLC.z + VOLC.crater - 1, z1: VOLC.z + VOLC.crater + 5, y0: VOLC.floor - 2, y1: 80 },
  ];
  const caves = [{ x0: extra.crypt.x0, x1: extra.crypt.x1 + 0.6, z0: extra.crypt.z0, z1: extra.crypt.z1, y1: T1Y + 3.4, light: [-84, T1Y + 2.2, 42.8, 0xff7a2a] }];
  extra.lava = { riverPts: RIVER, riverHalf: RIVER_HALF, riverY: LAVA_Y, bank: BANK, streams: STREAMS, coneStreams: CONE_STREAMS, pools: lavaPools, W1, W2, T: [T1Y, T2Y, T3Y] };
  extra.crater = { x: VOLC.x, y: VOLC.lake, z: VOLC.z, r: VOLC.crater };
  extra.mats = LM;

  extra.eruption = { x: VOLC.x, y: VOLC.lake, z: VOLC.z, r: VOLC.crater - 1.5, mobile: K.mobile };
  // el héroe aparece en el portal de rescate (game.js) mirando al volcán en erupción
  const desc = makeDescriptor(K, scene, {
    id: 'fire', look, paint, refugeStyle: 'camp', mapView: { cx: 0, cz: -8, half: 112 }, windAmp: 1.1, hazard: 'fire',
    extra: {
      bossArena: { x: ARENA.x, z: ARENA.z, r: 13 },
      startLook: { x: VOLC.x, z: VOLC.z }, startPitch: 0.02,
      flyover: FLYOVER,
      fireSeedPool: [[-46, 74], [16, 74], [46, 54], [-16, 54], [-30, 84], [76, 46], [-80, 72], [-70, 40], [-50, -4], [30, 0], [-60, -24], [70, -24], [40, -66], [-40, -64]],
      roadPts: ROAD,
      noSpawn: (x, z) => lavaNear(x, z, 0.6) || Math.hypot(x - 46, z - 33.2) < 4.2,
      campfire: { collectibles: coll, secrets, caves, logs: [] },
      cenizara: extra,
    },
  });
  return desc;
}
