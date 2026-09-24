import { terrainH, CFG } from './terrain.js';
import { makeRng } from './utils.js';

/* ------------------------------------------------------------------ */
/*  Accesibilidad: búsqueda en anchura sobre superficies "de pie"      */
/*  (terreno + techos de sólidos), con altura de escalón y de trepa.   */
/* ------------------------------------------------------------------ */
const CELL = 2;
const SKIP_TAGS = new Set(['tree', 'rail', 'fence']);

export function computeReach(world, opts = {}) {
  const half = opts.half ?? 112;
  const N = Math.floor((half * 2) / CELL);
  const surfaces = new Array(N * N);
  const tmp = [];
  const cellX = (i) => -half + (i + 0.5) * CELL;
  const cellZ = (j) => -half + (j + 0.5) * CELL;

  const blocked = (near, x, z, y) => {
    for (const s of near) {
      if (s.x0 < x && s.x1 > x && s.z0 < z && s.z1 > z && s.y0 < y + 1.7 && s.y1 > y + 0.16) return true;
    }
    return false;
  };

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = cellX(i), z = cellZ(j);
      const near = world.solidsNear(x - 1, x + 1, z - 1, z + 1, tmp);
      const list = [];
      const th = terrainH(x, z);
      const cand = [th];
      for (const s of near) {
        if (SKIP_TAGS.has(s.tag)) continue;
        if (s.x0 < x && s.x1 > x && s.z0 < z && s.z1 > z && s.y1 > th + 0.05) cand.push(s.y1);
      }
      cand.sort((a, b) => a - b);
      let last = -1e9;
      for (const y of cand) {
        if (y - last < 0.3) continue;
        if (blocked(near, x, z, y - 0.001)) continue;
        // los sólidos que sostienen la superficie no cuentan como bloqueo (y1 == y)
        list.push(y);
        last = y;
      }
      surfaces[j * N + i] = list;
    }
  }

  const sx = clamp01((CFG.START.x + half) / CELL, N), sz = clamp01((CFG.START.z + half) / CELL, N);
  const startY = terrainH(CFG.START.x, CFG.START.z);
  let startLevel = 0;
  const sl = surfaces[sz * N + sx] || [];
  let best = 1e9;
  sl.forEach((y, k) => { if (Math.abs(y - startY) < best) { best = Math.abs(y - startY); startLevel = k; } });

  const seen = new Uint8Array(N * N * 6);
  const key = (i, j, k) => (j * N + i) * 6 + Math.min(5, k);
  const queue = [[sx, sz, startLevel]];
  seen[key(sx, sz, startLevel)] = 1;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const climb = opts.climb ?? 2.6;
  while (queue.length) {
    const [i, j, k] = queue.pop();
    const y = surfaces[j * N + i][k];
    if (y === undefined) continue;
    for (const [di, dj] of dirs) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const ls = surfaces[nj * N + ni];
      for (let m = 0; m < ls.length && m < 6; m++) {
        const ny = ls[m];
        const dy = ny - y;
        const flatTerrain = Math.abs(ny - terrainH(cellX(ni), cellZ(nj))) < 0.05 && Math.abs(y - terrainH(cellX(i), cellZ(j))) < 0.05;
        const ok = flatTerrain ? Math.abs(dy) <= 1.7 : dy <= climb && dy >= -9;
        if (!ok) continue;
        const kk = key(ni, nj, m);
        if (seen[kk]) continue;
        seen[kk] = 1;
        queue.push([ni, nj, m]);
      }
    }
  }

  const isReachable = (x, y, z, tol = 0.9) => {
    const ci = Math.floor((x + half) / CELL), cj = Math.floor((z + half) / CELL);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        const ls = surfaces[j * N + i];
        for (let m = 0; m < ls.length && m < 6; m++) if (seen[key(i, j, m)] && Math.abs(ls[m] - y) <= tol) return true;
      }
    }
    return false;
  };
  const nearReachable = (x, z, r = 14) => {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      for (const rr of [4, 8, r]) {
        const px = x + Math.cos(ang) * rr, pz = z + Math.sin(ang) * rr;
        if (isReachable(px, terrainH(px, pz), pz, 1.5)) return true;
      }
    }
    return false;
  };
  return { isReachable, nearReachable };
}
function clamp01(v, N) {
  return Math.max(0, Math.min(N - 1, Math.floor(v)));
}

/* ------------------------------------------------------------------ */
/*  Selección aleatoria de puntos de rescate                           */
/* ------------------------------------------------------------------ */
const PEOPLE = ['hombre', 'mujer', 'nino', 'anciano'];
const ANIMALS = ['perro', 'gato', 'ciervo'];

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clearAt(world, x, y, z) {
  const near = world.solidsNear(x - 0.7, x + 0.7, z - 0.7, z + 0.7, []);
  for (const s of near) {
    if (s.x0 < x + 0.5 && s.x1 > x - 0.5 && s.z0 < z + 0.5 && s.z1 > z - 0.5 && s.y0 < y + 1.7 && s.y1 > y + 0.16) return false;
  }
  return true;
}

