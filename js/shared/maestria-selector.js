// ═══════════════════════════════════════════════════════════
// SLICE H2a B.1 · Módulo selector Top 3 Maestrías
// Wire del foot button "Cambiar selección" del widget H1 →
// modal donde alumno cura hasta 3 maestrías en orden display.
// Persistencia: localStorage xahni_top3_maestria_${uid} override
// del seed JSON data/demo/top3-maestria.json. Widget H1 lee
// cascada localStorage → JSON seed → fallback auto (helper
// _getCuratedTop3Maestria en builders-core.js).
// ═══════════════════════════════════════════════════════════

// Estado pending durante edición (array de materiaIds en orden).
// Reset al abrir el modal desde la cascada actual del usuario.
let _top3Pending = [];

// Clave localStorage namespaced por uid.
/**
 * @interaction top3-key
 * @scope shared-maestria-selector-helper-internal
 *
 * Given (sin args; lee APP.user.id).
 * When un caller (aplicarTop3Maestria) necesita la clave localStorage
 *   namespaced por usuario activo para persistir el override del Top 3.
 * Then retorna `xahni_top3_maestria_${uid}` o null si APP.user no existe.
 * Edge:
 *   - APP.user undefined → null (caller debe abortar).
 *   - Namespace permite múltiples usuarios en mismo navegador (demo mode).
 *   - Misma convención que `_avatarKey`, `_identidadKey` (perfil avatar/
 *     identidad).
 *   - Deuda post-Supabase: tabla `user_curated_top3` por uid.
 */
function _top3Key() {
    const uid = APP?.user?.id;
    return uid ? `xahni_top3_maestria_${uid}` : null;
}

/**
 * @interaction build-top3-maestria-selector
 * @scope estudiante-mi-perfil
 *
 * Given: alumno hace click en "Cambiar selección" del widget H1
 * When:  openModal("modal-top3-maestria-selector") dispatcha el build
 * Then:  el container #b1-ma-selector-grid-container recibe el grid de
 *        cards seleccionables (una por cada DEMO_MAESTRIA[uid] entry
 *        con points > 0). _top3Pending se inicializa desde la cascada
 *        actual: localStorage → JSON seed → fallback auto. Cada card
 *        muestra emblema 48px + nombre + nivel + points + badge posición
 *        (1/2/3) cuando seleccionada.
 * Edge:
 *   - APP.user falsy → no-op silencioso
 *   - DEMO_MAESTRIA[uid] vacío → muestra estado vacío con CTA hacia materias
 *   - container ausente → no-op silencioso
 */
function buildTop3MaestriaSelector() {
    const container = document.getElementById("b1-ma-selector-grid-container");
    if (!container) return;
    if (!APP || !APP.user) return;
    const uid = APP.user.id;

    // Inicializa _top3Pending desde la cascada actual.
    _top3Pending = (typeof _getCuratedTop3Maestria === "function")
        ? [..._getCuratedTop3Maestria(uid)]
        : [];

    _renderTop3Grid();
}
window.buildTop3MaestriaSelector = buildTop3MaestriaSelector;

// Re-renderiza el grid del modal según _top3Pending actual.
// Se llama tras cada click en card (toggle add/remove).
/**
 * @interaction render-top3-grid
 * @scope shared-maestria-selector-render
 *
 * Given el modal-top3-maestria-selector abierto, APP.user activo, y
 *   `_top3Pending` (module-scope) con el estado pending del alumno.
 * When buildTop3MaestriaSelector inicializa, o `_top3SlotClick` toggle,
 *   o `_top3Reset` clear.
 * Then construye grid de cards (.b1-ma-selector-card) en
 *   #b1-ma-selector-grid-container:
 *   1. Filtra DEMO_MAESTRIA[uid] entries con points > 0.
 *   2. Sort desc por points (orden visual estable).
 *   3. Por cada entry: emblema 48px (delegado a _renderMaestriaEmblem),
 *      nombre, nivel, points, badge posición (1/2/3) si seleccionada.
 *   4. onclick="_top3SlotClick(matId)" para toggle.
 *   5. aria-label compuesto con info accesible.
 * Edge:
 *   - APP.user falsy o DEMO_MAESTRIA[uid] missing → empty state
 *     "Aún sin maestrías" + CTA.
 *   - Sin entries con points > 0 → empty state.
 *   - Helpers de builders-core (_getDisciplinaId/Glyph/Emblem,
 *     _resolveMateriaNombre) usan fallback "bd" / "📚" / id si no cargados.
 *   - Slice H2a (2026-05-30): cementó el pattern selector → cascada
 *     localStorage → JSON seed → auto by points.
 */
