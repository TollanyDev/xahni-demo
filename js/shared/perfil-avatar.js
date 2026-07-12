// ═══════════════════════════════════════════════════════════
// AVATAR · Catálogos + persistencia + helper canonical
//          + modal selector + render
// Slice #12 split (2026-06-01): extraído de perfil.js
// Slice #13 JSDoc rolling (2026-06-01): cobertura 100%
// ═══════════════════════════════════════════════════════════

// ── Estado del avatar ────────────────────────────────────────
const AVATAR_STATE = {
    fotoId: "foto-default",
    // Slice H2b · marcoId migrado a shape {kind:"personal"|"maestria", id:string}
    marcoId: { kind: "personal", id: "marco-ninguno" },
};

// Defaults para resetear estado al cambiar de usuario
const _AVATAR_DEFAULTS    = { fotoId: "foto-default", marcoId: { kind: "personal", id: "marco-ninguno" } };

/**
 * @interaction foto-display
 * @scope shared-helper-internal
 *
 * Given un objeto `foto` del catálogo `AVATARES_FOTOS` (o `null`).
 * When un builder o render necesita el contenido visible del avatar.
 * Then resuelve:
 *   - foto.tipo === "iniciales" → `APP.user.iniciales` (e.g. "JP")
 *   - foto con emoji → el `emoji` literal (e.g. "🏆")
 *   - foto faltante o sin emoji → "?".
 * Edge sin usuario activo + tipo "iniciales" → "?".
 */
function _fotoDisplay(foto, fallbackIniciales) {
    if (!foto) return "?";
    if (foto.tipo === "iniciales") return fallbackIniciales || APP?.user?.iniciales || "?";
    return foto.emoji || "?";
}

// ── Catálogo de fotos de perfil ──────────────────────────────
const AVATARES_FOTOS = [
    { id: "foto-default", emoji: "", tipo: "iniciales", nombre: "Iniciales", req: "Disponible", rareza: "comun", unlock: s => true },
    { id: "foto-codigo", emoji: "💻", tipo: "emoji", nombre: "Coder", req: "Disponible", rareza: "comun", unlock: s => true },
    { id: "foto-estrella", emoji: "⭐", tipo: "emoji", nombre: "Estrella", req: "Completa 5 logros", rareza: "raro", unlock: s => s.logros >= 5 },
    { id: "foto-trofeo", emoji: "🏆", tipo: "emoji", nombre: "Campeón", req: "Gana un torneo", rareza: "epico", unlock: s => s.trofeos >= 1 },
    { id: "foto-fuego", emoji: "🔥", tipo: "emoji", nombre: "En Llamas", req: "Racha 7 días", rareza: "raro", unlock: s => s.rachaMax >= 7 },
    { id: "foto-cohete", emoji: "🚀", tipo: "emoji", nombre: "Cohete", req: "Proyecto ganador", rareza: "epico", unlock: s => s.logros >= 8 },
    { id: "foto-diamante", emoji: "💎", tipo: "emoji", nombre: "Diamante", req: "Alcanza rango Platino", rareza: "legendario", unlock: s => s.nivel >= 20 },
    { id: "foto-corona", emoji: "👑", tipo: "emoji", nombre: "Corona", req: "Sé #1 del ranking", rareza: "legendario", unlock: s => s.top1 },
    { id: "foto-aguila", emoji: "🦅", tipo: "emoji", nombre: "Águila", req: "Logro Maestro", rareza: "legendario", unlock: s => s.logros >= 12 },
];

/**
 * @interaction derive-marco-tier
 * @scope shared-helper-internal
 *
 * Given una `rareza` ("comun" | "raro" | "epico" | "legendario") de un marco.
 * When un consumer cross-vista (hub-grupo cards, etc.) necesita la clase CSS
 *   legacy `--epic`/`--rare`/`--common` y el usuario NO tiene `gamer.marco`
 *   legacy sembrado en DEMO_USERS.
 * Then retorna "epic" si rareza ≥ epico, sino "common".
 * Edge usuarios con `gamer.marco` legacy preservan su valor verbatim a través
 *   de `getAvatarDisplay.marcoTier` (ver shape de retorno).
 */
function _deriveMarcoTier(rareza) {
    if (rareza === "epico" || rareza === "legendario") return "epic";
    return "common";
}

// ── Slice H2b · Helpers de resolución de marco (kind+id) ──────

/**
 * @interaction migrar-marco-legacy
 * @scope shared-helper-internal
 *
 * Given un valor legacy de `marcoId` (string "marco-azul", objeto `{kind,id}`
 *   ya migrado, o falsy).
 * When `_loadAvatarState`/`getAvatarDisplay` necesita normalizar a shape canónico.
 * Then:
 *   - objeto con `kind`+`id` → devuelve unchanged.
 *   - string no vacío → envuelve en `{kind:"personal", id:legacyValue}`.
 *   - falsy/inválido → fallback `{kind:"personal", id:"marco-ninguno"}`.
 * Edge string ya normalizado pero `id` inexistente en catálogo → `_resolveMarcoMeta`
 *   caerá a fallback marco-ninguno.
 */
