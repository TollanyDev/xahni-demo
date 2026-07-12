// ═══════════════════════════════════════════════════════════
// BUILDERS CORE — populateAll + builders del Dashboard
// ═══════════════════════════════════════════════════════════

/**
 * @interaction populate-all
 * @scope core-builders-shared-alumno-profesor-admin
 *
 * Given el usuario está logueado y la app está montada (todas las vistas
 *   inyectadas en index.html).
 * When (legacy) un init global lo invocaba al cargar el dashboard inicial.
 * Then ejecuta secuencialmente todos los builders del dashboard
 *   (progressBars, activityList, chartBars, rankingPreview, dashHero,
 *   tareasPreview) + builders por rol (estudiante: materias/grupos/
 *   competencias/calificaciones/tareas/recursos; profesor: dashboard/
 *   gestión/escala/tareas/recursos; admin: panel/usuarios/módulos) +
 *   perfil cross-rol.
 * Edge populateAll quedó como CÓDIGO MUERTO tras el shift a lazy-load
 *   por vista (slice shell rework #7+#8, 2026-05-26). Cada vista carga
 *   su data al activarse vía ViewLoader, no por populateAll. Se preserva
 *   por compatibilidad histórica + como inventario del set canonical de
 *   builders. NO llamar en código nuevo.
 *   buildMateriasProfesor eliminado slice pre-c10 6b.1 (commit 3a2081f).
 */
function populateAll() {
    // Dashboard
    buildProgressBars();
    buildActivityList();
    buildChartBars();
    buildRankingPreview();
    buildDashTareasPreview();
    buildDashHero();   // (también lo llama buildRankingPreview vía alias; idempotente)
    // Nota: el badge "Materias en riesgo" se actualiza en
    // initEstudianteDashboard → _updateEstRiesgoBadge (esa ruta sí se ejecuta
    // al cargar el dashboard; populateAll quedó sin llamadores tras el
    // lazy-load por vista).
    // Estudiante
    buildMaterias();
    if (typeof hubRebindMateriaCards === "function") hubRebindMateriaCards();
    buildGrupos();
    buildCompetencias();
    buildCalificacionesAlumno();
    buildTareasAlumno();
    buildRecursosAlumno();
    // Profesor
    buildDashboardProfesor();
    buildGestionAcademica();
    buildRecursosProfesor();
    // buildMateriasProfesor removed en slice pre-c10 6b.1 (2026-05-26):
    // la función se eliminó de mismaterias.js como huérfana tras el cleanup
    // `3a2081f` (view-mis-materias-prof standalone). populateAll es código
    // muerto (ver comentario inicial), pero quitamos el call site obsoleto
    // para mantener coherencia con la cleanup.
    buildEscalaEvaluacion();
    buildTareasProfesor();
    // Admin
    buildAdminPanel();
    buildUsuarios();
    buildPerfilModulosAdmin();
    // Perfil
    buildPerfilCompleto();
}

// ── Barras de progreso del dashboard ─────────────────────

/**
 * @interaction build-progress-bars
 * @scope core-builders-dashboard-alumno-profesor
 *
 * Given el dashboard montado con #progress-bars en DOM y APP.user con
 *   tipo estudiante o profesor.
 * When el init del dashboard lo invoca, o populateAll legacy.
 * Then construye una lista de filas (.x-list-row) por materia:
 *   - estudiante: usa getMateriasAlumno(uid) → muestra pct de avance.
 *   - profesor: usa getProfDashData(uid) + agrega entregasPct por materia
 *     → muestra pct promedio de entregas del grupo activo.
 *   Cada fila lleva dot color de la materia, nombre, barra .x-progress,
 *   y trail con pct numérico.
 * Edge:
 *   - #progress-bars no en DOM → no-op.
 *   - tipo distinto a estudiante/profesor → items=[] → renderiza empty
 *     state "Sin materias".
 *   - Helpers de data no cargados → items=[] → empty state.
 *   - pct fuera de [0,100] o NaN → clamped a 0.
 */
function buildProgressBars() {
    const u = APP.user;
    let items;
    if (u.tipo === "estudiante" && typeof getMateriasAlumno === "function") {
        items = getMateriasAlumno(u.id).map(m => ({
            nombre: m.nombre,
            pct:    Math.max(0, Math.min(100, Math.round(m.pct ?? 0))) || 0,
            color:  m.materiaColor || m.color || "var(--xahni-blue-light)",
        }));
    } else if (u.tipo === "profesor" && typeof getProfDashData === "function") {
        const data = getProfDashData(u.id);
        items = data.materias.map(m => {
            const alumnos = data.byMat[m.id] || [];
            const pct = alumnos.length
                ? Math.round(alumnos.reduce((s, a) => s + a.entregasPct, 0) / alumnos.length)
                : 0;
            const palette = typeof _profMatColor === "function"
                ? _profMatColor(m.id, data.materias)
                : { varName: "var(--xahni-blue-light)" };
            return { nombre: m.nombre, pct, color: palette.varName };
        });
    } else {
        items = [];
    }

    const el = document.getElementById("progress-bars");
    if (!el) return;
    if (!items.length) {
        el.innerHTML = `<div class="x-empty"><div class="x-empty__icon">📚</div><div class="x-empty__title">Sin materias</div></div>`;
        return;
    }
    el.innerHTML = items.map(m => `
        <div class="x-list-row">
          <span class="x-list-row__dot" style="background:${m.color}"></span>
          <div class="x-list-row__body">
            <div class="x-list-row__title">${m.nombre}</div>
            <div class="x-progress" style="margin-top:6px"><div class="x-progress__fill" style="width:${m.pct}%;background:${m.color}"></div></div>
          </div>
          <div class="x-list-row__trail x-list-row__trail--sm">${m.pct}%</div>
        </div>`).join("");
}

// ── Lista de actividad reciente ───────────────────────────

/**
 * @interaction fecha-relativa
 * @scope core-builders-helper-canonical
 *
 * Given un Date object o cualquier value (string/null/undefined).
 * When un caller necesita formatear una fecha como tiempo relativo legible
 *   (e.g. "Hace 5 min", "Ayer", "Hace 3 días", "12-may").
 * Then aplica heurística por delta segundos:
 *   - < 60s: "ahora"
 *   - < 1h: "Hace N min"
 *   - < 24h: "Hace Nh"
 *   - < 48h: "Ayer"
 *   - < 7 días: "Hace N días"
 *   - resto: formato corto "DD-mmm" (es-MX).
 * Edge:
 *   - d no es Date válido (null, undefined, string, NaN) → retorna "—".
 *   - d en el futuro → diff negativo → cae en bucket "ahora".
 */
