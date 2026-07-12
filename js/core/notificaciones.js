// ═══════════════════════════════════════════════════════════
// NOTIFICACIONES — Sistema completo con persistencia
// ═══════════════════════════════════════════════════════════

const _NOTIF_KEY    = "xahni_notificaciones";
const _NOTIF_MAX    = 50;   // máximo de notifs almacenadas
let   _panelAbierto = false;

// ── Tipos predefinidos ────────────────────────────────────
const NOTIF_TIPOS = {
    tarea:    { icono: "✅", color: "var(--xahni-teal)"   },
    archivo:  { icono: "📎", color: "var(--xahni-cyan)"   },
    recurso:  { icono: "📥", color: "var(--xahni-blue)"   },
    xp:       { icono: "⚡", color: "var(--xahni-amber)"  },
    nivel:    { icono: "⬆️", color: "var(--xahni-purple)" },
    racha:    { icono: "🔥", color: "var(--xahni-red)"    },
    kudo:     { icono: "💬", color: "var(--xahni-green)"  },
    alerta:   { icono: "⚠️", color: "var(--xahni-amber)"  },
    info:     { icono: "ℹ️", color: "var(--text-muted)"   },
    riesgo:   { icono: "⚠️", color: "var(--xahni-red)"    },
};

// ── Persistencia ──────────────────────────────────────────

/**
 * @interaction load-notificaciones
 * @scope notificaciones-persistencia
 *
 * Given el módulo necesita leer la cola actual de notificaciones
 *   del usuario (al renderizar panel, agregar, eliminar, etc.).
 * When cualquier helper interno lo invoca.
 * Then lee `localStorage[xahni_notificaciones]`, lo parsea como
 *   JSON y devuelve el array. Si no hay key o JSON malformado
 *   retorna `[]` — fail-soft.
 * Edge:
 *   - key ausente → array vacío (estado inicial del usuario).
 *   - JSON corrupto → catch retorna `[]` sin crash.
 *   - el array está cap-eado en `_NOTIF_MAX` (50) por
 *     `agregarNotificacion`; aquí solo se lee.
 */
