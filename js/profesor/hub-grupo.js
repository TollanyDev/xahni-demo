// ═══════════════════════════════════════════════════════════
// HUB-GRUPO PROFESOR · Tab "Mi grupo" (C9)
// 3 bloques funcionales reutilizando componentes canónicos:
//   1. Ficha académica del grupo (carrera/cuatri/periodo/parcial)
//   2. KPIs agregados (promedio, tareas activas, alumnos en riesgo)
//   3. Top/bottom alumnos del grupo por promedio cross-materia
// Sin perfil gamificado del grupo (deuda Bucket B post-Firebase).
// ═══════════════════════════════════════════════════════════

/**
 * @interaction hub-grupo-prof-render-mi-grupo
 * @scope profesor-hub-grupo-entrypoint
 *
 * Given targetId del panel (`prof-hub-grupo-tab-mi-grupo`) +
 *   `grupoActivo` (APP.profGrupoActivo).
 * When `profHubGrupoSwitchTab("mi-grupo", btn)` lo invoca al entrar al tab.
 * Then construye 3 secciones del cuerpo Mi grupo:
 *   1. Chips locales (`_hgpChipsLocales`) — subtitle local + 2 chips.
 *   2. Periodo card full-width (`_hgpPeriodoCard`).
 *   3. Grid 2of3 (MAIN: KPIs + tabla densa + Top/Bottom · SIDEBAR: análisis stub).
 *   4. Wire delegado de clicks alumno (`_hgpWireListClicks`).
 * Edge:
 *   - target ausente → no-op.
 *   - grupoActivo falsy → empty state "Selecciona un grupo".
 *   - DEMO_GRUPOS no carga → grupos=[]; grupo no encontrado → empty state
 *     "Grupo no encontrado. Recarga la página."
 *   - Layout fidelidad mockup col 3 prof-on (Slice D).
 *   - **innerHTML reescritura completa**: cada switch de grupo o tab re-monta
 *     el cuerpo entero. Aceptable para volumen DEMO; deuda perf post-Supabase
 *     usar `replaceChildren` o re-render parcial.
 *   - Exportado en window (`hubGrupoProfRenderMiGrupo`) — consumer:
 *     `profHubGrupoSwitchTab` cross-archivo.
 *   - Deuda post-Supabase: KPIs reactivos via subscription.
 */
function hubGrupoProfRenderMiGrupo(targetId, grupoActivo) {
    const target = document.getElementById(targetId);
    if (!target) return;

    if (!grupoActivo) {
        target.innerHTML = `
            <div class="x-empty">
                <div class="x-empty__title">Selecciona un grupo</div>
            </div>`;
        return;
    }

    const grupos = (typeof DEMO_GRUPOS !== "undefined") ? DEMO_GRUPOS : [];
    const grupo = grupos.find(g => g.id === grupoActivo);
    if (!grupo) {
        target.innerHTML = `
            <div class="x-empty">
                <div class="x-empty__title">Grupo no encontrado</div>
                <div class="x-empty__text">El grupo activo no está disponible. Recarga la página.</div>
            </div>`;
        return;
    }

    // ── Slice D · Layout cuerpo profesor (fidelidad mockup col 3 prof-on) ──
    // Estructura: chips operativos + subtitle local + periodo card con chip Semana
    // + grid x-grid--2of3 [MAIN: KPIs + Tabla densa + Top/Riesgo · SIDEBAR: Análisis stub]
    target.innerHTML = `
        ${_hgpChipsLocales(grupo)}
        ${_hgpPeriodoCard(grupo)}
        <div class="x-grid x-grid--2of3" style="gap:16px;align-items:flex-start">
            <div style="display:flex;flex-direction:column;gap:14px">
                ${_hgpKPIs(grupo)}
                ${_hgpTablaDensaAlumnos(grupo)}
                ${_hgpTopBottom(grupo)}
            </div>
            <div style="display:flex;flex-direction:column;gap:16px">
                ${_hgpAnalisisStub()}
            </div>
        </div>
    `;

    _hgpWireListClicks(target);
}
window.hubGrupoProfRenderMiGrupo = hubGrupoProfRenderMiGrupo;

