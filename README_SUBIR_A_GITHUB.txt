CÓMO SUBIR ESTA CARPETA A GITHUB
=================================

Sube TODO el contenido de esta carpeta a la raíz de tu repositorio
(junivalles-cmd.github.io), no dentro de una subcarpeta.

⚠ DOS ARCHIVOS QUE SE OLVIDAN CON FACILIDAD
--------------------------------------------
Windows y Mac OCULTAN los archivos que empiezan con punto, así que al arrastrar
al navegador es fácil dejarlos fuera sin darse cuenta:

   .nojekyll              (archivo vacío, pero imprescindible)
   .well-known/           (carpeta con assetlinks.json adentro)

Sin ellos, el código QR abre el navegador en vez de la app instalada.

CÓMO VER LOS ARCHIVOS OCULTOS
------------------------------
Windows:  en el Explorador → pestaña "Vista" → marcar "Elementos ocultos"
Mac:      en Finder → presionar Cmd + Shift + punto

CÓMO COMPROBAR QUE QUEDÓ BIEN
------------------------------
Abre esta dirección en el navegador:

   https://junivalles-cmd.github.io/.well-known/assetlinks.json

Si ves un texto que empieza con [{"relation":  → está correcto.
Si ves "404" o "File not found"  → falta subir .nojekyll o la carpeta .well-known.

También puedes comprobarlo desde la app: entra a cualquier equipo → Código QR →
botón "¿Por qué abre el navegador?".

DESPUÉS DE CORREGIRLO
----------------------
La verificación de Android se hace al INSTALAR la app. Si ya la tenías instalada
antes de subir estos archivos, desinstálala y vuelve a instalarla (con internet).
