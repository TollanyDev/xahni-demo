// ═══════════════════════════════════════════════════════════
// BUILDERS — Estudiante: Calificaciones (twin de gestion.js profesor)
// ═══════════════════════════════════════════════════════════
// Vista C7 (rework Bucket A): muestra la escala de evaluación definida
// por el profesor + el progreso del alumno por criterio. Read-only.
// Twin lógico: js/profesor/gestion.js (mismo modelo de datos, sin edición).
//
// C8b · Pivote hub-materia: la materia activa ya no se elige aquí. El
// usuario abre una card desde el hub y `hubMateriaActiva` (definida en
// hub-aprendizaje.js) queda apuntando a la materia. Este módulo solo
// renderiza para esa materia. El picker de materias (mat tabs/scroll y
// cards gamer-on) fue eliminado del markup en B1; aquí limpiamos los
// builders y handlers asociados. El parcial sí se elige localmente
// (cada modo gamer recuerda su propio parcial).
//
// Datos consumidos (todos cargados vía data-service.js):
//   • getMateriasAlumno(uid) → materias del alumno (para bootstrap inicial)
//   • DEMO_ESCALAS           → criterios por {materiaId, grupoId, parcialNum}
//   • DEMO_PROGRESO_ESCALA   → ratios 0..1 por criterio (valorAuto / overrideProf)
// ═══════════════════════════════════════════════════════════

let _calSelectedParcial = 1;
let _calMaterias        = [];
let _calUserId          = null;

// Selección de parcial independiente del modo gamer-on (no se sincroniza con
// la off — cada modo recuerda su propio parcial activo).
let _calGamerSelectedParcial = 1;

const _CAL_NUM_PARCIALES = 3;

// Slice asistencia 2026-05-24: sub-tab activo del tab Calificaciones
// (gamer-off). Valores: "escala" (default) | "asistencia".
let _calSubTabActivo = "escala";

// ── Helper: materia activa del hub ───────────────────────────────────────────
// El picker fue retirado (C8b). Toda referencia a "materia seleccionada"
// se resuelve contra `hubMateriaActiva` (global de hub-aprendizaje.js).

/**
 * @interaction cal-get-selected-mat
 * @scope estudiante-calificaciones-helper-mat
 *
 * Given `window.hubMateriaActiva` global (set por `hubAbrirMateria` en
 *   hub-aprendizaje.js).
 * When cualquier builder/handler necesita la materia actualmente abierta.
 * Then 2 helpers complementarios:
 *   - `_calGetSelectedMat()` retorna el objeto materia o null.
 *   - `_calGetSelectedMatId()` wrapper retorna solo el id.
 * Edge:
 *   - `hubMateriaActiva` undefined parse-early → null defensive.
 *   - **Post C8b**: picker de materias eliminado; materia activa fluye
 *     desde el hub via `hubAbrirMateria`. Asimetría con sesiones previas
 *     que tenían tabs internos.
 *   - Funciones PURAS.
 *   - Helpers LOCALES.
 */
function _calGetSelectedMat() {
    return (typeof hubMateriaActiva !== "undefined") ? hubMateriaActiva : null;
}

function _calGetSelectedMatId() {
    const m = _calGetSelectedMat();
    return m ? (m.id || null) : null;
}

// ── Entry point (legacy view) ────────────────────────────────────────────────
// La vista standalone `view-calificaciones-alumno` fue eliminada en C8b-B3.
// Por compatibilidad transitoria (builders-core.js / navigation.js aún la
// invocan), esta función solo hace bootstrap de `_calMaterias` y delega el
// render real al entrypoint del hub (`hubMateriaRenderCalificaciones`).
/**
 * @interaction build-calificaciones-alumno
 * @scope estudiante-calificaciones-entrypoint-legacy
 *
 * Given APP.user activo tipo "estudiante".
 * When caller LEGACY invoca (builders-core.js / navigation.js compatibility).
 * Then:
 *   1. Bootstrap idempotente por uid: hidrata `_calMaterias` desde
 *      `getMateriasAlumno(uid)` + reset parciales a 1.
 *   2. Delega render real a `window.hubMateriaRenderCalificaciones()` si
 *      existe (path canonical post-C8b-B3).
 * Edge:
 *   - **Path LEGACY**: vista standalone `view-calificaciones-alumno`
 *     eliminada en C8b-B3. Esta fn sobrevive para compatibility con
 *     callers cementados.
 *   - **Wrapper sobre hub-materia render**: no hace render propio.
 *     Decisión histórica: evita duplicar la lógica entre standalone y hub.
 *   - Función IMPURA (state + delegate).
 */
function buildCalificacionesAlumno() {
    if (!APP.user || APP.user.tipo !== "estudiante") return;
    if (_calUserId !== APP.user.id) {
        _calUserId   = APP.user.id;
        _calMaterias = (typeof getMateriasAlumno === "function")
            ? getMateriasAlumno(APP.user.id)
            : [];
        _calSelectedParcial      = 1;
        _calGamerSelectedParcial = 1;
    }
    // Si el hub ya tiene una materia abierta, renderiza; si no, no-op.
    if (typeof window.hubMateriaRenderCalificaciones === "function") {
        window.hubMateriaRenderCalificaciones();
    }
}

// ── Helpers de datos ─────────────────────────────────────────────────────────

/**
 * @interaction cal-mat-grupo
 * @scope estudiante-calificaciones-helper-lookup-grupo
 *
 * Given matId del materia activa.
 * When builders necesitan resolver el grupo del alumno en esa materia
 *   (para escalaId compuesto + asistencia + cerrar-parcial check).
 * Then:
 *   1. Guard matId o APP.user.id falsy → null.
 *   2. Lookup user en DEMO_USERS por id.
 *   3. Lookup matRaw en DEMO_MATERIAS por id.
 *   4. **Cruce intersection**: primer grupo del usuario que TAMBIÉN esté
 *      en grupos de la materia.
 * Edge:
 *   - **`getMateriasAlumno` NO expone grupos[]** — pattern decisión:
 *     se deriva con DEMO_USERS + DEMO_MATERIAS. Aceptable DEMO.
 *   - Sin intersección → null (alumno no tiene grupo en esa materia,
 *     edge case raro).
 *   - Función PURA respecto a inputs.
 *   - Helper LOCAL.
 *   - **Twin asimetría con profesor `getMateriasProfGrupo`** (data-provider
 *     profesor): profesor SÍ tiene grupos[] en shape canonical; alumno NO,
 *     deriva.
 */
