// ═══════════════════════════════════════════════════════════
// BUILDERS — Administrador: Gestión de Clasificaciones
// Lectura desde DEMO_CLASIFICACIONES (poblado por DataService
// desde data/demo/clasificaciones.json en demo, Firestore en
// prod). Mutaciones via DataService.saveClasificacion /
// deleteClasificacion (Bloqueante 4.D, 2026-05-16).
//
// Schema canónico: {id, nombre, tipo, carreraIds[]}
//   tipo ∈ {"troncoComun", "especialidad"}
//   regla 1: especialidad ⟹ carreraIds.length === 1
//   regla 2: troncoComun  ⟹ carreraIds.length >= 1
//   regla 7: no borrar si materias la referencian
//
// El conteo de materias se deriva en runtime de DEMO_MATERIAS.
// ═══════════════════════════════════════════════════════════

// ── Helpers locales ──────────────────────────────────────
/**
 * @interaction clasificaciones-helpers-conteo-slug-nextid
 * @scope admin-clasificaciones-helpers
 *
 * Given DEMO_CLASIFICACIONES + DEMO_MATERIAS arrays globales / input string (nombre).
 * When `buildClasificacionesResumen` / `_actualizarContadorTablaClasificaciones`
 * necesitan KPIs, o `crearClasificacion` necesita generar id determinista.
 * Then 3 helpers combined:
 *   - `clasificacionesConteo()`: retorna `{total, troncos, espec, sinMat}`.
 *     `sinMat` = filter clasificaciones sin materias referenciándolas (candidatas
 *     a depurar). `troncos` + `espec` particionan por tipo enum.
 *   - `_slugClasif(nombre)`: lowercase + NFD normalize + strip diacritics +
 *     replace non-alnum → '-' + trim leading/trailing dashes. Ej: 'Programación
 *     Web' → 'programacion-web'.
 *   - `nextClasificacionId(nombre)`: slugifica nombre → base. Si base no colide,
 *     retorna. Else incrementa sufijo `-2`, `-3`... hasta encontrar libre.
 * Edge:
 *   - **Comparación con `String()` coerce** en `sinMat` lookup protege contra
 *     IDs string vs número mismatch entre DEMO_CLASIFICACIONES y DEMO_MATERIAS.
 *   - **`_slugClasif` retorna '' si input vacío** → `nextClasificacionId` cae a
 *     fallback `clasif_${Date.now()}` (timestamp-based, no determinista).
 *   - **`nextClasificacionId` determinista** mientras DEMO_CLASIFICACIONES no
 *     cambie (idempotente).
 *   - **Regex range `[̀-ͯ]`** en `_slugClasif` es literal Unicode (combining
 *     diacritics block U+0300-U+036F). Equivalente a `[̀-ͯ]` usado
 *     en `_slugCarrera` (15a.B) — twin helper.
 *   - Funciones PURAS.
 *   - Twin con `_slugCarrera` + `nextCarreraId` (15a.B), `nextInstitucionId` (15a.C).
 */
function clasificacionesConteo() {
    const troncos = DEMO_CLASIFICACIONES.filter(c => c.tipo === "troncoComun").length;
    const espec   = DEMO_CLASIFICACIONES.filter(c => c.tipo === "especialidad").length;
    const sinMat  = DEMO_CLASIFICACIONES.filter(
        c => !DEMO_MATERIAS.some(m => String(m.clasificacionId) === String(c.id))
    ).length;
    return { total: DEMO_CLASIFICACIONES.length, troncos, espec, sinMat };
}

