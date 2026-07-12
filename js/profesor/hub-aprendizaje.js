// ═══════════════════════════════════════════════════════════
// HUB-APRENDIZAJE PROFESOR (C9)
// Vista raíz post-C9: grupo activo del profesor con .x-group-selector
// + 4 tabs (Mi grupo / Materias / Calendario / Competencias).
// Espejo estructural de js/estudiante/hub-aprendizaje.js (post-C8b).
// ═══════════════════════════════════════════════════════════

// Estado de sesión.
// `profGrupoActivo` se persiste a localStorage (slice pre-c10 6a 2026-05-26)
// con la misma estrategia que `profParcialActivo`. Restauración silenciosa al
// arrancar; si el grupo persistido ya no existe, la validación en `profHubInit`
// cae al primer grupo disponible.
APP.profGrupoActivo = APP.profGrupoActivo || (function () {
    try {
        return localStorage.getItem("xahni.profGrupoActivo") || null;
    } catch (e) { return null; }
})();
APP.profHubMatActivo = APP.profHubMatActivo || null;

// ── Entry point: navegación llama aquí cuando profesor abre 'aprendizaje' ──
/**
 * @interaction prof-hub-init
 * @scope profesor-hub-aprendizaje-entrypoint
 *
 * Given el profesor logueado entrando a la vista 'aprendizaje' (desde tab
 *   "Materias" del hub-shell que mapea internamente a hub-aprendizaje).
 * When navigation/hub-shell invoca `profHubInit()`.
 * Then orquesta el bootstrap del módulo:
 *   1. Guard tipo === "profesor" → no-op si admin/estudiante.
 *   2. Reset overlay hub-materia (display:none) y mostrar panel lista (display:block).
 *   3. `APP.profHubMatActivo = null` (cierra cualquier materia abierta).
 *   4. Resuelve grupos del profesor (`getGruposDelProfesor`).
 *   5. Sin grupos → `_profHubRenderEmpty` (empty state global) y termina.
 *   6. Si `APP.profGrupoActivo` no está o ya no existe → cae al primer grupo.
 *   7. Render selector + click programático en tab "Mi grupo".
 * Edge:
 *   - APP.user no profesor → no-op silencioso (otra vista llamó por error).
 *   - `getGruposDelProfesor` ausente parse-time → grupos=[] → empty state.
 *   - **Persistencia localStorage en `APP.profGrupoActivo`**: el IIFE inicial
 *     del archivo restaura el valor; este init valida que el grupo persistido
 *     siga existiendo (recovery silencioso si admin lo eliminó).
 *   - Exportado en window (entrypoint de navigation).
 *   - Deuda post-Supabase: cambio reactivo si admin elimina el grupo activo
 *     (subscription).
 */
function profHubInit() {
    if (!APP.user || APP.user.tipo !== "profesor") return;

    // Reset overlay (por si quedó abierto de sesión previa)
    const det = document.getElementById("prof-hub-detalle-panel");
    const lst = document.getElementById("prof-hub-lista-panel");
    if (det) det.style.display = "none";
    if (lst) lst.style.display = "block";
    APP.profHubMatActivo = null;

    // Inicializar grupo activo si no está
    const grupos = (typeof getGruposDelProfesor === "function")
        ? getGruposDelProfesor(APP.user.id)
        : [];

    if (grupos.length === 0) {
        _profHubRenderEmpty();
        return;
    }

    if (!APP.profGrupoActivo || !grupos.find(g => g.id === APP.profGrupoActivo)) {
        APP.profGrupoActivo = grupos[0].id;
    }

    profHubGrupoRenderSelector();

    // Marcar tab Mi grupo activo y renderizar
    const tabBtn = document.querySelector("#prof-hub-grupo-tabs-bar .hub-tab[data-tab='mi-grupo']");
    profHubGrupoSwitchTab("mi-grupo", tabBtn);
}
window.profHubInit = profHubInit;

/**
 * @interaction prof-hub-grupo-render-selector
 * @scope profesor (cabecera hub-aprendizaje)
 *
 * Given un profesor logueado con N grupos asignados.
 * When profHubInit lo invoca durante el init de la vista.
 * Then renderea el título de #prof-hub-grupo-titulo con el código del grupo
 *   activo y, si N≥2, lo envuelve en un button custom dropdown (menú flotante
 *   con la lista de grupos). Setea el subtítulo dinámico con carrera +
 *   cuatrimestre vía getGrupoCarreraLabel. Al cambiar de grupo: persiste en
 *   localStorage y dispara re-render del tab activo.
 * Edge si N=0 grupos, el título queda con el placeholder por defecto.
 */
function profHubGrupoRenderSelector() {
    const tituloEl = document.getElementById("prof-hub-grupo-titulo");
    const subEl = document.getElementById("prof-hub-grupo-subtitulo");
    if (!tituloEl) return;

    const grupos = (typeof getGruposDelProfesor === "function")
        ? getGruposDelProfesor(APP.user.id)
        : [];
    if (grupos.length === 0) return;

    const activeId = APP.profGrupoActivo || grupos[0].id;

    // Resuelve nombre amigable (DEMO_GRUPOS.nombre) en lugar del id literal
    const _gruposAll = (typeof DEMO_GRUPOS !== "undefined" && Array.isArray(DEMO_GRUPOS)) ? DEMO_GRUPOS : [];
    const _displayOf = (id) => {
        const g = _gruposAll.find(x => x.id === id);
        return (g && g.nombre) ? g.nombre : id;
    };
    const activeDisplay = _displayOf(activeId);

    if (grupos.length === 1) {
        tituloEl.textContent = activeDisplay;
        tituloEl.setAttribute("title", activeId);
    } else {
        tituloEl.innerHTML = `
            <button type="button"
                    class="x-page-head__title-dropdown"
                    id="prof-hub-grupo-dropdown-btn"
                    aria-haspopup="listbox"
                    aria-expanded="false"
                    onclick="profHubGrupoToggleDropdown()">
                <span class="x-page-head__title-dropdown-label" title="${_profEsc(activeId)}">${_profEsc(activeDisplay)}</span>
                <span class="x-page-head__title-dropdown-caret" aria-hidden="true"><svg class="x-icon"><use href="#x-icon-chevron-down"></use></svg></span>
            </button>
            <div class="x-page-head__title-dropdown-menu"
                 id="prof-hub-grupo-dropdown-menu"
                 role="listbox"
                 aria-label="Cambiar grupo activo"
                 hidden>
                ${grupos.map(g => `
                    <button type="button"
                            class="x-page-head__title-dropdown-item${g.id === activeId ? " is-active" : ""}"
                            role="option"
                            aria-selected="${g.id === activeId ? "true" : "false"}"
                            title="${_profEsc(g.id)}"
                            onclick="profHubGrupoSelect('${_profEsc(g.id)}')">
                        ${_profEsc(_displayOf(g.id))}
                    </button>
                `).join("")}
            </div>
        `;
    }

    if (subEl) {
        const label = (typeof getGrupoCarreraLabel === "function") ? getGrupoCarreraLabel(activeId) : "";
        const baseLabel = label || "Tu contexto de trabajo este periodo";
        if (grupos.length >= 2) {
            // Epic A.3: microcopy permanente para señalar el dropdown multi-grupo
            // del título. Se inyecta como span discreto separado por · del label
            // base (carrera·cuatrimestre). Aria-hidden porque la información ya
            // se anuncia via aria-haspopup del button del título.
            subEl.innerHTML = `${_profEsc(baseLabel)} <span class="x-page-head__hint" aria-hidden="true">· Cambia entre tus ${grupos.length} grupos desde el título</span>`;
        } else {
            subEl.textContent = baseLabel;
        }
    }
}
window.profHubGrupoRenderSelector = profHubGrupoRenderSelector;

