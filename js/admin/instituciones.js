// ═══════════════════════════════════════════════════════════
// BUILDERS — Administrador: Gestión de Instituciones
// Lectura desde DEMO_INSTITUCIONES (poblado por DataService desde
// data/demo/instituciones.json en demo, Firestore en prod). Las
// mutaciones pasan por DataService.saveInstitucion / deleteInstitucion
// (Bloqueante 2, 2026-05-15) — el adapter mantiene la referencia del
// array en demo para que la lectura subsecuente vea los cambios.
// ═══════════════════════════════════════════════════════════

// ── Helpers locales (originalmente en state.js de vista-admin) ──
/**
 * @interaction instituciones-conteo-y-next-id
 * @scope admin-instituciones-helpers
 *
 * Given DEMO_INSTITUCIONES array global.
 * When KPIs cross-módulo (admin panel, modulos perfil) o `crearInstitucion`
 *   necesita id nuevo.
 * Then 2 helpers combined:
 *   - `institucionesConteo()`: 9 stats (total + 3 tipo + 2 estado +
 *     3 totales reduce: usuarios/materias/grupos).
 *   - `nextInstitucionId()`: `Math.max(...ids) + 1` con guard array vacío → 1.
 * Edge:
 *   - **`institucionesConteo` retorna shape rico** (consumer cross-archivo
 *     consume subsets: dashboard usa `total`, modulos usa 3 tipo).
 *   - **`reduce` con `|| 0` guards** preserva nulls como 0.
 *   - **`nextInstitucionId` asume id numérico**: para id string (UUIDs prod)
 *     romperá → deuda post-Supabase migrate a UUID server-side.
 *   - Funciones PURAS.
 *   - Twin con `carrerasConteo` + `nextCarreraId`.
 */
function institucionesConteo() {
    return {
        total:          DEMO_INSTITUCIONES.length,
        universidades:  DEMO_INSTITUCIONES.filter(i => i.tipo === "universidad").length,
        preparatorias:  DEMO_INSTITUCIONES.filter(i => i.tipo === "preparatoria").length,
        primarias:      DEMO_INSTITUCIONES.filter(i => i.tipo === "primaria").length,
        activas:        DEMO_INSTITUCIONES.filter(i => i.estado === "Activa").length,
        suspendidas:    DEMO_INSTITUCIONES.filter(i => i.estado === "Suspendida").length,
        totalUsuarios:  DEMO_INSTITUCIONES.reduce((s, i) => s + (i.usuarios || 0), 0),
        totalMaterias:  DEMO_INSTITUCIONES.reduce((s, i) => s + (i.materias || 0), 0),
        totalGrupos:    DEMO_INSTITUCIONES.reduce((s, i) => s + (i.grupos   || 0), 0),
    };
}

function nextInstitucionId() {
    return DEMO_INSTITUCIONES.length > 0
        ? Math.max(...DEMO_INSTITUCIONES.map(i => i.id)) + 1
        : 1;
}

// ── Estado del filtro activo en la tabla ─────────────────
let _institucionesFiltro = { texto: "", tipo: "todos", region: "todas", estado: "todos" };

/**
 * @interaction build-instituciones
 * @scope admin-instituciones-entrypoint
 *
 * Given DOM admin tab Instituciones montado.
 * When admin entra a tab Instituciones o tras CRUD mutation.
 * Then entry orchestrator que invoca en cascada:
 *   1. `poblarFiltrosInstituciones` (selects tipo + region).
 *   2. `_renderTablaInstituciones` (tbody con 4 filtros).
 *   3. `_actualizarContadorTablaInstituciones` (subtitle KPI).
 *   4. `buildInstitucionesResumen` (4 cards animados).
 * Edge:
 *   - **NO invoca `_sincronizarMetricasInstituciones`** acá (solo en
 *     CRUD individual handlers, para evitar re-render extra al montar).
 *   - **Twin con `buildCarreras`** (15a.B) + buildUsuarios.
 *   - **Exportado window** implícito (consumer navigation).
 *   - Función IMPURA (DOM cascade).
 */
function buildInstituciones() {
    poblarFiltrosInstituciones();
    _renderTablaInstituciones();
    _actualizarContadorTablaInstituciones();
    buildInstitucionesResumen();
}

