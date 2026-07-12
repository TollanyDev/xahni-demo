// js/shared/competencias-data.js
// Slice Competencias beta C1 · 2026-06-06 · spec §3.4
//
// API CompetenciasData: helpers puros sobre DEMO_COMPETENCIAS +
// persistencia localStorage de attempts/cerrados/userCreatedTorneos.
// Sin DOM — solo data layer. Consumers: competencias-cierre.js,
// renderers competencias.js (alumno/profesor), modales.

const CompetenciasData = (() => {

    // ── Constantes ────────────────────────────────────────────────
    const MAX_ATTEMPTS = 3;
    const XP_POR_LUGAR = { 1: 200, 2: 100, 3: 50 }; // fallback 25 para resto
    const XP_PASIVO_BASE = 10; // pts × participantes × multiplicadorLugar
    const MULT_LUGAR = { 1: 1.5, 2: 1.0, 3: 0.7 };  // fallback 0.5 para resto

    // ── Helpers localStorage ──────────────────────────────────────
    function _readJSON(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) || fallback; }
        catch (e) { return fallback; }
    }
    function _writeJSON(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); }
        catch (e) { console.warn("[CompetenciasData] write fail:", key, e); }
    }

    // ── Acceso a torneos creados por user ─────────────────────────
    function _getUserCreatedTorneos() {
        return _readJSON("xahni:comp:userCreatedTorneos", []);
    }

    // ── Mergea DEMO + user-created en runtime ─────────────────────
    function _allTorneos() {
        const seeds = (typeof DEMO_COMPETENCIAS !== "undefined" ? DEMO_COMPETENCIAS : []);
        const userCreated = _getUserCreatedTorneos();
        // Dedup por id: seeds (Firestore/hydrate) tienen prioridad — traen estado
        // más fresco. userCreated solo aporta torneos que aún no llegaron a Firestore
        // o que el hydrate no devolvió. Misma estrategia que TorneosIntraData.getAll().
        const seedIds = new Set(seeds.map(c => c.id));
        const merged = seeds.concat(userCreated.filter(c => !seedIds.has(c.id)));
        // Aplica overrides de cerrados
        const cerrados = _readJSON("xahni:comp:cerrados", {});
        return merged.map(c => {
            if (cerrados[c.id]) {
                return Object.assign({}, c, { cerradoEn: cerrados[c.id] });
            }
            return c;
        });
    }

    // ── Estado derivado de fechas + cerradoEn ─────────────────────
    /**
     * @interaction comp-derivar-estado
     * @scope shared-competencias-data-state
     *
     * Given comp con fechaInicio + fechaFin + cerradoEn.
     * When renderers o cierre.js necesitan estado actual.
     * Then retorna "proxima" | "activa" | "finalizada".
     * Edge:
     *   - cerradoEn !== null → siempre "finalizada".
     *   - now >= fechaFin → "finalizada" (auto-cierre lazy).
     *   - now < fechaInicio → "proxima".
     *   - else → "activa".
     */
    function derivarEstado(comp, now) {
        now = now || new Date();
        // Bundle C fix 2026-06-09: leer ambos cerradoEn (canonical) y cerradaEn
        // (legacy alias del wrapper firestore-sync) para que cierres cross-device
        // se detecten correctamente sin importar cuál campo trajo el snapshot.
        if (comp.cerradoEn || comp.cerradaEn) return "finalizada";
        // Tambien chequear estado explicito (el wrapper lo seteo a 'finalizada')
        if (comp.estado === "finalizada") return "finalizada";
        const ini = new Date(comp.fechaInicio);
        const fin = new Date(comp.fechaFin);
        if (now < ini) return "proxima";
        if (now >= fin) return "finalizada";
        return "activa";
    }

    // ── Attempts ──────────────────────────────────────────────────
    function getAttempts(compId, uid) {
        return _readJSON(`xahni:comp:attempts:${compId}:${uid}`, []);
    }

    function registrarAttempt(compId, uid, score) {
        const attempts = getAttempts(compId, uid);
        if (attempts.length >= MAX_ATTEMPTS) return false;
        const isFirstAttempt = attempts.length === 0;
        const attemptN = attempts.length + 1;
        attempts.push({
            score: score,
            fecha: new Date().toISOString(),
            intento: attemptN
        });
        _writeJSON(`xahni:comp:attempts:${compId}:${uid}`, attempts);
        // Emit inscripcion event on first attempt (effective enrollment)
        if (isFirstAttempt) {
            try {
                document.dispatchEvent(new CustomEvent("xahni:torneoInscripcion", {
                    detail: { compId: compId, uid: uid }
                }));
            } catch (_) { /* defensive */ }
        }
        // Emit attempt event every time
        try {
            document.dispatchEvent(new CustomEvent("xahni:torneoIntento", {
                detail: { compId: compId, uid: uid, attemptN: attemptN, score: score }
            }));
        } catch (_) { /* defensive */ }
        return true;
    }

    function getMejorScore(compId, uid) {
        const attempts = getAttempts(compId, uid);
        if (attempts.length === 0) return null;
        return Math.max.apply(null, attempts.map(a => a.score));
    }

    // ── Score grupo + ranking ─────────────────────────────────────
    function _alumnosDeGrupo(grupoId) {
        const grupos = (typeof DEMO_GRUPOS !== "undefined" ? DEMO_GRUPOS : []);
        const grupo = grupos.find(g => g.id === grupoId);
        return grupo?.miembros || [];
    }

    function calcularScoreGrupo(comp, grupoId) {
        const alumnos = _alumnosDeGrupo(grupoId);
        let total = 0;
        let count = 0;
        alumnos.forEach(uid => {
            const best = getMejorScore(comp.id, uid);
            if (best !== null) {
                total += best;
                count++;
            }
        });
        return { puntaje: total, participantes: count };
    }

    function calcularRanking(comp) {
        const rows = (comp.gruposInscritos || []).map(grupoId => {
            const s = calcularScoreGrupo(comp, grupoId);
            return { grupoId: grupoId, puntaje: s.puntaje, participantes: s.participantes };
        });
        // Sort: puntaje desc, tiebreak participantes desc (§D-C15)
        rows.sort((a, b) => {
            if (b.puntaje !== a.puntaje) return b.puntaje - a.puntaje;
            return b.participantes - a.participantes;
        });
        // Asignar lugar — ties comparten lugar, siguiente saltea
        let prevPuntaje = null, prevPartic = null, prevLugar = 0;
        rows.forEach((r, idx) => {
            if (r.puntaje === prevPuntaje && r.participantes === prevPartic) {
                r.lugar = prevLugar;
            } else {
                r.lugar = idx + 1;
                prevLugar = r.lugar;
                prevPuntaje = r.puntaje;
                prevPartic = r.participantes;
            }
        });
        return rows;
    }

    // ── XP ────────────────────────────────────────────────────────
    function xpPorLugar(lugar) {
        return XP_POR_LUGAR[lugar] !== undefined ? XP_POR_LUGAR[lugar] : 25;
    }

    function _multLugar(lugar) {
        return MULT_LUGAR[lugar] !== undefined ? MULT_LUGAR[lugar] : 0.5;
    }

    // ── Cierre torneo (distribuye XP) ─────────────────────────────
    /**
     * @interaction comp-cerrar-torneo
     * @scope shared-competencias-data-cierre
     *
     * Given compId + modo ("auto" | "manual").
     * When fechaFin pasada (auto) o profesor click "Cerrar antes" (manual).
     * Then:
     *   1. No-op si ya cerrado.
     *   2. Calcula ranking + persiste resultados.
     *   3. Distribuye XP por lugar a cada alumno con attempts.
     *   4. Distribuye XP pasivo al creador profesor.
     *   5. Persiste cerradoEn + emit xahni:torneoTerminado.
     * Edge:
     *   - Self-XP guard ya en creator-economy.js:65.
     *   - Si grupo con 0 participantes: recibe lugar pero no distribuye XP.
     */
    function cerrarTorneo(compId, modo) {
        const all = _allTorneos();
        const comp = all.find(c => c.id === compId);
        if (!comp) return false;
        if (comp.cerradoEn) return false;

        const ahora = new Date().toISOString();
        const ranking = calcularRanking(comp);

        // Build resultados
        const resultados = {};
        ranking.forEach(r => {
            resultados[r.grupoId] = {
                puntaje: r.puntaje,
                lugar: r.lugar,
                participantes: r.participantes
            };
        });

        // Distribuir XP a alumnos con attempts
        ranking.forEach(r => {
            const alumnos = _alumnosDeGrupo(r.grupoId);
            alumnos.forEach(uid => {
                const attempts = getAttempts(compId, uid);
                if (attempts.length === 0) return;
                const xp = xpPorLugar(r.lugar);
                if (typeof GamerState !== "undefined" && typeof GamerState.addXp === "function") {
                    GamerState.addXp(uid, xp, {
                        fuente: "torneo",
                        compId: compId,
                        lugar: r.lugar
                    });
                }
            });
        });

        // XP pasivo al creador profesor
        let xpPasivoTotal = 0;
        ranking.forEach(r => {
            const xpPasivo = Math.floor(r.participantes * XP_PASIVO_BASE * _multLugar(r.lugar));
            xpPasivoTotal += xpPasivo;
        });
        if (xpPasivoTotal > 0 && typeof GamerState !== "undefined") {
            GamerState.addXp(comp.creadoPor, xpPasivoTotal, {
                fuente: "torneo_pasivo",
                compId: compId
            });
        }

        // Persist cerradoEn override
        const cerrados = _readJSON("xahni:comp:cerrados", {});
        cerrados[compId] = ahora;
        _writeJSON("xahni:comp:cerrados", cerrados);

        // Mutate runtime (DEMO seeds) — userCreated también se persiste
        comp.cerradoEn = ahora;
        comp.resultados = resultados;
        comp.estado = "finalizada";

        // Si era userCreated, persistir cambios al array
        const uc = _getUserCreatedTorneos();
        const ucIdx = uc.findIndex(c => c.id === compId);
        if (ucIdx >= 0) {
            uc[ucIdx] = comp;
            _writeJSON("xahni:comp:userCreatedTorneos", uc);
        }

        // Emit event con resultados completos para que el wrapper
        // firestore-sync persista el ranking cross-device (estabilizacion 2026-06-09).
        try {
            document.dispatchEvent(new CustomEvent("xahni:torneoTerminado", {
                detail: {
                    compId: compId,
                    ganador: ranking[0]?.grupoId || null,
                    resultados: resultados,
                    modo: modo
                }
            }));
        } catch (e) { /* defensive */ }

        return true;
    }

    // ── Stats hero ────────────────────────────────────────────────
    function _grupoIdDeUser(uid) {
        const users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []);
        const u = users.find(x => x.id === uid);
        return (u?.grupos || [])[0] || null;
    }

    function listarMisTorneos(uid) {
        return _allTorneos().filter(c => c.creadoPor === uid);
    }

    function listarTorneosMiGrupo(uid) {
        const grupoId = _grupoIdDeUser(uid);
        if (!grupoId) return [];
        return _allTorneos().filter(c => (c.gruposInscritos || []).includes(grupoId));
    }

    function statsHeroProfesor(uid) {
        const mios = listarMisTorneos(uid);
        let participacionesRecibidas = 0;
        let topTorneo = null;
        let topPartic = -1;
        mios.forEach(c => {
            const ranking = calcularRanking(c);
            const partic = ranking.reduce((s, r) => s + r.participantes, 0);
            participacionesRecibidas += partic;
            if (partic > topPartic) {
                topPartic = partic;
                topTorneo = c;
            }
        });
        // XP pasiva ganada acumulada se lee del GamerState meta (lectura defensiva)
        let xpPasivaGanada = 0;
        if (typeof GamerState !== "undefined" && typeof GamerState.get === "function") {
            const s = GamerState.get(uid);
            xpPasivaGanada = s?.xpPasivaRecibida || 0;
        }
        return {
            creados: mios.length,
            participacionesRecibidas: participacionesRecibidas,
            xpPasivaGanada: xpPasivaGanada,
            topTorneo: topTorneo
        };
    }

    function statsHeroEstudiante(uid) {
        const torneos = listarTorneosMiGrupo(uid);
        const now = new Date();
        let activos = 0, proximos = 0;
        torneos.forEach(c => {
            const e = derivarEstado(c, now);
            if (e === "activa") activos++;
            else if (e === "proxima") proximos++;
        });
        // misParticipaciones = count torneos con attempts.length >= 1
        let misParticipaciones = 0;
        let mejorLugar = null;
        torneos.forEach(c => {
            if (getAttempts(c.id, uid).length > 0) misParticipaciones++;
            if (c.cerradoEn && c.resultados) {
                const grupoId = _grupoIdDeUser(uid);
                const r = c.resultados[grupoId];
                if (r && (mejorLugar === null || r.lugar < mejorLugar)) {
                    mejorLugar = r.lugar;
                }
            }
        });
        return {
            activos: activos,
            proximos: proximos,
            misParticipaciones: misParticipaciones,
            mejorLugar: mejorLugar
        };
    }

    // ── Public API ────────────────────────────────────────────────
    return {
        derivarEstado: derivarEstado,
        getAttempts: getAttempts,
        registrarAttempt: registrarAttempt,
        getMejorScore: getMejorScore,
        calcularScoreGrupo: calcularScoreGrupo,
        calcularRanking: calcularRanking,
        cerrarTorneo: cerrarTorneo,
        xpPorLugar: xpPorLugar,
        listarMisTorneos: listarMisTorneos,
        listarTorneosMiGrupo: listarTorneosMiGrupo,
        statsHeroProfesor: statsHeroProfesor,
        statsHeroEstudiante: statsHeroEstudiante,
        _allTorneos: _allTorneos,        // exposed for cierre.js auto-loop
        _grupoIdDeUser: _grupoIdDeUser,  // exposed for cierre.js
        MAX_ATTEMPTS: MAX_ATTEMPTS
    };
})();
window.CompetenciasData = CompetenciasData;
