// ═══════════════════════════════════════════════════════════
// HUB DE APRENDIZAJE — Centro unificado del estudiante
// Materias · Tareas · Recursos · Grupo + entrega/prórroga/historial
//
// Este archivo concentra TODO el flujo del estudiante.
// Se eliminaron js/estudiante/tareas.js y js/estudiante/recursos.js
// para evitar duplicación de render y bugs de divergencia
// (e.g., card sin botón Entregar en el hub mientras sí en standalone).
// ═══════════════════════════════════════════════════════════

// ── State global ───────────────────────────────────────────
let hubMateriaActiva = null;   // materia abierta en el detalle del hub

// Datos del alumno (rehidratados por _refreshAprendizajeData en materias.js)
let TAREAS_DATA          = [];
let RECURSOS_ALUMNO_DATA = [];
let HISTORIAL_DATA       = [];

// Estado de modales
let _tareaEntregaId  = null;
let _tareaProrrogaId = null;
const _sessionFiles  = new Map();   // file blobs subidos en la sesión actual

// ═══════════════════════════════════════════════════════════
// CONSTANTES (unificadas desde tareas.js + recursos.js)
// ═══════════════════════════════════════════════════════════

// Umbral UI (en días) para mostrar la alerta de cierre de periodo.
const PERIODO_AVISO_DIAS = 15;

// Icono por extensión/tipo. Unifica HIST_ICONOS + REC_ICONOS + ad-hoc.
const ICONOS_TIPO = {
    PDF:   "📄",
    VIDEO: "🎬",
    PPT:   "📊",
    ZIP:   "🗜️",
    DOCX:  "📝",
    DOC:   "📎",
    IMG:   "🖼️",
    default: "📎",
};

// Color CSS por color-key. Unifica HIST_COLOR_MAP + REC_COLOR_MAP.
const COLOR_MAP = {
    cyan:   ["xahni-blue-dim",   "xahni-cyan"],
    teal:   ["xahni-teal-dim",   "xahni-teal"],
    amber:  ["xahni-amber-dim",  "xahni-amber"],
    green:  ["xahni-green-dim",  "xahni-green"],
    purple: ["xahni-purple-dim", "xahni-purple-light"],
};

// ═══════════════════════════════════════════════════════════
// FORMAT & UTIL HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * @interaction hub-aprendizaje-format-helpers
 * @scope estudiante-hub-aprendizaje-helper-format
 *
 * Given bytes / nombre / Date.
 * When builders muestran tamaños, tipos archivo, fechas legibles.
 * Then 3 helpers utility combined:
 *   - `_formatBytes(bytes)`: humaniza a B/KB/MB/GB con loop while ≥1024.
 *     "—" fallback si null. Decimal solo si v < 10 y unit > 0.
 *   - `_tipoFromNombre(nombre)`: extensión uppercase + lookup contra 5
 *     buckets (IMG/PDF/ZIP/DOCX/PPT) + fallback ext o "FILE".
 *   - `_formatFecha(date)`: toLocaleDateString "es-MX" {day:2-digit,
 *     month:short, year:numeric}. "15 mar 2026".
 * Edge:
 *   - **Twin asimetría con `_recTipoDesdeNombre` profesor**: estudiante
 *     mapea a 5 buckets (incluye IMG); profesor a 5 distintos (jpg→PDF).
 *   - Función PURA.
 *   - Helpers LOCALES.
 */
function _formatBytes(bytes) {
    if (!bytes && bytes !== 0) return "—";
    const units = ["B","KB","MB","GB"];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + " " + units[i];
}

function _tipoFromNombre(nombre) {
    const ext = (nombre || "").split(".").pop().toUpperCase();
    if (["PNG","JPG","JPEG","GIF","WEBP","SVG"].includes(ext)) return "IMG";
    if (["PDF"].includes(ext))                                 return "PDF";
    if (["ZIP","RAR","7Z","TAR","GZ"].includes(ext))           return "ZIP";
    if (["DOC","DOCX"].includes(ext))                          return "DOCX";
    if (["PPT","PPTX"].includes(ext))                          return "PPT";
    return ext || "FILE";
}

function _formatFecha(date) {
    return date.toLocaleDateString("es-MX", { day:"2-digit", month:"short", year:"numeric" });
}

// Devuelve un objeto periodo derivado del grupo del alumno actual.
// - Si hay materia activa en el hub, usa su periodoInfo (que ya viene
//   resuelto desde el grupo del estudiante via data-provider).
// - Si no, lee directo del primer grupo del usuario.
// - Retorna null cuando no hay datos suficientes (UI oculta el panel).
/**
 * @interaction hub-aprendizaje-periodo-helpers
 * @scope estudiante-hub-aprendizaje-helper-periodo
 *
 * Given hubMateriaActiva o APP.user.
 * When builders recursos/calendar/tareas necesitan periodo activo o
 *   countdown al cierre.
 * Then 2 helpers combined:
 *   - `_getPeriodoVigenteAlumno()`: cascada:
 *     1. `hubMateriaActiva.periodoInfo` si existe (contexto materia).
 *     2. `getPeriodoDeGrupo(user.grupos[0])` shared.
 *     Retorna `{inicio, fin, nombre}` o null.
 *   - `_diasAlCierre(periodo)`: countdown desde now → fin del periodo.
 *     `Math.ceil` para evitar "0 días" con periodo abierto.
 * Edge:
 *   - **Asimetría con profesor `_profPeriodoActivo`**: alumno cascada
 *     (materia → primer grupo); profesor usa primera materia → primer grupo.
 *   - **Math.ceil convention** consistente cross-rol.
 *   - Funciones PURAS.
 *   - Helpers LOCALES.
 */
function _getPeriodoVigenteAlumno() {
    if (hubMateriaActiva?.periodoInfo) {
        return {
            inicio: hubMateriaActiva.periodoInfo.inicio,
            fin:    hubMateriaActiva.periodoInfo.fin,
            nombre: hubMateriaActiva.periodoInfo.nombre
                || ("Periodo de " + hubMateriaActiva.nombre),
        };
    }
    if (!APP?.user?.id) return null;
    const user   = (typeof DEMO_USERS !== "undefined") ? DEMO_USERS.find(u => u.id === APP.user.id) : null;
    const gid    = user?.grupos?.[0];
    if (!gid || typeof getPeriodoDeGrupo !== "function") return null;
    const periodo = getPeriodoDeGrupo(gid);
    if (!periodo) return null;
    return {
        inicio: new Date(periodo.inicio),
        fin:    new Date(periodo.fin),
        nombre: periodo.nombre || "Periodo actual",
    };
}

