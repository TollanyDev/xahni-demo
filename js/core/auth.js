// ═══════════════════════════════════════════════════════════
// AUTH — Login y cierre de sesión
// ═══════════════════════════════════════════════════════════

/**
 * @interaction validate-email
 * @scope auth-helper-form-validation
 *
 * Given un string capturado del input `#login-email`.
 * When `handleLogin` lo invoca antes de aceptar el submit.
 * Then retorna `true` si el patrón cumple `algo@algo.algo` (regex
 *   permisivo: no valida TLD ni longitudes per RFC).
 * Edge:
 *   - email vacío → false (no hay match con `[^\s@]+`).
 *   - múltiples `@` → false (regex exige exactamente uno).
 *   - espacios → false.
 */
function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * @interaction validate-password
 * @scope auth-helper-form-validation
 *
 * Given un string capturado del input `#login-password`.
 * When `handleLogin` lo invoca antes de aceptar el submit.
 * Then retorna `true` si cumple las 3 reglas: ≥8 caracteres,
 *   al menos una mayúscula, al menos un dígito. La demo
 *   `123456Aa` cumple (8 chars + A + dígitos).
 * Edge:
 *   - menor a 8 chars → false sin importar contenido.
 *   - sin mayúscula → false (ej. "abc123def").
 *   - sin dígito → false (ej. "Abcdefgh").
 *   - símbolos especiales NO son requeridos (ASCII visible es OK).
 */
function validatePassword(pass) {
    return pass.length >= 8 && /[A-Z]/.test(pass) && /[0-9]/.test(pass);
}

/**
 * @interaction handle-login
 * @scope auth-shared-form
 *
 * Given el usuario llenó `#login-email` + `#login-password` y dio submit.
 * When el form dispara su evento `submit`.
 * Then previene navegación, valida email y password vía los helpers
 *   `validateEmail`/`validatePassword`, y bifurca por modo:
 *   - `APP_CONFIG.mode === "prod"` → delega a `_firebaseLogin` y
 *     retorna (el flujo continúa async).
 *   - modo demo → busca match en `DEMO_USERS` por email + password
 *     y, si OK, hidrata `APP.user` (spread completo), persiste vía
 *     `saveUserState`, dispara `actualizarRacha` + `generarNotificacionesAuto`
 *     (si están cargadas) y entra al dashboard.
 *   Cualquier validación fallida muestra el mensaje correspondiente
 *   en `#login-error` con clases `visible`/`is-visible`.
 * Edge:
 *   - email mal formado → "Por favor ingresa un correo electrónico válido."
 *   - password no cumple → "La contraseña debe tener mínimo 8 caracteres..."
 *   - credenciales no encontradas en demo → "Credenciales incorrectas."
 *   - usuario demo sin campo `password` → cualquier password válida pasa
 *     (rama legacy preservada por compatibilidad con DEMO_USERS antiguos).
 *   - helpers de racha/notif no cargados aún → omite sin error
 *     (defensa typeof).
 */
function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const pass  = document.getElementById("login-password").value;
    const errEl = document.getElementById("login-error");

    if (!validateEmail(email)) {
        errEl.textContent = "Por favor ingresa un correo electrónico válido.";
        errEl.classList.add("visible", "is-visible");
        return;
    }
    if (!validatePassword(pass)) {
        errEl.textContent = "La contraseña debe tener mínimo 8 caracteres, una mayúscula y un número.";
        errEl.classList.add("visible", "is-visible");
        return;
    }

    if (APP_CONFIG.mode === "prod") {
        _firebaseLogin(email, pass, errEl);
        return;
    }

    const found = DEMO_USERS.find(u => u.email === email);
    if (!found || (found.password && found.password !== pass)) {
        errEl.textContent = "Credenciales incorrectas.";
        errEl.classList.add("visible", "is-visible");
        return;
    }

    errEl.classList.remove("visible", "is-visible");
    APP.user = { ...found };
    saveUserState();
    if (typeof actualizarRacha === "function") actualizarRacha();
    if (typeof generarNotificacionesAuto === "function") generarNotificacionesAuto();
    loadDashboard();
}

