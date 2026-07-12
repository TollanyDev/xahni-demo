// ═══════════════════════════════════════════════════════════
// UI — Toasts, utilidades y eventos globales
// ═══════════════════════════════════════════════════════════

/**
 * @interaction show-toast
 * @scope core-shared-utility-toast
 *
 * Given un msg (string) + type opcional ("success"|"error"|"info"|"ok"|
 *   "danger"|"warn", default "info").
 * When un caller (cualquier handler, builder, action) quiere mostrar
 *   feedback transitorio al usuario.
 * Then construye un .x-toast en #toast-container con:
 *   - Doble class: canonical (.x-toast--ok) + legacy (.toast success).
 *     Mapeo dual: success↔ok, error↔danger.
 *   - Icono según type (✓✕ℹ⚠ con fallback ℹ).
 *   - Mensaje escapado via _escapeHtml (XSS hardening slice pre-c10 #2).
 *   Setea timeout 3000ms para fade-out (opacity:0 + translateX(20px) +
 *   transition 0.3s) y remove tras 300ms adicionales.
 * Edge:
 *   - container #toast-container no en DOM → appendChild error.
 *   - type fuera del set → fallback icono ℹ.
 *   - typeCanon/typeLegacy mantienen retrocompat de slices antiguos
 *     que usan ambas clases.
 *   - msg con HTML → escapado (output como texto literal).
 *   - Múltiples toasts apilados → ok (CSS stacking).
 */
function showToast(msg, type = "info") {
    const icons      = { success: "✓", error: "✕", info: "ℹ", ok: "✓", danger: "✕", warn: "⚠" };
    // Mapeo legacy → canónico (success→ok, error→danger). Acepta canónico directo.
    const typeCanon  = ({ success: "ok",      error: "danger" })[type] || type;
    const typeLegacy = ({ ok:      "success", danger: "error" })[type] || type;
    const container  = document.getElementById("toast-container");
    const toast      = document.createElement("div");
    toast.className  = `x-toast x-toast--${typeCanon} toast ${typeLegacy}`;
    toast.innerHTML  = `<span class="x-toast__icon toast-icon">${icons[type] || "ℹ"}</span> ${_escapeHtml(msg)}`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity    = "0";
        toast.style.transform  = "translateX(20px)";
        toast.style.transition = "all 0.3s";
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * @interaction capitalize
 * @scope core-shared-utility-string
 *
 * Given un string s.
 * When un caller necesita capitalizar la primera letra (e.g. rol
 *   "estudiante" → "Estudiante" para mostrar como label).
 * Then retorna s[0].toUpperCase() + s.slice(1).
 * Edge:
 *   - s "" → "" + "" = "".
 *   - s null/undefined → TypeError (caller debe pasar string).
 *   - Solo capitaliza primera letra; resto sin tocar (e.g. "iOS" se
 *     mantiene como "iOS" si entra; "ios" → "Ios").
 *   - NO usa locale-aware uppercase (tr_TR usa "İ" diferente). En español
 *     no aplica.
 */
function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// Modo oscuro / claro y gamer mode los maneja js/core/configuracion.js
// (CONFIG_DEFAULTS + toggleConfig + aplicarConfigInicial)

// Cerrar modales con la tecla Escape
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape")
        document
            .querySelectorAll(".modal-overlay.active")
            .forEach((m) => m.classList.remove("active"));
});
