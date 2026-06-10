// ═══════════════════════════════════════════════════════════
// MODELO — Helpers de derivación sobre la jerarquía canónica:
//
//   Institución 1:N Carrera 1:N Grupo N:N Materia
//
// Estas funciones son la ÚNICA vía aceptada para navegar de un
// grupo o materia hacia su carrera/institución. Reemplazan los
// accesos directos tipo `grupo.institucionId` que existían antes
// del Bloqueante 4 (cuando institución se denormalizaba en grupo).
//
// Bloqueante 4.C — 2026-05-16:
//   - getGrupoInstitucion(grupo)
//   - getMateriaInstitucion(materia)
//
// 4.D añadirá getMateriaCarreras(materia) cuando entren las
// clasificaciones; esta función es el único lazo entre materia
// y carrera (no hay materia.carreraId).
//
// Todas las funciones son puras y devuelven `null` si la cadena
// se rompe (grupo sin carreraId, carrera huérfana, materia sin
// grupos, DEMO_* vacíos). Los consumers ya manejan null con `?.`
// y fallbacks `"—"`.
// ═══════════════════════════════════════════════════════════

/**
 * Resuelve la institución de un grupo a través de su carrera.
 * @param {object} grupo - Objeto grupo del JSON canónico (debe tener `carreraId`).
 * @returns {object|null} La institución (`{id, nombre, ...}`) o `null` si la cadena se rompe.
 *
 * @interaction get-grupo-institucion
 * @scope core-helper-modelo-canonical
 *
 * Given un objeto grupo del JSON canónico (con `carreraId`).
 * When un caller necesita la institución del grupo (admin panels, profesor
 *   mismaterias, gestion).
 * Then sigue cadena: grupo.carreraId → DEMO_CARRERAS → carrera.institucionId
 *   → DEMO_INSTITUCIONES. Retorna institución o null.
 * Edge:
 *   - grupo null o sin carreraId → null.
 *   - DEMO_CARRERAS/DEMO_INSTITUCIONES no cargados → null.
 *   - Carrera no encontrada por id (loose match con String() para
 *     coerce demo data) → null.
 *   - Carrera sin institucionId → null.
 *   - Institución no encontrada → null.
 *   - Bloqueante 4.C (2026-05-16) cementó esta cadena: antes
 *     grupo.institucionId vivía denormalizado, ahora siempre vía carrera.
 */
function getGrupoInstitucion(grupo) {
    if (!grupo || !grupo.carreraId) return null;
    if (typeof DEMO_CARRERAS === "undefined" || typeof DEMO_INSTITUCIONES === "undefined") return null;
    const carrera = DEMO_CARRERAS.find(c => String(c.id) === String(grupo.carreraId));
    if (!carrera || carrera.institucionId == null) return null;
    return DEMO_INSTITUCIONES.find(i => String(i.id) === String(carrera.institucionId)) || null;
}

/**
 * Resuelve la institución de una materia vía su primer grupo asociado.
 * "Primer grupo" sigue la semántica que tenía `_enrichMateria` antes de 4.C:
 * la materia se atribuye a la institución del primer grupo en `DEMO_GRUPOS`
 * que la liste en `grupo.materias[]`. Si una materia se imparte en grupos de
 * distintas instituciones (futuro), seguirá devolviendo la primera — se
 * decidirá la política exacta cuando el caso aparezca.
 *
 * @param {object} materia - Objeto materia del JSON canónico.
 * @returns {object|null} La institución o `null`.
 *
 * @interaction get-materia-institucion
 * @scope core-helper-modelo-canonical
 *
 * Given un objeto materia del JSON canónico.
 * When un caller (admin gestion materias, profesor mismaterias) necesita la
 *   institución de la materia.
 * Then busca el primer grupo en DEMO_GRUPOS que liste materia.id en
 *   grupo.materias[]. Delega a getGrupoInstitucion para el resto de la
 *   cadena (carrera → institución).
 * Edge:
 *   - materia null o DEMO_GRUPOS no cargado → null.
 *   - Ningún grupo lista esta materia → null.
 *   - Materia compartida entre grupos de distintas instituciones (futuro)
 *     → primera por orden de DEMO_GRUPOS (decisión pendiente cuando el
 *     caso aparezca).
 *   - Bloqueante 4.C cementó "primera institución por orden de grupos"
 *     como semántica simple.
 */
function getMateriaInstitucion(materia) {
    if (!materia || typeof DEMO_GRUPOS === "undefined") return null;
    const grupo = DEMO_GRUPOS.find(g => Array.isArray(g.materias) && g.materias.includes(materia.id));
    return grupo ? getGrupoInstitucion(grupo) : null;
}

/**
 * Resuelve las carreras de una materia a través de su clasificación.
 * La relación es: materia 1:1 clasificación N:N carreras. No existe
 * `materia.carreraId` ni `materia.carreraIds[]` — toda inferencia
 * carrera↔materia debe pasar por este helper.
 *
 * @param {object} materia - Objeto materia del JSON canónico (debe tener `clasificacionId`).
 * @returns {object[]} Array de carreras (`[{id, nombre, clave, institucionId}]`).
 *                    Devuelve `[]` si la cadena se rompe (materia sin clasif,
 *                    clasif huérfana, carreras inexistentes, DEMO_* vacíos).
 *
 * @interaction get-materia-carreras
 * @scope core-helper-modelo-canonical
 *
 * Given un objeto materia con `clasificacionId`.
 * When un caller (admin gestion materias, badges multi-carrera) necesita
 *   listar las carreras a las que pertenece la materia.
 * Then sigue cadena: materia.clasificacionId → DEMO_CLASIFICACIONES →
 *   clasif.carreraIds[] → mapping a DEMO_CARRERAS. Retorna array de
 *   carreras encontradas (excluye nulls).
 * Edge:
 *   - materia null o sin clasificacionId → [].
 *   - DEMO_CLASIFICACIONES/DEMO_CARRERAS no cargados → [].
 *   - Clasif no encontrada por id → [].
 *   - Clasif sin carreraIds o no array → [].
 *   - Carreras dentro de carreraIds que no existen en DEMO_CARRERAS →
 *     filter(Boolean) las excluye.
 *   - Bloqueante 4.D introdujo la cadena N:N (antes era 1:1 materia-carrera).
 *   - Loose match con String() para coerce demo data legacy.
 */
function getMateriaCarreras(materia) {
    if (!materia || !materia.clasificacionId) return [];
    if (typeof DEMO_CLASIFICACIONES === "undefined" || typeof DEMO_CARRERAS === "undefined") return [];
    const clasif = DEMO_CLASIFICACIONES.find(c => String(c.id) === String(materia.clasificacionId));
    if (!clasif || !Array.isArray(clasif.carreraIds)) return [];
    return clasif.carreraIds
        .map(cid => DEMO_CARRERAS.find(c => String(c.id) === String(cid)))
        .filter(Boolean);
}
