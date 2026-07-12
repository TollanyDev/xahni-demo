// ═══════════════════════════════════════════════════════════
// GAMIFICACIÓN · Trofeos · Competencias · Grupo · Medallas
//                Rangos · Comparativa · Insignias · Maestrías widget
// Slice #12 split (2026-06-01): extraído de perfil.js
// ═══════════════════════════════════════════════════════════

// ── Mapa de colores CSS var → hex (para SVG que no acepta variables) ──
const _COMP_COLOR_MAP = {
    "var(--xahni-teal)":   "#00d4ff",
    "var(--xahni-amber)":  "#f5a623",
    "var(--xahni-purple)": "#8b2be2",
    "var(--xahni-cyan)":   "#1b4fe4",
    "var(--xahni-green)":  "#22c55e",
};

// ── buildTrofeos ────────────────────────────────────────────
/**
 * @interaction build-trofeos
 * @scope perfil-shared-builders-pilar-2-alumno
 *
 * Given alumno entra al tab Perfil y `buildPerfilCompleto` rama estudiante.
 * When se renderiza la sección `#trofeos-grid` con su contador.
 * Then resuelve `getTrofeosAlumno(uid)`, actualiza `#trofeos-count` con
 *   "N Torneos" y renderiza una `.x-medal--<rareza>.trofeo-card` por trofeo
 *   con emoji + nombre + rareza + descripción + fecha + puntos. Cada card
 *   abre un toast con detalle al click.
 * Edge:
 *   - container ausente → no-op.
 *   - getter no cargado o sin usuario → empty state x-empty con icono 🏆.
 *   - trofeo sin `glowColor` → fallback cyan (#00d4ff); sin `gradiente` →
 *     gradient derivado del glow.
 *   - profesor/admin nunca llega aquí (sweep oculta la sección).
 */
function buildTrofeos() {
    const el = document.getElementById("trofeos-grid");
    if (!el) return;

    const trofeos = (typeof getTrofeosAlumno === "function" && APP?.user?.id)
        ? getTrofeosAlumno(APP.user.id) : [];

    const countEl = document.getElementById("trofeos-count");
    if (countEl) countEl.textContent = trofeos.length + " Torneos";

    if (!trofeos.length) {
        el.innerHTML = `<div class="x-empty" style="grid-column:1/-1">
            <div class="x-empty__icon">🏆</div>
            <div class="x-empty__title">Aún no tienes trofeos</div>
            <div class="x-empty__desc">¡Participa en una competencia!</div>
        </div>`;
        return;
    }

    el.innerHTML = trofeos.map(t => {
        const rareza    = t.rareza    || "comun";
        const gradiente = t.gradiente || `linear-gradient(135deg,${t.glowColor || "#00d4ff"}30,${t.glowColor || "#00d4ff"}10)`;
        const glowColor = t.glowColor || "#00d4ff";
        const desc      = t.desc      || "";
        return `
        <div class="x-medal x-medal--${rareza} trofeo-card"
             style="--medal-color:${glowColor};--trofeo-grad:${gradiente}"
             onclick="showToast('🏆 ${t.nombre} — ${t.pts}', 'success')">
            <div class="trofeo-glow" style="background:radial-gradient(circle,${glowColor}60 0%,transparent 70%)"></div>
            <span class="x-medal__emoji" style="color:${glowColor}">${t.emoji}</span>
            <div class="x-medal__body">
                <div class="x-medal__name">${t.nombre}</div>
                <div class="x-medal__rarity">${rarityLabel(rareza)}</div>
                ${desc ? `<div class="x-medal__desc">${desc}</div>` : ''}
                <div class="trofeo-meta">
                    <span class="trofeo-fecha">📅 ${t.fecha}</span>
                    <span class="trofeo-pts">${t.pts}</span>
                </div>
            </div>
        </div>`;
    }).join("");
}

// ── buildCompetenciasDestaque ────────────────────────────────
let _competenciasRetryTimer = null;
/**
 * @interaction build-competencias-destaque
 * @scope perfil-shared-builders-pilar-2-alumno
 *
 * Given alumno entra al tab Perfil y `buildPerfilCompleto` dispatcha el
 *   builder (rama estudiante).
 * When se renderiza el container `#competencias-destaque-grid`.
 * Then evalúa `_calcularCompetencias()` (deriva de calificaciones reales
 *   via `getMateriasAlumno`):
 *   - **Sin datos** → renderiza 4 skeletons + arma
 *     `_competenciasRetryTimer` (400ms) que re-llama el builder (race
 *     contra DataService async load).
 *   - **Con datos** → cancela el retry timer pendiente y renderiza una
 *     card SVG ring por competencia con `circumference=200`,
 *     `stroke-dashoffset` proporcional al `pct`, gradient lineal del
 *     color de la materia, label de área y badge "⭐ Top área" para las
 *     2 con mayor pct.
 * Edge:
 *   - container ausente → no-op (sin retry).
 *   - retry encadenado → el callback verifica que el container siga
 *     presente antes de re-llamar (cambio de tab durante el timeout).
 *   - `_calcularCompetencias` ya documentado en perfil-identidad.js como
 *     cross-file helper.
 */
function buildCompetenciasDestaque() {
    const el = document.getElementById("competencias-destaque-grid");
    if (!el) return;

    // Datos derivados de las calificaciones reales del alumno
    const competencias = _calcularCompetencias();

    if (!competencias.length) {
        el.innerHTML = `
            <div class="x-skeleton x-skeleton--card"></div>
            <div class="x-skeleton x-skeleton--card"></div>
            <div class="x-skeleton x-skeleton--card"></div>
            <div class="x-skeleton x-skeleton--card"></div>`;
        if (!_competenciasRetryTimer) {
            _competenciasRetryTimer = setTimeout(() => {
                _competenciasRetryTimer = null;
                if (document.getElementById("competencias-destaque-grid")) buildCompetenciasDestaque();
            }, 400);
        }
        return;
    }
    if (_competenciasRetryTimer) {
        clearTimeout(_competenciasRetryTimer);
        _competenciasRetryTimer = null;
    }

    el.innerHTML = competencias.map(c => {
        const circumference = 200;
        const offset = circumference - (c.pct / 100) * circumference;
        const gradId = "compGrad_" + c.area.replace(/\s/g, "");
        return `
        <div class="x-card competencia-ring-card" style="--comp-color:${c.color}"
             onclick="showToast('${c.area}: ${c.pct}% de dominio', 'info')">
            <svg class="comp-ring-svg" viewBox="0 0 80 80">
                <defs>
                    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="${c.color}"/>
                        <stop offset="100%" stop-color="${c.color}88"/>
                    </linearGradient>
                </defs>
                <circle class="comp-ring-bg" cx="40" cy="40" r="32" transform="rotate(-90 40 40)"/>
                <circle class="comp-ring-fill"
                    cx="40" cy="40" r="32"
                    stroke="url(#${gradId})"
                    style="--dash-offset:${offset};--delay:${c.delay};filter:drop-shadow(0 0 5px ${c.color}60)"
                    transform="rotate(-90 40 40)"/>
                <text x="40" y="37" text-anchor="middle" class="comp-ring-text">${c.pct}%</text>
                <text x="40" y="49" text-anchor="middle" class="comp-ring-sub">dominio</text>
            </svg>
            <div class="comp-area-name">${c.area}</div>
            ${c.top ? '<div class="comp-top-badge">⭐ Top área</div>' : ''}
        </div>`;
    }).join("");
}

