// ═══════════════════════════════════════════════════════════
// STATE — Estado global de la aplicación
// ═══════════════════════════════════════════════════════════
let APP = {
  user:        null,
  currentView: "dashboard",
  profParcialActivo:   {}, // { [materiaId_grupoId]: parcialNum } — persistido en localStorage
  alumnoParcialActivo: {}, // { [materiaId_grupoId]: parcialNum } — persistido en localStorage
};

// Los siguientes arrays se populan en DataService.init() desde data/demo/*.json
// No modificar directamente — son gestionados por data-service.js
let DEMO_USERS                = [];   // era: const DEMO_USERS = {estudiante:{...}, ...}
let DEMO_MATERIAS             = [];
let DEMO_GRUPOS               = [];
let DEMO_TAREAS               = [];
let DEMO_RECURSOS             = [];
let DEMO_COMPETENCIAS         = [];
let DEMO_JUEGOS               = [];
let DEMO_EXAMENES             = [];   // slice examenes beta 2026-06-06
let DEMO_LOGROS               = [];
let DEMO_ESCALAS              = [];
let DEMO_PROGRESO_ESCALA      = {};
let DEMO_PROGRESO_ESTUDIANTES = {};
let DEMO_INSTITUCIONES        = [];
let DEMO_CARRERAS             = [];
let DEMO_CLASIFICACIONES      = [];
let DEMO_SLOTS_CATALOG        = [];
let DEMO_ASISTENCIAS          = [];   // slice asistencia 2026-05-24
let DEMO_TORNEOS_INTRA        = [];   // slice torneos intragrupales 2026-06-09

// DEMO_MAESTRIA · datos de maestría LoL-style por (uid, materiaId).
// Cargado desde data/demo/maestria.json.
// VANILLA HARDCODED — post-migración vive en Supabase:
//   tabla `maestria_alumno` (uid, materia_id, points, nivel, ...)
//   tabla `maestria_profesor` (uid, materia_id, points, nivel, ...)
//   tabla `mastery_tokens_obtenidos` (uid, materia_id, token_id, obtenido_en)
//   tabla `cosmetics_desbloqueados` (uid, materia_id, cosmetic_id)
// Schema spec: docs/superpowers/specs/2026-05-23-supabase-schema-beta.md
let DEMO_MAESTRIA = {};
window.DEMO_MAESTRIA = DEMO_MAESTRIA;
// DEMO_NOTIFICACIONES_SEED · seed inicial de notificaciones por uid.
// Cargado desde data/demo/notificaciones-seed.json.
// VANILLA HARDCODED — post-migración vive en Supabase:
//   tabla `notificaciones_usuario` (uid, tipo, titulo, desc, fecha, leida)
//   realtime subscription para nuevos items
//   triggers backend para disparadores (vencimientos, riesgo, etc.)
// Schema spec: docs/superpowers/specs/2026-05-23-supabase-schema-beta.md
let DEMO_NOTIFICACIONES_SEED = {};
window.DEMO_NOTIFICACIONES_SEED = DEMO_NOTIFICACIONES_SEED;
let DEMO_TOP3_MAESTRIA       = {};   // curated Top 3 maestrías per uid · array de materiaIds (Slice H2a)
window.DEMO_TOP3_MAESTRIA = DEMO_TOP3_MAESTRIA;
// DEMO_CALENDARIO_EVENTOS · exámenes puntuales por grupoId (Slice calendario rediseño 2026-06-02).
// Cargado desde data/demo/calendario-eventos.json.
// Las clases recurrentes NO viven aquí — se derivan en runtime desde
// DEMO_MATERIAS[m].horario filtrado por grupoId.
// VANILLA HARDCODED — post-migración vive en Supabase:
//   tabla `examenes` (id, grupoId, materiaId, parcialNum, fecha, horaInicio, horaFin, titulo)
//   tabla `horarios_clase` (la fuente real de clases recurrentes, hoy en materias.horario)
// Schema spec: docs/superpowers/specs/2026-05-23-supabase-schema-beta.md
let DEMO_CALENDARIO_EVENTOS = {};
window.DEMO_CALENDARIO_EVENTOS = DEMO_CALENDARIO_EVENTOS;

