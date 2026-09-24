# AUDITORÍA RESPONSIVE COMPLETA — CONTROL DE ENGRASE

Fecha: 2026-09-24
Rama: `migration-typescript`
Alcance: TODAS las pantallas, formularios, tablas y modales del sistema (roles ADMINISTRADOR, PLANIFICADOR, SUPERVISOR, LUBRICADOR, VISOR), en 7 anchos: **360 / 390 / 412 / 768 / 1024 / 1366 / 1920**.

## Método

Auditoría **estática de código**, no interactiva: lectura de cada función `render*()` en `app.js` y de las reglas/`@media` correspondientes en `styles.css`, razonando el layout resultante en cada ancho. **No se usó un navegador en vivo contra la app real** — el proyecto tiene credenciales reales de Supabase de producción precargadas al primer arranque (`db.js: DEFAULT_SYNC_CONFIG`) y sincroniza automáticamente cada 20s; una verificación visual en vivo dentro de esta misma sesión ya escribió datos de prueba a producción por accidente (incidente `VERIF-01`, documentado y limpiado — ver `docs/AUTOMATED_TESTS.md`). Por eso esta fase se hizo 100% por lectura de código, sin logins reales ni datos falsos nuevos.

Registrar Engrase (`renderRegistrar`/`startGreaseFlow`) y Mi Turno (`renderLubricadorHome`) **no están en esta auditoría** — ya se rediseñaron y corrigieron en las fases anteriores de esta misma sesión (cards responsive, `.grease-flow-panel`, contenedor 720px@768/960px@1024+), y quedan como referencia de PASS.

## Inventario de pantallas (extraído del código real)

Ruteo real: `PERMISSIONS` (app.js:1010-1016), `MENU` (app.js:1681-1695), mapa de rutas admin-family (app.js:1803-1807), shell Lubricador `bootLubricador()` (app.js ~1824) con sus 4 rutas propias.

| Pantalla | Función | Rol(es) | Formularios | Tablas | Modales | Componentes compartidos |
|---|---|---|---|---|---|---|
| Login | `renderLogin` (1523) | Público | PIN pad | — | — | — |
| Dashboard | `renderDashboard` | Admin/Planif/Superv/Visor | — | "Equipos que requieren atención" | — | `.kpi-grid`, `.data-table`→cards |
| Equipos | `renderEquipos` (2275) | Todos (editar: Admin) | Nuevo/editar equipo, editar en lote | — (cards) | Nuevo/editar equipo, Detalle equipo | `.cards-grid`, `openModal()` |
| Plan de Engrase | `renderPlan` (2865) | Admin/Planif (Superv/Visor solo lectura) | Config. plan, Punto de engrase, Copiar puntos | Planes por equipo | Configurar plan+puntos | `.weekday-picker`, `.point-row` |
| Matriz Semanal | `renderMatrizSemanal` (3693) | Admin/Planif/Superv/Visor | — | `table.matriz` (día×equipo) | — | scroll+sticky intencional |
| Engrase del Turno | `renderTurno` (3999) | Admin/Planif/Superv | — | Equipos del turno (9 col) | — | `.data-table` |
| Registrar Engrase | `renderRegistrar`/`startGreaseFlow` | Admin/Planif/Superv/Lubricador | Registrar engrase | — | — | **ya corregido esta sesión** |
| Actualizar Horómetros | `renderHorometros` (4497) | Admin/Planif | Actualizar horómetro inline | Equipos+horómetro | Importar desde Excel (preview) | `.data-table` |
| Anomalías | `renderAnomalias` (4598) | Admin/Superv/Lubricador | Reportar/editar anomalía | Anomalías (9 col) | Reportar/editar anomalía | `photoFieldHTML()` |
| Lubricantes | `renderLubricantes` (4762) | Admin | Nuevo/editar lubricante | Lubricantes | Nuevo/editar lubricante | `GREASE_UNIT` (ya en lb) |
| Historial | `renderHistorial` (4834) | Admin/Planif/Superv/Visor | Filtros búsqueda, selector equipo | Búsqueda general, Historial por equipo, Anomalías del equipo | — | `.data-table`→cards |
| Reportes | `renderReportes` (5038) | Admin/Planif/Visor | Filtros reporte | Puntos no engrasados | — | `.kpi-grid`, `.charts-grid` (Chart.js), export CSV/Excel |
| Usuarios | `renderUsuarios` (5844) | Admin/Superv | Nuevo/editar usuario | Usuarios | Nuevo/editar usuario | `.data-table`→cards |
| Configuración | `renderConfig` (~6906) | Admin | General, Notificaciones, Sync, +7 paneles más | Registro de auditoría, push-tokens | — | 10 `.panel` apilados |
| Ayuda | `renderAyuda` (6169) | Todos (branch interno: Admin ve editor) | Editor familia, Editor FAQ (solo Admin) | — | Editor familia, Editor FAQ | `.family-card`, `.faq-item` |
| Mi Turno (Lubricador) | `renderLubricadorHome` | Lubricador | — | — (cards) | — | **ya corregido esta sesión** |
| Mis Engrases (Lubricador) | `renderLubricadorHistorial` (1937) | Lubricador | Editar engrase | — (cards) | Editar engrase | `.lub-content` |
| Shell Admin/Planif/Superv/Visor | `boot()` (1698) | Todos excepto Lubricador | — | — | — | `.sidebar`, `.topbar`, `.bottom-nav` |
| Shell Lubricador | `bootLubricador()` (1824) | Lubricador | — | — | — | `.lub-topbar`, `.lub-user-strip`, `.lub-bottom-nav` |