// ── buildGrupoDestaque ──────────────────────────────────────
/**
 * @interaction build-grupo-destaque-alumno
 * @scope perfil-shared-builders-pilar-2-alumno
 *
 * Given alumno entra al tab Perfil + `buildPerfilCompleto` rama estudiante.
 * When se renderiza la card del grupo del alumno.
 * Then resuelve `getGrupoAlumno(uid)` + `getMateriasAlumno(uid)`, inyecta:
 *   - `#grupo-nombre` = nombre del grupo o "Sin grupo asignado".
 *   - `#grupo-rank` = `rankCampus` (string como "#5") o "Niv. N".
 *   - `#grupo-materias-list` = una row por materia con barra de progreso
 *     (`pct`% con color por materia, delay stagger 0.1s por índice) + star
 *     Top 2 (las 2 de mayor `pct`).
 * Edge:
 *   - sin grupo o sin materias → empty state inline "Sin materias inscritas
 *     en este grupo".
 *   - getter no cargado (orden scripts) → arrays vacíos → empty state.
 *   - Profesor llama `buildGrupoDestaqueProfesor()` en su lugar (sweep en
 *     `buildPerfilCompleto`).
 *   - `#grupo-materias-list` ausente → solo actualiza nombre+rank.
 */
function buildGrupoDestaque() {
    const grupo = (typeof getGrupoAlumno === "function" && APP?.user?.id)
        ? getGrupoAlumno(APP.user.id) : null;
    const materias = (typeof getMateriasAlumno === "function" && APP?.user?.id)
        ? getMateriasAlumno(APP.user.id) : [];

    const groupEl = document.getElementById("grupo-nombre");
    const rankEl  = document.getElementById("grupo-rank");
    if (groupEl) groupEl.textContent = grupo?.nombre || "Sin grupo asignado";
    if (rankEl)  rankEl.textContent  = grupo?.rankCampus || (grupo?.nivel ? `Niv. ${grupo.nivel}` : "—");

    const el = document.getElementById("grupo-materias-list");
    if (!el) return;

    if (!grupo || !materias.length) {
        el.innerHTML = `<div class="x-empty x-empty--inline"><div class="x-empty__title">Sin materias inscritas en este grupo</div></div>`;
        return;
    }

    // Top 2 materias por pct se marcan como "top área"
    const topIds = [...materias].sort((a, b) => (b.pct || 0) - (a.pct || 0)).slice(0, 2).map(m => m.id);

    el.innerHTML = materias.map((m, i) => {
        const pct   = m.pct || 0;
        const color = m.materiaColor || "#00d4ff";
        const isTop = topIds.includes(m.id);
        return `
        <div class="grupo-materia-row">
            <div class="grupo-materia-name">${m.nombre}</div>
            <div class="x-progress" style="flex:1;height:6px">
                <div class="x-progress__fill"
                     style="width:${pct}%;background:${color};--delay:${i * 0.1}s">
                </div>
            </div>
            <div class="grupo-materia-pct">${pct}%</div>
            <div class="grupo-top-star ${isTop ? 'visible' : ''}">⭐</div>
        </div>`;
    }).join("");
}

// ── buildMedallas — Muro de Logros ──────────────────────────
/**
 * @interaction build-medallas
 * @scope perfil-shared-builders-pilar-2
 *
 * Given usuario entra al tab Perfil (alumno o profesor; admin oculta vía
 *   sweep).
 * When `buildPerfilCompleto` dispatcha el builder.
 * Then resuelve `getLogrosAlumno(uid)`, actualiza `#logros-counter` con
 *   "N / Total obtenidos" y renderiza una `.x-medal` por logro con emoji
 *   + nombre + rareza. Cada card abre un toast con detalle al click;
 *   logros bloqueados muestran toast "🔒 Logro bloqueado".
 * Edge:
 *   - container `#medallas-grid` ausente → no-op.
 *   - getter no cargado o sin logros → empty state x-empty con icono ⭐.
 *   - logro sin `rareza`/`color` → fallback "comun" + cyan.
 */
function buildMedallas() {
    const el = document.getElementById("medallas-grid");
    if (!el) return;

    // Sprint 2026-06-08 día 3: profesor no participa del sistema de insignias
    // alumno. Muestra empty state explícito en lugar del catálogo all-locked.
    if (APP?.user?.tipo === "profesor") {
        const counterEl = document.getElementById("logros-counter");
        if (counterEl) counterEl.textContent = "";
        el.innerHTML = `<div class="x-empty" style="grid-column:1/-1">
            <div class="x-empty__icon">🎓</div>
            <div class="x-empty__title">Las insignias se desbloquean con actividad estudiantil</div>
            <div class="x-empty__sub">Tu vista de profesor se enfoca en gestión de materias y competencias.</div>
        </div>`;
        return;
    }

    const logros = (typeof getLogrosAlumno === "function" && APP?.user?.id)
        ? getLogrosAlumno(APP.user.id) : [];

    const desbloqueados = logros.filter(l => l.desbloqueado).length;
    const counterEl = document.getElementById("logros-counter");
    if (counterEl) counterEl.textContent = desbloqueados + " / " + logros.length + " obtenidos";

    if (!logros.length) {
        el.innerHTML = `<div class="x-empty" style="grid-column:1/-1">
            <div class="x-empty__icon">⭐</div>
            <div class="x-empty__title">Aún no hay logros disponibles</div>
        </div>`;
        return;
    }

    el.innerHTML = logros.map(l => {
        const color  = l.color  || "#00d4ff";
        const rareza = l.rareza || "comun";
        const lockedCls = l.desbloqueado ? '' : 'x-medal--locked';
        return `
        <div class="x-medal x-medal--${rareza} ${lockedCls}"
             style="--medal-color:${color}"
             onclick="${l.desbloqueado
                ? `showToast('🎖️ ${l.nombre} — ${rarityLabel(rareza)}', 'success')`
                : `showToast('🔒 Logro bloqueado: sigue jugando para desbloquearlo', 'info')`}">
            <span class="x-medal__emoji">${l.emoji}</span>
            <div class="x-medal__body">
                <div class="x-medal__name">${l.nombre}</div>
                <div class="x-medal__rarity">${rarityLabel(rareza)}</div>
            </div>
        </div>`;
    }).join("");
}

