# UI / RESPONSIVE

Rama: `migration-typescript`
Checkpoint previo: tag local `pre-ui-responsive-audit` → commit `7c1ace5`
(sin push).

# FASE 1 — AUDITORÍA (sin corregir todavía)

Fecha: 2026-09-23

## Objetivo de esta fase

Auditar y **clasificar** problemas reales de diseño responsive — márgenes,
paddings, topbars, tablas, formularios, botones, cards, navegación, scroll
horizontal, adaptación móvil/tablet/desktop — **sin corregir nada
todavía**. Nada de esta fase modificó `styles.css`, `app.js`, `db.js`,
`sync.js`, Supabase ni IndexedDB. Solo se agregó tooling de auditoría
(Playwright, Stylelint) y este documento.

## Precheck

`git status` limpio, rama `migration-typescript`, `npm test` 125/125 PASS,
`npm run typecheck` PASS, `npm run build:web` PASS antes de empezar.

## Checkpoint

Tag local `pre-ui-responsive-audit` → commit `7c1ace5` (sin push).

## Herramientas instaladas

- **`@playwright/test@^1.63.0`** + Chromium (`npx playwright install
  chromium --with-deps`) — auditoría visual automatizada.
- **`stylelint@^17.15.0`** + **`stylelint-config-standard@^40.0.0`** —
  auditoría estática de `styles.css`.
- No se instaló Tailwind, Bootstrap, Material UI, React, Vue ni Angular —
  el CSS existente sigue siendo la única capa de estilos.
- `npm audit --omit=dev`: **0 vulnerabilidades** nuevas en producción.

## Playwright — configuración y alcance real

`playwright.config.js` (raíz): 7 proyectos, uno por resolución pedida:

| Proyecto | Resolución | Interpretación |
|---|---|---|
| `phone-360` | 360×800 | Teléfono pequeño |
| `phone-390` | 390×844 | Teléfono estándar |
| `phone-412` | 412×915 | Android grande |
| `tablet-768` | 768×1024 | Tablet |
| `tablet-1024` | 1024×768 | Tablet/desktop pequeño |
| `desktop-1366` | 1366×768 | PC común |
| `desktop-1920` | 1920×1080 | Monitor grande |

`npm run test:ui` (`playwright test`) sirve la **fuente canónica**
(`CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB`) con `npm run dev` — no `dist/`
— para auditar exactamente lo que cualquier corrección de esta fase
edita, sin esperar un build. `npm run test:ui:screenshots` existe aparte
(`playwright test --update-snapshots`) para cuando corresponda actualizar
capturas de referencia — nunca se ejecuta automáticamente ni sobrescribe
nada en silencio.

**Alcance real, y por qué es más acotado de lo que se pidió inicialmente:**
la app es "PIN + selección de usuario" (`renderLogin()`, sin backend de
sesión propio) y **todas** las pantallas después del login requieren un
PIN real de un usuario de producción — no existen credenciales de prueba
seguras en este entorno, y **no se intentó adivinar ni fuerza bruta
ningún PIN** (sería tanto una violación de seguridad como del PASO 6 del
pedido). Por eso Playwright solo automatiza la **pantalla de login**
(pública, sin autenticación, sin datos de negocio) — el resto de
pantallas queda marcado **REQUIERE VALIDACIÓN MANUAL** (ver tabla de
hallazgos), auditado en su lugar por **análisis estático del código**
(HTML generado en `app.js` + reglas de `styles.css` que le aplican), no
inventando un PASS que no se pudo verificar en vivo.

**Hallazgo de transparencia, no de diseño:** `boot()`/`DOMContentLoaded`
llaman `Sync.startAuto()` incondicionalmente, incluso antes de iniciar
sesión — al correr Playwright contra el dev server, esto generó
sincronización real (**solo lectura**) contra Supabase de **producción**,
y el nombre real de un usuario ("Administrador General") apareció en la
captura de la pantalla de login. Ninguna escritura ocurrió (contexto de
navegador nuevo en cada test, cero registros locales "dirty" que
empujar) — pero por eso las capturas de esta fase **no se versionan**
(`tests/ui/screenshots-audit/` está en `.gitignore`).

## Criterios automáticos (`tests/ui/login-responsive.spec.js`)

Por cada una de las 7 resoluciones, sobre la pantalla de login:

1. **Scroll horizontal global no deseado** —
   `document.documentElement.scrollWidth > clientWidth`. Resultado: **0/7
   con scroll horizontal.**
2. **Elementos interactivos fuera del viewport** — ninguno encontrado.
3. **Controles táctiles < 44×44px** — un hallazgo real, ver tabla.
4. **Solapamiento entre controles interactivos** (>50% del área del más
   chico) — ninguno encontrado (aserción dura, `expect(overlaps).toEqual([])`).

**7/7 tests PASS.** Ningún hallazgo automático se registró como bug sin
revisión visual — las capturas (`tests/ui/screenshots-audit/*.png`, no
versionadas) se inspeccionaron a simple vista en 360px y 1920px:
tarjeta de login centrada, sin overflow, texto legible, sin
solapamientos, en ambos extremos.

## Stylelint — auditoría controlada (`stylelint.config.js`)

Línea base con `stylelint-config-standard` **puro, sin excepciones**:
**595 errores en 16 reglas**, sobre 1307 líneas de `styles.css`.
Clasificados uno por uno (nunca en bloque) antes de decidir qué
desactivar — el detalle completo de cada regla y su clasificación está
documentado como comentario en `stylelint.config.js`. Resumen:

