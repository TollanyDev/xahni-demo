// js/shared/juegos-data.js
// Slice Juegos beta E2 · 2026-06-05 · spec §3.3 + §3.4 + §3.5
//
// Helpers data-derivation puros para el panel Juegos. Sin side-effects.
// Combinan GamerState + DEMO_JUEGOS + xahni:juegos:userCreated + xahni:replays:*
// en valores listos para render.

const JuegosData = (() => {

    function _getUserCreated() {
        try {
            const raw = localStorage.getItem("xahni:juegos:userCreated") || "[]";
            return JSON.parse(raw);
        } catch (e) { return []; }
    }

    function _getSeeds() {
        if (typeof DEMO_JUEGOS !== "undefined" && Array.isArray(DEMO_JUEGOS)) return DEMO_JUEGOS;
        return [];
    }

    /** Lista TODOS los juegos visibles para el alumno: seeds + user-created. */
    function listarJuegosCanonical(materiaId) {
        const all = [..._getSeeds(), ..._getUserCreated()];
        if (materiaId) return all.filter(j => j.materiaId === materiaId);
        return all;
    }

    /** Filtra por temaId si existe el campo · sino retorna todos. */
    function filtrarPorTema(juegos, temaId) {
        if (!temaId || temaId === "todos") return juegos;
        return juegos.filter(j => j.temaId === temaId);
    }

    /** Suma replays totales de un juego cross-jugadores (proxy de popularidad). */
    function _replaysTotalesJuego(juegoId) {
        let total = 0;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith("xahni:replays:") && key.endsWith(":" + juegoId)) {
                    total += parseInt(localStorage.getItem(key), 10) || 0;
                }
            }
        } catch (e) { /* defensive */ }
        return total;
    }

    /** Replays únicos del jugador en el juego. */
    function replaysDelJugador(jugadorId, juegoId) {
        try {
            const raw = localStorage.getItem(`xahni:replays:${jugadorId}:${juegoId}`);
            return raw ? parseInt(raw, 10) || 0 : 0;
        } catch (e) { return 0; }
    }

    function calcPopularidad(juegoId) {
        const total = _replaysTotalesJuego(juegoId);
        return Math.min(1, total / 10);
    }

    function chipEstado(juego, viewerUid, viewerGrupos) {
        const replays = replaysDelJugador(viewerUid, juego.id);
        const pop = calcPopularidad(juego.id);
        const totalReplays = _replaysTotalesJuego(juego.id);

        if (juego.creadoPor === viewerUid) {
            // Es mi creación
            return { texto: "Mi creación", clase: "x-chip--brand" };
        }
        if (replays >= 1) {
            return { texto: `Ya jugado ${replays}/${getMaxItems(juego)}`, clase: "" };
        }
        if (totalReplays < 3) {
            return { texto: "Novato", clase: "" };
        }
        return null;
    }

    function getMaxItems(juego) {
        if (juego.tipo === "quiz") return (juego.preguntas || []).length;
        if (juego.tipo === "vf") return (juego.afirmaciones || []).length;
        if (juego.tipo === "flashcards") return (juego.tarjetas || []).length;
        return 0;
    }

    /** Stats hero para alumno. */
    function statsHeroAlumno(uid) {
        if (typeof GamerState === "undefined") return { jugados: 0, promedio: 0, xpPasiva: 0, topCreacion: "—" };
        const gs = GamerState.get(uid);
        const jugadasJuego = (gs.jugadas || []).filter(j =>
            j.tipo === "quiz" || j.tipo === "vf" || j.tipo === "flashcards"
        );
        const jugados = jugadasJuego.length;
        const promedio = jugados > 0
            ? (jugadasJuego.reduce((sum, j) => sum + (j.puntaje || 0), 0) / jugados / 10).toFixed(1)
            : "—";
        const xpPasiva = gs.xpPasivaRecibida || 0;
        const misCreaciones = _getUserCreated().filter(j => j.creadoPor === uid);
        let topNombre = "—", topScore = 0;
        misCreaciones.forEach(j => {
            const pop = calcPopularidad(j.id);
            if (pop > topScore) { topScore = pop; topNombre = j.nombre; }
        });
        return { jugados, promedio, xpPasiva, topCreacion: topNombre, topScore: topScore };
    }

    /** Stats hero para profesor. */
    function statsHeroProfesor(uid) {
        if (typeof GamerState === "undefined") return { quizzesCreados: 0, jugadasRecibidas: 0, xpPasiva: 0, topQuiz: "—" };
        const gs = GamerState.get(uid);
        const misCreaciones = _getUserCreated().filter(j => j.creadoPor === uid);
        let jugadasRecibidas = 0;
        let topNombre = "—", topScore = 0;
        misCreaciones.forEach(j => {
            const replays = _replaysTotalesJuego(j.id);
            jugadasRecibidas += replays;
            const pop = calcPopularidad(j.id);
            if (pop > topScore) { topScore = pop; topNombre = j.nombre; }
        });
        return {
            quizzesCreados: misCreaciones.length,
            jugadasRecibidas,
            xpPasiva: gs.xpPasivaRecibida || 0,
            topQuiz: topNombre,
            topScore
        };
    }

    /** Lista temas únicos para los filtros del panel. */
    function listarTemasDeMateria(materiaId) {
        const todos = listarJuegosCanonical(materiaId);
        const temas = new Set();
        todos.forEach(j => { if (j.temaId) temas.add(j.temaId); });
        return Array.from(temas);
    }

    /** Lista temas con título legible. Bundle C 2026-06-09 fix:
     *  el filtro del panel mostraba IDs en lugar de nombres porque
     *  quiz.temaId es un random short id (u-xxxxx). Resuelve buscando
     *  el título primero en el propio quiz (campo nuevo temaTitulo),
     *  luego en el temario de la materia (DEMO_MATERIAS), fallback al id.
     */
    function listarTemasConTitulo(materiaId) {
        const todos = listarJuegosCanonical(materiaId);
        const map = {};
        // Index quiz por temaId con su temaTitulo si lo trae
        todos.forEach(j => {
            if (!j.temaId) return;
            if (!map[j.temaId]) map[j.temaId] = j.temaTitulo || null;
            if (!map[j.temaId] && j.temaTitulo) map[j.temaId] = j.temaTitulo;
        });
        // Cross-reference con el temario para los que no traen título
        const m = (typeof DEMO_MATERIAS !== "undefined")
            ? DEMO_MATERIAS.find(x => x.id === materiaId) : null;
        if (m && m.temario && Array.isArray(m.temario.unidades)) {
            m.temario.unidades.forEach(u => {
                if (map[u.id] === null || map[u.id] === undefined) {
                    // si u.id está en el map pero sin título, asignar
                    if (map.hasOwnProperty(u.id)) map[u.id] = u.titulo;
                }
                (u.subtemas || []).forEach(s => {
                    if (map.hasOwnProperty(s.id) && !map[s.id]) map[s.id] = s.titulo;
                });
            });
        }
        return Object.keys(map).map(id => ({ id, titulo: map[id] || id }));
    }

    return {
        listarJuegosCanonical,
        filtrarPorTema,
        replaysDelJugador,
        calcPopularidad,
        chipEstado,
        getMaxItems,
        statsHeroAlumno,
        statsHeroProfesor,
        listarTemasDeMateria,
        listarTemasConTitulo
    };
})();
window.JuegosData = JuegosData;
