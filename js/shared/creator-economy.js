// js/shared/creator-economy.js
// Slice Juegos beta · 2026-06-05 · spec §3.1
//
// Listener canonical del event xahni:juegoTerminado. Calcula XP pasivo al
// creador del juego según decay por replays + umbral cal>=80%.

const CreatorEconomy = (() => {
    const REPLAYS_KEY_PREFIX = "xahni:replays:";
    const REPLAYS_KEY = (jugadorId, juegoId) => `${REPLAYS_KEY_PREFIX}${jugadorId}:${juegoId}`;
    const UMBRAL_CAL = 80;
    const FACTOR_BASE = 0.5;

    function _getReplays(jugadorId, juegoId) {
        try {
            const raw = localStorage.getItem(REPLAYS_KEY(jugadorId, juegoId));
            return raw ? parseInt(raw, 10) || 0 : 0;
        } catch (e) {
            return 0;
        }
    }

    function _incrReplays(jugadorId, juegoId) {
        try {
            const n = _getReplays(jugadorId, juegoId) + 1;
            localStorage.setItem(REPLAYS_KEY(jugadorId, juegoId), String(n));
            // Sweep 2026-06-08: dispatch para que firestore-sync persista
            // el contador cross-device (alimenta cálculo de XP pasiva con decay).
            try {
                document.dispatchEvent(new CustomEvent("xahni:replayIncrementado", {
                    detail: { jugadorId, juegoId, count: n }
                }));
            } catch (_) { /* defensive */ }
            return n;
        } catch (e) {
            return 1;
        }
    }

    function _decay(replayN) {
        if (replayN <= 1) return 1.0;
        if (replayN === 2) return 0.5;
        return 0.25;
    }

    function _findJuego(juegoId) {
        try {
            const raw = localStorage.getItem("xahni:juegos:userCreated") || "[]";
            const user = JSON.parse(raw);
            const found = user.find(j => j.id === juegoId);
            if (found) return found;
        } catch (e) { /* fall through */ }
        if (typeof DEMO_JUEGOS !== "undefined" && Array.isArray(DEMO_JUEGOS)) {
            return DEMO_JUEGOS.find(j => j.id === juegoId) || null;
        }
        return null;
    }

    function _handleJuegoTerminado(e) {
        const d = e.detail || {};
        const jugadorId = d.uid;
        const juegoId = d.juegoId;
        const puntaje = Number(d.puntaje) || 0;
        if (!jugadorId || !juegoId) return;

        const replayN = _incrReplays(jugadorId, juegoId);

        if (puntaje < UMBRAL_CAL) return;
        if (typeof GamerState === "undefined") return;

        const juego = _findJuego(juegoId);
        if (!juego || !juego.creadoPor) return;
        if (juego.creadoPor === jugadorId) return;

        const decay = _decay(replayN);
        const xpPasivo = Math.floor(puntaje * decay * FACTOR_BASE);
        if (xpPasivo <= 0) return;

        GamerState.addXp(juego.creadoPor, xpPasivo, {
            fuente: "jugada-ajena",
            juegoId,
            jugadorId,
            replayN,
            decay
        });

        try {
            document.dispatchEvent(new CustomEvent("xahni:xpPasivaRecibida", {
                detail: {
                    creadorId: juego.creadoPor,
                    jugadorId,
                    juegoId,
                    xp: xpPasivo,
                    replayN,
                    decay
                }
            }));
        } catch (err) { /* defensive */ }
    }

    function _handleXpPasivaRecibida(e) {
        const d = e.detail || {};
        if (typeof APP === "undefined" || !APP.user) return;
        if (APP.user.id !== d.creadorId) return;
        if (typeof showToast !== "function") return;
        const msg = `🎁 +${d.xp} XP pasiva · alguien jugó tu juego bien`;
        showToast(msg, "ok");
    }

    function _register() {
        if (window.__xahniCreatorEconomyListenerRegistered) return;
        document.addEventListener("xahni:juegoTerminado", _handleJuegoTerminado);
        document.addEventListener("xahni:xpPasivaRecibida", _handleXpPasivaRecibida);
        window.__xahniCreatorEconomyListenerRegistered = true;
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", _register);
    } else {
        _register();
    }

    return {
        _getReplays,
        _decay,
        _findJuego,
        _handleJuegoTerminado,
        REPLAYS_KEY_PREFIX,
        UMBRAL_CAL,
        FACTOR_BASE
    };
})();
