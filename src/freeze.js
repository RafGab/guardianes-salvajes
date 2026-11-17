import * as THREE from 'three';

// CONGELACIÓN MASIVA (Aurora Polar de Kira): todos los personajes de la escena (enemigos, jefe, compañeros del
// equipo y personas a rescatar) se van parando poco a poco hasta quedar inmóviles, cubiertos por una capa fina
// de escarcha, un bloque de hielo translúcido que crece desde los pies, cristales de hielo a sus pies y un
// resplandor azul que los distingue. Al terminar se descongelan poco a poco (la escarcha se desprende) y siguen como antes.
// No cambia modelos ni animaciones: solo ralentiza su tiempo (k = 0 normal … 1 congelado) y añade el hielo encima.
// La heroína que lanza la aurora sigue moviéndose (el jugador nunca pierde el control).
// start(dur, { fin, fout }): `fin` s hasta quedar congelados, luego COMPLETAMENTE inmóviles (dur − fin − fout) s
// —la Aurora Polar usa exactamente 5 s— y `fout` s de deshielo.
const FADE_IN = 0.9, FADE_OUT = 0.9;

export class FrostFreeze {
  constructor(game) {
    this.g = game;
    this.T = 0; this.dur = 0; this.k = 0;
    this.fin = FADE_IN; this.fout = FADE_OUT;
    this.items = new Map();  // raíz del personaje → { overlays, crystals, shell, box }
    this.mat = new THREE.MeshStandardMaterial({ color: 0xd8f4ff, emissive: 0x5ac8ff, emissiveIntensity: 0.18, roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.cMat = new THREE.MeshStandardMaterial({ color: 0xbfeaff, emissive: 0x3ab8e0, emissiveIntensity: 0.25, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85, flatShading: true });
    this.cGeo = new THREE.ConeGeometry(0.09, 0.5, 5); this.cGeo.translate(0, 0.25, 0);
    // bloque de hielo: poliedro facetado con la base en y = 0 (crece desde los pies hacia arriba)
    this.sGeo = new THREE.IcosahedronGeometry(1, 1); this.sGeo.translate(0, 1, 0);
    this.sMat = new THREE.MeshStandardMaterial({ color: 0xcfefff, emissive: 0x2aa8ff, emissiveIntensity: 0.3, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0, depthWrite: false, flatShading: true, side: THREE.DoubleSide });
  }
  get active() { return this.T > 0; }
  start(dur, { fin = FADE_IN, fout = FADE_OUT } = {}) {
    if (this.T > 0) { this.T = Math.max(this.T, dur); this.dur = Math.max(this.dur, dur); return; }
    this.T = dur; this.dur = dur; this.fin = fin; this.fout = fout;
  }
  // ¿esta raíz está congelada ahora mismo? (para la rotura en cristales al destruirla)
  isFrozen(root) { return this.k > 0.35 && this.items.has(root); }
  // golpe a un enemigo congelado: el hielo se agrieta y destella (más cuanto más golpes recibe)
  crack(root) {
    const it = this.items.get(root);
    if (!it) return;
    it.crack = Math.min(1, (it.crack || 0) + 0.45); it.flash = 1;
    const fx = this.g.fx, b = it.box;
    if (fx) for (let i = 0; i < 5; i++) fx.iceShard((b.min.x + b.max.x) / 2 + (Math.random() - 0.5) * 0.6, b.min.y + Math.random() * (b.max.y - b.min.y), (b.min.z + b.max.z) / 2 + (Math.random() - 0.5) * 0.6, 1);
  }
  // destruido mientras estaba congelado: su bloque de hielo y sus cristales se acaban de romper (iceShatter)
  shatter(root) {
    const it = this.items.get(root);
    if (!it) return;
    it.shell.visible = false;
    for (const c of it.crystals) c.visible = false;
    for (const q of it.overlays) q.m.visible = false;
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
    for (let i = 0; i < 7; i++) {
      const c = new THREE.Mesh(this.cGeo, this.cMat), a = (i / 7) * Math.PI * 2 + Math.random() * 0.5;
      c.position.set((box.min.x + box.max.x) / 2 + Math.cos(a) * r, box.min.y, (box.min.z + box.max.z) / 2 + Math.sin(a) * r);
      c.rotation.set(Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45);
      c.userData.s = (0.6 + Math.random() * 0.8) * Math.min(2.2, h / 1.6);
      c.scale.setScalar(0.0001);
      this.g.scene.add(c); crystals.push(c);
    }
    // bloque de hielo translúcido alrededor del cuerpo (material propio: cada uno se agrieta y destella por su cuenta)
    const sm = this.sMat.clone();
    const shell = new THREE.Mesh(this.sGeo, sm);
    shell.position.set((box.min.x + box.max.x) / 2, box.min.y - 0.02, (box.min.z + box.max.z) / 2);
    shell.userData.sx = Math.max(0.35, Math.max(size.x, size.z) * 0.62); shell.userData.sy = Math.max(0.4, h * 0.56);
    shell.rotation.y = Math.random() * Math.PI;
    shell.scale.setScalar(0.0001);
    shell.renderOrder = 8;
    this.g.scene.add(shell);
    return { overlays, crystals, box, shell, crack: 0, flash: 0 };
  }
  unfrost(it) {
    for (const q of it.overlays) q.parent.remove(q.m);
    for (const c of it.crystals) this.g.scene.remove(c);
    if (it.shell) { this.g.scene.remove(it.shell); it.shell.material.dispose(); }
  }
  // devuelve k (0 = normal … 1 = congelado)
  update(real) {
    if (this.T <= 0) { if (this.items.size) this.clear(); this.k = 0; return 0; }
    this.T = Math.max(0, this.T - real);
    const t = this.dur - this.T;
    const kin = Math.min(1, t / this.fin), kout = Math.min(1, this.T / this.fout);
    const e = (x) => x * x * (3 - 2 * x);
    this.k = e(Math.min(kin, kout));
    const thawing = kout < 1;
    // añadir a los que aún no estén (p. ej. un esbirro que aparece mientras dura la aurora)
    if (!thawing) for (const r of this.roots()) if (!this.items.has(r)) this.items.set(r, this.frost(r));
    this.mat.opacity = 0.5 * this.k;
    this.mat.emissiveIntensity = 0.14 + 0.2 * this.k;
    const fx = this.g.fx;
    for (const [r, it] of this.items) {
      for (const c of it.crystals) c.scale.setScalar(Math.max(0.0001, c.userData.s * this.k));
      // el bloque crece desde los pies (primero ancho, luego alto) y al deshelar se encoge y se vuelve transparente
      const sh = it.shell, gy = e(Math.min(1, this.k * 1.15));
      sh.scale.set(sh.userData.sx * (0.6 + 0.4 * this.k), Math.max(0.0001, sh.userData.sy * gy), sh.userData.sx * (0.6 + 0.4 * this.k));
      it.flash = Math.max(0, it.flash - real * 4);
      sh.material.opacity = 0.32 * this.k + 0.25 * it.flash;
      sh.material.emissiveIntensity = 0.3 + 0.35 * it.crack + 1.4 * it.flash + 0.08 * Math.sin(t * 3);
      // pequeños cristales y destellos helados alrededor del cuerpo (pocos: no saturan la pantalla)
      const b = it.box;
      if (fx && this.k > 0.3 && Math.random() < 0.07) {
        const x = b.min.x + Math.random() * (b.max.x - b.min.x), y = b.min.y + Math.random() * (b.max.y - b.min.y), z = b.min.z + Math.random() * (b.max.z - b.min.z);
        fx.sparkle(x, y, z, Math.random() < 0.5 ? 0xbff0ff : 0x7ae8e0, 0.4);
      }
      // DESHIELO: partículas de escarcha que se desprenden y caen mientras recupera el movimiento
      if (fx && thawing && sh.visible && Math.random() < 0.5) {
        const x = b.min.x + Math.random() * (b.max.x - b.min.x), y = b.min.y + Math.random() * (b.max.y - b.min.y), z = b.min.z + Math.random() * (b.max.z - b.min.z);
        if (fx.snow) fx.snow(x, y, z); else fx.sparkle(x, y, z, 0xe8f8ff, 0.3);
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