function _fechaRelativa(d) {
    if (!(d instanceof Date) || isNaN(d)) return "—";
    const diff = (new Date() - d) / 1000;
    if (diff < 60)        return "ahora";
    if (diff < 3600)      return `Hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400)     return `Hace ${Math.floor(diff / 3600)}h`;
    if (diff < 86400 * 2) return "Ayer";
    if (diff < 86400 * 7) return `Hace ${Math.floor(diff / 86400)} días`;
    return d.toLocaleDateString("es-MX", { day:"2-digit", month:"short" });
}

/**
 * @interaction build-activity-list
 * @scope core-builders-dashboard-alumno-profesor-admin
 *
 * Given el dashboard montado con #activity-list en DOM y APP.user.
 * When init del dashboard invoca, o populateAll legacy.
 * Then construye lista de hasta 5 eventos recientes:
 *   - estudiante: usa getActividadAlumno(uid).slice(0, 5) → eventos reales
 *     formateados con _fechaRelativa.
 *   - profesor: 4 eventos hardcoded mock (entregas, quizzes, recursos,
 *     alumnos en riesgo).
 *   - admin: 4 eventos hardcoded mock (nuevos usuarios, instituciones,
 *     backups, reportes).
 *   Renderiza filas .x-list-row con dot color, texto (HTML permitido para
 *   <strong>), y meta time.
 * Edge:
 *   - #activity-list no en DOM → no-op.
 *   - getActividadAlumno no cargado para estudiante → activities=undefined
 *     → no-op silente (no llega al render path).
 *   - activities.length === 0 → empty state "Sin actividad reciente".
 *   - Deuda XSS pre-Supabase: text del mock profesor/admin contiene HTML
 *     literal con <strong>; los nombres reales de usuario en activities
 *     del estudiante NO se escapan (innerHTML directo). Slice futuro
 *     de auditoría XSS cross-repo.
 */
function buildActivityList() {
    const u = APP.user;
    let activities;
    if (u.tipo === "estudiante" && typeof getActividadAlumno === "function") {
        activities = getActividadAlumno(u.id).slice(0, 5).map(ev => ({
            dot:  ev.color,
            text: `${ev.icon} ${ev.text}`,
            time: _fechaRelativa(ev.fecha),
        }));
    } else activities = u.tipo === "profesor"
        ? [
            { dot: "var(--xahni-blue)",  text: "<strong>Ana Martínez</strong> entregó tarea de Programación Web",         time: "Hace 1h"  },
            { dot: "var(--xahni-amber)", text: "5 alumnos completaron el <strong>Quiz de BD</strong>",                    time: "Hace 3h"  },
            { dot: "var(--xahni-teal)",  text: 'Recurso "<strong>Guía Parcial 2</strong>" descargado 18 veces',           time: "Hoy"      },
            { dot: "var(--xahni-red)",   text: "3 alumnos con <strong>calificación menor a 6</strong> — requieren atención", time: "Ayer"  },
        ]
        : [
            { dot: "var(--xahni-green)",  text: "Nuevo usuario registrado: <strong>María López</strong> (Estudiante)",    time: "Hace 5min" },
            { dot: "var(--xahni-blue)",   text: "Institución <strong>Esc. Primaria Margarida Masa</strong> agregada",     time: "Hace 1h"   },
            { dot: "var(--xahni-amber)",  text: "Backup automático completado exitosamente",                              time: "02:00 AM"  },
            { dot: "var(--xahni-purple)", text: "Reporte mensual de uso generado y enviado",                              time: "Ayer"      },
        ];

    const el = document.getElementById("activity-list");
    if (!el) return;
    if (!activities.length) {
        el.innerHTML = `<div class="x-empty"><div class="x-empty__icon">📡</div><div class="x-empty__title">Sin actividad reciente</div></div>`;
        return;
    }
    el.innerHTML = activities.map(a => `
        <div class="x-list-row">
          <span class="x-list-row__dot" style="background:${a.dot}"></span>
          <div class="x-list-row__body">
            <div class="x-list-row__title">${a.text}</div>
            <div class="x-list-row__meta">${a.time}</div>
          </div>
        </div>`).join("");
}

// ── Gráfica de barras semanales ───────────────────────────

/**
 * @interaction build-chart-bars
 * @scope core-builders-dashboard-alumno-profesor
 *
 * Given el dashboard montado con #chart-bars (estudiante) y/o #cal-chart
 *   (profesor) en DOM, APP.user con tipo definido.
 * When init del dashboard invoca, o populateAll legacy.
 * Then:
 *   - #chart-bars (semanal): para estudiante usa getActividadAlumno(uid)
 *     filtrado a últimos 7 días, agrupado por día de semana (Lun=0).
 *     Para otros roles, valores hardcoded [45,70,55,90,80,30,65]. Renderiza
 *     7 columnas .chart-bar-col con altura normalizada al máximo (100%),
 *     destacando el día con valor máximo con opacity 1.
 *   - #cal-chart (distribución de calificaciones, solo profesor):
 *     hardcoded [2,5,12,8] sobre rangos [0-5, 6-7, 8-9, 10]. Renderiza
 *     4 columnas color rojo/amber/teal/green.
 * Edge:
 *   - #chart-bars ausente → omite chart semanal.
 *   - #cal-chart ausente → omite distribución (típico en vista alumno).
 *   - getActividadAlumno no cargado → vals fallback a hardcoded
 *     [45,70,55,90,80,30,65] (mock).
 *   - max counts === 0 (sin eventos en últimos 7 días) → Math.max(1, ...)
 *     evita div/0; bars todas en 0%.
 *   - Altura mínima 4% via Math.max(vals[i], 4) → siempre hay barra visible.
 */
function buildChartBars() {
    const u = APP.user;
    const days = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
    let vals = [0,0,0,0,0,0,0];

    if (u?.tipo === "estudiante" && typeof getActividadAlumno === "function") {
        // Cuenta eventos reales en los últimos 7 días por día de la semana
        const eventos = getActividadAlumno(u.id);
        const ahora   = new Date();
        const limite  = new Date(ahora.getTime() - 7 * 86400000);
        const recientes = eventos.filter(e => e.fecha >= limite);
        const counts = [0,0,0,0,0,0,0];
        recientes.forEach(e => {
            const dow = (e.fecha.getDay() + 6) % 7; // 0 = Lun
            counts[dow]++;
        });
        const max = Math.max(1, ...counts);
        vals = counts.map(c => Math.round((c / max) * 100));
    } else {
        vals = [45, 70, 55, 90, 80, 30, 65];
    }
    const colors = [
        "var(--xahni-blue)","var(--xahni-blue)","var(--xahni-blue)",
        "var(--xahni-cyan)","var(--xahni-blue)","var(--xahni-blue-dim)","var(--xahni-blue)",
    ];
    const maxIdx = vals.indexOf(Math.max(...vals));

    const el = document.getElementById("chart-bars");
    if (el) {
        el.innerHTML = days.map((d, i) => `
            <div class="chart-bar-col">
                <div class="chart-bar" style="height:${Math.max(vals[i], 4)}%;background:${colors[i]};opacity:${i === maxIdx ? 1 : 0.65};border-radius:4px 4px 0 0"></div>
                <div class="chart-bar-label">${d}</div>
            </div>`).join("");
    }

    // Gráfica distribución calificaciones (profesor)
    const calEl = document.getElementById("cal-chart");
    if (calEl) {
        const calVals   = [2, 5, 12, 8];
        const calLabels = ["0–5","6–7","8–9","10"];
        const calColors = ["var(--xahni-red)","var(--xahni-amber)","var(--xahni-teal)","var(--xahni-green)"];
        calEl.innerHTML = calLabels.map((l, i) => `
            <div class="chart-bar-col">
                <div class="chart-bar" style="height:${(calVals[i]/12)*100}%;background:${calColors[i]};opacity:0.85;border-radius:4px 4px 0 0"></div>
                <div class="chart-bar-label">${l}</div>
            </div>`).join("");
    }
}

// ── Ranking preview (Dashboard) ──────────────────────────

let dashRankingModo = "grupo";

/**
 * @interaction build-ranking-preview
 * @scope core-builders-dashboard-alumno-orchestrator
 *
 * Given el dashboard montado con #ranking-preview y APP.user.
 * When init del dashboard invoca.
 * Then orquesta 2 builders en cadena:
 *   1. renderDashRanking("grupo") → ranking del grupo del alumno.
 *   2. buildMateriaDestacada (alias buildDashHero) → hero card de materia
 *      con mejor promedio.
 *   El modo inicial es siempre "grupo"; switchDashRanking lo cambia post-init.
 * Edge solo aplica a estudiante (renderDashRanking corta para otros roles).
 *   Profesor/admin: hero card sigue funcionando (vía buildDashHero variant),
 *   ranking queda vacío.
 */
function buildRankingPreview() {
    renderDashRanking("grupo");
    buildMateriaDestacada();
}

/**
 * @interaction switch-dash-ranking
 * @scope core-builders-dashboard-alumno-handler
 *
 * Given el ranking preview montado con botones #dash-btn-grupo +
 *   #dash-btn-carrera y label #dash-ranking-titulo.
 * When user hace click en uno de los 2 botones.
 * Then:
 *   - Actualiza module-scope dashRankingModo a "grupo" | "carrera".
 *   - Toggle classes .active en los 2 botones (uno activo, otro no).
 *   - Actualiza textContent de #dash-ranking-titulo ("Ranking del grupo"
 *     vs "Ranking de la carrera · ISC").
 *   - Re-render via renderDashRanking(modo).
 * Edge:
 *   - Botones o título no en DOM (rol distinto a estudiante) → optional
 *     chaining evita errores, pero el render igual se intenta.
 *   - Carrera hardcoded a "ISC" en el título (deuda i18n cuando entren
 *     más carreras dinámicas).
 */
function switchDashRanking(modo) {
    dashRankingModo = modo;
    document.getElementById("dash-btn-grupo")?.classList.toggle("active", modo === "grupo");
    document.getElementById("dash-btn-carrera")?.classList.toggle("active", modo === "carrera");
    const titulo = document.getElementById("dash-ranking-titulo");
    if (titulo) titulo.textContent = modo === "grupo" ? "Ranking del grupo" : "Ranking de la carrera · ISC";
    renderDashRanking(modo);
}

/**
 * @interaction render-dash-ranking
 * @scope core-builders-dashboard-helper-internal
 *
 * Given el dashboard montado con #ranking-preview y APP.user.
 * When buildRankingPreview o switchDashRanking lo invocan con un modo.
 * Then construye top-5 del ranking según modo:
 *   - "grupo" → getRankingGrupo(uid).
 *   - "carrera" → getRankingCarrera(uid).
 *   Para cada entry renderiza .x-list-row con:
 *   - Posición coloreada (1=oro amber, 2=plata gris, 3=bronce, resto muted).
 *   - Nombre + chip "tú" si es el usuario activo + chip grupo (solo modo
 *     carrera).
 *   - Pts formateados con toLocaleString.
 *   Highlight de la fila propia con background var(--xahni-blue-dim).
 * Edge:
 *   - APP.user.tipo distinto a "estudiante" → limpia innerHTML y retorna
 *     (admin/profesor no tienen ranking propio).
 *   - Helpers de ranking no cargados → fuente=[] → empty state con icono
 *     trofeo + "Sin ranking disponible".
 *   - data.length === 0 → empty state.
 *   - Deuda XSS pre-Supabase: r.nombre + r.grupo se inyectan sin escape.
 */
function renderDashRanking(modo) {
    const el = document.getElementById("ranking-preview");
    if (!el) return;
    if (APP.user.tipo !== "estudiante") { el.innerHTML = ""; return; }
    const uid    = APP.user.id;
    const fuente = modo === "grupo"
        ? (typeof getRankingGrupo   === "function" ? getRankingGrupo(uid)   : [])
        : (typeof getRankingCarrera === "function" ? getRankingCarrera(uid) : []);
    const data = fuente.slice(0, 5);
    if (!data.length) {
        el.innerHTML = `<div class="x-empty"><div class="x-empty__icon"><svg class="x-icon x-icon--xl"><use href="#x-icon-trophy"></use></svg></div><div class="x-empty__title">Sin ranking disponible</div></div>`;
        return;
    }
    const posColor = p => p === 1 ? "var(--xahni-amber)" : p === 2 ? "#a0a0b0" : p === 3 ? "#cd7f32" : "var(--text-muted)";
    el.innerHTML = data.map(r => `
        <div class="x-list-row"${r.esYo ? ' style="background:var(--xahni-blue-dim)"' : ''}>
          <span class="x-mono-sm" style="color:${posColor(r.pos)};font-weight:700;min-width:20px;text-align:center">${r.pos}</span>
          <div class="x-list-row__body">
            <div class="x-list-row__title">${r.nombre}${r.esYo ? ' <span class="x-chip x-chip--brand">tú</span>' : ''}${modo === "carrera" && r.grupo ? ` <span style="font-size:10px;color:var(--text-muted)">${r.grupo}</span>` : ''}</div>
            <div class="x-list-row__meta">${(r.pts || 0).toLocaleString()} pts</div>
          </div>
        </div>`).join("");
}

// ── Hero del Dashboard (card destacado, estudiante + profesor) ──
/**
 * @interaction build-dash-hero
 * @scope core-builders-dashboard-alumno-profesor
 *
 * Given el dashboard montado con #dash-hero y APP.user con tipo definido.
 * When init del dashboard invoca, o populateAll, o buildRankingPreview
 *   (chained), o buildMateriaDestacada (alias legacy).
 * Then construye 1 hero card por rol:
 *   - estudiante: materia con mejor promedio (sort desc por promedio).
 *     Eyebrow "⭐ Materia con mejor promedio", título nombre, meta chips
 *     (profesor, horario, créditos), aside con figura promedio numérico
 *     coloreado por threshold (ok ≥8, warn ≥7, danger <7), barra de
 *     progreso pct. Click navega a 'aprendizaje'.
 *   - profesor: materia con mejor desempeño usando getProfHeroData(data).
 *     Eyebrow "⭐ Materia con mejor desempeño", título, meta chips
 *     (clave, grupos label, horario), aside con promedio del grupo +
 *     barra aprobados pct. Click navega a 'gestion-academica'.
 *   - admin/otros: limpia innerHTML (sin hero card).
 * Edge:
 *   - #dash-hero no en DOM → no-op.
 *   - Estudiante sin materias → limpia innerHTML.
 *   - Helpers de profesor no cargados o hero=null → limpia innerHTML.
 *   - top.promedio === null/undefined → mostrado como "0.0".
 *   - pct fuera de [0,100] o NaN → clamped a 0.
 *   - Deuda XSS pre-Supabase: top.nombre, top.prof, top.horarioStr,
 *     hero.nombre se inyectan sin escape.
 */
function buildDashHero() {
    const el = document.getElementById("dash-hero");
    if (!el) return;
    const tipo = APP.user?.tipo;

    if (tipo === "estudiante") {
        const mats = typeof getMateriasAlumno === "function" ? getMateriasAlumno(APP.user.id) : [];
        if (!mats.length) { el.innerHTML = ""; return; }
        const top = [...mats].sort((a, b) => (b.promedio ?? 0) - (a.promedio ?? 0))[0];
        const fig = top.promedio >= 8 ? "ok" : top.promedio >= 7 ? "warn" : "danger";
        const horarioStr = top.horarioStr || (typeof formatHorarioText === "function" ? formatHorarioText(top.horario, null) : "");
        const pct = Math.max(0, Math.min(100, Math.round(top.pct ?? 0))) || 0;
        el.innerHTML = `
        <div class="x-hero-card" onclick="showView('aprendizaje')">
          <div class="x-hero-card__main">
            <div class="x-hero-card__eyebrow"><span>⭐</span> Materia con mejor promedio</div>
            <div class="x-hero-card__title">${top.nombre}</div>
            <div class="x-hero-card__meta">
              ${top.prof ? `<span class="x-chip x-chip--muted">👨‍🏫 ${top.prof}</span>` : ""}
              ${horarioStr ? `<span class="x-chip x-chip--muted">🕐 ${horarioStr}</span>` : ""}
              ${top.creditos != null ? `<span class="x-chip x-chip--muted">📦 ${top.creditos} créditos</span>` : ""}
            </div>
          </div>
          <div class="x-hero-card__aside">
            <div class="x-hero-card__figure x-hero-card__figure--${fig}">${(top.promedio ?? 0).toFixed(1)}</div>
            <div class="x-hero-card__figure-label">Promedio</div>
            <div class="x-hero-card__progress">
              <div class="x-progress"><div class="x-progress__fill" style="width:${pct}%;background:${top.color || "var(--xahni-blue-light)"}"></div></div>
              <span class="x-hero-card__progress-label">${pct}% avance</span>
            </div>
          </div>
        </div>`;
        return;
    }

    if (tipo === "profesor") {
        const data = typeof getProfDashData === "function" ? getProfDashData(APP.user.id) : null;
        const hero = data && typeof getProfHeroData === "function" ? getProfHeroData(data) : null;
        if (!hero) { el.innerHTML = ""; return; }
        const fig = hero.avg >= 8 ? "ok" : hero.avg >= 7 ? "warn" : "danger";
        el.innerHTML = `
        <div class="x-hero-card" onclick="if (typeof hubShellSwitchTab === 'function') hubShellSwitchTab('materias');">
          <div class="x-hero-card__main">
            <div class="x-hero-card__eyebrow"><span>⭐</span> Materia con mejor desempeño</div>
            <div class="x-hero-card__title">${hero.nombre}</div>
            <div class="x-hero-card__meta">
              ${hero.clave ? `<span class="x-chip x-chip--muted">🏷️ ${hero.clave}</span>` : ""}
              ${hero.gruposLabel ? `<span class="x-chip x-chip--muted">👥 ${hero.gruposLabel}</span>` : ""}
              ${hero.horarioStr ? `<span class="x-chip x-chip--muted">🕐 ${hero.horarioStr}</span>` : ""}
            </div>
          </div>
          <div class="x-hero-card__aside">
            <div class="x-hero-card__figure x-hero-card__figure--${fig}">${hero.avg ? hero.avg.toFixed(1) : "—"}</div>
            <div class="x-hero-card__figure-label">Promedio del grupo</div>
            <div class="x-hero-card__progress">
              <div class="x-progress"><div class="x-progress__fill x-progress__fill--ok" style="width:${hero.aprobadosPct}%"></div></div>
              <span class="x-hero-card__progress-label">${hero.aprobadosPct}% aprobación</span>
            </div>
          </div>
        </div>`;
        return;
    }

    el.innerHTML = ""; // admin u otros: sin hero
}

// Alias de compatibilidad (populateAll y otros aún pueden llamarlo)
/**
 * @interaction build-materia-destacada
 * @scope core-builders-dashboard-alias-legacy
 *
 * Given un caller legacy que esperaba el builder pre-shell-rework con el
 *   nombre "MateriaDestacada".
 * When tal caller (ej. populateAll legacy, o init code antiguo) lo invoca.
 * Then delega 1:1 a buildDashHero (alias). Cero lógica extra.
 * Edge alias preservado por compatibilidad post-rework shell #7+#8. NO usar
 *   en código nuevo (usar buildDashHero directo).
 */
function buildMateriaDestacada() { return buildDashHero(); }

// Paleta compartida de banners por materiaId (alumno y profesor ven el mismo
// gradiente para la misma materia). Antes había dos arrays distintos keyed
// por índice — provocaba que "Bases de Datos" se viera cyan en alumno y
// teal-oscuro en profesor. Ahora dict por id → mismo banner sin importar
// quién lo mire. Fallback determinista por hash para materias no listadas.
const _MATERIA_BG = {
    bd:     "linear-gradient(135deg, #00d4ff, #1b4fe4)",   // Bases de Datos · cyan→azul
    prog:   "linear-gradient(135deg, #00c6a7, #1b4fe4)",   // Programación · teal→azul
    redes:  "linear-gradient(135deg, #f5a623, #e45c00)",   // Redes · ámbar→naranja
    mat:    "linear-gradient(135deg, #22c55e, #00c6a7)",   // Matemáticas · verde→teal
    ingles: "linear-gradient(135deg, #8b2be2, #1b4fe4)",   // Inglés · púrpura→azul
    web:    "linear-gradient(135deg, #1b4fe4, #00d4ff)",   // Desarrollo Web · azul→cyan
};
const _MATERIA_BG_FALLBACK = [
    "linear-gradient(135deg, #00d4ff, #1b4fe4)",
    "linear-gradient(135deg, #00c6a7, #1b4fe4)",
    "linear-gradient(135deg, #f5a623, #e45c00)",
    "linear-gradient(135deg, #22c55e, #00c6a7)",
    "linear-gradient(135deg, #8b2be2, #1b4fe4)",
    "linear-gradient(135deg, #1b4fe4, #00d4ff)",
];
/**
 * @interaction materia-bg-grad
 * @scope core-builders-helper-canonical
 *
 * Given un materiaId (string o null).
 * When un caller necesita el gradient de fondo canónico para la materia
 *   (consistente cross-rol: alumno y profesor ven el mismo).
 * Then:
 *   - Si materiaId está en _MATERIA_BG (bd/prog/redes/mat/ingles/web) →
 *     retorna el gradient definido.
 *   - Si no, deriva un hash determinista del string y selecciona uno de
 *     _MATERIA_BG_FALLBACK (6 gradients).
 *   Hash garantiza que la misma materia siempre obtiene el mismo gradient
 *   en cualquier sesión (sin colisión problemática para 6 fallback).
 * Edge materiaId null/undefined → String("") → hash 0 → primer fallback.
 */
function _materiaBgGrad(materiaId) {
    if (_MATERIA_BG[materiaId]) return _MATERIA_BG[materiaId];
    // Hash deterministico para materias no listadas.
    const s = String(materiaId || "");
    let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return _MATERIA_BG_FALLBACK[h % _MATERIA_BG_FALLBACK.length];
}

/**
 * @interaction html-attr
 * @scope core-builders-helper-canonical
 *
 * Given un valor (string/number/null/undefined).
 * When un caller construye HTML con interpolación dentro de un atributo
 *   (data-*, title=, aria-*, etc.) y necesita escape conservador.
 * Then escapa &, ", ', <, > a sus entidades HTML (&amp; primero para
 *   evitar doble-escape). null/undefined → "".
 * Edge:
 *   - Variante de _escapeHtml para atributos. Funcionalmente equivalente
 *     al canónico de dom-utils.js — convive por historia (slice XSS
 *     pre-c10 #2 dejó deuda de consolidación). Mejor opción a futuro:
 *     usar window._escapeHtml siempre.
 */
function _htmlAttr(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * @interaction display-grupo-label
 * @scope core-builders-helper
 *
 * Given un grupoId crudo (ej. "ISC-3A" o "grupo-smoke-1780809551072").
 * When un caller (rankings competencias, breadcrumb hub-materia, headers)
 *   necesita un label visible amistoso en lugar del id literal.
 * Then:
 *   1. Resuelve `grupo.nombre` desde DEMO_GRUPOS si existe — prefiere
 *      "ISC-3A Smoke Playwright" sobre "grupo-smoke-1780809551072".
 *   2. Si el label supera `maxLen` (default 14), trunca con ellipsis "…".
 *   3. Envuelve en `<span class="x-truncate-inline" title="…">` con el
 *      label completo (nombre + id si difieren) en el tooltip.
 * Edge:
 *   - grupoId null/empty → "".
 *   - DEMO_GRUPOS no cargado → usa el id literal.
 *   - nombre === id → solo trunca el id sin duplicar en tooltip.
 *   - Helper SAFE para inyección directa en HTML strings (usa _htmlAttr).
 */
function _displayGrupoLabel(grupoId, maxLen) {
    if (!grupoId) return "";
    var max = maxLen || 14;

    var grupos = (typeof DEMO_GRUPOS !== "undefined" && Array.isArray(DEMO_GRUPOS) && DEMO_GRUPOS.length)
        ? DEMO_GRUPOS
        : (typeof GRUPOS_DATA !== "undefined" && Array.isArray(GRUPOS_DATA) ? GRUPOS_DATA : []);
    var grupo = grupos.find(function(g) { return g.id === grupoId; });

    var display = grupoId;
    if (grupo && grupo.nombre && grupo.nombre !== grupoId) {
        display = grupo.nombre;
    }

    var truncado = display;
    if (display.length > max) {
        truncado = display.slice(0, max - 1) + "…";
    }

    var tooltip = (grupo && grupo.nombre && grupo.nombre !== grupoId)
        ? grupo.nombre + " (" + grupoId + ")"
        : grupoId;

    return '<span class="x-truncate-inline" title="' + _htmlAttr(tooltip) + '">' + _htmlAttr(truncado) + '</span>';
}

// Bloque "Horario" para .x-materia-card (profesor y estudiante).
// Consume el helper compartido js/core/horario.js → una celda por día con
// uno o varios rangos apilados (resuelve el "día duplicado" cuando una
// materia se imparte el mismo día en distinto horario por grupo).
// El filtrado por grupos del alumno ya viene aplicado upstream en
// getMateriasAlumno; aquí solo agrupamos y renderizamos.
// Renderiza un chip pequeño con el nombre de la clasificación de la materia.
// 4.D — twin-feature alumno/profesor: usa la misma variante visual en ambos
// roles. tronco común → x-chip--info; especialidad → x-chip--brand.
// Devuelve "" si la materia no tiene clasificacionId (legacy, defensa).
/**
 * @interaction render-clasificacion-chip
 * @scope core-builders-helper-canonical
 *
 * Given un clasificacionId (id de DEMO_CLASIFICACIONES) o null.
 * When un caller construye una card de materia (alumno o profesor) y
 *   quiere mostrar la clasificación como chip pequeño.
 * Then busca la clasificación en DEMO_CLASIFICACIONES y retorna chip:
 *   - tipo "troncoComun" → x-chip--info (cyan).
 *   - tipo "especialidad" (resto) → x-chip--brand (gradient brand).
 *   Margin-top 6px inline para alinear bajo el header de card.
 * Edge:
 *   - clasificacionId null/undefined → "" (materia legacy sin clasif).
 *   - DEMO_CLASIFICACIONES no cargado → "".
 *   - Clasificación no encontrada por id → "".
 *   - Slice 4.D cementó la twin-feature alumno/profesor; cualquier cambio
 *     visual debe replicarse en ambos roles.
 */
function _renderClasificacionChip(clasificacionId) {
    if (!clasificacionId || typeof DEMO_CLASIFICACIONES === "undefined") return "";
    const c = DEMO_CLASIFICACIONES.find(x => String(x.id) === String(clasificacionId));
    if (!c) return "";
    const variant = c.tipo === "troncoComun" ? "info" : "brand";
    return `<span class="x-chip x-chip--${variant}" style="margin-top:6px">${c.nombre}</span>`;
}

/**
 * @interaction materia-schedule-html
 * @scope core-builders-helper-canonical
 *
 * Given un objeto materia con campo `horario` (array de slots).
 * When un caller construye .x-materia-card y quiere mostrar el bloque
 *   "Horario" con celdas por día.
 * Then delega a formatHorario(m.horario, null) del helper compartido
 *   js/core/horario.js, que agrupa por día con rangos apilados (resuelve
 *   "día duplicado" cuando una materia se imparte mismo día en distinto
 *   horario por grupo). Renderiza .x-schedule con celdas .x-schedule-cell
 *   (multi-rango si ≥2 rangos en mismo día). Wrap CSS si >3 días.
 * Edge:
 *   - m.horario vacío o formatHorario no cargado → "" (sin bloque).
 *   - Rangos sin salon → omite el sub-elemento __room.
 *   - El filtrado por grupo del alumno se aplica UPSTREAM (en
 *     getMateriasAlumno). Este helper asume m.horario ya filtrado.
 *   - Deuda XSS pre-Supabase: r.inicio/r.fin/r.salon/d.abbr se inyectan
 *     sin escape; en datos controlados son enums seguros pero el patrón
 *     no es robusto post-user-input.
 */
function _materiaScheduleHTML(m, userGrupos) {
    const grouped = typeof formatHorario === "function"
        ? formatHorario(m.horario, userGrupos)
        : [];
    if (!grouped.length) return "";
    const wrap = grouped.length > 3 ? " x-schedule--wrap" : "";
    const cells = grouped.map(d => {
        const rangos = d.rangos.map(r => `
          <div class="x-schedule-cell__range">
            <div class="x-schedule-cell__time">${r.inicio} – ${r.fin}</div>
            ${r.salon ? `<div class="x-schedule-cell__room">${r.salon}</div>` : ""}
          </div>`).join("");
        return `
        <div class="x-schedule-cell${d.rangos.length > 1 ? " x-schedule-cell--multi" : ""}">
          <div class="x-schedule-cell__day">${d.abbr}</div>
          ${rangos}
        </div>`;
    }).join("");
    return `
        <div class="x-materia-card__section">
          <span class="x-label">Horario</span>
          <div class="x-schedule${wrap}">${cells}</div>
        </div>`;
}

// ═══════════════════════════════════════════════════════════
// Slice F · Helpers shared para .b1-ma-card (Maestría LoL-style).
// Consumidos por _buildMatCardEst (alumno) y _buildMatCardProf (profesor).
//
// Datos DEMO hardcoded en DEMO_MAESTRIA (state.js, cargado desde
// data/demo/maestria.json). Post-migración Supabase reemplazar lookups
// por queries a tablas `maestria_alumno` / `maestria_profesor`.
// ═══════════════════════════════════════════════════════════

// Mapping materiaId → disciplinaId (para selección de banner SVG + tint).
// VANILLA HARDCODED. Post-Supabase la materia tendrá campo `disciplina`
// directo en su tabla `materias`.
/**
 * @interaction get-disciplina-id
 * @scope core-builders-maestria-helper-canonical
 *
 * Given un materiaId (string).
 * When un caller maestría (banner, emblema, watermark) necesita seleccionar
 *   el set de assets visuales correspondiente.
 * Then resuelve la disciplinaId con estrategia 3-tier:
 *   1. Lookup en DEMO_MATERIAS[id].disciplina (fuente de verdad post slice B1).
 *   2. Fallback a legacyMap hardcoded si la materia no tiene `disciplina`
 *      seedeada (compat con instalaciones demo viejas / materias creadas
 *      runtime por wizard).
 *   3. Ultimate fallback "bd" si materiaId desconocido.
 * Edge:
 *   - DEMO_MATERIAS no cargado (orden scripts) → cae a legacyMap.
 *   - materiaId vacío/null → "bd".
 *   Deuda post-Supabase: dropear legacyMap y dejar solo lookup directo
 *   contra tabla `materias.disciplina`. Slice migración TS.
 */
function _getDisciplinaId(materiaId) {
    const legacyMap = {
        bd:     "bd",
        prog:   "poo",
        web:    "poo",
        redes:  "ed",
        mat:    "ciencias-exactas",
        ingles: "idiomas"
    };
    try {
        const list = (typeof DEMO_MATERIAS !== "undefined") ? DEMO_MATERIAS : null;
        if (Array.isArray(list)) {
            const m = list.find(x => x && x.id === materiaId);
            if (m && m.disciplina) return m.disciplina;
        }
    } catch (_e) { /* fallthrough a legacyMap */ }
    return legacyMap[materiaId] || "bd";
}


/**
 * @interaction get-disciplina-glyph
 * @scope core-builders-disciplina-canonical
 *
 * Given disciplinaId.
 * When un renderer (b1-ma-card emblem fallback, hub-grupo card mini,
 *   perfil-pub emblema slot) necesita un emoji default representativo
 *   de la disciplina cuando la materia no trae `emblema` propio.
 * Then:
 *   1. Lookup en disciplinaGlyphMap.
 *   2. Si existe → retorna ese emoji.
 *   3. Si no → fallback global "📚".
 * Edge:
 *   - disciplinaId null/undefined → retorna "📚"
 *   - Emoji presentation: ✒️ ⚛️ ⚕️ llevan variation selector-16 (FE0F)
 *     ya incluido en el string literal para forzar emoji-rendering en
 *     todos los browsers.
 *
 * Diseñado en B2.5 (2026-06-06) por frontend-design skill con
 * coherencia 1:1 al elemento dominante del SVG banner correspondiente.
 *
 * Wireado en _renderMaestriaEmblem (B4.5) como fallback cuando el
 * caller no pasa emblemaGlyph propio del JSON o de la paleta de color.
 */
function _getDisciplinaGlyph(disciplinaId) {
    const disciplinaGlyphMap = {
        bd: "🗄️",
        poo: "🏗️",
        ed: "🌳",
        humanidades: "✒️",
        idiomas: "💬",
        "ciencias-exactas": "⚛️",
        negocios: "📈",
        artes: "🎨",
        salud: "⚕️"
    };
    return disciplinaGlyphMap[disciplinaId] || "📚";
}

// Lookup maestría per (uid, materiaId). Fallback a defaults nivel 1
// cuando el usuario no tiene entry para esa materia (caso: alumno recién
// inscrito o profesor sin historial demo).
/**
 * @interaction get-maestria-de
 * @scope core-builders-maestria-helper-canonical
 *
 * Given un uid + materiaId.
 * When un caller necesita el state de maestría LoL-style del usuario en
 *   esa materia (points, nivel, tokens, cosmetics, promedio, pendientes).
 * Then busca en DEMO_MAESTRIA[uid][materiaId]. Si no existe entrada
 *   retorna `fallback` (nivel 1, points 0, arrays vacíos, promedio null).
 *   Mantiene shape consistente para que los consumidores no chequeen
 *   null en cada campo.
 * Edge:
 *   - uid o materiaId falsy → fallback.
 *   - DEMO_MAESTRIA no cargado (orden scripts) → fallback.
 *   - Usuario sin entry global → fallback.
 *   - Materia sin entry específica → fallback.
 *   Deuda post-Supabase: reemplazar por query a tabla `maestria_alumno`
 *   o `maestria_profesor` según rol. Slice migración TS.
 */
function _getMaestriaDe(uid, materiaId) {
    const fallback = {
        points: 0,
        nivel: 1,
        tokensGanados: [],
        cosmeticsDesbloqueados: [],
        promedioCuatri: null,
        tareasPendientes: 0
    };
    if (!uid || !materiaId) return fallback;
    if (typeof DEMO_MAESTRIA !== "object" || !DEMO_MAESTRIA) return fallback;
    const perUser = DEMO_MAESTRIA[uid];
    if (!perUser) return fallback;
    return perUser[materiaId] || fallback;
}

// Banner ilustrado por disciplina. Usa <use href="#b1-ma-banner-{disc}">
// con los <symbol> definidos en el sprite de index.html.
// Meta inferior: código corto materia (izquierda) + profesor opcional (derecha).
/**
 * @interaction render-maestria-banner
 * @scope core-builders-maestria-render-banner
 *
 * Given disciplinaId (id mapeado por _getDisciplinaId), codigoCorto de
 *   materia (string), profesorTexto opcional.
 * When un caller construye la card de maestría (.b1-ma-card) y necesita
 *   el banner superior ilustrado con la disciplina.
 * Then retorna <header.b1-ma-banner> con:
 *   - SVG <use> apuntando al symbol #b1-ma-banner-{disciplinaId} del
 *     sprite global en index.html (4 disciplinas: bd/poo/ed/...).
 *   - Velo .b1-ma-banner__veil para legibilidad del meta.
 *   - Meta inferior: chip code (icono materias + codigoCorto) + chip
 *     teacher si se provee.
 * Edge:
 *   - profesorTexto null/undefined → omite teacher chip.
 *   - codigoCorto null → muestra string vacío.
 *   - aria-hidden="true" porque la información ya vive en la card padre.
 *   - Deuda XSS pre-Supabase: profesorTexto + codigoCorto sin escape.
 */
function _renderMaestriaBanner(disciplinaId, codigoCorto, profesorTexto) {
    const teacherHtml = profesorTexto
        ? `<span class="b1-ma-banner__teacher">${profesorTexto}</span>`
        : "";
    return `
        <header class="b1-ma-banner" aria-hidden="true">
          <svg class="b1-ma-banner__art" viewBox="0 0 400 124" preserveAspectRatio="xMidYMid slice">
            <use href="#b1-ma-banner-${disciplinaId}"/>
          </svg>
          <div class="b1-ma-banner__veil"></div>
          <div class="b1-ma-banner__meta">
            <span class="b1-ma-banner__code">
              <svg class="x-icon x-icon--sm" aria-hidden="true"><use href="#x-icon-materias"/></svg>
              ${codigoCorto || ""}
            </span>
            ${teacherHtml}
          </div>
        </header>`;
}

// Emblema circular con tier ring (1-7). Ring = 7 segmentos arc; los
// niveles 1..(nivel-1) son --filled, nivel actual es --current, el resto
// --locked. Tier badge muestra el nivel numérico.
/**
 * @interaction render-maestria-emblem
 * @scope core-builders-maestria-render-emblem
 *
 * Given disciplinaId (para aria-label), emblemaGlyph (emoji o glyph),
 *   nivel (1-7).
 * When un caller construye .b1-ma-card y necesita el emblema circular con
 *   ring de progresión LoL-style.
 * Then renderiza .b1-ma-emblem con:
 *   - SVG .b1-ma-ring de 7 segmentos arc circulares (radio 48, gap 6).
 *   - Segments 1..(nivel-1) → clase --filled (completados).
 *   - Segment nivel → clase --current (en curso, glow).
 *   - Resto → clase --locked (gris).
 *   - Disco central .b1-ma-emblem__disc con emblemaGlyph.
 *   - Tier badge con número de nivel.
 *   Geometría calculada con stroke-dasharray + offset por segmento.
 * Edge:
 *   - nivel < 1 o > 7 → segments lockean correctamente pero el badge
 *     muestra el valor literal (debe validar el caller).
 *   - emblemaGlyph null/undefined → _getDisciplinaGlyph(disciplinaId) con
 *     fallback ultimate "📚" (helper B2.5 con coherencia 1:1 al banner SVG).
 *   - aria-label compuesto para a11y.
 */
function _renderMaestriaEmblem(disciplinaId, emblemaGlyph, nivel, materiaNombre) {
    const N = 7;
    const cx = 58, cy = 58, r = 48;
    // Cada segmento ocupa 360/7 grados con un pequeño gap visual.
    const segLen = (2 * Math.PI * r) / N;
    const gap = 6;
    const dash = `${segLen - gap} ${gap + segLen * (N - 1)}`;
    const segHtml = Array.from({ length: N }, (_, i) => {
        const cls = (i + 1 < nivel)
            ? "b1-ma-ring__seg b1-ma-ring__seg--filled"
            : (i + 1 === nivel)
                ? "b1-ma-ring__seg b1-ma-ring__seg--current"
                : "b1-ma-ring__seg b1-ma-ring__seg--locked";
        const offset = -(segLen * i);
        return `<circle class="${cls}" cx="${cx}" cy="${cy}" r="${r}" stroke-dasharray="${dash}" stroke-dashoffset="${offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
    }).join("");

    // aria-label prefiere el nombre de la materia (contexto card individual) y
    // cae al cluster (BD/POO/ED) cuando se usa en agregados sin materia clara.
    const aLabel = materiaNombre || (disciplinaId ? disciplinaId.toUpperCase() : "");

    return `
        <div class="b1-ma-emblem" role="img" aria-label="Emblema ${aLabel}, Nivel ${nivel}">
          <svg class="b1-ma-ring" viewBox="0 0 116 116" aria-hidden="true">
            <circle class="b1-ma-ring__track" cx="${cx}" cy="${cy}" r="${r}"/>
            ${segHtml}
          </svg>
          <div class="b1-ma-emblem__disc"><span class="b1-ma-emblem__glyph" aria-hidden="true">${emblemaGlyph || _getDisciplinaGlyph(disciplinaId)}</span></div>
          <span class="b1-ma-emblem__tier-badge" aria-label="Nivel ${nivel}">${nivel}</span>
        </div>`;
}