function _migrarMarcoLegacy(legacyValue) {
    if (legacyValue && typeof legacyValue === "object" && legacyValue.kind && legacyValue.id) {
        return legacyValue;
    }
    if (typeof legacyValue === "string" && legacyValue.length > 0) {
        return { kind: "personal", id: legacyValue };
    }
    return { kind: "personal", id: "marco-ninguno" };
}

/**
 * @interaction resolve-marco-meta
 * @scope shared-helper-internal
 *
 * Given un `marcoId` shape `{kind, id}` ya migrado por `_migrarMarcoLegacy`.
 * When `getAvatarDisplay` / `_renderAvatarFromState` / `aplicarAvatar` /
 *   `buildAvatarMarcosGrid` necesitan el metadata visual del marco (preview
 *   gradient + css box-shadow + label + rareza).
 * Then:
 *   - `kind === "personal"` → busca en `AVATARES_MARCOS` y retorna el match.
 *   - `kind === "maestria"` → busca en `_getCosmeticsCatalog()`, deriva gradient
 *     + css por disciplina (BD cyan, POO purple, ED teal) y tier (oro/temárico).
 *   - shape inválido o id inexistente → fallback marco-ninguno (preview "none").
 * Edge `_getCosmeticsCatalog` no cargado (orden de scripts) → fallback marco-ninguno.
 */
function _resolveMarcoMeta(marcoId) {
    const fallback = () => AVATARES_MARCOS[0] || { id: "marco-ninguno", label: "Sin marco", preview: "none", css: "", rareza: "comun", kind: "personal" };
    if (!marcoId || typeof marcoId !== "object") return Object.assign({}, fallback(), { kind: "personal" });
    if (marcoId.kind === "personal") {
        const m = AVATARES_MARCOS.find(x => x.id === marcoId.id);
        return Object.assign({}, m || fallback(), { kind: "personal" });
    }
    if (marcoId.kind === "maestria") {
        const catalog = (typeof _getCosmeticsCatalog === "function") ? _getCosmeticsCatalog() : {};
        const c = catalog[marcoId.id];
        if (!c) return Object.assign({}, fallback(), { kind: "personal" });
        const discId = (typeof _getMaestriaCosmeticDisciplina === "function") ? _getMaestriaCosmeticDisciplina(marcoId.id) : "";
        const isOro = /oro/i.test(marcoId.id);
        const gradByDisc = { bd: "linear-gradient(135deg,#00d4ff,#1b4fe4)", poo: "linear-gradient(135deg,#a855f7,#8b2be2)", ed: "linear-gradient(135deg,#00c6a7,#1b4fe4)", mat: "linear-gradient(135deg,#00c6a7,#1b4fe4)" };
        const cssByDisc = { bd: "box-shadow:0 0 0 3px #00d4ff,0 0 18px #00d4ff70", poo: "box-shadow:0 0 0 3px #a855f7,0 0 18px #a855f770", ed: "box-shadow:0 0 0 3px #00c6a7,0 0 18px #00c6a770", mat: "box-shadow:0 0 0 3px #00c6a7,0 0 18px #00c6a770" };
        const oroGrad = "linear-gradient(135deg,#f5a623,#ff6b00)";
        const oroCss = "box-shadow:0 0 0 3px #f5a623,0 0 24px #f5a62380;animation:marco-glow-gold 2s ease-in-out infinite";
        return {
            id: marcoId.id,
            label: c.label,
            preview: isOro ? oroGrad : (gradByDisc[discId] || gradByDisc.bd),
            css: isOro ? oroCss : (cssByDisc[discId] || cssByDisc.bd),
            rareza: isOro ? "legendario" : "epico",
            disciplinaId: discId,
            kind: "maestria"
        };
    }
    return Object.assign({}, fallback(), { kind: "personal" });
}

const AVATARES_MARCOS = [
    { id: "marco-ninguno", label: "Sin marco", preview: "none", req: "Disponible", rareza: "comun", css: "", unlock: s => true },
    { id: "marco-azul", label: "Azul Estándar", preview: "linear-gradient(135deg,#1b4fe4,#00d4ff)", req: "Disponible", rareza: "comun", css: "box-shadow:0 0 0 3px #1b4fe4,0 0 12px #1b4fe460", unlock: s => true },
    { id: "marco-teal", label: "Teal Activo", preview: "linear-gradient(135deg,#00c6a7,#1b4fe4)", req: "Disponible", rareza: "comun", css: "box-shadow:0 0 0 3px #00c6a7,0 0 12px #00c6a760", unlock: s => true },
    { id: "marco-oro", label: "Oro · Campeón", preview: "linear-gradient(135deg,#f5a623,#ff6b00)", req: "Gana un torneo", rareza: "epico", css: "box-shadow:0 0 0 3px #f5a623,0 0 18px #f5a62370;animation:marco-glow-gold 2s ease-in-out infinite", unlock: s => s.trofeos >= 1 },
    { id: "marco-fuego", label: "Fuego · Racha", preview: "linear-gradient(135deg,#e84040,#f5a623)", req: "Racha de 14 días", rareza: "epico", css: "box-shadow:0 0 0 3px #e84040,0 0 18px #e8404070;animation:marco-glow-fire 1.5s ease-in-out infinite", unlock: s => s.rachaMax >= 14 },
    { id: "marco-platino", label: "Platino · Élite", preview: "linear-gradient(135deg,#00d4ff,#8b2be2)", req: "Alcanza rango Platino", rareza: "legendario", css: "box-shadow:0 0 0 3px #00d4ff,0 0 24px #00d4ff80;animation:marco-glow-plat 2s ease-in-out infinite", unlock: s => s.nivel >= 20 },
    { id: "marco-diamante", label: "Diamante", preview: "linear-gradient(135deg,#a855f7,#00d4ff,#f5a623)", req: "Alcanza rango Diamante", rareza: "legendario", css: "box-shadow:0 0 0 3px #a855f7,0 0 28px #a855f780;animation:marco-glow-dia 1.8s ease-in-out infinite", unlock: s => s.nivel >= 30 },
];

