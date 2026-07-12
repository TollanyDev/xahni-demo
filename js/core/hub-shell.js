const HUB_TABS_VALIDOS = ["inicio", "mi-grupo", "materias", "calendario", "competencias", "perfil"];
const HUB_LS_TAB_KEY_PREFIX = "xahni.hubTabActivo";
const HUB_LS_GAMER_KEY = "xahni.gamerMode";

// FIX 2026-07-08: antes HUB_LS_TAB_KEY era una key ÚNICA y global —
// compartida por CUALQUIER usuario/rol que usara el mismo navegador. Por
// eso, al cerrar sesión como alumno (con "materias" seleccionado) e
// iniciar sesión como profesor, hubInit() restauraba "materias" también
// para el profesor (bleed-through entre roles/usuarios). Ahora la key
// se namespacea por uid; sin usuario, cae a una key genérica (pantalla
// de login no la usa, así que es inofensiva).
function _hubTabKey() {
    const uid = APP?.user?.id;
    return uid ? `${HUB_LS_TAB_KEY_PREFIX}:${uid}` : HUB_LS_TAB_KEY_PREFIX;
}

/**
 * @interaction hub-init
 * @scope core (hub shell entry)
 *
 * Given un usuario alumno o profesor logueado.
 * When loadDashboard branchea al shell hub y llama hubInit().
 * Then pinta el header del avatar dropdown, restaura el modo gamer desde
 *   localStorage (default ON), restaura el tab activo (default inicio),
 *   y dispatcha hubShellSwitchTab al tab restaurado.
 * Edge si APP.user es null o admin, retorna sin tocar el DOM.
 */
function hubInit() {
    const u = APP?.user;
    if (!u || u.tipo === "administrador") return;

    // Restaurar gamer mode desde localStorage (default ON = sin clase gamer-off)
    try {
        const mode = localStorage.getItem(HUB_LS_GAMER_KEY) || "on";
        document.body.classList.toggle("gamer-off", mode === "off");
        const toggle = document.getElementById("hub-gamer-toggle");
        if (toggle) toggle.checked = (mode === "on");
    } catch (e) { /* localStorage bloqueado: queda en default ON */ }

    _repaintHubAvatar();
    const nameEl = document.getElementById("hub-avatar-menu-name");
    const roleEl = document.getElementById("hub-avatar-menu-role");
    if (nameEl) nameEl.textContent = u.nombre ?? "";
    if (roleEl) {
        roleEl.textContent = `${capitalize(u.tipo ?? "")} · Niv. ${u.nivel ?? 0}`;
    }

    let initialTab = "inicio";
    try {
        const saved = localStorage.getItem(_hubTabKey());
        if (saved && HUB_TABS_VALIDOS.includes(saved)) initialTab = saved;
    } catch (e) { /* default inicio */ }

    const btn = document.querySelector(`.hub-shell-tabs .hub-shell-tab[data-tab="${initialTab}"]`);
    hubShellSwitchTab(initialTab, btn);
}
window.hubInit = hubInit;

/**
 * @interaction hub-switch-tab
 * @scope core (hub shell)
 *
 * Given un tabId válido y opcionalmente el botón clicado.
 * When el usuario hace click en un tab o hubInit restaura uno.
 * Then mueve .active al tab correspondiente, persiste en localStorage,
 *   y renderiza placeholder en el content area. En sub-slices 7.2-7.4 esta
 *   función registra dispatchers reales por rol.
 * Edge si tabId no está en HUB_TABS_VALIDOS, no hace nada.
 */
function hubShellSwitchTab(tabId, btn) {
    if (!HUB_TABS_VALIDOS.includes(tabId)) return;

    document.querySelectorAll(".hub-shell-tabs .hub-shell-tab").forEach(b => b.classList.remove("active"));
    if (btn) {
        btn.classList.add("active");
    } else {
        const found = document.querySelector(`.hub-shell-tabs .hub-shell-tab[data-tab="${tabId}"]`);
        if (found) found.classList.add("active");
    }

    try { localStorage.setItem(_hubTabKey(), tabId); } catch (e) { /* ignore */ }

    const content = document.getElementById("hub-content");
    if (!content) return;

    const tipo = APP?.user?.tipo;

    if (tabId === "inicio") {
        if (tipo === "estudiante" && typeof hubInicioRenderEst === "function") {
            hubInicioRenderEst();
            return;
        }
        if (tipo === "profesor" && typeof hubInicioRenderProf === "function") {
            hubInicioRenderProf();
            return;
        }
    }

    if (tabId === "perfil") {
        _hubLoadPerfilInline(content);
        return;
    }

    if (tabId === "mi-grupo" || tabId === "materias" || tabId === "calendario" || tabId === "competencias") {
        _hubLoadAprendizajeInline(content, tabId);
        return;
    }

    const labelMap = {
        "inicio": "Inicio",
        "mi-grupo": "Mi grupo",
        "materias": "Materias",
        "calendario": "Calendario",
        "competencias": "Competencias",
        "perfil": "Perfil"
    };
    content.innerHTML = `<div class="hub-content__placeholder">Tab "${labelMap[tabId]}" — contenido en construcción (sub-slice ${tabId === "inicio" ? "7.3" : "7.4"})</div>`;
}
window.hubShellSwitchTab = hubShellSwitchTab;

