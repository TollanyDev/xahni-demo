/**
 * @interaction hub-inicio-paint-banner
 * @scope shared (alumno + profesor)
 *
 * Given un user object con id.
 * When hubInicioRender{Est|Prof} finaliza el innerHTML, o cuando el evento
 *   avatarChanged dispara para el uid activo.
 * Then aplica bannerBg (background) al hijo .perfil-banner-bg (alineado con
 *   _renderAvatarFromState que pinta el bg en el hijo, no el wrapper) y
 *   bannerGlow (box-shadow) al wrapper #hub-inicio-banner.
 * Edge si no hay banner config, deja el background default del perfil-banner.
 */
function _hubInicioPaintBanner(u) {
    const wrapper = document.getElementById("hub-inicio-banner");
    if (!wrapper) return;
    const disp = (typeof getAvatarDisplay === "function") ? getAvatarDisplay(u.id) : null;
    // Slice menor Hero alignment (2026-06-01): apuntar el bg al hijo
    // .perfil-banner-bg (consistente con Mi perfil) en lugar del wrapper
    // padre. El glow del banner sigue en el wrapper porque el box-shadow
    // necesita la posición del padre que contiene grid + shine + emblem.
    const bgEl = wrapper.querySelector(".perfil-banner-bg");
    if (bgEl && disp?.bannerBg) bgEl.style.background = disp.bannerBg;
    if (disp?.bannerGlow) wrapper.style.boxShadow = disp.bannerGlow;
}

/**
 * @interaction hub-inicio-paint-avatar-marco
 * @scope shared (alumno + profesor)
 *
 * Given el panel Inicio recién montado y el user activo.
 * When hubInicioRender{Est|Prof} finaliza el innerHTML.
 * Then aplica box-shadow + animation extraídos de getAvatarDisplay(uid).marcoCss
 *   sobre #hub-inicio-marco-overlay.
 * Edge si no hay marcoCss disponible, deja el overlay sin estilos.
 */
function _hubInicioPaintAvatarMarco(u) {
    const overlay = document.getElementById("hub-inicio-marco-overlay");
    if (!overlay) return;
    const disp = (typeof getAvatarDisplay === "function") ? getAvatarDisplay(u.id) : null;
    if (!disp || !disp.marcoCss) {
        overlay.style.boxShadow = "";
        overlay.style.animation = "";
        return;
    }
    const m = disp.marcoCss.match(/box-shadow:([^;]+)/);
    overlay.style.boxShadow = m ? m[1].trim() : "";
    const anim = disp.marcoCss.match(/animation:([^;]+)/);
    overlay.style.animation = anim ? anim[1].trim() : "";
}

/**
 * @interaction hub-inicio-build-particles
 * @scope shared (alumno + profesor)
 *
 * Given el banner recién montado con #hub-inicio-particles.
 * When hubInicioRender{Est|Prof} finaliza el innerHTML.
 * Then inyecta 14 partículas flotantes (espejo de buildPerfilBanner de perfil.js
 *   pero con id propio).
 * Edge si el container no existe, retorna sin error.
 */