// ── Persistencia de avatar (namespaced por usuario) ─────────

/**
 * @interaction avatar-key
 * @scope shared-persistencia
 *
 * Given un usuario logueado (`APP.user.id` definido).
 * When `_loadAvatarState`/`_saveAvatarState` necesitan la clave localStorage.
 * Then devuelve `xahni_avatar_<uid>`.
 * Edge sin usuario activo → `null` (caller no persiste).
 */
function _avatarKey()    { const uid = APP?.user?.id; return uid ? `xahni_avatar_${uid}`    : null; }

/**
 * @interaction load-avatar-state
 * @scope shared-persistencia
 *
 * Given un nuevo login (`APP.user.id` recién seteado) y `_initGamificacion`
 *   dispatcha este helper.
 * When se necesita hidratar `AVATAR_STATE` desde fuente de verdad cross-sesión.
 * Then orden de resolución:
 *   1. Reset a `_AVATAR_DEFAULTS` (limpia state del usuario anterior).
 *   2. Hidrata desde `DEMO_USERS[uid].gamer.{fotoId,marcoId}` (seed o sincronización
 *      previa).
 *   3. Overlay con `localStorage[xahni_avatar_<uid>]` (override del usuario,
 *      prevalece).
 *   4. Normaliza `marcoId` a shape `{kind,id}` via `_migrarMarcoLegacy`.
 *   5. `_syncAvatarToDemoUser` reconcilia DEMO_USERS con AVATAR_STATE final.
 * Edge:
 *   - sin usuario activo → reset a defaults y return.
 *   - localStorage corrupto → catch silencioso, AVATAR_STATE queda con valores
 *     desde DEMO_USERS.
 */
function _loadAvatarState() {
    Object.assign(AVATAR_STATE, _AVATAR_DEFAULTS);
    // 1. Hidrata desde DEMO_USERS[uid].gamer (fuente de verdad — Opción A slice #6)
    const uid = APP?.user?.id;
    const u   = uid && typeof DEMO_USERS !== "undefined" ? DEMO_USERS.find(x => x.id === uid) : null;
    const g   = u && u.gamer;
    if (g) {
        if (typeof g.fotoId  === "string" && g.fotoId)  AVATAR_STATE.fotoId  = g.fotoId;
        // Slice H2b · wrap con _migrarMarcoLegacy para normalizar a shape {kind,id}
        if (g.marcoId !== undefined) AVATAR_STATE.marcoId = _migrarMarcoLegacy(g.marcoId);
    }
    // 2. Overlay con localStorage (override del usuario, prevalece)
    const k = _avatarKey();
    if (!k) return;
    let hadLocalOverride = false;
    try {
        const raw = localStorage.getItem(k);
        if (raw) {
            Object.assign(AVATAR_STATE, JSON.parse(raw));
            // Slice H2b · normalizar marcoId desde localStorage legacy
            AVATAR_STATE.marcoId = _migrarMarcoLegacy(AVATAR_STATE.marcoId);
            hadLocalOverride = true;
        }
    } catch(e) {}
    _syncAvatarToDemoUser();
    // Backfill: si había override local del avatar pero Firestore aún no lo
    // tiene (caso usuario que cambió en otro device antes del fix), push.
    // firestorePersistUserAvatar es idempotente y no-op en modo demo.
    if (hadLocalOverride && uid && typeof window.firestorePersistUserAvatar === "function") {
        window.firestorePersistUserAvatar(uid, {
            fotoId:  AVATAR_STATE.fotoId,
            marcoId: AVATAR_STATE.marcoId
        });
    }
}

/**
 * @interaction save-avatar-state
 * @scope shared-persistencia
 *
 * Given el usuario acaba de aplicar un nuevo avatar (`aplicarAvatar` mutó
 *   `AVATAR_STATE.{fotoId, marcoId}`).
 * When se persiste el state a localStorage y se sincroniza DEMO_USERS.
 * Then escribe `xahni_avatar_<uid>` con JSON.stringify + dispatcha
 *   `_syncAvatarToDemoUser` para que consumers cross-vista (sidebar, hub-grupo,
 *   modal perfil público) reflejen el cambio sin tener que consultar
 *   localStorage namespaced.
 * Edge sin usuario activo → solo `_syncAvatarToDemoUser` (que tampoco hará
 *   nada sin uid).
 */
