import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/* ======================================================================
   FRUTAS MÁGICAS 3D (sustituyen a las piñas doradas coleccionables)
   Cada mundo tiene su fruta propia, modelada a partir de su imagen de referencia:
   · TSUNAMI → APPLE_MANGLATE · HIELO → CLOUDBERRY · ARENA → HORNED_MELON · VOLCÁN → GRANATE
   · HURACÁN → STARFRUIT · TERREMOTO → RAMBUTAN · ROCA → HIGO · CAMP FIRE → DRAGON_FRUIT
   Todo se construye una sola vez por fruta (geometrías fusionadas y materiales compartidos):
   cada copia en el mapa solo añade unas pocas mallas, sin coste extra de geometría.
   ====================================================================== */
const TAU = Math.PI * 2;

export const FRUIT_BY_LEVEL = {
  flood: 'apple_manglate', ice: 'cloudberry', sandstorm: 'horned_melon', fire: 'granate',
  hurricane: 'starfruit', quake: 'rambutan', rockslide: 'higo', campfire: 'dragon_fruit',
  extreme: 'pina', // APOCALIA conserva la piña dorada original
};

// nombre en el contador y color del brillo, las chispas y el aura (tomados de cada imagen)
export const FRUIT_INFO = {
  apple_manglate: { name: 'Apple Manglate', plural: 'Apple Manglates', glow: 0x6dff3a },
  cloudberry: { name: 'Cloudberry', plural: 'Cloudberries', glow: 0x4ad8ff },
  horned_melon: { name: 'Horned Melon', plural: 'Horned Melons', glow: 0x3a9cff },
  granate: { name: 'Granada', plural: 'Granadas', glow: 0xffb020 },
  starfruit: { name: 'Starfruit', plural: 'Starfruits', glow: 0xd04aff },
  rambutan: { name: 'Rambután', plural: 'Rambutanes', glow: 0xff5a20 },
  higo: { name: 'Higo', plural: 'Higos', glow: 0xff3ad0 },
  dragon_fruit: { name: 'Fruta del dragón', plural: 'Frutas del dragón', glow: 0xff3ab0 },
  pina: { name: 'Piña dorada', plural: 'Piñas doradas', glow: 0xffb030 },
};

/* ---------- utilidades de geometría ---------- */
const C = new THREE.Color();
// deja la geometría lista para fusionar: sin índices, con uv y con color por vértice (función de la posición)
function prep(geo, col) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = p.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = typeof col === 'function' ? col(p.getX(i), p.getY(i), p.getZ(i)) : col;
    C.set(v); c[i * 3] = C.r; c[i * 3 + 1] = C.g; c[i * 3 + 2] = C.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
const merge = (list) => mergeGeometries(list, false);
const lerpHex = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), Math.min(1, Math.max(0, t))).getHex();
const grad3 = (a, b, c, t) => (t < 0.5 ? lerpHex(a, b, t * 2) : lerpHex(b, c, (t - 0.5) * 2));
// coloca una geometría apuntando en la dirección dir (eje +Y de la geometría → dir), en pos
function aim(geo, pos, dir, spin = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const m = new THREE.Matrix4().makeRotationY(spin).premultiply(new THREE.Matrix4().makeRotationFromQuaternion(q)).setPosition(pos);
  geo.applyMatrix4(m);
  return geo;
}
// puntos repartidos de forma uniforme sobre una esfera (Fibonacci)
function fib(n, i) {
  const y = 1 - (i + 0.5) / n * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996323;
  return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
}
// espina / cuerno / escama curvada: cono que se dobla hacia `bend` en la punta, con degradado base → punta
function hornGeo(r, h, colBase, colMid, colTip, bend = 0, seg = 7, hs = 6) {
  const g = new THREE.ConeGeometry(r, h, seg, hs).toNonIndexed();
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const t = p.getY(i) / h; p.setX(i, p.getX(i) + bend * t * t * h); }
  g.computeVertexNormals();
  return prep(g, (x, y) => grad3(colBase, colMid, colTip, y / h));
}
// hoja: silueta con curva, plegada en su nervio y arqueada; degradado de color hacia la punta
function leafGeo(len, wid, colBase, colMid, colTip, arch = 0.35) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(wid * 0.9, len * 0.25, wid * 0.7, len * 0.75, 0, len);
  s.bezierCurveTo(-wid * 0.7, len * 0.75, -wid * 0.9, len * 0.25, 0, 0);
  const g = new THREE.ShapeGeometry(s, 8).toNonIndexed();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), t = y / len;
    p.setZ(i, Math.abs(x) * 0.35 + arch * t * t * len); // pliegue en el nervio y arco hacia fuera
  }
  g.computeVertexNormals();
  return prep(g, (x, y) => grad3(colBase, colMid, colTip, y / len));
}

