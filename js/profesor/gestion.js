// js/profesor/gestion.js
// Gestión académica del profesor: búsqueda de alumnos, calificaciones, alertas

let _unifiedFiltro = "todas";
// C9 · Filtro adicional por grupo activo. Aplicado cuando gestion vive
// dentro del hub-materia profesor (donde el grupo es contexto fijo).
// null = sin filtro de grupo (vista standalone legacy o "Todos").
let _gestionGrupoFiltro = null;
let _busquedaAlumno = "";
let _gestionData = { materias: [], alumnos: [], cals: [] };

// Paletas deterministas indexadas por posición — escalan a N materias/alumnos
const _GEST_MAT_PALETTE = ["teal", "amber", "blue", "purple", "green", "red"];
const _GEST_AV_PALETTE  = ["teal", "amber", "blue", "purple", "green", "red", "cyan"];
const _GEST_MAT_GRADS   = [
  "linear-gradient(135deg,#00c6a7 0%,#00c6a780 50%,#00c6a730 100%)",
  "linear-gradient(135deg,#f5a623 0%,#f5a62380 50%,#f5a62330 100%)",
  "linear-gradient(135deg,#3d6ef5 0%,#3d6ef580 50%,#3d6ef530 100%)",
  "linear-gradient(135deg,#8b2be2 0%,#8b2be280 50%,#8b2be230 100%)",
  "linear-gradient(135deg,#4caf50 0%,#4caf5080 50%,#4caf5030 100%)",
  "linear-gradient(135deg,#e53935 0%,#e5393580 50%,#e5393530 100%)",
];

// ── Data provider ─────────────────────────────────────────────────────────────
/**
 * @interaction get-prof-gestion-data
 * @scope profesor-gestion-data-provider
 *
 * Given uid del profesor.
 * When `buildGestionAcademica` init y necesita el dato base unificado para
 *   todo el módulo (cards materias + grid mini-perfiles + cals shell).
 * Then orquesta 3 funciones puras en secuencia (REFACTOR 2026-07-08 —
 *   antes esto era una sola función de ~115 líneas con las 4
 *   responsabilidades mezcladas; el detalle de cada paso vive ahora en
 *   el docstring de la función correspondiente):
 *   1. Resuelve `_profDataBase(uid)` (shared del rol) → null → empty shape.
 *   2. `_gestEnriquecerMaterias(materiasSrc)` → materias con color/grad/
 *      periodo/parcialActivoNum/escalasPorParcial.
 *   3. `_gestEnriquecerAlumnos(materias, grupos, tareasSrc, estudiantes)`
 *      → 1 entry por par estudiante×materia.
 *   4. `_gestBuildCalsShell(alumnos)` → shell legacy que consume
 *      `actualizarCal`.
 * Edge:
 *   - **_profDataBase null** → empty `{materias: [], alumnos: [], cals: []}`.
 *   - **Función PURA** respecto a inputs — igual que sus 3 piezas.
 *   - Deuda post-Supabase: vista materializada `gestion_alumnos_view` con
 *     joins + aggregates SQL-side (sin cambios por este refactor).
 */
function getProfGestionData(uid) {
  const empty = { materias: [], alumnos: [], cals: [] };
  const base = (typeof _profDataBase === "function") ? _profDataBase(uid) : null;
  if (!base) return empty;
  const { materias: materiasSrc, grupos, tareas: tareasSrc, estudiantes } = base;

  const materias = _gestEnriquecerMaterias(materiasSrc);
  const alumnos  = _gestEnriquecerAlumnos(materias, grupos, tareasSrc, estudiantes);
  const cals     = _gestBuildCalsShell(alumnos);

  return { materias, alumnos, cals };
}

/**
 * @interaction gest-enriquecer-materias
 * @scope profesor-gestion-data-provider
 *
 * Given materiasSrc del profesor (sin transformar, shape de DEMO_MATERIAS).
 * When `getProfGestionData` arma la sección "materias" del data shell
 *   (1 de las 3 piezas en las que se dividió — antes vivía inline como
 *   parte de una función de ~115 líneas, ver REFACTOR 2026-07-08 más abajo).
 * Then por cada materia:
 *   - color paleta `_GEST_MAT_PALETTE` + grad `_GEST_MAT_GRADS` (índice).
 *   - resuelve grupoPrincipal al PRIMER grupo de la materia QUE EXISTA en
 *     DEMO_GRUPOS (bug previo: usar ciegamente m.grupos[0] podía apuntar
 *     a un grupo legacy inexistente en runtime).
 *   - periodoInfo + parciales[] vía `getPeriodoDeGrupo`/`getPeriodoInfo`.
 *   - `parcialActivoNum`: prioriza `APP.profParcialActivo[gmKey]` (la
 *     misma preferencia que usan Calificaciones y el header de parcial
 *     tabs); solo cae al cálculo por fecha (`estado === "activo"`) si el
 *     profesor nunca tocó el selector para esa materia+grupo. Ver
 *     FIX 2026-07-08 — antes esto se derivaba SOLO por fecha, lo que
 *     hacía que Gestión mostrara un parcial distinto al de Calificaciones
 *     apenas la fecha de hoy cruzaba al siguiente parcial.
 *   - `escalasPorParcial` dict `{1: esc, 2: esc, 3: esc}`, lookup en
 *     DEMO_ESCALAS por `escalaId(m.id, grupoPrincipal, num)` (helper
 *     canonical en core/periodo.js).
 *   - `escalaActiva` = escala del parcial activo (alias de conveniencia).
 * Edge:
 *   - Función PURA (lookup + map; no muta globals).
 *   - Sin materias → `[]`.
 * @deprecated-note NINGUNO — pieza activa, no confundir con los métodos
 *   `@deprecated` de DataService.
 */
function _gestEnriquecerMaterias(materiasSrc) {
  return materiasSrc.map((m, i) => {
    const matGrupos = Array.isArray(m.grupos) ? m.grupos : [];
    const _GRUPOS = (typeof DEMO_GRUPOS !== "undefined" && Array.isArray(DEMO_GRUPOS)) ? DEMO_GRUPOS : [];
    const grupoPrincipalIni = matGrupos.find(g => _GRUPOS.some(x => x.id === g))
        || matGrupos[0]
        || "";
    const periodoCrudo      = (typeof getPeriodoDeGrupo === "function") ? getPeriodoDeGrupo(grupoPrincipalIni) : null;
    const periodoInfo       = (typeof getPeriodoInfo === "function") ? getPeriodoInfo(periodoCrudo) : null;
    const parciales   = (periodoInfo && periodoInfo.parciales) || [];
    const gmKey = (typeof profMatGrupoKey === "function") ? profMatGrupoKey(m.id, grupoPrincipalIni) : `${m.id}_${grupoPrincipalIni}`;
    const parcialGuardado  = (typeof APP !== "undefined" && APP.profParcialActivo && APP.profParcialActivo[gmKey]) || null;
    const parcialActivoNum = parcialGuardado
        ?? parciales.find(p => p.estado === "activo")?.num
        ?? parciales[0]?.num
        ?? 1;
    const grupoPrincipal = grupoPrincipalIni;
    const escalasPorParcial = {};
    const _ESC = Array.isArray(typeof DEMO_ESCALAS !== "undefined" ? DEMO_ESCALAS : null) ? DEMO_ESCALAS : null;
    if (_ESC) {
      parciales.forEach(p => {
        const id = (typeof escalaId === "function") ? escalaId(m.id, grupoPrincipal, p.num) : `${m.id}_${grupoPrincipal}_${p.num}`;
        const e = _ESC.find(x => x.id === id);
        if (e) escalasPorParcial[p.num] = e;
      });
    }
    const escalaActiva = escalasPorParcial[parcialActivoNum] || null;
    return {
      id:          m.id,
      nombre:      m.nombre,
      clave:       m.clave,
      color:       _GEST_MAT_PALETTE[i % _GEST_MAT_PALETTE.length],
      grad:        _GEST_MAT_GRADS[i % _GEST_MAT_GRADS.length],
      grupos:      m.grupos || [],
      periodoInfo,
      parcialActivoNum,
      escalaActiva,
      escalasPorParcial,
    };
  });
}

/**
 * @interaction gest-enriquecer-alumnos
 * @scope profesor-gestion-data-provider
 *
 * Given materias ya enriquecidas (`_gestEnriquecerMaterias`), grupos,
 *   tareasSrc, estudiantes — shapes de `_profDataBase`.
 * When `getProfGestionData` arma la sección "alumnos" (2da de 3 piezas).
 * Then 1 entry por par (estudiante, materia):
 *   - dedupe via Set `${estId}_${matId}` (alumno en varios grupos de la
 *     misma materia NO duplica; grupo asignado = el primero encontrado).
 *   - prom calculado desde tareas + entregas reales (filter por uid y
 *     calificación no-null).
 *   - tareasDetalle con título+fecha+estado (entregada/pendiente), sort
 *     pendientes al final.
 *   - progresoEscala dict `{parcN: progreso}`, lookup en
 *     DEMO_PROGRESO_ESCALA por key `${estId}_${matId}_${grupoId}_${num}`.
 *   - color avatar rotativo (7 paleta) por orden de inserción.
 * Edge:
 *   - Función PURA respecto a inputs.
 *   - Sin materias/grupos/estudiantes → `[]`.
 */
function _gestEnriquecerAlumnos(materias, grupos, tareasSrc, estudiantes) {
  const alumnos = [];
  const seen    = new Set();

  materias.forEach((mat) => {
    (mat.grupos || []).forEach((grupoId) => {
      const grupo = grupos.find((g) => g.id === grupoId);
      if (!grupo) return;
      (grupo.miembros || []).forEach((estId) => {
        const key = `${estId}_${mat.id}`;
        if (seen.has(key)) return;
        seen.add(key);

        const est = estudiantes.find((u) => u.id === estId);
        if (!est) return;

        const tareasGrupo = tareasSrc.filter(
          (t) => t.materiaId === mat.id && t.grupoId === grupoId,
        );
        const cals = tareasGrupo
          .flatMap((t) => t.entregas.filter((e) => e.uid === estId && e.calificacion != null))
          .map((e) => e.calificacion);

        const prom = cals.length
          ? parseFloat((cals.reduce((a, b) => a + b, 0) / cals.length).toFixed(2))
          : 0;

        const entregasCount = tareasGrupo.filter((t) =>
          t.entregas.some((e) => e.uid === estId),
        ).length;

        const tareasDetalle = tareasGrupo
          .map((t) => ({
            titulo: t.titulo,
            fecha:  _gestionFechaCorta(t.fechaEntrega),
            estado: t.entregas.some((e) => e.uid === estId) ? "entregada" : "pendiente",
          }))
          .sort((a) => (a.estado === "entregada" ? -1 : 1));

        const progresoEscala = {};
        if (typeof DEMO_PROGRESO_ESCALA === "object" && DEMO_PROGRESO_ESCALA) {
          ((mat.periodoInfo && mat.periodoInfo.parciales) || []).forEach((p) => {
            const pkey = `${estId}_${mat.id}_${grupoId}_${p.num}`;
            if (DEMO_PROGRESO_ESCALA[pkey]) progresoEscala[p.num] = DEMO_PROGRESO_ESCALA[pkey];
          });
        }

        alumnos.push({
          cardId:      key,
          id:          estId,
          nombre:      est.nombre,
          ini:         est.iniciales,
          materia:     mat.id,
          grupo:       grupoId,
          prom,
          entregas:    entregasCount,
          totalTareas: tareasGrupo.length,
          color:       _GEST_AV_PALETTE[alumnos.length % _GEST_AV_PALETTE.length],
          tareasDetalle,
          progresoEscala,
        });
      });
    });
  });

  return alumnos;
}

/**
 * @interaction gest-build-cals-shell
 * @scope profesor-gestion-data-provider
 *
 * Given alumnos ya enriquecidos (`_gestEnriquecerAlumnos`).
 * When `getProfGestionData` arma la sección "cals" (3ra de 3 piezas) —
 *   shell legacy que consume el `actualizarCal` de calificaciones.js.
 * Then 1 entry por alumno: `{id, nombre, materiaId, p1: null, p2: null,
 *   p3: null}`. Función PURA.
 */
function _gestBuildCalsShell(alumnos) {
  return alumnos.map((a) => ({
    id:       a.cardId,
    nombre:   a.nombre,
    materiaId: a.materia,
    p1: null, p2: null, p3: null,
  }));
}

// REFACTOR 2026-07-08: getProfGestionData era una función de ~115 líneas
// con 4 responsabilidades mezcladas (resolver base, enriquecer materias,
// enriquecer alumnos, armar shell de cals) — documentado por su propio
// docstring viejo como "función gigante, el data hub central del
// módulo". Se dividió en 3 funciones puras (_gestEnriquecerMaterias,
// _gestEnriquecerAlumnos, _gestBuildCalsShell) + un orquestador delgado
// que solo encadena inputs→outputs. Comportamiento IDÉNTICO — verificado
// comparando el output antes/después con los mismos datos semilla (ver
// scripts/verificar-refactor-gestion-data.js). Nada cambia para los
// callers de getProfGestionData(uid).

/**
 * @interaction gestion-fecha-corta
 * @scope profesor-gestion-helper-fecha
 *
 * Given iso datetime.
 * When `getProfGestionData` arma tareasDetalle / `_buildMiniPerfilGrid`
 *   muestra historial de tareas.
 * Then toLocaleDateString "es-MX" {day:2-digit, month:short} con try/catch
 *   defensive. Sin iso → "—".
 * Edge:
 *   - **Twin canonical** con `_recFechaStr` (recursos) y `_tpFormatDate`
 *     (tareas). Mismo patrón locale + defensive parse.
 *   - **NO incluye año** — gestión muestra fechas del periodo actual.
 *   - Locale hardcoded.
 *   - Función PURA.
 *   - Helper LOCAL.
 */