function _saveAvatarState() {
    const k = _avatarKey();
    if (k) localStorage.setItem(k, JSON.stringify(AVATAR_STATE));
    _syncAvatarToDemoUser();
    // Persist a Firestore para que el cambio sea visible cross-device
    // y en el modal perfil público que otros usuarios abren sobre este uid.
    const uid = APP?.user?.id;
    if (uid && typeof window.firestorePersistUserAvatar === "function") {
        window.firestorePersistUserAvatar(uid, {
            fotoId:  AVATAR_STATE.fotoId,
            marcoId: AVATAR_STATE.marcoId
        });
    }
}

/**
 * @interaction sync-avatar-to-demo-user
 * @scope shared-persistencia
 *
 * Given `AVATAR_STATE` tiene el valor canónico del usuario activo.
 * When `_loadAvatarState`/`_saveAvatarState` lo dispatchan para reconciliar.
 * Then muta `DEMO_USERS[currentUid].gamer.{fotoId, marcoId}` con los valores
 *   actuales de AVATAR_STATE. Asegura que `getAvatarDisplay(otherUid).fotoTexto`
 *   y consumers cross-vista lean el mismo valor sin consultar localStorage.
 * Edge:
 *   - sin usuario activo o DEMO_USERS no cargado → no-op.
 *   - usuario no encontrado en DEMO_USERS → no-op.
 *   - `u.gamer` undefined → inicializa a `{}` antes de mutar.
 */
function _syncAvatarToDemoUser() {
    const uid = APP?.user?.id;
    if (!uid || typeof DEMO_USERS === "undefined") return;
    const u = DEMO_USERS.find(x => x.id === uid);
    if (!u) return;
    if (!u.gamer) u.gamer = {};
    u.gamer.fotoId  = AVATAR_STATE.fotoId;
    u.gamer.marcoId = AVATAR_STATE.marcoId;
}

// ═══════════════════════════════════════════════════════════
// HELPER PÚBLICO — getAvatarDisplay(uid)  [slice #6 Pilar 1]
// ═══════════════════════════════════════════════════════════

/**
 * @interaction get-avatar-display
 * @scope shared-helper-canonical-cross-vista
 *
 * Given un `uid` (cualquier usuario, no solo el actual).
 * When CUALQUIER consumidor cross-vista (sidebar, hub-grupo, hub-inicio,
 *   competencias, gestión profesor, admin/usuarios, modal perfil público,
 *   dashboard, ranking, etc.) necesita renderear el avatar + marco + banner
 *   + título de un usuario.
 * Then retorna shape canónico de 10 campos:
 *   - `fotoTexto`: emoji o iniciales (según tipo de foto)
 *   - `marcoCss`: box-shadow + animation inline-ready
 *   - `marcoPreview`: gradient para overlay background
 *   - `marcoLabel`: nombre del marco para labels/toasts
 *   - `marcoTier`: "epic"|"common" para clases CSS legacy hub-grupo
 *   - `bannerBg`: gradient del banner
 *   - `bannerGlow`: hex color del glow del banner
 *   - `tituloHtml`: "emoji texto" listo para innerHTML
 *   - `tituloColor`: hex color para `--title-color` (slice menor Hero alignment)
 *   - `iniciales`: fallback plano para casos sin foto
 *   - `gradient`: legacy `avatarGradient` field (deuda H1)
 *
 *   Fuente de verdad:
 *   1. `DEMO_USERS[uid].gamer.{fotoId,marcoId,bannerId,tituloActivo}` (en memoria,
 *      sincronizado con localStorage por `_loadAvatarState`/`_loadIdentidad`).
 *   2. Defaults del catálogo si el usuario no tiene `gamer.*` sembrado.
 * Edge:
 *   - uid no encontrado en DEMO_USERS → defaults del catálogo.
 *   - `g.marcoId` con shape legacy string → migrado en runtime via
 *     `_migrarMarcoLegacy`.
 *   - `_resolveTituloMeta` no cargado (orden de scripts) → `tituloHtml=""` +
 *     `tituloColor` default purple-light.
 *
 * @returns {{
 *   fotoTexto: string,  marcoCss: string,  marcoPreview: string,
 *   marcoLabel: string, bannerBg: string,  bannerGlow: string,
 *   tituloHtml: string, tituloColor: string,
 *   iniciales: string,  gradient: string
 * }}
 */
