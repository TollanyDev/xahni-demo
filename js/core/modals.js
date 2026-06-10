// ═══════════════════════════════════════════════════════════
// MODALS — Apertura, cierre y guardado de perfil
// ═══════════════════════════════════════════════════════════
//
// C3 Slice B (2026-05-18):
//   - Stack LIFO para modales anidados.
//   - Foco inicial al primer focusable útil del surface tras abrir.
//   - Restauración del foco al elemento que disparó la apertura.
//   - Tab/Shift+Tab atrapados dentro del top del stack.
//   - Escape cierra el top del stack (no interfiere si no hay modal abierto).
//   - `confirmarCanonico` resuelve Promise(false) ante CUALQUIER cierre.

const _FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const _modalStack = [];        // IDs en orden de apertura
const _focusReturnStack = [];   // activeElement al momento de cada openModal
let _pendingConfirmer = null;   // resolve fn de confirmarCanonico en curso
let _modalsListenersInstalled = false;

/**
 * @interaction surface-of
 * @scope core-modals-helper-surface
 *
 * Given un id de modal overlay (el wrapper outer del modal canónico).
 * When un caller del sistema modals (open/close/focus/trap) necesita la
 *   surface inner (`.x-modal` o `.modal` legacy) sobre la que aplicar
 *   focus management o trap de Tab.
 * Then retorna el primer elemento `.x-modal` o `.modal` dentro del overlay
 *   (overlay → surface inner). null si no encuentra overlay o no contiene
 *   surface inner.
 * Edge:
 *   - id null/undefined o overlay no en DOM → null.
 *   - Overlay sin children matcheables → null.
 *   - Aliases legacy `.modal` siguen soportados por compat retro.
 */
function _surfaceOf(id) {
    const overlay = document.getElementById(id);
    return overlay ? overlay.querySelector('.x-modal, .modal') : null;
}

/**
 * @interaction focusables-in
 * @scope core-modals-helper-focusables
 *
 * Given una surface DOM element (puede ser null).
 * When un caller necesita la lista de elementos focusables válidos dentro
 *   de la surface (para trap de Tab o focus inicial).
 * Then aplica `_FOCUSABLE_SELECTOR` (links/buttons/inputs/textareas/selects/
 *   [tabindex]) y filtra los visibles (offsetParent !== null) más el
 *   activeElement actual (cubre caso edge focus en elemento offscreen).
 * Edge:
 *   - surface null → [] (defensa).
 *   - Sin focusables → [] (trap de Tab debe handle).
 *   - Elementos disabled/[tabindex="-1"] excluidos por selector.
 */
function _focusablesIn(surface) {
    if (!surface) return [];
    return Array.from(surface.querySelectorAll(_FOCUSABLE_SELECTOR))
        .filter(el => el.offsetParent !== null || el === document.activeElement);
}

/**
 * @interaction focus-first-in
 * @scope core-modals-helper-focus-initial
 *
 * Given una surface DOM element del modal recién abierto.
 * When openModal termina su flow y solicita focus management al rAF.
 * Then aplica heurística para elegir target del foco inicial:
 *   1. Primer input/select/textarea (no readonly).
 *   2. Sino, primer button cuyo texto NO sea "Cancelar"/"Cerrar"/"Close"
 *      (evita destructive focus default).
 *   3. Sino, primer focusable encontrado.
 *   4. Fallback: la propia surface (con tabindex=-1 si falta).
 *   Llama target.focus().
 * Edge:
 *   - surface null → no-op (return early).
 *   - Sin focusables disponibles → fallback a surface tabindex=-1.
 *   - Heurística "no botón Cancelar" usa regex case-insensitive sobre
 *     textContent.trim() — funciona para variaciones "Cancelar", " cancelar ",
 *     etc.
 */
