// js/shared/vf-jugar.js
// Slice Juegos beta B1 · 2026-06-05 · spec §6.1
//
// IIFE VFJugar in-game V/F. Reusa chrome del modal jugar quiz (header con
// materia + título + timer + footer navegación). 2 botones binarios por
// afirmación. xpPorAcierto = 15. Dispatcha xahni:juegoTerminado al terminar.

const VFJugar = (() => {
    const XP_POR_ACIERTO = 15;
    let _state = null;
    let _timerInterval = null;

    function _findMateria(materiaId) {
        if (typeof DEMO_MATERIAS === "undefined") return null;
        return (DEMO_MATERIAS || []).find(m => m.id === materiaId) || null;
    }

    function _fmtTime(seg) {
        const m = Math.floor(seg / 60);
        const s = seg % 60;
        return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }

    function _updateTimer() {
        if (!_state) return;
        const seg = Math.floor((Date.now() - _state.startedAt) / 1000);
        const el = document.getElementById("vfj-timer");
        if (el) el.textContent = _fmtTime(seg);
        _state.tiempoSegundos = seg;
    }

    function _updateProgress() {
        const el = document.getElementById("vfj-progress");
        if (el && _state) el.textContent = `Afirmación ${_state.idx + 1} de ${_state.juego.afirmaciones.length}`;
    }

    function _updateFooter() {
        if (!_state) return;
        const idx = _state.idx;
        const total = _state.juego.afirmaciones.length;
        const a = _state.respuestas[idx];
        const respondida = (a === true || a === false);
        const anteriorBtn = document.getElementById("vfj-anterior");
        const siguienteBtn = document.getElementById("vfj-siguiente");
        const terminarBtn = document.getElementById("vfj-terminar");
        const esPrimera = idx === 0;
        const esUltima = idx === total - 1;
        // Fix UX 2026-06-06: Anterior solo desde la 2da afirmación.
        if (anteriorBtn) {
            anteriorBtn.style.display = esPrimera ? "none" : "";
        }
        if (siguienteBtn) {
            siguienteBtn.disabled = !respondida || esUltima;
            siguienteBtn.style.display = esUltima ? "none" : "";
        }
        if (terminarBtn) {
            const todasRespondidas = _state.respuestas.every(r => r === true || r === false);
            terminarBtn.disabled = !todasRespondidas;
            terminarBtn.style.display = esUltima ? "" : "none";
        }
    }

    function _renderAfirmacion() {
        if (!_state) return;
        const body = document.getElementById("vfj-body");
        if (!body) return;
        const afirmacion = _state.juego.afirmaciones[_state.idx];
        const respuestaActual = _state.respuestas[_state.idx];
        body.innerHTML = `
            <div class="vfj-afirmacion">
                <div class="vfj-afirmacion__label">Afirmación ${_state.idx + 1}</div>
                <div class="vfj-afirmacion__texto">"${(afirmacion.texto || "").replace(/</g, "&lt;")}"</div>
            </div>
            <div class="vfj-binario" role="radiogroup" aria-label="Verdadero o Falso">
                <button class="vfj-btn vfj-btn--verdadero ${respuestaActual === true ? 'vfj-btn--seleccionada' : ''}"
                        onclick="VFJugar.responder(true)"
                        aria-pressed="${respuestaActual === true}">
                    <span class="vfj-btn__icon">✓</span>
                    <span class="vfj-btn__label">Verdadero</span>
                </button>
                <button class="vfj-btn vfj-btn--falso ${respuestaActual === false ? 'vfj-btn--seleccionada' : ''}"
                        onclick="VFJugar.responder(false)"
                        aria-pressed="${respuestaActual === false}">
                    <span class="vfj-btn__icon">✗</span>
                    <span class="vfj-btn__label">Falso</span>
                </button>
            </div>
        `;
        _updateProgress();
        _updateFooter();
    }

    function iniciar(juego) {
        if (!juego || juego.tipo !== "vf" || !Array.isArray(juego.afirmaciones) || juego.afirmaciones.length === 0) {
            if (typeof showToast === "function") showToast("V/F inválido", "danger");
            return;
        }
        _state = {
            juego,
            idx: 0,
            respuestas: new Array(juego.afirmaciones.length).fill(null),
            startedAt: Date.now(),
            tiempoSegundos: 0
        };
        const mat = _findMateria(juego.materiaId);
        const eyebrow = document.getElementById("vfj-eyebrow");
        if (eyebrow) eyebrow.textContent = "📚 " + (mat ? mat.nombre : "") + " · V/F";
        const titulo = document.getElementById("vfj-titulo");
        if (titulo) titulo.textContent = juego.nombre;
        _renderAfirmacion();
        if (typeof openModal === "function") openModal("modal-jugar-vf");
        _timerInterval = setInterval(_updateTimer, 1000);
    }

    function responder(esVerdadera) {
        if (!_state) return;
        _state.respuestas[_state.idx] = esVerdadera;
        _renderAfirmacion();
        _updateFooter();
    }

    function siguiente() {
        if (!_state) return;
        if (_state.idx < _state.juego.afirmaciones.length - 1) {
            _state.idx++;
            _renderAfirmacion();
        }
    }

    function anterior() {
        if (!_state) return;
        if (_state.idx > 0) {
            _state.idx--;
            _renderAfirmacion();
        }
    }

    function terminar() {
        if (!_state) return;
        clearInterval(_timerInterval);
        _timerInterval = null;
        const total = _state.juego.afirmaciones.length;
        let aciertos = 0;
        _state.juego.afirmaciones.forEach((a, i) => {
            if (_state.respuestas[i] === a.esVerdadera) aciertos++;
        });
        const xpGanado = aciertos * XP_POR_ACIERTO;
        const puntaje = Math.round((aciertos / total) * 100);
        const uid = (typeof APP !== "undefined" && APP.user) ? APP.user.id : "anon";

        // Persistir jugada
        if (typeof GamerState !== "undefined") {
            GamerState.addJugada(uid, {
                juegoId: _state.juego.id,
                fecha: new Date().toISOString(),
                puntaje,
                aciertos,
                totalPreguntas: total,
                xpGanado,
                tiempoSegundos: _state.tiempoSegundos,
                tipo: "vf"
            });
            GamerState.addXp(uid, xpGanado, { fuente: "vf", juegoId: _state.juego.id });
        }

        // Dispatch evento canonical
        try {
            document.dispatchEvent(new CustomEvent("xahni:juegoTerminado", {
                detail: {
                    uid,
                    juegoId: _state.juego.id,
                    tipo: "vf",
                    puntaje,
                    aciertos,
                    totalPreguntas: total,
                    tiempoSegundos: _state.tiempoSegundos
                }
            }));
        } catch (e) { /* defensive */ }

        // Pantalla resultados (reuso patrón quiz)
        _renderResultado({ aciertos, total, xpGanado, tiempoSegundos: _state.tiempoSegundos, puntaje });
    }

    function _renderResultado(r) {
        const body = document.getElementById("vfj-body");
        if (!body) return;
        const trofeo = r.puntaje === 100 ? "🏆" : (r.puntaje >= 60 ? "👍" : "🔁");
        const titulo = r.puntaje === 100 ? "¡Perfecto!" : (r.puntaje >= 60 ? "¡Bien hecho!" : "Sigue intentando");
        body.innerHTML = `
            <div class="vfj-result">
                <div class="vfj-result__trofeo">${trofeo}</div>
                <h3 class="vfj-result__titulo">${titulo}</h3>
                <div class="vfj-result__stats">
                    <div><span class="vfj-result__valor">${r.aciertos}/${r.total}</span><span>Aciertos</span></div>
                    <div><span class="vfj-result__valor">+${r.xpGanado}</span><span>XP ganados</span></div>
                    <div><span class="vfj-result__valor">${_fmtTime(r.tiempoSegundos)}</span><span>Tiempo</span></div>
                </div>
                <button class="x-btn x-btn--primary" onclick="VFJugar.cerrar()">Volver a Juegos</button>
            </div>
        `;
        // Ocultar footer botones nav (mantener cerrar arriba)
        const anteriorBtn = document.getElementById("vfj-anterior");
        const siguienteBtn = document.getElementById("vfj-siguiente");
        const terminarBtn = document.getElementById("vfj-terminar");
        if (anteriorBtn) anteriorBtn.style.display = "none";
        if (siguienteBtn) siguienteBtn.style.display = "none";
        if (terminarBtn) terminarBtn.style.display = "none";

        /* Slice review B · 2026-06-08 · botón "Ver respuestas correctas" */
        const resultEl = body.querySelector('.vfj-result');
        if (resultEl && !resultEl.querySelector('[data-rv-trigger]')) {
            const btn = document.createElement('button');
            btn.className = 'x-btn x-btn--ghost';
            btn.dataset.rvTrigger = '';
            btn.textContent = 'Ver respuestas correctas';
            btn.onclick = () => VFJugar.verRespuestas();
            const volverBtn = resultEl.querySelector('button.x-btn--primary');
            if (volverBtn) volverBtn.before(btn);
            else resultEl.appendChild(btn);
        }
    }

    /**
     * @interaction vf-ver-respuestas
     * @scope shared-vf-jugar-review
     *
     * Given V/F terminado, render result, alumno click "Ver respuestas".
     * When verRespuestas() lee _state.juego.afirmaciones + _state.respuestas y
     *   construye items[] con shape canónico para buildReviewScreen.
     * Then reemplaza #vfj-body con review. onClose restaura resultado.
     *
     * Slice review B · 2026-06-08
     */
    function verRespuestas() {
        const afirmaciones = _state.juego.afirmaciones || [];
        const items = afirmaciones.map((a, i) => ({
            tipo: 'vf',
            enunciado: a.texto,
            correcta: a.esVerdadera,
            tuRespuesta: _state.respuestas[i]
        }));
        const body = document.getElementById('vfj-body');
        const resultadoHTML = body ? body.innerHTML : '';
        if (body) {
            const handle = buildReviewScreen({
                items,
                container: body,
                onClose: () => {
                    handle.destroy();
                    body.innerHTML = resultadoHTML;
                    // Re-inyectar el botón "Ver respuestas" tras restaurar
                    const restoredResultEl = body.querySelector('.vfj-result');
                    if (restoredResultEl && !restoredResultEl.querySelector('[data-rv-trigger]')) {
                        const btn2 = document.createElement('button');
                        btn2.className = 'x-btn x-btn--ghost';
                        btn2.dataset.rvTrigger = '';
                        btn2.textContent = 'Ver respuestas correctas';
                        btn2.onclick = () => VFJugar.verRespuestas();
                        const volver2 = restoredResultEl.querySelector('button.x-btn--primary');
                        if (volver2) volver2.before(btn2);
                        else restoredResultEl.appendChild(btn2);
                    }
                },
                onExit: () => { handle.destroy(); cerrar(); }
            });
        }
    }

    function cerrar() {
        if (_timerInterval) {
            clearInterval(_timerInterval);
            _timerInterval = null;
        }
        if (typeof closeModal === "function") closeModal("modal-jugar-vf");
        _state = null;
        // Reset footer buttons display
        const anteriorBtn = document.getElementById("vfj-anterior");
        const siguienteBtn = document.getElementById("vfj-siguiente");
        const terminarBtn = document.getElementById("vfj-terminar");
        if (anteriorBtn) anteriorBtn.style.display = "";
        if (siguienteBtn) siguienteBtn.style.display = "";
        if (terminarBtn) terminarBtn.style.display = "";
        // Fix UX 2026-06-06: re-render panel canónico Juegos post-jugar para
        // refrescar stats hero (xpDirecta, jugados) + chip estado de la card.
        setTimeout(() => {
            try {
                if (typeof window.renderPanelJuegosActual === "function") {
                    window.renderPanelJuegosActual();
                }
                if (typeof APP !== "undefined" && APP.profHubMatActivo
                    && APP.profHubMatActivo.tab === "juegos"
                    && typeof window.renderPanelJuegosProfesor === "function") {
                    window.renderPanelJuegosProfesor(
                        APP.profHubMatActivo.matId,
                        window._juegosCurrentTema || "todos"
                    );
                }
            } catch (e) { /* defensive */ }
        }, 60);
    }

    return { iniciar, responder, siguiente, anterior, terminar, cerrar, verRespuestas };
})();
window.VFJugar = VFJugar;