/* ---------- texturas pintadas (piel de cada fruta) ---------- */
function canvasTex(w, h, paint) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);
function speckle(g, w, h, n, col, rmin, rmax) {
  g.fillStyle = col;
  for (let i = 0; i < n; i++) { g.beginPath(); g.arc(Math.random() * w, Math.random() * h, rnd(rmin, rmax), 0, TAU); g.fill(); }
}

/* ---------- material base: brillante, translúcido en los bordes y con resplandor propio ---------- */
function skin(opts) {
  return new THREE.MeshPhysicalMaterial({
    roughness: 0.28, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.15,
    emissiveIntensity: 0.45, vertexColors: true, ...opts,
  });
}
// cintas de energía que envuelven cada fruta (como en las imágenes): 3 arcos inclinados fusionados en una sola malla
function swirls(col, r, n = 3) {
  const arcs = [];
  for (let i = 0; i < n; i++) {
    const arc = 3.6 + i * 0.7, rr = r * (1.05 + i * 0.12);
    const t = new THREE.TorusGeometry(rr, 0.04, 5, 72, arc);
    t.rotateZ(i * 2.1);
    t.rotateX(Math.PI / 2 + (i - 1) * 0.45);
    t.rotateZ((i % 2 ? 1 : -1) * 0.22);
    arcs.push(prep(t, lerpHex(col, 0xffffff, i === 1 ? 0.45 : 0.1)));
  }
  return new THREE.Mesh(merge(arcs), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
}

/* ======================================================================
   MODELOS (construidos a radio ≈ 1; la fruta final se escala al tamaño de la antigua piña)
   ====================================================================== */
const BUILD = {
  // APPLE MANGLATE: manzana verde translúcida con vetas amarillas en espiral, corona de hojas con puntas rojas y tallo marrón
  apple_manglate() {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, a = t * Math.PI;
      const r = Math.sin(a) * (1 + 0.12 * Math.sin(a * 2)) * (t < 0.12 ? 0.75 + t * 2 : 1);
      pts.push(new THREE.Vector2(Math.max(0.001, r), -Math.cos(a) * 0.95 - (t > 0.9 ? (t - 0.9) * 1.2 : 0)));
    }
    const body = new THREE.LatheGeometry(pts, 40);
    const tex = canvasTex(256, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#9be23a'); gr.addColorStop(0.5, '#3fbf2a'); gr.addColorStop(1, '#c8e83a');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.lineCap = 'round';
      for (let k = 0; k < 16; k++) { // vetas amarillas en forma de llama con remates en espiral
        const x0 = Math.random() * w, y0 = rnd(h * 0.15, h * 0.9), a = rnd(0, TAU), L = rnd(22, 40), sgn = Math.random() < 0.5 ? 1 : -1;
        const x1 = x0 + Math.cos(a) * L, y1 = y0 + Math.sin(a) * L * 0.6;
        g.strokeStyle = k % 2 ? 'rgba(245,245,95,0.95)' : 'rgba(215,240,80,0.9)';
        for (const dx of [0, w, -w]) {
          g.lineWidth = rnd(5, 8);
          g.beginPath(); g.moveTo(x0 + dx, y0);
          g.bezierCurveTo(x0 + dx + sgn * 18, y0 - 14, x1 + dx - sgn * 18, y1 + 14, x1 + dx, y1);
          g.stroke();
          g.lineWidth = 4; g.beginPath(); g.arc(x1 + dx + sgn * 5, y1, 6, 0, Math.PI * 1.5, sgn < 0); g.stroke();
        }
      }
      speckle(g, w, h, 120, 'rgba(255,255,200,0.25)', 0.5, 1.6);
    });
    const bodyM = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08, transmission: 0, emissive: 0x2a8a10, emissiveIntensity: 0.45, transparent: true, opacity: 0.94 });
    const stem = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.75, 0), new THREE.Vector3(0.05, 1.15, 0), new THREE.Vector3(0.28, 1.35, 0)), 8, 0.075, 6);
    const leaves = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3, l = leafGeo(1.05, 0.42, 0x3aa82a, 0xb0e83a, 0xff3a1a, 0.35);
      l.rotateX(0.75); l.rotateY(a); l.translate(Math.sin(a) * 0.14, 0.8, Math.cos(a) * 0.14);
      leaves.push(l);
    }
    return {
      parts: [
        [body, bodyM],
        [merge(leaves), skin({ side: THREE.DoubleSide, emissive: 0x4ab020, emissiveIntensity: 0.55 })],
        [prep(stem, 0x7a4220), skin({ roughness: 0.6, clearcoat: 0.2, emissive: 0x000000 })],
      ],
      swirl: 0x5cff3a, r: 1.05,
    };
  },

  // CLOUDBERRY: racimo de drupas naranja-rojizas brillantes con sépalos verdes con bordes rojos; aura cian
  cloudberry() {
    const warm = [], deep = [];
    const dru = (r) => new THREE.SphereGeometry(r, 12, 10);
    for (let ring = 0; ring < 5; ring++) {
      const yy = 0.62 - ring * 0.34, rr = Math.sqrt(Math.max(0.05, 1 - (yy / 1.05) ** 2)) * 0.82, n = Math.max(4, Math.round(rr * 9));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + ring * 0.45, s = 0.27 - ring * 0.012;
        const g = dru(s); g.translate(Math.cos(a) * rr, yy, Math.sin(a) * rr);
        // cada drupa: centro amarillo y borde rojo, como en la imagen
        const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
        const geo = prep(g, (x, y, z) => { const d = Math.hypot(x - cx, y - yy, z - cz) / s; const out = ((x - cx) * cx + (z - cz) * cz) / (s * Math.max(0.01, Math.hypot(cx, cz))); return lerpHex(0xff2a2a, 0xffd23a, Math.max(0, out) * 0.8 + (1 - d) * 0.2); });
        ((ring + k) % 3 ? warm : deep).push(geo);
      }
    }
    const top = dru(0.24); top.translate(0, 0.86, 0); warm.push(prep(top, 0xff7a20));
    const sep = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU, l = leafGeo(0.95, 0.5, 0x9adf2a, 0xe8c840, 0xe03a3a, 0.2);
      l.rotateX(0.75); l.rotateY(a); l.translate(Math.sin(a) * 0.1, 0.92, Math.cos(a) * 0.1);
      sep.push(l);
    }
    return {
      parts: [
        [merge(warm), skin({ emissive: 0xff5010, emissiveIntensity: 0.4, roughness: 0.15 })],
        [merge(deep), skin({ emissive: 0xff2050, emissiveIntensity: 0.45, roughness: 0.15 })],
        [merge(sep), skin({ side: THREE.DoubleSide, emissive: 0x9a8a20, emissiveIntensity: 0.55, roughness: 0.55, clearcoat: 0.3 })],
      ],
      swirl: 0x3ad8ff, r: 1.05,
    };
  },

  // HORNED MELON: ovalado naranja con manchas amarillas y cuernos rojos con punta rosa; aura azul
  horned_melon() {
    const body = new THREE.SphereGeometry(1, 40, 28); body.scale(1.22, 0.95, 0.95);
    const tex = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#ff6a1a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) { // manchas amarillas irregulares (piel de kiwano)
        const x = Math.random() * w, y = Math.random() * h, r = rnd(4, 11);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(255,220,60,0.95)'); gr.addColorStop(1, 'rgba(255,160,30,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
      speckle(g, w, h, 160, 'rgba(210,40,20,0.55)', 0.6, 1.8);
    });
    const horns = [];
    const N = 34;
    for (let i = 0; i < N; i++) {
      const d = fib(N, i); if (d.x < -0.92) continue; // deja libre el pedúnculo
      const pos = new THREE.Vector3(d.x * 1.17, d.y * 0.91, d.z * 0.91);
      horns.push(aim(hornGeo(0.19, 0.48, 0xff6a1a, 0xff2a50, 0xff9ae0, 0.0, 8, 3), pos, d));
    }
    const navel = new THREE.ConeGeometry(0.16, 0.2, 8); navel.rotateZ(Math.PI / 2); navel.translate(-1.25, 0, 0);
    return {
      parts: [
        [body, new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.12, emissive: 0xff4a10, emissiveIntensity: 0.3 })],
        [merge(horns), skin({ emissive: 0xff2050, emissiveIntensity: 0.35, roughness: 0.2 })],
        [prep(navel, 0x5a3418), skin({ roughness: 0.8, clearcoat: 0, emissive: 0x000000 })],
      ],
      swirl: 0x2a8cff, r: 1.35,
    };
  },

  // GRANADA: esfera roja con reflejos magenta, corona de sépalos rojos con semillas en el centro; aura de fuego dorado
  granate() {
    const pts = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24, a = t * Math.PI; pts.push(new THREE.Vector2(Math.max(0.001, Math.sin(a) * (1 - 0.05 * Math.cos(a * 3))), -Math.cos(a) * 0.9)); }
    const body = new THREE.LatheGeometry(pts, 40);
    const tex = canvasTex(256, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#ff3a2a'); gr.addColorStop(0.5, '#d01020'); gr.addColorStop(1, '#8a0a20');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 6; i++) { const x = Math.random() * w, y = Math.random() * h * 0.7, r = rnd(12, 26); const q = g.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, 'rgba(230,60,200,0.55)'); q.addColorStop(1, 'rgba(230,60,200,0)'); g.fillStyle = q; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
      speckle(g, w, h, 500, 'rgba(255,170,80,0.35)', 0.4, 1.2);
    });
    const crown = [];
    const neck = new THREE.CylinderGeometry(0.22, 0.32, 0.25, 16, 1, true); neck.translate(0, 0.98, 0); crown.push(prep(neck, 0xd8201a));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU, d = new THREE.Vector3(Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55);
      crown.push(aim(hornGeo(0.11, 0.38, 0xd8201a, 0xff5a20, 0xffa040, 0.25, 6, 4), new THREE.Vector3(Math.cos(a) * 0.2, 1.06, Math.sin(a) * 0.2), d, 0));
    }
    const seeds = [];
    for (let i = 0; i < 14; i++) { const s = new THREE.SphereGeometry(0.05, 6, 5); const a = rnd(0, TAU), r = rnd(0, 0.15); s.translate(Math.cos(a) * r, 1.06, Math.sin(a) * r); seeds.push(prep(s, 0x4a2a10)); }
    return {
      parts: [
        [body, new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12, emissive: 0xff2010, emissiveIntensity: 0.35 })],
        [merge(crown), skin({ side: THREE.DoubleSide, emissive: 0xff3010, emissiveIntensity: 0.4, roughness: 0.35 })],
        [merge(seeds), skin({ roughness: 0.7, clearcoat: 0, emissive: 0x000000 })],
      ],
      swirl: 0xffb020, r: 1.15,
    };
  },

  // STARFRUIT: carambola en forma de estrella de 5 puntas (amarillo-naranja con bordes rojizos), semillas, tallo y hoja; aura violeta
  starfruit() {
    // sólido con sección de estrella y bordes redondeados, de cara al jugador (eje Z)
    const NA = 120, NZ = 14, pos = [], idx = [];
    const star = (a) => { const k = Math.abs(Math.cos((a * 5) / 2)); return 0.42 + 0.58 * Math.pow(k, 1.6); };
    for (let j = 0; j <= NZ; j++) {
      const t = j / NZ, z = (t - 0.5) * 1.25, sc = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(t - 0.5) * 2, 3))) * 0.92 + 0.08;
      for (let i = 0; i <= NA; i++) { const a = (i / NA) * TAU + Math.PI / 2, r = star(a - Math.PI / 2) * sc; pos.push(Math.cos(a) * r, Math.sin(a) * r, z); }
    }
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, b = a + NA + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const capF = [], capB = [];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const body = prep(g, (x, y) => { const r = Math.hypot(x, y); return grad3(0xff3a10, 0xff9a1a, 0xffe040, Math.min(1, r * 1.1)); });
    // tapas de los extremos (dejan ver la estrella con su centro claro)
    for (const [zz, list] of [[0.625, capF], [-0.625, capB]]) {
      const s = new THREE.Shape();
      for (let i = 0; i <= NA; i++) { const a = (i / NA) * TAU + Math.PI / 2, r = star(a - Math.PI / 2) * 0.08; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      const cg = new THREE.ShapeGeometry(s); if (zz < 0) cg.rotateY(Math.PI); cg.translate(0, 0, zz); list.push(prep(cg, 0xffd040));
    }
    const face = new THREE.Shape(); // cara frontal visible: estrella completa de pulpa más clara
    for (let i = 0; i <= NA; i++) { const a = (i / NA) * TAU + Math.PI / 2, r = star(a - Math.PI / 2) * 0.86; i ? face.lineTo(Math.cos(a) * r, Math.sin(a) * r) : face.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const fF = new THREE.ShapeGeometry(face, 2); fF.translate(0, 0, 0.5);
    const fB = new THREE.ShapeGeometry(face, 2); fB.rotateY(Math.PI); fB.translate(0, 0, -0.5);
    const pulp = [prep(fF, (x, y) => grad3(0xfff4a0, 0xffc030, 0xff6a1a, Math.hypot(x, y))), prep(fB, (x, y) => grad3(0xfff4a0, 0xffc030, 0xff6a1a, Math.hypot(x, y)))];
    const seeds = [];
    for (const zs of [1, -1]) for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + Math.PI / 2, s = new THREE.SphereGeometry(0.075, 8, 6); s.scale(1, 2.2, 0.5);
      s.rotateZ(a - Math.PI / 2); s.translate(Math.cos(a) * 0.3, Math.sin(a) * 0.3, zs * 0.53); seeds.push(prep(s, 0x7a3a1a));
    }
    const stem = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.85, 0), new THREE.Vector3(0.02, 1.15, 0), new THREE.Vector3(0.12, 1.3, 0)), 6, 0.06, 6);
    const leaf = leafGeo(0.8, 0.36, 0x5a8a20, 0x9ac040, 0x6a9a20, 0.3); leaf.rotateZ(-1.2); leaf.translate(0.14, 1.28, 0.02);
    return {
      parts: [
        [merge([body, ...capF, ...capB]), skin({ side: THREE.DoubleSide, emissive: 0xff7010, emissiveIntensity: 0.35, roughness: 0.22 })],
        [merge(pulp), skin({ side: THREE.DoubleSide, emissive: 0xffa020, emissiveIntensity: 0.45, roughness: 0.3 })],
        [merge(seeds), skin({ roughness: 0.3, emissive: 0x2a0a00, emissiveIntensity: 0.2 })],
        [merge([prep(stem, 0x6a3a1a), leaf]), skin({ side: THREE.DoubleSide, roughness: 0.5, clearcoat: 0.4, emissive: 0x101800, emissiveIntensity: 0.3 })],
      ],
      swirl: 0xd03aff, r: 1.15,
    };
  },

  // RAMBUTÁN: esfera roja cubierta de pelos rizados rojos con punta amarilla, tallo y una hoja; aura roja y dorada
  rambutan() {
    const body = new THREE.IcosahedronGeometry(0.9, 4);
    const pb = body.attributes.position;
    for (let i = 0; i < pb.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(pb, i); const k = 1 + 0.05 * Math.sin(v.x * 11) * Math.sin(v.y * 13) * Math.sin(v.z * 9); v.multiplyScalar(k); pb.setXYZ(i, v.x, v.y, v.z); }
    body.computeVertexNormals();
    const hairs = [];
    const N = 70;
    for (let i = 0; i < N; i++) {
      const d = fib(N, i), base = d.clone().multiplyScalar(0.86);
      const side = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
      const L = rnd(0.45, 0.7);
      const c = new THREE.CubicBezierCurve3(base, base.clone().addScaledVector(d, L * 0.5), base.clone().addScaledVector(d, L * 0.9).addScaledVector(side, L * 0.35), base.clone().addScaledVector(d, L * 0.75).addScaledVector(side, L * 0.62));
      const tube = new THREE.TubeGeometry(c, 7, 0.045, 4, false);
      // degradado a lo largo del pelo: rojo en la base, amarillo en la punta
      const cols = [];
      const tg = tube.toNonIndexed(), q = tg.attributes.position;
      for (let k = 0; k < q.count; k++) { const v = new THREE.Vector3().fromBufferAttribute(q, k); cols.push(v.distanceTo(base) / (L * 1.05)); }
      let n = 0; hairs.push(prep(tg, () => grad3(0xd0102a, 0xff4a1a, 0xffd23a, cols[n++])));
    }
    const stem = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.85, 0), new THREE.Vector3(0.05, 1.25, 0), new THREE.Vector3(0.22, 1.45, 0)), 6, 0.06, 6);
    const leaf = leafGeo(0.95, 0.45, 0x3a7a1a, 0x7ab02a, 0xa8c040, 0.25); leaf.rotateZ(-1.35); leaf.translate(0.22, 1.42, 0);
    return {
      parts: [
        [prep(body, 0xd0102a), skin({ emissive: 0xc01020, emissiveIntensity: 0.4, roughness: 0.25 })],
        [merge(hairs), skin({ emissive: 0xff3010, emissiveIntensity: 0.35, roughness: 0.25 })],
        [merge([prep(stem, 0x6a3a1a), leaf]), skin({ side: THREE.DoubleSide, roughness: 0.5, clearcoat: 0.4, emissive: 0x081000, emissiveIntensity: 0.2 })],
      ],
      swirl: 0xff3a20, r: 1.3,
    };
  },

  // HIGO (chumbo): alargado, degradado verde-amarillo → naranja → rojo-magenta, areolas marrones con espinas doradas,
  // extremo abierto marrón y cristales rosas flotando; aura magenta y dorada
  higo() {
    const body = new THREE.SphereGeometry(1, 40, 28); body.scale(1.35, 0.85, 0.85);
    const bodyG = prep(body, (x) => { const t = (x / 1.35 + 1) / 2; return grad3(0xd8e83a, 0xff5a1a, 0xe81a6a, t); });
    const end = new THREE.CylinderGeometry(0.3, 0.38, 0.22, 14, 1, true); end.rotateZ(Math.PI / 2); end.translate(-1.32, 0, 0);
    const endIn = new THREE.CircleGeometry(0.3, 14); endIn.rotateY(-Math.PI / 2); endIn.translate(-1.28, 0, 0);
    const are = [], spines = [];
    const N = 30;
    for (let i = 0; i < N; i++) {
      const d = fib(N, i); if (d.x < -0.85) continue;
      const pos = new THREE.Vector3(d.x * 1.33, d.y * 0.84, d.z * 0.84);
      const nrm = new THREE.Vector3(d.x / 1.35, d.y / 0.85, d.z / 0.85).normalize();
      are.push(aim(prep(new THREE.CylinderGeometry(0.075, 0.09, 0.05, 8), 0x7a4a1a), pos, nrm));
      for (let k = 0; k < 3; k++) {
        const dir = nrm.clone().add(new THREE.Vector3(rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(-0.5, 0.5))).normalize();
        spines.push(aim(hornGeo(0.018, rnd(0.22, 0.34), 0xc88a2a, 0xffc040, 0xfff0a0, 0, 4, 1), pos, dir));
      }
    }
    return {
      parts: [
        [bodyG, skin({ emissive: 0xff2a3a, emissiveIntensity: 0.3, roughness: 0.2 })],
        [merge([prep(end, 0x8a5a2a), prep(endIn, 0x4a2a10), ...are]), skin({ side: THREE.DoubleSide, roughness: 0.85, clearcoat: 0, emissive: 0x000000 })],
        [merge(spines), skin({ metalness: 0.4, roughness: 0.3, emissive: 0xffa020, emissiveIntensity: 0.35 })],
      ],
      swirl: 0xff3ad0, r: 1.5, crystals: 0xff6ae0,
    };
  },

  // FRUTA DEL DRAGÓN: cuerpo magenta cubierto de escamas curvas (magenta → amarillo → verde en la punta); aura magenta y dorada
  dragon_fruit() {
    const body = new THREE.SphereGeometry(0.85, 36, 26); body.scale(1, 1.18, 1);
    const scales = [];
    const rows = 5;
    for (let r = 0; r < rows; r++) {
      const yy = -0.85 + r * 0.42, n = 6 + (r % 2), rad = Math.sqrt(Math.max(0.08, 1 - (yy / 1.0) ** 2)) * 0.85;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + r * 0.55, d = new THREE.Vector3(Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55).normalize();
        const s = hornGeo(0.3 - r * 0.012, 0.6 + r * 0.04, 0xff1a6a, 0xffb020, 0x5ae02a, 0.75, 10, 6);
        s.scale(0.4, 1, 1.5); // escama aplanada: pegada a la piel y curvada hacia fuera
        aim(s, new THREE.Vector3(Math.cos(a) * rad, yy, Math.sin(a) * rad), d, -a);
        scales.push(s);
      }
    }
    // remate superior: escamas altas en forma de llama
    for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.4; scales.push(aim(hornGeo(0.17, 0.7, 0xff1a6a, 0xffc020, 0x5ae02a, 0.6, 8, 6), new THREE.Vector3(Math.cos(a) * 0.15, 0.92, Math.sin(a) * 0.15), new THREE.Vector3(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4))); }
    return {
      parts: [
        [prep(body, 0xf01a62), skin({ emissive: 0xe0105a, emissiveIntensity: 0.4, roughness: 0.3 })],
        [merge(scales), skin({ side: THREE.DoubleSide, emissive: 0xff2a5a, emissiveIntensity: 0.3, roughness: 0.22 })],
      ],
      swirl: 0xff3ab0, r: 1.25,
    };
  },
};