// ── buildPerfilActividad ─────────────────────────────────────
/**
 * @interaction build-perfil-actividad-alumno
 * @scope perfil-shared-builders-pilar-2-alumno
 *
 * Given alumno entra al tab Perfil + `buildPerfilCompleto` rama estudiante.
 * When se renderiza el feed `#perfil-actividad` (timeline).
 * Then resuelve `getActividadAlumno(uid)` y renderiza
 *   `.x-timeline-item` por evento con dot color + icon + texto + tiempo
 *   relativo en español ("Hoy", "Ayer", "Hace N días", "Hace 1 semana",
 *   etc.) derivado de `a.time` o `fmtTime(a.fecha)`.
 * Edge:
 *   - container ausente → no-op.
 *   - sin items o getter no cargado → empty state inline 📡 "Sin actividad
 *     reciente".
 *   - `fmtTime` con fecha inválida → retorna "—".
 *   - Profesor llama `buildPerfilActividadProfesor()` en su lugar.
 */
function buildPerfilActividad() {
    const el = document.getElementById("perfil-actividad");
    if (!el) return;

    const items = (typeof getActividadAlumno === "function" && APP?.user?.id)
        ? getActividadAlumno(APP.user.id) : [];

    if (!items.length) {
        el.innerHTML = `<div class="x-empty x-empty--inline"><div class="x-empty__icon">📡</div><div class="x-empty__title">Sin actividad reciente</div></div>`;
        return;
    }

    // Formato de tiempo relativo en español a partir de la fecha del evento
    const ahora = Date.now();
    const fmtTime = (f) => {
        if (!f) return "—";
        const d = f instanceof Date ? f : new Date(f);
        if (isNaN(d.getTime())) return "—";
        const diffDias = Math.floor((ahora - d.getTime()) / 86400000);
        if (diffDias <= 0) return "Hoy";
        if (diffDias === 1) return "Ayer";
        if (diffDias < 7)   return `Hace ${diffDias} días`;
        if (diffDias < 14)  return "Hace 1 semana";
        if (diffDias < 30)  return `Hace ${Math.floor(diffDias / 7)} semanas`;
        return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
    };

    el.innerHTML = items.map(a => {
        const color = a.color || "var(--text-muted)";
        const icon  = a.icon  || "•";
        const text  = a.text  || "";
        const time  = a.time  || fmtTime(a.fecha);
        return `
        <div class="x-timeline-item" style="--dot-color:${color}">
            <div class="x-timeline-item__text">${icon} ${text}</div>
            <div class="x-timeline-item__time">${time}</div>
        </div>`;
    }).join("");
}

// ── buildPerfilBanner ───────────────────────────────────────
/**
 * @interaction build-perfil-banner
 * @scope perfil-shared-builders-pilar-2
 *
 * Given usuario entra al tab Perfil (cualquier rol).
 * When `buildPerfilCompleto` dispatcha el builder al inicio del render
 *   (paso 4 del orchestrator).
 * Then renderiza 18 `<div class="particle">` en `#perfil-particles` con
 *   posición X random (0-100%), tamaño 2-6px, duración 4-10s, delay 0-6s,
 *   drift horizontal random (-30..+30px) y color rotando entre la paleta
 *   brand (cyan/blue/purple/amber/teal). Cada partícula tiene box-shadow
 *   glow proporcional.
 * Edge:
 *   - container ausente → no-op.
 *   - llamadas múltiples → reescribe innerHTML (no acumula partículas).
 */
function buildPerfilBanner() {
    const container = document.getElementById("perfil-particles");
    if (!container) return;
    const colors = ["#00d4ff", "#1b4fe4", "#8b2be2", "#f5a623", "#00c6a7"];
    container.innerHTML = Array.from({ length: 18 }, (_, i) => {
        const x = Math.random() * 100;
        const size = 2 + Math.random() * 4;
        const dur = 4 + Math.random() * 6;
        const del = Math.random() * 6;
        const drft = (Math.random() - 0.5) * 60;
        const col = colors[i % colors.length];
        return `<div class="particle" style="
            left:${x}%;bottom:0;
            width:${size}px;height:${size}px;
            background:${col};
            box-shadow:0 0 6px ${col};
            animation-duration:${dur}s;
            animation-delay:${del}s;
            --drift:${drft}px;
        "></div>`;
    }).join("");
}

// ═══════════════════════════════════════════════════════════
// ESTADÍSTICAS Y PROGRESO — Comparativa + Sistema de Rangos
// ═══════════════════════════════════════════════════════════

// ── Definición de rangos ─────────────────────────────────────
const RANGOS = [
    { id: "bronce", emoji: "🥉", label: "Bronce", xpMin: 0, xpMax: 500, color: "#cd7f32", glow: "rgba(205,127,50,.45)", grad: "linear-gradient(135deg,#3d2000,#7a4010)" },
    { id: "plata", emoji: "🥈", label: "Plata", xpMin: 500, xpMax: 1000, color: "#c0c0c0", glow: "rgba(192,192,192,.45)", grad: "linear-gradient(135deg,#1a1a1a,#3d3d3d)" },
    { id: "oro", emoji: "🥇", label: "Oro", xpMin: 1000, xpMax: 2000, color: "#f5a623", glow: "rgba(245,166,35,.5)", grad: "linear-gradient(135deg,#1a0e00,#3d2a00)" },
    { id: "platino", emoji: "💠", label: "Platino", xpMin: 2000, xpMax: 3500, color: "#00d4ff", glow: "rgba(0,212,255,.45)", grad: "linear-gradient(135deg,#001a22,#003344)" },
    { id: "diamante", emoji: "💎", label: "Diamante", xpMin: 3500, xpMax: 9999, color: "#a855f7", glow: "rgba(168,85,247,.5)", grad: "linear-gradient(135deg,#0e0022,#220044)" },
];

