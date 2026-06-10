// ═══════════════════════════════════════════════════════════
// BUILDERS — Administrador: Gestión de Materias
// Lectura desde DEMO_MATERIAS (poblado por DataService desde
// data/demo/materias.json en demo, Firestore en prod). Las
// mutaciones pasan por DataService.saveMateria / deleteMateria
// (Bloqueante 2, 2026-05-15).
//
// Schema canónico (post 4.B/4.C/4.D/4.E/4.F):
//   { id, nombre, clave, profesorId, clasificacionId, estado,
//     creditos, grupos[], juegos[], horario[] }
//
// 4.F: los modales de crear/editar editan SOLO el schema canónico.
// _enrichMateria deriva los campos "vista" (profesor nombre,
// institución, carrera, alumnos, cuatrimestre) usando los helpers
// de js/core/modelo.js y devuelve null cuando la cadena se rompe —
// los renderers de tabla absorben el null con `|| "—"` en línea.
// Ya NO congela valores históricos vía `m.profesor || …`. Cierra
// deuda §4 Bloqueante 2.
// ═══════════════════════════════════════════════════════════

// "Vista derivada" de una materia canónica. NO muta el original — devuelve
// una copia con campos derivados calculados desde DEMO_USERS / DEMO_GRUPOS /
// DEMO_CARRERAS / DEMO_CLASIFICACIONES vía helpers en js/core/modelo.js.
//
// 4.F: devuelve `null` cuando la cadena de derivación se rompe (no `"—"`).
// Los renderers que muestran texto absorben el null con `|| "—"` en línea —
// el sentinel ya no vive en la capa de datos. Tampoco usa `m.profesor || …`
// (eso congelaba valores legacy del payload pre-4.F).
// Slice C (2026-05-17): retirado el fallback `m.estado || "activa"` —
// auditoría confirmó que las 3 paths de write (modal nueva, modal editar,
// toggleEstado) y los seeds 4.E garantizan `estado` siempre presente.
/**
 * @interaction enrich-materia-vista-derivada
 * @scope admin-materias-vista-derivada
 *
 * Given materia canónica `m` (id + nombre + clave + profesorId + clasificacionId
 * + estado + creditos + grupos[] + juegos[] + horario[]) + DEMO_USERS +
 * DEMO_GRUPOS + DEMO_CARRERAS + DEMO_CLASIFICACIONES globales + helpers
 * `getMateriaInstitucion` / `getMateriaCarreras` (js/core/modelo.js).
 * When `materiasConteo` / `_renderTablaMateriasAdmin` / `_renderChipsDerivadosMateria`
 * necesitan los 5 campos "vista" (profesor nombre, institución, carrera string,
 * alumnos count, cuatrimestre).
 * Then retorna copia `{...m, profesor, alumnos, estado, institucion, cuatrimestre, carrera, creditos}`:
 *   - **profesor**: DEMO_USERS find por profesorId → nombre o `null`.
 *   - **alumnos**: count miembros sumados de grupos de la materia.
 *   - **periodoId** del primer grupo → regex `/-(\d+)$/` → cuatrimestre o `null`.
 *   - **institucion**: `getMateriaInstitucion(m)?.nombre` o `null`.
 *   - **carrera**: `getMateriaCarreras(m).map(c => c.clave).join(" / ")` o `null`.
 *   - **creditos**: `m.creditos ?? null` (preserva 0 como valor válido vs null).
 * Edge:
 *   - **null sentinel pattern (4.F)**: cierra deuda §4 B2. Antes el sentinel
 *     "—" vivía en la capa de datos (congelaba valores). Ahora vive en el
 *     renderer con `|| "—"` inline.
 *   - **NO usa `m.profesor || …`**: ya no congela valor legacy del payload
 *     pre-4.F (modal editor solo guarda 7 campos canónicos).
 *   - **`typeof === "undefined"` guards** sobre DEMO_* protegen Phase C/E
 *     gradual rollout antes de que `data-service.js` los pueble.
 *   - **`typeof === "function"` guards** sobre helpers de modelo.js protegen
 *     load order races.
 *   - **`reduce` alumnos por grupo no deduplica** alumnos cross-grupo (si un
 *     alumno está en 2 grupos de la misma materia cuenta 2x — deuda futura).
 *   - **`periodoId` regex extrae sufijo numérico** del id grupo. Asume formato
 *     `*-NN`. Si cambia format → cuatrimestre=null.
 *   - **NO retira `m.estado || "activa"` fallback** — confirmado seeds 4.E
 *     siempre lo proveen.
 *   - Función PURA (no muta `m` — spread + override).
 *   - **Pattern crítico 4.F**: cualquier nuevo campo derivado en el futuro
 *     debe seguir el modelo null+inline-sentinel, no congelar al payload.
 */
function _enrichMateria(m) {
    const profesorNombre = (typeof DEMO_USERS !== "undefined")
        ? (DEMO_USERS.find(u => String(u.id) === String(m.profesorId))?.nombre || null)
        : null;
    const gruposDeLaMateria = (typeof DEMO_GRUPOS !== "undefined")
        ? DEMO_GRUPOS.filter(g => Array.isArray(g.materias) && g.materias.includes(m.id))
        : [];
    const alumnos = gruposDeLaMateria.reduce(
        (s, g) => s + (Array.isArray(g.miembros) ? g.miembros.length : 0), 0
    );
    const periodoId = gruposDeLaMateria[0]?.periodo?.id;
    const cuatrimestre = periodoId?.match(/-(\d+)$/)?.[1] || null;
    const institucionNombre = (typeof getMateriaInstitucion === "function")
        ? (getMateriaInstitucion(m)?.nombre || null)
        : null;
    const carreraStr = (typeof getMateriaCarreras === "function")
        ? (getMateriaCarreras(m).map(c => c.clave).filter(Boolean).join(" / ") || null)
        : null;
    return {
        ...m,
        profesor:     profesorNombre,
        alumnos:      alumnos,
        estado:       m.estado,
        institucion:  institucionNombre,
        cuatrimestre: cuatrimestre,
        carrera:      carreraStr,
        creditos:     m.creditos ?? null,
    };
}

// ── Helpers locales ───────────────────────────────────────
// 4.E: el enum de estado migró a lowercase {"activa","archivada"}.
// La propiedad `archivadas` reemplaza a la legacy `inactivas`.
/**
 * @interaction materias-helpers-conteo-nextid
 * @scope admin-materias-helpers
 *
 * Given DEMO_MATERIAS array global + helper `_enrichMateria`.
 * When `_actualizarContadorTablaMateriasAdmin` / `buildMateriasResumen` /
 * `_sincronizarMetricasMaterias` necesitan KPIs, o `crearMateria` necesita
 * generar id para nueva materia.
 * Then 2 helpers combined:
 *   - `materiasConteo()`: enriquece DEMO_MATERIAS → retorna `{total, activas,
 *     archivadas, totalAlumnos, totalCreditos, promedioAlumnos}`. Particiona
 *     por `estado` enum (4.E lowercase: "activa"/"archivada"); reduce alumnos
 *     y creditos; calcula promedio (`Math.round` floor matemático, no banker's).
 *   - `nextMateriaId()`: si DEMO_MATERIAS vacío → 1. Else inspecciona si TODOS
 *     los ids son numéricos finitos → `max + 1`. Else fallback `mat_${Date.now()}`
 *     (timestamp string).
 * Edge:
 *   - **`archivadas` enum lowercase 4.E**: propiedad `archivadas` reemplaza
 *     legacy `inactivas`. `_sincronizarMetricasMaterias` consume `c.archivadas`.
 *   - **`nextMateriaId` heterogeneidad**: schema canónico usa ids string
 *     ("bd", "prog") pero seeds futuros podrían ser numéricos. Heurística:
 *     si TODOS numéricos → incremento entero; mixed → timestamp fallback.
 *   - **`promedioAlumnos` zero-guard**: `enriched.length ? ... : 0` evita
 *     division by zero.
 *   - **`materiasConteo` cost**: map full _enrichMateria sobre TODAS las
 *     materias por llamada — pesado si N>500. Post-Supabase considerar
 *     cache + invalidación por watch.
 *   - **`nextMateriaId` race condition**: si 2 admins crean simultáneo en
 *     prod (Firestore) → colisión id numérico. Deuda usar `serverTimestamp`
 *     o UUID en backend.
 *   - Funciones PURAS.
 *   - Twin con `clasificacionesConteo` + `nextClasificacionId` (15b.A).
 */
