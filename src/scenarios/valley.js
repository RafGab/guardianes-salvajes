import { CFG, terrainH, setTerrain, smoothstep, lerp, n2, pathDist, pathPoint, refugeHeight, startFlat, setStartSafe, makeDescriptor, placeSigns, paintRefugeAndStart } from './common.js';
import { createValleyFX } from './valley_fx.js';

// APOCALIA — EXTINCIÓN POR METEORITO: el Valle Titán tras el impacto de un meteorito gigantesco.
// Se conservan el valle, el río, la carretera, la ciudad de la ladera, la salida y el refugio (la esencia de
// Apocalia); el paisaje cambia: cráter con el núcleo fundido, cráteres menores, grietas que desprenden calor,
// restos del meteorito, rocas desplazadas por la onda expansiva, bosque calcinado y cielo de humo y ceniza.

export const seed = 9909;

const look = {
  horizon: 0xa0502a, zenith: 0x1a1214, cloudLo: [0.12, 0.07, 0.05], cloudHi: [0.55, 0.3, 0.18], cover: 0.92, fog: 0x6a3a2a, fogD: 0.0078,
  hemi: [0xc0846a, 0x2a2024, 0.95], sun: [0xff9a5a, 1.75], exposure: 0.95, lightning: true,
  precip: { color: [0.5, 0.46, 0.44], alpha: 0.22, speed: 4, len: 0.12, wind: [2.2, 0, 0.8] }, // ceniza que cae despacio (no lluvia)
};
// cráter principal (lejos de la salida, del refugio, de la carretera y del río) y cráteres menores
const CRATER = { x: 36, z: 10, r: 21, core: 6 };
const MINI = [
  { x: -62, z: -6, r: 6 }, { x: 58, z: 52, r: 7 }, { x: -58, z: -58, r: 5 }, { x: 14, z: 64, r: 5 }, { x: 54, z: -34, r: 6 },
  { x: -70, z: 34, r: 5 }, { x: 22, z: -40, r: 4.5 }, { x: 74, z: -4, r: 5 },
];
// perfil de un cráter: cuenco hundido, borde levantado y anillo de material expulsado
const DRY = 3.25; // por encima del agua más alta del valle: el fondo de los cráteres no se inunda
function craterH(h, x, z, C, depth, rim, uplift = 0) {
  const d = Math.hypot(x - C.x, z - C.z), u = d / C.r;
  h += uplift * Math.exp(-((d / (C.r * 1.35)) ** 2));                       // el terreno se abomba alrededor del impacto
  h += rim * Math.exp(-(((d - C.r) / (C.r * 0.22)) ** 2));                   // borde levantado
  h += rim * 0.3 * Math.exp(-(((d - C.r * 1.5) / (C.r * 0.35)) ** 2));       // anillo de material expulsado
  if (u < 1) h = Math.max(h - depth * (1 - u * u) - rim * 0.4 * (1 - u), Math.min(h, DRY + (uplift ? 0.4 * u : 0))); // cuenco
  return h;
}

const RIVER = [[-6, 100], [-16, 60], [-4, 24], [-16, -10], [-4, -44], [-14, -80], [-10, -110]];
const ROAD = [[-40, 70], [-30, 40], [-34, 8], [-30, -24], [-24, -52], [10, -66], [50, -66], [62, -68]];

