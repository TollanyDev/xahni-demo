// ═══════════════════════════════════════════════════════════
// NAVIGATION — Cambio de vistas y títulos del topbar
// ═══════════════════════════════════════════════════════════

const VIEW_TITLES = {
    dashboard:               "Dashboard",
    perfil:                  "Mi Perfil",
    configuracion:           "Configuración",
    aprendizaje:             "Mi Aprendizaje",
    materias:                "Mis Materias",
    grupos:                  "Grupos de Estudio",
    // C8b-C3: "competencias" eliminado (vive en hub-panel-competencias).
    // C8b-B3: "calificaciones-alumno" eliminado (vive en hub-panel-calificaciones).
    "tareas-alumno":         "Mis Tareas",
    "recursos-alumno":       "Recursos Didácticos",
    // 2026-05-24 cleanup: entradas profesor (gestion-academica, mis-materias-prof,
    // escala-evaluacion, recursos, tareas-prof) removidas. Trasplantadas al
    // hub-materia profesor en C9. Sin standalone navigation.
    "mis-materias":          "Mis Materias",
    calificaciones:          "Calificaciones",
    "admin-panel":           "Panel de Administración",
    "gestion-usuarios":      "Gestión de Usuarios",
    "modulos-admin":          "Control de Módulos",
    "gestion-reportes":      "Reportes Globales",
    "gestion-instituciones": "Gestión de Instituciones",
    "gestion-carreras":      "Gestión de Carreras",
    "gestion-materias":      "Gestión de Materias",
    "gestion-horarios":      "Gestión de Horarios",
    "gestion-clasificaciones": "Gestión de Clasificaciones",
    "gestion-grupos":        "Gestión de Grupos",
    // C8b-D3: "juegos" eliminado (vive en hub-materia tab juegos).
};

const VIEW_ROLES = {
    // C9: "aprendizaje" eliminado de VIEW_ROLES — accesible para estudiante
    //     y profesor (cada uno renderiza su shell vía ViewLoader.pathFor).
    // C8b-B3: "calificaciones-alumno" eliminado (vive en hub-panel-calificaciones).
    // C8b-C3: "competencias" eliminado (vive en hub-panel-competencias).
    // 2026-05-24 cleanup: entradas profesor removidas. Trasplantadas al
    // hub-materia profesor en C9.
    "admin-panel":           "administrador",
    "gestion-usuarios":      "administrador",
    "modulos-admin":         "administrador",
    "gestion-reportes":      "administrador",
    "gestion-instituciones": "administrador",
    "gestion-carreras":      "administrador",
    "gestion-materias":      "administrador",
    "gestion-horarios":      "administrador",
    "gestion-clasificaciones": "administrador",
    "gestion-grupos":        "administrador",
    // C8b-D3: "juegos" eliminado (vive en hub-materia tab juegos).
};

// CONSERVADO 2026-05-19 (C6.B): token de transición coordina cross-fade
// out → in entre vistas. Cada showView() incrementa el token; setTimeout
// y promesas async comparan al disparar — si el usuario navegó a otra
// vista mientras tanto, abortan sin tocar el DOM. _NAV_FADE_OUT_MS debe
// coincidir con la duración de @keyframes viewOut en dashboard.css.
let _navTransitionToken = 0;
const _NAV_FADE_OUT_MS = 160;

/**
 * @interaction show-view
 * @scope core-navigation-orchestrator
 *
 * Given un viewId (string id de vista) + btn opcional (HTMLElement del
 *   nav-item que disparó la navegación).
 * When user click en nav-item, click programático desde onclick inline,
 *   o redirect interno (e.g. estudiante invocando vista profesor stand
 *   alone redirige a "aprendizaje").
 * Then orquestación de 5 fases:
 *   1. Redirect estudiante: legacy views (materias/grupos/tareas-alumno/
 *      recursos-alumno) redirect a "aprendizaje" (consolidación shell C8b/C9).
 *   2. Role check: si VIEW_ROLES[viewId] != APP.user.tipo → return silente
 *      (deny).
 *   3. Highlight nav-item PRE-fade-out (C6.D Slice E pre-c10 6b.4): para
 *      mejorar perceived latency. Si btn pasado, usar; sino querySelector
 *      por data-view.
 *   4. Cross-fade (C6.B 2026-05-19): current view recibe .is-leaving;
 *      tras _NAV_FADE_OUT_MS (160ms) ejecuta _runLoad. prefers-reduced-motion
 *      salta la animación. Token de transición coordina aborto si user
 *      navega antes del timeout.
 *   5. _runLoad: si viewPath (ViewLoader.pathFor) → fetch + inject HTML,
 *      then _activate. Sino, _activate directo. _activate:
 *      - Token check (abort si stale).
 *      - Limpia .active y .is-leaving en todas las views.
 *      - Setea .active en sectionId.
 *      - Setea topbar-title con VIEW_TITLES[viewId] o "XAHNI".
 *      - Actualiza APP.currentView.
 *      - INIT_MAP[viewId]?.() → ejecuta init/build específico de la vista.
 * Edge:
 *   - viewId removido (legacy cleanup 2026-05-24) → pathFor retorna null,
 *     _activate corre con view sin update visible.
 *   - viewId sin INIT_MAP entry → optional chaining skip silente.
 *   - Vista dashboard: bifurca init por rol (estudiante: 5 builders;
 *     profesor: initProfesorDashboard; admin: limpia dash containers).
 *   - Token cross-fade: navegación rápida (user click 2 veces) aborta
 *     primera fade en el setTimeout check.
 *   - reduced-motion: setTimeout omitido; _runLoad inmediato.
 */
