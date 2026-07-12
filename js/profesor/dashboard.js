// js/profesor/dashboard.js
// Datos del dashboard de profesor derivados en vivo desde DEMO_* (data/demo/*.json),
// filtrados por el profesor que inició sesión (APP.user.id).

// Paleta determinista para colorear materias por índice.
const _PROF_MAT_PALETTE = [
  { color: "teal",   varName: "var(--xahni-teal)"        },
  { color: "amber",  varName: "var(--xahni-amber)"       },
  { color: "blue",   varName: "var(--xahni-blue-light)"  },
  { color: "purple", varName: "var(--xahni-purple)"      },
  { color: "cyan",   varName: "var(--xahni-cyan)"        },
  { color: "green",  varName: "var(--xahni-green)"       },
];

/**
 * @interaction prof-mat-color
 * @scope profesor-dashboard-helper-paleta
 *
 * Given matId + arreglo materias (de getProfDashData).
 * When un caller pinta una materia en el dashboard y necesita un par color
 *   determinista (color name + var(...)) que rote según el índice de la
 *   materia en la lista del profesor.
 * Then findIndex de matId en materias, capeado a 0 si no se encuentra,
 *   módulo 6 sobre `_PROF_MAT_PALETTE` (teal/amber/blue/purple/cyan/green).
 *   Retorna `{ color: "teal", varName: "var(--xahni-teal)" }`.
 * Edge:
 *   - matId no en materias → findIndex(-1) → Math.max(0,-1) = 0 → primer
 *     color de la paleta (teal). Convención defensiva.
 *   - materias vacío → idx = 0 → módulo 6 = 0 → teal. No crash.
 *   - **DETERMINISTA por orden** de materias en el array — si materias
 *     cambian de orden (e.g., admin reordena), el color de una misma materia
 *     cambia. Aceptado: el dashboard es read-only por sesión.
 *   - Helper LOCAL (sin export window).
 *   - Función PURA.
 *   - Migración: tabla `materia.color` persistido por admin (decisión
 *     consciente) reemplaza la rotación cliente.
 */
function _profMatColor(matId, materias) {
  const idx = Math.max(0, materias.findIndex(m => m.id === matId));
  return _PROF_MAT_PALETTE[idx % _PROF_MAT_PALETTE.length];
}

// ── Dato base unificado del dashboard del profesor ──────────
// Devuelve { materias, alumnos, byMat, riesgo, promGen, tareasPend, tareas, aprobacionPct }
/**
 * @interaction get-prof-dash-data
 * @scope profesor-dashboard-data-provider
 *
 * Given uid del profesor logueado.
 * When `buildDashboardProfesor` (legacy shell `#dash-prof-content`),
 *   `hubInicioRenderProf` (panel Inicio del hub-shell), o cualquier widget
 *   transversal del rol necesita el dato base unificado para KPIs.
 * Then resuelve `_profDataBase(uid)`. Si null → empty shape:
 *     `{ materias, alumnos, byMat, riesgo, promGen, tareasPend, tareas, aprobacionPct }`.
 *   Si ok:
 *   1. Loop materias × grupos × miembros → arma `alumnos[]` con shape rico:
 *      - id compuesto `${estId}_${matId}_${grupoId}` (unique cross-materia
 *        para el mismo alumno).
 *      - uid, nombre, ini, materia, materiaNombre, grupo, color de paleta.
 *      - prom = avg cals numéricas, entregas count, entregasTotal, entregasPct.
 *   2. byMat = índice por materiaId → lista alumnos.
 *   3. promGen = promedio de promedios > 0 (excluye alumnos sin cals).
 *   4. **riesgo = alumnos con prom > 0 AND prom < 7** (umbral suave: incluye
 *      regulares 6-7 además de reprobando <6). Sort ascendente (peor primero).
 *   5. tareasPend = tareas con (venc ≥ today) OR (alguna entrega sin cal).
 *   6. aprobacionPct = ceil(% alumnos con prom ≥ 6 sobre alumnos con prom).
 * Edge:
 *   - `_profDataBase` null → empty shape no crash en caller.
 *   - Alumno sin entregas → prom 0 → NO entra en `conPromedio` → no afecta
 *     promGen/aprobacionPct, no entra en riesgo.
 *   - alumnos[] tiene **una entrada por (alumno, materia, grupo)** —
 *     mismo alumno en 3 materias mías = 3 entradas. byMat dedupe es por
 *     materia, no por uid.
 *   - tareasPend incluye ambas: vigentes (no vencidas) Y vencidas con
 *     entregas sin calificar. Métrica "qué necesita mi atención".
 *   - Función PURA respecto a inputs.
 *   - Deuda post-Supabase: vista materializada `dashboard_prof_view` con
 *     agregados precomputados + RLS.
 */