function _focusFirstIn(surface) {
    if (!surface) return;
    const focusables = _focusablesIn(surface);
    // Heurística: input/select/textarea primero; si no, primer botón que no sea Cancelar/Cerrar.
    const isCancelBtn = el => /^(cancelar|cerrar|close)$/i.test((el.textContent || "").trim());
    let target = focusables.find(el =>
        /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !el.readOnly
    );
    if (!target) target = focusables.find(el => el.tagName === "BUTTON" && !isCancelBtn(el));
    if (!target) target = focusables[0];
    if (!target) {
        // Fallback: surface enfocable
        if (!surface.hasAttribute("tabindex")) surface.setAttribute("tabindex", "-1");
        target = surface;
    }
    target.focus();
}

/**
 * @interaction trap-tab
 * @scope core-modals-helper-trap-tab
 *
 * Given un keydown event Tab dentro de un modal top del stack y la surface
 *   activa.
 * When `_installModalsListeners` detecta `e.key === "Tab"` y delega aquí.
 * Then implementa focus trap circular:
 *   - Shift+Tab desde primer focusable → focus al último (wrap).
 *   - Tab desde último focusable → focus al primero (wrap).
 *   - Si activeElement no está en surface, considerarlo como first/last
 *     según dirección (cubre caso edge focus perdido o sobre elemento
 *     offscreen del DOM).
 *   `e.preventDefault()` evita el flow default del browser solo en los
 *   wraps (en el medio, deja al browser hacer su trabajo).
 * Edge:
 *   - Sin focusables → preventDefault y retorna (no hay a dónde ir).
 *   - first === last (1 focusable) → siempre wrap a sí mismo.
 *   - C3 Slice B (2026-05-18) cementó el patrón de trap circular + ESC.
 */
function _trapTab(e, surface) {
    const focusables = _focusablesIn(surface);
    if (focusables.length === 0) { e.preventDefault(); return; }
    const first = focusables[0];
    const last  = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !surface.contains(active))) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && (active === last || !surface.contains(active))) {
        e.preventDefault();
        first.focus();
    }
}

/**
 * @interaction install-modals-listeners
 * @scope core-modals-installer
 *
 * Given el sistema modals carga por primera vez (cualquier openModal hace
 *   call). Flag module-scope `_modalsListenersInstalled` evita doble.
 * When openModal lo invoca al inicio de su flow.
 * Then instala un único `keydown` listener global en document que:
 *   - Si stack está vacío → return (no-op).
 *   - Toma topId del stack (LIFO: último modal abierto).
 *   - Si key === "Escape" → preventDefault + closeModal(topId).
 *   - Si key === "Tab" → delega a `_trapTab` con surface del topId.
 *   Idempotente: re-llamadas no acumulan listeners.
 * Edge:
 *   - Listener vive en document para toda la vida de la app (no se desinstala).
 *   - Stack vacío → return early (no interfiere con keypress de la app).
 *   - Stack LIFO permite anidación (modal-of-modal): siempre ESC/Tab afecta
 *     al top.
 */
function _installModalsListeners() {
    if (_modalsListenersInstalled) return;
    _modalsListenersInstalled = true;
    document.addEventListener("keydown", (e) => {
        if (_modalStack.length === 0) return;
        const topId = _modalStack[_modalStack.length - 1];
        if (e.key === "Escape") {
            e.preventDefault();
            closeModal(topId);
        } else if (e.key === "Tab") {
            const surface = _surfaceOf(topId);
            if (surface) _trapTab(e, surface);
        }
    });
}

/**
 * @interaction open-modal
 * @scope core-modals-orchestrator-open
 *
 * Given un id de modal overlay (existe en DOM, oculto por default).
 * When un caller (handler de botón, navigation, action programático)
 *   solicita abrir el modal.
 * Then ejecuta 5 pasos secuenciales:
 *   1. Instala listeners modal-globales (idempotente, una sola vez).
 *   2. Cancela cualquier cierre en curso (.closing removida); el guard
 *      en `closeModal.finalize` abortará al ver la clase removida.
 *   3. Push del activeElement actual al `_focusReturnStack` y de id al
 *      `_modalStack` (LIFO para anidación).
 *   4. Agrega class `.active` al overlay (CSS transitions de entrada).
 *   5. Si el id matchea un modal de catálogo conocido (personalizar-card,
 *      titulo-selector, banner-selector, avatar-selector, top3-maestria,
 *      dar-kudo) invoca su builder específico. modal-perfil-publico NO
 *      auto-llama buildPerfilPublico (decisión Slice fix orchestration):
 *      el caller usa openModalPerfilPublico que setea contenido ANTES.
 *   6. rAF focus al primer focusable útil de la surface vía
 *      `_focusFirstIn` (espera builder reemplace markup).
 * Edge:
 *   - id no en DOM → return early.
 *   - Re-apertura sobre modal en .closing → cancela close, reabre.
 *   - Builder específico null (ej. modal-confirmar) → solo skip ese paso.
 */
