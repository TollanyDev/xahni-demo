/**
 * @interaction hub-inicio-render-prof
 * @scope profesor (hub Inicio tab)
 *
 * Given un profesor logueado y #hub-content vacío o con otro contenido.
 * When hubShellSwitchTab("inicio", ...) detecta APP.user.tipo === "profesor".
 * Then inyecta el panel Inicio con Hero (idéntico al alumno) + Card destacado
 *   (buildDashHero pinta materia con mejor desempeño) + Banda Agenda
 *   (Próxima sesión + Por calificar) + Banda Pulso del grupo (4 metric-cards)
 *   + Banda Mis métricas (3 metric-cards, Maestría placeholder Próximamente).
 * Edge si #hub-content no existe, retorna sin error.
 */
function hubInicioRenderProf() {
    const content = document.getElementById("hub-content");
    if (!content) return;
    const u = APP?.user;
    if (!u) return;

    const data = (typeof getProfDashData === "function") ? getProfDashData(u.id) : null;

    content.innerHTML = `
        <section class="hub-panel hub-panel--inicio">
            ${_hubInicioHeroProf(u, data)}
            <div id="dash-hero" class="hub-inicio-dashhero"></div>
            ${_hubInicioBandaMisMetricasProf(u, data)}
            ${_hubInicioBandaActionsProf(u, data)}
            ${_hubInicioBandaAgendaProf(u, data)}
            ${_hubInicioBandaRendimientoRiesgoProf(u, data)}
            ${_hubInicioBandaActividadProf(u, data)}
        </section>
    `;

    _hubInicioPaintBanner(u);
    _hubInicioPaintAvatarMarco(u);
    _hubInicioBuildParticles();
    if (typeof buildDashHero === "function") buildDashHero();
}
window.hubInicioRenderProf = hubInicioRenderProf;

/**
 * @interaction hub-inicio-hero-prof
 * @scope profesor
 *
 * Given el usuario activo (profesor) y data del dashboard.
 * When hubInicioRenderProf lo invoca durante render.
 * Then devuelve el HTML del Hero dual gamer-on/off — espejo del alumno con
 *   meta adaptada (clases hoy + por calificar). Mismo trasplante visual:
 *   banner reactivo + marco + título + chip nivel + click directo + botón
 *   "Ver perfil →".
 */
