// js/core/firestore-sync.js
// Sprint entrega 2026-06-08 · Firebase deploy provisional
//
// Capa de sincronización entre runtime vanilla (localStorage cache) y
// Firestore. Solo activa cuando APP_CONFIG.mode === 'prod' Y Firebase
// está inicializado. Hooks:
//   - Hydration al login (GamerState + UserJuegos desde Firestore →
//     localStorage cache para reads sincrónicos).
//   - Persistencia write-through en eventos cross-módulo:
//     · xahni:gamerUpdated → /gamerState/{uid}
//     · xahni:insigniaUnlocked → /gamerState/{uid}
//     · UserJuegos add/remove → /juegosUserCreated/{id}
//     · declararGanador → /competencias/{id} update
//
// Patrón "fire and forget" para escrituras (no bloquea UI). Errores se
// loggean a consola pero no abortan el flujo.

const FirestoreSync = (() => {

    function _isProd() {
        return typeof APP_CONFIG !== "undefined"
            && APP_CONFIG.mode === "prod"
            && typeof fbReady === "function"
            && fbReady();
    }

    /**
     * @interaction firestore-hydrate-on-login
     * @scope core-firestore-sync-hydration
     *
     * Given uid del usuario que acaba de iniciar sesión.
     * When auth flow (handleLogin / handleSignup) completa exitosamente.
     * Then async carga en paralelo:
     *   1. /gamerState/{uid} → set en GamerState cache (localStorage).
     *   2. /juegosUserCreated query creadoPor=uid → guarda en cache local.
     *   Y luego firma evento xahni:firestoreHydrated para que listeners
     *   re-rendereen perfil/dashboard con data fresca.
     * Edge:
     *   - Modo demo → no-op silencioso.
     *   - Firestore unavailable → log warn, GamerState mantiene defaults.
     *   - Doc gamerState ausente → crea defaults (0/L1/[]/[]).
     */
    async function hydrateOnLogin(uid) {
        if (!_isProd() || !uid) return;
        const db = fbDb();

        // GamerState hydration.
        try {
            const snap = await db.collection("gamerState").doc(uid).get();
            if (snap.exists) {
                const data = snap.data() || {};
                const state = {
                    xp: Number(data.xp) || 0,
                    nivel: Number(data.nivel) || 1,
                    insignias: Array.isArray(data.insignias) ? data.insignias : [],
                    jugadas: Array.isArray(data.jugadas) ? data.jugadas : []
                };
                if (typeof GamerState !== "undefined" && GamerState.set) {
                    GamerState.set(uid, state);
                }
            } else {
                // Doc ausente — sembrar defaults Firestore-side.
                const defaults = {
                    uid,
                    xp: 0,
                    nivel: 1,
                    insignias: [],
                    jugadas: [],
                    actualizadoEn: fbServerTs()
                };
                await db.collection("gamerState").doc(uid).set(defaults);
                if (typeof GamerState !== "undefined" && GamerState.set) {
                    GamerState.set(uid, { xp: 0, nivel: 1, insignias: [], jugadas: [] });
                }
            }
        } catch (e) {
            console.warn("[FirestoreSync] hydrate gamerState fail", e);
        }

        // UserJuegos hydration: traer TODOS los juegos user-created cuyas
        // materiaId aparecen en las materias del usuario actual (suyo + de su
        // profesor + de cualquier otro creador en la misma materia).
        //
        // Bug detectado en smoke Flow 5 (2026-06-08): la query anterior
        // filtraba por creadoPor == uid → el alumno solo veía sus propias
        // creaciones, nunca los quizzes que el profesor creaba para su materia.
        // Fix: filtrar por materiaId que el usuario consume.
        try {
            const userObj = (typeof DEMO_USERS !== 'undefined')
                ? DEMO_USERS.find(u => u.id === uid)
                : null;
            const materiaIds = userObj && Array.isArray(userObj.materias) ? userObj.materias : [];
            const remote = [];
            if (materiaIds.length > 0) {
                // Firestore where-in limita a 10 valores; los usuarios típicos
                // tienen <10 materias, así que está dentro de límites.
                const qs = await db.collection("juegosUserCreated")
                    .where("materiaId", "in", materiaIds.slice(0, 10))
                    .get();
                qs.forEach(doc => remote.push(doc.data()));
            }
            // Sobreescribe localStorage cache con remotos (autoridad Firestore en prod).
            try { localStorage.setItem(USER_JUEGOS_KEY, JSON.stringify(remote)); } catch (e) {}
        } catch (e) {
            console.warn("[FirestoreSync] hydrate userJuegos fail", e);
        }

        // Examenes hydration: examenes activos del usuario + sus respuestas/calificaciones.
        try {
            const userObj = (typeof DEMO_USERS !== 'undefined')
                ? DEMO_USERS.find(u => u.id === uid)
                : null;
            const materiaIds = userObj && Array.isArray(userObj.materias) ? userObj.materias : [];
            if (materiaIds.length > 0) {
                const examQs = await db.collection('examenes').where('materiaId', 'in', materiaIds.slice(0, 10)).get();
                const examenesRemote = [];
                examQs.forEach(doc => examenesRemote.push({ id: doc.id, ...doc.data() }));
                if (typeof DEMO_EXAMENES !== 'undefined') {
                    DEMO_EXAMENES.length = 0;
                    examenesRemote.forEach(e => DEMO_EXAMENES.push(e));
                }
                // Respuestas + calificaciones del uid por cada examen activo.
                await Promise.all(examenesRemote.map(async e => {
                    try {
                        const rSnap = await db.collection('examenes').doc(e.id).collection('respuestas').doc(uid).get();
                        if (rSnap.exists) {
                            try { localStorage.setItem('xahni:examenes:respuestas:' + e.id + ':' + uid, JSON.stringify(rSnap.data())); } catch (_) {}
                        }
                        const cSnap = await db.collection('examenes').doc(e.id).collection('calificaciones').doc(uid).get();
                        if (cSnap.exists) {
                            try { localStorage.setItem('xahni:examenes:calificaciones:' + e.id + ':' + uid, JSON.stringify(cSnap.data())); } catch (_) {}
                        }
                    } catch (e) { /* defensive per examen */ }
                }));
            }
        } catch (e) {
            console.warn("[FirestoreSync] hydrate examenes fail", e);
        }

        // Escalas hydration: query por materias del usuario (profesor o alumno).
        try {
            const userObj = (typeof DEMO_USERS !== 'undefined')
                ? DEMO_USERS.find(u => u.id === uid)
                : null;
            const materiaIds = userObj && Array.isArray(userObj.materias) ? userObj.materias : [];
            if (materiaIds.length > 0 && typeof DEMO_ESCALAS !== 'undefined') {
                const escQs = await db.collection('escalas')
                    .where('materiaId', 'in', materiaIds.slice(0, 10))
                    .get();
                const escalasRemote = [];
                escQs.forEach(doc => escalasRemote.push(doc.data()));
                if (escalasRemote.length > 0) {
                    DEMO_ESCALAS.length = 0;
                    escalasRemote.forEach(e => DEMO_ESCALAS.push(e));
                }
            }
        } catch (e) {
            console.warn("[FirestoreSync] hydrate escalas fail", e);
        }

        // Grupo members hydration: avatar + gamerState de los OTROS miembros
        // del grupo del usuario, para que las cards b1-mg-body__member-card,
        // el modal perfil público y los rankings muestren valores reales en
        // lugar de defaults (puntos:0, nivel:1, sin fotoId/bannerId/etc).
        try {
            const userObj = (typeof DEMO_USERS !== 'undefined')
                ? DEMO_USERS.find(u => u.id === uid)
                : null;
            const grupoIds = userObj && Array.isArray(userObj.grupos) ? userObj.grupos : [];
            if (grupoIds.length > 0 && typeof DEMO_USERS !== 'undefined') {
                // Firestore array-contains-any limita a 10 grupos por query
                const usuariosSnap = await db.collection('usuarios')
                    .where('grupos', 'array-contains-any', grupoIds.slice(0, 10))
                    .get();
                const otherUids = [];
                usuariosSnap.forEach(doc => {
                    const data = doc.data() || {};
                    const otherUid = data.uid || doc.id;
                    if (otherUid === uid) return;
                    // Update o insert en DEMO_USERS
                    let other = DEMO_USERS.find(u => u.id === otherUid);
                    if (!other) {
                        other = {
                            id: otherUid,
                            uid: otherUid,
                            email: data.email,
                            nombre: data.nombre,
                            iniciales: data.iniciales || (data.nombre || '').slice(0,2).toUpperCase(),
                            tipo: data.tipo,
                            grupos: data.grupos || [],
                            materias: data.materias || [],
                            grupoId: data.grupoId,
                            puntos: data.puntos || 0,
                            nivel: data.nivel || 1,
                            gamer: data.gamer || {}
                        };
                        DEMO_USERS.push(other);
                    } else {
                        // Solo refrescar campos custom del avatar + scoring
                        other.puntos = data.puntos || other.puntos || 0;
                        other.nivel  = data.nivel  || other.nivel  || 1;
                        other.gamer = other.gamer || {};
                        if (data.gamer) {
                            if (data.gamer.fotoId       !== undefined) other.gamer.fotoId = data.gamer.fotoId;
                            if (data.gamer.marcoId      !== undefined) other.gamer.marcoId = data.gamer.marcoId;
                            if (data.gamer.bannerId     !== undefined) other.gamer.bannerId = data.gamer.bannerId;
                            if (data.gamer.tituloActivo !== undefined) other.gamer.tituloActivo = data.gamer.tituloActivo;
                        }
                    }
                    otherUids.push(otherUid);
                });

                // Batch read gamerState de cada miembro para tener XP/nivel/insignias reales
                await Promise.all(otherUids.map(async (oUid) => {
                    try {
                        const gsSnap = await db.collection('gamerState').doc(oUid).get();
                        if (!gsSnap.exists) return;
                        const gs = gsSnap.data() || {};
                        const other = DEMO_USERS.find(u => u.id === oUid);
                        if (!other) return;
                        other.gamer = other.gamer || {};
                        if (gs.xp        != null) other.gamer.xp = Number(gs.xp);
                        if (gs.nivel     != null) other.gamer.nivel = Number(gs.nivel);
                        if (Array.isArray(gs.insignias)) other.gamer.insignias = gs.insignias;
                        if (Array.isArray(gs.jugadas))   other.gamer.jugadas   = gs.jugadas;
                        // puntos legacy mirror para consumers que leen u.puntos / u.nivel
                        other.puntos = Number(gs.xp) || other.puntos || 0;
                        other.nivel  = Number(gs.nivel) || other.nivel || 1;
                        // Cache local en GamerState para que getAvatarDisplay sincronice
                        if (typeof GamerState !== 'undefined' && GamerState.set) {
                            GamerState.set(oUid, {
                                xp: Number(gs.xp) || 0,
                                nivel: Number(gs.nivel) || 1,
                                insignias: gs.insignias || [],
                                jugadas: gs.jugadas || []
                            });
                        }
                    } catch (e) { /* defensive per uid */ }
                }));
            }
        } catch (e) {
            console.warn("[FirestoreSync] hydrate grupo members fail", e);
        }

        // ═══════════════════════════════════════════════════════════
        // Sweep 2026-06-08 — hidratación de los 10 huérfanos cubiertos
        // por los listeners nuevos. Cada bloque es defensive: una falla
        // en cualquiera NO aborta los demás (logs warn y sigue).
        // ═══════════════════════════════════════════════════════════

        // Kudos: lee snapshot full array desde kudos/{uid}.
        try {
            const snap = await db.collection("kudos").doc(uid).get();
            if (snap.exists) {
                const data = snap.data() || {};
                const items = Array.isArray(data.items) ? data.items : [];
                try { localStorage.setItem("xahni_kudos_" + uid, JSON.stringify(items)); } catch (_) {}
            }
        } catch (e) {
            console.warn("[FirestoreSync] hydrate kudos fail", e);
        }

        // Top3 maestrías: lee userPrefs/{uid}.top3Maestria.
        try {
            const snap = await db.collection("userPrefs").doc(uid).get();
            if (snap.exists) {
                const data = snap.data() || {};
                if (Array.isArray(data.top3Maestria) && data.top3Maestria.length > 0) {
                    try { localStorage.setItem("xahni_top3_maestria_" + uid, JSON.stringify(data.top3Maestria)); } catch (_) {}
                }
            }
        } catch (e) {
            console.warn("[FirestoreSync] hydrate top3 maestria fail", e);
        }

        // Replays: lee replays/{uid}.juegos como map → hidrata cada key
        // xahni:replays:{uid}:{juegoId} individual para que creator-economy
        // los lea sin cambios en su código.
        try {
            const snap = await db.collection("replays").doc(uid).get();
            if (snap.exists) {
                const data = snap.data() || {};
                const juegos = data.juegos || {};
                Object.keys(juegos).forEach(juegoId => {
                    const count = juegos[juegoId];
                    if (typeof count === "number" && count > 0) {
                        try { localStorage.setItem("xahni:replays:" + uid + ":" + juegoId, String(count)); } catch (_) {}
                    }
                });
            }
        } catch (e) {
            console.warn("[FirestoreSync] hydrate replays fail", e);
        }

        // NotaRubro: query subcoll materias/{matId} del usuario, hidrata
        // cada key xahni:examenes:notaRubro:{uid}:{matId}:P{n}:{rubroId}
        // individual para calificaciones-calc._calRatio.
        try {
            const matsSnap = await db.collection("notaRubro").doc(uid)
                .collection("materias").get();
            matsSnap.forEach(matDoc => {
                const matId = matDoc.id;
                const data = matDoc.data() || {};
                ["P1", "P2", "P3"].forEach(parcial => {
                    const rubros = data[parcial] || {};
                    Object.keys(rubros).forEach(rubroId => {
                        const payload = rubros[rubroId];
                        if (!payload) return;
                        const key = "xahni:examenes:notaRubro:" + uid + ":" + matId + ":" + parcial + ":" + rubroId;
                        try { localStorage.setItem(key, JSON.stringify(payload)); } catch (_) {}
                    });
                });
            });
        } catch (e) {
            console.warn("[FirestoreSync] hydrate notaRubro fail", e);
        }

        // Entregas: query subcoll items/{tareaId} → reconstruir array
        // xahni_entregas_{uid} con shape {tareaId, fecha, archivos, comentario}.
        try {
            const entSnap = await db.collection("entregas").doc(uid)
                .collection("items").get();
            const arr = [];
            entSnap.forEach(doc => {
                const data = doc.data() || {};
                arr.push(Object.assign({ tareaId: doc.id }, data));
            });
            if (arr.length > 0) {
                try { localStorage.setItem("xahni_entregas_" + uid, JSON.stringify(arr)); } catch (_) {}
            }
        } catch (e) {
            console.warn("[FirestoreSync] hydrate entregas fail", e);
        }

        // Historial extra: snapshot full array.
        try {
            const snap = await db.collection("historialExtra").doc(uid).get();
            if (snap.exists) {
                const data = snap.data() || {};
                const items = Array.isArray(data.items) ? data.items : [];
                try { localStorage.setItem("xahni_historial_extra_" + uid, JSON.stringify(items)); } catch (_) {}
            }
        } catch (e) {
            console.warn("[FirestoreSync] hydrate historial extra fail", e);
        }

        // Recursos vistos: snapshot full array.
        try {
            const snap = await db.collection("recursosVistos").doc(uid).get();
            if (snap.exists) {
                const data = snap.data() || {};
                const items = Array.isArray(data.items) ? data.items : [];
                try { localStorage.setItem("xahni_recursos_vistos_" + uid, JSON.stringify(items)); } catch (_) {}
            }
        } catch (e) {
            console.warn("[FirestoreSync] hydrate recursos vistos fail", e);
        }

        // Maestria: subcoll maestria/{uid}/materias/{matId} → poblar
        // DEMO_MAESTRIA[uid][matId] runtime. Gap descubierto durante smoke:
        // la persistencia vía xahni:maestriaActualizada ya existía pre-sweep,
        // pero la hidratación al login nunca cargaba esta colección, dejando
        // DEMO_MAESTRIA vacío en device nuevo → selector Top 3 no detectaba
        // materias con mastery > 0.
        try {
            const matsSnap = await db.collection("maestria").doc(uid)
                .collection("materias").get();
            if (!matsSnap.empty) {
                if (typeof DEMO_MAESTRIA === 'undefined') {
                    window.DEMO_MAESTRIA = {};
                }
                if (!DEMO_MAESTRIA[uid]) DEMO_MAESTRIA[uid] = {};
                matsSnap.forEach(matDoc => {
                    DEMO_MAESTRIA[uid][matDoc.id] = matDoc.data();
                });
            }
        } catch (e) {
            console.warn("[FirestoreSync] hydrate maestria fail", e);
        }

        // Temario IA Suggestions (Sweep 2026-06-09 Temario+IA):
        // Hidrata las sugerencias IA del temario del profesor para cada una de
        // sus materias. Solo aplica si user.tipo === 'profesor'. Permite que al
        // cambiar de dispositivo el profesor siga viendo el batch IA actual desde
        // la misma idea donde lo dejó. Cap-aware (lotesGeneradosCount preservado).
        //
        // Lazy: los iaJuegos por (profesor, tema) NO se hidratan al login para
        // evitar N queries (N temas × M materias). Se cargan on-demand desde
        // el modal "Generar juego".
        try {
            const userObj = (typeof DEMO_USERS !== 'undefined')
                ? DEMO_USERS.find(u => u.id === uid) : null;
            if (userObj && userObj.tipo === 'profesor'
                && Array.isArray(userObj.materias) && userObj.materias.length > 0) {
                const mats = userObj.materias.slice(0, 10);
                await Promise.all(mats.map(async (matId) => {
                    try {
                        const snap = await db.collection('materias').doc(matId)
                            .collection('iaSuggestions').doc(uid).get();
                        if (snap.exists) {
                            const key = 'xahni:iaTemario:' + matId + ':' + uid;
                            try { localStorage.setItem(key, JSON.stringify(snap.data())); }
                            catch (_) { /* defensive */ }
                        }
                    } catch (e) { /* defensive per materia */ }
                }));
            }
        } catch (e) {
            console.warn('[FirestoreSync] hydrate iaSuggestions temario fail', e);
        }

        // TorneosIntra hydration: torneos donde el usuario es del grupo participante o creador.
        try {
            const userObj = (typeof DEMO_USERS !== 'undefined')
                ? DEMO_USERS.find(u => u.id === uid)
                : null;
            const grupoIds = userObj && Array.isArray(userObj.grupos) ? userObj.grupos : [];

            const torneosRemote = [];

            // Para alumnos: por grupoId
            if (grupoIds.length > 0) {
                const qsAlum = await db.collection("torneosIntra")
                    .where("grupoId", "in", grupoIds.slice(0, 10))
                    .get();
                qsAlum.forEach(doc => torneosRemote.push({ id: doc.id, ...doc.data() }));
            }

            // Para profesores: por creadoPor
            const qsProf = await db.collection("torneosIntra")
                .where("creadoPor", "==", uid)
                .get();
            qsProf.forEach(doc => {
                if (!torneosRemote.find(t => t.id === doc.id)) {
                    torneosRemote.push({ id: doc.id, ...doc.data() });
                }
            });

            // Sobreescribir DEMO_TORNEOS_INTRA (autoridad Firestore en prod)
            if (typeof DEMO_TORNEOS_INTRA !== 'undefined') {
                DEMO_TORNEOS_INTRA.length = 0;
                torneosRemote.forEach(t => DEMO_TORNEOS_INTRA.push(t));
            }
            console.info("[ti-metric] hydrate torneosIntra", torneosRemote.length, "torneos");

            // Bug crítico 2026-06-09: hidratar partidas cross-device de cada torneo
            // intra para que cerrarTorneo / calcularRanking / mini-ranking vean los
            // attempts de TODOS los participantes, no solo los del propio dispositivo.
            // Sin esta hidratación, getPartidasTorneo (que lee localStorage local)
            // ignora silenciosamente las partidas registradas en otros dispositivos.
            try {
                await Promise.all(torneosRemote.map(async (t) => {
                    const partidasSnap = await db.collection("torneosIntra").doc(t.id)
                        .collection("partidas").get();
                    if (partidasSnap.empty) return;
                    const partidas = [];
                    partidasSnap.forEach(doc => {
                        const d = doc.data();
                        // Normalizar shape: registrarPartida persiste {id, uid, numPartida,
                        // aciertos, tiempoMs, jugadaEn}. Algunos docs pueden tener
                        // jugadaEn como Firestore Timestamp; convertir a millis.
                        const jugadaEn = (d.jugadaEn && typeof d.jugadaEn.toMillis === "function")
                            ? d.jugadaEn.toMillis()
                            : (typeof d.jugadaEn === "number" ? d.jugadaEn : Date.now());
                        partidas.push({
                            id: d.id || doc.id,
                            uid: d.uid,
                            numPartida: d.numPartida,
                            aciertos: d.aciertos || 0,
                            tiempoMs: d.tiempoMs || 0,
                            jugadaEn: jugadaEn
                        });
                    });
                    try {
                        localStorage.setItem(`xahni:torneoIntra:partidas:${t.id}`, JSON.stringify(partidas));
                    } catch (e) { /* defensive */ }
                }));
                console.info("[ti-metric] hydrate partidas intra OK", torneosRemote.length);
            } catch (e) {
                console.warn("[ti-error] hydrate partidas intra fail", e);
            }
        } catch (e) {
            console.warn("[ti-error] hydrate torneosIntra fail", e);
        }

        // Bug crítico 2026-06-09: hidratar attempts cross-device de competencias inter.
        // Misma raíz que las partidas intra: getAttempts lee localStorage local, así que
        // cerrarTorneo / calcularRanking no detectan los intentos de otros alumnos.
        // Iteramos sobre los torneos visibles (DEMO_COMPETENCIAS + userCreated) para
        // hidratar sus subcolecciones intentos/{uid_attemptN}.
        try {
            const compsSeeds = (typeof DEMO_COMPETENCIAS !== 'undefined' && Array.isArray(DEMO_COMPETENCIAS))
                ? DEMO_COMPETENCIAS : [];
            let compsUser = [];
            try { compsUser = JSON.parse(localStorage.getItem("xahni:comp:userCreatedTorneos") || "[]"); }
            catch (e) { compsUser = []; }
            const compIds = new Set();
            const compsAll = [];
            compsSeeds.forEach(c => { if (c.id && !compIds.has(c.id)) { compIds.add(c.id); compsAll.push(c); } });
            compsUser.forEach(c => { if (c.id && !compIds.has(c.id)) { compIds.add(c.id); compsAll.push(c); } });

            await Promise.all(compsAll.map(async (c) => {
                try {
                    const intentosSnap = await db.collection("competencias").doc(c.id)
                        .collection("intentos").get();
                    if (intentosSnap.empty) return;
                    const attemptsPorUid = {};
                    intentosSnap.forEach(doc => {
                        const d = doc.data();
                        const u = d.uid;
                        if (!u || typeof d.score !== "number") return;
                        const fechaIso = (d.fecha && typeof d.fecha.toDate === "function")
                            ? d.fecha.toDate().toISOString()
                            : (typeof d.fecha === "string" ? d.fecha : new Date().toISOString());
                        (attemptsPorUid[u] = attemptsPorUid[u] || []).push({
                            score: d.score,
                            intento: d.attemptN || 1,
                            fecha: fechaIso
                        });
                    });
                    Object.entries(attemptsPorUid).forEach(([u, arr]) => {
                        arr.sort((a, b) => a.intento - b.intento);
                        try {
                            localStorage.setItem(`xahni:comp:attempts:${c.id}:${u}`, JSON.stringify(arr));
                        } catch (e) { /* defensive */ }
                    });
                } catch (e) { /* defensive per-torneo */ }
            }));
            console.info("[comp-metric] hydrate attempts inter OK", compsAll.length);
        } catch (e) {
            console.warn("[comp-error] hydrate attempts inter fail", e);
        }

        try {
            document.dispatchEvent(new CustomEvent("xahni:firestoreHydrated", { detail: { uid } }));
        } catch (e) { /* defensive */ }
    }
    window.firestoreHydrateOnLogin = hydrateOnLogin;

    /**
     * Rehidratar partidas de un torneo intra específico desde Firestore.
     * Failsafe pre-cierre para garantizar que cerrarTorneo ve TODOS los attempts
     * registrados cross-device, incluso los hechos después del login del cerrador.
     * Reutiliza la misma normalización que el hydrate al login.
     */
    async function rehydratePartidasTorneoIntra(torneoId) {
        if (!_isProd() || !torneoId) return;
        try {
            const partidasSnap = await fbDb().collection("torneosIntra").doc(torneoId)
                .collection("partidas").get();
            const partidas = [];
            partidasSnap.forEach(doc => {
                const d = doc.data();
                const jugadaEn = (d.jugadaEn && typeof d.jugadaEn.toMillis === "function")
                    ? d.jugadaEn.toMillis()
                    : (typeof d.jugadaEn === "number" ? d.jugadaEn : Date.now());
                partidas.push({
                    id: d.id || doc.id,
                    uid: d.uid,
                    numPartida: d.numPartida,
                    aciertos: d.aciertos || 0,
                    tiempoMs: d.tiempoMs || 0,
                    jugadaEn: jugadaEn
                });
            });
            localStorage.setItem(`xahni:torneoIntra:partidas:${torneoId}`, JSON.stringify(partidas));
            console.info("[ti-metric] rehydrate partidas pre-cierre", torneoId, partidas.length);
        } catch (e) {
            console.warn("[ti-error] rehydrate partidas fail", torneoId, e);
        }
    }
    window.firestoreRehydratePartidasTorneoIntra = rehydratePartidasTorneoIntra;

    /**
     * Rehidratar attempts de una competencia inter específica desde Firestore.
     * Failsafe pre-cierre análogo al de intra. Reagrupa los docs intentos/{uid_attemptN}
     * por uid y escribe el array completo al localStorage de cada uid.
     */
    async function rehydrateAttemptsCompetencia(compId) {
        if (!_isProd() || !compId) return;
        try {
            const intentosSnap = await fbDb().collection("competencias").doc(compId)
                .collection("intentos").get();
            const attemptsPorUid = {};
            intentosSnap.forEach(doc => {
                const d = doc.data();
                const u = d.uid;
                if (!u || typeof d.score !== "number") return;
                const fechaIso = (d.fecha && typeof d.fecha.toDate === "function")
                    ? d.fecha.toDate().toISOString()
                    : (typeof d.fecha === "string" ? d.fecha : new Date().toISOString());
                (attemptsPorUid[u] = attemptsPorUid[u] || []).push({
                    score: d.score,
                    intento: d.attemptN || 1,
                    fecha: fechaIso
                });
            });
            Object.entries(attemptsPorUid).forEach(([u, arr]) => {
                arr.sort((a, b) => a.intento - b.intento);
                localStorage.setItem(`xahni:comp:attempts:${compId}:${u}`, JSON.stringify(arr));
            });
            console.info("[comp-metric] rehydrate attempts pre-cierre", compId, Object.keys(attemptsPorUid).length, "uids");
        } catch (e) {
            console.warn("[comp-error] rehydrate attempts fail", compId, e);
        }
    }
    window.firestoreRehydrateAttemptsCompetencia = rehydrateAttemptsCompetencia;

    /**
     * @interaction firestore-persist-user-avatar
     * @scope core-firestore-sync-persist
     *
     * Given uid + partial gamer (subset de {fotoId, marcoId, bannerId, tituloActivo}).
     * When perfil-avatar._saveAvatarState o perfil-identidad._saveIdentidad
     *   detectan cambio del usuario actual.
     * Then merge-set en usuarios/{uid}.gamer.<campo> para los campos provistos.
     *   Permite que el cambio aparezca en otros dispositivos al re-login y
     *   en el modal perfil público que otros usuarios abren sobre este uid.
     * Edge:
     *   - Modo demo → no-op.
     *   - partialGamer vacío/null → no-op.
     *   - Firestore write fail → log warn, NO se desincroniza el cache local.
     */
    async function persistUserAvatar(uid, partialGamer) {
        if (!_isProd() || !uid || !partialGamer) return;
        const fields = {};
        ["fotoId", "marcoId", "bannerId", "tituloActivo"].forEach((k) => {
            if (partialGamer[k] !== undefined) fields["gamer." + k] = partialGamer[k];
        });
        if (Object.keys(fields).length === 0) return;
        try {
            await fbDb().collection("usuarios").doc(uid).update(fields);
        } catch (e) {
            console.warn("[FirestoreSync] persistUserAvatar fail", e);
        }
    }
    window.firestorePersistUserAvatar = persistUserAvatar;

    /**
     * @interaction firestore-persist-gamerstate
     * @scope core-firestore-sync-persist
     *
     * Given uid + GamerState actualizado en cache local.
     * When listener de xahni:gamerUpdated o xahni:insigniaUnlocked detecta cambio.
     * Then merge-set en /gamerState/{uid} con xp + nivel + insignias + jugadas +
     *   actualizadoEn serverTimestamp.
     * Edge:
     *   - Modo demo → no-op.
     *   - Firestore write fail → log warn, NO se desincroniza el cache.
     */
    async function persistGamerState(uid) {
        if (!_isProd() || !uid) return;
        if (typeof GamerState === "undefined") return;
        const state = GamerState.get(uid);
        try {
            await fbDb().collection("gamerState").doc(uid).set({
                uid,
                xp: state.xp || 0,
                nivel: state.nivel || 1,
                insignias: state.insignias || [],
                jugadas: state.jugadas || [],
                actualizadoEn: fbServerTs()
            }, { merge: true });
        } catch (e) {
            console.warn("[FirestoreSync] persistGamerState fail", e);
        }
    }

    async function persistUserJuego(juego) {
        if (!_isProd() || !juego || !juego.id) return;
        try {
            await fbDb().collection("juegosUserCreated").doc(juego.id).set(
                Object.assign({}, juego, { creadoEn: fbServerTs() })
            );
        } catch (e) {
            console.warn("[FirestoreSync] persistUserJuego fail", e);
        }
    }
    window.firestorePersistUserJuego = persistUserJuego;

    async function deleteUserJuego(juegoId) {
        if (!_isProd() || !juegoId) return;
        try {
            await fbDb().collection("juegosUserCreated").doc(juegoId).delete();
        } catch (e) {
            console.warn("[FirestoreSync] deleteUserJuego fail", e);
        }
    }
    window.firestoreDeleteUserJuego = deleteUserJuego;

    async function persistCompetenciaCierre(compId, ganadorGrupoId, resultados) {
        if (!_isProd() || !compId) return;
        try {
            const nowIso = new Date().toISOString();
            const payload = {
                estado: "finalizada",
                ganadorGrupoId,
                cerradoEn: nowIso  // canonical: alineado con competencias-data.cerrarTorneo
                // cerradaEn (legacy alias) removido 2026-06-09 — derivarEstado lee
                // cerradoEn || estado === 'finalizada' como fallback compat.
            };
            // Estabilizacion 2026-06-09: persistir tambien resultados[] para
            // que cross-device el ranking final aparezca en el detalle del
            // torneo sin necesidad de re-computar (que requiere attempts
            // locales que el otro device no tiene).
            if (resultados && typeof resultados === "object") {
                payload.resultados = resultados;
            }
            await fbDb().collection("competencias").doc(compId).update(payload);
        } catch (e) {
            console.warn("[FirestoreSync] persistCompetenciaCierre fail", e);
        }
    }
    window.firestorePersistCompetenciaCierre = persistCompetenciaCierre;

    /**
     * @interaction firestore-persist-examen-create
     * @scope core-firestore-sync-persist
     *
     * Given examen creado por profesor (wizard CrearExamen).
     * When listener de xahni:examenCreado detecta evento.
     * Then collection('examenes').doc(id).set(payload, {merge:true}).
     * Edge: id ausente → no-op (caller debió set id antes de dispatch).
     */
    async function persistExamenCreate(examen) {
        if (!_isProd() || !examen || !examen.id) return;
        try {
            const payload = Object.assign({}, examen, { creadoEn: fbServerTs() });
            const id = payload.id;
            delete payload.id;
            await fbDb().collection("examenes").doc(id).set(payload, { merge: true });
        } catch (e) {
            console.warn("[FirestoreSync] persistExamenCreate fail", e);
        }
    }
    window.firestorePersistExamenCreate = persistExamenCreate;

    /**
     * @interaction firestore-persist-respuestas-examen
     * @scope core-firestore-sync-persist
     *
     * Given alumno termina examen → emite xahni:examenTomado {exId, uid, respuestas}.
     * When listener detecta evento.
     * Then sub-coll respuestas/{uid}.set({respuestas, tomadoEn: serverTs}, {merge:true}).
     */
    async function persistRespuestasExamen(exId, uid, respuestas) {
        if (!_isProd() || !exId || !uid) return;
        try {
            await fbDb().collection("examenes").doc(exId)
                .collection("respuestas").doc(uid)
                .set({ respuestas, tomadoEn: fbServerTs() }, { merge: true });
        } catch (e) {
            console.warn("[FirestoreSync] persistRespuestasExamen fail", e);
        }
    }
    window.firestorePersistRespuestasExamen = persistRespuestasExamen;

    /**
     * @interaction firestore-persist-calificacion-examen
     * @scope core-firestore-sync-persist
     *
     * Given profesor califica → emite xahni:examenCalificado
     *   {exId, uid, califFinal, masteryGanado}.
     * When listener detecta evento.
     * Then sub-coll calificaciones/{uid}.set(calif, {merge:true}).
     */
    async function persistCalificacionExamen(exId, uid, calif) {
        if (!_isProd() || !exId || !uid) return;
        try {
            await fbDb().collection("examenes").doc(exId)
                .collection("calificaciones").doc(uid)
                .set(Object.assign({}, calif, { calificadoEn: fbServerTs() }), { merge: true });
        } catch (e) {
            console.warn("[FirestoreSync] persistCalificacionExamen fail", e);
        }
    }
    window.firestorePersistCalificacionExamen = persistCalificacionExamen;

    /**
     * @interaction firestore-persist-maestria
     * @scope core-firestore-sync-persist
     *
     * Given mastery actualizado (cascada examen-calificación, juego, etc.).
     * When listener de xahni:maestriaActualizada detecta evento
     *   {uid, materiaId, ganado, total}.
     * Then sub-coll maestria/{uid}/materias/{materiaId}.set(state, {merge:true})
     *   con shape canonical {points, nivel, tokensGanados, cosmeticsDesbloqueados,
     *   tokensTimeline} leído desde DEMO_MAESTRIA[uid][materiaId] (autoridad local).
     * Edge:
     *   - DEMO_MAESTRIA undefined → no-op (no hay state local).
     *   - state ausente para uid/materiaId → no-op.
     */
    async function persistMaestria(uid, materiaId) {
        if (!_isProd() || !uid || !materiaId) return;
        if (typeof DEMO_MAESTRIA === 'undefined') return;
        const state = DEMO_MAESTRIA[uid] && DEMO_MAESTRIA[uid][materiaId];
        if (!state) return;
        try {
            await fbDb().collection("maestria").doc(uid)
                .collection("materias").doc(materiaId)
                .set(Object.assign({}, state, { actualizadoEn: fbServerTs() }), { merge: true });
        } catch (e) {
            console.warn("[FirestoreSync] persistMaestria fail", e);
        }
    }
    window.firestorePersistMaestria = persistMaestria;

    /**
     * @interaction firestore-persist-competencia-create
     * @scope core-firestore-sync-persist
     *
     * Given torneo creado por profesor (CrearTorneo._guardar).
     * When listener de xahni:torneoCreado detecta evento {torneo: {...}}.
     * Then collection('competencias').doc(id).set(payload, {merge:true}).
     * Edge: id ausente → no-op.
     */
    async function persistCompetenciaCreate(comp) {
        if (!_isProd() || !comp || !comp.id) return;
        try {
            const payload = Object.assign({}, comp, { creadoEn: fbServerTs() });
            const id = payload.id;
            delete payload.id;
            await fbDb().collection("competencias").doc(id).set(payload, { merge: true });
        } catch (e) {
            console.warn("[FirestoreSync] persistCompetenciaCreate fail", e);
        }
    }
    window.firestorePersistCompetenciaCreate = persistCompetenciaCreate;

    /**
     * @interaction firestore-persist-inscripcion-competencia
     * @scope core-firestore-sync-persist
     *
     * Given alumno realiza su primer attempt en torneo (inscripcion efectiva).
     * When listener de xahni:torneoInscripcion detecta evento {compId, uid}.
     * Then sub-coll inscripciones/{uid}.set({inscritoEn: serverTs}, {merge:true}).
     */
    async function persistInscripcionCompetencia(compId, uid) {
        if (!_isProd() || !compId || !uid) return;
        try {
            await fbDb().collection("competencias").doc(compId)
                .collection("inscripciones").doc(uid)
                .set({ uid: uid, inscritoEn: fbServerTs() }, { merge: true });
        } catch (e) {
            console.warn("[FirestoreSync] persistInscripcionCompetencia fail", e);
        }
    }
    window.firestorePersistInscripcionCompetencia = persistInscripcionCompetencia;

    /**
     * @interaction firestore-persist-intento-competencia
     * @scope core-firestore-sync-persist
     *
     * Given alumno completa intento en torneo (1..3).
     * When listener de xahni:torneoIntento detecta evento
     *   {compId, uid, attemptN, score}.
     * Then sub-coll intentos/{uid}_attempt{N}.set({score, attemptN, fecha:serverTs}, {merge:true}).
     * Edge: attemptN inválido → no-op.
     */
    async function persistIntentoCompetencia(compId, uid, attemptN, score) {
        if (!_isProd() || !compId || !uid || !attemptN) return;
        try {
            const docId = uid + "_attempt" + attemptN;
            await fbDb().collection("competencias").doc(compId)
                .collection("intentos").doc(docId)
                .set({
                    uid: uid,
                    attemptN: attemptN,
                    score: score,
                    fecha: fbServerTs()
                }, { merge: true });
        } catch (e) {
            console.warn("[FirestoreSync] persistIntentoCompetencia fail", e);
        }
    }
    window.firestorePersistIntentoCompetencia = persistIntentoCompetencia;

    /**
     * @interaction firestore-persist-escala
     * @scope core-firestore-sync-persist
     *
     * Given escala recién guardada por profesor (guardarEscala / ejecutarGuardarEscala).
     * When listener de xahni:escalaGuardada detecta evento
     *   {materiaId, parcialNum, creadoPor, criterios, guardado}.
     * Then collection('escalas').doc('{matId}_p{num}').set(payload, {merge:true}).
     * Edge: materiaId/parcialNum/creadoPor faltante → no-op.
     */
    async function persistEscala(escala) {
        if (!_isProd() || !escala || !escala.materiaId || !escala.parcialNum || !escala.creadoPor) return;
        try {
            // Doc id canonical: `${matId}_${grupoId}_${parcial}` para alinear con
            // schema usado por lookups en gestion/calificaciones-calc. Fallback
            // sin grupoId: `${matId}_p${num}` (no debería ocurrir en práctica).
            const docId = escala.id
                || (escala.grupoId
                    ? `${escala.materiaId}_${escala.grupoId}_${escala.parcialNum}`
                    : `${escala.materiaId}_p${escala.parcialNum}`);
            const payload = Object.assign({}, escala, { actualizadoEn: fbServerTs() });
            await fbDb().collection("escalas").doc(docId).set(payload, { merge: true });
        } catch (e) {
            console.warn("[FirestoreSync] persistEscala fail", e);
        }
    }
    window.firestorePersistEscala = persistEscala;

    // ═══════════════════════════════════════════════════════════
    // Sweep 2026-06-08 — wrappers nuevos para los 10 huérfanos
    // detectados en la auditoría docs/sweep-firestore-2026-06-08.md.
    // ═══════════════════════════════════════════════════════════

    /**
     * @interaction firestore-persist-examen-estado
     * @scope core-firestore-sync-persist
     *
     * Given exId + nuevoEstado ("abierto" | "cerrado") + timestamp.
     * When listener de xahni:examenAbierto o xahni:examenCerrado detecta evento.
     * Then merge-update en examenes/{exId} de los campos estado +
     *   abiertoEn/cerradoEn. Es complementario al persistExamenCreate (no
     *   sobrescribe payload completo, solo los 2-3 campos del toggle).
     * Edge: exId vacío → no-op.
     */
    async function persistExamenEstado(exId, nuevoEstado, abiertoEn, cerradoEn) {
        if (!_isProd() || !exId) return;
        try {
            const update = { estado: nuevoEstado };
            if (abiertoEn) update.abiertoEn = abiertoEn;
            if (cerradoEn) update.cerradoEn = cerradoEn;
            await fbDb().collection("examenes").doc(exId).set(update, { merge: true });
        } catch (e) {
            console.warn("[FirestoreSync] persistExamenEstado fail", e);
        }
    }
    window.firestorePersistExamenEstado = persistExamenEstado;

    /**
     * @interaction firestore-persist-top3-maestria
     * @scope core-firestore-sync-persist
     *
     * Given uid + top3 (array de matIds curados o vacío).
     * When listener de xahni:top3MaestriaChanged detecta evento.
     * Then merge-set en userPrefs/{uid}.top3Maestria. Array vacío = "revertir
     *   a auto" (consumer interpreta presencia/ausencia, no requiere delete del
     *   field — mantenemos shape estable).
     */
    async function persistTop3Maestria(uid, top3) {
        if (!_isProd() || !uid) return;
        try {
            await fbDb().collection("userPrefs").doc(uid).set({
                top3Maestria: Array.isArray(top3) ? top3 : [],
                actualizadoEn: fbServerTs()
            }, { merge: true });
        } catch (e) {
            console.warn("[FirestoreSync] persistTop3Maestria fail", e);
        }
    }
    window.firestorePersistTop3Maestria = persistTop3Maestria;

    /**
     * @interaction firestore-persist-kudos
     * @scope core-firestore-sync-persist
     *
     * Given uid + array completo de kudos (KUDOS_DATA tras mutación).
     * When listener de xahni:kudoEnviado detecta evento.
     * Then merge-set en kudos/{uid}.items reemplazando array entero. Patrón
     *   "snapshot full array" igual que UserJuegos — la cantidad esperada por
     *   usuario es decenas, no miles, así que un doc plano es suficiente.
     */
    async function persistKudos(uid, kudosArr) {
        if (!_isProd() || !uid) return;
        try {
            await fbDb().collection("kudos").doc(uid).set({
                items: Array.isArray(kudosArr) ? kudosArr : [],
                actualizadoEn: fbServerTs()
            }, { merge: true });
        } catch (e) {
            console.warn("[FirestoreSync] persistKudos fail", e);
        }
    }
    window.firestorePersistKudos = persistKudos;

    /**
     * @interaction firestore-persist-replay
     * @scope core-firestore-sync-persist
     *
     * Given jugadorId + juegoId + count (entero monotonic).
     * When listener de xahni:replayIncrementado detecta evento.
     * Then merge-set en replays/{jugadorId}.juegos.{juegoId} = count.
     *   Alimenta cálculo de XP pasiva del creador con decay (creator-economy).
     * Edge: count <= 0 → no-op (no tiene sentido persistir).
     */
    async function persistReplay(jugadorId, juegoId, count) {
        if (!_isProd() || !jugadorId || !juegoId || !count) return;
        try {
            const update = {};
            update["juegos." + juegoId] = count;
            update.actualizadoEn = fbServerTs();
            await fbDb().collection("replays").doc(jugadorId).set(update, { merge: true });
        } catch (e) {
            console.warn("[FirestoreSync] persistReplay fail", e);
        }
    }
    window.firestorePersistReplay = persistReplay;

    /**
     * @interaction firestore-persist-nota-rubro
     * @scope core-firestore-sync-persist
     *
     * Given uid + matId + parcial (string "P1"/"P2"/"P3") + rubroId + payload
     *   {promedio, examenesCount, actualizadoEn}.
     * When listener de xahni:notaRubroActualizada detecta evento.
     * Then merge-set en notaRubro/{uid}/materias/{matId}.{parcial}.{rubroId} con
     *   el payload. Shape map anidado permite una sola query single-doc por
     *   (uid, matId) en hidratación.
     * Edge: cualquier id faltante → no-op.
     */
    async function persistNotaRubro(uid, matId, parcial, rubroId, payload) {
        if (!_isProd() || !uid || !matId || !parcial || !rubroId) return;
        try {
            const update = {};
            update[parcial + "." + rubroId] = payload;
            update.actualizadoEn = fbServerTs();
            await fbDb().collection("notaRubro").doc(uid)
                .collection("materias").doc(matId)
                .set(update, { merge: true });
        } catch (e) {
            console.warn("[FirestoreSync] persistNotaRubro fail", e);
        }
    }
    window.firestorePersistNotaRubro = persistNotaRubro;

    /**
     * @interaction firestore-persist-entrega
     * @scope core-firestore-sync-persist
     *
     * Given uid + tareaId + entrega {fecha, archivos[], comentario}.
     * When listener de xahni:entregaActualizada detecta evento.
     * Then merge-set en entregas/{uid}/items/{tareaId}. Granular por tareaId
     *   para que el profesor pueda querear con where uid + tareaId sin tener
     *   que cargar todo el array del alumno.
     */
    async function persistEntrega(uid, tareaId, entrega) {
        if (!_isProd() || !uid || !tareaId || !entrega) return;
        try {
            await fbDb().collection("entregas").doc(uid)
                .collection("items").doc(tareaId)
                .set(Object.assign({}, entrega, {
                    tareaId,
                    actualizadoEn: fbServerTs()
                }), { merge: true });
        } catch (e) {
            console.warn("[FirestoreSync] persistEntrega fail", e);
        }
    }
    window.firestorePersistEntrega = persistEntrega;

    /**
     * @interaction firestore-persist-historial-extra
     * @scope core-firestore-sync-persist
     *
     * Given uid + array completo de uploads freeform (HISTORIAL_EXTRA tras mutación).
     * When listener de xahni:historialExtraActualizado detecta evento.
     * Then merge-set en historialExtra/{uid}.items reemplazando array entero.
     */
    async function persistHistorialExtra(uid, arr) {
        if (!_isProd() || !uid) return;
        try {
            await fbDb().collection("historialExtra").doc(uid).set({
                items: Array.isArray(arr) ? arr : [],
                actualizadoEn: fbServerTs()
            }, { merge: true });
        } catch (e) {
            console.warn("[FirestoreSync] persistHistorialExtra fail", e);
        }
    }
    window.firestorePersistHistorialExtra = persistHistorialExtra;

    /**
     * @interaction firestore-persist-recursos-vistos
     * @scope core-firestore-sync-persist
     *
     * Given uid + array de recursoIds marcados como vistos (badge "Nuevo").
     * When listener de xahni:recursosVistosActualizados detecta evento.
     * Then merge-set en recursosVistos/{uid}.items reemplazando array entero.
     * Edge: uid ausente → no-op (la key actual NO está namespaced — el sweep
     *   F2.4 corrige ese bug, hasta entonces el evento solo se dispara cuando
     *   hay user activo).
     */
    async function persistRecursosVistos(uid, arr) {
        if (!_isProd() || !uid) return;
        try {
            await fbDb().collection("recursosVistos").doc(uid).set({
                items: Array.isArray(arr) ? arr : [],
                actualizadoEn: fbServerTs()
            }, { merge: true });
        } catch (e) {
            console.warn("[FirestoreSync] persistRecursosVistos fail", e);
        }
    }
    window.firestorePersistRecursosVistos = persistRecursosVistos;

    // ── Persist torneos intragrupales ────────────────────────────

    async function persistTorneoIntraCreado(torneo) {
        if (!_isProd() || !torneo) return;
        const db = fbDb();
        try {
            await db.collection("torneosIntra").doc(torneo.id).set({
                ...torneo,
                actualizadoEn: fbServerTs()
            }, { merge: false });
            console.info("[ti-metric] persistTorneoIntraCreado", torneo.id);
        } catch (e) {
            console.error("[ti-error] persistTorneoIntraCreado fail", torneo.id, e);
        }
    }
    window.firestorePersistTorneoIntraCreado = persistTorneoIntraCreado;

    async function persistTorneoIntraPartida(torneoId, partida) {
        if (!_isProd() || !torneoId || !partida) return;
        const db = fbDb();
        try {
            // Guard E1: el doc raíz no debe estar finalizada.
            const root = await db.collection("torneosIntra").doc(torneoId).get();
            if (!root.exists) {
                console.warn("[ti-error] persistPartida: torneo no existe", torneoId);
                return;
            }
            const data = root.data();
            if (data.estado === "finalizada" || data.cerradoEn) {
                console.warn("[ti-error] persistPartida: torneo cerrado, partida descartada", torneoId);
                return;
            }
            await db.collection("torneosIntra").doc(torneoId)
                .collection("partidas").doc(partida.id).set(partida, { merge: false });
            console.info("[ti-metric] persistTorneoIntraPartida", torneoId, partida.uid, partida.numPartida);
        } catch (e) {
            console.error("[ti-error] persistTorneoIntraPartida fail", torneoId, e);
        }
    }
    window.firestorePersistTorneoIntraPartida = persistTorneoIntraPartida;

    async function persistTorneoIntraCierre(torneoId, ganadorUid, ranking, cerradoPor, cerradoEn, xpDist) {
        if (!_isProd() || !torneoId) return;
        const db = fbDb();
        try {
            // Transaction guard E2: si cerradoEn ya existe, abortar.
            await db.runTransaction(async (tx) => {
                const ref = db.collection("torneosIntra").doc(torneoId);
                const snap = await tx.get(ref);
                if (!snap.exists) throw new Error("torneo_no_existe");
                const data = snap.data();
                if (data.cerradoEn) {
                    console.info("[ti-metric] persistTorneoIntraCierre: ya cerrado, abort", torneoId);
                    return;
                }
                tx.update(ref, {
                    estado: "finalizada",
                    cerradoEn: cerradoEn || Date.now(),
                    cerradoPor: cerradoPor || "auto",
                    ganadorUid: ganadorUid || null,
                    ranking: ranking || [],
                    actualizadoEn: fbServerTs()
                });
            });
            console.info("[ti-metric] persistTorneoIntraCierre OK", torneoId, ganadorUid);

            // Bug 2026-06-09: el batch increment de XP a gamerState/{uid} se
            // eliminó porque TorneosIntraData.cerrarTorneo ahora llama
            // GamerState.addXp localmente, lo que dispara xahni:gamerUpdated y
            // persistGamerState (set merge) escribe el shape completo a Firestore.
            // Mantener ambos provocaba doble suma (race entre increment atómico
            // y set merge con valor ya incrementado). Aceptamos la pérdida de
            // atomicidad porque el cierre de un torneo intra solo lo ejecuta el
            // creador del torneo, no hay race entre múltiples profes para el
            // mismo torneo.
            void xpDist; // intencionalmente no usado aquí
        } catch (e) {
            console.error("[ti-error] persistTorneoIntraCierre fail", torneoId, e);
        }
    }
    window.firestorePersistTorneoIntraCierre = persistTorneoIntraCierre;

    // ═══════════════════════════════════════════════════════════
    // Auto-wire event listeners (idempotente, una sola vez).
    // ═══════════════════════════════════════════════════════════

    document.addEventListener("xahni:gamerUpdated", function (e) {
        const d = e.detail;
        if (!d || !d.uid) return;
        persistGamerState(d.uid);
    });

    document.addEventListener("xahni:insigniaUnlocked", function (e) {
        const d = e.detail;
        if (!d || !d.uid) return;
        persistGamerState(d.uid);
    });

    document.addEventListener("xahni:examenCreado", function (e) {
        const d = e.detail;
        if (!d || !d.examen) return;
        persistExamenCreate(d.examen);
    });

    document.addEventListener("xahni:examenTomado", function (e) {
        const d = e.detail;
        if (!d || !d.exId || !d.uid) return;
        persistRespuestasExamen(d.exId, d.uid, d.respuestas);
    });

    document.addEventListener("xahni:examenCalificado", function (e) {
        const d = e.detail;
        if (!d || !d.exId || !d.uid) return;
        // calif puede venir como d.calif o d.califFinal — espejar ambos shapes
        const calif = d.calif || {
            califFinal: d.califFinal,
            califParcial: d.califParcial,
            abiertas: d.abiertas,
            masteryAplicado: d.masteryGanado != null
        };
        persistCalificacionExamen(d.exId, d.uid, calif);
    });

    document.addEventListener("xahni:maestriaActualizada", function (e) {
        const d = e.detail;
        if (!d || !d.uid || !d.materiaId) return;
        persistMaestria(d.uid, d.materiaId);
    });

    document.addEventListener("xahni:torneoCreado", function (e) {
        const d = e.detail;
        if (!d || !d.torneo) return;
        persistCompetenciaCreate(d.torneo);
    });

    document.addEventListener("xahni:torneoInscripcion", function (e) {
        const d = e.detail;
        if (!d || !d.compId || !d.uid) return;
        persistInscripcionCompetencia(d.compId, d.uid);
    });

    document.addEventListener("xahni:torneoIntento", function (e) {
        const d = e.detail;
        if (!d || !d.compId || !d.uid || !d.attemptN) return;
        persistIntentoCompetencia(d.compId, d.uid, d.attemptN, d.score);
    });

    document.addEventListener("xahni:escalaGuardada", function (e) {
        const d = e.detail;
        if (!d || !d.escala) return;
        persistEscala(d.escala);
    });

    // ── Sweep 2026-06-08 — listeners para los 10 huérfanos ─────

    document.addEventListener("xahni:juegoCreado", function (e) {
        const d = e.detail;
        if (!d || !d.juego) return;
        persistUserJuego(d.juego);
    });

    document.addEventListener("xahni:juegoEliminado", function (e) {
        const d = e.detail;
        if (!d || !d.juegoId) return;
        deleteUserJuego(d.juegoId);
    });

    document.addEventListener("xahni:examenAbierto", function (e) {
        const d = e.detail;
        if (!d || !d.exId) return;
        persistExamenEstado(d.exId, "abierto", d.abiertoEn, null);
    });

    document.addEventListener("xahni:examenCerrado", function (e) {
        const d = e.detail;
        if (!d || !d.exId) return;
        persistExamenEstado(d.exId, "cerrado", null, d.cerradoEn);
    });

    document.addEventListener("xahni:torneoTerminado", function (e) {
        const d = e.detail;
        if (!d || !d.compId) return;
        persistCompetenciaCierre(d.compId, d.ganador || null, d.resultados || null);
    });

    document.addEventListener("xahni:torneoActualizado", function (e) {
        const d = e.detail;
        if (!d || !d.compId) return;
        persistCompetenciaCierre(d.compId, d.ganador || null, d.resultados || null);
    });

    document.addEventListener("xahni:top3MaestriaChanged", function (e) {
        const d = e.detail;
        if (!d || !d.uid) return;
        persistTop3Maestria(d.uid, d.top3 || []);
    });

    document.addEventListener("xahni:kudoEnviado", function (e) {
        const d = e.detail;
        if (!d || !d.uid) return;
        persistKudos(d.uid, d.kudos || []);
    });

    document.addEventListener("xahni:replayIncrementado", function (e) {
        const d = e.detail;
        if (!d || !d.jugadorId || !d.juegoId) return;
        persistReplay(d.jugadorId, d.juegoId, d.count);
    });

    document.addEventListener("xahni:notaRubroActualizada", function (e) {
        const d = e.detail;
        if (!d || !d.uid || !d.matId || !d.parcial || !d.rubroId) return;
        persistNotaRubro(d.uid, d.matId, d.parcial, d.rubroId, d.payload);
    });

    document.addEventListener("xahni:entregaActualizada", function (e) {
        const d = e.detail;
        if (!d || !d.uid || !d.tareaId || !d.entrega) return;
        persistEntrega(d.uid, d.tareaId, d.entrega);
    });

    document.addEventListener("xahni:historialExtraActualizado", function (e) {
        const d = e.detail;
        if (!d || !d.uid) return;
        persistHistorialExtra(d.uid, d.items || []);
    });

    document.addEventListener("xahni:recursosVistosActualizados", function (e) {
        const d = e.detail;
        if (!d || !d.uid) return;
        persistRecursosVistos(d.uid, d.items || []);
    });

    // ── Listeners torneos intragrupales ──────────────────────────

    document.addEventListener("xahni:torneoIntraCreado", function (e) {
        const d = e.detail;
        if (!d || !d.torneo) return;
        persistTorneoIntraCreado(d.torneo);
    });

    document.addEventListener("xahni:torneoIntraJugado", function (e) {
        const d = e.detail;
        if (!d || !d.torneoId || !d.partida) return;
        persistTorneoIntraPartida(d.torneoId, d.partida);
    });

    document.addEventListener("xahni:torneoIntraTerminado", function (e) {
        const d = e.detail;
        if (!d || !d.torneoId) return;
        persistTorneoIntraCierre(d.torneoId, d.ganadorUid, d.ranking, d.cerradoPor, d.cerradoEn, d.xpDist);
    });

    return {
        hydrateOnLogin,
        persistGamerState,
        persistUserJuego,
        deleteUserJuego,
        persistCompetenciaCierre,
        persistExamenCreate,
        persistRespuestasExamen,
        persistCalificacionExamen,
        persistMaestria,
        persistCompetenciaCreate,
        persistInscripcionCompetencia,
        persistIntentoCompetencia,
        persistEscala,
        // Sweep 2026-06-08
        persistExamenEstado,
        persistTop3Maestria,
        persistKudos,
        persistReplay,
        persistNotaRubro,
        persistEntrega,
        persistHistorialExtra,
        persistRecursosVistos,
        // Torneos intragrupales
        persistTorneoIntraCreado,
        persistTorneoIntraPartida,
        persistTorneoIntraCierre,
        _isProd
    };
})();