function _calMatGrupo(matId) {
    // `getMateriasAlumno` no expone `grupos[]` en su shape, así que derivamos
    // del cruce: grupos del usuario ∩ grupos donde la materia se imparte.
    if (!matId || !APP?.user?.id) return null;
    const user = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : [])
        .find((u) => u.id === APP.user.id);
    const userGrupos = (user?.grupos) || [];
    const matRaw = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
        .find((m) => m.id === matId);
    const matGrupos = (matRaw?.grupos) || [];
    return userGrupos.find((g) => matGrupos.includes(g)) || null;
}

/**
 * @interaction cal-lookups-escala-progreso
 * @scope estudiante-calificaciones-helper-lookup
 *
 * Given matId/grupoId/parcN o uid/escalaId.
 * When builders necesitan resolver escala del parcial + progreso del alumno.
 * Then 2 lookups complementarios:
 *   - `_calEscalaFor(matId, grupoId, parcN)`: triple-key find en DEMO_ESCALAS
 *     (twin de `_findEscala` profesor). Retorna escala o null.
 *   - `_calProgresoFor(uid, escalaId)`: lookup en DEMO_PROGRESO_ESCALA por
 *     key compuesta `${uid}_${escalaId}` (twin de `_findProgreso` profesor).
 * Edge:
 *   - **Twins exactos del profesor** — mismos patterns lookup. Cementado
 *     simetría cross-rol.
 *   - DEMO_ESCALAS no array → null defensive.
 *   - DEMO_PROGRESO_ESCALA no object → `{}` fallback.
 *   - Funciones PURAS.
 *   - Helpers LOCALES.
 */
function _calEscalaFor(matId, grupoId, parcN) {
    if (!Array.isArray(DEMO_ESCALAS)) return null;
    return DEMO_ESCALAS.find(
        (e) => e.materiaId === matId && e.grupoId === grupoId && e.parcialNum === parcN,
    ) || null;
}

function _calProgresoFor(uid, escalaId) {
    const dict = (typeof DEMO_PROGRESO_ESCALA === "object" && DEMO_PROGRESO_ESCALA) || {};
    return dict[`${uid}_${escalaId}`] || null;
}

/**
 * @interaction cal-helpers-calculo
 * @scope estudiante-calificaciones-helper-calc
 *
 * Given entry progreso del criterio + crit del escala + esc/prog combos.
 * When builders pintan barra criterio / total bar / hero cal final.
 * Then 3 helpers cálculo:
 *   - `_calRatio(entry)`: **cascade priority** override > auto > 0
 *     (twin EXACTO de `_calRatio` shared en `calificaciones-calc.js`).
 *   - `_calPuntosCriterio(crit, entry)`: `Math.round(pct × ratio)` =
 *     puntos obtenidos del criterio.
 *   - `_calFinalParcial(esc, prog)`: **delegado** a
 *     `calFinalDeEscalaYProgreso` shared (DRY).
 * Edge:
 *   - **`_calRatio` y `_calPuntosCriterio` son LOCALES** (no shared) —
 *     decisión histórica para reducir deps cross-archivo. Deuda menor:
 *     consolidar a shared.
 *   - **`_calFinalParcial` SÍ delega** — pattern correcto del DRY.
 *   - Helpers PUROS.
 *   - Helpers LOCALES.
 *   - **Asimetría con profesor**: profesor MUTA (`overrideProf` write
 *     via candado); alumno solo LEE (`overrideProf` read-only).
 */
function _calRatio(entry, criterio, ctx) {
    if (entry && entry.overrideProf != null) return entry.overrideProf;
    // Vínculo auto_examenes: derivar promedio en tiempo de cálculo desde
    // localStorage (escrito por examenes-data.aplicarARubroParcial).
    if (criterio && criterio.vinculo === "auto_examenes" && ctx && ctx.uid && ctx.matId && ctx.parcial) {
        try {
            const key = "xahni:examenes:notaRubro:" + ctx.uid + ":" + ctx.matId
                      + ":P" + ctx.parcial + ":" + criterio.id;
            const raw = localStorage.getItem(key);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.promedio === "number") return parsed.promedio / 10;
            }
        } catch (e) { /* defensive */ }
        return 0;
    }
    if (!entry) return 0;
    if (entry.valorAuto != null) return entry.valorAuto;
    return 0;
}

function _calPuntosCriterio(crit, entry, ctx) {
    return Math.round((crit.pct || 0) * _calRatio(entry, crit, ctx));
}

// calFinal del parcial — delegado a js/shared/calificaciones-calc.js
function _calFinalParcial(esc, prog, ctx) {
    return calFinalDeEscalaYProgreso(esc, prog, ctx);
}

// ── Tabs parciales (gamer-off) ───────────────────────────────────────────────
// Slice asistencia 2026-05-24: removidos los tabs internos P1/P2/Final del
// tab Calificaciones. El parcial activo se controla SOLO desde el header
// del hub-materia (#alumno-mat-parcial-tabs) — fuente única de verdad.
// _calSelectedParcial se sincroniza con APP.alumnoParcialActivo[gmKey] en
// _syncCalParcialDesdeHeader() invocado por hubMateriaRenderCalificaciones.
// El listener xahni:parcialActivoCambio (en hub-aprendizaje.js) ya invoca
// hubMateriaRenderCalificaciones cuando el header cambia → re-render limpio.

/**
 * @interaction sync-cal-parcial-desde-header
 * @scope estudiante-calificaciones-state-sync
 *
 * Given header del hub-materia con tabs de parcial activo
 *   (`APP.alumnoParcialActivo[gmKey]` set por click en tab del header).
 * When `hubMateriaRenderCalificaciones` invoca antes de re-render, o
 *   listener `xahni:parcialActivoCambio` dispara.
 * Then:
 *   1. Guard `_alumnoParcialActivoActual` ausente → no-op.
 *   2. Resuelve parcial actual via helper shared.
 *   3. Si valid integer ≥ 1: sync `_calSelectedParcial` Y `_calGamerSelectedParcial`.
 * Edge:
 *   - **Single source of truth** del parcial: header del hub-materia.
 *     Slice asistencia 2026-05-24 eliminó tabs internos del módulo.
 *   - **Sync DUAL** (gamer-off `_calSelectedParcial` + gamer-on
 *     `_calGamerSelectedParcial`): post-slice ambos modos comparten
 *     fuente única. Diferencia con sesiones previas donde cada modo
 *     tenía estado propio.
 *   - Helper LOCAL.
 *   - Función IMPURA (muta state).
 */
