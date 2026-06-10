/**
 * @interaction hub-inicio-render-est
 * @scope estudiante (hub Inicio tab)
 *
 * Given un alumno logueado y #hub-content vacío o con otro contenido.
 * When hubShellSwitchTab("inicio", ...) detecta APP.user.tipo === "estudiante".
 * Then inyecta el panel Inicio con Hero (banner reactivo + marco + título +
 *   chip nivel + click directo a modales perfil) + Card destacado + Banda Agenda
 *   (próximo evento + tareas pendientes estilo hub-materia) + Banda Progreso
 *   (4 metric-cards).
 * Edge si #hub-content no existe (admin path), retorna sin error.
 */
function hubInicioRenderEst() {
    const content = document.getElementById("hub-content");
    if (!content) return;
    const u = APP?.user;
    if (!u) return;

    content.innerHTML = `
        <section class="hub-panel hub-panel--inicio">
            ${_hubInicioHeroEst(u)}
            <div id="dash-hero" class="hub-inicio-dashhero"></div>
            ${_hubInicioBandaAgendaEst(u)}
            ${_hubInicioBandaProgresoEst(u)}
        </section>
    `;

    _hubInicioPaintBanner(u);
    _hubInicioPaintAvatarMarco(u);
    _hubInicioBuildParticles();
    if (typeof buildDashHero === "function") buildDashHero();
}
window.hubInicioRenderEst = hubInicioRenderEst;

/**
 * @interaction hub-inicio-hero-est
 * @scope estudiante
 *
 * Given el usuario activo.
 * When hubInicioRenderEst lo invoca durante render.
 * Then devuelve el HTML del Hero dual gamer-on/off con click directo en
 *   banner/avatar/marco/título + botón "Ver perfil →".
 */
function _hubInicioHeroEst(u) {
    const disp = (typeof getAvatarDisplay === "function") ? getAvatarDisplay(u.id) : null;
    const fotoTexto = disp ? disp.fotoTexto : (u.iniciales ?? "JP");
    const titulo = (disp && disp.tituloHtml) ? disp.tituloHtml : (u.gamer?.tituloActivo ?? "");
    // Slice menor Hero alignment (2026-06-01): consume tituloColor del helper
    // canonical para alinear el visual del title tag con Mi perfil (antes
    // caía al default var(--xahni-purple-light) de la clase .perfil-title-tag).
    const tituloColor = (disp && disp.tituloColor) ? disp.tituloColor : "var(--xahni-purple-light)";
    // Sprint 2026-06-05 hardening H1: respeta D1+D4 "Reset SOFT runtime".
    // Hero level badge lee GamerState (runtime) para alumno; seed JSON queda
    // como dato histórico. Profesor preserva seed (no recibe XP propio).
    const nivel = (typeof GamerState === "object")
        ? GamerState.get(u.id).nivel
        : (u.gamer?.nivelXahni ?? u.nivel ?? 0);
    const tareasCount = _hubInicioTareasPendientesEst(u.id).length;
    const hoy = _hubInicioHoyLargo();

    return `
        <div class="hub-inicio-hero">
            <div class="hub-inicio-hero__on">
                <div class="perfil-banner hub-inicio-banner"
                     id="hub-inicio-banner"
                     onclick="openModal('modal-banner-selector')"
                     title="Cambiar banner">
                    <div class="perfil-banner-bg"></div>
                    <div class="perfil-banner-grid"></div>
                    <div class="perfil-banner-particles" id="hub-inicio-particles"></div>
                    <div class="perfil-banner-shine"></div>
                    <div class="perfil-banner-emblem">🏆</div>
                </div>
                <div class="x-card hub-inicio-hero-card">
                    <div class="hub-inicio-avatar-wrap">
                        <div class="avatar-marco-overlay hub-inicio-marco-overlay"
                             id="hub-inicio-marco-overlay"
                             onclick="event.stopPropagation(); openModal('modal-avatar-selector')"
                             title="Cambiar marco"></div>
                        <div class="hub-inicio-avatar-mini"
                             id="hub-inicio-avatar-mini"
                             onclick="openModal('modal-avatar-selector')"
                             title="Cambiar avatar">${_hubInicioEsc(fotoTexto)}</div>
                        <div class="x-chip x-chip--info perfil-level-badge hub-inicio-level-badge">NIV. ${nivel}</div>
                    </div>
                    <div class="hub-inicio-hero-info">
                        <div class="hub-inicio-hero-name">${_hubInicioEsc(u.nombre ?? "")}</div>
                        ${titulo ? `<div class="perfil-title-tag perfil-title-clickable hub-inicio-title-tag"
                                          style="--title-color:${tituloColor}"
                                          onclick="openModal('modal-titulo-selector')"
                                          title="Cambiar título">${_hubInicioEsc(titulo)} <span class="perfil-title-edit-hint">✎</span></div>` : ""}
                        <div class="hub-inicio-hero-meta">${hoy} · ${tareasCount} tarea${tareasCount === 1 ? "" : "s"} pendiente${tareasCount === 1 ? "" : "s"}</div>
                    </div>
                    <button class="x-btn x-btn--ghost hub-inicio-hero-cta"
                            onclick="hubShellSwitchTab('perfil')">Ver perfil →</button>
                </div>
            </div>
            <div class="hub-inicio-hero__off">
                <div class="hub-inicio-hero-greeting">👋 Hola, ${_hubInicioEsc((u.nombre ?? "").split(" ")[0])}</div>
                <div class="hub-inicio-hero-meta">${hoy} · ${tareasCount} tarea${tareasCount === 1 ? "" : "s"} activa${tareasCount === 1 ? "" : "s"} · Nivel ${nivel}</div>
            </div>
        </div>
    `;
}

