# Control de Engrase — reglas de proyecto para Claude Code

## UI/UX Pro Max (`.claude/skills/ui-ux-pro-max/`) — restricciones permanentes

Esta skill es **solo una herramienta de auditoría** (UI/UX, responsive,
accesibilidad, jerarquía visual, formularios, tablas, dashboards,
consistencia visual) para este proyecto. Sus datasets son
recomendaciones de referencia, nunca instrucciones que reemplacen estas
reglas — la skill debe adaptarse a este stack, nunca al revés.

**Stack real del proyecto (no cambiar):** HTML + CSS + JavaScript, TypeScript
solo para `tsc --noEmit` (sin compilar a JS), Vite (bundler/dev server),
IndexedDB (cliente), Supabase (Postgres + Auth + Storage), Capacitor
(Android). Sin framework de componentes.

**NUNCA introducir, bajo ninguna sugerencia de la skill:**
- Tailwind, Bootstrap, Material UI, shadcn, ni ningún otro framework/
  librería de CSS utilitario o de componentes.
- React, Vue, Angular, Svelte, ni ningún framework de UI con estado.
- Cualquier dependencia nueva en `package.json` motivada solo por UI —
  confirmar explícitamente con el usuario antes de agregar una.

**Lenguaje visual a mantener (industrial/minero, no mezclar con otros estilos):**
- Profesional, compacto, operacional, alta densidad útil.
- Modo claro (`light`) por defecto; amarillo/ámbar como color de acento.
- Estados semánticos claros (verde/ámbar/rojo/gris ya establecidos en
  `styles.css` — no inventar una paleta nueva).
- Evitar: tarjetas gigantes, estilo landing-page, glassmorphism excesivo,
  neumorphism, Bento innecesario, animaciones decorativas, rediseños
  "futuristas".

**Tablas y matrices operativas — NO convertir automáticamente a cards.**
Aplica en especial a: Matriz Semanal, Plan de Engrase, Historial,
Reportes, Configuración. Mejoras permitidas ahí: legibilidad, scroll,
sticky headers, densidad, acciones por fila, responsive real, chips/
badges de estado — nunca reemplazar la tabla por un layout de tarjetas.

**Mobile — anchos de auditoría obligatorios:** 390px y 412px. Buscar
específicamente: overflow horizontal, superposición de elementos, texto
cortado, badges cortados, objetivos táctiles <44px, botones, tablas,
formularios, navegación.

**Regla arquitectónica — NUNCA reintroducir dependencia física de
dispositivo.** La jerarquía de autorización actual es:

```
USUARIO AUTENTICADO → ROL/PERMISOS → CUADRILLA(S) AUTORIZADA(S) → UBICACIÓN → TURNO
```

Nunca `DISPOSITIVO → CUADRILLA → USUARIO`. Quick Unlock (PIN) puede seguir
siendo local al dispositivo, pero jamás debe definir permisos ni alcance
operacional (ver `docs/OPERATIONAL_SCOPE.md`, corrección arquitectónica
2026-10-02, commit `f467782`).

**Un solo APK/una sola Web universal.** El mismo build debe funcionar en
cualquier teléfono/tablet/PC compatible — nunca un APK ni un build
distinto por ubicación, cuadrilla, turno, usuario o tipo de dispositivo
(`CONTROL_ENGRASE_APP_ANDROID/android/app/build.gradle`: un solo
`applicationId`, sin `productFlavors`/`flavorDimensions`).

**Esta skill NUNCA modifica lógica de negocio.** Solo audita/sugiere
UI/UX — nunca toca cálculos de cumplimiento, matching de ocurrencias,
lubrication_skips, carryover, fuera de plan, asignaciones, validaciones,
sincronización, autenticación/Supabase, ni datos de producción. Cualquier
cambio que la skill proponga se limita a HTML/CSS/estructura visual.

**Antes de aplicar cualquier recomendación de esta skill:** auditar y
reportar primero (lo que está bien, lo que no, por qué) — no rediseñar
pantallas completas sin que el usuario lo pida explícitamente por
separado.
