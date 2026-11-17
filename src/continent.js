import * as THREE from 'three';

/* ======================================================================
   MAPA GENERAL DE APOCALIA EN 3D (menú de mundos)
   Un solo continente flotante donde están TODOS los escenarios: cada mundo ocupa su región (un sector del
   continente, en la misma dirección que su isla) con su propio relieve y su color oficial (levels.js), separada
   de las vecinas por crestas de roca y unida al centro (Apocalia, el cráter del meteorito) por un camino de
   energía. Gira con el anillo de mundos; la región del mundo señalado o elegido se ilumina. Las islas de cada
   mundo flotan sobre su región como marcadores.
   ====================================================================== */
const TAU = Math.PI * 2;
const vrnd = (s) => { const x = Math.sin(s * 127.1) * 43758.5453; return x - Math.floor(x); };
const cHash = (x, z) => vrnd(x * 12.9898 + z * 78.233);
function cNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const s = (t) => t * t * (3 - 2 * t), a = cHash(ix, iz), b = cHash(ix + 1, iz), c = cHash(ix, iz + 1), d = cHash(ix + 1, iz + 1);
  return a + (b - a) * s(fx) + (c - a) * s(fz) + (a - b - c + d) * s(fx) * s(fz);
}
// relieve propio de cada escenario (u = 0..1 a lo ancho del sector, r = distancia al centro)
const RELIEF = {
  campfire: (x, z) => 0.25 * cNoise(x * 1.3, z * 1.3),                                                       // bosque
  sandstorm: (x, z) => 0.35 * Math.max(0, Math.sin(x * 1.6 + z * 0.9)) + 0.1 * cNoise(x * 2, z * 2),          // dunas
  quake: (x, z) => 0.18 * cNoise(x * 2.4, z * 2.4) - 0.25 * Math.max(0, 1 - Math.abs(Math.sin(x * 0.9 - z * 1.3)) * 14), // grietas
  rockslide: (x, z, u) => 0.9 * Math.pow(Math.abs(u - 0.5) * 2, 3) + 0.25 * cNoise(x * 1.8, z * 1.8),          // valle entre paredes
  hurricane: (x, z, u, r) => (r > 10 ? -0.35 : 0.08 * cNoise(x * 2, z * 2)),                                   // costa
  flood: (x, z, u, r) => (r > 8.5 ? -0.4 : 0.1 * cNoise(x * 2, z * 2)),                                        // ciudad y puerto
  fire: (x, z, u, r) => 1.6 * Math.max(0, 1 - Math.hypot(u - 0.5, (r - 9.5) / 6) * 3.2) + 0.15 * cNoise(x * 2, z * 2), // volcán
  ice: (x, z, u, r) => 0.7 * Math.pow(cNoise(x * 0.9, z * 0.9), 2) + 0.4 * Math.max(0, (r - 10) / 3),         // montañas
};

