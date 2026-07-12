// ═══════════════════════════════════════════════════════════
// IDENTIDAD · Título + Banner + Perfil Público
//              + Orchestrator buildPerfilCompleto
//              + Helpers transversales del perfil
// Slice #12 split (2026-06-01): extraído de perfil.js
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// USER STATS — Agregador para evaluar requisitos de desbloqueo
// Consume getters reales (getTrofeosAlumno, getLogrosAlumno,
// getRachaAlumno, getComparativaAlumno) y APP.user para producir
// un objeto plano con los stats que las funciones unlock necesitan.
// ═══════════════════════════════════════════════════════════
/**
 * @interaction user-stats
 * @scope shared-helper-internal
 *
 * Given un `uid` opcional (default `APP.user.id`).
 * When `buildTituloSelector` / `buildBannerSelector` / cualquier consumer
 *   necesita evaluar `unlock(stats)` por item del catálogo de cosméticos.
 * Then agrega vivos desde getters reales (`getTrofeosAlumno`,
 *   `getLogrosAlumno`, `getRachaAlumno`) + `APP.user` y retorna un objeto
 *   plano: `{ trofeos, logros, racha, rachaMax, nivel, xp, top1 }`.
 * Edge:
 *   - sin usuario activo (`uid` falsy y `APP.user` nulo) → retorna objeto
 *     con ceros (todos los unlocks evalúan false).
 *   - getters no cargados (orden scripts) → fallback a `[]` o
 *     `{ actual:0, max:0 }`.
 */
function _userStats(uid) {
    const u = uid || APP?.user?.id;
    if (!u) return { trofeos: 0, logros: 0, racha: 0, rachaMax: 0, nivel: 0, xp: 0, top1: false };

    const trofeos = (typeof getTrofeosAlumno === "function" ? getTrofeosAlumno(u) : []) || [];
    const logros  = (typeof getLogrosAlumno  === "function" ? getLogrosAlumno(u)  : []) || [];
    const racha   = (typeof getRachaAlumno   === "function" ? getRachaAlumno(u)   : { actual: 0, max: 0 });

    return {
        trofeos:    trofeos.length,
        logros:     logros.filter(l => l.desbloqueado).length,
        racha:      racha.actual,
        rachaMax:   racha.max,
        nivel:      APP?.user?.nivel  || 0,
        xp:         APP?.user?.puntos || 0,
        top1:       APP?.user?.rankPos === 1,  // si existe
    };
}

// ── Carrera derivada del prefijo del grupo (ISC-3A → ISC) ────
const _CARRERA_MAP = {
    ISC: "Ingeniería en Sistemas Computacionales",
    ISW: "Ingeniería en Software",
    IND: "Ingeniería Industrial",
    LAE: "Lic. en Administración",
};
/**
 * @interaction carrera-del-grupo
 * @scope shared-helper-internal
 *
 * Given un `grupoId` string (e.g. "ISC-3A").
 * When `buildPerfilPublico` necesita un fallback de carrera si el user no
 *   trae `u.carrera` definido.
 * Then extrae el prefijo antes del primer guion y mappea contra
 *   `_CARRERA_MAP`. Retorna nombre completo de la carrera o "—".
 * Edge:
 *   - `grupoId` falsy → "—".
 *   - prefijo no presente en `_CARRERA_MAP` → "—".
 */
function _carreraDelGrupo(grupoId) {
    if (!grupoId) return "—";
    const prefix = String(grupoId).split("-")[0];
    return _CARRERA_MAP[prefix] || "—";
}

/**
 * @interaction calcular-competencias
 * @scope shared-helper-internal
 *
 * Given alumno logueado y `getMateriasAlumno(uid)` resuelve sus materias
 *   con `promedio` (escala 10) y `materiaColor`/`color`.
 * When `buildCompetenciasDestaque` necesita el array para renderizar las
 *   anillas SVG del bloque de competencias del perfil del alumno.
 * Then mappea cada materia a `{ area, pct, color, delay, top }`:
 *   - `pct = round(promedio * 10)` capeado a 100 (anilla sobre 100).
 *   - `delay` rotativo de 0.1s..0.8s para stagger de animación.
 *   - las 2 materias con mayor `pct` reciben `top: true` (badge "Top área").
 * Edge:
 *   - sin usuario o getter ausente → array vacío.
 *   - `m.promedio` no numérico → pct 0.
 *   - menos de 2 materias → todas marcadas top.
 */
function _calcularCompetencias() {
    const delays = ["0.1s","0.2s","0.3s","0.4s","0.5s","0.6s","0.7s","0.8s"];

    const mats = (typeof getMateriasAlumno === "function" && APP?.user?.id)
        ? getMateriasAlumno(APP.user.id) : [];

    const items = mats.map((m, i) => ({
        area:  m.nombre,
        pct:   Math.min(100, Math.round((m.promedio || 0) * 10)),
        color: m.materiaColor || _COMP_COLOR_MAP[m.color] || "#00d4ff",
        delay: delays[i] || "0.1s",
        top:   false,
    }));

    // Marcar las 2 de mayor pct como "Top área"
    const sorted = [...items].sort((a, b) => b.pct - a.pct);
    sorted.slice(0, 2).forEach(top => {
        const item = items.find(i => i.area === top.area);
        if (item) item.top = true;
    });

    return items;
}

// ── Helper: etiqueta de rareza ───────────────────────────────
/**
 * @interaction rarity-label
 * @scope shared-helper-internal
 *
 * Given un id de rareza (`legendario`, `epico`, `raro`, `comun`).
 * When un builder necesita mostrar el label humano + emoji de la rareza.
 * Then mappea contra la tabla literal y retorna el string formateado
 *   (e.g. "✨ Legendario", "💜 Épico").
 * Edge id desconocido → devuelve el input tal cual.
 */
function rarityLabel(r) {
    const map = { legendario: "✨ Legendario", epico: "💜 Épico", raro: "💙 Raro", comun: "⬜ Común" };
    return map[r] || r;
}

// ── buildPerfilCompleto: entrada única ───────────────────────
// Incluye todas las secciones del perfil en orden
/**
 * @interaction build-perfil-completo
 * @scope perfil-shared-alumno-profesor
 *
 * Given el usuario entra al tab Perfil (cualquier rol: alumno, profesor o
 *   admin) via `hubShellSwitchTab('perfil')` o equivalente.
 * When este orchestrator se dispatcha como entrada única del rendering.
 * Then orquesta el render del perfil en orden:
 *   1. `_initGamificacion()` hidrata IDENTIDAD + AVATAR_STATE + KUDOS_DATA
 *      desde DEMO_USERS y localStorage.
 *   2. Sweep declarativo `[data-role-hide="admin"]` oculta secciones
 *      gamificadas si el rol activo es administrador.
 *   3. Sweep adicional oculta `#trofeos-section`, `#areas-destaque-section`
 *      y el wrap de comparativa-grupo si el rol es profesor o admin.
 *   4. `buildPerfilBanner()` aplica partículas + gradient del banner activo.
 *   5. Admin → early return tras `_renderAvatarFromState()`; no se montan
 *      builders gamificados (evita trabajo y side-effects en nodos hidden).
 *   6. Estudiante → `buildTrofeos()` + `buildCompetenciasDestaque()`.
 *   7. Estudiante → `buildGrupoDestaque()` ·· Profesor → `buildGrupoDestaqueProfesor()`.
 *   8. `buildMedallas()` + `buildMaestriasWidget()` (alumno-only por guard interno).
 *   9. Estudiante → `buildPerfilActividad()` ·· Profesor → `buildPerfilActividadProfesor()`.
 *  10. `buildRangoSection()` + (estudiante) `buildComparativaGrupo()`.
 *  11. `buildInsigniasColaboracion()` + `buildMuroReconocimientos()`.
 *  12. `_renderAvatarFromState()` aplica avatar+marco+banner+título al DOM
 *      (sobrescribe iniciales que dashboard.js escribió previamente).
 * Edge:
 *   - rol distinto de admin/profesor/estudiante → trata como estudiante por default.
 *   - `_initGamificacion()` no encuentra usuario → builders reciben datos
 *     vacíos y muestran empty states.
 *   - secciones inexistentes en el DOM (HTML legacy) → guards `if (el)` los saltan.
 */
