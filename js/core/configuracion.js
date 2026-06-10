// ═══════════════════════════════════════════════════════════
// CONFIGURACIÓN — Efectos reales + persistencia en localStorage
// ═══════════════════════════════════════════════════════════

const _CONFIG_KEY = "xahni_config";

const CONFIG_DEFAULTS = {
    // darkMode: false → lightmode por default (feedback usuarios 2026-06-06).
    // Toggle disponible en Configuración para usuarios que prefieran dark.
    darkMode:           false,
    gamerMode:          true,
    animaciones:        true,
    notifApp:           true,
    notifEmail:         false,
    notifRacha:         true,
    perfilPublico:      true,
    compartirProgreso:  true,
    permitirMensajes:   false,
};

// ── Persistencia ──────────────────────────────────────────

/**
 * @interaction load-config
 * @scope core-config-persistencia
 *
 * Given localStorage del navegador (puede estar vacío o tener entry
 *   `_CONFIG_KEY` con JSON serializado).
 * When un caller (toggleConfig, buildConfiguracion, aplicarConfigInicial,
 *   configNotifActiva) necesita leer la config actual.
 * Then retorna objeto cfg con spread merge: defaults primero + valor stored
 *   sobreescribe. Garantiza que keys nuevas (default true) entren con
 *   migración silenciosa.
 * Edge:
 *   - localStorage no disponible (Safari privacy mode, SSR) → catch
 *     retorna CONFIG_DEFAULTS clone.
 *   - JSON malformado en storage → SyntaxError → catch retorna defaults.
 *   - Entry no existe (primera carga) → retorna defaults clone.
 *   - Clone via spread evita mutación accidental del const CONFIG_DEFAULTS.
 */
function _loadConfig() {
    try {
        const raw = localStorage.getItem(_CONFIG_KEY);
        return raw ? { ...CONFIG_DEFAULTS, ...JSON.parse(raw) } : { ...CONFIG_DEFAULTS };
    } catch(e) {
        return { ...CONFIG_DEFAULTS };
    }
}

/**
 * @interaction save-config
 * @scope core-config-persistencia
 *
 * Given un objeto cfg con la config actualizada.
 * When toggleConfig o restablecerConfig necesitan persistir cambios.
 * Then escribe JSON serializado en localStorage[_CONFIG_KEY].
 * Edge:
 *   - localStorage no disponible o quota excedido → TypeError/QuotaError
 *     NO catched; caller debería estar en try/catch si aplica.
 *   - No clona cfg → caller debe pasar referencia segura.
 */
function _saveConfig(cfg) {
    localStorage.setItem(_CONFIG_KEY, JSON.stringify(cfg));
}

// ── Efectos en el DOM ─────────────────────────────────────

/**
 * @interaction aplicar-dark-mode
 * @scope core-config-toggle-darkmode
 *
 * Given un boolean activo (true=oscuro, false=claro).
 * When toggleConfig("darkMode", ...) o aplicarConfigInicial lo invocan.
 * Then toggle class `.light-mode` en document.body con `!activo`.
 *   CSS de variables.css y todos los archivos heredan vars del tema
 *   activo via cascada.
 * Edge:
 *   - body no en DOM (durante early init) → classList undefined → error.
 *     Caller espera DOM listo (DOMContentLoaded).
 *   - Patrón inverso: light-mode es la "anomalía" sobre dark default.
 */
function _aplicarDarkMode(activo) {
    document.body.classList.toggle("light-mode", !activo);
}

/**
 * @interaction aplicar-animaciones
 * @scope core-config-toggle-animaciones
 *
 * Given un boolean activo (true=con animaciones, false=sin).
 * When toggleConfig("animaciones", ...) o aplicarConfigInicial lo invocan.
 * Then toggle class `.no-animations` en document.body con `!activo`.
 *   CSS aplica `transition: none !important` + `animation: none !important`
 *   a `*`, `*::before`, `*::after` cuando activo=false.
 * Edge:
 *   - Patrón inverso: no-animations es la "anomalía" sobre con animaciones
 *     default.
 *   - Reduced-motion preferred del SO no afecta esta config — son
 *     independientes (deuda: respetar prefers-reduced-motion).
 */