// ── Bloque 2: KPIs agregados del grupo activo ──
/**
 * @interaction hgp-kpis
 * @scope profesor-hub-grupo-builder-kpis
 *
 * Given grupo activo (objeto Grupo completo).
 * When `hubGrupoProfRenderMiGrupo` arma la columna MAIN del grid 2of3.
 * Then x-card con título "KPIs del grupo" + grid 2x2 con 4 x-stat:
 *   1. Promedio grupo (delegado a `getPromedioGrupoCrossMat` del data-provider).
 *      Mostrado con toFixed(1) o "—" si null.
 *   2. Tareas activas (delegado a `_hgpCountTareasActivas`).
 *   3. Alumnos en riesgo (delegado a `getAlumnosEnRiesgo().length`).
 *      Color warn si > 0.
 *   4. Por calificar (delegado a `_hgpCountPorCalificar`).
 *      Color warn si > 0. tooltip "Entregas pendientes...".
 * Edge:
 *   - Helpers data-provider ausentes parse-time → fallbacks null/0 silenciosos.
 *   - Función PURA (retorna string HTML, no muta).
 *   - Patrón canonical: `.x-card` + `.x-grid--2` + 4 `.x-stat`.
 *   - Espejo conceptual del KPI grid alumno hub-grupo (twin pattern).
 */
function _hgpKPIs(grupo) {
    const prom = (typeof getPromedioGrupoCrossMat === "function")
        ? getPromedioGrupoCrossMat(APP.user.id, grupo.id)
        : null;
    const riesgo = (typeof getAlumnosEnRiesgo === "function")
        ? getAlumnosEnRiesgo(APP.user.id, grupo.id).length
        : 0;
    const tareasAct = _hgpCountTareasActivas(grupo.id);
    const porCalif = _hgpCountPorCalificar(grupo.id);

    return `
        <div class="x-card">
            <div class="x-card-title">KPIs del grupo</div>
            <div class="x-grid x-grid--2" style="margin-top:10px">
                <div class="x-stat">
                    <div class="x-stat__label">Promedio grupo</div>
                    <div class="x-stat__num">${prom != null ? prom.toFixed(1) : "—"}</div>
                </div>
                <div class="x-stat">
                    <div class="x-stat__label">Tareas activas</div>
                    <div class="x-stat__num">${tareasAct}</div>
                </div>
                <div class="x-stat">
                    <div class="x-stat__label">Alumnos en riesgo</div>
                    <div class="x-stat__num" style="${riesgo > 0 ? 'color:var(--state-warn)' : ''}">${riesgo}</div>
                </div>
                <div class="x-stat" title="Entregas pendientes de calificar en el grupo activo">
                    <div class="x-stat__label">Por calificar</div>
                    <div class="x-stat__num" style="${porCalif > 0 ? 'color:var(--state-warn)' : ''}">${porCalif}</div>
                </div>
            </div>
        </div>
    `;
}

/**
 * @interaction hgp-count-tareas-activas
 * @scope profesor-hub-grupo-helper-kpi
 *
 * Given grupoId activo.
 * When `_hgpKPIs` necesita el stat "Tareas activas".
 * Then:
 *   1. DEMO_TAREAS no cargado → 0.
 *   2. Resuelve materias del prof × grupo (`getMateriasProfGrupo`).
 *   3. Set de matIds para lookup O(1).
 *   4. Filtra DEMO_TAREAS por: materiaId IN matIds AND grupoId match AND
 *      fechaEntrega ≥ today.
 *   5. Retorna count.
 * Edge:
 *   - "Activas" = vigentes (fechaEntrega ≥ hoy). NO incluye tareas vencidas
 *     con entregas sin calificar (eso es "por calificar", otro KPI).
 *     Asimetría con `getProfDashData.tareasPend` que SÍ incluye ambas.
 *   - `getMateriasProfGrupo` ausente → matIds vacío → 0 (defensa).
 *   - Tarea sin fechaEntrega → excluida (no contribuye).
 *   - **Comparación `>=` con `new Date()` actual**: tareas de hoy exactamente
 *     a las 00:00:01 cuentan como activas; las de ayer 23:59:59 no.
 *   - Función PURA.
 *   - Helper LOCAL.
 *   - Deuda post-Supabase: vista `tareas_activas_grupo` con WHERE clause SQL.
 */
