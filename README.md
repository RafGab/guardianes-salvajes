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
- Las herramientas son habilidades **adicionales**: nunca sustituyen el poder del héroe. Cambia de habilidad con `1`-`9`, `Tab` o la barra táctil; `Q`/⚡ usa la seleccionada.
- La dificultad sube con las condiciones del entorno (velocidad del fenómeno, obstáculos, distancias, tiempo), no solo con más enemigos.

## Héroes — CATAC 7
Lira (Lince · Tierra), Kairo (Komodo · Fuego), Jago (Jaglión · Roca), Halley (Fénec · Arena), Nilo (Nutria · Agua), Kyra (Zorro ártico · Hielo), Ámbar (Águila · Aire).

## Ejecutar
    npm install
    npm run dev   # http://127.0.0.1:5180

## Modelos realistas (GLB)
Ver `public/models/README.txt`. Los `.glb` de `public/models/` sustituyen a los modelos procedurales.
