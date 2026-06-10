// js/profesor/torneos-intra.js
// Slice torneos intragrupales S2 · 2026-06-09
// S2 polish 2026-06-09: wizard hereda grupo del context (APP.profGrupoActivo).
//
// ProfesorTorneosIntra  → render de cards intragrupales (reusa .comp-card / .comp-mini-ranking).
// ProfesorTorneosIntraWizard → wizard de creación intra (reusa .ctn-* del wizard intergrupal).
//
// REGLA: NO define HTML structure ni CSS classes propios.
// Todas las clases usadas (.comp-card, .comp-mini-ranking, .ctn-field, etc.)
// viven en css/core/competencias.css y css/core/patterns.css.

// ─── Helper local: escape HTML attr (mirrors builders-core._htmlAttr) ────────
// builders-core._htmlAttr no está expuesta en window, así que la replicamos.
function _intraHtmlAttr(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// ─── Helper: nombre + iniciales de alumno por uid ─────────────────────────
function _displayAlumnoLabel(uid, maxLen) {
    if (!uid) return "";
    var max = maxLen || 16;
    var users = (typeof DEMO_USERS !== "undefined" && Array.isArray(DEMO_USERS)) ? DEMO_USERS : [];
    var u = users.find(function(x) { return x.id === uid; });
    var display = u ? (u.nombre || uid) : uid;
    var iniciales = u ? (u.iniciales || display.charAt(0)) : display.charAt(0);
    if (display.length > max) display = display.slice(0, max - 1) + "…";
    return '<span class="x-truncate-inline" title="' + _intraHtmlAttr(u ? u.nombre : uid) + '">' + _intraHtmlAttr(display) + '</span>';
}

// ─── Helper: nombre del juego por id ─────────────────────────────────────
function _displayJuegoNombre(juegoId) {
    if (!juegoId) return juegoId || "—";
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

// ─── Render de una card intragrupal ──────────────────────────────────────
function _renderIntraCard(torneo, now) {
    var estado = TorneosIntraData.derivarEstado(torneo, now);
    var matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
        .find(function(m) { return m.id === torneo.materiaId; })?.nombre || torneo.materiaId;
    var grupoLabel = (typeof _displayGrupoLabel === "function")
        ? _displayGrupoLabel(torneo.grupoId, 14)
        : torneo.grupoId;
    var tipoLabel = _displayJuegoNombre(torneo.juegoId);
    var titulo = (torneo.nombre && torneo.nombre.trim())
        ? torneo.nombre.trim()
        : ("Torneo intra · " + matNom);
    var titEsc = String(titulo).replace(/</g, "&lt;");
    var chipIa = (typeof window._compEsIA === "function" && window._compEsIA({ juegoId: torneo.juegoId }))
        ? '<span class="x-chip-ia" title="Torneo basado en juego generado por Gemini IA">✨ Gemini</span>'
        : "";

    // Chip estado
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
        chipEstado = '<span class="x-chip" style="font-size:10px">📝 BORRADOR</span>';
    } else {
        // finalizada
        var ganadorLabel = torneo.ganadorUid
            ? _displayAlumnoLabel(torneo.ganadorUid, 16)
            : "—";
        chipEstado = '<span class="x-chip" style="font-size:10px;background:var(--xahni-amber-dim);color:var(--xahni-amber)">🏆 ' + ganadorLabel + '</span>';
    }

    // Mini ranking (top-3 alumnos) — espejo de inter: muestra los 3 primeros
    // alumnos del grupo aunque tengan 0 aciertos / 0 partidas, para que la
    // card no se vea "vacía" en torneos abiertos sin participaciones.
    // - finalizada: lee torneo.ranking persistido al cerrar.
    // - abierto:    computa ranking en vivo desde partidas + miembros del grupo.
    var miniRanking = "";
    if (estado === "abierto" || estado === "finalizada") {
        var rankingShow;
        if (estado === "finalizada" && torneo.ranking && torneo.ranking.length > 0) {
            rankingShow = torneo.ranking;
        } else {
            var alumnosGrp = _resolveAlumnosDelGrupo(torneo.grupoId);
            var partidasAll = TorneosIntraData.getPartidasTorneo(torneo.id);
            rankingShow = TorneosIntraData.computarRanking(torneo, partidasAll, alumnosGrp);
        }
        var filas = rankingShow.slice(0, 3);
        if (filas.length > 0) {
            miniRanking = '<div class="comp-mini-ranking">' +
                filas.map(function(r) {
                    var pts = r.aciertos + " ac · " + r.partidas + " part.";
                    var lugar = r.lugar ? r.lugar + "°" : "—";
                    return '<div class="comp-mini-ranking__row">' +
                        '<div class="comp-mini-ranking__lugar">' + lugar + '</div>' +
                        '<div>' + _displayAlumnoLabel(r.uid, 14) + '</div>' +
                        '<div class="comp-mini-ranking__pts">' + pts + '</div>' +
                    '</div>';
                }).join("") +
            '</div>';
        }
    }

    // Acciones footer
    var acciones;
    if (estado === "abierto") {
        acciones = '<button class="x-btn x-btn--ghost x-btn--danger" style="font-size:11px;padding:4px 10px" ' +
            'onclick="event.stopPropagation();ProfesorTorneosIntra.cerrarAntes(\'' + torneo.id + '\')">Cerrar antes</button>' +
            '<button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 10px" ' +
            'onclick="event.stopPropagation();ProfesorTorneosIntra.verDetalle(\'' + torneo.id + '\')">Ver detalle →</button>';
    } else {
        acciones = '<button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 10px" ' +
            'onclick="event.stopPropagation();ProfesorTorneosIntra.verDetalle(\'' + torneo.id + '\')">Ver resultados →</button>';
    }

    var totalPartic = torneo.ranking ? torneo.ranking.filter(function(r) { return r.jugo; }).length : 0;

    // Mapear estado intra → clase CSS canónica (las reglas de border-left viven en
    // .comp-card.activa / .proxima / .finalizada de css/core/competencias.css).
    var cssEstado = estado === "abierto" ? "activa"
                  : (estado === "borrador" || estado === "proxima") ? "proxima"
                  : "finalizada";  // "finalizada" → sin cambio

    return '<article class="comp-card ' + cssEstado + '" style="cursor:pointer">' +
        '<div class="comp-card__head">' +
            '<div>' +
                '<div class="comp-card__title">' + titEsc + '</div>' +
                '<div class="comp-card__meta" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">' +
                    '<span>' + matNom + ' · ' + tipoLabel + ' · 1 GRUPO · ' + grupoLabel + '</span>' +
                    chipIa +
                '</div>' +
            '</div>' +
            chipEstado +
        '</div>' +
        miniRanking +
        '<div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--text-muted)">' +
            '<span>' + totalPartic + ' participantes</span>' +
            '<span style="display:flex;gap:6px">' + acciones + '</span>' +
        '</div>' +
    '</article>';
}

// ─── Helper: alumnos del grupo por grupoId ────────────────────────────────
// Usa el campo canónico `miembros` de DEMO_GRUPOS (ver data/demo/grupos.json).
function _resolveAlumnosDelGrupo(grupoId) {
    var grupos = (typeof DEMO_GRUPOS !== "undefined" ? DEMO_GRUPOS : []);
    var grupo = grupos.find(function(g) { return g.id === grupoId; });
    return grupo ? (grupo.miembros || []) : [];
}

// ─── Helper: cierre automático por fecha (Task 18) ────────────────────────
// Sólo el profesor CREADOR dispara el cierre auto para evitar race E2
// (múltiples clientes cerrando el mismo torneo simultáneamente).
function _verificarCierresAuto(torneos, profId) {
    var now = Date.now();
    torneos.forEach(async function(t) {
        // Solo el creador actúa
        if (t.creadoPor !== profId) return;
        // Ya cerrado — idempotente
        if (t.cerradoEn) return;
        if (t.estado === "finalizada") return;
        // Aún no toca cerrar
        if (!t.fechaCierre || now < t.fechaCierre) return;

        // now >= fechaCierre y no cerrado → disparar cierre auto
        console.info("[ti-metric] cierre auto detectado", t.id);

        // Bug crítico 2026-06-09: failsafe pre-cierre. Rehidratar partidas del
        // torneo desde Firestore antes de computar ranking final, mismo motivo
        // que en cerrarAntes (cross-device attempts no llegan a localStorage).
        if (typeof window.firestoreRehydratePartidasTorneoIntra === "function") {
            try { await window.firestoreRehydratePartidasTorneoIntra(t.id); }
            catch (e) { /* defensive */ }
        }

        var alumnos = _resolveAlumnosDelGrupo(t.grupoId);
        var result = TorneosIntraData.cerrarTorneo(t.id, "auto", alumnos, null);
        if (result.ok) {
            console.info("[ti-metric] cierre auto completado", t.id, "ganador:", result.ganadorUid);
        }
    });
}

// ─── ProfesorTorneosIntra ─────────────────────────────────────────────────
var ProfesorTorneosIntra = (function() {

    function renderProfesor(contenedor) {
        if (!contenedor) return;
        if (typeof TorneosIntraData === "undefined") {
            contenedor.innerHTML = '<div class="x-empty" style="padding:36px;text-align:center;color:var(--text-muted)">Módulo de torneos intragrupales no disponible.</div>';
            return;
        }
        var uid = APP?.user?.id;
        var now = Date.now();
        // Mostrar todos los torneos intra (en S2 el profesor ve todos los de "sus" grupos)
        var todos = TorneosIntraData.getAll();

        // Task 18: verificar cierres auto antes de renderizar.
        // El profesor creador detecta torneos cuya fechaCierre ya pasó y los cierra.
        // Re-fetch después para obtener estado actualizado (cerrarTorneo muta localStorage).
        if (uid) {
            _verificarCierresAuto(todos, uid);
            todos = TorneosIntraData.getAll();  // refetch post-cierre-auto
        }

        if (todos.length === 0) {
            contenedor.innerHTML = '<div class="x-empty" style="grid-column:1/-1;padding:36px;text-align:center;color:var(--text-muted)">' +
                '<div style="font-size:32px;margin-bottom:8px">🏅</div>' +
                '<div style="margin-bottom:14px">No hay torneos intragrupales aún.</div>' +
                '<button class="x-btn x-btn--primary" onclick="ProfesorTorneosIntraWizard.abrir()">＋ Crear el primero</button>' +
            '</div>';
            return;
        }

        contenedor.innerHTML = todos.map(function(t) {
            return _renderIntraCard(t, now);
        }).join("");
    }

    async function cerrarAntes(torneoId) {
        // Modal canonical (mismo patrón que competencias-detalle.cerrarAntes inter).
        // Fallback a confirm() nativo si confirmarCanonico no está disponible.
        var confirmed;
        if (typeof confirmarCanonico === "function") {
            confirmed = await confirmarCanonico({
                icono: "⚠️",
                titulo: "Cerrar torneo intragrupal ahora",
                mensaje: "Distribuirá XP por lugar entre los participantes. No se puede deshacer.",
                accionTexto: "Cerrar ahora",
                tipo: "danger"
            });
        } else {
            confirmed = confirm("¿Cerrar el torneo intragrupal antes de tiempo?");
        }
        if (!confirmed) return;
        // Obtener alumnos del grupo para computar ranking final
        var torneo = TorneosIntraData.getById(torneoId);
        if (!torneo) return;

        // Bug crítico 2026-06-09: failsafe pre-cierre. Re-hidrata partidas
        // del torneo desde Firestore para que cerrarTorneo / computarRanking
        // vea TODAS las partidas cross-device, no solo las del propio
        // dispositivo del cerrador. Sin esto solo se procesaban las partidas
        // del user que ejecutaba el cierre.
        if (typeof window.firestoreRehydratePartidasTorneoIntra === "function") {
            try { await window.firestoreRehydratePartidasTorneoIntra(torneoId); }
            catch (e) { /* defensive */ }
        }

        // Usar _resolveAlumnosDelGrupo: lee campo canónico `miembros` de DEMO_GRUPOS.
        var alumnos = _resolveAlumnosDelGrupo(torneo.grupoId);
        var result = TorneosIntraData.cerrarTorneo(torneoId, APP?.user?.id, alumnos, null);
        if (result.ok) {
            if (typeof showToast === "function") showToast("✓ Torneo intragrupal cerrado", "ok");
            // Nota: NO redispatchar xahni:torneoIntraTerminado aquí —
            // TorneosIntraData.cerrarTorneo ya lo dispatcha con detail completo
            // (ranking + ganadorUid + xpDist). Un segundo dispatch con detail
            // parcial provocaba que firestore-sync intentara commit dos veces
            // y el segundo fallara con 400 failed-precondition.
        }
    }

    function verDetalle(torneoId) {
        // Reusa modal-intra-ranking del alumno: misma plantilla del ranking
        // (lugar, alumno, aciertos · partidas, XP). Sin restricción de rol —
        // el modal solo destaca "tú" si APP.user.id matchea, y desde profesor
        // simplemente no se resalta ninguna fila.
        if (typeof EstudianteTorneosIntra !== "undefined" && EstudianteTorneosIntra.abrirModalRanking) {
            EstudianteTorneosIntra.abrirModalRanking(torneoId);
            return;
        }
        if (typeof showToast === "function") {
            showToast("Modal de ranking no disponible", "warn");
        }
    }

    return {
        renderProfesor: renderProfesor,
        cerrarAntes: cerrarAntes,
        verDetalle: verDetalle
    };
})();
window.ProfesorTorneosIntra = ProfesorTorneosIntra;

// Refresh la tab intra cuando se crea/termina un torneo intra
document.addEventListener("xahni:torneoIntraCreado", function() {
    var panel = document.getElementById("prof-comp-intra-grid");
    if (panel && panel.offsetParent !== null) ProfesorTorneosIntra.renderProfesor(panel);
});
document.addEventListener("xahni:torneoIntraTerminado", function() {
    var panel = document.getElementById("prof-comp-intra-grid");
    if (panel && panel.offsetParent !== null) ProfesorTorneosIntra.renderProfesor(panel);
});

// Task 19: re-render cross-device — otro cliente cerró un torneo o Firestore hydrated.
document.addEventListener("xahni:firestoreHydrated", function() {
    var panel = document.getElementById("prof-comp-intra-grid");
    if (panel && panel.offsetParent !== null) ProfesorTorneosIntra.renderProfesor(panel);
});

// ─── ProfesorTorneosIntraWizard ───────────────────────────────────────────
// Wizard de creación intragrupal — mismas clases CSS .ctn-* que el wizard inter.
// Usa el modal #modal-crear-torneo-intra definido en index.html.

var ProfesorTorneosIntraWizard = (function() {

    var _state = null;

    /**
     * @interaction prof-torneo-intra-wizard-abrir
     * @scope profesor-torneos-intra-wizard
     *
     * Given APP.profGrupoActivo presente (hub-grupo activo).
     * When profesor abre el wizard intragrupal.
     * Then pre-carga grupoId desde APP.profGrupoActivo — sin selector de grupo.
     * Edge:
     *   - Si APP.profGrupoActivo no disponible (contexto desconocido), emite
     *     toast de error y no abre el wizard.
     */
    function abrir(materiaId) {
        var uid = APP?.user?.id;
        if (!uid || APP.user.tipo !== "profesor") return;

        // Heredar grupo del contexto hub activo (APP.profGrupoActivo).
        // El selector de grupo se elimina del wizard — el profesor ya está
        // navegando un grupo específico en el hub.
        var grupoCtx = APP?.profGrupoActivo || null;
        if (!grupoCtx) {
            if (typeof showToast === "function") {
                showToast("Selecciona un grupo desde el hub antes de crear un torneo intragrupal.", "warn");
            }
            return;
        }

        var matInicial = materiaId || _materiaPorDefault(uid);
        _state = {
            materiaId: matInicial,
            nombre: "",
            juegoId: null,
            grupoId: grupoCtx,     // fijo desde contexto, no editable en el wizard
            fechaInicio: _defaultFechaInicio(),
            fechaCierre: _defaultFechaCierre(),
            tabActivo: "mis-juegos"
        };
        _render();
        if (typeof openModal === "function") openModal("modal-crear-torneo-intra");
        _actualizarSubmit();
    }

    function _materiaPorDefault(uid) {
        var users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []);
        var u = users.find(function(x) { return x.id === uid; });
        return (u?.materias || [])[0] || "bd";
    }

    function _defaultFechaInicio() {
        var d = new Date();
        d.setHours(d.getHours() + 1, 0, 0, 0);
        return d.toISOString().slice(0, 16);
    }

    function _defaultFechaCierre() {
        var d = new Date();
        d.setDate(d.getDate() + 7);
        d.setHours(23, 59, 0, 0);
        return d.toISOString().slice(0, 16);
    }

    function _render() {
        var body = document.getElementById("ctn-intra-body");
        if (!body || !_state) return;

        var matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
            .find(function(m) { return m.id === _state.materiaId; })?.nombre || _state.materiaId;
        var eyebrow = document.getElementById("ctn-intra-eyebrow");
        if (eyebrow) eyebrow.textContent = "📚 " + matNom;

        // Grupo read-only: heredado de APP.profGrupoActivo (context del hub).
        // No hay selector — el grupo ya está definido por la navegación del hub.
        var grupoDisplay = typeof _displayGrupoLabel === "function"
            ? _displayGrupoLabel(_state.grupoId, 32)
            : _state.grupoId;

        body.innerHTML =
            '<div class="ctn-field">' +
                '<span class="ctn-field__label">Nombre del torneo</span>' +
                '<input type="text" class="ctn-input" placeholder="Ej. Quiz Triggers Intra" ' +
                    'value="' + (_state.nombre || "").replace(/"/g, "&quot;") + '" ' +
                    'oninput="ProfesorTorneosIntraWizard.setNombre(this.value)">' +
            '</div>' +

            '<div class="ctn-field">' +
                '<span class="ctn-field__label">Juego del torneo</span>' +
                '<div class="ctn-tabs">' +
                    '<div class="ctn-tab ' + (_state.tabActivo === 'mis-juegos' ? 'ctn-tab--active' : '') + '" ' +
                        'onclick="ProfesorTorneosIntraWizard.switchTab(\'mis-juegos\')">Mis juegos</div>' +
                '</div>' +
                _renderTabMisJuegos() +
            '</div>' +

            // Grupo fijo (read-only) — heredado del hub context, sin selector
            '<div class="ctn-field">' +
                '<span class="ctn-field__label">Grupo</span>' +
                '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;' +
                    'background:var(--surface-2,var(--bg-card));border:1px solid var(--border);' +
                    'border-radius:6px;font-size:13px;color:var(--text-primary)">' +
                    '<span style="color:var(--text-muted);font-size:11px">Grupo activo · </span>' +
                    grupoDisplay +
                '</div>' +
            '</div>' +

            '<div class="ctn-field">' +
                '<span class="ctn-field__label">Fecha de inicio</span>' +
                '<div>' +
                    '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Apertura automática — "próxima" hasta esta fecha</div>' +
                    '<input type="datetime-local" class="ctn-input" value="' + _state.fechaInicio + '" ' +
                        'onchange="ProfesorTorneosIntraWizard.setFechaInicio(this.value)">' +
                '</div>' +
            '</div>' +

            '<div class="ctn-field">' +
                '<span class="ctn-field__label">Fecha de cierre</span>' +
                '<div>' +
                    '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Cierre automático</div>' +
                    '<input type="datetime-local" class="ctn-input" value="' + _state.fechaCierre + '" ' +
                        'onchange="ProfesorTorneosIntraWizard.setFechaCierre(this.value)">' +
                '</div>' +
            '</div>';
    }

    function _renderTabMisJuegos() {
        var uid = APP.user.id;
        var seeds = (typeof DEMO_JUEGOS !== "undefined" ? DEMO_JUEGOS : []);
        var userCreated;
        try { userCreated = JSON.parse(localStorage.getItem("xahni:juegos:userCreated") || "[]"); }
        catch(e) { userCreated = []; }
        var juegos = seeds.concat(userCreated)
            .filter(function(j) { return j.materiaId === _state.materiaId && j.creadoPor === uid; });
        if (juegos.length === 0) {
            return '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center">' +
                'Sin juegos creados en esta materia.' +
            '</div>';
        }
        return '<div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto">' +
            juegos.map(function(j) {
                var itemCount = j.tipo === "quiz" ? (j.preguntas || []).length
                    : j.tipo === "vf" ? (j.afirmaciones || []).length
                    : (j.tarjetas || []).length;
                var chipIa = j.origen === "ia"
                    ? '<span class="x-chip-ia" title="Juego generado por Gemini IA" style="margin-left:6px">✨ Gemini</span>'
                    : '';
                return '<div class="ctn-juego-row ' + (_state.juegoId === j.id ? 'ctn-juego-row--selected' : '') + '" ' +
                    'onclick="ProfesorTorneosIntraWizard.setJuego(\'' + j.id + '\')">' +
                    '<input type="radio" name="ctn-intra-juego" ' + (_state.juegoId === j.id ? "checked" : "") + '>' +
                    '<div>' +
                        '<div style="font-size:13px;font-weight:600;display:flex;align-items:center;flex-wrap:wrap">' +
                            '<span>' + (j.nombre || "").replace(/</g, "&lt;") + '</span>' + chipIa +
                        '</div>' +
                        '<div style="font-size:11px;color:var(--text-muted)">' + j.tipo.toUpperCase() + ' · ' + itemCount + ' items</div>' +
                    '</div>' +
                '</div>';
            }).join("") +
        '</div>';
    }

    function setNombre(v) {
        if (!_state) return;
        _state.nombre = v;
        _actualizarSubmit();
    }

    function setJuego(juegoId) {
        if (!_state) return;
        _state.juegoId = juegoId;
        _render();
        _actualizarSubmit();
    }

    function setGrupo(grupoId) {
        if (!_state) return;
        _state.grupoId = grupoId;
        _actualizarSubmit();
    }

    function setFechaInicio(valor) {
        if (!_state) return;
        _state.fechaInicio = valor;
        _actualizarSubmit();
    }

    function setFechaCierre(valor) {
        if (!_state) return;
        _state.fechaCierre = valor;
        _actualizarSubmit();
    }

    function switchTab(tabName) {
        if (!_state || tabName !== "mis-juegos") return;
        _state.tabActivo = tabName;
        _render();
    }

    function _validar() {
        if (!_state) return false;
        if (!_state.nombre || !_state.nombre.trim()) return false;
        if (!_state.juegoId) return false;
        if (!_state.grupoId) return false;
        var inicio = new Date(_state.fechaInicio);
        var cierre = new Date(_state.fechaCierre);
        if (isNaN(inicio.getTime())) return false;
        if (isNaN(cierre.getTime())) return false;
        if (cierre <= new Date()) return false;
        if (cierre <= inicio) return false;  // cierre debe ser después del inicio
        return true;
    }

    function _actualizarSubmit() {
        var btn = document.getElementById("ctn-intra-submit");
        if (btn) btn.disabled = !_validar();
    }

    function guardar() {
        if (!_validar() || !_state) return;
        var uid = APP.user.id;
        var torneo = TorneosIntraData.crearTorneoIntra({
            nombre: _state.nombre,
            materiaId: _state.materiaId,
            grupoId: _state.grupoId,
            juegoId: _state.juegoId,
            fechaInicio: new Date(_state.fechaInicio).getTime(),
            fechaCierre: new Date(_state.fechaCierre).getTime(),
            creadoPor: uid
        });
        if (typeof showToast === "function") {
            showToast('✓ Torneo intragrupal "' + _state.nombre.trim() + '" creado', "ok");
        }
        cerrar();
        // Cambiar a modo intra para que el profesor vea el torneo recién creado
        if (typeof competenciasProfSetModo === "function") {
            competenciasProfSetModo("intra");
        }
    }

    function cerrar() {
        if (typeof closeModal === "function") closeModal("modal-crear-torneo-intra");
        _state = null;
    }

    return {
        abrir: abrir,
        cerrar: cerrar,
        setNombre: setNombre,
        setJuego: setJuego,
        setGrupo: setGrupo,
        setFechaInicio: setFechaInicio,
        setFechaCierre: setFechaCierre,
        switchTab: switchTab,
        guardar: guardar
    };
})();
window.ProfesorTorneosIntraWizard = ProfesorTorneosIntraWizard;