function _hgpCountTareasActivas(grupoId) {
    if (typeof DEMO_TAREAS === "undefined") return 0;
    const hoy = new Date();
    const materias = (typeof getMateriasProfGrupo === "function")
        ? getMateriasProfGrupo(APP.user.id, grupoId)
        : [];
    const matIds = new Set(materias.map(m => m.id));
    return DEMO_TAREAS.filter(t => {
        if (!matIds.has(t.materiaId)) return false;
        if (t.grupoId !== grupoId) return false;
        const fecha = t.fechaEntrega ? new Date(t.fechaEntrega) : null;
        return fecha && fecha >= hoy;
    }).length;
}

/**
 * @interaction kpi-por-calificar-count
 * @scope profesor · hub-grupo · Mi grupo
 *
 * Given:  un grupoId activo del profesor.
 * When:   se calcula el stat "Por calificar" para el grupo.
 * Then:   retorna el número de entregas con entregado=true y
 *         calificacion null/undefined cross-tareas del grupo, restringido
 *         a las materias que el profesor imparte en ese grupo.
 * Edge:   DEMO_TAREAS undefined → 0. Sin materias del profesor en el grupo → 0.
 *         Tarea sin array entregas → se trata como vacío (0 contribución).
 *
 * Slice: pre-c10 6a (2026-05-26) — reemplaza placeholder "—" del KPI.
 */
function _hgpCountPorCalificar(grupoId) {
    if (typeof DEMO_TAREAS === "undefined") return 0;
    const materias = (typeof getMateriasProfGrupo === "function")
        ? getMateriasProfGrupo(APP.user.id, grupoId)
        : [];
    const matIds = new Set(materias.map(m => m.id));
    let count = 0;
    DEMO_TAREAS.forEach(t => {
        if (!matIds.has(t.materiaId)) return;
        if (t.grupoId !== grupoId) return;
        const entregas = t.entregas || [];
        entregas.forEach(e => {
            if (e.entregado && (e.calificacion == null)) count++;
        });
    });
    return count;
}

// ── Slice D · Helpers nuevos para cuerpo profesor Mi grupo ──

/**
 * @interaction hgp-periodo-meta
 * @scope profesor · hub-grupo · Mi grupo
 *
 * Given: grupoId activo del profesor
 * When:  el render del periodo card necesita el chip "Semana N de M" + nombre del cuatri
 * Then:  retorna {nombre, semanaActual, semanasTotales, estado} desde
 *        getPeriodoDeGrupo + getPeriodoInfo (core/periodo.js). Fallback hardcoded del mockup si helpers no existen.
 */
function _hgpPeriodoMeta(grupoId) {
    try {
        if (typeof getPeriodoDeGrupo === "function" && typeof getPeriodoInfo === "function") {
            const raw = getPeriodoDeGrupo(grupoId);
            const info = raw ? getPeriodoInfo(raw) : null;
            if (info) {
                return {
                    nombre: info.nombre || "Mayo–Septiembre 2026",
                    semanaActual: info.semanaActual || null,
                    semanasTotales: info.totalSemanas || null,
                    estado: info.estado || "activo"
                };
            }
        }
    } catch (_) { /* fallback silently */ }
    return { nombre: "Mayo–Septiembre 2026", semanaActual: null, semanasTotales: null, estado: "activo" };
}