// Spec A 2026-06-09: historial de temporadas vive en GamerState.temporadasHistorial
// por uid. El renderer del bloque lo consume directamente (ver buildRangoSection).

/**
 * @interaction calcular-comparativa
 * @scope shared-helper-internal
 *
 * Given alumno logueado y `getComparativaAlumno(uid)` disponible (cross-file
 *   getter que deriva de DEMO_USERS + DEMO_TAREAS).
 * When `buildComparativaGrupo` necesita el array para renderizar las
 *   barras dobles yo vs promedio del grupo.
 * Then delega a `getComparativaAlumno(APP.user.id)` y retorna el array
 *   `[{materia, yo, grupo, color}, ...]`.
 * Edge:
 *   - getter no cargado o sin usuario → array vacío (caller muestra skeleton).
 *   - promedio del grupo = media real de los compañeros que cursan la misma
 *     materia (no hardcoded).
 */
function _calcularComparativa() {
    if (typeof getComparativaAlumno === "function" && APP?.user?.id) {
        return getComparativaAlumno(APP.user.id);
    }
    return [];
}

// Lee XP en vivo desde APP.user; racha desde progreso.json vía getter
/**
 * @interaction xp-actual
 * @scope shared-helper-internal
 *
 * Given el usuario está logueado (`APP.user` definido).
 * When `buildRangoSection` necesita el XP vivo del usuario.
 * Then retorna `APP.user.puntos` o 0 si falsy.
 * Edge sin sesión → 0 (cae en rango Bronce).
 */
function _xpActual() {
    // Spec A 2026-06-09: el rango escala con XP de competencias (no XP total).
    // Sin xpCompetencias persistida (user nuevo o pre-Spec A), retorna 0.
    if (typeof GamerState !== "undefined" && APP?.user?.id) {
        return GamerState.get(APP.user.id).xpCompetencias || 0;
    }
    return 0;
}
/**
 * @interaction racha-dias
 * @scope shared-helper-internal
 *
 * Given el usuario está logueado.
 * When `buildRangoSection` necesita los días de racha actual.
 * Then prefiere `getRachaAlumno(uid).actual` (DataService getter cross-file);
 *   fallback a `APP.user.racha`; fallback final 0.
 * Edge sin sesión o getter ausente → 0 (visual muestra ❄️ "Sin racha").
 */
function _rachaDias()  {
    if (typeof getRachaAlumno === "function" && APP?.user?.id) {
        return getRachaAlumno(APP.user.id).actual;
    }
    return APP.user?.racha || 0;
}

// ── Calcula el rango a partir de XP ─────────────────────────
/**
 * @interaction calcular-rango
 * @scope shared-helper-canonical
 *
 * Given un valor de XP numérico.
 * When `buildRangoSection` (mismo módulo) o `buildPerfilPublico` (cross-file
 *   en perfil-identidad.js) necesitan resolver el rango actual del usuario.
 * Then itera `RANGOS` en orden inverso (Diamante → Bronce) y retorna el
 *   primer rango cuyo `xpMin <= xp`. Fallback `RANGOS[0]` (Bronce).
 * Edge:
 *   - `xp` NaN/undefined → `xp >= r.xpMin` falla en todos → fallback Bronce.
 *   - `xp` negativo → fallback Bronce.
 *   - `xp` muy alto (>9999) → cae en Diamante (último rango, `xpMax: 9999`
 *     no acota el upper bound porque `find` evalúa solo `xpMin`).
 */
function calcularRango(xp) {
    return RANGOS.slice().reverse().find(r => xp >= r.xpMin) || RANGOS[0];
}

// ── buildRangoSection ────────────────────────────────────────
/**
 * @interaction build-rango-section
 * @scope perfil-shared-builders-pilar-2
 *
 * Given usuario entra al tab Perfil (alumno o profesor — admin sweep oculta).
 * When `buildPerfilCompleto` dispatcha el builder (paso 10).
 * Then resuelve XP vivo + racha + rango actual + siguiente rango y renderiza
 *   `#rango-section` con:
 *   - fondo gradient + glow radial del color del rango.
 *   - emblema del rango (anillos concéntricos + emoji central).
 *   - barra de progreso hacia siguiente rango con pct = (xp-xpMin) /
 *     (siguienteMin-xpMin), label "X / Y XP · Faltan N XP" o "¡Rango máximo!"
 *     si ya es Diamante.
 *   - historial de temporadas (GamerState.temporadasHistorial por uid) con chip
 *     "Actual" para la temporada vigente.
 *   - card de racha con 🔥 (activa ≥7 días) o ❄️ + bonus "+5N XP".
 *   - chip rápido `#perfil-qs-rango` en quickstats con emoji+label+glow.
 *   - miniature de próximos rangos (5 items con highlight current/reached).
 * Edge:
 *   - container ausente → no-op.
 *   - quickstats chip ausente → omite actualización sin error.
 *   - rango actual = Diamante (último) → siguiente = mismo, pct 100,
 *     muestra "Máximo" + "¡Rango máximo!".
 *   - racha 0 → muestra ❄️ "Sin racha" (no badge ¡Activa! ni bonus).
 */