/**
 * @interaction poblar-filtros-instituciones
 * @scope admin-instituciones-render-filtros
 *
 * Given DOM `#filtro-tipo-institucion` + `#filtro-region-institucion` +
 *   DEMO_INSTITUCIONES global.
 * When `buildInstituciones` orchestrator inicializa filtros.
 * Then:
 *   1. Extrae distinct `tipo` + `region` (filter Boolean + sort).
 *   2. `cap` helper: capitalize primera letra.
 *   3. Renderea options: `"Todos"`/`"Todas"` + 1 por valor distinct.
 *   4. Preserva valores seleccionados actuales si siguen válidos.
 * Edge:
 *   - **Patrón data-derivado**: cualquier institución nueva aparece sin
 *     tocar HTML. Espejo de `poblarFiltrosHorarios`.
 *   - **`_escapeHtml` canonical** en tipo + region (XSS).
 *   - **DOM ausente → no-op** (guard ambos selects).
 *   - Función IMPURA (DOM).
 */
function poblarFiltrosInstituciones() {
    const tipoSel = document.getElementById("filtro-tipo-institucion");
    const regionSel = document.getElementById("filtro-region-institucion");
    if (!tipoSel || !regionSel) return;

    const tipos    = [...new Set(DEMO_INSTITUCIONES.map(i => i.tipo).filter(Boolean))].sort();
    const regiones = [...new Set(DEMO_INSTITUCIONES.map(i => i.region).filter(Boolean))].sort();

    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    const valTipo    = tipoSel.value;
    const valRegion  = regionSel.value;

    tipoSel.innerHTML = `<option value="todos">Todos los tipos</option>` +
        tipos.map(t => `<option value="${_escapeHtml(t)}">${_escapeHtml(cap(t))}</option>`).join("");
    regionSel.innerHTML = `<option value="todas">Todas las regiones</option>` +
        regiones.map(r => `<option value="${_escapeHtml(r)}">${_escapeHtml(r)}</option>`).join("");

    // Preservar selección actual si sigue siendo válida tras el repoblado.
    if ([...tipoSel.options].some(o => o.value === valTipo))     tipoSel.value = valTipo;
    if ([...regionSel.options].some(o => o.value === valRegion)) regionSel.value = valRegion;
}

/**
 * @interaction render-tabla-instituciones
 * @scope admin-instituciones-render-tabla
 *
 * Given DOM `#instituciones-tbody` + DEMO_INSTITUCIONES + `_institucionesFiltro`
 *   module-scope state (texto + tipo + region + estado).
 * When `buildInstituciones` orquestrador o handler filtro reactivo dispara.
 * Then:
 *   1. Filter DEMO_INSTITUCIONES por 4 criterios AND combined.
 *   2. Si vacío → empty state inline `.x-empty--inline`.
 *   3. Map por row: avatar emoji por tipo + nombre + ID-mono + badge tipo +
 *      region + usuarios + materias/grupos inline + badge estado +
 *      3 botones Editar/Suspender|Activar/Eliminar.
 * Edge:
 *   - **3 emojis por tipo** (universidad/preparatoria/primaria).
 *   - **`_escapeHtml` en nombre/region** (XSS).
 *   - **Botón Suspender/Activar bifurcado** por estado actual + color contextual.
 *   - **`tipoColor` ternario triple** (blue/amber/teal).
 *   - **DOM ausente → no-op**.
 *   - Función IMPURA (DOM masivo).
 */
