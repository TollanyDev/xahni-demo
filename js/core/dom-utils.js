// ────────────────────────────────────────────────────────────
// dom-utils.js — helpers DOM compartidos
// ────────────────────────────────────────────────────────────
//
// _escapeHtml(s): escape mínimo para interpolación en `innerHTML`.
// Drop-in: reemplazar `${userValue}` por `${_escapeHtml(userValue)}`
// sin cambiar layout ni semántica. Idempotente sobre datos limpios.
//
// Contrato:
//   - Coerce a string. `null`/`undefined` → "" (no la cadena literal
//     "null"/"undefined", que sería contraintuitiva en UI).
//   - Escapa los 5 caracteres mínimos para text-content + atributos
//     quoted: & < > " '.
//   - NO escapa para contextos `attribute sin comillas`, `url(...)`,
//     ni `<script>` — XAHNI no los usa.
//   - NO es tag function automática: se aplica explícitamente sitio
//     por sitio (decisión "rescatar visual, no reescribir").
//
// Slice C (2026-05-17): introducido como cierre de la deuda XSS
// registrada en logs §4 de los Bloqueantes 4.B/4.C/4.D/4.F/4.F.1.
/**
 * @interaction escape-html
 * @scope core-shared-helper-canonical-xss
 *
 * Given un valor (string/number/boolean/null/undefined/cualquier coerce).
 * When un caller construye HTML con interpolación dinámica (innerHTML,
 *   template literals) y necesita escapar el valor antes de inyectarlo
 *   en text-content o atributos quoted.
 * Then:
 *   - null/undefined → "" (decisión consciente: NO la cadena "null"/
 *     "undefined" que sería contraintuitiva en UI).
 *   - Cualquier otro → String(s) y reemplaza los 5 caracteres mínimos
 *     para text-content + atributos quoted: & < > " '. El orden importa:
 *     & primero para evitar doble-escape de las otras entidades.
 *   Idempotente sobre datos limpios (cadenas sin special chars no cambian).
 * Edge:
 *   - NO cubre contextos `attribute sin comillas`, `url(...)`, `<script>`
 *     o `<style>`. XAHNI no usa esos contextos. Si en futuro se usan,
 *     escape adicional debe aplicarse antes.
 *   - NO es tag function automática: aplicación explícita sitio por sitio
 *     (decisión "rescatar visual, no reescribir" slice C 2026-05-17).
 *   - Contrato testeado en scripts/verificar-escape-html.js con 8 casos
 *     (empty, null, undefined, number 0, boolean false, <script>,
 *     entidades mixtas, "Materia <ISC>").
 *   - Expuesto en window para handlers inline + consumidores globales
 *     (mismo patrón que builders-core.js, hub-shell.js, etc.).
 */
function _escapeHtml(s) {
    if (s == null) return "";
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Expone también en window para handlers inline y consumidores
// que lean del scope global (consistencia con builders-core.js).
if (typeof window !== "undefined") window._escapeHtml = _escapeHtml;
