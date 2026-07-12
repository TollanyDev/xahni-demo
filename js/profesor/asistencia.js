// ═══════════════════════════════════════════════════════════
// PROFESOR · Asistencia — vista de pase de lista
// Slice 2026-05-24
// Tab "Asistencia" en hub-materia profesor entre Gestión y Tareas.
// Inyecta lazy views/profesor/asistencia.html y renderiza matriz
// alumnos × sesiones derivadas de materia.horario × parcial activo.
// ═══════════════════════════════════════════════════════════

// Estado de la vista (re-set cada llamada a asistenciaProfRender).
let _apMatId    = null;
let _apGrupoId  = null;
let _apParcial  = 1;
let _apFiltroSesiones = "todas";  // "todas" | "pasadas" | "futuras"

/**
 * @interaction render-asistencia-profesor
 * @scope profesor (asistencia)
 *
 * Given un profesor entra al tab "Asistencia" de un hub-materia con
 *   contexto (panelId, matId, grupoId, parcial).
 * When _profMatDispatchTabRender dispara asistenciaProfRender.
 * Then inyecta views/profesor/asistencia.html en panelId si el markup
 *   canónico (#ap-root) no está presente — esto cubre el caso en que un
 *   placeholder (ej. "Parcial futuro") reemplazó el contenido y se debe
 *   restaurar al volver a un parcial activo. Setea estado y llama
 *   buildAsistenciaProfesor.
 * Edge si el horario o el periodo del parcial no existen, muestra empty
 *   state explicativo sin error.
 */
async function asistenciaProfRender(panelId, matId, grupoId, parcial) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    // Slice asistencia + fix bug #7: usar presencia del markup canónico en
    // el DOM en lugar de un flag global. Si el dispatcher inyectó un
    // placeholder de "Parcial futuro" en el panel, el flag global se
    // quedaba true y nunca re-restauraba el markup al volver al parcial
    // activo. Verificar #ap-root cubre ambos casos (primer paint + recovery).
    if (!panel.querySelector("#ap-root")) {
        try {
            const res = await fetch("views/profesor/asistencia.html");
            if (!res.ok) throw new Error("status " + res.status);
            panel.innerHTML = await res.text();
        } catch (err) {
            console.error("[asistenciaProfRender] no se pudo cargar asistencia.html:", err);
            panel.innerHTML = '<div class="x-empty"><div class="x-empty__title">No se pudo cargar asistencia</div></div>';
            return;
        }
    }
    _apMatId   = matId;
    _apGrupoId = grupoId;
    _apParcial = parcial || 1;
    buildAsistenciaProfesor();
}
window.asistenciaProfRender = asistenciaProfRender;

// Listener cross-vista: si la matriz está montada y los datos cambiaron
// para esta (mat, grupo, parcial), repintar. Registrado una sola vez.
if (typeof window !== "undefined" && !window.__apListenerRegistered) {
    window.__apListenerRegistered = true;
    window.addEventListener("asistenciaChanged", (ev) => {
        const d = ev?.detail || {};
        if (!_apMatId || !_apGrupoId) return;
        if (d.materiaId === _apMatId && d.grupoId === _apGrupoId && d.parcial === _apParcial) {
            // Solo repintar KPIs y matriz; toolbar es estático tras el primer paint.
            _apRenderKpis();
            _apRenderMatriz();
        }
    });
    // Slice cerrar-parcial-integracion 2026-05-24: re-rendear banner + matriz
    // cuando el profesor cierra el parcial desde el header global estando
    // dentro de este tab.
    window.addEventListener("parcialCerradoCambio", () => {
        if (!_apMatId || !_apGrupoId) return;
        if (typeof buildAsistenciaProfesor === "function") buildAsistenciaProfesor();
    });
}