/**
 * @interaction prof-hub-grupo-toggle-dropdown
 * @scope profesor
 *
 * Given dropdown menú de grupos montado.
 * When user click en el button del título o ESC.
 * Then alterna visibilidad del menú. Si abre, instala listeners de click-fuera
 *   y ESC para cerrar.
 */
function profHubGrupoToggleDropdown() {
    const menu = document.getElementById("prof-hub-grupo-dropdown-menu");
    const btn = document.getElementById("prof-hub-grupo-dropdown-btn");
    if (!menu || !btn) return;
    const willOpen = menu.hasAttribute("hidden");
    if (willOpen) {
        menu.removeAttribute("hidden");
        btn.setAttribute("aria-expanded", "true");
        setTimeout(() => {
            document.addEventListener("click", _profHubGrupoDropdownClickOutside, { once: true });
            document.addEventListener("keydown", _profHubGrupoDropdownEsc);
        }, 0);
    } else {
        _profHubGrupoDropdownClose();
    }
}
window.profHubGrupoToggleDropdown = profHubGrupoToggleDropdown;

/**
 * @interaction prof-hub-grupo-dropdown-close
 * @scope profesor-hub-aprendizaje-dropdown
 *
 * Given el menú dropdown de grupos abierto.
 * When `profHubGrupoSelect` ejecuta (selección), `profHubGrupoToggleDropdown`
 *   recibe click cuando ya está abierto, o `_profHubGrupoDropdownClickOutside` /
 *   `_profHubGrupoDropdownEsc` detecta cierre por usuario.
 * Then:
 *   1. menu.setAttribute("hidden", "") — esconde el menú.
 *   2. btn aria-expanded="false" — a11y consistente.
 *   3. Remueve listener keydown (cleanup).
 * Edge:
 *   - DOM elementos ausentes → no-op selectivo (no crash).
 *   - **Listener click-outside NO se cleanup explícito aquí** porque está
 *     registrado con `{ once: true }` — auto-removed tras dispararse.
 *   - Helper LOCAL (sin window export). Único call site: las 3 vías de
 *     cierre + toggle.
 */
function _profHubGrupoDropdownClose() {
    const menu = document.getElementById("prof-hub-grupo-dropdown-menu");
    const btn = document.getElementById("prof-hub-grupo-dropdown-btn");
    if (menu) menu.setAttribute("hidden", "");
    if (btn) btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", _profHubGrupoDropdownEsc);
}

/**
 * @interaction prof-hub-grupo-dropdown-click-outside
 * @scope profesor-hub-aprendizaje-dropdown-listener
 *
 * Given el dropdown abierto + listener `{once: true}` instalado por
 *   `profHubGrupoToggleDropdown` con setTimeout 0.
 * When ocurre cualquier click en el document.
 * Then resolución cascada:
 *   1. Menu ausente o ya hidden → no-op (dropdown ya cerrado por otra vía).
 *   2. Click dentro del menu o btn → re-instala el listener `{once: true}`
 *      (porque el listener se auto-removed al disparar, pero el usuario
 *      clickeó "dentro" así que no queremos cerrar). Para no perder el
 *      tracking.
 *   3. Click fuera → `_profHubGrupoDropdownClose`.
 * Edge:
 *   - **Patrón `{once: true}` + re-install manual**: alternativa al
 *     listener persistente porque XAHNI no tiene framework de manejo
 *     de listeners. Cementado en slice del shell.
 *   - `btn?.contains` chain — defensa si btn falta (recarga durante interacción).
 *   - setTimeout 0 en `toggleDropdown` evita que el click que abre el menú
 *     también dispare este listener (microtask boundary).
 *   - Helper LOCAL.
 */
function _profHubGrupoDropdownClickOutside(e) {
    const menu = document.getElementById("prof-hub-grupo-dropdown-menu");
    const btn = document.getElementById("prof-hub-grupo-dropdown-btn");
    if (!menu || menu.hasAttribute("hidden")) return;
    if (menu.contains(e.target) || btn?.contains(e.target)) {
        document.addEventListener("click", _profHubGrupoDropdownClickOutside, { once: true });
        return;
    }
    _profHubGrupoDropdownClose();
}

/**
 * @interaction prof-hub-grupo-dropdown-esc
 * @scope profesor-hub-aprendizaje-dropdown-listener
 *
 * Given el dropdown abierto + listener keydown instalado.
 * When usuario presiona cualquier tecla.
 * Then si key === "Escape" → `_profHubGrupoDropdownClose`. Otras teclas
 *   ignoradas (no-op).
 * Edge:
 *   - Listener removido por el `_profHubGrupoDropdownClose` mismo.
 *   - Persistente (no `{once: true}`) — necesario porque ESC puede dispararse
 *     múltiples veces antes de cerrar (e.g., en modal dentro del dropdown).
 *   - Helper LOCAL.
 *   - **A11y mandatorio**: dropdowns con `aria-haspopup` deben tolerar ESC
 *     según WCAG 2.1.
 */
function _profHubGrupoDropdownEsc(e) {
    if (e.key === "Escape") _profHubGrupoDropdownClose();
}

/**
 * @interaction prof-hub-grupo-select
 * @scope profesor
 *
 * Given grupoId desde click en un item del dropdown.
 * When user selecciona un grupo.
 * Then cierra menú, actualiza APP.profGrupoActivo + localStorage, re-renderea
 *   el header (selector + subtítulo) y el tab activo con datos del nuevo grupo.
 */
function profHubGrupoSelect(grupoId) {
    _profHubGrupoDropdownClose();
    if (!grupoId || grupoId === APP.profGrupoActivo) return;
    APP.profGrupoActivo = grupoId;
    try { localStorage.setItem("xahni.profGrupoActivo", grupoId); } catch (e) { /* no-op */ }
    profHubGrupoRenderSelector();
    const activeBtn = document.querySelector("#prof-hub-grupo-tabs-bar .hub-tab.active");
    const activeTab = activeBtn ? activeBtn.dataset.tab : "mi-grupo";
    profHubGrupoSwitchTab(activeTab, activeBtn);
}
window.profHubGrupoSelect = profHubGrupoSelect;

