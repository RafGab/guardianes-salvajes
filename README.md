# CATAC 7

Videojuego 3D (Three.js + Vite): 7 guardianes animales elementales rescatan a personas y animales durante catástrofes naturales.

## Campaña (9 niveles, cada uno con su propio escenario 3D, territorio y jefe de CATAC 7)
| Nivel | Territorio | Catástrofe y ciudad | Jefe | Recompensa |
|---|---|---|---|---|
| 1 | 💧 Agua | Inundación en Náufora | 🐙 Kraken | 🪓 Hacha |
| 2 | 🔥 Fuego | Incendio en Cenizara | 🐕‍🦺 Kerberos | 🪢 Cuerda |
| 3 | 🌍 Tierra | Terremoto en Sismara | 👹 Minotauro | 🔦 Linterna |
| 4 | 🪨 Roca | Erupción en Rocavara | 🐍 Medusa | 🛡️ Escudo |
| 5 | 💨 Aire | Huracán en Huravela | 🐲 Long | 🌀 Viento |
| 6 | 🏜️ Arena | Haboob en Haboura | 🐉 Basilisco | 🥽 Gafas |
| 7 | ❄️ Hielo | Avalancha en Nivoria | 🐺 Fenrir | ⛏️ Piolet |
| 8 | 💧 Agua | Sequía extrema en Aridalia | — | 💧 Cantimplora |
| 9 | ☄️ Apocalia | Valle Titán: todos los elementos a la vez | ☄️ El Cataclismo (+ 🦁 Voya) | ⭐ Estrella |

- Cada nivel se desbloquea al completar el anterior. El progreso (niveles, héroe, herramientas, puntos, insignias) se guarda en `localStorage`.
- Los rescates se generan al azar en cada partida (zonas, puntos válidos, sin colisiones y alcanzables).
- Botones de cada héroe, siempre en este orden: `1` **Velocidad** · `2` **Poder principal** · `3` **Escudo** · `4` **Arma** · `5` **Especial** (Kyra tiene dos ataques y Lira dos escudos: 6 botones). Tecla o botón = usarla al momento; `Q` repite la última. Cada botón muestra su papel, los segundos de recarga y destella al estar listo. Las herramientas ganadas en los niveles van en un grupo aparte, detrás de la raya.
- Las herramientas son habilidades **adicionales**: nunca sustituyen el poder del héroe.
- La dificultad sube con las condiciones del entorno (velocidad del fenómeno, obstáculos, distancias, tiempo), no solo con más enemigos.

## Héroes — CATAC 7
Lira (Lince · Tierra), Kairo (Komodo · Fuego), Jago (Jaglión · Roca), Halley (Fénec · Arena), Nilo (Nutria · Agua), Kyra (Zorro ártico · Hielo), Ámbar (Águila · Aire).

## Botones de los héroes
| Héroe | 1 Velocidad | 2 Poder | 3 Escudo | 4 Arma | 5 Especial |
|---|---|---|---|---|---|
| Jago (Jaglión, líder) | 🪨 Embestida Pétrea | 🖤 Obsidiana | 🥌 Transformación en Roca | 🗡️ Katana | 🪢 Cola Elástica |
| Kairo (Komodo) | 🔥 Propulsión de Fuego | 🌑 Lava Negra | 🌋 Géiser | 🔨 Martillo | 👅 Lengua Camaleónica |
| Halley (Fénec) | ⏳ Remolino de Arena | 🌪️ Haboob | 🪞 Espejismos | 🔱 Lanza morada | 👂 Vuelo de Orejas |
| Nilo (Nutria) | 💦 Botas Propulsoras | 🌊 Tsunami | 🌀 Maelstrom | 🪃 Bumerán | 💧 Blink Acuático |
| Kyra (Zorra Ártica, 6) | ❄️ Deslizamiento sobre Hielo | ☸️ Rueda de las Estaciones · 🌷 Primavera | 🌞 Solsticio | 🪓 Hacha | 🌌 Aurora Polar |
| Lira (Lince, 6) | 🌱 Raíces Impulsoras (quieta: Pilar de Tierra) | 🔴 Luna de Sangre | 🌘 Umbra · 🌑 Penumbra | ⚡ Guadaña | 👁️ Visión Especial |
| Ámbar (Águila) | 🚀 Carrera Supersónica | ⚡ Picado del Trueno | 🌪️ Tornados Envolventes | 🥏 Dos Discos | 🦅 Garras de Viento |

Ámbar vuela con **doble salto** en el aire (Vuelo Libre, con vista aérea).

Números en `src/skills/config.js`, lógica en `src/skills/hero.js`, `src/skills/powers.js` y `src/skills/powers2.js`, efectos en `src/skills/vfx.js` y `src/skills/vfx2.js`. Los poderes especiales tienen sonidos sintetizados propios (`Audio3D.sfx`); el resto del juego sigue solo con la melodía.

