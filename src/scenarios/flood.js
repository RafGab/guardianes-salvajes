import * as THREE from 'three';
import { buildCity, paintRiver } from '../city.js';
import { terrainH } from '../terrain.js';
import { smoothstep, clamp } from '../utils.js';
import { boatGeometry, busGeometry, raftGeometry, crateGeometry, barrelGeometry, logGeometry } from '../bodies.js';

export const seed = 555;

const look = {
  horizon: 0x5f7085, zenith: 0x1c2532, cloudLo: [0.07, 0.085, 0.11], cloudHi: [0.42, 0.47, 0.55], cover: 0.32, fog: 0x5f7085, fogD: 0.0065,
  hemi: [0x9fb4cc, 0x3c3a36, 1.25], sun: [0xdfe6f2, 2.3], exposure: 0.95, lightning: true,
  precip: { color: [0.72, 0.8, 0.9], alpha: 0.32, speed: 30, len: 0.9, wind: [3.5, 0, 1.2] },
};

export function build(K, { scene, quality }) {
  const city = buildCity(scene, { quality, scenario: 'flood' });
  const G = city.G;
  const rng = K.rng;
  const randIn = (a, b) => a + rng.next() * (b - a);

  // ---- río desbordado: puentes y puerto en la orilla este ----
  for (const bz of [-30, 30]) K.bridge({ x0: 66, z0: bz, x1: 94, z1: bz, width: 7, deckY: 0.47, name: 'puentes' });
  K.house({ x: 101, z: -20, w: 12, d: 16, h: 5.4, color: 0x8a9aa8, roofColor: 0x5a6068, roof: 'flat', cand: 'almacenes del puerto' });
  K.house({ x: 101, z: 22, w: 12, d: 14, h: 4.2, color: 0x9a8a78, roofColor: 0x5a6068, roof: 'flat', cand: 'almacenes del puerto' });
  const cc = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd4a017, 0x8e44ad];
  for (const [x, z] of [[97, -2], [97, 2.8], [104, 0], [95, 40], [99, -40]]) {
    const gy = terrainH(x, z);
    K.box(x, gy, z, 2.5, 2.6, 6, rng.pick(cc), { tag: 'container' });
    if (rng.chance(0.7)) K.box(x + 0.4, gy + 2.6, z, 2.5, 2.6, 6, rng.pick(cc), { tag: 'container' });
    K.cand('roof', x, gy + 2.62, z, { zone: 'contenedores' });
  }
  // grúa del puerto
  K.box(93, 0.2, -8, 0.8, 11, 0.8, 0x3a6ea8, { tag: 'crane' });
  K.box(93, 0.2, 8, 0.8, 11, 0.8, 0x3a6ea8, { tag: 'crane' });
  K.box(93, 11, 0, 1.0, 0.8, 18, 0xc0392b, { solid: false });
  K.box(88, 11, 0, 11, 0.6, 0.6, 0xc0392b, { solid: false });
  // muelle de madera
  K.box(90.5, 0.1, 0, 4, 0.4, 24, 0x8a6a48, { tag: 'dock' });
  for (let z = -10; z <= 10; z += 5) K.cand('street', 90.5, 0.52, z, { zone: 'muelle', type: 'ground' });

  // ---- candidatos de rescate ----
  for (const r of city.roofs) {
    const hi = r.kind === 'tower' || r.kind === 'mid12' || r.kind === 'mid9';
    K.cand('roof', r.x + randIn(-1.5, 1.5), r.roofY + 0.02, r.z + randIn(-1.5, 1.5), { zone: hi ? 'tejados altos' : 'tejados', hard: hi });
  }
  for (const p of city.porches) K.cand('balcony', p.x, p.y, p.z, { zone: 'porches' });
  for (const l of city.landings) if (rng.chance(0.55)) K.cand('balcony', l.x, l.top, l.z, { zone: 'escaleras de emergencia', hard: true });
  for (const k of city.kiosks) K.cand('roof', k.x, k.top + 0.22, k.z, { zone: 'quioscos' });
  for (let i = 0; i < 46; i++) {
    const line = [-32, 0, 32][Math.floor(rng.next() * 3)];
    const t = randIn(-58, 58);
    const along = rng.chance(0.5);
    const x = along ? t : line + randIn(-3.5, 3.5), z = along ? line + randIn(-3.5, 3.5) : t;
    K.cand('street', x, terrainH(x, z), z, { zone: 'calles', type: 'ground' });
  }
  for (const b of city.blockInfo) {
    if (b.type === 'park' || b.type === 'plaza') {
      for (let k = 0; k < 2; k++) K.cand('street', b.cx + randIn(-6, 6), G, b.cz + randIn(-6, 6), { zone: b.type === 'park' ? 'parques' : 'plaza', type: 'ground' });
    }
  }
  // ---- sitios para obstáculos (calles) ----
  for (let i = 0; i < 24; i++) {
    const line = [-32, 0, 32][Math.floor(rng.next() * 3)];
    const t = randIn(-56, 56);
    if (rng.chance(0.5)) K.site('road', t, line + randIn(-3, 3), 0); else K.site('road', line + randIn(-3, 3), t, Math.PI / 2);
  }

  const paint = () => {
    const gr = city.paint();
    paintRiver(gr.canvas, gr.tex);
    return gr;
  };

  return {
    id: 'flood', look, seed, city, batches: [city.batch, K.batch], solids: [...city.solids, ...K.solids], buildings: [...city.buildings, ...K.buildings],
    facade: city.facade, safeObj: city.safeObj, signs: city.signs, cands: K.cands, sites: K.sites, paint,
    terrainTint: true, bounds: 112, mapView: { cx: 5, cz: -15, half: 105 },
    water: { mode: 'rise', base: 0.1, max: 6.2, surgeAt: 120, surge: 1.25, colors: { shallow: 0x4b8f8a, deep: 0x0f3a4a, mud: 0x6f6a4a }, amp: 1 },
    allowObstacles: true, windCover: false, hazard: 'flood',
    flowAt(x, z, W, out) {
      const inCity = Math.abs(x) < 72 && Math.abs(z) < 72;
      let fx = 0, fz = 0;
      if (inCity) {
        const mz = ((((z + 16) % 32) + 32) % 32) - 16;
        const mx = ((((x + 16) % 32) + 32) % 32) - 16;
        fx = 1.35 * smoothstep(7, 3, Math.abs(mz));
        fz = 0.6 * smoothstep(7, 3, Math.abs(mx));
      }
      fz += 2.4 * smoothstep(11, 5, Math.abs(x - 80));
      const gain = 0.5 + 0.5 * clamp(W.waterY / 3, 0, 1) + 0.4 * smoothstep(120, 127, W.missionT);
      out.x = fx * gain;
      out.z = fz * gain;
      return out;
    },
    populate(W, H) {
      const { addBody, makeCar, mats, rng: r2 } = H;
      const carColors = [0xc0392b, 0x2e86c1, 0xecf0f1, 0x27ae60, 0xf1c40f, 0x7f8c8d, 0x8e44ad, 0xe67e22, 0x1abc9c];
      for (const line of [-32, 0, 32]) {
        for (let t = -56; t <= 56; t += 9) {
          const tl = ((((t + 16) % 32) + 32) % 32) - 16;
          if (Math.abs(tl) < 8.5) continue;
          for (const side of [-1, 1]) {
            if (!r2.chance(0.3)) continue;
            const off = 3.4 * side;
            makeCar(t + r2.range(-1.5, 1.5), line + off, 'x', r2.pick(carColors));
            if (r2.chance(0.7)) makeCar(line + off, t + r2.range(-1.5, 1.5), 'z', r2.pick(carColors));
          }
        }
      }
      H.pruneBodies(9);
      const busMesh = new THREE.Mesh(busGeometry(), mats.flat);
      busMesh.castShadow = true;
      busMesh.receiveShadow = true;
      busMesh.rotation.y = Math.PI / 2;
      addBody({ kind: 'bus', mesh: busMesh, x: -35.2, z: -22, hx: 1.3, hz: 4.7, h: 3.0, draft: 0.8, drift: 0.3, rescue: 3.0 });
      const raftMesh = new THREE.Mesh(raftGeometry(), mats.flat);
      raftMesh.castShadow = true;
      addBody({ kind: 'raft', mesh: raftMesh, x: -20, z: 0.6, hx: 1.6, hz: 1.5, h: 0.3, draft: 0.05, drift: 0.55, wobble: 0.05, rescue: 0.28 });
      const bg = boatGeometry(0xf0f0e8);
      for (const [x, z] of [[80, -12], [79, 16], [81, 46], [80, -46]]) {
        const m = new THREE.Mesh(bg, mats.flat);
        m.rotation.y = Math.PI / 2;
        m.castShadow = true;
        addBody({ kind: 'boat', mesh: m, x, z, restY: -2.4, hx: 1.1, hz: 2.8, h: 2.2, draft: 0.5, drift: 0.8, wobble: 0.04, rescue: 2.2 });
      }
      const barrelCols = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd4a017];
      const streetPos = () => {
        const line = r2.pick([-32, 0, 32, -64, 64]);
        const t = r2.range(-60, 60);
        return r2.chance(0.5) ? [t, line + r2.range(-3, 3)] : [line + r2.range(-3, 3), t];
      };
      const n = H.mobile ? 0.5 : 1;
      for (let i = 0; i < 20 * n; i++) {
        const [x, z] = streetPos();
        const m = new THREE.Mesh(barrelGeometry(r2.pick(barrelCols)), mats.flat);
        m.castShadow = true;
        addBody({ kind: 'barrel', mesh: m, x, z, draft: 0.3, pushR: 0.5, drift: 0.9, wobble: 0.12 });
      }
      for (let i = 0; i < 8 * n; i++) {
        const [x, z] = streetPos();
        const m = new THREE.Mesh(logGeometry(), mats.flat);
        m.castShadow = true;
        m.rotation.y = r2.range(0, 6.28);
        addBody({ kind: 'log', mesh: m, x, z, draft: 0.22, pushR: 1.2, drift: 1.0, wobble: 0.06 });
      }
      const cg = crateGeometry();
      for (let i = 0; i < 10 * n; i++) {
        const [x, z] = streetPos();
        const m = new THREE.Mesh(cg, mats.flat);
        m.castShadow = true;
        addBody({ kind: 'crate', mesh: m, x, z, hx: 0.58, hz: 0.58, h: 1.1, draft: 0.5, drift: 0.8, wobble: 0.05 });
      }
    },
  };
}