function _slugClasif(nombre) {
    return String(nombre || '').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function nextClasificacionId(nombre) {
    const base = _slugClasif(nombre) || 'clasif_' + Date.now();
    if (!DEMO_CLASIFICACIONES.some(c => String(c.id) === base)) return base;
    let i = 2;
    while (DEMO_CLASIFICACIONES.some(c => String(c.id) === `${base}-${i}`)) i++;
    return `${base}-${i}`;
}

// ── Estado del filtro activo en la tabla ─────────────────
let _clasificacionesFiltro = { texto: "", tipo: "todos" };

/**
 * @interaction build-clasificaciones
 * @scope admin-clasificaciones-entrypoint
 *
 * Given DOM admin tab Clasificaciones montado.
 * When admin entra a tab Clasificaciones o tras CRUD mutation.
 * Then entry orchestrator que invoca en cascada:
 *   1. `_renderTablaClasificaciones` (tbody con filtros aplicados).
 *   2. `_actualizarContadorTablaClasificaciones` (subtitle KPI).
 *   3. `buildClasificacionesResumen` (4 metric-cards con animación scale).
 * Edge:
 *   - **NO invoca `poblarFiltrosClasificaciones`** (asimetría vs `buildCarreras`
 *     15a.B + `buildInstituciones` 15a.C): el filtro de tipo es enum fijo
 *     (`todos`/`troncoComun`/`especialidad`) hardcoded en HTML, no data-derivado.
 *   - **Sin DOM guards en orquestador**: cada sub-fn tiene su propio `if (!el) return`.
 *   - **NO invoca `_sincronizarMetricasClasificaciones`** (no existe — clasificaciones
 *     NO sincroniza KPIs cross-módulo porque no hay módulo "Clasificaciones" en
 *     `ADMIN_MODULOS_DATA`; deuda post-Supabase considerar agregar tarjeta).
 *   - Función IMPURA (DOM cascade).
 *   - Twin con `buildCarreras` (15a.B), `buildInstituciones` (15a.C).
 */
function buildClasificaciones() {
    _renderTablaClasificaciones();
    _actualizarContadorTablaClasificaciones();
    buildClasificacionesResumen();
}

/**
 * @interaction render-tabla-clasificaciones
 * @scope admin-clasificaciones-render-tabla
 *
 * Given DOM `#clasificaciones-tbody` + `_clasificacionesFiltro` (module-scope:
 * `{texto, tipo}`) + DEMO_CLASIFICACIONES + DEMO_CARRERAS + DEMO_MATERIAS globales.
 * When `buildClasificaciones` o handlers de filtros (`filtrarClasificaciones*`)
 * o CRUD mutations (`crear*`/`guardarEdicion*`/`eliminar*`) lo invocan.
 * Then:
 *   1. Filtra DEMO_CLASIFICACIONES por `texto` (substring case-insensitive en
 *      `nombre`) + `tipo` (enum match o `todos` = passthrough).
 *   2. Si vacío → renderea empty state inline `.x-empty--inline`.
 *   3. Else map a `<tr>` con 5 columnas: identidad (icono 🏷️ + nombre + ID mono),
 *      tipo (chip `--info` para troncoComun / `--brand` para especialidad),
 *      carreras claves (lookup DEMO_CARRERAS por id → join " / " / "—"),
 *      conteo materias (count DEMO_MATERIAS con `clasificacionId` match),
 *      acciones (Editar + Eliminar inline).
 * Edge:
 *   - **`carreraIds` array literal** (no Set/lookup map) — OK por DEMO scale
 *     pequeño. Post-Supabase considerar índice si N > 100.
 *   - **Lookup carreras `?.clave`** con optional chaining → si carrera huérfana
 *     se filtra con `Boolean` → join silenciosamente sin warning. Deuda detectar
 *     refs rotas (UI cleanup).
 *   - **Tipo enum hardcoded** "troncoComun"/"especialidad" — sincronizar con
 *     modal `<select>` options y con `_renderCarrerasControl` semántica.
 *   - **Variantes chip `--info` vs `--brand`** convencionalmente diferencian
 *     troncoComun (afecta todas las carreras) de especialidad (afecta 1).
 *   - **DOM guard `if (!el) return`** protege Phase C/E gradual rollout admin.
 *   - Función IMPURA (DOM write + sentinel string en empty state).
 *   - Twin con `_renderTablaCarreras` (15a.B) / `_renderTablaInstituciones` (15a.C)
 *     en estructura, pero **5 cols** (vs 6+ en otros) por menor metadata.
 */
function _renderTablaClasificaciones() {
    const el = document.getElementById("clasificaciones-tbody");
    if (!el) return;

    const { texto, tipo } = _clasificacionesFiltro;
    const filtradas = DEMO_CLASIFICACIONES.filter(c => {
        const txt = texto.toLowerCase();
        const coincideTexto = texto === "" || (c.nombre || "").toLowerCase().includes(txt);
        const coincideTipo  = tipo === "todos" || c.tipo === tipo;
        return coincideTexto && coincideTipo;
    });

    if (filtradas.length === 0) {
        el.innerHTML = `<tr><td colspan="5"><div class="x-empty x-empty--inline"><div class="x-empty__title">Sin resultados para la búsqueda actual</div></div></td></tr>`;
        return;
    }

    el.innerHTML = filtradas.map(c => {
        const tipoLabel = c.tipo === "troncoComun" ? "Tronco común" : "Especialidad";
        const tipoVariant = c.tipo === "troncoComun" ? "info" : "brand";
        const carrerasClaves = (c.carreraIds || [])
            .map(cid => DEMO_CARRERAS.find(x => String(x.id) === String(cid))?.clave)
            .filter(Boolean)
            .join(" / ") || "—";
        const materias = DEMO_MATERIAS.filter(m => String(m.clasificacionId) === String(c.id)).length;

        return `
        <tr id="clasif-row-${c.id}">
            <td>
                <div style="display:flex;align-items:center;gap:8px">
                    <div style="width:32px;height:32px;border-radius:var(--r-sm);background:var(--surface-2);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">🏷️</div>
                    <div>
                        <div style="font-weight:500;color:var(--text-primary)">${_escapeHtml(c.nombre) || "—"}</div>
                        <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono)">ID-${c.id}</div>
                    </div>
                </div>
            </td>
            <td><span class="x-chip x-chip--${tipoVariant}">${tipoLabel}</span></td>
            <td style="color:var(--text-secondary);font-family:var(--font-mono)">${_escapeHtml(carrerasClaves)}</td>
            <td><span style="font-family:var(--font-mono);color:var(--text-secondary)">${materias}</span></td>
            <td>
                <div style="display:flex;gap:4px;flex-wrap:wrap">
                    <button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 8px" onclick="abrirEditarClasificacion('${c.id}')">Editar</button>
                    <button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 8px;color:var(--xahni-red)" onclick="eliminarClasificacion('${c.id}')">Eliminar</button>
                </div>
            </td>
        </tr>`;
    }).join("");
}

/**
 * @interaction actualizar-contador-tabla-clasificaciones
 * @scope admin-clasificaciones-render-badge
 *
 * Given DOM `#gestion-clasificaciones-sub` + `clasificacionesConteo()`.
 * When `buildClasificaciones` o tras CRUD mutation lo invocan.
 * Then escribe textContent: `"{total} clasificaciones · {troncos} tronco(s)
 * común · {espec} especialidad(es)"`.
 * Edge:
 *   - **DOM guard `if (!sub) return`** → silent no-op si tab no montado.
 *   - **`sinMat` NO se muestra en badge** — vive solo en `buildClasificacionesResumen`
 *     (card amber "Sin materias / Candidatas a depurar").
 *   - **NO usa template literal con HTML** → textContent puro (XSS-safe).
 *   - Función IMPURA (DOM write).
 *   - Twin con `_actualizarContadorTablaCarreras` (15a.B) / `_actualizarContadorTablaInstituciones` (15a.C).
 */
function _actualizarContadorTablaClasificaciones() {
    const sub = document.getElementById("gestion-clasificaciones-sub");
    if (!sub) return;
    const c = clasificacionesConteo();
    sub.textContent = `${c.total} clasificaciones · ${c.troncos} tronco(s) común · ${c.espec} especialidad(es)`;
}

// ── Búsqueda y filtros reactivos ──────────────────────────
/**
 * @interaction filtros-clasificaciones-reactivos
 * @scope admin-clasificaciones-filtros
 *
 * Given input usuario en `#filtro-clasificacion-busqueda` (texto) o
 * `<select #filtro-clasificacion-tipo>` (enum `todos`/`troncoComun`/`especialidad`).
 * When usuario tipea/selecciona → onInput/onChange invoca handler.
 * Then 2 handlers combined:
 *   - `filtrarClasificacionesBusqueda(valor)`: muta `_clasificacionesFiltro.texto`.
 *   - `filtrarClasificacionesTipo(valor)`: muta `_clasificacionesFiltro.tipo`.
 *   Ambos invocan `_renderTablaClasificaciones` (re-filter + re-render).
 * Edge:
 *   - **Sin debounce** en texto — re-render por cada keystroke. Performance OK
 *     por DEMO scale; post-Supabase con N>1000 considerar debounce 150ms.
 *   - **Filter state module-scope `_clasificacionesFiltro`** sobrevive entre
 *     re-renders (no se resetea en `buildClasificaciones`).
 *   - **NO actualiza badge ni resumen** — solo tabla. Coherente: count totales
 *     no cambian al filtrar visualmente.
 *   - Funciones IMPURAS (mutate state + DOM cascade).
 *   - Twin con filtros `filtrarCarrerasBusqueda`/`filtrarCarrerasInstitucion`
 *     (15a.B) y los 4 filtros instituciones (15a.C).
 */
function filtrarClasificacionesBusqueda(valor) { _clasificacionesFiltro.texto = valor; _renderTablaClasificaciones(); }
function filtrarClasificacionesTipo(valor)     { _clasificacionesFiltro.tipo  = valor; _renderTablaClasificaciones(); }

// ── Modal: control reactivo de carreras según tipo ────────
// Cuando tipo=especialidad: radio buttons (single).
// Cuando tipo=troncoComun:  checkboxes (multi).
// Cambiar el <select> dispara _renderCarrerasControl conservando selección
// si las semánticas lo permiten (en especialidad solo se conserva la primera).
/**
 * @interaction modal-clasificaciones-carreras-control-shared
 * @scope admin-clasificaciones-modal-helpers
 *
 * Given containerId DOM (modal nueva o editar) + tipo enum + array de carrera IDs
 * seleccionadas + DEMO_CARRERAS global.
 * When `_onCambiarTipo*Clasificacion` o `abrirEditarClasificacion` o
 * `_abrirModalNuevaClasificacion` inicializan/sincronizan el control.
 * Then 2 helpers shared cross-modal (nueva + editar):
 *   - `_renderCarrerasControl(containerId, tipo, seleccionadas)`:
 *     1. Resuelve `inputType` = `tipo === "especialidad" ? "radio" : "checkbox"`.
 *     2. Si `tipo=especialidad` y `seleccionadas.length > 1` → conserva solo
 *        la primera (semántica: especialidad ⟹ 1 carrera, regla 1 schema).
 *     3. Renderea labels con input radio/checkbox marcando `checked` los IDs
 *        en `seleccionadas` Set.
 *   - `_leerCarrerasSeleccionadas(containerId)`: lee `input:checked` →
 *     array de IDs. Funciona uniforme para radio (1 item) y checkbox (N items).
 * Edge:
 *   - **Pattern reactivo single↔multi**: cambiar `<select>` tipo dispara
 *     re-render del control conservando selección si semántica lo permite.
 *     Es la INNOVACIÓN clave de este archivo (no presente en carreras/instituciones).
 *   - **`name` attribute scoped por `containerId`** (`${containerId}-carrera`)
 *     → evita colisión radio groups entre modal nueva y editar abiertos
 *     simultáneamente (aunque UI solo abre 1 a la vez).
 *   - **DOM guard `if (!el) return`** ambos helpers.
 *   - **`Set([...seleccionadas].map(String))`** coerce para mismatch numérico/string.
 *   - **Sin sort de DEMO_CARRERAS** → orden de inserción (no canonical alfabético).
 *   - Funciones IMPURAS (_renderCarrerasControl: DOM write; _leerCarrerasSeleccionadas:
 *     DOM read).
 *   - **Pattern único en admin** — sin twin en carreras/instituciones/usuarios.
 */
function _renderCarrerasControl(containerId, tipo, seleccionadas) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const inputType = tipo === "especialidad" ? "radio" : "checkbox";
    const name      = `${containerId}-carrera`;
    const sel = new Set((seleccionadas || []).map(String));
    // Si pasamos a especialidad y había >1, conservar solo la primera
    if (tipo === "especialidad" && sel.size > 1) {
        const primera = [...sel][0];
        sel.clear(); sel.add(primera);
    }
    el.innerHTML = DEMO_CARRERAS.map(c => `
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 0">
            <input type="${inputType}" name="${name}" value="${_escapeHtml(c.id)}" ${sel.has(String(c.id)) ? "checked" : ""}>
            <span><strong style="font-family:var(--font-mono)">${_escapeHtml(c.clave)}</strong> — ${_escapeHtml(c.nombre)}</span>
        </label>
    `).join("");
}