// ── Switch tab hub-grupo: visual + dispara render del módulo ──
/**
 * @interaction prof-hub-grupo-switch-tab
 * @scope profesor-hub-aprendizaje-tabs
 *
 * Given tabId destino (`mi-grupo` | `materias` | `calendario` | `competencias`)
 *   + btn elemento clickeado opcional.
 * When click en una hub-tab del `#prof-hub-grupo-tabs-bar`, o llamada
 *   programática desde `profHubGrupoSelect` para re-render tras switch de grupo.
 * Then:
 *   1. Limpia `.active` de todos los hub-tab + marca el btn pasado.
 *   2. Show/hide los 4 paneles según tabId.
 *   3. Dispara render del módulo correspondiente:
 *      - mi-grupo → `hubGrupoProfRenderMiGrupo(panelId, grupoActivo)`.
 *      - materias → `_profHubRenderTabMaterias()`.
 *      - calendario → `hubCalendarioProfRender(panelId, uid, grupoActivo)`.
 *      - competencias → placeholder estático (no render).
 * Edge:
 *   - btn falsy (llamada programática sin button) → ningún tab marca activo
 *     visualmente. Caller debe pasar btn o usar selector.
 *   - Módulo target ausente (typeof check) → no render pero panel sí cambia.
 *   - Exportado en window.
 *   - **Asimetría con `profHubMatSwitchTab`** (interno de hub-materia):
 *     este opera al nivel hub-grupo (lista materias), el otro al nivel
 *     hub-materia (1 materia abierta con tabs internos).
 */
function profHubGrupoSwitchTab(tabId, btn) {
    document.querySelectorAll("#prof-hub-grupo-tabs-bar .hub-tab")
        .forEach(b => b.classList.remove("active"));
    if (btn) btn.classList.add("active");

    const panels = ["mi-grupo", "materias", "calendario", "competencias"];
    panels.forEach(p => {
        const el = document.getElementById("prof-hub-grupo-tab-" + p);
        if (el) el.style.display = (p === tabId) ? "" : "none";
    });

    if (tabId === "mi-grupo" && typeof window.hubGrupoProfRenderMiGrupo === "function") {
        hubGrupoProfRenderMiGrupo("prof-hub-grupo-tab-mi-grupo", APP.profGrupoActivo);
    } else if (tabId === "materias") {
        _profHubRenderTabMaterias();
    } else if (tabId === "calendario" && typeof window.hubCalendarioProfRender === "function") {
        hubCalendarioProfRender("prof-hub-grupo-tab-calendario", APP.user.id, APP.profGrupoActivo);
    } else if (tabId === "competencias" && typeof window.profHubRenderCompetencias === "function") {
        // Sprint 2026-06-08 día 4: reemplaza placeholder estático con vista
        // funcional (lista comps + ranking vivo + declarar ganador).
        window.profHubRenderCompetencias();
    }
}
window.profHubGrupoSwitchTab = profHubGrupoSwitchTab;

// ── Tab "Materias": cards de las materias del profesor en el grupo activo ──
// Trasplante fiel del shell view-mis-materias-prof: reusa _buildMatCardProf
// (markup .x-materia-card canónico, gamificado). Cruza raw filtered por
// grupo con enriquecida (bgGrad, emblema, prestigio, XP, horario, periodo)
// para mantener paridad visual con la vista standalone.
/**
 * @interaction prof-hub-render-tab-materias
 * @scope profesor-hub-aprendizaje-tab-materias
 *
 * Given `#prof-hub-grupo-tab-materias` presente + `APP.profGrupoActivo`.
 * When `profHubGrupoSwitchTab("materias", ...)` lo invoca.
 * Then resolución cascada:
 *   1. Panel ausente → no-op.
 *   2. `getMateriasProfGrupo(uid, grupoId)` → materias filtradas raw.
 *   3. Si vacío → empty state "Sin materias en este grupo".
 *   4. Obtiene `getProfMateriasData(uid).materias` (enriquecidas con bgGrad/
 *      emblema/prestigio/XP/horario/periodo).
 *   5. Filtra enriched por ids del raw (intersección).
 *   6. Si enriched vacío o `_buildMatCardProf` ausente → fallback simple
 *      con x-card text-only y onclick a `profHubAbrirMateria`.
 *   7. Render grid de `.x-materia-card` enriquecidas (canonical).
 * Edge:
 *   - **Doble lookup defensivo**: raw filtered por grupo + enriched filtered
 *     por intersección. Razón: `getProfMateriasData` no acepta filtro de
 *     grupo, devuelve TODAS las materias del profesor. La intersección por
 *     ids da el subset correcto.
 *   - Helpers ausentes → fallback cards minimalistas con onclick directo.
 *   - Helper LOCAL.
 *   - Trasplante fiel desde shell `view-mis-materias-prof` (eliminado en
 *     cleanup 6b.1 2026-05-24).
 */
function _profHubRenderTabMaterias() {
    const panel = document.getElementById("prof-hub-grupo-tab-materias");
    if (!panel) return;

    const rawFiltered = (typeof getMateriasProfGrupo === "function")
        ? getMateriasProfGrupo(APP.user.id, APP.profGrupoActivo)
        : [];

    if (rawFiltered.length === 0) {
        panel.innerHTML = `
            <div class="x-empty">
                <div class="x-empty__title">Sin materias en este grupo</div>
                <div class="x-empty__text">No impartes materias en el grupo activo.</div>
            </div>`;
        return;
    }

    const allEnriched = (typeof getProfMateriasData === "function")
        ? (getProfMateriasData(APP.user.id).materias || [])
        : [];
    const filteredIds = new Set(rawFiltered.map(m => m.id));
    const enrichedFiltered = allEnriched.filter(em => filteredIds.has(em.id));

    if (enrichedFiltered.length === 0 || typeof _buildMatCardProf !== "function") {
        // Fallback simple si getProfMateriasData falla
        panel.innerHTML = `<div class="x-grid x-grid--wide">${
            rawFiltered.map(m =>
                `<button class="x-card" onclick="profHubAbrirMateria('${m.id}')" type="button">${_profEsc(m.nombre)}</button>`
            ).join("")
        }</div>`;
        return;
    }

    panel.innerHTML = `<div class="x-grid x-grid--wide">${
        enrichedFiltered.map(em => _buildMatCardProf(em)).join("")
    }</div>`;
    // .x-materia-card usa onclick inline (profHubAbrirMateria) — sin wire
    // adicional necesario.
}

// ── Empty global: profesor sin grupos asignados ──
/**
 * @interaction prof-hub-render-empty
 * @scope profesor-hub-aprendizaje-empty-state
 *
 * Given `#prof-hub-lista-panel` presente y profesor sin grupos asignados
 *   (`getGruposDelProfesor(uid).length === 0`).
 * When `profHubInit` detecta el caso.
 * Then injecta `.x-empty` con título "Aún no tienes grupos asignados" + texto
 *   "Contacta al administrador para que te asigne materias a grupos."
 * Edge:
 *   - DOM target ausente → no-op.
 *   - Empty state GLOBAL del módulo (no por tab) — cuando no hay grupos,
 *     el switch de tabs queda oculto por defecto del HTML.
 *   - Helper LOCAL.
 *   - **Profesor recién creado** (caso común post-admin onboarding) lo
 *     verá hasta que admin le asigne ≥ 1 materia con grupo.
 */