function valleyTerrain(x, z) {
  let h = 1.4 + 2.2 * n2(x, z, 0.03);
  h += smoothstep(38, 96, Math.abs(x + 4)) * (15 + 11 * n2(x, z, 0.03));      // paredes del valle
  h += 42 * Math.exp(-(((x - 30) ** 2 + (z + 122) ** 2) / (2 * 26 * 26)));   // volcán lejano
  // montañas fracturadas: crestas rotas en las paredes del valle
  h += smoothstep(55, 90, Math.abs(x + 4)) * 6 * Math.abs(Math.sin(z * 0.11 + n2(x, z, 0.05) * 3));
  // el impacto: cráter principal y cráteres menores
  h = craterH(h, x, z, CRATER, 9, 5.5, 4.5);
  for (const m of MINI) h = craterH(h, x, z, m, 2, 1.1);
  const rd = pathDist(x, z, RIVER).d;
  h = lerp(h, -2.6, smoothstep(11, 5, rd));
  h += 0.5 * smoothstep(11, 16, rd) * smoothstep(20, 14, rd);
  const pd = pathDist(x, z, ROAD);
  h = lerp(h, Math.max(h * 0.3, 1.1), smoothstep(6, 3, pd.d) * 0.4 * smoothstep(9, 13, rd));
  h = refugeHeight(h, x, z);
  h = startFlat(h, x, z, 0.9);
  return h;
}