function materiasConteo() {
    const enriched = DEMO_MATERIAS.map(_enrichMateria);
    return {
        total:           enriched.length,
        activas:         enriched.filter(m => m.estado === "activa").length,
        archivadas:      enriched.filter(m => m.estado === "archivada").length,
        totalAlumnos:    enriched.reduce((s, m) => s + (m.alumnos  || 0), 0),
        totalCreditos:   enriched.reduce((s, m) => s + (m.creditos || 0), 0),
        promedioAlumnos: enriched.length
            ? Math.round(enriched.reduce((s, m) => s + (m.alumnos || 0), 0) / enriched.length)
            : 0,
    };
}

function nextMateriaId() {
    if (DEMO_MATERIAS.length === 0) return 1;
    // El schema canónico usa ids string ("bd", "prog"); fallback a timestamp.
    // Si todos son numéricos (futuro), preserva incremento entero.
    const numIds = DEMO_MATERIAS.map(m => Number(m.id)).filter(n => Number.isFinite(n));
    if (numIds.length === DEMO_MATERIAS.length) return Math.max(...numIds) + 1;
    return "mat_" + Date.now();
}

// ── Estado del filtro activo en la tabla ─────────────────
// 4.E: el default de estado pasa de "todos" a "activa" — las materias
// archivadas quedan ocultas por default; el admin debe cambiar el <select>
// a "Archivadas" o "Todos los estados" para verlas. Coordinado con el
// `selected` attribute en `views/admin/materias.html` (Task 6).
let _materiasFiltro = { texto: "", estado: "activa", institucion: "todas" };

/**
 * @interaction build-materias-admin-entry
 * @scope admin-materias-entrypoint
 *
 * Given DOM admin tab Materias montado.
 * When admin entra a tab Materias o tras CRUD mutation desde otro contexto.
 * Then entry orchestrator que invoca en cascada:
 *   1. `_poblarSelectFiltroInstitucion` (popula `#filtro-institucion-materia`
 *      desde DEMO_INSTITUCIONES — data-derivado, no hardcoded).
 *   2. `_renderTablaMateriasAdmin` (tbody con 3 filtros aplicados).
 *   3. `_actualizarContadorTablaMateriasAdmin` (subtitle KPI con 4 contadores).
 *   4. `buildMateriasResumen` (4 metric-cards con animación scale).
 * Edge:
 *   - **Sin DOM guards en orquestador**: cada sub-fn tiene `if (!el) return`.
 *   - **NO invoca `_sincronizarMetricasMaterias`** en el entry — solo después
 *     de CRUD mutations (4 handlers `crearMateria` + `guardarEdicionMateria`
 *     + `toggleEstadoMateria` + `eliminarMateria`). Coherente: el sync existe
 *     para propagar CAMBIOS a otros módulos, no para inicializar.
 *   - **Nombre `buildMateriasAdmin`** (con sufijo `Admin`) distingue del
 *     `buildMaterias()` estudiante (no existe función con ese nombre exacto
 *     en estudiante; pero el sufijo `Admin` evita futura colisión).
 *   - Función IMPURA (DOM cascade).
 *   - Twin con `buildCarreras` (15a.B), `buildInstituciones` (15a.C),
 *     `buildClasificaciones` (15b.A) — pero con paso EXTRA de populador filtro
 *     (institución es data-derivado vs filtro tipo enum estático en clasifs).
 */
function buildMateriasAdmin() {
    _poblarSelectFiltroInstitucion();
    _renderTablaMateriasAdmin();
    _actualizarContadorTablaMateriasAdmin();
    buildMateriasResumen();
}

// Renderiza la tabla aplicando filtros actuales
/**
 * @interaction render-tabla-materias-admin
 * @scope admin-materias-render-tabla
 *
 * Given DOM `#materias-admin-tbody` + `_materiasFiltro` (module-scope:
 * `{texto, estado, institucion}`) + DEMO_MATERIAS + helpers
 * (`_enrichMateria`, `formatHorarioText`) + DEMO_INSTITUCIONES.
 * When `buildMateriasAdmin` o handlers de filtros (`filtrarMaterias*`) o
 * CRUD mutations lo invocan.
 * Then:
 *   1. Enriquece TODAS las materias con `_enrichMateria` (vista derivada).
 *   2. Filtra por 3 criterios:
 *      - texto (substring case-insensitive en nombre + profesor + carrera).
 *      - estado (enum "activa"/"archivada" match o "todos" passthrough).
 *      - institucion (string nombre match o "todas" passthrough).
 *   3. Si vacío → empty state inline `.x-empty--inline` colspan=8.
 *   4. Else map a `<tr>` con 8 columnas: identidad (icono 📚 + nombre + clave +
 *      carrera), profesor (nombre derivado), creditos (mono o "—" si 0/null),
 *      horario (agrupado por día via `formatHorarioText`), alumnos count,
 *      institución (nombre derivado), estado (chip ok/danger), acciones
 *      (Editar + Archivar/Restaurar + Eliminar inline).
 * Edge:
 *   - **`formatHorarioText` cross-rol**: admin/estudiante/profesor usan el
 *     mismo helper (`null` segundo arg = sin filtro por grupos = admin ve TODAS
 *     las sesiones). Agrupa por día para no duplicar "lunes / lunes" cuando
 *     se imparte mismo día en grupos distintos.
 *   - **Sentinel `"—"` LIVE EN RENDERER** (4.F closure): `m.profesor || "—"`,
 *     `m.institucion || "—"`, `carreraTxt ? ... : ""`, `creditosDisplay`.
 *     null sentinel viene de `_enrichMateria` cuando cadena derivación se rompe.
 *   - **Botón toggle adaptive**: label "Archivar" vs "Restaurar" + color
 *     `var(--xahni-amber)` vs `var(--xahni-green)` según `activa`.
 *   - **Color icono row** `var(--xahni-${activa ? 'blue' : 'red'}-dim)` →
 *     visual cue archivadas.
 *   - **Chip estado** `.x-chip--ok` (verde) vs `.x-chip--danger` (rojo)
 *     refleja activa/archivada.
 *   - **`creditosDisplay` empty cue**: si null o 0 → "—". 0 créditos es
 *     legítimo pero rara vez intencional, así que mostramos sentinel.
 *   - **DOM guard `if (!el) return`** protege Phase C/E.
 *   - Función IMPURA (DOM write + cascada enrichment).
 *   - Twin con `_renderTablaCarreras` (15a.B) — pero **8 cols vs 6** por
 *     más metadata derivada (creditos + horario + alumnos + institución).
 */