/**
 * @interaction build-asistencia-profesor
 * @scope profesor-asistencia-orchestrator
 *
 * Given el markup canónico (`#ap-root`) ya inyectado en el panel +
 *   `_apMatId` / `_apGrupoId` / `_apParcial` seteados por `asistenciaProfRender`.
 * When `asistenciaProfRender` lo invoca después del lazy-fetch del HTML,
 *   o un listener cross-vista (`asistenciaChanged` / `parcialCerradoCambio`)
 *   necesita repintar todo el tab.
 * Then orquesta 4 renders secuenciales:
 *   1. `_apRenderBannerCerrado` — banner 🔒 si el parcial está cerrado.
 *   2. `_apRenderKpis` — 3 metric-cards.
 *   3. `_apRenderToolbar` — tabs filtro.
 *   4. `_apRenderMatriz` — la matriz alumnos × sesiones.
 * Edge:
 *   - Si cualquiera de los 4 falla porque su DOM target no existe, hace
 *     no-op silencioso (cada renderer chequea su propio anchor).
 *   - Llamada idempotente: re-render limpio sin estado entre paints (banner
 *     se elimina y se recrea si aplica).
 *   - Exportado en window (`window.buildAsistenciaProfesor`) para que el
 *     listener `parcialCerradoCambio` lo pueda invocar cross-módulo.
 */
function buildAsistenciaProfesor() {
    _apRenderBannerCerrado();
    _apRenderKpis();
    _apRenderToolbar();
    _apRenderMatriz();
}

// Slice cerrar-parcial-integracion 2026-05-24: banner top cuando el parcial
// está cerrado. El tab Asistencia siempre opera sobre el parcial activo
// (no agrega múltiples parciales como Tareas), así que el banner es global
// del tab.
/**
 * @interaction render-banner-cerrado-asistencia
 * @scope profesor-asistencia-banner
 *
 * Given el tab Asistencia montado (`#ap-root` presente) + estado del parcial
 *   activo (cerrado vs no).
 * When `buildAsistenciaProfesor` orchestra el primer paint o re-render tras
 *   `parcialCerradoCambio` event.
 * Then:
 *   1. Limpia banner previo si existe (`#ap-banner-cerrado`).
 *   2. Si `isParcialCerrado` ausente o el parcial NO está cerrado → early return.
 *   3. Crea div con `cssText` inline-styled (purple-dim background + border)
 *      + emoji 🔒 + texto "Parcial N cerrado · marcas congeladas" + nota
 *      sobre override desde Gestión.
 *   4. Insert al inicio de `#ap-root`.
 * Edge:
 *   - DOM target `#ap-root` ausente → no-op silencioso (probablemente
 *     unmount del tab).
 *   - `isParcialCerrado` (helper shared `cerrar-parcial.js`) ausente parse-time
 *     → no-op defensivo.
 *   - **Estilos INLINE** (no clase canonical `.x-banner` porque no existía
 *     al momento del slice). Deuda menor: migrar a `.x-card` con variant
 *     `--locked` o equivalent.
 *   - **innerHTML directo** con `_apParcial` (number safe) — no XSS surface.
 *   - **Asimetría con tab Tareas**: Tareas tiene su propio banner cerrado
 *     porque agrega múltiples parciales (chip por parcial); Asistencia opera
 *     sobre 1 parcial → un solo banner global.
 *   - Deuda post-Supabase: cierre vía RLS policy (no banner inline; UI
 *     reacciona al estado de `escalas.cerrado`).
 */
function _apRenderBannerCerrado() {
    const root = document.getElementById("ap-root");
    if (!root) return;
    let banner = document.getElementById("ap-banner-cerrado");
    if (banner) banner.remove();
    if (typeof isParcialCerrado !== "function") return;
    if (!isParcialCerrado(_apMatId, _apGrupoId, _apParcial)) return;
    banner = document.createElement("div");
    banner.id = "ap-banner-cerrado";
    banner.style.cssText = "margin-bottom:12px;padding:12px 14px;background:var(--xahni-purple-dim);border:1px solid var(--xahni-purple)44;border-radius:var(--r-md);display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text-primary)";
    banner.innerHTML = `<span style="font-size:16px">🔒</span>
        <span><strong>Parcial ${_apParcial} cerrado</strong> · marcas de asistencia congeladas.
        <span style="color:var(--text-muted)">Liberar el cierre del parcial completo no está disponible en este slice; usar override individual desde Gestión si necesitas editar.</span></span>`;
    root.insertBefore(banner, root.firstChild);
}

