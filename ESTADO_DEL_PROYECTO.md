# Control de Engrase — Open Pit · Estado del proyecto

> **Para retomar el proyecto:** sube este archivo junto con los dos .zip al inicio de
> una conversación nueva y di "continuemos con este proyecto". Con eso se recupera
> todo el contexto sin tener que explicar nada de cero.

Última actualización: agosto 2026

---

## 1. Qué es

Sistema de control de engrase para flota de equipo pesado de minería (CONEQUISA / Equinox Gold).
Funciona como **página web** y como **app instalada de Android**, ambas contra la misma base de datos.
Diseñado para trabajar **sin internet** en el pit y sincronizar cuando hay señal.

## 2. Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Web pública | https://junivalles-cmd.github.io/ |
| Repositorio | github.com/junivalles-cmd/junivalles-cmd.github.io |
| Base de datos | Supabase → https://havrirlapjyqrffgalqx.supabase.co |
| Firma de la app | `engrase-key.jks` (contraseña en `CONTRASENA_KEYSTORE.txt`, alias `engrase`) |
| Paquete Android | `com.conequisa.engraseopenpit` |

**Los dos .zip que se entregan:**
- `CONTROL_ENGRASE_WEB.zip` → se sube a GitHub (contenido suelto en la raíz del repo)
- `CONTROL_ENGRASE_APP_ANDROID.zip` → proyecto Capacitor para compilar el .apk

## 3. Cómo está construido

Sin frameworks: HTML, CSS y JavaScript puro.

| Archivo | Qué hace |
|---|---|
| `app.js` (~5.100 líneas) | Toda la aplicación: pantallas, formularios, lógica |
| `db.js` | Base de datos local del dispositivo (IndexedDB) y datos iniciales |
| `sync.js` | Sincronización con Supabase (subir/bajar, fotos a Storage) |
| `styles.css` | Estilos, temas, íconos (set Lucide como máscaras CSS) |
| `sw.js` | Service Worker: permite que funcione sin internet |
| `schema.sql` | Script que crea la tabla y el bucket de fotos en Supabase |
| `supabase/functions/` | Funciones de servidor para las notificaciones push |

**Librerías externas** (desde jsDelivr): Chart.js, SheetJS (Excel), jsPDF + autotable, QRious, jsQR.

## 4. Roles y permisos

- **ADMINISTRADOR** — todo
- **PLANIFICADOR** — dashboard, equipos, plan (incluido en lote), turno, historial, reportes, horómetros, ayuda. Puede registrar engrases atrasados.
- **SUPERVISOR** — dashboard, equipos, turno, anomalías, historial, usuarios, ayuda
- **LUBRICADOR** — interfaz simplificada: mi turno, anomalías, mis engrases, ayuda
- **VISOR** — solo lectura: dashboard, historial, reportes, ayuda

Login por PIN de 4 dígitos. Bloqueo tras 5 intentos fallidos. Cierre por 30 min de inactividad.

## 5. Funciones principales

**Equipos:** alta/edición/eliminación (borrado lógico), importar desde Excel, edición y borrado en lote con vista previa, búsqueda por código/ubicación/punto de engrase, QR por equipo, equipos recientes.

**Plan de engrase:** dos modalidades — por **horas de operación** (horómetro) o por **día y turno de la semana**. Configuración en lote. Puntos de engrase con foto; se pueden **copiar los puntos de otro equipo** agrupados por familia. Impresión del plan semanal/mensual en formato matriz.

**Registro de engrase:** checklist por punto, exige motivo si un punto no se realiza, hasta **5 fotos** (WebP), guardado automático de borrador, aviso si otro ya lo engrasó hoy. Soporta **equipos sin horómetro o con horómetro dañado**. El planificador puede registrar **engrases atrasados** con fecha y responsable reales.

**Anomalías:** reporte manual + **creación automática** cuando un punto no se engrasa (criticidad según el motivo, con control de duplicados y contador de reincidencias). Edición, cierre con nota de resolución, eliminación (solo admin).

**Reportes:** gráficas, informe ejecutivo PDF, Excel completo, CSV, informe fotográfico, y panel de **puntos no engrasados con sus motivos**.

**Otros:** papelera para restaurar lo eliminado, respaldo completo descargable, notificaciones locales configurables, notificaciones push vía OneSignal (pendiente de activar), modo oscuro/claro/alto contraste, ayuda editable con diagramas por familia de equipo.

## 6. Estado actual

**Funcionando:** todo lo listado arriba, en web y app.

**Pendiente de activar (requiere acción de Junior):**
- **Notificaciones push** — ver `GUIA_NOTIFICACIONES_PUSH.md`. Falta crear la cuenta de OneSignal, pegar el App ID en `app.js` (línea `const ONESIGNAL_APP_ID = ''`), y desplegar las funciones en Supabase.
- **App Links** — al compilar, correr `npm run applinks` para que el QR abra la app en vez del navegador.

## 7. Limitaciones conocidas (decisiones tomadas a propósito)

Estas se evaluaron y se decidió dejarlas así; no son descuidos:

1. **Los PIN se guardan sin cifrar.** Quien acceda al panel de Supabase puede leerlos. Aceptable para uso interno del equipo; **no apto para auditoría formal** (ISO, datos personales sensibles).
2. **Los roles son solo visuales.** Alguien con conocimientos podría cambiarse el rol desde la consola del navegador. Arreglarlo requiere migrar a autenticación real de Supabase.
3. **La llave del servidor está embebida** en el código (es la anon key pública de Supabase, pero las políticas de la base están abiertas).
4. **No se minifica el código** — el ahorro real era ~11 KB (GitHub ya comprime) y se prefirió mantenerlo legible para poder seguir editándolo con precisión.

## 8. Cómo se trabaja este proyecto

Hay un **arnés de pruebas** que ejecuta la app real dentro de un navegador simulado
(jsdom + IndexedDB simulada), llena formularios y hace clics de verdad. Antes de entregar
cualquier cambio se corren estas pruebas para confirmar que nada se rompió. Los archivos
de prueba no se incluyen en los .zip (viven solo en el entorno de trabajo), pero se pueden
volver a crear.

**Regla de trabajo:** cuando algo falla, primero se reproduce el fallo con una prueba, se
encuentra la causa real, y recién entonces se corrige — en vez de adivinar.

## 9. Compilar la app Android (resumen)

```
npm install
npx cap add android      # solo la primera vez
npm run icons            # genera el ícono nativo
npm run applinks         # QR abre la app en vez del navegador
npx cap sync android
npx cap open android     # Android Studio → Build → Generate Signed Bundle/APK → APK → release
```
Usar `engrase-key.jks` (Choose existing) con la contraseña guardada, alias `engrase`.
Desinstalar la versión anterior del celular antes de instalar la nueva.

Guía completa paso a paso: `GUIA_COMPLETA_INSTALACION.md`.

## 10. Ideas pendientes (conversadas, no implementadas)

- Migrar a autenticación real de Supabase (resolvería los puntos 1 y 2 de limitaciones)
- Convertir anomalías en órdenes de trabajo con seguimiento (quién atendió, repuesto usado)
- Medir tiempo de resolución de anomalías (MTTR)
- Mapa del patio con pines de color por equipo
- Poner el proyecto en un repositorio con Git para tener historial de versiones
