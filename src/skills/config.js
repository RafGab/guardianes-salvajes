// CONFIGURACIÓN DE HABILIDADES — todas las variables ajustables en un solo sitio (sin números mágicos).
// Unidades: metros y segundos. `cd` = recarga. Cada habilidad pasa por: prep (preparación) → exec (ejecución) → recover (recuperación).
// El daño de los héroes se mide sobre la vida de un jefe (100 = barra completa; el golpe básico del poder hace 12).

export const HERO_SKILLS = {
  // JAGLION — COLA ELÁSTICA: se engancha a un punto (balanceo/impulso) o alcanza enemigos (atraer ligeros / golpear pesados)
  jago: {
    skill: {
      id: 'tail', name: 'Cola Elástica', icon: '🪢', cd: 7,
      prep: 0.16, recover: 0.25,
      range: 16, coneDeg: 55,       // alcance y ángulo de puntería (grados a cada lado)
      hookSpeed: 38,                // velocidad a la que la cola sale disparada
      swingSpeed: 19,               // velocidad del balanceo hacia el anclaje
      arc: 0.22,                    // curvatura del balanceo (proporción de la distancia)
      releaseBoost: 10, releaseUp: 6.5, // impulso al soltar
      anchorMinRise: 1.2, anchorMaxRise: 18, anchorMinDist: 3,
      pullSpeed: 22, damage: 14, force: 6, // enemigos: atracción, daño a pesados, empuje
      trailTime: 0.7,               // estela de velocidad tras el impulso
      whiffCdFactor: 0.45,          // recarga reducida si no engancha nada
    },
  },

  // FENECO — HABOOB AURICULAR: tormenta de arena que avanza empujando, cegando y desviando proyectiles ligeros
  halley: {
    skill: {
      id: 'haboob', name: 'Haboob Auricular', icon: '🌪️', cd: 12,
      prep: 0.55, exec: 3.4, recover: 0.5,
      rootT: 1.4,                   // segundos (tras la preparación) que el héroe permanece plantado
      speed: 7.5,                   // avance de la tormenta
      width: 6.5,                   // anchura (diámetro) de la tormenta
      push: 9, damage: 5,           // empuje (m/s) y daño por segundo a pesados
      blindT: 3.2,                  // cegado: el enemigo apunta mal
      deflectRadius: 3.4,           // proyectiles ligeros dentro de este radio se desvían
      earShake: 0.22,               // exageración del movimiento de las orejas (rad)
      clearsObstacles: true,        // despeja obstáculos ligeros como el viento
    },
  },

  // ZORRA ÁRTICA — COLAS DE LAS CUATRO ESTACIONES (una por uso, en orden) + RUEDA DE LAS ESTACIONES (especial)
  kyra: {
    skill: {
      id: 'seasons', name: 'Cuatro Estaciones', icon: '🍃', cd: 6.5,
      prep: 0.3, exec: 0.45, recover: 0.3,
      order: ['spring', 'summer', 'autumn', 'winter'],
      seasons: {
        spring: { label: '🌸 Primavera', color: 0xff8ac8, range: 9, radius: 3.6, rootT: 1.9, duration: 2.2, damage: 3 },
        summer: { label: '☀️ Verano', color: 0xffb02a, radius: 7.2, damage: 9, force: 6, burnT: 1.2 },
        autumn: { label: '🍂 Otoño', color: 0xd8742a, range: 8, radius: 3.4, duration: 2.8, force: 8, damage: 2 },
        winter: { label: '❄️ Invierno', color: 0x8ad8ff, range: 9.5, coneDeg: 38, slowF: 0.45, slowT: 3.2, damage: 4, force: 2 },
      },
    },
    special: {
      id: 'wheel', name: 'Rueda de las Estaciones', icon: '☸️', cd: 22,
      prep: 0.5, exec: 2.6, recover: 0.5,
      radius: 6.8, tick: 0.35,      // radio y cada cuánto aplica los cuatro efectos
      spinSpeed: 7,                 // vueltas del héroe (rad/s)
      damage: 3, force: 5, rootT: 0.7, slowF: 0.6, slowT: 2.0,
    },
  },

  // ÁGUILA — PICADO DEL TRUENO: asciende cargando electricidad y cae en picado; onda de viento y rayo al impactar
  ambar: {
    skill: {
      id: 'dive', name: 'Picado del Trueno', icon: '⚡', cd: 9,
      prep: 0.55, charge: 0.7, recover: 0.45,
      ascendHeight: 9.5,            // altura a la que asciende
      range: 20,                    // distancia máxima del objetivo
      diveSpeed: 38,
      waveRadius: 6.8, damage: 22, force: 14,
      shake: 0.5,                   // sacudida de cámara al impactar
    },
  },

  // DRAGÓN DE KOMODO — LENGUA CAMALEÓNICA: atrae enemigos ligeros o se impulsa hacia pesados y superficies; remata con giro de cola
  kairo: {
    skill: {
      id: 'tongue', name: 'Lengua Camaleónica', icon: '👅', cd: 6.5,
      prep: 0.14, recover: 0.2,
      range: 15, coneDeg: 40,
      shootT: 0.16, retractT: 0.3,  // extensión y retracción de la lengua
      pullSpeed: 24, propelSpeed: 26,
      spinT: 0.38, spinRadius: 3.4, spinDamage: 11, spinForce: 7,
      surfaceMinDist: 2.5,
    },
  },

  // NUTRIA — BLINK ACUÁTICO: se desvanece en una salpicadura y reaparece más allá, dejando una estela de agua
  nilo: {
    skill: {
      id: 'blink', name: 'Blink Acuático', icon: '💧', cd: 5.5,
      vanishT: 0.2, appearT: 0.22, recover: 0.12,
      distance: 9.5,
      trailTime: 3.6, trailWidth: 2.0,
      trailSlowF: 0.5, trailSlowT: 1.6, trailForce: 4,
      minClear: 0.6,                // holgura al buscar un destino libre
    },
  },

  // LINCE — MIRADA DEL ECLIPSE: ojo solar / ojo lunar (se alternan) + ECLIPSE TOTAL (especial)
  lira: {
    skill: {
      id: 'eclipse', name: 'Mirada del Eclipse', icon: '☀️', cd: 8,
      prep: 0.28, recover: 0.2,
      solar: { duration: 6.5, damageMul: 1.5, markRange: 20, markT: 6.5, color: 0xffd24a },
      lunar: { duration: 6.5, slowF: 0.55, range: 15, speedMul: 1.28, evadeEvery: 3.0, color: 0x8a9aff },
    },
    special: {
      id: 'total', name: 'Eclipse Total', icon: '🌑', cd: 24,
      prep: 0.6, exec: 5.2, recover: 0.4,
      radius: 9.5, tick: 0.5,
      damage: 1.5, slowF: 0.55, markMul: 1.5, speedMul: 1.25, // el daño se multiplica por la marca y por el bonus del ojo solar
    },
  },
};

