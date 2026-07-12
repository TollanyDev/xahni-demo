// ═══════════════════════════════════════════════════════════
// ASISTENCIA — Helpers shared alumno/profesor
// Slice 2026-05-24
// ═══════════════════════════════════════════════════════════
//
// Patrón Opción A: mutar DEMO_ASISTENCIAS in-memory. Las sesiones NO se
// almacenan; se DERIVAN de materia.horario × periodo del parcial cada
// invocación. Solo las marcas persisten.
//
// Estados: "presente" | "retardo" | "ausente" | null (sin marca).
// Forward-compatible con escala-rubros (Supabase) donde asistencia será
// rubro `manual` con cantidad_obtenida derivada de las marcas.

const _DIA_TO_GETDAY = {
    domingo: 0, lunes: 1, martes: 2, miercoles: 3,
    miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6,
};

const _ASIS_ESTADOS = ["presente", "retardo", "ausente"];

// Cicla estado: null → presente → retardo → ausente → null.
/**
 * @interaction siguiente-estado
 * @scope shared-asistencia-helper-internal
 *
 * Given un estado actual (null | "presente" | "retardo" | "ausente").
 * When `ciclarMarcaAsistencia` necesita avanzar al siguiente estado.
 * Then ciclo determinista:
 *   - null → "presente"
 *   - "presente" → "retardo"
 *   - "retardo" → "ausente"
 *   - "ausente" → null
 * Edge:
 *   - Estado inválido (fuera del set) → null (defensa).
 *   - Ciclo full 4 estados → vuelve a null (sin marca = limpia).
 */
function _siguienteEstado(actual) {
    if (!actual) return "presente";
    const i = _ASIS_ESTADOS.indexOf(actual);
    if (i < 0 || i === _ASIS_ESTADOS.length - 1) return null;
    return _ASIS_ESTADOS[i + 1];
}

// Convierte un Date a YYYY-MM-DD respetando timezone local (no toISOString
// que aplica UTC y puede saltar de día).
/**
 * @interaction asistencia-fecha-iso
 * @scope shared-asistencia-helper-internal
 *
 * Given un Date object.
 * When `deriveSesionesAsistencia` construye las sesiones diarias y necesita
 *   clave string consistente (key de `r.marcas[fechaIso]`).
 * Then retorna "YYYY-MM-DD" en timezone LOCAL del navegador, NO UTC. Usar
 *   `toISOString()` aplicaría UTC y saltaría de día en regiones west of
 *   UTC para fechas late-night.
 * Edge:
 *   - d invalid → "NaN-NaN-NaN" string (caller debe validar).
 *   - Mes 0-indexed → +1 antes de padStart.
 *   - Mismo formato que `_calFmtYmd` de calendar canonical (no consolidado).
 */
function _fechaIso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/**
 * Deriva las sesiones esperadas de un (materia, grupo, parcial) cruzando
 * materia.horario con el rango del parcial.
 *
 * @param {string} materiaId
 * @param {string} grupoId
 * @param {number} parcial  // 1 | 2 | 3
 * @returns {Array<{fecha: string, dia: string, inicio: string, fin: string, salon: string, isPast: boolean}>}
 *   Vacío si la materia/grupo/parcial/horario no existen.
 *
 * @interaction derive-sesiones-asistencia
 * @scope shared-asistencia-canonical-cross-vista
 *
 * Given materiaId + grupoId + parcial (1/2/3).
 * When tab Asistencia profesor (capture) o vista alumno (resumen) necesita
 *   las sesiones esperadas para ese parcial (no se almacenan, se derivan
 *   in-flight).
 * Then resolución cascada:
 *   1. materia + horario filtrado por grupoId.
 *   2. periodo del grupo + getPeriodoInfo para parciales con métricas.
 *   3. Itera día por día entre p.inicio y p.fin. Si día actual matchea
 *      `_DIA_TO_GETDAY[h.dia]` para algún horario, push sesión con:
 *      {fecha (local ISO), dia, inicio, fin, salon, isPast}.
 * Edge:
 *   - Cualquier arg falsy → [].
 *   - DEMO_MATERIAS/DEMO_GRUPOS no cargados → [].
 *   - Materia sin horario (legacy) → [].
 *   - Horarios sin match con grupoId → [].
 *   - Grupo sin periodo o sin parciales → [].
 *   - Parcial no existe (e.g. 4) → [].
 *   - `isPast` calcula vs hoy 23:59:59 (sesión del día actual = isPast).
 *   - Horario `dia` con acento ("miércoles") o sin → _DIA_TO_GETDAY normaliza.
 *   - **Forward-compat**: post-Supabase la tabla `clases` materializa estas
 *     sesiones (no se derivan), pero la interfaz queda igual.
 */
