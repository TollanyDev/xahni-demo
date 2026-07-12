// ═══════════════════════════════════════════════════════════
// BUILDERS — Administrador: Gestión de Grupos
// Patrón rector: js/admin/materias.js. Lectura desde DEMO_GRUPOS
// (poblado por DataService desde data/demo/grupos.json). Las
// mutaciones pasan por DataService.saveGrupo / deleteGrupo.
//
// Schema canónico del grupo:
//   { id, nombre, nivel, puntos, carreraId, materias[], miembros[],
//     logros[], color, emblema, marco, estado,
//     periodo: { id, nombre, duracionMeses, inicio, fin, parciales[] } }
//
// El periodo se deriva por defecto de carrera.duracionMeses +
// fecha_inicio; el admin puede "personalizar" (escape hatch).
// Cohort-locked como UX: añadir miembros libre; remover requiere
// confirmarCanonico listando los nombres.
// ═══════════════════════════════════════════════════════════

// ── Helpers locales ──────────────────────────────────────
/**
 * @interaction grupos-helpers-visibles-conteo-nextid
 * @scope admin-grupos-helpers
 *
 * Given DEMO_GRUPOS array global + `_gruposFiltro.estado` module-scope + input
 * string (nombre).
 * When `_renderTablaGruposAdmin` necesita slice visible, o `buildGruposResumen`/
 * `_actualizarContadorTablaGrupos` necesitan KPIs, o `crearGrupo` necesita
 * generar id determinista.
 * Then 3 helpers combined:
 *   - `_gruposVisibles()`: filter por `_gruposFiltro.estado`:
 *     - "activos" → estado !== "archivado" (incluye undefined/null defensivo).
 *     - "archivados" → estado === "archivado" estricto.
 *     - else → passthrough todos (catch-all "todos los estados").
 *   - `gruposConteo()`: retorna `{total, carreras, alumnos, archivados}`:
 *     - `total`/`carreras`/`alumnos` calculados sobre VISIBLES (respetan filtro).
 *     - `archivados` SIEMPRE sobre `DEMO_GRUPOS` completo (asimetría intencional —
 *       card resumen "Grupos archivados" siempre muestra count real, no filtrado).
 *   - `nextGrupoId(nombre)`: UPPERCASE + replace whitespace por `-`. Si colisiona,
 *     incrementa sufijo `-2`, `-3`... hasta libre.
 *
 * Asimetrías cross-archivo:
 *   - **`nextGrupoId` UPPERCASE** vs `nextCarreraId`/`nextClasificacionId` (15a.B/15b.A)
 *     que usan **slug lowercase con strip diacritics**. Decisión histórica: grupos
 *     usan ids tipo `ISC-2026A` (siglas + cohorte), no slugs de palabras.
 *   - **`gruposConteo.archivados` SIEMPRE total** vs `materiasConteo`/`clasificacionesConteo`
 *     que aplican filtro a TODOS los counts. Asimetría UX: card archivados es
 *     stat global, no filtrada.
 *   - **`_gruposVisibles` NO usa `String()` coerce** en estado match (vs handlers
 *     CRUD que sí — `_renderTablaGruposAdmin` con `String(g.carreraId) === String(carreraId)`).
 *     OK porque estado es enum string fijo.
 *
 * Deuda post-migración (Supabase):
 *   - **`gruposConteo` cost O(N + DEMO_GRUPOS.length)**: doble iteración (vis + archivados
 *     total). Post-Supabase: vista materializada server-side con count agregado por estado.
 *   - **`nextGrupoId` race condition prod**: si 2 admins crean simultáneo → colisión
 *     id determinista (mismo nombre). Usar UUID o serverTimestamp en backend.
 *   - **`nextGrupoId` NO incluye `_slugGrupo` strip diacritics** — si admin tipea
 *     "Cohorte Único" → "COHORTE-ÚNICO" preserva acento (puede romper URLs/queries).
 *     Deuda menor: aplicar `.normalize('NFD').replace(/[̀-ͯ]/g, '')`.
 *
 * Edge:
 *   - **`(g.miembros?.length || 0)`** optional chaining + fallback defensivo
 *     contra grupos sin `miembros[]` (seed corruption protect).
 *   - **`new Set(...).filter(x => x)`** elimina null/undefined carreraIds (grupos
 *     huérfanos sin carrera).
 *   - **`(nombre || 'grupo')`** fallback si null.
 *   - Funciones PURAS (lecturas + retorno; sin mutaciones).
 *   - Twin con `clasificacionesConteo`/`carrerasConteo`/`institucionesConteo` —
 *     pero shape distinto y `nextId` con esquema único uppercase.
 */
function _gruposVisibles() {
    // Aplica filtro estado: 'activos' es default; archivados visibles
    // solo si el admin lo pide explícitamente.
    return DEMO_GRUPOS.filter(g => {
        if (_gruposFiltro.estado === "activos")    return g.estado !== "archivado";
        if (_gruposFiltro.estado === "archivados") return g.estado === "archivado";
        return true;
    });
}

function gruposConteo() {
    const vis = _gruposVisibles();
    return {
        total:       vis.length,
        carreras:    new Set(vis.map(g => g.carreraId).filter(x => x)).size,
        alumnos:     vis.reduce((s, g) => s + (g.miembros?.length || 0), 0),
        archivados:  DEMO_GRUPOS.filter(g => g.estado === "archivado").length,
    };
}

function nextGrupoId(nombre) {
    const base = (nombre || 'grupo').toUpperCase().replace(/\s+/g, '-');
    if (!DEMO_GRUPOS.some(g => String(g.id) === base)) return base;
    let i = 2;
    while (DEMO_GRUPOS.some(g => String(g.id) === `${base}-${i}`)) i++;
    return `${base}-${i}`;
}

// ── Estado del filtro activo en la tabla ─────────────────
let _gruposFiltro = { texto: "", carreraId: "todas", estado: "activos" };

/**
 * @interaction build-grupos-admin-entry
 * @scope admin-grupos-entrypoint
 *
 * Given DOM admin tab Grupos montado.
 * When admin entra a tab Grupos o tras CRUD mutation.
 * Then entry orchestrator que invoca en cascada:
 *   1. `_poblarFiltroCarrerasGrupo` (popula select carreras data-derivado).
 *   2. `_renderTablaGruposAdmin` (tbody con 3 filtros aplicados).
 *   3. `_actualizarContadorTablaGrupos` (badge 4 contadores).
 *   4. `buildGruposResumen` (4 metric-cards).
 *
 * Asimetrías cross-archivo:
 *   - **NO valida `APP.user.tipo === "administrador"`** (vs `buildHorariosView`
 *     15c que SÍ valida explícitamente). Sigue pattern mayoría admin entrypoints
 *     (asume navigation.js correcto). Deuda menor: unificar guard rol cross-admin.
 *   - **NO invoca `_sincronizarMetricasGrupos`** (no existe — grupos NO sincroniza
 *     KPIs cross-módulo a `ADMIN_MODULOS_DATA`). Asimetría con materias 15b.B que
 *     SÍ tiene `_sincronizarMetricasMaterias`. Coherente con clasifs/horarios
 *     también sin sync.
 *
 * Deuda post-migración (Supabase):
 *   - **Agregar entry "Grupos" en `ADMIN_MODULOS_DATA`** + sync cross-módulo
 *     equivalente a materias 15b.B. Tarjeta dashboard admin actualmente NO
 *     refleja conteo grupos.
 *   - **Guard rol unificado**: extraer pattern `if (!APP.user || APP.user.tipo !== "administrador") return`
 *     a helper compartido `_assertAdmin()` y aplicar en TODOS los entrypoints admin.
 *
 * Edge:
 *   - Sin DOM guards en orquestador — cada sub-fn tiene `if (!el) return`.
 *   - Re-llamado post-CRUD (`crearGrupo`/`guardarEdicionGrupo`/`archivarGrupo`/
 *     `eliminarGrupo`) → re-render completo 4-cascada.
 *   - Función IMPURA (DOM cascade).
 *   - Twin con `buildMateriasAdmin` (15b.B), `buildHorariosView` (15c).
 */
function buildGruposAdmin() {
    _poblarFiltroCarrerasGrupo();
    _renderTablaGruposAdmin();
    _actualizarContadorTablaGrupos();
    buildGruposResumen();
}

/**
 * @interaction grupos-poblar-filtro-carreras
 * @scope admin-grupos-poblar-filtro
 *
 * Given DOM `#filtro-carrera-grupo` + DEMO_CARRERAS global.
 * When `buildGruposAdmin` orchestrator inicializa.
 * Then:
 *   1. Captura `valActual` pre-render (preservación cross-render).
 *   2. Renderea options: `"Todas las carreras"` default + 1 por DEMO_CARRERAS.
 *   3. Restaura `valActual` si sigue en options.
 *
 * Asimetrías cross-archivo:
 *   - **Sin sort alfabético** vs `_poblarSelectFiltroInstitucion` materias 15b.B
 *     que ordena (`localeCompare`). Preserva orden inserción JSON. Deuda menor:
 *     unificar a sort alfabético admin-wide.
 *
 * Deuda post-migración (Supabase):
 *   - **Sin filtro por institución del admin actual**: poblar TODAS las carreras
 *     cross-instituciones puede ser ruido. Post-Supabase: si admin tiene scope
 *     institución, filter carreras por `c.institucionId === APP.user.institucionId`.
 *
 * Edge:
 *   - **DOM guard `if (!sel) return`** silent no-op.
 *   - **Preservación de selección**: importante porque el populador se invoca
 *     cada vez que el admin entra al tab (sin reset visual).
 *   - Función IMPURA (DOM write).
 *   - Twin con populadores filtros otros admin.
 */
function _poblarFiltroCarrerasGrupo() {
    const sel = document.getElementById("filtro-carrera-grupo");
    if (!sel) return;
    const valActual = sel.value;
    sel.innerHTML = `<option value="todas">Todas las carreras</option>` +
        DEMO_CARRERAS.map(c => `<option value="${_escapeHtml(c.id)}">${_escapeHtml(c.nombre)}</option>`).join("");
    if ([...sel.options].some(o => o.value === valActual)) sel.value = valActual;
}

