import { CFG, terrainH, setTerrain, smoothstep, lerp, n2, pathDist, pathPoint, refugeHeight, startFlat, setStartSafe, makeDescriptor, placeSigns, paintRefugeAndStart } from './common.js';
import { createDesertFX } from './desert_fx.js';

export const seed = 6606;

const look = {
  horizon: 0xc89a5c, zenith: 0x7a5a3a, cloudLo: [0.3, 0.2, 0.12], cloudHi: [0.8, 0.6, 0.4], cover: 0.5, fog: 0xc0965a, fogD: 0.0105,
  hemi: [0xf0c890, 0x6a4a2a, 1.3], sun: [0xffd090, 2.5], exposure: 1.0, lightning: false, birds: false,
  precip: { color: [0.9, 0.72, 0.45], alpha: 0.4, speed: 9, len: 0.35, wind: [14, 0, 5] },
};

const OASIS = { x: 8, z: -18 };
const TRACK = [[0, 66], [-16, 40], [-4, 12], [10, -20], [30, -50], [58, -78], [70, -88]];
// ríos secos que cruzan el desierto (cauces poco hondos que se pueden atravesar); cerca del borde del mapa
// se hunden y forman un cañón profundo con paredes de roca
const RIVERS = [
  { pts: [[-120, 26], [-80, 14], [-50, -6], [-34, -34], [-44, -70], [-36, -100], [-30, -126]] },
  { pts: [[124, 40], [92, 22], [64, 30], [42, 44], [46, 78], [34, 104], [28, 128]] },
];
const canyonK = (x, z) => smoothstep(80, 106, Math.hypot(x, z)); // 0 en el centro del mapa → 1 en el borde
function riverCut(x, z) {
  let cut = 0;
  for (const R of RIVERS) {
    const d = pathDist(x, z, R.pts).d;
    if (d > 9) continue;
    const deep = 0.85 + 7 * canyonK(x, z);
    cut = Math.max(cut, deep * smoothstep(5.5 + 1.5 * canyonK(x, z), 2.2, d));
  }
  return cut;
}

function desertTerrain(x, z) {
  let h = 1.4 + 2.2 * n2(x, z, 0.02);
  // dunas alargadas
  const dune = Math.sin((x * 0.6 + z * 0.8) * 0.085 + 1.3 * n2(x, z, 0.02, 2)) * 0.5 + 0.5;
  h += Math.pow(dune, 1.6) * (3.6 + 4 * smoothstep(20, 90, Math.hypot(x, z + 10)));
  const od = Math.hypot(x - OASIS.x, z - OASIS.z);
  h = lerp(h, -0.4, smoothstep(13, 6, od));
  h += smoothstep(96, 138, Math.hypot(x, z)) * 12;
  // dunas gigantes en el anillo exterior (fuera de las rutas principales)
  const dune2 = Math.sin((x * 0.9 - z * 0.45) * 0.05 + 2.2 * n2(x + 70, z, 0.015, 2)) * 0.5 + 0.5;
  h += smoothstep(66, 98, Math.hypot(x, z)) * Math.pow(dune2, 1.5) * 9;
  // cauces secos (y el cañón en el borde)
  h -= riverCut(x, z);
  const pd = pathDist(x, z, TRACK);
  h = lerp(h, 1.2 + 0.4 * n2(x, z, 0.05), smoothstep(6, 2, pd.d) * 0.75);
  h = refugeHeight(h, x, z);
  h = startFlat(h, x, z, 0.9);
  return h;
}