function _gestionFechaCorta(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short" }); }
  catch { return iso; }
}

// ── Helpers de UI locales ─────────────────────────────────────────────────────
/**
 * @interaction gestion-helpers-mat
 * @scope profesor-gestion-helper-paleta
 *
 * Given matId.
 * When `_buildMatCards` (banner gradient + label color) o `_buildMiniPerfilGrid`
 *   (banner card + accent + label color) muestran la materia coloreada.
 * Then 3 helpers:
 *   - `_gestionMatGrad(matId)`: linear-gradient 135deg con paleta 6 colors
 *     (alpha hex 80/30 stops). Default a primer gradient si idx -1.
 *   - `_gestionMatColor(matId)`: var --xahni-{color} con asimetría
 *     blue → blue-light. Fallback `var(--xahni-teal)` si materia no
 *     encontrada (diferencia con otros archivos del rol que cae al teal
 *     por idx=0; aquí es explicit fallback).
 *   - `_gestionMatNombre(matId)`: lookup defensive con fallback matId.
 * Edge:
 *   - **`_gestionMatGrad` Y `_gestionMatColor` leen `_gestionData.materias`**
 *     (cached del data provider) — NO `DEMO_MATERIAS` directo. Decisión:
 *     consistency con el shape enriquecido (incluye `color` field).
 *   - **`_gestionMatColor` early-return** si materia no encontrada (diferencia
 *     con `_recMatColor`/`_tpMatColor` que cae al primer color).
 *   - **Twins** con otros 4 archivos del rol (recursos/tareas/dashboard/
 *     escala). Deuda consolidación gigante a `_xahniMatColor` canonical.
 *   - Funciones PURAS.
 *   - Helpers LOCALES.
 */
function _gestionMatGrad(matId) {
  const idx = _gestionData.materias.findIndex((m) => m.id === matId);
  return _GEST_MAT_GRADS[Math.max(0, idx) % _GEST_MAT_GRADS.length];
}
function _gestionMatColor(matId) {
  const m = _gestionData.materias.find((x) => x.id === matId);
  if (!m) return "var(--xahni-teal)";
  return m.color === "blue" ? "var(--xahni-blue-light)" : `var(--xahni-${m.color})`;
}
function _gestionMatNombre(matId) {
  return (_gestionData.materias.find((m) => m.id === matId) || {}).nombre || matId;
}

// ── Entry point ───────────────────────────────────────────────────────────────
/**
 * @interaction build-gestion-academica
 * @scope profesor-gestion-entrypoint
 *
 * Given APP.user activo tipo "profesor" + DOM con `#prof-mat-cards` +
 *   `#mini-perfil-grid` + `#prof-mat-cerrar-parcial-slot`.
 * When `gestionRender` lo invoca post-fetch, o handlers CRUD/filtros/override
 *   trigger repaint.
 * Then:
 *   1. Guard tipo profesor → no-op.
 *   2. **Re-init `_gestionData` cada vez** (NO idempotent por uid): siempre
 *      `getProfGestionData(uid)`. Decisión: data debe reflejar mutaciones
 *      cross-módulo (e.g., escala guardada en otro tab).
 *   3. 3 sub-builds: mat cards + mini-perfil grid + cerrar-parcial botón header.
 * Edge:
 *   - **Re-init costoso pero data-driven**: cada repaint reconstruye TODO
 *     desde DEMO. Aceptable para volumen DEMO; deuda post-Supabase: cache
 *     reactivo con subscription.
 *   - **Asimetría con `buildTareasProfesor`** que SÍ es idempotent por uid
 *     y preserva ediciones in-memory. Gestión depende más fuerte de DEMO
 *     state externo (escalas + progreso) que muta en otros tabs.
 *   - Sin window export — caller cross-archivo `gestionRender` invoca directo.
 *   - Función IMPURA (DOM + state).
 */
function buildGestionAcademica() {
  if (!APP.user || APP.user.tipo !== "profesor") return;
  _gestionData = getProfGestionData(APP.user.id);
  _buildMatCards();
  _buildMiniPerfilGrid();
  _renderCerrarParcialBoton();
}

/**
 * @interaction render-cerrar-parcial-boton
 * @scope profesor-hub-materia (header global, cross-tab)
 *
 * Given: hub-materia profesor activo con (matId, grupoId, parcialActivo)
 * When:  se invoca al renderear tabs de parcial, cambio de parcial activo,
 *   o tras cerrar/reabrir el parcial actual desde cualquier tab.
 * Then:  popula el slot #prof-mat-cerrar-parcial-slot (header del hub-materia,
 *   visible en TODOS los tabs) con:
 *        - botón "🔒 Cerrar parcial N" si escala existe y no está cerrada
 *        - chip "🔒 Parcial N cerrado" + botón "🔓 Reabrir" si ya está cerrada
 *        - vacío si no hay escala o no hay contexto de hub-materia
 * Edge:
 *   - slot no presente en DOM → no-op (vista no cargada aún)
 *   - sin APP.profHubMatActivo (vista standalone legacy) → vacío
 *   - escala no encontrada → vacío (no hay acción aplicable)
 *
 * Histórico: 2026-05-23 vivía como #gestion-cerrar-parcial-slot dentro del
 * tab Gestión. Elevado al header global del hub-materia el 2026-05-24
 * (slice cerrar-parcial-integracion) para visibilidad cross-tab. Botón
 * Reabrir añadido 2026-05-25 (Lote cerrar-parcial-polish #5.A).
 */
function _renderCerrarParcialBoton() {
    const slot = document.getElementById("prof-mat-cerrar-parcial-slot");
    if (!slot) return;
    const hubCtx = APP.profHubMatActivo;
    if (!hubCtx) { slot.innerHTML = ""; return; }
    const matId = hubCtx.matId;
    const grupoId = hubCtx.grupoId || APP.profGrupoActivo;
    if (!matId || !grupoId) { slot.innerHTML = ""; return; }
    const gmKey = matId + "_" + grupoId;
    const parcial = (APP.profParcialActivo && APP.profParcialActivo[gmKey]) || 1;
    const escalaId = matId + "_" + grupoId + "_" + parcial;
    const escala = (typeof DEMO_ESCALAS !== "undefined" ? DEMO_ESCALAS : []).find(e => e.id === escalaId);
    if (!escala) { slot.innerHTML = ""; return; }
    if (escala.cerrado) {
        slot.innerHTML =
            '<span class="x-chip x-chip--info" style="font-size:11px"><svg class="x-icon x-icon--sm"><use href="#x-icon-lock"></use></svg> Parcial ' + parcial + ' cerrado</span>'
            + ' <button class="x-btn x-btn--ghost" style="font-size:12px" onclick="_reabrirParcialConfirm(\'' + escalaId + '\')"><svg class="x-icon x-icon--sm"><use href="#x-icon-lock-open"></use></svg> Reabrir</button>';
    } else {
        slot.innerHTML = '<button class="x-btn x-btn--ghost" style="font-size:12px" onclick="_cerrarParcialConfirm(\'' + escalaId + '\')"><svg class="x-icon x-icon--sm"><use href="#x-icon-lock"></use></svg> Cerrar parcial ' + parcial + '</button>';
    }
}
window._renderCerrarParcialBoton = _renderCerrarParcialBoton;

// ── Tarjetas de materias ──────────────────────────────────────────────────────
/**
 * @interaction build-mat-cards
 * @scope profesor-gestion-render-mat-cards
 *
 * Given DOM con `#prof-mat-cards` + `_gestionData.materias` hidratado.
 * When `buildGestionAcademica` orquesta o `filtrar*` actualizan `_unifiedFiltro`.
 * Then:
 *   1. Sin materias → empty state.
 *   2. Por materia: `.x-card x-card--link` con stripe color + body:
 *      - Header: nombre + clave + " · seleccionada" si active + chip
 *        "X en riesgo" (clickeable → `filtrarRiesgoMateria`) o "Sin riesgo".
 *      - Label "Escala · Parcial N activo" + `_escalaTotalLabel` derecha.
 *      - `_escalaBarHTML(escalaActiva)` — barra visual canonical.
 *      - **parcialRow segmentado**: `.x-segmented` con N segs (done/current/off
 *        según `parcialInfo.semanaActual`) + label "P{N}" + count "Sem. X de N"
 *        o "Completado"/"Por iniciar".
 *      - onclick → `filtrarUnificadaMat(m.id)` (toggle).
 *      - **Active state**: border-color + box-shadow blue dim.
 * Edge:
 *   - `m.parcialActivoNum` undefined → 1 default.
 *   - parcialInfo sin semanas → total=1 → 1 seg visible.
 *   - **`_esRiesgo` cross-archivo** (profesor.js) — chain dep.
 *   - **`_escalaBarHTML` cross-archivo** (escala.js shared) — chain dep.
 *   - Estilos INLINE para active + stripe + chip positions.
 *   - Función IMPURA (DOM).
 *   - Helper LOCAL.
 */
function _buildMatCards() {
    const el = document.getElementById("prof-mat-cards");
    if (!el) return;
    if (!_gestionData.materias.length) {
        el.innerHTML = `<div class="x-empty" style="grid-column:1/-1"><div class="x-empty__icon">📚</div><div class="x-empty__title">Sin materias asignadas</div></div>`;
        return;
    }
    el.innerHTML = _gestionData.materias.map(m => {
        const ac        = m.color === "blue" ? "var(--xahni-blue-light)" : `var(--xahni-${m.color})`;
        const riesgo    = _gestionData.alumnos.filter(a => a.materia === m.id && _esRiesgo(a)).length;
        const isActive  = _unifiedFiltro === m.id;
        const parcialN  = m.parcialActivoNum != null ? m.parcialActivoNum : 1;
        const escalaBar = _escalaBarHTML(m.escalaActiva);
        // Fila del parcial activo (reusa .x-segmented canónico).
        const parcialInfo = (m.periodoInfo && Array.isArray(m.periodoInfo.parciales))
            ? m.periodoInfo.parciales.find(p => p.num === parcialN) : null;
        let parcialRow = "";
        if (parcialInfo) {
            const total = parcialInfo.semanas || 1;
            const sem   = parcialInfo.semanaActual || 0;
            const segs  = Array.from({ length: total }, (_, i) => {
                const n = i + 1;
                const cls = n < sem ? " is-done" : n === sem ? " is-current" : "";
                return `<span class="x-segmented__seg${cls}"></span>`;
            }).join("");
            const lbl = parcialInfo.estado === "cerrado" ? "Completado"
                      : parcialInfo.estado === "futuro"  ? "Por iniciar"
                      : `Sem. ${sem} de ${total}`;
            parcialRow = `<div class="x-segmented" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
                <span class="x-segmented__label">P${parcialN}</span>
                <div class="x-segmented__bar">${segs}</div>
                <span class="x-segmented__count">${lbl}</span>
            </div>`;
        }
        const activeStyle = isActive ? "border-color:var(--xahni-blue);box-shadow:0 0 0 2px var(--xahni-blue-dim);" : "";
        return `<article class="x-card x-card--link" style="${activeStyle}padding:0;display:flex;overflow:hidden" onclick="filtrarUnificadaMat('${m.id}')">
            <div style="width:4px;flex-shrink:0;background:${ac}"></div>
            <div style="padding:16px;flex:1;min-width:0">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:12px">
                    <div>
                        <div style="font-size:14px;font-weight:600;color:var(--text-primary)">${m.nombre}</div>
                        <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);margin-top:2px">${m.clave}${isActive ? " · seleccionada" : ""}</div>
                    </div>
                    ${riesgo > 0
                        ? `<button class="x-chip x-chip--danger" style="cursor:pointer;border:1px solid var(--state-danger-border)" onclick="event.stopPropagation();filtrarRiesgoMateria('${m.id}')" title="Filtrar alumnos en riesgo de esta materia">⚠ ${riesgo} en riesgo</button>`
                        : `<span class="x-chip x-chip--ok">Sin riesgo</span>`}
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                    <div class="x-label">Escala · Parcial ${parcialN} activo</div>
                    ${m.escalaActiva ? _escalaTotalLabel(m.escalaActiva) : ""}
                </div>
                ${escalaBar}
                ${parcialRow}
            </div>
        </article>`;
    }).join("");
}

/**
 * @interaction escala-total-label
 * @scope profesor-gestion-render-helper
 *
 * Given escala con `criterios[]` (puede ser null/undefined).
 * When `_buildMatCards` muestra el header de la barra de escala con
 *   "TOTAL N% + M%" a la derecha del label "Escala P{N} activo".
 * Then HTML span con:
 *   - "TOTAL " label.
 *   - base sum coloreado state-ok.
 *   - extras sum (si > 0) coloreado state-warn con prefijo "+ ".
 * Edge:
 *   - esc null/sin criterios → `crits = []` → totales 0 → "TOTAL 0%"
 *     (visible pero indica "sin escala definida").
 *   - **Twin de `_escalaTotal/_escalaBaseTotal/_escalaExtraTotal`** del módulo
 *     escala.js — misma fórmula filter complementario. Aquí inline para
 *     evitar dep cross-module en parse time. Deuda menor: consolidar.
 *   - Función PURA.
 *   - Helper LOCAL.
 */
function _escalaTotalLabel(esc) {
    const crits  = (esc && Array.isArray(esc.criterios)) ? esc.criterios : [];
    const base   = crits.filter(c => !c.extra).reduce((s,c)=>s+(c.pct||0),0);
    const extras = crits.filter(c =>  c.extra).reduce((s,c)=>s+(c.pct||0),0);
    return `<div style="font-family:var(--font-mono);font-size:11px;font-weight:700;color:var(--text-muted)">
        TOTAL <span style="color:var(--state-ok)">${base}%</span>${extras ? ` <span style="color:var(--state-warn)">+ ${extras}%</span>` : ""}
    </div>`;
}

// ── Helpers del miniperfil rediseñado ────────────────────────────────────────

