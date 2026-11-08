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
| Halley (Fénec) | ⏳ Remolino de Arena | 🌪️ Haboob | 🪞 Espejismos | 🔫 Rifle | 👂 Vuelo de Orejas |
| Nilo (Nutria) | 💦 Botas Propulsoras | 🌊 Tsunami | 🌀 Maelstrom | 🪃 Bumerán | 💧 Blink Acuático |
| Kyra (Zorra Ártica, 6) | ❄️ Deslizamiento sobre Hielo | ☸️ Rueda de las Estaciones · 🌷 Primavera | 🌞 Solsticio | 🪓 Hacha | 🌌 Aurora Polar |
| Lira (Lince, 6) | 🌱 Raíces Impulsoras (quieta: Pilar de Tierra) | 🔴 Luna de Sangre | 🌘 Umbra · 🌑 Penumbra | 🏹 Ballesta | 👁️ Visión Especial |
| Ámbar (Águila) | 🚀 Carrera Supersónica | ⚡ Picado del Trueno | 🌪️ Tornados Envolventes | 🥏 Disco Futurista | 🦅 Garras de Viento |

Ámbar vuela con **doble salto** en el aire (Vuelo Libre, con vista aérea).

Números en `src/skills/config.js`, lógica en `src/skills/hero.js`, `src/skills/powers.js` y `src/skills/powers2.js`, efectos en `src/skills/vfx.js` y `src/skills/vfx2.js`. Los poderes especiales tienen sonidos sintetizados propios (`Audio3D.sfx`); el resto del juego sigue solo con la melodía.

## Ejecutar
    npm install
    npm run dev   # http://127.0.0.1:5180

## Modelos realistas (GLB)
Ver `public/models/README.txt`. Los `.glb` de `public/models/` sustituyen a los modelos procedurales.
