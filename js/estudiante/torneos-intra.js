// js/estudiante/torneos-intra.js
// Slice torneos intragrupales S3 · 2026-06-09
//
// EstudianteTorneosIntra → render de cards intragrupales del grupo del alumno.
// Reusa EXCLUSIVAMENTE clases canonical del intergrupal existente:
//   .comp-card / .comp-mini-ranking / .ctn-modal (competencias.css + patterns.css).
// NO define CSS propio. NO crea clases .ti-* nuevas.
//
// Integración: buildCompetencias() en competencias.js delega aquí cuando
// _EST_COMP_MODO === "intra".

// ─── Helper local: escape HTML ────────────────────────────────────────────────
function _intraEstHtmlAttr(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// ─── Helper: nombre + label de alumno por uid ─────────────────────────────────
function _intraEstAlumnoLabel(uid, maxLen) {
    if (!uid) return "";
    var max = maxLen || 16;
    var users = (typeof DEMO_USERS !== "undefined" && Array.isArray(DEMO_USERS)) ? DEMO_USERS : [];
    var u = users.find(function(x) { return x.id === uid; });
    var display = u ? (u.nombre || uid) : uid;
    if (display.length > max) display = display.slice(0, max - 1) + "…";
    return '<span class="x-truncate-inline" title="' + _intraEstHtmlAttr(u ? u.nombre : uid) + '">' + _intraEstHtmlAttr(display) + '</span>';
}

// ─── Helper: grupoId del alumno actual ────────────────────────────────────────
function _intraEstGrupoIdDeUser(uid) {
    var users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []);
    var u = users.find(function(x) { return x.id === uid; });
    return (u && u.grupos && u.grupos.length > 0) ? u.grupos[0] : null;
}

// ─── Helper: nombre del juego por id ──────────────────────────────────────────
function _intraEstJuegoLabel(juegoId) {
    if (!juegoId) return "—";
    var seeds = (typeof DEMO_JUEGOS !== "undefined" ? DEMO_JUEGOS : []);
    var j = seeds.find(function(x) { return x.id === juegoId; });
    if (!j) {
        try {
            var uc = JSON.parse(localStorage.getItem("xahni:juegos:userCreated") || "[]");
            j = uc.find(function(x) { return x.id === juegoId; });
        } catch (e) { /* ignore */ }
    }
    return j ? (j.tipo || "quiz").toUpperCase() : "JUEGO";
}

// ─── Helper: stats hero intra para el alumno ──────────────────────────────────
function _statsHeroIntraAlumno(uid) {
    if (typeof TorneosIntraData === "undefined") {
        return { totalTorneos: 0, participados: 0, mejorLugar: null, xpGanada: 0 };
    }
    var grupoId = _intraEstGrupoIdDeUser(uid);
    if (!grupoId) return { totalTorneos: 0, participados: 0, mejorLugar: null, xpGanada: 0 };

    var todos = TorneosIntraData.getAll().filter(function(t) { return t.grupoId === grupoId; });
    var participados = 0;
    var mejorLugar = null;
    var xpGanada = 0;

    todos.forEach(function(t) {
        var partidas = TorneosIntraData.getPartidasAlumno(t.id, uid);
        if (partidas.length > 0) {
            participados++;
        }
        // Leer lugar del ranking si el torneo está finalizado
        if (t.cerradoEn && t.ranking) {
            var miRow = t.ranking.find(function(r) { return r.uid === uid; });
            if (miRow && miRow.jugo) {
                if (mejorLugar === null || miRow.lugar < mejorLugar) {
                    mejorLugar = miRow.lugar;
                }
                var xpDist = TorneosIntraData.getXpDistribucion(t.ranking, TorneosIntraData.XP_BASE_DEFAULT);
                xpGanada += (xpDist[uid] || 0);
            }
        }
    });

    return {
        totalTorneos: todos.length,
        participados: participados,
        mejorLugar: mejorLugar,
        xpGanada: xpGanada
    };
}