function _renderTablaInstituciones() {
    const el = document.getElementById("instituciones-tbody");
    if (!el) return;

    const { texto, tipo, region, estado } = _institucionesFiltro;
    const filtrados = DEMO_INSTITUCIONES.filter(i => {
        const coincideTexto = texto === "" ||
            i.nombre.toLowerCase().includes(texto.toLowerCase()) ||
            i.region.toLowerCase().includes(texto.toLowerCase());
        const coincideTipo = tipo === "todos" || i.tipo === tipo;
        const coincideRegion = region === "todas" || i.region === region;
        const coincideEstado = estado === "todos" || i.estado === estado;
        return coincideTexto && coincideTipo && coincideRegion && coincideEstado;
    });

    if (filtrados.length === 0) {
        el.innerHTML = `<tr><td colspan="7"><div class="x-empty x-empty--inline"><div class="x-empty__title">Sin resultados para la búsqueda actual</div></div></td></tr>`;
        return;
    }

    el.innerHTML = filtrados.map(i => {
        const tipoColor = i.tipo === "universidad" ? "blue" : i.tipo === "preparatoria" ? "amber" : "teal";
        const activa = i.estado === "Activa";
        const tipoLabel = i.tipo === "universidad" ? "Universidad" : i.tipo === "preparatoria" ? "Preparatoria" : "Primaria";

        return `
        <tr id="institucion-row-${i.id}">
            <td>
                <div style="display:flex;align-items:center;gap:8px">
                    <div style="width:32px;height:32px;border-radius:var(--r-sm);background:var(--xahni-${tipoColor}-dim);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">
                        ${i.tipo === "universidad" ? "🎓" : i.tipo === "preparatoria" ? "📚" : "🏫"}
                    </div>
                    <div>
                        <div style="font-weight:500;color:var(--text-primary)">${_escapeHtml(i.nombre)}</div>
                        <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono)">ID-${i.id}</div>
                    </div>
                </div>
            </td>
            <td><span class="badge ${tipoColor}">${tipoLabel}</span></td>
            <td style="color:var(--text-secondary)">${_escapeHtml(i.region)}</td>
            <td><span style="font-family:var(--font-mono);color:var(--text-secondary)">${(i.usuarios || 0).toLocaleString()}</span></td>
            <td>
                <div style="display:flex;gap:8px;font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">
                    <span>📚 ${i.materias || 0}</span>
                    <span>👥 ${i.grupos || 0}</span>
                </div>
            </td>
            <td><span class="badge ${activa ? "green" : "red"}">${i.estado}</span></td>
            <td>
                <div style="display:flex;gap:4px;flex-wrap:wrap">
                    <button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 8px" onclick="abrirEditarInstitucion('${i.id}')">Editar</button>
                    <button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 8px;color:${activa ? "var(--xahni-amber)" : "var(--xahni-green)"}" onclick="toggleEstadoInstitucion('${i.id}')">${activa ? "Suspender" : "Activar"}</button>
                    <button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 8px;color:var(--xahni-red)" onclick="eliminarInstitucion('${i.id}')">Eliminar</button>
                </div>
            </td>
        </tr>`;
    }).join("");
}

/**
 * @interaction actualizar-contador-tabla-instituciones
 * @scope admin-instituciones-kpi-subtitle
 *
 * Given DOM `#gestion-instituciones-sub` + `institucionesConteo()`.
 * When CRUD mutation o filtro cambia → refresh KPI subtitle.
 * Then escribe `"${total} instituciones · ${universidades} universidades · ${preparatorias} preparatorias · ${primarias} primarias"`.
 * Edge:
 *   - **DOM ausente → no-op**.
 *   - **Función IMPURA** (DOM).
 *   - Twin con `_actualizarContadorTablaCarreras`.
 */
function _actualizarContadorTablaInstituciones() {
    const sub = document.getElementById("gestion-instituciones-sub");
    if (!sub) return;
    const c = institucionesConteo();
    sub.textContent = `${c.total} instituciones · ${c.universidades} universidades · ${c.preparatorias} preparatorias · ${c.primarias} primarias`;
}

// ── Búsqueda y filtros reactivos ──────────────────────────
/**
 * @interaction filtros-instituciones-reactivos
 * @scope admin-instituciones-handlers-filtros
 *
 * Given input/select cambia en tab Instituciones.
 * When admin tipea search o selecciona tipo/region/estado.
 * Then 4 handlers combined (single-purpose mutate state + re-render):
 *   - `filtrarInstitucionesBusqueda(valor)`: texto.
 *   - `filtrarInstitucionesTipo(valor)`: tipo.
 *   - `filtrarInstitucionesRegion(valor)`: region.
 *   - `filtrarInstitucionesEstado(valor)`: estado.
 * Edge:
 *   - **State module-scope `_institucionesFiltro`** preserva 4 dims.
 *   - **4 handlers vs 1 polimórfico** preserva contract DOM oninput/onchange.
 *   - **Re-render reactivo, no debounce**.
 *   - **Exportado window** (oninput/onchange inline tabla).
 *   - Función IMPURA (DOM).
 *   - Pattern más rico que `filtrosCarrerasReactivos` (4 vs 2 dims).
 */