// PIÑA DORADA (Apocalia): el mismo modelo, tamaño y materiales de la piña original del juego
BUILD.pina = function () {
  const k = 1 / 0.32; // la fruta se escala ×0.32 al colocarla: así conserva exactamente su tamaño original
  const o = new THREE.Object3D();
  const at = (geo, setup) => { setup(o); o.updateMatrix(); const g = geo.clone().applyMatrix4(o.matrix); o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); g.scale(k, k, k); return prep(g, 0xffffff); };
  const core = new THREE.SphereGeometry(0.24, 10, 8); core.scale(1, 1.45, 1); core.scale(k, k, k);
  const scaleG = new THREE.ConeGeometry(0.1, 0.14, 5), leafG = new THREE.ConeGeometry(0.09, 0.26, 5);
  const scales = [];
  for (let r = 0; r < 4; r++) for (let q = 0; q < 5; q++) {
    const a = (q / 5) * TAU + r * 0.6, y = -0.22 + r * 0.15, rad = 0.2 * Math.sin(Math.PI * (0.25 + r * 0.17));
    scales.push(at(scaleG, (m) => { m.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad); m.lookAt(m.position.x * 3, y - 0.3, m.position.z * 3); }));
  }
  const leaves = [0, 2.1, 4.2].map((a) => at(leafG, (m) => { m.position.set(Math.cos(a) * 0.05, 0.38, Math.sin(a) * 0.05); m.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); }));
  return {
    parts: [
      [core, new THREE.MeshStandardMaterial({ color: 0xffc23a, emissive: 0xff9a10, emissiveIntensity: 0.3, metalness: 0.6, roughness: 0.3 })],
      [merge(scales), new THREE.MeshStandardMaterial({ color: 0xd8901a, emissive: 0xa85a00, emissiveIntensity: 0.4, metalness: 0.6, roughness: 0.35 })],
      [merge(leaves), new THREE.MeshStandardMaterial({ color: 0x4ac05a, emissive: 0x1a6a2a, emissiveIntensity: 0.4 })],
    ],
    swirl: null, // la piña original no llevaba cintas de energía
  };
};

