// js/estudiante/juegos.js
const JuegosEstudiante = (() => {
  const TIPO_LABEL = { vf: 'V/F', quiz: 'Quiz', flashcards: 'Flash' };
  const TIPO_ICON  = { vf: '✅', quiz: '🧠', flashcards: '🃏' };

  /**
   * @interaction juegos-fmt-fecha
   * @scope estudiante-juegos-iife-helper-fecha
   *
   * Given fecha (Date / ISO string / parseable).
   * When `_buildHistorial` muestra fecha de sesión jugada.
   * Then toLocaleDateString "es-MX" {day:2-digit, month:short, year:numeric}.
   *   "15 mar 2026" (con año).
   * Edge:
   *   - **Incluye año** (diferencia con `_tpFormatDate` tareas que no).
   *     Decisión: historial juegos puede tener entries de hace muchos meses.
   *   - Locale hardcoded.
   *   - Función PURA.
   *   - Helper LOCAL IIFE-encapsulated.
   */
  function _fmt(fecha) {
    return new Date(fecha).toLocaleDateString('es-MX',
      { day:'2-digit', month:'short', year:'numeric' });
  }

  /**
   * @interaction juegos-build
   * @scope estudiante-juegos-iife-entrypoint
   *
   * Given APP.user activo + DataService disponible.
   * When `buildJuegosEstudiante()` (global) o `hubMateriaRenderJuegos()`
   *   (C8b-B6 cross-tab) invocan.
   * Then async pipeline:
   *   1. Resuelve uid + 3 fetches paralelos vía DataService:
   *      - `getProgresoEstudiante(uid)`.
   *      - `getJuegos()`.
   *      - `getMaterias()`.
   *   2. Sin progreso → early return.
   *   3. **Filtrado por hub-materia activo (C8b-B6)**: si
   *      `hubMateriaActiva` global está set, filter juegos por matId/
   *      nombre + filter sesiones por idsValidos Set; else todos.
   *   4. `disponibles` = matActiva ? juegosFiltrados : filter por user.materias.
   *   5. 3 sub-builds: stats + historial + disponibles.
   * Edge:
   *   - **`hubMateriaActiva` global cross-archivo** (hub-aprendizaje.js).
   *     Defensive typeof check para tolerar carga.
   *   - **3 fetches paralelos NO awaited en `Promise.all`**: cada `await`
   *     bloquea secuencial. Aceptable DEMO (DataService cache); deuda
   *     post-Supabase: Promise.all real query.
   *   - **`DataService.*` consumed directo** — único módulo del rol que
   *     usa este pattern (diferencia con resto que usa `getMateriasAlumno`
   *     wrappers). Decisión histórica.
   *   - **Async function** dentro de IIFE — exposed via `return { build }`.
   *   - Función IMPURA (DOM via sub-builds + fetch).
   */
  async function build() {
    const uid      = APP.user?.id;
    const progreso = await DataService.getProgresoEstudiante(uid);
    const juegos   = await DataService.getJuegos();
    const materias = await DataService.getMaterias();

    if (!progreso) return;

    // C8b-B6: Filtrar por materia activa del hub si aplica.
    // hubMateriaActiva (global de hub-aprendizaje.js) tiene la materia abierta;
    // si no está set, fallback al comportamiento original (todas las materias del alumno).
    const matActiva = (typeof hubMateriaActiva !== "undefined") ? hubMateriaActiva : null;
    const juegosFiltrados = matActiva
      ? juegos.filter(j => j.materiaId === matActiva.id || j.materia === matActiva.nombre)
      : juegos;

    const sesiones    = progreso.juegosJugados || [];
    // Set de IDs válidos para filtrar también el historial cuando hay materia activa.
    const idsValidos  = new Set(juegosFiltrados.map(j => j.id));
    const sesionesFiltradas = matActiva
      ? sesiones.filter(s => idsValidos.has(s.juegoId))
      : sesiones;

    const disponibles = matActiva
      ? juegosFiltrados
      : juegosFiltrados.filter(j => (APP.user?.materias || []).includes(j.materiaId));

    _buildStats(sesionesFiltradas, progreso);
    _buildHistorial(sesionesFiltradas, juegos, materias);
    _buildDisponibles(disponibles, materias, sesionesFiltradas);
  }

  /**
   * @interaction juegos-build-stats
   * @scope estudiante-juegos-iife-render-stats
   *
   * Given sesiones filtradas + progreso global del estudiante.
   * When `build` orquesta.
   * Then 4 stat-cards:
   *   1. Sesiones jugadas (🎮) count.
   *   2. XP ganados (⚡) = sesiones × 30 (heurística cementada).
   *   3. Mejor puntaje (🏆) reduce desde sesiones o "—".
   *   4. Racha actual (🔥) días desde `progreso.rachaActual`.
   * Edge:
   *   - DOM target ausente → no-op.
   *   - **30 XP/sesión hardcoded** — heurística DEMO. Deuda: configurable
   *     post-Supabase.
   *   - **Sin sesiones**: mejorSesion null → "—" placeholder.
   *   - **`mejorSesion` reduce-max** — first session inicial fallback.
   *   - Función IMPURA (DOM).
   *   - Helper LOCAL IIFE.
   */
  function _buildStats(sesiones, progreso) {
    const el = document.getElementById('juegos-stats-grid');
    if (!el) return;

    const totalSesiones = sesiones.length;
    const xpGanado      = totalSesiones * 30;
    const mejorSesion   = sesiones.reduce(
      (best, s) => s.puntaje > (best?.puntaje || 0) ? s : best, null
    );

    el.innerHTML = `
      <div class="juegos-stat-card">
        <div class="juegos-stat-icon">🎮</div>
        <div class="juegos-stat-value">${totalSesiones}</div>
        <div class="juegos-stat-label">Sesiones jugadas</div>
      </div>
      <div class="juegos-stat-card">
        <div class="juegos-stat-icon">⚡</div>
        <div class="juegos-stat-value">${xpGanado.toLocaleString()}</div>
        <div class="juegos-stat-label">XP ganados en juegos</div>
      </div>
      <div class="juegos-stat-card">
        <div class="juegos-stat-icon">🏆</div>
        <div class="juegos-stat-value">${mejorSesion ? mejorSesion.puntaje : '—'}</div>
        <div class="juegos-stat-label">Mejor puntaje</div>
      </div>
      <div class="juegos-stat-card">
        <div class="juegos-stat-icon">🔥</div>
        <div class="juegos-stat-value">${progreso.rachaActual}</div>
        <div class="juegos-stat-label">Racha actual (días)</div>
      </div>
    `;
  }

  /**
   * @interaction juegos-build-historial
   * @scope estudiante-juegos-iife-render-historial
   *
   * Given sesiones filtradas + juegos + materias.
   * When `build` orquesta.
   * Then:
   *   1. Update badge count.
   *   2. Empty state si sin sesiones.
   *   3. Sort desc por fecha + calcular maxPuntaje.
   *   4. Por sesión: `.juego-historial-card` con tipo icon/badge + materia
   *      + score (highlight "max" si matches mejor) + +30 XP fijo + fecha.
   * Edge:
   *   - **Mejor puntaje highlight**: SOLO una sesión recibe `.max` (la del
   *     `maxPuntaje`). Si hay tie, todas reciben (decisión consciente).
   *   - **+30 XP fijo display** — mismo hardcode que `_buildStats`.
   *   - juego/materia no encontrados → fallback al id string.
   *   - **Sort spread `[...sesiones]`** preserva input inmutable.
   *   - Función IMPURA (DOM).
   *   - Helper LOCAL IIFE.
   */
  function _buildHistorial(sesiones, juegos, materias) {
    const grid  = document.getElementById('juegos-historial-grid');
    const badge = document.getElementById('juegos-total-badge');
    if (!grid) return;

    if (badge) badge.textContent = sesiones.length;

    if (!sesiones.length) {
      grid.innerHTML = `<div class="x-empty" style="grid-column:1/-1">
        <div class="x-empty__icon">🎮</div>
        <div class="x-empty__title">Aún no has jugado ningún juego</div>
      </div>`;
      return;
    }

    const sorted = [...sesiones].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const maxPuntaje = Math.max(...sorted.map(s => s.puntaje), 0);

    grid.innerHTML = sorted.map(s => {
      const juego   = juegos.find(j => j.id === s.juegoId) || {};
      const materia = materias.find(m => m.id === juego.materiaId) || {};
      const esMejor = s.puntaje === maxPuntaje;
      return `
        <div class="juego-historial-card">
          <div class="juego-card-header">
            <div class="juego-card-nombre">${TIPO_ICON[juego.tipo] || '🎮'} ${juego.nombre || s.juegoId}</div>
            <span class="juego-card-tipo-badge">${TIPO_LABEL[juego.tipo] || juego.tipo}</span>
          </div>
          <div class="juego-card-materia">${materia.nombre || juego.materiaId}</div>
          <div class="juego-card-score-row">
            <div class="juego-card-score${esMejor ? ' max' : ''}">${s.puntaje}<span style="font-size:.7rem;opacity:.6">/100</span></div>
            <div class="juego-card-xp">+30 XP</div>
          </div>
          <div class="juego-card-fecha">${_fmt(s.fecha)}</div>
        </div>
      `;
    }).join('');
  }

  /**
   * @interaction juegos-build-disponibles
   * @scope estudiante-juegos-iife-render-disponibles
   *
   * Given disponibles + materias + sesiones (para flag jugado).
   * When `build` orquesta.
   * Then:
   *   1. Empty state si sin disponibles.
   *   2. Set `jugadosSet` de juegoIds ya jugados.
   *   3. Por disponible: card con tipo icon + nombre + meta + badge
   *      "✓ Ya jugado" o "Nuevo".
   * Edge:
   *   - **Asimetría chip ya-jugado/Nuevo**: ya jugado = primary tint;
   *     Nuevo = cyan accent. Decisión visual cementada.
   *   - Materia no encontrada → fallback al id.
   *   - Función IMPURA (DOM).
   *   - Helper LOCAL IIFE.
   */
  function _buildDisponibles(disponibles, materias, sesiones) {
    const grid = document.getElementById('juegos-disponibles-grid');
    if (!grid) return;

    if (!disponibles.length) {
      grid.innerHTML = `<div class="x-empty">
        <div class="x-empty__icon">🎮</div>
        <div class="x-empty__title">No hay juegos disponibles en tus materias</div>
      </div>`;
      return;
    }

    const jugadosSet = new Set(sesiones.map(s => s.juegoId));

    grid.innerHTML = disponibles.map(j => {
      const materia  = materias.find(m => m.id === j.materiaId) || {};
      const jugado   = jugadosSet.has(j.id);
      return `
        <div class="juego-disponible-card">
          <div class="juego-disp-icon">${TIPO_ICON[j.tipo] || '🎮'}</div>
          <div class="juego-disp-nombre">${j.nombre}</div>
          <div class="juego-disp-meta">${materia.nombre || j.materiaId} · ${TIPO_LABEL[j.tipo] || j.tipo}</div>
          ${jugado ? '<span class="juego-disp-prox-badge">✓ Ya jugado</span>' : '<span class="juego-disp-prox-badge" style="background:#00d4ff22;color:var(--accent-cyan-text);border-color:#00d4ff44">Nuevo</span>'}
        </div>
      `;
    }).join('');
  }

  return { build };
})();

