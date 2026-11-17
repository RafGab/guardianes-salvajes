import * as THREE from 'three';

// CONGELACIÓN MASIVA (Aurora Polar de Kira): todos los personajes de la escena (enemigos, jefe, compañeros del
// equipo y personas a rescatar) se van parando poco a poco hasta quedar inmóviles, cubiertos por una capa fina
// de escarcha y con cristales de hielo a sus pies. Al terminar se descongelan poco a poco y siguen como antes.
// No cambia modelos ni animaciones: solo ralentiza su tiempo (k = 0 normal … 1 congelado) y añade la escarcha encima.
// La heroína que lanza la aurora sigue moviéndose (el jugador nunca pierde el control).
const FADE_IN = 0.9, FADE_OUT = 0.9;

export class FrostFreeze {
  constructor(game) {
    this.g = game;
    this.T = 0; this.dur = 0; this.k = 0;
    this.items = new Map();  // raíz del personaje → { overlays, crystals }
    this.mat = new THREE.MeshStandardMaterial({ color: 0xd8f4ff, emissive: 0x5ac8ff, emissiveIntensity: 0.18, roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.cMat = new THREE.MeshStandardMaterial({ color: 0xbfeaff, emissive: 0x3ab8e0, emissiveIntensity: 0.25, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85, flatShading: true });
    this.cGeo = new THREE.ConeGeometry(0.09, 0.5, 5); this.cGeo.translate(0, 0.25, 0);
  }
  get active() { return this.T > 0; }
  start(dur) {
    if (this.T > 0) { this.T = Math.max(this.T, dur); this.dur = Math.max(this.dur, dur); return; }
    this.T = dur; this.dur = dur;
  }
  // personajes de la escena (no la heroína del jugador)
  roots() {
    const g = this.g, out = [];
    const me = g.player && g.player.model && g.player.model.root;
    if (g.boss && g.boss.model && g.boss.state !== 'dead') out.push(g.boss.model.root);
    for (const m of (g.combat && g.combat.minions) || []) if (!m.dead && m.group) out.push(m.group);
    for (const m of (g.combat && g.combat.orcs) || []) if (!m.dead && m.group) out.push(m.group);
    for (const a of (g.allies && g.allies.list) || []) if (a.model && a.model.root && a.model.root !== me && a.model.root.visible) out.push(a.model.root);
    if (g.ally && g.ally.model && g.ally.model.root) out.push(g.ally.model.root);
    for (const v of g.victims || []) if (v.root && v.state !== 'carried' && v.state !== 'saved' && v.root.visible) out.push(v.root);
    return out.filter((r) => r && r !== me);
  }
  // capa de escarcha: una copia transparente de cada malla que se deforma con el mismo esqueleto
  frost(root) {
    const overlays = [];
    root.traverse((o) => {
      if (!o.isMesh || o.userData.frost || !o.geometry || o.material && o.material.transparent && o.material.opacity < 0.5) return;
      let m;
      if (o.isSkinnedMesh && o.skeleton) { m = new THREE.SkinnedMesh(o.geometry, this.mat); m.bind(o.skeleton, o.bindMatrix); m.bindMode = o.bindMode; }
      else m = new THREE.Mesh(o.geometry, this.mat);
      m.userData.frost = true; m.renderOrder = (o.renderOrder || 0) + 1; m.frustumCulled = false;
      overlays.push({ parent: o, m });
    });
    for (const q of overlays) q.parent.add(q.m);
    // cristales de hielo que brotan a los pies
    const crystals = [];
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
    const r = Math.max(0.4, Math.min(1.4, Math.min(size.x, size.z) * 0.6)), h = Math.max(0.6, Math.min(4, size.y));
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(this.cGeo, this.cMat), a = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
      c.position.set((box.min.x + box.max.x) / 2 + Math.cos(a) * r, box.min.y, (box.min.z + box.max.z) / 2 + Math.sin(a) * r);
      c.rotation.set(Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45);
      c.userData.s = (0.6 + Math.random() * 0.8) * Math.min(2.2, h / 1.6);
      c.scale.setScalar(0.0001);
      this.g.scene.add(c); crystals.push(c);
    }
    return { overlays, crystals, box };
  }
  unfrost(it) {
    for (const q of it.overlays) q.parent.remove(q.m);
    for (const c of it.crystals) this.g.scene.remove(c);
  }
  // devuelve k (0 = normal … 1 = congelado)
  update(real) {
    if (this.T <= 0) { if (this.items.size) this.clear(); this.k = 0; return 0; }
    this.T = Math.max(0, this.T - real);
    const t = this.dur - this.T;
    const kin = Math.min(1, t / FADE_IN), kout = Math.min(1, this.T / FADE_OUT);
    const e = (x) => x * x * (3 - 2 * x);
    this.k = e(Math.min(kin, kout));
    // añadir a los que aún no estén (p. ej. un esbirro que aparece mientras dura la aurora)
    for (const r of this.roots()) if (!this.items.has(r)) this.items.set(r, this.frost(r));
    this.mat.opacity = 0.48 * this.k;
    this.mat.emissiveIntensity = 0.12 + 0.12 * this.k;
    const fx = this.g.fx;
    for (const [r, it] of this.items) {
      for (const c of it.crystals) c.scale.setScalar(Math.max(0.0001, c.userData.s * this.k));
      // pequeños cristales y destellos helados alrededor del cuerpo (pocos: no saturan la pantalla)
      if (fx && this.k > 0.3 && Math.random() < 0.06) {
        const b = it.box, x = b.min.x + Math.random() * (b.max.x - b.min.x), y = b.min.y + Math.random() * (b.max.y - b.min.y), z = b.min.z + Math.random() * (b.max.z - b.min.z);
        fx.sparkle(x, y, z, Math.random() < 0.5 ? 0xbff0ff : 0x7ae8e0, 0.4);
      }
    }
    if (this.T <= 0) this.clear();
    return this.k;
  }
  clear() {
    for (const it of this.items.values()) this.unfrost(it);
    this.items.clear();
    this.mat.opacity = 0;
  }
}