| Clasificación | Reglas | Cantidad | Acción |
|---|---|---|---|
| NO RELEVANTE | 12 reglas (formato/modernización de sintaxis: una declaración por línea, línea en blanco antes de regla, `rgba()`→`rgb()`, hex corto, etc.) | 536 | Desactivadas, con motivo documentado — el archivo ya sigue, de forma consistente y deliberada, el estilo contrario al que piden |
| LEGACY (intencional) | `property-no-vendor-prefix` | 35 | Desactivada — `-webkit-appearance`/`-moz-appearance`/`-webkit-mask-image` son compatibilidad real con Safari/WebView, no deuda técnica |
| MANTENIBILIDAD | `no-descending-specificity`, `no-duplicate-selectors` | 56 | **Activas, severidad `warning`** — no bloquean `npm run lint:css` (exit 0). La mayoría de los "duplicados" son el mecanismo de cascada YA documentado en el propio archivo ("va al final a propósito, para ganar en orden de cascada" — íconos Lucide, tablas→tarjetas móvil) |

**`npm run lint:css`: 0 errores, 56 warnings, exit code 0.** No se
ejecutó `--fix` en ningún momento — cero líneas de `styles.css`
reformateadas solo por estilo.

## Inventario de pantallas (real, leído de `PERMISSIONS`/`MENU` en `app.js`)

```js
PERMISSIONS = {
  ADMINISTRADOR: [dashboard, equipos, plan, matriz, turno, registrar,
                  horometros, anomalias, lubricantes, historial,
                  reportes, usuarios, config, ayuda],   // 14
  PLANIFICADOR:  [dashboard, equipos, plan, matriz, turno, historial,
                  reportes, horometros, ayuda],          // 9
  SUPERVISOR:    [dashboard, equipos, matriz, turno, anomalias,
                  historial, usuarios, ayuda],            // 8
  LUBRICADOR:    [turno, anomalias, historial, ayuda],    // 4, shell propio
  VISOR:         [dashboard, matriz, historial, reportes, ayuda], // 5
}
```

**Corrección sobre el pedido:** no existe una pantalla "Plantillas" en el
código (`grep -i plantilla` sobre `app.js`: 0 resultados) — no se
inventó ninguna para completar la lista.

**Componente/layout compartido** (auditado una sola vez, no por pantalla):
ADMINISTRADOR/PLANIFICADOR/SUPERVISOR/VISOR comparten exactamente el
mismo `.app-shell`/`.sidebar`/`.topbar`/`.bottom-nav` (`boot()`,
`app.js` ~1692) — solo cambia el contenido de `.app-content` por ruta.
**LUBRICADOR** usa un shell completamente distinto y propio
(`bootLubricador()`, ~1824): `.lub-shell`/`.lub-topbar`/`.lub-bottom-nav`,
mobile-first desde el diseño, no una adaptación del shell de escritorio.

## PASO 10 — Lubricador (prioridad del sistema)

`renderLubricadorHome()` (~1871) ya es, por diseño, una lista de tarjetas
`.lub-eq-btn` (no una tabla) con: código, estado (chip de color), modelo,
ubicación, horómetro y tiempo restante/atraso — más un FAB fijo
"Reportar anomalía" y navegación inferior de 4 ítems. Botones de
navegación (`.lub-nav-item`), FAB y tarjetas ya reciben `min-height:
var(--tap)` (44px, ver más abajo) desde la sección "MEJORAS DE DISEÑO Y
ACCESIBILIDAD" (`styles.css` ~1140). **No requiere rediseño de lógica** —
la estructura ya está orientada a "un toque, en campo, con guantes"
(comentarios propios del CSS lo confirman). Validación real del flujo
completo (buscar equipo, tocar puntos, motivo de no lubricado, fotos,
guardar) queda **REQUIERE VALIDACIÓN MANUAL** — no se pudo automatizar
sin PIN real.

## PASO 11 — UI-ANDROID-005: causa raíz (analizada, NO corregida)

`renderDashboard()` → panel "Equipos que requieren atención" (`app.js`
~2141): `<table class="data-table" id="att-table">` con **9 columnas**
(Estado, Código, Equipo, Turno, Control, Horómetro, Próximo/Día
asignado, Restante/Atraso, Días sin engrase). En ≤680px, el mecanismo
genérico ya existente (`styles.css` líneas 719-739, `data-label` puesto
por `makeTablesResponsive()`) convierte cada fila en una tarjeta
apilada "ETIQUETA: valor" — **técnicamente funciona, no hay overflow
horizontal ni datos cortados** (confirmado leyendo el CSS: `thead {
display:none}`, cada `td` se apila con su label). El problema real,
confirmado por el propio registro del bug, es de **densidad de
información**: 9 etiquetas apiladas por equipo producen una tarjeta muy
alta para un panel que debería ser un resumen rápido — no es un bug de
overflow ni de datos cortados, es un problema de jerarquía visual.

**La solución NO es `overflow-x: auto`** (ya se descartó explícitamente,
y de hecho el mecanismo actual ya evita el overflow). Tres caminos
reales, no aplicados todavía:

- **C — ocultar columnas secundarias en móvil:** mostrar solo
  Estado+Código+Equipo+Restante/Atraso (4 de 9) por defecto, con el
  resto accesible al tocar la tarjeta (ya existe un patrón de modal de
  detalle en otras pantallas, reutilizable).
