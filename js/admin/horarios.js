// ═══════════════════════════════════════════════════════════
// GESTIÓN DE HORARIOS — Módulo Admin
// CRUD + calendario semanal + detección de conflictos.
//
// FUENTE DE DATOS: derivada de DEMO_MATERIAS.horario[].
// El esquema canónico embebe horario[] en la materia
// ({dia, inicio, fin, salon}). Aquí se aplana a registros
// virtuales con id sintético `hor_<materiaId>_<slotIdx>` para
// que el renderer y los handlers CRUD existentes funcionen sin
// reescribirse. Las mutaciones (crear/editar/eliminar) se
// persisten via DataService.saveMateria con el horario[]
// recompuesto — Firestore actualiza el documento materia
// completo (Bloqueante 2, 2026-05-15).
//
// DEUDA Phase B: el schema canónico de horario[] no incluye
// profesorId/institucionId/activo (los hereda de la materia o
// no existen). El renderer cae con valores por defecto. Cerrar
// cuando se decida enriquecer schema o extender data-service.
// ═══════════════════════════════════════════════════════════

// ── Estado del módulo ───────────────────────────────────────
// Filtros: cadena vacía = "Ninguno seleccionado". El calendario y la tabla
// solo renderizan cuando hay un grupo seleccionado (que a su vez requiere
// institución previa). Evita el sobrelapamiento visual al mezclar horarios
// de distintos grupos/instituciones en una misma cuadrícula.
let HORARIOS_FILTROS = {
    institucion: "",
    grupo: "",
    busqueda: "",
};

let horarioEditando = null;

// ── Normalización de día (data: "lunes" → renderer: "Lunes") ─
const _DIA_DISPLAY = {
    lunes: "Lunes", martes: "Martes",
    miercoles: "Miércoles", "miércoles": "Miércoles",
    jueves: "Jueves", viernes: "Viernes",
    sabado: "Sábado", "sábado": "Sábado",
    domingo: "Domingo",
};
const _DIA_KEY = {
    "Lunes": "lunes", "Martes": "martes", "Miércoles": "miercoles",
    "Jueves": "jueves", "Viernes": "viernes", "Sábado": "sabado", "Domingo": "domingo",
};

/**
 * @interaction horarios-helpers-dia-display
 * @scope admin-horarios-helpers-display
 *
 * Given input string día (raw data lowercase: "lunes" / "miercoles" / "sábado")
 * o display capitalizado ("Lunes") + 2 lookup tables const `_DIA_DISPLAY` +
 * `_DIA_KEY` module-scope.
 * When `_horariosFlat` deriva slots de DEMO_MATERIAS o `editarHorario`
 * pre-llena el modal con día display capitalizado.
 * Then `_diaDisplay(d)` normaliza a forma display:
 *   1. Lookup directo en `_DIA_DISPLAY[d]` (cubre raw lowercase + Miércoles/Sábado con acento).
 *   2. Fallback lookup `_DIA_DISPLAY[d.toLowerCase()]` (cubre casing variable).
 *   3. Fallback final `d` literal (preserva input desconocido sin crashear).
 * Edge:
 *   - **`_DIA_DISPLAY` dual key**: `"miercoles"` (sin acento, raw demo seed) +
 *     `"miércoles"` (con acento, variant defensiva si data viene editada manualmente).
 *     Same para sábado.
 *   - **`_DIA_KEY` reverse lookup** display→raw para serialización en
 *     `guardarHorario` antes de persistir (raw data normalizado lowercase
 *     sin acentos por convención DB).
 *   - **NO domingo en `_DIA_KEY` reverse?** Sí está. Pero calendario semanal
 *     solo renderea Lunes-Sábado (no domingo) — gap UI deliberado (no clase
 *     domingo).
 *   - **`(d || "")`** guard contra null/undefined que crashearía `.toLowerCase()`.
 *   - Función PURA.
 *   - **Pattern único admin**: normalización display↔raw via 2 lookup tables
 *     const. Otros archivos admin no manejan i18n parcial / casing variable.
 */
function _diaDisplay(d) { return _DIA_DISPLAY[d] || _DIA_DISPLAY[(d || "").toLowerCase()] || d; }

// ── Derivación: aplana DEMO_MATERIAS.horario[] a registros virtuales
// Cada slot trae grupoId (schema rework 2026-05-15): una misma materia puede
// tener varios slots con distinto grupo y distinto horario (cada grupo
// recibe la materia en su propia sesión).
/**
 * @interaction horarios-derivacion-virtual-flat
 * @scope admin-horarios-derivacion-virtual
 *
 * Given DEMO_MATERIAS array global (cada materia con `.horario[]` embebido).
 * When CUALQUIER consumer del módulo necesita iterar horarios (`filtrarHorarios`,
 * `verificarConflictos`, `detectarConflictosGlobales`, `buildHorariosResumen`)
 * o resolver un horario individual (`_resolverHorario`).
 * Then aplana materia.horario[] a array de registros virtuales con shape:
 *   ```
 *   {
 *     id: "hor_<materiaId>_<slotIdx>",  // sintético
 *     _materiaRef: m,                   // ref backpointer
 *     _slotIdx: idx,                    // posición en materia.horario[]
 *     materiaId, materiaNombre, profesorId,
 *     grupoId,                          // schema 2026-05-15
 *     institucionId,                    // derivado vía _institucionIdDePorGrupo
 *     dia: _diaDisplay(h.dia),          // capitalizado para renderer
 *     horaInicio: h.inicio, horaFin: h.fin, aula: h.salon,
 *     activo: h.activo !== false,       // default true defensivo
 *   }
 *   ```
 * Edge:
 *   - **Pattern crítico ÚNICO admin**: derivación virtual de entidad embebida.
 *     NO hay entidad "horario" top-level en DEMO_*; vive embebida en
 *     materia.horario[]. Esta función es el "puente" que finge entidades
 *     planas para que el renderer + handlers CRUD existentes funcionen sin
 *     reescribirse.
 *   - **id sintético `hor_<materiaId>_<slotIdx>`**: composición admite
 *     materiaIds con cualquier carácter (string "bd", número 5). `_resolverHorario`
 *     parsea con regex greedy `^hor_(.+)_(\d+)$`.
 *   - **Schema rework 2026-05-15 grupoId-en-slot**: cada slot embebe `grupoId`
 *     para que una misma materia tenga varios slots con distinto grupo (cada
 *     grupo recibe la materia en su propia sesión). Detonó la regla
 *     "mismo profesor, misma materia, distinto grupo" en detección conflictos.
 *   - **`institucionId` derivada vía `_institucionIdDePorGrupo`**: cadena
 *     grupo→carrera→institución (helper `getGrupoInstitucion` js/core/modelo.js).
 *     No vive en el slot — recompuesta en cada llamada (cost O(N×G) por flat).
 *   - **DEUDA Phase B documentada en cabecera archivo**: profesorId vive en
 *     materia (heredado), institucionId no existe en schema slot, activo
 *     default true. Renderer cae con defaults.
 *   - **`_materiaRef` + `_slotIdx` backpointer**: permite a `_resolverHorario`
 *     localizar el slot original sin re-buscar (overflow performance: cada
 *     `_horariosFlat()` reconstruye).
 *   - **Costo O(M × H)**: M=materias, H=slots avg. Recomputed en cada llamada
 *     (sin cache) — performance OK para DEMO scale; post-Supabase considerar
 *     memoización con invalidación por watch.
 *   - **`activo !== false`** treats missing/null as activo true (regla
 *     defensiva del schema Phase B).
 *   - Función PURA (no muta DEMO_MATERIAS — flatMap + map).
 *   - **Pattern único admin** — sin twin.
 */
function _horariosFlat() {
    return DEMO_MATERIAS.flatMap(m =>
        (m.horario || []).map((h, idx) => ({
            id: `hor_${m.id}_${idx}`,
            _materiaRef: m,
            _slotIdx: idx,
            materiaId: m.id,
            materiaNombre: m.nombre,
            profesorId: m.profesorId,
            grupoId: h.grupoId || null,
            institucionId: _institucionIdDePorGrupo(h.grupoId),
            dia: _diaDisplay(h.dia),
            horaInicio: h.inicio,
            horaFin: h.fin,
            aula: h.salon,
            activo: h.activo !== false,
        }))
    );
}

/**
 * @interaction horarios-resolver-id-sintetico
 * @scope admin-horarios-resolver-lookup
 *
 * Given grupoId (string|null) o id sintético `hor_<materiaId>_<slotIdx>` +
 * DEMO_GRUPOS + DEMO_MATERIAS globales + helper `getGrupoInstitucion` (js/core/modelo.js).
 * When `_horariosFlat` deriva institucionId por slot, o cualquier handler CRUD
 * (`editarHorario` / `toggleEstadoHorario` / `eliminarHorario` / `guardarHorario`
 * en branch edit) necesita resolver materia+slot desde id sintético.
 * Then 2 helpers combined lookup:
 *   - `_institucionIdDePorGrupo(grupoId)`:
 *     1. Si !grupoId → null silent.
 *     2. Find grupo en DEMO_GRUPOS por `g.id === grupoId` (no String() coerce).
 *     3. Aplica cadena grupo→carrera→institución via `getGrupoInstitucion(g)?.id`.
 *     4. Doble nullish `?? null` defensivo.
 *   - `_resolverHorario(id)`:
 *     1. Regex `^hor_(.+)_(\d+)$` greedy parse del id sintético. Si no match → null.
 *     2. Captura materiaIdRaw (group 1) + slotIdx (group 2, parseInt base 10).
 *     3. Find materia por `String(x.id) === materiaIdRaw` (coerce defensivo).
 *     4. Valida materia + `Array.isArray(materia.horario)` + `materia.horario[slotIdx]`
 *        exists. Si algún check falla → null.
 *     5. Retorna `{materia, slotIdx, slot}` (estructura usada por handlers
 *        para `DataService.saveMateria` con horario[] recompuesto).
 * Edge:
 *   - **`_institucionIdDePorGrupo` SIN `String()` coerce** en find — asume
 *     grupoId siempre string. Asimétrico con `_resolverHorario`. Deuda: si
 *     algún día DEMO_GRUPOS migra a ids numéricos, esta función falla silent.
 *   - **`_resolverHorario` regex `.+` greedy** captura ids con `_` (ej.
 *     "mat_001_2026" → materiaId="mat_001_2026", slotIdx=NaN — wait, greedy
 *     toma todo hasta el ÚLTIMO `_<digits>$`). Funciona porque slotIdx debe
 *     ser entero al final.
 *   - **String() coerce** en find materia evita falso negativo cuando
 *     materia.id es número (5) y regex extrajo string "5".
 *   - **`slotIdx` puede ser 0**: validación `materia.horario[slotIdx]` no
 *     usa truthy check — usa lookup directo (correcto para idx 0 valid).
 *   - **Retorna null en TODOS los failure paths** — handlers consumen con
 *     `if (!ref) { showToast / silent return }`.
 *   - **NO usa cache**: cada `_resolverHorario` re-busca. Performance OK por
 *     scale; post-Supabase memoizar si N>1000.
 *   - **`_horariosFlat` invoca `_institucionIdDePorGrupo` POR slot** → cost
 *     O(H × G) donde H=slots y G=grupos. Aceptable DEMO.
 *   - Funciones PURAS (lookups + parse, no mutaciones).
 *   - **Pattern único admin** — id sintético `hor_*` no existe en otras
 *     entidades admin (todas tienen id propio top-level).
 */
