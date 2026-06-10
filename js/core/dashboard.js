// ═══════════════════════════════════════════════════════════
// DASHBOARD — Inicialización post-login
// ═══════════════════════════════════════════════════════════

/**
 * @interaction load-dashboard
 * @scope core-dashboard-orchestrator-post-login
 *
 * Given un usuario recién autenticado (APP.user definido tras
 *   pickDemoUser o flow Firebase Auth en futuro).
 * When auth.js completa login y dispara la transición al dashboard.
 * Then orquestación cross-rol:
 *   1. Oculta #screen-auth.
 *   2. Branch por rol:
 *      - administrador: activa #screen-dashboard-admin (shell legacy).
 *      - estudiante/profesor: activa #screen-hub (shell pre-c10 #7).
 *   3. Hidrata avatar+identidad desde localStorage via
 *      loadCurrentUserAvatarAndIdentidad (Slice #6 P4) ANTES del primer
 *      paint para que sidebar/hub muestren elecciones del usuario.
 *   4. Solo admin: _repaintSidebarAvatar + sidebar name/role + listener
 *      avatarChanged + sweep data-role-hide + show nav-admin.
 *   5. Pre-fill modal editar perfil (#edit-nombre, #edit-email) con
 *      APP.user.
 *   6. Branch final:
 *      - admin: showView('dashboard') flow legacy.
 *      - estudiante/profesor: hubInit() pinta cluster + tab inicial.
 * Edge:
 *   - APP.user null/undefined → return early.
 *   - Helpers no cargados (orden scripts) → optional chaining skip.
 *   - Listener avatarChanged guard window-level idempotente (mismo
 *     patrón que hub-shell.js).
 *   - Slice pre-c10 #7+#8 cementó la divergencia admin vs hub.
 *   - Deuda post-Supabase: pickDemoUser → Firebase Auth via auth.js;
 *     loadDashboard no cambia.
 */
function loadDashboard() {
    const u = APP.user;
    if (!u) return;

    document.getElementById("screen-auth").classList.remove("active");

    const esAdmin = u.tipo === "administrador";

    // Slice pre-c10 #7 · 7.1+7.6 · Branch por rol al shell correspondiente.
    // Admin queda en shell legacy (#screen-dashboard-admin, renombrado en 7.6
    // para hacer explícito su scope). Estudiante y profesor entran al nuevo
    // shell (#screen-hub) y hubInit pinta el cluster + tabs.
    if (esAdmin) {
        document.getElementById("screen-dashboard-admin").classList.add("active");
    } else {
        document.getElementById("screen-hub").classList.add("active");
    }

    // ── Hidratar AVATAR_STATE+IDENTIDAD desde localStorage antes del paint ──
    // Slice #6 P4: si el usuario cambió avatar/banner/título en sesión previa,
    // _loadAvatarState/_loadIdentidad rehidratan + sincronizan con
    // DEMO_USERS[uid].gamer.*. Sin este paso, sidebar pintaría seed values
    // hasta que el usuario navegara a perfil. Admin queda en defaults (no
    // gamificado pero el helper retorna fallback seguro).
    if (typeof loadCurrentUserAvatarAndIdentidad === "function") {
        loadCurrentUserAvatarAndIdentidad();
    }

    // ── Sidebar legacy (solo admin) ──────────────────────────
    // Slice pre-c10 #7 · 7.1: sidebar/topbar legacy solo se pintan para admin.
    // Estudiante + profesor entran al hub shell donde el avatar lo pinta hubInit.
    if (esAdmin) {
        _repaintSidebarAvatar();

        if (!window.__xahniAvatarListenerRegistered) {
            window.__xahniAvatarListenerRegistered = true;
            window.addEventListener("avatarChanged", (ev) => {
                if (ev?.detail?.uid && APP?.user?.id && ev.detail.uid === APP.user.id) {
                    _repaintSidebarAvatar();
                }
            });
        }
        const sidebarName = document.getElementById("sidebar-name");
        if (sidebarName) sidebarName.textContent = u.nombre ?? "";
        const sidebarRole = document.getElementById("sidebar-role");
        if (sidebarRole) {
            sidebarRole.textContent = capitalize(u.tipo ?? "");
        }

        // Sweep data-role-hide="admin" sigue oculto para admin
        document.querySelectorAll('[data-role-hide="admin"]').forEach(el => {
            el.style.display = "none";
        });

        // Nav admin del sidebar legacy (único nav-section que sobrevive
        // post-7.6; nav-estudiante y nav-profesor fueron eliminados del HTML).
        const navA = document.getElementById("nav-admin");
        if (navA) navA.style.display = "block";
    }

    // ── Modal editar perfil (en index.html) ──────────────────
    const editNombre = document.getElementById("edit-nombre");
    const editEmail  = document.getElementById("edit-email");
    if (editNombre) editNombre.value = u.nombre ?? "";
    if (editEmail)  editEmail.value  = u.email  ?? "";

    // Slice pre-c10 #7 · 7.1
    // Admin sigue invocando showView('dashboard') legacy.
    // Estudiante + profesor: hubInit pinta cluster + tab inicial (default "inicio").
    if (esAdmin) {
        document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
        showView("dashboard");
    } else {
        if (typeof hubInit === "function") hubInit();
    }
}

