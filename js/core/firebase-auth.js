// js/core/firebase-auth.js
// Sprint entrega 2026-06-08 · Firebase deploy provisional
//
// Wrapper sobre firebase.auth() para signup + login + logout + carga de
// perfil del usuario desde Firestore. Solo activo cuando
// APP_CONFIG.mode === 'prod' Y firebase está inicializado.
//
// Convenciones:
//   - Doc /usuarios/{uid} se crea en signup y se lee en login → APP.user.
//   - Email verification se envía en signup pero NO bloquea el uso (banner
//     informativo posterior).
//   - Errores se traducen a mensajes user-friendly (auth/email-already-in-use,
//     auth/wrong-password, etc.).

const FirebaseAuth = (() => {

    /**
     * @interaction firebase-auth-signup
     * @scope core-firebase-auth-signup
     *
     * Given { email, password, nombre, tipo }.
     * When user submits signup form.
     * Then async pipeline:
     *   1. firebase.auth().createUserWithEmailAndPassword(email, password).
     *   2. Crea doc /usuarios/{uid} con shape completo (uid, email, nombre,
     *      iniciales auto-derived, tipo, grupos:[], materias:[],
     *      emailVerificado:false, creadoEn serverTimestamp).
     *   3. Inicializa /gamerState/{uid} con xp=0, nivel=1, insignias=[],
     *      jugadas=[].
     *   4. Dispara sendEmailVerification fire-and-forget.
     *   5. Retorna { user, profile }.
     * Edge:
     *   - Auth error (e.g., email-already-in-use) → throw con mensaje
     *     user-friendly traducido.
     *   - Firestore error → user existe en Auth pero sin profile.
     *     Deuda: rollback o retry. MVP: log + throw.
     */
    async function signUp({ email, password, nombre, tipo }) {
        if (!fbReady()) throw new Error("Firebase no inicializado");
        const auth = fbAuth();
        const db = fbDb();

        let cred;
        try {
            cred = await auth.createUserWithEmailAndPassword(email, password);
        } catch (e) {
            throw new Error(_traducirAuthError(e));
        }
        const user = cred.user;
        const uid = user.uid;
        const nombreFinal = (nombre || email.split("@")[0]).trim();
        const iniciales = nombreFinal
            .split(/\s+/)
            .map(s => s[0] || "")
            .join("")
            .slice(0, 2)
            .toUpperCase() || "??";

        const profile = {
            uid,
            email,
            nombre: nombreFinal,
            iniciales,
            tipo: tipo || "estudiante",
            grupos: [],
            materias: [],
            emailVerificado: false,
            creadoEn: fbServerTs(),
            ultimoLogin: fbServerTs()
        };

        try {
            await db.collection("usuarios").doc(uid).set(profile);
            await db.collection("gamerState").doc(uid).set({
                uid,
                xp: 0,
                nivel: 1,
                insignias: [],
                jugadas: [],
                actualizadoEn: fbServerTs()
            });
        } catch (e) {
            console.error("[FirebaseAuth] signup → firestore write fail", e);
            throw new Error("Tu cuenta se creó pero hubo un problema guardando tu perfil. Refresca e intenta login.");
        }

        // Envío de verification email no bloquea el flujo.
        user.sendEmailVerification().catch(err => {
            console.warn("[FirebaseAuth] sendEmailVerification fail", err);
        });

        return { user, profile };
    }

    /**
     * @interaction firebase-auth-signin
     * @scope core-firebase-auth-signin
     *
     * Given { email, password }.
     * When user submits login form.
     * Then signInWithEmailAndPassword + carga /usuarios/{uid} + update
     *   ultimoLogin + retorna { user, profile }.
     * Edge:
     *   - wrong-password / user-not-found → mensaje traducido.
     *   - Perfil ausente (raro: usuario creado en Console sin doc) →
     *     crea uno mínimo con defaults.
     */
    async function signIn({ email, password }) {
        if (!fbReady()) throw new Error("Firebase no inicializado");
        const auth = fbAuth();
        const db = fbDb();

        let cred;
        try {
            cred = await auth.signInWithEmailAndPassword(email, password);
        } catch (e) {
            throw new Error(_traducirAuthError(e));
        }
        const user = cred.user;
        const uid = user.uid;

        let profile = null;
        try {
            const snap = await db.collection("usuarios").doc(uid).get();
            if (snap.exists) {
                profile = snap.data();
                profile.emailVerificado = user.emailVerified;
                // Update ultimoLogin (fire-and-forget).
                db.collection("usuarios").doc(uid).update({
                    ultimoLogin: fbServerTs(),
                    emailVerificado: user.emailVerified
                }).catch(() => {});
            } else {
                // Defensa: crea perfil mínimo si no existe (cuenta sembrada
                // desde Console o script sin doc).
                profile = {
                    uid,
                    email: user.email || email,
                    nombre: (user.displayName || (user.email || email).split("@")[0]).trim(),
                    iniciales: "??",
                    tipo: "estudiante",
                    grupos: [],
                    materias: [],
                    emailVerificado: user.emailVerified,
                    creadoEn: fbServerTs(),
                    ultimoLogin: fbServerTs()
                };
                await db.collection("usuarios").doc(uid).set(profile);
            }
        } catch (e) {
            console.error("[FirebaseAuth] signin → profile load fail", e);
            throw new Error("Login exitoso pero no se pudo cargar tu perfil.");
        }

        return { user, profile };
    }

    /**
     * @interaction firebase-auth-logout
     * @scope core-firebase-auth-logout
     *
     * Given (no params); usuario logueado.
     * When user click cerrar sesión.
     * Then firebase.auth().signOut + reset APP.user + redirect a login screen.
     */
    async function logout() {
        if (!fbReady()) return;
        try { await fbAuth().signOut(); }
        catch (e) { console.warn("[FirebaseAuth] signOut fail", e); }
    }

    /**
     * @interaction firebase-auth-on-changed
     * @scope core-firebase-auth-state
     *
     * Given callback(user).
     * When auth state cambia (login/logout cross-tab).
     * Then invoca callback con el user actual (o null).
     * Edge: SDK ausente → callback nunca dispara.
     */
    function onAuthChanged(callback) {
        if (!fbReady()) return () => {};
        return fbAuth().onAuthStateChanged(callback);
    }

    async function sendVerifyEmail() {
        if (!fbReady()) return;
        const user = fbAuth().currentUser;
        if (!user) return;
        try { await user.sendEmailVerification(); }
        catch (e) { throw new Error(_traducirAuthError(e)); }
    }

    async function sendPasswordReset(email) {
        if (!fbReady()) throw new Error("Firebase no inicializado");
        try { await fbAuth().sendPasswordResetEmail(email); }
        catch (e) { throw new Error(_traducirAuthError(e)); }
    }

    function _traducirAuthError(e) {
        const code = e && e.code ? e.code : "";
        const map = {
            "auth/email-already-in-use": "Ya hay una cuenta con ese email. ¿Intentas iniciar sesión?",
            "auth/invalid-email": "El formato del email no es válido.",
            "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
            "auth/user-not-found": "No encontramos una cuenta con ese email.",
            "auth/wrong-password": "Email o contraseña incorrectos.",
            "auth/invalid-credential": "Email o contraseña incorrectos.",
            "auth/too-many-requests": "Demasiados intentos. Espera unos minutos.",
            "auth/network-request-failed": "Sin conexión. Verifica tu internet.",
            "auth/user-disabled": "Esta cuenta está deshabilitada.",
        };
        return map[code] || (e && e.message ? e.message : "Error de autenticación.");
    }

    return { signUp, signIn, logout, onAuthChanged, sendVerifyEmail, sendPasswordReset };
})();

