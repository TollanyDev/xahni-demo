// js/profesor/tareas.js
// Vista "Tareas" del profesor

const TP_TIPOS = ["Proyecto","Práctica","Quiz","Ensayo","Ejercicio","Examen"];
const _tpTipoAbrev = { Proyecto:"PRJ", Práctica:"PRC", Quiz:"QZ", Ensayo:"ENS", Ejercicio:"EJC", Examen:"EXM" };

/**
 * @interaction tp-progress-ring
 * @scope profesor-tareas-helper-render
 *
 * Given pct (0-100) + color (CSS var or hex).
 * When `_tpBuildList` muestra el progreso de entregas por tarea (ring 34x34
 *   junto al timer urgencia).
 * Then SVG con 2 círculos concéntricos:
 *   1. Background ring (var(--surface-3), stroke-width 2.5).
 *   2. Progress ring (color, dash-array circ, dash-offset `circ - (pct/100)*circ`).
 *   3. Texto pct% centrado (var(--text-muted), 7.5px mono).
 *   4. Transform rotate(-90) para que el progreso empiece arriba.
 *   5. Transition 0.5s ease en stroke-dashoffset (animación al re-render).
 * Edge:
 *   - pct fuera de [0, 100] → offset negativo o > circ; visualmente el ring
 *     se ve "vacío" o "completo" según overflow. Caller responsable de cap.
 *   - **`toFixed(2)` + unary `+`** convierte string a number — defensive
 *     contra precision floats.
 *   - Función PURA (retorna string HTML).
 *   - Helper LOCAL.
 *   - **Twin estructural** con progress rings de gestión (mini-perfil grid).
 *     Deuda consolidación: `_renderProgressRing` shared canonical futuro.
 */
function _tpProgressRing(pct, color) {
  const r = 13;
  const circ = +(2 * Math.PI * r).toFixed(2);
  const offset = +(circ - (pct / 100) * circ).toFixed(2);
  return `<svg width="34" height="34" viewBox="0 0 34 34" style="flex-shrink:0;display:block">
    <circle cx="17" cy="17" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="2.5"/>
    <circle cx="17" cy="17" r="${r}" fill="none" stroke="${color}" stroke-width="2.5"
      stroke-dasharray="${circ}" stroke-dashoffset="${offset}" stroke-linecap="round"
      transform="rotate(-90 17 17)" style="transition:stroke-dashoffset .5s ease"/>
    <text x="17" y="17.5" text-anchor="middle" dominant-baseline="middle"
      font-size="7.5" fill="var(--text-muted)" font-family="Space Mono,monospace">${pct}%</text>
  </svg>`;
}

// ── Session state ─────────────────────────────────────────────────────────────
let TP_TAREAS  = [];
let _tpUserId  = null;
const _tpEntregasCache = {};

let _tpFiltroMat    = "todas";
let _tpFiltroEstado = "todas";
let _tpFiltroGrupo  = null;   // null = sin filtro de grupo (cerrar deuda C9)
let _tpBusqueda     = "";
let _tpEditId       = null;
let _tpEliminarId   = null;
let _tpCerrarId     = null;
let _tpResolviendoTareaId    = null;
let _tpResolviendoProrrogaId = null;

// ── Data provider ─────────────────────────────────────────────────────────────
/**
 * @interaction tp-infer-tipo
 * @scope profesor-tareas-data-provider
 *
 * Given titulo string (de DEMO_TAREAS o entrada usuario).
 * When `_tpFromDemo` necesita derivar tipo categorizado para mostrar abrev
 *   + chip + filtros (DEMO_TAREAS no tiene campo tipo).
 * Then lowercase + ramas keyword priority:
 *   1. "quiz" → "Quiz".
 *   2. "proyecto" | "final" → "Proyecto".
 *   3. "práctica" | "practica" (sin tilde) | "configuración" | "interactividad"
 *      | "landing" → "Práctica".
 *   4. "ensayo" | "essay" | "technical" → "Ensayo".
 *   5. "examen" → "Examen".
 *   6. Fallback "Ejercicio".
 * Edge:
 *   - **Orden importa**: "proyecto final" matchea "Proyecto" antes que "final"
 *     (no aplica fallback). "ensayo técnico final" matchea "Proyecto" (final
 *     primero); divergencia inadvertida pero aceptable.
 *   - Keywords agregadas ad-hoc (interactividad/landing/configuración) son
 *     legacy del seed inicial DEMO. Deuda: campo `tipo` explícito post-Supabase.
 *   - Función PURA.
 *   - Helper LOCAL.
 *   - **NO normaliza acentos** — "práctica" sí matchea, "PRACTICA"
 *     uppercase NO (porque `.toLowerCase()` no toca acentos pero el
 *     campo legacy podría tener "PRACTICA" sin tilde).
 */
function _tpInferTipo(titulo) {
  const t = titulo.toLowerCase();
  if (t.includes("quiz"))                            return "Quiz";
  if (t.includes("proyecto") || t.includes("final")) return "Proyecto";
  if (t.includes("práctica") || t.includes("practica") || t.includes("configuración") || t.includes("interactividad") || t.includes("landing")) return "Práctica";
  if (t.includes("ensayo") || t.includes("essay") || t.includes("technical")) return "Ensayo";
  if (t.includes("examen"))                          return "Examen";
  return "Ejercicio";
}

/**
 * @interaction tp-from-demo
 * @scope profesor-tareas-data-provider
 *
 * Given una tarea DEMO_TAREAS raw (campos {id, titulo, materiaId, grupoId,
 *   profesorId, fechaEntrega, entregas[], prorrogas[]}).
 * When `_tpInitFromDemo` mapea cada tarea del profesor a su shape UI.
 * Then construye objeto UI con:
 *   - id, titulo, materia (renamed from materiaId), grupoId, tipo derivado.
 *   - puntos: 0 (DEMO no tiene; usuario asigna al editar).
 *   - fechaCreacion: "" (DEMO no tiene).
 *   - fechaEntrega: slice 10 chars (YYYY-MM-DD; corta ISO completo).
 *   - instrucciones: "" (DEMO no tiene; usuario asigna al editar).
 *   - **estado**: derivado de fecha:
 *     - vencida (fechaDate < now) → "cerrada" SIEMPRE (sea o no haya entregas).
 *     - vigente → "publicada".
 *   - archivos: [].
 *   - _entregas: alias del raw entregas[] (consumed por `_tpMakeEntrega`).
 *   - prorrogas: raw o [].
 * Edge:
 *   - Sin fechaEntrega → fechaDate null → estado "publicada" (no vencida).
 *   - **`estado = vencida ? "cerrada" : "publicada"` SIN borrador** — DEMO
 *     no tiene "borrador". Borradores solo se crean en runtime via
 *     `_tpGuardarTarea(false)`. Cementa la asimetría: persistencia DEMO
 *     = solo publicadas/cerradas históricas.
 *   - **Doble rama vencida `"cerrada" : "cerrada"`** redundante — herencia
 *     histórica de un branch que esperaba diferenciar "cerrada con entregas"
 *     vs "cerrada sin entregas"; ya no aplica. Deuda menor: simplificar.
 *   - `materia` renamed from `materiaId` para shape UI consistency con
 *     legacy. `_tpEstaCerrada` re-adapta a `materiaId` para shared helper.
 *   - Función PURA.
 *   - Helper LOCAL.
 *   - Deuda post-Supabase: query directa de `tareas` con vista materializada
 *     que ya tenga estado computed.
 */
function _tpFromDemo(t) {
  const fechaDate  = t.fechaEntrega ? new Date(t.fechaEntrega) : null;
  const vencida    = fechaDate && fechaDate < new Date();
  const estado     = vencida
    ? ((t.entregas || []).length > 0 ? "cerrada" : "cerrada")
    : "publicada";
  return {
    id:           t.id,
    titulo:       t.titulo,
    materia:      t.materiaId,
    grupoId:      t.grupoId,
    tipo:         _tpInferTipo(t.titulo),
    puntos:       0,
    fechaCreacion: "",
    fechaEntrega: t.fechaEntrega ? t.fechaEntrega.slice(0, 10) : "",
    instrucciones: "",
    estado,
    archivos:     [],
    _entregas:    t.entregas || [],
    prorrogas:    t.prorrogas || [],
  };
}

/**
 * @interaction tp-init-from-demo
 * @scope profesor-tareas-data-init
 *
 * Given uid del profesor logueado.
 * When `buildTareasProfesor` detecta change-of-user (`_tpUserId !== APP.user.id`).
 * Then:
 *   1. Setea `_tpUserId = uid` (idempotency guard).
 *   2. Hidrata `TP_TAREAS = DEMO_TAREAS.filter(profesorId).map(_tpFromDemo)`.
 *   3. Clear `_tpEntregasCache` (memoización por tareaId — invalidate completo
 *      al cambiar user).
 * Edge:
 *   - **Reset NO-idempotente respecto a `TP_TAREAS`**: subsecuentes calls
 *     con MISMO uid son skipped por el caller (`buildTareasProfesor` chequea
 *     `_tpUserId !== uid`). Esto preserva ediciones in-memory de la sesión
 *     (borradores creados, tareas eliminadas) hasta logout.
 *   - **Asimetría con `_recData` sync (recursos.js)**: recursos PRESERVA
 *     ediciones via diff incremental por id; este NO — re-init total.
 *     Decisión histórica: el flujo CRUD de tareas se hace inline-update
 *     (Object.assign en edit, splice en delete) sin re-init.
 *   - DEMO_TAREAS no cargado → `TP_TAREAS = []`.
 *   - Helper LOCAL.
 *   - Función IMPURA (muta module-scope + cache).
 *   - Deuda post-Supabase: subscription reactiva a `tareas` con cache TanStack.
 */
function _tpInitFromDemo(uid) {
  _tpUserId = uid;
  TP_TAREAS = (DEMO_TAREAS || []).filter((t) => t.profesorId === uid).map(_tpFromDemo);
  Object.keys(_tpEntregasCache).forEach((k) => delete _tpEntregasCache[k]);
}

// ── Entregas desde datos reales ───────────────────────────────────────────────
const _TP_AV_PAL = ["teal","amber","blue","purple","green","red","cyan"];

/**
 * @interaction tp-make-entrega
 * @scope profesor-tareas-data-entrega
 *
 * Given estId (uid alumno) + idx (rank en lista) + tarea (shape UI con `_entregas`).
 * When `_tpBuildEntregas` itera miembros del grupo y construye 1 entry por alumno.
 * Then objeto entrega UI con:
 *   - alumnoId, nombre (resuelto DEMO_USERS), ini (iniciales o slice nombre).
 *   - color: rotación 7-paleta `_TP_AV_PAL` por idx.
 *   - grupo: grupoId de la tarea.
 *   - entregado: bool si entrega existe en `tarea._entregas`.
 *   - calificacion: la nota de la entrega o null.
 *   - fechaEntrega: ISO slice 10 o null.
 *   - comentario: `_tpRandomComment(cal)` si calificacion no-null, else null.
 * Edge:
 *   - Alumno no en DEMO_USERS → nombre/ini fallback a estId / slice(0,2).
 *   - Sin entrega para ese uid → entregado=false, cal=null, fecha=null.
 *   - **idx rotación**: 7 colores `teal/amber/blue/purple/green/red/cyan`.
 *     Determinista por orden de iteración en `_tpBuildEntregas` (orden de
 *     `grupo.miembros[]`).
 *   - **Comentario `_tpRandomComment` NO es random** — es determinista por
 *     bracket de calificación. Nombre legacy.
 *   - Función PURA respecto a inputs.
 *   - Helper LOCAL.
 */
function _tpMakeEntrega(estId, idx, tarea) {
  const est     = (DEMO_USERS || []).find((u) => u.id === estId);
  const entrega = (tarea._entregas || []).find((e) => e.uid === estId);
  return {
    alumnoId:    estId,
    nombre:      est?.nombre    || estId,
    ini:         est?.iniciales || estId.slice(0, 2).toUpperCase(),
    color:       _TP_AV_PAL[idx % _TP_AV_PAL.length],
    grupo:       tarea.grupoId || "",
    entregado:   !!entrega,
    calificacion: entrega?.calificacion ?? null,
    fechaEntrega: entrega?.fecha ? entrega.fecha.slice(0, 10) : null,
    comentario:   entrega?.calificacion != null ? _tpRandomComment(entrega.calificacion) : null,
  };
}

/**
 * @interaction tp-build-entregas
 * @scope profesor-tareas-data-entrega
 *
 * Given tarea (shape UI con `grupoId` opcional + `materia` id).
 * When `_tpGetEntregas` necesita construir el array completo de entregas
 *   por primera vez (caché miss).
 * Then bifurcación por scope de la tarea:
 *   1. **Tarea con grupoId**: lookup grupo en DEMO_GRUPOS → map miembros
 *      a entregas via `_tpMakeEntrega`.
 *   2. **Tarea sin grupoId** (legacy "todos los grupos de la materia"):
 *      - Lookup materia en DEMO_MATERIAS.
 *      - Itera m.grupos[], resuelve cada grupo, agrega miembros únicos
 *        (Set para dedupe — un alumno puede estar en varios grupos).
 *      - idx incremental (result.length) preserva uniqueness en paleta colores.
 * Edge:
 *   - Sin grupoId + sin materia → `[]` defensive.
 *   - Grupo no en DEMO_GRUPOS → miembros vacío → entry vacía.
 *   - **Set para dedupe** crítico para grupos compartidos — sin esto el
 *     mismo alumno aparecería N veces si está en N grupos de la materia.
 *   - `result.length` como idx en ramas dedupe garantiza colores únicos
 *     incluso si grupos se procesan en orden no-determinista.
 *   - Función PURA respecto a inputs.
 *   - Helper LOCAL.
 */