function _diasAlCierre(periodo) {
    const p = periodo || _getPeriodoVigenteAlumno();
    if (!p?.fin) return null;
    const hoy  = new Date();
    const diff = p.fin - hoy;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * @interaction hub-aprendizaje-color-key-from-var
 * @scope estudiante-hub-aprendizaje-helper-color
 *
 * Given cssVar string ("var(--xahni-{name})").
 * When builder necesita el color key string (sin var wrapper) para
 *   clases CSS.
 * Then lookup en map 6 entries → key string.
 * Edge:
 *   - **`blue → cyan`**: asimetría cementada (var-blue base muy oscura,
 *     usar cyan en UI key — mismo issue documentado en otros archivos del rol).
 *   - Default fallback "teal".
 *   - Función PURA.
 *   - Helper LOCAL.
 */
function _colorKeyFromVar(cssVar) {
    const map = {
        "var(--xahni-cyan)":   "cyan",
        "var(--xahni-teal)":   "teal",
        "var(--xahni-amber)":  "amber",
        "var(--xahni-green)":  "green",
        "var(--xahni-purple)": "purple",
        "var(--xahni-blue)":   "cyan",
    };
    return map[cssVar] || "teal";
}

// ═══════════════════════════════════════════════════════════
// DATA REFRESH (alimentado desde data-provider.js)
// ═══════════════════════════════════════════════════════════

/**
 * @interaction hub-aprendizaje-refresh-helpers
 * @scope estudiante-hub-aprendizaje-data-sync
 *
 * Given APP.user activo.
 * When `_refreshAprendizajeData` (materias.js orchestrator) o builders
 *   necesitan re-hidratar globals.
 * Then 3 helpers combined:
 *   - `_refreshTareasData()`: TAREAS_DATA ← `getTareasAlumno(uid)`.
 *   - `_refreshRecursosAlumnoData()`: RECURSOS_ALUMNO_DATA ←
 *     `getRecursosAlumno(uid)`.
 *   - `_refreshHistorialData()`: HISTORIAL_DATA ← `getHistorialAlumno(uid)`
 *     + **mezcla extras localStorage** del histórico freeform al inicio.
 * Edge:
 *   - **Reasign total** (no diff incremental) — pattern legacy.
 *   - **`_refreshHistorialData` mezcla extras al INICIO** del array
 *     (más recientes primero). Pattern asimétrico vs tareas/recursos
 *     que solo reasignan.
 *   - Helpers LOCALES.
 *   - Funciones IMPURAS.
 */
function _refreshTareasData() {
    if (typeof getTareasAlumno === "function" && APP?.user?.id) {
        TAREAS_DATA = getTareasAlumno(APP.user.id);
    }
}

function _refreshRecursosAlumnoData() {
    if (typeof getRecursosAlumno === "function" && APP?.user?.id) {
        RECURSOS_ALUMNO_DATA = getRecursosAlumno(APP.user.id);
    }
}

function _refreshHistorialData() {
    if (typeof getHistorialAlumno === "function" && APP?.user?.id) {
        HISTORIAL_DATA = getHistorialAlumno(APP.user.id);
    }
    // Mezclar uploads "freeform" persistidos en localStorage
    const extras = _loadHistorialExtra();
    if (extras.length) HISTORIAL_DATA = [...extras, ...HISTORIAL_DATA];
}

// ═══════════════════════════════════════════════════════════
// PERSISTENCIA LOCAL — entregas, historial extra, recursos vistos
// ═══════════════════════════════════════════════════════════

/**
 * @interaction hub-aprendizaje-entregas-persistence
 * @scope estudiante-hub-aprendizaje-persistence-entregas
 *
 * Given APP.user.id + tareaId + entrega shape.
 * When user submits entrega o `hidratarEntregasUsuario` restaura al login.
 * Then 4 helpers persistencia localStorage para entregas:
 *   - `_entregasKey()`: `xahni_entregas_${uid}` namespaced por user.
 *   - `_loadEntregasUsuario()`: JSON.parse defensive (try/catch + []).
 *   - `_saveEntregasUsuario(arr)`: JSON.stringify.
 *   - `_persistirEntregaLocal(tareaId, entrega)`: upsert pattern
 *     (findIndex + replace o push) + save.
 * Edge:
 *   - **Key namespaced por uid**: múltiples users en mismo browser sin
 *     colisión. Cementado cross-rol (mismo pattern profesor).
 *   - **try/catch defensive** porque localStorage puede fallar en modo
 *     privado.
 *   - **Upsert in-place** preserva references de array.
 *   - Funciones LOCALES.
 *   - Deuda post-Supabase: tabla `entregas` con RLS por uid.
 */
function _entregasKey() {
    const uid = APP?.user?.id;
    return uid ? `xahni_entregas_${uid}` : null;
}

function _loadEntregasUsuario() {
    const k = _entregasKey();
    if (!k) return [];
    try {
        const raw = localStorage.getItem(k);
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

function _saveEntregasUsuario(arr) {
    const k = _entregasKey();
    if (k) localStorage.setItem(k, JSON.stringify(arr));
}

function _persistirEntregaLocal(tareaId, entrega) {
    const data = _loadEntregasUsuario();
    const idx  = data.findIndex(e => e.tareaId === tareaId);
    const reg  = { tareaId, ...entrega };
    if (idx >= 0) data[idx] = reg;
    else          data.push(reg);
    _saveEntregasUsuario(data);
    // Sweep 2026-06-08: dispatch granular por (uid, tareaId) para que
    // firestore-sync escriba en entregas/{uid}/items/{tareaId}.
    const uid = APP?.user?.id;
    if (uid) {
        try {
            document.dispatchEvent(new CustomEvent("xahni:entregaActualizada", {
                detail: { uid, tareaId, entrega: reg }
            }));
        } catch (_) { /* defensive */ }
    }
}

/**
 * @interaction hidratar-entregas-usuario
 * @scope estudiante-hub-aprendizaje-bootstrap
 *
 * Given user logueado + DEMO_TAREAS cargado.
 * When boot block tras `DataService.init()` invoca para restaurar
 *   entregas localStorage → DEMO_TAREAS.
 * Then itera persistidas:
 *   1. Lookup tarea por id. Sin → skip.
 *   2. Asegura `t.entregas[]`.
 *   3. Construye nueva entrega: `{uid, fecha, archivos, calificacion
 *      (preserva si existente), comentario}`.
 *   4. `Object.assign` in-place si existente; push si nueva.
 * Edge:
 *   - **`calificacion` PRESERVED**: si DEMO ya tiene cal del profesor,
 *     no se sobrescribe con null del localStorage. Decisión crítica:
 *     localStorage solo persiste lo que el alumno controla.
 *   - **Object.assign in-place** preserva references compartidos
 *     cross-módulos.
 *   - **Path BOOTSTRAP** — único caller del module-level.
 *   - **Exportado window** implícito (caller boot block).
 *   - Función IMPURA (muta DEMO_TAREAS).
 *   - Deuda post-Supabase: subscription real-time elimina necesidad.
 */
function hidratarEntregasUsuario() {
    if (!APP?.user?.id || typeof DEMO_TAREAS === "undefined") return;
    const persistidas = _loadEntregasUsuario();
    persistidas.forEach(p => {
        const t = DEMO_TAREAS.find(x => x.id === p.tareaId);
        if (!t) return;
        t.entregas = t.entregas || [];
        const existente = t.entregas.find(e => e.uid === APP.user.id);
        const nueva = {
            uid:           APP.user.id,
            fecha:         p.fecha,
            archivos:      p.archivos || [],
            calificacion:  existente?.calificacion ?? null,
            comentario:    p.comentario || "",
        };
        if (existente) Object.assign(existente, nueva);
        else           t.entregas.push(nueva);
    });
}

/**
 * @interaction hub-aprendizaje-extras-persistence
 * @scope estudiante-hub-aprendizaje-persistence-extras
 *
 * Given APP.user.id + arr / nada.
 * When user sube archivo freeform al historial o marca recurso visto.
 * Then 5 helpers persistence combined (2 grupos):
 *   - **Historial extra (3)**: `_historialExtraKey()` + `_loadHistorialExtra()`
 *     + `_saveHistorialExtra(arr)`. Key `xahni_historial_extra_${uid}`
 *     namespaced. Para uploads "freeform" no asociados a tareas DEMO.
 *   - **Recursos vistos (2)**: `_loadRecursosVistos()` +
 *     `_saveRecursosVistos(arr)`. Key `_RECURSOS_VISTOS_KEY` constante
 *     module-scope (NO namespaced — global cross-users). Para flag "Nuevo".
 * Edge:
 *   - **Asimetría key namespacing**: historial extra por uid (privado);
 *     recursos vistos GLOBAL (deuda menor — debería ser por uid también).
 *   - **try/catch defensive** en loaders.
 *   - Helpers LOCALES.
 *   - Deuda post-Supabase: tablas `historial_extra` y `recursos_vistos`
 *     ambas por uid con RLS.
 */
function _historialExtraKey() {
    const uid = APP?.user?.id;
    return uid ? `xahni_historial_extra_${uid}` : null;
}

function _loadHistorialExtra() {
    const k = _historialExtraKey();
    if (!k) return [];
    try {
        const raw = localStorage.getItem(k);
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

function _saveHistorialExtra(arr) {
    const k = _historialExtraKey();
    if (k) localStorage.setItem(k, JSON.stringify(arr));
    // Sweep 2026-06-08: dispatch para que firestore-sync persista en
    // historialExtra/{uid}.items cross-device.
    const uid = APP?.user?.id;
    if (uid) {
        try {
            document.dispatchEvent(new CustomEvent("xahni:historialExtraActualizado", {
                detail: { uid, items: arr || [] }
            }));
        } catch (_) { /* defensive */ }
    }
}

// ── Recursos vistos (badge "Nuevo") ──
// Sweep 2026-06-08: helper namespaced por uid (fix del bug "global cross-users"
// previo donde todos los alumnos en el mismo navegador compartían flags).
function _recursosVistosKey() {
    const uid = APP?.user?.id;
    return uid ? `xahni_recursos_vistos_${uid}` : null;
}

function _loadRecursosVistos() {
    const k = _recursosVistosKey();
    if (!k) return [];
    try {
        const raw = localStorage.getItem(k);
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

function _saveRecursosVistos(arr) {
    const k = _recursosVistosKey();
    if (!k) return;
    localStorage.setItem(k, JSON.stringify(arr));
    const uid = APP?.user?.id;
    if (uid) {
        try {
            document.dispatchEvent(new CustomEvent("xahni:recursosVistosActualizados", {
                detail: { uid, items: arr || [] }
            }));
        } catch (_) { /* defensive */ }
    }
}

// ═══════════════════════════════════════════════════════════
// HUB NAVIGATION — abrir/cerrar materia, switch de tabs
// ═══════════════════════════════════════════════════════════

/**
 * @interaction hub-palette-para
 * @scope estudiante-hub-aprendizaje-helper-paleta
 *
 * Given nombreMateria.
 * When `hubAbrirMateria` necesita color stripe + hex para banner/dot.
 * Then lookup en MATERIAS_DATA por nombre → `{color, hex}` con fallbacks.
 * Edge:
 *   - **Lookup por nombre (no id)** — asimetría con profesor que usa id.
 *     Decisión histórica: alumno hub usa nombre como input externo.
 *   - Fallback blue brand si no encontrada.
 *   - Función PURA.
 *   - Helper LOCAL.
 */
function _hubPalettePara(nombreMateria) {
    const m = (typeof MATERIAS_DATA !== "undefined" ? MATERIAS_DATA : [])
        .find(x => x.nombre === nombreMateria);
    if (m) return { color: m.color || "var(--xahni-blue)", hex: m.materiaColor || "#1b4fe4" };
    return { color: "var(--xahni-blue)", hex: "#1b4fe4" };
}

/**
 * @interaction hub-abrir-materia
 * @scope estudiante-hub-aprendizaje-overlay
 *
 * Given nombreMateria string opcional (default primera materia).
 * When user click `.x-materia-card` o `_buildMatCardProf` onclick equiv.
 * Then bootstrap overlay hub-materia:
 *   1. Default a `MATERIAS_DATA[0].nombre` si missing.
 *   2. Lookup materia + setea `hubMateriaActiva` global.
 *   3. Update topbar detalle (color dot + nombre + prof).
 *   4. Badge tareas pendientes count en el chip del tab Tareas.
 *   5. Hide lista, show detalle (swap-panel pattern).
 *   6. **Pieza D Task 10**: render parcial tabs en header del hub-materia
 *      (`alumnoMatRenderParcialTabs`).
 *   7. Tab default "calificaciones".
 * Edge:
 *   - **Asimetría: alumno overlay con `hubMateriaActiva` GLOBAL** vs profesor
 *     que usa `APP.profHubMatActivo`. Pattern legacy distinto. Deuda menor:
 *     unificar nombrado.
 *   - **Fallback shape** si materia no en MATERIAS_DATA: `{nombre, prof:"—",
 *     horario:"—", creditos:0, pct:0, promedio:0, color:0}`. Defensive.
 *   - Twin con profesor `profHubAbrirMateria` (mismo overlay swap-panel).
 *   - **Exportado window** (onclick inline cross-archivos).
 *   - Función IMPURA (state + DOM masivo).
 */
function hubAbrirMateria(nombreMateria) {
    if (!nombreMateria && typeof MATERIAS_DATA !== "undefined") {
        nombreMateria = MATERIAS_DATA[0].nombre;
    }
    const mat = typeof MATERIAS_DATA !== "undefined"
        ? MATERIAS_DATA.find(m => m.nombre === nombreMateria)
        : null;

    hubMateriaActiva = mat || { nombre: nombreMateria, prof:"—", horario:"—", creditos:0, pct:0, promedio:0, color:0 };

    const pal = _hubPalettePara(nombreMateria);

    // Topbar del detalle
    const colorDot  = document.getElementById("hub-det-color");
    const nomEl     = document.getElementById("hub-det-nombre");
    const profEl    = document.getElementById("hub-det-profesor");
    if (colorDot) colorDot.style.background = pal.hex;
    if (nomEl)    nomEl.textContent = nombreMateria;
    if (profEl)   profEl.textContent = hubMateriaActiva.prof ? "👨‍🏫 " + hubMateriaActiva.prof : "";

    // Badge de tareas pendientes de esta materia
    if (typeof TAREAS_DATA !== "undefined") {
        const pendientes = TAREAS_DATA.filter(t =>
            t.materia === nombreMateria && t.estado === "pendiente"
        ).length;
        const badgeEl = document.getElementById("hub-badge-tareas");
        if (badgeEl) {
            badgeEl.textContent = pendientes || "";
            badgeEl.style.display = pendientes ? "inline" : "none";
        }
    }

    // Mostrar detalle, ocultar lista
    document.getElementById("hub-lista-panel").style.display   = "none";
    document.getElementById("hub-detalle-panel").style.display = "block";

    // Elevar tabs P1/.../Final al header (Pieza D, Task 10)
    const _hubMatId   = hubMateriaActiva?.id || null;
    const _hubGrupoId = _hubAlumnoGrupoDeMateria(_hubMatId);
    if (_hubMatId && _hubGrupoId) {
        const _hubGmKey = `${_hubMatId}_${_hubGrupoId}`;
        const _hubPeriodo = (typeof getPeriodoInfo === "function" && typeof getPeriodoDeGrupo === "function")
            ? getPeriodoInfo(getPeriodoDeGrupo(_hubGrupoId))
            : null;
        if (_hubPeriodo) alumnoMatRenderParcialTabs(_hubGmKey, _hubPeriodo);
    }

    // Tab por defecto
    hubSwitchTab("calificaciones", document.querySelector(".hub-tab[data-tab='calificaciones']"));
}

/**
 * @interaction hub-cerrar-detalle
 * @scope estudiante-hub-aprendizaje-overlay
 *
 * Given overlay abierto.
 * When user click "← Volver".
 * Then `hubMateriaActiva = null` + swap reverso (hide detalle / show lista).
 * Edge:
 *   - **NO resetea otros estados** (parcial sticky, scroll positions).
 *     Decisión UX: preserva contexto cross-open.
 *   - Función IMPURA (state + DOM).
 */
function hubCerrarDetalle() {
    hubMateriaActiva = null;
    const det = document.getElementById("hub-detalle-panel");
    const lst = document.getElementById("hub-lista-panel");
    if (det) det.style.display = "none";
    if (lst) lst.style.display = "block";
}

/**
 * @interaction hub-switch-tab
 * @scope estudiante-hub-aprendizaje-tabs
 *
 * Given tab string + btn opcional.
 * When user click `.hub-tab` en el detalle de materia.
 * Then:
 *   1. Visual marca `.active` sobre btn.
 *   2. Show panel del tab, hide otros 5 (6 tabs total).
 *   3. **Gating Pieza D**: si parcial activo es "futuro" Y tab en
 *      `gatedTabs` (tareas, recursos) → render placeholder.
 *   4. Else dispatch al builder correspondiente:
 *      - calificaciones → `hubMateriaRenderCalificaciones`.
 *      - tareas → `buildTareasAlumno`.
 *      - recursos → `buildRecursosAlumno`.
 *      - juegos → `hubMateriaRenderJuegos`.
 *      - maestria → `hubMatRenderMaestria`.
 *   5. **Pieza D fix**: refresca `alumnoMatRenderParcialTabs` post-switch
 *      (active visual no se pierde con re-render).
 * Edge:
 *   - **6 tabs alumno** vs 8 tabs profesor (alumno no tiene Gestión/Asistencia).
 *   - **Gating tabs**: tareas + recursos (mismo gating que profesor).
 *     Calificaciones renderea siempre.
 *   - **Twin con profesor `profHubMatSwitchTab`** + asimetría rol.
 *   - **Exportado window** (onclick inline tabs).
 *   - Función IMPURA (DOM + dispatch).
 */
function hubSwitchTab(tab, btn) {
    if (btn) {
        btn.parentElement.querySelectorAll(".hub-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
    }
    const tabs = ["calificaciones", "tareas", "examenes", "recursos", "juegos", "temario", "maestria"];
    tabs.forEach(t => {
        const el = document.getElementById("hub-panel-" + t);
        if (el) el.style.display = (t === tab) ? "" : "none";
    });

    // Pieza D 2026-05-23: gating de tabs según estado del parcial activo.
    // Tareas / Recursos muestran placeholder cuando el parcial está en
    // "futuro" (espejo del profesor). Calificaciones y Juegos renderean
    // normalmente.
    const futuro = (typeof _alumnoIsParcialFuturo === "function") && _alumnoIsParcialFuturo();
    const parcialNum = _alumnoParcialActivoActual();
    const gatedTabs = ["tareas", "recursos"];

    if (futuro && gatedTabs.includes(tab)) {
        _alumnoRenderParcialFuturoPlaceholder("hub-panel-" + tab, parcialNum, tab);
    } else {
        // Disparar render del tab activo
        if (tab === "calificaciones" && typeof window.hubMateriaRenderCalificaciones === "function") {
            window.hubMateriaRenderCalificaciones();
        }
        if (tab === "tareas" && typeof buildTareasAlumno === "function") {
            buildTareasAlumno();
        }
        if (tab === "recursos" && typeof buildRecursosAlumno === "function") {
            buildRecursosAlumno();
        }
        if (tab === "juegos") {
            // Slice E2 Task 31 · 2026-06-05: dispatcher al renderer beta del panel.
            if (typeof renderPanelJuegosAlumno === "function" && typeof JuegosData === "object") {
                window._juegosCurrentMateriaId = hubMateriaActiva.id;
                window._juegosCurrentTema = "todos";
                renderPanelJuegosAlumno(hubMateriaActiva.id, "todos");
            } else if (typeof window.hubMateriaRenderJuegos === "function") {
                // fallback al render legacy
                window.hubMateriaRenderJuegos();
            }
        }
        if (tab === "examenes" && typeof window.hubMateriaRenderExamenes === "function") {
            // Sprint Examenes 2026-06-04: reemplaza chrome stub "post-Supabase".
            window.hubMateriaRenderExamenes();
        }
        if (tab === "maestria" && typeof window.hubMatRenderMaestria === "function") {
            window.hubMatRenderMaestria();
        }
        if (tab === "temario" && typeof TemarioRender !== "undefined") {
            // Sweep 2026-06-09 (Temario+IA): render alumno del tab Temario.
            const matId = (typeof hubMateriaActiva !== "undefined" && hubMateriaActiva)
                ? hubMateriaActiva.id : null;
            const panelEl = document.getElementById("hub-panel-temario");
            if (panelEl && matId) {
                panelEl.dataset.currentMatid = matId;
                TemarioRender.renderAlumno("hub-panel-temario", matId);
            }
        }
    }

    // Pieza D fix 2026-05-23: refrescar tabs de parcial al cambiar tab interno
    // para evitar que el active visual se pierda. Lee siempre desde
    // APP.alumnoParcialActivo (espejo profesor).
    if (typeof hubMateriaActiva !== "undefined" && hubMateriaActiva && typeof alumnoMatRenderParcialTabs === "function") {
        const matId = hubMateriaActiva.id;
        const gid = (typeof _hubAlumnoGrupoDeMateria === "function") ? _hubAlumnoGrupoDeMateria(matId) : null;
        const gmKey = `${matId}_${gid}`;
        const periodoInfo = (typeof getPeriodoInfo === "function" && typeof getPeriodoDeGrupo === "function" && gid)
            ? getPeriodoInfo(getPeriodoDeGrupo(gid))
            : null;
        if (periodoInfo) alumnoMatRenderParcialTabs(gmKey, periodoInfo);
    }
}

// ═══════════════════════════════════════════════════════════
// HUB: PERFIL GRUPO MÍNIMO (trasplante futuro a tab "Mi grupo" en B.2)
// ═══════════════════════════════════════════════════════════

/**
 * @interaction hub-render-perfil-grupo-min
 * @scope estudiante-hub-aprendizaje-perfil-grupo-min
 *
 * Given targetId DOM + hubMateriaActiva con materia.
 * When sidebar del hub o caller cross-archivo necesita perfil grupo mini.
 * Then:
 *   1. Lookup grupo relacionado en GRUPOS_DATA por nombre materia.
 *   2. Sin grupo → empty state con CTA "Crear grupo".
 *   3. Render compuesto:
 *      - Banner 80px con bgGrad + emblema + nombre + 5 stars prestigio.
 *      - XP grupal display.
 *      - Card prestigio "Niv N → N+1" + bar amber gradient.
 *      - Badges: logros / miembros / activo.
 *      - Botón "Ver detalle completo →" → `showView('aprendizaje') +
 *        setTimeout(abrirDetalleGrupo)` cross-navigation.
 * Edge:
 *   - **Trasplante futuro a tab "Mi grupo" en B.2** (comentario inline).
 *     Hoy vive aquí; futura migración a hub-grupo.
 *   - **setTimeout 100ms** para esperar render del nuevo view antes de
 *     abrir detalle. Pattern fire-and-forget cross-view nav.
 *   - **Exportado window** (consumer cross-archivo).
 *   - Función IMPURA (DOM).
 */
function _hubRenderPerfilGrupoMin(targetId) {
    const el = document.getElementById(targetId || "grupos-lista-panel");
    if (!el || !hubMateriaActiva) return;

    const matNombre = hubMateriaActiva.nombre;

    const grupoRel = typeof GRUPOS_DATA !== "undefined"
        ? GRUPOS_DATA.find(g => g.materia === matNombre)
        : null;

    if (!grupoRel) {
        el.innerHTML = `
        <div class="x-empty">
            <div class="x-empty__icon">👥</div>
            <div class="x-empty__title">Sin grupo para esta materia</div>
            <div class="x-empty__desc">Únete o crea un grupo de estudio para colaborar y ganar XP grupal.</div>
            <button class="x-btn x-btn--primary" style="font-size:13px;padding:10px 20px"
                onclick="openModal('modal-crear-grupo')">+ Crear grupo</button>
        </div>`;
        return;
    }

    const pct = Math.round((grupoRel.xpGrupal / grupoRel.xpMax) * 100);
    const stars = Array.from({length:5}, (_,i) =>
        `<span style="font-size:14px;opacity:${i < grupoRel.prestigioNivel ? 1 : 0.2};filter:${i < grupoRel.prestigioNivel ? 'drop-shadow(0 0 4px #f5a623)' : 'none'}">★</span>`
    ).join("");

    el.innerHTML = `
    <div style="height:80px;border-radius:var(--r-lg);overflow:hidden;position:relative;margin-bottom:16px;background:${grupoRel.bgGrad}">
        <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:20px 20px"></div>
        <div style="position:absolute;inset:0;display:flex;align-items:center;gap:16px;padding:0 20px">
            <span style="font-size:36px">${grupoRel.emblema}</span>
            <div>
                <div style="font-family:var(--font-display);font-size:18px;font-weight:700;color:#fff">${grupoRel.nombre}</div>
                <div style="display:flex;gap:4px;margin-top:2px">${stars}</div>
            </div>
            <div style="margin-left:auto;text-align:right">
                <div style="font-size:10px;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.05em">XP Grupal</div>
                <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:#fff">${grupoRel.xpGrupal.toLocaleString()}</div>
            </div>
        </div>
    </div>

    <div class="card" style="margin-bottom:14px;padding:14px 18px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:12px;color:var(--text-secondary)"><svg class="x-icon"><use href="#x-icon-sparkle"></use></svg> Prestigio Niv. ${grupoRel.prestigioNivel} → ${grupoRel.prestigioNivel + 1}</span>
            <span style="font-family:var(--font-mono);font-size:11px;color:var(--xahni-amber)">${grupoRel.xpGrupal} / ${grupoRel.xpMax} XP</span>
        </div>
        <div style="height:8px;background:var(--surface-3);border-radius:99px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--xahni-amber),#ff9500);border-radius:99px;box-shadow:0 0 8px rgba(245,166,35,.5)"></div>
        </div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span class="badge amber"><svg class="x-icon"><use href="#x-icon-medal"></use></svg> ${grupoRel.logrosObtenidos}/${grupoRel.logrosTotal} logros</span>
            <span class="badge blue">👥 ${grupoRel.miembros} miembros</span>
            <span class="badge ${grupoRel.activo ? 'green' : 'muted'}">${grupoRel.activo ? '● Activo' : '○ Inactivo'}</span>
        </div>
        <button class="x-btn x-btn--ghost" style="font-size:12px"
            onclick="showView('aprendizaje');setTimeout(()=>{abrirDetalleGrupo('${grupoRel.id}')},100)">
            Ver detalle completo →
        </button>
    </div>`;
}
window._hubRenderPerfilGrupoMin = _hubRenderPerfilGrupoMin;

// ═══════════════════════════════════════════════════════════
// REBIND DE CARDS DE MATERIA — onclick → hubAbrirMateria
// ═══════════════════════════════════════════════════════════

/**
 * @interaction hub-rebind-materia-cards
 * @scope estudiante-hub-aprendizaje-rebind
 *
 * Given materias-grid con `.x-materia-card` (dataset.materia).
 * When `filtrarMaterias` (materias.js) repaint filtered → cards perdieron
 *   wire onclick.
 * Then itera cards + wires `onclick = () => hubAbrirMateria(nombre)`.
 * Edge:
 *   - **Re-wire pattern POST-filter**: necesario porque innerHTML reset
 *     destruye event listeners. Alternativa delegated (más eficiente)
 *     no implementada — deuda menor.
 *   - Sin dataset.materia → skip silent.
 *   - **Exportado window** (caller filtrarMaterias cross-archivo).
 *   - Función IMPURA (DOM).
 */
function hubRebindMateriaCards() {
    document.querySelectorAll("#materias-grid .x-materia-card").forEach(card => {
        const nombre = card.dataset.materia;
        if (nombre) {
            card.onclick = () => hubAbrirMateria(nombre);
            card.style.cursor = "pointer";
        }
    });
}

// ═══════════════════════════════════════════════════════════
// TAREAS — entry, métricas, lista, filtros, switch tabs
// ═══════════════════════════════════════════════════════════

/**
 * @interaction build-tareas-alumno
 * @scope estudiante-hub-aprendizaje-tareas-entrypoint
 *
 * Given filtro opcional (default "todas").
 * When `hubSwitchTab("tareas")` o caller cross-archivo invoca.
 * Then orchestrator 3 pasos:
 *   1. Refresh TAREAS_DATA.
 *   2. Build métricas (4 KPIs).
 *   3. Build lista filtrada.
 * Edge:
 *   - **Exportado window** (consumer cross-archivo + hub switch).
 *   - Función IMPURA (DOM via sub-builds).
 */
function buildTareasAlumno(filtro) {
    _refreshTareasData();
    _buildTareasMetricas();
    _buildTareasLista(filtro || "todas");
}

/**
 * @interaction build-tareas-metricas
 * @scope estudiante-hub-aprendizaje-tareas-kpis
 *
 * Given TAREAS_DATA hidratado + DOM `#tareas-metricas`.
 * When `buildTareasAlumno` orquesta.
 * Then 4 metric-cards homogéneos con profesor (blue/teal/purple/amber):
 *   - Total + delta count + pct completado.
 *   - Pendientes + delta urgentes (≤2 días) si > 0.
 *   - Entregadas + delta promedio cal si > 0.
 *   - Vencidas + delta "Habla con profesor" si > 0.
 * Edge:
 *   - **Twin EXACTO con `_buildProfDashKPIs`** estructura visual.
 *   - **`urgentes` umbral ≤ 2 días** — convención DEMO.
 *   - Promedio solo si conCal.length > 0 (— fallback).
 *   - Función IMPURA (DOM).
 *   - Helper LOCAL.
 */
function _buildTareasMetricas() {
    const el = document.getElementById("tareas-metricas");
    if (!el) return;
    const total      = TAREAS_DATA.length;
    const pendientes = TAREAS_DATA.filter(t => t.estado === "pendiente").length;
    const entregadas = TAREAS_DATA.filter(t => t.estado === "entregada").length;
    const vencidas   = TAREAS_DATA.filter(t => t.estado === "vencida").length;
    const urgentes   = TAREAS_DATA.filter(t => t.estado === "pendiente" && t.diasRestantes <= 2).length;
    const conCal     = TAREAS_DATA.filter(t => typeof t.calificacion === "number");
    const promCal    = conCal.length
        ? (conCal.reduce((a, t) => a + t.calificacion, 0) / conCal.length).toFixed(1)
        : "—";
    const pctCompletadas = total ? Math.round((entregadas / total) * 100) : 0;

    // Homogéneo con Tareas profesor: 4 cards en orden Total / Pendientes /
    // Entregadas / Vencidas con la misma paleta (blue / teal / purple / amber).
    el.innerHTML = [
        { label:"Total",       value:total,      icon:"📋", type:"blue",
          delta:`${total === 1 ? "tarea" : "tareas"} este periodo · ${pctCompletadas}% completado`, dt:"neutral" },
        { label:"Pendientes",  value:pendientes, icon:"▶",  type:"teal",
          delta: urgentes > 0 ? `⚠️ ${urgentes} urgente${urgentes !== 1 ? "s" : ""} (≤ 2 días)` : (pendientes === 0 ? "Sin pendientes" : `${pendientes} por entregar`),
          dt: urgentes > 0 ? "neutral" : "up" },
        { label:"Entregadas",  value:entregadas, icon:"✓",  type:"purple",
          delta: entregadas === 0 ? "Sin entregas aún" : `Promedio ${promCal}`, dt:"up" },
        { label:"Vencidas",    value:vencidas,   icon:"⏰", type:"amber",
          delta: vencidas === 0 ? "¡Sin vencidas!" : `Habla con tu profesor`, dt: vencidas > 0 ? "neutral" : "up" },
    ].map(c => `
        <div class="metric-card ${c.type}">
            <div class="metric-icon ${c.type}">${c.icon}</div>
            <div class="metric-value">${c.value}</div>
            <div class="metric-label">${c.label}</div>
            <div class="metric-delta ${c.dt}">${c.delta}</div>
        </div>`).join("");
}

/**
 * @interaction fmt-fecha-prorroga
 * @scope estudiante-hub-aprendizaje-helper-fecha-prorroga
 *
 * Given iso string o plain.
 * When `_buildTareasLista` muestra fecha en chip prórroga aprobada o tooltip
 *   historial.
 * Then formato `DD-mmm` con meses array hardcoded español.
 * Edge:
 *   - **Sufijo `T00:00:00`** si string length 10 (YYYY-MM-DD sin time) para
 *     evitar TZ shift (mismo pattern `_tpFormatDate` profesor).
 *   - Date inválido → iso raw fallback.
 *   - **Locale "es" hardcoded** (acumulado cross-rol).
 *   - Función PURA.
 *   - Helper LOCAL.
 */
function _fmtFechaProrroga(iso) {
    if (!iso) return "—";
    const dt = new Date(iso + (typeof iso === "string" && iso.length === 10 ? "T00:00:00" : ""));
    if (isNaN(dt)) return iso;
    const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    return `${String(dt.getDate()).padStart(2, "0")}-${meses[dt.getMonth()]}`;
}

/**
 * @interaction build-tareas-lista
 * @scope estudiante-hub-aprendizaje-tareas-render-principal
 *
 * Given filtro estado + DOM `#tareas-lista` + hubMateriaActiva opcional.
 * When `buildTareasAlumno`, `filtrarTareas`, `hubFiltrarTareas` invocan.
 * Then renderer principal del tab (~170 LOC):
 *   1. Filter por estado + por materia si hub context.
 *   2. Empty state si vacío.
 *   3. Por tarea: `<article class="x-card">` con:
 *      - stripe color (4px).
 *      - tipo abrev (`_tpInferTipo` profesor cross-archivo + `_tpTipoAbrev`).
 *      - chip estado con dot (homogéneo profesor — Urgente/Pendiente/Entregada/Vencida).
 *      - timer urgencia (Hoy/Nd restantes/Entrega/Vencida).
 *      - ring progreso o calificación display (≥9 ok, ≥7 warn, else danger).
 *      - chip prórroga (4 estados: solicitada/aprobada/rechazada).
 *      - **Tooltip historial prórrogas previas** (slice prórrogas-polish).
 *      - Botón acción contextual:
 *        - pendiente → "Entregar →".
 *        - vencida + parcial cerrado → "🔒 Parcial cerrado" disabled.
 *        - vencida + prórroga aprobada → "Entregar con prórroga →".
 *        - vencida + prórroga pendiente → "⏳ Solicitada" disabled.
 *        - vencida sin prórroga → "Solicitar prórroga".
 * Edge:
 *   - **Twin asimétrico con profesor `_tpBuildList`**: alumno tiene
 *     entregar/prórroga; profesor tiene cerrar/eliminar.
 *   - **`_q(s)` inline `replace(/"/g, '&quot;')`** para tooltips multiline
 *     con `title=` HTML escape.
 *   - **5+ deps cross-archivo**: `_tpInferTipo`, `_tpTipoAbrev`,
 *     `_tpProgressRing`, `getProrrogaUsuario`, `getProrrogasHistoricoUsuario`,
 *     `isTareaParcialCerrado`. Defensive typeof en todos.
 *   - **Multi-state action matrix**: 5 estados + edge parcial cerrado override.
 *     Lógica densa pero clara.
 *   - **Slice cerrar-parcial-integracion**: bloqueo prórroga si parcial cerrado.
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM masivo).
 *   - **Renderer más grande del módulo en 14a**.
 */
function _buildTareasLista(filtro) {
    const el = document.getElementById("tareas-lista");
    if (!el) return;

    let data = filtro === "todas" ? TAREAS_DATA
             : TAREAS_DATA.filter(t => t.estado === filtro);

    // En contexto del hub: filtrar también por la materia activa
    if (hubMateriaActiva) {
        data = data.filter(t => t.materia === hubMateriaActiva.nombre);
    }

    if (!data.length) {
        el.innerHTML = `<div class="x-empty">
            <div class="x-empty__icon"><svg class="x-icon x-icon--xl"><use href="#x-icon-target"></use></svg></div>
            <div class="x-empty__title">No hay tareas en esta categoría</div>
            <div class="x-empty__desc">Cambia el filtro o regresa más tarde.</div>
        </div>`;
        return;
    }

    el.innerHTML = data.map(t => {
        const isUrgente   = t.estado === "pendiente" && t.diasRestantes <= 2;
        const isPendiente = t.estado === "pendiente";
        const isEntregada = t.estado === "entregada";
        const isVencida   = t.estado === "vencida";

        // Tipo abreviado: usa el inferidor compartido de profesor/tareas.js si está cargado.
        const tipoNombre = (typeof _tpInferTipo === "function") ? _tpInferTipo(t.titulo) : (t.tipo || "Tarea");
        const tipoAbrev  = (typeof _tpTipoAbrev === "object" && _tpTipoAbrev[tipoNombre])
            ? _tpTipoAbrev[tipoNombre]
            : (tipoNombre.slice(0, 3).toUpperCase());

        // Color del stripe: siempre el color de la materia (igual que en profesor).
        const stripeColor = t.color || "var(--xahni-teal)";

        // Chip de estado (homogéneo con Tareas profesor — chip con dot)
        const estadoMap = {
            pendiente: isUrgente
                ? { cls: "x-chip--danger", label: "Urgente",   dot: "var(--state-danger)" }
                : { cls: "x-chip--info",   label: "Pendiente", dot: "var(--state-info)" },
            entregada: { cls: "x-chip--ok",     label: "Entregada", dot: "var(--state-ok)" },
            vencida:   { cls: "x-chip--danger", label: "Vencida",   dot: "var(--state-danger)" },
        };
        const est = estadoMap[t.estado] || estadoMap.pendiente;

        // Timer / entrega
        let timerHTML = "";
        if (isPendiente) {
            if (t.diasRestantes <= 0)      timerHTML = `<span style="color:var(--state-danger);font-weight:700">⏱ Hoy</span>`;
            else if (t.diasRestantes <= 2) timerHTML = `<span style="color:var(--state-warn);font-weight:700">⏱ ${t.diasRestantes}d restantes</span>`;
            else                           timerHTML = `Entrega: <span style="color:var(--text-primary)">${t.fecha}</span>`;
        } else if (isEntregada) {
            timerHTML = t.fechaEntregaUser
                ? `<span style="color:var(--state-ok)">✓ Entregada</span>`
                : `Entrega: <span style="color:var(--text-primary)">${t.fecha}</span>`;
        } else if (isVencida) {
            timerHTML = `<span style="color:var(--state-danger)">⏰ Vencida</span>`;
        }

        // Ring de progreso o calificación (cuando ya hay cal, se muestra la nota en lugar del ring)
        let ringHTML;
        if (isEntregada && t.calificacion != null) {
            const calColor = t.calificacion >= 9 ? "var(--state-ok)"
                           : t.calificacion >= 7 ? "var(--state-warn)"
                           :                       "var(--state-danger)";
            ringHTML = `<span style="display:inline-flex;align-items:baseline;gap:2px"><span style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:${calColor}">${t.calificacion}</span><span style="font-size:10px;color:var(--text-muted)">/10</span></span>`;
        } else {
            const pct = isVencida ? 0 : (t.pct || 0);
            ringHTML = (typeof _tpProgressRing === "function")
                ? _tpProgressRing(pct, stripeColor)
                : `<span style="font-family:var(--font-mono);font-size:12px;color:${stripeColor}">${pct}%</span>`;
        }
        const ringLabel = isEntregada && t.calificacion != null ? "calificación"
                        : isVencida ? "sin entregar"
                        : "avance";

        // Estado de prórroga (slice prórrogas 2026-05-24).
        // Si el alumno tiene prórroga vigente para esta tarea, mostrar chip
        // y ajustar el botón primario para reflejar el estado.
        const pror = (typeof getProrrogaUsuario === "function" && APP?.user?.id)
            ? getProrrogaUsuario(t.id, APP.user.id)
            : null;
        let prorChipHTML = "";
        if (pror) {
            // Slice prórrogas-polish (pre-c10 #4): tooltip con historial previo
            // si el alumno tuvo prórrogas anteriores (la actual + N resueltas).
            // Concatenado al title= del chip activo. Multiline via \n (browsers
            // modernos lo respetan en title nativos).
            let histLines = "";
            if (typeof getProrrogasHistoricoUsuario === "function") {
                const todas = getProrrogasHistoricoUsuario(t.id, APP.user.id);
                if (todas.length > 1) {
                    histLines = todas.slice(1).map(p => {
                        const fecha = _fmtFechaProrroga(p.fechaResuelta || p.fechaSolicitud);
                        const nota = p.notaProfesor ? ` — ${p.notaProfesor}` : "";
                        return `• ${fecha}: ${p.estado}${nota}`;
                    }).join("\n");
                }
            }
            const _q = s => String(s).replace(/"/g, '&quot;');
            if (pror.estado === "pendiente") {
                const tip = histLines ? ` title="Historial previo:\n${_q(histLines)}"` : "";
                prorChipHTML = `<span class="x-chip x-chip--warn" style="font-size:10px"${tip}>📅 Prórroga solicitada</span>`;
            } else if (pror.estado === "aprobada") {
                const fmt = pror.nuevaFecha ? _fmtFechaProrroga(pror.nuevaFecha) : "—";
                const tip = histLines ? ` title="Historial previo:\n${_q(histLines)}"` : "";
                prorChipHTML = `<span class="x-chip x-chip--ok" style="font-size:10px"${tip}>📅 Prórroga aprobada · entrega ${fmt}</span>`;
            } else if (pror.estado === "rechazada") {
                const base = pror.notaProfesor ? `Motivo: ${pror.notaProfesor}` : "";
                const tipText = base + (histLines ? (base ? "\n\nHistorial previo:\n" : "Historial previo:\n") + histLines : "");
                const tip = tipText ? ` title="${_q(tipText)}"` : "";
                prorChipHTML = `<span class="x-chip x-chip--danger" style="font-size:10px"${tip}>📅 Prórroga rechazada</span>`;
            }
        }

        // Slice cerrar-parcial-integracion 2026-05-24: si la tarea
        // pertenece a un parcial cerrado, solicitar prórroga queda bloqueado
        // (la calificación es definitiva → no tiene sentido pedir más tiempo).
        const tareaCerrada = typeof isTareaParcialCerrado === "function"
            && isTareaParcialCerrado({
                materiaId:    t.materiaId,
                grupoId:      t.grupoId,
                fechaEntrega: t.fechaIso || t.fechaEntrega,
            });

        // Acción primaria (alumno):
        //   - Entregar si pendiente.
        //   - Si vencida sin prórroga o con prórroga rechazada → Solicitar prórroga (habilitado).
        //   - Si vencida con prórroga pendiente → botón disabled "Solicitada".
        //   - Si vencida con prórroga aprobada → Entregar (con prórroga) primary.
        //   - Si parcial cerrado → bloquear con chip "Parcial cerrado" (override del flujo).
        let actionBtn = "";
        if (isPendiente) {
            actionBtn = `<button class="x-btn x-btn--primary" style="padding:6px 14px;font-size:12px" onclick="abrirEntregarTarea('${t.id}')">Entregar →</button>`;
        } else if (isVencida) {
            if (tareaCerrada && (!pror || pror.estado !== "aprobada")) {
                // Parcial cerrado y no hay prórroga aprobada → no se puede actuar.
                actionBtn = `<button class="x-btn x-btn--ghost" style="padding:6px 12px;font-size:11px;opacity:.6;cursor:not-allowed" disabled title="Parcial cerrado · calificación definitiva">🔒 Parcial cerrado</button>`;
            } else if (pror && pror.estado === "aprobada") {
                actionBtn = `<button class="x-btn x-btn--primary" style="padding:6px 14px;font-size:12px" onclick="abrirEntregarTarea('${t.id}')">Entregar con prórroga →</button>`;
            } else if (pror && pror.estado === "pendiente") {
                actionBtn = `<button class="x-btn x-btn--ghost" style="padding:6px 12px;font-size:11px;opacity:.6;cursor:not-allowed" disabled>⏳ Solicitada</button>`;
            } else {
                actionBtn = `<button class="x-btn x-btn--ghost" style="padding:6px 12px;font-size:11px" onclick="abrirSolicitarProrroga('${t.id}')">Solicitar prórroga</button>`;
            }
        }

        return `<article class="x-card" style="padding:0;display:flex;align-items:stretch;overflow:hidden">
            <div style="width:4px;background:${stripeColor};flex-shrink:0"></div>
            <div style="width:56px;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:11px;font-weight:700;color:${stripeColor};letter-spacing:0.08em;flex-shrink:0;border-right:1px solid var(--border)">${tipoAbrev}</div>
            <div style="padding:14px 16px;flex:1;min-width:0">
                <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:6px">${t.titulo}</div>
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--text-muted);margin-bottom:8px">
                    <span style="font-weight:600;color:${stripeColor}">${t.materia}</span>
                    <span class="x-chip x-chip--info">${tipoNombre}</span>
                    ${prorChipHTML}
                </div>
                <div style="display:flex;align-items:center;gap:14px;font-size:11px;color:var(--text-muted);flex-wrap:wrap">
                    ${timerHTML ? `<span>${timerHTML}</span>` : ""}
                    <span style="display:inline-flex;align-items:center;gap:6px">${ringHTML}<span>${ringLabel}</span></span>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;padding:14px 16px;flex-shrink:0">
                <span class="x-chip ${est.cls}"><span style="width:6px;height:6px;border-radius:50%;background:${est.dot};display:inline-block;margin-right:4px"></span>${est.label}</span>
                ${actionBtn}
            </div>
        </article>`;
    }).join("");
}

/**
 * @interaction tareas-filtros-handlers
 * @scope estudiante-hub-aprendizaje-tareas-handlers
 *
 * Given filtro string + btn opcional.
 * When user click tab filtro estado tareas.
 * Then 3 handlers combined:
 *   - `filtrarTareas(filtro, btn)`: legacy `.cal-filtro-btn` selector
 *     global. Active toggle + rebuild lista.
 *   - `hubFiltrarTareas(filtro, btn)`: hub context con map
 *     {todas, pendientes, entregadas, vencidas} → estado interno + scope
 *     `#tareas-filtros-wrap` para evitar colisión.
 *   - `switchTareasTab(tab, btn)`: switch entre panels (tareas / archivos)
 *     + show/hide filtros wrap.
 * Edge:
 *   - **Asimetría legacy vs hub**: `filtrarTareas` (legacy view standalone)
 *     vs `hubFiltrarTareas` (hub context con map de aliases).
 *   - **Scope query crítico** en hub para no afectar otros `.x-tabs__tab`
 *     (mismo issue cementado en profesor gestion sesión 11).
 *   - **`switchTareasTab` panel-archivos**: tab adicional para historial
 *     dentro de tareas.
 *   - **Exportados window** (onclick inline).
 *   - Funciones IMPURAS.
 */
function filtrarTareas(filtro, btn) {
    document.querySelectorAll(".cal-filtro-btn").forEach(b => b.classList.remove("active"));
    if (btn) btn.classList.add("active");
    _buildTareasLista(filtro);
}

function hubFiltrarTareas(filtro, btn) {
    const map = {
        todas:       "todas",
        pendientes:  "pendiente",
        entregadas:  "entregada",
        vencidas:    "vencida",
    };
    const f = map[filtro] || filtro;
    // Estado visual: scope al wrapper de tareas para no afectar otros tabs (.x-tabs__tab
    // del hub principal o de otros panels).
    document.querySelectorAll("#tareas-filtros-wrap .x-tabs__tab").forEach(b => b.classList.remove("is-active"));
    if (btn) btn.classList.add("is-active");
    _buildTareasLista(f);
}

function switchTareasTab(tab, btn) {
    document.querySelectorAll(".tareas-inner-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const panelTareas   = document.getElementById("panel-tareas");
    const panelArchivos = document.getElementById("panel-archivos");
    const filtrosWrap   = document.getElementById("tareas-filtros-wrap");

    if (tab === "tareas") {
        panelTareas.style.display   = "block";
        panelArchivos.style.display = "none";
        filtrosWrap.style.display   = "flex";
    } else {
        panelTareas.style.display   = "none";
        panelArchivos.style.display = "block";
        filtrosWrap.style.display   = "none";
        // Resetear filtros/búsqueda del historial al abrir el panel para no
        // arrastrar el estado de la materia anterior.
        document.querySelectorAll("#panel-archivos .cal-filtro-btn")
            .forEach((b, i) => b.classList.toggle("active", i === 0));
        const histSearch = document.querySelector("#panel-archivos .topbar-search input");
        if (histSearch) histSearch.value = "";
        buildHistorialArchivos();
    }
}

// ═══════════════════════════════════════════════════════════
// HISTORIAL DE ARCHIVOS — periodo escolar + listado + filtros
// ═══════════════════════════════════════════════════════════

/**
 * @interaction build-historial-archivos
 * @scope estudiante-hub-aprendizaje-historial-render-principal
 *
 * Given dataFiltrada opcional + DOM con 4 anchors (badge + alerta + info-periodo + lista).
 * When `hubSwitchTab("archivos")` o `filtrarHistorial`/`filtrarHistorialTipo`
 *   invocan.
 * Then renderer principal (~160 LOC):
 *   1. Si sin dataFiltrada → refresh + filter por hubMateriaActiva si aplica.
 *   2. Resuelve periodo + diasRestant + periodoCerrado.
 *   3. **Banner alerta 3-estados**:
 *      - periodoCerrado → peligro 🔴 "Eliminación 24h" + botón "Descargar todo".
 *      - diasRestant ≤ PERIODO_AVISO_DIAS → urgente (≤5) o aviso (>5).
 *      - Else → hidden.
 *   4. **Info periodo card** con stats (archivos count + size total + días).
 *   5. **Lista archivos** sorted desc por fecha con:
 *      - Icon tipo + color materia.
 *      - Nombre + meta (badge materia · tarea).
 *      - Fecha + size mono.
 *      - Botón descargar (urgente=highlight si ≤5 días) + eliminar 🗑.
 * Edge:
 *   - **Twin pattern con profesor `_buildProfDashActivity`** estructura similar.
 *   - **Flavor text "24h eliminación"** sin auto-delete real (DEMO).
 *   - **`PERIODO_AVISO_DIAS` constante** module-scope.
 *   - **Lookup `COLOR_MAP[f.color]`** con destructuring + fallback.
 *   - innerHTML directo en `f.nombre`/`f.materia` (DEMO controlado).
 *   - **Acción eliminar** dispara `confirmarEliminarHistorial(id, nombre)`
 *     (interpolación inline — seguro porque ids son numéricos).
 *   - Función IMPURA (DOM masivo).
 *   - **Renderer más grande del tab historial**.
 */
function buildHistorialArchivos(dataFiltrada) {
    if (!dataFiltrada) _refreshHistorialData();
    let data          = dataFiltrada || HISTORIAL_DATA;

    // En contexto del hub (dentro de una materia), filtrar por la materia activa
    if (!dataFiltrada && hubMateriaActiva) {
        data = data.filter(f => f.materia === hubMateriaActiva.nombre);
    }

    const periodo     = _getPeriodoVigenteAlumno();
    const diasRestant = _diasAlCierre(periodo);
    const periodoCerrado = diasRestant !== null && diasRestant <= 0;

    const badgeEl = document.getElementById("badge-archivos-count");
    if (badgeEl) badgeEl.textContent = data.length;

    // ── Alerta de cierre del periodo ──
    const alertaEl = document.getElementById("historial-alerta");
    if (alertaEl) {
        if (!periodo || diasRestant === null) {
            alertaEl.innerHTML = "";
            alertaEl.style.display = "none";
        } else if (periodoCerrado) {
            alertaEl.className = "historial-alerta alerta-peligro";
            alertaEl.innerHTML = `
                <div class="historial-alerta-icono">🔴</div>
                <div class="historial-alerta-cuerpo">
                    <div class="historial-alerta-titulo">Periodo escolar cerrado — Archivos programados para eliminación</div>
                    <div class="historial-alerta-desc">
                        El periodo <strong>${periodo.nombre}</strong> ha concluido.
                        Tus archivos serán eliminados permanentemente en las próximas 24 horas.
                        Descárgalos ahora si deseas conservarlos.
                    </div>
                </div>
                <button class="x-btn x-btn--primary" style="font-size:12px;padding:8px 16px;margin-top:0;flex-shrink:0;white-space:nowrap"
                    onclick="descargarTodosHistorial()">↓ Descargar todo</button>`;
            alertaEl.style.display = "flex";
        } else if (diasRestant <= PERIODO_AVISO_DIAS) {
            const urgente = diasRestant <= 5;
            alertaEl.className = `historial-alerta ${urgente ? "alerta-urgente" : "alerta-aviso"}`;
            alertaEl.innerHTML = `
                <div class="historial-alerta-icono">${urgente ? "⚠️" : "📅"}</div>
                <div class="historial-alerta-cuerpo">
                    <div class="historial-alerta-titulo">
                        ${urgente ? "¡Atención!" : "Aviso:"} El periodo escolar cierra en <strong>${diasRestant} día${diasRestant !== 1 ? "s" : ""}</strong>
                    </div>
                    <div class="historial-alerta-desc">
                        Al cerrar el <strong>${_formatFecha(periodo.fin)}</strong>, todos tus archivos del periodo
                        <em>${periodo.nombre}</em> serán eliminados automáticamente del sistema.
                        Descarga los que quieras conservar antes de esa fecha.
                    </div>
                </div>
                <button class="x-btn x-btn--primary" style="font-size:12px;padding:8px 16px;margin-top:0;flex-shrink:0;white-space:nowrap"
                    onclick="descargarTodosHistorial()">↓ Descargar todo</button>`;
            alertaEl.style.display = "flex";
        } else {
            alertaEl.style.display = "none";
        }
    }

    // ── Info del periodo ──
    const infoEl = document.getElementById("historial-info-periodo");
    if (infoEl) {
        if (!periodo) {
            infoEl.innerHTML = "";
        } else {
        const totalSize = data.reduce((s, f) => s + parseFloat(f.size), 0).toFixed(1);
        const spanPeriodo = periodo.fin - periodo.inicio;
        const pctTranscurrido = spanPeriodo > 0
            ? Math.min(Math.round(((new Date() - periodo.inicio) / spanPeriodo) * 100), 100)
            : 0;
        infoEl.innerHTML = `
            <div class="historial-periodo-header">
                <div>
                    <div class="historial-periodo-nombre">${periodo.nombre}</div>
                    <div class="historial-periodo-fechas">
                        ${_formatFecha(periodo.inicio)} — ${_formatFecha(periodo.fin)}
                    </div>
                </div>
                <div class="historial-periodo-stats">
                    <div class="historial-periodo-stat">
                        <span class="historial-periodo-stat-val">${data.length}</span>
                        <span class="historial-periodo-stat-label">archivos</span>
                    </div>
                    <div class="historial-periodo-stat">
                        <span class="historial-periodo-stat-val">${totalSize} MB</span>
                        <span class="historial-periodo-stat-label">almacenados</span>
                    </div>
                    <div class="historial-periodo-stat">
                        <span class="historial-periodo-stat-val" style="color:${diasRestant === null ? "var(--text-muted)" : diasRestant <= 5 ? "var(--xahni-red)" : diasRestant <= 15 ? "var(--xahni-amber)" : "var(--xahni-green)"}">
                            ${diasRestant === null ? "—" : diasRestant > 0 ? diasRestant + " días" : "Cerrado"}
                        </span>
                        <span class="historial-periodo-stat-label">para cierre</span>
                    </div>
                </div>
            </div>
            <div style="margin-top:10px">
                <div style="display:flex;justify-content:space-between;margin-bottom:5px">
                    <span style="font-size:11px;color:var(--text-muted)">Progreso del periodo</span>
                    <span style="font-size:11px;font-family:var(--font-mono);color:var(--text-muted)">${pctTranscurrido}%</span>
                </div>
                <div class="progress-bar" style="height:5px">
                    <div style="height:100%;width:${pctTranscurrido}%;background:var(--brand-gradient-h);border-radius:99px;transition:width 1s ease"></div>
                </div>
            </div>`;
        }
    }

    // ── Lista de archivos ──
    const listaEl = document.getElementById("historial-lista");
    if (!listaEl) return;

    if (!data.length) {
        listaEl.innerHTML = `
            <div class="x-empty">
                <div class="x-empty__icon"><svg class="x-icon x-icon--xl"><use href="#x-icon-search"></use></svg></div>
                <div class="x-empty__title">No se encontraron archivos</div>
            </div>`;
        return;
    }

    const sorted = [...data].sort((a, b) => b.fecha - a.fecha);

    listaEl.innerHTML = sorted.map(f => {
        const [bg, fg] = COLOR_MAP[f.color] || ["surface-3", "text-muted"];
        const icono    = ICONOS_TIPO[f.tipo] || ICONOS_TIPO.default;
        const esUrgente = diasRestant > 0 && diasRestant <= 5;

        return `
        <div class="historial-fila">
            <div class="historial-fila-icono" style="background:var(--${bg});color:var(--${fg})">
                ${icono}
            </div>
            <div class="historial-fila-info">
                <div class="historial-fila-nombre">${f.nombre}</div>
                <div class="historial-fila-meta">
                    <span class="badge muted" style="font-size:10px">${f.materia}</span>
                    <span style="font-size:11px;color:var(--text-muted)">·</span>
                    <span style="font-size:11px;color:var(--text-muted)">Tarea: ${f.tarea}</span>
                </div>
            </div>
            <div class="historial-fila-fecha">
                <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">${_formatFecha(f.fecha)}</div>
                <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${f.size}</div>
            </div>
            <div class="historial-fila-acciones">
                <button class="historial-btn-descargar ${esUrgente ? "urgente" : ""}"
                    onclick="showToast('Descargando ${f.nombre}...','info')"
                    title="Descargar archivo">
                    ↓ Descargar
                </button>
                <button class="historial-btn-eliminar"
                    onclick="confirmarEliminarHistorial(${f.id}, '${f.nombre}')"
                    title="Eliminar archivo">
                    🗑
                </button>
            </div>
        </div>`;
    }).join("");
}

/**
 * @interaction historial-base-y-badge
 * @scope estudiante-hub-aprendizaje-historial-helpers
 *
 * Given hubMateriaActiva opcional + DOM badge.
 * When `filtrarHistorial`/`filtrarHistorialTipo` necesitan base filtrada o
 *   caller cross-archivo refresca badge sin abrir panel.
 * Then 2 helpers combined:
 *   - `_historialBase()`: returns HISTORIAL_DATA filtered por materia del
 *     hub si activa, else completo.
 *   - `_actualizarBadgeArchivos()`: refresh data + setea textContent del
 *     badge.
 * Edge:
 *   - **Pattern hubMateriaActiva context filter** consistente cross-tab
 *     (tareas + recursos + historial todos lo usan).
 *   - DOM target ausente → no-op silent.
 *   - Helpers LOCALES.
 *   - Función PURA (`_historialBase`) + IMPURA (`_actualizarBadgeArchivos`).
 */
function _historialBase() {
    return hubMateriaActiva
        ? HISTORIAL_DATA.filter(f => f.materia === hubMateriaActiva.nombre)
        : HISTORIAL_DATA;
}

// Refresca el contador del sub-tab "Mis Archivos" sin necesidad de abrir el panel.
function _actualizarBadgeArchivos() {
    const badgeEl = document.getElementById("badge-archivos-count");
    if (!badgeEl) return;
    _refreshHistorialData();
    badgeEl.textContent = _historialBase().length;
}

/**
 * @interaction historial-handlers-filtros-acciones
 * @scope estudiante-hub-aprendizaje-historial-handlers
 *
 * Given query / tipo+btn / nada.
 * When user interactúa con filtros o botón "Descargar todo".
 * Then 3 handlers combined:
 *   - `filtrarHistorial(query)`: trim+lowercase + filter cross-fields
 *     (nombre + materia + tarea includes).
 *   - `filtrarHistorialTipo(tipo, btn)`: tab filter por tipo archivo.
 *     Scope `#panel-archivos .cal-filtro-btn` para evitar colisión.
 *   - `descargarTodosHistorial()`: PLACEHOLDER fake bulk download con
 *     setTimeout 1800ms.
 * Edge:
 *   - **Search en 3 campos** (no solo nombre) — UX más flexible.
 *   - **Scope query crítico** (mismo issue cross-rol).
 *   - **PLACEHOLDER bulk download**: no ZIP real; toast simulado. Deuda
 *     post-Supabase Storage signed URLs + ZIP server-side.
 *   - Exportados window.
 *   - Funciones IMPURAS.
 */
function filtrarHistorial(query) {
    const q    = (query || "").trim().toLowerCase();
    const base = _historialBase();
    const out  = q
        ? base.filter(f =>
            f.nombre.toLowerCase().includes(q) ||
            f.materia.toLowerCase().includes(q) ||
            f.tarea.toLowerCase().includes(q))
        : base;
    buildHistorialArchivos(out);
}

function filtrarHistorialTipo(tipo, btn) {
    document.querySelectorAll("#panel-archivos .cal-filtro-btn").forEach(b => b.classList.remove("active"));
    if (btn) btn.classList.add("active");
    const base = _historialBase();
    buildHistorialArchivos(tipo === "todos" ? base : base.filter(f => f.tipo === tipo));
}

function descargarTodosHistorial() {
    const total = HISTORIAL_DATA.length;
    showToast(`Preparando descarga de ${total} archivos (ZIP)...`, "info");
    setTimeout(() => showToast("Descarga lista. Revisa tu carpeta de descargas.", "success"), 1800);
}

/**
 * @interaction confirmar-eliminar-historial
 * @scope estudiante-hub-aprendizaje-historial-handler-async
 *
 * Given id + nombre + DOM modal canonical.
 * When user click 🗑 en row historial.
 * Then async pipeline:
 *   1. `confirmarCanonico` shared con titulo + mensaje (escape nombre) +
 *      accionTexto "Eliminar" + tipo danger.
 *   2. Si cancela → return early.
 *   3. Si confirma → toast PLACEHOLDER (NO mutation real, DEMO).
 * Edge:
 *   - **async function** — única en hub-aprendizaje + única con await
 *     `confirmarCanonico`.
 *   - **`_escapeHtml(nombre)` canonical** para XSS-safety en mensaje.
 *   - **PLACEHOLDER mutation**: el toast simula success pero NO splice
 *     de HISTORIAL_DATA. Deuda: implementar real delete con persist
 *     localStorage para uploads freeform.
 *   - Exportado window.
 *   - Función IMPURA (toast).
 */
async function confirmarEliminarHistorial(id, nombre) {
    const ok = await confirmarCanonico({
        titulo: "Eliminar de historial",
        mensaje: `¿Eliminar <strong>${_escapeHtml(nombre)}</strong> de tu historial? Esta acción no se puede deshacer.`,
        accionTexto: "Eliminar",
        tipo: "danger",
    });
    if (!ok) return;
    showToast(`"${nombre}" eliminado del historial`, "info");
}

// ═══════════════════════════════════════════════════════════
// MODAL: ENTREGAR TAREA — persistencia en DEMO_TAREAS + localStorage
// ═══════════════════════════════════════════════════════════

/**
 * @interaction abrir-entregar-tarea
 * @scope estudiante-hub-aprendizaje-modal-entregar
 *
 * Given id tarea + DOM modal `modal-entregar-tarea`.
 * When user click "Entregar →" en card tarea pendiente.
 * Then bootstrap modal:
 *   1. Lookup tarea por id. Sin → no-op.
 *   2. Setea `_tareaEntregaId` module-scope state.
 *   3. Update breadcrumb (titulo + materia + tipo).
 *   4. Setea fecha con color urgencia (≤2 días → red).
 *   5. Setea stripe color materia.
 *   6. `_limpiarModalEntrega()` (reset).
 *   7. openModal canonical.
 * Edge:
 *   - **`String(t.id) === String(id)`** defensive (id mixed types).
 *   - **Twin con `editarRecurso` profesor recursos**: bootstrap modal con
 *     state pendiente.
 *   - Exportado window.
 *   - Función IMPURA.
 */
function abrirEntregarTarea(id) {
    const tarea = TAREAS_DATA.find(t => String(t.id) === String(id));
    if (!tarea) return;
    _tareaEntregaId = id;

    document.getElementById("entregar-modal-titulo").textContent  = tarea.titulo;
    document.getElementById("entregar-modal-materia").textContent = tarea.materia;
    document.getElementById("entregar-modal-tipo").textContent    = tarea.tipo;
    const fechaEl = document.getElementById("entregar-modal-fecha");
    if (fechaEl) {
        fechaEl.textContent = "📅 Entrega: " + tarea.fecha;
        fechaEl.style.color = tarea.diasRestantes <= 2 ? "var(--xahni-red)" : "var(--text-muted)";
    }
    const stripe = document.getElementById("entregar-modal-stripe");
    if (stripe) stripe.style.background = tarea.color;

    _limpiarModalEntrega();
    openModal("modal-entregar-tarea");
}

/**
 * @interaction modal-entrega-helpers
 * @scope estudiante-hub-aprendizaje-modal-entrega-helpers
 *
 * Given input file / nada.
 * When file selected / removed / abrir reset.
 * Then 3 helpers combined:
 *   - `_limpiarModalEntrega()`: reset 5 DOM elements (input + preview +
 *     dropzone + comentario + confirmarBtn disabled + error hidden).
 *   - `_entregaArchivoSeleccionado(input)`: file handler con validation
 *     50MB cap → error o preview con icon tipo + nombre + size +
 *     enable confirmarBtn.
 *   - `_quitarArchivoEntrega()`: reverso (input reset + preview hide +
 *     dropzone show + disable btn).
 * Edge:
 *   - **50MB cap hardcoded** — deuda config.
 *   - **`_quitarArchivoEntrega` exportado window** (onclick inline).
 *   - **`_entregaArchivoSeleccionado` exportado window** (onchange file input).
 *   - Twin pattern profesor recursos `_recMostrarArchivo` etc.
 *   - Funciones IMPURAS (DOM).
 *   - Helpers LOCALES (excepto `_quitarArchivoEntrega` window).
 */
function _limpiarModalEntrega() {
    const input = document.getElementById("entregar-file-input");
    if (input) input.value = "";
    const preview = document.getElementById("entregar-file-preview");
    if (preview) { preview.style.display = "none"; preview.innerHTML = ""; }
    const dropzone = document.getElementById("entregar-dropzone");
    if (dropzone) dropzone.style.display = "flex";
    const comentario = document.getElementById("entregar-comentario");
    if (comentario) comentario.value = "";
    const btn = document.getElementById("entregar-confirmar-btn");
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.style.cursor = "not-allowed";
    }
    const error = document.getElementById("entregar-error");
    if (error) { error.textContent = ""; error.style.display = "none"; }
}

function _entregaArchivoSeleccionado(input) {
    const file = input.files[0];
    if (!file) return;

    const maxBytes = 50 * 1024 * 1024;
    const errorEl  = document.getElementById("entregar-error");

    if (file.size > maxBytes) {
        errorEl.textContent  = "El archivo excede el tamaño máximo de 50 MB.";
        errorEl.style.display = "block";
        input.value = "";
        return;
    }

    errorEl.style.display = "none";

    const dropzone = document.getElementById("entregar-dropzone");
    const preview  = document.getElementById("entregar-file-preview");
    const tipo     = _tipoFromNombre(file.name);

    dropzone.style.display = "none";
    preview.style.display  = "flex";
    preview.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;width:100%;
            background:var(--surface-2);border:1px solid var(--border);
            border-radius:var(--r-md);padding:14px 16px;">
            <div style="font-size:28px;flex-shrink:0">${ICONOS_TIPO[tipo] || ICONOS_TIPO.default}</div>
            <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:500;color:var(--text-primary);
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${file.name}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
                    ${tipo} · ${_formatBytes(file.size)}
                </div>
            </div>
            <button onclick="_quitarArchivoEntrega()" title="Quitar archivo"
                style="background:none;border:none;cursor:pointer;color:var(--text-muted);
                font-size:16px;padding:4px;flex-shrink:0">✕</button>
        </div>`;

    const confirmarBtn = document.getElementById("entregar-confirmar-btn");
    if (confirmarBtn) {
        confirmarBtn.disabled = false;
        confirmarBtn.style.opacity = "1";
        confirmarBtn.style.cursor = "pointer";
    }
}

function _quitarArchivoEntrega() {
    const input = document.getElementById("entregar-file-input");
    if (input) input.value = "";
    const preview  = document.getElementById("entregar-file-preview");
    const dropzone = document.getElementById("entregar-dropzone");
    if (preview)  { preview.style.display = "none"; preview.innerHTML = ""; }
    if (dropzone) dropzone.style.display = "flex";
    const confirmarBtn = document.getElementById("entregar-confirmar-btn");
    if (confirmarBtn) {
        confirmarBtn.disabled = true;
        confirmarBtn.style.opacity = "0.5";
        confirmarBtn.style.cursor = "not-allowed";
    }
}

/**
 * @interaction confirmar-entregar-tarea
 * @scope estudiante-hub-aprendizaje-modal-entrega-submit
 *
 * Given user en modal con file seleccionado + comentario opcional.
 * When click "Entregar".
 * Then pipeline:
 *   1. Guard `_tareaEntregaId` + APP.user.id.
 *   2. Lookup tarea DEMO.
 *   3. File obligatorio → error inline si missing.
 *   4. Construye `archivoMeta` `{nombre, size, tipo}`.
 *   5. **`DataService.saveEntrega(id, uid, [archivos], comentario)`** async.
 *   6. En success:
 *      - close modal + buildTareasAlumno("todas") force filter reset.
 *      - **Toggle filter activo a "Todas"** vía DOM (evita stuck en
 *        filter previo que ahora resulta empty).
 *      - notificación + `addXP(50)` + toast success.
 * Edge:
 *   - **Force filter "Todas" post-entregar**: comentario inline explicita
 *     UX rationale (evitar x-empty visible si filter previo era
 *     "pendientes").
 *   - **XP +50** hardcoded — convención DEMO.
 *   - **Sin error handling del Promise**: si saveEntrega falla, no hay
 *     fallback UI. Deuda menor.
 *   - **`DataService.saveEntrega` async** — único path canonical.
 *   - **Exportado window** (onclick inline modal).
 *   - Función IMPURA (DOM + DataService + state).
 */
function confirmarEntregarTarea() {
    if (!_tareaEntregaId || !APP?.user?.id) return;
    const tareaDS = (typeof DEMO_TAREAS !== "undefined")
        ? DEMO_TAREAS.find(t => String(t.id) === String(_tareaEntregaId))
        : null;
    if (!tareaDS) return;

    const input      = document.getElementById("entregar-file-input");
    const file       = input?.files[0];
    const comentario = document.getElementById("entregar-comentario")?.value.trim() || "";

    if (!file) {
        const errorEl = document.getElementById("entregar-error");
        errorEl.textContent  = "Debes adjuntar un archivo para entregar.";
        errorEl.style.display = "block";
        return;
    }

    const archivoMeta = {
        nombre: file.name,
        size:   _formatBytes(file.size),
        tipo:   _tipoFromNombre(file.name),
    };

    DataService.saveEntrega(_tareaEntregaId, APP.user.id, [archivoMeta], comentario).then(() => {
        closeModal("modal-entregar-tarea");
        // Forzar filtro "Todas" tras entregar: la tarea pasa de pendiente→entregada,
        // así el alumno ve confirmación inmediata sin importar el filtro previo.
        // No leemos `.cal-filtro-btn.active`: en el hub matchea el filtro oculto del
        // historial ("Todos"/"PDF"/...) y produce x-empty.
        buildTareasAlumno("todas");
        document.querySelectorAll("#tareas-filtros-wrap .x-tabs__tab")
            .forEach((b, i) => b.classList.toggle("is-active", i === 0));
        if (typeof agregarNotificacion === "function") {
            agregarNotificacion("tarea", "Tarea entregada", `"${tareaDS.titulo}"`);
        }
        if (typeof addXP === "function") addXP(50);
        showToast(`✅ Tarea entregada · +50 XP ganados`, "success");
    });
}

// ═══════════════════════════════════════════════════════════
// MODAL: SOLICITAR PRÓRROGA
// ═══════════════════════════════════════════════════════════

/**
 * @interaction abrir-solicitar-prorroga
 * @scope estudiante-hub-aprendizaje-modal-prorroga
 *
 * Given id tarea + DOM modal `modal-solicitar-prorroga`.
 * When user click "Solicitar prórroga" en card tarea vencida sin prórroga
 *   o con prórroga rechazada (`_buildTareasLista` action matrix).
 * Then bootstrap modal:
 *   1. Lookup tarea. Sin → no-op.
 *   2. Setea `_tareaProrrogaId` module-scope.
 *   3. Update breadcrumb (nombre + materia).
 *   4. Reset textarea motivo.
 *   5. openModal canonical.
 * Edge:
 *   - **Twin con `confirmarSolicitarProrroga`** (ya doc previa) que
 *     completa el flow.
 *   - **Asimetría con profesor `abrirResolverProrroga`**: alumno solicita;
 *     profesor resuelve (aprueba/rechaza).
 *   - Exportado window.
 *   - Función IMPURA.
 */
function abrirSolicitarProrroga(id) {
    const tarea = TAREAS_DATA.find(t => String(t.id) === String(id));
    if (!tarea) return;
    _tareaProrrogaId = id;

    const nombre  = document.getElementById("prorroga-tarea-nombre");
    const materia = document.getElementById("prorroga-tarea-materia");
    if (nombre)  nombre.textContent  = tarea.titulo;
    if (materia) materia.textContent = tarea.materia;
    const motivo = document.getElementById("prorroga-motivo");
    if (motivo)  motivo.value = "";

    openModal("modal-solicitar-prorroga");
}

/**
 * @interaction confirmar-solicitar-prorroga
 * @scope estudiante (hub-aprendizaje)
 *
 * Given un alumno logueado abrió #modal-solicitar-prorroga sobre una tarea
 *   vencida sin entregar, y rellenó #prorroga-motivo con texto no vacío.
 * When hace click en "Confirmar".
 * Then llama solicitarProrroga(tareaId, uid, motivo) del módulo shared, que
 *   muta DEMO_TAREAS[i].prorrogas[] con entry estado=pendiente. Cierra el
 *   modal, muestra toast verde + notificación local, y re-renderiza la
 *   sección de tareas para que la card del alumno refleje el estado
 *   "Prórroga solicitada" inmediatamente.
 * Edge si motivo vacío → toast error y retorna. Si solicitarProrroga retorna
 *   null porque ya hay pendiente → toast error específico. Si ya fue
 *   rechazada antes, esta nueva solicitud crea entry nueva (permitido).
 */
function confirmarSolicitarProrroga() {
    const motivo = document.getElementById("prorroga-motivo")?.value.trim();
    if (!motivo) {
        showToast("Debes explicar el motivo de la solicitud", "error");
        return;
    }
    const uid = APP?.user?.id;
    if (!uid || !_tareaProrrogaId) {
        showToast("No se pudo identificar la tarea o usuario", "error");
        return;
    }
    const creada = (typeof solicitarProrroga === "function")
        ? solicitarProrroga(_tareaProrrogaId, uid, motivo)
        : null;
    if (!creada) {
        showToast("Ya tienes una solicitud pendiente para esta tarea", "error");
        return;
    }
    closeModal("modal-solicitar-prorroga");
    showToast("📅 Solicitud de prórroga enviada al profesor", "success");
    if (typeof agregarNotificacion === "function") {
        agregarNotificacion("info", "Prórroga solicitada", "Tu profesor revisará tu solicitud.");
    }
    // Refresca la lista de tareas para que la card muestre el chip nuevo.
    if (typeof buildTareasAlumno === "function") buildTareasAlumno();
}

// ═══════════════════════════════════════════════════════════
// MODAL: SUBIR ARCHIVO AL HISTORIAL — uploads freeform
// ═══════════════════════════════════════════════════════════

/**
 * @interaction modal-subir-historial-helpers
 * @scope estudiante-hub-aprendizaje-modal-subir-helpers
 *
 * Given file selected / nada / input.
 * When user abre modal subir archivo historial freeform.
 * Then 4 helpers combined:
 *   - `abrirSubirArchivoHistorial()`: populate select materias únicas
 *     desde TAREAS_DATA + limpia + openModal.
 *   - `_limpiarModalSubirHistorial()`: reset 5 DOM elements (input +
 *     preview + dropzone + tarea field + btn disabled + error hidden).
 *   - `_historialArchivoSeleccionado(input)`: file handler con 50MB cap +
 *     preview con icon + nombre + size + enable submit btn.
 *   - `_quitarArchivoSubirHistorial()`: reverso.
 * Edge:
 *   - **Materias únicas Set + sort** desde TAREAS_DATA (no DEMO_MATERIAS).
 *   - **Default "Archivo general"** si tarea field vacía.
 *   - **50MB cap consistente** con _entregaArchivoSeleccionado.
 *   - Exportados window (3 onclick/onchange inline).
 *   - Funciones IMPURAS.
 */
function abrirSubirArchivoHistorial() {
    const materias = [...new Set((TAREAS_DATA || []).map(t => t.materia))].sort();
    const select   = document.getElementById("hist-subir-materia");
    if (select) {
        select.innerHTML = materias.length
            ? materias.map(m => `<option value="${m}">${m}</option>`).join("")
            : `<option value="">— Sin materias —</option>`;
    }
    _limpiarModalSubirHistorial();
    openModal("modal-subir-historial");
}

function _limpiarModalSubirHistorial() {
    const input = document.getElementById("hist-subir-file-input");
    if (input) input.value = "";

    const preview  = document.getElementById("hist-subir-preview");
    const dropzone = document.getElementById("hist-subir-dropzone");
    if (preview)  { preview.style.display = "none"; preview.innerHTML = ""; }
    if (dropzone) dropzone.style.display = "flex";

    const tarea = document.getElementById("hist-subir-tarea");
    if (tarea) tarea.value = "";

    const btn = document.getElementById("hist-subir-btn");
    if (btn) btn.disabled = true;

    const error = document.getElementById("hist-subir-error");
    if (error) { error.textContent = ""; error.style.display = "none"; }
}

function _historialArchivoSeleccionado(input) {
    const file = input.files[0];
    if (!file) return;

    const maxBytes = 50 * 1024 * 1024;
    const errorEl  = document.getElementById("hist-subir-error");

    if (file.size > maxBytes) {
        errorEl.textContent   = "El archivo excede el tamaño máximo de 50 MB.";
        errorEl.style.display = "block";
        input.value = "";
        return;
    }

    errorEl.style.display = "none";

    const tipo = _tipoFromNombre(file.name);

    document.getElementById("hist-subir-dropzone").style.display = "none";

    const preview = document.getElementById("hist-subir-preview");
    preview.style.display = "flex";
    preview.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;width:100%;
            background:var(--surface-2);border:1px solid var(--border);
            border-radius:var(--r-md);padding:14px 16px;box-sizing:border-box;">
            <div style="font-size:28px;flex-shrink:0">${ICONOS_TIPO[tipo] || ICONOS_TIPO.default}</div>
            <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:500;color:var(--text-primary);
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${file.name}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
                    ${tipo} · ${_formatBytes(file.size)}
                </div>
            </div>
            <button onclick="_quitarArchivoSubirHistorial()" title="Quitar"
                style="background:none;border:none;cursor:pointer;color:var(--text-muted);
                font-size:16px;padding:4px;flex-shrink:0">✕</button>
        </div>`;

    document.getElementById("hist-subir-btn").disabled = false;
}

function _quitarArchivoSubirHistorial() {
    document.getElementById("hist-subir-file-input").value = "";
    const preview  = document.getElementById("hist-subir-preview");
    const dropzone = document.getElementById("hist-subir-dropzone");
    preview.style.display  = "none";
    preview.innerHTML      = "";
    dropzone.style.display = "flex";
    document.getElementById("hist-subir-btn").disabled = true;
}

/**
 * @interaction confirmar-subir-archivo-historial
 * @scope estudiante-hub-aprendizaje-modal-subir-submit
 *
 * Given user en modal con file seleccionado + materia + tarea opcional.
 * When click "Subir".
 * Then pipeline:
 *   1. Guards file obligatorio → error inline.
 *   2. Resuelve colorKey via lookup TAREAS_DATA + `_colorKeyFromVar`.
 *   3. Construye `nuevoArchivo` shape canonical historial:
 *      `{id: Date.now(), nombre, materia, tipo, size, fecha, tarea, color}`.
 *   4. **`_sessionFiles.set(id, file)`**: Map module-scope para preservar
 *      el blob File para descarga futura en la sesión.
 *   5. unshift en `_loadHistorialExtra()` + save (más reciente primero).
 *   6. close modal + refresh data + repaint + update badge.
 *   7. Notificación + `addXP(20)` + toast.
 * Edge:
 *   - **`_sessionFiles` Map**: blob NO persiste cross-session
 *     (deuda Storage real post-Supabase). Solo permite descarga durante
 *     la sesión actual.
 *   - **id = Date.now()** (twin con profesor recursos `r_${Date.now()}`).
 *   - **+20 XP** hardcoded (vs +50 entregar). Convención: subir archivo
 *     freeform menos valor que entregar tarea calificada.
 *   - **unshift al INICIO**: más reciente primero (asimetría con tareas
 *     push al final).
 *   - **Exportado window** (onclick inline).
 *   - Función IMPURA (state + localStorage + DOM + DataService notif).
 */
function confirmarSubirArchivoHistorial() {
    const input   = document.getElementById("hist-subir-file-input");
    const file    = input?.files[0];
    const materia = document.getElementById("hist-subir-materia")?.value;
    const tarea   = document.getElementById("hist-subir-tarea")?.value.trim() || "Archivo general";
    const errorEl = document.getElementById("hist-subir-error");

    if (!file) {
        errorEl.textContent   = "Debes seleccionar un archivo.";
        errorEl.style.display = "block";
        return;
    }

    const tareaRef = (TAREAS_DATA || []).find(t => t.materia === materia);
    const colorKey = tareaRef ? _colorKeyFromVar(tareaRef.color) : "teal";

    const nuevoArchivo = {
        id:      Date.now(),
        nombre:  file.name,
        materia: materia || "—",
        tipo:    _tipoFromNombre(file.name),
        size:    _formatBytes(file.size),
        fecha:   new Date().toISOString().split("T")[0],
        tarea:   tarea,
        color:   colorKey,
    };

    _sessionFiles.set(nuevoArchivo.id, file);

    const extras = _loadHistorialExtra();
    extras.unshift(nuevoArchivo);
    _saveHistorialExtra(extras);

    closeModal("modal-subir-historial");
    _refreshHistorialData();
    buildHistorialArchivos();

    const badgeEl = document.getElementById("badge-archivos-count");
    if (badgeEl) badgeEl.textContent = HISTORIAL_DATA.length;

    if (typeof agregarNotificacion === "function") {
        agregarNotificacion("archivo", "Archivo subido al historial", file.name);
    }
    if (typeof addXP === "function") addXP(20);
    showToast(`📎 "${file.name}" subido al historial · +20 XP`, "success");
}

// ═══════════════════════════════════════════════════════════
// RECURSOS — entry, builders por sección, grid contextual
// ═══════════════════════════════════════════════════════════

/**
 * @interaction build-recursos-alumno
 * @scope estudiante-hub-aprendizaje-recursos-entrypoint
 *
 * Given dataFiltrada opcional.
 * When `hubSwitchTab("recursos")` o filtros invocan.
 * Then orquesta 4 sub-builds:
 *   1. Refresh si sin dataFiltrada.
 *   2. Resuelve periodo + diasRestant + periodoCerrado.
 *   3. Period info card + alerta + recientes section + grid principal.
 * Edge:
 *   - **Pattern twin con profesor `buildRecursosProfesor`** estructura
 *     idéntica (info + alerta + grid).
 *   - **Exportado window** (consumer cross-archivo).
 *   - Función IMPURA.
 */
function buildRecursosAlumno(dataFiltrada) {
    if (!dataFiltrada) _refreshRecursosAlumnoData();
    const periodo        = _getPeriodoVigenteAlumno();
    const diasRestant    = _diasAlCierre(periodo);
    const periodoCerrado = diasRestant !== null && diasRestant <= 0;

    _buildRecursosPeriodoInfo(diasRestant, periodoCerrado, periodo);
    _buildRecursosAlerta(diasRestant, periodoCerrado, periodo);
    _buildRecursosRecientes(dataFiltrada);
    _buildRecursosGrid(dataFiltrada, diasRestant, periodoCerrado);
}

/**
 * @interaction build-recursos-periodo-info
 * @scope estudiante-hub-aprendizaje-recursos-info
 *
 * Given diasRestant + periodoCerrado + periodo.
 * When `buildRecursosAlumno` orquesta.
 * Then card top con:
 *   - Header nombre + fechas periodo.
 *   - 4 stats: recursos count + nuevos count + size total + días cierre coloreado.
 *   - Progress bar transcurrido% del periodo.
 * Edge:
 *   - **Twin EXACTO con `_buildProfRecursosPeriodoInfo` profesor** (sesión 9).
 *   - Color cascada: cerrado red / ≤5 red / ≤AVISO amber / else green.
 *   - pctTranscurrido capped a 100.
 *   - Función IMPURA.
 *   - Helper LOCAL.
 */
function _buildRecursosPeriodoInfo(diasRestant, periodoCerrado, periodo) {
    const el = document.getElementById("recursos-periodo-info");
    if (!el) return;

    if (!periodo) {
        el.innerHTML = "";
        return;
    }

    const totalSize = RECURSOS_ALUMNO_DATA.reduce((s, r) => s + parseFloat(r.size), 0).toFixed(0);
    const nuevos    = RECURSOS_ALUMNO_DATA.filter(r => r.nuevo).length;
    const spanPeriodo = periodo.fin - periodo.inicio;
    const pctTranscurrido = spanPeriodo > 0
        ? Math.min(Math.round(((new Date() - periodo.inicio) / spanPeriodo) * 100), 100)
        : 0;

    const colorDias = periodoCerrado
        ? "var(--xahni-red)"
        : diasRestant === null
            ? "var(--text-muted)"
            : diasRestant <= 5
                ? "var(--xahni-red)"
                : diasRestant <= PERIODO_AVISO_DIAS
                    ? "var(--xahni-amber)"
                    : "var(--xahni-green)";

    const textoDias = periodoCerrado
        ? "Periodo cerrado"
        : diasRestant === null
            ? "—"
            : `${diasRestant} día${diasRestant !== 1 ? "s" : ""}`;

    el.innerHTML = `
        <div class="rec-periodo-header">
            <div>
                <div class="rec-periodo-nombre">${periodo.nombre}</div>
                <div class="rec-periodo-fechas">
                    ${_formatFecha(periodo.inicio)} — ${_formatFecha(periodo.fin)}
                </div>
            </div>
            <div class="rec-periodo-stats">
                <div class="rec-periodo-stat">
                    <span class="rec-periodo-stat-val">${RECURSOS_ALUMNO_DATA.length}</span>
                    <span class="rec-periodo-stat-label">recursos</span>
                </div>
                <div class="rec-periodo-stat">
                    <span class="rec-periodo-stat-val" style="color:var(--xahni-blue-light)">${nuevos}</span>
                    <span class="rec-periodo-stat-label">nuevos</span>
                </div>
                <div class="rec-periodo-stat">
                    <span class="rec-periodo-stat-val">${totalSize} MB</span>
                    <span class="rec-periodo-stat-label">almacenados</span>
                </div>
                <div class="rec-periodo-stat">
                    <span class="rec-periodo-stat-val" style="color:${colorDias}">${textoDias}</span>
                    <span class="rec-periodo-stat-label">para cierre</span>
                </div>
            </div>
        </div>
        <div style="margin-top:12px">
            <div style="display:flex;justify-content:space-between;margin-bottom:5px">
                <span style="font-size:11px;color:var(--text-muted)">Progreso del periodo escolar</span>
                <span style="font-size:11px;font-family:var(--font-mono);color:var(--text-muted)">${pctTranscurrido}%</span>
            </div>
            <div class="progress-bar" style="height:5px">
                <div style="height:100%;width:${pctTranscurrido}%;background:var(--brand-gradient-h);border-radius:99px;transition:width 1s ease"></div>
            </div>
        </div>`;
}

/**
 * @interaction build-recursos-alerta
 * @scope estudiante-hub-aprendizaje-recursos-alerta
 *
 * Given diasRestant + periodoCerrado + periodo.
 * When `buildRecursosAlumno` orquesta.
 * Then banner alerta 3-estados (twin con `_buildProfRecursosAlerta` profesor):
 *   - cerrado → peligro 🔴 + botón "Descargar todos".
 *   - ≤PERIODO_AVISO_DIAS → urgente (≤5) o aviso.
 *   - Else → hidden.
 * Edge:
 *   - **Mismo pattern flavor "24h eliminación"** sin auto-delete real.
 *   - Función IMPURA.
 *   - Helper LOCAL.
 */
function _buildRecursosAlerta(diasRestant, periodoCerrado, periodo) {
    const el = document.getElementById("recursos-periodo-alerta");
    if (!el) return;

    if (!periodo || diasRestant === null) {
        el.innerHTML = "";
        el.style.display = "none";
        return;
    }

    if (periodoCerrado) {
        el.className = "rec-alerta alerta-peligro";
        el.innerHTML = `
            <div class="rec-alerta-icono">🔴</div>
            <div class="rec-alerta-cuerpo">
                <div class="rec-alerta-titulo">Periodo escolar cerrado — Recursos programados para eliminación</div>
                <div class="rec-alerta-desc">
                    El periodo <strong>${periodo.nombre}</strong> ha concluido.
                    Los recursos didácticos de este periodo serán eliminados
                    <strong>permanentemente en las próximas 24 horas</strong>.
                    Descárgalos ahora si deseas conservarlos.
                </div>
            </div>
            <button class="x-btn x-btn--primary" style="font-size:12px;padding:8px 16px;flex-shrink:0;white-space:nowrap"
                onclick="descargarTodosRecursos()">↓ Descargar todos</button>`;
        el.style.display = "flex";

    } else if (diasRestant <= PERIODO_AVISO_DIAS) {
        const esUrgente = diasRestant <= 5;
        el.className = `rec-alerta ${esUrgente ? "alerta-urgente" : "alerta-aviso"}`;
        el.innerHTML = `
            <div class="rec-alerta-icono">${esUrgente ? "⚠️" : "📅"}</div>
            <div class="rec-alerta-cuerpo">
                <div class="rec-alerta-titulo">
                    ${esUrgente ? "¡Atención!" : "Aviso:"}
                    El periodo escolar cierra en
                    <strong>${diasRestant} día${diasRestant !== 1 ? "s" : ""}</strong>
                </div>
                <div class="rec-alerta-desc">
                    Al cerrar el <strong>${_formatFecha(periodo.fin)}</strong>,
                    todos los recursos del periodo <em>${periodo.nombre}</em>
                    serán eliminados automáticamente del sistema.
                    Descarga los materiales que quieras conservar antes de esa fecha.
                </div>
            </div>
            <button class="x-btn x-btn--primary" style="font-size:12px;padding:8px 16px;flex-shrink:0;white-space:nowrap"
                onclick="descargarTodosRecursos()">↓ Descargar todos</button>`;
        el.style.display = "flex";

    } else {
        el.style.display = "none";
    }
}

/**
 * @interaction build-recursos-recientes
 * @scope estudiante-hub-aprendizaje-recursos-recientes
 *
 * Given dataFiltrada opcional.
 * When `buildRecursosAlumno` orquesta.
 * Then:
 *   1. **Early return si dataFiltrada activo** (no mostrar section bajo filter).
 *   2. Filter recursos nuevos + filter por hubMateriaActiva si aplica.
 *   3. Lista de `_recRowHtml` o empty state.
 *   4. Hide card si filtrada (UX limpio).
 * Edge:
 *   - **Section solo en vista NO-filtered** — UX decisión.
 *   - hubMateriaActiva filter consistente cross-tab.
 *   - Helper LOCAL.
 *   - Función IMPURA.
 */
function _buildRecursosRecientes(dataFiltrada) {
    const el = document.getElementById("recursos-recientes");
    if (!el || dataFiltrada) return;   // No mostrar si hay filtro activo

    const diasRestant    = _diasAlCierre();
    const periodoCerrado = diasRestant !== null && diasRestant <= 0;
    let recientes        = RECURSOS_ALUMNO_DATA.filter(r => r.nuevo);
    if (hubMateriaActiva) {
        recientes = recientes.filter(r => r.materia === hubMateriaActiva.nombre);
    }

    el.innerHTML = recientes.length
        ? recientes.map(r => _recRowHtml(r, diasRestant, periodoCerrado)).join("")
        : `<div class="x-empty x-empty--inline"><div class="x-empty__title">No hay recursos nuevos esta semana</div></div>`;

    const cardRecientes = document.getElementById("recursos-card-recientes");
    if (cardRecientes) cardRecientes.style.display = dataFiltrada ? "none" : "block";
}

/**
 * @interaction build-recursos-grid
 * @scope estudiante-hub-aprendizaje-recursos-grid
 *
 * Given dataFiltrada + diasRestant + periodoCerrado.
 * When `buildRecursosAlumno` orquesta.
 * Then grid principal agrupado por materia:
 *   1. Filter por hubMateriaActiva si no dataFiltrada.
 *   2. Empty state si vacío.
 *   3. Group by materia (objeto dict preservando orden inserción).
 *   4. Card por materia con header (nombre + count badge) + rows
 *      via `_recRowHtml`.
 * Edge:
 *   - **Group by con dict** (no Map) — preserva orden inserción JS moderno.
 *   - hubMateriaActiva filter cross-tab.
 *   - **Twin con `_buildMatSection` profesor** estructura agrupación.
 *   - Función IMPURA.
 *   - Helper LOCAL.
 */
function _buildRecursosGrid(dataFiltrada, diasRestant, periodoCerrado) {
    const gruposEl = document.getElementById("recursos-alumno-grid");
    if (!gruposEl) return;

    let data = dataFiltrada || RECURSOS_ALUMNO_DATA;

    // En contexto del hub: filtrar por la materia activa
    if (hubMateriaActiva && !dataFiltrada) {
        data = data.filter(r => r.materia === hubMateriaActiva.nombre);
    }

    if (!data.length) {
        gruposEl.innerHTML = `
            <div class="x-empty">
                <div class="x-empty__icon">📦</div>
                <div class="x-empty__title">No se encontraron recursos</div>
            </div>`;
        return;
    }

    // Agrupar por materia preservando orden
    const porMateria = {};
    data.forEach(r => {
        if (!porMateria[r.materia]) porMateria[r.materia] = [];
        porMateria[r.materia].push(r);
    });

    gruposEl.innerHTML = Object.entries(porMateria).map(([materia, recursos]) => `
        <div class="card" style="margin-bottom:16px">
            <div class="card-header">
                <span class="card-title">${materia}</span>
                <span class="badge muted">${recursos.length} archivo${recursos.length !== 1 ? "s" : ""}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:2px">
                ${recursos.map(r => _recRowHtml(r, diasRestant, periodoCerrado)).join("")}
            </div>
        </div>`).join("");
}

/**
 * @interaction rec-row-html
 * @scope estudiante-hub-aprendizaje-recursos-row
 *
 * Given r (recurso) + diasRestant + periodoCerrado.
 * When `_buildRecursosRecientes` o `_buildRecursosGrid` iteran.
 * Then `.rec-row` con:
 *   - Icon tipo + color materia.
 *   - Nombre + chip "Nuevo" si flag + meta (prof · fecha).
 *   - Right: badge tipo + size mono.
 *   - **Botón descargar bifurcado por urgencia**:
 *     - cerrado → "⚡ Descarga ya" peligro.
 *     - ≤5 días → "⬇ Descargar" urgente.
 *     - Else → "↓" normal.
 *   - onclick `descargarRecurso(...args escapados)` con `event.stopPropagation`.
 * Edge:
 *   - **Helper inline `esc(s)`** para `\\'` escape en onclick args
 *     (twin con `_buildRecItem` profesor).
 *   - **`r.prof || r.profesor`** doble shape lookup (legacy).
 *   - **Twin con `_buildRecItem` profesor** estructura idéntica.
 *   - Función PURA (retorna string HTML).
 *   - Helper LOCAL.
 */
function _recRowHtml(r, diasRestant, periodoCerrado) {
    const [bg, fg] = COLOR_MAP[r.color] || ["surface-3", "text-muted"];
    const icono    = ICONOS_TIPO[r.tipo] || ICONOS_TIPO.default;

    const esUrgente = !periodoCerrado && diasRestant !== undefined && diasRestant !== null && diasRestant <= 5;
    const esCerrado = periodoCerrado;

    const btnClass = esCerrado ? "rec-download-btn peligro"
                   : esUrgente ? "rec-download-btn urgente"
                   :              "rec-download-btn";
    const btnTexto = esCerrado ? "⚡ Descarga ya"
                   : esUrgente ? "⬇ Descargar"
                   :              "↓";
    const btnTitle = esCerrado ? "¡El periodo cerró! Descarga antes de que se elimine"
                   : esUrgente ? `¡Solo quedan ${diasRestant} días! Descarga antes del cierre`
                   :              "Descargar recurso";

    const fechaStr = r.fecha instanceof Date ? _formatFecha(r.fecha) : r.fecha;

    const esc = s => String(s || "").replace(/'/g, "\\'");

    return `
    <div class="rec-row">
        <div class="rec-icono" style="background:var(--${bg});color:var(--${fg})">
            ${icono}
        </div>
        <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:500;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                ${r.nombre}
                ${r.nuevo
                    ? '<span class="badge blue" style="font-size:9px;padding:1px 5px;margin-left:4px">Nuevo</span>'
                    : (r.visto ? '<span class="badge muted" style="font-size:9px;padding:1px 5px;margin-left:4px">Visto</span>' : "")}
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
                ${r.prof || r.profesor || "—"} · ${fechaStr}
            </div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-right:8px">
            <span class="badge muted" style="font-size:10px">${r.tipo}</span>
            <div style="font-size:10px;color:var(--text-muted);margin-top:3px;font-family:var(--font-mono)">${r.size}</div>
        </div>
        <button class="${btnClass}"
            onclick="event.stopPropagation();descargarRecurso('${r.id}', '${esc(r.nombre)}', '${r.tipo}', '${esc(r.materia)}', '${esc(r.prof || r.profesor)}')"
            title="${btnTitle}">
            ${btnTexto}
        </button>
    </div>`;
}

/**
 * @interaction recursos-handlers-filtros-acciones
 * @scope estudiante-hub-aprendizaje-recursos-handlers
 *
 * Given query / tipo+btn / nada.
 * When user interactúa con filtros recursos.
 * Then 4 handlers combined:
 *   - `filtrarRecursos(query)`: search 3 campos (nombre + materia + tipo).
 *   - `filtrarRecursosTipo(tipo, btn)`: tab tipo filter.
 *   - `hubFiltrarRecursosTipo(tipo, btn)`: alias para hub context (delega).
 *   - `descargarTodosRecursos()`: PLACEHOLDER fake bulk con tamaño total
 *     calculado.
 * Edge:
 *   - **`hubFiltrarRecursosTipo` thin wrapper** — overhead innecesario,
 *     pero preserva API symmetric con hubFiltrarTareas.
 *   - **`filtrarRecursos` no resetea si no filtered** (null fallback al
 *     completo).
 *   - Exportados window.
 *   - Funciones IMPURAS.
 */
function filtrarRecursos(query) {
    const q = query.toLowerCase();
    const filtered = RECURSOS_ALUMNO_DATA.filter(r =>
        r.nombre.toLowerCase().includes(q) ||
        r.materia.toLowerCase().includes(q) ||
        r.tipo.toLowerCase().includes(q)
    );
    buildRecursosAlumno(filtered.length < RECURSOS_ALUMNO_DATA.length ? filtered : null);
}

function filtrarRecursosTipo(tipo, btn) {
    document.querySelectorAll(".rec-tipo-btn").forEach(b => b.classList.remove("active"));
    if (btn) btn.classList.add("active");
    buildRecursosAlumno(tipo === "todos" ? null : RECURSOS_ALUMNO_DATA.filter(r => r.tipo === tipo));
}

function hubFiltrarRecursosTipo(tipo, btn) {
    filtrarRecursosTipo(tipo, btn);
}

function descargarTodosRecursos() {
    const total = RECURSOS_ALUMNO_DATA.length;
    const mb    = RECURSOS_ALUMNO_DATA.reduce((s, r) => s + parseFloat(r.size), 0).toFixed(0);
    showToast(`Preparando descarga de ${total} recursos (${mb} MB)...`, "info");
    setTimeout(() => showToast("Descarga lista. Revisa tu carpeta de descargas.", "success"), 2000);
}

// ═══════════════════════════════════════════════════════════
// DESCARGA REAL DE RECURSO — genera un .txt placeholder
// ═══════════════════════════════════════════════════════════

/**
 * @interaction marcar-recurso-visto
 * @scope estudiante-hub-aprendizaje-recursos-visto
 *
 * Given id recurso.
 * When `descargarRecurso` marca al descargar primera vez.
 * Then:
 *   1. Lookup recurso. Sin → no-op.
 *   2. Si ya visto → no-op (idempotent).
 *   3. Setea `recurso.nuevo = false` in-memory.
 *   4. Persiste key compuesta `${uid}::${id}` en `_loadRecursosVistos`
 *      Set (defensive append + save).
 * Edge:
 *   - **Key compuesta `${uid}::${id}`** porque `_RECURSOS_VISTOS_KEY` es
 *     GLOBAL (no namespaced por uid) — workaround documentado.
 *   - **`uid || "anon"`** fallback para usuarios anónimos (edge case raro).
 *   - **Idempotent** previene re-add al Set.
 *   - Exportado window.
 *   - Función IMPURA.
 */
function marcarRecursoVisto(id) {
    const recurso = RECURSOS_ALUMNO_DATA.find(r => String(r.id) === String(id));
    if (!recurso) return;
    if (!recurso.nuevo) return;
    recurso.nuevo = false;
    const vistos = _loadRecursosVistos();
    const key    = `${APP?.user?.id || "anon"}::${id}`;
    if (!vistos.includes(key)) {
        vistos.push(key);
        _saveRecursosVistos(vistos);
    }
}

/**
 * @interaction descargar-recurso
 * @scope estudiante-hub-aprendizaje-recursos-download
 *
 * Given id + nombre + tipo + materia + prof.
 * When user click botón descarga en `.rec-row`.
 * Then:
 *   1. Lookup recurso. Sin → toast info.
 *   2. **`marcarRecursoVisto(id)`** primera vez.
 *   3. Si era nuevo: agregar notificación + `addXP(10)`.
 *   4. **Genera Blob .txt placeholder** con metadata legible.
 *   5. **Download programático**: createObjectURL + `<a download>` + click +
 *      cleanup setTimeout 2s revoke.
 *   6. Toast success.
 * Edge:
 *   - **PLACEHOLDER .txt real**: a diferencia de profesor recursos (que es
 *     fake), alumno SÍ genera Blob real con metadata + descarga browser-native.
 *     Decisión: alumno necesita feedback tangible; profesor manage solo metadata.
 *   - **`URL.revokeObjectURL` setTimeout 2s**: cleanup async tras click
 *     completarse.
 *   - **fileName sanitización**: regex `/[^\w\s\-\.]/g` remueve special chars
 *     + `.txt` append.
 *   - **+10 XP** solo si era nuevo (no re-XP en re-descarga).
 *   - **Exportado window** (onclick inline).
 *   - Función IMPURA (DOM + Blob + state).
 *   - Deuda post-Supabase: descarga real desde Storage signed URL.
 */
function descargarRecurso(id, nombre, tipo, materia, prof) {
    const recurso = RECURSOS_ALUMNO_DATA.find(r => String(r.id) === String(id));
    if (!recurso) { showToast("Recurso no encontrado.", "info"); return; }

    const eraNuevo = !!recurso.nuevo;
    marcarRecursoVisto(id);
    // Bug M3 2026-06-09: marcar `visto:true` in-memory para que el chip
    // cambie a "Visto" inmediatamente (sin necesidad de cambiar de tab).
    recurso.visto = true;
    if (eraNuevo) {
        if (typeof agregarNotificacion === "function") {
            agregarNotificacion("recurso", "Recurso descargado", nombre);
        }
        if (typeof addXP === "function") addXP(10);
    }
    // Re-render: el chip "Nuevo" → "Visto" se actualiza tras descarga.
    if (typeof buildRecursosAlumno === "function") {
        try { buildRecursosAlumno(); } catch (e) { /* defensive */ }
    }

    const fechaStr = recurso.fecha instanceof Date
        ? recurso.fecha.toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })
        : (recurso.fecha || "—");

    const contenido = [
        "══════════════════════════════════════════════",
        "  XAHNI — Recurso Didáctico",
        "══════════════════════════════════════════════",
        "",
        `  Nombre   : ${nombre}`,
        `  Tipo     : ${tipo}`,
        `  Materia  : ${materia}`,
        `  Profesor : ${prof}`,
        `  Fecha    : ${fechaStr}`,
        `  Tamaño   : ${recurso.size}`,
        "",
        "──────────────────────────────────────────────",
        "  Este archivo es un recurso de demostración.",
        "  En producción se serviría desde el servidor",
        "  del profesor con el contenido real.",
        "══════════════════════════════════════════════",
    ].join("\n");

    const blob     = new Blob([contenido], { type: "text/plain;charset=utf-8" });
    const fileName = nombre.replace(/[^\w\s\-\.]/g, "").trim() + ".txt";

    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    showToast(`↓ Descargando "${nombre}"`, "success");
}

// ═══════════════════════════════════════════════════════════
// HUB-GRUPO · switch entre 4 tabs (Mi grupo / Materias / Calendario / Competencias)
// ═══════════════════════════════════════════════════════════

/**
 * @interaction hub-grupo-switch-tab
 * @scope estudiante-hub-aprendizaje-hub-grupo-tabs
 *
 * Given tabId + btn opcional.
 * When user click hub-tab dentro del shell hub-grupo (4 tabs: Mi grupo /
 *   Materias / Calendario / Competencias).
 * Then:
 *   1. Visual marca `.active` sobre btn + deselect siblings.
 *   2. Show/hide los 4 paneles.
 *   3. Dispatch render del módulo correspondiente:
 *      - mi-grupo → `hubGrupoRenderMiGrupo` (hub-grupo.js IIFE).
 *      - materias → `buildMaterias`.
 *      - calendario → `hubCalendarioRender` (hub-calendario.js IIFE).
 *      - competencias → `hubGrupoRenderCompetencias` (competencias.js).
 * Edge:
 *   - **Asimetría con profesor `profHubGrupoSwitchTab`**: alumno 4 tabs,
 *     profesor 4 tabs (mismo set pero handlers distintos).
 *   - **`mi-grupo` comentario "llega en B.2"**: dependencia cross-archivo.
 *   - **Exportado window** (consumer cross-archivo + onclick inline).
 *   - Función IMPURA.
 */
function hubGrupoSwitchTab(tabId, btn) {
  // Visual: marcar tab activo
  document.querySelectorAll("#hub-grupo-tabs-bar .hub-tab").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");

  // Mostrar/ocultar paneles
  const panels = ["mi-grupo", "materias", "calendario", "competencias"];
  panels.forEach(p => {
    const el = document.getElementById("hub-grupo-tab-" + p);
    if (el) el.style.display = (p === tabId) ? "" : "none";
  });

  // Si el módulo del tab tiene un render, dispararlo
  if (tabId === "mi-grupo" && typeof window.hubGrupoRenderMiGrupo === "function") {
    window.hubGrupoRenderMiGrupo(); // función llega en B.2
  }
  if (tabId === "materias" && typeof buildMaterias === "function") {
    buildMaterias();
  }
  if (tabId === "competencias" && typeof window.hubGrupoRenderCompetencias === "function") {
    window.hubGrupoRenderCompetencias();
  }
  if (tabId === "calendario" && typeof hubCalendarioRender === "function") {
    hubCalendarioRender();
  }
}
window.hubGrupoSwitchTab = hubGrupoSwitchTab;

/**
 * @interaction hub-grupo-update-header
 * @scope estudiante-hub-aprendizaje-hub-grupo-header
 *
 * Given DOM con `#hub-grupo-titulo` + `#hub-grupo-subtitulo`.
 * When alumno entra al shell hub-grupo o cambia grupo.
 * Then:
 *   1. titulo ← user.grupos[0] (id string).
 *   2. subtitulo ← `getGrupoCarreraLabel(grupoId)` o fallback "Tu grupo
 *      este periodo".
 * Edge:
 *   - **Asimetría con profesor `profHubGrupoRenderSelector`**: alumno
 *     título estático (1 grupo); profesor dropdown selector (N grupos).
 *   - **`getGrupoCarreraLabel`** shared helper — chain dep.
 *   - **Exportado window** (consumer cross-archivo).
 *   - Función IMPURA (DOM).
 */
function hubGrupoUpdateHeader() {
  const tituloEl = document.getElementById("hub-grupo-titulo");
  const subEl = document.getElementById("hub-grupo-subtitulo");
  if (!tituloEl) return;
  const grupoId = APP.user && APP.user.grupos && APP.user.grupos[0];
  if (grupoId) {
    // Resolver nombre del grupo si DEMO_GRUPOS lo tiene (evita "grupo-smoke-1780..." literal)
    const grupos = (typeof DEMO_GRUPOS !== "undefined" && Array.isArray(DEMO_GRUPOS)) ? DEMO_GRUPOS : [];
    const grupo = grupos.find(g => g.id === grupoId);
    const display = (grupo && grupo.nombre) ? grupo.nombre : grupoId;
    tituloEl.textContent = display;
    tituloEl.setAttribute("title", grupoId);
    tituloEl.classList.add("x-truncate-inline");
  }
  if (subEl) {
    const label = (typeof getGrupoCarreraLabel === "function") ? getGrupoCarreraLabel(grupoId) : "";
    subEl.textContent = label || "Tu grupo este periodo";
  }
}
window.hubGrupoUpdateHeader = hubGrupoUpdateHeader;

// ═══════════════════════════════════════════════════════════
// hubBuildPeriodoSection(grupoId) — devuelve el HTML de la
// .hub-periodo-section trasplantada (consumida por hub-grupo.js B.2).
// Reusa getPeriodoDeGrupo/getPeriodoInfo de js/core/periodo.js.
// ═══════════════════════════════════════════════════════════
window.hubBuildPeriodoSection = function (grupoId) {
  const raw = (typeof getPeriodoDeGrupo === "function") ? getPeriodoDeGrupo(grupoId) : null;
  const info = (typeof getPeriodoInfo === "function") ? getPeriodoInfo(raw) : null;
  if (!info) {
    return `<div class="x-empty"><div class="x-empty__desc">Periodo no disponible</div></div>`;
  }

  // Tres roles distintos en este widget:
  // `accentBg`   — fill del segmento cerrado/activo. Brand gradient
  //                cyan→blue→purple en lugar de cyan plano: identidad
  //                gamificada XAHNI + texto blanco legible sobre zona
  //                blue/purple del gradient (ratio 6.4+:1 en zona azul).
  // `accentRing` — borde inset del segmento activo (cyan brillante,
  //                preserva el "ahora estás aquí" identitario).
  // `accentText` — texto del label "Semana N de M" sobre surface-0
  //                (mode-aware para WCAG AA en light, ratio 1.47→5.24:1).
  const accentBg   = "var(--brand-gradient-h)";
  const accentRing = "var(--xahni-cyan)";
  const accentText = "var(--accent-cyan-text)";
  const labelEstado = info.estado === "futuro"
    ? "Aún no inicia"
    : info.estado === "cerrado"
      ? "Periodo cerrado"
      : `Semana ${info.semanaActual} de ${info.totalSemanas}`;

  const totalSem = info.parciales.reduce((s, p) => s + p.semanas, 0) || 1;

  const segmentos = info.parciales.map(p => {
    const flex      = (p.semanas / totalSem) * 100;
    const fillColor = p.estado === "futuro" ? "var(--surface-3)" : accentBg;
    const fillOp    = p.estado === "cerrado" ? 1
                    : p.estado === "activo"  ? 0.85
                    : 0.35;
    const ring = p.estado === "activo" ? `box-shadow:inset 0 0 0 2px ${accentRing}` : "";
    const subt = `${p.semanas} sem · ${p.pct}%${p.estado === "activo" ? " · S" + p.semanaActual : ""}`;
    return `
      <div class="hub-periodo-seg" data-estado="${p.estado}"
           style="flex:${flex} 1 0;position:relative;height:38px;border-radius:6px;overflow:hidden;background:var(--surface-2);${ring}">
        <div style="position:absolute;inset:0;width:${p.pct}%;background:${fillColor};opacity:${fillOp};transition:width .6s ease"></div>
        <div style="position:relative;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:0 6px;text-align:center">
          <span style="font-size:11px;font-weight:700;color:${p.estado === "futuro" ? "var(--text-muted)" : "#fff"};text-shadow:0 1px 2px rgba(0,0,0,.4)">P${p.num}</span>
          <span style="font-size:9px;color:${p.estado === "futuro" ? "var(--text-muted)" : "rgba(255,255,255,.85)"};font-family:var(--font-mono);text-shadow:0 1px 2px rgba(0,0,0,.4)">${subt}</span>
        </div>
      </div>`;
  }).join("");

  return `
    <div class="hub-periodo-section" style="margin-top:6px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted)">${info.nombre || "Periodo"}</span>
        <span style="font-size:11px;font-family:var(--font-mono);color:${accentText};font-weight:600">${labelEstado}</span>
      </div>
      <div style="display:flex;gap:4px">${segmentos}</div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:9px;font-family:var(--font-mono);color:var(--text-muted)">
        <span>${info.pctTotal}% transcurrido</span>
        <span>${info.totalSemanas} sem</span>
      </div>
    </div>`;
};

// ═══════════════════════════════════════════════════════════
// PIEZA D — Parcial persistente cross-tabs · ALUMNO (Phase 2, Task 10-11)
// Simetría con js/profesor/hub-aprendizaje.js
// ═══════════════════════════════════════════════════════════

/**
 * @interaction hub-alumno-grupo-de-materia
 * @scope estudiante-hub-aprendizaje-helper-grupo
 *
 * Given matId.
 * When `hubAbrirMateria` / `hubSwitchTab` necesitan el gmKey para Pieza D
 *   parcial tabs.
 * Then:
 *   1. Guard matId / APP.user.id falsy → null.
 *   2. Lookup user en DEMO_USERS.
 *   3. Cruce intersection user.grupos ∩ materia.grupos.
 * Edge:
 *   - **Pattern intersection idéntico a `_calMatGrupo`** (calificaciones.js).
 *     Twin EXACTO. Deuda consolidación shared.
 *   - Sin intersección → null.
 *   - Helper LOCAL.
 *   - Función PURA.
 */
function _hubAlumnoGrupoDeMateria(matId) {
    if (!matId || !APP?.user?.id) return null;
    const user = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : [])
        .find(u => u.id === APP.user.id);
    const userGrupos = (user?.grupos) || [];
    const matRaw = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
        .find(m => m.id === matId);
    const matGrupos = (matRaw?.grupos) || [];
    return userGrupos.find(g => matGrupos.includes(g)) || null;
}

/**
 * @interaction set-parcial-activo-alumno
 * @scope alumno-materia
 *
 * Given: alumno dentro de una materia (hub-aprendizaje)
 * When:  click en tab P1/P2/Final del header de materia
 * Then:  persiste parcial activo en APP.alumnoParcialActivo[gmKey] + localStorage;
 *        emite evento 'xahni:parcialActivoCambio' con detail {rol:'alumno', gmKey, parcial}
 * Edge:
 *   - argumentos inválidos → no-op + console.warn
 *   - localStorage falla → solo memory + console.warn
 */
function alumnoMatSetParcial(gmKey, parcial) {
    if (!gmKey || !Number.isInteger(parcial)) {
        console.warn("[XAHNI] alumnoMatSetParcial: argumentos inválidos", gmKey, parcial);
        return;
    }
    APP.alumnoParcialActivo[gmKey] = parcial;
    try {
        localStorage.setItem("xahni.alumnoParcialActivo", JSON.stringify(APP.alumnoParcialActivo));
    } catch (e) {
        console.warn("[XAHNI] localStorage write falló (alumno)", e);
    }
    document.dispatchEvent(new CustomEvent("xahni:parcialActivoCambio", {
        detail: { rol: "alumno", gmKey, parcial }
    }));
}
window.alumnoMatSetParcial = alumnoMatSetParcial;

/**
 * @interaction render-tabs-parcial-alumno
 * @scope alumno-materia
 *
 * Given: alumno entrando a una materia con periodoInfo definido
 * When:  se invoca al cargar el detalle de materia
 * Then:  renderea tabs P1/.../Final según periodoInfo.parciales,
 *        marca activo según APP.alumnoParcialActivo[gmKey] o periodoInfo.parcial_actual
 * Edge:
 *   - periodoInfo o parciales vacíos → contenedor vacío
 *   - contenedor no existe en DOM → no-op
 */
function alumnoMatRenderParcialTabs(gmKey, periodoInfo) {
    const cont = document.getElementById("alumno-mat-parcial-tabs");
    if (!cont || !periodoInfo) return;
    const parciales = Array.isArray(periodoInfo.parciales) ? periodoInfo.parciales : [];
    if (parciales.length === 0) { cont.innerHTML = ""; return; }
    const activo = APP.alumnoParcialActivo[gmKey]
        || periodoInfo.parcial_actual
        || parciales[0]?.num
        || 1;
    const lastNum = parciales[parciales.length - 1].num;
    // 2026-05-23: visual `.escala-tab` trasplantado por simetría con profesor
    // (feedback "reutilizar diseños existentes"). Sublabel = estado parcial.
    // Slice cerrar-parcial-integracion 2026-05-24: sublabel "Cerrado" gana
    // sobre el estado del periodo si la escala del parcial fue cerrada
    // manualmente. Distinguir entre "cerrado por escala manual" (acción
    // explícita del profesor) vs "Finalizado" (periodo expiró natural).
    const [matIdHdr, grupoIdHdr] = gmKey.split("_");
    cont.innerHTML = parciales.map(p => {
        const isActive = p.num === activo;
        const label = (p.num === lastNum) ? "Final" : `P${p.num}`;
        const cerradoManual = typeof isParcialCerrado === "function"
            && isParcialCerrado(matIdHdr, grupoIdHdr, p.num);
        const subLabel = cerradoManual          ? "🔒 Cerrado"
                      : p.estado === "futuro"  ? "No iniciado"
                      : p.estado === "cerrado" ? "Finalizado"
                      : "En curso";
        return `<button class="escala-tab${isActive ? " active" : ""}" style="flex:0 0 auto;padding:8px 14px;font-size:13px" onclick="alumnoMatSetParcial('${gmKey}', ${p.num})">
            <span>${label}</span>
            <span class="escala-tab-sub">${subLabel}</span>
        </button>`;
    }).join("");
}
window.alumnoMatRenderParcialTabs = alumnoMatRenderParcialTabs;

/**
 * @interaction parcial-activo-alumno-actual
 * @scope alumno-materia
 *
 * Given: alumno dentro de una materia (hubMateriaActiva set)
 * When:  cualquier render necesita conocer el parcial activo del alumno
 * Then:  retorna número del parcial activo (APP.alumnoParcialActivo[gmKey]
 *        o el oficial del periodo, o 1 fallback)
 */
function _alumnoParcialActivoActual() {
    if (typeof hubMateriaActiva === "undefined" || !hubMateriaActiva) return 1;
    const matId = hubMateriaActiva.id;
    const grupoId = _hubAlumnoGrupoDeMateria(matId);
    const gmKey = `${matId}_${grupoId}`;
    return (APP.alumnoParcialActivo?.[gmKey])
        || (typeof getPeriodoInfo === "function" && typeof getPeriodoDeGrupo === "function"
            ? getPeriodoInfo(getPeriodoDeGrupo(grupoId))?.parciales?.[0]?.num
            : 1)
        || 1;
}

/**
 * @interaction is-parcial-futuro-alumno
 * @scope alumno-materia
 *
 * Given: alumno en materia con parcial activo
 * When:  decide si renderear placeholder vs contenido en Tareas/Recursos
 * Then:  retorna true si el parcial activo tiene estado === "futuro"
 * Edge:
 *   - sin materia / sin periodoInfo → false (render normal)
 */
function _alumnoIsParcialFuturo() {
    if (typeof hubMateriaActiva === "undefined" || !hubMateriaActiva) return false;
    const matId = hubMateriaActiva.id;
    const grupoId = _hubAlumnoGrupoDeMateria(matId);
    const parcialNum = _alumnoParcialActivoActual();
    const periodoInfo = (typeof getPeriodoInfo === "function" && typeof getPeriodoDeGrupo === "function")
        ? getPeriodoInfo(getPeriodoDeGrupo(grupoId))
        : null;
    if (!periodoInfo) return false;
    const p = (periodoInfo.parciales || []).find(x => x.num === parcialNum);
    return p?.estado === "futuro";
}

/**
 * @interaction render-parcial-futuro-placeholder-alumno
 * @scope alumno-materia
 *
 * Given: panelId del tab activo (Tareas/Recursos) + número de parcial futuro
 * When:  el alumno entra a un tab gated y el parcial no ha iniciado
 * Then:  inyecta empty state .x-empty en el panelId
 * Edge:
 *   - panelId no existe → no-op
 */
function _alumnoRenderParcialFuturoPlaceholder(panelId, parcialNum, tabId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const labels = {
        tareas:   { icon: "📋", title: "Tareas",   desc: "verás aquí las tareas asignadas por tu profesor" },
        recursos: { icon: "📁", title: "Recursos", desc: "verás aquí el material compartido por tu profesor" }
    };
    const cfg = labels[tabId] || { icon: "⏳", title: "Sección", desc: "el contenido estará disponible" };
    panel.innerHTML = `
        <div class="x-empty">
            <div class="x-empty__icon">${cfg.icon}</div>
            <div class="x-empty__title">Parcial ${parcialNum} aún no iniciado</div>
            <div class="x-empty__text">Cuando inicie el parcial, ${cfg.desc}.</div>
        </div>`;
}

/**
 * @interaction listener-parcial-cambio-alumno
 * @scope alumno-materia
 *
 * Given: alumno en materia con un tab activo
 * When:  evento 'xahni:parcialActivoCambio' con rol='alumno'
 * Then:  re-renderiza el tab activo (con gating de parcial futuro) +
 *        refresca visual de los tabs de parcial
 * Edge:
 *   - gmKey del evento != materia actual → no-op
 *   - hubMateriaActiva null → no-op
 */
document.addEventListener("xahni:parcialActivoCambio", function(e) {
    if (e.detail.rol !== "alumno") return;
    if (!hubMateriaActiva) return;
    const matId  = hubMateriaActiva.id || null;
    const grupoId = _hubAlumnoGrupoDeMateria(matId);
    const gmActual = matId && grupoId ? `${matId}_${grupoId}` : null;
    if (!gmActual || e.detail.gmKey !== gmActual) return;

    // Re-render tab activo con gating
    const activeTabBtn = document.querySelector("#hub-detalle-panel .hub-tab.active");
    const tabActivo = activeTabBtn ? activeTabBtn.dataset.tab : "calificaciones";
    const futuro = _alumnoIsParcialFuturo();
    const parcialNum = e.detail.parcial;
    const gatedTabs = ["tareas", "recursos"];

    if (futuro && gatedTabs.includes(tabActivo)) {
        _alumnoRenderParcialFuturoPlaceholder("hub-panel-" + tabActivo, parcialNum, tabActivo);
    } else if (tabActivo === "calificaciones" && typeof window.hubMateriaRenderCalificaciones === "function") {
        window.hubMateriaRenderCalificaciones();
    } else if (tabActivo === "tareas" && typeof buildTareasAlumno === "function") {
        buildTareasAlumno();
    } else if (tabActivo === "recursos" && typeof buildRecursosAlumno === "function") {
        buildRecursosAlumno();
    }

    // Re-render tabs de parcial en el header
    const periodoInfo = (typeof getPeriodoInfo === "function" && typeof getPeriodoDeGrupo === "function")
        ? getPeriodoInfo(getPeriodoDeGrupo(grupoId))
        : null;
    if (periodoInfo) alumnoMatRenderParcialTabs(gmActual, periodoInfo);
});

/**
 * @interaction hub-mat-render-maestria
 * @scope estudiante-hub-materia
 *
 * Given: alumno con hub-materia abierta (hubMateriaActiva set)
 * When:  hubSwitchTab("maestria", btn) dispatch render del tab
 * Then:  el panel #hub-panel-maestria recibe el content completo
 *        del tab Maestría (header + tokens grid + timeline + unlocks)
 * Edge:
 *   - hubMateriaActiva null → no-op silencioso
 *   - panel ausente → no-op silencioso
 *   - mastery sin data → fallback nivel 1 vía _getMaestriaDe
 */
function hubMatRenderMaestria() {
    if (!hubMateriaActiva) return;
    const panel = document.getElementById("hub-panel-maestria");
    if (!panel) return;
    // Canonical field es APP.user.id per data/demo/usuarios.json (auth.js
    // spreads {...user}). Slice G usaba .uid lo que daba undefined y caía
    // a fallback nivel 1 cuando se entraba con el login real.
    const uid = (typeof APP !== "undefined" && APP.user) ? (APP.user.id || APP.user.uid) : null;
    panel.innerHTML = _renderMaestriaTabContent(uid, hubMateriaActiva, "alumno");
}
window.hubMatRenderMaestria = hubMatRenderMaestria;

/**
 * @interaction render-panel-juegos-alumno
 * @scope estudiante-hub-aprendizaje
 *
 * Given materiaId activa + temaFiltro opcional (default "todos").
 * When alumno entra a tab Juegos del hub-materia.
 * Then inyecta el panel completo:
 *   1. page-head con título + sub + chip "Mis creaciones: N" + CTA "+ Crear".
 *   2. stats-row 4 cards (Jugados / Cal. promedio / XP pasiva / Top creación).
 *   3. banner info azul creator-economy.
 *   4. filter-chips temas.
 *   5. section "Disponibles para jugar" con grid de cards ricas.
 *   6. section "Mis creaciones" con grid de cards ricas (XP pasiva real).
 *   7. bottom banner-tip.
 * Edge:
 *   - sin DEMO_MATERIAS → fallback materia name "Materia".
 *   - sin juegos → empty state didáctico con CTA.
 *   - APP.user.tipo === "administrador" → NO CTA "+ Crear" visible.
 */
function renderPanelJuegosAlumno(materiaId, temaFiltro) {
    const target = document.getElementById("hub-panel-juegos");
    if (!target) return;
    const u = APP?.user;
    if (!u) return;
    const tema = temaFiltro || "todos";

    const todosJuegos = JuegosData.listarJuegosCanonical(materiaId);
    const filtrados = JuegosData.filtrarPorTema(todosJuegos, tema);
    const misCreaciones = todosJuegos.filter(j => j.creadoPor === u.id);
    const disponibles = filtrados.filter(j => j.creadoPor !== u.id);

    const stats = JuegosData.statsHeroAlumno(u.id);
    // Bundle C fix: usa listarTemasConTitulo para evitar mostrar IDs en el filtro
    const temasConTit = (typeof JuegosData.listarTemasConTitulo === "function")
        ? JuegosData.listarTemasConTitulo(materiaId)
        : JuegosData.listarTemasDeMateria(materiaId).map(id => ({ id, titulo: id }));
    const temas = [{ id: "todos", titulo: "Todos" }, ...temasConTit];
    const esAdmin = u.tipo === "administrador";

    target.innerHTML = `
        <div class="hub-panel hub-panel--juegos">
            <div class="x-page-head">
                <div>
                    <div class="x-page-head__title">Mis <em>juegos</em></div>
                    <div class="x-page-head__subtitle">Juega lo del tema · Crea para que otros aprendan y gana XP pasiva</div>
                </div>
                <div class="x-page-head__actions" style="display:flex;align-items:center;gap:10px">
                    <span class="x-chip x-chip--info" style="display:inline-flex;align-items:center;gap:6px">
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M8 14c2.5 0 4-1.6 4-3.6 0-1.4-1-2.4-1.5-3.4-.7 1-1.5 1.5-2 1-1-1-.5-3 1-5-3 1.5-5.5 4-5.5 7C4 12.4 5.5 14 8 14z"/>
                        </svg>
                        Mis creaciones: ${misCreaciones.length}
                    </span>
                    ${esAdmin ? "" : `<button class="x-btn x-btn--primary" onclick="CrearSelector.abrir('${materiaId}')">＋ Crear juego</button>`}
                    ${esAdmin ? "" : `<button class="x-btn x-btn--ghost" onclick="TemarioIaModal.openSelectorTemaIA('${materiaId}', true)" style="display:inline-flex;align-items:center;gap:6px"><span class="x-chip-ia" style="padding:1px 6px;font-size:9px;">✨</span> Generar con IA</button>`}
                </div>
            </div>

            <!-- Hero stats jugador-creador (canónico) -->
            <div class="x-card" style="margin-bottom:18px;padding:22px;position:relative;overflow:hidden">
                <div aria-hidden="true" style="position:absolute;inset:0;background:linear-gradient(135deg,var(--xahni-cyan-dim) 0%,transparent 35%,transparent 65%,var(--xahni-amber-dim) 100%);opacity:0.4;pointer-events:none"></div>
                <div style="position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:24px">
                    <div class="juegos-stub-stat">
                        <div class="juegos-stub-stat__icon" style="color:var(--accent-cyan-text)">
                            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3l9 5-9 5V3z"/></svg>
                        </div>
                        <div class="x-stat__label">Juegos jugados</div>
                        <div class="x-stat__num" style="color:var(--text-primary)">${stats.jugados}</div>
                        <div style="font-size:11px;color:var(--text-muted)">en esta materia</div>
                    </div>
                    <div class="juegos-stub-stat">
                        <div class="juegos-stub-stat__icon" style="color:var(--xahni-teal)">
                            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="3"/><circle cx="8" cy="8" r="0.6" fill="currentColor"/></svg>
                        </div>
                        <div class="x-stat__label">Calif. promedio</div>
                        <div class="x-stat__num" style="color:var(--text-primary)">${stats.promedio}</div>
                        <div style="font-size:11px;color:var(--text-muted)">en tus jugadas</div>
                    </div>
                    <div class="juegos-stub-stat">
                        <div class="juegos-stub-stat__icon" style="color:var(--xahni-amber)">
                            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><ellipse cx="8" cy="8" rx="6" ry="2.5" transform="rotate(-20 8 8)"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/></svg>
                        </div>
                        <div class="x-stat__label">XP pasiva</div>
                        <div class="x-stat__num" style="background:linear-gradient(90deg,var(--xahni-amber),var(--xahni-purple));-webkit-background-clip:text;background-clip:text;color:transparent">${stats.xpPasiva}</div>
                        <div style="font-size:11px;color:var(--text-muted)">de jugadas ajenas a tus juegos</div>
                    </div>
                    <div class="juegos-stub-stat">
                        <div class="juegos-stub-stat__icon" style="color:var(--xahni-purple)">
                            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2h8v3c0 2-1.5 3.5-4 3.5S4 7 4 5V2z"/><path d="M6 9h4M5 14h6M7 11v3M9 11v3"/></svg>
                        </div>
                        <div class="x-stat__label">Mi top creación</div>
                        <div style="font-family:var(--font-display);font-size:16px;font-weight:600;color:var(--text-primary);line-height:1.2;margin:2px 0">${stats.topCreacion || "—"}</div>
                        <div style="font-size:11px;color:var(--text-muted)">${stats.topScore > 0 ? "popularidad <span class='x-mono-sm' style='color:var(--state-ok);font-weight:700'>" + Math.round(stats.topScore * 100) + "%</span>" : "sin creaciones aún"}</div>
                    </div>
                </div>
            </div>

            <!-- Identidad creator-economy POV alumno (canónico) -->
            <div class="x-card x-card--info" style="margin-bottom:18px;padding:14px 18px">
                <div style="display:flex;align-items:center;gap:12px;font-size:12px;color:var(--text-secondary);line-height:1.55">
                    <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--xahni-amber);flex-shrink:0">
                        <path d="M8 14c2.5 0 4-1.6 4-3.6 0-1.4-1-2.4-1.5-3.4-.7 1-1.5 1.5-2 1-1-1-.5-3 1-5-3 1.5-5.5 4-5.5 7C4 12.4 5.5 14 8 14z"/>
                    </svg>
                    <span>
                        Tú <strong style="color:var(--text-primary)">juegas y creas</strong>.
                        Crea <strong style="color:var(--xahni-cyan)">quizzes, V/F o flashcards</strong> para que otros aprendan.
                        Tus jugadas dan XP directa; otros jugando tus juegos te dan <strong style="color:var(--xahni-amber)">XP pasiva</strong> cuando aciertan ≥80%.
                    </span>
                </div>
            </div>

            <!-- Filtros + orden (canónico) -->
            <div class="juegos-stub-filters" style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px;flex-wrap:wrap">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                    <span style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-right:4px">Filtrar tema</span>
                    ${temas.map(t => `
                        <button class="x-chip ${tema === t.id ? 'x-chip--info' : ''}"
                                onclick="renderPanelJuegosAlumno('${materiaId}', '${t.id}')"
                                style="${tema === t.id ? '' : 'border:1px solid var(--border);background:var(--surface-2);color:var(--text-muted);'}font-family:var(--font-sans);padding:3px 10px;border-radius:99px;font-size:11px">
                            ${t.titulo}
                        </button>
                    `).join("")}
                </div>
                <select disabled title="Disponible post-Supabase" style="background:var(--surface-1);border:1px solid var(--border);border-radius:var(--r-md);padding:6px 10px;font-family:var(--font-sans);font-size:12px;color:var(--text-muted);opacity:0.55;cursor:not-allowed;min-width:180px">
                    <option>Ordenar: Recomendados ↓</option>
                </select>
            </div>

            <!-- Disponibles para jugar -->
            <header style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:0 2px">
                <span style="font-family:var(--font-display);font-size:17px;font-weight:600;color:var(--text-primary)">Disponibles para jugar</span>
                <span class="x-mono-sm" style="color:var(--text-muted)">${disponibles.length} del tema activo</span>
            </header>
            ${disponibles.length === 0
                ? _emptyStateJuegos(materiaId)
                : `<div class="juegos-stub-grid" style="margin-bottom:22px">${disponibles.map(j => _renderJuegoCardAlumno(j, u.id)).join("")}</div>`
            }

            <!-- Mis creaciones -->
            <header style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:0 2px">
                <span style="font-family:var(--font-display);font-size:17px;font-weight:600;color:var(--text-primary)">Mis creaciones</span>
                <span class="x-mono-sm" style="color:var(--text-muted)">${misCreaciones.length} creaciones</span>
            </header>
            ${misCreaciones.length === 0
                ? `<div style="padding:18px;background:var(--surface-1);border:1px dashed var(--border);border-radius:var(--r-md);text-align:center;font-size:12px;color:var(--text-muted);margin-bottom:18px">Aún no has creado juegos. ${esAdmin ? "" : "Empieza con un quiz rápido."}</div>`
                : `<div class="juegos-stub-grid" style="margin-bottom:18px">${misCreaciones.map(j => _renderJuegoCardCreador(j, u.id)).join("")}</div>`
            }

            <!-- Bottom legend POV alumno -->
            <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 18px;background:var(--surface-1);border:1px dashed var(--border);border-radius:var(--r-md);font-size:12px;color:var(--text-muted);flex-wrap:wrap;gap:14px">
                <div style="flex:1;min-width:280px">Un juego bien diseñado te rinde <strong style="color:var(--text-secondary)">XP pasiva</strong> durante todo el periodo cuando otros lo aciertan.</div>
            </div>
        </div>
    `;
}
window.renderPanelJuegosAlumno = renderPanelJuegosAlumno;
window.renderPanelJuegosActual = () => renderPanelJuegosAlumno(window._juegosCurrentMateriaId, window._juegosCurrentTema);

function _emptyStateJuegos(materiaId) {
    const esAdmin = APP?.user?.tipo === "administrador";
    return `
        <div style="padding:32px 24px;background:var(--surface-1);border:1px dashed var(--border);border-radius:var(--r-md);text-align:center;margin-bottom:22px">
            <div style="font-size:32px;margin-bottom:10px">🎯</div>
            <div style="font-size:13px;color:var(--text-secondary);line-height:1.5;margin-bottom:14px">
                Aún no hay juegos en este tema.${esAdmin ? "" : `<br>Sé el primero — crea un quiz, V/F o flashcards y gana XP cuando otros lo jueguen bien.`}
            </div>
            ${esAdmin ? "" : `<button class="x-btn x-btn--primary" onclick="CrearSelector.abrir('${materiaId}')">＋ Crear juego</button>`}
        </div>
    `;
}

function _juegoCardSubchips(juego) {
    const chipIa = juego.origen === "ia"
        ? `<span class="x-chip-ia" title="Quiz generado por Gemini IA">✨ Gemini</span>`
        : "";
    // Fix 2026-06-09: resolver creadoPor (uid) a nombre legible en lugar de mostrar el UID
    const creadorObj = (typeof DEMO_USERS !== "undefined" && juego.creadoPor)
        ? DEMO_USERS.find(u => u.id === juego.creadoPor) : null;
    const creadorNombre = creadorObj
        ? (creadorObj.nombre || creadorObj.email || "—")
        : (juego.creadoPor ? (juego.creadoPor.slice(0, 6) + "…") : "—");
    return `
        <span class="x-chip x-chip--info" style="font-size:10px">${juego.tipo.toUpperCase()}</span>
        <span class="x-chip x-chip--muted" style="font-size:10px">Por ${creadorNombre}</span>
        ${chipIa}
    `;
}

function _juegoCardChipEstado(juego, viewerUid) {
    const pop = JuegosData.calcPopularidad(juego.id);
    const replays = JuegosData.replaysDelJugador(viewerUid, juego.id);
    if (juego.creadoPor === viewerUid) {
        return `<span class="x-chip x-chip--ok" style="font-size:10px;flex-shrink:0">Mi creación</span>`;
    }
    if (replays >= 1) {
        return `<span class="x-chip x-chip--ok" style="font-size:10px;flex-shrink:0">Ya jugado · ${replays}x</span>`;
    }
    if (pop < 0.1) {
        return `<span class="x-chip x-chip--warn" style="font-size:10px;flex-shrink:0">Nuevo</span>`;
    }
    if (pop >= 0.7) {
        return `<span class="x-chip x-chip--ok" style="font-size:10px;flex-shrink:0">Top del grupo</span>`;
    }
    return `<span class="x-chip x-chip--muted" style="font-size:10px;flex-shrink:0">Sin jugar</span>`;
}

function _juegoCardPopBarGradient(pop, viewerUid, juego) {
    // Gradient color por contexto
    if (juego.creadoPor === viewerUid) {
        return "linear-gradient(90deg,var(--xahni-amber),var(--xahni-purple))";
    }
    if (pop >= 0.7) return "linear-gradient(90deg,var(--xahni-cyan),var(--xahni-blue))";
    if (pop >= 0.4) return "linear-gradient(90deg,var(--state-info),var(--xahni-blue))";
    return "var(--state-warn)";
}

function _renderJuegoCardAlumno(juego, viewerUid) {
    const pop = JuegosData.calcPopularidad(juego.id);
    const popPct = Math.max(8, Math.round(pop * 100));
    const replays = JuegosData.replaysDelJugador(viewerUid, juego.id);
    const ctaTexto = replays > 0 ? "Jugar otra vez →" : "Jugar →";
    const strongClass = (pop >= 0.7 || juego.creadoPor === viewerUid) ? " juegos-stub-card--strong" : "";
    const items = JuegosData.getMaxItems(juego);
    const xpBase = items * (juego.tipo === "vf" ? 15 : juego.tipo === "flashcards" ? 10 : 20);
    const tiempoEst = Math.max(1, Math.round(items * 0.8));
    const titleEsc = (juego.nombre || "").replace(/</g, "&lt;");

    return `
        <article class="x-card juegos-stub-card${strongClass}" onclick="abrirJuego('${juego.id}')">
            <header class="juegos-stub-card__head">
                <div>
                    <div class="juegos-stub-card__title">${titleEsc}</div>
                    <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
                        ${_juegoCardSubchips(juego)}
                    </div>
                </div>
                ${_juegoCardChipEstado(juego, viewerUid)}
            </header>
            <div class="juegos-stub-card__metrics">
                <div><div class="x-stat__label" style="font-size:9px">XP base</div><div class="x-mono-sm" style="font-size:15px;color:var(--xahni-amber);font-weight:700">+${xpBase}</div></div>
                <div><div class="x-stat__label" style="font-size:9px">Tiempo est.</div><div class="x-mono-sm" style="font-size:15px;color:var(--text-primary);font-weight:700">${tiempoEst} min</div></div>
                <div><div class="x-stat__label" style="font-size:9px">Tus intentos</div><div class="x-mono-sm" style="font-size:15px;color:${replays > 0 ? 'var(--state-info)' : 'var(--text-secondary)'};font-weight:700">${replays}</div></div>
            </div>
            <div class="juegos-stub-card__bar">
                <div class="juegos-stub-card__bar-label">popularidad</div>
                <div class="x-progress" style="flex:1"><div class="x-progress__fill" style="width:${popPct}%;background:${_juegoCardPopBarGradient(pop, viewerUid, juego)}"></div></div>
            </div>
            <div class="juegos-stub-card__cta">${ctaTexto}</div>
        </article>
    `;
}

function _renderJuegoCardCreador(juego, creadorUid) {
    const pop = JuegosData.calcPopularidad(juego.id);
    const popPct = Math.max(8, Math.round(pop * 100));
    let jugadoresAjenos = 0;
    let xpPasivaTotal = 0;
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith("xahni:replays:") && key.endsWith(":" + juego.id) && !key.includes(":" + creadorUid + ":")) {
                jugadoresAjenos++;
                xpPasivaTotal += parseInt(localStorage.getItem(key), 10) * 20 || 0;
            }
        }
    } catch (e) { /* defensive */ }
    const titleEsc = (juego.nombre || "").replace(/</g, "&lt;");
    const promedio = jugadoresAjenos > 0 ? (8 + Math.random() * 2).toFixed(1) : "—";
    const promedioColor = jugadoresAjenos === 0 ? "var(--text-muted)"
        : parseFloat(promedio) >= 8 ? "var(--state-ok)"
        : parseFloat(promedio) >= 7 ? "var(--state-info)"
        : "var(--state-warn)";
    const strongClass = (pop >= 0.7) ? " juegos-stub-card--strong" : "";
    const chipEstado = pop >= 0.7 ? `<span class="x-chip x-chip--ok" style="font-size:10px;flex-shrink:0">Top creación</span>`
        : pop >= 0.4 ? `<span class="x-chip x-chip--muted" style="font-size:10px;flex-shrink:0">Estable</span>`
        : `<span class="x-chip x-chip--warn" style="font-size:10px;flex-shrink:0">En rodaje</span>`;

    const chipIa = juego.origen === "ia"
        ? `<span class="x-chip-ia" title="Quiz generado por Gemini IA">✨ Gemini</span>`
        : "";
    return `
        <article class="x-card juegos-stub-card${strongClass}" style="cursor:pointer" onclick="abrirJuego('${juego.id}')">
            <header class="juegos-stub-card__head">
                <div>
                    <div class="juegos-stub-card__title">${titleEsc}</div>
                    <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><span class="x-chip x-chip--info" style="font-size:10px">${juego.tipo.toUpperCase()}</span>${chipIa}</div>
                </div>
                ${chipEstado}
            </header>
            <div class="juegos-stub-card__metrics">
                <div><div class="x-stat__label" style="font-size:9px">Jugadas</div><div class="x-mono-sm" style="font-size:15px;color:var(--text-primary);font-weight:700">${jugadoresAjenos}</div></div>
                <div><div class="x-stat__label" style="font-size:9px">Promedio</div><div class="x-mono-sm" style="font-size:15px;color:${promedioColor};font-weight:700">${promedio}</div></div>
                <div><div class="x-stat__label" style="font-size:9px">XP pasiva</div><div class="x-mono-sm" style="font-size:15px;color:var(--xahni-amber);font-weight:700">+${xpPasivaTotal}</div></div>
            </div>
            <div class="juegos-stub-card__bar">
                <div class="juegos-stub-card__bar-label">popularidad</div>
                <div class="x-progress" style="flex:1"><div class="x-progress__fill" style="width:${popPct}%;background:${_juegoCardPopBarGradient(pop, creadorUid, juego)}"></div></div>
            </div>
            <div class="juegos-stub-card__cta">Vista previa →</div>
        </article>
    `;
}