function _profHubRenderEmpty() {
    const root = document.getElementById("prof-hub-lista-panel");
    if (!root) return;
    root.innerHTML = `
        <div class="x-empty">
            <div class="x-empty__title">Aún no tienes grupos asignados</div>
            <div class="x-empty__text">Contacta al administrador para que te asigne materias a grupos.</div>
        </div>`;
}

// ═══════════════════════════════════════════════════════════
// HUB-MATERIA PROFESOR (overlay sobre hub-grupo)
// ═══════════════════════════════════════════════════════════

/**
 * @interaction prof-hub-abrir-materia
 * @scope profesor-hub-materia-overlay
 *
 * Given matId desde click en una `.x-materia-card` del tab Materias.
 * When `_buildMatCardProf` onclick dispara con el matId.
 * Then bootstrap del overlay hub-materia:
 *   1. Guard matId falsy → no-op.
 *   2. Lookup mat en DEMO_MATERIAS → no-op si no existe.
 *   3. Setea `APP.profHubMatActivo = { matId, grupoId: APP.profGrupoActivo, tab: "calificaciones" }`.
 *   4. Update breadcrumb (nombre materia + crumb grupo).
 *   5. Color stripe placeholder (cyan brand — pendiente derivar de clasificacionId).
 *   6. Hide panel lista, show panel detalle.
 *   7. Renderea tabs Pn (`profMatRenderParcialTabs`) si periodoInfo válido.
 *   8. Click programático en tab "calificaciones" (default).
 * Edge:
 *   - matId no en DEMO_MATERIAS → no-op silencioso (drift seed).
 *   - **`prof-hub-det-grupo` deprecation silenciosa**: el id legacy se deja
 *     vacío en vez de eliminarse, breadcrumb explícito `prof-hub-det-grupo-crumb`
 *     lo reemplaza (slice pre-c10 6a 2026-05-26).
 *   - `getPeriodoInfo`/`getPeriodoDeGrupo` ausentes → tabs Pn no se renderean.
 *   - Exportado en window.
 *   - Asimetría visual con `abrirDetalleMateriaProf` (eliminado en cleanup 6b.1)
 *     — este NO es overlay-on-top sino swap de panel.
 */
function profHubAbrirMateria(matId) {
    if (!matId) return;
    const mat = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
        .find(m => m.id === matId);
    if (!mat) return;

    APP.profHubMatActivo = {
        matId,
        grupoId: APP.profGrupoActivo,
        tab: "calificaciones"
    };

    const nomEl = document.getElementById("prof-hub-det-nombre");
    const grCrumbEl = document.getElementById("prof-hub-det-grupo-crumb");
    const grEl = document.getElementById("prof-hub-det-grupo");
    const colorEl = document.getElementById("prof-hub-det-color");
    if (nomEl) nomEl.textContent = mat.nombre || mat.id;
    // Breadcrumb explícito {grupo} › {materia} (slice pre-c10 6a 2026-05-26).
    // Resolver nombre legible del grupo si DEMO_GRUPOS lo tiene; fallback al id
    // para no romper cuando el grupo aún no hidrató.
    if (grCrumbEl) {
        const _grupos = (typeof DEMO_GRUPOS !== "undefined" && Array.isArray(DEMO_GRUPOS)) ? DEMO_GRUPOS : [];
        const _g = _grupos.find(g => g.id === APP.profGrupoActivo);
        grCrumbEl.textContent = (_g && _g.nombre) ? _g.nombre : APP.profGrupoActivo;
        grCrumbEl.setAttribute("title", APP.profGrupoActivo);
    }
    // prof-hub-det-grupo es deprecación silenciosa, se deja vacío.
    if (grEl) grEl.textContent = "";
    if (colorEl) {
        // Color derivado del clasificacionId si existe alguna paleta;
        // fallback a brand cyan
        colorEl.style.background = "var(--xahni-cyan)";
    }

    document.getElementById("prof-hub-lista-panel").style.display = "none";
    document.getElementById("prof-hub-detalle-panel").style.display = "block";

    // Elevar tabs P1/.../Final al header (Pieza D, Task 9)
    const gmKey = (typeof profMatGrupoKey === "function") ? profMatGrupoKey(matId, APP.profGrupoActivo) : `${matId}_${APP.profGrupoActivo}`;
    const gid = APP.profGrupoActivo || (mat.grupos || [])[0];
    const periodoInfo = (typeof getPeriodoInfo === "function" && typeof getPeriodoDeGrupo === "function")
        ? getPeriodoInfo(getPeriodoDeGrupo(gid))
        : null;
    if (periodoInfo) profMatRenderParcialTabs(gmKey, periodoInfo);

    const tabBtn = document.querySelector("#prof-hub-detalle-panel .hub-tab[data-tab='calificaciones']");
    profHubMatSwitchTab("calificaciones", tabBtn);
}
window.profHubAbrirMateria = profHubAbrirMateria;

/**
 * @interaction prof-hub-cerrar-detalle
 * @scope profesor-hub-materia-overlay
 *
 * Given el overlay hub-materia abierto (panel detalle visible).
 * When click en botón "← Volver" del header del detalle.
 * Then:
 *   1. `APP.profHubMatActivo = null` (cierra estado).
 *   2. Hide panel detalle.
 *   3. Show panel lista.
 * Edge:
 *   - Llamada con APP.profHubMatActivo ya null → operación safe (no-op
 *     respecto a estado, pero swap visual ejecuta).
 *   - DOM targets ausentes → no-op selectivo.
 *   - **NO limpia parcial activo** (`APP.profParcialActivo[gmKey]`) —
 *     persiste a localStorage, deliberado: al reabrir la materia se
 *     restaura el parcial donde estaba.
 *   - Exportado en window (botón header).
 */
function profHubCerrarDetalle() {
    APP.profHubMatActivo = null;
    const det = document.getElementById("prof-hub-detalle-panel");
    const lst = document.getElementById("prof-hub-lista-panel");
    if (det) det.style.display = "none";
    if (lst) lst.style.display = "block";
}
window.profHubCerrarDetalle = profHubCerrarDetalle;

/**
 * @interaction prof-hub-mat-switch-tab
 * @scope profesor-hub-materia-tabs
 *
 * Given tabId destino entre los 8 internos del hub-materia
 *   (calificaciones / gestion / asistencia / tareas / examenes / recursos /
 *   juegos / maestria) + btn opcional.
 * When click en una `.hub-tab` del header del detalle, o llamada
 *   programática desde `profHubAbrirMateria` (default "calificaciones").
 * Then:
 *   1. Guard `APP.profHubMatActivo` falsy → no-op (overlay cerrado).
 *   2. Update `APP.profHubMatActivo.tab` (estado consistente cross-event).
 *   3. Visual marca `.active` sobre btn (deselect siblings).
 *   4. Show/hide los 8 paneles.
 *   5. Dispatcher `_profMatDispatchTabRender(tabId, matId, grupoId, panelId)`
 *      — gating de parcial futuro vive ahí.
 *   6. Re-render tabs de parcial (`profMatRenderParcialTabs`) post-switch
 *      (Pieza D fix: el render del tab interno puede afectar DOM circundante;
 *      re-renderear el header de parciales asegura active visual correcto).
 * Edge:
 *   - tabId no en enum → todos los paneles hide, ningún render dispatch.
 *   - btn null (llamada programática) → ningún tab marca activo
 *     visualmente (caller responsable).
 *   - **Pieza D 2026-05-23 gating**: gestion/asistencia/tareas/recursos
 *     muestran placeholder "Parcial futuro" en vez del contenido si el
 *     parcial activo no inició. Calificaciones siempre renderea.
 *   - getPeriodoInfo ausente → tabs Pn no re-renderean (el activo previo
 *     queda visible).
 *   - Exportado en window.
 */