/**
 * @interaction grupos-render-tabla-7cols-adaptive
 * @scope admin-grupos-render-tabla
 *
 * Given DOM `#grupos-tbody` + `_gruposFiltro` + `_gruposVisibles()` +
 * DEMO_CARRERAS global.
 * When `buildGruposAdmin` o handlers filtros o CRUD mutations lo invocan.
 * Then:
 *   1. Filtra `_gruposVisibles()` (estado pre-aplicado) por texto (substring
 *      en nombre + id) + carreraId (match con `String()` coerce).
 *   2. Si vacío → empty state inline colspan=7.
 *   3. Else map a `<tr>` con 7 cols: identidad (emblema + nombre + id mono),
 *      carrera (lookup DEMO_CARRERAS), periodo nombre derivado, # materias,
 *      # alumnos, estado (chip ok/muted), acciones (Editar + Archivar/Reactivar
 *      ADAPTIVE + Eliminar inline).
 *
 * Asimetrías cross-archivo:
 *   - **Toggle botón "Archivar"/"Reactivar"** vs materias 15b.B "Archivar"/"Restaurar".
 *     Semántica casi idéntica (soft delete reversible) pero labels distintos.
 *     Deuda menor: unificar a un solo wording cross-admin.
 *   - **Lookup carrera por id** con fallback `'—'` vs `_renderTablaMateriasAdmin`
 *     que usa `_enrichMateria` enriqueciendo TODAS las materias. Grupos lookup
 *     puntual por row (más eficiente pero menos rico para fast access).
 *   - **Emblema con fallback `🛡️`** unique — pattern gamificado embebido en
 *     entidad (vs materias usa `📚` hardcoded en renderer).
 *
 * Deuda post-migración (Supabase):
 *   - **N lookups DEMO_CARRERAS por row**: O(N × C). Post-Supabase: JOIN
 *     server-side o vista materializada.
 *   - **`periodoTxt` cae con `'—'`** si grupo sin periodo (legacy seeds). Deuda:
 *     migration script garantizar todos los grupos con periodo derivado en backend.
 *   - **`emblema || '🛡️'`** hardcoded fallback. Post-migración a TS+Next:
 *     mover defaults a constante compartida (`DEFAULT_GROUP_EMBLEMA`) +
 *     futura UI customización admin del emblema/marco/color.
 *
 * Edge:
 *   - **DOM guard `if (!el) return`** silent no-op.
 *   - **Filter sobre VISIBLES no DEMO_GRUPOS**: estado ya pre-aplicado vía
 *     `_gruposVisibles`. Doble filtro evita.
 *   - **`badgeClass` ternario** chip `--ok` (activo) vs `--muted` (archivado).
 *   - **Botones inline con `_escapeHtml` ausente en `g.id`** porque `nextGrupoId`
 *     garantiza UPPERCASE+dashes (sin `'` ni HTML especiales). Pero deuda menor:
 *     `_escapeHtml(g.id)` defensivo para seeds corruptos.
 *   - Función IMPURA (DOM write).
 *   - Twin con `_renderTablaMateriasAdmin` (15b.B 8 cols) — pero 7 cols + emblema
 *     gamificado + toggle archive/reactivate.
 */
function _renderTablaGruposAdmin() {
    const el = document.getElementById("grupos-tbody");
    if (!el) return;

    const { texto, carreraId } = _gruposFiltro;
    const filtrados = _gruposVisibles().filter(g => {
        const txt = texto.toLowerCase();
        const coincideTexto = texto === "" ||
            (g.nombre || "").toLowerCase().includes(txt) ||
            (g.id || "").toLowerCase().includes(txt);
        const coincideCarrera = carreraId === "todas" || String(g.carreraId) === String(carreraId);
        return coincideTexto && coincideCarrera;
    });

    if (filtrados.length === 0) {
        el.innerHTML = `<tr><td colspan="7"><div class="x-empty x-empty--inline"><div class="x-empty__title">Sin resultados para la búsqueda actual</div></div></td></tr>`;
        return;
    }

    el.innerHTML = filtrados.map(g => {
        const carrera = DEMO_CARRERAS.find(c => String(c.id) === String(g.carreraId));
        const nMat   = g.materias?.length || 0;
        const nAlum  = g.miembros?.length || 0;
        const estado = g.estado === "archivado" ? "archivado" : "activo";
        const badgeClass = estado === "archivado" ? "x-chip x-chip--muted" : "x-chip x-chip--ok";
        const periodoTxt = g.periodo?.nombre || '—';

        return `
        <tr id="grupo-row-${g.id}">
            <td data-label="Grupo">
                <div style="display:flex;align-items:center;gap:8px">
                    <div style="width:32px;height:32px;border-radius:var(--r-sm);background:var(--xahni-blue-dim);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">${g.emblema || '🛡️'}</div>
                    <div>
                        <div style="font-weight:500;color:var(--text-primary)">${_escapeHtml(g.nombre)}</div>
                        <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono)">${_escapeHtml(g.id)}</div>
                    </div>
                </div>
            </td>
            <td data-label="Carrera" style="color:var(--text-secondary)">${carrera ? _escapeHtml(carrera.nombre) : '—'}</td>
            <td data-label="Periodo" style="color:var(--text-secondary);font-size:12px">${_escapeHtml(periodoTxt)}</td>
            <td data-label="Materias"><span style="font-family:var(--font-mono);color:var(--text-secondary)">${nMat}</span></td>
            <td data-label="Alumnos"><span style="font-family:var(--font-mono);color:var(--text-secondary)">${nAlum}</span></td>
            <td data-label="Estado"><span class="${badgeClass}">${estado}</span></td>
            <td data-label="Acciones" class="x-cell-actions">
                <div style="display:flex;gap:4px;flex-wrap:wrap">
                    <button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 8px" onclick="abrirEditarGrupo('${g.id}')">Editar</button>
                    <button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 8px" onclick="archivarGrupo('${g.id}')">${g.estado === 'archivado' ? 'Reactivar' : 'Archivar'}</button>
                    <button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 8px;color:var(--xahni-red)" onclick="eliminarGrupo('${g.id}')">Eliminar</button>
                </div>
            </td>
        </tr>`;
    }).join("");
}

/**
 * @interaction grupos-actualizar-badge
 * @scope admin-grupos-render-badge
 *
 * Given DOM `#gestion-grupos-sub` + `gruposConteo()`.
 * When `buildGruposAdmin` o tras CRUD mutation o filtros estado.
 * Then escribe textContent: `"{total} grupos · {carreras} carrera(s) ·
 * {alumnos} alumnos · {archivados} archivado(s)"`.
 *
 * Asimetrías cross-archivo:
 *   - **4 contadores en badge** igual que materias 15b.B (vs 3 en clasifs/horarios).
 *     Refleja semántica enriquecida.
 *   - **`{archivados}` SIEMPRE total real** (no filtrado por `_gruposFiltro.estado`)
 *     — coherente con `gruposConteo` (asimetría intencional documentada en bloque 1).
 *
 * Deuda post-migración (Supabase):
 *   - **Triple invocación de `gruposConteo`** por render (badge + resumen + filter
 *     trigger). Post-Supabase: subscribir KPIs server-side + push reactivo.
 *
 * Edge:
 *   - **DOM guard** silent no-op.
 *   - **`textContent` puro** XSS-safe.
 *   - Función IMPURA (DOM write).
 */
function _actualizarContadorTablaGrupos() {
    const sub = document.getElementById("gestion-grupos-sub");
    if (!sub) return;
    const c = gruposConteo();
    sub.textContent = `${c.total} grupos · ${c.carreras} carrera(s) · ${c.alumnos} alumnos · ${c.archivados} archivado(s)`;
}

/**
 * @interaction grupos-resumen-4-metric-cards-promedio-decimal
 * @scope admin-grupos-resumen
 *
 * Given DOM `#grupos-resumen` + `gruposConteo()`.
 * When `buildGruposAdmin` o tras CRUD mutation o filtro estado.
 * Then renderea 4 metric-cards SIN animación:
 *   - **blue**: 👥 grupos activos + delta "{N} carrera(s)".
 *   - **teal**: 🎓 alumnos inscritos + delta "En {N} grupos".
 *   - **amber**: 📦 grupos archivados + delta "Conservan historial".
 *   - **purple**: 📊 alumnos/grupo (PROMEDIO DECIMAL `Math.round(N * 10) / 10`).
 *
 * Asimetrías cross-archivo:
 *   - **SIN animación cubic-bezier ni scale** vs `buildClasificacionesResumen`
 *     (15b.A) + `buildMateriasResumen` (15b.B) + `buildHorariosResumen` (15c que
 *     usa overshoot). Render directo. Decisión histórica — visual menos
 *     "celebratorio". Deuda menor: unificar.
 *   - **Promedio DECIMAL `* 10) / 10`** vs `materiasConteo.promedioAlumnos`
 *     (15b.B) que es `Math.round(.../ N)` entero. Decisión UX: para grupos
 *     "23.5 alumnos/grupo" da más resolución que "24".
 *   - **Card "archivados" amber** mismo color que materias 15b.B "Créditos
 *     totales" — colisión semántica menor.
 *
 * Deuda post-migración (Supabase):
 *   - **Animación**: alinear con pattern admin canonical (cubic-bezier overshoot
 *     de horarios 15c se cementó como el más moderno).
 *   - **Cementar tokens `.metric-card` legacy → `.x-stat` canonical** post-migración
 *     TS+Tailwind. Aplica a TODOS los resúmenes admin.
 *
 * Edge:
 *   - **DOM guard** silent no-op.
 *   - **Zero-guard promedio**: `c.total > 0 ? ... : 0` evita NaN/Infinity.
 *   - **Card archivados muestra count GLOBAL** (no filtrado) — coherente con
 *     `gruposConteo.archivados`.
 *   - Función IMPURA (DOM write).
 *   - Twin con resúmenes otros admin pero sin animación.
 */
function buildGruposResumen() {
    const el = document.getElementById("grupos-resumen");
    if (!el) return;
    const c = gruposConteo();
    el.innerHTML = `
        <div class="metric-card blue">
            <div class="metric-icon blue">👥</div>
            <div class="metric-value">${c.total}</div>
            <div class="metric-label">Grupos activos</div>
            <div class="metric-delta neutral">${c.carreras} carrera(s)</div>
        </div>
        <div class="metric-card teal">
            <div class="metric-icon teal">🎓</div>
            <div class="metric-value">${c.alumnos}</div>
            <div class="metric-label">Alumnos inscritos</div>
            <div class="metric-delta neutral">En ${c.total} grupos</div>
        </div>
        <div class="metric-card amber">
            <div class="metric-icon amber">📦</div>
            <div class="metric-value">${c.archivados}</div>
            <div class="metric-label">Grupos archivados</div>
            <div class="metric-delta neutral">Conservan historial</div>
        </div>
        <div class="metric-card purple">
            <div class="metric-icon purple">📊</div>
            <div class="metric-value">${c.total > 0 ? Math.round(c.alumnos / c.total * 10) / 10 : 0}</div>
            <div class="metric-label">Alumnos / grupo</div>
            <div class="metric-delta neutral">Promedio</div>
        </div>
    `;
}

// ── Búsqueda y filtros reactivos ──────────────────────────
/**
 * @interaction grupos-filtros-reactivos-triple-cascade-estado
 * @scope admin-grupos-filtros
 *
 * Given input usuario en `#filtro-grupo-busqueda` (texto) /
 * `<select #filtro-carrera-grupo>` (carreraId o "todas") /
 * `<select #filtro-grupo-estado>` (enum "activos"/"archivados"/"todos").
 * When onInput/onChange invoca handler.
 * Then 3 handlers combined CON CASCADA ASIMÉTRICA:
 *   - `filtrarGruposBusqueda(valor)`: muta texto → solo `_renderTablaGruposAdmin`.
 *   - `filtrarGruposCarrera(valor)`: muta carreraId → solo `_renderTablaGruposAdmin`.
 *   - `filtrarGruposEstado(valor)`: muta estado → **TRIPLE CASCADA**:
 *     `_renderTablaGruposAdmin` + `_actualizarContadorTablaGrupos` + `buildGruposResumen`.
 *     Razón: cambiar estado CAMBIA los counts visibles (badge + cards reflejan
 *     selección visible). Texto/carrera NO cambian counts (siempre sobre VISIBLES).
 *
 * Asimetrías cross-archivo:
 *   - **Triple cascada solo en estado** (única en admin): vs `filtrarMaterias*` 15b.B
 *     que NUNCA re-rendera resumen (counts globales no cambian al filtrar visualmente).
 *     Grupos es diferente porque `_gruposVisibles` aplica estado pre-filter →
 *     todos los counts derivan de estado.
 *   - **`filtrarGruposEstado` NO re-pobla filtro carreras** (vs `aplicarFiltroHorarios`
 *     15c branch institución que SÍ resetea grupo). Coherente — cambiar estado no
 *     invalida opciones carrera.
 *   - **API específica** (3 fn) vs `aplicarFiltroHorarios(tipo, valor)` 15c genérica.
 *     Cementa pattern admin 15b: filtros específicos por tipo (type safety estático).
 *
 * Deuda post-migración (Supabase):
 *   - **Sin debounce en texto**: re-render por keystroke. Aceptable DEMO; post-Supabase
 *     debounce 150ms.
 *   - **`buildGruposResumen` invoca `gruposConteo()` que itera DEMO_GRUPOS completo**:
 *     en cada filter estado, recalcula. Post-Supabase: subscribir counts server-side
 *     con push reactivo (Realtime channel).
 *
 * Edge:
 *   - **Filter state module-scope `_gruposFiltro`** sobrevive entre re-renders.
 *   - **`String()` coerce solo en carreraId match** (en `_renderTablaGruposAdmin`),
 *     no en texto/estado match (innecesarios — string consistente).
 *   - Funciones IMPURAS (mutate state + DOM cascade).
 *   - Twin parcial con filtros otros admin pero ÚNICO con triple cascada estado.
 */
