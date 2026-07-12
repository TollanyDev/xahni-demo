// js/shared/examenes-tomar.js
// Slice Examenes beta E4 · 2026-06-06 · spec §8.1
//
// Modal tomar examen con shell académico (no gamificado).
// Reusa lógica conceptual de 3 tipos pregunta del sprint (quiz-jugar.js)
// pero con UI propia .ex-*. Navegación LIBRE entre preguntas hasta enviar.

const ExamenesTomar = (() => {

    let _state = null;

    function _esc(s) {
        return (s || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function _shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function abrir(exId) {
        if (typeof ExamenesData === "undefined") return;
        const examen = ExamenesData._allExamenes().find(e => e.id === exId);
        if (!examen) return;
        const uid = APP?.user?.id;
        if (!uid) return;

        _state = {
            examen: examen,
            uid: uid,
            idx: 0,
            // respuestas: {pregId: value} — multi:number, abierta:string, match:{aText:bText}
            respuestas: {},
            // Pre-shuffle definiciones para preguntas match (solo orden visual)
            matchOrder: {}
        };
        (examen.preguntas || []).forEach(p => {
            if (p.tipo === "match") {
                _state.matchOrder[p.id] = _shuffle((p.pares || []).map(par => par.b));
            }
        });

        const matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
            .find(m => m.id === examen.materiaId)?.nombre || examen.materiaId;
        const eyebrowEl = document.getElementById("ex-eyebrow");
        if (eyebrowEl) eyebrowEl.textContent = `📚 ${matNom} · ${examen.parcial}`;
        const titEl = document.getElementById("ex-titulo");
        if (titEl) titEl.textContent = examen.nombre;

        _renderPregunta(0);
        if (typeof openModal === "function") openModal("modal-tomar-examen");
    }

    function _renderPregunta(idx) {
        if (!_state) return;
        _state.idx = idx;
        const examen = _state.examen;
        const total = (examen.preguntas || []).length;
        const preg = examen.preguntas[idx];
        if (!preg) return;

        // Progreso
        const progEl = document.getElementById("ex-progreso");
        if (progEl) progEl.textContent = `Pregunta ${idx + 1} de ${total} · valor ${preg.valor || 1} pts`;

        // Body — pregunta + render por tipo
        const bodyEl = document.getElementById("ex-body");
        if (!bodyEl) return;
        const valorChip = `<span class="ex-pregunta__valor">VALOR ${preg.valor || 1} pts</span>`;
        const tituloPreg = `<div class="ex-pregunta__texto">${_esc(preg.texto)}</div>`;

        let respHtml = "";
        const respPrev = _state.respuestas[preg.id];

        if (preg.tipo === "multi") {
            const opcionesHtml = (preg.opciones || []).map((opt, i) => `
                <div class="ex-multi-opcion${respPrev === i ? " ex-multi-opcion--selected" : ""}"
                     onclick="ExamenesTomar.setRespuesta('${preg.id}', ${i})">
                    <div></div>
                    <span class="ex-multi-opcion__letra">${String.fromCharCode(65 + i)}</span>
                    <span>${_esc(opt)}</span>
                </div>
            `).join("");
            respHtml = `<div class="ex-multi-opciones">${opcionesHtml}</div>`;
        } else if (preg.tipo === "abierta") {
            const txt = (typeof respPrev === "string") ? respPrev : "";
            respHtml = `
                <textarea class="ex-abierta-textarea"
                          placeholder="Escribe tu respuesta aquí…"
                          oninput="ExamenesTomar.setRespuesta('${preg.id}', this.value)">${_esc(txt)}</textarea>
            `;
        } else if (preg.tipo === "match") {
            const pares = preg.pares || [];
            const bOrder = _state.matchOrder[preg.id] || pares.map(p => p.b);
            const seleccion = (respPrev && typeof respPrev === "object") ? respPrev : {};
            // Lista izquierda: conceptos en orden original
            // Lista derecha: definiciones shuffled (dropdowns para asignar)
            const optionsHtml = bOrder.map(b => `<option value="${_esc(b)}">${_esc(b)}</option>`).join("");
            const rowsHtml = pares.map(par => {
                const seleccionado = seleccion[par.a] || "";
                return `
                    <div class="ex-match-item">
                        <div style="font-weight:600;margin-bottom:6px">${_esc(par.a)}</div>
                        <select class="ex-abierta-textarea" style="min-height:auto;padding:8px"
                                onchange="ExamenesTomar.setMatch('${preg.id}', '${_esc(par.a)}', this.value)">
                            <option value="" ${seleccionado === "" ? "selected" : ""}>— Elige —</option>
                            ${bOrder.map(b => `<option value="${_esc(b)}" ${seleccionado === b ? "selected" : ""}>${_esc(b)}</option>`).join("")}
                        </select>
                    </div>
                `;
            }).join("");
            respHtml = `
                <div class="ex-match__col-titulo">Empareja cada concepto con su definición:</div>
                <div style="display:flex;flex-direction:column;gap:10px">${rowsHtml}</div>
            `;
        }

        bodyEl.innerHTML = `
            <div class="ex-pregunta">
                ${valorChip}
                ${tituloPreg}
                ${respHtml}
            </div>
        `;

        _updateFooter();
    }

    function _updateFooter() {
        if (!_state) return;
        const total = (_state.examen.preguntas || []).length;
        const idx = _state.idx;

        // Progress dots
        const dotsEl = document.getElementById("ex-footer-progress");
        if (dotsEl) {
            dotsEl.innerHTML = (_state.examen.preguntas || []).map((p, i) => {
                const respondida = _esRespondida(p, _state.respuestas[p.id]);
                const actual = i === idx;
                return `<span class="ex-footer__dot${respondida ? " ex-footer__dot--respondida" : ""}${actual ? " ex-footer__dot--actual" : ""}"></span>`;
            }).join("");
        }

        // Prev/Next/Enviar buttons
        const prevBtn = document.getElementById("ex-prev");
        const nextBtn = document.getElementById("ex-next");
        const enviarBtn = document.getElementById("ex-enviar");
        if (prevBtn) prevBtn.hidden = idx === 0;
        const esUltima = idx === total - 1;
        if (nextBtn) nextBtn.hidden = esUltima;
        if (enviarBtn) enviarBtn.hidden = !esUltima;
    }

    function _esRespondida(preg, respuesta) {
        if (respuesta === undefined || respuesta === null) return false;
        if (preg.tipo === "multi") return typeof respuesta === "number";
        if (preg.tipo === "abierta") return typeof respuesta === "string" && respuesta.trim().length > 0;
        if (preg.tipo === "match") {
            if (typeof respuesta !== "object") return false;
            const pares = preg.pares || [];
            return pares.every(par => respuesta[par.a] && respuesta[par.a].trim().length > 0);
        }
        return false;
    }

    function setRespuesta(pregId, valor) {
        if (!_state) return;
        _state.respuestas[pregId] = valor;
        // Re-render solo pregunta multi para que el selected aplique visual
        const preg = _state.examen.preguntas.find(p => p.id === pregId);
        if (preg && preg.tipo === "multi") {
            _renderPregunta(_state.idx);
        } else {
            // Para abierta/match el oninput/onchange ya actualiza visual nativo
            _updateFooter();
        }
    }

    function setMatch(pregId, aText, bText) {
        if (!_state) return;
        if (!_state.respuestas[pregId] || typeof _state.respuestas[pregId] !== "object") {
            _state.respuestas[pregId] = {};
        }
        _state.respuestas[pregId][aText] = bText;
        _updateFooter();
    }

    function siguiente() {
        if (!_state) return;
        const total = (_state.examen.preguntas || []).length;
        if (_state.idx < total - 1) _renderPregunta(_state.idx + 1);
    }

    function anterior() {
        if (!_state) return;
        if (_state.idx > 0) _renderPregunta(_state.idx - 1);
    }

    function enviar() {
        if (!_state) return;
        const examen = _state.examen;
        const preguntas = examen.preguntas || [];
        const sinResponder = preguntas.filter(p => !_esRespondida(p, _state.respuestas[p.id])).length;

        const confirmarEnvio = () => {
            if (typeof confirmarCanonico !== "function") {
                if (confirm("¿Enviar examen? No podrás modificar respuestas después.")) _ejecutarEnvio();
                return;
            }
            confirmarCanonico({
                icono: "✓",
                titulo: "¿Enviar examen?",
                mensaje: "No podrás modificar respuestas después.",
                accionTexto: "Enviar",
                tipo: "primary"
            }).then(confirmed => {
                if (confirmed) _ejecutarEnvio();
            });
        };

        if (sinResponder > 0) {
            if (typeof confirmarCanonico === "function") {
                confirmarCanonico({
                    icono: "⚠️",
                    titulo: `Tienes ${sinResponder} preguntas sin responder`,
                    mensaje: "Las preguntas sin responder cuentan como 0. ¿Enviar de todas formas?",
                    accionTexto: "Sí, enviar",
                    tipo: "warn"
                }).then(confirmed => {
                    if (confirmed) confirmarEnvio();
                });
            } else {
                confirmarEnvio();
            }
        } else {
            confirmarEnvio();
        }
    }

    function _ejecutarEnvio() {
        if (!_state) return;
        const examen = _state.examen;
        const uid = _state.uid;

        // Persistir respuestas
        ExamenesData.setRespuestas(examen.id, uid, _state.respuestas);
        // Recalcular calificación (incluye chequeo de abiertas → califFinal o null)
        const calif = ExamenesData.recalcularCalificacionFinal(examen.id, uid);

        // Si NO hay abiertas pendientes (todas multi+match) → aplicar mastery + rubro
        const tieneAbiertas = (examen.preguntas || []).some(p => p.tipo === "abierta");
        if (!tieneAbiertas && calif.califFinal !== null) {
            ExamenesData.aplicarMastery(uid, examen, calif.califFinal);
            ExamenesData.aplicarARubroParcial(uid, examen, calif.califFinal);
            try {
                document.dispatchEvent(new CustomEvent("xahni:examenCalificado", {
                    detail: {
                        exId: examen.id,
                        uid: uid,
                        califFinal: calif.califFinal,
                        masteryGanado: ExamenesData.calcularMasteryGanado(examen, calif.califFinal)
                    }
                }));
            } catch (e) { /* defensive */ }
        } else {
            // Con abiertas — emit examenTomado
            try {
                document.dispatchEvent(new CustomEvent("xahni:examenTomado", {
                    detail: {
                        exId: examen.id,
                        uid: uid,
                        respuestas: _state.respuestas,
                        califParcial: calif.califParcial
                    }
                }));
            } catch (e) { /* defensive */ }
        }

        // Pantalla resultados
        _state.calif = calif;
        _renderResultado(examen, calif);
    }

    function _renderResultado(examen, calif) {
        const tieneAbiertas = (examen.preguntas || []).some(p => p.tipo === "abierta");
        const bodyEl = document.getElementById("ex-body");
        const footerEl = document.getElementById("ex-footer");
        if (footerEl) footerEl.style.display = "none";

        const verRespuestasBtn = examen.mostrarRespuestas !== false
            ? `<button class="x-btn x-btn--ghost" onclick="ExamenesTomar.verRespuestas()">Ver respuestas correctas</button>`
            : '';

        if (calif.califFinal !== null) {
            // Calificado completo
            const masteryGanado = ExamenesData.calcularMasteryGanado(examen, calif.califFinal);
            bodyEl.innerHTML = `
                <div class="ex-resultado">
                    <div class="ex-resultado__calif">${calif.califFinal.toFixed(1)} / 10</div>
                    <div class="ex-resultado__sub">↑ +${masteryGanado} mastery por "${_esc(examen.nombre)}"</div>
                    ${verRespuestasBtn}
                    <button class="x-btn x-btn--primary" onclick="ExamenesTomar.cerrar()">Volver a Exámenes</button>
                </div>
            `;
        } else {
            // Pendiente (con abiertas)
            const abiertasPendientes = (examen.preguntas || []).filter(p => p.tipo === "abierta").length;
            const masteryProvisional = ExamenesData.calcularMasteryGanado(examen, calif.califParcial);
            bodyEl.innerHTML = `
                <div class="ex-resultado">
                    <div class="ex-resultado__calif">${calif.califParcial.toFixed(1)} / 10</div>
                    <div class="ex-resultado__sub">Calificación parcial (solo auto-corregibles)</div>
                    <div class="ex-resultado__pendiente">⏳ ${abiertasPendientes} preguntas abiertas esperando a tu profe<br>Mastery provisional: ~${masteryProvisional} pts (puede subir)</div>
                    ${verRespuestasBtn}
                    <button class="x-btn x-btn--primary" onclick="ExamenesTomar.cerrar()">Volver a Exámenes</button>
                </div>
            `;
        }
    }

    /**
     * @interaction examenes-ver-respuestas
     * @scope shared-examenes-tomar-review
     *
     * Given examen terminado, render summary, alumno click "Ver respuestas".
     * When verRespuestas() lee _state.examen + _state.respuestas y construye items[]
     *   con shape canónico para buildReviewScreen.
     * Then reemplaza #ex-body con la vista de review. onClose vuelve a _renderResultado.
     *
     * Slice review respuestas A · 2026-06-08
     * Spec: docs/superpowers/specs/2026-06-08-review-respuestas-correctas-design.md
     */
    function verRespuestas() {
        const examen = _state.examen;
        const items = (examen.preguntas || []).map(p => {
            const tuResp = _state.respuestas[p.id];
            const base = {
                tipo: p.tipo,
                enunciado: p.texto
            };
            if (p.tipo === 'multi') {
                /* JSON: pregunta.correcta es índice numérico. Convertir a texto
                   para que el builder pueda comparar contra tuResp (texto). Si
                   tuResp también es índice, normalizar a texto aquí. */
                const correctaTxt = (typeof p.correcta === 'number')
                    ? p.opciones[p.correcta]
                    : p.correcta;
                const tuTxt = (typeof tuResp === 'number')
                    ? p.opciones[tuResp]
                    : tuResp;
                return Object.assign(base, {
                    opciones: p.opciones,
                    correcta: correctaTxt,
                    tuRespuesta: tuTxt
                });
            }
            if (p.tipo === 'abierta') {
                return Object.assign(base, {
                    tuRespuesta: tuResp,
                    calificacion: (_state.calificacionesAbiertas && _state.calificacionesAbiertas[p.id]) || null
                });
            }
            if (p.tipo === 'match') {
                return Object.assign(base, {
                    pares: p.pares,
                    tuPares: tuResp || {}
                });
            }
            return base;
        });

        const container = document.getElementById('ex-body');
        const handle = buildReviewScreen({
            items,
            container,
            onClose: () => {
                handle.destroy();
                _renderResultado(_state.examen, _state.calif);
            },
            onExit: () => {
                handle.destroy();
                cerrar();
            }
        });
    }

    function cerrar() {
        const footerEl = document.getElementById("ex-footer");
        if (footerEl) footerEl.style.display = "";  // restore para próxima vez
        if (typeof closeModal === "function") closeModal("modal-tomar-examen");
        _state = null;
    }

    return {
        abrir, cerrar,
        setRespuesta, setMatch,
        siguiente, anterior,
        enviar,
        verRespuestas
    };
})();
window.ExamenesTomar = ExamenesTomar;
