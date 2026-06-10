// ═══════════════════════════════════════════════════════════
// BUILDERS — Estudiante: Materias
// ═══════════════════════════════════════════════════════════

// MATERIAS_DATA se rehidrata desde getMateriasAlumno(APP.user.id) en cada build
let MATERIAS_DATA = [];

const MATERIAS_COLORS = [
    "var(--xahni-cyan)","var(--xahni-teal)","var(--xahni-amber)",
    "var(--xahni-green)","var(--xahni-purple)",
];

/**
 * @interaction refresh-materias-data
 * @scope estudiante-materias-data-sync
 *
 * Given APP.user activo.
 * When `buildMaterias` (sin data arg) o `_refreshAprendizajeData` necesitan
 *   re-hidratar el cache local `MATERIAS_DATA`.
 * Then:
 *   1. Guard `getMateriasAlumno` ausente o APP.user.id falsy → no-op.
 *   2. `MATERIAS_DATA = getMateriasAlumno(APP.user.id)` (overwrite total).
 * Edge:
 *   - **Cache REASIGN total** cada call — caller responsable de invalidar
 *     refs externos al array. Aceptable: solo `buildMaterias` consume.
 *   - **Sin filtros aplicados** aquí — `filtrarMaterias` hace su propio filter.
 *   - Función IMPURA (muta module-scope).
 *   - Helper LOCAL.
 */
function _refreshMateriasData() {
    if (typeof getMateriasAlumno === "function" && APP?.user?.id) {
        MATERIAS_DATA = getMateriasAlumno(APP.user.id);
    }
}

/**
 * @interaction refresh-aprendizaje-data
 * @scope estudiante-materias-orchestrator-sync
 *
 * Given el alumno logueado.
 * When `buildMaterias` (sin data) o callers cross-módulo necesitan sync
 *   completa de TODOS los arrays globales del aprendizaje.
 * Then orquesta 6 refresh helpers cross-archivo:
 *   1. `_refreshMateriasData` (local).
 *   2. `_refreshTareasData` (hub-aprendizaje.js).
 *   3. `_refreshRecursosAlumnoData` (hub-aprendizaje.js).
 *   4. `_refreshCalAlumnoData` (calificaciones.js).
 *   5. `_refreshHistorialData` (calificaciones.js).
 *   6. `_refreshGruposData` (grupos.js).
 * Edge:
 *   - **Defensive typeof** por cada helper — parse order tolerante.
 *   - Orden fijo (materias primero por dependencia downstream).
 *   - **Costoso pero idempotente**: cada refresh re-asigna su array sin
 *     side-effects.
 *   - Función IMPURA (orchestrator).
 *   - Helper LOCAL.
 *   - Deuda post-Supabase: subscription unificada reemplaza la cadena de
 *     refreshes manual.
 */
function _refreshAprendizajeData() {
    _refreshMateriasData();
    if (typeof _refreshTareasData         === "function") _refreshTareasData();
    if (typeof _refreshRecursosAlumnoData === "function") _refreshRecursosAlumnoData();
    if (typeof _refreshCalAlumnoData      === "function") _refreshCalAlumnoData();
    if (typeof _refreshHistorialData      === "function") _refreshHistorialData();
    if (typeof _refreshGruposData         === "function") _refreshGruposData();
}

/**
 * @interaction filtrar-materias-legacy
 * @scope estudiante-materias-handler-search-legacy
 *
 * Given query string (puede ser vacía).
 * When LEGACY caller (input search ya removido del DOM canonical).
 * Then:
 *   1. Trim + lowercase.
 *   2. Refresh data.
 *   3. Filter por `nombre.includes(q)` si query, else subset completo.
 *   4. Re-build materias con subset.
 *   5. `hubRebindMateriaCards()` si existe — re-wire onclick handlers.
 * Edge:
 *   - **CONSERVADO por compatibilidad**: barra search removida al homogeneizar
 *     la vista. Caller podría ser test legacy o dev console. Deuda menor:
 *     remover en cleanup.
 *   - **Exportado en window** implícito (consumer cross-archivo posible).
 *   - Función IMPURA (DOM via buildMaterias).
 *   - Helper LOCAL.
 */
function filtrarMaterias(query) {
    const q = (query || "").trim().toLowerCase();
    _refreshMateriasData();
    const subset = q
        ? MATERIAS_DATA.filter(m => (m.nombre || "").toLowerCase().includes(q))
        : MATERIAS_DATA;
    buildMaterias(subset);
    if (typeof hubRebindMateriaCards === "function") hubRebindMateriaCards();
}

