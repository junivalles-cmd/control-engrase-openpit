# Librerías de terceros vendorizadas (lote "QR offline", auditoría pre-release)

Antes se cargaban desde CDN (`cdn.jsdelivr.net`) en cada arranque — si el
primer arranque de un dispositivo era sin conexión, el escáner/generador de
QR podía no estar disponible (ver `docs/BUG_REGISTER.md`). Ahora viven como
archivos locales dentro de la fuente canónica (`CONTROL_ENGRASE_WEB/
CONTROL_ENGRASE_WEB/vendor/`), se copian al build igual que cualquier otro
asset del proyecto (ver `vite.config.js` / `tools/runtime-file-set.mjs`) y
quedan precacheados por el Service Worker (`sw.js`, `ASSETS`) desde la
primera instalación — nunca se piden a Internet.

Mismas librerías, mismas versiones, mismo contenido que ya se usaba desde el
CDN — solo cambió de dónde se sirven. La API/los globals (`window.jsQR`,
`window.QRious`) y la forma en que `app.js` los usa NO cambiaron.

| Archivo | Librería | Versión | Origen | Licencia |
|---|---|---|---|---|
| `jsqr.js` | [jsQR](https://github.com/cozmo/jsQR) | 1.4.0 | `https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js` (idéntico al que se cargaba antes; es el archivo `main` real del paquete, sin build de minificación propio) | Apache-2.0 — texto completo en `LICENSE-jsqr-apache-2.0.txt` |
| `qrious.min.js` | [QRious](https://github.com/neocotic/qrious) | 4.0.2 | `https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js` (idéntico al que se cargaba antes; ya viene minificado por el propio proyecto, con su aviso de licencia en el encabezado del archivo) | GPL-3.0 — texto completo en `LICENSE-qrious-gpl-3.0.txt` |

No se modificó ni un byte de ninguno de los dos archivos respecto a lo que
servía el CDN — se descargaron tal cual para conservar exactamente el mismo
comportamiento.