function _hubInicioHeroProf(u, data) {
    const disp = (typeof getAvatarDisplay === "function") ? getAvatarDisplay(u.id) : null;
    const fotoTexto = disp ? disp.fotoTexto : (u.iniciales ?? "PF");
    const titulo = (disp && disp.tituloHtml) ? disp.tituloHtml : (u.gamer?.tituloActivo ?? "");
    // Slice menor Hero alignment (2026-06-01): consume tituloColor del helper
    // canonical para alinear el visual del title tag con Mi perfil (antes
    // caía al default var(--xahni-purple-light) de la clase .perfil-title-tag).
    const tituloColor = (disp && disp.tituloColor) ? disp.tituloColor : "var(--xahni-purple-light)";
    const nivel = u.gamer?.nivelXahni ?? u.nivel ?? 0;
    const clasesHoy = _hubInicioClasesHoyProf(u.id).length;
    const porCalificar = _hubInicioPorCalificarProf(u.id, data).length;
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
                    <div class="perfil-banner-emblem">🎓</div>
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
                        <div class="hub-inicio-hero-meta">${hoy} · ${clasesHoy} clase${clasesHoy === 1 ? "" : "s"} hoy · ${porCalificar} por calificar</div>
                    </div>
                    <button class="x-btn x-btn--ghost hub-inicio-hero-cta"
                            onclick="hubShellSwitchTab('perfil')">Ver perfil →</button>
                </div>
            </div>
            <div class="hub-inicio-hero__off">
                <div class="hub-inicio-hero-greeting">👋 Hola, profesor${u.nombre ? " " + _hubInicioEsc(u.nombre.split(" ")[0]) : ""}</div>
                <div class="hub-inicio-hero-meta">${hoy} · ${clasesHoy} clase${clasesHoy === 1 ? "" : "s"} hoy · ${porCalificar} por calificar · Nivel ${nivel}</div>
            </div>
        </div>
    `;
}

/**
 * @interaction hub-inicio-banda-agenda-prof
 * @scope profesor
 *
 * Given el usuario activo (profesor) y data del dashboard.
 * When hubInicioRenderProf arma el panel.
 * Then devuelve HTML con "Próxima sesión" (card con N clases hoy + materias
 *   listadas) y "Por calificar" (lista hasta 5 cards con stripe color materia
 *   + alumno + tarea + botón "Calificar →" al tab Materias).
 */
function _hubInicioBandaAgendaProf(u, data) {
    const clases = _hubInicioClasesHoyProf(u.id);
    const porCalificar = _hubInicioPorCalificarProf(u.id, data);
    const listaPC = porCalificar.slice(0, 5);

    const proximoHtml = clases.length
        ? `<div class="x-card hub-inicio-evento">
              <div class="hub-inicio-evento__icon">📅</div>
              <div class="hub-inicio-evento__body">
                  <div class="hub-inicio-evento__title">Hoy tienes ${clases.length} clase${clases.length === 1 ? "" : "s"}</div>
                  <div class="hub-inicio-evento__meta">${clases.map(c => _hubInicioEsc(c.materiaNombre)).join(" · ")}</div>
              </div>
              <button class="x-btn x-btn--primary hub-inicio-btn-sm"
                      onclick="hubShellSwitchTab('calendario')">Ver horario →</button>
          </div>`
        : `<div class="x-card hub-inicio-evento"><div class="hub-inicio-evento__empty">Sin clases hoy 🌴</div></div>`;

    const listaHtml = listaPC.length
        ? `<div class="hub-inicio-tareas-grid">
              ${listaPC.map(item => _hubInicioRenderPorCalificarCard(item)).join("")}
          </div>`
        : `<div class="hub-inicio-tareas__empty">No hay entregas por calificar ✅</div>`;

    return `
        <div class="hub-inicio-banda hub-inicio-banda--agenda">
            <div class="hub-inicio-banda__title">📅 Próxima sesión</div>
            ${proximoHtml}
            <div class="hub-inicio-banda__title">📝 Por calificar <span class="hub-inicio-banda__counter">${porCalificar.length}</span></div>
            ${listaHtml}
            <button class="x-btn x-btn--ghost hub-inicio-banda__cta" onclick="hubShellSwitchTab('materias')">Ir a materias →</button>
        </div>
    `;
}

/**
 * @interaction hub-inicio-render-por-calificar-card
 * @scope profesor
 *
 * Given un item por calificar (alumno + tarea + materia).
 * When _hubInicioBandaAgendaProf arma la lista.
 * Then renderea card con stripe color materia + nombre alumno + tarea +
 *   chip "Por calificar" + botón "Calificar →" al tab Materias.
 */
function _hubInicioRenderPorCalificarCard(item) {
    const stripeColor = _hubInicioMateriaColor(item.materiaId);
    return `
        <div class="x-card hub-inicio-tarea-card" style="border-left:4px solid ${stripeColor}">
            <div class="hub-inicio-tarea-card__head">
                <span class="x-chip x-chip--warn">Por calificar</span>
                <span class="hub-inicio-tarea-card__materia">${_hubInicioEsc(_hubInicioMateriaNombre(item.materiaId))}</span>
            </div>
            <div class="hub-inicio-tarea-card__title">${_hubInicioEsc(item.tareaTitulo)}</div>
            <div class="hub-inicio-tarea-card__meta">${_hubInicioEsc(item.alumnoNombre)} · ${typeof _displayGrupoLabel === "function" ? _displayGrupoLabel(item.grupoId, 22) : _hubInicioEsc(item.grupoId)}</div>
            <div class="hub-inicio-tarea-card__actions">
                <button class="x-btn x-btn--primary hub-inicio-btn-sm"
                        onclick="hubShellSwitchTab('materias')">Calificar →</button>
            </div>
        </div>
    `;
}

/**
 * @interaction hub-inicio-banda-mis-metricas-prof
 * @scope profesor
 *
 * Given data del dashboard profesor.
 * When hubInicioRenderProf arma el panel.
 * Then devuelve los 4 KPIs canónicos rescatados del dashboard profesor anterior
 *   (_buildProfDashKPIs): Alumnos · Promedio general · En riesgo · Tareas
 *   activas, cada uno con metric-icon + value + label + delta contextual.
 */
function _hubInicioBandaMisMetricasProf(u, data) {
    const total = data?.alumnos?.length ?? 0;
    const promGen = data?.promGen ?? 0;
    const nRiesgo = data?.riesgo?.length ?? 0;
    const tareasP = data?.tareasPend ?? 0;
    const nMat = data?.materias?.length ?? 0;
    const matLabel = `${nMat} materia${nMat !== 1 ? "s" : ""} activa${nMat !== 1 ? "s" : ""}`;

    const kpis = [
        { cls: "teal",   icon: "👥", num: total,                                lbl: "Alumnos",          delta: matLabel, deltaCls: "neutral" },
        { cls: "blue",   icon: "📊", num: promGen ? promGen.toFixed(1) : "—",   lbl: "Promedio general", delta: nRiesgo > 0 ? `⚠️ ${nRiesgo} por debajo de 7` : "✓ Sin alumnos en riesgo", deltaCls: "neutral" },
        { cls: "purple", icon: "⚠️", num: nRiesgo,                              lbl: "En riesgo",        delta: "Promedio < 7.0", deltaCls: "" },
        { cls: "amber",  icon: "📋", num: tareasP,                              lbl: "Tareas activas",   delta: "Por calificar / vigentes", deltaCls: "neutral" },
    ];

    return `
        <div class="hub-inicio-banda hub-inicio-banda--progreso">
            <div class="hub-inicio-banda__title"><svg class="x-icon"><use href="#x-icon-target"></use></svg> Mis métricas</div>
            <div class="dash-est-metrics hub-inicio-metrics">
                ${kpis.map(k => `
                    <div class="metric-card ${k.cls}">
                        <div class="metric-icon ${k.cls}">${k.icon}</div>
                        <div class="metric-value">${k.num}</div>
                        <div class="metric-label">${k.lbl}</div>
                        <div class="metric-delta ${k.deltaCls}">${k.delta}</div>
                    </div>
                `).join("")}
            </div>
        </div>
    `;
}

/**
 * @interaction hub-inicio-banda-actions-prof
 * @scope profesor
 *
 * Given el usuario activo y data del dashboard.
 * When hubInicioRenderProf arma el panel.
 * Then devuelve la fila de acciones rápidas rescatada del dashboard anterior
 *   (_buildProfDashQA): Nueva tarea · Subir recurso · Alumnos en riesgo
 *   (con badge) · Escala de evaluación. Las views standalone fueron retiradas
 *   en C9; los 4 botones navegan al tab Materias del shell (donde vive el
 *   hub-materia profesor con tareas/recursos/escala/gestión por materia).
 */
function _hubInicioBandaActionsProf(u, data) {
    const nRiesgo = data?.riesgo?.length ?? 0;
    return `
        <div class="x-actions hub-inicio-actions">
            <button class="x-btn x-btn--primary" onclick="hubShellSwitchTab('materias')"><span>＋</span> Nueva tarea</button>
            <button class="x-btn x-btn--ghost" onclick="hubShellSwitchTab('materias')"><span>↑</span> Subir recurso</button>
            <button class="x-btn x-btn--danger" onclick="hubShellSwitchTab('mi-grupo')">⚠️ Alumnos en riesgo <span class="x-btn__badge">${nRiesgo}</span></button>
            <button class="x-btn x-btn--ghost" onclick="hubShellSwitchTab('materias')">📐 Escala de evaluación</button>
        </div>
    `;
}

/**
 * @interaction hub-inicio-banda-rendimiento-riesgo-prof
 * @scope profesor
 *
 * Given data del dashboard profesor.
 * When hubInicioRenderProf arma el panel.
 * Then devuelve x-grid--2 con dos cards rescatadas del dashboard anterior:
 *   Rendimiento por materia (_buildProfDashGrupos) y Alumnos en riesgo
 *   (_buildProfDashRiesgo). Visual idéntico al legacy; onclicks adaptados al
 *   shell hub (Materias para detalle materia, Mi grupo para click alumno).
 */
function _hubInicioBandaRendimientoRiesgoProf(u, data) {
    return `
        <div class="x-grid--2 hub-inicio-grid-2">
            ${_hubInicioRenderRendimientoCard(data)}
            ${_hubInicioRenderRiesgoCard(data)}
        </div>
    `;
}

/**
 * @interaction hub-inicio-render-rendimiento-card-prof
 * @scope profesor-hub-inicio-render-helper
 *
 * Given data (getProfDashData shape).
 * When `_hubInicioBandaRendimientoRiesgoProf` arma el x-grid--2 con dos cards
 *   paralelas (rendimiento + riesgo).
 * Then construye la card "Rendimiento por materia" como espejo C9 de
 *   `_buildProfDashGrupos`:
 *   - Itera `_profMateriaStats(data)` (delegado a dashboard.js).
 *   - Cada row: dot color materia + nombre + meta (alumnos · aprobados ·
 *     gruposLabel) + .x-progress entregasPct + trail con avg coloreado.
 *   - Umbrales avg: ≥8 ok / ≥7 warn / >0 danger / 0 muted (mismo del
 *     legacy).
 *   - Header con "Ver detalle →" que ahora hace `hubShellSwitchTab('materias')`
 *     en vez del legacy `showView('gestion-academica')`.
 * Edge:
 *   - **Mejora del espejo sobre el legacy**: usa `_hubInicioEsc` para escapar
 *     nombre + gruposLabel (XSS-safe). El legacy `_buildProfDashGrupos`
 *     no escapaba.
 *   - `_profMateriaStats` ausente parse-time → `[]` → empty state.
 *   - data.materias vacío → empty state "📭 Sin materias".
 *   - **Rescatado al hub** durante shell rework C9: el dashboard standalone
 *     se retiró pero la card sobrevivió migrando al hub-inicio.
 *   - Función PURA (retorna string HTML).
 */
function _hubInicioRenderRendimientoCard(data) {
    const stats = (typeof _profMateriaStats === "function") ? _profMateriaStats(data) : [];
    const rows = stats.map(s => {
        const avgColor = s.avg >= 8 ? "var(--state-ok)"
                       : s.avg >= 7 ? "var(--state-warn)"
                       : s.avg > 0  ? "var(--state-danger)"
                       :              "var(--text-muted)";
        return `<div class="x-list-row">
            <span class="x-list-row__dot" style="background:${s.color}"></span>
            <div class="x-list-row__body">
                <div class="x-list-row__title">${_hubInicioEsc(s.m.nombre)}</div>
                <div class="x-list-row__meta">${s.nAlumnos} alumno${s.nAlumnos !== 1 ? "s" : ""} · ${s.aprobados} aprobado${s.aprobados !== 1 ? "s" : ""} · ${_hubInicioEsc(s.gruposLabel || "sin grupo")}</div>
                <div class="x-progress" style="margin-top:6px"><div class="x-progress__fill" style="width:${s.entregasPct}%;background:${s.color}"></div></div>
            </div>
            <div class="x-list-row__trail" style="color:${avgColor}">${s.avg ? s.avg.toFixed(1) : "—"}</div>
        </div>`;
    }).join("");
    return `<div class="x-card">
        <div class="card-header">
            <span class="card-title">Rendimiento por materia</span>
            <button class="card-action" onclick="hubShellSwitchTab('materias')">Ver detalle →</button>
        </div>
        ${rows || `<div class="x-empty"><div class="x-empty__icon">📭</div><div class="x-empty__title">Sin materias</div></div>`}
    </div>`;
}

/**
 * @interaction hub-inicio-render-riesgo-card-prof
 * @scope profesor-hub-inicio-render-helper
 *
 * Given data (getProfDashData shape).
 * When `_hubInicioBandaRendimientoRiesgoProf` arma el x-grid--2 (twin de
 *   `_hubInicioRenderRendimientoCard`).
 * Then espejo C9 de `_buildProfDashRiesgo`:
 *   - Header con título + chip danger con count.
 *   - Lista vacía → empty state "✅ Sin alumnos en riesgo".
 *   - Lista no vacía: por cada alumno en `data.riesgo`:
 *     - .x-list-row--link (click → `hubShellSwitchTab('mi-grupo')`).
 *     - avatar coloreado por mapa interno (mismo 7-paleta del legacy).
 *     - title nombre + meta materia · grupo · entregas N/total.
 *     - trail con prom state-danger.
 *   - Helper canonical `getAvatarDisplay(uid).fotoTexto` con fallback a ini.
 * Edge:
 *   - **Mejora vs legacy**: usa `_hubInicioEsc` para escapar nombre, materia,
 *     initials. XSS-safe.
 *   - Cambio de navegación: `showView('gestion-academica')` → `hubShellSwitchTab('mi-grupo')`
 *     (gestión académica vive como tab del hub-grupo en el shell rework).
 *   - `_colorFor` es closure inline (mapa duplicado del legacy). Deuda C9-leftover:
 *     extraer a helper shared (mismo bug en _buildProfDashRiesgo).
 *   - color del alumno no en mapa → fallback teal.
 *   - Función PURA (retorna string HTML).
 */
function _hubInicioRenderRiesgoCard(data) {
    const _colorFor = (a) => {
        const map = {
            teal:   { fg: "var(--xahni-teal)",       bg: "var(--xahni-teal-dim)"   },
            blue:   { fg: "var(--xahni-blue-light)", bg: "var(--xahni-blue-dim)"   },
            amber:  { fg: "var(--xahni-amber)",      bg: "var(--xahni-amber-dim)"  },
            red:    { fg: "var(--xahni-red)",        bg: "var(--xahni-red-dim)"    },
            green:  { fg: "var(--xahni-green)",      bg: "var(--xahni-green-dim)"  },
            purple: { fg: "var(--xahni-purple)",     bg: "var(--xahni-purple-dim)" },
            cyan:   { fg: "var(--xahni-cyan)",       bg: "var(--xahni-cyan-dim)"   },
        };
        return map[a.color] || map.teal;
    };
    const riesgo = data?.riesgo || [];
    const content = riesgo.length === 0
        ? `<div class="x-empty"><div class="x-empty__icon">✅</div><div class="x-empty__title">Sin alumnos en riesgo</div></div>`
        : riesgo.map(a => {
            const { fg, bg } = _colorFor(a);
            const initials = (typeof getAvatarDisplay === "function" && a.uid)
                ? getAvatarDisplay(a.uid).fotoTexto
                : a.ini;
            return `<div class="x-list-row x-list-row--link" onclick="hubShellSwitchTab('mi-grupo')">
                <div class="x-list-row__avatar" style="color:${fg};background:${bg}">${_hubInicioEsc(initials)}</div>
                <div class="x-list-row__body">
                    <div class="x-list-row__title">${_hubInicioEsc(a.nombre)}</div>
                    <div class="x-list-row__meta">${_hubInicioEsc(a.materiaNombre)} · ${a.grupo} · ${a.entregas}/${a.entregasTotal} entregas</div>
                </div>
                <div class="x-list-row__trail" style="color:var(--state-danger)">${a.prom.toFixed(1)}</div>
            </div>`;
        }).join("");
    return `<div class="x-card">
        <div class="card-header">
            <span class="card-title">Alumnos en riesgo</span>
            ${riesgo.length ? `<span class="x-chip x-chip--danger">${riesgo.length}</span>` : ""}
        </div>
        ${content}
    </div>`;
}

/**
 * @interaction hub-inicio-banda-actividad-prof
 * @scope profesor
 *
 * Given data del dashboard profesor con tareas y entregas.
 * When hubInicioRenderProf arma el panel (banda final).
 * Then devuelve x-card "Actividad reciente" rescatada del dashboard anterior
 *   (_buildProfDashActivity): lista de las últimas 6 entregas con dot coloreado
 *   por calificación (verde >=8, teal >=6, rojo <6, amber sin calificar) +
 *   texto + meta (fecha relativa + materia). Visual idéntico al legacy con
 *   HTML escapado para nombre/tarea.
 */
function _hubInicioBandaActividadProf(u, data) {
    if (!data || !Array.isArray(data.tareas)) {
        return `
            <div class="x-card">
                <div class="card-header"><span class="card-title">Actividad reciente</span></div>
                <div class="x-empty"><div class="x-empty__icon">📡</div><div class="x-empty__title">Sin entregas registradas</div></div>
            </div>
        `;
    }

    const estudiantesById = (typeof DEMO_USERS !== "undefined")
        ? Object.fromEntries(DEMO_USERS.map(x => [x.id, x]))
        : {};
    const matsById = Object.fromEntries(data.materias.map(m => [m.id, m]));

    const eventos = [];
    data.tareas.forEach(t => {
        const mat = matsById[t.materiaId];
        (t.entregas || []).forEach(e => {
            const est = estudiantesById[e.uid];
            if (!est || !e.fecha) return;
            const nombre = _hubInicioEsc(est.nombre);
            const titulo = _hubInicioEsc(t.titulo);
            eventos.push({
                fecha: new Date(e.fecha),
                texto: e.calificacion != null
                    ? `<strong>${nombre}</strong> entregó "${titulo}" — calificada ${e.calificacion}/10`
                    : `<strong>${nombre}</strong> entregó "${titulo}" — pendiente de calificar`,
                dot: e.calificacion == null
                    ? "var(--xahni-amber)"
                    : e.calificacion >= 8 ? "var(--xahni-green)"
                    : e.calificacion >= 6 ? "var(--xahni-teal)"
                    :                       "var(--xahni-red)",
                materia: _hubInicioEsc(mat?.nombre || t.materiaId),
            });
        });
    });
    eventos.sort((a, b) => b.fecha - a.fecha);

    const top = eventos.slice(0, 6);
    const content = top.length === 0
        ? `<div class="x-empty"><div class="x-empty__icon">📡</div><div class="x-empty__title">Sin entregas registradas</div></div>`
        : top.map(a => `
            <div class="x-list-row">
                <span class="x-list-row__dot" style="background:${a.dot}"></span>
                <div class="x-list-row__body">
                    <div class="x-list-row__title">${a.texto}</div>
                    <div class="x-list-row__meta">${_hubInicioFmtActivityDate(a.fecha)} · ${a.materia}</div>
                </div>
            </div>
        `).join("");

    return `
        <div class="x-card">
            <div class="card-header"><span class="card-title">Actividad reciente</span></div>
            ${content}
        </div>
    `;
}

/**
 * @interaction hub-inicio-fmt-activity-date-prof
 * @scope profesor-hub-inicio-helper-fecha
 *
 * Given un `Date` d.
 * When `_hubInicioBandaActividadProf` formatea fechas del feed.
 * Then:
 *   - Si `_profFormatActivityDate` está disponible (dashboard.js cargado),
 *     delega ahí (canonical helper).
 *   - Fallback inline: misma lógica de cascada relativa (min < 60 → "Hace N min" /
 *     hora < 24 → "Hace Nh" / días: 0=Hoy, 1=Ayer, 1-6=Hace N días /
 *     else locale "es-MX" {day:"2-digit", month:"short"}).
 * Edge:
 *   - **Defensa por orden de carga**: si dashboard.js (que define
 *     `_profFormatActivityDate`) cargara después de hub-inicio.js o no
 *     cargara, este wrapper mantiene la app funcional con su propia copia.
 *   - El fallback es UNA COPIA del canonical — drift posible si futuro
 *     slice cambia uno pero no el otro. **Deuda consolidación**: mover
 *     a un helper shared `_formatFechaRelativa` (igual que `_calFmtYmd`
 *     cementado en sesión 6).
 *   - Función PURA.
 *   - Helper LOCAL (sin export).
 */
function _hubInicioFmtActivityDate(d) {
    if (typeof _profFormatActivityDate === "function") return _profFormatActivityDate(d);
    const today = new Date();
    const diffMin = Math.round((today - d) / 60000);
    if (diffMin < 60 && diffMin >= 0) return `Hace ${Math.max(1, diffMin)} min`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24 && diffH >= 0) return `Hace ${diffH}h`;
    const diffD = Math.round(diffH / 24);
    if (diffD === 0) return "Hoy";
    if (diffD === 1) return "Ayer";
    if (diffD > 0 && diffD < 7) return `Hace ${diffD} días`;
    return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

/**
 * @interaction hub-inicio-clases-hoy-prof
 * @scope profesor-hub-inicio-helper-agenda
 *
 * Given uid del profesor.
 * When `_hubInicioHeroProf` calcula el chip "N clases hoy" (meta), y
 *   `_hubInicioBandaAgendaProf` muestra "Próxima sesión" con materias hoy.
 * Then:
 *   1. Resuelve día de la semana actual via `_hubInicioDiaSemanaKey`
 *      (helper shared en hub-inicio-helpers.js que retorna "lun"/"mar"/etc.).
 *   2. Itera DEMO_MATERIAS filtrando por `profesorId === uid`.
 *   3. Por cada materia: filtra `m.horario[]` por `dia.toLowerCase() === diaKey`.
 *   4. Si hay sesiones hoy → push `{ materiaId, materiaNombre, sesiones[] }`.
 * Edge:
 *   - DEMO_MATERIAS no cargado → `[]`.
 *   - Materia sin horario o sin sesión hoy → no entra.
 *   - **Convención `dia`** lowercase en datos: requiere normalización en
 *     llamada (`.toLowerCase()`). DEMO data ya normalizada pero defensivo.
 *   - NO filtra archivadas (asimetría con `getMateriasProfesor`). Asumido
 *     consciente: agenda del día muestra TODO lo que el profesor "tiene
 *     ahora" incluso si está archivada (corner case raro).
 *   - Función PURA.
 *   - Deuda post-Supabase: vista `clases_hoy_view` con `WHERE dia_semana = $1`.
 */
function _hubInicioClasesHoyProf(uid) {
    if (typeof DEMO_MATERIAS === "undefined" || !Array.isArray(DEMO_MATERIAS)) return [];
    const diaKey = _hubInicioDiaSemanaKey();
    const out = [];
    DEMO_MATERIAS.forEach(m => {
        if (m.profesorId !== uid) return;
        const sesionesHoy = (m.horario || []).filter(h => (h.dia || "").toLowerCase() === diaKey);
        if (sesionesHoy.length) {
            out.push({ materiaId: m.id, materiaNombre: m.nombre, sesiones: sesionesHoy });
        }
    });
    return out;
}

/**
 * @interaction hub-inicio-por-calificar-prof
 * @scope profesor-hub-inicio-helper-agenda
 *
 * Given uid del profesor + data (getProfDashData shape).
 * When `_hubInicioBandaAgendaProf` muestra "Por calificar" con conteo + lista
 *   top 5, y `_hubInicioHeroProf` muestra el chip "N por calificar" en meta.
 * Then itera data.tareas × entregas:
 *   - Solo entregas con `entregado===true && calificacion==null` (entregaron
 *     pero falta calificar).
 *   - Resuelve alumno desde `data.alumnos.find(a => a.uid === e.uid)`.
 *     Fallback `a.nombre || e.uid` si no encuentra.
 *   - Push `{ tareaId, tareaTitulo, materiaId, grupoId, alumnoId,
 *     alumnoNombre, fechaEntrega }`.
 *   - Sort ascendente por fechaEntrega (más antigua primero — más urgente).
 * Edge:
 *   - data null o sin tareas → `[]`.
 *   - data.alumnos vacío (admin sin asignar grupos) → alumnoNombre cae al uid.
 *   - **`entregado` puede no estar en todas las entregas DEMO** (legacy
 *     schema). Solo entregas con flag explícito true entran. Otras (sin
 *     flag) NO entran — convención defensiva.
 *   - fechaEntrega ausente → ordena con `new Date(0)` (epoch, top) — caso
 *     borde no observado en DEMO pero no rompe.
 *   - **Filtro consciente**: el espejo alumno (`hub-inicio.js` estudiante) tiene
 *     "Entregas próximas" con otra semántica (alumno mira fechaEntrega de la
 *     tarea, no de su entrega). Asimetría natural.
 *   - Función PURA.
 *   - Deuda post-Supabase: vista `entregas_por_calificar` con LEFT JOIN.
 */
function _hubInicioPorCalificarProf(uid, data) {
    if (!data || !Array.isArray(data.tareas)) return [];
    const out = [];
    data.tareas.forEach(t => {
        (t.entregas || []).forEach(e => {
            if (e.entregado && e.calificacion == null) {
                const alumno = data.alumnos?.find(a => a.uid === e.uid);
                out.push({
                    tareaId:      t.id,
                    tareaTitulo:  t.titulo,
                    materiaId:    t.materiaId,
                    grupoId:      t.grupoId,
                    alumnoId:     e.uid,
                    alumnoNombre: alumno?.nombre || e.uid,
                    fechaEntrega: e.fecha,
                });
            }
        });
    });
    return out.sort((a, b) => new Date(a.fechaEntrega || 0) - new Date(b.fechaEntrega || 0));
}
