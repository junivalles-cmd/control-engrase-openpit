import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, LUBRICATION_STATUS_JS_PATH, OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH, WEEKLY_MATRIX_JS_PATH } from '../helpers/loadLubricationLogic.js';

const names = ['$', '$$', 'esc', 'fmtDate', 'fmtDateOnly', 'fmtTime', 'GREASE_UNIT', 'PERMISSIONS', 'NO_EXECUTION_REASON_LABELS', 'photosOf', 'resolveEvidenceSrc', 'resolvePhotoThumbSrcs', 'photoThumbHTML', 'evidenceValueAttr', 'validationBadgeHTML', 'wireMatrixOccurrenceDetails', 'openMatrixOccurrenceCard', 'wireMatrizScrollHint', 'openLubricadorMatrizModal', 'renderMatrizSemanal'];
const app = names.map(n => extractDeclaration(readSource(APP_JS_PATH), n)).join('\n');
const core = [LUBRICATION_STATUS_JS_PATH, OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH, WEEKLY_MATRIX_JS_PATH].map(readSource).join('\n');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l8sAAAAASUVORK5CYII=';

async function boot(page, role = 'ADMINISTRADOR', authorized = true) {
  await page.setContent('<main id="app-content"></main>');
  await page.evaluate(()=>{document.documentElement.dataset.mode='light';document.documentElement.dataset.theme='amarillo-cat';});
  await page.addStyleTag({ path: path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css') });
  await page.addScriptTag({ content: `${core}\n${app}
    const App={currentUser:{id:'u',role:${JSON.stringify(role)}},generalSettings:{shiftDayStart:6,shiftNightStart:18}};
    const eq={id:'e',code:'A11',brand:'Caterpillar',model:'745C',locationId:'master',shiftId:'shift_noche',status:'Operativo'};
    const plan={id:'p',equipmentId:'e',controlType:'Día y turno de la semana',assignedDays:WEEKDAY_NAMES,shiftId:'shift_noche'};
    const days=Array.from({length:7},(_,i)=>new Date(2026,9,5+i)); const today=new Date(2026,9,10);
    const snapshot={executionCompleteness:'COMPLETE',executionType:'ASSIGNED',crewId:'c',executionLocationId:'execution'};
    const records=[{id:'r9',equipmentId:'e',date:'2026-10-09T08:30:00',shiftId:'shift_dia',userName:'Ana',qty:2,notes:'Observación real',photos:[${JSON.stringify(png)}],operationalSnapshot:snapshot},
      {id:'r10',equipmentId:'e',date:'2026-10-10T08:30:00',shiftId:'shift_noche',userName:'Ana',qty:3,operationalSnapshot:{...snapshot,satisfiedOccurrenceKey:computeOccurrenceKey(plan,{dateISO:'2026-10-11'})}}];
    const data={locations:[{id:'master',name:'Ubicación maestra'},{id:'execution',name:'Ubicación ejecutada'}],cuadrillas:[{id:'c',name:'Cuadrilla fixture'}],grease_validations:[{id:'v1',lubricationRecordId:'r9',signerRole:'OPERADOR',active:true},{id:'v2',lubricationRecordId:'r9',signerRole:'ENCARGADO',active:true}],lubrication_skips:[{id:'s',equipmentId:'e',occurrenceKey:computeOccurrenceKey(plan,{dateISO:'2026-10-08'}),reason:'OTRO',observation:'Falta de acceso'}]};
    const DB={allActive:async n=>data[n]||[],all:async n=>data[n]||[],getConfig:async()=>({})}; const ic=()=>''; const kpiCard=(label,value)=>'<div>'+label+': '+value+'</div>'; data.equipment=[eq]; data.lubrication_plans=[plan]; data.lubrication_records=records;
    const Sync={getSignedPhotoUrl:async v=>v}; window.calls=[];
    const openEquipmentDetail=id=>calls.push(['equipment',id]); const navigate=route=>calls.push(['history',route,App.dashJumpEquipoId]);
    const startGreaseFlow=id=>calls.push(['register',id]); const startLubricadorGreaseFlow=id=>calls.push(['register',id]);
    const closeModal=()=>{}; const openPhotoLightbox=(src,caption)=>calls.push(['photo',src,caption]); const openValidationConflictModal=(rows)=>calls.push(['conflict',rows.length]);
    const getCurrentOperationalScope=async()=>({kind:'CREW_SCOPED',crewId:'c',crewLocationId:${authorized ? "'master'" : "'outside'"},allAuthorizedLocationIds:[${authorized ? "'master'" : "'outside'"}],principalLocationIds:[${authorized ? "'master'" : "'outside'"}],crewShiftId:'shift_noche',legacyFallback:false});
    const loadAssignmentContext=async()=>({assignments:[]});
    const openModal=(title,html)=>{document.querySelector('#app-content').innerHTML=html;};
    window.fixture={eq,plan,days,today,records,data};
    window.mount=()=>{const rows=[eq,{...eq,id:'paused',code:'P',status:'Detenido'},{...eq,id:'empty',code:'V'}]; const plans=[plan,{...plan,equipmentId:'paused'},{...plan,equipmentId:'empty',assignedDays:[]}];
      document.querySelector('#app-content').innerHTML='<div class="matriz-wrap"><table class="matriz"><tbody>'+rows.map(e=>'<tr><td>'+e.code+'</td>'+days.map(d=>'<td class="celda-'+estadoCelda(e,d,plans,records,today).tipo.replaceAll('_','-')+'" title="tooltip antiguo">Estado</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
      wireMatrixOccurrenceDetails(document.querySelector('.matriz-wrap'),{equipos:rows,plans,records,dias:days,hoy:today});};
    window.showPending=()=>openMatrixOccurrenceCard(document.querySelector('td[role=button]'),{equipment:eq,date:today,state:{tipo:'pendiente'},plans:[plan],records:[]});
    window.mount();` });
}
const cell = (page, index) => page.locator('tbody tr').first().locator('td').nth(index + 1);
const card = page => page.locator('#matrix-occurrence-card');

test('realizado, atrasado y adelantado use the exact state execution; no points or empty notes', async ({ page }) => {
  await boot(page);
  await cell(page, 4).click();
  await expect(card(page)).toContainText('REALIZADO ATRASADO');
  await expect(card(page)).toContainText('Cuadrilla fixture');
  await expect(card(page)).toContainText('Ubicación ejecutada');
  await expect(card(page)).toContainText('COMPLETE');
  await expect(card(page)).toContainText('Observación real');
  await expect(card(page).locator('dd').filter({hasText:/^Noche$/})).toHaveCount(1);
  await expect(card(page).locator('dd').filter({hasText:/^Día$/})).toHaveCount(1);
  await expect(card(page)).toContainText('Conflicto');
  await card(page).getByRole('button',{name:'Cerrar detalle'}).click();
  await cell(page, 6).click();
  await expect(card(page)).toContainText('REALIZADO ADELANTADO');
  const dates = await card(page).locator('dd').allTextContents();
  expect(dates.some(d=>d.includes('11/10/2026'))).toBe(true);
  expect(dates.some(d=>d.includes('10/10/2026'))).toBe(true);
  await expect(card(page)).not.toContainText('OBSERVACIONES');
  await expect(card(page)).not.toContainText('Puntos');
  await page.keyboard.press('Escape');
  await cell(page, 5).click();
  await expect(card(page)).toContainText('REALIZADO');
});

test('no realizado, pendiente, futuro, pausado and empty preserve their state without invented execution', async ({ page }) => {
  await boot(page);
  await cell(page, 3).click();
  await expect(card(page)).toContainText('NO REALIZADO');
  await expect(card(page)).toContainText('Falta de acceso');
  await expect(card(page)).not.toContainText('EJECUCIÓN');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>window.showPending());
  await expect(card(page)).toContainText('PENDIENTE HOY');
  await expect(card(page)).not.toContainText('EJECUCIÓN');
  await expect(card(page).getByRole('button',{name:'Registrar engrase'})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{const f=fixture; return openMatrixOccurrenceCard(document.querySelector('td[role=button]'),{equipment:f.eq,date:f.days[6],state:{tipo:'futuro'},plans:[f.plan],records:[]});});
  await expect(card(page)).toContainText('PROGRAMADO MÁS ADELANTE');
  await expect(card(page).getByRole('button',{name:'Registrar engrase'})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('tbody tr').nth(1).locator('td').nth(1).click();
  await expect(card(page)).toContainText('Detenido');
  await page.keyboard.press('Escape');
  await page.locator('tbody tr').nth(2).locator('td').nth(1).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator('td[title]')).toHaveCount(0);
});

test('Enter, Space, Escape restore focus; outside dismisses; panel/sheet stays within viewport', async ({ page }, info) => {
  await boot(page); await cell(page,4).focus(); await page.keyboard.press('Enter');
  await expect(card(page).getByRole('button',{name:'Ver ficha'})).toBeVisible();
  const box=await card(page).boundingBox(); const size=page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(size.width+1);
  expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y+box.height).toBeLessThanOrEqual(size.height+1);
  if(size.width<768){expect(box.y+box.height).toBeCloseTo(size.height,0);expect(box.height).toBeLessThanOrEqual(size.height*.8+1);}
  if(['phone-390','desktop-1366'].includes(info.project.name)) await page.screenshot({path:info.outputPath('matrix-card.png')});
  await page.keyboard.press('Escape'); await expect(cell(page,4)).toBeFocused();
  await page.keyboard.press(' '); await expect(card(page)).toBeVisible();
  await page.locator('.matrix-occurrence-overlay').click({position:{x:1,y:1}}); await expect(card(page)).toHaveCount(0);
  await page.evaluate(()=>{const a=document.querySelector('td[role=button]');a.style.position='fixed';a.style.right='0';a.style.bottom='0';});
  await cell(page,0).click(); await expect(card(page).getByRole('button',{name:'Ver ficha'})).toBeVisible();
  const edge=await card(page).boundingBox();expect(edge.x+edge.width).toBeLessThanOrEqual(size.width+1);expect(edge.y+edge.height).toBeLessThanOrEqual(size.height+1);
  for(const button of await card(page).locator('button').all()){const b=await button.boundingBox();expect(b.height).toBeGreaterThanOrEqual(44);}
});

