import { CFG, terrainH, setTerrain, smoothstep, lerp, n2, pathDist, pathPoint, refugeHeight, startFlat, setStartSafe, makeDescriptor, placeSigns, paintRefugeAndStart } from './common.js';

export const seed = 9909;

const look = {
  horizon: 0x7a5a4a, zenith: 0x1e1a22, cloudLo: [0.1, 0.07, 0.07], cloudHi: [0.5, 0.36, 0.3], cover: 0.8, fog: 0x6a5048, fogD: 0.0088,
  hemi: [0xb89484, 0x3a3038, 1.0], sun: [0xf0b48a, 1.9], exposure: 0.95, lightning: true,
  precip: { color: [0.62, 0.6, 0.62], alpha: 0.4, speed: 30, len: 0.9, wind: [7, 0, 3] },
};

const RIVER = [[-6, 100], [-16, 60], [-4, 24], [-16, -10], [-4, -44], [-14, -80], [-10, -110]];
const ROAD = [[-40, 70], [-30, 40], [-34, 8], [-30, -24], [-24, -52], [10, -66], [50, -66], [62, -68]];

function valleyTerrain(x, z) {
  let h = 1.4 + 2.2 * n2(x, z, 0.03);
  h += smoothstep(38, 96, Math.abs(x + 4)) * (15 + 11 * n2(x, z, 0.03));      // paredes del valle
  h += 42 * Math.exp(-(((x - 30) ** 2 + (z + 122) ** 2) / (2 * 26 * 26)));   // volcán lejano
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
    if (!free(x, z) || terrainH(x, z) > 16 || rd(x, z) < 14) continue;
    const g = terrainH(x, z);
    K.box(x, g - 0.5, z, 4.2, 3.8, 4.2, 0x7a746a, { tag: 'rock' });
    K.cand('ledge', x, g + 3.32, z, { zone: 'riscos', needsTool: i % 2 ? 'rope' : 'piolet' });
  }
  // bosque y rocas
  for (const p of K.scatter(200, { x0: -108, x1: 108, z0: -108, z1: 108 }, { minDist: 4, accept: (x, z, h) => free(x, z) && rd(x, z) > 12 && h < 18 && pathDist(x, z, ROAD).d > 6 && cells.every((c) => Math.hypot(c.x - x, c.z - z) > 9) })) K.tree(rng.chance(0.6) ? 'pine' : rng.chance(0.5) ? 'broad' : 'dead', p.x, p.z, rr(0.85, 1.3));
  for (const p of K.scatter(40, { x0: -100, x1: 100, z0: -100, z1: 100 }, { minDist: 7, accept: (x, z) => free(x, z) && rd(x, z) > 11 })) K.rock(p.x, p.z, rr(0.9, 2.4), 0x7a706a);
  placeSigns(K, [[-36, 62], [-30, 34], [-28, 6], [-24, -24], [6, -60], [46, -66]]);

  // ---- datos para los peligros combinados ----
  const rubbleSites = cells.filter((c) => Math.hypot(c.x - T.x, c.z - T.z) > 18).map((c) => [c.x, c.z + 10]);
  const fireSeedPool = [[-58, 20], [-56, -20], [50, 20], [56, -30], [-44, -50], [40, 50], [-60, 50], [58, 0]];

  const paint = () => K.paintGround({
    colorAt: (x, z, h, sl) => {
      const r = rd(x, z);
      if (r < 6) return [118, 104, 84];
      if (h < -0.3) return [110, 100, 82];
      const pd = pathDist(x, z, ROAD);
      if (pd.d < 3) return [126, 120, 112];
      if (sl > 1.2 || h > 14) return [94, 88, 82];
      if (Math.hypot(x - 30, z + 122) < 40) return [40, 34, 32];
      return [78 + 30 * n2(x, z, 0.07), 96 + 26 * n2(x, z, 0.07), 62 + 14 * n2(x, z, 0.1)];
    },
    draw: (g, px, sz) => {
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