function _renderTop3Grid() {
    const container = document.getElementById("b1-ma-selector-grid-container");
    if (!container) return;
    const uid = APP?.user?.id;
    if (!uid || typeof DEMO_MAESTRIA !== "object" || !DEMO_MAESTRIA[uid]) {
        container.innerHTML = `
            <div class="b1-ma-selector-empty">
              <strong>Aún sin maestrías</strong><br>
              Avanza en tus materias para acumular puntos y desbloquear este showcase.
            </div>`;
        return;
    }

    // Todas las entries con points > 0, sort desc por points para orden visual estable.
    const entries = Object.entries(DEMO_MAESTRIA[uid])
        .filter(([_, m]) => m && (m.points || 0) > 0)
        .map(([id, m]) => ({ id, ...m }))
        .sort((a, b) => (b.points || 0) - (a.points || 0));

    if (!entries.length) {
        container.innerHTML = `
            <div class="b1-ma-selector-empty">
              <strong>Aún sin maestrías</strong><br>
              Avanza en tus materias para acumular puntos y desbloquear este showcase.
            </div>`;
        return;
    }

    const cardsHtml = entries.map(e => {
        const disciplinaId = (typeof _getDisciplinaId === "function") ? _getDisciplinaId(e.id) : "bd";
        const glyph = (typeof _getDisciplinaGlyph === "function") ? _getDisciplinaGlyph(disciplinaId) : "📚";
        const nombre = (typeof _resolveMateriaNombre === "function") ? _resolveMateriaNombre(e.id) : e.id;
        const emblem = (typeof _renderMaestriaEmblem === "function") ? _renderMaestriaEmblem(disciplinaId, glyph, e.nivel || 1, nombre) : "";
        const pos = _top3Pending.indexOf(e.id);
        const selected = pos >= 0;
        const positionBadge = selected ? `<span class="b1-ma-selector-card__position">${pos + 1}</span>` : "";
        return `
            <button type="button"
                    class="b1-ma-selector-card"
                    data-mat="${e.id}"
                    data-disciplina="${disciplinaId}"
                    data-selected="${selected}"
                    onclick="_top3SlotClick('${e.id}')"
                    aria-label="Maestría de ${nombre} · Nivel ${e.nivel || 1} · ${(e.points || 0).toLocaleString()} puntos${selected ? ` · posición ${pos + 1}` : ""}">
              ${positionBadge}
              ${emblem}
              <span class="b1-ma-selector-card__name">${nombre}</span>
              <span class="b1-ma-selector-card__meta">Nivel ${e.nivel || 1} · ${(e.points || 0).toLocaleString()} pts</span>
            </button>`;
    }).join("");

    container.innerHTML = `<div class="b1-ma-selector-grid">${cardsHtml}</div>`;
}

/**
 * @interaction top3-slot-click
 * @scope estudiante-mi-perfil-modal
 *
 * Given: modal Top 3 abierto, alumno click una card
 * When:  el onclick dispara con el materiaId
 * Then:  si la materia no estaba en _top3Pending → agrega al final
 *        (max 3 slots; si ya hay 3, no agrega y muestra toast)
 *        si ya estaba → la remueve y reordena los slots posteriores
 *        en ambos casos re-renderea el grid
 * Edge:
 *   - 3 slots ya llenos y click en card no seleccionada → no-op silencioso
 *     (UX: usuario debe quitar una primero)
 */
function _top3SlotClick(matId) {
    if (!matId) return;
    const idx = _top3Pending.indexOf(matId);
    if (idx >= 0) {
        // Toggle off: remover
        _top3Pending.splice(idx, 1);
    } else {
        // Toggle on: agregar si hay espacio
        if (_top3Pending.length >= 3) {
            if (typeof showToast === "function") {
                showToast("Ya hay 3 maestrías seleccionadas. Quita una primero.", "info");
            }
            return;
        }
        _top3Pending.push(matId);
    }
    _renderTop3Grid();
}
window._top3SlotClick = _top3SlotClick;

/**
 * @interaction top3-reset
 * @scope estudiante-mi-perfil-modal
 *
 * Given: modal Top 3 abierto, alumno click "Restaurar auto"
 * When:  el onclick dispara
 * Then:  _top3Pending se vacía. Al Aplicar después, el localStorage key
 *        se borrará y la cascada cae al JSON seed o al auto by points.
 *        Re-renderea el grid sin badges.
 */
function _top3Reset() {
    _top3Pending = [];
    _renderTop3Grid();
}
window._top3Reset = _top3Reset;

/**
 * @interaction aplicar-top3-maestria
 * @scope estudiante-mi-perfil-modal
 *
 * Given: alumno click "Aplicar selección"
 * When:  el onclick dispara
 * Then:  si _top3Pending.length > 0 → persiste en localStorage
 *        si _top3Pending.length === 0 → borra el localStorage key
 *        (revierte a JSON seed o auto). Dispara CustomEvent
 *        `xahni:top3MaestriaChanged` para refresh del widget H1.
 *        Cierra el modal.
 */
function aplicarTop3Maestria() {
    const key = _top3Key();
    if (!key) {
        closeModal("modal-top3-maestria-selector");
        return;
    }
    try {
        if (_top3Pending.length > 0) {
            localStorage.setItem(key, JSON.stringify(_top3Pending));
        } else {
            localStorage.removeItem(key);
        }
    } catch (_) { /* localStorage puede fallar en modo privado; no bloquear UX */ }

    // Refresh widget H1 vía CustomEvent
    document.dispatchEvent(new CustomEvent("xahni:top3MaestriaChanged", {
        detail: { uid: APP?.user?.id, top3: [..._top3Pending] }
    }));

    closeModal("modal-top3-maestria-selector");
}
window.aplicarTop3Maestria = aplicarTop3Maestria;
