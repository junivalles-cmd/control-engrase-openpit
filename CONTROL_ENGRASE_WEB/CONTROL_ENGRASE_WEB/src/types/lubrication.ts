// src/types/lubrication.ts
//
// Tipos del dominio de Control de Engrase — SOLO declaraciones (sin código en
// tiempo de ejecución), por eso Vite nunca necesita procesar ni copiar este
// archivo (no está referenciado desde index.html/manifest.json/sw.js, así
// que tools/runtime-file-set.mjs tampoco lo incluye en dist/). Existen
// únicamente para que `tsc --noEmit` (npm run typecheck) pueda verificar
// tipos en los archivos .js que opten por `// @ts-check`.
//
// Campos tomados de objetos REALES del código fuente (no inventados):
//   - Equipment: default de app.js (línea ~2781) + statusFor()/estadoCelda()
//     en src/core/lubrication-status.js y src/core/weekly-matrix.js.
//   - LubricationPlan: creación de plan en app.js (línea ~3316) +
//     statusFor()/weekdayStatusFor() en src/core/lubrication-status.js.
//   - LubricationRecord/LubricationDetail: creación de registro en app.js
//     (línea ~4371) + evaluateAnomalyActions() en
//     src/core/anomaly-actions.js.
//   - Anomaly: objeto creado en evaluateAnomalyActions()
//     (src/core/anomaly-actions.js).
//
// Deliberadamente NO exhaustivos: solo los campos que alguno de los 6
// módulos de src/core/ realmente lee o escribe. Ver docs/TYPESCRIPT_MIGRATION.md.

/** Código de estado de engrase que devuelven statusFor()/weekdayStatusFor()/estadoCelda(). */
export type EstadoCode = 'VERDE' | 'AMARILLO' | 'ROJO' | 'GRIS';

/** Tipo de celda de la Matriz Semanal (src/core/weekly-matrix.js). */
export type CeldaTipo = 'vacio' | 'hecho' | 'futuro' | 'no_realizado' | 'pendiente';

export interface Equipment {
  id: string;
  code?: string;
  shortCode?: string;
  description?: string;
  brand?: string;
  model?: string;
  serial?: string;
  typeId?: string;
  locationId?: string;
  /** Solo se compara explícitamente contra 'Operativo' en lubrication-status.js — otros valores existen pero no se enumeran aquí porque no se leyeron en el código analizado. */
  status: string;
  hourmeter: number;
  shiftId?: string;
  cuadrillaId?: string;
}

export interface LubricationPlan {
  id: string;
  equipmentId: string;
  /** 'Día y turno de la semana' | 'Horas de operación' (visto en app.js) — no se tipa como unión cerrada porque no se confirmó la lista completa de valores posibles. */
  controlType: string;
  frequency: number;
  lastGreaseHour: number;
  alertYellowHours?: number;
  active?: boolean;
  /** Nombres de día en español, ver WEEKDAY_NAMES en src/core/lubrication-status.js. */
  assignedDays?: string[];
  /** Reprogramación puntual de esta semana — ver src/core/lubrication-status.js weekdayStatusFor(). */
  reprogramadoHasta?: string;
  reprogramadoMotivo?: string;
}

export interface LubricationDetail {
  pointId: string;
  pointName: string;
  done: boolean;
  reason?: string;
}

export interface LubricationRecord {
  id: string;
  equipmentId: string;
  planId: string | null;
  date: string;
  shiftId: string;
  hourmeter: number;
  userName: string;
  sinHorometro?: boolean;
  noHourmeterReason?: string;
  details?: LubricationDetail[];
  photos?: string[];
}

export interface Anomaly {
  id: string;
  equipmentId: string;
  component: string;
  description: string;
  criticality: 'Baja' | 'Media' | 'Alta' | 'Crítica';
  status: string;
  photos: string[];
  photo: string | null;
  autoGenerada?: boolean;
  autoPointId?: string;
  repeticiones?: number;
}