function openModal(id) {
    _installModalsListeners();
    const overlay = document.getElementById(id);
    if (!overlay) return;

    // Cancela cualquier cierre en curso para este overlay; el guard en
    // finalize() de closeModal abortará al ver .closing removido.
    overlay.classList.remove("closing");

    _focusReturnStack.push(document.activeElement);
    overlay.classList.add("active");
    _modalStack.push(id);

    if (id === "modal-personalizar-card"  && typeof buildPersonalizarCard === "function") buildPersonalizarCard();
    if (id === "modal-titulo-selector"    && typeof buildTituloSelector   === "function") buildTituloSelector();
    if (id === "modal-banner-selector"    && typeof buildBannerSelector   === "function") buildBannerSelector();
    // modal-perfil-publico NO auto-llama buildPerfilPublico aquí.
    // Slice "fix orchestration": el contenido se setea explícitamente por
    // openModalPerfilPublico(uid, mode, contexto) ANTES de openModal,
    // permitiendo args programáticos sin sobrescritura.
    if (id === "modal-avatar-selector"    && typeof buildAvatarSelector   === "function") buildAvatarSelector();
    if (id === "modal-top3-maestria-selector" && typeof buildTop3MaestriaSelector === "function") buildTop3MaestriaSelector();
    if (id === "modal-dar-kudo"           && typeof buildKudoCategorias   === "function") buildKudoCategorias();

    // El builder puede haber reemplazado markup; rAF asegura que el foco caiga
    // sobre el DOM final.
    requestAnimationFrame(() => _focusFirstIn(_surfaceOf(id)));
}

/**
 * @interaction close-modal
 * @scope core-modals-orchestrator-close
 *
 * Given un id de modal overlay con class `.active` (abierto).
 * When caller (botón Cancelar/Aceptar/Cerrar, Escape, overlay click, código
 *   programático) solicita cerrar.
 * Then ejecuta 4 fases:
 *   1. Bookkeeping inmediato (no esperar animación):
 *      - Pop del stack del id (lastIndexOf para handle close de modal no-top).
 *      - Pop del `_focusReturnStack` correspondiente.
 *      - Si id === "modal-confirmar" Y hay `_pendingConfirmer`, resolve(false).
 *   2. Restaurar foco al disparador (si sigue en DOM y es focusable) o
 *      al body como fallback.
 *   3. Animación salida: añade `.closing` (CSS transitions de opacity/
 *      transform). Escucha `transitionend` del overlay (propertyName ===
 *      "opacity") para finalize.
 *   4. `finalize` con guard idempotent: si openModal re-abrió mientras
 *      transitionend, abortar. Sino, remove `.active` + `.closing`.
 *   Timeout 250ms fallback cubre casos reduced-motion + page hidden donde
 *   transitionend no dispara.
 * Edge:
 *   - id no en DOM → return early.
 *   - id sin class .active (ya cerrado o nunca abierto) → return early
 *     (idempotente).
 *   - Stack desincronizado (idx === -1) → bookkeeping defensivo skip.
 *   - returnEl ya no en DOM → fallback a document.body.focus().
 *   - C3.C.2 cementó pattern transitionend + timeout fallback.
 *   - C3.B.2 cementó pattern Promise(false) en cierre genérico de
 *     modal-confirmar.
 */