// ── Firebase login ────────────────────────────────────────────
// Autentica con email/password y carga el perfil desde usuarios/{uid}.
/**
 * @interaction firebase-login
 * @scope auth-shared-prod
 *
 * Given `APP_CONFIG.mode === "prod"` y `handleLogin` ya validó el form.
 * When `handleLogin` delega aquí pasando email + password + errEl.
 * Then ejecuta `signInWithEmailAndPassword`, lee el doc
 *   `usuarios/{uid}` para hidratar perfil (que incluye `tipo`),
 *   setea `APP.user = { id: snap.id, ...profile }`, persiste vía
 *   `saveUserState`, dispara `actualizarRacha` + `generarNotificacionesAuto`
 *   (si están cargadas) y entra al dashboard.
 * Edge:
 *   - error de credenciales o red → `_firebaseAuthErrorMsg` mapea
 *     a un mensaje legible en `#login-error`.
 *   - usuario auth sin doc en `usuarios/{uid}` → throw
 *     `auth/no-profile` → "La cuenta existe pero no tiene perfil...".
 *   - doc sin campo `tipo` → throw `auth/no-tipo` → mensaje admin.
 *   - `auth/too-many-requests` → mensaje pidiendo esperar.
 *   - `auth/network-request-failed` → mensaje sin conexión.
 *   - cualquier otro código → "Error de autenticación: ..." + code.
 */
function _firebaseLogin(email, pass, errEl) {
    firebase.auth().signInWithEmailAndPassword(email, pass)
        .then(cred => firebase.firestore().collection("usuarios").doc(cred.user.uid).get())
        .then(snap => {
            if (!snap.exists) {
                throw { code: "auth/no-profile" };
            }
            const profile = snap.data();
            if (!profile.tipo) {
                throw { code: "auth/no-tipo" };
            }
            errEl.classList.remove("visible", "is-visible");
            APP.user = { id: snap.id, ...profile };
            saveUserState();
            if (typeof actualizarRacha === "function") actualizarRacha();
            if (typeof generarNotificacionesAuto === "function") generarNotificacionesAuto();
            // Sprint Firebase deploy: hidrata GamerState + UserJuegos desde Firestore.
            if (typeof firestoreHydrateOnLogin === "function") {
                firestoreHydrateOnLogin(snap.id).catch(() => {});
            }
            loadDashboard();
        })
        .catch(err => {
            errEl.textContent = _firebaseAuthErrorMsg(err);
            errEl.classList.add("visible", "is-visible");
        });
}

/**
 * @interaction firebase-auth-error-msg
 * @scope auth-helper-prod-error-mapping
 *
 * Given un error capturado por `_firebaseLogin` (Firebase SDK error o
 *   throw sintético del flujo: `auth/no-profile`, `auth/no-tipo`).
 * When `_firebaseLogin` resuelve el `.catch()` o el throw del `.then()`.
 * Then mapea `err.code` a un mensaje legible para el usuario:
 *   - wrong-password / user-not-found / invalid-credential →
 *     "Credenciales incorrectas."
 *   - no-profile → "La cuenta existe pero no tiene perfil..."
 *   - no-tipo → "Cuenta sin tipo asignado..."
 *   - too-many-requests → "Demasiados intentos..."
 *   - network-request-failed → "Sin conexión..."
 *   - default → "Error de autenticación: " + message/code.
 * Edge:
 *   - err `null`/`undefined` → code queda "" y cae al default con
 *     "Error de autenticación: desconocido".
 *   - err sin code pero con message → default lo usa.
 */
function _firebaseAuthErrorMsg(err) {
    const code = (err && err.code) || "";
    switch (code) {
        case "auth/wrong-password":
        case "auth/user-not-found":
        case "auth/invalid-credential":
            return "Credenciales incorrectas.";
        case "auth/no-profile":
            return "La cuenta existe pero no tiene perfil. Contacta al administrador.";
        case "auth/no-tipo":
            return "Cuenta sin tipo asignado. Contacta al administrador.";
        case "auth/too-many-requests":
            return "Demasiados intentos. Inténtalo más tarde.";
        case "auth/network-request-failed":
            return "Sin conexión. Revisa tu internet.";
        default:
            return "Error de autenticación: " + (err?.message || code || "desconocido");
    }
}