function _renderTablaMateriasAdmin() {
    const el = document.getElementById("materias-admin-tbody");
    if (!el) return;

    const { texto, estado, institucion } = _materiasFiltro;
    const enriched = DEMO_MATERIAS.map(_enrichMateria);
    const filtrados = enriched.filter(m => {
        const txt = texto.toLowerCase();
        const coincideTexto = texto === "" ||
            (m.nombre   || "").toLowerCase().includes(txt) ||
            (m.profesor || "").toLowerCase().includes(txt) ||
            (m.carrera  || "").toLowerCase().includes(txt);
        const coincideEstado = estado === "todos" || m.estado === estado;
        const coincideInstitucion = institucion === "todas" || m.institucion === institucion;
        return coincideTexto && coincideEstado && coincideInstitucion;
    });

    if (filtrados.length === 0) {
        el.innerHTML = `<tr><td colspan="8"><div class="x-empty x-empty--inline"><div class="x-empty__title">Sin resultados para la búsqueda actual</div></div></td></tr>`;
        return;
    }

    el.innerHTML = filtrados.map(m => {
        // 4.E: enum lowercase. `activa` controla colores (verde/rojo) y
        // etiqueta del botón de toggle ("Archivar" vs "Restaurar").
        const activa = m.estado === "activa";
        // Admin ve TODAS las sesiones (sin filtro por grupos); el helper agrupa
        // por día para no duplicar "lunes / lunes" cuando una materia se imparte
        // el mismo día en grupos distintos. Mismo helper que usan estudiante/profesor.
        const horarioStr = typeof formatHorarioText === "function"
            ? formatHorarioText(m.horario, null)
            : (m.horario || "—");
        const creditosDisplay = (m.creditos == null || m.creditos === 0) ? "—" : m.creditos;

        // 4.F: los campos derivados pueden venir como null desde _enrichMateria
        // (cadena rota). El sentinel "—" vive aquí, no en los datos.
        const carreraTxt = m.carrera || null;
        return `
        <tr id="materia-row-${m.id}">
            <td data-label="Materia">
                <div style="display:flex;align-items:center;gap:8px">
                    <div style="width:32px;height:32px;border-radius:var(--r-sm);background:var(--xahni-${activa ? 'blue' : 'red'}-dim);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">📚</div>
                    <div>
                        <div style="font-weight:500;color:var(--text-primary)">${_escapeHtml(m.nombre) || "—"}</div>
                        <div style="font-size:11px;color:var(--text-muted)">${_escapeHtml(m.clave)}${carreraTxt ? " · " + _escapeHtml(carreraTxt) : ""}</div>
                    </div>
                </div>
            </td>
            <td data-label="Profesor" style="color:var(--text-secondary)">${_escapeHtml(m.profesor) || "—"}</td>
            <td data-label="Créditos"><span style="font-family:var(--font-mono);color:var(--text-secondary)">${creditosDisplay}</span></td>
            <td data-label="Horario" style="font-size:11px;color:var(--text-muted)">${_escapeHtml(horarioStr)}</td>
            <td data-label="Alumnos"><span style="font-family:var(--font-mono);color:var(--text-secondary)">${m.alumnos || 0}</span></td>
            <td data-label="Institución" style="font-size:11px;color:var(--text-muted)">${_escapeHtml(m.institucion) || "—"}</td>
            <td data-label="Estado"><span class="x-chip ${activa ? "x-chip--ok" : "x-chip--danger"}">${activa ? "Activa" : "Archivada"}</span></td>
            <td data-label="Acciones" class="x-cell-actions">
                <div style="display:flex;gap:4px;flex-wrap:wrap">
                    <button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 8px" onclick="abrirEditarMateria('${m.id}')">Editar</button>
                    <button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 8px;color:${activa ? "var(--xahni-amber)" : "var(--xahni-green)"}" onclick="toggleEstadoMateria('${m.id}')">${activa ? "Archivar" : "Restaurar"}</button>
                    <button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 8px;color:var(--xahni-red)" onclick="eliminarMateria('${m.id}')">Eliminar</button>
                </div>
            </td>
        </tr>`;
    }).join("");
}

/**
 * @interaction actualizar-contador-tabla-materias-admin
 * @scope admin-materias-render-badge
 *
 * Given DOM `#gestion-materias-sub` + `materiasConteo()`.
 * When `buildMateriasAdmin` o tras CRUD mutation lo invocan.
 * Then escribe textContent: `"{total} materias · {activas} activas ·
 * {archivadas} archivadas · {totalAlumnos} alumnos inscritos"`.
 * Edge:
 *   - **4 contadores en badge** (vs 3 en clasifs 15b.A, vs 2 en carreras 15a.B):
 *     refleja semántica enriquecida materias (estado dual + agregado alumnos).
 *   - **`totalCreditos` + `promedioAlumnos` NO en badge** — viven solo en
 *     `buildMateriasResumen` (cards amber + teal).
 *   - **`textContent` puro** (XSS-safe).
 *   - **DOM guard `if (!sub) return`** silent no-op si tab no montado.
 *   - Función IMPURA (DOM write).
 *   - Twin con `_actualizarContadorTablaCarreras` (15a.B) +
 *     `_actualizarContadorTablaClasificaciones` (15b.A).
 */
function _actualizarContadorTablaMateriasAdmin() {
    const sub = document.getElementById("gestion-materias-sub");
    if (!sub) return;
    const c = materiasConteo();
    sub.textContent = `${c.total} materias · ${c.activas} activas · ${c.archivadas} archivadas · ${c.totalAlumnos} alumnos inscritos`;
}

// ── Búsqueda y filtros reactivos ──────────────────────────
/**
 * @interaction filtros-materias-reactivos
 * @scope admin-materias-filtros
 *
 * Given input usuario en `#filtro-materia-busqueda` (texto) /
 * `<select #filtro-materia-estado>` (enum activa/archivada/todos) /
 * `<select #filtro-institucion-materia>` (nombre institución o "todas").
 * When usuario tipea/selecciona → onInput/onChange invoca handler.
 * Then 3 handlers combined:
 *   - `filtrarMateriasBusqueda(valor)`: muta `_materiasFiltro.texto`.
 *   - `filtrarMateriasEstado(valor)`: muta `_materiasFiltro.estado`.
 *   - `filtrarMateriasInstitucion(valor)`: muta `_materiasFiltro.institucion`.
 *   Los 3 invocan `_renderTablaMateriasAdmin` (re-filter + re-render).
 * Edge:
 *   - **Sin debounce** en texto — re-render por keystroke.
 *   - **Default `_materiasFiltro.estado="activa"`** (4.E): oculta archivadas
 *     por default; admin debe cambiar a "todos"/"archivada" para verlas.
 *     Coordinado con `selected` attribute en `views/admin/materias.html`.
 *   - **Filter por institución usa `m.institucion`** (DERIVADO via
 *     `_enrichMateria`), no `m.institucionId`. Si la cadena de derivación se
 *     rompe (`null`) → no matchea con ninguna opción.
 *   - **Filter state module-scope `_materiasFiltro`** sobrevive entre re-renders.
 *   - Funciones IMPURAS (mutate state + DOM cascade).
 *   - Twin con filtros `filtrarCarreras*` (15a.B) + `filtrarClasificaciones*` (15b.A)
 *     + los 4 filtros instituciones (15a.C).
 */
function filtrarMateriasBusqueda(valor)    { _materiasFiltro.texto = valor; _renderTablaMateriasAdmin(); }
function filtrarMateriasEstado(valor)      { _materiasFiltro.estado = valor; _renderTablaMateriasAdmin(); }
function filtrarMateriasInstitucion(valor) { _materiasFiltro.institucion = valor; _renderTablaMateriasAdmin(); }

