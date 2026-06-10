// ═══════════════════════════════════════════════════════════
// PROFESOR · Hub Grupo · Tab Calendario
// Renderiza el patron `.cal-*` (CSS en css/core/calendario.css)
// delegando en helpers shared `_cal*` de js/core/builders-core.js.
//
// Slice calendario rediseño 2026-06-02 · refactor desde `.x-calendar__*`
// legacy a `.cal-*` cross-rol. Twin de js/estudiante/hub-calendario.js.
// Agrega prof-header con grupo dropdown + KPIs (calificar / riesgo).
//
// VANILLA HARDCODED — post-migración Supabase los KPIs reales saldrán de
// vistas materializadas (tareas_pendientes_calificar, alumnos_en_riesgo).
// ═══════════════════════════════════════════════════════════

(function () {
    "use strict";

    // ── Estado interno ────────────────────────────────────
    let _visMonth = null;
    let _visYear  = null;
    let _selectedDay = null;

    // ── Lookups ───────────────────────────────────────────
    /**
     * @interaction get-grupo-activo-prof-calendario
     * @scope profesor-hub-calendario-iife-internal
     *
     * Given APP.user activo + APP.profGrupoActivo seteado por el hub-shell
     *   (switch de grupo cross-tab).
     * When `hubCalendarioProfRender` u `profHubCalendarioOpenEvent` necesitan
     *   el objeto Grupo completo (no solo el id) para pasarlo a
     *   `_calBuildEvents("profesor", grupo, ...)` o para chequear miembros.
     * Then lookup en DEMO_GRUPOS por id y retorna el grupo o null.
     * Edge:
     *   - APP undefined o sin user → null (early return).
     *   - APP.profGrupoActivo undefined (estado inicial pre-switch) → null;
     *     `hubCalendarioProfRender` pinta el wrapper "No hay grupo activo".
     *   - DEMO_GRUPOS no cargado → grupos vacío → find devuelve undefined → null.
     *   - Grupo borrado vía CRUD admin después de seteado el id activo → null;
     *     caller maneja con mensaje.
     *   - Helper IIFE-LOCAL: NO expuesto en window (encapsulado en el módulo
     *     `(function() { ... })()`). Sólo los `prof*` y `hubCalendarioProfRender`
     *     son exports.
     *   - Deuda post-Supabase: query `grupos` by id con RLS por professor_id.
     */
    function _getGrupoActivo() {
        if (typeof APP === "undefined" || !APP.user) return null;
        const gid = APP.profGrupoActivo;
        if (!gid) return null;
        const grupos = (typeof DEMO_GRUPOS !== "undefined") ? DEMO_GRUPOS : [];
        return grupos.find(g => g.id === gid) || null;
    }

    // ── Render entry point ────────────────────────────────
    /**
     * @interaction hubCalendarioProfRender
     * @scope profesor-hub-calendario
     *
     * Given el profesor está logueado y tiene grupo activo seteado en
     *   APP.profGrupoActivo (el switch de grupo lo provee el hub-shell,
     *   no este módulo).
     * When invocado desde hub-aprendizaje.js al switch de tab calendario.
     * Then resuelve el grupo, computa eventos via
     *   `_calBuildEvents("profesor", grupo, visMonth, visYear)` y emite el
     *   wrapper en `#prof-hub-calendario-root` via `_calRenderWrapper(...)`.
     *   El layout es idéntico al de alumno (header + body con mini 50% +
     *   side 50% que contiene agenda + legend). Solo cambian las clases
     *   semánticas via `[data-rol="profesor"]` (densidad bumpeada) y la
     *   semántica de eventos via el filtro de `_calBuildEvents("profesor")`.
     * Edge: sin grupo activo → emite wrapper vacío con mensaje.
     *   Argumentos targetId/uid/grupoActivo se aceptan pero no se usan
     *   (estado interno + APP.profGrupoActivo son la única fuente).
     */
    function hubCalendarioProfRender(_targetId, _uid, _grupoActivo) {
        const root = document.getElementById("prof-hub-calendario-root");
        if (!root) return;
        const grupo = _getGrupoActivo();
        if (!grupo) {
            root.innerHTML = '<div class="cal-wrapper" data-rol="profesor"><div class="cal-agenda"><span class="cal-agenda__empty">No hay grupo activo.</span></div></div>';
            return;
        }
        if (_visMonth === null) {
            const hoy = new Date();
            _selectedDay = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
            _visMonth = hoy.getMonth();
            _visYear  = hoy.getFullYear();
        }
        const events = _calBuildEvents("profesor", grupo, _visMonth, _visYear);
        root.innerHTML = _calRenderWrapper("profesor", {
            visMonth: _visMonth,
            visYear:  _visYear,
            selectedDay: _selectedDay,
            events:   events,
            navPrev:  "profHubCalendarioPrev()",
            navNext:  "profHubCalendarioNext()",
            pickDay:  "profHubCalendarioPickDay",
            openEvent:"profHubCalendarioOpenEvent",
            grupoMiembrosCount: (grupo.miembros || []).length
        });
    }

    /**
     * @interaction profHubCalendarioPickDay
     * @scope profesor-hub-calendario
     * Given celda mini-mes recibe click.
     * Then settea _selectedDay, ajusta visMonth/Year si cambió, re-render.
     */
    function profHubCalendarioPickDay(ymd) {
        const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return;
        _selectedDay = new Date(+m[1], +m[2] - 1, +m[3]);
        if (_selectedDay.getMonth() !== _visMonth || _selectedDay.getFullYear() !== _visYear) {
            _visMonth = _selectedDay.getMonth();
            _visYear  = _selectedDay.getFullYear();
        }
        hubCalendarioProfRender();
    }

    /**
     * @interaction profHubCalendarioOpenEvent
     * @scope profesor-hub-calendario
     * Given click en .cal-event.
     * Then navega según tipo:
     *   - hito | clase | examen → no navega (informativos / feature post-Supabase).
     *   - tarea | vencida → abre hub-materia + tab tareas via profHubAbrirMateria.
     */
    function profHubCalendarioOpenEvent(eventId) {
        const grupo = _getGrupoActivo();
        if (!grupo) return;
        const events = _calBuildEvents("profesor", grupo, _visMonth, _visYear);
        const evt = events.find(e => e.id === eventId);
        if (!evt) return;

        if (evt.tipo === "hito" || evt.tipo === "clase" || evt.tipo === "examen") {
            return; // informativos / feature futura
        }
        if (!evt.materiaId || typeof profHubAbrirMateria !== "function") return;
        profHubAbrirMateria(evt.materiaId);
        if (typeof profHubMatSwitchTab === "function") {
            const tareasTab = document.querySelector("#prof-hub-detalle-panel .hub-tab[data-tab='tareas']");
            profHubMatSwitchTab("tareas", tareasTab);
        }
    }

    /**
     * @interaction profHubCalendarioPrev
     * @scope profesor-hub-calendario
     */
    function profHubCalendarioPrev() {
        if (_visMonth === null) hubCalendarioProfRender();
        _visMonth -= 1;
        if (_visMonth < 0) { _visMonth = 11; _visYear -= 1; }
        if (!_selectedDay || _selectedDay.getMonth() !== _visMonth || _selectedDay.getFullYear() !== _visYear) {
            _selectedDay = new Date(_visYear, _visMonth, 1);
        }
        hubCalendarioProfRender();
    }

    /**
     * @interaction profHubCalendarioNext
     * @scope profesor-hub-calendario
     */
    function profHubCalendarioNext() {
        if (_visMonth === null) hubCalendarioProfRender();
        _visMonth += 1;
        if (_visMonth > 11) { _visMonth = 0; _visYear += 1; }
        if (!_selectedDay || _selectedDay.getMonth() !== _visMonth || _selectedDay.getFullYear() !== _visYear) {
            _selectedDay = new Date(_visYear, _visMonth, 1);
        }
        hubCalendarioProfRender();
    }

    // ── Exponer global (API preservada — mismos nombres que el builder legacy) ──
    window.hubCalendarioProfRender    = hubCalendarioProfRender;
    window.profHubCalendarioPickDay   = profHubCalendarioPickDay;
    window.profHubCalendarioOpenEvent = profHubCalendarioOpenEvent;
    window.profHubCalendarioPrev      = profHubCalendarioPrev;
    window.profHubCalendarioNext      = profHubCalendarioNext;
})();
