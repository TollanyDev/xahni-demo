// js/shared/quiz-jugar.js
// Sprint entrega 2026-06-08 · Slice juegos-quiz-mvp
//
// Vista "jugar quiz" — modal canónico full-panel (#modal-jugar-quiz).
// Único tipo soportado en este sprint: tipo "quiz" (multiple choice 1
// correcta por pregunta). vf y flashcards quedan fuera (decisión D7).
//
// Eventos despachados:
//   - xahni:quizCompletado { uid, juegoId, puntaje, aciertos, totalPreguntas,
//     xpGanado, tiempoSegundos }
//   - GamerState.addXp dispara `xahni:gamerUpdated` (toast XP/level-up lo
//     consume desde otro módulo).

// ══════════════════════════════════════════════════════════════════════
// SELECTIVOS A · Persistencia juegos user-created (profesor crea quiz)
// ══════════════════════════════════════════════════════════════════════
//
// Key namespace `xahni:juegos:userCreated` (array de entries con shape
// idéntico a juegos.json + campo `creadoEn`). Wizard CrearQuiz escribe;
// buildHubMatPanelQuizzes y QuizJugar.iniciar leen vía getJuegosMerged.

const USER_JUEGOS_KEY = "xahni:juegos:userCreated";

function getUserJuegos() {
    try {
        const raw = localStorage.getItem(USER_JUEGOS_KEY);
        if (!raw) return [];
        return JSON.parse(raw) || [];
    } catch (e) {
        console.warn("[UserJuegos] parse fail", e);
        return [];
    }
}

function setUserJuegos(arr) {
    try { localStorage.setItem(USER_JUEGOS_KEY, JSON.stringify(arr)); }
    catch (e) { console.warn("[UserJuegos] write fail", e); }
}

function addUserJuego(juego) {
    if (!juego || !juego.id) return;
    const arr = getUserJuegos();
    arr.push(juego);
    setUserJuegos(arr);
    // Sweep 2026-06-08: la persistencia a Firestore vive en
    // firestore-sync.js como listener de xahni:juegoCreado. El caller
    // (crear-quiz/vf/flashcards) es quien dispatcha el evento — no se
    // dispara aquí para evitar double-dispatch cuando el caller ya lo hizo.
}

function removeUserJuego(id) {
    if (!id) return;
    setUserJuegos(getUserJuegos().filter(j => j.id !== id));
    // Sweep 2026-06-08: para borrados sí dispatchamos aquí porque ningún
    // caller actual emite xahni:juegoEliminado (a diferencia del create).
    try {
        document.dispatchEvent(new CustomEvent("xahni:juegoEliminado", {
            detail: { juegoId: id }
        }));
    } catch (_) { /* defensive */ }
}

/**
 * @interaction get-juegos-merged
 * @scope shared-quiz-jugar-persist-merge
 *
 * Given (no params).
 * When un caller necesita el catálogo total (seed + user-created).
 * Then async fetch DEMO_JUEGOS via DataService.getJuegos + concat
 *   getUserJuegos(). Retorna array unificado.
 * Edge:
 *   - DataService ausente → solo user-created.
 *   - DataService throw → solo user-created.
 *   - Función IMPURA (lee storage + fetch async).
 */
async function getJuegosMerged() {
    let base = [];
    if (typeof DataService !== "undefined" && typeof DataService.getJuegos === "function") {
        try { base = (await DataService.getJuegos()) || []; }
        catch (e) { console.warn("[getJuegosMerged] base fetch fail", e); }
    }
    // Sprint Examenes: concat examenes.json (tipo='examen').
    // En mode=prod los examenes hidratan via Firestore listener (firestore-sync),
    // saltamos el fetch local que 404 (data/demo/ no se publica).
    let examenes = [];
    if (typeof APP_CONFIG !== "undefined" && APP_CONFIG.mode === "demo") {
        try {
            const r = await fetch("data/demo/examenes.json", { cache: "no-store" });
            if (r.ok) examenes = await r.json();
        } catch (e) { /* defensive */ }
    }
    return base.concat(getUserJuegos()).concat(examenes || []);
}

window.getUserJuegos = getUserJuegos;
window.addUserJuego = addUserJuego;
window.removeUserJuego = removeUserJuego;
window.getJuegosMerged = getJuegosMerged;

