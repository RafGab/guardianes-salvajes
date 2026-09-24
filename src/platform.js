// Detección de plataforma: ?touch=1 fuerza el modo táctil (para probar en escritorio), ?desktop=1 lo desactiva
const q = new URLSearchParams(location.search);
const detected = typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 1);
export const IS_TOUCH = q.has('touch') ? q.get('touch') !== '0' : q.has('desktop') ? false : detected;
if (typeof document !== 'undefined') document.documentElement.classList.toggle('touch', IS_TOUCH);
