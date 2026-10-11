import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';
import { THEME_PREFERENCE_DECLARATIONS } from '../helpers/themeFixture.js';
const source = readSource(APP_JS_PATH);
const body = THEME_PREFERENCE_DECLARATIONS.map(n => extractDeclaration(source,n)).join('\n')+'\nreturn {getTheme, normalizeThemePreference, THEMES, MODES};';
const load = storage => new Function('localStorage', body)(storage);

describe('Preferencias Office: compatibilidad local', () => {
  it.each(['contrast','high-contrast','high_contrast'])('%s migra a sun y persiste sin perder accent ni extras', mode => {
    let value=JSON.stringify({ accent:'violeta-ejec', mode, extra:'preservado' });
    const storage={getItem:()=>value,setItem:(key,v)=>{expect(key).toBe('engrase_theme');value=v;}};
    const {getTheme}=load(storage);
    expect(getTheme()).toEqual({accent:'violeta-ejec',mode:'sun',extra:'preservado'});
    expect(JSON.parse(value)).toEqual(getTheme());
  });
  it('los ocho IDs válidos se preservan y no se reescriben innecesariamente', () => {
    const base=load({getItem:()=>null});
    for(const theme of base.THEMES) {
      const storage={getItem:()=>JSON.stringify({accent:theme.id,mode:'dark'}),setItem:()=>{throw new Error('reescritura innecesaria');}};
      expect(load(storage).getTheme()).toEqual({accent:theme.id,mode:'dark'});
    }
  });
  it('los 12 IDs anteriores resuelven a un acento presente en el selector', () => {
    const {normalizeThemePreference,THEMES}=load({getItem:()=>null});
    for(const accent of ['blue','green','red','teal','amber','petroleo','purpura','ladrillo','cobre','graphite','acero','cian']) expect(THEMES.map(t=>t.id)).toContain(normalizeThemePreference({accent,mode:'light'}).accent);
  });
  it('almacenamiento de solo lectura no impide aplicar una preferencia migrada válida', () => {
    const {getTheme}=load({getItem:()=>JSON.stringify({accent:'verde-bosque',mode:'contrast'}),setItem:()=>{throw new Error('readonly');}});
    expect(getTheme()).toEqual({accent:'verde-bosque',mode:'sun'});
  });
  it.each([null,'{json inválido}',JSON.stringify({accent:'inexistente',mode:'inexistente'})])('preferencia ausente/corrupta/inválida tiene fallback limpio: %s', value => {
    expect(load({getItem:()=>value,setItem:()=>{}}).getTheme()).toEqual({accent:'azul-corp',mode:'light'});
  });
});