/**
 * @interaction hgp-strip-periodo-label
 * @scope profesor · hub-grupo · Mi grupo
 *
 * Given: HTML body del periodo retornado por hubBuildPeriodoSection
 * When:  el periodo card muestra el chip "Semana N de M" en el title
 * Then:  elimina del body el span equivalente para evitar duplicación.
 *        Mismo patrón que estudiante hub-grupo._stripPeriodoLabel (copia local).
 */
function _hgpStripPeriodoLabel(bodyHtml) {
    if (!bodyHtml || typeof document === "undefined") return bodyHtml;
    const tmp = document.createElement("div");
    tmp.innerHTML = bodyHtml;
    tmp.querySelectorAll("span").forEach(s => {
        const t = s.textContent.trim();
        if (/^Semana \d+ de \d+$/.test(t) || t === "Aún no inicia" || t === "Periodo cerrado") {
            s.remove();
        }
    });
    return tmp.innerHTML;
}

/**
 * @interaction hgp-prom-alumno-cross-mat
 * @scope profesor · hub-grupo · Mi grupo · tabla densa
 *
 * Given: uid del profesor + uid del alumno + grupoId
 * When:  la tabla densa muestra la columna "Prom" del alumno
 * Then:  retorna el promedio cross-materia del alumno en el grupo activo
 *        para el parcial activo, restringido a las materias que el profesor imparte.
 *        Si no hay calificaciones disponibles, retorna null.
 * Edge:  helpers data-provider undefined → null. Alumno sin calificaciones → null.
 */
function _hgpPromAlumnoCrossMat(profUid, alumnoUid, grupoId) {
    if (!profUid || !alumnoUid || !grupoId) return null;
    if (typeof getMateriasProfGrupo !== "function" || typeof getCalFinalAlumnoMatParcial !== "function") return null;
    const materias = getMateriasProfGrupo(profUid, grupoId);
    if (!materias.length) return null;
    const parcial = (typeof _getParcialActivo === "function") ? _getParcialActivo(grupoId) : 2;
    let sum = 0, n = 0;
    materias.forEach(m => {
        const cal = getCalFinalAlumnoMatParcial(alumnoUid, m.id, grupoId, parcial);
        if (cal != null) { sum += cal; n++; }
    });
    return n > 0 ? +(sum / n).toFixed(1) : null;
}

/**
 * @interaction hgp-asistencia-alumno
 * @scope profesor · hub-grupo · Mi grupo · tabla densa
 *
 * Given: uid del alumno + grupoId
 * When:  la tabla densa muestra la columna "Asist" del alumno
 * Then:  retorna porcentaje de asistencia (presente + retardo cuentan como asistido)
 *        cross-materia y cross-parcial del grupo. Entero 0-100, o null si no hay datos.
 * Edge:  DEMO_ASISTENCIAS undefined → null. Alumno sin marcas → null. Sin datos del grupo → null.
 */
function _hgpAsistenciaAlumno(alumnoUid, grupoId) {
    if (!alumnoUid || !grupoId || typeof DEMO_ASISTENCIAS === "undefined") return null;
    let total = 0, asistido = 0;
    DEMO_ASISTENCIAS.forEach(rec => {
        if (rec.grupoId !== grupoId) return;
        const marcas = rec.marcas || {};
        Object.values(marcas).forEach(diaMarca => {
            const estado = diaMarca && diaMarca[alumnoUid];
            if (estado) {
                total++;
                if (estado === "presente" || estado === "retardo") asistido++;
            }
        });
    });
    return total > 0 ? Math.round((asistido / total) * 100) : null;
}

/**
 * @interaction hgp-chips-locales
 * @scope profesor · hub-grupo · Mi grupo
 *
 * Given: grupo activo
 * When:  el tab Mi grupo arranca su render
 * Then:  retorna HTML con subtitle local "N alumnos · materias" + 2 chips operativos
 *        ("N grupos asignados" + "P{N} activo"). NO duplica el page-head del shell
 *        (dropdown selector vive arriba via profHubGrupoRenderSelector).
 * Edge:  prof sin grupos asignados → chip "0 grupos". Parcial sin info → chip "P— activo".
 */