/* ── R1 · Bottom-sheet "Más" (mobile <560px) ────────────────────
   Abre <dialog id="hub-more-sheet"> con los 3 tabs ocultos en mobile
   (Mi grupo, Competencias, Perfil). HTMLDialogElement provee de
   forma nativa focus-trap, esc-to-close y backdrop click. */

/**
 * @interaction hub-open-more-sheet
 * Given user click en el tab "Más" (visible solo <560px).
 * When la función se invoca con el botón trigger.
 * Then abre el dialog como modal, marca aria-expanded=true en el
 *   trigger y envía focus al primer item del sheet.
 */
function hubShellOpenMore(trigger) {
    const sheet = document.getElementById("hub-more-sheet");
    if (!sheet) return;
    if (typeof sheet.showModal === "function" && !sheet.open) {
        sheet.showModal();
    }
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    // Focus inicial al primer item (regla §1 focus-on-route-change)
    requestAnimationFrame(() => {
        sheet.querySelector(".hub-more-sheet__item")?.focus();
    });
}
window.hubShellOpenMore = hubShellOpenMore;

/**
 * @interaction hub-close-more-sheet
 * Given user click en Cerrar / backdrop / Escape.
 * When se invoca close().
 * Then cierra dialog y devuelve focus al tab "Más".
 */
function hubShellCloseMore() {
    const sheet = document.getElementById("hub-more-sheet");
    if (!sheet) return;
    if (typeof sheet.close === "function" && sheet.open) sheet.close();
    const trigger = document.querySelector(".hub-shell-tab--more");
    if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
        trigger.focus();
    }
}
window.hubShellCloseMore = hubShellCloseMore;

/**
 * @interaction hub-pick-from-more
 * Given user click en un item del sheet (Mi grupo / Competencias / Perfil).
 * When se invoca con tabId.
 * Then cierra el sheet + dispara hubShellSwitchTab al tab correspondiente.
 */
function hubShellPickFromMore(tabId) {
    hubShellCloseMore();
    const btn = document.querySelector(`.hub-shell-tabs .hub-shell-tab[data-tab="${tabId}"]`);
    hubShellSwitchTab(tabId, btn);
}
window.hubShellPickFromMore = hubShellPickFromMore;

// Backdrop click cierra el sheet (HTMLDialogElement no lo hace por default).
// Registrado idempotente con guard.
if (!window.__hubMoreSheetBackdropWired) {
    window.__hubMoreSheetBackdropWired = true;
    document.addEventListener("click", function (e) {
        const sheet = document.getElementById("hub-more-sheet");
        if (!sheet || !sheet.open) return;
        if (e.target === sheet) hubShellCloseMore();
    });
}

/**
 * @interaction hub-go-inicio
 * Given user click en el brand (logo + texto).
 * When se dispara onclick.
 * Then conmuta al tab Inicio.
 */
function hubGoInicio() {
    const btn = document.querySelector(`.hub-shell-tabs .hub-shell-tab[data-tab="inicio"]`);
    hubShellSwitchTab("inicio", btn);
}
window.hubGoInicio = hubGoInicio;

/**
 * @interaction hub-go-perfil
 * @scope core (shell, compat 7.2)
 *
 * Given un click programático (ej. desde un onclick legacy o atajo).
 * When alguien invoca hubGoPerfil().
 * Then cierra dropdown y conmuta al tab Perfil del shell hub (que renderiza
 *   inline en hub-content). El item "Perfil" del dropdown fue eliminado en
 *   7.2: ahora el acceso canónico es el tab del shell.
 */
