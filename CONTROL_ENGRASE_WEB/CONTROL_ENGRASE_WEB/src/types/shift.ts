// src/types/shift.ts
//
// Tipos del dominio de turnos — solo declaraciones, mismo motivo que
// src/types/lubrication.ts (ver ese archivo). Campos tomados directamente
// de src/core/shifts.js (currentShiftId, dentroDeSuTurno) y de cómo
// tests/unit/turnos.test.js construye su `fakeApp` (que refleja la forma
// real de App.currentUser/App.generalSettings usada en app.js).

export type ShiftId = 'shift_dia' | 'shift_noche';

export interface CurrentUser {
  role: string;
  shiftId: ShiftId | null;
}

export interface GeneralSettings {
  shiftDayStart: number;
  shiftNightStart: number;
  /** Solo usados por dentroDeSuTurno(); opcionales porque esa función ya los trata con `?? valor_por_defecto`. */
  minutosAntesDelTurno?: number;
  minutosDespuesDelTurno?: number;
  soloEnTurno?: boolean;
}
