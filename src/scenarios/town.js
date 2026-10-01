import { CFG, terrainH, setTerrain, smoothstep, lerp, n2, refugeHeight, startFlat, setStartSafe, makeDescriptor, placeSigns, paintRefugeAndStart } from './common.js';
import { M4, unitBox } from '../kit.js';

export const seed = 3303;

const look = {
  horizon: 0xa39680, zenith: 0x4a5866, cloudLo: [0.16, 0.16, 0.17], cloudHi: [0.62, 0.6, 0.56], cover: 0.4, fog: 0x9a917f, fogD: 0.0072,
  hemi: [0xc8c4b8, 0x4a463c, 1.35], sun: [0xfff0d8, 2.4], exposure: 1.0, lightning: false, precip: null,
};

const CANAL_Z = -22;
const XS = [-72, -54, -36, -18, 0, 18, 36, 54, 72];
const ZS_S = [62, 46, 30, 12, -8];       // al sur del canal (calles entre filas)
const ZS_N = [-40, -56, -72];            // al norte del canal
const canalC = (x) => CANAL_Z + 3 * Math.sin(x * 0.05);

function townTerrain(x, z) {
  const r = Math.hypot(x, z);
  let h = 0.35 + 1.2 * n2(x, z, 0.03) + (z < -20 ? (-z - 20) * 0.02 : 0);
  h += smoothstep(92, 140, r) * (16 + 10 * n2(x, z, 0.03));
  const cd = Math.abs(z - canalC(x));
  h = lerp(h, -2.4, smoothstep(8.5, 4, cd));
  h = refugeHeight(h, x, z);
  h = startFlat(h, x, z, 0.35);
  return h;
}