**17 pantallas únicas** (por función de render), **2 shells de navegación** distintos por diseño (Lubricador tiene una interfaz simplificada dedicada — documentado como decisión intencional, no un problema de duplicación).

## Matriz de hallazgos completa

`ID | Pantalla | Rol | Tipo | 360 | 390 | 412 | 768 | 1024 | 1366 | 1920 | Problema | Severidad | Archivo | Selector/función | Propuesta`

### Shell, Dashboard, Equipos, Plan de Engrase, Matriz Semanal

| ID | Pantalla | Rol | Tipo | 360 | 390 | 412 | 768 | 1024 | 1366 | 1920 | Problema | Severidad | Archivo | Selector/función | Propuesta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UI-FULL-001 | Todos los modales (transversal) | Todos | Componente | PASS | WARN | WARN | PASS | PASS | PASS | PASS | El tratamiento móvil de `.modal` (bottom-sheet, `.detail-grid` a 1 col) solo activa en `@media(max-width:380px)`. En 390/412 (mismos celulares reales) el modal vuelve a comportarse como desktop: caja centrada, `.detail-grid` en 2 columnas de ~150px. | P2 | styles.css:330-363 | `.modal`, `.detail-grid` en `@media(max-width:380px)` | Subir el breakpoint a ~480px, igual que otros ajustes móviles ya existentes en el archivo |
| UI-FULL-002 | Shell/Navegación | Todos | Componente | PASS | PASS | PASS | PASS | PASS | PASS | PASS | `.sidebar` fijo ≥901px, `.bottom-nav`+hamburguesa ≤900px, sin solape ni hueco. | — | styles.css:252-345 | `.sidebar`, `.bottom-nav` | — |
| UI-FULL-003 | Dashboard | Admin/Planif/Superv/Visor | Pantalla | PASS | PASS | PASS | PASS | PASS | PASS | PASS | "Equipos que requieren atención" (antes UI-ANDROID-005) ya usa `.col-secondary` + `makeTablesResponsive()`. `.kpi-grid` con escalera monótona ya corregida. | — | app.js:2062-2231 | `renderDashboard` | — |
| UI-FULL-004 | Equipos | Todos | Pantalla | PASS | PASS | PASS | PASS | PASS | PASS | PASS | `.cards-grid` (auto-fill 230px) reflowa con el ancho; toolbar de 5 botones envuelve bien. | — | app.js:2275-2314 | `renderEquipos` | — |
| UI-FULL-005 | Equipos → Nuevo/editar equipo | Admin | Modal/Formulario | PASS | WARN | WARN | PASS | PASS | PASS | PASS | Hereda UI-FULL-001. El formulario en sí (11 campos, `.form-grid`) está bien resuelto. | P2 (heredado) | app.js:2784-2827 | `openEquipmentForm` | Ver UI-FULL-001 |
| UI-FULL-006 | Equipos → Detalle equipo | Todos | Modal | PASS | WARN | WARN | PASS | PASS | PASS | PASS | Caso más afectado por UI-FULL-001: `.detail-grid` de 8 campos queda en 2 columnas muy angostas en 390/412. | P2 (heredado) | app.js:2566-2576 | `.detail-grid` (styles.css:656) | Ver UI-FULL-001 |
| UI-FULL-007 | Plan de Engrase | Admin/Planif | Pantalla | PASS | PASS | PASS | WARN | PASS | PASS | PASS | Toolbar con hasta 5 botones de texto largo puede ocupar 3-4 líneas en 768 antes de la tabla — no bloquea, solo empuja contenido. | P3 | app.js:2884-2892 | `.toolbar` en `renderPlan` | Agrupar en menú "..." desde tablet hacia abajo |
| UI-FULL-008 | Plan de Engrase → Configurar plan+puntos | Admin/Planif | Modal | PASS | WARN | WARN | PASS | PASS | PASS | PASS | Hereda UI-FULL-001. `.weekday-picker` y `.point-row` ya tienen su propio manejo responsive correcto. | P2 (heredado) | app.js:3346-3398 | `openPlanForm`, `pointRow` | Ver UI-FULL-001 |
| UI-FULL-009 | Matriz Semanal (tabla) | Admin/Planif/Superv/Visor | Tabla | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Diseño intencional ya documentado (UI-RESP-006): scroll horizontal + columna "Equipo" sticky, `width:100%`, aprovecha el ancho en desktop. | — | app.js:3693-3759; styles.css:1119-1152 | `renderMatrizSemanal` | — |
| UI-FULL-010 | Matriz Semanal (pantalla) | Admin/Planif/Superv/Visor | Pantalla | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Toolbar de filtros ya tiene ajuste móvil dedicado (`.matriz-rango` ≤640px). | — | app.js:3777-3792 | `.toolbar` | — |

