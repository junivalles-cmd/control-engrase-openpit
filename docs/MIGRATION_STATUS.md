# ESTADO DE LA MIGRACIÓN

## FASE 0 — Protección del estado actual con Git
**Estado:** COMPLETADA (2026-09-23)

- Repositorio Git inicializado en la raíz `CONTROL_ENGRASE`.
- `.gitignore` configurado (ver `docs/DECISIONS.md` para el detalle de cada
  exclusión).
- Commit baseline creado: `c6d6f786fe53e657dd76c6edfa32ba1df8d816cc` en
  `master`.
- Rama de trabajo `migration-typescript` creada a partir del baseline.
- **No se movió, copió, borró ni modificó ningún archivo de código
  (`app.js`, `db.js`, `sync.js`, `capacitor.config.json`, etc.).**

## Próximas fases (NO iniciadas)

Estas fases se planificarán y ejecutarán en conversaciones futuras, una por
una, con confirmación explícita antes de cada paso:

- **FASE 1 (propuesta, no iniciada):** decidir y documentar cuál será la
  única fuente de verdad del frontend (¿`CONTROL_ENGRASE_WEB`?, ¿`www`?,
  ¿una carpeta nueva compartida?) antes de tocar ningún archivo.
- **Migración a TypeScript:** sin iniciar. La rama `migration-typescript`
  existe pero no contiene cambios de código todavía.
- **Herramienta de build (Vite u otra):** sin instalar, sin evaluar en
  profundidad todavía.
- **Unificación real de `CONTROL_ENGRASE_WEB` y `www`:** sin iniciar.