function showView(viewId, btn) {
    if (APP.user && APP.user.tipo === "estudiante" &&
        ["materias","grupos","tareas-alumno","recursos-alumno"].includes(viewId)) {
        viewId = "aprendizaje";
    }
    // 2026-05-24 cleanup: el redirect profesor standalone→aprendizaje removido
    // junto con las entradas legacy VIEW_TITLES/VIEW_ROLES/INIT_MAP y el
    // mapeo en view-loader.js. Si algún call site viejo invoca showView con
    // un viewId removido, el role check + ViewLoader.pathFor devolverán null
    // y showView retornará silenciosamente sin tocar el DOM.

    const requiredRole = VIEW_ROLES[viewId];
    if (requiredRole && APP.user?.tipo !== requiredRole) return;

    const sectionId = "view-" + viewId;
    const viewPath  = ViewLoader.pathFor(viewId);
    const token     = ++_navTransitionToken;

    // C6.D Slice E (slice pre-c10 6b.4 · 2026-05-26): highlight del nav-item
    // se mueve PRE-fade-out para mejorar perceived latency. Antes vivía en
    // `_activate` (post-160ms del fade-out) y el sidebar se sentía "lento"
    // porque el highlight cambiaba con la vista, no con el click.
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    if (btn) {
        btn.classList.add("active");
    } else {
        const found = document.querySelector(`.nav-item[data-view="${viewId}"]`);
        if (found) found.classList.add("active");
    }

    const _activate = () => {
        if (token !== _navTransitionToken) return;

        document.querySelectorAll(".view").forEach(v => {
            v.classList.remove("active");
            v.classList.remove("is-leaving");
        });
        const view = document.getElementById(sectionId);
        if (view) view.classList.add("active");

        document.getElementById("topbar-title").textContent = VIEW_TITLES[viewId] || "XAHNI";
        APP.currentView = viewId;

        const INIT_MAP = {
            "dashboard":         () => {
                const u = APP.user;
                const nome = document.getElementById("welcome-name");
                const sub  = document.getElementById("welcome-sub");
                if (nome) nome.textContent = u?.nombre?.split(" ")[0] ?? "";
                if (sub)  sub.textContent  = "Martes 17 de marzo · " + capitalize(u?.tipo ?? "") + " · Sprint 1 activo";
                if (u?.tipo === "estudiante")    initEstudianteDashboard?.(u);
                else if (u?.tipo === "profesor") initProfesorDashboard?.(u);
                else {
                    ["dash-est-content", "dash-prof-content", "dash-accesos"].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.style.display = "none";
                    });
                }
                if (u?.tipo === "estudiante") {
                    buildProgressBars?.();
                    buildActivityList?.();
                    buildChartBars?.();
                    buildRankingPreview?.();
                    buildDashTareasPreview?.();
                }
            },
            "aprendizaje":       () => {
                if (APP.user?.tipo === "profesor") {
                    profHubInit?.();
                } else {
                    hubGrupoUpdateHeader?.();
                    buildMaterias?.();
                    hubRebindMateriaCards?.();
                    hubGrupoRenderMiGrupo?.();
                }
            },
            "admin-panel":       () => buildAdminPanel?.(),
            "gestion-usuarios":  () => buildUsuarios?.(),
            "modulos-admin":     () => buildPerfilModulosAdmin?.(),
            "gestion-reportes":  () => buildReportesAdmin?.(),
            "gestion-instituciones": () => buildInstituciones?.(),
            "gestion-carreras":       () => buildCarreras?.(),
            "gestion-clasificaciones":() => buildClasificaciones?.(),
            "gestion-grupos":         () => buildGruposAdmin?.(),
            "gestion-materias":       () => buildMateriasAdmin?.(),
            "gestion-horarios":      () => buildHorariosView?.(),
            // 2026-05-24 cleanup: entradas profesor standalone removidas
            // (gestion-academica, mis-materias-prof, escala-evaluacion,
            // tareas-prof, recursos). Los builders siguen existiendo y son
            // invocados desde los dispatchers del hub-materia profesor.
            // C8b-D3: "juegos" eliminado (entrypoint vive en hub-materia tab).
            "perfil":            () => { populatePerfilHeader?.(); buildPerfilCompleto?.(); },
            "configuracion":     () => buildConfiguracion?.(),
            // C8b-B3: "calificaciones-alumno" eliminado (entrypoint vive en hub-materia tab).
            // C8b-C3: "competencias" eliminado (entrypoint vive en hub-grupo tab).
            "grupos":            () => buildGrupos?.(),
        };
        INIT_MAP[viewId]?.();
    };

    const _runLoad = () => {
        if (viewPath) {
            ViewLoader.load(viewPath, sectionId).then(_activate);
        } else {
            _activate();
        }
    };

    // Fase de fade-out (cross-fade sequential out → in)
    const current = document.querySelector(".view.active");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (current && current.id !== sectionId && !reduced) {
        current.classList.add("is-leaving");
        current.classList.remove("active");
        setTimeout(() => {
            if (token === _navTransitionToken) _runLoad();
        }, _NAV_FADE_OUT_MS);
    } else {
        _runLoad();
    }
}