// Estado del candado por (uid, materiaId, parcN): { open: bool }.
const _gestionCandados = {};
/**
 * @interaction candado-key
 * @scope profesor-gestion-helper-key
 *
 * Given uid + matId + parcN.
 * When `_gestionAbrirCandado` / `_gestionToggleCandado` necesitan la key
 *   compuesta para el dict `_gestionCandados` (estado per-alumno-parcial).
 * Then template literal `${uid}_${matId}_${parcN}` — pattern key compuesta
 *   cementado del módulo (mismo que `progresoKey` en
 *   `DEMO_PROGRESO_ESCALA` pero sin grupoId).
 * Edge:
 *   - **Asimetría con DEMO_PROGRESO_ESCALA key**: ese incluye grupoId
 *     (`${uid}_${matId}_${grupoId}_${parcN}`). El candado NO porque es
 *     UI-local (no necesita disambiguate cross-grupo para el mismo
 *     alumno×materia en módulo gestion). Decisión cementada.
 *   - Función PURA.
 *   - Helper LOCAL (one-liner load-bearing — convención sesión 5).
 */
function _candadoKey(uid, matId, parcN) { return `${uid}_${matId}_${parcN}`; }

// Estado del parcial seleccionado por (uid, materiaId): número de parcial actualmente mostrado.
const _gestionParcialSel = {};
/**
 * @interaction gestion-parcial-actual
 * @scope profesor-gestion-state-parcial
 *
 * Given alumno (con `uid` o `id` + `materia`).
 * When `_buildMiniPerfilGrid` resuelve qué parcial mostrar en la card del
 *   alumno.
 * Then resolución cascada:
 *   1. Key compuesta `${uid}_${matId}` (sin parcial — el parcial es el valor
 *      stored).
 *   2. Si dict `_gestionParcialSel[k]` existe → retorna (parcial sticky del
 *      alumno).
 *   3. Else fallback al `parcialActivoNum` de la materia (decisión global).
 *   4. Fallback final 1.
 * Edge:
 *   - **Parcial sticky por alumno×materia**: cada card recuerda su parcial
 *     mostrado independientemente. Decisión UX: el profesor puede explorar
 *     parciales pasados de un alumno sin afectar otros.
 *   - `a.uid || a.id` fallback para tolerar shapes legacy.
 *   - Función PURA respecto a inputs (lee dict mutable pero no muta).
 *   - Helper LOCAL.
 */
function _gestionParcialActual(a) {
    const k = `${a.uid || a.id}_${a.materia}`;
    if (_gestionParcialSel[k]) return _gestionParcialSel[k];
    const m = _gestionData.materias.find(x => x.id === a.materia);
    return (m && m.parcialActivoNum) ? m.parcialActivoNum : 1;
}
/**
 * @interaction gestion-set-parcial
 * @scope profesor-gestion-handler-parcial
 *
 * Given uid + matId + parcN (1/2/3).
 * When user click un tab P1/P2/P3 dentro de la card del alumno en mini-perfil.
 * Then setea sticky en dict + repaint grid completo.
 * Edge:
 *   - **Repaint completo del grid** (no solo la card) — costoso pero simple.
 *     Decisión: edit cross-card es raro; rebuild idempotente.
 *   - Función IMPURA (muta dict + DOM).
 *   - Helper LOCAL.
 */
function _gestionSetParcial(uid, matId, parcN) {
    _gestionParcialSel[`${uid}_${matId}`] = parcN;
    _buildMiniPerfilGrid();
}

/**
 * @interaction gestion-cal-parcial
 * @scope profesor-gestion-calc-cal
 *
 * Given alumno (con `progresoEscala` dict) + parcN.
 * When `_buildMiniPerfilGrid` (label "FINAL" o tabs Pn) necesita la cal
 *   del parcial específico.
 * Then **cascade priority**:
 *   1. `p = a.progresoEscala[parcN]`; sin → null.
 *   2. `p.calFinalOverride` no null → override directo (decisión profesor).
 *   3. **Recompute desde escala del parcial**:
 *      - Lookup escala en `m.escalasPorParcial[parcN]`.
 *      - Itera criterios → suma `pct × ratio` (override > auto > 0).
 *      - Divide por 10 (de pct% a 0-10).
 *   4. Fallback al `p.calFinal` stored si recompute no aplica.
 *   5. Fallback final null.
 * Edge:
 *   - **Recompute garantiza consistency**: si el profesor cambia un valor
 *     auto del criterio, el cal del parcial refleja inmediatamente sin
 *     necesidad de save explícito.
 *   - **Twin del pattern `calFinalDeEscalaYProgreso` en shared/calificaciones-calc.js**
 *     pero NO delega ahí (inline para acceso a m.escalasPorParcial cached).
 *     Deuda menor: consolidar.
 *   - Función PURA respecto a inputs.
 *   - Helper LOCAL.
 */
function _gestionCalParcial(a, parcN) {
    const p = a.progresoEscala && a.progresoEscala[parcN];
    if (!p) return null;
    if (p.calFinalOverride != null) return p.calFinalOverride;
    // Recompute desde la escala del parcial específico
    const m = _gestionData.materias.find(x => x.id === a.materia);
    const esc = m && m.escalasPorParcial && m.escalasPorParcial[parcN];
    if (esc && Array.isArray(esc.criterios) && esc.criterios.length) {
        let sum = 0;
        esc.criterios.forEach(c => {
            const e = (p.criterios || []).find(x => x.criterioId === c.id);
            const r = e ? (e.overrideProf != null ? e.overrideProf : (e.valorAuto != null ? e.valorAuto : 0)) : 0;
            sum += (c.pct || 0) * r;
        });
        return sum / 10;
    }
    return p.calFinal != null ? p.calFinal : null;
}

// Calificación final agregada del alumno (media de parciales calificados).
// Slice pre-c10 6a (2026-05-26): extracción a js/shared/calificaciones-calc.js
// como `calFinalAgregadaAlumno`. Mantenemos alias local `_gestionCalFinal`
// como defensa por si emerge un caller no detectado en grep, y para
// minimizar el diff del único caller en este archivo (línea ~933).
const _gestionCalFinal = (typeof calFinalAgregadaAlumno === "function")
    ? calFinalAgregadaAlumno
    : function (a) {
        const obj = (a && a.progresoEscala) || {};
        const vals = Object.values(obj)
            .map(p => p.calFinalOverride != null ? p.calFinalOverride : p.calFinal)
            .filter(v => typeof v === "number");
        if (!vals.length) return null;
        return vals.reduce((s, v) => s + v, 0) / vals.length;
    };

/**
 * @interaction gestion-cal-color
 * @scope profesor-gestion-helper-paleta
 *
 * Given v (calificación number o null/undefined).
 * When `_buildMiniPerfilGrid` / `_renderEvalMatrix` colorean números de cal.
 * Then 4-rama semáforo:
 *   - v null → var(--text-muted) (placeholder "—").
 *   - v ≥ 8 → var(--state-ok) (verde).
 *   - v ≥ 7 → var(--state-warn) (amber).
 *   - else → var(--state-danger) (rojo).
 * Edge:
 *   - **Umbral 7/8 (no 6/9)**: gestión usa thresholds más estrictos que
 *     `_colorFinal` (profesor.js) que usa 6/9. Decisión consciente:
 *     gestión académica monitorea performance proactivamente (warn ≥7
 *     captura franja "necesita atención" antes de reprobar).
 *   - **Twin de `_gestionCalColor` cross-archivo**: similar paradigma a
 *     `_buildProfDashRiesgo` (dashboard también usa >=7 warn). Patrón del
 *     rol cementado.
 *   - Función PURA.
 *   - Helper LOCAL.
 */
function _gestionCalColor(v) {
    if (v == null) return "var(--text-muted)";
    if (v >= 8) return "var(--state-ok)";
    if (v >= 7) return "var(--state-warn)";
    return "var(--state-danger)";
}

/**
 * @interaction gestion-ver-tareas
 * @scope profesor-gestion-handler-nav
 *
 * Given uid + matId.
 * When user click CTA "Ver tareas de {firstName} en {matNombre}" en card
 *   del mini-perfil.
 * Then:
 *   1. **Hook one-shot**: `window._tareasFiltro = {uid, materiaId}` →
 *      consumido por `buildTareasProfesor` (en tareas.js) al entry (solo
 *      aplica el filtro de materia; el uid queda expuesto para una fase
 *      futura de filtro por alumno — limitación preexistente, ver
 *      docstring de `buildTareasProfesor`).
 *   2. Navega al subtab "tareas" del hub-materia de esa materia:
 *      - Si ya estamos dentro del detalle de ESA materia (`APP.profHubMatActivo.matId
 *        === matId`) → solo `profHubMatSwitchTab("tareas", ...)`.
 *      - Si no (viniendo de Gestión standalone o de otra materia) →
 *        `profHubAbrirMateria(matId)` primero (abre en "calificaciones"
 *        por default) y luego `profHubMatSwitchTab("tareas", ...)`.
 * Edge:
 *   - **FIX 2026-07-08**: antes llamaba `showView("tareas-prof")`, una
 *     vista standalone eliminada en el cleanup C9 (2026-05-24) — no está
 *     en VIEW_TITLES/VIEW_ROLES/INIT_MAP ni en ViewLoader, así que el
 *     click no hacía NADA (showView retornaba silenciosamente). El botón
 *     llevaba semanas roto. El docstring viejo ya documentaba esto como
 *     "deuda C9-leftover" pero nunca se completó la migración.
 *   - `profHubAbrirMateria`/`profHubMatSwitchTab` ausentes (build viejo /
 *     orden de carga raro) → no-op, el hook queda seteado igual (se
 *     pierde en el próximo render que no lo consuma).
 *   - **Exportado en window** (onclick inline).
 *   - Función IMPURA (window state + nav).
 */
function _gestionVerTareas(uid, matId) {
    window._tareasFiltro = { uid, materiaId: matId };
    if (typeof profHubMatSwitchTab !== "function") return;

    if (!APP.profHubMatActivo || APP.profHubMatActivo.matId !== matId) {
        if (typeof profHubAbrirMateria === "function") profHubAbrirMateria(matId);
    }
    const tabBtn = document.querySelector("#prof-hub-detalle-panel .hub-tab[data-tab='tareas']");
    profHubMatSwitchTab("tareas", tabBtn);
}

// Abrir candado: guarda contexto pendiente y abre el modal.
let _gestionCandadoPendiente = null;
/**
 * @interaction gestion-abrir-candado
 * @scope profesor-gestion-flow-override
 *
 * Given uid + matId + parcN.
 * When user click candado 🔒 cerrado en card del mini-perfil (querer
 *   habilitar override manual de cal final del parcial).
 * Then:
 *   1. Guarda `_gestionCandadoPendiente = {uid, matId, parcN}` (state pendiente).
 *   2. Abre modal `modal-override-cal` para confirm.
 * Edge:
 *   - **Fase 1 del flow override 3-fase**: (1) abrirCandado guarda contexto,
 *     (2) confirmarOverrideCal registra candado + notifica, (3) _gestionSetOverride
 *     mutación del valor.
 *   - Sin window export — caller `_gestionToggleCandado` invoca interno.
 *   - Función IMPURA (state + abre modal).
 */
function _gestionAbrirCandado(uid, matId, parcN) {
    _gestionCandadoPendiente = { uid, matId, parcN };
    if (typeof openModal === "function") openModal("modal-override-cal");
}
/**
 * @interaction confirmar-override-cal
 * @scope profesor-gestion-flow-override
 *
 * Given user en modal-override-cal tras `_gestionAbrirCandado`.
 * When user click confirmar del modal.
 * Then:
 *   1. Sin contexto pendiente → close modal + early return.
 *   2. Extrae {uid, matId, parcN} de pendiente.
 *   3. **Registra candado abierto**: `_gestionCandados[key] = {open: true}`.
 *   4. Reset pendiente + close modal.
 *   5. **Notifica al alumno** via `agregarNotificacion` (sistema canonical):
 *      - tipo "alerta", título "Calificación P{N} modificada manualmente".
 *      - desc con nombre materia.
 *   6. Toast info al profesor.
 *   7. Repaint grid (candado ahora visible como abierto → input cal final).
 * Edge:
 *   - `agregarNotificacion` ausente → notif silent skipped (toast profesor
 *     sigue visible).
 *   - Alumno no encontrado → nombre materia fallback al id.
 *   - **Fase 2 del flow override**: confirma intent del profesor antes de
 *     habilitar el input. Decisión UX: barrera evita override accidental
 *     que sería visible al alumno.
 *   - **Exportado en window** (onclick inline modal).
 *   - Función IMPURA (candados + state + modal + notif + DOM).
 *   - Deuda post-Supabase: notification table + realtime push al alumno.
 */
function confirmarOverrideCal() {
    if (!_gestionCandadoPendiente) { if (typeof closeModal === "function") closeModal("modal-override-cal"); return; }
    const { uid, matId, parcN } = _gestionCandadoPendiente;
    _gestionCandados[_candadoKey(uid, matId, parcN)] = { open: true };
    _gestionCandadoPendiente = null;
    if (typeof closeModal === "function") closeModal("modal-override-cal");
    // Notificar al alumno (lo prometía el modal). Usa el sistema canónico
    // de notificaciones — guarda la notif para que aparezca cuando el alumno
    // entre al panel de notificaciones de su sesión.
    if (typeof agregarNotificacion === "function") {
        const a = _gestionData.alumnos.find(x => (x.uid || x.id) === uid && x.materia === matId);
        const matNombre = (_gestionData.materias.find(x => x.id === matId) || {}).nombre || matId;
        const titulo = `Calificación P${parcN} modificada manualmente`;
        const desc   = `Tu profesor desbloqueó la edición manual de tu calificación del Parcial ${parcN} en ${matNombre}.`;
        agregarNotificacion("alerta", titulo, desc);
    }
    if (typeof showToast === "function") showToast(`Calificación P${parcN} desbloqueada · alumno notificado`, "info");
    _buildMiniPerfilGrid();
}