export function build(K, { scene }) {
  setStartSafe({ x: -40, z: 68 }, { x: 62, z: -70, y: 9.6, r: 8 });
  setTerrain(valleyTerrain);
  const rng = K.rng;
  const T = CFG.START, S = CFG.SAFE;
  const rr = (a, b) => a + rng.next() * (b - a);
  const rd = (x, z) => pathDist(x, z, RIVER).d;
  const free = (x, z) => Math.hypot(x - T.x, z - T.z) > 13 && Math.hypot(x - S.x, z - S.z) > 15;
  const wall = [0xd8c8a8, 0xc8b898, 0xe0d0b0, 0xb8a888, 0xa8b8c0];

  // ---- ciudad en la ladera este, barrio bajo en la orilla oeste ----
  const cells = [];
  for (let gx = -68; gx <= 62; gx += 17) for (let gz = -60; gz <= 60; gz += 17) {
    const x = gx + rr(-3, 3), z = gz + rr(-3, 3);
    if (!free(x, z) || rd(x, z) < 14 || Math.hypot(x - 42, z - 32) < 0 || terrainH(x, z) > 11) continue;
    if (Math.abs(x + 40) < 6 && z > 20) continue; // deja el arranque libre
    if (Math.hypot(x - CRATER.x, z - CRATER.z) < CRATER.r + 9 || MINI.some((m) => Math.hypot(x - m.x, z - m.z) < m.r + 6)) continue; // el cráter arrasó esta zona
    const w = rr(8, 11), d = rr(7, 9), tall = rng.chance(0.35);
    const g = Math.max(terrainH(x, z), terrainH(x + w / 2, z), terrainH(x - w / 2, z));
    if (rng.chance(0.25)) {
      // edificio dañado
      K.box(x - w / 4, g - 2, z, w / 2, 8, d, rng.pick(wall), { tag: 'building' });
      K.box(x + w / 4, g - 2, z, w / 2, 4.6, d, rng.pick(wall), { tag: 'building' });
      K.cand('street', x + w / 2 + 3.4, terrainH(x + w / 2 + 3.4, z), z + rr(-2, 2), { zone: 'edificios dañados', type: 'ground' });
      K.buildings.push({ x, z, w, d, h: 6, roofY: g + 6, kind: 'dañado' });
    } else {
      K.house({ x, z, w, d, h: tall ? 7 : 3.6, color: rng.pick(wall), roofColor: 0x6a4a3a, roof: tall ? 'flat' : 'gable', facing: rng.pick([0, Math.PI]), base: g, cand: 'azoteas' });
      K.cand('street', x + rr(-3, 3), terrainH(x, z + d / 2 + 5), z + d / 2 + 5, { zone: 'calles de la ciudad', type: 'ground' });
    }
    cells.push({ x, z });
    K.site('road', x + rr(-3, 3), z + d / 2 + 5.4, rr(0, 3.14));
  }
  // ---- puentes sobre el río ----
  for (const bz of [-46, 4, 46]) {
    const p = pathDist(0, bz, RIVER);
    K.bridge({ x0: p.x - 15, z0: bz, x1: p.x + 15, z1: bz, width: 6.5, deckY: 0.6, name: 'puentes' });
  }
  // orilla y lecho: candidatos de inundación
  for (let i = 0; i < 40; i++) {
    const p = pathPoint(RIVER, 0.03 + (i / 40) * 0.93);
    const x = p[0] + rr(-12, 12), z = p[1] + rr(-3, 3);
    K.cand('street', x, terrainH(x, z), z, { zone: 'orillas del río', type: 'ground' });
  }
  // carretera
  for (let i = 0; i < 40; i++) {
    const p = pathPoint(ROAD, 0.02 + (i / 40) * 0.95);
    const x = p[0] + rr(-3, 3), z = p[1] + rr(-3, 3);
    if (rd(x, z) < 13) continue;
    K.cand('street', x, terrainH(x, z), z, { zone: 'carretera del valle', type: 'ground' });
    if (i % 3 === 0) K.site('road', x + rr(-1.5, 1.5), z + rr(-1.5, 1.5), rr(0, 3.14));
  }
  // riscos y torre de agua (cuerda / piolet)
  for (let i = 0; i < 6; i++) {
    const x = (i % 2 ? 1 : -1) * rr(44, 64) - 4, z = rr(-70, 50);
    if (!free(x, z) || terrainH(x, z) > 16 || rd(x, z) < 14 || Math.hypot(x - CRATER.x, z - CRATER.z) < CRATER.r + 6) continue;
    const g = terrainH(x, z);
    K.box(x, g - 0.5, z, 4.2, 3.8, 4.2, 0x7a746a, { tag: 'rock' });
    K.cand('ledge', x, g + 3.32, z, { zone: 'riscos', needsTool: i % 2 ? 'rope' : 'piolet' });
  }
  // bosque y rocas
  const inCrater = (x, z) => Math.hypot(x - CRATER.x, z - CRATER.z) < CRATER.r + 5 || MINI.some((m) => Math.hypot(x - m.x, z - m.z) < m.r + 2);
  for (const p of K.scatter(170, { x0: -108, x1: 108, z0: -108, z1: 108 }, { minDist: 4.5, accept: (x, z, h) => free(x, z) && !inCrater(x, z) && rd(x, z) > 12 && h < 18 && pathDist(x, z, ROAD).d > 6 && cells.every((c) => Math.hypot(c.x - x, c.z - z) > 9) })) K.tree('dead', p.x, p.z, rr(0.85, 1.3)); // bosque calcinado
  for (const p of K.scatter(40, { x0: -100, x1: 100, z0: -100, z1: 100 }, { minDist: 7, accept: (x, z) => free(x, z) && rd(x, z) > 11 && !inCrater(x, z) })) K.rock(p.x, p.z, rr(0.9, 2.4), rng.chance(0.5) ? 0x3a3432 : 0x4a3e38); // rocas quemadas
  placeSigns(K, [[-36, 62], [-30, 34], [-28, 6], [-24, -24], [6, -60], [46, -66]]);

  // ---- datos para los peligros combinados ----
  const rubbleSites = cells.filter((c) => Math.hypot(c.x - T.x, c.z - T.z) > 18).map((c) => [c.x, c.z + 10]);
  const fireSeedPool = [[-58, 20], [-56, -20], [50, 20], [56, -30], [-44, -50], [40, 50], [-60, 50], [58, 0]];

  const paint = () => K.paintGround({
    colorAt: (x, z, h, sl) => {
      const r = rd(x, z);
      if (r < 6) return [92, 80, 70];                                   // cauce turbio de ceniza
      if (h < -0.3 && Math.hypot(x - CRATER.x, z - CRATER.z) > CRATER.r) return [88, 78, 68];
      const pd = pathDist(x, z, ROAD);
      if (pd.d < 3) return [98, 92, 88];                                // carretera cubierta de ceniza
      const dc = Math.hypot(x - CRATER.x, z - CRATER.z), v = n2(x, z, 0.09);
      if (dc < CRATER.core + 2.5) return [150, 52, 18];                 // roca fundida
      if (dc < CRATER.r) { const k = dc / CRATER.r; return [lerp(70, 44, k) + 18 * v, lerp(34, 36, k) + 8 * v, lerp(22, 32, k) + 6 * v]; } // fondo del cráter, ennegrecido y aún caliente
      for (const m of MINI) { const dm = Math.hypot(x - m.x, z - m.z); if (dm < m.r) return [46 + 10 * v, 38 + 6 * v, 34]; }
      if (sl > 1.2 || h > 14) return [72 + 14 * v, 62 + 10 * v, 58 + 8 * v];  // roca quemada
      if (Math.hypot(x - 30, z + 122) < 40) return [40, 34, 32];
      // estelas de la onda expansiva: rayos oscuros que salen del cráter
      const ang = Math.atan2(z - CRATER.z, x - CRATER.x), ray = Math.pow(Math.abs(Math.sin(ang * 9 + n2(x, z, 0.02) * 2)), 6) * smoothstep(CRATER.r * 4, CRATER.r, dc);
      const hot = smoothstep(0.66, 0.8, n2(x + 300, z, 0.025));          // zonas de suelo que desprende calor (rojizas)
      let c = [96 + 22 * v, 90 + 18 * v, 88 + 16 * v];                    // ceniza gris
      c = c.map((q, i) => lerp(q, [36, 30, 28][i], 0.55 * ray));
      c = c.map((q, i) => lerp(q, [122, 58, 38][i], hot * 0.6));
      return c;
    },
    draw: (g, px, sz) => {
      // salpicaduras de material expulsado alrededor del cráter
      for (let i = 0; i < 240; i++) {
        const a = rr(0, 6.28), r = CRATER.r * rr(1.05, 2.6), x = CRATER.x + Math.cos(a) * r, z = CRATER.z + Math.sin(a) * r;
        g.fillStyle = rng.chance(0.7) ? 'rgba(30,24,22,.55)' : 'rgba(110,50,26,.45)';
        g.beginPath(); g.ellipse(px(x), px(z), sz(rr(0.3, 1.4)), sz(rr(0.2, 0.7)), a, 0, 6.28); g.fill();
      }
      g.strokeStyle = 'rgba(20,16,12,.6)';
      g.lineWidth = sz(0.22);
      for (let i = 0; i < 14; i++) {
        let x = rr(-60, 60), z = rr(-70, 60);
        g.beginPath();
        g.moveTo(px(x), px(z));
        for (let k = 0; k < 6; k++) { x += rr(-6, 6); z += rr(-3, 8); g.lineTo(px(x), px(z)); }
        g.stroke();
      }
      paintRefugeAndStart(g, px, sz);
    },
  });

  // ---- consecuencias del impacto en 3D (cráter fundido, grietas con calor, restos del meteorito, onda expansiva,
  //      bosque arrasado, columna de humo y ceniza) ----
  const ROUTES = (x, z) => Math.min(pathDist(x, z, ROAD).d, rd(x, z) - 5);
  createValleyFX(scene, K, { CRATER, MINI, ROUTES, free, rng });

  return makeDescriptor(K, scene, {
    id: 'extreme', look, paint, refugeStyle: 'bunker', mapView: { cx: 0, cz: -15, half: 105 }, windAmp: 2, windCover: false,
    water: { mode: 'rise', base: 0.0, max: 2.9, pow: 1.4, amp: 1.2, surgeAt: 240, surge: 0.9 },
    extra: {
      rubbleSites, fireSeedPool,
      flowAt: (x, z, W, out) => {
        const p = pathDist(x, z, RIVER);
        out.x = 0; out.z = 0;
        if (p.d < 12 && W.waterY > 0.3) { out.z = -2.2 * smoothstep(12, 4, p.d); }
        return out;
      },
    },
  });
}