function _syncCalParcialDesdeHeader() {
    if (typeof _alumnoParcialActivoActual !== "function") return;
    const p = _alumnoParcialActivoActual();
    if (Number.isInteger(p) && p >= 1) {
        _calSelectedParcial      = p;
        _calGamerSelectedParcial = p;  // sync gamer-on (no tiene tabs propios post-slice)
    }
}

// ── Card de resumen del parcial ──────────────────────────────────────────────

/**
 * @interaction build-resumen-card
 * @scope estudiante-calificaciones-render-resumen
 *
 * Given DOM con `#cal-resumen-wrap` + hubMateriaActiva + parcial sync.
 * When `hubMateriaRenderCalificaciones` orquesta.
 * Then:
 *   1. Resuelve mat + grupo + escala + progreso.
 *   2. Sin escala → empty state "Profesor aún no define escala".
 *   3. Cal final + color semáforo (≥8 ok, ≥7 warn, else danger, muted null).
 *   4. **Barra split base+extra**: calcula `baseTotal` + `extraTotal` con
 *      `Math.min(100, ...)` y `Math.min(20, ...)` caps.
 *   5. Chip terminal "🔒 Parcial cerrado · resultado definitivo" si
 *      `isParcialCerrado`.
 *   6. Chip "Ajustada manualmente" si `calFinalOverride` set.
 *   7. innerHTML con card resumen + número grande + barra + footer.
 * Edge:
 *   - **Twin del profesor `_renderEvalMatrix` header** pero alumno
 *     read-only: muestra mismo data sin acciones.
 *   - **basePct cap 100% / extraPct cap 20%** — convenciones cementadas
 *     (twin de profesor escala system).
 *   - Sin progreso aún → footer "Aún sin calificaciones registradas".
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM).
 */
function _buildResumenCard() {
    const el = document.getElementById("cal-resumen-wrap");
    if (!el) return;

    const mat = _calGetSelectedMat();
    if (!mat) { el.innerHTML = ""; return; }

    const matId = mat.id;
    const grupo = _calMatGrupo(matId);
    const parcN = _calSelectedParcial;
    const esc   = _calEscalaFor(matId, grupo, parcN);
    const prog  = esc ? _calProgresoFor(APP.user.id, esc.id) : null;

    if (!esc) {
        el.innerHTML = `<div class="x-empty x-empty--inline" style="margin-bottom:16px">
            <div class="x-empty__title">El profesor aún no define la escala de este parcial</div>
            <div class="x-empty__desc">Cuando se publique, verás aquí los criterios y tu progreso.</div>
        </div>`;
        return;
    }

    const ctx       = { uid: APP.user.id, matId: matId, parcial: parcN };
    const cal       = _calFinalParcial(esc, prog, ctx);
    const calColor  = cal == null         ? "var(--text-muted)"
                    : cal >= 8            ? "var(--state-ok)"
                    : cal >= 7            ? "var(--state-warn)"
                    : "var(--state-danger)";
    const calLabel  = cal == null ? "—" : cal.toFixed(2);
    const isOverride = prog?.calFinalOverride != null;

    // Suma base y extra para barra split
    const baseTotal  = esc.criterios.filter((c) => !c.extra)
        .reduce((s, c) => s + ((c.pct || 0) * _calRatio((prog?.criterios || []).find((p) => p.criterioId === c.id), c, ctx)), 0);
    const extraTotal = esc.criterios.filter((c) =>  c.extra)
        .reduce((s, c) => s + ((c.pct || 0) * _calRatio((prog?.criterios || []).find((p) => p.criterioId === c.id), c, ctx)), 0);
    // Porcentaje sobre 100 (base) — extra se suma encima
    const basePct  = Math.min(100, Math.round(baseTotal));
    const extraPct = Math.min(20,  Math.round(extraTotal));

    const grupoLabel = grupo ? ` · ${grupo}` : "";

    // Slice cerrar-parcial-integracion 2026-05-24: chip terminal si el
    // parcial está cerrado. La calificación es definitiva — aunque el
    // candado individual permite excepciones, desde la vista del alumno
    // se comunica como estado terminal.
    const cerrado = typeof isParcialCerrado === "function" && isParcialCerrado(matId, grupo, parcN);
    const cerradoChip = cerrado
        ? `<span class="x-chip x-chip--info" style="font-size:11px;margin-left:8px" title="El profesor cerró este parcial"><svg class="x-icon x-icon--sm"><use href="#x-icon-lock"></use></svg> Parcial cerrado · resultado definitivo</span>`
        : "";

    el.innerHTML = `<div class="x-card cal-resumen" style="margin-bottom:20px">
        <div class="cal-resumen-head">
            <div>
                <div class="cal-resumen-title">${mat.nombre}<span class="cal-resumen-grupo">${grupoLabel} · Parcial ${parcN}</span>${cerradoChip}</div>
                ${isOverride ? `<div class="cal-resumen-override">Calificación ajustada manualmente por el profesor</div>` : ""}
            </div>
            <div class="cal-resumen-num" style="color:${calColor}">
                ${calLabel}<span class="cal-resumen-num-max"> / 10</span>
            </div>
        </div>
        <div class="x-progress x-progress--split" style="grid-template-columns:${basePct}fr ${extraPct}fr ${Math.max(0, 100 - basePct)}fr;height:8px;margin-top:12px">
            <div class="x-progress__fill--base"></div>
            <div class="x-progress__fill--extra"></div>
            <div></div>
        </div>
        <div class="cal-resumen-foot">
            <span>${basePct}% base${extraPct > 0 ? ` + ${extraPct}% extra` : ""}</span>
            ${!prog ? `<span style="color:var(--text-muted)">Aún sin calificaciones registradas</span>` : ""}
        </div>
    </div>`;
}