function buildRangoSection() {
    // Spec A 2026-06-09: verifica cambio de temporada antes del render.
    // Si detecta cambio, snapshot al historial + reset xpCompetencias.
    if (typeof _verificarCambioTemporada === "function" && APP?.user?.id) {
        _verificarCambioTemporada(APP.user.id);
    }

    const el = document.getElementById("rango-section");
    if (!el) return;

    const xp = _xpActual();
    const racha = _rachaDias();
    const rango = calcularRango(xp);
    const siguiente = RANGOS[RANGOS.indexOf(rango) + 1] || rango;
    const xpEnRango = xp - rango.xpMin;
    const xpTotal = siguiente.xpMin - rango.xpMin || 1;
    const pct = Math.min(100, Math.round((xpEnRango / xpTotal) * 100));
    const rachaActiva = racha >= 7;

    // Actualizar chip rápido en quickstats
    const qsEmoji = document.getElementById("perfil-qs-rango-emoji");
    const qsLabel = document.getElementById("perfil-qs-rango-label");
    const qsItem = document.getElementById("perfil-qs-rango");
    if (qsEmoji) qsEmoji.textContent = rango.emoji;
    if (qsLabel) qsLabel.textContent = rango.label;
    if (qsItem) qsItem.style.setProperty("--rango-glow", rango.glow);

    el.innerHTML = `
    <div class="rango-card">
        <!-- Fondo gradiente del rango -->
        <div class="rango-card-bg" style="background:${rango.grad}"></div>
        <div class="rango-card-glow" style="background:radial-gradient(ellipse 60% 80% at 10% 50%,${rango.glow},transparent)"></div>

        <div class="rango-card-content">

            <!-- Emblema + info del rango -->
            <div class="rango-emblema-wrap">
                <div class="rango-emblema" style="--rango-color:${rango.color};--rango-glow:${rango.glow}">
                    ${rango.emoji}
                </div>
                <div class="rango-emblema-anillo" style="border-color:${rango.color}40"></div>
                <div class="rango-emblema-anillo rango-emblema-anillo-2" style="border-color:${rango.color}20"></div>
            </div>

            <!-- Info central -->
            <div class="rango-info">
                <div class="rango-label-small">Rango actual</div>
                <div class="rango-nombre" style="color:${rango.color}">${rango.label}</div>

                <!-- Barra hacia siguiente rango -->
                <div class="rango-progress-wrap">
                    <div class="rango-progress-labels">
                        <span style="font-size:10px;color:var(--text-muted)">${rango.label}</span>
                        <span style="font-size:10px;color:var(--text-muted)">${siguiente.label === rango.label ? 'Máximo' : siguiente.label}</span>
                    </div>
                    <div class="x-progress" style="height:8px;background:rgba(0,0,0,0.4)">
                        <div class="x-progress__fill" style="width:${pct}%;background:${rango.color};box-shadow:0 0 8px ${rango.glow}"></div>
                    </div>
                    <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-top:4px">
                        ${xp.toLocaleString()} / ${siguiente.xpMin.toLocaleString()} XP
                        ${siguiente !== rango ? `· Faltan <span style="color:${rango.color};font-weight:700">${(siguiente.xpMin - xp).toLocaleString()} XP</span>` : '· <span style="color:#f5a623">¡Rango máximo!</span>'}
                    </div>
                </div>

                <!-- Historial de temporadas -->
                <div class="rango-temporadas">
                    <div class="rango-temporadas-label">Historial de temporadas</div>
                    <div class="rango-temporadas-row">
                        ${(() => {
                            const _uid = APP?.user?.id;
                            const _gs = (typeof GamerState !== "undefined" && _uid) ? GamerState.get(_uid) : null;
                            const historial = _gs ? (_gs.temporadasHistorial || []) : [];
                            const temporadaActual = _gs ? (_gs.temporadaId || null) : null;
                            const _rangoEmoji = rango ? rango.emoji : "🥉";
                            if (historial.length === 0) {
                                return `<div class="rango-temporada-chip actual" style="opacity:0.85">
                                    <span>${_rangoEmoji}</span>
                                    <div>
                                        <div style="font-size:10px;font-weight:700;color:var(--text-primary)">${(temporadaActual || "Temporada actual").replace(/</g, "&lt;")}</div>
                                        <div style="font-size:9px;color:var(--text-muted);font-family:var(--font-mono)">${xp.toLocaleString()} XP</div>
                                    </div>
                                    <span class="rango-actual-chip">En curso</span>
                                </div>
                                <div style="font-size:10px;color:var(--text-muted);font-style:italic;margin-left:8px;align-self:center">Sin temporadas anteriores</div>`;
                            }
                            const chips = historial.map(t => {
                                const rangoLabel = t.rango || "";
                                const cerradaStr = t.cerradaEn
                                    ? new Date(t.cerradaEn).toLocaleDateString("es-MX", {day:"2-digit",month:"short",year:"numeric"})
                                    : "";
                                const tId = (t.temporadaId || "—").replace(/</g, "&lt;");
                                return `<div class="rango-temporada-chip" title="${cerradaStr ? "Cerrada el " + cerradaStr : ""}">
                                    <span>${_rangoEmoji}</span>
                                    <div>
                                        <div style="font-size:10px;font-weight:700;color:var(--text-primary)">${tId}</div>
                                        <div style="font-size:9px;color:var(--text-muted);font-family:var(--font-mono)">${(t.xpCompetencias || 0).toLocaleString()} XP${rangoLabel ? " · " + rangoLabel : ""}</div>
                                    </div>
                                </div>`;
                            }).join("");
                            const actualChip = temporadaActual
                                ? `<div class="rango-temporada-chip actual" title="Temporada vigente">
                                    <span>${_rangoEmoji}</span>
                                    <div>
                                        <div style="font-size:10px;font-weight:700;color:var(--text-primary)">${temporadaActual.replace(/</g, "&lt;")}</div>
                                        <div style="font-size:9px;color:var(--text-muted);font-family:var(--font-mono)">${xp.toLocaleString()} XP</div>
                                    </div>
                                    <span class="rango-actual-chip">Actual</span>
                                </div>`
                                : "";
                            return chips + actualChip;
                        })()}
                    </div>
                </div>
            </div>

            <!-- Racha activa -->
            <div class="rango-racha-wrap">
                <div class="rango-racha-card ${rachaActiva ? 'activa' : ''}">
                    <div class="rango-racha-fuego">${rachaActiva ? '🔥' : '❄️'}</div>
                    <div class="rango-racha-num" style="color:${rachaActiva ? '#e84040' : 'var(--text-muted)'}">${racha}</div>
                    <div class="rango-racha-label">días de racha</div>
                    ${rachaActiva ? `
                    <div class="rango-racha-badge">¡Activa!</div>
                    <div class="rango-racha-sub">+${racha * 5} XP bonus</div>` : `
                    <div class="rango-racha-sub" style="color:var(--text-muted)">Sin racha</div>`}
                </div>

                <!-- Próximos rangos -->
                <div class="rango-proximos">
                    ${RANGOS.map(r => {
        const esCurrent = r.id === rango.id;
        const alcanzado = xp >= r.xpMin;
        return `<div class="rango-proximo-item ${esCurrent ? 'current' : ''} ${alcanzado ? 'reached' : ''}"
                                     style="--rc:${r.color}" title="${r.label}">
                            <span>${r.emoji}</span>
                            <span style="font-size:8px;color:${alcanzado ? r.color : 'var(--text-muted)'}">${r.label}</span>
                        </div>`;
    }).join("")}
                </div>
            </div>

        </div>
    </div>`;
}