function getProfDashData(uid) {
  const empty = {
    materias: [], alumnos: [], byMat: {},
    riesgo: [], promGen: 0, tareasPend: 0, tareas: [], aprobacionPct: 0,
  };
  const base = (typeof _profDataBase === "function") ? _profDataBase(uid) : null;
  if (!base) return empty;
  const { materias, grupos, tareas, estudiantes } = base;

  const alumnos = [];
  materias.forEach(m => {
    const palette = _profMatColor(m.id, materias);
    (m.grupos || []).forEach(grupoId => {
      const grupo    = grupos.find(g => g.id === grupoId);
      const miembros = grupo?.miembros || [];
      const tareasMG = tareas.filter(t => t.materiaId === m.id && t.grupoId === grupoId);

      miembros.forEach(estId => {
        const est = estudiantes.find(e => e.id === estId);
        if (!est) return;

        const cals = tareasMG
          .flatMap(t => t.entregas || [])
          .filter(e => e.uid === estId && typeof e.calificacion === "number")
          .map(e => e.calificacion);

        const prom = cals.length ? cals.reduce((s, c) => s + c, 0) / cals.length : 0;
        const entregasPct = tareasMG.length
          ? Math.round((cals.length / tareasMG.length) * 100)
          : 0;

        alumnos.push({
          id:            `${estId}_${m.id}_${grupoId}`,
          uid:           estId,
          nombre:        est.nombre,
          ini:           est.iniciales,
          materia:       m.id,
          materiaNombre: m.nombre,
          grupo:         grupoId,
          prom,
          entregas:      cals.length,
          entregasTotal: tareasMG.length,
          entregasPct,
          color:         palette.color,
        });
      });
    });
  });

  const byMat = {};
  alumnos.forEach(a => { (byMat[a.materia] ??= []).push(a); });

  const conPromedio = alumnos.filter(a => a.prom > 0);
  const promGen = conPromedio.length
    ? conPromedio.reduce((s, a) => s + a.prom, 0) / conPromedio.length
    : 0;

  // "En riesgo" = alumno con promedio bajo el umbral mínimo de aprobación
  // amplio (< 7). Incluye reprobando (< 6) y regulares (6–6.99): los dos
  // perfiles que el profesor querría atender. Coincide con el chip warn que
  // muestra _buildProfDashGrupos para promedios < 7.
  const riesgo = alumnos
    .filter(a => a.prom > 0 && a.prom < 7)
    .sort((a, b) => a.prom - b.prom);

  // Tareas "activas" = aún no vencidas o con entregas sin calificar
  const today = new Date();
  const tareasPend = tareas.filter(t => {
    const venc = new Date(t.fechaEntrega);
    if (venc >= today) return true;
    return (t.entregas || []).some(e => e.calificacion == null);
  }).length;

  const aprobacionPct = conPromedio.length
    ? Math.round((conPromedio.filter(a => a.prom >= 6).length / conPromedio.length) * 100)
    : 0;

  return { materias, alumnos, byMat, riesgo, promGen, tareasPend, tareas, aprobacionPct };
}

/**
 * @interaction prof-materia-stats
 * @scope profesor-dashboard-helper-stats
 *
 * Given `data` (el shape devuelto por `getProfDashData`).
 * When `_buildProfDashGrupos` arma la lista de rendimiento por materia O
 *   `getProfHeroData` elige la materia destacada, ambos consumen este shape
 *   intermedio enriquecido por materia.
 * Then map sobre `data.materias`:
 *   - palette + color (rotación por índice).
 *   - grupo = alumnos de esa materia (data.byMat[m.id]).
 *   - conProm = alumnos con prom>0.
 *   - avg = promedio cross-alumnos con prom.
 *   - aprobados = count alumnos con prom >= 6.
 *   - aprobadosPct = aprobados/conProm.
 *   - totalEsperado + totalEntregas → entregasPct global de la materia.
 *   - gruposLabel = m.grupos.join(", ").
 *   - clave + horarioStr (delegado a `formatHorarioText`).
 * Edge:
 *   - data.materias vacío → [].
 *   - Materia sin alumnos calificados → avg=0, aprobadosPct=0, entregasPct=0.
 *     UI rendere "—".
 *   - `formatHorarioText` ausente parse-time → horarioStr "" silencioso.
 *   - **Aprobados usa ≥ 6** (mientras "riesgo" usa < 7). Las dos métricas
 *     coexisten: aprobación es el umbral hard; riesgo es la franja blanda
 *     "necesita atención".
 *   - Función PURA.
 *   - Consumed por _buildProfDashGrupos + getProfHeroData + (slice C9)
 *     _hubInicioRenderRendimientoCard del hub-inicio profesor.
 */