// ── Mensajes y notificaciones (estáticos, no vienen del JSON) ──
const DEMO_MENSAJES = {
  "bd_ISC-3A": [
    { id:"m1", autorId:"est1",  texto:"¿Alguien entendió el tema de las formas normales?",                                timestamp:"2026-05-09T08:00:00" },
    { id:"m2", autorId:"est2",  texto:"Yo también tengo dudas con la 3FN",                                                 timestamp:"2026-05-09T08:05:00" },
    { id:"m3", autorId:"prof1", texto:"La 3FN elimina dependencias transitivas. Si A→B→C, C depende de A transitivamente.", timestamp:"2026-05-09T08:10:00" },
    { id:"m4", autorId:"est1",  texto:"¡Gracias profe!",                                                                   timestamp:"2026-05-09T08:11:00" },
  ],
  "prog_ISC-3A": [
    { id:"m1", autorId:"prof2", texto:"Recuerden entregar el ejercicio de recursividad", timestamp:"2026-05-08T15:00:00" },
    { id:"m2", autorId:"est1",  texto:"¿Hay fecha límite?",                               timestamp:"2026-05-08T15:05:00" },
    { id:"m3", autorId:"prof2", texto:"El viernes 10 antes de medianoche",                timestamp:"2026-05-08T15:07:00" },
  ],
  "bd_ISC-3B": [
    { id:"m1", autorId:"est3",  texto:"¿Los índices entran en el parcial?",              timestamp:"2026-05-08T10:00:00" },
    { id:"m2", autorId:"prof1", texto:"Sí, especialmente B-Tree e índices compuestos.",  timestamp:"2026-05-08T10:05:00" },
    { id:"m3", autorId:"est4",  texto:"¿Cuántas preguntas vendrán sobre normalización?", timestamp:"2026-05-08T10:10:00" },
  ],
  "bd_ISW-3A": [
    { id:"m1", autorId:"est5",  texto:"Terminé la tarea t5 antes de tiempo 🎉",         timestamp:"2026-05-14T18:00:00" },
    { id:"m2", autorId:"prof1", texto:"Excelente, ¡bien hecho Luis!",                    timestamp:"2026-05-14T18:30:00" },
  ],
};

