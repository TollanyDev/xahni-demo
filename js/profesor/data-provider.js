// ═══════════════════════════════════════════════════════════
// DATA PROVIDER — Profesor
// Getters que derivan vistas del profesor en vivo desde los
// DEMO_* globales (modo demo) o Firebase (modo prod, vía DataService).
// Espejo del patrón en js/estudiante/data-provider.js.
// ═══════════════════════════════════════════════════════════

/**
 * @interaction hay-datos-prof-guard
 * @scope profesor-data-provider-guard
 *
 * Given el entorno de runtime (DEMO_* pueden no haber cargado aún en
 *   parse temprano, o estar deshabilitados en modo prod legacy).
 * When cualquier getter del data-provider profesor necesita decidir si
 *   continuar o early-return con shape vacío.
 * Then chequea que `DEMO_USERS`, `DEMO_MATERIAS`, `DEMO_TAREAS` existan Y
 *   sean arrays. Retorna boolean.
 * Edge:
 *   - NO chequea DEMO_GRUPOS — los callers que lo necesitan hacen
 *     `(typeof DEMO_GRUPOS !== "undefined" ? DEMO_GRUPOS : [])` inline.
 *     Decisión histórica: USERS+MATERIAS+TAREAS son los 3 obligatorios
 *     mínimos del rol; resto es opcional.
 *   - typeof undefined check evita ReferenceError en parse temprano.
 *   - Helper LOCAL (sin window.fn export); consumed solo por
 *     `_profDataBase`.
 *   - Migración Supabase: este guard desaparece (init de DataService garantiza
 *     hidratación antes del primer render).
 */
function _hayDatosProf() {
    return typeof DEMO_USERS    !== "undefined" && Array.isArray(DEMO_USERS)
        && typeof DEMO_MATERIAS !== "undefined" && Array.isArray(DEMO_MATERIAS)
        && typeof DEMO_TAREAS   !== "undefined" && Array.isArray(DEMO_TAREAS);
}

// ── Núcleo común de reducción para el profesor ─────────────────────
// Devuelve la estructura base que comparten los 4 reductores del profesor
// (`getMateriasProfesor`, `getProfMateriasData`, `getProfGestionData`,
// `getProfDashData`). Cada consumidor enriquece con su shape visual.
// Centraliza el filtrado de materias/tareas por `profesorId` y la
// derivación de estudiantes para no duplicar la lectura cruda de DEMO_*.
//
// Retorna `null` si no hay datos o el profesor no tiene materias asignadas.
/**
 * @interaction prof-data-base-core-reduction
 * @scope profesor-data-provider-core-reduction
 *
 * Given uid del profesor logueado.
 * When CUALQUIERA de los 4 reductores grandes del profesor necesita el
 *   shape base compartido (`getMateriasProfesor`, `getProfMateriasData`,
 *   `getProfGestionData`, `getProfDashData`). Centraliza el filtrado de
 *   materias/tareas por `profesorId` + derivación de estudiantes.
 * Then resolución:
 *   1. uid falsy o `_hayDatosProf` false → null (caller hace early return
 *      con shape vacío propio).
 *   2. `materias = DEMO_MATERIAS.filter(m => m.profesorId === uid)`.
 *      **NO filtra estado="archivada"** — eso es decisión del caller
 *      (getMateriasProfesor SÍ filtra; getProfDashData no).
 *   3. Sin materias asignadas → null (early return; profesor recién creado
 *      o sin asignación admin).
 *   4. grupos = DEMO_GRUPOS completo (sin filtrar; los callers cruzan
 *      por `materia.grupos[]` después).
 *   5. tareas = DEMO_TAREAS.filter(profesorId === uid).
 *   6. estudiantes = DEMO_USERS.filter(tipo === "estudiante") (TODOS los
 *      estudiantes, callers filtran por miembros del grupo).
 * Edge:
 *   - DEMO_GRUPOS sin guard typeof porque `_hayDatosProf` no lo verifica;
 *     fallback `[]` inline. Si llega vacío, callers manejan con maps
 *     vacíos sin crash.
 *   - **Encapsulación intencional**: NO `window._profDataBase` export.
 *     Solo callers en mismo archivo (data-provider) y archivos colaterales
 *     del rol (mismaterias, dashboard, gestion) que llaman via
 *     `typeof _profDataBase === "function" ? _profDataBase(uid) : null`
 *     (defensa por orden de carga).
 *   - Función PURA: shallow copy de arrays (filter retorna nuevo array)
 *     pero NO copia entidades — mutar materias/tareas/users del retorno
 *     SÍ muta globals.
 *   - Deuda post-Supabase: query unificada con joins SQL reemplaza el
 *     filtro cliente cross-array.
 */
