// ═══════════════════════════════════════════════════════════
// FIREBASE CONFIG — Credenciales del proyecto Firebase
// ═══════════════════════════════════════════════════════════
//
// Reemplaza los placeholders con los valores reales de tu proyecto:
//   Firebase Console → Project settings → General → "Your apps" → Web app
//
// IMPORTANTE: estas claves son públicas (van al cliente). La seguridad
// real se aplica con Firestore Security Rules y Storage Rules.
//
// Para deploy provisional sprint 2026-06-08:
//   1. Crea proyecto Firebase en Console.
//   2. Habilita Authentication → Email/Password.
//   3. Crea Firestore database (test mode inicialmente).
//   4. Web app → copia el config y pégalo abajo.
//   5. Cambia APP_CONFIG.mode = 'prod' en js/core/config.js.
//
// Ver guía completa en docs/entrega-2026-06-08/firebase-schema.md
// ═══════════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBScfeeJgeOQx4OlO5uSZMz_EEoxt_6ij0",
    authDomain: "xahni-25ecb.firebaseapp.com",
    projectId: "xahni-25ecb",
    storageBucket: "xahni-25ecb.firebasestorage.app",
    messagingSenderId: "388898264662",
    appId: "1:388898264662:web:47074de8023cbd8f794df7",
    measurementId: "G-JJD6N0QXX3"
};

// NOTA: Firebase AI Logic con Vertex AI backend NO usa API key.
// Auth se maneja via Firebase Auth + service account de Firebase. El Free
// Trial de Cloud cubre Vertex AI (a diferencia de Google AI Studio Gemini
// directo que tiene billing separado).

// True si la config aún tiene placeholders (no se ha llenado).
function _firebaseConfigIsPlaceholder() {
  return Object.values(FIREBASE_CONFIG).some(v =>
    typeof v === "string" && v.includes("__PLACEHOLDER")
  );
}

// ═══════════════════════════════════════════════════════════
// Inicialización + helpers globales
// ═══════════════════════════════════════════════════════════

let _firebaseInitialized = false;
let _fbApp = null;
let _fbAuth = null;
let _fbDb = null;

/**
 * @interaction init-firebase
 * @scope core-firebase-bootstrap
 *
 * Given (no params); APP_CONFIG y firebase SDK cargados.
 * When página se carga y APP_CONFIG.mode === 'prod'.
 * Then:
 *   1. Validate SDK + config no placeholder.
 *   2. firebase.initializeApp(FIREBASE_CONFIG).
 *   3. Cachea references a auth + firestore.
 *   4. Set _firebaseInitialized = true.
 * Edge:
 *   - SDK ausente → throw con instrucciones.
 *   - Placeholder → throw con guía.
 *   - Llamadas múltiples → idempotente.
 */
function initFirebase() {
  if (APP_CONFIG.mode !== "prod") return;
  if (_firebaseInitialized) return;

  if (typeof firebase === "undefined") {
    throw new Error(
      "[firebase-config] El SDK de Firebase no está cargado. " +
      "Verifica los <script> de gstatic en index.html."
    );
  }

  if (_firebaseConfigIsPlaceholder()) {
    throw new Error(
      "[firebase-config] FIREBASE_CONFIG aún tiene placeholders. " +
      "Llena js/core/firebase-config.js con los valores de tu proyecto " +
      "antes de poner APP_CONFIG.mode = 'prod'. " +
      "Ver docs/entrega-2026-06-08/firebase-schema.md"
    );
  }

  _fbApp = firebase.initializeApp(FIREBASE_CONFIG);
  _fbAuth = firebase.auth();
  _fbDb = firebase.firestore();
  _firebaseInitialized = true;
  console.log("[firebase-config] Firebase initialized · project=" + FIREBASE_CONFIG.projectId);
}

// Helpers globales tras init. Defensivos si no está inicializado.
function fbAuth() { return _fbAuth; }
function fbDb() { return _fbDb; }
function fbReady() { return _firebaseInitialized; }
function fbServerTs() {
  return (typeof firebase !== "undefined" && firebase.firestore)
    ? firebase.firestore.FieldValue.serverTimestamp()
    : new Date().toISOString();
}

