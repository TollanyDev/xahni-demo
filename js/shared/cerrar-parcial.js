// ═══════════════════════════════════════════════════════════
// CERRAR PARCIAL — Helpers shared profesor/alumno
// Slice cerrar-parcial-integracion 2026-05-24
// ═══════════════════════════════════════════════════════════
//
// Estado "cerrado" vive en DEMO_ESCALAS[i].cerrado (boolean) + cerradoAt
// (ISO). Lo setea _cerrarParcialConfirm en js/profesor/gestion.js.
// Estos helpers exponen consultas read-only consumidas cross-vista para
// que tab Tareas + tab Asistencia profesor + vista alumno respeten el
// estado sin re-implementar la lectura.
//
// Tarea → parcial: no hay campo explícito. Se deriva por fechaEntrega
// dentro del rango [parcial.inicio, parcial.fin] del periodo del grupo.

/**
 * @returns {boolean} true si la escala existe Y tiene cerrado===true.
 *   false si no existe escala o no está cerrada.
 *
 * @interaction is-parcial-cerrado
 * @scope shared-cerrar-parcial-helper-canonical
 *
 * Given matId + grupoId + parcialNum (los 3 requeridos).
 * When un caller cross-vista (tab Tareas profesor para deshabilitar
 *   editar/eliminar; tab Asistencia profesor para bloquear capture;
 *   hub-aprendizaje alumno para mostrar chip "🔒 Cerrado") necesita
 *   saber si el parcial está cerrado.
 * Then construye escalaId canónico `${matId}_${grupoId}_${parcialNum}`,
 *   busca la escala en DEMO_ESCALAS, y retorna true si existe Y tiene
 *   campo `cerrado === true`.
 * Edge:
 *   - Cualquiera de los 3 args falsy → false (defensa).
 *   - DEMO_ESCALAS no cargado o no array → false.
 *   - Escala no existe (futuro parcial no creado aún) → false.
 *   - Escala con cerrado=undefined o false → false.
 *   - Slice cerrar-parcial-integracion (2026-05-24) cementó el estado
 *     `cerrado` + `cerradoAt` en DEMO_ESCALAS. Setter vive en
 *     `_cerrarParcialConfirm` (js/profesor/gestion.js).
 *   - Deuda post-Supabase: query `escalas.cerrado` directo.
 */
function isParcialCerrado(matId, grupoId, parcialNum) {
    if (!matId || !grupoId || !parcialNum) return false;
    if (typeof DEMO_ESCALAS === "undefined" || !Array.isArray(DEMO_ESCALAS)) return false;
    const escalaId = `${matId}_${grupoId}_${parcialNum}`;
    const e = DEMO_ESCALAS.find(x => x.id === escalaId);
    return !!(e && e.cerrado === true);
}

/**
 * Deriva el número del parcial al que pertenece una tarea según su
 * fechaEntrega cruzada con el periodo del grupo.
 *
 * @param {Object} tarea con fechaEntrega (ISO string).
 * @param {string} grupoIdOverride opcional; si no, usa tarea.grupoId.
 * @returns {number | null} num del parcial, o null si no encaja en ninguno.
 *
 * @interaction get-parcial-de-tarea
 * @scope shared-cerrar-parcial-helper-canonical
 *
 * Given tarea con fechaEntrega (ISO) + grupoIdOverride opcional.
 * When un caller necesita saber a qué parcial (1, 2 o 3 típicamente)
 *   pertenece una tarea para chequear su lock-state (isTareaParcialCerrado)
 *   o aplicar políticas de calificación.
 * Then resolución cascada:
 *   1. grupoId = grupoIdOverride o tarea.grupoId.
 *   2. Busca grupo en DEMO_GRUPOS y su periodo.parciales[].
 *   3. Parsea fechaEntrega y itera parciales: retorna p.num del primer
 *      parcial cuyo rango [inicio, fin 23:59:59] contiene la fecha.
 * Edge:
 *   - tarea null o sin fechaEntrega → null.
 *   - grupoId no resolvible (sin override + sin tarea.grupoId) → null.
 *   - DEMO_GRUPOS no cargado → null.
 *   - Grupo no encontrado o sin periodo o sin parciales → null.
 *   - fechaEntrega inválida (NaN) → null.
 *   - fechaEntrega fuera de TODOS los rangos parciales (vacaciones,
 *     pre-inicio, post-fin) → null.
 *   - "Tarea → parcial: no hay campo explícito" (decisión schema): se
 *     deriva en runtime para evitar drift entre fechaEntrega y parcial
 *     persistido.
 *   - Deuda post-Supabase: query `tareas.parcial_num` si se decide
 *     denormalizar para perf en queries.
 */
function getParcialDeTarea(tarea, grupoIdOverride) {
    if (!tarea || !tarea.fechaEntrega) return null;
    const grupoId = grupoIdOverride || tarea.grupoId;
    if (!grupoId || typeof DEMO_GRUPOS === "undefined") return null;
    const grupo = DEMO_GRUPOS.find(g => g.id === grupoId);
    if (!grupo || !grupo.periodo || !Array.isArray(grupo.periodo.parciales)) return null;
    const f = new Date(tarea.fechaEntrega);
    if (isNaN(f)) return null;
    const p = grupo.periodo.parciales.find(x => {
        const ini = new Date(x.inicio);
        const fin = new Date((x.fin || "") + "T23:59:59");
        return f >= ini && f <= fin;
    });
    return p ? p.num : null;
}

/**
 * Conveniencia: getParcialDeTarea + isParcialCerrado en una sola consulta.
 *
 * @returns {boolean} true si la tarea pertenece a un parcial cuya escala
 *   existe y está cerrada. false si no aplica el cierre (sin parcial,
 *   sin escala, o escala abierta).
 *
 * @interaction is-tarea-parcial-cerrado
 * @scope shared-cerrar-parcial-canonical-cross-vista
 *
 * Given tarea + grupoIdOverride opcional.
 * When un caller (hub-aprendizaje alumno para chip "🔒"; tareas profesor
 *   para deshabilitar editar/eliminar; data-provider para action gates)
 *   necesita single-shot check de lock-state.
 * Then encadena `getParcialDeTarea` + `isParcialCerrado`. Si la tarea no
 *   tiene parcial (fecha fuera de rango), retorna false (cierre no aplica).
 * Edge:
 *   - num null (sin parcial resolvible) → false.
 *   - Escala del parcial no existe o no cerrada → false.
 *   - Es el helper más usado cross-vista del módulo (preferir éste sobre
 *     llamadas separadas).
 */
function isTareaParcialCerrado(tarea, grupoIdOverride) {
    const num = getParcialDeTarea(tarea, grupoIdOverride);
    if (!num) return false;
    const grupoId = grupoIdOverride || tarea.grupoId;
    return isParcialCerrado(tarea.materiaId, grupoId, num);
}

// Exponer en window para consumidores cross-módulo (vanilla, sin imports).
if (typeof window !== "undefined") {
    window.isParcialCerrado     = isParcialCerrado;
    window.getParcialDeTarea    = getParcialDeTarea;
    window.isTareaParcialCerrado = isTareaParcialCerrado;
}