function filtrarGruposBusqueda(valor) { _gruposFiltro.texto = valor; _renderTablaGruposAdmin(); }
function filtrarGruposCarrera(valor)  { _gruposFiltro.carreraId = valor; _renderTablaGruposAdmin(); }
function filtrarGruposEstado(valor)   { _gruposFiltro.estado = valor; _renderTablaGruposAdmin(); _actualizarContadorTablaGrupos(); buildGruposResumen(); }

// ═══════════════════════════════════════════════════════════
// P4: derivación de periodo + parciales + crear grupo
// ═══════════════════════════════════════════════════════════

// ── Constantes y helpers de fecha ─────────────────────────
const _MES_NOMBRE = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const _MES_ABREV  = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

/**
 * @interaction grupos-helpers-fecha-matematicos
 * @scope admin-grupos-helpers-fecha
 *
 * Given input string ISO `"YYYY-MM-DD"` o Date object + número días/meses +
 * 2 const lookup `_MES_NOMBRE` (12 nombres completos) + `_MES_ABREV` (12
 * abreviados 3-char).
 * When `_derivarPeriodo` / `_generarParciales` / `_renderParcialesUI` necesitan
 * aritmética de fechas (suma días/meses, parse ISO, serializar a ISO).
 * Then 4 helpers combined matemáticos:
 *   - `_parseISODate(s)`: `new Date(s + "T00:00:00")` o null si !s.
 *     `T00:00:00` evita interpretación UTC (sin sufijo, JS lo parsea como UTC
 *     y suma timezone offset en local → off-by-one day en zonas oeste).
 *   - `_toISO(d)`: `d.toISOString().slice(0,10)` → string `"YYYY-MM-DD"` (UTC).
 *   - `_addDays(d, days)`: clona Date + `setDate(getDate() + days)`.
 *   - `_addMonths(d, months)`: clona Date + `setMonth(getMonth() + months)`.
 *
 * Asimetrías cross-archivo:
 *   - **Inverso a helpers tiempo horarios 15c** (`horaEnRango`/`calcularDuracionHoras`/
 *     `horariosSeSuperponen`) que trabajan en granularidad HORA con string HHmm.
 *     Aquí granularidad DÍA con Date object + ISO string. **Cada archivo admin
 *     que maneja tiempo usa su propio set de helpers** — deuda futura: extraer
 *     `js/core/datetime-helpers.js` shared.
 *   - **`_MES_NOMBRE`/`_MES_ABREV` const inline** vs estaría más limpio en
 *     `js/core/locale-es.js`. Deuda menor i18n.
 *
 * Deuda post-migración (Supabase):
 *   - **Sin timezone handling**: `_parseISODate` asume local time. Si admin
 *     vive en zona distinta a sede institucional → fechas off-by-one.
 *     Post-Supabase: usar `Temporal API` o `date-fns-tz` con timezone explícito
 *     de la institución.
 *   - **`_toISO` UTC explícito** vs `_parseISODate` local — INCONSISTENCIA.
 *     Si admin parsea "2026-03-15" local y luego serializa, puede obtener
 *     "2026-03-14" si está en zona oeste. Bug latente — deuda alta post-Supabase.
 *   - **Mutación con `setDate`/`setMonth`** depende de comportamiento JS Date:
 *     `setMonth(13)` overflow al siguiente año. OK pero implícito. Refactor TS:
 *     usar `date-fns` `addMonths` que es explícito.
 *   - **Sin tests unitarios** helpers críticos (igual que horarios 15c).
 *
 * Edge:
 *   - **`_parseISODate(null)` → null** defensivo.
 *   - **`new Date(d)` clona** evita mutación del input — funciones puras.
 *   - **`.slice(0, 10)`** asume formato ISO `"YYYY-MM-DDTHH:MM:SS.sssZ"` standard.
 *   - Funciones PURAS.
 *   - **Pattern único admin** — el otro archivo con datetime helpers es horarios 15c
 *     pero distinto dominio (HH vs YYYY-MM-DD).
 */
function _parseISODate(s) { return s ? new Date(s + "T00:00:00") : null; }
function _toISO(d) { return d.toISOString().slice(0,10); }
function _addDays(d, days) { const r = new Date(d); r.setDate(r.getDate() + days); return r; }
function _addMonths(d, months) { const r = new Date(d); r.setMonth(r.getMonth() + months); return r; }

// ── Derivación de periodo ─────────────────────────────────
/**
 * @interaction grupos-deriva-periodo-y-genera-parciales
 * @scope admin-grupos-deriva-periodo-parciales
 *
 * Given carreraId + fechaInicioISO + DEMO_CARRERAS (lookup carrera.duracionMeses).
 * When `_refrescarPeriodoNuevo` / `_refrescarPeriodoEditar` re-derivan en cascada,
 * o `_onParcialSemanasChange` re-genera parciales con override.
 * Then 2 fn combined derivación canonical:
 *   - `_derivarPeriodo(carreraId, fechaInicioISO)`: retorna
 *     `{duracionMeses, fechaFin, nombre}`:
 *     1. Lookup carrera por id → `carrera?.duracionMeses ?? 4` (default
 *        cuatrimestre estándar UTC).
 *     2. Si !fechaInicio → `{duracionMeses, fechaFin: null, nombre: ""}`.
 *     3. `fin = _addMonths(inicio, duracionMeses)`.
 *     4. Nombre: si mismo año → `"Enero–Marzo 2026"` (mes completo + año fin).
 *        Si distinto año → `"Sep 2025–Mar 2026"` (mes abrev + año cada uno).
 *   - `_generarParciales(inicio, fin, semanasOverride)`: retorna array 3 parciales
 *     con `{num, semanas, inicio, fin}`:
 *     1. Si !inicio || !fin || fin <= inicio → `[]`.
 *     2. `dias = round((fin - inicio) / día)`; `semanasTotal = max(3, round(dias / 7))`.
 *     3. **Heurística 3 parciales balanceados**:
 *        - `semanasOverride` array de 3 enteros → `Math.max(1, parseInt(n) || 1)`.
 *        - `semanasTotal >= 17` → `[6, 6, semanasTotal - 12]` (cuatrimestre largo).
 *        - `semanasTotal >= 12` → tercios floor.
 *        - `else` → tercios ceil + `Math.max(1, ...)` defensivo.
 *     4. Cursor walk acumulando inicio + fin de cada parcial.
 *
 * Asimetrías cross-archivo:
 *   - **Heurística 3 parciales hardcoded** vs schema configurable (otro admin
 *     no tiene parciales). Pattern único grupos.
 *   - **Default `duracionMeses = 4`** asume cuatrimestre estándar UTC. Si una
 *     institución usa semestres (6 meses) → carrera.duracionMeses debe estar
 *     poblado en el JSON. Fallback safety.
 *
 * Deuda post-migración (Supabase):
 *   - **Schema parciales hardcoded a 3**: si algún día se admiten 2 (bimestre)
 *     o 4 (trimestre internacional), refactor mayor. Deuda: parametrizar
 *     `cantidadParciales` por carrera o institución.
 *   - **`fin <= inicio` retorna `[]` silencioso**: admin no recibe feedback si
 *     metió fechas inválidas. Deuda: validation toast pre-llamada.
 *   - **Math.round/ceil/floor para distribución semanas**: ok para DEMO pero
 *     no respeta feriados/recesos académicos (de ahí el "permitido por recesos"
 *     en `_renderParcialesUI`). Post-Supabase: integrar calendario académico
 *     institucional (días no-lectivos por institución).
 *   - **`_derivarPeriodo` `duracionMeses ?? 4`** acoplado a UTC. Post-Supabase
 *     mover default a config institucional.
 *
 * Edge:
 *   - **`semanasTotal = Math.max(3, ...)`**: piso defensivo (nunca menos de 3
 *     parciales).
 *   - **`semanasOverride.length === 3` validation**: ignora override si shape
 *     incorrecto.
 *   - **`Math.max(1, parseInt(n) || 1)`**: triple defensivo contra NaN/0/negativos.
 *   - **`sameYear` ternario** afecta el formato del nombre (UX legibilidad).
 *   - Funciones PURAS (no mutan DEMO_CARRERAS — solo lectura).
 *   - **Pattern único admin** — derivación de campos con escape hatch personalizar.
 */
function _derivarPeriodo(carreraId, fechaInicioISO) {
    const carrera = DEMO_CARRERAS.find(c => String(c.id) === String(carreraId));
    const duracionMeses = carrera?.duracionMeses ?? 4;
    const inicio = _parseISODate(fechaInicioISO);
    if (!inicio) return { duracionMeses, fechaFin: null, nombre: "" };
    const fin = _addMonths(inicio, duracionMeses);
    const sameYear = inicio.getFullYear() === fin.getFullYear();
    const nombre = sameYear
        ? `${_MES_NOMBRE[inicio.getMonth()]}–${_MES_NOMBRE[fin.getMonth()]} ${fin.getFullYear()}`
        : `${_MES_ABREV[inicio.getMonth()]} ${inicio.getFullYear()}–${_MES_ABREV[fin.getMonth()]} ${fin.getFullYear()}`;
    return { duracionMeses, fechaFin: _toISO(fin), nombre };
}

// ── Generación de parciales (3, auto-editables) ───────────
function _generarParciales(fechaInicioISO, fechaFinISO, semanasOverride) {
    const inicio = _parseISODate(fechaInicioISO);
    const fin    = _parseISODate(fechaFinISO);
    if (!inicio || !fin || fin <= inicio) return [];
    const dias = Math.round((fin - inicio) / (1000*60*60*24));
    const semanasTotal = Math.max(3, Math.round(dias / 7));

    let semanas;
    if (Array.isArray(semanasOverride) && semanasOverride.length === 3) {
        semanas = semanasOverride.map(n => Math.max(1, parseInt(n) || 1));
    } else if (semanasTotal >= 17) {
        semanas = [6, 6, semanasTotal - 12];
    } else if (semanasTotal >= 12) {
        const base = Math.floor(semanasTotal / 3);
        semanas = [base, base, semanasTotal - 2*base];
    } else {
        const base = Math.ceil(semanasTotal / 3);
        semanas = [base, base, Math.max(1, semanasTotal - 2*base)];
    }

    const out = [];
    let cursorIni = inicio;
    for (let i = 0; i < 3; i++) {
        const cursorFin = _addDays(cursorIni, semanas[i] * 7 - 1);
        out.push({ num: i+1, semanas: semanas[i], inicio: _toISO(cursorIni), fin: _toISO(cursorFin) });
        cursorIni = _addDays(cursorFin, 1);
    }
    return out;
}