function _aplicarAnimaciones(activo) {
    document.body.classList.toggle("no-animations", !activo);
}

/**
 * @interaction aplicar-gamer-mode
 * @scope core-config-toggle-gamermode
 *
 * Given un boolean activo (true=gamer-on, false=gamer-off).
 * When toggleConfig("gamerMode", ...) o aplicarConfigInicial lo invocan.
 * Then toggle class `.gamer-off` en document.body con `!activo`. CSS
 *   alterna entre vistas `.gamer-on-view` y `.gamer-off-view` (slice C7
 *   pattern canonical) + reduce densidad/decoración cuando off.
 * Edge:
 *   - hub-shell.js también tiene `hubToggleGamerMode` que toggle directo
 *     desde el switch del cluster shell — convive con este (mismo path).
 *   - Slice gamer-off cross-vista 9-5 (2026-05-27) cementó los wrappers
 *     `.gamer-on-view`/`.gamer-off-view` para vistas dual-mode.
 */
function _aplicarGamerMode(activo) {
    document.body.classList.toggle("gamer-off", !activo);
}

/**
 * @interaction aplicar-notif-badge
 * @scope core-config-toggle-notifbadge
 *
 * Given un boolean activo (true=badge visible si hay notifs, false=oculto).
 * When toggleConfig("notifApp", ...) lo invoca.
 * Then si activo=false, oculta #notif-badge con `display:none` inline.
 *   Si activo=true, NO restaura visibilidad (la lógica de notificaciones
 *   muestra/oculta dinámicamente según count).
 * Edge:
 *   - #notif-badge no en DOM (rol admin sin badge) → no-op.
 *   - Activación visual queda en manos de notificaciones.js renderBadge.
 *   - Asimetría intencional: este helper solo "apaga"; la activación es
 *     responsabilidad del subsistema notifs.
 */
function _aplicarNotifBadge(activo) {
    // Si el usuario desactiva notificaciones, ocultar el badge
    const badge = document.getElementById("notif-badge");
    if (badge && !activo) badge.style.display = "none";
}

/**
 * @interaction aplicar-config-inicial
 * @scope core-config-init
 *
 * Given la app se carga (DOMContentLoaded dispara).
 * When document.addEventListener("DOMContentLoaded", ...) la invoca.
 * Then carga config desde localStorage (con defaults fallback) y aplica
 *   3 efectos visuales en orden:
 *   1. _aplicarDarkMode(cfg.darkMode)
 *   2. _aplicarGamerMode(cfg.gamerMode)
 *   3. _aplicarAnimaciones(cfg.animaciones)
 *   NO aplica notifBadge ni efectos privacidad (no son visuales body-level).
 * Edge:
 *   - Llamada antes de DOMContentLoaded (orden scripts) → body podría no
 *     estar disponible; defensiva implícita en cada _aplicar* via toggle.
 *   - Listener auto-registrado al final del archivo (L156).
 */
function aplicarConfigInicial() {
    const cfg = _loadConfig();
    _aplicarDarkMode(cfg.darkMode);
    _aplicarGamerMode(cfg.gamerMode);
    _aplicarAnimaciones(cfg.animaciones);
}

// ── Toggle individual ─────────────────────────────────────

/**
 * Llama esto desde cada botón toggle del HTML.
 * @param {string} key  — clave del CONFIG_DEFAULTS
 * @param {HTMLElement} el — el botón que se pulsó
 *
 * @interaction toggle-config
 * @scope core-config-toggle-orchestrator
 *
 * Given un key del CONFIG_DEFAULTS + el HTMLElement que disparó el click.
 * When user click en cualquier toggle del modal Configuración.
 * Then ejecuta secuencia:
 *   1. Lee cfg actual via _loadConfig.
 *   2. Flip del valor en key (toggle boolean).
 *   3. Persiste cfg actualizada via _saveConfig.
 *   4. Toggle visual class `.on` en el botón.
 *   5. Switch por key → aplica efecto inmediato:
 *      - darkMode → _aplicarDarkMode + toast.
 *      - gamerMode → _aplicarGamerMode + toast.
 *      - animaciones → _aplicarAnimaciones + toast.
 *      - notifApp → _aplicarNotifBadge + toast.
 *      - notifRacha/perfilPublico → solo toast (sin efecto visual).
 *      - default (notifEmail, compartirProgreso, permitirMensajes) → solo
 *        persistencia (sin efecto inmediato).
 * Edge:
 *   - el null/undefined → classList undefined → error. Caller pasa el botón.
 *   - key no en CONFIG_DEFAULTS → cfg[key] queda como `undefined → true`
 *     en el flip. Casi nunca aplica (HTML tiene set fijo).
 *   - Toast emojis hardcoded inline (deuda i18n).
 */