function getAvatarDisplay(uid) {
    const u = uid && typeof DEMO_USERS !== "undefined"
        ? DEMO_USERS.find(x => x.id === uid)
        : null;
    const g = (u && u.gamer) || {};

    const foto   = AVATARES_FOTOS.find(f => f.id === g.fotoId)    || AVATARES_FOTOS[0];
    // Slice H2b · resolver con _resolveMarcoMeta (handle kind+id shape)
    const marco  = (typeof _resolveMarcoMeta === "function")
        ? _resolveMarcoMeta(_migrarMarcoLegacy(g.marcoId))
        : (AVATARES_MARCOS.find(m => m.id === g.marcoId) || AVATARES_MARCOS[0]);
    const banner = BANNERS_CATALOG.find(b => b.id === g.bannerId) || BANNERS_CATALOG[0];
    // Slice menor Hero alignment (2026-06-01): resolver tituloMeta una sola vez
    // y exponer tanto fullText como color. Antes _resolveTituloMeta se llamaba
    // inline en cada consumer (perfil-avatar.js _renderAvatarFromState +
    // hub-inicio.js no lo llamaba → título sin color en el Hero).
    const tituloMeta = (typeof _resolveTituloMeta === "function")
        ? _resolveTituloMeta(_migrarTituloLegacy(g.tituloActivo))
        : { fullText: "", color: "" };

    // Iniciales: fallback si la foto es de tipo "iniciales" o si el consumidor
    // prefiere render plano. Para el usuario activo usa APP.user.iniciales, para
    // otros deriva del nombre.
    const iniciales = (u && u.iniciales)
        || (APP?.user?.id === uid ? APP.user.iniciales : "")
        || (u && u.nombre ? u.nombre.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase() : "?");

    return {
        fotoTexto:    foto.tipo === "iniciales" ? iniciales : (foto.emoji || iniciales),
        marcoCss:     marco.css || "",
        marcoPreview: marco.preview && marco.preview !== "none" ? marco.preview : "",
        marcoLabel:   marco.label || "Sin marco",
        marcoTier:    g.marco || _deriveMarcoTier(marco.rareza),
        bannerBg:     banner.preview,
        bannerGlow:   banner.glow,
        // Slice H2b: migrar + resolver shape a string de display
        tituloHtml:   tituloMeta.fullText,
        tituloColor:  tituloMeta.color || "var(--xahni-purple-light)",
        iniciales:    iniciales,
        gradient:     g.avatarGradient || "",
    };
}

// Exponer en window para consumidores cross-módulo (sin imports en vanilla).
if (typeof window !== "undefined") {
    window.getAvatarDisplay = getAvatarDisplay;
    // Helper para que dashboard.js hidrate AVATAR_STATE+IDENTIDAD desde
    // localStorage en loadDashboard (post-login) antes del primer paint del
    // sidebar. Si no se llamara, el sidebar arrancaría con seed values y solo
    // se corregiría al entrar al perfil (donde _initGamificacion ya lo hace).
    window.loadCurrentUserAvatarAndIdentidad = function () {
        _loadAvatarState();
        _loadIdentidad();
    };
}

/**
 * @interaction render-avatar-from-state
 * @scope perfil-shared-alumno-profesor
 *
 * Given el usuario activo tiene `AVATAR_STATE` + `IDENTIDAD` ya hidratados (post
 *   `_initGamificacion`).
 * When `buildPerfilCompleto` finaliza el resto de builders + `aplicarAvatar`
 *   re-pinta tras aplicar cambios.
 * Then consume el helper canonical `getAvatarDisplay(APP.user.id)` y aplica al
 *   DOM del tab Perfil:
 *   - `#perfil-avatar` textContent = `fotoTexto` + style.cssText = `marcoCss`.
 *   - `#avatar-marco-overlay` background = `marcoPreview` + opacity `0.6`/`0`.
 *   - `.perfil-banner-bg` background = `bannerBg`.
 *   - `.perfil-banner` `--banner-glow-color` = `bannerGlow`.
 *   - `#perfil-title-tag` innerHTML = `tituloHtml` + edit-hint + `--title-color`
 *     = `tituloColor`.
 *   Slice menor Hero alignment (2026-06-01) eliminó el vestige inline
 *   `_resolveTituloMeta` → archivo 100% self-contained sin runtime dep a
 *   identidad.js.
 * Edge:
 *   - sin usuario activo o helper no cargado → return.
 *   - DOM del tab Perfil no montado (`#perfil-avatar` null) → skip silencioso
 *     por sección.
 */
function _renderAvatarFromState() {
    const uid = APP?.user?.id;
    const disp = (typeof getAvatarDisplay === "function" && uid) ? getAvatarDisplay(uid) : null;
    if (!disp) return;

    const avatarEl = document.getElementById("perfil-avatar");
    if (avatarEl) {
        avatarEl.textContent = disp.fotoTexto;
        avatarEl.style.cssText = (disp.marcoCss || "") + ";cursor:pointer";
    }
    const overlayEl = document.getElementById("avatar-marco-overlay");
    if (overlayEl) {
        overlayEl.style.background = disp.marcoPreview || "transparent";
        overlayEl.style.opacity = disp.marcoPreview ? "0.6" : "0";
    }

    // Banner del perfil
    const bannerBg = document.querySelector(".perfil-banner-bg");
    if (bannerBg) bannerBg.style.background = disp.bannerBg;
    const bannerEl = document.querySelector(".perfil-banner");
    if (bannerEl) bannerEl.style.setProperty("--banner-glow-color", disp.bannerGlow);

    // Título activo: el helper canonical ahora expone tituloHtml + tituloColor.
    const tituloEl = document.getElementById("perfil-title-tag");
    if (tituloEl && disp.tituloHtml) {
        tituloEl.innerHTML = disp.tituloHtml + ' <span class="perfil-title-edit-hint">✎</span>';
        if (disp.tituloColor) tituloEl.style.setProperty("--title-color", disp.tituloColor);
    }
}

