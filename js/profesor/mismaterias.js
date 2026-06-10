// js/profesor/mismaterias.js — Mis Materias del profesor.
//
// Slice pre-c10 6b.1 (2026-05-26): reducción tras cleanup `3a2081f` del
// 2026-05-24 que eliminó el container `#view-mis-materias-prof` y demás
// DOM standalone. Quedan solo las 2 funciones vivas:
//   1. `getProfMateriasData(uid)` — data provider · consumer: hub-aprendizaje.js
//   2. `_buildMatCardProf(m)` — builder card · consumer: hub-aprendizaje.js
//
// Eliminadas (huérfanas tras `3a2081f`): `buildMateriasProfesor`,
// `_renderMateriasResumen`, `_renderMateriaCards`, `_mmAccentColor`,
// `abrirDetalleMateriaProf`, `cerrarDetalleMateriaProf` + state interno
// `_materiaProfesorActiva`, `_mmData`. Los DOM targets (`#prof-materias-grid`,
// `#mp-resumen-bar`, `#prof-materia-detalle-panel`) ya no existen en index.html.

// Paletas locales deterministas — usadas por `getProfMateriasData` para
// derivar `glowColor`, `bgGrad`, `emblema`, `colorName` por materia.
const _MM_MAT_GLOW   = ["#00c6a7","#f5a623","#3d6ef5","#8b2be2","#4caf50","#e53935"];
const _MM_MAT_BGGRAD = [
  "linear-gradient(135deg,#001a2e 0%,#003d4d 50%,#001a2e 100%)",
  "linear-gradient(135deg,#1a1000 0%,#4d3300 50%,#1a1000 100%)",
  "linear-gradient(135deg,#000d33 0%,#001166 50%,#000d33 100%)",
  "linear-gradient(135deg,#1a0033 0%,#3d0066 50%,#1a0033 100%)",
  "linear-gradient(135deg,#001a00 0%,#003300 50%,#001a00 100%)",
  "linear-gradient(135deg,#1a0000 0%,#3d0000 50%,#1a0000 100%)",
];
const _MM_AV_PAL     = ["teal","amber","blue","purple","green","red","cyan"];
const _MM_MAT_EMBL   = ["💻","🗄️","🌐","📡","📐","🔬"];
const _MM_MAT_COLOR  = ["teal","amber","blue","purple","green","red"];

