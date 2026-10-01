MODELOS 3D REALISTAS (opcional)
================================
El juego usa modelos procedurales por defecto (capsulas/esferas). Para que
los heroes se vean con el acabado de las fichas de personaje, hace falta
reemplazarlos por modelos .glb reales:

1. Sube la imagen de referencia de cada heroe a una herramienta de
   imagen->3D (Tripo3D, Meshy, Hunyuan3D, Rodin...). Tripo3D y Meshy
   tienen nivel gratis. Usa la pose de cuerpo entero, de frente, sin
   otros personajes en la imagen (las fichas completas con varias poses
   confunden a estas herramientas: recorta solo la pose principal).
   Pide la opcion "Smart Mesh" / lista para videojuego, con rigging
   automatico si esta disponible, y exporta como .glb.
2. Copia los .glb en esta carpeta (public/models), con el nombre del
   heroe: jago.glb, kairo.glb, lira.glb, halley.glb, nilo.glb, kyra.glb,
   ambar.glb.
3. Edita manifest.json. Ejemplo:

{
  "jago":   { "file": "jago.glb",   "height": 1.85, "yaw": 0 },
  "kairo":  { "file": "kairo.glb",  "height": 2.0,  "yaw": 0 },
  "lira":   { "file": "lira.glb",   "height": 1.7 },
  "halley": { "file": "halley.glb", "height": 1.3 },
  "nilo":   { "file": "nilo.glb",   "height": 1.6 },
  "kyra":   { "file": "kyra.glb",   "height": 1.85 },
  "ambar":  { "file": "ambar.glb",  "height": 1.9 }
}

No hace falta poner los 7 a la vez: el que no tenga entrada en el
manifiesto sigue usando el modelo procedural normalmente.

- height: altura del modelo en metros (por defecto 1.85). Halley (fenec)
  es el heroe mas bajo del grupo: usa una altura menor para que se note.
- yaw: giro en radianes si el modelo mira hacia otro lado (3.1416 = media vuelta).
- Si el GLB trae animaciones, se eligen por nombre (idle, run/walk, swim,
  jump, celebrate, power). Si no, el juego anade inclinacion y rebote
  automaticamente, asi que funciona igual sin animaciones.
Recarga la pagina y el heroe aparece con el modelo nuevo.