function filtrarInstitucionesBusqueda(valor) { _institucionesFiltro.texto = valor; _renderTablaInstituciones(); }
function filtrarInstitucionesTipo(valor)     { _institucionesFiltro.tipo = valor; _renderTablaInstituciones(); }
function filtrarInstitucionesRegion(valor)   { _institucionesFiltro.region = valor; _renderTablaInstituciones(); }
function filtrarInstitucionesEstado(valor)   { _institucionesFiltro.estado = valor; _renderTablaInstituciones(); }

// ── Crear institución ─────────────────────────────────────
/**
 * @interaction crear-institucion
 * @scope admin-instituciones-modal-crear
 *
 * Given DOM modal `modal-nueva-institucion` con 3 inputs.
 * When admin click "Crear" en modal.
 * Then async pipeline:
 *   1. Lee + trim nombre + tipo + region.
 *   2. Validation campos requeridos + nombre único.
 *   3. Genera id via `nextInstitucionId`.
 *   4. **`await DataService.saveInstitucion({...})`** con defaults:
 *      `estado: "Activa"`, usuarios/materias/grupos: 0,
 *      `fechaCreacion: ISO YYYY-MM-DD`.
 *   5. Limpia inputs + close + 4 re-renders + sincronizar metricas + toast.
 * Edge:
 *   - **`fechaCreacion` derivada client-side**: para prod considerar
 *     server timestamp Firestore.
 *   - **`tipo` default reset a "universidad"** post-create.
 *   - **4 re-renders en cascada**: tabla + KPI + resumen + sincronización.
 *   - **`_sincronizarMetricasInstituciones`** propaga a dashboard + modulos.
 *   - **Exportado window** (onclick inline modal).
 *   - Función IMPURA (DataService + DOM).
 */
async function crearInstitucion() {
    const nombre = document.getElementById("nueva-institucion-nombre")?.value.trim();
    const tipo = document.getElementById("nueva-institucion-tipo")?.value;
    const region = document.getElementById("nueva-institucion-region")?.value.trim();

    if (!nombre || !tipo || !region) {
        showToast("Por favor completa todos los campos", "error");
        return;
    }
    if (DEMO_INSTITUCIONES.some(i => i.nombre.toLowerCase() === nombre.toLowerCase())) {
        showToast("Ya existe una institución con ese nombre", "error");
        return;
    }

    await DataService.saveInstitucion({
        id: nextInstitucionId(),
        nombre,
        tipo,
        region,
        estado: "Activa",
        usuarios: 0,
        materias: 0,
        grupos: 0,
        fechaCreacion: new Date().toISOString().split("T")[0],
    });

    document.getElementById("nueva-institucion-nombre").value = "";
    document.getElementById("nueva-institucion-tipo").value = "universidad";
    document.getElementById("nueva-institucion-region").value = "";

    closeModal("modal-nueva-institucion");
    _renderTablaInstituciones();
    _actualizarContadorTablaInstituciones();
    buildInstitucionesResumen();
    _sincronizarMetricasInstituciones();
    showToast(`Institución ${nombre} creada correctamente`, "success");
}

// ── Editar institución ────────────────────────────────────
let _editandoInstitucionId = null;

/**
 * @interaction abrir-editar-institucion
 * @scope admin-instituciones-modal-editar-bootstrap
 *
 * Given id institución (string desde onclick) + DOM modal `modal-editar-institucion`
 *   con 6 inputs.
 * When admin click "Editar" en row tabla.
 * Then:
 *   1. Lookup (String coerce). Sin → silent return.
 *   2. Set `_editandoInstitucionId` PRESERVANDO TIPO NATIVO (no string coerce).
 *   3. Prepobla 6 inputs (nombre/tipo/region/usuarios/materias/grupos).
 *   4. `openModal` canonical.
 * Edge:
 *   - **String() comparator dual**: onclick pasa string, DEMO tiene numérico,
 *     guardar lookup también usa String coerce.
 *   - **`_editandoInstitucionId` preserva tipo nativo** del registro
 *     (importante para Firestore docId vs número DEMO).
 *   - **Side-channel module-scope** (sin contención: 1 modal a la vez).
 *   - **Exportado window** (onclick inline tabla).
 *   - Función IMPURA (DOM + module-scope).
 */