function toggleConfig(key, el) {
    const cfg      = _loadConfig();
    cfg[key]       = !cfg[key];
    const activo   = cfg[key];
    _saveConfig(cfg);

    // Actualizar clase visual del botón
    el.classList.toggle("on", activo);

    // Efectos inmediatos por clave
    switch(key) {
        case "darkMode":
            _aplicarDarkMode(activo);
            showToast(activo ? "🌙 Modo oscuro activado" : "☀️ Modo claro activado", "success");
            break;
        case "gamerMode":
            _aplicarGamerMode(activo);
            showToast(activo ? "🎮 Gamer mode activado" : "Gamer mode desactivado", "success");
            break;
        case "animaciones":
            _aplicarAnimaciones(activo);
            showToast(activo ? "✨ Animaciones activadas" : "⚡ Animaciones desactivadas", "success");
            break;
        case "notifApp":
            _aplicarNotifBadge(activo);
            showToast(activo ? "🔔 Notificaciones activadas" : "🔕 Notificaciones desactivadas", "success");
            break;
        case "notifRacha":
            showToast(activo ? "🔥 Recordatorios de racha activados" : "Recordatorios desactivados", "success");
            break;
        case "perfilPublico":
            showToast(activo ? "👁 Perfil visible en el ranking" : "🔒 Perfil ocultado del ranking", "success");
            break;
        default:
            // Sin efecto inmediato visible — solo persiste
            break;
    }
}

// ── Poblar la vista con valores guardados ─────────────────

/**
 * @interaction build-configuracion
 * @scope core-config-builder
 *
 * Given el modal #modal-configuracion montado con 9 toggles tagged con
 *   ids `toggle-{darkMode|gamerMode|animaciones|notifApp|notifEmail|
 *   notifRacha|perfilPublico|compartirProgreso|permitirMensajes}` y APP
 *   en estado válido.
 * When hubOpenConfiguracion lo invoca antes de openModal, o un caller
 *   programático sincroniza el modal.
 * Then lee cfg actual via _loadConfig y aplica class `.on` (toggle ON)
 *   por id del map según el valor boolean correspondiente.
 * Edge:
 *   - Id no en DOM (rol admin sin algunos toggles) → optional via el = ...
 *     check skip silente.
 *   - cfg con keys extra (forwards compat) → ignoradas (no en map).
 *   - cfg con keys faltantes (legacy data) → defaults via _loadConfig spread.
 */
function buildConfiguracion() {
    const cfg = _loadConfig();

    const map = {
        "toggle-dark-mode":          cfg.darkMode,
        "toggle-gamer-mode":         cfg.gamerMode,
        "toggle-animaciones":        cfg.animaciones,
        "toggle-notif-app":          cfg.notifApp,
        "toggle-notif-email":        cfg.notifEmail,
        "toggle-notif-racha":        cfg.notifRacha,
        "toggle-perfil-publico":     cfg.perfilPublico,
        "toggle-compartir-progreso": cfg.compartirProgreso,
        "toggle-permitir-mensajes":  cfg.permitirMensajes,
    };

    Object.entries(map).forEach(([id, valor]) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle("on", valor);
    });
}

// ── Guardar y restablecer ─────────────────────────────────