function _profMateriaStats(data) {
    return data.materias.map((m, idx) => {
        const palette  = _PROF_MAT_PALETTE[idx % _PROF_MAT_PALETTE.length];
        const grupo    = data.byMat[m.id] || [];
        const conProm  = grupo.filter(a => a.prom > 0);
        const avg      = conProm.length ? conProm.reduce((s, a) => s + a.prom, 0) / conProm.length : 0;
        const aprobados = grupo.filter(a => a.prom >= 6).length;
        const aprobadosPct = conProm.length ? Math.round((aprobados / conProm.length) * 100) : 0;
        const totalEsperado = grupo.reduce((s, a) => s + a.entregasTotal, 0);
        const totalEntregas = grupo.reduce((s, a) => s + a.entregas, 0);
        const entregasPct = totalEsperado ? Math.round((totalEntregas / totalEsperado) * 100) : 0;
        return {
            m, idx, palette,
            color: palette.varName,
            nAlumnos: grupo.length, aprobados, aprobadosPct,
            avg, entregasPct,
            gruposLabel: (m.grupos || []).join(", "),
            clave: m.clave,
            horarioStr: (typeof formatHorarioText === "function") ? formatHorarioText(m.horario, null) : "",
        };
    });
}

/**
 * @interaction get-prof-hero-data
 * @scope profesor-dashboard-public-hero
 *
 * Given `data` (de getProfDashData).
 * When `buildDashHero` (helper shared en builders-core.js) renderiza el hero
 *   del rol profesor con la materia destacada.
 * Then:
 *   1. data falso o sin materias → null (el hero shared muestra empty state).
 *   2. Calcula `_profMateriaStats(data)`.
 *   3. Filtra `s.avg > 0`. Si todas tienen avg=0 (sin entregas calificadas),
 *      cae back a `stats` completo (todas). **Decisión consciente**: el hero
 *      muestra algo siempre, no queda vacío.
 *   4. Sort desc por avg, toma el primero.
 *   5. Retorna `{ nombre, clave, gruposLabel, horarioStr, avg, aprobadosPct }`.
 * Edge:
 *   - data.materias.length 0 → null. Pero data === undefined también → null
 *     (guard inicial `!data || !data.materias`).
 *   - Sin avg en ninguna materia → primer materia por orden alfa (stats no
 *     sortea por nombre; orden = orden en DEMO_MATERIAS).
 *   - **Slice C9**: builder fue rescatado para `_hubInicioHeroProf` (panel
 *     Inicio del hub-shell). Sigue VIVO para el shell legacy
 *     `#dash-prof-content` aunque ya no entra desde el hub.
 *   - Función PURA.
 */
function getProfHeroData(data) {
    if (!data || !data.materias || !data.materias.length) return null;
    const stats = _profMateriaStats(data);
    const conAvg = stats.filter(s => s.avg > 0);
    const best = (conAvg.length ? conAvg : stats).slice().sort((a, b) => b.avg - a.avg)[0];
    if (!best) return null;
    return {
        nombre: best.m.nombre, clave: best.clave, gruposLabel: best.gruposLabel,
        horarioStr: best.horarioStr, avg: best.avg, aprobadosPct: best.aprobadosPct,
    };
}

/**
 * @interaction init-profesor-dashboard
 * @scope profesor-dashboard-mount-legacy
 *
 * Given el usuario `u` (profesor) en el flow legacy de `loadDashboard` que
 *   delega por rol.
 * When un caller legacy (pre-shell hub) invoca el mount del dashboard del
 *   profesor — flow que YA NO ES la ruta canónica (el shell hub entra a
 *   `#screen-hub` en vez de `#screen-dashboard`).
 * Then:
 *   1. show `#dash-prof-content` (display="").
 *   2. hide `#dash-est-content` (las metric-cards del estudiante).
 *   3. Delega a `buildDashboardProfesor()` si existe.
 * Edge:
 *   - **Path LEGACY**: tras shell rework (#7+#8, merge 206ce4d, 2026-05-26),
 *     el rol profesor entra a `#screen-hub`, NO a `#screen-dashboard`. Esta
 *     fn solo se ejecuta si alguien llama `loadDashboard(u)` directo (admin
 *     usa screen-dashboard-admin separado; estudiante entró al hub también).
 *   - DOM targets `#dash-prof-content` / `#dash-est-content` siguen
 *     existiendo en index.html para retrocompatibilidad.
 *   - `buildDashboardProfesor` ausente parse-time → no-op silencioso.
 *   - **Deuda C9-leftover**: ESTA fn + `buildDashboardProfesor` + 6 builders
 *     dashboard son consumed solo por path legacy. Candidatos a cleanup
 *     post-Supabase cuando el shell legacy se retire.
 *   - El `u` (usuario) NO se usa internamente — `buildDashboardProfesor` lee
 *     `APP.user.id` directo.
 */