/* ---------- caché: cada fruta se construye una sola vez ---------- */
const CACHE = {};
function proto(id) {
  if (!CACHE[id]) CACHE[id] = BUILD[id]();
  return CACHE[id];
}
let HALO = null;
function haloTex() {
  if (HALO) return HALO;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  HALO = new THREE.CanvasTexture(c);
  return HALO;
}
const HALO_M = {};
export function fruitHaloMaterial(id) {
  if (!HALO_M[id]) HALO_M[id] = new THREE.MeshBasicMaterial({ map: haloTex(), color: FRUIT_INFO[id].glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 });
  return HALO_M[id];
}
const CRYSTAL = new THREE.OctahedronGeometry(0.09, 0);

/* Crea una copia de la fruta del tamaño de la antigua piña (≈0.6 de alto). Devuelve el grupo;
   `group.userData.anim(t, dt)` hace girar sus cintas de energía. */
export function makeFruit(id, size = 0.32) {
  const P = proto(id);
  const g = new THREE.Group();
  const model = new THREE.Group();
  P.parts.forEach(([geo, mat], i) => { const m = new THREE.Mesh(geo, mat); m.castShadow = i === 0; model.add(m); });
  g.add(model);
  const sw = P.swirl ? P.swirlObj || (P.swirlObj = swirls(P.swirl, P.r)) : null;
  const swc = sw ? new THREE.Mesh(sw.geometry, sw.material) : new THREE.Object3D();
  g.add(swc);
  let cr = null;
  if (P.crystals) {
    const cm = P.crystalM || (P.crystalM = new THREE.MeshStandardMaterial({ color: P.crystals, emissive: P.crystals, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.15, transparent: true, opacity: 0.9 }));
    cr = new THREE.Group();
    for (let i = 0; i < 5; i++) { const m = new THREE.Mesh(CRYSTAL, cm); const a = (i / 5) * TAU; m.position.set(Math.cos(a) * 1.75, (i % 2 ? 0.5 : -0.55), Math.sin(a) * 1.75); m.scale.set(1, 1.6, 1); cr.add(m); }
    g.add(cr);
  }
  g.scale.setScalar(size);
  g.userData.anim = (t) => {
    swc.rotation.y = t * 1.3;
    if (cr) { cr.rotation.y = -t * 0.7; for (const m of cr.children) m.rotation.y = t * 2; }
  };
  return g;
}