function _loadNotificaciones() {
    try {
        const raw = localStorage.getItem(_NOTIF_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

/**
 * @interaction save-notificaciones
 * @scope notificaciones-persistencia
 *
 * Given un array de notificaciones recién mutado (add, mark-read,
 *   eliminar).
 * When el helper que mutó la cola persiste el resultado.
 * Then escribe `JSON.stringify(data)` en `localStorage[xahni_notificaciones]`,
 *   sobreescribiendo todo el array.
 * Edge:
 *   - localStorage lleno → la excepción propaga (poco probable
 *     con cap de 50 entries).
 *   - data NO es array → JSON serializa lo que sea, pero
 *     `_loadNotificaciones` espera array; los callers siempre
 *     pasan array (ver agregar/marcar/eliminar).
 */
function _saveNotificaciones(data) {
    localStorage.setItem(_NOTIF_KEY, JSON.stringify(data));
}

/**
 * @interaction seed-notificaciones-if-empty
 * @scope notificaciones-seed
 *
 * Given el usuario abrió sesión por primera vez (o eliminó
 *   manualmente `localStorage[xahni_notificaciones]`) y el seed
 *   global `DEMO_NOTIFICACIONES_SEED[uid]` está disponible.
 * When `generarNotificacionesAuto` lo invoca como primer paso.
 * Then si la cola actual está vacía y el seed para `uid` existe,
 *   persiste el array seed completo vía `_saveNotificaciones` y
 *   refresca el badge. Si la cola ya tiene items o el seed no
 *   está disponible, no-op.
 * Edge:
 *   - `uid` undefined/null → no-op (no se puede seedear sin uid).
 *   - `DEMO_NOTIFICACIONES_SEED` no cargado (data-service todavía
 *     resolving) → no-op silencioso, próximo login lo recoge.
 *   - cola NO vacía → no-op (preserva el estado del usuario, NO
 *     re-seedea cada login).
 *   - **DEUDA**: seed es VISUAL solamente. Los disparadores reales
 *     (tareas próximas, alumnos en riesgo derivados de promedios,
 *     etc.) viven en triggers backend post-Supabase.
 */
function _seedNotificacionesIfEmpty(uid) {
    if (!uid) return;
    if (typeof DEMO_NOTIFICACIONES_SEED !== "object" || !DEMO_NOTIFICACIONES_SEED) return;
    const seed = DEMO_NOTIFICACIONES_SEED[uid];
    if (!Array.isArray(seed) || !seed.length) return;
    const current = _loadNotificaciones();
    if (current.length) return;  // no re-seedear si el usuario tiene cola
    _saveNotificaciones(seed);
    _actualizarBadge();
}

// ── API pública ───────────────────────────────────────────

/**
 * @interaction agregar-notificacion
 * @scope notificaciones-public-api
 *
 * Given un evento del producto que merece avisar al usuario:
 *   tarea calificada, XP ganado, nivel subido, racha, recurso
 *   nuevo, prórroga, etc. Cualquier módulo lo dispara.
 * When el módulo invoca `agregarNotificacion(tipo, titulo, desc)`.
 * Then valida el toggle de configuración del usuario
 *   (`configNotifActiva()` si está cargado — early return cuando
 *   false), lee la cola actual, hace `unshift` del nuevo item con
 *   `{ id: Date.now(), tipo, titulo, desc, fecha: now, leida: false }`,
 *   trunca a `_NOTIF_MAX` (50) entradas y persiste con
 *   `_saveNotificaciones`. Actualiza badge y, si el panel está
 *   abierto, lo re-renderiza en vivo.
 * Edge:
 *   - `tipo` inexistente en `NOTIF_TIPOS` → fallback a "info" en
 *     `_renderPanel` (aquí se guarda tal cual el caller lo pasó).
 *   - `tipo` vacío/falsy → se persiste como "info" (|| "info").
 *   - `desc` vacío/falsy → se guarda como "" (|| "").
 *   - cola supera _NOTIF_MAX → splice descarta las más viejas
 *     (`unshift` mantiene las nuevas al principio).
 *   - `configNotifActiva` no cargado → continúa sin bloquear
 *     (defensa typeof).
 *
 * Agrega una notificación nueva.
 * @param {string} tipo   — clave de NOTIF_TIPOS
 * @param {string} titulo — texto corto (50 chars max)
 * @param {string} desc   — detalle opcional
 */
function agregarNotificacion(tipo, titulo, desc) {
    if (typeof configNotifActiva === "function" && !configNotifActiva()) return;
    const data = _loadNotificaciones();
    data.unshift({
        id:     Date.now(),
        tipo:   tipo || "info",
        titulo: titulo,
        desc:   desc  || "",
        fecha:  new Date().toISOString(),
        leida:  false,
    });
    // Mantener el límite máximo
    if (data.length > _NOTIF_MAX) data.splice(_NOTIF_MAX);
    _saveNotificaciones(data);
    _actualizarBadge();
    // Si el panel está abierto, refrescar en vivo
    if (_panelAbierto) _renderPanel();
}

/**
 * @interaction marcar-todas-leidas
 * @scope notificaciones-public-api
 *
 * Given hay notificaciones sin leer (`leida: false`) y el usuario
 *   hace click en "Marcar todas como leídas" del panel.
 * When el handler del botón lo invoca.
 * Then mapea la cola actual seteando `leida: true` en todas,
 *   persiste, actualiza el badge (debe quedar oculto/0) y
 *   re-renderiza el panel para reflejar el estado.
 * Edge:
 *   - cola vacía → mapeo es no-op pero igual persiste `[]` y
 *     ejecuta los re-renders (idempotente).
 *   - notificación nueva entra después → vuelve a marcar el badge
 *     vía `_actualizarBadge`.
 *   - NO dispatcheado externamente: actualmente uso interno del
 *     toggle abrir-panel (auto-mark en 600ms).
 */
function _marcarTodasLeidas() {
    const data = _loadNotificaciones().map(n => ({ ...n, leida: true }));
    _saveNotificaciones(data);
    _actualizarBadge();
    _renderPanel();
}

/**
 * @interaction eliminar-notificacion
 * @scope notificaciones-public-api
 *
 * Given el panel está renderizado y el usuario hace click en la
 *   `<button class="notif-item-cerrar">` (✕) de un item.
 * When `_renderPanel` cabló `onclick="...;_eliminarNotificacion(id)"`
 *   y el click dispara con `event.stopPropagation()`.
 * Then filtra la cola excluyendo el item con `id` matching,
 *   persiste, actualiza badge (recalcula no-leídas) y re-renderiza
 *   el panel.
 * Edge:
 *   - id no existe en la cola → filter es no-op (idempotente).
 *   - id es timestamp (Date.now) por convención de `agregarNotificacion`
 *     o un id externo cualquiera del seed JSON.
 *   - panel cerrado mientras se elimina (programático) → `_renderPanel`
 *     no-op si `#notif-lista` no existe.
 */
function _eliminarNotificacion(id) {
    const data = _loadNotificaciones().filter(n => n.id !== id);
    _saveNotificaciones(data);
    _actualizarBadge();
    _renderPanel();
}

// ── Badge ─────────────────────────────────────────────────

/**
 * @interaction actualizar-badge
 * @scope notificaciones-badge
 *
 * Given existen los elementos `#notif-badge` (contador) y/o
 *   `#notif-dot` (indicador discreto) en la cabecera.
 * When cualquier mutación de la cola termina (agregar, marcar,
 *   eliminar) o al DOMContentLoaded inicial.
 * Then calcula `noLeidas` (count de items con `leida: false`),
 *   setea `badge.textContent` a `"9+"` si supera 9, sino al número.
 *   Muestra el badge sólo si hay no-leídas (`display: flex`/`none`),
 *   y el dot análogamente (`block`/`none`).
 * Edge:
 *   - `#notif-badge` no en DOM → omite ese update pero igual procesa dot.
 *   - `#notif-dot` no en DOM → omite ese update pero igual procesa badge.
 *   - noLeidas === 0 → badge oculto vía display:none (NO removeChild).
 *   - cola con 50 items todos no-leídos → muestra "9+".
 */
function _actualizarBadge() {
    const badge   = document.getElementById("notif-badge");
    const dot     = document.getElementById("notif-dot");
    const noLeidas = _loadNotificaciones().filter(n => !n.leida).length;

    if (badge) {
        badge.textContent   = noLeidas > 9 ? "9+" : noLeidas;
        badge.style.display = noLeidas > 0 ? "flex" : "none";
    }
    if (dot) {
        dot.style.display = noLeidas > 0 ? "block" : "none";
    }
}

// ── Panel desplegable ─────────────────────────────────────

/**
 * @interaction toggle-notif-panel
 * @scope notificaciones-panel
 *
 * Given existe `#notif-panel` en el DOM (cabecera del shell) y el
 *   usuario hace click en `#notif-btn` (campana).
 * When el handler del botón lo invoca.
 * Then toggle `_panelAbierto`. Al abrir: renderiza el panel
 *   primero (`_renderPanel`), agrega clase `.open` (anima),
 *   y 600ms después marca silenciosamente todas las notifs como
 *   leídas + actualiza badge (UX: el usuario ve un instante el
 *   estado "nueva" antes del fade). Al cerrar: remueve `.open`.
 *   El listener global `document.click` cierra el panel cuando
 *   se hace click fuera de `#notif-panel` y `#notif-btn`.
 * Edge:
 *   - `#notif-panel` ausente → early return sin error.
 *   - panel cerrado por click outside → resetea `_panelAbierto`
 *     pero NO marca como leídas (intencional: cerrar sin abrir
 *     no debe consumir notifs).
 *   - doble click rápido → el `_panelAbierto` toggle es atómico
 *     (no hay race con el setTimeout 600ms; mark-as-read corre
 *     siempre, aún si el panel se cerró antes del timeout).
 */
function toggleNotifPanel() {
    const panel = document.getElementById("notif-panel");
    if (!panel) return;
    _panelAbierto = !_panelAbierto;
    if (_panelAbierto) {
        _renderPanel();
        panel.classList.add("open");
        // Marcar como leídas al abrir (después de renderizar para mostrar el estado)
        setTimeout(() => {
            const data = _loadNotificaciones().map(n => ({ ...n, leida: true }));
            _saveNotificaciones(data);
            _actualizarBadge();
        }, 600);
    } else {
        panel.classList.remove("open");
    }
}

// Cerrar al hacer clic fuera
document.addEventListener("click", (e) => {
    if (!_panelAbierto) return;
    const panel = document.getElementById("notif-panel");
    const btn   = document.getElementById("notif-btn");
    const hubBell = document.getElementById("hub-cluster-bell");
    const isOnBtn = (btn && btn.contains(e.target)) || (hubBell && hubBell.contains(e.target));
    if (panel && !panel.contains(e.target) && !isOnBtn) {
        panel.classList.remove("open");
        _panelAbierto = false;
    }
});

// ── Renderizado del panel ─────────────────────────────────

/**
 * @interaction tiempo-relativo
 * @scope notificaciones-render-helper
 *
 * Given un timestamp ISO 8601 (`fecha` de cada notificación,
 *   generado por `agregarNotificacion` con `new Date().toISOString()`
 *   o seedeado en `DEMO_NOTIFICACIONES`).
 * When `_renderPanel` necesita formatear cada item.
 * Then calcula diff vs `Date.now()` y devuelve un label legible:
 *   - <1 min → "Ahora mismo"
 *   - <60 min → "Hace N min"
 *   - <24 h → "Hace Nh"
 *   - 1 día → "Ayer"
 *   - <7 días → "Hace N días"
 *   - ≥7 días → fecha corta "DD MMM" en es-MX (`toLocaleDateString`).
 * Edge:
 *   - isoStr en el futuro → diff negativo → Math.floor da valores
 *     negativos pero el primer branch `< 1` los captura como
 *     "Ahora mismo" (defensa visual).
 *   - isoStr inválido → `new Date(invalid)` → diff es NaN, todos
 *     los branches fallan, cae al fecha-corta que muestra
 *     "Invalid Date" (deuda menor, no crash).
 */
function _tiempoRelativo(isoStr) {
    const diff  = Date.now() - new Date(isoStr).getTime();
    const mins  = Math.floor(diff / 60000);
    const horas = Math.floor(diff / 3600000);
    const dias  = Math.floor(diff / 86400000);
    if (mins  < 1)   return "Ahora mismo";
    if (mins  < 60)  return `Hace ${mins} min`;
    if (horas < 24)  return `Hace ${horas}h`;
    if (dias  === 1) return "Ayer";
    if (dias  < 7)   return `Hace ${dias} días`;
    return new Date(isoStr).toLocaleDateString("es-MX", { day:"2-digit", month:"short" });
}

/**
 * @interaction agrupar-por-dia
 * @scope notificaciones-render-helper
 *
 * Given la cola de notificaciones leída desde localStorage.
 * When `_renderPanel` necesita las secciones agrupadas para
 *   renderizar headers de fecha entre items.
 * Then itera el array y reparte cada item en uno de 4 buckets:
 *   - "Hoy" (fecha === hoy)
 *   - "Ayer" (fecha === ayer)
 *   - "Esta semana" (≤7 días)
 *   - "Anteriores" (>7 días)
 *   Devuelve el objeto con las 4 keys en orden de inserción (que
 *   `Object.entries` respeta y `_renderPanel` aprovecha).
 * Edge:
 *   - cola vacía → retorna 4 arrays vacíos, `_renderPanel` omite
 *     headers sin items.
 *   - fecha futura → cae en "Anteriores" (porque diff es negativo,
 *     no entra al else-if de "Esta semana"). Deuda menor.
 *   - rango date: el corte usa `Date.now() - 7*86400000` en
 *     milisegundos, NO compara strings de fecha — soporta horas.
 */
function _agruparPorDia(data) {
    const hoy    = new Date().toISOString().split("T")[0];
    const ayer   = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const grupos = { "Hoy": [], "Ayer": [], "Esta semana": [], "Anteriores": [] };
    data.forEach(n => {
        const dia = n.fecha.split("T")[0];
        if      (dia === hoy)  grupos["Hoy"].push(n);
        else if (dia === ayer) grupos["Ayer"].push(n);
        else if ((Date.now() - new Date(n.fecha)) < 7 * 86400000)
                               grupos["Esta semana"].push(n);
        else                   grupos["Anteriores"].push(n);
    });
    return grupos;
}

/**
 * @interaction render-panel
 * @scope notificaciones-render
 *
 * Given existe `#notif-panel` con la estructura `.xn-panel` (wrapper +
 *   .xn-header + .xn-lista + .xn-footer) en el DOM, y el panel se abrió
 *   o mutó mientras está abierto.
 * When `toggleNotifPanel` (abrir), `agregarNotificacion`,
 *   `_marcarTodasLeidas` o `_eliminarNotificacion` lo invocan.
 * Then setea `data-rol` y `data-gamer` en el wrapper `.xn-panel` desde
 *   `APP.user.tipo` y `body.gamer-off` respectivamente. Luego renderiza:
 *   - Header con title gradient + chip de unread count + botón "Marcar todas".
 *   - `.xn-urgente-strip` SOLO si role==='profesor' Y hay items tipo 'riesgo'
 *     no leídos (CSS lo oculta para alumno como guard redundante).
 *   - Lista agrupada por día via `_agruparPorDia`, con sep-dia sticky.
 *   - Cada item con icono + body + type-chip + tiempo + botón cerrar ✕.
 *   - Footer con 3 tabs estáticos (Todas / No leídas / Importantes) —
 *     visual placeholder; lógica de filtrado vive post-Supabase.
 *   - Estado vacío `.xn-empty` si la cola está vacía.
 * Edge:
 *   - `#notif-panel` ausente → early return.
 *   - `APP.user` ausente → role default `'alumno'`, sin urgente-strip.
 *   - tipo no en `NOTIF_TIPOS` → fallback `info`.
 *   - **DEUDA XSS**: `n.titulo`/`n.desc` se inyectan via innerHTML sin
 *     escape (carry-over del módulo legacy). Strings vienen de
 *     `agregarNotificacion` interno + seeds controlados. Si entran flujos
 *     con input arbitrario del usuario → escapar.
 *   - **DEUDA tabs footer**: los 3 tabs (Todas/No leídas/Importantes) son
 *     visual-only. La lógica de filtrar la lista vive post-Supabase.
 */
function _renderPanel() {
    const panel = document.getElementById("notif-panel");
    if (!panel) return;

    const rawRole = (typeof APP !== "undefined" && APP.user && APP.user.tipo) ? APP.user.tipo : "alumno";
    // Normalizar: APP.user.tipo puede ser 'estudiante' o 'alumno'; CSS scope usa 'alumno'/'profesor'.
    const role = (rawRole === "estudiante" || rawRole === "alumno") ? "alumno" : rawRole;
    const gamerOff = document.body.classList.contains("gamer-off");
    panel.setAttribute("data-rol", role);
    panel.setAttribute("data-gamer", gamerOff ? "off" : "on");

    const data = _loadNotificaciones();
    const noLeidas = data.filter(n => !n.leida).length;
    const titleText = role === "profesor" ? "Alertas" : "Notificaciones";

    // Header
    const headerHtml = `
      <div class="xn-header">
        <div class="xn-bell-wrap">
          <svg class="x-icon"><use href="#x-icon-bell"></use></svg>
        </div>
        <div class="xn-header__title">${titleText}</div>
        <div class="xn-header__actions">
          ${noLeidas > 0 ? `<span class="x-chip x-chip--brand xn-unread-badge">${noLeidas} ${noLeidas === 1 ? "nueva" : "nuevas"}</span>` : ""}
          <button class="xn-mark-all" onclick="_marcarTodasLeidas()" title="Marcar todas como leídas">Marcar todas</button>
        </div>
      </div>
    `;

    // Urgente strip (profesor only, deriva de items tipo 'riesgo' no leídos)
    let urgenteHtml = "";
    if (role === "profesor") {
        const riesgos = data.filter(n => n.tipo === "riesgo" && !n.leida);
        if (riesgos.length) {
            const first = riesgos[0];
            urgenteHtml = `
              <div class="xn-urgente-strip">
                <div class="xn-urgente-strip__icon">
                  <svg class="x-icon"><use href="#x-icon-warn"></use></svg>
                </div>
                <div class="xn-urgente-strip__body">
                  <div class="xn-urgente-strip__title">${first.titulo.toUpperCase()}</div>
                  <div class="xn-urgente-strip__desc">${first.desc || ""}</div>
                </div>
              </div>
            `;
        }
    }

    // Lista (agrupada por día) o empty
    let listaInner = "";
    if (!data.length) {
        listaInner = `
          <div class="xn-empty">
            <div style="font-size:28px;margin-bottom:8px">🔔</div>
            <div style="font-size:13px">Sin notificaciones</div>
          </div>`;
    } else {
        const grupos = _agruparPorDia(data);
        Object.entries(grupos).forEach(([label, items]) => {
            if (!items.length) return;
            listaInner += `
              <div class="xn-sep-dia">
                <span class="xn-sep-dia__label">${label}</span>
                <span class="xn-sep-dia__line"></span>
              </div>
            `;
            listaInner += items.map(n => {
                const tipo = NOTIF_TIPOS[n.tipo] || NOTIF_TIPOS.info;
                const tipoLabel = n.tipo || "info";
                const chipCls = `xn-chip-${
                    n.tipo === "tarea" || n.tipo === "alerta" ? "tarea" :
                    n.tipo === "riesgo" ? "peligro" :
                    n.tipo === "xp" ? "xp" :
                    n.tipo === "nivel" ? "nivel" :
                    n.tipo === "racha" ? "racha" :
                    "info"
                }`;
                const gamifCls = (n.tipo === "xp" || n.tipo === "nivel") ? " xn-item--gamif" : "";
                return `
                  <div class="xn-item${gamifCls}" id="notif-${n.id}">
                    <div class="xn-item__icon" style="background:${tipo.color}18;color:${tipo.color}">
                      ${tipo.icono}
                    </div>
                    <div class="xn-item__body">
                      <div class="xn-item__titulo">${n.titulo}</div>
                      ${n.desc ? `<div class="xn-item__desc">${n.desc}</div>` : ""}
                      <div class="xn-item__meta">
                        <span class="xn-item__tiempo">${_tiempoRelativo(n.fecha)}</span>
                        <span class="xn-item__type-chip ${chipCls}">${tipoLabel}</span>
                      </div>
                    </div>
                    <button class="xn-item__cerrar"
                            onclick="event.stopPropagation();_eliminarNotificacion(${n.id})"
                            title="Eliminar">✕</button>
                  </div>
                `;
            }).join("");
        });
    }

    // Footer (3 tabs estáticos · deuda funcional post-Supabase)
    const footerHtml = `
      <div class="xn-footer">
        <button class="xn-tab is-active">Todas</button>
        <button class="xn-tab">No leídas</button>
        <button class="xn-tab">Importantes</button>
      </div>
    `;

    panel.innerHTML = headerHtml + urgenteHtml + `<div id="notif-lista" class="xn-lista">${listaInner}</div>` + footerHtml;
}

// ── Auto-notificaciones al iniciar sesión ─────────────────

/**
 * @interaction generar-notificaciones-auto
 * @scope notificaciones-auto-trigger
 *
 * Given la sesión recién se restauró (login fresco o
 *   `_tryRestoreSession`) y `APP.user` está hidratado.
 * When `auth.js` (handleLogin / pickDemoUser / _firebaseLogin /
 *   _tryRestoreSession) lo invoca después de setear `APP.user`.
 * Then deduplica con `localStorage[xahni_notif_autocheck]` (formato
 *   ISO "YYYY-MM-DD"): si ya corrió hoy, sólo refresca el badge.
 *   Si no:
 *   - Lee `xahni_tareas` de localStorage, filtra `estado === "pendiente"`
 *     con `diasRestantes` ∈ [0, 2] y agrega una notif tipo "alerta"
 *     por cada una con texto "vence hoy" / "vence en N día(s)".
 *   - Lee `xahni_recursos`, si hay items con `nuevo: true` agrega
 *     UN aviso agrupado "N recurso(s) nuevo(s) disponible(s)" con
 *     los nombres concatenados en `desc`.
 *   - Refresca badge.
 * Edge:
 *   - Mismo día ya disparó → solo `_actualizarBadge` (no duplica
 *     notifs por refrescos múltiples del día).
 *   - localStorage `xahni_tareas` / `xahni_recursos` no existe o
 *     JSON corrupto → try/catch swallow, sigue con la siguiente fuente.
 *   - Sin tareas urgentes ni recursos nuevos → solo refresca badge.
 *   - Sweep 2026-06-08: refactor para leer DEMO_TAREAS / DEMO_RECURSOS en
 *     lugar de las keys legacy `xahni_tareas` / `xahni_recursos` que nadie
 *     escribía. Las tareas "pendientes para el alumno" se derivan de la
 *     ausencia de entrega del uid en `t.entregas`. Los "recursos nuevos"
 *     se derivan comparando ids contra `xahni_recursos_vistos_{uid}`.
 *
 * Llama esto justo después de restaurar la sesión (en auth.js).
 * Genera alertas por tareas próximas a vencer y recursos nuevos.
 */
function generarNotificacionesAuto() {
    // Seedear desde DEMO si la cola está vacía (first-time per uid)
    if (typeof APP !== "undefined" && APP.user && APP.user.id) {
        _seedNotificacionesIfEmpty(APP.user.id);
    }

    // Solo una vez por día
    const hoy = new Date().toISOString().split("T")[0];
    const ultima = localStorage.getItem("xahni_notif_autocheck");
    if (ultima === hoy) { _actualizarBadge(); return; }
    localStorage.setItem("xahni_notif_autocheck", hoy);

    const uid = (typeof APP !== "undefined" && APP.user) ? APP.user.id : null;
    const esEstudiante = (typeof APP !== "undefined" && APP.user && APP.user.tipo === "estudiante");
    if (!uid) { _actualizarBadge(); return; }

    // ── Tareas próximas a vencer (≤ 2 días) ──
    // Aplica solo a estudiante: derivamos de DEMO_TAREAS las que NO tiene
    // entrega y la fechaEntrega cae entre hoy y hoy+2 días.
    if (esEstudiante && typeof DEMO_TAREAS !== "undefined") {
        try {
            const ahora = new Date();
            const limite = new Date(ahora.getTime() + 2 * 24 * 60 * 60 * 1000);
            const misMaterias = (APP.user.materias || []);
            const urgentes = DEMO_TAREAS.filter(t => {
                if (misMaterias.length && !misMaterias.includes(t.materiaId)) return false;
                const yaEntregada = (t.entregas || []).some(e => e.uid === uid);
                if (yaEntregada) return false;
                if (!t.fechaEntrega) return false;
                const fEnt = new Date(t.fechaEntrega);
                return fEnt >= ahora && fEnt <= limite;
            });
            urgentes.forEach(t => {
                const dias = Math.max(0, Math.ceil((new Date(t.fechaEntrega) - ahora) / (24 * 60 * 60 * 1000)));
                const texto = dias === 0 ? "vence hoy"
                    : `vence en ${dias} día${dias > 1 ? "s" : ""}`;
                const matNombre = (typeof DEMO_MATERIAS !== "undefined")
                    ? (DEMO_MATERIAS.find(m => m.id === t.materiaId)?.nombre || t.materiaId)
                    : t.materiaId;
                agregarNotificacion(
                    "alerta",
                    "Tarea próxima a vencer",
                    `"${t.titulo}" (${matNombre}) — ${texto}`
                );
            });
        } catch (e) { /* defensive */ }
    }

    // ── Recursos nuevos sin descargar ──
    // Derivar de DEMO_RECURSOS los ids que NO están en xahni_recursos_vistos_{uid}.
    if (esEstudiante && typeof DEMO_RECURSOS !== "undefined") {
        try {
            let vistos = [];
            try {
                const raw = localStorage.getItem("xahni_recursos_vistos_" + uid);
                vistos = raw ? JSON.parse(raw) : [];
            } catch (_) { /* defensive */ }
            const misMaterias = (APP.user.materias || []);
            const nuevos = DEMO_RECURSOS.filter(r => {
                if (misMaterias.length && !misMaterias.includes(r.materiaId)) return false;
                const key = String(r.id);
                const keyCompuesta = uid + "::" + r.id;
                return !vistos.includes(key) && !vistos.includes(keyCompuesta);
            });
            if (nuevos.length) {
                const titulo = `${nuevos.length} recurso${nuevos.length > 1 ? "s" : ""} nuevo${nuevos.length > 1 ? "s" : ""} disponible${nuevos.length > 1 ? "s" : ""}`;
                const top3 = nuevos.slice(0, 3).map(r => r.titulo).join(", ");
                const sufijo = nuevos.length > 3 ? `, +${nuevos.length - 3} más` : "";
                agregarNotificacion("recurso", titulo, top3 + sufijo);
            }
        } catch (e) { /* defensive */ }
    }

    _actualizarBadge();
}

// ── Inicializar badge al cargar ───────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    _actualizarBadge();
});