function abrirEditarInstitucion(id) {
    // String() comparator: el onclick pasa el id wrapped en quotes (siempre string),
    // pero DEMO_INSTITUCIONES tiene ids numéricos hoy. Tolera ambos.
    const i = DEMO_INSTITUCIONES.find(i => String(i.id) === String(id));
    if (!i) return;
    _editandoInstitucionId = i.id; // preservar el tipo nativo del registro
    document.getElementById("editar-institucion-nombre").value = i.nombre;
    document.getElementById("editar-institucion-tipo").value = i.tipo;
    document.getElementById("editar-institucion-region").value = i.region;
    document.getElementById("editar-institucion-usuarios").value = i.usuarios;
    document.getElementById("editar-institucion-materias").value = i.materias;
    document.getElementById("editar-institucion-grupos").value = i.grupos;
    openModal("modal-editar-institucion");
}

/**
 * @interaction guardar-edicion-institucion
 * @scope admin-instituciones-modal-editar-submit
 *
 * Given `_editandoInstitucionId` set + DOM modal con 6 inputs editados.
 * When admin click "Guardar".
 * Then async pipeline:
 *   1. Lookup. Sin → silent return.
 *   2. Lee 6 campos + parseInt 3 numéricos (`|| 0` fallback).
 *   3. Validation: campos obligatorios + nombre único EXCLUYENDO self.
 *   4. **`await DataService.saveInstitucion({id...})`** upsert.
 *   5. Close + 4 re-renders + sincronizar + toast.
 * Edge:
 *   - **Validation excluye self** (no false-positive).
 *   - **`estado` NO actualizado en edit**: lo gestiona `toggleEstadoInstitucion`
 *     dedicado.
 *   - **`_sincronizarMetricasInstituciones`** propaga cross-módulo.
 *   - **Exportado window** (onclick inline modal).
 *   - Función IMPURA (DataService + DOM).
 */
async function guardarEdicionInstitucion() {
    const i = DEMO_INSTITUCIONES.find(i => String(i.id) === String(_editandoInstitucionId));
    if (!i) return;

    const nombre = document.getElementById("editar-institucion-nombre")?.value.trim();
    const tipo = document.getElementById("editar-institucion-tipo")?.value;
    const region = document.getElementById("editar-institucion-region")?.value.trim();
    const usuarios = parseInt(document.getElementById("editar-institucion-usuarios")?.value) || 0;
    const materias = parseInt(document.getElementById("editar-institucion-materias")?.value) || 0;
    const grupos = parseInt(document.getElementById("editar-institucion-grupos")?.value) || 0;

    if (!nombre || !tipo || !region) {
        showToast("Por favor completa todos los campos obligatorios", "error");
        return;
    }
    if (DEMO_INSTITUCIONES.some(x => x.nombre.toLowerCase() === nombre.toLowerCase() && String(x.id) !== String(_editandoInstitucionId))) {
        showToast("Ya existe otra institución con ese nombre", "error");
        return;
    }

    await DataService.saveInstitucion({ id: i.id, nombre, tipo, region, usuarios, materias, grupos });

    closeModal("modal-editar-institucion");
    _renderTablaInstituciones();
    _actualizarContadorTablaInstituciones();
    buildInstitucionesResumen();
    _sincronizarMetricasInstituciones();
    showToast(`Institución ${nombre} actualizada correctamente`, "success");
}