// sectors: [{ id, ang, col: THREE.Color }] (ang = dirección de su isla); centerCol: color oficial de Apocalia
export function buildContinent(sectors, centerCol) {
  const g = new THREE.Group();
  const R = 13, RC = 4.3, n = sectors.length, half = Math.PI / n;
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const which = (a) => { let bi = 0, bd = 9; sectors.forEach((s, i) => { const d = Math.abs(angDiff(a, s.ang)); if (d < bd) { bd = d; bi = i; } }); return { i: bi, d: bd }; };
  // superficie: malla polar con altura y color por vértice
  const RS = 64, AS = 192, pos = [], col = [], idx = [];
  const rock = new THREE.Color(0x5a5650), ash = new THREE.Color(centerCol), tmp = new THREE.Color();
  for (let ri = 0; ri <= RS; ri++) {
    const r = Math.max(0.001, (ri / RS) * R);
    for (let ai = 0; ai < AS; ai++) {
      const a = (ai / AS) * TAU, x = Math.cos(a) * r, z = -Math.sin(a) * r;
      let y;
      if (r < RC) { // APOCALIA: cráter del meteorito en el centro
        y = -0.25 + 0.5 * Math.pow(r / RC, 3) + 0.08 * cNoise(x * 3, z * 3);
        tmp.copy(ash).lerp(rock, 0.25 + 0.2 * cNoise(x * 4, z * 4));
      } else {
        const w = which(a), s = sectors[w.i], u = 0.5 + angDiff(a, s.ang) / (2 * half);
        const f = RELIEF[s.id] || ((x2, z2) => 0.2 * cNoise(x2, z2));
        y = f(x, z, u, r);
        const ridge = Math.max(0, 1 - (half - w.d) / 0.09);                         // crestas entre regiones
        y += ridge * (0.5 + 0.4 * cNoise(x * 2, z * 2));
        const path = r < 8.6 ? Math.max(0, 1 - Math.abs(w.d * r) / 0.35) : 0;        // camino hacia el centro
        y -= path * 0.08;
        tmp.copy(s.col).lerp(rock, 0.48 + 0.25 * cNoise(x * 2.2, z * 2.2) + ridge * 0.45);
        if (path > 0) tmp.lerp(s.col, path * 0.5);
      }
      const edge = Math.max(0, (r - (R - 0.8)) / 0.8); // el borde cae hacia la roca de la base
      y -= edge * edge * 0.9;
      tmp.lerp(rock, edge * 0.6);
      pos.push(x, y, z); col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  for (let ri = 0; ri < RS; ri++) for (let ai = 0; ai < AS; ai++) {
    const a = ri * AS + ai, b = ri * AS + (ai + 1) % AS, c = (ri + 1) * AS + ai, d = (ri + 1) * AS + (ai + 1) % AS;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02, flatShading: true, side: THREE.DoubleSide })));
  // roca de la base del continente flotante (como la de las islas)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.1, 3.2, 7, 48, 6, true), new THREE.MeshStandardMaterial({ color: 0x4a4540, roughness: 1, flatShading: true }));
  { const p = base.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = y < 3.4 ? 1 + (cNoise(x * 0.8 + y, z * 0.8) - 0.5) * 0.25 : 1; p.setXYZ(i, x * k, y, z * k); } base.geometry.computeVertexNormals(); }
  base.position.y = -4.4; g.add(base);
  // altura de la superficie en (x, z) (para posar los detalles)
  const heightAt = (x, z) => {
    const r = Math.hypot(x, z), a = Math.atan2(-z, x);
    const ri = Math.min(RS, Math.round((r / R) * RS)), ai = Math.round((((a % TAU) + TAU) % TAU) / TAU * AS) % AS;
    return pos[(ri * AS + ai) * 3 + 1];
  };
  // detalles 3D de cada región (instanciados, con el color de su mundo)
  const add = (geo2, color, list) => {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(geo2, new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true }), list.length);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    list.forEach((o, i) => { e.set(0, o.ry || 0, 0); q.setFromEuler(e); M.compose(new THREE.Vector3(o.x, o.y, o.z), q, new THREE.Vector3(o.s, o.sy || o.s, o.s)); m.setMatrixAt(i, M); });
    g.add(m);
  };
  const cone = new THREE.ConeGeometry(0.22, 0.7, 5); cone.translate(0, 0.35, 0);
  const box = new THREE.BoxGeometry(0.4, 0.35, 0.4); box.translate(0, 0.17, 0);
  const rockG = new THREE.DodecahedronGeometry(0.28, 0); rockG.translate(0, 0.1, 0);
  const bump = new THREE.SphereGeometry(0.5, 10, 6, 0, TAU, 0, Math.PI / 2);
  const cyl = new THREE.CylinderGeometry(0.05, 0.07, 0.6, 5); cyl.translate(0, 0.3, 0);
  const white = new THREE.Color(0xffffff);
  sectors.forEach((s, si) => {
    const L = [];
    let seed = si * 97 + 13;
    const rr = () => vrnd(seed++);
    for (let k = 0; k < 26; k++) {
      const a = s.ang + (rr() - 0.5) * 2 * half * 0.78, r = 5 + rr() * 7.2;
      const x = Math.cos(a) * r, z = -Math.sin(a) * r;
      if (Math.abs(angDiff(a, s.ang)) * r < 0.55 && r < 8.6) continue; // el camino queda libre
      if ((s.id === 'flood' && r > 8.3) || (s.id === 'hurricane' && r > 9.8)) continue; // no en el agua
      L.push({ x, z, y: heightAt(x, z), s: 0.6 + rr() * 0.8, ry: rr() * TAU });
    }
    const dark = s.col.clone().lerp(rock, 0.45), light = s.col.clone().lerp(white, 0.25);
    if (s.id === 'campfire') add(cone, dark.getHex(), L);                                          // bosque
    else if (s.id === 'ice') add(cone, light.getHex(), L.map((o) => ({ ...o, sy: o.s * 1.4 })));     // picos helados
    else if (s.id === 'sandstorm') add(bump, s.col.getHex(), L.map((o) => ({ ...o, sy: o.s * 0.45 }))); // dunas
    else if (s.id === 'quake' || s.id === 'flood') add(box, light.getHex(), L);                       // pueblo / ciudad
    else if (s.id === 'hurricane') { add(box, light.getHex(), L.slice(0, 12)); add(cyl, dark.getHex(), L.slice(12)); } // ciudad y palmeras
    else add(rockG, dark.getHex(), L);                                                                // rocas (Rockslide, volcán)
  });
  // agua de las regiones costeras y lava del volcán
  for (const s of sectors) {
    if (s.id === 'hurricane' || s.id === 'flood') {
      const w = new THREE.Mesh(new THREE.RingGeometry(s.id === 'flood' ? 8.5 : 10, R - 0.25, 24, 1, s.ang - half * 0.9, half * 1.8), new THREE.MeshStandardMaterial({ color: s.col.clone().lerp(rock, 0.35), roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      w.rotation.x = -Math.PI / 2; w.position.y = -0.2; g.add(w);
    }
    if (s.id === 'fire') {
      const x = Math.cos(s.ang) * 9.5, z = -Math.sin(s.ang) * 9.5;
      const lava = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), new THREE.MeshBasicMaterial({ color: s.col.clone().multiplyScalar(1.6), toneMapped: false }));
      lava.rotation.x = -Math.PI / 2; lava.position.set(x, heightAt(x, z) + 0.03, z); g.add(lava);
    }
  }
  // regiones: brillo de su color (al señalarla o elegirla) y camino de energía hacia el centro
  const regions = sectors.map((s) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(RC + 0.2, R - 0.4, 24, 1, s.ang - half * 0.96, half * 1.92), new THREE.MeshBasicMaterial({ color: s.col.clone().multiplyScalar(1.2), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.y = 1.4; m.renderOrder = 3;
    const pathM = new THREE.MeshBasicMaterial({ color: s.col.clone().multiplyScalar(1.5), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
    const path = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.12), pathM);
    path.rotation.order = 'YXZ'; path.rotation.y = s.ang; path.rotation.x = -Math.PI / 2;
    path.position.set(Math.cos(s.ang) * 6.5, 0.06, -Math.sin(s.ang) * 6.5);
    g.add(m, path);
    return { id: s.id, m, pathM, ph: s.ang * 3 };
  });
  const setFocus = (id, k, t) => {
    for (const rg of regions) {
      const on = rg.id === id ? k : 0;
      rg.m.material.opacity = 0.14 * on;
      rg.pathM.opacity = 0.3 + 0.45 * on + 0.1 * Math.sin(t * 3 + rg.ph);
    }
  };
  return { g, setFocus };
}