// temp selection en modal
let avatarTempFoto = AVATAR_STATE.fotoId;
let avatarTempMarco = AVATAR_STATE.marcoId;

/**
 * @interaction build-avatar-selector
 * @scope perfil-shared-modal
 *
 * Given el usuario abrió `modal-avatar-selector` (click en `#perfil-avatar` o
 *   `#avatar-marco-overlay`).
 * When `openModal` dispatcha este orchestrator al primer paint del modal.
 * Then:
 *   1. Resetea `avatarTempFoto`/`avatarTempMarco` al state actual (`AVATAR_STATE`).
 *   2. `buildAvatarFotosGrid()` renderiza la pestaña "Fotos".
 *   3. `buildAvatarMarcosGrid()` renderiza la pestaña "Marcos" (personal + Maestría).
 *   4. `renderAvatarPreview()` renderiza el preview superior con foto+marco.
 * Edge containers ausentes → cada sub-builder es defensivo (no-op por sección).
 */
function buildAvatarSelector() {
    avatarTempFoto = AVATAR_STATE.fotoId;
    avatarTempMarco = AVATAR_STATE.marcoId;
    buildAvatarFotosGrid();
    buildAvatarMarcosGrid();
    renderAvatarPreview();
}

/**
 * @interaction build-avatar-fotos-grid
 * @scope perfil-shared-modal
 *
 * Given el modal `modal-avatar-selector` está abierto y el usuario está en la
 *   pestaña "Fotos" (o se acaba de abrir el modal).
 * When `buildAvatarSelector` o `switchAvatarTab('fotos')` lo dispatcha.
 * Then evalúa `unlock(stats)` por cada foto del catálogo (stats vivos via
 *   `_userStats`) e inyecta una `.avatar-foto-item` por entry con:
 *   - circulo con `fotoDisplay` (emoji o iniciales)
 *   - nombre + rareza
 *   - estado: desbloqueado/bloqueado/seleccionado
 *   - onclick desbloqueado → `seleccionarAvatarFoto(id)`
 *   - onclick bloqueado → toast info con requisito.
 * Edge container ausente → no-op.
 */
function buildAvatarFotosGrid() {
    const el = document.getElementById("avatar-fotos-grid");
    if (!el) return;
    const stats = _userStats(APP?.user?.id);
    const fotos = AVATARES_FOTOS.map(f => ({
        ...f,
        desbloqueado: f.unlock ? f.unlock(stats) : true,
    }));
    el.innerHTML = fotos.map(f => {
        const sel = avatarTempFoto === f.id;
        const rarCol = { legendario: "#f5a623", epico: "#a855f7", raro: "#00d4ff", comun: "#7a9bc4" }[f.rareza];
        return `
        <div class="avatar-foto-item ${f.desbloqueado ? '' : 'bloqueado'} ${sel ? 'seleccionado' : ''}"
             style="--af-color:${rarCol}"
             onclick="${f.desbloqueado ? `seleccionarAvatarFoto('${f.id}')` : `showToast('🔒 Requiere: ${f.req}','info')`}">
            <div class="avatar-foto-circulo">${_fotoDisplay(f)}</div>
            <div class="avatar-foto-nombre">${f.nombre}</div>
            <div class="avatar-foto-rareza" style="color:${rarCol}">${f.rareza}</div>
            ${!f.desbloqueado ? '<div class="avatar-lock">🔒</div>' : ''}
            ${sel ? '<div class="avatar-check">✓</div>' : ''}
        </div>`;
    }).join("");
}

/**
 * @interaction build-avatar-marcos-grid
 * @scope perfil-shared-modal
 *
 * Given el modal `modal-avatar-selector` está abierto y el usuario está en la
 *   pestaña "Marcos".
 * When `buildAvatarSelector` o `switchAvatarTab('marcos')` lo dispatcha.
 * Then renderiza DOS pools mezclados:
 *   - **Personal**: AVATARES_MARCOS catálogo + `unlock(stats)` por item.
 *   - **Maestría**: `_getMaestriaCosmeticsForUser(uid, "marco")` con chip
 *     mini-emblema disciplina (BD cyan / POO purple / ED teal) + tier oro/temárico.
 *   Cada item lleva preview ring con foto adentro, label, rareza, estado.
 *   onclick desbloqueado → `seleccionarAvatarMarco(kind, id)`.
 *   onclick bloqueado personal → toast info con requisito.
 * Edge:
 *   - container ausente → no-op.
 *   - `_getMaestriaCosmeticsForUser` no cargado → solo pool personal.
 */