// Puntuación de maestría (gradient text) + "Maestría Nivel N" en line debajo.
/**
 * @interaction render-maestria-score
 * @scope core-builders-maestria-render-score
 *
 * Given un objeto mastery con points + nivel.
 * When un caller construye .b1-ma-card y necesita el bloque score (label
 *   + número grande gradient + nivel inferior).
 * Then renderiza .b1-ma-score con label "Puntuación de maestría", número
 *   formateado con toLocaleString (separadores de miles), y línea inferior
 *   "Maestría Nivel <em>N</em>".
 * Edge:
 *   - mastery.points null/undefined → muestra "0".
 *   - mastery.nivel null → muestra "1" (default visual).
 */
function _renderMaestriaScore(mastery) {
  return `
    <div class="b1-ma-score">
      <span class="b1-ma-score__label">Puntuación de maestría</span>
      <span class="b1-ma-score__num">${(mastery.points || 0).toLocaleString()}</span>
      <span class="b1-ma-score__level">Maestría Nivel <em>${mastery.nivel || 1}</em></span>
    </div>`;
}

// Nombre de la materia (título centrado bajo el divider).
// Hierarquía visual: aparece entre el score (puntuación grande) y el meta
// (este cuatri/lifetime). Mantenido como helper independiente para que
// futuros consumers puedan invocarlo aisladamente.
/**
 * @interaction render-maestria-name
 * @scope core-builders-maestria-render-name
 *
 * Given un objeto materia con campo `nombre` (string) o null.
 * When un caller construye .b1-ma-card y necesita el título del nombre
 *   centrado entre score y meta.
 * Then renderiza <h3.b1-ma-name>${materia.nombre}</h3>.
 * Edge:
 *   - materia null/undefined o sin nombre → "" (sin h3).
 *   - Deuda XSS pre-Supabase: nombre sin escape.
 */
function _renderMaestriaName(materia) {
  if (!materia || !materia.nombre) return "";
  return `<h3 class="b1-ma-name">${materia.nombre}</h3>`;
}

// Bloque "Este cuatri" (alumno) o "Lifetime" (profesor).
// Alumno: promedio + tareas pendientes coloreadas si > 0.
// Profesor: total cuatris cursados + total alumnos enseñados (lifetime cross-cuatris).
/**
 * @interaction render-maestria-meta
 * @scope core-builders-maestria-render-meta
 *
 * Given materia + role ("estudiante"|"profesor") + mastery state.
 * When un caller construye .b1-ma-card y necesita el bloque meta debajo
 *   del nombre/score.
 * Then bifurca por role:
 *   - profesor: "Lifetime" con materia.cuatrisCursados + alumnos lifetime
 *     (preferencia: alumnosLifetime, fallback totalAlumnos).
 *   - alumno: "Este cuatri" con mastery.promedioCuatri.toFixed(1) + chip
 *     "N tareas pendientes" (rojo si >0) o "Sin pendientes" (neutro).
 * Edge:
 *   - Valores null/undefined → "—" o defaults seguros.
 *   - Singular/plural correcto ("1 tarea pendiente" vs "N tareas pendientes").
 *   - Profesor NO recibe mastery activo (lifetime sale de materia, no mastery).
 *   - Alumno NO recibe lifetime (su contexto es per-cuatri).
 */
function _renderMaestriaMeta(materia, role, mastery) {
  if (role === "profesor") {
    const cuatrisCursados = (materia.cuatrisCursados != null) ? materia.cuatrisCursados : "—";
    const alumnosLifetime = (materia.alumnosLifetime != null) ? materia.alumnosLifetime : (materia.totalAlumnos != null ? materia.totalAlumnos : "—");
    return `
      <div class="b1-ma-meta">
        <span class="b1-ma-meta__label">Lifetime</span>
        <p class="b1-ma-meta__line"><strong>${cuatrisCursados}</strong> cuatris<span class="b1-ma-meta__sep">·</span><strong>${alumnosLifetime}</strong> alumnos</p>
      </div>`;
  }
  // alumno
  const prom = (mastery.promedioCuatri != null) ? mastery.promedioCuatri.toFixed(1) : "—";
  const pend = (mastery.tareasPendientes != null) ? mastery.tareasPendientes : 0;
  const pendHtml = pend > 0
    ? `<span class="b1-ma-meta__sep">·</span><span class="b1-ma-meta__pending">${pend} tarea${pend === 1 ? "" : "s"} pendiente${pend === 1 ? "" : "s"}</span>`
    : `<span class="b1-ma-meta__sep">·</span>Sin pendientes`;
  return `
    <div class="b1-ma-meta">
      <span class="b1-ma-meta__label">Este cuatri</span>
      <p class="b1-ma-meta__line">Promedio <strong>${prom}</strong>${pendHtml}</p>
    </div>`;
}

// Tokens hacia el siguiente nivel. Para niveles 5+ muestra count visible.
// Para niveles 1-4 no muestra nada (los tokens solo aplican a niveles altos).
/**
 * @interaction render-maestria-tokens
 * @scope core-builders-maestria-render-tokens
 *
 * Given mastery state con nivel + tokensGanados (array de ids).
 * When un caller construye .b1-ma-card y mastery.nivel >= 5.
 * Then renderiza .b1-ma-tokens con:
 *   - Head: label dinámico ("Tokens hacia nivel N+1" o "Mastery completado"
 *     si nivel === 7) + count "X/Y" con check icon si completos.
 *   - List: chips compactos (.b1-ma-tokens__chip) de cada token ganado,
 *     limitado a 6 (preview compact).
 *   totalNeed: nivel 5 → 1 token; resto → 3 diferentes.
 * Edge:
 *   - nivel < 5 → "" (tokens no aplican en niveles tempranos).
 *   - tokensGanados vacío o todos no en TOKEN_GLYPHS → "" (sin chips).
 *   - TOKEN_GLYPHS hardcoded (8 tipos). Deuda post-Supabase:
 *     mastery_tokens_catalog table.
 *   - Más de 6 tokens → slice(0,6); el count usa Math.min(length, need).
 *   - Deuda XSS: glyph + nombre del catálogo son controlados, no aplican.
 */
function _renderMaestriaTokens(mastery) {
  const nivel = mastery.nivel || 1;
  if (nivel < 5) return "";
  // Catálogo mínimo de glifos por token. Post-Supabase vive en mastery_tokens_catalog.
  const TOKEN_GLYPHS = {
    honor:             { glyph: "🎖", nombre: "Honor" },
    p1_asistencia:     { glyph: "🎯", nombre: "Asistencia P1" },
    p2_asistencia:     { glyph: "🎯", nombre: "Asistencia P2" },
    p3_asistencia:     { glyph: "🎯", nombre: "Asistencia P3" },
    proyecto_destacado:{ glyph: "🏆", nombre: "Proyecto destacado" },
    parcial_perfecto:  { glyph: "💯", nombre: "Parcial perfecto" },
    maratonista:       { glyph: "🔥", nombre: "Maratonista" },
    campeon:           { glyph: "👑", nombre: "Campeón" }
  };
  const tokens = (mastery.tokensGanados || []).map(id => TOKEN_GLYPHS[id]).filter(Boolean);
  if (!tokens.length) return "";

  const siguiente = nivel === 7 ? "Mastery completado" : `Tokens hacia nivel ${nivel + 1}`;
  // Para nivel 6 necesita 1 token; nivel 7 necesita 3 diferentes; lifetime maestro requiere 3.
  const totalNeed = nivel === 5 ? 1 : 3;
  const haveCount = Math.min(tokens.length, totalNeed);
  const isComplete = haveCount >= totalNeed;
  const checkIcon = isComplete ? `<svg class="x-icon x-icon--sm" aria-hidden="true"><use href="#x-icon-check-circle"/></svg>` : "";

  const chipsHtml = tokens.slice(0, 6).map(t => `
    <span class="b1-ma-tokens__chip" role="listitem"><span aria-hidden="true">${t.glyph}</span> ${t.nombre}</span>
  `).join("");

  return `
    <div class="b1-ma-tokens">
      <div class="b1-ma-tokens__head">
        <span class="b1-ma-tokens__label">${siguiente}</span>
        <span class="b1-ma-tokens__count" aria-label="${haveCount} de ${totalNeed} tokens completados">${haveCount}/${totalNeed} ${checkIcon}</span>
      </div>
      <div class="b1-ma-tokens__list" role="list" aria-label="Tokens ganados">${chipsHtml}</div>
    </div>`;
}

// Cosmetics desbloqueados. Lista chips. Catálogo mínimo de labels.
// Post-Supabase vive en cosmetics_catalog con previews + slots equipables.
/**
 * @interaction render-maestria-cosmetics
 * @scope core-builders-maestria-render-cosmetics
 *
 * Given mastery state con cosmeticsDesbloqueados (array de ids).
 * When un caller construye .b1-ma-card y quiere mostrar lista compact
 *   de cosmetics ya desbloqueados.
 * Then renderiza .b1-ma-cosmetics con:
 *   - Legend "Cosmetics desbloqueados".
 *   - Chips .x-chip--muted (max 4) con label del catálogo COSMETICS_LABELS.
 *   - Si id no está en catálogo → muestra el id literal.
 * Edge:
 *   - cosmeticsDesbloqueados vacío → "" (sin bloque).
 *   - Catálogo hardcoded (15 tipos: bd/poo/mat × tier). Deuda post-Supabase:
 *     cosmetics_catalog table con previews + slots.
 *   - >4 cosmetics → slice(0,4). Restante visible en tab Maestría completo.
 */
function _renderMaestriaCosmetics(mastery) {
  const COSMETICS_LABELS = {
    titulo_aprendiz_bd:    "Aprendiz de BD",
    titulo_conocedor_bd:   "Conocedor de BD",
    titulo_experto_bd:     "Experto en BD",
    titulo_maestro_bd:     "Maestro de BD",
    titulo_aprendiz_poo:   "Aprendiz de POO",
    titulo_conocedor_poo:  "Conocedor de POO",
    titulo_experto_poo:    "Experto en POO",
    titulo_intermedio_mat: "Intermedio de Matemáticas",
    frase_bd_signature:    "BD es mi disciplina",
    frase_poo_signature:   "POO es mi disciplina",
    marco_bd_temarico:     "Marco avatar BD",
    marco_poo_temarico:    "Marco avatar POO",
    marco_oro_bd:          "Marco oro BD",
    emblema_oro_bd:        "Emblema oro BD"
  };
  const items = (mastery.cosmeticsDesbloqueados || [])
    .map(id => COSMETICS_LABELS[id] || id)
    .slice(0, 4);
  if (!items.length) return "";
  const chipsHtml = items.map(label => `<span class="x-chip x-chip--muted">${label}</span>`).join("");
  return `
    <div class="b1-ma-cosmetics" aria-label="Cosméticos desbloqueados">
      <span class="b1-ma-cosmetics__legend">Cosmetics desbloqueados</span>
      ${chipsHtml}
    </div>`;
}

// ═══════════════════════════════════════════════════════════
// SLICE G B.1 · Catálogos completos para tab Maestría
// (extensión del API cementado en Slice F)
// Vanilla hardcoded. Post-Supabase: mastery_tokens_catalog +
// cosmetics_catalog en tablas dedicadas con joins per disciplina.
// ═══════════════════════════════════════════════════════════

// Catálogo completo de los 8 mastery tokens con disparador para hints.
// Slice F renderea solo los GANADOS (chips compactos en card); Slice G
// renderea TODOS (grid 4x2) marcando locked vs earned y mostrando el
// disparador como hint en los locked.
/**
 * @interaction get-mastery-token-catalog
 * @scope core-builders-maestria-catalog
 *
 * Given (sin args).
 * When un caller (tab Maestría grid de tokens) necesita el catálogo
 *   completo con disparadores para mostrar locked vs earned + hint UX.
 * Then retorna objeto con 8 tokens hardcoded: honor + 3 asistencia (p1/p2/p3)
 *   + proyecto_destacado + parcial_perfecto + maratonista + campeon. Cada
 *   entry: { glyph, nombre, disparador }.
 * Edge:
 *   - Vanilla hardcoded. Deuda post-Supabase: mastery_tokens_catalog
 *     table con joins per disciplina.
 *   - Slice F muestra solo los ganados; Slice G muestra TODOS (con
 *     locked hints para los pendientes).
 */
function _getMasteryTokenCatalog() {
    return {
        honor:              { glyph: "🎖", nombre: "Honor",              disparador: "Examen con calificación 10 en primer intento" },
        p1_asistencia:      { glyph: "🎯", nombre: "Asistencia P1",       disparador: "Asistencia 100% primer parcial" },
        p2_asistencia:      { glyph: "🎯", nombre: "Asistencia P2",       disparador: "Asistencia 100% segundo parcial" },
        p3_asistencia:      { glyph: "🎯", nombre: "Asistencia P3",       disparador: "Asistencia 100% tercer parcial" },
        proyecto_destacado: { glyph: "🏆", nombre: "Proyecto destacado",  disparador: "Proyecto marcado destacado en parcial" },
        parcial_perfecto:   { glyph: "💯", nombre: "Parcial perfecto",    disparador: "Calificación final 10 en un parcial" },
        maratonista:        { glyph: "🔥", nombre: "Maratonista",         disparador: "Racha 15 días jugando juegos materia" },
        campeon:            { glyph: "👑", nombre: "Campeón",             disparador: "Top 1 en competencia de la materia" }
    };
}

// Catálogo de cosmetics con metadata para roadmap visible en tab Maestría.
// `nivelRequerido` controla qué se muestra en "Próximos desbloqueos" (>= nivel actual).
// `tipo` distingue render: chip/frame/glyph circle.
// `preview` = texto/emoji que va dentro del preview visual.
// `sub` = línea explicativa bajo el label.
/**
 * @interaction get-cosmetics-catalog
 * @scope core-builders-maestria-catalog
 *
 * Given (sin args).
 * When un caller (tab Maestría unlocks/roadmap) necesita catálogo completo
 *   de cosmetics con metadata visible.
 * Then retorna objeto con ~15 cosmetics hardcoded organizados por disciplina
 *   (BD/POO/Matemáticas). Cada entry: { label, nivelRequerido, tipo
 *   (titulo|frase|marco|emblema), preview (texto/emoji), sub (texto
 *   explicativo) }. nivelRequerido controla "Próximos desbloqueos" en
 *   el roadmap (>= nivel actual del user).
 * Edge:
 *   - Vanilla hardcoded. Deuda post-Supabase: cosmetics_catalog con
 *     previews + slots equipables + tabla cosmetics_user para tracking
 *     de desbloqueos.
 *   - Tipos visuales: titulo (chip text), frase (badge tagline), marco
 *     (frame avatar), emblema (glyph circle).
 */