// ── Helper: poblar select de clasificación en modales ────
/**
 * @interaction modal-materias-populadores
 * @scope admin-materias-modal-populadores
 *
 * Given selectId/containerId DOM + valor actual opcional + DEMO_USERS rol
 * profesor + DEMO_CLASIFICACIONES + DEMO_GRUPOS + DEMO_INSTITUCIONES globales.
 * When `abrirEditarMateria` (3 selects pre-llenados con valores existentes)
 * o `buildMateriasAdmin` (filtro institución data-derivado) o modal nueva
 * (manualmente desde HTML form events).
 * Then 4 populadores combined data-derivados:
 *   - `_poblarSelectClasificacionMateria(selectId, valorActual)`: lee
 *     DEMO_CLASIFICACIONES → options con `"{nombre} ({tipoLabel})"`. Default
 *     option vacío `"— Selecciona clasificación —"`. Preserva valor si existe.
 *   - `_poblarSelectProfesorMateria(selectId, valorActual)`: lee DEMO_USERS
 *     filter rol="profesor" → options con `id` + `nombre`. Reemplaza el text
 *     input legacy que congelaba el nombre del profesor (4.F).
 *   - `_poblarChecklistGruposMateria(containerId, valoresActuales)`: lee
 *     DEMO_GRUPOS → labels con `<input type=checkbox>` (no `<select multiple>`
 *     que requería Ctrl/Cmd-clic no descubrible). Lectura usa
 *     `querySelectorAll(":checked")` no `.selectedOptions`.
 *   - `_poblarSelectFiltroInstitucion()` (sin args, lee `#filtro-institucion-materia`):
 *     lee DEMO_INSTITUCIONES sort alfabético → options con `nombre`. Default
 *     option `"Todas las instituciones"`. Preserva valor actual si sigue existiendo.
 *     Reemplaza options hardcoded del HTML que no matcheaban con el seed real.
 * Edge:
 *   - **Pattern data-derivado**: 4 populadores reflejan estado actual JSON, no
 *     catalog estático. Críticos para post-Supabase cuando los seeds cambian
 *     dinámicamente.
 *   - **`typeof === "undefined"` guards** sobre DEMO_USERS/DEMO_GRUPOS/
 *     DEMO_INSTITUCIONES → protegen Phase C/E.
 *   - **Preservación de valor actual**: los 4 verifican `[...sel.options].some(o => o.value === ...)`
 *     antes de re-asignar; evita "reset visual" tras CRUD.
 *   - **`String()` coerce** explícito en value comparisons protege contra
 *     numérico/string mismatch.
 *   - **Sort alfabético SOLO en filtro institución** (`_poblarSelectFiltroInstitucion`)
 *     — los 3 populadores de modal preservan orden de inserción JSON. Decisión
 *     UX: filtro busca por nombre, modal busca por ID conocido.
 *   - **`_poblarChecklistGruposMateria` reemplaza `<select multiple>`** legacy
 *     → mejora UX (no requiere Ctrl/Cmd-clic) + mantiene mismo schema
 *     `materia.grupos[]`.
 *   - **Sin selección por default en modal**: los 3 populadores devuelven a
 *     valor inicial vacío salvo pase un `valorActual`.
 *   - Funciones IMPURAS (DOM write).
 *   - **Pattern único admin** — sin twin directo en carreras/instituciones/
 *     clasificaciones (que solo populan filtros, no modales internos).
 */
function _poblarSelectClasificacionMateria(selectId, valorActual) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = `<option value="">— Selecciona clasificación —</option>` +
        DEMO_CLASIFICACIONES.map(c => {
            const tipoLabel = c.tipo === "troncoComun" ? "Tronco común" : "Especialidad";
            return `<option value="${_escapeHtml(c.id)}">${_escapeHtml(c.nombre)} (${tipoLabel})</option>`;
        }).join("");
    if (valorActual != null && [...sel.options].some(o => o.value === String(valorActual))) {
        sel.value = String(valorActual);
    }
}

// ── Helper: poblar select de profesor (canónico, profesorId) ──
// Lee de DEMO_USERS rol "profesor". Reemplaza el text input legacy
// que congelaba el nombre del profesor en la materia (4.F).
function _poblarSelectProfesorMateria(selectId, valorActual) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const profesores = (typeof DEMO_USERS !== "undefined")
        ? DEMO_USERS.filter(u => u.tipo === "profesor")
        : [];
    sel.innerHTML = `<option value="">— Selecciona profesor —</option>` +
        profesores.map(p => `<option value="${_escapeHtml(p.id)}">${_escapeHtml(p.nombre)}</option>`).join("");
    if (valorActual != null && [...sel.options].some(o => o.value === String(valorActual))) {
        sel.value = String(valorActual);
    }
}

// ── Helper: poblar checklist de grupos (canónico, materia.grupos[]) ──
// Lee de DEMO_GRUPOS. Reemplaza el `<select multiple>` HTML5 nativo (que
// requería Ctrl/Cmd-clic no descubrible para toggle individual y rompía
// el flujo edit en muchos contextos) por una lista vertical de
// `<label><input type=checkbox>`. La lectura en save usa
// `querySelectorAll(":checked")` en lugar de `.selectedOptions`.
function _poblarChecklistGruposMateria(containerId, valoresActuales) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const grupos = (typeof DEMO_GRUPOS !== "undefined") ? DEMO_GRUPOS : [];
    const actuales = new Set((valoresActuales || []).map(String));
    el.innerHTML = grupos.map(g => {
        const checked = actuales.has(String(g.id)) ? " checked" : "";
        return `<label style="display:flex;align-items:center;gap:8px;padding:4px;cursor:pointer">`
             + `<input type="checkbox" value="${_escapeHtml(g.id)}"${checked} />`
             + `<span>${_escapeHtml(g.nombre) || _escapeHtml(g.id)}</span>`
             + `</label>`;
    }).join("");
}

// ── Helper: poblar dropdown de filtro de institución (lazy, desde DEMO_INSTITUCIONES) ──
// Reemplaza las opciones hardcoded del HTML (UTC/ITM/UNICARIBE/UADY/UPB
// que no matcheaban con el seed real). Se llama desde `buildMateriasAdmin`
// para mantener el dropdown alineado con los datos. Preserva la selección
// actual si sigue existiendo en la nueva lista.
function _poblarSelectFiltroInstitucion() {
    const sel = document.getElementById("filtro-institucion-materia");
    if (!sel) return;
    const instituciones = (typeof DEMO_INSTITUCIONES !== "undefined") ? DEMO_INSTITUCIONES : [];
    const valor = sel.value || "todas";
    sel.innerHTML = `<option value="todas">Todas las instituciones</option>` +
        instituciones
            .slice()
            .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""))
            .map(i => `<option value="${_escapeHtml(i.nombre)}">${_escapeHtml(i.nombre)}</option>`)
            .join("");
    if ([...sel.options].some(o => o.value === valor)) sel.value = valor;
}

// ── Helper: render de chips readonly para campos derivados ──
// "Vista derivada" del modal: profesor (nombre), institución, carrera,
// alumnos, cuatrimestre. NO editables — sustituyen los text inputs
// legacy que congelaban estos valores en el payload (deuda §4 B2).
/**
 * @interaction modal-materias-chips-derivados-readonly
 * @scope admin-materias-modal-chips-derivados
 *
 * Given containerId DOM (modal editar) + materia raw + helper `_enrichMateria`.
 * When `abrirEditarMateria` necesita mostrar los 5 campos derivados como
 * chips readonly junto a los 7 inputs editables.
 * Then:
 *   1. Si `!materia` → vacía container.
 *   2. Enriquece materia via `_enrichMateria`.
 *   3. Renderea 5 chips con icono + label + valor:
 *      - 👨‍🏫 Profesor — `enr.profesor`
 *      - 🏫 Institución — `enr.institucion`
 *      - 🎓 Carrera — `enr.carrera`
 *      - 👥 Alumnos — `enr.alumnos`
 *      - 📅 Cuatrimestre — `enr.cuatrimestre`
 *   4. Sentinel "—" si valor null/empty/string "—".
 *   5. Tooltip title "(derivado, no editable)".
 * Edge:
 *   - **Cierra deuda §4 B2** (cementado 4.F): reemplaza text inputs legacy
 *     que congelaban estos valores en el payload. Ahora son chips visuales
 *     readonly + derivados al render.
 *   - **Tooltip pedagógico**: comunica al admin que estos campos NO se editan
 *     aquí (deben editarse en su origen — profesor en usuarios, carrera en
 *     grupos, etc.).
 *   - **Sentinel triple defensivo**: `null || "" || "—"` → "—". Cubre tanto
 *     null literal de `_enrichMateria` como string "—" legacy + empty string.
 *   - **DOM guard `if (!el) return`** silent no-op.
 *   - **NO se incluye en modal NUEVA** — solo en editar (semánticamente:
 *     materia recién creada no tiene grupos asignados aún → derivados serían
 *     todos "—").
 *   - Función IMPURA (DOM write).
 *   - **Pattern crítico 4.F** anti-congelamiento: trasladar metadata derivada
 *     a UI readonly + nunca al payload de save.
 */
function _renderChipsDerivadosMateria(containerId, materia) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!materia) { el.innerHTML = ""; return; }
    const enr = _enrichMateria(materia);
    const chips = [
        { icono: "👨‍🏫", label: "Profesor",     valor: enr.profesor },
        { icono: "🏫",   label: "Institución",  valor: enr.institucion },
        { icono: "🎓",   label: "Carrera",      valor: enr.carrera },
        { icono: "👥",   label: "Alumnos",      valor: enr.alumnos },
        { icono: "📅",   label: "Cuatrimestre", valor: enr.cuatrimestre },
    ];
    el.innerHTML = chips.map(c => {
        const valor = (c.valor == null || c.valor === "" || c.valor === "—") ? "—" : c.valor;
        return `<span class="x-chip" title="${c.label} (derivado, no editable)">${c.icono} ${c.label}: <strong>${_escapeHtml(valor)}</strong></span>`;
    }).join("");
}