function _profDataBase(uid) {
    if (!uid || !_hayDatosProf()) return null;
    const materias = (DEMO_MATERIAS || []).filter(m => m.profesorId === uid);
    if (!materias.length) return null;
    const grupos      = (typeof DEMO_GRUPOS !== "undefined" ? DEMO_GRUPOS : []);
    const tareas      = (DEMO_TAREAS || []).filter(t => t.profesorId === uid);
    const estudiantes = (DEMO_USERS  || []).filter(u => u.tipo === "estudiante");
    return { materias, grupos, tareas, estudiantes };
}

// ── Materias que imparte el profesor ────────────────────────
// Devuelve la lista de materias del catálogo donde profesorId === uid,
// con conteo de grupos asignados y total de alumnos en esos grupos.
//
// 4.E: filtra implícitamente las materias archivadas (`m.estado === "archivada"`).
// El profesor mira "qué imparto ahora"; las archivadas se preservan para que
// el alumno siga viendo su historial de calificaciones (asimetría deliberada —
// el estudiante NO filtra por estado en su data-provider porque user.materias[]
// es su fuente de verdad y debe incluir histórico).
/**
 * @interaction get-materias-profesor
 * @scope profesor-data-provider-public
 *
 * Given uid del profesor + grupoIdActivo opcional (selector de grupo del hub).
 * When un caller necesita "qué materias imparto AHORA" (no histórico) con
 *   conteo de grupos + total alumnos + periodo del grupo activo (o el primero
 *   si no se proveyó activo).
 * Then:
 *   1. Resuelve `_profDataBase(uid)` → null si sin datos / sin materias.
 *   2. Filtra `m.estado !== "archivada"` (slice 4.E). **Asimetría
 *      deliberada con el alumno**: el estudiante NO filtra estado en su
 *      data-provider porque user.materias[] es su fuente de verdad y
 *      debe incluir histórico de calificaciones de materias archivadas.
 *      El profesor mira "qué imparto ahora"; archivadas se preservan
 *      para que el alumno siga viendo su historial.
 *   3. Por cada materia:
 *      - totalAlumnos = sum(grupo.miembros.length) sobre grupos asignados.
 *      - gidPeriodo = grupoIdActivo si está incluido en m.grupos, else
 *        primer grupo asignado.
 *      - periodo = getPeriodoDeGrupo(gidPeriodo).
 *      - periodoInfo = getPeriodoInfo(periodo) (parciales con estado).
 *   4. Retorna lista uniforme con { id, nombre, clave, clasificacionId,
 *      grupos, gruposCount, totalAlumnos, periodo, periodoInfo }.
 * Edge:
 *   - `_profDataBase` null → `[]` (no `null`).
 *   - grupoIdActivo no en m.grupos → cae al primer grupo (puede ser
 *     undefined si materia sin grupos → periodo null).
 *   - Materia sin grupos asignados (admin sin terminar setup) →
 *     totalAlumnos=0, grupos=[], periodo=null.
 *   - `getPeriodoDeGrupo`/`getPeriodoInfo` deben estar cargados (helpers
 *     core/periodo.js). Convención: cargados antes que data-provider del rol.
 *   - Función PURA: retorna array nuevo de objetos nuevos. Los grupos[]
 *     se copian por referencia (shallow); mutar el array sí mutaría el
 *     subtree de la materia original. Convención: callers no mutan.
 *   - Deuda post-Supabase: vista materializada `mis_materias_view` con
 *     joins + aggregates en SQL.
 */
function getMateriasProfesor(uid, grupoIdActivo = null) {
    const base = _profDataBase(uid);
    if (!base) return [];
    const mis = base.materias.filter(m => m.estado !== "archivada");
    const todosGrupos = base.grupos;

    return mis.map(m => {
        const grupos = m.grupos || [];
        const totalAlumnos = grupos.reduce((sum, gid) => {
            const g = todosGrupos.find(x => x.id === gid);
            return sum + (g?.miembros?.length || 0);
        }, 0);
        const gidPeriodo = grupoIdActivo && grupos.includes(grupoIdActivo)
            ? grupoIdActivo
            : grupos[0];
        const periodo = getPeriodoDeGrupo(gidPeriodo);
        return {
            id:           m.id,
            nombre:       m.nombre,
            clave:        m.clave,
            clasificacionId: m.clasificacionId,
            grupos,
            gruposCount:  grupos.length,
            totalAlumnos,
            periodo,
            periodoInfo:  getPeriodoInfo(periodo),
        };
    });
}