function profHubMatSwitchTab(tabId, btn) {
    if (!APP.profHubMatActivo) return;
    APP.profHubMatActivo.tab = tabId;

    if (btn) {
        btn.parentElement.querySelectorAll(".hub-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
    }

    const tabs = ["calificaciones", "gestion", "asistencia", "tareas", "examenes", "recursos", "juegos", "temario", "maestria"];
    tabs.forEach(t => {
        const el = document.getElementById("prof-hub-mat-panel-" + t);
        if (el) el.style.display = (t === tabId) ? "" : "none";
    });

    const { matId, grupoId } = APP.profHubMatActivo;
    const panelId = "prof-hub-mat-panel-" + tabId;

    // Pieza D 2026-05-23: gating de tabs según estado del parcial activo.
    // Gestión / Tareas / Recursos muestran placeholder cuando el parcial
    // está en "futuro" (no iniciado). Calificaciones siempre renderea
    // (profesor configura la escala con anticipación). Juegos placeholder.
    _profMatDispatchTabRender(tabId, matId, grupoId, panelId);

    // Pieza D fix 2026-05-23: refrescar tabs de parcial en cada switch para
    // evitar que el active visual se pierda si el render del tab interno
    // afecta el DOM circundante. Lee siempre desde APP.profParcialActivo.
    const gmKey = (typeof profMatGrupoKey === "function") ? profMatGrupoKey(matId, grupoId) : `${matId}_${grupoId}`;
    const matObj = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : []).find(m => m.id === matId);
    const gid = grupoId || (matObj?.grupos || [])[0];
    const periodoInfo = (typeof getPeriodoInfo === "function" && typeof getPeriodoDeGrupo === "function")
        ? getPeriodoInfo(getPeriodoDeGrupo(gid))
        : null;
    if (periodoInfo) profMatRenderParcialTabs(gmKey, periodoInfo);
}
window.profHubMatSwitchTab = profHubMatSwitchTab;

/**
 * @interaction is-parcial-futuro
 * @scope profesor-materia
 *
 * Given: matId + grupoId del hub-materia actual
 * When:  se invoca para decidir si renderear placeholder vs contenido real
 * Then:  retorna true si APP.profParcialActivo[gmKey] apunta a un parcial
 *        con estado === "futuro" según getPeriodoInfo
 * Edge:
 *   - sin parcial activo / sin periodoInfo → false (renderea normal)
 *   - parcial cerrado → false (renderea normal, datos pasados read-only)
 */
function _profIsParcialFuturo(matId, grupoId) {
    const gmKey = (typeof profMatGrupoKey === "function") ? profMatGrupoKey(matId, grupoId) : `${matId}_${grupoId}`;
    const parcialNum = APP.profParcialActivo?.[gmKey];
    if (!parcialNum) return false;
    const matObj = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : []).find(m => m.id === matId);
    const gid = grupoId || (matObj?.grupos || [])[0];
    const periodoInfo = (typeof getPeriodoInfo === "function" && typeof getPeriodoDeGrupo === "function")
        ? getPeriodoInfo(getPeriodoDeGrupo(gid))
        : null;
    if (!periodoInfo) return false;
    const p = (periodoInfo.parciales || []).find(x => x.num === parcialNum);
    return p?.estado === "futuro";
}

/**
 * @interaction render-parcial-futuro-placeholder
 * @scope profesor-materia
 *
 * Given: panelId a poblar + número del parcial futuro
 * When:  el profesor selecciona un parcial no iniciado y entra a tabs
 *        Gestión/Tareas/Recursos
 * Then:  reemplaza el contenido del panel por un empty state .x-empty
 * Edge:
 *   - panelId no existe en DOM → no-op
 */
function _profRenderParcialFuturoPlaceholder(panelId, parcialNum, tabId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const labels = {
        gestion:  { icon: "👥", title: "Gestión",  desc: "podrás capturar evaluaciones de tus alumnos" },
        tareas:   { icon: "📋", title: "Tareas",   desc: "podrás crear, asignar y calificar tareas" },
        recursos: { icon: "📁", title: "Recursos", desc: "podrás compartir material con tus alumnos" }
    };
    const cfg = labels[tabId] || { icon: "⏳", title: "Sección", desc: "el contenido estará disponible" };
    panel.innerHTML = `
        <div class="x-empty">
            <div class="x-empty__icon">${cfg.icon}</div>
            <div class="x-empty__title">Parcial ${parcialNum} aún no iniciado</div>
            <div class="x-empty__text">Cuando inicie el parcial, ${cfg.desc} aquí.</div>
        </div>`;
}

/**
 * @interaction dispatch-tab-render-profesor
 * @scope profesor-materia
 *
 * Given: tabId interno + matId + grupoId + panelId
 * When:  profHubMatSwitchTab o el listener de parcial necesitan renderear
 *        el contenido de un tab según el parcial activo
 * Then:  - si tabId es gestion/tareas/recursos Y parcial activo es futuro
 *          → inyecta placeholder en panelId
 *        - sino → invoca el renderer original (escalaRender, gestionRender,
 *          tareasProfRender, recursosProfRender)
 *        - juegos siempre placeholder estático (no se toca)
 */
