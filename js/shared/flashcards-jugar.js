// js/shared/flashcards-jugar.js
// Slice Juegos beta B2 · 2026-06-05 · spec §6.2
//
// IIFE FlashcardsJugar in-game. Flujo por tarjeta:
//   1. Anverso visible + textbox para respuesta.
//   2. Click "Voltear y comparar" → flip 3D animado, reverso visible.
//   3. StringCompare.calcSimilarity vs reverso → 3 niveles automáticos.
//   4. Override 1-nivel disponible si calAuto <= "mas_o_menos" y respuesta no vacía.
//   5. Click Siguiente / Terminar.
//
// Persistencia jugada: por-tarjeta con respuestaAlumno, similitud, calAuto,
// calFinal, overrideUsado. Agregados sabia/masOMenos/noSabia counts + overrideCount.

const FlashcardsJugar = (() => {
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
        const el = document.getElementById("fcj-timer");
        if (el) el.textContent = _fmtTime(seg);
        _state.tiempoSegundos = seg;
    }

    function _updateProgress() {
        const el = document.getElementById("fcj-progress");
        if (el && _state) el.textContent = `Tarjeta ${_state.idx + 1} de ${_state.juego.tarjetas.length}`;
    }

    function _updateFooter() {
        if (!_state) return;
        const idx = _state.idx;
        const total = _state.juego.tarjetas.length;
        const r = _state.resultados[idx];
        const respondida = !!(r && r.calFinal);
        const esPrimera = idx === 0;
        const esUltima = idx === total - 1;
        const anteriorBtn = document.getElementById("fcj-anterior");
        const siguienteBtn = document.getElementById("fcj-siguiente");
        const terminarBtn = document.getElementById("fcj-terminar");
        // Fix UX 2026-06-06: Anterior solo desde la 2da tarjeta.
        if (anteriorBtn) {
            anteriorBtn.style.display = esPrimera ? "none" : "";
        }
        if (siguienteBtn) {
            siguienteBtn.disabled = !respondida || esUltima;
            siguienteBtn.style.display = esUltima ? "none" : "";
        }
        if (terminarBtn) {
            const todasRespondidas = _state.resultados.every(rr => rr && rr.calFinal);
            terminarBtn.disabled = !todasRespondidas;
            terminarBtn.style.display = esUltima ? "" : "none";
        }
    }

    function _calNivelToEmoji(nivel) {
        if (nivel === "la_sabia") return "✅ Sí, la sabía";
        if (nivel === "mas_o_menos") return "🤔 Más o menos";
        return "😞 No la sabía";
    }

    function _renderAnverso() {
        if (!_state) return;
        const body = document.getElementById("fcj-body");
        if (!body) return;
        const tarjeta = _state.juego.tarjetas[_state.idx];
        const respuestaPrevia = (_state.resultados[_state.idx] && _state.resultados[_state.idx].respuestaAlumno) || "";
        body.innerHTML = `
            <div class="fcj-card-wrap">
                <div class="fcj-card fcj-card--anverso">
                    <div class="fcj-card__label">ANVERSO</div>
                    <div class="fcj-card__contenido">${(tarjeta.anverso || "").replace(/</g, "&lt;")}</div>
                </div>
                <div class="fcj-respuesta-wrap">
                    <label for="fcj-respuesta-input">Tu respuesta</label>
                    <input type="text" id="fcj-respuesta-input"
                           placeholder="Escribe tu respuesta…"
                           value="${respuestaPrevia.replace(/"/g, "&quot;")}"
                           autocomplete="off">
                </div>
                <button class="x-btn x-btn--primary fcj-voltear-btn" onclick="FlashcardsJugar.voltear()">Voltear y comparar →</button>
            </div>
        `;
        _updateProgress();
        _updateFooter();
        // Auto-focus input
        setTimeout(() => {
            const inp = document.getElementById("fcj-respuesta-input");
            if (inp) inp.focus();
        }, 50);
    }

    function _renderReverso(resultado) {
        if (!_state) return;
        const body = document.getElementById("fcj-body");
        if (!body) return;
        const tarjeta = _state.juego.tarjetas[_state.idx];
        const simPct = Math.round((resultado.similitud || 0) * 100);
        const simColor = simPct <= 59 ? "danger" : (simPct <= 90 ? "warn" : "ok");
        const calLabel = _calNivelToEmoji(resultado.calFinal);
        const calPts = (typeof StringCompare !== "undefined") ? StringCompare.nivelPuntos(resultado.calFinal) : 0;
        const respuestaVacia = !resultado.respuestaAlumno;
        const puedeOverride = !respuestaVacia && (resultado.calAuto === "no_la_sabia" || resultado.calAuto === "mas_o_menos") && !resultado.overrideUsado;
        body.innerHTML = `
            <div class="fcj-card-wrap fcj-card-wrap--flipped">
                <div class="fcj-card fcj-card--reverso">
                    <div class="fcj-card__label">REVERSO</div>
                    <div class="fcj-card__contenido">${(tarjeta.reverso || "").replace(/</g, "&lt;")}</div>
                </div>
                <div class="fcj-resultado">
                    <div class="fcj-resultado__row">
                        <div class="fcj-resultado__col">
                            <span class="fcj-resultado__label">Tu respuesta</span>
                            <span class="fcj-resultado__valor">${(resultado.respuestaAlumno || "(vacía)").replace(/</g, "&lt;")}</span>
                        </div>
                        <div class="fcj-resultado__col">
                            <span class="fcj-resultado__label">Reverso</span>
                            <span class="fcj-resultado__valor">${(tarjeta.reverso || "").replace(/</g, "&lt;")}</span>
                        </div>
                    </div>
                    <div class="fcj-resultado__sim">
                        Similitud: <span class="x-chip x-chip--${simColor}">${simPct}%</span>
                    </div>
                    <div class="fcj-resultado__cal">${calLabel} <span class="fcj-resultado__pts">(${calPts > 0 ? "+" : ""}${calPts} pts)</span></div>
                    ${puedeOverride ? `
                        <button class="x-btn x-btn--ghost fcj-override-btn" onclick="FlashcardsJugar.override()">
                            ⚠ Mi respuesta es equivalente · subir nivel
                        </button>
                    ` : ""}
                </div>
            </div>
        `;
        _updateProgress();
        _updateFooter();
    }

    function _renderActual() {
        if (!_state) return;
        const r = _state.resultados[_state.idx];
        if (r && r.calFinal) {
            _renderReverso(r);
        } else {
            _renderAnverso();
        }
    }

    function iniciar(juego) {
        if (!juego || juego.tipo !== "flashcards" || !Array.isArray(juego.tarjetas) || juego.tarjetas.length === 0) {
            if (typeof showToast === "function") showToast("Flashcards inválidas", "danger");
            return;
        }
        _state = {
            juego,
            idx: 0,
            resultados: new Array(juego.tarjetas.length).fill(null),
            startedAt: Date.now(),
            tiempoSegundos: 0
        };
        const mat = _findMateria(juego.materiaId);
        const eyebrow = document.getElementById("fcj-eyebrow");
        if (eyebrow) eyebrow.textContent = "📚 " + (mat ? mat.nombre : "") + " · Flashcards";
        const titulo = document.getElementById("fcj-titulo");
        if (titulo) titulo.textContent = juego.nombre;
        _renderAnverso();
        if (typeof openModal === "function") openModal("modal-jugar-flashcards");
        _timerInterval = setInterval(_updateTimer, 1000);
    }

    function voltear() {
        if (!_state) return;
        const tarjeta = _state.juego.tarjetas[_state.idx];
        const input = document.getElementById("fcj-respuesta-input");
        const respuestaAlumno = input ? input.value.trim() : "";
        let similitud = 0;
        let calAuto = "no_la_sabia";
        if (typeof StringCompare !== "undefined") {
            similitud = StringCompare.calcSimilarity(respuestaAlumno, tarjeta.reverso || "");
            calAuto = StringCompare.similarityToNivel(similitud);
        }
        // Respuesta vacía SIEMPRE no_la_sabia, sin posibilidad de override
        if (!respuestaAlumno) {
            calAuto = "no_la_sabia";
            similitud = 0;
        }
        const resultado = {
            id: tarjeta.id,
            respuestaAlumno,
            similitud,
            calAuto,
            calFinal: calAuto,
            overrideUsado: false
        };
        _state.resultados[_state.idx] = resultado;
        _renderReverso(resultado);
    }

    function override() {
        if (!_state) return;
        const r = _state.resultados[_state.idx];
        if (!r || r.overrideUsado || !r.respuestaAlumno) return;
        if (r.calAuto === "no_la_sabia") r.calFinal = "mas_o_menos";
        else if (r.calAuto === "mas_o_menos") r.calFinal = "la_sabia";
        r.overrideUsado = true;
        _renderReverso(r);
    }

    function siguiente() {
        if (!_state) return;
        if (_state.idx < _state.juego.tarjetas.length - 1) {
            _state.idx++;
            _renderActual();
        }
    }

    function anterior() {
        if (!_state) return;
        if (_state.idx > 0) {
            _state.idx--;
            _renderActual();
        }
    }

    function terminar() {
        if (!_state) return;
        clearInterval(_timerInterval);
        _timerInterval = null;
        const total = _state.juego.tarjetas.length;
        let sabiaCount = 0, masOMenosCount = 0, noSabiaCount = 0, overrideCount = 0, xpGanado = 0;
        const tarjetasResultado = _state.resultados.map(r => {
            if (!r) return { calFinal: "no_la_sabia", overrideUsado: false };
            if (r.calFinal === "la_sabia") sabiaCount++;
            else if (r.calFinal === "mas_o_menos") masOMenosCount++;
            else noSabiaCount++;
            if (r.overrideUsado) overrideCount++;
            if (typeof StringCompare !== "undefined") {
                xpGanado += StringCompare.nivelPuntos(r.calFinal);
            }
            return r;
        });
        // puntaje 0-100 derivado de calFinal (la_sabia=10, mas_o_menos=5, no_la_sabia=0)
        const puntajeMax = total * 10;
        const puntaje = puntajeMax > 0 ? Math.round((xpGanado / puntajeMax) * 100) : 0;
        const uid = (typeof APP !== "undefined" && APP.user) ? APP.user.id : "anon";

        if (typeof GamerState !== "undefined") {
            GamerState.addJugada(uid, {
                juegoId: _state.juego.id,
                fecha: new Date().toISOString(),
                puntaje,
                aciertos: sabiaCount,
                totalPreguntas: total,
                xpGanado,
                tiempoSegundos: _state.tiempoSegundos,
                tipo: "flashcards",
                tarjetas: tarjetasResultado,
                sabiaCount,
                masOMenosCount,
                noSabiaCount,
                overrideCount
            });
            GamerState.addXp(uid, xpGanado, { fuente: "flashcards", juegoId: _state.juego.id });
        }

        try {
            document.dispatchEvent(new CustomEvent("xahni:juegoTerminado", {
                detail: {
                    uid,
                    juegoId: _state.juego.id,
                    tipo: "flashcards",
                    puntaje,
                    aciertos: sabiaCount,
                    totalPreguntas: total,
                    tiempoSegundos: _state.tiempoSegundos
                }
            }));
        } catch (e) { /* defensive */ }

        if (overrideCount > total * 0.3) {
            try {
                document.dispatchEvent(new CustomEvent("xahni:flashcardsOverrideExcessive", {
                    detail: { uid, juegoId: _state.juego.id, overrideCount, total }
                }));
            } catch (e) { /* defensive */ }
        }

        _renderResultado({ sabiaCount, masOMenosCount, noSabiaCount, overrideCount, xpGanado, total, puntaje, tiempoSegundos: _state.tiempoSegundos });
    }

    function _renderResultado(r) {
        const body = document.getElementById("fcj-body");
        if (!body) return;
        const trofeo = r.puntaje === 100 ? "🏆" : (r.puntaje >= 60 ? "👍" : "🔁");
        const titulo = r.puntaje === 100 ? "¡Perfecto!" : (r.puntaje >= 60 ? "¡Bien hecho!" : "Sigue intentando");
        body.innerHTML = `
            <div class="fcj-result">
                <div class="fcj-result__trofeo">${trofeo}</div>
                <h3 class="fcj-result__titulo">${titulo}</h3>
                <div class="fcj-result__stats">
                    <div><span class="fcj-result__valor">${r.sabiaCount}/${r.total}</span><span>Las sabía</span></div>
                    <div><span class="fcj-result__valor">+${r.xpGanado}</span><span>XP ganados</span></div>
                    <div><span class="fcj-result__valor">${_fmtTime(r.tiempoSegundos)}</span><span>Tiempo</span></div>
                </div>
                ${r.overrideCount > 0 ? `<div class="fcj-result__override">Overrides usados: ${r.overrideCount}</div>` : ""}
                <button class="x-btn x-btn--primary" onclick="FlashcardsJugar.cerrar()">Volver a Juegos</button>
            </div>
        `;
        const anteriorBtn = document.getElementById("fcj-anterior");
        const siguienteBtn = document.getElementById("fcj-siguiente");
        const terminarBtn = document.getElementById("fcj-terminar");
        if (anteriorBtn) anteriorBtn.style.display = "none";
        if (siguienteBtn) siguienteBtn.style.display = "none";
        if (terminarBtn) terminarBtn.style.display = "none";

        /* Slice review B · 2026-06-08 · botón "Ver respuestas correctas" */
        const resultEl = body.querySelector('.fcj-result');
        if (resultEl && !resultEl.querySelector('[data-rv-trigger]')) {
            const btn = document.createElement('button');
            btn.className = 'x-btn x-btn--ghost';
            btn.dataset.rvTrigger = '';
            btn.textContent = 'Ver respuestas correctas';
            btn.onclick = () => FlashcardsJugar.verRespuestas();
            const volverBtn = resultEl.querySelector('button.x-btn--primary');
            if (volverBtn) volverBtn.before(btn);
            else resultEl.appendChild(btn);
        }
    }

    /**
     * @interaction flashcards-ver-respuestas
     * @scope shared-flashcards-jugar-review
     *
     * Given flashcards terminado, render result, alumno click "Ver respuestas".
     * When verRespuestas() lee _state.juego.tarjetas + _state.resultados y
     *   construye items[] con shape canónico para buildReviewScreen.
     * Then reemplaza #fcj-body con review. onClose restaura resultado.
     *
     * Slice review B · 2026-06-08
     */
    function verRespuestas() {
        const tarjetas = _state.juego.tarjetas || [];
        const items = tarjetas.map((t, i) => {
            const r = _state.resultados[i] || {};
            return {
                tipo: 'flashcards',
                /* JSON: tarjeta usa `anverso` (no `frente`). */
                enunciado: t.anverso,
                correcta: t.reverso,
                tuRespuesta: r.respuestaAlumno || '',
                similitud: r.similitud || 0
            };
        });
        // Capturar HTML del resultado antes de destruirlo
        const body = document.getElementById('fcj-body');
        const resultadoHTML = body ? body.innerHTML : '';
        if (body) {
            const handle = buildReviewScreen({
                items,
                container: body,
                onClose: () => {
                    handle.destroy();
                    body.innerHTML = resultadoHTML;
                    // Re-inyectar el botón "Ver respuestas" tras restaurar
                    const restoredResultEl = body.querySelector('.fcj-result');
                    if (restoredResultEl && !restoredResultEl.querySelector('[data-rv-trigger]')) {
                        const btn2 = document.createElement('button');
                        btn2.className = 'x-btn x-btn--ghost';
                        btn2.dataset.rvTrigger = '';
                        btn2.textContent = 'Ver respuestas correctas';
                        btn2.onclick = () => FlashcardsJugar.verRespuestas();
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
        if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
        if (typeof closeModal === "function") closeModal("modal-jugar-flashcards");
        _state = null;
        const anteriorBtn = document.getElementById("fcj-anterior");
        const siguienteBtn = document.getElementById("fcj-siguiente");
        const terminarBtn = document.getElementById("fcj-terminar");
        if (anteriorBtn) anteriorBtn.style.display = "";
        if (siguienteBtn) siguienteBtn.style.display = "";
        if (terminarBtn) terminarBtn.style.display = "";
        // Fix UX 2026-06-06: re-render panel canónico post-jugar.
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

    return { iniciar, voltear, override, siguiente, anterior, terminar, cerrar, verRespuestas };
})();
window.FlashcardsJugar = FlashcardsJugar;
