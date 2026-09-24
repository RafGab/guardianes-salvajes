import { LEVELS } from './levels.js';
import { ELEMENTS } from './heroes.js';

// Herramientas y mejoras desbloqueables. Cada una es una habilidad ADICIONAL: nunca sustituye al poder del héroe.
export const ITEMS = {
  axe: { id: 'axe', icon: '🪓', name: 'Hacha de rescate', cd: 0.8,
    desc: 'Un hacha ligera y resistente, pensada para abrir paso en emergencias.',
    func: 'Corta ramas, tablones y troncos que bloquean el camino o atrapan a alguien.' },
  rope: { id: 'rope', icon: '🪢', name: 'Cuerda de rescate', cd: 2.5,
    desc: 'Una cuerda con gancho para llegar a zonas elevadas.',
    func: 'Lanza el gancho al saliente más cercano y te sube. También baja a quien esté en un lugar alto.' },
  flashlight: { id: 'flashlight', icon: '🔦', name: 'Linterna especial', cd: 5,
    desc: 'Una linterna de gran alcance que atraviesa la oscuridad y el polvo.',
    func: 'Ilumina el frente y revela a las personas y animales ocultos cerca.' },
  shield: { id: 'shield', icon: '🛡️', name: 'Escudo elemental', cd: 10,
    desc: 'Una burbuja de energía que envuelve al héroe.',
    func: 'Te protege unos segundos del calor, la lava, los escombros y las ráfagas.' },
  wind: { id: 'wind', icon: '🌀', name: 'Poder de viento', cd: 4,
    desc: 'Una ráfaga controlada creada con el aliento del huracán.',
    func: 'Despeja lonas, arena, ceniza y nieve suelta, y aparta objetos ligeros.' },
  goggles: { id: 'goggles', icon: '🥽', name: 'Gafas de tormenta', cd: 14,
    desc: 'Lentes especiales que filtran polvo, arena y niebla.',
    func: 'Reducen la niebla durante unos segundos y marcan a quien necesita ayuda.' },
  piolet: { id: 'piolet', icon: '⛏️', name: 'Piolet de escalada', cd: 12,
    desc: 'Un piolet con crampones para paredes y hielo.',
    func: 'Permite trepar paredes altas y evita resbalar durante unos segundos.' },
  canteen: { id: 'canteen', icon: '💧', name: 'Cantimplora de rescate', cd: 5,
    desc: 'Una cantimplora que nunca se acaba y refresca a cualquiera.',
    func: 'Refresca al héroe y da de beber a animales y personas sedientas.' },
  star: { id: 'star', icon: '🌟', name: 'Estrella Guardiana', cd: 0, passive: true,
    desc: 'La insignia de los verdaderos guardianes del planeta.',
    func: 'Mejora permanente: recargas un 25 % más rápidas y +1 de capacidad de carga.' },
};

for (const l of LEVELS) if (ITEMS[l.reward]) ITEMS[l.reward].level = l.n;

export function heroPowerItem(hero) {
  const el = ELEMENTS[hero.element];
  return { id: 'power', icon: el.icon, name: hero.power.name, desc: hero.bio, func: hero.power.desc, cd: hero.power.cd, level: 0, base: true };
}
