import { HEAL_ITEMS, HEAL_ORDER } from './skills/config.js';
import { Save } from './save.js';

// MOCHILA DE RECUPERACIÓN: cada tipo de objeto tiene su propio almacenamiento (capacidad independiente).
// Se guarda al instante en la partida para que no se pierda ni se duplique nada al cargar.
export class Bag {
  constructor() { this.load(); }
  load() {
    const saved = Save.bag;
    this.n = {};
    for (const k of HEAL_ORDER) this.n[k] = Math.max(0, Math.min(HEAL_ITEMS[k].cap, saved[k] || 0));
  }
  count(type) { return this.n[type] || 0; }
  cap(type) { return HEAL_ITEMS[type].cap; }
  full(type) { return this.count(type) >= this.cap(type); }
  // Guarda una unidad; devuelve false si ese almacenamiento está lleno
  add(type) {
    if (!HEAL_ITEMS[type] || this.full(type)) return false;
    this.n[type]++;
    Save.setBag(this.n);
    return true;
  }
  take(type) {
    if (this.count(type) <= 0) return false;
    this.n[type]--;
    Save.setBag(this.n);
    return true;
  }
}

// Puntos de vida que recupera un objeto según la vida máxima (nunca por encima del máximo)
export function healAmount(type, hp, max) {
  const it = HEAL_ITEMS[type];
  const raw = it.flat != null ? it.flat : Math.round(max * it.pct);
  return Math.max(0, Math.min(raw, max - hp));
}

// Color de la barra de vida: verde > 60 %, amarillo 30–60 %, rojo < 30 %
export function hpTier(pct) {
  return pct > 0.6 ? 'ok' : pct >= 0.3 ? 'mid' : 'low';
}