function buildPerfilCompleto() {
    _initGamificacion();
    const esAdmin    = APP.user && APP.user.tipo === "administrador";
    const esProfesor = APP.user && APP.user.tipo === "profesor";

    // Sweep declarativo: oculta cualquier elemento marcado con
    // data-role-hide="admin" en views/shared/perfil.html cuando el rol activo
    // es administrador. Permite que el HTML declare semánticamente qué bloques
    // pertenecen al perfil gamificado de alumno/profesor; admin ve solo el
    // banner + datos de identidad (avatar, nombre, rol).
    document.querySelectorAll('[data-role-hide="admin"]').forEach(el => {
        el.style.display = esAdmin ? "none" : "";
    });

    // Trofeos y áreas de destaque: solo estudiantes (hide adicional para profesor;
    // admin ya quedó cubierto por el sweep anterior).
    const trofeosSection = document.getElementById("trofeos-section");
    const areasSection   = document.getElementById("areas-destaque-section");
    if (trofeosSection) trofeosSection.style.display = (esAdmin || esProfesor) ? "none" : "";
    if (areasSection)   areasSection.style.display   = (esAdmin || esProfesor) ? "none" : "";

    // Comparativa vs grupo: solo estudiantes
    const comparativaCard = document.getElementById("comparativa-grupo-wrap")?.closest?.(".card");
    if (comparativaCard) comparativaCard.style.display = (esAdmin || esProfesor) ? "none" : "";

    buildPerfilBanner();

    // Admin: el perfil termina aquí. No se construyen secciones gamificadas
    // (el sweep ya las ocultó; tampoco corremos los builders para evitar
    // trabajo y side-effects sobre nodos invisibles).
    if (esAdmin) {
        _renderAvatarFromState();
        return;
    }

    if (!esProfesor) {
        buildTrofeos();
        buildCompetenciasDestaque();
    }

    if (esProfesor) {
        buildGrupoDestaqueProfesor();
    } else {
        buildGrupoDestaque();
    }

    buildMedallas();

    // Slice H1 B.1 · widget Maestrías destacadas (alumno-only; profesor hide vía JS)
    if (typeof buildMaestriasWidget === "function") buildMaestriasWidget();

    if (esProfesor) {
        buildPerfilActividadProfesor();
    } else {
        buildPerfilActividad();
    }

    buildRangoSection();

    if (!esProfesor) {
        buildComparativaGrupo();
    }

    buildInsigniasColaboracion();
    buildMuroReconocimientos();

    // Aplicar el avatar guardado del usuario actual al DOM (foto + marco).
    // Necesario porque dashboard.js ya escribió las iniciales en #perfil-avatar,
    // pero si el usuario tiene una foto/marco guardado debemos respetarlo.
    _renderAvatarFromState();
}

// ═══════════════════════════════════════════════════════════
// IDENTIDAD Y PRESENTACIÓN
// ── Título personalizable · Banner · Card Pública
// ═══════════════════════════════════════════════════════════

// ── Estado de identidad del alumno ─────────────────────────
const IDENTIDAD = {
    // Slice H2b · shape {kind:"personal"|"maestria", id:string}
    // (legacy string se migra one-time en _loadIdentidad)
    tituloActivo: { kind: "personal", id: "t1" },
    bannerActivo: "banner-cyber",
};

// ── Catálogo de títulos ─────────────────────────────────────
const TITULOS_CATALOG = [
    // Fix 2026-06-05: t1 ahora es el starter neutro (default IDENTIDAD_STATE).
    // Razón: cuando un nuevo usuario se registra (sin gamer.tituloActivo seteado
    // en Firestore), el resolver caía a TITULOS_CATALOG[0] y mostraba "Campeón
    // de Torneos" aunque jamás haya ganado un torneo. Deuda menor: usuarios
    // legacy que tenían t1 seleccionado verán "Aprendiz" en lugar del título
    // épico — aceptable para demo provisional, se revisará en migración real.
    { id: "t1",  emoji: "🎓", texto: "Aprendiz",               rareza: "comun",      color: "#a8b3cf", req: "Tu inicio en XAHNI",              unlock: () => true            },
    { id: "t2",  emoji: "🚀", texto: "Arquitecto del Código", rareza: "epico",      color: "#a855f7", req: "Proyecto del Semestre",          unlock: s => s.logros   >= 5  },
    { id: "t3",  emoji: "🎯", texto: "Precisión Extrema",     rareza: "epico",      color: "#00d4ff", req: "10 quizzes perfectos",           unlock: s => s.xp       >= 1000 },
    { id: "t4",  emoji: "🔥", texto: "Racha Interminable",    rareza: "raro",       color: "#e84040", req: "Racha de 7 días",                unlock: s => s.rachaMax >= 7  },
    { id: "t5",  emoji: "💡", texto: "Mente Innovadora",      rareza: "raro",       color: "#00c6a7", req: "Logro Innovación",               unlock: s => s.logros   >= 3  },
    { id: "t6",  emoji: "📐", texto: "Maestro del Álgebra",   rareza: "raro",       color: "#1b4fe4", req: "Medalla Matemáticas",            unlock: s => s.logros   >= 4  },
    { id: "t7",  emoji: "👑", texto: "El Elegido",            rareza: "legendario", color: "#f5a623", req: "Desbloquea el logro 'Diamante'", unlock: s => s.logros   >= 10 },
    { id: "t8",  emoji: "💎", texto: "Nivel Diamante",        rareza: "legendario", color: "#00d4ff", req: "Alcanza Nivel 30",               unlock: s => s.nivel    >= 30 },
    { id: "t9",  emoji: "🦅", texto: "Maestro Absoluto",      rareza: "legendario", color: "#a855f7", req: "Completa todos los logros épicos", unlock: s => s.logros >= 15 },
    { id: "t10", emoji: "🌙", texto: "Estudiante Nocturno",   rareza: "raro",       color: "#8b2be2", req: "Logro 'Nocturno'",               unlock: s => s.logros   >= 8  },
];

// ── Catálogo de banners ─────────────────────────────────────
const BANNERS_CATALOG = [
    {
        id: "banner-cyber",
        nombre: "Ciberespacio",
        preview: "linear-gradient(135deg,#000c1a 0%,#050e24 40%,#0a0520 100%)",
        glow: "#00d4ff",
        req: "Disponible para todos",
        particulas: true,
        unlock: s => true,
    },
    {
        id: "banner-ocean",
        nombre: "Profundo Océano",
        preview: "linear-gradient(135deg,#000a14 0%,#003355 50%,#001a33 100%)",
        glow: "#00c6a7",
        req: "Disponible para todos",
        particulas: false,
        unlock: s => true,
    },
    {
        id: "banner-aurora",
        nombre: "Aurora Boreal",
        preview: "linear-gradient(135deg,#050020 0%,#1a0040 30%,#002040 70%,#001a10 100%)",
        glow: "#8b2be2",
        req: "Logro 'Primera Insignia'",
        particulas: false,
        unlock: s => s.logros >= 1,
    },
    {
        id: "banner-magma",
        nombre: "Núcleo de Magma",
        preview: "linear-gradient(135deg,#1a0000 0%,#3d0000 40%,#1a0a00 100%)",
        glow: "#e84040",
        req: "Gana 3 torneos",
        particulas: false,
        unlock: s => s.trofeos >= 3,
    },
    {
        id: "banner-gold",
        nombre: "Trono Dorado",
        preview: "linear-gradient(135deg,#1a1000 0%,#3d2a00 40%,#1a1400 100%)",
        glow: "#f5a623",
        req: "Alcanza Nivel 20",
        particulas: false,
        unlock: s => s.nivel >= 20,
    },
    {
        id: "banner-void",
        nombre: "El Vacío",
        preview: "linear-gradient(135deg,#050005 0%,#120020 40%,#080010 100%)",
        glow: "#a855f7",
        req: "Desbloquea logro 'El Elegido'",
        particulas: false,
        unlock: s => s.logros >= 10,
    },
];

// ── Persistencia de identidad (namespaced por usuario) ──────

// Defaults para resetear estado al cambiar de usuario
const _IDENTIDAD_DEFAULTS = {
    tituloActivo: { kind: "personal", id: "t1" },
    bannerActivo: "banner-cyber"
};

// ── Slice H2b · Helpers de resolución de título (kind+id) ──────

/**
 * @interaction migrar-titulo-legacy
 * @scope shared-helper-internal
 *
 * Given un valor crudo de `tituloActivo` que puede venir como string legacy
 *   (e.g. "⚔️ Campeón de Torneos") o como shape nuevo `{kind, id}`.
 * When `_loadIdentidad` o cualquier código que lee `DEMO_USERS[uid].gamer`
 *   necesita asegurar el shape canónico unificado.
 * Then:
 *   - si ya es objeto con `kind` + `id` → lo retorna sin tocar.
 *   - si es string → busca match en `TITULOS_CATALOG` por `texto.includes`,
 *     retorna `{kind:"personal", id:<id-del-match>}`.
 *   - sin match → fallback `{kind:"personal", id:"t1"}`.
 * Edge:
 *   - valor falsy (null/undefined/"") → fallback `{kind:"personal", id:"t1"}`.
 *   - objeto con shape parcial (sólo `kind` o sólo `id`) → trata como inválido
 *     y cae al fallback.
 */
function _migrarTituloLegacy(legacyValue) {
    if (legacyValue && typeof legacyValue === "object" && legacyValue.kind && legacyValue.id) {
        return legacyValue; // ya migrado
    }
    if (typeof legacyValue === "string" && legacyValue.length > 0) {
        const match = TITULOS_CATALOG.find(t => legacyValue.includes(t.texto));
        if (match) return { kind: "personal", id: match.id };
    }
    return { kind: "personal", id: "t1" };
}

/**
 * @interaction resolve-titulo-meta
 * @scope shared-helper-canonical
 *
 * Given un `tituloActivo` con shape `{kind, id}` (donde kind ∈
 *   {`personal`, `maestria`}).
 * When `aplicarTitulo` / `buildPerfilCompleto` / `buildPerfilPublico` /
 *   sidebar / cualquier consumer necesita el metadata completo del título
 *   activo (label humano + glyph + color CSS).
 * Then resuelve a un object unificado:
 *   `{ id, label, glyph, color, kind, fullText, disciplinaId? }`.
 *   - `kind="personal"` → match en `TITULOS_CATALOG`, color del item.
 *   - `kind="maestria"` → match en `_getCosmeticsCatalog()`, glyph derivado
 *     de la disciplina (`_getDisciplinaGlyph`), color por mapa
 *     `bd→cyan / poo→purple-light / ed,mat→teal / fallback amber`.
 *   - `fullText` siempre `${glyph} ${label}` para inserción directa al DOM.
 * Edge:
 *   - `tituloActivo` falsy o no-objeto → fallback `TITULOS_CATALOG[0]`.
 *   - `kind="personal"` con id no encontrado → fallback.
 *   - `kind="maestria"` sin entry en catalog → fallback.
 *   - `kind` distinto a "personal"/"maestria" → fallback.
 *   - helpers `_getCosmeticsCatalog` / `_getDisciplinaGlyph` /
 *     `_getMaestriaCosmeticDisciplina` no cargados → glyph "🏆" + color amber.
 */
