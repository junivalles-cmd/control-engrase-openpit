// tests/unit/grease-photo-traceability.test.js
//
// Pedido "CAMBIAR CUADRILLA EN CONFIGURACIÓN + TRAZABILIDAD DE FOTOS"
// (2026-10-09), Parte B. openEquipmentDetail() (la "Ficha", usada por
// TODOS los roles) es demasiado grande para extraerla y ejecutarla de
// verdad solo por esto (muchísimas dependencias de rol/permisos/plan) —
// se prueba por patrón de fuente, mismo método que el resto de
// lubricador-dashboard.test.js. La integración REAL (ejecutada de
// verdad) de "Mis Engrases"/openGreaseRecordDetailModal() vive en
// tests/ui/grease-photo-traceability.spec.js.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);

describe('§9 del pedido — Ficha del equipo ("Últimos engrases") muestra el indicador de foto y abre el detalle real al tocarlo', () => {
  const src = extractDeclaration(appSource, 'openEquipmentDetail');

  it('cada fila de "Últimos engrases" incluye photoIndicatorHTML(r) — nunca un thumbnail grande ahí', () => {
    const idx = src.indexOf('Últimos engrases</h4>');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 1500);
    expect(block).toContain('${photoIndicatorHTML(r)}');
    expect(block).not.toMatch(/<img[^>]*\$\{r\./); // nunca un <img> directo de este registro en la lista
  });

  it('el clic en el indicador abre openGreaseRecordDetailModal() con el registro Y el equipo correctos (búsqueda por id, nunca por posición/nombre/fecha)', () => {
    const idx = src.indexOf("'.lub-photo-indicator'");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 300);
    expect(block).toContain("ultimos.find(r => r.id === b.dataset.recordId)");
    expect(block).toContain('openGreaseRecordDetailModal(');
    expect(block).toContain(', e)'); // el equipo de ESTA Ficha, nunca otro
  });
});

describe('§10 del pedido — Mis Engrases (renderLubricadorHistorial()) muestra el indicador de foto y abre el detalle real al tocarlo', () => {
  const src = extractDeclaration(appSource, 'renderLubricadorHistorial');

  it('cada tarjeta incluye photoIndicatorHTML(r) — nunca un thumbnail grande ahí', () => {
    expect(src).toContain('${photoIndicatorHTML(r)}');
  });

  it('el clic busca el registro por id (nunca por posición en la lista) y el equipo por record.equipmentId (nunca el equipo de otra tarjeta)', () => {
    const idx = src.indexOf("'.lub-photo-indicator'");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 300);
    expect(block).toContain('records.find(r => r.id === b.dataset.recordId)');
    expect(block).toContain('equipos.find(e => e.id === rec.equipmentId)');
  });
});

describe('§8/§16 del pedido — la relación foto↔registro se resuelve SIEMPRE por IDs reales, nunca por nombre/posición/fecha', () => {
  const indicatorSrc = extractDeclaration(appSource, 'photoIndicatorHTML');
  const detailSrc = extractDeclaration(appSource, 'openGreaseRecordDetailModal');

  it('photoIndicatorHTML() guarda data-record-id (el id real), nunca un índice de la lista', () => {
    expect(indicatorSrc).toContain('data-record-id="${esc(record.id)}"');
  });

  it('openGreaseRecordDetailModal() busca lubricante/validaciones por campos reales del record (greaseType/id), nunca una asociación nueva', () => {
    expect(detailSrc).toContain("lubricantes.find(l => l.id === record.greaseType)");
    expect(detailSrc).toContain('v.lubricationRecordId === record.id');
  });

  it('openGreaseRecordDetailModal() nunca escribe/borra nada (DB.put/DB.delete/pushAll) — es presentación pura sobre datos ya existentes', () => {
    expect(detailSrc).not.toMatch(/DB\.(put|delete)\(/);
    expect(detailSrc).not.toContain('pushAll');
  });
});

describe('§8/§13 del pedido — "Pendiente de sincronizar" reusa el signal YA existente (foto todavía en base64), nunca un sistema de retry nuevo', () => {
  const detailSrc = extractDeclaration(appSource, 'openGreaseRecordDetailModal');

  it('la detección es "sigue en base64" (mismo criterio que resolveEvidenceSrc()), nunca un flag nuevo tipo photoUploaded', () => {
    expect(detailSrc).toContain("p.startsWith('data:image')");
    expect(detailSrc).not.toContain('photoUploaded');
  });
});

describe('§11 del pedido — Tipo/Estado reusan las MISMAS etiquetas en español ya usadas por tipoRecordHTML() del Historial de escritorio', () => {
  const detailSrc = extractDeclaration(appSource, 'openGreaseRecordDetailModal');

  it('Tipo: Planificado/Asignado/Fuera de plan — nunca el valor crudo en inglés (PLANNED/ASSIGNED/OUT_OF_PLAN)', () => {
    expect(detailSrc).toContain('`Fuera de plan$');
    expect(detailSrc).toContain("'Asignado'");
    expect(detailSrc).toContain("'Planificado'");
    expect(detailSrc).not.toMatch(/<div>\$\{tipo\}<\/div>/); // nunca el valor crudo PLANNED/ASSIGNED/OUT_OF_PLAN sin traducir
  });

  it('Estado: Completo/Parcial — reusa resolveRecordCompleteness(), nunca una regla nueva de COMPLETE/PARTIAL', () => {
    expect(detailSrc).toContain('resolveRecordCompleteness(record)');
    expect(detailSrc).toContain("'Parcial'");
    expect(detailSrc).toContain("'Completo'");
  });

  it('Fotos: reusa photoThumbsHTML()/resolvePhotoThumbSrcs()/wirePhotoThumbs() — nunca un componente de fotos nuevo', () => {
    expect(detailSrc).toContain('photoThumbsHTML(record');
    expect(detailSrc).toContain('resolvePhotoThumbSrcs(record)');
    expect(detailSrc).toContain("wirePhotoThumbs($('.modal-body'))");
  });
});
