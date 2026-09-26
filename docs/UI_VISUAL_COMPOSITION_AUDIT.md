# Auditoría visual y de composición — CONTROL DE ENGRASE

Fecha: 2026-09-24
Alcance: composición visual (uso del espacio, jerarquía, alineación, densidad,
grids, cards, formularios, navegación, consistencia entre pantallas) — **no**
es la auditoría de responsividad funcional (`docs/UI_RESPONSIVE_FULL_AUDIT.md`,
ya cerrada). El criterio aquí no es "no hay scroll horizontal = PASS": un
layout de 1920px con 420px de contenido centrado y cero scroll está marcado
como problema (desperdicio de espacio / layout de móvil en desktop).

> **ACTUALIZACIÓN (2026-09-25):** la Causa raíz #1 (`.app-content` sin
> `width:100%`, §3 abajo) **YA ESTÁ RESUELTA**, commit `6f9e59c` ("fix:
> improve desktop lubricator and sidebar layout") — posterior a esta
> auditoría. `styles.css` línea 919 ya declara
> `.app-content { max-width: 1500px; width: 100%; margin: 0 auto; }`. Las
> filas y hallazgos de este documento que citan "Causa raíz #1" (UI-VIS-001,
> 002, 004, 101, 102, 104, 107, 201, 202, 205, 304) quedan **RESUELTOS en
> código**; los porcentajes/regresiones medidos en la tabla de §1 son el
> estado ANTES del fix, no se volvieron a medir con Playwright tras
> `6f9e59c` — pendiente una repetición de las capturas si se necesita
> confirmar el % de utilización actual.

Método: fragmentos estáticos con la estructura/clases REALES de las funciones
`render*()` de `app.js` (nunca la app real, nunca red/Supabase — ver
`docs/AUTOMATED_TESTS.md`), renderizados con `page.setContent()` +
`addStyleTag(styles.css)` en Playwright, en 7 anchos (360/390/412/768/1024/
1366/1920). Se capturó screenshot full-page de cada pantalla × ancho
(`tests/screenshots/admin/`, `tests/screenshots/lubricador/`) y se midió por
código: ancho del contenedor de contenido, columnas de grid, columnas de
formulario, cards visibles, ancho de modal. Todas las medidas de este informe
son datos reales impresos por esos tests (no estimaciones), recolectados en:

- `tests/ui/visual-composition-admin-a.spec.js` — Dashboard, Equipos (+modal),
  Plan de Engrase (+modal), Matriz Semanal.
- `tests/ui/visual-composition-admin-b.spec.js` — Engrase del Turno, Actualizar
  Horómetros (+modal import Excel), Anomalías (Admin y Lubricador +modal),
  Lubricantes (+modal), Mis Engrases (Lubricador), Editar Engrase (modal).
- `tests/ui/visual-composition-admin-c.spec.js` — Historial (búsqueda general
  y por equipo), Reportes, Usuarios (+modal).
- `tests/ui/visual-composition-admin-d.spec.js` — Registrar Engrase (admin y
  Lubricador, referencia ya rediseñada), Mi Turno (referencia), Configuración
  (referencia), Login, Ayuda (Admin y Lubricador), galería de componentes
  (KPI cards, modal corto, modal largo).

---

## 1. Hallazgos

Esquema: `ID | Pantalla | Rol | 360 | 412 | 768 | 1024 | 1366 | 1920 | Content Width | Problema | Severidad | Selector | Propuesta`

Columnas 360/412/768/1024/1366/1920 = ancho real del contenedor de contenido
medido en px en ese breakpoint (redondeado). "Content Width" resume el % de
utilización del viewport en el peor caso relevante (normalmente 1920px).
Severidad: **V1** (importante) / **V2** (mejora) / **V3** (cosmético).

| ID | Pantalla | Rol | 360 | 412 | 768 | 1024 | 1366 | 1920 | Content Width | Problema | Severidad | Selector | Propuesta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UI-VIS-001 | Dashboard | Admin/Planif/Superv | 360 | 412 | 768 | 784 | 1126 | **1097** | 57% @1920 | `.app-content` no crece de forma consistente con el viewport ≥1400px (1126→1097, prácticamente estancado) por el bug de causa raíz #1 (ver §3) | V1 | `.app-content` | Agregar `width:100%` a la regla `@media(min-width:1400px){.app-content{max-width:1500px}}` |
| UI-VIS-002 | Equipos | Admin/Planif/Superv | 360 (1 col) | 412 (1 col) | 768 (3 col) | 784 (3 col) | 1126 (4 col) | **969 (3 col)** | 50% @1920 y REGRESIÓN de 4→3 columnas al pasar de 1366→1920 | El grid de equipos pierde una columna al agrandar la ventana — la causa raíz #1 hace que `.app-content` se encoja en vez de crecer | V1 | `.app-content`, `.cards-grid` | Mismo fix de causa raíz #1; una vez `.app-content` llegue a 1500px real, el `auto-fill` del grid recuperará 4-5 columnas en 1920px |
| UI-VIS-003 | Plan de Engrase | Admin/Planif | 360 | 412 | 768 | 784 | 1126 | 1143 | 82-89% (aceptable) | Ancho **correcto**: el contenido es una tabla de 8 columnas cuyo ancho natural (~1100px) ya cabe cómodo; no fuerza estiramiento artificial | — (sin hallazgo) | — | — |
| UI-VIS-004 | Matriz Semanal | Admin/Planif/Superv | 360 (tabla 680, scroll propio) | 412 (680) | 768 (742) | 784 (742) | 1126 (1084) | **805 (763)** | 42% @1920, REGRESIÓN 1126→805 | Mismo patrón que Equipos: el contenedor se encoge de 1366→1920 en vez de crecer; la tabla-matriz (estrategia C, scroll propio ya aceptado) queda con aún más espacio vacío alrededor a la derecha | V1 | `.app-content` | Causa raíz #1 |
| UI-VIS-005 | Modal Nuevo/Editar equipo | Admin/Planif | 328 | 380 | 620 (2 col) | 620 (2 col) | 620 (2 col) | 620 (2 col) | — | Ancho correcto: modal de 12 campos en 2 columnas cabe bien en 620px, consistente en todos los breakpoints ≥768 | — (sin hallazgo) | — | — |
| UI-VIS-006 | Modal Configurar plan (plan-config-modal) | Admin/Planif | 328 | 380 | 620 | 620 | 620 | 620 | — | Estructura interna en 1 columna (campos con `span-2`); tamaño consistente, sin desperdicio | — (sin hallazgo) | — | — |
| UI-VIS-101 | Engrase del Turno | Admin/Superv | 336 | 388 | 744 (97%) | 744 (73%) | 1086 (80%) | **1072 (56%)** | 56% @1920 | Panel no escala más allá de ~1086-1072px; a 1920px deja ~45% del ancho vacío a la derecha | V1 | `.app-content > .panel` | Causa raíz #1 |
| UI-VIS-102 | Actualizar Horómetros | Admin/Planif | 336 | 388 | 744 (97%) | 744 (73%) | 1086 (80%) | **740 (38.5%)** | 38.5% @1920 — REGRESIÓN 1086→740 | El contenedor se ENCOGE de 1366 a 1920 (peor caso medido en todo el sistema); tabla de solo 5 columnas queda diminuta en un viewport ultra-ancho | V1 | `.app-content > .panel` | Causa raíz #1 |
| UI-VIS-103 | Modal importar horómetros (Excel) | Admin/Planif | 328 | 380 | 620 | 620 | 620 | 620 | — | Correcto: modal de previsualización con tabla de 4 columnas, tamaño estable | — (sin hallazgo) | — | — |
| UI-VIS-104 | Anomalías (Admin/Superv) | Admin/Superv | 336 | 388 | 744 (97%) | 744 (73%) | 1086 (80%) | **1113 (58%)** | 58% @1920 | Mismo techo bajo de causa raíz #1 (sin la regresión severa de 102, pero igual de desperdiciado) | V1 | `.app-content > .panel` | Causa raíz #1 |
| UI-VIS-105 | Anomalías (Lubricador) | Lubricador | 336 | 388 | 744 (97%) | 1000 (98%) | 1342 (98%) | **1476 (77%)** | 77% @1920 (BUENO, referencia) | Ya corregido en LOTE P2-A (`.lub-content:has(#anom-table)`); confirma que el patrón `width:100%` sí funciona cuando está presente — es la prueba positiva de la causa raíz #1 | — (ya corregido, referencia) | `.lub-content:has(#anom-table)` | — |
| UI-VIS-106 | Modal Reportar/Editar anomalía | Admin/Superv/Lubricador | 328 | 380 | 620 | 620 | 620 | 620 | — | Correcto: 5 campos, 620px es suficiente, sin desperdicio | — (sin hallazgo) | — | — |
| UI-VIS-107 | Lubricantes | Admin/Planif | 336 | 388 | 744 (97%) | 744 (73%) | 1086 (80%) | **759 (39.5%)** | 39.5% @1920 — REGRESIÓN 1086→759 | Mismo patrón severo que Horómetros: se encoge en vez de crecer; tabla de 6 columnas queda muy estrecha en 1920px sobrando ~1160px | V1 | `.app-content > .panel` | Causa raíz #1 |
| UI-VIS-108 | Modal Nuevo/Editar lubricante | Admin/Planif | 328 | 380 | 620 | 620 | 620 | 620 | — | Correcto: 6 campos simples, tamaño adecuado | — (sin hallazgo) | — | — |
| UI-VIS-109 | Mis Engrases (Lubricador) | Lubricador | 336 (1 col) | 388 (1 col) | 744 (2 col, 97%) | 1000 (3 col, 98%) | 1342 (4 col, 98%) | **1476 (4 col, 77%)** | 77% @1920 (BUENO, referencia) | Ya corregido en P2-A; grid de cards escala de 1→4 columnas de forma progresiva y consistente — patrón de referencia a replicar | — (ya corregido, referencia) | `.lub-record-list` | — |
| UI-VIS-110 | Modal Editar engrase (Lubricador) | Lubricador | 328 | 380 | 620 | 620 | 620 | 620 | — | Funcional y sin scroll, pero usa el sistema PLANO `.form-grid`/`.checklist-item` heredado de antes del rediseño — visualmente inconsistente frente a las tarjetas `.grease-flow-*` que Registrar Engrase usa para la MISMA tarea | V2 | `openEditGreaseRecordForm()` | Reutilizar los mismos bloques `.grease-flow-card` (Horómetro / Lubricante / Puntos / Condición / Evidencia) dentro del modal, en vez de mantener dos sistemas visuales distintos para registrar vs. editar un engrase |
| UI-VIS-201 | Historial — búsqueda general | Admin/Planif/Superv | 360 (100%) | 412 (100%) | 768 (100%) | 784 (77%) | 1126 (82%) | **896 (47%)** | 47% @1920, REGRESIÓN 1126→896 | Mismo patrón de causa raíz #1: el panel con filtros + tabla de 9 columnas se encoge en vez de aprovechar 1920px | V1 | `.app-content` | Causa raíz #1 |
| UI-VIS-202 | Historial — por equipo | Admin/Planif/Superv | 360 | 412 | 768 | 784 (77%) | 1126 (82%) | **880 (46%)** | 46% @1920, REGRESIÓN 1126→880 | Igual patrón; además el panel de resumen (`detail-grid`, 4 métricas) y las 2 tablas (Engrases/Anomalías) quedan igual de angostos aunque hay espacio de sobra | V1 | `.app-content` | Causa raíz #1 |
| UI-VIS-203 | Reportes — KPI + gráficas | Admin/Planif/Superv | 360 (1 col) | 412 (1 col) | 768 (2 col) | 784 (2 col) | 1366 (adaptable) | 1920 (adaptable, ya no tope de 2) | — | **RESUELTO** — `.charts-grid` con `repeat(auto-fit, minmax(min(100%,360px),1fr))`: el número de columnas ahora resulta del espacio real en vez de un valor fijo por breakpoint; deja de estar topado en 2 columnas incluso a 1920px | ~~V1~~ RESUELTO | `.charts-grid` | Implementado — commit "fix: improve reports charts responsive layout" |
| UI-VIS-204 | Reportes — chart-box | Admin/Planif/Superv | aspect 16:9 | aspect 16:9 | aspect 16:9 | aspect 16:9 | aspect 16:9 | aspect 16:9 | — | **RESUELTO** — `.chart-box` con `aspect-ratio:16/9; min-height:200px` en vez de `height:240px` fijo: proporción consistente en todos los anchos, ya no hay saltos erráticos (antes 1.39 a 3.09) | ~~V2~~ RESUELTO | `.chart-box` | Implementado — commit "fix: improve reports charts responsive layout" |
| UI-VIS-205 | Usuarios | Admin | 360 (100%) | 412 (100%) | 768 (100%) | 784 (77%) | 1126 (82%) | **736 (38%)** | 38% @1920 (peor caso medido junto con Horómetros) — REGRESIÓN 1126→736 | Tabla de solo 5 columnas queda con más de 1180px vacíos a la derecha en 1920px | V1 | `.app-content` | Causa raíz #1 |
| UI-VIS-206 | Modal Nuevo usuario | Admin | 328 | 380 | 620 (2 col) | 620 (2 col) | 620 (2 col) | 620 (2 col) | — | Correcto: 7 campos en 2 columnas, consistente | — (sin hallazgo) | — | — |
| UI-VIS-301 | Registrar Engrase (Admin) | Admin/Planif/Superv | 336 (93%) | 388 (94%) | 720 (94%) | 744 (73%) | 960 (70%) | **960 (50%)** | 50% @1920 | `.grease-flow-panel` tiene `max-width:960px` fijo — apropiado para móvil/tablet pero dejar 960px fijo desde 1024px en adelante desperdicia ~48% del viewport en desktop grande | V2 | `.grease-flow-panel` | Escalar el `max-width` en un paso adicional para desktop ancho (p.ej. 1100-1200px desde ~1600px), o mantener 960 pero centrar con más aire visual explícito (no es tan grave como causa raíz #1 porque es una decisión de diseño consciente, no un bug de flex) |
| UI-VIS-302 | Mi Turno (Lubricador) | Lubricador | 360 (100%) | 412 (100%) | 560 (**73%**) | 560 (**55%**) | 560 (**41%**) | 560 (**29%**) | 29% @1920 — el peor y más consistente desperdicio de todo el sistema | `.lub-content` tiene un techo DURO de 560px que nunca se levanta desde 768px hasta 1920px — el shell Lubricador no tiene ningún modo "desktop": mismo bottom-nav, mismo ancho fijo, en un monitor de escritorio se ve como un teléfono estirado con márgenes enormes | **V1 (la más severa)** | `.lub-content` | Definir un modo desktop real para el shell Lubricador: liberar el `max-width` de `.lub-content` de forma progresiva desde 768px (mismo patrón ya usado en P2-A para `#anom-table`/`.lub-record-list`, pero aplicado como comportamiento POR DEFECTO del contenedor, no solo para esas 2 pantallas) |
| UI-VIS-303 | Registrar Engrase (Lubricador) | Lubricador | 336 | 388 | 720 | 960 | 960 | 960 | 50% @1920 (mejor que Mi Turno porque ESTA pantalla sí tiene su override) | Misma pantalla que UI-VIS-301 dentro del shell Lubricador — el `.grease-flow-panel` sí escala a 960 aquí (bien), pero solo porque esta ruta específica ya tenía ese ancho liberado; expone que el resto del shell Lubricador (Mi Turno, Ayuda) no sigue el mismo criterio | V2 | `.lub-content` | Mismo fix que UI-VIS-302 — unificar el criterio en todo el shell, no pantalla por pantalla |
| UI-VIS-304 | Configuración | Admin | 1 col (≤1023) | — | — | 2 col (364px×2=728px) | 2 col (535px×2=1070px) | **2 col (526px×2=1052px)** | Estancado/REGRESIÓN leve 1366→1920 (1070→1052px) | Ya tiene el grid de 2 columnas de P2-A (correcto), pero el ancho total del grid no crece de 1366 a 1920 — mismo síntoma que causa raíz #1: el padre `.app-content` no le da más espacio al hijo | V2 | `.app-content` | Causa raíz #1 (una vez resuelta, los paneles de 2 columnas de Configuración crecerán proporcionalmente; considerar además un techo razonable, p.ej. `minmax(320px,600px)` por columna, para que no se vuelvan demasiado anchos en 1920px) |
| UI-VIS-305 | Login | (público) | 320 (89%) | 372 (90%) | 420 (55%) | 420 (41%) | 420 (31%) | 420 (22%) | 22% @1920 | Card de login fija en 420px — **correcto por diseño** (un formulario de login centrado no debe ocupar 1920px); no se considera hallazgo | — (sin hallazgo, correcto) | `.login-card` | — |
| UI-VIS-306 | Ayuda — Admin | Admin | — | — | — | — | — | — | sin scroll horizontal en ningún ancho | Estructura de paneles apilados igual que Configuración pre-P2-A; no comparte el grid de 2 columnas | V3 | `.app-content` (Ayuda) | Si se desea, aplicar el mismo patrón `:has()` de 2 columnas usado en Configuración (bajo impacto, contenido mayormente texto/FAQ) |
| UI-VIS-307 | Ayuda — Lubricador | Lubricador | — | — | — | — | — | — | sin scroll horizontal | Vive dentro de `.lub-content`, por lo tanto hereda el mismo techo de 560px que UI-VIS-302 | V2 | `.lub-content` | Mismo fix que UI-VIS-302 |
| UI-VIS-308 | Galería — KPI cards | Admin (referencia) | 2 col | 2 col | 3 col | 4 col | 6 col | 6 col | — | Progresión de columnas correcta y suave (2→3→4→6); patrón de referencia sano | — (sin hallazgo, correcto) | `.kpi-grid` | — |
| UI-VIS-309 | Galería — modal corto (6 campos) | Admin (referencia) | 328 | 380 | 620 | 620 | 620 | 620 | — | Consistente, sin desperdicio | — (sin hallazgo) | — | — |
| UI-VIS-310 | Galería — modal largo (8 campos, detail-grid) | Admin (referencia) | 328 | 380 | 620 | 620 | 620 | 620 | — | Mismo ancho que el modal corto (620px) para el doble de contenido — se ve razonablemente bien en las capturas, pero es el límite superior recomendable para `detail-grid`; no forzar modales de más de ~10 campos al mismo ancho | V3 | `.modal` | Ninguna acción requerida ahora; vigilar si se agregan más campos a modales de detalle |

---

## 2. TOP 15 PROBLEMAS DE DISEÑO DEL SISTEMA (ordenados por impacto visual)

1. **`.app-content` no se estira a su `max-width` en pantallas ≥1400px** (causa raíz #1) — afecta Dashboard, Equipos, Matriz, Engrase del Turno, Actualizar Horómetros, Anomalías (Admin), Lubricantes, Historial (×2), Reportes, Usuarios, Configuración: 11 de 14 pantallas admin. En varios casos (Equipos, Matriz, Horómetros, Lubricantes, Historial×2, Usuarios) el contenido **se encoge** al pasar de 1366px a 1920px en vez de crecer — peor que simplemente "no aprovechar el espacio".
2. **El shell Lubricador no tiene modo desktop** (`.lub-content` con techo duro de 560px desde 768px hasta 1920px) — Mi Turno cae a 29% de utilización en 1920px, el peor caso medido en todo el sistema. Afecta Mi Turno, Ayuda (Lubricador); ya fue parcialmente resuelto para 2 pantallas (Anomalías-Lubricador, Mis Engrases) en P2-A pero no se generalizó al resto del shell.
3. **Actualizar Horómetros, Lubricantes y Usuarios son los 3 peores casos concretos** de la causa raíz #1: caen a 38-40% de utilización en 1920px con una regresión real (el contenido se encoge de 1366 a 1920px), para tablas de solo 4-6 columnas que quedan diminutas con ~1150-1180px vacíos a la derecha.
4. **`.charts-grid` de Reportes fijo en 2 columnas desde 1024px hasta 1920px**, con 5 gráficas → siempre 1 celda vacía en la última fila, sin aprovechar el ancho extra de 1920px para pasar a 3 columnas.
5. **Modal "Editar engrase" (Lubricador) usa un sistema visual distinto al de "Registrar Engrase"** para la misma tarea — `.form-grid`/`.checklist-item` plano vs. las tarjetas `.grease-flow-card` — inconsistencia de composición entre dos pantallas que deberían verse como la misma familia de UI.
6. **`.grease-flow-panel` fijo en 960px desde 1024px hasta 1920px** — decisión de diseño razonable pero deja 50% de un monitor de escritorio grande sin usar; candidato a un paso adicional de escala en vez de un tope duro único.
7. **`chart-box` con alto fijo (240px) contra ancho variable** produce aspect ratios erráticos (3.09 en tablet, 1.51 en 1024px, 2.23 en 1366px) — las gráficas se ven proporcionalmente distintas según el breakpoint sin una razón de contenido.
8. **Configuración: el grid de 2 columnas (ya corregido en P2-A) no crece de 1366px a 1920px** (1070px→1052px) — mismo síntoma de causa raíz #1 filtrándose incluso en una pantalla ya intervenida.
9. **Ayuda (Admin y Lubricador) no comparte el patrón de grid de 2 columnas de Configuración**, a pesar de tener contenido de tipo/longitud similar (paneles informativos apilados) — inconsistencia menor pero visible si se comparan ambas pantallas lado a lado.
10. **Equipos pierde una columna de cards al pasar de 1366px (4 columnas) a 1920px (3 columnas)** — una regresión contraintuitiva: la grilla se vuelve MÁS angosta en un monitor MÁS ancho, causada por el mismo bug de causa raíz #1.
11. **Matriz Semanal pasa de 1126px de contenedor en 1366px a solo 805px en 1920px** — la tabla-matriz (que ya tiene scroll horizontal propio, estrategia aceptada) queda con aún más espacio vacío alrededor en viewports grandes.
12. **Historial (ambas vistas) cae a 46-47% de utilización en 1920px** con el mismo patrón de encogimiento — dos paneles de datos densos (tabla de 9 columnas y detail-grid + 2 tablas) que se beneficiarían más que ninguna otra pantalla de recuperar el ancho completo.
13. **Dashboard es la pantalla menos afectada de causa raíz #1** (57% de utilización, sin regresión de columnas) pero aun así se estanca entre 1366px y 1920px en vez de seguir creciendo junto con el viewport.
14. **Dos pantallas de referencia ya diseñadas correctamente** (Login: 420px fijo por diseño; Galería KPI: progresión 2→3→4→6 columnas) confirman que el sistema SÍ sabe producir composición correcta — refuerza que los problemas anteriores son un defecto puntual (una propiedad CSS faltante), no una limitación de diseño del sistema.
15. **Modal largo (`detail-grid`, 8 campos) comparte el mismo ancho de 620px que el modal corto** (6 campos) — funciona hoy, pero es el límite superior recomendable; no es un problema activo, se deja como línea de vigilancia.

---

## 3. CAUSAS RAÍZ REPETIDAS (soluciones reutilizables, no parches por pantalla)

> Por instrucción explícita: no se proponen arreglos individuales por pantalla
> cuando varias comparten el mismo origen. Las 4 causas siguientes explican
> prácticamente todos los hallazgos V1/V2 de este informe.

### Causa raíz #1 — `.app-content` no declara `width:100%` en su regla de ancho máximo

**Afecta:** 11 pantallas admin (Dashboard, Equipos, Matriz, Engrase del Turno,
Actualizar Horómetros, Anomalías-Admin, Lubricantes, Historial×2, Reportes,
Usuarios) + indirectamente Configuración (su grid interno hereda el mismo
techo).

`.main` es `display:flex; flex-direction:column`, y `.app-content` es un
elemento hijo de ese flex container. La regla actual:

```css
@media (min-width: 1400px) {
  .app-content { max-width: 1500px; margin: 0 auto; }
}
```

no incluye `width: 100%`. Sin un `width` explícito, un flex item con
`margin:auto` no se estira al espacio disponible del eje cruzado — se
encoge a su contenido (shrink-to-fit), por eso varias pantallas
literalmente se ENCOGEN al pasar de 1366px a 1920px en vez de crecer. El
patrón ya correcto existe en `.lub-content` (que si incluye `width:100%`) y
es la base de por qué Anomalías-Lubricador y Mis Engrases (ya corregidas en
P2-A) SÍ escalan bien. Confirmado también que la nueva regla P2-A de 1500px
para `.lub-content:has(...)` puede tener el mismo problema si no hereda el
`width:100%` de la regla base.

**Fix de una línea, reutilizable en un solo lugar:** agregar `width: 100%;`
a la regla `@media(min-width:1400px){.app-content{...}}` (y confirmar que la
regla equivalente para `.lub-content:has(...)` en el mismo breakpoint también
lo tenga). No se toca ninguna pantalla individualmente — todas las 11
pantallas de la lista se resuelven con ese único cambio.

### Causa raíz #2 — El shell Lubricador no tiene un modo de composición para desktop

**Afecta:** Mi Turno, Ayuda (Lubricador), y parcialmente Registrar Engrase
(Lubricador) — que sí escala porque tiene su propio override, exponiendo que
el resto del shell no sigue el mismo criterio.

`.lub-content` tiene un `max-width:560px` que nunca se levanta desde 768px en
adelante para el caso GENERAL (solo se levantó puntualmente vía `:has()` para
2 rutas específicas en P2-A). El shell entero fue diseñado pensando solo en
móvil: mismo bottom-nav en todos los anchos, mismo header, mismo límite de
560px.

**Solución reutilizable:** en vez de seguir agregando `:has()` pantalla por
pantalla, definir el comportamiento de ancho progresivo de `.lub-content`
como el comportamiento POR DEFECTO del contenedor (mismos breakpoints/valores
que ya se usaron en P2-A: sin límite desde 768px, `max-width:1500px` desde
1400px, siempre con `width:100%`), reservando `:has()` solo para los casos
que de verdad deban comportarse distinto (por ejemplo, si se decide que
formularios largos como Registrar Engrase deban seguir topados en 960px por
legibilidad, eso ya lo resuelve `.grease-flow-panel` de forma independiente).

### Causa raíz #3 — Patrón de `max-width` fijo en vez de escala progresiva para paneles de trabajo estrechos

**Afecta:** `.grease-flow-panel` (960px fijo desde 1024px), y en menor medida
`.modal` (620px fijo desde 768px, aceptable para formularios cortos/medianos
pero es el mismo patrón).

Es una decisión de diseño válida para formularios de 5-10 campos, no un bug
como las dos anteriores — pero al no tener ningún paso adicional de escala
para desktop grande dejan 30-50% del viewport vacío en 1920px de forma
consistente. **Menor prioridad que #1 y #2** porque no hay regresión (el
contenido no se encoge, solo deja de crecer), pero se documenta como el mismo
tipo de causa para no tratarlo como 2 hallazgos aislados.

### Causa raíz #4 — `.charts-grid` con columnas fijas en vez de `auto-fit`/paso adicional

**Afecta:** solo Reportes, pero se documenta como causa raíz porque el patrón
(grid con número de columnas fijo por breakpoint, sin considerar el número de
items) es el mismo error conceptual que causas #1-#3: el layout no responde
al espacio real disponible. Con 5 chart-boxes en grid fijo de 2 columnas
siempre sobra 1 celda vacía en la última fila y nunca se usa una 3ª columna
aunque el viewport lo permita ampliamente en 1920px.

---

## 4. Secciones de resumen requeridas

### Pantallas con layout móvil en desktop (contenido angosto sobreviviendo a ≥1024px)

Mi Turno (560px fijo, 29% @1920 — el peor caso), Ayuda-Lubricador (hereda
560px), Registrar Engrase Admin+Lubricador (960px fijo, 50% @1920).

### Pantallas que desperdician espacio (causa raíz #1, encogimiento o estancamiento ≥1366px)

Actualizar Horómetros (38.5%, con regresión), Usuarios (38%, con regresión),
Lubricantes (39.5%, con regresión), Historial-por-equipo (46%, con
regresión), Historial-búsqueda (47%, con regresión), Reportes (46%),
Matriz Semanal (42%, con regresión), Equipos (50%, con regresión de
columnas 4→3), Dashboard (57%), Engrase del Turno (56%), Anomalías-Admin
(58%), Configuración (grid estancado 1366→1920).

### Pantallas con grid mejorable

Equipos (pierde columna al agrandar — causa raíz #1), Reportes/`.charts-grid`
(fijo en 2 columnas, 1 celda vacía siempre — causa raíz #4).

### Formularios con grid mejorable

Ninguno de los formularios/modales medidos presenta un problema de columnas
en sí mismos (todos escalan correctamente entre 1 y 2 columnas según su
número de campos); el único hallazgo de formulario es de CONSISTENCIA, no de
grid: Editar Engrase (Lubricador) usa un sistema visual distinto
(`.form-grid`/`.checklist-item`) al de Registrar Engrase (`.grease-flow-*`)
para la misma tarea (UI-VIS-110).

### Modales mejorables

Ninguno presenta desperdicio de espacio o problema de columnas — todos los
modales medidos (equipo, plan, anomalía, lubricante, usuario, horómetros-
import, editar-engrase, galería corto/largo) mantienen un ancho estable y
razonable (328-620px según breakpoint) consistente con su cantidad de
campos. Único punto de vigilancia (no acción): el modal largo de 8 campos
comparte ancho con el modal corto de 6 (UI-VIS-310, V3).

---

## 5. Pantallas ya corregidas (referencia positiva)

Anomalías (Lubricador) y Mis Engrases (Lubricador) — ambas del LOTE P2-A —
son la prueba de que el patrón `width:100%` + liberar el `max-width` resuelve
el problema por completo: 77-98% de utilización en todos los breakpoints
≥768px, sin ninguna regresión al pasar de 1366 a 1920px. Son la referencia de
comportamiento correcto que el resto del sistema debería igualar mediante las
causas raíz #1 y #2 de la sección 3.
