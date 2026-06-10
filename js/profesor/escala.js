// js/profesor/escala.js
// Escala de evaluación: datos, estado y builder de la vista

// Paleta de criterios: ahora vive en js/core/builders-core.js como
// `_ESCALA_COLORS` (helper `_escalaColorVar(idx)`). Se consume desde aquí
// directamente vía ese helper — sin duplicar el array.

// ── Estado de sesión (reemplaza ESCALA_DATA + PROF_MATERIAS locales) ──────────
let _escalaMaterias = [];   // [{ id, nombre, clave, color }]
let _escalaState    = {};   // { [matId]: [{ num, guardado, criterios[] }] }
let _escalaUserId   = null; // evita re-init al re-entrar a la vista

const _ESCALA_MAT_PAL = ["teal","amber","blue","purple","green","red"];
const NUM_PARCIALES   = 3;

/**
 * @interaction build-escala-materias
 * @scope profesor-escala-data-provider
 *
 * Given uid del profesor logueado.
 * When `buildEscalaEvaluacion` init y necesita la lista de materias del
 *   profesor con metadata de pintura (color paleta + periodoInfo).
 * Then itera DEMO_MATERIAS filtrado por profesorId:
 *   1. Resuelve `gid = m.grupos[0]` (primer grupo asignado).
 *   2. Resuelve periodo via `getPeriodoDeGrupo(gid)` + `getPeriodoInfo(periodo)`
 *      con typeof guards defensivos.
 *   3. Asigna color rotativo de `_ESCALA_MAT_PAL` (6 paleta cíclica) por
 *      índice de orden.
 *   4. Retorna `[{id, nombre, clave, color, periodoInfo}]`.
 * Edge:
 *   - DEMO_MATERIAS no cargado → `[]` (fallback guard inicial).
 *   - Materia sin grupos asignados → gid undefined → periodoInfo null
 *     (caller pinta segmentos con default 6 semanas estado="futuro").
 *   - `getPeriodoDeGrupo` / `getPeriodoInfo` ausentes parse-time → periodoInfo
 *     null (defensa).
 *   - **No filtra archivada** — el profesor podría querer revisar la escala
 *     de una materia archivada para histórico (asimetría consciente con
 *     getMateriasProfesor). Decisión Slice escala.
 *   - **TODO documentado**: cuando esta vista tenga selector de grupo por
 *     materia, pasar gid activo al helper (hoy primer grupo siempre).
 *   - Helper LOCAL (sin window export). Consumed por `buildEscalaEvaluacion`.
 *   - Función PURA.
 *   - Deuda post-Supabase: vista materializada con join + agg.
 */
function _buildEscalaMaterias(uid) {
  return (DEMO_MATERIAS || [])
    .filter((m) => m.profesorId === uid)
    .map((m, i) => {
      // Sin selector de grupo activo en esta vista: usar primer grupo.
      // TODO: cuando se añada selector de grupo por materia, pasar gid aquí.
      const gid = (m.grupos || [])[0];
      const periodo = (typeof getPeriodoDeGrupo === "function") ? getPeriodoDeGrupo(gid) : null;
      return {
        id:          m.id,
        nombre:      m.nombre,
        clave:       m.clave,
        color:       _ESCALA_MAT_PAL[i % _ESCALA_MAT_PAL.length],
        periodoInfo: (typeof getPeriodoInfo === "function") ? getPeriodoInfo(periodo) : null,
      };
    });
}

/**
 * @interaction build-escala-state
 * @scope profesor-escala-data-provider
 *
 * Given uid del profesor.
 * When `buildEscalaEvaluacion` init y necesita hidratar el state mutable
 *   `_escalaState[matId]` (1 array de 3 parciales por materia).
 * Then por cada materia del profesor:
 *   1. Genera array de NUM_PARCIALES (3) entries.
 *   2. Por parcial: busca en `DEMO_ESCALAS` por (materiaId × parcialNum ×
 *      creadoPor === uid).
 *   3. Si entry existe → `{num, guardado: entry.guardado, criterios: [...]}`
 *      con criterios mapeados (solo `nombre`, `pct`, `extra` — NO incluye
 *      `id`/`valorMax`/`vinculo` del DEMO source).
 *   4. Si no → `{num, guardado: false, criterios: []}`.
 *   5. Retorna map `{[matId]: [parcial1, parcial2, parcial3]}`.
 * Edge:
 *   - Sin materias → `{}` (estado vacío válido).
 *   - **CAREFUL**: el mapeo de criterios DESCARTA `id`, `valorMax`, `vinculo`,
 *     `tipo` del DEMO source. Esos campos se rellenan luego cuando el
 *     profesor edita el criterio (`abrirEditarCriterio` prepobla con
 *     defaults si vacío). **Deuda menor**: preservar todos los campos al
 *     hidratar para no perder data al re-build state.
 *   - Helper LOCAL.
 *   - Función PURA respecto a inputs.
 *   - Deuda post-Supabase: hidratación reactiva via `escalas` table query.
 */
function _buildEscalaState(uid) {
  const state = {};
  const materias = (DEMO_MATERIAS || []).filter((m) => m.profesorId === uid);
  materias.forEach((mat) => {
    state[mat.id] = Array.from({ length: NUM_PARCIALES }, (_, i) => {
      const parcialNum = i + 1;
      const entry = (DEMO_ESCALAS || []).find(
        (e) => e.materiaId === mat.id && e.parcialNum === parcialNum && e.creadoPor === uid,
      );
      return {
        num:       parcialNum,
        guardado:  entry?.guardado ?? false,
        criterios: entry
          ? (entry.criterios || []).map((c) => ({
              nombre: c.nombre,
              pct:    c.pct,
              extra:  c.extra,
            }))
          : [],
      };
    });
  });
  return state;
}

// ── Helpers puros ─────────────────────────────────────────────────────────────
let _escalaMat    = null;
let _escalaParcial = 1;
let _escalaDirty   = false;
let _editIdx       = -1;
let _escalaSnapshot     = null;
let _escalaPendingAction = null;
let _eliminarIdx   = -1;
let _eliminarConCaptura = 0; // cascade count — cuántos alumnos tienen captura para el criterio a eliminar

/**
 * @interaction escala-mark-dirty
 * @scope profesor-escala-helper-state
 *
 * Given el estado actual `_escalaMat` + `_escalaParcial` apuntando a una
 *   escala que está a punto de mutar.
 * When un handler (confirmarAgregar/EditarCriterio, confirmarEliminarCriterio,
 *   _criterioMover) está por modificar `esc.criterios`.
 * Then:
 *   1. Si NO había dirty previo → snapshot deep clone del estado actual:
 *      `{mat, parcial, criterios: JSON.parse(JSON.stringify(esc.criterios))}`.
 *      Esto permite el rollback via `descartarCambiosEscala`.
 *   2. Setea `_escalaDirty = true` (activa botón "Guardar escala" + bloquea
 *      switch materia/parcial sin confirmar).
 * Edge:
 *   - **Idempotente**: snapshot solo la PRIMERA vez. Múltiples ediciones
 *     consecutivas snapshot solo el estado inicial pre-cambios. Decisión
 *     consciente: descartar regresa al estado guardado, no al penúltimo.
 *   - Sin escala activa (matId no resuelve) → no snapshot pero sí dirty=true
 *     (corner case raro: handler corriendo sin selección).
 *   - **Deep clone via JSON.parse(JSON.stringify)** — pierde funciones, Dates,
 *     undefined. Criterios son shape plano serializable → OK.
 *   - Helper LOCAL (sin window export).
 *   - Función IMPURA (muta `_escalaDirty` + `_escalaSnapshot` module-scope).
 *   - Deuda post-Supabase: dirty tracking en transactional state via
 *     optimistic update + rollback en caso de error.
 */
function _escalaMarkDirty() {
  if (!_escalaDirty) {
    const esc = _escalaState[_escalaMat]?.[_escalaParcial - 1];
    if (esc) {
      _escalaSnapshot = {
        mat:      _escalaMat,
        parcial:  _escalaParcial,
        criterios: JSON.parse(JSON.stringify(esc.criterios)),
      };
    }
  }
  _escalaDirty = true;
}

/**
 * @interaction escala-can-edit
 * @scope profesor-escala-helper-gate
 *
 * Given el estado `_escalaMat`.
 * When `_buildEscalaCriterios` decide si pintar los botones de acción
 *   (Agregar / Editar / Eliminar / Mover ↑↓) o deshabilitarlos.
 * Then `!!_escalaMat` — bool true si hay materia seleccionada.
 * Edge:
 *   - Trivial pero LOAD-bearing: el UI usa este bool para gate las 6 acciones
 *     de edición de criterios.
 *   - **No chequea si la escala está guardada/cerrada** — el profesor SIEMPRE
 *     puede editar (re-save dispara modal de advertencia en `guardarEscala`,
 *     no aquí).
 *   - Helper LOCAL.
 *   - Función PURA.
 *   - Deuda post-Supabase: chequear permisos RLS + bloqueo si parcial cerrado.
 */
function _escalaCanEdit() {
  return !!_escalaMat;
}