/**
 * @interaction esta-cerrado-asistencia
 * @scope profesor-asistencia-helper-internal
 *
 * Given el estado del tab (`_apMatId` / `_apGrupoId` / `_apParcial`).
 * When `_apCycleEstado`, `_apBulkPresente` o `_apRenderMatriz` necesitan
 *   gate las interacciones / cambiar UI según lock-state.
 * Then wrap defensivo sobre `isParcialCerrado` (helper shared) — chequea
 *   typeof antes de llamar para tolerar orden de carga.
 *   Retorna boolean.
 * Edge:
 *   - `isParcialCerrado` no cargado → false (defensa optimista: no bloquear
 *     UX si shared no listo).
 *   - Estado tab sin matId/grupoId aún → `isParcialCerrado` retorna false
 *     (helper canonical maneja args falsy).
 *   - Helper LOCAL (sin window export). Usado 3 veces dentro del módulo.
 */
function _apEstaCerrado() {
    return typeof isParcialCerrado === "function"
        && isParcialCerrado(_apMatId, _apGrupoId, _apParcial);
}
window.buildAsistenciaProfesor = buildAsistenciaProfesor;

// ── Helpers de datos ─────────────────────────────────────────

/**
 * @interaction get-sesiones-asistencia-filtradas
 * @scope profesor-asistencia-helper-data
 *
 * Given el estado del tab (mat/grupo/parcial) + filtro local (`_apFiltroSesiones`).
 * When `_apRenderMatriz` necesita las sesiones visibles después de aplicar
 *   el filtro de la toolbar (Todas / Pasadas / Próximas).
 * Then:
 *   1. Si `deriveSesionesAsistencia` (helper shared en `asistencia.js`)
 *      ausente → `[]` defensivo.
 *   2. Resuelve sesiones canonical (horario × periodo del parcial).
 *   3. Aplica filtro local:
 *      - "pasadas" → solo `isPast === true`.
 *      - "futuras" → solo `isPast === false`.
 *      - "todas" → sin filtro (default).
 * Edge:
 *   - El filtro local `_apFiltroSesiones` se setea via `_apSetFiltro` desde
 *     toolbar; valores fuera del enum no rompen (cae a "todas").
 *   - `deriveSesionesAsistencia` es canonical en shared `asistencia.js`
 *     (no este archivo del rol); el "today" cut-off vive ahí.
 *   - Helper LOCAL (sin window export).
 *   - Función PURA respecto a inputs (no muta sesiones ni filtro).
 */
function _apGetSesiones() {
    if (typeof deriveSesionesAsistencia !== "function") return [];
    let sesiones = deriveSesionesAsistencia(_apMatId, _apGrupoId, _apParcial);
    if (_apFiltroSesiones === "pasadas") sesiones = sesiones.filter(s => s.isPast);
    else if (_apFiltroSesiones === "futuras") sesiones = sesiones.filter(s => !s.isPast);
    return sesiones;
}

/**
 * @interaction get-alumnos-asistencia
 * @scope profesor-asistencia-helper-data
 *
 * Given `_apGrupoId` seteado.
 * When `_apRenderMatriz` arma las filas (1 por alumno), `_apRenderKpis`
 *   cuenta alumnos para el KPI, o `_apBulkPresente` necesita uids para
 *   marcar a todos.
 * Then:
 *   1. Guards DEMO_GRUPOS / DEMO_USERS → `[]`.
 *   2. Lookup grupo por id.
 *   3. Resuelve `grupo.miembros[]` → User objects via DEMO_USERS.
 *   4. `filter Boolean` para descartar uids huérfanos.
 *   5. **Filtro extra `tipo === "estudiante"`** — el grupo en DEMO podría
 *      contener al profesor como "miembro" en algún seed con drift; este
 *      guard asegura que la matriz solo lista alumnos.
 * Edge:
 *   - Grupo no encontrado → `[]`.
 *   - Grupo sin miembros[] → `[]` (defensa por shape inconsistente).
 *   - User con `tipo !== "estudiante"` (e.g. el profesor accidentalmente
 *     en miembros) → filtrado silenciosamente.
 *   - Función PURA: array nuevo de referencias a User objects.
 *   - Helper LOCAL.
 *   - Similar a `getAlumnosGrupo` del data-provider pero más estricto
 *     (filtro tipo=estudiante). **Deuda consolidación**: extender el
 *     helper canonical con opción `{onlyEstudiantes: true}`.
 */
function _apGetAlumnos() {
    if (typeof DEMO_GRUPOS === "undefined" || typeof DEMO_USERS === "undefined") return [];
    const g = DEMO_GRUPOS.find(x => x.id === _apGrupoId);
    if (!g || !Array.isArray(g.miembros)) return [];
    return g.miembros
        .map(uid => DEMO_USERS.find(u => u.id === uid))
        .filter(Boolean)
        .filter(u => u.tipo === "estudiante");
}