// ── Suspender / Activar ───────────────────────────────────
/**
 * @interaction toggle-estado-institucion
 * @scope admin-instituciones-handler-async
 *
 * Given id institución + DOM tabla con row.
 * When admin click "Suspender" (si Activa) o "Activar" (si Suspendida).
 * Then async pipeline:
 *   1. Lookup. Sin → silent return.
 *   2. Toggle estado: `"Activa"` ↔ `"Suspendida"`.
 *   3. **`await DataService.saveInstitucion({id, estado})`** partial update.
 *   4. 4 re-renders + sincronizar + toast (success/info según activado).
 * Edge:
 *   - **Partial update**: solo `{id, estado}` → DataService merge preserva
 *     otros campos (en demo upsert preserva identidad referencial).
 *   - **Action reversible**: no requiere `confirmarCanonico`.
 *   - **Toast tipo bifurcado**: success si Activa, info si Suspendida.
 *   - **Exportado window** (onclick inline tabla).
 *   - Función IMPURA (DataService + DOM).
 *   - Twin con `suspenderUsuario` (15a.A).
 */
async function toggleEstadoInstitucion(id) {
    const i = DEMO_INSTITUCIONES.find(i => String(i.id) === String(id));
    if (!i) return;
    const nuevoEstado = i.estado === "Activa" ? "Suspendida" : "Activa";
    await DataService.saveInstitucion({ id: i.id, estado: nuevoEstado });
    _renderTablaInstituciones();
    _actualizarContadorTablaInstituciones();
    buildInstitucionesResumen();
    _sincronizarMetricasInstituciones();
    showToast(`Institución ${i.nombre} ${nuevoEstado === "Activa" ? "activada" : "suspendida"}.`, nuevoEstado === "Activa" ? "success" : "info");
}

// ── Eliminar institución ──────────────────────────────────
/**
 * @interaction eliminar-institucion
 * @scope admin-instituciones-handler-async
 *
 * Given id institución + DOM tabla.
 * When admin click "Eliminar".
 * Then async pipeline:
 *   1. Lookup. Sin → silent return.
 *   2. `confirmarCanonico` modal danger.
 *   3. Si cancel → return.
 *   4. **`await DataService.deleteInstitucion(id)`** SIN try/catch
 *      (diferencia con eliminarCarrera que tiene guardia FK).
 *   5. 4 re-renders + sincronizar + toast info.
 * Edge:
 *   - **Asimetría vs eliminarCarrera**: NO maneja FK error explícito.
 *     Deuda post-Supabase: agregar guardia FK (carreras + grupos asociados).
 *   - **`confirmarCanonico` canonical** modal danger.
 *   - **`_escapeHtml` en nombre** (XSS).
 *   - **Exportado window** (onclick inline tabla).
 *   - Función IMPURA (DataService + DOM).
 */
async function eliminarInstitucion(id) {
    const inst = DEMO_INSTITUCIONES.find(i => String(i.id) === String(id));
    if (!inst) return;
    const nombre = inst.nombre;

    const ok = await confirmarCanonico({
        titulo: "Eliminar institución",
        mensaje: `¿Eliminar <strong>${_escapeHtml(nombre)}</strong>? Esta acción no se puede deshacer.`,
        accionTexto: "Eliminar",
        tipo: "danger",
    });
    if (!ok) return;

    await DataService.deleteInstitucion(inst.id);
    _renderTablaInstituciones();
    _actualizarContadorTablaInstituciones();
    buildInstitucionesResumen();
    _sincronizarMetricasInstituciones();
    showToast(`Institución ${nombre} eliminada del sistema.`, "info");
}

// ── Sincronizar métricas con dashboard y módulos ──────────
/**
 * @interaction sincronizar-metricas-instituciones
 * @scope admin-instituciones-cross-module-sync
 *
 * Given mutation en DEMO_INSTITUCIONES + módulos cross-archivo deben reflect.
 * When `crearInstitucion`/`guardarEdicion`/`toggleEstado`/`eliminar` completan.
 * Then propagación cross-módulo:
 *   1. Resuelve `institucionesConteo()`.
 *   2. **Mutate `ADMIN_MODULOS_DATA`** entry `"Instituciones"`:
 *      total + detalle[0..2] (universidades/preparatorias/primarias).
 *      → si modifica → `buildPerfilModulosAdmin()` re-render.
 *   3. `_actualizarMetricasAdminPanel()` (typeof guard) → KPIs dashboard.
 *   4. Si user admin actual → update `#metric-instituciones-admin` directo.
 * Edge:
 *   - **Mutate global `ADMIN_MODULOS_DATA`** in-place: deuda post-Supabase
 *     migrar a vista materializada server-side (no global mutation).
 *   - **`typeof` guards triples**: módulos pueden no estar montados (Phase
 *     C/E gradual rollout).
 *   - **Función IMPURA** (DOM + globals).
 *   - Pattern único en admin (no twin con otros sync).
 */