function initProfesorDashboard(u) {
  const get = id => document.getElementById(id);
  // Las tarjetas .metric-* viven dentro de #dash-est-content y se ocultan
  // para profesores. La vista real del profesor se renderiza en
  // #dash-prof-content por buildDashboardProfesor() con datos del JSON.
  const dashProf = get("dash-prof-content");
  if (dashProf) dashProf.style.display = "";
  const dashEst = get("dash-est-content");
  if (dashEst) dashEst.style.display = "none";
  if (typeof buildDashboardProfesor === 'function') buildDashboardProfesor();
}

// ═══════════════════════════════════════════════════════════
// RENDERER del dashboard del profesor
// ═══════════════════════════════════════════════════════════

/**
 * @interaction build-dashboard-profesor
 * @scope profesor-dashboard-renderer-legacy
 *
 * Given APP.user activo y tipo "profesor", `#dash-prof-content` presente
 *   en index.html.
 * When `initProfesorDashboard` lo invoca (legacy path) o cualquier caller
 *   directo (e.g., tests, herramienta admin).
 * Then:
 *   1. Sin target o sin user/wrong tipo → vacía/no-op.
 *   2. Resuelve `getProfDashData(APP.user.id)` o empty shape.
 *   3. Sin materias asignadas → empty state `.x-empty` con mensaje + emoji
 *      + delega a `buildDashHero` para hero del top.
 *   4. Render compuesto:
 *      - _buildProfDashKPIs (4 KPIs)
 *      - _buildProfDashQA (4 quick actions)
 *      - x-grid--2 con grupos + riesgo
 *      - x-grid--2 con dist + actividad
 *   5. buildDashHero para hero shared (delegado).
 * Edge:
 *   - **Path LEGACY** (ver `initProfesorDashboard` Edge). Solo se invoca si
 *     loadDashboard(u) entra desde screen-dashboard, no del hub.
 *   - HTML inyectado directo via innerHTML (XSS surface): los strings de
 *     usuario que entran al render pasan por escape en builders individuales
 *     (`_hubInicioEsc` en el shell nuevo; legacy `_buildProfDash*` confía en
 *     que DEMO data está controlada).
 *   - buildDashHero ausente parse-time → no-op silencioso.
 *   - Consumed solo por legacy + tests directos.
 */
function buildDashboardProfesor() {
    const el = document.getElementById("dash-prof-content");
    if (!el) return;
    if (!APP.user || APP.user.tipo !== "profesor") { el.innerHTML = ""; return; }

    const data = (typeof getProfDashData === "function")
        ? getProfDashData(APP.user.id)
        : { materias: [], alumnos: [], byMat: {}, riesgo: [], promGen: 0, tareasPend: 0, tareas: [] };

    if (!data.materias.length) {
        el.innerHTML = `<div class="x-empty"><div class="x-empty__icon">📭</div><div class="x-empty__title">No tienes materias asignadas todavía</div><div class="x-empty__desc">Cuando el administrador te asigne materias, tu panel se llenará aquí.</div></div>`;
        if (typeof buildDashHero === "function") buildDashHero();
        return;
    }

    el.innerHTML = _buildProfDashKPIs(data)
        + _buildProfDashQA(data.riesgo.length)
        + `<div class="x-grid--2" style="margin-bottom:16px">${_buildProfDashGrupos(data)}${_buildProfDashRiesgo(data)}</div>`
        + `<div class="x-grid--2">${_buildProfDashDist(data.alumnos)}${_buildProfDashActivity(data)}</div>`;

    if (typeof buildDashHero === "function") buildDashHero();
}

/**
 * @interaction build-prof-dash-kpis
 * @scope profesor-dashboard-builder-legacy
 *
 * Given `data` (getProfDashData shape).
 * When buildDashboardProfesor arma el bloque KPIs del shell legacy.
 * Then construye 4 metric-cards .x-grid:
 *   - Alumnos (teal 👥) con delta "N materias activas".
 *   - Promedio general (blue 📊) con delta "⚠️ X por debajo de 7" o "✓ Sin
 *     alumnos en riesgo".
 *   - En riesgo (purple ⚠️) con delta "Promedio < 7.0".
 *   - Tareas activas (amber 📋) con delta "Por calificar / vigentes".
 *   - promGen formateado con toFixed(1) o "—" si 0.
 * Edge:
 *   - data parcial → métricas 0 → cards visibles con números 0 y deltas.
 *   - data.alumnos.length: cada (alumno, materia, grupo) cuenta — total
 *     puede exceder número real de alumnos únicos (decisión consciente).
 *   - **Rescatado al hub-inicio**: el espejo `_hubInicioBandaMisMetricasProf`
 *     replica esta lógica (slice C9, 2026-05-25). Cualquier cambio aquí
 *     debe espejarse allí (regla rectora homogeneización).
 *   - Builder LOCAL legacy. Migración: componente shared `<KpiGrid />` en TS.
 */