function _resolveTituloMeta(tituloActivo) {
    // Slice H2b · color por disciplina para items Maestría (deuda heritage fix)
    // BD → cyan; POO → purple-light; ED/MAT → teal. Fallback amber (Maestría sin disciplina).
    const _maestriaColor = (discId) => ({
        bd: "#00d4ff", poo: "#a855f7", ed: "#00c6a7", mat: "#00c6a7"
    })[discId] || "#f5a623";
    const fallback = () => {
        const t = TITULOS_CATALOG[0];
        return { id: t.id, label: t.texto, glyph: t.emoji, color: t.color, kind: "personal", fullText: `${t.emoji} ${t.texto}` };
    };
    if (!tituloActivo || typeof tituloActivo !== "object") return fallback();
    if (tituloActivo.kind === "personal") {
        const t = TITULOS_CATALOG.find(x => x.id === tituloActivo.id);
        if (!t) return fallback();
        return { id: t.id, label: t.texto, glyph: t.emoji, color: t.color, kind: "personal", fullText: `${t.emoji} ${t.texto}` };
    }
    if (tituloActivo.kind === "maestria") {
        const catalog = (typeof _getCosmeticsCatalog === "function") ? _getCosmeticsCatalog() : {};
        const c = catalog[tituloActivo.id];
        if (!c) return fallback();
        const discId = (typeof _getMaestriaCosmeticDisciplina === "function") ? _getMaestriaCosmeticDisciplina(tituloActivo.id) : "";
        const glyph = (typeof _getDisciplinaGlyph === "function" && discId) ? _getDisciplinaGlyph(discId) : "🏆";
        return { id: tituloActivo.id, label: c.preview || c.label, glyph: glyph, color: _maestriaColor(discId), disciplinaId: discId, kind: "maestria", fullText: `${glyph} ${c.preview || c.label}` };
    }
    return fallback();
}

/**
 * @interaction identidad-key
 * @scope shared-persistencia
 *
 * Given un usuario logueado (`APP.user.id` definido).
 * When `_loadIdentidad` / `_saveIdentidad` necesitan el namespace localStorage.
 * Then retorna `xahni_identidad_<uid>` o `null` sin usuario activo.
 * Edge sin sesión → null y callers no persisten.
 */
function _identidadKey() { const uid = APP?.user?.id; return uid ? `xahni_identidad_${uid}` : null; }

/**
 * @interaction identidad-load
 * @scope shared-persistencia
 *
 * Given el usuario acaba de hacer login y `_initGamificacion` invoca este
 *   helper para hidratar el estado de identidad (banner + título activos).
 * When se necesita reconstruir IDENTIDAD desde fuentes priorizadas.
 * Then orquesta hidratación en 3 pasos:
 *   1. Reset a `_IDENTIDAD_DEFAULTS` (no arrastrar estado del usuario anterior).
 *   2. Overlay desde `DEMO_USERS[uid].gamer.{bannerId,tituloActivo}` (seed —
 *      fuente de verdad en memoria · Opción A del slice #6). `tituloActivo`
 *      pasa por `_migrarTituloLegacy` para asegurar shape `{kind,id}`.
 *   3. Overlay con localStorage `xahni_identidad_<uid>` (override del usuario,
 *      prevalece sobre seed). Tambien migra `tituloActivo` legacy si existe.
 *   4. `_syncIdentidadToDemoUser()` reconcilia el resultado de regreso al
 *      seed para que consumers cross-vista lean el valor activo sin saber
 *      del namespace localStorage.
 * Edge:
 *   - sin usuario → reset sin overlay y return.
 *   - JSON corrupto en localStorage → catch silencioso, mantiene seed/defaults.
 *   - DEMO_USERS no cargado → salta paso 2.
 */
function _loadIdentidad() {
    // Reset a defaults para no arrastrar estado del usuario anterior
    Object.assign(IDENTIDAD, _IDENTIDAD_DEFAULTS);
    // 1. Hidrata desde DEMO_USERS[uid].gamer (fuente de verdad en memoria — Opción A del slice #6)
    const uid = APP?.user?.id;
    const u   = uid && typeof DEMO_USERS !== "undefined" ? DEMO_USERS.find(x => x.id === uid) : null;
    const g   = u && u.gamer;
    if (g) {
        if (typeof g.bannerId      === "string" && g.bannerId)      IDENTIDAD.bannerActivo = g.bannerId;
        if (g.tituloActivo !== undefined)                            IDENTIDAD.tituloActivo = _migrarTituloLegacy(g.tituloActivo);
    }
    // 2. Overlay con localStorage (override del usuario, prevalece)
    const k = _identidadKey();
    if (!k) return;
    let hadLocalOverride = false;
    try {
        const raw = localStorage.getItem(k);
        if (raw) {
            const parsed = JSON.parse(raw);
            // Slice H2b: migrar tituloActivo legacy string si viene de localStorage
            if (parsed.tituloActivo !== undefined) {
                parsed.tituloActivo = _migrarTituloLegacy(parsed.tituloActivo);
            }
            Object.assign(IDENTIDAD, parsed);
            hadLocalOverride = true;
        }
    } catch(e) {}
    // Reconciliar de regreso a DEMO_USERS para que consumidores cross-vista
    // que leen del seed reflejen la elección del usuario en esta sesión.
    _syncIdentidadToDemoUser();
    // Backfill cross-device si había override local + Firestore vacío.
    if (hadLocalOverride && uid && typeof window.firestorePersistUserAvatar === "function") {
        window.firestorePersistUserAvatar(uid, {
            bannerId:     IDENTIDAD.bannerActivo,
            tituloActivo: IDENTIDAD.tituloActivo
        });
    }
}

/**
 * @interaction identidad-save
 * @scope shared-persistencia
 *
 * Given `IDENTIDAD` acaba de mutar (`aplicarTitulo` o `aplicarBanner`).
 * When se persiste el cambio para que sobreviva al refresh.
 * Then escribe `xahni_identidad_<uid>` con `JSON.stringify(IDENTIDAD)` +
 *   sincroniza `DEMO_USERS[uid].gamer.{bannerId,tituloActivo}` via
 *   `_syncIdentidadToDemoUser()` (consumers cross-vista leen del seed).
 * Edge sin usuario activo → solo el sync corre (no-op porque sync también
 *   guard-out sin uid).
 */
function _saveIdentidad() {
    const k = _identidadKey();
    if (k) localStorage.setItem(k, JSON.stringify(IDENTIDAD));
    _syncIdentidadToDemoUser();
    // Persist a Firestore (banner + título) para visibilidad cross-device
    // y en cards de miembros + modal perfil público que otros usuarios abren.
    const uid = APP?.user?.id;
    if (uid && typeof window.firestorePersistUserAvatar === "function") {
        window.firestorePersistUserAvatar(uid, {
            bannerId:     IDENTIDAD.bannerActivo,
            tituloActivo: IDENTIDAD.tituloActivo
        });
    }
}

// Muta DEMO_USERS[currentUid].gamer.{bannerId,tituloActivo} para que consumidores
// cross-vista (hub-grupo, competencias, sidebar, etc.) reflejen la elección sin
// tener que consultar localStorage del helper namespaced.
/**
 * @interaction sync-identidad-to-demo-user
 * @scope shared-persistencia
 *
 * Given `IDENTIDAD` (banner + título activos) refleja el estado vigente.
 * When `_loadIdentidad` o `_saveIdentidad` necesitan reconciliar el seed
 *   `DEMO_USERS` para que consumers cross-vista (hub-grupo, competencias,
 *   sidebar) lean del seed unificado.
 * Then muta `DEMO_USERS[uid].gamer.bannerId` y `.tituloActivo`. Si `u.gamer`
 *   no existe, lo crea inline.
 * Edge:
 *   - sin usuario o sin DEMO_USERS cargado → no-op silencioso.
 *   - uid no encontrado en seed → no-op.
 */
function _syncIdentidadToDemoUser() {
    const uid = APP?.user?.id;
    if (!uid || typeof DEMO_USERS === "undefined") return;
    const u = DEMO_USERS.find(x => x.id === uid);
    if (!u) return;
    if (!u.gamer) u.gamer = {};
    u.gamer.bannerId     = IDENTIDAD.bannerActivo;
    u.gamer.tituloActivo = IDENTIDAD.tituloActivo;
}

// Cargar todo al inicializar el perfil
/**
 * @interaction init-gamificacion
 * @scope perfil-shared-init
 *
 * Given el usuario entra a la vista Perfil y `buildPerfilCompleto` dispatcha
 *   este orchestrator de hidratación como primer paso.
 * When se necesita hidratar todo el estado gamificado cross-file.
 * Then orquesta 3 hidrataciones consecutivas (cross-file):
 *   1. `_loadIdentidad()` → resetea + hidrata `IDENTIDAD` (banner+título)
 *      desde DEMO_USERS + localStorage.
 *   2. `_loadAvatarState()` (perfil-avatar.js) → hidrata `AVATAR_STATE`
 *      (foto+marco) con mismo patrón seed→localStorage.
 *   3. `_loadKudos()` (perfil-kudos.js) → si retorna array, sobrescribe
 *      in-place `KUDOS_DATA` (length=0 + push spread, preserva la
 *      referencia const).
 * Edge:
 *   - sin usuario activo → cada loader cae a sus defaults.
 *   - `_loadKudos` retorna null → KUDOS_DATA mantiene su seed hardcoded.
 *   - loaders cross-file no cargados (orden scripts) → fallaría — orden
 *     de scripts en `index.html` garantiza perfil-kudos.js + perfil-avatar.js
 *     antes de perfil-identidad.js.
 */
