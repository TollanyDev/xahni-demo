// js/estudiante/dashboard.js
/**
 * @interaction init-estudiante-dashboard
 * @scope estudiante-dashboard-mount-legacy
 *
 * Given el usuario `u` (estudiante) en el flow legacy de `loadDashboard`.
 * When caller legacy invoca mount del dashboard estudiante (pre-shell hub).
 * Then:
 *   1. Build KPIs (`_buildEstKPIs`).
 *   2. Update riesgo badge (`_updateEstRiesgoBadge`).
 *   3. Show `#dash-est-content` + `#dash-accesos`.
 *   4. Hide `#dash-prof-content`.
 * Edge:
 *   - **Path LEGACY**: tras shell rework (#7+#8, merge 206ce4d, 2026-05-26),
 *     el estudiante entra a `#screen-hub` NO `#screen-dashboard`. Esta fn
 *     solo se ejecuta si caller legacy invoca directo. Twin de
 *     `initProfesorDashboard` (mismo C9-leftover).
 *   - DOM targets ausentes → no-op selectivo (defensive get).
 *   - `_buildEstKPIs`/`_updateEstRiesgoBadge` ausentes parse-time → ReferenceError
 *     (no defensive typeof). Convención: cargados juntos con dashboard.
 *   - Deuda C9-leftover: candidato cleanup post-Supabase.
 */
function initEstudianteDashboard(u) {
  const get = id => document.getElementById(id);
  _buildEstKPIs(u);
  _updateEstRiesgoBadge(u);
  if (get("dash-est-content"))  get("dash-est-content").style.display  = "";
  if (get("dash-accesos"))      get("dash-accesos").style.display      = "";
  const dashProf = get("dash-prof-content");
  if (dashProf) dashProf.style.display = "none";
}

/**
 * @interaction update-est-riesgo-badge
 * @scope estudiante-dashboard-render-badge
 *
 * Given el usuario `u` (estudiante).
 * When `initEstudianteDashboard` orquesta mount.
 * Then:
 *   1. Lookup `#dash-acc-riesgo-badge`. Sin → no-op.
 *   2. `getMateriasAlumno` ausente → setea 0 + return.
 *   3. Cuenta materias con `promedio < 7` (fallback ?? 99 si null).
 *   4. Setea textContent del badge.
 * Edge:
 *   - **Fallback `?? 99`** crítico: materias sin promedio cargado NO entran
 *     en riesgo (decisión consciente: ausencia ≠ riesgo). Convención cementada.
 *   - **Helper LEGACY**: comentario inline lo explicita ("Antes vivía en
 *     populateAll, que ya no se llama"). Path C9-leftover.
 *   - Helper LOCAL (sin window export).
 *   - Función IMPURA (DOM).
 */
function _updateEstRiesgoBadge(u) {
  const b = document.getElementById("dash-acc-riesgo-badge");
  if (!b) return;
  if (typeof getMateriasAlumno !== "function") { b.textContent = 0; return; }
  const enRiesgo = getMateriasAlumno(u.id).filter(m => (m.promedio ?? 99) < 7).length;
  b.textContent = enRiesgo;
}

/**
 * @interaction build-est-kpis
 * @scope estudiante-dashboard-render-kpis-legacy
 *
 * Given el usuario `u` (estudiante) + DOM con `#est-kpis`.
 * When `initEstudianteDashboard` orquesta.
 * Then 4 metric-cards x-grid:
 *   1. Materias activas (blue 📚) con delta "En {grupos}" o "Periodo actual".
 *   2. Puntos XP (teal ⭐) con delta "Nivel {nivel}".
 *   3. Nivel actual (amber 🏆) con delta "{pct}% al siguiente".
 *   4. Medallas (purple 🎖️) con delta "de {total} totales".
 *   - pctNextLevel: heurística `(puntos % 1000) / 1000 × 100` (1000 XP/nivel).
 * Edge:
 *   - DOM target ausente → no-op.
 *   - **Heurística XP/nivel hardcoded** (1000) — debería venir de
 *     `XP_THRESHOLDS` canonical o config. Deuda menor.
 *   - **`u.materias` puede ser undefined** (alumno sin asignación admin)
 *     → 0. Defensive `Array.isArray(u.materias)`.
 *   - **DEMO_LOGROS puede no estar cargado** → totalLogros/medallas 0.
 *   - **Twin de `_buildProfDashKPIs`** (dashboard profesor) — misma
 *     estructura visual + 4 stats. Convención cementada cross-rol.
 *   - **Path LEGACY** — co-vive con `_hubInicioBandaProgresoEst` (espejo
 *     elevado al hub). Deuda C9-leftover.
 *   - Función IMPURA (DOM).
 *   - Helper LOCAL.
 */
function _buildEstKPIs(u) {
  const el = document.getElementById("est-kpis");
  if (!el) return;

  const nMat       = Array.isArray(u.materias) ? u.materias.length : 0;
  const gruposLbl  = (Array.isArray(u.grupos) && u.grupos.length) ? u.grupos.join(", ") : "sin grupo";
  const puntos     = u.puntos ?? 0;
  const nivel      = u.nivel  ?? 0;
  const totalLogros   = Array.isArray(DEMO_LOGROS) ? DEMO_LOGROS.length : 0;
  // Sprint 2026-06-08 D4: contador runtime exclusivo desde GamerState.
  const medallas      = (typeof GamerState !== "undefined")
    ? (GamerState.get(u.id).insignias || []).length
    : 0;

  // % al siguiente nivel (1000 XP por nivel — heurística simple a partir de los datos demo).
  const pctNextLevel = Math.max(0, Math.min(100, Math.round(((puntos % 1000) / 1000) * 100)));

  const kpis = [
    { cls: "blue",   icon: "📚", num: nMat,                          lbl: "Materias activas", delta: gruposLbl ? `En ${gruposLbl}` : "Periodo actual" },
    { cls: "teal",   icon: "⭐", num: puntos.toLocaleString(),        lbl: "Puntos XP",        delta: `Nivel ${nivel}` },
    { cls: "amber",  icon: "🏆", num: nivel,                         lbl: "Nivel actual",     delta: `${pctNextLevel}% al siguiente` },
    { cls: "purple", icon: "🎖️", num: medallas,                      lbl: "Medallas",         delta: totalLogros ? `de ${totalLogros} totales` : "—" },
  ];

  el.innerHTML = `<div class="x-grid" style="margin-bottom:0">
      ${kpis.map(k => `
      <div class="metric-card ${k.cls}">
          <div class="metric-icon ${k.cls}">${k.icon}</div>
          <div class="metric-value">${k.num}</div>
          <div class="metric-label">${k.lbl}</div>
          <div class="metric-delta neutral">${k.delta}</div>
      </div>`).join("")}
  </div>`;
}