// ── Actividad reciente del profesor ─────────────────────────
// Para perfil-actividad. Recopila las últimas entregas hechas por alumnos
// a tareas del profesor (max 5), con nombre del alumno resuelto.
/**
 * @interaction get-actividad-profesor
 * @scope profesor-data-provider-public
 *
 * Given uid del profesor + limit opcional (default 5).
 * When perfil-actividad (Pilar 2 sección Actividad reciente) o cualquier
 *   widget de feed necesita las últimas entregas hechas por alumnos a
 *   tareas del profesor, sorted desc por fecha.
 * Then:
 *   1. Resuelve `_profDataBase(uid)` → null → `[]`.
 *   2. Itera tareas del profesor × entregas[]. Por cada entrega con `.fecha`:
 *      - Resuelve alumno desde estudiantes (filtrado por tipo).
 *      - Push evento { fecha (Date), fechaIso, tareaTitulo, tareaId,
 *        alumnoId, alumnoNombre (resuelto), calificacion (puede ser null).
 *   3. Sort desc por fecha.
 *   4. Retorna slice(0, limit).
 * Edge:
 *   - limit undefined → 5; limit 0 → arr.slice(0,0)=[] (caller debería
 *     pasar > 0).
 *   - Entregas sin `.fecha` → skip silencioso.
 *   - alumno no encontrado en DEMO_USERS → alumnoNombre cae a `e.uid`
 *     (defensivo; idealmente todos los uids de entregas matchean).
 *   - calificacion null permitido en la salida (caller distingue
 *     pendientes de calificadas en UI).
 *   - Función PURA: array de objetos nuevos, sin mutación de globals.
 *   - Deuda post-Supabase: vista `prof_actividad_reciente` con LIMIT en SQL.
 */
function getActividadProfesor(uid, limit) {
    const base = _profDataBase(uid);
    if (!base) return [];
    const max  = limit || 5;
    const eventos = [];
    base.tareas.forEach(t => {
        (t.entregas || []).forEach(e => {
            if (!e.fecha) return;
            const alumno = base.estudiantes.find(u => u.id === e.uid);
            eventos.push({
                fecha:        new Date(e.fecha),
                fechaIso:     e.fecha,
                tareaTitulo:  t.titulo,
                tareaId:      t.id,
                alumnoId:     e.uid,
                alumnoNombre: alumno?.nombre || e.uid,
                calificacion: e.calificacion ?? null,
            });
        });
    });
    eventos.sort((a, b) => b.fecha - a.fecha);
    return eventos.slice(0, max);
}

// ═══════════════════════════════════════════════════════════
// C9 · Helpers para hub-grupo profesor (selector + KPIs)
// ═══════════════════════════════════════════════════════════

/**
 * @interaction get-grupos-del-profesor
 * @scope profesor-data-provider-public-c9
 *
 * Given uid del profesor.
 * When el hub-shell construye el dropdown de "Grupo activo" en hub-grupo,
 *   o cualquier vista necesita la lista de grupos donde imparte (no solo ids).
 * Then:
 *   1. Lee DEMO_MATERIAS (con guard typeof inline; permite ser llamado
 *      muy temprano sin crash) y DEMO_GRUPOS.
 *   2. Filtra materias por profesorId === uid AND estado !== "archivada"
 *      (consistente con `getMateriasProfesor`).
 *   3. Recolecta ids de grupos en Set para dedupe (un grupo puede tener
 *      varias materias mías).
 *   4. Resuelve ids → objetos Grupo (filter Boolean para descartar ids
 *      huérfanos).
 *   5. Retorna array.
 * Edge:
 *   - uid falsy → `[]`.
 *   - DEMO_MATERIAS / DEMO_GRUPOS no cargados → `[]`.
 *   - Materia archivada → sus grupos NO entran (a menos que otra materia
 *     no archivada del mismo profesor también esté en ese grupo).
 *   - Grupo con id en materia pero no en DEMO_GRUPOS (drift de seed) →
 *     filter Boolean lo elimina silenciosamente.
 *   - Función PURA: retorna array nuevo.
 *   - Slice C9 (cementado): sin ESTA fn, el hub-shell no podía construir
 *     el switcher cross-tab del rol profesor.
 *   - Deuda post-Supabase: vista `grupos_profesor_view` con JOIN.
 */