function _leerCarrerasSeleccionadas(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return [];
    return [...el.querySelectorAll("input:checked")].map(i => i.value);
}

// ── Crear clasificación ───────────────────────────────────
/**
 * @interaction modal-nueva-clasificacion-bootstrap
 * @scope admin-clasificaciones-modal-nueva
 *
 * Given DOM modal `#modal-nueva-clasificacion` + sus inputs hijos.
 * When admin clica botón "Nueva clasificación" (bootstrap) o cambia el `<select>`
 * tipo dentro del modal (sync).
 * Then 2 handlers combined modal nueva:
 *   - `_abrirModalNuevaClasificacion()` (bootstrap):
 *     1. Limpia `#nueva-clasificacion-nombre` value.
 *     2. Default tipo = "troncoComun".
 *     3. `_renderCarrerasControl` con default tipo + selección vacía.
 *     4. `openModal("modal-nueva-clasificacion")`.
 *   - `_onCambiarTipoNuevaClasificacion()` (sync reactivo):
 *     1. Lee tipo actual del `<select>`.
 *     2. Lee selecciones actuales con `_leerCarrerasSeleccionadas`.
 *     3. `_renderCarrerasControl` re-render con tipo nuevo conservando
 *        selección (`_renderCarrerasControl` aplica regla 1 si especialidad).
 * Edge:
 *   - **Default `tipo=troncoComun`** asume el caso común (afecta múltiples carreras);
 *     admin debe cambiar explícitamente a especialidad si aplica.
 *   - **Sin pre-poblar `<select>` carreras** — se renderea desde DEMO_CARRERAS
 *     en `_renderCarrerasControl`.
 *   - **NO usa optional chaining en `.value =`** del bootstrap → crash si DOM
 *     faltante (asume modal SIEMPRE montado en index.html).
 *   - **`_onCambiar` USA optional chaining `?.value`** → silent default `undefined`
 *     si DOM faltante.
 *   - Funciones IMPURAS (DOM write + modal state).
 *   - Twin pattern con modal editar (4 fn más abajo).
 */
