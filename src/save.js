import { LEVELS } from './levels.js';

const KEY = 'gs_save_v2';

const DEFAULT = () => ({
  version: 2,
  completed: 0, // niveles completados en orden (0..9)
  stars: {}, // estrellas por nivel
  items: [], // ids de herramientas obtenidas (en orden de desbloqueo)
  hero: 'jago',
  team: [], // último equipo elegido para los jefes
  score: 0,
  people: 0,
  animals: 0,
  eco: 0,
  badges: [],
  bestScore: {},
});

const BADGES = {
  first: { id: 'first', icon: '🥇', name: 'Primer rescate', test: (s) => s.people + s.animals >= 1 },
  animals10: { id: 'animals10', icon: '🐾', name: 'Amigo de los animales', test: (s) => s.animals >= 10 },
  people20: { id: 'people20', icon: '❤️', name: 'Corazón valiente', test: (s) => s.people >= 20 },
  eco100: { id: 'eco100', icon: '🌱', name: 'Guardián ecológico', test: (s) => s.eco >= 100 },
  levels5: { id: 'levels5', icon: '🏅', name: 'Héroe veterano', test: (s) => s.completed >= 5 },
  master: { id: 'master', icon: '🏆', name: 'Maestro del rescate', test: (s) => s.completed >= 9 },
  stars: { id: 'stars', icon: '⭐', name: 'Tres estrellas', test: (s) => Object.values(s.stars).some((v) => v >= 3) },
};
export { BADGES };

let data = DEFAULT();
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* sin almacenamiento */ }
}

export const Save = {
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) data = { ...DEFAULT(), ...JSON.parse(raw) };
    } catch (e) { data = DEFAULT(); }
    return data;
  },
  get data() { return data; },
  get completed() { return data.completed; },
  isUnlocked(n) { return n <= 1 || data.completed >= n - 1; },
  hasItem(id) { return data.items.includes(id); },
  get items() { return data.items; },
  get hero() { return data.hero; },
  setHero(id) { data.hero = id; persist(); },
  get team() { return data.team || []; },
  setTeam(ids) { data.team = ids.slice(); persist(); },
  stars(levelId) { return data.stars[levelId] || 0; },
  toolSet() { return new Set(data.items); },

  // Devuelve { newReward, unlockedNext, newBadges }
  completeLevel(level, stats) {
    const res = { newReward: false, unlockedNext: false, newBadges: [], reward: level.reward };
    if (stats.stars > (data.stars[level.id] || 0)) data.stars[level.id] = stats.stars;
    data.score += stats.score;
    data.people += stats.people;
    data.animals += stats.animals;
    data.eco += stats.eco;
    data.bestScore[level.id] = Math.max(data.bestScore[level.id] || 0, stats.score);
    if (stats.success) {
      if (level.n > data.completed) {
        data.completed = level.n;
        res.unlockedNext = level.n < LEVELS.length;
      }
      if (level.reward && !data.items.includes(level.reward)) {
        data.items.push(level.reward);
        res.newReward = true;
      }
    }
    for (const b of Object.values(BADGES)) {
      if (!data.badges.includes(b.id) && b.test(data)) {
        data.badges.push(b.id);
        res.newBadges.push(b);
      }
    }
    persist();
    return res;
  },
  reset() {
    data = DEFAULT();
    persist();
  },
  // atajo para pruebas: desbloquea todo
  unlockAll() {
    data.completed = LEVELS.length;
    data.items = LEVELS.map((l) => l.reward);
    persist();
  },
};
Save.load();