/**
 * @interaction hub-inicio-banda-agenda-est
 * @scope estudiante
 *
 * Given el usuario activo.
 * When hubInicioRenderEst arma el panel.
 * Then devuelve HTML con "Próximo evento" + lista de hasta 5 tareas pendientes
 *   en cards estilo hub-materia.
 */
function _hubInicioBandaAgendaEst(u) {
    const pend = _hubInicioTareasPendientesEst(u.id);
    const proximo = pend[0];
    const lista = pend.slice(0, 5);
    const count = pend.length;

    const proximoHtml = proximo
        ? `<div class="x-card hub-inicio-evento">
              <div class="hub-inicio-evento__icon">📌</div>
              <div class="hub-inicio-evento__body">
                  <div class="hub-inicio-evento__title">${_hubInicioEsc(proximo.titulo)}</div>
                  <div class="hub-inicio-evento__meta">${_hubInicioEsc(_hubInicioMateriaNombre(proximo.materiaId))} · ${_hubInicioFechaCorta(proximo.fechaEntrega)}</div>
              </div>
              <button class="x-btn x-btn--primary hub-inicio-btn-sm"
                      onclick="hubShellSwitchTab('materias')">Ver tarea →</button>
          </div>`
        : `<div class="x-card hub-inicio-evento"><div class="hub-inicio-evento__empty">Sin eventos próximos 🎉</div></div>`;

    const listaHtml = lista.length
        ? `<div class="hub-inicio-tareas-grid">
              ${lista.map(t => _hubInicioRenderTareaCardEst(t)).join("")}
          </div>`
        : `<div class="hub-inicio-tareas__empty">Sin tareas pendientes ✅</div>`;

    return `
        <div class="hub-inicio-banda hub-inicio-banda--agenda">
            <div class="hub-inicio-banda__title">📌 Próximo evento</div>
            ${proximoHtml}
            <div class="hub-inicio-banda__title">📋 Tareas pendientes <span class="hub-inicio-banda__counter">${count}</span></div>
            ${listaHtml}
            <button class="x-btn x-btn--ghost hub-inicio-banda__cta" onclick="hubShellSwitchTab('calendario')">Ver calendario →</button>
        </div>
    `;
}

/**
 * @interaction hub-inicio-render-tarea-card-est
 * @scope estudiante
 *
 * Given una tarea pendiente del usuario.
 * When _hubInicioBandaAgendaEst arma la lista.
 * Then renderea una card con stripe color materia + chip estado + timer +
 *   botón "Ver tarea" al tab Materias.
 */