// ── Helper: sincroniza grupo.materias[] ↔ materia.grupos[] (in-memory, demo) ──
// Tras saveMateria con un nuevo set de grupos, ajusta DEMO_GRUPOS:
//   - añade materiaId a grupo.materias[] de los grupos recién asignados
//   - lo retira de los grupos des-asignados
// Solo afecta in-memory (DEMO_GRUPOS). En prod (Firestore) necesitaría
// un batched write — deuda explícita documentada en merge log de 4.F.
/**
 * @interaction sync-grupos-materia-bidireccional
 * @scope admin-materias-sync-grupos
 *
 * Given materiaId + nuevosGruposIds (array IDs grupos asignados) + DEMO_GRUPOS
 * global mutable.
 * When `crearMateria` / `guardarEdicionMateria` (tras saveMateria) ajusta
 * referencias bidireccionales; o `eliminarMateria` invoca con `[]` para limpiar.
 * Then:
 *   1. `Set` de los nuevos IDs con `String()` coerce.
 *   2. Foreach DEMO_GRUPOS:
 *      - Garantiza `g.materias` es array (init `[]` si missing).
 *      - Si grupo debe tenerla pero no la tiene → push materiaId.
 *      - Si grupo NO debe tenerla pero la tiene → filter out.
 *   3. Sin mutación si ya estaba en el estado correcto (idempotente).
 * Edge:
 *   - **Deuda Firestore batched write**: solo afecta in-memory DEMO_GRUPOS. En
 *     prod necesitaría `writeBatch` server-side o transaction para garantizar
 *     atomicidad. Documentado en merge log 4.F.
 *   - **Idempotente**: re-invocaciones con mismos args no causan cambios.
 *   - **Eliminación con `[]`**: `eliminarMateria` invoca ANTES de
 *     `DataService.deleteMateria` para limpiar `grupo.materias[]` huérfanos
 *     (§4#2). Defensivo: si delete falla server-side, grupos ya están limpios
 *     (UX preferida).
 *   - **Sin signal a `buildGruposAdmin` o módulos consumidores**: post-mutación,
 *     ningún render forzado a otros tabs (intencional — re-renderan al re-entrar).
 *   - **`typeof DEMO_GRUPOS === "undefined"` guard** protege Phase C/E.
 *   - **`String()` coerce** en Set y comparaciones evita numérico/string mismatch.
 *   - **`if (!Array.isArray(g.materias)) g.materias = []`** auto-heals seeds
 *     con shape incompleto.
 *   - Función IMPURA (mutate global DEMO_GRUPOS).
 *   - **Pattern único admin** — no existe twin en clasifs/carreras/instituciones
 *     (que no tienen relación M:N reflexiva con grupos).
 */
function _syncGruposMateriasAdmin(materiaId, nuevosGruposIds) {
    if (typeof DEMO_GRUPOS === "undefined") return;
    const nuevos = new Set((nuevosGruposIds || []).map(String));
    DEMO_GRUPOS.forEach(g => {
        if (!Array.isArray(g.materias)) g.materias = [];
        const tieneActualmente = g.materias.includes(materiaId);
        const debeTener = nuevos.has(String(g.id));
        if (debeTener && !tieneActualmente) {
            g.materias.push(materiaId);
        } else if (!debeTener && tieneActualmente) {
            g.materias = g.materias.filter(mid => mid !== materiaId);
        }
    });
}

// ── Crear materia ─────────────────────────────────────────
// 4.F: payload canónico 1:1 con el schema. Sin profesor/institución/
// carrera/alumnos/cuatrimestre/horario en el payload — los derivados
// se calculan al render. horario[] arranca como [] (el editor de
// horarios admin tiene su propio modal para añadir slots después).
/**
 * @interaction crear-materia-handler-async
 * @scope admin-materias-crear-async
 *
 * Given inputs modal `#modal-nueva-materia-admin` (7 campos canónicos +
 * checklist grupos) + DEMO_MATERIAS global.
 * When admin submit modal nueva materia.
 * Then async flow:
 *   1. Lee 7 inputs: nombre + clave + profesorId + clasificacionId + grupos
 *      (checked checkboxes) + estado (default "activa") + creditos (parseInt).
 *   2. Valida obligatorios: nombre + profesorId + clasificacionId + estado →
 *      toast "faltan campos" + abort.
 *   3. Valida unicidad nombre case-insensitive → toast "ya existe" + abort.
 *   4. `nextMateriaId()` genera id.
 *   5. `await DataService.saveMateria({...7 campos + juegos:[] + horario:[]})`.
 *      Try/catch atrapa err.message.
 *   6. `_syncGruposMateriasAdmin(id, grupos)` sync bidireccional in-memory.
 *   7. Limpia 7 inputs del form + closeModal.
 *   8. Cascade 4 renders: tabla + contador + resumen + sincronizarMetricas
 *      (KPIs admin dashboard + ADMIN_MODULOS_DATA mutate).
 *   9. Toast success.
 * Edge:
 *   - **Payload canónico 4.F** (cierra deuda §4 B2): solo 7 campos del schema
 *     + 2 inicializaciones explícitas (`juegos: []` + `horario: []`). NO
 *     incluye profesor/institución/carrera/alumnos/cuatrimestre (derivados al
 *     render via `_enrichMateria`).
 *   - **`horario: []` inicial**: el editor de horarios admin tiene su propio
 *     modal (`js/admin/horarios.js` — sesión 15c) para añadir slots después.
 *   - **`juegos: []` inicial**: stub forward para Pilar 2 gamificación
 *     (post-Supabase + Examenes).
 *   - **5 invocaciones cascada** (extiende 4-cascada admin 15a con sync KPIs):
 *     incluye `_sincronizarMetricasMaterias` que propaga a `ADMIN_MODULOS_DATA`
 *     + `_actualizarMetricasAdminPanel`.
 *   - **Limpieza form pre-closeModal**: previene re-popular inputs si admin
 *     reabre modal en misma sesión sin recargar.
 *   - **`grupos` puede ser `[]`** → materia sin grupos asignados (válido en
 *     creación inicial; admin asigna después via edit).
 *   - **`creditos = parseInt(...) || 0`**: defaults a 0 si NaN/empty (legítimo
 *     en seeds tipo "Asesoría" sin créditos).
 *   - Función IMPURA (async + DOM cascade + DataService side effect + sync
 *     bidireccional grupos).
 *   - Twin con `crearCarrera` (15a.B), `crearInstitucion` (15a.C),
 *     `crearClasificacion` (15b.A) — pero con sync bidireccional + sync KPIs
 *     únicos.
 */
async function crearMateria() {
    const nombre = document.getElementById("nueva-materia-nombre")?.value.trim();
    const clave = document.getElementById("nueva-materia-clave")?.value.trim();
    const profesorId = document.getElementById("nueva-materia-profesor-id")?.value;
    const clasificacionId = document.getElementById("nueva-materia-clasificacion")?.value;
    const grupos = [...document.querySelectorAll("#nueva-materia-grupos input[type=checkbox]:checked")].map(cb => cb.value);
    const estado = document.getElementById("nueva-materia-estado")?.value || "activa";
    const creditos = parseInt(document.getElementById("nueva-materia-creditos")?.value) || 0;

    if (!nombre || !profesorId || !clasificacionId || !estado) {
        showToast("Faltan campos obligatorios: nombre, profesor, clasificación, estado.", "error");
        return;
    }
    if (DEMO_MATERIAS.some(m => (m.nombre || "").toLowerCase() === nombre.toLowerCase())) {
        showToast("Ya existe una materia con ese nombre.", "error");
        return;
    }

    const id = nextMateriaId();
    try {
        await DataService.saveMateria({
            id,
            nombre, clave, profesorId, clasificacionId,
            grupos, estado, creditos,
            juegos: [],
            horario: [],
        });
    } catch (err) {
        showToast(err?.message || `Error: ${err}`, "error");
        return;
    }

    _syncGruposMateriasAdmin(id, grupos);

    document.getElementById("nueva-materia-nombre").value = "";
    document.getElementById("nueva-materia-clave").value = "";
    document.getElementById("nueva-materia-profesor-id").value = "";
    document.getElementById("nueva-materia-clasificacion").value = "";
    document.getElementById("nueva-materia-grupos").innerHTML = "";
    document.getElementById("nueva-materia-estado").value = "activa";
    document.getElementById("nueva-materia-creditos").value = "";

    closeModal("modal-nueva-materia-admin");
    _renderTablaMateriasAdmin();
    _actualizarContadorTablaMateriasAdmin();
    buildMateriasResumen();
    _sincronizarMetricasMaterias();
    showToast(`Materia ${nombre} creada correctamente`, "success");
}

