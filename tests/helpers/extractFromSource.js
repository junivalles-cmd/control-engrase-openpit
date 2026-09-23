// tests/helpers/extractFromSource.js
//
// Lee funciones y constantes REALES directamente del código fuente de la app
// (CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\*.js) para poder probarlas de forma
// aislada, SIN modificar esos archivos ni duplicar su lógica a mano.
//
// app.js/db.js/sync.js son scripts clásicos (sin `export`), pensados para
// cargarse con <script> en el navegador. Este helper extrae el texto exacto
// de una declaración top-level (function o const-objeto) contando llaves,
// y quien lo use decide cómo ejecutarlo (ver loadLubricationLogic.js).

import fs from 'node:fs';

export function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Extrae el texto fuente completo de una declaración top-level por nombre:
 *   function NOMBRE(...) { ... }
 *   async function NOMBRE(...) { ... }
 *   const NOMBRE = { ... };
 *   const NOMBRE = [ ... ];
 * Busca desde el INICIO del archivo (primera coincidencia) hasta la llave/
 * corchete de cierre correspondiente, contando anidamiento.
 */
export function extractDeclaration(source, name) {
  const fnMatch = source.match(new RegExp(`(^|\\n)((?:async )?function ${name}\\()`));
  if (fnMatch) {
    const startIdx = fnMatch.index + fnMatch[1].length;
    // Fase 1: cerrar la lista de parámetros "(...)".
    let i = source.indexOf('(', startIdx);
    let depth = 0;
    for (; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') { depth--; if (depth === 0) { i++; break; } }
    }
    // Fase 2: desde ahí, cerrar el cuerpo "{...}" de la función.
    const bodyStart = source.indexOf('{', i);
    let bodyDepth = 0, end = -1;
    for (let j = bodyStart; j < source.length; j++) {
      if (source[j] === '{') bodyDepth++;
      else if (source[j] === '}') { bodyDepth--; if (bodyDepth === 0) { end = j + 1; break; } }
    }
    if (end === -1) throw new Error(`extractDeclaration: no se pudo cerrar la función "${name}"`);
    return source.slice(startIdx, end);
  }

  const constMatch = source.match(new RegExp(`(^|\\n)(const ${name} = )`));
  if (constMatch) {
    const startIdx = constMatch.index + constMatch[1].length;
    // Recorre el valor asignado (objeto, arreglo, arrow function con cuerpo de
    // bloque O de expresión, etc.) contando anidamiento de (), {} y [] juntos,
    // y termina en el primer ';' que quede a profundidad 0.
    let depth = 0, end = -1;
    for (let j = startIdx; j < source.length; j++) {
      const ch = source[j];
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === ')' || ch === '}' || ch === ']') depth--;
      else if (ch === ';' && depth === 0) { end = j + 1; break; }
    }
    if (end === -1) throw new Error(`extractDeclaration: no se encontró el ";" de cierre para "${name}"`);
    return source.slice(startIdx, end);
  }

  throw new Error(`extractDeclaration: no se encontró "${name}" en el archivo fuente`);
}

/**
 * Extrae varias declaraciones (en el orden dado) y las concatena, seguidas de
 * un `return { ...nombres }`, listas para ejecutarse con `new Function(...)`.
 * Las declaraciones pueden depender entre sí (todas comparten el mismo scope
 * de función al ejecutarse) y de los argumentos que reciba esa función
 * (normalmente `App`, ver loadLubricationLogic.js).
 */
export function buildModuleBody(source, names) {
  const chunks = names.map((n) => extractDeclaration(source, n));
  return `${chunks.join('\n\n')}\n\nreturn { ${names.join(', ')} };`;
}