/**
 * @interaction build-juegos-estudiante-wrapper
 * @scope estudiante-juegos-global-wrapper
 *
 * Given módulo IIFE `JuegosEstudiante` con método `build` async.
 * When caller cross-archivo (showView('juegos') o hub-tab handler) invoca.
 * Then wrapper trivial que dispara `JuegosEstudiante.build()`.
 * Edge:
 *   - **Wrapper NO awaited** — caller no espera la promesa. Aceptable para
 *     fire-and-forget render. Deuda menor: retornar la promesa para callers
 *     que quieran await.
 *   - **Global function** (no en window.* explicit) pero accessible via
 *     declaration cementada legacy.
 *   - Función IMPURA (delegate).
 */
function buildJuegosEstudiante() {
  JuegosEstudiante.build();
}

// C8b-B6 entrypoint DEPRECADO por slice sprint 2026-06-08 (decisión D6).
// El render del tab Juegos hub-materia lo asume `buildHubMatPanelQuizzes`
// en `js/shared/quiz-jugar.js`, que reemplaza el chrome stub "post-Supabase"
// y wire-ea click → iniciarQuiz. El IIFE `JuegosEstudiante` queda con sus
// helpers `_buildStats`/`_buildHistorial` disponibles para reuso futuro
// (slice día 3 recompensas o vista historial standalone).
//
// NO definir window.hubMateriaRenderJuegos aquí (la asignación canónica
// vive en quiz-jugar.js cargado antes; este archivo se carga después y
// pisaba el override sprint).
