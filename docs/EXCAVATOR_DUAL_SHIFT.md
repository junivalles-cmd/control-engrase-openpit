# Excavadoras: doble engrase diario

Una excavadora puede tener dos ocurrencias independientes por fecha operacional: `shift_dia` y `shift_noche`. La política se expresa en el plan mediante `requiredShifts: ["shift_dia", "shift_noche"]` y una `effectiveDate` explícita. Antes de esa fecha se conserva la semántica anterior; no se crean ocurrencias históricas ni se infieren consumos, firmas o faltantes.

La identidad de una ocurrencia dual es `planId:operationalDate:shiftId`. Un engrase DAY solo puede resolver DAY; NIGHT solo puede resolver NIGHT. Los planes heredados continúan usando sus claves actuales mientras no tengan la configuración y fecha efectiva explícitas. Los planes por horómetro de equipos que no estén configurados como duales mantienen su ciclo basado en `lastGreaseHour`.

La fecha operacional de NIGHT corresponde a la fecha en que comienza el turno. La hora posterior a medianoche se determina con el inicio del turno Día configurado en `settings/general`; no se agregan horarios nuevos. `record.date` continúa guardando el instante real de ejecución y el snapshot conserva `operationalDate`, `shiftId` y `occurrenceKey` para conciliación y reportes.

La configuración de producción aún requiere revisión de los planes activos. `docs/EXCAVATOR_DUAL_SHIFT_PREFLIGHT_READ_ONLY.sql` enumera excavadoras, tipos, ubicación, planes, turnos, fecha efectiva y planes faltantes o duplicados. Es una consulta manual de solo lectura; no se conecta ni se ejecuta desde la aplicación.

Los gateways preparados deben validar la ocurrencia contra plan, fecha operacional, turno y scope en servidor. Los archivos SQL preparados no se aplican con este cambio.