/**
 * @interaction gestion-set-override
 * @scope profesor-gestion-flow-override
 *
 * Given uid + matId + parcN + val (string del input number).
 * When candado ya abierto + user blur del input cal final override en card.
 * Then:
 *   1. parseFloat val. NaN → no-op.
 *   2. Lookup alumno; sin → no-op.
 *   3. Asegura `progresoEscala[parcN]` shape vacío si missing.
 *   4. Setea `calFinalOverride = max(0, min(10, num))` (clamp [0,10]).
 *   5. Repaint grid.
 * Edge:
 *   - **Fase 3 del flow override** (final): el valor solo persiste in-memory.
 *     Botón global "Guardar cambios" (`guardarCalificaciones`) persiste a
 *     DEMO_PROGRESO_ESCALA.
 *   - **Clamp [0,10]** silencioso — input number HTML no garantiza rango.
 *     UX: valor entered se truncate al cap sin alert.
 *   - Sin window export — caller inline en HTML mini-perfil.
 *   - Función IMPURA (alumno mutation + DOM).
 */
function _gestionSetOverride(uid, matId, parcN, val) {
    const num = parseFloat(val);
    if (Number.isNaN(num)) return;
    const a = _gestionData.alumnos.find(x => (x.uid || x.id) === uid && x.materia === matId);
    if (!a) return;
    a.progresoEscala = a.progresoEscala || {};
    a.progresoEscala[parcN] = a.progresoEscala[parcN] || {};
    a.progresoEscala[parcN].calFinalOverride = Math.max(0, Math.min(10, num));
    _buildMiniPerfilGrid();
}

/**
 * @interaction gestion-escala-progreso-html
 * @scope profesor-gestion-render-progreso
 *
 * Given alumno + parcN + escala.
 * When `_buildMiniPerfilGrid` arma el bloque visual "Escala P{N} · progreso"
 *   en la card del alumno.
 * Then:
 *   1. Sin escala válida → empty state "Sin escala definida para P{N}".
 *   2. Resuelve progreso del alumno en parcN.
 *   3. Por criterio: extrae ratio (override > auto > 0).
 *   4. Calcula sums obtenidos (base/extras) con `Math.round(pct × ratio)`.
 *   5. Header: label + "OBTENIDO N%/M%" coloreado (≥80 ok, ≥70 warn, else danger).
 *   6. Delega visual a `_escalaBarHTML(escala, {progreso, compact: true})`.
 * Edge:
 *   - **Coexiste con matriz de captura inline** (`_renderEvalMatrix`) — la
 *     matriz es editable, este es visualization. Decisión 2026-05-23 user
 *     feedback: "el progreso gráfico se RESTAURA siempre".
 *   - Función PURA (retorna string HTML).
 *   - Helper LOCAL.
 *   - **Twin estructural** con barra visual de alumno hub-aprendizaje;
 *     ese muestra mismo data desde perspectiva alumno.
 */