// ─── Render de una card intragrupal del alumno ────────────────────────────────
/**
 * @interaction est-intra-card-render
 * @scope estudiante-torneos-intra
 *
 * Given torneo intragrupal del grupo del alumno.
 * When buildCompetencias() está en modo "intra".
 * Then renderiza card con clases canónicas .comp-card (misma que inter).
 * Edge:
 *   - borrador → css clase "proxima" (borde warn) + chip visual.
 *   - proxima  → css clase "proxima" + días para inicio.
 *   - abierto  → css clase "activa" + botón "Jugar partida".
 *   - finalizada → css clase "finalizada" + mini-ranking top-3 + botón ranking.
 */
function _renderIntraCardAlumno(torneo, uid, now) {
    var estado = TorneosIntraData.derivarEstado(torneo, now);
    var matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
        .find(function(m) { return m.id === torneo.materiaId; });
    matNom = matNom ? matNom.nombre : torneo.materiaId;
    var tipoLabel = _intraEstJuegoLabel(torneo.juegoId);
    var titulo = (torneo.nombre && torneo.nombre.trim())
        ? torneo.nombre.trim()
        : ("Torneo intra · " + matNom);
    var titEsc = _intraEstHtmlAttr(titulo);
    var chipIa = (typeof window._compEsIA === "function" && window._compEsIA({ juegoId: torneo.juegoId }))
        ? '<span class="x-chip-ia" title="Torneo basado en juego generado por Gemini IA">✨ Gemini</span>'
        : "";

    // Mapear estado intra → clase CSS canon (border-left de .comp-card.activa/proxima/finalizada)
    var cssEstado = estado === "abierto" ? "activa"
                  : (estado === "borrador" || estado === "proxima") ? "proxima"
                  : "finalizada";

    // Partidas restantes del alumno
    var partidasJugadas = TorneosIntraData.getPartidasAlumno(torneo.id, uid);
    var restantes = TorneosIntraData.MAX_PARTIDAS - partidasJugadas.length;

    // Chip de estado
    var chipEstado;
    if (estado === "abierto") {
        var diasRestantes = torneo.fechaCierre
            ? Math.max(0, Math.ceil((torneo.fechaCierre - now) / 86400000))
            : "?";
        chipEstado = '<span class="x-chip x-chip--ok" style="font-size:10px">🟢 ABIERTO · ' + diasRestantes + 'd</span>';
    } else if (estado === "proxima") {
        var diasParaInicio = torneo.fechaInicio
            ? Math.max(1, Math.ceil((torneo.fechaInicio - now) / 86400000))
            : "?";
        chipEstado = '<span class="x-chip x-chip--info" style="font-size:10px">🔵 PRÓXIMA · en ' + diasParaInicio + 'd</span>';
    } else if (estado === "borrador") {
        chipEstado = '<span class="x-chip" style="font-size:10px">📝 PRÓXIMA</span>';
    } else {
        // finalizada
        var ganadorLabel = torneo.ganadorUid
            ? _intraEstAlumnoLabel(torneo.ganadorUid, 16)
            : "—";
        chipEstado = '<span class="x-chip" style="font-size:10px;background:var(--xahni-amber-dim);color:var(--xahni-amber)">🏆 ' + ganadorLabel + '</span>';
    }

    // Mini ranking top-3 (igual que profesor S2, misma clase .comp-mini-ranking)
    var miniRanking = "";
    if ((estado === "abierto" || estado === "finalizada") && torneo.ranking && torneo.ranking.length > 0) {
        var filas = torneo.ranking.filter(function(r) { return r.jugo; }).slice(0, 3);
        if (filas.length > 0) {
            miniRanking = '<div class="comp-mini-ranking">' +
                filas.map(function(r) {
                    var pts = r.aciertos + " ac · " + r.partidas + " part.";
                    var esMio = r.uid === uid;
                    return '<div class="comp-mini-ranking__row' + (esMio ? ' comp-ranking-row--mio' : '') + '">' +
                        '<div class="comp-mini-ranking__lugar">' + (r.lugar || "—") + '°</div>' +
                        '<div>' + _intraEstAlumnoLabel(r.uid, 14) + (esMio ? ' <span class="x-chip x-chip--ok" style="font-size:9px">yo</span>' : "") + '</div>' +
                        '<div class="comp-mini-ranking__pts">' + pts + '</div>' +
                    '</div>';
                }).join("") +
            '</div>';
        }
    }

    // Footer de acciones según estado
    var footer;
    if (estado === "abierto") {
        var btnDisabled = restantes <= 0 ? ' disabled title="Agotaste tus partidas"' : "";
        footer = '<span style="font-size:11px;color:var(--text-muted)">' +
                    (restantes > 0
                        ? restantes + ' de ' + TorneosIntraData.MAX_PARTIDAS + ' partidas restantes'
                        : 'Partidas agotadas') +
                '</span>' +
                '<span style="display:flex;gap:6px">' +
                    '<button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 10px"' + btnDisabled + ' ' +
                        'onclick="event.stopPropagation();EstudianteTorneosIntra.jugarPartida(\'' + torneo.id + '\')">' +
                        'Jugar partida →' +
                    '</button>' +
                '</span>';
    } else if (estado === "finalizada") {
        // Mi lugar
        var miRow = torneo.ranking ? torneo.ranking.find(function(r) { return r.uid === uid; }) : null;
        var miLugar = miRow && miRow.jugo ? miRow.lugar + "°" : "no participé";
        footer = '<span style="font-size:11px;color:var(--text-muted)">Tu lugar: ' + miLugar + '</span>' +
                '<span style="display:flex;gap:6px">' +
                    '<button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 10px" ' +
                        'onclick="event.stopPropagation();EstudianteTorneosIntra.abrirModalRanking(\'' + torneo.id + '\')">' +
                        'Ver ranking →' +
                    '</button>' +
                '</span>';
    } else {
        // proxima / borrador
        footer = '<span style="font-size:11px;color:var(--text-muted)">Aún no disponible</span>';
    }

    return '<article class="comp-card ' + cssEstado + '" style="cursor:default">' +
        '<div class="comp-card__head">' +
            '<div>' +
                '<div class="comp-card__title">' + titEsc + '</div>' +
                '<div class="comp-card__meta" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">' +
                    '<span>' + matNom + ' · ' + tipoLabel + '</span>' +
                    chipIa +
                '</div>' +
            '</div>' +
            chipEstado +
        '</div>' +
        miniRanking +
        '<div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--text-muted)">' +
            footer +
        '</div>' +
    '</article>';
}

