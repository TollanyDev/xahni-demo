// ═══════════════════════════════════════════════════════════
// SOCIAL · Muro de Reconocimientos (Kudos)
// Slice #12 split (2026-06-01): extraído de perfil.js
// Slice #13 JSDoc rolling (2026-06-01): cobertura 100%
// ═══════════════════════════════════════════════════════════

// ── Persistencia de kudos recibidos ─────────────────────────

/**
 * @interaction kudos-key
 * @scope shared-persistencia
 *
 * Given un usuario logueado (`APP.user.id` definido).
 * When cualquier call de persistencia de kudos (load/save) necesita la clave.
 * Then devuelve el namespace localStorage `xahni_kudos_<uid>`.
 * Edge si no hay usuario activo → retorna `null` y los callers no persisten.
 */
function _kudosKey()     { const uid = APP?.user?.id; return uid ? `xahni_kudos_${uid}`     : null; }

/**
 * @interaction kudos-load
 * @scope shared-persistencia
 *
 * Given el usuario acaba de hacer login y `_initGamificacion` invoca este helper.
 * When se necesita hidratar `KUDOS_DATA` desde localStorage del usuario actual.
 * Then lee `xahni_kudos_<uid>`, parsea el JSON, retorna el array de kudos
 *   persistidos o `null` si no hay nada guardado.
 * Edge:
 *   - sin usuario activo (`_kudosKey()` retorna null) → retorna `null`.
 *   - JSON corrupto → catch silencioso retorna `null`.
 *   - localStorage vacío → retorna `null`.
 */