- **B — tarjeta tipo `.eq-card`/`.lub-eq-btn`:** el panel "Semáforo de
  equipos" (`.cards-grid`, justo debajo en el mismo Dashboard) ya
  resume el mismo tipo de dato equipo+estado en formato tarjeta
  compacto — se podría reutilizar ese componente en vez de la tabla
  genérica para este panel específico.
- **D — híbrido:** cards compactas (como B) con un acceso a la tabla
  completa (como está hoy) para quien necesite las 9 columnas.

Recomendación técnica (no ejecutada): **C** es el cambio de menor
riesgo — reutiliza el mecanismo `data-label` ya existente y probado,
sin tocar el layout de otras tablas que SÍ caben bien en 4-5 columnas.

## Auditoría CSS estática (PASO 7) — hallazgos con evidencia real

- **Sistema de espaciado (`--sp-1`…`--sp-6`) declarado pero
  prácticamente sin usar:** `grep -c "var(--sp-" styles.css` → **0**
  coincidencias en todo el archivo, pese a que el comentario junto a su
  declaración (línea 35) dice explícitamente que "reemplaza los 20
  valores sueltos anteriores". **227 declaraciones** de
  `padding`/`margin`/`gap` con píxeles crudos siguen en el archivo. No
  es que falte un sistema de espaciado — existe, pero no se adoptó.
- **Escala tipográfica (`--fs-xs`…`--fs-2xl`) declarada pero adoptada
  solo parcialmente:** 6 usos de `var(--fs-*)` contra **23 valores
  crudos distintos** de `font-size` en px (incluidos saltos de medio
  píxel — `7.5px`, `9.5px`, `10.5px`, `11.5px`, `12.5px`, `13.5px` —
  exactamente el problema que el comentario de la escala dice haber
  resuelto).
- **`table.matriz { min-width: 680px }` + `overflow-x: auto` en su
  contenedor** (Matriz Semanal): scroll horizontal **intencional** (hay
  columna de equipo con `position: sticky; left: 0` para no perderla al
  desplazar) — no es un bug, es la estrategia correcta para una grilla
  día×equipo que genuinamente no cabe como tarjetas. Confirmar en
  dispositivo real que el scroll se siente natural (REQUIERE
  VALIDACIÓN MANUAL).
- **Botones/inputs < 44px:** el sistema YA tiene una regla general
  (`styles.css` ~1140, sección "MEJORAS DE DISEÑO Y ACCESIBILIDAD" —
  preexistente, no agregada en esta fase) `min-height: var(--tap)`
  (44px) aplicada a `.btn, .icon-btn, .lub-nav-item, .menu-item,
  .bottom-item` y a los inputs de `.form-grid`. Una excepción
  documentada y justificada en el propio CSS (`.notif-num`, un stepper
  numérico de 74×38px, con comentario explicando por qué no puede
  medir 44px). El único incumplimiento real medido por Playwright:
  `.login-theme-btn` (selector de tema en el login) mide **41×44px** —
  3px corto de ancho, en las 7 resoluciones por igual (no es un
  problema "responsive", es un tamaño fijo insuficiente en todas
  partes).
- **Ningún `width` fijo, `position: absolute` ni `100vw`
  problemático** encontrado fuera de contextos ya controlados (modales
  con `inset: 0`/`position: fixed` para overlays, iconos con tamaños
  fijos pequeños dentro de botones con padding). `* { box-sizing:
  border-box; min-width: 0; }` global (línea 98) — buena base
  defensiva contra overflow en flex/grid.
- **`z-index`:** escala usada consistentemente (5 topbar, 30
  bottom-nav, 40 sidebar móvil, 60 quick-find, 100 modal, 200 toast,
  300 overlay de impresión) — sin colisiones detectadas por
  inspección.

## PASO 16 — Breakpoints: hallazgo real de contradicción

22 bloques `@media` en el archivo, con puntos de corte dispersos: 380,
420, 480, 560, 600, 601–900, 640 (×3 bloques distintos), 680, 700,
1400(min), 860, 900 (×3 bloques distintos), 1300(min), 1100 — sin un
sistema de 3-4 breakpoints consolidado.

**Contradicción real, verificada leyendo el CSS (no un lint genérico):**
`.kpi-grid` (tarjetas KPI del Dashboard) cambia de columnas así según el
ancho:

| Ancho | Columnas | Regla |
|---|---|---|
| ≤600px | 2 | línea 368 |
| 601–900px | **4** | línea 701-704 |
| 901–1100px | **3** | línea 367 |
| ≥1101px | 6 | base, línea 366 |

Al aumentar el ancho de la ventana, las columnas van **2 → 4 → 3 → 6**
— no monótono: pasar de 900px a 901px reduce columnas (4→3) en vez de
aumentarlas. Cosmético (P3, nadie reporta esto como bug funcional), pero
es exactamente el tipo de "breakpoints contradictorios" que se pidió
buscar. No corregido en esta fase.

