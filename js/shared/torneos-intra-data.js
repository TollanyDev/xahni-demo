// js/shared/torneos-intra-data.js
// Slice torneos intragrupales S1 · 2026-06-09 · spec §3.4
//
// API TorneosIntraData: helpers puros sin DOM sobre DEMO_TORNEOS_INTRA.
// Consumers: js/profesor/torneos-intra.js, js/estudiante/torneos-intra.js,
// js/core/firestore-sync.js.

const TorneosIntraData = (() => {

    // ── Constantes ────────────────────────────────────────────────
    const MAX_PARTIDAS = 3;
    const XP_BASE_DEFAULT = 100; // calibrable cuando S3 conecte con juego.xpBase
    const XP_MULT = {
        1: 1.0,
        2: 0.7,
        3: 0.5,
        participacion: 0.2,
        ausente: 0
    };

    // ── Computar ranking lexicográfico ────────────────────────────
    function _mejorPartidaDeAlumno(partidasArr) {
        // Mejor intento del alumno: aciertos desc, luego tiempo asc.
        // Retorna la partida con el pico de aciertos (y entre empates, la más
        // rápida). Se usa solo para extraer aciertos + tiempoMejorMs del row;
        // el campo `partidas` del row es el TOTAL de partidas jugadas
        // (`ps.length`), siguiendo la regla del feature: "menor cantidad de
        // intentos = mejor".
        return partidasArr.slice().sort(function(a, b) {
            if (b.aciertos !== a.aciertos) return b.aciertos - a.aciertos;
            return a.tiempoMs - b.tiempoMs;
        })[0];
    }

    function _compareRankingRows(a, b) {
        // Lexicográfica entre alumnos (jugadores), después de tomar mejor partida.
        if (!a.jugo && !b.jugo) return 0;
        if (!a.jugo) return 1;
        if (!b.jugo) return -1;
        if (b.aciertos !== a.aciertos) return b.aciertos - a.aciertos;
        if (a.partidas !== b.partidas) return a.partidas - b.partidas;
        return a.tiempoMejorMs - b.tiempoMejorMs;
    }

    function computarRanking(torneo, partidasArr, alumnosDelGrupo) {
        // Agrupar partidas por uid
        const porUid = {};
        for (const p of partidasArr) {
            if (!porUid[p.uid]) porUid[p.uid] = [];
            porUid[p.uid].push(p);
        }

        // Construir filas por cada alumno del grupo
        const filas = alumnosDelGrupo.map(function(uid) {
            const ps = porUid[uid];
            if (!ps || ps.length === 0) {
                return {
                    uid,
                    aciertos: 0,
                    partidas: 0,
                    tiempoMejorMs: null,
                    score: null,
                    lugar: null,
                    jugo: false
                };
            }
            const mejor = _mejorPartidaDeAlumno(ps);
            return {
                uid,
                aciertos: mejor.aciertos,
                partidas: ps.length,
                tiempoMejorMs: mejor.tiempoMs,
                score: { acc: mejor.aciertos, par: ps.length, tms: mejor.tiempoMs },
                lugar: null,  // se asigna abajo
                jugo: true
            };
        });

        // Ordenar
        filas.sort(_compareRankingRows);

        // Asignar lugar con empate compartido
        let lugarActual = 1;
        let prev = null;
        let alumnosVistos = 0;  // jugadores procesados (incluye empates)
        for (const fila of filas) {
            if (!fila.jugo) {
                fila.lugar = null;
                continue;
            }
            alumnosVistos++;
            if (prev !== null && _compareRankingRows(prev, fila) === 0) {
                fila.lugar = prev.lugar;  // empate comparte
            } else {
                fila.lugar = alumnosVistos;
            }
            prev = fila;
        }

        return filas;
    }

    // ── Distribución XP por ranking ───────────────────────────────
    function getXpDistribucion(ranking, xpBase) {
        const base = xpBase || XP_BASE_DEFAULT;
        const result = {};
        for (const fila of ranking) {
            if (!fila.jugo) {
                result[fila.uid] = 0;
                continue;
            }
            const mult = XP_MULT[fila.lugar];
            if (mult !== undefined) {
                result[fila.uid] = Math.round(base * mult);
            } else {
                result[fila.uid] = Math.round(base * XP_MULT.participacion);
            }
        }
        return result;
    }

    // ── Estado derivado ───────────────────────────────────────────
    // Estados posibles:
    //   "finalizada" — cerrado (manual o por fechaCierre pasada)
    //   "borrador"   — sin fechaCierre definida
    //   "proxima"    — fechaInicio definida y aún no llegó
    //   "abierto"    — fechaCierre futura + (sin fechaInicio o fechaInicio ya pasó)
    function derivarEstado(torneo, now) {
        now = now || Date.now();
        if (torneo.cerradoEn) return "finalizada";
        if (torneo.estado === "finalizada") return "finalizada";
        if (torneo.fechaCierre && now >= torneo.fechaCierre) return "finalizada";
        if (!torneo.fechaCierre) return "borrador";
        // Si tiene fechaInicio y aún no llegó → estado "proxima"
        if (torneo.fechaInicio && now < torneo.fechaInicio) return "proxima";
        return "abierto";
    }

    // ── Helpers cache local ───────────────────────────────────────
    const LS_USER_CREATED_KEY = "xahni:torneoIntra:userCreated";
    const LS_PARTIDAS_KEY_PREFIX = "xahni:torneoIntra:partidas:";  // + torneoId

    function _readJSON(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) || fallback; }
        catch (e) { return fallback; }
    }
    function _writeJSON(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); }
        catch (e) { console.warn("[TorneosIntraData] write fail:", key, e); }
    }

    function _genId(prefix) {
        const rand = Math.random().toString(36).slice(2, 8);
        return prefix + "_" + rand;
    }

    function getUserCreated() {
        return _readJSON(LS_USER_CREATED_KEY, []);
    }

    function getAll() {
        // Mergea DEMO + user-created cache.
        // Dedup por id: en prod, hydrateOnLogin puede haber empujado un torneo
        // ya creado (userCreated localStorage) de vuelta a DEMO_TORNEOS_INTRA
        // vía Firestore, causando que aparezca dos veces en el grid.
        // Seeds tienen prioridad (traen el estado más fresco desde Firestore);
        // userCreated solo aporta entradas que aún no están en seeds.
        const seeds = (typeof DEMO_TORNEOS_INTRA !== "undefined" ? DEMO_TORNEOS_INTRA : []);
        const userCreated = getUserCreated();
        const seedIds = new Set(seeds.map(t => t.id));
        return seeds.concat(userCreated.filter(t => !seedIds.has(t.id)));
    }

    function getById(torneoId) {
        return getAll().find(t => t.id === torneoId) || null;
    }

    function crearTorneoIntra(data) {
        // data: { materiaId, grupoId, juegoId, fechaInicio?, fechaCierre, creadoPor, nombre? }
        // fechaInicio es opcional: si no se pasa → null (apertura inmediata, retro-compat).
        // nombre es opcional: si no se pasa o viene vacío, los renders caen al fallback
        // "Torneo intra · {materia}".
        const nombreTrim = typeof data.nombre === "string" ? data.nombre.trim() : "";
        const torneo = {
            id: _genId("tin"),
            nombre: nombreTrim || null,
            materiaId: data.materiaId,
            grupoId: data.grupoId,
            juegoId: data.juegoId,
            creadoPor: data.creadoPor,
            creadoEn: Date.now(),
            fechaInicio: data.fechaInicio != null ? data.fechaInicio : null,
            fechaCierre: data.fechaCierre,
            estado: "abierto",
            cerradoEn: null,
            cerradoPor: null,
            ganadorUid: null,
            ranking: null
        };
        const userCreated = getUserCreated();
        userCreated.push(torneo);
        _writeJSON(LS_USER_CREATED_KEY, userCreated);

        // Dispatch para firestore-sync
        try {
            document.dispatchEvent(new CustomEvent("xahni:torneoIntraCreado", {
                detail: { torneo }
            }));
        } catch (e) { /* defensive */ }

        return torneo;
    }

    // ── Partidas (cache local + dispatch) ─────────────────────────
    function _partidasKey(torneoId) {
        return LS_PARTIDAS_KEY_PREFIX + torneoId;
    }

    function getPartidasTorneo(torneoId) {
        return _readJSON(_partidasKey(torneoId), []);
    }

    function getPartidasAlumno(torneoId, uid) {
        return getPartidasTorneo(torneoId).filter(p => p.uid === uid);
    }

    function registrarPartida(torneoId, uid, aciertos, tiempoMs) {
        const partidasAlum = getPartidasAlumno(torneoId, uid);
        if (partidasAlum.length >= MAX_PARTIDAS) {
            return { ok: false, error: "cap_excedido" };
        }
        const partida = {
            id: _genId("part"),
            uid,
            numPartida: partidasAlum.length + 1,
            aciertos,
            tiempoMs,
            jugadaEn: Date.now()
        };
        const todas = getPartidasTorneo(torneoId);
        todas.push(partida);
        _writeJSON(_partidasKey(torneoId), todas);

        try {
            document.dispatchEvent(new CustomEvent("xahni:torneoIntraJugado", {
                detail: { torneoId, uid, partida }
            }));
        } catch (e) { /* defensive */ }

        return { ok: true, partida };
    }

    // ── Cierre del torneo ─────────────────────────────────────────
    function cerrarTorneo(torneoId, cerradoPor, alumnosDelGrupo, xpBase) {
        const torneo = getById(torneoId);
        if (!torneo) return { ok: false, error: "no_existe" };
        if (torneo.cerradoEn) return { ok: false, error: "ya_cerrado" };

        const partidas = getPartidasTorneo(torneoId);
        const ranking = computarRanking(torneo, partidas, alumnosDelGrupo);
        const xpDist = getXpDistribucion(ranking, xpBase || XP_BASE_DEFAULT);
        const ganador = ranking.find(r => r.lugar === 1);
        const ganadorUid = ganador ? ganador.uid : null;
        const ahora = Date.now();

        // Update cache local userCreated (localStorage)
        const userCreated = getUserCreated();
        const idx = userCreated.findIndex(t => t.id === torneoId);
        if (idx >= 0) {
            userCreated[idx] = Object.assign({}, userCreated[idx], {
                estado: "finalizada",
                cerradoEn: ahora,
                cerradoPor: cerradoPor,
                ganadorUid: ganadorUid,
                ranking: ranking
            });
            _writeJSON(LS_USER_CREATED_KEY, userCreated);
        }

        // Bug 2026-06-09: mutar también DEMO_TORNEOS_INTRA in-place si el torneo
        // está ahí (hidratado desde Firestore al login). Sin esto, el dedup en
        // getAll() prioriza el seed sin cerradoEn sobre el userCreated actualizado,
        // y la card requería F5 para reflejar el cierre. Mutación in-place
        // mantiene la referencia + emite el estado nuevo al próximo getAll.
        if (typeof DEMO_TORNEOS_INTRA !== "undefined" && Array.isArray(DEMO_TORNEOS_INTRA)) {
            const seedIdx = DEMO_TORNEOS_INTRA.findIndex(t => t.id === torneoId);
            if (seedIdx >= 0) {
                DEMO_TORNEOS_INTRA[seedIdx] = Object.assign({}, DEMO_TORNEOS_INTRA[seedIdx], {
                    estado: "finalizada",
                    cerradoEn: ahora,
                    cerradoPor: cerradoPor,
                    ganadorUid: ganadorUid,
                    ranking: ranking
                });
            }
        }

        // Bug 2026-06-09: distribución LOCAL de XP a alumnos premiados.
        // Antes, cerrarTorneo solo calculaba xpDist y lo dispatchaba — la
        // persistencia a Firestore vía batch increment en firestore-sync
        // ocurría, pero el localStorage del cerrador NO se actualizaba,
        // así que los renderers reactivos (perfil del alumno, modal público,
        // rankings) no veían la XP hasta el próximo re-login. Y además había
        // race con el set-merge de persistGamerState porque el shape local
        // no estaba sincronizado.
        // Fix: llamar GamerState.addXp por cada uid premiado. Esto muta el
        // localStorage local con la XP nueva + dispatcha xahni:gamerUpdated
        // que persistGamerState (set merge) replica a Firestore.
        // Importante: el listener xahni:torneoIntraTerminado de firestore-sync
        // YA NO debe hacer batch increment, porque ahora cada addXp dispara
        // su propio persistGamerState. Se eliminó el batch para evitar doble
        // suma — ver firestore-sync.js persistTorneoIntraCierre.
        if (typeof GamerState !== "undefined" && typeof GamerState.addXp === "function") {
            Object.entries(xpDist).forEach(([uid, xp]) => {
                if (xp > 0) {
                    GamerState.addXp(uid, xp, {
                        fuente: "torneo-intra",
                        torneoId: torneoId,
                        lugar: ranking.find(r => r.uid === uid)?.lugar
                    });
                }
            });
        }

        // Spec A 2026-06-09 task 4: XP pasiva creator-economy intra al profesor que
        // creó el torneo. Fórmula: total_aciertos_de_todos_los_intentos × 0.5.
        // Premia la calidad del contenido (juegos que generan respuestas correctas),
        // no engagement ni desempeño individual. Distinta de la inter que premia
        // lugar grupal del competidor.
        if (torneo.creadoPor) {
            const totalAciertos = partidas.reduce((sum, p) => sum + (p.aciertos || 0), 0);
            const xpPasivoIntra = Math.floor(totalAciertos * 0.5);
            if (xpPasivoIntra > 0 && typeof GamerState !== "undefined" && GamerState.addXp) {
                GamerState.addXp(torneo.creadoPor, xpPasivoIntra, {
                    fuente: "torneo_intra_pasivo",
                    torneoId: torneoId,
                    totalAciertos: totalAciertos
                });
            }
        }

        // Dispatch para firestore-sync
        try {
            document.dispatchEvent(new CustomEvent("xahni:torneoIntraTerminado", {
                detail: {
                    torneoId,
                    ganadorUid,
                    ranking,
                    cerradoPor,
                    cerradoEn: ahora,
                    xpDist
                }
            }));
        } catch (e) { /* defensive */ }

        return { ok: true, ranking, ganadorUid, xpDist };
    }

    // Expuestos para tests
    return {
        MAX_PARTIDAS,
        XP_BASE_DEFAULT,
        XP_MULT,
        derivarEstado,
        computarRanking,
        getXpDistribucion,
        getAll,
        getById,
        getUserCreated,
        crearTorneoIntra,
        getPartidasTorneo,
        getPartidasAlumno,
        registrarPartida,
        cerrarTorneo
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = TorneosIntraData;
}

if (typeof window !== "undefined") {
    window.TorneosIntraData = TorneosIntraData;
}
