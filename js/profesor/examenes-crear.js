// js/profesor/examenes-crear.js
// Slice Examenes beta E6 · 2026-06-06 · spec §7
//
// CrearExamen wizard mixto con 3 tipos pregunta combinables.
// Single-item nav. Metadata: nombre + parcial obligatorio + masteryMax.
// 2 paths submit: guardar borrador / crear y abrir.
// Edición de borradores: opts.editarId precarga state.

const CrearExamen = (() => {
    const VALOR_MIN = 1, VALOR_MAX = 10;
    const MASTERY_MIN = 10, MASTERY_MAX = 200;
    const MATCH_PARES_MIN = 3, MATCH_PARES_MAX = 8;
    let _state = null;
    let _stateBuffer = null;  // para handoffs futuros

    function _esc(s) {
        return (s || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function _nuevaPregunta() {
        return {
            id: "p" + Date.now() + Math.floor(Math.random() * 1000),
            tipo: "multi",
            texto: "",
            valor: 1,
            opciones: ["", "", "", ""],
            correcta: -1,
            pares: []
        };
    }

    function abrir(materiaId, opts) {
        opts = opts || {};
        const uid = APP?.user?.id;
        if (!uid) return;
        if (APP.user.tipo !== "profesor" && APP.user.tipo !== "administrador") return;

        if (opts.editarId) {
            const existing = (typeof ExamenesData !== "undefined")
                ? ExamenesData._allExamenes().find(e => e.id === opts.editarId)
                : null;
            if (!existing) return;
            if (existing.estado !== "borrador") {
                if (typeof showToast === "function") showToast("Solo borradores son editables", "warn");
                return;
            }
            _state = {
                materiaId: existing.materiaId,
                nombre: existing.nombre,
                parcial: existing.parcial,
                masteryMax: existing.masteryMax || 80,
                mostrarRespuestas: existing.mostrarRespuestas !== false,
                preguntas: JSON.parse(JSON.stringify(existing.preguntas || [])),
                idxActivo: 0,
                editarId: opts.editarId
            };
        } else {
            _state = {
                materiaId: materiaId || null,
                nombre: "",
                parcial: "P1",
                masteryMax: 80,
                mostrarRespuestas: true,
                preguntas: [_nuevaPregunta()],
                idxActivo: 0,
                editarId: null
            };
        }

        const matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
            .find(m => m.id === _state.materiaId)?.nombre || _state.materiaId || "";
        const eyebrowEl = document.getElementById("cex-eyebrow");
        if (eyebrowEl) eyebrowEl.textContent = `📚 ${matNom}`;
        const titEl = document.getElementById("cex-titulo");
        if (titEl) titEl.textContent = _state.editarId ? "Editar borrador" : "Crear nuevo examen";

        _render();
        if (typeof openModal === "function") openModal("modal-crear-examen");
    }

    function _render() {
        if (!_state) return;
        const bodyEl = document.getElementById("cex-body");
        if (!bodyEl) return;

        const total = _state.preguntas.length;
        const i = _state.idxActivo;
        const p = _state.preguntas[i];
        const puedeEliminar = total > 1;

        // Render por tipo
        let tipoContentHtml = "";
        if (p.tipo === "multi") {
            tipoContentHtml = `
                <div class="cex-field">
                    <span class="cex-field__label">Opciones (marca la correcta)</span>
                    ${(p.opciones || []).map((o, j) => `
                        <div class="cex-opcion-row${p.correcta === j ? " cex-opcion-row--correcta" : ""}">
                            <input type="radio" name="cex-correcta-${i}" ${p.correcta === j ? "checked" : ""}
                                   onchange="CrearExamen.setCorrecta(${i}, ${j})"
                                   aria-label="Marcar opción ${String.fromCharCode(65 + j)} como correcta">
                            <span class="cex-opcion-row__letra">${String.fromCharCode(65 + j)}</span>
                            <input type="text" class="cex-input"
                                   placeholder="Opción ${String.fromCharCode(65 + j)}"
                                   value="${_esc(o)}"
                                   oninput="CrearExamen.setOpcion(${i}, ${j}, this.value)">
                        </div>
                    `).join("")}
                </div>
            `;
        } else if (p.tipo === "abierta") {
            tipoContentHtml = `
                <div class="cex-field">
                    <span class="cex-field__label">Sin respuesta correcta — calificación manual</span>
                    <div style="font-size:12px;color:var(--text-muted);font-style:italic">
                        El alumno escribirá libremente y tú calificarás (0-100%).
                    </div>
                </div>
            `;
        } else if (p.tipo === "match") {
            tipoContentHtml = `
                <div class="cex-field">
                    <span class="cex-field__label">Pares concepto ↔ definición (mín ${MATCH_PARES_MIN}, máx ${MATCH_PARES_MAX})</span>
                    ${(p.pares || []).map((par, j) => `
                        <div class="cex-match-par">
                            <input type="text" class="cex-input" placeholder="Concepto" value="${_esc(par.a)}"
                                   oninput="CrearExamen.setPar(${i}, ${j}, 'a', this.value)">
                            <input type="text" class="cex-input" placeholder="Definición" value="${_esc(par.b)}"
                                   oninput="CrearExamen.setPar(${i}, ${j}, 'b', this.value)">
                            <button class="cex-match-par-delete" type="button"
                                    ${(p.pares || []).length <= MATCH_PARES_MIN ? "disabled" : ""}
                                    onclick="CrearExamen.removerPar(${i}, ${j})">✕</button>
                        </div>
                    `).join("")}
                    ${(p.pares || []).length < MATCH_PARES_MAX ? `
                        <button class="x-btn x-btn--ghost cex-add-pregunta" type="button" onclick="CrearExamen.agregarPar(${i})">＋ Agregar par</button>
                    ` : ""}
                </div>
            `;
        }

        bodyEl.innerHTML = `
            <div class="cex-metadata-row">
                <div class="cex-field">
                    <label class="cex-field__label" for="cex-nombre-input">Nombre del examen</label>
                    <input type="text" id="cex-nombre-input" class="cex-input"
                           placeholder="Ej. Examen Parcial 1: BD Fundamentos"
                           value="${_esc(_state.nombre)}"
                           oninput="CrearExamen.setNombre(this.value)">
                </div>
                <div class="cex-field">
                    <label class="cex-field__label" for="cex-mastery-input">Mastery max (${MASTERY_MIN}-${MASTERY_MAX})</label>
                    <input type="number" id="cex-mastery-input" class="cex-input"
                           min="${MASTERY_MIN}" max="${MASTERY_MAX}" step="1"
                           value="${_state.masteryMax}"
                           oninput="CrearExamen.setMasteryMax(this.value)">
                </div>
            </div>

            <div class="cex-field">
                <span class="cex-field__label">Parcial (obligatorio)</span>
                <div class="cex-parcial-group">
                    <div class="cex-parcial-btn${_state.parcial === 'P1' ? ' cex-parcial-btn--active' : ''}" onclick="CrearExamen.setParcial('P1')">P1</div>
                    <div class="cex-parcial-btn${_state.parcial === 'P2' ? ' cex-parcial-btn--active' : ''}" onclick="CrearExamen.setParcial('P2')">P2</div>
                    <div class="cex-parcial-btn${_state.parcial === 'Final' ? ' cex-parcial-btn--active' : ''}" onclick="CrearExamen.setParcial('Final')">Final</div>
                </div>
            </div>

            <div class="cex-field">
                <label class="x-check">
                    <input type="checkbox" id="exam-mostrar-respuestas" ${_state.mostrarRespuestas ? 'checked' : ''}
                           onchange="CrearExamen.setMostrarRespuestas(this.checked)">
                    <span>Mostrar respuestas correctas al alumno al terminar</span>
                </label>
            </div>

            <div class="cex-pregunta-nav">
                <button class="cex-pregunta-nav__btn" type="button"
                        ${i === 0 ? "disabled" : ""}
                        onclick="CrearExamen.irA(${i - 1})">← Anterior</button>
                <span class="cex-pregunta-nav__counter">Pregunta <strong>${i + 1}</strong> de ${total}</span>
                <button class="cex-pregunta-nav__btn" type="button"
                        ${i === total - 1 ? "disabled" : ""}
                        onclick="CrearExamen.irA(${i + 1})">Siguiente →</button>
            </div>

            <div class="cex-pregunta-item">
                <div class="cex-pregunta-item__head">
                    <span class="cex-pregunta-item__label">Pregunta ${i + 1}</span>
                    ${puedeEliminar ? `<button class="cex-pregunta-item__delete" type="button"
                            onclick="CrearExamen.removerPregunta(${i})"
                            aria-label="Eliminar pregunta">✕</button>` : ""}
                </div>

                <div class="cex-field">
                    <span class="cex-field__label">Tipo de pregunta</span>
                    <div class="cex-tipo-selector">
                        <div class="cex-tipo-btn${p.tipo === 'multi' ? ' cex-tipo-btn--active' : ''}" onclick="CrearExamen.setTipoPregunta(${i}, 'multi')">Opción múltiple</div>
                        <div class="cex-tipo-btn${p.tipo === 'abierta' ? ' cex-tipo-btn--active' : ''}" onclick="CrearExamen.setTipoPregunta(${i}, 'abierta')">Respuesta abierta</div>
                        <div class="cex-tipo-btn${p.tipo === 'match' ? ' cex-tipo-btn--active' : ''}" onclick="CrearExamen.setTipoPregunta(${i}, 'match')">Concepto ↔ Definición</div>
                    </div>
                </div>

                <div class="cex-metadata-row">
                    <div class="cex-field">
                        <label class="cex-field__label">Texto de la pregunta</label>
                        <input type="text" class="cex-input"
                               placeholder="¿Qué quieres preguntar?"
                               value="${_esc(p.texto)}"
                               oninput="CrearExamen.setTextoPregunta(${i}, this.value)">
                    </div>
                    <div class="cex-field">
                        <label class="cex-field__label">Valor (${VALOR_MIN}-${VALOR_MAX})</label>
                        <input type="number" class="cex-input"
                               min="${VALOR_MIN}" max="${VALOR_MAX}" step="1"
                               value="${p.valor || 1}"
                               oninput="CrearExamen.setValor(${i}, this.value)">
                    </div>
                </div>

                ${tipoContentHtml}
            </div>

            <button class="x-btn x-btn--ghost cex-add-pregunta" type="button" onclick="CrearExamen.agregarPregunta()">＋ Agregar pregunta</button>
        `;

        _actualizarSubmit();
    }

    function _validar() {
        if (!_state) return false;
        if (!_state.nombre || !_state.nombre.trim()) return false;
        if (!_state.parcial) return false;
        const m = parseInt(_state.masteryMax, 10);
        if (isNaN(m) || m < MASTERY_MIN || m > MASTERY_MAX) return false;
        if (!_state.preguntas.length) return false;
        for (const p of _state.preguntas) {
            if (!p.texto || !p.texto.trim()) return false;
            const v = parseInt(p.valor, 10);
            if (isNaN(v) || v < VALOR_MIN || v > VALOR_MAX) return false;
            if (p.tipo === "multi") {
                if (!Array.isArray(p.opciones) || p.opciones.length !== 4) return false;
                if (p.opciones.some(o => !o || !o.trim())) return false;
                if (p.correcta < 0 || p.correcta > 3) return false;
            } else if (p.tipo === "match") {
                if (!Array.isArray(p.pares)) return false;
                if (p.pares.length < MATCH_PARES_MIN || p.pares.length > MATCH_PARES_MAX) return false;
                if (p.pares.some(par => !par.a || !par.a.trim() || !par.b || !par.b.trim())) return false;
            }
        }
        return true;
    }

    function _actualizarSubmit() {
        const ok = _validar();
        const btnBorrador = document.getElementById("cex-guardar-borrador");
        const btnCrear = document.getElementById("cex-crear-abrir");
        if (btnBorrador) btnBorrador.disabled = !ok;
        if (btnCrear) btnCrear.disabled = !ok;
    }

    function setNombre(v) { if (_state) { _state.nombre = v; _actualizarSubmit(); } }
    function setParcial(p) { if (_state) { _state.parcial = p; _render(); } }
    function setMasteryMax(v) {
        if (!_state) return;
        const n = parseInt(v, 10);
        _state.masteryMax = isNaN(n) ? 80 : Math.max(MASTERY_MIN, Math.min(MASTERY_MAX, n));
        _actualizarSubmit();
    }
    function setMostrarRespuestas(v) { if (_state) _state.mostrarRespuestas = !!v; }

    function setTipoPregunta(idx, tipo) {
        if (!_state || !_state.preguntas[idx]) return;
        const p = _state.preguntas[idx];
        p.tipo = tipo;
        // Reset tipo-specific fields
        if (tipo === "multi") {
            if (!Array.isArray(p.opciones) || p.opciones.length !== 4) p.opciones = ["", "", "", ""];
            if (p.correcta < 0 || p.correcta > 3) p.correcta = -1;
        } else if (tipo === "match") {
            if (!Array.isArray(p.pares) || p.pares.length < MATCH_PARES_MIN) {
                p.pares = [
                    { a: "", b: "" },
                    { a: "", b: "" },
                    { a: "", b: "" }
                ];
            }
        }
        _render();
    }

    function setTextoPregunta(idx, v) {
        if (_state && _state.preguntas[idx]) {
            _state.preguntas[idx].texto = v;
            _actualizarSubmit();
        }
    }

    function setValor(idx, v) {
        if (_state && _state.preguntas[idx]) {
            const n = parseInt(v, 10);
            _state.preguntas[idx].valor = isNaN(n) ? 1 : Math.max(VALOR_MIN, Math.min(VALOR_MAX, n));
            _actualizarSubmit();
        }
    }

    function setOpcion(idx, opIdx, v) {
        if (_state && _state.preguntas[idx]) {
            _state.preguntas[idx].opciones[opIdx] = v;
            _actualizarSubmit();
        }
    }

    function setCorrecta(idx, opIdx) {
        if (_state && _state.preguntas[idx]) {
            _state.preguntas[idx].correcta = opIdx;
            _render();
        }
    }

    function setPar(idx, parIdx, campo, v) {
        if (!_state || !_state.preguntas[idx]) return;
        const p = _state.preguntas[idx];
        if (!p.pares[parIdx]) return;
        if (campo !== "a" && campo !== "b") return;
        p.pares[parIdx][campo] = v;
        _actualizarSubmit();
    }

    function agregarPar(idx) {
        if (!_state || !_state.preguntas[idx]) return;
        const p = _state.preguntas[idx];
        if ((p.pares || []).length >= MATCH_PARES_MAX) return;
        p.pares.push({ a: "", b: "" });
        _render();
    }

    function removerPar(idx, parIdx) {
        if (!_state || !_state.preguntas[idx]) return;
        const p = _state.preguntas[idx];
        if ((p.pares || []).length <= MATCH_PARES_MIN) return;
        p.pares.splice(parIdx, 1);
        _render();
    }

    function agregarPregunta() {
        if (!_state) return;
        _state.preguntas.push(_nuevaPregunta());
        _state.idxActivo = _state.preguntas.length - 1;
        _render();
    }

    function removerPregunta(idx) {
        if (!_state || _state.preguntas.length <= 1) return;
        _state.preguntas.splice(idx, 1);
        if (_state.idxActivo >= _state.preguntas.length) {
            _state.idxActivo = _state.preguntas.length - 1;
        }
        _render();
    }

    function irA(idx) {
        if (!_state) return;
        if (idx < 0 || idx >= _state.preguntas.length) return;
        _state.idxActivo = idx;
        _render();
    }

    function _persistir(estado) {
        if (!_validar() || !_state) return null;
        const uid = APP.user.id;
        const ahora = new Date().toISOString();
        let examen;

        if (_state.editarId) {
            // Edit mode: read userCreated, find, update
            const userCreated = JSON.parse(localStorage.getItem("xahni:examenes:userCreated") || "[]");
            const idx = userCreated.findIndex(e => e.id === _state.editarId);
            if (idx < 0) return null;
            examen = Object.assign({}, userCreated[idx], {
                nombre: _state.nombre.trim(),
                parcial: _state.parcial,
                masteryMax: parseInt(_state.masteryMax, 10) || 80,
                mostrarRespuestas: _state.mostrarRespuestas !== false,
                preguntas: _state.preguntas.map((p, i) => {
                    const out = { id: p.id || ("p" + (i + 1)), tipo: p.tipo, texto: p.texto.trim(), valor: parseInt(p.valor, 10) || 1 };
                    if (p.tipo === "multi") {
                        out.opciones = p.opciones.map(o => o.trim());
                        out.correcta = p.correcta;
                    } else if (p.tipo === "match") {
                        out.pares = p.pares.map(par => ({ a: par.a.trim(), b: par.b.trim() }));
                    }
                    return out;
                })
            });
            userCreated[idx] = examen;
            localStorage.setItem("xahni:examenes:userCreated", JSON.stringify(userCreated));
            // Update runtime DEMO_EXAMENES if present
            if (typeof DEMO_EXAMENES !== "undefined") {
                const dIdx = DEMO_EXAMENES.findIndex(e => e.id === _state.editarId);
                if (dIdx >= 0) DEMO_EXAMENES[dIdx] = examen;
            }
        } else {
            examen = {
                id: "ex_user_" + uid + "_" + Date.now(),
                nombre: _state.nombre.trim(),
                materiaId: _state.materiaId,
                creadoPor: uid,
                parcial: _state.parcial,
                estado: estado,  // "borrador" o "abierto"
                masteryMax: parseInt(_state.masteryMax, 10) || 80,
                mostrarRespuestas: _state.mostrarRespuestas !== false,
                abiertoEn: estado === "abierto" ? ahora : null,
                cerradoEn: null,
                creadoEn: ahora,
                preguntas: _state.preguntas.map((p, i) => {
                    const out = { id: p.id || ("p" + (i + 1)), tipo: p.tipo, texto: p.texto.trim(), valor: parseInt(p.valor, 10) || 1 };
                    if (p.tipo === "multi") {
                        out.opciones = p.opciones.map(o => o.trim());
                        out.correcta = p.correcta;
                    } else if (p.tipo === "match") {
                        out.pares = p.pares.map(par => ({ a: par.a.trim(), b: par.b.trim() }));
                    }
                    return out;
                })
            };
            // Persist userCreated
            const userCreated = JSON.parse(localStorage.getItem("xahni:examenes:userCreated") || "[]");
            userCreated.push(examen);
            localStorage.setItem("xahni:examenes:userCreated", JSON.stringify(userCreated));
            // Append runtime
            if (typeof DEMO_EXAMENES !== "undefined") DEMO_EXAMENES.push(examen);

            // Emit canonical event para persistencia Firestore (F3).
            try {
                document.dispatchEvent(new CustomEvent("xahni:examenCreado", {
                    detail: { examen: examen }
                }));
            } catch (_) { /* defensive */ }
        }
        return examen;
    }

    function guardarBorrador() {
        const examen = _persistir("borrador");
        if (!examen) return;
        if (typeof showToast === "function") {
            showToast(`✓ Borrador guardado: "${examen.nombre}"`, "ok");
        }
        cerrar();
    }

    function crearYAbrir() {
        const examen = _persistir("abierto");
        if (!examen) return;
        // toggleEstado dispara emit xahni:examenAbierto
        if (typeof ExamenesData !== "undefined") {
            ExamenesData.toggleEstado(examen.id, "abierto");
        }
        if (typeof showToast === "function") {
            showToast(`✓ Examen abierto: "${examen.nombre}"`, "ok");
        }
        cerrar();
    }

    function cerrar(opts) {
        opts = opts || {};
        if (typeof closeModal === "function") closeModal("modal-crear-examen");
        if (!opts.preserveState) _state = null;
    }

    return {
        abrir, cerrar,
        setNombre, setParcial, setMasteryMax, setMostrarRespuestas,
        setTipoPregunta, setTextoPregunta, setValor,
        setOpcion, setCorrecta,
        setPar, agregarPar, removerPar,
        agregarPregunta, removerPregunta, irA,
        guardarBorrador, crearYAbrir
    };
})();
window.CrearExamen = CrearExamen;