// ── Estado del modal "nuevo grupo" en curso ───────────────
let _nuevoGrupoState = {
    personalizar: false,
    parciales: [],          // ediciones vivas, sincronizadas con el tbody
};

/**
 * @interaction grupos-state-reset-y-render-parciales-ui
 * @scope admin-grupos-state-parciales-ui
 *
 * Given `_nuevoGrupoState` module-scope `{personalizar, parciales[]}` + DOM
 * `#${prefix}-grupo-parciales-tbody` + `#${prefix}-grupo-parciales-sum`.
 * When `abrirNuevoGrupo` necesita state limpio, o `_refrescarPeriodo*` /
 * `_onParcialSemanasChange` repueblan UI con parciales actualizados.
 * Then 2 fn combined:
 *   - `_resetNuevoGrupoState()`: re-asigna `_nuevoGrupoState = {personalizar: false,
 *     parciales: []}`. NO existe `_resetEditandoGrupoState` (asimetría
 *     intencional — editar reconstruye state desde el grupo existente en
 *     `abrirEditarGrupo`).
 *   - `_renderParcialesUI(prefix, parciales, fechaInicioISO, fechaFinISO)`:
 *     1. DOM guard tbody.
 *     2. Renderea 4-col table por parcial: num + `<input type=number min=1>`
 *        semanas + inicio + fin. Input dispara `onchange="_onParcialSemanasChange(...)"`.
 *     3. Suma de semanas vs total esperado (basado en fechas):
 *        - `sumaSem = parciales.reduce(p.semanas)`.
 *        - `totalDisp = round((fin - ini) / semana)` o `sumaSem` fallback.
 *        - `ok = sumaSem === totalDisp`.
 *     4. Indicador: `"✓"` verde si ok / `"⚠ no coincide (permitido por recesos)"`
 *        amber si gap.
 *
 * Asimetrías cross-archivo:
 *   - **State dual `_nuevoGrupoState` + `_editandoGrupoState`** vs side-channel
 *     `_editando<Entity>Id` single de otros admin (15a.B/15a.C/15b.A/15b.B/15c).
 *     Grupos necesita más state porque el modal tiene UI parciales editable
 *     + toggle personalizar — no es solo "qué edito".
 *   - **Pattern parametrizado por `prefix`** (3 fn total: `_renderParcialesUI` +
 *     `_togglePersonalizarPeriodo` + `_onParcialSemanasChange`) es DRY parcial
 *     único en admin. Horarios 15c también tiene helpers shared pero sin
 *     parametrización por prefix.
 *   - **"⚠ no coincide (permitido por recesos)"**: UX educativa única —
 *     admin sabe que el gap NO es error sino tolerancia legítima (feriados,
 *     semanas de evaluaciones). Pattern de "warning informativo no-bloqueante".
 *
 * Deuda post-migración (Supabase):
 *   - **Cálculo `totalDisp` cliente-side** sin integración calendario académico:
 *     ignora días no-lectivos institucionales. Post-Supabase: integrar
 *     `dias_no_lectivos[]` por institución para calcular semanas REALES.
 *   - **Onchange inline `_onParcialSemanasChange`**: HTML attribute coupling.
 *     Post-migración TS+React: event listener delegado o controlled inputs.
 *   - **Sin validation máximo semanas**: admin puede poner 999 semanas, no se
 *     valida vs total razonable. Deuda menor: `max` attr + soft validation.
 *
 * Edge:
 *   - **`_resetNuevoGrupoState` re-asigna** (no muta in-place) — referencia nueva
 *     evita closures stale en handlers viejos.
 *   - **DOM guard ambos elementos** silent no-op si modal no montado.
 *   - **`sumEl` opcional** — si no existe, solo renderiza tabla sin indicador.
 *   - Funciones IMPURAS (DOM write + state mutation).
 */
function _resetNuevoGrupoState() {
    _nuevoGrupoState = { personalizar: false, parciales: [] };
}

// ── Render de la tabla de parciales editable ──────────────
function _renderParcialesUI(prefix, parciales, fechaInicioISO, fechaFinISO) {
    const tbody = document.getElementById(`${prefix}-grupo-parciales-tbody`);
    const sumEl = document.getElementById(`${prefix}-grupo-parciales-sum`);
    if (!tbody) return;
    tbody.innerHTML = parciales.map((p, i) => `
        <tr>
            <td style="color:var(--text-muted);font-family:var(--font-mono)">${p.num}</td>
            <td><input type="number" min="1" value="${p.semanas}" style="width:60px"
                       data-parcial-idx="${i}" data-prefix="${prefix}"
                       onchange="_onParcialSemanasChange('${prefix}', ${i}, this.value)" /></td>
            <td style="font-family:var(--font-mono);color:var(--text-secondary);font-size:11px">${p.inicio}</td>
            <td style="font-family:var(--font-mono);color:var(--text-secondary);font-size:11px">${p.fin}</td>
        </tr>
    `).join("");

    if (sumEl) {
        const sumaSem = parciales.reduce((s, p) => s + p.semanas, 0);
        const ini = _parseISODate(fechaInicioISO);
        const fin = _parseISODate(fechaFinISO);
        const totalDisp = (ini && fin && fin > ini) ? Math.round((fin - ini) / (1000*60*60*24*7)) : sumaSem;
        const ok = sumaSem === totalDisp;
        sumEl.innerHTML = `Σ semanas = ${sumaSem} / ${totalDisp} ${ok ? '<span style="color:var(--xahni-teal)">✓</span>' : '<span style="color:var(--xahni-amber)">⚠ no coincide (permitido por recesos)</span>'}`;
    }
}

// ── Handlers del modal nuevo grupo ────────────────────────
/**
 * @interaction grupos-poblar-select-carreras-modal
 * @scope admin-grupos-poblar-select-carreras-modal
 *
 * Given selectId DOM + valor actual opcional + DEMO_CARRERAS global.
 * When `abrirNuevoGrupo` / `abrirEditarGrupo` necesitan poblar select carreras
 * en modal (no en filtro de tabla).
 * Then:
 *   1. DOM guard.
 *   2. Renderea options: `"— Selecciona carrera —"` placeholder + 1 por DEMO_CARRERAS.
 *   3. Restaura `valorActual` con `String()` coerce si sigue en options.
 *
 * Asimetrías cross-archivo:
 *   - **Reutiliza pattern de filtro tabla** `_poblarFiltroCarrerasGrupo` pero
 *     con default option distinto ("— Selecciona —" vs "Todas las carreras")
 *     + `String()` coerce extra defensivo. Asimetría histórica — podría unificarse.
 *   - **Twin con `_poblarSelectInstitucionesCarrera` (15a.B carreras)**: mismo
 *     pattern lookup canonical, distinto target entity.
 *
 * Deuda post-migración (Supabase):
 *   - **Sin filtro por institución del admin**: poblar TODAS las carreras puede
 *     ser ruido. Post-Supabase: `filter c.institucionId === APP.user.institucionId`
 *     si admin tiene scope institución.
 *   - **Sin sort alfabético** (asimetría con `_poblarSelectFiltroInstitucion`
 *     materias 15b.B que sort).
 *
 * Edge:
 *   - **DOM guard** silent no-op.
 *   - **`String()` coerce** defensivo contra numérico/string mismatch.
 *   - **`[...sel.options].some(...)` validation** antes de re-asignar value.
 *   - Función IMPURA (DOM write).
 */
function _poblarSelectCarrerasGrupo(selectId, valorActual) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = `<option value="">— Selecciona carrera —</option>` +
        DEMO_CARRERAS.map(c => `<option value="${_escapeHtml(c.id)}">${_escapeHtml(c.nombre)}</option>`).join("");
    if (valorActual && [...sel.options].some(o => o.value === String(valorActual))) {
        sel.value = String(valorActual);
    }
}

/**
 * @interaction grupos-handlers-periodo-cascade-twin-nuevo-editar
 * @scope admin-grupos-handlers-cascade-periodo
 *
 * Given DOM inputs `#${prefix}-grupo-carrera` + `#${prefix}-grupo-fecha-inicio`
 * + state `_nuevoGrupoState`/`_editandoGrupoState` + helper `_derivarPeriodo`
 * + `_generarParciales` + `_renderParcialesUI`.
 * When admin cambia el `<select>` carrera o el `<input type=date>` fecha-inicio
 * en cualquiera de los 2 modales (nuevo o editar) — onchange HTML inline
 * dispara el handler correspondiente.
 * Then **6 handlers TWIN PATTERN nuevo↔editar** (3 nuevo + 3 editar):
 *
 * Modo NUEVO:
 *   - `_onNuevoGrupoCarreraChange()` → `_refrescarPeriodoNuevo()`.
 *   - `_onNuevoGrupoFechaInicioChange()` → `_refrescarPeriodoNuevo()`.
 *   - `_refrescarPeriodoNuevo()`:
 *     1. Guard `if (_nuevoGrupoState.personalizar) return` — escape hatch
 *        admin sobreescribió, no tocar.
 *     2. Lee carreraId + fechaIni de inputs.
 *     3. Si !ambos → silent return.
 *     4. `_derivarPeriodo` → set 3 inputs derivados (duracion + fechaFin + nombre).
 *     5. `_generarParciales` → 3 parciales auto.
 *     6. `_renderParcialesUI("nuevo", ...)` re-renderea tabla parciales.
 *
 * Modo EDITAR:
 *   - `_onEditarGrupoCarreraChange()` → `_refrescarPeriodoEditar()` + `_maybeWarnCambioPeriodo()`.
 *   - `_onEditarGrupoFechaInicioChange()` → `_refrescarPeriodoEditar()` + `_maybeWarnCambioPeriodo()`.
 *   - `_refrescarPeriodoEditar()`:
 *     Mismo flujo que nuevo PERO con `_editandoGrupoState` + prefix "editar".
 *
 * Asimetrías cross-archivo:
 *   - **Twin pattern EXPLÍCITO nuevo↔editar** (6 fn = 3 × 2 modos): decisión
 *     consciente del archivo NO factorizar a 1 fn parametrizada por prefix.
 *     Razón: firma event handlers HTML inline (`onchange="_onNuevoGrupoCarreraChange()"`)
 *     prefiere fn por id sin argumentos vs `onchange="_onCarreraChange('nuevo')"`
 *     que requiere coordinación cross-prefix. Trade-off: duplicación lógica vs
 *     simplicidad HTML inline.
 *   - **Solo editar invoca `_maybeWarnCambioPeriodo`**: nuevo NO necesita
 *     (no hay miembros pre-existentes a alertar). Asimetría semántica clave.
 *   - **State module-scope dual** (`_nuevoGrupoState` + `_editandoGrupoState`):
 *     pattern único admin. Otros admin usan side-channel `_editando<Entity>Id` single.
 *
 * Deuda post-migración (Supabase):
 *   - **Twin duplicación**: 6 fn casi idénticas. Post-migración TS+React:
 *     extraer a hook compartido `usePeriodoDerivado(prefix)` o componente
 *     controlado `<PeriodoEditor mode="new"|"edit" />` que internamente
 *     parametrice.
 *   - **`onchange` HTML inline coupling**: ata el archivo al `index.html` /
 *     fragmento `views/admin/grupos.html`. Post-migración: event listeners
 *     programáticos o JSX onChange.
 *   - **State global module-scope**: 2 closures share `_nuevoGrupoState` /
 *     `_editandoGrupoState` — race condition si admin abre ambos modales
 *     simultáneamente (no aplica al flujo UI actual). Post-React: useState
 *     scoped por modal.
 *
 * Edge:
 *   - **Escape hatch `personalizar`** crítico: si admin clicó "Personalizar",
 *     re-render NO sobreescribe sus overrides manuales.
 *   - **Silent return** en !carreraId || !fechaIni — admin aún no completó.
 *   - **Optional chaining `?.value`** defensivo contra DOM faltante.
 *   - Funciones IMPURAS (DOM read+write + state mutation + cascade renderer).
 *   - **Pattern único admin** — twin explícito 6 fn cascada periodo.
 */