function _abrirModalNuevaClasificacion() {
    document.getElementById("nueva-clasificacion-nombre").value = "";
    document.getElementById("nueva-clasificacion-tipo").value = "troncoComun";
    _renderCarrerasControl("nueva-clasificacion-carreras", "troncoComun", []);
    openModal("modal-nueva-clasificacion");
}

function _onCambiarTipoNuevaClasificacion() {
    const tipo = document.getElementById("nueva-clasificacion-tipo")?.value;
    const seleccionadas = _leerCarrerasSeleccionadas("nueva-clasificacion-carreras");
    _renderCarrerasControl("nueva-clasificacion-carreras", tipo, seleccionadas);
}

/**
 * @interaction crear-clasificacion-handler-async
 * @scope admin-clasificaciones-crear-async
 *
 * Given inputs modal `#modal-nueva-clasificacion` + DEMO_CLASIFICACIONES global.
 * When admin submit modal nueva clasificación.
 * Then async flow:
 *   1. Lee nombre + tipo + carreraIds (via `_leerCarrerasSeleccionadas`).
 *   2. Valida: nombre + tipo obligatorios → toast "completa nombre y tipo" + abort.
 *   3. Valida unicidad nombre case-insensitive → toast "ya existe" + abort.
 *   4. `await DataService.saveClasificacion({id: nextClasificacionId(nombre), ...})`.
 *      Try/catch atrapa err.message del DataService (validaciones server-side).
 *   5. Si OK: closeModal + cascade 3 renders (`_renderTabla` + `_actualizarContador`
 *      + `buildClasificacionesResumen`) + toast success.
 * Edge:
 *   - **`nextClasificacionId(nombre)` genera id determinista** desde nombre
 *     slugificado → primera vez con "Programación Web" produce id `programacion-web`.
 *   - **Validación unicidad case-insensitive** (`.toLowerCase()`) en cliente +
 *     servidor (DataService valida regla 1/2 schema).
 *   - **`carreraIds` puede ser `[]`** → DataService debe rechazar si tipo
 *     requiere ≥1 carrera (regla 2 schema). No validamos en cliente — deuda
 *     UX: feedback inline antes del submit.
 *   - **NO sincroniza KPIs cross-módulo** (asimetría vs materias.js +
 *     instituciones.js 15a.C que invocan `_sincronizarMetricas*`).
 *   - **`showToast` 3 variantes**: "error" (rojo) en validación/err, "success"
 *     (verde) en OK.
 *   - Función IMPURA (async + DOM cascade + DataService side effect).
 *   - Twin con `crearCarrera` (15a.B), `crearInstitucion` (15a.C).
 */