function _loadKudos() {
    const k = _kudosKey();
    if (!k) return null;
    try {
        const raw = localStorage.getItem(k);
        return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
}

/**
 * @interaction kudos-save
 * @scope shared-persistencia
 *
 * Given el usuario acaba de enviar un nuevo kudo (`enviarKudo` o equivalente
 *   mutó `KUDOS_DATA`).
 * When se persiste el array completo a localStorage del usuario actual.
 * Then escribe `xahni_kudos_<uid>` con `JSON.stringify(KUDOS_DATA)`.
 * Edge sin usuario activo → no-op silencioso.
 */
function _saveKudos() {
    const k = _kudosKey();
    if (k) localStorage.setItem(k, JSON.stringify(KUDOS_DATA));
    // Sweep 2026-06-08: dispatch para que firestore-sync persista cross-device.
    const uid = APP?.user?.id;
    if (uid) {
        try {
            document.dispatchEvent(new CustomEvent("xahni:kudoEnviado", {
                detail: { uid, kudos: KUDOS_DATA }
            }));
        } catch (_) { /* defensive */ }
    }
}

// ── MURO DE RECONOCIMIENTOS ──────────────────────────────────
const KUDOS_CATEGORIAS = [
    { id: "ayuda", emoji: "🤝", label: "Ayuda" },
    { id: "explicacion", emoji: "💡", label: "Explicación" },
    { id: "liderazgo", emoji: "👑", label: "Liderazgo" },
    { id: "creatividad", emoji: "🎨", label: "Creatividad" },
    { id: "esfuerzo", emoji: "💪", label: "Esfuerzo" },
    { id: "trabajo-eq", emoji: "🤜", label: "Trabajo en equipo" },
];

let kudosCatSeleccionada = "ayuda";

// Fix 2026-06-05: empty default. Los kudos legacy hardcodeados aparecían
// cross-rol como si todos los usuarios tuvieran 5 reconocimientos pre-cargados.
// Ahora arranca vacío. `_initGamificacion` hidrata desde localStorage si hay
// kudos guardados; sino, el muro renderiza empty state.
const KUDOS_DATA = [];

/**
 * @interaction build-muro-reconocimientos
 * @scope perfil-shared-alumno-profesor
 *
 * Given el usuario entra al tab Perfil (alumno o profesor) y `buildPerfilCompleto`
 *   dispatcha builders del panel social.
 * When se renderiza el container `#muro-reconocimientos-list`.
 * Then inyecta una card por cada entry de `KUDOS_DATA` con:
 *   - stripe lateral coloreado por `k.color`
 *   - emoji + nombre del autor + tipo (profesor/alumno) + tiempo
 *   - mensaje en cita.
 * Edge:
 *   - container ausente → no-op silencioso.
 *   - KUDOS_DATA vacío → renderiza string vacío (no muestra empty state, se
 *     asume seed inicial siempre presente para demo).
 */
function buildMuroReconocimientos() {
    const el = document.getElementById("muro-reconocimientos-list");
    if (!el) return;

    if (!KUDOS_DATA.length) {
        el.innerHTML = `<div class="x-empty x-empty--inline" style="padding:24px 16px">
            <div class="x-empty__icon">💬</div>
            <div class="x-empty__title">Aún no has recibido reconocimientos</div>
            <div class="x-empty__sub">Los kudos de tus compañeros y profesores aparecerán aquí.</div>
        </div>`;
        return;
    }

    el.innerHTML = KUDOS_DATA.map(k => `
        <div class="kudo-card">
            <div class="kudo-card-left" style="background:${k.color}18;border-left:3px solid ${k.color}">
                <div class="kudo-emoji">${k.emoji}</div>
            </div>
            <div class="kudo-body">
                <div class="kudo-header-row">
                    <div class="kudo-de">
                        <span class="kudo-de-nombre">${k.de}</span>
                        <span class="kudo-de-tipo ${k.tipo}">${k.tipo === 'profesor' ? '👨‍🏫 Profesor' : '🎓 Alumno'}</span>
                    </div>
                    <span class="kudo-tiempo">${k.tiempo}</span>
                </div>
                <div class="kudo-msg">"${k.msg}"</div>
            </div>
        </div>`).join("");
}

/**
 * @interaction build-kudo-categorias
 * @scope perfil-shared-modal
 *
 * Given el usuario abrió el modal `modal-dar-kudo` para enviar un reconocimiento.
 * When `openModal` dispatcha este builder al primer paint del modal.
 * Then resetea `kudosCatSeleccionada = "ayuda"` (default) e inyecta una
 *   `button.kudo-cat-btn` por categoría del catálogo, con la primera marcada
 *   como `.seleccionada` y onclick→`selectKudoCat(id, this)`.
 * Edge container ausente → no-op silencioso.
 */
function buildKudoCategorias() {
    kudosCatSeleccionada = "ayuda";
    const el = document.getElementById("kudo-categoria-grid");
    if (!el) return;
    el.innerHTML = KUDOS_CATEGORIAS.map(c => `
        <button class="kudo-cat-btn ${c.id === kudosCatSeleccionada ? 'seleccionada' : ''}"
                onclick="selectKudoCat('${c.id}',this)">
            ${c.emoji} ${c.label}
        </button>`).join("");
}

/**
 * @interaction select-kudo-cat
 * @scope perfil-shared-modal
 *
 * Given el modal `modal-dar-kudo` está abierto con el grid de categorías
 *   renderizado y una categoría preseleccionada (`kudosCatSeleccionada`).
 * When el usuario hace click en un `.kudo-cat-btn`.
 * Then actualiza `kudosCatSeleccionada = id` (variable module-scope que
 *   `enviarKudo` consume al persistir), limpia la clase `.seleccionada` de
 *   todos los botones y la aplica al botón clickeado.
 * Edge `btn` ausente o desincronizado → la lógica de selección visual asume
 *   que `btn` es el elemento clickeado real (el onclick inline pasa `this`).
 */
function selectKudoCat(id, btn) {
    kudosCatSeleccionada = id;
    document.querySelectorAll(".kudo-cat-btn").forEach(b => b.classList.remove("seleccionada"));
    btn.classList.add("seleccionada");
}

/**
 * @interaction enviar-kudo
 * @scope perfil-shared-modal-alumno
 *
 * Given el usuario abrió `modal-dar-kudo`, escribió el destinatario
 *   (`#kudo-destinatario`), un mensaje (`#kudo-mensaje`) y seleccionó una
 *   categoría (`kudosCatSeleccionada`).
 * When hace click en "Enviar".
 * Then:
 *   1. Construye `nuevoKudo` con `de = APP.user.nombre`, `tipo = "alumno"`,
 *      `cat/emoji` de la categoría seleccionada, `msg`, `tiempo = "Ahora mismo"`,
 *      `color = #00d4ff`, `enviado: true` (flag visual).
 *   2. `KUDOS_DATA.unshift(nuevoKudo)` agrega al inicio del muro.
 *   3. `_saveKudos()` persiste a localStorage del usuario actual.
 *   4. `closeModal("modal-dar-kudo")` cierra el modal.
 *   5. `buildMuroReconocimientos()` re-renderiza el muro con el nuevo kudo arriba.
 *   6. `agregarNotificacion("kudo", ...)` registra en el panel de notificaciones.
 *   7. `addXP(15)` suma 15 XP al usuario.
 *   8. Toast verde de confirmación.
 * Edge:
 *   - destinatario vacío → toast info "Escribe el nombre del compañero" y return.
 *   - mensaje vacío → toast info "Escribe un mensaje de reconocimiento" y return.
 *   - categoría no encontrada (catálogo corrupto) → fallback "ayuda"/"💬".
 */
function enviarKudo() {
    const dest = document.getElementById("kudo-destinatario")?.value.trim() || "compañero";
    const msg  = document.getElementById("kudo-mensaje")?.value.trim() || "";
    const cat  = KUDOS_CATEGORIAS.find(c => c.id === kudosCatSeleccionada);

    if (!dest) { showToast("Escribe el nombre del compañero", "info"); return; }
    if (!msg)  { showToast("Escribe un mensaje de reconocimiento", "info"); return; }

    const nuevoKudo = {
        de:     APP.user?.nombre || "Tú",
        tipo:   "alumno",
        cat:    cat?.id || "ayuda",
        emoji:  cat?.emoji || "💬",
        msg:    msg,
        tiempo: "Ahora mismo",
        color:  "#00d4ff",
        enviado: true,   // Para distinguirlo visualmente
    };

    // Agregar al inicio del muro
    KUDOS_DATA.unshift(nuevoKudo);
    _saveKudos();

    closeModal("modal-dar-kudo");
    buildMuroReconocimientos();
    agregarNotificacion("kudo", "Reconocimiento enviado", `A ${dest} — ${cat?.label || "Ayuda"}`);
    addXP(15);
    showToast(`${cat?.emoji || "💬"} Reconocimiento enviado a ${dest} · +15 XP`, "success");
}