function _onNuevoGrupoCarreraChange()       { _refrescarPeriodoNuevo(); }
function _onNuevoGrupoFechaInicioChange()   { _refrescarPeriodoNuevo(); }

function _refrescarPeriodoNuevo() {
    if (_nuevoGrupoState.personalizar) return;  // no sobrescribir si está personalizado
    const carreraId = document.getElementById("nuevo-grupo-carrera")?.value;
    const fechaIni  = document.getElementById("nuevo-grupo-fecha-inicio")?.value;
    if (!carreraId || !fechaIni) return;
    const { duracionMeses, fechaFin, nombre } = _derivarPeriodo(carreraId, fechaIni);
    document.getElementById("nuevo-grupo-duracion").value = duracionMeses;
    document.getElementById("nuevo-grupo-fecha-fin").value = fechaFin || "";
    document.getElementById("nuevo-grupo-periodo-nombre").value = nombre;
    _nuevoGrupoState.parciales = _generarParciales(fechaIni, fechaFin);
    _renderParcialesUI("nuevo", _nuevoGrupoState.parciales, fechaIni, fechaFin);
}

/**
 * @interaction grupos-toggle-personalizar-y-edicion-semanas-parametrizadas-prefix
 * @scope admin-grupos-toggle-personalizar-edit
 *
 * Given prefix `"nuevo"|"editar"` + state correspondiente + DOM inputs +
 * helpers `_generarParciales` + `_renderParcialesUI` + `_refrescarPeriodo*`.
 * When admin clica botón "⚙ Personalizar periodo" / "Restaurar derivación
 * automática" (toggle), o edita `<input type=number>` semanas de un parcial.
 * Then 2 fn combined parametrizadas por `prefix`:
 *   - `_togglePersonalizarPeriodo(prefix)`:
 *     1. Resuelve `state` por prefix (`_nuevoGrupoState` o `_editandoGrupoState`).
 *     2. Flip `state.personalizar = !state.personalizar`.
 *     3. Habilita/deshabilita los 3 inputs derivados (duracion + fechaFin +
 *        nombre) según `personalizar`.
 *     4. Update label botón: "⚙ Restaurar derivación automática" si true /
 *        "⚙ Personalizar periodo" si false.
 *     5. Si vuelve a false → invoca `_refrescarPeriodo*` apropiado (restaura
 *        derivados).
 *   - `_onParcialSemanasChange(prefix, idx, valor)`:
 *     1. Resuelve state.
 *     2. Construye `nuevasSemanas[]` array copy + override en `idx` con
 *        `Math.max(1, parseInt(valor) || 1)` defensivo.
 *     3. Re-genera parciales con override → `_generarParciales(ini, fin, nuevasSemanas)`.
 *     4. Re-renderea UI tabla parciales.
 *
 * Asimetrías cross-archivo:
 *   - **Parametrización por `prefix`** (DRY parcial — 2 fn × 2 modos = 4
 *     casos cubiertos por 2 fn): contraste con twin pattern 6 fn cascada
 *     anterior. Decisión consciente del archivo: estos 2 son menos triggers
 *     event-handler-bound (toggle es un solo botón, parcial edit es delegado
 *     a `onchange` inline en cada input → mismo handler con `prefix` como arg).
 *   - **Sin twin en otros admin** — toggle escape hatch + edición semanas
 *     son features únicas grupos.
 *
 * Deuda post-migración (Supabase):
 *   - **Mismas asimetrías que twin handlers cascada**: post-React/TS extraer a
 *     componente controlado `<PeriodoEditor mode="..." />` con state interno.
 *   - **HTML inline coupling** `onchange="_onParcialSemanasChange('${prefix}', ${i}, this.value)"`:
 *     prefix viaja como string literal en template. Post-migración: prop
 *     drilling o context.
 *   - **`onchange` se dispara on blur**, no on each keystroke — UX OK pero
 *     algo torpe. Post-React: `onChange` reactivo con debounce.
 *
 * Edge:
 *   - **`Math.max(1, parseInt(valor) || 1)`** triple defensivo: si admin
 *     escribe "abc" → parseInt NaN → fallback 1 → Math.max final 1.
 *   - **Toggle restaura derivación** solo si vuelve a `personalizar = false`
 *     (escape hatch limpio).
 *   - **Lectura de fechas en `_onParcialSemanasChange`** desde DOM (no de state)
 *     — coherente con que admin pudo haber editado fechas si está personalizando.
 *   - Funciones IMPURAS (DOM read+write + state mutation + cascade).
 *   - **Pattern único admin** — fn parametrizada por prefix con shared logic
 *     cross-modal.
 */
function _togglePersonalizarPeriodo(prefix) {
    const state = prefix === "nuevo" ? _nuevoGrupoState : _editandoGrupoState;
    state.personalizar = !state.personalizar;
    const ids = [`${prefix}-grupo-duracion`, `${prefix}-grupo-fecha-fin`, `${prefix}-grupo-periodo-nombre`];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !state.personalizar; });
    const btn = document.getElementById(`${prefix}-grupo-toggle-personalizar`);
    if (btn) btn.textContent = state.personalizar ? "⚙ Restaurar derivación automática" : "⚙ Personalizar periodo";
    if (!state.personalizar) {
        // restaurar derivados
        if (prefix === "nuevo") _refrescarPeriodoNuevo();
        else _refrescarPeriodoEditar();
    }
}

function _onParcialSemanasChange(prefix, idx, valor) {
    const state = prefix === "nuevo" ? _nuevoGrupoState : _editandoGrupoState;
    const nuevasSemanas = state.parciales.map(p => p.semanas);
    nuevasSemanas[idx] = Math.max(1, parseInt(valor) || 1);
    const fechaIni = document.getElementById(`${prefix}-grupo-fecha-inicio`)?.value;
    const fechaFin = document.getElementById(`${prefix}-grupo-fecha-fin`)?.value;
    state.parciales = _generarParciales(fechaIni, fechaFin, nuevasSemanas);
    _renderParcialesUI(prefix, state.parciales, fechaIni, fechaFin);
}

// ── Abrir modal nuevo grupo ───────────────────────────────
/**
 * @interaction grupos-abrir-modal-nuevo-bootstrap-7-resets
 * @scope admin-grupos-abrir-nuevo
 *
 * Given DOM modal `#modal-nuevo-grupo-admin` + sus inputs hijos + helpers
 * populadores.
 * When admin clica botón "+" / "Nuevo grupo".
 * Then:
 *   1. `_resetNuevoGrupoState()` limpia state module-scope.
 *   2. **7 resets de inputs identidad + periodo**: nombre="", nivel="1",
 *      estado="activo", duracion="", fecha-fin="", periodo-nombre="",
 *      fecha-inicio="".
 *   3. `_poblarSelectCarrerasGrupo("nuevo-grupo-carrera", "")` populador modal.
 *   4. Limpia tbody parciales + sum inicial.
 *   5. Reset label toggle a "⚙ Personalizar periodo" (state default false).
 *   6. `_poblarChecklistMateriasParaGrupo("nuevo-grupo-materias", [])` checklist
 *      vacío.
 *   7. `_poblarFiltroAlumnosCarrera("nuevo-grupo-alumnos-filtro-carrera", "todas")`
 *      filtro alumnos.
 *   8. `_poblarChecklistAlumnosParaGrupo("nuevo-grupo-alumnos", [], "todas")`
 *      checklist alumnos cross-carreras.
 *   9. `openModal("modal-nuevo-grupo-admin")`.
 *
 * Asimetrías cross-archivo:
 *   - **8 resets explícitos** (sin helper `setVal` closure) vs `abrirModalCrearHorario`
 *     15c que usa closure `setVal(id, v)`. Asimetría histórica — refactor menor
 *     extraer helper.
 *   - **NO pre-rellena desde filtros activos** (vs `abrirModalCrearHorario` 15c
 *     que pre-llena institución/grupo desde filtros). Razón semántica: filtros
 *     grupos son de tabla (carrera/estado), no compatibles con campos modal
 *     (que esperan también materias+alumnos por seleccionar).
 *   - **Triple cascade populadores checklists** (materias + filtroAlumnos +
 *     checklistAlumnos): pattern único admin — modal complejo con relaciones
 *     M:N triple.
 *
 * Deuda post-migración (Supabase):
 *   - **8 `document.getElementById` linealizados sin helper**: refactor menor
 *     extraer `setVal` closure cementado en horarios 15c.
 *   - **Defaults gamificados implícitos**: el modal NO expone emblema/marco/
 *     color (vienen hardcoded en `crearGrupo`). Deuda futura UI: agregar
 *     selector visual emblema/marco/color en modal o flujo gamificación post-creación.
 *   - **Modal grande con 9+ inputs**: UX bottleneck. Post-React: split en wizard
 *     multi-step (identidad → periodo → asignaciones).
 *
 * Edge:
 *   - **Sin DOM guards individuales** (asume index.html/views/admin/grupos.html
 *     siempre montado correctamente).
 *   - **Default nivel="1"** asume cohorte arranque (1° cuatrimestre).
 *   - **Default estado="activo"** coherente con `_gruposFiltro.estado="activos"`.
 *   - Función IMPURA (DOM cascade + state reset + cascade populadores).
 *   - Twin con `abrirEditarGrupo` (ya documentada legacy) — pero edit reconstruye
 *     state desde grupo existente, nuevo arranca limpio.
 */
function abrirNuevoGrupo() {
    _resetNuevoGrupoState();
    document.getElementById("nuevo-grupo-nombre").value = "";
    document.getElementById("nuevo-grupo-nivel").value = "1";
    document.getElementById("nuevo-grupo-estado").value = "activo";
    document.getElementById("nuevo-grupo-duracion").value = "";
    document.getElementById("nuevo-grupo-fecha-fin").value = "";
    document.getElementById("nuevo-grupo-periodo-nombre").value = "";
    document.getElementById("nuevo-grupo-fecha-inicio").value = "";
    _poblarSelectCarrerasGrupo("nuevo-grupo-carrera", "");
    document.getElementById("nuevo-grupo-parciales-tbody").innerHTML = "";
    document.getElementById("nuevo-grupo-parciales-sum").innerHTML = "";
    const tgl = document.getElementById("nuevo-grupo-toggle-personalizar");
    if (tgl) tgl.textContent = "⚙ Personalizar periodo";
    _poblarChecklistMateriasParaGrupo("nuevo-grupo-materias", []);
    _poblarFiltroAlumnosCarrera("nuevo-grupo-alumnos-filtro-carrera", "todas");
    _poblarChecklistAlumnosParaGrupo("nuevo-grupo-alumnos", [], "todas");
    openModal("modal-nuevo-grupo-admin");
}