function _buildProfDashKPIs(data) {
    const total    = data.alumnos.length;
    const promGen  = data.promGen;
    const nRiesgo  = data.riesgo.length;
    const tareasP  = data.tareasPend;
    const nMat     = data.materias.length;
    const matLabel = `${nMat} materia${nMat !== 1 ? "s" : ""} activa${nMat !== 1 ? "s" : ""}`;

    const kpis = [
        { cls: "teal",   icon: "👥", num: total,                              lbl: "Alumnos",          delta: matLabel },
        { cls: "blue",   icon: "📊", num: promGen ? promGen.toFixed(1) : "—",  lbl: "Promedio general", delta: nRiesgo > 0 ? `⚠️ ${nRiesgo} por debajo de 7` : "✓ Sin alumnos en riesgo" },
        { cls: "purple", icon: "⚠️", num: nRiesgo,                            lbl: "En riesgo",        delta: "Promedio < 7.0" },
        { cls: "amber",  icon: "📋", num: tareasP,                            lbl: "Tareas activas",   delta: "Por calificar / vigentes" },
    ];
    return `<div class="x-grid" style="margin-bottom:16px">
        ${kpis.map(k => `
        <div class="metric-card ${k.cls}">
            <div class="metric-icon ${k.cls}">${k.icon}</div>
            <div class="metric-value">${k.num}</div>
            <div class="metric-label">${k.lbl}</div>
            <div class="metric-delta ${k.cls === "purple" ? "" : "neutral"}">${k.delta}</div>
        </div>`).join("")}
    </div>`;
}

/**
 * @interaction build-prof-dash-qa
 * @scope profesor-dashboard-builder-legacy
 *
 * Given count de alumnos en riesgo (`nRiesgo`).
 * When buildDashboardProfesor arma la fila de quick actions del shell legacy.
 * Then 4 botones .x-btn en .x-actions, navegando con `hubShellSwitchTab`:
 *   - "+ Nueva tarea" / "↑ Subir recurso" / "📐 Escala de evaluación" → tab "materias".
 *   - "⚠️ Alumnos en riesgo" (.x-btn--danger) → tab "mi-grupo", con badge count.
 * Edge:
 *   - **FIX 2026-07-08**: los 4 botones llamaban `showView('tareas-prof')`,
 *     `showView('recursos')` y `showView('gestion-academica')` (x2, un
 *     copy-paste dejó "Alumnos en riesgo" y "Escala de evaluación" apuntando
 *     al mismo destino) — las tres vistas fueron retiradas como standalone
 *     en el cleanup C9 y nunca resueltas por `showView`, así que los 4
 *     botones no hacían NADA al hacer click. Detectado por
 *     `scripts/verificar-navegacion.js`. El propio docstring viejo ya
 *     anotaba que `_hubInicioBandaActionsProf` (hub-inicio.js) era el
 *     "espejo" moderno con la navegación correcta — este fix simplemente
 *     adopta el mismo patrón aquí en vez de dejarlo roto.
 *   - Ninguno de los 4 botones aterriza en la materia/subtab específica
 *     (p.ej. "tareas" o "escala"); solo cambian al tab "materias"/"mi-grupo"
 *     y el profesor elige la materia manualmente — mismo nivel de precisión
 *     que su espejo moderno, no una regresión.
 */
function _buildProfDashQA(nRiesgo) {
    return `<div class="x-actions" style="margin-bottom:16px">
        <button class="x-btn x-btn--primary" onclick="hubShellSwitchTab('materias')"><span>＋</span> Nueva tarea</button>
        <button class="x-btn x-btn--ghost" onclick="hubShellSwitchTab('materias')"><span>↑</span> Subir recurso</button>
        <button class="x-btn x-btn--danger" onclick="hubShellSwitchTab('mi-grupo')">⚠️ Alumnos en riesgo <span class="x-btn__badge">${nRiesgo}</span></button>
        <button class="x-btn x-btn--ghost" onclick="hubShellSwitchTab('materias')">📐 Escala de evaluación</button>
    </div>`;
}