/**
 * @interaction handle-logout
 * @scope auth-shared-form
 *
 * Given hay una sesión activa (`APP.user` no null) y el usuario hace
 *   click en el botón "Cerrar sesión" (cabecera/configuración).
 * When el click dispara el handler.
 * Then `e.stopPropagation()` evita bubbling, define un `finish()`
 *   que: (a) anula `APP.user`, (b) borra la sesión persistida con
 *   `clearUserState`, (c) llama `hubCerrarDetalle()` si existe para
 *   resetear `hubMateriaActiva` del hub estudiante, (d) desactiva
 *   todas las `.view`, activa `#screen-auth` y desactiva
 *   `#screen-dashboard-admin` + `#screen-hub`, (e) muestra toast
 *   "Sesión cerrada correctamente". En modo prod con SDK Firebase
 *   disponible, primero hace `firebase.auth().signOut()` y luego
 *   `finish()`. En demo (o si Firebase no está) corre `finish()`
 *   directamente.
 * Edge:
 *   - signOut() falla → loguea error y aún así corre `finish()`
 *     (defensa: el usuario debe poder salir aunque la red caiga).
 *   - `hubCerrarDetalle` no cargado → omite limpieza del hub sin error.
 *   - `#screen-hub` no existe (puede pasar antes del shell rework) →
 *     omite con guard `if (screenHub)`.
 */
function handleLogout(e) {
    e.stopPropagation();
    const finish = () => {
        APP.user = null;
        clearUserState();

        // Reset estado del hub estudiante: si el usuario anterior dejó un
        // hub-detalle abierto, hubCerrarDetalle() resetea hubMateriaActiva
        // y restaura hub-lista-panel para el siguiente login.
        if (typeof hubCerrarDetalle === "function") hubCerrarDetalle();

        document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
        document.getElementById("screen-auth").classList.add("active");
        document.getElementById("screen-dashboard-admin").classList.remove("active");
        const screenHub = document.getElementById("screen-hub");
        if (screenHub) screenHub.classList.remove("active");
        showToast("Sesión cerrada correctamente", "info");
    };

    if (APP_CONFIG.mode === "prod" && typeof firebase !== "undefined" && firebase.auth) {
        firebase.auth().signOut().then(finish).catch(err => {
            console.error("[auth] signOut error:", err);
            finish();
        });
        return;
    }
    finish();
}

// ── Dropdowns de selección rápida de usuarios demo ──────────
// Una vez que DataService carga DEMO_USERS, se invoca para llenar
// los <select> del auth screen (uno por rol).
/**
 * @interaction populate-demo-user-dropdowns
 * @scope auth-shared-demo-pick
 *
 * Given `DataService.init()` ya pobló `DEMO_USERS` desde
 *   `data/demo/usuarios.json` y existen los `<select>` con id
 *   `#demo-pick-estudiante`, `#demo-pick-profesor`, `#demo-pick-administrador`.
 * When el boot block lo invoca al final de la inicialización demo
 *   (sólo cuando `APP_CONFIG.mode === "demo"` — `_toggleDemoPickVisibility`
 *   oculta el bloque en prod).
 * Then agrupa `DEMO_USERS` por `tipo` y, por cada rol, rellena el
 *   `<select>` correspondiente con un placeholder "— Seleccionar —"
 *   seguido de `<option>` por usuario mostrando `iniciales · nombre`
 *   y `value=email`.
 * Edge:
 *   - `DEMO_USERS` vacío o no es array → early return sin tocar DOM.
 *   - falta uno de los `<select>` en el DOM → omite ese rol (guard
 *     `if (!sel) return`).
 */
function populateDemoUserDropdowns() {
    if (!Array.isArray(DEMO_USERS) || !DEMO_USERS.length) return;

    const groups = {
        estudiante:    DEMO_USERS.filter(u => u.tipo === "estudiante"),
        profesor:      DEMO_USERS.filter(u => u.tipo === "profesor"),
        administrador: DEMO_USERS.filter(u => u.tipo === "administrador"),
    };

    Object.entries(groups).forEach(([role, users]) => {
        const sel = document.getElementById(`demo-pick-${role}`);
        if (!sel) return;
        sel.innerHTML =
            `<option value="">— Seleccionar —</option>` +
            users.map(u =>
                `<option value="${u.email}">${u.iniciales} · ${u.nombre}</option>`
            ).join("");
    });
}

