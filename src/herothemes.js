/* ======================================================================
   IDENTIDAD DE COLOR Y ESCENARIO DE CADA GUARDIÁN (pantalla de selección)
   Asignación fijada por Viviana: Jaglion naranja · Kairo verde · Ámbar dorado · Bada morado · Kyra rosa ·
   Dona azul · Nilo rojo · Voya cyan. La usan las tarjetas, la ficha y el escenario 3D (src/herostage.js).
   c: color principal · c2: segundo tono del ambiente · deep: tono oscuro del fondo
   mode: escenario (0 fuego y brasas · 1 selva · 2 energía solar · 3 místico · 4 cristal rosa ·
         5 acuático · 6 energía carmesí · 7 cristal cyan)
   ====================================================================== */
export const HERO_THEME = {
  jago:   { c: '#ff7a1a', c2: '#ffb21e', deep: '#3a1204', mode: 0, label: 'Fuego y brasas' },
  kairo:  { c: '#18d877', c2: '#7dff5a', deep: '#03281a', mode: 1, label: 'Selva esmeralda' },
  ambar:  { c: '#ffc21a', c2: '#fff0a0', deep: '#3a2604', mode: 2, label: 'Energía solar' },
  halley: { c: '#a24bff', c2: '#e05cff', deep: '#1c0638', mode: 3, label: 'Neblina mística' },
  kyra:   { c: '#ff4fb4', c2: '#ffc0e6', deep: '#3a0626', mode: 4, label: 'Cristal rosa' },
  lira:   { c: '#2f7dff', c2: '#38d0ff', deep: '#041840', mode: 5, label: 'Profundidad acuática' },
  nilo:   { c: '#ff2638', c2: '#ff7a3a', deep: '#3a040a', mode: 6, label: 'Energía carmesí' },
  voya:   { c: '#1ee3ee', c2: '#36ffc8', deep: '#03303a', mode: 7, label: 'Cristal de éter' },
};
const FALLBACK = { c: '#9fc0ff', c2: '#c6e0ff', deep: '#0a1430', mode: 7, label: '' };
export const heroTheme = (id) => HERO_THEME[id] || FALLBACK;
