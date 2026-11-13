import * as THREE from 'three';
import { terrainH } from './terrain.js';
import { IS_TOUCH } from './platform.js';

/* ======================================================================
   MIRA DE HALLEY (apuntado de la lanza)
   · T (o el botón 🎯 en pantallas táctiles) activa / desactiva la mira.
   · Con la mira: la cámara se pone al hombro y se cierra un poco (zoom), aparece la retícula en el
     centro de la pantalla, Halley mira hacia donde apunta la cámara y un láser violeta sale de la
     punta de la lanza hasta el punto apuntado.
   · La retícula se vuelve roja, se cierra y muestra el nombre cuando hay un enemigo en el centro.
   · Al disparar con la mira (botón ARMA), el rayo de cristal va EXACTAMENTE hacia la retícula
     (también en altura). Sin la mira, el disparo funciona como siempre (apuntado automático).
   ====================================================================== */
const HERO = 'halley';
const RANGE = 26;

export class AimSystem {
  constructor(game) {
    this.g = game;
    this.on = false;
    this.info = null; // { origin, dir, point, target }
    this.ray = new THREE.Raycaster();
    this.center = new THREE.Vector2(0, 0);
    // láser: línea fina aditiva que se actualiza cada fotograma
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.laser = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: new THREE.Color(0xd890ff).multiplyScalar(2), dashSize: 0.35, gapSize: 0.18, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    this.laser.frustumCulled = false;
    this.laser.visible = false;
    game.scene.add(this.laser);
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6aff).multiplyScalar(2.2), toneMapped: false }));
    this.dot.visible = false;
    game.scene.add(this.dot);
    this.lastTarget = null;
  }
  get usable() { const g = this.g; return g.state === 'playing' && g.hero && g.hero.id === HERO && !g.player.swimming; }

  toggle(force) {
    const want = force != null ? force : !this.on;
    if (want && !this.usable) return false;
    if (want === this.on) return this.on;
    this.on = want;
    const ch = this.g.chase;
    if (want) {
      this.prevDist = ch.distTarget;
      ch.distTarget = Math.max(2.6, ch.distTarget * 0.55);
      ch.sideTarget = 0.75;
      ch.zoomTarget = 16;
      // al activar la mira, la cámara se pone detrás de Halley
      ch.yaw = this.g.player.facing + Math.PI;
      if (!this.g.weapons.isOut) this.g.weapons.equip();
    } else {
      if (this.prevDist) ch.distTarget = this.prevDist;
      ch.sideTarget = 0; ch.zoomTarget = 0;
      this.info = null;
    }
    this.laser.visible = this.dot.visible = false;
    this.ui();
    return this.on;
  }

  // Retícula (HTML) y botón táctil
  ui() {
    let r = document.getElementById('reticle');
    if (!r) {
      r = document.createElement('div');
      r.id = 'reticle';
      r.innerHTML = '<i class="rt-c"></i><i class="rt t"></i><i class="rt b"></i><i class="rt l"></i><i class="rt r"></i><span class="rt-name"></span>';
      document.getElementById('hud')?.appendChild(r);
    }
    r.classList.toggle('show', this.on);
    r.classList.remove('lock');
    let b = document.getElementById('aim-btn');
    if (!b && IS_TOUCH && document.getElementById('hud')) {
      b = document.createElement('button');
      b.id = 'aim-btn'; b.type = 'button'; b.className = 'aim-btn'; b.textContent = '🎯';
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.toggle(); });
      document.getElementById('hud').appendChild(b);
    }
    if (b) { b.classList.toggle('show', this.usable); b.classList.toggle('on', this.on); }
    const hint = document.getElementById('aim-hint');
    if (!hint && document.getElementById('hud')) {
      const h = document.createElement('div'); h.id = 'aim-hint'; h.className = 'aim-hint';
      h.innerHTML = IS_TOUCH ? '🎯 Mira activa · toca ARMA para disparar' : '🎯 Mira activa · <kbd>4</kbd> disparar · <kbd>T</kbd> quitar mira';
      document.getElementById('hud').appendChild(h);
    }
    document.getElementById('aim-hint')?.classList.toggle('show', this.on);
  }

  update(dt) {
    const g = this.g;
    if (this.on && !this.usable) this.toggle(false);
    // botón táctil visible solo con Halley
    if (IS_TOUCH && (this._btnHero !== (g.hero && g.hero.id))) { this._btnHero = g.hero && g.hero.id; this.ui(); }
    if (!this.on) return;
    const p = g.player, cam = g.camera, ch = g.chase;
    // Halley mira hacia donde apunta la cámara
    p.facing = ch.yaw + Math.PI;
    // rayo desde el centro de la pantalla
    this.ray.setFromCamera(this.center, cam);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    // empieza a contar desde la altura de Halley (la cámara está detrás de ella)
    const t0 = Math.max(0, new THREE.Vector3().subVectors(p.pos, o).dot(d));
    let best = null, bt = Infinity;
    for (const t of g.combat.targets()) {
      const h = t.heavy ? (t.S ? t.S.height : 2) : (t.barH || 1.4);
      const c = new THREE.Vector3(t.pos.x, t.pos.y + h * 0.5, t.pos.z);
      const rad = Math.max(t.radius || 0.5, h * 0.45) + 0.25;      // área de apuntado algo generosa
      const tc = c.clone().sub(o).dot(d);
      if (tc < t0 || tc - t0 > RANGE) continue;
      const miss = o.clone().addScaledVector(d, tc).distanceTo(c);
      if (miss < rad && tc < bt) { bt = tc; best = { t, c }; }
    }
    let point;
    if (best) point = best.c;
    else { // sin objetivo: el punto de la retícula sobre el suelo o a máximo alcance
      let tt = t0 + RANGE;
      for (let s = t0 + 1; s < t0 + RANGE; s += 0.5) { const q = o.clone().addScaledVector(d, s); if (q.y < terrainH(q.x, q.z)) { tt = s; break; } }
      point = o.clone().addScaledVector(d, tt);
    }
    const tip = g.weapons.isOut && g.weapons.cur ? g.weapons.partTip(0, new THREE.Vector3()) : new THREE.Vector3(p.pos.x, p.pos.y + p.H * 0.6, p.pos.z);
    this.info = { origin: tip, dir: point.clone().sub(tip).normalize(), point, target: best ? best.t : null };
    // láser y punto de mira en el mundo
    const pa = this.laser.geometry.attributes.position;
    pa.setXYZ(0, tip.x, tip.y, tip.z); pa.setXYZ(1, point.x, point.y, point.z); pa.needsUpdate = true;
    this.laser.computeLineDistances();
    this.laser.visible = true;
    this.laser.material.color.setHex(best ? 0xff4a6a : 0xd890ff).multiplyScalar(2);
    this.dot.position.copy(point); this.dot.visible = true;
    this.dot.scale.setScalar(best ? 1.6 + 0.3 * Math.sin(performance.now() / 90) : 1);
    // retícula: se cierra y se pone roja con un objetivo dentro
    const r = document.getElementById('reticle');
    if (r) {
      r.classList.toggle('lock', !!best);
      const nm = best ? (best.t.heavy && !best.t.prop ? best.t.name : best.t.prop ? best.t.label : best.t.cat && best.t.cat.name) || '' : '';
      r.querySelector('.rt-name').textContent = best ? `${nm} · ${Math.round(bt - t0)} m` : '';
    }
    if (best && best.t !== this.lastTarget) { // marca en el suelo al fijar un objetivo nuevo
      g.vfx.ring(best.t.pos.x, null, best.t.pos.z, { r0: 0.4, r1: (best.t.radius || 0.6) + 1.2, dur: 0.35, color: 0xff4a6a });
    }
    this.lastTarget = best ? best.t : null;
  }
  reset() { if (this.on) this.toggle(false); }
}