/**
 * @interaction guardar-config
 * @scope core-config-action-guardar
 *
 * Given el modal Configuración abierto (toggleConfig ya guardó cada cambio
 *   en tiempo real).
 * When user click en "Guardar" del modal.
 * Then NO persiste nada (toggleConfig ya lo hizo en cada cambio); solo
 *   muestra toast confirmación "Configuración guardada".
 *   Existencia del botón es UX feedback ritual; si el modal añadiera
 *   inputs de texto en el futuro (i18n, threshold settings), aquí se
 *   harían los saves agregados.
 * Edge:
 *   - showToast no cargado → error console.
 *   - Closing del modal queda en mano del handler de su botón (NO aquí).
 */
function guardarConfig() {
    // Ya se guarda en tiempo real con toggleConfig(),
    // pero si hubiera inputs de texto aquí se guardarían.
    showToast("✅ Configuración guardada", "success");
}

/**
 * @interaction restablecer-config
 * @scope core-config-action-restablecer
 *
 * Given el modal Configuración abierto y CONFIG_DEFAULTS const definido.
 * When user click en "Restablecer" del modal.
 * Then ejecuta secuencia:
 *   1. _saveConfig({...CONFIG_DEFAULTS}) escribe defaults completos.
 *   2. buildConfiguracion repaint del modal con toggles según defaults.
 *   3. Aplica 3 efectos visuales (darkMode, gamerMode, animaciones) con
 *      defaults.
 *   4. Toast info "Configuración restablecida".
 * Edge:
 *   - Defaults cambian visual inmediato (e.g. light-mode user vuelve a dark).
 *   - NO restablece notifBadge (no es destructive y subsistema notifs
 *     gestiona su visibilidad).
 *   - NO pide confirmación — decisión UX: settings restablecer es low-risk.
 *     Si en futuro se agregan settings críticos, considerar confirmarCanonico.
 */
function restablecerConfig() {
    _saveConfig({ ...CONFIG_DEFAULTS });
    buildConfiguracion();
    _aplicarDarkMode(CONFIG_DEFAULTS.darkMode);
    _aplicarGamerMode(CONFIG_DEFAULTS.gamerMode);
    _aplicarAnimaciones(CONFIG_DEFAULTS.animaciones);
    showToast("↺ Configuración restablecida", "info");
}

// ── Integración con notificaciones ───────────────────────
// agregarNotificacion() lee esto antes de agregar

/**
 * @interaction config-notif-activa
 * @scope core-config-helper-canonical
 *
 * Given (sin args).
 * When `agregarNotificacion` del módulo notifs (notificaciones.js) necesita
 *   chequear si el usuario tiene notifs habilitadas antes de persistir
 *   una nueva notificación.
 * Then lee cfg via _loadConfig y retorna `cfg.notifApp` (boolean).
 * Edge:
 *   - localStorage error → defaults (notifApp: true) → activa por default.
 *   - Caller de notifs respeta este flag: si false → notification se
 *     descarta silenciosamente (UX: usuario optó-out).
 *   - Llamada en cada agregarNotificacion → no cache; performance trivial
 *     (1 read + 1 parse), pero si vuelve hot, memoizar.
 */
function configNotifActiva() {
    return _loadConfig().notifApp;
}

// ── Aplicar al cargar la página ───────────────────────────
document.addEventListener("DOMContentLoaded", aplicarConfigInicial);

/**
 * @interaction config-switch-tab
 * @scope core (modal Configuración, slice pre-c10 7.5)
 *
 * Given el modal #modal-configuracion abierto con 3 paneles (apariencia,
 *   notificaciones, privacidad).
 * When user click en una de las pestañas .x-tabs__tab del modal.
 * Then mueve .is-active al tab clicado y conmuta visibilidad de los paneles
 *   (atributo hidden) mostrando solo el correspondiente.
 * Edge si tabId no corresponde a un panel, no hace nada visible.
 */
function configSwitchTab(tabId, btn) {
    document.querySelectorAll("#modal-configuracion .x-tabs__tab")
        .forEach(b => b.classList.remove("is-active"));
    if (btn) btn.classList.add("is-active");

    const panels = ["apariencia", "notificaciones", "privacidad"];
    panels.forEach(p => {
        const el = document.getElementById(`config-panel-${p}`);
        if (!el) return;
        if (p === tabId) el.removeAttribute("hidden");
        else el.setAttribute("hidden", "");
    });
}
window.configSwitchTab = configSwitchTab;