// ── buildComparativaGrupo ────────────────────────────────────
let _comparativaRetryTimer = null;
/**
 * @interaction build-comparativa-grupo
 * @scope perfil-shared-builders-pilar-2-alumno
 *
 * Given alumno entra al tab Perfil (no profesor ni admin — sweep oculta).
 * When `buildPerfilCompleto` dispatcha el builder (paso 10).
 * Then evalúa `_calcularComparativa()` (deriva de DEMO_USERS+DEMO_TAREAS):
 *   - **Sin datos** → renderiza skeleton + arma `_comparativaRetryTimer`
 *     (400ms) que re-llama el builder (race contra DataService async load).
 *   - **Con datos** → cancela retry pendiente y renderiza:
 *     - Leyenda (yo vs promedio del grupo).
 *     - Barras dobles por materia: barra YO con color de la materia +
 *       glow, barra GRUPO con surface-4 neutro; valor numérico + chip
 *       diff (+verde / -rojo).
 *     - Resumen 4-col: materias por encima / por debajo / mi promedio /
 *       promedio grupo.
 * Edge:
 *   - container ausente → no-op (sin retry).
 *   - retry encadenado → callback verifica que container siga presente
 *     antes de re-llamar (cambio de tab durante timeout).
 *   - data con 1 sola materia → resumen muestra los 4 stats con base 1
 *     (promedios = ese único valor).
 */
function buildComparativaGrupo() {
    const el = document.getElementById("comparativa-grupo-wrap");
    if (!el) return;

    const COMPARATIVA_DATA = _calcularComparativa();
    const maxVal = 100;

    if (!COMPARATIVA_DATA.length) {
        el.innerHTML = `<div class="x-skeleton x-skeleton--card"></div>`;
        // Race contra DataService: si los datos aún no están listos, reintentar una vez.
        if (!_comparativaRetryTimer) {
            _comparativaRetryTimer = setTimeout(() => {
                _comparativaRetryTimer = null;
                if (document.getElementById("comparativa-grupo-wrap")) buildComparativaGrupo();
            }, 400);
        }
        return;
    }
    if (_comparativaRetryTimer) {
        clearTimeout(_comparativaRetryTimer);
        _comparativaRetryTimer = null;
    }

    el.innerHTML = `
    <div class="comparativa-wrap">
        <!-- Leyenda -->
        <div class="comparativa-leyenda">
            <div class="comparativa-leyenda-item">
                <div class="comparativa-leyenda-dot" style="background:var(--brand-gradient-h)"></div>
                <span>Yo</span>
            </div>
            <div class="comparativa-leyenda-item">
                <div class="comparativa-leyenda-dot" style="background:var(--surface-4);border:1px solid var(--border-bright)"></div>
                <span>Promedio del grupo</span>
            </div>
        </div>

        <!-- Barras dobles por materia -->
        <div class="comparativa-bars">
            ${COMPARATIVA_DATA.map((d, i) => {
        const diff = d.yo - d.grupo;
        const diffLabel = diff >= 0
            ? `<span style="color:var(--xahni-green);font-size:10px;font-family:var(--font-mono)">+${diff}%</span>`
            : `<span style="color:var(--xahni-red);font-size:10px;font-family:var(--font-mono)">${diff}%</span>`;
        return `
                <div class="comparativa-row" style="--delay:${i * 0.08}s">
                    <div class="comparativa-materia">${d.materia}</div>
                    <div class="comparativa-dual">
                        <!-- Barra YO -->
                        <div class="comparativa-bar-wrap">
                            <div class="x-progress" style="flex:1;height:100%">
                                <div class="x-progress__fill" style="width:${d.yo}%;background:${d.color};box-shadow:0 0 8px ${d.color}60;animation-delay:${i * 0.1}s"></div>
                            </div>
                            <span class="comparativa-val" style="color:${d.color}">${d.yo}%</span>
                        </div>
                        <!-- Barra GRUPO -->
                        <div class="comparativa-bar-wrap">
                            <div class="x-progress" style="flex:1;height:100%">
                                <div class="x-progress__fill" style="width:${d.grupo}%;background:var(--surface-4);box-shadow:inset 0 0 0 1px var(--border-bright);animation-delay:${i * 0.1 + 0.05}s"></div>
                            </div>
                            <span class="comparativa-val" style="color:var(--text-muted)">${d.grupo}%</span>
                        </div>
                    </div>
                    <div class="comparativa-diff">${diffLabel}</div>
                </div>`;
    }).join("")}
        </div>

        <!-- Resumen -->
        <div class="comparativa-resumen">
            ${(() => {
            const superior = COMPARATIVA_DATA.filter(d => d.yo > d.grupo).length;
            const igual = COMPARATIVA_DATA.filter(d => d.yo === d.grupo).length;
            const inferior = COMPARATIVA_DATA.filter(d => d.yo < d.grupo).length;
            const promedioYo = Math.round(COMPARATIVA_DATA.reduce((s, d) => s + d.yo, 0) / COMPARATIVA_DATA.length);
            const promedioGrupo = Math.round(COMPARATIVA_DATA.reduce((s, d) => s + d.grupo, 0) / COMPARATIVA_DATA.length);
            return `
                <div class="comparativa-resumen-item">
                    <div class="comparativa-resumen-num" style="color:var(--xahni-green)">${superior}</div>
                    <div class="comparativa-resumen-label">Por encima del grupo</div>
                </div>
                <div class="comparativa-resumen-item">
                    <div class="comparativa-resumen-num" style="color:var(--xahni-red)">${inferior}</div>
                    <div class="comparativa-resumen-label">Por debajo del grupo</div>
                </div>
                <div class="comparativa-resumen-item">
                    <div class="comparativa-resumen-num" style="color:var(--accent-cyan-text)">${promedioYo}%</div>
                    <div class="comparativa-resumen-label">Mi promedio general</div>
                </div>
                <div class="comparativa-resumen-item">
                    <div class="comparativa-resumen-num" style="color:var(--text-secondary)">${promedioGrupo}%</div>
                    <div class="comparativa-resumen-label">Promedio del grupo</div>
                </div>`;
        })()}
        </div>
    </div>`;
}