/**
 * @interaction esc-html-asistencia
 * @scope profesor-asistencia-helper-esc
 *
 * Given un valor cualquiera `s`.
 * When el render compone HTML con `nombre`, `grupoId`, `iniciales`, etc.
 *   que vienen de DEMO_* (no entrada usuario inmediata, pero futuro Supabase
 *   sí).
 * Then convierte a String, normaliza null/undefined a "", y escapa 5
 *   caracteres: `&`, `<`, `>`, `"`, `'`.
 * Edge:
 *   - null/undefined → "" (no "null" / "undefined").
 *   - Number / Date / Object → coerced via `String()` (defensa).
 *   - **Helper LOCAL** (no exportado). Convive con `_escapeHtml` canonical
 *     + `_profEsc` / `_hgpEsc` / `_hubInicioEsc` / `_calEsc` / etc.
 *   - **Único `_*Esc` del rol que escapa apóstrofe `'`** — Decision histórica
 *     de slice asistencia (más conservador). El canonical `_escapeHtml`
 *     y los otros 4 del rol NO escapan `'`.
 *   - **Deuda consolidación post-Supabase**: extraer a `_escapeHtml`
 *     canonical en `js/core/dom-utils.js` con flag opcional para
 *     apóstrofe. Slice XSS pre-Supabase cementó la deuda.
 */
// FIX 2026-07-08: era una reimplementación duplicada de _escapeHtml
// (js/core/dom-utils.js). Ahora delega al canonical — ver CONVENTIONS.md.
function _apEsc(s) {
    return _escapeHtml(s);
}

const _AP_ESTADO_META = {
    presente: { icon: "✓", color: "var(--state-ok)",     bg: "var(--state-ok-dim)",     label: "Presente" },
    retardo:  { icon: "R", color: "var(--state-warn)",   bg: "var(--state-warn-dim)",   label: "Retardo"  },
    ausente:  { icon: "⊘", color: "var(--state-danger)", bg: "var(--state-danger-dim)", label: "Ausente"  },
};

/**
 * @interaction mes-corto-asistencia
 * @scope profesor-asistencia-helper-fecha
 *
 * Given un `Date` d.
 * When `_apRenderMatriz` arma headers de columnas (1 columna por sesión)
 *   y necesita un label compacto "DD-mes" (ej. "07-jun") para no sobrecargar
 *   visualmente cabeceras de tabla densa.
 * Then `${DD padded}-${mes 3-letras}`. Meses array hardcoded en español
 *   abreviado (3 chars).
 * Edge:
 *   - Date inválido (NaN) → "NaN-undefined". Caller debe pasar Date válido.
 *   - **Locale hardcoded "es"** (meses array). Deuda: tomar de
 *     APP.config.locale futuro.
 *   - Función PURA.
 *   - Helper LOCAL.
 *   - **Deuda consolidación**: similar a `_calFmtYmd` / `_calFmtDdMmm` ya
 *     extraídos en `builders-core.js` calendar slice (sesión 4). Mover acá.
 */
function _apMesCorto(d) {
    const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
    return `${String(d.getDate()).padStart(2,"0")}-${meses[d.getMonth()]}`;
}

// ── Renderers ────────────────────────────────────────────────

/**
 * @interaction render-kpis-asistencia
 * @scope profesor-asistencia-render-helper
 *
 * Given el tab Asistencia montado (`#ap-kpis` presente).
 * When `buildAsistenciaProfesor` orquesta el render inicial o
 *   `_apCycleEstado`/`_apBulkPresente` invalidan datos.
 * Then 3 metric-cards:
 *   1. Sesiones del parcial (teal 📅) con delta "N pasadas · M próximas".
 *   2. Alumnos (blue 👥) con delta "del grupo {grupoId}".
 *   3. Asistencia grupo (purple/amber/red por umbral) con delta
 *      "promedio sobre sesiones pasadas".
 *   - %asistencia grupo = avg(`calcResumenAsistencia.pctPresente`) sobre
 *     todos los alumnos del grupo.
 *   - Umbral colors: ≥80 purple (good) / ≥60 amber (warn) / <60 red (danger).
 * Edge:
 *   - `#ap-kpis` ausente → no-op.
 *   - alumnos.length 0 → pctGrupo 0 → red. Decisión: KPI visible incluso
 *     sin datos.
 *   - `_apEsc` aplicado a `_apGrupoId` por consistencia (no es necesario
 *     porque ids son alfanum, defensa por convención).
 *   - `deriveSesionesAsistencia` invocado SIN filtro local (KPI usa total,
 *     no la vista filtrada) — distintivo vs `_apGetSesiones`.
 *   - Función PURA respecto a outputs (innerHTML reescritura completa).
 */
