import { CFG, setTerrain, terrainH } from '../terrain.js';
import { smoothstep, lerp, fbm, clamp } from '../utils.js';
import { buildRefuge } from '../refuge.js';

export { CFG, setTerrain, terrainH, smoothstep, lerp, fbm, clamp };

export const n2 = (x, z, s, o = 4) => fbm(x * s + 7.3, z * s + 3.1, o);
export const gauss = (x, z, cx, cz, r, h) => h * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * r * r));

// Camino como polilínea: distancia mínima y punto más cercano
export function pathDist(x, z, pts) {
  let best = 1e9, bx = 0, bz = 0, bt = 0, acc = 0, total = 0;
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segs.push(l);
    total += l;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [cx, cz] = pts[i + 1];
    const dx = cx - ax, dz = cz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    t = clamp(t, 0, 1);
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; bx = px; bz = pz; bt = (acc + segs[i] * t) / total; }
    acc += segs[i];
  }
  return { d: best, x: bx, z: bz, t: bt };
}
export function pathPoint(pts, t) {
  let total = 0;
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); segs.push(l); total += l; }
  let d = clamp(t, 0, 1) * total;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const u = segs[i] ? d / segs[i] : 0;
      return [lerp(pts[i][0], pts[i + 1][0], u), lerp(pts[i][1], pts[i + 1][1], u)];
    }
    d -= segs[i];
  }
  return pts[pts.length - 1];
}

// Meseta del refugio y zona de inicio despejada
export function refugeHeight(h, x, z) {
  const S = CFG.SAFE;
  const dd = Math.hypot(x - S.x, z - S.z);
  const pl = smoothstep(13, 8, dd);
  const g = S.y * Math.exp(-(dd * dd) / (2 * 16 * 16));
  let r = Math.max(h, lerp(g, S.y, pl));
  r = lerp(r, S.y, pl * pl);
  return r;
}
export function startFlat(h, x, z, ht, r = 14) {
  const T = CFG.START;
  const d = Math.hypot(x - T.x, z - T.z);
  const m = smoothstep(r + 8, r - 2, d);
  return lerp(h, ht, m);
}

export function setStartSafe(start, safe) {
  Object.assign(CFG.START, start);
  Object.assign(CFG.SAFE, safe);
}

// Tamaño del refugio en la textura del terreno
export function paintRefugeAndStart(g, px, sz, plazaCol = '#b4b7b4') {
  const S0 = CFG.SAFE;
  g.fillStyle = plazaCol;
  g.beginPath();
  g.arc(px(S0.x), px(S0.z), sz(9), 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#e8e8e0';
  g.lineWidth = sz(0.35);
  g.beginPath();
  g.arc(px(S0.x), px(S0.z), sz(6.4), 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#e8e8e0';
  g.font = `bold ${sz(6)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('H', px(S0.x), px(S0.z));
}

// Ensambla el descriptor final del escenario con valores por defecto
export function makeDescriptor(K, scene, o) {
  const safeObj = buildRefuge(scene, K.solid, o.refugeStyle || 'camp');
  return {
    id: o.id, look: o.look, batches: [K.batch], solids: K.solids, buildings: K.buildings, facade: o.facade || null,
    safeObj, signs: K.signs, cands: K.cands, sites: K.sites, paint: o.paint, terrainTint: false, bounds: 112,
    mapView: o.mapView || { cx: 0, cz: -15, half: 105 },
    water: o.water || { mode: 'none' }, allowObstacles: o.allowObstacles !== false, windCover: !!o.windCover, coverKind: o.coverKind,
    windAmp: o.windAmp ?? 1, hazard: o.hazard || o.id,
    // arena por defecto para el combate final contra el jefe: un poco antes del refugio,
    // sobre la ruta ya recorrida (los escenarios evitan poner sólidos cerca de SAFE/START)
    bossArena: (() => {
      const dx = CFG.START.x - CFG.SAFE.x, dz = CFG.START.z - CFG.SAFE.z, dl = Math.hypot(dx, dz) || 1;
      return { x: CFG.SAFE.x + (dx / dl) * 16, z: CFG.SAFE.z + (dz / dl) * 16, r: 13 };
    })(),
    ...(o.extra || {}),
  };
}

// Carteles educativos repartidos cerca de la ruta
export function placeSigns(K, spots) {
  const tips = ['sign_start', 'sign_1', 'sign_2', 'sign_3', 'sign_4', 'sign_5'];
  spots.forEach(([x, z], i) => K.sign(x, z, tips[i % tips.length]));
}
