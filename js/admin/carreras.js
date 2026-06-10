// ═══════════════════════════════════════════════════════════
// BUILDERS — Administrador: Gestión de Carreras
// Lectura desde DEMO_CARRERAS (poblado por DataService desde
// data/demo/carreras.json en demo, Firestore en prod). Las
// mutaciones pasan por DataService.saveCarrera / deleteCarrera
// (Bloqueante 4.B, 2026-05-16).
//
// El schema canónico es {id, nombre, clave, institucionId}.
// La cuenta de grupos por carrera se deriva en runtime de
// DEMO_GRUPOS — en 4.B la columna mostrará 0 hasta que 4.C
// rellene grupo.carreraId.
// ═══════════════════════════════════════════════════════════

// ── Helpers locales ──────────────────────────────────────
/**
 * @interaction carreras-conteo
 * @scope admin-carreras-helpers
 *
 * Given DEMO_CARRERAS + DEMO_GRUPOS arrays globales.
 * When `buildCarrerasResumen` / `_actualizarContadorTablaCarreras` necesitan KPIs.
 * Then retorna `{total, instituciones, totalGrupos, sinGrupos}`:
 *   - `total` = count DEMO_CARRERAS.
 *   - `instituciones` = Set distinct institucionId (filtra null).
 *   - `totalGrupos` = reduce DEMO_GRUPOS por carreraId match.
 *   - `sinGrupos` = filter carreras sin grupos asociados.
 * Edge:
 *   - **Comparación con `String()` coerce**: protege contra IDs numéricos
 *     vs string mismatch entre DEMO_CARRERAS y DEMO_GRUPOS.
 *   - **Hasta 4.C grupos no tienen carreraId**: `totalGrupos`=0 hasta migrate.
 *   - Función PURA.
 *   - Twin con `institucionesConteo` (15a.C).
 */
function carrerasConteo() {
    return {
        total:           DEMO_CARRERAS.length,
        instituciones:   new Set(DEMO_CARRERAS.map(c => c.institucionId).filter(x => x != null)).size,
        totalGrupos:     DEMO_CARRERAS.reduce(
            (s, c) => s + DEMO_GRUPOS.filter(g => String(g.carreraId) === String(c.id)).length,
            0
        ),
        sinGrupos:       DEMO_CARRERAS.filter(
            c => !DEMO_GRUPOS.some(g => String(g.carreraId) === String(c.id))
        ).length,
    };
}

/**
 * @interaction slug-y-next-id-carrera
 * @scope admin-carreras-helpers
 *
 * Given input string (clave o nombre) / DEMO_CARRERAS array global.
 * When `crearCarrera` necesita generar id determinista para nueva carrera.
 * Then 2 helpers combined:
 *   - `_slugCarrera(s)`: lowercase + NFD normalize + strip diacritics +
 *     replace non-alnum → '-' + trim leading/trailing dashes.
 *     Ej: 'ISC' → 'isc', 'Ingeniería en X' → 'ingenieria-en-x'.
 *   - `nextCarreraId(clave)`: slugifica clave → base. Si base no colide,
 *     retorna. Else incrementa sufijo `-2`, `-3`... hasta encontrar libre.
 * Edge:
 *   - **`_slugCarrera` retorna '' si input vacío** → fallback `car_${Date.now()}`.
 *   - **`nextCarreraId` determinista**: misma clave → mismo id (idempotente
 *     mientras DEMO_CARRERAS no cambie).
 *   - **Comparación con `String()` coerce** preserva identidad referencial.
 *   - Funciones PURAS.
 */