function _apRenderKpis() {
    const el = document.getElementById("ap-kpis");
    if (!el) return;
    const sesiones = deriveSesionesAsistencia(_apMatId, _apGrupoId, _apParcial);
    const alumnos = _apGetAlumnos();
    const pasadas = sesiones.filter(s => s.isPast).length;
    const futuras = sesiones.length - pasadas;

    // % asistencia grupo: promedio simple del pctPresente de cada alumno.
    let pctGrupo = 0;
    if (alumnos.length) {
        let sum = 0;
        alumnos.forEach(a => {
            const r = calcResumenAsistencia(_apMatId, _apGrupoId, _apParcial, a.id);
            sum += r.pctPresente;
        });
        pctGrupo = Math.round(sum / alumnos.length);
    }

    el.innerHTML = `<div class="x-grid">
      <div class="metric-card teal">
        <div class="metric-icon teal">📅</div>
        <div class="metric-value">${sesiones.length}</div>
        <div class="metric-label">Sesiones del parcial</div>
        <div class="metric-delta neutral">${pasadas} pasada${pasadas !== 1 ? "s" : ""} · ${futuras} próxima${futuras !== 1 ? "s" : ""}</div>
      </div>
      <div class="metric-card blue">
        <div class="metric-icon blue">👥</div>
        <div class="metric-value">${alumnos.length}</div>
        <div class="metric-label">Alumnos</div>
        <div class="metric-delta neutral">del grupo ${_apEsc(_apGrupoId || "—")}</div>
      </div>
      <div class="metric-card ${pctGrupo >= 80 ? "purple" : pctGrupo >= 60 ? "amber" : "red"}">
        <div class="metric-icon ${pctGrupo >= 80 ? "purple" : pctGrupo >= 60 ? "amber" : "red"}">✅</div>
        <div class="metric-value">${pctGrupo}%</div>
        <div class="metric-label">Asistencia grupo</div>
        <div class="metric-delta neutral">promedio sobre sesiones pasadas</div>
      </div>
    </div>`;
}

/**
 * @interaction render-toolbar-asistencia
 * @scope profesor-asistencia-render-helper
 *
 * Given `#ap-toolbar` presente + estado `_apFiltroSesiones`.
 * When `buildAsistenciaProfesor` orquesta o `_apSetFiltro` re-renderea
 *   tras cambio de filtro.
 * Then 3 tabs `.x-tabs__tab` (Todas / Pasadas / Próximas) con `is-active`
 *   sobre el filtro vigente + hint a la derecha (font 11px muted):
 *   "Click en celda para ciclar estado · Click en cabecera para marcar
 *   todos presentes".
 * Edge:
 *   - `#ap-toolbar` ausente → no-op.
 *   - **Estilos INLINE** flex (no `.x-actions` canónica por edge case del
 *     ancho del hint). Deuda menor: probar `.x-actions` con `--align-end`.
 *   - Toolbar es estático respecto a datos (solo cambia activo); listener
 *     `asistenciaChanged` NO re-renderea toolbar (solo KPIs+matriz).
 *   - `_apSetFiltro` recibe `this` button como 2do arg pero NO lo usa
 *     (deuda removible).
 */
