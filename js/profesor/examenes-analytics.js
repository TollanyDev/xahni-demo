// js/profesor/examenes-analytics.js
// Slice Examenes beta E7 · 2026-06-06 · spec §8.4
//
// Modal analytics con 2 tabs (profesor) o detalle único (estudiante):
// - Tab "Por pregunta": % acierto + distribución bars (multi options /
//   match buckets / abierta scores)
// - Tab "Por alumno": ranking + drilldown con todas respuestas + score
// - Estudiante: ve solo su propio detalle

const AnalyticsExamen = (() => {

    let _state = null;

    function _esc(s) {
        return (s || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function abrir(exId, opts) {
        opts = opts || {};
        if (typeof ExamenesData === "undefined") return;
        const examen = ExamenesData._allExamenes().find(e => e.id === exId);
        if (!examen) return;

        const contexto = opts.contexto || (APP?.user?.tipo === "estudiante" ? "estudiante" : "profesor");
        _state = {
            examen: examen,
            contexto: contexto,
            tabActivo: opts.tab || (contexto === "estudiante" ? "alumno-self" : "pregunta"),
            drilldownUid: contexto === "estudiante" ? (APP?.user?.id) : null
        };

        const matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
            .find(m => m.id === examen.materiaId)?.nombre || examen.materiaId;
        const eyebrowEl = document.getElementById("ana-eyebrow");
        if (eyebrowEl) eyebrowEl.textContent = `📊 ${matNom} · ${examen.parcial}`;
        const titEl = document.getElementById("ana-titulo");
        if (titEl) titEl.textContent = `Analytics: ${examen.nombre}`;
        const subEl = document.getElementById("ana-subtitle");
        if (subEl) {
            const total = _countAlumnosRespondieron(examen);
            const N = (examen.preguntas || []).length;
            subEl.textContent = `${total} alumnos respondieron · ${N} preguntas`;
        }

        _renderTabs();
        _render();
        if (typeof openModal === "function") openModal("modal-analytics-examen");
    }

    function _countAlumnosRespondieron(examen) {
        const users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []).filter(u => u.tipo === "estudiante");
        return users.filter(u => ExamenesData.getRespuestas(examen.id, u.id) !== null).length;
    }

    function _renderTabs() {
        const tabsEl = document.getElementById("ana-tabs");
        if (!tabsEl) return;
        if (_state.contexto === "estudiante") {
            tabsEl.innerHTML = "";  // sin tabs
            return;
        }
        tabsEl.innerHTML = `
            <div class="ana-tab${_state.tabActivo === 'pregunta' ? ' ana-tab--active' : ''}"
                 onclick="AnalyticsExamen.switchTab('pregunta')">Por pregunta</div>
            <div class="ana-tab${_state.tabActivo === 'alumno' ? ' ana-tab--active' : ''}"
                 onclick="AnalyticsExamen.switchTab('alumno')">Por alumno</div>
        `;
    }

    function _render() {
        const bodyEl = document.getElementById("ana-body");
        if (!bodyEl) return;

        if (_state.contexto === "estudiante" || _state.drilldownUid) {
            // Drilldown — para estudiante: su propio uid · para profesor: alumno seleccionado
            _renderDrilldown(bodyEl);
            return;
        }

        if (_state.tabActivo === "pregunta") {
            _renderTabPregunta(bodyEl);
        } else {
            _renderTabAlumno(bodyEl);
        }
    }

    function _renderTabPregunta(bodyEl) {
        const examen = _state.examen;
        const preguntas = examen.preguntas || [];
        bodyEl.innerHTML = preguntas.map((p, idx) => {
            const analytics = ExamenesData.analyticsPregunta(examen, p.id);
            return _renderPreguntaAnalyticsCard(p, idx, analytics);
        }).join("");
    }

    function _renderPreguntaAnalyticsCard(preg, idx, analytics) {
        const aciertoPct = analytics?.aciertoPct ?? 0;
        const totalRespuestas = analytics?.totalRespuestas ?? 0;
        const aciertoClass = aciertoPct >= 70 ? "ana-pregunta-card__acierto--ok"
                           : aciertoPct >= 40 ? "ana-pregunta-card__acierto--warn"
                           : "ana-pregunta-card__acierto--danger";
        const tipoLabel = preg.tipo === "multi" ? "Opción múltiple"
                        : preg.tipo === "abierta" ? "Respuesta abierta"
                        : "Concepto ↔ Definición";

        let distHtml = "";
        if (totalRespuestas > 0) {
            if (preg.tipo === "multi") {
                distHtml = (preg.opciones || []).map((opt, j) => {
                    const count = (analytics.distribucion || {})[j] || 0;
                    const pct = totalRespuestas > 0 ? (count / totalRespuestas) * 100 : 0;
                    const esCorrecta = preg.correcta === j;
                    return `
                        <div class="ana-dist-row">
                            <div class="ana-dist-row__label${esCorrecta ? ' ana-dist-row__label--correcta' : ''}">${String.fromCharCode(65 + j)}: ${_esc(opt)}${esCorrecta ? ' ✓' : ''}</div>
                            <div class="ana-dist-row__bar">
                                <div class="ana-dist-row__bar-fill${esCorrecta ? ' ana-dist-row__bar-fill--correcta' : ''}" style="width:${pct}%"></div>
                            </div>
                            <div class="ana-dist-row__count">${count}</div>
                        </div>
                    `;
                }).join("");
            } else if (preg.tipo === "match") {
                const buckets = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
                const total = preg.pares?.length || 1;
                distHtml = buckets.map(b => {
                    const count = (analytics.distribucion || {})[b] || 0;
                    if (count === 0) return "";
                    const pct = totalRespuestas > 0 ? (count / totalRespuestas) * 100 : 0;
                    const label = `${b}/${total * 10 / 10} ratio`;
                    return `
                        <div class="ana-dist-row">
                            <div class="ana-dist-row__label">${Math.round(b * 10)}% pares correctos</div>
                            <div class="ana-dist-row__bar">
                                <div class="ana-dist-row__bar-fill" style="width:${pct}%"></div>
                            </div>
                            <div class="ana-dist-row__count">${count}</div>
                        </div>
                    `;
                }).filter(s => s).join("") || `<div style="color:var(--text-muted);font-size:12px">Sin distribución todavía</div>`;
            } else if (preg.tipo === "abierta") {
                const buckets = [0, 20, 40, 60, 80, 100];
                distHtml = buckets.map((b, i) => {
                    const count = (analytics.distribucion || {})[b] || 0;
                    if (count === 0) return "";
                    const pct = totalRespuestas > 0 ? (count / totalRespuestas) * 100 : 0;
                    const next = buckets[i + 1] || 101;
                    return `
                        <div class="ana-dist-row">
                            <div class="ana-dist-row__label">${b}-${next - 1}%</div>
                            <div class="ana-dist-row__bar">
                                <div class="ana-dist-row__bar-fill" style="width:${pct}%"></div>
                            </div>
                            <div class="ana-dist-row__count">${count}</div>
                        </div>
                    `;
                }).filter(s => s).join("") || `<div style="color:var(--text-muted);font-size:12px">Sin calificaciones todavía</div>`;
            }
        } else {
            distHtml = `<div style="color:var(--text-muted);font-size:12px;padding:8px">Sin respuestas todavía</div>`;
        }

        return `
            <div class="ana-pregunta-card">
                <div class="ana-pregunta-card__head">
                    <div>
                        <div class="ana-pregunta-card__num">Pregunta ${idx + 1} · ${tipoLabel} · ${preg.valor || 1} pts</div>
                    </div>
                    <div class="ana-pregunta-card__acierto ${aciertoClass}">${aciertoPct}% acierto (${totalRespuestas} resp.)</div>
                </div>
                <div class="ana-pregunta-card__texto">"${_esc(preg.texto)}"</div>
                ${distHtml}
            </div>
        `;
    }

    function _renderTabAlumno(bodyEl) {
        const examen = _state.examen;
        const users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []).filter(u => u.tipo === "estudiante");
        const rows = users.map(u => {
            const calif = ExamenesData.getCalificacion(examen.id, u.id);
            const resp = ExamenesData.getRespuestas(examen.id, u.id);
            if (!resp) return null;
            return {
                uid: u.id,
                nombre: u.nombre || u.id,
                califFinal: calif?.califFinal,
                califParcial: calif?.califParcial,
                masteryAplicado: calif?.masteryAplicado || 0
            };
        }).filter(r => r !== null);

        // Sort por califFinal (calificados primero, parcial después, sin nota al final)
        rows.sort((a, b) => {
            const aS = a.califFinal !== null && a.califFinal !== undefined ? a.califFinal : -1;
            const bS = b.califFinal !== null && b.califFinal !== undefined ? b.califFinal : -1;
            return bS - aS;
        });

        if (rows.length === 0) {
            bodyEl.innerHTML = `<div class="ana-empty">Sin respuestas recibidas todavía</div>`;
            return;
        }

        bodyEl.innerHTML = rows.map((r, i) => {
            const califStr = r.califFinal !== null && r.califFinal !== undefined
                ? `${r.califFinal.toFixed(1)}/10`
                : (r.califParcial !== null && r.califParcial !== undefined
                    ? `${r.califParcial.toFixed(1)}/10 (parcial)`
                    : "—");
            return `
                <div class="ana-alumno-row" onclick="AnalyticsExamen.drilldownAlumno('${r.uid}')">
                    <div class="ana-alumno-row__pos">${i + 1}°</div>
                    <div class="ana-alumno-row__nombre">${_esc(r.nombre)}</div>
                    <div class="ana-alumno-row__calif">${califStr}</div>
                    <div class="ana-alumno-row__mastery">+${r.masteryAplicado} mastery</div>
                </div>
            `;
        }).join("");
    }

    function _renderDrilldown(bodyEl) {
        const examen = _state.examen;
        const uid = _state.drilldownUid;
        const user = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []).find(u => u.id === uid);
        const detalle = ExamenesData.analyticsAlumno(examen, uid);

        if (!detalle.respuestas) {
            bodyEl.innerHTML = `<div class="ana-empty">No hay respuestas registradas para este alumno</div>`;
            return;
        }

        const calif = detalle.calificacion || {};
        const calificadasAbiertas = (calif.abiertas || []);

        const preguntasHtml = (examen.preguntas || []).map((p, i) => {
            const resp = detalle.respuestas[p.id];
            let respDisplay = "—";
            let scoreInfo = "";
            if (p.tipo === "multi") {
                if (typeof resp === "number") {
                    const opt = (p.opciones || [])[resp] || "—";
                    const ok = resp === p.correcta;
                    respDisplay = `${String.fromCharCode(65 + resp)}: ${_esc(opt)} ${ok ? '✓' : '✗'}`;
                    scoreInfo = `Score: ${ok ? (p.valor || 1) : 0}/${p.valor || 1} pts`;
                }
            } else if (p.tipo === "abierta") {
                respDisplay = (typeof resp === "string") ? resp : "—";
                const calA = calificadasAbiertas.find(a => a.pregId === p.id);
                if (calA) {
                    scoreInfo = `Profesor: ${calA.porcentaje}% · Score: ${((calA.porcentaje / 100) * (p.valor || 1)).toFixed(2)}/${p.valor || 1} pts${calA.comentario ? ' · "' + _esc(calA.comentario) + '"' : ''}`;
                } else {
                    scoreInfo = `⏳ Pendiente de calificación por profesor`;
                }
            } else if (p.tipo === "match") {
                if (resp && typeof resp === "object") {
                    const pares = p.pares || [];
                    let correctos = 0;
                    const lineas = pares.map(par => {
                        const sel = resp[par.a] || "—";
                        const ok = sel === par.b;
                        if (ok) correctos++;
                        return `${_esc(par.a)} → ${_esc(sel)} ${ok ? '✓' : '✗'}`;
                    });
                    respDisplay = lineas.join("\n");
                    const ratio = pares.length > 0 ? correctos / pares.length : 0;
                    scoreInfo = `Score: ${(ratio * (p.valor || 1)).toFixed(2)}/${p.valor || 1} pts (${correctos}/${pares.length} correctos)`;
                }
            }

            return `
                <div class="ana-drilldown__pregunta">
                    <div class="ana-drilldown__preg-texto">P${i + 1} (${p.valor || 1} pts): "${_esc(p.texto)}"</div>
                    <div class="ana-drilldown__resp">${respDisplay}</div>
                    ${scoreInfo ? `<div class="ana-drilldown__score">${scoreInfo}</div>` : ''}
                </div>
            `;
        }).join("");

        const califStr = calif.califFinal !== null && calif.califFinal !== undefined
            ? `${calif.califFinal.toFixed(1)}/10 · +${calif.masteryAplicado || 0} mastery`
            : (calif.califParcial !== null && calif.califParcial !== undefined
                ? `${calif.califParcial.toFixed(1)}/10 (parcial) · esperando abiertas`
                : "Sin calificar");

        const backBtn = (_state.contexto === "profesor")
            ? `<button class="ana-drilldown__back" onclick="AnalyticsExamen.cerrarDrilldown()">← Volver al ranking</button>`
            : "";

        bodyEl.innerHTML = `
            <div class="ana-drilldown">
                <div class="ana-drilldown__head">
                    <div>
                        <div class="ana-drilldown__nombre">${_esc(user?.nombre || uid)}</div>
                        <div style="font-size:12px;color:var(--accent-cyan-text);font-weight:600;margin-top:4px">${califStr}</div>
                    </div>
                    ${backBtn}
                </div>
                ${preguntasHtml}
            </div>
        `;
    }

    function switchTab(tab) {
        if (!_state) return;
        if (tab !== "pregunta" && tab !== "alumno") return;
        _state.tabActivo = tab;
        _state.drilldownUid = null;
        _renderTabs();
        _render();
    }

    function drilldownAlumno(uid) {
        if (!_state) return;
        _state.drilldownUid = uid;
        _render();
    }

    function cerrarDrilldown() {
        if (!_state || _state.contexto === "estudiante") return;
        _state.drilldownUid = null;
        _render();
    }

    function cerrar() {
        if (typeof closeModal === "function") closeModal("modal-analytics-examen");
        _state = null;
    }

    return {
        abrir, cerrar,
        switchTab, drilldownAlumno, cerrarDrilldown
    };
})();
window.AnalyticsExamen = AnalyticsExamen;