function _tpBuildEntregas(tarea) {
  if (tarea.grupoId) {
    const grupo = (DEMO_GRUPOS || []).find((g) => g.id === tarea.grupoId);
    return (grupo?.miembros || []).map((estId, idx) => _tpMakeEntrega(estId, idx, tarea));
  }
  // Nueva tarea sin grupoId: todos los alumnos de la materia
  const mat  = (DEMO_MATERIAS || []).find((m) => m.id === tarea.materia);
  if (!mat) return [];
  const seen = new Set();
  const result = [];
  (mat.grupos || []).forEach((gid) => {
    const g = (DEMO_GRUPOS || []).find((g) => g.id === gid);
    (g?.miembros || []).forEach((estId) => {
      if (!seen.has(estId)) {
        seen.add(estId);
        result.push(_tpMakeEntrega(estId, result.length, tarea));
      }
    });
  });
  return result;
}

/**
 * @interaction tp-random-comment
 * @scope profesor-tareas-helper-comment
 *
 * Given calificación numérica (0-10).
 * When `_tpMakeEntrega` / `_tpConfirmarCal` necesitan un comentario
 *   automático asociado a la nota.
 * Then 4 ramas determinísticas:
 *   - ≥9 → "Excelente trabajo."
 *   - ≥7 → "Buen trabajo, revisa las observaciones."
 *   - ≥6 → "Cumple pero puede mejorar."
 *   - else → "Necesita reforzar los conceptos."
 * Edge:
 *   - **Nombre legacy "random"**: NO es random, es determinista por bracket.
 *     Heredado de un branch que iteraba dentro del bracket; quedó el nombre.
 *   - cal < 0 → última rama. Caller responsabilidad de validar antes.
 *   - Función PURA.
 *   - Helper LOCAL.
 *   - Deuda post-Supabase: catálogo de comentarios personalizable por
 *     profesor + multilingüe.
 */
function _tpRandomComment(cal) {
  if (cal >= 9) return "Excelente trabajo.";
  if (cal >= 7) return "Buen trabajo, revisa las observaciones.";
  if (cal >= 6) return "Cumple pero puede mejorar.";
  return "Necesita reforzar los conceptos.";
}

/**
 * @interaction tp-get-entregas
 * @scope profesor-tareas-data-entrega-cache
 *
 * Given tarea (shape UI).
 * When `_tpBuildList` / `verDetalleTarea` / `_tpRenderAlumnos` / `_tpConfirmarCal`
 *   necesitan el array de entregas (potentially expensive build).
 * Then memoización por `tarea.id`:
 *   - Cache miss → `_tpBuildEntregas(tarea)` + cache.
 *   - Cache hit → retorna reference cached.
 * Edge:
 *   - **Cache invalidation manual**: callers responsables de
 *     `delete _tpEntregasCache[id]` tras mutations (publicar, cerrar,
 *     guardar, eliminar). Pattern cementado en cada handler.
 *   - **Reference-shared**: callers que mutan `e.calificacion` mutan la
 *     cached entry. `_tpConfirmarCal` aprovecha esto + repaint posterior.
 *   - Cache nunca se purga por edad — solo por user change (`_tpInitFromDemo`).
 *     Memory leak teórico en sesión muy larga; aceptable para volumen DEMO.
 *   - Función IMPURA (muta cache).
 *   - Helper LOCAL.
 */
function _tpGetEntregas(tarea) {
  if (!_tpEntregasCache[tarea.id])
    _tpEntregasCache[tarea.id] = _tpBuildEntregas(tarea);
  return _tpEntregasCache[tarea.id];
}

// ── Helpers de materia ────────────────────────────────────────────────────────
const _TP_MAT_PAL = ["teal","amber","blue","purple","green","red"];

/**
 * @interaction tp-mat-color
 * @scope profesor-tareas-helper-paleta
 *
 * Given matId.
 * When `_tpBuildList` (stripe + tipo abrev + label color) / `verDetalleTarea`
 *   (mat badge) muestran la materia coloreada.
 * Then misma fórmula que `_recMatColor` y `_profMatColor`: findIndex →
 *   módulo 6 sobre `_TP_MAT_PAL` (teal/amber/blue/purple/green/red) → var
 *   directo o blue-light.
 * Edge:
 *   - matId no en DEMO_MATERIAS → idx=0 → teal default.
 *   - **Twin canonical cross-archivo**: misma paleta + misma asimetría
 *     blue → blue-light. 4to archivo del rol con este patrón (dashboard,
 *     recursos, tareas, escala). Deuda consolidación: `_xahniMatColor`
 *     shared helper post-Supabase.
 *   - Función PURA.
 *   - Helper LOCAL.
 */
function _tpMatColor(matId) {
  const idx  = (DEMO_MATERIAS || []).findIndex((m) => m.id === matId);
  const name = _TP_MAT_PAL[Math.max(0, idx) % _TP_MAT_PAL.length];
  return name === "blue" ? "var(--xahni-blue-light)" : `var(--xahni-${name})`;
}
/**
 * @interaction tp-mat-nombre
 * @scope profesor-tareas-helper-lookup
 *
 * Given matId.
 * When list/detail necesitan el nombre legible.
 * Then lookup en DEMO_MATERIAS, fallback al matId.
 * Edge:
 *   - Encadenamiento defensive `(... || {}).nombre || matId`.
 *   - Función PURA.
 *   - Helper LOCAL.
 *   - **Twin canonical** con `_recMatNombre`. Deuda consolidación.
 */
function _tpMatNombre(matId) {
  return ((DEMO_MATERIAS || []).find((m) => m.id === matId) || {}).nombre || matId;
}

// ── Entry point ───────────────────────────────────────────────────────────────
/**
 * @interaction build-tareas-profesor
 * @scope profesor-tareas-entrypoint
 *
 * Given APP.user activo tipo "profesor" + DOM con `#tp-metrics`/`#tp-filters`/
 *   `#tp-list` presentes.
 * When `tareasProfRender` lo invoca post-fetch, o handlers CRUD/filtros
 *   trigger repaint.
 * Then orquesta el render principal:
 *   1. **Hook `window._tareasFiltro`**: pre-filtro one-shot consumido al
 *      entrar desde Gestión (mini-perfil "Ver tareas"). Patron:
 *      - Lee el hook + delete window key inmediato (one-shot).
 *      - console.info para visibilidad dev.
 *      - Setea input DOM (`#tp-filtro-materia` o `#filtro-materia-tareas`)
 *        si presente.
 *      - Setea variable interna `_tpFiltroMat` (consumed por `_tpFiltered`).
 *   2. Guard tipo profesor → no-op.
 *   3. Init idempotente por uid (`_tpUserId !== APP.user.id` → re-hydrate).
 *   4. Sub-builds: metrics + filters + list + banner cerrado.
 * Edge:
 *   - **Hook one-shot**: si el render se interrumpe entre lectura y aplicación,
 *     el hook se pierde. Aceptable: solo se usa para navegación desde Gestión.
 *   - Hook tiene `materiaId` opcional; sin él no se aplica filtro.
 *   - **Init idempotente preserva ediciones de sesión** (CRUD inline-mutate
 *     en handlers; no re-init).
 *   - Cross-archivo deps: `_tpInitFromDemo` + 4 builders + adaptación shape
 *     en `_tpEstaCerrada`.
 *   - Función IMPURA (DOM + state).
 *   - Exportado implícito (no `window.` pero consumed cross-archivo).
 */
function buildTareasProfesor() {
    // Hook: filtro pre-aplicado al llegar desde Gestión (mini-perfil "Ver tareas").
    // Se consume una vez y se borra para que no quede pegado.
    const _filtroPrev = window._tareasFiltro;
    if (_filtroPrev) {
        delete window._tareasFiltro;
        // Si el builder usa un filtro local (input #tp-filtro-mat, variable _tpFiltroMat,
        // etc.), aplicarlo aquí. Si no es posible sin refactor mayor, dejarlo anotado:
        // por ahora simplemente exponemos el filtro para que la próxima fase de migración
        // de tareas-prof lo consuma. Console.info para visibilidad en dev.
        if (typeof console !== "undefined") console.info("[tareas-prof] filtro pre-aplicado:", _filtroPrev);
        // Si existe un input/select de filtro por materia con id conocido, intentar setearlo:
        const inputMat = document.getElementById("tp-filtro-materia") || document.getElementById("filtro-materia-tareas");
        if (inputMat && _filtroPrev.materiaId) {
            inputMat.value = _filtroPrev.materiaId;
        }
        // Adicionalmente seteamos la variable interna que sí consume _tpFiltered(),
        // para que el filtro tome efecto sin importar si el DOM existe aún:
        if (_filtroPrev.materiaId && typeof _tpFiltroMat !== "undefined") {
            _tpFiltroMat = _filtroPrev.materiaId;
        }
    }
  if (!APP.user || APP.user.tipo !== "profesor") return;
  if (_tpUserId !== APP.user.id) _tpInitFromDemo(APP.user.id);
  _tpBuildMetrics();
  _tpBuildFilters();
  _tpBuildList();
  _tpBuildBannerCerrado();
}

// Slice cerrar-parcial-integracion 2026-05-24: banner que aparece sobre la
// lista si hay tareas del parcial activo cerrado en el contexto actual del
// hub-materia. Se inyecta como sibling antes de #tp-list. Si ya existe, se
// limpia y re-crea para reflejar cambios.
/**
 * @interaction tp-build-banner-cerrado
 * @scope profesor-tareas-banner-cerrado
 *
 * Given DOM con `#tp-list` montado + contexto hub-materia (`APP.profHubMatActivo`).
 * When `buildTareasProfesor` orquesta o listener `parcialCerradoCambio`
 *   trigger re-paint.
 * Then resolución cascada:
 *   1. Sin #tp-list → no-op.
 *   2. Remueve banner previo `#tp-banner-cerrado` si existe.
 *   3. `isParcialCerrado` ausente → no-op (helper shared no cargado).
 *   4. Sin contexto hub-materia (vista standalone) → no-op (banner solo en hub).
 *   5. Sin matId/grupoId → no-op.
 *   6. Resuelve parcial activo del header (`APP.profParcialActivo[gmKey]` o 1).
 *   7. Parcial NO cerrado → no-op (no aplica banner).
 *   8. Cuenta tareas afectadas (`_tpFiltered().filter(_tpEstaCerrada)`).
 *   9. Inyecta banner sibling antes de #tp-list con estilo inline (purple-dim
 *      + 🔒 + texto count + nota override Gestión).
 * Edge:
 *   - **Asimetría con asistencia banner**: este usa `_tpFiltered()` (filtrado
 *     activo) para contar; asistencia usa data sin filtrar. Decisión:
 *     tareas-banner refleja "lo que ves ahora", asistencia refleja "todas
 *     las sesiones del parcial".
 *   - Estilos INLINE — slice cerrar-parcial-integracion hecho antes de
 *     `.x-banner` canonical.
 *   - innerHTML directo con `parcial` (number safe); count `tareasDel.length`
 *     (number safe).
 *   - Helper LOCAL (sin window export).
 *   - Función IMPURA (DOM).
 */
function _tpBuildBannerCerrado() {
    const list = document.getElementById("tp-list");
    if (!list) return;
    // Limpiar banner previo
    const prev = document.getElementById("tp-banner-cerrado");
    if (prev) prev.remove();
    if (typeof isParcialCerrado !== "function") return;
    // Identificar parcial activo del hub-materia
    const hubCtx = APP.profHubMatActivo;
    if (!hubCtx) return;
    const { matId, grupoId } = hubCtx;
    if (!matId || !grupoId) return;
    const gmKey = `${matId}_${grupoId}`;
    const parcial = (APP.profParcialActivo && APP.profParcialActivo[gmKey]) || 1;
    if (!isParcialCerrado(matId, grupoId, parcial)) return;
    // Contar tareas afectadas: del parcial cerrado en el listado actual.
    const tareasDel = _tpFiltered().filter(t => _tpEstaCerrada(t));
    const banner = document.createElement("div");
    banner.id = "tp-banner-cerrado";
    banner.style.cssText = "margin-bottom:12px;padding:12px 14px;background:var(--xahni-purple-dim);border:1px solid var(--xahni-purple)44;border-radius:var(--r-md);display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text-primary)";
    banner.innerHTML = `<span style="font-size:16px">🔒</span>
        <span><strong>Parcial ${parcial} cerrado</strong> · capturas congeladas en ${tareasDel.length} tarea${tareasDel.length !== 1 ? "s" : ""} de este parcial. Editar/eliminar deshabilitados.
        <span style="color:var(--text-muted)">Usa "🔓 Reabrir" arriba para descongelar el parcial, o libera overrides por alumno desde Gestión.</span></span>`;
    list.parentNode.insertBefore(banner, list);
}