async function crearClasificacion() {
    const nombre = document.getElementById("nueva-clasificacion-nombre")?.value.trim();
    const tipo   = document.getElementById("nueva-clasificacion-tipo")?.value;
    const carreraIds = _leerCarrerasSeleccionadas("nueva-clasificacion-carreras");

    if (!nombre || !tipo) {
        showToast("Por favor completa nombre y tipo", "error");
        return;
    }
    if (DEMO_CLASIFICACIONES.some(c => (c.nombre || "").toLowerCase() === nombre.toLowerCase())) {
        showToast("Ya existe una clasificación con ese nombre", "error");
        return;
    }

    try {
        await DataService.saveClasificacion({
            id: nextClasificacionId(nombre),
            nombre, tipo, carreraIds,
        });
    } catch (err) {
        showToast(err?.message || `Error: ${err}`, "error");
        return;
    }

    closeModal("modal-nueva-clasificacion");
    _renderTablaClasificaciones();
    _actualizarContadorTablaClasificaciones();
    buildClasificacionesResumen();
    showToast(`Clasificación "${nombre}" creada correctamente`, "success");
}

// ── Editar clasificación ──────────────────────────────────
let _editandoClasifId = null;

/**
 * @interaction modal-editar-clasificacion-bootstrap
 * @scope admin-clasificaciones-modal-editar
 *
 * Given id clasificación + DEMO_CLASIFICACIONES global + DOM modal
 * `#modal-editar-clasificacion`.
 * When admin clica botón "Editar" en row (bootstrap) o cambia el `<select>`
 * tipo dentro del modal de edición (sync).
 * Then 2 handlers combined modal editar:
 *   - `abrirEditarClasificacion(id)` (bootstrap):
 *     1. Find clasificación por id con `String()` coerce.
 *     2. Si no existe → silent return (sin toast — defensivo cross-render).
 *     3. Side-channel `_editandoClasifId = c.id` (module-scope, lee `guardarEdicion*`).
 *     4. Pre-llena 3 inputs: nombre, tipo, carreraIds (via `_renderCarrerasControl`).
 *     5. `openModal("modal-editar-clasificacion")`.
 *   - `_onCambiarTipoEditarClasificacion()` (sync reactivo):
 *     1. Lee tipo actual del `<select>`.
 *     2. Lee selecciones actuales.
 *     3. Re-render control conservando selección (regla 1 aplica si especialidad).
 * Edge:
 *   - **Side-channel `_editandoClasifId`** module-scope: pattern cross-archivo
 *     admin (cementado 15a — sin contención por 1 modal a la vez).
 *   - **`c.tipo || "troncoComun"`** fallback defensivo si dato corrupto.
 *   - **Bootstrap NO usa optional chaining** en `.value =` → crash si DOM faltante.
 *   - **`String()` coerce** en find protege contra ID numérico/string mismatch.
 *   - Funciones IMPURAS (DOM write + module state mutation).
 *   - Twin con `abrirEditarCarrera` (15a.B), `abrirEditarInstitucion` (15a.C).
 */
