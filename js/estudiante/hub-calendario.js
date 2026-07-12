// ═══════════════════════════════════════════════════════════
// ESTUDIANTE · Hub Grupo · Tab Calendario
// Renderiza el patrón `.cal-*` (CSS en css/core/calendario.css)
// delegando en helpers shared `_cal*` de js/core/builders-core.js.
//
// Slice calendario rediseño 2026-06-02 · refactor desde `.x-calendar__*`
// legacy a `.cal-*` cross-rol. Twin de js/profesor/hub-calendario.js.
//
// VANILLA HARDCODED — post-migración Supabase los helpers leerán datos
// desde tablas `tareas`, `examenes`, `horarios_clase`, `parciales`.
// ═══════════════════════════════════════════════════════════

(function () {
    "use strict";

    // ── Estado interno ────────────────────────────────────
    let _visMonth = null;   // 0–11
    let _visYear  = null;
    let _selectedDay = null; // Date

    // ── Lookups ───────────────────────────────────────────
    /**
     * @interaction get-grupo-activo-est-calendario
     * @scope estudiante-hub-calendario-iife-internal
     *
     * Given APP.user activo (estudiante) + user.grupos[] array.
     * When `hubCalendarioRender` necesita el objeto Grupo completo del
     *   alumno (para pasarlo a `_calBuildEvents("alumno", grupo, ...)`).
     * Then:
     *   1. Sin APP.user → null.
     *   2. Primer grupo del alumno (`APP.user.grupos[0]`).
     *   3. Lookup en DEMO_GRUPOS por id.
     * Edge:
     *   - **Asimetría con profesor `_getGrupoActivo`**: profesor lee
     *     `APP.profGrupoActivo` (estado dinámico cross-tab); alumno lee
     *     `APP.user.grupos[0]` (primer grupo asignado, sin selector).
     *     Decisión cementada: alumno típicamente tiene 1 solo grupo activo;
     *     profesor N grupos requiere selector dinámico.
     *   - DEMO_GRUPOS no cargado → grupos vacío → find undefined → null.
     *   - Grupo no encontrado (drift seed) → null (defensive).
     *   - Helper IIFE-LOCAL (sin window export). Sólo `prof*` y
     *     `hubCalendarioRender` son exports del módulo.
     *   - Función PURA.
     *   - Twin del profesor pero con fuente distinta.
     */
    function _getGrupoActivo() {
        if (typeof APP === "undefined" || !APP.user) return null;
        const gid = (APP.user.grupos || [])[0];
        if (!gid) return null;
        const grupos = (typeof DEMO_GRUPOS !== "undefined") ? DEMO_GRUPOS : [];
        return grupos.find(g => g.id === gid) || null;
    }

    // ── Render entry point ────────────────────────────────
    /**
     * @interaction hubCalendarioRender
     * @scope estudiante-hub-calendario
     *
     * Given el alumno está logueado y el tab calendario es visible.
     * When `hubCalendarioRender()` es invocado (típicamente desde
     *   `hub-aprendizaje.js` al hacer switch de tab).
     * Then resuelve el grupo activo del alumno, computa el array de
     *   eventos vía `_calBuildEvents("alumno", grupo, visMonth, visYear)`,
     *   y emite el wrapper completo del calendario en `#hub-calendario-root`
     *   via `_calRenderWrapper("alumno", ctx)`.
     * Edge: sin grupo activo → muestra `.cal-wrapper` vacío con mensaje.
     *   Primer render del slice → setea selectedDay/visMonth/visYear a hoy.
     */
    function hubCalendarioRender() {
        const root = document.getElementById("hub-calendario-root");
        if (!root) return;
        const grupo = _getGrupoActivo();
        if (!grupo) {
            root.innerHTML = '<div class="cal-wrapper" data-rol="alumno"><div class="cal-agenda"><span class="cal-agenda__empty">No hay grupo activo.</span></div></div>';
            return;
        }
        if (_visMonth === null) {
            const hoy = new Date();
            _selectedDay = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
            _visMonth = hoy.getMonth();
            _visYear  = hoy.getFullYear();
        }
        const events = _calBuildEvents("alumno", grupo, _visMonth, _visYear);
        root.innerHTML = _calRenderWrapper("alumno", {
            visMonth: _visMonth,
            visYear:  _visYear,
            selectedDay: _selectedDay,
            events:   events,
            navPrev:  "hubCalendarioPrev()",
            navNext:  "hubCalendarioNext()",
            pickDay:  "hubCalendarioPickDay",
            openEvent:"hubCalendarioOpenEvent",
            grupoMiembrosCount: (grupo.miembros || []).length
        });
    }

    /**
     * @interaction hubCalendarioPickDay
     * @scope estudiante-hub-calendario
     *
     * Given celda mini-mes recibe click con su `YYYY-MM-DD`.
     * When invocado vía onclick generado por `_calRenderMini`.
     * Then settea `_selectedDay`; si el día cae en otro mes/año,
     *   actualiza `_visMonth`/`_visYear`; re-renderiza.
     */
    function hubCalendarioPickDay(ymd) {
        const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return;
        _selectedDay = new Date(+m[1], +m[2] - 1, +m[3]);
        if (_selectedDay.getMonth() !== _visMonth || _selectedDay.getFullYear() !== _visYear) {
            _visMonth = _selectedDay.getMonth();
            _visYear  = _selectedDay.getFullYear();
        }
        hubCalendarioRender();
    }

    /**
     * @interaction hubCalendarioOpenEvent
     * @scope estudiante-hub-calendario
     *
     * Given un event `.cal-event` recibe click.
     * When invocado vía onclick generado por `_calRenderEvent`.
     * Then resuelve el event del agregador y navega:
     *   - tipo "hito" → no navega (informativo).
     *   - tipo "clase" → no navega (informativo).
     *   - tipo "examen" → abre hub-materia + tab calificaciones (placeholder
     *     hasta que la feature Examenes esté lista; mientras tanto cae al
     *     mismo destino que tarea).
     *   - tipo "tarea"/"vencida" → abre hub-materia + tab tareas.
     */
    function hubCalendarioOpenEvent(eventId) {
        const grupo = _getGrupoActivo();
        if (!grupo) return;
        const events = _calBuildEvents("alumno", grupo, _visMonth, _visYear);
        const evt = events.find(e => e.id === eventId);
        if (!evt) return;

        if (evt.tipo === "hito" || evt.tipo === "clase") {
            return; // informativos
        }
        if (!evt.materiaNombre || typeof hubAbrirMateria !== "function") return;
        hubAbrirMateria(evt.materiaNombre);
        if (typeof hubSwitchTab === "function") {
            const tareasTab = document.querySelector(".hub-tab[data-tab='tareas']");
            hubSwitchTab("tareas", tareasTab);
        }
    }

    /**
     * @interaction hubCalendarioPrev
     * @scope estudiante-hub-calendario
     * Given click en flecha « del header.
     * When invocado vía onclick.
     * Then retrocede `_visMonth` (wrap a Dic año anterior si pasa de Ene);
     *   si `_selectedDay` queda fuera, mover a día 1; re-render.
     */
    function hubCalendarioPrev() {
        if (_visMonth === null) hubCalendarioRender();
        _visMonth -= 1;
        if (_visMonth < 0) { _visMonth = 11; _visYear -= 1; }
        if (!_selectedDay || _selectedDay.getMonth() !== _visMonth || _selectedDay.getFullYear() !== _visYear) {
            _selectedDay = new Date(_visYear, _visMonth, 1);
        }
        hubCalendarioRender();
    }

    /**
     * @interaction hubCalendarioNext
     * @scope estudiante-hub-calendario
     * Then análogo a Prev pero avanza mes.
     */
    function hubCalendarioNext() {
        if (_visMonth === null) hubCalendarioRender();
        _visMonth += 1;
        if (_visMonth > 11) { _visMonth = 0; _visYear += 1; }
        if (!_selectedDay || _selectedDay.getMonth() !== _visMonth || _selectedDay.getFullYear() !== _visYear) {
            _selectedDay = new Date(_visYear, _visMonth, 1);
        }
        hubCalendarioRender();
    }

    // ── Exponer global (API preservada — mismos nombres que el builder legacy) ──
    window.hubCalendarioRender    = hubCalendarioRender;
    window.hubCalendarioPickDay   = hubCalendarioPickDay;
    window.hubCalendarioOpenEvent = hubCalendarioOpenEvent;
    window.hubCalendarioPrev      = hubCalendarioPrev;
    window.hubCalendarioNext      = hubCalendarioNext;
})();