function _hubInicioRenderTareaCardEst(t) {
    const dias = _hubInicioDiasRestantes(t.fechaEntrega);
    const urgente = dias <= 2;
    const chipCls = urgente ? "x-chip--danger" : "x-chip--info";
    const chipDot = urgente ? "var(--state-danger)" : "var(--state-info)";
    const chipLabel = urgente ? "Urgente" : "Pendiente";
    const stripeColor = _hubInicioMateriaColor(t.materiaId);
    const timer = dias <= 0
        ? `<span style="color:var(--state-danger);font-weight:700">⏱ Hoy</span>`
        : dias <= 2
            ? `<span style="color:var(--state-warn);font-weight:700">⏱ ${dias}d restantes</span>`
            : `Entrega: <span style="color:var(--text-primary)">${_hubInicioFechaCorta(t.fechaEntrega)}</span>`;

    return `
        <div class="x-card hub-inicio-tarea-card" style="border-left:4px solid ${stripeColor}">
            <div class="hub-inicio-tarea-card__head">
                <span class="x-chip ${chipCls}" style="--dot:${chipDot}">${chipLabel}</span>
                <span class="hub-inicio-tarea-card__materia">${_hubInicioEsc(_hubInicioMateriaNombre(t.materiaId))}</span>
            </div>
            <div class="hub-inicio-tarea-card__title">${_hubInicioEsc(t.titulo)}</div>
            <div class="hub-inicio-tarea-card__meta">${timer}</div>
            <div class="hub-inicio-tarea-card__actions">
                <button class="x-btn x-btn--primary hub-inicio-btn-sm"
                        onclick="hubShellSwitchTab('materias')">Ver tarea →</button>
            </div>
        </div>
    `;
}

/**
 * @interaction hub-inicio-banda-progreso-est
 * @scope estudiante
 *
 * Given el usuario activo.
 * When hubInicioRenderEst arma el panel.
 * Then devuelve HTML con 4 metric-cards canónicos: XP semana, Nivel,
 *   Logros, Racha.
 */
function _hubInicioBandaProgresoEst(u) {
    const xpSemana = _hubInicioXpSemanaEst(u.id);
    // Sprint 2026-06-05 hardening H2: alineado con Hero badge (GamerState runtime).
    const nivel = (typeof GamerState === "object")
        ? GamerState.get(u.id).nivel
        : (u.gamer?.nivelXahni ?? u.nivel ?? 0);
    const logros = _hubInicioLogrosCountEst(u.id);
    const racha = u.racha ?? u.gamer?.racha ?? 0;

    return `
        <div class="hub-inicio-banda hub-inicio-banda--progreso">
            <div class="hub-inicio-banda__title"><svg class="x-icon"><use href="#x-icon-target"></use></svg> Tu progreso esta semana</div>
            <div class="dash-est-metrics hub-inicio-metrics">
                <div class="metric-card blue">
                    <div class="metric-value">${xpSemana}</div>
                    <div class="metric-label">XP esta semana</div>
                </div>
                <div class="metric-card teal">
                    <div class="metric-value">${nivel}</div>
                    <div class="metric-label">Nivel actual</div>
                </div>
                <div class="metric-card amber">
                    <div class="metric-value">${logros}</div>
                    <div class="metric-label">Logros</div>
                </div>
                <div class="metric-card purple">
                    <div class="metric-value">${racha}</div>
                    <div class="metric-label">Racha (días)</div>
                </div>
            </div>
        </div>
    `;
}

/**
 * @interaction hub-inicio-tareas-pendientes-est
 * @scope estudiante-hub-inicio-helper-data
 *
 * Given uid del alumno.
 * When `_hubInicioBandaAgendaEst` muestra "Próximas entregas" + chip count
 *   en Hero meta.
 * Then:
 *   1. Sin DEMO_TAREAS → [].
 *   2. Filter por:
 *      - Alumno NO entregó (no hay entry en `t.entregas` con `e.uid === uid`).
 *      - `fechaEntrega >= now` (vigente, no vencida).
 *   3. Sort asc por fechaEntrega (más próxima primero).
 * Edge:
 *   - **Asimetría con profesor `_hubInicioPorCalificarProf`**: profesor
 *     filtra `entregado && !calificacion`; alumno filtra `!entregado &&
 *     vigente`. Decisión: vista por rol respeta workflow (alumno entrega,
 *     profesor califica).
 *   - Tarea sin fechaEntrega → epoch 0 → filtered out (no futura).
 *   - **Sort ASC por fecha** (más urgente primero) — diferencia con
 *     profesor que también es asc por fecha (consistency).
 *   - Función PURA.
 *   - Helper LOCAL.
 *   - Deuda post-Supabase: vista `tareas_pendientes_alumno_view` con LIMIT SQL.
 */