/**
 * @interaction repaint-sidebar-avatar
 * @scope core (sidebar shell)
 *
 * Given un usuario logueado (APP.user definido) y #sidebar-avatar montado en
 *   index.html.
 * When se invoca al boot (loadDashboard) o al disparar window CustomEvent
 *   "avatarChanged" con detail.uid === APP.user.id.
 * Then consulta getAvatarDisplay(APP.user.id) y aplica fotoTexto al
 *   childNodes[0] + extrae box-shadow + animation del marcoCss y los
 *   aplica como style del wrapper. Si no hay marco (foto-default sin
 *   decoración), limpia box-shadow y animation para no arrastrar el del
 *   usuario anterior.
 * Edge si no hay APP.user o el elemento no está en el DOM, retorna sin error.
 *   Si getAvatarDisplay no está cargado (orden de scripts), cae a u.iniciales.
 */
function _repaintSidebarAvatar() {
    const u = APP?.user;
    if (!u) return;
    const avatarEl = document.getElementById("sidebar-avatar");
    if (!avatarEl?.childNodes?.[0]) return;
    const disp = (typeof getAvatarDisplay === "function") ? getAvatarDisplay(u.id) : null;
    avatarEl.childNodes[0].textContent = disp ? disp.fotoTexto : (u.iniciales ?? "");
    if (disp && disp.marcoCss) {
        const m = disp.marcoCss.match(/box-shadow:([^;]+)/);
        avatarEl.style.boxShadow = m ? m[1].trim() : "";
        const anim = disp.marcoCss.match(/animation:([^;]+)/);
        avatarEl.style.animation = anim ? anim[1].trim() : "";
    } else {
        avatarEl.style.boxShadow = "";
        avatarEl.style.animation = "";
    }
}

// ── Header del Perfil (perfil-avatar, perfil-name, etc.) ─────
// Vive en views/shared/perfil.html (lazy). Se invoca desde INIT_MAP.perfil
// en navigation.js cuando el usuario navega a la vista de perfil.
/**
 * @interaction populate-perfil-header
 * @scope core-dashboard-builder-perfil-header
 *
 * Given views/shared/perfil.html inyectada (lazy) y APP.user definido.
 * When navigation.js INIT_MAP.perfil invoca al activar la vista 'perfil'.
 * Then puebla el header del perfil con:
 *   - perfil-avatar: fotoTexto del helper getAvatarDisplay + marcoCss
 *     inline (preserva foto/marco del Slice #6 Pilar 1).
 *   - perfil-name: u.nombre.
 *   - perfil-role: bifurca por rol:
 *     * profesor: "Profesor · {materias join · }" o "Sin materias".
 *     * administrador: "Administrador · UTC".
 *     * estudiante: "Estudiante · {grupo} · ISC".
 *   - perfil-pts: u.puntos toLocaleString.
 *   - perfil-niv: u.nivel.
 *   - perfil-level-badge: "NIV. N".
 *   - Barra XP hacia siguiente rango: calcula via calcularRango/RANGOS
 *     (perfil.js). Rango máximo → "{xp} XP · Rango máximo".
 *   - perfil-med: count DEMO_LOGROS desbloqueados por uid.
 *   - perfil-torn (+label): profesor=count materias; resto=count torneos.
 *   - perfil-rank (+label): profesor=count alumnos cross-materias;
 *     resto=#posición en ranking carrera.
 * Edge:
 *   - APP.user null → return early.
 *   - Element id missing en DOM (lazy load incompleto) → set skip silente.
 *   - calcularRango/RANGOS no cargados → barra XP no se actualiza.
 *   - getAvatarDisplay no cargado → fallback u.iniciales.
 *   - perfil.js _renderAvatarFromState sobreescribe avatar luego (este
 *     fn es solo first paint).
 *   - Carrera hardcoded "Ingeniería en Sistemas Computacionales" para
 *     estudiante (deuda i18n + multi-carrera).
 */