function hubGoPerfil() {
    _hubCloseAvatarMenu();
    const btn = document.querySelector(`.hub-shell-tabs .hub-shell-tab[data-tab="perfil"]`);
    hubShellSwitchTab("perfil", btn);
}
window.hubGoPerfil = hubGoPerfil;

/**
 * @interaction hub-load-perfil-inline
 * @scope core (dispatcher tab perfil)
 *
 * Given el tab Perfil activado.
 * When hubShellSwitchTab("perfil", ...) decide renderear.
 * Then fetchea views/shared/perfil.html, inyecta en hub-content, e invoca
 *   buildPerfilCompleto() para hidratar los datos del usuario. Usa cache local
 *   propio (no ViewLoader._cache, que asume sectionId fijo) — re-inyecta el
 *   HTML cada vez para garantizar que IDs como #perfil-name no quedan duplicados
 *   por otro re-render previo.
 * Edge si fetch falla (file:// o servidor caído), muestra empty-state.
 */
function _hubLoadPerfilInline(container) {
    fetch("views/shared/perfil.html")
        .then(r => {
            if (!r.ok) throw new Error(`fetch perfil.html ${r.status}`);
            return r.text();
        })
        .then(html => {
            container.innerHTML = html;
            // Fix 2026-06-05: populatePerfilHeader hidrata stats del header
            // (#perfil-name/-role/-pts/-niv/-level-badge/-med/-torn/-rank/
            // -qs-rango/-xp-label/-xp-fill) desde APP.user. Sin esto, el HTML
            // muestra los placeholders hardcoded (NIV. 15, 1,250 XP, etc.).
            if (typeof populatePerfilHeader === "function") populatePerfilHeader();
            if (typeof buildPerfilCompleto === "function") buildPerfilCompleto();
        })
        .catch(err => {
            console.error("[hub-shell] no se pudo cargar perfil.html", err);
            container.innerHTML = `<div class="hub-content__placeholder">No se pudo cargar Perfil. Recarga la página.</div>`;
        });
}

/**
 * @interaction hub-load-aprendizaje-inline
 * @scope core (dispatcher tabs mi-grupo / materias / calendario / competencias)
 *
 * Given uno de los 4 tabs legacy del hub-aprendizaje activado.
 * When hubShellSwitchTab decide renderear y el tabId pertenece al grupo legacy.
 * Then fetchea views/{rol}/aprendizaje.html según APP.user.tipo, inyecta el
 *   HTML en hub-content, ejecuta el init de rol y delega al dispatcher legacy
 *   (hubGrupoSwitchTab alumno / profHubGrupoSwitchTab profesor) con el tabId
 *   del shell para activar el panel correspondiente. El tab-bar interno legacy
 *   queda oculto vía CSS (hub-shell.css) porque duplica los tabs del shell.
 * Edge si fetch falla (file:// o servidor caído), muestra empty-state.
 */
function _hubLoadAprendizajeInline(container, tabId) {
    const u = APP?.user;
    if (!u) return;
    const path = u.tipo === "profesor"
        ? "views/profesor/aprendizaje.html"
        : "views/estudiante/aprendizaje.html";
    // Slice E 2026-06-01: cache:"no-store" + cache-buster para garantizar versión
    // fresca del HTML en dev y prevenir caché stale del browser (problema observado
    // tras colapsar dual-DOM gamer-off/gamer-on — browser servía HTML viejo).
    fetch(path + "?_=" + Date.now(), { cache: "no-store" })
        .then(r => {
            if (!r.ok) throw new Error(`fetch ${path} ${r.status}`);
            return r.text();
        })
        .then(html => {
            container.innerHTML = html;
            if (u.tipo === "profesor") {
                if (typeof profHubInit === "function") profHubInit();
                if (tabId !== "mi-grupo") {
                    const btn = document.querySelector(`#prof-hub-grupo-tabs-bar .hub-tab[data-tab="${tabId}"]`);
                    if (typeof profHubGrupoSwitchTab === "function") profHubGrupoSwitchTab(tabId, btn);
                }
            } else {
                if (typeof hubGrupoUpdateHeader === "function") hubGrupoUpdateHeader();
                if (typeof buildMaterias === "function") buildMaterias();
                if (typeof hubRebindMateriaCards === "function") hubRebindMateriaCards();
                const btn = document.querySelector(`#hub-grupo-tabs-bar .hub-tab[data-tab="${tabId}"]`);
                if (typeof hubGrupoSwitchTab === "function") hubGrupoSwitchTab(tabId, btn);
            }
        })
        .catch(err => {
            console.error("[hub-shell] no se pudo cargar aprendizaje.html", err);
            container.innerHTML = `<div class="hub-content__placeholder">No se pudo cargar el contenido. Recarga la página.</div>`;
        });
}