function _institucionIdDePorGrupo(grupoId) {
    if (!grupoId) return null;
    const g = (DEMO_GRUPOS || []).find(g => g.id === grupoId);
    return g ? (getGrupoInstitucion(g)?.id ?? null) : null;
}

// Localiza el registro derivado por id sintético `hor_<materiaId>_<slotIdx>`.
// materiaId puede ser string ("bd") o number (5) — el regex usa .+ greedy
// para capturar ids con cualquier carácter; comparación por String(...).
function _resolverHorario(id) {
    const m = id.match(/^hor_(.+)_(\d+)$/);
    if (!m) return null;
    const materiaIdRaw = m[1];
    const slotIdx = parseInt(m[2], 10);
    const materia = DEMO_MATERIAS.find(x => String(x.id) === materiaIdRaw);
    if (!materia || !Array.isArray(materia.horario) || !materia.horario[slotIdx]) return null;
    return { materia, slotIdx, slot: materia.horario[slotIdx] };
}

// ── buildHorariosView ────────────────────────────────────────
/**
 * @interaction build-horarios-view-entry
 * @scope admin-horarios-entrypoint
 *
 * Given APP.user logged in + DOM admin tab Horarios montado.
 * When admin entra a tab Horarios o tras CRUD mutation (`guardarHorario` /
 * `toggleEstadoHorario` / `eliminarHorario` lo invocan al final).
 * Then:
 *   1. **Guard de rol**: si APP.user no es "administrador" → silent return.
 *      Único entry admin que valida rol explícitamente (defensa contra invocación
 *      cross-rol — alumno/profesor no tienen acceso a este módulo).
 *   2. Entry orchestrator que invoca en cascada:
 *      - `poblarFiltrosHorarios` (popula select institución + cascada grupo).
 *      - `buildHorariosResumen` (4 metric-cards con animación cubic-bezier).
 *      - `buildCalendarioSemanal` (grid 6×14, empty si !grupo).
 *      - `buildHorariosTabla` (tabla, empty si !grupo).
 * Edge:
 *   - **Guard rol único en admin entrypoints**: 15a/15b otros entrypoints
 *     (`buildCarreras`, `buildClasificaciones`, `buildMateriasAdmin`) NO
 *     validan APP.user.tipo (asumen montaje correcto vía navigation.js).
 *     Asimetría defensiva — quizá histórica (tab inicial del admin tras
 *     login? deuda menor: unificar pattern).
 *   - **Sin DOM guards en orquestador**: cada sub-fn tiene `if (!el) return`.
 *   - **NO sincroniza KPIs cross-módulo** (asimetría con materias 15b.B):
 *     no hay entry "Horarios" en `ADMIN_MODULOS_DATA` → KPIs admin
 *     dashboard NO reflejan conteo horarios. Deuda post-Supabase agregar
 *     tarjeta + sync.
 *   - **Re-llamado post-CRUD**: cada handler async invoca `buildHorariosView()`
 *     al final → re-render completo (4 cascada). Costo OK por scale.
 *   - **Orden cascada importante**: poblar filtros PRIMERO (sin pintar tabla
 *     sin select grupo poblado).
 *   - Función IMPURA (DOM cascade).
 *   - Twin con `buildCarreras` (15a.B), `buildInstituciones` (15a.C),
 *     `buildClasificaciones` (15b.A), `buildMateriasAdmin` (15b.B) — pero
 *     con guard rol único + sin _sincronizar*.
 */
function buildHorariosView() {
    if (!APP.user || APP.user.tipo !== "administrador") return;
    poblarFiltrosHorarios();
    buildHorariosResumen();
    buildCalendarioSemanal();
    buildHorariosTabla();
}

// ── Pobla los selects de institución / grupo desde DEMO_* ────
// El select de grupo queda deshabilitado hasta que se elija institución;
// al elegirla, se filtra a los grupos cuya institución (derivada vía
// grupo→carrera→institución, helper en js/core/modelo.js) coincide.
/**
 * @interaction horarios-poblar-filtros-cascada-gating
 * @scope admin-horarios-poblar-filtros
 *
 * Given DOM `#horarios-filtro-institucion` + `#horarios-filtro-grupo` +
 * `HORARIOS_FILTROS` module-scope + DEMO_INSTITUCIONES + DEMO_GRUPOS globales
 * + helper `getGrupoInstitucion` (js/core/modelo.js).
 * When `buildHorariosView` orchestrator inicializa filtros, o
 * `aplicarFiltroHorarios` branch institución cambia → repuebla grupos.
 * Then 2 populadores combined con gating cascada:
 *   - `poblarFiltrosHorarios()`:
 *     1. DOM guard ambos selects.
 *     2. Render `<option>` institución: `"Ninguno seleccionado"` + 1 por
 *        DEMO_INSTITUCIONES. Marca `selected` si match con `HORARIOS_FILTROS.institucion`.
 *     3. Invoca `poblarGruposPorInstitucion()` cascada.
 *   - `poblarGruposPorInstitucion()`:
 *     1. DOM guard select grupo.
 *     2. Si `!HORARIOS_FILTROS.institucion` → render `"Ninguno seleccionado"`
 *        + `disabled = true` (gating UX: no se puede elegir grupo sin institución).
 *     3. Filter DEMO_GRUPOS por cadena grupo→carrera→institución (helper
 *        `getGrupoInstitucion(g)?.id` con `String()` coerce).
 *     4. `disabled = grupos.length === 0` (gating UX: institución sin grupos).
 *     5. Render `<option>` por cada grupo filtrado. Marca `selected` si match
 *        con `HORARIOS_FILTROS.grupo` (NO String() coerce — asume string consistente).
 * Edge:
 *   - **Pattern gating cascada institución→grupo**: previene estado inválido
 *     "grupo de institución X mientras filtro institución es Y".
 *     `aplicarFiltroHorarios` branch institución resetea `HORARIOS_FILTROS.grupo=""`
 *     antes de repoblar (consistencia).
 *   - **Cadena grupo→carrera→institución vía `getGrupoInstitucion`**: helper
 *     compartido js/core/modelo.js. Asume `grupo.carreraId` → carrera.institucionId.
 *     Si cadena rota → grupo no aparece en lista.
 *   - **`disabled` UX cue**: select queda greyed out hasta condición cumplida.
 *   - **Preservación de selección**: el option marcado `selected` se decide
 *     en la concatenación HTML — no usa `sel.value = ...` post-render.
 *     Performance OK; equivalente.
 *   - **`String()` coerce solo en institución match**, no en grupo match.
 *     Asimetría defensiva — probablemente histórica.
 *   - **Sin handler `onChange` del select**: el wire es vía HTML `onchange="aplicarFiltroHorarios('institucion', this.value)"`.
 *   - Funciones IMPURAS (DOM write + cascade).
 *   - **Pattern único admin**: gating cascada con `disabled`. Otros archivos
 *     populan filtros independientes sin gating.
 */
function poblarFiltrosHorarios() {
    const instSel = document.getElementById("horarios-filtro-institucion");
    const grupoSel = document.getElementById("horarios-filtro-grupo");
    if (!instSel || !grupoSel) return;

    const instValor = HORARIOS_FILTROS.institucion;
    instSel.innerHTML = '<option value="">Ninguno seleccionado</option>' +
        (DEMO_INSTITUCIONES || [])
            .map(i => `<option value="${_escapeHtml(i.id)}"${String(i.id) === String(instValor) ? " selected" : ""}>${_escapeHtml(i.nombre)}</option>`)
            .join("");

    poblarGruposPorInstitucion();
}

function poblarGruposPorInstitucion() {
    const grupoSel = document.getElementById("horarios-filtro-grupo");
    if (!grupoSel) return;

    const instId = HORARIOS_FILTROS.institucion;
    if (!instId) {
        grupoSel.innerHTML = '<option value="">Ninguno seleccionado</option>';
        grupoSel.disabled = true;
        return;
    }

    // Filtro vía cadena grupo → carrera → institución (helper en js/core/modelo.js).
    const grupos = (DEMO_GRUPOS || []).filter(g => String(getGrupoInstitucion(g)?.id) === String(instId));
    grupoSel.disabled = grupos.length === 0;
    grupoSel.innerHTML = '<option value="">Ninguno seleccionado</option>' +
        grupos.map(g => `<option value="${_escapeHtml(g.id)}"${g.id === HORARIOS_FILTROS.grupo ? " selected" : ""}>${_escapeHtml(g.nombre)}</option>`).join("");
}

