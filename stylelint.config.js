// stylelint.config.js — UI/Responsive Fase 1 (ver docs/UI_RESPONSIVE.md).
//
// Línea base real con `stylelint-config-standard` puro (sin excepciones):
// 595 errores en 16 reglas, sobre CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css
// (1307 líneas). Clasificados uno por uno antes de decidir qué desactivar —
// ninguno se desactivó "porque sí".
//
//   234 declaration-block-single-line-max-declarations  → NO RELEVANTE
//    97 rule-empty-line-before                            → NO RELEVANTE
//    47 no-descending-specificity                         → MANTENIBILIDAD (mantener, severidad warning)
//    35 property-no-vendor-prefix                         → LEGACY (intencional)
//    33 alpha-value-notation                              → NO RELEVANTE
//    33 color-function-alias-notation                     → NO RELEVANTE
//    33 color-function-notation                            → NO RELEVANTE
//    23 media-feature-range-notation                       → NO RELEVANTE
//    17 comment-empty-line-before                          → NO RELEVANTE
//    14 at-rule-empty-line-before                          → NO RELEVANTE
//    13 color-hex-length                                   → NO RELEVANTE
//     9 no-duplicate-selectors                             → MANTENIBILIDAD (mantener, severidad warning)
//     2 declaration-block-no-redundant-longhand-properties → NO RELEVANTE
//     2 shorthand-property-no-redundant-values              → NO RELEVANTE
//     2 value-keyword-case                                  → NO RELEVANTE
//     1 declaration-block-no-shorthand-property-overrides   → NO RELEVANTE
//
// "NO RELEVANTE" = preferencia de formato/modernización de sintaxis, CERO
// diferencia de comportamiento (ej. `rgba(0,0,0,.5)` vs `rgb(0 0 0 / 50%)`,
// una declaración por línea vs varias) — y en la mayoría de los casos el
// código ya sigue, de forma consistente y deliberada, el estilo CONTRARIO
// al que pide la regla (reglas compactas de una sola línea en todo el
// archivo) — "arreglarlo" sería reformatear cientos de líneas sin ningún
// beneficio real, exactamente lo que esta fase pidió evitar.
//
// "LEGACY" = `-webkit-appearance`/`-moz-appearance` (selects nativos) y
// `-webkit-mask-image` (máscaras de íconos) son necesarios para
// compatibilidad real con Safari/WebView — quitarlos rompería su
// renderizado, no es deuda técnica, es soporte de navegador intencional.
//
// "MANTENIBILIDAD" (quedan ACTIVAS pero en severidad "warning", nunca
// bloquean `npm run lint:css`) = los 9 `no-duplicate-selectors` son en su
// mayoría el mecanismo de cascada YA DOCUMENTADO en el propio archivo
// ("Va al final del archivo a propósito, para ganarle en orden de
// cascada" — íconos Lucide, tablas→tarjetas móvil) — frágil si alguien
// reordena el archivo sin saberlo, vale la pena verlo, no bloquear por
// eso. `no-descending-specificity` (selector fuera de orden vs.
// especificidad) es la misma clase de riesgo — visible, no urgente.
//
// Ningún error de esta línea base se corrigió con `--fix` en esta fase —
// ver docs/UI_RESPONSIVE.md para el detalle completo y qué sí se
// corrigió (bugs de responsive reales, no de formato).
export default {
  extends: 'stylelint-config-standard',
  rules: {
    'declaration-block-single-line-max-declarations': null,
    'rule-empty-line-before': null,
    'property-no-vendor-prefix': null,
    'alpha-value-notation': null,
    'color-function-alias-notation': null,
    'color-function-notation': null,
    'media-feature-range-notation': null,
    'comment-empty-line-before': null,
    'at-rule-empty-line-before': null,
    'color-hex-length': null,
    'declaration-block-no-redundant-longhand-properties': null,
    'shorthand-property-no-redundant-values': null,
    'value-keyword-case': null,
    'declaration-block-no-shorthand-property-overrides': null,

    'no-descending-specificity': [true, { severity: 'warning' }],
    'no-duplicate-selectors': [true, { severity: 'warning' }],
  },
};
