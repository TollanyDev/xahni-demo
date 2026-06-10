// js/profesor/crear-quiz.js
// Sprint entrega 2026-06-08 · SELECTIVOS A (wizard prof crear quiz)
//
// Modal #modal-crear-quiz: formulario simple de UNA sola pantalla (no 3-step
// per scope explícito del sprint). Profesor define nombre + 1..5 preguntas
// (cada una con texto + 4 opciones + radio correcta). Submit persiste vía
// `addUserJuego` (shared helper en quiz-jugar.js) y re-renderiza el panel
// hub-materia tab Juegos para que el quiz aparezca inmediatamente.
//
// Consumidores: alumno via `iniciarQuiz` (que usa `getJuegosMerged` para
// fusionar seed + user-created).

const CrearQuiz = (() => {
    const MAX_PREGUNTAS = 5;
    let _state = null;
    let _materiaId = null;
    let _nextLocalId = 1;

    function _nuevaPregunta() {
        return {
            id: `q${_nextLocalId++}`,
            texto: "",
            opciones: ["", "", "", ""],
            correcta: -1
        };
    }

    /**
     * @interaction crear-quiz-abrir
     * @scope profesor-crear-quiz-entry
     *
     * Given materiaId (string id de DEMO_MATERIAS).
     * When profesor click "+ Crear quiz" en tab Juegos hub-materia.
     * Then:
     *   1. Reset _state con 1 pregunta vacía + nombre="".
     *   2. Header del modal: chip materia + título "Crear nuevo quiz".
     *   3. Render body con nombre input + preguntas list + "+ Agregar
     *      pregunta" button.
     *   4. openModal canónico.
     * Edge:
     *   - materiaId falsy → no-op.
     *   - profesor no logueado → no-op.
     */
    function abrir(materiaId) {
        if (!materiaId) return;
        const uid = (typeof APP !== "undefined" && APP.user) ? APP.user.id : null;
        // Fix UX 2026-06-06 (juegos-beta D-J6 + D-J15): creator-economy
        // permite alumno+profesor; solo admin queda excluido. Antes solo
        // profesor, lo que silenciaba el flujo desde el panel de alumno.
        if (!uid || APP.user.tipo === "administrador") return;

        _materiaId = materiaId;
        _nextLocalId = 1;
        _state = {
            nombre: "",
            preguntas: [_nuevaPregunta()],
            idxActivo: 0
        };

        // Header materia label.
        const matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
            .find(m => m.id === materiaId)?.nombre || materiaId;
        const matEl = document.getElementById("cq-materia");
        if (matEl) matEl.textContent = `📚 ${matNom}`;

        render();
        if (typeof openModal === "function") openModal("modal-crear-quiz");
        // Focus en input nombre tras render.
        setTimeout(() => {
            const inp = document.getElementById("cq-nombre-input");
            if (inp) inp.focus();
        }, 80);
    }

    /**
     * @interaction crear-quiz-render
     * @scope profesor-crear-quiz-render-form
     *
     * Given _state activo.
     * When abrir / agregarPregunta / removerPregunta / handlers internos.
     * Then renderiza form completo en #cq-body. Cada cambio de campo via
     *   oninput/onchange actualiza _state. Submit button habilitado/
     *   deshabilitado según _validar().
     * Edge: _state null → no-op.
     */
    function render() {
        if (!_state) return;
        const bodyEl = document.getElementById("cq-body");
        if (!bodyEl) return;

        const total = _state.preguntas.length;
        const i = _state.idxActivo || 0;
        const p = _state.preguntas[i];
        const puedeAgregar = total < MAX_PREGUNTAS;
        const puedeEliminar = total > 1;

        bodyEl.innerHTML = `
            <label class="cq-field">
                <span class="cq-field__label">Nombre del quiz</span>
                <input type="text"
                       id="cq-nombre-input"
                       class="cq-input"
                       placeholder="Ej. Triggers y procedimientos"
                       value="${_esc(_state.nombre)}"
                       oninput="crearQuizSetNombre(this.value)" />
            </label>

            <div class="cw-nav">
                <button class="cw-nav__btn" type="button"
                        ${i === 0 ? "disabled" : ""}
                        onclick="crearQuizIrA(${i - 1})">← Anterior</button>
                <span class="cw-nav__counter">Pregunta <strong>${i + 1}</strong> de ${total}</span>
                <button class="cw-nav__btn" type="button"
                        ${i === total - 1 ? "disabled" : ""}
                        onclick="crearQuizIrA(${i + 1})">Siguiente →</button>
            </div>

            <div class="cw-item">
                <div class="cw-item__head">
                    <span class="cw-item__label">Pregunta ${i + 1}</span>
                    ${puedeEliminar ? `<button class="cw-item-delete" type="button"
                            onclick="crearQuizRemoverPregunta(${i})"
                            aria-label="Eliminar pregunta">✕</button>` : ""}
                </div>
                <label class="cq-field">
                    <span class="cq-field__label">Texto de la pregunta</span>
                    <input type="text"
                           class="cq-input"
                           placeholder="¿Qué quieres preguntar?"
                           value="${_esc(p.texto)}"
                           oninput="crearQuizSetCampo(${i}, 'texto', this.value)" />
                </label>
                <div class="cq-opciones-list">
                    <span class="cq-field__label">Opciones (marca la correcta)</span>
                    ${p.opciones.map((o, j) => `
                        <label class="cq-opcion-row${p.correcta === j ? " cq-opcion-row--correcta" : ""}">
                            <input type="radio"
                                   name="cq-correcta-${i}"
                                   ${p.correcta === j ? "checked" : ""}
                                   onchange="crearQuizSetCorrecta(${i}, ${j})"
                                   aria-label="Marcar opción ${String.fromCharCode(65 + j)} como correcta" />
                            <span class="cq-opcion-row__letra">${String.fromCharCode(65 + j)}</span>
                            <input type="text"
                                   class="cq-input cq-opcion-row__input"
                                   placeholder="Opción ${String.fromCharCode(65 + j)}"
                                   value="${_esc(o)}"
                                   oninput="crearQuizSetOpcion(${i}, ${j}, this.value)" />
                        </label>
                    `).join("")}
                </div>
            </div>

            ${puedeAgregar ? `
                <button class="x-btn x-btn--ghost cq-add-pregunta" type="button" onclick="crearQuizAgregarPregunta()">
                    ＋ Agregar pregunta
                </button>
            ` : `
                <div class="cq-add-pregunta-info">Máximo ${MAX_PREGUNTAS} preguntas alcanzado.</div>
            `}
        `;

        _actualizarSubmit();
    }

    function irA(idx) {
        if (!_state) return;
        if (idx < 0 || idx >= _state.preguntas.length) return;
        _state.idxActivo = idx;
        render();
    }

    function _actualizarSubmit() {
        const btn = document.getElementById("cq-submit");
        if (btn) btn.disabled = !_validar();
    }

    /**
     * @interaction crear-quiz-validar
     * @scope profesor-crear-quiz-helper
     *
     * Given _state activo.
     * When tras cada cambio de campo o antes de guardar.
     * Then retorna true si: nombre no vacío + cada pregunta tiene texto + 4
     *   opciones no vacías + correcta seleccionada (0..3). Else false.
     */
    function _validar() {
        if (!_state) return false;
        if (!_state.nombre.trim()) return false;
        if (!_state.preguntas.length) return false;
        for (const p of _state.preguntas) {
            if (!p.texto.trim()) return false;
            if (!Array.isArray(p.opciones) || p.opciones.length !== 4) return false;
            if (p.opciones.some(o => !o.trim())) return false;
            if (p.correcta < 0 || p.correcta > 3) return false;
        }
        return true;
    }

    function setNombre(v) { if (_state) { _state.nombre = v; _actualizarSubmit(); } }
    function setCampo(idx, campo, v) {
        if (!_state || !_state.preguntas[idx]) return;
        _state.preguntas[idx][campo] = v;
        _actualizarSubmit();
    }
    function setOpcion(idx, opIdx, v) {
        if (!_state || !_state.preguntas[idx]) return;
        _state.preguntas[idx].opciones[opIdx] = v;
        _actualizarSubmit();
    }
    function setCorrecta(idx, opIdx) {
        if (!_state || !_state.preguntas[idx]) return;
        _state.preguntas[idx].correcta = opIdx;
        render();
    }
    function agregarPregunta() {
        if (!_state || _state.preguntas.length >= MAX_PREGUNTAS) return;
        _state.preguntas.push(_nuevaPregunta());
        _state.idxActivo = _state.preguntas.length - 1;
        render();
    }
    function removerPregunta(idx) {
        if (!_state || _state.preguntas.length <= 1) return;
        _state.preguntas.splice(idx, 1);
        if (_state.idxActivo >= _state.preguntas.length) {
            _state.idxActivo = _state.preguntas.length - 1;
        }
        render();
    }

    /**
     * @interaction crear-quiz-guardar
     * @scope profesor-crear-quiz-submit
     *
     * Given _state válido + profesor logueado.
     * When click "Crear quiz".
     * Then:
     *   1. Genera id timestamp-based + uid.
     *   2. Persiste via addUserJuego.
     *   3. Cierra modal + reset _state.
     *   4. Toast feedback "✓ Quiz creado".
     *   5. Re-render del panel hub-materia tab Juegos.
     * Edge: invalid → no-op (guard via submit disabled).
     */
    function guardar() {
        if (!_validar()) return;
        const uid = (typeof APP !== "undefined" && APP.user) ? APP.user.id : "anon";
        const ts = Date.now();
        const juego = {
            id: `user_${uid}_${ts}`,
            nombre: _state.nombre.trim(),
            tipo: "quiz",
            materiaId: _materiaId,
            creadoPor: uid,
            preguntas: _state.preguntas.map((p, i) => ({
                id: `q${i + 1}`,
                texto: p.texto.trim(),
                opciones: p.opciones.map(o => o.trim()),
                correcta: p.correcta
            })),
            creadoEn: new Date().toISOString()
        };
        if (typeof addUserJuego === "function") addUserJuego(juego);

        // C6: Dispatch event para que listeners (e.g. CrearTorneo handoff) reaccionen
        try {
            document.dispatchEvent(new CustomEvent("xahni:juegoCreado", { detail: { juego } }));
        } catch (e) { /* defensive */ }

        if (typeof closeModal === "function") closeModal("modal-crear-quiz");
        if (typeof showToast === "function") {
            showToast(`✓ Quiz "${juego.nombre}" creado`, "ok");
        }
        _state = null;
        _materiaId = null;
        // Re-render panel para mostrar el nuevo quiz.
        if (typeof window.profHubMatRenderJuegos === "function"
            && typeof APP !== "undefined" && APP.profHubMatActivo) {
            window.profHubMatRenderJuegos("prof-hub-mat-panel-juegos", APP.profHubMatActivo.matId);
        }
    }

    function cerrar() {
        if (typeof closeModal === "function") closeModal("modal-crear-quiz");
        _state = null;
        _materiaId = null;
    }

    /**
     * @interaction crear-quiz-eliminar
     * @scope profesor-crear-quiz-delete
     *
     * Given juegoId de un user-created (verifica que pertenece a este uid).
     * When profesor click 🗑 en card "Tu creación".
     * Then confirm dialog → removeUserJuego → toast + re-render panel.
     * Edge: si el juego no pertenece al uid → no-op silencioso.
     */
    function eliminar(juegoId) {
        if (!juegoId) return;
        const uid = (typeof APP !== "undefined" && APP.user) ? APP.user.id : null;
        const userJuegos = (typeof getUserJuegos === "function") ? getUserJuegos() : [];
        const juego = userJuegos.find(j => j.id === juegoId);
        if (!juego || juego.creadoPor !== uid) return;

        const ok = confirm(`¿Eliminar el quiz "${juego.nombre}"? Esta acción no se puede deshacer.`);
        if (!ok) return;

        if (typeof removeUserJuego === "function") removeUserJuego(juegoId);
        if (typeof showToast === "function") {
            showToast(`Quiz "${juego.nombre}" eliminado`, "info");
        }
        if (typeof window.profHubMatRenderJuegos === "function"
            && typeof APP !== "undefined" && APP.profHubMatActivo) {
            window.profHubMatRenderJuegos("prof-hub-mat-panel-juegos", APP.profHubMatActivo.matId);
        }
    }

    function _esc(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    return {
        abrir, render, guardar, cerrar, eliminar, irA,
        setNombre, setCampo, setOpcion, setCorrecta,
        agregarPregunta, removerPregunta,
        _MAX_PREGUNTAS: MAX_PREGUNTAS
    };
})();

// Wrappers globales para onclick inline (markup HTML + panel).
function crearQuizAbrir(materiaId) { CrearQuiz.abrir(materiaId); }
function crearQuizCerrar() { CrearQuiz.cerrar(); }
function crearQuizGuardar() { CrearQuiz.guardar(); }
function crearQuizSetNombre(v) { CrearQuiz.setNombre(v); }
function crearQuizSetCampo(idx, campo, v) { CrearQuiz.setCampo(idx, campo, v); }
function crearQuizSetOpcion(idx, opIdx, v) { CrearQuiz.setOpcion(idx, opIdx, v); }
function crearQuizSetCorrecta(idx, opIdx) { CrearQuiz.setCorrecta(idx, opIdx); }
function crearQuizAgregarPregunta() { CrearQuiz.agregarPregunta(); }
function crearQuizRemoverPregunta(idx) { CrearQuiz.removerPregunta(idx); }
function crearQuizIrA(idx) { CrearQuiz.irA(idx); }
function crearQuizEliminar(juegoId) { CrearQuiz.eliminar(juegoId); }