function abrirEditarClasificacion(id) {
    const c = DEMO_CLASIFICACIONES.find(x => String(x.id) === String(id));
    if (!c) return;
    _editandoClasifId = c.id;

    document.getElementById("editar-clasificacion-nombre").value = c.nombre || "";
    document.getElementById("editar-clasificacion-tipo").value   = c.tipo   || "troncoComun";
    _renderCarrerasControl("editar-clasificacion-carreras", c.tipo, c.carreraIds || []);

    openModal("modal-editar-clasificacion");
}

function _onCambiarTipoEditarClasificacion() {
    const tipo = document.getElementById("editar-clasificacion-tipo")?.value;
    const seleccionadas = _leerCarrerasSeleccionadas("editar-clasificacion-carreras");
    _renderCarrerasControl("editar-clasificacion-carreras", tipo, seleccionadas);
}

/**
 * @interaction guardar-edicion-clasificacion-async
 * @scope admin-clasificaciones-guardar-async
 *
 * Given inputs modal `#modal-editar-clasificacion` + `_editandoClasifId`
 * (module-scope) + DEMO_CLASIFICACIONES global.
 * When admin submit modal editar clasificación.
 * Then async flow:
 *   1. Find clasificación por `_editandoClasifId` con `String()` coerce.
 *      Si no existe → silent return.
 *   2. Lee nombre + tipo + carreraIds.
 *   3. Valida: nombre + tipo obligatorios → toast "obligatorios" + abort.
 *   4. Valida unicidad nombre case-insensitive EXCLUYENDO self (`x.id !== _editandoClasifId`)
 *      → toast "ya existe otra" + abort.
 *   5. `await DataService.saveClasificacion({id, nombre, tipo, carreraIds})`.
 *      Try/catch atrapa errores schema (regla 1/2).
 *   6. Si OK: closeModal + cascade 3 renders + toast success.
 * Edge:
 *   - **Validación exclude-self** crítica para edit (vs `crearClasificacion` que
 *     valida todos). Coerce `String()` evita falsos positivos numérico/string.
 *   - **id preservado** (no se regenera con `nextClasificacionId`) — referencias
 *     en `DEMO_MATERIAS.clasificacionId` permanecen válidas.
 *   - **NO sincroniza KPIs cross-módulo** (asimetría documentada en
 *     `crearClasificacion`).
 *   - **`_editandoClasifId` NO se resetea** post-save → side-channel sobrevive
 *     hasta próximo `abrirEditarClasificacion`. OK (no causa bugs).
 *   - Función IMPURA (async + DOM cascade + DataService side effect + lee module state).
 *   - Twin con `guardarEdicionCarrera` (15a.B), `guardarEdicionInstitucion` (15a.C).
 */