/* ======================================================================
   LOTE DE FRUTAS (instanciado): todas las frutas de un mapa se dibujan con una sola llamada por pieza
   (cuerpo, hojas, cintas de energía, aura...), en lugar de varias mallas por fruta. Camp Fire tiene más de
   cien: así cuestan lo mismo que unas pocas.
   ====================================================================== */
const _M = new THREE.Matrix4(), _M2 = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _V = new THREE.Vector3(), _S = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
const HALO_GEO = new THREE.PlaneGeometry(1.4, 1.4);
export class FruitBatch {
  constructor(id, n, size = 0.32) {
    const P = proto(id);
    this.n = n; this.size = size;
    this.group = new THREE.Group();
    const inst = (geo, mat, count, shadow = false) => {
      const m = new THREE.InstancedMesh(geo, mat, count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false; // se actualizan cada fotograma; una sola llamada de dibujo por pieza
      m.castShadow = shadow;
      this.group.add(m);
      return m;
    };
    this.parts = P.parts.map(([geo, mat], i) => inst(geo, mat, n, i === 0));
    const sw = P.swirl ? P.swirlObj || (P.swirlObj = swirls(P.swirl, P.r)) : null;
    this.swirl = sw ? inst(sw.geometry, sw.material, n) : null;
    this.halo = inst(HALO_GEO, fruitHaloMaterial(id), n);
    this.halo.renderOrder = 2;
    if (P.crystals) {
      const cm = P.crystalM || (P.crystalM = new THREE.MeshStandardMaterial({ color: P.crystals, emissive: P.crystals, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.15, transparent: true, opacity: 0.9 }));
      this.crystals = inst(CRYSTAL, cm, n * 5);
    }
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }
  // coloca la fruta i: posición, giro sobre sí misma, escala extra (animación al recogerla) y fase de sus cintas
  set(i, x, y, z, rotY, scale, t, ph, camQ) {
    const s = this.size * scale;
    _Q.setFromAxisAngle(_Y, rotY);
    _M.compose(_V.set(x, y, z), _Q, _S.set(s, s, s));
    for (const m of this.parts) m.setMatrixAt(i, _M);
    if (this.swirl) { _Q.setFromAxisAngle(_Y, rotY + t * 1.3 + ph); this.swirl.setMatrixAt(i, _M2.compose(_V, _Q, _S)); }
    if (this.crystals) for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU - t * 0.7 + ph;
      _V.set(x + Math.cos(a) * 1.75 * s, y + (k % 2 ? 0.5 : -0.55) * s, z + Math.sin(a) * 1.75 * s);
      _Q.setFromAxisAngle(_Y, t * 2 + k);
      this.crystals.setMatrixAt(i * 5 + k, _M2.compose(_V, _Q, _S.set(s, s * 1.6, s)));
    }
    const hs = (scale > 0 ? 0.8 * Math.max(0.01, scale) : 0);
    this.halo.setMatrixAt(i, _M2.compose(_V.set(x, y, z), camQ, _S.set(hs, hs, hs)));
  }
  hide(i) {
    for (const m of this.parts) m.setMatrixAt(i, this.zero);
    if (this.swirl) this.swirl.setMatrixAt(i, this.zero);
    this.halo.setMatrixAt(i, this.zero);
    if (this.crystals) for (let k = 0; k < 5; k++) this.crystals.setMatrixAt(i * 5 + k, this.zero);
  }
  commit() {
    for (const m of this.group.children) m.instanceMatrix.needsUpdate = true;
  }
}