// ── INSIGNIAS DE COLABORACIÓN ────────────────────────────────
const INSIGNIAS_COLABORACION = [
    { emoji: "🤝", nombre: "Colaborador Nato", desc: "Ayudaste a 5 compañeros en grupos", color: "#00d4ff", desbloqueado: false, qty: 23 },
    { emoji: "💬", nombre: "Voz del Grupo", desc: "Participaste en 50 discusiones de grupo", color: "#22c55e", desbloqueado: false, qty: 50 },
    { emoji: "📢", nombre: "Embajador", desc: "Invitaste a 3 compañeros a tus grupos", color: "#f5a623", desbloqueado: false, qty: 3 },
    { emoji: "🎓", nombre: "Mentor", desc: "Un compañero mejoró su nota gracias a ti", color: "#a855f7", desbloqueado: false, qty: 1 },
    { emoji: "⭐", nombre: "Reconocido x10", desc: "Recibiste 10 reconocimientos de compañeros", color: "#f5a623", desbloqueado: false, qty: 12 },
    { emoji: "🏅", nombre: "Colaborador Épico", desc: "Recibiste reconocimientos de 5 profesores", color: "#a855f7", desbloqueado: false, qty: 2 },
    { emoji: "🌟", nombre: "Influencer Académico", desc: "Tu actividad inspiró a 10 compañeros", color: "#00d4ff", desbloqueado: false, qty: 0 },
    { emoji: "🦉", nombre: "Sabio del Campus", desc: "Respondiste 100 preguntas en foros", color: "#00c6a7", desbloqueado: false, qty: 0 },
];

/**
 * @interaction build-insignias-colaboracion
 * @scope perfil-shared-builders-pilar-2
 *
 * Given usuario entra al tab Perfil (alumno o profesor; admin oculta).
 * When `buildPerfilCompleto` dispatcha el builder (paso 11).
 * Then renderiza `#insignias-colaboracion-grid` con las 8 insignias
 *   hardcoded de `INSIGNIAS_COLABORACION` como `.x-medal` (color + emoji
 *   + nombre + descripción + qty si desbloqueada y >0). Actualiza
 *   `#insignias-counter` con "N / 8 obtenidas". Cards bloqueadas reciben
 *   `.x-medal--locked` y toast "🔒".
 * Edge:
 *   - container `#insignias-colaboracion-grid` ausente → no-op.
 *   - counter `#insignias-counter` ausente → omite actualización sin error.
 *   - lógica real de colaboración (post-Supabase) reemplazará el array
 *     hardcoded; el render del builder permanece igual.
 */
function buildInsigniasColaboracion() {
    const el = document.getElementById("insignias-colaboracion-grid");
    if (!el) return;

    const total = INSIGNIAS_COLABORACION.length;
    const obtenidas = INSIGNIAS_COLABORACION.filter(i => i.desbloqueado).length;
    const counterEl = document.getElementById("insignias-counter");
    if (counterEl) counterEl.textContent = `${obtenidas} / ${total} obtenidas`;

    el.innerHTML = `
    <div class="x-grid">
        ${INSIGNIAS_COLABORACION.map(ins => {
            const lockedCls = ins.desbloqueado ? '' : 'x-medal--locked';
            return `
        <div class="x-medal ${lockedCls}"
             style="--medal-color:${ins.color}"
             onclick="${ins.desbloqueado
            ? `showToast('${ins.emoji} ${ins.nombre}: ${ins.desc}','success')`
            : `showToast('🔒 ${ins.nombre}: ${ins.desc}','info')`}">
            <span class="x-medal__emoji">${ins.emoji}</span>
            <div class="x-medal__body">
                <div class="x-medal__name">${ins.nombre}</div>
                <div class="x-medal__desc">${ins.desc}</div>
            </div>
            ${ins.desbloqueado && ins.qty > 0
            ? `<div class="x-medal__qty">×${ins.qty}</div>`
            : ''}
        </div>`;
        }).join("")}
    </div>`;
}

// ═══════════════════════════════════════════════════════════
// VARIANTES PROFESOR — overrides para rol "profesor"
// ═══════════════════════════════════════════════════════════

/**
 * @interaction build-grupo-destaque-profesor
 * @scope perfil-shared-builders-pilar-2-profesor
 *
 * Given profesor entra al tab Perfil + `buildPerfilCompleto` rama profesor
 *   (sweep oculta `buildGrupoDestaque` original).
 * When se renderiza la card de "Mis Materias" reusando los nodos del
 *   `grupo-card` del alumno (label/value/icon swap in-place).
 * Then resuelve `getMateriasProfesor(uid)` y:
 *   - reemplaza label "Grupo" → "Mis Materias", value → "Materias
 *     activas" / "Sin materias asignadas", icono → 📚, rank → cantidad de
 *     materias, label rank → "materias activas".
 *   - en `#grupo-materias-list` renderiza una row por materia con
 *     barra de progreso proxy (gruposCount * 34%, cap 100), pct label
 *     "N grupo(s) · N alumno(s)" usando paleta rotativa de 6 colores.
 * Edge:
 *   - sin materias → empty state inline.
 *   - getter no cargado → arrays vacíos → empty state.
 *   - elementos hermano (`previousElementSibling` / `nextElementSibling`)
 *     no encontrados → omite el swap de label/value y mantiene el HTML
 *     original.
 *   - alumno NO llega aquí (sweep usa `buildGrupoDestaque` en su lugar).
 */
