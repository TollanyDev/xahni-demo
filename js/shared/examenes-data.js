// js/shared/examenes-data.js
// Slice Examenes beta E1 · 2026-06-06 · spec §3.4
//
// API ExamenesData: helpers puros + localStorage + integración mastery
// (DEMO_MAESTRIA) + escala parcial write-only (deuda lectura Supabase).
// Sin DOM. Consumers: examenes-est.js / examenes-prof.js / examenes-tomar.js
// / examenes-calificar.js / examenes-analytics.js / examenes-crear.js.

const ExamenesData = (() => {

    // ── Helpers localStorage ──────────────────────────────────────
    function _readJSON(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) || fallback; }
        catch (e) { return fallback; }
    }
    function _writeJSON(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); }
        catch (e) { console.warn("[ExamenesData] write fail:", key, e); }
    }

    function _getUserCreated() {
        return _readJSON("xahni:examenes:userCreated", []);
    }

    // ── Mergea DEMO + user-created + override estados ──────────────
    function _allExamenes() {
        const seeds = (typeof DEMO_EXAMENES !== "undefined" ? DEMO_EXAMENES : []);
        const userCreated = _getUserCreated();
        const estados = _readJSON("xahni:examenes:estados", {});
        return seeds.concat(userCreated).map(ex => {
            const override = estados[ex.id];
            if (override) {
                return Object.assign({}, ex, {
                    estado: override.estado,
                    abiertoEn: override.abiertoEn || ex.abiertoEn,
                    cerradoEn: override.cerradoEn || ex.cerradoEn
                });
            }
            return ex;
        });
    }

    function _findExamen(exId) {
        return _allExamenes().find(e => e.id === exId);
    }

    // ── Estado derivado ──────────────────────────────────────────
    function derivarEstado(examen) {
        return examen.estado || "borrador";
    }

    // ── Toggle estado profesor ───────────────────────────────────
    /**
     * @interaction examenes-toggle-estado
     * @scope shared-examenes-data-toggle
     *
     * Given exId + nuevoEstado ("borrador" | "abierto" | "cerrado").
     * When profesor click toggle Abrir/Cerrar.
     * Then:
     *   1. Persiste override en xahni:examenes:estados[exId].
     *   2. Si nuevoEstado === "abierto" y no había abiertoEn → setea now().
     *   3. Si nuevoEstado === "cerrado" → setea cerradoEn = now().
     *   4. Emite xahni:examenAbierto o xahni:examenCerrado según corresponda.
     *   5. Si era userCreated, también persiste a userCreated array.
     *   6. Retorna true.
     */
    function toggleEstado(exId, nuevoEstado) {
        const examen = _findExamen(exId);
        if (!examen) return false;
        const estados = _readJSON("xahni:examenes:estados", {});
        const ahora = new Date().toISOString();
        const override = estados[exId] || {};
        override.estado = nuevoEstado;
        if (nuevoEstado === "abierto" && !override.abiertoEn) override.abiertoEn = ahora;
        if (nuevoEstado === "cerrado") override.cerradoEn = ahora;
        estados[exId] = override;
        _writeJSON("xahni:examenes:estados", estados);

        // Persist also to userCreated if applicable
        const userCreated = _getUserCreated();
        const ucIdx = userCreated.findIndex(e => e.id === exId);
        if (ucIdx >= 0) {
            userCreated[ucIdx].estado = nuevoEstado;
            if (override.abiertoEn) userCreated[ucIdx].abiertoEn = override.abiertoEn;
            if (override.cerradoEn) userCreated[ucIdx].cerradoEn = override.cerradoEn;
            _writeJSON("xahni:examenes:userCreated", userCreated);
        }

        // Emit canonical event
        const eventName = nuevoEstado === "abierto" ? "xahni:examenAbierto"
                        : nuevoEstado === "cerrado" ? "xahni:examenCerrado"
                        : null;
        if (eventName) {
            try {
                // Sweep 2026-06-08 Flow 7a smoke: incluir timestamps directos
                // en el detail. El listener de firestore-sync los necesita
                // para persistir abiertoEn / cerradoEn al doc Firestore.
                document.dispatchEvent(new CustomEvent(eventName, {
                    detail: {
                        exId: exId,
                        examen: examen,
                        abiertoEn: override.abiertoEn || null,
                        cerradoEn: override.cerradoEn || null
                    }
                }));
            } catch (e) { /* defensive */ }
        }
        return true;
    }

    // ── Respuestas ───────────────────────────────────────────────
    function getRespuestas(exId, uid) {
        return _readJSON(`xahni:examenes:respuestas:${exId}:${uid}`, null);
    }

    function setRespuestas(exId, uid, respuestasMap) {
        const data = { respuestas: respuestasMap, tomadoEn: new Date().toISOString() };
        _writeJSON(`xahni:examenes:respuestas:${exId}:${uid}`, data);

        try {
            document.dispatchEvent(new CustomEvent("xahni:examenTomado", {
                detail: { exId: exId, uid: uid, respuestas: respuestasMap }
            }));
        } catch (_) { /* defensive */ }

        return data;
    }

    // ── Calificaciones ───────────────────────────────────────────
    function getCalificacion(exId, uid) {
        return _readJSON(`xahni:examenes:calificaciones:${exId}:${uid}`, null);
    }

    function setCalificacionAbierta(exId, uid, pregId, porcentaje, comentario) {
        const calif = getCalificacion(exId, uid) || {
            califFinal: null,
            califParcial: null,
            abiertas: [],
            calificadoEn: null,
            masteryAplicado: 0
        };
        // Remove existing entry if any (allow re-grading)
        calif.abiertas = (calif.abiertas || []).filter(a => a.pregId !== pregId);
        calif.abiertas.push({ pregId, porcentaje, comentario, fecha: new Date().toISOString() });
        _writeJSON(`xahni:examenes:calificaciones:${exId}:${uid}`, calif);
        return calif;
    }

    // ── Cálculo auto multi+match ─────────────────────────────────
    /**
     * @interaction examenes-calcular-calificacion-auto
     * @scope shared-examenes-data-calc-auto
     *
     * Given examen + respuestasMap del alumno.
     * When envío de examen o re-cálculo tras calificación abierta.
     * Then retorna {califParcial, abiertasPendientes}.
     *   califParcial = (Σ scoreAuto / Σ valorTotal) × 10
     *   abiertasPendientes = array de pregIds tipo abierta.
     * Edge:
     *   - Sin respuestas → puntaje 0 para esa pregunta.
     *   - Match: scoreAuto = (paresCorrectos / totalPares) × valor.
     *   - Multi: scoreAuto = valor si correcta, sino 0.
     *   - Abierta: scoreAuto = 0 (se calcula al calificar manual).
     */
    function calcularCalificacionAuto(examen, respuestasMap) {
        respuestasMap = respuestasMap || {};
        let sumScore = 0;
        let sumValor = 0;
        const abiertasPendientes = [];
        (examen.preguntas || []).forEach(p => {
            const valor = p.valor || 1;
            sumValor += valor;
            const respuesta = respuestasMap[p.id];
            if (p.tipo === "multi") {
                if (respuesta === p.correcta) sumScore += valor;
            } else if (p.tipo === "match") {
                if (respuesta && typeof respuesta === "object") {
                    const pares = p.pares || [];
                    let correctos = 0;
                    pares.forEach(par => {
                        if (respuesta[par.a] === par.b) correctos++;
                    });
                    sumScore += (pares.length > 0 ? (correctos / pares.length) * valor : 0);
                }
            } else if (p.tipo === "abierta") {
                abiertasPendientes.push(p.id);
                // scoreAuto = 0 here, se suma en recalcular si profesor ya calificó
            }
        });
        const califParcial = sumValor > 0 ? (sumScore / sumValor) * 10 : 0;
        return {
            califParcial: Math.round(califParcial * 10) / 10,  // 1 decimal
            abiertasPendientes: abiertasPendientes
        };
    }

    // ── Recálculo califFinal incluyendo abiertas calificadas ─────
    function recalcularCalificacionFinal(exId, uid) {
        const examen = _findExamen(exId);
        if (!examen) return null;
        const respuestasData = getRespuestas(exId, uid);
        if (!respuestasData) return null;
        const calif = getCalificacion(exId, uid) || { abiertas: [] };

        let sumScore = 0;
        let sumValor = 0;
        let totalAbiertas = 0;
        let abiertasCalificadas = 0;
        (examen.preguntas || []).forEach(p => {
            const valor = p.valor || 1;
            sumValor += valor;
            const respuesta = respuestasData.respuestas[p.id];
            if (p.tipo === "multi") {
                if (respuesta === p.correcta) sumScore += valor;
            } else if (p.tipo === "match") {
                if (respuesta && typeof respuesta === "object") {
                    const pares = p.pares || [];
                    let correctos = 0;
                    pares.forEach(par => {
                        if (respuesta[par.a] === par.b) correctos++;
                    });
                    sumScore += (pares.length > 0 ? (correctos / pares.length) * valor : 0);
                }
            } else if (p.tipo === "abierta") {
                totalAbiertas++;
                const calAbierta = (calif.abiertas || []).find(a => a.pregId === p.id);
                if (calAbierta) {
                    abiertasCalificadas++;
                    sumScore += (calAbierta.porcentaje / 100) * valor;
                }
            }
        });

        const calificacion = sumValor > 0 ? (sumScore / sumValor) * 10 : 0;
        const todasAbiertasCalificadas = totalAbiertas === abiertasCalificadas;

        calif.califParcial = Math.round(calificacion * 10) / 10;
        calif.califFinal = todasAbiertasCalificadas ? calif.califParcial : null;

        if (todasAbiertasCalificadas && !calif.calificadoEn) {
            calif.calificadoEn = new Date().toISOString();
        }

        _writeJSON(`xahni:examenes:calificaciones:${exId}:${uid}`, calif);

        // Bug 2026-06-09: el JSDoc decía que aplicarMastery y aplicarARubroParcial
        // se invocaban al detectar todasAbiertasCalificadas, pero el código nunca
        // los llamaba. Resultado: estudiante@utc.mx tenía 3 exámenes con
        // califFinal completa (9, 9, 10) pero masteryAplicado:false en los 3,
        // y la escala parcial tampoco se alimentaba. Fix: invocar ambos helpers
        // aquí cuando la calif está completa Y el mastery aún no se aplicó
        // (idempotencia por flag).
        let masteryGanado = null;
        if (todasAbiertasCalificadas && !calif.masteryAplicado) {
            try {
                masteryGanado = aplicarMastery(uid, examen, calif.califFinal) || null;
            } catch (e) { console.warn("[examenes-data] aplicarMastery fail", exId, e); }
            try {
                aplicarARubroParcial(uid, examen, calif.califFinal);
            } catch (e) { console.warn("[examenes-data] aplicarARubroParcial fail", exId, e); }
        }

        // Emit canonical event cuando la calificación final está completa
        // (todas las abiertas calificadas).
        if (todasAbiertasCalificadas) {
            try {
                document.dispatchEvent(new CustomEvent("xahni:examenCalificado", {
                    detail: {
                        exId: exId,
                        uid: uid,
                        califFinal: calif.califFinal,
                        califParcial: calif.califParcial,
                        abiertas: calif.abiertas || [],
                        masteryGanado: masteryGanado || calif.masteryAplicado || null
                    }
                }));
            } catch (_) { /* defensive */ }
        }

        return calif;
    }

    // ── Mastery ──────────────────────────────────────────────────
    function calcularMasteryGanado(examen, califFinal) {
        const masteryMax = examen.masteryMax || 80;
        return Math.floor(masteryMax * (califFinal / 10));
    }

    /**
     * @interaction examenes-aplicar-mastery
     * @scope shared-examenes-data-mastery
     *
     * Given uid + examen + califFinal.
     * When recalcularCalificacionFinal detecta que califFinal != null Y
     *   masteryAplicado === 0 (no se aplicó antes).
     * Then:
     *   1. Calcula masteryGanado.
     *   2. Inicializa DEMO_MAESTRIA[uid][matId] si no existe.
     *   3. Suma points y push entry a tokensTimeline.
     *   4. Persiste masteryAplicado en la calificación (idempotente).
     *   5. Emite xahni:maestriaActualizada.
     * Edge:
     *   - DEMO_MAESTRIA undefined → no-op defensivo.
     *   - Re-aplicar para mismo (exId, uid): no-op (idempotente).
     */
    function aplicarMastery(uid, examen, califFinal) {
        if (typeof DEMO_MAESTRIA !== "object") return 0;
        const calif = getCalificacion(examen.id, uid);
        if (calif && calif.masteryAplicado) return 0; // idempotente

        const masteryGanado = calcularMasteryGanado(examen, califFinal);
        if (!DEMO_MAESTRIA[uid]) DEMO_MAESTRIA[uid] = {};
        if (!DEMO_MAESTRIA[uid][examen.materiaId]) {
            DEMO_MAESTRIA[uid][examen.materiaId] = {
                points: 0,
                nivel: 1,
                tokensGanados: [],
                cosmeticsDesbloqueados: [],
                promedioCuatri: null,
                tareasPendientes: 0,
                tokensTimeline: []
            };
        }
        const entry = DEMO_MAESTRIA[uid][examen.materiaId];
        entry.points += masteryGanado;
        entry.tokensTimeline = entry.tokensTimeline || [];
        entry.tokensTimeline.unshift({
            type: "examen",
            id: examen.id,
            when: new Date().toISOString(),
            label: `+${masteryGanado} mastery por "${examen.nombre}" (${califFinal.toFixed(1)}/10)`
        });

        // Mark aplicado
        if (calif) {
            calif.masteryAplicado = masteryGanado;
            _writeJSON(`xahni:examenes:calificaciones:${examen.id}:${uid}`, calif);
        }

        try {
            document.dispatchEvent(new CustomEvent("xahni:maestriaActualizada", {
                detail: { uid: uid, materiaId: examen.materiaId, ganado: masteryGanado, total: entry.points }
            }));
        } catch (e) { /* defensive */ }

        return masteryGanado;
    }

    // ── Escala parcial (WRITE-ONLY en vanilla — deuda lectura Supabase) ──
    /**
     * @interaction examenes-aplicar-rubro-parcial
     * @scope shared-examenes-data-escala
     *
     * Given uid + examen + califFinal.
     * When recalcularCalificacionFinal detecta calif completa.
     * Then:
     *   1. Persiste en xahni:examenes:notaRubro:{uid}:{matId}:{parcial}:{rubroId}
     *      el promedio de calificaciones de examenes que alimentan ese rubro.
     *   2. Si hay múltiples examenes en mismo parcial → promedio simple.
     * Edge:
     *   - DEMO_ESCALAS undefined → no-op.
     *   - No hay rubro tipo "examen" en la escala del parcial → no-op (no es error).
     *   - examen.parcial inválido → no-op.
     */
    function aplicarARubroParcial(uid, examen, califFinal) {
        if (typeof DEMO_ESCALAS === "undefined") return false;
        const parcialNum = examen.parcial === "P1" ? 1 : examen.parcial === "P2" ? 2 : 3;
        const escala = (DEMO_ESCALAS || []).find(e =>
            e.materiaId === examen.materiaId && e.parcialNum === parcialNum
        );
        if (!escala) return false;
        const rubroExamen = (escala.criterios || []).find(c => c.tipo === "examen");
        if (!rubroExamen) return false;

        // Find all examenes finalizados in same parcial alimentando este rubro
        const todosExamenes = _allExamenes()
            .filter(e => e.materiaId === examen.materiaId && e.parcial === examen.parcial);
        const califs = todosExamenes.map(e => {
            const c = getCalificacion(e.id, uid);
            return c && c.califFinal !== null ? c.califFinal : null;
        }).filter(v => v !== null);

        if (califs.length === 0) return false;
        const promedio = califs.reduce((s, v) => s + v, 0) / califs.length;

        const key = `xahni:examenes:notaRubro:${uid}:${examen.materiaId}:${examen.parcial}:${rubroExamen.id}`;
        const payload = {
            promedio: Math.round(promedio * 10) / 10,
            examenesCount: califs.length,
            actualizadoEn: new Date().toISOString()
        };
        _writeJSON(key, payload);
        // Sweep 2026-06-08: dispatch para que firestore-sync persista la nota
        // del rubro cross-device. Alimenta cálculo de calificación parcial leído
        // por calificaciones-calc._calRatio en ambos roles.
        try {
            document.dispatchEvent(new CustomEvent("xahni:notaRubroActualizada", {
                detail: {
                    uid,
                    matId: examen.materiaId,
                    parcial: examen.parcial,
                    rubroId: rubroExamen.id,
                    payload
                }
            }));
        } catch (_) { /* defensive */ }
        return true;
    }

    // ── Listados ─────────────────────────────────────────────────
    function listarExamenesPorTomar(uid, materiaId) {
        return _allExamenes().filter(e => {
            if (materiaId && e.materiaId !== materiaId) return false;
            if (derivarEstado(e) !== "abierto") return false;
            return getRespuestas(e.id, uid) === null;
        });
    }

    function listarExamenesPasados(uid, materiaId) {
        return _allExamenes().filter(e => {
            if (materiaId && e.materiaId !== materiaId) return false;
            return getRespuestas(e.id, uid) !== null;
        });
    }

    function listarMisExamenes(uid, materiaId) {
        return _allExamenes().filter(e => {
            if (e.creadoPor !== uid) return false;
            if (materiaId && e.materiaId !== materiaId) return false;
            return true;
        });
    }

    function listarPendientesCalificar(uid, materiaId) {
        const mis = listarMisExamenes(uid, materiaId);
        return mis.filter(ex => {
            // Para cada alumno con respuestas, ¿tiene abiertas sin calificar?
            const abiertasIds = (ex.preguntas || [])
                .filter(p => p.tipo === "abierta").map(p => p.id);
            if (abiertasIds.length === 0) return false;
            // Lookup respuestas de cualquier alumno
            const users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []);
            return users.some(u => {
                if (u.tipo !== "estudiante") return false;
                const resp = getRespuestas(ex.id, u.id);
                if (!resp) return false;
                const calif = getCalificacion(ex.id, u.id) || { abiertas: [] };
                const calificadas = (calif.abiertas || []).map(a => a.pregId);
                return abiertasIds.some(aid => !calificadas.includes(aid));
            });
        });
    }

    // ── Stats hero profesor ──────────────────────────────────────
    function statsHeroProfesor(uid, materiaId) {
        const mis = listarMisExamenes(uid, materiaId);
        const users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : [])
            .filter(u => u.tipo === "estudiante");
        let respuestasRecibidas = 0;
        let masteryDistribuida = 0;
        mis.forEach(ex => {
            users.forEach(u => {
                const resp = getRespuestas(ex.id, u.id);
                if (resp) respuestasRecibidas++;
                const calif = getCalificacion(ex.id, u.id);
                if (calif && calif.masteryAplicado) {
                    masteryDistribuida += calif.masteryAplicado;
                }
            });
        });
        return {
            creados: mis.length,
            respuestasRecibidas: respuestasRecibidas,
            pendientes: listarPendientesCalificar(uid, materiaId).length,
            masteryDistribuida: masteryDistribuida
        };
    }

    // ── Analytics ────────────────────────────────────────────────
    function analyticsPregunta(examen, pregId) {
        const pregunta = (examen.preguntas || []).find(p => p.id === pregId);
        if (!pregunta) return null;
        const users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : [])
            .filter(u => u.tipo === "estudiante");
        let totalRespuestas = 0;
        let aciertos = 0;
        const distribucion = {};
        users.forEach(u => {
            const resp = getRespuestas(examen.id, u.id);
            if (!resp || !resp.respuestas) return;
            const r = resp.respuestas[pregId];
            if (r === undefined) return;
            totalRespuestas++;
            if (pregunta.tipo === "multi") {
                distribucion[r] = (distribucion[r] || 0) + 1;
                if (r === pregunta.correcta) aciertos++;
            } else if (pregunta.tipo === "match" && typeof r === "object") {
                let correctos = 0;
                (pregunta.pares || []).forEach(par => {
                    if (r[par.a] === par.b) correctos++;
                });
                const ratio = (pregunta.pares || []).length > 0
                    ? correctos / pregunta.pares.length : 0;
                distribucion[Math.floor(ratio * 10)] = (distribucion[Math.floor(ratio * 10)] || 0) + 1;
                if (ratio === 1) aciertos++;
            } else if (pregunta.tipo === "abierta") {
                const calif = getCalificacion(examen.id, u.id);
                const calAbierta = (calif && calif.abiertas || []).find(a => a.pregId === pregId);
                if (calAbierta) {
                    const bucket = Math.floor(calAbierta.porcentaje / 20) * 20;
                    distribucion[bucket] = (distribucion[bucket] || 0) + 1;
                    if (calAbierta.porcentaje >= 60) aciertos++;
                }
            }
        });
        const aciertoPct = totalRespuestas > 0 ? Math.round(aciertos / totalRespuestas * 100) : 0;
        return {
            totalRespuestas: totalRespuestas,
            aciertos: aciertos,
            aciertoPct: aciertoPct,
            distribucion: distribucion
        };
    }

    function analyticsAlumno(examen, uid) {
        const resp = getRespuestas(examen.id, uid);
        const calif = getCalificacion(examen.id, uid);
        return {
            respuestas: resp ? resp.respuestas : null,
            tomadoEn: resp ? resp.tomadoEn : null,
            calificacion: calif
        };
    }

    function _grupoIdDeUser(uid) {
        const users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []);
        const u = users.find(x => x.id === uid);
        return (u?.grupos || [])[0] || null;
    }

    function eliminarBorrador(exId) {
        const examen = _findExamen(exId);
        if (!examen || examen.estado !== "borrador") return false;
        const userCreated = _getUserCreated();
        const idx = userCreated.findIndex(e => e.id === exId);
        if (idx < 0) return false;
        userCreated.splice(idx, 1);
        _writeJSON("xahni:examenes:userCreated", userCreated);
        return true;
    }

    // ── Public API ────────────────────────────────────────────────
    return {
        derivarEstado: derivarEstado,
        toggleEstado: toggleEstado,
        getRespuestas: getRespuestas,
        setRespuestas: setRespuestas,
        getCalificacion: getCalificacion,
        setCalificacionAbierta: setCalificacionAbierta,
        calcularCalificacionAuto: calcularCalificacionAuto,
        recalcularCalificacionFinal: recalcularCalificacionFinal,
        calcularMasteryGanado: calcularMasteryGanado,
        aplicarMastery: aplicarMastery,
        aplicarARubroParcial: aplicarARubroParcial,
        listarExamenesPorTomar: listarExamenesPorTomar,
        listarExamenesPasados: listarExamenesPasados,
        listarMisExamenes: listarMisExamenes,
        listarPendientesCalificar: listarPendientesCalificar,
        statsHeroProfesor: statsHeroProfesor,
        analyticsPregunta: analyticsPregunta,
        analyticsAlumno: analyticsAlumno,
        eliminarBorrador: eliminarBorrador,
        _allExamenes: _allExamenes,
        _grupoIdDeUser: _grupoIdDeUser
    };
})();
window.ExamenesData = ExamenesData;
