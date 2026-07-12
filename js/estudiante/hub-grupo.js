/* ════════════════════════════════════════════════════════════
 * js/estudiante/hub-grupo.js — Tab "Mi grupo" del hub-grupo (C8b B.2)
 *
 * Render dual de ambos modos (gamer-off + gamer-on). Toggle vía CSS
 * (body.gamer-off). JS no se entera del modo activo: produce ambos
 * árboles cada vez y el CSS muestra solo uno.
 *
 * Datos derivados cliente desde DEMO_USERS / DEMO_TAREAS / DEMO_GRUPOS
 * (calificaciones viven en DEMO_TAREAS[].entregas[].calificacion).
 * No hay DEMO_CALIFICACIONES.
 *
 * Wiring: hubGrupoSwitchTab("mi-grupo") invoca hubGrupoRenderMiGrupo().
 * ════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  // ── Helpers de datos ─────────────────────────────────────────

  /**
   * @interaction hub-grupo-lookups-basicos
   * @scope estudiante-hub-grupo-iife-helper-data
   *
   * Given APP.user o grupoId.
   * When builders necesitan resolver grupo + miembros + cálculos.
   * Then 5 lookups combined IIFE-internal:
   *   - `_getGrupoId()`: primer grupo del user (`APP.user.grupos[0]`).
   *   - `_getMiembros(grupoId)`: estudiantes en ese grupo.
   *   - `_getPromedioMiembro(miembroId)`: avg calificaciones de TODAS las
   *     entregas del miembro cross-materias. Round 1 decimal.
   *   - `_getPromedioGrupo(miembros)`: avg de promedios > null.
   *   - `_getColaborativas(grupoId)`: tareas multidisciplinarias del grupo
   *     (tolera dual shape `t.grupoId` o `t.grupos[]`).
   * Edge:
   *   - **Promedio cross-materias** (no filtra por materia) — vista
   *     holística del miembro.
   *   - **Sin entregas → null** (no 0 — distingue "sin data" de "reprobado").
   *   - **Dual shape tareas**: `grupoId` singular o `grupos[]` array.
   *     Convención flex DEMO.
   *   - Funciones PURAS.
   *   - Helpers IIFE-LOCALES.
   */
  function _getGrupoId() {
    return APP && APP.user && APP.user.grupos && APP.user.grupos[0];
  }

  function _getMiembros(grupoId) {
    if (!grupoId || typeof DEMO_USERS === "undefined") return [];
    return DEMO_USERS.filter(u =>
      u.tipo === "estudiante" &&
      Array.isArray(u.grupos) &&
      u.grupos.includes(grupoId)
    );
  }

  // Promedio de un miembro: media de calificaciones en entregas (DEMO_TAREAS).
  function _getPromedioMiembro(miembroId) {
    if (!miembroId || typeof DEMO_TAREAS === "undefined") return null;
    const cals = [];
    DEMO_TAREAS.forEach(t => {
      if (!Array.isArray(t.entregas)) return;
      t.entregas.forEach(e => {
        if (e.uid === miembroId && typeof e.calificacion === "number") {
          cals.push(e.calificacion);
        }
      });
    });
    if (!cals.length) return null;
    const sum = cals.reduce((s, c) => s + c, 0);
    return +(sum / cals.length).toFixed(1);
  }

  function _getPromedioGrupo(miembros) {
    const proms = miembros.map(m => _getPromedioMiembro(m.id)).filter(p => p !== null);
    if (!proms.length) return null;
    return +(proms.reduce((s, p) => s + p, 0) / proms.length).toFixed(1);
  }

  function _getColaborativas(grupoId) {
    if (!grupoId || typeof DEMO_TAREAS === "undefined") return [];
    return DEMO_TAREAS.filter(t =>
      t.multidisciplinaria === true &&
      (t.grupoId === grupoId || (Array.isArray(t.grupos) && t.grupos.includes(grupoId)))
    );
  }

  /**
   * @interaction hub-grupo-lookups-gamer
   * @scope estudiante-hub-grupo-iife-helper-gamer
   *
   * Given slotId / grupoId.
   * When builders gamer necesitan slot info o sintesis grupo-nivel.
   * Then 2 lookups combined:
   *   - `_getSlotInfo(slotId)`: lookup en DEMO_SLOTS_CATALOG.
   *   - `_getGrupoGamer(grupoId)`: sintetiza shape gamer del grupo desde
   *     DEMO_GRUPOS (no GRUPOS_DATA que es grupo×materia).
   *     Campos derivados: xpGrupal (puntos) + nivel + prestigioNivel
   *     (round nivel/2 capped [1,5]) + xpMax (prestigio×1000+500 con
   *     clamp xpGrupal+100) + logrosObtenidos + logrosTotal
   *     (LOGROS_GRUPO_CATALOG.length o 7 fallback).
   * Edge:
   *   - **Lookup `_getGrupoGamer` flexible**: matches por id, codigo o
   *     nombre. Tolera shape inconsistency en DEMO_GRUPOS seed.
   *   - Emblema fallback "⚔️" si missing.
   *   - bgGrad null → CSS aplica gradient default del banner.
   *   - **Comentario inline** explicita asimetría con GRUPOS_DATA
     (grupo-unidad vs grupo×materia).
   *   - Funciones PURAS.
   *   - Helpers IIFE-LOCALES.
   */
  function _getSlotInfo(slotId) {
    if (!slotId || typeof DEMO_SLOTS_CATALOG === "undefined") return null;
    return DEMO_SLOTS_CATALOG.find(s => s.id === slotId) || null;
  }

  // Datos "gamer" del grupo a nivel grupo (no por-materia). Sintetiza los
  // campos que el render espera (xpGrupal, xpMax, prestigioNivel, etc.)
  // desde DEMO_GRUPOS. GRUPOS_DATA no se usa porque allí cada entry es un
  // card grupo×materia, y este tab habla del grupo como unidad.
  function _getGrupoGamer(grupoId) {
    if (!grupoId || typeof DEMO_GRUPOS === "undefined") return null;
    const g = DEMO_GRUPOS.find(x =>
      x.id === grupoId || x.codigo === grupoId || x.nombre === grupoId
    );
    if (!g) return null;

    const xpGrupal       = g.puntos || 0;
    const nivel          = g.nivel  || 1;
    const prestigioNivel = Math.min(5, Math.max(1, Math.round(nivel / 2)));
    const xpMax          = Math.max(prestigioNivel * 1000 + 500, xpGrupal + 100);
    const logrosObtenidos = (g.logros || []).length;
    const logrosTotal    = (typeof LOGROS_GRUPO_CATALOG !== "undefined" && Array.isArray(LOGROS_GRUPO_CATALOG))
                            ? LOGROS_GRUPO_CATALOG.length
                            : 7;

    return {
      id:              g.id,
      nombre:          g.nombre,
      emblema:         g.emblema || "⚔️",
      bgGrad:          null,   // null → el CSS aplica gradient default del banner
      xpGrupal,
      xpMax,
      prestigioNivel,
      logrosObtenidos,
      logrosTotal,
      miembros:        (g.miembros || []).length,
      activo:          true,
    };
  }

  /**
   * @interaction hub-grupo-initials
   * @scope estudiante-hub-grupo-iife-helper-string
   *
   * Given nombre.
   * When members ribbon / chips muestran iniciales 2-char.
   * Then trim + split by whitespace + first char × 2 + uppercase.
   * Edge:
   *   - Sin nombre → "?".
   *   - **Asumption nombre con ≥2 palabras**: si una palabra, retorna 1 char.
   *   - Función PURA.
   *   - Helper IIFE-LOCAL.
   */
  function _initials(nombre) {
    if (!nombre) return "?";
    return nombre.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  }

  /**
   * @interaction hub-grupo-estado-evolutivo
   * @scope estudiante-hub-grupo-iife-helper-evolutivo
   *
   * Given grupoGamer con xpGrupal + logrosObtenidos.
   * When `_buildComboHeraldicoHtml` necesita estado evolutivo del grupo.
   * Then 5-rama priorizada (top-down):
   *   - 5 "legendary": XP≥3000 Y logros≥5.
   *   - 4 "elite": XP≥1500 Y logros≥3.
   *   - 3 "established": XP≥500 Y logros≥1.
   *   - 2 "forming": XP≥200.
   *   - 1 "rookie" (default).
   *   Retorna `{idx, name, stars: idx}`.
   * Edge:
   *   - **Disparadores derivados del mockup B.1**.
   *   - **`stars: idx`** convención (siempre = idx para `_renderCrestSvg`).
   *   - Sin grupoGamer → rookie default.
   *   - Función PURA.
   *   - Helper IIFE-LOCAL.
   */
  function _getEstadoEvolutivo(grupoGamer) {
    if (!grupoGamer) return { idx: 1, name: "rookie", stars: 1 };
    const xp = grupoGamer.xpGrupal || 0;
    const logros = grupoGamer.logrosObtenidos || 0;
    let idx = 1, name = "rookie";
    if (xp >= 3000 && logros >= 5)       { idx = 5; name = "legendary"; }
    else if (xp >= 1500 && logros >= 3)  { idx = 4; name = "elite"; }
    else if (xp >= 500 && logros >= 1)   { idx = 3; name = "established"; }
    else if (xp >= 200)                  { idx = 2; name = "forming"; }
    return { idx, name, stars: idx };
  }

  /**
   * @interaction hub-grupo-render-crest-svg
   * @scope estudiante-hub-grupo-iife-render-crest
   *
   * Given stars (1-5).
   * When `_buildComboHeraldicoHtml` muestra escudo crest del grupo.
   * Then SVG 96×110 con:
   *   - 2 gradients defs (crest-fill brand + crest-edge blanco shine).
   *   - Estrellas decorativas laterales (cuerdas amber stroke).
   *   - **Shield path canonical** (M20 14 ... Q20 86 20 58 Z).
   *   - Chief horizontal con line divisor + N estrellas blancas
   *     (positions hardcoded per N en `STAR_PATHS` dict).
   *   - 2 paths decorativos blancos (lirios/símbolos centrales).
   * Edge:
   *   - **N clamped [1, 5]**.
   *   - **`STAR_PATHS` dict 5 entries** con coordinates pre-calculadas
     para cada count. Pattern simple: 1 centro, 2 split, 3 spread, etc.
   *   - **Función PURA gigante** (~65 LOC SVG inline).
   *   - Helper IIFE-LOCAL.
   *   - Deuda: mover STAR_PATHS a constante module-scope (no recrear).
   */
  function _renderCrestSvg(stars) {
    const STAR_PATHS = {
      1: ['M48 17 l1.3 2.7 3 0.3 -2.3 2 0.7 3 -2.7 -1.5 -2.7 1.5 0.7 -3 -2.3 -2 3 -0.3 z'],
      2: [
        'M38 17 l1.2 2.6 2.8 0.3 -2.1 1.9 0.6 2.8 -2.5 -1.4 -2.5 1.4 0.6 -2.8 -2.1 -1.9 2.8 -0.3 z',
        'M58 17 l1.2 2.6 2.8 0.3 -2.1 1.9 0.6 2.8 -2.5 -1.4 -2.5 1.4 0.6 -2.8 -2.1 -1.9 2.8 -0.3 z'
      ],
      3: [
        'M32 18 l1.2 2.6 2.8 0.3 -2.1 1.9 0.6 2.8 -2.5 -1.4 -2.5 1.4 0.6 -2.8 -2.1 -1.9 2.8 -0.3 z',
        'M48 17 l1.3 2.7 3 0.3 -2.3 2 0.7 3 -2.7 -1.5 -2.7 1.5 0.7 -3 -2.3 -2 3 -0.3 z',
        'M64 18 l1.2 2.6 2.8 0.3 -2.1 1.9 0.6 2.8 -2.5 -1.4 -2.5 1.4 0.6 -2.8 -2.1 -1.9 2.8 -0.3 z'
      ],
      4: [
        'M28 18 l1.2 2.6 2.8 0.3 -2.1 1.9 0.6 2.8 -2.5 -1.4 -2.5 1.4 0.6 -2.8 -2.1 -1.9 2.8 -0.3 z',
        'M42 18 l1.2 2.6 2.8 0.3 -2.1 1.9 0.6 2.8 -2.5 -1.4 -2.5 1.4 0.6 -2.8 -2.1 -1.9 2.8 -0.3 z',
        'M55 18 l1.2 2.6 2.8 0.3 -2.1 1.9 0.6 2.8 -2.5 -1.4 -2.5 1.4 0.6 -2.8 -2.1 -1.9 2.8 -0.3 z',
        'M68 18 l1.2 2.6 2.8 0.3 -2.1 1.9 0.6 2.8 -2.5 -1.4 -2.5 1.4 0.6 -2.8 -2.1 -1.9 2.8 -0.3 z'
      ],
      5: [
        'M25 18 l1.2 2.6 2.8 0.3 -2.1 1.9 0.6 2.8 -2.5 -1.4 -2.5 1.4 0.6 -2.8 -2.1 -1.9 2.8 -0.3 z',
        'M37 18 l1.2 2.6 2.8 0.3 -2.1 1.9 0.6 2.8 -2.5 -1.4 -2.5 1.4 0.6 -2.8 -2.1 -1.9 2.8 -0.3 z',
        'M48 17 l1.3 2.7 3 0.3 -2.3 2 0.7 3 -2.7 -1.5 -2.7 1.5 0.7 -3 -2.3 -2 3 -0.3 z',
        'M60 18 l1.2 2.6 2.8 0.3 -2.1 1.9 0.6 2.8 -2.5 -1.4 -2.5 1.4 0.6 -2.8 -2.1 -1.9 2.8 -0.3 z',
        'M72 18 l1.2 2.6 2.8 0.3 -2.1 1.9 0.6 2.8 -2.5 -1.4 -2.5 1.4 0.6 -2.8 -2.1 -1.9 2.8 -0.3 z'
      ]
    };
    const n = Math.max(1, Math.min(5, stars || 1));
    const starsSvg = STAR_PATHS[n].map(d => `<path d="${d}"/>`).join("");
    return `
      <svg viewBox="0 0 96 110" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="b1mg-crest-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stop-color="#00d4ff"/>
            <stop offset="50%"  stop-color="#1b4fe4"/>
            <stop offset="100%" stop-color="#8b2be2"/>
          </linearGradient>
          <linearGradient id="b1mg-crest-edge" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>
            <stop offset="100%" stop-color="#ffffff" stop-opacity="0.05"/>
          </linearGradient>
        </defs>
        <g stroke="#f5a623" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.85">
          <path d="M8 30 Q4 52 14 78"/>
          <path d="M6 38 Q10 38 12 42"/>
          <path d="M5 48 Q9 48 11 52"/>
          <path d="M6 58 Q10 58 12 62"/>
          <path d="M8 68 Q12 68 14 72"/>
          <path d="M88 30 Q92 52 82 78"/>
          <path d="M90 38 Q86 38 84 42"/>
          <path d="M91 48 Q87 48 85 52"/>
          <path d="M90 58 Q86 58 84 62"/>
          <path d="M88 68 Q84 68 82 72"/>
        </g>
        <path d="M20 14 L76 14 L76 58 Q76 86 48 100 Q20 86 20 58 Z"
              fill="url(#b1mg-crest-fill)" stroke="#ffffff" stroke-width="1.5" stroke-opacity="0.4"/>
        <path d="M22 16 L74 16 L74 32 Q48 40 22 32 Z" fill="url(#b1mg-crest-edge)"/>
        <line x1="22" y1="30" x2="74" y2="30" stroke="#ffffff" stroke-opacity="0.55" stroke-width="0.8"/>
        <g fill="#ffffff">${starsSvg}</g>
        <g fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.95">
          <path d="M40 50 Q34 50 34 58 Q34 64 30 66 Q34 68 34 74 Q34 82 40 82"/>
          <path d="M56 50 Q62 50 62 58 Q62 64 66 66 Q62 68 62 74 Q62 82 56 82"/>
        </g>
      </svg>
    `;
  }

  /**
   * @interaction hub-grupo-meta-stubs
   * @scope estudiante-hub-grupo-iife-stubs-hardcoded
   *
   * Given grupoId / uid.
   * When `_buildComboHeraldicoHtml` necesita meta institucional + rareza.
   * Then 2 stubs DEMO hardcoded:
   *   - `_getMetaInstitucional(grupoId)`: retorna SIEMPRE meta de ISC-3A
   *     (carrera ISC + cohorte 2023-2026 + meta "ISC-3A · 3er Cuatri · Mayo-Sept 2026").
   *   - `_getRarezaMiembro(uid)`: hardcoded "rare" para est2/est4, else "common".
   * Edge:
   *   - **AMBOS son STUBS DEMO** — comentarios inline lo explicitan.
   *     `_getMetaInstitucional` no varía por grupoId (mock).
   *     `_getRarezaMiembro` no varía por seed (ids hardcoded).
   *   - Deuda post-Supabase: tablas `carreras` + `cohortes` + `usuario_rareza`
     para data real.
   *   - Funciones PURAS.
   *   - Helpers IIFE-LOCALES.
   */
  function _getMetaInstitucional(grupoId) {
    return {
      carrera: "Ingeniería en Sistemas Computacionales",
      cohorte: "2023 — 2026",
      cohorteShort: "Generación 2026",
      meta: "ISC-3A · 3er Cuatri · Mayo–Septiembre 2026"
    };
  }

  // Rareza por miembro (DEMO). est2 y est4 = rare; resto common.
  function _getRarezaMiembro(uid) {
    return (uid === "est2" || uid === "est4") ? "rare" : "common";
  }

  /**
   * @interaction hub-grupo-build-combo-heraldico
   * @scope estudiante-hub-grupo-iife-builder-combo
   *
   * Given ctx con `{grupoId, miembros, grupoGamer}`.
   * When `_renderOnView` arma el combo heráldico top.
   * Then HTML compuesto:
   *   - badge estado evolutivo (icon estrella + name cap + idx/5).
   *   - crest SVG via `_renderCrestSvg(stars)`.
   *   - ribbon de chips miembros (top 5 con `_initials` + rare highlight).
   *   - meta institucional (carrera + cohorte).
   * Edge:
   *   - **Slice de top 5 miembros** — convención visual. Más miembros
     visibles en grid abajo.
   *   - **`b1-mg-member-chip--rare` clase** según `_getRarezaMiembro`.
   *   - aria-label dinámico para a11y.
   *   - Función PURA (retorna string HTML).
   *   - Helper IIFE-LOCAL.
   */
  function _buildComboHeraldicoHtml(ctx) {
    const { grupoId, miembros, grupoGamer } = ctx;
    const estado = _getEstadoEvolutivo(grupoGamer);
    const meta = _getMetaInstitucional(grupoId);
    const estadoCap = estado.name.charAt(0).toUpperCase() + estado.name.slice(1);

    const ribbonHtml = miembros.slice(0, 5).map(m => {
      const rare = _getRarezaMiembro(m.id);
      const initials = _initials(m.nombre);
      const cls = rare === "rare" ? "b1-mg-member-chip b1-mg-member-chip--rare" : "b1-mg-member-chip";
      return `<span class="${cls}" title="${m.nombre} (${rare})">${initials}</span>`;
    }).join("");

    return `
      <div class="b1-mg-crest-wrap" data-gamer="on" role="region" aria-label="Identidad del grupo ${grupoId}">
        <span class="b1-mg-evo-badge" title="Estado evolutivo: ${estado.name} (${estado.idx}/5)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3l2.6 5.8 6.4.6-4.8 4.3 1.4 6.3L12 17l-5.6 3 1.4-6.3L3 9.4l6.4-.6z"/>
          </svg>
          ${estadoCap} · ${estado.idx}/5
        </span>

        <div class="b1-mg-crest-grid">
          <div class="b1-mg-crest" aria-hidden="true">${_renderCrestSvg(estado.stars)}</div>

          <div class="b1-mg-crest-text">
            <h2 class="b1-mg-crest-text__career">${meta.carrera}</h2>
            <div class="b1-mg-crest-text__cohort"><span>${meta.cohorte}</span></div>
            <p class="b1-mg-crest-text__meta">${meta.meta}</p>
          </div>

          <div class="b1-mg-members-ribbon" aria-label="${miembros.length} miembros del grupo">
            ${ribbonHtml}
          </div>
        </div>

        <div class="b1-mg-cohort-banner" aria-label="${meta.cohorteShort}">
          <span class="b1-mg-cohort-banner__tail" aria-hidden="true"></span>
          <span class="b1-mg-cohort-banner__body">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 9l9-5 9 5-9 5z"/>
              <path d="M6 11v4c0 2 3 3 6 3s6-1 6-3v-4"/>
            </svg>
            ${meta.cohorteShort}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 9l9-5 9 5-9 5z"/>
              <path d="M6 11v4c0 2 3 3 6 3s6-1 6-3v-4"/>
            </svg>
          </span>
          <span class="b1-mg-cohort-banner__tail b1-mg-cohort-banner__tail--right" aria-hidden="true"></span>
        </div>
      </div>
    `;
  }

  /**
   * @interaction hub-grupo-build-trayectoria
   * @scope estudiante-hub-grupo-iife-builder-trayectoria
   *
   * Given ctx con grupoGamer + promGrupo + miembros.
   * When `_renderOnView` arma sidebar trayectoria.
   * Then sección "Trayectoria del grupo" con:
   *   - Stat XP grupal acumulado + bar progress prestigio.
   *   - Promedio del grupo.
   *   - Comparativa otros grupos (placeholder DEMO).
   * Edge:
   *   - **Stub DEMO comparativa** — pattern simplista.
   *   - Función PURA.
   *   - Helper IIFE-LOCAL.
   */
  function _buildTrayectoriaHtml(ctx) {
    const { miembros, promGrupo, grupoGamer } = ctx;
    if (!grupoGamer) {
      return `<div class="x-empty"><div class="x-empty__desc">Sin datos de trayectoria</div></div>`;
    }
    const xp = grupoGamer.xpGrupal || 0;
    const xpMax = grupoGamer.xpMax || 1;
    const pct = Math.max(0, Math.min(100, Math.round((xp / xpMax) * 100)));
    const prestigio = grupoGamer.prestigioNivel || 1;
    // Comparativa cohorte hardcoded del mockup hasta tener data agregada real.
    const percentile = 75;
    const cohortPos = "Top 3 · Gen ISC 2023-2026";

    return `
      <div class="b1-mg-body__stats-grid" role="list" aria-label="Estadísticas del grupo">
        <div class="b1-mg-body__stat-box" role="listitem">
          <span class="x-stat__num" style="font-size:var(--text-size-lg)">${promGrupo ?? "—"}</span>
          <span class="x-stat__label">Promedio grupal</span>
        </div>
        <div class="b1-mg-body__stat-box" role="listitem">
          <span class="x-stat__num" style="font-size:var(--text-size-lg);color:var(--xahni-amber)">${xp.toLocaleString()}</span>
          <span class="x-stat__label">XP grupal / ${xpMax.toLocaleString()}</span>
        </div>
        <div class="b1-mg-body__stat-box" role="listitem">
          <span class="x-stat__num" style="font-size:var(--text-size-lg)">Niv. ${prestigio}</span>
          <span class="x-stat__label">Prestigio</span>
        </div>
        <div class="b1-mg-body__stat-box" role="listitem">
          <span class="x-stat__num" style="font-size:var(--text-size-lg)">${miembros.length}</span>
          <span class="x-stat__label">Miembros activos</span>
        </div>
      </div>

      <div style="margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
          <span class="x-label">XP hacia Niv. ${prestigio + 1}</span>
          <span style="font-family:var(--font-mono);font-size:var(--text-size-xs);color:var(--text-muted)">${xp.toLocaleString()} / ${xpMax.toLocaleString()}</span>
        </div>
        <div class="x-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="XP grupal: ${xp} de ${xpMax}">
          <div class="x-progress__fill" style="width:${pct}%"></div>
        </div>
      </div>

      <div class="b1-mg-body__cohort-compare">
        <div class="b1-mg-body__cohort-head">
          <span class="b1-mg-body__cohort-label">Comparativa cohorte</span>
          <span class="x-chip x-chip--brand">${cohortPos}</span>
        </div>
        <div class="b1-mg-body__percentile-wrap">
          <div class="b1-mg-body__percentile-caption">
            <span class="b1-mg-body__percentile-label">Percentil del grupo (3 de 4 grupos ISC-3*)</span>
            <span class="b1-mg-body__percentile-value">${percentile}%</span>
          </div>
          <div class="x-progress" role="progressbar" aria-valuenow="${percentile}" aria-valuemin="0" aria-valuemax="100" aria-label="Percentil: ${percentile}%">
            <div class="x-progress__fill x-progress__fill--ok" style="width:${percentile}%"></div>
          </div>
        </div>
        <p class="b1-mg-body__cohort-note">Tu grupo está en el <strong>25% superior</strong> de tu cohorte.</p>
      </div>
    `;
  }

  /**
   * @interaction hub-grupo-build-actividad
   * @scope estudiante-hub-grupo-iife-builder-actividad
   *
   * Given ctx con grupoId + miembros.
   * When `_renderOnView` arma sidebar actividad reciente.
   * Then timeline de eventos recientes del grupo (cross-miembros):
   *   - últimas entregas calificadas con miembro + tarea + nota.
   *   - empty state si sin actividad.
   * Edge:
   *   - **Cross-miembros aggregator**: itera todas las tareas DEMO_TAREAS
     filter por grupo.
   *   - **Top N sorted desc por fecha** — convención timeline.
   *   - Función PURA.
   *   - Helper IIFE-LOCAL.
   */
  function _buildActividadRecienteHtml(ctx) {
    // Bug 2026-06-09: antes este builder generaba 5 eventos hardcoded
    // ("Madrugadores", "Caso integrador BD+POO", "Estratega") mezclados con
    // datos demo. Ahora consume getActividadGrupo(grupoId, 8) que itera los
    // miembros del grupo y agrega sus actividades reales (tareas, juegos,
    // competencias) desde DEMO_PROGRESO_ESTUDIANTES y getActividadAlumno.
    const grupoId = (APP?.user?.grupos || [])[0];
    const eventos = (typeof getActividadGrupo === "function" && grupoId)
      ? getActividadGrupo(grupoId, 8) : [];

    if (!eventos.length) {
      return `<div class="x-empty" style="padding:18px;text-align:center;color:var(--text-muted)">
        <div style="font-size:24px;margin-bottom:6px">📡</div>
        <div>Sin actividad reciente del grupo</div>
      </div>`;
    }

    // "Cuando" relativo en español: hoy/ayer/hace N días
    const ahora = Date.now();
    const fmtRel = (fecha) => {
      const diff = ahora - fecha.getTime();
      const dias = Math.floor(diff / 86400000);
      const horas = Math.floor(diff / 3600000);
      if (horas < 1) return "Hace un momento";
      if (horas < 24) return `Hace ${horas} hora${horas !== 1 ? "s" : ""}`;
      if (dias === 1) return "Ayer";
      if (dias < 7) return `Hace ${dias} días`;
      if (dias < 30) return `Hace ${Math.floor(dias / 7)} semana${dias >= 14 ? "s" : ""}`;
      return fecha.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
    };

    // Mapear tipo de evento canonical a la categoría visual del timeline.
    // tareas/juegos/competencias son "individuales" en este shell (ningún
    // event-source genera todavía colectivos reales — deuda explícita para
    // cuando exista el feed agregado de grupo).
    const items = eventos.map(ev => {
      const tipo = "individual";
      const chipCls = "x-chip x-chip--muted";
      const itemCls = "b1-mg-body__tl-item b1-mg-body__tl-item--individual";
      return `
        <div class="${itemCls}" role="listitem">
          <div class="b1-mg-body__tl-row">
            <div class="b1-mg-body__tl-text">${ev.icon ? ev.icon + " " : ""}${ev.text}</div>
            <div class="b1-mg-body__tl-trail">
              <span class="b1-mg-body__tl-time">${fmtRel(ev.fecha)}</span>
              <span class="${chipCls}" style="font-size:var(--text-size-2xs);padding:2px 7px">${tipo}</span>
            </div>
          </div>
        </div>`;
    }).join("");

    return `<div class="b1-mg-body__timeline" role="list" aria-label="Eventos recientes">${items}</div>`;
  }

  // Showcase de logros del grupo: 3 badges destacadas + disclosure "Ver todos" + 3 pennants.
  // Datos hardcoded coherentes con grupo ISC-3A demo (épica/rara/legendaria).
  /**
   * @interaction hub-grupo-build-logros-showcase
   * @scope estudiante-hub-grupo-iife-builder-logros
   *
   * Given ctx con grupoGamer + miembros.
   * When `_renderOnView` arma main "Logros del grupo".
   * Then grid de logros con:
   *   - logros obtenidos del grupo (catalog primeros N).
   *   - logros bloqueados (siguientes).
   *   - chip count "obtenidos / total".
   * Edge:
   *   - **Sliding mask pattern DEMO** (twin con grupos.js
     buildGrupoLogros). Deuda post-Supabase: tabla grupo_logros.
   *   - Función PURA.
   *   - Helper IIFE-LOCAL.
   */
  function _buildLogrosShowcaseHtml(ctx) {
    const badges = [
      { emoji: "🏅", nombre: "Madrugadores",     rareza: "epico",     rarezaLabel: "Épica",      desc: "Sin retrasos en P1" },
      { emoji: "🤝", nombre: "Colaboración total", rareza: "raro",     rarezaLabel: "Rara",       desc: "Tarea multidisciplinaria entregada por todos" },
      { emoji: "⭐", nombre: "Top 3 cohorte",     rareza: "legendario", rarezaLabel: "Legendaria", desc: "Top 3 de ISC 2023-2026 en P1" }
    ];
    const pennants = [
      "🏴 Competencia BD vs POO",
      "🏴 Disciplina Matemáticas",
      "🏴 Cohorte ISC 2023-2026"
    ];

    const badgesHtml = badges.map(b => `
      <div class="b1-mg-body__badge-card" role="listitem" title="${b.nombre} — ${b.desc} (${b.rarezaLabel})">
        <span class="b1-mg-body__badge-emoji" aria-hidden="true">${b.emoji}</span>
        <span class="b1-mg-body__badge-name">${b.nombre}</span>
        <span class="x-chip b1-mg-body__rarity--${b.rareza}" style="font-size:var(--text-size-2xs);padding:2px 7px">${b.rarezaLabel}</span>
        <span class="b1-mg-body__badge-desc">${b.desc}</span>
      </div>
    `).join("");

    const pennantsHtml = pennants.map(p => `<span class="b1-mg-body__pennant" role="listitem">${p}</span>`).join("");

    return `
      <div class="b1-mg-body__badges-grid" role="list">${badgesHtml}</div>
      <div class="b1-mg-body__disclosure-row">
        <button type="button" class="x-btn x-btn--ghost" style="font-size:var(--text-size-xs);padding:6px 12px" aria-expanded="false">
          <svg class="x-icon x-icon--sm" aria-hidden="true"><use href="#x-icon-chevron-down"></use></svg>
          Ver todos (${badges.length})
        </button>
      </div>
      <div class="b1-mg-body__pennants" role="list" aria-label="Estandartes del grupo">${pennantsHtml}</div>
    `;
  }

  // Grid de miembros con cards b1-mg-body__member-card (banner + avatar + title + slots + stats).
  // Reemplaza el render legacy _buildMiembroGamer en el nuevo layout.
  // Click → openModalPerfilPublico(uid). Sin flyout hover (mockup no lo tiene).
  /**
   * @interaction hub-grupo-build-members-grid
   * @scope estudiante-hub-grupo-iife-builder-members
   *
   * Given ctx con miembros + grupoId.
   * When `_renderOnView` arma main "Miembros del grupo".
   * Then grid de cards miembros con:
   *   - avatar (Pilar 1 getAvatarDisplay si disponible, fallback iniciales).
   *   - nombre + chip "tú" si esYo.
   *   - promedio del miembro.
   *   - chip rareza.
   *   - onclick `openModalPerfilPublico(uid, 'modal', 'grupo')`.
   * Edge:
   *   - **Avatar canonical** via getAvatarDisplay (Pilar 1 helper).
   *   - **Modal context 'grupo'**: el modal muestra sección "Contribución
     al grupo" del alumno (slice B/C simetría con profesor).
   *   - Click handlers inline (no delegated — slice E eliminó hover
     delegated tras colapsar dual-DOM).
   *   - Función PURA.
   *   - Helper IIFE-LOCAL.
   */
  function _buildMembersGridHtml(ctx) {
    const { miembros } = ctx;
    if (!miembros.length) {
      return `<div class="x-empty"><div class="x-empty__desc">Sin miembros</div></div>`;
    }
    const cardsHtml = miembros.map(m => {
      const rare = _getRarezaMiembro(m.id);
      const rareCls = rare === "rare" ? " b1-mg-body__member-card--rare" : "";
      const isMe = m.id === (APP.user && APP.user.id);
      const disp = (typeof getAvatarDisplay === "function") ? getAvatarDisplay(m.id) : null;
      const fotoTexto = disp ? disp.fotoTexto : _initials(m.nombre);
      const titulo = (disp && disp.tituloHtml) || ((m.gamer && m.gamer.titulo) || "");
      const prom = _getPromedioMiembro(m.id);
      const xpInd = (m.gamer && m.gamer.xpIndividual) || 0;

      // Slots: hasta 2 chips visibles
      const slots = ((m.gamer && m.gamer.slots) || []).slice(0, 2);
      const slotsHtml = slots.map(slotId => {
        const info = _getSlotInfo(slotId);
        const icon = info ? info.icono : "·";
        const label = info ? info.nombre : "";
        return `<span class="x-chip x-chip--muted" style="padding:2px 6px;font-size:var(--text-size-2xs)" title="${label}">${icon}</span>`;
      }).join("");

      // Stats: contribución XP + promedio
      const xpDisplay = xpInd ? `+${xpInd.toLocaleString()} XP` : "Sin actividad";
      const promDisplay = prom !== null ? `Prom ${prom}` : "Prom —";

      return `
        <div class="b1-mg-body__member-card${rareCls}" role="listitem"
             data-miembro-id="${m.id}"
             onclick="if(typeof window.openModalPerfilPublico==='function') window.openModalPerfilPublico('${m.id}', 'modal', 'grupo');"
             aria-label="${m.nombre}${isMe ? ' (yo)' : ''}">
          <div class="b1-mg-body__member-banner"${disp && disp.bannerBg ? ` style="background:${disp.bannerBg}"` : ""}>
            <div class="b1-mg-body__member-avatar" aria-hidden="true"${disp && disp.gradient ? ` style="background:${disp.gradient}"` : ""}>${fotoTexto}</div>
          </div>
          <div class="b1-mg-body__member-body">
            <div class="b1-mg-body__member-name">
              ${m.nombre}
              ${isMe ? '<span class="b1-mg-body__member-self">(yo)</span>' : ''}
            </div>
            ${titulo ? `<div class="b1-mg-body__member-title">${titulo}</div>` : ""}
            ${slotsHtml ? `<div class="b1-mg-body__member-slots" aria-label="Slots activos">${slotsHtml}</div>` : ""}
            <div class="b1-mg-body__member-stats">
              <span class="b1-mg-body__member-xp">${xpDisplay}</span>
              <span class="b1-mg-body__member-prom">${promDisplay}</span>
            </div>
          </div>
        </div>`;
    }).join("");

    return `<div class="b1-mg-body__members-grid" role="list">${cardsHtml}</div>`;
  }

  // ── Entrypoint ──────────────────────────────────────────────
  // Slice E B.1 (2026-06-01): colapsó el dual-DOM gamer-off/gamer-on per spec
  // B.1 §4.2/§4.4 ("MISMA ESTRUCTURA, presentación suavizada"). Ahora SOLO
  // _renderOnView se invoca; el visual gamer-off se aplica vía body.gamer-off
  // .b1-mg-* overrides en hub-grupo-b1.css. Helpers obsoletos eliminados:
  // _renderOffView, _renderColabsHtml, _buildPerfilGrupoMin, _buildPerfilGrupoBig,
  // _buildMiembroGamer, _buildFlyout, _attachHoverHandlers (git history para reuso).
  /**
   * @interaction hub-grupo-render-mi-grupo
   * @scope estudiante-hub-grupo-iife-entrypoint
   *
   * Given alumno logueado.
   * When `hubGrupoSwitchTab("mi-grupo")` cross-archivo invoca (window export).
   * Then orchestrator:
   *   1. Resuelve grupoId. Sin → `_renderEmpty("Aún no perteneces a un grupo")`.
   *   2. Construye ctx con miembros + promGrupo + colabs + grupoGamer.
   *   3. Delega a `_renderOnView(ctx)`.
   * Edge:
   *   - **Render DUAL gamer-off + gamer-on per slice E** (post-colapso
     dual-DOM 2026-06-01). CSS toggle via body.gamer-off — JS produce
     ambos cada vez.
   *   - Helpers legacy ELIMINADOS (Slice E): `_renderOffView`,
     `_renderColabsHtml`, `_buildPerfilGrupoMin/Big`, `_buildMiembroGamer`,
     `_buildFlyout`, `_attachHoverHandlers` (git history para recuperar).
   *   - **Único `window.hubGrupoRenderMiGrupo` export** del módulo.
   *   - Función IMPURA (DOM via _renderOnView).
   */
  function hubGrupoRenderMiGrupo() {
    const grupoId = _getGrupoId();
    if (!grupoId) {
      _renderEmpty("Aún no perteneces a un grupo");
      return;
    }

    const miembros   = _getMiembros(grupoId);
    const promGrupo  = _getPromedioGrupo(miembros);
    const colabs     = _getColaborativas(grupoId);
    const grupoGamer = _getGrupoGamer(grupoId);

    const ctx = { grupoId, miembros, promGrupo, colabs, grupoGamer };
    _renderOnView(ctx);
  }

  /**
   * @interaction hub-grupo-render-empty
   * @scope estudiante-hub-grupo-iife-render-empty
   *
   * Given msg string.
   * When alumno sin grupo asignado o lookup falla.
   * Then innerHTML del tab con `.x-card > .x-empty` con icon 👥.
   * Edge:
   *   - **Slice E**: 1 sólo container post-colapso dual-DOM.
   *   - DOM target ausente → no-op.
   *   - Helper IIFE-LOCAL.
   *   - Función IMPURA (DOM).
   */
  function _renderEmpty(msg) {
    // Slice E B.1: 1 sólo container post-colapso dual-DOM.
    const html = `
      <div class="x-card">
        <div class="x-empty">
          <div class="x-empty__icon">👥</div>
          <div class="x-empty__title">${msg}</div>
        </div>
      </div>`;
    const tab = document.getElementById("hub-grupo-tab-mi-grupo");
    if (tab) tab.innerHTML = html;
  }

  // ── Helpers legacy ELIMINADOS (Slice E 2026-06-01) ─────────
  // _renderOffView, _renderColabsHtml, _buildPerfilGrupoMin, _buildPerfilGrupoBig,
  // _buildMiembroGamer, _buildFlyout, _attachHoverHandlers removidos al colapsar
  // el dual-DOM cementado en C8b Slice B.2. El cuerpo nuevo .b1-mg-* del
  // _renderOnView ahora cubre ambos modos (gamer-on/off) per spec B.1 §4.2.
  // Para recuperar el visual legacy: git show <pre-slice-E-SHA>:js/estudiante/hub-grupo.js.

  // Metadata del periodo activo. Usa core helpers getPeriodoDeGrupo + getPeriodoInfo
  // (declarados en js/core/periodo.js) — devuelven el periodo real del grupo.
  // Fallback a hardcoded del mockup si los helpers no existen.
  /**
   * @interaction hub-grupo-periodo-helpers
   * @scope estudiante-hub-grupo-iife-helper-periodo
   *
   * Given grupoId / bodyHtml.
   * When `_renderOnView` arma sección periodo.
   * Then 2 helpers combined:
   *   - `_getPeriodoMeta(grupoId)`: shape `{nombre, semanaActual,
     semanasTotales, estado}`. Cascada `getPeriodoDeGrupo` +
     `getPeriodoInfo` core helpers; fallback hardcoded mockup si missing.
   *   - `_stripPeriodoLabel(bodyHtml)`: elimina spans "Semana N de M",
     "Aún no inicia", "Periodo cerrado" del body (ahora chip en title).
   * Edge:
   *   - **try/catch silencioso** en `_getPeriodoMeta` para tolerar errors
     de los helpers core.
   *   - **`_stripPeriodoLabel` DOM-based parse**: requiere `document`
     disponible (no SSR-safe).
   *   - **Twin EXACTO con profesor `_hgpPeriodoMeta` + `_hgpStripPeriodoLabel`**
     (hub-grupo profesor sesión 8a). Deuda consolidación shared.
   *   - Funciones PURAS.
   *   - Helpers IIFE-LOCALES.
   */
  function _getPeriodoMeta(grupoId) {
    try {
      if (typeof getPeriodoDeGrupo === "function" && typeof getPeriodoInfo === "function") {
        const raw = getPeriodoDeGrupo(grupoId);
        const info = raw ? getPeriodoInfo(raw) : null;
        if (info) {
          return {
            nombre: info.nombre || "Mayo–Septiembre 2026",
            semanaActual: info.semanaActual || null,
            semanasTotales: info.totalSemanas || null,
            estado: info.estado || "activo"
          };
        }
      }
    } catch (_) { /* fallback silently */ }
    return { nombre: "Mayo–Septiembre 2026", semanaActual: null, semanasTotales: null, estado: "activo" };
  }

  // Elimina del HTML del body de periodo el span con label "Semana N de M",
  // "Aún no inicia" o "Periodo cerrado" — ahora se muestra como chip en el title.
  function _stripPeriodoLabel(bodyHtml) {
    if (!bodyHtml || typeof document === "undefined") return bodyHtml;
    const tmp = document.createElement("div");
    tmp.innerHTML = bodyHtml;
    tmp.querySelectorAll("span").forEach(s => {
      const t = s.textContent.trim();
      if (/^Semana \d+ de \d+$/.test(t) || t === "Aún no inicia" || t === "Periodo cerrado") {
        s.remove();
      }
    });
    return tmp.innerHTML;
  }

  // ── Renderer: gamer-on ──────────────────────────────────────
  /**
   * @interaction hub-grupo-render-on-view
   * @scope estudiante-hub-grupo-iife-renderer-principal
   *
   * Given ctx con `{grupoId, miembros, promGrupo, colabs, grupoGamer}`.
   * When `hubGrupoRenderMiGrupo` invoca tras hidratar ctx.
   * Then renderer principal (~80 LOC):
   *   1. DOM target `#hub-grupo-on-root`. Sin → no-op.
   *   2. Resuelve periodoBody via `hubBuildPeriodoSection` shared +
     periodoMeta + chip dinámico (estado/semana).
   *   3. innerHTML compuesto:
   *      - `_buildComboHeraldicoHtml(ctx)` (top full-width).
   *      - `.hub-grupo-periodo-full` card con title icon + nombre + chip
        + body stripped.
   *      - `.x-grid--2of3` con 2 columnas:
   *        - **MAIN**: Logros showcase + Miembros grid.
   *        - **SIDEBAR**: Trayectoria + Actividad reciente.
   * Edge:
   *   - **Rediseño B.1** spec mockup (slice 2026-06-01).
   *   - **Sin "Actividades colaborativas"** — mockup no las tiene
     (decisión consciente, slice E).
   *   - **Renderer ÚNICO post-Slice E** (dual-DOM colapsado). CSS toggle
     gamer-on/off ya no afecta JS render.
   *   - Helpers legacy ELIMINADOS (Slice E): `_buildPerfilGrupoBig`,
     `_buildMiembroGamer`, `_buildFlyout`, `_attachHoverHandlers`.
   *   - Función IMPURA (DOM masivo).
   *   - Helper IIFE-LOCAL.
   *   - **Renderer más grande del módulo**.
   */
  function _renderOnView(ctx) {
    const { grupoId } = ctx;
    const root = document.getElementById("hub-grupo-on-root");
    if (!root) return;

    const periodoBodyRaw = (typeof window.hubBuildPeriodoSection === "function")
      ? window.hubBuildPeriodoSection(grupoId)
      : "";
    const periodoBody = _stripPeriodoLabel(periodoBodyRaw);
    const periodoMeta = _getPeriodoMeta(grupoId);
    const periodoChipText = periodoMeta.estado === "futuro"
      ? "Aún no inicia"
      : periodoMeta.estado === "cerrado"
        ? "Periodo cerrado"
        : (periodoMeta.semanaActual && periodoMeta.semanasTotales
            ? `Semana ${periodoMeta.semanaActual} de ${periodoMeta.semanasTotales}`
            : "");
    const periodoChip = periodoChipText
      ? `<span class="x-chip x-chip--info" style="margin-left:auto;font-size:var(--text-size-2xs)">${periodoChipText}</span>`
      : "";

    root.innerHTML = `
      ${_buildComboHeraldicoHtml(ctx)}

      <div class="x-card hub-grupo-periodo-full" style="margin-bottom:16px">
        <div class="x-card-title">
          <svg class="x-icon"><use href="#x-icon-calendar"></use></svg>
          Periodo · Cuatrimestre ${periodoMeta.nombre}
          ${periodoChip}
        </div>
        ${periodoBody}
      </div>

      <div class="x-grid x-grid--2of3" style="gap:16px;align-items:flex-start">
        <div class="x-stack" style="display:flex;flex-direction:column;gap:16px">
          <div class="x-card b1-mg-body__section" style="margin-top:0" aria-label="Logros del grupo">
            <div class="b1-mg-body__card-head">
              <span class="b1-mg-body__card-title">
                <svg class="x-icon x-icon--md"><use href="#x-icon-trophy"></use></svg>
                Logros del grupo
              </span>
            </div>
            ${_buildLogrosShowcaseHtml(ctx)}
          </div>

          <div class="x-card b1-mg-body__section" style="margin-top:0" aria-label="Miembros del grupo">
            <div class="b1-mg-body__card-head">
              <span class="b1-mg-body__card-title">
                <svg class="x-icon x-icon--md"><use href="#x-icon-grupo"></use></svg>
                Miembros del grupo
              </span>
              <span class="x-chip x-chip--muted">${ctx.miembros.length} miembros</span>
            </div>
            ${_buildMembersGridHtml(ctx)}
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="x-card b1-mg-body__section" style="margin-top:0" aria-label="Trayectoria y comparativa del grupo">
            <div class="b1-mg-body__card-head">
              <span class="b1-mg-body__card-title">
                <svg class="x-icon x-icon--md"><use href="#x-icon-target"></use></svg>
                Trayectoria del grupo
              </span>
            </div>
            ${_buildTrayectoriaHtml(ctx)}
          </div>

          <div class="x-card b1-mg-body__section" style="margin-top:0" aria-label="Actividad reciente del grupo">
            <div class="b1-mg-body__card-head">
              <span class="b1-mg-body__card-title">
                <svg class="x-icon x-icon--md"><use href="#x-icon-bell"></use></svg>
                Actividad reciente
              </span>
            </div>
            ${_buildActividadRecienteHtml(ctx)}
          </div>
        </div>
      </div>
    `;
  }

  // ── Helpers legacy ELIMINADOS (Slice E 2026-06-01) ─────────
  // _buildPerfilGrupoBig, _buildMiembroGamer, _buildFlyout, _attachHoverHandlers
  // removidos al colapsar dual-DOM. El nuevo render `_renderOnView` usa
  // `.b1-mg-body__member-card` con `onclick="openModalPerfilPublico(...,'grupo')"`
  // inline (Slice B/C) — no requiere hover handlers delegados.

  // ── Exposición global ───────────────────────────────────────
  window.hubGrupoRenderMiGrupo = hubGrupoRenderMiGrupo;

})();