// Helper: ¿la tarea pertenece a un parcial cerrado?
// Reusa shared isTareaParcialCerrado con override de grupoId (tarea.grupoId
// ya está en el shape, así que el override es defensivo).
/**
 * @interaction tp-esta-cerrada
 * @scope profesor-tareas-helper-cerrada
 *
 * Given tarea (shape UI con `materia` campo).
 * When `_tpBuildList` decide pintar chip "Cerrada" o ocultar botones
 *   editar/eliminar; `eliminarTarea`/`editarTarea` guard defensivo;
 *   `_tpConfirmarCal` bloquea calificación inline.
 * Then:
 *   1. `isTareaParcialCerrado` ausente → false (defensa optimista).
 *   2. **Adapter de shape**: el shape UI de TP_TAREAS expone `materia` (id)
 *      mientras shared helper espera `materiaId`. Construye objeto adapter
 *      `{materiaId: tarea.materia || tarea.materiaId, grupoId, fechaEntrega}`.
 *   3. Llama shared con tareaShape + grupoId override defensivo.
 * Edge:
 *   - **Asimetría shape vivido en este wrapper**: la divergencia `materia`
 *     vs `materiaId` es legacy histórica (UI shape vs DB shape). Solución
 *     mínima es el adapter; refactor completo de TP_TAREAS a `materiaId`
 *     es deuda separada.
 *   - tarea sin materia/materiaId → adapter `materiaId: undefined` → helper
 *     shared retorna false (sin parcial resoluble).
 *   - Helper LOCAL.
 *   - Función PURA (no muta tarea ni globals).
 *   - Consumed 4 sites en este archivo + bypasses defensivos.
 */
function _tpEstaCerrada(tarea) {
    if (typeof isTareaParcialCerrado !== "function") return false;
    // El shape UI de TP_TAREAS expone `materia` (id) y `grupoId`. El helper
    // espera `materiaId`. Adaptar al consumir.
    const tareaShape = {
        materiaId:    tarea.materia || tarea.materiaId,
        grupoId:      tarea.grupoId,
        fechaEntrega: tarea.fechaEntrega,
    };
    return isTareaParcialCerrado(tareaShape, tarea.grupoId);
}

/**
 * @interaction tp-filtered
 * @scope profesor-tareas-data-filter
 *
 * Given `TP_TAREAS` hidratado + filtros activos (`_tpFiltroMat`,
 *   `_tpFiltroGrupo`, `_tpFiltroEstado`, `_tpBusqueda`).
 * When `_tpBuildList` necesita la lista visible; `_tpBuildBannerCerrado`
 *   cuenta tareas afectadas.
 * Then pipeline:
 *   1. mat (skip si "todas"): filter por `t.materia === _tpFiltroMat`.
 *   2. grupo (skip si null): filter por `t.grupoId === _tpFiltroGrupo`.
 *      `_tpFiltroGrupo === null` (no "todas") es el bypass — convención
 *      cementada.
 *   3. estado (skip si "todas"): filter por `t.estado === _tpFiltroEstado`.
 *   4. búsqueda (skip si vacío): lower-case includes en `titulo` o `tipo`.
 *   5. **Sort desc por fechaEntrega** (más reciente primero).
 * Edge:
 *   - **Asimetría bypass**: mat/estado usan "todas" string sentinel;
 *     grupo usa `null` sentinel. Decisión histórica: grupo se filtra solo
 *     en hub-materia (no en standalone), por eso null = "sin filtro".
 *   - Búsqueda case-insensitive en 2 campos (titulo + tipo). NO busca en
 *     instrucciones (decisión performance volumen DEMO).
 *   - Sort estable (V8 TimSort) — empates mantienen orden TP_TAREAS.
 *   - Función PURA respecto a inputs (filter+sort crean arrays nuevos).
 *   - Helper LOCAL.
 */
function _tpFiltered() {
  let data = TP_TAREAS;
  if (_tpFiltroMat !== "todas")    data = data.filter((t) => t.materia === _tpFiltroMat);
  if (_tpFiltroGrupo)              data = data.filter((t) => t.grupoId === _tpFiltroGrupo);
  if (_tpFiltroEstado !== "todas") data = data.filter((t) => t.estado  === _tpFiltroEstado);
  if (_tpBusqueda) {
    const q = _tpBusqueda.toLowerCase();
    data = data.filter((t) => t.titulo.toLowerCase().includes(q) || t.tipo.toLowerCase().includes(q));
  }
  return data.sort((a, b) => new Date(b.fechaEntrega) - new Date(a.fechaEntrega));
}

// ── Metrics ───────────────────────────────────────────────────────────────────
/**
 * @interaction tp-build-metrics
 * @scope profesor-tareas-render-kpis
 *
 * Given `TP_TAREAS` hidratado + DOM con `#tp-metrics`.
 * When `buildTareasProfesor` orquesta.
 * Then 4 KPIs `.metric-card` x-grid:
 *   1. Total (blue 📋) con delta "N tarea(s) asignada(s)".
 *   2. Activas (teal ▶) — `estado === "publicada"` con delta dinámica.
 *   3. Cerradas (purple ✓) — `estado === "cerrada"`.
 *   4. Borradores (amber ✎) — `estado === "borrador"`.
 * Edge:
 *   - DOM target ausente → no-op.
 *   - **Conteo sobre TP_TAREAS SIN filtrar** — KPIs globales, no
 *     respetan filtros activos. Decisión consciente: el profesor quiere
 *     contexto global mientras filtra para encontrar algo específico.
 *   - **No incluye `_tpEstaCerrada` chequeo** — el "cerrada" KPI es por
 *     estado del shape UI (cerrada explícita), no por parcial cerrado.
 *     Las tareas de parcial cerrado SIGUEN apareciendo en "Activas" si
 *     su shape.estado=publicada. Asimetría sutil pero deliberada.
 *   - Función IMPURA (DOM).
 *   - Helper LOCAL.
 */
function _tpBuildMetrics() {
  const el = document.getElementById("tp-metrics");
  if (!el) return;
  const tareas    = TP_TAREAS || [];
  const total     = tareas.length;
  const activas   = tareas.filter((t) => t.estado === "publicada").length;
  const cerradas  = tareas.filter((t) => t.estado === "cerrada").length;
  const borradores = tareas.filter((t) => t.estado === "borrador").length;
  const kpis = [
    { cls: "blue",   icon: "📋", num: total,       lbl: "Total",      delta: `${total === 1 ? "tarea" : "tareas"} asignadas` },
    { cls: "teal",   icon: "▶",  num: activas,     lbl: "Activas",    delta: activas === 0 ? "Sin tareas en curso" : `${activas} en curso` },
    { cls: "purple", icon: "✓",  num: cerradas,    lbl: "Cerradas",   delta: cerradas === 0 ? "Ninguna cerrada" : `${cerradas} calificada${cerradas !== 1 ? "s" : ""}` },
    { cls: "amber",  icon: "✎",  num: borradores,  lbl: "Borradores", delta: borradores === 0 ? "Sin borradores" : `${borradores} pendiente${borradores !== 1 ? "s" : ""}` },
  ];
  el.innerHTML = `<div class="x-grid">${kpis.map((k) => `
    <div class="metric-card ${k.cls}">
      <div class="metric-icon ${k.cls}">${k.icon}</div>
      <div class="metric-value">${k.num}</div>
      <div class="metric-label">${k.lbl}</div>
      <div class="metric-delta neutral">${k.delta}</div>
    </div>`).join("")}</div>`;
}

// ── Filters ───────────────────────────────────────────────────────────────────
/**
 * @interaction tp-build-filters
 * @scope profesor-tareas-render-filtros
 *
 * Given DOM con `#tp-filters` + APP.user.
 * When `buildTareasProfesor` orquesta o `_tpSetEstado` cambia filtro estado.
 * Then:
 *   - Tabs estado (4): Todas / Activas (teal dot) / Cerradas (purple) /
 *     Borradores (amber). `.is-active` sobre el filtro vigente.
 *   - Select materia: option "Todas" + N opciones por materia del prof.
 *     Selected si matches `_tpFiltroMat`.
 *   - Layout flex con tabs left + select right.
 * Edge:
 *   - DOM target ausente → no-op.
 *   - **Dots paleta posicional** alineada con metric-cards
 *     (teal=activas/pendientes, purple=cerradas/entregadas, amber=borradores/
 *     vencidas). Mantiene paralelo visual cross-vista alumno/profesor.
 *   - Select materia onchange dispara `_tpSetMat(this.value)` — handler
 *     setter solo, no _tpBuildFilters (evita re-render del select que
 *     perdería focus durante interacción).
 *   - `_tpEscHtml` en value/nombre de opciones.
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM).
 */