// ── Editar materia ────────────────────────────────────────
let _editandoMateriaId = null;

// 4.F: lee del raw (no del enriquecido) y pre-llena los 7 inputs canónicos
// del modal. Los campos derivados (profesor nombre, institución, carrera,
// alumnos, cuatrimestre) se renderizan como chips readonly vía
// _renderChipsDerivadosMateria — ya no se inyectan al payload de save.
/**
 * @interaction abrir-editar-materia-bootstrap
 * @scope admin-materias-editar-bootstrap
 *
 * Given id materia + DEMO_MATERIAS global + DOM modal `#modal-editar-materia-admin`.
 * When admin clica botón "Editar" en row de la tabla.
 * Then:
 *   1. Find materia RAW por id (NO enriquecida — 4.F payload directo).
 *      Si no existe → silent return.
 *   2. Side-channel `_editandoMateriaId = id` (module-scope).
 *   3. Pre-llena los 7 inputs canónicos editables:
 *      - nombre, clave, creditos (`?? 0`), estado (ternario explícito por
 *        si raw.estado es null defensivo).
 *      - Selects con populadores data-derivados: profesor + clasificación.
 *      - Checklist grupos via `_poblarChecklistGruposMateria`.
 *   4. Renderea 5 chips derivados readonly via `_renderChipsDerivadosMateria(raw)`.
 *   5. `openModal("modal-editar-materia-admin")`.
 * Edge:
 *   - **4.F lee RAW, no enriched**: payload modal trabaja sobre los 7 campos
 *     canónicos del schema, NO sobre la vista derivada. Los derivados van solo
 *     a chips readonly.
 *   - **`raw.estado === "archivada" ? "archivada" : "activa"`**: ternario
 *     defensivo si dato corrupto/legacy enum uppercase.
 *   - **`raw.creditos ?? 0`**: nullish coalescing preserva 0 como valor
 *     válido (vs `||` que lo trataría como falsy).
 *   - **`abrirEditarMateria` se invoca DESDE template inline** `onclick="abrirEditarMateria('${m.id}')"`
 *     → id viene como string. Compara con `m.id === id` (sin `String()` coerce)
 *     porque DEMO_MATERIAS usa ids string consistentemente.
 *   - **Side-channel `_editandoMateriaId`** module-scope (sin contención, 1
 *     modal a la vez). NO se resetea post-save (sobrevive hasta próximo
 *     `abrirEditarMateria`). OK.
 *   - **NO se incluye horario en form inputs**: editor de horarios admin
 *     vive en modal aparte (15c sesión).
 *   - Función IMPURA (DOM write + module state mutation).
 *   - Twin con `abrirEditarClasificacion` (15b.A) + `abrirEditarCarrera` (15a.B)
 *     pero **6 inputs vs 2** + 5 chips derivados (único).
 */
function abrirEditarMateria(id) {
    const raw = DEMO_MATERIAS.find(m => m.id === id);
    if (!raw) return;
    _editandoMateriaId = id;
    document.getElementById("editar-materia-nombre").value = raw.nombre || "";
    document.getElementById("editar-materia-clave").value = raw.clave || "";
    document.getElementById("editar-materia-creditos").value = raw.creditos ?? 0;
    document.getElementById("editar-materia-estado").value = raw.estado === "archivada" ? "archivada" : "activa";
    _poblarSelectProfesorMateria("editar-materia-profesor-id", raw.profesorId);
    _poblarSelectClasificacionMateria("editar-materia-clasificacion", raw.clasificacionId);
    _poblarChecklistGruposMateria("editar-materia-grupos", raw.grupos);
    _renderChipsDerivadosMateria("editar-materia-chips-derivados", raw);
    openModal("modal-editar-materia-admin");
}

// 4.F: payload construido EXPLÍCITAMENTE con los 7 campos canónicos.
// Ya no spreadea {...formValues} con derivados. Tras saveMateria, sync
// bidireccional con grupo.materias[] (in-memory; deuda prod en merge log).
// Validación de unicidad por nombre global (ya no usa m.institucion —
// derivado). horario[] se preserva: NO se incluye en el payload, por lo
// que _upsertById deja el array existente intacto.
/**
 * @interaction guardar-edicion-materia-async
 * @scope admin-materias-guardar-async
 *
 * Given inputs modal `#modal-editar-materia-admin` + `_editandoMateriaId`
 * (module-scope) + DEMO_MATERIAS global.
 * When admin submit modal editar materia.
 * Then async flow:
 *   1. Find materia por `_editandoMateriaId`. Si no existe → silent return.
 *   2. Lee 7 inputs canónicos.
 *   3. Valida obligatorios → toast "faltan campos" + abort.
 *   4. Valida unicidad nombre case-insensitive EXCLUYENDO self → toast
 *      "ya existe otra" + abort.
 *   5. `await DataService.saveMateria({...7 campos})`. Try/catch atrapa
 *      err.message.
 *   6. `_syncGruposMateriasAdmin(m.id, grupos)` sync bidireccional.
 *   7. closeModal + cascade 5 renders (tabla + contador + resumen + sync
 *      KPIs cross-módulo).
 *   8. Toast success.
 * Edge:
 *   - **Payload canónico 4.F EXPLÍCITO** (no spread `...formValues`): los 7
 *     campos se construyen literalmente. Cierra deuda §4 B2 (no congelar
 *     derivados).
 *   - **`horario[]` PRESERVADO**: NO se incluye en el payload, por lo que
 *     `_upsertById` deja el array existente intacto. Si admin edita materia,
 *     el horario configurado vía `js/admin/horarios.js` (15c) sobrevive.
 *   - **`juegos[]` también preservado** por la misma lógica (no en payload).
 *   - **Validación exclude-self** crítica para edit (`x.id !== _editandoMateriaId`).
 *   - **NO usa `m.institucion`** en validación (deuda evitada: institución
 *     es derivada — usaba mismo institucion historica pre-4.F → falsos
 *     positivos cross-institución).
 *   - **5 invocaciones cascada** (tabla + contador + resumen + sync KPIs):
 *     extiende pattern admin estándar 15a 4-cascada.
 *   - Función IMPURA (async + DOM cascade + DataService side effect + sync
 *     bidireccional grupos + sync KPIs cross-módulo).
 *   - Twin con `guardarEdicionCarrera` (15a.B), `guardarEdicionClasificacion`
 *     (15b.A) — pero con sync bidireccional + 5 cascade vs 3.
 */