function getGruposDelProfesor(uid) {
    if (!uid) return [];
    const materias = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : []);
    const grupos = (typeof DEMO_GRUPOS !== "undefined" ? DEMO_GRUPOS : []);
    const set = new Set();
    materias
        .filter(m => m.profesorId === uid && m.estado !== "archivada")
        .forEach(m => (m.grupos || []).forEach(gid => set.add(gid)));
    return Array.from(set)
        .map(gid => grupos.find(g => g.id === gid))
        .filter(Boolean);
}

/**
 * @interaction get-materias-prof-grupo
 * @scope profesor-data-provider-public-c9
 *
 * Given uid del profesor + grupoId del grupo activo.
 * When las vistas del hub-grupo (tab Materias, tab Gestión, KPIs) necesitan
 *   restringir las materias del profesor a las que imparte EN ese grupo
 *   específico (no en todos sus grupos).
 * Then filtra DEMO_MATERIAS por:
 *   1. profesorId === uid
 *   2. estado !== "archivada"
 *   3. grupoId está en m.grupos[]
 * Edge:
 *   - uid o grupoId falsy → `[]`.
 *   - DEMO_MATERIAS no cargado → `[]`.
 *   - Función PURA: retorna array nuevo (filter).
 *   - Mantiene asimetría histórica de filtro archivadas igual que
 *     `getMateriasProfesor` + `getGruposDelProfesor`.
 *   - Deuda post-Supabase: query con WHERE grupos.id @> ARRAY[$grupoId].
 */
function getMateriasProfGrupo(uid, grupoId) {
    if (!uid || !grupoId) return [];
    const materias = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : []);
    return materias.filter(m =>
        m.profesorId === uid &&
        m.estado !== "archivada" &&
        (m.grupos || []).includes(grupoId)
    );
}

/**
 * @interaction get-alumnos-grupo
 * @scope profesor-data-provider-public-cross-rol
 *
 * Given grupoId.
 * When un caller necesita los User objects de los miembros de un grupo
 *   (vs solo ids en `grupo.miembros[]`). Útil para hub-grupo profesor
 *   (lista de alumnos con nombre/iniciales/avatar), gestión académica,
 *   y vistas espejadas.
 * Then:
 *   1. Lookup grupo en DEMO_GRUPOS.
 *   2. Resuelve `grupo.miembros[]` → DEMO_USERS por id.
 *   3. filter Boolean para descartar uids huérfanos.
 * Edge:
 *   - grupoId falsy → `[]`.
 *   - DEMO_GRUPOS / DEMO_USERS no cargados → `[]`.
 *   - Grupo no encontrado → `[]`.
 *   - Miembros con uid sin user en DEMO_USERS (drift) → filtrado.
 *   - **CROSS-ROL semantically**: la fn no presupone tipo del caller; el
 *     admin también podría usarla.
 *   - Función PURA: array nuevo de referencias a User objects (mutar al
 *     User retornado SÍ muta el global).
 *   - Deuda post-Supabase: query `users WHERE id = ANY(grupo.miembros)`.
 */
function getAlumnosGrupo(grupoId) {
    if (!grupoId) return [];
    const grupos = (typeof DEMO_GRUPOS !== "undefined" ? DEMO_GRUPOS : []);
    const usuarios = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []);
    const grupo = grupos.find(g => g.id === grupoId);
    if (!grupo) return [];
    return (grupo.miembros || [])
        .map(uid => usuarios.find(u => u.id === uid))
        .filter(Boolean);
}