// ── Tarjetas de resumen ──────────────────────────────────────
/**
 * @interaction horarios-resumen-4-metric-cards-color-coded
 * @scope admin-horarios-resumen
 *
 * Given DOM `#horarios-resumen` + `_horariosFlat()` + `detectarConflictosGlobales()`.
 * When `buildHorariosView` o tras CRUD mutation lo invocan.
 * Then:
 *   1. Compute 4 stats: `total` (count flat), `activos` (filter h.activo),
 *      `aulas` (Set distinct h.aula filter Boolean), `conflictos`
 *      (`detectarConflictosGlobales()`).
 *   2. Fade-out fase 1: opacity 0 + translateY(8px).
 *   3. Renderea 4 metric-cards:
 *      - **blue**: 📅 horarios totales.
 *      - **teal**: ✅ activos.
 *      - **purple**: 🏫 aulas en uso.
 *      - **`red` if conflictos>0 ELSE `amber`**: ⚠️ conflictos (color-coding dinámico).
 *   4. `setTimeout 50ms` fase 2: transition cubic-bezier overshoot
 *      `(0.34, 1.56, 0.64, 1)` + opacity 1 + translateY 0.
 * Edge:
 *   - **Color-coding dinámico card conflictos**: rojo si N>0 (alerta) /
 *     amber si N=0 (estado saludable neutral). Único en admin con
 *     color-coding dinámico — otros (clasifs/carreras/etc.) usan colores
 *     fijos por card.
 *   - **Animación cubic-bezier overshoot** distinta a otros resúmenes admin
 *     (`buildClasificacionesResumen` usa scale(0.98)→1 ease estándar).
 *     Overshoot da efecto bounce visual (pedagógico: cambios destacan).
 *   - **`detectarConflictosGlobales` cost O(H²)**: itera `_horariosFlat()`
 *     y por cada horario activo invoca `tieneConflicto` → `verificarConflictos`
 *     → otro `_horariosFlat()`. Cuadrático. Performance OK por scale DEMO;
 *     post-Supabase memoizar.
 *   - **Set distinct aulas filter Boolean** elimina null/empty (slot sin aula).
 *   - **DOM guard `if (!el) return`** silent no-op.
 *   - **Animación CSS inline** (style.opacity/transform) — deuda futura:
 *     class swap canonical + tokens `.metric-card` legacy → `.x-stat`.
 *   - Función IMPURA (DOM write + setTimeout async cascade + read globals).
 *   - Twin con `buildCarrerasResumen` (15a.B) / `buildClasificacionesResumen` (15b.A) /
 *     `buildMateriasResumen` (15b.B), pero con color-coding dinámico + animación overshoot.
 */
function buildHorariosResumen() {
    const el = document.getElementById("horarios-resumen");
    if (!el) return;

    const horarios = _horariosFlat();
    const total = horarios.length;
    const activos = horarios.filter(h => h.activo).length;
    const aulas = [...new Set(horarios.map(h => h.aula).filter(Boolean))].length;
    const conflictos = detectarConflictosGlobales();

    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";

    el.innerHTML = `
        <div class="metric-card blue">
            <div class="metric-icon blue">📅</div>
            <div class="metric-value">${total}</div>
            <div class="metric-label">Horarios totales</div>
        </div>
        <div class="metric-card teal">
            <div class="metric-icon teal">✅</div>
            <div class="metric-value">${activos}</div>
            <div class="metric-label">Activos</div>
        </div>
        <div class="metric-card purple">
            <div class="metric-icon purple">🏫</div>
            <div class="metric-value">${aulas}</div>
            <div class="metric-label">Aulas en uso</div>
        </div>
        <div class="metric-card ${conflictos > 0 ? 'red' : 'amber'}">
            <div class="metric-icon ${conflictos > 0 ? 'red' : 'amber'}">⚠️</div>
            <div class="metric-value">${conflictos}</div>
            <div class="metric-label">Conflictos</div>
        </div>
    `;

    setTimeout(() => {
        el.style.transition = "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)";
        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
    }, 50);
}

// ── Calendario semanal ────────────────────────────────────────
/**
 * @interaction horarios-calendario-semanal-grid
 * @scope admin-horarios-calendario-grid
 *
 * Given DOM `#calendario-semanal` + `HORARIOS_FILTROS.grupo` + helpers
 * `filtrarHorarios` + `horaEnRango` + `renderClaseEnCalendario`.
 * When `buildHorariosView` o tras CRUD mutation lo invoca.
 * Then:
 *   1. DOM guard.
 *   2. **Gating empty state**: si !grupo seleccionado → render `.x-empty`
 *      con icon 📅 + título pidiendo institución+grupo.
 *   3. Constantes locales: `dias` = ["Lunes"..."Sábado"] (6 días, NO domingo),
 *      `horas` = ["07:00"..."20:00"] (14 horas).
 *   4. `filtrarHorarios()` aplica filtros activos (grupo + busqueda).
 *   5. Renderea grid:
 *      - `<.calendario-header>` con col vacía hora + 6 headers día.
 *      - `<.calendario-body>` con 14 filas (1 por hora), cada fila tiene
 *        `--delay:${idx * 0.02}s` para animación escalonada.
 *      - Por cada fila: label hora + 6 celdas (1 por día). Celda contiene
 *        bloques de clases que matchean día+hora rango.
 *      - **Bloques únicos por clase**: `renderClaseEnCalendario` solo renderea
 *        en `esInicio` (primera celda que la clase atraviesa) — evita duplicar.
 *        `--duracion` CSS prop maneja altura visual extendida.
 * Edge:
 *   - **Gating dual** con `buildHorariosTabla` (ambos requieren grupo).
 *     Decisión de UI: sin grupo NO renderean nada (evita sobrelapamiento
 *     visual de horarios cross-grupo en misma cuadrícula).
 *   - **Lunes-Sábado fijo** (sin domingo). Decisión deliberada del producto.
 *     Si algún día se admiten clases dominicales → ampliar constante.
 *   - **Rango horas 07-20 fijo** (14 horas, NO 21+). Cubre día académico
 *     estándar UTC; rango fuera no se renderea (gap UI). Deuda menor:
 *     hacer configurable por institución.
 *   - **`--delay` escalonado** (0.02s * idx): animación stagger CSS via
 *     custom prop. Sutil, perceptible solo en primera carga.
 *   - **`horaEnRango(hora, inicio, fin)` filtra clases POR HORA**: incluye
 *     clase si su rango cubre la hora actual (incluye inicio, excluye fin).
 *     Lookup O(H × D × Hr) — cuadrático en filas × clases. Performance OK
 *     por scale.
 *   - **`renderClaseEnCalendario` retorna `""` si !esInicio**: la celda recibe
 *     string vacío (no skip render — DOM tiene celda vacía). El bloque visual
 *     vive en una sola celda con altura `--duracion` × cell-height.
 *   - Función IMPURA (DOM write).
 *   - **Pattern único admin** — sin twin (otros usan tablas planas).
 */
function buildCalendarioSemanal() {
    const el = document.getElementById("calendario-semanal");
    if (!el) return;

    // Solo renderiza cuando hay grupo (que a su vez requiere institución).
    if (!HORARIOS_FILTROS.grupo) {
        el.innerHTML = `<div class="x-empty">
            <div class="x-empty__icon">📅</div>
            <div class="x-empty__title">Selecciona una institución y un grupo para visualizar el calendario</div>
        </div>`;
        return;
    }

    const dias = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const horas = ["07:00","08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00"];

    const horariosFiltrados = filtrarHorarios();

    el.innerHTML = `
        <div class="calendario-header">
            <div class="calendario-hora-col"></div>
            ${dias.map(d => `<div class="calendario-dia-header">${d}</div>`).join("")}
        </div>
        <div class="calendario-body">
            ${horas.map((hora, idx) => `
                <div class="calendario-fila" style="--delay:${idx * 0.02}s">
                    <div class="calendario-hora-label">${hora}</div>
                    ${dias.map(dia => {
                        const clasesEnHora = horariosFiltrados.filter(h =>
                            h.dia === dia && horaEnRango(hora, h.horaInicio, h.horaFin)
                        );
                        return `<div class="calendario-celda" data-dia="${dia}" data-hora="${hora}">
                            ${clasesEnHora.map(c => renderClaseEnCalendario(c, hora)).join("")}
                        </div>`;
                    }).join("")}
                </div>
            `).join("")}
        </div>
    `;
}

/**
 * @interaction horarios-helpers-tiempo-matematicos
 * @scope admin-horarios-helpers-tiempo
 *
 * Given input strings tipo "HH:MM" o "HH" (hora individual) o 2 horarios `h1`/`h2`
 * con `horaInicio`/`horaFin`.
 * When `buildCalendarioSemanal` filtra clases por hora actual, o
 * `renderClaseEnCalendario` calcula altura visual via `--duracion`, o
 * `verificarConflictos` detecta superposición temporal.
 * Then 3 helpers matemáticos combined:
 *   - `horaEnRango(hora, inicio, fin)`: returns true si hora ∈ [inicio, fin).
 *     - `parseInt(s.split(":")[0])` extrae hora entera ignorando minutos.
 *     - `h >= hInicio && h < hFin` inclusivo inicio, exclusivo fin.
 *   - `calcularDuracionHoras(inicio, fin)`: returns `hFin - hInicio` (enteros).
 *     - Used como `--duracion` CSS prop (altura visual = duracion × cell-height).
 *   - `horariosSeSuperponen(h1, h2)`: returns true si rangos temporales overlap.
 *     - **Algoritmo overlap**: `(inicio1 < fin2 && fin1 > inicio2)` — equivalente
 *       a "NO (h1 termina antes que h2 empiece OR h1 empieza después que h2 termine)".
 *     - `parseInt((h.horaInicio || "0:0").replace(":", ""))` convierte "08:30" → 830
 *       (representación numérica directa para comparación).
 * Edge:
 *   - **`horaEnRango` ignora minutos**: clase "08:30-10:00" considerada
 *     "en rango" para hora "08:00" porque `8 >= 8 && 8 < 10`. Deuda menor:
 *     si renderer pide granularidad por media hora, refactor.
 *   - **`calcularDuracionHoras` enteros**: clase "08:00-10:30" duración=2
 *     (debería ser 2.5). `--duracion=2` rendea altura 2 celdas. Deuda menor:
 *     fraccional para precisión visual.
 *   - **`horariosSeSuperponen` algoritmo overlap clásico**: `(inicio1 < fin2 && fin1 > inicio2)`
 *     correcto para rangos abiertos por derecha [inicio, fin). Edge: clase
 *     "08-10" y "10-12" NO superponen (fin1=10 NOT > inicio2=10).
 *   - **`replace(":", "")` técnica HHmm**: "08:30" → 830, "13:00" → 1300.
 *     Funciona para comparación porque preserva orden lexicográfico ↔ temporal.
 *     Fallback `"0:0"` defensivo si null/undefined.
 *   - **`parseInt` base implícita 10**: seguro por "HH:MM" que no empieza con
 *     "0x" / "0o". Si algún seed corruption inyecta "08" lookup falla — pero
 *     ya no aplica con replace(":", "").
 *   - **Sin tests unitarios**: helpers críticos sin coverage. Deuda menor
 *     post-migración TS.
 *   - Funciones PURAS.
 *   - **Pattern único admin** — sin twin (otros archivos no manejan tiempo).
 */