/* ======================================================================
   REPARTO DE FRUTAS en los mundos que no tenían piñas (todos menos Camp Fire y Volcán, que conservan
   exactamente las posiciones de sus piñas). Se usan los puntos accesibles del propio escenario (los mismos
   que sirven para rescates y objetos): sitios alcanzables, sin colisiones encima y lejos de la salida y
   del refugio. Posiciones estables por mundo (misma semilla en cada partida).
   ====================================================================== */
const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const FRUITS_PER_WORLD = 40;
export function placeFruitSpots(levelId, world, CFG, avoid = [], n = FRUITS_PER_WORLD) {
  const S = CFG.SAFE, T = CFG.START, reach = world.reach;
  const free = (x, y, z) => {
    const near = world.solidsNear(x - 0.8, x + 0.8, z - 0.8, z + 0.8, []);
    for (const s of near) if (s.x0 < x + 0.6 && s.x1 > x - 0.6 && s.z0 < z + 0.6 && s.z1 > z - 0.6 && s.y0 < y + 1.8 && s.y1 > y + 0.16) return false;
    return true;
  };
  const ok = [];
  for (const c of world.candidates || []) {
    if (c.needsTool) continue;
    const { x, y, z } = c;
    if (Math.abs(x) > 106 || Math.abs(z) > 106) continue;
    if (Math.hypot(x - T.x, z - T.z) < 6) continue;
    if (Math.hypot(x - S.x, z - S.z) < (S.r || 8) + 3) continue;
    if (world.noSpawn && world.noSpawn(x, z)) continue;
    if (y < (world.waterY ?? -99) - 0.2) continue; // nunca bajo el agua
    if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < 2.5)) continue;
    if (!free(x, y, z)) continue;
    if (reach && !reach.isReachable(x, y, z)) continue;
    ok.push({ x, y, z });
  }
  const rnd = mulberry(hashStr(levelId + ':frutas'));
  for (let i = ok.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ok[i], ok[j]] = [ok[j], ok[i]]; }
  const out = [];
  // separadas entre sí para invitar a explorar todo el mapa (si no caben, se acercan poco a poco)
  for (const sep of [12, 8, 5, 3]) {
    for (const c of ok) {
      if (out.length >= n) break;
      if (out.every((o) => Math.hypot(o.x - c.x, o.z - c.z) >= sep)) out.push(c);
    }
    if (out.length >= n) break;
  }
  return out.map((c) => ({ x: c.x, y: c.y + 0.9, z: c.z, kind: 'cone' }));
}