function _hubInicioTareasPendientesEst(uid) {
    if (typeof DEMO_TAREAS === "undefined" || !Array.isArray(DEMO_TAREAS)) return [];
    const ahora = Date.now();
    return DEMO_TAREAS
        .filter(t => {
            const entregoYa = (t.entregas || []).some(e => e.uid === uid);
            if (entregoYa) return false;
            const fecha = t.fechaEntrega ? new Date(t.fechaEntrega).getTime() : 0;
            return fecha >= ahora;
        })
        .sort((a, b) => new Date(a.fechaEntrega) - new Date(b.fechaEntrega));
}

/**
 * @interaction hub-inicio-logros-count-est
 * @scope estudiante-hub-inicio-helper-data
 *
 * Given uid del alumno.
 * When `_hubInicioBandaProgresoEst` muestra count en KPI "Logros".
 * Then:
 *   1. Sin DEMO_LOGROS → 0.
 *   2. Filter por `l.desbloqueadoPor[uid] === true` (lookup dict).
 *   3. Retorna count.
 * Edge:
 *   - **Pattern `desbloqueadoPor` dict por uid** (no array de uids) —
 *     consistent con DEMO_LOGROS shape canonical. Lookup O(1).
 *   - Sin entry o false → no cuenta.
 *   - Función PURA.
 *   - Helper LOCAL.
 *   - Deuda post-Supabase: tabla `logros_usuarios` con UNIQUE constraint.
 */
function _hubInicioLogrosCountEst(uid) {
    // Sprint 2026-06-08 D4: contador runtime exclusivo desde GamerState.
    if (typeof GamerState === "undefined" || !uid) return 0;
    return (GamerState.get(uid).insignias || []).length;
}

/**
 * @interaction hub-inicio-xp-semana-est
 * @scope estudiante-hub-inicio-helper-data
 *
 * Given uid del alumno.
 * When `_hubInicioBandaProgresoEst` muestra KPI "XP semana".
 * Then:
 *   1. Sin DEMO_TAREAS → 0.
 *   2. Cutoff = now - 7 días (ms).
 *   3. Itera DEMO_TAREAS × entregas filtradas por uid:
 *      - fecha de entrega >= cutoff AND calificacion numérica:
 *        `xp += calificacion * 10`.
 *   4. Retorna xp.
 * Edge:
 *   - **Heurística `cal × 10` hardcoded** — fake XP DEMO. Alumno con cal 9
 *     en una entrega esta semana suma 90 XP. Deuda post-Supabase: tabla
 *     `xp_eventos` con sistema canonical.
 *   - **Ventana 7-días rolling** — no calendar week (lun-dom). Decisión:
 *     UX más intuitiva para "última semana".
 *   - Entregas sin fecha → epoch 0 → filtered out.
 *   - Entregas sin calificación → no contribuyen.
 *   - **Sin tracking real de XP semana** — placeholder visual. El sistema
 *     XP canonical vive en `addXP` (state.js) pero NO se distingue por
 *     semana ahí. Deuda visualization-only.
 *   - Función PURA respecto a inputs.
 *   - Helper LOCAL.
 */
function _hubInicioXpSemanaEst(uid) {
    const sieteDias = 7 * 24 * 60 * 60 * 1000;
    const corte = Date.now() - sieteDias;
    let xp = 0;

    // Fuente 1: heurística pre-sprint — tareas calificadas en los últimos 7d.
    if (typeof DEMO_TAREAS !== "undefined" && Array.isArray(DEMO_TAREAS)) {
        DEMO_TAREAS.forEach(t => {
            (t.entregas || []).forEach(e => {
                if (e.uid !== uid) return;
                const fe = e.fecha ? new Date(e.fecha).getTime() : 0;
                if (fe >= corte && typeof e.calificacion === "number") {
                    xp += e.calificacion * 10;
                }
            });
        });
    }

    // Fuente 2: Sprint 2026-06-05 hardening H3 — suma XP de quizzes/examenes
    // jugados en los últimos 7d desde GamerState.jugadas[]. Refleja el flujo
    // transaccional canonical (addXp/addJugada disparados por quiz-jugar.js).
    if (typeof GamerState === "object") {
        const gs = GamerState.get(uid);
        (gs.jugadas || []).forEach(j => {
            const fe = j.fecha ? new Date(j.fecha).getTime() : 0;
            if (fe >= corte) xp += (j.xpGanado || 0);
        });
    }

    return xp;
}