// ── Data provider ─────────────────────────────────────────────────────────────
/**
 * @interaction get-prof-materias-data
 * @scope profesor-mismaterias-data-provider
 *
 * Given uid del profesor logueado (APP.user.id).
 * When hub-aprendizaje profesor renderiza tab Materias / hub-grupo construye
 *   cards y necesita el shape enriquecido por materia (banner gradient + emblema
 *   + glow + prestige + total alumnos + xpMax + lista alumnos calculada + feed
 *   actividad reciente + periodo). El alumno tiene su propio data provider
 *   espejado (`getEstMateriasData`).
 * Then enriquece materias del profesor con 7 dimensiones derivadas en vivo:
 *   1. Resuelve `_profDataBase(uid)` → { materias, grupos, tareas, estudiantes }.
 *      Sin datos / sin materias → retorna `{ materias: [] }`.
 *   2. Por cada materia:
 *      a. Resuelve `gruposMateria` desde `m.grupos[]` × DEMO_GRUPOS.
 *      b. Set único de alumnos en todos esos grupos (Set para dedupe).
 *      c. Por cada alumno: derivar prom desde entregas calificadas + entregasCount
 *         + asignar color rotativo de `_MM_AV_PAL` + xpAporte = round(prom*45 + ent*12).
 *      d. Suma `totalXP` de los grupos + max nivel + prestigio = floor(maxNivel/2)
 *         capeado [1..5] + xpMax = prestigio*1000+500.
 *      e. glow / bgGrad / emblema / colorName cycling con índice materia.
 *      f. Banner gradient delegado a `_materiaBgGrad(m.id)` (homogéneo cross-rol),
 *         con fallback a paleta local si helper ausente.
 *      g. Feed actividad reciente: hasta 5 entregas más recientes con dot color
 *         por nota + icon 📝 + texto `<strong>` + tiempo formateado.
 *   3. Periodo + periodoInfo resueltos vía `getPeriodoDeGrupo(grupos[0])`
 *      (TODO documentado: cuando esta vista tenga selector de grupo activo,
 *      pasarlo al helper).
 * Edge:
 *   - Asimetría con `getMateriasProfesor` del data-provider: ESTE no filtra
 *     `estado === "archivada"`. Decisión histórica del slice 6b.1 (2026-05-26)
 *     — el alumno SÍ ve archivadas en su data-provider; aquí se conservó
 *     consistencia con el alumno (caller hub-aprendizaje renderiza cards).
 *     **Deuda menor**: el profesor probablemente NO quiere ver materias
 *     archivadas en tab Materias del hub. Pendiente revisión consciente.
 *   - Color por materia es índice-based (rotación 6), NO por matId. Si materias
 *     cambian de orden en DEMO_MATERIAS, colores cambian (mismo problema en
 *     espejo alumno; aceptado).
 *   - actividad.fecha es `Date`, no string ISO. Caller debe formatear.
 *   - `_materiaBgGrad` puede ausentarse en parse inicial; fallback paleta local.
 *   - Función PURA: no muta DEMO_*, retorna estructura nueva.
 *   - Deuda post-Supabase: vista materializada `materias_profesor_view` con
 *     joins + agregados de prom + totales.
 */
