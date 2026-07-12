// ═══════════════════════════════════════════════════════════
// CORE · Periodo escolar
// Helpers compartidos entre alumno y profesor para derivar el
// periodo activo de un grupo o de una materia (vía grupo donde
// se imparte). `getPeriodoInfo` vivía en estudiante/data-provider.js
// pero también lo consumía profesor — se centraliza acá.
// ═══════════════════════════════════════════════════════════

const _MS_DIA_PERIODO = 86400000;

// ── Métricas derivadas del periodo crudo ──────────────────────
// Función pura. Devuelve null si el periodo está incompleto.
// Estructura idéntica a la que estaba en data-provider.js: estado,
// semanaActual, totalSemanas, pctTotal, parciales[].
/**
 * @interaction get-periodo-info
 * @scope core-helper-periodo-canonical
 *
 * Given un objeto periodo (`{inicio, fin, parciales[], id?, nombre?,
 *   duracionMeses?}`) y hoy opcional (default `new Date()` — inyectable
 *   para tests).
 * When un caller necesita métricas derivadas para mostrar avance del
 *   período / parcial activo.
 * Then función pura: retorna objeto con:
 *   - id, nombre, duracionMeses (passthrough).
 *   - inicio, fin como Date.
 *   - totalSemanas (ceil del total días / 7).
 *   - semanaActual (1-indexed, clamped por estado).
 *   - estado: "futuro" (hoy < inicio) | "activo" (entre) | "cerrado"
 *     (hoy > fin).
 *   - pctTotal (0-100, redondeado).
 *   - parciales[]: array con {num, semanas, inicio:Date, fin:Date,
 *     estado, pct, semanaActual} para cada parcial del periodo.
 * Edge:
 *   - periodo null o sin inicio/fin → null.
 *   - parciales no array → tratado como [].
 *   - pct calc clampa a [0,100] para defensa.
 *   - hoy inyectable: tests pasan fecha fija; producción usa now.
 *   - Función PURA: no muta input.
 *   - Slice centralización 2026-05-14 (cerrado proyecto periodo): vivía
 *     en data-provider.js, se centraliza acá para reuse cross-rol.
 */
function getPeriodoInfo(periodo, hoy = new Date()) {
    if (!periodo || !periodo.inicio || !periodo.fin) return null;
    const inicio = new Date(periodo.inicio);
    const fin    = new Date(periodo.fin);
    const total  = (fin - inicio) / _MS_DIA_PERIODO + 1;
    const trans  = Math.floor((hoy - inicio) / _MS_DIA_PERIODO);
    const totalSemanas = Math.ceil(total / 7);

    const estado = hoy < inicio ? "futuro"
                 : hoy > fin    ? "cerrado"
                 : "activo";

    let semanaActual = Math.floor(trans / 7) + 1;
    if (estado === "futuro")  semanaActual = 0;
    if (estado === "cerrado") semanaActual = totalSemanas;

    const pctTotal = estado === "cerrado" ? 100
                   : estado === "futuro"  ? 0
                   : Math.min(100, Math.max(0, Math.round((trans / total) * 100)));

    // Si el grupo no tiene parciales explícitos (legacy/seed mínimo), derivar
    // 3 parciales equiespaciados del periodo. Permite que Asistencia y otros
    // consumidores funcionen sin requerir migración de DEMO_GRUPOS.
    let parcialesSrc = periodo.parciales;
    if (!Array.isArray(parcialesSrc) || parcialesSrc.length === 0) {
        const sliceMs = (fin - inicio) / 3;
        parcialesSrc = [1, 2, 3].map(n => {
            const pIni = new Date(inicio.getTime() + sliceMs * (n - 1));
            const pFin = new Date(inicio.getTime() + sliceMs * n - _MS_DIA_PERIODO);
            const semanas = Math.max(1, Math.round((pFin - pIni) / (_MS_DIA_PERIODO * 7)));
            return {
                num: n,
                semanas,
                inicio: pIni.toISOString().slice(0, 10),
                fin:    pFin.toISOString().slice(0, 10)
            };
        });
    }
    const parciales = parcialesSrc.map((p) => {
        const pIni = new Date(p.inicio);
        const pFin = new Date(p.fin);
        const pTotal = (pFin - pIni) / _MS_DIA_PERIODO + 1;
        const pTrans = (hoy - pIni) / _MS_DIA_PERIODO;
        const estPar = hoy < pIni ? "futuro"
                     : hoy > pFin ? "cerrado"
                     : "activo";
        const pPct = estPar === "cerrado" ? 100
                   : estPar === "futuro"  ? 0
                   : Math.min(100, Math.max(0, Math.round((pTrans / pTotal) * 100)));
        const semanaEnParcial = estPar === "futuro" ? 0
                              : estPar === "cerrado" ? p.semanas
                              : Math.min(p.semanas, Math.max(1, Math.floor(pTrans / 7) + 1));
        return {
            num:          p.num,
            semanas:      p.semanas,
            inicio:       pIni,
            fin:          pFin,
            estado:       estPar,
            pct:          pPct,
            semanaActual: semanaEnParcial,
        };
    });

    return {
        id:            periodo.id || null,
        nombre:        periodo.nombre || null,
        duracionMeses: periodo.duracionMeses,
        inicio, fin,
        totalSemanas,
        semanaActual,
        estado,
        pctTotal,
        parciales,
    };
}