// ── Lista de criterios ───────────────────────────────────────────────────────

/**
 * @interaction build-criterios-lista
 * @scope estudiante-calificaciones-render-criterios
 *
 * Given DOM con `#cal-criterios-wrap` + hubMateriaActiva + parcial sync.
 * When `hubMateriaRenderCalificaciones` orquesta (gamer-off).
 * Then:
 *   1. Resuelve mat + grupo + escala + progreso.
 *   2. Sin escala/criterios → empty state.
 *   3. Por criterio: `.cal-criterio-row` con:
 *      - dot color (lazy-init `colorIdx` via `_escalaColorVar` shared).
 *      - nombre + chip "Extra" si extra + ✎ ovr si overrideProf.
 *      - barra progreso `.x-progress` con clase semáforo
 *        (`x-progress__fill--ok/warn/danger`) por umbral ratio.
 *      - puntos `obtenido/pct` mono coloreado + pct%.
 * Edge:
 *   - **Umbrales ratio**: ≥0.85 ok / ≥0.70 warn / else danger (diferentes
 *     de cal final 8/7 — aquí son fracción 0-1).
 *   - **`_escalaColorVar` cross-archivo** (builders-core) — chain dep
 *     con defensive typeof.
 *   - **Twin del profesor `_renderCriterioRow`** pero alumno read-only
 *     (sin inputs editables).
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM).
 */