export function build(K, { scene }) {
  setStartSafe({ x: 0, z: 62 }, { x: 0, z: -96, y: 10.2, r: 8 });
  setTerrain(townTerrain);
  const rng = K.rng;
  const rr = (a, b) => a + rng.next() * (b - a);
  const T = CFG.START, S = CFG.SAFE;
  const wall = [0xd9c39a, 0xc9a97a, 0xe0d0b0, 0xb89a72, 0xd8b890, 0xc8b8a0];
  const roofC = [0x9a4a2a, 0xa85a34, 0x8a3a24];
  const rubble = [];

  // ----- edificios por manzanas irregulares -----
  const stepped = (arr) => arr.slice(0, -1).map((v, i) => [Math.min(v, arr[i + 1]), Math.max(v, arr[i + 1])]);
  const rowsS = stepped(ZS_S), rowsN = stepped(ZS_N);
  const damagedBuilding = (x, z, w, d, h, g) => {
    const col = rng.pick(wall);
    K.box(x - w / 4, g - 2, z, w / 2, h + 2, d, col, { tag: 'building' });
    K.box(x + w / 4, g - 2, z, w / 2, h * 0.5 + 2, d, col, { tag: 'building' });
    K.batch.add(unitBox, 'flat', M4(x + w / 4 + 0.6, g + h * 0.5 + 0.2, z, w * 0.55, 0.3, d * 0.9, 0.12, 0.18, -0.22), 0x8a7a6a);
    K.box(x - w / 4, g + h, z, w / 2 + 0.4, 0.3, d + 0.4, 0x6a4a3a, { solid: false });
    for (let i = 0; i < 4; i++) {
      const bx = x + w / 2 + rr(0.5, 2.5), bz = z + rr(-d / 2, d / 2);
      K.box(bx, terrainH(bx, bz), bz, rr(1.2, 2.4), rr(0.8, 1.8), rr(1.2, 2.2), rng.pick([0x9a8c7a, 0x8a7a6a, 0xa89a88]), { tag: 'rubble' });
    }
    K.cand('street', x + w / 2 + 3.4, terrainH(x + w / 2 + 3.4, z), z + rr(-2, 2), { zone: 'edificios dañados', type: 'ground' });
    for (let i = 0; i < 6; i++) { // grietas en la fachada
      K.batch.add(unitBox, 'flat', M4(x - w / 2 - 0.03, g + rr(0.5, h - 1), z + rr(-d / 3, d / 3), 0.05, rr(0.8, 2), 0.14, 0, 0, rr(-0.5, 0.5)), 0x2a2622);
    }
    const b = { x, z, w, d, h, roofY: g + h, kind: 'dañado' };
    K.buildings.push(b);
  };
  const cells = [];
  const centralBlock = (i, jrow, north) => north === false && i >= 3 && i <= 4 && jrow === 3;
  for (const [north, rows] of [[false, rowsS], [true, rowsN]]) {
    rows.forEach(([z0, z1], jr) => {
      for (let i = 0; i < XS.length - 1; i++) {
        const x0 = XS[i] + 3.2, x1 = XS[i + 1] - 3.2, zz0 = z0 + 3.2, zz1 = z1 - 3.2;
        const w = x1 - x0, d = zz1 - zz0;
        const cx = (x0 + x1) / 2, cz = (zz0 + zz1) / 2;
        if (Math.hypot(cx - T.x, cz - T.z) < 13) continue;               // inicio despejado
        if (!north && jr === rows.length - 1 && i >= 3 && i <= 4) continue; // plaza mayor sur
        if (north && jr === 0 && i >= 3 && i <= 4) continue;                // iglesia
        if (Math.hypot(cx - S.x, cz - S.z) < 22) continue;
        const g = Math.max(terrainH(cx, cz), terrainH(x0, zz0), terrainH(x1, zz1));
        const roll = rng.next();
        const h = rng.pick([3.4, 3.4, 6.4, 6.4, 9.6]);
        if (roll < 0.26) { damagedBuilding(cx, cz, Math.min(w, 13), Math.min(d, 10), h, g); cells.push({ cx, cz, w, d, kind: 'dmg', g }); }
        else if (roll < 0.56) {
          const b = K.house({ x: cx, z: cz, w: Math.min(w, 14), d: Math.min(d, 11), h, color: rng.pick(wall), roof: 'flat', roofColor: 0x8a7a6a, facing: north ? 0 : Math.PI, base: g, cand: 'azoteas' });
          cells.push({ cx, cz, w, d, kind: 'flat', g, b });
          // balcón accesible en la fachada
          K.box(cx, g + 2.5, cz + (north ? 1 : -1) * (Math.min(d, 11) / 2 + 0.7), 3.6, 0.28, 1.4, 0x6a5a4a, { tag: 'ledge' });
          K.cand('balcony', cx + rr(-1, 1), g + 2.8, cz + (north ? 1 : -1) * (Math.min(d, 11) / 2 + 0.7), { zone: 'balcones' });
        } else {
          K.house({ x: cx, z: cz, w: Math.min(w, 13), d: Math.min(d, 10), h: Math.min(h, 6.4), color: rng.pick(wall), roof: 'gable', roofColor: rng.pick(roofC), facing: north ? 0 : Math.PI, base: g, chimney: rng.chance(0.4) });
          cells.push({ cx, cz, w, d, kind: 'gable', g });
        }
      }
    });
  }

  // ----- plaza mayor (sur) con fuente y puestos -----
  const pz = (ZS_S[3] + ZS_S[4]) / 2 - 1;
  K.cyl(0, terrainH(0, pz), pz, 3.4, 0.9, 0x9a9a98, { solid: true, tag: 'fountain' });
  K.cyl(0, terrainH(0, pz) + 0.9, pz, 0.5, 2.2, 0x8a8a88);
  for (const [ox, oz] of [[-9, -4], [9, -4], [-9, 5], [9, 5]]) {
    const x = ox, z = pz + oz, g = terrainH(x, z);
    K.box(x, g, z, 3, 1.0, 1.6, 0x8a6a4a, { tag: 'stall' });
    K.box(x, g + 2.5, z, 3.6, 0.15, 2.2, rng.pick([0xc0392b, 0x2e86c1, 0xd4a017]), { solid: false });
    K.cand('roof', x, g + 1.02, z, { zone: 'plaza mayor' });
  }
  for (let k = 0; k < 6; k++) K.cand('street', rr(-12, 12), terrainH(0, pz), pz + rr(-9, 9), { zone: 'plaza mayor', type: 'ground' });
  for (const [x, z] of [[-14, pz - 3], [14, pz - 3], [-13, pz + 7], [13, pz + 7]]) K.tree('broad', x, z, 1.1);

  // ----- iglesia con torre inclinada (norte del canal) -----
  const cz = (ZS_N[0] + ZS_N[1]) / 2, cg = terrainH(0, cz);
  K.box(0, cg - 2, cz, 12, 11, 22, 0xd8c8a8, { tag: 'building' });
  K.prism(0, cg + 9, cz, 12.8, 5, 22.6, 0x8a4a2a, Math.PI / 2 * 0);
  K.box(0, cg - 2, cz + 15, 7, 27, 7, 0xd0bf9e, { tag: 'building' });
  K.cone(0, cg + 25, cz + 15, 4.2, 6, 0x7a3a24);
  K.box(0, cg + 12, cz + 19, 4.4, 0.3, 1.6, 0x7a6a5a, { tag: 'ledge' });
  K.cand('ledge', 0, cg + 12.32, cz + 19, { zone: 'campanario', needsTool: 'rope' });
  for (let s = 0; s < 4; s++) K.box(0, cg, cz + 8.5 + 11 + s * 0.9, 9 - s * 0.6, 0.35 * (s + 1), 1.0, 0xc8b898, { tag: 'stairs' });
  for (let k = 0; k < 4; k++) K.cand('street', rr(-5, 5), terrainH(0, cz + 24), cz + rr(23, 28), { zone: 'plaza de la iglesia', type: 'ground' });
  // grietas y contrafuertes
  for (let i = 0; i < 6; i++) K.batch.add(unitBox, 'flat', M4(-6.05, cg + rr(0.5, 8), cz + rr(-9, 9), 0.05, rr(1, 3), 0.16, 0, 0, rr(-0.5, 0.5)), 0x2a2622);

  // ----- canal seco y puentes -----
  const bridgeAt = (x, broken) => {
    const zc = canalC(x);
    if (!broken) K.bridge({ x0: x, z0: zc + 11, x1: x, z1: zc - 11, width: 6.5, deckY: 0.55, name: 'puentes', color: 0xb8a888, rail: 0x9a8a78 });
    else {
      K.bridge({ x0: x, z0: zc + 11, x1: x, z1: zc + 1.5, width: 6.5, deckY: 0.55, name: 'puente roto', color: 0xb8a888, rail: 0x9a8a78, piers: false });
      K.bridge({ x0: x, z0: zc - 4.5, x1: x, z1: zc - 11, width: 6.5, deckY: 0.55, name: 'puente roto', color: 0xb8a888, rail: 0x9a8a78, piers: false });
      K.box(x - 3.6, -2.4, zc - 1, 2.6, 1.6, 3, 0x9a8a78, { tag: 'rubble' });
    }
  };
  bridgeAt(-27, false);
  bridgeAt(0, false);
  bridgeAt(36, true);
  for (let i = 0; i < 10; i++) {
    const x = rr(-60, 60);
    K.cand('street', x, terrainH(x, canalC(x)), canalC(x) + rr(-1.5, 1.5), { zone: 'cauce seco', type: 'ground' });
  }
  // calles: candidatos y sitios de bloqueo
  const sites = [];
  for (const zg of ZS_S.concat(ZS_N)) for (let x = -64; x <= 64; x += 6) {
    if (Math.abs(zg - canalC(x)) < 9) continue;
    if (Math.hypot(x - T.x, zg - T.z) < 14 || Math.hypot(x - S.x, zg - S.z) < 20) continue;
    if (rng.chance(0.25)) K.cand('street', x + rr(-2, 2), terrainH(x, zg), zg + rr(-1.2, 1.2), { zone: 'calles del pueblo', type: 'ground' });
    if (rng.chance(0.2)) { K.site('road', x, zg, 0); sites.push([x, zg]); }
  }
  for (const xg of XS) for (let z = -66; z <= 58; z += 8) {
    if (Math.abs(z - canalC(xg)) < 9) continue;
    if (Math.hypot(xg - T.x, z - T.z) < 14 || Math.hypot(xg - S.x, z - S.z) < 20) continue;
    if (rng.chance(0.2)) K.site('road', xg, z, Math.PI / 2);
  }
  // árboles del entorno y muros
  for (const p of K.scatter(60, { x0: -100, x1: 100, z0: -104, z1: 70 }, { minDist: 8, accept: (x, z) => Math.abs(z - canalC(x)) > 10 && cells.every((c) => Math.abs(c.cx - x) > c.w / 2 + 2 || Math.abs(c.cz - z) > c.d / 2 + 2) && Math.hypot(x - T.x, z - T.z) > 12 && Math.hypot(x - S.x, z - S.z) > 16 })) K.tree('broad', p.x, p.z, rr(0.9, 1.3));
  placeSigns(K, [[6, 54], [-14, 24], [10, 4], [-30, -14], [14, -50], [-6, -78]]);

  // sitios de réplicas (cruces de calle)
  const rubbleSites = [];
  for (const xg of XS.slice(1, -1)) for (const zg of ZS_S.slice(1).concat(ZS_N)) {
    if (Math.abs(zg - canalC(xg)) < 10) continue;
    if (Math.hypot(xg - T.x, zg - T.z) < 16 || Math.hypot(xg - S.x, zg - S.z) < 20) continue;
    rubbleSites.push([xg, zg]);
  }

  const paint = () => K.paintGround({
    colorAt: (x, z, h, sl) => {
      if (h < -0.6) return [128, 116, 98];
      if (sl > 1.2 || h > 12) return [104, 98, 90];
      let street = false;
      for (const zg of ZS_S.concat(ZS_N)) if (Math.abs(z - zg) < 3.2) street = true;
      for (const xg of XS) if (Math.abs(x - xg) < 3.2) street = true;
      if (street && Math.abs(x) < 80 && z > -78 && z < 66) return [156, 144, 122];
      if (Math.abs(x) < 80 && z > -78 && z < 66) return [176, 160, 132];
      return [98 + 40 * n2(x, z, 0.06), 112 + 30 * n2(x, z, 0.06), 70 + 14 * n2(x, z, 0.08)];
    },
    draw: (g, px, sz) => {
      // adoquines de las calles y grietas
      g.strokeStyle = 'rgba(80,66,50,.35)';
      g.lineWidth = 1.2;
      for (let i = 0; i < 260; i++) {
        const x = rr(-78, 78), z = rr(-76, 64);
        g.beginPath();
        let a = px(x), b = px(z);
        g.moveTo(a, b);
        for (let k = 0; k < 5; k++) { a += rr(-12, 12); b += rr(6, 26); g.lineTo(a, b); }
        g.stroke();
      }
      g.fillStyle = 'rgba(30,26,22,.7)';
      for (let i = 0; i < 10; i++) {
        g.lineWidth = sz(0.25);
        g.strokeStyle = 'rgba(20,16,12,.85)';
        g.beginPath();
        let a = px(rr(-60, 60)), b = px(rr(-60, 50));
        g.moveTo(a, b);
        for (let k = 0; k < 7; k++) { a += rr(-30, 30); b += rr(-18, 30); g.lineTo(a, b); }
        g.stroke();
      }
      paintRefugeAndStart(g, px, sz);
    },
  });

  return makeDescriptor(K, scene, { id: 'quake', look, paint, refugeStyle: 'quake', mapView: { cx: 0, cz: -15, half: 100 }, extra: { rubbleSites, canalC, bossArena: { x: 0, z: pz, r: 15 } } });
}