function _profMatDispatchTabRender(tabId, matId, grupoId, panelId) {
    const futuro = _profIsParcialFuturo(matId, grupoId);
    const gmKey = (typeof profMatGrupoKey === "function") ? profMatGrupoKey(matId, grupoId) : `${matId}_${grupoId}`;
    const parcialNum = APP.profParcialActivo?.[gmKey] || 1;
    const gatedTabs = ["gestion", "asistencia", "tareas", "recursos"];

    if (futuro && gatedTabs.includes(tabId)) {
        _profRenderParcialFuturoPlaceholder(panelId, parcialNum, tabId);
        return;
    }

    if (tabId === "calificaciones" && typeof escalaRender === "function") {
        escalaRender(panelId, matId, grupoId);
    } else if (tabId === "gestion" && typeof gestionRender === "function") {
        gestionRender(panelId, matId, grupoId);
    } else if (tabId === "asistencia" && typeof asistenciaProfRender === "function") {
        asistenciaProfRender(panelId, matId, grupoId, parcialNum);
    } else if (tabId === "tareas" && typeof tareasProfRender === "function") {
        tareasProfRender(panelId, matId, grupoId);
    } else if (tabId === "recursos" && typeof recursosProfRender === "function") {
        recursosProfRender(panelId, matId);
    } else if (tabId === "maestria" && typeof window.profHubMatRenderMaestria === "function") {
        window.profHubMatRenderMaestria();
        return;
    } else if (tabId === "juegos") {
        // Slice E2 Task 31 · 2026-06-05: dispatcher al renderer beta del panel.
        if (typeof renderPanelJuegosProfesor === "function" && typeof JuegosData === "object") {
            window._juegosCurrentMateriaId = matId;
            window._juegosCurrentTema = "todos";
            renderPanelJuegosProfesor(matId, "todos");
        } else if (typeof window.profHubMatRenderJuegos === "function") {
            // fallback al render legacy
            // Sprint entrega 2026-06-08: reemplaza placeholder por render quiz read-only.
            window.profHubMatRenderJuegos(panelId, matId);
        }
    } else if (tabId === "examenes" && typeof window.profHubMatRenderExamenes === "function") {
        // Sprint Examenes 2026-06-04: render exámenes read-only.
        window.profHubMatRenderExamenes(panelId, matId);
    } else if (tabId === "temario" && typeof TemarioRender !== "undefined") {
        // Sweep 2026-06-09 (Temario+IA): render profesor del tab Temario.
        const panelEl = document.getElementById(panelId);
        if (panelEl) panelEl.dataset.currentMatid = matId;
        TemarioRender.renderProfesor(panelId, matId);
    }
}
window._profMatDispatchTabRender = _profMatDispatchTabRender;

// ── Helpers locales ──
/**
 * @interaction prof-esc
 * @scope profesor-hub-aprendizaje-helper-esc
 *
 * Given un valor cualquiera `s`.
 * When el render compone HTML con `grupoId`, `nombre`, `label`, etc.
 * Then String coerce + 4-char escape (no apóstrofe).
 * Edge:
 *   - null/undefined → "" (no "null" literal).
 *   - Mismo cuerpo de bytes que `_hgpEsc` (twin del mismo rol).
 *   - **Deuda consolidación**: 5to `_*Esc` cross-archivo (con `_apEsc` +
 *     `_hgpEsc` + `_hubInicioEsc` + `_calEsc`). Migrar a `_escapeHtml`
 *     canonical (slice XSS pre-Supabase).
 *   - Helper LOCAL.
 *   - Función PURA.
 */
// FIX 2026-07-08: era una reimplementación duplicada de _escapeHtml
// (js/core/dom-utils.js) — y a diferencia del canonical, a ESTA copia le
// faltaba escapar comillas simples ('), un riesgo real de inyección HTML
// en cualquier atributo delimitado con '...'. Ahora delega al canonical.
// Ver CONVENTIONS.md.
function _profEsc(s) {
    return _escapeHtml(s);
}

// ═══════════════════════════════════════════════════════════
// PIEZA D — Parcial persistente cross-tabs (Phase 2, Task 8-11)
// ═══════════════════════════════════════════════════════════

/**
 * @interaction set-parcial-activo-profesor
 * @scope profesor-materia
 *
 * Given: profesor dentro de una materia (hub-aprendizaje)
 * When:  click en tab P1/P2/Final del header de materia
 * Then:  persiste parcial activo en APP.profParcialActivo[gmKey] + localStorage;
 *        emite evento 'xahni:parcialActivoCambio' con detail {rol:'profesor', gmKey, parcial}
 * Edge:
 *   - argumentos inválidos → no-op + console.warn
 *   - localStorage falla → solo memory + console.warn
 */
function profMatSetParcial(gmKey, parcial) {
    if (!gmKey || !Number.isInteger(parcial)) {
        console.warn("[XAHNI] profMatSetParcial: argumentos inválidos", gmKey, parcial);
        return;
    }
    APP.profParcialActivo[gmKey] = parcial;
    try {
        localStorage.setItem("xahni.profParcialActivo", JSON.stringify(APP.profParcialActivo));
    } catch (e) {
        console.warn("[XAHNI] localStorage write falló", e);
    }
    document.dispatchEvent(new CustomEvent("xahni:parcialActivoCambio", {
        detail: { rol: "profesor", gmKey, parcial }
    }));
}
window.profMatSetParcial = profMatSetParcial;

/**
 * @interaction render-tabs-parcial-profesor
 * @scope profesor-materia
 *
 * Given: profesor entrando a una materia con periodoInfo definido
 * When:  se invoca al cargar el detalle de materia
 * Then:  renderea tabs P1/.../Final según periodoInfo.parciales,
 *        marca activo según APP.profParcialActivo[gmKey] o periodoInfo.parcial_actual
 * Edge:
 *   - periodoInfo o parciales vacíos → contenedor vacío
 *   - contenedor no existe en DOM → no-op
 */
function profMatRenderParcialTabs(gmKey, periodoInfo) {
    const cont = document.getElementById("prof-mat-parcial-tabs");
    if (!cont || !periodoInfo) return;
    const parciales = Array.isArray(periodoInfo.parciales) ? periodoInfo.parciales : [];
    if (parciales.length === 0) { cont.innerHTML = ""; return; }
    const activo = APP.profParcialActivo[gmKey]
        || periodoInfo.parcial_actual
        || parciales[0]?.num
        || 1;
    // Cementar el default en APP.profParcialActivo para que vistas que leen
    // sin fallback (e.g. dashboard de Gestión) obtengan un valor coherente
    // desde el primer paint sin requerir click del profesor en el tab P1.
    if (APP.profParcialActivo && APP.profParcialActivo[gmKey] == null) {
        APP.profParcialActivo[gmKey] = activo;
        try {
            localStorage.setItem("xahni.profParcialActivo", JSON.stringify(APP.profParcialActivo));
        } catch (e) { /* defensive */ }
    }
    const lastNum = parciales[parciales.length - 1].num;
    // 2026-05-23: visual `.escala-tab` trasplantado del contexto viejo de
    // calificaciones (feedback "reutilizar diseños existentes"). Sublabel
    // muestra estado del parcial (universal alumno/profesor).
    // 2026-05-25 (Lote cerrar-parcial-polish #5.C): simetría sublabel con
    // alumno (hub-aprendizaje.js:1816-1821). Distingue cierre manual del
    // profesor ("🔒 Cerrado") vs expiración natural del periodo ("Finalizado").
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
        return `<button class="escala-tab${isActive ? " active" : ""}" style="flex:0 0 auto;padding:8px 14px;font-size:13px" onclick="profMatSetParcial('${gmKey}', ${p.num})">
            <span>${label}</span>
            <span class="escala-tab-sub">${subLabel}</span>
        </button>`;
    }).join("");
    // Slice cerrar-parcial-integracion 2026-05-24: render del botón global
    // "Cerrar parcial" en el slot adyacente al tabs container. Visible cross-tab.
    if (typeof _renderCerrarParcialBoton === "function") _renderCerrarParcialBoton();
}
window.profMatRenderParcialTabs = profMatRenderParcialTabs;

