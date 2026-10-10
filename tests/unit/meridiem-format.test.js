// tests/unit/meridiem-format.test.js
//
// Bug real reportado: Ficha del equipo → "Última ejecución" mostraba
// "02:42 p. m. p. m." (meridiano duplicado). Causa real (NO era el
// formatter): openEquipmentDetail()/openGreaseRecordDetailModal() ponían
// fmtDate() (fecha+hora+meridiano) en el campo "Fecha" justo al lado de un
// campo "Hora" separado para el MISMO timestamp — la columna angosta
// envolvía el meridiano de "Fecha" en una segunda línea que visualmente
// caía debajo de "Hora", pareciendo "02:42 p. m. p. m.". fmtDate() en sí
// nunca duplicó nada (confirmado ejecutándolo real en el WebView del
// dispositivo). Fix: fmtDateOnly()/fmtTime() (globales, mismo Intl de
// siempre, nunca concatenan nada a mano) separan fecha de hora en los dos
// sitios reales con este patrón.

import { describe, it, expect } from 'vitest';
import { readSource, buildModuleBody } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);

function loadFormatters() {
  const body = buildModuleBody(appSource, ['fmtDate', 'fmtDateOnly', 'fmtTime']);
  const factory = new Function(body);
  return factory();
}

describe('fmtDateOnly()/fmtTime() — cada mitad de fmtDate() por separado, sin duplicar el meridiano', () => {
  const { fmtDate, fmtDateOnly, fmtTime } = loadFormatters();
  const isoPM = '2026-10-08T20:42:27.615Z'; // 02:42 p. m. en es-NI (UTC-6)
  const isoAM = '2026-10-08T14:15:00.000Z'; // 08:15 a. m. en es-NI

  it('fmtTime() de un timestamp PM contiene exactamente una marca "p. m."', () => {
    const r = fmtTime(isoPM);
    expect((r.match(/p\.\s?m\./gi) || []).length).toBe(1);
    expect(r).not.toMatch(/p\.\s?m\..*p\.\s?m\./i);
  });

  it('fmtTime() de un timestamp AM contiene exactamente una marca "a. m."', () => {
    const r = fmtTime(isoAM);
    expect((r.match(/a\.\s?m\./gi) || []).length).toBe(1);
    expect(r).not.toMatch(/a\.\s?m\..*a\.\s?m\./i);
  });

  it('fmtDateOnly() NUNCA incluye hora/meridiano (es la mitad "fecha" de fmtDate())', () => {
    expect(fmtDateOnly(isoPM)).not.toMatch(/[ap]\.\s?m\./i);
    expect(fmtDateOnly(isoPM)).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('fmtDate() (fecha+hora en una sola cadena) tampoco duplica el meridiano — nunca fue el bug real', () => {
    expect((fmtDate(isoPM).match(/p\.\s?m\./gi) || []).length).toBe(1);
  });

  it('fmtDateOnly(iso) + " " + fmtTime(iso) reconstruye el mismo momento que fmtDate(iso), sin duplicar nada', () => {
    const combinado = `${fmtDateOnly(isoPM)}, ${fmtTime(isoPM)}`;
    expect(combinado).toBe(fmtDate(isoPM));
  });
});

describe('Los 2 sitios reales con el bug usan fmtDateOnly()/fmtTime() — nunca fmtDate() junto a un campo Hora separado', () => {
  it('openEquipmentDetail() ("Ficha" → "Última ejecución"): Fecha usa fechaCortaFor (alias de fmtDateOnly), no fmtDate', () => {
    const idx = appSource.indexOf('Última ejecución</h4>');
    expect(idx).toBeGreaterThan(-1);
    const block = appSource.slice(idx, idx + 400);
    expect(block).toContain('<b>Fecha</b><div class="mono">${fechaCortaFor(ultimoRecordDet.date)}</div>');
    expect(block).not.toMatch(/<b>Fecha<\/b><div class="mono">\$\{fmtDate\(/);
  });

  it('openGreaseRecordDetailModal() ("Detalle del engrase"): Fecha usa fmtDateOnly, Hora usa fmtTime', () => {
    const idx = appSource.indexOf("openModal(`Detalle del engrase");
    expect(idx).toBeGreaterThan(-1);
    const block = appSource.slice(idx, idx + 400);
    expect(block).toContain('<b>Fecha</b><div>${fmtDateOnly(record.date)}</div>');
    expect(block).toContain('<b>Hora</b><div>${fmtTime(record.date)}</div>');
    expect(block).not.toMatch(/<b>Fecha<\/b><div>\$\{fmtDate\(record\.date\)\}/);
  });
});
