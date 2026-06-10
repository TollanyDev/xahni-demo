// js/profesor/recursos.js
// Recursos del profesor: catálogo de recursos y periodo académico

let _recTipo  = "todos";
let _recMat   = "todas";
let _recQuery = "";
let _recData  = []; // copia de sesión inicializada desde DEMO_RECURSOS

// ── Periodo escolar (derivado del grupo del profesor) ─────────────────────────
const PROF_PERIODO_ADVERTENCIA_DIAS = 7;

/**
 * @interaction prof-periodo-activo
 * @scope profesor-recursos-helper-periodo
 *
 * Given el profesor logueado (APP.user.id).
 * When `_profDiasAlCierre`, `_buildProfRecursosPeriodoInfo` o
 *   `_buildProfRecursosAlerta` necesitan el periodo activo del profesor
 *   para mostrar countdown + alertas de cierre.
 * Then resolución cascada:
 *   1. Sin uid → null.
 *   2. Primera materia del profesor (filtra DEMO_MATERIAS por profesorId).
 *   3. Primer grupo de esa materia (`m.grupos[0]`).
 *   4. `getPeriodoDeGrupo(gid)` → periodo raw.
 *   5. Retorna `{nombre, inicio: Date, cierre: Date, advertencia: 7}`.
 * Edge:
 *   - Sin materias asignadas → null.
 *   - Materia sin grupos → gid undefined → null.
 *   - `getPeriodoDeGrupo` ausente parse-time → null.
 *   - **Asimetría con resto del rol**: este helper usa SOLO la primera
 *     materia + primer grupo (sin selector). Decisión consciente para
 *     vista de recursos que NO segmenta por grupo (§6.1 spec). El periodo
 *     mostrado es representativo del calendario académico general, no
 *     específico al recurso o materia visualizada.
 *   - Helper LOCAL.
 *   - Función PURA (lookup + transform).
 *   - Deuda post-Supabase: query `periodos` con join a `usuarios.materias`.
 */
function _profPeriodoActivo() {
  const uid = APP?.user?.id;
  if (!uid) return null;
  // Primera materia del profesor → PRIMER GRUPO VÁLIDO → periodo de ese grupo.
  // Bug M2 2026-06-09: `mat.grupos[0]` puede ser legacy (ej. "ISC-3A") que ya
  // no existe en DEMO_GRUPOS tras la migración a ids canónicos `grupo-smoke-*`.
  // Aplicar la regla rectora "primer grupo válido" (memoria `feedback_grupoprincipal_primer_grupo_valido`).
  const mat = (DEMO_MATERIAS || []).find(m => m.profesorId === uid);
  if (!mat) return null;
  const gruposCatalog = (typeof DEMO_GRUPOS !== "undefined" && Array.isArray(DEMO_GRUPOS)) ? DEMO_GRUPOS : [];
  const validIds = new Set(gruposCatalog.map(g => g.id));
  const gid = (mat.grupos || []).find(id => validIds.has(id)) || (mat.grupos || [])[0];
  if (!gid) return null;
  const p = (typeof getPeriodoDeGrupo === "function") ? getPeriodoDeGrupo(gid) : null;
  if (!p) return null;
  return {
    nombre:      p.nombre || "Periodo actual",
    inicio:      new Date(p.inicio),
    cierre:      new Date(p.fin),
    advertencia: PROF_PERIODO_ADVERTENCIA_DIAS,
  };
}

/**
 * @interaction prof-dias-al-cierre
 * @scope profesor-recursos-helper-periodo
 *
 * Given el periodo activo del profesor.
 * When `buildRecursosProfesor` necesita el countdown para semáforo de alerta.
 * Then:
 *   - Sin periodo → null.
 *   - Math.ceil((cierre - now) / 86400000) — días enteros restantes.
 * Edge:
 *   - **`Math.ceil` consciente**: 0.1 día = 1 día visible (no 0). Decisión
 *     UX: nunca mostrar "0 días" mientras el periodo siga abierto.
 *   - Periodo vencido → resultado negativo (`buildRecursosProfesor` evalúa
 *     `<= 0` como "periodoCerrado").
 *   - 86400000 = ms en 1 día. Constante hardcoded; deuda: const NAMED.
 *   - Función PURA respecto a inputs.
 *   - Helper LOCAL.
 */
function _profDiasAlCierre() {
  const p = _profPeriodoActivo();
  if (!p) return null;
  return Math.ceil((p.cierre - new Date()) / 86400000);
}
/**
 * @interaction prof-format-fecha-periodo
 * @scope profesor-recursos-helper-fecha
 *
 * Given un Date d.
 * When card periodo + alerta de cierre muestran fechas legibles.
 * Then `toLocaleDateString("es-MX", {day:"2-digit", month:"short", year:"numeric"})`
 *   → "15 mar 2026".
 * Edge:
 *   - Date inválido (NaN) → "Invalid Date" (locale string).
 *   - **Locale "es-MX" hardcoded**: deuda consolidación con `_profFormatActivityDate`
 *     (dashboard) y otros 4+ helpers fecha cross-archivo. Deuda
 *     `_formatFechaLocale` canonical pendiente.
 *   - Función PURA.
 *   - Helper LOCAL.
 */
