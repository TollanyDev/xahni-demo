// ═══════════════════════════════════════════════════════════
// PRÓRROGAS — Helpers shared alumno/profesor
// Slice 2026-05-24 (loop alumno↔profesor cerrado)
// ═══════════════════════════════════════════════════════════
//
// Patrón validado en slice avatar (Opción A): mutar DEMO_TAREAS in-memory.
// Las prórrogas no son state per-user (no localStorage namespaced); cualquier
// consumidor lee de DEMO_TAREAS. Persistencia real llegará con Supabase.
//
// Shape de una prórroga (en tarea.prorrogas[]):
//   {
//     id:             "pr-<tareaId>-<uid>-<NNN>",
//     uid:            "estX",
//     motivo:         string libre (input del alumno),
//     fechaSolicitud: ISO "YYYY-MM-DDTHH:MM:SS",
//     estado:         "pendiente" | "aprobada" | "rechazada",
//     fechaResuelta:  ISO o null,
//     nuevaFecha:     ISO o null (solo si aprobada),
//     notaProfesor:   string o null (opcional al rechazar; opcional al aprobar)
//   }

// ── Generador de id único para una prórroga ──────────────────
// Formato pr-<tareaId>-<uid>-<NNN> donde NNN es contador secuencial.
/**
 * @interaction prorroga-nuevo-id
 * @scope shared-prorrogas-helper-internal
 *
 * Given tarea + uid del alumno solicitante.
 * When `solicitarProrroga` necesita asignar id único a una nueva entry
 *   en tarea.prorrogas[].
 * Then construye id formato `pr-{tareaId}-{uid}-{NNN}` donde NNN es
 *   counter secuencial 3-digit padded. Calcula NNN buscando ids
 *   existentes con mismo prefix, extrayendo el último NNN, y +1.
 *   Mantiene secuencia per (tareaId, uid): si el mismo alumno solicitó
 *   prórroga 2 veces (1ra rechazada, 2da nueva), va 001, 002.
 * Edge:
 *   - Sin prórrogas previas del mismo prefix → 001.
 *   - Ids legacy sin formato esperado (e.g. UUID) → filtered out por
 *     `parseInt isNaN`; no contribuyen al max.
 *   - tarea.prorrogas undefined/null → tratado como [].
 *   - NNN pasados 999 (1000+) → padStart genera string >3 dígitos (`1000`),
 *     no rompe lookup pero rompe orden lexicográfico. Deuda: ningún
 *     alumno solicitará 1000+ veces.
 *   - Deuda post-Supabase: UUID server-side reemplaza este pattern.
 */
function _prorrogaNuevoId(tarea, uid) {
    const prefix = `pr-${tarea.id}-${uid}-`;
    const existing = (tarea.prorrogas || [])
        .map(p => p.id)
        .filter(id => typeof id === "string" && id.startsWith(prefix))
        .map(id => parseInt(id.slice(prefix.length), 10))
        .filter(n => !isNaN(n));
    const next = (existing.length ? Math.max(...existing) : 0) + 1;
    return `${prefix}${String(next).padStart(3, "0")}`;
}

/**
 * Retorna las prórrogas pendientes (estado === "pendiente") de una tarea.
 * Si la tarea no existe o no tiene prorrogas, retorna [].
 *
 * @interaction get-prorrogas-pendientes-tarea
 * @scope shared-prorrogas-helper-canonical
 *
 * Given un tareaId.
 * When profesor tab Tareas necesita listar prórrogas a resolver para
 *   esa tarea (panel 📅 con badge count + lista alumnos).
 * Then busca tarea en DEMO_TAREAS, filtra prorrogas[] por estado
 *   "pendiente". Retorna array (puede ser vacío).
 * Edge:
 *   - DEMO_TAREAS no cargado → [].
 *   - tareaId no encontrado → [].
 *   - tarea sin prorrogas[] o no array → [].
 *   - Ninguna pendiente (todas resueltas) → [].
 *   - No filtra por uid → retorna pendientes de TODOS los alumnos
 *     (vista profesor consume así).
 */
function getProrrogasPendientesTarea(tareaId) {
    if (typeof DEMO_TAREAS === "undefined") return [];
    const t = DEMO_TAREAS.find(x => x.id === tareaId);
    if (!t || !Array.isArray(t.prorrogas)) return [];
    return t.prorrogas.filter(p => p.estado === "pendiente");
}