const QuizJugar = (() => {
    // State runtime de la sesión activa (null cuando modal cerrado).
    let _state = null;
    let _timerInterval = null;

    const XP_POR_ACIERTO = 20;

    /**
     * @interaction quiz-jugar-iniciar
     * @scope shared-quiz-jugar-entry
     *
     * Given juegoId (string id de entry en data/demo/juegos.json).
     * When alumno hace click en una card "Disponible para jugar" en el tab
     *   Juegos del hub-materia.
     * Then:
     *   1. Fetch juego via DataService.getJuegos() + filtra por id + valida
     *      tipo === "quiz".
     *   2. Hidrata _state con { juego, preguntaIdx=0, respuestas[], startTs }.
     *   3. Abre modal canónico vía openModal.
     *   4. Renderiza pregunta 0.
     *   5. Arranca timer global (mm:ss).
     * Edge:
     *   - juegoId no encontrado → console.warn + no-op.
     *   - juego.tipo !== "quiz" → console.warn + no-op.
     *   - openModal asume #modal-jugar-quiz existe en index.html.
     */
    async function iniciar(juegoId) {
        if (!juegoId) return;
        // SELECTIVOS A: merge seed + user-created (profesor wizard).
        const juegos = (typeof getJuegosMerged === "function")
            ? await getJuegosMerged()
            : ((typeof DataService !== "undefined" && DataService.getJuegos)
                ? await DataService.getJuegos() : []);
        const juego = (juegos || []).find(j => j.id === juegoId);
        if (!juego) {
            console.warn("[QuizJugar] juego no encontrado:", juegoId);
            return;
        }
        // Sprint Examenes: ahora soporta tipo 'quiz' Y 'examen' (con 3 sub-tipos
        // por pregunta: multi/abierta/match).
        if (juego.tipo !== "quiz" && juego.tipo !== "examen") {
            console.warn("[QuizJugar] tipo no soportado en sprint:", juego.tipo);
            return;
        }
        if (!Array.isArray(juego.preguntas) || !juego.preguntas.length) {
            console.warn("[QuizJugar] juego sin preguntas:", juegoId);
            return;
        }

        // Hidrata materia text via DataService si está disponible.
        let materiaNombre = juego.materiaId || "";
        try {
            const materias = await DataService.getMaterias();
            const m = (materias || []).find(x => x.id === juego.materiaId);
            if (m) materiaNombre = m.nombre;
        } catch (e) { /* defensive */ }

        _state = {
            juego,
            materiaNombre,
            preguntaIdx: 0,
            respuestas: new Array(juego.preguntas.length).fill(null),
            startTs: Date.now()
        };

        const matEl = document.getElementById("jq-materia");
        const titEl = document.getElementById("jq-titulo");
        if (matEl) matEl.textContent = materiaNombre;
        if (titEl) titEl.textContent = juego.nombre || "Quiz";

        // Reset UI a estado pregunta (oculta resultados si veníamos de jugada
        // previa sin cerrar).
        const resultEl = document.getElementById("jq-result");
        const bodyEl = document.getElementById("jq-body");
        const footerEl = document.getElementById("jq-footer");
        const progressEl = document.querySelector(".jq-progress");
        if (resultEl) resultEl.hidden = true;
        if (bodyEl) bodyEl.hidden = false;
        if (footerEl) footerEl.hidden = false;
        if (progressEl) progressEl.hidden = false;

        _renderPregunta(0);
        _startTimer();

        if (typeof openModal === "function") openModal("modal-jugar-quiz");
    }

    /**
     * @interaction quiz-jugar-render-pregunta
     * @scope shared-quiz-jugar-render
     *
     * Given idx (int 0..N-1) del array preguntas.
     * When `iniciar` o `avanzar/retroceder` navegan.
     * Then:
     *   1. Actualiza progress bar + texto "Pregunta X de N".
     *   2. Render pregunta texto + opciones (radio-style buttons).
     *   3. Marca opción ya seleccionada (si respuesta previa existe).
     *   4. Actualiza estado botones footer (prev/next/finish).
     * Edge:
     *   - DOM target ausente → no-op silencioso (sprint asume markup existe).
     *   - Helper LOCAL IIFE.
     */
    function _renderPregunta(idx) {
        if (!_state) return;
        const total = _state.juego.preguntas.length;
        const preg = _state.juego.preguntas[idx];
        if (!preg) return;

        // Progress bar
        const barEl = document.getElementById("jq-progress-bar");
        const txtEl = document.getElementById("jq-progress-text");
        if (barEl) barEl.style.width = `${Math.round(((idx + 1) / total) * 100)}%`;
        if (txtEl) txtEl.textContent = `Pregunta ${idx + 1} de ${total}`;

        // Body con pregunta + render por tipo (Sprint Examenes).
        const bodyEl = document.getElementById("jq-body");
        if (!bodyEl) { _updateFooter(); return; }

        const respPrev = _state.respuestas[idx];
        const tipoPreg = preg.tipo || (preg.opciones ? "multi" : "abierta");
        let respuestaHtml = "";

        if (tipoPreg === "multi" || tipoPreg === "quiz") {
            // Radio-style buttons. respPrev es number (opcionIdx) o null.
            const opcionesHtml = (preg.opciones || []).map((opt, i) => `
                <button type="button"
                        class="jq-opcion${respPrev === i ? " jq-opcion--selected" : ""}"
                        onclick="quizSeleccionar(${i})"
                        aria-pressed="${respPrev === i}">
                    <span class="jq-opcion__letra">${String.fromCharCode(65 + i)}</span>
                    <span class="jq-opcion__texto">${_esc(opt)}</span>
                </button>
            `).join("");
            respuestaHtml = `<div class="jq-opciones" role="radiogroup" aria-label="Opciones de respuesta">${opcionesHtml}</div>`;
        } else if (tipoPreg === "abierta") {
            // Textarea libre. respPrev es string o null.
            const textoPrev = (typeof respPrev === "string") ? respPrev : "";
            respuestaHtml = `
                <div class="jq-abierta">
                    <textarea class="jq-abierta__input"
                              placeholder="Escribe tu respuesta aquí…"
                              rows="6"
                              oninput="quizSetTexto(this.value)"
                              aria-label="Respuesta abierta">${_esc(textoPrev)}</textarea>
                    <div class="jq-abierta__hint">Tu respuesta se considera entregada si no está vacía. La revisión cualitativa la hace tu profesor.</div>
                </div>`;
        } else if (tipoPreg === "match") {
            // Match dropdowns. respPrev es object { aIdx: bIdx, ... } o null.
            const pares = preg.pares || [];
            const seleccion = (respPrev && typeof respPrev === "object") ? respPrev : {};
            // Lista de "B" disponibles (todos los b strings).
            const bOpts = pares.map(p => p.b);
            const rows = pares.map((par, aIdx) => {
                const seleccionada = (typeof seleccion[aIdx] === "number") ? seleccion[aIdx] : -1;
                const opts = bOpts.map((b, bIdx) => `
                    <option value="${bIdx}" ${seleccionada === bIdx ? "selected" : ""}>${_esc(b)}</option>
                `).join("");
                return `
                    <div class="jq-match-row">
                        <div class="jq-match-row__a">${_esc(par.a)}</div>
                        <div class="jq-match-row__arrow" aria-hidden="true">→</div>
                        <select class="jq-match-row__select"
                                onchange="quizSetMatch(${aIdx}, this.value === '' ? -1 : parseInt(this.value, 10))"
                                aria-label="Empareja ${_esc(par.a)} con su par">
                            <option value="" ${seleccionada < 0 ? "selected" : ""}>— Elige —</option>
                            ${opts}
                        </select>
                    </div>`;
            }).join("");
            respuestaHtml = `<div class="jq-match" role="group" aria-label="Pares a emparejar">${rows}</div>`;
        }

        bodyEl.innerHTML = `
            <div class="jq-pregunta">
                <div class="jq-pregunta__num">Pregunta ${idx + 1}${tipoPreg === "abierta" ? " · Respuesta abierta" : tipoPreg === "match" ? " · Emparejamiento" : ""}</div>
                <div class="jq-pregunta__texto">${_esc(preg.texto || "")}</div>
            </div>
            ${respuestaHtml}
        `;

        _updateFooter();
    }

    function _updateFooter() {
        if (!_state) return;
        const idx = _state.preguntaIdx;
        const total = _state.juego.preguntas.length;
        const preg = _state.juego.preguntas[idx] || {};
        const respPrev = _state.respuestas[idx];
        const tipoPreg = preg.tipo || "multi";
        let respondida = false;
        if (tipoPreg === "multi" || tipoPreg === "quiz") {
            respondida = typeof respPrev === "number";
        } else if (tipoPreg === "abierta") {
            respondida = typeof respPrev === "string" && respPrev.trim().length > 0;
        } else if (tipoPreg === "match") {
            const pares = preg.pares || [];
            respondida = respPrev && typeof respPrev === "object"
                && pares.every((_, aIdx) => typeof respPrev[aIdx] === "number");
        }
        const esUltima = idx === total - 1;

        const prevBtn = document.getElementById("jq-prev");
        const nextBtn = document.getElementById("jq-next");
        const finishBtn = document.getElementById("jq-finish");

        if (prevBtn) prevBtn.hidden = idx === 0;
        if (nextBtn) {
            nextBtn.hidden = esUltima;
            nextBtn.disabled = !respondida;
        }
        if (finishBtn) {
            finishBtn.hidden = !esUltima;
            finishBtn.disabled = !respondida;
        }
    }

    /**
     * @interaction quiz-jugar-seleccionar
     * @scope shared-quiz-jugar-input
     *
     * Given opcionIdx (int 0..3) de la pregunta activa.
     * When alumno hace click en una `.jq-opcion`.
     * Then guarda respuesta en _state.respuestas[preguntaIdx], re-render
     *   pregunta para reflejar selección visual + habilita botón siguiente/
     *   terminar.
     * Edge:
     *   - Permite cambiar selección (no commit hasta avanzar).
     *   - _state null → no-op (modal cerrado).
     */
    function seleccionar(opcionIdx) {
        if (!_state) return;
        _state.respuestas[_state.preguntaIdx] = opcionIdx;
        _renderPregunta(_state.preguntaIdx);
    }

    // Sprint Examenes: handlers para tipos abierta y match.
    function setTexto(texto) {
        if (!_state) return;
        _state.respuestas[_state.preguntaIdx] = String(texto || "");
        _updateFooter();
    }

    function setMatch(aIdx, bIdx) {
        if (!_state) return;
        const cur = _state.respuestas[_state.preguntaIdx];
        const obj = (cur && typeof cur === "object") ? Object.assign({}, cur) : {};
        if (bIdx === -1 || bIdx === null) {
            delete obj[aIdx];
        } else {
            obj[aIdx] = bIdx;
        }
        _state.respuestas[_state.preguntaIdx] = obj;
        _updateFooter();
    }

    /**
     * @interaction quiz-jugar-avanzar
     * @scope shared-quiz-jugar-nav
     *
     * Given _state activo + pregunta actual respondida.
     * When alumno hace click en "Siguiente →".
     * Then incrementa preguntaIdx y re-render. Si ya en última pregunta el
     *   botón "Siguiente" está oculto (se usa "Terminar quiz" en su lugar).
     */
    function avanzar() {
        if (!_state) return;
        const total = _state.juego.preguntas.length;
        if (_state.preguntaIdx >= total - 1) return;
        if (_state.respuestas[_state.preguntaIdx] === null) return;
        _state.preguntaIdx++;
        _renderPregunta(_state.preguntaIdx);
    }

    function retroceder() {
        if (!_state) return;
        if (_state.preguntaIdx <= 0) return;
        _state.preguntaIdx--;
        _renderPregunta(_state.preguntaIdx);
    }

    /**
     * @interaction quiz-jugar-terminar
     * @scope shared-quiz-jugar-complete
     *
     * Given _state con todas las respuestas (último botón).
     * When alumno hace click en "Terminar quiz".
     * Then:
     *   1. Calcula aciertos comparando respuestas vs preguntas[i].correcta.
     *   2. xpGanado = aciertos × 20.
     *   3. tiempoSegundos = (Date.now() - startTs) / 1000.
     *   4. Detiene timer.
     *   5. Persiste jugada via GamerState.addJugada.
     *   6. Otorga XP via GamerState.addXp (dispara xahni:gamerUpdated con
     *      levelUp flag).
     *   7. Dispatch CustomEvent xahni:quizCompletado (para insignias slice
     *      día 3 + ranking competencia slice día 4).
     *   8. Renderiza pantalla resultados.
     * Edge:
     *   - uid resuelto vía APP.user.id. Si null → no persiste, solo muestra
     *     resultado en pantalla (modo invitado defensive).
     *   - levelUp desde detail de addXp → muestra banner "¡Subiste a nivel N!"
     */
    function terminar() {
        if (!_state) return;
        const juego = _state.juego;
        const totalPreguntas = juego.preguntas.length;
        let aciertos = 0;
        // Sprint Examenes: scoring por tipo de pregunta.
        juego.preguntas.forEach((p, i) => {
            const tipoPreg = p.tipo || "multi";
            const resp = _state.respuestas[i];
            if (tipoPreg === "multi" || tipoPreg === "quiz") {
                if (resp === p.correcta) aciertos++;
            } else if (tipoPreg === "abierta") {
                // Sprint demo: respuesta no-vacía cuenta como acierto.
                // La revisión cualitativa la haría el profesor manualmente
                // en una iteración futura.
                if (typeof resp === "string" && resp.trim().length > 0) aciertos++;
            } else if (tipoPreg === "match") {
                // Match correcto si todos los pares apuntan al mismo índice
                // (el JSON asume pares[i].b corresponde a pares[i].a).
                const pares = p.pares || [];
                if (resp && typeof resp === "object") {
                    const todasCorrectas = pares.every((_, aIdx) => resp[aIdx] === aIdx);
                    if (todasCorrectas) aciertos++;
                }
            }
        });
        // XP_POR_ACIERTO base, pero examenes overridean con juego.xpPorAcierto.
        const xpUnitario = (juego.tipo === "examen" && Number(juego.xpPorAcierto))
            ? Number(juego.xpPorAcierto)
            : XP_POR_ACIERTO;
        const xpGanado = aciertos * xpUnitario;
        const puntaje = Math.round((aciertos / totalPreguntas) * 100);
        const tiempoSegundos = Math.round((Date.now() - _state.startTs) / 1000);
        const uid = (typeof APP !== "undefined" && APP.user) ? APP.user.id : null;

        _stopTimer();

        const jugada = {
            juegoId: juego.id,
            fecha: new Date().toISOString(),
            puntaje,
            aciertos,
            totalPreguntas,
            xpGanado,
            tiempoSegundos
        };

        let addXpResult = null;
        if (uid) {
            try {
                if (typeof GamerState !== "undefined") {
                    GamerState.addJugada(uid, jugada);
                    if (xpGanado > 0) {
                        addXpResult = GamerState.addXp(uid, xpGanado, { source: "quiz", juegoId: juego.id });
                    }
                }
            } catch (e) {
                console.warn("[QuizJugar] persist fail", e);
            }
        }

        // Mastery por quiz (Sweep 2026-06-08 follow-up): los quizzes tipo
        // 'quiz' suman mastery proporcional al puntaje en la materia. Los
        // examenes tienen su propio path en examenes-data.aplicarMastery,
        // por eso filtramos solo tipo === 'quiz' para evitar doble cobranza.
        // Formula: aciertos × 10 (mastery = mitad del XP, consistente con
        // XP_POR_ACIERTO=20). No idempotente: cada jugada con aciertos > 0
        // suma mastery (refleja practica repetida).
        if (uid && juego.tipo === "quiz" && juego.materiaId && aciertos > 0) {
            try {
                const masteryGanado = aciertos * 10;
                if (typeof window.DEMO_MAESTRIA === "undefined") {
                    window.DEMO_MAESTRIA = {};
                }
                if (!DEMO_MAESTRIA[uid]) DEMO_MAESTRIA[uid] = {};
                if (!DEMO_MAESTRIA[uid][juego.materiaId]) {
                    DEMO_MAESTRIA[uid][juego.materiaId] = {
                        points: 0,
                        nivel: 1,
                        tokensGanados: [],
                        cosmeticsDesbloqueados: [],
                        tokensTimeline: []
                    };
                }
                const entry = DEMO_MAESTRIA[uid][juego.materiaId];
                entry.points = (entry.points || 0) + masteryGanado;
                entry.tokensTimeline = entry.tokensTimeline || [];
                entry.tokensTimeline.unshift({
                    type: "quiz",
                    id: juego.id,
                    when: new Date().toISOString(),
                    label: `+${masteryGanado} mastery por "${juego.nombre || 'Quiz'}" (${aciertos}/${totalPreguntas})`
                });
                document.dispatchEvent(new CustomEvent("xahni:maestriaActualizada", {
                    detail: {
                        uid,
                        materiaId: juego.materiaId,
                        ganado: masteryGanado,
                        total: entry.points
                    }
                }));
            } catch (e) {
                console.warn("[QuizJugar] mastery fail", e);
            }
        }

        try {
            document.dispatchEvent(new CustomEvent("xahni:quizCompletado", {
                detail: { uid, juegoId: juego.id, puntaje, aciertos, totalPreguntas, xpGanado, tiempoSegundos }
            }));
        } catch (e) { /* defensive */ }

        // Slice D2 Task 10: dispatch canonical xahni:juegoTerminado
        // (sucesor de xahni:quizCompletado; ambos coexisten durante migración
        // para backward-compat con listeners legacy).
        try {
            document.dispatchEvent(new CustomEvent("xahni:juegoTerminado", {
                detail: {
                    uid,
                    juegoId: juego.id,
                    tipo: "quiz",
                    puntaje,
                    aciertos,
                    totalPreguntas,
                    tiempoSegundos
                }
            }));
        } catch (e) { /* defensive */ }

        _renderResultado({ aciertos, totalPreguntas, xpGanado, tiempoSegundos, addXpResult });
    }

    function _renderResultado(r) {
        const bodyEl = document.getElementById("jq-body");
        const footerEl = document.getElementById("jq-footer");
        const progressEl = document.querySelector(".jq-progress");
        const resultEl = document.getElementById("jq-result");
        if (bodyEl) bodyEl.hidden = true;
        if (footerEl) footerEl.hidden = true;
        if (progressEl) progressEl.hidden = true;
        if (resultEl) resultEl.hidden = false;

        const emojiEl = document.getElementById("jq-result-emoji");
        const titleEl = document.getElementById("jq-result-title");
        const subEl = document.getElementById("jq-result-subtitle");
        const scoreEl = document.getElementById("jq-result-score");
        const xpEl = document.getElementById("jq-result-xp");
        const timeEl = document.getElementById("jq-result-time");
        const lupEl = document.getElementById("jq-result-levelup");
        const lupTextEl = document.getElementById("jq-result-levelup-text");

        const ratio = r.totalPreguntas > 0 ? r.aciertos / r.totalPreguntas : 0;
        let emoji, title, sub;
        if (ratio === 1) { emoji = "🏆"; title = "¡Perfecto!"; sub = "Todas las respuestas correctas."; }
        else if (ratio >= 0.7) { emoji = "🎯"; title = "¡Muy bien!"; sub = "Vas por buen camino."; }
        else if (ratio >= 0.4) { emoji = "🙂"; title = "Buen intento"; sub = "Sigue practicando para mejorar."; }
        else { emoji = "💪"; title = "Sigue intentando"; sub = "La práctica hace al maestro."; }

        if (emojiEl) emojiEl.textContent = emoji;
        if (titleEl) titleEl.textContent = title;
        if (subEl) subEl.textContent = sub;
        if (scoreEl) scoreEl.textContent = `${r.aciertos}/${r.totalPreguntas}`;
        if (xpEl) xpEl.textContent = `+${r.xpGanado}`;
        if (timeEl) timeEl.textContent = _fmtTime(r.tiempoSegundos);

        if (lupEl) {
            if (r.addXpResult && r.addXpResult.levelUp) {
                lupEl.hidden = false;
                if (lupTextEl) lupTextEl.textContent = `¡Subiste al nivel ${r.addXpResult.nivelNuevo}!`;
            } else {
                lupEl.hidden = true;
            }
        }

        /* Slice review B · 2026-06-08 · botón "Ver respuestas correctas" */
        if (resultEl && !resultEl.querySelector('[data-rv-trigger]')) {
            const btn = document.createElement('button');
            btn.className = 'x-btn x-btn--ghost';
            btn.dataset.rvTrigger = '';
            btn.textContent = 'Ver respuestas correctas';
            btn.onclick = () => QuizJugar.verRespuestas();
            /* Insertar antes del botón "Volver a Juegos" (primary) */
            const volverBtn = resultEl.querySelector('button.x-btn--primary');
            if (volverBtn) volverBtn.before(btn);
            else resultEl.appendChild(btn);
        }
    }

    /**
     * @interaction quiz-ver-respuestas
     * @scope shared-quiz-jugar-review
     *
     * Given quiz terminado, render result, alumno click "Ver respuestas".
     * When verRespuestas() lee _state.juego.preguntas + _state.respuestas y
     *   construye items[] con shape canónico para buildReviewScreen.
     * Then oculta #jq-result, muestra #jq-body con review. onClose vuelve.
     *
     * Slice review B · 2026-06-08
     */
    function verRespuestas() {
        const preguntas = _state.juego.preguntas || [];
        const items = preguntas.map((p, i) => {
            const respIdx = _state.respuestas[i];
            const tuTexto = (typeof respIdx === 'number' && p.opciones) ? p.opciones[respIdx] : null;
            /* JSON: pregunta usa `correcta` (no `opcionCorrecta`) — mismo
               campo que consulta el cálculo de aciertos en línea 410. */
            const correctaTexto = (typeof p.correcta === 'number' && p.opciones)
                ? p.opciones[p.correcta]
                : p.correcta;
            return {
                tipo: 'quiz',
                enunciado: p.enunciado,
                opciones: p.opciones,
                correcta: correctaTexto,
                tuRespuesta: tuTexto
            };
        });

        const resultEl = document.getElementById('jq-result');
        const bodyEl = document.getElementById('jq-body');
        if (resultEl) resultEl.hidden = true;
        if (bodyEl) bodyEl.hidden = false;

        const handle = buildReviewScreen({
            items,
            container: bodyEl,
            onClose: () => {
                handle.destroy();
                if (resultEl) resultEl.hidden = false;
                if (bodyEl) bodyEl.hidden = true;
            },
            onExit: () => {
                handle.destroy();
                cerrar();
            }
        });
    }

    /**
     * @interaction quiz-jugar-cerrar
     * @scope shared-quiz-jugar-close
     *
     * Given modal abierto (en pregunta o en resultado).
     * When alumno hace click en X header, backdrop, o "Volver a Juegos".
     * Then detiene timer, limpia _state, llama closeModal. Si quedaba sesión
     *   sin terminar, se descarta (NO persiste — alumno puede re-iniciar).
     */
    function cerrar() {
        _stopTimer();
        _state = null;
        if (typeof closeModal === "function") closeModal("modal-jugar-quiz");
        // Re-render del panel hub-materia tab Juegos para refrescar chips
        // "Nuevo" → "Ya jugado N" + stats actualizados.
        //
        // Fix UX 2026-06-06: el renderer canónico juegos-beta
        // (renderPanelJuegosActual del slice E2) DEBE preferirse sobre el
        // legacy hubMateriaRenderJuegos del sprint anterior. El legacy
        // sobreescribía el panel con una vista vieja (pre-trasplante
        // canónico).
        setTimeout(() => {
            try {
                // Alumno: renderer canónico tiene precedencia, fallback legacy.
                if (typeof window.renderPanelJuegosActual === "function") {
                    window.renderPanelJuegosActual();
                } else if (typeof window.hubMateriaRenderJuegos === "function") {
                    window.hubMateriaRenderJuegos();
                }
                // Profesor: idem precedencia canónico → legacy.
                if (typeof APP !== "undefined" && APP.profHubMatActivo
                    && APP.profHubMatActivo.tab === "juegos") {
                    if (typeof window.renderPanelJuegosProfesor === "function") {
                        window.renderPanelJuegosProfesor(
                            APP.profHubMatActivo.matId,
                            window._juegosCurrentTema || "todos"
                        );
                    } else if (typeof window.profHubMatRenderJuegos === "function") {
                        window.profHubMatRenderJuegos("prof-hub-mat-panel-juegos", APP.profHubMatActivo.matId);
                    }
                }
            } catch (e) { /* defensive */ }
        }, 60);
    }

    // Timer helpers (mm:ss display).
    function _startTimer() {
        _stopTimer();
        _updateTimerDisplay();
        _timerInterval = setInterval(_updateTimerDisplay, 1000);
    }
    function _stopTimer() {
        if (_timerInterval) {
            clearInterval(_timerInterval);
            _timerInterval = null;
        }
    }
    function _updateTimerDisplay() {
        if (!_state) return;
        const el = document.getElementById("jq-timer");
        if (!el) return;
        const seg = Math.floor((Date.now() - _state.startTs) / 1000);
        el.textContent = _fmtTime(seg);
    }
    function _fmtTime(segTotal) {
        const m = Math.floor(segTotal / 60);
        const s = segTotal % 60;
        return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }

    function _esc(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    return {
        iniciar,
        seleccionar,
        setTexto,
        setMatch,
        avanzar,
        retroceder,
        terminar,
        cerrar,
        verRespuestas,
        _XP_POR_ACIERTO: XP_POR_ACIERTO
    };
})();

// Wrappers globales para onclick inline en index.html y demás handlers.
function iniciarQuiz(juegoId) { QuizJugar.iniciar(juegoId); }
function cerrarQuiz() { QuizJugar.cerrar(); }
function quizSeleccionar(opcionIdx) { QuizJugar.seleccionar(opcionIdx); }
function quizSetTexto(v) { QuizJugar.setTexto(v); }
function quizSetMatch(aIdx, bIdx) { QuizJugar.setMatch(aIdx, bIdx); }
function quizSiguiente() { QuizJugar.avanzar(); }
function quizAnterior() { QuizJugar.retroceder(); }
function quizTerminar() { QuizJugar.terminar(); }
// Alias para Examenes (semántico).
function iniciarExamen(examenId) { QuizJugar.iniciar(examenId); }

// ══════════════════════════════════════════════════════════════════════
// PANEL hub-materia tab Juegos — reemplaza chrome stub "post-Supabase"
// ══════════════════════════════════════════════════════════════════════

/**
 * @interaction build-hub-mat-quizzes
 * @scope shared-quiz-jugar-panel
 *
 * Given panelEl (DOM target del hub-tab-panel del tab Juegos) + materiaId
 *   activa + rol ('alumno'|'profesor').
 * When el dispatcher de hub-materia switch-tab activa el tab Juegos.
 * Then:
 *   1. Fetch juegos.json via DataService.getJuegos().
 *   2. Filter tipo='quiz' + materiaId match (decisión D7: tipos no-quiz
 *      OCULTAS).
 *   3. Para alumno: hidrata mejorJugada[juegoId] desde GamerState.
 *   4. Renderiza header + grid de cards.
 *   5. Click en card alumno → iniciarQuiz(juegoId). Profesor: read-only.
 * Edge:
 *   - DataService no disponible → renderiza empty state.
 *   - Sin quizzes para la materia → empty state "no hay juegos aún".
 *   - panelEl null o materiaId falsy → no-op silencioso.
 *   - innerHTML pisa el chrome stub "post-Supabase" del view-loader.
 */
async function buildHubMatPanelQuizzes(panelEl, materiaId, rol, opts) {
    if (!panelEl || !materiaId) return;
    const tipoFilter = (opts && opts.tipoFilter) || "quiz"; // 'quiz' o 'examen'
    const esExamen = tipoFilter === "examen";
    // SELECTIVOS A: usa merged (seed + user-created + examenes).
    let juegos = [];
    if (typeof getJuegosMerged === "function") {
        try { juegos = await getJuegosMerged(); }
        catch (e) { console.warn("[buildHubMatPanelQuizzes] merged fetch fail", e); }
    } else if (typeof DataService !== "undefined" && DataService.getJuegos) {
        try { juegos = (await DataService.getJuegos()) || []; }
        catch (e) { /* fallback */ }
    }

    const quizzes = (juegos || []).filter(j => j.tipo === tipoFilter && j.materiaId === materiaId);
    const userCreatedIds = new Set((typeof getUserJuegos === "function" ? getUserJuegos() : []).map(j => j.id));
    const uid = (typeof APP !== "undefined" && APP.user) ? APP.user.id : null;

    // Hidrata mejor jugada por juegoId para alumno.
    const mejorPorJuego = {};
    if (rol === "alumno" && typeof APP !== "undefined" && APP.user && typeof GamerState !== "undefined") {
        const state = GamerState.get(APP.user.id);
        (state.jugadas || []).forEach(j => {
            if (!j.juegoId) return;
            if (!mejorPorJuego[j.juegoId] || j.puntaje > mejorPorJuego[j.juegoId].puntaje) {
                mejorPorJuego[j.juegoId] = j;
            }
        });
    }

    const tipoLabel = esExamen ? "exámen" : "quiz";
    const tipoLabelPlural = esExamen ? "exámenes" : "quizzes";
    const titulo = esExamen
        ? (rol === "alumno" ? "Exámenes de la materia" : "Exámenes disponibles")
        : (rol === "alumno" ? "Juegos de la materia" : "Juegos disponibles");
    const subtitulo = esExamen
        ? (rol === "alumno"
            ? "Tu rendimiento académico — más XP por acierto que quizzes"
            : `${quizzes.length} ${quizzes.length === 1 ? tipoLabel : tipoLabelPlural} configurado${quizzes.length === 1 ? "" : "s"} para esta materia`)
        : (rol === "alumno"
            ? `Pon a prueba lo que sabes — gana XP por cada acierto`
            : `${quizzes.length} quiz${quizzes.length === 1 ? "" : "es"} configurado${quizzes.length === 1 ? "" : "s"} para esta materia`);

    // SELECTIVOS A: profesor recibe botón "+ Crear" en el header (solo quiz por sprint scope).
    const headerActions = (rol === "profesor" && !esExamen)
        ? `<div class="x-page-head__actions">
             <button class="x-btn x-btn--primary" type="button" onclick="crearQuizAbrir('${_jqEsc(materiaId)}')">＋ Crear quiz</button>
           </div>`
        : "";

    if (!quizzes.length) {
        panelEl.innerHTML = `
            <div class="x-page-head">
                <div>
                    <div class="x-page-head__title">${_jqEsc(titulo)}</div>
                    <div class="x-page-head__subtitle">${_jqEsc(subtitulo)}</div>
                </div>
                ${headerActions}
            </div>
            <div class="x-card" style="text-align:center;padding:42px 24px;color:var(--text-muted)">
                <div style="font-size:42px;margin-bottom:8px">🎮</div>
                <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:4px">No hay juegos disponibles aún</div>
                <div style="font-size:13px">${rol === "alumno" ? "Pronto se publicarán quizzes de esta materia." : "Empieza creando tu primer quiz con el botón de arriba."}</div>
            </div>
        `;
        return;
    }

    const cardsHtml = quizzes.map(q => {
        const totalPreg = Array.isArray(q.preguntas) ? q.preguntas.length : 0;
        const xpUnitario = esExamen && Number(q.xpPorAcierto) ? Number(q.xpPorAcierto) : 20;
        const xpMax = totalPreg * xpUnitario;
        const tiempoEst = esExamen && Number(q.tiempoMinutos)
            ? Number(q.tiempoMinutos)
            : Math.max(1, Math.ceil(totalPreg * 0.5));
        const mejor = mejorPorJuego[q.id];
        const esUserCreated = userCreatedIds.has(q.id);
        // SELECTIVOS A: profesor solo puede eliminar lo que él creó.
        const esMiCreacion = esUserCreated && (q.creadoPor === uid);
        let estadoChip;
        let cta;
        let onclickAttr;
        if (rol === "alumno") {
            if (mejor) {
                estadoChip = `<span class="x-chip x-chip--ok" style="font-size:10px">✓ Mejor: ${mejor.aciertos}/${mejor.totalPreguntas}</span>`;
                cta = `Volver a jugar →`;
            } else {
                estadoChip = `<span class="x-chip x-chip--info" style="font-size:10px">Nuevo</span>`;
                cta = `Jugar →`;
            }
            onclickAttr = `onclick="iniciarQuiz('${_jqEsc(q.id)}')"`;
        } else {
            estadoChip = esMiCreacion
                ? `<span class="x-chip" style="font-size:10px;background:rgba(245,166,35,0.15);color:var(--xahni-amber,#f5a623);border:1px solid rgba(245,166,35,0.3)">★ Tu creación</span>`
                : `<span class="x-chip x-chip--muted" style="font-size:10px">${totalPreg} pregunta${totalPreg === 1 ? "" : "s"}</span>`;
            cta = esMiCreacion
                ? `<button class="x-btn x-btn--ghost x-btn--icon jq-card__delete" type="button" onclick="event.stopPropagation();crearQuizEliminar('${_jqEsc(q.id)}')" aria-label="Eliminar quiz">🗑</button>`
                : `<span style="color:var(--text-muted);font-size:11px">Vista de profesor</span>`;
            onclickAttr = "";
        }

        return `
            <article class="x-card jq-card${rol === "alumno" ? " jq-card--clickable" : ""}" ${onclickAttr}>
                <header class="jq-card__head">
                    <div class="jq-card__title-area">
                        <div class="jq-card__title">${_jqEsc(q.nombre || (esExamen ? "Examen" : "Quiz"))}</div>
                        <div class="jq-card__meta">
                            <span class="x-chip ${esExamen ? "x-chip--warn" : "x-chip--info"}" style="font-size:10px">${esExamen ? "Examen" : "Quiz"}</span>
                            ${q.creadoPor ? `<span class="x-chip x-chip--muted" style="font-size:10px">Por ${_jqEsc(q.creadoPor)}</span>` : ""}
                        </div>
                    </div>
                    ${estadoChip}
                </header>
                <div class="jq-card__metrics">
                    <div><div class="jq-card__metric-label">XP máx</div><div class="jq-card__metric-value jq-card__metric-value--xp">+${xpMax}</div></div>
                    <div><div class="jq-card__metric-label">Preguntas</div><div class="jq-card__metric-value">${totalPreg}</div></div>
                    <div><div class="jq-card__metric-label">Tiempo est.</div><div class="jq-card__metric-value">${tiempoEst} min</div></div>
                </div>
                <div class="jq-card__cta">${cta}</div>
            </article>
        `;
    }).join("");

    panelEl.innerHTML = `
        <div class="x-page-head">
            <div>
                <div class="x-page-head__title">${_jqEsc(titulo)}</div>
                <div class="x-page-head__subtitle">${_jqEsc(subtitulo)}</div>
            </div>
            ${headerActions}
        </div>
        <div class="jq-card-grid">
            ${cardsHtml}
        </div>
    `;
}

// FIX 2026-07-08: era una reimplementación duplicada de _escapeHtml
// (js/core/dom-utils.js). Ahora delega al canonical — ver CONVENTIONS.md.
function _jqEsc(s) {
    return _escapeHtml(s);
}

// Hook para alumno — override del IIFE legacy `JuegosEstudiante`.
window.hubMateriaRenderJuegos = function () {
    if (typeof hubMateriaActiva === "undefined" || !hubMateriaActiva) return;
    const panelEl = document.getElementById("hub-panel-juegos");
    buildHubMatPanelQuizzes(panelEl, hubMateriaActiva.id, "alumno");
};

// Hook para profesor — invocado por _profMatDispatchTabRender (override patch).
window.profHubMatRenderJuegos = function (panelId, matId) {
    const panelEl = document.getElementById(panelId);
    buildHubMatPanelQuizzes(panelEl, matId, "profesor");
};

// Sprint Examenes 2026-06-04 → E8 2026-06-06: hooks legacy descableados.
// Migración cerrada: js/estudiante/examenes-est.js y js/profesor/examenes-prof.js
// reasignan window.hubMateriaRenderExamenes y window.profHubMatRenderExamenes
// definitivamente con buildExamenesEst / buildExamenesProf. Stubs no-op
// preservados como fallback defensivo si los builders nuevos no se cargan.
window.hubMateriaRenderExamenes = window.hubMateriaRenderExamenes || function () {};
window.profHubMatRenderExamenes = window.profHubMatRenderExamenes || function (panelId, matId) {};

// ══════════════════════════════════════════════════════════════════════
// Toasts XP + level-up + insignia (Slice día 2 task #13)
// ══════════════════════════════════════════════════════════════════════
//
// Regla: cuando el modal jugar quiz está ACTIVO, la pantalla de resultados
// ya muestra "+X XP" y "Subiste al nivel N" visualmente. NO duplicar con
// toast. Cuando XP viene de OTRO source (entrega tarea, competencia ganada),
// el toast es el feedback canónico.

(function () {
    function _quizModalAbierto() {
        const m = document.getElementById("modal-jugar-quiz");
        return !!(m && m.classList.contains("active"));
    }

    document.addEventListener("xahni:gamerUpdated", function (e) {
        const d = e.detail;
        if (!d) return;
        // Polish 2026-06-04: solo toast si el evento aplica al usuario activo.
        // En cierre de competencia el profesor dispara N×gamerUpdated (uno por
        // miembro del grupo ganador). Sin filtro el profesor ve toda la cascada
        // de toasts ajenos a su sesión.
        if (typeof APP !== "undefined" && APP.user && d.uid !== APP.user.id) return;
        if (_quizModalAbierto()) return; // result screen ya lo muestra
        if (typeof showToast !== "function") return;
        if (d.delta > 0) {
            showToast(`✨ +${d.delta} XP ganados`, "ok");
        }
        if (d.levelUp) {
            setTimeout(() => {
                showToast(`🎉 ¡Subiste al nivel ${d.nivelNuevo}!`, "ok");
            }, 800);
        }
    });

    document.addEventListener("xahni:insigniaUnlocked", function (e) {
        const d = e.detail;
        if (!d || typeof showToast !== "function") return;
        // Polish 2026-06-04: solo toast si la insignia aplica al usuario activo.
        // Mismo razonamiento que xahni:gamerUpdated (cascada cierre comp).
        if (typeof APP !== "undefined" && APP.user && d.uid !== APP.user.id) return;
        // Sprint día 3: lookup nombre + icono del catálogo para toast rico.
        let nombre = "Nueva insignia";
        let icono = "🏆";
        if (typeof DEMO_LOGROS !== "undefined" && Array.isArray(DEMO_LOGROS)) {
            const l = DEMO_LOGROS.find(x => x.id === d.insigniaId);
            if (l) {
                nombre = l.nombre || nombre;
                icono = l.icono || icono;
            }
        }
        showToast(`${icono} ¡Insignia desbloqueada: ${nombre}!`, "ok");
    });
})();
