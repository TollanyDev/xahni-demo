// js/shared/competencias-cierre.js
// Slice Competencias beta C1 · 2026-06-06 · spec §9.3
//
// Listener xahni:juegoTerminado — registra attempts en torneos activos
// cuyo juegoId match + auto-close lazy de torneos con fechaFin pasada.
// Emit xahni:torneoActualizado por attempt registrado.

(function () {

    function _onJuegoTerminado(e) {
        const detail = e.detail || {};
        const uid = detail.uid;
        const juegoId = detail.juegoId;
        const puntaje = detail.puntaje;
        if (!uid || !juegoId || typeof puntaje !== "number") return;
        if (typeof CompetenciasData === "undefined") return;

        const now = new Date();
        const grupoUid = CompetenciasData._grupoIdDeUser(uid);

        // 1. Registrar attempts en torneos activos
        const all = CompetenciasData._allTorneos();
        all.forEach(c => {
            if (c.juegoId !== juegoId) return;
            if (CompetenciasData.derivarEstado(c, now) !== "activa") return;
            if (!(c.gruposInscritos || []).includes(grupoUid)) return;
            const ok = CompetenciasData.registrarAttempt(c.id, uid, puntaje);
            if (ok) {
                try {
                    document.dispatchEvent(new CustomEvent("xahni:torneoActualizado", {
                        detail: { compId: c.id, uid: uid, score: puntaje }
                    }));
                } catch (err) { /* defensive */ }
                if (typeof showToast === "function") {
                    showToast(`✓ Has participado en "${c.nombre}" · ${puntaje} pts`, "ok");
                }
            }
        });

        // 2. Auto-close lazy de torneos con fechaFin pasada.
        // Bug crítico 2026-06-09: rehidratar attempts del torneo desde
        // Firestore antes del cierre para incluir intentos cross-device.
        all.forEach(async c => {
            if (c.cerradoEn) return;
            if (CompetenciasData.derivarEstado(c, now) === "finalizada") {
                if (typeof window.firestoreRehydrateAttemptsCompetencia === "function") {
                    try { await window.firestoreRehydrateAttemptsCompetencia(c.id); }
                    catch (e) { /* defensive */ }
                }
                CompetenciasData.cerrarTorneo(c.id, "auto");
            }
        });
    }

    document.addEventListener("xahni:juegoTerminado", _onJuegoTerminado);

})();