// ── Lookup: periodo crudo de un grupo ─────────────────────────
/**
 * @interaction get-periodo-de-grupo
 * @scope core-helper-periodo-lookup
 *
 * Given un grupoId (string).
 * When un caller (resolverPeriodoMateria, profesor mismaterias) necesita
 *   el periodo crudo del grupo (antes de derivar métricas con
 *   getPeriodoInfo).
 * Then busca el grupo en DEMO_GRUPOS y retorna `g.periodo`. NO aplica
 *   getPeriodoInfo aquí (caller decide cuándo derivar).
 * Edge:
 *   - grupoId falsy → null.
 *   - Grupo no en DEMO_GRUPOS → null.
 *   - Grupo sin campo `periodo` → null + warn console (data demo
 *     malformada).
 *   - Deuda post-Supabase: query a tabla `grupos.periodo_id` + joins.
 */
function getPeriodoDeGrupo(grupoId) {
    if (!grupoId) return null;
    const grupos = (typeof DEMO_GRUPOS !== "undefined") ? DEMO_GRUPOS : [];
    const g = grupos.find(x => x.id === grupoId);
    if (!g) return null;
    if (!g.periodo) {
        console.warn(`[periodo] grupo "${grupoId}" sin campo periodo`);
        return null;
    }
    return g.periodo;
}

// ── Resolución por usuario+materia ────────────────────────────
// Si `grupoIdOverride` viene, lo usa (caso profesor con selector).
// Si no, busca el primer grupo del user donde se imparte la materia.
/**
 * @interaction resolver-periodo-materia
 * @scope core-helper-periodo-resolver-cross-rol
 *
 * Given uid + materiaId + grupoIdOverride opcional (profesor con
 *   selector activo del hub-materia).
 * When un caller (hub-materia tab Escala, gestion académica, etc.)
 *   necesita el periodo crudo aplicable a este user + materia.
 * Then ejecuta resolución:
 *   - Si grupoIdOverride pasado → getPeriodoDeGrupo(grupoIdOverride).
 *   - Sino, busca user en DEMO_USERS, materia en DEMO_MATERIAS, y:
 *     - Estudiante: intersección de user.grupos con mat.grupos → primer
 *       match.
 *     - Profesor: si no match estudiante-style, fallback al primer
 *       mat.grupos[0] (profesor no tiene "su" grupo, decide por materia).
 *   Retorna getPeriodoDeGrupo del gid resuelto.
 * Edge:
 *   - uid o materiaId falsy → null (excepto si grupoIdOverride).
 *   - User no en DEMO_USERS → null.
 *   - Materia no en DEMO_MATERIAS → null.
 *   - Sin intersección user-mat grupos Y user.tipo !== "profesor" → null.
 *   - DEMO_USERS/DEMO_GRUPOS/DEMO_MATERIAS no cargados → respectivos
 *     fallback a [].
 *   - Profesor "primer grupo de la materia": semántica simple; si una
 *     materia tiene N grupos del mismo profesor, retorna el primero.
 */
