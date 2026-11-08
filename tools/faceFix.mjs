// Cara rígida: los rasgos de la cara (ojos, nariz, boca, gafas...) no deben estirarse al mover el esqueleto.
// Todos los vértices de la zona de la cabeza quedan atados 100 % al hueso `head`; entre el cuello y la cara hay una
// rampa suave para que no se note ningún corte. Las orejas (y otros huesos propios, como cuernos) conservan sus pesos.
//
// applyRigidFace({ names, joints, J0, W0, pos, opts }) modifica J0/W0 en el sitio.
//   names:  nombres de los huesos en el orden del skin
//   joints: { nombre: [x,y,z] } posición de reposo (espacio de la malla)
//   J0/W0:  JOINTS_0 (Uint16Array NV*4) y WEIGHTS_0 (Float32Array NV*4)
//   pos:    posiciones (Float32Array NV*3)
export function applyRigidFace({ names, joints, J0, W0, pos, opts = {} }) {
  const NV = pos.length / 3;
  const idx = Object.fromEntries(names.map((n, i) => [n, i]));
  const headI = idx.head, neckI = idx.neck;
  if (headI === undefined) return { changed: 0 };
  const head = joints.head;
  const end = joints.head_end || [head[0], head[1] + 0.2, head[2]];
  const ax = end[0] - head[0], ay = end[1] - head[1], az = end[2] - head[2];
  const al = Math.hypot(ax, ay, az) || 1;
  const ux = ax / al, uy = ay / al, uz = az / al;
  const owned = new Set(names.map((n, i) => (/^(ear|horn|wing|tail|antler|pack|katana|axe|weapon)/.test(n) ? i : -1)).filter((i) => i >= 0));
  const yOff = opts.yOffset ?? 0.0, ramp = opts.ramp ?? 0.05;
  const dominant = (v) => { let b = 0, bw = -1; for (let k = 0; k < 4; k++) if (W0[v * 4 + k] > bw) { bw = W0[v * 4 + k]; b = J0[v * 4 + k]; } return b; };
  // distancia al eje de la cabeza y altura a lo largo de él
  const geo = (v) => {
    const px = pos[v * 3] - head[0], py = pos[v * 3 + 1] - head[1], pz = pos[v * 3 + 2] - head[2];
    const t = px * ux + py * uy + pz * uz;
    const dx = px - ux * t, dy = py - uy * t, dz = pz - uz * t;
    return { t, r: Math.hypot(dx, dy, dz), y: pos[v * 3 + 1] };
  };
  // radio de la cabeza: percentil 97 de los vértices dominados por la cabeza, por encima del cuello
  let R = opts.radius;
  if (!R) {
    const rs = [];
    for (let v = 0; v < NV; v++) {
      if (dominant(v) !== headI) continue;
      const g = geo(v);
      if (g.t > 0.03 && g.t < al + 0.12) rs.push(g.r);
    }
    rs.sort((a, b) => a - b);
    R = (rs[Math.floor(rs.length * 0.97)] || 0.12) * (opts.radiusMul ?? 1.0);
  }
  let changed = 0;
  for (let v = 0; v < NV; v++) {
    const g = geo(v);
    if (g.t < -ramp * 0.2 || g.t > al + 0.2 || g.r > R) continue;
    const d = dominant(v);
    if (owned.has(d)) continue;               // las orejas conservan lo suyo
    if (d !== headI && d !== neckI) continue; // solo cabeza o cuello
    const k = Math.min(1, Math.max(0, (g.t - yOff) / ramp)); // 0 en el cuello → 1 en la cara
    // mezcla: (1-k) pesos actuales + k cabeza 100 %
    const cur = new Map();
    for (let q = 0; q < 4; q++) if (W0[v * 4 + q] > 0) cur.set(J0[v * 4 + q], (cur.get(J0[v * 4 + q]) || 0) + W0[v * 4 + q]);
    const out = new Map();
    for (const [b, w] of cur) out.set(b, w * (1 - k));
    out.set(headI, (out.get(headI) || 0) + k);
    const top = [...out.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    let s = 0; for (const [, w] of top) s += w;
    for (let q = 0; q < 4; q++) { const e = top[q]; J0[v * 4 + q] = e ? e[0] : 0; W0[v * 4 + q] = e ? e[1] / s : 0; }
    changed++;
  }
  return { changed, radius: R };
}
