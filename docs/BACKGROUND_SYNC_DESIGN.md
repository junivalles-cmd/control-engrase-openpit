# HISTORICAL / DEPRECATED — diseño de una fase anterior de sync/Auth.
# Las menciones a PIN o login legacy no describen el flujo actual.

# Sync en segundo plano con la app terminada — por qué NO se implementó

Ver también `docs/STORAGE_PRIVACY_DESIGN.md` y `docs/SESSION_HANDOFF.md` (lote
PIN+sync+storage pre-cutover). Este documento cubre específicamente el
Bloque F del pedido: "intentar actualización alrededor de 07:00/19:00 aunque
la app no esté visible", vía WorkManager/AlarmManager/JobScheduler nativo de
Android.

## Decisión

**No se escribió código nativo de background para este lote.** El
fallback en JavaScript (catch-up al abrir/reanudar la app, ver
`Sync.runFullRefreshIfDue()` en `sync.js`) es el único mecanismo real hoy.

## Auditoría del proyecto Android real (confirmado, sin tocar nada)

- Proyecto Capacitor en `CONTROL_ENGRASE_APP_ANDROID/android/` (Capacitor
  6.1.2). Plugins instalados: `@capacitor/camera`,
  `@capacitor/local-notifications`, `@capawesome/capacitor-badge`, un
  plugin Cordova de OneSignal empaquetado pero **inerte** (sin proyecto
  Firebase configurado — confirmado en comentarios de `app.js`, las
  notificaciones push nunca se activaron).
- `MainActivity.java` es el único archivo nativo propio del proyecto — un
  `BridgeActivity` de Capacitor sin modificar, sin lógica agregada.
- **Cero** dependencias de Gradle, código o configuración de
  `WorkManager`/`JobScheduler`/`AlarmManager`/background-fetch en todo el
  proyecto nativo. No hay ningún plugin de Capacitor de tareas en segundo
  plano instalado tampoco.

## Por qué no se construyó desde cero en este lote

1. **"NO duplicar motor de sync" (pedido, §29).** El motor real
   (pull/push/CAS/decidePullAction, ver `sync.js`) vive en JavaScript y
   corre dentro del WebView de Capacitor. Un `Worker` de WorkManager
   corre en un proceso/contexto Android nativo — **no tiene acceso directo
   al WebView ni a su IndexedDB** mientras la app está completamente
   terminada. Las dos opciones reales para que un Worker nativo mueva
   datos son:
   - (a) reescribir pull/push/CAS en Kotlin, con su propio cliente HTTP y
     su propio acceso a la base de datos — es decir, exactamente la
     "segunda implementación completa" que el pedido prohíbe explícitamente
     (riesgo real de divergencia entre dos motores de sync mantenidos por
     separado, el peor escenario para un sistema offline-first con CAS); o
   - (b) que el Worker dispare una carga real de la WebView en segundo
     plano (un "headless WebView" o similar) para reusar `sync.js` tal
     cual — técnicamente posible en Android pero de una complejidad y
     fragilidad real (ciclo de vida de una segunda instancia de WebView,
     memoria, Doze, fabricantes que la matan igual) muy por encima de lo
     que este lote puede verificar de forma segura sin un dispositivo real
     y varios ciclos de prueba.
2. **"Si técnicamente no es viable: NO hacer falsa implementación" (pedido,
   §29).** No existe infraestructura previa (ver auditoría arriba) sobre la
   cual extender con confianza — construir la opción (b) desde cero, sin
   poder probarla en un dispositivo real dentro de esta sesión, sería
   exactamente la "falsa implementación" que el pedido pide evitar: código
   que compila pero cuyo comportamiento real en Doze/OEM no se puede
   verificar aquí.
3. **El fallback en JS ya cubre el objetivo real (pedido, §31).** El
   pedido mismo dice que 07:00/19:00 son "ventanas objetivo, NO garantía al
   segundo" (§30) y que el catch-up en el siguiente `app start`/`resume` es
   *obligatorio* incluso si el background nativo existiera (§31) — es
   decir, la pieza que el pedido exige como mínimo indispensable ya está
   completa y probada (`tests/unit/full-refresh-windows.test.js`), y es la
   que realmente importa: en la práctica, un operador de turno abre la app
   varias veces por turno (registrar engrase, revisar anomalías, etc.), así
   que el catch-up en foreground ya alcanza la ventana en minutos, no en
   horas, la inmensa mayoría de las veces.

## Qué se ganaría con background nativo (para una sesión futura)

Si en el futuro se autoriza este trabajo, la ruta más segura identificada
es la opción (b): usar `WorkManager` con una constraint de red
(`NetworkType.CONNECTED`) para programar un trabajo periódico/único
alrededor de cada ventana, que dispare una carga breve de un WebView (visible
o no) apuntando a una ruta mínima de la app que solo llama
`Sync.fullSync()`/`runFullRefreshIfDue()` y se cierra — nunca reimplementar
pull/push/CAS en Kotlin. Requiere: un dispositivo real para verificar
comportamiento bajo Doze/restricciones de batería de cada fabricante, sin
foreground service permanente ni wake lock permanente (ver §28 del pedido),
y validación de que no compite con un `fullSync()` ya en curso desde la app
en primer plano (mismo flag `Sync.syncing` que ya sirve para eso hoy).

## Estado de las ventanas 07:00/19:00 SIN background nativo

Completamente funcional vía el mecanismo en `sync.js`
(`FULL_REFRESH_WINDOWS`/`dueFullRefreshWindows()`/`runFullRefreshIfDue()`,
llamado desde dentro de `fullSync()`): cualquier apertura o reanudación de
la app después de las 07:00 o las 19:00 con esa ventana pendiente del día
dispara un re-pull completo automáticamente, sin bloquear el login/PIN
(corre en segundo plano dentro de la promesa de `fullSync()`, nunca
esperado por la UI). Ver `tests/unit/full-refresh-windows.test.js` para la
cobertura completa (ventanas pendientes/cumplidas/catch-up entre días,
integración con `fullSync()`, no-duplicación).
# HISTORICAL / DEPRECATED — diseño de una fase anterior de sync/Auth.
# Las menciones a PIN o login legacy no describen el flujo actual.

