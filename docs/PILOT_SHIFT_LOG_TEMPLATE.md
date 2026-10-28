# Bitácora de Turno — Piloto v1.0.0-rc1

Una copia de este archivo por turno observado. Nombrar
`PILOT_SHIFT_<fecha>_<lubricador>.md` y guardar junto a este template
(no sobrescribir el template). Completar en campo, en el momento —
reconstruir de memoria al final del turno pierde precisión.

No completar ningún campo con datos inventados: dejar en blanco o
anotar "no observado" si no se pudo verificar.

## 1. Pre-check (antes del turno)

Correr primero `tools/pilot-precheck.ps1 -Serial <serial>` y pegar su
salida aquí, luego completar los 7 campos visuales que el script no
puede decidir por sí solo:

```
(pegar salida de tools/pilot-precheck.ps1 aquí)
```

| Campo | Valor |
|---|---|
| DEVICE | |
| USER | |
| CREW | |
| LOCATION | |
| APP_VERSION | |
| SYNC_STATE | |
| PUSH_STATE | |

## 2. Observación de uso real (durante el turno)

Anotar con hora aproximada cuando sea posible.

| Hora | Observación |
|---|---|
| | Tiempo para abrir Mi Turno: |
| | Tiempo para registrar un engrase completo: |
| | Nº de taps/pasos que pareció excesivo (si hubo): |
| | Duda del lubricador (texto literal): |
| | Error de interpretación observado: |
| | Botón que costó encontrar: |
| | Texto confuso (citar): |
| | Campo que pareció sobrar: |
| | Acción repetitiva/accidental: |
| | Momento donde el PIN molestó: |
| | Cambios de estado de sync observados: |
| | Evento offline (cuándo, cuánto duró): |
| | Reconexión (automática / requirió acción): |
| | Uso de fotos: |
| | Uso de Tareas: |
| | Uso de Anomalías: |
| | Uso de Historial: |
| | Campana/notificaciones recibidas: |

## 3. Hallazgos de esta observación

Para cualquier ítem de la sección 2 que merezca registrarse como
hallazgo formal, crear una entrada en `docs/PILOT_ISSUES_TEMPLATE.md`
(no duplicar el texto aquí — solo referenciar el ID):

| ID del hallazgo | Resumen de una línea |
|---|---|
| | |

## 4. Cierre de turno

| Campo | Valor |
|---|---|
| TOTAL_ENGRASES | |
| TOTAL_TAREAS | |
| TOTAL_ANOMALIAS | |
| SYNC_WARNINGS | |
| SYNC_ERRORS | |
| DUPLICATES | |
| LOST_RECORDS | |

Verificado contra el backend/Historial real (no solo "parece que sí"):
- [ ] Registros del turno llegaron
- [ ] Sin duplicados
- [ ] Pendientes mostrados correctos
- [ ] Tareas correctas
- [ ] Historial correcto
- [ ] Fotos visibles
- [ ] Anomalías visibles
- [ ] Mensajes leídos/no leídos correctos
- [ ] Sync final en estado normal

## 5. Feedback del lubricador (preguntar al final, preguntas prácticas)

Registrar literalmente la respuesta cuando sea útil — no resumir ni
suavizar.

1. ¿Qué fue lo más fácil? —
2. ¿Qué fue lo más lento? —
3. ¿Qué pantalla te confundió? —
4. ¿Qué botón no encontraste rápido? —
5. ¿Te pidió PIN demasiado? —
6. ¿Pudiste trabajar sin internet? —
7. ¿Qué quitarías? —
8. ¿Qué agregarías? —