/**
 * @interaction escala-totales-pct
 * @scope profesor-escala-helper-puro
 *
 * Given `esc` (escala con array `criterios[]` con `{pct, extra}`).
 * When `_buildEscalaCriterios` pinta total bar / `guardarEscala` valida
 *   suma / `confirmar(Agregar|Editar)Criterio` valida límites.
 * Then 3 one-liners agregados:
 *   - `_escalaTotal(esc)`     → suma de TODOS los pct (base + extra).
 *   - `_escalaExtraTotal(esc)`→ suma pct de criterios marcados `extra: true`.
 *   - `_escalaBaseTotal(esc)` → suma pct de criterios no-extras.
 * Edge:
 *   - **Invariante esperado**: `_escalaBaseTotal + _escalaExtraTotal === _escalaTotal`
 *     (siempre cierto por definición filter complementario).
 *   - criterios vacío → todos 0.
 *   - **Límites canonicales**:
 *     - baseTotal === 100 para que `guardarEscala` permita save.
 *     - extraTotal ≤ 20 (extras no pueden superar 20% del total).
 *     - total ≤ 120 (base + extra, hard cap).
 *   - Funciones PURAS (filter+reduce no mutan).
 *   - Helpers LOCALES.
 *   - One-liners deliberados — convención sesión 5: docs sobre brevedad si
 *     son load-bearing del flujo.
 *   - Deuda post-Supabase: computed columns en `escalas` o vista materializada.
 */
function _escalaTotal(esc)      { return esc.criterios.reduce((s, c) => s + c.pct, 0); }
function _escalaExtraTotal(esc) { return esc.criterios.filter((c) => c.extra).reduce((s, c) => s + c.pct, 0); }
function _escalaBaseTotal(esc)  { return esc.criterios.filter((c) => !c.extra).reduce((s, c) => s + c.pct, 0); }

// ── Entry point ───────────────────────────────────────────────────────────────
/**
 * @interaction build-escala-evaluacion
 * @scope profesor-escala-entrypoint
 *
 * Given APP.user activo + DOM con `#escala-mat-cards` presente (vista standalone
 *   o tab calificaciones del hub-materia).
 * When `escalaRender` lo invoca tras lazy-fetch del HTML, o caller legacy
 *   `showView('escala-evaluacion')` lo dispara.
 * Then init idempotente por uid:
 *   1. Guard tipo === "profesor" → no-op.
 *   2. Si `_escalaUserId !== APP.user.id`:
 *      - Setea `_escalaUserId = APP.user.id`.
 *      - Hidrata `_escalaMaterias = _buildEscalaMaterias(uid)`.
 *      - Hidrata `_escalaState = _buildEscalaState(uid)`.
 *      - Reset `_escalaMat / _escalaDirty / _escalaSnapshot`.
 *      Si ya está hidratado (re-entrar a la vista) → skip init (estado
 *      preservado).
 *   3. Builds: `_buildEscalaMatCards()` + `_updateEscalaView()`.
 * Edge:
 *   - APP.user no profesor → no-op silencioso.
 *   - **Estado MUTABLE preservado cross-entry** — re-entrar al tab no pierde
 *     selección/dirty/criterios en curso. Init real solo cuando cambia uid
 *     (logout/login).
 *   - Listener legacy ya migrado; sin window export (caller `escalaRender`
 *     llama directo en mismo archivo).
 *   - Función IMPURA (muta module-scope).
 *   - Deuda post-Supabase: estado mutable se mueve a TanStack Query / Zustand
 *     con cache invalidation por uid.
 */
function buildEscalaEvaluacion() {
  if (!APP.user || APP.user.tipo !== "profesor") return;
  if (_escalaUserId !== APP.user.id) {
    _escalaUserId   = APP.user.id;
    _escalaMaterias = _buildEscalaMaterias(APP.user.id);
    _escalaState    = _buildEscalaState(APP.user.id);
    _escalaMat      = null;
    _escalaDirty    = false;
    _escalaSnapshot = null;
  }
  _buildEscalaMatCards();
  _updateEscalaView();
}

// ── Tarjetas de materias ──────────────────────────────────────────────────────
/**
 * @interaction build-escala-mat-cards
 * @scope profesor-escala-render-mat-cards
 *
 * Given `#escala-mat-cards` presente + `_escalaMaterias` hidratado.
 * When `buildEscalaEvaluacion` orquesta el render inicial, o
 *   `seleccionarEscalaMat`/`guardarEscala`/`ejecutarGuardarEscala` invalidan
 *   datos (cambio de selección o save).
 * Then construye `.prof-mat-card` cards (1 por materia):
 *   1. Sin materias → empty state "Sin materias asignadas".
 *   2. Por materia:
 *      - color stripe (`var(--xahni-{color}-light)` para blue, else
 *        `var(--xahni-{color})`).
 *      - `.mc-active` si materia seleccionada (matchea `_escalaMat`).
 *      - Por parcial (3 filas):
 *        - Label "Pn" con ⚠ si parcial sin escala (no guardado AND criterios
 *          vacío).
 *        - `.mc-seg-bar` con N segmentos (1 por semana del periodo): done /
 *          current / off por estado del periodo + semanaActual.
 *        - Status text: "Completado" / "Pendiente" / "Sem. X de N".
 *      - onclick → `seleccionarEscalaMat(m.id)`.
 * Edge:
 *   - DOM target ausente → no-op.
 *   - Materia sin periodoInfo → fallback parciales hardcoded {num, semanas:6,
 *     estado:"futuro", semanaActual:0, pct:0}.
 *   - **Color stripe `blue` asimetría**: var --xahni-blue-light (no var
 *     --xahni-blue) — paleta blue base es muy oscura. Las otras 5 colors
 *     usan el var directo.
 *   - innerHTML directo con `m.nombre`/`m.clave` — DEMO controlado; deuda
 *     XSS pendiente slice pre-Supabase.
 *   - Función PURA respecto a outputs (innerHTML reescritura completa).
 *   - Estado evolutivo: semanas/semanaActual derivados de `getPeriodoInfo`
 *     (helper canonical periodo.js).
 */
function _buildEscalaMatCards() {
  const el = document.getElementById("escala-mat-cards");
  if (!el) return;

  if (!_escalaMaterias.length) {
    el.innerHTML = `<div class="x-empty">
      <div class="x-empty__icon">📚</div>
      <div class="x-empty__title">Sin materias asignadas</div>
    </div>`;
    return;
  }

  el.innerHTML = _escalaMaterias
    .map((m) => {
      const ac       = m.color === "blue" ? "var(--xahni-blue-light)" : `var(--xahni-${m.color})`;
      const isActive = _escalaMat === m.id;
      const escState = _escalaState[m.id] || [];
      const parciales = (m.periodoInfo?.parciales) || escState.map((p) => ({
        num: p.num, semanas: 6, estado: "futuro", semanaActual: 0, pct: 0,
      }));

      const filasHTML = parciales
        .map((p, i) => {
          const escEntry  = escState[i] || {};
          const sinEscala = !escEntry.guardado && (escEntry.criterios?.length || 0) === 0;
          const labelP = sinEscala
            ? `<span class="mc-parcial-label" style="color:var(--xahni-red)" title="Sin escala definida">P${p.num} ⚠</span>`
            : `<span class="mc-parcial-label">P${p.num}</span>`;

          const segmentos = Array.from({ length: p.semanas }, (_, idx) => {
            const semNum  = idx + 1;
            const cerrado = p.estado === "cerrado" || (p.estado === "activo" && semNum < p.semanaActual);
            const actual  = p.estado === "activo" && semNum === p.semanaActual;
            const cls = cerrado ? "mc-seg mc-seg-done"
                      : actual  ? "mc-seg mc-seg-current"
                      : "mc-seg mc-seg-off";
            return `<div class="${cls}"></div>`;
          }).join("");

          const statusText = p.estado === "cerrado"
            ? "Completado"
            : p.estado === "futuro"
              ? "Pendiente"
              : `Sem. ${p.semanaActual} de ${p.semanas}`;
          const statusColor = p.estado === "cerrado"
            ? "var(--xahni-green)"
            : p.estado === "futuro"
              ? "var(--text-muted)"
              : ac;

          return `<div class="mc-parcial-row">
            ${labelP}
            <div class="mc-seg-bar">${segmentos}</div>
            <span class="mc-parcial-status" style="color:${statusColor}">${statusText}</span>
          </div>`;
        })
        .join("");

      return `<div class="prof-mat-card${isActive ? " mc-active" : ""}" onclick="seleccionarEscalaMat('${m.id}')">
        <div class="prof-mat-strip" style="background:${ac}"></div>
        <div class="prof-mat-body">
          <div class="prof-mat-nombre">${m.nombre}</div>
          <div class="prof-mat-clave">${m.clave}</div>
          <div class="mc-parciales">${filasHTML}</div>
        </div>
      </div>`;
    })
    .join("");
}

