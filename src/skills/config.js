// CONFIGURACIÓN DE HABILIDADES — todas las variables ajustables en un solo sitio (sin números mágicos).
// Unidades: metros y segundos. `cd` = recarga. Cada habilidad pasa por: prep (preparación) → exec (ejecución) → recover (recuperación).
// El daño de los héroes se mide sobre la vida de un jefe (100 = barra completa; el golpe básico del poder hace 12).

export const HERO_SKILLS = {
  // JAGLION — COLA ELÁSTICA: se engancha a un punto (balanceo/impulso) o alcanza enemigos (atraer ligeros / golpear pesados)
  jago: {
    // TRANSFORMACIÓN EN ROCA: se hace bola y rueda a gran velocidad (lo controla el jugador); arrolla enemigos
    rock: {
      id: 'rock', name: 'Transformación en Roca', icon: '🥌', cd: 12,
      transformT: 0.5, rollT: 5, recover: 0.45,  // transformación, rodar, volver a su forma (vuelve a pulsar para salir antes)
      speedMul: 2.2, radius: 0.95,                // velocidad (× la normal) y radio de la bola (× media altura del héroe)
      hitDamage: 10, hitForce: 12, hitEvery: 0.6, // golpe al arrollar (por objetivo, cada hitEvery s)
      shake: 0.08,
    },
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
      segments: 30,                 // articulaciones de la cola elástica (más = más flexible)
      wobble: 0.55,                 // ondulación elástica al salir disparada
      climbT: 0.35,                 // trepar el último tramo tras el balanceo
    },
    // OBSIDIANA — AVALANCHA: oleada de fragmentos de obsidiana que avanza por el escenario
    obsidian: {
      id: 'obsidian', name: 'Obsidiana: Avalancha', icon: '🖤', cd: 18,
      prep: 0.8, exec: 2.4, recover: 0.5,
      length: 22, width: 8,         // recorrido y anchura de la avalancha
      shards: 110,                  // fragmentos
      damage: 24, force: 16, rootT: 0.8,
      shake: 0.45,
    },
    // ARMA — KATANA: tajo rápido en arco delante del héroe
    katana: { id: 'katana', name: 'Katana', icon: '🗡️', cd: 1.3, prep: 0.12, swing: 0.22, recover: 0.2, range: 3.4, arcDeg: 120, damage: 8, force: 5, color: 0xd8e8ff },
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
    // ESPEJISMOS: crea copias de calor; vuelve a pulsar para teletransportarte a la siguiente (la copia estalla en arena)
    mirage: {
      id: 'mirage', name: 'Espejismos', icon: '🪞', cd: 11,
      prep: 0.35, copies: 3, dist: 7.5, spread: 55, life: 6.5, // número, distancia, abanico (grados) y vida de las copias
      burstRadius: 3.6, blindT: 2.6, damage: 6,                // estallido de arena al usar una copia
    },
    // VUELO DE OREJAS: despega con sus enormes orejas, vuela un tiempo limitado
    ears: {
      id: 'ears', name: 'Vuelo de Orejas', icon: '👂', cd: 14,
      takeoffT: 0.5, flyT: 6,       // despegue y tiempo de vuelo
      speed: 7, climb: 5.5, sink: 1.1, ceil: 7.5, // velocidad, subida (mantén SALTAR), descenso suave y altura máxima
      flap: 26,                     // velocidad del aleteo de las orejas
    },
    // ARMA — LANZA MORADA: estocada (golpe cercano) y proyección de cristal violeta que atraviesa
    spear: { id: 'spear', name: 'Lanza morada', icon: '🔱', cd: 1.2, prep: 0.2, thrust: 0.16, recover: 0.25, reach: 2.4, range: 20, speed: 34, pierce: 2, coneDeg: 14, damage: 7, force: 4 },
  },

  // ZORRA ÁRTICA — COLAS DE LAS CUATRO ESTACIONES (una por uso, en orden) + RUEDA DE LAS ESTACIONES (especial)
  kyra: {
    skill: {
      id: 'seasons', name: 'Primavera', icon: '🌷', cd: 6.5,
      prep: 0.3, exec: 0.45, recover: 0.3,
      order: ['spring'],            // solo primavera (las cuatro estaciones siguen dentro de la Rueda ☸️)
      wheelOrder: ['spring', 'summer', 'autumn', 'winter'],
      seasons: {
        spring: { label: '🌷 Primavera', color: 0xff8ac8, range: 9, radius: 3.6, rootT: 1.9, duration: 2.6, damage: 3, trees: 6, mounds: 4 },
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
    // AURORA POLAR: cortinas de aurora en el cielo y una zona de energía polar que congela
    aurora: {
      id: 'aurora', name: 'Aurora Polar', icon: '🌌', cd: 20,
      prep: 0.9, exec: 6.5, recover: 0.5,
      radius: 8, tick: 0.5,         // zona y frecuencia de los pulsos
      slowF: 0.35, damage: 2.5, freezeEvery: 2.0, freezeT: 1.1, // ralentiza, daña y congela cada cierto tiempo
      cdHeal: 0.35,                 // dentro de la zona, las recargas del héroe avanzan un 35 % más rápido
    },
    // SOLSTICIO DE VERANO: aura solar dorada y expansión de luz cálida
    solstice: {
      id: 'solstice', name: 'Solsticio de Verano', icon: '🌞', cd: 20,
      prep: 1.1, exec: 1.1, recover: 0.6,
      radius: 10, damage: 20, force: 15, burnT: 3, burnDps: 3, // expansión: daño, empuje y quemadura
      rays: 10,
    },
    // ARMA — HACHA: hachazo de hielo hacia abajo; cristales que ralentizan
    axe: { id: 'axe', name: 'Hacha', icon: '🪓', cd: 1.5, prep: 0.22, chop: 0.16, recover: 0.25, range: 3.2, arcDeg: 80, damage: 9, slowF: 0.6, slowT: 1.5, force: 4 },
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
    // VUELO LIBRE (sin botón): DOBLE SALTO en el aire para despegar; aterriza al tocar el suelo
    flight: {
      id: 'flight', name: 'Vuelo Libre', icon: '🦅', cd: 4,
      takeoffT: 0.55, flyT: 40,     // despegue y tiempo máximo de vuelo
      speed: 11, climb: 7, sink: 1.6, ceil: 34, // velocidad (SPRINT = más rápido), subida (SALTAR), planeo y techo
      camDist: 15, camPitch: 0.62,  // cámara aérea
    },
    // ESCUDO — TORNADOS ENVOLVENTES: varios tornados giran a su alrededor; la protegen y apartan a los enemigos
    tornado: { id: 'tornado', name: 'Tornados Envolventes', icon: '🌪️', cd: 15, prep: 0.4, exec: 5, recover: 0.4, count: 4, orbit: 2.6, radius: 4.2, push: 9, damage: 1.5 },
    // ARMA — DOS DISCOS: lanza uno de sus dos discos de fuego; rebota entre enemigos y vuelve a su mano
    disc: { id: 'disc', name: 'Dos Discos', icon: '🥏', cd: 1.6, prep: 0.15, recover: 0.2, range: 16, speed: 30, bounces: 2, bounceRange: 8, damage: 6 },
    // GARRAS DE VIENTO: zarpazo que lanza tres cortes de aire con forma de garra
    claws: { id: 'claws', name: 'Garras de Viento', icon: '🦅', cd: 6, prep: 0.3, recover: 0.35, cuts: 3, speed: 20, range: 10, spreadDeg: 16, width: 1.3, damage: 4, force: 6 },
  },

  // DRAGÓN DE KOMODO — LENGUA CAMALEÓNICA: atrae enemigos ligeros o se impulsa hacia pesados y superficies; remata con giro de cola
  kairo: {
    // GÉISER: grietas de magma en el suelo y columnas volcánicas que golpean a los enemigos cercanos
    geyser: {
      id: 'geyser', name: 'Géiser', icon: '🌋', cd: 11,
      prep: 0.55, crackT: 0.75, exec: 1.6, recover: 0.4,
      count: 7, ring: 5.5,          // géiseres y radio del anillo (más uno bajo cada enemigo cercano)
      radius: 1.7, height: 8, damage: 9, force: 7, burnT: 2, burnDps: 2.5,
      shake: 0.35,
    },
    // LAVA NEGRA: corriente de lava oscura que se extiende por el suelo y deja una zona ardiente
    lava: {
      id: 'blacklava', name: 'Lava Negra', icon: '🌑', cd: 12,
      prep: 0.5, spreadT: 0.9, recover: 0.4,
      length: 13, width: 3.6, zoneT: 5,   // recorrido, anchura y vida de la zona
      damage: 10, dps: 4, slowF: 0.5, force: 5,
    },
    skill: {
      id: 'tongue', name: 'Lengua Camaleónica', icon: '👅', cd: 6.5,
      prep: 0.14, recover: 0.2,
      range: 15, coneDeg: 40,
      shootT: 0.16, retractT: 0.3,  // extensión y retracción de la lengua
      pullSpeed: 24, propelSpeed: 26,
      spinT: 0.38, spinRadius: 3.4, spinDamage: 11, spinForce: 7,
      surfaceMinDist: 2.5,
      segments: 32,                 // articulaciones de la lengua
      overshoot: 0.12,              // la lengua se pasa un poco y rebota (elasticidad)
      wobble: 0.3,                  // ondulación lateral al salir y al recogerse
    },
    // ARMA — MARTILLO: salto corto y martillazo que hace temblar el suelo
    hammer: { id: 'hammer', name: 'Martillo', icon: '🔨', cd: 1.8, prep: 0.3, slam: 0.18, recover: 0.3, range: 2.2, radius: 3.4, damage: 10, force: 8 },
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
    // TSUNAMI: una ola enorme se forma detrás de la Nutria y arrasa hacia delante
    tsunami: {
      id: 'tsunami', name: 'Tsunami', icon: '🌊', cd: 16,
      gatherT: 1.0, formT: 0.6, travelT: 2.3, crashT: 0.6, recover: 0.4,
      length: 22, width: 12, height: 5,    // recorrido, anchura y altura de la ola
      damage: 18, carry: 13,               // daño (una vez por enemigo) y arrastre (m/s)
    },
    // MAELSTROM: remolino gigante con núcleo oscuro que absorbe a los enemigos
    maelstrom: {
      id: 'maelstrom', name: 'Maelstrom', icon: '🌀', cd: 20,
      prep: 0.6, exec: 4.6, recover: 0.5,
      dist: 7, radius: 7.5,         // distancia delante del héroe y radio de succión
      pull: 7, dps: 3.5, coreRadius: 1.4, collapseDamage: 8, collapseForce: 12, // en el núcleo los esbirros desaparecen
    },
    // ARMA — BUMERÁN: sale en arco, golpea a la ida y a la vuelta, y regresa a su mano
    boomerang: { id: 'boomerang', name: 'Bumerán', icon: '🪃', cd: 2.2, prep: 0.15, flightT: 1.3, recover: 0.15, dist: 11, width: 3.2, hitRadius: 1.4, damage: 6, force: 4 },
  },

  // LINCE — PODERES DEL ECLIPSE: equilibrio entre la luz y la oscuridad
  lira: {
    // UMBRA — ECLIPSE SOLAR: el mundo se oscurece, la luna tapa el sol y libera energía oscura (ciega y marca)
    umbra: {
      id: 'umbra', name: 'Umbra · Eclipse Solar', icon: '🌘', cd: 15,
      prep: 1.3, exec: 2.6, recover: 0.5,
      radius: 9, pulses: 3, damage: 6, blindT: 3, markT: 6, // pulsos de oscuridad: daño, cegar y marcar (+50 % daño recibido)
    },
    // PENUMBRA — ECLIPSE LUNAR: esfera de luz lunar que protege y frena a los enemigos
    penumbra: {
      id: 'penumbra', name: 'Penumbra · Eclipse Lunar', icon: '🌑', cd: 16,
      prep: 0.6, exec: 5, recover: 0.4,
      radius: 5.5, wave: 0.9,       // radio de la esfera y cada cuánto sale una onda plateada
      slowF: 0.4, damage: 2, force: 6, speedMul: 1.2, // dentro: el héroe es intocable y más rápido; los enemigos se frenan
    },
    // LUNA DE SANGRE: luna roja gigante, el cielo se tiñe de rojo y una onda carmesí devastadora
    blood: {
      id: 'bloodmoon', name: 'Luna de Sangre', icon: '🔴', cd: 26,
      prep: 1.8, exec: 1.4, recover: 0.7,
      radius: 13, damage: 22, force: 18, bolts: 6, boltDamage: 4, markT: 5,
    },
    // ARMA — GUADAÑA DE RAYO: barrido amplio y onda de rayo en media luna que atraviesa
    scythe: { id: 'scythe', name: 'Guadaña', icon: '⚡', cd: 1.4, prep: 0.22, swing: 0.24, recover: 0.25, reach: 3.4, arcDeg: 170, range: 16, speed: 26, damage: 8, waveDamage: 5, force: 5 },
    // VISIÓN ESPECIAL: ve enemigos, trampas, personas ocultas y puntos débiles a través de las paredes
    vision: { id: 'vision', name: 'Visión Especial', icon: '👁️', cd: 16, prep: 0.5, exec: 9, recover: 0.3, range: 130, weakMul: 1.5 },
  },
};

// ORDEN DE LOS BOTONES de cada héroe (el botón 1, VELOCIDAD, es el poder base de heroes.js).
// 1 Velocidad · 2 Poder principal · 3 Escudo · 4 Arma · 5 Especial. Kyra tiene dos ataques y Lira dos escudos (6 botones).
export const HERO_BUTTONS = {
  jago: [['obsidian', 'poder'], ['rock', 'escudo'], ['katana', 'arma'], ['skill', 'especial']],
  kairo: [['lava', 'poder'], ['geyser', 'escudo'], ['hammer', 'arma'], ['skill', 'especial']],
  halley: [['skill', 'poder'], ['mirage', 'escudo'], ['spear', 'arma'], ['ears', 'especial']],
  nilo: [['tsunami', 'poder'], ['maelstrom', 'escudo'], ['boomerang', 'arma'], ['skill', 'especial']],
  kyra: [['special', 'poder'], ['solstice', 'escudo'], ['skill', 'poder'], ['axe', 'arma'], ['aurora', 'especial']],
  lira: [['blood', 'poder'], ['umbra', 'escudo'], ['penumbra', 'escudo'], ['scythe', 'arma'], ['vision', 'especial']],
  ambar: [['skill', 'poder'], ['tornado', 'escudo'], ['disc', 'arma'], ['claws', 'especial']],
};
export const ROLE_LABEL = { velocidad: 'VEL', poder: 'PODER', escudo: 'ESCUDO', arma: 'ARMA', especial: 'ESPECIAL' };

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
export const MINIONS = { max: 3, speed: 2.7, radius: 0.55, contact: 0.95, spawnEvery: 14, firstAt: 8, hp: 12, score: 10, dropChance: 0.25 };
// Categorías de NPC hostiles: cada una con su vida, tamaño, velocidad y fuerza de golpe (unidades de golpe de TEAM)
export const NPC_KINDS = {
  esbirro: { name: 'Esbirro', hp: 12, scale: 1, speed: 2.7, hit: 0.5, score: 10 },
  bruto: { name: 'Bruto', hp: 34, scale: 1.55, speed: 1.9, hit: 0.9, score: 30 },
};

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

// VIDA DEL HÉROE fuera de los jefes (exploración): daño de los peligros del escenario en puntos de vida
export const HEALTH = {
  max: TEAM.hp,          // vida máxima (la misma que en el combate de jefe)
  hitGrace: 0.9,         // invulnerabilidad breve tras un golpe
  debris: 12,            // escombro que cae en una réplica
  flying: 10,            // objeto que vuela con el viento
  bomb: 14,              // roca volcánica
  weed: 4,               // planta rodadora / objeto ligero
  fireDps: 7,            // fuego (por segundo, dentro de las llamas)
  lavaDps: 9,            // lava (por segundo)
};

// BOTIQUINES Y BEBIDAS: recuperación, capacidad de la mochila y aspecto. `flat` = puntos; `pct` = % de la vida máxima.
export const HEAL_ITEMS = {
  drink: { id: 'drink', name: 'Bebida energética', short: '+20', flat: 20, cap: 3, color: '#3de0c8', icon: '🥤' },
  kit: { id: 'kit', name: 'Botiquín', short: '+50', flat: 50, cap: 3, color: '#f4f4f4', icon: '✚' },
  kit25: { id: 'kit25', name: 'Botiquín amarillo', short: '25 %', pct: 0.25, cap: 3, color: '#ffd23a', icon: '✚' },
  kit50: { id: 'kit50', name: 'Botiquín azul', short: '50 %', pct: 0.5, cap: 3, color: '#3a8cff', icon: '✚' },
  kit75: { id: 'kit75', name: 'Botiquín rojo', short: '75 %', pct: 0.75, cap: 3, color: '#ff3a3a', icon: '✚' },
  kit100: { id: 'kit100', name: 'Botiquín verde', short: '100 %', pct: 1, cap: 3, color: '#2ee06a', icon: '✚' },
};
export const HEAL_ORDER = ['drink', 'kit', 'kit25', 'kit50', 'kit75', 'kit100'];
// Reparto por nivel (cuántos de cada tipo aparecen en el mapa) y objetos extra dentro de la arena del jefe
export const PICKUP_SPAWN = {
  perLevel: { drink: 4, kit: 3, kit25: 2, kit50: 1, kit75: 1, kit100: 1 },
  arena: ['drink', 'kit25'],
  radius: 1.7,           // distancia de recogida
};
// Escombros y obstáculos que los poderes pueden destruir (vida de cada uno)
export const DESTRUCTIBLE = { rubble: 14, debris: 6, obstacle: 9 };