function _gestionEscalaProgresoHTML(a, parcN, escala) {
    if (!escala || !Array.isArray(escala.criterios) || !escala.criterios.length) {
        return `<div class="x-empty" style="padding:14px"><div class="x-empty__title" style="font-size:12px">Sin escala definida para P${parcN}</div></div>`;
    }
    const prog = (a.progresoEscala && a.progresoEscala[parcN] && a.progresoEscala[parcN].criterios) || [];
    const progreso = escala.criterios.map(c => {
        const entry = prog.find(p => p.criterioId === c.id);
        let ratio = 0;
        if (entry) {
            ratio = entry.overrideProf != null ? entry.overrideProf : (entry.valorAuto != null ? entry.valorAuto : 0);
        }
        return { criterioId: c.id, ratio };
    });
    const base   = escala.criterios.filter(c => !c.extra);
    const extras = escala.criterios.filter(c =>  c.extra);
    const sumObt = (arr) => arr.reduce((s, c) => {
        const e = progreso.find(p => p.criterioId === c.id);
        const r = e ? e.ratio : 0;
        return s + Math.round((c.pct || 0) * r);
    }, 0);
    const baseObt   = sumObt(base);
    const extraObt  = sumObt(extras);
    const baseTotal = base.reduce((s, c) => s + (c.pct || 0), 0);
    const baseColor = baseObt >= 80 ? "var(--state-ok)" : baseObt >= 70 ? "var(--state-warn)" : "var(--state-danger)";

    return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div class="x-label">Escala P${parcN} · progreso</div>
        <div style="font-family:var(--font-mono);font-size:10px;font-weight:700;color:var(--text-muted)">
            OBTENIDO <span style="color:${baseColor}">${baseObt}%</span><span style="color:var(--text-muted)">/${baseTotal}%</span>${extras.length ? ` <span style="color:var(--state-warn)">+ ${extraObt}%</span>` : ""}
        </div>
    </div>
    ${_escalaBarHTML(escala, { progreso, compact: true })}`;
}

// ── Personalización del alumno (banner/foto/marco desde su perfil) ──────────
// Slice #6: consolidado al helper canónico getAvatarDisplay(uid) de
// js/shared/perfil.js. Antes leía localStorage directo + fallback por uidHash;
// ahora delega al helper que resuelve desde DEMO_USERS[uid].gamer.* (fuente de
// verdad post-Pilar 1) con defaults del catálogo. fotoSrc queda en null porque
// el upload custom (DataURL) no está implementado en vanilla — diferido a
// Supabase Storage.
/**
 * @interaction perfil-estudiante-visuals
 * @scope profesor-gestion-helper-avatar
 *
 * Given uid del alumno.
 * When `_buildMiniPerfilGrid` arma el card del alumno con banner + avatar
 *   personalizados desde su perfil Pilar 1.
 * Then:
 *   1. Sin `getAvatarDisplay` → shape vacío (`{bannerCss: null, marcoCss: "",
 *      marcoOverlay: "", fotoSrc: null}`).
 *   2. Llama `getAvatarDisplay(uid)` (canonical helper).
 *   3. Mapea: `bannerBg → bannerCss`, `marcoCss`, `marcoPreview → marcoOverlay`.
 *   4. **`fotoSrc: null`** SIEMPRE — upload custom DataURL no implementado
 *      en vanilla, diferido a Supabase Storage.
 * Edge:
 *   - **Slice #6 consolidación**: pre-consolidación leía localStorage directo
 *     con fallback uidHash; ahora delega al canonical post-Pilar 1.
 *   - getAvatarDisplay retorna defaults del catálogo si gamer.* missing.
 *   - Función PURA.
 *   - Helper LOCAL.
 *   - **Caller fallback handling**: `_buildMiniPerfilGrid` cubre `fotoSrc=null`
 *     mostrando iniciales (vs img tag).
 *   - Deuda post-Supabase: `fotoSrc` desde Storage URL del alumno.
 */
function _perfilEstudianteVisuals(uid) {
    if (typeof getAvatarDisplay !== "function") {
        return { bannerCss: null, marcoCss: "", marcoOverlay: "", fotoSrc: null };
    }
    const d = getAvatarDisplay(uid);
    return {
        bannerCss:    d.bannerBg || null,
        marcoCss:     d.marcoCss || "",
        marcoOverlay: d.marcoPreview || "",
        fotoSrc:      null,
    };
}

/**
 * @interaction gestion-toggle-candado
 * @scope profesor-gestion-flow-override
 *
 * Given uid + matId + parcN.
 * When user click candado en card del mini-perfil.
 * Then:
 *   1. Lookup candado por key compuesta.
 *   2. **Si abierto** (`cand.open === true`): re-bloquear SILENT (sin modal),
 *      setea `{open: false}` + toast info.
 *   3. **Si cerrado o no existe**: delega a `_gestionAbrirCandado` (que abre
 *      modal confirm).
 * Edge:
 *   - **Asimetría abrir vs re-bloquear**: abrir requiere confirm (notifica
 *     alumno → más sensible); re-bloquear es silent (revertir es menos
 *     sensible). Decisión UX cementada.
 *   - **Override NO se borra al re-bloquear** — el `calFinalOverride` queda
 *     en `progresoEscala` hasta que `_liberarOverride` lo borra
 *     explícitamente desde matriz inline.
 *   - **Exportado en window** (onclick inline).
 *   - Función IMPURA (candados + DOM).
 */
function _gestionToggleCandado(uid, matId, parcN) {
    const k = _candadoKey(uid, matId, parcN);
    const cand = _gestionCandados[k];
    if (cand && cand.open) {
        // Re-bloquear
        _gestionCandados[k] = { open: false };
        if (typeof showToast === "function") showToast(`Calificación P${parcN} bloqueada`, "info");
        _buildMiniPerfilGrid();
    } else {
        _gestionAbrirCandado(uid, matId, parcN);
    }
}

// ── Phase 3: Matriz captura inline ───────────────────────────────────────────

/**
 * @interaction find-escala
 * @scope profesor-gestion-helper-lookup-escala
 *
 * Given materiaId + grupoId + parcialNum.
 * When `_buildMiniPerfilGrid` o cualquier renderer necesita la escala del
 *   parcial específico para un par materia×grupo.
 * Then guard typeof + filter find por los 3 campos. Retorna escala o null.
 * Edge:
 *   - DEMO_ESCALAS no cargado → `[]` → null.
 *   - **Lookup por triple key** (no por id compuesto string) — diferencia con
 *     otros lookups del rol que usan `${matId}_${grupoId}_${parcial}` id.
 *     Decisión: tolera schemas DEMO con id distinto al triple-key match.
 *   - **Exportado en window** (consumer cross-archivo posible).
 *   - Función PURA.
 *   - Helper LOCAL.
 *   - Fuente de verdad: DEMO_ESCALAS (array global de data-service.js).
 */
function _findEscala(materiaId, grupoId, parcialNum) {
    var escalas = (typeof DEMO_ESCALAS !== "undefined" && Array.isArray(DEMO_ESCALAS)) ? DEMO_ESCALAS : [];
    return escalas.find(function(e) {
        return e.materiaId === materiaId && e.grupoId === grupoId && e.parcialNum === parcialNum;
    }) || null;
}
window._findEscala = _findEscala;

/**
 * @interaction find-progreso
 * @scope profesor-gestion-helper-lookup-progreso
 *
 * Given uid + materiaId + grupoId + parcialNum.
 * When caller necesita el progreso del alumno en ese parcial específico
 *   (criterios captados, calFinal, calFinalOverride).
 * Then guard typeof + lookup por key compuesta
 *   `${uid}_${materiaId}_${grupoId}_${parcialNum}`. Retorna progreso o null.
 * Edge:
 *   - DEMO_PROGRESO_ESCALA no cargado → `{}` → null.
 *   - **Pattern progresoKey cementado**: 4-segment key (vs candadoKey que
 *     omite grupoId). Esta key es para DEMO_PROGRESO_ESCALA storage —
 *     diferencia con candado UI-local.
 *   - **Exportado en window**.
 *   - Función PURA.
 *   - Helper LOCAL.
 *   - Fuente de verdad: DEMO_PROGRESO_ESCALA (dict global).
 */
function _findProgreso(uid, materiaId, grupoId, parcialNum) {
    var prog = (typeof DEMO_PROGRESO_ESCALA !== "undefined" && DEMO_PROGRESO_ESCALA) ? DEMO_PROGRESO_ESCALA : {};
    var key = uid + "_" + materiaId + "_" + grupoId + "_" + parcialNum;
    return prog[key] || null;
}
window._findProgreso = _findProgreso;

/**
 * @interaction render-criterio-row
 * @scope profesor-gestion-matriz
 *
 * Given: un criterio del parcial + el progreso de un alumno en ese criterio
 * When:  se invoca al construir la tabla de captura inline
 * Then:  retorna HTML de una <tr> con captura editable (vinculo=manual)
 *        o read-only (vinculo=auto_tareas) o deshabilitada (vinculo=auto_examenes)
 * Edge:
 *   - vinculo='auto_examenes' → celda "🔒 — / valorMax"
 *   - locked=true (calFinalOverride activo o parcial cerrado) → input disabled
 *   - valorMax indefinido → denomina "/" sin denominador
 *   - criterio.vinculo no existe → default 'manual' (retrocompat)
 */
function _renderCriterioRow(criterio, progresoCriterio, locked, ctx) {
    var valorFrac = (typeof obtenerValorCriterio === "function")
        ? obtenerValorCriterio(criterio, progresoCriterio, ctx)
        : (progresoCriterio ? (progresoCriterio.overrideProf != null ? progresoCriterio.overrideProf : (progresoCriterio.valorAuto != null ? progresoCriterio.valorAuto : 0)) : 0);
    var vMax      = criterio.valorMax || 0;
    var valorCrudo = vMax > 0 ? Math.round(valorFrac * vMax) : 0;
    var subtotal   = valorFrac * (criterio.pct || 0);
    var excede     = vMax > 0 && valorCrudo > vMax;
    var vinculo    = criterio.vinculo || "manual";

    var captureCell;
    if (vinculo === "auto_examenes") {
        captureCell = '<span title="Auto: promedio de exámenes calificados del parcial" style="font-family:var(--font-mono);color:var(--text-secondary)">' + valorCrudo + ' / ' + vMax + '</span>'
            + ' <span class="x-chip x-chip--info" style="font-size:9px">auto · examen</span>';
    } else if (vinculo === "auto_tareas") {
        captureCell = '<span title="Auto: COUNT entregas calificadas a tiempo" style="font-family:var(--font-mono);color:var(--text-secondary)">' + valorCrudo + ' / ' + vMax + '</span>'
            + ' <span class="x-chip x-chip--info" style="font-size:9px">auto</span>';
    } else {
        captureCell = '<input type="number" min="0" step="1" max="' + vMax + '"'
            + ' value="' + (valorCrudo || "") + '" ' + (locked ? "disabled" : "")
            + ' data-criterio-id="' + criterio.id + '" data-valor-max="' + vMax + '"'
            + ' onblur="_evalSetCriterio(this)"'
            + ' style="width:56px;background:transparent;border:1px solid var(--border);border-radius:var(--r-sm);padding:3px 6px;text-align:center;font-family:var(--font-mono);color:var(--text-primary)">'
            + ' <span style="color:var(--text-muted);font-size:11px">/ ' + vMax + '</span>'
            + (excede ? ' <span class="x-chip x-chip--warn" style="font-size:9px;margin-left:4px">⚠ excede</span>' : "");
    }

    return "<tr>"
        + '<td style="padding:4px 8px;font-size:12px;color:var(--text-primary)">'
        + criterio.nombre
        + (criterio.extra ? ' <span class="x-chip x-chip--info" style="font-size:9px">extra</span>' : "")
        + "</td>"
        + '<td style="padding:4px 8px;text-align:center">' + captureCell + "</td>"
        + '<td style="padding:4px 8px;text-align:right;color:var(--text-muted);font-size:11px">' + (criterio.pct || 0) + "%</td>"
        + '<td style="padding:4px 8px;text-align:right;font-family:var(--font-mono);color:var(--text-secondary);font-size:11px">' + subtotal.toFixed(1) + "%</td>"
        + "</tr>";
}
window._renderCriterioRow = _renderCriterioRow;

/**
 * @interaction set-criterio-captura
 * @scope profesor-gestion-matriz
 *
 * Given: input numérico de captura recibe evento blur
 * When:  el profesor cambia el valor crudo de un criterio
 * Then:  convierte crudo→fracción, guarda en DEMO_PROGRESO_ESCALA y en
 *        el cache local a.progresoEscala, re-renderea el grid
 * Edge:
 *   - valor vacío → trata como 0
 *   - valor no numérico → toast error + no persiste
 *   - .x-eval-matrix sin data-uid/data-escala-id → no-op + warn
 */
function _evalSetCriterio(inputEl) {
    var vMax       = parseInt(inputEl.dataset.valorMax, 10);
    var criterioId = inputEl.dataset.criterioId;
    var raw        = inputEl.value === "" ? 0 : Number(inputEl.value);
    if (!Number.isFinite(raw)) {
        if (typeof showToast === "function") showToast("Valor inválido", "error");
        return;
    }
    var matrix    = inputEl.closest(".x-eval-matrix");
    if (!matrix) { console.warn("[XAHNI] _evalSetCriterio: no .x-eval-matrix encontrado"); return; }
    var uid       = matrix.dataset.uid;
    var escalaId  = matrix.dataset.escalaId;
    if (!uid || !escalaId) { console.warn("[XAHNI] _evalSetCriterio: uid/escalaId faltantes", matrix.dataset); return; }
    var valorAuto = (vMax > 0) ? (raw / vMax) : 0;
    _gestionSetCriterio(uid + "_" + escalaId, criterioId, valorAuto);
}
window._evalSetCriterio = _evalSetCriterio;

/**
 * @interaction set-criterio-progreso
 * @scope profesor-gestion-matriz
 *
 * Given: progresoKey = uid + "_" + escalaId (== uid_materiaId_grupoId_parcialNum)
 *        + criterioId + nuevo valorAuto (fracción 0–1)
 * When:  se invoca tras blur de input de captura
 * Then:  persiste overrideProf en DEMO_PROGRESO_ESCALA[progresoKey].criterios[],
 *        sincroniza a.progresoEscala en _gestionData y re-renderea el grid
 * Edge:
 *   - progresoKey no existe en DEMO_PROGRESO_ESCALA → lo crea con shape mínimo
 *   - criterio no existe en array → lo agrega
 */
function _gestionSetCriterio(progresoKey, criterioId, valorAuto) {
    var prog = (typeof DEMO_PROGRESO_ESCALA !== "undefined" && DEMO_PROGRESO_ESCALA) ? DEMO_PROGRESO_ESCALA : null;
    if (!prog) { console.warn("[XAHNI] _gestionSetCriterio: DEMO_PROGRESO_ESCALA no disponible"); return; }

    // Crear entrada si no existe (key = uid_materiaId_grupoId_parcialNum)
    if (!prog[progresoKey]) {
        // uid es la primera parte; escalaId es el resto (materiaId_grupoId_parcialNum)
        var parts    = progresoKey.split("_");
        var uidPart  = parts[0];
        var escIdPart = parts.slice(1).join("_");
        prog[progresoKey] = {
            uid: uidPart,
            escalaId: escIdPart,
            materiaId: parts[1] || "",
            grupoId:   parts.slice(2, -1).join("_"),
            parcialNum: Number(parts[parts.length - 1]) || 1,
            criterios: [],
            calFinal: null,
            calFinalOverride: null
        };
    }
    var p = prog[progresoKey];
    p.criterios = p.criterios || [];
    var existing = p.criterios.find(function(x) { return x.criterioId === criterioId; });
    if (existing) {
        existing.overrideProf = valorAuto;
    } else {
        p.criterios.push({ criterioId: criterioId, valorAuto: null, overrideProf: valorAuto });
    }

    // Sincronizar al cache local de _gestionData para que el re-render lea el valor nuevo
    var uid    = p.uid;
    var matId  = p.materiaId;
    var parcN  = p.parcialNum;
    var alumno = _gestionData.alumnos.find(function(a) { return (a.uid || a.id) === uid && a.materia === matId; });
    if (alumno) {
        alumno.progresoEscala = alumno.progresoEscala || {};
        alumno.progresoEscala[parcN] = p;
    }
    _buildMiniPerfilGrid();
}
window._gestionSetCriterio = _gestionSetCriterio;

/**
 * @interaction render-eval-matrix
 * @scope profesor-gestion-matriz
 *
 * Given: alumno (objeto de _gestionData.alumnos) + escala del parcial activo
 *        + progreso del alumno en ese parcial (de a.progresoEscala[parcN])
 * When:  se invoca al construir la card del alumno en tab Gestión
 * Then:  retorna HTML completo de la matriz inline (header + tabla + footer totales)
 *        o empty state con CTA "Definir escala" si no hay escala con criterios
 * Edge:
 *   - escala null o sin criterios → empty state
 *   - progreso.calFinalOverride presente → matriz disabled con badge + botón Liberar
 *   - escala.cerrado → read-only con chip "Cerrado"
 *   - vinculo no definido en criterios → default 'manual' (retrocompat)
 */
function _renderEvalMatrix(alumno, escala, progreso) {
    var uid = alumno.uid || alumno.id;
    if (!escala || !Array.isArray(escala.criterios) || escala.criterios.length === 0) {
        var matId  = alumno.materia || "";
        var grupoId = alumno.grupo  || "";
        var parcN  = (escala && escala.parcialNum) || 1;
        return '<div class="x-empty" style="padding:18px;text-align:center;border:1px dashed var(--border);border-radius:var(--r-md);margin:14px 0">'
            + '<div class="x-empty__title" style="font-size:12px;margin-bottom:8px">Escala no definida para este parcial</div>'
            + '<button class="x-btn x-btn--primary" style="font-size:12px" onclick="_abrirAgregarCriterioEnParcial(\'' + matId + '\',\'' + grupoId + '\',' + parcN + ')">+ Definir escala</button>'
            + '</div>';
    }

    var ctx       = { uid: uid, matId: alumno.materia, parcial: escala.parcialNum };
    var total     = escala.criterios.reduce(function(s, c) { return s + (c.pct || 0); }, 0);
    var calc      = (typeof calcularParcial === "function") ? calcularParcial(escala.criterios, progreso, ctx) : { bruto: 0, final: 0, breakdown: [] };
    var calColor  = _gestionCalColor(calc.final);
    var overridden = progreso && progreso.calFinalOverride != null;
    var locked     = overridden || !!escala.cerrado;

    var rows = escala.criterios.map(function(c) {
        var progC = progreso ? (progreso.criterios || []).find(function(p) { return p.criterioId === c.id; }) : null;
        return _renderCriterioRow(c, progC || null, locked, ctx);
    }).join("");

    var headerRight = ""
        + (total < 100 ? '<span class="x-chip x-chip--warn" style="font-size:10px">⚠ ' + total + '% incompleta</span>' : '<span class="x-chip x-chip--ok" style="font-size:10px">' + total + '%</span>')
        + (escala.cerrado ? ' <span class="x-chip x-chip--info" style="font-size:10px">🔒 Cerrado</span>' : "")
        + (overridden ? ' <span class="x-chip x-chip--warn" style="font-size:10px">🔒 Override</span>' : "")
        + (overridden ? ' <button class="x-btn x-btn--ghost" style="font-size:10px;padding:2px 8px;margin-left:4px" onclick="_liberarOverride(\'' + uid + '\',\'' + escala.id + '\')">Liberar</button>' : "");
    // 2026-05-23: botón "Cerrar parcial" movido fuera de la card de alumno.
    // 2026-05-24: elevado al header global del hub-materia
    // (renderizado por _renderCerrarParcialBoton) — la acción afecta a todo
    // el grupo, no a un alumno, y se ve cross-tab.

    var finalDisplay = overridden
        ? '<span style="font-family:var(--font-mono);color:' + calColor + ';font-size:14px;font-weight:700">' + Number(progreso.calFinalOverride).toFixed(1) + '</span>'
        : '<span style="font-family:var(--font-mono);color:var(--text-secondary)">' + calc.bruto.toFixed(1) + '%</span>'
        + ' <span style="color:var(--text-muted);margin:0 6px">→</span>'
        + '<span style="font-family:var(--font-mono);color:' + calColor + ';font-size:14px;font-weight:700">' + calc.final.toFixed(1) + '</span>';

    return '<div class="x-eval-matrix" data-uid="' + uid + '" data-escala-id="' + escala.id + '" style="margin:14px 0">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
        +   '<span class="x-label">Parcial ' + escala.parcialNum + '</span>'
        +   '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' + headerRight + '</div>'
        + '</div>'
        + '<table style="width:100%;border-collapse:collapse;font-size:11px;background:var(--surface-2);border-radius:var(--r-sm);overflow:hidden">'
        +   '<thead><tr style="background:var(--surface-3);color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em">'
        +     '<th style="padding:6px 8px;text-align:left">Criterio</th>'
        +     '<th style="padding:6px 8px;text-align:center">Captura</th>'
        +     '<th style="padding:6px 8px;text-align:right">%</th>'
        +     '<th style="padding:6px 8px;text-align:right">Subtotal</th>'
        +   '</tr></thead>'
        +   '<tbody>' + rows + '</tbody>'
        +   '<tfoot><tr style="background:var(--surface-3);font-weight:600">'
        +     '<td colspan="3" style="padding:6px 8px;text-align:right;color:var(--text-muted)">Bruto / Final</td>'
        +     '<td style="padding:6px 8px;text-align:right">' + finalDisplay + '</td>'
        +   '</tr></tfoot>'
        + '</table>'
        + '</div>';
}
window._renderEvalMatrix = _renderEvalMatrix;

/**
 * @interaction liberar-override-parcial
 * @scope profesor-gestion-matriz
 *
 * Given: alumno con calFinalOverride presente en DEMO_PROGRESO_ESCALA
 * When:  profesor hace clic en "Liberar" en la matriz
 * Then:  borra calFinalOverride del progreso, re-renderea el grid
 *        mostrando la matriz editable con bruto/final recalculados
 * Edge:
 *   - progresoKey no encontrado → no-op + warn
 */
function _liberarOverride(uid, escalaId) {
    var key = uid + "_" + escalaId;
    var prog = (typeof DEMO_PROGRESO_ESCALA !== "undefined" && DEMO_PROGRESO_ESCALA) ? DEMO_PROGRESO_ESCALA : null;
    if (!prog || !prog[key]) { console.warn("[XAHNI] _liberarOverride: key no encontrado", key); return; }
    prog[key].calFinalOverride = null;

    // Sincronizar al cache local
    var matId  = prog[key].materiaId;
    var parcN  = prog[key].parcialNum;
    var alumno = _gestionData.alumnos.find(function(a) { return (a.uid || a.id) === uid && a.materia === matId; });
    if (alumno && alumno.progresoEscala && alumno.progresoEscala[parcN]) {
        alumno.progresoEscala[parcN].calFinalOverride = null;
    }
    if (typeof showToast === "function") showToast("Override liberado — calificación recalculada", "info");
    _buildMiniPerfilGrid();
}
window._liberarOverride = _liberarOverride;

/**
 * @interaction cerrar-parcial-confirm
 * @scope profesor-gestion-matriz
 *
 * Given: escala activa no cerrada y sin calFinalOverride global
 * When:  profesor hace clic en "Cerrar parcial" en la cabecera de la matriz
 * Then:  abre modal-confirmar genérico (confirmarCanonico) con título
 *        "Cerrar parcial" y body explicativo; si el profesor confirma,
 *        setea escala.cerrado=true + escala.cerradoAt (ISO), re-renderea
 *        todas las matrices y muestra toast de éxito
 * Edge:
 *   - escalaId no encontrado en DEMO_ESCALAS → no-op + warn
 *   - confirmarCanonico no disponible → fallback a openModal directo
 *   - usuario cancela → no-op (Promise resuelve false)
 */
async function _cerrarParcialConfirm(escalaId) {
    var escalas = (typeof DEMO_ESCALAS !== "undefined" && Array.isArray(DEMO_ESCALAS)) ? DEMO_ESCALAS : [];
    var escala  = escalas.find(function(e) { return e.id === escalaId; });
    if (!escala) { console.warn("[XAHNI] _cerrarParcialConfirm: escala no encontrada", escalaId); return; }

    var ok;
    if (typeof confirmarCanonico === "function") {
        ok = await confirmarCanonico({
            titulo:      "Cerrar parcial",
            mensaje:     "Las capturas quedarán congeladas para todos los alumnos. Podrás volver a editarlas liberando el override individualmente por alumno.",
            accionTexto: "Cerrar parcial",
            tipo:        "danger",
            icono:       "🔒",
        });
    } else {
        // Fallback si confirmarCanonico aún no está disponible (carga diferida)
        ok = window.confirm("¿Cerrar el parcial? Las capturas quedarán congeladas.");
    }

    if (!ok) return;

    escala.cerrado   = true;
    escala.cerradoAt = new Date().toISOString();

    // Sincronizar al cache local en _gestionData si aplica
    _gestionData.materias.forEach(function(m) {
        if (m.escalaActiva && m.escalaActiva.id === escalaId) {
            m.escalaActiva.cerrado   = true;
            m.escalaActiva.cerradoAt = escala.cerradoAt;
        }
        if (m.escalasPorParcial) {
            Object.values(m.escalasPorParcial).forEach(function(ep) {
                if (ep && ep.id === escalaId) {
                    ep.cerrado   = true;
                    ep.cerradoAt = escala.cerradoAt;
                }
            });
        }
    });

    if (typeof showToast === "function") showToast("Parcial cerrado", "success");
    _buildMiniPerfilGrid();
    _renderCerrarParcialBoton();
    // Slice cerrar-parcial-integracion 2026-05-24: notificar a otros tabs
    // (Tareas, Asistencia, vista alumno) para que re-rendeen banners/chips/
    // bloqueos. Sin esto, si el profesor cierra estando en tab Tareas o
    // Asistencia, los chips/banner no aparecen hasta cambiar de tab y volver.
    if (typeof window !== "undefined" && typeof CustomEvent === "function") {
        const [matId, grupoId, parcialStr] = String(escalaId).split("_");
        window.dispatchEvent(new CustomEvent("parcialCerradoCambio", {
            detail: { matId, grupoId, parcial: parseInt(parcialStr, 10) }
        }));
    }
}
window._cerrarParcialConfirm = _cerrarParcialConfirm;

/**
 * @interaction reabrir-parcial-confirm
 * @scope profesor-hub-materia
 *
 * Given: escala con cerrado===true (parcial cerrado previamente por error
 *   o porque el profesor necesita ajustar capturas).
 * When:  profesor hace clic en "🔓 Reabrir" en el slot global del header
 *   del hub-materia (visible cross-tab).
 * Then:  abre confirmarCanonico tipo "primary" con ícono 🔓; si confirma,
 *   setea escala.cerrado=false + escala.reabiertoAt=ISO (preserva
 *   cerradoAt para trazabilidad), re-renderea matriz Gestión, refresca
 *   el botón global, y dispara CustomEvent("parcialCerradoCambio") para
 *   que tab Tareas y tab Asistencia desbloqueen banners/chips/cells.
 * Edge:
 *   - escalaId no encontrado → no-op + warn (mismo guard que Cerrar)
 *   - escala ya abierta (cerrado!==true) → no-op silencioso (botón no
 *     debería renderearse en ese estado, pero defensa en profundidad)
 *   - confirmarCanonico ausente → fallback window.confirm
 *   - usuario cancela → no-op (resolve false)
 *
 * Histórico: Espejo inverso de _cerrarParcialConfirm. Añadido 2026-05-25
 *   (Lote cerrar-parcial-polish #5.A). El override individual por alumno
 *   (calFinalOverride) NO se revierte automáticamente — el modal lo
 *   reconoce explícitamente.
 */
async function _reabrirParcialConfirm(escalaId) {
    var escalas = (typeof DEMO_ESCALAS !== "undefined" && Array.isArray(DEMO_ESCALAS)) ? DEMO_ESCALAS : [];
    var escala  = escalas.find(function(e) { return e.id === escalaId; });
    if (!escala) { console.warn("[XAHNI] _reabrirParcialConfirm: escala no encontrada", escalaId); return; }
    if (!escala.cerrado) return;

    var ok;
    if (typeof confirmarCanonico === "function") {
        ok = await confirmarCanonico({
            titulo:      "Reabrir parcial",
            mensaje:     "Las capturas volverán a ser editables y los chips de cierre desaparecerán para todos los alumnos. <strong>Los overrides individuales por alumno NO se revierten</strong> — siguen activos hasta que los liberes desde Gestión.",
            accionTexto: "Reabrir parcial",
            tipo:        "primary",
            icono:       "🔓",
        });
    } else {
        ok = window.confirm("¿Reabrir el parcial? Las capturas vuelven a ser editables. Los overrides individuales no se revierten.");
    }

    if (!ok) return;

    escala.cerrado     = false;
    escala.reabiertoAt = new Date().toISOString();
    // cerradoAt se preserva como auditoría histórica.

    // Sincronizar al cache local en _gestionData (espejo del cerrar)
    _gestionData.materias.forEach(function(m) {
        if (m.escalaActiva && m.escalaActiva.id === escalaId) {
            m.escalaActiva.cerrado     = false;
            m.escalaActiva.reabiertoAt = escala.reabiertoAt;
        }
        if (m.escalasPorParcial) {
            Object.values(m.escalasPorParcial).forEach(function(ep) {
                if (ep && ep.id === escalaId) {
                    ep.cerrado     = false;
                    ep.reabiertoAt = escala.reabiertoAt;
                }
            });
        }
    });

    if (typeof showToast === "function") showToast("Parcial reabierto", "success");
    _buildMiniPerfilGrid();
    _renderCerrarParcialBoton();
    // Mismo CustomEvent que el cerrar — los listeners en tab Tareas/Asistencia
    // hacen re-render que consulta escala.cerrado y reacciona idempotente.
    if (typeof window !== "undefined" && typeof CustomEvent === "function") {
        const [matId, grupoId, parcialStr] = String(escalaId).split("_");
        window.dispatchEvent(new CustomEvent("parcialCerradoCambio", {
            detail: { matId, grupoId, parcial: parseInt(parcialStr, 10) }
        }));
    }
}
window._reabrirParcialConfirm = _reabrirParcialConfirm;

/**
 * @interaction abrir-agregar-criterio-en-parcial
 * @scope profesor-gestion-cta-empty
 *
 * Given materiaId + grupoId + parcialNum.
 * When user click "+ Definir escala" en empty state de matriz inline
 *   (`_renderEvalMatrix` cuando sin criterios).
 * Then:
 *   1. Si `window.escalaAbrirAgregarCriterio` existe (helper cross-module
 *      de escala.js) → delega con contexto pre-apuntado al parcial.
 *   2. Fallback: `openModal("modal-agregar-criterio")` directo.
 * Edge:
 *   - **Cross-module dispatch**: ideal navegar al tab Calificaciones
 *     con materia+parcial pre-seleccionados, pero el handler shared
 *     `escalaAbrirAgregarCriterio` puede no existir aún (parse order).
 *   - **Fallback openModal directo** muestra modal sin contexto — UX
 *     subóptimo (profesor debe re-seleccionar materia+parcial dentro
 *     del modal).
 *   - **Exportado en window** (onclick inline empty state).
 *   - Función IMPURA (DOM + cross-module dispatch).
 */
function _abrirAgregarCriterioEnParcial(materiaId, grupoId, parcialNum) {
    if (typeof window.escalaAbrirAgregarCriterio === "function") {
        window.escalaAbrirAgregarCriterio(materiaId, grupoId, parcialNum);
    } else if (typeof openModal === "function") {
        openModal("modal-agregar-criterio");
    }
}
window._abrirAgregarCriterioEnParcial = _abrirAgregarCriterioEnParcial;

// ── Grid de mini-perfiles ─────────────────────────────────────────────────────
/**
 * @interaction build-mini-perfil-grid
 * @scope profesor-gestion-render-mini-perfil
 *
 * Given DOM con `#mini-perfil-grid` + `_gestionData.alumnos` + filtros.
 * When `buildGestionAcademica` orquesta o handlers update filtros/override/captura.
 * Then renderer GIGANTE del módulo (~120 LOC):
 *   1. **Filter pipeline**:
 *      - `_unifiedFiltro === "riesgo"` → `_esRiesgo` (umbral profesor.js).
 *      - `startsWith("riesgo-")` → riesgo + materia compuesto.
 *      - else materia específica.
 *      - `_gestionGrupoFiltro` (C9) → filter por grupo activo.
 *      - `_busquedaAlumno` → includes case-insensitive en nombre.
 *   2. Sin data → empty state.
 *   3. Por alumno construye card x-card:
 *      - **Banner gradient** (vis.bannerCss || matColor degradado fallback) +
 *        grid pattern + chip riesgo según `_nivelRiesgo`.
 *      - **Avatar 34px** con marco + overlay (Pilar 1 visuals). Fallback
 *        iniciales si sin foto.
 *      - **Nombre + grupo** + **cal final 24px mono** (color por umbral).
 *      - **Label materia uppercase** coloreada.
 *      - **Matriz inline `_renderEvalMatrix`** (captura editable por criterio).
 *      - **Progreso `_gestionEscalaProgresoHTML`** (visualization barra).
 *      - **CTA "Ver tareas de {firstName} en {matNombre}"** → `_gestionVerTareas`.
 *      - **Historial tareas** scroll vertical con `.x-list-row` por tarea.
 *      - **Botón "⚠ Enviar alerta"** → `abrirAlertaAlumno`.
 * Edge:
 *   - **`_unifiedFiltro` 4 estados**: "todas" / matId / "riesgo" / "riesgo-{matId}".
 *   - **Co-renderer matriz + progreso**: matriz es editable (Task 16), progreso
 *     es visualization (decisión 2026-05-23 user feedback "RESTAURA siempre").
 *   - **Banner fallback gradient**: si alumno sin bannerBg en gamer.*, usa
 *     gradient derivado del matColor.
 *   - **mix-blend-mode:screen** en marco overlay — efecto canonical Pilar 1.
 *   - innerHTML masivo con escapeo IMPLÍCITO (DEMO controlado; `a.nombre`
 *     directo). Deuda XSS post-Supabase.
 *   - 6 cross-archivo deps: `_esRiesgo`, `_nivelRiesgo` (profesor.js),
 *     `getAvatarDisplay` (perfil.js shared), `_renderEvalMatrix`,
 *     `_gestionEscalaProgresoHTML`, `_gestionCalFinal`. Cadena densa.
 *   - Función IMPURA (DOM masivo).
 *   - Helper LOCAL.
 *   - **Renderer más grande del módulo y del rol profesor**.
 */
function _buildMiniPerfilGrid() {
    const el = document.getElementById("mini-perfil-grid");
    if (!el) return;
    let data = _gestionData.alumnos;

    if (_unifiedFiltro === "riesgo") data = data.filter(_esRiesgo);
    else if (_unifiedFiltro.startsWith("riesgo-")) {
        const matId = _unifiedFiltro.replace("riesgo-", "");
        data = data.filter(a => a.materia === matId && _esRiesgo(a));
    } else if (_unifiedFiltro !== "todas") {
        data = data.filter(a => a.materia === _unifiedFiltro);
    }
    // C9: filtro por grupo activo cuando gestion vive en hub-materia.
    if (_gestionGrupoFiltro) {
        data = data.filter(a => a.grupo === _gestionGrupoFiltro);
    }
    if (_busquedaAlumno) {
        const q = _busquedaAlumno.toLowerCase();
        data = data.filter(a => a.nombre.toLowerCase().includes(q));
    }

    if (!data.length) {
        el.innerHTML = `<div class="x-empty" style="grid-column:1/-1">
            <div class="x-empty__icon"><svg class="x-icon x-icon--xl"><use href="#x-icon-search"></use></svg></div>
            <div class="x-empty__title">No se encontraron alumnos</div>
            <div class="x-empty__desc">Intenta con otro filtro o búsqueda.</div>
        </div>`;
        return;
    }

    el.innerHTML = data.map(a => {
        const uid       = a.uid || a.id;
        const m         = _gestionData.materias.find(x => x.id === a.materia);
        const matNombre = m && m.nombre ? m.nombre : a.materia;
        const matColor  = m && m.color === "blue" ? "var(--xahni-blue-light)" : `var(--xahni-${(m && m.color) || "teal"})`;
        const parcN     = _gestionParcialActual(a);
        // Escala POR parcial seleccionado (no la activa fija); fallback a la activa.
        const escalaP   = (m && m.escalasPorParcial && m.escalasPorParcial[parcN]) || (m && m.escalaActiva) || null;
        const calFinal  = _gestionCalFinal(a);
        const calColor  = _gestionCalColor(calFinal);
        const nivel     = _nivelRiesgo(a);
        const riesgoStripe = nivel === "alto" ? "border-color:var(--state-danger);" : nivel === "medio" ? "border-color:var(--state-warn);" : "";
        const riesgoBadge  = nivel === "alto" ? `<span class="x-chip x-chip--danger" style="position:absolute;top:8px;right:10px">Riesgo alto</span>`
                            : nivel === "medio" ? `<span class="x-chip x-chip--warn" style="position:absolute;top:8px;right:10px">Riesgo medio</span>`
                            : "";
        // Personalización del alumno (banner/foto/marco desde su perfil).
        const vis        = _perfilEstudianteVisuals(uid);
        const bannerBg   = vis.bannerCss || `linear-gradient(135deg, ${matColor}33, ${matColor}11)`;
        const avatarInner = vis.fotoSrc
            ? `<img src="${vis.fotoSrc}" alt="${a.nombre}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
            : `${(typeof getAvatarDisplay === 'function' ? getAvatarDisplay(uid).fotoTexto : a.ini)}`;
        const avatarBase = `width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;position:relative;`;
        const avatarStyle = vis.fotoSrc
            ? `${avatarBase}overflow:hidden;${vis.marcoCss || ""}`
            : `${avatarBase}color:${matColor};background:${matColor}22;${vis.marcoCss || ""}`;
        const avatarOverlay = vis.marcoOverlay
            ? `<span style="position:absolute;inset:-2px;border-radius:50%;background:${vis.marcoOverlay};pointer-events:none;opacity:.85;mix-blend-mode:screen"></span>`
            : "";

        // Task 16 — Matriz inline de captura por criterio
        // escalaP ya tiene la escala del parcial activo para este alumno (line 463).
        // progresoAlumno viene del cache local a.progresoEscala[parcN].
        const progresoAlumno = (a.progresoEscala && a.progresoEscala[parcN]) || null;
        // Task 16 — matriz nueva inline (cuando la escala tiene criterios).
        const tieneMatriz = escalaP && Array.isArray(escalaP.criterios) && escalaP.criterios.length > 0;
        const matrizHTML  = _renderEvalMatrix(a, escalaP, progresoAlumno);
        // 2026-05-23 (user feedback): el progreso gráfico se RESTAURA siempre.
        // Convive con la matriz: la matriz es captura editable, el progreso
        // es visualización de dónde está el alumno respecto a la escala.
        const escalaProgresoHTML = _gestionEscalaProgresoHTML(a, parcN, escalaP);

        // Historial de tareas — emite filas con .x-list-row dentro de .x-scroll.
        const historial = (a.tareasDetalle || []).map(t => `<div class="x-list-row" style="padding:6px 8px;border-radius:var(--r-sm);margin-bottom:4px;background:var(--surface-2);border:none">
            <span style="width:14px;height:14px;border-radius:50%;background:${t.estado === "entregada" ? "var(--state-ok-dim)" : "var(--surface-3)"};color:${t.estado === "entregada" ? "var(--state-ok)" : "var(--text-muted)"};display:flex;align-items:center;justify-content:center;font-size:9px;flex-shrink:0">${t.estado === "entregada" ? "✓" : "○"}</span>
            <div class="x-list-row__body">
                <div class="x-list-row__title" style="font-size:11px">${t.titulo}</div>
                <div class="x-list-row__meta" style="font-size:9px">${_gestionFechaCorta(t.fecha)}</div>
            </div>
            <span class="x-chip ${t.estado === "entregada" ? "x-chip--ok" : "x-chip--muted"}" style="font-size:9px;padding:1px 6px">${t.estado === "entregada" ? (t.calificacion != null ? `${t.calificacion}/10` : "Entregada") : "Pendiente"}</span>
        </div>`).join("") || `<div style="font-size:11px;color:var(--text-muted);padding:8px;text-align:center">Sin tareas registradas</div>`;

        const firstName = (a.nombre || "").split(" ")[0] || a.nombre || "alumno";

        return `<article class="x-card" style="padding:0;overflow:hidden;${riesgoStripe}">
            <div style="height:50px;background:${bannerBg};position:relative;overflow:hidden">
                <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.13) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.13) 1px,transparent 1px);background-size:22px 22px"></div>
                ${riesgoBadge}
            </div>
            <div style="padding:14px 16px">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">
                    <div style="display:flex;align-items:center;gap:10px;min-width:0">
                        <div style="${avatarStyle}">${avatarInner}${avatarOverlay}</div>
                        <div style="min-width:0">
                            <div style="font-size:14px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.nombre}</div>
                            <div style="font-size:11px;color:var(--text-muted)">${a.grupo}</div>
                        </div>
                    </div>
                    <div style="text-align:right;flex-shrink:0">
                        <div style="font-family:var(--font-mono);font-size:24px;font-weight:700;color:${calColor};line-height:1">${calFinal != null ? calFinal.toFixed(1) : "—"}</div>
                        <div class="x-label" style="margin-top:2px">FINAL</div>
                    </div>
                </div>
                <div style="font-size:11px;color:${matColor};margin-bottom:14px;text-transform:uppercase;letter-spacing:.06em;font-weight:600">${matNombre}</div>

                ${matrizHTML}
                ${escalaProgresoHTML}

                <a href="#" onclick="event.preventDefault();_gestionVerTareas('${uid}','${a.materia}')" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 12px;background:var(--xahni-blue-dim);border:1px solid var(--state-info-border);border-radius:var(--r-md);text-decoration:none;color:#7ab0ff;font-size:12px;font-weight:600;margin:14px 0 10px;transition:var(--transition)">
                    <span>📋 Ver tareas de ${firstName} en ${matNombre}</span>
                    <span>→</span>
                </a>

                <div class="x-label" style="margin-bottom:6px">Historial de tareas</div>
                <div class="x-scroll" style="max-height:120px;margin-bottom:14px;padding-right:4px">
                    ${historial}
                </div>

                <button class="x-btn x-btn--danger" style="width:100%;justify-content:center" onclick="abrirAlertaAlumno('${a.cardId}')">⚠ Enviar alerta</button>
            </div>
        </article>`;
    }).join("");
}

// ── Filtros ───────────────────────────────────────────────────────────────────
/**
 * @interaction gestion-update-tabs-active
 * @scope profesor-gestion-render-tabs-sync
 *
 * Given DOM con `#gestion-filtro-tabs` + `_unifiedFiltro` state.
 * When handler `filtrar*` setea filtro o `gestionRender` C9 aplica
 *   pre-filtro.
 * Then:
 *   1. **Scope crítico `#gestion-filtro-tabs`**: querySelector restringida
 *      por id padre. Razón: `.x-tabs__tab` también vive en modal
 *      Configuración (3 tabs Apariencia/Notif/Privacidad) que matchean
 *      primero el querySelector global y rompen el sync.
 *   2. Deselect siblings (`.is-active` remove).
 *   3. Activa tab según filtro:
 *      - "riesgo" o "riesgo-*" → tabs[1] (En riesgo).
 *      - else → tabs[0] (Todos).
 * Edge:
 *   - DOM target ausente → no-op.
 *   - **2026-05-28 fix documentado**: pre-fix, materia filtrada via C9 dejaba
 *     ambas tabs sin highlight (visual "nada seleccionado"). Ahora "Todos"
 *     se activa default si no es riesgo.
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM).
 */