/**
 * @interaction hub-open-configuracion
 * @scope core (shell, slice pre-c10 7.5)
 *
 * Given user click en item "Configuración" del dropdown del avatar.
 * Then cierra el dropdown, sincroniza el estado de los toggles desde
 *   localStorage (vía buildConfiguracion) y abre el modal #modal-configuracion
 *   canónico con tabs internos (Apariencia / Notificaciones / Privacidad).
 * Edge si openModal/buildConfiguracion no están disponibles, cae a toast.
 */
function hubOpenConfiguracion() {
    _hubCloseAvatarMenu();
    if (typeof buildConfiguracion === "function") buildConfiguracion();
    if (typeof openModal === "function") {
        openModal("modal-configuracion");
    } else if (typeof showToast === "function") {
        showToast("Modal Configuración no disponible", "warning");
    }
}
window.hubOpenConfiguracion = hubOpenConfiguracion;

/**
 * @interaction hub-open-notificaciones
 * @scope core (panel real implementado en Slice notificaciones panel)
 *
 * Given user click en el bell del cluster (.hub-bell #hub-cluster-bell).
 * When el handler del botón lo invoca.
 * Then delega en `toggleNotifPanel()` del módulo `notificaciones.js` que
 *   abre/cierra el panel #notif-panel (.xn-panel) inyectando el render
 *   dinámico con `_renderPanel()`. El panel vive como sibling del bell
 *   dentro del `.hub-chrome__cluster` (movido en este mismo slice).
 * Edge:
 *   - `toggleNotifPanel` no cargado → log a console y no-op (defensa
 *     de orden de carga; notificaciones.js debería estar cargado).
 */
function hubOpenNotificaciones() {
    if (typeof toggleNotifPanel === "function") {
        toggleNotifPanel();
    } else {
        console.warn("[hub-shell] toggleNotifPanel no cargado");
    }
}
window.hubOpenNotificaciones = hubOpenNotificaciones;

/**
 * @interaction hub-toggle-gamer-mode
 * @scope core (shell)
 *
 * Given user toggle el switch gamer del cluster.
 * When change event del checkbox.
 * Then alterna body.gamer-off, persiste en localStorage, y sincroniza el
 *   checkbox state. Layout idéntico cross-mode (constraint A4); el cambio
 *   visual lo aplica CSS via body.gamer-off.
 */
function hubToggleGamerMode() {
    const toggle = document.getElementById("hub-gamer-toggle");
    const isOn = !!toggle?.checked;
    document.body.classList.toggle("gamer-off", !isOn);
    try { localStorage.setItem(HUB_LS_GAMER_KEY, isOn ? "on" : "off"); } catch (e) { /* ignore */ }
}
window.hubToggleGamerMode = hubToggleGamerMode;

/**
 * @interaction hub-toggle-avatar-menu
 * @scope core (shell)
 *
 * Given user click en el avatar trigger.
 * Then alterna visibilidad del dropdown. Si se abre, instala listeners de
 *   click-fuera + ESC para cerrarlo. Si se cierra, los desinstala.
 * Edge si el menu no existe en DOM, retorna sin error.
 */
function hubToggleAvatarMenu() {
    const menu = document.getElementById("hub-avatar-menu");
    if (!menu) return;
    const willOpen = menu.hasAttribute("hidden");
    if (willOpen) {
        menu.removeAttribute("hidden");
        // Listeners de cierre, instalados solo cuando el menu está abierto.
        setTimeout(() => {
            document.addEventListener("click", _hubAvatarMenuClickOutside, { once: true });
            document.addEventListener("keydown", _hubAvatarMenuEsc);
        }, 0);
    } else {
        _hubCloseAvatarMenu();
    }
}
window.hubToggleAvatarMenu = hubToggleAvatarMenu;

/**
 * @interaction hub-close-avatar-menu
 * @scope core-helper-internal (cluster shell)
 *
 * Given el dropdown del avatar puede estar abierto o cerrado.
 * When hubToggleAvatarMenu detecta que ya está abierto, o un evento
 *   externo (click fuera, ESC, navegación a Perfil/Configuración) decide
 *   cerrarlo.
 * Then setea atributo `hidden` en #hub-avatar-menu y desinstala el listener
 *   keydown de ESC. El listener de click-fuera es `{ once: true }` por lo
 *   que se auto-limpia tras dispararse.
 * Edge si #hub-avatar-menu no existe en DOM (e.g. rol admin sin cluster
 *   shell), el removeEventListener sigue sin lanzar error.
 */