function resolverPeriodoMateria(uid, materiaId, grupoIdOverride = null) {
    if (grupoIdOverride) return getPeriodoDeGrupo(grupoIdOverride);
    if (!uid || !materiaId) return null;

    const users    = (typeof DEMO_USERS    !== "undefined") ? DEMO_USERS    : [];
    const grupos   = (typeof DEMO_GRUPOS   !== "undefined") ? DEMO_GRUPOS   : [];
    const materias = (typeof DEMO_MATERIAS !== "undefined") ? DEMO_MATERIAS : [];

    const user = users.find(u => u.id === uid);
    if (!user) return null;

    const mat = materias.find(m => m.id === materiaId);
    if (!mat) return null;

    // Para estudiante: el primer grupo del user que también contenga la materia.
    // Para profesor: el primer grupo de la materia que esté en la asignación.
    const userGrupos = user.grupos || [];
    const matGrupos  = mat.grupos  || [];

    let gid = userGrupos.find(uG => matGrupos.includes(uG));
    if (!gid && user.tipo === "profesor") gid = matGrupos[0];
    if (!gid) return null;

    return getPeriodoDeGrupo(gid);
}

// ── Ids compuestos canónicos (materia+grupo, y materia+grupo+parcial) ──
// FIX 2026-07-08: el patrón `${matId}_${grupoId}` (clave de
// APP.profParcialActivo, "parcial que el profesor tiene seleccionado
// para esta materia+grupo") y `${matId}_${grupoId}_${parcial}` (id del
// documento de escala en DEMO_ESCALAS/Firestore) se reconstruían con
// template literals ad hoc en al menos 10 sitios distintos
// (escala.js, gestion.js, hub-aprendizaje.js, tareas.js). Justo esa
// duplicación fue la causante indirecta del bug "el botón + Definir
// escala aparece aunque ya definí la escala" — dos archivos construyendo
// la MISMA idea con lógica ligeramente distinta. Se centraliza aquí para
// que solo haya un lugar que decida el formato del id.
/**
 * @interaction prof-mat-grupo-key
 * @scope core-helper-ids-canonical
 *
 * Given matId + grupoId.
 * When cualquier módulo necesita la clave de `APP.profParcialActivo` para
 *   una materia+grupo (header de parcial tabs, escala.js, gestion.js,
 *   tareas.js).
 * Then retorna `${matId}_${grupoId}`. Función PURA.
 */
function profMatGrupoKey(matId, grupoId) {
    return `${matId}_${grupoId}`;
}

/**
 * @interaction escala-id
 * @scope core-helper-ids-canonical
 *
 * Given matId + grupoId + parcialNum.
 * When cualquier módulo necesita el id de documento de una escala de
 *   evaluación (guardar en escala.js, o buscar en gestion.js).
 * Then retorna `${matId}_${grupoId}_${parcialNum}`. Función PURA.
 * Edge:
 *   - Debe llamarse con el MISMO grupoId en el momento de guardar y de
 *     leer, o el lookup falla en silencio (devuelve `undefined`, no
 *     error) — por eso `_persistEscalaState` en escala.js guarda para
 *     TODOS los grupos de la materia, no solo el activo.
 */
function escalaId(matId, grupoId, parcialNum) {
    return `${matId}_${grupoId}_${parcialNum}`;
}