function deriveSesionesAsistencia(materiaId, grupoId, parcial) {
    if (!materiaId || !grupoId || !parcial) return [];
    if (typeof DEMO_MATERIAS === "undefined" || typeof DEMO_GRUPOS === "undefined") return [];

    const materia = DEMO_MATERIAS.find(m => m.id === materiaId);
    if (!materia || !Array.isArray(materia.horario)) return [];
    let horarios = materia.horario.filter(h => h.grupoId === grupoId);
    // Fallback defensivo: si los horarios tienen grupoId legacy (e.g. "ISC-3A")
    // que no coincide con el id actual del grupo (e.g. "grupo-smoke-1780..."),
    // y la materia está asignada UNICAMENTE a este grupo activo, asume que
    // los horarios sin match pertenecen a este grupo. Evita "Sin sesiones que
    // mostrar" persistente por data legacy en seeds Firestore.
    if (!horarios.length) {
        const gruposMat = Array.isArray(materia.grupos) ? materia.grupos.map(String) : [];
        if (gruposMat.length === 1 && gruposMat[0] === String(grupoId)) {
            horarios = materia.horario.slice();
        } else {
            return [];
        }
    }

    const grupo = DEMO_GRUPOS.find(g => g.id === grupoId);
    if (!grupo || !grupo.periodo) return [];
    const info = (typeof getPeriodoInfo === "function") ? getPeriodoInfo(grupo.periodo) : null;
    if (!info || !Array.isArray(info.parciales)) return [];
    const p = info.parciales.find(x => x.num === parcial);
    if (!p || !p.inicio || !p.fin) return [];

    const hoy = new Date();
    hoy.setHours(23, 59, 59, 999);

    const diasMap = {};  // getDay() → horario entry
    horarios.forEach(h => {
        const gd = _DIA_TO_GETDAY[h.dia];
        if (gd != null) diasMap[gd] = h;
    });

    const sesiones = [];
    const cur = new Date(p.inicio);
    cur.setHours(0, 0, 0, 0);
    const fin = new Date(p.fin);
    fin.setHours(23, 59, 59, 999);
    while (cur <= fin) {
        const h = diasMap[cur.getDay()];
        if (h) {
            sesiones.push({
                fecha:  _fechaIso(cur),
                dia:    h.dia,
                inicio: h.inicio,
                fin:    h.fin,
                salon:  h.salon || "",
                isPast: cur <= hoy,
            });
        }
        cur.setDate(cur.getDate() + 1);
    }
    return sesiones;
}

// Retorna el record completo de marcas para un (materia, grupo, parcial),
// creándolo si no existe (vacío). Devuelve referencia (no copia).
/**
 * @interaction get-or-create-asistencia-record
 * @scope shared-asistencia-helper-internal
 *
 * Given materiaId + grupoId + parcial.
 * When un caller (getAsistenciaRecord, getMarcaAlumno, marcarAsistencia)
 *   necesita el record persistente de marcas. Si no existe, se crea
 *   lazy (upsert in-memory).
 * Then busca en DEMO_ASISTENCIAS por (materiaId, grupoId, parcial). Si
 *   no encuentra, crea `{materiaId, grupoId, parcial, marcas: {}}` y
 *   push. Garantiza `r.marcas` siempre object (no null).
 *   Retorna REFERENCIA (no copia). Caller puede mutar `r.marcas` y
 *   persiste in-memory.
 * Edge:
 *   - DEMO_ASISTENCIAS no cargado → null.
 *   - Helper privado: caller público es getAsistenciaRecord.
 *   - Lazy create: NO valida combos (materia, grupo, parcial) inválidos
 *     contra DEMO_*. Caller asume validados upstream.
 *   - Deuda post-Supabase: query + upsert via tabla `asistencias`.
 */
function _getOrCreateAsistenciaRecord(materiaId, grupoId, parcial) {
    if (typeof DEMO_ASISTENCIAS === "undefined") return null;
    let r = DEMO_ASISTENCIAS.find(x =>
        x.materiaId === materiaId && x.grupoId === grupoId && x.parcial === parcial
    );
    if (!r) {
        r = { materiaId, grupoId, parcial, marcas: {} };
        DEMO_ASISTENCIAS.push(r);
    }
    if (!r.marcas) r.marcas = {};
    return r;
}