function _hubInicioBuildParticles() {
    const container = document.getElementById("hub-inicio-particles");
    if (!container) return;
    const colors = ["#00d4ff", "#1b4fe4", "#8b2be2", "#f5a623", "#00c6a7"];
    container.innerHTML = Array.from({ length: 14 }, (_, i) => {
        const x = Math.random() * 100;
        const size = 2 + Math.random() * 3;
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

/**
 * @interaction hub-inicio-materia-nombre
 * @scope shared-hub-inicio-helper-canonical
 *
 * Given un materiaId (string).
 * When un caller (cards de materia destacada, próxima clase, próxima
 *   tarea del panel Inicio) necesita el nombre legible de la materia.
 * Then busca en DEMO_MATERIAS primero, luego MATERIAS_DATA legacy.
 *   Retorna `m.nombre` o `materiaId` como fallback de defensa.
 * Edge:
 *   - DEMO_MATERIAS y MATERIAS_DATA no cargados → retorna materiaId.
 *   - Materia sin nombre (legacy) → retorna materiaId.
 *   - Doble lookup soporta transición pre-data-service vs post-Supabase.
 */
function _hubInicioMateriaNombre(materiaId) {
    if (typeof DEMO_MATERIAS !== "undefined" && Array.isArray(DEMO_MATERIAS)) {
        const m = DEMO_MATERIAS.find(x => x.id === materiaId);
        if (m) return m.nombre || materiaId;
    }
    if (typeof MATERIAS_DATA !== "undefined" && Array.isArray(MATERIAS_DATA)) {
        const m = MATERIAS_DATA.find(x => x.id === materiaId);
        if (m) return m.nombre || materiaId;
    }
    return materiaId;
}

/**
 * @interaction hub-inicio-materia-color
 * @scope shared-hub-inicio-helper-canonical
 *
 * Given un materiaId.
 * When un caller necesita el color CSS (token o hex) de la materia para
 *   dot/border accent en cards del Inicio.
 * Then doble lookup DEMO_MATERIAS → MATERIAS_DATA. Retorna `m.color` si
 *   existe; fallback `var(--xahni-teal)` (verde-azul brand).
 * Edge:
 *   - Materia sin color → fallback teal.
 *   - Materia no encontrada → fallback teal.
 *   - Deuda: el fallback hardcoded podría ser dinámico por hash (como
 *     builders-core._materiaBgGrad), pero el set DEMO está controlado.
 */
function _hubInicioMateriaColor(materiaId) {
    if (typeof DEMO_MATERIAS !== "undefined" && Array.isArray(DEMO_MATERIAS)) {
        const m = DEMO_MATERIAS.find(x => x.id === materiaId);
        if (m?.color) return m.color;
    }
    if (typeof MATERIAS_DATA !== "undefined" && Array.isArray(MATERIAS_DATA)) {
        const m = MATERIAS_DATA.find(x => x.id === materiaId);
        if (m?.color) return m.color;
    }
    return "var(--xahni-teal)";
}

/**
 * @interaction hub-inicio-fecha-corta
 * @scope shared-hub-inicio-helper-canonical
 *
 * Given un ISO date string (puede tener T... sufijo).
 * When cards de próxima tarea / próxima clase del Inicio necesitan label
 *   humano corto para la fecha de entrega.
 * Then aplica heurística contextual:
 *   - dias === 0 → "Hoy"
 *   - dias === 1 → "Mañana"
 *   - 1 < dias ≤ 6 → "En N días"
 *   - resto (>6 o pasada) → "DD MMM" (formato corto es-MX).
 * Edge:
 *   - iso null/undefined o invalid Date → "".
 *   - Delegate a `_hubInicioDiasRestantes` para cálculo (negative = pasada
 *     → cae en formato corto, no "Hace X días").
 *   - Locale es-MX hardcoded (deuda i18n cuando entren multi-idioma).
 */
function _hubInicioFechaCorta(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const dias = _hubInicioDiasRestantes(iso);
    if (dias === 0) return "Hoy";
    if (dias === 1) return "Mañana";
    if (dias > 1 && dias <= 6) return `En ${dias} días`;
    return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

/**
 * @interaction hub-inicio-dias-restantes
 * @scope shared-hub-inicio-helper-canonical
 *
 * Given un ISO date string.
 * When `_hubInicioFechaCorta` o sorting de tareas próximas necesita el
 *   delta días entre hoy y target (sin fracción horas).
 * Then parsea ISO, normaliza ambos a 00:00:00 local-time, calcula delta
 *   en días (round).
 * Edge:
 *   - iso null/undefined → Infinity (sentinela para sorting al final).
 *   - Date invalid (NaN) → Infinity.
 *   - target = hoy → 0.
 *   - target < hoy → negativo (pasada).
 *   - Round vs floor: round(0.5) → 1 (días casi-completos pueden romper
 *     ties, mínimo impacto).
 */
function _hubInicioDiasRestantes(iso) {
    if (!iso) return Infinity;
    const target = new Date(iso);
    if (isNaN(target)) return Infinity;
    const hoy = new Date();
    const a = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    const b = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    return Math.round((a - b) / 86400000);
}

/**
 * @interaction hub-inicio-hoy-largo
 * @scope shared-hub-inicio-helper-canonical
 *
 * Given (sin args).
 * When el header del Inicio necesita la fecha actual humana en formato
 *   largo ("Lunes 2 junio").
 * Then construye string desde `new Date()` con array de meses + días
 *   español. Capitaliza el día via `capitalize` global.
 * Edge:
 *   - `capitalize` no cargado → día sin capitalize (lowercase).
 *   - Mes/día arrays hardcoded es-MX (deuda i18n).
 *   - Sin año: decisión UX "fecha de hoy obvia, año no aporta".
 */
function _hubInicioHoyLargo() {
    const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
    const dias = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
    const d = new Date();
    const diaTxt = (typeof capitalize === "function") ? capitalize(dias[d.getDay()]) : dias[d.getDay()];
    return `${diaTxt} ${d.getDate()} ${meses[d.getMonth()]}`;
}

/**
 * @interaction hub-inicio-dia-semana-key
 * @scope shared-hub-inicio-helper-canonical
 *
 * Given (sin args).
 * When un caller (filtro de horario de hoy en card próxima clase) necesita
 *   la clave de día sin acentos para matchear con `materia.horario[].dia`.
 * Then retorna lowercase sin acento según getDay(): "lunes"|"martes"|
 *   "miercoles"|"jueves"|"viernes"|"sabado"|"domingo".
 * Edge:
 *   - getDay() Sunday=0 → "domingo".
 *   - Sin acentos (consistente con `_calDiaEs` de calendar canonical y
 *     `_diaKey` de horario.js).
 */
function _hubInicioDiaSemanaKey() {
    const k = ["domingo","lunes","martes","miercoles","jueves","viernes","sabado"];
    return k[new Date().getDay()];
}

/**
 * @interaction hub-inicio-esc
 * @scope shared-hub-inicio-helper-internal
 *
 * Given un valor coercible a string (incluido null/undefined).
 * When un caller del módulo Inicio inyecta interpolación HTML y necesita
 *   escape rápido para los 5 chars (& < > " ').
 * Then String(s ?? "") + replace con object map.
 * Edge:
 *   - null/undefined → "".
 *   - Variante local de _escapeHtml (dom-utils.js): contrato idéntico,
 *     implementación con map vs replace chain. Convive por convención
 *     (consistencia con builders-core._htmlAttr y otros). **Deuda
 *     consolidación post-XSS**: drop helpers locales, usar global.
 */
// FIX 2026-07-08: era una reimplementación duplicada de _escapeHtml
// (js/core/dom-utils.js). Ahora delega al canonical — ver CONVENTIONS.md.
function _hubInicioEsc(s) {
    return _escapeHtml(s);
}

/**
 * @interaction get-grupo-carrera-label
 * @scope shared (alumno + profesor)
 *
 * Given un grupoId (ej. "ISC-3A").
 * When la cabecera del hub-aprendizaje necesita el subtítulo "Ing. en X · Nro Cuatrimestre".
 * Then resuelve carrera vía DEMO_GRUPOS[grupoId].carreraId → DEMO_CARRERAS,
 *   parsea el ordinal del nombre del grupo (regex /-(\d+)/), y elige
 *   "Cuatrimestre" si carrera.duracionMeses ≤ 4 o "Semestre" si ≥ 6.
 *   Devuelve string formateado o "" si no hay data.
 * Edge si falta el grupo, la carrera o el número, devuelve lo que pueda.
 */
function getGrupoCarreraLabel(grupoId) {
    if (!grupoId) return "";
    const grupos = (typeof DEMO_GRUPOS !== "undefined" && Array.isArray(DEMO_GRUPOS) && DEMO_GRUPOS.length)
        ? DEMO_GRUPOS
        : (typeof GRUPOS_DATA !== "undefined" && Array.isArray(GRUPOS_DATA) ? GRUPOS_DATA : []);
    const grupo = grupos.find(g => g.id === grupoId);
    if (!grupo) return "";

    const carreras = (typeof DEMO_CARRERAS !== "undefined" && Array.isArray(DEMO_CARRERAS))
        ? DEMO_CARRERAS : [];
    const carrera = carreras.find(c => String(c.id) === String(grupo.carreraId));
    const nombreCarrera = carrera?.nombre
        ? carrera.nombre.replace(/^Ingeniería en /, "Ing. en ")
        : "";

    // grupo.nivel del JSON/Firestore gana sobre el parse heurístico del id,
    // que para grupos con timestamp (ej. "grupo-smoke-1780809551072") sacaría
    // el timestamp como número y mostraría "1780809551072º Cuatrimestre".
    let num = (Number.isInteger(grupo.nivel) && grupo.nivel >= 1 && grupo.nivel <= 12)
        ? grupo.nivel
        : null;
    if (num === null) {
        const m = String(grupo.id || "").match(/-(\d+)/);
        const parsed = m ? parseInt(m[1], 10) : null;
        num = (parsed != null && parsed >= 1 && parsed <= 12) ? parsed : null;
    }
    const ordinals = { 1:"1er", 2:"2do", 3:"3er", 4:"4to", 5:"5to", 6:"6to", 7:"7mo", 8:"8vo", 9:"9no", 10:"10mo" };
    const ord = num ? (ordinals[num] || `${num}º`) : "";

    const dur = carrera?.duracionMeses ?? grupo.periodo?.duracionMeses ?? 4;
    const tipoPeriodo = dur >= 6 ? "Semestre" : "Cuatrimestre";

    const ordLabel = ord ? `${ord} ${tipoPeriodo}` : tipoPeriodo;
    return nombreCarrera ? `${nombreCarrera} · ${ordLabel}` : ordLabel;
}

// Listener avatarChanged: re-paint banner + marco cuando el usuario cambia
// su avatar/marco/banner/título. Aplica cross-rol; cada rol re-paint sus
// propios elementos (alumno y profesor comparten los mismos IDs del Hero).
// Idempotente vía guard window-level.
if (!window.__xahniHubInicioAvatarListenerRegistered) {
    window.__xahniHubInicioAvatarListenerRegistered = true;
    window.addEventListener("avatarChanged", (ev) => {
        const u = APP?.user;
        if (!u || ev?.detail?.uid !== u.id) return;
        _hubInicioPaintBanner(u);
        _hubInicioPaintAvatarMarco(u);
    });
}