function buildAvatarMarcosGrid() {
    const el = document.getElementById("avatar-marcos-grid");
    if (!el) return;
    const stats = _userStats(APP?.user?.id);
    const marcosPersonal = AVATARES_MARCOS.map(m => ({
        ...m,
        desbloqueado: m.unlock ? m.unlock(stats) : true,
    }));
    const marcosMaestria = (typeof _getMaestriaCosmeticsForUser === "function")
        ? _getMaestriaCosmeticsForUser(APP?.user?.id, "marco")
        : [];
    const fotoActual = AVATARES_FOTOS.find(f => f.id === avatarTempFoto) || AVATARES_FOTOS[0];
    const fotoDisp   = _fotoDisplay(fotoActual);
    const activoKind = (avatarTempMarco && typeof avatarTempMarco === "object") ? avatarTempMarco.kind : null;
    const activoId = (avatarTempMarco && typeof avatarTempMarco === "object") ? avatarTempMarco.id : null;

    const personalHtml = marcosPersonal.map(m => {
        const sel = (activoKind === "personal" && activoId === m.id);
        const rarCol = { legendario: "#f5a623", epico: "#a855f7", raro: "#00d4ff", comun: "#7a9bc4" }[m.rareza];
        return `
        <div class="avatar-marco-item ${m.desbloqueado ? '' : 'bloqueado'} ${sel ? 'seleccionado' : ''}"
             data-source="personal"
             style="--am-color:${rarCol}"
             onclick="${m.desbloqueado ? `seleccionarAvatarMarco('personal','${m.id}')` : `showToast('🔒 Requiere: ${m.req}','info')`}">
            <div class="avatar-marco-preview-ring" style="${m.preview !== 'none' ? `background:${m.preview}` : 'border:2px dashed var(--border)'}">
                <div class="avatar-marco-preview-inner">${fotoDisp}</div>
            </div>
            <div class="avatar-marco-nombre">${m.label}</div>
            <div class="avatar-marco-rareza" style="color:${rarCol}">${m.rareza}</div>
            ${!m.desbloqueado ? '<div class="avatar-lock">🔒</div>' : ''}
            ${sel ? '<div class="avatar-check">✓</div>' : ''}
        </div>`;
    }).join("");

    // Slice H2b · pool Maestría con chip mini-emblema disciplina
    const maestriaHtml = marcosMaestria.map(m => {
        const sel = (activoKind === "maestria" && activoId === m.id);
        const resolved = _resolveMarcoMeta({ kind: "maestria", id: m.id });
        const rarCol = resolved.rareza === "legendario" ? "#f5a623" : "#a855f7";
        return `
        <div class="avatar-marco-item ${sel ? 'seleccionado' : ''}"
             data-source="maestria"
             data-disciplina="${m.disciplinaId}"
             style="--am-color:${rarCol}"
             onclick="seleccionarAvatarMarco('maestria','${m.id}')">
            <div class="avatar-marco-preview-ring" style="background:${resolved.preview}">
                <div class="avatar-marco-preview-inner">${fotoDisp}</div>
            </div>
            <div class="avatar-marco-nombre">${m.label}</div>
            <div class="avatar-marco-rareza" style="color:${rarCol}">Maestría · ${resolved.rareza}</div>
            <span class="maestria-cosmetic-chip" data-disciplina="${m.disciplinaId}" aria-label="Cosmético de Maestría">
                ${m.glyph}
            </span>
            ${sel ? '<div class="avatar-check">✓</div>' : ''}
        </div>`;
    }).join("");

    el.innerHTML = personalHtml + maestriaHtml;
}

/**
 * @interaction seleccionar-avatar-foto
 * @scope perfil-shared-modal
 *
 * Given el modal está abierto en pestaña "Fotos" con grid renderizado.
 * When el usuario hace click en un `.avatar-foto-item` desbloqueado.
 * Then setea `avatarTempFoto = id` (selección temp, persistencia diferida a
 *   `aplicarAvatar`), re-renderiza la grid (para marcar `.seleccionado`) +
 *   actualiza el preview superior.
 * Edge `id` no existe en catálogo → next render fallback a foto-default.
 */
function seleccionarAvatarFoto(id) {
    avatarTempFoto = id;
    buildAvatarFotosGrid();
    renderAvatarPreview();
}

/**
 * @interaction seleccionar-avatar-marco
 * @scope perfil-shared-modal
 *
 * Given el modal está abierto en pestaña "Marcos" con pools personal+Maestría
 *   renderizados.
 * When el usuario hace click en un `.avatar-marco-item` desbloqueado.
 * Then setea `avatarTempMarco = {kind, id}` (Slice H2b shape), re-renderiza la
 *   grid + actualiza el preview superior. La persistencia se difiere a
 *   `aplicarAvatar`.
 *   Expuesto en window para que el onclick inline lo invoque.
 * Edge `kind`/`id` inválido → next render fallback a marco-ninguno via
 *   `_resolveMarcoMeta`.
 */
function seleccionarAvatarMarco(kind, id) {
    // Slice H2b · accepts (kind, id) per shape {kind, id}
    avatarTempMarco = { kind, id };
    buildAvatarMarcosGrid();
    renderAvatarPreview();
}
window.seleccionarAvatarMarco = seleccionarAvatarMarco;

