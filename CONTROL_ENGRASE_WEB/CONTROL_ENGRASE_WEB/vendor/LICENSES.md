# Librerías de terceros vendorizadas (lote "QR offline", auditoría pre-release; actualizado en el lote "QR license fix")

Antes se cargaban desde CDN (`cdn.jsdelivr.net`) en cada arranque — si el
primer arranque de un dispositivo era sin conexión, el escáner/generador de
QR podía no estar disponible (ver `docs/BUG_REGISTER.md`). Ahora viven como
archivos locales dentro de la fuente canónica (`CONTROL_ENGRASE_WEB/
CONTROL_ENGRASE_WEB/vendor/`), se copian al build igual que cualquier otro
asset del proyecto (ver `vite.config.js` / `tools/runtime-file-set.mjs`) y
quedan precacheados por el Service Worker (`sw.js`, `ASSETS`) desde la
primera instalación — nunca se piden a Internet.

Mismas librerías, mismas versiones, mismo contenido que ya se usaba desde el
CDN — solo cambió de dónde se sirven. La API/el global (`window.jsQR`) y la
forma en que `app.js` los usa NO cambiaron.

**Lote "QR license fix"**: el generador de QR anterior (copyleft, no
compatible con el resto del software del proyecto) se eliminó por completo
y se reemplazó por **qrcode-generator** (MIT, de Kazuhiko Arase — la base
sobre la que se construyen muchas otras librerías QR en JS). jsQR (escáner)
no cambió. El formato del QR, los deep links (`#eq=<id>`) y la Ficha de
equipo son exactamente los mismos — solo cambió qué librería dibuja el
código. `app.js` usa un adaptador propio (`renderQrCode()`) para mantener la
misma firma `{ value, size, element?, background?, foreground? }` que ya
usaban los 2 call sites reales, así que casi no tuvieron que cambiar.

| Archivo | Librería | Versión | Origen | Licencia |
|---|---|---|---|---|
| `jsqr.js` | [jsQR](https://github.com/cozmo/jsQR) | 1.4.0 | `https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js` (idéntico al que se cargaba antes; es el archivo `main` real del paquete, sin build de minificación propio) | Apache-2.0 — texto completo en `LICENSE-jsqr-apache-2.0.txt` |
| `qrcode.js` | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 2.0.4 | `https://registry.npmjs.org/qrcode-generator/-/qrcode-generator-2.0.4.tgz` → `dist/qrcode.js` (el archivo `main` real del paquete, sin build de minificación propio — mismo criterio que jsQR) | MIT — texto completo en `LICENSE-qrcode-generator-mit.txt` |

No se modificó ni un byte de ninguno de los dos archivos respecto a lo que
publica el paquete — se descargaron tal cual para conservar exactamente el
comportamiento documentado por cada librería.