function _hgpChipsLocales(grupo) {
    const nAlumnos = (grupo.miembros || []).length;
    const materias = (typeof getMateriasProfGrupo === "function")
        ? getMateriasProfGrupo(APP.user.id, grupo.id)
        : [];
    const matLabel = materias.length === 1 ? materias[0].nombre :
                     (materias.length > 1 ? `${materias.length} materias` : "—");
    const nGruposProf = (typeof getGruposDelProfesor === "function")
        ? getGruposDelProfesor(APP.user.id).length : 0;
    const parcialActivo = (typeof _getParcialActivo === "function") ? _getParcialActivo(grupo.id) : null;
    const parcialLabel = parcialActivo ? `P${parcialActivo} activo` : "P— activo";
    return `
        <div class="pf-mg-chips-locales" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
            <div style="font-size:var(--text-size-sm);color:var(--text-secondary)">
                ${nAlumnos} alumnos · ${_hgpEsc(matLabel)}
            </div>
            <div class="x-actions" style="gap:6px">
                <span class="x-chip x-chip--info" style="font-size:var(--text-size-2xs)">${nGruposProf} grupos asignados</span>
                <span class="x-chip x-chip--brand" style="font-size:var(--text-size-2xs)">${_hgpEsc(parcialLabel)}</span>
            </div>
        </div>
    `;
}

/**
 * @interaction hgp-periodo-card
 * @scope profesor · hub-grupo · Mi grupo
 *
 * Given: grupo activo
 * When:  el tab Mi grupo renderea el periodo
 * Then:  retorna HTML del periodo card full-width con chip "Semana N de M"
 *        en el title + body con segmentos parciales (vía hubBuildPeriodoSection).
 *        Patrón espejo del estudiante (B).
 * Edge:  hubBuildPeriodoSection undefined → empty body. Sin semana → chip omitido.
 */
function _hgpPeriodoCard(grupo) {
    const periodoBodyRaw = (typeof hubBuildPeriodoSection === "function")
        ? hubBuildPeriodoSection(grupo.id) : "";
    const periodoBody = _hgpStripPeriodoLabel(periodoBodyRaw);
    const periodoMeta = _hgpPeriodoMeta(grupo.id);
    const periodoChipText = periodoMeta.estado === "futuro"
        ? "Aún no inicia"
        : periodoMeta.estado === "cerrado"
            ? "Periodo cerrado"
            : (periodoMeta.semanaActual && periodoMeta.semanasTotales
                ? `Semana ${periodoMeta.semanaActual} de ${periodoMeta.semanasTotales}`
                : "");
    const periodoChip = periodoChipText
        ? `<span class="x-chip x-chip--info" style="margin-left:auto;font-size:var(--text-size-2xs)">${periodoChipText}</span>`
        : "";
    return `
        <div class="x-card hub-grupo-periodo-full" style="margin-bottom:16px">
            <div class="x-card-title">
                <svg class="x-icon"><use href="#x-icon-calendar"></use></svg>
                Periodo · Cuatrimestre ${_hgpEsc(periodoMeta.nombre)}
                ${periodoChip}
            </div>
            ${periodoBody}
        </div>
    `;
}

/**
 * @interaction hgp-tabla-densa-alumnos
 * @scope profesor · hub-grupo · Mi grupo
 *
 * Given: grupo activo
 * When:  el cuerpo de Mi grupo renderea la tabla densa de alumnos
 * Then:  retorna HTML de card con header columns + rows por alumno con
 *        avatar 28px + nombre + prom (color-coded por umbral 6/7) + asist %.
 *        SIN columna acciones (scope D confirmado).
 *        Click row → openModalPerfilPublico(uid, 'modal', 'grupo') via _hgpWireListClicks.
 *        Grid: 32px 1fr 60px 70px (4 cols).
 * Edge:  grupo sin alumnos → x-empty. Prom null → "—". Asist null → "—".
 */