/**
 * Retorna las marcas {fechaIso: {uid: estado}} para un (materia, grupo,
 * parcial). Crea record vacío si no existe.
 *
 * @interaction get-asistencia-record
 * @scope shared-asistencia-canonical
 *
 * Given materiaId + grupoId + parcial.
 * When tab Asistencia profesor renderea matriz uid × fecha y necesita
 *   acceso al record completo.
 * Then delega a `_getOrCreateAsistenciaRecord`. Lazy create si no existe.
 *   Retorna referencia mutable.
 * Edge:
 *   - Mismo set que el helper privado.
 *   - Caller debe leer `r.marcas[fechaIso]?.[uid]` con optional chaining
 *     (la estructura es sparse: solo entries con marca presente).
 */
function getAsistenciaRecord(materiaId, grupoId, parcial) {
    return _getOrCreateAsistenciaRecord(materiaId, grupoId, parcial);
}

/**
 * Retorna el estado del alumno en una sesión específica, o null si no
 * está marcada.
 *
 * @interaction get-marca-alumno
 * @scope shared-asistencia-canonical
 *
 * Given materiaId + grupoId + parcial + fechaIso ("YYYY-MM-DD") + uid.
 * When un caller (cell de matriz tab Asistencia profesor, resumen vista
 *   alumno, calcResumenAsistencia) necesita estado puntual.
 * Then lookup `r.marcas[fechaIso]?.[uid]` con fallback null. Lazy create
 *   record via helper (sin side effect visible).
 * Edge:
 *   - DEMO_ASISTENCIAS no cargado → null.
 *   - Sin marca (estructura sparse) → null.
 *   - Estados válidos: "presente" | "retardo" | "ausente" | null.
 */
function getMarcaAlumno(materiaId, grupoId, parcial, fechaIso, uid) {
    const r = _getOrCreateAsistenciaRecord(materiaId, grupoId, parcial);
    if (!r) return null;
    return (r.marcas[fechaIso] && r.marcas[fechaIso][uid]) || null;
}

/**
 * @interaction marcar-asistencia
 * @scope shared (profesor/asistencia)
 *
 * Given un profesor edita la asistencia de un alumno en una sesión.
 * When invoca marcarAsistencia(materiaId, grupoId, parcial, fechaIso, uid, estado).
 * Then muta DEMO_ASISTENCIAS: si estado es null/undefined elimina la marca;
 *   en otro caso setea r.marcas[fechaIso][uid] = estado. Retorna true.
 * Edge si estado es inválido (no presente/retardo/ausente/null), retorna false.
 */
function marcarAsistencia(materiaId, grupoId, parcial, fechaIso, uid, estado) {
    if (!materiaId || !grupoId || !parcial || !fechaIso || !uid) return false;
    if (estado != null && !_ASIS_ESTADOS.includes(estado)) return false;
    const r = _getOrCreateAsistenciaRecord(materiaId, grupoId, parcial);
    if (!r) return false;
    if (!r.marcas[fechaIso]) r.marcas[fechaIso] = {};
    if (estado == null) {
        delete r.marcas[fechaIso][uid];
        if (Object.keys(r.marcas[fechaIso]).length === 0) delete r.marcas[fechaIso];
    } else {
        r.marcas[fechaIso][uid] = estado;
    }
    return true;
}

/**
 * Cicla el estado del alumno en una sesión (null → presente → retardo →
 * ausente → null). Retorna el nuevo estado (o null si volvió a sin marca).
 *
 * @interaction ciclar-marca-asistencia
 * @scope shared-asistencia-handler-cell-click
 *
 * Given materiaId + grupoId + parcial + fechaIso + uid.
 * When profesor click en cell de matriz Asistencia (toggle UX rápido).
 * Then 3 pasos:
 *   1. Lee estado actual via `getMarcaAlumno`.
 *   2. Calcula siguiente via `_siguienteEstado` (cíclico null →P→R→A→null).
 *   3. Persiste con `marcarAsistencia(..., next)`. Retorna `next`.
 * Edge:
 *   - Caller actualiza el visual de la cell con el valor retornado.
 *   - Si los args son inválidos, `marcarAsistencia` retorna false pero
 *     este wrapper retorna `next` igualmente (caller no recibe error).
 *   - UX típica: click → ✓ Presente → click → 🕐 Retardo → click →
 *     ✕ Ausente → click → sin marca.
 */
function ciclarMarcaAsistencia(materiaId, grupoId, parcial, fechaIso, uid) {
    const actual = getMarcaAlumno(materiaId, grupoId, parcial, fechaIso, uid);
    const next = _siguienteEstado(actual);
    marcarAsistencia(materiaId, grupoId, parcial, fechaIso, uid, next);
    return next;
}