export function build(K, { scene }) {
  setStartSafe({ x: 0, z: 66 }, { x: 70, z: -90, y: 7, r: 8 });
  setTerrain(desertTerrain);
  const rng = K.rng;
  const T = CFG.START, S = CFG.SAFE;
  const rr = (a, b) => a + rng.next() * (b - a);
  const free = (x, z) => Math.hypot(x - T.x, z - T.z) > 13 && Math.hypot(x - S.x, z - S.z) > 15;
  const adobe = [0xc8946a, 0xd0a070, 0xb8845a, 0xd8b088];

  // ---- pueblo de adobe ----
  const pts = [];
  for (let i = 0; i < 24; i++) {
    const x = rr(-46, 50), z = rr(-46, 42);
    if (!free(x, z) || Math.hypot(x - OASIS.x, z - OASIS.z) < 17 || pts.some((p) => Math.hypot(p[0] - x, p[1] - z) < 13) || pathDist(x, z, TRACK).d < 6) continue;
    pts.push([x, z]);
    const w = rr(7, 10), d = rr(6, 8), tall = rng.chance(0.3);
    const g = Math.max(terrainH(x, z), terrainH(x + w / 2, z), terrainH(x - w / 2, z), terrainH(x, z + d / 2), terrainH(x, z - d / 2));
    K.house({ x, z, w, d, h: tall ? 6 : 3.4, color: rng.pick(adobe), roofColor: 0xb88458, roof: rng.chance(0.25) ? 'dome' : 'flat', facing: rng.pick([0, Math.PI]), base: g, cand: 'casas de adobe' });
    K.cand('street', x + rr(-3, 3), terrainH(x, z + d / 2 + 4), z + d / 2 + 4, { zone: 'calles del pueblo', type: 'ground' });
    K.site('road', x + rr(-4, 4), z + d / 2 + 4.5, rr(0, 3.14));
  }
  // ---- oasis: palmeras, cabaña y pozo ----
  for (let i = 0; i < 12; i++) {
    const a = rr(0, Math.PI * 2), r = rr(7, 12);
    K.tree('palm', OASIS.x + Math.cos(a) * r, OASIS.z + Math.sin(a) * r, rr(0.9, 1.3));
  }
  K.cyl(OASIS.x + 2, -0.4, OASIS.z - 10, 1.4, 1.5, 0x8a7a6a, { solid: true, tag: 'well' });
  for (let k = 0; k < 6; k++) { const a = rr(0, 6.28), r = rr(8.5, 12); const x = OASIS.x + Math.cos(a) * r, z = OASIS.z + Math.sin(a) * r; K.cand('street', x, terrainH(x, z), z, { zone: 'oasis', type: 'ground' }); }
  // ---- caravana abandonada, rocas y cactus ----
  for (let i = 0; i < 6; i++) {
    const x = rr(-70, 70), z = rr(-70, 50);
    if (!free(x, z) || Math.hypot(x - OASIS.x, z - OASIS.z) < 16) continue;
    const g = terrainH(x, z);
    K.box(x, g, z, 3.2, 1.8, 2, rng.pick([0x9a3a2a, 0x2e6a8a, 0xb89a4a]), { tag: 'crate' });
    K.cand('roof', x, g + 1.82, z, { zone: 'caravana' });
  }
  for (const p of K.scatter(70, { x0: -100, x1: 100, z0: -100, z1: 100 }, { minDist: 6, accept: (x, z, h) => free(x, z) && Math.hypot(x - OASIS.x, z - OASIS.z) > 14 && pathDist(x, z, TRACK).d > 4 })) K.tree(rng.chance(0.55) ? 'cactus' : 'dead', p.x, p.z, rr(0.8, 1.4));
  for (const p of K.scatter(46, { x0: -100, x1: 100, z0: -100, z1: 100 }, { minDist: 7, accept: (x, z) => free(x, z) && Math.hypot(x - OASIS.x, z - OASIS.z) > 14 })) K.rock(p.x, p.z, rr(0.9, 2.6), rng.pick([0xa07a54, 0x8a6a48, 0x9a8a70]));
  // arcos de roca (cuerda)
  for (let i = 0; i < 6; i++) {
    const x = rr(-60, 60), z = rr(-70, 30);
    if (!free(x, z) || Math.hypot(x - OASIS.x, z - OASIS.z) < 18) continue;
    const g = terrainH(x, z);
    K.box(x, g - 0.5, z, 4.4, 4, 4.4, 0xa87a50, { tag: 'rock' });
    K.cand('ledge', x, g + 3.52, z, { zone: 'mesas de roca', needsTool: 'rope' });
  }
  // pista, dunas que tapan (viento) y candidatos
  for (let i = 0; i < 44; i++) {
    const p = pathPoint(TRACK, 0.02 + (i / 44) * 0.94);
    const x = p[0] + rr(-3, 3), z = p[1] + rr(-3, 3);
    K.cand('street', x, terrainH(x, z), z, { zone: 'pista del desierto', type: 'ground' });
    if (i % 3 === 0) K.site('road', x + rr(-1.5, 1.5), z + rr(-1.5, 1.5), rr(0, 3.14));
  }
  placeSigns(K, [[4, 60], [-10, 30], [2, 2], [16, -30], [36, -56], [56, -80]]);
  // zonas de sombra bajo palmeras para los animales (sin usar herramientas)
  const shade = [];
  for (let i = 0; i < 4; i++) shade.push([OASIS.x + rr(-6, 6), OASIS.z + rr(-6, 6), 5]);

  const paint = () => K.paintGround({
    colorAt: (x, z, h, sl) => {
      const od = Math.hypot(x - OASIS.x, z - OASIS.z);
      if (od < 9) return [80, 128, 62];
      if (od < 13) return [162, 150, 90];
      const pd = pathDist(x, z, TRACK);
      if (pd.d < 2.6) return [186, 150, 96];
      const rc = riverCut(x, z);
      if (rc > 0.55) { const v = n2(x, z, 0.25); return rc > 2.5 ? [150 + 12 * v, 104 + 10 * v, 70] : [168 + 14 * v, 132 + 10 * v, 92 + 8 * v]; } // cauce seco de barro cuarteado
      if (rc > 0.15) return [196, 156, 104];
      if (sl > 1.1) return [176, 122, 80];                                    // ladera de duna en sombra
      if (h > 6) return [178, 134, 88];
      const zone = n2(x, z, 0.022), v = n2(x, z, 0.06);                       // arena oscura y arena clara por zonas
      const dark = smoothstep(0.35, 0.65, zone);
      return [lerp(226, 192, dark) + 12 * v, lerp(190, 146, dark) + 10 * v, lerp(128, 92, dark) + 8 * n2(x, z, 0.09)];
    },
    draw: (g, px, sz) => {
      g.strokeStyle = 'rgba(150,100,60,.22)';
      g.lineWidth = sz(0.5);
      for (let i = 0; i < 120; i++) {
        const x = rr(-100, 100), z = rr(-100, 100);
        g.beginPath();
        g.moveTo(px(x), px(z));
        g.quadraticCurveTo(px(x + 8), px(z + rr(-3, 3)), px(x + 16), px(z + rr(-6, 6)));
        g.stroke();
      }
      // barro cuarteado en los cauces secos
      g.strokeStyle = 'rgba(110,74,46,.45)';
      g.lineWidth = sz(0.16);
      for (const R of RIVERS) for (let i = 0; i < 260; i++) {
        const p = pathPoint(R.pts, rr(0, 1)), x = p[0] + rr(-3.5, 3.5), z = p[1] + rr(-3.5, 3.5);
        g.beginPath(); g.moveTo(px(x), px(z));
        for (let k = 0; k < 3; k++) g.lineTo(px(x + rr(-1.4, 1.4)), px(z + rr(-1.4, 1.4)));
        g.stroke();
      }
      paintRefugeAndStart(g, px, sz, '#d8c8a0');
    },
  });

  // ---- elementos 3D del desierto (cactus, vegetación, mesas, formaciones, cañón, oasis y arena en el viento) ----
  for (const R of RIVERS) { // puntos del cañón (donde el cauce se hunde) para levantar sus paredes de roca
    R.canyon = [];
    for (let t = 0; t <= 1; t += 0.012) {
      const a = pathPoint(R.pts, t), b = pathPoint(R.pts, Math.min(1, t + 0.01));
      const k = canyonK(a[0], a[1]);
      if (k < 0.3) continue;
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      R.canyon.push([a[0], a[1], -dz / l, dx / l, 0.85 + 7 * k]);
    }
  }
  createDesertFX(scene, K, { OASIS, TRACK, RIVERS, free, pathDist, rng, houses: pts });

  return makeDescriptor(K, scene, {
    id: 'sandstorm', look, paint, refugeStyle: 'oasis', mapView: { cx: 0, cz: -15, half: 105 }, windAmp: 2.2, windCover: true, coverKind: 'sand',
    extra: {
      shadeSpots: shade,
      slowAt: (x, z) => 0.78 + 0.22 * (1 - smoothstep(4.5, 6.5, terrainH(x, z))),
    },
  });
}