## Armas 3D
Cada héroe lleva **solo su arma**, modelada en 3D a partir de las imágenes de referencia (`src/weapons/models.js`):
Jaglion · Katana · Kyra · Hacha de cristal · Kairo · Martillo de esmeralda · Ámbar · Dos discos · Lira · Guadaña de rayo · Nilo · Bumerán · Halley · Lanza morada.
- **Empieza guardada.** El botón **4 · ARMA** la saca (se materializa en la mano con un destello) y ataca; si ya está fuera, ataca.
- **Guardarla:** tecla **G** o mantener pulsado el botón ARMA (también se guarda sola tras 20 s sin usarla, y se oculta al nadar). Al cambiar de héroe, la del anterior desaparece.
- **Agarre real:** el arma cuelga del hueso de la palma (metacarpo) y su mango pasa por el centro del puño, a lo ancho de la mano y saliendo por el lado del pulgar; los dedos se cierran sobre él. Cada arma tiene su propio esqueleto (huesos `w_*`) y los discos y el bumerán giran por su hueso.
- **Guardia y defensa:** con el arma fuera, cada héroe adopta su guardia (hombro, codo, muñeca y giro del antebrazo). Con el botón de escudo pasa a una postura de defensa y vuelve a la guardia con suavidad.
- **Combos de 3 movimientos** (pulsar ARMA otra vez mientras se recupera del golpe), distintos para cada arma:
  Katana: tajo diagonal → revés → estocada a fondo · Hacha: hachazo → barrido → torbellino de hielo · Martillo: martillazo → barrido lateral → salto y golpe al suelo · Guadaña: barrido con onda → revés amplio → siega en giro · Lanza: estocada con proyección → doble estocada → embestida · Bumerán: a la derecha → a la izquierda → lanzamiento potente · Discos: derecho → izquierdo → los dos a la vez.
  Cada movimiento tiene preparación, golpe y recuperación, y enlaza con el siguiente sin cortes. Los dos primeros golpes recargan rápido; el tercero cierra el combo con un remate.
- **Neón permanente:** materiales emisivos que laten, halos (resplandor también sin bloom), chispas, relámpagos y una luz propia.
- **Al atacar:** estela luminosa con los colores del arma, partículas de energía y destello en cada impacto. El bumerán y el disco que se lanzan son el arma de verdad (desaparece de la mano mientras vuela y vuelve).
- **Con otras habilidades** (con el arma fuera): ráfaga de energía propia de cada arma (fuego y rayo, hielo, esmeraldas, aros de fuego, rayos, agua, cristales violetas).
- Las armas que venían incrustadas en los modelos GLB (katana, hacha, lanza a la espalda y bumerán) se quitan de la malla al cargar (`src/weapons/strip.json`).

Lógica en `src/weapons/system.js`; ataques en `src/skills/powers2.js`; números en `src/skills/config.js`.

## Esqueleto de manos y pies
Al cargar cada héroe (`src/anatomy.js`) se completa su esqueleto:
- **Mano:** carpo (muñeca) → metacarpo (palma) → índice, corazón, anular y meñique con falange proximal, media y distal; el **pulgar solo con proximal y distal**.
- **Pie:** tarso → metatarso; dedo gordo **solo con proximal y distal**; los otros cuatro con proximal, media y distal.
- La piel de manos y pies se reparte entre los huesos nuevos con transiciones suaves (la forma en reposo no cambia). Los dedos se cierran sobre el arma y los de los pies se doblan al despegar del suelo.
- Se corrigen los pesos cruzados de los rigs automáticos (mano o ala mezcladas con cadera o pierna), que estiraban la malla como varillas (las alas de Ámbar).
- Las manos de los modelos son puños o guantes de una pieza: los huesos cierran y articulan esa forma, pero no separan dedos que la malla no tiene.

## Vida, escudo y mochila
- **Vida del héroe** (100): barra permanente bajo el nombre (verde > 60 %, amarilla 30–60 %, roja < 30 %). Se pierde con los golpes del jefe y sus esbirros y con los peligros del escenario (escombros de las réplicas, objetos que vuelan, rocas volcánicas, fuego, lava). A 0: derrota. Se guarda por héroe; si cae, vuelve con la vida completa.
- **Escudo**: el 🛡️ Escudo elemental y el botón 3 de cada héroe (mientras está activo) bloquean los golpes y muestran «BLOQUEADO».
- **NPC hostiles** con vida y barra: Esbirro (12) y Bruto (34, fase final del jefe). Al caer pueden soltar una bebida o un botiquín amarillo.
- **Jefes**: barra especial con nombre, título y fases; vida +6 % por nivel (Minotauro 100 … Cataclismo 281).
- **Destructibles**: los poderes y armas rompen escombros del terremoto y obstáculos de madera (ramas, tablones, troncos). Los montones de arena/ceniza siguen necesitando viento.
- **Mochila** (botón 🎒 o tecla **B**): 🥤 bebida +20, botiquín +50, amarillo 25 %, azul 50 %, rojo 75 %, verde 100 % (de la vida máxima). Máximo 3 de cada tipo, almacenamientos independientes; si está lleno, el objeto se queda en el suelo. Nunca se consume con la vida completa.
- Cada nivel reparte 12 objetos (uno o dos cerca del jefe) y 2 más dentro de la arena. Los recogidos no vuelven a aparecer.

Valores en `src/skills/config.js` (`HEALTH`, `HEAL_ITEMS`, `PICKUP_SPAWN`, `NPC_KINDS`, `DESTRUCTIBLE`); lógica en `src/game.js`, `src/health.js` y `src/pickups.js`.

## Ejecutar
    npm install
    npm run dev   # http://127.0.0.1:5180

## Modelos realistas (GLB)
Ver `public/models/README.txt`. Los `.glb` de `public/models/` sustituyen a los modelos procedurales.
