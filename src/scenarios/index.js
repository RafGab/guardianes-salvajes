import * as flood from './flood.js';
import * as fire from './cenizara.js'; // Cenizara rediseñada (el bosque anterior sigue en forest.js)
import * as campfire from './campfire.js';
import * as quake from './town.js';
import * as rockslide from './rockslide.js'; // Rockslide: avalancha de roca en Pedregal
import * as hurricane from './coast.js';
import * as sandstorm from './desert.js';
import * as ice from './alpine.js';
import * as extreme from './valley.js';

// Registro de escenarios: cada nivel usa un escenario 3D propio
export const SCENARIOS = { campfire, flood, fire, quake, rockslide, hurricane, sandstorm, ice, extreme };