/**
 * @interaction listener-parcial-cambio-profesor
 * @scope profesor-materia
 *
 * Given: profesor en materia con un tab activo
 * When:  evento 'xahni:parcialActivoCambio' con rol='profesor'
 * Then:  re-renderiza el tab activo + refresca visual de los tabs de parcial
 * Edge:
 *   - gmKey del evento != materia actual → no-op
 *   - APP.profHubMatActivo null → no-op
 *   - tab activo desconocido → solo refresca tabs de parcial
 */
document.addEventListener("xahni:parcialActivoCambio", function(e) {
    if (e.detail.rol !== "profesor") return;
    if (!APP.profHubMatActivo) return;
    const { matId, grupoId } = APP.profHubMatActivo;
    const gmActual = matId && grupoId ? ((typeof profMatGrupoKey === "function") ? profMatGrupoKey(matId, grupoId) : `${matId}_${grupoId}`) : null;
    if (!gmActual || e.detail.gmKey !== gmActual) return;

    // Re-render tab activo (con gating de parcial futuro vía dispatcher)
    const tabActivo = APP.profHubMatActivo.tab;
    const panelId = "prof-hub-mat-panel-" + tabActivo;
    _profMatDispatchTabRender(tabActivo, matId, grupoId, panelId);

    // Re-render tabs de parcial en el header
    const matObj = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : []).find(m => m.id === matId);
    const gid = grupoId || (matObj?.grupos || [])[0];
    const periodoInfo = (typeof getPeriodoInfo === "function" && typeof getPeriodoDeGrupo === "function")
        ? getPeriodoInfo(getPeriodoDeGrupo(gid))
        : null;
    if (periodoInfo) profMatRenderParcialTabs(gmActual, periodoInfo);
});

/**
 * @interaction prof-hub-mat-render-maestria
 * @scope profesor-hub-materia
 *
 * Given: profesor con hub-materia abierta (APP.profHubMatActivo set con matId)
 * When:  profHubMatSwitchTab("maestria", btn) dispatch render del tab
 * Then:  el panel #prof-hub-mat-panel-maestria recibe el content completo
 *        del tab Maestría (header lifetime + tokens 8/8 típico + timeline
 *        con cuatrisCursados + unlocks roadmap o "completo")
 * Edge:
 *   - APP.profHubMatActivo null → no-op silencioso
 *   - panel ausente → no-op silencioso
 *   - matObj no encontrado en DEMO_MATERIAS → usa stub {id, nombre: matId}
 */
function profHubMatRenderMaestria() {
    if (!APP || !APP.profHubMatActivo) return;
    const panel = document.getElementById("prof-hub-mat-panel-maestria");
    if (!panel) return;
    const { matId } = APP.profHubMatActivo;
    // Canonical field es APP.user.id (Slice G usaba .uid → undefined).
    const uid = APP.user ? (APP.user.id || APP.user.uid) : null;
    const matObj = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : []).find(m => m.id === matId)
        || { id: matId, nombre: matId };
    // Para profesor inyectamos `cuatrisCursados` desde el mastery directamente
    // al objeto materia para que _renderMaestriaTabHeader pueda mostrar el count.
    const mastery = _getMaestriaDe(uid, matId);
    if (Array.isArray(mastery.cuatrisCursados)) {
        matObj.cuatrisCursadosCount = mastery.cuatrisCursados.length;
    }
    panel.innerHTML = _renderMaestriaTabContent(uid, matObj, "profesor");
}
window.profHubMatRenderMaestria = profHubMatRenderMaestria;

// ============================================================
// Slice E2 · Task 30 — Panel Juegos profesor
// Simétrico a renderPanelJuegosAlumno pero con voz/datos de profesor.
// _renderJuegoCardCreador se duplica aquí (el helper en estudiante/
// hub-aprendizaje.js es module-scoped, no expuesto a window).
// ============================================================

function _juegoCardPopBarGradientProf(pop) {
    if (pop >= 0.7) return "linear-gradient(90deg,var(--xahni-amber),var(--xahni-purple))";
    if (pop >= 0.4) return "linear-gradient(90deg,var(--state-info),var(--xahni-blue))";
    return "var(--state-warn)";
}

