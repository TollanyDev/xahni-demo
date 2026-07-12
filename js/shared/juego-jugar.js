// js/shared/juego-jugar.js
// Slice Juegos beta B1 · 2026-06-05 · spec §6.3
//
// Dispatcher single entry point para abrir cualquier juego. Busca en
// seeds (DEMO_JUEGOS / juegos.json) + userCreated merged. Switchea por tipo
// a QuizJugar / VFJugar / FlashcardsJugar. Reemplaza llamadas directas
// QuizJugar.iniciar(...) en las cards.

function _findJuegoCanonical(juegoId) {
    // userCreated primero (post-creación reciente)
    try {
        const raw = localStorage.getItem("xahni:juegos:userCreated") || "[]";
        const user = JSON.parse(raw);
        const found = user.find(j => j.id === juegoId);
        if (found) return found;
    } catch (e) { /* fall through */ }
    if (typeof DEMO_JUEGOS !== "undefined" && Array.isArray(DEMO_JUEGOS)) {
        return DEMO_JUEGOS.find(j => j.id === juegoId) || null;
    }
    return null;
}

/**
 * @interaction abrir-juego
 * @scope shared-juego-dispatcher
 *
 * Given juegoId (string).
 * When un card de juego es clickeado (alumno o profesor preview).
 * Then localiza el juego en seeds + userCreated, switchea por tipo:
 *   - 'quiz' → QuizJugar.iniciar
 *   - 'vf' → VFJugar.iniciar
 *   - 'flashcards' → FlashcardsJugar.iniciar
 *   Default → toast error.
 * Edge:
 *   - juego no encontrado → toast "Juego no encontrado".
 *   - tipo desconocido → toast "Tipo desconocido".
 *   - módulo del tipo no cargado → toast warning.
 */
function abrirJuego(juegoId) {
    const juego = _findJuegoCanonical(juegoId);
    if (!juego) {
        if (typeof showToast === "function") showToast("Juego no encontrado", "danger");
        return;
    }
    switch (juego.tipo) {
        case "quiz":
        case "examen":
            if (typeof QuizJugar === "undefined") {
                if (typeof showToast === "function") showToast("QuizJugar no cargado", "danger");
                return;
            }
            // Fix wiring 2026-06-06: QuizJugar.iniciar() del sprint original
            // espera STRING juegoId (busca internamente vía getJuegosMerged).
            // VFJugar/FlashcardsJugar (escritos en slice B1/B2) esperan OBJETO.
            // Pasamos juego.id al quiz para mantener compat sin reescribir
            // quiz-jugar.js.
            QuizJugar.iniciar(juego.id);
            break;
        case "vf":
            if (typeof VFJugar === "undefined") {
                if (typeof showToast === "function") showToast("VFJugar no cargado", "danger");
                return;
            }
            VFJugar.iniciar(juego);
            break;
        case "flashcards":
            if (typeof FlashcardsJugar === "undefined") {
                if (typeof showToast === "function") showToast("FlashcardsJugar no cargado", "danger");
                return;
            }
            FlashcardsJugar.iniciar(juego);
            break;
        default:
            if (typeof showToast === "function") showToast("Tipo desconocido: " + juego.tipo, "danger");
    }
}
window.abrirJuego = abrirJuego;