/**
 * @interaction build-prof-dash-grupos
 * @scope profesor-dashboard-builder-legacy
 *
 * Given data (getProfDashData).
 * When buildDashboardProfesor arma la card "Rendimiento por materia".
 * Then itera `_profMateriaStats(data)`:
 *   - .x-list-row con dot color materia + título nombre + meta
 *     (N alumnos · X aprobados · gruposLabel) + .x-progress entregasPct +
 *     trail con avg coloreado por umbral (≥8 ok / ≥7 warn / >0 danger /
 *     0 muted).
 * Edge:
 *   - **Umbrales avg distintos a `_colorFinal`**: aquí ≥8 = verde, ≥7 = amber
 *     (mientras `_colorFinal` usa ≥9 = verde, ≥6 = amber). Asimetría
 *     histórica documentada.
 *   - Sin materias → empty state.
 *   - Espejo `_hubInicioRenderRendimientoCard` (slice C9) — rescatado
 *     idéntico salvo onclick (`hubShellSwitchTab('materias')` vs `showView`).
 *   - **innerHTML directo con nombre de materia sin escape** — DEMO data
 *     es controlada; deuda XSS asumida slice-pre-Supabase.
 */
function _buildProfDashGrupos(data) {
    const rows = _profMateriaStats(data).map(s => {
        const avgColor = s.avg >= 8 ? "var(--state-ok)" : s.avg >= 7 ? "var(--state-warn)" : s.avg > 0 ? "var(--state-danger)" : "var(--text-muted)";
        return `<div class="x-list-row">
            <span class="x-list-row__dot" style="background:${s.color}"></span>
            <div class="x-list-row__body">
                <div class="x-list-row__title">${s.m.nombre}</div>
                <div class="x-list-row__meta">${s.nAlumnos} alumno${s.nAlumnos !== 1 ? "s" : ""} · ${s.aprobados} aprobado${s.aprobados !== 1 ? "s" : ""} · ${s.gruposLabel || "sin grupo"}</div>
                <div class="x-progress" style="margin-top:6px"><div class="x-progress__fill" style="width:${s.entregasPct}%;background:${s.color}"></div></div>
            </div>
            <div class="x-list-row__trail" style="color:${avgColor}">${s.avg ? s.avg.toFixed(1) : "—"}</div>
        </div>`;
    }).join("");
    return `<div class="card">
        <div class="card-header">
            <span class="card-title">Rendimiento por materia</span>
            <button class="card-action" onclick="if (typeof hubShellSwitchTab === 'function') hubShellSwitchTab('materias');">Ver detalle →</button>
        </div>
        ${rows || `<div class="x-empty"><div class="x-empty__icon">📭</div><div class="x-empty__title">Sin materias</div></div>`}
    </div>`;
}

/**
 * @interaction build-prof-dash-riesgo
 * @scope profesor-dashboard-builder-legacy
 *
 * Given data (getProfDashData).
 * When buildDashboardProfesor arma la card "Alumnos en riesgo".
 * Then:
 *   - Header con título + chip danger con count si > 0.
 *   - Lista vacía → empty state "✅ Sin alumnos en riesgo".
 *   - Lista no vacía: por cada alumno en `data.riesgo`:
 *     - .x-list-row--link (clickable) → showView('gestion-academica').
 *     - avatar coloreado con `_colorFor` (mapa interno 7 paletas → {fg, bg}
 *       tokens).
 *     - title nombre, meta materia + grupo + entregas N/total.
 *     - trail con prom coloreado state-danger.
 *     - **Avatar usa `getAvatarDisplay(a.uid).fotoTexto`** si existe (helper
 *       canonical Pilar 1), fallback a `a.ini`.
 * Edge:
 *   - color del alumno no en mapa interno → fallback teal.
 *   - _colorFor es closure inline (no helper exportado) — duplica el mapa que
 *     vive en `_hubInicioRenderRiesgoCard` (espejo C9). Deuda: extraer al
 *     shared como helper canonical.
 *   - **Path LEGACY** (`showView('gestion-academica')` redirige al hub).
 *   - HTML innerHTML directo. `getAvatarDisplay` retorna `fotoTexto` ya
 *     escapado (convención del helper canonical).
 */