/**
 * @interaction seleccionar-escala-mat
 * @scope profesor-escala-handler-select
 *
 * Given matId del click en una `.prof-mat-card` (o llamada programática
 *   desde `escalaRender` para pre-select).
 * When user click una card del grid de materias.
 * Then resolución cascada:
 *   1. **Dirty guard**: si `_escalaDirty` → guarda action en
 *      `_escalaPendingAction` + abre modal `cambios-pendientes`. El usuario
 *      decide guardar / descartar / cancelar; las primeras dos disparan
 *      `_escalaPendingAction()` reintentando esta llamada.
 *   2. **Bifurcación hub vs standalone** (Pieza D 2026-05-23):
 *      - Contexto hub (`APP.profHubMatActivo` truthy): NO toggle, siempre
 *        seleccionar. Lee parcial elevado desde
 *        `APP.profParcialActivo[gmKey]` con fallback 1.
 *      - Contexto standalone: toggle (re-click misma materia deselecciona)
 *        + reset parcial a 1.
 *   3. Reset dirty/snapshot tras switch (cambios pendientes ya gestionados).
 *   4. Re-build mat cards (para mover `.mc-active`) + update view.
 * Edge:
 *   - matId falsy en contexto hub → no se ejecuta el branch hub-específico
 *     (cae al standalone). Defensa por click programático sin id.
 *   - Modal cambios-pendientes 3 opciones: guardar (dispara save + retry),
 *     descartar (rollback snapshot + retry), cancelar (no-op).
 *   - **Exportado en window** (onclick inline en cards + caller cross-archivo
 *     `escalaRender` lo pre-selecciona).
 *   - Función IMPURA (muta estado + abre modal).
 */
function seleccionarEscalaMat(matId) {
  if (_escalaDirty) {
    _escalaPendingAction = () => seleccionarEscalaMat(matId);
    openModal("modal-cambios-pendientes");
    return;
  }

  // Pieza D (Task 12): en contexto hub, siempre seleccionar (sin toggle)
  // y leer parcial del estado elevado.
  // En contexto standalone, conservar comportamiento original (toggle + reset a 1).
  const _hubCtx = APP.profHubMatActivo;
  if (_hubCtx && matId) {
    _escalaMat = matId;
    const gmKey = `${matId}_${_hubCtx.grupoId || APP.profGrupoActivo}`;
    _escalaParcial = APP.profParcialActivo[gmKey] || 1;
  } else {
    _escalaMat = _escalaMat === matId ? null : matId;
    _escalaParcial = 1;
  }

  _escalaDirty   = false;
  _escalaSnapshot = null;
  _buildEscalaMatCards();
  _updateEscalaView();
}

/**
 * @interaction update-escala-view
 * @scope profesor-escala-orchestrator
 *
 * Given DOM con `#escala-contenido` + `#escala-placeholder` + `_escalaMat`
 *   (puede ser null o materiaId).
 * When `buildEscalaEvaluacion`, `seleccionarEscalaMat`, o cualquier handler
 *   que cambia de materia necesita refrescar la zona de contenido.
 * Then:
 *   1. Sin materia (`_escalaMat` null): contenido display:none, placeholder
 *      display:block (mensaje "Selecciona una materia").
 *   2. Con materia: contenido display:block, placeholder display:none.
 *      Builds: `_buildEscalaTabs()` (tabs Pn) + `_buildEscalaCriterios()`.
 * Edge:
 *   - DOM targets ausentes → crash (sin guards). **Convención asumida**:
 *     contenedor `views/profesor/escala.html` ya cargado por `escalaRender`
 *     o legacy view loader. Si falta, indicio de bug grave (no se documenta
 *     defensa innecesaria).
 *   - Helper LOCAL.
 *   - Función IMPURA (mutaciones DOM directas).
 *   - Orchestrator simple — no contiene lógica; delega a tabs + criterios.
 */
function _updateEscalaView() {
  const contenido   = document.getElementById("escala-contenido");
  const placeholder = document.getElementById("escala-placeholder");
  if (!_escalaMat) {
    contenido.style.display   = "none";
    placeholder.style.display = "block";
    return;
  }
  contenido.style.display   = "block";
  placeholder.style.display = "none";
  _buildEscalaTabs();
  _buildEscalaCriterios();
}

/**
 * @interaction build-escala-tabs
 * @scope profesor-escala-render-tabs
 *
 * Given `#escala-parcial-tabs` presente + materia seleccionada.
 * When `_updateEscalaView` (post-select) o handlers de save invalidan tabs.
 * Then:
 *   1. **Pieza D 2026-05-23 hub gate**: si `APP.profHubMatActivo` truthy →
 *      tabs LOCALES escondidos (los tabs Pn están elevados al header del
 *      hub-materia, `prof-mat-parcial-tabs`). innerHTML="" para limpiar
 *      cualquier render previo del modo standalone.
 *   2. Modo standalone: 3 tabs P1/P2/P3 con:
 *      - `.active` si parcial actual matches.
 *      - `.alert` + chip ⚠ si parcial vacío sin guardar.
 *      - sublabel: "Guardado" / "Sin guardar" / "Sin definir".
 *      - onclick → `cambiarEscalaParcial(p.num)`.
 * Edge:
 *   - DOM target ausente → no-op.
 *   - **Asimetría hub/standalone**: en hub usuario navega parciales desde
 *     el header (cross-tab); en standalone desde estos tabs. La feature
 *     vive 1 sola vez en el viewport para evitar confusión.
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM).
 *   - NUM_PARCIALES (3) hardcoded en `_buildEscalaState`; tabs aquí son
 *     siempre 3 — invariante del semestre estándar.
 */
function _buildEscalaTabs() {
  const el = document.getElementById("escala-parcial-tabs");
  if (!el) return;

  // Pieza D (Task 12): en contexto hub, los tabs de parcial están elevados al
  // header de la materia (prof-mat-parcial-tabs). Ocultar los locales para no
  // duplicar la navegación de parcial.
  if (APP.profHubMatActivo) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }

  el.style.display = "";
  const parciales = _escalaState[_escalaMat] || [];

  el.innerHTML = parciales
    .map((p) => {
      const isActive   = _escalaParcial === p.num;
      const needsAlert = !p.guardado && p.criterios.length === 0;
      const subLabel   = p.guardado ? "Guardado" : p.criterios.length > 0 ? "Sin guardar" : "Sin definir";

      return `<button class="escala-tab${isActive ? " active" : ""}${needsAlert ? " alert" : ""}" onclick="cambiarEscalaParcial(${p.num})">
        <span>P${p.num}</span>
        ${needsAlert ? '<span class="escala-tab-alert">⚠</span>' : ""}
        <span class="escala-tab-sub">${subLabel}</span>
      </button>`;
    })
    .join("");
}

/**
 * @interaction cambiar-escala-parcial
 * @scope profesor-escala-handler-tab-parcial
 *
 * Given num (1/2/3) del click en un tab Pn local (modo standalone).
 * When user click un tab Pn (`.escala-tab`).
 * Then:
 *   1. **Dirty guard**: mismo patrón que `seleccionarEscalaMat` — si
 *      `_escalaDirty` → modal cambios-pendientes con action pendiente
 *      `() => cambiarEscalaParcial(num)`.
 *   2. Setea `_escalaParcial = num`, reset dirty/snapshot.
 *   3. Re-build tabs (para mover `.active`) + criterios (para mostrar nuevos
 *      criterios del nuevo parcial).
 * Edge:
 *   - **Solo aplica en modo standalone**: en hub los tabs vienen del header
 *     (`prof-mat-parcial-tabs`) y el handler es `profMatSetParcial` cross-archivo.
 *   - num no en {1,2,3} → cambia state pero no hay parcial correspondiente
 *     en `_escalaState[mat]` → criterios renderea vacío (defensa: caller
 *     usa botones cementados).
 *   - **Exportado en window** (onclick inline en tabs).
 *   - Función IMPURA.
 */
function cambiarEscalaParcial(num) {
  if (_escalaDirty) {
    _escalaPendingAction = () => cambiarEscalaParcial(num);
    openModal("modal-cambios-pendientes");
    return;
  }
  _escalaParcial  = num;
  _escalaDirty    = false;
  _escalaSnapshot = null;
  _buildEscalaTabs();
  _buildEscalaCriterios();
}

/**
 * @interaction build-escala-criterios
 * @scope profesor-escala-render-criterios
 *
 * Given materia + parcial activos + DOM con `#escala-card-title`,
 *   `#escala-actions`, `#escala-criterios-lista`, `#escala-total-bar`,
 *   `#escala-barra-visual`.
 * When `_updateEscalaView`, `seleccionarEscalaMat`, `cambiarEscalaParcial`,
 *   o cualquier handler CRUD (agregar/editar/eliminar/mover) re-paint.
 * Then orquesta render completo del panel criterios (~80 LOC):
 *   1. Resuelve `esc` desde `_escalaState[mat][parcial-1]`. Sin → no-op.
 *   2. Calcula totales puros (`_escalaTotal/Base/Extra`).
 *   3. Título: "Criterios — Parcial N".
 *   4. Actions: si canEdit, botones "+ Agregar criterio" + "💾 Guardar
 *      escala" (disabled si baseTotal≠100 o extraTotal>20, dirty highlight
 *      como primary).
 *   5. Lista criterios: por cada `c` con `colorIdx` lazy-init
 *      (`max(usedIdxs)+1` para nuevos, sobrevive a reordenamientos):
 *      - dot color persistente (`_escalaColorVar(c.colorIdx)`).
 *      - nombre + chip "Extra" si extra.
 *      - pct coloreado.
 *      - botón Editar (disabled si no canEdit).
 *      - botones Subir ↑ / Bajar ↓ (disabled en bordes).
 *      - botón 🗑 Eliminar.
 *   6. Total bar: "TOTAL" + value coloreado (verde si base===100, rojo
 *      sino) + status "Faltan X%" si incompleto.
 *   7. Barra visual: `_escalaBarHTML(esc)` (helper externo).
 * Edge:
 *   - **Lazy-init `colorIdx`** (2026-05-23 user feedback): color persistente
 *     por criterio que sobrevive a swap/delete+add. Nuevos criterios reciben
 *     `max(usedIdxs)+1` para evitar colisiones tras delete.
 *   - **innerHTML directo** con `c.nombre` — DEMO controlado; deuda XSS
 *     pendiente slice pre-Supabase.
 *   - Edición disabled NO oculta botones (style="opacity:.3;pointer-events:none"
 *     vs display:none) — decisión visual cementada: mantener layout consistente.
 *   - Función IMPURA (mutaciones DOM masivas + side-effect: muta
 *     `c.colorIdx` lazy-init).
 *   - Builder más grande del módulo. Slice C9 trasplanta-fiel del shell legacy.
 */