### Engrase del Turno, Horómetros, Anomalías, Lubricantes, Mis Engrases

| ID | Pantalla | Rol | Tipo | 360 | 390 | 412 | 768 | 1024 | 1366 | 1920 | Problema | Severidad | Archivo | Selector/función | Propuesta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UI-FULL-101 | Engrase del Turno | Admin/Planif/Superv | Tabla | FAIL | FAIL | FAIL | WARN | PASS | PASS | PASS | `renderTurno()` nunca llama `makeTablesResponsive(c)` (a diferencia de `renderPlan`/`renderLubricantes`). La tabla de 9 columnas SÍ se apila por CSS puro en ≤680px, pero **sin `data-label`** — cada celda queda sin etiqueta, ilegible (4 números seguidos: Horómetro/Último/Próximo/Restante). | P1 | app.js:3999-4035 | `renderTurno()` | Agregar `makeTablesResponsive(c)` |
| UI-FULL-102 | Actualizar Horómetros | Admin/Planif | Tabla | FAIL | FAIL | FAIL | PASS | PASS | PASS | PASS | Mismo bug: `renderHorometros()` no llama `makeTablesResponsive(c)`. Input y botón siguen tocables, pero "horómetro anterior" vs "actual" pierde contexto. | P1 | app.js:4497-4544 | `renderHorometros()` | Agregar `makeTablesResponsive(c)` |
| UI-FULL-103 | Horómetros → Importar Excel (preview) | Admin/Planif | Modal/Tabla | FAIL | FAIL | FAIL | PASS | PASS | PASS | PASS | Mismo bug dentro de un modal — `openModal()` no llama `makeTablesResponsive` automáticamente. | P1 | app.js:4564-4578 | `handleHourmeterExcelImport()` | Llamar `makeTablesResponsive()` sobre el contenedor tras `openModal()` |
| UI-FULL-104 | Anomalías (Admin/Supervisor) | Admin/Superv | Tabla | WARN | WARN | WARN | PASS | PASS | PASS | PASS | `makeTablesResponsive` SÍ se llama, pero ninguna de las 9 columnas está marcada `col-secondary` (a diferencia del Dashboard) — tarjeta apilada muy larga en móvil. | P2 | app.js:4598-4672 | `renderAnomalias()` | Marcar 2-3 columnas (Responsable, Foto) como `col-secondary` |
| UI-FULL-105 | Anomalías (vista Lubricador) | Lubricador | Pantalla | PASS | PASS | PASS | WARN | WARN | WARN | WARN | Misma función, pero dentro de `.lub-content` (max-width 560px desde 640px) **sin la excepción** que ya tiene Registrar Engrase (`:has(.grease-flow-panel)`). Sobran ~1360px a los lados en 1920. | P2 | styles.css:812-815 | `.lub-content` (global, no tocar) | Excepción scoped nueva para esta vista, sin tocar `.lub-content` para el resto del Lubricador |
| UI-FULL-106 | Modal "Reportar/Editar anomalía" | Todos | Modal/Formulario | PASS | PASS | PASS | WARN | WARN | WARN | WARN | `<textarea name="description">` sin `class="span-2"` — queda a media columna junto al select de Criticidad, inconsistente con el resto de la app. | P3 | app.js:4727 | `openAnomalyForm()` | Agregar `class="span-2"` |
| UI-FULL-107 | Lubricantes | Admin | Tabla | PASS | PASS | PASS | PASS | PASS | PASS | PASS | `makeTablesResponsive` correcto, 6-7 columnas, sin problemas. | — | app.js:4762-4790 | `renderLubricantes()` | — |
| UI-FULL-108 | Modal "Nuevo/editar lubricante" | Admin | Modal/Formulario | PASS | PASS | PASS | PASS | PASS | PASS | PASS | 6 inputs de texto simples, bien resuelto en los 7 anchos. | — | app.js:4792-4814 | `lubForm()` | — |
| UI-FULL-109 | Mis Engrases (Lubricador) | Lubricador | Pantalla | PASS | PASS | PASS | WARN | WARN | WARN | WARN | Lista de tarjetas en columna única, mismo cap de 560px que UI-FULL-105 — espacio vacío en tablet/desktop. | P2 | styles.css:812-815 / app.js:1937-1963 | `renderLubricadorHistorial()` | Excepción scoped de ancho, o grid de 2 columnas desde 768px |
| UI-FULL-110 | Modal "Editar engrase" (Lubricador) | Lubricador | Modal/Formulario | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Funcional y sin overflow, pero usa el `.form-grid`/`.checklist-item` PLANO de antes del rediseño en cards de Registrar Engrase — inconsistencia visual entre registrar y editar el mismo tipo de dato. | P3 | app.js:1966-2011 | `openEditGreaseRecordForm()` | Alinear visualmente con `.grease-flow-*` si se decide (fuera de esta fase) |