function _buildProfDashRiesgo(data) {
    const _colorFor = (a) => {
        const map = {
            teal:   { fg: "var(--xahni-teal)",       bg: "var(--xahni-teal-dim)"   },
            blue:   { fg: "var(--xahni-blue-light)", bg: "var(--xahni-blue-dim)"   },
            amber:  { fg: "var(--xahni-amber)",      bg: "var(--xahni-amber-dim)"  },
            red:    { fg: "var(--xahni-red)",        bg: "var(--xahni-red-dim)"    },
            green:  { fg: "var(--xahni-green)",      bg: "var(--xahni-green-dim)"  },
            purple: { fg: "var(--xahni-purple)",     bg: "var(--xahni-purple-dim)" },
            cyan:   { fg: "var(--xahni-cyan)",       bg: "var(--xahni-cyan-dim)"   },
        };
        return map[a.color] || map.teal;
    };
    const riesgo  = data.riesgo;
    const content = riesgo.length === 0
        ? `<div class="x-empty"><div class="x-empty__icon">✅</div><div class="x-empty__title">Sin alumnos en riesgo</div></div>`
        : riesgo.map(a => {
            const { fg, bg } = _colorFor(a);
            return `<div class="x-list-row x-list-row--link" onclick="if (typeof hubShellSwitchTab === 'function') hubShellSwitchTab('mi-grupo');">
                <div class="x-list-row__avatar" style="color:${fg};background:${bg}">${(typeof getAvatarDisplay === 'function' && a.uid ? getAvatarDisplay(a.uid).fotoTexto : a.ini)}</div>
                <div class="x-list-row__body">
                    <div class="x-list-row__title">${a.nombre}</div>
                    <div class="x-list-row__meta">${a.materiaNombre} · ${a.grupo} · ${a.entregas}/${a.entregasTotal} entregas</div>
                </div>
                <div class="x-list-row__trail" style="color:var(--state-danger)">${a.prom.toFixed(1)}</div>
            </div>`;
          }).join("");
    return `<div class="card">
        <div class="card-header">
            <span class="card-title">Alumnos en riesgo</span>
            ${riesgo.length ? `<span class="x-chip x-chip--danger">${riesgo.length}</span>` : ""}
        </div>
        ${content}
    </div>`;
}

/**
 * @interaction build-prof-dash-dist
 * @scope profesor-dashboard-builder-legacy
 *
 * Given alumnos (array de getProfDashData.alumnos).
 * When buildDashboardProfesor arma la card "Distribución de calificaciones".
 * Then chart-bar manual con 4 buckets fijos: <6 (rojo) / 6-7.9 (amber) /
 *   8-8.9 (teal) / 9-10 (verde). Cada barra altura proporcional al máximo
 *   (Math.max(...counts, 1) para evitar div-by-zero).
 * Edge:
 *   - alumnos vacío → buckets todos 0 → maxN=1 → barras 0% altura visibles
 *     con la label.
 *   - Alumnos con prom=0 (sin entregas) → filtrados explícitamente
 *     (conProm).
 *   - Buckets son INCLUSIVOS-EXCLUSIVOS hacia arriba: 6-7.9 incluye 6.0,
 *     6.99, NO 8.0. 9-10 incluye 9.0 y 10.0.
 *   - Chart manual sin libs (canvas/svg) — composición CSS pura. Migración:
 *     `<DistributionChart />` con Recharts o equivalente.
 *   - **Builder LEGACY** — no tiene espejo en hub-inicio (decisión slice C9:
 *     dist se posponía, finalmente no se rescató; ver `_hubInicioBanda*`).
 *     Path legacy mantiene esta visualización.
 */
function _buildProfDashDist(alumnos) {
    const conProm = alumnos.filter(a => a.prom > 0);
    const buckets = [
        { lbl: "< 6",   color: "var(--xahni-red)",   n: conProm.filter(a => a.prom < 6).length },
        { lbl: "6–7.9", color: "var(--xahni-amber)", n: conProm.filter(a => a.prom >= 6 && a.prom < 8).length },
        { lbl: "8–8.9", color: "var(--xahni-teal)",  n: conProm.filter(a => a.prom >= 8 && a.prom < 9).length },
        { lbl: "9–10",  color: "var(--xahni-green)", n: conProm.filter(a => a.prom >= 9).length },
    ];
    const maxN = Math.max(...buckets.map(b => b.n), 1);
    const bars = buckets.map(b => `
        <div class="chart-bar-col">
            <span class="x-mono-sm" style="margin-bottom:auto">${b.n}</span>
            <div class="chart-bar" style="height:${(b.n / maxN) * 100}%;background:${b.color};opacity:0.85;border-radius:4px 4px 0 0"></div>
            <div class="chart-bar-label">${b.lbl}</div>
        </div>`).join("");
    return `<div class="card">
        <div class="card-header"><span class="card-title">Distribución de calificaciones</span></div>
        <div class="chart-bar-wrap" style="height:110px">${bars}</div>
    </div>`;
}