function buildGrupoDestaqueProfesor() {
    const uid     = APP.user?.id;
    const groupEl = document.getElementById("grupo-nombre");
    const rankEl  = document.getElementById("grupo-rank");
    const el      = document.getElementById("grupo-materias-list");

    const mis = (typeof getMateriasProfesor === "function" && uid)
        ? getMateriasProfesor(uid) : [];

    // Cambiar etiquetas del encabezado de la tarjeta
    if (groupEl) {
        const labelEl = groupEl.previousElementSibling;
        if (labelEl) labelEl.textContent = "Mis Materias";
        groupEl.textContent = mis.length ? "Materias activas" : "Sin materias asignadas";
    }
    if (rankEl) {
        rankEl.textContent = mis.length;
        const rankLabelEl = rankEl.nextElementSibling;
        if (rankLabelEl) rankLabelEl.innerHTML = "materias<br/>activas";
    }
    // Ícono
    const iconEl = document.getElementById("grupo-nombre")
        ?.closest?.(".grupo-name-badge")?.querySelector?.(".grupo-icon");
    if (iconEl) iconEl.textContent = "📚";

    if (!el) return;

    const palette = ["#00d4ff", "#1b4fe4", "#00c6a7", "#8b2be2", "#f5a623", "#22c55e"];
    el.innerHTML = mis.length
        ? mis.map((m, i) => {
            const grupos = m.gruposCount || 0;
            const col    = palette[i % palette.length];
            const pct    = Math.min(100, grupos * 34);
            const alumnosTxt = m.totalAlumnos
                ? ` · ${m.totalAlumnos} alumno${m.totalAlumnos !== 1 ? 's' : ''}`
                : '';
            return `
            <div class="grupo-materia-row">
                <div class="grupo-materia-name">${m.nombre}</div>
                <div class="x-progress" style="flex:1;height:6px">
                    <div class="x-progress__fill"
                         style="width:${pct}%;background:${col};--delay:${i * 0.1}s"></div>
                </div>
                <div class="grupo-materia-pct">${grupos} grupo${grupos !== 1 ? 's' : ''}${alumnosTxt}</div>
                <div class="grupo-top-star"></div>
            </div>`;
        }).join("")
        : '<div class="x-empty x-empty--inline"><div class="x-empty__title">Sin materias asignadas</div></div>';
}

/**
 * @interaction build-perfil-actividad-profesor
 * @scope perfil-shared-builders-pilar-2-profesor
 *
 * Given profesor entra al tab Perfil + `buildPerfilCompleto` rama profesor
 *   (sweep oculta `buildPerfilActividad` alumno).
 * When se renderiza el feed `#perfil-actividad` (timeline).
 * Then resuelve `getActividadProfesor(uid, 5)` (últimos 5 eventos) y
 *   renderiza `.x-timeline-item` por evento con dot color de paleta
 *   rotativa cyan/blue/teal/purple/amber, formato:
 *   "📝 <strong>Nombre</strong> entregó <strong>Tarea</strong> · cal/10"
 *   y fecha corta es-MX "DD MMM".
 * Edge:
 *   - container ausente → no-op.
 *   - sin eventos o getter no cargado → empty state 📡 "Sin actividad
 *     reciente".
 *   - `ev.calificacion` null/undefined → omite el "· N/10".
 *   - `ev.alumnoNombre` falsy → fallback a `ev.alumnoId`.
 *   - alumno NO llega aquí (sweep usa `buildPerfilActividad`).
 */
function buildPerfilActividadProfesor() {
    const el = document.getElementById("perfil-actividad");
    if (!el) return;

    const uid       = APP.user?.id;
    const recientes = (typeof getActividadProfesor === "function" && uid)
        ? getActividadProfesor(uid, 5) : [];

    if (!recientes.length) {
        el.innerHTML = '<div class="x-empty x-empty--inline"><div class="x-empty__icon">📡</div><div class="x-empty__title">Sin actividad reciente</div></div>';
        return;
    }

    const colors = ["var(--xahni-cyan)", "var(--xahni-blue)", "var(--xahni-teal)", "var(--xahni-purple)", "var(--xahni-amber)"];
    el.innerHTML = recientes.map((ev, i) => {
        const nombre     = ev.alumnoNombre || ev.alumnoId;
        const calText    = ev.calificacion != null ? ` · ${ev.calificacion}/10` : "";
        const fechaCorta = ev.fecha.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
        return `
        <div class="x-timeline-item" style="--dot-color:${colors[i % colors.length]}">
            <div class="x-timeline-item__text">📝 <strong>${nombre}</strong> entregó <strong>${ev.tareaTitulo}</strong>${calText}</div>
            <div class="x-timeline-item__time">${fechaCorta}</div>
        </div>`;
    }).join("");
}

// ═══════════════════════════════════════════════════════════
// SLICE H1 B.1 · Widget "Maestrías destacadas" en Mi perfil
// ═══════════════════════════════════════════════════════════

/**
 * @interaction build-maestrias-widget
 * @scope perfil-shared-builders-pilar-2-alumno
 *
 * Given el alumno entra a Mi perfil (rol === "estudiante").
 * When `buildPerfilCompleto` dispatcha el builder (paso 8) o el listener
 *   de `xahni:top3MaestriaChanged` refresca tras curaduría aplicada en el
 *   modal selector Top 3 (Slice H2a).
 * Then el container `#perfil-maestrias-widget` recibe el markup del widget
 *   (header trophy + score strip total + 3 slots Top 3 + foot disabled)
 *   producido por `_renderMaestriaWidget(uid)`.
 *   Canonical id field es `APP.user.id`; fallback a `APP.user.uid` por defensa.
 * Edge:
 *   - container ausente → no-op silencioso.
 *   - `APP.user` falsy → no-op.
 *   - rol distinto de estudiante → container vacío + `display:none` (profesor
 *     y admin no muestran widget porque maestría es alumno-only en este pilar).
 *   - `_renderMaestriaWidget` no cargada (orden scripts) → container vacío.
 */
function buildMaestriasWidget() {
    const el = document.getElementById("perfil-maestrias-widget");
    if (!el) return;
    if (!APP || !APP.user || APP.user.tipo !== "estudiante") {
        el.innerHTML = "";
        el.style.display = "none";
        return;
    }
    el.style.display = "";
    // Canonical id field es APP.user.id (no uid) — el login real
    // (auth.js handleLoginDemo) hace APP.user = {...userObj} donde userObj
    // tiene `id` per data/demo/usuarios.json. Fallback a uid por defensa.
    const uid = APP.user.id || APP.user.uid;
    el.innerHTML = (typeof _renderMaestriaWidget === "function")
        ? _renderMaestriaWidget(uid)
        : "";
}

// Slice H2a · Listener para refresh del widget cuando el alumno aplica
// una nueva curaduría desde el modal #modal-top3-maestria-selector.
// El selector module dispara `xahni:top3MaestriaChanged` tras persistir.
// Guard para evitar registrar el listener más de una vez si perfil.js
// se carga múltiples veces.
if (!window.__xahniTop3MaestriaListenerRegistered) {
    document.addEventListener("xahni:top3MaestriaChanged", () => {
        if (typeof buildMaestriasWidget === "function") {
            buildMaestriasWidget();
        }
    });
    window.__xahniTop3MaestriaListenerRegistered = true;
}