const DEMO_NOTIFICACIONES = {
  est1: [
    { id:"n1", tipo:"calificacion", titulo:"Nueva calificación", cuerpo:'Tu tarea "Diseño ER" fue calificada con 10', leida:true,  timestamp:"2026-05-09T07:00:00" },
    { id:"n2", tipo:"tarea",        titulo:"Tarea próxima",      cuerpo:'"Consultas SQL" vence en 11 días',           leida:false, timestamp:"2026-05-09T08:00:00" },
    { id:"n3", tipo:"xp",           titulo:"XP ganado",          cuerpo:"Ganaste 50 XP por entregar a tiempo",        leida:false, timestamp:"2026-05-09T07:05:00" },
  ],
  est2: [
    { id:"n1", tipo:"calificacion", titulo:"Calificación recibida", cuerpo:'Tu tarea "Diseño ER" fue calificada con 9', leida:false, timestamp:"2026-05-10T12:00:00" },
    { id:"n2", tipo:"tarea",        titulo:"Nueva tarea",           cuerpo:'Nueva tarea en Redes: "Modelo OSI"',        leida:false, timestamp:"2026-05-09T09:00:00" },
  ],
  est3: [
    { id:"n1", tipo:"calificacion", titulo:"Calificación recibida", cuerpo:'"Modelo Relacional" calificada con 9',    leida:false, timestamp:"2026-05-11T16:00:00" },
    { id:"n2", tipo:"tarea",        titulo:"Tarea próxima a vencer", cuerpo:'"Lógica Proposicional" vence mañana',   leida:false, timestamp:"2026-05-09T08:00:00" },
  ],
  est4: [
    { id:"n1", tipo:"tarea", titulo:"Nueva tarea asignada", cuerpo:'Nueva tarea en Mat: "Teoría de Grafos"', leida:false, timestamp:"2026-05-09T09:00:00" },
  ],
  est5: [
    { id:"n1", tipo:"logro",        titulo:"¡Logro desbloqueado!",  cuerpo:"Racha de 30 días — ¡increíble!",          leida:false, timestamp:"2026-05-09T00:00:00" },
    { id:"n2", tipo:"calificacion", titulo:"10/10 en Landing Page", cuerpo:'Tu tarea "Landing Page HTML/CSS" = 10',   leida:true,  timestamp:"2026-05-15T20:00:00" },
    { id:"n3", tipo:"xp",           titulo:"XP ganado",             cuerpo:"Ganaste 100 XP por competencia",          leida:false, timestamp:"2026-04-28T10:00:00" },
  ],
  est6: [
    { id:"n1", tipo:"tarea", titulo:"Tarea vencida", cuerpo:'"SQL Básico" venció con calificación 6', leida:false, timestamp:"2026-05-09T00:00:00" },
  ],
  prof1: [
    { id:"n1", tipo:"entrega", titulo:"Nueva entrega", cuerpo:'Juan Pérez entregó "Diseño ER"',               leida:false, timestamp:"2026-05-09T07:00:00" },
    { id:"n2", tipo:"entrega", titulo:"Nueva entrega", cuerpo:'Luis Mendoza entregó "SQL Básico"',             leida:false, timestamp:"2026-05-07T16:00:00" },
    { id:"n3", tipo:"entrega", titulo:"Nueva entrega", cuerpo:'Sofía Vargas entregó "SQL Básico" (tarde)',     leida:false, timestamp:"2026-05-09T02:00:00" },
  ],
  prof2: [
    { id:"n1", tipo:"entrega", titulo:"Nueva entrega", cuerpo:'Juan Pérez entregó "Programación Funcional"',  leida:false, timestamp:"2026-05-09T08:30:00" },
    { id:"n2", tipo:"entrega", titulo:"Nueva entrega", cuerpo:'María González entregó "Prog. Funcional"',     leida:false, timestamp:"2026-05-09T22:00:00" },
  ],
  prof3: [
    { id:"n1", tipo:"entrega", titulo:"Nueva entrega", cuerpo:'Juan Pérez entregó "Config. de Router"',       leida:false, timestamp:"2026-05-10T11:00:00" },
  ],
  prof4: [
    { id:"n1", tipo:"entrega", titulo:"Nueva entrega", cuerpo:'Carlos Ramírez entregó "Lógica Proposicional"', leida:false, timestamp:"2026-05-09T10:00:00" },
  ],
};

// ── Persistencia de sesión ────────────────────────────────

const _USER_KEY = "xahni_session_user";

/**
 * @interaction save-user-state
 * @scope state-persistencia
 *
 * Given `APP.user` cambió (login, patch, addXP, racha, etc.).
 * When cualquier módulo invoca `saveUserState()` tras la mutación.
 * Then escribe `JSON.stringify(APP.user)` en
 *   `localStorage[xahni_session_user]`. Es la canónica para que la
 *   sesión sobreviva al refresh — `_tryRestoreSession` la lee al
 *   bootstrap del modo demo.
 * Edge:
 *   - `APP.user` null (logout en curso) → no escribe (preserva la
 *     última sesión hasta que `clearUserState` la borre).
 *   - localStorage lleno o bloqueado → la excepción propaga al
 *     caller (en práctica nunca ocurre con un objeto user típico).
 *
 * Guarda APP.user en localStorage.
 * Llamar siempre que cambie cualquier campo del usuario.
 */
function saveUserState() {
    if (APP.user) {
        localStorage.setItem(_USER_KEY, JSON.stringify(APP.user));
    }
}

/**
 * @interaction load-user-state
 * @scope state-persistencia
 *
 * Given el bootstrap demo (`_tryRestoreSession`) o cualquier flujo
 *   que necesite recuperar la sesión persistida.
 * When se invoca `loadUserState()`.
 * Then lee `localStorage[xahni_session_user]`, lo parsea como JSON
 *   y devuelve el objeto. Si no hay key o JSON malformado retorna
 *   `null` — el caller decide si arranca login limpio o sesión vieja.
 * Edge:
 *   - key ausente → retorna null.
 *   - JSON corrupto (manual edit, browser fail) → catch retorna
 *     null sin crash (defense en profundidad).
 *
 * Carga el usuario guardado. Devuelve el objeto o null si no existe.
 */