/**
 * @interaction get-parcial-activo
 * @scope profesor-data-provider-helper-internal
 *
 * Given grupoId.
 * When los 3 getters de KPI cross-materia (`getPromedioGrupoCrossMat`,
 *   `getAlumnosEnRiesgo`, `getTopBottomAlumnos`) necesitan saber qué
 *   parcial pertenece "ahora" para calcular calificaciones por defecto.
 * Then resolución cascada:
 *   1. grupoId falsy o `getPeriodoDeGrupo`/`getPeriodoInfo` ausentes → 2.
 *   2. Resuelve `periodo` del grupo. Si null → 2.
 *   3. Resuelve `info` con parciales[]. Sin parciales → 2.
 *   4. Encuentra parcial.estado === "activo" → su num.
 *   5. Si ninguno activo: último cerrado (reverse find) → su num.
 *   6. Si ninguno cerrado: primer futuro → su num.
 *   7. Fallback final → 2 (asume parcial 2/3 como middle ground).
 * Edge:
 *   - **Fallback 2 es opinión, no spec**: cuando el periodo está mal
 *     configurado o no existe, retornamos 2 (medio del semestre) en vez
 *     de null para que los KPIs muestren algo útil. Caller debería
 *     idealmente checar la consistencia, pero todos los callers actuales
 *     consumen el num directo.
 *   - **`info.parciales` MUTACIÓN-SAFE**: el `[...].reverse()` crea copia
 *     antes de reverse (no muta el array del periodo cacheado).
 *   - Helper LOCAL (sin window export). Consumed solo por los 3 KPIs C9.
 *   - Función PURA respecto a inputs.
 *   - Deuda post-Supabase: campo computado `parcial_activo_num` en vista
 *     `grupo_periodo_view` calcula por NOW() vs periodos.fechas.
 */
function _getParcialActivo(grupoId) {
    if (!grupoId) return 2;
    if (typeof getPeriodoDeGrupo !== "function" || typeof getPeriodoInfo !== "function") return 2;
    const periodo = getPeriodoDeGrupo(grupoId);
    if (!periodo) return 2;
    const info = getPeriodoInfo(periodo);
    if (!info || !Array.isArray(info.parciales) || info.parciales.length === 0) return 2;
    const activo = info.parciales.find(p => p.estado === "activo");
    if (activo) return activo.num;
    const ultimoCerrado = [...info.parciales].reverse().find(p => p.estado === "cerrado");
    if (ultimoCerrado) return ultimoCerrado.num;
    const primerFuturo = info.parciales.find(p => p.estado === "futuro");
    if (primerFuturo) return primerFuturo.num;
    return 2;
}

/**
 * @interaction get-promedio-grupo-cross-mat
 * @scope profesor-data-provider-public-c9-kpi
 *
 * Given uid del profesor + grupoId del grupo activo.
 * When hub-grupo profesor (KPI "Promedio del grupo en este parcial")
 *   muestra el numero principal del card de rendimiento.
 * Then:
 *   1. Resuelve materias del prof × grupo (`getMateriasProfGrupo`).
 *   2. Resuelve alumnos del grupo (`getAlumnosGrupo`).
 *   3. Determina parcial activo (`_getParcialActivo`).
 *   4. Doble loop alumnos × materias → suma calFinal no-null
 *      (`getCalFinalAlumnoMatParcial` del shared helper).
 *   5. Retorna sum/count, o null si denominador 0.
 * Edge:
 *   - uid o grupoId falsy → null.
 *   - Sin materias o sin alumnos → loop no ejecuta → null.
 *   - Alumno con 0 calificaciones cargadas → no contribuye (no falsea promedio).
 *   - Resultado es número 0-10 (escala XAHNI). Caller hace toFixed(1).
 *   - **A2 consolidación**: nombre del comentario refiere al Slice A2 que
 *     consolidó `getCalFinalAlumnoMatParcial` en js/shared/calificaciones-calc.js.
 *   - Función PURA: suma local, no muta inputs.
 *   - Deuda post-Supabase: vista materializada con `AVG(calificacion_final)
 *     OVER (PARTITION BY grupo, parcial)`.
 */
function getPromedioGrupoCrossMat(uid, grupoId) {
    if (!uid || !grupoId) return null;
    const materias = getMateriasProfGrupo(uid, grupoId);
    const alumnos = getAlumnosGrupo(grupoId);
    const parcial = _getParcialActivo(grupoId);
    let sum = 0, n = 0;
    alumnos.forEach(a => {
        materias.forEach(m => {
            const cal = getCalFinalAlumnoMatParcial(a.id, m.id, grupoId, parcial);
            if (cal != null) { sum += cal; n++; }
        });
    });
    return n > 0 ? sum / n : null;
}