**Ninguna solución específica de un modelo de teléfono** (ej. "Samsung
S938B") encontrada en el CSS — los breakpoints ya son por ancho/alto de
viewport y orientación, no por dispositivo, consistente con lo pedido.

## Formularios (PASO 21) — análisis estático

`.form-grid` ya es `grid-template-columns: 1fr 1fr` en desktop → `1fr`
(una columna) en `≤560px` (línea 470) — labels siempre visibles arriba
del campo (`label { display:flex; flex-direction:column }`, línea 146).
Inputs ya usan `font-size: 16px` explícito en la base (línea 121, con
comentario: evita que iOS Safari haga zoom automático al enfocar).
`.modal` limita `max-height: 88vh` con `overflow-y: auto` — no debería
exceder el viewport verticalmente. En `≤640px`, `.modal-actions` pasa a
columna con botones de ancho completo (línea 542-545). No se detectó
superposición de botones por CSS estático — **confirmación visual en
formularios reales queda REQUIERE VALIDACIÓN MANUAL** (requieren
autenticación).

## Tablas (PASO 20) — clasificación por estrategia

| Tabla | Estrategia actual | Evaluación |
|---|---|---|
| `.data-table` genérica (Historial, Reportes, Usuarios, listas simples) | **C-ish automática**: se convierte en tarjetas apiladas "label: valor" en ≤680px vía `data-label` | Funciona bien cuando hay pocas columnas (3-5); mal cuando hay 9 (ver UI-ANDROID-005) |
| `table.matriz` (Matriz Semanal) | **A**: tabla completa + `overflow-x: auto` + columna fija con `sticky` | Diseño correcto para una grilla día×equipo; validar en dispositivo real que el scroll se sienta natural |
| Panel "Equipos que requieren atención" (Dashboard, 9 columnas) | **C automática, mal ajustada** | Ver UI-ANDROID-005 — candidato a estrategia C manual (ocultar columnas) o B (reusar `.eq-card`) |

No se aplicó una sola estrategia a todas — confirma que la app ya
diferencia casos, coherente con lo pedido.

## Tabla de hallazgos

| ID | Pantalla | Resolución | Problema | Evidencia | Severidad | Causa probable | Solución propuesta |
|---|---|---|---|---|---|---|---|
| UI-RESP-001 | Dashboard (panel "Equipos que requieren atención") | Todas ≤680px | Tarjeta apilada muy alta/densa (9 etiquetas) | `docs/evidence/UI-ANDROID-005_dashboard-table.png` (ya registrado como `UI-ANDROID-005`) | **P3** (UX, no bloquea) | 9 columnas sin priorización en el mecanismo genérico tabla→tarjeta | Ocultar columnas secundarias en móvil (estrategia C) o reusar `.eq-card` (estrategia B) |
| UI-RESP-002 | Login (selector de tema) | Todas (no es responsive-specific) | `.login-theme-btn` mide 41×44px, 3px corto de ancho vs. objetivo de 44px | Medido con Playwright, 7/7 resoluciones idéntico | P3 | `.icon-btn` padding `4px 8px` insuficiente para el glyph a `font-size:18px` | Aumentar `padding` horizontal ~2px, o `min-width: var(--tap)` explícito en `.login-theme-btn` |
| UI-RESP-003 | Dashboard (`.kpi-grid`) | 601-900px vs 901-1100px | Columnas de KPI no monótonas al cambiar de ancho (2→4→3→6) | Lectura directa de `styles.css` líneas 366-368, 701-704 | P3 | Breakpoints agregados en momentos distintos sin revisar el conjunto | Consolidar a una progresión monótona (ej. 2→3→4→6) dentro de 3-4 breakpoints |
| UI-RESP-004 | Global (CSS) | N/A | Sistema de espaciado (`--sp-*`) declarado, 0 usos reales | `grep -c "var(--sp-" styles.css` = 0; 227 valores crudos | P3 (mantenibilidad, no visual) | Se declaró la escala pero no se migraron los valores existentes | Adoptar gradualmente `--sp-*` en los paneles que se toquen en futuras fases — no reescribir todo de una vez |
| UI-RESP-005 | Global (CSS) | N/A | Escala tipográfica (`--fs-*`) adoptada solo 6 veces; 23 valores crudos distintos, incluidos saltos de 0.5px | `grep` de `font-size:` crudo vs. `var(--fs-` | P3 (mantenibilidad) | Mismo patrón que UI-RESP-004 | Igual: adopción gradual, no reescritura masiva |
| UI-RESP-006 (histórico) | Matriz Semanal (`table.matriz`) | ≤680px | Requiere scroll horizontal (intencional) | `min-width: 680px` + `overflow-x: auto`, columna fija `sticky` | Sin severidad (diseño correcto) — validar sensación real en dispositivo | Grilla día×equipo no cabe como tarjetas | Ninguna — REQUIERE VALIDACIÓN MANUAL en dispositivo real |
| — | Todas las pantallas autenticadas (Equipos, Plan, Turno, Registrar, Horómetros, Anomalías, Lubricantes, Historial, Reportes, Usuarios, Configuración, Ayuda, Lubricador completo) | Todas | No auditadas en vivo — requieren PIN real de producción | — | — | Sin credenciales de prueba seguras en este entorno | **REQUIERE VALIDACIÓN MANUAL** — ver PASO 24 (guía pantalla por pantalla) |

**P1: 0. P2: 0. P3: 5 (más 1 sin severidad, ya funcional, solo a
confirmar en dispositivo).** Ningún hallazgo bloquea el uso del sistema
— consistente con que la app ya tiene una base de accesibilidad/responsive
más madura de lo que se asumía al iniciar esta fase (touch targets,
escalas tipográfica/espaciado, tabla→tarjeta, sticky columns, todo
preexistente).

## Qué NO se hizo en esta fase (a propósito)

Corregir `UI-ANDROID-005` ni ningún otro hallazgo; ejecutar
`stylelint --fix`; reescribir `styles.css`; introducir Tailwind/
Bootstrap/Material UI/React/Vue/Angular; cambiar branding, logos o
colores globales; agregar funcionalidades; corregir `APP-LINKS-001` ni
`ANDROID-DOZE-001`; tocar Supabase, IndexedDB, `sync.js` ni ninguna
regla de negocio (engrase, anomalías, matriz, horómetros, turnos);
adivinar o forzar credenciales de usuarios reales para automatizar
pantallas autenticadas; publicar ni tocar GitHub Pages/Android.

## Siguiente fase (histórico — ver FASE 2 abajo)

Corregir, en lotes pequeños y en este orden (PASO 17 del pedido): layout
general → topbar/navegación → Dashboard (`UI-ANDROID-005`) → Lubricador
→ tablas → formularios → Matriz → resto. Después de cada lote: `npm
test` + `npm run typecheck` + `npm run build:web`. Validación final
pantalla por pantalla guiada con el usuario (`UI-MANUAL-01` en
adelante), empezando por Dashboard móvil.

# FASE 2 — CORRECCIONES DIRIGIDAS

Fecha: 2026-09-23
Checkpoint previo: commit `c9d50c9` (Fase 1 completa).

## Objetivo de esta fase

Corregir **solamente** los dos hallazgos con acción concreta de la
auditoría: `UI-ANDROID-005` (densidad del panel del Dashboard) y el
comportamiento no monótono de `.kpi-grid` (`UI-RESP-003`). Sin
refactorización general de `styles.css`, sin tocar Lubricador,
formularios, Matriz Semanal, lógica de negocio, TypeScript, spacing
global, los 22 bloques `@media` dispersos, los 56 warnings de Stylelint
ni las variables `--sp-*`/`--fs-*` de forma masiva.

## Precheck

`git status` limpio, rama `migration-typescript`, `npm test` 125/125
PASS, `npm run typecheck` PASS, `npm run build:web` PASS antes de
empezar.

## UI-ANDROID-005 — priorización de columnas (PASO 3)

Columnas reales de `#att-table` (`renderDashboard()`, `app.js`
~2141), clasificadas:

| Columna | Importancia en móvil | Mantener | Ocultar en móvil | Motivo |
|---|---|---|---|---|
| Estado | Crítica | ✅ | | Es el semáforo mismo — sin esto no hay decisión posible |
| Código | Crítica | ✅ | | Identifica el equipo (obligatorio, PASO 5 del pedido) |
| Equipo (marca/modelo) | Alta | ✅ | | Identificación legible además del código |
| Restante / Atraso | Crítica | ✅ | | La urgencia accionable — cuánto falta o cuánto atraso lleva |
| Turno | Media-baja | | ✅ | Contexto, no cambia la urgencia ni identifica el equipo |
| Control | Media-baja | | ✅ | "Restante/Atraso" ya comunica la urgencia sin necesitar el mecanismo |
| Horómetro | Media-baja | | ✅ | Detalle numérico de apoyo, no decisivo para "¿actúo ahora?" |
| Próximo / Día asignado | Media | | ✅ | El umbral en sí; "Restante/Atraso" ya lo resume en forma accionable |
| Días sin engrase | Media | | ✅ | Contexto histórico útil pero secundario frente a Estado+urgencia |

**Desktop conserva las 9 columnas. Móvil (`≤680px`) muestra 4.**

## Implementación (PASO 4)

- `app.js` (`renderDashboard()`/`drawAttentionTable()`, ~2141-2220):
  se agregó `class="col-secondary"` a los `<th>`/`<td>` de las 5
  columnas secundarias — mismo texto, mismos datos, **cero cambios de
  lógica** (ni de cálculo ni de qué se muestra en desktop).
- `styles.css` (dentro del `@media (max-width: 680px)` ya existente que
  convierte `.data-table` en tarjetas, líneas 719-747): nueva regla
  `.data-table td.col-secondary { display: none; }` — clase semántica
  reutilizable, **sin `nth-child`** (pedido explícito), sin tocar
  `makeTablesResponsive()` (mecanismo genérico `data-label` que
  comparten otras tablas — Historial, Reportes, Usuarios — no se tocó,
  así que ninguna otra tabla cambió de comportamiento).
- **Efecto colateral corregido:** con columnas ocultas, `:last-child`
  ya no coincide con la última celda *visible* (la celda DOM-last,
  "Días sin engrase", queda oculta) — sin corrección, "Restante/Atraso"
  quedaría con un borde inferior huérfano. Se agregó una regla
  adicional, genérica (no específica de esta tabla):
  ```css
  .data-table tr td:not(.col-secondary, :has(~ td:not(.col-secondary))) { border-bottom: none; }
  ```
  (sintaxis `:not(a, b)` en vez de `:not(a):not(b)` encadenado — exigido
  por Stylelint, `selector-not-notation`; `:has()` ya es una técnica
  usada en el archivo, ver `.weekday-chip:has(input:checked)`). La regla
  `:last-child` original se dejó intacta para las tablas que no usan
  `.col-secondary`.
- No se usó `overflow-x: auto` — descartado explícitamente, además de
  que no habría resuelto el problema real (densidad, no overflow).

## `.kpi-grid` — progresión monótona (PASO 6)

**Antes** (verificado con Playwright, ver Fase 1): 2 → 4 → 3 → 6
columnas al aumentar el ancho — no monótono entre 600 y 1100px.

**Causa exacta:** dos bloques `@media (max-width: ...)` con rangos
solapados (`≤1100px` y `≤600px`) más un tercer bloque
`(min-width:601px) and (max-width:900px)` declarado **más abajo en el
archivo** — al solaparse, ganaba el que apareciera último en el código,
no un diseño intencional.

**Corrección:** rangos **no solapados**, explícitos, usando los mismos
3 puntos de corte que ya existían en el archivo (600/900/1100 — no se
agregó ningún breakpoint nuevo):

| Ancho | Columnas | Antes |
|---|---|---|
| ≤380px | 2 (gap reducido, sin cambios) | 2 |
| 381–600px | 2 | 2 |
| 601–900px | **3** | 4 |
| 901–1100px | **4** | 3 |
| ≥1101px | 6 (sin cambios) | 6 |

Se eliminó la declaración duplicada de `.kpi-grid` dentro del bloque
`601-900px` que ya existía para `.cards-grid` (esa línea de
`.cards-grid` se dejó intacta — fuera de alcance). **Progresión final:
2 → 2 → 3 → 4 → 6, estrictamente no decreciente.**

## Verificación automatizada (PASO 7/8)

No se automatizó ninguna pantalla autenticada (sin PIN real disponible,
ninguno guardado en tests/.env/código/capturas/Git). Dos specs nuevos,
ninguno requiere login:

- **`tests/ui/kpi-grid.spec.js`:** carga el `styles.css` real contra un
  fragmento estático con 6 `.kpi-card` (mismo número que genera
  `kpiCard()` en el Dashboard real) y mide `grid-template-columns`
  calculado en las 7 resoluciones. Resultado real medido:

  | Resolución | 360 | 390 | 412 | 768 | 1024 | 1366 | 1920 |
  |---|---|---|---|---|---|---|---|
  | Columnas | 2 | 2 | 2 | 3 | 4 | 6 | 6 |

  **No decreciente en las 7 — confirmado, no asumido.**

- **`tests/ui/dashboard-table-density.spec.js`:** fragmento estático
  con la estructura REAL de `#att-table` (9 columnas, mismas clases,
  texto de relleno — nunca datos de producción) contra el `styles.css`
  real. Verifica en las 7 resoluciones: `.col-secondary` es
  `display:none` en `≤680px` y visible por encima; "Restante/Atraso"
  nunca se oculta; sin borde inferior huérfano en móvil; sin scroll
  horizontal. **7/7 PASS.**
- **`tests/ui/login-responsive.spec.js`` (ya existente, Fase 1)**:
  re-ejecutado sin cambios — **7/7 PASS**, mismo hallazgo ya conocido
  (`UI-RESP-002`, sin relación con esta fase, no tocado).
- **Capturas visuales del fixture del Dashboard** (`tests/ui/
  screenshots-audit/`, no versionadas): confirmado a simple vista en
  360px (tarjeta de 4 campos, sin borde huérfano) y 1366px (tabla
  completa de 9 columnas) — ver cuerpo de esta fase para el detalle.

**`npm run test:ui`: 21/21 PASS** (3 specs × 7 proyectos).

## Stylelint (PASO 9)

`npm run lint:css`: **57 problemas (1 error, 56 warnings)** tras el
primer cambio — el error nuevo era `selector-not-notation` sobre la
regla de `:not()` recién agregada (ver arriba). Corregido a mano
(`:not(a):not(b)` → `:not(a, b)`), sin usar `--fix` (bloqueado además
por el propio entorno como acción irreversible sobre código fuente
versionado — se corrigió manualmente en su lugar). Resultado final:
**0 errores, 56 warnings** — exactamente los mismos 56 de la Fase 1
(ninguno nuevo, ninguno corregido de los ya clasificados como DEUDA
TÉCNICA CSS).

## Regresión (PASO 10)

`npm test`: **125/125 PASS**, sin cambios. `npm run typecheck`: PASS.
`npm run build:web`: PASS (`dist/` reconstruido, `verify:dist` OK).

## Web preview (PASO 11)

`npm run preview`: los 6 recursos clave comprobados por HTTP, **200 en
todos**. Carga real del `dist/` servido, en un navegador Playwright
(390×844): pantalla de login visible, **0 errores de JavaScript**, sin
scroll horizontal.

## Android (PASO 12)

`npx cap sync android`: PASS (copia desde `dist`, confirmado por su
propia salida). `./gradlew assembleDebug`: **BUILD SUCCESSFUL**.
**Android real: NO PROBADO** — Samsung no conectado (`adb devices` sin
dispositivos).

## Deuda CSS (sin tocar, ver Fase 1 para el detalle completo)

22 bloques `@media` dispersos (fuera de los 3 breakpoints tocados en
esta fase para `.kpi-grid`, que ya existían); `--sp-*` prácticamente
sin uso; `--fs-*` parcialmente adoptado; 227 valores de espaciado
crudos; 56 warnings de Stylelint (`no-descending-specificity`,
`no-duplicate-selectors`). **Clasificados como DEUDA TÉCNICA CSS, no
como bugs — sin corregir esta fase**, a revisar más adelante solo si
aporta valor real.

## Qué NO se hizo en esta fase (a propósito)

Tocar Lubricador (salvo por no haberlo tocado en absoluto), formularios,
Matriz Semanal, `db.js`, `sync.js`, Supabase, IndexedDB, Service Worker,
TypeScript, lógica de negocio; refactorizar `styles.css` de forma
general; instalar librerías de UI nuevas; limpiar los 22 `@media` ni los
56 warnings de Stylelint; tocar `--sp-*`/`--fs-*` de forma masiva;
guardar credenciales reales en ningún archivo; cerrar `UI-ANDROID-005`
como PASS sin validación visual del usuario.

## Validación manual — `UI-MANUAL-01` (2026-09-23)

**PASS**, confirmado por el usuario en Dashboard móvil: tarjetas
compactas (4 campos), información principal fácil de encontrar, sin los
9 campos apilados de antes, sin texto cortado, sin scroll horizontal
global, KPIs ordenados, topbar sin cambios.

**Tablet/desktop (768px/1366px):** verificados sin regresión vía la
suite automatizada (`tests/ui/kpi-grid.spec.js` +
`tests/ui/dashboard-table-density.spec.js`, 21/21 PASS en las 7
resoluciones, incluidas 768 y 1366 explícitamente) — mide directamente
el CSS real (`grid-template-columns` computado, `display` de
`.col-secondary`, ausencia de scroll), no es una inferencia. No se pidió
una segunda ronda de captura manual aparte para estos dos anchos.

**`UI-ANDROID-005`: CORREGIDO, VALIDADO VISUALMENTE, PASS.** Cerrado en
`docs/BUG_REGISTER.md`.

# FASE 3 — EXPERIENCIA DEL LUBRICADOR

Fecha: 2026-09-23
Checkpoint previo: commit `2178045` (cierre de `UI-ANDROID-005`).

## Objetivo de esta fase

Tres mejoras visuales puntuales, identificadas por el usuario, sobre la
experiencia del Lubricador en campo — **sin tocar lógica de negocio,
IndexedDB, Supabase, `sync.js`, TypeScript ni Service Worker**:

1. Márgenes de la pantalla "Mi Turno".
2. Ícono que representa el equipo (mejorado a un camión articulado —
   maquinaria minera).
3. Reorganización visual del formulario "Registrar engrase" (Agregar
   Engrase) en secciones.

Se propuso primero (tabla de columnas/campos reales, sin inventar
ninguno) y se esperó aprobación explícita antes de tocar código.

## 1. Mi Turno — márgenes

**Medido con Playwright antes de proponer nada** (fragmento estático con
la estructura real de `bootLubricador()`/`renderLubricadorHome()` contra
el `styles.css` real): el contenedor (`.lub-content`, 14px) y cada
tarjeta (`.lub-eq-btn`, 16px) sumaban un **inset acumulado de 36px por
lado** (10.0% del ancho a 360px) — ningún valor individual excesivo,
pero ninguno usaba la escala `--sp-*` ya declarada y sumados restaban
ancho útil de forma redundante.

**Corrección:** ambos paddings laterales pasan a `var(--sp-3)` (12px) —
`.lub-content` y `.lub-eq-btn` (además de `.lub-anomaly-fab`, mismo
patrón de tarjeta ancha, por consistencia). Solo el padding **lateral**
cambia; el vertical (16px) se mantiene igual, así que ningún área
táctil se reduce. Inset resultante: 36px → 30px por lado (12+12+6, el
borde de color de 6px se conserva — es información de estado, no
espacio desperdiciado). Verificado con Playwright: el inset real
medido queda entre 15px y 36px en las 7 resoluciones (tarjetas ni
pegadas al borde ni con margen excesivo).

## 2. Mi Equipo — ícono

**Hallazgo antes de proponer nada:** ningún ícono representaba al
equipo dentro de "Mi Turno" (`.lub-eq-btn` solo mostraba texto) ni en
la pantalla de QR — el único ícono de tipo vehículo en toda la app era
`icon-truck` (camión de reparto genérico, Lucide estándar), usado en el
menú lateral de Administrador/Planificador/Supervisor, invisible para
el rol Lubricador.

**Decisión del usuario:** dibujar un ícono nuevo, camión articulado
(minero) — no reutilizar `icon-truck` tal cual.

**Implementación:** `.icon-hauler` (`styles.css`), en el **mismo
formato exacto** que los 24 íconos ya existentes (SVG inline 24×24,
`stroke`, sin relleno, mismo mecanismo `-webkit-mask-image`/
`mask-image`) — no es una librería nueva, es un ícono más agregado al
mismo sistema, de la misma forma en que se agregó cada uno de los 24
anteriores. Diseño: cabina baja (`M2 19v-4h2.5l2 2v2`) + caja tonel
alta con frente inclinado (`M9 19V8h8l4 5v6`) + 3 ruedas — tándem
trasero, diferenciándolo deliberadamente de `icon-truck` (cabina+caja
del mismo tamaño, 2 ruedas, una sola pieza cerrada).

**Validado antes de integrarlo al código real:**
- Decodificado el data-URI y comparado carácter por carácter contra el
  SVG fuente — coincide exactamente.
- Renderizado vía `mask-image` (la técnica real de la app, no solo como
  imagen de fondo) junto al `icon-truck` real, para comparar.
- Renderizado a los tamaños reales de uso (20/24/32/44/96px) — legible
  incluso al tamaño más pequeño.

Colocado en `.lub-eq-top` de cada tarjeta de "Mi Turno" (`app.js`),
antes del código del equipo. `.lub-eq-top` cambió de
`justify-content: space-between` (2 hijos) a `align-items: center; gap:
8px` (3 hijos: ícono, código, chip) con `margin-left: auto` en
`.status-chip` para mantener el chip de estado alineado a la derecha
— mismo resultado visual que antes, con el ícono nuevo integrado.

## 3. Agregar Engrase — reorganización visual

**PASO A — inventario real** (`startGreaseFlow()`, `app.js`, en orden
de aparición): Horómetro actual · "Sin horómetro/dañado" (checkbox) ·
motivo (condicional) · Tipo de grasa · Cantidad (kg) · "Registrar como
ATRASADO" (checkbox, solo Planificador/Administrador) con sus 3 campos
condicionales · Checklist de puntos de engrase (dinámico) · Condición
encontrada · Observaciones · Fotografías · "Reportar anomalía" (botón
secundario) · "Finalizar engrase" (botón primario, submit). Detalle
completo con tipo/obligatoriedad/función de cada campo documentado en
la propuesta previa a esta fase (conversación) — **ningún campo se
agregó, quitó, renombró ni reordenó** en el `FormData` que se envía al
guardar.

**Reorganización aplicada** — los mismos campos, agrupados bajo 4
encabezados de sección (`.grease-section`/`.grease-section-head`, misma
tipografía que `.checklist-head h4` para consistencia):

- **Horómetro**: horómetro actual + checkbox sin horómetro + motivo.
- **Engrase**: tipo de grasa + cantidad + bloque retroactivo (si
  aplica) + checklist de puntos + condición encontrada (movida aquí
  desde el segundo `form-grid` original — es parte del engrase, no de
  la evidencia).
- **Evidencia**: observaciones + fotografías.
- **Finalizar** (`.grease-section-final`, con borde superior separador):
  "Reportar anomalía" (secundario) + "Finalizar engrase" (primario).

**Botón primario más prominente en móvil:** `.btn.btn-grease-submit
{ min-height: 52px; font-size: 16px; }` dentro de `@media (max-width:
640px)` — dos clases a propósito: la regla de accesibilidad `.btn {
min-height: var(--tap) }` (44px) vive más abajo en el archivo (sección
"MEJORAS DE DISEÑO Y ACCESIBILIDAD", con prioridad de cascada
deliberada) y con una sola clase la habría ganado por orden de
declaración pese a la especificidad igual — confirmado con un test que
falló primero (47px medido, no 52px) y se corrigió así.

## Espaciado — uso controlado de `--sp-*`

Tal como se pidió, `--sp-*` se usó **solo en las reglas tocadas por
esta fase** (`--sp-3` en paddings de Mi Turno, `--sp-4`/`--sp-5` en el
nuevo `.grease-section`/`.grease-section-final`) — no se tocaron los
227 valores crudos restantes del archivo. `--fs-*` no se tocó en esta
fase (no hizo falta para estos cambios).

## Verificación automatizada

Dos specs nuevos, ninguno requiere login (fragmentos estáticos con la
estructura/clases REALES, texto de relleno, nunca datos de producción):

- **`tests/ui/lubricador-mi-turno.spec.js`**: sin scroll horizontal,
  ícono visible con tamaño no nulo, inset izquierdo entre 15px y 36px
  (medido relativo al propio `.lub-content`, no al borde crudo del
  viewport — a ≥640px `.lub-content` se centra con `max-width`).
- **`tests/ui/lubricador-grease-form.spec.js`**: las 3 secciones
  (Horómetro/Engrase/Evidencia) en el orden correcto, sin scroll
  horizontal, y en móvil el botón "Finalizar engrase" mide ≥48px de
  alto y es al menos tan ancho como "Reportar anomalía".

**`npm run test:ui`: 35/35 PASS** (5 specs × 7 resoluciones, incluidas
explícitamente 360/390/412/768/1366 pedidas para esta fase).

## Regresión completa

`npm test`: 125/125 PASS. `npm run typecheck`: PASS. `npm run
build:web`: PASS. `npm run lint:css`: 0 errores, 56 warnings (idénticos
a fases anteriores, ninguno nuevo — se corrigió en el camino un
`selector-not-notation` sobre CSS ya existente antes de esta fase, ver
Fase 2). `npm run preview`: login visible, 0 errores de JavaScript. `npx
cap sync android` + `./gradlew assembleDebug`: **BUILD SUCCESSFUL**.
**Android real: NO PROBADO** (Samsung no conectado). Sin cambios en
Supabase, IndexedDB, `sync.js`, Service Worker, lógica de negocio,
TypeScript.

## Qué NO se hizo en esta fase (a propósito)

Tocar formularios fuera de "Registrar engrase"; tocar la Matriz Semanal;
cambiar validaciones, campos, orden de guardado o cualquier lógica de
negocio; modificar `db.js`/`sync.js`/Supabase/IndexedDB; instalar una
librería de íconos nueva; usar una fotografía o rediseñar el logo/
branding; tocar TypeScript; refactorizar `styles.css` fuera de las
reglas de estas 3 pantallas; los 22 `@media` dispersos, los 56 warnings
de Stylelint, `--sp-*`/`--fs-*` fuera de lo tocado — siguen clasificados
como deuda técnica CSS, sin tocar.

## Pendiente

Validación manual del usuario en dispositivo real (Samsung no conectado
durante esta fase) — Mi Turno, ícono de equipo y formulario de
Registrar engrase completos, en campo.
