MODELOS 3D REALISTAS (opcional)
================================
El juego usa modelos procedurales por defecto. Para usar modelos realistas
con el acabado de tus imagenes:

1. Sube cada imagen de referencia a una herramienta de imagen->3D
   (Meshy, Tripo, Hunyuan3D, Rodin...) y descarga el resultado como .glb.
   Si puede, pide un modelo con rig/animaciones (idle, run, swim, jump).
2. Copia los .glb en esta carpeta (public/models).
3. Edita manifest.json. Ejemplo:

{
  "yagua":  { "file": "yagua.glb",  "height": 1.85, "yaw": 0 },
  "ambar":  { "file": "ambar.glb",  "height": 1.9,  "yaw": 0 },
  "vorak":  { "file": "vorak.glb",  "height": 2.0,  "yaw": 0 },
  "nerea":  { "file": "nerea.glb" },
  "coral":  { "file": "coral.glb",  "height": 1.6 },
  "aurora": { "file": "aurora.glb" }
}

- height: altura del modelo en metros (por defecto 1.85).
- yaw: giro en radianes si el modelo mira hacia otro lado (3.1416 = media vuelta).
- Si el GLB trae animaciones, se eligen por nombre (idle, run/walk, swim,
  jump, celebrate, power). Si no, el juego anade inclinacion y rebote.
Recarga la pagina y el heroe aparece con el modelo nuevo.
