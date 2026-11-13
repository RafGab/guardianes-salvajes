import * as THREE from 'three';
import { HEROES, ELEMENTS, getHeroModel } from './heroes.js';
import { createVictim } from './npcs.js';
import { CFG, terrainH } from './terrain.js';
import { Audio3D as audio } from './audio.js';
import { ui } from './ui.js';
import { clamp, damp, TAU, makeCanvas, texFromCanvas } from './utils.js';
import { LEVELS, LEVEL_TIPS } from './levels.js';
import { Save } from './save.js';
import { ITEMS, heroPowerItem } from './items.js';
import { useTool } from './tools.js';
import { createHazards } from './hazards.js';
import { createBoss, createAlly, preloadBoss, preloadAlly } from './bosses.js';
import { bossScale, bossCameraFor } from './scale.js';
import { Vfx } from './skills/vfx.js';
import { Combat } from './combat.js';
import { HeroSkills } from './skills/hero.js';
import { Vfx2 } from './skills/vfx2.js';
import { Team } from './team.js';
import { TEAM, HERO_SKILLS, HEALTH, HEAL_ITEMS, MINIONS, DESTRUCTIBLE } from './skills/config.js';
import { Bag, healAmount } from './health.js';
import { Pickups } from './pickups.js';
import { WeaponSystem } from './weapons/system.js';
import { RescuePortal } from './portal.js';
import { RescueBubbles } from './rescue.js';
import { Allies } from './allies.js';
import { AimSystem } from './aim.js';
import { SEE, enableSeeThrough } from './seethrough.js';
const HERO_SKILLS_CD = (id) => (HERO_SKILLS[id] && HERO_SKILLS[id].flight ? HERO_SKILLS[id].flight.cd : 4);
import { IS_TOUCH } from './platform.js';
import { CampFireRuntime } from './scenarios/campfire_rt.js';
const KEY = (k, icon) => (IS_TOUCH ? icon : `<kbd>${k}</kbd>`);

export const TIPS = {
  start: 'Cuando llueve mucho, sube a lugares altos y aléjate de los ríos y de las calles inundadas.',
  current: 'Evita caminar por agua en movimiento. Puede ser más profunda y peligrosa de lo que parece.',
  deep: 'En agua profunda no nades contra la corriente: nada de lado hacia un lugar seguro.',
  cars: 'Con solo 15 cm de agua en movimiento una persona puede caer, y con 30 cm un coche puede ser arrastrado. Nunca cruces una calle inundada.',
  electric: 'Aléjate de cables eléctricos y farolas cuando hay agua en la calle: el agua conduce la electricidad.',
  contaminated: 'El agua de una inundación puede estar sucia o contaminada. No la bebas ni juegues en ella.',
  found_person: 'Si ves a alguien en peligro, llama al 112 y no te arriesgues: pide ayuda a los servicios de emergencia.',
  found_animal: 'Los animales también sufren en una catástrofe. Si es seguro, ayúdales, o avisa a un adulto.',
  kid: 'En una emergencia, los niños deben ir siempre de la mano de un adulto y sin separarse del grupo.',
  elder: 'Ayuda con calma a las personas mayores a llegar a un lugar alto y seguro.',
  surge: 'Si oyes una alerta de crecida, ve enseguida a un lugar alto. No esperes a que el agua suba más.',
  lightning: 'Con tormenta, aléjate de los árboles altos y de las zonas abiertas: los rayos buscan lo más alto.',
  pets: 'Prepara con tu familia un plan de emergencia que incluya también a las mascotas.',
  environment: 'Reducir los residuos ayuda a proteger los ecosistemas. Menos basura en ríos y alcantarillas, menos inundaciones.',
  climate: 'Las lluvias intensas son cada vez más frecuentes por el cambio climático. Cuidar el planeta ayuda a prevenir catástrofes.',
  kit: 'Ten lista una mochila de emergencia: agua, linterna, radio, botiquín y copias de los documentos.',
  n112: 'El 112 es el número de emergencias en toda Europa. Es gratuito y funciona las 24 horas.',
  debris: 'Los objetos que flotan o vuelan en una emergencia pueden golpear con fuerza. Mantén la distancia.',
  power: 'Los héroes usan sus poderes con cabeza. En la vida real, deja el rescate a los profesionales y avisa al 112.',
  tools: 'Las herramientas de rescate solo las usan profesionales entrenados. Tú, avisa siempre a los servicios de emergencia.',
};
const SIGN_TIPS = { sign_start: 'n112', sign_1: 'kit', sign_2: 'environment', sign_3: 'climate', sign_4: 'pets', sign_5: 'kit' };
const AMBIENCE = { flood: [0.5, 0.4], campfire: [0.03, 0.5], fire: [0.03, 0.55], quake: [0.02, 0.3], volcano: [0.06, 0.6], hurricane: [0.95, 1.0], sandstorm: [0.04, 1.0], ice: [0.25, 1.0], drought: [0.02, 0.35], extreme: [0.7, 0.9] };
const SCHED = {
  campfire: [[30, 'evac'], [90, 'smoke'], [170, 'wildlife'], [250, 'never'], [330, 'forest']],
  fire: [[35, 'smoke'], [130, 'never'], [180, 'wildlife'], [230, 'forest']],
  quake: [[45, 'elevator'], [120, 'gas'], [180, 'rubble'], [255, 'aftershock']],
  volcano: [[20, 'ash'], [75, 'lava'], [130, 'rocks'], [190, 'mask'], [250, 'gas']],
  hurricane: [[25, 'wind'], [80, 'surge'], [135, 'debris'], [200, 'radio']],
  sandstorm: [[25, 'lost'], [70, 'eyes'], [120, 'water'], [180, 'vehicles'], [240, 'shade']],
  ice: [[30, 'animals'], [90, 'co'], [150, 'visibility'], [220, 'climate']],
  drought: [[30, 'animals'], [80, 'fire'], [130, 'heat'], [190, 'reuse'], [250, 'climate']],
  extreme: [[20, 'plan'], [70, 'calm'], [130, 'help'], [200, 'info']],
};

function markerTexture(color, glyph = '!') {
  const c = makeCanvas(128);
  const g = c.getContext('2d');
  g.shadowColor = color;
  g.shadowBlur = 14;
  g.fillStyle = color;
  g.beginPath();
  g.arc(64, 64, 42, 0, TAU);
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = 7;
  g.strokeStyle = '#fff';
  g.stroke();
  g.fillStyle = '#fff';
  g.font = 'bold 66px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, 64, 68);
  return texFromCanvas(c);
}

export class Game {
  constructor({ scene, camera, renderer, world, player, chase, fx, input }) {
    Object.assign(this, { scene, camera, renderer, world, player, chase, fx, input });
    this.state = 'idle';
    this.victims = [];
    this.timeScale = 1;
    this.slowT = 0;
    this.abilities = [];
    this.abIndex = 0;
    this.toolCd = {};
    // habilidades de héroe y ataques de jefe: capa visual, combate compartido y gestor de habilidades
    this.vfx = new Vfx(scene, fx);
    this.vfx2 = new Vfx2(this); // cielo, aurora, lava, olas... de los poderes especiales
    this.combat = new Combat(this);
    this.skills = new HeroSkills(this);
    this.weapons = new WeaponSystem(this); // arma 3D de cada héroe (botón ARMA), unida al hueso de su mano
    this.portal = new RescuePortal(this);  // portal de rescate del refugio: su aspecto depende del héroe activo
    this.bubbles = new RescueBubbles(this); // rescate con burbujas de energía (una por víctima, siguen al héroe)
    this.aimSys = new AimSystem(this);      // mira de Halley (T / botón 🎯)
    this.allies = new Allies(this);         // combate de jefe: los otros dos héroes del equipo luchan a la vez
    this.team = new Team();          // equipo del combate de jefe (vida por héroe, cambio en combate)
    this.bag = new Bag();            // mochila de recuperación (bebidas y botiquines)
    this.pickups = new Pickups(this); // bebidas y botiquines repartidos por el mapa
    this.life = { id: null, hp: HEALTH.max, max: HEALTH.max, ko: false }; // vida del héroe en exploración
    this.cdByHero = {};              // recargas guardadas de los héroes en reserva
    this.onBossPrep = null;          // main.js: abre la pantalla de selección/formación del equipo
    this.bossIntroT = 0;
    this.lastBossAction = '';
    this.markerTex = { warn: markerTexture('#ffb020'), urgent: markerTexture('#ff3030'), blocked: markerTexture('#9a6bff', '🔒') };
    this.buildSigns();
    this.buildToolVisuals();
    world.onThunder = () => {
      audio.thunder();
      this.chase.shake(0.06);
    };
    world.onObstacleBroken = (o) => this.onObstacleBroken(o);
    this.safeSpots = [];
    for (let k = 0; k < 14; k++) {
      const a = k * 0.62 + 0.4;
      this.safeSpots.push([CFG.SAFE.x + Math.cos(a) * (3.4 + (k % 3) * 0.9), CFG.SAFE.z + Math.sin(a) * (3.4 + (k % 3) * 0.9)]);
    }
    ui.tips.onShow = () => audio.tip();
  }

