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
import { IS_TOUCH } from './platform.js';
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
const AMBIENCE = { flood: [0.5, 0.4], fire: [0.03, 0.55], quake: [0.02, 0.3], volcano: [0.06, 0.6], hurricane: [0.95, 1.0], sandstorm: [0.04, 1.0], ice: [0.25, 1.0], drought: [0.02, 0.35], extreme: [0.7, 0.9] };
const SCHED = {
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
    this.combat = new Combat(this);
    this.skills = new HeroSkills(this);
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
    this.abilities = [{ id: 'power', icon: base.icon, name: base.name, cd: this.hero.power.cd }];
    this.abilities.push(...this.skills.entries(this.hero.id)); // habilidad propia del héroe (y especial, si la tiene)
    for (const id of Save.items) {
      const it = ITEMS[id];
      if (it && !it.passive) this.abilities.push({ id: it.id, icon: it.icon, name: it.name, cd: it.cd });
    }
    this.abIndex = 0;
    this.toolCd = {};
    ui.setAbilities(this.abilities, this.abIndex, (i) => this.selectAbility(i));
  }
  selectAbility(i) {
    if (i < 0 || i >= this.abilities.length) return;
    this.abIndex = i;
    ui.selectAbilityUI(i);
    audio.click();
  }
  cycleAbility(dir = 1) {
    if (this.abilities.length < 2) return;
    this.selectAbility((this.abIndex + dir + this.abilities.length) % this.abilities.length);
  }
  useAbility() {
    if (this.state !== 'playing' || this.player.locked || this.player.scripted) return false;
    const a = this.abilities[this.abIndex];
    if (!a) return false;
    if (a.id === 'power') {
      const p = this.player;
      const nEv = p.events.length;
      let used = p.usePower(this.fx);
      // Los poderes de agua/hielo solo funcionan sobre agua; en un combate de jefe no pueden dejar al héroe sin ataque.
      if (!used && this.boss && p.cd <= 0) {
        p.events.length = nEv; // descarta el aviso "este poder funciona sobre el agua"
        used = this.bossStrike();
      }
      if (used && this.boss) this.boss.onPlayerAttack(p.pos);
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
  onObstacleBroken(o) {
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
    this.vfx.clear();
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

    if (this.hazards) this.hazards.dispose();
    this.hazards = createHazards(level.scenario, {
      scene, world, sc: world.sc, level, hz: level.hz, fx: this.fx, player, chase, ui, audio, camera: this.camera, hero: def, game: this,
      tip: (id) => this.tip(id),
      addScore: (n) => this.addScore(n),
      addEco: (n) => this.addEco(n),
    });
    this.hazards.reset();
    this.buildAbilities();

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
          this.onPower(ev.power);
          if (this.hazards) this.hazards.onPower(ev.power, player.pos, this.hero);
          break;
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
    player.facing = Math.atan2(v.wpos.x - player.pos.x, v.wpos.z - player.pos.z);
    player.startRescue(v);
  }

  pickup(v) {
    const { player, fx } = this;
    if (!v || v.state !== 'waiting') return;
    v.state = 'carried';
    v.setMode('carried');
    v.marker.visible = false;
    player.carrying.push(v);
    this.reanchor();
    audio.pick();
    const p = v.wpos;
    for (let i = 0; i < 16; i++) fx.sparkle(p.x, p.y + 0.8, p.z, 0xffe070, 2.5);
    this.chase.fovKick = -4;
    ui.setCarry(player.carrying, player.capacity);
    ui.banner('good', '🐾 ¡Te sigo!', `${v.info.label} a salvo contigo. ¡Al refugio!`);
    if (v.kind === 'nino') this.tip('kid');
    if (v.kind === 'anciano') this.tip('elder');
    if (v.info.animal) this.tip('pets');
    this.score += 10;
  }

  reanchor() {
    const { player } = this;
    player.carrying.forEach((v, i) => {
      const anchor = player.model.anchorFor(i);
      anchor.attach(v.root);
      v.root.scale.set(1, 1, 1);
      const h = v.height;
      if (i === 0) {
        v.root.position.set(v.info.animal ? 0 : h * 0.5, v.info.animal ? -0.1 : 0.02, 0);
        v.root.rotation.set(0, 0, v.info.animal ? 0 : Math.PI / 2);
      } else if (i === 1) {
        v.root.position.set(0, -0.35, -0.12);
        v.root.rotation.set(0, 0, 0);
      } else {
        v.root.position.set(0, -0.1 - (i - 2) * 0.15, 0);
        v.root.rotation.set(0, 0.5 * i, 0);
      }
    });
  }

  deliverOne() {
    const { player, fx, scene } = this;
    const v = player.carrying.shift();
    if (!v) return;
    scene.attach(v.root);
    v.root.scale.set(1, 1, 1);
    v.root.rotation.set(0, 0, 0);
    const spot = this.safeSpots[this.delivered % this.safeSpots.length];
    v.walkTo = spot;
    v.state = 'delivered';
    v.setMode('walk');
    v.marker.visible = false;
    v.root.position.y = CFG.SAFE.y + 0.02;
    this.delivered++;
    if (v.info.animal) { this.stats.animals++; this.stats.eco += 10; } else { this.stats.people++; this.stats.eco += 5; }
    const urgentBonus = v.urgent ? 50 : 0;
    this.score += 100 + urgentBonus;
    ui.setRescued(this.delivered, this.total);
    ui.setScore(this.score);
    ui.setCarry(player.carrying, player.capacity);
    this.reanchor();
    ui.banner('good', '❤️ ¡Rescate completado!', `${v.info.label} está a salvo${urgentBonus ? ' · ¡bonus por urgencia!' : ''}`);
    audio.success();
    const p = player.pos;
    fx.confetti(p.x, p.y + 1.6, p.z);
    this.slowT = 0.5;
    this.chase.shake(0.06);
    player.celebrateTimer = 1.4;
    player.celebrate = true;
    if (this.delivered >= this.total) {
      if (this.mission.boss && !this.bossDone) this.startBoss();
      else this.end(true);
    }
  }

  /* ---------- combate contra el jefe de nivel ---------- */
  startBoss() {
    const { scene, world, player, chase, camera } = this;
    const arena = world.sc.bossArena || { x: CFG.SAFE.x, z: CFG.SAFE.z - 18, r: 16 };
    player.pos.set(arena.x, terrainH(arena.x, arena.z + arena.r * 0.7) + 0.5, arena.z + arena.r * 0.7);
    player.vx = 0; player.vz = 0; player.vy = 0;
    player.facing = Math.PI;
    this.boss = createBoss(this.mission.boss, { scene, world, player, chase, camera, fx: this.fx, audio, ui, game: this }, arena);
    if (this.mission.ally) this.ally = createAlly(this.mission.ally, { scene, world, player, chase, camera, fx: this.fx, audio, ui, game: this });
    // cámara del combate: más lejos según el tamaño del jefe, sin perder de vista al héroe
    const bc = bossCameraFor(player.H, bossScale(this.mission.boss).height);
    chase.distTarget = bc.dist;
    chase.aim = bc.aim;
    ui.setGaugeMode(this.mission);
  }
  hitPlayer(dmg, fromPos) {
    if (this.playerHitT > 0) return;
    if (this.player.shieldT > 0 || this.player.evadeT > 0) return; // el escudo y la esquiva lunar anulan el golpe
    this.playerHitT = 0.9;
    this.score = Math.max(0, this.score - 10);
    ui.setScore(this.score);
    this.chase.shake(0.22);
    this.slowT = Math.max(this.slowT, 0.35);
    ui.setOverlay('heat', 1);
    setTimeout(() => ui.setOverlay('heat', 0), 220);
    audio.noiseBurst(0.3, 180, 0.4, 'lowpass');
    ui.banner('find', '💥 ¡Golpe recibido!', 'Aléjate y busca el momento para contraatacar');
  }
  finishBoss() {
    this.bossDone = true;
    this.addScore(300);
    ui.banner('good', `🏆 ¡${this.boss.name} derrotado!`, '+300 puntos de bonus');
    if (this.boss) this.boss.dispose();
    this.boss = null;
    if (this.ally) this.ally.dispose();
    this.ally = null;
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

  /* ---------- actualización ---------- */
  update(dt) {
    if (this.state === 'idle' || this.state === 'done') return;
    const { world, player, chase, input, camera } = this;
    const real = dt;
    this.slowT = Math.max(0, this.slowT - real);
    const targetScale = this.slowT > 0 ? 0.45 : this.state === 'ending' ? 0.55 : 1;
    this.timeScale = damp(this.timeScale, targetScale, 10, real);
    const dtg = dt * this.timeScale;

    const introLocked = this.state === 'intro';
    if (introLocked) {
      this.introT += real;
      if (this.introT > 3.2) {
        this.state = 'playing';
        player.locked = false;
        this.tip('start');
      }
    }
    if (this.state === 'playing' && !this.ended) this.t += dtg;
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
    this.handlePlayerEvents();
    if (this.hazards && (this.state === 'playing' || this.state === 'ending')) this.hazards.update(dtg, this.t);
    if (this.playerHitT > 0) this.playerHitT = Math.max(0, this.playerHitT - real);
    if (this.boss && this.state === 'playing') {
      this.boss.update(dtg);
      if (this.boss.state === 'dead' && this.boss.deathT > 1.1 && !this.bossDone) this.finishBoss();
    }
    if (this.ally && this.state === 'playing') this.ally.update(dtg);
    this.combat.update(dtg);
    this.vfx.update(dtg);
    world.update(dtg, performance.now() / 1000, camera.position, player.pos, missionT, true);
    const p = player.pos;

    // visuales de escudo, linterna y gafas
    this.updateToolVisuals(real);

    // víctimas
    for (const v of this.victims) {
      v.update(dtg);
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
          v.root.position.y = damp(v.root.position.y, want, 4, dtg);
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
        const dx = v.walkTo[0] - v.wpos.x, dz = v.walkTo[1] - v.wpos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.3) {
          const sp = 2.0 * dtg;
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
      ui.setAbilityCds(this.abilities.map((ab, i) => (i === 0 ? (player.cdMaxEff > 0 ? player.cd / player.cdMaxEff : 0) : ab.cd > 0 ? (this.toolCd[ab.id] || 0) / (ab.cd * player.cdMul) : 0)));
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
  end(success) {
    if (this.ended) return;
    this.ended = true;
    this.success = success;
    this.state = 'ending';
    this.endT = 0;
    this.skills.reset();
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
      ui.banner('find', '⏱️ ¡Se acabó el tiempo!', this.mission.failTitle);
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
      hasNext: this.success && idx < LEVELS.length - 1,
    });
    this.player.celebrate = false;
    this.player.model.setVisible(true);
  }
}
