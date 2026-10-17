MODELOS 3D DE CATAC 7
=====================
Aquí están los .glb de los personajes, ya aligerados para la web
(mallas ~18-35 mil triángulos, texturas WebP, compresión meshopt):

  Héroes: jago, kairo, lira, halley, nilo, kyra, ambar
  Jefes:  minotauro, kerberos, medusa, basilisco, kraken, fenrir, long
  Aliada: voya

TAMAÑOS: se definen en UN solo sitio, src/scale.js (1 unidad = 1 metro).
Cada modelo se normaliza (pies en el suelo, centrado, altura 1) y se escala
a la altura de esa tabla. Para cambiar el tamaño de un personaje, edita
solo su `height` (y `radius` si cambia su colisión) en scale.js.
Si un modelo mira hacia otro lado, ajusta su `yaw` (radianes) en scale.js.

Para reemplazar un modelo: copia el nuevo .glb con el mismo nombre. Si lo
generas en Tripo/Meshy con ~500 mil triángulos, aligéralo antes con:

  npx @gltf-transform/cli optimize ENTRADA.glb SALIDA.glb --compress meshopt \
      --simplify true --simplify-ratio 0.04 --simplify-error 0.02 \
      --texture-compress webp --texture-size 1024

(ratio = triángulos deseados / triángulos originales; 2048 de textura para jefes).

PRUEBA DE ESCALA: abre /escala.html (maniquí de 1,80 m, héroes, jefes,
cuadrícula métrica y tabla de medidas).