/**
 * @interaction build-materias
 * @scope estudiante-materias-builder-canonical
 *
 * Given data opcional (subset filtrado) o null/undefined para usar
 *   `MATERIAS_DATA` completo + DOM con `#materias-grid` y opcional
 *   `#materias-resumen-bar`.
 * When `hubRenderTabMaterias` (hub-aprendizaje) o `filtrarMaterias` invocan.
 * Then orquesta render principal:
 *   1. **Sin data arg** → orchestrator refresh completo via
 *      `_refreshAprendizajeData` (sync cross-módulo).
 *   2. src = data || MATERIAS_DATA.
 *   3. **Resumen bar** (SOLO sin data filter, render full):
 *      - chip "✓ N aprobadas" (promedio ≥ 7).
 *      - chip "⚠ N en riesgo" (promedio < 7) — danger si > 0.
 *      - promedio general (sum/count).
 *      - créditos totales (sum).
 *   4. Empty state si src vacío.
 *   5. Por materia: `.x-materia-card b1-ma-card` con composición canonical:
 *      - banner + emblem por disciplina + maestría score + nombre + meta +
 *        schedule + tokens + cosmetics.
 *      - data-rol="alumno" data-gamer="on" + data-disciplina.
 *      - onclick `hubAbrirMateria(dataset.materia)` via attribute lookup.
 * Edge:
 *   - **Twin de `_buildMatCardProf`** (profesor mismaterias) — misma
 *     composición canonical, cambia data-rol y onclick.
 *   - **Resumen bar SOLO en render full** (no en filtered). UX consciente:
 *     stats deben reflejar dataset completo, no filtered subset.
 *   - **6 helpers shared canonical** consumidos: `_getDisciplinaId`,
 *     `_getMaestriaDe`, `_renderMaestriaBanner/Emblem/Score/Name/Meta`,
 *     `_materiaScheduleHTML`, `_renderMaestriaTokens/Cosmetics`.
 *   - `_htmlAttr` canonical para data-materia (escape attribute).
 *   - **CSS comentario inline** explicita decisión C8b §3.1: periodo
 *     removido de la card; ahora vive en tab "Mi grupo".
 *   - Función IMPURA (DOM masivo).
 *   - Helper LOCAL (no window export; consumer via `hubRenderTabMaterias`).
 */
function buildMaterias(data) {
    if (!data) _refreshAprendizajeData();
    const src = data || MATERIAS_DATA;

    const resumenEl = document.getElementById("materias-resumen-bar");
    if (resumenEl && !data) {
        const aprobadas = MATERIAS_DATA.filter(m => m.promedio >= 7).length;
        const riesgo    = MATERIAS_DATA.filter(m => m.promedio < 7).length;
        const credTot   = MATERIAS_DATA.reduce((s, m) => s + m.creditos, 0);
        const promGen   = (MATERIAS_DATA.reduce((s, m) => s + m.promedio, 0) / MATERIAS_DATA.length).toFixed(2);
        resumenEl.innerHTML = `
            <div class="mat-resumen-item"><span class="x-chip x-chip--ok">✓ ${aprobadas} aprobadas</span></div>
            <div class="mat-resumen-item"><span class="x-chip x-chip--${riesgo > 0 ? "danger" : "ok"}">⚠ ${riesgo} en riesgo</span></div>
            <div class="mat-resumen-item" style="font-size:12px;color:var(--text-muted)">
                Promedio general: <strong style="color:var(--text-primary)">${promGen}</strong>
            </div>
            <div class="mat-resumen-item" style="font-size:12px;color:var(--text-muted)">
                Créditos: <strong style="color:var(--text-primary)">${credTot}</strong>
            </div>`;
    }

    const grid = document.getElementById("materias-grid");
    if (!grid) return;

    if (!src.length) {
        grid.innerHTML = `
          <div class="x-empty" style="grid-column:1/-1">
            <div class="x-empty__icon">📚</div>
            <div class="x-empty__title">Aún no tienes materias en este periodo</div>
            <div class="x-empty__desc">Cuando el administrador te inscriba a tus materias, aparecerán aquí.</div>
          </div>`;
        return;
    }

    grid.innerHTML = src.map(m => {
        const uid = (typeof APP !== "undefined" && APP.user) ? APP.user.id : null;
        const disciplinaId = _getDisciplinaId(m.id);
        const mastery = _getMaestriaDe(uid, m.id);
        const codigoCorto = (m.clave || m.id || "").toUpperCase();
        const profTxt = m.prof || "";
        return `
        <article class="x-materia-card b1-ma-card"
                 data-rol="alumno" data-gamer="on" data-disciplina="${disciplinaId}"
                 data-materia="${_htmlAttr(m.nombre)}"
                 onclick="hubAbrirMateria(this.dataset.materia)"
                 aria-label="Tarjeta de maestría — ${m.nombre} · Nivel ${mastery.nivel}">
          ${_renderMaestriaBanner(disciplinaId, codigoCorto, profTxt)}
          ${_renderMaestriaEmblem(disciplinaId, m.emblema, mastery.nivel, m.nombre)}
          <div class="b1-ma-body">
            ${_renderMaestriaScore(mastery)}
            <hr class="b1-ma-divider" aria-hidden="true">
            ${_renderMaestriaName(m)}
            ${_renderMaestriaMeta(m, "alumno", mastery)}
            ${_materiaScheduleHTML(m)}
            ${_renderMaestriaTokens(mastery)}
            ${_renderMaestriaCosmetics(mastery)}
          </div>
        </article>`;
    }).join("");
}

// La sección "Horario" de .x-materia-card se genera con el helper compartido
// _materiaScheduleHTML (definido en js/core/builders-core.js, cargado antes
// que este módulo). La sección "Parcial — avance" (mini-periodo) se eliminó
// de la card del estudiante en C8b §3.1 — el periodo ahora vive a nivel de
// grupo, dentro del tab "Mi grupo" del hub-grupo.