function getProfMateriasData(uid) {
  const empty = { materias: [] };
  const base = (typeof _profDataBase === "function") ? _profDataBase(uid) : null;
  if (!base) return empty;
  const { materias: materiasSrc, grupos, tareas, estudiantes } = base;

  const materias = materiasSrc.map((m, i) => {
    const gruposMateria = (m.grupos || [])
      .map((gid) => grupos.find((g) => g.id === gid))
      .filter(Boolean);

    // Alumnos únicos en esta materia (un alumno puede estar en varios grupos)
    const alumnosSet = new Set();
    gruposMateria.forEach((g) => (g.miembros || []).forEach((id) => alumnosSet.add(id)));
    const alumnosIds = [...alumnosSet];

    const alumnosList = alumnosIds.map((estId, idx) => {
      const est     = estudiantes.find((u) => u.id === estId);
      const grupoEst = gruposMateria.find((g) => (g.miembros || []).includes(estId));
      const tareasEst = tareas.filter(
        (t) => t.materiaId === m.id && t.grupoId === grupoEst?.id,
      );
      const cals = tareasEst
        .flatMap((t) => t.entregas.filter((e) => e.uid === estId && e.calificacion != null))
        .map((e) => e.calificacion);
      const prom         = cals.length ? cals.reduce((a, b) => a + b, 0) / cals.length : 0;
      const entregasCount = tareasEst.filter((t) => t.entregas.some((e) => e.uid === estId)).length;
      return {
        id:       estId,
        nombre:   est?.nombre  || estId,
        ini:      est?.iniciales || estId.slice(0, 2).toUpperCase(),
        prom:     parseFloat(prom.toFixed(2)),
        entregas: entregasCount,
        color:    _MM_AV_PAL[idx % _MM_AV_PAL.length],
        grupo:    grupoEst?.id || "",
        xpAporte: Math.round(prom * 45 + entregasCount * 12),
      };
    });

    const totalXP     = gruposMateria.reduce((s, g) => s + (g.puntos || 0), 0);
    const maxNivel    = gruposMateria.reduce((mx, g) => Math.max(mx, g.nivel || 1), 1);
    const prestigio   = Math.min(5, Math.max(1, Math.round(maxNivel / 2)));
    const xpMax       = prestigio * 1000 + 500;
    const glow        = _MM_MAT_GLOW[i % _MM_MAT_GLOW.length];
    // Banner gradient compartido por materiaId con el alumno (homogéneo entre roles).
    const bgGrad      = (typeof _materiaBgGrad === "function")
        ? _materiaBgGrad(m.id)
        : _MM_MAT_BGGRAD[i % _MM_MAT_BGGRAD.length];
    const emblema     = gruposMateria[0]?.emblema || _MM_MAT_EMBL[i % _MM_MAT_EMBL.length];
    const colorName   = _MM_MAT_COLOR[i % _MM_MAT_COLOR.length];

    // Actividad reciente derivada de entregas reales
    const actividad = [];
    tareas.filter((t) => t.materiaId === m.id).forEach((t) => {
      (t.entregas || []).forEach((e) => {
        const est = estudiantes.find((u) => u.id === e.uid);
        if (!est) return;
        actividad.push({
          fecha: new Date(e.fecha),
          color: e.calificacion >= 9
            ? "var(--xahni-green)"
            : e.calificacion >= 6
              ? "var(--xahni-teal)"
              : "var(--xahni-amber)",
          icon:  "📝",
          texto: `<strong>${est.nombre}</strong> entregó "${t.titulo}"`,
          time:  _gestionFechaCorta(e.fecha),
        });
      });
    });
    actividad.sort((a, b) => b.fecha - a.fecha);

    return {
      id:           m.id,
      nombre:       m.nombre,
      clave:        m.clave,
      clasificacionId: m.clasificacionId,
      colorName,
      emblema,
      bgGrad,
      glowColor:    glow,
      totalAlumnos: alumnosIds.length,
      totalXP,
      xpMax,
      prestigioNivel: prestigio,
      alumnos:      alumnosList,
      actividad:    actividad.slice(0, 5),
      horario:      m.horario || [],
      // TODO: cuando esta vista tenga selector de grupo activo, pasarlo a getPeriodoDeGrupo.
      periodo:      (typeof getPeriodoDeGrupo === "function") ? getPeriodoDeGrupo((m.grupos || [])[0]) : null,
      periodoInfo:  (typeof getPeriodoInfo === "function" && typeof getPeriodoDeGrupo === "function")
                      ? getPeriodoInfo(getPeriodoDeGrupo((m.grupos || [])[0]))
                      : null,
    };
  });

  return { materias };
}

// ═══════════════════════════════════════════════════════════
// C9 · Builder reusable para tab "Materias" del hub-grupo profesor
// REUSA el markup canónico .x-materia-card original (banner gradient
// + emblema + título + clave + clasificación + chip alumnos +
// prestige stars + XP bar + horario). El onclick navega a
// profHubAbrirMateria(matId), no a abrirDetalleMateriaProf (eliminado
// en cleanup 6b.1 junto con el resto del path standalone).
//
// Recibe la materia ENRIQUECIDA (shape devuelta por
// getProfMateriasData(uid).materias[i]) con bgGrad, emblema,
// prestigioNivel, totalXP, xpMax, glowColor, horario, periodoInfo,
// etc. El caller (_profHubRenderTabMaterias) cruza la enriquecida
// con getMateriasProfGrupo(uid, grupoId) para filtrar al grupo
// activo antes de mapear con este builder.
// ═══════════════════════════════════════════════════════════