function closeModal(id) {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    if (!overlay.classList.contains("active")) return; // idempotente

    // Bookkeeping inmediato: stack pop, Promise resolve, focus restore.
    // La animación es solo visual y NO bloquea estos efectos.
    const idx = _modalStack.lastIndexOf(id);
    let returnEl = null;
    if (idx !== -1) {
        _modalStack.splice(idx, 1);
        returnEl = _focusReturnStack.splice(idx, 1)[0];
    }

    // Si era el genérico modal-confirmar y hay Promise pendiente, resolver(false).
    if (id === "modal-confirmar" && _pendingConfirmer) {
        const resolve = _pendingConfirmer;
        _pendingConfirmer = null;
        resolve(false);
    }

    // Restaurar foco al disparador (o al body si ya no existe en DOM).
    if (returnEl && document.body.contains(returnEl) && typeof returnEl.focus === "function") {
        returnEl.focus();
    } else if (document.body) {
        document.body.focus();
    }

    // Animación de salida (C3.C.2): .closing dispara transitions de
    // opacity/transform en backdrop + surface. Escuchamos transitionend
    // del overlay (opacity) con fallback 250ms para cubrir reduced-motion
    // y casos donde transitionend no dispare (foco perdido, page hidden).
    overlay.classList.add("closing");
    const finalize = () => {
        // Si openModal re-abrió el overlay (removió .closing), abortar.
        if (!overlay.classList.contains("closing")) return;
        overlay.classList.remove("active");
        overlay.classList.remove("closing");
    };
    const onEnd = (e) => {
        if (e.target !== overlay || e.propertyName !== "opacity") return;
        overlay.removeEventListener("transitionend", onEnd);
        finalize();
    };
    overlay.addEventListener("transitionend", onEnd);
    setTimeout(() => {
        overlay.removeEventListener("transitionend", onEnd);
        finalize();
    }, 250);
}

// ── Vista pública del perfil de un usuario (orchestrator) ──────
// Slice "fix orchestration": delega el render al buildPerfilPublico
// generalizado (Slice A B.1) en lugar de mantener un render simplificado
// duplicado. Backwards compat: la firma openModalPerfilPublico(uid) sigue
// funcionando para los consumers actuales (hub-grupo alumno + profesor).
// Sin args: renderea el perfil del usuario logueado (uid = APP.user.id implícito).
/**
 * @interaction open-modal-perfil-publico
 * @scope core-modals-orchestrator-perfil-publico
 *
 * Given uid (opcional, default APP.user.id), mode ("modal"|"inline",
 *   default "modal"), contexto ("preview"|"page"|"hub-grupo"|..., default
 *   "preview").
 * When un caller (hub-grupo alumno/profesor, hub-aprendizaje, etc.) quiere
 *   abrir el modal con el perfil público de algún usuario.
 * Then ejecuta orquestación en 3 pasos:
 *   1. Valida uid contra DEMO_USERS si se pasó explícito; warning + return
 *      si no se encuentra.
 *   2. Llama `buildPerfilPublico(uid, mode, contexto)` para setear el
 *      contenido del modal con los args dados (defaults heredados).
 *   3. Llama `openModal("modal-perfil-publico")` para mostrar.
 *   Orden render-PRIMERO + abrir-DESPUÉS es decisión de Slice fix
 *   orchestration: openModal ya NO auto-llama buildPerfilPublico (eliminado
 *   en su commit), permite args programáticos sin sobrescritura.
 * Edge:
 *   - uid pasado pero no en DEMO_USERS → warn console + return sin abrir.
 *   - uid omitido → buildPerfilPublico usa fallback APP.user (su default).
 *   - buildPerfilPublico no cargado (orden scripts) → modal abre con
 *     contenido previo (deuda de orden de carga).
 *   - Backwards compat: openModalPerfilPublico(uid) sigue funcionando
 *     (mode + contexto se defaultean).
 */
function openModalPerfilPublico(uid, mode, contexto) {
    // Valida uid contra DEMO_USERS si se pasa explícito. Si no, deja que
    // buildPerfilPublico use su fallback (APP.user).
    if (uid && typeof DEMO_USERS !== "undefined") {
        const m = DEMO_USERS.find(u => u.id === uid);
        if (!m) {
            console.warn("[openModalPerfilPublico] usuario no encontrado:", uid);
            return;
        }
    }
    // Render PRIMERO: setea el contenido del modal con los args dados.
    // Defaults heredados de buildPerfilPublico: mode='modal', contexto='preview'.
    if (typeof buildPerfilPublico === "function") {
        buildPerfilPublico(uid, mode, contexto);
    }
    // Mostrar el modal DESPUÉS. openModal ya no re-invoca buildPerfilPublico
    // (eliminado en commit del Slice fix orchestration), así que no sobrescribe.
    openModal("modal-perfil-publico");
}
window.openModalPerfilPublico = openModalPerfilPublico;