### Historial, Reportes, Usuarios

| ID | Pantalla | Rol | Tipo | 360 | 390 | 412 | 768 | 1024 | 1366 | 1920 | Problema | Severidad | Archivo | Selector/función | Propuesta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UI-FULL-201 | Historial — Búsqueda General | Admin/Planif/Superv/Visor | Tabla | WARN | WARN | WARN | PASS | PASS | PASS | PASS | Tabla de 9 columnas se apila en tarjeta de 9 líneas label:valor — funciona pero sin recorte de columnas secundarias. | P2 | app.js:4921-4943 | `runGeneralSearch()` | Marcar Turno/Foto como `col-secondary`, igual que Dashboard |
| UI-FULL-202 | Historial — Historial por Equipo | Admin/Planif/Superv/Visor | Tabla | WARN | WARN | WARN | PASS | PASS | PASS | PASS | Misma situación que UI-FULL-201 (8-9 columnas). | P2 | app.js:4986-5006 | `drawHistory()` | Igual: columnas secundarias ocultas en móvil |
| UI-FULL-203 | Historial — Anomalías del equipo | Admin/Planif/Superv/Visor | Tabla | PASS | PASS | PASS | PASS | PASS | PASS | PASS | 6 columnas, tarjeta apilada razonable. | — | app.js:5011-5016 | — | — |
| UI-FULL-204 | Historial (pantalla) | Admin/Planif/Superv/Visor | Pantalla | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Sin `max-width` propio — correcto para tablas (a diferencia de un formulario). | — | app.js:4841-4873 | — | — |
| UI-FULL-205 | Reportes — KPI grid | Admin/Planif/Visor | Componente | PASS | PASS | PASS | PASS | WARN | WARN | WARN | Solo 4 tarjetas en un grid fijo de 6 columnas desde 1101px — 2 columnas vacías, tarjetas angostas. | P3 | styles.css:378 | `.kpi-grid` en Reportes | `auto-fit minmax(160px,1fr)` o limitar a 4 columnas |
| UI-FULL-206 | Reportes — gráficas | Admin/Planif/Visor | Gráfico | PASS | PASS | PASS | PASS | WARN | FAIL | FAIL | `.charts-grid` fijo en 2 columnas desde 901px (nunca 3+), `.chart-box` altura fija 240px — canvases muy anchos y achatados en 1366/1920, última fila desperdicia la mitad del ancho. | P2 | styles.css:722-724 | `.charts-grid` | Escalar a 3 col ≥1300-1400px o `auto-fit minmax(340px,1fr)` con `aspect-ratio` |
| UI-FULL-207 | Reportes — filtros | Admin/Planif/Visor | Formulario | PASS | PASS | PASS | PASS | PASS | PASS | PASS | `.toolbar`/`.filter-label` envuelve limpio en los 7 anchos. | — | app.js:5070-5091 | — | — |
| UI-FULL-208 | Reportes — Puntos no engrasados | Admin/Planif/Visor | Tabla | WARN | WARN | WARN | PASS | PASS | PASS | PASS | Tarjeta apilada genérica aceptable, pero "Motivo" (el dato más importante) no destaca. | P3 | app.js:5275-5287 | `drawSkippedPoints()` | Opcional: resaltar el motivo en la vista de tarjeta |
| UI-FULL-209 | Reportes — informe fotográfico | Admin/Planif/Visor | Componente | PASS | PASS | PASS | PASS | PASS | PASS | PASS | `auto-fill minmax(140px,1fr)` ya escala columnas con el ancho. | — | styles.css:711-712 | `.photo-report-grid` | — |
| UI-FULL-210 | Reportes — exportar CSV/Excel | Admin/Planif/Visor | Componente | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Botones en toolbar flex-wrap, sin problemas. | — | app.js:5119-5134 | — | — |
| UI-FULL-211 | Usuarios (tabla) | Admin/Superv | Tabla | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Solo 5 columnas, tarjeta apilada corta y legible. | — | app.js:5860-5873 | `renderUsuarios()` | — |
| UI-FULL-212 | Usuarios → Nuevo/editar usuario | Admin/Superv | Modal/Formulario | PASS | PASS | PASS | PASS | PASS | PASS | PASS | `.modal` (620px, 88vh, scroll interno) + `.form-grid` genérico, 7 campos bien distribuidos. | — | app.js:5875-5910 | `userForm()` | — |