function _buildEscalaCriterios() {
  const escData = _escalaState[_escalaMat];
  const esc     = escData ? escData[_escalaParcial - 1] : null;
  if (!esc) return;

  const canEdit    = _escalaCanEdit();
  const total      = _escalaTotal(esc);
  const baseTotal  = _escalaBaseTotal(esc);
  const extraTotal = _escalaExtraTotal(esc);

  document.getElementById("escala-card-title").textContent = `Criterios — Parcial ${_escalaParcial}`;

  const actEl = document.getElementById("escala-actions");
  if (canEdit) {
    actEl.style.display = "";
    const guardarDisabled = baseTotal !== 100 || extraTotal > 20;
    const guardarClass    = _escalaDirty ? "x-btn x-btn--primary escala-guardar-dirty" : "x-btn x-btn--ghost";
    actEl.innerHTML = `
      <button class="x-btn x-btn--ghost" style="font-size:12px" onclick="abrirAgregarCriterio()">+ Agregar criterio</button>
      <button class="${guardarClass}" style="font-size:12px;padding:8px 14px" onclick="guardarEscala()"
          ${guardarDisabled ? 'disabled style="font-size:12px;padding:8px 14px;opacity:.4;pointer-events:none"' : ""}>💾 Guardar escala</button>`;
  } else {
    actEl.style.display = "";
    actEl.innerHTML = "";
  }

  const listEl = document.getElementById("escala-criterios-lista");
  if (esc.criterios.length) {
    const ultimoIdx = esc.criterios.length - 1;
    // 2026-05-23 (user feedback): color persistente por criterio.
    // Lazy-init colorIdx la primera vez que se ve el criterio para que
    // sobreviva a reordenamientos (el color viaja con el rubro, no con
    // la posición). Para nuevos criterios sin colorIdx, usar
    // max(colorIdx existentes)+1 evita colisiones tras delete+add.
    const usedIdxs = esc.criterios.map(c => c.colorIdx).filter(x => Number.isInteger(x));
    let nextFreeIdx = usedIdxs.length ? Math.max.apply(null, usedIdxs) + 1 : 0;
    esc.criterios.forEach(c => {
      if (!Number.isInteger(c.colorIdx)) c.colorIdx = nextFreeIdx++;
    });
    listEl.innerHTML = esc.criterios
      .map((c, i) => {
        const color = _escalaColorVar(c.colorIdx);
        const editBtn = canEdit
          ? `<button class="escala-editar-btn" onclick="abrirEditarCriterio(${i})">Editar</button>`
          : `<button class="escala-editar-btn" disabled style="opacity:.3;pointer-events:none">Editar</button>`;
        const moveButtons = canEdit
          ? `<button class="prof-accion-btn" title="Subir" onclick="_criterioMover(${i},-1)"${i === 0 ? ' disabled style="opacity:.3;pointer-events:none"' : ""}>↑</button>`
          + `<button class="prof-accion-btn" title="Bajar" onclick="_criterioMover(${i},1)"${i === ultimoIdx ? ' disabled style="opacity:.3;pointer-events:none"' : ""}>↓</button>`
          : "";
        return `<div class="escala-criterio-row">
          <div class="escala-criterio-dot" style="background:${color}"></div>
          <div class="escala-criterio-info">
            <div class="escala-criterio-nombre">${c.nombre}${c.extra ? ' <span class="escala-extra-chip">Extra</span>' : ""}</div>
          </div>
          <div class="escala-criterio-pct" style="color:${color}">${c.pct}%</div>
          ${editBtn}
          ${moveButtons}
          ${canEdit ? `<button class="prof-accion-btn" style="color:var(--xahni-red)" onclick="eliminarCriterio(${i})">🗑</button>` : ""}
        </div>`;
      })
      .join("");
  } else {
    listEl.innerHTML = "";
  }

  const totalEl   = document.getElementById("escala-total-bar");
  const valueColor = baseTotal === 100 ? "var(--xahni-green)" : "var(--xahni-red)";
  const valueText  = extraTotal > 0 ? `${baseTotal}% + ${extraTotal}%` : `${baseTotal}%`;
  totalEl.innerHTML = esc.criterios.length
    ? `<div class="escala-total-row">
        <div class="escala-total-label" style="font-size:28px;font-weight:800;letter-spacing:.08em">TOTAL</div>
        <div class="escala-total-value" style="color:${valueColor};font-size:22px">${valueText}</div>
        ${baseTotal < 100
          ? `<div class="escala-total-status"><span style="color:var(--xahni-red)">Faltan ${100 - baseTotal}% en la evaluación base</span></div>`
          : ""}
      </div>`
    : "";

  const barEl = document.getElementById("escala-barra-visual");
  if (barEl) barEl.innerHTML = _escalaBarHTML(esc);
}

// ── Agregar criterio ──────────────────────────────────────────────────────────
/**
 * @interaction abrir-agregar-criterio
 * @scope profesor-escala-modal-agregar
 *
 * Given materia + parcial activos + DOM con `modal-agregar-criterio` y sus
 *   campos (`criterio-*-input`/`criterio-*-check`).
 * When click en botón "+ Agregar criterio" del panel actions.
 * Then:
 *   1. Resuelve materia + escala. Sin → no-op.
 *   2. Setea breadcrumb del modal (nombre materia + "P{N}").
 *   3. Reset campos: nombre vacío, extra unchecked, valorMax vacío,
 *      vinculo radio "manual" seleccionado.
 *   4. `_tpRenderPctGrid("agregar", esc, false, null)` — pinta grid pct
 *      con disponible inicial.
 *   5. Reset `_selectedPct = null`.
 *   6. `openModal("modal-agregar-criterio")`.
 *   7. **Setup IIFE `setupValorMaxLabel`**: handler dinámico que cambia
 *      el label `criterio-valormax-label` según palabra clave detectada
 *      en `nombreInput.value` (asistenc / participa / tarea / examen → labels
 *      personalizados + placeholders contextuales).
 * Edge:
 *   - **IIFE registrada cada vez que se abre el modal** — remueve listener
 *     previo via `removeEventListener` antes de agregar el nuevo (defensa
 *     contra listener-leak si modal abre múltiples veces sin reset).
 *   - Decisión label dinámico es solo cosmética; el campo se llama
 *     "criterio-valormax-input" semánticamente para "cantidad máxima".
 *   - Exportado en window (onclick inline).
 *   - Función IMPURA (DOM + abre modal).
 *   - Deuda post-Supabase: validation + auto-suggest desde catálogo de
 *     criterios predefinidos.
 */
function abrirAgregarCriterio() {
  const m   = _escalaMaterias.find((x) => x.id === _escalaMat);
  const esc = _escalaState[_escalaMat]?.[_escalaParcial - 1];
  if (!m || !esc) return;

  document.getElementById("criterio-materia-nombre").textContent = m.nombre;
  document.getElementById("criterio-parcial-num").textContent    = "P" + _escalaParcial;
  document.getElementById("criterio-nombre-input").value         = "";
  document.getElementById("criterio-extra-check").checked        = false;

  // Resetear valorMax y vínculo para nueva entrada
  const valorMaxInputAgregar = document.getElementById("criterio-valormax-input");
  if (valorMaxInputAgregar) valorMaxInputAgregar.value = "";
  const vinculoManualRadio = document.querySelector('input[name="criterio-vinculo"][value="manual"]');
  if (vinculoManualRadio) vinculoManualRadio.checked = true;

  _tpRenderPctGrid("agregar", esc, false, null);
  _selectedPct = null;
  openModal("modal-agregar-criterio");

  // CONSERVADO 2026-05-23: label dinámica de valorMax según criterio
  (function setupValorMaxLabel() {
    const nombreInput   = document.getElementById("criterio-nombre-input");
    const valorMaxLabel = document.getElementById("criterio-valormax-label");
    const valorMaxInput = document.getElementById("criterio-valormax-input");
    if (!nombreInput || !valorMaxLabel || !valorMaxInput) return;
    const updateLabel = () => {
      const n = (nombreInput.value || "").toLowerCase();
      if (n.includes("asistenc"))       { valorMaxLabel.textContent = "Clases del parcial";        valorMaxInput.placeholder = "Ej. 14"; }
      else if (n.includes("participa")) { valorMaxLabel.textContent = "Participaciones esperadas"; valorMaxInput.placeholder = "Ej. 10"; }
      else if (n.includes("tarea"))     { valorMaxLabel.textContent = "Tareas asignadas";          valorMaxInput.placeholder = "Ej. 2"; }
      else if (n.includes("examen"))    { valorMaxLabel.textContent = "Examen sobre";              valorMaxInput.placeholder = "Ej. 10"; }
      else                              { valorMaxLabel.textContent = "Cantidad máxima";           valorMaxInput.placeholder = "Ej. 10"; }
    };
    nombreInput.removeEventListener("input", updateLabel);
    nombreInput.addEventListener("input", updateLabel);
    updateLabel();
  })();
}