function _initGamificacion() {
    _loadIdentidad();
    _loadAvatarState();
    const savedKudos = _loadKudos();
    if (savedKudos) KUDOS_DATA.length = 0, KUDOS_DATA.push(...savedKudos);
}

// Estabilizacion 2026-06-09: re-build perfil cuando termina la hidratacion
// Firestore (los widgets de mastery, XP, nivel se rendean antes de la
// hidratacion y quedan con valores defaults). Solo re-build si el panel
// Perfil esta visible para no spamear renders.
document.addEventListener("xahni:firestoreHydrated", () => {
    try {
        const perfilPanel = document.getElementById("hub-content-perfil")
            || document.getElementById("screen-perfil");
        if (perfilPanel && perfilPanel.offsetParent !== null
            && typeof buildPerfilCompleto === "function") {
            buildPerfilCompleto();
        }
    } catch (e) { /* defensive */ }
});

// titulo seleccionado temporalmente en el modal
let tituloSeleccionado = IDENTIDAD.tituloActivo;
let bannerSeleccionado = IDENTIDAD.bannerActivo;

// ── buildTituloSelector ──────────────────────────────────────
/**
 * @interaction build-titulo-selector
 * @scope perfil-shared-modal
 *
 * Given el usuario abre el modal `#modal-titulo-selector` (click en
 *   "Cambiar título" desde el chip de título del perfil).
 * When la apertura dispatcha este builder.
 * Then renderiza `#titulo-selector-list` con 2 pools:
 *   - **Personal** (`TITULOS_CATALOG`) — 10 títulos clásicos con badge de
 *     rareza, requisito de unlock evaluado contra `_userStats(uid)` y
 *     onclick `seleccionarTitulo('personal', id)` o toast informativo si
 *     bloqueado.
 *   - **Maestría** (via `_getMaestriaCosmeticsForUser(uid, "titulo")` —
 *     perfil-gamificacion.js) — cosméticos derivados de mastery points por
 *     disciplina; siempre desbloqueados; onclick
 *     `seleccionarTitulo('maestria', id)`.
 *   - Reset `tituloSeleccionado = IDENTIDAD.tituloActivo` y marca con clase
 *     `.activo` el item que coincide en kind+id.
 * Edge:
 *   - container `#titulo-selector-list` ausente → no-op.
 *   - `_getMaestriaCosmeticsForUser` no cargada → solo pool personal.
 *   - usuario sin maestrías → pool maestría vacío.
 */
function buildTituloSelector() {
    const el = document.getElementById("titulo-selector-list");
    if (!el) return;
    tituloSeleccionado = IDENTIDAD.tituloActivo;
    const tActivo = IDENTIDAD.tituloActivo;
    const activoKind = (tActivo && typeof tActivo === "object") ? tActivo.kind : null;
    const activoId = (tActivo && typeof tActivo === "object") ? tActivo.id : null;

    const stats = _userStats(APP?.user?.id);
    const personal = TITULOS_CATALOG.map(t => ({
        ...t,
        desbloqueado: t.unlock ? t.unlock(stats) : true,
    }));
    const maestriaItems = (typeof _getMaestriaCosmeticsForUser === "function")
        ? _getMaestriaCosmeticsForUser(APP?.user?.id, "titulo")
        : [];

    const personalHtml = personal.map(t => {
        const esActivo = (activoKind === "personal" && activoId === t.id);
        const rarLabel = { legendario: "✨ Legendario", epico: "💜 Épico", raro: "💙 Raro" }[t.rareza];
        return `
        <div class="titulo-item ${t.desbloqueado ? 'desbloqueado' : 'bloqueado'} ${esActivo ? 'activo' : ''}"
             data-source="personal"
             style="--titulo-color:${t.color}"
             onclick="${t.desbloqueado ? `seleccionarTitulo('personal','${t.id}')` : `showToast('🔒 Requiere: ${t.req}','info')`}">
            <div class="titulo-item-left">
                <span class="titulo-emoji">${t.emoji}</span>
                <div>
                    <div class="titulo-texto">${t.texto}</div>
                    <div class="titulo-req">${t.desbloqueado ? '✓ Desbloqueado' : '🔒 ' + t.req}</div>
                </div>
            </div>
            <div class="titulo-item-right">
                <span class="titulo-rarity-badge" style="color:${t.color};border-color:${t.color}40;background:${t.color}10">
                    ${rarLabel}
                </span>
                ${esActivo ? '<span class="titulo-activo-chip">En uso</span>' : ''}
                ${!t.desbloqueado ? '<span style="font-size:18px;opacity:.4">🔒</span>' : ''}
            </div>
        </div>`;
    }).join("");

    // Slice H2b · pool Maestría con chip mini-emblema disciplina
    const maestriaHtml = maestriaItems.map(m => {
        const esActivo = (activoKind === "maestria" && activoId === m.id);
        return `
        <div class="titulo-item desbloqueado ${esActivo ? 'activo' : ''}"
             data-source="maestria"
             data-disciplina="${m.disciplinaId}"
             onclick="seleccionarTitulo('maestria','${m.id}')">
            <div class="titulo-item-left">
                <span class="titulo-emoji">${m.glyph}</span>
                <div>
                    <div class="titulo-texto">${m.label}</div>
                    <div class="titulo-req">🏆 Maestría · Nivel ${m.nivelRequerido}+</div>
                </div>
            </div>
            <div class="titulo-item-right">
                <span class="maestria-cosmetic-chip" data-disciplina="${m.disciplinaId}" aria-label="Cosmético de Maestría">
                    ${m.glyph}
                </span>
                ${esActivo ? '<span class="titulo-activo-chip">En uso</span>' : ''}
            </div>
        </div>`;
    }).join("");

    el.innerHTML = personalHtml + maestriaHtml;
}

/**
 * @interaction seleccionar-titulo
 * @scope perfil-shared-modal
 *
 * Given el modal selector de título abierto con items renderizados por
 *   `buildTituloSelector`.
 * When el usuario hace click en una card desbloqueada (`kind` ∈
 *   {personal, maestria}, `id` el del item).
 * Then setea `tituloSeleccionado = {kind, id}` (no muta `IDENTIDAD` aún —
 *   eso lo hace `aplicarTitulo`), limpia clases `.seleccionando` + `.activo`
 *   + chips `.titulo-activo-chip` previos, y marca la card target con
 *   `.seleccionando` matchando por `data-source` + onclick literal que
 *   contiene `'kind','id'`.
 * Edge:
 *   - click en item bloqueado → no llega aquí (el onclick condicional
 *     dispara `showToast` en su lugar).
 *   - no hay match con el selector → ningún item recibe la clase
 *     `.seleccionando` (visual no actualiza, pero `tituloSeleccionado` sí).
 */
function seleccionarTitulo(kind, id) {
    // Slice H2b · accepts (kind, id) per shape {kind, id}
    tituloSeleccionado = { kind, id };
    // Limpiar estados previos: clase activo + chip "En uso" + seleccionando previo
    document.querySelectorAll(".titulo-item").forEach(el => {
        el.classList.remove("seleccionando");
        el.classList.remove("activo");
    });
    document.querySelectorAll(".titulo-activo-chip").forEach(el => el.remove());
    // Marcar la card clickeada buscando por data-source + onclick contiene 'kind','id'
    const items = document.querySelectorAll(`.titulo-item[data-source="${kind}"]`);
    items.forEach(it => {
        const oc = it.getAttribute("onclick") || "";
        if (oc.includes(`'${kind}','${id}'`)) it.classList.add("seleccionando");
    });
}
window.seleccionarTitulo = seleccionarTitulo;

/**
 * @interaction aplicar-titulo
 * @scope perfil-shared-modal
 *
 * Given el usuario abrió el modal selector de título y eligió uno desbloqueado
 *   (`tituloSeleccionado` contiene `{kind, id}` shape H2b).
 * When hace click en "Aplicar".
 * Then `_migrarTituloLegacy(tituloSeleccionado)` normaliza el shape,
 *   `IDENTIDAD.tituloActivo` se actualiza, `_resolveTituloMeta` deriva
 *   `fullText` + color, `#perfil-title-tag` re-renderiza con el texto +
 *   edit-hint y `--title-color`, `_saveIdentidad` persiste en localStorage
 *   y sincroniza `DEMO_USERS[uid].gamer.tituloActivo`, se dispara
 *   `identidadChanged` (kind: titulo) para consumidores cross-vista, el modal
 *   se cierra y aparece un toast verde.
 * Edge:
 *   - `tituloSeleccionado` falsy (no se eligió nada) → early return.
 *   - `#perfil-title-tag` ausente → no actualiza DOM pero sí persiste.
 *   - `window` / `CustomEvent` no disponibles → omite el dispatch sin error.
 */