async function guardarEdicionClasificacion() {
    const c = DEMO_CLASIFICACIONES.find(x => String(x.id) === String(_editandoClasifId));
    if (!c) return;

    const nombre = document.getElementById("editar-clasificacion-nombre")?.value.trim();
    const tipo   = document.getElementById("editar-clasificacion-tipo")?.value;
    const carreraIds = _leerCarrerasSeleccionadas("editar-clasificacion-carreras");

    if (!nombre || !tipo) {
        showToast("Nombre y tipo son obligatorios", "error");
        return;
    }
    if (DEMO_CLASIFICACIONES.some(x => (x.nombre || "").toLowerCase() === nombre.toLowerCase() && String(x.id) !== String(_editandoClasifId))) {
        showToast("Ya existe otra clasificación con ese nombre", "error");
        return;
    }

    try {
        await DataService.saveClasificacion({ id: c.id, nombre, tipo, carreraIds });
    } catch (err) {
        showToast(err?.message || `Error: ${err}`, "error");
        return;
    }

    closeModal("modal-editar-clasificacion");
    _renderTablaClasificaciones();
    _actualizarContadorTablaClasificaciones();
    buildClasificacionesResumen();
    showToast(`Clasificación "${nombre}" actualizada`, "success");
}

// ── Eliminar (con guardia FK regla 7) ─────────────────────
/**
 * @interaction eliminar-clasificacion-async-fk-guard
 * @scope admin-clasificaciones-eliminar-async
 *
 * Given id clasificación + DEMO_CLASIFICACIONES global.
 * When admin clica botón "Eliminar" en row.
 * Then async flow:
 *   1. Find clasificación por id con `String()` coerce. Si no existe → silent return.
 *   2. `confirmarCanonico` modal danger. Si cancela → silent return.
 *   3. `await DataService.deleteClasificacion(c.id)`.
 *   4. Try/catch ATRAPA `err.code === 'CLASIF_IN_USE'` (regla 7 schema:
 *      no borrar si materias referencian) → toast con `err.message` específico.
 *      Otros errores → toast "inesperado" con err.message fallback.
 *   5. Si OK: cascade 3 renders + toast info "eliminada".
 * Edge:
 *   - **FK guard explícito regla 7**: simétrico con `eliminarCarrera` (15a.B)
 *     que atrapa `'CARRERA_IN_USE'`. Asimétrico con `eliminarInstitucion`
 *     (15a.C) que NO maneja FK error (deuda anotada en log 15a).
 *   - **`confirmarCanonico`** sobre `confirm()` nativo: modal canonical XAHNI
 *     con tipo `danger` (botón rojo "Eliminar"), HTML-escaped en mensaje.
 *   - **`showToast` 3 variantes**: "error" (FK guard + err inesperado),
 *     "info" (delete OK — color azul, no verde — coherente con admin tone).
 *   - **NO sincroniza KPIs cross-módulo** (asimetría).
 *   - **Sin guardia explícita en cliente** ANTES de delete (no precounts si
 *     hay materias referenciándola — confía en server-side).
 *   - Función IMPURA (async + DOM cascade + DataService side effect).
 *   - Twin con `eliminarCarrera` (15a.B), `eliminarInstitucion` (15a.C).
 */