  /* ---------- carteles ---------- */
  buildSigns() {
    this.signMeshes = [];
    for (const s of this.world.signs) {
      const g = new THREE.Group();
      g.position.set(s.x, s.y, s.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8), new THREE.MeshStandardMaterial({ color: 0x555a60 }));
      pole.position.y = 1.2;
      pole.castShadow = true;
      g.add(pole);
      const c = makeCanvas(256, 160);
      const x = c.getContext('2d');
      x.fillStyle = '#0d5a8a';
      x.fillRect(0, 0, 256, 160);
      x.strokeStyle = '#fff';
      x.lineWidth = 6;
      x.strokeRect(6, 6, 244, 148);
      x.fillStyle = '#ffd24a';
      x.font = 'bold 60px sans-serif';
      x.textAlign = 'center';
      x.fillText('💡', 128, 76);
      x.fillStyle = '#fff';
      x.font = 'bold 30px sans-serif';
      x.fillText('CONSEJO', 128, 118);
      x.font = '20px sans-serif';
      x.fillText(IS_TOUCH ? 'Toca 💡' : 'Pulsa  E', 128, 144);
      const face = new THREE.MeshStandardMaterial({ map: texFromCanvas(c), emissiveMap: texFromCanvas(c), emissive: 0xffffff, emissiveIntensity: 0.55 });
      const side = new THREE.MeshStandardMaterial({ color: 0x0d5a8a });
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.05, 0.08), [side, side, side, side, face, side]);
      board.position.y = 2.55;
      board.castShadow = true;
      g.add(board);
      this.scene.add(g);
      this.signMeshes.push(g);
    }
  }

  /* ---------- visuales de herramientas ---------- */
  buildToolVisuals() {
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.55, 20, 14),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0x4ac8ff).multiplyScalar(1.6), transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.shieldMesh.visible = false;
    this.scene.add(this.shieldMesh);
    this.torch = new THREE.SpotLight(0xfff0c0, 0, 36, 0.55, 0.6, 1.1);
    this.torchTarget = new THREE.Object3D();
    this.scene.add(this.torch, this.torchTarget);
    this.torch.target = this.torchTarget;
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.ropeLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xd8b878 }));
    this.ropeLine.visible = false;
    this.ropeLine.frustumCulled = false;
    this.scene.add(this.ropeLine);
    this.rope = null;
    this.ropeShow = 0;
  }

  /* ---------- víctimas ---------- */
  clearVictims() {
    if (this.bubbles) this.bubbles.clear();
    for (const v of this.victims) {
      if (v.root.parent) v.root.parent.remove(v.root);
    }
    this.victims = [];
    if (this.hazards) {
      this.hazards.dispose();
      this.hazards = null;
    }
    this.world.clearObstacles();
    this.world.fogMul = 1;
    ui.setOverlay('heat', 0);
    ui.setOverlay('cold', 0);
    ui.setOverlay('dust', 0);
    this.shieldMesh.visible = false;
    this.torch.intensity = 0;
    this.ropeLine.visible = false;
    this.player.scripted = false;
  }

  makeMarker() {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markerTex.warn, depthTest: false, depthWrite: false, transparent: true }));
    m.renderOrder = 60;
    m.scale.set(1.2, 1.2, 1);
    return m;
  }

  spawnVictims(slots) {
    slots.forEach((slot, i) => {
      const v = createVictim(slot.kind, 100 + i * 17 + Math.floor(Math.random() * 999));
      v.id = i;
      v.slot = slot;
      v.state = 'waiting';
      v.found = false;
      v.urgent = false;
      v.hidden = !!slot.hidden;
      v.thirsty = !!slot.thirsty;
      v.blockers = slot.blockers || [];
      v.zone = slot.zone;
      v.marker = this.makeMarker();
      v.root.add(v.marker);
      v.marker.position.set(0, v.height + 0.75, 0);
      v.markerBase = v.height + 0.75;
      if (slot.body) {
        slot.body.mesh.add(v.root);
        v.root.position.set(slot.body.rescueX || 0, slot.ly, 0);
        v.parentBody = slot.body;
        v.baseY = slot.ly;
        v.root.rotation.y = 0;
      } else {
        this.scene.add(v.root);
        v.root.position.set(slot.x, slot.y + 0.02, slot.z);
        v.baseY = slot.y + 0.02;
        v.root.rotation.y = Math.random() * TAU;
      }
      v.wpos = new THREE.Vector3();
      this.victims.push(v);
    });
  }

  /* ---------- habilidades (poder del héroe + herramientas) ---------- */
  buildAbilities() {
    const base = heroPowerItem(this.hero);
    this.abilities = [{ id: 'power', icon: base.icon, name: base.name, cd: this.hero.power.cd, role: 'velocidad' }]; // botón 1: VELOCIDAD
    this.abilities.push(...this.skills.entries(this.hero.id)); // habilidad propia del héroe (y especial, si la tiene)
    for (const id of Save.items) {
      const it = ITEMS[id];
      if (it && !it.passive) this.abilities.push({ id: it.id, icon: it.icon, name: it.name, cd: it.cd, tool: true }); // herramientas: grupo aparte
    }
    this.abIndex = 0;
    this.toolCd = {};
    ui.setAbilities(this.abilities, this.abIndex, (i) => this.triggerAbility(i), () => this.holsterWeapon());
  }
  selectAbility(i) {
    if (i < 0 || i >= this.abilities.length) return;
    this.abIndex = i;
    ui.selectAbilityUI(i);
    audio.click();
  }
  // Cada poder tiene su propio botón: tecla 1-9 o botón de la barra = seleccionar y usar
  triggerAbility(i) {
    if (i < 0 || i >= this.abilities.length) return false;
    if (this.abIndex !== i) { this.abIndex = i; ui.selectAbilityUI(i); }
    return this.useAbility();
  }
  cycleAbility(dir = 1) {
    if (this.abilities.length < 2) return;
    this.selectAbility((this.abIndex + dir + this.abilities.length) % this.abilities.length);
  }
  useAbility() {
    if (this.state !== 'playing' || this.player.locked || this.player.scripted) return false;
    const a = this.abilities[this.abIndex];
    if (!a) return false;
    if (a.hs && this.skills.canRecast(a.key)) return this.skills.recast(a.key); // segunda pulsación (espejismo, aterrizar, salir de la roca)
    if (a.id === 'power') {
      const p = this.player;
      if (p.fly) { ui.banner('find', a.icon, 'No disponible mientras vuelas'); return false; }
      const nEv = p.events.length;
      let used = p.usePower(this.fx);
      // Los poderes de agua/hielo solo funcionan sobre agua; en un combate de jefe no pueden dejar al héroe sin ataque.
      if (!used && this.boss && p.cd <= 0) {
        p.events.length = nEv; // descarta el aviso "este poder funciona sobre el agua"
        used = this.bossStrike();
      }
      if (used && this.boss) {
        this.boss.onPlayerAttack(p.pos);
        ui.battleLog(`⚡ ${this.hero.name}: ${a.name}`, 'hero');
      }
      return used;
    }
    if ((this.toolCd[a.id] || 0) > 0) {
      ui.banner('find', a.icon, 'Recargando…');
      return false;
    }
    if (a.hs) { // habilidad propia del héroe (skills/hero.js)
      const res = this.skills.use(a.key);
      if (!res) return false;
      this.toolCd[a.id] = a.cd * this.player.cdMul * res.cdFactor;
      if (this.boss) ui.battleLog(`✨ ${this.hero.name}: ${a.name}`, 'hero');
      return true;
    }
    if (useTool(a.id, this)) {
      this.toolCd[a.id] = a.cd * this.player.cdMul;
      if (!this.shownMoves.has('tools')) {
        this.shownMoves.add('tools');
        setTimeout(() => this.tip('tools'), 2500);
      }
      return true;
    }
    return false;
  }
  // Tecla G o mantener pulsado el botón ARMA: sacar / guardar el arma del héroe
  toggleWeapon() {
    if (this.state !== 'playing') return false;
    const out = this.weapons.toggle();
    const W = this.weapons.def;
    if (W) ui.banner('find', '⚔️', out ? `${W.name}: ¡lista!` : `${W.name} guardada`);
    return out;
  }
  // ATAQUE PRINCIPAL (Q / clic): en el combate de jefe es el ataque con el arma del héroe (combo de 3 golpes);
  // si el enemigo más cercano está a pocos metros, el héroe se lanza hacia él antes de golpear.
  // Fuera del combate de jefe hace lo de siempre (el poder seleccionado).
  primaryAttack() {
    if (!this.boss || this.state !== 'playing' || this.bossIntroT > 0) return this.useAbility();
    const p = this.player;
    if (p.locked || p.scripted || this.closeIn) return false;
    const ai = this.abilities.findIndex((a) => a.role === 'arma');
    if (ai < 0) return this.useAbility();
    if (this.aimSys.on) return this.triggerAbility(ai); // con la mira: dispara a la retícula
    const t = this.nearestEnemy(10);
    if (t) {
      const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z, d = Math.hypot(dx, dz), gap = d - (t.radius || 0.5) - 1.6;
      p.facing = Math.atan2(dx, dz);
      if (gap > 0.6) { // se lanza hacia el enemigo y golpea al llegar
        this.closeIn = { t, ai, time: Math.min(0.45, gap / 18) };
        for (let j = 0; j < 10; j++) this.fx.dustPuff(p.pos.x, p.pos.y + 0.1, p.pos.z, 1);
        audio.whoosh && audio.whoosh();
        return true;
      }
    }
    return this.triggerAbility(ai);
  }
  nearestEnemy(range) {
    const p = this.player;
    let best = null, bd = range;
    for (const t of this.combat.enemies()) {
      if (t.dead || t.state === 'dead') continue;
      const d = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) - (t.radius || 0.5);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  updateCloseIn(dt) {
    const c = this.closeIn;
    if (!c) return;
    const p = this.player, t = c.t;
    c.time -= dt;
    if (!t || t.dead || t.state === 'dead' || this.state !== 'playing') { this.closeIn = null; return; }
    const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z, d = Math.hypot(dx, dz), stop = (t.radius || 0.5) + 1.5;
    p.facing = Math.atan2(dx, dz);
    if (d > stop) { const s = Math.min(d - stop, 20 * dt); p.pos.x += (dx / d) * s; p.pos.z += (dz / d) * s; }
    if (Math.random() < 0.7) this.fx.sparkle(p.pos.x, p.pos.y + p.H * 0.5, p.pos.z, ELEMENTS[this.hero.element].color, 1.2);
    if (d <= stop + 0.05 || c.time <= 0) { this.closeIn = null; this.triggerAbility(c.ai); }
  }
  // los cuerpos chocan: el héroe no atraviesa al jefe ni a los soldados
  bodyBlock() {
    if (!this.boss) return;
    const p = this.player;
    for (const t of this.combat.enemies()) {
      if (t.dead || t.state === 'dead') continue;
      const R = (t.heavy ? (t.S ? t.S.radius : 1.2) * 0.85 : t.radius || 0.5) + (p.R || 0.4);
      const dx = p.pos.x - t.pos.x, dz = p.pos.z - t.pos.z, d = Math.hypot(dx, dz);
      if (d < R && d > 1e-4) { p.pos.x = t.pos.x + (dx / d) * R; p.pos.z = t.pos.z + (dz / d) * R; }
    }
  }
  // T o botón 🎯: activa / quita la mira de Halley
  toggleAim() {
    if (this.state !== 'playing') return false;
    if (!this.hero || this.hero.id !== 'halley') { ui.banner('find', '🎯', 'La mira es de Halley y su lanza'); return false; }
    const on = this.aimSys.toggle();
    ui.banner('find', '🎯', on ? 'Mira activada: apunta y dispara con el arma' : 'Mira desactivada');
    return on;
  }
  holsterWeapon() {
    if (this.state !== 'playing' || !this.weapons.isOut) return false;
    this.weapons.holster();
    const W = this.weapons.def;
    if (W) ui.banner('find', '⚔️', `${W.name} guardada`);
    return true;
  }
  // Golpe de contacto del héroe contra el jefe cuando su poder no se puede usar (mismo tiempo de recarga).
  bossStrike() {
    const p = this.player;
    p.cd = p.cdMax * p.cdMul;
    p.powerAnim = 1;
    for (let i = 0; i < 14; i++) this.fx.sparkle(p.pos.x + (Math.random() - 0.5) * 1.4, p.pos.y + p.H * 0.6, p.pos.z + (Math.random() - 0.5) * 1.4, 0xffd070, 2);
    audio.power('surf');
    return true;
  }
  addScore(n) {
    this.score += n;
    ui.setScore(this.score);
  }
  addEco(n) {
    this.stats.eco += n;
  }
  // Un obstáculo de madera se vuelve objetivo destructible para los poderes (el hacha lo sigue rompiendo igual)
  registerObstacle(o) {
    if (!o.alive || o.breakBy !== 'axe' || o.prop) return;
    o.prop = this.combat.addProp({ x: o.x, y: o.y, z: o.z, radius: Math.max(0.9, Math.min(o.w, o.d) * 0.6), hp: DESTRUCTIBLE.obstacle, height: o.h, label: 'Obstáculo', mesh: o.g, onBreak: () => this.world.breakObstacle(o) });
  }
  onObstacleBroken(o) {
    if (o.prop) { o.prop.dead = true; this.combat.removeProp(o.prop); }
    const { fx } = this;
    for (let i = 0; i < 14; i++) { fx.dustPuff(o.x, o.y + 0.5, o.z, 1.2); fx.rock(o.x, o.y + 0.6, o.z); }
    for (let i = 0; i < 6; i++) fx.sparkle(o.x, o.y + 1, o.z, o.breakBy === 'wind' ? 0xdff2ff : 0xd8b878, 2.4);
  }

  startRope(to) {
    const p = this.player;
    this.rope = { from: p.pos.clone(), to: new THREE.Vector3(to.x, to.y, to.z), t: 0, dur: 0.95 };
    p.scripted = true;
    p.facing = Math.atan2(to.x - p.pos.x, to.z - p.pos.z);
    this.ropeLine.visible = true;
    this.ropeShow = 1;
  }
  ropeLineTo(target, life = 0.6) {
    const p = this.player;
    this.ropeLine.visible = true;
    this.ropeShow = life;
    const pos = this.ropeLine.geometry.attributes.position;
    pos.setXYZ(0, p.pos.x, p.pos.y + p.H * 0.75, p.pos.z);
    pos.setXYZ(1, target.x, target.y + 1, target.z);
    pos.needsUpdate = true;
  }
  reveal(v) {
    if (!v.hidden) return;
    v.hidden = false;
    v.root.visible = true;
    audio.found();
    ui.banner('find', '🔦 ¡Encontrado!', `${v.info.label} estaba oculto en la oscuridad`);
  }

  /* ---------- inicio de misión ---------- */
  start(def, level = LEVELS[0]) {
    const { scene, world, player, chase } = this;
    this.hero = def;
    this.mission = level;
    preloadBoss(level.boss); // los modelos del jefe y del aliado se cargan en segundo plano
    preloadAlly(level.ally);
    this.tips = { ...TIPS, ...(LEVEL_TIPS[level.id] || {}) };
    this.missionTime = level.time;
    world.duration = level.time;
    this.allies.clear();
    this.allyWin = false; this.victoryT = 0;
    this.aimSys.reset();
    this.clearVictims();
    world.reset();
    ui.tips.reset();
    ui.clearEdges();
    this.t = 0;
    this.score = 0;
    this.delivered = 0;
    this.foundCount = 0;
    this.stats = { people: 0, animals: 0, eco: 0 };
    this.ended = false;
    this.endT = 0;
    this.introT = 0;
    this.timeScale = 1;
    this.slowT = 0;
    this.timeStopT = 0; // detención del tiempo (visión del Lince): nunca pasa de un nivel a otro
    this.pingT = 0;
    this.pingCd = 0;
    this.playerHitT = 0;
    this.deliverT = 0;
    this.gaugeAcc = 0;
    this.goggleT = 0;
    this.rope = null;
    if (this.boss) this.boss.dispose();
    this.boss = null;
    this.skills.reset(); // limpia habilidades, esbirros, proyectiles y efectos de la partida anterior
    this.combat.reset();
    this.combat.clearProps();
    this.vfx.clear();
    this.team.clear();
    this.cdByHero = {};
    this.bossIntroT = 0;
    this.lastBossAction = '';
    ui.bossFight(false);
    this.bossDone = false;
    if (this.ally) this.ally.dispose();
    this.ally = null;
    this.scheduled = new Set();
    this.shownMoves = new Set();
    this.fxAcc = { ember: 0, rain: 0, spray: 0, ripple: 0, snow: 0, trail: 0 };
    for (const s of world.signs) s.used = false;

    const model = getHeroModel(def.id);
    if (model.root.parent !== scene) scene.add(model.root);
    model.setVisible(true);
    model.light.intensity = 0.35;
    player.setHero(def, model);
    player.reset(CFG.START.x, CFG.START.z);
    player.locked = true;
    const tools = Save.toolSet();
    player.capBonus = tools.has('star') ? 1 : 0;
    player.cdMul = tools.has('star') ? 0.75 : 1;

    // generación dinámica de rescates: zonas, puntos válidos, colisiones y accesibilidad
    const difficulty = 1 + (level.n - 1) * 0.15;
    const slots = world.generateRescues({ count: level.victims, animalRatio: level.animalRatio, minSep: level.minSep, minStart: level.minStart, tools, difficulty });
    world.scatterObstacles(level.obstacles, tools);
    this.spawnVictims(slots);
    this.total = this.victims.length;
    this.kindTotal = { people: this.victims.filter((v) => !v.info.animal).length, animals: this.victims.filter((v) => v.info.animal).length };
    ui.setRescueKinds(0, this.kindTotal.people, 0, this.kindTotal.animals);
    // vida del héroe (se conserva entre partidas) y objetos de recuperación del mapa
    this.life = { id: def.id, hp: Save.heroHp(def.id, HEALTH.max), max: HEALTH.max, ko: false };
    this.hpSaveT = 0; this.hpDirty = false; this.dotAcc = 0; this.blockT = 0; this.bossFxDone = false;
    this.bag.load();
    ui.bagCounts(this.bag);
    this.pickups.placeLevel(level, world, slots);
    // obstáculos de madera (ramas, tablones, troncos): también se rompen con los poderes
    for (const o of world.obstacles) this.registerObstacle(o);

    if (this.hazards) this.hazards.dispose();
    this.hazards = createHazards(level.scenario, {
      scene, world, sc: world.sc, level, hz: level.hz, fx: this.fx, player, chase, ui, audio, camera: this.camera, hero: def, game: this,
      tip: (id) => this.tip(id),
      addScore: (n) => this.addScore(n),
      addEco: (n) => this.addEco(n),
    });
    this.hazards.reset();
    // elementos vivos propios del nivel (CAMP FIRE: coleccionables, secretos, troncos móviles, cascada, cuevas)
    if (this.levelRt) this.levelRt.dispose();
    this.levelRt = world.sc.campfire ? new CampFireRuntime(this, world.sc.campfire) : null;
    if (!this.levelRt) { const el = document.getElementById('cf-hud'); if (el) el.style.display = 'none'; }
    this.buildAbilities();
    // portal de rescate único del nivel, con la variante del héroe elegido
    this.portal.mount(world.sc.safeObj, def.element);
    const pspots = this.portal.spots(this.safeSpots.length);
    if (pspots) this.safeSpots = pspots;

    ui.setHero(def);
    ui.setRescued(0, this.total);
    ui.setScore(0);
    ui.setCarry([], player.capacity);
    ui.setTime(this.missionTime);
    ui.setGaugeMode(level.scenario === 'flood' ? null : level);
    ui.setPower(0);
    ui.showScreen(null);
    ui.hud(true);
    ui.minimap.init(world);
    chase.yaw = 0;
    chase.pitch = 0.3;
    chase.distTarget = player.cam.dist; // cámara a la medida del héroe (scale.js)
    chase.dist = player.cam.dist;
    chase.aim = player.cam.aim;
    chase.snap(player.pos, 0);
    this.state = 'intro';
    this.input.enabled = true;
    const amb = AMBIENCE[level.scenario] || [0.3, 0.3];
    audio.setIntensity(amb[0], amb[1]);
    ui.banner('find', level.intro, `Rescata a ${this.total} personas y animales · ${level.introSub}`);
  }

  /* ---------- eventos del jugador ---------- */
  handlePlayerEvents() {
    const { player, fx, world } = this;
    for (const ev of player.events) {
      const p = player.pos;
      switch (ev.type) {
        case 'jump':
          audio.tone(300, 0.12, 'triangle', 0.08, 200);
          if (ev.water) { fx.splash(p.x, world.waterY, p.z, 10, 0.8); audio.splash(); }
          break;
        case 'land':
          if (ev.water) {
            fx.splash(p.x, world.waterY, p.z, 16, Math.min(1.6, ev.speed / 10));
            world.ripples.spawn(p.x, world.waterY + 0.03, p.z, 2.2, 1.1);
            audio.splash();
          } else for (let i = 0; i < 5; i++) fx.dustPuff(p.x, p.y, p.z, 0.8);
          if (ev.speed > 15) this.chase.shake(0.12);
          break;
        case 'mantle':
          for (let i = 0; i < 4; i++) fx.dustPuff(p.x, p.y + 0.3, p.z, 0.6);
          audio.whoosh();
          break;
        case 'power':
          this.skills.startSpeedFx(); // animación y estela del botón de velocidad
          this.onPower(ev.power);
          if (this.hazards) this.hazards.onPower(ev.power, player.pos, this.hero);
          break;
        case 'airJump': { // ÁMBAR: doble salto en el aire = Vuelo Libre
          if (this.state !== 'playing' || (this.toolCd['hs:flight'] || 0) > 0) break;
          const r = this.skills.use('flight');
          if (r) this.toolCd['hs:flight'] = (this.hero && HERO_SKILLS_CD(this.hero.id)) * this.player.cdMul;
          break;
        }
        case 'fail':
          ui.banner('find', '⚠️', ev.msg);
          break;
        case 'rescueStart':
          this.slowT = 0.7;
          this.chase.fovKick = -6;
          audio.pick();
          break;
        case 'pickup':
          this.pickup(ev.victim);
          break;
        case 'debris':
          if (!this.shownMoves.has('debris')) { this.shownMoves.add('debris'); this.tip('debris'); }
          audio.splash();
          this.chase.shake(0.08);
          break;
        default:
          break;
      }
    }
  }

  onPower(type) {
    const { player, fx, world, chase } = this;
    const p = player.pos;
    audio.power(type);
    chase.fovKick = 7;
    if (type === 'dash') {
      fx.flameRing(p.x, p.y + 0.4, p.z, 30);
      chase.shake(0.15);
    } else if (type === 'glide') {
      for (let i = 0; i < 30; i++) fx.mist(p.x + (Math.random() - 0.5) * 1.5, p.y + 0.3, p.z + (Math.random() - 0.5) * 1.5, 0xe8f6ff, 1.8);
      for (let i = 0; i < 24; i++) fx.sparkle(p.x, p.y + 0.5, p.z, 0xcfeaff, 3.5);
      chase.shake(0.2);
    } else if (type === 'pillar') {
      for (let i = 0; i < 26; i++) { fx.rock(p.x, p.y, p.z); fx.dustPuff(p.x, p.y, p.z, 1.4); }
      for (let i = 0; i < 12; i++) fx.gem(p.x, p.y + 0.4, p.z);
      chase.shake(0.35);
      audio.rumble();
    } else if (type === 'ice') {
      const dx = Math.sin(player.facing) * 3.6, dz = Math.cos(player.facing) * 3.6;
      for (let i = 0; i < 46; i++) fx.iceShard(p.x + dx, world.waterY + 0.2, p.z + dz, 1.4);
      for (let i = 0; i < 12; i++) fx.mist(p.x + dx, world.waterY + 0.3, p.z + dz, 0xd8f0ff, 1.6);
    } else if (type === 'surf') {
      fx.waterRing(p.x, world.waterY + 0.1, p.z, 34);
      world.ripples.spawn(p.x, world.waterY + 0.04, p.z, 4, 1.4);
      chase.shake(0.1);
    }
    if (!this.shownMoves.has('power')) {
      this.shownMoves.add('power');
      setTimeout(() => this.tip('power'), 1500);
    }
  }

  /* ---------- rescates ---------- */
  isBlocked(v) {
    return v.blockers && v.blockers.some((o) => o.alive);
  }
  nearestRescuable() {
    const { player } = this;
    let best = null, bd = 1e9;
    for (const v of this.victims) {
      if (v.state !== 'waiting' || v.hidden) continue;
      const d = Math.hypot(v.wpos.x - player.pos.x, v.wpos.z - player.pos.z);
      const dy = Math.abs(v.wpos.y + v.height * 0.5 - (player.pos.y + player.H * 0.5));
      if (d < bd && dy < 2.6) {
        bd = d;
        best = v;
      }
    }
    return { v: best, d: bd };
  }

  tryRescue() {
    const { player } = this;
    if (this.state !== 'playing' || player.rescueT > 0 || player.locked || player.scripted) return;
    const { v, d } = this.nearestRescuable();
    if (!v || d > 3.6) {
      ui.banner('find', '🔎', 'Acércate a alguien que necesite ayuda');
      return;
    }
    if (this.isBlocked(v)) {
      const need = v.blockers[0].breakBy === 'wind' ? '🌀 Poder de viento' : '🪓 Hacha';
      ui.banner('find', '🔒 ¡Está atrapado!', `Usa ${need} para despejar el camino`);
      return;
    }
    if (v.thirsty) {
      ui.banner('find', '💧 ¡Tiene mucha sed!', 'Dale de beber con la 💧 Cantimplora');
      return;
    }
    if (player.carrying.length >= player.capacity) {
      ui.banner('find', '🎒', `Ya llevas a ${player.capacity}. ¡Llévalos al refugio primero!`);
      return;
    }
    // RESCATE CON BURBUJA: sin agacharse ni cargarla; la burbuja aparece al instante alrededor de la víctima
    player.facing = Math.atan2(v.wpos.x - player.pos.x, v.wpos.z - player.pos.z);
    const h = player.pos.clone(); h.y += player.H * 0.6;
    const t = v.wpos.clone(); t.y += (v.height || 1) * 0.5;
    this.vfx2.beam(h, t, { r: 0.07, color: 0x9ae8ff, opacity: 0.8, life: 0.3 }); // rayo de energía del héroe a la víctima
    this.pickup(v);
  }

  pickup(v) {
    const { player } = this;
    if (!v || v.state !== 'waiting' || this.bubbles.has(v)) return; // nunca dos burbujas ni dos rescates de la misma víctima
    v.state = 'carried';
    v.setMode('carried');
    v.marker.visible = false;
    player.carrying.push(v);
    this.bubbles.add(v); // la víctima va en su propia burbuja (el héroe ya no la lleva encima)
    audio.pick();
    this.chase.fovKick = -4;
    ui.setCarry(player.carrying, player.capacity);
    ui.banner('good', '🐾 ¡Te sigo!', `${v.info.label} a salvo contigo. ¡Al refugio!`);
    if (v.kind === 'nino') this.tip('kid');
    if (v.kind === 'anciano') this.tip('elder');
    if (v.info.animal) this.tip('pets');
    this.score += 10;
  }

  deliverOne() {
    const { player, fx, scene } = this;
    const v = player.carrying.shift();
    if (!v) return;
    scene.attach(v.root);
    v.root.scale.set(1, 1, 1);
    this.bubbles.release(v, CFG.SAFE.y + 0.02); // la burbuja se expande, destella y la suelta en el suelo
    v.root.rotation.set(0, 0, 0);
    const spot = this.safeSpots[this.delivered % this.safeSpots.length];
    v.walkTo = spot;
    v.state = 'delivered';
    v.setMode('walk');
    v.marker.visible = false;
    v.root.position.y = CFG.SAFE.y + 0.02;
    this.portal.welcome(v); // el portal se abre y la persona lo cruza antes de ir a su sitio
    this.delivered++;
    if (v.info.animal) { this.stats.animals++; this.stats.eco += 10; } else { this.stats.people++; this.stats.eco += 5; }
    const urgentBonus = v.urgent ? 50 : 0;
    this.score += 100 + urgentBonus;
    ui.setRescued(this.delivered, this.total);
    if (this.kindTotal) ui.setRescueKinds(this.stats.people, this.kindTotal.people, this.stats.animals, this.kindTotal.animals);
    ui.setScore(this.score);
    ui.setCarry(player.carrying, player.capacity);
    ui.banner('good', '❤️ ¡Rescate completado!', `${v.info.label} está a salvo${urgentBonus ? ' · ¡bonus por urgencia!' : ''}`);
    audio.success();
    const p = player.pos;
    fx.confetti(p.x, p.y + 1.6, p.z);
    this.slowT = 0.5;
    this.chase.shake(0.06);
    player.celebrateTimer = 1.4;
    player.celebrate = true;
    if (this.delivered >= this.total) {
      if (this.mission.boss && !this.bossDone) this.prepareBoss();
      else this.end(true);
    }
  }

  /* ---------- combate contra el jefe de nivel ---------- */
  // Descubrimiento de la zona del jefe: el juego se detiene y main.js abre la selección y formación del equipo
  prepareBoss() {
    this.state = 'prep';
    this.player.locked = true;
    this.skills.reset();
    this.team.clear();
    ui.hud(false);
    if (this.onBossPrep) this.onBossPrep();
    else this.startBoss([this.hero.id]); // sin pantalla de equipo (pruebas): combate con el héroe actual
  }

  // Comienza el combate con el equipo elegido (ids en orden; el primero sale al campo)
  startBoss(ids) {
    const { scene, world, player, chase, camera } = this;
    if (!this.team.on) this.saveHp(true); // la vida de la exploración pasa al combate
    if (ids && ids.length) this.team.set(ids);
    else if (!this.team.on) this.team.set([this.hero.id]);
    const leader = this.team.current.id;
    if (leader !== this.hero.id) this.swapHero(leader, { silent: true });
    const lm = player.model; // la formación pudo retirar el modelo de la escena
    if (lm.root.parent !== scene) scene.add(lm.root);
    lm.setVisible(true);
    this.state = 'playing';
    ui.hud(true);
    const arena = world.sc.bossArena || { x: CFG.SAFE.x, z: CFG.SAFE.z - 18, r: 16 };
    player.pos.set(arena.x, terrainH(arena.x, arena.z + arena.r * 0.7) + 0.5, arena.z + arena.r * 0.7);
    player.vx = 0; player.vz = 0; player.vy = 0;
    player.facing = Math.PI;
    player.locked = true;
    this.boss = createBoss(this.mission.boss, { scene, world, player, chase, camera, fx: this.fx, audio, ui, game: this }, arena);
    this.boss.introHold = TEAM.introT; // presentación: el jefe no ataca hasta que aparece el equipo
    // vida adaptada a la dificultad: +6 % por cada nivel
    const hk = 1 + (this.mission.n - 1) * 0.06;
    this.boss.hpMax = Math.round(this.boss.hpMax * hk);
    this.boss.hp = this.boss.hpMax;
    this.boss.title = this.mission.bossTitle || '';
    // SOLDADOS: el jefe entra con 2 (primeras zonas) o 3 (el tercero, un bruto); hay que derrotarlos a todos
    this.combat.spawnMinions(this.mission.n <= 2 ? 2 : 3, this.boss.pos);
    enableSeeThrough(this.world.mats); // el escenario que tape el combate se vuelve transparente
    this.allyWin = false; this.victoryT = 0; this.foesMsg = ''; this.victoryShown = false;
    this.bossStats = { t0: performance.now() / 1000, soldiers: 0, staggers: 0 }; // para la pantalla de victoria
    this.team.allOnField = true; // los tres héroes están en el campo combatiendo (nadie descansa en reserva)
    this.pickups.placeArena(this.mission, arena);
    if (this.mission.ally) this.ally = createAlly(this.mission.ally, { scene, world, player, chase, camera, fx: this.fx, audio, ui, game: this });
    this.setBossCamera();
    ui.setGaugeMode(this.mission);
    // presentación del jefe y aparición del equipo (cada héroe con su estatura oficial)
    this.bossIntroT = TEAM.introT;
    this.lastBossAction = '';
    ui.bossIntro(this.boss.name, this.boss.slamName ? `${this.boss.chargeName} · ${this.boss.slamName}` : '');
    ui.fade(false);
    this.spawnFormation();
    setTimeout(() => { if (this.boss) ui.bossFight(true); }, 1500);
    ui.setTeamHud(this.team.members, this.team.active, (i) => this.switchTeamTo(i));
  }
  // Cámara de combate: se ajusta al tamaño del jefe y del héroe en el campo (NUNCA se escala al héroe)
  setBossCamera() {
    const bc = bossCameraFor(this.player.H, bossScale(this.mission.boss).height);
    this.chase.distTarget = bc.dist;
    this.chase.aim = bc.aim;
  }

  /* ---------- equipo: formación, cambio de héroe y vida ---------- */
  // Los héroes en reserva aparecen junto al activo durante la presentación (estatura real) y luego esperan fuera de escena
  spawnFormation() {
    const { player, fx } = this;
    this.bench = [];
    const side = [-1, 1, -2, 2];
    let k = 0;
    this.team.members.forEach((m, i) => {
      if (i === this.team.active) return;
      const model = getHeroModel(m.id);
      if (model.root.parent !== this.scene) this.scene.add(model.root);
      model.setVisible(true);
      const off = side[k++] * 2.4;
      const x = player.pos.x + Math.cos(0) * off, z = player.pos.z + 1.2;
      model.root.position.set(x, terrainH(x, z), z);
      model.root.rotation.y = Math.PI;
      this.bench.push({ model, x, z });
      for (let j = 0; j < 24; j++) fx.sparkle(x, terrainH(x, z) + 0.2 + Math.random() * 1.6, z, 0xffe070, 2.6);
      this.vfx.ring(x, null, z, { r0: 0.4, r1: 2.2, dur: 0.7, color: 0xffe070 });
    });
    for (let j = 0; j < 24; j++) fx.sparkle(player.pos.x, player.pos.y + Math.random() * 1.6, player.pos.z, 0xffe070, 2.6);
    this.vfx.ring(player.pos.x, null, player.pos.z, { r0: 0.4, r1: 2.4, dur: 0.7, color: 0xffe070 });
  }
  hideFormation() {
    for (const b of this.bench || []) {
      b.model.setVisible(false);
      for (let j = 0; j < 14; j++) this.fx.sparkle(b.x, terrainH(b.x, b.z) + Math.random() * 1.4, b.z, 0xffe070, 2);
    }
    this.bench = [];
  }

  // Presentación: durante unos segundos el equipo aparece completo (estaturas reales); luego solo queda el héroe activo
  updateBossIntro(real) {
    if (this.bossIntroT <= 0) return;
    this.bossIntroT -= real;
    for (const b of this.bench || []) b.model.update(real, { speed: 0, grounded: true });
    // los compañeros ya no se retiran: se quedan en el campo y combaten junto al héroe del jugador
    if ((this.bench || []).length && this.bossIntroT < TEAM.introT - 3.0) { this.bench = []; this.allies.sync(); }
    if (this.bossIntroT <= 0) {
      this.player.locked = false;
      ui.banner('find', '⚔ ¡A combatir!', IS_TOUCH ? 'Toca los retratos para cambiar de héroe' : 'Q / clic: golpe con el arma · 2 poder · 3 escudo · Z / X cambian de héroe');
    }
  }
  // Barra del jefe, equipo, estados y acción actual (se refresca varias veces por segundo)
  updateBossHud(real) {
    this.bossHudAcc = (this.bossHudAcc || 0) + real;
    if (this.bossHudAcc < 0.06) return;
    this.bossHudAcc = 0;
    const b = this.boss;
    ui.setBossBar({ icon: b.icon, name: b.name, title: b.title, hp: b.hp, max: b.hpMax, phase: b.phase, slow: b.st.slow > 0, root: b.st.root > 0, blind: b.st.blind > 0, mark: b.st.mark > 0, hurt: b.hitFlash > 0.15, soldiers: this.combat.aliveSoldiers().length, bossDead: b.state === 'dead' });
    const act = b.actionLabel ? b.actionLabel() : '';
    if (act !== this.lastBossAction) {
      this.lastBossAction = act;
      ui.bossAction(act ? `⚠ ${act}` : '');
      if (act) ui.battleLog(`${b.icon} ${b.name}: ${act}`, 'boss');
    }
    ui.setTeamHud(this.team.members, this.team.active, (i) => this.switchTeamTo(i));
  }

  // Cambia el héroe en el campo conservando posición, orientación y recargas de cada uno
  swapHero(id, { silent = false } = {}) {
    const def = HEROES.find((h) => h.id === id);
    if (!def || def.id === this.hero.id) return false;
    const { player, scene } = this;
    this.cdByHero[this.hero.id] = { toolCd: { ...this.toolCd }, power: player.cd };
    this.skills.reset();
    const pos = player.pos.clone(), facing = player.facing;
    const old = player.model;
    if (old) old.setVisible(false);
    const model = getHeroModel(id);
    if (model.root.parent !== scene) scene.add(model.root);
    model.setVisible(true);
    model.light.intensity = 0.35;
    this.hero = def;
    this.portal.setElement(def.element, silent);
    player.setHero(def, model);
    player.pos.copy(pos);
    player.facing = facing;
    player.vx = player.vz = 0;
    this.buildAbilities();
    const saved = this.cdByHero[id];
    if (saved) { this.toolCd = { ...saved.toolCd }; player.cd = saved.power; }
    ui.setHero(def);
    if (this.boss) this.setBossCamera();
    if (!silent) {
      for (let j = 0; j < 30; j++) this.fx.sparkle(pos.x, pos.y + Math.random() * player.H, pos.z, 0xffe070, 3);
      this.vfx.ring(pos.x, null, pos.z, { r0: 0.4, r1: 2.6, dur: 0.6, color: 0xffe070 });
      this.chase.shake(0.1);
      audio.found();
    }
    return true;
  }
  switchTeamTo(i) {
    const t = this.team;
    if (!this.boss || this.state !== 'playing' || this.bossIntroT > 0) return false;
    if (i === t.active || !t.members[i]) return false;
    if (t.members[i].ko) { ui.banner('find', '💔', `${HEROES.find((h) => h.id === t.members[i].id).name} está fuera de combate`); return false; }
    if (t.switchT > 0) return false;
    if (this.player.scripted) return false;
    // CAMBIO DE HÉROE: el elegido entra en el sitio del jugador (la cámara no salta) y el que sale
    // ocupa el hueco que deja el compañero, como reserva disponible. El combate sigue igual.
    const ally = this.allies.list.find((a) => a.member === t.members[i]);
    const slot = ally ? { pos: ally.pos.clone(), side: ally.side, facing: ally.facing } : null;
    const outName = this.hero.name;
    t.active = i;
    t.switchT = TEAM.switchCd;
    t.graceT = TEAM.switchGrace;
    this.swapHero(t.members[i].id);
    const before = new Set(this.allies.list);
    this.allies.sync();
    for (const a of this.allies.list) if (!before.has(a) && slot) { a.pos.copy(slot.pos); a.side = slot.side; a.facing = slot.facing; }
    this.switchFx(slot ? slot.pos : null);
    ui.battleLog(`🔁 Entra ${this.hero.name} · ${outName} sigue como compañero`, 'hero');
    ui.banner('good', `🔁 ¡Entra ${this.hero.name}!`, `${ELEMENTS[this.hero.element].icon} ${ELEMENTS[this.hero.element].name} · ${outName} sigue luchando a tu lado`);
    ui.setTeamHud(t.members, t.active, (k) => this.switchTeamTo(k));
    return true;
  }
  // CÁMARA DEL COMBATE DE JEFE: si el jugador no mueve la cámara, esta se coloca poco a poco detrás del
  // héroe mirando al jefe (el combate queda siempre a la vista); lo que tape la escena se vuelve transparente
  bossCamera(dt, look) {
    const b = this.boss, on = !!b && this.state === 'playing' && !this.ended;
    SEE.uSeeOn.value = on ? 1 : 0;
    if (!on) return;
    const p = this.player, ch = this.chase;
    SEE.uSeeCam.value.copy(this.camera.position);
    SEE.uSeeA.value.set(p.pos.x, p.pos.y + p.H * 0.6, p.pos.z);
    SEE.uSeeB.value.set(b.pos.x, b.pos.y + (b.S ? b.S.height * 0.55 : 1.5), b.pos.z);
    const moved = look && (Math.abs(look.dx) > 0.0005 || Math.abs(look.dy) > 0.0005);
    this.lookIdle = moved ? 0 : (this.lookIdle || 0) + dt;
    if (this.lookIdle < 1.2 || this.aimSys.on || this.victoryT > 0 || this.victoryShown || b.state === 'dead') return;
    const want = Math.atan2(p.pos.x - b.pos.x, p.pos.z - b.pos.z);
    let d = want - ch.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    ch.yaw += d * (1 - Math.exp(-1.6 * dt));
    ch.pitch = damp(ch.pitch, Math.max(ch.pitch, 0.42), 1.5, dt); // algo más alta: se ven el héroe y el jefe a la vez
  }
  // Transición del cambio de héroe: columna de luz del color del elemento en el héroe que entra,
  // un haz desde el hueco de reserva y una onda en el suelo (se ve claramente quién está activo)
  switchFx(from) {
    const p = this.player.pos, H = this.player.H, col = ELEMENTS[this.hero.element].color || 0xffe070;
    const top = new THREE.Vector3(p.x, p.y + H * 3, p.z), base = new THREE.Vector3(p.x, p.y, p.z);
    this.vfx2.beam(base, top, { r: 0.7, color: col, opacity: 0.6, life: 0.7 });
    if (from) this.vfx2.beam(new THREE.Vector3(from.x, from.y + 1, from.z), new THREE.Vector3(p.x, p.y + 1, p.z), { r: 0.18, color: 0xffe070, opacity: 0.7, life: 0.45 });
    this.vfx.ring(p.x, null, p.z, { r0: 0.4, r1: 3.6, dur: 0.6, color: col });
    for (let j = 0; j < 30; j++) this.fx.sparkle(p.x + (Math.random() - 0.5) * 1.2, p.y + Math.random() * H * 2, p.z + (Math.random() - 0.5) * 1.2, j % 2 ? col : 0xffffff, 2.8);
    this.player.celebrateTimer = 0.5; this.player.celebrate = true; // pequeño gesto al entrar al campo
  }
  cycleTeam(dir = 1) {
    const n = this.team.nextIndex(dir);
    if (n !== null) this.switchTeamTo(n);
  }

  // Posición del mundo → píxeles de pantalla (para números flotantes); null si queda detrás de la cámara
  screenOf(v, up = 0) {
    const p = new THREE.Vector3(v.x, v.y + up, v.z).project(this.camera);
    if (p.z > 1) return null;
    const el = this.renderer.domElement;
    return { x: (p.x * 0.5 + 0.5) * el.clientWidth, y: (-p.y * 0.5 + 0.5) * el.clientHeight };
  }
  floatAt(v, up, text, kind) {
    const s = this.screenOf(v, up);
    if (s) ui.floatText(s.x, s.y, text, kind);
  }

  // Golpe al héroe. `dmg` en unidades de golpe (1 = golpe normal). En el combate de jefe resta vida al héroe en el campo.
  hitPlayer(dmg, fromPos) {
    if (this.playerHitT > 0) return;
    if (this.player.shieldT > 0 || this.player.evadeT > 0) { this.shieldBlock(fromPos); if (this.boss && this.boss.onBlocked) this.boss.onBlocked(this.player.pos); return; } // el escudo anula el golpe (y el jefe rebota)
    if (this.team.on && this.boss) {
      if (this.team.graceT > 0 || this.bossIntroT > 0 || this.state !== 'playing') return;
      const phase = this.boss.phase || 1;
      const n = Math.max(1, Math.round(dmg * TEAM.hitDamage * (1 + TEAM.phaseScale * (phase - 1))));
      const idx = this.team.active, who = this.hero.name;
      const r = this.team.hit(n);
      this.playerHitT = 0.9;
      this.floatAt(this.player.pos, this.player.H + 0.3, `-${n}`, 'taken');
      ui.hurtTeamCard(idx);
      ui.battleLog(`💥 ${this.boss.name} golpea a ${who}: −${n}`, 'hit');
      this.chase.shake(0.22);
      this.slowT = Math.max(this.slowT, 0.35);
      ui.setOverlay('heat', 1);
      setTimeout(() => ui.setOverlay('heat', 0), 220);
      audio.noiseBurst(0.3, 180, 0.4, 'lowpass');
      this.hpDirty = true;
      if (r.ko) this.heroDown(who, r.wipe);
      return;
    }
    this.hurtHero(Math.round(dmg * TEAM.hitDamage), { from: fromPos, label: '💥 ¡Golpe recibido!', sub: 'Aléjate y busca el momento para contraatacar' });
  }

  /* ---------- vida del héroe ---------- */
  // Registro de vida del héroe en el campo: en el combate de jefe, el miembro activo del equipo
  get hpRef() { return this.team.on ? this.team.current : this.life; }
  get shielded() { return this.player.shieldT > 0 || this.player.evadeT > 0; }

  // Daño de los peligros del escenario (réplicas, escombros, fuego, lava...). dot = daño continuo por segundo ya multiplicado por dt.
  // Devuelve true si el héroe ha recibido daño.
  hurtHero(n, { from = null, label = '', sub = '', dot = false } = {}) {
    if (this.state !== 'playing' || this.ended || n <= 0) return false;
    if (this.shielded) { if (!dot) this.shieldBlock(from); return false; }
    if (!dot && this.playerHitT > 0) return false;
    if (this.team.on && this.boss) {
      if (this.team.graceT > 0 || this.bossIntroT > 0) return false;
      const idx = this.team.active, who = this.hero.name;
      const r = this.team.hit(n);
      this.hpDirty = true;
      this.hurtFeedback(n, dot);
      if (!dot) ui.hurtTeamCard(idx);
      if (r.ko) this.heroDown(who, r.wipe);
      return true;
    }
    const L = this.life;
    if (L.hp <= 0) return false;
    L.hp = Math.max(0, L.hp - n);
    this.hpDirty = true;
    this.hurtFeedback(n, dot);
    if (!dot) {
      this.score = Math.max(0, this.score - 10);
      ui.setScore(this.score);
      if (label) ui.banner('find', label, sub || `−${Math.round(n)} de vida`);
    }
    if (L.hp <= 0) this.heroDefeated();
    return true;
  }
  hurtFeedback(n, dot) {
    const p = this.player;
    if (!dot) p.hurtAnim = 0.4; // animación de impacto del héroe (solo visual)
    if (dot) {
      this.dotAcc += n;
      if (this.dotAcc >= 3) { this.floatAt(p.pos, p.H + 0.3, `-${Math.round(this.dotAcc)}`, 'taken'); this.dotAcc = 0; }
      ui.hpHurt(true);
      return;
    }
    this.playerHitT = HEALTH.hitGrace;
    this.floatAt(p.pos, p.H + 0.3, `-${Math.round(n)}`, 'taken');
    this.chase.shake(0.22);
    this.slowT = Math.max(this.slowT, 0.35);
    ui.setOverlay('heat', 1);
    setTimeout(() => ui.setOverlay('heat', 0), 220);
    ui.hpHurt();
    audio.noiseBurst(0.3, 180, 0.4, 'lowpass');
    for (let j = 0; j < 10; j++) this.fx.sparkle(p.pos.x, p.pos.y + 0.4 + Math.random() * p.H * 0.8, p.pos.z, 0xff5a4a, 2.4);
  }
  // Golpe detenido por el escudo: destello azul, anillo y texto «BLOQUEADO»
  shieldBlock(from) {
    if (this.blockT > 0) return;
    this.blockT = 0.35;
    const p = this.player.pos, H = this.player.H;
    let x = p.x, z = p.z;
    if (from) { const dx = from.x - p.x, dz = from.z - p.z, l = Math.hypot(dx, dz) || 1; x += (dx / l) * 0.8; z += (dz / l) * 0.8; }
    this.vfx.ring(p.x, null, p.z, { r0: 0.6, r1: 2.4, dur: 0.4, color: 0x8ad8ff });
    this.vfx.sparks(x, p.y + H * 0.55, z, 0xbfeaff, 16, 3.2);
    this.vfx2.shell(new THREE.Vector3(p.x, p.y + H * 0.5, p.z), { r: Math.max(1.2, H * 0.85), color: 0x8ad8ff, rim: 0xffffff, opacity: 0.55, life: 0.35 }); // la cúpula del escudo destella al recibir el golpe
    this.floatAt(p, H + 0.4, '🛡️ BLOQUEADO', 'block');
    ui.hpBlock();
    audio.sfx('chime');
  }
  // Vida a cero fuera de un jefe: derrota
  heroDefeated() {
    const p = this.player.pos;
    for (let j = 0; j < 30; j++) this.fx.sparkle(p.x, p.y + Math.random() * this.player.H, p.z, 0xff6a5a, 2.8);
    this.saveHp(true);
    this.end(false, `${this.hero.name} se ha quedado sin vida`);
  }
  // Usar un objeto de la mochila sobre el héroe en el campo
  useItem(type) {
    const it = HEAL_ITEMS[type];
    if (!it) return { ok: false };
    if (this.state !== 'playing' || this.ended) return { ok: false, msg: 'Ahora no se puede usar' };
    if (this.bag.count(type) <= 0) return { ok: false, msg: 'No te quedan unidades' };
    const r = this.hpRef;
    if (!r || r.ko || r.hp <= 0) return { ok: false, msg: 'El héroe no puede usarlo ahora' };
    if (r.hp >= r.max) { ui.banner('find', '❤️ Vida completa', 'Guárdalo para cuando lo necesites'); return { ok: false, msg: 'La vida ya está completa' }; }
    const amt = healAmount(type, r.hp, r.max);
    if (amt <= 0 || !this.bag.take(type)) return { ok: false };
    r.hp = Math.min(r.max, r.hp + amt);
    this.hpDirty = true;
    this.saveHp(true);
    this.healFx(amt, it);
    ui.banner('good', `${it.icon === '✚' ? '🩹' : it.icon} ${it.name}`, `+${Math.round(amt)} de vida`);
    if (this.team.on) ui.setTeamHud(this.team.members, this.team.active, (i) => this.switchTeamTo(i));
    return { ok: true, amt };
  }
  healFx(amt, it) {
    const p = this.player.pos, H = this.player.H;
    const col = new THREE.Color(it.color).getHex();
    const special = it.pct != null;
    this.floatAt(p, H + 0.3, `+${Math.round(amt)}`, 'heal');
    for (let j = 0; j < (special ? 40 : 22); j++) this.fx.sparkle(p.x + (Math.random() - 0.5) * 1.4, p.y + Math.random() * H, p.z + (Math.random() - 0.5) * 1.4, j % 3 ? 0x6aff9a : col, special ? 3.2 : 2.2);
    this.vfx.ring(p.x, null, p.z, { r0: 0.4, r1: special ? 3.2 : 2, dur: special ? 0.8 : 0.5, color: col });
    if (special) this.vfx.ring(p.x, null, p.z, { r0: 0.2, r1: 2.2, dur: 1.1, color: 0x6aff9a });
    ui.hpHeal();
    audio.sfx(special ? 'aurora' : 'shimmer');
  }
  // Guarda la vida actual del héroe (o de todo el equipo) en la partida
  saveHp(force = false) {
    if (!this.hpDirty && !force) return;
    this.hpDirty = false;
    if (this.team.on) for (const m of this.team.members) Save.setHeroHp(m.id, m.ko ? 0 : m.hp);
    else if (this.life.id) Save.setHeroHp(this.life.id, this.life.hp);
  }
  // Recogida de un objeto del mapa → mochila
  onPickup(p) {
    if (!this.bag.add(p.type)) return false;
    const it = HEAL_ITEMS[p.type];
    const col = new THREE.Color(it.color).getHex();
    for (let j = 0; j < 18; j++) this.fx.sparkle(p.x, p.y + 0.5 + Math.random() * 0.8, p.z, col, 2.6);
    this.vfx.ring(p.x, null, p.z, { r0: 0.3, r1: 1.6, dur: 0.4, color: col });
    this.floatAt({ x: p.x, y: p.y, z: p.z }, 1.6, `🎒 +1 ${it.short}`, 'pick');
    ui.banner('good', `🎒 ${it.name}`, `Guardado en la mochila (${this.bag.count(p.type)}/${this.bag.cap(p.type)})`);
    ui.bagCounts(this.bag);
    audio.found();
    return true;
  }
  onPickupFull(p) {
    const it = HEAL_ITEMS[p.type];
    ui.banner('find', '🎒 Mochila llena', `${it.name}: ${this.bag.count(p.type)}/${this.bag.cap(p.type)} · úsalo antes de recoger más`);
  }
  // NPC hostil derrotado: deja de combatir; a veces suelta una bebida o un botiquín amarillo
  onNpcDefeated(m) {
    if (this.boss && this.bossStats) this.bossStats.soldiers++;
    ui.battleLog(`💥 ${m.cat.name} derrotado`, 'hero');
    const chance = m.kind === 'bruto' ? 0.6 : MINIONS.dropChance;
    if (Math.random() < chance) this.pickups.drop(m.kind === 'bruto' ? 'kit25' : 'drink', m.pos.x, m.pos.z);
  }
  // Un héroe cae: entra el siguiente disponible; si no queda ninguno, el equipo es derrotado
  heroDown(name, wipe) {
    const p = this.player.pos;
    for (let j = 0; j < 26; j++) this.fx.sparkle(p.x, p.y + Math.random() * this.player.H, p.z, 0xff6a5a, 2.6);
    ui.battleLog(`💔 ${name} cae`, 'hit');
    if (wipe) { this.teamDefeated(); return; }
    ui.banner('find', `💔 ¡${name} ha caído!`, 'Entra el siguiente héroe del equipo');
    const n = this.team.nextIndex(1);
    if (n !== null) {
      this.team.switchT = 0;
      this.switchTeamTo(n);
      this.team.graceT = TEAM.switchGrace * 1.6;
    }
  }
  // Un compañero controlado por la máquina cae
  onAllyDown(a) {
    ui.battleLog(`💔 ${a.def.name} cae`, 'hit');
    ui.banner('find', `💔 ¡${a.def.name} ha caído!`, 'Sigue luchando con el resto del equipo');
    ui.setTeamHud(this.team.members, this.team.active, (i) => this.switchTeamTo(i));
    if (!this.team.anyAlive) this.teamDefeated();
  }
  // Objetivos que pueden atacar el jefe y sus soldados: el héroe del jugador y los compañeros que combaten
  heroTargets() {
    const p = this.player;
    const out = [{ pos: p.pos, R: p.R, H: p.H, isPlayer: true }];
    if (this.boss && this.team.on) for (const a of this.allies.alive) out.push({ pos: a.pos, R: a.R, H: a.H, ally: a }); // los compañeros también reciben golpes
    return out;
  }
  hitHero(h, units, from) {
    if (h && h.ally) this.allies.hit(h.ally, units, from);
    else this.hitPlayer(units, from);
  }
  // Victoria: jefe derrotado y ningún soldado en pie
  updateVictory(dt) {
    const b = this.boss;
    if (!b || this.bossDone) return;
    const left = this.combat.aliveSoldiers().length;
    const bossDead = b.state === 'dead';
    if (this.victoryShown) return; // pantalla de victoria abierta: espera a «Continuar»
    if (this.victoryT > 0) {
      // SECUENCIA DE VICTORIA: cámara lenta al principio, la cámara gira alrededor del equipo que celebra
      // y caen confeti y destellos; al terminar, la pantalla de victoria con las recompensas
      this.victoryT -= dt;
      const ch = this.chase;
      ch.yaw += dt * 0.5;
      ch.pitch = damp(ch.pitch, 0.25, 2, dt);
      if (Math.random() < dt * 3) { const p = this.player.pos; this.fx.confetti(p.x + (Math.random() - 0.5) * 6, p.y + 3, p.z + (Math.random() - 0.5) * 6); }
      if (this.victoryT <= 0) this.showBossVictory();
      return;
    }
    if (bossDead && b.deathT > 1.1 && left === 0) {
      this.allyWin = true;
      this.player.celebrate = true;
      this.player.celebrateTimer = 0;
      this.player.locked = true;
      this.combat.clearLingering();
      ui.alert('🏆 ¡JEFE DE ZONA DERROTADO!', 3200);
      ui.battleLog('🏆 ¡Jefe de Zona derrotado!', 'hero');
      audio.success();
      this.slowT = Math.max(this.slowT, 1.0);
      let fl = document.getElementById('bv-flash');
      if (!fl) { fl = document.createElement('div'); fl.id = 'bv-flash'; document.body.appendChild(fl); }
      fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
      const p = this.player.pos;
      this.vfx.ring(p.x, null, p.z, { r0: 0.5, r1: 9, dur: 1, color: 0xffe070 });
      for (let j = 0; j < 50; j++) this.fx.sparkle(p.x + (Math.random() - 0.5) * 4, p.y + Math.random() * 3, p.z + (Math.random() - 0.5) * 4, j % 2 ? 0xffe070 : 0xffffff, 3.2);
      this.victoryT = 3.4;
      return;
    }
    const msg = bossDead && left ? 'boss' : !bossDead && left === 0 && this.foesMsg === '' ? 'soldiers' : this.foesMsg;
    if (msg !== this.foesMsg) {
      this.foesMsg = msg;
      if (msg === 'boss') ui.banner('find', `${b.icon} ¡${b.name} ha caído!`, `Quedan ${left} soldado${left === 1 ? '' : 's'}: derrótalos para ganar`);
      if (msg === 'soldiers') ui.banner('find', '⚔️ Soldados derrotados', `Solo queda ${b.name}`);
    }
  }
  // Pantalla de victoria: resumen del combate y recompensas; «Continuar» cierra el combate
  showBossVictory() {
    const b = this.boss, s = this.bossStats || {};
    this.victoryShown = true;
    const now = performance.now() / 1000, secs = Math.max(0, Math.round(now - (s.t0 || now)));
    const reward = ITEMS[this.mission.reward];
    const up = this.team.members.filter((m) => !m.ko).length;
    const rewards = [
      { icon: '🏆', text: `Trofeo: ${b.name}`, value: b.icon },
      { icon: '⭐', text: 'Bonus de jefe de zona', value: '+300' },
      { icon: '⚔️', text: `Soldados derrotados: ${s.soldiers || 0}`, value: `+${(s.soldiers || 0) * 10}` },
      { icon: '💫', text: `Aturdimientos al jefe: ${s.staggers || 0}`, value: `+${(s.staggers || 0) * 20}` },
      { icon: '❤️', text: `Héroes en pie: ${up} / ${this.team.members.length}`, value: `+${up * 50}` },
      { icon: '⏱️', text: `Tiempo de combate: ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, value: '' },
    ];
    if (reward) rewards.push({ icon: reward.icon, text: `Premio de la zona: ${reward.name}`, value: '🎁' });
    this.bossBonus = (s.soldiers || 0) * 10 + (s.staggers || 0) * 20 + up * 50;
    ui.bossVictory({ icon: b.icon, name: b.name, title: b.title, team: this.team.members, rewards }, () => { this.victoryShown = false; this.finishBoss(); });
  }
  teamDefeated() {
    if (this.boss) this.boss.victory = true;
    this.allies.clear();
    ui.banner('find', '💔 ¡El equipo ha caído!', `${this.boss ? this.boss.name : 'El jefe'} sigue en pie. Prueba otra combinación de héroes.`);
    this.end(false, 'El equipo ha sido derrotado');
  }
  finishBoss() {
    this.bossDone = true;
    this.allies.clear();
    this.allyWin = false;
    this.player.celebrate = false;
    Save.markBoss(this.mission.boss);
    this.saveHp(true);
    this.addScore(300 + (this.bossBonus || 0));
    ui.banner('good', `🏆 ¡${this.boss.name} derrotado!`, `+${300 + (this.bossBonus || 0)} puntos de bonus`);
    this.bossBonus = 0;
    if (this.boss) this.boss.dispose();
    this.boss = null;
    if (this.ally) this.ally.dispose();
    this.ally = null;
    ui.bossFight(false);
    this.end(true);
  }

  /* ---------- consejos ---------- */
  tip(id) {
    if (this.tips[id]) {
      if (ui.tips.push(id, this.tips[id])) this.stats.eco += 2;
    }
  }

  interact() {
    const { player } = this;
    if (this.state !== 'playing' || player.locked || player.scripted) return;
    let best = null, bd = 1e9;
    for (const s of this.world.signs) {
      const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z);
      if (d < bd && Math.abs(s.y - player.pos.y) < 4) { bd = d; best = s; }
    }
    if (best && bd < 3.6) {
      const id = SIGN_TIPS[best.tip] || 'kit';
      ui.tips.showNow('sign:' + best.tip, this.tips[id] || TIPS[id]);
      audio.tip();
      if (!best.used) {
        best.used = true;
        this.score += 20;
        this.stats.eco += 5;
        ui.setScore(this.score);
        ui.banner('find', '📖 +20', 'Consejo leído');
      }
      return;
    }
    if (this.pingCd <= 0) {
      this.pingT = 4;
      this.pingCd = 7;
      audio.found();
      ui.banner('find', '📣 ¡Llamada de ayuda!', 'Los puntos de rescate se resaltan durante unos segundos');
      const p = player.pos;
      this.world.ripples.spawn(p.x, this.world.waterY + 0.04, p.z, 6, 1.5);
    }
  }

  /* ---------- detención del tiempo (visión del Lince) ---------- */
  // Dura `sec` segundos REALES y no se puede alargar: si ya está activa, otra activación no reinicia la cuenta.
  // Los efectos visuales los lleva el juego (no la habilidad), así que terminan exactamente con el tiempo detenido
  // aunque se cambie de héroe a mitad.
  startTimeStop(sec = 5, origin = this.player.pos) {
    if (this.timeStopT > 0 || this.state !== 'playing') return false;
    this.timeStopT = sec;
    const o = origin.clone();
    // pantalla: colores apagados y un velo verde-dorado (el mismo tono de los ojos de la visión)
    this.tsLayers = [
      this.vfx2.ambience({ color: '#8a8a8a', alpha: 0.55, blend: 'saturation', exposure: 0.95, dur: sec, fin: 0.35, fout: 0.45 }),
      this.vfx2.ambience({ color: '#cfe8a8', alpha: 0.18, blend: 'multiply', exposure: 1, dur: sec, fin: 0.35, fout: 0.45 }),
    ];
    // onda que congela: sale de la Lince y se expande por el escenario
    this.vfx.ring(o.x, null, o.z, { r0: 0.5, r1: 34, dur: 0.9, color: 0xd8ffa0, opacity: 0.7 });
    this.vfx.ring(o.x, o.y + 1.2, o.z, { r0: 0.3, r1: 22, dur: 0.7, color: 0xffe38a, opacity: 0.55 });
    this.tsDial = this.makeTimeDial(sec);
    audio.power && audio.power('ice');
    ui.banner('find', '⏳ Tiempo detenido', `El entorno se para ${sec} s · el cronómetro de la misión sigue corriendo`);
    return true;
  }
  endTimeStop() {
    const p = this.player.pos;
    this.vfx.ring(p.x, null, p.z, { r0: 30, r1: 0.5, dur: 0.6, color: 0xd8ffa0, opacity: 0.5 }); // el tiempo "vuelve" hacia ella
    for (const L of this.tsLayers || []) L.end();
    this.tsLayers = null;
    ui.banner('find', '⏱️', 'El tiempo vuelve a correr');
  }
  // esfera de reloj luminosa a los pies del héroe: 12 marcas y dos agujas que avanzan a saltos; se apaga al terminar
  makeTimeDial(sec) {
    const g = new THREE.Group(), mats = [];
    const mk = (col, op) => { const m = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }); mats.push(m); return m; };
    const rimM = mk(0x9cff5a, 0.75), tickM = mk(0xffcf3a, 0.85), handM = mk(0xfff2b0, 0.9); // verde-dorado: el color de los ojos de la visión
    const add = (geo, m, f) => { const o = new THREE.Mesh(geo, m); o.rotation.x = -Math.PI / 2; if (f) f(o); g.add(o); return o; };
    add(new THREE.RingGeometry(2.05, 2.2, 64), rimM);
    add(new THREE.RingGeometry(1.25, 1.3, 48), rimM);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU, big = i % 3 === 0; add(new THREE.PlaneGeometry(big ? 0.09 : 0.05, big ? 0.38 : 0.22), tickM, (o) => { o.position.set(Math.sin(a) * 1.82, 0, Math.cos(a) * 1.82); o.rotation.z = -a; }); }
    const hand = (len, w) => { const pivot = new THREE.Group(); const geo = new THREE.PlaneGeometry(w, len); geo.translate(0, len / 2, 0); const o = new THREE.Mesh(geo, handM); o.rotation.x = -Math.PI / 2; pivot.add(o); g.add(pivot); return pivot; };
    const hMin = hand(1.55, 0.06), hHour = hand(1.0, 0.09);
    g.renderOrder = 6;
    g.traverse((o) => { o.frustumCulled = false; });
    const p = this.player;
    let tick = 0;
    this.vfx.add(g, sec, (it) => {
      const t = it.t, fin = Math.min(1, t / 0.35), fout = Math.min(1, (sec - t) / 0.45);
      const k = Math.max(0, Math.min(fin, fout));
      g.position.set(p.pos.x, p.floorY(p.pos.x, p.pos.z, p.pos.y + 0.5) + 0.06, p.pos.z);
      g.scale.setScalar(0.6 + 0.4 * (1 - Math.pow(1 - fin, 3)));
      const s = Math.floor(t); // la aguja larga avanza a saltos, una vez por segundo (cuenta atrás visual)
      if (s !== tick) { tick = s; }
      hMin.rotation.y = -(tick + Math.min(1, (t - tick) * 8)) * (TAU / 12);
      hHour.rotation.y = -t * 0.12;
      rimM.opacity = 0.75 * k; tickM.opacity = 0.85 * k; handM.opacity = 0.9 * k;
      if (it.t >= sec) { for (const m of mats) m.dispose(); g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    });
    return g;
  }

  /* ---------- actualización ---------- */
  update(dt) {
    if (this.state === 'idle' || this.state === 'done') return;
    const { world, player, chase, input, camera } = this;
    const real = dt;
    this.slowT = Math.max(0, this.slowT - real);
    // DETENCIÓN DEL TIEMPO (visión del Lince): cuenta en tiempo REAL y dura exactamente lo que se pidió (5 s).
    // Solo se congela el ENTORNO (enemigos, jefe, peligros, escenario y personas que esperan); el héroe, sus poderes
    // y el CRONÓMETRO DE LA MISIÓN siguen igual (this.t usa dtg, nunca envDt).
    if (this.timeStopT > 0) { this.timeStopT = Math.max(0, this.timeStopT - real); if (this.timeStopT === 0) this.endTimeStop(); }
    const targetScale = this.slowT > 0 ? 0.45 : this.state === 'ending' ? 0.55 : 1;
    this.timeScale = damp(this.timeScale, targetScale, 10, real);
    const dtg = dt * this.timeScale;
    const envDt = this.timeStopT > 0 ? 0 : dtg; // tiempo del entorno (0 mientras está detenido)

    const introLocked = this.state === 'intro';
    if (introLocked) {
      this.introT += real;
      if (this.introT > 3.2) {
        this.state = 'playing';
        player.locked = false;
        this.tip('start');
      }
    }
    if (this.state === 'playing' && !this.ended && !this.boss) this.t += dtg; // el reloj de la misión se detiene durante el jefe
    const missionT = this.t;

    const move = input.getMove();
    const look = input.getLook(real);
    if (!IS_TOUCH && !input.locked && !introLocked && Math.abs(move.x) > 0.1 && Math.abs(look.dx) < 0.001) look.dx += move.x * 1.0 * real;

    if (player.celebrateTimer > 0) {
      player.celebrateTimer -= real;
      if (player.celebrateTimer <= 0 && this.state !== 'ending') player.celebrate = false;
    }
    if (this.state === 'ending') move.x = move.y = 0;

    // recargas de herramientas
    for (const k in this.toolCd) if (this.toolCd[k] > 0) this.toolCd[k] = Math.max(0, this.toolCd[k] - dtg);

    // cuerda: movimiento guiado
    if (this.rope) {
      const r = this.rope;
      r.t += dtg;
      const k = clamp(r.t / r.dur, 0, 1);
      const e = k * k * (3 - 2 * k);
      player.pos.set(r.from.x + (r.to.x - r.from.x) * e, r.from.y + (r.to.y - r.from.y) * e + Math.sin(k * Math.PI) * 1.4, r.from.z + (r.to.z - r.from.z) * e);
      player.vy = 0;
      const pos = this.ropeLine.geometry.attributes.position;
      pos.setXYZ(0, player.pos.x, player.pos.y + player.H * 0.75, player.pos.z);
      pos.setXYZ(1, r.to.x, r.to.y + 0.6, r.to.z);
      pos.needsUpdate = true;
      if (k >= 1) {
        this.rope = null;
        player.scripted = false;
        player.grounded = false;
        player.support = null;
        for (let i = 0; i < 8; i++) this.fx.dustPuff(player.pos.x, player.pos.y, player.pos.z, 0.9);
        this.ropeShow = 0.3;
      }
    }
    if (this.ropeShow > 0) {
      this.ropeShow -= real;
      if (this.ropeShow <= 0 && !this.rope) this.ropeLine.visible = false;
    }

    if (this.state === 'playing') this.skills.update(dtg); // habilidades del héroe (mueven al héroe antes de su actualización)
    player.update(dtg, move, chase.yaw);
    this.aimSys.update(real); // con la mira, Halley mira hacia la retícula
    this.updateCloseIn(dtg); this.bodyBlock(); // embestida hacia el enemigo y choque de cuerpos (no se atraviesan)
    this.weapons.update(dtg); // después de animar al héroe: el arma sigue al hueso de la mano
    this.bubbles.update(dtg); // las burbujas de los rescatados siguen al héroe (después de que se mueva)
    this.handlePlayerEvents();
    player.events.length = 0;
    if (this.hazards && (this.state === 'playing' || this.state === 'ending')) this.hazards.update(envDt, this.t);
    if (this.levelRt) this.levelRt.update(envDt, this.state === 'playing' && !this.boss);
    if (this.playerHitT > 0) this.playerHitT = Math.max(0, this.playerHitT - real);
    if (this.boss && this.state === 'playing') {
      this.team.update(dtg);
      this.updateBossIntro(real);
      this.updateBossHud(real);
    }
    if (this.boss && this.state === 'playing') {
      this.boss.update(envDt);
      this.allies.update(dtg); // los otros dos héroes del equipo combaten a la vez
      this.updateVictory(real);
    }
    if (this.ally && this.state === 'playing') this.ally.update(dtg);
    // derrota del jefe: estallido de victoria
    if (this.boss && this.boss.state === 'dead' && !this.bossFxDone) {
      this.bossFxDone = true;
      const b = this.boss, bp = b.pos, h = b.S ? b.S.height : 3;
      for (let j = 0; j < 60; j++) this.fx.sparkle(bp.x + (Math.random() - 0.5) * 3, bp.y + Math.random() * h, bp.z + (Math.random() - 0.5) * 3, j % 2 ? 0xffe070 : b.color || 0xff6a1a, 4.5);
      this.vfx.ring(bp.x, null, bp.z, { r0: 1, r1: 9, dur: 1.0, color: 0xffe070 });
      this.vfx.ring(bp.x, null, bp.z, { r0: 0.5, r1: 6, dur: 1.4, color: b.color || 0xff6a1a });
      this.chase.shake(0.5);
      ui.bossDefeatedFx();
    }
    this.blockT = Math.max(0, (this.blockT || 0) - real);
    if (this.state === 'playing') this.pickups.update(dtg, player, (p) => this.onPickup(p), (p) => this.onPickupFull(p));
    this.hpSaveT = (this.hpSaveT || 0) + real;
    if (this.hpSaveT > 1.5) { this.hpSaveT = 0; this.saveHp(); }
    this.combat.update(envDt);
    this.vfx.update(dtg);
    this.vfx2.update(dtg);
    this.envClock = (this.envClock ?? performance.now() / 1000) + envDt; // reloj de las animaciones del escenario (se para con el tiempo)
    world.update(envDt, this.envClock, camera.position, player.pos, missionT, true);
    const p = player.pos;

    // visuales de escudo, linterna y gafas
    this.updateToolVisuals(real);

    // víctimas
    for (const v of this.victims) {
      v.update(v.state === 'carried' ? dtg : envDt); // las que esperan o caminan se detienen con el tiempo
      v.root.getWorldPosition(v.wpos);
      if (v.state === 'waiting') {
        if (v.hidden) {
          v.root.visible = false;
          v.marker.visible = false;
          continue;
        }
        v.root.visible = true;
        v.marker.visible = true;
        if (!v.parentBody) {
          const want = Math.max(v.baseY, world.waterY - v.height * 0.45);
          v.root.position.y = damp(v.root.position.y, want, 4, envDt);
        }
        v.platformY = v.parentBody ? v.parentBody.y + v.baseY : v.baseY;
        const margin = world.hasWater ? (v.parentBody ? 9 : v.platformY - world.waterY) : 99;
        v.urgent = margin < 0.9 || (this.hazards ? this.hazards.urgentAt(v.wpos) : false);
        const blocked = this.isBlocked(v) || v.thirsty;
        v.marker.material.map = blocked ? this.markerTex.blocked : v.urgent ? this.markerTex.urgent : this.markerTex.warn;
        const d = Math.hypot(camera.position.x - v.wpos.x, camera.position.y - v.wpos.y, camera.position.z - v.wpos.z);
        const pulse = 1 + 0.12 * Math.sin(performance.now() / (v.urgent ? 110 : 250) + v.id);
        const k = clamp(d * 0.05, 1.0, 6.5) * pulse * (this.pingT > 0 ? 1.5 : 1);
        v.marker.scale.set(k, k, 1);
        v.marker.position.y = v.markerBase + k * 0.25;
        v.setMode(v.thirsty ? 'carried' : 'wave');
        if (!v.found && Math.hypot(p.x - v.wpos.x, p.z - v.wpos.z) < 20 && Math.abs(p.y - v.wpos.y) < 12) {
          v.found = true;
          this.score += 25;
          ui.setScore(this.score);
          audio.found();
          if (v.info.animal) ui.banner('find', '🐾 ¡Animal encontrado!', `${v.info.label} necesita ayuda`);
          else ui.banner('find', '🆘 ¡Persona encontrada!', `${v.info.label} necesita ayuda`);
          if (!this.shownMoves.has('foundtip')) {
            this.shownMoves.add('foundtip');
            this.tip(v.info.animal ? 'found_animal' : 'found_person');
          }
        }
      } else if (v.state === 'delivered' && v.walkTo) {
        const tgt = v.via && v.via.length ? v.via[0] : v.walkTo; // primero cruza el campo del portal
        const dx = tgt[0] - v.wpos.x, dz = tgt[1] - v.wpos.z;
        const dist = Math.hypot(dx, dz);
        if (v.via && v.via.length && dist <= 0.3) { v.via.shift(); if (!v.via.length) v.via = null; }
        else if (dist > 0.3) {
          const sp = 2.0 * envDt;
          v.root.position.x += (dx / dist) * Math.min(sp, dist);
          v.root.position.z += (dz / dist) * Math.min(sp, dist);
          v.root.rotation.y = Math.atan2(dx, dz);
          v.root.position.y = terrainH(v.root.position.x, v.root.position.z) + 0.02;
        } else {
          v.setMode('happy');
          v.walkTo = null;
        }
      }
    }
    if (this.pingT > 0) this.pingT -= real;
    if (this.pingCd > 0) this.pingCd -= real;

    const S = CFG.SAFE;
    const dSafe = Math.hypot(p.x - S.x, p.z - S.z);
    const inSafe = dSafe < S.r && p.y > S.y - 2.5;
    if (inSafe && player.carrying.length && this.state === 'playing') {
      this.deliverT -= dtg;
      if (this.deliverT <= 0) {
        this.deliverOne();
        this.deliverT = 0.8;
      }
    } else this.deliverT = 0.3;

    // DESLUMBRAMIENTO DE LA ZONA DE ENTREGA: al acercarse, el brillo baja un poco y de forma gradual
    // (0 a más de 26 m → 1 a 5 m o menos); main.js lo aplica a la exposición y al resplandor, y el portal a su luz.
    const near = Math.min(1, Math.max(0, (26 - dSafe) / 21)), glareT = near * near * (3 - 2 * near);
    this.glare = (this.glare || 0) + (glareT - (this.glare || 0)) * (1 - Math.exp(-2.2 * real));
    this.portal.update(real, { carrying: player.carrying.length > 0, dSafe, glare: this.glare });
    this.updatePrompt(inSafe);
    this.missionEvents(real);
    if (this.state === 'playing') this.contextTips();
    ui.tips.update(real);
    this.updateFX(dtg, real);

    if (this.state === 'ending') {
      chase.yaw += real * 0.45;
      chase.pitch = damp(chase.pitch, 0.22, 3, real);
      chase.distTarget = player.cam.dist * 0.7;
      chase.update(real, p, null);
    } else {
      this.bossCamera(real, look);
      chase.update(real, p, introLocked ? null : look);
    }
    if (introLocked) this.introCamera();
    if (input.wheel) input.wheel = 0;

    this.updateHud(real, dSafe);

    if (this.state === 'playing' && this.t >= this.missionTime && !this.ended) {
      // a más dificultad (hz), más margen para aprobar: los niveles suben de dificultad pero siguen siendo superables
      const need = clamp(0.7 - ((this.mission.hz || 1) - 1) * 0.06, 0.52, 0.7);
      this.end(this.delivered >= Math.ceil(this.total * need));
    }
    if (this.state === 'ending') {
      this.endT += real;
      if (this.endT > 3.4) this.finish();
    }
  }

  updateToolVisuals(real) {
    const { player, world, camera } = this;
    const p = player.pos;
    // escudo
    if (player.shieldT > 0) {
      this.shieldMesh.visible = true;
      this.shieldMesh.position.set(p.x, p.y + 1.0, p.z);
      const s = 1 + Math.sin(performance.now() / 120) * 0.04 + (player.shieldT < 1.5 ? Math.sin(performance.now() / 50) * 0.05 : 0);
      this.shieldMesh.scale.setScalar(s);
    } else this.shieldMesh.visible = false;
    // linterna: cono de luz que revela a los ocultos
    if (player.torchT > 0) {
      const fx_ = Math.sin(player.facing), fz_ = Math.cos(player.facing);
      this.torch.position.set(p.x, p.y + 1.5, p.z);
      this.torchTarget.position.set(p.x + fx_ * 14, p.y + 0.5, p.z + fz_ * 14);
      this.torch.intensity = damp(this.torch.intensity, 90, 8, real);
      for (const v of this.victims) {
        if (!v.hidden || v.state !== 'waiting') continue;
        const dx = v.wpos.x - p.x, dz = v.wpos.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 24 && d > 0.5 && (dx * fx_ + dz * fz_) / d > 0.5) this.reveal(v);
      }
    } else this.torch.intensity = damp(this.torch.intensity, 0, 10, real);
    // gafas
    if (this.goggleT > 0) {
      this.goggleT -= real;
      if (this.goggleT <= 0) world.fogMul = 1;
    }
  }

  introCamera() {
    const k = clamp(this.introT / 3.2, 0, 1);
    const e = k * k * (3 - 2 * k);
    const cam = this.camera;
    const S = CFG.SAFE, T = CFG.START;
    const s = new THREE.Vector3(T.x + 38, 56, T.z + 12);
    const sl = new THREE.Vector3(S.x, S.y - 2, S.z + 30);
    const pos = s.lerp(this.chase.pos.clone(), e);
    const look = sl.lerp(this.chase.look.clone(), e);
    cam.position.copy(pos);
    cam.lookAt(look);
  }

  updatePrompt(inSafe) {
    const { player } = this;
    if (this.state !== 'playing') return ui.prompt(null);
    const { v, d } = this.nearestRescuable();
    if (v && d < 3.6) {
      if (this.isBlocked(v)) ui.prompt(`🔒 Atrapado · usa ${v.blockers[0].breakBy === 'wind' ? '🌀' : '🪓'} para liberarlo`);
      else if (v.thirsty) ui.prompt('💧 Tiene sed · usa la Cantimplora');
      else if (player.carrying.length >= player.capacity) ui.prompt('🎒 Vas al completo · ¡Llévalos al refugio!');
      else ui.prompt(`${KEY('F', '🐾')} Rescatar · ${v.info.label}`);
      return;
    }
    for (const s of this.world.signs) {
      if (Math.hypot(s.x - player.pos.x, s.z - player.pos.z) < 3.6 && Math.abs(s.y - player.pos.y) < 4) {
        ui.prompt(`${KEY('E', '💡')} Leer cartel`);
        return;
      }
    }
    if (inSafe && player.carrying.length) return ui.prompt('🏥 Entregando en el refugio…');
    ui.prompt(null);
  }

  missionEvents() {
    const t = this.t;
    const at = (s, fn) => {
      if (t >= s && !this.scheduled.has(s)) {
        this.scheduled.add(s);
        fn();
      }
    };
    if (this.state !== 'playing') return;
    at(this.missionTime - 60, () => ui.alert('⏱️ ¡Queda 1 minuto!', 3500));
    at(this.missionTime - 20, () => { ui.alert('⏱️ ¡20 segundos!', 3000); audio.alert(); });
    const sc = this.mission.scenario;
    if (sc !== 'flood') {
      for (const [tt, id] of SCHED[sc] || []) at(tt, () => this.tip(id));
      if (sc !== 'quake') at(1, () => this.tip('start'));
      return;
    }
    const w = this.world.sc.water;
    at(60, () => {
      ui.alert('🌧️ La lluvia se intensifica', 3500);
      this.world.stormIntensity = 0.9;
      audio.setIntensity(0.9, 0.7);
    });
    at(w.surgeAt - 2, () => {
      ui.alert('⚠️ ¡ALERTA! CRECIDA REPENTINA · ¡Sube a un lugar alto!', 6000);
      audio.alert();
      this.chase.shake(0.35);
      audio.rumble();
      this.world.triggerLightning();
      this.tip('surge');
    });
    at(w.surgeAt + 2, () => this.chase.shake(0.3));
    at(40, () => this.tip('cars'));
    at(85, () => this.tip('contaminated'));
    at(150, () => this.tip('lightning'));
    at(195, () => this.tip('environment'));
    at(240, () => this.tip('kit'));
  }

  contextTips() {
    const { player } = this;
    if (this.mission.scenario !== 'flood') return;
    if (player.swimming && !this.shownMoves.has('deep')) { this.shownMoves.add('deep'); this.tip('deep'); }
    if (!this.shownMoves.has('current') && player.depth > 0.4 && (Math.abs(player.flow.x) + Math.abs(player.flow.z)) > 0.4) {
      this.shownMoves.add('current');
      this.tip('current');
    }
  }

  /* ---------- efectos ---------- */
  updateFX(dtg) {
    const { player, fx, world } = this;
    const p = player.pos;
    const a = this.fxAcc;
    const el = this.hero.element;
    const wy = world.waterY;
    const lite = world.mobile ? 0.5 : 1;

    if (world.hasWater) {
      a.rain += dtg * 22 * lite;
      while (a.rain > 1) {
        a.rain -= 1;
        const ang = Math.random() * TAU, rr = 2 + Math.random() * 16;
        const x = p.x + Math.cos(ang) * rr, z = p.z + Math.sin(ang) * rr;
        if (wy > terrainH(x, z) + 0.05) world.ripples.spawn(x, wy + 0.03, z, 0.5 + Math.random() * 0.5, 0.7);
      }
    }
    const inWater = (player.wading || player.swimming || player.surfing) && wy > terrainH(p.x, p.z) + 0.05;
    if (inWater && player.speedNow > 1.2) {
      a.spray += dtg;
      if (a.spray > 0.06) {
        a.spray = 0;
        const sp = player.speedNow;
        fx.spray(p.x, wy + 0.05, p.z, Math.sin(player.facing) * -1, 1.5 + sp * 0.2, Math.cos(player.facing) * -1, 1);
        fx.spray(p.x, wy + 0.05, p.z, 0, 1, 0, 0.8);
      }
      a.ripple += dtg;
      if (a.ripple > 0.22) {
        a.ripple = 0;
        world.ripples.spawn(p.x, wy + 0.03, p.z, 1.6 + player.speedNow * 0.12, 1.0);
      }
      if (player.surfing) {
        for (let i = 0; i < 2; i++) fx.spray(p.x - Math.sin(player.facing) * 0.6, wy + 0.1, p.z - Math.cos(player.facing) * 0.6, -Math.sin(player.facing) * 3, 2.5, -Math.cos(player.facing) * 3, 1.4);
      }
    }
    if (el === 'tierra' && player.grounded && player.speedNow > 4 && !inWater) {
      a.trail += dtg;
      if (a.trail > 0.16) { a.trail = 0; fx.dustPuff(p.x, p.y, p.z, 0.7); }
    }
    if (el === 'fuego') {
      a.ember += dtg * 9 * lite;
      while (a.ember > 1) { a.ember -= 1; fx.ember(p.x, p.y + 0.6, p.z, 0.8); }
      if (player.dashT > 0) {
        for (let i = 0; i < 6; i++) fx.flame(p.x - Math.sin(player.facing) * 0.4, p.y + 0.9, p.z - Math.cos(player.facing) * 0.4, 1.7, 0.35);
        fx.smokePuff(p.x, p.y + 0.8, p.z, 0.8);
      }
    }
    if (el === 'aire') {
      if (player.glideT > 0 && !player.grounded) {
        for (let i = 0; i < 2; i++) {
          const s = player.facing;
          const side = Math.random() < 0.5 ? 1 : -1;
          fx.mist(p.x + Math.cos(s) * 1.7 * side, p.y + 1.1, p.z - Math.sin(s) * 1.7 * side, 0xeaf6ff, 0.9);
          fx.sparkle(p.x, p.y + 0.3, p.z, 0xdff2ff, 1.2);
        }
      }
      if (Math.random() < dtg * 7 * lite) fx.sparkle(p.x + (Math.random() - 0.5) * 1.6, p.y + 0.5 + Math.random() * 1.6, p.z + (Math.random() - 0.5) * 1.6, 0xdff2ff, 0.5);
    }
    if (el === 'hielo') {
      a.snow += dtg * 12 * lite;
      while (a.snow > 1) { a.snow -= 1; fx.snow(p.x, p.y + 1, p.z); }
      if (player.powerAnim > 0.6) fx.iceShard(p.x, p.y + 1.4, p.z, 0.9);
    }
    if (el === 'agua' && !inWater && Math.random() < dtg * 6 * lite) fx.spray(p.x + (Math.random() - 0.5), p.y + 1.5, p.z + (Math.random() - 0.5), 0, 0.5, 0, 0.8);
    if (player.powerAnim > 0.5) {
      const col = ELEMENTS[el].color;
      fx.spark.emit(p.x + (Math.random() - 0.5), p.y + 1 + Math.random(), p.z + (Math.random() - 0.5), 0, 2, 0, 0.7, 0.35, 0.05, col, 0xffffff, 1, 0, -1, 0.3);
    }
    fx.update(dtg, this.camera, this.renderer.domElement.height);
  }

  /* ---------- HUD ---------- */
  updateHud(real, dSafe) {
    const { player, world } = this;
    ui.setTime(this.missionTime - this.t);
    // barra de vida del héroe (siempre conectada a la vida real) y barras de los NPC / escombros dañados
    const r = this.hpRef;
    if (r) ui.setHeroHp(r.hp, r.max);
    const bars = [];
    for (const t of this.combat.targets()) {
      if (t.heavy && !t.prop) continue; // el jefe tiene su propia barra
      if (t.prop && t.hp >= t.hpMax) continue; // escombros: solo cuando están dañados
      const sp = this.screenOf(t.pos, t.barH || 1.4);
      if (!sp) continue;
      bars.push({ t, x: sp.x, y: sp.y, pct: t.hp / t.hpMax, label: t.prop ? t.label : t.cat.name, prop: !!t.prop, big: t.kind === 'bruto' });
    }
    // compañeros del equipo en el combate de jefe: barra verde con su nombre
    for (const a of this.allies.list) {
      const sp = this.screenOf(a.pos, a.H + 0.4);
      if (sp) bars.push({ t: a, x: sp.x, y: sp.y, pct: a.member.hp / (a.member.max || 100), label: a.def.name, ally: true });
    }
    ui.npcBars(bars);
    // anillo de recarga de la habilidad seleccionada
    const a = this.abilities[this.abIndex];
    let ratio = 0;
    if (a) ratio = a.id === 'power' ? (player.cdMaxEff > 0 ? player.cd / player.cdMaxEff : 0) : (a.cd > 0 ? (this.toolCd[a.id] || 0) / (a.cd * player.cdMul) : 0);
    ui.setPower(ratio, a);
    this.gaugeAcc += real;
    if (this.gaugeAcc > 0.25) {
      this.gaugeAcc = 0;
      const gg = this.boss ? this.boss.gauge() : this.hazards ? this.hazards.gauge() : null;
      if (gg) ui.setGauge(gg);
      else ui.setWater(world.waterY, 8, this.victims);
      ui.setCarry(player.carrying, player.capacity);
      ui.setAbilityCds(
        this.abilities.map((ab, i) => (i === 0 ? (player.cdMaxEff > 0 ? player.cd / player.cdMaxEff : 0) : ab.cd > 0 ? (this.toolCd[ab.id] || 0) / (ab.cd * player.cdMul) : 0)),
        this.abilities.map((ab, i) => (i === 0 ? player.cd : this.toolCd[ab.id] || 0)),
        this.abilities.map((ab) => !!(ab.hs && this.skills.canRecast(ab.key))),
      );
    }
    ui.minimap.draw(real, {
      waterY: world.waterY,
      victims: this.victims.filter((v) => !v.hidden).map((v) => ({ id: v.id, state: v.state, wx: v.wpos.x, wz: v.wpos.z, urgent: v.urgent })),
      px: player.pos.x, pz: player.pos.z, facing: player.facing,
    });
    const items = [];
    const waiting = this.victims.filter((v) => v.state === 'waiting' && !v.hidden);
    waiting.sort((x, y) => x.wpos.distanceToSquared(player.pos) - y.wpos.distanceToSquared(player.pos));
    const n = this.pingT > 0 ? waiting.length : 2;
    for (let i = 0; i < Math.min(n, waiting.length); i++) {
      const v = waiting[i];
      items.push({ id: v.id, x: v.wpos.x, y: v.wpos.y + v.height, z: v.wpos.z, dist: v.wpos.distanceTo(player.pos), urgent: v.urgent });
    }
    if (player.carrying.length) items.push({ id: 'safe', x: CFG.SAFE.x, y: CFG.SAFE.y + 3, z: CFG.SAFE.z, dist: dSafe, safe: true });
    ui.updateEdges(this.camera, items);
    ui.lightning(0);
  }

  /* ---------- final ---------- */
  end(success, reason) {
    if (this.ended) return;
    this.saveHp(true);
    this.ended = true;
    this.success = success;
    this.teamLost = !success && !!this.boss && this.team.on && !this.team.anyAlive; // derrota del equipo ante el jefe
    this.state = 'ending';
    this.endT = 0;
    this.skills.reset();
    ui.bossFight(false);
    this.player.locked = true;
    this.player.celebrate = success;
    this.player.celebrateTimer = 0;
    ui.prompt(null);
    ui.clearEdges();
    ui.tips.el.classList.remove('show');
    audio.success();
    if (success) {
      const bonus = Math.round(Math.max(0, this.missionTime - this.t)) * 2;
      this.score += bonus;
      ui.setScore(this.score);
      ui.banner('good', '🏆 ¡MISIÓN COMPLETADA!', this.delivered >= this.total ? 'Todos están a salvo' : 'Has salvado a casi todos');
      const p = this.player.pos;
      this.fx.confetti(p.x, p.y + 2, p.z);
    } else {
      if (reason) ui.banner('find', '💔 ¡Derrota!', reason);
      else ui.banner('find', '⏱️ ¡Se acabó el tiempo!', this.mission.failTitle);
    }
  }

  finish() {
    this.state = 'done';
    this.input.enabled = false;
    this.input.releaseLock();
    ui.hud(false);
    const total = this.total;
    const d = this.delivered;
    const stars = d >= total ? 3 : d >= Math.ceil(total * 0.7) ? 2 : d >= Math.ceil(total * 0.4) ? 1 : 0;
    const learned = [...ui.tips.shown.values()];
    this.stats.eco += learned.length * 3;
    const res = Save.completeLevel(this.mission, { success: this.success, stars: this.success ? Math.max(1, stars) : stars, score: this.score, people: this.stats.people, animals: this.stats.animals, eco: this.stats.eco });
    Save.setHero(this.hero.id);
    const idx = LEVELS.findIndex((l) => l.id === this.mission.id);
    ui.showResults({
      level: this.mission, success: this.success, rescued: d, total, people: this.stats.people, animals: this.stats.animals,
      score: this.score, eco: this.stats.eco, time: this.t, stars: this.success ? Math.max(1, stars) : stars, learned, heroName: this.hero.name,
      reward: res.newReward ? ITEMS[res.reward] : null, unlockedNext: res.unlockedNext, nextLevel: LEVELS[idx + 1] || null, newBadges: res.newBadges,
      hasNext: this.success && idx < LEVELS.length - 1, teamLost: !!this.teamLost,
    });
    this.player.celebrate = false;
    this.player.model.setVisible(true);
  }
}