function _hgpTablaDensaAlumnos(grupo) {
    const alumnos = (typeof getAlumnosGrupo === "function") ? getAlumnosGrupo(grupo.id) : [];
    if (alumnos.length === 0) {
        return `
            <div class="x-card">
                <div class="x-card-title">Alumnos del grupo</div>
                <div class="x-empty x-empty--inline">Sin alumnos en el grupo</div>
            </div>`;
    }
    const rowsHtml = alumnos.map(a => {
        const disp = (typeof getAvatarDisplay === "function") ? getAvatarDisplay(a.id) : null;
        const fotoTexto = disp ? disp.fotoTexto : (a.nombre || a.id || "?").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
        const gradStyle = (disp && disp.gradient) ? `background:${disp.gradient}` : "background:var(--brand-gradient)";
        const prom = _hgpPromAlumnoCrossMat(APP.user.id, a.id, grupo.id);
        const promColor = prom == null ? "var(--text-muted)"
            : prom < 6 ? "var(--state-danger)"
            : prom < 7 ? "var(--state-warn)"
            : "var(--state-ok)";
        const promDisplay = prom == null ? "—" : prom.toFixed(1);
        const asist = _hgpAsistenciaAlumno(a.id, grupo.id);
        const asistDisplay = asist == null ? "—" : `${asist}%`;
        return `
            <div class="pf-mg-tabla-row x-list-row" data-alumno="${_hgpEsc(a.id)}" tabindex="0" role="button"
                 style="cursor:pointer;display:grid;grid-template-columns:32px 1fr 60px 70px;gap:8px;align-items:center">
                <div style="width:28px;height:28px;border-radius:50%;${gradStyle};display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:600">
                    ${_hgpEsc(fotoTexto)}
                </div>
                <div style="font-size:var(--text-size-sm);color:var(--text-primary)">${_hgpEsc(a.nombre || a.id)}</div>
                <div style="font-size:var(--text-size-sm);font-family:var(--font-mono);color:${promColor};font-weight:600;text-align:center">${promDisplay}</div>
                <div style="font-size:var(--text-size-xs);color:var(--text-secondary);text-align:center">${asistDisplay}</div>
            </div>`;
    }).join("");
    return `
        <div class="x-card">
            <div class="x-card-title">Alumnos del grupo</div>
            <div class="pf-mg-tabla" style="display:flex;flex-direction:column;gap:6px;margin-top:10px">
                <div class="pf-mg-tabla-head"
                     style="display:grid;grid-template-columns:32px 1fr 60px 70px;gap:8px;align-items:center;padding:4px 8px;font-size:var(--text-size-2xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">
                    <div></div>
                    <div>Alumno</div>
                    <div style="text-align:center">Prom</div>
                    <div style="text-align:center">Asist</div>
                </div>
                ${rowsHtml}
            </div>
        </div>
    `;
}

/**
 * @interaction hgp-analisis-stub
 * @scope profesor · hub-grupo · Mi grupo · sidebar
 *
 * Given: el sidebar de Mi grupo necesita un placeholder
 * When:  el cuerpo renderea la columna sidebar (1/3 derecha)
 * Then:  retorna card "Análisis del grupo" con empty state explícito
 *        "Gráficos y estadísticas por grupo disponibles post-Supabase".
 *        Fidelidad mockup col 3 prof-on sidebar.
 */
function _hgpAnalisisStub() {
    return `
        <div class="x-card">
            <div class="x-card-title">
                <svg class="x-icon"><use href="#x-icon-reportes"></use></svg>
                Análisis del grupo
            </div>
            <div class="x-empty" style="margin-top:8px;text-align:center;padding:16px 8px">
                <div class="x-empty__desc" style="font-size:var(--text-size-xs);color:var(--text-muted);font-style:italic">
                    Gráficos y estadísticas por grupo disponibles post-Supabase
                </div>
            </div>
        </div>
    `;
}