/**
 * Marca todos los uids dados con un estado en una sesión. Retorna el
 * conteo de marcas escritas.
 *
 * @interaction marcar-asistencia-bulk
 * @scope shared-asistencia-action-bulk
 *
 * Given materiaId + grupoId + parcial + fechaIso + uids[] + estado.
 * When profesor click en "Marcar todos presentes" (o equivalente) en la
 *   header de una columna de fecha.
 * Then itera uids[] e invoca `marcarAsistencia` para cada uno. Cuenta
 *   los success (true) y retorna count.
 * Edge:
 *   - uids vacío o no array → 0.
 *   - estado inválido → marcarAsistencia rechaza per uid → return 0.
 *   - estado null → bulk delete (limpia marcas).
 *   - Sin transacción: si fallar mid-way (estado inválido), las anteriores
 *     ya quedaron. Defensivo: validar estado antes de llamar bulk.
 */
function marcarAsistenciaBulk(materiaId, grupoId, parcial, fechaIso, uids, estado) {
    if (!Array.isArray(uids) || !uids.length) return 0;
    let n = 0;
    uids.forEach(uid => {
        if (marcarAsistencia(materiaId, grupoId, parcial, fechaIso, uid, estado)) n++;
    });
    return n;
}

/**
 * Calcula resumen de asistencia de un alumno: presentes, retardos,
 * ausentes, total sesiones pasadas, % presente (sobre pasadas).
 *
 * @interaction calc-resumen-asistencia
 * @scope shared-asistencia-helper-canonical
 *
 * Given materiaId + grupoId + parcial + uid.
 * When un caller (chip resumen vista alumno, KPI tab Asistencia profesor)
 *   necesita stats agregados del alumno.
 * Then:
 *   1. Deriva sesiones esperadas con `deriveSesionesAsistencia`.
 *   2. Filtra a las pasadas (isPast).
 *   3. Cuenta pres/ret/aus/sin (sin marca) por cada sesión pasada.
 *   4. Calcula pctPresente: `(pres + ret*0.5) / total * 100` redondeado.
 *      Convención vanilla simple: retardo cuenta como 0.5 presente.
 *   5. Retorna `{pres, ret, aus, sin, total, totalSesiones, pctPresente}`.
 *      `total` = sesiones pasadas; `totalSesiones` = TODAS (pasadas+futuras).
 * Edge:
 *   - Sin sesiones (materia/grupo/parcial inválido) → todos los counts en 0,
 *     pctPresente = 0.
 *   - Sin sesiones pasadas (parcial futuro) → total = 0, pctPresente = 0.
 *   - Decisión 0.5 para retardo es vanilla-only; **deuda post-Supabase**:
 *     el cálculo formal del rubro `cantidad_obtenida` vendrá con tabla
 *     `escala_rubros` (asistencia será rubro `manual` con fórmula
 *     configurable). Schema spec 2026-05-23.
 */
function calcResumenAsistencia(materiaId, grupoId, parcial, uid) {
    const sesiones = deriveSesionesAsistencia(materiaId, grupoId, parcial);
    const pasadas = sesiones.filter(s => s.isPast);
    let pres = 0, ret = 0, aus = 0, sin = 0;
    pasadas.forEach(s => {
        const m = getMarcaAlumno(materiaId, grupoId, parcial, s.fecha, uid);
        if (m === "presente") pres++;
        else if (m === "retardo") ret++;
        else if (m === "ausente") aus++;
        else sin++;
    });
    const total = pasadas.length;
    // % presente cuenta presentes como 1 y retardos como 0.5 (convención
    // simple para vanilla; el cálculo formal del rubro vendrá con Supabase).
    const efectivo = pres + ret * 0.5;
    const pctPresente = total ? Math.round((efectivo / total) * 100) : 0;
    return { pres, ret, aus, sin, total, totalSesiones: sesiones.length, pctPresente };
}

// Exponer en window para consumidores cross-módulo.
if (typeof window !== "undefined") {
    window.deriveSesionesAsistencia = deriveSesionesAsistencia;
    window.getAsistenciaRecord      = getAsistenciaRecord;
    window.getMarcaAlumno           = getMarcaAlumno;
    window.marcarAsistencia         = marcarAsistencia;
    window.ciclarMarcaAsistencia    = ciclarMarcaAsistencia;
    window.marcarAsistenciaBulk     = marcarAsistenciaBulk;
    window.calcResumenAsistencia    = calcResumenAsistencia;
}