### Login, Configuración, Ayuda, componentes compartidos

| ID | Pantalla | Rol | Tipo | 360 | 390 | 412 | 768 | 1024 | 1366 | 1920 | Problema | Severidad | Archivo | Selector/función | Propuesta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UI-FULL-301 | Login | Público | Pantalla | PASS | PASS | PASS | PASS | PASS | PASS | PASS | `.login-card` compacta y centrada en 1920 es correcta para un login de acción única — no es el mismo problema que un formulario de trabajo. | — | styles.css:187-190 | `.login-card` | — |
| UI-FULL-302 | Login | Público | Componente | WARN | WARN | WARN | WARN | WARN | WARN | WARN | Botón de tema (`.icon-btn.theme-btn`) mide ~41px de ancho, sin `min-width` — por debajo del objetivo táctil de 44px en el eje horizontal, en TODOS los anchos (no es un problema de breakpoint). | P3 | styles.css:369,1278 | `.icon-btn` | Agregar `min-width: var(--tap)` |
| UI-FULL-303 | Login | Público | Componente | PASS | PASS | PASS | PASS | PASS | PASS | PASS | `.login-users` con scroll interno (44vh), ningún botón cortado con los 5 usuarios actuales. | — | styles.css:209-215 | `.login-users` | — |
| UI-FULL-304 | Configuración | Admin | Pantalla | WARN | WARN | WARN | WARN | WARN | WARN | WARN | 10 `.panel` apilados en una sola columna en TODOS los anchos. En desktop cada panel se ensancha pero su contenido (2-4 campos) deja mucho espacio vacío — mismo patrón de "no aprovechar el ancho" que tenía Registrar Engrase, en su variante "panel ancho con contenido disperso". Obliga al mismo scroll larguísimo en 1920 que en 360. | P2 | app.js:6906-7044 | `renderConfig()` | En ≥1024px, agrupar paneles relacionados en 2-3 columnas (grid scoped, sin tocar `.panel` global) |
| UI-FULL-305 | Configuración — Registro de auditoría | Admin | Tabla | FAIL | FAIL | FAIL | PASS | PASS | PASS | PASS | Nunca recibe `makeTablesResponsive()` (a diferencia de la tabla de push-tokens en la misma pantalla, que sí la recibe) — sin `data-label`, la tabla se apila SIN etiquetas: fecha/acción/detalle/usuario indistinguibles en móvil. | P1 | app.js:7039-7044 | tabla sin `makeTablesResponsive()` | Agregar la llamada, igual que ya se hace para push-tokens (línea 7098) |
| UI-FULL-306 | Configuración — formularios generales/sync | Admin | Formulario | PASS | PASS | PASS | PASS | PASS | PASS | PASS | `.form-grid` estándar, campos cortos, funciona en ambas configuraciones. | — | app.js:6929-6999 | `#general-form`, `#sync-form` | — |
| UI-FULL-307 | Configuración — Notificaciones | Admin | Formulario | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Lista vertical de tarjetas, legible en cualquier ancho, aunque podría ir en 2 columnas en desktop. | P3 | app.js:6948-6969 | `notifCardHTML()` | Opcional: 2 columnas ≥1024px |
| UI-FULL-308 | Ayuda | Todos | Pantalla | PASS | PASS | PASS | PASS | PASS | WARN | WARN | `.family-zones` (`flex:1 1 260px`) puede estirarse mucho junto a un diagrama fijo de 260px en 1366/1920, dejando una columna de texto muy ancha y dispersa. | P3 | app.js:6169-6210 | `.family-body`, `.family-zones` | Opcional: `max-width` a `.family-zones` en pantallas muy anchas |
| UI-FULL-309 | Ayuda — diagramas de familia | Todos | Componente | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Quiebre dedicado en 700px ya resuelto correctamente. | — | styles.css:447-458 | `.family-card .family-body` | — |
| UI-FULL-310 | Ayuda (editor) | Admin | Modal | PASS | PASS | PASS | PASS | PASS | PASS | PASS | `.modal` genérico (620px/88vh/scroll interno) nunca corta contenido ni oculta el botón guardar en ninguno de los 7 anchos. | — | styles.css:345-359,641-654 | `openModal()` | — |
| UI-FULL-311 | Campo de fotos (transversal) | Todos | Componente | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Reutilizado en Registrar Engrase, editor de familias, editor de punto — comportamiento uniforme, ninguna instancia rota. | — | app.js:47-130 | `photoFieldHTML()` | — |
| UI-FULL-312 | Estados vacíos / leyenda de colores (transversal) | Todos | Componente | PASS | PASS | PASS | PASS | PASS | PASS | PASS | `.empty-state`/`.color-legend-item` consistentes, sin dependencias de ancho problemáticas. | — | styles.css:407,670-675 | `.empty-state`, `.color-legend` | — |
| UI-FULL-313 | KPI grid (transversal, informativo) | Todos | Componente | PASS | PASS | PASS | WARN | PASS | PASS | PASS | 4 columnas exactamente en el rango 901-1100px (incluye 1024) — comportamiento YA intencional de una fase anterior (escalera monótona), no es un hallazgo nuevo. Sin acción. | — (informativo) | styles.css:378-382 | `.kpi-grid` | Ninguna — ya es el diseño validado |

