// js/admin/sidebar-drawer.js
// R2 · 2026-06-07 · Admin sidebar mobile drawer
//
// En <768px el sidebar deja de ser icon-only y se vuelve drawer slide-in
// con backdrop. Botón hamburguesa en .topbar lo abre. Click backdrop,
// Escape o nav-item lo cierra. CSS vive en css/core/responsive.css.

/**
 * @interaction admin-sidebar-toggle
 * @scope admin-shell-navigation
 *
 * Given user click en el botón hamburguesa (.topbar-btn--menu).
 * When se invoca adminSidebarToggle().
 * Then:
 *   - Si el sidebar tiene .is-open → cerrar.
 *   - Si no → abrir.
 *   En ambos casos sincroniza aria-expanded del trigger.
 * Edge:
 *   - Sin sidebar en DOM → no-op silencioso.
 *   - Solo activo en mobile (<768px) por CSS.
 */
function adminSidebarToggle() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;
    if (sidebar.classList.contains("is-open")) {
        adminSidebarClose();
    } else {
        adminSidebarOpen();
    }
}
window.adminSidebarToggle = adminSidebarToggle;

/**
 * @interaction admin-sidebar-open
 * @scope admin-shell-navigation
 *
 * Given sidebar cerrado en mobile.
 * When se invoca adminSidebarOpen() (toggle o entry point externo).
 * Then:
 *   1. .sidebar.is-open → slide-in vía transform CSS.
 *   2. .sidebar-backdrop sin hidden + .is-visible (fade-in).
 *   3. aria-expanded="true" en trigger.
 *   4. body scroll lock para evitar scroll detrás del drawer.
 *   5. Focus al primer .nav-item del sidebar (a11y).
 */
function adminSidebarOpen() {
    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    const trigger = document.getElementById("sidebar-toggle");
    if (!sidebar) return;

    sidebar.classList.add("is-open");
    if (backdrop) {
        backdrop.removeAttribute("hidden");
        // forzar reflow para que la transition de opacity dispare
        // eslint-disable-next-line no-unused-expressions
        backdrop.offsetHeight;
        backdrop.classList.add("is-visible");
    }
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";

    // Focus al primer nav-item (regla focus-on-route-change)
    requestAnimationFrame(() => {
        sidebar.querySelector(".nav-item")?.focus();
    });
}
window.adminSidebarOpen = adminSidebarOpen;

/**
 * @interaction admin-sidebar-close
 * @scope admin-shell-navigation
 *
 * Given sidebar abierto en mobile.
 * When user click backdrop / Escape / nav-item / Cerrar manual.
 * Then:
 *   1. Quita .is-open → slide-out.
 *   2. Backdrop fade-out + hidden tras 200ms (espera la transition).
 *   3. aria-expanded="false".
 *   4. Restaura body scroll.
 *   5. Devuelve focus al trigger (a11y).
 */
function adminSidebarClose() {
    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    const trigger = document.getElementById("sidebar-toggle");
    if (!sidebar) return;

    sidebar.classList.remove("is-open");
    if (backdrop) {
        backdrop.classList.remove("is-visible");
        setTimeout(() => {
            if (!backdrop.classList.contains("is-visible")) {
                backdrop.setAttribute("hidden", "");
            }
        }, 220);
    }
    if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
        trigger.focus();
    }
    document.body.style.overflow = "";
}
window.adminSidebarClose = adminSidebarClose;

/* ── Listeners globales (registro idempotente) ─────────────────── */

if (!window.__adminSidebarDrawerWired) {
    window.__adminSidebarDrawerWired = true;

    // Escape cierra el drawer
    document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        const sidebar = document.getElementById("sidebar");
        if (sidebar && sidebar.classList.contains("is-open")) {
            adminSidebarClose();
        }
    });

    // Click en nav-item cierra el drawer (mobile) — usa capture para
    // ejecutarse antes del onclick="showView(...)" del nav-item.
    document.addEventListener("click", function (e) {
        const navItem = e.target.closest(".nav-item");
        if (!navItem) return;
        if (window.innerWidth >= 768) return;
        const sidebar = document.getElementById("sidebar");
        if (sidebar && sidebar.classList.contains("is-open")) {
            // dejar que showView se ejecute primero, después cerrar
            setTimeout(adminSidebarClose, 80);
        }
    });

    // Resize cross-breakpoint: si pasamos a desktop con drawer abierto,
    // cerrar para evitar estado inconsistente.
    window.addEventListener("resize", function () {
        if (window.innerWidth >= 768) {
            const sidebar = document.getElementById("sidebar");
            if (sidebar && sidebar.classList.contains("is-open")) {
                adminSidebarClose();
            }
        }
    });
}
