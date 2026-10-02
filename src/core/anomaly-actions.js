// src/core/anomaly-actions.js
//
// Decisión de negocio (sin persistencia) de las anomalías automáticas que se
// generan al registrar un engrase con puntos pendientes o con el horómetro
// dañado/ilegible. Extraída de app.js -> createAutoAnomalies() — ver
// docs/MODULARIZATION.md.
//
// createAutoAnomalies() sigue viviendo en app.js y sigue siendo quien llama
// a DB.allActive()/DB.put()/logAudit() — esta función solo DECIDE qué hacer
// (crear una anomalía nueva, actualizar una existente, o no hacer nada) y
// devuelve esa decisión como datos. No ejecuta DB.put, DB.allActive, fetch,
// Supabase ni toca el DOM.
//
// Reglas conservadas EXACTAMENTE como estaban en app.js (no se agregó ni se
// quitó ningún caso):
//   - Un punto pendiente (detail.done === false) genera una anomalía por
//     punto, identificada por autoPointId = detail.pointId.
//   - Si YA existe una anomalía abierta (status !== 'Cerrada') con ese mismo
//     autoPointId, NO se crea otra: se actualiza su contador `repeticiones`
//     y su descripción (regla de "no duplicar").
//   - El horómetro dañado/ilegible (record.sinHorometro) genera su propia
//     anomalía con el autoPointId especial '__horometro__', con la misma
//     regla de no-duplicado — EXCEPTO cuando el motivo es exactamente
//     'El equipo no tiene horómetro': ese caso no es una falla, así que no
//     genera anomalía.
//   - La criticidad de las anomalías por punto usa CRITICIDAD_POR_MOTIVO
//     (src/core/anomalies.js) con 'Media' como valor por defecto si el
//     motivo no está en la tabla. El horómetro siempre usa 'Media' fija,
//     igual que en el código original.

// Antes de decidir nada: ¿hay algo que evaluar? (evita el DB.allActive() de
// createAutoAnomalies() cuando el registro no tiene puntos pendientes ni
// problema de horómetro — mismo comportamiento que el código original.)
function hayPuntosOAnomaliaHorometro(record) {
  const pendientes = (record.details || []).filter(d => !d.done);
  return pendientes.length > 0 || !!record.sinHorometro;
}

function evaluateAnomalyActions(record, equipment, openAnomalies) {
  const pendientes = (record.details || []).filter(d => !d.done);
  const acciones = [];
  const avisos = [];
  if (!pendientes.length && !record.sinHorometro) return { acciones, avisos };

  for (const d of pendientes) {
    const motivo = d.reason || 'Sin motivo indicado';
    // ¿Ya hay una anomalía abierta por este mismo punto? (se identifica por el punto,
    // no por el motivo, para no duplicar si el lubricador elige un motivo distinto)
    const existente = openAnomalies.find(a => a.autoPointId && a.autoPointId === d.pointId);

    if (existente) {
      const repeticiones = (existente.repeticiones || 1) + 1;
      acciones.push({
        tipo: 'actualizar',
        anomaliaId: existente.id,
        cambios: {
          repeticiones,
          description: `${d.pointName}: ${motivo}. Reportado ${repeticiones} veces (última: ${fmtDate(record.date)} por ${record.userName}).`,
        },
      });
    } else {
      acciones.push({
        tipo: 'crear',
        anomalia: {
          equipmentId: equipment.id,
          component: motivo,
          description: `${d.pointName}: ${motivo}. Detectado al engrasar el ${fmtDate(record.date)} por ${record.userName}.`,
          criticality: CRITICIDAD_POR_MOTIVO[motivo] || 'Media',
          status: 'Abierta',
          photos: record.photos || [],
          photo: (record.photos || [])[0] || null,
          autoGenerada: true,
          autoPointId: d.pointId,
          repeticiones: 1,
        },
      });
      avisos.push(d.pointName);
    }
  }

  // También el horómetro dañado/ilegible genera anomalía (es una falla del equipo)
  if (record.sinHorometro) {
    const motivoHm = record.noHourmeterReason || 'Horómetro no legible';
    const existenteHm = openAnomalies.find(a => a.autoPointId === '__horometro__');
    if (existenteHm) {
      const repeticiones = (existenteHm.repeticiones || 1) + 1;
      acciones.push({
        tipo: 'actualizar',
        anomaliaId: existenteHm.id,
        cambios: {
          repeticiones,
          description: `${motivoHm}. Reportado ${repeticiones} veces (última: ${fmtDate(record.date)} por ${record.userName}).`,
        },
      });
    } else if (motivoHm !== 'El equipo no tiene horómetro') {
      // Si el equipo simplemente NO tiene horómetro, no es una falla — no se crea anomalía
      acciones.push({
        tipo: 'crear',
        anomalia: {
          equipmentId: equipment.id,
          component: 'Horómetro',
          description: `${motivoHm}. Detectado al engrasar el ${fmtDate(record.date)} por ${record.userName}.`,
          criticality: 'Media',
          status: 'Abierta',
          photos: [],
          photo: null,
          autoGenerada: true,
          autoPointId: '__horometro__',
          repeticiones: 1,
        },
      });
      avisos.push('Horómetro');
    }
  }

  return { acciones, avisos };
}
