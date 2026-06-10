// js/core/logros-evaluador.js
// Sprint entrega 2026-06-08 · Slice recompensas (día 3)
//
// Evaluador de logros con unlock automático tras eventos del runtime
// gamificado (quizCompletado, gamerUpdated, insigniaUnlocked,
// competenciaGanada). Decisión D4: solo se unlockean al runtime
// (`GamerState.insignias`). El seed `desbloqueadoPor` del JSON queda
// como dato histórico, no se muta.
//
// Catálogo LIVE en este sprint (5 logros): l6 quiz_master, l8
// jugador_dedicado, l9 campeones (día 4), l12 cinco_logros, l13
// bienvenido_al_juego. Los otros 7 logros del JSON quedan en catálogo
// visual (visibles bloqueados) pero sus predicados retornan false
// permanentemente este sprint (out-of-scope: tareas/recursos/rachas).

const LogrosEvaluador = (() => {
    function _catalogo() {
        return (typeof DEMO_LOGROS !== "undefined" && Array.isArray(DEMO_LOGROS))
            ? DEMO_LOGROS : [];
    }

    function _yaDesbloqueada(uid, logroId) {
        if (typeof GamerState === "undefined") return false;
        return (GamerState.get(uid).insignias || []).includes(logroId);
    }

    function _jugadasCount(uid) {
        if (typeof GamerState === "undefined") return 0;
        return (GamerState.get(uid).jugadas || []).length;
    }

    function _insigniasCount(uid) {
        if (typeof GamerState === "undefined") return 0;
        return (GamerState.get(uid).insignias || []).length;
    }

    // Predicados por `condicion` string (campo del logro en JSON).
    // Signature: (uid, eventoTipo, eventoData) → boolean.
    // Eventos válidos: 'quizCompletado', 'gamerUpdated', 'insigniaUnlocked',
    // 'competenciaGanada'.
    //
    // Out-of-scope sprint (retornan false permanente):
    //   primera_entrega, tres_perfectas, racha_7, primer_diez, cinco_tareas,
    //   tres_recursos, grupo_completo, racha_30.
    const COND = {
        // Sprint LIVE — 5 condiciones triggeables:

        // l13 Bienvenido al juego: primera jugada quiz (jugadas count >= 1).
        bienvenido_al_juego: (uid, evt) => evt === "quizCompletado" && _jugadasCount(uid) >= 1,

        // l6 Quiz Master: puntaje >= 90 en una jugada.
        puntaje_90: (uid, evt, data) => evt === "quizCompletado" && (data?.puntaje || 0) >= 90,

        // l8 Jugador Dedicado: 10+ sesiones completadas.
        diez_juegos: (uid, evt) => evt === "quizCompletado" && _jugadasCount(uid) >= 10,

        // l12 Coleccionista: 5+ logros desbloqueados (meta-logro, se evalúa
        // tras cada nuevo unlock).
        cinco_logros: (uid) => _insigniasCount(uid) >= 5,

        // l9 Campeones: ganar competencia intergrupal (día 4 wire).
        competencia_ganada: (uid, evt) => evt === "competenciaGanada",

        // Out-of-scope sprint — false permanente, catálogo solo visual.
        primera_entrega: () => false,
        tres_perfectas: () => false,
        racha_7: () => false,
        primer_diez: () => false,
        cinco_tareas: () => false,
        tres_recursos: () => false,
        grupo_completo: () => false,
        racha_30: () => false,
    };

    /**
     * @interaction logros-evaluar
     * @scope core-logros-evaluador-entrypoint
     *
     * Given uid + eventoTipo + eventoData opcional.
     * When un evento de runtime gamificado dispara (quizCompletado,
     *   gamerUpdated, insigniaUnlocked, competenciaGanada).
     * Then loop sobre `DEMO_LOGROS`. Por cada logro:
     *   1. Skip si ya desbloqueada para el uid.
     *   2. Resuelve predicado de `COND[logro.condicion]`. Si ausente, skip.
     *   3. Si predicado retorna true → `GamerState.unlockInsignia(uid, l.id)`.
     *   4. Acumula los nuevos unlocks en array `nuevos` retornado.
     * Edge:
     *   - uid falsy → retorna [] (no-op).
     *   - Predicado throws → log warn, continúa con siguiente logro.
     *   - Cada unlock dispara CustomEvent `xahni:insigniaUnlocked` desde
     *     GamerState. El listener de "meta-check" (abajo) re-llama evaluar
     *     con evt='insigniaUnlocked' para reactivar logros encadenados
     *     (ej. cinco_logros).
     *   - Función IMPURA (lee GamerState + storage + dispatcha eventos).
     */
    function evaluar(uid, eventoTipo, eventoData) {
        if (!uid) return [];
        const cat = _catalogo();
        const nuevos = [];
        for (const logro of cat) {
            if (!logro?.id || !logro.condicion) continue;
            if (_yaDesbloqueada(uid, logro.id)) continue;
            const pred = COND[logro.condicion];
            if (typeof pred !== "function") continue;
            try {
                if (pred(uid, eventoTipo, eventoData)) {
                    if (typeof GamerState !== "undefined"
                        && GamerState.unlockInsignia(uid, logro.id)) {
                        nuevos.push(logro.id);
                    }
                }
            } catch (e) {
                console.warn("[LogrosEvaluador] predicate fail for " + logro.id, e);
            }
        }
        return nuevos;
    }

    /**
     * @interaction logros-evaluador-wire-listeners
     * @scope core-logros-evaluador-bootstrap
     *
     * Given módulo cargado (script tag en index.html).
     * When DOM ready.
     * Then registra listeners globales:
     *   - xahni:quizCompletado → evaluar(uid, 'quizCompletado', detail).
     *   - xahni:gamerUpdated → si levelUp, evaluar(uid, 'gamerUpdated', detail).
     *   - xahni:insigniaUnlocked → meta-check (evt='insigniaUnlocked') para
     *     cadenas como cinco_logros.
     *   - xahni:competenciaGanada → evaluar(uid, 'competenciaGanada', detail)
     *     (día 4 wire).
     *   - xahni:insigniaUnlocked → si #medallas-grid visible, re-render
     *     `buildMedallas()` con setTimeout defensivo.
     * Edge:
     *   - Listeners idempotentes (registro único en IIFE init).
     *   - Defensive guards si CustomEvent.detail ausente.
     */
    document.addEventListener("xahni:quizCompletado", function (e) {
        const d = e.detail || {};
        if (!d.uid) return;
        evaluar(d.uid, "quizCompletado", d);
    });

    document.addEventListener("xahni:gamerUpdated", function (e) {
        const d = e.detail || {};
        if (!d.uid) return;
        if (d.levelUp) evaluar(d.uid, "gamerUpdated", d);
    });

    // Meta-check: tras cada unlock evaluar cadena (ej. cinco_logros).
    // Re-render perfil si tab Perfil está visible.
    document.addEventListener("xahni:insigniaUnlocked", function (e) {
        const d = e.detail || {};
        if (!d.uid) return;
        evaluar(d.uid, "insigniaUnlocked", d);
        // Defensive re-render del grid de medallas si está montado.
        setTimeout(() => {
            try {
                if (typeof buildMedallas === "function"
                    && document.getElementById("medallas-grid")) {
                    buildMedallas();
                }
            } catch (err) { /* defensive */ }
        }, 200);
    });

    document.addEventListener("xahni:competenciaGanada", function (e) {
        const d = e.detail || {};
        if (!d.uid) return;
        evaluar(d.uid, "competenciaGanada", d);
    });

    return { evaluar, _COND: COND };
})();