function aplicarTitulo() {
    if (!tituloSeleccionado) return;
    // Slice H2b: tituloSeleccionado ahora es {kind,id}; migrar si viene como string legacy
    IDENTIDAD.tituloActivo = _migrarTituloLegacy(tituloSeleccionado);
    const tMeta = _resolveTituloMeta(IDENTIDAD.tituloActivo);
    const el = document.getElementById("perfil-title-tag");
    if (el) {
        el.innerHTML = tMeta.fullText + ' <span class="perfil-title-edit-hint">✎</span>';
        // Slice H2b · color tag = color del título activo (deuda heritage fix)
        if (tMeta.color) el.style.setProperty("--title-color", tMeta.color);
    }
    _saveIdentidad();
    // Slice #6 P5: notifica cambio de título (parte del Pilar 1 identidad).
    if (typeof window !== "undefined" && typeof CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent("identidadChanged", { detail: { uid: APP?.user?.id, kind: "titulo" } }));
    }
    closeModal("modal-titulo-selector");
    showToast("✅ Título actualizado: " + tMeta.fullText, "success");
}

// ── buildBannerSelector ──────────────────────────────────────
/**
 * @interaction build-banner-selector
 * @scope perfil-shared-modal
 *
 * Given el usuario abre el modal `#modal-banner-selector` (click en
 *   "Cambiar banner" desde el banner del perfil).
 * When la apertura dispatcha este builder.
 * Then renderiza `#banner-selector-grid` con los 6 banners de
 *   `BANNERS_CATALOG`. Cada card muestra:
 *   - preview con gradient + grid + glow radial.
 *   - estado `desbloqueado` evaluado contra `_userStats(uid)` (overlay 🔒 si bloqueado).
 *   - check ✓ + clase `.activo` si coincide con `IDENTIDAD.bannerActivo`.
 *   - onclick `seleccionarBanner(id)` o toast informativo si bloqueado.
 *   Reset `bannerSeleccionado = IDENTIDAD.bannerActivo`.
 * Edge:
 *   - container `#banner-selector-grid` ausente → no-op.
 *   - `_userStats` falla → todos los banners se marcan bloqueados excepto los
 *     que tienen `unlock: s => true`.
 */
function buildBannerSelector() {
    const el = document.getElementById("banner-selector-grid");
    if (!el) return;
    bannerSeleccionado = IDENTIDAD.bannerActivo;

    const stats = _userStats(APP?.user?.id);
    const banners = BANNERS_CATALOG.map(b => ({
        ...b,
        desbloqueado: b.unlock ? b.unlock(stats) : true,
    }));

    el.innerHTML = banners.map(b => {
        const esActivo = IDENTIDAD.bannerActivo === b.id;
        return `
        <div class="banner-option ${b.desbloqueado ? '' : 'bloqueado'} ${esActivo ? 'activo' : ''}"
             style="--banner-glow:${b.glow}"
             onclick="${b.desbloqueado ? `seleccionarBanner('${b.id}')` : `showToast('🔒 Requiere: ${b.req}','info')`}">
            <div class="banner-option-preview" style="background:${b.preview}">
                <div class="banner-option-grid"></div>
                <div class="banner-option-glow" style="background:radial-gradient(ellipse 70% 60% at 50% 100%,${b.glow}50,transparent)"></div>
                ${!b.desbloqueado ? '<div class="banner-lock-overlay">🔒</div>' : ''}
                ${esActivo ? '<div class="banner-activo-check">✓</div>' : ''}
            </div>
            <div class="banner-option-info">
                <div class="banner-option-nombre">${b.nombre}</div>
                <div class="banner-option-req">${b.desbloqueado ? '✓ Disponible' : b.req}</div>
            </div>
        </div>`;
    }).join("");
}

/**
 * @interaction seleccionar-banner
 * @scope perfil-shared-modal
 *
 * Given el modal selector de banner abierto y renderizado.
 * When el usuario hace click en una preview desbloqueada.
 * Then setea `bannerSeleccionado = id` (no muta `IDENTIDAD` aún), limpia
 *   `.activo` de todas las cards y marca la card del índice del catálogo
 *   coincidente con `.activo` (highlight visual).
 * Edge:
 *   - id no presente en `BANNERS_CATALOG` → findIndex retorna -1, ninguna
 *     card recibe `.activo` (pero `bannerSeleccionado` sí queda seteado y
 *     `aplicarBanner` retornará no-op).
 *   - click en card bloqueada → no llega aquí (onclick condicional dispara toast).
 */
function seleccionarBanner(id) {
    bannerSeleccionado = id;
    document.querySelectorAll(".banner-option").forEach(el => el.classList.remove("activo"));
    // Mark selected visually
    const idx = BANNERS_CATALOG.findIndex(b => b.id === id);
    const options = document.querySelectorAll(".banner-option");
    if (options[idx]) options[idx].classList.add("activo");
}

/**
 * @interaction aplicar-banner
 * @scope perfil-shared-modal
 *
 * Given el usuario eligió un banner desbloqueado del catálogo
 *   (`bannerSeleccionado` contiene el id, e.g. "banner-gold").
 * When hace click en "Aplicar".
 * Then `IDENTIDAD.bannerActivo` se actualiza, el `.perfil-banner-bg` recibe
 *   el `preview` (gradient css), el `.perfil-banner` actualiza la variable
 *   CSS `--banner-glow-color`, `_saveIdentidad` persiste y sincroniza
 *   `DEMO_USERS[uid].gamer.bannerId`, se dispara `identidadChanged`
 *   (kind: banner) para consumers cross-vista, el modal se cierra y aparece
 *   un toast verde.
 * Edge:
 *   - id no existe en `BANNERS_CATALOG` → early return sin tocar nada.
 *   - `.perfil-banner-bg` / `.perfil-banner` ausentes → omite update DOM
 *     pero persiste igual.
 *   - `window` / `CustomEvent` no disponibles → omite el dispatch sin error.
 */
function aplicarBanner() {
    const banner = BANNERS_CATALOG.find(b => b.id === bannerSeleccionado);
    if (!banner) return;
    IDENTIDAD.bannerActivo = bannerSeleccionado;

    // Actualizar el banner en el perfil
    const bannerBg = document.querySelector(".perfil-banner-bg");
    if (bannerBg) bannerBg.style.background = banner.preview;

    // Actualizar el glow radial del banner
    const bannerEl = document.querySelector(".perfil-banner");
    if (bannerEl) bannerEl.style.setProperty("--banner-glow-color", banner.glow);

    _saveIdentidad();
    // Slice #6 P5: notifica cambio de banner (parte del Pilar 1 identidad).
    if (typeof window !== "undefined" && typeof CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent("identidadChanged", { detail: { uid: APP?.user?.id, kind: "banner" } }));
    }
    closeModal("modal-banner-selector");
    showToast("🖼️ Banner actualizado: " + banner.nombre, "success");
}

// ── _renderMaestriaMateriaHtml (Slice A B.1) ────────────────
// Bloque "Maestría en esta materia" condicional cuando contexto === 'materia'.
// Slice A: muestra placeholder porque la materia activa se inyecta vía
// estado global (APP.currentMateriaId) o un 4to arg `extras.materiaId` que se
// añadirá cuando el call-site Slice G lo necesite. Hardcoded demo: Juan en BD.
/**
 * @interaction render-maestria-materia-html
 * @scope perfil-shared-helper-contexto
 *
 * Given un `uid` cuyo perfil se está renderizando en modal/inline público
 *   y el contexto activo es `"materia"` (i.e. el modal se abre desde una
 *   card del tab Materias o desde el hub-materia).
 * When `buildPerfilPublico` / `_buildPerfilPublicoInlineHtml` evalúan el
 *   bloque condicional de mastery por disciplina y llaman este helper.
 * Then retorna HTML string con:
 *   - card sobria mostrando materia + nivel + puntos + chip cosmético activo
 *     si el uid tiene mastery hardcoded (demo: solo `est1` en BD).
 *   - placeholder "Sin mastery points registrados aún" en caso contrario.
 * Edge:
 *   - uid no en `demoMaestria` → render del placeholder (NUNCA retorna "").
 *   - lógica real post-Supabase reemplazará el `demoMaestria` hardcoded.
 */
function _renderMaestriaMateriaHtml(uid) {
    // Hardcoded demo: solo Juan tiene mastery en BD para Slice A.
    const demoMaestria = {
        "est1": {
            materia: "Bases de Datos (BD)",
            nivel: 6,
            puntos: 1250,
            cosmeticActivo: "Experto en BD",
        },
    };
    const m = demoMaestria[uid];
    if (!m) {
        return `
        <!-- Maestría en esta materia (Slice A B.1 · placeholder) -->
        <div style="margin-top:16px;padding:12px;background:var(--surface-2);
            border:1px solid var(--border);border-radius:var(--r-md)">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;
                letter-spacing:.06em;color:var(--text-muted);margin-bottom:6px">
                Maestría en esta materia
            </div>
            <div style="font-size:12px;color:var(--text-muted);font-style:italic">
                Sin mastery points registrados aún
            </div>
        </div>`;
    }
    return `
        <!-- Maestría en esta materia (Slice A B.1 · contexto='materia') -->
        <div style="margin-top:16px;padding:12px;background:var(--surface-2);
            border:1px solid var(--border);border-radius:var(--r-md)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <span style="font-size:11px;font-weight:700;text-transform:uppercase;
                    letter-spacing:.06em;color:var(--text-muted)">Maestría · ${m.materia}</span>
                <span style="font-family:var(--font-mono);font-size:13px;font-weight:700;
                    color:var(--accent-cyan-text)">N${m.nivel} · ${m.puntos.toLocaleString()} pts</span>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
                <span class="x-chip x-chip--info" style="font-size:11px">${m.cosmeticActivo}</span>
            </div>
        </div>`;
}

