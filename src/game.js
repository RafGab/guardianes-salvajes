import * as THREE from 'three';
import { HEROES, ELEMENTS, getHeroModel } from './heroes.js';
import { createVictim } from './npcs.js';
import { CFG, terrainH } from './city.js';
import { Audio3D as audio } from './audio.js';
import { ui } from './ui.js';
import { clamp, smoothstep, damp, TAU, makeCanvas, texFromCanvas } from './utils.js';
import { MISSIONS, MISSION_TIPS, saveStars } from './missions.js';
import { createHazards } from './hazards.js';
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
  debris: 'Los objetos que flotan en una inundación pueden golpear con fuerza. Mantén la distancia.',
  power: 'Los héroes usan sus poderes con cabeza. En la vida real, deja el rescate a los profesionales y avisa al 112.',
};
const SIGN_TIPS = { sign_start: 'n112', sign_1: 'kit', sign_2: 'environment', sign_3: 'contaminated', sign_4: 'climate', sign_5: 'electric' };

const tmpV = new THREE.Vector3();
const tmpW = new THREE.Vector3();

function markerTexture(color) {
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
  g.fillText('!', 64, 68);
  return texFromCanvas(c);
}

export class Game {
  constructor({ scene, camera, renderer, world, player, chase, fx, input }) {
    Object.assign(this, { scene, camera, renderer, world, player, chase, fx, input });
    this.state = 'idle';
    this.victims = [];
    this.timeScale = 1;
    this.slowT = 0;
    this.markerTex = { warn: markerTexture('#ffb020'), urgent: markerTexture('#ff3030') };
    this.buildSigns();
    world.onThunder = () => {
      audio.thunder();
      this.chase.shake(0.06);
    };
    this.safeSpots = [];
    for (let k = 0; k < 12; k++) {
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
      x.fillText('Pulsa  E', 128, 144);
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.05, 0.08), [
        new THREE.MeshStandardMaterial({ color: 0x0d5a8a }), new THREE.MeshStandardMaterial({ color: 0x0d5a8a }),
        new THREE.MeshStandardMaterial({ color: 0x0d5a8a }), new THREE.MeshStandardMaterial({ color: 0x0d5a8a }),
        new THREE.MeshStandardMaterial({ map: texFromCanvas(c), emissiveMap: texFromCanvas(c), emissive: 0xffffff, emissiveIntensity: 0.55 }),
        new THREE.MeshStandardMaterial({ color: 0x0d5a8a }),
      ]);
      board.position.y = 2.55;
      board.castShadow = true;
      g.add(board);
      this.scene.add(g);
      this.signMeshes.push(g);
    }
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
    ui.setOverlay('heat', 0);
    ui.setOverlay('cold', 0);
    ui.setOverlay('dust', 0);
  }

  makeMarker() {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markerTex.warn, depthTest: false, depthWrite: false, transparent: true }));
    m.renderOrder = 60;
    m.scale.set(1.2, 1.2, 1);
    return m;
  }

  spawnVictims() {
    const slots = this.world.victimSlots;
    slots.forEach((slot, i) => {
      const v = createVictim(slot.kind, 100 + i * 17);
      v.id = i;
      v.slot = slot;
      v.state = 'waiting';
      v.found = false;
      v.urgent = false;
      v.marker = this.makeMarker();
      v.root.add(v.marker);
      v.marker.position.set(0, v.height + 0.75, 0);
      v.markerBase = v.height + 0.75;
      if (slot.body) {
        slot.body.mesh.add(v.root);
        v.root.position.set(slot.body.kind === 'car' ? -0.15 : 0, slot.ly, 0);
        v.parentBody = slot.body;
        v.baseY = slot.ly;
        v.root.rotation.y = 0;
      } else {
        this.scene.add(v.root);
        v.root.position.set(slot.x, slot.y + 0.02, slot.z);
        v.baseY = slot.y + 0.02;
        v.root.rotation.y = Math.PI * 0.5 + i;
      }
      v.wpos = new THREE.Vector3();
      this.victims.push(v);
    });
  }

  worldPosOf(v, out) {
    v.root.getWorldPosition(out);
    return out;
  }

  /* ---------- inicio de misión ---------- */
  start(def, mission = MISSIONS[0]) {
    const { scene, world, player, chase } = this;
    this.hero = def;
    this.mission = mission;
    this.tips = { ...TIPS, ...(MISSION_TIPS[mission.id] || {}) };
    this.missionTime = mission.time;
    this.clearVictims();
    world.reset();
    ui.tips.reset();
    ui.clearEdges();
    this.t = 0;
    this.score = 0;
    this.delivered = 0;
    this.foundCount = 0;
    this.ended = false;
    this.endT = 0;
    this.introT = 0;
    this.timeScale = 1;
    this.slowT = 0;
    this.pingT = 0;
    this.pingCd = 0;
    this.deliverT = 0;
    this.celebrateT = 0;
    this.gaugeAcc = 0;
    this.scheduled = new Set();
    this.surged = false;
    this.warned = false;
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
    this.spawnVictims();
    this.total = this.victims.length;
    if (this.hazards) this.hazards.dispose();
    this.hazards = createHazards(mission.scenario, {
      scene, world, fx: this.fx, player, chase, ui, audio, camera: this.camera, hero: def,
      tip: (id) => this.tip(id),
      addScore: (n) => { this.score += n; ui.setScore(this.score); },
    });
    this.hazards.reset();

    ui.setHero(def);
    ui.setRescued(0, this.total);
    ui.setScore(0);
    ui.setCarry([], player.capacity);
    ui.setTime(this.missionTime);
    ui.setGaugeMode(mission.scenario === 'flood' ? null : mission);
    ui.setPower(0);
    ui.showScreen(null);
    ui.hud(true);
    ui.minimap.init(world);
    chase.yaw = 0;
    chase.pitch = 0.3;
    chase.distTarget = 6.6;
    chase.dist = 6.6;
    chase.snap(player.pos, 0);
    this.state = 'intro';
    this.input.enabled = true;
    const ambience = { flood: [0.5, 0.4], fire: [0.03, 0.55], quake: [0.02, 0.3], ice: [0.25, 1.0] }[mission.scenario];
    audio.setIntensity(ambience[0], ambience[1]);
    ui.banner('find', mission.intro, `Rescata a ${this.total} personas y animales · ${mission.introSub}`);
  }

  /* ---------- eventos del jugador ---------- */
  handlePlayerEvents() {
    const { player, fx, world } = this;
    for (const ev of player.events) {
      const p = player.pos;
      switch (ev.type) {
        case 'jump':
          audio.tone(300, 0.12, 'triangle', 0.08, 200);
          if (ev.water) {
            fx.splash(p.x, world.waterY, p.z, 10, 0.8);
            audio.splash();
          }
          break;
        case 'land':
          if (ev.water) {
            fx.splash(p.x, world.waterY, p.z, 16, Math.min(1.6, ev.speed / 10));
            world.ripples.spawn(p.x, world.waterY + 0.03, p.z, 2.2, 1.1);
            audio.splash();
          } else {
            for (let i = 0; i < 5; i++) fx.dustPuff(p.x, p.y, p.z, 0.8);
          }
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
          if (!this.shownMoves.has('debris')) {
            this.shownMoves.add('debris');
            this.tip('debris');
          }
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
  nearestRescuable() {
    const { player } = this;
    let best = null, bd = 1e9;
    for (const v of this.victims) {
      if (v.state !== 'waiting') continue;
      const d = Math.hypot(v.wpos.x - player.pos.x, v.wpos.z - player.pos.z);
      const dy = Math.abs(v.wpos.y + v.height * 0.5 - (player.pos.y + 0.9));
      if (d < bd && dy < 2.6) {
        bd = d;
        best = v;
      }
    }
    return { v: best, d: bd };
  }

  tryRescue() {
    const { player } = this;
    if (this.state !== 'playing' || player.rescueT > 0 || player.locked) return;
    const { v, d } = this.nearestRescuable();
    if (!v || d > 3.4) {
      ui.banner('find', '🔎', 'Acércate a alguien que necesite ayuda');
      return;
    }
    if (player.carrying.length >= player.capacity) {
      ui.banner('find', '🎒', `Ya llevas a ${player.capacity}. ¡Llévalos al refugio primero!`);
      return;
    }
    // el héroe mira al rescatable
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
        v.root.position.set(0, -0.1, 0);
        v.root.rotation.set(0, 0.5, 0);
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
    if (this.delivered >= this.total) this.end(true);
  }

  /* ---------- consejos ---------- */
  tip(id) {
    if (this.tips[id]) ui.tips.push(id, this.tips[id]);
  }

  interact() {
    const { player } = this;
    if (this.state !== 'playing' || player.locked) return;
    let best = null, bd = 1e9;
    for (const s of this.world.signs) {
      const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z);
      if (d < bd && Math.abs(s.y - player.pos.y) < 4) { bd = d; best = s; }
    }
    if (best && bd < 3.6) {
      const id = SIGN_TIPS[best.tip];
      ui.tips.showNow('sign:' + best.tip, this.tips[id] || TIPS[id]);
      audio.tip();
      if (!best.used) {
        best.used = true;
        this.score += 20;
        ui.setScore(this.score);
        ui.banner('find', '📖 +20', 'Consejo leído');
      }
      return;
    }
    // sin cartel cerca: llamada de ayuda (sonar de rescate)
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
    const { world, player, chase, fx, input, camera } = this;
    const real = dt;
    // cámara lenta suave
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

    // entrada
    const move = input.getMove();
    const look = input.getLook(real);
    if (!IS_TOUCH && !input.locked && !introLocked && Math.abs(move.x) > 0.1 && Math.abs(look.dx) < 0.001) look.dx += move.x * 1.0 * real;

    const wasCele = player.celebrate;
    if (player.celebrateTimer > 0) {
      player.celebrateTimer -= real;
      if (player.celebrateTimer <= 0 && this.state !== 'ending') player.celebrate = false;
    }
    if (this.state === 'ending') move.x = move.y = 0;

    player.update(dtg, move, chase.yaw);
    this.handlePlayerEvents();
    if (this.hazards && (this.state === 'playing' || this.state === 'ending')) this.hazards.update(dtg, this.t);
    world.update(dtg, performance.now() / 1000, camera.position, player.pos, missionT, true);
    const p = player.pos;

    // víctimas
    for (const v of this.victims) {
      v.update(dtg);
      v.root.getWorldPosition(v.wpos);
      if (v.state === 'waiting') {
        if (!v.parentBody) {
          const want = Math.max(v.baseY, world.waterY - v.height * 0.45);
          v.root.position.y = damp(v.root.position.y, want, 4, dtg);
        }
        v.platformY = v.parentBody ? v.parentBody.y + v.baseY : v.baseY;
        const margin = world.hasWater ? (v.parentBody ? 9 : v.platformY - world.waterY) : 99;
        v.urgent = margin < 0.9 || (this.hazards ? this.hazards.urgentAt(v.wpos) : false);
        v.marker.material.map = v.urgent ? this.markerTex.urgent : this.markerTex.warn;
        const d = Math.hypot(camera.position.x - v.wpos.x, camera.position.y - v.wpos.y, camera.position.z - v.wpos.z);
        const pulse = 1 + 0.12 * Math.sin(performance.now() / (v.urgent ? 110 : 250) + v.id);
        const k = clamp(d * 0.05, 1.0, 6.5) * pulse * (this.pingT > 0 ? 1.5 : 1);
        v.marker.scale.set(k, k, 1);
        v.marker.position.y = v.markerBase + k * 0.25;
        v.setMode('wave');
        // hallazgo
        if (!v.found && Math.hypot(p.x - v.wpos.x, p.z - v.wpos.z) < 20 && Math.abs(p.y - v.wpos.y) < 12) {
          v.found = true;
          this.foundCount++;
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

    // entrega en el refugio
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

    // prompts
    this.updatePrompt(inSafe);

    // eventos de misión
    this.missionEvents(real);

    // consejos por contexto
    if (this.state === 'playing') this.contextTips();
    ui.tips.update(real);

    // FX
    this.updateFX(dtg, real);

    // cámara
    let follow = p;
    if (this.state === 'ending') {
      chase.yaw += real * 0.45;
      chase.pitch = damp(chase.pitch, 0.22, 3, real);
      chase.distTarget = 4.6;
      chase.update(real, follow, null);
    } else {
      chase.update(real, follow, introLocked ? null : look);
    }
    if (introLocked) this.introCamera();
    if (input.wheel) input.wheel = 0;

    // HUD
    this.updateHud(real, dSafe);

    // fin por tiempo
    if (this.state === 'playing' && this.t >= this.missionTime && !this.ended) this.end(false);
    if (this.state === 'ending') {
      this.endT += real;
      if (this.endT > 3.4) this.finish();
    }
  }

  introCamera() {
    const k = clamp(this.introT / 3.2, 0, 1);
    const e = k * k * (3 - 2 * k);
    const cam = this.camera;
    const s = new THREE.Vector3(38, 56, 74);
    const sl = new THREE.Vector3(0, 8, -60);
    const pos = s.lerp(this.chase.pos.clone(), e);
    const look = sl.lerp(this.chase.look.clone(), e);
    cam.position.copy(pos);
    cam.lookAt(look);
  }

  updatePrompt(inSafe) {
    const { player } = this;
    if (this.state !== 'playing') return ui.prompt(null);
    const { v, d } = this.nearestRescuable();
    if (v && d < 3.4) {
      if (player.carrying.length >= player.capacity) ui.prompt('🎒 Vas al completo · ¡Llévalos al refugio!');
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

  missionEvents(real) {
    const t = this.t;
    const at = (s, fn) => {
      if (t >= s && !this.scheduled.has(s)) {
        this.scheduled.add(s);
        fn();
      }
    };
    if (this.state !== 'playing') return;
    at(this.missionTime - 60, () => ui.alert('⏱️ ¡Queda 1 minuto!', 3500));
    at(this.missionTime - 20, () => {
      ui.alert('⏱️ ¡20 segundos!', 3000);
      audio.alert();
    });
    if (this.mission.scenario !== 'flood') {
      const sched = {
        fire: [[35, 'smoke'], [130, 'never'], [180, 'wildlife'], [230, 'forest']],
        quake: [[45, 'elevator'], [120, 'gas'], [180, 'rubble'], [255, 'aftershock']],
        ice: [[30, 'animals'], [90, 'co'], [150, 'visibility'], [220, 'climate']],
      }[this.mission.scenario] || [];
      for (const [tt, id] of sched) at(tt, () => this.tip(id));
      if (this.mission.scenario !== 'quake') at(1, () => this.tip('start'));
      return;
    }
    at(60, () => {
      ui.alert('🌧️ La lluvia se intensifica', 3500);
      this.world.stormIntensity = 0.9;
      audio.setIntensity(0.9, 0.7);
    });
    at(CFG.SURGE_T - 2, () => {
      ui.alert('⚠️ ¡ALERTA! CRECIDA REPENTINA · ¡Sube a un lugar alto!', 6000);
      audio.alert();
      this.chase.shake(0.35);
      audio.rumble();
      this.world.triggerLightning();
      this.tip('surge');
    });
    at(CFG.SURGE_T + 2, () => this.chase.shake(0.3));
    at(40, () => this.tip('cars'));
    at(85, () => this.tip('contaminated'));
    at(150, () => this.tip('lightning'));
    at(195, () => this.tip('environment'));
    at(240, () => this.tip('kit'));
  }

  contextTips() {
    const { player } = this;
    if (this.mission.scenario !== 'flood') return;
    if (player.swimming && !this.shownMoves.has('deep')) {
      this.shownMoves.add('deep');
      this.tip('deep');
    }
    if (!this.shownMoves.has('current') && player.depth > 0.4 && (Math.abs(player.flow.x) + Math.abs(player.flow.z)) > 0.4) {
      this.shownMoves.add('current');
      this.tip('current');
    }
  }

  /* ---------- efectos ---------- */
  updateFX(dtg, real) {
    const { player, fx, world } = this;
    const p = player.pos;
    const a = this.fxAcc;
    const el = this.hero.element;
    const wy = world.waterY;

    // ondas de lluvia sobre el agua alrededor del jugador
    a.rain += dtg * 22;
    while (a.rain > 1) {
      a.rain -= 1;
      const ang = Math.random() * TAU, rr = 2 + Math.random() * 16;
      const x = p.x + Math.cos(ang) * rr, z = p.z + Math.sin(ang) * rr;
      if (wy > terrainH(x, z) + 0.05) world.ripples.spawn(x, wy + 0.03, z, 0.5 + Math.random() * 0.5, 0.7);
    }
    // chapoteo al moverse en el agua
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
    // pasos con polvo (Tierra)
    if (el === 'tierra' && player.grounded && player.speedNow > 4 && !inWater) {
      a.trail += dtg;
      if (a.trail > 0.16) { a.trail = 0; fx.dustPuff(p.x, p.y, p.z, 0.7); }
    }
    // héroes de fuego: brasas y estela
    if (el === 'fuego') {
      a.ember += dtg * 9;
      while (a.ember > 1) {
        a.ember -= 1;
        fx.ember(p.x, p.y + 0.6, p.z, 0.8);
      }
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
      if (Math.random() < dtg * 7) fx.sparkle(p.x + (Math.random() - 0.5) * 1.6, p.y + 0.5 + Math.random() * 1.6, p.z + (Math.random() - 0.5) * 1.6, 0xdff2ff, 0.5);
    }
    if (el === 'hielo') {
      a.snow += dtg * 12;
      while (a.snow > 1) {
        a.snow -= 1;
        fx.snow(p.x, p.y + 1, p.z);
      }
      if (player.powerAnim > 0.6) fx.iceShard(p.x, p.y + 1.4, p.z, 0.9);
    }
    if (el === 'agua' && !inWater && Math.random() < dtg * 6) fx.spray(p.x + (Math.random() - 0.5), p.y + 1.5, p.z + (Math.random() - 0.5), 0, 0.5, 0, 0.8);
    if (player.powerAnim > 0.5) {
      const col = ELEMENTS[el].color;
      fx.spark.emit(p.x + (Math.random() - 0.5), p.y + 1 + Math.random(), p.z + (Math.random() - 0.5), 0, 2, 0, 0.7, 0.35, 0.05, col, 0xffffff, 1, 0, -1, 0.3);
    }
    // pilar de roca: partículas mientras crece
    // humo del refugio (chimenea imaginaria) y chispas del mundo — omitidos por coste
    fx.update(dtg, this.camera, this.renderer.domElement.height);
  }

  /* ---------- HUD ---------- */
  updateHud(real, dSafe) {
    const { player, world } = this;
    ui.setTime(this.missionTime - this.t);
    ui.setPower(player.cdMax > 0 ? player.cd / player.cdMax : 0);
    this.gaugeAcc += real;
    if (this.gaugeAcc > 0.25) {
      this.gaugeAcc = 0;
      const gg = this.hazards ? this.hazards.gauge() : null;
      if (gg) ui.setGauge(gg);
      else ui.setWater(world.waterY, 8, this.victims);
      ui.setCarry(player.carrying, player.capacity);
    }
    ui.minimap.draw(real, {
      waterY: world.waterY,
      victims: this.victims.map((v) => ({ id: v.id, state: v.state, wx: v.wpos.x, wz: v.wpos.z, urgent: v.urgent })),
      px: player.pos.x, pz: player.pos.z, facing: player.facing,
    });
    // marcadores en el borde de la pantalla
    const items = [];
    const waiting = this.victims.filter((v) => v.state === 'waiting');
    waiting.sort((a, b) => a.wpos.distanceToSquared(player.pos) - b.wpos.distanceToSquared(player.pos));
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
      ui.banner('good', '🏆 ¡MISIÓN CUMPLIDA!', 'Todos están a salvo');
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
    saveStars(this.mission.id, stars);
    const idx = MISSIONS.findIndex((m) => m.id === this.mission.id);
    ui.showEnd({
      success: this.success, rescued: d, total, score: this.score, time: this.t, stars,
      learned: [...ui.tips.shown.values()], heroName: this.hero.name,
      mission: this.mission, hasNext: idx >= 0 && idx < MISSIONS.length - 1 && stars >= 1,
    });
    this.player.celebrate = false;
    this.player.model.setVisible(true);
  }
}
