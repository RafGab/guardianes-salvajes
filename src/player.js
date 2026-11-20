import * as THREE from 'three';
import { clamp, damp, dampAngle, smoothstep, TAU } from './utils.js';
import { CFG, terrainH } from './city.js';
import { HERO_SCALE, cameraFor } from './scale.js';

// Radio y altura del colisionador: por héroe, desde la escala maestra (scale.js). Valores por defecto:
const R_DEF = 0.42;
const H_DEF = 1.8;
const G = 24;
const STEP = 0.5;
const MANTLE = 2.8;

export class Player {
  constructor(world) {
    this.world = world;
    this.R = R_DEF;
    this.H = H_DEF;
    this.pos = new THREE.Vector3();
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.facing = 0;
    this.grounded = false;
    this.support = null;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.swimming = false;
    this.wading = false;
    this.depth = 0;
    this.surfT = 0;
    this.dashT = 0;
    this.glideT = 0;
    this.gliding = false;
    this.cd = 0;
    this.cdMax = 1;
    this.powerAnim = 0;
    this.mantleCd = 0;
    this.mantling = 0;
    this.carrying = [];
    this.rescueT = 0;
    this.rescueTarget = null;
    this.celebrate = false;
    this.hero = null;
    this.model = null;
    this.stats = null;
    this.events = [];
    this.speedNow = 0;
    this.locked = false;
    this.onSolid = false;
    this.lastLand = 0;
    this.flow = new THREE.Vector3();
    this.tmp = [];
    this.push = { x: 0, z: 0 };
    this.dirX = 0;
    this.dirZ = 0;
    this.sprint = false;
    this.wallDir = { x: 0, z: 0 };
    this.env = { slip: 1, wind: { x: 0, z: 0 }, speedMul: 1 };
    this.boostT = 0;
    this.grip = false;
    this.scripted = false;
    this.climbT = 0;
    this.shieldT = 0;
    this.torchT = 0;
    this.swingT = 0;
    this.petrifyT = 0; this.petrifyFade = 1; // petrificado (Basilisco, Medusa)
    this.slowT = 0; this.slowF = 1;           // ralentizado (hielo de Cerbero y Fenrir...)
    this.speedBuff = 1;                       // bonus de velocidad (Penumbra del Lince)
    this.driftX = 0; this.driftZ = 0;         // tirón externo por fotograma (remolino del Kraken, vientos del Dragón Long)
    this.evadeT = 0;                          // intocable (esfera de Penumbra del Lince): ignora los golpes
    this.pose = { rx: 0, rz: 0, sy: 1, dy: 0, spin: 0, hidden: false, sc: 1 }; // pose extra de las habilidades (skills/hero.js)
    this.animMul = 1; // ritmo del ciclo de pasos (el gigante da zancadas largas y lentas)
    this._wasHidden = false;
    this.capBonus = 0;
    this.cdMul = 1;
    // VUELO (Águila: vuelo libre · Fénec: vuelo de orejas). Lo activa/termina skills/hero.js.
    // { kind, t, max, speed, climb, sink, ceil, lean, minT, ending }
    this.fly = null;
    this.moveMul = 1; // velocidad extra de una transformación (bola de roca del Jaglion)
    // BOTÓN DE VELOCIDAD: aceleración progresiva (boostT = segundos, boostMax = multiplicador final, boostRamp = s hasta alcanzarlo)
    this.boostMax = 1.5; this.boostRamp = 0.01; this.boostAge = 0; this.boostDur = 1;
    this.airJumps = 0; // doble salto (el águila despega a volar)
    this.powerBuffT = 0;  // botón PODER: segundos de poder aumentado
    this.shieldOwnT = 0;  // el escudo lo dibuja la propia habilidad (no la burbuja genérica)
    this.casting = 0;     // habilidades lanzándose ahora (no bloquean el movimiento)
  }

  setHero(def, model) {
    this.hero = def;
    this.model = model;
    this.stats = def.stats;
    this.cdMax = def.power.cd;
    const S = HERO_SCALE[def.id];
    this.R = S ? S.radius : R_DEF; // colisionador a la medida del héroe (velocidad y poder no cambian)
    this.H = S ? S.height : H_DEF;
    this.cam = cameraFor(this.H);
  }

  reset(x, z) {
    this.pos.set(x, terrainH(x, z) + 0.05, z);
    this.vx = this.vz = this.vy = 0;
    this.facing = Math.PI;
    this.grounded = false;
    this.support = null;
    this.swimming = false;
    this.surfT = 0;
    this.dashT = 0;
    this.glideT = 0;
    this.gliding = false;
    this.cd = 0;
    this.carrying = [];
    this.rescueT = 0;
    this.rescueTarget = null;
    this.celebrate = false;
    this.mantling = 0;
    this.powerAnim = 0;
    this.boostT = 0;
    this.grip = false;
    this.scripted = false;
    this.climbT = 0;
    this.shieldT = 0;
    this.torchT = 0;
    this.swingT = 0;
    this.petrifyT = 0; this.slowT = 0; this.slowF = 1; this.speedBuff = 1; this.evadeT = 0;
    this.driftX = this.driftZ = 0;
    this.env = { slip: 1, wind: { x: 0, z: 0 }, speedMul: 1 };
    this.fly = null;
    this.moveMul = 1;
    this.boostMax = 1.5; this.boostRamp = 0.01; this.boostAge = 0;
    this.powerBuffT = 0; this.shieldOwnT = 0; this.casting = 0;
  }