test('existing ficha/history/register/photo/conflict handlers receive the correct equipment and evidence', async ({ page }) => {
  await boot(page); await cell(page,4).click();
  await card(page).getByRole('button',{name:'Ver foto 1'}).click();
  expect(await page.evaluate(()=>calls[0])).toEqual(['photo',png,'A11']);
  await cell(page,4).click(); await card(page).getByRole('button',{name:'Ver conflicto'}).click();
  expect(await page.evaluate(()=>calls.at(-1))).toEqual(['conflict',2]);
  await cell(page,4).click(); await card(page).getByRole('button',{name:'Ver ficha'}).click();
  expect(await page.evaluate(()=>calls.at(-1))).toEqual(['equipment','e']);
  await cell(page,4).click(); await card(page).getByRole('button',{name:'Ver historial'}).click();
  expect(await page.evaluate(()=>calls.at(-1))).toEqual(['history','historial','e']);
  await page.evaluate(()=>showPending());await card(page).getByRole('button',{name:'Registrar engrase'}).click();
  expect(await page.evaluate(()=>calls.at(-1))).toEqual(['register','e']);
});

for(const [role,authorized,visible] of [['VISOR',true,false],['LUBRICADOR',false,false],['LUBRICADOR',true,true]]) {
  test(`registrar uses existing role/scope gate: ${role}, authorized=${authorized}`,async({page})=>{
    await boot(page,role,authorized);await page.evaluate(()=>showPending());
    await expect(card(page).getByRole('button',{name:'Ver ficha'})).toBeVisible();
    await expect(card(page).getByRole('button',{name:'Registrar engrase'})).toHaveCount(visible?1:0);
  });
}