function _profFormatFechaPeriodo(d) {
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Helpers de materia desde DEMO_MATERIAS ────────────────────────────────────
const _REC_MAT_PALETTE = ["teal","amber","blue","purple","green","red"];

/**
 * @interaction rec-mat-color
 * @scope profesor-recursos-helper-paleta
 *
 * Given matId.
 * When `_buildMatSection` necesita CSS var color para el dot + accent
 *   de la sección por materia.
 * Then:
 *   1. findIndex en DEMO_MATERIAS → idx; capeado a 0 si -1.
 *   2. Módulo 6 sobre `_REC_MAT_PALETTE` (teal/amber/blue/purple/green/red).
 *   3. **Asimetría blue**: si name === "blue", retorna `var(--xahni-blue-light)`
 *      (la paleta base blue es muy oscura para sections). Las otras 5 usan
 *      el var directo.
 * Edge:
 *   - matId no en DEMO_MATERIAS → idx=0 → primer color (teal).
 *   - **DETERMINISTA por orden** de materias en DEMO_MATERIAS. Cambios de
 *     orden por admin → colores rotan. Aceptado.
 *   - Función PURA.
 *   - Helper LOCAL.
 *   - **Twin de `_profMatColor` (dashboard)**: misma paleta 6 + misma
 *     asimetría blue. Cementado cross-archivo del rol.
 */
function _recMatColor(matId) {
  const idx = (DEMO_MATERIAS || []).findIndex((m) => m.id === matId);
  const name = _REC_MAT_PALETTE[Math.max(0, idx) % _REC_MAT_PALETTE.length];
  return name === "blue" ? "var(--xahni-blue-light)" : `var(--xahni-${name})`;
}
/**
 * @interaction rec-mat-nombre
 * @scope profesor-recursos-helper-lookup
 *
 * Given matId.
 * When `_buildMatSection` muestra el header con nombre legible.
 * Then lookup en DEMO_MATERIAS, fallback al matId raw si no encontrado.
 * Edge:
 *   - DEMO_MATERIAS no cargado → `({}).nombre` = undefined → fallback matId.
 *   - **Encadenamiento defensive** `(... || {}).nombre || matId` evita crash
 *     y siempre retorna string.
 *   - Función PURA.
 *   - Helper LOCAL.
 */
function _recMatNombre(matId) {
  return ((DEMO_MATERIAS || []).find((m) => m.id === matId) || {}).nombre || matId;
}
/**
 * @interaction rec-mat-bg
 * @scope profesor-recursos-helper-paleta
 *
 * Given matId.
 * When `_buildRecItem` pinta el rec-type-icon con background coloreado por
 *   materia para distinguir agrupaciones visualmente.
 * Then:
 *   1. Mismo idx rotativo que `_recMatColor`.
 *   2. Retorna nombre CSS class `xahni-{name}-dim` (e.g., "xahni-teal-dim").
 *      El caller compone `var(--${result})` para el background efectivo.
 * Edge:
 *   - **Retorna NOMBRE de variable (no var() completo)** — divergencia con
 *     `_recMatColor` que retorna `var(...)` completo. Caller responsable de
 *     componer la sintaxis. Decisión: `_recMatColor` se inyecta directo en
 *     style; `_recMatBg` permite caller decidir prefix.
 *   - Función PURA.
 *   - Helper LOCAL.
 */
function _recMatBg(matId) {
  const idx  = (DEMO_MATERIAS || []).findIndex((m) => m.id === matId);
  const name = _REC_MAT_PALETTE[Math.max(0, idx) % _REC_MAT_PALETTE.length];
  return `xahni-${name}-dim`;
}

// ── Iconos por tipo ───────────────────────────────────────────────────────────
// "enlace" agregado 2026-06-09 (bug M2): el sweep firestore introdujo recursos
// con tipo "enlace" (URL externa), pero el módulo solo aceptaba 5 tipos de
// archivo y el render fallaba en silencio. Mismo chip class que PDF para
// reutilizar paleta sin duplicar CSS.
const _REC_ICONOS = { PDF: "📄", VIDEO: "🎬", PPT: "📊", ZIP: "🗜️", DOCX: "📝", enlace: "🔗" };
const _REC_TIPO_CHIP = { PDF: "rec-chip-pdf", VIDEO: "rec-chip-video", PPT: "rec-chip-ppt", ZIP: "rec-chip-zip", DOCX: "rec-chip-docx", enlace: "rec-chip-pdf" };

// Helper canonical: lee profUid (shape Firestore) con fallback a profesorId (seed legacy).
// Sweep firestore 2026-06-08 cementó profUid como canonical pero los seeds JSON
// pueden tener profesorId. Cualquier consumidor del array de recursos debe pasar
// por este helper para no romper cross-source.
function _recProfUid(r) {
  return (r && (r.profUid || r.profesorId)) || null;
}

/**
 * @interaction rec-fecha-str
 * @scope profesor-recursos-helper-fecha
 *
 * Given iso string (`r.fechaSubida`) o null.
 * When `_buildRecItem` muestra la fecha de subida en la meta del recurso.
 * Then:
 *   - iso falsy → "—".
 *   - try toLocaleDateString → "15 mar 2026".
 *   - catch (iso malformado) → iso raw como fallback.
 * Edge:
 *   - **try/catch defensive**: `new Date(invalidString)` no tira, retorna
 *     Invalid Date que .toLocaleDateString sí podría tirar en motores
 *     muy viejos. Defensa por compatibilidad.
 *   - Locale "es-MX" hardcoded — mismo issue que `_profFormatFechaPeriodo`.
 *   - Función PURA.
 *   - Helper LOCAL.
 */
function _recFechaStr(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
}

// ── Período info ──────────────────────────────────────────────────────────────
/**
 * @interaction build-prof-recursos-periodo-info
 * @scope profesor-recursos-render-card-periodo
 *
 * Given diasRestant (number | 0) + periodoCerrado (bool) + DOM con
 *   `#prof-recursos-periodo-info`.
 * When `buildRecursosProfesor` orquesta el render top de la vista.
 * Then card con:
 *   - Header: nombre periodo + fechas formateadas (`_profFormatFechaPeriodo`).
 *   - Stats: count total recursos + días al cierre coloreado:
 *     - periodoCerrado → red.
 *     - ≤3 días → red (urgente).
 *     - ≤7 días (advertencia) → amber.
 *     - else → green.
 *   - Texto: "Periodo cerrado" o "N día(s)".
 *   - Progress bar: `pctTranscurrido = (now - inicio) / (cierre - inicio)`
 *     capeado a 100. Brand gradient horizontal.
 * Edge:
 *   - DOM target ausente → no-op.
 *   - Periodo ausente (`_profPeriodoActivo` null) → innerHTML "" (clear).
 *   - pctTranscurrido puede ser negativo si periodo en futuro → Math.round
 *     genera valor; visualmente width:-Npx no rinde (browser cap a 0).
 *   - **innerHTML directo** con `p.nombre` — fuente DEMO controlada;
 *     deuda XSS pre-Supabase.
 *   - Helper LOCAL (sin window export).
 *   - Función IMPURA (DOM).
 */
function _buildProfRecursosPeriodoInfo(diasRestant, periodoCerrado) {
  const el = document.getElementById("prof-recursos-periodo-info");
  if (!el) return;
  const p = _profPeriodoActivo();
  if (!p) { el.innerHTML = ""; return; }

  const totalArchivos = _recData.length;
  const pctTranscurrido = Math.min(
    Math.round(((new Date() - p.inicio) / (p.cierre - p.inicio)) * 100),
    100,
  );
  const colorDias = periodoCerrado
    ? "var(--xahni-red)"
    : diasRestant <= 3
      ? "var(--xahni-red)"
      : diasRestant <= p.advertencia
        ? "var(--xahni-amber)"
        : "var(--xahni-green)";
  const textoDias = periodoCerrado ? "Periodo cerrado" : `${diasRestant} día${diasRestant !== 1 ? "s" : ""}`;

  el.innerHTML = `
    <div class="rec-periodo-header">
      <div>
        <div class="rec-periodo-nombre">${p.nombre}</div>
        <div class="rec-periodo-fechas">${_profFormatFechaPeriodo(p.inicio)} — ${_profFormatFechaPeriodo(p.cierre)}</div>
      </div>
      <div class="rec-periodo-stats">
        <div class="rec-periodo-stat">
          <span class="rec-periodo-stat-val">${totalArchivos}</span>
          <span class="rec-periodo-stat-label">recursos</span>
        </div>
        <div class="rec-periodo-stat">
          <span class="rec-periodo-stat-val" style="color:${colorDias}">${textoDias}</span>
          <span class="rec-periodo-stat-label">para cierre</span>
        </div>
      </div>
    </div>
    <div style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px">
        <span style="font-size:11px;color:var(--text-muted)">Progreso del periodo escolar</span>
        <span style="font-size:11px;font-family:var(--font-mono);color:var(--text-muted)">${pctTranscurrido}%</span>
      </div>
      <div class="progress-bar" style="height:5px">
        <div style="height:100%;width:${pctTranscurrido}%;background:var(--brand-gradient-h);border-radius:99px;transition:width 1s ease"></div>
      </div>
    </div>`;
}

/**
 * @interaction build-prof-recursos-alerta
 * @scope profesor-recursos-render-alerta
 *
 * Given diasRestant + periodoCerrado + DOM con
 *   `#prof-recursos-periodo-alerta`.
 * When `buildRecursosProfesor` orquesta render.
 * Then banner contextual de 3 estados:
 *   1. **periodoCerrado**: clase `.alerta-peligro` + icono 🔴 + título
 *      "Periodo escolar cerrado — Los recursos serán eliminados" + desc
 *      "permanentemente en las próximas 24 horas". display:flex.
 *   2. **diasRestant ≤ advertencia (7)**:
 *      - esUrgente = diasRestant ≤ 3 → clase `.alerta-urgente` + icono ⚠️
 *        + título "¡Atención!".
 *      - else → clase `.alerta-aviso` + icono 📅 + título "Aviso:".
 *      Desc común con fecha cierre + nombre periodo + nota "notificar a
 *      alumnos". display:flex.
 *   3. **Else** (> 7 días, normal): display:none.
 * Edge:
 *   - DOM target ausente → no-op.
 *   - Periodo ausente → hide silenciosamente.
 *   - **Advertencia "eliminados en 24h" es DEMO** — no hay auto-delete en
 *     vanilla. Texto pre-Supabase: cuando Storage tenga TTL automático,
 *     el banner refleja la realidad. Por ahora es flavor text.
 *   - **innerHTML con `p.nombre`** sin escape — DEMO controlado.
 *   - Función IMPURA (DOM).
 *   - Helper LOCAL.
 */
function _buildProfRecursosAlerta(diasRestant, periodoCerrado) {
  const el = document.getElementById("prof-recursos-periodo-alerta");
  if (!el) return;
  const p = _profPeriodoActivo();
  if (!p) { el.style.display = "none"; return; }

  if (periodoCerrado) {
    el.className = "rec-alerta alerta-peligro";
    el.innerHTML = `
      <div class="rec-alerta-icono">🔴</div>
      <div class="rec-alerta-cuerpo">
        <div class="rec-alerta-titulo">Periodo escolar cerrado — Los recursos serán eliminados</div>
        <div class="rec-alerta-desc">El periodo <strong>${p.nombre}</strong> ha concluido.
          Los recursos didácticos serán eliminados <strong>permanentemente en las próximas 24 horas</strong>.
          Descarga los materiales que desees conservar.</div>
      </div>`;
    el.style.display = "flex";
  } else if (diasRestant <= p.advertencia) {
    const esUrgente = diasRestant <= 3;
    el.className = `rec-alerta ${esUrgente ? "alerta-urgente" : "alerta-aviso"}`;
    el.innerHTML = `
      <div class="rec-alerta-icono">${esUrgente ? "⚠️" : "📅"}</div>
      <div class="rec-alerta-cuerpo">
        <div class="rec-alerta-titulo">
          ${esUrgente ? "¡Atención!" : "Aviso:"} El periodo escolar cierra en
          <strong>${diasRestant} día${diasRestant !== 1 ? "s" : ""}</strong>
        </div>
        <div class="rec-alerta-desc">
          Al cerrar el <strong>${_profFormatFechaPeriodo(p.cierre)}</strong>,
          todos los recursos del periodo <em>${p.nombre}</em>
          serán eliminados automáticamente. Recuerda notificar a tus alumnos.
        </div>
      </div>`;
    el.style.display = "flex";
  } else {
    el.style.display = "none";
  }
}

// ── Render de ítems ───────────────────────────────────────────────────────────
/**
 * @interaction build-rec-item
 * @scope profesor-recursos-render-item
 *
 * Given un recurso `r` (shape `{id, titulo, tipo, materiaId, fechaSubida}`).
 * When `_buildMatSection` itera los items de una materia.
 * Then `<div class="rec-item">` con:
 *   - icon tipo coloreado por materia (background `var(--${_recMatBg(matId)})`
 *     + emoji de `_REC_ICONOS[tipo]` con fallback 📎).
 *   - info: nombre + chip tipo (`.rec-chip-{tipo-lowercase}`) + fecha.
 *   - actions: botón Editar (svg + onclick `editarRecurso('id')`) + botón
 *     Eliminar (svg + onclick con doble escape para apóstrofe).
 * Edge:
 *   - **`_escapeHtml` canonical** consumido (NO helper local) — slice
 *     recursos respetó el escape canonical desde el principio. Pattern
 *     positivo cross-archivo.
 *   - **Doble escape para `onclick` apóstrofe**: `_escapeHtml(r.titulo).replace(/'/g, "\\'")`
 *     porque el toast del eliminar muestra el nombre y entra inline en JS
 *     attribute. Patrón único en el archivo.
 *   - Función PURA (retorna string HTML).
 *   - Helper LOCAL.
 */
function _buildRecItem(r) {
  const bg       = _recMatBg(r.materiaId);
  const chipClass = _REC_TIPO_CHIP[r.tipo] || "";
  return `<div class="rec-item">
    <div class="rec-type-icon" style="background:var(--${bg})">${_REC_ICONOS[r.tipo] || "📎"}</div>
    <div class="rec-item-info">
      <div class="rec-item-name">${_escapeHtml(r.titulo)}</div>
      <div class="rec-item-meta">
        <span class="rec-type-chip ${chipClass}">${_escapeHtml(r.tipo)}</span>
        <span>${_recFechaStr(r.fechaSubida)}</span>
      </div>
    </div>
    <div class="rec-item-actions">
      <button class="prof-accion-btn" onclick="editarRecurso('${r.id}')" title="Editar"><svg class="x-icon"><use href="#x-icon-edit"></use></svg></button>
      <button class="prof-accion-btn rec-btn-danger" onclick="eliminarRecurso('${r.id}','${_escapeHtml(r.titulo).replace(/'/g, "\\'")}')" title="Eliminar"><svg class="x-icon"><use href="#x-icon-trash"></use></svg></button>
    </div>
  </div>`;
}

/**
 * @interaction build-mat-section
 * @scope profesor-recursos-render-section
 *
 * Given matId + items[] (recursos de esa materia).
 * When `buildRecursosProfesor` agrupa data por materia (`porMat`) y mappea
 *   cada grupo a una section.
 * Then `<div class="rec-mat-section">` con:
 *   - CSS custom prop `--mat-color: var(--xahni-{name})` (consumed por
 *     `.rec-mat-dot` + accents).
 *   - Header: dot color + nombre materia (escapado) + count items.
 *   - Lista items via `_buildRecItem`.
 * Edge:
 *   - items vacío → header con "0 archivos" + lista vacía. Caller filtra
 *     materias sin items.
 *   - `_escapeHtml` canonical consumido.
 *   - Función PURA.
 *   - Helper LOCAL.
 *   - **CSS custom prop pattern**: convención cementada del slice; permite
 *     que múltiples elementos hijos consuman el color de la materia sin
 *     repetir la lookup.
 */
function _buildMatSection(matId, items) {
  const colorVar = _recMatColor(matId);
  return `<div class="rec-mat-section" style="--mat-color:${colorVar}">
    <div class="rec-mat-header">
      <div class="rec-mat-dot"></div>
      <span class="rec-mat-nombre">${_escapeHtml(_recMatNombre(matId))}</span>
      <span class="rec-mat-count">${items.length} archivo${items.length !== 1 ? "s" : ""}</span>
    </div>
    <div class="rec-items-list">${items.map(_buildRecItem).join("")}</div>
  </div>`;
}

// ── Filtro de materias (dinámico) ─────────────────────────────────────────────
/**
 * @interaction build-rec-mat-select
 * @scope profesor-recursos-render-filtro
 *
 * Given `.rec-mat-select` presente en DOM + APP.user.
 * When `buildRecursosProfesor` orquesta init.
 * Then popula el `<select>` con:
 *   - Opción default "Todas las materias" (value="todas").
 *   - Una opción por cada materia del profesor (filtra DEMO_MATERIAS).
 *     Selected si matches `_recMat` actual (preserva filtro tras repaint).
 * Edge:
 *   - DOM target ausente → no-op (vista no cargada).
 *   - APP.user null → no-op.
 *   - **innerHTML reescritura completa**: pierde focus si el usuario tenía
 *     el select abierto durante un repaint. Aceptable: filtro repaint es
 *     rápido y el usuario click → cambia → cierra.
 *   - `_escapeHtml` canonical en value e nombre — defensive aunque DEMO
 *     controlado.
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM).
 */
function _buildRecMatSelect() {
  const sel = document.querySelector(".rec-mat-select");
  if (!sel || !APP.user) return;
  const materias = (DEMO_MATERIAS || []).filter((m) => m.profesorId === APP.user.id);
  sel.innerHTML =
    `<option value="todas">Todas las materias</option>` +
    materias.map((m) => `<option value="${_escapeHtml(m.id)}" ${_recMat === m.id ? "selected" : ""}>${_escapeHtml(m.nombre)}</option>`).join("");
}

// ── Builder principal ─────────────────────────────────────────────────────────
/**
 * @interaction build-recursos-profesor
 * @scope profesor-recursos-entrypoint
 *
 * Given APP.user activo tipo "profesor" + DOM con `#recursos-grid` y los
 *   targets de info/alerta/stats.
 * When `recursosProfRender` lo invoca post-fetch, o `filtrarRec*`/
 *   `confirmarEliminarRecurso`/`ejecutarAccionRecurso` repaint tras cambio.
 * Then orquesta render completo (~50 LOC):
 *   1. Guard tipo profesor → no-op.
 *   2. **Sync `_recData` con DEMO_RECURSOS preservando ediciones**:
 *      - Si `_recData` vacío: hidrata desde DEMO_RECURSOS (filter por
 *        profesorId, shallow copy).
 *      - Si ya tiene data: agrega solo registros nuevos del JSON (ids no
 *        ya presentes). PRESERVA ediciones/deletes de sesión anteriores.
 *   3. Calcula diasRestant + periodoCerrado.
 *   4. Sin periodo → renderea info/alerta con defaults silenciosos.
 *   5. Repaint alerta + periodo info + filtro materia select.
 *   6. Filtra data por tipo + materia + query (lower-case includes).
 *   7. Update stats label ("N archivos" o "N resultados para 'query'").
 *   8. Si data vacío → empty state.
 *   9. Agrupa por materia + map a sections.
 * Edge:
 *   - DEMO_RECURSOS no cargado → `_recData` queda como estaba (no hidrata
 *     vacío).
 *   - **Patrón "preserva ediciones"**: cementa el modelo "DEMO es source
 *     of truth + diff incremental". Permite que el usuario edite/elimine
 *     y los cambios persistan in-memory durante la sesión sin perderse
 *     al re-visitar el tab.
 *   - Filtro `tipo === "todos"` bypass; `_recMat === "todas"` bypass;
 *     query vacío bypass.
 *   - Search insensitive a case (titulo + tipo).
 *   - DOM target #recursos-grid ausente → early return tras updates de
 *     info/alerta/stats (split de responsabilidades aceptado).
 *   - Función IMPURA (mutaciones DOM + sync `_recData`).
 *   - **Exportado en window** (caller cross-archivo `recursosProfRender`
 *     + ejecutarAccionRecurso CRUD).
 */
function buildRecursosProfesor() {
  if (!APP.user || APP.user.tipo !== "profesor") return;

  // Inicializa o re-sincroniza desde DEMO_RECURSOS en cada visita
  if (typeof DEMO_RECURSOS !== "undefined" && Array.isArray(DEMO_RECURSOS)) {
    // Preserva ediciones de sesión: actualiza _recData sólo con registros nuevos del JSON.
    // Bug M2 2026-06-09: usar _recProfUid (profUid canonical Firestore o profesorId legacy).
    const existIds = new Set(_recData.map((r) => r.id));
    const fromDemo = DEMO_RECURSOS.filter((r) => _recProfUid(r) === APP.user.id && !existIds.has(r.id));
    if (!_recData.length) _recData = DEMO_RECURSOS.filter((r) => _recProfUid(r) === APP.user.id).map((r) => ({ ...r }));
    else _recData.push(...fromDemo.map((r) => ({ ...r })));
  }

  const diasRestant    = _profDiasAlCierre();
  if (diasRestant === null) {
    _buildProfRecursosAlerta(0, false);
    _buildProfRecursosPeriodoInfo(0, false);
    return;
  }
  const periodoCerrado = diasRestant <= 0;
  _buildProfRecursosAlerta(diasRestant, periodoCerrado);
  _buildProfRecursosPeriodoInfo(diasRestant, periodoCerrado);
  _buildRecMatSelect();

  const ql   = _recQuery.toLowerCase();
  const data = _recData.filter(
    (r) =>
      (_recTipo === "todos" || r.tipo === _recTipo) &&
      (_recMat  === "todas" || r.materiaId === _recMat) &&
      (!ql || r.titulo.toLowerCase().includes(ql) || r.tipo.toLowerCase().includes(ql)),
  );

  const statsEl = document.getElementById("prof-rec-stats");
  if (statsEl) {
    const label = ql
      ? `${data.length} resultado${data.length !== 1 ? "s" : ""} para "${_recQuery}"`
      : `${data.length} archivo${data.length !== 1 ? "s" : ""}`;
    statsEl.innerHTML = `<span class="rec-stats-text">${label}</span>`;
  }

  const el = document.getElementById("recursos-grid");
  if (!el) return;

  if (!data.length) {
    el.innerHTML = `<div class="x-empty"><div class="x-empty__icon"><svg class="x-icon x-icon--xl"><use href="#x-icon-search"></use></svg></div><div class="x-empty__title">Sin resultados${ql ? ` para "${_recQuery}"` : ""}</div></div>`;
    return;
  }

  const porMat = {};
  data.forEach((r) => { (porMat[r.materiaId] ??= []).push(r); });
  el.innerHTML = Object.entries(porMat).map(([mat, items]) => _buildMatSection(mat, items)).join("");
}

// ── Filtros ───────────────────────────────────────────────────────────────────
/**
 * @interaction filtros-rec
 * @scope profesor-recursos-handlers-filtro
 *
 * Given click en pill tipo / change `<select>` materia / input search.
 * When user interactúa con los filtros.
 * Then 3 handlers:
 *   - `filtrarRecTipo(tipo, btn)`: deselect siblings + active en btn +
 *     setea `_recTipo` + `buildRecursosProfesor`.
 *   - `filtrarRecMat(val)`: setea `_recMat` + repaint.
 *   - `buscarRecurso(q)`: setea `_recQuery` + repaint.
 * Edge:
 *   - `_recTipo` enum: "todos" | "PDF" | "VIDEO" | "PPT" | "ZIP" | "DOCX".
 *   - `_recMat` valor "todas" o matId.
 *   - `_recQuery` raw input (case-folded en filter de `buildRecursosProfesor`).
 *   - **Sin debounce en buscarRecurso**: cada keystroke triggea repaint
 *     completo. Aceptable para volumen DEMO. Deuda menor: debounce
 *     ~200ms post-Supabase para reducir queries.
 *   - **Exportados en window** (onclick/onchange/oninput inline).
 *   - Funciones IMPURAS (muta module-scope + DOM).
 */
function filtrarRecTipo(tipo, btn) {
  document.querySelectorAll(".rec-type-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  _recTipo = tipo;
  buildRecursosProfesor();
}
function filtrarRecMat(val) {
  _recMat = val;
  buildRecursosProfesor();
}
function buscarRecurso(q) {
  _recQuery = q;
  buildRecursosProfesor();
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
let _recEliminarId     = null;
let _recEliminarNombre = "";

/**
 * @interaction eliminar-recurso
 * @scope profesor-recursos-handler-eliminar
 *
 * Given click en botón 🗑 de un row de recurso.
 * When `_buildRecItem` onclick dispara con (id, nombre escapado).
 * Then:
 *   1. Guarda `_recEliminarId` + `_recEliminarNombre` para confirm modal.
 *   2. Setea texto del modal con nombre.
 *   3. Abre modal `modal-eliminar-recurso`.
 * Edge:
 *   - `nombre` arg ya viene escapado del inline onclick (`_escapeHtml`
 *     aplicado en `_buildRecItem`).
 *   - **Doble escape para apóstrofe** (ver `_buildRecItem`) garantiza que
 *     el nombre llega aquí como string literal seguro para textContent.
 *   - **Exportado en window** (onclick inline).
 *   - Función IMPURA.
 */
function eliminarRecurso(id, nombre) {
  _recEliminarId     = id;
  _recEliminarNombre = nombre;
  document.getElementById("prof-rec-eliminar-nombre").textContent = nombre;
  openModal("modal-eliminar-recurso");
}

/**
 * @interaction confirmar-eliminar-recurso
 * @scope profesor-recursos-handler-eliminar
 *
 * Given user en `modal-eliminar-recurso` tras click en 🗑.
 * When click "Eliminar" del modal.
 * Then:
 *   1. findIndex del id en `_recData` → splice si > -1.
 *   2. closeModal + buildRecursosProfesor (repaint).
 *   3. Toast info con nombre del eliminado.
 *   4. Cleanup state (`_recEliminarId` + `_recEliminarNombre` reset).
 * Edge:
 *   - id no en `_recData` (race con sync DEMO?) → no-op silencioso splice.
 *   - **Eliminación in-memory solo**: `_recData` muta pero DEMO_RECURSOS
 *     NO se toca. Patrón "sync preservando ediciones" en
 *     `buildRecursosProfesor` evita que el sync reincorpore el eliminado.
 *   - **Exportado en window** (onclick inline modal).
 *   - Función IMPURA.
 *   - Deuda post-Supabase: DELETE via `DataService.deleteRecurso(id)` +
 *     Storage cleanup + cascade (referencias en tareas).
 */
function confirmarEliminarRecurso() {
  const i = _recData.findIndex((r) => r.id === _recEliminarId);
  if (i > -1) _recData.splice(i, 1);
  closeModal("modal-eliminar-recurso");
  buildRecursosProfesor();
  showToast(`"${_recEliminarNombre}" eliminado`, "info");
  _recEliminarId     = null;
  _recEliminarNombre = "";
}

// ── Editar / Subir recurso ────────────────────────────────────────────────────
let _recEditId        = null;
let _recArchivoNombre = "";
let _recArchivoSize   = "";

const _REC_EXT_TIPO = {
  pdf:"PDF", docx:"DOCX", doc:"DOCX", pptx:"PPT", ppt:"PPT",
  xlsx:"DOCX", xls:"DOCX", mp4:"VIDEO", mov:"VIDEO", avi:"VIDEO",
  zip:"ZIP", rar:"ZIP", "7z":"ZIP", txt:"DOCX", csv:"DOCX",
  jpg:"PDF", jpeg:"PDF", png:"PDF",
};

/**
 * @interaction rec-tipo-desde-nombre
 * @scope profesor-recursos-helper-tipo-archivo
 *
 * Given nombre archivo (e.g., "tarea.pdf").
 * When `_recIconoDesdeNombre` / `_recMostrarArchivo` / `ejecutarAccionRecurso`
 *   necesitan inferir tipo categorizado desde la extensión.
 * Then split por "." + last segment lowercase → lookup en `_REC_EXT_TIPO`
 *   (17 mapeos). Fallback "PDF".
 * Edge:
 *   - **Mapping curioso**: jpg/jpeg/png → "PDF" (images como docs); xlsx/xls
 *     → "DOCX"; csv → "DOCX". Decisión histórica para reducir tipos
 *     visibles a 5 buckets (PDF, DOCX, PPT, VIDEO, ZIP). Caller no debería
 *     usar este para validation MIME.
 *   - Sin extensión → último segment = todo el nombre → lookup falla →
 *     fallback "PDF". Decisión: fallback a "PDF" es el más común.
 *   - Función PURA.
 *   - Helper LOCAL.
 *   - Deuda post-Supabase: schema `recurso.mime_type` explícito.
 */
function _recTipoDesdeNombre(nombre) {
  const ext = nombre.split(".").pop().toLowerCase();
  return _REC_EXT_TIPO[ext] || "PDF";
}
/**
 * @interaction rec-icono-desde-nombre
 * @scope profesor-recursos-helper-tipo-archivo
 *
 * Given nombre archivo.
 * When `_recMostrarArchivo` muestra el icon en el preview file del modal.
 * Then `_REC_ICONOS[_recTipoDesdeNombre(nombre)]` con fallback "📎"
 *   (clip genérico).
 * Edge:
 *   - Compose sobre `_recTipoDesdeNombre`. Si éste falla → "PDF" → icon "📄".
 *   - Función PURA.
 *   - Helper LOCAL.
 */
function _recIconoDesdeNombre(nombre) {
  return _REC_ICONOS[_recTipoDesdeNombre(nombre)] || "📎";
}
/**
 * @interaction rec-format-size
 * @scope profesor-recursos-helper-formato
 *
 * Given bytes (number).
 * When `_recArchivoSeleccionado` formatea el tamaño del file blob para
 *   mostrar en preview ("3.4 KB" / "12.5 MB").
 * Then 3 ramas:
 *   - < 1024 → "N B".
 *   - < 1048576 → "(N/1024).toFixed(1) KB".
 *   - else → "(N/1048576).toFixed(1) MB".
 * Edge:
 *   - bytes 0 → "0 B".
 *   - bytes negativos → comparación funciona normalmente; cae al primer
 *     bracket "- N B" (edge case raro; entradas usuario nunca negativas).
 *   - **Sin GB**: archivos > 1 GB → "N.N MB" gigante. Convención: subida
 *     limitada a few MB cliente-side.
 *   - **No usa SI vs IEC** explícito (1024 base = IEC binaria pero labels
 *     SI). Tradición histórica del módulo.
 *   - Función PURA.
 *   - Helper LOCAL.
 */
function _recFormatSize(bytes) {
  if (bytes < 1024)    return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

/**
 * @interaction rec-mostrar-archivo
 * @scope profesor-recursos-modal-preview
 *
 * Given nombre archivo + size formateado (e.g., "3.4 KB").
 * When `_recArchivoSeleccionado` (drag&drop o file input) detecta archivo,
 *   o `editarRecurso` muestra el archivo mock del recurso existente.
 * Then:
 *   1. Setea `_recArchivoNombre` + `_recArchivoSize` (module-scope).
 *   2. Hide dropzone, show preview con:
 *      - icon coloreado por tipo (lookup desde nombre).
 *      - nombre escapado (truncate via CSS ellipsis).
 *      - meta "TIPO · size" si size provided.
 *      - botones "Cambiar" (re-triggea file input) + ✕ (`_recQuitarArchivo`).
 *   3. **Auto-populate nombre input** si vacío: `nombre.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ")`.
 *      Drop ext + reemplaza `-`/`_` por espacios. "informe_q3-final.pdf" →
 *      "informe q3 final".
 * Edge:
 *   - **`_escapeHtml` canonical** en nombre del preview.
 *   - **Auto-populate solo si vacío**: respeta entrada manual del usuario;
 *     no sobrescribe. Decisión UX cementada.
 *   - **Onclick inline `'rec-modal-file-input'`**: bypass del module
 *     scoping; el botón "Cambiar" dispara el file input nativo.
 *   - Estilos INLINE: layout custom del preview. Deuda menor: extraer a
 *     `.x-file-preview` canonical post-Supabase.
 *   - **Exportado en window** (onchange file input + onclick cambiar).
 *   - Función IMPURA.
 */
function _recMostrarArchivo(nombre, size) {
  _recArchivoNombre = nombre;
  _recArchivoSize   = size;
  document.getElementById("rec-modal-dropzone").style.display = "none";
  const preview = document.getElementById("rec-modal-file-preview");
  preview.style.display = "";
  preview.innerHTML = `
    <div class="prof-rec-fila" style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 12px">
      <div style="width:36px;height:36px;border-radius:var(--r-sm);flex-shrink:0;background:var(--surface-3);display:flex;align-items:center;justify-content:center;font-size:16px">${_recIconoDesdeNombre(nombre)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_escapeHtml(nombre)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${_recTipoDesdeNombre(nombre)}${size ? " · " + size : ""}</div>
      </div>
      <button class="prof-btn-sm ghost" onclick="document.getElementById('rec-modal-file-input').click()" title="Cambiar archivo">Cambiar</button>
      <button class="prof-accion-btn" style="color:var(--xahni-red)" onclick="_recQuitarArchivo()" title="Quitar archivo">✕</button>
    </div>`;
  const nombreInput = document.getElementById("rec-modal-nombre");
  if (!nombreInput.value.trim())
    nombreInput.value = nombre.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
}

/**
 * @interaction rec-quitar-archivo
 * @scope profesor-recursos-modal-preview
 *
 * Given user click en ✕ del preview file.
 * When quiere remover el archivo seleccionado para subir otro o cancelar.
 * Then:
 *   1. Reset state (`_recArchivoNombre` + `_recArchivoSize` vacíos).
 *   2. Reset file input value (permite re-seleccionar mismo archivo).
 *   3. Hide preview, show dropzone.
 * Edge:
 *   - **`value = ""`** crítico para que el mismo archivo pueda re-dispararse
 *     onchange (browsers cachean el último file y NO disparan onchange si
 *     se selecciona el mismo sin reset).
 *   - **No limpia el nombre input** (auto-populated por
 *     `_recMostrarArchivo`); decisión UX: si el usuario empezó a ajustar
 *     el nombre y luego quita el archivo, conserva su entrada.
 *   - **Exportado en window** (onclick inline).
 *   - Función IMPURA.
 */
function _recQuitarArchivo() {
  _recArchivoNombre = "";
  _recArchivoSize   = "";
  document.getElementById("rec-modal-file-input").value    = "";
  document.getElementById("rec-modal-file-preview").style.display = "none";
  document.getElementById("rec-modal-dropzone").style.display     = "";
}
/**
 * @interaction rec-archivo-seleccionado
 * @scope profesor-recursos-modal-input
 *
 * Given file input change (input.files[0]).
 * When user selecciona archivo via file picker o drag&drop.
 * Then:
 *   1. Sin file → no-op (caso cancel del picker).
 *   2. `_recMostrarArchivo(file.name, _recFormatSize(file.size))`.
 * Edge:
 *   - Único punto de entrada del flujo "archivo seleccionado". `editarRecurso`
 *     llama a `_recMostrarArchivo` directo con datos mock (NO pasa por aquí).
 *   - **No valida MIME type** — `_recTipoDesdeNombre` deriva desde
 *     extensión más tarde.
 *   - **No valida size límite** (en DEMO no hay upload real). Deuda
 *     post-Supabase: enforce 100MB o similar antes de subir a Storage.
 *   - **Exportado en window** (onchange inline).
 *   - Función IMPURA.
 */
function _recArchivoSeleccionado(input) {
  const file = input.files[0];
  if (!file) return;
  _recMostrarArchivo(file.name, _recFormatSize(file.size));
}

/**
 * @interaction rec-popular-modal-materia-select
 * @scope profesor-recursos-modal-helper
 *
 * Given DOM con `#rec-modal-materia` + APP.user.
 * When `abrirSubirRecurso` / `editarRecurso` abren el modal y necesitan
 *   poblar el `<select>` de materia destino.
 * Then innerHTML con `<option>` por cada materia del profesor (sin "Todas"
 *   default — el modal exige selección concreta).
 * Edge:
 *   - DOM target o APP.user ausente → no-op.
 *   - Sin materias asignadas → select vacío (UX edge case: profesor sin
 *     setup admin; el modal podría no abrirse en ese caso, pero defensa).
 *   - `_escapeHtml` canonical en value/nombre.
 *   - **Asimetría con `_buildRecMatSelect`** (filtro principal): ese tiene
 *     opción "todas"; éste no (modal exige seleccionar materia destino
 *     del recurso).
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM).
 */
function _recPopularModalMateriaSelect() {
  const sel = document.getElementById("rec-modal-materia");
  if (!sel || !APP.user) return;
  const materias = (DEMO_MATERIAS || []).filter((m) => m.profesorId === APP.user.id);
  sel.innerHTML = materias.map((m) => `<option value="${_escapeHtml(m.id)}">${_escapeHtml(m.nombre)}</option>`).join("");
}

/**
 * @interaction abrir-subir-recurso
 * @scope profesor-recursos-modal-subir
 *
 * Given user click en botón "+ Subir recurso" de la vista.
 * When dispara onclick.
 * Then bootstrap modal en modo "subir nuevo":
 *   1. Reset estado modal: `_recEditId = null`, `_recArchivoNombre/Size` vacíos.
 *   2. Icon header: "↑" + colors teal (verde brand profesor).
 *   3. Título: "Subir recurso didáctico".
 *   4. Subtítulo: "Sube un nuevo material para tus alumnos".
 *   5. Reset campos: nombre vacío, file input vacío.
 *   6. Hide preview, show dropzone.
 *   7. Botón submit text: "Subir recurso".
 *   8. Popula materia select.
 *   9. `openModal("modal-subir-recurso")`.
 * Edge:
 *   - Mismo modal compartido por subir+editar; bifurcación por `_recEditId`
 *     en `ejecutarAccionRecurso`. Estilos del header (icon + título) dictan
 *     el modo visualmente.
 *   - **Exportado en window** (onclick inline botón vista).
 *   - Función IMPURA (DOM + abre modal).
 */
function abrirSubirRecurso() {
  _recEditId        = null;
  _recArchivoNombre = "";
  _recArchivoSize   = "";
  document.getElementById("rec-modal-icon").textContent    = "↑";
  document.getElementById("rec-modal-icon").style.background = "var(--xahni-teal-dim)";
  document.getElementById("rec-modal-icon").style.color    = "var(--xahni-teal)";
  document.getElementById("rec-modal-titulo").textContent  = "Subir recurso didáctico";
  document.getElementById("rec-modal-subtitulo").textContent = "Sube un nuevo material para tus alumnos";
  document.getElementById("rec-modal-nombre").value        = "";
  document.getElementById("rec-modal-file-input").value    = "";
  document.getElementById("rec-modal-file-preview").style.display = "none";
  document.getElementById("rec-modal-dropzone").style.display     = "";
  document.getElementById("rec-modal-btn").textContent     = "Subir recurso";
  _recPopularModalMateriaSelect();
  openModal("modal-subir-recurso");
}

/**
 * @interaction editar-recurso
 * @scope profesor-recursos-modal-editar
 *
 * Given id del recurso a editar.
 * When `_buildRecItem` onclick editar dispara con el id.
 * Then bootstrap modal en modo "editar existente":
 *   1. Lookup `r` en `_recData`. Sin → no-op.
 *   2. Setea `_recEditId = id`.
 *   3. Icon header: "✏️" + colors blue.
 *   4. Título: "Editar recurso" + subtítulo.
 *   5. Prepobla nombre input con `r.titulo`.
 *   6. Reset file input.
 *   7. Botón submit text: "Guardar cambios".
 *   8. Popula materia select + setea `r.materiaId` como selected.
 *   9. **Mock archivo display**: deriva ext desde `r.tipo`
 *      (VIDEO→mp4, PPT→pptx, else lowercase) y llama `_recMostrarArchivo`
 *      con `titulo.ext` + size vacío.
 *   10. Abre modal.
 * Edge:
 *   - **Mock archivo es solo display**: no hay file real (DEMO no maneja
 *     blobs). El preview muestra el "nombre virtual" + tipo derivado para
 *     mantener consistencia visual con modo subir.
 *   - **Mapping de tipo → ext es lossy**: PDF→pdf, DOCX→docx, etc.
 *     Pierde info (xlsx que mapea a DOCX se muestra como "titulo.docx"
 *     no "titulo.xlsx"). Aceptable: el tipo categorizado es lo que
 *     importa para mostrar correctamente.
 *   - **Exportado en window** (onclick inline).
 *   - Función IMPURA.
 */
function editarRecurso(id) {
  const r = _recData.find((x) => x.id === id);
  if (!r) return;
  _recEditId = id;
  document.getElementById("rec-modal-icon").textContent    = "✏️";
  document.getElementById("rec-modal-icon").style.background = "var(--xahni-blue-dim)";
  document.getElementById("rec-modal-icon").style.color    = "var(--xahni-blue-light)";
  document.getElementById("rec-modal-titulo").textContent  = "Editar recurso";
  document.getElementById("rec-modal-subtitulo").textContent = "Modifica la información del recurso existente";
  document.getElementById("rec-modal-nombre").value        = r.titulo;
  document.getElementById("rec-modal-file-input").value    = "";
  document.getElementById("rec-modal-btn").textContent     = "Guardar cambios";
  _recPopularModalMateriaSelect();
  document.getElementById("rec-modal-materia").value = r.materiaId;
  const ext = r.tipo === "VIDEO" ? "mp4" : r.tipo === "PPT" ? "pptx" : r.tipo.toLowerCase();
  _recMostrarArchivo(r.titulo + "." + ext, "");
  openModal("modal-subir-recurso");
}

/**
 * @interaction ejecutar-accion-recurso
 * @scope profesor-recursos-modal-submit
 *
 * Given user click "Subir recurso" o "Guardar cambios" en el modal
 *   (mismo botón, diferente texto según modo).
 * When submit del modal.
 * Then bifurcación por `_recEditId`:
 *   1. Validation común: nombre no vacío → bloqueante toast error.
 *   2. **Modo editar** (`_recEditId` truthy):
 *      - Lookup r en `_recData` por id.
 *      - Actualiza titulo + materiaId.
 *      - Si `_recArchivoNombre` (usuario seleccionó nuevo archivo):
 *        actualiza tipo desde nombre.
 *      - Toast success "X actualizado".
 *   3. **Modo subir** (`_recEditId` null):
 *      - Validation extra: `_recArchivoNombre` requerido → bloqueante.
 *      - Genera `newId = "r_" + Date.now()`.
 *      - Push a `_recData` con shape `{id, titulo, tipo, materiaId, url,
 *        profesorId, fechaSubida}`.
 *      - Toast success "Recurso subido".
 *   4. Cleanup state + closeModal + repaint.
 * Edge:
 *   - **`r_${Date.now()}` id generation**: colisión muy improbable en
 *     vanilla (1 ms granularidad); Deuda post-Supabase: UUID v7.
 *   - **`url: "demo://nuevo"`** placeholder; no hay upload real.
 *   - **Tipo no recalculado en edit si no hay nuevo archivo**: si el
 *     usuario solo cambia nombre, el tipo previo persiste. Pattern
 *     deliberado para edit superficial.
 *   - profesorId hardcoded de APP.user.id (no cross-prof CRUD).
 *   - fechaSubida = now en modo subir; **NO se actualiza en edit**
 *     (mantiene la original).
 *   - **Exportado en window** (onclick inline modal submit).
 *   - Función IMPURA (`_recData` + DOM + abre modal).
 *   - Deuda post-Supabase: upload real a Storage + insert/update a tabla
 *     `recursos` + retorno reactivo.
 */
function ejecutarAccionRecurso() {
  const nombre  = document.getElementById("rec-modal-nombre").value.trim();
  const materia = document.getElementById("rec-modal-materia").value;
  if (!nombre) { showToast("El nombre es obligatorio", "error"); return; }

  if (_recEditId) {
    const r = _recData.find((x) => x.id === _recEditId);
    if (r) {
      r.titulo    = nombre;
      r.materiaId = materia;
      if (_recArchivoNombre) r.tipo = _recTipoDesdeNombre(_recArchivoNombre);
    }
    showToast(`"${nombre}" actualizado`, "success");
  } else {
    if (!_recArchivoNombre) { showToast("Selecciona un archivo", "error"); return; }
    const newId = "r_" + Date.now();
    _recData.push({
      id:          newId,
      titulo:      nombre,
      tipo:        _recTipoDesdeNombre(_recArchivoNombre),
      materiaId:   materia,
      url:         "demo://nuevo",
      profUid:     APP.user.id,
      profesorId:  APP.user.id, // legacy compat
      fechaSubida: new Date().toISOString(),
    });
    showToast("Recurso subido y disponible para alumnos", "success");
  }

  _recEditId        = null;
  _recArchivoNombre = "";
  _recArchivoSize   = "";
  closeModal("modal-subir-recurso");
  buildRecursosProfesor();
}

// ═══════════════════════════════════════════════════════════
// C9 · Trasplante a hub-materia profesor
// recursosProfRender(panelId, matId) inyecta lazy el markup de
// views/profesor/recursos.html en el panel del hub-materia y llama
// a buildRecursosProfesor() para init. Llamado desde
// profHubMatSwitchTab cuando el tab 'recursos' está activo.
//
// Sin filtro por grupo (asimetría legítima §6.1 spec: recursos viven
// a nivel materia, no por grupo). matId se acepta pero no se usa
// para pre-filtrar — la vista permite navegar todas las materias
// del profesor.
// ═══════════════════════════════════════════════════════════

/**
 * @interaction recursos-prof-render
 * @scope profesor-recursos-entry-hub-c9
 *
 * Given panelId del tab Recursos del hub-materia + _matId opcional
 *   (aceptado por API consistency, NO usado internamente).
 * When `_profMatDispatchTabRender("recursos", ...)` lo invoca al switch del tab.
 * Then async pipeline:
 *   1. Resuelve panel. Sin → no-op.
 *   2. **Hardening dual-paint** (asistencia bug #7 pattern, commit 646e3ae):
 *      chequea `panel.querySelector("#recursos-grid")` — si está, NO
 *      re-fetcha. Cubre recovery tras placeholder de parcial futuro.
 *   3. Lazy fetch `views/profesor/recursos.html`:
 *      - HTTP error → console.error + x-empty fallback.
 *      - Success → innerHTML + hide `.page-header` standalone redundante.
 *   4. Llama `buildRecursosProfesor()` para init.
 * Edge:
 *   - **_matId aceptado pero NO usado para pre-filtrar**: el módulo
 *     muestra TODAS las materias del profesor con su filtro propio.
 *     Decisión §6.1 spec: recursos viven a nivel materia, no por grupo,
 *     y la vista cross-materia es útil para que el profesor navegue.
 *   - **Async function** única en el archivo.
 *   - **Exportado en window** (consumer cross-archivo:
 *     `_profMatDispatchTabRender` en hub-aprendizaje.js).
 *   - Función IMPURA (DOM + fetch + state init).
 *   - **Asimetría con escalaRender**: escala oculta más redundancias
 *     (mat-cards picker + placeholder); recursos solo oculta page-header
 *     porque su grid IS la vista principal.
 *   - Deuda post-Supabase: SSR del shell + lazy load reactivo.
 */
async function recursosProfRender(panelId, _matId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  // Hardening 2026-05-24 (slice panel-injection): usar presencia del markup
  // canónico (#recursos-grid) en lugar de un flag module-scope. Cubre
  // recovery tras placeholder de parcial futuro. Patrón asistencia bug #7
  // (commit 646e3ae).
  if (!panel.querySelector("#recursos-grid")) {
    try {
      const res = await fetch("views/profesor/recursos.html");
      if (!res.ok) throw new Error("status " + res.status);
      panel.innerHTML = await res.text();

      // Ocultar redundancias dentro del hub-materia.
      const pageHead = panel.querySelector(".page-header");
      if (pageHead) pageHead.style.display = "none";
    } catch (err) {
      console.error("[recursosProfRender] no se pudo cargar recursos.html:", err);
      panel.innerHTML = '<div class="x-empty"><div class="x-empty__title">No se pudo cargar recursos</div></div>';
      return;
    }
  }
  if (typeof buildRecursosProfesor === "function") buildRecursosProfesor();
}
window.recursosProfRender = recursosProfRender;