/**
 * Retorna la prórroga MÁS RECIENTE del uid en la tarea (cualquier estado),
 * o null si no tiene ninguna. Útil para que la card del alumno muestre el
 * estado actual de su solicitud.
 *
 * @interaction get-prorroga-usuario
 * @scope shared-prorrogas-helper-canonical
 *
 * Given tareaId + uid.
 * When un caller (hub-aprendizaje alumno card para chip estado;
 *   hub-calendario alumno para sufijo 📅; effectiveDueDate para resolución
 *   de vencido) necesita la prórroga ACTUAL del alumno en esa tarea.
 * Then filtra tarea.prorrogas[] por uid, ordena por fechaSolicitud DESC,
 *   retorna [0] (más reciente). Cualquier estado (pendiente/aprobada/
 *   rechazada).
 * Edge:
 *   - DEMO_TAREAS no cargado o uid falsy → null.
 *   - tarea no encontrada → null.
 *   - tarea sin prorrogas[] o sin entries de ese uid → null.
 *   - Múltiples del mismo uid (1 rechazada + 1 nueva) → retorna la
 *     NUEVA (sort DESC).
 *   - getProrrogasHistoricoUsuario complementa: retorna TODAS.
 */
function getProrrogaUsuario(tareaId, uid) {
    if (typeof DEMO_TAREAS === "undefined" || !uid) return null;
    const t = DEMO_TAREAS.find(x => x.id === tareaId);
    if (!t || !Array.isArray(t.prorrogas)) return null;
    const ofUser = t.prorrogas.filter(p => p.uid === uid);
    if (!ofUser.length) return null;
    // Ordenar por fechaSolicitud descendente; la más reciente es la "actual".
    return ofUser.sort((a, b) =>
        new Date(b.fechaSolicitud) - new Date(a.fechaSolicitud)
    )[0];
}

/**
 * @interaction solicitar-prorroga
 * @scope shared (consumido por hub-aprendizaje del alumno)
 *
 * Given un alumno (uid) intenta solicitar prórroga de una tarea (tareaId)
 *   con un motivo no vacío.
 * When se invoca solicitarProrroga(tareaId, uid, motivo).
 * Then si NO hay prórroga "pendiente" del mismo uid en esa tarea, crea una
 *   nueva entry con estado "pendiente" + fechaSolicitud=now, la añade a
 *   DEMO_TAREAS[i].prorrogas y retorna el objeto creado.
 * Edge si ya hay una "pendiente" del mismo uid, retorna null (el caller
 *   debe mostrar error). Las rechazadas no bloquean (puede volver a
 *   solicitar). Si la tarea no existe o motivo vacío, retorna null.
 */
function solicitarProrroga(tareaId, uid, motivo) {
    if (!tareaId || !uid || typeof motivo !== "string" || !motivo.trim()) return null;
    if (typeof DEMO_TAREAS === "undefined") return null;
    const t = DEMO_TAREAS.find(x => x.id === tareaId);
    if (!t) return null;
    if (!Array.isArray(t.prorrogas)) t.prorrogas = [];
    // Bloqueo: ya hay pendiente del mismo uid.
    const yaPendiente = t.prorrogas.some(p => p.uid === uid && p.estado === "pendiente");
    if (yaPendiente) return null;
    const nueva = {
        id:             _prorrogaNuevoId(t, uid),
        uid:            uid,
        motivo:         motivo.trim(),
        fechaSolicitud: new Date().toISOString(),
        estado:         "pendiente",
        fechaResuelta:  null,
        nuevaFecha:     null,
        notaProfesor:   null,
    };
    t.prorrogas.push(nueva);
    return nueva;
}

/**
 * @interaction resolver-prorroga
 * @scope shared (consumido por tareas profesor)
 *
 * Given una prórroga existente con estado "pendiente".
 * When el profesor invoca resolverProrroga(tareaId, prorrogaId, accion, opts)
 *   donde accion es "aprobar" o "rechazar". opts.nuevaFecha es requerida
 *   para aprobar; opts.notaProfesor es opcional.
 * Then la prórroga muta a estado "aprobada" (con nuevaFecha + notaProfesor
 *   opcional) o "rechazada" (con notaProfesor opcional). Setea fechaResuelta
 *   a now. Retorna la entry mutada.
 * Edge si la tarea/prorrogaId no existen, retorna null. Si la prórroga no
 *   está pendiente, retorna null (evita doble resolución por race). Si
 *   accion === "aprobar" y nuevaFecha está vacía, retorna null.
 */
function resolverProrroga(tareaId, prorrogaId, accion, opts) {
    if (typeof DEMO_TAREAS === "undefined") return null;
    if (!tareaId || !prorrogaId) return null;
    const t = DEMO_TAREAS.find(x => x.id === tareaId);
    if (!t || !Array.isArray(t.prorrogas)) return null;
    const p = t.prorrogas.find(x => x.id === prorrogaId);
    if (!p || p.estado !== "pendiente") return null;
    const o = opts || {};
    if (accion === "aprobar") {
        if (!o.nuevaFecha) return null;
        p.estado        = "aprobada";
        p.nuevaFecha    = o.nuevaFecha;
        p.notaProfesor  = (typeof o.notaProfesor === "string" && o.notaProfesor.trim()) ? o.notaProfesor.trim() : null;
        p.fechaResuelta = new Date().toISOString();
        return p;
    }
    if (accion === "rechazar") {
        p.estado        = "rechazada";
        p.notaProfesor  = (typeof o.notaProfesor === "string" && o.notaProfesor.trim()) ? o.notaProfesor.trim() : null;
        p.fechaResuelta = new Date().toISOString();
        return p;
    }
    return null;
}