/**
 * @interaction switch-avatar-tab
 * @scope perfil-shared-modal
 *
 * Given el modal `modal-avatar-selector` está abierto.
 * When el usuario hace click en una `.avatar-tab-btn` (Fotos o Marcos).
 * Then alterna display block/none de `#avatar-tab-fotos`/`#avatar-tab-marcos`
 *   + clase `.active` en el botón clickeado (los demás la pierden).
 * Edge tab id desconocido → ambos panels quedan oculto (degradación silenciosa).
 */
function switchAvatarTab(tab, btn) {
    document.getElementById("avatar-tab-fotos").style.display = tab === "fotos" ? "block" : "none";
    document.getElementById("avatar-tab-marcos").style.display = tab === "marcos" ? "block" : "none";
    document.querySelectorAll(".avatar-tab-btn").forEach(b => b.classList.toggle("active", b === btn));
}

/**
 * @interaction render-avatar-preview
 * @scope perfil-shared-modal
 *
 * Given el modal está abierto con `avatarTempFoto`/`avatarTempMarco` reflejando
 *   la selección actual del usuario.
 * When `buildAvatarSelector`/`seleccionarAvatarFoto`/`seleccionarAvatarMarco`
 *   lo dispatchan tras cada cambio.
 * Then resuelve foto + marco en runtime y aplica al preview superior:
 *   - `#avatar-preview-img` textContent = `fotoDisplay` + style.cssText = `marco.css`.
 *   - `#avatar-preview-marco` background = `marco.preview`.
 *   - `#avatar-preview-nombre` textContent = `foto.nombre`.
 *   - `#avatar-preview-marco-nombre` textContent = `marco.label` o "Sin marco".
 * Edge cualquier `#avatar-preview-*` ausente → skip por sección.
 */
function renderAvatarPreview() {
    const foto = AVATARES_FOTOS.find(f => f.id === avatarTempFoto) || AVATARES_FOTOS[0];
    // Slice H2b · resolver con _resolveMarcoMeta (handle kind+id shape)
    const marco = (typeof _resolveMarcoMeta === "function")
        ? _resolveMarcoMeta(avatarTempMarco)
        : (AVATARES_MARCOS.find(m => m.id === avatarTempMarco) || AVATARES_MARCOS[0]);

    const imgEl = document.getElementById("avatar-preview-img");
    const marcoEl = document.getElementById("avatar-preview-marco");
    const nomEl = document.getElementById("avatar-preview-nombre");
    const mNomEl = document.getElementById("avatar-preview-marco-nombre");

    if (imgEl) { imgEl.textContent = _fotoDisplay(foto); imgEl.style.cssText = marco.css || ""; }
    if (marcoEl) marcoEl.style.background = marco.preview !== "none" ? marco.preview : "transparent";
    if (nomEl) nomEl.textContent = foto.nombre;
    if (mNomEl) mNomEl.textContent = marco.id === "marco-ninguno" ? "Sin marco" : marco.label;
}

/**
 * @interaction aplicar-avatar
 * @scope perfil (shared alumno/profesor)
 *
 * Given el usuario eligió foto + marco desbloqueados en el modal selector
 *   (`avatarTempFoto` y `avatarTempMarco` con los ids del catálogo).
 * When hace click en "Aplicar".
 * Then `AVATAR_STATE.{fotoId, marcoId}` se actualizan, `#perfil-avatar` muestra
 *   el `fotoDisplay` con el `marco.css`, `#avatar-marco-overlay` recibe el
 *   gradient del marco, `_saveAvatarState` persiste en localStorage y muta
 *   `DEMO_USERS[uid].gamer.{fotoId,marcoId}` (slice #6 Opción A), se dispara
 *   `avatarChanged` para que sidebar y otros consumidores cross-vista
 *   repinten en vivo, el modal cierra y muestra toast verde con foto+marco.
 * Edge si el catálogo no contiene los ids (datos corruptos), cae a defaults
 *   (`foto-default`/`marco-ninguno`) sin error.
 */
function aplicarAvatar() {
    AVATAR_STATE.fotoId = avatarTempFoto;
    AVATAR_STATE.marcoId = avatarTempMarco;
    _saveAvatarState();

    // Repintar via helper canónico (consume getAvatarDisplay tras _saveAvatarState
    // que sincronizó DEMO_USERS[uid].gamer). Una sola fuente de pintado.
    _renderAvatarFromState();

    // Slice #6 P5: notifica a consumidores cross-vista (sidebar, hub-grupo,
    // etc.) que el avatar del usuario actual cambió. Sin esto, el sidebar
    // sigue mostrando la elección anterior hasta el próximo loadDashboard.
    if (typeof window !== "undefined" && typeof CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent("avatarChanged", { detail: { uid: APP?.user?.id } }));
    }
    closeModal("modal-avatar-selector");

    // Resolver foto + marco solo para el toast (no para repintar, ya hecho arriba)
    const foto  = AVATARES_FOTOS.find(f => f.id === avatarTempFoto) || AVATARES_FOTOS[0];
    const marco = (typeof _resolveMarcoMeta === "function")
        ? _resolveMarcoMeta(avatarTempMarco)
        : (AVATARES_MARCOS.find(m => m.id === avatarTempMarco) || AVATARES_MARCOS[0]);
    showToast(`✅ Avatar: ${foto.nombre} · Marco: ${marco.label}`, "success");
}