## Recomendación de estrategia por tabla (A/B/C/D)

| Tabla | Estrategia actual | Recomendación |
|---|---|---|
| `table.matriz` (Matriz Semanal) | A — scroll horizontal + columna sticky | Mantener (diseño intencional, ya validado) |
| Dashboard "Equipos que requieren atención" | B + `col-secondary` | Mantener (ya corregido en fase anterior) |
| Engrase del Turno | B pero rota (falta `makeTablesResponsive`) | **B — activar la llamada faltante (P1)** |
| Actualizar Horómetros | B pero rota | **B — activar la llamada faltante (P1)** |
| Horómetros → import preview | B pero rota (modal) | **B — activar en el modal (P1)** |
| Configuración → auditoría | B pero rota | **B — activar la llamada faltante (P1)** |
| Anomalías | B, sin recorte de columnas | B + agregar `col-secondary` a 2-3 columnas |
| Historial — Búsqueda General | B, sin recorte | B + `col-secondary` |
| Historial — por equipo | B, sin recorte | B + `col-secondary` |
| Historial — anomalías del equipo | B | Mantener, ya es corta |
| Reportes — puntos no engrasados | B | Mantener, opcional resaltar motivo |
| Lubricantes | B | Mantener |
| Usuarios | B | Mantener |

