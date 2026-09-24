import * as flood from './flood.js';
import * as fire from './forest.js';
import * as quake from './town.js';
import * as volcano from './volcano.js';
import * as hurricane from './coast.js';
import * as sandstorm from './desert.js';
import * as ice from './alpine.js';
import * as drought from './farm.js';
import * as extreme from './valley.js';

// Registro de escenarios: cada nivel usa un escenario 3D propio
export const SCENARIOS = { flood, fire, quake, volcano, hurricane, sandstorm, ice, drought, extreme };
