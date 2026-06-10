// js/core/temporada.js
// Spec A 2026-06-09 · Helper canonical del sistema de Temporada del perfil.
//
// Resuelve el temporadaId activo para el usuario actual (alumno o profesor)
// y detecta cambios lazy en cada render del perfil, haciendo snapshot a
// historial y reseteando xpCompetencias.

(function () {

    /**
     * @interaction resolve-temporada-actual-id
     * @scope core-temporada-spec-a
     *
     * Given uid del usuario.
     * When _verificarCambioTemporada o renderer de perfil necesitan saber qué
     *   ciclo académico está vigente para este usuario.
     * Then resolución cascada por rol:
     *   - Estudiante: primer grupo (user.grupos[0]).
     *   - Profesor: primer grupo válido (existente en DEMO_GRUPOS) de la
     *     primera materia enseñada (DEMO_MATERIAS.find profesorId).
     *   Periodo del grupo via getPeriodoDeGrupo → retorna periodo.ciclo
     *   como temporadaId (ej. "Cuat 3 2026").
     * Edge:
     *   - uid o DEMO_USERS ausente → null.
     *   - Profesor sin materias o sin grupos válidos → null.
     *   - Alumno sin grupo → null.
     *   - Periodo no resoluble → null (no participa del sistema).
     *   - Función PURA respecto a inputs.
     */
    function _resolveTemporadaActualId(uid) {
        if (!uid || typeof DEMO_USERS === "undefined") return null;
        const u = DEMO_USERS.find(x => x.id === uid);
        if (!u) return null;
        let grupoId = null;
        if (u.tipo === "estudiante") {
            grupoId = (u.grupos || [])[0];
        } else if (u.tipo === "profesor") {
            const mat = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
                .find(m => m.profesorId === uid);
            if (!mat) return null;
            const gruposCatalog = (typeof DEMO_GRUPOS !== "undefined" ? DEMO_GRUPOS : []);
            const validIds = new Set(gruposCatalog.map(g => g.id));
            grupoId = (mat.grupos || []).find(id => validIds.has(id))
                || (mat.grupos || [])[0];
        }
        if (!grupoId) return null;
        const periodo = (typeof getPeriodoDeGrupo === "function")
            ? getPeriodoDeGrupo(grupoId) : null;
        return periodo?.ciclo || null;
    }
    window._resolveTemporadaActualId = _resolveTemporadaActualId;

    /**
     * @interaction verificar-cambio-temporada
     * @scope core-temporada-spec-a
     *
     * Given uid del usuario.
     * When un renderer del perfil arranca (buildPerfilCompleto u homólogo).
     * Then:
     *   1. Resuelve temporadaId actual via _resolveTemporadaActualId.
     *   2. Compara con state.temporadaId del GamerState del uid.
     *   3. Si difiere:
     *      a. Si state.temporadaId era null (primera vez): solo registra el
     *         nuevo temporadaId sin snapshot.
     *      b. Si era distinto: snapshot del shape anterior a
     *         temporadasHistorial[] (objeto con temporadaId,
     *         xpCompetencias, rango.label, cerradaEn ISO), reset
     *         xpCompetencias a 0, actualiza temporadaId.
     *   4. Persiste state vía GamerState.set (dispatcha gamerUpdated que
     *      replica a Firestore por persistGamerState).
     *   5. Dispatcha xahni:temporadaCambio si hubo snapshot.
     * Edge:
     *   - GamerState no cargado → no-op silencioso.
     *   - temporadaActualId null (sin grupo válido) → no-op (no participa).
     *   - calcularRango no cargado → snapshot guarda rango: null.
     *   - Función IMPURA (lee/escribe localStorage + dispatcha eventos).
     */
    function _verificarCambioTemporada(uid) {
        if (!uid || typeof GamerState === "undefined") return;
        const temporadaActualId = _resolveTemporadaActualId(uid);
        if (!temporadaActualId) return;
        const state = GamerState.get(uid);
        if (state.temporadaId === temporadaActualId) return;
        if (state.temporadaId === null || state.temporadaId === undefined) {
            // Primer load: solo registra
            GamerState.set(uid, Object.assign({}, state, {
                temporadaId: temporadaActualId
            }));
            return;
        }
        // CAMBIO DE TEMPORADA — snapshot + reset
        const rangoLabel = (typeof calcularRango === "function")
            ? calcularRango(state.xpCompetencias || 0).label : null;
        const snap = {
            temporadaId: state.temporadaId,
            xpCompetencias: state.xpCompetencias || 0,
            rango: rangoLabel,
            cerradaEn: new Date().toISOString()
        };
        const after = Object.assign({}, state, {
            temporadaId: temporadaActualId,
            xpCompetencias: 0,
            temporadasHistorial: [...(state.temporadasHistorial || []), snap]
        });
        GamerState.set(uid, after);
        try {
            document.dispatchEvent(new CustomEvent("xahni:temporadaCambio", {
                detail: { uid, anterior: snap, nueva: temporadaActualId }
            }));
        } catch (e) { /* defensive */ }
    }
    window._verificarCambioTemporada = _verificarCambioTemporada;

})();