function _slugCarrera(s) {
    return String(s || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function nextCarreraId(clave) {
    const base = _slugCarrera(clave) || 'car_' + Date.now();
    if (!DEMO_CARRERAS.some(c => String(c.id) === base)) return base;
    let i = 2;
    while (DEMO_CARRERAS.some(c => String(c.id) === `${base}-${i}`)) i++;
    return `${base}-${i}`;
}

// ── Estado del filtro activo en la tabla ─────────────────
let _carrerasFiltro = { texto: "", institucionId: "todas" };

/**
 * @interaction build-carreras
 * @scope admin-carreras-entrypoint
 *
 * Given DOM admin tab Carreras montado.
 * When admin entra a tab Carreras o tras CRUD mutation.
 * Then entry orchestrator que invoca en cascada:
 *   1. `poblarFiltrosCarreras` (select institución).
 *   2. `_renderTablaCarreras` (tbody).
 *   3. `_actualizarContadorTablaCarreras` (subtitle KPI).
 *   4. `buildCarrerasResumen` (cards resumen con animación scale).
 * Edge:
 *   - **Sin DOM guards en orquestador**: cada sub-fn tiene su propio `if (!el) return`.
 *   - **Twin con `buildInstituciones`** (15a.C).
 *   - **Exportado window** implícito (consumer navigation).
 *   - Función IMPURA (DOM cascade).
 */
function buildCarreras() {
    poblarFiltrosCarreras();
    _renderTablaCarreras();
    _actualizarContadorTablaCarreras();
    buildCarrerasResumen();
}

/**
 * @interaction poblar-filtros-carreras
 * @scope admin-carreras-render-filtros
 *
 * Given DOM `#filtro-institucion-carrera` + DEMO_INSTITUCIONES global.
 * When `buildCarreras` orchestrator inicializa filtros.
 * Then:
 *   1. Extrae distinct `institucionId` de DEMO_CARRERAS (filtra null).
 *   2. Map id → nombre via `DEMO_INSTITUCIONES.find` (fallback `ID-${id}`).
 *   3. Renderea options: `"Todas"` + 1 por institución.
 *   4. Preserva valor seleccionado actual si sigue en lista.
 * Edge:
 *   - **Patrón data-derivado**: options reflejan estado actual JSON, no
 *     catalog estático. Twin con `poblarFiltrosInstituciones`.
 *   - **`_escapeHtml` canonical** en id + nombre (XSS).
 *   - **DOM ausente → no-op**.
 *   - Función IMPURA (DOM).
 */
function poblarFiltrosCarreras() {
    const sel = document.getElementById("filtro-institucion-carrera");
    if (!sel) return;

    const ids = [...new Set(DEMO_CARRERAS.map(c => c.institucionId).filter(x => x != null))];
    const nombrePorId = (id) => {
        const i = DEMO_INSTITUCIONES.find(x => String(x.id) === String(id));
        return i ? i.nombre : `ID-${id}`;
    };

    const valActual = sel.value;
    sel.innerHTML = `<option value="todas">Todas las instituciones</option>` +
        ids.map(id => `<option value="${_escapeHtml(id)}">${_escapeHtml(nombrePorId(id))}</option>`).join("");
    if ([...sel.options].some(o => o.value === valActual)) sel.value = valActual;
}

/**
 * @interaction render-tabla-carreras
 * @scope admin-carreras-render-tabla
 *
 * Given DOM `#carreras-tbody` + DEMO_CARRERAS/_INSTITUCIONES/_GRUPOS globales +
 *   `_carrerasFiltro` module-scope state.
 * When `buildCarreras` orquestrador o handler filtro reactivo dispara.
 * Then:
 *   1. Filter DEMO_CARRERAS por:
 *      - Texto (case-insensitive) en `nombre`/`clave`.
 *      - InstitucionId (`"todas"` o match exacto String coerce).
 *   2. Si vacío → empty state inline `.x-empty--inline`.
 *   3. Map por row: avatar emoji + nombre + ID-mono + badge clave +
 *      institución nombre + duracion `m` + count grupos + 2 botones Editar/Eliminar.
 * Edge:
 *   - **`String() coerce` en institucionId**: protege numérico vs string mismatch.
 *   - **`_escapeHtml` en nombre/clave/institucion**: XSS.
 *   - **`duracionMeses ?? 4` fallback** preserva schema sin breaking.
 *   - **`grupos` count derivado runtime** (deuda 4.B: 0 hasta migrate).
 *   - **DOM ausente → no-op**.
 *   - Función IMPURA (DOM masivo).
 */
function _renderTablaCarreras() {
    const el = document.getElementById("carreras-tbody");
    if (!el) return;

    const { texto, institucionId } = _carrerasFiltro;
    const filtradas = DEMO_CARRERAS.filter(c => {
        const txt = texto.toLowerCase();
        const coincideTexto = texto === "" ||
            (c.nombre || "").toLowerCase().includes(txt) ||
            (c.clave  || "").toLowerCase().includes(txt);
        const coincideInst = institucionId === "todas" || String(c.institucionId) === String(institucionId);
        return coincideTexto && coincideInst;
    });

    if (filtradas.length === 0) {
        el.innerHTML = `<tr><td colspan="6"><div class="x-empty x-empty--inline"><div class="x-empty__title">Sin resultados para la búsqueda actual</div></div></td></tr>`;
        return;
    }

    el.innerHTML = filtradas.map(c => {
        const inst = DEMO_INSTITUCIONES.find(i => String(i.id) === String(c.institucionId));
        const grupos = DEMO_GRUPOS.filter(g => String(g.carreraId) === String(c.id)).length;

        return `
        <tr id="carrera-row-${c.id}">
            <td>
                <div style="display:flex;align-items:center;gap:8px">
                    <div style="width:32px;height:32px;border-radius:var(--r-sm);background:var(--xahni-blue-dim);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">🎓</div>
                    <div>
                        <div style="font-weight:500;color:var(--text-primary)">${_escapeHtml(c.nombre)}</div>
                        <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono)">ID-${c.id}</div>
                    </div>
                </div>
            </td>
            <td><span class="badge blue" style="font-family:var(--font-mono)">${_escapeHtml(c.clave) || '—'}</span></td>
            <td style="color:var(--text-secondary)">${inst ? _escapeHtml(inst.nombre) : '—'}</td>
            <td><span class="badge" style="font-family:var(--font-mono);background:var(--surface-2);color:var(--text-secondary)">${c.duracionMeses ?? 4} m</span></td>
            <td><span style="font-family:var(--font-mono);color:var(--text-secondary)">${grupos}</span></td>
            <td>
                <div style="display:flex;gap:4px;flex-wrap:wrap">
                    <button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 8px" onclick="abrirEditarCarrera('${c.id}')">Editar</button>
                    <button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 8px;color:var(--xahni-red)" onclick="eliminarCarrera('${c.id}')">Eliminar</button>
                </div>
            </td>
        </tr>`;
    }).join("");
}

/**
 * @interaction actualizar-contador-tabla-carreras
 * @scope admin-carreras-kpi-subtitle
 *
 * Given DOM `#gestion-carreras-sub` + `carrerasConteo()` helper.
 * When CRUD mutation o filtro cambia → necesita refresh KPI subtitle.
 * Then escribe `"${total} carreras · ${instituciones} institución(es) · ${totalGrupos} grupos asociados"`.
 * Edge:
 *   - **DOM ausente → no-op**.
 *   - **Función IMPURA** (DOM).
 *   - Twin con `_actualizarContadorTablaInstituciones`.
 */
function _actualizarContadorTablaCarreras() {
    const sub = document.getElementById("gestion-carreras-sub");
    if (!sub) return;
    const c = carrerasConteo();
    sub.textContent = `${c.total} carreras · ${c.instituciones} institución(es) · ${c.totalGrupos} grupos asociados`;
}

// ── Búsqueda y filtros reactivos ──────────────────────────
/**
 * @interaction filtros-carreras-reactivos
 * @scope admin-carreras-handlers-filtros
 *
 * Given input/select cambia en tab Carreras.
 * When admin tipea en search box o selecciona institución filter.
 * Then 2 handlers combined:
 *   - `filtrarCarrerasBusqueda(valor)`: mutate `_carrerasFiltro.texto` →
 *     re-render tabla.
 *   - `filtrarCarrerasInstitucion(valor)`: mutate `_carrerasFiltro.institucionId` →
 *     re-render tabla.
 * Edge:
 *   - **State module-scope `_carrerasFiltro`** preserva filtro entre mutations.
 *   - **Re-render reactivo, no debounce**: típico DEMO performance OK.
 *   - **Exportado window** (onclick/oninput inline tabla).
 *   - Función IMPURA (DOM).
 */
function filtrarCarrerasBusqueda(valor)    { _carrerasFiltro.texto = valor; _renderTablaCarreras(); }
function filtrarCarrerasInstitucion(valor) { _carrerasFiltro.institucionId = valor; _renderTablaCarreras(); }

// ── Crear carrera ─────────────────────────────────────────
/**
 * @interaction crear-carrera
 * @scope admin-carreras-modal-crear
 *
 * Given DOM modal `modal-nueva-carrera` con 4 inputs.
 * When admin click "Crear" en modal.
 * Then async pipeline:
 *   1. Lee + trim + uppercase clave + parseInt duracion (1-60 clamp default 4).
 *   2. Validation: campos requeridos (nombre/clave/institucionId).
 *   3. Validation: nombre + clave únicos (case-insensitive).
 *   4. Genera id determinista via `nextCarreraId(clave)`.
 *   5. **`await DataService.saveCarrera({...})`** — persistencia centralizada
 *      (Bloqueante 4.B, 2026-05-16).
 *   6. Limpia inputs + close modal + re-render tabla + KPI + resumen + toast.
 * Edge:
 *   - **`institucionId` cast Number** si parseable (preserva ID numérico
 *     vs string mismatch DEMO vs prod).
 *   - **Duration clamp** `Math.max(1, Math.min(60, parseInt || 4))` defensive.
 *   - **Validations early-return con toast** sin throw.
 *   - **`selectedIndex = 0`** reset select institución (no `.value = ""`).
 *   - **Exportado window** (onclick inline modal).
 *   - Función IMPURA (DataService + DOM + module-scope).
 */
async function crearCarrera() {
    const nombre = document.getElementById("nueva-carrera-nombre")?.value.trim();
    const clave  = document.getElementById("nueva-carrera-clave")?.value.trim().toUpperCase();
    const institucionId = document.getElementById("nueva-carrera-institucion")?.value;
    const duracionRaw = document.getElementById("nueva-carrera-duracion")?.value;
    const duracionMeses = Math.max(1, Math.min(60, parseInt(duracionRaw) || 4));

    if (!nombre || !clave || !institucionId) {
        showToast("Por favor completa todos los campos", "error");
        return;
    }
    if (DEMO_CARRERAS.some(c => (c.nombre || "").toLowerCase() === nombre.toLowerCase())) {
        showToast("Ya existe una carrera con ese nombre", "error");
        return;
    }
    if (DEMO_CARRERAS.some(c => (c.clave || "").toUpperCase() === clave)) {
        showToast(`Ya existe una carrera con la clave "${clave}"`, "error");
        return;
    }

    const id = nextCarreraId(clave);
    await DataService.saveCarrera({
        id,
        nombre,
        clave,
        institucionId: isNaN(Number(institucionId)) ? institucionId : Number(institucionId),
        duracionMeses,
    });

    document.getElementById("nueva-carrera-nombre").value = "";
    document.getElementById("nueva-carrera-clave").value = "";
    const instSel = document.getElementById("nueva-carrera-institucion");
    if (instSel) instSel.selectedIndex = 0;
    const durInput = document.getElementById("nueva-carrera-duracion");
    if (durInput) durInput.value = "4";

    closeModal("modal-nueva-carrera");
    _renderTablaCarreras();
    _actualizarContadorTablaCarreras();
    buildCarrerasResumen();
    showToast(`Carrera ${nombre} creada correctamente`, "success");
}

// ── Editar carrera ────────────────────────────────────────
let _editandoCarreraId = null;

/**
 * @interaction abrir-editar-carrera
 * @scope admin-carreras-modal-editar-bootstrap
 *
 * Given id carrera + DOM modal `modal-editar-carrera` con 4 inputs.
 * When admin click "Editar" en row tabla.
 * Then:
 *   1. Lookup carrera (String coerce). Sin → silent return.
 *   2. Set `_editandoCarreraId` module-scope (cierre side-channel).
 *   3. **`_poblarSelectInstitucionesCarrera` ANTES de set value** (orden crítico).
 *   4. Prepobla 4 inputs (nombre/clave/institucion/duracion).
 *   5. `openModal` canonical.
 * Edge:
 *   - **Side-channel `_editandoCarreraId`**: `guardarEdicionCarrera` lo lee.
 *     Sin contención (1 modal a la vez).
 *   - **Orden `_poblar*` ANTES de `.value = c.institucionId`** crítico:
 *     options deben existir para que select acepte valor.
 *   - **`?? ""` y `?? 4` fallbacks** preservan UX.
 *   - **Exportado window** (onclick inline tabla).
 *   - Función IMPURA (DOM + module-scope).
 */
function abrirEditarCarrera(id) {
    const c = DEMO_CARRERAS.find(c => String(c.id) === String(id));
    if (!c) return;
    _editandoCarreraId = c.id;

    // Poblar el select de institución antes de fijar el valor
    _poblarSelectInstitucionesCarrera("editar-carrera-institucion");

    document.getElementById("editar-carrera-nombre").value = c.nombre || "";
    document.getElementById("editar-carrera-clave").value  = c.clave  || "";
    const instSel = document.getElementById("editar-carrera-institucion");
    if (instSel) instSel.value = c.institucionId ?? "";
    const durInput = document.getElementById("editar-carrera-duracion");
    if (durInput) durInput.value = c.duracionMeses ?? 4;

    openModal("modal-editar-carrera");
}

/**
 * @interaction guardar-edicion-carrera
 * @scope admin-carreras-modal-editar-submit
 *
 * Given `_editandoCarreraId` set + DOM modal con 4 inputs editados.
 * When admin click "Guardar" en modal editar.
 * Then async pipeline:
 *   1. Lookup carrera. Sin → silent return.
 *   2. Lee + trim + uppercase clave + clamp duracion.
 *   3. Validation: campos requeridos.
 *   4. Validation: nombre + clave únicos EXCLUYENDO self (`String(x.id) !== String(_editandoCarreraId)`).
 *   5. **`await DataService.saveCarrera({...id...})`** upsert.
 *   6. Close modal + re-render tabla + KPI + resumen + toast.
 * Edge:
 *   - **Validation excluye self** (no false-positive en edit que preserva nombre).
 *   - **Cast institucionId Number** si parseable.
 *   - **`_editandoCarreraId` no reset** post-save (silent leak OK, próximo abrir lo overwritea).
 *   - **Exportado window** (onclick inline modal).
 *   - Función IMPURA (DataService + DOM).
 */
async function guardarEdicionCarrera() {
    const c = DEMO_CARRERAS.find(c => String(c.id) === String(_editandoCarreraId));
    if (!c) return;

    const nombre = document.getElementById("editar-carrera-nombre")?.value.trim();
    const clave  = document.getElementById("editar-carrera-clave")?.value.trim().toUpperCase();
    const institucionId = document.getElementById("editar-carrera-institucion")?.value;
    const duracionRaw = document.getElementById("editar-carrera-duracion")?.value;
    const duracionMeses = Math.max(1, Math.min(60, parseInt(duracionRaw) || 4));

    if (!nombre || !clave || !institucionId) {
        showToast("Por favor completa todos los campos obligatorios", "error");
        return;
    }
    if (DEMO_CARRERAS.some(x => (x.nombre || "").toLowerCase() === nombre.toLowerCase() && String(x.id) !== String(_editandoCarreraId))) {
        showToast("Ya existe otra carrera con ese nombre", "error");
        return;
    }
    if (DEMO_CARRERAS.some(x => (x.clave || "").toUpperCase() === clave && String(x.id) !== String(_editandoCarreraId))) {
        showToast(`Ya existe otra carrera con la clave "${clave}"`, "error");
        return;
    }

    await DataService.saveCarrera({
        id: c.id,
        nombre,
        clave,
        institucionId: isNaN(Number(institucionId)) ? institucionId : Number(institucionId),
        duracionMeses,
    });

    closeModal("modal-editar-carrera");
    _renderTablaCarreras();
    _actualizarContadorTablaCarreras();
    buildCarrerasResumen();
    showToast(`Carrera ${nombre} actualizada correctamente`, "success");
}

// ── Eliminar carrera (con guardia FK) ─────────────────────
/**
 * @interaction eliminar-carrera
 * @scope admin-carreras-handler-async
 *
 * Given id carrera + DOM tabla con row.
 * When admin click "Eliminar" en row.
 * Then async pipeline:
 *   1. Lookup carrera. Sin → silent return.
 *   2. `confirmarCanonico` modal danger con `_escapeHtml` en nombre.
 *   3. Si cancel → return.
 *   4. **`await DataService.deleteCarrera(id)`** dentro de try/catch:
 *      - `err.code === 'CARRERA_IN_USE'` → toast con mensaje server-side
 *        (guardia FK: grupos asociados bloquean).
 *      - Otro err → toast con mensaje genérico.
 *   5. Re-render tabla + KPI + resumen + toast info.
 * Edge:
 *   - **Guardia FK server-side** (DataService) → toast amigable cliente.
 *   - **`confirmarCanonico` canonical** modal genérico danger.
 *   - **Try/catch ANTES de re-render**: si error, no muta UI.
 *   - **Exportado window** (onclick inline tabla).
 *   - Función IMPURA (DataService + DOM).
 */
async function eliminarCarrera(id) {
    const c = DEMO_CARRERAS.find(c => String(c.id) === String(id));
    if (!c) return;
    const nombre = c.nombre;

    const ok = await confirmarCanonico({
        titulo: "Eliminar carrera",
        mensaje: `¿Eliminar la carrera <strong>${_escapeHtml(nombre)}</strong>? Esta acción no se puede deshacer.`,
        accionTexto: "Eliminar",
        tipo: "danger",
    });
    if (!ok) return;

    try {
        await DataService.deleteCarrera(c.id);
    } catch (err) {
        if (err && err.code === 'CARRERA_IN_USE') {
            showToast(err.message, "error");
        } else {
            showToast(`Error inesperado: ${err?.message || err}`, "error");
        }
        return;
    }

    _renderTablaCarreras();
    _actualizarContadorTablaCarreras();
    buildCarrerasResumen();
    showToast(`Carrera ${nombre} eliminada del sistema.`, "info");
}

// ── Helper: poblar select de instituciones en modales ────
/**
 * @interaction poblar-select-instituciones-carrera
 * @scope admin-carreras-helpers-modal
 *
 * Given selectId + DEMO_INSTITUCIONES global.
 * When modal crear/editar carrera necesita populate dropdown instituciones.
 * Then renderea options: placeholder `"— Selecciona institución —"` +
 *   1 option por institución (id + nombre).
 * Edge:
 *   - **DOM ausente → no-op**.
 *   - **`_escapeHtml` en id + nombre** (XSS).
 *   - **Re-render destructivo** (innerHTML overwrite) → consumer debe
 *     re-set value DESPUÉS si necesita.
 *   - Función IMPURA (DOM).
 *   - Reutilizado en modal crear + editar carreras (DRY).
 */
function _poblarSelectInstitucionesCarrera(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = `<option value="">— Selecciona institución —</option>` +
        DEMO_INSTITUCIONES.map(i => `<option value="${_escapeHtml(i.id)}">${_escapeHtml(i.nombre)}</option>`).join("");
}

// ── Construir tarjetas de resumen ─────────────────────────
/**
 * @interaction build-carreras-resumen
 * @scope admin-carreras-render-resumen
 *
 * Given DOM `#carreras-resumen` + `carrerasConteo()` helper.
 * When `buildCarreras` orquestrador o post-mutation refresh.
 * Then 2-fase animation:
 *   1. Set opacity 0.6 + scale 0.98 (fade out).
 *   2. `setTimeout 150ms` → renderea 4 `.metric-card` (total, totalGrupos,
 *      sinGrupos, promedio grupos/carrera) → transition all 0.3s + opacity 1 + scale 1.
 * Edge:
 *   - **Animación CSS inline** (no class swap): preserva isolation.
 *   - **TODO post-migración**: cementar tokens `.metric-card` legacy → `.x-stat`.
 *   - **`Math.round(... * 10) / 10`** preserva 1 decimal en promedio.
 *   - **DOM ausente → no-op**.
 *   - Función IMPURA (DOM + setTimeout async).
 *   - Twin con `buildInstitucionesResumen`.
 */
function buildCarrerasResumen() {
    const el = document.getElementById("carreras-resumen");
    if (!el) return;

    const c = carrerasConteo();
    el.style.opacity = "0.6";
    el.style.transform = "scale(0.98)";

    setTimeout(() => {
        el.innerHTML = `
            <div class="metric-card blue">
                <div class="metric-icon blue">🎓</div>
                <div class="metric-value">${c.total}</div>
                <div class="metric-label">Total carreras</div>
                <div class="metric-delta neutral">
                    ${c.instituciones} institución(es)
                </div>
            </div>
            <div class="metric-card teal">
                <div class="metric-icon teal">👨‍👩‍👧‍👦</div>
                <div class="metric-value">${c.totalGrupos}</div>
                <div class="metric-label">Grupos asociados</div>
                <div class="metric-delta neutral">Distribuidos en ${c.total} carreras</div>
            </div>
            <div class="metric-card amber">
                <div class="metric-icon amber">⚠️</div>
                <div class="metric-value">${c.sinGrupos}</div>
                <div class="metric-label">Carreras sin grupos</div>
                <div class="metric-delta neutral">Requieren asignación</div>
            </div>
            <div class="metric-card purple">
                <div class="metric-icon purple">📊</div>
                <div class="metric-value">${c.total > 0 ? Math.round(c.totalGrupos / c.total * 10) / 10 : 0}</div>
                <div class="metric-label">Grupos / carrera</div>
                <div class="metric-delta neutral">Promedio</div>
            </div>
        `;
        el.style.transition = "all 0.3s ease";
        el.style.opacity = "1";
        el.style.transform = "scale(1)";
    }, 150);
}