async function eliminarClasificacion(id) {
    const c = DEMO_CLASIFICACIONES.find(x => String(x.id) === String(id));
    if (!c) return;
    const nombre = c.nombre;

    const ok = await confirmarCanonico({
        titulo: "Eliminar clasificación",
        mensaje: `¿Eliminar la clasificación <strong>${_escapeHtml(nombre)}</strong>? Esta acción no se puede deshacer.`,
        accionTexto: "Eliminar",
        tipo: "danger",
    });
    if (!ok) return;

    try {
        await DataService.deleteClasificacion(c.id);
    } catch (err) {
        if (err && err.code === 'CLASIF_IN_USE') {
            showToast(err.message, "error");
        } else {
            showToast(`Error inesperado: ${err?.message || err}`, "error");
        }
        return;
    }

    _renderTablaClasificaciones();
    _actualizarContadorTablaClasificaciones();
    buildClasificacionesResumen();
    showToast(`Clasificación "${nombre}" eliminada`, "info");
}

// ── Tarjetas de resumen ──────────────────────────────────
/**
 * @interaction build-clasificaciones-resumen
 * @scope admin-clasificaciones-resumen
 *
 * Given DOM `#clasificaciones-resumen` + `clasificacionesConteo()` +
 * `DEMO_MATERIAS` global.
 * When `buildClasificaciones` o tras CRUD mutation lo invoca.
 * Then:
 *   1. Fade-out fase 1: opacity 0.6 + scale(0.98).
 *   2. `setTimeout 150ms` fase 2: renderea 4 metric-cards:
 *      - **blue**: total clasificaciones (delta: troncos común).
 *      - **purple**: especialidades (delta: "1 carrera c/u").
 *      - **teal**: total materias clasificadas (delta: distribuidas entre N clasifs).
 *      - **amber**: sin materias (delta: "candidatas a depurar").
 *   3. Fade-in: transition all 0.3s ease + opacity 1 + scale 1.
 * Edge:
 *   - **Animación CSS inline** (style.opacity/transform) en lugar de class swap.
 *     Preserva isolation pero deuda: cementar tokens `.metric-card` legacy →
 *     `.x-stat` canonical post-migración (anotado en sesión 15a).
 *   - **`DEMO_MATERIAS.length`** = total materias del sistema, NO solo las
 *     que tienen clasificación válida. Métrica asume 1:1 (todas tienen).
 *   - **DOM guard `if (!el) return`** → silent no-op si tab no montado.
 *   - **`sinMat` semántica**: clasificaciones sin materias asociadas (candidatas
 *     a depurar) — único place donde se muestra (no en badge).
 *   - **NO incluye conteo por tipo "tronco vs especialidad" en card dedicada**
 *     — cards azul + purple ya separan total / especialidad.
 *   - Función IMPURA (DOM write + async setTimeout cascade).
 *   - Twin con `buildCarrerasResumen` (15a.B), `buildInstitucionesResumen` (15a.C).
 */
function buildClasificacionesResumen() {
    const el = document.getElementById("clasificaciones-resumen");
    if (!el) return;
    const c = clasificacionesConteo();
    el.style.opacity = "0.6";
    el.style.transform = "scale(0.98)";
    setTimeout(() => {
        el.innerHTML = `
            <div class="metric-card blue">
                <div class="metric-icon blue">🏷️</div>
                <div class="metric-value">${c.total}</div>
                <div class="metric-label">Total clasificaciones</div>
                <div class="metric-delta neutral">${c.troncos} tronco(s) común</div>
            </div>
            <div class="metric-card purple">
                <div class="metric-icon purple">🎯</div>
                <div class="metric-value">${c.espec}</div>
                <div class="metric-label">Especialidades</div>
                <div class="metric-delta neutral">1 carrera c/u</div>
            </div>
            <div class="metric-card teal">
                <div class="metric-icon teal">📚</div>
                <div class="metric-value">${DEMO_MATERIAS.length}</div>
                <div class="metric-label">Materias clasificadas</div>
                <div class="metric-delta neutral">Distribuidas entre ${c.total} clasificaciones</div>
            </div>
            <div class="metric-card amber">
                <div class="metric-icon amber">⚠️</div>
                <div class="metric-value">${c.sinMat}</div>
                <div class="metric-label">Sin materias</div>
                <div class="metric-delta neutral">Candidatas a depurar</div>
            </div>
        `;
        el.style.transition = "all 0.3s ease";
        el.style.opacity = "1";
        el.style.transform = "scale(1)";
    }, 150);
}
