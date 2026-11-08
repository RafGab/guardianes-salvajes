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
- Cada habilidad tiene su propio botón: `1` el arma del héroe, `2`-`4` sus poderes especiales (la Zorra Ártica tiene `5`), y después las herramientas. Tecla o botón de la barra = usarla al momento; `Q`/⚡ repite la última, `Tab` cambia la seleccionada. Cada botón muestra los segundos de recarga y destella al estar listo.
- Las herramientas son habilidades **adicionales**: nunca sustituyen el poder del héroe.
- La dificultad sube con las condiciones del entorno (velocidad del fenómeno, obstáculos, distancias, tiempo), no solo con más enemigos.

## Héroes — CATAC 7
Lira (Lince · Tierra), Kairo (Komodo · Fuego), Jago (Jaglión · Roca), Halley (Fénec · Arena), Nilo (Nutria · Agua), Kyra (Zorro ártico · Hielo), Ámbar (Águila · Aire).

## Poderes especiales (además de saltar y del arma)
| Héroe | Poderes |
|---|---|
| Kairo (Komodo) | 🌋 Géiser · 🌑 Lava Negra · 👅 Lengua Camaleónica (lengua elástica de 32 articulaciones) |
| Lira (Lince) | 🌘 Umbra (eclipse solar) · 🌑 Penumbra (eclipse lunar) · 🔴 Luna de Sangre |
| Halley (Fénec) | 🌪️ Haboob · 🪞 Espejismos (vuelve a pulsar para saltar a una copia) · 👂 Vuelo de Orejas |
| Kyra (Zorra Ártica, 4 poderes) | 🍃 Cuatro Estaciones · ☸️ Rueda de las Estaciones · 🌌 Aurora Polar · 🌞 Solsticio de Verano |
| Jago (Jaglión) | 🥌 Transformación en Roca · 🪢 Cola Elástica (extensión, agarre, balanceo y trepado) · 🖤 Obsidiana |
| Ámbar (Águila) | ⚡ Picado del Trueno · 🦅 Vuelo Libre con vista aérea (su Ráfaga Celeste sigue siendo el arma) |
| Nilo (Nutria) | 💧 Blink Acuático · 🌊 Tsunami · 🌀 Maelstrom |

Números en `src/skills/config.js`, lógica en `src/skills/hero.js` y `src/skills/powers.js`, efectos en `src/skills/vfx.js` y `src/skills/vfx2.js`. Los poderes especiales tienen sonidos sintetizados propios (`Audio3D.sfx`); el resto del juego sigue solo con la melodía.

## Ejecutar
    npm install
    npm run dev   # http://127.0.0.1:5180

## Modelos realistas (GLB)
Ver `public/models/README.txt`. Los `.glb` de `public/models/` sustituyen a los modelos procedurales.