// ── _renderContribucionAlGrupoHtml (Slice A B.1) ────────────
// Bloque "Contribución al grupo" condicional cuando contexto === 'grupo'.
// Slice A: data hardcoded como placeholder; lógica real post-Supabase.
// Helper retorna "" si el uid no tiene contribución registrada en demo.
/**
 * @interaction render-contribucion-al-grupo-html
 * @scope perfil-shared-helper-contexto
 *
 * Given un `uid` cuyo perfil se está renderizando en modal/inline público y
 *   el contexto activo es `"grupo"` (i.e. el modal se abre desde una card
 *   de miembro del tab Mi Grupo).
 * When `buildPerfilPublico` / `_buildPerfilPublicoInlineHtml` evalúan el
 *   bloque condicional de contribución y llaman este helper.
 * Then retorna HTML string con bloque "Contribución al grupo": XP grupal +
 *   lista de highlights (3 tareas lideradas, insignias contribuidor, etc.).
 *   Datos demo hardcoded para los 5 miembros canónicos del mockup
 *   (est1..est5).
 * Edge:
 *   - uid no en `demoContrib` (e.g. miembros sintéticos) → retorna `""`
 *     (el caller no inyecta nada, NO un placeholder).
 *   - lógica real post-Supabase reemplazará `demoContrib`.
 */
function _renderContribucionAlGrupoHtml(uid) {
    // Hardcoded demo: 5 miembros canónicos del mockup B.1 Mi grupo.
    const demoContrib = {
        "est1": { xp: 450,  highlights: ["3 tareas colaborativas lideradas", "Insignia Madrugadores · contribuidor clave"] },
        "est2": { xp: 680,  highlights: ["2 insignias del grupo desbloqueadas", "Promedio cohorte +0.8 vs media"] },
        "est3": { xp: 280,  highlights: ["1 competencia ganada para el grupo"] },
        "est4": { xp: 590,  highlights: ["3 estandartes secundarios obtenidos"] },
        "est5": { xp: 120,  highlights: ["Asistencia perfecta P1"] },
    };
    const c = demoContrib[uid];
    if (!c) return "";
    const highlightsHtml = c.highlights.map(h => `
        <li style="margin-left:0;list-style:none;padding-left:18px;position:relative;
            font-size:12px;color:var(--text-secondary);margin-bottom:4px">
            <span style="position:absolute;left:0;top:2px;color:var(--xahni-amber);
                font-size:11px">✦</span>${h}
        </li>`).join("");
    return `
        <!-- Contribución al grupo (Slice A B.1 · contexto='grupo') -->
        <div style="margin-top:16px;padding:12px;background:var(--surface-2);
            border:1px solid var(--border);border-radius:var(--r-md)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <span style="font-size:11px;font-weight:700;text-transform:uppercase;
                    letter-spacing:.06em;color:var(--text-muted)">Contribución al grupo</span>
                <span style="font-family:var(--font-mono);font-size:13px;font-weight:700;
                    color:var(--xahni-amber)">+${c.xp.toLocaleString()} XP grupal</span>
            </div>
            <ul style="margin:0;padding:0">${highlightsHtml}</ul>
        </div>`;
}

// ── _buildPerfilPublicoInlineHtml (Slice A B.1) ─────────────
// Versión compacta del modal-perfil-publico para uso en grids
// (e.g., cards miembros de Mi grupo). Recorta barra XP + listado logros;
// conserva banner + avatar + nombre + título + slots + stats grid + top3 trofeos.
/**
 * @interaction build-perfil-publico-inline-html
 * @scope perfil-shared-helper-modal-publico
 *
 * Given `buildPerfilPublico` se invocó con `mode === "inline"` y ya derivó
 *   todo el contexto (banner+foto+marco+rango+nombre+stats+contexto+targetUid).
 * When `ctx` se pasa a este helper para generar la card compacta lista para
 *   inyectar en un grid (e.g., card miembro Mi grupo).
 * Then retorna HTML string `.perfil-pub-inline.x-card` con:
 *   - banner de 60px + chip de rango en esquina.
 *   - avatar 52px con marco + nombre + título + carrera/grupo (1 línea).
 *   - stats grid 4-col: XP / Niv / rango emoji / Trofeos.
 *   - slots equipados via `_renderSlotsPublico(u.gamer.slots)`.
 *   - bloque condicional `_renderContribucionAlGrupoHtml(targetUid)` si
 *     contexto === "grupo".
 *   - bloque condicional `_renderMaestriaMateriaHtml(targetUid)` si
 *     contexto === "materia".
 *   - top3 trofeos como chips inline.
 *   - top3 emblemas Maestría compactos via
 *     `_renderMaestriaEmblemasCompactoPublico` (Slice H2c) si la función
 *     existe.
 * Edge:
 *   - `ctx` parcial (alguna prop undefined) → render parcial sin crash
 *     (todos los accesos son safe-checked en el template).
 *   - top3trofeos vacío → omite la sección de trofeos.
 */
function _buildPerfilPublicoInlineHtml(ctx) {
    const { banner, foto, marco, marcoStyle, rango, nombre, titulo, tituloColor, carrera, grupo,
            xp, nivel, trofeos, top3trofeos, u, contexto, targetUid } = ctx;
    const _titColor = tituloColor || "var(--xahni-purple-light)";
    return `
    <div class="perfil-pub-inline x-card" style="padding:0;overflow:hidden;max-width:340px">
        <!-- Banner compacto -->
        <div style="height:60px;position:relative;overflow:hidden;background:${banner.preview}">
            <div style="position:absolute;top:6px;right:8px;display:flex;align-items:center;gap:4px;
                background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);border:1px solid ${rango.color}40;
                border-radius:99px;padding:2px 8px;font-size:10px;font-weight:700;color:${rango.color}">
                ${rango.emoji} ${rango.label}
            </div>
        </div>
        <!-- Avatar + info compacta -->
        <div style="padding:0 14px 12px;position:relative">
            <div style="display:flex;align-items:flex-end;gap:10px;margin-top:-20px;margin-bottom:8px">
                <div style="width:52px;height:52px;border-radius:50%;background:var(--brand-gradient);
                    display:flex;align-items:center;justify-content:center;
                    font-family:var(--font-mono);font-size:${foto.tipo === 'emoji' ? '24px' : '16px'};
                    font-weight:700;color:#fff;border:2px solid var(--surface-2);${marcoStyle}">
                    ${_fotoDisplay(foto, iniciales)}
                </div>
                <div style="padding-bottom:2px;min-width:0;flex:1">
                    <div style="font-family:var(--font-display);font-size:14px;font-weight:700;
                        color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                        ${nombre}
                    </div>
                    ${titulo ? `<div class="perfil-title-tag" style="--title-color:${_titColor};margin-top:2px;font-size:10px;padding:1px 8px">
                        ${titulo}
                    </div>` : ""}
                </div>
            </div>
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:10px">
                ${carrera} · ${grupo}
            </div>
            <!-- Stats grid compacto 4-col -->
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px">
                ${[
                    { num: xp.toLocaleString(),  label: "XP" },
                    { num: "Niv. " + nivel,      label: "Nivel" },
                    { num: rango.emoji,          label: rango.label },
                    { num: trofeos,              label: "Trof" },
                ].map(s => `
                <div style="background:var(--surface-2);border:1px solid var(--border);
                    border-radius:var(--r-sm);padding:6px 4px;text-align:center">
                    <div style="font-family:var(--font-mono);font-size:12px;font-weight:700;
                        background:var(--brand-gradient-h);-webkit-background-clip:text;
                        -webkit-text-fill-color:transparent;background-clip:text">${s.num}</div>
                    <div style="font-size:8px;color:var(--text-muted);text-transform:uppercase;
                        letter-spacing:.05em;margin-top:1px">${s.label}</div>
                </div>`).join("")}
            </div>
            <!-- Slots -->
            ${_renderSlotsPublico(u.gamer && u.gamer.slots)}
            <!-- Contribución al grupo (Slice A B.1 · contexto='grupo') -->
            ${contexto === "grupo" ? _renderContribucionAlGrupoHtml(targetUid) : ""}

            <!-- Maestría en esta materia (Slice A B.1 · contexto='materia') -->
            ${contexto === "materia" ? _renderMaestriaMateriaHtml(targetUid) : ""}

            <!-- Top 3 trofeos (compacto, chips) -->
            ${top3trofeos.length ? `
            <div style="display:flex;gap:4px;flex-wrap:wrap">
                ${top3trofeos.map(t => `
                <span style="display:inline-flex;align-items:center;gap:4px;background:var(--surface-2);
                    border:1px solid var(--border);border-radius:99px;padding:2px 8px;font-size:11px">
                    <span>${t.emoji}</span><span style="color:var(--text-secondary)">${t.nombre}</span>
                </span>`).join("")}
            </div>` : ""}
            <!-- Top 3 emblemas Maestría curados (Slice H2c, inline compacto) -->
            ${(typeof _renderMaestriaEmblemasCompactoPublico === "function")
                ? _renderMaestriaEmblemasCompactoPublico(targetUid) : ""}
        </div>
    </div>`;
}