function _sincronizarMetricasInstituciones() {
    const c = institucionesConteo();

    if (typeof ADMIN_MODULOS_DATA !== "undefined") {
        const modInstituciones = ADMIN_MODULOS_DATA.find(m => m.nombre === "Instituciones");
        if (modInstituciones) {
            modInstituciones.total = c.total;
            modInstituciones.detalle[0].valor = c.universidades;
            modInstituciones.detalle[1].valor = c.preparatorias;
            modInstituciones.detalle[2].valor = c.primarias;
            if (typeof buildPerfilModulosAdmin === "function") buildPerfilModulosAdmin();
        }
    }

    if (typeof _actualizarMetricasAdminPanel === "function") _actualizarMetricasAdminPanel();

    if (APP.user?.tipo === "administrador") {
        const metEl = document.getElementById("metric-instituciones-admin");
        if (metEl) metEl.textContent = c.total.toLocaleString();
    }
}

// ── Construir tarjetas de resumen ─────────────────────────
/**
 * @interaction build-instituciones-resumen
 * @scope admin-instituciones-render-resumen
 *
 * Given DOM `#instituciones-resumen` + `institucionesConteo()`.
 * When `buildInstituciones` orquestrador o post-mutation refresh.
 * Then 2-fase animation:
 *   1. Set opacity 0.6 + scale 0.98 (fade out).
 *   2. `setTimeout 150ms` → renderea 4 `.metric-card`:
 *      - Total instituciones (con delta activas vs suspendidas).
 *      - Usuarios totales (suma reduce).
 *      - Materias registradas + grupos asociados.
 *      - Universidades (con prep/primarias inline).
 *      → transition + opacity 1 + scale 1.
 * Edge:
 *   - **Animación CSS inline** preserva isolation.
 *   - **TODO post-migración**: cementar `.metric-card` legacy → `.x-stat`.
 *   - **Delta dinámico**: `up` si activas > suspendidas, sino `neutral`.
 *   - **DOM ausente → no-op**.
 *   - Función IMPURA (DOM + setTimeout async).
 *   - Twin con `buildCarrerasResumen` (15a.B).
 */
function buildInstitucionesResumen() {
    const el = document.getElementById("instituciones-resumen");
    if (!el) return;

    const c = institucionesConteo();
    el.style.opacity = "0.6";
    el.style.transform = "scale(0.98)";

    setTimeout(() => {
        el.innerHTML = `
            <div class="metric-card blue">
                <div class="metric-icon blue">🏫</div>
                <div class="metric-value">${c.total}</div>
                <div class="metric-label">Total instituciones</div>
                <div class="metric-delta ${c.activas > c.suspendidas ? 'up' : 'neutral'}">
                    ${c.activas} activas · ${c.suspendidas} suspendidas
                </div>
            </div>
            <div class="metric-card teal">
                <div class="metric-icon teal">👥</div>
                <div class="metric-value">${c.totalUsuarios.toLocaleString()}</div>
                <div class="metric-label">Usuarios totales</div>
                <div class="metric-delta neutral">Distribuidos en ${c.total} instituciones</div>
            </div>
            <div class="metric-card amber">
                <div class="metric-icon amber">📚</div>
                <div class="metric-value">${c.totalMaterias}</div>
                <div class="metric-label">Materias registradas</div>
                <div class="metric-delta neutral">${c.totalGrupos} grupos activos</div>
            </div>
            <div class="metric-card purple">
                <div class="metric-icon purple">📊</div>
                <div class="metric-value">${c.universidades}</div>
                <div class="metric-label">Universidades</div>
                <div class="metric-delta neutral">${c.preparatorias} preparatorias · ${c.primarias} primarias</div>
            </div>
        `;
        el.style.transition = "all 0.3s ease";
        el.style.opacity = "1";
        el.style.transform = "scale(1)";
    }, 150);
}
