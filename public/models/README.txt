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

PERSONAJES CON ESQUELETO (rig) Y ANIMACIONES
  halley.glb ya lleva esqueleto de 42 huesos y 7 animaciones: idle, walk, run, swim, jump, power, cele.
  El juego las elige por el NOMBRE de la animación (src/heroes.js, clase GLBHero).
  Para animar otro héroe con el mismo rig: genera el GLB con rig desde Tripo/Blender, añade las animaciones
  y aligéralo con el comando de arriba (el ratio sigue siendo triángulos deseados / originales).
  kyra.glb (4 colas, hacha) también lleva esqueleto (63 huesos) y las mismas 7 animaciones.
  Herramienta para crear las animaciones de un rig nuevo: tools/make_anims.mjs
    (npm i @gltf-transform/core @gltf-transform/extensions; node tools/make_anims.mjs ENTRADA.glb SALIDA.glb;
     luego aligerar con el comando de arriba). Detecta colas (tail_N o tail_<color>_N), orejas (ear_L/R_N) y arma.
  jago.glb (Jaglioner: cola de 7 huesos, mochila, katana) también lleva esqueleto (40 huesos) y las 7 animaciones.

LOS 7 HÉROES YA TIENEN ESQUELETO Y ANIMACIONES (idle, walk, run, swim, jump, power, cele)
  Halley, Kyra y Jaglion: rigs hechos a mano (otra sesión); Nilo, Lira, Ámbar y Kairo: rigs generados con tools/rig.mjs.
  La CARA es rígida (tools/faceFix.mjs): los rasgos de la cara no se estiran al animar. Mallas ~35-45 mil triángulos,
  texturas WebP de 2048 para que la cara se vea nítida.
  Proceso completo de un personaje: tools/pipe.sh NOMBRE MODELO.glb ESPECIFICACION.json RATIO
    (ESPECIFICACION '-' si el GLB ya trae esqueleto). La especificación solo da la posición de cada articulación
    (ver tools/rigspec.js); el resto (jerarquía, pesos de piel, cara rígida, animaciones) es automático.

DISEÑOS DEFINITIVOS H2.5 MAX (Jaglion, Zorra Ártica, Lince, Komodo y Nutria)
  jago.glb, kyra.glb, lira.glb, kairo.glb y nilo.glb son los diseños nuevos (carpeta "H2.5 MAX"), con el mismo
  esqueleto de siempre (mismos nombres de huesos, ~33-62 huesos) y las 7 animaciones. Fénec (halley) y Águila (ambar)
  NO cambian. Posición de cada articulación: tools/rigspecs/NOMBRE.json. Proceso:
    gltf-transform optimize ORIGINAL.glb BAJO.glb --compress false --simplify true --simplify-ratio 0.09 --texture-compress webp --texture-size 2048
    node tools/rig.mjs BAJO.glb tools/rigspecs/NOMBRE.json RIG.glb
    node tools/make_anims.mjs RIG.glb ANIM.glb        (Zorra Ártica: TAIL_AMP=0.35, sus 5 colas son muy grandes)
    gltf-transform optimize ANIM.glb public/models/NOMBRE.glb --compress meshopt --simplify false --texture-compress webp --texture-size 2048
  La Zorra Ártica tiene 5 colas (tail_pink, tail_lblue, tail_orange, tail_blue, tail_navy); cada vértice de una cola
  pertenece solo a esa cola y los brazos no arrastran nada de detrás de la espalda (armMinZ en su especificación).
  Los nuevos modelos no traen armas pegadas: weapons/strip.json ya solo tiene la entrada del Fénec.

MODELOS TRIPO (noviembre 2026): LOS 7 HÉROES + VOYA
  Carpeta de origen: "JUEGO MATEO/imagenes para crear 3D/3D/HEROES" (AMBAR_EAGLE, BADA_FENNEC, DONA_BOBCAT, JAGLION,
  KAIRO_KOMODO, KYRA_WHITEFOX, NILO_OTTER, VOYA_LION; ~5 millones de triángulos y sin esqueleto).
  Sustituyen a ambar, halley, lira, jago, kairo, kyra y nilo (mismos nombres de archivo y de huesos) y VOYA, el
  octavo héroe jugable (león blanco del Éter), usa voya_leon.glb (voya.glb sigue siendo la aliada de Apocalia).
  Proceso de cada uno (unos 43 mil triángulos, texturas WebP 2048, ~1,5 MB):
    gltf-transform optimize ORIGEN.glb BAJO.glb --compress false --simplify true --simplify-ratio 0.009 --simplify-error 0.01 --texture-compress webp --texture-size 2048
    node tools/rig.mjs BAJO.glb tools/rigspecs/NOMBRE.json RIG.glb
    node tools/make_anims.mjs RIG.glb ANIM.glb      (Águila: WING_AMP=0.45 · Fénec: EAR_AMP=0.6)
    gltf-transform optimize ANIM.glb public/models/NOMBRE.glb --compress meshopt --simplify false --texture-compress webp --texture-size 2048
  Zorra Ártica: antes del rig se quita un trozo suelto que flotaba sobre la cabeza (86 triángulos).
  Las especificaciones (tools/rigspecs/*.json) pueden llevar "force": [{ "box": [x0,x1,y0,y1,z0,z1], "bone": "pack" }]
  para atar accesorios rígidos a un hueso (arma a la espalda del Fénec, mochila de la Nutria).
  Diferencias de diseño de los modelos nuevos: la Zorra Ártica tiene UNA cola (todos sus poderes salen de ella, con
  el color de cada poder); el Águila tiene las alas en los brazos y un ala plegada a su izquierda (wing_L_1..4);
  el Fénec lleva sus armas a la espalda como parte del modelo (weapons/strip.json ya no recorta nada).
  Dedos y falanges de manos y pies: los añade src/anatomy.js al cargar (carpo, metacarpo, 3 falanges por dedo…).