/**
 * @interaction tp-render-pct-grid
 * @scope profesor-escala-modal-helper-grid
 *
 * Given mode ("agregar" | "editar") + escala actual + isExtra flag +
 *   editingCriterio opcional (si modo "editar").
 * When `abrirAgregarCriterio`/`abrirEditarCriterio` arman el grid inicial,
 *   o `_tpToggleExtraGrid` recalcula tras checkbox extra change.
 * Then:
 *   1. Calcula `disponible`:
 *      - isExtra=true → `20 - extraTotal` (más `editingCriterio.pct` si
 *        editando un extra para no double-cuenta).
 *      - isExtra=false → `100 - baseTotal` (más editingCriterio.pct si
 *        editando base).
 *      - max(0, disponible).
 *   2. Resuelve gridId / dispId según mode.
 *   3. Pinta texto disponible: "Extra disponible: X% (máx 20%)" o
 *      "Disponible: X%".
 *   4. Innerhtml grid: 20 botones (5%, 10%, ..., 100%) — `.disabled` si
 *      excede disponible, `.selected` si match `editingCriterio.pct` y no
 *      disabled.
 *   5. Reset `_selectedPct = null` si cambió isExtra (al cambiar base↔extra).
 *   6. Clear `_selectedPct` si excede nuevo disponible.
 * Edge:
 *   - Helper LOCAL.
 *   - **Suma de pcts deduce capacidad disponible**: invariante implícito
 *     del flujo de validación posterior (confirmar*Criterio re-valida).
 *   - DOM targets ausentes → crash (sin guards). Asumido: modal abierto.
 *   - Función IMPURA (DOM + muta `_selectedPct`).
 */
function _tpRenderPctGrid(mode, esc, isExtra, editingCriterio) {
  const baseTotal  = _escalaBaseTotal(esc);
  const extraTotal = _escalaExtraTotal(esc);

  let disponible;
  if (isExtra) {
    disponible = 20 - extraTotal;
    if (editingCriterio && editingCriterio.extra) disponible += editingCriterio.pct;
  } else {
    disponible = 100 - baseTotal;
    if (editingCriterio && !editingCriterio.extra) disponible += editingCriterio.pct;
  }
  disponible = Math.max(0, disponible);

  const gridId = mode === "agregar" ? "criterio-pct-grid" : "editar-pct-grid";
  const dispId = mode === "agregar" ? "criterio-pct-disponible" : "editar-pct-disponible";

  document.getElementById(dispId).textContent = isExtra
    ? `Extra disponible: ${disponible}% (máx 20%)`
    : `Disponible: ${disponible}%`;

  const gridEl = document.getElementById(gridId);
  gridEl.innerHTML = "";
  for (let p = 5; p <= 100; p += 5) {
    const disabled = p > disponible;
    const selected = editingCriterio && p === editingCriterio.pct && !disabled;
    gridEl.innerHTML += `<button class="criterio-pct-btn${disabled ? " disabled" : ""}${selected ? " selected" : ""}" data-pct="${p}"
        ${disabled ? "disabled" : ""}
        onclick="seleccionarPctCriterio(this,${p})">${p}%</button>`;
  }

  if (!editingCriterio || editingCriterio.extra !== isExtra) _selectedPct = null;
  if (_selectedPct && _selectedPct > disponible) _selectedPct = null;
}

/**
 * @interaction tp-toggle-extra-grid
 * @scope profesor-escala-modal-handler
 *
 * Given mode ("agregar" | "editar") + DOM con checkbox extra del modal
 *   correspondiente.
 * When user toggle el checkbox "Criterio extra".
 * Then resuelve isExtra desde checkbox + re-pinta grid via `_tpRenderPctGrid`:
 *   - Modo "agregar": editingCriterio=null.
 *   - Modo "editar": editingCriterio = `esc.criterios[_editIdx]` (para que
 *     `_tpRenderPctGrid` calcule disponible correctamente sumando back
 *     el pct del criterio en edición).
 * Edge:
 *   - Sin escala activa → no-op.
 *   - **Exportado en window** (onclick inline en checkbox).
 *   - `_editIdx` debe estar seteado en modo "editar" — invariante del flujo
 *     `abrirEditarCriterio → _tpToggleExtraGrid`.
 *   - Función IMPURA (re-render DOM via `_tpRenderPctGrid`).
 */
function _tpToggleExtraGrid(mode) {
  const esc = _escalaState[_escalaMat]?.[_escalaParcial - 1];
  if (!esc) return;
  if (mode === "agregar") {
    const isExtra = document.getElementById("criterio-extra-check").checked;
    _tpRenderPctGrid("agregar", esc, isExtra, null);
  } else {
    const isExtra = document.getElementById("editar-criterio-extra").checked;
    const c       = esc.criterios[_editIdx];
    _tpRenderPctGrid("editar", esc, isExtra, c);
  }
}

let _selectedPct = null;
/**
 * @interaction seleccionar-pct-criterio
 * @scope profesor-escala-modal-handler-pct
 *
 * Given btn (`.criterio-pct-btn`) clickeado + pct (5-100, múltiplo de 5).
 * When user click un botón % del grid (modal agregar o editar).
 * Then:
 *   1. Setea `_selectedPct = pct` (module-scope shared cross-modal).
 *   2. Visual: deselect siblings del mismo grid (closest `.criterio-pct-grid`)
 *      + marca `.selected` sobre el btn clickeado.
 * Edge:
 *   - btn disabled (excede disponible) → onclick no se dispara (HTML
 *     disabled bloquea el handler).
 *   - **`_selectedPct` shared cross-modal** entre agregar y editar — caller
 *     debe limpiar al cerrar modal (lo hace `confirmar*Criterio` después
 *     de validar).
 *   - **Exportado en window** (onclick inline en `_tpRenderPctGrid`).
 *   - Función IMPURA (muta module-scope + DOM clases).
 *   - Helper LOCAL del módulo.
 */