// ── Crear grupo ───────────────────────────────────────────
/**
 * @interaction admin.grupos.crear
 * @scope admin
 *
 * Given: admin autenticado en gestion-grupos con modal-nuevo-grupo-admin abierto
 * When:  admin completa identidad + periodo + asignaciones y click "Crear grupo"
 * Then:  - valida nombre único y obligatorios (nombre, carrera, fecha inicio)
 *        - persiste vía DataService.saveGrupo con periodo derivado/personalizado
 *        - sincroniza DEMO_MATERIAS (materia.grupos[]) y DEMO_USERS (usuario.grupoId)
 *        - modal cierra; tabla repinta; toast success
 * Edge:  - nombre duplicado → toast error, modal abierto
 *        - sin carrera/fecha → toast error
 *        - saveGrupo throw → toast error, modal abierto (datos preservados)
 */
async function crearGrupo() {
    const nombre = document.getElementById("nuevo-grupo-nombre")?.value.trim();
    const carreraId = document.getElementById("nuevo-grupo-carrera")?.value;
    const estado = document.getElementById("nuevo-grupo-estado")?.value || "activo";
    const nivel = parseInt(document.getElementById("nuevo-grupo-nivel")?.value) || 1;
    const fechaInicio = document.getElementById("nuevo-grupo-fecha-inicio")?.value;
    const duracionMeses = parseInt(document.getElementById("nuevo-grupo-duracion")?.value) || 4;
    const fechaFin = document.getElementById("nuevo-grupo-fecha-fin")?.value;
    const periodoNombre = document.getElementById("nuevo-grupo-periodo-nombre")?.value;

    if (!nombre || !carreraId || !fechaInicio) {
        showToast("Faltan campos obligatorios: nombre, carrera, fecha de inicio.", "error");
        return;
    }
    if (DEMO_GRUPOS.some(g => (g.nombre || "").toLowerCase() === nombre.toLowerCase())) {
        showToast("Ya existe un grupo con ese nombre.", "error");
        return;
    }

    const materiasIds = [...document.querySelectorAll("#nuevo-grupo-materias input[type=checkbox]:checked")].map(cb => cb.value);
    const alumnosIds  = [...document.querySelectorAll("#nuevo-grupo-alumnos input[type=checkbox]:checked")].map(cb => cb.value);
    const id = nextGrupoId(nombre);
    const payload = {
        id, nombre, nivel, puntos: 0,
        carreraId,
        materias: materiasIds, miembros: alumnosIds, logros: [],
        color: '#00d4ff', emblema: '🛡️', marco: 'bronze',
        estado,
        periodo: {
            id: `${new Date(fechaInicio).getFullYear()}-${String(new Date(fechaInicio).getMonth()+1).padStart(2,'0')}`,
            nombre: periodoNombre,
            duracionMeses,
            inicio: fechaInicio,
            fin: fechaFin,
            parciales: _nuevoGrupoState.parciales.slice(),
        },
    };

    try {
        await DataService.saveGrupo(payload);
    } catch (err) {
        showToast(err?.message || `Error: ${err}`, "error");
        return;
    }

    _syncMateriasGrupoAdmin(id, materiasIds);
    _syncAlumnosGrupoAdmin(id, alumnosIds);
    closeModal("modal-nuevo-grupo-admin");
    _renderTablaGruposAdmin();
    _actualizarContadorTablaGrupos();
    buildGruposResumen();
    showToast(`Grupo ${nombre} creado correctamente`, "success");
}

// ═══════════════════════════════════════════════════════════
// P5: asignación materias + alumnos + sync bidireccional
// ═══════════════════════════════════════════════════════════

/**
 * @interaction grupos-populadores-checklists-materias-alumnos-counter
 * @scope admin-grupos-populadores-checklists
 *
 * Given containerId DOM + actuales array IDs preseleccionados +
 * (alumnos only: filtroCarrera string) + DEMO_MATERIAS/DEMO_USERS/DEMO_CARRERAS
 * globales.
 * When `abrirNuevoGrupo` (vacíos), `abrirEditarGrupo` (con `g.materias`/`g.miembros`
 * preseleccionados), o `_onFiltroAlumnosCarreraChange` (re-pobla con filtro
 * actualizado).
 * Then 4 fn combined cross-modal:
 *   - `_poblarChecklistMateriasParaGrupo(containerId, actuales)`:
 *     1. DOM guard.
 *     2. `Set` de actuales con `String()` coerce.
 *     3. Renderea checkboxes verticales — cada label `<input type=checkbox>`
 *        + nombre materia. `onchange` inline invoca `_updateCount` per change.
 *     4. Inicializa counter `(N)` con `_updateCount`.
 *   - `_poblarChecklistAlumnosParaGrupo(containerId, actuales, filtroCarrera)`:
 *     1. Filter DEMO_USERS por `u.tipo === "estudiante"`.
 *     2. **Filtro complejo**: si filtroCarrera y !== "todas" → filter por
 *        `u.carreraId === filtroCarrera` PERO siempre incluye preseleccionados
 *        (Set heredada con OR `set.has(u.id)`). UX: si admin filtra carrera
 *        X pero ya tenía alumnos de carrera Y preseleccionados, NO desaparecen.
 *     3. Renderea labels + checkboxes. **Badge "otra carrera"** visual si
 *        alumno NO matchea filtro actual (pre-seleccionado de carrera distinta).
 *     4. Inicializa counter `(N)`.
 *   - `_updateCount(containerId, countId)`:
 *     1. DOM guards (silent no-op si missing).
 *     2. `querySelectorAll("input[type=checkbox]:checked").length` → escribe
 *        `(${n})` en output element.
 *   - `_poblarFiltroAlumnosCarrera(selectId, valorActual)`:
 *     1. DOM guard.
 *     2. Renderea options: `"Filtrar por carrera: todas"` + 1 por DEMO_CARRERAS.
 *     3. Preserva valorActual.
 *
 * Asimetrías cross-archivo:
 *   - **Filtro alumnos + badge "otra carrera"** UX único: pattern "filter pero
 *     conservar preseleccionados" con marca visual de desviación. NO existe
 *     en materias 15b.B `_poblarChecklistGruposMateria` que es lista pura.
 *   - **Counter inline `_updateCount`** wired via `onchange` HTML inline en
 *     cada checkbox: pattern único admin grupos. Otros checklists no muestran
 *     contador running.
 *   - **`_poblarFiltroAlumnosCarrera` con prefix `"Filtrar por carrera: "`
 *     hardcoded en option default** vs filtros tabla que solo dicen "Todas".
 *     UX cue pedagógico para distinguir filtro modal del de tabla.
 *
 * Deuda post-migración (Supabase):
 *   - **N×M lookups cliente-side** en alumnos cuando se filtran por carrera.
 *     Post-Supabase: server-side query con índice por `tipo + carreraId`.
 *   - **Sin paginación**: si N alumnos > 500, modal se vuelve unusable.
 *     Deuda alta: agregar paginación o virtualization (React Virtual).
 *   - **`onchange="_updateCount(...)"` HTML inline**: coupling. Post-React:
 *     controlled component con state local + count derivado.
 *   - **`badge` con estilos inline** (`background:var(--surface-2);color:var(--text-muted)`):
 *     debería ser `.x-chip x-chip--muted` canonical. Deuda menor.
 *   - **Badge "otra carrera" sin tooltip explicativo**: admin podría no entender
 *     por qué aparece. Deuda menor UX: agregar `title="Este alumno es de otra
 *     carrera pero ya está en el grupo"`.
 *
 * Edge:
 *   - **DOM guards** silent no-op.
 *   - **`Set([...actuales].map(String))` coerce** defensivo numérico/string.
 *   - **`onchange` inline interpolation segura** porque containerId es string
 *     literal sin caracteres especiales.
 *   - **`!matchesFilter` cond** distingue preseleccionados-fuera-de-filtro de
 *     los matches puros.
 *   - Funciones IMPURAS (DOM write + read globals).
 *   - **Pattern único admin** — checklist con filtro inclusive + badge + counter.
 */
function _poblarChecklistMateriasParaGrupo(containerId, actuales) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const set = new Set((actuales || []).map(String));
    el.innerHTML = (DEMO_MATERIAS || []).map(m => {
        const checked = set.has(String(m.id)) ? " checked" : "";
        const onchange = `onchange="_updateCount('${containerId}', '${containerId}-count')"`;
        return `<label style="display:flex;align-items:center;gap:8px;padding:4px;cursor:pointer">`
             + `<input type="checkbox" value="${_escapeHtml(m.id)}"${checked} ${onchange}/>`
             + `<span>${_escapeHtml(m.nombre) || _escapeHtml(m.id)}</span>`
             + `</label>`;
    }).join("");
    _updateCount(containerId, `${containerId}-count`);
}

function _poblarChecklistAlumnosParaGrupo(containerId, actuales, filtroCarrera) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const set = new Set((actuales || []).map(String));
    const todos = (DEMO_USERS || []).filter(u => u.tipo === "estudiante");
    const filtrados = filtroCarrera && filtroCarrera !== "todas"
        ? todos.filter(u => String(u.carreraId) === String(filtroCarrera) || set.has(String(u.id)))
        : todos;
    el.innerHTML = filtrados.map(u => {
        const checked = set.has(String(u.id)) ? " checked" : "";
        const matchesFilter = !filtroCarrera || filtroCarrera === "todas" || String(u.carreraId) === String(filtroCarrera);
        const badge = !matchesFilter
            ? `<span class="badge" style="background:var(--surface-2);color:var(--text-muted);font-size:9px;margin-left:4px">otra carrera</span>`
            : "";
        const onchange = `onchange="_updateCount('${containerId}', '${containerId}-count')"`;
        return `<label style="display:flex;align-items:center;gap:8px;padding:4px;cursor:pointer">`
             + `<input type="checkbox" value="${_escapeHtml(u.id)}"${checked} ${onchange}/>`
             + `<span>${_escapeHtml(u.nombre)} <span style="color:var(--text-muted);font-size:11px">(${_escapeHtml(u.id)})</span>${badge}</span>`
             + `</label>`;
    }).join("");
    _updateCount(containerId, `${containerId}-count`);
}

function _updateCount(containerId, countId) {
    const cont = document.getElementById(containerId);
    const out = document.getElementById(countId);
    if (!cont || !out) return;
    const n = cont.querySelectorAll("input[type=checkbox]:checked").length;
    out.textContent = `(${n})`;
}

function _poblarFiltroAlumnosCarrera(selectId, valorActual) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = `<option value="todas">Filtrar por carrera: todas</option>` +
        DEMO_CARRERAS.map(c => `<option value="${_escapeHtml(c.id)}">${_escapeHtml(c.nombre)}</option>`).join("");
    if (valorActual && [...sel.options].some(o => o.value === valorActual)) sel.value = valorActual;
}

