import * as THREE from 'three';
import { terrainH } from '../terrain.js';

// CAPA VISUAL de habilidades y ataques. Aquí NO hay lógica de juego: solo mallas y partículas
// (anillos, conos y franjas de aviso, rayos, cuerdas/lenguas, estelas, eclipse...).
// La lógica (daño, empuje, estados) vive en skills/hero.js, skills/bossatk.js y combat.js.

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const Y = new THREE.Vector3(0, 1, 0);

function basic(color, opacity = 0.5, additive = false) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
}

const sectorCache = new Map();
function sectorGeo(half) {
  const key = Math.round(half * 100);
  if (!sectorCache.has(key)) {
    const g = new THREE.CircleGeometry(1, 40, -half, half * 2);
    g.rotateX(-Math.PI / 2); // centrado en +X, tumbado sobre el suelo
    sectorCache.set(key, g);
  }
  return sectorCache.get(key);
}

export class Vfx {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = [];
    this.ringGeo = new THREE.RingGeometry(0.92, 1, 48);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.discGeo = new THREE.CircleGeometry(1, 40);
    this.discGeo.rotateX(-Math.PI / 2);
    this.cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
    this.sphGeo = new THREE.SphereGeometry(1, 14, 10);
    this.planeGeo = new THREE.PlaneGeometry(1, 1);
    this.planeGeo.rotateX(-Math.PI / 2);
  }

  /* ---------- ciclo de vida ---------- */
  add(obj, life, onUpdate) {
    this.group.add(obj);
    const it = { obj, life, t: 0, onUpdate, dead: false };
    this.items.push(it);
    return it;
  }
  kill(it) {
    if (!it || it.dead) return;
    it.dead = true;
    this.group.remove(it.obj);
    it.obj.traverse((o) => { if (o.material && o.material.dispose && o.userData.own) o.material.dispose(); });
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.dead) { this.items.splice(i, 1); continue; }
      it.t += dt;
      if (it.onUpdate) it.onUpdate(it, dt);
      if (it.life > 0 && it.t >= it.life) { this.kill(it); this.items.splice(i, 1); }
    }
  }
  clear() {
    for (const it of this.items) this.kill(it);
    this.items.length = 0;
  }
  ground(x, z) { return terrainH(x, z) + 0.07; }

  /* ---------- anillos y ondas ---------- */
  // Anillo que se expande y se desvanece (ondas de choque, salpicaduras...)
  ring(x, y, z, { r0 = 0.5, r1 = 6, dur = 0.6, color = 0xffffff, opacity = 0.8, additive = true } = {}) {
    const m = new THREE.Mesh(this.ringGeo, basic(color, opacity, additive));
    m.userData.own = true;
    m.position.set(x, y ?? this.ground(x, z), z);
    m.renderOrder = 4;
    return this.add(m, dur, (it) => {
      const k = it.t / dur;
      m.scale.setScalar(r0 + (r1 - r0) * (1 - Math.pow(1 - k, 2)));
      m.material.opacity = opacity * (1 - k);
    });
  }

  /* ---------- AVISOS en el suelo (telegraph) ---------- */
  // disc / cone / strip con relleno que avanza (progress 0..1): el jugador ve cuánto falta
  telegraph(shape, { x = 0, z = 0, r = 3, angle = 0, half = 0.5, range = 8, width = 2, x2 = 0, z2 = 0, color = 0xff4a1a, opacity = 0.32 } = {}) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(shape === 'cone' ? sectorGeo(half) : shape === 'strip' ? this.planeGeo : this.discGeo, basic(color, opacity * 0.55));
    const fill = new THREE.Mesh(shape === 'cone' ? sectorGeo(half) : shape === 'strip' ? this.planeGeo : this.discGeo, basic(color, opacity * 1.3, true));
    const edge = shape === 'disc' ? new THREE.Mesh(this.ringGeo, basic(color, 0.9, true)) : null;
    base.userData.own = fill.userData.own = true;
    base.renderOrder = 3; fill.renderOrder = 4;
    g.add(base, fill);
    if (edge) { edge.userData.own = true; edge.renderOrder = 5; g.add(edge); }
    const h = { group: g, shape, color, progress: 0, killed: false, it: null };
    h.set = (nx, nz, o = {}) => {
      x = nx; z = nz;
      if (o.r !== undefined) r = o.r;
      if (o.angle !== undefined) angle = o.angle;
      if (o.range !== undefined) range = o.range;
      if (o.x2 !== undefined) { x2 = o.x2; z2 = o.z2; }
      h.layout();
    };
    h.layout = () => {
      const y = this.ground(x, z);
      const k = Math.max(0.001, h.progress);
      if (shape === 'disc') {
        g.position.set(x, y, z);
        base.scale.setScalar(r); fill.scale.setScalar(Math.max(0.01, r * k)); edge.scale.setScalar(r);
      } else if (shape === 'cone') {
        g.position.set(x, y, z);
        g.rotation.y = angle - Math.PI / 2;
        base.scale.setScalar(range); fill.scale.setScalar(Math.max(0.01, range * k));
      } else { // strip: del punto (x,z) al (x2,z2)
        const dx = x2 - x, dz = z2 - z, len = Math.hypot(dx, dz) || 0.01;
        g.position.set(x + dx / 2, y, z + dz / 2);
        g.rotation.y = Math.atan2(dx, dz) - Math.PI / 2;
        base.scale.set(len, 1, width);
        fill.scale.set(Math.max(0.01, len * k), 1, width * 0.96);
        // la franja se rellena desde el origen
        fill.position.x = -len / 2 + (len * k) / 2;
      }
    };
    h.setProgress = (p) => {
      h.progress = Math.min(1, Math.max(0, p));
      fill.material.opacity = opacity * (0.9 + 0.7 * h.progress);
      h.layout();
    };
    h.kill = () => { if (!h.killed) { h.killed = true; this.kill(h.it); } };
    h.layout();
    h.it = this.add(g, 0, (it) => { if (!h.killed) { /* pulso sutil */ base.material.opacity = opacity * (0.5 + 0.2 * Math.sin(it.t * 14)); } });
    return h;
  }

  /* ---------- cuerda / lengua / rayo: cilindro entre dos puntos ---------- */
  rope({ radius = 0.08, color = 0xffffff, opacity = 0.95, additive = false } = {}) {
    const m = new THREE.Mesh(this.cylGeo, basic(color, opacity, additive));
    m.userData.own = true;
    m.renderOrder = 6;
    const tip = new THREE.Mesh(this.sphGeo, basic(color, opacity, additive));
    tip.userData.own = true;
    const g = new THREE.Group();
    g.add(m, tip);
    const h = { group: g, killed: false, it: null };
    const d = new THREE.Vector3();
    h.set = (a, b, r = radius) => {
      d.subVectors(b, a);
      const len = Math.max(0.001, d.length());
      m.position.copy(a).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(Y, d.clone().divideScalar(len));
      m.scale.set(r, len, r);
      tip.position.copy(b);
      tip.scale.setScalar(r * 1.8);
    };
    h.setColor = (c) => { m.material.color.set(c); tip.material.color.set(c); };
    h.kill = () => { if (!h.killed) { h.killed = true; this.kill(h.it); } };
    h.it = this.add(g, 0);
    return h;
  }

  // Rayo con zigzag (parpadea y desaparece)
  bolt(a, b, { color = 0xbfe8ff, life = 0.14, jag = 0.5, segs = 9 } = {}) {
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = new THREE.Vector3().lerpVectors(a, b, t);
      if (i && i < segs) p.add(new THREE.Vector3(rnd(-jag, jag), rnd(-jag, jag) * 0.6, rnd(-jag, jag)));
      pts.push(p);
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const l1 = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
    const l2 = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    l2.position.y += 0.03; l1.position.y -= 0.03; l1.position.x += 0.03;
    const grp = new THREE.Group();
    grp.add(l1, l2);
    l1.userData.own = l2.userData.own = true;
    return this.add(grp, life, (it) => { const k = 1 - it.t / life; l1.material.opacity = k; l2.material.opacity = k * 0.9; });
  }

  // Estela plana en el suelo (agua de la Nutria): devuelve un manejador con la zona para la jugabilidad
  strip(a, b, { width = 2, color = 0x5ac8ff, opacity = 0.45, life = 3 } = {}) {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 0.01;
    const m = new THREE.Mesh(this.planeGeo, basic(color, opacity, true));
    m.userData.own = true;
    m.position.set(a.x + dx / 2, this.ground(a.x + dx / 2, a.z + dz / 2) + 0.03, a.z + dz / 2);
    m.rotation.y = Math.atan2(dx, dz) - Math.PI / 2;
    m.scale.set(len, 1, width);
    m.renderOrder = 3;
    return this.add(m, life, (it) => {
      const k = it.t / life;
      m.material.opacity = opacity * (k < 0.12 ? k / 0.12 : 1 - Math.max(0, (k - 0.55) / 0.45));
      m.scale.z = width * (1 + 0.05 * Math.sin(it.t * 6));
    });
  }

  // Pequeña esfera luminosa temporal (ojos que brillan, orbes, núcleos)
  orb(pos, { r = 0.2, color = 0xffffff, opacity = 0.95, life = 0.4, grow = 0 } = {}) {
    const m = new THREE.Mesh(this.sphGeo, basic(color, opacity, true));
    m.userData.own = true;
    m.position.copy(pos);
    m.scale.setScalar(r);
    return this.add(m, life, (it) => { const k = it.t / (life || 1); m.scale.setScalar(r * (1 + grow * k)); m.material.opacity = opacity * (1 - k); });
  }

  /* ---------- eclipse: disco oscuro con corona (siempre mira a la cámara) ---------- */
  eclipse(camera, pos, { r = 5, life = 5, color = 0xffc24a } = {}) {
    const g = new THREE.Group();
    const dark = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ color: 0x05030a, transparent: true, opacity: 0.0, depthWrite: false }));
    const corona = new THREE.Mesh(new THREE.RingGeometry(r * 1.0, r * 1.5, 56), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    const halo = new THREE.Mesh(new THREE.RingGeometry(r * 1.5, r * 2.4, 56), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    dark.userData.own = corona.userData.own = halo.userData.own = true;
    dark.renderOrder = 1; corona.renderOrder = 2; halo.renderOrder = 2;
    g.add(halo, corona, dark);
    g.position.copy(pos);
    return this.add(g, life, (it) => {
      g.lookAt(camera.position);
      const k = it.t / life;
      const a = k < 0.12 ? k / 0.12 : k > 0.85 ? (1 - k) / 0.15 : 1;
      dark.material.opacity = 0.95 * a;
      corona.material.opacity = (0.75 + 0.2 * Math.sin(it.t * 9)) * a;
      halo.material.opacity = 0.28 * a;
      corona.rotation.z += 0.01;
    });
  }

  /* ---------- ráfagas de partículas (usan el sistema fx existente) ---------- */
  dust(x, y, z, n = 8, k = 1.6) { for (let i = 0; i < n; i++) this.fx.dustPuff(x + rnd(-1, 1), y, z + rnd(-1, 1), k); }
  sand(x, y, z, n = 6) { for (let i = 0; i < n; i++) { this.fx.dustPuff(x + rnd(-1.5, 1.5), y + rnd(0, 1.6), z + rnd(-1.5, 1.5), 1.9); this.fx.mist(x + rnd(-1.5, 1.5), y + rnd(0.3, 2), z + rnd(-1.5, 1.5), 0xd8b878, 2.2); } }
  sparks(x, y, z, col = 0xffe070, n = 10, spd = 2.4) { for (let i = 0; i < n; i++) this.fx.sparkle(x + rnd(-0.6, 0.6), y + rnd(-0.3, 0.6), z + rnd(-0.6, 0.6), col, spd); }
  leaves(x, y, z, cols = [0xd8742a, 0xc8a02a, 0x9a4a1a], n = 8) { for (let i = 0; i < n; i++) this.fx.sparkle(x + rnd(-1.5, 1.5), y + rnd(0, 2.2), z + rnd(-1.5, 1.5), cols[i % cols.length], 1.4); }
  petals(x, y, z, n = 8) { for (let i = 0; i < n; i++) this.fx.sparkle(x + rnd(-1.6, 1.6), y + rnd(0, 1.6), z + rnd(-1.6, 1.6), i % 2 ? 0xff9ad0 : 0x9aff9a, 1.2); }
  splash(x, y, z, n = 14, power = 1) { this.fx.splash(x, y, z, n, power); }
  ice(x, y, z, n = 6) { for (let i = 0; i < n; i++) { this.fx.iceShard(x + rnd(-1.2, 1.2), y + rnd(0, 1.4), z + rnd(-1.2, 1.2), 1.2); this.fx.snow(x + rnd(-1.5, 1.5), y + rnd(0, 2), z + rnd(-1.5, 1.5)); } }
  fire(x, y, z, n = 8, k = 1.2) { for (let i = 0; i < n; i++) { this.fx.flame(x + rnd(-1, 1), y + rnd(0, 0.8), z + rnd(-1, 1), k, 0.2); this.fx.ember(x + rnd(-1, 1), y + rnd(0, 1.4), z + rnd(-1, 1), 0.9); } }
}