function loadUserState() {
    try {
        const raw = localStorage.getItem(_USER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

/**
 * @interaction clear-user-state
 * @scope state-persistencia
 *
 * Given el usuario cerró sesión (`handleLogout`) o hay reset
 *   programático (debug, test).
 * When `handleLogout` lo invoca tras anular `APP.user`.
 * Then remueve la key `xahni_session_user` de localStorage. El
 *   próximo bootstrap NO restaurará sesión.
 * Edge:
 *   - key inexistente → `localStorage.removeItem` es no-op (idempotente).
 *   - NO toca `xahni.profParcialActivo` ni `xahni.alumnoParcialActivo`
 *     ni `xahni_top3_maestria_*` ni otras keys del repo (intencional:
 *     son preferencias UI, no sesión).
 *
 * Elimina la sesión guardada (logout).
 */
function clearUserState() {
    localStorage.removeItem(_USER_KEY);
}

/**
 * @interaction patch-user-state
 * @scope state-persistencia
 *
 * Given la sesión está activa (`APP.user` no null) y un módulo
 *   quiere mutar campos puntuales sin reescribir todo el objeto.
 * When se llama `patchUserState({ nombre, puntos, avatar, ... })`.
 * Then `Object.assign(APP.user, changes)` aplica el patch shallow
 *   sobre `APP.user` y persiste con `saveUserState`.
 * Edge:
 *   - `APP.user` null → early return (no crash, no persiste basura).
 *   - patch con keys que no existían → se agregan (Object.assign).
 *   - patch con `null` o `undefined` en un campo → lo sobreescribe.
 *   - shallow only: si `changes.gamer = {...}` reemplaza el objeto
 *     entero `gamer`, no merge profundo (caller debe hacer el spread).
 *
 * Aplica un patch parcial a APP.user y lo persiste.
 * Uso: patchUserState({ nombre: "Ana López", puntos: 1300 })
 */
function patchUserState(changes) {
    if (!APP.user) return;
    Object.assign(APP.user, changes);
    saveUserState();
}

/**
 * @interaction add-xp
 * @scope state-gamificacion-xp-racha
 *
 * Given la sesión está activa y un evento de gamificación
 *   premia al usuario (entregar tarea, racha milestone, completar
 *   competencia, kudos recibido, etc.).
 * When el módulo correspondiente llama `addXP(cantidad)`.
 * Then suma `cantidad` a `APP.user.puntos`, recalcula `nivel`
 *   (`floor(puntos/500) + 1`), persiste, y si el nivel subió:
 *   - 600ms después dispara toast verde "🎉 ¡Subiste al nivel N!".
 *   - Si `agregarNotificacion` está cargado, agrega una entrada
 *     tipo "nivel" al panel con los XP acumulados.
 *   Retorna los nuevos puntos totales.
 * Edge:
 *   - `APP.user` null (logout race) → retorna 0 sin tocar nada.
 *   - `APP.user.puntos` undefined → arranca desde 0 (||).
 *   - `cantidad` negativa → resta (uso válido para penalty, aunque
 *     no documentado en producto; el cálculo de nivel funciona igual).
 *   - `agregarNotificacion` no cargado → omite la entrada al panel
 *     pero el toast SÍ se muestra.
 *   - El delay 600ms permite que la UI primaria del evento termine
 *     antes del feedback de nivel (no se solapan toasts).
 *
 * Suma puntos XP al usuario activo y persiste.
 * Retorna los nuevos puntos totales.
 */
function addXP(cantidad) {
    if (!APP.user) return 0;
    APP.user.puntos = (APP.user.puntos || 0) + cantidad;
    // Subida de nivel: cada 500 XP = 1 nivel
    const nuevoNivel = Math.floor(APP.user.puntos / 500) + 1;
    const subioNivel = nuevoNivel > APP.user.nivel;
    APP.user.nivel = nuevoNivel;
    saveUserState();
    if (subioNivel) {
        setTimeout(() => {
            showToast(`🎉 ¡Subiste al nivel ${nuevoNivel}!`, "success");
            if (typeof agregarNotificacion === "function") {
                agregarNotificacion("nivel", `¡Subiste al nivel ${nuevoNivel}!`, `Llevas ${APP.user.puntos.toLocaleString()} XP acumulados`);
            }
        }, 600);
    }
    return APP.user.puntos;
}

/**
 * @interaction actualizar-racha
 * @scope state-gamificacion-xp-racha
 *
 * Given la sesión recién se restauró (login o `_tryRestoreSession`)
 *   y `APP.user` está hidratado.
 * When `auth.js` lo invoca tras setear `APP.user` (en handleLogin,
 *   pickDemoUser, _firebaseLogin y _tryRestoreSession).
 * Then compara `APP.user.ultimaActividad` (ISO "YYYY-MM-DD") con la
 *   fecha de hoy. Tres casos:
 *   - ultima === hoy → no-op (ya se registró).
 *   - diff === 1 día → incrementa `racha` (+1) — continuidad.
 *   - diff > 1 día → reinicia `racha` a 1 — racha rota.
 *   - sin `ultimaActividad` previa → arranca racha en 1.
 *   Persiste con `saveUserState` y, si la racha cayó en milestone
 *   `[3, 7, 14, 30]`, otorga `racha * 10` XP bonus vía `addXP`,
 *   muestra toast "🔥 ¡N días de racha! +X XP bonus" (delay 800ms)
 *   y agrega entrada al panel de notificaciones si está cargado.
 * Edge:
 *   - `APP.user` null → early return sin tocar nada.
 *   - `APP.user.racha` undefined → arranca en 0 antes del +1 (||).
 *   - cambio de timezone del usuario → puede afectar el cálculo
 *     diff (deuda menor: comparación es por string fecha local,
 *     no UTC; post-migración mejor a timestamps server-side).
 *   - milestone 30 → bonus 300 XP. Milestones más allá no premian
 *     (intencional: producto fija el set [3,7,14,30]).
 *
 * Actualiza la racha del estudiante.
 * Llámala al inicio de cada sesión (después de restaurar APP.user).
 * - Si ya jugó hoy: no hace nada.
 * - Si jugó ayer: incrementa la racha.
 * - Si pasó más de 1 día: reinicia la racha a 1.
 */
function actualizarRacha() {
    if (!APP.user) return;

    const hoy      = new Date().toISOString().split("T")[0];   // "2026-05-08"
    const ultima   = APP.user.ultimaActividad || null;

    if (ultima === hoy) return;  // Ya se registró hoy

    if (ultima) {
        const diff = Math.round(
            (new Date(hoy) - new Date(ultima)) / (1000 * 60 * 60 * 24)
        );
        APP.user.racha = diff === 1 ? (APP.user.racha || 0) + 1 : 1;
    } else {
        APP.user.racha = 1;
    }

    APP.user.ultimaActividad = hoy;
    saveUserState();

    // Milestone de racha: bonus de XP
    const racha = APP.user.racha;
    if ([3, 7, 14, 30].includes(racha)) {
        const bonus = racha * 10;
        addXP(bonus);
        setTimeout(() => {
            showToast(`🔥 ¡${racha} días de racha! +${bonus} XP bonus`, "success");
            if (typeof agregarNotificacion === "function") {
                agregarNotificacion("racha", `¡${racha} días de racha!`, `+${bonus} XP bonus acreditados`);
            }
        }, 800);
    }
}

// ── Hidratación parcial activo desde localStorage ─────────
// CONSERVADO 2026-05-23: parcial activo cross-tabs (Pieza D, Phase 2)
try {
    const profPa  = localStorage.getItem("xahni.profParcialActivo");
    if (profPa) APP.profParcialActivo = JSON.parse(profPa);
    const alumnoPa = localStorage.getItem("xahni.alumnoParcialActivo");
    if (alumnoPa) APP.alumnoParcialActivo = JSON.parse(alumnoPa);
} catch (e) {
    console.warn("[XAHNI] localStorage parcial activo corrupto, reset.", e);
    APP.profParcialActivo   = {};
    APP.alumnoParcialActivo = {};
}