function horaEnRango(hora, inicio, fin) {
    const h = parseInt(hora.split(":")[0]);
    const hInicio = parseInt(inicio.split(":")[0]);
    const hFin = parseInt(fin.split(":")[0]);
    return h >= hInicio && h < hFin;
}

/**
 * @interaction horarios-render-clase-en-calendario
 * @scope admin-horarios-render-clase
 *
 * Given clase (registro derivado de `_horariosFlat`) + horaActual (string "HH:00")
 * + DEMO_MATERIAS + DEMO_USERS globales + helpers `calcularDuracionHoras` +
 * `tieneConflicto`.
 * When `buildCalendarioSemanal` renderea cada celda — invoca este helper por
 * cada clase que matchea día+hora rango.
 * Then:
 *   1. Lookup materia + profesor en DEMO_* (sin `String()` coerce).
 *   2. Calcula `duracion` (enteros via `calcularDuracionHoras`).
 *   3. **Guard `esInicio`**: si `horaActual !== clase.horaInicio` → retorna `""`
 *      (string vacío). Evita renderear bloque visual duplicado en CADA celda
 *      que la clase atraviesa — bloque vive en una sola celda con altura
 *      `--duracion`.
 *   4. Detección conflicto via `tieneConflicto(clase)` → CSS class `.conflicto`
 *      + ícono ⚠️.
 *   5. Color: `materia?.color || "#1b4fe4"` (fallback brand cyan-blue).
 *   6. Render `<.calendario-clase>` con CSS custom prop `--duracion` + bg
 *      semi-transparente (`${color}20` = alpha hex) + border-left 3px del color
 *      sólido + tooltip title con materia+profesor + handler `onclick="editarHorario('${clase.id}')"`.
 *      Contenido: nombre materia (top) + aula + horaInicio-horaFin (info).
 * Edge:
 *   - **Guard `esInicio` crítico**: sin él, clase "08-10" se renderea 2 veces
 *     (celda 08:00 + celda 09:00). El `--duracion` CSS prop pinta visualmente
 *     un solo bloque alto, pero el DOM tendría 2 nodos duplicados con `onclick`
 *     activo → bugs UX.
 *   - **Color materia con fallback brand**: schema embebe `materia.color` per-instancia
 *     (no canonical). Si missing → cyan-blue brand XAHNI. Deuda menor: agregar
 *     campo color al modal de edición materia (15b.B `materias.js` NO lo edita).
 *   - **Alpha hex `${color}20`**: hack semi-transparente concatenando hex alpha.
 *     Equivalente a `rgba(R,G,B, 0.125)`. Solo funciona con color hex 6-char;
 *     si color es rgba/named → bug visual (deuda menor).
 *   - **Sin `_escapeHtml` en `--duracion` o `color`** value attributes —
 *     riesgo XSS si color viene de input usuario (NO en admin actual, pero
 *     anotar deuda).
 *   - **Tooltip title XSS-safe**: `_escapeHtml(materia?.nombre || 'Materia')`.
 *   - **`onclick="editarHorario('${clase.id}')"` template inline**: clase.id
 *     es id sintético `hor_<materiaId>_<slotIdx>` con `_` — seguro porque
 *     no contiene `'` ni HTML especiales.
 *   - Función IMPURA (DOM read globals + retorna HTML string).
 *   - **Pattern único admin** — bloques visuales con `--duracion` CSS prop.
 */
function renderClaseEnCalendario(clase, horaActual) {
    const materia = DEMO_MATERIAS.find(m => m.id === clase.materiaId);
    const profesor = DEMO_USERS.find(u => u.id === clase.profesorId);
    const duracion = calcularDuracionHoras(clase.horaInicio, clase.horaFin);
    const esInicio = horaActual === clase.horaInicio;

    if (!esInicio) return "";

    const conflicto = tieneConflicto(clase);
    const color = materia?.color || "#1b4fe4";

    return `
        <div class="calendario-clase ${conflicto ? 'conflicto' : ''}"
             style="--duracion:${duracion};background:${color}20;border-left:3px solid ${color}"
             onclick="editarHorario('${clase.id}')"
             title="${_escapeHtml(materia?.nombre || 'Materia')} - ${_escapeHtml(profesor?.nombre || '')}">
            <div class="calendario-clase-nombre">${_escapeHtml(materia?.nombre) || "Materia"}</div>
            <div class="calendario-clase-info">${_escapeHtml(clase.aula) || "—"} · ${clase.horaInicio}-${clase.horaFin}</div>
            ${conflicto ? '<div class="calendario-clase-alerta">⚠️</div>' : ''}
        </div>
    `;
}

function calcularDuracionHoras(inicio, fin) {
    const hInicio = parseInt(inicio.split(":")[0]);
    const hFin = parseInt(fin.split(":")[0]);
    return hFin - hInicio;
}

// ── Tabla de horarios ─────────────────────────────────────────
/**
 * @interaction horarios-build-tabla
 * @scope admin-horarios-tabla
 *
 * Given DOM `#horarios-tabla` + `HORARIOS_FILTROS.grupo` + helpers `filtrarHorarios`
 * + `tieneConflicto` + DEMO_MATERIAS + DEMO_USERS + DEMO_INSTITUCIONES.
 * When `buildHorariosView` o tras CRUD mutation lo invoca.
 * Then:
 *   1. DOM guard.
 *   2. **Gating empty state** (twin con `buildCalendarioSemanal`): si !grupo
 *      → render `.x-empty` con icon 📋 + título pidiendo institución+grupo.
 *   3. `filtrarHorarios()` aplica filtros activos.
 *   4. **Empty post-filter**: si N=0 → render `.x-empty` con icon 📅 + título
 *      "No hay horarios que coincidan".
 *   5. Render `<table class="data-table">` con thead 8 cols (Materia + Profesor
 *      + Día + Horario + Aula + Institución + Estado + Acciones) + tbody con
 *      1 fila por horario filtrado:
 *      - **Animación stagger**: `style="animation-delay:${i * 0.03}s"`.
 *      - Conflicto → CSS class `.fila-conflicto`.
 *      - Estado: badge `.badge-success` "Activo" / `.badge-muted` "Inactivo" +
 *        adyacente `.badge-error` "⚠️ Conflicto" si aplica.
 *      - Acciones: 3 botones inline (Editar ✏️ / Pausar⏸️ o Activar▶️ adaptive /
 *        Eliminar 🗑️ rojo).
 * Edge:
 *   - **Twin con buildCalendarioSemanal** en gating + filtrado. Decisión UI:
 *     calendario + tabla son 2 vistas del mismo dataset, ambas requieren grupo.
 *   - **8 cols vs 5/6/8 en otros admin**: igual que materias 15b.B (8 cols
 *     con horario agrupado). Sin asimetría.
 *   - **Botón toggle adaptive**: label "⏸️ Pausar" si activo / "▶️ Activar"
 *     si inactivo. Cementa pattern toggle UX de materias 15b.B (que usa
 *     "Archivar"/"Restaurar" + amber/green colors). Aquí usa íconos play/pause
 *     más visuales.
 *   - **Animación stagger 0.03s por row**: visual sutil. Performance OK por
 *     scale (no se nota en N>50).
 *   - **3 lookups por row**: materia + profesor + institución en DEMO_*.
 *     O(N) por render. Cost OK por scale.
 *   - **`badge-*` legacy classes** vs `.x-chip` canonical 15a/15b. Deuda
 *     menor: migrar a canónico post-migración (TS+Tailwind).
 *   - **`onclick` template inline** con id sintético — seguro como en `renderClaseEnCalendario`.
 *   - Función IMPURA (DOM write).
 *   - Twin con `_renderTablaMateriasAdmin` (15b.B) — pero con `.data-table` legacy
 *     vs `<tbody id="materias-admin-tbody">` directo.
 */