// ── Bloque 3: Top/bottom alumnos del grupo ──
/**
 * @interaction hgp-top-bottom
 * @scope profesor-hub-grupo-builder-ranking
 *
 * Given grupo activo.
 * When `hubGrupoProfRenderMiGrupo` arma la 3ra card de la columna MAIN.
 * Then:
 *   1. Delegado a `getTopBottomAlumnos(uid, grupoId, 3)` del data-provider
 *      (devuelve `{ top: [...], bottom: [...] }`).
 *   2. Si ambas listas vacías → x-empty inline "Sin promedios disponibles
 *      todavía".
 *   3. x-card con título "Alumnos · destacados / en riesgo" + x-grid--2:
 *      - Top promedio (etiqueta verde ⭐): rows con severity="ok".
 *      - En riesgo (etiqueta amber ⚠): rows con severity="danger" si <6
 *        o "warn" si 6-7.
 *      - Empty state inline en cada columna si vacío.
 *   4. Rows construidas con `_hgpRowAlumno`.
 * Edge:
 *   - `getTopBottomAlumnos` ausente → `{top: [], bottom: []}` → empty state.
 *   - Función PURA.
 *   - 3 hardcoded (top 3 / bottom 3) — convención cementada del slice D.
 *   - **Bottom usa severity dinámica por umbral 6**: alumnos <6 ya están
 *     reprobando (danger); 6-7 son "necesitan atención" (warn).
 */
function _hgpTopBottom(grupo) {
    const data = (typeof getTopBottomAlumnos === "function")
        ? getTopBottomAlumnos(APP.user.id, grupo.id, 3)
        : { top: [], bottom: [] };

    if (data.top.length === 0 && data.bottom.length === 0) {
        return `
            <div class="x-card">
                <div class="x-card-title">Alumnos del grupo</div>
                <div class="x-empty x-empty--inline">Sin promedios disponibles todavía</div>
            </div>`;
    }

    return `
        <div class="x-card">
            <div class="x-card-title">Alumnos · destacados / en riesgo</div>
            <div class="x-grid x-grid--2" style="margin-top:10px;gap:14px">
                <div>
                    <div style="font-size:11px;color:var(--state-ok);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">⭐ Top promedio</div>
                    ${data.top.map(r => _hgpRowAlumno(r, "ok")).join("") ||
                      `<div class="x-empty x-empty--inline">Sin datos</div>`}
                </div>
                <div>
                    <div style="font-size:11px;color:var(--state-warn);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">⚠ En riesgo</div>
                    ${data.bottom.map(r => _hgpRowAlumno(r, r.promedio < 6 ? "danger" : "warn")).join("") ||
                      `<div class="x-empty x-empty--inline">Sin alumnos en riesgo</div>`}
                </div>
            </div>
        </div>
    `;
}

/**
 * @interaction hgp-row-alumno
 * @scope profesor-hub-grupo-builder-row
 *
 * Given `r` (entry `{ alumno, promedio }` de getTopBottomAlumnos) + `severity`
 *   ("ok" | "warn" | "danger").
 * When `_hgpTopBottom` itera cada lista (top + bottom).
 * Then `.x-list-row` clickable (cursor:pointer) con:
 *   - data-alumno (wire delegado a click → modal perfil público).
 *   - avatar 28px circular con `getAvatarDisplay(a.id).fotoTexto` si helper
 *     canonical disponible; fallback iniciales 2-chars del nombre.
 *   - nombre + promedio (mono, color-coded por severity).
 *   - tabindex="0" + role="button" (a11y).
 * Edge:
 *   - alumno sin id (entry mal formada) → defensive `a={}` → fallback "?"
 *     en iniciales.
 *   - severity color map: ok=state-ok, warn=state-warn, danger=state-danger.
 *   - **Background hardcoded `var(--brand-gradient)`** en avatar — sin
 *     consumir `disp.gradient` del helper canonical (diferencia con
 *     `_hgpTablaDensaAlumnos` que SÍ lo consume). Deuda menor: alinear.
 *   - Click event NO inline; se wirea via `_hgpWireListClicks` (delegado).
 *   - Función PURA.
 */