function _tpBuildFilters() {
  const el = document.getElementById("tp-filters");
  if (!el) return;
  const materias = (typeof DEMO_MATERIAS !== "undefined" && Array.isArray(DEMO_MATERIAS))
    ? DEMO_MATERIAS.filter((m) => m.profesorId === (APP.user && APP.user.id)) : [];
  // Dots con paleta posicional de las metric-cards de tareas (mismo orden y
  // colores que la vista de Tareas alumno): teal=activas/pendientes,
  // purple=cerradas/entregadas, amber=borradores/vencidas.
  const estados = [
    { id: "todas",     label: "Todas",      dot: "" },
    { id: "publicada", label: "Activas",    dot: "var(--xahni-teal)" },
    { id: "cerrada",   label: "Cerradas",   dot: "var(--xahni-purple)" },
    { id: "borrador",  label: "Borradores", dot: "var(--xahni-amber)" },
  ];
  const tabsHTML = estados.map((e) => {
    const active = _tpFiltroEstado === e.id ? " is-active" : "";
    const dot = e.dot ? `<span style="width:6px;height:6px;border-radius:50%;background:${e.dot};display:inline-block;margin-right:6px"></span>` : "";
    return `<button class="x-tabs__tab${active}" onclick="_tpSetEstado('${e.id}', this)">${dot}${e.label}</button>`;
  }).join("");
  const matOptions = `<option value="todas">Todas las materias</option>` +
    materias.map((m) => `<option value="${_tpEscHtml(m.id)}"${_tpFiltroMat === m.id ? " selected" : ""}>${_tpEscHtml(m.nombre)}</option>`).join("");
  el.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
    <div class="x-tabs">${tabsHTML}</div>
    <select id="tp-filtro-materia" onchange="_tpSetMat(this.value)"
            style="background:var(--surface-1);border:1px solid var(--border);border-radius:var(--r-md);padding:8px 12px;font-family:var(--font-sans);font-size:13px;color:var(--text-primary);cursor:pointer;outline:none;min-width:180px">
      ${matOptions}
    </select>
  </div>`;
}

/**
 * @interaction tp-filtros-handlers
 * @scope profesor-tareas-handlers-filtros
 *
 * Given click tab estado / change select materia / input search.
 * When user interactúa con filtros.
 * Then 3 handlers one-liners:
 *   - `_tpSetEstado(v, btn)`: setea estado + re-build tabs (mover is-active)
 *     + re-build list.
 *   - `_tpSetMat(v)`: setea materia + re-build SOLO list (skip filtros para
 *     preservar focus del select).
 *   - `buscarTareaProf(q)`: setea búsqueda + re-build SOLO list.
 * Edge:
 *   - **Asimetría re-build**: `_tpSetEstado` re-renderea tabs (porque cambia
 *     `is-active`), `_tpSetMat`/`buscarTareaProf` NO (porque cambia solo el
 *     dataset visible, no el control). Optimización UX.
 *   - btn arg solo usado por `_tpSetEstado`; los otros no lo aceptan.
 *   - `_tpFiltroEstado` enum: "todas" | "publicada" | "cerrada" | "borrador".
 *   - `_tpFiltroMat` valor "todas" o matId.
 *   - **`buscarTareaProf` SIN debounce** — keystroke triggea repaint. Aceptable
 *     volumen DEMO. Deuda post-Supabase: debounce ~200ms.
 *   - Exportados implícitamente: `_tpSetEstado` y `_tpSetMat` por onclick/
 *     onchange inline; `buscarTareaProf` por oninput externo.
 *   - Funciones IMPURAS (muta module-scope + DOM).
 */
function _tpSetEstado(v, btn) { _tpFiltroEstado = v; _tpBuildFilters(); _tpBuildList(); }
function _tpSetMat(v)         { _tpFiltroMat    = v; _tpBuildList(); }
function buscarTareaProf(q)   { _tpBusqueda     = q; _tpBuildList(); }

// ── Task List ─────────────────────────────────────────────────────────────────
/**
 * @interaction tp-build-list
 * @scope profesor-tareas-render-list
 *
 * Given `TP_TAREAS` hidratado + filtros + DOM con `#tp-list`.
 * When `buildTareasProfesor` orquesta o handlers CRUD/filtros invalidan
 *   datos.
 * Then renderer principal del módulo (~120 LOC):
 *   1. Empty state si `_tpFiltered()` vacío.
 *   2. Helpers locales inline `_diasRest` + `_fmtFechaCorta` (fecha humanizada
 *      con "T00:00:00" sufijo si solo YYYY-MM-DD).
 *   3. Por cada tarea:
 *      - **Stripe color** (4px) + tipo abreviado (`_tpTipoAbrev[tipo]` o
 *        slice 3 chars + uppercase).
 *      - **Progress ring** con pct = entregadas/total.
 *      - **Chip estado** con override: `_tpEstaCerrada(t)` fuerza "cerrada".
 *        Map publicada→ok, cerrada→info, borrador→warn.
 *      - **Timer urgencia**:
 *        - borrador → "Sin publicar" amber.
 *        - cerrada → "Entrega: fecha".
 *        - dias ≤ 0 → "⏱ 0d restantes" danger.
 *        - dias ≤ 2 → "⏱ Nd restantes" warn.
 *        - else → "Entrega: fecha".
 *      - **Botones** (action area, evento stopPropagation):
 *        - "Cerrar" si publicada Y NO parcial cerrado.
 *        - "Publicar" si borrador.
 *        - Editar + Eliminar iconos si NO parcial cerrado (oculto si sí).
 *      - **Chip prórrogas** si hay pendientes → `toggleProrrogasPanel(id)`.
 *      - **Sibling panel hidden** `#tp-prorrogas-{id}` solo si hay pendientes.
 *      - Card onclick `verDetalleTarea(id)`.
 * Edge:
 *   - **Compromiso visual cerrar-parcial-integracion**: chip único "Cerrada"
 *     reemplaza tanto estado=cerrada como parcial cerrado. Decisión tras
 *     remover chip duplicado "🔒 Cerrado" del slice original.
 *   - Botón "Cerrar" doblemente gateado (estado publicada + NO parcial
 *     cerrado) — semánticamente correcto (no permite cerrar lo ya cerrado).
 *   - **innerHTML masivo** con `_tpEscHtml` en strings dinámicos (titulo,
 *     mat nombre).
 *   - Apóstrofe en onclick `toggleProrrogasPanel('${t.id}')` — ids alfanum
 *     no rompen.
 *   - Function IMPURA (DOM masivo).
 *   - Helper LOCAL.
 *   - Renderer más grande del módulo.
 */
function _tpBuildList() {
  const el = document.getElementById("tp-list");
  if (!el) return;
  const tareas = _tpFiltered();
  if (!tareas.length) {
    el.innerHTML = `<div class="x-empty">
      <div class="x-empty__icon">📋</div>
      <div class="x-empty__title">Sin tareas con estos filtros</div>
      <div class="x-empty__desc">Cambia el estado/materia, o crea una nueva tarea.</div>
    </div>`;
    return;
  }
  const _diasRest = (fechaIso) => {
    if (!fechaIso) return null;
    const dt = new Date(fechaIso + (fechaIso.length === 10 ? "T00:00:00" : ""));
    if (isNaN(dt)) return null;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const d = new Date(dt); d.setHours(0, 0, 0, 0);
    return Math.round((d - hoy) / 86400000);
  };
  const _fmtFechaCorta = (iso) => {
    if (!iso) return "—";
    const dt = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
    if (isNaN(dt)) return iso || "—";
    const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    return `${String(dt.getDate()).padStart(2, "0")}-${meses[dt.getMonth()]}`;
  };
  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">${
    tareas.map((t) => {
      const stripeColor = (typeof _tpMatColor === "function") ? _tpMatColor(t.materia) : "var(--xahni-teal)";
      const matNombre   = (typeof _tpMatNombre === "function") ? _tpMatNombre(t.materia) : t.materia;
      const tipoAbrev   = (_tpTipoAbrev && _tpTipoAbrev[t.tipo]) || (t.tipo ? t.tipo.slice(0, 3).toUpperCase() : "TRE");
      const entregas    = (typeof _tpGetEntregas === "function") ? _tpGetEntregas(t) : (t.entregas || []);
      const totalAlum   = entregas.length || 0;
      const entregadas  = entregas.filter((e) => e && e.entregado).length;
      const calificadas = entregas.filter((e) => e && e.calificacion != null).length;
      const pct         = totalAlum ? Math.round((entregadas / totalAlum) * 100) : 0;
      const ring        = (typeof _tpProgressRing === "function")
        ? _tpProgressRing(pct, stripeColor) : `<span style="color:${stripeColor}">${pct}%</span>`;

      // Estado / chip — slice cerrar-parcial-integracion 2026-05-24:
      // reusa el chip "Cerrada" existente cuando la tarea pertenece a un
      // parcial cerrado. Antes había un chip paralelo "🔒 Cerrado" añadido
      // pero duplicaba visualmente con este; eliminado en favor de
      // override del estado al renderear.
      const estadoMap = {
        publicada: { cls: "x-chip--ok",   label: "Activa",   dot: "var(--state-ok)" },
        cerrada:   { cls: "x-chip--info", label: "Cerrada",  dot: "var(--xahni-purple)" },
        borrador:  { cls: "x-chip--warn", label: "Borrador", dot: "var(--state-warn)" },
      };
      const _estadoRender = _tpEstaCerrada(t) ? "cerrada" : t.estado;
      const est = estadoMap[_estadoRender] || estadoMap.publicada;

      // Timer / entrega
      let timerHTML = "";
      if (t.estado === "borrador") {
        timerHTML = `<span style="color:var(--state-warn);font-weight:600">Sin publicar</span>`;
      } else if (t.fechaEntrega) {
        const dias = _diasRest(t.fechaEntrega);
        if (t.estado === "cerrada") {
          timerHTML = `Entrega: <span style="color:var(--text-primary)">${_fmtFechaCorta(t.fechaEntrega)}</span>`;
        } else if (dias != null && dias <= 0) {
          timerHTML = `<span style="color:var(--state-danger);font-weight:700;display:inline-flex;align-items:center;gap:4px">⏱ 0d restantes</span>`;
        } else if (dias != null && dias <= 2) {
          timerHTML = `<span style="color:var(--state-warn);font-weight:700;display:inline-flex;align-items:center;gap:4px">⏱ ${dias}d restantes</span>`;
        } else {
          timerHTML = `Entrega: <span style="color:var(--text-primary)">${_fmtFechaCorta(t.fechaEntrega)}</span>`;
        }
      }

      // Botón "Cerrar" solo si está activa Y no pertenece a parcial cerrado
      // (slice cerrar-parcial-integracion 2026-05-24): si el parcial está
      // cerrado la card ya muestra el chip "Cerrada" — el botón sería
      // redundante y semánticamente incorrecto (cerrar lo ya cerrado).
      const cerrarBtn = (t.estado === "publicada" && !_tpEstaCerrada(t))
        ? `<button class="x-btn x-btn--ghost" style="padding:6px 12px;font-size:11px" onclick="event.stopPropagation();cerrarTarea('${t.id}')">Cerrar</button>` : "";
      const publicarBtn = t.estado === "borrador"
        ? `<button class="x-btn x-btn--ghost" style="padding:6px 12px;font-size:11px" onclick="event.stopPropagation();publicarTarea('${t.id}')">Publicar</button>` : "";

      // Chip de prórrogas pendientes (slice prórrogas 2026-05-24).
      // Click abre el panel desplegable inyectado como sibling del article.
      const pendientes = (t.prorrogas || []).filter(p => p.estado === "pendiente");
      const prorChip = pendientes.length > 0
        ? `<button class="x-chip x-chip--warn" style="border:none;cursor:pointer;font-size:11px;font-weight:600;padding:4px 10px" onclick="event.stopPropagation();toggleProrrogasPanel('${t.id}')" title="Solicitudes de prórroga pendientes">📅 ${pendientes.length} solicitud${pendientes.length !== 1 ? "es" : ""}</button>`
        : "";

      return `<article class="x-card" data-tarea-id="${t.id}" onclick="verDetalleTarea('${t.id}')" style="padding:0;display:flex;align-items:stretch;overflow:hidden;cursor:pointer">
        <div style="width:4px;background:${stripeColor};flex-shrink:0"></div>
        <div style="width:56px;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:11px;font-weight:700;color:${stripeColor};letter-spacing:0.08em;flex-shrink:0;border-right:1px solid var(--border)">${tipoAbrev}</div>
        <div style="padding:14px 16px;flex:1;min-width:0">
          <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:6px">${_tpEscHtml(t.titulo || "—")}</div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--text-muted);margin-bottom:8px">
            <span style="font-weight:600;color:${stripeColor}">${_tpEscHtml(matNombre)}</span>
            <span class="x-chip x-chip--info">${t.tipo || "—"}</span>
          </div>
          <div style="display:flex;align-items:center;gap:14px;font-size:11px;color:var(--text-muted);flex-wrap:wrap">
            ${timerHTML ? `<span>${timerHTML}</span>` : ""}
            <span style="display:inline-flex;align-items:center;gap:6px">${ring}<span>${entregadas}/${totalAlum} entregas</span></span>
            ${calificadas > 0 ? `<span style="color:var(--xahni-purple)">${calificadas} calificada${calificadas !== 1 ? "s" : ""}</span>` : ""}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:14px 16px;flex-shrink:0" onclick="event.stopPropagation()">
          ${prorChip}
          <span class="x-chip ${est.cls}"><span style="width:6px;height:6px;border-radius:50%;background:${est.dot};display:inline-block;margin-right:4px"></span>${est.label}</span>
          <div style="display:flex;gap:4px">
            ${publicarBtn}
            ${cerrarBtn}
            ${_tpEstaCerrada(t) ? "" : `<button class="x-btn x-btn--icon x-btn--ghost" onclick="editarTarea('${t.id}')" title="Editar"><svg class="x-icon"><use href="#x-icon-edit"></use></svg></button>
            <button class="x-btn x-btn--icon x-btn--ghost" onclick="eliminarTarea('${t.id}')" title="Eliminar"><svg class="x-icon"><use href="#x-icon-trash"></use></svg></button>`}
          </div>
        </div>
      </article>${pendientes.length > 0 ? `<div class="tp-prorrogas-panel" id="tp-prorrogas-${t.id}" hidden style="background:var(--surface-1);border:1px solid var(--border);border-radius:var(--r-md);padding:14px 16px;margin-top:-4px"></div>` : ""}`;
    }).join("")
  }</div>`;
}

/**
 * @interaction toggle-prorrogas-panel
 * @scope profesor (tareas)
 *
 * Given una card de tarea con prórrogas pendientes tiene chip "📅 N
 *   solicitudes" y un panel sibling #tp-prorrogas-<tareaId> (hidden).
 * When el profesor hace click en el chip.
 * Then alterna el atributo hidden del panel. Si va a abrirse y aún está
 *   vacío, renderiza la lista de pendientes via _renderProrrogasPanel.
 * Edge si el panel no existe (sin pendientes), no hace nada. Si la tarea
 *   no existe en TP_TAREAS, tampoco hace nada.
 */
function toggleProrrogasPanel(tareaId) {
  const panel = document.getElementById(`tp-prorrogas-${tareaId}`);
  if (!panel) return;
  const willOpen = panel.hasAttribute("hidden");
  if (willOpen) {
    panel.innerHTML = _renderProrrogasPanel(tareaId);
    panel.removeAttribute("hidden");
  } else {
    panel.setAttribute("hidden", "");
  }
}
window.toggleProrrogasPanel = toggleProrrogasPanel;

/**
 * @interaction render-prorrogas-panel
 * @scope profesor-tareas-render-prorrogas
 *
 * Given tareaId + `TP_TAREAS` hidratado.
 * When `toggleProrrogasPanel` abre el panel y necesita poblar el contenido.
 * Then:
 *   1. Lookup tarea. Sin → empty state "Sin solicitudes".
 *   2. Filtra `prorrogas[]` por estado === "pendiente".
 *   3. Sin pendientes → empty state "Sin solicitudes pendientes".
 *   4. Por pendiente:
 *      - Resuelve alumno (DEMO_USERS) + avatar canonical `getAvatarDisplay`.
 *      - Format fecha solicitud `_tpFmtProrrogaFecha`.
 *      - Escape motivo via `_tpEscHtml`.
 *      - Item con avatar 36px brand-gradient + nombre + meta fecha + motivo
 *        + botón "Revisar" → `abrirResolverProrroga(tareaId, p.id)`.
 *   5. Header del panel: "📅 Solicitudes de prórroga · {titulo}".
 * Edge:
 *   - DEMO_USERS no cargado → fallback uid raw como nombre.
 *   - **getAvatarDisplay canonical** consumido (Pilar 1 helper). Fallback
 *     a u.iniciales o "?".
 *   - Estilos INLINE para layout custom (avatar + flex column).
 *   - `_tpEscHtml` apóstrofe-safe en nombre, fotoTexto, titulo, motivo.
 *   - Helper LOCAL.
 *   - Función PURA (retorna string HTML).
 *   - Twin estructural con `_renderProrrogasPanel` alumno (vista solicitar).
 */
function _renderProrrogasPanel(tareaId) {
  const tarea = TP_TAREAS.find(x => x.id === tareaId);
  if (!tarea) return `<div class="x-empty x-empty--inline"><div class="x-empty__desc">Sin solicitudes</div></div>`;
  const pendientes = (tarea.prorrogas || []).filter(p => p.estado === "pendiente");
  if (!pendientes.length) {
    return `<div class="x-empty x-empty--inline"><div class="x-empty__desc">Sin solicitudes pendientes</div></div>`;
  }
  const itemsHTML = pendientes.map(p => {
    const u = (typeof DEMO_USERS !== "undefined") ? DEMO_USERS.find(x => x.id === p.uid) : null;
    const nombre = u?.nombre || p.uid;
    const disp = (typeof getAvatarDisplay === "function") ? getAvatarDisplay(p.uid) : null;
    const fotoTexto = disp ? disp.fotoTexto : (u?.iniciales || "?");
    const fechaTxt = _tpFmtProrrogaFecha(p.fechaSolicitud);
    const motivoEsc = _tpEscHtml(p.motivo || "(sin motivo)");
    return `
      <div class="tp-prorroga-item" style="display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="width:36px;height:36px;border-radius:50%;background:var(--brand-gradient);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0">${_tpEscHtml(fotoTexto)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:2px">${_tpEscHtml(nombre)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Solicitada ${fechaTxt}</div>
          <div style="font-size:12px;color:var(--text-secondary);line-height:1.4">${motivoEsc}</div>
        </div>
        <button class="x-btn x-btn--primary" style="padding:6px 14px;font-size:12px;flex-shrink:0" onclick="event.stopPropagation();abrirResolverProrroga('${tareaId}','${p.id}')">Revisar</button>
      </div>`;
  }).join("");
  return `
    <div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:6px">📅 Solicitudes de prórroga · ${_tpEscHtml(tarea.titulo)}</div>
    ${itemsHTML}
  `;
}

/**
 * @interaction tp-fmt-prorroga-fecha
 * @scope profesor-tareas-helper-fecha
 *
 * Given iso datetime de fechaSolicitud de prórroga.
 * When `_renderProrrogasPanel` muestra "Solicitada {fecha}" en cada item.
 * Then formato `DD-mes HH:MM` con meses array hardcoded en español.
 * Edge:
 *   - iso falsy → "—".
 *   - Date inválido → iso raw como fallback defensive.
 *   - **Incluye HH:MM** (diferencia con `_tpFormatDate` y `_recFechaStr`
 *     que solo dan día/mes). Decisión: las solicitudes son timestamps
 *     precisos, no fechas de planning.
 *   - **Locale "es" hardcoded** (meses array). Mismo issue que otros 4+
 *     helpers fecha cross-rol.
 *   - Función PURA.
 *   - Helper LOCAL.
 */
function _tpFmtProrrogaFecha(iso) {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (isNaN(dt)) return iso;
  const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${String(dt.getDate()).padStart(2, "0")}-${meses[dt.getMonth()]} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
}

/**
 * @interaction tp-esc-html
 * @scope profesor-tareas-helper-esc
 *
 * Given valor cualquiera `s`.
 * When cualquier renderer del módulo compone HTML con strings dinámicos.
 * Then String coerce + 5-char escape: `&`, `<`, `>`, `"`, `'`.
 * Edge:
 *   - null/undefined → "".
 *   - **6to `_*Esc` cross-archivo del rol profesor** (acumulado: `_apEsc` +
 *     `_hgpEsc` + `_profEsc` + `_hubInicioEsc` + `_calEsc` + `_tpEscHtml`).
 *     `_apEsc` y `_tpEscHtml` son los únicos que escapan apóstrofe.
 *   - **Deuda consolidación gigante**: 6 helpers duplicados convergerán a
 *     `_escapeHtml` canonical (slice XSS pre-Supabase).
 *   - Función PURA.
 *   - Helper LOCAL.
 */
function _tpEscHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * @interaction tp-format-date
 * @scope profesor-tareas-helper-fecha
 *
 * Given str fecha (puede ser ISO completo o YYYY-MM-DD).
 * When `_tpBuildList` (timer) / `verDetalleTarea` (header) / `_tpRenderAlumnos`
 *   (badge entregado) muestran fechas humanizadas.
 * Then:
 *   - Sin str → "—".
 *   - **Sufijo "T00:00:00"** si str.length === 10 (YYYY-MM-DD sin time)
 *     para evitar TZ shift que parsearía como UTC midnight (visible como
 *     día anterior en local timezone).
 *   - toLocaleDateString "es-MX" {day:"2-digit", month:"short"} → "15 mar".
 * Edge:
 *   - Date inválido → "Invalid Date" string visible.
 *   - **NO incluye año** — diferencia con `_recFechaStr` (que sí). Decisión:
 *     en tareas la fecha es del periodo actual mayormente.
 *   - Locale hardcoded.
 *   - Función PURA.
 *   - Helper LOCAL.
 */
function _tpFormatDate(str) {
  if (!str) return "—";
  const d = new Date(str + (str.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

// ── Actions ───────────────────────────────────────────────────────────────────
/**
 * @interaction publicar-tarea
 * @scope profesor-tareas-handler-publish
 *
 * Given id de tarea en estado "borrador".
 * When card de borrador click "Publicar" (action bar).
 * Then:
 *   1. Lookup tarea por id.
 *   2. Setea `estado = "publicada"` + cache invalidate.
 *   3. Repaint + toast success.
 * Edge:
 *   - Tarea no encontrada → no toast (corner case raro).
 *   - **Sin confirm modal** — publicar es no-destructivo (puede revertir
 *     con "Cerrar" después si se equivoca, aunque NO hay flujo
 *     "despublicar a borrador" — deuda menor).
 *   - **Exportado en window** (onclick inline).
 *   - Función IMPURA.
 *   - Deuda post-Supabase: `tareas.UPDATE estado=publicada WHERE id=$1`
 *     + notification trigger a alumnos.
 */
function publicarTarea(id) {
  const t = TP_TAREAS.find((x) => x.id === id);
  if (t) { t.estado = "publicada"; delete _tpEntregasCache[id]; }
  buildTareasProfesor();
  showToast(`"${t?.titulo}" publicada`, "success");
}

/**
 * @interaction cerrar-tarea
 * @scope profesor-tareas-handler-close
 *
 * Given id de tarea "publicada" (NO de parcial cerrado — gateado en card).
 * When card click "Cerrar" (action bar).
 * Then abre modal-cerrar-tarea con nombre prepoblado + guarda `_tpCerrarId`.
 * Edge:
 *   - Tarea no encontrada → no-op.
 *   - Cerrar tarea = setear `estado = "cerrada"` (UI override). NO afecta
 *     `isParcialCerrado` (esos son cierres a nivel parcial/escala, NO tarea).
 *   - **Asimetría con "cerrada por parcial cerrado"**: tarea con
 *     `_tpEstaCerrada(t)===true` ya muestra chip "Cerrada" pero la UI
 *     no permite re-cerrar (botón oculto). Pattern doble lock.
 *   - **Exportado en window** (onclick inline).
 *   - Función IMPURA (abre modal).
 */
function cerrarTarea(id) {
  const t = TP_TAREAS.find((x) => x.id === id);
  if (!t) return;
  _tpCerrarId = id;
  document.getElementById("tp-cerrar-nombre").textContent = t.titulo;
  openModal("modal-cerrar-tarea");
}

/**
 * @interaction confirmar-cerrar-tarea
 * @scope profesor-tareas-handler-close
 *
 * Given user en modal-cerrar-tarea tras click "Cerrar" en card.
 * When click confirmar del modal.
 * Then:
 *   1. Lookup por `_tpCerrarId`. Setea `estado = "cerrada"`.
 *   2. Reset state + close modal + repaint + toast info.
 * Edge:
 *   - **NO invalida cache `_tpEntregasCache`** porque cerrar no cambia
 *     entregas. Asimetría con `publicarTarea` que SÍ invalida (decisión
 *     histórica — quizás reductable, deuda menor).
 *   - **Exportado en window** (onclick inline modal).
 *   - Función IMPURA.
 */
function confirmarCerrarTarea() {
  const t = TP_TAREAS.find((x) => x.id === _tpCerrarId);
  if (t) t.estado = "cerrada";
  _tpCerrarId = null;
  closeModal("modal-cerrar-tarea");
  buildTareasProfesor();
  showToast(`"${t?.titulo}" cerrada`, "info");
}

/**
 * @interaction eliminar-tarea
 * @scope profesor (tareas card)
 *
 * Given: tarea publicada/borrador no perteneciente a parcial cerrado.
 * When:  profesor hace clic en 🗑️ en la card de la tarea.
 * Then:  abre modal-eliminar-tarea con el título precargado.
 * Edge:
 *   - tarea inexistente → no-op silencioso
 *   - tarea de parcial cerrado → toast warning + no abre modal. La card
 *     ya oculta el botón, pero alguien podría invocar la función desde
 *     consola, otro módulo o un consumer futuro — defensa en profundidad
 *     (slice cerrar-parcial-polish 2026-05-25 #5.B).
 */
function eliminarTarea(id) {
  const t = TP_TAREAS.find((x) => x.id === id);
  if (!t) return;
  if (_tpEstaCerrada(t)) {
    if (typeof showToast === "function") {
      showToast("Tarea de parcial cerrado · reabre el parcial para eliminar", "warning");
    }
    return;
  }
  _tpEliminarId = id;
  document.getElementById("tp-eliminar-nombre").textContent = t.titulo;
  openModal("modal-eliminar-tarea");
}

/**
 * @interaction confirmar-eliminar-tarea
 * @scope profesor-tareas-handler-delete
 *
 * Given user en modal-eliminar-tarea tras click 🗑 en card.
 * When click confirmar del modal.
 * Then:
 *   1. Lookup por `_tpEliminarId` (preserva ref para toast).
 *   2. `TP_TAREAS = filter(x.id !== _tpEliminarId)` — reasign (NO splice).
 *   3. Cache invalidate para esa tarea.
 *   4. Reset + close modal + repaint + toast info.
 * Edge:
 *   - **`TP_TAREAS = filter(...)` reasigna** (no splice in-place) — sutil
 *     porque otros módulos que cachean reference al array entero perderían
 *     sync. Aceptable: el array es module-scope y solo este módulo lo
 *     mantiene.
 *   - **Eliminación in-memory only**: DEMO_TAREAS NO se toca (mismo patrón
 *     que recursos.js — diferencia con tarea cuando se re-init via change-of-user).
 *   - **Exportado en window** (onclick inline modal).
 *   - Función IMPURA (reasign + DOM + abre modal).
 *   - Deuda post-Supabase: cascade delete (entregas, prórrogas).
 */
function confirmarEliminarTarea() {
  const t   = TP_TAREAS.find((x) => x.id === _tpEliminarId);
  TP_TAREAS = TP_TAREAS.filter((x) => x.id !== _tpEliminarId);
  delete _tpEntregasCache[_tpEliminarId];
  _tpEliminarId = null;
  closeModal("modal-eliminar-tarea");
  buildTareasProfesor();
  showToast(`"${t?.titulo}" eliminada`, "info");
}

// ── Crear / Editar modal ──────────────────────────────────────────────────────
/**
 * @interaction abrir-crear-tarea
 * @scope profesor-tareas-modal-crear
 *
 * Given user click "+ Nueva tarea" en header de vista.
 * When dispara onclick.
 * Then:
 *   1. Reset `_tpEditId = null` (modo crear).
 *   2. Título modal: "Nueva Tarea".
 *   3. Defaults form: titulo vacío, primera materia del prof,
 *      tipo="Práctica", puntos=30, fecha vacío, instrucciones vacío,
 *      estado="borrador".
 *   4. Render form via `_tpRenderForm` + activate modal.
 * Edge:
 *   - Profesor sin materias → primMat "" → form materia select vacío
 *     (UX edge case raro).
 *   - **Defaults "Práctica" 30 pts** — convención cementada del módulo
 *     (común para el rol vs Quiz 10 o Proyecto 100).
 *   - **classList.add("active")** vs `openModal()`: usa el patrón legacy
 *     directo (no el wrapper). Decisión histórica del slice tareas.
 *   - **Exportado en window** (onclick inline botón vista).
 *   - Función IMPURA (DOM).
 */
function abrirCrearTarea() {
  _tpEditId = null;
  document.getElementById("tp-modal-title").textContent = "Nueva Tarea";
  const primMat = ((DEMO_MATERIAS || []).find((m) => m.profesorId === APP.user?.id))?.id || "";
  _tpRenderForm({ titulo:"", materia: primMat, tipo:"Práctica", puntos:30, fechaEntrega:"", instrucciones:"", estado:"borrador" });
  document.getElementById("modal-crear-tarea").classList.add("active");
}

/**
 * @interaction editar-tarea
 * @scope profesor (tareas card)
 *
 * Given: tarea no perteneciente a parcial cerrado.
 * When:  profesor hace clic en ✏️ en la card de la tarea.
 * Then:  popula el form del modal-crear-tarea con los datos actuales y
 *   abre el modal en modo "Editar Tarea".
 * Edge:
 *   - tarea inexistente → no-op silencioso
 *   - tarea de parcial cerrado → toast warning + no abre modal. La card
 *     ya oculta el botón, pero alguien podría invocar la función desde
 *     consola, otro módulo o un consumer futuro — defensa en profundidad
 *     (slice cerrar-parcial-polish 2026-05-25 #5.B).
 */
function editarTarea(id) {
  const t = TP_TAREAS.find((x) => x.id === id);
  if (!t) return;
  if (_tpEstaCerrada(t)) {
    if (typeof showToast === "function") {
      showToast("Tarea de parcial cerrado · reabre el parcial para editar", "warning");
    }
    return;
  }
  _tpEditId = id;
  document.getElementById("tp-modal-title").textContent = "Editar Tarea";
  _tpRenderForm(t);
  document.getElementById("modal-crear-tarea").classList.add("active");
}

/**
 * @interaction cerrar-modal-tarea
 * @scope profesor-tareas-modal-crear
 *
 * Given modal-crear-tarea abierto.
 * When user click "Cancelar" o success post-save (auto-close en
 *   `_tpGuardarTarea`).
 * Then `classList.remove("active")`.
 * Edge:
 *   - **NO resetea form fields** — siguiente apertura los repobla via
 *     `_tpRenderForm` con defaults o data de edit.
 *   - **NO usa closeModal()** — patrón legacy directo (mismo modal-crear-tarea
 *     usa add/remove "active" en vez de `.is-open` canonical). Deuda menor:
 *     convergir.
 *   - **Exportado en window** (onclick inline).
 *   - Función IMPURA (DOM).
 */
function cerrarModalTarea() {
  document.getElementById("modal-crear-tarea").classList.remove("active");
}

/**
 * @interaction tp-grupos-de-materia
 * @scope profesor-tareas-data-grupos
 *
 * Given materiaId.
 * When `_tpRenderForm` puebla el `<select>` de grupo del modal crear/editar.
 * Then:
 *   1. Guards typeof DEMO_MATERIAS/GRUPOS → `[]`.
 *   2. Lookup materia; sin → `[]`.
 *   3. Filtra DEMO_GRUPOS por ids en `m.grupos[]`.
 * Edge:
 *   - Materia sin grupos array → `[]`.
 *   - Grupos huérfanos (id en m.grupos pero no en DEMO_GRUPOS) → filtrados
 *     silenciosamente.
 *   - Función PURA.
 *   - Helper LOCAL.
 *   - **Twin con `getMateriasProfGrupo`** (data-provider) pero inverso:
 *     ese filtra materias por grupo, este filtra grupos por materia.
 */
function _tpGruposDeMateria(materiaId) {
  if (typeof DEMO_MATERIAS === "undefined" || typeof DEMO_GRUPOS === "undefined") return [];
  const m = DEMO_MATERIAS.find(x => x.id === materiaId);
  if (!m || !Array.isArray(m.grupos)) return [];
  return DEMO_GRUPOS.filter(g => m.grupos.includes(g.id));
}

/**
 * @interaction tp-render-form
 * @scope profesor-tareas-modal-form
 *
 * Given tarea shape `t` (con campos titulo/materia/grupoId/tipo/puntos/
 *   fechaEntrega/horaEntrega/instrucciones) — sea defaults de crear o data
 *   del existente en edit.
 * When `abrirCrearTarea` o `editarTarea` setean state + invocan render.
 * Then innerHTML del modal body con 7 form-groups:
 *   1. Título input (placeholder Ej genérico).
 *   2. Grid 2-cols: Materia select + Grupo select (con opción "Todos los
 *      grupos" si tarea sin grupoId).
 *   3. Tipo select (5 opciones desde TP_TIPOS).
 *   4. Grid 2-cols: Puntos number (min=1, max=100) + Fecha date.
 *   5. Hora time (default "23:59").
 *   6. Instrucciones textarea (4 rows).
 *   7. Botones: Cancelar + Guardar (texto bifurcado por `_tpEditId`) +
 *      Publicar (solo en crear).
 * Edge:
 *   - **`_tpFiltroGrupo` fallback en crear**: si el modal abre desde
 *     contexto hub-materia con grupo activo, pre-selecciona ese grupo en
 *     el select. Slice prórrogas-polish (pre-c10 #4).
 *   - **Tareas pre-existentes sin grupoId** muestran "Todos los grupos"
 *     selected (default seguro legacy).
 *   - **Botón Publicar solo en crear** (`!_tpEditId`) — en edit, el botón
 *     queda como "Guardar cambios" preservando estado actual.
 *   - innerHTML masivo con `_tpEscHtml` en values dinámicos.
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM).
 *   - Renderer del 2do más grande del módulo (después de `_tpBuildList`).
 */
function _tpRenderForm(t) {
  const materias   = (DEMO_MATERIAS || []).filter((m) => m.profesorId === APP.user?.id);
  const matOptions = materias.map((m) =>
    `<option value="${_tpEscHtml(m.id)}" ${t.materia === m.id ? "selected" : ""}>${_tpEscHtml(m.nombre)}</option>`,
  ).join("");

  // Slice prórrogas-polish (pre-c10 #4): select de grupo. Pre-selecciona
  // _tpFiltroGrupo si la modal se abre desde el contexto del hub-materia
  // con grupo activo; si no, "todos los grupos". Tareas pre-existentes
  // sin grupoId también muestran "Todos" (default seguro).
  const grupoSel    = t.grupoId || _tpFiltroGrupo || "";
  const gruposMat   = _tpGruposDeMateria(t.materia);
  const grupoOptions = `<option value=""${!grupoSel ? " selected" : ""}>— Todos los grupos —</option>`
    + gruposMat.map(g =>
      `<option value="${_tpEscHtml(g.id)}"${g.id === grupoSel ? " selected" : ""}>${_tpEscHtml(g.nombre)}</option>`
    ).join("");

  const body = document.getElementById("tp-modal-body");
  body.innerHTML = `
    <div class="tp-form-group">
      <label class="tp-form-label">Título</label>
      <input class="tp-form-input" id="tp-f-titulo" value="${_tpEscHtml(t.titulo)}" placeholder="Ej: Práctica 7 — Fetch API">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="tp-form-group">
        <label class="tp-form-label">Materia</label>
        <select class="tp-form-input" id="tp-f-materia">${matOptions}</select>
      </div>
      <div class="tp-form-group">
        <label class="tp-form-label">Grupo</label>
        <select class="tp-form-input" id="tp-f-grupo">${grupoOptions}</select>
      </div>
    </div>
    <div class="tp-form-group">
      <label class="tp-form-label">Tipo</label>
      <select class="tp-form-input" id="tp-f-tipo">
        ${TP_TIPOS.map((x) => `<option ${t.tipo === x ? "selected" : ""}>${x}</option>`).join("")}
      </select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="tp-form-group">
        <label class="tp-form-label">Puntos</label>
        <input class="tp-form-input" id="tp-f-puntos" type="number" min="1" max="100" value="${t.puntos}">
      </div>
      <div class="tp-form-group">
        <label class="tp-form-label">Fecha de entrega</label>
        <input class="tp-form-input" id="tp-f-fecha" type="date" value="${t.fechaEntrega}">
      </div>
    </div>
    <div class="tp-form-group">
      <label class="tp-form-label">Hora de entrega</label>
      <input class="tp-form-input" id="tp-f-hora" type="time" value="${t.horaEntrega || "23:59"}">
    </div>
    <div class="tp-form-group">
      <label class="tp-form-label">Instrucciones</label>
      <textarea class="tp-form-input" id="tp-f-instrucciones" rows="4" placeholder="Describe lo que deben entregar los alumnos...">${_tpEscHtml(t.instrucciones)}</textarea>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
      <button class="prof-btn-sm ghost" onclick="cerrarModalTarea()">Cancelar</button>
      <button class="x-btn x-btn--primary" style="padding:8px 20px;font-size:13px" onclick="_tpGuardarTarea(false)">
        ${_tpEditId ? "Guardar cambios" : "Guardar borrador"}
      </button>
      ${!_tpEditId ? `<button class="x-btn x-btn--primary" style="padding:8px 20px;font-size:13px;background:var(--xahni-green)" onclick="_tpGuardarTarea(true)">Publicar</button>` : ""}
    </div>`;
}

/**
 * @interaction tp-guardar-tarea
 * @scope profesor-tareas-modal-submit
 *
 * Given user en modal-crear-tarea + parámetro `publicar` (bool — true = botón
 *   "Publicar", false = botón "Guardar borrador/cambios").
 * When click en uno de los 2 botones del form.
 * Then:
 *   1. Lee 7 inputs (title/materia/grupo/tipo/puntos/fecha/hora/instrucciones).
 *   2. Validation: titulo + fechaEntrega obligatorios → toast bloqueante.
 *   3. **Bifurcación por `_tpEditId`**:
 *      - Modo editar: `Object.assign(t, fields)` in-place + cache invalidate.
 *      - Modo crear: `tp_${Date.now()}` id + push a TP_TAREAS con shape
 *        completo. Estado bifurcado por `publicar`.
 *   4. Cleanup: cerrarModalTarea + repaint + toast (texto contextual).
 * Edge:
 *   - **`Object.assign` in-place** preserva references (otros módulos con
 *     handle al objeto t siguen viéndolo actualizado).
 *   - **`Date.now()` id collision**: 1ms granularidad. Aceptable para volumen
 *     DEMO. Deuda post-Supabase: UUID v7.
 *   - **Cache invalidate solo en edit** — crear no tiene cache previa para
 *     ese id.
 *   - `publicar=false` en crear → estado="borrador"; en edit → preserva
 *     estado actual (Object.assign no toca estado).
 *   - **`horaEntrega` y `puntos` no validados** en granularidad fina — `parseInt
 *     || 0` deja pasar 0 puntos válidos (aceptable: 0 puntos = solo entrega).
 *   - **Exportado en window** (onclick inline en 2 botones del form).
 *   - Función IMPURA (DOM + state + cache).
 */
function _tpGuardarTarea(publicar) {
  const titulo       = document.getElementById("tp-f-titulo").value.trim();
  const materia      = document.getElementById("tp-f-materia").value;
  // Slice prórrogas-polish (pre-c10 #4): grupoId del select; "" = todos los
  // grupos de la materia (comportamiento legacy si no se elige uno explícito).
  const grupoId      = document.getElementById("tp-f-grupo")?.value || "";
  const tipo         = document.getElementById("tp-f-tipo").value;
  const puntos       = parseInt(document.getElementById("tp-f-puntos").value) || 0;
  const fechaEntrega = document.getElementById("tp-f-fecha").value;
  const horaEntrega  = document.getElementById("tp-f-hora").value || "23:59";
  const instrucciones = document.getElementById("tp-f-instrucciones").value.trim();

  if (!titulo)       { showToast("El título es obligatorio",          "error"); return; }
  if (!fechaEntrega) { showToast("La fecha de entrega es obligatoria","error"); return; }

  if (_tpEditId) {
    const t = TP_TAREAS.find((x) => x.id === _tpEditId);
    if (t) Object.assign(t, { titulo, materia, grupoId, tipo, puntos, fechaEntrega, horaEntrega, instrucciones });
    delete _tpEntregasCache[_tpEditId];
    showToast("Tarea actualizada", "success");
  } else {
    const newId = "tp_" + Date.now();
    TP_TAREAS.push({
      id:           newId,
      titulo, materia, grupoId, tipo, puntos,
      fechaCreacion: new Date().toISOString().slice(0, 10),
      fechaEntrega, horaEntrega, instrucciones,
      estado:       publicar ? "publicada" : "borrador",
      archivos:     [],
      _entregas:    [],
    });
    showToast(publicar ? "Tarea publicada" : "Borrador guardado", "success");
  }

  cerrarModalTarea();
  buildTareasProfesor();
}

// ── Detalle / Entregas ────────────────────────────────────────────────────────
/**
 * @interaction ver-detalle-tarea
 * @scope profesor-tareas-modal-detalle
 *
 * Given id de tarea + DOM con #modal-detalle-tarea (markup base con
 *   `#tp-det-title`/`#tp-det-body`/`#tp-det-alumnos`).
 * When user click row de tarea en la lista (`_tpBuildList` onclick).
 * Then construye y abre modal detalle:
 *   1. Lookup tarea. Sin → no-op.
 *   2. Resuelve entregas (cached).
 *   3. Calcula 4 stats: entregados, sinEntregar, calificados, promedio
 *      (de calificadas, toFixed(1) o "—").
 *   4. innerHTML body con:
 *      - Header: mat badge + tipo badge + puntos (si > 0) + fecha entrega.
 *      - Instrucciones (si presentes).
 *      - 4 tp-det-stat cards.
 *      - 3 tabs (todos/entregados/sin entregar) con counts.
 *      - Container `#tp-det-alumnos` vacío.
 *   5. `_tpRenderAlumnos(id, "todos")` — popular tab default.
 *   6. `classList.add("active")` — abrir modal.
 * Edge:
 *   - Tarea no encontrada → no-op silencioso.
 *   - **promedio "—"** si sin calificaciones, no 0.
 *   - **Sin instrucciones** → branch omitido (no muestra div vacío).
 *   - Mat badge con `matColor + "22"` (alpha hex) para tint background.
 *   - **Exportado en window** (onclick inline en card).
 *   - Función IMPURA (DOM masivo + abre modal).
 *   - Renderer del 3er más grande del módulo.
 */
function verDetalleTarea(id) {
  const t = TP_TAREAS.find((x) => x.id === id);
  if (!t) return;

  const entregas   = _tpGetEntregas(t);
  const matNombre  = _tpMatNombre(t.materia);
  const matColor   = _tpMatColor(t.materia);
  const totalAlum  = entregas.length;
  const entregados = entregas.filter((e) => e.entregado).length;
  const sinEntregar = totalAlum - entregados;
  const calificados = entregas.filter((e) => e.calificacion !== null).length;
  const cals       = entregas.filter((e) => e.calificacion !== null).map((e) => e.calificacion);
  const promedio   = cals.length ? (cals.reduce((a, b) => a + b, 0) / cals.length).toFixed(1) : "—";

  document.getElementById("tp-det-title").textContent = t.titulo;
  const body = document.getElementById("tp-det-body");
  body.innerHTML = `
    <div class="tp-det-header">
      <div class="tp-det-info">
        <span class="tp-mat-badge" style="background:${matColor}22;color:${matColor};border:1px solid ${matColor}44">${matNombre}</span>
        <span class="tp-tipo-badge">${t.tipo}</span>
        ${t.puntos > 0 ? `<span style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted)">${t.puntos} pts</span>` : ""}
        <span style="font-size:12px;color:var(--text-muted)">Entrega: ${_tpFormatDate(t.fechaEntrega)}</span>
      </div>
      ${t.instrucciones ? `<div class="tp-det-instrucciones">${_tpEscHtml(t.instrucciones)}</div>` : ""}
    </div>
    <div class="tp-det-stats">
      <div class="tp-det-stat"><div class="tp-det-stat-val" style="color:var(--xahni-teal)">${entregados}</div><div class="tp-det-stat-lbl">Entregaron</div></div>
      <div class="tp-det-stat"><div class="tp-det-stat-val" style="color:var(--xahni-red)">${sinEntregar}</div><div class="tp-det-stat-lbl">Sin entregar</div></div>
      <div class="tp-det-stat"><div class="tp-det-stat-val" style="color:var(--xahni-purple-light)">${calificados}</div><div class="tp-det-stat-lbl">Calificados</div></div>
      <div class="tp-det-stat"><div class="tp-det-stat-val" style="color:var(--accent-cyan-text)">${promedio}</div><div class="tp-det-stat-lbl">Promedio</div></div>
    </div>
    <div class="tp-det-tabs">
      <button class="tp-det-tab active" onclick="_tpDetTab('todos',this,'${id}')">Todos (${totalAlum})</button>
      <button class="tp-det-tab" onclick="_tpDetTab('entregados',this,'${id}')">Entregados (${entregados})</button>
      <button class="tp-det-tab" onclick="_tpDetTab('sin',this,'${id}')">Sin entregar (${sinEntregar})</button>
    </div>
    <div id="tp-det-alumnos"></div>`;

  _tpRenderAlumnos(id, "todos");
  document.getElementById("modal-detalle-tarea").classList.add("active");
}

/**
 * @interaction tp-det-tab
 * @scope profesor-tareas-modal-detalle-tabs
 *
 * Given filtro ("todos" | "entregados" | "sin") + btn clickeado + tareaId.
 * When user click un tab del modal detalle.
 * Then:
 *   1. Deselect siblings tabs (todos los `.tp-det-tab` en el parentElement).
 *   2. `.active` sobre btn.
 *   3. Re-render alumnos via `_tpRenderAlumnos(tareaId, filtro)`.
 * Edge:
 *   - **Sin guard tab inválido** — caller usa botones HTML cementados (no
 *     llamada programática externa).
 *   - **`parentElement.querySelectorAll`** sin escape del scope —
 *     ambigüedad si hay nested tabs no esperados (no aplica al DOM actual).
 *   - **Exportado en window** (onclick inline tabs).
 *   - Función IMPURA (DOM).
 */
function _tpDetTab(filtro, btn, tareaId) {
  btn.parentElement.querySelectorAll(".tp-det-tab").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  _tpRenderAlumnos(tareaId, filtro);
}

/**
 * @interaction tp-render-alumnos
 * @scope profesor-tareas-modal-detalle-render
 *
 * Given tareaId + filtro ("todos" | "entregados" | "sin").
 * When `verDetalleTarea` init render o `_tpDetTab` switch filter.
 * Then renderer alumnos del modal detalle (~50 LOC):
 *   1. Lookup tarea + entregas cached.
 *   2. Aplica filtro:
 *      - "entregados" → filter `e.entregado === true`.
 *      - "sin" → filter `e.entregado === false`.
 *      - "todos" → sin filtro.
 *   3. Empty state si sin alumnos.
 *   4. Guard `_cerrada = _tpEstaCerrada(t)` (parcial cerrado bloquea
 *      calificación inline).
 *   5. Por alumno:
 *      - Avatar 32px (`_av` helper con `getAvatarDisplay` canonical fotoTexto).
 *      - Nombre + grupo (mono).
 *      - Badge entrega (green con fecha si entregado / red "Sin entregar").
 *      - **`calDisplay`** bifurcación 4 ramas:
 *        a. **Ya calificada**: span mono con color por `_colorFinal(cal)`.
 *        b. **Entregada + parcial cerrado**: chip "🔒 Cerrado" con tooltip.
 *        c. **Entregada vigente**: input number inline + botón ✓ +
 *           onkeydown Enter → `_tpConfirmarCal`.
 *        d. **Sin entregar + publicada**: botón "Enviar recordatorio".
 *        e. **Sin entregar + borrador/cerrada**: span "No entregó" muted.
 * Edge:
 *   - **Apóstrofe en onkeydown**: `&apos;Enter&apos;` (entity HTML) porque
 *     el onkeydown vive dentro de un atributo string. Decision cementada:
 *     evita escape hell de quotes anidadas.
 *   - **Doble escape onclick "Enviar recordatorio"**: `replace(/'/g,"\\'")`
 *     porque el toast incluye el nombre con apóstrofes potenciales.
 *   - **Helper `_colorFinal` cross-archivo** (de profesor.js) — chain dep
 *     que requiere que profesor.js esté cargado.
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM).
 *   - 2do renderer más grande del flujo detalle.
 */
function _tpRenderAlumnos(tareaId, filtro) {
  const t = TP_TAREAS.find((x) => x.id === tareaId);
  if (!t) return;
  let entregas = _tpGetEntregas(t);
  if (filtro === "entregados") entregas = entregas.filter((e) =>  e.entregado);
  else if (filtro === "sin")   entregas = entregas.filter((e) => !e.entregado);

  const el = document.getElementById("tp-det-alumnos");
  if (!el) return;

  if (!entregas.length) {
    el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px">No hay alumnos en esta categoría</div>`;
    return;
  }

  // Slice cerrar-parcial-integracion: si la tarea pertenece a parcial
  // cerrado, los inputs inline para asignar calificación están disabled.
  // Las calificaciones ya asignadas se siguen mostrando como número.
  const _cerrada = _tpEstaCerrada(t);

  el.innerHTML = entregas
    .map((e) => {
      const avColor = PROF_AV_COLOR[e.color] || "var(--xahni-teal)";
      let calDisplay;
      if (e.calificacion !== null) {
        calDisplay = `<span style="font-family:var(--font-mono);font-weight:700;font-size:15px;color:${_colorFinal(e.calificacion)}">${e.calificacion}</span>`;
      } else if (e.entregado && _cerrada) {
        // Parcial cerrado: input deshabilitado + tooltip.
        calDisplay = `<span class="x-chip x-chip--info" style="font-size:10px" title="Parcial cerrado · libera el override desde Gestión para editar">🔒 Cerrado</span>`;
      } else if (e.entregado) {
        calDisplay = `
          <div class="tp-cal-inline" id="tp-cal-wrap-${e.alumnoId}">
            <input type="number" min="0" max="10" step="0.5" placeholder="0-10"
              class="tp-cal-input" id="tp-cal-input-${e.alumnoId}"
              onkeydown="if(event.key===&apos;Enter&apos;)_tpConfirmarCal('${tareaId}','${e.alumnoId}')">
            <button class="tp-cal-btn" onclick="_tpConfirmarCal('${tareaId}','${e.alumnoId}')">✓</button>
          </div>`;
      } else {
        calDisplay = t.estado === "publicada"
          ? `<button class="prof-btn-sm ghost" onclick="event.stopPropagation();showToast('Recordatorio enviado a ${_tpEscHtml(e.nombre).replace(/'/g,"\\'")}','success')">Enviar recordatorio</button>`
          : `<span style="font-size:11px;color:var(--text-muted)">No entregó</span>`;
      }

      return `<div class="tp-alumno-row">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          ${_av((typeof getAvatarDisplay === 'function' && e.alumnoId ? getAvatarDisplay(e.alumnoId).fotoTexto : e.ini), e.color, 32)}
          <div style="min-width:0">
            <div style="font-size:13px;font-weight:500;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_tpEscHtml(e.nombre)}</div>
            <div style="font-size:11px;color:var(--text-muted)">${e.grupo}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          ${e.entregado
            ? `<span class="tp-badge tp-badge-green" style="font-size:10px">Entregado · ${_tpFormatDate(e.fechaEntrega)}</span>`
            : `<span class="tp-badge tp-badge-red" style="font-size:10px">Sin entregar</span>`
          }
          <div style="min-width:60px;text-align:right">${calDisplay}</div>
        </div>
      </div>`;
    })
    .join("");
}

/**
 * @interaction tp-confirmar-cal
 * @scope profesor-tareas-handler-cal-inline
 *
 * Given tareaId + alumnoId + input number con value (de modal detalle).
 * When user presiona Enter o click ✓ en input inline de calificación.
 * Then:
 *   1. Lookup tarea. Sin → no-op.
 *   2. **Guard parcial cerrado**: `_tpEstaCerrada(t)` → toast error +
 *      bloqueante (con tip override Gestión).
 *   3. Lookup input + parseFloat.
 *   4. **Validation 0-10 con NaN guard** → toast error.
 *   5. Resuelve entry en entregas cached.
 *   6. **Mutación cached entry**: setea `e.calificacion = round(num*10)/10`
 *      (1 decimal) + `e.comentario = _tpRandomComment(cal)`.
 *   7. Re-paint detalle (`verDetalleTarea(id)` re-render completo) +
 *      `buildTareasProfesor` (repaint list + KPIs).
 *   8. Toast success.
 * Edge:
 *   - **Cache mutation directa**: el cache `_tpEntregasCache` se modifica
 *     in-place porque `_tpGetEntregas` retorna reference. Cambios visibles
 *     en el próximo render sin invalidar.
 *   - **Round a 1 decimal**: `Math.round(num * 10) / 10` evita float
 *     imprecision (e.g., 7.85 no termina como 7.849999).
 *   - `verDetalleTarea(tareaId)` re-render completo es costoso pero asegura
 *     stats correctos (entregados/calificados/promedio).
 *   - **Exportado en window** (onclick inline + onkeydown).
 *   - Función IMPURA (cache mutation + DOM + toast).
 *   - Deuda post-Supabase: `entregas.UPDATE calificacion=$1, comentario=$2
 *     WHERE tarea_id=$3 AND uid=$4` con realtime sync.
 */
function _tpConfirmarCal(tareaId, alumnoId) {
  const t = TP_TAREAS.find((x) => x.id === tareaId);
  if (!t) return;
  // Slice cerrar-parcial-integracion: guard si la tarea pertenece a parcial cerrado.
  if (_tpEstaCerrada(t)) {
    showToast("🔒 Parcial cerrado · libera el override desde Gestión para editar", "error");
    return;
  }
  const input = document.getElementById(`tp-cal-input-${alumnoId}`);
  if (!input) return;
  const num = parseFloat(input.value);
  if (isNaN(num) || num < 0 || num > 10) { showToast("Calificación inválida (0-10)", "error"); return; }
  const entregas = _tpGetEntregas(t);
  const e = entregas.find((x) => x.alumnoId === alumnoId);
  if (e) {
    e.calificacion = Math.round(num * 10) / 10;
    e.comentario   = _tpRandomComment(e.calificacion);
  }
  verDetalleTarea(tareaId);
  buildTareasProfesor();
  showToast("Calificación guardada", "success");
}

/**
 * @interaction cerrar-detalle-tarea
 * @scope profesor-tareas-modal-detalle
 *
 * Given modal-detalle-tarea abierto.
 * When user click cerrar del modal.
 * Then `classList.remove("active")` — pattern legacy idéntico a
 *   `cerrarModalTarea` para modal-crear.
 * Edge:
 *   - **No resetea state**: la próxima apertura via `verDetalleTarea`
 *     reconstruye todo desde cero (no preserva tab seleccionado).
 *   - **Exportado en window** (onclick inline cerrar modal).
 *   - Función IMPURA (DOM).
 */
function cerrarDetalleTarea() {
  document.getElementById("modal-detalle-tarea").classList.remove("active");
}

// ═══════════════════════════════════════════════════════════
// C9 · Trasplante a hub-materia profesor
// tareasProfRender(panelId, matId, grupoActivo) inyecta lazy el
// markup de views/profesor/tareas.html en el panel del hub-materia
// y llama a buildTareasProfesor() para init. Llamado desde
// profHubMatSwitchTab cuando el tab 'tareas' está activo.
//
// Slice prórrogas 2026-05-24: cerrada la deuda C9 de pre-filtrado.
// Ahora matId + grupoActivo se aplican a TP_TAREAS via _tpFiltroMat
// + _tpFiltroGrupo antes del render. El dropdown de materia se
// oculta cuando el contexto del hub-materia define la materia,
// para evitar confusión. Pre-selección del grupoActivo en modal
// crear/editar sigue pendiente (toca markup del form).
// ═══════════════════════════════════════════════════════════

/**
 * @interaction tareas-prof-render
 * @scope profesor-tareas-entry-hub-c9
 *
 * Given panelId del tab Tareas del hub-materia + matId + grupoActivo.
 * When `_profMatDispatchTabRender("tareas", ...)` lo invoca al switch del tab.
 * Then async pipeline:
 *   1. Resuelve panel. Sin → no-op.
 *   2. **Hardening dual-paint** (asistencia bug #7 pattern): chequea
 *      `#tp-metrics` en panel. Cubre recovery tras placeholder parcial futuro.
 *   3. Lazy fetch `views/profesor/tareas.html`:
 *      - HTTP error → console.error + x-empty fallback.
 *      - Success → innerHTML + hide redundancias selectivas:
 *        - **`.x-page-head__title`** + `.x-page-head__subtitle` hidden
 *          (redundante con header hub-materia).
 *        - **`.x-page-head__actions` PRESERVADO** (buscador + botón
 *          "Nueva tarea" únicos del tab). Slice pre-c10 6a (2026-05-26).
 *   4. **Cierra deuda C9 pre-filtrar**: `_tpFiltroMat = matId` +
 *      `_tpFiltroGrupo = grupoActivo || null`. Sin esto se mostraban TODAS
 *      las tareas cross-materias del profesor (bug histórico).
 *   5. `buildTareasProfesor()`.
 *   6. Hide `#tp-filtro-materia` select cuando matId provisto (contexto
 *      define materia; mostrarlo invita confusión).
 * Edge:
 *   - **Asimetría hide redundancias**: este preserva actions (slice 6a) vs
 *     escala/recursos que hide entera page-head. Decisión: las acciones
 *     de tareas son únicas (buscador + nueva tarea), las otras vistas no.
 *   - **grupoActivo `null` semántico** (vs "todas" de otros filtros) — cierra
 *     deuda histórica del filtro group bypass.
 *   - **Asincronía no awaited** post-fetch: handlers que se registran
 *     en innerHTML del fetch están listos al siguiente tick (sin async
 *     issue notable).
 *   - **Exportado en window** (consumer cross-archivo
 *     `_profMatDispatchTabRender` en hub-aprendizaje.js).
 *   - Función IMPURA (DOM + fetch + state).
 *   - Deuda post-Supabase: SSR + reactive query con filtros como URL params.
 */
async function tareasProfRender(panelId, matId, grupoActivo) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  // Hardening 2026-05-24 (slice panel-injection): usar presencia del markup
  // canónico (#tp-metrics) en lugar de un flag module-scope. Si un placeholder
  // (ej. "Parcial futuro") reemplazó panel.innerHTML, el flag quedaba true y
  // la vista nunca restauraba sus IDs canónicos al volver. Mismo patrón que
  // el fix de asistencia bug #7 (commit 646e3ae).
  if (!panel.querySelector("#tp-metrics")) {
    try {
      const res = await fetch("views/profesor/tareas.html");
      if (!res.ok) throw new Error("status " + res.status);
      panel.innerHTML = await res.text();

      // Ocultar redundancia: título + subtítulo del page-head son
      // redundantes dentro del hub-materia (ya hay contexto materia/grupo
      // activo en el header del hub). Pero preservamos `.x-page-head__actions`
      // (buscador + botón "Nueva tarea") porque son acciones útiles del
      // tab Tareas que no existen en otro lugar del hub-materia.
      // Slice pre-c10 6a (2026-05-26).
      const pageHead = panel.querySelector(".x-page-head");
      if (pageHead) {
        const title = pageHead.querySelector(".x-page-head__title");
        const subtitle = pageHead.querySelector(".x-page-head__subtitle");
        if (title) title.style.display = "none";
        if (subtitle) subtitle.style.display = "none";
      }
    } catch (err) {
      console.error("[tareasProfRender] no se pudo cargar tareas.html:", err);
      panel.innerHTML = '<div class="x-empty"><div class="x-empty__title">No se pudo cargar tareas</div></div>';
      return;
    }
  }
  // Cierra deuda C9: pre-filtrar por la materia + grupo del hub-materia
  // antes del primer render. El usuario vino con un contexto (matId,
  // grupoActivo) — la lista debe respetarlo. Sin esto se mostraban TODAS
  // las tareas del profesor cross-materias.
  if (matId)        _tpFiltroMat   = matId;
  _tpFiltroGrupo = grupoActivo || null;
  if (typeof buildTareasProfesor === "function") buildTareasProfesor();
  // Ocultar el select de materia: el contexto del hub-materia ya define
  // la materia, mostrarlo invita a confusión (¿qué pasa si lo cambio?).
  // El filtro de estado y la búsqueda siguen disponibles.
  const matSelect = document.getElementById("tp-filtro-materia");
  if (matSelect && matId) matSelect.style.display = "none";
}
window.tareasProfRender = tareasProfRender;

// ═══════════════════════════════════════════════════════════
// RESOLVER PRÓRROGA — abrir modal + aprobar/rechazar
// Slice prórrogas 2026-05-24
// ═══════════════════════════════════════════════════════════

/**
 * @interaction abrir-resolver-prorroga
 * @scope profesor (tareas)
 *
 * Given una prórroga pendiente identificada por (tareaId, prorrogaId).
 * When el profesor hace click en "Revisar" dentro del panel desplegable.
 * Then puebla #modal-resolver-prorroga con el nombre del alumno, título de
 *   la tarea, motivo readonly, fecha original de la tarea, abre el modal y
 *   guarda los IDs en variables module-scope para que la siguiente acción
 *   sepa qué resolver.
 * Edge si la tarea o la prórroga no existen, no abre nada (silencioso).
 */
function abrirResolverProrroga(tareaId, prorrogaId) {
  const tarea = TP_TAREAS.find(x => x.id === tareaId);
  if (!tarea) return;
  const p = (tarea.prorrogas || []).find(x => x.id === prorrogaId);
  if (!p || p.estado !== "pendiente") return;
  _tpResolviendoTareaId    = tareaId;
  _tpResolviendoProrrogaId = prorrogaId;

  const u = (typeof DEMO_USERS !== "undefined") ? DEMO_USERS.find(x => x.id === p.uid) : null;
  const nombre = u?.nombre || p.uid;

  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setVal  = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

  setText("resolver-alumno-nombre", nombre);
  setText("resolver-tarea-titulo", tarea.titulo);
  setText("resolver-motivo", p.motivo || "(sin motivo)");
  setVal("resolver-fecha-original", tarea.fechaEntrega || "—");
  // Sugerencia inicial: 3 días después de hoy.
  const sugerida = new Date();
  sugerida.setDate(sugerida.getDate() + 3);
  setVal("resolver-nueva-fecha", sugerida.toISOString().slice(0, 10));
  // Slice prórrogas-polish (pre-c10 #4): impedir fechas pasadas en el date
  // picker. La validación dura vive en resolverProrrogaAccion; este min es
  // hint UX en el control nativo del browser.
  const inputFecha = document.getElementById("resolver-nueva-fecha");
  if (inputFecha) inputFecha.min = new Date().toISOString().slice(0, 10);
  setVal("resolver-nota", "");

  openModal("modal-resolver-prorroga");
}
window.abrirResolverProrroga = abrirResolverProrroga;

/**
 * @interaction resolver-prorroga-accion
 * @scope profesor (tareas)
 *
 * Given #modal-resolver-prorroga abierto con (_tpResolviendoTareaId,
 *   _tpResolviendoProrrogaId) seteados.
 * When el profesor hace click en "Aprobar" o "Rechazar".
 * Then aprobar: valida que #resolver-nueva-fecha tenga valor; llama
 *   resolverProrroga con accion="aprobar" + nuevaFecha + notaProfesor
 *   opcional; cierra el modal; toast verde; rebuild de la lista para que
 *   el chip desaparezca de la card y el panel se actualice. Rechazar:
 *   pide confirmación canónica (destructive), luego llama con accion=
 *   "rechazar" + notaProfesor opcional; toast info.
 * Edge si los IDs module-scope son null (estado roto), cancela y muestra
 *   error. Si nueva fecha está vacía al aprobar, toast error y no avanza.
 *   Si resolverProrroga retorna null (race / ya resuelta), toast error.
 */
async function resolverProrrogaAccion(accion) {
  const tareaId    = _tpResolviendoTareaId;
  const prorrogaId = _tpResolviendoProrrogaId;
  if (!tareaId || !prorrogaId) {
    showToast("Estado inválido: vuelve a abrir el panel", "error");
    return;
  }

  const notaProfesor = document.getElementById("resolver-nota")?.value || "";

  if (accion === "aprobar") {
    const nuevaFecha = document.getElementById("resolver-nueva-fecha")?.value || "";
    if (!nuevaFecha) {
      showToast("Indica una nueva fecha de entrega", "error");
      return;
    }
    // Slice prórrogas-polish (pre-c10 #4): validar que la nueva fecha sea
    // hoy o posterior. Bypasses del min HTML (consola, JS pegado) caen aquí.
    const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
    const nueva0 = new Date(nuevaFecha + "T00:00:00");
    if (isNaN(nueva0.getTime()) || nueva0 < hoy0) {
      showToast("La nueva fecha debe ser hoy o posterior", "error");
      return;
    }
    const r = (typeof resolverProrroga === "function")
      ? resolverProrroga(tareaId, prorrogaId, "aprobar", { nuevaFecha, notaProfesor })
      : null;
    if (!r) {
      showToast("No se pudo aprobar (ya fue resuelta)", "error");
      return;
    }
    _tpResolvedCleanup(tareaId);
    showToast(`✅ Prórroga aprobada · nueva fecha ${nuevaFecha}`, "success");
    return;
  }

  if (accion === "rechazar") {
    const ok = (typeof confirmarCanonico === "function")
      ? await confirmarCanonico({
          tipo: "danger",
          titulo: "Rechazar solicitud de prórroga",
          mensaje: "El alumno verá la respuesta. ¿Continuar?",
          aceptar: "Rechazar",
          cancelar: "Cancelar",
        })
      : window.confirm("¿Rechazar la solicitud de prórroga?");
    if (!ok) return;
    const r = (typeof resolverProrroga === "function")
      ? resolverProrroga(tareaId, prorrogaId, "rechazar", { notaProfesor })
      : null;
    if (!r) {
      showToast("No se pudo rechazar (ya fue resuelta)", "error");
      return;
    }
    _tpResolvedCleanup(tareaId);
    showToast("📭 Prórroga rechazada", "info");
    return;
  }
}
window.resolverProrrogaAccion = resolverProrrogaAccion;

// Limpieza compartida post-resolución (aprobar o rechazar): refresca el
// shape UI de tareas profesor, cierra el modal y resetea los IDs guard.
// Slice cerrar-parcial-integracion 2026-05-24: listener para que el tab
// Tareas re-rendee banner + chips + lock cuando el profesor cierra el
// parcial desde el header global estando dentro de este tab. Registro
// con guard window-level para no acumular handlers en re-logins.
if (typeof window !== "undefined" && !window.__tpParcialCerradoListener) {
    window.__tpParcialCerradoListener = true;
    window.addEventListener("parcialCerradoCambio", () => {
        if (typeof buildTareasProfesor === "function" && APP?.user?.tipo === "profesor") {
            buildTareasProfesor();
        }
    });
}

/**
 * @interaction tp-resolved-cleanup
 * @scope profesor-tareas-cleanup-prorroga
 *
 * Given tareaId post-resolución de prórroga (aprobar o rechazar).
 * When `resolverProrrogaAccion` (ya doc previa) termina de procesar
 *   la acción.
 * Then:
 *   1. **Re-sync TP_TAREAS[idx] con DEMO_TAREAS via `_tpFromDemo`**: el
 *      shared helper `resolverProrroga` muta DEMO_TAREAS directo
 *      (estado de la prórroga + posible nueva fecha de tarea); este
 *      re-sync trae los cambios al shape UI para que `_tpBuildList`
 *      vea las prórrogas actualizadas (chip count baja).
 *   2. Reset state (`_tpResolviendoTareaId` + `_tpResolviendoProrrogaId`).
 *   3. closeModal "modal-resolver-prorroga".
 *   4. Repaint.
 * Edge:
 *   - **DEMO_TAREAS no cargado o tarea ya no existe** → idx -1 → no re-sync
 *     (defensa).
 *   - **`_tpFromDemo` re-construye desde scratch** — pierde mutaciones
 *     in-memory NO persistidas a DEMO (e.g., un `_tpGuardarTarea` en edit
 *     NO se reflejaría en este re-sync porque no escribe a DEMO).
 *     Aceptable: el flujo de prórrogas es relativamente aislado del
 *     CRUD principal.
 *   - Helper LOCAL (sin window export).
 *   - Función IMPURA (TP_TAREAS mutation + state + DOM).
 *   - Deuda post-Supabase: subscription `tareas:id=eq.{id}` lo hace
 *     reactivo sin necesidad de re-sync manual.
 */
function _tpResolvedCleanup(tareaId) {
  // Re-sync el shape UI de la tarea (TP_TAREAS) con DEMO_TAREAS para que
  // _tpBuildList vea las prórrogas actualizadas.
  const fresh = (DEMO_TAREAS || []).find(x => x.id === tareaId);
  const idx   = TP_TAREAS.findIndex(x => x.id === tareaId);
  if (fresh && idx >= 0) TP_TAREAS[idx] = _tpFromDemo(fresh);
  _tpResolviendoTareaId    = null;
  _tpResolviendoProrrogaId = null;
  closeModal("modal-resolver-prorroga");
  if (typeof buildTareasProfesor === "function") buildTareasProfesor();
}