async function guardarEdicionMateria() {
    const m = DEMO_MATERIAS.find(m => m.id === _editandoMateriaId);
    if (!m) return;

    const nombre = document.getElementById("editar-materia-nombre")?.value.trim();
    const clave = document.getElementById("editar-materia-clave")?.value.trim();
    const profesorId = document.getElementById("editar-materia-profesor-id")?.value;
    const clasificacionId = document.getElementById("editar-materia-clasificacion")?.value;
    const grupos = [...document.querySelectorAll("#editar-materia-grupos input[type=checkbox]:checked")].map(cb => cb.value);
    const estado = document.getElementById("editar-materia-estado")?.value;
    const creditos = parseInt(document.getElementById("editar-materia-creditos")?.value) || 0;

    if (!nombre || !profesorId || !clasificacionId || !estado) {
        showToast("Faltan campos obligatorios: nombre, profesor, clasificación, estado.", "error");
        return;
    }
    if (DEMO_MATERIAS.some(x => (x.nombre || "").toLowerCase() === nombre.toLowerCase() && x.id !== _editandoMateriaId)) {
        showToast("Ya existe otra materia con ese nombre.", "error");
        return;
    }

    try {
        await DataService.saveMateria({
            id: m.id,
            nombre, clave, profesorId, clasificacionId,
            grupos, estado, creditos,
        });
    } catch (err) {
        showToast(err?.message || `Error: ${err}`, "error");
        return;
    }

    _syncGruposMateriasAdmin(m.id, grupos);

    closeModal("modal-editar-materia-admin");
    _renderTablaMateriasAdmin();
    _actualizarContadorTablaMateriasAdmin();
    buildMateriasResumen();
    _sincronizarMetricasMaterias();
    showToast(`Materia ${nombre} actualizada correctamente`, "success");
}

// ── Archivar / Restaurar ──────────────────────────────────
// 4.E: la acción legacy "desactivar" pasa a "archivar". Semántica: la
// materia archivada no se borra (preserva calificaciones y grupos pasados
// — regla 6 del spec) y queda fuera del listado activo del admin y del
// listado del profesor.
/**
 * @interaction toggle-estado-materia-async
 * @scope admin-materias-toggle-async
 *
 * Given id materia + DEMO_MATERIAS global.
 * When admin clica botón "Archivar" o "Restaurar" en row.
 * Then async flow:
 *   1. Find materia por id. Si no existe → silent return.
 *   2. Calcula nuevoEstado flip: "activa" ↔ "archivada".
 *   3. `await DataService.saveMateria({id, estado: nuevoEstado})` (payload
 *      MÍNIMO solo 2 campos).
 *   4. Cascade 4 renders + sync KPIs.
 *   5. Toast: "restaurada" si activa (success verde) / "archivada" si else
 *      (info azul). Coherente con regla 6 (no es destructivo).
 * Edge:
 *   - **4.E enum lowercase**: legacy "desactivar" → "archivar". Semántica
 *     preserva calificaciones y grupos pasados (regla 6 spec) — NO se borra,
 *     queda fuera del listado activo admin + profesor.
 *   - **Payload MÍNIMO 2 campos**: `_upsertById` patch only mode (merge sobre
 *     materia existente). Profesor/grupos/horario/etc. permanecen intactos.
 *   - **Sin `confirmarCanonico`** (vs `eliminarMateria` que SÍ lo usa):
 *     toggle es reversible → no necesita confirmación.
 *   - **`showToast` 2 variantes**: `success` (verde) si restaurada / `info`
 *     (azul) si archivada. Tono consistente: archivar NO es error.
 *   - **NO `_syncGruposMateriasAdmin`** — toggle estado no cambia relaciones
 *     grupo↔materia.
 *   - **NO try/catch explícito** — si DataService.saveMateria throw, error
 *     burbujea al `onclick` handler (unhandled promise rejection). Deuda
 *     menor: agregar try/catch + toast error para coherencia con otros CRUD
 *     handlers async.
 *   - **Filtro `_materiasFiltro.estado="activa"` default** (4.E): tras
 *     archivar, materia desaparece del listado activo a menos que cambie
 *     filtro. UX correcto pero puede sorprender al admin novato.
 *   - Función IMPURA (async + DOM cascade + DataService side effect + sync KPIs).
 *   - **Pattern único admin** — no existe twin directo (carreras/instituciones
 *     no tienen lifecycle archivar/restaurar — solo eliminate; instituciones
 *     usa `toggleEstadoInstitucion` que es semánticamente diferente: activo↔inactivo
 *     más cerca de soft-delete que de archive).
 */
async function toggleEstadoMateria(id) {
    const m = DEMO_MATERIAS.find(m => m.id === id);
    if (!m) return;
    const nuevoEstado = m.estado === "activa" ? "archivada" : "activa";
    await DataService.saveMateria({ id: m.id, estado: nuevoEstado });
    _renderTablaMateriasAdmin();
    _actualizarContadorTablaMateriasAdmin();
    buildMateriasResumen();
    _sincronizarMetricasMaterias();
    showToast(
        `Materia ${m.nombre} ${nuevoEstado === "activa" ? "restaurada" : "archivada"}.`,
        nuevoEstado === "activa" ? "success" : "info"
    );
}

// ── Eliminar materia ──────────────────────────────────────
/**
 * @interaction eliminar-materia-async-sync-defensivo
 * @scope admin-materias-eliminar-async
 *
 * Given id materia + DEMO_MATERIAS global.
 * When admin clica botón "Eliminar" en row.
 * Then async flow:
 *   1. Find materia por id. Si no existe → silent return.
 *   2. `confirmarCanonico` modal danger. Si cancela → silent return.
 *   3. **PRE-DELETE sync defensivo**: `_syncGruposMateriasAdmin(mat.id, [])`
 *      limpia `grupo.materias[]` huérfanos ANTES del delete server (§4#2).
 *   4. `await DataService.deleteMateria(mat.id)`.
 *   5. Cascade 4 renders + sync KPIs.
 *   6. Toast info "eliminada del sistema".
 * Edge:
 *   - **Sync DEFENSIVO pre-delete**: orden inverso a otros CRUD (que sync
 *     POST-save). Razón: si delete server falla, los grupos ya están limpios
 *     localmente — UX prefiere consistencia visual sobre fidelidad atomic.
 *     Si delete falla, próxima sync (auto-poll Firestore) re-añadiría
 *     materia + grupos quedarían huérfanos hasta entonces. Deuda: post-Supabase
 *     usar transaction batched para garantizar atomicidad.
 *   - **NO try/catch** sobre `DataService.deleteMateria`: si fallara, exception
 *     burbujea. Asimétrico con clasificaciones.js (que SÍ atrapa FK guard).
 *     Deuda: agregar try/catch + manejo `MATERIA_IN_USE` si schema lo
 *     introduce (e.g., calificaciones referencian materiaId).
 *   - **`confirmarCanonico` danger** botón rojo "Eliminar".
 *   - **`showToast` info** (no success) — semánticamente: eliminar NO es
 *     éxito celebratorio (regla 6 archivar > eliminar es preferida).
 *   - **5 invocaciones cascada** vía sync KPIs (igual que crear/editar).
 *   - **Sin guardia FK explícita en cliente** (no precounts grupos/calificaciones
 *     que pudieran romperse) — confía en server-side. Deuda: agregar warning
 *     pre-delete si grupos.length>0 (UX) — twin futuro con FK guard regla 7
 *     de clasificaciones.
 *   - Función IMPURA (async + DOM cascade + DataService side effect + sync
 *     bidireccional + sync KPIs).
 *   - Twin con `eliminarCarrera` (15a.B FK guard CARRERA_IN_USE),
 *     `eliminarClasificacion` (15b.A FK guard CLASIF_IN_USE),
 *     `eliminarInstitucion` (15a.C sin FK guard).
 *     **DEUDA ANOTADA**: agregar guardia FK MATERIA_IN_USE simétrica para
 *     consistencia post-Supabase.
 */
async function eliminarMateria(id) {
    const mat = DEMO_MATERIAS.find(m => m.id === id);
    if (!mat) return;
    const nombre = mat.nombre;

    const ok = await confirmarCanonico({
        titulo: "Eliminar materia",
        mensaje: `¿Eliminar <strong>${_escapeHtml(nombre)}</strong>? Esta acción no se puede deshacer.`,
        accionTexto: "Eliminar",
        tipo: "danger",
    });
    if (!ok) return;

    _syncGruposMateriasAdmin(mat.id, []);   // §4#2: limpia grupo.materias[] huérfanos
    await DataService.deleteMateria(mat.id);
    _renderTablaMateriasAdmin();
    _actualizarContadorTablaMateriasAdmin();
    buildMateriasResumen();
    _sincronizarMetricasMaterias();
    showToast(`Materia ${nombre} eliminada del sistema.`, "info");
}