Ninguna tabla del sistema (fuera de `table.matriz`, que ya lo justifica por ser una grilla día×equipo) necesita scroll horizontal (A) — todas tienen pocas columnas comparadas con esa.

## Inventario de formularios (consolidado)

| Formulario | Campos | Móvil | Tablet | Desktop |
|---|---|---|---|---|
| Login PIN | PIN (password) | 1 fila | igual | igual |
| Nuevo/editar equipo | code, shortCode, description(span-2), brand, model, serial, typeId(select), locationId(select), status(select), hourmeter(number), shiftId(select), cuadrillaId(select) | 1 col | 2 col | 2 col |
| Editar en lote (Equipos) | locationId, shiftId, typeId (selects) | 1 col | 2 col | 2 col |
| Plan de engrase | controlType(select,span-2) + condicional: frequency/lastGreaseHour/alertYellowHours(number) o shiftId+7 checkboxes de día | 1 col | 2 col | 2 col |
| Punto de engrase | recommendedQty(number, ya en lb), greaseType(select), point/system/component/notes(text) | 1 col | 2 col | 2 col |
| Registrar Engrase | (ya rediseñado esta sesión — cards, ver fases anteriores) | 1 col | 1 col ancho 720 | 2 col ancho 960 |
| Editar Engrase (Lubricador) | hourmeter(number,span-2), greaseType(select), qty(number, ya en lb), checklist dinámico, condition(select), notes(textarea,span-2), fotos(span-2) | 1 col | 2 col | 2 col — visualmente distinto del nuevo Registrar Engrase (P3, UI-FULL-110) |
| Reportar/editar anomalía | equipmentId(select), tipo(select), description(textarea, **sin span-2**), criticidad(select), estado(select), fotos(span-2) | 1 col | 2 col — descripción a media columna (P3, UI-FULL-106) | igual |
| Nuevo/editar lubricante | name, brand, type, grade, code, unit — 6 text | 1 col | 2 col | 2 col |
| Actualizar horómetro (inline) | input number + botón, por fila de tabla | — | — | — |
| Filtros — Búsqueda General (Historial) | Desde/Hasta(date), Turno/Familia/Estado(select), botón | 1 col apilada | 2 por fila | 1 fila |
| Filtros — Reportes | Desde/Hasta(date), Equipo/Turno/Responsable(select), botón | 1 col apilada | 2 por fila | 1 fila |
| Nuevo/editar usuario | name, username, PIN, role(select), shiftId(select), locationId(select), cuadrillaId(select) | 1 col | 2 col | 2 col |
| Configuración — general | inicio turno día/noche(time), alerta amarilla(number), meta cumplimiento(number) | 1 col | 2 col | 2 col |
| Configuración — notificaciones | 2 checkboxes maestros + 6 tarjetas (checkbox+time+checkboxes de rol) | 1 col (lista) | igual | igual — podría ir a 2 col (P3, opcional) |
| Configuración — sync | Project URL, Anon key (text) | 1 col | 2 col | 2 col |
| Ayuda — editor de familia | name, drawing(select), photo(campo de fotos), zonas dinámicas(repetible) | 1 col | igual | igual |
| Ayuda — editor de FAQ | pregunta(text), respuesta(textarea) por fila | 1 col | igual | igual |

No se encontraron inputs `datetime-local` combinados fecha+hora fuera de Registrar Engrase (ya corregido); los formularios de fecha usan `date` simple (Historial, Reportes).

## Resumen final