  // Superpone la pose de una habilidad (inclinación, aplastamiento, giro, desaparición) sobre la animación del modelo
  applyPose() {
    const m = this.model;
    if (!m) return;
    const k = this.pose;
    m.root.rotation.order = 'YXZ';
    m.root.rotation.y = this.facing + k.spin;
    // POSTURA AL LANZAR PODERES: inclinar el cuerpo entero hacia atrás desde los pies lo dejaba "de talones", como un
    // maniquí que se cae. Ahora los pies siguen apoyados: el cuerpo apenas se inclina y el resto lo dobla la espalda
    // (columna y hombros), que es como se echa atrás una persona sin perder el equilibrio.
    let rx = k.rx, bend = 0;
    if (rx < -0.08 && !this.fly && this.grounded !== false) { const keep = -0.08 + (rx + 0.08) * 0.2; bend = rx - keep; rx = keep; }
    m.root.rotation.x = rx;
    m.root.rotation.z = k.rz;
    if (bend && m.bones && m.boneTools) {
      const sp = m.bones.spine || m.bones.spine_1, ch = m.bones.spine_2 || m.bones.chest, nk = m.bones.neck;
      m.root.updateMatrixWorld(true);
      if (sp) m.boneTools.rot(sp, 1, 0, 0, bend * (ch ? 0.5 : 0.8));
      if (ch) m.boneTools.rot(ch, 1, 0, 0, bend * 0.35);
      if (nk) m.boneTools.rot(nk, 1, 0, 0, bend * 0.15);
    }
    m.root.position.y += k.dy;
    const xz = 1 / Math.sqrt(Math.max(0.2, k.sy)); // conserva el volumen al aplastar o estirar
    let sy = k.sy;
    // APLASTADO: se achata de golpe y recupera su forma con un pequeño rebote
    if (this.crushT > 0) { const u = 1 - this.crushT / 0.75; sy *= u < 0.15 ? 1 - 0.55 * (u / 0.15) : 0.45 + 0.55 * (1 - Math.pow(1 - (u - 0.15) / 0.85, 3)) + 0.08 * Math.sin(((u - 0.15) / 0.85) * Math.PI); }
    const sc = k.sc || 1; // tamaño (crece desde los pies: no se hunde ni flota)
    const xz2 = sy !== k.sy ? 1 / Math.sqrt(Math.max(0.2, sy)) : xz;
    m.root.scale.set(xz2 * sc, sy * sc, xz2 * sc);
    // OCULTAR AL HÉROE (roca, hidroteletransporte…): se ocultan sus mallas pero NO su luz. Si se ocultara la raíz
    // entera, su luz desaparecería, cambiaría el número de luces de la escena y la tarjeta gráfica tendría que
    // recompilar los sombreadores de todo el escenario → un tirón de 0,1–0,3 s justo al desaparecer y al volver.
    if (!!k.hidden !== !!this._wasHidden || (k.hidden && this._hidRoot !== m.root)) {
      if (this._hidList) for (const o of this._hidList) o.visible = true;
      this._hidList = null; this._hidRoot = null;
      if (k.hidden) {
        this._hidList = []; this._hidRoot = m.root;
        m.root.traverse((o) => { if (o !== m.root && !o.isLight && o.visible && (o.isMesh || o.isSprite || o.isLine || o.isPoints)) { o.visible = false; this._hidList.push(o); } });
      }
      if (!m.root.visible && !k.hidden) m.root.visible = true;
      this._wasHidden = !!k.hidden;
    }
  }

  get capacity() {
    return (this.stats ? this.stats.carry : 2) + this.capBonus;
  }

  // Arranca el botón de velocidad: dura `t` s y acelera hasta `max` × en `ramp` s
  speedBoost(t, max, ramp) { this.boostT = t; this.boostDur = t; this.boostMax = max; this.boostRamp = ramp; this.boostAge = 0; }
  // multiplicador de velocidad actual del botón de velocidad (sube progresivamente y se suaviza al acabar)
  get boostK() {
    if (this.boostT <= 0) return 0;
    const k = Math.min(1, this.boostT / 0.9); // al terminar vuelve GRADUALMENTE a la velocidad normal
    return Math.min(1, this.boostAge / Math.max(0.01, this.boostRamp)) * k * k * (3 - 2 * k);
  }

  get cdMaxEff() {
    return this.cdMax * this.cdMul;
  }