function _gestionUpdateTabsActive() {
  const scope = document.getElementById("gestion-filtro-tabs");
  if (!scope) return;
  const tabs = scope.querySelectorAll(".x-tabs__tab");
  tabs.forEach(t => t.classList.remove("is-active"));
  const esRiesgoFiltro = _unifiedFiltro === "riesgo" || _unifiedFiltro.startsWith("riesgo-");
  if (esRiesgoFiltro && tabs[1]) tabs[1].classList.add("is-active");
  else if (tabs[0]) tabs[0].classList.add("is-active");
}

/**
 * @interaction filtros-unificados
 * @scope profesor-gestion-handlers-filtros
 *
 * Given user click tab "Todos" / "En riesgo" / card materia / chip "N en
 *   riesgo".
 * When dispara onclick handler.
 * Then 4 handlers que setean `_unifiedFiltro` + sync tabs + 2 builds (mat
 *   cards + mini-perfil grid):
 *   - `filtrarUnificadaTodas()`: setea "todas".
 *   - `filtrarUnificadaRiesgo()`: setea "riesgo".
 *   - `filtrarUnificadaMat(id)`: **toggle** — si ya está activa la materia,
 *     vuelve a "todas"; else setea matId.
 *   - `filtrarRiesgoMateria(matId)`: setea "riesgo-{matId}" (compuesto;
 *     `_buildMiniPerfilGrid` lo detecta con startsWith).
 * Edge:
 *   - **4 estados `_unifiedFiltro` composite**: "todas" / matId / "riesgo" /
 *     "riesgo-{matId}". Documentado en `_buildMiniPerfilGrid` filter pipeline.
 *   - **`filtrarUnificadaMat` toggle**: click misma materia 2x deselecciona
 *     (decisión UX: card no queda stuck active).
 *   - **Doble re-build** (cards + grid) garantiza visual consistente
 *     (cards muestran active state, grid filtra alumnos).
 *   - Exportados en window (onclicks inline).
 *   - Funciones IMPURAS (state + DOM).
 */