/**
 * @interaction build-mat-card-prof
 * @scope profesor-hub-grupo-builder
 *
 * Given una materia enriquecida `m` (shape devuelta por `getProfMateriasData`,
 *   con `id`, `nombre`, `clave`, `emblema`, `bgGrad`, `prestigioNivel`,
 *   `totalXP`, `xpMax`, `glowColor`, `horario`, `periodoInfo`, etc.).
 * When `_profHubRenderTabMaterias` arma el grid del tab "Materias" del
 *   hub-grupo profesor (cruzando getProfMateriasData con getMateriasProfGrupo
 *   para filtrar al grupo activo).
 * Then construye una `<article class="x-materia-card b1-ma-card">` reusando
 *   la composición canónica B.1 (mockup-driven) idéntica al espejo alumno:
 *   - data-rol="profesor", data-gamer="on" (vista on; off lo neutraliza por CSS)
 *   - data-disciplina derivado de `_getDisciplinaId(m.id)` para tints b1-ma
 *   - onclick="profHubAbrirMateria(m.id)" (NO abrirDetalleMateriaProf,
 *     eliminado en cleanup 6b.1 junto con view standalone)
 *   - composición: banner + emblem + body { score + divider + name + meta +
 *     schedule + tokens + cosmetics }
 *   - aria-label compuesto (nombre + nivel maestría)
 *   - codigoCorto = m.clave en uppercase (fallback m.id)
 * Edge:
 *   - m falsy → "" (defensa para grid map con missing entries).
 *   - APP undefined o APP.user null → uid = null (mastery cae a fallback en
 *     `_getMaestriaDe`).
 *   - Helpers `_renderMaestriaBanner/_renderMaestriaEmblem/Score/Name/Meta/
 *     Tokens/Cosmetics` + `_materiaScheduleHTML` se cargan de builders-core.
 *     Si alguno ausente parse-time, el HTML resultante tendrá huecos visibles
 *     (no rompe parse, sí afecta vista).
 *   - Helper `_renderMaestria*` aplica patrón twin alumno/profesor; bifurcación
 *     por rol vive en `_renderMaestriaMeta(m, rol, mastery)` (3er arg "profesor"
 *     vs "estudiante").
 *   - **NO incluye `_materiaParcialHTML`**: decisión consciente (mismatch
 *     con espejo alumno) — el progreso del periodo + parciales vive en
 *     tab "Mi grupo" → `.hub-grupo-periodo-full`. Mostrarlo dentro de cada
 *     card sería redundancia visual del mismo dato.
 *   - Función PURA: solo retorna string HTML, no muta DOM.
 *   - Deuda post-Supabase: data shape se mantiene; solo cambia provenance
 *     (vista materializada vs derivación cliente).
 */
function _buildMatCardProf(m) {
    if (!m) return "";
    const uid = (typeof APP !== "undefined" && APP.user) ? APP.user.id : null;
    const disciplinaId = _getDisciplinaId(m.id);
    const mastery = _getMaestriaDe(uid, m.id);
    const codigoCorto = (m.clave || m.id || "").toUpperCase();
    return `
      <article class="x-materia-card b1-ma-card"
               data-rol="profesor" data-gamer="on" data-disciplina="${disciplinaId}"
               onclick="profHubAbrirMateria('${m.id}')"
               aria-label="Tarjeta de maestría — ${m.nombre} · Nivel ${mastery.nivel}">
        ${_renderMaestriaBanner(disciplinaId, codigoCorto, "")}
        ${_renderMaestriaEmblem(disciplinaId, m.emblema, mastery.nivel, m.nombre)}
        <div class="b1-ma-body">
          ${_renderMaestriaScore(mastery)}
          <hr class="b1-ma-divider" aria-hidden="true">
          ${_renderMaestriaName(m)}
          ${_renderMaestriaMeta(m, "profesor", mastery)}
          ${_materiaScheduleHTML(m, APP?.profGrupoActivo ? [APP.profGrupoActivo] : null)}
          ${_renderMaestriaTokens(mastery)}
          ${_renderMaestriaCosmetics(mastery)}
        </div>
      </article>`;
}
// _materiaParcialHTML intencionalmente NO se incluye dentro del hub
// (espejo estudiante): el progreso del periodo + parciales vive en
// el tab "Mi grupo" → card .hub-grupo-periodo-full. Mostrarlo dentro
// de cada card de materia es redundancia.
window._buildMatCardProf = _buildMatCardProf;