  /* ------------------------ poderes ------------------------ */
  usePower(fx) {
    if (this.cd > 0 || this.locked || this.rescueT > 0 || this.fly) return false;
    const type = this.hero.power.type;
    const w = this.world;
    const depthHere = w.waterY - terrainH(this.pos.x, this.pos.z);
    const dx = this.dirX || Math.sin(this.facing);
    const dz = this.dirZ || Math.cos(this.facing);
    const len = Math.hypot(dx, dz) || 1;
    const moving = Math.hypot(this.dirX, this.dirZ) > 0.1;
    const hid = this.hero.id;
    // Kyra (zorra) en el mundo de nieve (Glacier): su poder de velocidad dura el DOBLE (misma velocidad y efectos)
    const iceX2 = hid === 'kyra' && type === 'ice' && w.sc && w.sc.id === 'ice';
    const sdur = iceX2 ? 10 : 5;
    if (type === 'dash' && hid === 'kairo') {
      // Kairo: CARRERA SUPERSÓNICA durante 5 s (aceleración explosiva hasta ×2 de su velocidad), con dos cometas de
      // energía bajo los pies; sin impulso de cohete hacia delante ni salto
      this.speedBoost(5, 2, 0.45);
    } else if (type === 'dash') {
      // Jago: embestida pesada
      this.speedBoost(5, 1.55, 0.6);
      this.dashT = 0.36;
      this.vx = (dx / len) * 20;
      this.vz = (dz / len) * 20;
      this.vy = Math.max(this.vy, 8.5);
      this.grounded = false;
      this.support = null;
      this.facing = Math.atan2(dx, dz);
    } else if (type === 'glide') {
      this.vy = 13.5;
      this.glideT = 5.5;
      this.grounded = false;
      this.support = null;
    } else if (type === 'rocket') {
      // Ámbar: arranque explosivo con propulsores de aire en los pies
      this.speedBoost(5, 2.2, 0.7);
      this.vx += (dx / len) * 6; this.vz += (dz / len) * 6;
      this.facing = Math.atan2(dx, dz);
    } else if (type === 'pillar') {
      if (moving) this.speedBoost(5, 1.6, 0.8); // corriendo: túnel de tierra
      else { w.spawnPillar(this.pos.x, this.pos.z, this.pos.y); this.vy = Math.max(this.vy, 0); } // quieta: pilar de tierra (como siempre)
    } else if ((type === 'ice' || type === 'surf') && (!w.hasWater || (w.sc && w.sc.id === 'campfire'))) { // en Camp Fire: impulso de velocidad, como en los escenarios sin agua
      this.speedBoost(type === 'ice' ? sdur : 5, hid === 'halley' ? 1.7 : hid === 'nilo' ? 1.6 : 1.65, 0.8);
      this.grip = type === 'ice';
    } else if (type === 'ice') {
      const tx = this.pos.x + (dx / len) * 3.6, tz = this.pos.z + (dz / len) * 3.6;
      if (w.waterY - terrainH(tx, tz) < 0.15 && depthHere < 0.15) {
        this.events.push({ type: 'fail', msg: `${this.hero.name} necesita agua para congelar. Acércate a la inundación.` });
        return false;
      }
      w.spawnIce(tx, tz);
      this.speedBoost(sdur, 1.4, 0.5); this.grip = true;
    } else if (type === 'surf') {
      if (depthHere < 0.2 && !this.swimming && this.surfT <= 0) {
        this.events.push({ type: 'fail', msg: 'Este poder funciona sobre el agua. Acércate a la inundación.' });
        return false;
      }
      this.surfT = 5; this.speedBoost(5, 1, 0.1);
    }
    this.cd = this.cdMax * this.cdMul + (sdur - 5); // = 5 s activa + 5 s de recarga (BUTTON_TIMES.velocidad); con duración doble, la recarga sigue siendo la misma
    this.powerAnim = 1;
    this.events.push({ type: 'power', power: type });
    return true;
  }

  /* ------------------------ rescate ------------------------ */
  startRescue(victim) {
    this.rescueT = 0.001;
    this.rescueTarget = victim;
    this.events.push({ type: 'rescueStart', victim });
  }