function filtrarUnificadaTodas() {
  _unifiedFiltro = "todas";
  _gestionUpdateTabsActive();
  _buildMatCards();
  _buildMiniPerfilGrid();
}
function filtrarUnificadaRiesgo() {
  _unifiedFiltro = "riesgo";
  _gestionUpdateTabsActive();
  _buildMatCards();
  _buildMiniPerfilGrid();
}
function filtrarUnificadaMat(id) {
  _unifiedFiltro = _unifiedFiltro === id ? "todas" : id;
  _gestionUpdateTabsActive();
  _buildMatCards();
  _buildMiniPerfilGrid();
}
function filtrarRiesgoMateria(matId) {
  _unifiedFiltro = "riesgo-" + matId;
  _gestionUpdateTabsActive();
  _buildMatCards();
  _buildMiniPerfilGrid();
}

// ── Búsqueda ──────────────────────────────────────────────────────────────────
/**
 * @interaction buscar-alumno
 * @scope profesor-gestion-handler-search
 *
 * Given input string `q` del campo de búsqueda.
 * When user oninput dispara.
 * Then trim + setea `_busquedaAlumno` + repaint grid.
 * Edge:
 *   - **`trim()` aplicado**: leading/trailing spaces no afectan filtro
 *     (diferencia con `buscarTareaProf` tareas.js que NO trimea).
 *   - **Sin debounce** — aceptable volumen DEMO. Deuda post-Supabase
 *     debounce ~200ms.
 *   - Filter case-insensitive aplicado en `_buildMiniPerfilGrid` (lower-case
 *     includes en `nombre`).
 *   - **Solo busca en nombre** (no en grupo o materia). Decisión histórica.
 *   - Exportado en window (oninput inline).
 *   - Función IMPURA (state + DOM).
 */
function buscarAlumno(q) {
  _busquedaAlumno = q.trim();
  _buildMiniPerfilGrid();
}

// ── Calificaciones ────────────────────────────────────────────────────────────
/**
 * @interaction actualizar-cal-manual
 * @scope profesor-gestion-handler-cal-legacy
 *
 * Given cardId + par ("p1"/"p2"/"p3") + val (string del input).
 * When user blur de input cal manual en card (legacy `_gestionData.cals`).
 * Then:
 *   1. Lookup cal entry.
 *   2. Setea `c[par] = parseFloat(val)` (o null si vacío).
 *   3. Recalcula final via `recalcFinalCard(id)`.
 * Edge:
 *   - **Path LEGACY**: `_gestionData.cals` shell (3 cols p1/p2/p3 fixed)
 *     pre-matriz inline. Co-existe con flujo override/captura nuevo pero
 *     no se renderea en mini-perfil actual. Deuda C9-leftover: posible
 *     remove post-cleanup.
 *   - NaN del parseFloat → cae a NaN (caller maneja en `_calcFinal`).
 *   - **Exportado en window** (onblur inline legacy).
 *   - Función IMPURA (cal mutation + DOM via recalc).
 */
function actualizarCal(id, par, val) {
  const c = _gestionData.cals.find((x) => x.id === id);
  if (c) c[par] = val === "" ? null : parseFloat(val);
  recalcFinalCard(id);
}
/**
 * @interaction recalc-final-card
 * @scope profesor-gestion-handler-cal-legacy
 *
 * Given cardId del cal entry.
 * When `actualizarCal` actualiza un parcial.
 * Then:
 *   1. Lookup cal entry.
 *   2. Calcula final via `_calcFinal(c.p1, c.p2, c.p3)` (profesor.js).
 *   3. Update `#mp-final-{id}` span con value + color via `_colorFinal`.
 * Edge:
 *   - DOM target ausente → no-op (no card mounted).
 *   - **Cross-archivo deps `_calcFinal` + `_colorFinal`** (profesor.js
 *     legacy helpers).
 *   - **Path LEGACY** mismo que `actualizarCal` — co-deuda.
 *   - **Exportado en window**.
 *   - Función IMPURA (DOM).
 */
function recalcFinalCard(id) {
  const c = _gestionData.cals.find((x) => x.id === id);
  if (!c) return;
  const fin = _calcFinal(c.p1, c.p2, c.p3);
  const el  = document.getElementById("mp-final-" + id);
  if (!el) return;
  el.textContent = fin;
  el.style.color = _colorFinal(fin);
}
/**
 * @interaction guardar-calificaciones
 * @scope profesor-gestion-handler-save
 *
 * Given user click "💾 Guardar cambios" en header de gestión + ediciones
 *   in-memory de `calFinalOverride` por alumno×parcial.
 * When click handler dispara.
 * Then:
 *   1. Guard DEMO_PROGRESO_ESCALA disponible → toast error si no.
 *   2. Itera todos los alumnos × sus progresoEscala parciales:
 *      - Skip si `calFinalOverride == null` (no hay edit pendiente).
 *      - Compone key canonical `${uid}_${matId}_${grupoId}_${parcN}`.
 *      - Si entry en DEMO no existe → la crea con shape mínimo
 *        (uid + escalaId + materiaId + grupoId + parcialNum + criterios[]
 *        + calFinal + calFinalOverride null).
 *      - Setea `calFinalOverride` desde memoria al DEMO entry.
 *      - Incrementa counter `n`.
 *   3. Toast con count plural:
 *      - n === 0 → "No hay cambios pendientes de guardar" info.
 *      - n > 0 → "Calificaciones guardadas (N override(s) aplicado(s))" success.
 * Edge:
 *   - **In-memory FLUSH a DEMO**: punto único de persistencia del módulo.
 *     Otros mutations (`_gestionSetOverride`, `_evalSetCriterio`) escriben
 *     directo a DEMO; este flush es solo para overrides cal final.
 *   - **Asimetría persistencia**: criterios captados se persisten en blur
 *     directo via `_gestionSetCriterio` (escribe DEMO al momento);
 *     overrides cal final esperan flush manual. Decisión histórica.
 *   - **Crea entry mínimo si missing** — defensive para drift seed.
 *   - **Exportado en window** (onclick inline botón).
 *   - Función IMPURA (DEMO mutation + toast).
 *   - Deuda post-Supabase: transaction batch UPDATE con optimistic UI.
 */