function _apRenderToolbar() {
    const el = document.getElementById("ap-toolbar");
    if (!el) return;
    const tabs = [
        { id: "todas",   label: "Todas" },
        { id: "pasadas", label: "Pasadas" },
        { id: "futuras", label: "Próximas" },
    ];
    const tabsHTML = tabs.map(t => {
        const active = _apFiltroSesiones === t.id ? " is-active" : "";
        return `<button class="x-tabs__tab${active}" onclick="_apSetFiltro('${t.id}', this)">${t.label}</button>`;
    }).join("");
    el.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div class="x-tabs">${tabsHTML}</div>
      <div style="font-size:11px;color:var(--text-muted)">Click en celda para ciclar estado · Click en cabecera para marcar todos presentes</div>
    </div>`;
}

/**
 * @interaction set-filtro-sesiones-asistencia
 * @scope profesor-asistencia-handler
 *
 * Given click en uno de los 3 tabs filtro (Todas / Pasadas / Próximas).
 * When tab onclick dispara con el filtro id.
 * Then setea `_apFiltroSesiones` + re-renderea toolbar (para mover el
 *   `is-active`) + re-renderea matriz (para aplicar filtro).
 *   Skip KPIs (no dependen del filtro local; siempre count total).
 * Edge:
 *   - v fuera del enum válido → cae a "todas" en `_apGetSesiones` defensive
 *     branch.
 *   - btn arg ignored (deuda menor, removible).
 *   - Exportado en window para que el onclick inline lo encuentre.
 *   - Función IMPURA (muta `_apFiltroSesiones` module-scope).
 *   - Deuda post-Supabase: filtro deviene query param `?sesiones=pasadas`
 *     en el destino TS.
 */
function _apSetFiltro(v, btn) { _apFiltroSesiones = v; _apRenderToolbar(); _apRenderMatriz(); }
window._apSetFiltro = _apSetFiltro;

/**
 * @interaction render-matriz-asistencia
 * @scope profesor-asistencia-render-helper-matriz
 *
 * Given `#ap-matriz-wrap` presente + estado del tab (mat/grupo/parcial/filtro).
 * When `buildAsistenciaProfesor` orquesta el primer paint, o `_apCycleEstado`/
 *   `_apBulkPresente`/`_apSetFiltro` invalidan datos.
 * Then construye una tabla HTML densa (alumnos × sesiones) con sticky columns:
 *   1. Empty state si alumnos vacío o sesiones vacío (con icon + título +
 *      desc explicativa).
 *   2. `cerrado = _apEstaCerrado()` para readonly mode global.
 *   3. Header row: columna sticky-left "Alumno" + N columnas (1 por sesión)
 *      con `_apMesCorto(fecha)` + sticky-right "% · P·R·A".
 *   4. Por cada alumno (row):
 *      - Sticky-left: nombre + iniciales (mono).
 *      - N celdas: marca actual (con `_AP_ESTADO_META` icon + bg + color)
 *        o "─" (sin marca pasada) o "⏱" (próxima).
 *      - Sticky-right: pctPresente (% coloreado por umbral 80/60) +
 *        breakdown P·R·A.
 *   5. Legend final inline con 5 leyendas.
 * Edge:
 *   - DOM target ausente → no-op.
 *   - cerrado=true: TODAS las celdas readonly (cursor:default, sin onclick,
 *     opacity:.55). Banner global ya visible arriba.
 *   - cerrado=false + sesión futura: readonly (cursor:default, opacity:.45).
 *   - cerrado=false + sesión pasada: clickable (cursor:pointer + onclick
 *     `_apCycleEstado` / `_apBulkPresente`).
 *   - **TODOS los estilos INLINE** (no clases canonical) — slice asistencia
 *     se hizo antes de cementar `.x-table` canonical. Deuda gigante: tabla
 *     a `.x-table` con variants `--sticky` + `--matriz`. Mitiga: borde
 *     consistente con `var(--border)` y bg con `var(--surface-1/2)`.
 *   - `_apEsc` aplicado a `_apGrupoId`, `nombre`, `iniciales`, `titulo`
 *     (XSS-safe en DEMO; sigue safe en Supabase si seed se respeta).
 *   - Más LOC del módulo (~100 LOC) — el "core" visual del tab.
 *   - Deuda post-Supabase: render incremental via virtual scroll para
 *     grupos >40 alumnos × >20 sesiones.
 */
function _apRenderMatriz() {
    const el = document.getElementById("ap-matriz-wrap");
    if (!el) return;
    const sesiones = _apGetSesiones();
    const alumnos  = _apGetAlumnos();

    if (!alumnos.length) {
        el.innerHTML = `<div class="x-empty">
          <div class="x-empty__icon">👥</div>
          <div class="x-empty__title">Sin alumnos en este grupo</div>
          <div class="x-empty__desc">No hay miembros estudiantes registrados en ${_apEsc(_apGrupoId)}.</div>
        </div>`;
        return;
    }
    if (!sesiones.length) {
        el.innerHTML = `<div class="x-empty">
          <div class="x-empty__icon">📅</div>
          <div class="x-empty__title">Sin sesiones que mostrar</div>
          <div class="x-empty__desc">Verifica que la materia tenga horario para este grupo y que el parcial esté en curso.</div>
        </div>`;
        return;
    }

    // Slice cerrar-parcial-integracion: si el parcial está cerrado, todas
    // las interacciones quedan readonly.
    const cerrado = _apEstaCerrado();

    // Header con fechas
    const headHTML = sesiones.map(s => {
        const d = new Date(s.fecha + "T00:00:00");
        const corta = _apMesCorto(d);
        const titulo = cerrado
            ? `🔒 Parcial cerrado · ${s.dia} ${s.fecha}`
            : `${s.dia} ${s.fecha} · ${s.inicio}-${s.fin}${s.salon ? " · " + s.salon : ""}`;
        const fechaClass = s.isPast ? "ap-th-past" : "ap-th-future";
        const clickable = s.isPast && !cerrado;
        const onclick = clickable ? `onclick="_apBulkPresente('${s.fecha}')"` : "";
        const cursor = clickable ? "cursor:pointer" : "cursor:default";
        return `<th class="${fechaClass}" title="${_apEsc(titulo)}" ${onclick} style="${cursor};font-size:11px;font-weight:600;text-align:center;padding:8px 6px;color:${s.isPast ? "var(--text-primary)" : "var(--text-muted)"};white-space:nowrap;background:var(--surface-1);border-bottom:1px solid var(--border)">
            ${corta}${s.isPast ? "" : " <span style=\"font-size:9px;opacity:.6\">⏱</span>"}
        </th>`;
    }).join("");

    // Filas alumnos
    const rowsHTML = alumnos.map(a => {
        const r = calcResumenAsistencia(_apMatId, _apGrupoId, _apParcial, a.id);
        const cellsHTML = sesiones.map(s => {
            const marca = getMarcaAlumno(_apMatId, _apGrupoId, _apParcial, s.fecha, a.id);
            const meta = marca ? _AP_ESTADO_META[marca] : null;
            const tituloBase = `${a.nombre} · ${s.fecha} · ${meta ? meta.label : (s.isPast ? "Sin marca" : "Sesión próxima")}`;
            const titulo = cerrado ? `🔒 Parcial cerrado · ${tituloBase}` : tituloBase;
            const inner = meta
                ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${meta.bg};color:${meta.color};font-weight:700;font-size:13px">${meta.icon}</span>`
                : s.isPast
                    ? `<span style="color:var(--text-muted);font-size:14px">─</span>`
                    : `<span style="color:var(--text-muted);font-size:12px;opacity:.5">⏱</span>`;
            const clickable = s.isPast && !cerrado;
            const onclick = clickable ? `onclick="_apCycleEstado('${s.fecha}','${a.id}')"` : "";
            const cursor = clickable ? "cursor:pointer" : "cursor:default";
            const dimStyle = cerrado ? "opacity:.55;" : (s.isPast ? "" : "opacity:.45;");
            return `<td class="ap-cell ${s.isPast ? "ap-cell--past" : "ap-cell--future"}" title="${_apEsc(titulo)}" ${onclick} style="${cursor};text-align:center;padding:6px;border-bottom:1px solid var(--border);${dimStyle}">${inner}</td>`;
        }).join("");

        const kpiColor = r.pctPresente >= 80 ? "var(--state-ok)" : r.pctPresente >= 60 ? "var(--state-warn)" : "var(--state-danger)";
        const kpiHTML = `<div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
            <span style="font-family:var(--font-mono);font-size:13px;font-weight:700;color:${kpiColor}">${r.pctPresente}%</span>
            <span style="font-size:10px;color:var(--text-muted);white-space:nowrap">${r.pres}·${r.ret}·${r.aus}</span>
        </div>`;

        return `<tr>
          <td style="position:sticky;left:0;background:var(--surface-1);padding:8px 12px;font-size:13px;color:var(--text-primary);border-bottom:1px solid var(--border);border-right:1px solid var(--border);min-width:160px;z-index:1">
            <div style="font-weight:600">${_apEsc(a.nombre)}</div>
            <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono)">${_apEsc(a.iniciales || "")}</div>
          </td>
          ${cellsHTML}
          <td style="position:sticky;right:0;background:var(--surface-1);padding:8px 12px;border-bottom:1px solid var(--border);border-left:1px solid var(--border);min-width:110px;z-index:1">${kpiHTML}</td>
        </tr>`;
    }).join("");

    el.innerHTML = `
      <div style="overflow-x:auto;border:1px solid var(--border);border-radius:var(--r-md);background:var(--surface-1)">
        <table style="border-collapse:collapse;width:100%;font-family:var(--font-sans)">
          <thead>
            <tr>
              <th style="position:sticky;left:0;background:var(--surface-2);padding:8px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);border-right:1px solid var(--border);min-width:160px;z-index:2">Alumno</th>
              ${headHTML}
              <th style="position:sticky;right:0;background:var(--surface-2);padding:8px 12px;text-align:right;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);border-left:1px solid var(--border);min-width:110px;z-index:2">% · P·R·A</th>
            </tr>
          </thead>
          <tbody>${rowsHTML}</tbody>
        </table>
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--text-muted);display:flex;gap:14px;flex-wrap:wrap">
        <span><span style="color:var(--state-ok)">✓</span> Presente</span>
        <span><span style="color:var(--state-warn)">R</span> Retardo</span>
        <span><span style="color:var(--state-danger)">⊘</span> Ausente</span>
        <span><span style="color:var(--text-muted)">─</span> Sin marca</span>
        <span><span style="color:var(--text-muted)">⏱</span> Próxima</span>
      </div>`;
}

/**
 * @interaction ciclar-asistencia-celda
 * @scope profesor (asistencia)
 *
 * Given una celda de sesión pasada en la matriz.
 * When el profesor hace click.
 * Then cicla el estado del alumno en esa sesión (null → presente →
 *   retardo → ausente → null), dispara CustomEvent asistenciaChanged y
 *   re-render local de KPIs + matriz.
 */
function _apCycleEstado(fechaIso, uid) {
    if (typeof ciclarMarcaAsistencia !== "function") return;
    // Slice cerrar-parcial-integracion: guard si el parcial está cerrado.
    if (_apEstaCerrado()) {
        if (typeof showToast === "function") showToast("🔒 Parcial cerrado · marcas congeladas", "error");
        return;
    }
    ciclarMarcaAsistencia(_apMatId, _apGrupoId, _apParcial, fechaIso, uid);
    if (typeof window !== "undefined" && typeof CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent("asistenciaChanged", {
            detail: { materiaId: _apMatId, grupoId: _apGrupoId, parcial: _apParcial, fechaIso, uid }
        }));
    }
    _apRenderKpis();
    _apRenderMatriz();
}
window._apCycleEstado = _apCycleEstado;