// ── Sincronizar métricas con dashboard y módulos ──────────
/**
 * @interaction sincronizar-metricas-materias-cross-modulo
 * @scope admin-materias-sincronizar-metricas
 *
 * Given `materiasConteo()` + `ADMIN_MODULOS_DATA` global mutable + helpers
 * `buildPerfilModulosAdmin` / `_actualizarMetricasAdminPanel`.
 * When CRUD mutation (`crearMateria` / `guardarEdicionMateria` /
 * `toggleEstadoMateria` / `eliminarMateria`) lo invoca al final del flujo.
 * Then propaga conteos a 2 módulos consumidores:
 *   1. `ADMIN_MODULOS_DATA.find(m => m.nombre === "Materias")` mutate in-place:
 *      - `total` = c.total.
 *      - `detalle[0].valor` = c.activas.
 *      - `detalle[1].valor` = c.archivadas (4.E renombró desde `inactivas`).
 *      - `detalle[2].valor` = max(0, total - activas - archivadas) (defensivo
 *        si algún día aparece tercer estado).
 *      Tras mutate → invoca `buildPerfilModulosAdmin()` para re-render.
 *   2. `_actualizarMetricasAdminPanel()` re-render KPIs dashboard admin.
 * Edge:
 *   - **Mutate global `ADMIN_MODULOS_DATA` in-place**: pattern admin cementado
 *     15a. Deuda post-Supabase: vista materializada server-side via Cloud
 *     Function o subscription para evitar duplicación de truth.
 *   - **4.E rename `inactivas` → `archivadas`**: coordinado con
 *     `modulos.js:ADMIN_MODULOS_DATA[Materias].detalle[1].label = "Archivadas"`.
 *   - **`detalle[2].valor` defensivo `max(0, ...)`**: si algún día aparece
 *     tercer estado (ej. "pausada"), el valor no será negativo. Otherwise
 *     siempre = 0 con enum binario actual.
 *   - **`typeof === "function"` guards** sobre `buildPerfilModulosAdmin` +
 *     `_actualizarMetricasAdminPanel`: protegen Phase C/E gradual rollout.
 *   - **`typeof === "undefined"` guard** sobre `ADMIN_MODULOS_DATA`: silent
 *     no-op si módulo no cargado (ej. tests aislados).
 *   - **Coupling implícito**: depende de que `ADMIN_MODULOS_DATA` tenga entry
 *     `{nombre: "Materias", detalle: [...]}` con shape conocido. Si renombran
 *     o reordenan en `modulos.js` → silent failure.
 *   - **Performance OK**: invocaciones cascada baratas (DOM update + 2 funciones).
 *     Si N materias > 1000 considerar throttle.
 *   - Función IMPURA (mutate global + DOM cascade).
 *   - Twin con `_sincronizarMetricasInstituciones` (15a.C — pattern más
 *     extenso con 3 propagaciones). Materias usa 2 propagaciones.
 *   - **Asimetría con clasificaciones.js (15b.A)**: clasifs NO sincroniza
 *     KPIs cross-módulo (no hay entry "Clasificaciones" en `ADMIN_MODULOS_DATA`).
 *     Deuda post-Supabase agregar.
 */
function _sincronizarMetricasMaterias() {
    const c = materiasConteo();

    if (typeof ADMIN_MODULOS_DATA !== "undefined") {
        const modMaterias = ADMIN_MODULOS_DATA.find(m => m.nombre === "Materias");
        if (modMaterias) {
            modMaterias.total = c.total;
            modMaterias.detalle[0].valor = c.activas;
            // 4.E: `inactivas` renombrado a `archivadas` en materiasConteo.
            // detalle[1].label coincide en modulos.js ("Archivadas").
            modMaterias.detalle[1].valor = c.archivadas;
            modMaterias.detalle[2].valor = Math.max(0, c.total - c.activas - c.archivadas);
            if (typeof buildPerfilModulosAdmin === "function") buildPerfilModulosAdmin();
        }
    }

    if (typeof _actualizarMetricasAdminPanel === "function") _actualizarMetricasAdminPanel();
}

// ── Construir tarjetas de resumen ─────────────────────────
/**
 * @interaction build-materias-resumen
 * @scope admin-materias-resumen
 *
 * Given DOM `#materias-admin-resumen` + `materiasConteo()` + helper
 * `institucionesConteo()`.
 * When `buildMateriasAdmin` o tras CRUD mutation lo invoca.
 * Then:
 *   1. Fade-out fase 1: opacity 0.6 + scale(0.98).
 *   2. `setTimeout 150ms` fase 2: renderea 4 metric-cards:
 *      - **blue**: total materias (delta ternario `up`/`neutral`: "{activas}
 *        activas · {archivadas} archivadas").
 *      - **teal**: alumnos inscritos (toLocaleString) + delta "Promedio {N}
 *        por materia".
 *      - **amber**: créditos totales + delta "promedio créditos por materia"
 *        (ternario zero-guard).
 *      - **purple**: instituciones (cross-archivo lookup) + delta
 *        "Ofreciendo {total} materias".
 *   3. Fade-in: transition + opacity 1 + scale 1.
 * Edge:
 *   - **Cross-archivo lookup `institucionesConteo()`**: `typeof === "function"`
 *     guard + fallback `0`. Acopla materias resumen a instituciones cargado
 *     primero — orden de scripts importa.
 *   - **`c.totalAlumnos.toLocaleString()`**: format con separadores miles
 *     según locale (es-MX: punto). Solo en card teal — no en badge ni tabla.
 *   - **Delta dinámico ternario** card blue: `c.activas > c.archivadas ? 'up'
 *     : 'neutral'` → flecha verde si predominan activas (estado saludable).
 *   - **`c.total ? Math.round(c.totalCreditos / c.total) : 0`** zero-guard
 *     promedio créditos.
 *   - **Animación CSS inline** style.opacity/transform + setTimeout 150ms.
 *     Deuda: cementar `.metric-card` legacy → `.x-stat` canonical.
 *   - **DOM guard `if (!el) return`** silent no-op.
 *   - **NO incluye conteo `sinGrupos` o `sinProfesor`** — cards limitadas a
 *     totales agregados; gaps de relación no visibles aquí (deuda UX:
 *     warning panel separado).
 *   - Función IMPURA (DOM write + async setTimeout cascade + cross-archivo
 *     side-effect read).
 *   - Twin con `buildCarrerasResumen` (15a.B), `buildInstitucionesResumen`
 *     (15a.C), `buildClasificacionesResumen` (15b.A).
 */
function buildMateriasResumen() {
    const el = document.getElementById("materias-admin-resumen");
    if (!el) return;

    const c = materiasConteo();
    el.style.opacity = "0.6";
    el.style.transform = "scale(0.98)";

    setTimeout(() => {
        el.innerHTML = `
            <div class="metric-card blue">
                <div class="metric-icon blue">📚</div>
                <div class="metric-value">${c.total}</div>
                <div class="metric-label">Total materias</div>
                <div class="metric-delta ${c.activas > c.archivadas ? 'up' : 'neutral'}">
                    ${c.activas} activas · ${c.archivadas} archivadas
                </div>
            </div>
            <div class="metric-card teal">
                <div class="metric-icon teal">👥</div>
                <div class="metric-value">${c.totalAlumnos.toLocaleString()}</div>
                <div class="metric-label">Alumnos inscritos</div>
                <div class="metric-delta neutral">Promedio ${c.promedioAlumnos} por materia</div>
            </div>
            <div class="metric-card amber">
                <div class="metric-icon amber">📦</div>
                <div class="metric-value">${c.totalCreditos}</div>
                <div class="metric-label">Créditos totales</div>
                <div class="metric-delta neutral">${c.total ? Math.round(c.totalCreditos / c.total) : 0} promedio por materia</div>
            </div>
            <div class="metric-card purple">
                <div class="metric-icon purple">🏫</div>
                <div class="metric-value">${(typeof institucionesConteo === "function" ? institucionesConteo().total : 0)}</div>
                <div class="metric-label">Instituciones</div>
                <div class="metric-delta neutral">Ofreciendo ${c.total} materias</div>
            </div>
        `;
        el.style.transition = "all 0.3s ease";
        el.style.opacity = "1";
        el.style.transform = "scale(1)";
    }, 150);
}