export function generateRescues(world, params) {
  const rng = makeRng((Math.random() * 1e9) | 0);
  const {
    count = 8, animalRatio = 0.4, minSep = 14, minStart = 24, tools = new Set(), difficulty = 1, toolSlotsMax = 2,
  } = params;
  const reach = world.reach || (world.reach = computeReach(world, { half: world.sc.bounds ?? 112 }));
  const S = CFG.SAFE, T = CFG.START;

  // reunir candidatos (estáticos + vehículos dinámicos)
  const pool = [];
  for (const c of world.candidates) pool.push({ ...c });
  for (const b of world.bodyCandidates()) pool.push(b);

  const valid = [];
  for (const c of pool) {
    const x = c.body ? c.body.x0 : c.x, z = c.body ? c.body.z0 : c.z;
    const y = c.body ? c.body.restY + c.ly : c.y;
    if (Math.hypot(x - T.x, z - T.z) < minStart) continue;
    if (Math.hypot(x - S.x, z - S.z) < S.r + 12) continue;
    if (Math.abs(x) > 112 || Math.abs(z) > 112) continue;
    if (world.noSpawn && world.noSpawn(x, z)) continue;
    if (c.needsTool && !tools.has(c.needsTool)) continue;
    if (c.body) {
      if (!reach.nearReachable(x, z, 6)) continue;
    } else {
      if (!clearAt(world, x, y, z)) continue;
      if (c.needsTool === 'rope' || c.needsTool === 'piolet') {
        if (!reach.nearReachable(x, z, 16)) continue;
      } else if (c.needsTool === 'shield') {
        if (!reach.nearReachable(x, z, 14)) continue;
      } else if (!reach.isReachable(x, y, z)) continue;
    }
    valid.push({ ...c, vx: x, vz: z, vy: y });
  }

  // agrupar por zona
  const zones = new Map();
  for (const c of valid) {
    if (!zones.has(c.zone)) zones.set(c.zone, []);
    zones.get(c.zone).push(c);
  }
  for (const list of zones.values()) shuffle(list, rng);
  const zoneNames = shuffle([...zones.keys()], rng);

  // lista de tipos de rescatado
  const nAnimals = Math.round(count * animalRatio);
  const kinds = shuffle([...Array(count - nAnimals).fill(0).map((_, i) => PEOPLE[(i + Math.floor(rng.next() * 4)) % 4]), ...Array(nAnimals).fill(0).map((_, i) => ANIMALS[(i + Math.floor(rng.next() * 3)) % 3])], rng);

  const chosen = [];
  let sep = minSep;
  let toolSlots = 0;
  const pickFrom = (list, kind) => {
    for (let idx = 0; idx < list.length; idx++) {
      const c = list[idx];
      if (chosen.some((p) => Math.hypot(p.vx - c.vx, p.vz - c.vz) < sep)) continue;
      if (c.needsTool) {
        if (toolSlots >= toolSlotsMax) continue;
      }
      if (kind === 'ciervo' && !(c.type === 'ground' || c.type === 'clearing' || c.type === 'street' || (c.body && c.body.kind === 'bus'))) continue;
      list.splice(idx, 1);
      return c;
    }
    return null;
  };
  let zi = 0;
  for (const kind of kinds) {
    let got = null;
    for (let attempt = 0; attempt < 6 && !got; attempt++) {
      for (let k = 0; k < zoneNames.length && !got; k++) {
        const name = zoneNames[(zi + k) % zoneNames.length];
        got = pickFrom(zones.get(name), kind);
        if (got) zi = (zi + k + 1) % zoneNames.length;
      }
      if (!got) sep = Math.max(6, sep * 0.75);
    }
    if (!got) {
      // último recurso: cualquiera válido lejos de los demás
      for (const list of zones.values()) {
        got = pickFrom(list, kind === 'ciervo' ? 'perro' : kind);
        if (got) break;
      }
    }
    if (got) {
      if (got.needsTool) toolSlots++;
      chosen.push({ ...got, kind: kind === 'ciervo' && !(got.type === 'ground' || got.type === 'clearing' || got.type === 'street' || (got.body && got.body.kind === 'bus')) ? 'perro' : kind });
    }
  }

  // giros que exigen herramientas (solo si el jugador las tiene)
  const twists = [];
  for (const c of chosen) {
    const ground = c.type === 'ground' || c.type === 'clearing' || c.type === 'street';
    if (c.needsTool) c.requires = c.needsTool;
    if (ground && tools.has('axe') && rng.next() < 0.28 * difficulty && world.sc.allowObstacles !== false) twists.push([c, 'axe']);
    else if (ground && tools.has('wind') && world.sc.windCover && rng.next() < 0.3 * difficulty) twists.push([c, 'wind']);
    else if (ground && tools.has('flashlight') && rng.next() < 0.3 * difficulty) twists.push([c, 'flashlight']);
    else if (tools.has('canteen') && world.sc.thirst && (c.kind === 'perro' || c.kind === 'gato' || c.kind === 'ciervo') && rng.next() < 0.6) twists.push([c, 'canteen']);
  }
  const slots = chosen.map((c) => ({
    kind: c.kind, zone: c.zone, type: c.type,
    x: c.vx, y: c.vy, z: c.vz, body: c.body || null, ly: c.ly, requires: c.requires || null,
    obstacleKind: null, hidden: false, thirsty: false,
  }));
  for (const [c, tool] of twists) {
    const s = slots[chosen.indexOf(c)];
    if (tool === 'axe') s.obstacleKind = 'axe';
    else if (tool === 'wind') s.obstacleKind = 'wind';
    else if (tool === 'flashlight') s.hidden = true;
    else if (tool === 'canteen') s.thirsty = true;
    s.requires = s.requires || tool;
  }
  return slots;
}
