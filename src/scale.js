// ESCALA MAESTRA DE CATAC 7 — única fuente de verdad para el tamaño de los personajes.
//
// Unidad del juego: 1 unidad = 1 metro. Referencia humana: 1,80 m.
// Cada modelo se normaliza (pies en y=0, centrado, altura 1) y se escala SOLO desde aquí:
// altura final = `height`. La longitud y la anchura salen de las proporciones reales del
// modelo (no se deforman). `radius` es el radio de colisión/impacto sobre el suelo.
//
// Nada de esto toca velocidad, daño, vida ni dificultad: eso vive en heroes.js / bosses.js / levels.js.

export const MODEL_DIR = '/models/';
export const MANNEQUIN_H = 1.8;

// Héroes (jugables). ALTURAS OFICIALES (parte del diseño de los personajes; NO se tocan para componer escenas):
// Feneco 1,00 → Nutria 1,50 → Águila 1,60 → Lince 1,65 → Zorra Ártica 1,75 → Jaglion 1,80 → Komodo 1,90.
// Si una escena no cuadra, se cambia la cámara o la composición, nunca la estatura.
// `radius` (colisión) ≈ 0,22 × altura, con tope 0,42 (el valor máximo anterior) para no cerrar pasos ya generados.
export const HERO_SCALE = {
  halley: { nombre: 'Feneco', tipo: 'Héroe · bípedo pequeño', height: 1.00, radius: 0.28, glb: 'halley.glb', yaw: 0, notas: 'El más pequeño del grupo.' },
  nilo:   { nombre: 'Nutria', tipo: 'Héroe · bípedo pequeño', height: 1.50, radius: 0.33, glb: 'nilo.glb', yaw: 0, notas: 'La cola larga añade longitud.' },
  ambar:  { nombre: 'Águila', tipo: 'Héroe · ave', height: 1.60, radius: 0.34, glb: 'ambar.glb', yaw: 0, notas: 'Altura corporal 1,60 m; las alas del modelo dan la envergadura y la presencia.' },
  lira:   { nombre: 'Lince', tipo: 'Héroe · bípedo', height: 1.65, radius: 0.35, glb: 'lira.glb', yaw: 0, notas: 'Ágil y estilizado.' },
  kyra:   { nombre: 'Zorra Ártica', tipo: 'Héroe · bípedo', height: 1.75, radius: 0.38, glb: 'kyra.glb', yaw: 0, notas: 'Las colas aumentan el volumen visual.' },
  jago:   { nombre: 'Jaglion', tipo: 'Héroe · felino', height: 1.80, radius: 0.40, glb: 'jago.glb', yaw: 0, notas: 'El héroe más imponente por constitución y postura, aunque no sea el más alto.' },
  kairo:  { nombre: 'Dragón de Komodo', tipo: 'Héroe · reptil', height: 1.90, radius: 0.42, glb: 'kairo.glb', yaw: 0, notas: 'El más alto, robusto y muy largo. El modelo entregado es erguido: su longitud es corta (ver tabla).' },
};

// Jefes de zona. `radius` = media anchura del cuerpo sobre el suelo (para alcances, cargas y ondas).
// `fly` = altura del vuelo (m) si el jefe vuela.
export const BOSS_SCALE = {
  medusa:    { nombre: 'Medusa', tipo: 'Jefe · humanoide', height: 2.4, radius: 0.9, glb: 'medusa.glb', yaw: 0, notas: '' },
  cerbero:   { nombre: 'Cerbero', tipo: 'Jefe · cuadrúpedo', height: 3.0, radius: 2.0, glb: 'kerberos.glb', yaw: 0, notas: 'Altura hasta la cabeza; cuerpo largo y voluminoso.' },
  basilisco: { nombre: 'Basilisco', tipo: 'Jefe · reptil largo', height: 3.0, radius: 2.2, glb: 'basilisco.glb', yaw: 0, notas: 'Bajo y muy largo.' },
  minotauro: { nombre: 'Minotauro', tipo: 'Jefe · bípedo', height: 3.2, radius: 1.1, glb: 'minotauro.glb', yaw: 0, notas: '' },
  fenrir:    { nombre: 'Fenrir', tipo: 'Jefe · cuadrúpedo', height: 3.8, radius: 2.2, glb: 'fenrir.glb', yaw: 0, notas: 'Enorme por volumen, altura al lomo y longitud.' },
  long:      { nombre: 'Dragón Long', tipo: 'Jefe · dragón volador', height: 4.0, radius: 1.4, glb: 'long.glb', yaw: 0, fly: 2.0, notas: 'Vuela; el modelo entregado es un dragón enroscado (poca longitud).' },
  kraken:    { nombre: 'Kraken', tipo: 'Jefe · cefalópodo', height: 5.5, radius: 1.9, glb: 'kraken.glb', yaw: 0, notas: 'Cuerpo visible 5–6 m; los tentáculos del modelo dan alcance.' },
  // Jefe final de Apocalia: sin modelo GLB (procedural). PROPUESTA NUEVA — no está en la tabla del prompt.
  cataclismo: { nombre: 'El Cataclismo', tipo: 'Jefe final · elemental', height: 4.6, radius: 1.7, glb: null, yaw: 0, notas: 'Propuesta: no figuraba en la tabla del prompt.' },
};

// Aliados no jugables. PROPUESTA NUEVA: Voya no figuraba en la tabla del prompt.
export const ALLY_SCALE = {
  voya: { nombre: 'Voya', tipo: 'Aliada · felino', height: 1.7, radius: 0.5, glb: 'voya.glb', yaw: 0, notas: 'Propuesta: algo mayor que los héroes medianos, menor que un jefe.' },
};

// Los ids de jefe del juego (levels.js) → clave de la tabla.
export const BOSS_KEY = { kerberos: 'cerbero' };
export const bossScale = (kind) => BOSS_SCALE[BOSS_KEY[kind] || kind];

// Cámara por héroe: más cerca con los pequeños y más lejos con los grandes (el jugador puede ajustar con el zoom).
export function cameraFor(height) {
  return { dist: 3.6 + 2.0 * height, aim: 0.85 * height + 0.05 };
}

// Cámara en un combate de jefe: aleja lo justo para ver al héroe y buena parte del jefe.
export function bossCameraFor(heroH, bossH) {
  const base = cameraFor(heroH);
  return { dist: Math.min(11.5, Math.max(base.dist, base.dist + (bossH - 1.6) * 1.15)), aim: base.aim + Math.min(1.2, bossH * 0.14) };
}

export const heroScale = (id) => HERO_SCALE[id];
export const modelUrl = (file) => (file ? MODEL_DIR + file : null);