// Selección de un usuario demo desde uno de los 3 dropdowns.
// Llena los campos del formulario y entra automáticamente.
/**
 * @interaction pick-demo-user
 * @scope auth-shared-demo-pick
 *
 * Given `populateDemoUserDropdowns` ya cargó los `<select>` y el
 *   usuario abre uno de los 3 dropdowns y elige un option.
 * When el `onchange` del select dispara con `(role, email)`.
 * Then busca el usuario en `DEMO_USERS` que matchee email + tipo,
 *   prellena `#login-email` y `#login-password` (default fallback
 *   `"123456Aa"` si el usuario no tiene `password`), resetea visual
 *   los otros 2 dropdowns, hidrata `APP.user`, persiste,
 *   dispara racha/notificaciones y entra al dashboard.
 *   Termina con toast verde `"Sesión demo: ${user.nombre}"`.
 * Edge:
 *   - email vacío (placeholder seleccionado) → early return sin error.
 *   - usuario no encontrado (race condition o data corrupta) →
 *     toast error "Usuario demo no encontrado" y return.
 *   - inputs no existen en el DOM → omite el prellenado (guards
 *     `if (emailEl)` / `if (passEl)`) pero igual hidrata `APP.user`.
 *   - helpers de racha/notif no cargados → omite sin error.
 */
function pickDemoUser(role, email) {
    if (!email) return;
    const user = DEMO_USERS.find(u => u.email === email && u.tipo === role);
    if (!user) {
        showToast("Usuario demo no encontrado", "error");
        return;
    }
    const emailEl = document.getElementById("login-email");
    const passEl  = document.getElementById("login-password");
    if (emailEl) emailEl.value = user.email;
    if (passEl)  passEl.value  = user.password || "123456Aa";

    // Reset visual de los otros dropdowns
    ["estudiante", "profesor", "administrador"].forEach(r => {
        if (r !== role) {
            const otro = document.getElementById(`demo-pick-${r}`);
            if (otro) otro.value = "";
        }
    });

    APP.user = { ...user };
    saveUserState();
    if (typeof actualizarRacha === "function") actualizarRacha();
    if (typeof generarNotificacionesAuto === "function") generarNotificacionesAuto();
    loadDashboard();
    showToast(`Sesión demo: ${user.nombre}`, "success");
}

// ── Auto-restaurar sesión (modo demo) ─────────────────────
// Llamado por el boot block en index.html DESPUÉS de DataService.init().
// En modo prod, Firebase maneja la restauración vía onAuthStateChanged.
/**
 * @interaction try-restore-session
 * @scope auth-shared-session-restore
 *
 * Given el boot block en `index.html` corre tras
 *   `DataService.init()` y `APP.user` está null (sesión nueva).
 * When se invoca al final del bootstrap demo.
 * Then si modo es "demo" y existe sesión persistida en
 *   `localStorage[xahni_session_user]` vía `loadUserState`, hidrata
 *   `APP.user`, dispara `actualizarRacha` + `generarNotificacionesAuto`
 *   (si están cargadas) y entra al dashboard saltándose el form.
 * Edge:
 *   - modo prod → early return (Firebase `onAuthStateChanged` en
 *     `_watchAuthState` de data-service.js se encarga).
 *   - sin sesión guardada → early return, queda el form visible.
 *   - JSON corrupto en localStorage → `loadUserState` retorna null,
 *     early return (no crash).
 *   - helpers de racha/notif no cargados → omite sin error.
 */
function _tryRestoreSession() {
    if (APP_CONFIG.mode !== "demo") return;
    const savedUser = loadUserState();
    if (!savedUser) return;
    APP.user = savedUser;
    if (typeof actualizarRacha === "function") actualizarRacha();
    if (typeof generarNotificacionesAuto === "function") generarNotificacionesAuto();
    loadDashboard();
}