/**
 * @interaction crear-usuario-con-auth
 * @scope core-firebase-auth-admin-create
 *
 * Given admin llena modal "Nuevo usuario" con email, password, nombre, tipo.
 * When invoca crearUsuarioConAuth(data) desde admin/usuarios.js.
 * Then:
 *   1. Verifica APP_CONFIG.mode === 'prod' Y APP.user.tipo === 'administrador'.
 *      Si no, fallback a saveUsuario directo (demo mode).
 *   2. Inicializa secondary Firebase app temporal (no afecta sesión admin).
 *   3. createUserWithEmailAndPassword en secondary auth → newUid.
 *   4. signOut + delete secondary app (try/finally para cleanup garantizado).
 *   5. Llama DataService.saveUsuario({id: newUid, ...data}) para doc Firestore.
 *   6. Retorna Promise<{id, ...data}>.
 * Edge:
 *   - email-already-in-use → throw error con código identificable.
 *   - weak-password → throw error.
 *   - saveUsuario fail después de createUser OK → log warn (deuda manual
 *     cleanup en Console). NO intentar rollback automático en esta versión.
 *   - secondary app delete fail → silent (worst case, instancia colgada
 *     hasta page refresh).
 */
async function crearUsuarioConAuth(data) {
    if (typeof APP_CONFIG === 'undefined' || APP_CONFIG.mode !== 'prod') {
        // Demo mode: fallback directo a saveUsuario (no necesita Auth real)
        return DataService.saveUsuario(data);
    }

    if (typeof APP === 'undefined' || !APP.user || APP.user.tipo !== 'administrador') {
        throw new Error('Solo administradores pueden crear usuarios.');
    }

    const { email, password, nombre, tipo, ...rest } = data;

    if (!email || !password) {
        throw new Error('Email y password son requeridos.');
    }
    if (password.length < 6) {
        throw new Error('Password debe tener al menos 6 caracteres.');
    }
    if (tipo !== 'estudiante' && tipo !== 'profesor') {
        throw new Error('Solo se permiten crear estudiantes o profesores. Admin se crea via signup público.');
    }

    const tmpAppName = 'admin-create-' + Date.now();
    let tmpApp = null;
    let newUid = null;

    try {
        tmpApp = firebase.initializeApp(FIREBASE_CONFIG, tmpAppName);
        const tmpAuth = tmpApp.auth();
        const cred = await tmpAuth.createUserWithEmailAndPassword(email, password);
        newUid = cred.user.uid;
        await tmpAuth.signOut();
    } catch (e) {
        // Errores comunes: auth/email-already-in-use, auth/weak-password, auth/invalid-email
        if (tmpApp) {
            try { await tmpApp.delete(); } catch (_) {}
        }
        throw e;
    }

    try {
        await tmpApp.delete();
    } catch (_) { /* silent cleanup fail */ }

    // Crear doc Firestore con shape canonical
    const iniciales = (nombre || '')
        .trim()
        .split(/\s+/)
        .map(s => s[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase();

    const userDoc = {
        id: newUid,
        email,
        nombre,
        tipo,
        estado: 'activo',
        nivel: 1,
        iniciales,
        materias: [],
        grupos: [],
        gamer: { xp: 0, nivel: 1, insignias: [], jugadas: [] },
        ...rest
    };

    try {
        await DataService.saveUsuario(userDoc);
    } catch (saveErr) {
        console.warn('[crearUsuarioConAuth] Auth user created but saveUsuario failed for uid:', newUid, saveErr);
        // Cleanup manual deuda en Console
        throw new Error('Cuenta Auth creada pero falló persistencia. Reportar uid ' + newUid + ' al admin.');
    }

    return userDoc;
}
window.crearUsuarioConAuth = crearUsuarioConAuth;