function _getCosmeticsCatalog() {
    return {
        // ── BD ────────────────────────────────────────────────
        titulo_aprendiz_bd:    { label: "Aprendiz de BD",     nivelRequerido: 1, tipo: "titulo",  preview: "Aprendiz de BD",     sub: "Título inicial visible en perfil" },
        titulo_conocedor_bd:   { label: "Conocedor de BD",    nivelRequerido: 4, tipo: "titulo",  preview: "Conocedor de BD",    sub: "Visible en perfil + chats" },
        titulo_experto_bd:     { label: "Experto en BD",      nivelRequerido: 6, tipo: "titulo",  preview: "Experto en BD",      sub: "Visible en perfil + chats" },
        titulo_maestro_bd:     { label: "Maestro de BD",      nivelRequerido: 7, tipo: "titulo",  preview: "Maestro de BD",      sub: "Título signature permanente" },
        frase_bd_signature:    { label: "BD es mi disciplina", nivelRequerido: 5, tipo: "frase",   preview: "BD es mi disciplina", sub: "Frase mostrable bajo el nombre" },
        marco_bd_temarico:     { label: "Marco avatar BD",     nivelRequerido: 6, tipo: "marco",   preview: "👤",                  sub: "Marco temático aplicable al avatar" },
        marco_oro_bd:          { label: "Marco oro BD",        nivelRequerido: 7, tipo: "marco",   preview: "👤",                  sub: "Aplica en cualquier avatar" },
        emblema_oro_bd:        { label: "Emblema oro BD",      nivelRequerido: 7, tipo: "emblema", preview: "🗄️",                  sub: "Reemplaza el cyan en la card BD" },
        // ── POO ───────────────────────────────────────────────
        titulo_aprendiz_poo:   { label: "Aprendiz de POO",    nivelRequerido: 1, tipo: "titulo",  preview: "Aprendiz de POO",    sub: "Título inicial visible en perfil" },
        titulo_conocedor_poo:  { label: "Conocedor de POO",   nivelRequerido: 4, tipo: "titulo",  preview: "Conocedor de POO",   sub: "Visible en perfil + chats" },
        titulo_experto_poo:    { label: "Experto en POO",     nivelRequerido: 6, tipo: "titulo",  preview: "Experto en POO",     sub: "Visible en perfil + chats" },
        titulo_maestro_poo:    { label: "Maestro de POO",     nivelRequerido: 7, tipo: "titulo",  preview: "Maestro de POO",     sub: "Título signature permanente" },
        frase_poo_signature:   { label: "POO es mi disciplina", nivelRequerido: 5, tipo: "frase",  preview: "POO es mi disciplina", sub: "Frase mostrable bajo el nombre" },
        marco_poo_temarico:    { label: "Marco avatar POO",    nivelRequerido: 6, tipo: "marco",   preview: "👤",                  sub: "Marco temático aplicable al avatar" },
        // ── Matemáticas / ED ──────────────────────────────────
        titulo_intermedio_mat: { label: "Intermedio Matemáticas", nivelRequerido: 4, tipo: "titulo", preview: "Intermedio Mat",   sub: "Visible en perfil" }
    };
}

// Bloque "Parcial N — avance" para .x-materia-card. Elige el parcial activo
// según la fecha de hoy; emite barra segmentada con is-done / is-current y
// etiqueta "Por iniciar" / "Sem. X de Y" / "Completado".
/**
 * @interaction materia-parcial-html
 * @scope core-builders-helper-canonical
 *
 * Given materia con periodoInfo.parciales (array con {num, inicio, fin,
 *   semanas}).
 * When un caller construye .x-materia-card y quiere mostrar avance del
 *   parcial activo.
 * Then:
 *   - Selecciona el parcial activo según hoy entre inicio/fin.
 *   - Si hoy < primer parcial → primer parcial.
 *   - Si hoy > último parcial → último parcial (estado "Completado").
 *   - Calcula semana actual = floor((hoy - inicio) / semana) + 1.
 *   - Renderiza barra .x-segmented con N segmentos (semanas):
 *     - n < semActual → .is-done
 *     - n === semActual → .is-current
 *     - resto → neutro.
 *   - Etiqueta dinámica: "Completado" / "Por iniciar" / "Sem. X de Y".
 * Edge:
 *   - periodoInfo o parciales vacío → "" (sin bloque).
 *   - Parcial cerrado (hoy > fin) → semActual = total + 1, etiqueta
 *     "Completado".
 *   - semanas missing → fallback 1.
 *   - Clamping de semActual a [0, total + 1].
 */
function _materiaParcialHTML(m) {
    const parciales = (m.periodoInfo && Array.isArray(m.periodoInfo.parciales)) ? m.periodoInfo.parciales : [];
    if (!parciales.length) return "";
    const hoy = new Date();
    let p = parciales.find(x => new Date(x.inicio) <= hoy && hoy <= new Date(x.fin));
    if (!p) p = hoy < new Date(parciales[0].inicio) ? parciales[0] : parciales[parciales.length - 1];
    const total = p.semanas || 1;
    const cerrado = hoy > new Date(p.fin);
    const msSemana = 7 * 24 * 60 * 60 * 1000;
    let semActual = cerrado ? total + 1 : Math.floor((hoy - new Date(p.inicio)) / msSemana) + 1;
    semActual = Math.max(0, Math.min(total + 1, semActual));
    const segs = Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        const cls = n < semActual ? " is-done" : n === semActual ? " is-current" : "";
        return `<span class="x-segmented__seg${cls}"></span>`;
    }).join("");
    const etiqueta = cerrado ? "Completado" : semActual === 0 ? "Por iniciar" : `Sem. ${semActual} de ${total}`;
    return `
        <div class="x-materia-card__section">
          <span class="x-label">Parcial ${p.num} — avance</span>
          <div class="x-segmented">
            <span class="x-segmented__label">P${p.num}</span>
            <div class="x-segmented__bar">${segs}</div>
            <span class="x-segmented__count">${etiqueta}</span>
          </div>
        </div>`;
}

// ── Preview de tareas en el Dashboard ────────────────────

/**
 * @interaction build-dash-tareas-preview
 * @scope core-builders-dashboard-alumno
 *
 * Given el dashboard montado con #dash-tareas-preview y APP.user.
 * When init del dashboard invoca, o populateAll legacy.
 * Then construye preview de hasta 4 tareas pendientes próximas del alumno:
 *   - Filtra t.estado === "pendiente".
 *   - Ordena por diasRestantes asc (más urgente primero).
 *   - Renderiza .x-list-row--link clickable que navega a 'tareas-alumno'.
 *   - Chip de estado: "Vencida" (rojo si diasRestantes ≤ 0), "Hoy/mañana"
 *     (amber si ≤ 1), "N d" (amber si ≤ 2), nada (resto).
 *   - Dot color rojo si urgente, info si normal.
 * Edge:
 *   - APP.user.tipo distinto a "estudiante" → limpia innerHTML y retorna.
 *   - getTareasAlumno no cargado → tareas=[] → empty state celebratorio.
 *   - 0 pendientes → "¡Sin tareas pendientes!" con icono 🎉.
 *   - >4 pendientes → slice(0,4); resto visible en vista tareas.
 *   - Deuda: respeta prórroga vía t.estado (data-provider usa
 *     effectiveDueDate del slice prórrogas-polish).
 *   - Deuda XSS pre-Supabase: t.titulo + t.materia sin escape.
 */
function buildDashTareasPreview() {
    const el = document.getElementById("dash-tareas-preview");
    if (!el) return;
    if (APP.user?.tipo !== "estudiante") { el.innerHTML = ""; return; }

    const tareas = typeof getTareasAlumno === "function" ? getTareasAlumno(APP.user.id) : [];
    const proximas = tareas
        .filter(t => t.estado === "pendiente")
        .sort((a, b) => a.diasRestantes - b.diasRestantes)
        .slice(0, 4);

    if (!proximas.length) {
        el.innerHTML = `<div class="x-empty"><div class="x-empty__icon">🎉</div><div class="x-empty__title">¡Sin tareas pendientes!</div></div>`;
        return;
    }
    el.innerHTML = proximas.map(t => {
        const urgente = t.diasRestantes <= 2;
        const vencida = t.diasRestantes <= 0;
        const chip = vencida
            ? `<span class="x-chip x-chip--danger">Vencida</span>`
            : urgente
            ? `<span class="x-chip x-chip--warn">${t.diasRestantes <= 1 ? "Hoy/mañana" : `${t.diasRestantes} d`}</span>`
            : "";
        return `
        <div class="x-list-row x-list-row--link" onclick="showView('tareas-alumno')">
          <span class="x-list-row__dot" style="background:${urgente ? "var(--state-danger)" : "var(--state-info)"}"></span>
          <div class="x-list-row__body">
            <div class="x-list-row__title">${t.titulo}</div>
            <div class="x-list-row__meta">${t.materia}</div>
          </div>
          ${chip ? `<div class="x-list-row__trail">${chip}</div>` : ""}
        </div>`;
    }).join("");
}

// Paleta canónica de criterios (compartida entre la vista Escala y la
// barra de escala de las cards de Gestión).
const _ESCALA_COLORS = [
    "var(--xahni-blue-light)",
    "var(--xahni-teal)",
    "var(--xahni-purple-light)",
    "var(--xahni-cyan)",
    "var(--xahni-green)",
    "var(--xahni-amber)",
    "var(--xahni-red)",
    "var(--xahni-magenta)",
];
/**
 * @interaction escala-color-var
 * @scope core-builders-escala-helper-canonical
 *
 * Given un índice numérico.
 * When un caller renderea criterios de escala y necesita color rotativo
 *   para cada criterio.
 * Then retorna el color en _ESCALA_COLORS[idx % length] (paleta de 8 tokens
 *   var(--xahni-*)). Garantiza determinismo: mismo idx siempre mismo color
 *   cross-vista (escala profesor + barra gestión consistentes).
 * Edge idx negativo → JS modulo retorna negativo; documentado caller
 *   normaliza con Math.abs si aplica. _ESCALA_COLORS const en mismo archivo.
 */
function _escalaColorVar(idx) { return _ESCALA_COLORS[idx % _ESCALA_COLORS.length]; }

// Helper compartido: barra visual de escala. Reutiliza las clases CSS
// existentes (.escala-bar-overflow-wrap/.escala-bar-base/.escala-bar-segment/
// .escala-bar-100-mark/.escala-bar-seg-label/.escala-bar-seg-pct/
// .escala-bar-extra-badge) de css/profesor/escala.css.
//
//   esc  = { criterios: [{ id, nombre, pct, extra, ... }] }
//   opts = { progreso?: [{ criterioId, ratio }], compact?: boolean }
//
// Si opts.progreso está presente, cada segmento muestra un relleno
// saturado representando el ratio (0..1) que el alumno obtuvo, y la
// etiqueta lleva "obtenido/pct" en vez de "pct%".
//
// Cambio visual vs vista Escala original: los criterios extra YA NO se
// envuelven en una zona dashed naranja; cada extra es un segmento más
// pegado tras el 100%-mark, con pill EXTRA y micro-tinte ámbar inline.
/**
 * @interaction escala-bar-html
 * @scope core-builders-escala-render-bar-canonical
 *
 * Given un objeto esc con criterios[] (cada uno con {id, nombre, pct, extra,
 *   colorIdx?}) y opts opcional {progreso?: [{criterioId, ratio}], compact?:
 *   boolean}.
 * When un caller renderea la barra de escala canonical (vista Escala profesor
 *   o card Gestión o miniperfil alumno).
 * Then construye .escala-bar-overflow-wrap con:
 *   - Segmentos para criterios base (pct sumando ~100) en .escala-bar-base.
 *   - 100%-mark separador (sólido en compact, con label flotante en full).
 *   - Segmentos extras (pct >100) en zona derecha (NO dashed orange envolvente,
 *     decisión visual cementada: cada extra es un segmento más con badge
 *     EXTRA + tinte ámbar inline, o coloreado dorado completo en modo
 *     progreso para distinguir del color del criterio).
 *   - Reparto flex: base 65-75%, extras 25-35% (clamping para evitar
 *     extras aplastados).
 *   - opts.progreso: cada segmento muestra fill saturado con ratio + label
 *     "obtenido%/pct%" (color blanco con text-shadow para legibilidad
 *     dark+light).
 *   - opts.compact: barra más baja (38px min-height), labels más chicos,
 *     100%-mark sin label flotante.
 * Edge:
 *   - esc.criterios vacío o esc null → empty state con icono 📋 + texto
 *     "Sin criterios definidos para este parcial".
 *   - colorIdx missing → fallback al index del criterio en esc.criterios.
 *   - LABEL_MIN: pct < umbral (12 normal, 9 compact) → omite label (solo
 *     pct visible), tooltip title= conserva info.
 *   - Sin extras → renderiza solo base sin marker ni zona derecha.
 *   - ratio fuera de [0,1] → clamped.
 *   - useGoldExtra (progreso + extra): badge EXTRA oculto (color dorado
 *     ya comunica), label/value sizes reducidos, padding compactado.
 *   - Deuda XSS: c.nombre se inyecta sin escape (controlado al ser
 *     escala definida por profesor; post-Supabase requerirá escape).
 */