// Ataques de jefe. Estructura común: telegraph (aviso) → attack → impacto (VFX) → recover.
export const BOSS_ATTACKS = {
  // Cuántas veces más probable es la habilidad de firma según la fase (1..3) y recarga entre firmas
  common: { sigChance: [0.28, 0.4, 0.5], sigCd: [9, 7, 5.5] },

  minotauro: {
    name: 'Laberinto Sísmico',
    telegraph: 1.5,                 // grietas (marcan dónde saldrán los muros) + vibración del suelo
    slamRadius: 5.5,                // radio del golpe inicial
    walls: 6, wallLen: 12, wallThick: 1.6, wallH: 2.6, wallGap: 4.8, // pasillos paralelos (muros alineados con los ejes)
    cross: 2,                       // muros bajos DENTRO del pasillo: la embestida los destruye
    riseT: 0.55, wallLife: 10,
    chargeSpeed: 19, chargeMax: 1.8, stunT: 1.4, // si choca con el muro del fondo (indestructible) queda aturdido
    recover: 1.0,
  },
  kraken: {
    name: 'Abismo Tentacular',
    telegraph: 1.25, zones: [3, 4, 5], zoneRadius: 2.3, strikeT: 0.4, riseH: 4.2, hold: 0.5,
    recover: 0.9,
    whirl: { telegraph: 1.6, duration: 4.6, radius: 11.5, pullMin: 0.8, pullMax: 3.6, coreRadius: 2.6, cd: 20 },
  },
  cerbero: {
    name: 'Triple Aliento',
    telegraph: 1.15,
    fire: { range: 10, coneDeg: 32, color: 0xff6a1a },
    ice: { range: 11, coneDeg: 26, color: 0x8ae0ff, slowF: 0.45, slowT: 3.0 },
    ghost: { speed: 9.5, radius: 0.7, color: 0xb070ff, life: 5, homing: 0.9 },
    triple: { telegraph: 1.9, spread: 36, cd: 22 },
    attackT: 0.7, recover: 0.9,
  },
  basilisco: {
    name: 'Mirada Petrificante',
    telegraph: 1.4, duration: 2.6, range: 15, coneDeg: 30, track: 0.55,
    exposure: 0.85,                 // segundos dentro del cono para quedar petrificado
    petrifyT: 2.4, fade: 1.2,       // duración y desvanecimiento progresivo de la piedra
    recover: 1.1,
  },
  long: {
    name: 'Danza de la Tormenta',
    danceT: 4.2, clouds: 5, cloudH: 6.5, cloudR: 2.6,
    strikeTelegraph: 0.9, strikeRadius: 2.6, gust: 7,
    sweepTelegraph: 1.9, sweepSpeed: 23, sweepAmp: 6, sweepWaves: 2.2, sweepHit: 2.4,
    recover: 1.0,
  },
  medusa: {
    name: 'Corona de Serpientes',
    snakes: 5, aimT: 1.0, volleyGap: 0.16,
    shot: { speed: 12.5, radius: 0.6, life: 4.5, color: 0x6aff7a },
    gaze: { telegraph: 1.6, duration: 1.5, range: 12.5, coneDeg: 28, exposure: 0.7, petrifyT: 2.0, fade: 1.0 },
    statues: 3, statueLife: 9, statueR: 0.9, statueH: 2.6,
    recover: 1.0,
  },
  fenrir: {
    name: 'Devorador del Eclipse',
    solar: { swipeTelegraph: 0.55, swipeArc: 110, swipeRange: 6.5, chargeSpeedMul: 1.35 },
    lunar: { copies: 2, delays: [1.1, 2.1], alpha: 0.38, lunarAt: 0.66 },
    eclipse: { at: 0.33, sunDim: 0.45 },
    recover: 0.8,
  },
};

// Esbirros ligeros que aparecen en los combates de jefe (dan sentido a atraer / desviar / ralentizar)
export const MINIONS = { max: 3, speed: 2.7, radius: 0.55, contact: 0.95, spawnEvery: 14, firstAt: 8, hp: 1, score: 10 };

// Equipo y vida en los combates de jefe. Cada héroe tiene su propia barra; los golpes del jefe se miden en "golpes" (1 = golpe normal).
export const TEAM = {
  size: 3,              // héroes por equipo
  hp: 100,              // vida máxima de cada héroe
  hitDamage: 14,        // vida que quita un golpe normal (1 unidad) de un jefe
  phaseScale: 0.15,     // +15 % de daño por cada fase del jefe
  minionHit: 0.5,       // golpe de esbirro (en unidades)
  projectileHit: 0.7,   // golpe de proyectil (en unidades)
  benchRegen: 1.5,      // vida/s que recuperan los héroes en reserva
  switchCd: 1.6,        // espera entre cambios de héroe
  switchGrace: 1.0,     // invulnerabilidad breve tras entrar en combate
  introT: 4.8,          // duración de la presentación del jefe y la aparición del equipo
};
