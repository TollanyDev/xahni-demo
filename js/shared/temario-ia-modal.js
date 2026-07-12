// js/shared/temario-ia-modal.js
// Sweep 2026-06-09 (Temario+IA): modal IA para sugerir temario completo
// y para generar juego por tema. Reusa IaBatch core para el batch lifecycle.
//
// API publica (window.TemarioIaModal):
//   openSugerirTemario(matId)                   - profesor
//   openGenerarJuego(matId, temaId, temaTitulo) - profesor (cap 2 lotes/tema)
//   openGenerarJuegoAlumno(matId, temaId, temaTitulo) - alumno (Bundle C)
//
// Bundle C (2026-06-09 segunda mitad):
//   Alumno ve pool combinado de ideas IA no-publicadas: lotes del profesor +
//   lotes IA propios de otros alumnos del mismo grupo. Puede descartar (local
//   tracking), publicar (cap 1 IA + 1 manual por materia × parcial), o
//   generar su propio lote (cap 1 lote IA propio por tema) cuando agotó las
//   reciclables.

const TemarioIaModal = (() => {

    const ESTILOS = [
        { id: "practico",      label: "Práctico",        desc: "ejercicios y casos reales" },
        { id: "teorico",       label: "Teórico",         desc: "fundamentos y demostraciones" },
        { id: "principiantes", label: "Para principiantes", desc: "intro suave, sin requisitos" },
        { id: "avanzado",      label: "Avanzado",        desc: "tópicos profundos, prereq fuertes" }
    ];

    const JUEGO_CAP = 2; // máximo 2 lotes IA por tema

    let _state = null; // runtime del modal activo

    // ── Context helpers ──────────────────────────────────────────

    function _materiaContext(matId) {
        const m = (typeof DEMO_MATERIAS !== "undefined")
            ? DEMO_MATERIAS.find(x => x.id === matId) : null;
        if (!m) return { nombre: matId };
        return {
            nombre: m.nombre || matId,
            clave: m.clave || "",
            descripcion: m.descripcion || "",
            clasificacion: m.clasificacionId || ""
        };
    }

    function _esc(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    // ── Error handling user-facing ────────────────────────────────

    function _toastError(err) {
        const msg = String(err && err.message || err);
        if (/prepayment credits are depleted|429/i.test(msg)) {
            console.error("[TemarioIaModal] Créditos Gemini agotados:", err);
            if (typeof showToast === "function") showToast("⚠ Créditos Gemini agotados. Activa Pay-as-you-go en aistudio.google.com/apikey o vincula billing al proyecto en Cloud Console.", "warning");
        } else if (/API_KEY_SERVICE_BLOCKED|are blocked/i.test(msg)) {
            console.error("[TemarioIaModal] API key restringida:", err);
            if (typeof showToast === "function") showToast("⚠ API key bloqueada. Habilita 'Generative Language API' en Google Cloud Console > Credentials > tu key > API restrictions.", "warning");
        } else if (/API_KEY_INVALID|API key not valid/i.test(msg)) {
            if (typeof showToast === "function") showToast("⚠ API key inválida. Revisa firebase-config.js.", "warning");
        } else if (/API_KEY_HTTP_REFERRER_BLOCKED|requests from referer/i.test(msg)) {
            if (typeof showToast === "function") showToast("⚠ Dominio no autorizado. Añade este origin en Cloud Console > Credentials > tu key > Application restrictions > HTTP referrers.", "warning");
        } else if (/quota/i.test(msg) || (err && err.code === 8)) {
            if (typeof showToast === "function") showToast("⚠ Cuota IA alcanzada. Intenta más tarde.", "warning");
        } else if (/SAFETY/i.test(msg)) {
            if (typeof showToast === "function") showToast("⚠ Respuesta IA filtrada. Reintenta con otro estilo.", "warning");
        } else if (err instanceof SyntaxError) {
            if (typeof showToast === "function") showToast("⚠ Gemini respondió mal-formado. Reintenta.", "warning");
        } else if (/timeout|AbortError|network/i.test(msg)) {
            if (typeof showToast === "function") showToast("⚠ Sin respuesta de Gemini. Revisa tu conexión.", "warning");
        } else if (/cap-reached/.test(msg)) {
            if (typeof showToast === "function") showToast("ℹ Has agotado los lotes para este tema.", "info");
        } else if (/AI model not available/.test(msg)) {
            if (typeof showToast === "function") showToast("⚠ IA no disponible (¿modo demo? ¿API habilitada?).", "warning");
        } else {
            console.error("[TemarioIaModal] error:", err);
            if (typeof showToast === "function") showToast("⚠ Error IA inesperado. Reintenta. (Ver consola)", "warning");
        }
    }

    // ═════════════════════════════════════════════════════════════
    // SUGERIR TEMARIO COMPLETO
    // ═════════════════════════════════════════════════════════════

    function _promptTemario(matId, estilo) {
        const ctx = _materiaContext(matId);
        const estiloObj = ESTILOS.find(e => e.id === estilo) || ESTILOS[0];
        return `Eres un experto en diseño curricular universitario. Genera 5 temarios alternativos para la materia "${ctx.nombre}" (clave ${ctx.clave || "—"}). Enfoque: ${estiloObj.label} (${estiloObj.desc}). Cada temario debe tener entre 3 y 5 unidades, cada una con 2 a 4 subtemas. Las descripciones de subtema deben ser frases breves (1-2 oraciones) sobre qué se cubre. Responde JSON exacto siguiendo el schema. No incluyas texto antes ni después del JSON.`;
    }

    const _schemaTemario = {
        type: "object",
        properties: {
            ideas: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        unidades: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    titulo: { type: "string" },
                                    subtemas: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                titulo: { type: "string" },
                                                descripcion: { type: "string" }
                                            },
                                            required: ["titulo", "descripcion"]
                                        }
                                    }
                                },
                                required: ["titulo", "subtemas"]
                            }
                        }
                    },
                    required: ["unidades"]
                }
            }
        },
        required: ["ideas"]
    };

    function _renderEstiloPickerTemario() {
        const body = document.getElementById("modal-temario-ia-body");
        if (!body) return;
        body.innerHTML = `
            <p class="x-help">Elige el enfoque para que la IA genere 5 temarios alternativos:</p>
            <div class="x-temario-ia-estilos">
                ${ESTILOS.map(e => `
                    <button class="x-temario-ia-estilo-chip"
                            onclick="TemarioIaModal._onEstilo('${e.id}')">
                        <strong>${e.label}</strong>
                        <span>${e.desc}</span>
                    </button>
                `).join("")}
            </div>
            <p class="x-help x-help--muted" style="margin-top:16px;">
                ✨ Una sola llamada a Gemini retorna 5 sugerencias optimizadas (lote único).
            </p>
        `;
        const foot = document.getElementById("modal-temario-ia-foot");
        if (foot) foot.innerHTML = "";
    }

    function _renderLoadingTemario() {
        const body = document.getElementById("modal-temario-ia-body");
        if (!body) return;
        body.innerHTML = `
            <div class="x-temario-ia-loading">
                <div class="x-spinner"></div>
                <p>Gemini está generando 5 temarios alternativos…</p>
            </div>
        `;
        const foot = document.getElementById("modal-temario-ia-foot");
        if (foot) foot.innerHTML = "";
    }

    function _renderIdeaTemario(batch) {
        const body = document.getElementById("modal-temario-ia-body");
        const foot = document.getElementById("modal-temario-ia-foot");
        if (!body || !foot) return;
        const idx = batch.indiceActual || 0;
        const idea = batch.ideas[idx];
        const total = batch.ideas.length;

        body.innerHTML = `
            <div class="x-temario-ia-preview">
                <div class="x-temario-ia-preview__head">
                    <span class="x-chip x-chip--brand">✨ Idea ${idx + 1} de ${total}</span>
                    <span class="x-chip">Estilo: ${_esc(batch.estilo) || "—"}</span>
                </div>
                ${(idea.unidades || []).map((u, ui) => `
                    <div class="x-temario-ia-unidad">
                        <div class="x-temario-ia-unidad__titulo">${ui + 1}. ${_esc(u.titulo)}</div>
                        <ul>
                            ${(u.subtemas || []).map(s => `
                                <li><strong>${_esc(s.titulo)}</strong>${s.descripcion ? `: ${_esc(s.descripcion)}` : ""}</li>
                            `).join("")}
                        </ul>
                    </div>
                `).join("")}
            </div>
            <p class="x-help x-help--muted" style="margin-top:12px;">
                Generado con Gemini · Lote optimizado (1 llamada = ${total} sugerencias)
            </p>
        `;

        const esPrimera = (idx === 0);
        const esUltima = (idx === total - 1);
        foot.innerHTML = `
            <button class="x-btn x-btn--ghost" onclick="closeModal('modal-temario-ia')">Cancelar</button>
            <button class="x-btn x-btn--ghost" ${esPrimera ? "disabled" : ""}
                    onclick="TemarioIaModal._onAnterior()">◀ Anterior</button>
            ${esUltima
                ? `<button class="x-btn x-btn--ghost" onclick="TemarioIaModal._onRegenerar()">🔄 Regenerar lote</button>`
                : `<button class="x-btn x-btn--ghost" onclick="TemarioIaModal._onSiguiente()">Siguiente ▶</button>`}
            <button class="x-btn x-btn--primary" onclick="TemarioIaModal._onAplicar()">Aplicar este temario</button>
        `;
    }

    async function openSugerirTemario(matId) {
        const profUid = APP.user.id;
        _state = {
            modal: "temario",
            matId,
            profUid,
            path: ["materias", matId, "iaSuggestions", profUid]
        };
        if (typeof openModal === "function") openModal("modal-temario-ia");

        // Si ya hay batch, mostrar desde donde se quedó
        try {
            const existing = await IaBatch.getBatch(_state.path);
            if (existing && Array.isArray(existing.ideas) && existing.ideas.length > 0) {
                _state.batch = existing;
                _state.estilo = existing.estilo;
                _renderIdeaTemario(existing);
                return;
            }
        } catch (e) { /* defensive — sigue al estilo picker */ }

        _renderEstiloPickerTemario();
    }

    async function _onEstilo(estilo) {
        if (!_state) return;
        _state.estilo = estilo;
        _renderLoadingTemario();
        try {
            const batch = await IaBatch.generate({
                path: _state.path,
                prompt: _promptTemario(_state.matId, estilo),
                responseSchema: _schemaTemario,
                estilo
            });
            _state.batch = batch;
            _renderIdeaTemario(batch);
        } catch (e) {
            _toastError(e);
            _renderEstiloPickerTemario();
        }
    }

    async function _onSiguiente() {
        if (!_state || !_state.batch) return;
        try {
            await IaBatch.advance(_state.path);
            _state.batch.indiceActual = Math.min(
                (_state.batch.indiceActual || 0) + 1,
                _state.batch.ideas.length - 1
            );
            _renderIdeaTemario(_state.batch);
        } catch (e) {
            _toastError(e);
        }
    }

    async function _onAnterior() {
        if (!_state || !_state.batch) return;
        if ((_state.batch.indiceActual || 0) === 0) return;
        try {
            const next = (_state.batch.indiceActual || 0) - 1;
            await IaBatch.setIndice(_state.path, next);
            _state.batch.indiceActual = next;
            _renderIdeaTemario(_state.batch);
        } catch (e) {
            _toastError(e);
        }
    }

    async function _onRegenerar() {
        if (!_state) return;
        _renderLoadingTemario();
        try {
            const batch = await IaBatch.generate({
                path: _state.path,
                prompt: _promptTemario(_state.matId, _state.estilo || "practico"),
                responseSchema: _schemaTemario,
                estilo: _state.estilo || "practico"
            });
            _state.batch = batch;
            _renderIdeaTemario(batch);
        } catch (e) {
            _toastError(e);
            if (_state.batch) _renderIdeaTemario(_state.batch);
        }
    }

    function _onAplicar() {
        if (!_state || !_state.batch) return;
        const idea = _state.batch.ideas[_state.batch.indiceActual || 0];
        const actual = TemarioData.getTemario(_state.matId);
        const tieneContenido = actual.unidades && actual.unidades.length > 0;

        if (tieneContenido) {
            const ok = confirm(
                "Esto reemplaza tu temario actual con la sugerencia de IA. " +
                "Los cambios actuales se perderán. ¿Continuar?"
            );
            if (!ok) return;
        }

        TemarioData.replaceTemario(_state.matId, idea.unidades || []);
        if (typeof showToast === "function") showToast("✓ Temario aplicado. Edita lo que quieras.", "success");
        if (typeof closeModal === "function") closeModal("modal-temario-ia");
        _state = null;
    }

    // ═════════════════════════════════════════════════════════════
    // GENERAR JUEGO POR TEMA (cap 2 lotes/tema)
    // ═════════════════════════════════════════════════════════════

    // ── Prompts y schemas por tipo de juego ──────────────────────

    function _promptJuego(matId, temaTitulo, estilo, tipo) {
        const ctx = _materiaContext(matId);
        const estiloObj = ESTILOS.find(e => e.id === estilo) || ESTILOS[0];
        const tipoJ = tipo || "quiz";
        if (tipoJ === "vf") {
            return `Eres un experto en diseño de juegos educativos Verdadero/Falso. Para la materia "${ctx.nombre}", tema "${temaTitulo}", enfoque ${estiloObj.label} (${estiloObj.desc}), genera 5 sets de V/F alternativos. Cada set tiene un nombre evocador y exactamente 5 afirmaciones binarias. Cada afirmación tiene un texto claro y un boolean esVerdadera. Mezcla verdaderas y falsas. Responde JSON exacto siguiendo el schema. No incluyas texto antes ni después del JSON.`;
        }
        if (tipoJ === "flashcards") {
            return `Eres un experto en diseño de flashcards educativas. Para la materia "${ctx.nombre}", tema "${temaTitulo}", enfoque ${estiloObj.label} (${estiloObj.desc}), genera 5 sets de flashcards alternativos. Cada set tiene un nombre evocador y exactamente 6 tarjetas. Cada tarjeta tiene un anverso (concepto/pregunta breve) y un reverso (definición/respuesta concisa). Responde JSON exacto siguiendo el schema. No incluyas texto antes ni después del JSON.`;
        }
        // quiz (default)
        return `Eres un experto en diseño de quizzes educativos. Para la materia "${ctx.nombre}", tema "${temaTitulo}", enfoque ${estiloObj.label} (${estiloObj.desc}), genera 5 quizzes alternativos. Cada quiz tiene un nombre evocador y exactamente 3 preguntas opción múltiple. Cada pregunta tiene 4 opciones y un índice correctaIdx (0-3). Responde JSON exacto siguiendo el schema. No incluyas texto antes ni después del JSON.`;
    }

    function _schemaJuegoFor(tipo) {
        const tipoJ = tipo || "quiz";
        if (tipoJ === "vf") {
            return {
                type: "object",
                properties: {
                    ideas: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                nombre: { type: "string" },
                                afirmaciones: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            texto: { type: "string" },
                                            esVerdadera: { type: "boolean" }
                                        },
                                        required: ["texto", "esVerdadera"]
                                    }
                                }
                            },
                            required: ["nombre", "afirmaciones"]
                        }
                    }
                },
                required: ["ideas"]
            };
        }
        if (tipoJ === "flashcards") {
            return {
                type: "object",
                properties: {
                    ideas: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                nombre: { type: "string" },
                                tarjetas: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            anverso: { type: "string" },
                                            reverso: { type: "string" }
                                        },
                                        required: ["anverso", "reverso"]
                                    }
                                }
                            },
                            required: ["nombre", "tarjetas"]
                        }
                    }
                },
                required: ["ideas"]
            };
        }
        // quiz
        return {
            type: "object",
            properties: {
                ideas: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            nombre: { type: "string" },
                            preguntas: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        texto: { type: "string" },
                                        opciones: { type: "array", items: { type: "string" } },
                                        correctaIdx: { type: "integer", minimum: 0, maximum: 3 }
                                    },
                                    required: ["texto", "opciones", "correctaIdx"]
                                }
                            }
                        },
                        required: ["nombre", "preguntas"]
                    }
                }
            },
            required: ["ideas"]
        };
    }

    // Backward-compat para callers que aún referencian la const original
    const _schemaJuego = _schemaJuegoFor("quiz");

    function _renderIdeaPreview(idea, tipo) {
        const tipoJ = tipo || "quiz";
        if (tipoJ === "vf") {
            return (idea.afirmaciones || []).map((a, i) => `
                <div class="x-temario-ia-unidad">
                    <div class="x-temario-ia-unidad__titulo">
                        ${a.esVerdadera ? "<span style='color:var(--xahni-teal)'>✓ V</span>" : "<span style='color:var(--xahni-red,#e74c3c)'>✗ F</span>"}
                        · ${_esc(a.texto)}
                    </div>
                </div>
            `).join("");
        }
        if (tipoJ === "flashcards") {
            return (idea.tarjetas || []).map((t, i) => `
                <div class="x-temario-ia-unidad">
                    <div class="x-temario-ia-unidad__titulo">🃏 ${_esc(t.anverso)}</div>
                    <ul><li>${_esc(t.reverso)}</li></ul>
                </div>
            `).join("");
        }
        // quiz (default)
        return (idea.preguntas || []).map((p, pi) => `
            <div class="x-temario-ia-unidad">
                <div class="x-temario-ia-unidad__titulo">P${pi + 1}. ${_esc(p.texto)}</div>
                <ul>
                    ${(p.opciones || []).map((o, oi) => `
                        <li class="${oi === p.correctaIdx ? "x-correct" : ""}">${oi === p.correctaIdx ? "✓ " : ""}${_esc(o)}</li>
                    `).join("")}
                </ul>
            </div>
        `).join("");
    }

    function _tipoLabel(tipo) {
        if (tipo === "vf") return "Verdadero/Falso";
        if (tipo === "flashcards") return "Flashcards";
        return "Quiz";
    }

    /**
     * Construye el juego canónico segun el tipo del IA batch.
     * Quiz: {tipo:'quiz', preguntas[{id,texto,opciones[4],correcta:0-3}]}
     * V/F: {tipo:'vf', afirmaciones[{id,texto,esVerdadera:bool}]}
     * Flashcards: {tipo:'flashcards', tarjetas[{id,anverso,reverso}]}
     */
    function _buildJuegoCanonico(opts) {
        const { ideaNombre, tipo, idea, matId, temaId, temaTitulo, creadoPor, estiloIa, idPrefix, extras } = opts;
        const id = idPrefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
        const base = {
            id,
            nombre: ideaNombre,
            tipo: tipo,
            materiaId: matId,
            temaId,
            temaTitulo,
            creadoPor,
            creadoEn: new Date().toISOString(),
            origen: "ia",
            estiloIa: estiloIa || null
        };
        if (extras && typeof extras === "object") Object.assign(base, extras);

        if (tipo === "vf") {
            base.afirmaciones = (idea.afirmaciones || []).map((a, i) => ({
                id: "a" + (i + 1),
                texto: a.texto,
                esVerdadera: !!a.esVerdadera
            }));
        } else if (tipo === "flashcards") {
            base.tarjetas = (idea.tarjetas || []).map((t, i) => ({
                id: "t" + (i + 1),
                anverso: t.anverso,
                reverso: t.reverso
            }));
        } else {
            // quiz
            base.preguntas = (idea.preguntas || []).map((p, i) => ({
                id: "p" + (i + 1),
                texto: p.texto,
                opciones: p.opciones,
                correcta: p.correctaIdx
            }));
        }
        return base;
    }

    function _renderJuegoEstiloPicker() {
        const body = document.getElementById("modal-generar-juego-body");
        if (!body) return;
        body.innerHTML = `
            <p class="x-help">Tema: <strong>${_esc(_state.temaTitulo)}</strong></p>
            <p class="x-help">Elige el enfoque (lote 1 de ${JUEGO_CAP}):</p>
            <div class="x-temario-ia-estilos">
                ${ESTILOS.map(e => `
                    <button class="x-temario-ia-estilo-chip"
                            onclick="TemarioIaModal._onEstiloJuego('${e.id}')">
                        <strong>${e.label}</strong>
                        <span>${e.desc}</span>
                    </button>
                `).join("")}
            </div>
            <p class="x-help x-help--muted" style="margin-top:16px;">
                ✨ Generado con Gemini · Lote único de 5 quizzes (1 llamada).
            </p>
        `;
        const foot = document.getElementById("modal-generar-juego-foot");
        if (foot) foot.innerHTML = "";
    }

    function _renderJuegoLoading() {
        const body = document.getElementById("modal-generar-juego-body");
        if (!body) return;
        body.innerHTML = `
            <div class="x-temario-ia-loading">
                <div class="x-spinner"></div>
                <p>Gemini está generando 5 quizzes…</p>
            </div>
        `;
        const foot = document.getElementById("modal-generar-juego-foot");
        if (foot) foot.innerHTML = "";
    }

    function _renderJuegoIdea(batch) {
        const body = document.getElementById("modal-generar-juego-body");
        const foot = document.getElementById("modal-generar-juego-foot");
        if (!body || !foot) return;
        // Shape nuevo con lotes acumulados (post-2026-06-09).
        const lotesArr = Array.isArray(batch.lotes) ? batch.lotes : [];
        const loteIdx = batch.loteActual || 0;
        const loteActual = lotesArr[loteIdx] || { ideas: [] };
        const ideas = loteActual.ideas || [];
        const idx = batch.indiceActual || 0;
        const idea = ideas[idx] || {};
        const total = ideas.length;
        const totalLotes = lotesArr.length;
        const estiloLabel = (ESTILOS.find(e => e.id === loteActual.estilo) || {}).label || "—";
        const yaPublicada = !!idea.publicada;
        // Publicadas en TODO el batch (suma todos los lotes)
        const publicadasCount = lotesArr.reduce((acc, lt) =>
            acc + (lt.ideas || []).filter(x => x.publicada).length, 0);

        body.innerHTML = `
            <div class="x-temario-ia-preview">
                <div class="x-temario-ia-preview__head">
                    <span class="x-chip x-chip--brand">✨ Idea ${idx + 1} de ${total}</span>
                    <span class="x-chip">Lote ${loteIdx + 1} de ${JUEGO_CAP}${totalLotes < JUEGO_CAP ? ` (${totalLotes} generado${totalLotes > 1 ? 's' : ''})` : ''}</span>
                    <span class="x-chip">Estilo: ${estiloLabel}</span>
                    ${publicadasCount > 0 ? `<span class="x-chip x-chip--success">📤 ${publicadasCount} publicada${publicadasCount > 1 ? "s" : ""}</span>` : ""}
                    ${yaPublicada ? `<span class="x-chip x-chip--success">✓ Esta ya publicada</span>` : ""}
                </div>
                ${totalLotes > 1 ? `
                <div style="display:flex;align-items:center;gap:8px;margin:10px 0 6px;padding:8px 10px;background:var(--surface-2);border-radius:var(--radius-sm);">
                    <span style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;">Lote</span>
                    <button class="x-btn x-btn--ghost x-btn--sm" ${loteIdx === 0 ? "disabled" : ""}
                            onclick="TemarioIaModal._onLoteAnterior()">◀</button>
                    ${lotesArr.map((_, li) => `
                        <button class="x-btn x-btn--sm ${li === loteIdx ? 'x-btn--primary' : 'x-btn--ghost'}"
                                style="min-width:32px;padding:4px 10px;"
                                onclick="TemarioIaModal._onSetLote(${li})">${li + 1}</button>
                    `).join("")}
                    <button class="x-btn x-btn--ghost x-btn--sm" ${loteIdx === totalLotes - 1 ? "disabled" : ""}
                            onclick="TemarioIaModal._onLoteSiguiente()">▶</button>
                </div>` : ""}
                <h4 style="margin: 10px 0 6px;">${_esc(idea.nombre)} <span class="x-chip" style="margin-left:8px;font-size:10px;background:var(--surface-2);color:var(--text-muted);padding:2px 8px;border-radius:99px;">${_tipoLabel(_state && _state.tipo)}</span></h4>
                ${_renderIdeaPreview(idea, _state && _state.tipo)}
            </div>
            <p class="x-help x-help--muted" style="margin-top:12px;">
                Generado con Gemini · Lote optimizado
            </p>
        `;

        const esPrimeraIdea = (idx === 0);
        const esUltimaIdea = (idx === total - 1);
        // Bundle C fix: el alumno tiene cap=1 lote, NO debe ver botón Regenerar.
        // Si modal es del alumno, suprimimos el botón Regenerar lote.
        const esAlumno = _state && _state.modal === "juego-alumno";
        const capDelRol = esAlumno ? 1 : JUEGO_CAP;
        const puedeRegenerar = !esAlumno && totalLotes < JUEGO_CAP;
        // Para el alumno usamos _onPublicarAlumno (cap-aware materia×parcial);
        // profesor usa _onPublicarJuego (sin cap publicación, solo cap lotes).
        const handlerPublicar = esAlumno ? "TemarioIaModal._onPublicarAlumno()" : "TemarioIaModal._onPublicarJuego()";
        foot.innerHTML = `
            <button class="x-btn x-btn--ghost" onclick="closeModal('modal-generar-juego')">Cerrar</button>
            <button class="x-btn x-btn--ghost" ${esPrimeraIdea ? "disabled" : ""}
                    onclick="TemarioIaModal._onAnteriorJuego()">◀ Anterior</button>
            ${esUltimaIdea
                ? (puedeRegenerar
                    ? `<button class="x-btn x-btn--ghost" onclick="TemarioIaModal._onRegenerarJuego()">🔄 Generar lote ${totalLotes + 1}/${JUEGO_CAP}</button>`
                    : (esAlumno
                        ? "" // alumno no tiene opción de regenerar (cap 1)
                        : `<button class="x-btn x-btn--ghost" disabled title="Has agotado los ${JUEGO_CAP} lotes para este tema">🔒 Lotes agotados</button>`))
                : `<button class="x-btn x-btn--ghost" onclick="TemarioIaModal._onSiguienteJuego()">Siguiente ▶</button>`}
            <button class="x-btn x-btn--primary" ${yaPublicada ? "disabled" : ""}
                    onclick="${handlerPublicar}">
                ${yaPublicada ? "✓ Ya publicada" : "📤 Publicar este juego"}
            </button>
        `;
    }

    async function openGenerarJuego(matId, temaId, temaTitulo, tipo) {
        // Si no se pasó tipo, abrir el selector primero (CrearSelector con modo ia)
        if (!tipo) {
            if (typeof CrearSelector !== "undefined") {
                CrearSelector.abrir(matId, {
                    modo: "ia",
                    ctxIa: { temaId, temaTitulo, esAlumno: false }
                });
                return;
            }
            tipo = "quiz"; // fallback
        }
        const profUid = APP.user.id;
        const docId = profUid + "_" + temaId + (tipo !== "quiz" ? ("_" + tipo) : "");
        _state = {
            modal: "juego",
            matId,
            profUid,
            temaId,
            temaTitulo,
            tipo,
            path: ["materias", matId, "iaJuegos", docId]
        };
        if (typeof openModal === "function") openModal("modal-generar-juego");

        try {
            const existing = await IaBatch.getBatch(_state.path);
            // Shape nuevo migrado por getBatch: existing.lotes[] presente
            const tieneLotes = existing && Array.isArray(existing.lotes) && existing.lotes.length > 0;
            if (tieneLotes) {
                _state.batch = existing;
                const lote = existing.lotes[existing.loteActual || 0] || {};
                _state.estilo = lote.estilo;
                _renderJuegoIdea(existing);
                return;
            }
        } catch (e) { /* defensive */ }

        _renderJuegoEstiloPicker();
    }

    async function _onEstiloJuego(estilo) {
        if (!_state) return;
        _state.estilo = estilo;
        _renderJuegoLoading();
        const tipo = _state.tipo || "quiz";
        try {
            const batch = await IaBatch.generate({
                path: _state.path,
                prompt: _promptJuego(_state.matId, _state.temaTitulo, estilo, tipo),
                responseSchema: _schemaJuegoFor(tipo),
                estilo,
                cap: JUEGO_CAP,
                extraFields: { temaId: _state.temaId, temaTitulo: _state.temaTitulo, tipo }
            });
            _state.batch = batch;
            _renderJuegoIdea(batch);
        } catch (e) {
            _toastError(e);
            _renderJuegoEstiloPicker();
        }
    }

    function _ideasDelLoteActual(batch) {
        const lotesArr = Array.isArray(batch.lotes) ? batch.lotes : [];
        const lote = lotesArr[batch.loteActual || 0] || { ideas: [] };
        return lote.ideas || [];
    }

    async function _onSiguienteJuego() {
        if (!_state || !_state.batch) return;
        try {
            await IaBatch.advance(_state.path);
            const ideas = _ideasDelLoteActual(_state.batch);
            _state.batch.indiceActual = Math.min(
                (_state.batch.indiceActual || 0) + 1,
                ideas.length - 1
            );
            _renderJuegoIdea(_state.batch);
        } catch (e) { _toastError(e); }
    }

    async function _onAnteriorJuego() {
        if (!_state || !_state.batch) return;
        if ((_state.batch.indiceActual || 0) === 0) return;
        try {
            const next = (_state.batch.indiceActual || 0) - 1;
            await IaBatch.setIndice(_state.path, next);
            _state.batch.indiceActual = next;
            _renderJuegoIdea(_state.batch);
        } catch (e) { _toastError(e); }
    }

    async function _onLoteAnterior() {
        if (!_state || !_state.batch) return;
        const cur = _state.batch.loteActual || 0;
        if (cur === 0) return;
        try {
            const next = cur - 1;
            await IaBatch.setLoteActual(_state.path, next);
            _state.batch.loteActual = next;
            _state.batch.indiceActual = 0;
            _renderJuegoIdea(_state.batch);
        } catch (e) { _toastError(e); }
    }

    async function _onLoteSiguiente() {
        if (!_state || !_state.batch) return;
        const cur = _state.batch.loteActual || 0;
        const totalLotes = (_state.batch.lotes || []).length;
        if (cur >= totalLotes - 1) return;
        try {
            const next = cur + 1;
            await IaBatch.setLoteActual(_state.path, next);
            _state.batch.loteActual = next;
            _state.batch.indiceActual = 0;
            _renderJuegoIdea(_state.batch);
        } catch (e) { _toastError(e); }
    }

    async function _onSetLote(loteIdx) {
        if (!_state || !_state.batch) return;
        if ((_state.batch.loteActual || 0) === loteIdx) return;
        try {
            await IaBatch.setLoteActual(_state.path, loteIdx);
            _state.batch.loteActual = loteIdx;
            _state.batch.indiceActual = 0;
            _renderJuegoIdea(_state.batch);
        } catch (e) { _toastError(e); }
    }

    async function _onRegenerarJuego() {
        if (!_state) return;
        _renderJuegoLoading();
        const tipo = _state.tipo || "quiz";
        try {
            const batch = await IaBatch.generate({
                path: _state.path,
                prompt: _promptJuego(_state.matId, _state.temaTitulo, _state.estilo || "practico", tipo),
                responseSchema: _schemaJuegoFor(tipo),
                estilo: _state.estilo || "practico",
                cap: JUEGO_CAP,
                extraFields: { temaId: _state.temaId, temaTitulo: _state.temaTitulo, tipo }
            });
            _state.batch = batch;
            _renderJuegoIdea(batch);
        } catch (e) {
            _toastError(e);
            if (_state.batch) _renderJuegoIdea(_state.batch);
        }
    }

    async function _onPublicarJuego() {
        if (!_state || !_state.batch) return;
        const idx = _state.batch.indiceActual || 0;
        const loteIdx = _state.batch.loteActual || 0;
        const ideas = _ideasDelLoteActual(_state.batch);
        const idea = ideas[idx];
        if (!idea) return;
        const loteEstilo = (_state.batch.lotes && _state.batch.lotes[loteIdx])
            ? _state.batch.lotes[loteIdx].estilo : _state.estilo;

        const tipo = _state.tipo || "quiz";
        const quiz = _buildJuegoCanonico({
            ideaNombre: idea.nombre,
            tipo,
            idea,
            matId: _state.matId,
            temaId: _state.temaId,
            temaTitulo: _state.temaTitulo,
            creadoPor: _state.profUid,
            estiloIa: loteEstilo || _state.estilo,
            idPrefix: "ia"
        });

        try {
            if (typeof addUserJuego === "function") addUserJuego(quiz);
            document.dispatchEvent(new CustomEvent("xahni:juegoCreado", { detail: { juego: quiz } }));
            await IaBatch.markPublicada(_state.path, idx);
            // Update local state: mark esta idea como publicada en el lote actual
            if (_state.batch.lotes && _state.batch.lotes[loteIdx]) {
                const newIdeas = _state.batch.lotes[loteIdx].ideas.map((it, i) =>
                    i === idx ? Object.assign({}, it, { publicada: true }) : it);
                _state.batch.lotes[loteIdx] = Object.assign({},
                    _state.batch.lotes[loteIdx], { ideas: newIdeas });
            }
            if (typeof showToast === "function") showToast("✓ Quiz publicado. Aparece en Tab Juegos.", "success");
            _renderJuegoIdea(_state.batch);
        } catch (e) {
            _toastError(e);
        }
    }

    // ═════════════════════════════════════════════════════════════
    // BUNDLE C · GENERAR JUEGO ALUMNO con pool combinado
    // ═════════════════════════════════════════════════════════════

    function _rechazadasKey(uid, temaId) {
        return "xahni:iaJuegos:rechazadas:" + uid + ":" + temaId;
    }
    function _getRechazadas(uid, temaId) {
        try {
            const raw = localStorage.getItem(_rechazadasKey(uid, temaId));
            return raw ? JSON.parse(raw) : [];
        } catch (_) { return []; }
    }
    function _addRechazada(uid, temaId, poolItemId) {
        try {
            const cur = _getRechazadas(uid, temaId);
            if (!cur.includes(poolItemId)) {
                cur.push(poolItemId);
                localStorage.setItem(_rechazadasKey(uid, temaId), JSON.stringify(cur));
            }
        } catch (_) { /* defensive */ }
    }
    function _poolItemId(item) {
        return item.ownerUid + ":" + item.loteIdx + ":" + item.ideaIdx;
    }

    function _grupoIdDelUsuario() {
        return (APP.user && APP.user.grupos && APP.user.grupos[0]) || null;
    }

    function _parcialActivoStr() {
        const matId = _state && _state.matId;
        const grupoId = _grupoIdDelUsuario();
        if (!matId || !grupoId) return "P1";
        const gmKey = matId + "_" + grupoId;
        const num = (APP.alumnoParcialActivo && APP.alumnoParcialActivo[gmKey]) || 1;
        return "P" + num;
    }

    async function _refreshPool() {
        if (!_state) return;
        const pool = await IaBatch.queryPoolPorTema(_state.matId, _state.temaId, _state.profesorUid, _state.tipo);
        const rechazadas = _getRechazadas(_state.alumUid, _state.temaId + "_" + (_state.tipo || "quiz"));
        _state.pool = pool.filter(item => !rechazadas.includes(_poolItemId(item)));
        if (_state.poolIdx >= _state.pool.length) _state.poolIdx = Math.max(0, _state.pool.length - 1);
    }

    async function _refreshCaps() {
        if (!_state) return;
        const [iaCount, manualCount] = await Promise.all([
            IaBatch.countQuizzesAlumno(_state.alumUid, _state.matId, _state.parcial, "ia"),
            IaBatch.countQuizzesAlumno(_state.alumUid, _state.matId, _state.parcial, "manual")
        ]);
        _state.iaPublicadasEnParcial = iaCount;
        _state.manualPublicadosEnParcial = manualCount;
    }

    function _renderAlumnoLoading() {
        const body = document.getElementById("modal-generar-juego-body");
        if (!body) return;
        body.innerHTML = `
            <div class="x-temario-ia-loading">
                <div class="x-spinner"></div>
                <p>Cargando ideas disponibles…</p>
            </div>`;
        const foot = document.getElementById("modal-generar-juego-foot");
        if (foot) foot.innerHTML = "";
    }

    function _renderAlumnoVista() {
        const body = document.getElementById("modal-generar-juego-body");
        const foot = document.getElementById("modal-generar-juego-foot");
        if (!body || !foot) return;

        const pool = _state.pool || [];
        const idx = _state.poolIdx || 0;
        const item = pool[idx];
        const cap = _state.iaPublicadasEnParcial >= 1;
        const totalPool = pool.length;
        const tieneLotePropio = !!_state.batch;  // batch propio cargado en _state

        // Header de cap + parcial siempre visible
        const capInfo = `
            <div class="x-temario-ia-preview__head" style="margin-bottom:8px">
                <span class="x-chip x-chip--info">Parcial ${_state.parcial}</span>
                <span class="x-chip ${cap ? 'x-chip--success' : ''}">IA: ${_state.iaPublicadasEnParcial}/1</span>
                <span class="x-chip ${_state.manualPublicadosEnParcial >= 1 ? 'x-chip--success' : ''}">Manual: ${_state.manualPublicadosEnParcial}/1</span>
            </div>`;

        if (tieneLotePropio) {
            // Caso 3: el alumno ya generó su propio lote → mostrar usando renderer del profesor
            return _renderJuegoIdea(_state.batch);
        }

        if (item) {
            // Caso 1: hay ideas reciclables del pool
            const ownerLabel = item.esProfesor ? "👨‍🏫 De tu profesor"
                : (item.ownerUid === _state.alumUid ? "🙋 Tuyo" : "🎓 De un compañero");

            body.innerHTML = `
                ${capInfo}
                <p class="x-help">Tema: <strong>${_esc(_state.temaTitulo)}</strong></p>
                <div class="x-temario-ia-preview">
                    <div class="x-temario-ia-preview__head">
                        <span class="x-chip x-chip--brand">✨ Reciclada del pool</span>
                        <span class="x-chip">${ownerLabel}</span>
                        <span class="x-chip">${idx + 1} de ${totalPool}</span>
                    </div>
                    <h4 style="margin: 10px 0 6px;">${_esc(item.idea.nombre)} <span class="x-chip" style="margin-left:8px;font-size:10px;background:var(--surface-2);color:var(--text-muted);padding:2px 8px;border-radius:99px;">${_tipoLabel(_state.tipo)}</span></h4>
                    ${_renderIdeaPreview(item.idea, _state.tipo)}
                </div>
                <p class="x-help x-help--muted" style="margin-top:12px;">
                    ♻️ Reciclando ideas IA ya generadas por tu profesor o compañeros (cero tokens nuevos).
                </p>
            `;
            const puedePublicar = !cap;
            const titlePublicar = cap ? "Ya publicaste tu IA en este parcial" : "Publica para que aparezca en Tab Juegos";
            const esPrimera = idx === 0;
            const esUltima = idx === totalPool - 1;
            foot.innerHTML = `
                <button class="x-btn x-btn--ghost" onclick="closeModal('modal-generar-juego')">Cerrar</button>
                <button class="x-btn x-btn--ghost" ${esPrimera ? "disabled" : ""}
                        onclick="TemarioIaModal._onPoolAnterior()">◀ Anterior</button>
                <button class="x-btn x-btn--ghost" ${esUltima ? "disabled" : ""}
                        onclick="TemarioIaModal._onPoolSiguiente()">Siguiente ▶</button>
                <button class="x-btn x-btn--ghost" onclick="TemarioIaModal._onDescartarAlumno()">👎 Descartar</button>
                <button class="x-btn x-btn--primary" ${puedePublicar ? "" : "disabled"}
                        title="${titlePublicar}"
                        onclick="TemarioIaModal._onPublicarAlumno()">📤 Publicar este quiz</button>
            `;
        } else {
            // Caso 2: pool agotado o vacío
            body.innerHTML = `
                ${capInfo}
                <p class="x-help">Tema: <strong>${_esc(_state.temaTitulo)}</strong></p>
                <div class="x-temario-ia-loading">
                    <div style="font-size:42px">🤖</div>
                    <p style="text-align:center;max-width:380px">
                        ${pool.length === 0 && _getRechazadas(_state.alumUid, _state.temaId).length === 0
                            ? "Nadie ha generado ideas IA para este tema todavía. Sé el primero."
                            : "Has revisado todas las ideas disponibles. Genera tu propio lote con IA (1 llamada nueva)."}
                    </p>
                </div>`;
            // Estilo picker para generar lote propio
            foot.innerHTML = `
                <button class="x-btn x-btn--ghost" onclick="closeModal('modal-generar-juego')">Cerrar</button>
                <button class="x-btn x-btn--primary" onclick="TemarioIaModal._onGenerarLotePropio()">🤖 Generar mi propio lote</button>
            `;
        }
    }

    async function openGenerarJuegoAlumno(matId, temaId, temaTitulo, tipo) {
        // Si no se pasó tipo, abrir el selector primero (CrearSelector con modo ia)
        if (!tipo) {
            if (typeof CrearSelector !== "undefined") {
                CrearSelector.abrir(matId, {
                    modo: "ia",
                    ctxIa: { temaId, temaTitulo, esAlumno: true }
                });
                return;
            }
            tipo = "quiz"; // fallback
        }
        const alumUid = APP.user.id;
        const matObj = (typeof DEMO_MATERIAS !== "undefined")
            ? DEMO_MATERIAS.find(m => m.id === matId) : null;
        const profesorUid = matObj && matObj.profesorId;
        const parcial = (function() {
            const grupoId = (APP.user.grupos || [])[0];
            if (!grupoId) return "P1";
            const gmKey = matId + "_" + grupoId;
            const num = (APP.alumnoParcialActivo && APP.alumnoParcialActivo[gmKey]) || 1;
            return "P" + num;
        })();

        _state = {
            modal: "juego-alumno",
            matId, temaId, temaTitulo, tipo,
            alumUid, profesorUid, parcial,
            pool: [], poolIdx: 0,
            iaPublicadasEnParcial: 0,
            manualPublicadosEnParcial: 0,
            batch: null  // se llena solo si el alumno generó su propio lote
        };
        if (typeof openModal === "function") openModal("modal-generar-juego");
        _renderAlumnoLoading();

        // Lee batch propio del alumno SI existe (caso "ya generó")
        const propioDocId = alumUid + "_" + temaId + (tipo !== "quiz" ? ("_" + tipo) : "");
        const propioPath = ["materias", matId, "iaJuegos", propioDocId];
        try {
            const propio = await IaBatch.getBatch(propioPath);
            if (propio && Array.isArray(propio.lotes) && propio.lotes.length > 0) {
                _state.batch = propio;
                _state.path = propioPath;
            }
        } catch (e) { /* defensive */ }

        await _refreshCaps();
        await _refreshPool();
        _renderAlumnoVista();
    }

    function _onPoolSiguiente() {
        if (!_state || !_state.pool) return;
        if (_state.poolIdx >= _state.pool.length - 1) return;
        _state.poolIdx++;
        _renderAlumnoVista();
    }

    function _onPoolAnterior() {
        if (!_state || !_state.pool) return;
        if ((_state.poolIdx || 0) === 0) return;
        _state.poolIdx--;
        _renderAlumnoVista();
    }

    function _onDescartarAlumno() {
        if (!_state || !_state.pool) return;
        const item = _state.pool[_state.poolIdx];
        if (!item) return;
        _addRechazada(_state.alumUid, _state.temaId + "_" + (_state.tipo || "quiz"), _poolItemId(item));
        _state.pool.splice(_state.poolIdx, 1);
        if (_state.poolIdx >= _state.pool.length) _state.poolIdx = Math.max(0, _state.pool.length - 1);
        _renderAlumnoVista();
    }

    async function _onPublicarAlumno() {
        if (!_state) return;
        // Guard double-click (anti race condition que bypasea el cap)
        if (_state.publicandoEnProgreso) return;
        _state.publicandoEnProgreso = true;
        try {
            return await _doPublicarAlumno();
        } finally {
            _state.publicandoEnProgreso = false;
        }
    }

    async function _doPublicarAlumno() {
        // Cap check con re-fetch de Firestore para evitar stale state
        // (bug detectado smoke: cap state local podia quedar a 0 si el primer
        // publish no termino de propagar antes de un segundo intento).
        await _refreshCaps();
        if (_state.iaPublicadasEnParcial >= 1) {
            if (typeof showToast === "function") showToast("⚠ Ya publicaste tu quiz IA en " + _state.parcial, "warning");
            return;
        }
        // Determinar de dónde sale la idea: del pool reciclado o del batch propio
        let idea, sourcePath, sourceIdeaIdx, esPropio;
        if (_state.batch) {
            // viene del batch propio del alumno
            const lotes = _state.batch.lotes || [];
            const lote = lotes[_state.batch.loteActual || 0] || {};
            const ideas = lote.ideas || [];
            sourceIdeaIdx = _state.batch.indiceActual || 0;
            idea = ideas[sourceIdeaIdx];
            sourcePath = _state.path;
            esPropio = true;
        } else {
            const item = _state.pool[_state.poolIdx];
            if (!item) return;
            idea = item.idea;
            sourcePath = item.batchPath;
            sourceIdeaIdx = item.ideaIdx;
            esPropio = false;
        }

        const tipo = _state.tipo || "quiz";
        const quiz = _buildJuegoCanonico({
            ideaNombre: idea.nombre,
            tipo,
            idea,
            matId: _state.matId,
            temaId: _state.temaId,
            temaTitulo: _state.temaTitulo,
            creadoPor: _state.alumUid,
            estiloIa: _state.estilo || null,
            idPrefix: "ia-alum",
            extras: {
                parcial: _state.parcial,
                recicladoDe: esPropio ? "" : sourcePath.join("/")
            }
        });

        try {
            if (typeof addUserJuego === "function") addUserJuego(quiz);
            document.dispatchEvent(new CustomEvent("xahni:juegoCreado", { detail: { juego: quiz } }));
            // Marca como publicada en el doc origen (afecta visibilidad para otros alumnos)
            // Para shape nuevo necesitamos loteIdx también; en el pool ya viene loteIdx
            const item = _state.pool[_state.poolIdx];
            if (item && !esPropio) {
                // marcar publicada en el doc del owner (puede no permitirse si no es nuestro, pero rules son permisivas)
                try {
                    await IaBatch.markPublicada(sourcePath, sourceIdeaIdx);
                } catch (e) { /* defensive — quiz ya está publicado, esto es solo housekeeping */ }
            } else if (esPropio) {
                await IaBatch.markPublicada(sourcePath, sourceIdeaIdx);
            }
            if (typeof showToast === "function") showToast("✓ Quiz publicado. Aparece en Tab Juegos.", "success");
            _state.iaPublicadasEnParcial++;
            // Quitar la idea publicada del pool local
            if (item) {
                _state.pool.splice(_state.poolIdx, 1);
                if (_state.poolIdx >= _state.pool.length) _state.poolIdx = Math.max(0, _state.pool.length - 1);
            }
            _renderAlumnoVista();
        } catch (e) {
            _toastError(e);
        }
    }

    async function _onGenerarLotePropio() {
        if (!_state) return;
        const body = document.getElementById("modal-generar-juego-body");
        if (body) {
            body.innerHTML = `
                <p class="x-help">Elige el enfoque para tu lote (1 llamada IA, cap 1 por tema):</p>
                <div class="x-temario-ia-estilos">
                    ${ESTILOS.map(e => `
                        <button class="x-temario-ia-estilo-chip"
                                onclick="TemarioIaModal._onEstiloAlumno('${e.id}')">
                            <strong>${e.label}</strong>
                            <span>${e.desc}</span>
                        </button>
                    `).join("")}
                </div>`;
        }
        const foot = document.getElementById("modal-generar-juego-foot");
        if (foot) foot.innerHTML = "";
    }

    async function _onEstiloAlumno(estilo) {
        if (!_state) return;
        _state.estilo = estilo;
        _renderJuegoLoading();
        const tipo = _state.tipo || "quiz";
        const docId = _state.alumUid + "_" + _state.temaId + (tipo !== "quiz" ? ("_" + tipo) : "");
        const path = ["materias", _state.matId, "iaJuegos", docId];
        _state.path = path;
        try {
            const batch = await IaBatch.generate({
                path,
                prompt: _promptJuego(_state.matId, _state.temaTitulo, estilo, tipo),
                responseSchema: _schemaJuegoFor(tipo),
                estilo,
                cap: 1,  // ALUMNO: solo 1 lote propio por tema+tipo
                extraFields: { temaId: _state.temaId, temaTitulo: _state.temaTitulo, tipo }
            });
            _state.batch = batch;
            _renderAlumnoVista();
        } catch (e) {
            if (/cap-reached/.test(String(e && e.message))) {
                if (typeof showToast === "function") showToast("ℹ Ya generaste tu lote IA para este tema.", "info");
                // Cargar el batch existente
                const existing = await IaBatch.getBatch(path);
                if (existing) _state.batch = existing;
                _renderAlumnoVista();
            } else {
                _toastError(e);
                _renderAlumnoVista();
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Entry point desde Tab Juegos (sin tema preseleccionado):
    // muestra picker de tema en-curso/visto del temario antes de
    // continuar al flow IA normal (selector tipo → estilo → generar).
    // ─────────────────────────────────────────────────────────────
    function openSelectorTemaIA(matId, esAlumno) {
        const m = (typeof DEMO_MATERIAS !== "undefined")
            ? DEMO_MATERIAS.find(x => x.id === matId) : null;
        if (!m || !m.temario || !Array.isArray(m.temario.unidades) || m.temario.unidades.length === 0) {
            if (typeof showToast === "function") showToast("Aún no hay temario para esta materia. Pídele al profesor crearlo.", "warning");
            return;
        }
        const temas = [];
        m.temario.unidades.forEach(u => {
            if (u.estado === "en-curso" || u.estado === "visto") {
                temas.push({ id: u.id, titulo: u.titulo, nivel: "unidad" });
            }
            (u.subtemas || []).forEach(s => {
                if (s.estado === "en-curso" || s.estado === "visto" || u.estado === "en-curso" || u.estado === "visto") {
                    temas.push({ id: s.id, titulo: s.titulo, nivel: "subtema" });
                }
            });
        });
        if (temas.length === 0) {
            if (typeof showToast === "function") showToast("No hay temas marcados como En curso o Visto en el temario.", "warning");
            return;
        }
        _state = { _selectingTema: true, matId, esAlumno };
        if (typeof openModal === "function") openModal("modal-generar-juego");
        const body = document.getElementById("modal-generar-juego-body");
        const foot = document.getElementById("modal-generar-juego-foot");
        if (body) {
            body.innerHTML = `
                <p class="x-help">Elige el tema sobre el que quieres generar el juego con IA:</p>
                <div class="x-temario-ia-estilos" style="grid-template-columns:1fr;">
                    ${temas.map(t => `
                        <button class="x-temario-ia-estilo-chip"
                                onclick="TemarioIaModal._onElegirTemaParaIA('${t.id}', this.dataset.titulo)"
                                data-titulo="${_esc(t.titulo)}">
                            <strong>${_esc(t.titulo)}</strong>
                            <span>${t.nivel === "unidad" ? "Unidad" : "Subtema"}</span>
                        </button>
                    `).join("")}
                </div>
            `;
        }
        if (foot) {
            foot.innerHTML = `<button class="x-btn x-btn--ghost" onclick="closeModal('modal-generar-juego')">Cancelar</button>`;
        }
    }

    function _onElegirTemaParaIA(temaId, temaTitulo) {
        if (!_state || !_state._selectingTema) return;
        const matId = _state.matId;
        const esAlumno = _state.esAlumno;
        _state = null;
        // Force-close el modal de selección de tema antes de abrir el siguiente
        const modal = document.getElementById("modal-generar-juego");
        if (modal) modal.classList.remove("active", "closing");
        // Disparar el flow IA completo (que a su vez abre selector de tipo)
        if (esAlumno) {
            openGenerarJuegoAlumno(matId, temaId, temaTitulo);
        } else {
            openGenerarJuego(matId, temaId, temaTitulo);
        }
    }

    return {
        openSugerirTemario,
        openGenerarJuego,
        openGenerarJuegoAlumno,
        openSelectorTemaIA,
        _onEstilo, _onSiguiente, _onAnterior, _onRegenerar, _onAplicar,
        _onEstiloJuego, _onSiguienteJuego, _onAnteriorJuego, _onRegenerarJuego, _onPublicarJuego,
        _onLoteAnterior, _onLoteSiguiente, _onSetLote,
        // Bundle C alumno
        _onDescartarAlumno, _onPublicarAlumno, _onGenerarLotePropio, _onEstiloAlumno,
        _onPoolAnterior, _onPoolSiguiente,
        // Tab Juegos entry point
        _onElegirTemaParaIA
    };
})();
window.TemarioIaModal = TemarioIaModal;
