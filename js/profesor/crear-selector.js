// js/profesor/crear-selector.js
// Slice Juegos beta A1 · 2026-06-05 · spec §5.1
//
// Modal selector intermedio entre el CTA "+ Crear" y los wizards Quiz/V/F/
// Flashcards. Almacena materiaId del contexto (de qué hub-materia se abrió)
// para pasarla al wizard elegido.

const CrearSelector = (() => {
    let _ctxMateriaId = null;
    // Bundle C 2026-06-09: modo "ia" redirige al flow Temario+IA en vez del
    // wizard manual. _ctxIa contiene {temaId, temaTitulo, esAlumno} cuando
    // el selector fue invocado desde el botón Generar juego (IA) del temario.
    let _modo = "crear";
    let _ctxIa = null;

    function abrir(materiaId, opts) {
        _ctxMateriaId = materiaId || null;
        _modo = (opts && opts.modo === "ia") ? "ia" : "crear";
        _ctxIa = (opts && opts.ctxIa) || null;
        // Cambiar el título del modal según el modo
        const titEl = document.querySelector("#modal-selector-tipo-juego .cs-titulo");
        if (titEl) titEl.textContent = (_modo === "ia")
            ? "¿Qué tipo de juego quieres generar con IA?"
            : "¿Qué tipo de juego quieres crear?";
        if (typeof openModal === "function") openModal("modal-selector-tipo-juego");
    }

    function elegir(tipo) {
        const mid = _ctxMateriaId;
        const modo = _modo;
        const ctxIa = _ctxIa;
        // Force-close síncrono antes de abrir el siguiente modal
        const selectorEl = document.getElementById("modal-selector-tipo-juego");
        if (selectorEl) selectorEl.classList.remove("active", "closing");
        _ctxMateriaId = null;
        _modo = "crear";
        _ctxIa = null;

        if (modo === "ia" && typeof TemarioIaModal !== "undefined") {
            // Continuar al flow IA con el tipo seleccionado
            if (ctxIa && ctxIa.esAlumno) {
                TemarioIaModal.openGenerarJuegoAlumno(mid, ctxIa.temaId, ctxIa.temaTitulo, tipo);
            } else if (ctxIa) {
                TemarioIaModal.openGenerarJuego(mid, ctxIa.temaId, ctxIa.temaTitulo, tipo);
            }
            return;
        }

        if (tipo === "quiz" && typeof crearQuizAbrir === "function") {
            crearQuizAbrir(mid);
        } else if (tipo === "vf" && typeof CrearVF !== "undefined") {
            CrearVF.abrir(mid);
        } else if (tipo === "flashcards" && typeof CrearFlashcards !== "undefined") {
            CrearFlashcards.abrir(mid);
        } else {
            if (typeof showToast === "function") showToast("Tipo no implementado: " + tipo, "danger");
        }
    }

    function cerrar() {
        if (typeof closeModal === "function") closeModal("modal-selector-tipo-juego");
        _ctxMateriaId = null;
    }

    return { abrir, elegir, cerrar };
})();
window.CrearSelector = CrearSelector;