function buildHorariosTabla() {
    const el = document.getElementById("horarios-tabla");
    if (!el) return;

    if (!HORARIOS_FILTROS.grupo) {
        el.innerHTML = `<div class="x-empty">
            <div class="x-empty__icon">📋</div>
            <div class="x-empty__title">Selecciona una institución y un grupo para visualizar la lista de horarios</div>
        </div>`;
        return;
    }

    const horarios = filtrarHorarios();

    if (horarios.length === 0) {
        el.innerHTML = `<div class="x-empty">
            <div class="x-empty__icon">📅</div>
            <div class="x-empty__title">No hay horarios que coincidan con los filtros</div>
        </div>`;
        return;
    }

    el.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Materia</th>
                    <th>Profesor</th>
                    <th>Día</th>
                    <th>Horario</th>
                    <th>Aula</th>
                    <th>Institución</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${horarios.map((h, i) => {
                    const materia = DEMO_MATERIAS.find(m => m.id === h.materiaId);
                    const profesor = DEMO_USERS.find(u => u.id === h.profesorId);
                    const institucion = DEMO_INSTITUCIONES.find(inst => inst.id === h.institucionId);
                    const conflicto = tieneConflicto(h);

                    return `
                    <tr style="animation-delay:${i * 0.03}s" class="${conflicto ? 'fila-conflicto' : ''}">
                        <td><strong>${_escapeHtml(materia?.nombre) || "—"}</strong></td>
                        <td>${_escapeHtml(profesor?.nombre) || "—"}</td>
                        <td>${_escapeHtml(h.dia)}</td>
                        <td><span class="badge-neutral">${_escapeHtml(h.horaInicio)} - ${_escapeHtml(h.horaFin)}</span></td>
                        <td><span class="badge-blue">${_escapeHtml(h.aula) || "—"}</span></td>
                        <td>${_escapeHtml(institucion?.nombre) || "—"}</td>
                        <td>${h.activo
                            ? '<span class="badge-success">Activo</span>'
                            : '<span class="badge-muted">Inactivo</span>'}
                            ${conflicto ? '<span class="badge-error" style="margin-left:4px">⚠️ Conflicto</span>' : ''}
                        </td>
                        <td>
                            <div style="display:flex;gap:6px;align-items:center">
                                <button class="x-btn x-btn--ghost" style="padding:6px 12px;font-size:12px" onclick="editarHorario('${h.id}')" title="Editar horario">
                                    ✏️ Editar
                                </button>
                                <button class="x-btn x-btn--ghost" style="padding:6px 12px;font-size:12px" onclick="toggleEstadoHorario('${h.id}')" title="${h.activo ? 'Desactivar' : 'Activar'}">
                                    ${h.activo ? '⏸️ Pausar' : '▶️ Activar'}
                                </button>
                                <button class="x-btn x-btn--ghost" style="padding:6px 12px;font-size:12px;color:var(--xahni-red)" onclick="eliminarHorario('${h.id}')" title="Eliminar horario">
                                    🗑️ Eliminar
                                </button>
                            </div>
                        </td>
                    </tr>`;
                }).join("")}
            </tbody>
        </table>
    `;
}

// ── Filtros ───────────────────────────────────────────────────
// Sin grupo seleccionado, devuelve [] para evitar el sobrelapamiento de
// horarios entre instituciones/grupos en la misma cuadrícula.
// Con grupo: filtra a horarios de materias del grupo (grupo.materias[]).
/**
 * @interaction horarios-filtros-reactivos
 * @scope admin-horarios-filtros
 *
 * Given `HORARIOS_FILTROS` module-scope (`{institucion, grupo, busqueda}`) +
 * `_horariosFlat()` + DEMO_MATERIAS + DEMO_USERS globales.
 * When `buildCalendarioSemanal` / `buildHorariosTabla` necesitan dataset
 * filtrado, o admin tipea/selecciona en filtros → handler reactivo invoca
 * cascade.
 * Then 2 fn combined:
 *   - `filtrarHorarios()` (reader puro):
 *     1. Si !grupo seleccionado → `[]` (gating defensivo — evita sobrelapamiento
 *        visual cross-grupo en calendario).
 *     2. Filter `_horariosFlat()` por `h.grupoId === grupoId` (NO String() coerce).
 *     3. Sub-filter busqueda case-insensitive sobre materia.nombre +
 *        profesor.nombre + h.aula (lookup en DEMO_*).
 *   - `aplicarFiltroHorarios(tipo, valor)` (handler reactivo, **API genérica**):
 *     1. Muta `HORARIOS_FILTROS[tipo] = valor` (acceso dinámico por key).
 *     2. **Branch institución reset cascade**: si `tipo === "institucion"` →
 *        `HORARIOS_FILTROS.grupo = ""` (limpia grupo, era de otra institución)
 *        + `poblarGruposPorInstitucion()` (repuebla dropdown).
 *     3. Re-render cascade: `buildCalendarioSemanal()` + `buildHorariosTabla()`.
 *     4. **NO re-render `buildHorariosResumen`** (asimetría: stats globales
 *        no cambian al filtrar visualmente — coherente con materias 15b.B
 *        filtros).
 * Edge:
 *   - **API genérica `aplicarFiltroHorarios(tipo, valor)`** vs API específica
 *     `filtrarMaterias{Busqueda,Estado,Institucion}(valor)` 15b.B (3 fn).
 *     Asimetría — genérica permite extender sin agregar handlers, específica
 *     da más type safety estático.
 *   - **Filter reset cascade institución → grupo**: previene estado inválido
 *     "grupo X de institución Y mientras filtro institución es Z". Pattern
 *     único admin (clasifs/materias no tienen gating cascada).
 *   - **Sub-filter busqueda con 3 lookups O(N)** por horario: materia + profesor
 *     + aula. Cost O(H × 3 × M_users_max). Performance OK por scale.
 *   - **Gating defensivo `if (!grupoId) return []`**: protege calendario+tabla
 *     de render sin contexto. UX: empty state explícito en lugar de tabla
 *     vacía confusa.
 *   - **`HORARIOS_FILTROS` module-scope sobrevive re-renders** (no se resetea
 *     en `buildHorariosView`).
 *   - **Sin debounce en busqueda** — re-render por keystroke. Aceptable
 *     DEMO scale; post-Supabase debounce 150ms.
 *   - **`filtrarHorarios` NO usa `HORARIOS_FILTROS.institucion`** — el gating
 *     ya vive en `poblarGruposPorInstitucion` (que solo muestra grupos de la
 *     institución actual). Filter por institución sería redundante.
 *   - Funciones: `filtrarHorarios` PURA / `aplicarFiltroHorarios` IMPURA (mutate
 *     state + DOM cascade).
 *   - Twin con filtros de otros archivos admin pero con API genérica única.
 */
function filtrarHorarios() {
    const grupoId = HORARIOS_FILTROS.grupo;
    if (!grupoId) return [];

    const busq = (HORARIOS_FILTROS.busqueda || "").toLowerCase();

    return _horariosFlat().filter(h => {
        if (h.grupoId !== grupoId) return false;

        if (busq) {
            const materia = DEMO_MATERIAS.find(m => m.id === h.materiaId);
            const profesor = DEMO_USERS.find(u => u.id === h.profesorId);
            const matchMateria  = materia?.nombre?.toLowerCase().includes(busq) || false;
            const matchProfesor = profesor?.nombre?.toLowerCase().includes(busq) || false;
            const matchAula     = h.aula?.toLowerCase().includes(busq) || false;
            if (!matchMateria && !matchProfesor && !matchAula) return false;
        }
        return true;
    });
}

function aplicarFiltroHorarios(tipo, valor) {
    HORARIOS_FILTROS[tipo] = valor;
    // Cambiar institución resetea grupo y repuebla su dropdown
    if (tipo === "institucion") {
        HORARIOS_FILTROS.grupo = "";
        poblarGruposPorInstitucion();
    }
    buildCalendarioSemanal();
    buildHorariosTabla();
}

// ── CRUD: crear ──────────────────────────────────────────────
/**
 * @interaction horarios-modal-crear-bootstrap-preselect
 * @scope admin-horarios-modal-crear
 *
 * Given DOM modal `#modal-horario` + sus 9 inputs hijos + `HORARIOS_FILTROS`
 * module-scope.
 * When admin clica botón "+" / "Crear Horario" (bootstrap).
 * Then:
 *   1. Side-channel `horarioEditando = null` (distingue de branch editar).
 *   2. Cambia título modal a "Crear Horario" (vs "Editar Horario").
 *   3. **Helper closure `setVal(id, v)`**: maneja tanto inputs normales
 *      (`.value = v`) como checkboxes (`.checked = v`).
 *   4. Resetea 8 campos a defaults: materia="", profesor="", dia="Lunes",
 *      inicio="08:00", fin="10:00", aula="", institucion="", activo=true.
 *   5. **Pre-rellena institución + grupo desde filtros activos** cuando aplique:
 *      - Si `HORARIOS_FILTROS.institucion` → setVal directo.
 *      - `grupoSelect.dataset.preselect = HORARIOS_FILTROS.grupo || ""` —
 *        side-channel para que `cargarOpcionesModalHorario` →
 *        `actualizarGruposEnModal` lo aplique TRAS repoblar.
 *   6. `cargarOpcionesModalHorario()` popula 4 selects (materia + profesor +
 *      institución + grupo cascade).
 *   7. `openModal("modal-horario")`.
 * Edge:
 *   - **Side-channel `horarioEditando = null`** distingue del branch editar
 *     (que lo setea al id sintético). `guardarHorario` lee este flag para
 *     decidir branch crear vs editar.
 *   - **Pre-rellena desde filtros activos**: UX clave. Si admin está viendo
 *     horarios de "ITM/Grupo A" y clica "+", el modal aparece con esos valores
 *     ya seleccionados → reduce 2 clicks por horario.
 *   - **`dataset.preselect` pattern**: workaround para que el grupo se preseleccione
 *     DESPUÉS de que `cargarOpcionesModalHorario` repuebla el `<select>`
 *     materia (que dispara `actualizarGruposEnModal` repoblar grupos). Sin
 *     este side-channel, setVal directo al grupo se sobreescribiría.
 *   - **`setVal` helper closure local**: pattern única vez aquí + `editarHorario`.
 *     Refactor menor: extraer a module-scope `_setModalField` reusable.
 *   - **Defaults razonables**: día=Lunes (más común), 08:00-10:00 (slot estándar
 *     2h), activo=true. Reduce friction al admin.
 *   - Función IMPURA (DOM write + module state mutation + cascade populadores).
 *   - Twin con `_abrirModalNuevaClasificacion` (15b.A) + `abrirModalCrearHorario` —
 *     pero único con preselect desde filtros activos + dataset side-channel.
 */
function abrirModalCrearHorario() {
    horarioEditando = null;
    const t = document.getElementById("modal-horario-titulo");
    if (t) t.textContent = "Crear Horario";

    const setVal = (id, v) => { const el = document.getElementById(id); if (el) { if (el.type === "checkbox") el.checked = v; else el.value = v; } };
    setVal("horario-materia", "");
    setVal("horario-profesor", "");
    setVal("horario-dia", "Lunes");
    setVal("horario-inicio", "08:00");
    setVal("horario-fin", "10:00");
    setVal("horario-aula", "");
    setVal("horario-institucion", "");
    setVal("horario-activo", true);

    // Pre-rellena institución y grupo desde el filtro activo cuando aplique
    if (HORARIOS_FILTROS.institucion) setVal("horario-institucion", HORARIOS_FILTROS.institucion);
    const grupoSelect = document.getElementById("horario-grupo");
    if (grupoSelect) grupoSelect.dataset.preselect = HORARIOS_FILTROS.grupo || "";

    cargarOpcionesModalHorario();
    openModal("modal-horario");
}

/**
 * @interaction horarios-modal-populadores-cascada
 * @scope admin-horarios-modal-populadores
 *
 * Given DOM modal `#modal-horario` con 4 selects (`#horario-materia`,
 * `#horario-grupo`, `#horario-profesor`, `#horario-institucion`) +
 * DEMO_MATERIAS + DEMO_USERS + DEMO_INSTITUCIONES + DEMO_GRUPOS globales.
 * When `abrirModalCrearHorario` / `editarHorario` necesitan poblar selects
 * en cascada (materia → grupos.materias[]).
 * Then 2 populadores combined cascade:
 *   - `cargarOpcionesModalHorario()`:
 *     1. DOM guard de los 4 selects.
 *     2. Captura valores actuales pre-render (preservación cross-render).
 *     3. Popula 3 selects desde DEMO_*: materia (todas), profesor (filter
 *        rol="profesor"), institucion (todas).
 *     4. Restaura valores actuales si seguían en options.
 *     5. Invoca `actualizarGruposEnModal(grupoActual)` cascade.
 *   - `actualizarGruposEnModal(grupoPreseleccionado)`:
 *     1. DOM guard.
 *     2. Lee materiaId del select materia.
 *     3. Find materia + extrae `materia.grupos[]` → map a DEMO_GRUPOS → filter
 *        Boolean (descartando refs huérfanas).
 *     4. Si grupos.length > 0 → renderea options + default "Selecciona un grupo".
 *        Else → renderea solo placeholder "— sin grupos asignados a esta materia —".
 *     5. **Resolución preselect 3-nivel**: `grupoPreseleccionado ?? dataset.preselect ?? ""`.
 *        Aplica solo si el target existe en grupos disponibles.
 *     6. Limpia `dataset.preselect = ""` post-aplicación (one-shot).
 * Edge:
 *   - **Cascada materia → grupos.materias[] CRÍTICA**: el modal NO ofrece TODOS
 *     los grupos — solo los asignados a la materia seleccionada. Schema:
 *     `materia.grupos[]` array de grupoIds. Si admin cambia materia → grupos
 *     se repueblan automáticamente.
 *   - **Filter Boolean descarta refs huérfanas**: si materia.grupos[] referencia
 *     grupo no existente → se omite silently. Deuda menor: warning visual
 *     "grupos huérfanos detectados".
 *   - **Empty state placeholder**: si materia sin grupos asignados → option
 *     único "— sin grupos asignados a esta materia —" disabled visually.
 *     UX cue al admin: ir a `materias.js` 15b.B para asignar grupos primero.
 *   - **Resolución preselect 3-nivel**: parámetro explícito (editar) > dataset
 *     side-channel (crear con filtros) > "". Coverage UX completo.
 *   - **`dataset.preselect` one-shot**: limpiado post-aplicación evita aplicar
 *     mismo valor a futuras cargas.
 *   - **Preservación valor cross-render**: captura ANTES del innerHTML reset
 *     + restaura DESPUÉS. Si valor sigue en options → preserva (UX: cambiar
 *     materia NO debe perder selección de profesor).
 *   - **`String() coerce` en find materia** (`String(m.id) === String(matId)`):
 *     defensivo contra numérico/string mismatch.
 *   - Funciones IMPURAS (DOM write + cascade lookup).
 *   - Twin parcial con `_poblarSelect*` materias 15b.B (4 populadores).
 *     Pero materias NO hace cascada — populadores independientes. Horarios
 *     es único con cascada materia → grupos.
 */
function cargarOpcionesModalHorario() {
    const materiaSelect = document.getElementById("horario-materia");
    const grupoSelect = document.getElementById("horario-grupo");
    const profesorSelect = document.getElementById("horario-profesor");
    const institucionSelect = document.getElementById("horario-institucion");
    if (!materiaSelect || !grupoSelect || !profesorSelect || !institucionSelect) return;

    const materiaActual = materiaSelect.value;
    const grupoActual = grupoSelect.value;
    const profesorActual = profesorSelect.value;
    const institucionActual = institucionSelect.value;

    materiaSelect.innerHTML = '<option value="">Selecciona una materia</option>' +
        DEMO_MATERIAS.map(m => `<option value="${_escapeHtml(m.id)}">${_escapeHtml(m.nombre)}</option>`).join("");

    profesorSelect.innerHTML = '<option value="">Selecciona un profesor</option>' +
        DEMO_USERS.filter(u => u.tipo === "profesor")
            .map(p => `<option value="${_escapeHtml(p.id)}">${_escapeHtml(p.nombre)}</option>`).join("");

    institucionSelect.innerHTML = '<option value="">Selecciona una institución</option>' +
        DEMO_INSTITUCIONES.map(i => `<option value="${_escapeHtml(i.id)}">${_escapeHtml(i.nombre)}</option>`).join("");

    if (materiaActual)     materiaSelect.value     = materiaActual;
    if (profesorActual)    profesorSelect.value    = profesorActual;
    if (institucionActual) institucionSelect.value = institucionActual;

    actualizarGruposEnModal(grupoActual);
}

// Pobla el select de grupo a partir de los grupos de la materia seleccionada
// (materia.grupos[]). Si no hay materia, vacía el select.
function actualizarGruposEnModal(grupoPreseleccionado) {
    const materiaSelect = document.getElementById("horario-materia");
    const grupoSelect = document.getElementById("horario-grupo");
    if (!materiaSelect || !grupoSelect) return;

    const matId = materiaSelect.value;
    const materia = DEMO_MATERIAS.find(m => String(m.id) === String(matId));
    const grupos = (materia?.grupos || [])
        .map(gid => (DEMO_GRUPOS || []).find(g => g.id === gid))
        .filter(Boolean);

    grupoSelect.innerHTML = grupos.length
        ? '<option value="">Selecciona un grupo</option>' +
          grupos.map(g => `<option value="${_escapeHtml(g.id)}">${_escapeHtml(g.nombre)}</option>`).join("")
        : '<option value="">— sin grupos asignados a esta materia —</option>';

    const target = grupoPreseleccionado ?? grupoSelect.dataset.preselect ?? "";
    if (target && grupos.some(g => g.id === target)) grupoSelect.value = target;
    grupoSelect.dataset.preselect = "";
}

/**
 * @interaction horarios-guardar-async-complejo-3-branches
 * @scope admin-horarios-guardar-async
 *
 * Given inputs modal `#modal-horario` (9 campos) + `horarioEditando` module-scope
 * + DEMO_MATERIAS global + helpers `verificarConflictos` + `confirmarCanonico`
 * + `_resolverHorario` + `_DIA_KEY`.
 * When admin submit modal (crear o editar).
 * Then async flow complejo con 3 branches:
 *   1. Lee 9 valores: materiaId + grupoId + profesorId + dia + horaInicio +
 *      horaFin + aula (trim) + institucionId + activo (checkbox).
 *   2. Valida 5 obligatorios → toast "completa todos los campos" + abort.
 *   3. Valida `horaInicio < horaFin` (comparación string lexicográfica
 *      funciona por formato "HH:MM" zero-padded) → toast "fin posterior a inicio" + abort.
 *   4. Construye `registro` candidato con id sintético (real si edit, `_NEW`
 *      sentinel si crear).
 *   5. **Conflict check pre-save con override**: `verificarConflictos(registro)`
 *      retorna array de mensajes. Si N>0 → `confirmarCanonico tipo=primary`
 *      con listado + opción "Guardar de todas formas". Si admin cancela → abort.
 *   6. Construye `slot` canonical (forma DB) con `_DIA_KEY[dia]` reverse lookup
 *      raw lowercase.
 *   7. **3 branches persistencia**:
 *      - **Branch EDIT misma materia** (`horarioEditando && ref.materia.id === materiaId`):
 *        recompose `materia.horario[]` reemplazando slot en `slotIdx` con nuevo.
 *        1 `DataService.saveMateria`.
 *      - **Branch EDIT cambio materia** (`horarioEditando && ref.materia.id !== materiaId`):
 *        2 `DataService.saveMateria` consecutivos: (a) borra slot del origen
 *        (filter idx), (b) agrega slot al destino (spread + push). **NO ATÓMICO**.
 *      - **Branch CREAR** (`!horarioEditando`): agrega slot al destino (spread
 *        + push). 1 `DataService.saveMateria`.
 *   8. closeModal + `buildHorariosView()` cascade re-render completo + toast success.
 * Edge:
 *   - **Conflict check pre-save con override (única en admin)**: pattern UX
 *     "admin decide bajo info". Otros archivos admin solo validan duplicado
 *     nombre + abort. Aquí los conflictos son ADVERTENCIAS visibles, no
 *     bloqueantes → admin acepta o cancela.
 *   - **Cambio materia en edit NO ATÓMICO**: 2 `saveMateria` consecutivos.
 *     Si segundo falla, slot queda solo borrado del origen → estado inconsistente.
 *     **Deuda Firestore batched**: usar `writeBatch` o transaction post-Supabase.
 *   - **Persistencia recompuesta materia.horario[]**: cada mutación reconstruye
 *     el array entero (filter + map + push) y lo persiste via `saveMateria`.
 *     Schema rework 2026-05-15 + 4.F: payload canónico con horario[] completo.
 *   - **`registro.id = horarioEditando || 'hor_${materiaId}_NEW'`**: sentinel
 *     `_NEW` para conflict check (no colisiona con ids reales que terminan
 *     en `_<digits>$`). `verificarConflictos` excluye self por id match.
 *   - **`_DIA_KEY[dia]` reverse lookup display→raw**: persistir en DB usa raw
 *     lowercase sin acentos. Fallback `(dia || "").toLowerCase()` defensivo
 *     si día desconocido.
 *   - **Sin try/catch sobre DataService.saveMateria**: unhandled rejection
 *     burbujea (asimetría con clasifs 15b.A / materias 15b.B que SÍ tienen
 *     try/catch). Deuda menor: agregar para coherencia.
 *   - **String comparison `horaInicio >= horaFin`** funciona por formato
 *     "HH:MM" zero-padded ("08:00" < "10:00" lexicográficamente y temporalmente).
 *   - **IDs string preservados**: comentario explícito en archivo "parseInt
 *     rompería búsqueda" — schema canónico usa ids string ("bd", "prof1").
 *   - **`aula.trim()`** elimina espacios accidentales (UX defensivo).
 *   - Función IMPURA (async + DOM cascade + DataService side effect + module
 *     state read).
 *   - **Pattern único admin** — 3 branches persistencia + override conflict check.
 */
async function guardarHorario() {
    // IDs se mantienen como string: el schema canónico usa ids string
    // ("bd", "prof1") — parseInt rompería la búsqueda en DEMO_MATERIAS.
    const materiaId = document.getElementById("horario-materia").value;
    const grupoId = document.getElementById("horario-grupo").value;
    const profesorId = document.getElementById("horario-profesor").value;
    const dia = document.getElementById("horario-dia").value;
    const horaInicio = document.getElementById("horario-inicio").value;
    const horaFin = document.getElementById("horario-fin").value;
    const aula = document.getElementById("horario-aula").value.trim();
    const institucionId = document.getElementById("horario-institucion").value;
    const activo = document.getElementById("horario-activo").checked;

    if (!materiaId || !grupoId || !profesorId || !aula || !institucionId) {
        showToast("⚠️ Completa todos los campos obligatorios", "error");
        return;
    }
    if (horaInicio >= horaFin) {
        showToast("⚠️ La hora de fin debe ser posterior a la de inicio", "error");
        return;
    }

    // Construye registro candidato (con id sintético si es nuevo, real si es edición)
    const registro = {
        id: horarioEditando || `hor_${materiaId}_NEW`,
        materiaId, grupoId, profesorId, dia, horaInicio, horaFin, aula, institucionId, activo,
    };

    const conflictos = verificarConflictos(registro);
    if (conflictos.length > 0) {
        const listado = conflictos.map(c => `• ${_escapeHtml(c)}`).join("<br>");
        const ok = await confirmarCanonico({
            titulo: "Solapamiento detectado",
            mensaje: `Se detectaron conflictos:<br><br>${listado}<br><br>¿Guardar de todas formas?`,
            accionTexto: "Guardar de todas formas",
            tipo: "primary",
            icono: "⚠️",
        });
        if (!ok) return;
    }

    // Persistir en materia.horario[] con grupoId incluido (schema 2026-05-15).
    const slot = {
        grupoId,
        dia: _DIA_KEY[dia] || (dia || "").toLowerCase(),
        inicio: horaInicio,
        fin: horaFin,
        salon: aula,
        activo,
    };

    if (horarioEditando) {
        const ref = _resolverHorario(horarioEditando);
        if (!ref) { showToast("⚠️ Horario no encontrado", "error"); return; }
        if (String(ref.materia.id) !== String(materiaId)) {
            // Cambio de materia: borrar slot del origen + agregar al destino.
            const origenHorario = (ref.materia.horario || []).filter((_, i) => i !== ref.slotIdx);
            await DataService.saveMateria({ id: ref.materia.id, horario: origenHorario });

            const destino = DEMO_MATERIAS.find(m => String(m.id) === String(materiaId));
            if (!destino) return;
            const destinoHorario = [...(destino.horario || []), slot];
            await DataService.saveMateria({ id: destino.id, horario: destinoHorario });
        } else {
            const nuevoHorario = (ref.materia.horario || []).map((h, i) => i === ref.slotIdx ? slot : h);
            await DataService.saveMateria({ id: ref.materia.id, horario: nuevoHorario });
        }
        showToast("✅ Horario actualizado", "success");
    } else {
        const materia = DEMO_MATERIAS.find(m => String(m.id) === String(materiaId));
        if (!materia) return;
        const nuevoHorario = [...(materia.horario || []), slot];
        await DataService.saveMateria({ id: materia.id, horario: nuevoHorario });
        showToast("✅ Horario creado", "success");
    }

    closeModal("modal-horario");
    buildHorariosView();
}

/**
 * @interaction horarios-editar-bootstrap
 * @scope admin-horarios-editar
 *
 * Given id sintético `hor_<materiaId>_<slotIdx>` + DEMO_MATERIAS global +
 * DOM modal `#modal-horario` + helpers `_resolverHorario` + `_diaDisplay` +
 * `_institucionIdDePorGrupo` + `cargarOpcionesModalHorario`.
 * When admin clica botón "Editar" en row tabla o clic en bloque calendario
 * (ambos invocan `editarHorario('${clase.id}')`).
 * Then:
 *   1. `_resolverHorario(id)` → `{materia, slotIdx, slot}` o null.
 *      Si null → toast "no encontrado" + abort.
 *   2. Side-channel `horarioEditando = id` (module-scope, lee `guardarHorario`
 *      para distinguir branch edit vs crear).
 *   3. **Preselect via dataset**: `grupoSelect.dataset.preselect = ref.slot.grupoId`
 *      ANTES de invocar `cargarOpcionesModalHorario` → `actualizarGruposEnModal`
 *      lo lee y aplica tras repoblar grupos (cascade materia→grupos).
 *   4. **Helper closure `setVal`** local (duplicado de `abrirModalCrearHorario`):
 *      pre-llena 8 inputs canonicos:
 *      - materia = ref.materia.id, profesor = ref.materia.profesorId (heredado
 *        de materia, no del slot — DEUDA Phase B), dia = `_diaDisplay(slot.dia)`
 *        (raw→display), inicio = slot.inicio, fin = slot.fin, aula = slot.salon,
 *        institucion = `_institucionIdDePorGrupo(slot.grupoId)` (cadena
 *        grupo→carrera→institución), activo = `slot.activo !== false` defensivo.
 *   5. `cargarOpcionesModalHorario()` popula 4 selects + aplica preselect.
 *   6. Cambia título modal a "Editar Horario" (vs "Crear Horario").
 *   7. `openModal("modal-horario")`.
 * Edge:
 *   - **`profesor = ref.materia.profesorId`** (no del slot). El schema slot
 *     NO embebe profesorId (Phase B debt) — se hereda de la materia. Si admin
 *     edita el profesor en este modal y persiste, va a `materia.profesorId`
 *     vía `_enrichMateria`-cycle, NO al slot. **Coupling implícito**: cambiar
 *     profesor en modal horario afecta TODOS los slots de esa materia.
 *     Deuda Phase B: enriquecer schema slot con profesorId per-instancia.
 *   - **`institucion` recomputada** desde slot.grupoId via cadena. No vive en
 *     slot ni en materia — siempre derivada.
 *   - **`activo !== false`** defensivo treats missing as activo true.
 *   - **Side-channel `horarioEditando`** module-scope sobrevive hasta próximo
 *     bootstrap (sin reset post-save en guardarHorario). OK.
 *   - **`dataset.preselect` PRE-cargarOpciones**: orden crítico. Sin él, el
 *     populador grupo no sabe qué seleccionar tras repoblar.
 *   - **Trigger doble (botón tabla + bloque calendario)**: misma fn, mismo
 *     comportamiento. Cobertura UX completa.
 *   - **`setVal` helper duplicado** de `abrirModalCrearHorario` — deuda refactor
 *     menor: extraer a module-scope.
 *   - Función IMPURA (DOM write + module state mutation + dataset side-channel +
 *     cascade populadores).
 *   - Twin con `abrirEditarMateria` (15b.B) — pero con id sintético resolver
 *     + dataset preselect + título dinámico.
 */
function editarHorario(id) {
    const ref = _resolverHorario(id);
    if (!ref) { showToast("⚠️ Horario no encontrado", "error"); return; }

    horarioEditando = id;

    // El grupo se preselecciona desde dataset para que cargarOpcionesModalHorario
    // → actualizarGruposEnModal lo aplique tras repoblar el select.
    const grupoSelect = document.getElementById("horario-grupo");
    if (grupoSelect) grupoSelect.dataset.preselect = ref.slot.grupoId || "";

    const setVal = (k, v) => { const el = document.getElementById(k); if (el) { if (el.type === "checkbox") el.checked = v; else el.value = v; } };
    setVal("horario-materia", ref.materia.id);
    setVal("horario-profesor", ref.materia.profesorId || "");
    setVal("horario-dia", _diaDisplay(ref.slot.dia));
    setVal("horario-inicio", ref.slot.inicio);
    setVal("horario-fin", ref.slot.fin);
    setVal("horario-aula", ref.slot.salon || "");
    setVal("horario-institucion", _institucionIdDePorGrupo(ref.slot.grupoId) ?? "");
    setVal("horario-activo", ref.slot.activo !== false);

    cargarOpcionesModalHorario();

    const t = document.getElementById("modal-horario-titulo");
    if (t) t.textContent = "Editar Horario";

    openModal("modal-horario");
}

/**
 * @interaction horarios-toggle-estado-async
 * @scope admin-horarios-toggle-async
 *
 * Given id sintético + DEMO_MATERIAS global.
 * When admin clica botón "⏸️ Pausar" / "▶️ Activar" en row tabla.
 * Then async flow:
 *   1. `_resolverHorario(id)`. Si null → silent return (NO toast — UX defensivo
 *      asume id válido proviene de botón renderizado).
 *   2. **Flip boolean defensivo**: `nuevoActivo = ref.slot.activo === false ? true : false`.
 *      Treats missing/undefined/null como activo=true (default Phase B).
 *   3. Recompose `materia.horario[]` via map: reemplaza slot en `slotIdx` con
 *      `{...slot, activo: nuevoActivo}` (spread preserva otros campos).
 *   4. `await DataService.saveMateria({id, horario: nuevoHorario})` — patch only
 *      con horario completo recompuesto.
 *   5. Toast adaptive: "✅ activado" si nuevoActivo=true / "⏸️ desactivado" si false.
 *      Color `success` (verde) ambos casos.
 *   6. `buildHorariosView()` cascade re-render (incluye detección conflictos
 *      actualizada — clase desactivada deja de generar conflicto).
 * Edge:
 *   - **Flip boolean defensivo**: `=== false ? true : false` distinto a `!slot.activo`
 *     (que trataría `undefined` como `false` → flip incorrecto). Variante explícita
 *     trata missing como activo=true (regla Phase B en `_horariosFlat`).
 *   - **Recompose con spread**: preserva grupoId + dia + inicio + fin + salon
 *     del slot original; solo muta `activo`.
 *   - **Sin try/catch sobre DataService.saveMateria** — unhandled rejection
 *     burbujea (asimetría con clasifs/materias).
 *   - **Toast verde en ambos casos** (vs materias 15b.B que usa success/info).
 *     Decisión UX: toggle horario es operativo neutro, no semánticamente "info" archivar.
 *   - **`buildHorariosView()` post-save**: recalcula detección conflictos
 *     globales — clase desactivada deja de aparecer en conflictos. Card resumen
 *     "Conflictos" puede bajar.
 *   - **NO sincroniza KPIs cross-módulo** (asimetría documentada).
 *   - Función IMPURA (async + DOM cascade + DataService side effect).
 *   - Twin con `toggleEstadoMateria` (15b.B) — pero schema boolean (vs enum
 *     string) + sin try/catch (vs materias también sin try/catch).
 */
async function toggleEstadoHorario(id) {
    const ref = _resolverHorario(id);
    if (!ref) return;
    const nuevoActivo = ref.slot.activo === false ? true : false;
    const nuevoHorario = (ref.materia.horario || []).map((h, i) =>
        i === ref.slotIdx ? { ...h, activo: nuevoActivo } : h
    );
    await DataService.saveMateria({ id: ref.materia.id, horario: nuevoHorario });
    showToast(`${nuevoActivo ? "✅ Horario activado" : "⏸️ Horario desactivado"}`, "success");
    buildHorariosView();
}

/**
 * @interaction horarios-eliminar-async
 * @scope admin-horarios-eliminar-async
 *
 * Given id sintético + DEMO_MATERIAS global.
 * When admin clica botón "🗑️ Eliminar" en row tabla.
 * Then async flow:
 *   1. `_resolverHorario(id)`. Si null → silent return (sin toast, defensivo).
 *   2. `confirmarCanonico` modal danger con nombre materia escaped en mensaje.
 *      Si admin cancela → silent return.
 *   3. Recompose `materia.horario[]` via filter: descarta slot en `slotIdx`.
 *   4. `await DataService.saveMateria({id, horario: nuevoHorario})` — patch only
 *      con array recompuesto sin el slot.
 *   5. Toast info "🗑️ Horario eliminado" (`success` color verde por convención
 *      del archivo — distinto a materias 15b.B que usa `info` azul).
 *   6. `buildHorariosView()` cascade re-render completo.
 * Edge:
 *   - **Persistencia recompuesta filter idx**: no hay `DataService.deleteHorario`
 *     propio — eliminar = recomponer materia.horario[] sin el slot + saveMateria.
 *   - **Sin guardia FK**: no hay refs FK al slot individual (alumnos no
 *     referencian horarios; solo materias). OK.
 *   - **Sin try/catch sobre DataService.saveMateria** (asimetría con clasifs
 *     15b.A FK guard / materias 15b.B también sin try/catch).
 *   - **`confirmarCanonico tipo=danger`** botón rojo + mensaje HTML-escaped
 *     con `_escapeHtml(ref.materia.nombre)` defensivo.
 *   - **Toast `success` (verde) en eliminar** vs materias `info` (azul).
 *     Asimetría tono — horarios trata delete como "operación normal", materias
 *     como "neutral/no-error".
 *   - **`buildHorariosView()` post-save**: card resumen "Conflictos" puede
 *     bajar si el horario eliminado generaba alguno.
 *   - **NO sync KPIs cross-módulo** (asimetría documentada).
 *   - Función IMPURA (async + DOM cascade + DataService side effect).
 *   - Twin con `eliminarMateria` (15b.B) + `eliminarClasificacion` (15b.A FK guard) —
 *     pero sin try/catch + sin FK guard + sin sync KPIs.
 */
async function eliminarHorario(id) {
    const ref = _resolverHorario(id);
    if (!ref) return;
    const ok = await confirmarCanonico({
        titulo: "Eliminar horario",
        mensaje: `¿Eliminar el horario de <strong>${_escapeHtml(ref.materia.nombre) || "esta materia"}</strong>?`,
        accionTexto: "Eliminar",
        tipo: "danger",
    });
    if (!ok) return;
    const nuevoHorario = (ref.materia.horario || []).filter((_, i) => i !== ref.slotIdx);
    await DataService.saveMateria({ id: ref.materia.id, horario: nuevoHorario });
    showToast("🗑️ Horario eliminado", "success");
    buildHorariosView();
}

// ── Detección de conflictos ───────────────────────────────────
// Reglas (todas comparten "mismo día + horarios superpuestos"):
//  · Aula: el mismo salón no puede hospedar dos clases a la vez.
//  · Profesor: un profesor no puede dar dos clases simultáneas (incluye
//    el caso de "mismo profesor, misma materia, distinto grupo" — la
//    regla que detonó el rework del schema 2026-05-15).
//  · Grupo: un grupo no puede recibir dos materias al mismo tiempo.
/**
 * @interaction horarios-deteccion-conflictos-3-reglas
 * @scope admin-horarios-deteccion-conflictos
 *
 * Given horario candidato (registro derivado o registro con id sintético
 * `_NEW`) + `_horariosFlat()` + DEMO_MATERIAS + DEMO_USERS globales + helper
 * `horariosSeSuperponen`.
 * When `guardarHorario` pre-save (verifica candidato), `buildCalendarioSemanal`/
 * `buildHorariosTabla` rendering (badges visuales), `buildHorariosResumen`
 * (count card 4).
 * Then 3 fn combined detección 3 reglas:
 *   - `verificarConflictos(horario)` (worker — array de mensajes):
 *     1. Itera `_horariosFlat()` — para cada otro horario `h`:
 *        - Skip self (`h.id === horario.id` — coincide cuando horario es
 *          existente o cuando ambos comparten id sintético `_NEW`).
 *        - Skip si distinto día (`h.dia !== horario.dia`).
 *        - Skip si `h` desactivado (`!h.activo`) — inactivos no causan conflicto.
 *        - Skip si NO superpuestos temporalmente (`!horariosSeSuperponen`).
 *     2. Acumula mensaje por regla disparada (puede ser >1 por mismo `h`):
 *        - **Regla AULA**: `h.aula === horario.aula` → "Aula X ocupada por {materia}".
 *        - **Regla PROFESOR**: `h.profesorId === horario.profesorId` → "Profesor X
 *          ya tiene clase". Si distinto grupo agrega "(grupo Y)" — pista UX
 *          del rework 2026-05-15.
 *        - **Regla GRUPO**: `h.grupoId === horario.grupoId` → "Grupo X ya tiene
 *          {materia} a esa hora".
 *   - `tieneConflicto(horario)` (wrapper boolean para renderer):
 *     `verificarConflictos(horario).length > 0`. Usado en `_renderTablaMateriasAdmin`
 *     CSS class `.fila-conflicto` + bloque calendario badge `.conflicto`.
 *   - `detectarConflictosGlobales()` (count cards resumen):
 *     Itera `_horariosFlat()` y suma `+1` por cada `h.activo && tieneConflicto(h)`.
 *     **Doble counting**: si A vs B conflicto → cuenta 2 (uno por A, uno por B).
 *     Decisión deliberada — count visual de "horarios con problema", no de "pares".
 * Edge:
 *   - **Regla profesor con pista cross-grupo**: si `h.grupoId !== horario.grupoId`
 *     → mensaje agrega "(grupo Y)". Detonó del rework 2026-05-15 — antes el
 *     mismo profesor con misma materia podía aparecer en 2 grupos distintos
 *     a la misma hora (imposible físicamente).
 *   - **Conflictos pueden acumular**: mismo `h` puede disparar 2-3 reglas
 *     simultáneamente (aula + profesor + grupo todos iguales) → 3 mensajes
 *     en array por mismo `h`. UX positivo: admin ve TODOS los problemas.
 *   - **Skip inactivos**: `!h.activo` — clase desactivada NO genera conflicto.
 *     Permite "modo dry-run" temporal: desactivar slot para liberar slot temporal
 *     sin perder data.
 *   - **Self-skip por id sintético**: `h.id === horario.id` funciona para
 *     editar (id real `hor_<mat>_<idx>`) Y para crear (id sentinel `hor_<mat>_NEW`).
 *     **EDGE BUG potencial**: si admin crea 2 horarios consecutivos sin
 *     persistir entre medias (no aplica al flujo actual modal único), ambos
 *     tendrían `_NEW` → falso self-skip. No reproducible en UI actual.
 *   - **`detectarConflictosGlobales` doble counting**: card resumen muestra
 *     "8 conflictos" para 4 pares de horarios con problema. Deuda menor:
 *     contar "pares únicos con Set" si UX lo pide. Por ahora consistente
 *     con badge visual por row.
 *   - **`verificarConflictos` cost O(H × R)** donde H=slots y R=reglas (3).
 *     `detectarConflictosGlobales` O(H × H × R) = cuadrático. Performance OK
 *     por scale DEMO; post-Supabase memoizar o computar server-side.
 *   - **Lookup DEMO_MATERIAS/DEMO_USERS por regla** dentro del loop: 1-3 lookups
 *     por h-iteración. Cost extra pero negligible.
 *   - Funciones PURAS (no mutaciones — read globals + retorna array/boolean/int).
 *   - **Pattern único admin** — detección de conflictos cross-entidad.
 *     Otros archivos validan unicidad simple (nombre case-insensitive).
 */
function verificarConflictos(horario) {
    const conflictos = [];

    _horariosFlat().forEach(h => {
        if (h.id === horario.id) return;
        if (h.dia !== horario.dia) return;
        if (!h.activo) return;
        if (!horariosSeSuperponen(h, horario)) return;

        if (h.aula && h.aula === horario.aula) {
            const materia = DEMO_MATERIAS.find(m => m.id === h.materiaId);
            conflictos.push(`Aula ${h.aula} ocupada por ${materia?.nombre || "otra materia"}`);
        }

        if (h.profesorId && h.profesorId === horario.profesorId) {
            const profesor = DEMO_USERS.find(u => u.id === h.profesorId);
            const grupoOtro = h.grupoId && h.grupoId !== horario.grupoId ? ` (grupo ${h.grupoId})` : "";
            conflictos.push(`Profesor ${profesor?.nombre || "—"} ya tiene clase${grupoOtro}`);
        }

        if (h.grupoId && h.grupoId === horario.grupoId) {
            const materia = DEMO_MATERIAS.find(m => m.id === h.materiaId);
            conflictos.push(`Grupo ${h.grupoId} ya tiene ${materia?.nombre || "otra clase"} a esa hora`);
        }
    });

    return conflictos;
}

function tieneConflicto(horario) {
    return verificarConflictos(horario).length > 0;
}

function horariosSeSuperponen(h1, h2) {
    const inicio1 = parseInt((h1.horaInicio || "0:0").replace(":", ""));
    const fin1    = parseInt((h1.horaFin    || "0:0").replace(":", ""));
    const inicio2 = parseInt((h2.horaInicio || "0:0").replace(":", ""));
    const fin2    = parseInt((h2.horaFin    || "0:0").replace(":", ""));
    return (inicio1 < fin2 && fin1 > inicio2);
}

function detectarConflictosGlobales() {
    let total = 0;
    _horariosFlat().forEach(h => {
        if (h.activo && tieneConflicto(h)) total++;
    });
    return total;
}