function _renderJuegoCardCreadorProf(juego, creadorUid) {
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
    const chipEstado = pop >= 0.7 ? `<span class="x-chip x-chip--ok" style="font-size:10px;flex-shrink:0">Top juego</span>`
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
                <div class="x-progress" style="flex:1"><div class="x-progress__fill" style="width:${popPct}%;background:${_juegoCardPopBarGradientProf(pop)}"></div></div>
            </div>
            <div class="juegos-stub-card__cta">Vista previa →</div>
        </article>
    `;
}

function renderPanelJuegosProfesor(materiaId, temaFiltro) {
    // Fix smoke 2026-06-06: profesor usa prof-hub-mat-panel-juegos, no hub-panel-juegos
    // (este último es del alumno). Sin esto, el panel queda en el stub estático
    // con el botón "Crear juego" disabled.
    const target = document.getElementById("prof-hub-mat-panel-juegos")
        || document.getElementById("hub-panel-juegos");
    if (!target) return;
    const u = APP?.user;
    if (!u) return;
    const tema = temaFiltro || "todos";

    const todosJuegos = JuegosData.listarJuegosCanonical(materiaId);
    const misCreaciones = todosJuegos.filter(j => j.creadoPor === u.id);
    const filtradas = JuegosData.filtrarPorTema(misCreaciones, tema);
    const stats = JuegosData.statsHeroProfesor(u.id);
    // Bundle C fix: usa listarTemasConTitulo para evitar mostrar IDs en el filtro
    const temasConTit = (typeof JuegosData.listarTemasConTitulo === "function")
        ? JuegosData.listarTemasConTitulo(materiaId)
        : JuegosData.listarTemasDeMateria(materiaId).map(id => ({ id, titulo: id }));
    const temas = [{ id: "todos", titulo: "Todos" }, ...temasConTit];

    target.innerHTML = `
        <div class="hub-panel hub-panel--juegos">
            <div class="x-page-head">
                <div>
                    <div class="x-page-head__title">Mis <em>juegos</em></div>
                    <div class="x-page-head__subtitle">Diseñados por ti · jugados por tus alumnos</div>
                </div>
                <div class="x-page-head__actions" style="display:flex;align-items:center;gap:10px">
                    <span class="x-chip x-chip--info" style="display:inline-flex;align-items:center;gap:6px">
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M8 14c2.5 0 4-1.6 4-3.6 0-1.4-1-2.4-1.5-3.4-.7 1-1.5 1.5-2 1-1-1-.5-3 1-5-3 1.5-5.5 4-5.5 7C4 12.4 5.5 14 8 14z"/>
                        </svg>
                        Cuota: ilimitada por tema
                    </span>
                    <button class="x-btn x-btn--primary" onclick="CrearSelector.abrir('${materiaId}')">＋ Crear juego</button>
                    <button class="x-btn x-btn--ghost" onclick="TemarioIaModal.openSelectorTemaIA('${materiaId}', false)" style="display:inline-flex;align-items:center;gap:6px"><span class="x-chip-ia" style="padding:1px 6px;font-size:9px;">✨</span> Generar con IA</button>
                </div>
            </div>

            <!-- Hero stats creator-economy POV profesor (canónico) -->
            <div class="x-card" style="margin-bottom:18px;padding:22px;position:relative;overflow:hidden">
                <div aria-hidden="true" style="position:absolute;inset:0;background:linear-gradient(135deg,var(--xahni-cyan-dim) 0%,transparent 35%,transparent 65%,var(--xahni-amber-dim) 100%);opacity:0.4;pointer-events:none"></div>
                <div style="position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:24px">
                    <div class="juegos-stub-stat">
                        <div class="juegos-stub-stat__icon" style="color:var(--accent-cyan-text)">
                            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 5h6M5 8h6M5 11h4"/></svg>
                        </div>
                        <div class="x-stat__label">Juegos creados</div>
                        <div class="x-stat__num" style="color:var(--text-primary)">${stats.quizzesCreados}</div>
                        <div style="font-size:11px;color:var(--text-muted)">en esta materia</div>
                    </div>
                    <div class="juegos-stub-stat">
                        <div class="juegos-stub-stat__icon" style="color:var(--xahni-teal)">
                            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3l9 5-9 5V3z"/></svg>
                        </div>
                        <div class="x-stat__label">Jugadas recibidas</div>
                        <div class="x-stat__num" style="color:var(--text-primary)">${stats.jugadasRecibidas}</div>
                        <div style="font-size:11px;color:var(--state-ok)">cross-juegos</div>
                    </div>
                    <div class="juegos-stub-stat">
                        <div class="juegos-stub-stat__icon" style="color:var(--xahni-amber)">
                            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><ellipse cx="8" cy="8" rx="6" ry="2.5" transform="rotate(-20 8 8)"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/></svg>
                        </div>
                        <div class="x-stat__label">XP pasiva</div>
                        <div class="x-stat__num" style="background:linear-gradient(90deg,var(--xahni-amber),var(--xahni-purple));-webkit-background-clip:text;background-clip:text;color:transparent">${stats.xpPasiva}</div>
                        <div style="font-size:11px;color:var(--text-muted)">ganada por aciertos ajenos</div>
                    </div>
                    <div class="juegos-stub-stat">
                        <div class="juegos-stub-stat__icon" style="color:var(--xahni-purple)">
                            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2h8v3c0 2-1.5 3.5-4 3.5S4 7 4 5V2z"/><path d="M6 9h4M5 14h6M7 11v3M9 11v3"/></svg>
                        </div>
                        <div class="x-stat__label">Top juego</div>
                        <div style="font-family:var(--font-display);font-size:16px;font-weight:600;color:var(--text-primary);line-height:1.2;margin:2px 0">${stats.topQuiz || "—"}</div>
                        <div style="font-size:11px;color:var(--text-muted)">${stats.topScore > 0 ? "popularidad <span class='x-mono-sm' style='color:var(--state-ok);font-weight:700'>" + Math.round(stats.topScore * 100) + "%</span>" : "sin creaciones aún"}</div>
                    </div>
                </div>
            </div>

            <!-- Identidad creator-economy POV profesor (canónico) -->
            <div class="x-card x-card--info" style="margin-bottom:18px;padding:14px 18px">
                <div style="display:flex;align-items:center;gap:12px;font-size:12px;color:var(--text-secondary);line-height:1.55">
                    <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--xahni-amber);flex-shrink:0">
                        <path d="M8 14c2.5 0 4-1.6 4-3.6 0-1.4-1-2.4-1.5-3.4-.7 1-1.5 1.5-2 1-1-1-.5-3 1-5-3 1.5-5.5 4-5.5 7C4 12.4 5.5 14 8 14z"/>
                    </svg>
                    <span>
                        Tú <strong style="color:var(--text-primary)">no juegas tus propios juegos</strong>.
                        Ganas <strong style="color:var(--xahni-amber)">XP pasiva</strong> cuando un alumno los juega bien:
                        a mejor calidad del juego, más ingreso pasivo.
                        Decay por replays (100% / 50% / 25%) protege la calidad.
                    </span>
                </div>
            </div>

            <!-- Filtros + orden (canónico) -->
            <div class="juegos-stub-filters" style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px;flex-wrap:wrap">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                    <span style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-right:4px">Filtrar tema</span>
                    ${temas.map(t => `
                        <button class="x-chip ${tema === t.id ? 'x-chip--info' : ''}"
                                onclick="renderPanelJuegosProfesor('${materiaId}', '${t.id}')"
                                style="${tema === t.id ? '' : 'border:1px solid var(--border);background:var(--surface-2);color:var(--text-muted);'}font-family:var(--font-sans);padding:3px 10px;border-radius:99px;font-size:11px">
                            ${t.titulo}
                        </button>
                    `).join("")}
                </div>
                <select disabled title="Disponible post-Supabase" style="background:var(--surface-1);border:1px solid var(--border);border-radius:var(--r-md);padding:6px 10px;font-family:var(--font-sans);font-size:12px;color:var(--text-muted);opacity:0.55;cursor:not-allowed;min-width:180px">
                    <option>Ordenar: Popularidad ↓</option>
                </select>
            </div>

            <!-- Mis juegos creados -->
            <header style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:0 2px">
                <span style="font-family:var(--font-display);font-size:17px;font-weight:600;color:var(--text-primary)">Mis juegos creados</span>
                <span class="x-mono-sm" style="color:var(--text-muted)">${filtradas.length} de ${misCreaciones.length}</span>
            </header>
            ${filtradas.length === 0
                ? `<div style="padding:32px 24px;background:var(--surface-1);border:1px dashed var(--border);border-radius:var(--r-md);text-align:center;margin-bottom:22px">
                       <div style="font-size:32px;margin-bottom:10px">🎯</div>
                       <div style="font-size:13px;color:var(--text-secondary);line-height:1.5;margin-bottom:14px">Crea contenido para tu grupo. Empieza con un quiz rápido o algo más estructurado.</div>
                       <button class="x-btn x-btn--primary" onclick="CrearSelector.abrir('${materiaId}')">＋ Crear juego</button>
                   </div>`
                : `<div class="juegos-stub-grid" style="margin-bottom:22px">${filtradas.map(j => _renderJuegoCardCreadorProf(j, u.id)).join("")}</div>`
            }

            <!-- Bottom legend POV profesor -->
            <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 18px;background:var(--surface-1);border:1px dashed var(--border);border-radius:var(--r-md);font-size:12px;color:var(--text-muted);flex-wrap:wrap;gap:14px">
                <div style="flex:1;min-width:280px">El sistema mide qué tan bien <strong style="color:var(--text-secondary)">diseñas</strong>: a mejor calidad, mayor <strong style="color:var(--text-secondary)">ingreso pasivo</strong> y mayor reconocimiento.</div>
            </div>
        </div>
    `;
}
window.renderPanelJuegosProfesor = renderPanelJuegosProfesor;