function _hgpRowAlumno(r, severity) {
    const a = r.alumno || {};
    const inicialesFallback = (a.nombre || a.id || "?")
        .trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
    const fotoTexto = (typeof getAvatarDisplay === 'function' && a.id)
        ? getAvatarDisplay(a.id).fotoTexto
        : inicialesFallback;
    const colorVar = severity === "danger" ? "var(--state-danger)"
                   : severity === "warn" ? "var(--state-warn)"
                   : "var(--state-ok)";
    return `
        <div class="x-list-row" data-alumno="${_hgpEsc(a.id)}" tabindex="0" role="button" style="cursor:pointer">
            <div style="width:28px;height:28px;border-radius:50%;background:var(--brand-gradient);display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:600">
                ${_hgpEsc(fotoTexto)}
            </div>
            <div style="flex:1;font-size:13px;color:var(--text-primary)">${_hgpEsc(a.nombre || a.id)}</div>
            <div style="font-size:14px;font-weight:600;font-family:var(--font-mono);color:${colorVar}">${r.promedio.toFixed(1)}</div>
        </div>
    `;
}

/**
 * @interaction hgp-wire-list-clicks
 * @scope profesor-hub-grupo-wire-events
 *
 * Given el container `target` (panel del tab Mi grupo) con elementos
 *   `[data-alumno]` (rows de tabla densa + Top/Bottom).
 * When `hubGrupoProfRenderMiGrupo` termina el render del body.
 * Then por cada elemento `[data-alumno]`:
 *   1. Click listener → `openModalPerfilPublico(uid, "modal", "grupo")`
 *      si helper canonical disponible.
 *   2. Keydown listener → Enter / Space → triggea click (a11y).
 * Edge:
 *   - target sin elementos `[data-alumno]` → no-op.
 *   - `openModalPerfilPublico` ausente → click silent (no error).
 *   - **3er arg "grupo"** = contexto que el modal usa para mostrar la
 *     sección "Contribución al grupo" del alumno. Slice D simetría con
 *     espejo alumno (B/C).
 *   - **Re-wire cada render**: los listeners no se removen porque cada
 *     render reemplaza el HTML completo (los elementos viejos quedan
 *     huérfanos y se garbage-collect). Aceptable.
 *   - Deuda post-Supabase: delegar al body root para single listener
 *     (perf marginal en volumen alto).
 *   - Helper LOCAL.
 */
function _hgpWireListClicks(target) {
    target.querySelectorAll("[data-alumno]").forEach(el => {
        el.addEventListener("click", () => {
            const uid = el.dataset.alumno;
            if (uid && typeof openModalPerfilPublico === "function") {
                // Slice D · simetría con alumno (B/C): contexto 'grupo' para que
                // el modal muestre la sección "Contribución al grupo" del alumno
                openModalPerfilPublico(uid, "modal", "grupo");
            }
        });
        el.addEventListener("keydown", e => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                el.click();
            }
        });
    });
}

/**
 * @interaction hgp-esc
 * @scope profesor-hub-grupo-helper-esc
 *
 * Given un valor cualquiera `s`.
 * When el render compone HTML con `nombre`, `grupoId`, `matLabel`, etc.
 * Then String coerce + 4-char escape (no `'` — convención cementada cross-rol
 *   except asistencia.js).
 * Edge:
 *   - null/undefined → "" (no "null" literal).
 *   - Number / Date → String() coerce defensivo.
 *   - **Deuda consolidación**: 4to `_*Esc` cross-archivo (`_profEsc` +
 *     `_apEsc` + `_hubInicioEsc` + este). Mismo cuerpo de bytes excepto
 *     `_apEsc` que escapa `'`. Migración a `_escapeHtml` canonical
 *     pendiente (slice XSS pre-Supabase).
 *   - Helper LOCAL.
 *   - Función PURA.
 */
function _hgpEsc(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