test('actual lubricant matrix renders interactive cells with no tooltip, without changing its scope',async({page})=>{
  await boot(page); await page.evaluate(()=>{const f=fixture;openLubricadorMatrizModal({equipos:[f.eq],plans:[f.plan],records:f.records,locationName:'Fixture'});});
  await expect(page.locator('td[role=button]')).toHaveCount(7);
  await page.locator('td[role=button]').first().click();await expect(card(page)).toContainText('PROGRAMACIÓN');
});

test('actual admin matrix wires its occurrence cells and removes native tooltip',async({page})=>{
  await boot(page); await page.evaluate(()=>renderMatrizSemanal());
  await expect(page.locator('td[role=button]')).toHaveCount(7);
  await expect(page.locator('table.matriz td[title]')).toHaveCount(0);
  await page.locator('td[role=button]').first().click(); await expect(card(page)).toContainText('PROGRAMACIÓN');
});

test('partial result and compact validation use existing helpers; photos and data remain unchanged',async({page})=>{
  await boot(page);
  await page.clock.setFixedTime(new Date('2026-10-09T09:00:00'));
  for(const role of ['OPERADOR','ENCARGADO',null]) {
    await page.evaluate(role=>{fixture.records[0].operationalSnapshot.executionCompleteness='PARTIAL';fixture.data.grease_validations=role?[{id:'v',lubricationRecordId:'r9',signerRole:role,active:true}]:[];},role);
    await cell(page,4).click();await expect(card(page)).toContainText('PARTIAL');
    await expect(card(page)).toContainText(role==='OPERADOR'?'Validado · Operador':role==='ENCARGADO'?'Validado · Encargado':'Pendiente');
    await expect(card(page).locator('.photo-thumb')).toHaveAttribute('src',png);
    await page.keyboard.press('Escape');
  }
  expect(await page.evaluate(()=>fixture.eq.locationId)).toBe('master');
  expect(await page.evaluate(()=>fixture.records[0].photos[0])).toBe(png);
});