/**
 * @interaction grupos-handler-filtro-alumnos-carrera-preserve-marcados
 * @scope admin-grupos-handler-filtro-alumnos
 *
 * Given prefix `"nuevo"|"editar"` + DOM `#${prefix}-grupo-alumnos-filtro-carrera`
 * + checkboxes actuales.
 * When admin cambia el `<select>` de filtro carrera dentro del modal.
 * Then:
 *   1. Lee filtro actual del select.
 *   2. Captura IDs de alumnos ACTUALMENTE marcados (los preserva como
 *      "selección viva").
 *   3. Re-invoca `_poblarChecklistAlumnosParaGrupo` con los marcados como
 *      preseleccionados — los que sean de otra carrera mostrarán badge
 *      "otra carrera" pero NO desaparecerán.
 *
 * Asimetrías cross-archivo:
 *   - **Pattern preservación selección cross-render** parametrizado por prefix:
 *     único en grupos. Otros admin filters destruyen selección al cambiar
 *     filtro (porque no tienen multi-select intra-modal).
 *   - **`querySelectorAll(":checked")` lectura DOM** (no state) — coherente con
 *     que el estado vive en el DOM, no en module-scope `_${modo}GrupoState`.
 *     Asimetría intencional con periodo+parciales que SÍ viven en state
 *     (porque tienen lógica de re-derivación cascade).
 *
 * Deuda post-migración (Supabase):
 *   - **Lectura DOM con querySelectorAll**: post-React migra a controlled
 *     component con `useState<Set<string>>` para los marcados.
 *   - **Sin debounce**: cambiar filtro carrera dispara re-render full checklist
 *     inmediato. OK por scale; post-Supabase con N>500 alumnos considerar
 *     debounce o virtualization.
 *
 * Edge:
 *   - **Optional chaining `?.value`** defensivo DOM.
 *   - **Prefix viaja como string** desde HTML inline `onchange="_onFiltroAlumnosCarreraChange('nuevo')"`.
 *   - Función IMPURA (DOM read + cascade populador).
 */
function _onFiltroAlumnosCarreraChange(prefix) {
    const filtro = document.getElementById(`${prefix}-grupo-alumnos-filtro-carrera`)?.value;
    const actualesMarcados = [...document.querySelectorAll(`#${prefix}-grupo-alumnos input[type=checkbox]:checked`)].map(cb => cb.value);
    _poblarChecklistAlumnosParaGrupo(`${prefix}-grupo-alumnos`, actualesMarcados, filtro);
}

// ── Sync bidireccional in-memory ──────────────────────────
/**
 * @interaction grupos-sync-bidireccional-dual-MN-1N
 * @scope admin-grupos-sync-bidireccional
 *
 * Given grupoId + arrays IDs nuevos (materias/alumnos) + DEMO_MATERIAS/DEMO_USERS
 * globales mutables.
 * When `crearGrupo` / `guardarEdicionGrupo` post-saveGrupo invocan AMBOS para
 * propagar refs; o `eliminarGrupo` invoca con `[]` para cleanup PRE-delete.
 * Then 2 syncs combined DUAL (M:N + 1:N):
 *   - `_syncMateriasGrupoAdmin(grupoId, nuevasMateriasIds)` (**M:N**):
 *     1. Guard `typeof DEMO_MATERIAS === "undefined"`.
 *     2. `Set` de nuevas con `String()` coerce.
 *     3. Foreach DEMO_MATERIAS:
 *        - Auto-heal `if (!Array.isArray(m.grupos)) m.grupos = []`.
 *        - `tiene = m.grupos.map(String).includes(String(grupoId))`.
 *        - `debe = nuevas.has(String(m.id))`.
 *        - Si debe Y !tiene → push grupoId.
 *        - Si !debe Y tiene → filter out.
 *     4. Idempotente sin acción si ya en estado correcto.
 *   - `_syncAlumnosGrupoAdmin(grupoId, nuevosAlumnosIds)` (**1:N**):
 *     1. Guard `typeof DEMO_USERS === "undefined"`.
 *     2. `Set` de nuevos con `String()` coerce.
 *     3. Foreach DEMO_USERS:
 *        - Skip si `u.tipo !== "estudiante"`.
 *        - `era = String(u.grupoId) === String(grupoId)` (estaba en este grupo).
 *        - `ahora = nuevos.has(String(u.id))` (debe estar ahora).
 *        - Si ahora → `u.grupoId = grupoId` (SOBREESCRIBE si tenía otro).
 *        - Si !ahora Y era → `u.grupoId = null` (lo removemos).
 *
 * Asimetrías cross-archivo:
 *   - **DUAL sync M:N + 1:N**: pattern único admin. Materias 15b.B tiene solo
 *     M:N (`_syncGruposMateriasAdmin` — materia.grupos[] ↔ grupo.materias[]).
 *     Horarios 15c no tiene sync bidireccional (slot embebido en materia, no
 *     entidad propia).
 *   - **M:N inverso a `_syncGruposMateriasAdmin` 15b.B**: aquí sync DESDE
 *     grupo (`grupoId` fijo, varias materias); 15b.B sync DESDE materia
 *     (`materiaId` fijo, varios grupos). MISMA semántica de array bidireccional
 *     `materia.grupos[]`, distinto punto de entrada.
 *   - **1:N usuario.grupoId SOBREESCRIBE silenciosamente**: si alumno estaba
 *     en grupo X y admin lo asigna a grupo Y, `u.grupoId = "Y"` sin warning.
 *     Asume regla negocio "alumno solo en 1 grupo a la vez". Sin verificación
 *     pre-sobreescritura. **DEUDA potencial UX**: si admin asigna por error
 *     un alumno ya en otro grupo, no recibe alerta.
 *
 * Deuda post-migración (Supabase):
 *   - **Mutación in-memory DEMO_***: post-Supabase necesita `writeBatch` o
 *     transaction server-side para garantizar atomicidad. Si delete server falla
 *     después del sync local → estado inconsistente.
 *   - **Sin signal a otros módulos**: no `_actualizarMetricasMaterias` post-sync.
 *     Si admin tiene tab Materias abierto en otra ventana, conteo materia.grupos
 *     queda stale hasta re-entrar. Post-Supabase: realtime subscriptions.
 *   - **`auto-heal m.grupos = []`**: defensivo contra seeds corruptos. Post-migración
 *     migration script garantiza shape correcto + remover auto-heal.
 *   - **Sobreescritura silenciosa `u.grupoId`**: agregar warning si reasignación
 *     cross-grupo + log audit trail (quién movió a quién cuándo).
 *   - **`typeof === "undefined"` guards** legacy Phase C/E rollout. Post-migración
 *     TS los hace innecesarios (compilador garantiza imports).
 *
 * Edge:
 *   - **Idempotente AMBAS funciones**: re-invocaciones con mismos args = no-op.
 *   - **`String()` coerce** en TODAS las comparaciones — defensivo cross-types.
 *   - **`era` con default `u.grupoId || ""`** defensivo si null/undefined.
 *   - Funciones IMPURAS (mutate globals).
 *   - **Pattern único admin** — sync DUAL M:N + 1:N por entidad principal.
 */
function _syncMateriasGrupoAdmin(grupoId, nuevasMateriasIds) {
    if (typeof DEMO_MATERIAS === "undefined") return;
    const nuevas = new Set((nuevasMateriasIds || []).map(String));
    DEMO_MATERIAS.forEach(m => {
        if (!Array.isArray(m.grupos)) m.grupos = [];
        const tiene = m.grupos.map(String).includes(String(grupoId));
        const debe  = nuevas.has(String(m.id));
        if (debe && !tiene) m.grupos.push(grupoId);
        else if (!debe && tiene) m.grupos = m.grupos.filter(gid => String(gid) !== String(grupoId));
    });
}

function _syncAlumnosGrupoAdmin(grupoId, nuevosAlumnosIds) {
    if (typeof DEMO_USERS === "undefined") return;
    const nuevos = new Set((nuevosAlumnosIds || []).map(String));
    DEMO_USERS.forEach(u => {
        if (u.tipo !== "estudiante") return;
        const era    = String(u.grupoId || "") === String(grupoId);
        const ahora  = nuevos.has(String(u.id));
        if (ahora) u.grupoId = grupoId;
        else if (era) u.grupoId = null;
    });
}

// ═══════════════════════════════════════════════════════════
// P6: editar + cohort-locked + archivar + eliminar
// ═══════════════════════════════════════════════════════════

let _editandoGrupoId = null;
let _editandoGrupoSnapshot = { alumnos: [], carreraId: null, fechaInicio: null };
let _editandoGrupoState = { personalizar: false, parciales: [] };

/**
 * @interaction grupos-warning-cambio-periodo-con-miembros-no-bloqueante
 * @scope admin-grupos-warning-periodo
 *
 * Given DEMO_GRUPOS + `_editandoGrupoId` module-scope + `_editandoGrupoSnapshot`
 * con `{alumnos, carreraId, fechaInicio}` capturado en `abrirEditarGrupo` +
 * DOM `#editar-grupo-carrera` + `#editar-grupo-fecha-inicio`.
 * When admin cambia carrera o fecha-inicio dentro del modal editar —
 * `_onEditarGrupoCarreraChange` / `_onEditarGrupoFechaInicioChange` lo
 * invocan tras `_refrescarPeriodoEditar`.
 * Then:
 *   1. Find grupo actual por `_editandoGrupoId`.
 *   2. **Guard temprano**: si !grupo o sin miembros → silent return (no hay
 *      nadie a quien alertar).
 *   3. Lee carrera + fecha actuales del DOM.
 *   4. **Diff vs snapshot pre-edit**: si carreraId cambió O fechaInicio cambió
 *      → `showToast("Cambio de carrera o periodo afectará alumnos ya inscritos", "warn")`.
 *      NO BLOQUEA — solo educa al admin.
 *
 * Asimetrías cross-archivo:
 *   - **Warning informativo no-bloqueante** vs `confirmarCanonico` bloqueante en
 *     `guardarEdicionGrupo` cuando hay alumnos removidos (cohort-locked) o en
 *     `eliminarGrupo` (delete destructivo). Pattern triple-tier: warn (no
 *     bloquea) → confirmarCanonico (bloquea + reversible) → confirmarCanonico
 *     danger (bloquea + irreversible).
 *   - **Reuso `_editandoGrupoSnapshot.alumnos`** captado para otra cosa
 *     (diff de remoción) — útil cross-check. Pattern único admin: snapshot
 *     pre-edit con uso múltiple.
 *   - **Sin equivalente en `crearGrupo`** porque grupo nuevo no tiene miembros
 *     pre-existentes — coherente.
 *
 * Deuda post-migración (Supabase):
 *   - **Warning solo en change handlers, no en submit**: si admin cambia
 *     carrera+fecha múltiples veces antes de submit, recibe múltiples warns.
 *     Deuda menor: agregar también validation pre-submit como recordatorio
 *     final (sin duplicar info).
 *   - **Sin estimación de IMPACTO REAL**: warn solo dice "afectará" sin
 *     cuantificar (cuántos alumnos, qué se rompe). Post-Supabase: integrar
 *     análisis pre-cambio (¿cuántas calificaciones se invalidarán?, ¿afecta
 *     parciales ya cerrados?).
 *   - **Cohort-locked check incompleto**: cambiar carrera + grupo tiene
 *     calificaciones registradas → debería bloquear (no solo advertir).
 *     Deuda alta: integrar con módulo calificaciones (post-feature Examenes)
 *     para FK guard real.
 *   - **`showToast warn`** asume Toast API soporta tipo "warn" — si no, fallback
 *     a "info" silent. Verificar `js/core/ui.js` showToast types.
 *
 * Edge:
 *   - **Find por `_editandoGrupoId`** con `String()` coerce defensivo.
 *   - **Comparación `!==` strict** carreraId/fechaInicio vs snapshot (sin coerce
 *     porque snapshot capturó valores raw).
 *   - **Silent return temprano** evita warning espurio en grupos vacíos.
 *   - Función IMPURA (DOM read + toast side effect + module state read).
 *   - **Pattern único admin** — warning educativo con diff vs snapshot pre-edit.
 */