/**
 * @interaction guardar-perfil
 * @scope shared (modal editar perfil)
 *
 * Given el usuario está logueado y abrió el modal "Editar perfil", con
 *   #edit-nombre y #edit-email rellenos.
 * When hace click en "Guardar".
 * Then APP.user.{nombre,email,iniciales} se actualizan, los DOM-textContent
 *   de #perfil-name, #sidebar-name, #welcome-name reflejan el nombre nuevo,
 *   y sidebar+perfil-avatar consultan el helper getAvatarDisplay (slice #6
 *   P4) para preservar foto+marco si el usuario los había personalizado.
 *   saveUserState persiste APP.user en localStorage, el modal se cierra y
 *   aparece toast verde.
 * Edge si nombre o email están vacíos, muestra toast error y retorna sin tocar
 *   el estado.
 */
function saveProfile() {
    const nombre = document.getElementById("edit-nombre").value.trim();
    const email  = document.getElementById("edit-email").value.trim();

    if (!nombre || !email) {
        showToast("Por favor completa todos los campos", "error");
        return;
    }

    // Actualizar estado
    APP.user.nombre    = nombre;
    APP.user.email     = email;
    APP.user.iniciales = nombre
        .split(" ")
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase();

    // Reflejar cambios en el DOM
    document.getElementById("perfil-name").textContent   = nombre;
    document.getElementById("sidebar-name").textContent  = nombre;
    document.getElementById("welcome-name").textContent  = nombre.split(" ")[0];

    // Slice #6 P4: preservar foto/marco al actualizar iniciales. Antes este
    // bloque machacaba ambos avatares con iniciales planas, destruyendo la
    // foto elegida. Ahora consulta el helper canónico: si el usuario eligió
    // una foto que no es de tipo "iniciales", se mantiene la foto. Si la foto
    // es del tipo "iniciales" (foto-default), las iniciales nuevas se reflejan
    // automáticamente porque getAvatarDisplay las deriva de APP.user.iniciales.
    const disp = (typeof getAvatarDisplay === "function") ? getAvatarDisplay(APP.user.id) : null;
    const sidebarAvatarEl = document.getElementById("sidebar-avatar");
    if (sidebarAvatarEl?.childNodes[0]) {
        sidebarAvatarEl.childNodes[0].textContent = disp ? disp.fotoTexto : APP.user.iniciales;
    }
    const perfilAvatarEl = document.getElementById("perfil-avatar");
    if (perfilAvatarEl) {
        perfilAvatarEl.textContent = disp ? disp.fotoTexto : APP.user.iniciales;
        if (disp && disp.marcoCss) perfilAvatarEl.style.cssText = disp.marcoCss + ";cursor:pointer";
    }

    saveUserState();
    closeModal("modal-editar-perfil");
    showToast("Perfil actualizado correctamente", "success");
}