// ── _renderSlotsPublico (Slice A B.1) ───────────────────────
// Renderea bloque visual de 3 slots del usuario. Usa DEMO_SLOTS_CATALOG si existe
// para resolver icono+tooltip; si no, fallback al raw value del array u.gamer.slots.
/**
 * @interaction render-slots-publico
 * @scope perfil-shared-helper-modal-publico
 *
 * Given un array `slotsArr` con hasta 3 valores (los slots equipados del
 *   usuario via `u.gamer.slots`).
 * When `buildPerfilPublico` (modal full) o `_buildPerfilPublicoInlineHtml`
 *   (modo inline) necesitan renderizar el bloque de slots.
 * Then retorna HTML string con:
 *   - label "Slots" + 3 celdas 36x36.
 *   - cada celda muestra ícono + tooltip del item resuelto via
 *     `DEMO_SLOTS_CATALOG.find(id)` o fallback al valor raw del array.
 *   - slot vacío → celda dashed gris con "·" + tooltip "Slot N vacío".
 * Edge:
 *   - `slotsArr` no-array (null, undefined) → 3 slots vacíos.
 *   - <3 elementos → rellena con null hasta 3.
 *   - `DEMO_SLOTS_CATALOG` no cargado → tooltip "Slot: <raw>" y `icono = slotVal`.
 *   - tooltip con comillas en `info.nombre` → escape de `"` a `&quot;` para
 *     evitar romper el atributo HTML.
 */
function _renderSlotsPublico(slotsArr) {
    const slots = Array.isArray(slotsArr) ? slotsArr.slice(0, 3) : [null, null, null];
    while (slots.length < 3) slots.push(null);
    const catalog = (typeof DEMO_SLOTS_CATALOG !== "undefined" && Array.isArray(DEMO_SLOTS_CATALOG))
        ? DEMO_SLOTS_CATALOG : [];
    const cellsHtml = slots.map((slotVal, i) => {
        if (!slotVal) {
            return `<div style="width:36px;height:36px;display:grid;place-items:center;
                background:var(--surface-2);border:1px dashed var(--border);
                border-radius:8px;color:var(--text-muted);font-size:14px"
                title="Slot ${i + 1} vacío">·</div>`;
        }
        const info = catalog.find(s => s.id === slotVal);
        const icono = (info && info.icono) || slotVal;
        const titulo = info ? `${info.nombre}: ${info.descripcion}` : `Slot: ${slotVal}`;
        return `<div style="width:36px;height:36px;display:grid;place-items:center;
            background:var(--surface-2);border:1px solid var(--border);
            border-radius:8px;font-size:18px"
            title="${String(titulo).replace(/"/g, "&quot;")}">${icono}</div>`;
    }).join("");
    return `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
            <span style="font-size:10px;color:var(--text-muted);text-transform:uppercase;
                letter-spacing:.06em;font-family:var(--font-mono)">Slots</span>
            <div style="display:flex;gap:6px">${cellsHtml}</div>
        </div>`;
}

// ── buildPerfilPublico ───────────────────────────────────────
// Slice A B.1: generalizada para aceptar uid + mode + contexto.
// Slice "fix orchestration": añadido target Element opcional para uso en grids
// (Slice C cards miembros Mi grupo, Slice G cards tab Maestría hub-materia).
// Backwards compat: sin args → renderea el perfil del usuario logueado (APP.user),
// modo modal full, contexto preview, target = elemento del modal (#perfil-publico-content).
// Spec: docs/superpowers/specs/2026-05-30-spec-b1-rediseno-mi-grupo-maestria.md §4.7
/**
 * @interaction build-perfil-publico
 * @scope perfil-shared-modal-publico
 *
 * Given un caller que necesita renderizar la card pública del perfil de un
 *   usuario (propio o ajeno), en formato modal completo o inline compacto,
 *   con bloques específicos según el contexto desde el que se invocó.
 *   Args:
 *     - `uid` (default null → APP.user.id): user a renderizar.
 *     - `mode` ∈ {`modal`, `inline`} (default `modal`): full vs compacto.
 *     - `contexto` ∈ {`preview`, `grupo`, `materia`} (default `preview`):
 *       activa bloques condicionales (Contribución al grupo, Maestría en
 *       esta materia).
 *     - `target` (default `#perfil-publico-content` del modal): Element
 *       donde escribir `innerHTML` (cards en grids le pasan su contenedor).
 * When un consumer abre el modal de perfil público (preview/grupo/materia)
 *   o renderiza inline una card miembro en Mi Grupo / Maestría.
 * Then orquesta el render en 6 pasos:
 *   1. Resuelve `target` Element (arg o `#perfil-publico-content`); guard
 *      si ausente → no-op.
 *   2. Resuelve `targetUid` + `u` (DEMO_USERS lookup), determina
 *      `isCurrentUser` (uid coincide con APP.user.id).
 *   3. Deriva nombre / iniciales / xp / nivel / grupo / carrera /
 *      semestre — con fallbacks para users con campos faltantes.
 *   4. **Rama currentUser vs otherUser** para banner/título/foto/marco:
 *      - `isCurrentUser` → lee `IDENTIDAD` + `AVATAR_STATE` (estado en
 *        memoria con cambios pendientes, preserva preview en vivo).
 *      - otro user → lee `u.gamer.*` (lookup explícito en DEMO_USERS); aplica
 *        `_migrarTituloLegacy` + `_migrarMarcoLegacy` por shape mixto.
 *      - `_resolveTituloMeta` resuelve `tituloMeta` (label + glyph + color +
 *        fullText). `_resolveMarcoMeta` resuelve `marco`.
 *   5. Stats vivas: trofeos / logros desbloqueados via getters reales,
 *      top3 trofeos + top6 logros para listas.
 *   6. **Rama mode='inline'** → delega a `_buildPerfilPublicoInlineHtml(ctx)`
 *      y retorna (versión compacta para grids).
 *      Rama mode='modal' (default) → genera HTML full con:
 *      - Banner 100px + chip de rango.
 *      - Avatar 72px flotante + nombre + título + glow.
 *      - Carrera/grupo + stats grid 4-col.
 *      - Slots equipados via `_renderSlotsPublico`.
 *      - Barra XP hacia siguiente rango (`RANGOS` cross-file) o "Rango
 *        máximo alcanzado" si el rango actual es el último.
 *      - Top 3 trofeos listados verticalmente (omite si vacío).
 *      - Top 3 emblemas Maestría compactos (Slice H2c) si la función
 *        existe en perfil-gamificacion.js.
 *      - Bloque condicional `_renderContribucionAlGrupoHtml(targetUid)` si
 *        contexto === "grupo".
 *      - Bloque condicional `_renderMaestriaMateriaHtml(targetUid)` si
 *        contexto === "materia".
 *      - Top 6 logros desbloqueados como chips con su color.
 * Edge:
 *   - target Element ausente → no-op silencioso.
 *   - uid no resuelve user en DEMO_USERS → fallback a APP.user o `{}`.
 *   - mode distinto de "modal" / "inline" → cae al modal default.
 *   - sin trofeos / logros / mastery → omite las secciones correspondientes.
 *   - `RANGOS` siguiente undefined (rango actual = último) → muestra
 *     "🏆 Rango máximo alcanzado".
 *   - `_renderMaestriaEmblemasCompactoPublico` no cargada → omite bloque
 *     sin error.
 */
