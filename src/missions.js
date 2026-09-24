// Definición de las misiones de la campaña
export const MISSIONS = [
  {
    id: 'flood', scenario: 'flood', icon: '🌊', kicker: 'MISIÓN 1', name: 'Inundación en Ciudad Ribera',
    desc: 'Llueve sin parar y el agua sube por las calles. Rescata a las personas y los animales atrapados y llévalos al refugio de la colina.',
    time: 360, best: ['agua', 'aire', 'hielo'], gauge: 'AGUA', threat: 'Agua',
    intro: '🌧️ ¡ALERTA DE INUNDACIÓN!', introSub: 'Rescata a todos y llévalos al refugio de la colina',
    failTitle: 'El agua ha cubierto la ciudad',
  },
  {
    id: 'fire', scenario: 'fire', icon: '🔥', kicker: 'MISIÓN 2', name: 'Incendio en el Bosque Ámbar',
    desc: 'Un incendio forestal avanza entre los pinos. Evita las llamas, encuentra a los animales y excursionistas y sácalos del bosque.',
    time: 330, best: ['agua', 'hielo', 'fuego'], gauge: 'FUEGO', threat: 'Fuego',
    intro: '🔥 ¡INCENDIO FORESTAL!', introSub: 'Evita las llamas y lleva a todos a la zona segura',
    failTitle: 'El fuego ha devorado el bosque',
  },
  {
    id: 'quake', scenario: 'quake', icon: '🏚️', kicker: 'MISIÓN 3', name: 'Terremoto en Villa Roca',
    desc: 'La tierra tiembla y caen escombros. Busca rutas seguras entre los edificios dañados y rescata a los atrapados antes de la siguiente réplica.',
    time: 330, best: ['aire', 'tierra'], gauge: 'SISMO', threat: 'Sismo',
    intro: '🏚️ ¡TERREMOTO!', introSub: 'Cuidado con los escombros y las réplicas',
    failTitle: 'Las réplicas han bloqueado la ciudad',
  },
  {
    id: 'ice', scenario: 'ice', icon: '❄️', kicker: 'MISIÓN 4', name: 'Tormenta de hielo en Monte Blanco',
    desc: 'Nieve, viento y poca visibilidad. El suelo resbala y el frío aprieta: calienta junto a las hogueras y ayuda a los animales a llegar al refugio.',
    time: 340, best: ['fuego', 'hielo'], gauge: 'FRÍO', threat: 'Frío',
    intro: '❄️ ¡TORMENTA DE HIELO!', introSub: 'Abrígate junto a las hogueras y rescata a todos',
    failTitle: 'La ventisca ha cubierto el pueblo',
  },
];

export const MISSION_TIPS = {
  fire: {
    start: 'Si encuentras un incendio forestal, aléjate de la zona y avisa a los servicios de emergencia (112).',
    smoke: 'El humo es peligroso: agáchate, cúbrete la nariz y la boca con un paño y aléjate en sentido contrario al viento.',
    never: 'Nunca tires colillas ni vidrios, ni hagas fuego en el monte: casi todos los incendios los provocan las personas.',
    wildlife: 'Los animales huyen del fuego. Avisar a los bomberos y dejarles caminos libres les ayuda a sobrevivir.',
    forest: 'Los bosques limpian el aire y guardan agua. Cuidarlos ayuda a proteger el planeta.',
    heat: 'No intentes cruzar las llamas: el calor y el humo son más peligrosos de lo que parece.',
    wind: 'El viento hace que el fuego avance más rápido. Aléjate siempre en sentido contrario a él.',
  },
  quake: {
    start: 'Durante un terremoto, aléjate de ventanas y objetos que puedan caer.',
    dropcover: 'Agáchate, cúbrete la cabeza y agárrate a algo firme hasta que pase el temblor.',
    elevator: 'No uses el ascensor durante ni después de un terremoto: usa las escaleras.',
    aftershock: 'Después de un terremoto puede haber réplicas. Sal con calma a un espacio abierto, lejos de edificios.',
    gas: 'Si hueles a gas o ves chispas, aléjate y avisa al 112. No enciendas cerillas ni luces.',
    rubble: 'No te acerques a edificios dañados ni muevas escombros grandes: pide ayuda a los servicios de rescate.',
  },
  ice: {
    start: 'En una tormenta de nieve, busca refugio y abrígate por capas para conservar el calor.',
    visibility: 'Con poca visibilidad no te alejes del grupo ni de los caminos que conoces.',
    ice: 'Camina despacio sobre hielo y nieve compactada: resbala más de lo que parece.',
    cold: 'El frío extremo es peligroso: si tienes los dedos dormidos o tiritas mucho, busca calor enseguida.',
    animals: 'Los animales buscan refugio del frío. Si ves uno, avisa a un adulto y no lo toques.',
    climate: 'Los glaciares y la nieve guardan agua dulce. Cuidar el clima los protege.',
    co: 'Nunca uses braseros ni estufas de carbón en un lugar cerrado: producen un gas peligroso.',
  },
};

export function bestStars(id) {
  try { return Number(localStorage.getItem('gs_stars_' + id) || 0); } catch (e) { return 0; }
}
export function saveStars(id, stars) {
  try { if (stars > bestStars(id)) localStorage.setItem('gs_stars_' + id, String(stars)); } catch (e) { /* sin almacenamiento */ }
}
