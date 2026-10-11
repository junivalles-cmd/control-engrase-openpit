import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';
import { THEME_PREFERENCE_DECLARATIONS } from '../helpers/themeFixture.js';
const source=readSource(APP_JS_PATH);
const antiFlash=readSource(path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/index.html')).match(/<script>([\s\S]*?)<\/script>/)[1];
const real=[...THEME_PREFERENCE_DECLARATIONS,'$','$$','esc','openModal','closeModal','openThemePicker'].map(n=>extractDeclaration(source,n)).join('\n');
const fixture='<meta name="theme-color" content="#14171A"><main><aside class="sidebar"><button class="menu-item active">Dashboard</button></aside><header class="topbar">Control</header><button class="btn btn-accent" id="primary">Registrar</button><button class="rep-tab active" id="tab">Seleccionada</button><span class="status-chip" style="--c:var(--red)">CRÍTICO</span><span class="status-chip" style="--c:var(--green)">REALIZADO</span><span class="status-chip" style="--c:var(--amber)">ATENCIÓN</span></main>';
async function boot(page, navigate=true) {
  await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:fixture}):route.fulfill({contentType:'text/css',body:''}));
  if(navigate) await page.goto('/__office-theme-fixture');
  await page.addStyleTag({path:path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css')});
  await page.addScriptTag({content:antiFlash});
  await page.evaluate(()=>window.__firstPaintMode=document.documentElement.dataset.mode);
  await page.addScriptTag({content:`const App={}; ${real}\nwindow.__themes=THEMES;window.__theme=getTheme;window.__apply=applyTheme;window.__picker=openThemePicker;applyTheme(getTheme());openThemePicker();`});
}
async function contrast(page,selector) {
  return page.locator(selector).evaluate(el=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
    const pixel=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
    const lum=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const parents=[];for(let p=el;p;p=p.parentElement)parents.unshift(p);let bg=[255,255,255];parents.forEach(p=>{const c=pixel(getComputedStyle(p).backgroundColor),a=c[3]/255;bg=bg.map((v,i)=>c[i]*a+v*(1-a));});
    const css=getComputedStyle(el),b=lum(bg),ratio=color=>{const a=lum(pixel(color));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
    return {text:ratio(css.color),focus:ratio(css.outlineColor),border:ratio(css.borderTopColor),outline:css.outlineStyle};
  });
}
test('Office: 24 combinaciones AA, selección instantánea, estado semántico independiente y teclado',async({page})=>{
  await boot(page);await page.context().setOffline(true);
  await expect(page.locator('[data-accent]')).toHaveCount(8);await expect(page.locator('.theme-preview-card[data-mode]')).toHaveCount(3);
  await expect(page.locator('.modal')).not.toContainText('Alto Contraste');
  const themes=await page.evaluate(()=>window.__themes);
  for(const mode of ['light','dark','sun']){
    await page.locator('.theme-preview-card[data-mode="'+mode+'"]').click();
    const semantic=await page.evaluate(()=>Object.fromEntries(['green','red','amber','gray-status'].map(k=>[k,getComputedStyle(document.documentElement).getPropertyValue('--'+k)])));
    for(const theme of themes){
      const choice=page.locator('[data-accent="'+theme.id+'"]');await choice.click();
      expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe(theme.id);
      await expect(choice).toHaveAttribute('aria-pressed','true');
      expect(await page.evaluate(()=>Object.fromEntries(['green','red','amber','gray-status'].map(k=>[k,getComputedStyle(document.documentElement).getPropertyValue('--'+k)])))).toEqual(semantic);
      for(const selector of ['#primary','#tab','.theme-preview-card[data-accent].selected .theme-preview-name','.theme-preview-card[data-accent].selected .theme-preview-chip','.menu-item.active','.topbar']) expect((await contrast(page,selector)).text,theme.label+' '+mode+' '+selector).toBeGreaterThanOrEqual(4.5);
      expect((await contrast(page,'[data-accent="'+theme.id+'"]')).border,theme.label+' '+mode).toBeGreaterThanOrEqual(3);
      await page.keyboard.press('Tab');await choice.focus();
      const c=await contrast(page,'[data-accent="'+theme.id+'"]');expect(c.outline).not.toBe('none');expect(c.focus).toBeGreaterThanOrEqual(3);
      await page.keyboard.press('Enter');expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('engrase_theme')))).toEqual({accent:theme.id,mode});
    }
  }
  await page.reload();await boot(page,false);
  expect(await page.evaluate(()=>window.__theme())).toEqual({accent:'grafito',mode:'sun'});
  await expect(page.locator('[data-accent="grafito"]')).toHaveAttribute('aria-pressed','true');
});
test('Office: migra preferencias antiguas y mantiene el primer pintado válido',async({page})=>{
  await boot(page);
  for(const mode of ['contrast','high-contrast','high_contrast']){
    await page.evaluate(mode=>localStorage.setItem('engrase_theme',JSON.stringify({accent:'amarillo-cat',mode})),mode);
    await page.reload();await boot(page,false);
    expect(await page.evaluate(()=>window.__theme())).toEqual({accent:'amarillo-cat',mode:'sun'});
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('engrase_theme')).mode)).toBe('sun');
    expect(await page.evaluate(()=>window.__firstPaintMode)).toBe('sun');
    await expect(page.locator('[data-accent="amarillo-cat"]')).toHaveAttribute('aria-pressed','true');
  }
});
test('Office: modal responsive en siete anchos y tres modos',async({page},info)=>{
  await boot(page);
  for(const mode of ['light','dark','sun']) for(const width of [360,390,412,768,1024,1366,1920]){
    await page.setViewportSize({width,height:900});await page.locator('.theme-preview-card[data-mode="'+mode+'"]').click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const geometry=await page.locator('.theme-preview-card').evaluateAll(els=>els.every(el=>{const r=el.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth+1;}));expect(geometry,mode+' '+width).toBe(true);
    if(width>=768) expect(await page.locator('.theme-mode-grid').evaluate(el=>new Set([...el.children].map(c=>Math.round(c.getBoundingClientRect().top))).size)).toBe(1);
    if(width<=412) expect(await page.locator('.theme-mode-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2);
    await page.locator('.modal').screenshot({path:info.outputPath('office-'+mode+'-'+width+'.png')});
  }
});