// ═══════════════════════════════════════════════════════════
// GEMINI MODEL HELPER (Sweep 2026-06-09 Temario+IA)
// ═══════════════════════════════════════════════════════════
//
// Firebase AI Logic SDK no tiene compat layer en CDN (404 en
// firebase-ai-compat.js). Usamos directo el SDK Google AI Studio
// (@google/generative-ai) via dynamic ESM import. Reusa la misma
// FIREBASE_CONFIG.apiKey — la key Firebase también funciona para
// Generative Language API si está habilitada en Google Cloud Console
// del mismo proyecto.
//
// Pre-requisito humano:
//   https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com?project=xahni-25ecb
//   → Enable
// (Opcional) Restringir key por HTTP referrer en Cloud Console > Credentials.

let _geminiModelPromise = null;

/**
 * @interaction gemini-model-helper
 * @scope core-firebase-config-gemini
 *
 * Given APP_CONFIG.mode === 'prod' y FIREBASE_CONFIG.apiKey definida.
 * When caller (e.g. IaBatch.generate) necesita un modelo Gemini para llamar.
 * Then async load del SDK Google AI vía dynamic import (cacheado en
 *   Promise para evitar re-imports), construye GoogleGenerativeAI con la
 *   apiKey de Firebase, retorna handle del modelo Gemini 2.5 Flash-Lite.
 *   Cached module-scope en _geminiModelPromise.
 * Edge:
 *   - demo mode → retorna null sync.
 *   - apiKey ausente → retorna null sync.
 *   - import fail (red caída, CDN down) → throw del import propaga al caller.
 *   - APIs no habilitadas en Cloud Console → primera llamada generateContent
 *     falla con 403; el caller (IaBatch + temario-ia-modal) lo mapea a toast.
 */
function geminiModel() {
  if (typeof APP_CONFIG === "undefined" || APP_CONFIG.mode !== "prod") {
    return Promise.resolve(null);
  }
  if (_firebaseConfigIsPlaceholder()) {
    return Promise.resolve(null);
  }
  if (_geminiModelPromise) return _geminiModelPromise;
  _geminiModelPromise = (async () => {
    // Firebase AI Logic con Vertex AI backend (cubierto por Cloud Free Trial,
    // a diferencia de Google AI Studio Gemini que tiene billing separado).
    // No usa API key; auth via Firebase Auth + service account auto-provisionada
    // cuando se activa AI Logic en Firebase Console.
    //
    // El compat SDK no soporta AI Logic, por eso cargamos el modular Firebase
    // v12 SOLO para AI Logic via dynamic ESM import. Coexisten ambos SDKs
    // sin conflicto porque mantienen registries de apps separados.
    const [appMod, aiMod] = await Promise.all([
      import("https://esm.sh/firebase@12/app"),
      import("https://esm.sh/firebase@12/ai")
    ]);
    let modularApp;
    try {
      // Reusar app default modular si ya fue inicializado en una llamada previa.
      modularApp = appMod.getApp();
    } catch (e) {
      // Primera vez: inicializa app modular con el mismo config que compat.
      // Apunta al mismo proyecto Firebase; doble init es idempotente a nivel
      // de recursos.
      modularApp = appMod.initializeApp(FIREBASE_CONFIG);
    }
    const ai = aiMod.getAI(modularApp, { backend: new aiMod.VertexAIBackend() });
    return aiMod.getGenerativeModel(ai, { model: "gemini-2.5-flash-lite" });
  })();
  return _geminiModelPromise;
}
window.geminiModel = geminiModel;

// Auto-init si el modo ya es prod al cargar (no rompe demo mode).
// Wrapped en try para no bloquear el resto del script si firebase-config
// aún tiene placeholders (común en dev local sin Firebase).
if (typeof APP_CONFIG !== "undefined" && APP_CONFIG.mode === "prod") {
  try { initFirebase(); }
  catch (e) {
    console.error("[firebase-config] Auto-init falló:", e.message);
  }
}
