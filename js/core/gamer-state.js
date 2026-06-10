// js/core/gamer-state.js
// Sprint entrega 2026-06-08 · Slice juegos-quiz-mvp
//
// Estado runtime gamificado por usuario (XP, nivel, insignias, jugadas).
// Persistencia localStorage key `xahni:gamer:<uid>`.
// Mismo patrón que avatar (project_avatar_pilar_1_patron) — single source of
// truth runtime con hydration desde defaults si no existe key.
//
// Decisión D4 (sprint 2026-06-03): los seeds en data/demo/*.json quedan
// INTACTOS. Si no existe key localStorage para un uid → arranca 0/L1 limpio.
// Si existe → usa la persistida.

const GamerState = (() => {
    const KEY_PREFIX = "xahni:gamer:";
    const KEY = (uid) => `${KEY_PREFIX}${uid}`;

    // Curva de nivel cuadrática: nivel(xp) = floor(sqrt(xp / 50)) + 1
    // Inversa: xpRequerido(nivel) = 50 * (nivel - 1)^2
    //   L1: 0    L2: 50    L3: 200   L4: 450   L5: 800
    //   L6: 1250 L7: 1800  L8: 2450  L9: 3200  L10: 4050
    //
    // Quiz de 3 preguntas × 20 XP perfecto = 60 XP → L1→L2 en primera jugada
    // (decisión demo: dopamina inmediata, ver project_sprint_entrega_jun8.md).
    const _DEFAULT = () => ({
        xp: 0,
        nivel: 1,
        insignias: [],
        jugadas: [],
        xpPasivaRecibida: 0,
        xpDirecta: 0,
        // Spec A 2026-06-09: campos nuevos del sistema xpCompetencias + Temporada.
        xpCompetencias: 0,            // alimenta calcularRango (separa XP de competencias del total)
        temporadaId: null,            // id del ciclo académico actual (ej. "Cuat 3 2026")
        temporadasHistorial: [],      // snapshots al cambio de temporada: [{temporadaId, xpCompetencias, rango, cerradaEn}]
        xpCompetenciasBoosts: []      // boosts activos: [{factor: 1.05, expiraEn: <millis>, fuente, desbloqueoEn}]
    });

    /**
     * @interaction gamer-state-calc-nivel
     * @scope core-gamer-state-curve
     *
     * Given xp absoluto (int >= 0).
     * When un caller necesita derivar el nivel a partir del XP total.
     * Then retorna floor(sqrt(xp / 50)) + 1. Mínimo 1 si xp < 0.
     * Edge: función PURA. No depende de uid ni storage.
     */
    function calcularNivel(xp) {
        const v = Number(xp);
        if (!Number.isFinite(v) || v < 0) return 1;
        return Math.floor(Math.sqrt(v / 50)) + 1;
    }

    /**
     * @interaction gamer-state-xp-para-nivel
     * @scope core-gamer-state-curve
     *
     * Given nivel objetivo (int >= 1).
     * When un caller necesita el threshold XP de un nivel específico.
     * Then retorna 50 * (nivel - 1)^2. Para nivel 1 → 0.
     * Edge: función PURA.
     */
    function xpParaNivel(nivel) {
        const n = Math.max(1, Number(nivel) | 0);
        return 50 * (n - 1) * (n - 1);
    }

    /**
     * @interaction gamer-state-get
     * @scope core-gamer-state-read
     *
     * Given uid (string).
     * When un caller necesita el state runtime del alumno (perfil, ranking,
     *   hub-materia tab Juegos).
     * Then:
     *   1. Si no hay key localStorage → retorna shape default 0/L1.
     *   2. Si hay key → parse JSON + merge con default (defensa a shape
     *      faltante).
     * Edge:
     *   - uid falsy → default (defensa silenciosa).
     *   - JSON inválido → console.warn + default.
     *   - Función IMPURA (lee localStorage).
     */
    function get(uid) {
        if (!uid) return _DEFAULT();
        try {
            const raw = localStorage.getItem(KEY(uid));
            if (!raw) return _DEFAULT();
            const parsed = JSON.parse(raw);
            return Object.assign(_DEFAULT(), parsed);
        } catch (e) {
            console.warn("[GamerState] parse fail uid=" + uid, e);
            return _DEFAULT();
        }
    }

    /**
     * @interaction gamer-state-set
     * @scope core-gamer-state-write
     *
     * Given uid + state shape.
     * When un caller necesita pisar el state runtime completo.
     * Then escribe JSON.stringify a `xahni:gamer:<uid>`.
     * Edge:
     *   - uid falsy → no-op silencioso.
     *   - localStorage llena/error → catch sin throw.
     *   - Función IMPURA (escribe localStorage). NO dispatch evento.
     */
    function set(uid, state) {
        if (!uid) return;
        try {
            localStorage.setItem(KEY(uid), JSON.stringify(state));
        } catch (e) {
            console.warn("[GamerState] set fail uid=" + uid, e);
        }
    }

    /**
     * @interaction gamer-state-add-xp
     * @scope core-gamer-state-mutation
     *
     * Given uid + delta XP + meta opcional con `fuente` discriminador.
     * When un caller (terminar quiz/vf/flashcards · ganar competencia · trigger
     *   pasivo creator-economy) otorga XP al usuario.
     * Then:
     *   1. Lee state actual.
     *   2. Calcula xpNuevo y nivelNuevo.
     *   3. Discrimina por meta.fuente: 'jugada-ajena' suma a xpPasivaRecibida,
     *      resto a xpDirecta.
     *   4. Persiste { xp, nivel, xpPasivaRecibida, xpDirecta }.
     *   5. Dispatch xahni:gamerUpdated.
     *   6. Retorna detail completo.
     * Edge:
     *   - uid falsy o delta=0 → null.
     *   - Backward-compatible: callers sin meta caen a xpDirecta.
     *   - IMPURA (storage + event).
     */
    function addXp(uid, delta, meta) {
        if (!uid || !delta) return null;
        const before = get(uid);
        const xpAnt = before.xp || 0;
        const xpNuevo = Math.max(0, xpAnt + Number(delta));
        const nivelAnt = before.nivel || 1;
        const nivelNuevo = calcularNivel(xpNuevo);
        const levelUp = nivelNuevo > nivelAnt;
        const fuente = (meta && meta.fuente) || null;
        const xpPasivaRecibidaAnt = before.xpPasivaRecibida || 0;
        const xpDirectaAnt = before.xpDirecta || 0;
        const xpPasivaRecibidaNueva = fuente === "jugada-ajena"
            ? xpPasivaRecibidaAnt + Number(delta)
            : xpPasivaRecibidaAnt;
        const xpDirectaNueva = fuente === "jugada-ajena"
            ? xpDirectaAnt
            : xpDirectaAnt + Number(delta);

        // Spec A 2026-06-09: xpCompetencias tracking.
        // Suma solo cuando la fuente es de competencia (alumno o profesor creator).
        // Aplica el productorio de boosts activos al delta.
        const xpCompetenciasFuentes = new Set([
            "torneo",                // alumno inter (ya emitida por CompetenciasData.cerrarTorneo)
            "torneo-intra",          // alumno intra (ya emitida por TorneosIntraData.cerrarTorneo)
            "torneo_pasivo",         // profesor creator inter (ya emitida)
            "torneo_intra_pasivo"    // profesor creator intra (NUEVA, ver Task 4)
        ]);
        const xpCompetenciasAnt = before.xpCompetencias || 0;
        let xpCompetenciasNueva = xpCompetenciasAnt;
        if (xpCompetenciasFuentes.has(fuente)) {
            const boostFactor = computeBoostFactor(uid, Date.now());
            const xpCompetenciasDelta = Math.round(Number(delta) * boostFactor);
            xpCompetenciasNueva = xpCompetenciasAnt + xpCompetenciasDelta;
        }

        const after = Object.assign({}, before, {
            xp: xpNuevo,
            nivel: nivelNuevo,
            xpPasivaRecibida: xpPasivaRecibidaNueva,
            xpDirecta: xpDirectaNueva,
            xpCompetencias: xpCompetenciasNueva
        });
        set(uid, after);
        const detail = {
            uid,
            delta: Number(delta),
            xpAnt, xpNuevo,
            nivelAnt, nivelNuevo,
            levelUp,
            meta: meta || null,
            xpPasivaRecibida: xpPasivaRecibidaNueva,
            xpDirecta: xpDirectaNueva,
            xpCompetencias: xpCompetenciasNueva
        };
        try {
            document.dispatchEvent(new CustomEvent("xahni:gamerUpdated", { detail }));
        } catch (e) { /* defensive */ }
        // Evaluar insignias post-XP (puede que el delta haya cruzado un umbral)
        evaluarInsignias(uid);
        return detail;
    }

    /**
     * @interaction gamer-state-add-jugada
     * @scope core-gamer-state-mutation
     *
     * Given uid + objeto jugada `{ juegoId, fecha, puntaje, xpGanado,
     *   aciertos, totalPreguntas, tiempoSegundos }`.
     * When un caller (modal jugar quiz tras "Terminar") registra una sesión.
     * Then push al array jugadas[] del state runtime. Persiste.
     * Edge:
     *   - uid falsy → no-op.
     *   - jugadas[] inicializa si no existía.
     *   - NO dispatch evento (addXp ya dispara uno relacionado).
     *   - Función IMPURA.
     */
    function addJugada(uid, jugada) {
        if (!uid || !jugada) return;
        const s = get(uid);
        const jugadas = Array.isArray(s.jugadas) ? s.jugadas : [];
        jugadas.push(jugada);
        const after = Object.assign({}, s, { jugadas });
        set(uid, after);
        // Dispatch xahni:gamerUpdated para que firestore-sync persista jugadas[].
        // Bug detectado smoke prod 2026-06-06: addJugada no disparaba evento,
        // jugadas quedaban solo en localStorage, no en Firestore gamerState/{uid}.
        try {
            document.dispatchEvent(new CustomEvent("xahni:gamerUpdated", {
                detail: { uid, fuente: 'jugada', state: after }
            }));
        } catch (e) { /* defensive */ }
        // Evaluar insignias post-jugada (puede haber alcanzado primera/10-juegos)
        evaluarInsignias(uid);
    }

    /**
     * @interaction evaluar-insignias
     * @scope core-gamer-state-evaluator
     *
     * Given uid y state runtime (xp, nivel, jugadas, insignias).
     * When un caller (addXp, addJugada) muta el state.
     * Then itera DEMO_LOGROS y para cada uno evalúa _UNLOCK_RULES[condicion].
     *   Si rule retorna true → invoca unlockInsignia (idempotente).
     *   Las condiciones sin rule mapeada se ignoran (deuda explícita —
     *   requieren state que no está en gamer-state.js, ej: racha, tareas).
     * Edge:
     *   - DEMO_LOGROS undefined → no-op silencioso (catálogo no hidratado).
     *   - Logro sin condicion → skip.
     *   - unlockInsignia ya unlocked → no-op + no dispatch.
     */
    const _UNLOCK_RULES = {
        // Mapeo condicion (string del catálogo) → predicate (state) => boolean
        bienvenido_al_juego: s => (s.jugadas || []).length >= 1,
        diez_juegos:         s => (s.jugadas || []).length >= 10,
        cinco_logros:        s => (s.insignias || []).length >= 5,
        puntaje_90:          s => (s.xp || 0) >= 900,
        primer_diez:         s => (s.xp || 0) >= 100
        // Otras condiciones (primera_entrega, tres_perfectas, racha_7, racha_30,
        // cinco_tareas, tres_recursos, competencia_ganada, grupo_completo)
        // requieren state externo a gamer-state. Deuda post-Supabase: evaluator
        // distribuido por slice owner (tareas, escala, recursos, competencias).
    };

    function evaluarInsignias(uid) {
        if (!uid) return;
        const logros = (typeof DEMO_LOGROS !== 'undefined' && Array.isArray(DEMO_LOGROS))
            ? DEMO_LOGROS : [];
        if (!logros.length) return;
        const state = get(uid);
        logros.forEach(l => {
            if (!l || !l.condicion) return;
            const rule = _UNLOCK_RULES[l.condicion];
            if (rule && rule(state)) {
                unlockInsignia(uid, l.id);
            }
        });
    }

    /**
     * @interaction gamer-state-unlock-insignia
     * @scope core-gamer-state-mutation
     *
     * Given uid + insigniaId.
     * When evaluador automático de logros (slice día 3) detecta condición
     *   cumplida.
     * Then:
     *   1. Si ya estaba desbloqueada → no-op, retorna false.
     *   2. Si no → push al array insignias[], persiste, dispatch
     *      `xahni:insigniaUnlocked`, retorna true.
     * Edge:
     *   - uid o insigniaId falsy → no-op false.
     *   - Listeners (toast canónico + re-render perfil) consumen evento.
     */
    function unlockInsignia(uid, insigniaId) {
        if (!uid || !insigniaId) return false;
        const s = get(uid);
        const ins = Array.isArray(s.insignias) ? s.insignias : [];
        if (ins.includes(insigniaId)) return false;
        const after = Object.assign({}, s, { insignias: ins.concat(insigniaId) });
        set(uid, after);
        try {
            document.dispatchEvent(new CustomEvent("xahni:insigniaUnlocked", {
                detail: { uid, insigniaId }
            }));
        } catch (e) { /* defensive */ }
        return true;
    }

    /**
     * @interaction compute-boost-factor
     * @scope core-gamer-state-spec-a-boost
     *
     * Given uid + timestamp (default Date.now()).
     * When un caller (addXp interno) necesita el productorio de factores
     *   de los boosts activos del usuario.
     * Then lee state.xpCompetenciasBoosts[], filtra los que tienen
     *   expiraEn > now, retorna el producto de sus `factor`. Sin boosts
     *   activos retorna 1.0 (identidad).
     * Edge:
     *   - uid falsy → 1.0.
     *   - array vacío → 1.0.
     *   - todos expirados → 1.0.
     *   - Función PURA respecto a state + now.
     */
    function computeBoostFactor(uid, now) {
        if (!uid) return 1.0;
        const t = (typeof now === "number") ? now : Date.now();
        const state = get(uid);
        const boosts = Array.isArray(state.xpCompetenciasBoosts)
            ? state.xpCompetenciasBoosts : [];
        return boosts.reduce((acc, b) => {
            if (!b || typeof b.factor !== "number" || typeof b.expiraEn !== "number") return acc;
            if (b.expiraEn <= t) return acc;
            return acc * b.factor;
        }, 1.0);
    }

    /**
     * @interaction gamer-state-reset
     * @scope core-gamer-state-mutation
     *
     * Given uid.
     * When dev tooling o reset explícito (no usado en producción del sprint).
     * Then `localStorage.removeItem` del key. Próximo `get(uid)` retornará
     *   default.
     * Edge: defensive try/catch.
     */
    function reset(uid) {
        if (!uid) return;
        try { localStorage.removeItem(KEY(uid)); }
        catch (e) { /* defensive */ }
    }

    return {
        get,
        set,
        addXp,
        addJugada,
        unlockInsignia,
        evaluarInsignias,
        calcularNivel,
        xpParaNivel,
        computeBoostFactor,
        reset,
        _KEY_PREFIX: KEY_PREFIX
    };
})();