function _buildCriteriosLista() {
    const el = document.getElementById("cal-criterios-wrap");
    if (!el) return;

    const mat = _calGetSelectedMat();
    if (!mat) { el.innerHTML = ""; return; }

    const matId = mat.id;
    const grupo = _calMatGrupo(matId);
    const esc   = _calEscalaFor(matId, grupo, _calSelectedParcial);
    if (!esc) { el.innerHTML = ""; return; }
    const prog  = _calProgresoFor(APP.user.id, esc.id);

    if (!esc.criterios.length) {
        el.innerHTML = `<div class="x-empty x-empty--inline">
            <div class="x-empty__title">Escala sin criterios</div>
        </div>`;
        return;
    }

    const ctxCrit = { uid: APP.user.id, matId: matId, parcial: _calSelectedParcial };
    const rows = esc.criterios.map((c, i) => {
        const entry  = (prog?.criterios || []).find((p) => p.criterioId === c.id);
        const ratio  = _calRatio(entry, c, ctxCrit);
        const pct    = Math.round(ratio * 100);
        const obtenido = _calPuntosCriterio(c, entry, ctxCrit);
        const isAutoExam = c.vinculo === "auto_examenes";
        const hasData  = isAutoExam ? ratio > 0 : (!!entry && (entry.valorAuto != null || entry.overrideProf != null));
        const isOvr    = !!entry && entry.overrideProf != null;
        const color    = (typeof _escalaColorVar === "function") ? _escalaColorVar(Number.isInteger(c.colorIdx) ? c.colorIdx : i) : "var(--xahni-blue-light)";

        const barFillCls = !hasData      ? ""
                         : ratio >= 0.85 ? " x-progress__fill--ok"
                         : ratio >= 0.70 ? " x-progress__fill--warn"
                         : " x-progress__fill--danger";

        return `<div class="cal-criterio-row">
            <div class="cal-criterio-dot" style="background:${color}"></div>
            <div class="cal-criterio-info">
                <div class="cal-criterio-nombre">
                    ${c.nombre}
                    ${c.extra ? `<span class="escala-extra-chip">Extra</span>` : ""}
                    ${isOvr  ? `<span class="cal-criterio-ovr" title="Ajustado por tu profesor">✎</span>` : ""}
                </div>
                <div class="x-progress cal-criterio-bar">
                    <div class="x-progress__fill${barFillCls}" style="width:${pct}%"></div>
                </div>
            </div>
            <div class="cal-criterio-num">
                <div class="cal-criterio-puntos" style="color:${color}">${obtenido}<span class="cal-criterio-puntos-max">/${c.pct}</span></div>
                <div class="cal-criterio-pct">${hasData ? pct + "%" : "—"}</div>
            </div>
        </div>`;
    }).join("");

    el.innerHTML = `<div class="x-card cal-criterios-card">
        <div class="cal-criterios-head">Criterios de evaluación</div>
        <div class="cal-criterios-lista">${rows}</div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// GAMER MODE = ON — adaptación de "Escala de evaluación" del profesor con
// KPI calFinal del alumno hero. Las cards de materia se eliminaron en C8b
// (el hub ya filtró la materia); aquí solo queda el contenido por parcial.
// Reusa helpers de datos (_calMatGrupo/_calEscalaFor/_calProgresoFor/_calRatio
// /_calFinalParcial) y componentes visuales del profesor (.escala-* /
// .x-hero-card / _escalaBarHTML con opts.progreso).
// ═══════════════════════════════════════════════════════════════════════════

// ── Helpers gamer ────────────────────────────────────────────────────────────

/**
 * @interaction cal-gamer-cal-cls
 * @scope estudiante-calificaciones-helper-gamer-cls
 *
 * Given calFinal numeric o null.
 * When `_buildCalGamerHero` pinta el `.x-hero-card__figure` con clase
 *   semáforo.
 * Then 4-rama:
 *   - null → "" (sin clase, default styling).
 *   - ≥8 → " x-hero-card__figure--ok".
 *   - ≥7 → " x-hero-card__figure--warn".
 *   - else → " x-hero-card__figure--danger".
 * Edge:
 *   - **Leading space** en string return — convención cementada para
 *     concatenar a `className` sin separador.
 *   - Misma cascada 8/7 que `_buildResumenCard` (consistency cross-mode).
 *   - Función PURA.
 *   - Helper LOCAL.
 */
function _calGamerCalCls(cal) {
    if (cal == null)  return "";
    if (cal >= 8)     return " x-hero-card__figure--ok";
    if (cal >= 7)     return " x-hero-card__figure--warn";
    return " x-hero-card__figure--danger";
}

// ── Builders ─────────────────────────────────────────────────────────────────

/**
 * @interaction update-cal-gamer-view
 * @scope estudiante-calificaciones-render-gamer-orchestrator
 *
 * Given DOM con contenedor gamer-on `#cal-gamer-contenido`.
 * When `hubMateriaRenderCalificaciones` orquesta.
 * Then:
 *   1. Guard sin matId → no-op.
 *   2. Dispara `_buildCalGamerHero` + `_buildCalGamerCriterios`.
 * Edge:
 *   - **Sin placeholder post-C8b**: ausencia de materia se maneja en cada
 *     sub-builder con guards.
 *   - **Slice asistencia 2026-05-24**: `_buildCalGamerParcialTabs` eliminado;
 *     parcial activo viene del header.
 *   - Helper LOCAL.
 *   - Función IMPURA (orchestrator DOM).
 */
function _updateCalGamerView() {
    // El placeholder fue retirado en C8b — `#cal-gamer-contenido` siempre
    // renderiza. La ausencia de materia se maneja con guardas en cada builder.
    // Slice asistencia 2026-05-24: _buildCalGamerParcialTabs eliminado;
    // parcial activo viene del header del hub-materia via
    // _syncCalParcialDesdeHeader (igual que gamer-off).
    if (!_calGetSelectedMatId()) return;
    _buildCalGamerHero();
    _buildCalGamerCriterios();
}

/**
 * @interaction build-cal-gamer-hero
 * @scope estudiante-calificaciones-render-gamer-hero
 *
 * Given DOM con `#cal-gamer-hero` + hubMateriaActiva + parcial sync.
 * When `_updateCalGamerView` orquesta.
 * Then `.x-hero-card` gamer-on con:
 *   - eyebrow "📈 PARCIAL N · clave".
 *   - title nombre materia.
 *   - meta chips: grupo + semana período + override warn + parcial cerrado.
 *   - aside: label "TU CALIFICACIÓN" + figure 24px coloreado (cls semáforo) +
 *     progress split 140px (base/extra) + label pct%.
 * Edge:
 *   - **Twin del profesor escala hero pero alumno con calFinal real**
 *     (no edit). Mismo visual canonical `.x-hero-card`.
 *   - Sin escala → empty state.
 *   - basePct/extraPct caps idéntico a gamer-off (consistency).
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM).
 */
function _buildCalGamerHero() {
    const el = document.getElementById("cal-gamer-hero");
    const matId = _calGetSelectedMatId();
    if (!el || !matId) return;

    const mat   = _calGetSelectedMat();
    const grupo = _calMatGrupo(mat?.id);
    const parcN = _calGamerSelectedParcial;
    const esc   = _calEscalaFor(matId, grupo, parcN);
    const prog  = esc ? _calProgresoFor(APP.user.id, esc.id) : null;

    if (!esc) {
        el.innerHTML = `<div class="x-empty x-empty--inline" style="margin:0 0 12px">
            <div class="x-empty__title">El profesor aún no define la escala de este parcial</div>
            <div class="x-empty__desc">Cuando se publique verás aquí tu calificación.</div>
        </div>`;
        return;
    }

    const ctx      = { uid: APP.user.id, matId: matId, parcial: parcN };
    const cal      = _calFinalParcial(esc, prog, ctx);
    const calCls   = _calGamerCalCls(cal);
    const calLabel = cal == null ? "—" : cal.toFixed(2);
    const isOverride = prog?.calFinalOverride != null;

    // Suma base y extra obtenidos para barra split del hero
    const baseTotal  = esc.criterios.filter((c) => !c.extra)
        .reduce((s, c) => s + ((c.pct || 0) * _calRatio((prog?.criterios || []).find((p) => p.criterioId === c.id), c, ctx)), 0);
    const extraTotal = esc.criterios.filter((c) =>  c.extra)
        .reduce((s, c) => s + ((c.pct || 0) * _calRatio((prog?.criterios || []).find((p) => p.criterioId === c.id), c, ctx)), 0);
    const basePct  = Math.min(100, Math.round(baseTotal));
    const extraPct = Math.min(20,  Math.round(extraTotal));

    const periodoChip = mat.periodoInfo
        ? `<span class="x-chip x-chip--muted">Sem. ${mat.periodoInfo.semanaActual || "—"}/${mat.periodoInfo.totalSemanas || "—"}</span>`
        : "";

    // Slice cerrar-parcial-integracion 2026-05-24: chip terminal en gamer-on.
    const cerrado = typeof isParcialCerrado === "function" && isParcialCerrado(matId, grupo, parcN);
    const cerradoChip = cerrado
        ? `<span class="x-chip x-chip--info" title="El profesor cerró este parcial"><svg class="x-icon x-icon--sm"><use href="#x-icon-lock"></use></svg> Parcial cerrado · resultado definitivo</span>`
        : "";

    el.innerHTML = `<div class="x-hero-card" style="cursor:default" onclick="return false">
        <div class="x-hero-card__main">
            <div class="x-hero-card__eyebrow">📈 PARCIAL ${parcN} · ${mat.clave || ""}</div>
            <div class="x-hero-card__title">${mat.nombre || mat.materia || ""}</div>
            <div class="x-hero-card__meta">
                ${grupo ? `<span class="x-chip x-chip--muted">${grupo}</span>` : ""}
                ${periodoChip}
                ${isOverride ? `<span class="x-chip x-chip--warn" title="Calificación ajustada manualmente por tu profesor">Ajustado por profesor</span>` : ""}
                ${cerradoChip}
            </div>
        </div>
        <div class="x-hero-card__aside">
            <div class="x-hero-card__figure-label">TU CALIFICACIÓN</div>
            <div class="x-hero-card__figure${calCls}">${calLabel}</div>
            <div class="x-hero-card__progress">
                <div class="x-progress x-progress--split" style="grid-template-columns:${basePct}fr ${extraPct}fr ${Math.max(0, 100 - basePct)}fr;width:140px;height:7px">
                    <div class="x-progress__fill--base"></div>
                    <div class="x-progress__fill--extra"></div>
                    <div></div>
                </div>
                <span class="x-hero-card__progress-label">${basePct}%${extraPct > 0 ? ` + ${extraPct}%` : ""}</span>
            </div>
        </div>
    </div>`;
}

/**
 * @interaction build-cal-gamer-criterios
 * @scope estudiante-calificaciones-render-gamer-criterios
 *
 * Given DOM con 5 elements (card + titleEl + listEl + totalEl + barEl).
 * When `_updateCalGamerView` orquesta.
 * Then:
 *   1. Guards sin DOM o sin escala → hide card.
 *   2. Title "Criterios — Parcial N".
 *   3. Empty state si sin criterios.
 *   4. Lista `.escala-criterio-row` (twin profesor visual) con dot color +
 *      nombre + chip extra + ✎ ovr + puntos obtenidos/max coloreados.
 *   5. **Total bar**: "TOTAL OBTENIDO" + breakdown base + extra +
 *      grand total. Color por `baseObtenido >= 60` umbral.
 *   6. **Barra visual** delegada a `_escalaBarHTML` shared con
 *      `{progreso}` para mostrar fill por ratio.
 * Edge:
 *   - **Reusa visual canonical `.escala-*`** (profesor) con read-only.
 *   - **Umbral total 60% (no 70% / 80%)** — convención DEMO para "alumno
 *     aprobado" mínimo. Asimetría con umbrales individuales criterio
 *     (85/70).
 *   - **`_escalaBarHTML` con opts.progreso** — pattern compartido alumno+profesor.
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM masivo).
 */
function _buildCalGamerCriterios() {
    const matId = _calGetSelectedMatId();
    if (!matId) return;
    const grupo = _calMatGrupo(matId);
    const esc   = _calEscalaFor(matId, grupo, _calGamerSelectedParcial);
    const prog  = esc ? _calProgresoFor(APP.user.id, esc.id) : null;
    const ctx   = { uid: APP.user.id, matId: matId, parcial: _calGamerSelectedParcial };

    const card    = document.getElementById("cal-gamer-criterios-card");
    const titleEl = document.getElementById("cal-gamer-criterios-title");
    const listEl  = document.getElementById("cal-gamer-criterios-lista");
    const totalEl = document.getElementById("cal-gamer-total-bar");
    const barEl   = document.getElementById("cal-gamer-barra-visual");
    if (!card || !titleEl || !listEl || !totalEl || !barEl) return;

    if (!esc) {
        card.style.display = "none";
        return;
    }
    card.style.display = "";
    titleEl.textContent = `Criterios — Parcial ${_calGamerSelectedParcial}`;

    if (!esc.criterios.length) {
        listEl.innerHTML = `<div class="x-empty x-empty--inline">
            <div class="x-empty__title">Escala sin criterios</div>
        </div>`;
        totalEl.innerHTML = "";
        barEl.innerHTML = "";
        return;
    }

    // Lista de criterios estilo .escala-criterio-row
    listEl.innerHTML = esc.criterios.map((c, i) => {
        const entry  = (prog?.criterios || []).find((p) => p.criterioId === c.id);
        const ratio  = _calRatio(entry, c, ctx);
        const pct    = Math.round(ratio * 100);
        const obtenido = _calPuntosCriterio(c, entry, ctx);
        const isAutoExam = c.vinculo === "auto_examenes";
        const hasData  = isAutoExam ? ratio > 0 : (!!entry && (entry.valorAuto != null || entry.overrideProf != null));
        const isOvr    = !!entry && entry.overrideProf != null;
        const color    = (typeof _escalaColorVar === "function") ? _escalaColorVar(Number.isInteger(c.colorIdx) ? c.colorIdx : i) : "var(--xahni-blue-light)";

        return `<div class="escala-criterio-row">
            <div class="escala-criterio-dot" style="background:${color}"></div>
            <div class="escala-criterio-info">
                <div class="escala-criterio-nombre">
                    ${c.nombre}
                    ${c.extra ? `<span class="escala-extra-chip">Extra</span>` : ""}
                    ${isOvr  ? `<span style="color:var(--state-warn);font-size:12px;margin-left:6px" title="Ajustado por tu profesor">✎</span>` : ""}
                </div>
            </div>
            <div class="escala-criterio-pct" style="color:${color}">${hasData ? obtenido : "—"}<span style="font-size:13px;color:var(--text-muted);font-weight:500">/${c.pct}</span></div>
        </div>`;
    }).join("");

    // Total base + extra obtenido (vs profesor que muestra definido)
    const baseObtenido  = Math.round(esc.criterios.filter((c) => !c.extra)
        .reduce((s, c) => s + ((c.pct || 0) * _calRatio((prog?.criterios || []).find((p) => p.criterioId === c.id), c, ctx)), 0));
    const extraObtenido = Math.round(esc.criterios.filter((c) =>  c.extra)
        .reduce((s, c) => s + ((c.pct || 0) * _calRatio((prog?.criterios || []).find((p) => p.criterioId === c.id), c, ctx)), 0));
    const calColor = baseObtenido >= 60 ? "var(--state-ok)" : "var(--state-danger)";
    totalEl.innerHTML = `<div class="escala-total-row">
        <div class="escala-total-label">TOTAL OBTENIDO</div>
        <div class="escala-total-breakdown">
            <span style="color:${calColor}">Base ${baseObtenido}%</span>
            ${extraObtenido > 0 ? `<span style="color:var(--state-warn)">Extra +${extraObtenido}%</span>` : ""}
        </div>
        <div class="escala-total-value" style="color:${calColor}">${baseObtenido + extraObtenido}%</div>
    </div>`;

    // Barra visual overflow (reusa helper compartido con opts.progreso)
    const progreso = esc.criterios.map((c) => {
        const entry = (prog?.criterios || []).find((p) => p.criterioId === c.id);
        return { criterioId: c.id, ratio: _calRatio(entry, c, ctx) };
    });
    barEl.innerHTML = (typeof _escalaBarHTML === "function")
        ? _escalaBarHTML(esc, { progreso })
        : "";
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTRYPOINT HUB-MATERIA (C8b · B2)
// hub-aprendizaje.js → hubSwitchTab('calificaciones', ...) llama esto cada
// vez que el usuario entra al tab "Calificaciones" dentro del hub-materia.
// `hubMateriaActiva` ya está set por hubAbrirMateria().
// ═══════════════════════════════════════════════════════════════════════════

window.hubMateriaRenderCalificaciones = function () {
    if (!_calGetSelectedMat()) return;     // defensa: tab abierto sin materia
    // Bootstrap perezoso de _calMaterias (por si nunca se navegó a la vista
    // legacy y _calUserId quedó null). No bloqueante.
    if (APP?.user?.tipo === "estudiante" && _calUserId !== APP.user.id) {
        _calUserId   = APP.user.id;
        _calMaterias = (typeof getMateriasAlumno === "function")
            ? getMateriasAlumno(APP.user.id)
            : [];
    }
    // Slice asistencia 2026-05-24: parcial activo se lee del header del
    // hub-materia (fuente única). Sustituye al tab interno de parciales
    // eliminado en este slice.
    _syncCalParcialDesdeHeader();
    // Sub-tabs Escala / Mi asistencia (slice asistencia 2026-05-24, gamer-off).
    _buildCalSubTabs();
    // Renderiza ambos modos; CSS (.gamer-on-view/.gamer-off-view) decide cuál
    // se muestra según body.gamer-off.
    _buildResumenCard();         // gamer-off · card resumen
    _buildCriteriosLista();      // gamer-off · lista de criterios
    _buildAsistenciaAlumno();    // gamer-off · sub-tab asistencia (si activo)
    _updateCalGamerView();       // gamer-on  · parcial tabs + hero + criterios card
};

// ═══════════════════════════════════════════════════════════
// SLICE ASISTENCIA 2026-05-24 — sub-tab "Mi asistencia"
// Solo gamer-off. En gamer-on la integración queda como deuda
// futura (la decisión del slice es scope acotado).
// ═══════════════════════════════════════════════════════════

/**
 * @interaction build-cal-sub-tabs
 * @scope estudiante-calificaciones-render-sub-tabs
 *
 * Given DOM con `#cal-sub-tabs` + `_calSubTabActivo` state.
 * When `hubMateriaRenderCalificaciones` orquesta o `_switchCalSubTab`
 *   toggle.
 * Then:
 *   1. 2 tabs: "📊 Escala" + "✅ Mi asistencia" con `.is-active` sobre vigente.
 *   2. **Toggle visibility** de 2 contenedores (`#cal-content-escala`
 *      y `#cal-content-asistencia`).
 * Edge:
 *   - DOM target ausente → no-op.
 *   - **Slice asistencia 2026-05-24**: sub-tab introducido SOLO en
 *     gamer-off. Gamer-on no tiene sub-tabs (deuda futura).
 *   - **Display toggle simple** (no animations) — pattern legacy.
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM).
 */
function _buildCalSubTabs() {
    const el = document.getElementById("cal-sub-tabs");
    if (!el) return;
    const tabs = [
        { id: "escala",     label: "📊 Escala",        title: "Criterios + calificación del parcial" },
        { id: "asistencia", label: "✅ Mi asistencia", title: "Sesiones del parcial con tu marca" },
    ];
    el.innerHTML = `<div class="x-tabs">${
        tabs.map(t => {
            const active = _calSubTabActivo === t.id ? " is-active" : "";
            return `<button class="x-tabs__tab${active}" title="${t.title}" onclick="_switchCalSubTab('${t.id}', this)">${t.label}</button>`;
        }).join("")
    }</div>`;

    // Toggle visibilidad de los dos contenedores.
    const esc = document.getElementById("cal-content-escala");
    const asi = document.getElementById("cal-content-asistencia");
    if (esc) esc.style.display = _calSubTabActivo === "escala"     ? "" : "none";
    if (asi) asi.style.display = _calSubTabActivo === "asistencia" ? "" : "none";
}

/**
 * @interaction switch-cal-sub-tab
 * @scope estudiante (calificaciones)
 *
 * Given el alumno está en el tab Calificaciones del hub-materia con
 *   sub-tabs Escala / Mi asistencia.
 * When hace click en un sub-tab.
 * Then setea _calSubTabActivo, re-renderiza sub-tabs (active visual)
 *   y trigger del builder de la vista activa (escala o asistencia).
 */
function _switchCalSubTab(id, btn) {
    if (id !== "escala" && id !== "asistencia") return;
    _calSubTabActivo = id;
    _buildCalSubTabs();
    if (id === "asistencia") _buildAsistenciaAlumno();
}
window._switchCalSubTab = _switchCalSubTab;

/**
 * @interaction build-asistencia-alumno
 * @scope estudiante-calificaciones-render-asistencia
 *
 * Given DOM con `#cal-content-asistencia` + hubMateriaActiva + parcial sync
 *   + slice asistencia helpers (`deriveSesionesAsistencia`, `calcResumenAsistencia`,
 *   `getMarcaAlumno`).
 * When `_switchCalSubTab("asistencia")` o listener `asistenciaChanged`
 *   dispara y sub-tab activo es "asistencia".
 * Then:
 *   1. **Early return si sub-tab NO activo** — evita render en primer paint
 *      cuando default es "escala" (optimization).
 *   2. Guards mat / grupoId / helpers ausentes → empty states distintos.
 *   3. Resuelve sesiones + resumen (P/R/A counts + %) + cerrado state.
 *   4. **3 KPIs**: sesiones del parcial / asistencia % / presentes count.
 *   5. **Lista sesiones** ordenadas con fecha mono + horario + chip estado
 *      (presente ok / retardo warn / ausente danger / sin marca muted /
 *      próxima muted).
 *   6. Chip terminal "🔒 Parcial cerrado" en header card si cerrado.
 * Edge:
 *   - **Locale "es" hardcoded** (meses + días arrays). Mismo issue
 *     acumulado cross-rol.
 *   - **Listener `asistenciaChanged`** registrado window-level con guard
 *     `__calAsistListenerRegistered` para no acumular en re-login.
 *   - **Twin asimetría con profesor `_apRenderMatriz`** (asistencia.js
 *     profesor): profesor pinta matriz NxM editable; alumno pinta SU fila
 *     read-only.
 *   - Sin grupoId del alumno → empty state explicativo.
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM).
 *   - **Renderer más grande del módulo** (~120 LOC).
 */
function _buildAsistenciaAlumno() {
    const el = document.getElementById("cal-content-asistencia");
    if (!el) return;
    // Solo renderiza si el sub-tab está activo — evita trabajo en el primer
    // paint cuando default es "escala".
    if (_calSubTabActivo !== "asistencia") return;

    const mat = _calGetSelectedMat();
    if (!mat) {
        el.innerHTML = `<div class="x-empty x-empty--inline"><div class="x-empty__desc">Sin materia activa</div></div>`;
        return;
    }
    const matId  = mat.id;
    const uid    = APP?.user?.id;
    const user   = (typeof DEMO_USERS !== "undefined") ? DEMO_USERS.find(u => u.id === uid) : null;
    const grupoId = (user?.grupos || [])[0];
    if (!grupoId) {
        el.innerHTML = `<div class="x-empty x-empty--inline"><div class="x-empty__desc">No estás asignado a un grupo en esta materia.</div></div>`;
        return;
    }
    const parcial = _calSelectedParcial || 1;

    if (typeof deriveSesionesAsistencia !== "function" || typeof calcResumenAsistencia !== "function") {
        el.innerHTML = `<div class="x-empty x-empty--inline"><div class="x-empty__desc">Módulo de asistencia no disponible</div></div>`;
        return;
    }

    const sesiones = deriveSesionesAsistencia(matId, grupoId, parcial);
    const resumen  = calcResumenAsistencia(matId, grupoId, parcial, uid);
    const cerrado  = typeof isParcialCerrado === "function" && isParcialCerrado(matId, grupoId, parcial);

    if (!sesiones.length) {
        el.innerHTML = `<div class="x-empty">
          <div class="x-empty__icon">📅</div>
          <div class="x-empty__title">Sin sesiones que mostrar</div>
          <div class="x-empty__desc">No hay sesiones definidas para este parcial. Consulta el horario de la materia.</div>
        </div>`;
        return;
    }

    const pctColor = resumen.pctPresente >= 80 ? "var(--state-ok)"
                   : resumen.pctPresente >= 60 ? "var(--state-warn)"
                   : "var(--state-danger)";

    const kpisHTML = `<div class="x-grid" style="margin-bottom:14px">
      <div class="metric-card teal">
        <div class="metric-icon teal">📅</div>
        <div class="metric-value">${sesiones.length}</div>
        <div class="metric-label">Sesiones del parcial</div>
        <div class="metric-delta neutral">${resumen.total} ya impartida${resumen.total !== 1 ? "s" : ""}</div>
      </div>
      <div class="metric-card ${resumen.pctPresente >= 80 ? "purple" : resumen.pctPresente >= 60 ? "amber" : "red"}">
        <div class="metric-icon ${resumen.pctPresente >= 80 ? "purple" : resumen.pctPresente >= 60 ? "amber" : "red"}">✅</div>
        <div class="metric-value">${resumen.pctPresente}%</div>
        <div class="metric-label">Asistencia</div>
        <div class="metric-delta neutral">retardos cuentan como medio</div>
      </div>
      <div class="metric-card blue">
        <div class="metric-icon blue">🟢</div>
        <div class="metric-value">${resumen.pres}</div>
        <div class="metric-label">Presentes</div>
        <div class="metric-delta neutral">${resumen.ret} retardo${resumen.ret !== 1 ? "s" : ""} · ${resumen.aus} ausencia${resumen.aus !== 1 ? "s" : ""}</div>
      </div>
    </div>`;

    const meta = {
        presente: { icon: "✓", label: "Presente", color: "var(--state-ok)",     bg: "var(--state-ok-dim)"     },
        retardo:  { icon: "R", label: "Retardo",  color: "var(--state-warn)",   bg: "var(--state-warn-dim)"   },
        ausente:  { icon: "⊘", label: "Ausente",  color: "var(--state-danger)", bg: "var(--state-danger-dim)" },
    };

    const fmtFecha = (iso) => {
        const d = new Date(iso + "T00:00:00");
        const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
        const dias  = ["dom","lun","mar","mié","jue","vie","sáb"];
        return `${dias[d.getDay()]} ${String(d.getDate()).padStart(2,"0")}-${meses[d.getMonth()]}`;
    };

    const listaHTML = sesiones.map(s => {
        const m = getMarcaAlumno(matId, grupoId, parcial, s.fecha, uid);
        const info = m ? meta[m] : null;
        const trail = s.isPast
            ? (info
                ? `<span class="x-chip" style="background:${info.bg};color:${info.color};border-color:${info.color}40"><span style="font-weight:700;margin-right:4px">${info.icon}</span> ${info.label}</span>`
                : `<span class="x-chip" style="opacity:.6">─ Sin marca</span>`)
            : `<span class="x-chip" style="opacity:.6">⏱ Próxima</span>`;
        return `<div class="x-list-row" style="padding:10px 14px;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">
            <div style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted);min-width:80px">${fmtFecha(s.fecha)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;color:var(--text-primary)">${s.inicio} – ${s.fin}${s.salon ? ` · ${s.salon}` : ""}</div>
            </div>
          </div>
          <div>${trail}</div>
        </div>`;
    }).join("");

    // Slice cerrar-parcial-integracion: chip terminal en el header de la
    // card de sesiones cuando el parcial está cerrado.
    const cerradoChip = cerrado
        ? `<span class="x-chip x-chip--info" style="font-size:10px;margin-left:8px" title="El profesor cerró este parcial"><svg class="x-icon x-icon--sm"><use href="#x-icon-lock"></use></svg> Parcial cerrado</span>`
        : "";

    el.innerHTML = `${kpisHTML}
      <div class="x-card" style="padding:0;overflow:hidden">
        <div style="padding:12px 14px;font-size:13px;font-weight:600;color:var(--text-primary);border-bottom:1px solid var(--border)">
          Sesiones del parcial ${parcial} · <span style="color:var(--text-muted);font-weight:400">${sesiones.length} total · ${sesiones.filter(s=>!s.isPast).length} por venir</span>${cerradoChip}
        </div>
        ${listaHTML}
      </div>
    `;
}

// Listener cross-vista: si el profesor cambió marcas mientras el alumno
// está mirando su asistencia, repintar. Registrado una sola vez.
if (typeof window !== "undefined" && !window.__calAsistListenerRegistered) {
    window.__calAsistListenerRegistered = true;
    window.addEventListener("asistenciaChanged", () => {
        if (_calSubTabActivo === "asistencia") _buildAsistenciaAlumno();
    });
}