/**
 * @interaction get-alumnos-en-riesgo
 * @scope profesor-data-provider-public-c9-kpi
 *
 * Given uid del profesor + grupoId + umbral opcional (default 7).
 * When hub-grupo profesor (KPI "Alumnos en riesgo") muestra el badge con
 *   conteo + lista expandible.
 * Then:
 *   1. Materias del prof × grupo (`getMateriasProfGrupo`).
 *   2. Alumnos del grupo (`getAlumnosGrupo`).
 *   3. Parcial activo (`_getParcialActivo`).
 *   4. Filtra alumnos donde AL MENOS UNA materia mía tiene calFinal < umbral
 *      (en este parcial). Operador `.some()` — un solo bajo basta.
 * Edge:
 *   - umbral null → 7. Explicito el chequeo `umbral == null` (no `!umbral`)
 *     para no convertir 0 en 7. (Aunque umbral 0 no tendría sentido.)
 *   - uid o grupoId falsy → `[]`.
 *   - Alumno sin calificaciones (nuevo o sin cargar) → `.some()` retorna false
 *     → no se incluye en riesgo. Decisión: ausencia ≠ riesgo (debería ser
 *     "pendiente de calificar", otro flag).
 *   - **Umbral 7 (no 6)** consistente con `getProfDashData.riesgo`:
 *     incluye reprobando duros (<6) Y regulares (6-7) para que el profesor
 *     atienda la franja completa.
 *   - Función PURA.
 *   - Deuda post-Supabase: filtro reactivo via realtime subscription.
 */
function getAlumnosEnRiesgo(uid, grupoId, umbral) {
    if (umbral == null) umbral = 7;
    if (!uid || !grupoId) return [];
    const materias = getMateriasProfGrupo(uid, grupoId);
    const alumnos = getAlumnosGrupo(grupoId);
    const parcial = _getParcialActivo(grupoId);
    return alumnos.filter(a =>
        materias.some(m => {
            const cal = getCalFinalAlumnoMatParcial(a.id, m.id, grupoId, parcial);
            return cal != null && cal < umbral;
        })
    );
}

/**
 * @interaction get-top-bottom-alumnos
 * @scope profesor-data-provider-public-c9-kpi
 *
 * Given uid del profesor + grupoId + n opcional (default 3 = top 3 + bottom 3).
 * When hub-grupo profesor (KPI ranking "Mejores 3" / "Atención necesaria 3")
 *   muestra dos listas paralelas.
 * Then:
 *   1. Materias + alumnos + parcial activo (idéntico a otros KPIs C9).
 *   2. Por cada alumno: promedio cross-materia (sum / count de cal no-null).
 *   3. Filter alumnos con promedio no-null (descarta sin calificaciones).
 *   4. Sort desc por promedio.
 *   5. Retorna `{ top: ranked.slice(0, n), bottom: ranked.slice(-n).reverse() }`.
 *      bottom.reverse() invierte para mostrar el peor primero (mejor del bottom
 *      último).
 * Edge:
 *   - n null → 3. Explícito `n == null` (proteger 0).
 *   - uid o grupoId falsy → `{ top: [], bottom: [] }`.
 *   - Menos de 2n alumnos calificados → top y bottom pueden solaparse
 *     (el alumno mejor calificado podría aparecer en ambas listas). Caller
 *     responsable de dedupe si necesario.
 *   - **Sort estable**: V8 usa TimSort estable; alumnos empatados mantienen
 *     orden original (que es el de DEMO_GRUPOS.miembros).
 *   - Función PURA: `.slice` y `[...].reverse()` crean copias.
 *   - Deuda post-Supabase: window function `ROW_NUMBER() OVER (PARTITION BY
 *     grupo ORDER BY promedio DESC)`.
 */
function getTopBottomAlumnos(uid, grupoId, n) {
    if (n == null) n = 3;
    if (!uid || !grupoId) return { top: [], bottom: [] };
    const materias = getMateriasProfGrupo(uid, grupoId);
    const alumnos = getAlumnosGrupo(grupoId);
    const parcial = _getParcialActivo(grupoId);
    const ranked = alumnos.map(a => {
        let sum = 0, count = 0;
        materias.forEach(m => {
            const cal = getCalFinalAlumnoMatParcial(a.id, m.id, grupoId, parcial);
            if (cal != null) { sum += cal; count++; }
        });
        const promedio = count > 0 ? sum / count : null;
        return { alumno: a, promedio };
    }).filter(r => r.promedio != null);
    ranked.sort((a, b) => b.promedio - a.promedio);
    return {
        top: ranked.slice(0, n),
        bottom: ranked.slice(-n).reverse()
    };
}
