// Compatibilidad: los niveles se definen ahora en levels.js
import { Save } from './save.js';
export { LEVELS, MISSIONS, LEVEL_TIPS, MISSION_TIPS } from './levels.js';
export const bestStars = (id) => Save.stars(id);
export const saveStars = () => {};