// ─── EstudianteTorneosIntra ───────────────────────────────────────────────────
var EstudianteTorneosIntra = (function() {

    /**
     * Renderiza el grid intragrupal del alumno en el contenedor dado.
     * Llamado por buildCompetencias() cuando _EST_COMP_MODO === "intra".
     */
    function renderAlumno(contenedor) {
        if (!contenedor) return;
        if (typeof TorneosIntraData === "undefined") {
            contenedor.innerHTML = '<div class="x-empty" style="padding:36px;text-align:center;color:var(--text-muted)">Módulo de torneos intragrupales no disponible.</div>';
            return;
        }
        var uid = APP?.user?.id;
        if (!uid) return;
        var grupoId = _intraEstGrupoIdDeUser(uid);
        if (!grupoId) {
            contenedor.innerHTML = '<div class="x-empty" style="padding:36px;text-align:center;color:var(--text-muted)">Sin grupo asignado · no hay torneos intra.</div>';
            return;
        }
        var now = Date.now();
        var todos = TorneosIntraData.getAll().filter(function(t) {
            // Solo torneos del grupo del alumno que NO sean borradores puros
            // (un borrador sin fechaCierre no es jugable ni mostrable)
            return t.grupoId === grupoId && t.juegoId;
        });

        if (todos.length === 0) {
            contenedor.innerHTML = '<div class="x-empty" style="grid-column:1/-1;padding:36px;text-align:center;color:var(--text-muted)">' +
                '<div style="font-size:32px;margin-bottom:8px">🏅</div>' +
                '<div>No hay torneos intragrupales para tu grupo todavía.</div>' +
            '</div>';
            return;
        }

        contenedor.innerHTML = todos.map(function(t) {
            return _renderIntraCardAlumno(t, uid, now);
        }).join("");
    }

    /**
     * @interaction est-intra-jugar-partida
     * @scope estudiante-torneos-intra
     *
     * Given torneoId de un torneo intragrupal abierto.
     * When alumno click "Jugar partida".
     * Then abre el juego del torneo con abrirJuego(juegoId).
     *   Al terminar el juego, el motor (QuizJugar/VFJugar/FlashcardsJugar)
     *   emite CustomEvent("xahni:juegoTerminado") con aciertos + tiempoMs.
     *   El listener de este módulo registra la partida y re-renderiza.
     * Edge:
     *   - E1: torneo cerrado (derivarEstado = "finalizada") → toast info, no juega.
     *   - E3: cap 3 partidas agotadas → toast info, no juega.
     *   - E6: juegoId no existe → abrirJuego ya maneja con toast "Juego no encontrado".
     */
    function jugarPartida(torneoId) {
        if (typeof TorneosIntraData === "undefined") return;
        var torneo = TorneosIntraData.getById(torneoId);
        if (!torneo) {
            if (typeof showToast === "function") showToast("Torneo no encontrado", "danger");
            return;
        }
        var uid = APP?.user?.id;
        if (!uid) return;

        // Guard E1: torneo cerrado
        var estado = TorneosIntraData.derivarEstado(torneo, Date.now());
        if (estado === "finalizada") {
            if (typeof showToast === "function") showToast("Este torneo ya finalizó · solo puedes ver el ranking.", "info");
            return;
        }
        if (estado === "proxima" || estado === "borrador") {
            if (typeof showToast === "function") showToast("Este torneo aún no ha iniciado.", "info");
            return;
        }

        // Guard E3: cap MAX_PARTIDAS
        var partidas = TorneosIntraData.getPartidasAlumno(torneoId, uid);
        if (partidas.length >= TorneosIntraData.MAX_PARTIDAS) {
            if (typeof showToast === "function") {
                showToast("Agotaste tus " + TorneosIntraData.MAX_PARTIDAS + " partidas · espera el ranking final.", "info");
            }
            return;
        }

        // Guard E6: juegoId existe
        if (!torneo.juegoId) {
            if (typeof showToast === "function") showToast("Este torneo no tiene un juego asignado.", "warn");
            return;
        }

        // Registrar torneoId activo para el listener post-juego
        _torneoActivoId = torneoId;

        // Guard: abrirJuego ya maneja el caso de juego no encontrado
        if (typeof abrirJuego === "function") {
            abrirJuego(torneo.juegoId);
        } else {
            if (typeof showToast === "function") showToast("Motor de juegos no disponible.", "danger");
        }
    }

    /**
     * @interaction est-intra-modal-ranking
     * @scope estudiante-torneos-intra
     *
     * Given torneoId de un torneo intragrupal (idealmente finalizado).
     * When alumno click "Ver ranking".
     * Then abre modal-intra-ranking con lista completa.
     *   - Jugadores ordenados por lugar (jugo:true primero, luego ausentes).
     *   - Highlight con .comp-ranking-row--mio si uid === APP.user.uid.
     *   - Filas de ausentes muestran "no participó" al final.
     */
    async function abrirModalRanking(torneoId) {
        if (typeof TorneosIntraData === "undefined") return;
        var torneo = TorneosIntraData.getById(torneoId);
        if (!torneo) return;
        var uid = APP?.user?.id;

        var matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
            .find(function(m) { return m.id === torneo.materiaId; });
        matNom = matNom ? matNom.nombre : torneo.materiaId;

        // Bug crítico 2026-06-09: rehidratar partidas desde Firestore antes de
        // mostrar el ranking en vivo, para que el modal vea TODAS las partidas
        // cross-device, no solo las del propio dispositivo. Cubre el caso donde
        // María / Carlos jugaron después del login y sus partidas no están en
        // el localStorage local de quien abre el modal.
        if (!torneo.cerradoEn && typeof window.firestoreRehydratePartidasTorneoIntra === "function") {
            try { await window.firestoreRehydratePartidasTorneoIntra(torneoId); }
            catch (e) { /* defensive */ }
        }

        // Obtener ranking completo: desde torneo.ranking (si está cerrado) o
        // computar en vivo desde las partidas del localStorage.
        var ranking = [];
        if (torneo.cerradoEn && torneo.ranking) {
            ranking = torneo.ranking;
        } else {
            // Ranking en vivo (torneo abierto — visto desde el modal de ranking).
            // Bug 2026-06-09: el campo canonical de DEMO_GRUPOS es `miembros`,
            // no `alumnos`. Sin fallback, computarRanking recibía array vacío y
            // el modal mostraba "Sin participantes aún" aunque hubiera partidas.
            var grupoId = torneo.grupoId;
            var grupos = (typeof DEMO_GRUPOS !== "undefined" ? DEMO_GRUPOS : []);
            var grupo = grupos.find(function(g) { return g.id === grupoId; });
            var alumnos = grupo ? (grupo.miembros || grupo.alumnos || []) : [];
            var todasPartidas = TorneosIntraData.getPartidasTorneo(torneoId);
            ranking = TorneosIntraData.computarRanking(torneo, todasPartidas, alumnos);
        }

        var xpDist = TorneosIntraData.getXpDistribucion(ranking, TorneosIntraData.XP_BASE_DEFAULT);

        // Renderizar modal
        var eyebrow = document.getElementById("intra-ranking-eyebrow");
        var titulo = document.getElementById("intra-ranking-titulo");
        var body = document.getElementById("intra-ranking-body");

        if (!eyebrow || !titulo || !body) {
            // fallback si el modal no está en el DOM aún (no debería ocurrir)
            if (typeof showToast === "function") showToast("Modal de ranking no disponible.", "warn");
            return;
        }

        eyebrow.textContent = "📚 " + matNom + " · INTRAGRUPAL";
        titulo.textContent = (torneo.nombre && torneo.nombre.trim())
            ? torneo.nombre.trim()
            : ("Torneo intra · " + matNom);

        var jugaron = ranking.filter(function(r) { return r.jugo; });
        var noJugaron = ranking.filter(function(r) { return !r.jugo; });

        var rowsHtml = "";
        if (jugaron.length === 0) {
            rowsHtml = '<div class="x-empty" style="padding:18px;text-align:center;color:var(--text-muted)">Sin participantes aún.</div>';
        } else {
            rowsHtml = '<div class="comp-ranking-list">' +
                jugaron.map(function(r) {
                    var esMio = r.uid === uid;
                    var xp = xpDist[r.uid] || 0;
                    var medallaIcon = r.lugar === 1 ? "🥇" : r.lugar === 2 ? "🥈" : r.lugar === 3 ? "🥉" : "";
                    return '<div class="comp-ranking-row' + (esMio ? ' comp-ranking-row--mio' : '') + '">' +
                        '<div style="font-weight:700;color:var(--accent-cyan-text);min-width:24px">' + (r.lugar || "—") + '°' + (medallaIcon ? ' ' + medallaIcon : '') + '</div>' +
                        '<div style="flex:1">' + _intraEstAlumnoLabel(r.uid, 20) + (esMio ? ' <span class="x-chip x-chip--ok" style="font-size:9px;margin-left:4px">tú</span>' : "") + '</div>' +
                        '<div class="x-mono-sm" style="text-align:right">' + r.aciertos + ' ac · ' + r.partidas + ' part.</div>' +
                        '<div class="x-mono-sm" style="min-width:60px;text-align:right;color:var(--xahni-amber)">+' + xp + ' XP</div>' +
                    '</div>';
                }).join("") +
                (noJugaron.length > 0
                    ? '<div style="font-size:11px;color:var(--text-muted);margin-top:12px;margin-bottom:4px;padding:0 4px">Sin participación</div>' +
                      noJugaron.map(function(r) {
                          var esMio = r.uid === uid;
                          return '<div class="comp-ranking-row" style="opacity:0.55' + (esMio ? ";background:var(--xahni-cyan-dim)" : "") + '">' +
                              '<div style="min-width:24px;color:var(--text-muted)">—</div>' +
                              '<div style="flex:1">' + _intraEstAlumnoLabel(r.uid, 20) + '</div>' +
                              '<div style="font-size:11px;color:var(--text-muted)">no participó</div>' +
                              '<div class="x-mono-sm" style="min-width:60px">+0 XP</div>' +
                          '</div>';
                      }).join("")
                    : "") +
            '</div>';
        }

        body.innerHTML = rowsHtml;

        if (typeof openModal === "function") openModal("modal-intra-ranking");
    }

    function cerrarModalRanking() {
        if (typeof closeModal === "function") closeModal("modal-intra-ranking");
    }

    // ── Listener post-juego ─────────────────────────────────────────────────
    // Cuando el motor de juego termina, emite "xahni:juegoTerminado" con
    // { juegoId, aciertos, tiempoMs }. Registramos la partida intra
    // y re-renderizamos el grid.
    var _torneoActivoId = null;

    document.addEventListener("xahni:juegoTerminado", function(e) {
        if (!_torneoActivoId) return;
        var uid = APP?.user?.id;
        if (!uid) { _torneoActivoId = null; return; }
        var det = e.detail || {};
        var aciertos = typeof det.aciertos === "number" ? det.aciertos : 0;
        // Los motores dispatcha tiempoSegundos (quiz-jugar/vf-jugar/flashcards-jugar).
        // TorneosIntraData.registrarPartida espera tiempoMs. Convertimos aquí.
        var tiempoMs = typeof det.tiempoMs === "number" ? det.tiempoMs
                     : (typeof det.tiempoSegundos === "number" ? det.tiempoSegundos * 1000 : 0);

        var result = TorneosIntraData.registrarPartida(_torneoActivoId, uid, aciertos, tiempoMs);
        var torneoId = _torneoActivoId;
        _torneoActivoId = null;

        if (result.ok) {
            if (typeof showToast === "function") {
                showToast("✓ Partida registrada · " + aciertos + " aciertos", "ok");
            }
        } else if (result.error === "cap_excedido") {
            // No debería ocurrir (bloqueado antes de abrir juego), pero guard defensivo
            if (typeof showToast === "function") showToast("Ya agotaste tus partidas en este torneo.", "info");
        }

        // Re-render del grid intra si está visible
        var panel = document.getElementById("hub-grupo-tab-competencias");
        if (panel && panel.offsetParent !== null && typeof buildCompetencias === "function") {
            buildCompetencias();
        }

        // Dispatch para re-renders cruzados (Task 19)
        try {
            document.dispatchEvent(new CustomEvent("xahni:torneoIntraJugado", {
                detail: { torneoId: torneoId, uid: uid }
            }));
        } catch (ex) { /* defensive */ }
    });

    // ── Refresh reactivo (Task 19: cross-device) ────────────────────────────
    // xahni:torneoIntraTerminado — otro cliente (profesor u otro alumno) cerró
    // el torneo. Re-renderizamos la lista del alumno para reflejar el cambio.
    document.addEventListener("xahni:torneoIntraTerminado", function() {
        var panel = document.getElementById("hub-grupo-tab-competencias");
        if (panel && panel.offsetParent !== null && typeof buildCompetencias === "function") {
            buildCompetencias();
        }
    });

    // xahni:firestoreHydrated — Firestore actualizó DEMO_TORNEOS_INTRA desde
    // el servidor (otro dispositivo creó/cerró/jugó). Re-render para sincronizar.
    document.addEventListener("xahni:firestoreHydrated", function() {
        var panel = document.getElementById("hub-grupo-tab-competencias");
        if (panel && panel.offsetParent !== null && typeof buildCompetencias === "function") {
            buildCompetencias();
        }
    });

    return {
        renderAlumno: renderAlumno,
        jugarPartida: jugarPartida,
        abrirModalRanking: abrirModalRanking,
        cerrarModalRanking: cerrarModalRanking,
        // Expuesto para acceso desde consola/debug
        _statsHeroIntraAlumno: _statsHeroIntraAlumno
    };
})();

window.EstudianteTorneosIntra = EstudianteTorneosIntra;