/**
 * @interaction build-prof-dash-activity
 * @scope profesor-dashboard-builder-legacy
 *
 * Given data (getProfDashData).
 * When buildDashboardProfesor arma la card "Actividad reciente" (bottom-right
 *   del grid 2x2).
 * Then itera tareas × entregas → arma feed de eventos:
 *   - dot por calificación (amber sin cal, rojo <6, teal 6-7.99, green ≥8).
 *   - texto: "<strong>{alumno}</strong> entregó '{tarea}' — calificada N/10"
 *     o "— pendiente de calificar".
 *   - meta: `_profFormatActivityDate(fecha)` + nombre materia.
 *   - Sort desc por fecha, slice(0, 6).
 * Edge:
 *   - **innerHTML con nombre + título sin escape** (`<strong>${est.nombre}</strong>`).
 *     DEMO data controlada; deuda XSS asumida.
 *   - Sin entregas → empty state.
 *   - Mismo umbral 8 que `_buildProfDashGrupos` (no 9 como `_colorFinal`).
 *   - Espejo `_hubInicioBandaActividadProf` (slice C9) — rescatado con escape
 *     vía `_hubInicioEsc` (mejora del espejo sobre el original).
 *   - Builder LEGACY.
 */
function _buildProfDashActivity(data) {
    const estudiantesById = (typeof DEMO_USERS !== "undefined")
        ? Object.fromEntries(DEMO_USERS.map(u => [u.id, u]))
        : {};
    const matsById = Object.fromEntries(data.materias.map(m => [m.id, m]));

    const eventos = [];
    data.tareas.forEach(t => {
        const mat = matsById[t.materiaId];
        (t.entregas || []).forEach(e => {
            const est = estudiantesById[e.uid];
            if (!est) return;
            eventos.push({
                fecha: new Date(e.fecha),
                texto: e.calificacion != null
                    ? `<strong>${est.nombre}</strong> entregó "${t.titulo}" — calificada ${e.calificacion}/10`
                    : `<strong>${est.nombre}</strong> entregó "${t.titulo}" — pendiente de calificar`,
                dot: e.calificacion == null
                    ? "var(--xahni-amber)"
                    : e.calificacion >= 8 ? "var(--xahni-green)"
                    : e.calificacion >= 6 ? "var(--xahni-teal)"
                    : "var(--xahni-red)",
                materia: mat?.nombre || t.materiaId,
            });
        });
    });
    eventos.sort((a, b) => b.fecha - a.fecha);

    const top = eventos.slice(0, 6);
    const content = top.length === 0
        ? `<div class="x-empty"><div class="x-empty__icon">📡</div><div class="x-empty__title">Sin entregas registradas</div></div>`
        : top.map(a => `
        <div class="x-list-row">
            <span class="x-list-row__dot" style="background:${a.dot}"></span>
            <div class="x-list-row__body">
                <div class="x-list-row__title">${a.texto}</div>
                <div class="x-list-row__meta">${_profFormatActivityDate(a.fecha)} · ${a.materia}</div>
            </div>
        </div>`).join("");
    return `<div class="card">
        <div class="card-header"><span class="card-title">Actividad reciente</span></div>
        ${content}
    </div>`;
}

/**
 * @interaction prof-format-activity-date
 * @scope profesor-dashboard-helper-fecha
 *
 * Given un `Date` d.
 * When `_buildProfDashActivity` o el wrapper `_hubInicioFmtActivityDate` del
 *   hub-inicio formatean la fecha de un evento de feed con granularidad
 *   relativa (humanos prefieren "Hace 5 min" a un timestamp).
 * Then resolución cascada de granularidad fina → gruesa:
 *   1. diffMin < 60 (≥ 0) → "Hace N min" con max(1, diffMin) (evita "Hace 0 min").
 *   2. diffH < 24 (≥ 0) → "Hace Nh".
 *   3. diffD === 0 → "Hoy".
 *   4. diffD === 1 → "Ayer".
 *   5. 1 < diffD < 7 → "Hace N días".
 *   6. else → `d.toLocaleDateString("es-MX", {day, month-short})`.
 * Edge:
 *   - Fecha futura → diff negativo → cae al else (locale string), comportamiento
 *     inadvertido pero aceptable (eventos futuros no esperados en feed).
 *   - Locale "es-MX" hardcoded. Deuda: tomar de APP.config.locale cuando exista.
 *   - Función PURA: no muta input. Date math con ms.
 *   - Consumed cross-vista (legacy dashboard + hub-inicio nuevo) — wrapper
 *     `_hubInicioFmtActivityDate` con guard de existencia delega aquí.
 *   - Helper LOCAL (sin export).
 */
function _profFormatActivityDate(d) {
    const today = new Date();
    const diffMs = today - d;
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 60 && diffMin >= 0) return `Hace ${Math.max(1, diffMin)} min`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24 && diffH >= 0) return `Hace ${diffH}h`;
    const diffD = Math.round(diffH / 24);
    if (diffD === 0) return "Hoy";
    if (diffD === 1) return "Ayer";
    if (diffD > 0 && diffD < 7) return `Hace ${diffD} días`;
    return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}