/**
 * @interaction bulk-presente-sesion
 * @scope profesor (asistencia)
 *
 * Given una cabecera de columna de sesión pasada.
 * When el profesor hace click.
 * Then marca a TODOS los alumnos del grupo como "presente" en esa
 *   sesión. Override (sobrescribe marcas existentes, incluyendo
 *   retardos y ausencias previas). Dispara asistenciaChanged + repaint.
 *   Muestra toast con conteo.
 * Edge si el grupo no tiene alumnos, no hace nada.
 */
function _apBulkPresente(fechaIso) {
    if (typeof marcarAsistenciaBulk !== "function") return;
    // Slice cerrar-parcial-integracion: guard si el parcial está cerrado.
    if (_apEstaCerrado()) {
        if (typeof showToast === "function") showToast("🔒 Parcial cerrado · marcas congeladas", "error");
        return;
    }
    const alumnos = _apGetAlumnos();
    const uids = alumnos.map(a => a.id);
    if (!uids.length) return;
    const n = marcarAsistenciaBulk(_apMatId, _apGrupoId, _apParcial, fechaIso, uids, "presente");
    if (typeof window !== "undefined" && typeof CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent("asistenciaChanged", {
            detail: { materiaId: _apMatId, grupoId: _apGrupoId, parcial: _apParcial, fechaIso, bulk: true }
        }));
    }
    _apRenderKpis();
    _apRenderMatriz();
    if (typeof showToast === "function") {
        showToast(`✅ ${n} alumno${n !== 1 ? "s" : ""} marcado${n !== 1 ? "s" : ""} presente`, "success");
    }
}
window._apBulkPresente = _apBulkPresente;