/**
 * Slice prórrogas-polish (pre-c10 #4): retorna la fecha de entrega EFECTIVA
 * para un alumno×tarea. Si el alumno tiene prórroga aprobada para esa tarea,
 * retorna pror.nuevaFecha; si no, retorna t.fechaEntrega tal cual.
 *
 * Útil para que el cálculo de "vencido" respete las prórrogas aprobadas
 * cross-vista. Llamadores deben pasar uid del alumno cuya perspectiva
 * computa el vencido. Sin uid o tarea inválida → retorna t.fechaEntrega
 * (default seguro: comportamiento legacy).
 *
 * @interaction effective-due-date
 * @scope shared-prorrogas-helper-canonical-cross-vista
 *
 * Given tarea t + uid opcional.
 * When un caller (hub-calendario alumno para clasificación tarea/vencida;
 *   data-service _filtrarTareas para case "vencida"; data-provider estudiante
 *   para TAREAS_DATA derivado) necesita la fecha efectiva considerando
 *   prórrogas.
 * Then resolución cascada:
 *   1. Sin tarea → null.
 *   2. original = t.fechaEntrega || t.fechaIso || null.
 *   3. Sin uid → original (perspectiva profesor o sin contexto user).
 *   4. Busca pror del uid via getProrrogaUsuario; si estado "aprobada"
 *      Y nuevaFecha → retorna nuevaFecha.
 *   5. Sino → retorna original.
 * Edge:
 *   - 3 sitios consumen el helper (cross-archivo): data-service:783,
 *     hub-calendario estudiante:86, data-provider estudiante:147.
 *   - builders-core:432 (vencida en card) lo recibe TRANSITIVAMENTE vía
 *     TAREAS_DATA derivado en data-provider.
 *   - profesor/hub-calendario.js:82 NO lo usa (vista global, sin uid
 *     per-alumno).
 *   - pror.estado === "pendiente" o "rechazada" → fecha original (no
 *     aplica extensión).
 */
function effectiveDueDate(t, uid) {
    if (!t) return null;
    const original = t.fechaEntrega || t.fechaIso || null;
    if (!uid) return original;
    const pror = getProrrogaUsuario(t.id, uid);
    if (pror && pror.estado === "aprobada" && pror.nuevaFecha) {
        return pror.nuevaFecha;
    }
    return original;
}

/**
 * Slice prórrogas-polish (pre-c10 #4): retorna TODAS las prórrogas del uid
 * en la tarea, ordenadas por fechaSolicitud DESC (más reciente primero).
 * Tarea sin entries → []. Útil para timeline/tooltip de historial.
 *
 * @interaction get-prorrogas-historico-usuario
 * @scope shared-prorrogas-helper-canonical
 *
 * Given tareaId + uid.
 * When un caller (hub-aprendizaje card chip tooltip con historial cuando
 *   >1 prórroga; modal detalle tarea alumno futuro) necesita la lista
 *   completa de prórrogas del alumno en esa tarea.
 * Then filtra prorrogas[] por uid, sort DESC por fechaSolicitud. Retorna
 *   array (puede tener entries con cualquier estado, sin distinción).
 * Edge:
 *   - DEMO_TAREAS no cargado o uid falsy → [].
 *   - tarea no encontrada o sin prorrogas → [].
 *   - Diferencia con getProrrogaUsuario: éste retorna TODAS; aquel
 *     retorna SOLO la más reciente.
 *   - Caller del slice prórrogas-polish (hub-aprendizaje.js) usa slice(1)
 *     sobre el resultado para obtener "historial previo" (excluyendo la
 *     actual que ya se muestra como chip principal).
 */
function getProrrogasHistoricoUsuario(tareaId, uid) {
    if (typeof DEMO_TAREAS === "undefined" || !uid) return [];
    const t = DEMO_TAREAS.find(x => x.id === tareaId);
    if (!t || !Array.isArray(t.prorrogas)) return [];
    return t.prorrogas
        .filter(p => p.uid === uid)
        .sort((a, b) => new Date(b.fechaSolicitud) - new Date(a.fechaSolicitud));
}

// Exponer en window para consumidores cross-módulo (vanilla, sin imports).
if (typeof window !== "undefined") {
    window.getProrrogasPendientesTarea = getProrrogasPendientesTarea;
    window.getProrrogaUsuario          = getProrrogaUsuario;
    window.solicitarProrroga           = solicitarProrroga;
    window.resolverProrroga            = resolverProrroga;
    window.effectiveDueDate            = effectiveDueDate;
    window.getProrrogasHistoricoUsuario = getProrrogasHistoricoUsuario;
}