TOTAL PANTALLAS: **17** (por función `render*` única — incluye las 2 ya corregidas esta sesión: Registrar Engrase, Mi Turno)

TOTAL FORMULARIOS: **18** (tabla de inventario arriba)

TOTAL MODALES: **13** (Nuevo/editar equipo, Detalle equipo, Config. plan+puntos, Copiar puntos, Importar horómetros Excel, Reportar/editar anomalía, Nuevo/editar lubricante, Editar engrase Lubricador, Nuevo/editar usuario, Editor familia, Editor FAQ — más el sistema genérico `openModal()`)

TOTAL TABLAS: **14** (Dashboard-atención, Plan de Engrase, Matriz, Engrase del Turno, Horómetros, Horómetros-import, Anomalías, Lubricantes, Historial-búsqueda-general, Historial-por-equipo, Historial-anomalías, Reportes-puntos-no-engrasados, Usuarios, Configuración-auditoría — sin contar push-tokens, que ya está corregida)

TOTAL COMPONENTES RESPONSIVE REVISADOS: **45 filas de hallazgo** (`UI-FULL-001` a `313`, en 4 lotes de auditoría)

**P1: 4** (`UI-FULL-101, 102, 103, 305` — todos el mismo patrón: tabla sin `makeTablesResponsive()`)

**P2: 11** (`UI-FULL-001, 005, 006, 008, 104, 105, 109, 201, 202, 206, 304`)

**P3: 8** (`UI-FULL-007, 106, 110, 205, 208, 302, 307, 308`)

PANTALLAS PASS (sin ningún hallazgo, en ninguno de los 7 anchos): **8** — Dashboard, Equipos, Matriz Semanal, Lubricantes, Usuarios, Login, Registrar Engrase (ya corregido), Mi Turno (ya corregido)

PANTALLAS CON PROBLEMAS: **9** — Plan de Engrase, Engrase del Turno, Actualizar Horómetros, Anomalías, Historial, Reportes, Configuración, Ayuda, Mis Engrases (Lubricador)

MANUAL REQUIRED: **0** — todos los hallazgos se pudieron determinar por lectura de código (estructura HTML + reglas CSS existentes); ninguno dependía de un estado de datos que solo apareciera con una sesión real autenticada.

## Orden de corrección propuesto

**LOTE 1 — P1 (mismo fix, 4 pantallas):**
Agregar la llamada faltante a `makeTablesResponsive()` en: `renderTurno()`, `renderHorometros()`, `handleHourmeterExcelImport()` (modal), y la tabla de auditoría en `renderConfig()`. Un solo patrón repetido, bajo riesgo, alto impacto (hoy esas 4 tablas son genuinamente ilegibles en 360-412).

**LOTE 2 — Modal breakpoint gap (P2, causa raíz de 4 hallazgos):**
Ampliar `@media (max-width: 380px)` → ~480px en las reglas de `.modal`/`.detail-grid` (styles.css:330-363). Corrige de un solo cambio: UI-FULL-001, 005, 006, 008 (Equipos nuevo/editar, Detalle equipo, Plan config+puntos).

**LOTE 3 — Contenedor ancho Lubricador fuera de Registrar Engrase (P2):**
Extender el patrón `:has()` que ya usa Registrar Engrase a Anomalías (vista Lubricador) y Mis Engrases — sin tocar `.lub-content` para Mi Turno/Ayuda, que ya están bien a 560px.

**LOTE 4 — Desktop desperdicia ancho (P2, 3 pantallas):**
Configuración (agrupar los 10 paneles en 2-3 columnas ≥1024px), Reportes (`.charts-grid` a 3 columnas en pantallas anchas), Anomalías/Historial (agregar `col-secondary` a columnas menos críticas).

**LOTE 5 — P3 cosméticos:**
`.icon-btn` sin `min-width` (Login), `textarea` sin `span-2` (Anomalías), KPI grid de Reportes con columnas vacías, `.family-zones` muy ancho en Ayuda, inconsistencia visual Editar-Engrase vs Registrar-Engrase.

Cada lote es independiente y de bajo acoplamiento entre sí — se puede aprobar y ejecutar por separado, validando con Playwright + captura visual después de cada uno, igual que se hizo con Registrar Engrase.