function guardarCalificaciones() {
  // Persistir los overrides manuales (calFinalOverride por parcial) que
  // _gestionSetOverride dejó en memoria sobre cada alumno.progresoEscala[N].
  // Escribe de vuelta a DEMO_PROGRESO_ESCALA usando la misma key
  // ${uid}_${materiaId}_${grupoId}_${parcialNum} que usa la lectura.
  if (typeof DEMO_PROGRESO_ESCALA !== "object" || !DEMO_PROGRESO_ESCALA) {
    showToast("No se pudo persistir (DEMO_PROGRESO_ESCALA no disponible)", "error");
    return;
  }
  let n = 0;
  _gestionData.alumnos.forEach(a => {
    const uid = a.uid || a.id;
    const obj = a.progresoEscala || {};
    Object.keys(obj).forEach(parcKey => {
      const parcN = Number(parcKey);
      const p = obj[parcKey];
      if (!p || p.calFinalOverride == null) return;
      const key = `${uid}_${a.materia}_${a.grupo}_${parcN}`;
      DEMO_PROGRESO_ESCALA[key] = DEMO_PROGRESO_ESCALA[key] || {
        uid,
        escalaId:    (typeof escalaId === "function") ? escalaId(a.materia, a.grupo, parcN) : `${a.materia}_${a.grupo}_${parcN}`,
        materiaId:   a.materia,
        grupoId:     a.grupo,
        parcialNum:  parcN,
        criterios:   [],
        calFinal:    p.calFinal != null ? p.calFinal : null,
        calFinalOverride: null,
      };
      DEMO_PROGRESO_ESCALA[key].calFinalOverride = p.calFinalOverride;
      n++;
    });
  });
  showToast(
    n === 0 ? "No hay cambios pendientes de guardar"
            : `Calificaciones guardadas (${n} override${n !== 1 ? "s" : ""} aplicado${n !== 1 ? "s" : ""})`,
    n === 0 ? "info" : "success",
  );
}

// ── Exportar ──────────────────────────────────────────────────────────────────
/**
 * @interaction exports-placeholders
 * @scope profesor-gestion-handlers-export-stub
 *
 * Given user click botones "Exportar CSV/PDF" o "Enviar reporte" en header.
 * When click dispara.
 * Then 3 handlers PLACEHOLDER (fake exports):
 *   - `exportarCSV()`: toast "Generando..." + setTimeout 1400ms → toast
 *     "reporte_grupo_abr2026.csv descargado".
 *   - `exportarPDF()`: toast "Generando PDF..." + setTimeout 1800ms →
 *     "PDF listo en tu carpeta de descargas".
 *   - `enviarReporte()`: toast "Enviando..." + setTimeout 1200ms →
 *     "Reporte enviado a profesor@utc.mx".
 * Edge:
 *   - **TODOS son placeholders DEMO** — ningún download / mail real ocurre.
 *     UX simula latencia con setTimeout para que el toast feel realista.
 *   - **Hardcoded `reporte_grupo_abr2026.csv` y `profesor@utc.mx`** —
 *     flavor text que no refleja contexto real.
 *   - Exportados en window (onclick inline).
 *   - Funciones IMPURAS (toasts).
 *   - Deuda post-Supabase: implementar real:
 *     - CSV: Server Action en Next.js + stream download.
 *     - PDF: PDFKit o react-pdf + Storage upload.
 *     - Reporte mail: Edge Function + email service.
 */
function exportarCSV() {
  showToast("Generando CSV del grupo...", "info");
  setTimeout(() => showToast("reporte_grupo_abr2026.csv descargado", "success"), 1400);
}
function exportarPDF() {
  showToast("Generando PDF con gráficas...", "info");
  setTimeout(() => showToast("PDF listo en tu carpeta de descargas", "success"), 1800);
}
function enviarReporte() {
  showToast("Enviando reporte a tu correo...", "info");
  setTimeout(() => showToast("Reporte enviado a profesor@utc.mx", "success"), 1200);
}

// ── Modal: Enviar alerta al alumno ────────────────────────────────────────────
let _alertaAlumnoId = null;

/**
 * @interaction abrir-alerta-alumno
 * @scope profesor-gestion-modal-alerta
 *
 * Given cardId del alumno (key compuesta `${estId}_${matId}`).
 * When user click "⚠ Enviar alerta" en card mini-perfil.
 * Then:
 *   1. Setea `_alertaAlumnoId = cardId` (state pendiente para enviar).
 *   2. Lookup alumno; sin → no-op.
 *   3. Setea nombre alumno en modal.
 *   4. Reset textarea mensaje.
 *   5. Activa default tipo "academica" (primer `.alerta-tipo-option`).
 *   6. Abre modal `modal-alerta-alumno`.
 * Edge:
 *   - **3 tipos alerta**: academica / recordatorio / comentario. Selection
 *     via radio buttons con `.alerta-tipo-option` labels.
 *   - Sin first option → `if (first)` defensive (modal sin opciones es bug
 *     pero no crash).
 *   - **Exportado en window** (onclick inline botón card).
 *   - Función IMPURA (state + DOM + abre modal).
 */
function abrirAlertaAlumno(cardId) {
  _alertaAlumnoId = cardId;
  const a = _gestionData.alumnos.find((x) => x.cardId === cardId);
  if (!a) return;
  document.getElementById("alerta-alumno-nombre").textContent = a.nombre;
  document.getElementById("alerta-mensaje").value = "";
  document.querySelectorAll(".alerta-tipo-option").forEach((o) => o.classList.remove("active"));
  const first = document.querySelector(".alerta-tipo-option");
  if (first) { first.classList.add("active"); first.querySelector("input").checked = true; }
  openModal("modal-alerta-alumno");
}

/**
 * @interaction seleccionar-tipo-alerta
 * @scope profesor-gestion-modal-alerta
 *
 * Given label `.alerta-tipo-option` clickeado + tipo (no usado).
 * When user click una de las 3 opciones radio.
 * Then:
 *   1. Deselect siblings (`active` remove).
 *   2. Add active al label clickeado.
 *   3. Check el `<input>` interno del label.
 * Edge:
 *   - **`tipo` arg NO usado** — caller pasa pero la fn lee el `<input>`
 *     interno del label. Deuda menor: removible.
 *   - **`querySelector("input")` asume primer input en label** — convención
 *     cementada del markup del modal.
 *   - Exportado en window (onclick inline).
 *   - Función IMPURA (DOM).
 */
function seleccionarTipoAlerta(label, tipo) {
  document.querySelectorAll(".alerta-tipo-option").forEach((o) => o.classList.remove("active"));
  label.classList.add("active");
  label.querySelector("input").checked = true;
}

/**
 * @interaction enviar-alerta-alumno
 * @scope profesor-gestion-modal-alerta-submit
 *
 * Given user en modal-alerta-alumno tras `abrirAlertaAlumno` + tipo
 *   seleccionado + mensaje opcional.
 * When user click "Enviar" del modal.
 * Then:
 *   1. Lookup alumno por `_alertaAlumnoId`.
 *   2. Lee tipo del radio checked; fallback "academica".
 *   3. **`tipoLabels` map**: 3 strings localizados.
 *   4. closeModal + toast success con tipo + nombre alumno.
 * Edge:
 *   - **Alerta NO se persiste** — solo toast cosmético. Decisión DEMO:
 *     simula UX sin sistema de mensajería real.
 *   - Sin alumno → toast con "alumno" generic fallback.
 *   - **Asimetría con `confirmarOverrideCal`** que SÍ persiste via
 *     `agregarNotificacion`. Decisión: override notifica al alumno (necesario
 *     para transparency); alerta es comunicación profesor→profesor (log
 *     simulado).
 *   - **Exportado en window** (onclick inline submit modal).
 *   - Función IMPURA (DOM + toast).
 *   - Deuda post-Supabase: tabla `alertas_profesor` + integración con
 *     notificaciones canonical del alumno.
 */
function enviarAlertaAlumno() {
  const a    = _gestionData.alumnos.find((x) => x.cardId === _alertaAlumnoId);
  const tipo = document.querySelector('input[name="alerta-tipo"]:checked')?.value || "academica";
  const tipoLabels = { academica: "Alerta académica", recordatorio: "Recordatorio de tarea", comentario: "Comentario" };
  closeModal("modal-alerta-alumno");
  showToast(`${tipoLabels[tipo]} enviada a ${a?.nombre || "alumno"}`, "success");
}

// ═══════════════════════════════════════════════════════════
// C9 · Trasplante a hub-materia profesor
// gestionRender(panelId, matId, grupoActivo) inyecta lazy el markup
// de views/profesor/gestion.html en el panel del hub-materia y llama
// a buildGestionAcademica() para init. Llamado desde
// profHubMatSwitchTab cuando el tab 'gestion' está activo.
//
// Deuda C9: el filtro a (matId, grupoActivo) NO se aplica todavía.
// La vista muestra el grid completo de materias del profesor; el
// usuario re-selecciona la materia activa dentro de gestion. Refactor
// de pre-filtrado es deuda separada (requiere exponer _unifiedFiltro
// + setter público + re-render desde firma del trasplante).
// ═══════════════════════════════════════════════════════════

/**
 * @interaction gestion-render
 * @scope profesor-gestion-entry-hub-c9
 *
 * Given panelId del tab Gestión del hub-materia + matId + grupoActivo.
 * When `_profMatDispatchTabRender("gestion", ...)` lo invoca al switch del tab.
 * Then async pipeline:
 *   1. Resuelve panel. Sin → no-op.
 *   2. **Hardening dual-paint** (asistencia bug #7 pattern): chequea
 *      `#prof-mat-cards` en panel.
 *   3. Lazy fetch `views/profesor/gestion.html`:
 *      - HTTP error → console.error + x-empty fallback.
 *      - Success → innerHTML + hide redundancias:
 *        - `.x-page-head` (header standalone).
 *        - `#prof-mat-cards` (mat cards picker — el hub-materia ya da contexto).
 *   4. **Pre-filter (cierra deuda C9)**: setea `_unifiedFiltro = matId`
 *      y `_gestionGrupoFiltro = grupoActivo` ANTES de build (evita parpadeo).
 *   5. `buildGestionAcademica()`.
 *   6. Sync visual tabs "Todos/En riesgo" via `_gestionUpdateTabsActive`.
 * Edge:
 *   - **Pre-filter C9 cerrado**: matId + grupoActivo ambos aplicados (unlike
 *     `tareasProfRender` que solo aplica matId al filtro de materia).
 *   - **Hide mat cards picker dentro hub** — UX: el hub ya define materia,
 *     mostrar picker es redundante + confusa. Asimetría con escalaRender
 *     que también hide picker.
 *   - **Exportado en window** (consumer cross-archivo
 *     `_profMatDispatchTabRender`).
 *   - Función IMPURA (DOM + fetch + state).
 *   - Deuda post-Supabase: SSR + reactive query con filtros como URL params.
 */
async function gestionRender(panelId, matId, grupoActivo) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  // Hardening 2026-05-24 (slice panel-injection): usar presencia del markup
  // canónico (#prof-mat-cards) en lugar de un flag module-scope. Cubre
  // recovery tras placeholder de parcial futuro. Patrón asistencia bug #7
  // (commit 646e3ae).
  if (!panel.querySelector("#prof-mat-cards")) {
    try {
      const res = await fetch("views/profesor/gestion.html");
      if (!res.ok) throw new Error("status " + res.status);
      panel.innerHTML = await res.text();

      // Ocultar redundancias dentro del hub-materia.
      const pageHead = panel.querySelector(".x-page-head");
      if (pageHead) pageHead.style.display = "none";
      const matCards = panel.querySelector("#prof-mat-cards");
      if (matCards) matCards.style.display = "none";
    } catch (err) {
      console.error("[gestionRender] no se pudo cargar gestion.html:", err);
      panel.innerHTML = '<div class="x-empty"><div class="x-empty__title">No se pudo cargar gestión</div></div>';
      return;
    }
  }
  // C9: aplicar filtros (materia + grupo) ANTES de buildGestionAcademica
  // para que el primer render ya esté filtrado y no parpadee.
  // _unifiedFiltro filtra por materia; _gestionGrupoFiltro por grupo
  // activo (mecánica nueva, ver _buildMiniPerfilGrid).
  if (matId) _unifiedFiltro = matId;
  if (grupoActivo) _gestionGrupoFiltro = grupoActivo;
  buildGestionAcademica();
  // Sincronizar visual de tabs "Todos / En riesgo" (no aplica al filtro
  // de materia pero limpia el estado activo de las tabs).
  if (typeof _gestionUpdateTabsActive === "function") _gestionUpdateTabsActive();
}
window.gestionRender = gestionRender;

/**
 * @interaction gestion-reset-grupo-filtro
 * @scope profesor-gestion-handler-reset
 *
 * Given user action no especificada (DEAD CODE en C9 actual).
 * When manualmente invocado (no hay caller cementado en UI).
 * Then setea `_gestionGrupoFiltro = null` + repaint grid (vuelve a "todos
 *   los grupos" vista standalone legacy).
 * Edge:
 *   - **DEAD CODE C9-leftover**: queda registrado en window para casos de
 *     uso futuro o consola dev. Comentario inline lo explicita: "No se usa
 *     en C9 pero queda registrado".
 *   - **Exportado en window** (defensive para debugger).
 *   - Función IMPURA (state + DOM).
 *   - Deuda post-Supabase: probable remove en cleanup TS+Next.
 */
function _gestionResetGrupoFiltro() {
  _gestionGrupoFiltro = null;
  if (typeof _buildMiniPerfilGrid === "function") _buildMiniPerfilGrid();
}
window._gestionResetGrupoFiltro = _gestionResetGrupoFiltro;