function _onEditarGrupoCarreraChange()      { _refrescarPeriodoEditar(); _maybeWarnCambioPeriodo(); }
function _onEditarGrupoFechaInicioChange()  { _refrescarPeriodoEditar(); _maybeWarnCambioPeriodo(); }

function _maybeWarnCambioPeriodo() {
    const g = DEMO_GRUPOS.find(x => String(x.id) === String(_editandoGrupoId));
    if (!g || (g.miembros?.length || 0) === 0) return;
    const carreraId = document.getElementById("editar-grupo-carrera")?.value;
    const fechaIni  = document.getElementById("editar-grupo-fecha-inicio")?.value;
    if (carreraId !== _editandoGrupoSnapshot.carreraId || fechaIni !== _editandoGrupoSnapshot.fechaInicio) {
        showToast("Cambio de carrera o periodo afectará alumnos ya inscritos", "warn");
    }
}

function _refrescarPeriodoEditar() {
    if (_editandoGrupoState.personalizar) return;
    const carreraId = document.getElementById("editar-grupo-carrera")?.value;
    const fechaIni  = document.getElementById("editar-grupo-fecha-inicio")?.value;
    if (!carreraId || !fechaIni) return;
    const { duracionMeses, fechaFin, nombre } = _derivarPeriodo(carreraId, fechaIni);
    document.getElementById("editar-grupo-duracion").value = duracionMeses;
    document.getElementById("editar-grupo-fecha-fin").value = fechaFin || "";
    document.getElementById("editar-grupo-periodo-nombre").value = nombre;
    _editandoGrupoState.parciales = _generarParciales(fechaIni, fechaFin);
    _renderParcialesUI("editar", _editandoGrupoState.parciales, fechaIni, fechaFin);
}

// ── Abrir modal editar ────────────────────────────────────
/**
 * @interaction admin.grupos.abrir-editar
 * @scope admin
 *
 * Given: admin click "Editar" en row de grupo
 * When:  invocación con grupo.id
 * Then:  - busca grupo en DEMO_GRUPOS (si no existe, return silencioso)
 *        - precarga 4 inputs identidad + 4 inputs periodo (disabled)
 *        - pre-marca checkboxes materias y alumnos
 *        - snapshot alumnos/carreraId/fechaInicio para diff en save
 *        - abre modal-editar-grupo-admin
 * Edge:  - id inexistente → noop
 */
function abrirEditarGrupo(id) {
    const g = DEMO_GRUPOS.find(x => String(x.id) === String(id));
    if (!g) return;
    _editandoGrupoId = g.id;
    _editandoGrupoState = { personalizar: false, parciales: (g.periodo?.parciales || []).slice() };
    _editandoGrupoSnapshot = {
        alumnos: (g.miembros || []).slice(),
        carreraId: g.carreraId,
        fechaInicio: g.periodo?.inicio || null,
    };

    document.getElementById("editar-grupo-nombre").value = g.nombre || "";
    document.getElementById("editar-grupo-estado").value = g.estado || "activo";
    document.getElementById("editar-grupo-nivel").value = g.nivel || 1;
    document.getElementById("editar-grupo-fecha-inicio").value = g.periodo?.inicio || "";
    document.getElementById("editar-grupo-duracion").value = g.periodo?.duracionMeses ?? 4;
    document.getElementById("editar-grupo-fecha-fin").value = g.periodo?.fin || "";
    document.getElementById("editar-grupo-periodo-nombre").value = g.periodo?.nombre || "";

    _poblarSelectCarrerasGrupo("editar-grupo-carrera", g.carreraId || "");
    const tgl = document.getElementById("editar-grupo-toggle-personalizar");
    if (tgl) tgl.textContent = "⚙ Personalizar periodo";
    _renderParcialesUI("editar", _editandoGrupoState.parciales, g.periodo?.inicio, g.periodo?.fin);
    _poblarChecklistMateriasParaGrupo("editar-grupo-materias", g.materias || []);
    _poblarFiltroAlumnosCarrera("editar-grupo-alumnos-filtro-carrera", "todas");
    _poblarChecklistAlumnosParaGrupo("editar-grupo-alumnos", g.miembros || [], "todas");

    openModal("modal-editar-grupo-admin");
}

// ── Guardar edición ───────────────────────────────────────
/**
 * @interaction admin.grupos.guardar-edicion
 * @scope admin
 *
 * Given: admin editó campos del modal y click "Guardar cambios"
 * When:  invocación
 * Then:  - valida nombre único (excluyendo el grupo en edición) y obligatorios
 *        - calcula diff alumnos vs snapshot
 *        - si hay alumnos removidos → confirmarCanonico listando nombres
 *        - persiste vía DataService.saveGrupo con payload completo
 *        - sincroniza DEMO_MATERIAS y DEMO_USERS
 *        - modal cierra; tabla repinta; toast success
 * Edge:  - cancela confirmación de remoción → modal permanece abierto
 *        - cambio de carreraId/fechaInicio con miembros existentes →
 *          warning toast no bloqueante
 *        - saveGrupo throw → toast error, modal abierto
 */
async function guardarEdicionGrupo() {
    const g = DEMO_GRUPOS.find(x => String(x.id) === String(_editandoGrupoId));
    if (!g) return;

    const nombre = document.getElementById("editar-grupo-nombre")?.value.trim();
    const carreraId = document.getElementById("editar-grupo-carrera")?.value;
    const estado = document.getElementById("editar-grupo-estado")?.value || "activo";
    const nivel = parseInt(document.getElementById("editar-grupo-nivel")?.value) || 1;
    const fechaInicio = document.getElementById("editar-grupo-fecha-inicio")?.value;
    const duracionMeses = parseInt(document.getElementById("editar-grupo-duracion")?.value) || 4;
    const fechaFin = document.getElementById("editar-grupo-fecha-fin")?.value;
    const periodoNombre = document.getElementById("editar-grupo-periodo-nombre")?.value;
    const materiasIds = [...document.querySelectorAll("#editar-grupo-materias input[type=checkbox]:checked")].map(cb => cb.value);
    const alumnosIds  = [...document.querySelectorAll("#editar-grupo-alumnos input[type=checkbox]:checked")].map(cb => cb.value);

    if (!nombre || !carreraId || !fechaInicio) {
        showToast("Faltan campos obligatorios: nombre, carrera, fecha de inicio.", "error");
        return;
    }
    if (DEMO_GRUPOS.some(x => (x.nombre || "").toLowerCase() === nombre.toLowerCase() && String(x.id) !== String(g.id))) {
        showToast("Ya existe otro grupo con ese nombre.", "error");
        return;
    }

    // Diff alumnos: ¿hay removidos?
    const seleccionados = new Set(alumnosIds.map(String));
    const removidos = _editandoGrupoSnapshot.alumnos.filter(uid => !seleccionados.has(String(uid)));
    if (removidos.length > 0) {
        const nombres = removidos.map(uid => {
            const u = DEMO_USERS.find(x => String(x.id) === String(uid));
            return u ? u.nombre : uid;
        }).join(", ");
        const ok = await confirmarCanonico({
            titulo: "Remover alumnos del grupo",
            mensaje: `Vas a remover ${removidos.length} alumno(s) de <strong>${_escapeHtml(g.nombre)}</strong>: ${_escapeHtml(nombres)}. Esto causa baja administrativa.`,
            accionTexto: "Remover y guardar",
            tipo: "danger",
            icono: "⚠️",
        });
        if (!ok) return;
    }

    const payload = {
        ...g,
        nombre, nivel, carreraId, estado,
        materias: materiasIds, miembros: alumnosIds,
        periodo: {
            ...(g.periodo || {}),
            id: `${new Date(fechaInicio).getFullYear()}-${String(new Date(fechaInicio).getMonth()+1).padStart(2,'0')}`,
            nombre: periodoNombre,
            duracionMeses, inicio: fechaInicio, fin: fechaFin,
            parciales: _editandoGrupoState.parciales.slice(),
        },
    };

    try {
        await DataService.saveGrupo(payload);
    } catch (err) {
        showToast(err?.message || `Error: ${err}`, "error");
        return;
    }

    _syncMateriasGrupoAdmin(g.id, materiasIds);
    _syncAlumnosGrupoAdmin(g.id, alumnosIds);

    closeModal("modal-editar-grupo-admin");
    _renderTablaGruposAdmin();
    _actualizarContadorTablaGrupos();
    buildGruposResumen();
    showToast(`Grupo ${nombre} actualizado correctamente`, "success");
}

// ── Archivar (soft) / Reactivar ───────────────────────────
/**
 * @interaction admin.grupos.archivar
 * @scope admin
 *
 * Given: admin click "Archivar"/"Reactivar" en row de grupo
 * When:  invocación con grupo.id
 * Then:  - toggle estado entre 'activo' y 'archivado' (sin confirmación
 *          — reversible)
 *        - persiste vía DataService.saveGrupo (solo cambia estado)
 *        - tabla repinta; toast info
 *        - filtro estado por default oculta archivados
 * Edge:  - id inexistente → noop
 */
async function archivarGrupo(id) {
    const g = DEMO_GRUPOS.find(x => String(x.id) === String(id));
    if (!g) return;
    const nuevoEstado = g.estado === "archivado" ? "activo" : "archivado";
    try {
        await DataService.saveGrupo({ ...g, estado: nuevoEstado });
    } catch (err) {
        showToast(err?.message || `Error: ${err}`, "error");
        return;
    }
    _renderTablaGruposAdmin();
    _actualizarContadorTablaGrupos();
    buildGruposResumen();
    showToast(`Grupo ${g.nombre} ${nuevoEstado === "archivado" ? "archivado" : "reactivado"}.`, "info");
}

// ── Eliminar (hard, con cleanup bidireccional) ────────────
/**
 * @interaction admin.grupos.eliminar
 * @scope admin
 *
 * Given: admin click "Eliminar" en row de grupo
 * When:  invocación con grupo.id
 * Then:  - confirmarCanonico citando # materias y # alumnos a limpiar
 *        - cleanup bidireccional ANTES del delete (sync con [])
 *        - DataService.deleteGrupo
 *        - tabla repinta; toast info
 * Edge:  - cancela confirmación → noop
 *        - deleteGrupo throw → toast error (cleanup ya aplicado;
 *          inconsistencia transitoria documentada como deuda Firestore)
 */
async function eliminarGrupo(id) {
    const g = DEMO_GRUPOS.find(x => String(x.id) === String(id));
    if (!g) return;
    const nombre = g.nombre;
    const ok = await confirmarCanonico({
        titulo: "Eliminar grupo",
        mensaje: `¿Eliminar el grupo <strong>${_escapeHtml(nombre)}</strong>? Esto destruye el registro y limpia ${g.materias?.length || 0} materia(s) y ${g.miembros?.length || 0} alumno(s) asociados. Esta acción no se puede deshacer.`,
        accionTexto: "Eliminar",
        tipo: "danger",
    });
    if (!ok) return;

    // Cleanup bidireccional ANTES del delete (si delete falla, no quedan
    // referencias huérfanas — el grupo aún existe en DEMO_GRUPOS).
    _syncMateriasGrupoAdmin(g.id, []);
    _syncAlumnosGrupoAdmin(g.id, []);

    try {
        await DataService.deleteGrupo(g.id);
    } catch (err) {
        showToast(`Error inesperado: ${err?.message || err}`, "error");
        return;
    }

    _renderTablaGruposAdmin();
    _actualizarContadorTablaGrupos();
    buildGruposResumen();
    showToast(`Grupo ${nombre} eliminado del sistema.`, "info");
}