function buildPerfilPublico(uid, mode = "modal", contexto = "preview", target) {
    const el = target instanceof Element
        ? target
        : document.getElementById("perfil-publico-content");
    if (!el) return;

    // Resolver target user: si no se pasa uid, usar APP.user (backwards compat).
    const targetUid = uid || APP?.user?.id || null;
    const u = (targetUid && typeof DEMO_USERS !== "undefined")
        ? (DEMO_USERS.find(x => x.id === targetUid) || APP.user || {})
        : (APP.user || {});
    const isCurrentUser = targetUid && targetUid === APP?.user?.id;
    const nombre  = u.nombre    || "Estudiante";
    const iniciales = u.iniciales || nombre.slice(0, 2).toUpperCase();
    // xp y nivel: source of truth es GamerState (cache hidratado de Firestore
    // gamerState/{uid}). u.puntos/u.nivel son los seeds canónicos de DEMO_USERS
    // que NUNCA se actualizan post-hydrate del current user, por eso el render
    // mostraba 0/L1 incluso con datos reales en Firestore (sprint pre-entrega).
    // Fallback al seed solo si GamerState no está cargado o no tiene este uid.
    const _gs = (typeof GamerState !== "undefined" && GamerState.get && targetUid)
        ? GamerState.get(targetUid) : null;
    const xp      = (_gs && typeof _gs.xp === "number")    ? _gs.xp    : (u.puntos || 0);
    const nivel   = (_gs && typeof _gs.nivel === "number") ? _gs.nivel : (u.nivel  || 1);
    const grupoId = (u.grupos || [])[0] || "ISC-3A";
    const carrera = u.carrera || _carreraDelGrupo(grupoId);
    // Mismo fix que R7: priorizar grupo.nivel (1-12) del JSON sobre el parse
    // heurístico del grupoId con /-(\d+)/, que para grupos con timestamp
    // (ej. "grupo-smoke-1780809551072") sacaría el timestamp como semestre.
    const _grupoDoc = (typeof DEMO_GRUPOS !== "undefined" && Array.isArray(DEMO_GRUPOS))
        ? DEMO_GRUPOS.find(g => g.id === grupoId) : null;
    let _semNum = (_grupoDoc && Number.isInteger(_grupoDoc.nivel) && _grupoDoc.nivel >= 1 && _grupoDoc.nivel <= 12)
        ? _grupoDoc.nivel : null;
    if (_semNum === null) {
        const m = String(grupoId).match(/-(\d+)/);
        const parsed = m ? parseInt(m[1], 10) : null;
        _semNum = (parsed != null && parsed >= 1 && parsed <= 12) ? parsed : null;
    }
    const sem      = _semNum != null ? _semNum : "—";
    // Display amigable del grupo: prefiere grupo.nombre sobre id literal.
    const _grupoDisplay = (_grupoDoc && _grupoDoc.nombre) ? _grupoDoc.nombre : grupoId;
    const grupo    = u.grupo || `${_grupoDisplay} · Semestre ${sem}`;

    // ── Rango derivado del XP real ──
    const rango = calcularRango(xp);

    // ── Banner, título y avatar per-uid (Slice A B.1) ──
    // Para el usuario logueado: usa IDENTIDAD + AVATAR_STATE (en memoria con cambios pendientes)
    // para preservar el comportamiento de "preview en vivo de mis cambios".
    // Para otros usuarios: deriva todo desde u.gamer.* (lookup explícito en DEMO_USERS).
    let banner, tituloMeta, foto, marco;
    if (isCurrentUser) {
        banner     = BANNERS_CATALOG.find(b => b.id === IDENTIDAD.bannerActivo) || BANNERS_CATALOG[0];
        // Slice H2b/H2c: resolver shape {kind,id} → tituloMeta completo (fullText + color)
        tituloMeta = _resolveTituloMeta(IDENTIDAD.tituloActivo);
        foto       = AVATARES_FOTOS.find(f => f.id === AVATAR_STATE.fotoId) || AVATARES_FOTOS[0];
        marco      = _resolveMarcoMeta(AVATAR_STATE.marcoId);
    } else {
        const g = (u && u.gamer) || {};
        banner     = BANNERS_CATALOG.find(b => b.id === g.bannerId) || BANNERS_CATALOG[0];
        // Slice H2b/H2c: migrar shape y resolver a tituloMeta completo
        tituloMeta = _resolveTituloMeta(_migrarTituloLegacy(g.tituloActivo));
        foto       = AVATARES_FOTOS.find(f => f.id === g.fotoId) || AVATARES_FOTOS[0];
        marco      = _resolveMarcoMeta(_migrarMarcoLegacy(g.marcoId));
    }
    const titulo      = tituloMeta.fullText;
    const tituloColor = tituloMeta.color || "var(--xahni-purple-light)";
    const marcoStyle = marco.css ? marco.css + ";flex-shrink:0" : "flex-shrink:0";

    // ── Stats calculadas (en vivo por user target · Slice A B.1) ──
    const uidPub = targetUid || u.id || APP?.user?.id;
    const trofeosLista = (typeof getTrofeosAlumno === "function" && uidPub)
        ? getTrofeosAlumno(uidPub) : [];
    const logrosLista  = (typeof getLogrosAlumno === "function" && uidPub)
        ? getLogrosAlumno(uidPub) : [];
    const trofeos     = trofeosLista.length;
    const logrosDesbloqueados = logrosLista.filter(l => l.desbloqueado);
    const top3trofeos = trofeosLista.slice(0, 3);
    const top6logros  = logrosDesbloqueados.slice(0, 6);

    // ── Slice A B.1: rama mode='inline' produce versión compacta para grids.
    // Compartido: banner + avatar + nombre + título + carrera + stats + slots.
    // Recorta en inline: barra XP hacia siguiente rango + listado top6 logros.
    if (mode === "inline") {
        el.innerHTML = _buildPerfilPublicoInlineHtml({
            banner, foto, marco, marcoStyle, rango, nombre, titulo, tituloColor, carrera, grupo,
            xp, nivel, trofeos, top3trofeos, u, contexto, targetUid
        });
        return;
    }
    el.innerHTML = `
    <!-- Banner público -->
    <div style="height:100px;position:relative;overflow:hidden;background:${banner.preview}">
        <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.04) 1px,transparent 1px);background-size:20px 20px"></div>
        <div style="position:absolute;inset:0;background:radial-gradient(ellipse 80% 80% at 80% 50%,${banner.glow}30,transparent)"></div>
        <!-- Chip de rango en la esquina -->
        <div style="position:absolute;top:10px;right:12px;display:flex;align-items:center;gap:5px;
            background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);border:1px solid ${rango.color}40;
            border-radius:99px;padding:3px 10px;font-size:11px;font-weight:700;color:${rango.color}">
            ${rango.emoji} ${rango.label}
        </div>
    </div>

    <!-- Info principal -->
    <div style="padding:0 20px 16px;position:relative">
        <!-- Avatar flotante sobre el banner -->
        <div style="display:flex;align-items:flex-end;gap:14px;margin-top:-28px;margin-bottom:12px">
            <div style="width:72px;height:72px;border-radius:50%;background:var(--brand-gradient);
                display:flex;align-items:center;justify-content:center;
                font-family:var(--font-mono);font-size:${foto.tipo === 'emoji' ? '32px' : '22px'};
                font-weight:700;color:#fff;border:3px solid var(--surface-2);
                box-shadow:0 0 20px ${banner.glow}60;${marcoStyle}">
                ${_fotoDisplay(foto, iniciales)}
            </div>
            <div style="padding-bottom:4px;min-width:0">
                <div style="font-family:var(--font-display);font-size:18px;font-weight:700;
                    color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                    ${nombre}
                </div>
                <div class="perfil-title-tag" style="--title-color:${tituloColor};margin-top:3px;font-size:11px">
                    ${titulo}
                </div>
            </div>
        </div>

        <!-- Carrera y grupo -->
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">
            ${carrera} · ${grupo}
        </div>

        <!-- Stats en vivo -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">
            ${[
                { num: xp.toLocaleString(),    label: "XP"      },
                { num: "Niv. " + nivel,        label: "Nivel"   },
                { num: rango.emoji,            label: rango.label },
                { num: trofeos,                label: "Trofeos" },
            ].map(s => `
            <div style="background:var(--surface-2);border:1px solid var(--border);
                border-radius:var(--r-md);padding:10px 8px;text-align:center">
                <div style="font-family:var(--font-mono);font-size:15px;font-weight:700;
                    background:var(--brand-gradient-h);-webkit-background-clip:text;
                    -webkit-text-fill-color:transparent;background-clip:text">${s.num}</div>
                <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;
                    letter-spacing:.05em;margin-top:2px">${s.label}</div>
            </div>`).join("")}
        </div>

        <!-- Slots equipados del user (Slice A B.1) -->
        ${_renderSlotsPublico(u.gamer && u.gamer.slots)}

        <!-- Barra de XP hacia siguiente rango -->
        ${(() => {
            const siguiente = RANGOS[RANGOS.indexOf(rango) + 1];
            if (!siguiente) return `<div style="font-size:11px;color:${rango.color};text-align:center;margin-bottom:16px">🏆 Rango máximo alcanzado</div>`;
            const pct = Math.min(100, Math.round(((xp - rango.xpMin) / (siguiente.xpMin - rango.xpMin)) * 100));
            return `
            <div style="margin-bottom:16px">
                <div style="display:flex;justify-content:space-between;font-size:10px;
                    color:var(--text-muted);margin-bottom:5px">
                    <span>${rango.label} · ${xp.toLocaleString()} XP</span>
                    <span>Siguiente: ${siguiente.label} · ${(siguiente.xpMin - xp).toLocaleString()} XP</span>
                </div>
                <div style="height:4px;background:var(--surface-3);border-radius:99px;overflow:hidden">
                    <div style="height:100%;width:${pct}%;background:${rango.color};
                        border-radius:99px;box-shadow:0 0 6px ${rango.glow}"></div>
                </div>
            </div>`;
        })()}

        <!-- Trofeos destacados -->
        ${top3trofeos.length ? `
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;
            letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px">Trofeos</div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">
            ${top3trofeos.map(t => `
            <div style="display:flex;align-items:center;gap:10px;background:var(--surface-2);
                border:1px solid var(--border);border-radius:var(--r-md);padding:8px 12px">
                <span style="font-size:20px">${t.emoji}</span>
                <div style="flex:1;min-width:0">
                    <div style="font-size:12px;font-weight:600;color:var(--text-primary);
                        white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.nombre}</div>
                    <div style="font-size:10px;color:var(--text-muted)">${t.fecha}</div>
                </div>
                <span style="font-family:var(--font-mono);font-size:11px;
                    color:${t.glowColor};white-space:nowrap">${t.pts}</span>
            </div>`).join("")}
        </div>` : ""}

        <!-- Top 3 emblemas Maestría curados (Slice H2c) -->
        ${(typeof _renderMaestriaEmblemasCompactoPublico === "function")
            ? _renderMaestriaEmblemasCompactoPublico(targetUid) : ""}

        <!-- Contribución al grupo (Slice A B.1 · contexto='grupo') -->
        ${contexto === "grupo" ? _renderContribucionAlGrupoHtml(targetUid) : ""}

        <!-- Maestría en esta materia (Slice A B.1 · contexto='materia') -->
        ${contexto === "materia" ? _renderMaestriaMateriaHtml(targetUid) : ""}

        <!-- Logros desbloqueados -->
        ${top6logros.length ? `
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;
            letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px">
            Logros <span style="font-weight:400;text-transform:none;letter-spacing:0">
                — ${logrosDesbloqueados.length}/${logrosLista.length} obtenidos
            </span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${top6logros.map(l => `
            <div style="background:var(--surface-2);border:1px solid ${l.color}40;
                border-radius:var(--r-md);padding:6px 10px;display:flex;align-items:center;
                gap:6px;font-size:12px;color:var(--text-secondary)">
                <span>${l.emoji}</span> ${l.nombre}
            </div>`).join("")}
        </div>` : ""}
    </div>`;
}

// openModal es parcheado en modals.js para inicializar estos modales