function seleccionarPctCriterio(btn, pct) {
  _selectedPct = pct;
  btn.closest(".criterio-pct-grid").querySelectorAll(".criterio-pct-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
}

/**
 * @interaction confirmar-agregar-criterio
 * @scope profesor-escala-modal-agregar
 *
 * Given: profesor en modal-agregar-criterio con nombre + pct + extra +
 *        valorMax + vinculo seleccionados; escala activa permite edits
 * When:  click en botón "Agregar" del modal
 * Then:  - valida (nombre no vacío, pct seleccionado, valorMax ≥ 1, suma
 *          de pcts no excede 120% base o 20% extra según flag)
 *        - persiste criterio en _escalaState[matId][parcial-1].criterios
 *          con shape {id, nombre, pct, extra, valorMax, vinculo, tipo}
 *        - marca _escalaDirty=true para activar botón "Guardar escala"
 *        - cierra modal, re-renderea criterios y warning chip
 * Edge:
 *   - valorMax inválido (no entero ≥1) → toast error, modal queda abierto
 *   - vinculo no seleccionado → default "manual"
 *   - tipo derivado: auto_tareas → 'tareas', nombre contiene "examen" →
 *     'examen', else 'manual'
 *   - suma excedería 120% (base) o 20% (extra) → toast bloqueante
 */
function confirmarAgregarCriterio() {
  const nombre = document.getElementById("criterio-nombre-input").value.trim();
  const extra  = document.getElementById("criterio-extra-check").checked;
  if (!nombre)      { showToast("Ingresa el nombre del criterio", "info"); return; }
  if (!_selectedPct){ showToast("Selecciona un porcentaje", "info");       return; }

  const esc = _escalaState[_escalaMat]?.[_escalaParcial - 1];
  if (!esc) return;

  // Capturar valorMax y vinculo
  const valorMax = parseInt(document.getElementById("criterio-valormax-input").value, 10);
  const vinculoEl = document.querySelector('input[name="criterio-vinculo"]:checked');
  const vinculo   = vinculoEl ? vinculoEl.value : "manual";

  if (!Number.isInteger(valorMax) || valorMax < 1) {
    showToast("La cantidad máxima debe ser un entero ≥ 1", "error");
    return;
  }

  if (extra) {
    if (_escalaExtraTotal(esc) + _selectedPct > 20) {
      showToast("El máximo de calificación extra es 20%", "info"); return;
    }
  } else {
    // Validación suma ≤120% (base + extra puede llegar a 120%)
    const sumaActual = (esc.criterios || []).reduce((s, c) => s + (c.pct || 0), 0);
    if (sumaActual + _selectedPct > 120) {
      showToast("Suma de porcentajes excedería 120%", "error");
      return;
    }
    if (_escalaBaseTotal(esc) + _selectedPct > 100) {
      showToast("La calificación base no puede exceder 100%", "info"); return;
    }
  }

  _escalaMarkDirty();
  esc.criterios.push({
    id:      "c-" + Date.now(),
    nombre,
    pct:     _selectedPct,
    extra,
    valorMax,
    vinculo,
    tipo:    vinculo === "auto_tareas" ? "tareas" : (vinculo === "auto_examenes" ? "examen" : (nombre.toLowerCase().includes("examen") ? "examen" : "manual")),
  });
  _selectedPct = null;
  closeModal("modal-agregar-criterio");
  _buildEscalaCriterios();
  showToast(`"${nombre}" agregado`, "success");

  // Warning chip si la escala base está incompleta
  const totalNuevo = (esc.criterios || []).reduce((s, c) => s + (c.pct || 0), 0);
  const warningEl  = document.getElementById("escala-warning");
  if (warningEl) {
    if (totalNuevo < 100) {
      warningEl.style.display = "";
      warningEl.textContent   = `⚠ Escala incompleta: faltan ${(100 - totalNuevo).toFixed(0)}%`;
    } else {
      warningEl.style.display = "none";
    }
  }
}

// ── Editar criterio ───────────────────────────────────────────────────────────
/**
 * @interaction abrir-editar-criterio
 * @scope profesor-escala-modal-editar
 *
 * Given idx del criterio a editar + escala activa.
 * When user click botón "Editar" en una row de criterio.
 * Then:
 *   1. Setea `_editIdx = idx` (module-scope, leído por `confirmar`/
 *      `_tpToggleExtraGrid`).
 *   2. Resuelve `c = esc.criterios[idx]`.
 *   3. Prepobla campos del modal:
 *      - nombre input → c.nombre.
 *      - extra check → c.extra.
 *      - Grid pct vía `_tpRenderPctGrid("editar", esc, c.extra, c)`.
 *      - Setea `_selectedPct = c.pct` (para validation posterior).
 *      - valorMax input → c.valorMax ?? "" (defensive — campos legacy
 *        sin valorMax cuentan como vacío).
 *      - vinculo radio → c.vinculo || "manual".
 *   4. `openModal("modal-editar-criterio")`.
 * Edge:
 *   - Sin escala activa → no-op.
 *   - **Campos `valorMax`/`vinculo` defensive load**: criterios legacy
 *     hidratados desde DEMO_ESCALAS sin esos campos (ver `_buildEscalaState`
 *     edge — el mapeo descarta esos campos). `??` fallback a vacío o
 *     "manual".
 *   - **Exportado en window** (onclick inline).
 *   - Función IMPURA.
 */
function abrirEditarCriterio(idx) {
  _editIdx    = idx;
  const esc   = _escalaState[_escalaMat]?.[_escalaParcial - 1];
  if (!esc) return;
  const c     = esc.criterios[idx];

  document.getElementById("editar-criterio-nombre").value  = c.nombre;
  document.getElementById("editar-criterio-extra").checked = c.extra;
  _tpRenderPctGrid("editar", esc, c.extra, c);
  _selectedPct = c.pct;

  // Prepoblar valorMax + vinculo (Task 6)
  const valorMaxInputEditar = document.getElementById("editar-criterio-valormax-input");
  if (valorMaxInputEditar) valorMaxInputEditar.value = c.valorMax ?? "";
  const vinculoRadio = document.querySelector(
    `input[name="editar-criterio-vinculo"][value="${c.vinculo || "manual"}"]`
  );
  if (vinculoRadio) vinculoRadio.checked = true;

  openModal("modal-editar-criterio");
}

/**
 * @interaction confirmar-editar-criterio
 * @scope profesor-escala-modal-editar
 *
 * Given user en `modal-editar-criterio` tras `abrirEditarCriterio(idx)`,
 *   con nombre / extra / pct / valorMax / vinculo modificados.
 * When click en botón "Aplicar" del modal.
 * Then validation + persist:
 *   1. Toast bloqueante si nombre vacío.
 *   2. Toast bloqueante si pct no seleccionado.
 *   3. Resuelve oldC (criterio pre-edit) — necesario para calcular suma
 *      correcta al validar (descontar el pct viejo).
 *   4. valorMax parseInt + validation ≥ 1 → toast bloqueante.
 *   5. Validación límites con "swap" math:
 *      - Si extra: `extraTotal - (oldC.extra ? oldC.pct : 0) + newPct > 20`
 *        → bloqueante.
 *      - Si base: `baseTotal - (!oldC.extra ? oldC.pct : 0) + newPct > 100`
 *        → bloqueante.
 *   6. `_escalaMarkDirty()` antes de mutar.
 *   7. Reemplaza `esc.criterios[_editIdx]` con shape completo nuevo
 *      (preserva `id` original si existía, else genera `c-${Date.now()}`).
 *   8. Cleanup: `_selectedPct = null`, `_editIdx = -1`, cierra modal,
 *      `_buildEscalaCriterios()`, toast success.
 *   - Deriva `tipo`: `vinculo === "auto_tareas"` → 'tareas';
 *     `nombre includes "examen"` → 'examen'; else 'manual'.
 * Edge:
 *   - **Math "swap" para validación**: al editar, hay que descontar el pct
 *     viejo y sumar el nuevo. Si el criterio cambió base↔extra, descuenta
 *     del total correspondiente al ANTIGUO y suma al NUEVO.
 *   - Sin escala activa → no-op.
 *   - **Exportado en window** (onclick inline botón confirmar).
 *   - Función IMPURA (mutación + dirty + DOM + toast).
 *   - Patrón análogo a `confirmarAgregarCriterio` (ya documentada) — twin
 *     CRUD asimétrico por el descuento del pct viejo.
 */
function confirmarEditarCriterio() {
  const nombre = document.getElementById("editar-criterio-nombre").value.trim();
  const extra  = document.getElementById("editar-criterio-extra").checked;
  if (!nombre)       { showToast("Ingresa el nombre del criterio", "info"); return; }
  if (!_selectedPct) { showToast("Selecciona un porcentaje", "info");       return; }

  const esc  = _escalaState[_escalaMat]?.[_escalaParcial - 1];
  if (!esc) return;
  const oldC = esc.criterios[_editIdx];

  // Capturar valorMax y vinculo del modal de edición
  const valorMax = parseInt(document.getElementById("editar-criterio-valormax-input").value, 10);
  const vinculoEl = document.querySelector('input[name="editar-criterio-vinculo"]:checked');
  const vinculo   = vinculoEl ? vinculoEl.value : "manual";

  if (!Number.isInteger(valorMax) || valorMax < 1) {
    showToast("La cantidad máxima debe ser un entero ≥ 1", "error");
    return;
  }

  if (extra) {
    if (_escalaExtraTotal(esc) - (oldC.extra ? oldC.pct : 0) + _selectedPct > 20) {
      showToast("El máximo de calificación extra es 20%", "info"); return;
    }
  } else {
    if (_escalaBaseTotal(esc) - (!oldC.extra ? oldC.pct : 0) + _selectedPct > 100) {
      showToast("La calificación base no puede exceder 100%", "info"); return;
    }
  }

  _escalaMarkDirty();
  esc.criterios[_editIdx] = {
    id:      oldC.id || ("c-" + Date.now()),
    nombre,
    pct:     _selectedPct,
    extra,
    valorMax,
    vinculo,
    tipo:    vinculo === "auto_tareas" ? "tareas" : (vinculo === "auto_examenes" ? "examen" : (nombre.toLowerCase().includes("examen") ? "examen" : "manual")),
  };
  _selectedPct = null;
  _editIdx     = -1;
  closeModal("modal-editar-criterio");
  _buildEscalaCriterios();
  showToast(`"${nombre}" actualizado`, "success");
}

/**
 * @interaction eliminar-criterio
 * @scope profesor-escala
 *
 * Given: escala activa con criterios, profesor con permiso de edit
 * When:  click en botón 🗑 de un criterio row
 * Then:  - guarda idx en _eliminarIdx
 *        - cuenta capturas existentes en DEMO_PROGRESO_ESCALA para ese
 *          (escalaId, criterioId) y popula span dinámico del modal
 *        - abre modal-eliminar-criterio para confirmación
 * Edge:
 *   - sin escala activa / sin criterio en idx → no-op
 *   - sin capturas → span queda vacío (texto base intacto)
 */
function eliminarCriterio(idx) {
  _eliminarIdx = idx;
  const esc    = _escalaState[_escalaMat]?.[_escalaParcial - 1];
  const criterio = esc?.criterios[idx];
  const nombre   = criterio?.nombre || "";
  const criterioId = criterio?.id;
  document.getElementById("eliminar-criterio-nombre").textContent = nombre;

  // Calcular cuántos alumnos tienen captura para este criterio (cascade count)
  _eliminarConCaptura = 0;
  if (criterioId && typeof DEMO_PROGRESO_ESCALA !== "undefined" && DEMO_PROGRESO_ESCALA) {
    _eliminarConCaptura = Object.values(DEMO_PROGRESO_ESCALA).filter(function(p) {
      return p.escalaId === (esc && esc.id) &&
        (p.criterios || []).some(function(pc) {
          return pc.criterioId === criterioId &&
            (pc.valorAuto != null || pc.overrideProf != null);
        });
    }).length;
  }
  const capturaEl = document.getElementById("eliminar-criterio-capturas");
  if (capturaEl) {
    capturaEl.textContent = _eliminarConCaptura > 0
      ? ` Esto eliminará la captura de ${_eliminarConCaptura} alumno(s).`
      : "";
  }

  openModal("modal-eliminar-criterio");
}

/**
 * @interaction confirmar-eliminar-criterio
 * @scope profesor-escala-modal-eliminar
 *
 * Given: usuario en modal-eliminar-criterio tras click en 🗑
 * When:  click en botón confirmar "Eliminar"
 * Then:  - splice del criterio en _escalaState
 *        - cascade delete: borra entries con ese criterioId en TODOS los
 *          DEMO_PROGRESO_ESCALA cuya escalaId coincida
 *        - marca dirty, re-renderea criterios + matrices en Gestión
 *        - toast con conteo de capturas borradas si > 0
 * Edge:
 *   - sin escala activa → no-op
 *   - criterio en _eliminarIdx no existe → no-op
 *   - DEMO_PROGRESO_ESCALA no disponible globalmente → solo splice local
 */
function confirmarEliminarCriterio() {
  const esc    = _escalaState[_escalaMat]?.[_escalaParcial - 1];
  if (!esc) return;
  const criterio = esc.criterios[_eliminarIdx];
  const nombre   = criterio?.nombre || "";
  const criterioId = criterio?.id;

  // Cascade delete: borrar capturas en DEMO_PROGRESO_ESCALA para este criterio
  if (criterioId && typeof DEMO_PROGRESO_ESCALA !== "undefined" && DEMO_PROGRESO_ESCALA) {
    Object.values(DEMO_PROGRESO_ESCALA).forEach(function(p) {
      if (p.escalaId === esc.id) {
        p.criterios = (p.criterios || []).filter(function(pc) { return pc.criterioId !== criterioId; });
      }
    });
  }

  _escalaMarkDirty();
  esc.criterios.splice(_eliminarIdx, 1);
  _eliminarIdx = -1;
  closeModal("modal-eliminar-criterio");
  _buildEscalaCriterios();

  // Re-renderear matrices activas en gestión para reflejar la eliminación
  if (typeof _buildMiniPerfilGrid === "function") _buildMiniPerfilGrid();

  const toastMsg = _eliminarConCaptura > 0
    ? `"${nombre}" eliminado (${_eliminarConCaptura} captura(s) borrada(s))`
    : `"${nombre}" eliminado`;
  _eliminarConCaptura = 0;
  showToast(toastMsg, "info");
}

/**
 * @interaction mover-criterio
 * @scope profesor-escala
 *
 * Given: profesor en tab Calificaciones viendo la lista de criterios de una escala
 * When:  hace clic en ↑ o ↓ junto a un criterio (delta = -1 o +1)
 * Then:  intercambia el criterio[idx] con criterio[idx+delta] en el array,
 *        marca la escala como dirty y re-renderea la lista de criterios y
 *        las matrices activas en gestión para reflejar el nuevo orden
 * Edge:
 *   - idx + delta fuera de rango [0, length-1] → no-op silencioso
 *   - escala activa no encontrada → no-op + console.warn
 *   - escala guardada → igual aplica (requiere guardar de nuevo para persistir)
 */
function _criterioMover(idx, delta) {
  const esc = _escalaState[_escalaMat]?.[_escalaParcial - 1];
  if (!esc) { console.warn("[XAHNI] _criterioMover: escala activa no encontrada"); return; }
  const nuevoIdx = idx + delta;
  if (nuevoIdx < 0 || nuevoIdx >= esc.criterios.length) return;
  // Swap
  const temp = esc.criterios[idx];
  esc.criterios[idx]      = esc.criterios[nuevoIdx];
  esc.criterios[nuevoIdx] = temp;
  _escalaMarkDirty();
  _buildEscalaCriterios();
  // Refrescar matrices activas en gestión
  if (typeof _buildMiniPerfilGrid === "function") _buildMiniPerfilGrid();
}
window._criterioMover = _criterioMover;

// ── Guardar escala ────────────────────────────────────────────────────────────
/**
 * @interaction guardar-escala
 * @scope profesor-escala-save-flow
 *
 * Given escala con criterios pendientes de guardar.
 * When click en botón "💾 Guardar escala" del panel actions.
 * Then:
 *   1. Validation pre-save:
 *      - baseTotal < 100 → toast "debe sumar 100%" + bloqueante.
 *      - baseTotal > 100 → toast "no puede exceder 100%" + bloqueante.
 *      - extraTotal > 20 → toast "no puede exceder 20%" + bloqueante.
 *   2. **Bifurcación por estado**:
 *      - Si `esc.guardado === false` (primera vez): save directo →
 *        `guardado=true`, reset dirty/snapshot, repaint (tabs+criterios+
 *        mat-cards), toast success.
 *      - Si `esc.guardado === true` (re-save): abre `modal-confirmar-escala`
 *        con advertencia ⚠ "puede afectar el rendimiento de tus alumnos".
 *        User decide confirmar → dispara `ejecutarGuardarEscala`.
 * Edge:
 *   - Sin escala activa → no-op.
 *   - **Asimetría save**: primera vez sin confirm; re-save SIEMPRE pide
 *     confirm. Decisión consciente UX (alumnos ya capturados con la
 *     escala original).
 *   - Toasts son advertencias bloqueantes sobre el botón (que ya está
 *     disabled en estos casos por `_buildEscalaCriterios`) — defensa
 *     contra llamada programática.
 *   - **Exportado en window** (onclick inline).
 *   - **Modo DEMO**: el save solo muta `esc.guardado` in-memory; el state
 *     se persiste implícitamente en `_escalaState` module-scope hasta
 *     logout o refresh. NO escribe a localStorage ni DEMO_ESCALAS.
 *   - Deuda post-Supabase: save real via `DataService.saveEscala()` con
 *     RLS por profesor + tabla auditoría.
 */
function guardarEscala() {
  const esc        = _escalaState[_escalaMat]?.[_escalaParcial - 1];
  if (!esc) return;
  const baseTotal  = _escalaBaseTotal(esc);
  const extraTotal = _escalaExtraTotal(esc);
  if (baseTotal < 100) { showToast("La calificación base debe sumar 100% (actualmente " + baseTotal + "%)", "info"); return; }
  if (baseTotal > 100) { showToast("La calificación base no puede exceder 100%", "info");  return; }
  if (extraTotal > 20) { showToast("La calificación extra no puede exceder 20%", "info");  return; }

  if (!esc.guardado) {
    esc.guardado    = true;
    _escalaDirty    = false;
    _escalaSnapshot = null;
    _persistEscalaState(esc);
    _buildEscalaTabs();
    _buildEscalaCriterios();
    _buildEscalaMatCards();
    showToast("Escala de evaluación guardada correctamente", "success");
  } else {
    const m = _escalaMaterias.find((x) => x.id === _escalaMat);
    document.getElementById("confirmar-escala-materia").textContent = (m?.nombre || _escalaMat) + " · Parcial " + _escalaParcial;
    document.getElementById("confirmar-escala-titulo").textContent  = "Modificar escala";
    document.getElementById("confirmar-escala-mensaje").innerHTML   =
      "No es recomendable modificar la escala de evaluación una vez definida, ya que <strong style='color:var(--xahni-amber)'>puede afectar el rendimiento de tus alumnos</strong>.<br><br>¿Deseas guardar los cambios de todas formas?";
    openModal("modal-confirmar-escala");
  }
}

/**
 * @interaction ejecutar-guardar-escala
 * @scope profesor-escala-save-flow
 *
 * Given user en `modal-confirmar-escala` (caso re-save de una escala
 *   previamente guardada).
 * When click en botón confirmar "Guardar de todos modos".
 * Then:
 *   1. Setea `esc.guardado = true` (preserva ya-guardado-true; idempotente).
 *   2. Cleanup dirty/snapshot.
 *   3. Cierra modal.
 *   4. Repaint (tabs + criterios + mat-cards) — los 3 lugares donde
 *      "guardado" se refleja visualmente.
 *   5. Toast success.
 * Edge:
 *   - Sin escala activa → no muta `guardado` pero ejecuta cleanup/repaint
 *     (no-op semánticamente útil).
 *   - **Esta fn solo dispara para CONFIRM RE-SAVE** — primera vez NO pasa por
 *     aquí (`guardarEscala` save directo). Asimetría documentada en aquel.
 *   - **Exportado en window** (onclick inline modal).
 *   - Función IMPURA.
 *   - **No re-valida**: las validaciones ya pasaron en `guardarEscala`
 *     antes de abrir el modal. Si el state cambió entre apertura y confirm
 *     (corner case raro), se guarda con el state actual sin re-validar.
 *     Aceptable porque el modal no permite edits.
 */
function ejecutarGuardarEscala() {
  const esc = _escalaState[_escalaMat]?.[_escalaParcial - 1];
  if (esc) {
    esc.guardado = true;
    _persistEscalaState(esc);
  }
  _escalaDirty    = false;
  _escalaSnapshot = null;
  closeModal("modal-confirmar-escala");
  _buildEscalaTabs();
  _buildEscalaCriterios();
  _buildEscalaMatCards();
  showToast("Escala de evaluación guardada correctamente", "success");
}

/**
 * Sincroniza el state in-memory con DEMO_ESCALAS (autoridad local) + emite
 * xahni:escalaGuardada para que firestore-sync persista a Firestore en prod.
 * Llamado desde guardarEscala() y ejecutarGuardarEscala() tras setear
 * esc.guardado = true.
 */
function _persistEscalaState(esc) {
  if (!esc || !_escalaMat || !APP?.user?.id) return;

  // Construye criterios con id estable (necesario para progreso_escala lookups
  // y dashboard de gestión que itera por criterio).
  const criteriosCanonical = (esc.criterios || []).map((c, i) => ({
    id:       c.id || `c-${_escalaMat}-${_escalaParcial}-${i + 1}`,
    nombre:   c.nombre,
    pct:      c.pct,
    extra:    !!c.extra,
    valorMax: c.valorMax || 10,
    vinculo:  c.vinculo || "manual",
    tipo:     c.tipo || "manual"
  }));

  // Persiste UNA escala POR cada grupo asignado a la materia (no solo a los
  // grupos del profesor). Lookups en gestion.js usan
  // `grupoPrincipal = m.grupos[0]` que puede no estar en user.grupos. Vista
  // alumno busca por su propio grupoId. Persistir para todos garantiza que
  // ambos consumidores encuentren la escala canonical.
  const matObj = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
    .find(m => m.id === _escalaMat);
  const gruposCandidatos = Array.isArray(matObj?.grupos) ? matObj.grupos : [];
  const gruposProfesor   = Array.isArray(APP.user.grupos) ? APP.user.grupos : [];
  const gruposFinales    = gruposCandidatos.length
    ? gruposCandidatos
    : (gruposProfesor.length ? gruposProfesor : [null]);

  gruposFinales.forEach(grupoId => {
    const escalaId = grupoId
      ? `${_escalaMat}_${grupoId}_${_escalaParcial}`
      : `${_escalaMat}_p${_escalaParcial}`;
    const payload = {
      id:         escalaId,
      materiaId:  _escalaMat,
      grupoId:    grupoId || null,
      parcial:    _escalaParcial,         // shape legacy gestion/calificaciones
      parcialNum: _escalaParcial,         // shape escala.js
      creadoPor:  APP.user.id,
      guardado:   true,
      cerrado:    false,
      criterios:  criteriosCanonical
    };
    if (typeof DEMO_ESCALAS !== "undefined") {
      const idx = DEMO_ESCALAS.findIndex(e => e.id === escalaId);
      if (idx >= 0) DEMO_ESCALAS[idx] = payload;
      else DEMO_ESCALAS.push(payload);
    }
    try {
      document.dispatchEvent(new CustomEvent("xahni:escalaGuardada", {
        detail: { escala: payload }
      }));
    } catch (e) { /* defensive */ }
  });
}

// ── Cambios sin guardar ───────────────────────────────────────────────────────
/**
 * @interaction descartar-cambios-escala
 * @scope profesor-escala-save-flow
 *
 * Given user en `modal-cambios-pendientes` que se abrió porque intentó
 *   switch materia/parcial con dirty pendientes.
 * When click botón "Descartar cambios" del modal.
 * Then:
 *   1. Si `_escalaSnapshot` existe: restore criterios desde snapshot
 *      (`esc.criterios = _escalaSnapshot.criterios` referencia directa).
 *      Clear snapshot.
 *   2. Reset `_escalaDirty = false`.
 *   3. Cierra modal.
 *   4. Toast info "Cambios descartados".
 *   5. **Trigger pending action**: si `_escalaPendingAction` está seteada
 *      (caller original que disparó el modal — e.g., `seleccionarEscalaMat`
 *      con dirty), ejecuta la acción ahora que el estado está limpio.
 *      Clear pending action.
 *   6. Si NO había pending action → re-build criterios (refresh visual).
 * Edge:
 *   - **Snapshot reference shallow**: `esc.criterios = snapshot.criterios`
 *     reasigna referencia. Esto es seguro porque el snapshot fue creado con
 *     `JSON.parse(JSON.stringify())` en `_escalaMarkDirty` (deep clone
 *     desconectado del estado).
 *   - **Pending action retry**: el patrón permite UX continuo — user clickea
 *     switch materia con dirty → modal → "descartar" → switch ejecuta
 *     automáticamente sin segundo click. Cementado en slice escala 2026-01.
 *   - Sin snapshot (caso raro: dirty=true sin snapshot por flujo bug) →
 *     no restore pero sí cleanup + modal close.
 *   - **Exportado en window** (onclick inline modal).
 *   - Función IMPURA (DOM + state + dispatch).
 */
function descartarCambiosEscala() {
  if (_escalaSnapshot) {
    const esc = _escalaState[_escalaSnapshot.mat]?.[_escalaSnapshot.parcial - 1];
    if (esc) esc.criterios = _escalaSnapshot.criterios;
    _escalaSnapshot = null;
  }
  _escalaDirty = false;
  closeModal("modal-cambios-pendientes");
  showToast("Cambios descartados", "info");

  if (_escalaPendingAction) {
    const action = _escalaPendingAction;
    _escalaPendingAction = null;
    action();
  } else {
    _buildEscalaCriterios();
  }
}

// El dashboard del profesor (buildDashboardProfesor + helpers _buildProfDash*)
// vive ahora en js/profesor/dashboard.js — donde corresponde por cohesión.

// ═══════════════════════════════════════════════════════════
// C9 · Trasplante a hub-materia profesor
// escalaRender(panelId, matId, grupoActivo) inyecta el markup de
// views/profesor/escala.html (lazy, una vez) en el panel del
// hub-materia y pre-selecciona la materia activa. Llamado desde
// js/profesor/hub-aprendizaje.js (profHubMatSwitchTab).
//
// El parámetro grupoActivo se acepta para API consistency pero
// escala.js deriva el grupo internamente del primer grupo de la
// materia (m.grupos[0]). Refactor "1 escala por (materia,grupo)"
// es deuda separada.
// ═══════════════════════════════════════════════════════════

/**
 * @interaction escala-render
 * @scope profesor-escala-entry-hub-c9
 *
 * Given panelId del tab Calificaciones del hub-materia + matId del materia
 *   abierta + _grupoActivo (aceptado por API consistency, NO usado
 *   internamente).
 * When `_profMatDispatchTabRender("calificaciones", ...)` lo invoca al
 *   switch del tab.
 * Then async pipeline:
 *   1. Resuelve panel. Sin → no-op.
 *   2. **Hardening dual-paint** (asistencia bug #7 pattern, commit 646e3ae):
 *      chequea `panel.querySelector("#escala-mat-cards")` (no flag
 *      module-scope) — si está, NO re-fetcha. Cubre recovery tras placeholder
 *      de parcial futuro que reemplazó el HTML del panel.
 *   3. Lazy fetch `views/profesor/escala.html`:
 *      - HTTP error → console.error + x-empty fallback en panel.
 *      - Success → `panel.innerHTML = await res.text()`.
 *      - **Hide redundancias dentro del hub**: `#escala-mat-cards`
 *        (picker), `#escala-placeholder`, `.page-header` (header standalone)
 *        → display:none. El hub-materia ya provee contexto.
 *   4. `buildEscalaEvaluacion()` — init idempotente (early-return si
 *      `_escalaUserId` ya está).
 *   5. Pre-select materia activa via `seleccionarEscalaMat(matId)` si
 *      provista.
 * Edge:
 *   - panel ausente → no-op.
 *   - Fetch error → x-empty fallback (no crash; user reintenta cambiando tab).
 *   - **_grupoActivo aceptado pero NO usado**: `escala.js` deriva el grupo
 *     internamente del primer grupo de la materia (`m.grupos[0]`).
 *     Documentado como deuda separada en el comentario superior del bloque:
 *     "Refactor 1 escala por (materia, grupo) es deuda separada".
 *   - **Async function** (única en el archivo).
 *   - **Exportado en window** (consumer cross-archivo:
 *     `_profMatDispatchTabRender` en hub-aprendizaje.js).
 *   - Función IMPURA (DOM + fetch + state init).
 *   - Deuda post-Supabase: SSR del shell + lazy load reactivo de criterios.
 */
async function escalaRender(panelId, matId, _grupoActivo) {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  // Hardening 2026-05-24 (slice panel-injection): usar presencia del markup
  // canónico (#escala-mat-cards) en lugar de un flag module-scope. El
  // dispatcher hide ese elemento con display:none tras inyectar, pero el id
  // sigue en el DOM. Cubre recovery tras placeholder de parcial futuro.
  // Patrón asistencia bug #7 (commit 646e3ae).
  if (!panel.querySelector("#escala-mat-cards")) {
    try {
      const res = await fetch("views/profesor/escala.html");
      if (!res.ok) throw new Error("status " + res.status);
      panel.innerHTML = await res.text();

      // Ocultar redundancias dentro del hub-materia: ya estamos en una
      // materia, no necesitamos el picker (cards) ni el page-header
      // (título + descripción + botones de la vista standalone).
      const matCards = panel.querySelector("#escala-mat-cards");
      if (matCards) matCards.style.display = "none";
      const placeholder = panel.querySelector("#escala-placeholder");
      if (placeholder) placeholder.style.display = "none";
      const pageHead = panel.querySelector(".page-header");
      if (pageHead) pageHead.style.display = "none";
    } catch (err) {
      console.error("[escalaRender] no se pudo cargar escala.html:", err);
      panel.innerHTML = '<div class="x-empty"><div class="x-empty__title">No se pudo cargar la vista de escala</div></div>';
      return;
    }
  }

  // Inicializa state (idempotente: early-return si _escalaUserId ya está)
  buildEscalaEvaluacion();
  // Pre-selecciona la materia activa del hub-materia
  if (matId && typeof seleccionarEscalaMat === "function") {
    seleccionarEscalaMat(matId);
  }
}
window.escalaRender = escalaRender;
