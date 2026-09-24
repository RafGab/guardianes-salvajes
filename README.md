# Guardianes Salvajes

Videojuego 3D (Three.js + Vite): héroes animales rescatan a personas y animales durante catástrofes naturales.

## Campaña (9 niveles, cada uno con su propio escenario 3D)
| Nivel | Catástrofe | Escenario | Recompensa |
|---|---|---|---|
| 1 | Inundación | Puerto Ribera: ciudad costera con río, puentes y puerto | 🪓 Hacha |
| 2 | Incendio forestal | Bosque Ámbar: montaña, caminos, zonas quemadas, refugios | 🪢 Cuerda |
| 3 | Terremoto | Villa Roca: pueblo dañado, canal seco, iglesia | 🔦 Linterna |
| 4 | Erupción | Monte Ceniza: volcán, pueblo, ríos de lava | 🛡️ Escudo |
| 5 | Huracán | Bahía Palma: costa, muelle, marejada, palmeras | 🌀 Viento |
| 6 | Tormenta de arena | Oasis Rojo: dunas, pueblo de adobe, oasis | 🥽 Gafas |
| 7 | Tormenta de hielo | Monte Blanco: lago helado, chalets, riscos | ⛏️ Piolet |
| 8 | Sequía | Valle Seco: embalse casi vacío, granjas | 💧 Cantimplora |
| 9 | Catástrofe extrema | Valle Titán: sismos + fuego + viento + crecida | ⭐ Estrella |

- Cada nivel se desbloquea al completar el anterior. El progreso (niveles, héroe, herramientas, puntos, insignias) se guarda en `localStorage`.
- Los rescates se generan al azar en cada partida (zonas, puntos válidos, sin colisiones y alcanzables).
- Las herramientas son habilidades **adicionales**: nunca sustituyen el poder del héroe. Cambia de habilidad con `1`-`9`, `Tab` o la barra táctil; `Q`/⚡ usa la seleccionada.
- La dificultad sube con las condiciones del entorno (velocidad del fenómeno, obstáculos, distancias, tiempo), no solo con más enemigos.

## Héroes
Yagua (Tierra), Vorak (Fuego), Coral y Nerea (Agua), Aurora (Hielo), Ámbar (Aire).

## Ejecutar
    npm install
    npm run dev   # http://127.0.0.1:5180

## Modelos realistas (GLB)
Ver `public/models/README.txt`. Los `.glb` de `public/models/` sustituyen a los modelos procedurales.