function _hubCloseAvatarMenu() {
    const menu = document.getElementById("hub-avatar-menu");
    if (menu) menu.setAttribute("hidden", "");
    document.removeEventListener("keydown", _hubAvatarMenuEsc);
}

/**
 * @interaction hub-avatar-menu-click-outside
 * @scope core-helper-internal (cluster shell)
 *
 * Given el dropdown del avatar está abierto y document tiene un listener
 *   `click` con `{ once: true }` apuntando a esta función.
 * When user hace click en cualquier lugar del documento.
 * Then determina si el click cayó dentro del menu o del trigger:
 *   - Sí: re-instala el listener `{ once: true }` para el siguiente click
 *     fuera (preserva el menu abierto cuando user interactúa con sus
 *     items o el trigger).
 *   - No: invoca `_hubCloseAvatarMenu()` para cerrarlo.
 * Edge si el menu ya está cerrado (race con otro handler), retorna sin
 *   re-instalar listener — flag idempotente vía atributo `hidden`.
 */
function _hubAvatarMenuClickOutside(e) {
    const menu = document.getElementById("hub-avatar-menu");
    const trigger = document.getElementById("hub-avatar-trigger");
    if (!menu || menu.hasAttribute("hidden")) return;
    if (menu.contains(e.target) || trigger?.contains(e.target)) {
        // Re-instala el listener once para el próximo click fuera.
        document.addEventListener("click", _hubAvatarMenuClickOutside, { once: true });
        return;
    }
    _hubCloseAvatarMenu();
}

/**
 * @interaction hub-avatar-menu-esc
 * @scope core-helper-internal (cluster shell)
 *
 * Given el dropdown del avatar está abierto y document tiene un listener
 *   `keydown` apuntando a esta función (instalado por hubToggleAvatarMenu).
 * When user presiona una tecla.
 * Then si la tecla es "Escape", cierra el menu vía `_hubCloseAvatarMenu()`
 *   (que a su vez auto-desinstala este listener). Cualquier otra tecla
 *   es no-op.
 * Edge listener se desinstala automáticamente al cerrar (no hay leak); el
 *   guard de `e.key === "Escape"` evita interferir con otros keypress
 *   globales (e.g. atajos del browser).
 */
function _hubAvatarMenuEsc(e) {
    if (e.key === "Escape") _hubCloseAvatarMenu();
}

/**
 * @interaction repaint-hub-avatar
 * @scope core (cluster shell)
 *
 * Given un usuario alumno o profesor logueado y #hub-avatar-mini montado.
 * When hubInit o evento "avatarChanged" para el uid actual.
 * Then aplica fotoTexto + marcoCss usando getAvatarDisplay.
 * Edge si getAvatarDisplay no está disponible (orden de scripts), cae a iniciales.
 */
function _repaintHubAvatar() {
    const u = APP?.user;
    if (!u) return;
    const el = document.getElementById("hub-avatar-mini");
    if (!el) return;
    const disp = (typeof getAvatarDisplay === "function") ? getAvatarDisplay(u.id) : null;
    el.textContent = disp ? disp.fotoTexto : (u.iniciales ?? "");
    if (disp && disp.marcoCss) {
        const m = disp.marcoCss.match(/box-shadow:([^;]+)/);
        el.style.boxShadow = m ? m[1].trim() : "";
        const anim = disp.marcoCss.match(/animation:([^;]+)/);
        el.style.animation = anim ? anim[1].trim() : "";
    } else {
        el.style.boxShadow = "";
        el.style.animation = "";
    }
}
window._repaintHubAvatar = _repaintHubAvatar;

// Hook del evento avatarChanged: re-pintar cuando el usuario actual cambia avatar.
// Idempotente (mismo guard window-level que core/dashboard.js).
if (!window.__xahniHubAvatarListenerRegistered) {
    window.__xahniHubAvatarListenerRegistered = true;
    window.addEventListener("avatarChanged", (ev) => {
        if (ev?.detail?.uid && APP?.user?.id && ev.detail.uid === APP.user.id) {
            _repaintHubAvatar();
        }
    });
}