  /* ------------------------ actualización ------------------------ */
  update(dt, inp, camYaw) {
    const w = this.world;
    const st = this.stats;
    const pos = this.pos;
    // (los eventos se vacían en game.js DESPUÉS de procesarlos: así no se pierden los que lanza usePower entre fotogramas)
    this.petrifyT = Math.max(0, this.petrifyT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    if (this.slowT <= 0) this.slowF = 1;
    if (this.petrifyT > 0) inp = { ...inp, x: 0, y: 0, jump: false, jumpPressed: false, sprint: false }; // piedra: no se mueve ni salta
    this.cd = Math.max(0, this.cd - dt);
    this.mantleCd = Math.max(0, this.mantleCd - dt);
    this.mantling = Math.max(0, this.mantling - dt);
    this.dashT = Math.max(0, this.dashT - dt);
    this.glideT = Math.max(0, this.glideT - dt);
    this.surfT = Math.max(0, this.surfT - dt);
    this.boostT = Math.max(0, this.boostT - dt);
    this.boostAge += dt;
    this.climbT = Math.max(0, this.climbT - dt);
    this.shieldT = Math.max(0, this.shieldT - dt);
    this.shieldOwnT = Math.max(0, this.shieldOwnT - dt);
    this.powerBuffT = Math.max(0, this.powerBuffT - dt);
    this.blockT = Math.max(0, (this.blockT || 0) - dt);
    this.crushT = Math.max(0, (this.crushT || 0) - dt);
    this.evadeT = Math.max(0, this.evadeT - dt);
    this.torchT = Math.max(0, this.torchT - dt);
    this.swingT = Math.max(0, this.swingT - dt);
    if (this.boostT <= 0) this.grip = false;
    this.powerAnim = Math.max(0, this.powerAnim - dt * 1.6);
    this.coyote -= dt;
    this.jumpBuf -= dt;

    // movimiento guiado (cuerda): solo se anima el modelo
    if (this.scripted) {
      if (this.model) {
        this.model.root.position.copy(pos);
        this.model.root.rotation.y = this.facing;
        this.model.update(dt, { speed: 0, grounded: false, vy: 4, power: 0.6, carrying: 0 }); // los rescatados van en burbujas: el héroe no los lleva encima
        this.applyPose();
      }
      return;
    }
    // plataformas móviles
    if (this.support && this.support.dyn) {
      pos.x += this.support.dx;
      pos.y += this.support.dy;
      pos.z += this.support.dz;
    }

    // rescate en curso: el héroe queda quieto
    if (this.rescueT > 0) {
      this.rescueT += dt / 0.95;
      if (this.rescueT >= 0.55 && this.rescueTarget) {
        this.events.push({ type: 'pickup', victim: this.rescueTarget });
        this.rescueTarget = null;
      }
      if (this.rescueT >= 1) this.rescueT = 0;
    }
    const frozen = this.rescueT > 0 || this.locked;

    // dirección deseada
    const sy = Math.sin(camYaw), cy = Math.cos(camYaw);
    const fx = -sy, fz = -cy;
    const rx = cy, rz = -sy;
    let mx = frozen ? 0 : inp.x, mz = frozen ? 0 : inp.y;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    let dx = fx * mz + rx * mx;
    let dz = fz * mz + rz * mx;
    this.dirX = dx;
    this.dirZ = dz;
    const moving = Math.hypot(dx, dz) > 0.05;

    // estado de agua
    const surfaceY = this.floorY(pos.x, pos.z, pos.y);
    this.depth = w.waterY - surfaceY;
    const deep = this.depth > 1.15;
    const surfing = this.surfT > 0 && this.depth > 0.1;
    this.swimming = deep && !surfing;
    this.wading = !this.swimming && !surfing && this.depth > 0.3;
    this.surfing = surfing;
    if (this.swimming !== !!this._wasSwim) { this.events.push({ type: this.swimming ? 'swimIn' : 'swimOut' }); this._wasSwim = this.swimming; } // salpicadura al entrar/salir nadando

    // velocidad objetivo
    let maxSpeed = st.speed * (inp.sprint ? 1.3 : 1);
    // el agua no frena: nadando o vadeando, cada héroe conserva su velocidad propia (st.speed)
    if (surfing) maxSpeed = st.speed * (this.hero.id === 'halley' ? 1.8 : 1.55);
    if (this.carrying.length) maxSpeed *= 1 - Math.min(0.08 * this.carrying.length, 0.2);
    maxSpeed *= this.env.speedMul * (1 + (this.boostMax - 1) * this.boostK) * (this.slowT > 0 ? this.slowF : 1) * this.speedBuff;
    if (w.slowAt && this.grounded) maxSpeed *= w.slowAt(pos.x, pos.z);
    if (this.dashT > 0) maxSpeed = 20;
    if (this.gliding) maxSpeed = st.speed * 1.6;
    const fly = this.fly;
    if (fly) maxSpeed = fly.speed * (inp.sprint ? 1.4 : 1) * (this.slowT > 0 ? this.slowF : 1);
    maxSpeed *= this.moveMul;
    const tvx = dx * maxSpeed + this.driftX, tvz = dz * maxSpeed + this.driftZ; // drift: tirón externo (remolino, viento) que se aplica cada fotograma
    this.driftX = this.driftZ = 0;
    const slip = this.grip || this.climbT > 0 ? 1 : this.env.slip;
    const accel = this.dashT > 0 ? 0 : fly ? 5.5 : this.grounded ? 16 * slip : this.swimming ? 14 : 4.5;
    if (this.dashT <= 0) {
      this.vx = damp(this.vx, tvx, accel, dt);
      this.vz = damp(this.vz, tvz, accel, dt);
    }
    // orientación
    const hs = Math.hypot(this.vx, this.vz);
    if (moving || this.dashT > 0) {
      const tgt = this.dashT > 0 ? Math.atan2(this.vx, this.vz) : Math.atan2(dx, dz);
      this.facing = dampAngle(this.facing, tgt, this.swimming ? 8 : 14, dt);
    }
    this.speedNow = hs;

    // salto
    if (inp.jumpPressed) this.jumpBuf = 0.14;
    const canJump = !frozen && (this.grounded || this.coyote > 0 || this.swimming);
    if (this.grounded || this.swimming) this.airJumps = 0;
    else if (inp.jumpPressed && !canJump && !this.fly && !frozen && this.airJumps === 0 && this.hero.id === 'ambar') {
      this.airJumps = 1;
      this.events.push({ type: 'airJump' }); // el juego la hace despegar (Vuelo Libre)
    }
    if (this.jumpBuf > 0 && canJump) {
      this.vy = this.swimming ? 6.8 : st.jump;
      if (this.surfing) this.vy = st.jump * 0.9;
      this.grounded = false;
      this.support = null;
      this.coyote = 0;
      this.jumpBuf = 0;
      this.events.push({ type: 'jump', water: this.swimming });
    }
    // planeo
    this.gliding = !frozen && this.glideT > 0 && !this.grounded && !this.swimming && inp.jump && this.vy < 3;

    // vertical
    if (fly && fly.levels) {
      // ÁGUILA — TRES NIVELES DE VUELO: SALTAR sube un nivel, V (o Ctrl) baja un nivel y desde el nivel 1 aterriza.
      // La altura objetivo se alcanza con una transición suave; al aterrizar vuelve al movimiento normal en el suelo.
      fly.t += dt;
      if (fly.t >= fly.max && !fly.ending) { fly.ending = true; this.events.push({ type: 'flyLevel', level: 0 }); } // se acaba el tiempo: aterriza
      if (!frozen && fly.t > 0.3 && !fly.ending) {
        if (inp.jumpPressed && fly.level < fly.levels.length) { fly.level++; this.events.push({ type: 'flyLevel', level: fly.level }); }
        else if (inp.landPressed) { fly.ending = true; this.events.push({ type: 'flyLevel', level: 0 }); } // L: aterriza ya, desde cualquier altura
        else if (inp.downPressed) { if (fly.level > 1) fly.level--; else fly.ending = true; this.events.push({ type: 'flyLevel', level: fly.ending ? 0 : fly.level }); }
      }
      const floor = this.floorY(pos.x, pos.z, pos.y), alt = pos.y - floor;
      const want = fly.ending ? -1 : fly.levels[fly.level - 1];
      let tv = clamp((want - alt) * 1.6, fly.ending ? -9 : -7, fly.climb * 1.3);
      if (fly.t < 0.45 && !fly.ending) tv = Math.max(tv, fly.climb); // despegue
      this.vy = damp(this.vy, tv, 3.2, dt);
    } else if (fly) {
      fly.t += dt;
      if (fly.t >= fly.max) fly.ending = true; // se acaba el tiempo: desciende suave hasta aterrizar
      const alt = pos.y - this.floorY(pos.x, pos.z, pos.y);
      // al acabarse el tiempo baja suave pero sin eternizarse: más deprisa en lo alto y frenando cerca del suelo
      // SEGUNDO NIVEL DE VUELO (orejas de Bada): el nivel 1 es el de siempre (mantén SALTAR para subir hasta su techo y
      // al soltar baja despacio). Pulsando SALTAR otra vez cerca de ese techo sube al nivel 2, más alto, donde se
      // mantiene planeando; V o Ctrl la devuelven al nivel 1. La subida y la bajada son suaves (muelle de velocidad).
      if (fly.ceil2 && !fly.ending && !frozen) {
        if (!fly.lvl2 && inp.jumpPressed && alt > fly.ceil - 0.8) { fly.lvl2 = true; this.events.push({ type: 'flyLevel', level: 2, ears: true }); }
        else if (fly.lvl2 && inp.downPressed) { fly.lvl2 = false; this.events.push({ type: 'flyLevel', level: 1, ears: true }); }
      }
      if (fly.ending) fly.lvl2 = false;
      let tv = fly.lvl2 ? clamp((fly.ceil2 - alt) * 1.4, -4, fly.climb * 1.2)
        : !frozen && inp.jump && !fly.ending ? fly.climb : fly.ending ? -Math.min(6, Math.max(fly.sink * 2.2, 1.2 + alt * 0.8)) : -fly.sink;
      if (!fly.lvl2 && alt > fly.ceil && tv > 0) tv = Math.min(tv, (fly.ceil - alt) * 2); // techo del nivel 1
      if (fly.t < 0.45) tv = Math.max(tv, fly.climb * 1.2); // despegue
      this.vy = damp(this.vy, tv, 4, dt);
    } else if (this.swimming && this.mantling <= 0 && this.vy < 4) {
      const target = w.waterY - 1.05;
      this.vy = damp(this.vy, (target - pos.y) * 6, 9, dt);
    } else if (this.gliding) {
      this.vy = Math.max(this.vy - G * dt * 0.35, -2.4);
    } else if (this.dashT > 0) {
      this.vy -= G * dt * 0.3;
    } else {
      this.vy -= G * dt;
    }
    if (this.vy < -40) this.vy = -40;

    // deriva por corriente
    // solo en agua profunda la corriente arrastra un poco (suave); vadeando no altera el movimiento
    if (this.swimming && !surfing) {
      const f = w.flowAt(pos.x, pos.z);
      const k = 0.5;
      this.flow.set(f.x * k, 0, f.z * k);
      dx += 0;
      pos.x += this.flow.x * dt;
      pos.z += this.flow.z * dt;
    } else this.flow.set(0, 0, 0);
    // viento (tormenta de hielo)
    if (this.env.wind && (this.env.wind.x || this.env.wind.z) && !this.rescueT) {
      const wk = this.grounded ? 1 : 1.6;
      pos.x += this.env.wind.x * dt * wk;
      pos.z += this.env.wind.z * dt * wk;
    }
    // empuje de escombros
    w.pushAt(pos.x, pos.z, this.R, this.push);
    if (this.push.x || this.push.z) {
      pos.x += this.push.x * dt;
      pos.z += this.push.z * dt;
      if (this.push.hit) this.events.push({ type: 'debris' });
      this.push.hit = null;
    }

    // movimiento horizontal con colisión
    this.moveAxis(this.vx * dt, 0);
    this.moveAxis(0, this.vz * dt);

    // movimiento vertical
    this.moveVertical(dt, surfing);

    // aterrizaje: tras el despegue, tocar el suelo descendiendo termina el vuelo
    if (fly && this.fly === fly && (this.grounded || this.swimming) && fly.t > (fly.minT || 0.8) && (fly.levels ? fly.ending : !(inp.jump && !fly.ending))) {
      this.fly = null;
      this.events.push({ type: 'flyEnd', kind: fly.kind });
    }

    // límites del mundo
    pos.x = clamp(pos.x, -120, 120);
    pos.z = clamp(pos.z, -120, 120);

    // animación
    if (this.model) {
      const m = this.model;
      m.root.position.copy(pos);
      m.root.rotation.y = this.facing;
      const runRef = st.speed;
      m.update(dt, {
        speed: this.swimming ? clamp(hs / st.swim, 0, 1.2) : (hs / runRef) * (this.animMul || 1),
        grounded: this.grounded,
        swimming: this.swimming,
        wading: this.wading, depth: this.depth,
        vy: this.vy,
        gliding: this.gliding || (this.glideT > 0 && !this.grounded && this.hero.id === 'ambar'),
        flying: !!fly, flyLean: fly ? fly.lean * Math.min(1, hs / Math.max(1, fly.speed)) : 0,
        dashing: this.dashT > 0,
        surfing: this.surfing,
        carrying: 0, // los rescatados van en sus burbujas: el héroe ya no adopta la postura de cargar
        rescue: this.rescueT,
        power: Math.max(this.powerAnim, this.swingT > 0 ? 0.5 : 0),
        celebrate: this.celebrate,
        // solo para elegir animaciones (no cambian nada del juego)
        sprint: this.boostT > 0, role: this.skillRole || null, hurt: (this.hurtAnim || 0) > 0,
      });
      if (this.hurtAnim > 0) this.hurtAnim = Math.max(0, this.hurtAnim - dt);
      this.applyPose();
    }
  }

  /* ------------------------ colisiones ------------------------ */
  floorY(x, z, feet) {
    let y = terrainH(x, z);
    const near = this.world.solidsNear(x - this.R * 0.8, x + this.R * 0.8, z - this.R * 0.8, z + this.R * 0.8, this.tmp);
    for (const s of near) {
      if (s.y1 <= feet + STEP + 0.02 && s.y1 > y) y = s.y1;
    }
    return y;
  }

  moveAxis(dx, dz) {
    if (dx === 0 && dz === 0) return;
    const pos = this.pos;
    const nx = pos.x + dx, nz = pos.z + dz;
    const near = this.world.solidsNear(nx - this.R, nx + this.R, nz - this.R, nz + this.R, this.tmp);
    let blocked = null;
    let stepTo = -Infinity;
    for (const s of near) {
      if (s.tag === 'tree' && s.y1 > pos.y + this.H) {
        // troncos: bloquean siempre
      }
      if (s.y1 <= pos.y + 0.001 || s.y0 >= pos.y + this.H) continue;
      const rise = s.y1 - pos.y;
      if (rise <= STEP && this.vy <= 2) {
        stepTo = Math.max(stepTo, s.y1);
        continue;
      }
      if (!blocked || s.y1 < blocked.y1) blocked = s;
    }
    if (blocked) {
      const rise = blocked.y1 - pos.y;
      const wantsIn = Math.hypot(this.dirX, this.dirZ) > 0.1 || this.dashT > 0;
      if (wantsIn && rise > STEP && rise <= (this.climbT > 0 ? 6.5 : MANTLE) && this.mantleCd <= 0 && blocked.tag !== 'tree' && this.rescueT <= 0) {
        const clearance = this.headClear(blocked, nx, nz);
        if (clearance) {
          this.vy = Math.max(this.vy, Math.sqrt(2 * G * (rise + 0.45)));
          this.mantling = 0.5;
          this.mantleCd = 0.55;
          this.grounded = false;
          this.support = null;
          this.events.push({ type: 'mantle' });
        }
      }
      if (dx !== 0) this.vx *= 0.2; else this.vz *= 0.2;
      return;
    }
    pos.x = nx;
    pos.z = nz;
    if (stepTo > pos.y && this.vy <= 2) {
      pos.y = stepTo;
      if (this.vy < 0) this.vy = 0;
    }
  }

  headClear(solid, nx, nz) {
    return true;
  }

  moveVertical(dt, surfing) {
    const pos = this.pos;
    const w = this.world;
    const prevFeet = pos.y;
    pos.y += this.vy * dt;
    let floor = terrainH(pos.x, pos.z);
    let sup = null;
    const near = w.solidsNear(pos.x - this.R * 0.8, pos.x + this.R * 0.8, pos.z - this.R * 0.8, pos.z + this.R * 0.8, this.tmp);
    for (const s of near) {
      if (this.vy <= 0) {
        if (s.y1 <= prevFeet + STEP + 0.02 && s.y1 > floor - 1e-4 && s.y1 >= floor) {
          if (s.y1 >= floor) { floor = s.y1; sup = s; }
        }
      } else if (s.y0 >= prevFeet + this.H - 0.15 && s.y0 < pos.y + this.H && s.y1 > s.y0) {
        // golpe de cabeza
        pos.y = s.y0 - this.H;
        this.vy = Math.min(this.vy, 0);
      }
    }
    // superficie del agua al surfear
    let waterFloor = -Infinity;
    if (surfing && w.waterY > floor + 0.05) waterFloor = w.waterY + 0.02;
    const eff = Math.max(floor, waterFloor);
    const wasGrounded = this.grounded;
    if (pos.y <= eff + 0.001 && this.vy <= 0) {
      if (!wasGrounded && this.vy < -6) this.events.push({ type: 'land', speed: -this.vy, water: waterFloor > floor });
      pos.y = eff;
      this.vy = 0;
      this.grounded = true;
      this.support = waterFloor > floor ? null : sup;
      this.coyote = 0.11;
    } else if (wasGrounded && this.vy <= 0 && pos.y - eff < 0.28 && pos.y - eff > 0) {
      pos.y = eff;
      this.vy = 0;
      this.grounded = true;
      this.support = waterFloor > floor ? null : sup;
      this.coyote = 0.11;
    } else {
      if (wasGrounded) this.coyote = 0.11;
      this.grounded = false;
      this.support = null;
    }
    // en agua profunda flotamos (el resorte mantiene la altura); se considera "sobre el agua"
    if (this.swimming) {
      this.grounded = false;
      this.support = null;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Cámara en tercera persona con colisión                             */
/* ------------------------------------------------------------------ */
export class ChaseCam {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = 0;
    this.pitch = 0.32;
    this.dist = 6.4;
    this.distTarget = 6.4;
    this.aim = 1.55; // altura (sobre los pies) a la que mira la cámara; la fija cada héroe
    this.pos = new THREE.Vector3(0, 5, 10);
    this.look = new THREE.Vector3();
    this.shakeAmt = 0;
    this.fovBase = 62;
    this.fovKick = 0;
    this.slowmo = 0;
    this.tmp = [];
    this.override = null;
    this.tmpV = new THREE.Vector3();
    this.tmpD = new THREE.Vector3();
    this.side = 0;   // desplazamiento lateral (cámara al hombro al apuntar)
    this.sideTarget = 0;
    this.zoomFov = 0; // grados que se cierra el campo de visión (mira)
    this.zoomTarget = 0;
  }

  shake(a) {
    this.shakeAmt = Math.max(this.shakeAmt, a);
  }

  snap(target, yaw) {
    if (yaw !== undefined) this.yaw = yaw;
    this.updateCore(0.0001, target, true);
  }

  update(dt, target, look) {
    // look: {dx, dy}
    this.manualT = (this.manualT || 0) + dt;
    if (look && (Math.abs(look.dx) > 1e-4 || Math.abs(look.dy) > 1e-4)) this.manualT = 0; // el jugador mueve la cámara
    if (look) {
      this.yaw -= look.dx;
      this.pitch = clamp(this.pitch + look.dy, -0.35, 1.25);
    }
    if (look && look.zoom) this.distTarget = clamp(this.distTarget + look.zoom, 3.2, 12);
    this.updateCore(dt, target, false);
  }

  updateCore(dt, target, snap) {
    const cam = this.camera;
    this.dist = damp(this.dist, this.distTarget, 6, dt);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const off = this.tmpV.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp).multiplyScalar(this.dist);
    const tgt = this.tmpD.set(target.x, target.y + this.aim, target.z);
    // CÁMARA DE VUELO (Ámbar): sigue el CUERPO y su trayectoria (nunca la cabeza); objetivo suavizado (sin
    // vibraciones del aleteo), ligera anticipación hacia donde vuela y, si el jugador no mueve la cámara, se coloca
    // poco a poco detrás de la trayectoria. El terreno no se interpone entre la cámara y el águila.
    const F = this.flight;
    this.flightK = damp(this.flightK || 0, F ? 1 : 0, 3, dt || 0.016);
    if (F && !snap) {
      const vx = F.vx || 0, vz = F.vz || 0, sp = Math.hypot(vx, vz);
      const lead = Math.min(3.2, sp * 0.22), lx = sp > 0.5 ? (vx / sp) * lead : 0, lz = sp > 0.5 ? (vz / sp) * lead : 0;
      this.fLead = this.fLead || new THREE.Vector3();
      this.fLead.x = damp(this.fLead.x, lx, 2.2, dt); this.fLead.z = damp(this.fLead.z, lz, 2.2, dt);
      this.fY = this.fY === undefined ? tgt.y : damp(this.fY, tgt.y, 6, dt);
      tgt.x += this.fLead.x; tgt.z += this.fLead.z; tgt.y = this.fY;
      if (sp > 2 && this.manualT > 1.2) this.yaw = dampAngle(this.yaw, Math.atan2(-vx, -vz), 1.4 * Math.min(1, (sp - 2) / 6), dt);
    } else { this.fY = undefined; if (this.fLead) this.fLead.set(0, 0, 0); }
    this.side = damp(this.side, this.sideTarget, 8, dt);
    if (Math.abs(this.side) > 0.001) { tgt.x += Math.cos(this.yaw) * this.side; tgt.z -= Math.sin(this.yaw) * this.side; } // al hombro
    const desired = new THREE.Vector3().copy(tgt).add(off);
    // colisión de la cámara: rayo del objetivo a la posición deseada
    let tHit = 1;
    const x0 = Math.min(tgt.x, desired.x) - 0.5, x1 = Math.max(tgt.x, desired.x) + 0.5;
    const z0 = Math.min(tgt.z, desired.z) - 0.5, z1 = Math.max(tgt.z, desired.z) + 0.5;
    const near = this.world.solidsNear(x0, x1, z0, z1, this.tmp);
    const ox = tgt.x, oy = tgt.y, oz = tgt.z;
    const ddx = desired.x - ox, ddy = desired.y - oy, ddz = desired.z - oz;
    for (const s of near) {
      if (s.tag === 'tree') continue;
      let tmin = 0, tmax = 1;
      const slab = (o, d, mn, mx) => {
        if (Math.abs(d) < 1e-6) return o >= mn && o <= mx;
        let t1 = (mn - o) / d, t2 = (mx - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        return tmin <= tmax;
      };
      if (slab(ox, ddx, s.x0 - 0.2, s.x1 + 0.2) && slab(oy, ddy, s.y0 - 0.2, s.y1 + 0.2) && slab(oz, ddz, s.z0 - 0.2, s.z1 + 0.2)) {
        if (tmin > 0.02) tHit = Math.min(tHit, tmin);
      }
    }
    tHit = Math.max(tHit, Math.min(1, 1.6 / Math.max(this.dist, 0.1)));
    desired.set(ox + ddx * tHit, oy + ddy * tHit, oz + ddz * tHit);
    const gy = terrainH(desired.x, desired.z) + 0.5;
    if (desired.y < gy) desired.y = gy;
    if (this.flightK > 0.01) { // en vuelo: que ni una ladera ni una duna tapen al águila (línea de visión libre)
      let need = 0;
      for (const u of [0.25, 0.5, 0.75, 1]) {
        const x = ox + (desired.x - ox) * u, z = oz + (desired.z - oz) * u, ly = oy + (desired.y - oy) * u;
        need = Math.max(need, (terrainH(x, z) + 1.2 - ly) / u);
      }
      if (need > 0) desired.y += need * this.flightK;
    }
    if (snap) this.pos.copy(desired);
    else {
      const k = (tHit < 1 ? 20 : 12) * (1 - 0.45 * this.flightK); // en vuelo, seguimiento más suave (cinematográfico)
      this.pos.x = damp(this.pos.x, desired.x, k, dt);
      this.pos.y = damp(this.pos.y, desired.y, k, dt);
      this.pos.z = damp(this.pos.z, desired.z, k, dt);
    }
    this.look.set(tgt.x, tgt.y + 0.1, tgt.z);
    this.shakeAmt = damp(this.shakeAmt, 0, 3, dt);
    cam.position.copy(this.pos);
    if (this.shakeAmt > 0.002) {
      cam.position.x += (Math.random() - 0.5) * this.shakeAmt;
      cam.position.y += (Math.random() - 0.5) * this.shakeAmt;
      cam.position.z += (Math.random() - 0.5) * this.shakeAmt;
    }
    cam.lookAt(this.look);
    this.fovKick = damp(this.fovKick, 0, 4, dt);
    this.zoomFov = damp(this.zoomFov, this.zoomTarget, 8, dt);
    const fov = this.fovBase + this.fovKick - this.zoomFov;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