function _escalaBarHTML(esc, opts) {
    opts = opts || {};
    if (!esc || !Array.isArray(esc.criterios) || !esc.criterios.length) {
        return `<div class="escala-bar-empty"><div style="font-size:20px;margin-bottom:6px">📋</div><div style="font-size:13px;color:var(--text-muted)">Sin criterios definidos para este parcial</div></div>`;
    }
    const base   = esc.criterios.filter(c => !c.extra);
    const extras = esc.criterios.filter(c =>  c.extra);
    const baseTotal  = base.reduce((s, c) => s + (c.pct || 0), 0) || 100;
    const extraTotal = extras.reduce((s, c) => s + (c.pct || 0), 0);
    // Modo compact: barra más baja (miniperfil / cards de gestión).
    const compact  = !!opts.compact;
    const wrapStyle = compact ? "min-height:38px" : "";
    const segPad    = compact ? "3px 4px" : "4px 6px";
    // Umbral más bajo para mostrar label cuando hay muchos criterios (más segmentos angostos).
    const LABEL_MIN = compact ? 9 : 12;

    const ratioOf = (c) => {
        if (!opts.progreso) return null;
        const p = opts.progreso.find(x => x.criterioId === c.id);
        if (!p) return 0;
        return Math.max(0, Math.min(1, p.ratio == null ? 0 : p.ratio));
    };

    const inProgress = opts.progreso != null;
    const segHTML = (c, _idx, baseDenom) => {
        // En la barra personal del alumno (modo progreso), los extras se
        // visten en DORADO en vez de su color de paleta → así son los únicos
        // segmentos dorados de la barra y se distinguen sin necesidad del
        // badge EXTRA. Además se les reduce ligeramente el tamaño visual.
        const useGoldExtra = inProgress && c.extra;
        const color = useGoldExtra ? "var(--xahni-amber)" : _escalaColorVar(Number.isInteger(c.colorIdx) ? c.colorIdx : esc.criterios.indexOf(c));
        const flexW = baseDenom ? (c.pct / baseDenom) * 100 : 0;
        const ratio = ratioOf(c);
        const obtenido = ratio == null ? null : Math.round(c.pct * ratio);
        const labelSize = useGoldExtra ? (compact ? "8px" : "9px") : (compact ? "9px" : "10px");
        const valueSize = useGoldExtra ? (compact ? "10px" : "11px") : (compact ? "11px" : "13px");
        const segPadding = useGoldExtra ? (compact ? "2px 3px" : "3px 5px") : segPad;
        const label = c.pct >= LABEL_MIN
            ? `<div class="escala-bar-seg-label" style="color:${color};font-size:${labelSize};max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.nombre}</div>`
            : "";
        // text-shadow sobre el número obtenido para mantener legibilidad
        // tanto en dark (fill semi-transparente sobre fondo oscuro) como en
        // light (fill saturado sobre fondo claro) — sin depender del color.
        const valueEl = ratio == null
            ? `<div class="escala-bar-seg-pct" style="color:${color};font-size:${valueSize}">${c.pct}%</div>`
            : `<div class="escala-bar-seg-pct" style="color:${color};font-size:${valueSize}"><span style="color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.55)">${obtenido}%</span><span style="opacity:.5">/${c.pct}%</span></div>`;
        const fillHTML = ratio == null ? "" : `<div style="position:absolute;top:0;left:0;bottom:0;width:${ratio * 100}%;background:${color};opacity:.55;pointer-events:none"></div>`;
        // Tinte dashed ámbar solo cuando NO vamos en modo dorado (redundante si todo el segmento ya es ámbar).
        const extraTint = (c.extra && !useGoldExtra) ? `;background-image:linear-gradient(135deg,transparent 60%,var(--xahni-amber-dim))` : "";
        // Badge EXTRA solo cuando NO vamos en modo dorado (el color dorado ya comunica "extra").
        const showBadge = c.extra && !useGoldExtra;
        return `<div class="escala-bar-segment" style="flex:${flexW} 1 0;min-width:0;border-color:${color};background:${color}18${extraTint};padding:${segPadding};position:relative;overflow:hidden" title="${c.nombre}: ${c.pct}%${ratio != null ? ` · alumno ${Math.round(ratio*100)}%` : ""}">
            ${fillHTML}
            <div style="position:relative;display:flex;flex-direction:column;align-items:center;gap:1px;width:100%;min-width:0">${label}${valueEl}</div>
            ${showBadge ? `<div class="escala-bar-extra-badge" style="background:var(--xahni-amber);color:#fff">EXTRA</div>` : ""}
        </div>`;
    };

    const baseSegs = base.map((c, i) => segHTML(c, i, baseTotal)).join("");
    if (!extras.length) {
        return `<div class="escala-bar-overflow-wrap" style="${wrapStyle}">
            <div class="escala-bar-base" style="flex:1;border-right:1px solid var(--border);border-radius:var(--r-md);min-width:0">${baseSegs}</div>
        </div>`;
    }
    // Reparto base/extras: clamp entre [65%, 75%] para garantizar que la
    // base siga siendo legible (≥65%) pero los extras también tengan ancho
    // mínimo suficiente (≥25%) — sin ese tope superior un extra del 10%
    // se ve aplastado (~9% del bar) y la pill EXTRA + texto se cortan.
    const totalCap = 100 + extraTotal;
    let baseFrac = (100 / totalCap) * 100;
    if (baseFrac > 75) baseFrac = 75;
    if (baseFrac < 65) baseFrac = 65;
    const extraFrac = 100 - baseFrac;
    const extraSegs = extras.map((c, i) => segHTML(c, i, extraTotal)).join("");
    // En compact, el span del "100%" se solapa con el header de arriba
    // (su `top:-18px` lo empuja fuera de la barra). En ese modo, conservamos
    // la línea vertical como separador pero ocultamos el label flotante.
    const markHTML = compact
        ? `<div class="escala-bar-100-mark" title="100%"></div>`
        : `<div class="escala-bar-100-mark"><span>100%</span></div>`;
    // Usar `flex:${frac} 1 0` (no `0 0 ${frac}%`) para que base y extras
    // compartan el espacio proporcionalmente, absorbiendo los 2px del
    // separador sin overflow horizontal.
    return `<div class="escala-bar-overflow-wrap" style="${wrapStyle}">
        <div class="escala-bar-base" style="flex:${baseFrac} 1 0;min-width:0">${baseSegs}</div>
        ${markHTML}
        <div style="flex:${extraFrac} 1 0;display:flex;gap:2px;border-radius:0 var(--r-md) var(--r-md) 0;overflow:hidden;border:1px solid var(--border);border-left:none;min-width:0">${extraSegs}</div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════
// SLICE G B.1 · Render helpers para tab Maestría
// ═══════════════════════════════════════════════════════════

// Watermark vertical del header (texto decorativo right rail).
/**
 * @interaction get-disciplina-watermark
 * @scope core-builders-maestria-catalog-watermark
 *
 * Given disciplinaId + nivel (1-7).
 * When un caller renderea el header del tab Maestría y necesita texto
 *   decorativo "MASTERY · TIER {roman} · {DISC}" para el right rail.
 * Then convierte nivel a roman (I-VII clamped a 0-6 idx) y disc a uppercase.
 * Edge:
 *   - nivel null → "I".
 *   - nivel > 7 → "VII" (clamped).
 *   - disciplinaId null → "BD" (default).
 */
function _getDisciplinaWatermark(disciplinaId, nivel) {
    const disc = (disciplinaId || "bd").toUpperCase();
    const tierRoman = ["I", "II", "III", "IV", "V", "VI", "VII"][Math.max(0, Math.min(6, (nivel || 1) - 1))];
    return `MASTERY · TIER ${tierRoman} · ${disc}`;
}

// Header del tab Maestría · emblem 140px + score grande + barra de progreso + hint contextual.
// progress: porcentaje hacia siguiente nivel (calculado a partir de mastery.points y curva fija).
/**
 * @interaction render-maestria-tab-header
 * @scope core-builders-maestria-tab-render-header
 *
 * Given role ("estudiante"|"profesor"), materia (con codigo/nombre/prof/
 *   periodoTexto/cuatrisCursados), mastery state, disciplinaId.
 * When un caller construye el tab Maestría (vista detalle de una materia
 *   con su progresión LoL-style).
 * Then renderiza <header.b1-ma-tab-header> con:
 *   - Emblema 140px (delegado a _renderMaestriaEmblem).
 *   - Overline contextual:
 *     - profesor: "{codigo} · LIFETIME · {N} CUATRIS"
 *     - alumno: "{codigo} · {periodoTexto|ESTE CUATRI} · PROF. {APELLIDO}"
 *   - Title H2 con nombre de materia + " · Nivel N".
 *   - Score big number + "puntos".
 *   - Barra progreso .x-progress con aria-valuenow=pct hacia siguiente
 *     nivel. Curva thresholds [0,100,250,500,800,1200,1500,1500].
 *   - Hint contextual:
 *     - nivel 7 → "Maestría completa".
 *     - nivel 5-6 → "Faltan X puntos y N tokens".
 *     - nivel 1-4 → "Faltan X puntos para Mastery N+1".
 *   - data-watermark con disciplina + tier roman para CSS pseudo-element.
 * Edge:
 *   - materia.nombre null → "esta materia".
 *   - profesor sin cuatrisCursados → "—".
 *   - prof null → omite "PROF." (alumno).
 *   - nivel >= 7 → pct=100, faltan=0, hint variante completada.
 *   - Curva thresholds vanilla hardcoded; deuda post-Supabase.
 */
function _renderMaestriaTabHeader(role, materia, mastery, disciplinaId) {
    const nivel = mastery.nivel || 1;
    const points = mastery.points || 0;
    // Curva de thresholds points por nivel (vanilla hardcoded; Supabase lo
    // calculará server-side post-migración).
    const thresholds = [0, 100, 250, 500, 800, 1200, 1500, 1500];
    const curBase = thresholds[Math.max(0, nivel - 1)];
    const nextThr = thresholds[Math.min(7, nivel)];
    const span = Math.max(1, nextThr - curBase);
    const into = Math.max(0, points - curBase);
    const pct = nivel >= 7 ? 100 : Math.min(100, Math.round((points / nextThr) * 100));
    const faltan = nivel >= 7 ? 0 : Math.max(0, nextThr - points);

    const overline = (() => {
        const codigo = (materia.codigo || (materia.id || "").toUpperCase());
        if (role === "profesor") {
            const cuatris = (materia.cuatrisCursadosCount != null)
                ? materia.cuatrisCursadosCount
                : (Array.isArray(mastery.cuatrisCursados) ? mastery.cuatrisCursados.length : "—");
            return `${codigo} · LIFETIME · ${cuatris} CUATRIS`;
        }
        const profTxt = materia.prof ? ("PROF. " + String(materia.prof).split(" ").pop().toUpperCase()) : "";
        return [codigo, materia.periodoTexto || "ESTE CUATRI", profTxt].filter(Boolean).join(" · ");
    })();

    const hint = (() => {
        if (nivel >= 7) return `<strong>Maestría completa</strong> · Nivel 7 alcanzado`;
        if (nivel >= 5) {
            const needTokens = nivel === 5 ? 1 : 3;
            const haveTokens = Math.min((mastery.tokensGanados || []).length, needTokens);
            const tokensOk = haveTokens >= needTokens;
            const ptsTxt = `<strong>${faltan} puntos</strong>`;
            const tokensTxt = tokensOk ? `tokens ✓` : `<strong>${needTokens - haveTokens} tokens</strong>`;
            return `Faltan ${ptsTxt} y ${tokensTxt} para alcanzar Mastery ${nivel + 1}`;
        }
        return `Faltan <strong>${faltan} puntos</strong> para alcanzar Mastery ${nivel + 1}`;
    })();

    const emblem = _renderMaestriaEmblem(disciplinaId, _getDisciplinaGlyph(disciplinaId), nivel, materia.nombre);
    const watermark = _getDisciplinaWatermark(disciplinaId, nivel);

    return `
        <header class="b1-ma-tab-header" data-watermark="${watermark}">
          ${emblem}
          <div class="b1-ma-tab-header__text">
            <span class="b1-ma-tab-header__overline">${overline}</span>
            <h2 class="b1-ma-tab-header__title">
              Maestría de ${materia.nombre || "esta materia"} <em>· Nivel ${nivel}</em>
            </h2>
            <div class="b1-ma-tab-header__score">
              <span class="b1-ma-tab-header__score-num">${points.toLocaleString()}</span>
              <span class="b1-ma-tab-header__score-unit">puntos</span>
            </div>
            <div class="x-progress b1-ma-tab-header__progress" role="progressbar"
                 aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
              <div class="x-progress__bar" style="width:${pct}%"></div>
            </div>
            <p class="b1-ma-tab-header__hint">${hint}</p>
          </div>
        </header>`;
}

// Grid 4-col de los 8 mastery tokens. Earned con chip "Ganado" + timestamp;
// locked con disparador como hint en chip muted.
/**
 * @interaction render-maestria-tab-tokens-grid
 * @scope core-builders-maestria-tab-render-tokens-grid
 *
 * Given mastery state con tokensGanados + tokensTimeline.
 * When el tab Maestría renderea la sección de tokens (grid 4×2 con los 8
 *   mastery tokens).
 * Then construye <section.x-card> con:
 *   - Header con icono medal + "Mastery Tokens" + chip "N / 8 ganados".
 *   - Grid .b1-ma-tab-tokens-grid con 8 cards en orden fijo (honor,
 *     p1_asistencia, maratonista, p2_asistencia, p3_asistencia,
 *     proyecto_destacado, parcial_perfecto, campeon).
 *   - Cada card: glyph + nombre + chip (earned: verde con ✓; locked:
 *     muted con disparador).
 *   - Earned con timestamp del timeline si disponible.
 *   - Footer dinámico según nivel:
 *     - nivel 7 → "Mastery 7 alcanzado. N de 8 tokens conseguidos lifetime".
 *     - nivel 5-6 OK → "✓ Cumples requisito de tokens".
 *     - resto → "Te faltan N tokens distintos".
 * Edge:
 *   - Orden fijo de 8 tokens; cambios al catálogo NO reordenan visualmente.
 *   - tokensGanados vacío → todos locked, footer con count 0.
 *   - tokensTimeline vacío → earned sin timestamp.
 *   - Token NO en catálogo (futuro id) → omite la card (sin error).
 *   - Deuda XSS: t.nombre/t.disparador controlados del catálogo, no aplica.
 */
function _renderMaestriaTabTokensGrid(mastery) {
    const catalog = _getMasteryTokenCatalog();
    const ganados = new Set(mastery.tokensGanados || []);
    const timeline = mastery.tokensTimeline || [];
    // Mapa tokenId → "when" texto desde timeline (último evento de ese token)
    const whenMap = {};
    timeline.forEach(ev => {
        if (ev.type === "token" && !whenMap[ev.id]) whenMap[ev.id] = ev.when;
    });
    const orden = ["honor", "p1_asistencia", "maratonista", "p2_asistencia", "p3_asistencia", "proyecto_destacado", "parcial_perfecto", "campeon"];
    const itemsHtml = orden.map(id => {
        const t = catalog[id];
        if (!t) return "";
        const isEarned = ganados.has(id);
        const cls = isEarned ? "b1-ma-tab-token--earned" : "b1-ma-tab-token--locked";
        const chipHtml = isEarned
            ? `<span class="x-chip x-chip--ok"><svg class="x-icon x-icon--sm" aria-hidden="true"><use href="#x-icon-check"/></svg> Ganado</span>`
            : `<span class="x-chip x-chip--muted">${t.disparador}</span>`;
        const metaHtml = isEarned && whenMap[id]
            ? `<span class="b1-ma-tab-token__meta">${whenMap[id]}</span>`
            : "";
        return `
            <article class="b1-ma-tab-token ${cls}">
              <span class="b1-ma-tab-token__glyph" aria-hidden="true">${t.glyph}</span>
              <span class="b1-ma-tab-token__name">${t.nombre}</span>
              ${chipHtml}
              ${metaHtml}
            </article>`;
    }).join("");

    const totalGanados = orden.filter(id => ganados.has(id)).length;
    const nivel = mastery.nivel || 1;
    const totalNeed = nivel >= 6 ? 3 : (nivel === 5 ? 1 : 3);
    const footTxt = (() => {
        if (nivel >= 7) {
            return `<strong>Mastery 7 alcanzado.</strong> ${totalGanados} de 8 tokens conseguidos lifetime.`;
        }
        const haveCount = Math.min(totalGanados, totalNeed);
        if (haveCount >= totalNeed) {
            return `<strong>${haveCount}/${totalNeed} tokens hacia Mastery ${nivel + 1} ✓</strong> — Cumples requisito de tokens.`;
        }
        return `<strong>${haveCount}/${totalNeed} tokens hacia Mastery ${nivel + 1}</strong> — Te faltan <strong>${totalNeed - haveCount}</strong> token${(totalNeed - haveCount) === 1 ? "" : "s"} distinto${(totalNeed - haveCount) === 1 ? "" : "s"}.`;
    })();

    return `
        <section class="x-card">
          <header class="x-card-title">
            <svg class="x-icon x-icon--md" aria-hidden="true"><use href="#x-icon-medal"/></svg>
            <span>Mastery Tokens</span>
            <span class="x-chip x-chip--ok" style="margin-left:auto">
              <svg class="x-icon x-icon--sm" aria-hidden="true"><use href="#x-icon-check"/></svg>
              ${totalGanados} / 8 ganados
            </span>
          </header>
          <div class="b1-ma-tab-tokens-grid">${itemsHtml}</div>
          <p class="b1-ma-tab-tokens-foot">${footTxt}</p>
        </section>`;
}

// Timeline histórico. Dots con tipos: ok (nivel), cyan (cosmetic marco),
// amber (cosmetic frase/título), danger (token), muted (default).
/**
 * @interaction render-maestria-tab-timeline
 * @scope core-builders-maestria-tab-render-timeline
 *
 * Given role + materia + mastery con tokensTimeline + (profesor)
 *   cuatrisCursados[].
 * When tab Maestría renderea la sección de histórico.
 * Then construye <section.x-card> con <ol.b1-ma-tab-timeline> listando
 *   eventos cronológicos:
 *   - Dot color/icon según ev.type:
 *     - "nivel" → ok verde + check-circle
 *     - "cosmetic" → cyan (marco) | amber (frase/título) | muted (otro)
 *     - "token" → amber + flame
 *     - "cuatri" → muted + calendar
 *   - Texto del evento + timestamp <time>.
 *   - Para profesor: convierte cuatrisCursados a eventos "cuatri" e
 *     intercala al final (asume orden descendente).
 * Edge:
 *   - timeline vacío Y (no profesor O sin cuatrisCursados) → "" (sin sección).
 *   - Profesor con cuatrisCursados pero sin tokensTimeline → renderiza
 *     solo cuatris.
 *   - Deuda XSS: ev.label/ev.when desde DEMO_MAESTRIA controlado, no aplica.
 */
function _renderMaestriaTabTimeline(role, materia, mastery) {
    const timeline = mastery.tokensTimeline || [];
    if (!timeline.length && !(role === "profesor" && Array.isArray(mastery.cuatrisCursados) && mastery.cuatrisCursados.length)) {
        return ""; // no histórico aún
    }

    const dotCls = (ev) => {
        if (ev.type === "nivel") return "b1-ma-tab-timeline__dot--ok";
        if (ev.type === "cosmetic") {
            if (/marco/i.test(ev.id)) return "b1-ma-tab-timeline__dot--cyan";
            if (/frase|titulo/i.test(ev.id)) return "b1-ma-tab-timeline__dot--amber";
            return "b1-ma-tab-timeline__dot--muted";
        }
        if (ev.type === "token") return "b1-ma-tab-timeline__dot--amber";
        if (ev.type === "cuatri") return "b1-ma-tab-timeline__dot--muted";
        return "b1-ma-tab-timeline__dot--muted";
    };
    const dotIcon = (ev) => {
        if (ev.type === "nivel") return "#x-icon-check-circle";
        if (ev.type === "cosmetic") {
            if (/marco/i.test(ev.id)) return "#x-icon-sparkle";
            return "#x-icon-medal";
        }
        if (ev.type === "token") return "#x-icon-flame";
        if (ev.type === "cuatri") return "#x-icon-calendar";
        return "#x-icon-target";
    };

    // Para profesor: convertir cuatrisCursados a eventos cuatri e intercalar.
    // Cuatris se asumen ya en orden descendente en el JSON; van al final.
    const cuatriEvents = (role === "profesor" && Array.isArray(mastery.cuatrisCursados))
        ? mastery.cuatrisCursados.map(c => ({
            type: "cuatri",
            id: c.cuatri,
            when: c.label,
            label: `<em>Cuatri ${c.cuatri}</em> cursado`
        }))
        : [];

    const allEvents = timeline.concat(cuatriEvents);

    const itemsHtml = allEvents.map(ev => `
        <li class="b1-ma-tab-timeline__item">
          <span class="b1-ma-tab-timeline__dot ${dotCls(ev)}">
            <svg class="x-icon x-icon--sm" aria-hidden="true"><use href="${dotIcon(ev)}"/></svg>
          </span>
          <span class="b1-ma-tab-timeline__text">${ev.label}</span>
          <time class="b1-ma-tab-timeline__when">${ev.when}</time>
        </li>`).join("");

    return `
        <section class="x-card">
          <header class="x-card-title">
            <svg class="x-icon x-icon--md" aria-hidden="true"><use href="#x-icon-calendar"/></svg>
            <span>Histórico de desbloqueos</span>
          </header>
          <ol class="b1-ma-tab-timeline">${itemsHtml}</ol>
        </section>`;
}

// Unlocks roadmap · cosmetics futuros de la disciplina filtrados por nivel.
/**
 * @interaction render-maestria-tab-unlocks
 * @scope core-builders-maestria-tab-render-unlocks
 *
 * Given disciplinaId + mastery con nivel + cosmeticsDesbloqueados + points.
 * When tab Maestría renderea sección "Próximos desbloqueos" (roadmap de
 *   cosmetics futuros).
 * Then bifurca por nivel:
 *   - nivel 7 → card con mensaje "Mastery completo" + chip ok.
 *   - resto → filtra catálogo:
 *     - Excluye los ya desbloqueados.
 *     - Filtra por disciplina (match en slug del id).
 *     - Filtra nivelRequerido > nivel actual && <= 7.
 *     - Sort asc por nivelRequerido.
 *     Toma primeros 6 cards .b1-ma-tab-unlock con preview type-specific
 *     (titulo/frase: chip; marco: frame avatar; emblema: glyph circle),
 *     label, sub explicativo, chip locked con nivel.
 *     Footer: barra progreso hacia Mastery 7 con texto "Te faltan N
 *     puntos más" (o "Cumples threshold" si points >= 1500).
 * Edge:
 *   - cosmeticsDesbloqueados vacío → todos los del catálogo son candidatos.
 *   - Sin futuros (catálogo agotado para disciplina) → mensaje "No hay más
 *     cosmetics catalogados".
 *   - >6 futuros → slice(0,6); resto vive en futuro modal expandido.
 *   - thr7 hardcoded 1500. Deuda post-Supabase: thresholds dinámicos.
 */
function _renderMaestriaTabUnlocks(disciplinaId, mastery) {
    const nivel = mastery.nivel || 1;
    if (nivel >= 7) {
        return `
            <section class="x-card">
              <header class="x-card-title">
                <svg class="x-icon x-icon--md" aria-hidden="true"><use href="#x-icon-crown"/></svg>
                <span>Próximos desbloqueos</span>
                <span class="x-chip x-chip--ok" style="margin-left:auto">
                  <svg class="x-icon x-icon--sm" aria-hidden="true"><use href="#x-icon-check"/></svg>
                  Mastery completo
                </span>
              </header>
              <p style="margin:0;color:var(--text-secondary);font-size:var(--text-size-sm);line-height:1.55">
                Has alcanzado el nivel máximo de maestría en esta disciplina. Todos los cosmetics están desbloqueados — equípalos en Mi perfil.
              </p>
            </section>`;
    }

    const catalog = _getCosmeticsCatalog();
    const desbloqueados = new Set(mastery.cosmeticsDesbloqueados || []);
    // Filtrar por disciplina (cosmetic id contiene el slug de disciplina).
    const discSlug = String(disciplinaId || "bd").toLowerCase();
    const futuros = Object.keys(catalog)
        .filter(id => !desbloqueados.has(id))
        .filter(id => id.endsWith(`_${discSlug}`) || id.includes(`_${discSlug}_`))
        .filter(id => catalog[id].nivelRequerido > nivel && catalog[id].nivelRequerido <= 7)
        .sort((a, b) => catalog[a].nivelRequerido - catalog[b].nivelRequerido);

    if (!futuros.length) {
        return `
            <section class="x-card">
              <header class="x-card-title">
                <svg class="x-icon x-icon--md" aria-hidden="true"><use href="#x-icon-crown"/></svg>
                <span>Próximos desbloqueos</span>
              </header>
              <p style="margin:0;color:var(--text-secondary);font-size:var(--text-size-sm);line-height:1.55">
                No hay más cosmetics catalogados para esta disciplina aún. Más assets llegan en la próxima ola.
              </p>
            </section>`;
    }

    const previewHtml = (c) => {
        if (c.tipo === "titulo" || c.tipo === "frase") {
            return `<span class="b1-ma-tab-unlock__preview b1-ma-tab-unlock__preview--chip">${c.preview}</span>`;
        }
        if (c.tipo === "marco") {
            return `<span class="b1-ma-tab-unlock__preview b1-ma-tab-unlock__preview--frame" aria-hidden="true">
                      <span class="b1-ma-tab-unlock__face">${c.preview}</span>
                    </span>`;
        }
        // emblema u otro
        return `<span class="b1-ma-tab-unlock__preview" aria-hidden="true">${c.preview}</span>`;
    };

    const itemsHtml = futuros.slice(0, 6).map(id => {
        const c = catalog[id];
        return `
            <article class="b1-ma-tab-unlock">
              ${previewHtml(c)}
              <span class="b1-ma-tab-unlock__label">${c.label}</span>
              <p class="b1-ma-tab-unlock__sub">${c.sub}</p>
              <span class="x-chip x-chip--muted">
                <svg class="x-icon x-icon--sm" aria-hidden="true"><use href="#x-icon-lock"/></svg>
                Nivel ${c.nivelRequerido}
              </span>
            </article>`;
    }).join("");

    // Foot · barra de progreso a Mastery 7 + meta de puntos.
    const points = mastery.points || 0;
    const thr7 = 1500;
    const pct = Math.min(100, Math.round((points / thr7) * 100));
    const faltan = Math.max(0, thr7 - points);
    const footTxt = faltan > 0
        ? `Te faltan <strong>${faltan} puntos más</strong> (${points.toLocaleString()} / ${thr7.toLocaleString()}) para alcanzar Mastery 7. Sigue acumulando excelencia, compromiso y completitud.`
        : `Cumples el threshold de puntos para Mastery 7. Asegura tokens y cosmetics restantes.`;

    return `
        <section class="x-card">
          <header class="x-card-title">
            <svg class="x-icon x-icon--md" aria-hidden="true"><use href="#x-icon-crown"/></svg>
            <span>Próximos desbloqueos</span>
            <span class="x-chip x-chip--muted" style="margin-left:auto">
              <svg class="x-icon x-icon--sm" aria-hidden="true"><use href="#x-icon-lock"/></svg>
              Bloqueado
            </span>
          </header>
          <div class="b1-ma-tab-unlocks">${itemsHtml}</div>
          <div class="b1-ma-tab-unlocks-foot">
            <p class="b1-ma-tab-unlocks-foot__text">${footTxt}</p>
            <div class="b1-ma-tab-unlocks-foot__bar">
              <div class="x-progress" role="progressbar"
                   aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
                <div class="x-progress__bar" style="width:${pct}%"></div>
              </div>
              <span class="b1-ma-tab-unlocks-foot__bar-meta">${points.toLocaleString()} / ${thr7.toLocaleString()} pts</span>
            </div>
          </div>
        </section>`;
}

// Orquestador del contenido completo del tab Maestría.
// uid: usuario actual; materia: objeto materia con al menos {id, nombre, codigo?, prof?};
// role: "alumno" | "profesor" (decide overline y trigger cuatrisCursados).
/**
 * @interaction render-maestria-tab-content
 * @scope core-builders-maestria-tab-render-content-orchestrator
 *
 * Given uid + materia (al menos {id, nombre, codigo?, prof?}) + role
 *   ("alumno"|"profesor").
 * When un caller (hub-materia tab Maestría) renderea el contenido completo.
 * Then orquesta 4 sub-renders en cadena:
 *   1. _renderMaestriaTabHeader(role, materia, mastery, disciplinaId).
 *   2. _renderMaestriaTabTokensGrid(mastery).
 *   3. _renderMaestriaTabTimeline(role, materia, mastery).
 *   4. _renderMaestriaTabUnlocks(disciplinaId, mastery).
 *   Wrapper .b1-ma-tab con data-disciplina + data-rol + data-gamer="on"
 *   (Slice F/G pattern; Slice E lo hará dinámico cuando aterrice gamer-off).
 * Edge:
 *   - materia null o sin id → empty state simple "No hay materia activa".
 *   - mastery se hidrata vía _getMaestriaDe (fallback a defaults nivel 1).
 *   - disciplinaId derivada de _getDisciplinaId (mapping vanilla).
 *   - Sub-renders pueden retornar "" (timeline sin eventos, unlocks
 *     completos) — la card padre sigue válida.
 */
function _renderMaestriaTabContent(uid, materia, role) {
    if (!materia || !materia.id) {
        return `<div class="x-card"><p style="margin:0;color:var(--text-muted);font-size:var(--text-size-sm)">No hay materia activa.</p></div>`;
    }
    const disciplinaId = _getDisciplinaId(materia.id);
    const mastery = _getMaestriaDe(uid, materia.id);

    // data-gamer="on" cementa el modo gamer-on default per Slice F/G pattern.
    // Habilita reglas [data-gamer="on"] .b1-ma-tab-token--earned:hover, etc.
    // Slice E lo hará dinámico cuando aterrice el suavizado gamer-off.
    return `
        <div class="b1-ma-tab" data-disciplina="${disciplinaId}" data-rol="${role}" data-gamer="on">
          ${_renderMaestriaTabHeader(role, materia, mastery, disciplinaId)}
          ${_renderMaestriaTabTokensGrid(mastery)}
          ${_renderMaestriaTabTimeline(role, materia, mastery)}
          ${_renderMaestriaTabUnlocks(disciplinaId, mastery)}
        </div>`;
}

// ═══════════════════════════════════════════════════════════
// SLICE H1 B.1 · Navegación cross-tab Mi perfil → Maestría
// ═══════════════════════════════════════════════════════════

/**
 * @interaction navigate-to-maestria-tab
 * @scope global-window
 *
 * Given: alumno en cualquier vista del hub raíz (típicamente Mi perfil)
 * When:  click en un slot del widget "Maestrías destacadas"
 * Then:  switchea hub-shell-tab a "materias", abre hub-materia para la
 *        materia indicada vía hubAbrirMateria, y activa el tab interno
 *        "maestria" vía hubSwitchTab
 * Edge:
 *   - materiaNombre falsy → no-op silencioso
 *   - APP.user.tipo !== "estudiante" → no-op (widget solo se ve por alumno)
 *   - hubShellSwitchTab / hubAbrirMateria / hubSwitchTab ausentes → no-op
 */
function _navigateToMaestriaTab(materiaNombre) {
    if (!materiaNombre) return;
    if (typeof APP !== "undefined" && APP.user && APP.user.tipo !== "estudiante") return;

    // Paso 1 · switchear hub-shell-tab a "materias"
    // (revela el panel materias). El switch tiene side-effects async sobre
    // DEMO_MATERIAS / lista de cards. Los pasos 2 y 3 se desfasan con
    // setTimeout 50ms cada uno — testeado empíricamente. Con setTimeout 0
    // hubAbrirMateria veía estado intermedio y caía a stub sin id.
    const materiasTab = document.querySelector("#screen-hub .hub-shell-tab[data-tab='materias']");
    if (materiasTab && typeof materiasTab.click === "function") {
        materiasTab.click();
    }

    // Paso 2 · abrir hub-materia para la materia indicada (tras 50ms)
    setTimeout(() => {
        if (typeof hubAbrirMateria === "function") {
            hubAbrirMateria(materiaNombre);
        }
        // Paso 3 · activar tab interno "maestria" tras pintar el detalle
        setTimeout(() => {
            const maestriaTab = document.querySelector("#hub-detalle-panel .hub-tab[data-tab='maestria']");
            if (maestriaTab && typeof hubSwitchTab === "function") {
                hubSwitchTab("maestria", maestriaTab);
            }
        }, 50);
    }, 50);
}
window.navigateToMaestriaTab = _navigateToMaestriaTab;

// Helper interno · resolver nombre de materia desde su id usando DEMO_MATERIAS.
// Fallback: si no se encuentra, usar el id como nombre (defensa).
/**
 * @interaction resolve-materia-nombre
 * @scope core-builders-maestria-helper-internal
 *
 * Given un materiaId (string).
 * When un caller necesita el nombre legible de la materia desde su id.
 * Then busca en DEMO_MATERIAS y retorna m.nombre si encuentra; sino
 *   el id literal como fallback de defensa.
 * Edge:
 *   - DEMO_MATERIAS no cargado o no array → retorna id.
 *   - Materia sin nombre (m.nombre falsy) → retorna id.
 *   - Deuda post-Supabase: query materias.nombre directo.
 */
function _resolveMateriaNombre(materiaId) {
    if (typeof DEMO_MATERIAS === "undefined" || !Array.isArray(DEMO_MATERIAS)) return materiaId;
    const m = DEMO_MATERIAS.find(x => x.id === materiaId);
    return (m && m.nombre) ? m.nombre : materiaId;
}

/**
 * @interaction get-curated-top3-maestria
 * @scope shared
 *
 * Given: uid del alumno
 * When:  el widget H1 o el selector necesitan resolver el Top 3 actual
 * Then:  retorna array de materiaIds en orden de display leyendo
 *        cascada: (1) localStorage xahni_top3_maestria_${uid} si existe
 *        y es array no vacío; (2) DEMO_TOP3_MAESTRIA[uid] del JSON seed
 *        si existe; (3) fallback auto: Object.entries(DEMO_MAESTRIA[uid])
 *        filter points>0 sort desc slice 3 map id. Slice futuro Supabase
 *        reemplaza la cascada por una sola query a user_curated_top3.
 * Edge:
 *   - uid falsy → []
 *   - DEMO_MAESTRIA[uid] absent y sin curaduría → []
 */
function _getCuratedTop3Maestria(uid) {
    if (!uid) return [];
    // (1) localStorage override
    try {
        const raw = localStorage.getItem(`xahni_top3_maestria_${uid}`);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed.slice(0, 3);
            }
        }
    } catch (_) { /* localStorage puede fallar; continuar cascada */ }
    // (2) JSON seed DEMO_TOP3_MAESTRIA
    if (typeof DEMO_TOP3_MAESTRIA === "object" && DEMO_TOP3_MAESTRIA && Array.isArray(DEMO_TOP3_MAESTRIA[uid])) {
        return DEMO_TOP3_MAESTRIA[uid].slice(0, 3);
    }
    // (3) Fallback auto: Top 3 por points
    if (typeof DEMO_MAESTRIA === "object" && DEMO_MAESTRIA && DEMO_MAESTRIA[uid]) {
        return Object.entries(DEMO_MAESTRIA[uid])
            .filter(([_, m]) => m && (m.points || 0) > 0)
            .sort((a, b) => (b[1].points || 0) - (a[1].points || 0))
            .slice(0, 3)
            .map(([id]) => id);
    }
    return [];
}

/**
 * @interaction render-maestria-widget
 * @scope shared
 *
 * Given: uid del alumno actual (canonical: APP.user.id; alias permitido: APP.user.uid)
 * When:  Mi perfil del alumno se construye (buildPerfilCompleto) y necesita
 *        pintar el widget "Maestrías destacadas"
 * Then:  retorna el HTML del widget con Top 3 entries de DEMO_MAESTRIA[uid]
 *        sort desc por points, con score strip total agregado, emblemas
 *        reusando _renderMaestriaEmblem 72px (override CSS scoped),
 *        nombre + nivel + points por slot, y foot button "Cambiar selección"
 *        disabled tooltip "Próximamente (Slice H2)"
 * Edge:
 *   - uid falsy → retorna estado vacío
 *   - DEMO_MAESTRIA[uid] no existe → estado vacío
 *   - todas las entries con points 0 → estado vacío
 *   - menos de 3 entries con points > 0 → renderiza las que haya (1 o 2)
 */
function _renderMaestriaWidget(uid) {
    const empty = `
        <section class="x-card b1-ma-widget" id="b1-ma-widget-card">
          <header class="x-card-title b1-ma-widget__head">
            <svg class="x-icon x-icon--md" aria-hidden="true"><use href="#x-icon-trophy"/></svg>
            <span>Maestrías destacadas</span>
            <span class="b1-ma-widget__head-meta">Top 3 · curadas</span>
          </header>
          <p class="b1-ma-widget__empty">
            <strong>Aún sin maestrías</strong><br>
            Avanza en tus materias para acumular puntos y desbloquear este showcase.
          </p>
        </section>`;

    if (!uid) return empty;
    if (typeof DEMO_MAESTRIA !== "object" || !DEMO_MAESTRIA || !DEMO_MAESTRIA[uid]) return empty;

    // Slice H2a · cascada localStorage → JSON seed → auto by points
    const curatedIds = _getCuratedTop3Maestria(uid);
    if (!curatedIds.length) return empty;
    // Resolver entries en el orden curado (preserva sort manual del alumno)
    const entries = curatedIds
        .map(id => {
            const m = DEMO_MAESTRIA[uid] && DEMO_MAESTRIA[uid][id];
            return m ? { id, ...m } : null;
        })
        .filter(Boolean);

    if (!entries.length) return empty;

    const totalScore = entries.reduce((acc, e) => acc + (e.points || 0), 0);

    const slotsHtml = entries.map(e => {
        const disciplinaId = _getDisciplinaId(e.id);
        const glyph = _getDisciplinaGlyph(disciplinaId);
        const nombreMateria = _resolveMateriaNombre(e.id);
        const emblem = _renderMaestriaEmblem(disciplinaId, glyph, e.nivel || 1, nombreMateria);
        // Escapar comillas simples del nombre para evitar romper el onclick inline
        const nombreEscaped = String(nombreMateria).replace(/'/g, "\\'");
        return `
            <button type="button"
                    class="b1-ma-widget-slot"
                    data-disciplina="${disciplinaId}"
                    onclick="navigateToMaestriaTab('${nombreEscaped}')"
                    aria-label="Abrir Maestría de ${nombreMateria}">
              ${emblem}
              <span class="b1-ma-widget-slot__name">${nombreMateria}</span>
              <span class="b1-ma-widget-slot__meta">Nivel ${e.nivel || 1} <span>· ${(e.points || 0).toLocaleString()} pts</span></span>
            </button>`;
    }).join("");

    // Detectar si la selección viene de localStorage (curado manual) vs seed/auto
    const _isCurated = (() => {
        try {
            const raw = localStorage.getItem(`xahni_top3_maestria_${uid}`);
            return !!(raw && JSON.parse(raw).length > 0);
        } catch (_) { return false; }
    })();
    const _metaTxt = _isCurated ? "Top 3 · curadas" : "Top 3 · auto";

    return `
        <section class="x-card b1-ma-widget" id="b1-ma-widget-card">
          <header class="x-card-title b1-ma-widget__head">
            <svg class="x-icon x-icon--md" aria-hidden="true"><use href="#x-icon-trophy"/></svg>
            <span>Maestrías destacadas</span>
            <span class="b1-ma-widget__head-meta">${_metaTxt}</span>
          </header>
          <div class="b1-ma-widget__score-strip" aria-hidden="true">
            <span class="b1-ma-widget__score-label">Puntuación total de maestría</span>
            <span class="b1-ma-widget__score-num">${totalScore.toLocaleString()}</span>
          </div>
          <div class="b1-ma-widget-slots">${slotsHtml}</div>
          <div class="b1-ma-widget__foot">
            <button type="button"
                    class="x-btn x-btn--ghost"
                    onclick="openModal('modal-top3-maestria-selector')"
                    title="Curar las maestrías destacadas que se muestran en tu perfil">
              <svg class="x-icon x-icon--sm" aria-hidden="true"><use href="#x-icon-edit"/></svg>
              Cambiar selección
            </button>
          </div>
        </section>`;
}

// ═══════════════════════════════════════════════════════════
// SLICE H2c B.1 · Emblemas compactos para perfil público ajeno (read-only)
// ═══════════════════════════════════════════════════════════

/**
 * @interaction render-maestria-emblemas-compacto-publico
 * @scope shared (perfil público ajeno)
 *
 * Given: uid del alumno target (NO necesariamente APP.user.id)
 * When:  buildPerfilPublico (modal o inline) necesita mostrar el Top 3
 *        emblemas Maestría curados de OTRO alumno (read-only)
 * Then:  retorna HTML compacto con 3 emblemas horizontales (48px cada uno,
 *        via CSS scoped), nombre materia + nivel debajo. Sin click handler,
 *        sin foot button. Reusa cascada _getCuratedTop3Maestria(uid) y
 *        _renderMaestriaEmblem. Container con clase .perfil-pub-emblemas-top3
 *        (override CSS scoped para compactar el emblema 116px default).
 * Edge:
 *   - uid falsy → "" (no render, sin badge "sin curaduría" per scope H2c)
 *   - cascada retorna [] → "" (mismo: sin badge, fallback silencioso)
 *   - menos de 3 entries → renderiza las que haya (1 o 2)
 */
function _renderMaestriaEmblemasCompactoPublico(uid) {
    if (!uid) return "";
    const curatedIds = (typeof _getCuratedTop3Maestria === "function")
        ? _getCuratedTop3Maestria(uid)
        : [];
    if (!curatedIds.length) return "";
    if (typeof DEMO_MAESTRIA !== "object" || !DEMO_MAESTRIA || !DEMO_MAESTRIA[uid]) return "";

    const entries = curatedIds
        .map(id => {
            const m = DEMO_MAESTRIA[uid] && DEMO_MAESTRIA[uid][id];
            return m ? { id, ...m } : null;
        })
        .filter(Boolean);
    if (!entries.length) return "";

    const slotsHtml = entries.map(e => {
        const disciplinaId = _getDisciplinaId(e.id);
        const glyph = _getDisciplinaGlyph(disciplinaId);
        const nombreMateria = _resolveMateriaNombre(e.id);
        const emblem = _renderMaestriaEmblem(disciplinaId, glyph, e.nivel || 1, nombreMateria);
        return `
            <div class="perfil-pub-emblemas-top3__slot" data-disciplina="${disciplinaId}"
                 title="${nombreMateria} · Nivel ${e.nivel || 1} · ${(e.points || 0).toLocaleString()} pts">
              ${emblem}
              <span class="perfil-pub-emblemas-top3__name">${nombreMateria}</span>
              <span class="perfil-pub-emblemas-top3__nivel">Niv. ${e.nivel || 1}</span>
            </div>`;
    }).join("");

    return `
        <div class="perfil-pub-emblemas-top3" aria-label="Top 3 maestrías de ${uid}">
          <div class="perfil-pub-emblemas-top3__head">
            <span class="perfil-pub-emblemas-top3__title">Top 3 maestrías</span>
          </div>
          <div class="perfil-pub-emblemas-top3__grid">${slotsHtml}</div>
        </div>`;
}

// ═══════════════════════════════════════════════════════════
// SLICE H2b B.1 · Cosmetics de Maestría derivados para selectors
// (extensión de TITULOS_CATALOG + AVATARES_MARCOS con items
// desbloqueados desde DEMO_MAESTRIA[uid].cosmeticsDesbloqueados)
// ═══════════════════════════════════════════════════════════

/**
 * @interaction get-maestria-cosmetic-disciplina
 * @scope shared
 *
 * Given: id de cosmetic catalog (ej "titulo_experto_bd", "marco_oro_bd")
 * When:  el selector necesita derivar la disciplina del item para chip + tinte
 * Then:  retorna "bd"|"poo"|"ed"|"mat" o "" si no se puede derivar
 * Edge:  cosmetic id sin sufijo disciplina → ""
 */
function _getMaestriaCosmeticDisciplina(cosmeticId) {
    if (!cosmeticId || typeof cosmeticId !== "string") return "";
    const m = cosmeticId.match(/_(bd|poo|ed|mat)(?:$|_)/i);
    return m ? m[1].toLowerCase() : "";
}

/**
 * @interaction get-maestria-cosmetics-for-user
 * @scope shared
 *
 * Given: uid del alumno + tipo ("titulo"|"marco"|"frase"|"emblema")
 * When:  buildTituloSelector / buildAvatarMarcosGrid necesitan listar items
 *        de Maestría desbloqueados por el alumno para mezclarlos con su
 *        catálogo personal
 * Then:  itera DEMO_MAESTRIA[uid][materiaId].cosmeticsDesbloqueados,
 *        intersecta con _getCosmeticsCatalog() filtrando por tipo,
 *        retorna array de objects {id, label, preview, sub, nivelRequerido,
 *        disciplinaId, glyph} dedup (un cosmetic puede aparecer en multiple
 *        materias del alumno, mantener el primero)
 * Edge:
 *   - uid falsy → []
 *   - DEMO_MAESTRIA[uid] absent → []
 *   - catálogo sin matches del tipo → []
 */
function _getMaestriaCosmeticsForUser(uid, tipo) {
    if (!uid || !tipo) return [];
    if (typeof DEMO_MAESTRIA !== "object" || !DEMO_MAESTRIA || !DEMO_MAESTRIA[uid]) return [];
    const catalog = (typeof _getCosmeticsCatalog === "function") ? _getCosmeticsCatalog() : {};
    const seen = new Set();
    const items = [];
    Object.values(DEMO_MAESTRIA[uid]).forEach(mastery => {
        if (!mastery || !Array.isArray(mastery.cosmeticsDesbloqueados)) return;
        mastery.cosmeticsDesbloqueados.forEach(cId => {
            if (seen.has(cId)) return;
            const c = catalog[cId];
            if (!c || c.tipo !== tipo) return;
            seen.add(cId);
            const discId = _getMaestriaCosmeticDisciplina(cId);
            const glyph = (typeof _getDisciplinaGlyph === "function" && discId) ? _getDisciplinaGlyph(discId) : "📚";
            items.push({
                id: cId,
                label: c.label,
                preview: c.preview,
                sub: c.sub,
                nivelRequerido: c.nivelRequerido,
                disciplinaId: discId,
                glyph: glyph
            });
        });
    });
    return items;
}

// ═════════════════════════════════════════════════════════════════
// CALENDARIO HELPERS · Slice calendario rediseño 2026-06-02 cross-rol
// Pattern `.cal-*` (CSS en css/core/calendario.css)
// Source mockup: docs/superpowers/mockups/2026-06-02-calendario-rediseno.html
// Consumers: js/estudiante/hub-calendario.js · js/profesor/hub-calendario.js
//
// VANILLA HARDCODED — post-migración Supabase: clases vendrán de tabla
// `horarios_clase` (hoy en DEMO_MATERIAS[m].horario), exámenes de tabla
// `examenes` (hoy en DEMO_CALENDARIO_EVENTOS[grupoId].examenes), tareas
// de tabla `tareas`, hitos derivados de `parciales` + `periodos`.
// Schema spec: docs/superpowers/specs/2026-05-23-supabase-schema-beta.md
// ═════════════════════════════════════════════════════════════════

const _CAL_DOW_LABELS_SHORT   = ["L", "M", "M", "J", "V", "S", "D"];
const _CAL_DOW_FULL_UPPER     = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
const _CAL_DIAS_ES_BY_IDX     = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const _CAL_MONTH_LABELS_UPPER = [
    "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
    "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
];
const _CAL_MONTH_LABELS_SHORT = [
    "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"
];

// ── Mini-helpers de fecha ─────────────────────────────────────
/**
 * @interaction cal-start-of-day
 * @scope core-calendar-canonical-helper
 *
 * Given un Date object o cualquier value coercible a Date.
 * When un caller calendar necesita normalizar a inicio de día (00:00:00.000).
 * Then retorna nuevo Date con hours/minutes/seconds/ms en 0. NO muta el
 *   argumento (siempre clone via new Date(d)).
 * Edge:
 *   - d invalid → retorna Date Invalid (caller debe validar con isNaN).
 *   - Timezone local del navegador (no UTC) — consistente con resto del
 *     calendar (eventos del usuario son local-time).
 */
function _calStartOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

/**
 * @interaction cal-fmt-ymd
 * @scope core-calendar-canonical-helper
 *
 * Given un Date object.
 * When un caller calendar necesita formatear a "YYYY-MM-DD" (ISO date sin
 *   tiempo) para comparar fechas como strings (e.g. key de un dict por día).
 * Then retorna string con pad("00") en month y day. Local-time (no UTC).
 * Edge:
 *   - d invalid → retorna "NaN-NaN-NaN" (caller debe validar).
 *   - Month en JS es 0-indexed → suma 1 antes de format.
 */
function _calFmtYmd(d) {
    const m   = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
}

/**
 * @interaction cal-parse-ymd
 * @scope core-calendar-canonical-helper
 *
 * Given una string en formato "YYYY-MM-DD" (puede tener tail tipo ISO con
 *   "T..." sufijo; solo se lee el prefijo date).
 * When un caller calendar parsea fechas desde JSON demo o data.
 * Then retorna Date constructed con (year, month-1, day) en local-time
 *   (no UTC, evita desfase visible en regiones west of UTC).
 * Edge:
 *   - s null/undefined/"" → null.
 *   - s sin match del regex (formato inválido) → null.
 *   - Mes 0-indexed en JS → resta 1 al parsear.
 */
function _calParseYmd(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
}

/**
 * @interaction cal-week-start-of
 * @scope core-calendar-canonical-helper
 *
 * Given un Date object.
 * When un caller calendar necesita la fecha del lunes de la semana que
 *   contiene la fecha dada (semana ISO comienza en lunes).
 * Then retorna Date con setDate ajustado al día - dow (con dow normalizado
 *   para que Lunes=0). Domingo se ajusta al lunes anterior (NO al
 *   siguiente).
 * Edge:
 *   - date a las 00:00:00 del lunes → retorna mismo día.
 *   - date a las 23:59 del domingo → retorna lunes 6 días atrás.
 *   - JS getDay() Sunday=0 → fórmula (dow + 6) % 7 normaliza Lunes=0.
 */
function _calWeekStartOf(date) {
    const d = _calStartOfDay(date);
    const offset = (d.getDay() + 6) % 7; // lunes=0
    d.setDate(d.getDate() - offset);
    return d;
}
/**
 * @interaction cal-same-ymd
 * @scope core-calendar-canonical-helper
 *
 * Given dos Date objects a, b.
 * When un caller calendar necesita comparar si son el mismo día (ignorando
 *   hora).
 * Then retorna true si Year+Month+Day coinciden. Comparación trivial sin
 *   alocar nuevos Date.
 * Edge:
 *   - a o b invalid → comparación de NaN === NaN → false (correcto).
 *   - Comparación local-time consistente con resto del calendar.
 */
function _calSameYmd(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth()    === b.getMonth()
        && a.getDate()     === b.getDate();
}
/**
 * @interaction cal-dia-es
 * @scope core-calendar-canonical-helper
 *
 * Given un Date object.
 * When un caller calendar expande clases derivadas de DEMO_MATERIAS[m].horario
 *   y necesita matchear día en español ("lunes"|"martes"|...) con el slot
 *   del horario.
 * Then retorna string lowercase sin acentos según el getDay() del Date.
 * Edge:
 *   - date invalid → getDay() retorna NaN → array[NaN] → undefined.
 *   - Día domingo (getDay()===0) → "domingo".
 *   - Match con horario.dia debe ser case-insensitive normalizado.
 */
function _calDiaEs(date) {
    return _CAL_DIAS_ES_BY_IDX[date.getDay()];
}

/**
 * @interaction _calBuildEvents
 * @scope shared-builders-core
 *
 * Given role ∈ {"alumno","profesor"} y un grupo resuelto (no null).
 * When llamado por hub-calendario.js de cualquier rol con visMonth+visYear.
 * Then retorna array<Event> ordenado asc por fecha, donde Event:
 *   { id, fecha:Date, tipo:"tarea"|"vencida"|"clase"|"examen"|"hito",
 *     titulo:string, materiaId:string|null, materiaNombre:string|null,
 *     horaInicio?:string, horaFin?:string, salon?:string, payload:any }
 *   Fuentes (merge):
 *     1) DEMO_TAREAS filtradas por materias del grupo (alumno: todas las
 *        del grupo; profesor: solo las que enseña en el grupo via
 *        getMateriasProfGrupo). Tipo "vencida" si fecha < hoy0 y, para
 *        alumno, no hay entrega en DEMO_ENTREGAS; sino "tarea".
 *     2) grupo.periodo.parciales → uno por parcial, tipo "hito".
 *     3) Clases derivadas de DEMO_MATERIAS[m].horario filtrado por
 *        grupoId === grupo.id; expandidas dentro del mes visible
 *        (visMonth ± 1 semana buffer) por matching de día en español.
 *     4) Exámenes desde window.DEMO_CALENDARIO_EVENTOS[grupo.id].examenes.
 * Edge: si no hay DEMO_CALENDARIO_EVENTOS[grupo.id], omitir exámenes
 *   pero seguir derivando clases. Sort secundario por horaInicio.
 */
function _calBuildEvents(role, grupo, visMonth, visYear) {
    const out = [];
    if (!grupo) return out;

    const materias = (typeof DEMO_MATERIAS !== "undefined") ? DEMO_MATERIAS : [];
    const tareas   = (typeof DEMO_TAREAS   !== "undefined") ? DEMO_TAREAS   : [];
    const entregas = (typeof DEMO_ENTREGAS !== "undefined") ? DEMO_ENTREGAS : [];
    const hoy0     = _calStartOfDay(new Date());

    // Resolver materias del grupo según el rol
    let matsGrupo;
    if (role === "profesor") {
        const uid = (typeof APP !== "undefined" && APP.user) ? APP.user.id : null;
        matsGrupo = (uid && typeof getMateriasProfGrupo === "function")
            ? getMateriasProfGrupo(uid, grupo.id)
            : [];
    } else {
        // alumno: todas las materias del grupo
        matsGrupo = materias.filter(m => (grupo.materias || []).indexOf(m.id) !== -1);
    }
    const matsMap = new Map(matsGrupo.map(m => [m.id, m]));

    // Ventana de clases: mes visible ± 1 semana buffer
    const winStart = _calStartOfDay(new Date(visYear, visMonth, 1));
    winStart.setDate(winStart.getDate() - 7);
    const winEnd   = _calStartOfDay(new Date(visYear, visMonth + 1, 0));
    winEnd.setDate(winEnd.getDate() + 7);

    // ── 1. Tareas ──────────────────────────────────────────────
    const userId = (typeof APP !== "undefined" && APP.user) ? APP.user.id : null;
    matsGrupo.forEach(function(mat) {
        tareas.forEach(function(t) {
            if (t.materiaId !== mat.id) return;
            // Para profesor: filtrar también por grupoId (si la tarea lo tiene)
            if (role === "profesor" && t.grupoId && t.grupoId !== grupo.id) return;
            if (!t.fechaEntrega) return;
            const fechaStr = (role === "alumno" && typeof effectiveDueDate === "function" && userId)
                ? effectiveDueDate(t, userId)
                : t.fechaEntrega;
            const fecha = _calParseYmd(fechaStr);
            if (!fecha) return;
            let tipo = "tarea";
            if (fecha < hoy0) {
                if (role === "alumno") {
                    const entregada = entregas.some(function(e) {
                        return e.tareaId === t.id && e.alumnoId === userId;
                    });
                    tipo = entregada ? "tarea" : "vencida";
                } else {
                    // Para profesor no marcar vencida, siempre tarea
                    tipo = "tarea";
                }
            }
            out.push({
                id:            "tarea-" + t.id,
                fecha:         fecha,
                tipo:          tipo,
                titulo:        t.titulo || "Tarea",
                materiaId:     mat.id,
                materiaNombre: mat.nombre,
                horaInicio:    "23:59",
                horaFin:       null,
                salon:         null,
                payload:       t
            });
        });
    });

    // ── 2. Hitos parciales ─────────────────────────────────────
    const periodoRaw = grupo.periodo
        || ((typeof getPeriodoDeGrupo === "function") ? getPeriodoDeGrupo(grupo.id) : null);
    if (periodoRaw && typeof getPeriodoInfo === "function") {
        const periodoInfo = getPeriodoInfo(periodoRaw);
        if (periodoInfo && periodoInfo.parciales) {
            periodoInfo.parciales.forEach(function(p) {
                const fecha = p.fin instanceof Date ? _calStartOfDay(p.fin) : _calParseYmd(p.fin);
                if (!fecha) return;
                out.push({
                    id:            "hito-" + grupo.id + "-" + p.num,
                    fecha:         fecha,
                    tipo:          "hito",
                    titulo:        "P" + p.num + " termina",
                    materiaId:     null,
                    materiaNombre: null,
                    horaInicio:    null,
                    horaFin:       null,
                    salon:         null,
                    payload:       p
                });
            });
        }
    }

    // ── 3. Clases recurrentes ──────────────────────────────────
    matsGrupo.forEach(function(mat) {
        const horario = mat.horario || [];
        horario.forEach(function(entry) {
            if (entry.grupoId !== grupo.id) return;
            const diaBuscado = entry.dia; // e.g. "lunes"
            // Iterar días en la ventana visible
            const cursor = new Date(winStart);
            while (cursor <= winEnd) {
                if (_calDiaEs(cursor) === diaBuscado) {
                    const fecha = _calStartOfDay(cursor);
                    out.push({
                        id:            "clase-" + mat.id + "-" + _calFmtYmd(fecha),
                        fecha:         fecha,
                        tipo:          "clase",
                        titulo:        "Clase: " + (mat.nombre || mat.id),
                        materiaId:     mat.id,
                        materiaNombre: mat.nombre,
                        horaInicio:    entry.inicio || null,
                        horaFin:       entry.fin    || null,
                        salon:         entry.salon  || null,
                        payload:       entry
                    });
                }
                cursor.setDate(cursor.getDate() + 1);
            }
        });
    });

    // ── 4. Exámenes ───────────────────────────────────────────
    const calEventos = (typeof DEMO_CALENDARIO_EVENTOS !== "undefined")
        ? DEMO_CALENDARIO_EVENTOS : (typeof window !== "undefined" ? window.DEMO_CALENDARIO_EVENTOS : null);
    const examenesSrc = calEventos && calEventos[grupo.id] && calEventos[grupo.id].examenes;
    if (examenesSrc) {
        examenesSrc.forEach(function(ex) {
            const fecha = _calParseYmd(ex.fecha);
            if (!fecha) return;
            const mat = matsMap.get(ex.materiaId);
            // Para profesor: omitir exámenes de materias que no enseña
            if (role === "profesor" && !mat) return;
            out.push({
                id:            "examen-" + ex.id,
                fecha:         fecha,
                tipo:          "examen",
                titulo:        ex.titulo || "Examen",
                materiaId:     ex.materiaId || null,
                materiaNombre: mat ? mat.nombre : (ex.materiaId || null),
                horaInicio:    ex.horaInicio || null,
                horaFin:       ex.horaFin   || null,
                salon:         null,
                payload:       ex
            });
        });
    }

    // Sort asc por fecha, secundario por horaInicio
    out.sort(function(a, b) {
        const dt = a.fecha - b.fecha;
        if (dt !== 0) return dt;
        const ha = a.horaInicio || "00:00";
        const hb = b.horaInicio || "00:00";
        return ha < hb ? -1 : ha > hb ? 1 : 0;
    });
    return out;
}

/**
 * @interaction _calComputeChips
 * @scope shared-builders-core
 *
 * Given events del mes visible + role.
 * Then retorna array<{label:string, kind:"info"|"warn"|"danger"}> para emitir
 *   como `.x-chip x-chip--<kind>` en el header.
 *   Alumno: contar tareas (kind:info "<N>T"), exámenes (warn "<N>E"),
 *           vencidas (danger "<N>V").
 *   Profesor: contar tareas-pendientes (warn "<N>T"), clases (info "<N>C").
 *   Filtrar events al mes visible (visMonth+visYear).
 */
function _calComputeChips(role, events, visMonth, visYear) {
    const mesEvents = events.filter(function(e) {
        return e.fecha.getFullYear() === visYear && e.fecha.getMonth() === visMonth;
    });
    const chips = [];
    if (role === "alumno") {
        const nT = mesEvents.filter(function(e) { return e.tipo === "tarea"; }).length;
        const nE = mesEvents.filter(function(e) { return e.tipo === "examen"; }).length;
        const nV = mesEvents.filter(function(e) { return e.tipo === "vencida"; }).length;
        if (nT > 0) chips.push({ label: nT + "T", kind: "info" });
        if (nE > 0) chips.push({ label: nE + "E", kind: "warn" });
        if (nV > 0) chips.push({ label: nV + "V", kind: "danger" });
    } else {
        // profesor
        const nT = mesEvents.filter(function(e) { return e.tipo === "tarea"; }).length;
        const nC = mesEvents.filter(function(e) { return e.tipo === "clase"; }).length;
        if (nT > 0) chips.push({ label: nT + "T", kind: "warn" });
        if (nC > 0) chips.push({ label: nC + "C", kind: "info" });
    }
    return chips;
}

/**
 * @interaction _calRenderHeader
 * @scope shared-builders-core
 *
 * Given role + ctx = {visMonth, visYear, events, navPrev, navNext}.
 * Then retorna HTML del `.cal-header` con 2 buttons nav + title + .cal-header__stats.
 *   navPrev/navNext son strings con onclick (e.g. "hubCalendarioPrev()").
 */
function _calRenderHeader(role, ctx) {
    const chips   = _calComputeChips(role, ctx.events || [], ctx.visMonth, ctx.visYear);
    const title   = _CAL_MONTH_LABELS_UPPER[ctx.visMonth] + " " + ctx.visYear;
    const navPrev = ctx.navPrev || "void(0)";
    const navNext = ctx.navNext || "void(0)";

    const chipsHtml = chips.map(function(c) {
        return '<span class="x-chip x-chip--' + c.kind + '">' + _escapeHtml(c.label) + '</span>';
    }).join("");

    return '<div class="cal-header">'
        + '<div class="cal-header__nav">'
        +   '<button class="cal-header__nav-btn" onclick="' + navPrev + '" aria-label="Mes anterior">&#8249;</button>'
        + '</div>'
        + '<div class="cal-header__title">' + title + '</div>'
        + '<div class="cal-header__nav">'
        +   '<button class="cal-header__nav-btn" onclick="' + navNext + '" aria-label="Mes siguiente">&#8250;</button>'
        + '</div>'
        + (chipsHtml ? '<div class="cal-header__stats">' + chipsHtml + '</div>' : '')
        + '</div>';
}

/**
 * @interaction _calRenderMini
 * @scope shared-builders-core
 *
 * Given role + ctx = {visMonth, visYear, selectedDay, events, pickDay}.
 * Then retorna HTML del `.cal-mini` con .cal-mini__dow-row (7 dow short labels)
 *   y .cal-mini__grid con 42 cells. Cada cell tiene clases por estado
 *   (off / today / selected / in-week), .cal-mini__num, opcional
 *   .cal-mini__count (>=2 events), .cal-mini__dots con 1 dot por tipo único
 *   en el día (máximo 5 dots: tarea, examen, clase, vencida, hito).
 *   pickDay = string del nombre de función global (e.g. "hubCalendarioPickDay")
 *   que se llama via `onclick="<pickDay>('YYYY-MM-DD')"`.
 */
function _calRenderMini(role, ctx) {
    const visMonth   = ctx.visMonth;
    const visYear    = ctx.visYear;
    const selectedDay= ctx.selectedDay instanceof Date ? ctx.selectedDay : new Date();
    const events     = ctx.events || [];
    const pickDay    = ctx.pickDay || "void(0)";

    const hoy0      = _calStartOfDay(new Date());
    const weekStart = _calWeekStartOf(selectedDay);
    const weekEnd   = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    // Indexar eventos por yyyy-mm-dd
    const byDay = {};
    events.forEach(function(e) {
        const key = _calFmtYmd(e.fecha);
        (byDay[key] = byDay[key] || []).push(e);
    });

    // DOW header row
    const dowHtml = _CAL_DOW_LABELS_SHORT.map(function(lbl) {
        return '<div class="cal-mini__dow">' + lbl + '</div>';
    }).join("");

    // 42 cells
    const primerDia = new Date(visYear, visMonth, 1);
    const offsetLunes = (primerDia.getDay() + 6) % 7;
    const startCell = new Date(visYear, visMonth, 1 - offsetLunes);

    const cellsHtml = [];
    for (var i = 0; i < 42; i++) {
        var d = new Date(startCell);
        d.setDate(startCell.getDate() + i);
        var key = _calFmtYmd(d);
        var dayEvents = byDay[key] || [];

        var classes = ["cal-mini__cell"];
        if (d.getMonth() !== visMonth) classes.push("cal-mini__cell--off");
        if (_calSameYmd(d, hoy0))           classes.push("cal-mini__cell--today");
        if (_calSameYmd(d, selectedDay))    classes.push("cal-mini__cell--selected");
        else if (d >= weekStart && d <= weekEnd) classes.push("cal-mini__cell--in-week");

        // Count badge (>=2 total events)
        var countHtml = dayEvents.length >= 2
            ? '<span class="cal-mini__count">' + dayEvents.length + '</span>'
            : "";

        // One dot per distinct tipo (up to 5)
        var tiposVisto = {};
        var dotsHtml = "";
        var DOT_ORDER = ["tarea", "examen", "clase", "vencida", "hito"];
        if (dayEvents.length > 0) {
            dayEvents.forEach(function(e) { tiposVisto[e.tipo] = true; });
            var dotItems = DOT_ORDER.filter(function(t) { return tiposVisto[t]; });
            dotsHtml = '<div class="cal-mini__dots">'
                + dotItems.map(function(t) {
                    return '<span class="cal-mini__dot cal-mini__dot--' + t + '"></span>';
                }).join("")
                + '</div>';
        }

        cellsHtml.push(
            '<div class="' + classes.join(" ") + '"'
            + ' onclick="' + pickDay + '(\'' + key + '\')"'
            + ' aria-label="' + key + (dayEvents.length ? ', ' + dayEvents.length + ' evento' + (dayEvents.length > 1 ? 's' : '') : '') + '">'
            + countHtml
            + '<div class="cal-mini__num">' + d.getDate() + '</div>'
            + dotsHtml
            + '</div>'
        );
    }

    return '<div class="cal-mini">'
        + '<div class="cal-mini__dow-row">' + dowHtml + '</div>'
        + '<div class="cal-mini__grid">' + cellsHtml.join("") + '</div>'
        + '</div>';
}

/**
 * @interaction _calRenderAgenda
 * @scope shared-builders-core
 *
 * Given role + ctx = {selectedDay, events, openEvent}.
 * Then retorna HTML del `.cal-agenda` con .cal-agenda__week-label
 *   ("SEM <N> · DD — DD MMM") + 7 .cal-agenda__day (cada uno con day-label
 *   + events embebidos o .cal-agenda__empty "—"). Día actual recibe modifier
 *   .cal-agenda__day--today.
 */
function _calRenderAgenda(role, ctx) {
    const selectedDay = ctx.selectedDay instanceof Date ? ctx.selectedDay : new Date();
    const events      = ctx.events || [];
    const openEvent   = ctx.openEvent || "void(0)";

    const weekStart = _calWeekStartOf(selectedDay);
    const weekEnd   = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const hoy0      = _calStartOfDay(new Date());

    // Número de semana ISO (aproximado)
    const jan1     = new Date(weekStart.getFullYear(), 0, 1);
    const weekNum  = Math.ceil(((weekStart - jan1) / 86400000 + jan1.getDay() + 1) / 7);

    // Filtrar eventos de la semana
    const weekEvents = events.filter(function(e) {
        return e.fecha >= weekStart && e.fecha <= weekEnd;
    });

    // Label "SEM N · DD — DD MMM"
    const labelStart = weekStart.getDate();
    const labelEnd   = weekEnd.getDate();
    const mStart     = _CAL_MONTH_LABELS_SHORT[weekStart.getMonth()].toUpperCase();
    const mEnd       = _CAL_MONTH_LABELS_SHORT[weekEnd.getMonth()].toUpperCase();
    const mLabel     = weekStart.getMonth() === weekEnd.getMonth()
        ? mStart
        : mStart + " — " + mEnd;
    const weekLabel  = "SEM " + weekNum + " · " + labelStart + " — " + labelEnd + " " + mEnd;

    const html = ['<div class="cal-agenda__week-label">' + weekLabel + '</div>'];

    for (var i = 0; i < 7; i++) {
        var d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        var dayEvents = weekEvents.filter(function(e) { return _calSameYmd(e.fecha, d); });

        var dayClasses = ["cal-agenda__day"];
        if (_calSameYmd(d, hoy0)) dayClasses.push("cal-agenda__day--today");

        var eventsHtml;
        if (dayEvents.length === 0) {
            eventsHtml = '<div class="cal-agenda__events"><span class="cal-agenda__empty">—</span></div>';
        } else {
            var evHtml = dayEvents.map(function(e) {
                return _calRenderEvent(role, e, ctx.grupoMiembrosCount || 0, openEvent);
            }).join("");
            eventsHtml = '<div class="cal-agenda__events">' + evHtml + '</div>';
        }

        html.push(
            '<div class="' + dayClasses.join(" ") + '">'
            + '<div class="cal-agenda__day-label">'
            +   '<div class="cal-agenda__day-dow">' + _CAL_DOW_FULL_UPPER[i] + '</div>'
            +   '<div class="cal-agenda__day-num">' + d.getDate() + '</div>'
            + '</div>'
            + eventsHtml
            + '</div>'
        );
    }

    return '<div class="cal-agenda">' + html.join("") + '</div>';
}

/**
 * @interaction _calRenderEvent
 * @scope shared-builders-core
 *
 * Given role + event object.
 * Then retorna HTML del `.cal-event--<tipo>` con .cal-type-icon (mapea tipo
 *   a sprite: tarea→#x-icon-tareas, examen→#x-icon-examenes, clase→#x-icon-clase,
 *   vencida→#x-icon-warn, hito→#x-icon-hito), .cal-event__body con title +
 *   meta (mat + time + opcional badge).
 *   onclick="<openEvent>('<event.id>')" salvo tipo=hito (no clickable).
 * Edge: badge se agrega para tipos examen/vencida/hito con clase
 *   .cal-event__badge--<tipo>. Para role="profesor", la materia label puede
 *   incluir "<MAT> · <N> alumnos" si el grupo tiene miembros (usar
 *   grupoMiembrosCount); para alumno usar solo m.nombre o m.clave.
 *   Time string: "HH:MM – HH:MM" si hay horaInicio+horaFin, "HH:MM" si solo
 *   horaInicio (e.g. tareas a 23:59).
 */
function _calRenderEvent(role, event, grupoMiembrosCount, openEventFn) {
    const tipo   = event.tipo || "tarea";
    const titulo = _escapeHtml(event.titulo || "");

    // Sprite mapping
    const iconMap = {
        "tarea":   "#x-icon-tareas",
        "examen":  "#x-icon-examenes",
        "clase":   "#x-icon-clase",
        "vencida": "#x-icon-warn",
        "hito":    "#x-icon-hito"
    };
    const iconHref = iconMap[tipo] || "#x-icon-tareas";

    // Materia label
    var matLabel = "";
    if (event.materiaNombre) {
        var matText = _escapeHtml(event.materiaNombre);
        if (role === "profesor" && grupoMiembrosCount > 0) {
            matText += " · " + grupoMiembrosCount + " alumnos";
        }
        if (event.salon && role === "profesor") {
            matText += " · " + _escapeHtml(event.salon);
        }
        matLabel = '<span class="cal-event__mat">' + matText + '</span>';
    } else if (event.salon && role === "alumno") {
        matLabel = '<span class="cal-event__mat">' + _escapeHtml(event.salon) + '</span>';
    }

    // Time string
    var timeLabel = "";
    if (event.horaInicio && event.horaFin) {
        timeLabel = '<span class="cal-event__time">' + _escapeHtml(event.horaInicio) + ' – ' + _escapeHtml(event.horaFin) + '</span>';
    } else if (event.horaInicio) {
        timeLabel = '<span class="cal-event__time">' + _escapeHtml(event.horaInicio) + '</span>';
    }

    // Badge
    var badgeHtml = "";
    var badgeTypes = { "examen": "EXAMEN", "vencida": "VENCIDA", "hito": "HITO" };
    if (badgeTypes[tipo]) {
        badgeHtml = '<span class="cal-event__badge cal-event__badge--' + tipo + '">' + badgeTypes[tipo] + '</span>';
    }

    var metaParts = [matLabel, timeLabel, badgeHtml].filter(Boolean).join("");
    var metaHtml  = metaParts ? '<div class="cal-event__meta">' + metaParts + '</div>' : "";

    // Hito: no clickable. Otros tipos: invocar openEventFn (nombre de función global)
    var isHito     = tipo === "hito";
    var openFn     = openEventFn || "_calOpenEventNoop";
    var clickAttr  = isHito ? "" : ' onclick="' + openFn + '(\'' + _escapeHtml(event.id) + '\')"';

    return '<div class="cal-event cal-event--' + tipo + '"' + clickAttr + '>'
        + '<div class="cal-type-icon cal-type-icon--' + tipo + '">'
        +   '<svg class="x-icon x-icon--sm"><use href="' + iconHref + '"></use></svg>'
        + '</div>'
        + '<div class="cal-event__body">'
        +   '<div class="cal-event__title">' + titulo + '</div>'
        +   metaHtml
        + '</div>'
        + '</div>';
}

// Internal noop fallback for onclick (consumers override via ctx.openEvent → _calRenderWrapper/Agenda)
/**
 * @interaction cal-open-event-noop
 * @scope core-calendar-canonical-placeholder
 *
 * Given un event id (string).
 * When (no se invoca en producción real) — placeholder default cuando los
 *   consumidores del calendar canonical no proveen un openEventFn callback
 *   propio (e.g. tests, smoke fixtures, primeros consumers en construcción).
 * Then no-op (cuerpo vacío). Existe puramente como reference para el patrón
 *   "function injectable" del canonical calendar; los consumers reemplazan
 *   con su propia función al invocar _calRenderWrapper(..., openEventFn).
 * Edge consumers REALES (hub-calendario alumno/profesor) siempre pasan su
 *   propia openEventFn — este noop nunca debería ejecutarse en runtime real.
 */
function _calOpenEventNoop(id) { /* consumers replace this reference */ }

/**
 * @interaction _calRenderLegend
 * @scope shared-builders-core
 *
 * Given role.
 * Then retorna HTML del `.cal-legend` con .cal-legend__item × 5 (alumno —
 *   Tarea/Examen/Clase/Vencida/Hito) o × 4 (profesor — sin Vencida).
 *   Cada item usa style inline `background:var(--<token>)` para el dot.
 */
function _calRenderLegend(role) {
    var items = [
        { label: "Tarea",  color: "var(--state-info)" },
        { label: "Examen", color: "var(--xahni-amber)" },
        { label: "Clase",  color: "var(--xahni-teal)" }
    ];
    if (role === "alumno") {
        items.push({ label: "Vencida", color: "var(--state-danger)" });
    }
    items.push({ label: "Hito", color: "var(--xahni-purple)" });

    var html = items.map(function(item) {
        return '<div class="cal-legend__item">'
            + '<span class="cal-legend__dot" style="background:' + item.color + '"></span>'
            + _escapeHtml(item.label)
            + '</div>';
    }).join("");

    return '<div class="cal-legend">' + html + '</div>';
}

/**
 * @interaction _calRenderWrapper
 * @scope shared-builders-core
 *
 * Given role + ctx (visMonth, visYear, selectedDay, events, navPrev, navNext,
 *   pickDay, openEvent, grupoMiembrosCount?).
 * Then retorna HTML completo del `.cal-wrapper` con data-rol normalizado
 *   ("alumno" o "profesor") + data-gamer derivado de
 *   `document.body.classList.contains("gamer-off")` (off → "off", sino "on").
 *   Compone: Header → Body[ Mini | Side[ Agenda + Legend ] ].
 *   El switch de grupo profesor vive en el hub-shell, no en este wrapper.
 */
function _calRenderWrapper(role, ctx) {
    var dataRol   = (role === "profesor") ? "profesor" : "alumno";
    var dataGamer = (typeof document !== "undefined" && document.body && document.body.classList.contains("gamer-off"))
        ? "off" : "on";

    var topParts = [];

    // Header — fila full-width arriba (cross-rol idéntico; cambio de grupo
    // profesor se hace desde el switcher del hub-shell, no desde aquí)
    topParts.push(_calRenderHeader(role, ctx));

    // Body 50/50: mini izquierda · agenda+legend stack derecha
    var agendaCtx = Object.assign({}, ctx, {
        grupoMiembrosCount: ctx.grupoMiembrosCount || 0
    });
    var bodyHtml = '<div class="cal-body">'
        +   _calRenderMini(role, ctx)
        +   '<div class="cal-side">'
        +     _calRenderAgenda(role, agendaCtx)
        +     _calRenderLegend(role)
        +   '</div>'
        + '</div>';

    return '<div class="cal-wrapper" data-rol="' + dataRol + '" data-gamer="' + dataGamer + '">'
        + topParts.join("")
        + bodyHtml
        + '</div>';
}

// Expose helpers para que los builders cross-rol los consuman
if (typeof window !== "undefined") {
    window._calBuildEvents      = _calBuildEvents;
    window._calComputeChips     = _calComputeChips;
    window._calRenderHeader     = _calRenderHeader;
    window._calRenderMini       = _calRenderMini;
    window._calRenderAgenda     = _calRenderAgenda;
    window._calRenderEvent      = _calRenderEvent;
    window._calRenderLegend     = _calRenderLegend;
    window._calRenderWrapper    = _calRenderWrapper;
}

/**
 * @interaction review-respuestas-correctas
 * @scope shared-review-builder
 *
 * Given alumno terminó intento (examen o juego) y abre la review.
 * When buildReviewScreen({items, container, onClose, onExit}) recibe el array
 *   de items con shape canónico { tipo, enunciado, opciones?, correcta,
 *   tuRespuesta, calificacion?, similitud?, pares?, tuPares? }.
 * Then renderiza pregunta idx=0, wirea prev/next, paginator nav, botón
 *   "Volver al resumen" + keyboard ←/→ para nav.
 * Edge: si items.length === 0, container muestra mensaje "Sin preguntas
 *   para revisar". Builder retorna { destroy } para limpiar listener.
 *
 * Slice review respuestas A · 2026-06-08
 * Spec: docs/superpowers/specs/2026-06-08-review-respuestas-correctas-design.md
 */
function buildReviewScreen({ items, container, onClose, onExit }) {
    let idx = 0;
    const total = items.length;

    if (total === 0) {
        container.innerHTML = '<div class="x-review"><p>Sin preguntas para revisar.</p><div class="x-review__actions"><button class="x-btn x-btn--ghost" data-rv-back>Volver</button></div></div>';
        container.querySelector('[data-rv-back]').onclick = onClose;
        return { destroy: () => {} };
    }

    function render() {
        container.innerHTML = `
            <div class="x-review">
                <div class="x-review__q">${_rvRenderQuestion(items[idx], idx, total)}</div>
                <div class="x-review__nav">
                    <button class="x-btn x-btn--ghost" ${idx===0?'disabled':''} data-rv-prev>← Anterior</button>
                    <span class="x-review__counter">${idx+1} / ${total}</span>
                    <button class="x-btn x-btn--ghost" ${idx===total-1?'disabled':''} data-rv-next>Siguiente →</button>
                </div>
                <div class="x-review__actions">
                    <button class="x-btn x-btn--ghost" data-rv-back>Volver al resumen</button>
                </div>
            </div>
        `;
        container.querySelector('[data-rv-prev]').onclick = () => { if (idx>0) { idx--; render(); } };
        container.querySelector('[data-rv-next]').onclick = () => { if (idx<total-1) { idx++; render(); } };
        container.querySelector('[data-rv-back]').onclick = onClose;
    }

    function onKey(e) {
        if (e.key === 'ArrowLeft'  && idx > 0)         { idx--; render(); }
        if (e.key === 'ArrowRight' && idx < total - 1) { idx++; render(); }
    }
    document.addEventListener('keydown', onKey);

    render();
    return { destroy: () => document.removeEventListener('keydown', onKey) };
}

function _rvRenderQuestion(item, idx, total) {
    const dispatch = {
        'multi':       _rvMulti,
        'abierta':     _rvAbierta,
        'match':       _rvMatch,
        'quiz':        _rvMulti,        /* mismo render que multi */
        'flashcards':  _rvFlashcards,
        'vf':          _rvVF
    };
    const renderer = dispatch[item.tipo];
    if (!renderer) return `<div class="x-review__num">Tipo no soportado: ${item.tipo}</div>`;
    return renderer(item, idx, total);
}

function _rvMulti(item, idx, total) {
    const yourIsCorrect = item.tuRespuesta === item.correcta;
    const chip = yourIsCorrect
        ? '<span class="x-review__chip x-review__chip--ok">Correcta</span>'
        : '<span class="x-review__chip x-review__chip--bad">Incorrecta</span>';
    const opts = (item.opciones || []).map(o => {
        let cls = 'x-review__opt';
        let icon = '';
        if (o === item.correcta && o === item.tuRespuesta) {
            cls += ' x-review__opt--your-correct'; icon = '✓';
        } else if (o === item.correcta) {
            cls += ' x-review__opt--correct'; icon = '✓';
        } else if (o === item.tuRespuesta) {
            cls += ' x-review__opt--your-wrong'; icon = '✗';
        } else {
            cls += ' x-review__opt--neutral';
        }
        return `<div class="${cls}">${icon} ${_rvEsc(o)}</div>`;
    }).join('');
    return `
        <div class="x-review__num">Pregunta ${idx+1} de ${total} · Multiple choice ${chip}</div>
        <div class="x-review__text">${_rvEsc(item.enunciado)}</div>
        ${opts}
    `;
}

function _rvAbierta(item, idx, total) {
    const calificada = item.calificacion != null;
    const chip = calificada
        ? `<span class="x-review__chip x-review__chip--ok">Calificada · ${item.calificacion}/10</span>`
        : '<span class="x-review__chip x-review__chip--pending">Pendiente · profe</span>';
    return `
        <div class="x-review__num">Pregunta ${idx+1} de ${total} · Abierta ${chip}</div>
        <div class="x-review__text">${_rvEsc(item.enunciado)}</div>
        <div class="x-review__your-text">${_rvEsc(item.tuRespuesta || '(sin respuesta)')}</div>
        ${!calificada ? '<div class="x-review__pending-msg">⏳ Tu profesor calificará esto pronto.</div>' : ''}
    `;
}

function _rvMatch(item, idx, total) {
    const pares = item.pares || [];
    const tuPares = item.tuPares || {};
    const allCorrect = pares.every(p => tuPares[p.a] === p.b);
    const chip = allCorrect
        ? '<span class="x-review__chip x-review__chip--ok">Correcta</span>'
        : '<span class="x-review__chip x-review__chip--bad">Incorrecta</span>';
    const rows = pares.map(par => {
        const tuB = tuPares[par.a];
        const ok = tuB === par.b;
        return `
            <div class="x-review__pair-row ${ok ? 'is-ok' : 'is-bad'}">
                <span class="x-review__pair-left">${_rvEsc(par.a)}</span>
                <span class="x-review__pair-arrow">${ok ? '→ ✓' : '→ ✗'}</span>
                <span class="x-review__pair-right">${_rvEsc(tuB || '(vacío)')}</span>
                ${!ok ? `<span class="x-review__pair-correct">correcta: ${_rvEsc(par.b)}</span>` : ''}
            </div>
        `;
    }).join('');
    return `
        <div class="x-review__num">Pregunta ${idx+1} de ${total} · Match ${chip}</div>
        <div class="x-review__text">${_rvEsc(item.enunciado)}</div>
        <div class="x-review__pairs">${rows}</div>
    `;
}

function _rvFlashcards(item, idx, total) {
    const simPct = Math.round((item.similitud || 0) * 100);
    /* Umbral 70% para "Correcta" en review. Independiente del nivel
       categórico de StringCompare.similarityToNivel — decisión MVP. */
    const correct = simPct >= 70;
    const chip = correct
        ? `<span class="x-review__chip x-review__chip--ok">Correcta · ${simPct}%</span>`
        : `<span class="x-review__chip x-review__chip--bad">${simPct}% similitud</span>`;
    return `
        <div class="x-review__num">Pregunta ${idx+1} de ${total} · Flashcard ${chip}</div>
        <div class="x-review__text">${_rvEsc(item.enunciado)}</div>
        <div class="x-review__fc-your">
            <span class="x-review__label">Tu respuesta</span>
            <div class="x-review__your-text">${_rvEsc(item.tuRespuesta || '(sin respuesta)')}</div>
        </div>
        <div class="x-review__fc-correct">
            <span class="x-review__label">Respuesta correcta</span>
            <div class="x-review__correct-text">${_rvEsc(item.correcta)}</div>
        </div>
    `;
}

function _rvVF(item, idx, total) {
    const correct = item.tuRespuesta === item.correcta;
    const chip = correct
        ? '<span class="x-review__chip x-review__chip--ok">Correcta</span>'
        : '<span class="x-review__chip x-review__chip--bad">Incorrecta</span>';
    return `
        <div class="x-review__num">Pregunta ${idx+1} de ${total} · Verdadero/Falso ${chip}</div>
        <div class="x-review__text">${_rvEsc(item.enunciado)}</div>
        <div class="x-review__vf">
            <div class="x-review__vf-badge ${item.tuRespuesta===true?'is-your':''} ${item.correcta===true?'is-correct':''}">VERDADERO</div>
            <div class="x-review__vf-badge ${item.tuRespuesta===false?'is-your':''} ${item.correcta===false?'is-correct':''}">FALSO</div>
        </div>
        <div class="x-review__vf-hint">${correct ? '✓ Acertaste' : `✗ La respuesta correcta era: <strong>${item.correcta ? 'VERDADERO' : 'FALSO'}</strong>`}</div>
    `;
}

/* Helper local de escape para el review screen. Nombrado _rvEsc para evitar
   colisión con cualquier _esc preexistente en el codebase. */
// FIX 2026-07-08: era una reimplementación duplicada de _escapeHtml
// (js/core/dom-utils.js). Ahora delega al canonical — ver CONVENTIONS.md.
function _rvEsc(s) {
    return _escapeHtml(s);
}