// ── Demo-pick visibility toggle (Bucket A · C5.C) ──────────
// Muestra/oculta #demo-pick-block según APP_CONFIG.mode.
// Invocado desde el handler DOMContentLoaded en index.html.
// El elemento tiene `hidden` por default en HTML — fail-safe
// para que en prod NO se exponga el demo-pick si JS no carga.
/**
 * @interaction toggle-demo-pick-visibility
 * @scope auth-shared-toggle-visibility
 *
 * Given el HTML tiene `#demo-pick-block` con atributo `hidden` por
 *   default (fail-safe: si JS no carga, prod NO expone los selectors).
 * When `DOMContentLoaded` dispara y este handler corre desde
 *   `index.html`.
 * Then setea `block.hidden = (APP_CONFIG.mode !== "demo")`. En demo
 *   el bloque aparece; en prod queda oculto.
 * Edge:
 *   - `#demo-pick-block` no existe en el DOM → early return sin error.
 *   - `APP_CONFIG` no cargado (script orden) → expresión retorna
 *     `true` y queda oculto (lado seguro).
 */
function _toggleDemoPickVisibility() {
    const block = document.getElementById("demo-pick-block");
    if (!block) return;
    block.hidden = (APP_CONFIG.mode !== "demo");
}

// ═══════════════════════════════════════════════════════════
// Sprint 2026-06-08 · Firebase Auth (login + reset password)
// Signup eliminado 2026-06-06 (H1): solo admin crea cuentas
// desde la consola de administración.
// ═══════════════════════════════════════════════════════════

/**
 * @interaction auth-reset-password
 * @scope auth-firebase-prod-recovery
 *
 * Given click en "¿Olvidaste tu contraseña?".
 * When usuario invoca authResetPassword().
 * Then prompt email + FirebaseAuth.sendPasswordReset + toast feedback.
 * Edge:
 *   - Email vacío → no-op.
 *   - APP_CONFIG.mode demo → mensaje informativo.
 */
async function authResetPassword() {
    if (APP_CONFIG.mode !== "prod" || typeof FirebaseAuth === "undefined") {
        if (typeof showToast === "function") showToast("Reset de contraseña solo en modo producción", "info");
        return;
    }
    const email = prompt("Ingresa tu email para recibir el link de reset:");
    if (!email || !email.trim()) return;
    try {
        await FirebaseAuth.sendPasswordReset(email.trim());
        if (typeof showToast === "function") showToast("Revisa tu correo para restablecer la contraseña", "ok");
        else alert("Te enviamos un correo con instrucciones.");
    } catch (err) {
        if (typeof showToast === "function") showToast(err.message || "Error", "danger");
        else alert(err.message || "Error");
    }
}
window.authResetPassword = authResetPassword;

/**
 * @interaction toggle-firebase-auth-ui
 * @scope auth-firebase-prod-toggle
 *
 * Given page load.
 * When DOMContentLoaded.
 * Then si APP_CONFIG.mode === 'prod':
 *   1. Hide #demo-pick-block.
 *   2. Hide #auth-hint-demo, show #auth-hint-prod.
 *   3. Clear pre-filled credentials del login.
 *   Else (demo mode): demo-pick visible.
 * Signup eliminado 2026-06-06 (H1): solo admin crea cuentas.
 */
function _toggleFirebaseAuthUI() {
    const hintDemo = document.getElementById("auth-hint-demo");
    const hintProd = document.getElementById("auth-hint-prod");
    const demoPick = document.getElementById("demo-pick-block");
    const isProd = APP_CONFIG.mode === "prod";
    if (hintDemo) hintDemo.hidden = isProd;
    if (hintProd) hintProd.hidden = !isProd;
    if (demoPick) demoPick.hidden = isProd;

    if (isProd) {
        // En prod, no pre-rellenamos credenciales demo.
        const loginEmail = document.getElementById("login-email");
        const loginPass = document.getElementById("login-password");
        if (loginEmail) loginEmail.value = "";
        if (loginPass) loginPass.value = "";
        if (loginEmail) loginEmail.placeholder = "tu@correo.com";
    }
}

document.addEventListener("DOMContentLoaded", _toggleFirebaseAuthUI);