// ═══════════════════════════════════════════════════════════
// CONFIRMAR CANÓNICO (4.F.1) — reemplazo de window.confirm()
// ═══════════════════════════════════════════════════════════
// Uso:
//   const ok = await confirmarCanonico({
//       titulo: "Eliminar materia",
//       mensaje: `¿Eliminar <strong>${nombre}</strong>? Esta acción no se puede deshacer.`,
//       accionTexto: "Eliminar",
//       tipo: "danger",       // "danger" | "primary"
//       icono: "🗑️",          // opcional, default 🗑️
//   });
//   if (!ok) return;
//
// `mensaje` acepta HTML (innerHTML). Los call-sites solo inyectan texto
// que el propio admin ya tiene en demo data / Firebase. Si en el futuro
// se inyecta input del usuario, sanitizar en la capa de escritura.
//
// C3.B.2: cualquier cierre del modal-confirmar (botón Aceptar, Cancelar,
// Escape, overlay-click) resuelve la Promise. Aceptar=true; las otras tres
// vías=false. closeModal() es quien hace el resolve(false); cerrar(true)
// solo se invoca desde el botón Aceptar.
/**
 * @interaction confirmar-canonico
 * @scope core-modals-confirmar-canonico
 *
 * Given un objeto args con titulo, mensaje, accionTexto (default
 *   "Confirmar"), tipo ("danger"|"primary"|"info"|"warn"|"ok", default
 *   "danger"), icono (default "🗑️").
 * When un caller necesita confirmación destructive/positive del usuario,
 *   await-able (replacement de window.confirm).
 * Then retorna Promise que resuelve:
 *   - true: usuario click "Aceptar". Solo via btnOk.onclick.
 *   - false: cualquier otra vía (botón Cancelar, Escape, overlay click,
 *     cierre programático). closeModal hace el resolve(false) via
 *     `_pendingConfirmer`.
 *   Setea contenido del modal-confirmar: title, mensaje (innerHTML),
 *   icono, accionTexto. Aplica clase `x-modal-confirm-icon--{tipo}` con
 *   fallback "danger" para valores fuera del set.
 *   Race-safe: si había `_pendingConfirmer` previo no resuelto, lo
 *   resuelve(false) antes de pisar el slot (caso patológico: caller no
 *   manejó la Promise).
 *   btnOk consume el slot (`_pendingConfirmer = null`) ANTES de closeModal
 *   para evitar doble-resolve via genérico.
 * Edge:
 *   - mensaje innerHTML — XSS deuda pre-Supabase: calleres confían en data
 *     controlada (admin demo o input ya sanitizado upstream). Slice
 *     auditoría XSS cross-repo lo cubre.
 *   - tipo fuera del set [danger,primary,info,warn,ok] → fallback "danger".
 *   - Slice 4.F.1 introdujo el sistema. C3.B.2 cementó el contrato
 *     Promise(false) en cualquier cierre.
 */
function confirmarCanonico({
    titulo,
    mensaje,
    accionTexto = "Confirmar",
    tipo = "danger",
    icono = "🗑️",
}) {
    return new Promise(resolve => {
        const elTitulo  = document.getElementById("modal-confirmar-titulo");
        const elMsg     = document.getElementById("modal-confirmar-mensaje");
        const elIcon    = document.getElementById("modal-confirmar-icon");
        const btnOk     = document.getElementById("modal-confirmar-aceptar");
        const btnCancel = document.getElementById("modal-confirmar-cancelar");

        elTitulo.textContent = titulo;
        elMsg.innerHTML      = mensaje;
        elIcon.textContent   = icono;
        btnOk.textContent    = accionTexto;
        btnOk.className      = `x-btn x-btn--${tipo}`;
        btnOk.disabled       = false;

        // C3.C.3: ícono según tipo. Cualquier valor fuera del set cae a danger.
        const tipoIcon = ["danger","primary","info","warn","ok"].includes(tipo) ? tipo : "danger";
        elIcon.className = `x-modal-confirm-icon x-modal-confirm-icon--${tipoIcon}`;

        // Si había un confirmer pendiente (caso patológico: caller anterior
        // no resolvió), resolverlo como false antes de pisar el slot.
        if (_pendingConfirmer) {
            const stale = _pendingConfirmer;
            _pendingConfirmer = null;
            stale(false);
        }
        _pendingConfirmer = resolve;

        btnOk.onclick = () => {
            btnOk.disabled = true;
            // Consume el slot antes de cerrar para que closeModal no re-resuelva.
            _pendingConfirmer = null;
            btnOk.onclick = null;
            btnCancel.onclick = null;
            closeModal("modal-confirmar");
            resolve(true);
        };
        btnCancel.onclick = () => {
            // closeModal() hará resolve(false) vía _pendingConfirmer.
            btnOk.onclick = null;
            btnCancel.onclick = null;
            closeModal("modal-confirmar");
        };

        openModal("modal-confirmar");
    });
}