function populatePerfilHeader() {
    const u = APP.user;
    if (!u) return;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    // Avatar: respeta foto/marco elegidos via helper. Slice #6 Pilar 1.
    // _renderAvatarFromState (perfil.js) sobreescribe esto cuando entras a la
    // vista perfil, pero al primer paint queremos el avatar correcto ya.
    const disp = (typeof getAvatarDisplay === "function") ? getAvatarDisplay(u.id) : null;
    const perfilAvatarEl = document.getElementById("perfil-avatar");
    if (perfilAvatarEl) {
        perfilAvatarEl.textContent = disp ? disp.fotoTexto : (u.iniciales ?? "");
        if (disp && disp.marcoCss) perfilAvatarEl.style.cssText = disp.marcoCss + ";cursor:pointer";
    }
    set("perfil-name",   u.nombre ?? "");

    // Subtítulo de rol según tipo de usuario
    let roleText;
    if (u.tipo === "profesor") {
        const mis = (DEMO_MATERIAS || []).filter(m => m.profesorId === u.id);
        roleText = "Profesor · " + (mis.map(m => m.nombre).join(" · ") || "Sin materias asignadas");
    } else if (u.tipo === "administrador") {
        roleText = "Administrador · UTC";
    } else {
        const grupoId = (u.grupos || [])[0] || "";
        // Resolver nombre amigable del grupo (evita "grupo-smoke-1780..." literal).
        const _grupos = (typeof DEMO_GRUPOS !== "undefined" && Array.isArray(DEMO_GRUPOS)) ? DEMO_GRUPOS : [];
        const _g = _grupos.find(g => g.id === grupoId);
        const grupoDisplay = (_g && _g.nombre) ? _g.nombre : grupoId;
        roleText = "Estudiante · " + grupoDisplay + " · Ingeniería en Sistemas Computacionales";
    }
    set("perfil-role", roleText);

    // XP y nivel. Sprint 2026-06-05 hardening H4: alumno consume GamerState
    // (D1+D4 Reset SOFT). Profesor/admin preservan seed (no XP transaccional).
    let xpNow, nivelNow;
    if (u.tipo === "estudiante" && typeof GamerState === "object") {
        const gs = GamerState.get(u.id);
        xpNow = gs.xp ?? 0;
        nivelNow = gs.nivel ?? 1;
    } else {
        xpNow = u.puntos ?? 0;
        nivelNow = u.nivel ?? 0;
    }
    set("perfil-pts", xpNow.toLocaleString());
    set("perfil-niv", nivelNow);

    // Insignia de nivel (no actualizada antes)
    const badgeEl = document.getElementById("perfil-level-badge");
    if (badgeEl) badgeEl.textContent = "NIV. " + nivelNow;

    // Barra XP hacia siguiente rango (depende de RANGOS/calcularRango en perfil.js)
    if (typeof calcularRango === "function" && typeof RANGOS !== "undefined") {
        const rango        = calcularRango(xpNow);
        const siguienteR   = RANGOS[RANGOS.indexOf(rango) + 1] || null;
        const labelEl      = document.getElementById("perfil-xp-label");
        const fillEl       = document.getElementById("perfil-xp-fill");
        if (siguienteR) {
            const pct = Math.min(100, Math.round(((xpNow - rango.xpMin) / (siguienteR.xpMin - rango.xpMin)) * 100));
            if (labelEl) labelEl.textContent = xpNow.toLocaleString() + " / " + siguienteR.xpMin.toLocaleString() + " XP";
            if (fillEl)  fillEl.style.width  = pct + "%";
        } else {
            if (labelEl) labelEl.textContent = xpNow.toLocaleString() + " XP · Rango máximo";
            if (fillEl)  fillEl.style.width  = "100%";
        }
    }

    // Quickstat: logros runtime desde GamerState (sprint 2026-06-08 D4).
    const medEl = document.getElementById("perfil-med");
    if (medEl) {
        medEl.textContent = (typeof GamerState !== "undefined")
            ? (GamerState.get(u.id).insignias || []).length
            : 0;
    }

    // Quickstat: Torneos → Materias (profesor) / Torneos (resto)
    const tornEl      = document.getElementById("perfil-torn");
    const tornLabelEl = document.getElementById("perfil-torn-label");
    if (tornEl && tornLabelEl) {
        if (u.tipo === "profesor") {
            tornEl.textContent      = (DEMO_MATERIAS || []).filter(m => m.profesorId === u.id).length;
            tornLabelEl.textContent = "Materias";
        } else {
            const comps = typeof getCompetenciasAlumno === "function" ? getCompetenciasAlumno(u.id) : { todas: [] };
            tornEl.textContent      = (comps.todas || []).length;
            tornLabelEl.textContent = "Torneos";
        }
    }

    // Quickstat: Ranking → Alumnos (profesor) / Ranking (resto)
    const rankEl      = document.getElementById("perfil-rank");
    const rankLabelEl = document.getElementById("perfil-rank-label");
    if (rankEl && rankLabelEl) {
        if (u.tipo === "profesor") {
            const misAlumnos = new Set();
            (DEMO_MATERIAS || []).filter(m => m.profesorId === u.id).forEach(m => {
                (m.grupos || []).forEach(gid => {
                    ((DEMO_GRUPOS || []).find(g => g.id === gid)?.miembros || []).forEach(eid => misAlumnos.add(eid));
                });
            });
            rankEl.textContent      = misAlumnos.size;
            rankLabelEl.textContent = "Alumnos";
        } else {
            const rankList = typeof getRankingCarrera === "function" ? getRankingCarrera(u.id) : [];
            const miPos    = rankList.findIndex(r => r.esYo);
            rankEl.textContent      = miPos >= 0 ? "#" + (miPos + 1) : "—";
            rankLabelEl.textContent = "Ranking";
        }
    }
}
