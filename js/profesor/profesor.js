// js/profesor/profesor.js
// Helpers compartidos entre las vistas del profesor (gestion, mismaterias, tareas).
// Los datos hardcodeados (PROF_MATERIAS, PROF_ALUMNOS, PROF_CALS, PROF_TAREAS,
// PROF_RECURSOS) se eliminaron — cada vista deriva sus datos en vivo desde
// DEMO_* a través de su propio data-provider.

const PROF_AV_COLOR = {
  teal:   "var(--xahni-teal)",
  amber:  "var(--xahni-amber)",
  blue:   "var(--xahni-blue-light)",
  green:  "var(--xahni-green)",
  red:    "var(--xahni-red)",
  purple: "var(--xahni-purple-light)",
  cyan:   "var(--xahni-cyan)",
};

/**
 * @interaction calc-final-3-parciales
 * @scope profesor-helper-academic-legacy
 *
 * Given hasta 3 calificaciones de parciales (p1, p2, p3) en cualquier tipo
 *   (number, string numérica, null, "", undefined, NaN).
 * When un caller legacy del rol profesor (vistas pre-shell que pintaban
 *   tablas alumno×3-parciales) necesita el promedio numérico.
 * Then filtra entradas falsy/no-parseables, convierte a Number, promedia y
 *   retorna string con 2 decimales. Sin entradas válidas → "—".
 * Edge:
 *   - Helper LEGACY. El motor canónico de cálculo de parcial vive en
 *     `js/shared/calificaciones-calc.js` (calcularParcial + obtenerValorCriterio
 *     con escala + criterios ponderados). Este `_calcFinal` solo promedia
 *     parciales ya calculados; sirve a tablas históricas.
 *   - Retorna STRING (toFixed(2)), no number. Caller no aritmetiza el resultado.
 *   - 0 cuenta como parcial válido (no se filtra como "" o null).
 *   - Deuda post-Supabase: vista materializada `alumno_promedio_periodo`
 *     reemplaza el cálculo en cliente.
 */
function _calcFinal(p1, p2, p3) {
  const v = [p1, p2, p3]
    .filter((x) => x !== null && x !== "" && !isNaN(parseFloat(x)))
    .map(Number);
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : "—";
}

/**
 * @interaction color-final-por-nota
 * @scope profesor-helper-academic-legacy
 *
 * Given una nota (number o string parseable) o "—" / null / NaN.
 * When un caller pinta una calificación final y quiere semaforizarla
 *   inline (sin pasar por una clase `.x-chip --ok/--warn/--danger`).
 * Then retorna un token CSS:
 *   - NaN → var(--text-muted) (sin nota / pendiente).
 *   - < 6 → var(--xahni-red) (reprobando).
 *   - ≥ 9 → var(--xahni-green) (excelente).
 *   - else → var(--xahni-amber) (regular/aprobado bajo).
 * Edge:
 *   - Helper LEGACY (estilo inline). Código nuevo debe usar `.x-chip --ok/--warn/--danger`
 *     o `var(--state-ok|warn|danger)` del design system.
 *   - El umbral 9 (excelente) NO es 8 (que es el bracket usado por
 *     `_buildProfDashGrupos` y la dist). Asimetría histórica.
 *   - Función PURA — no muta input ni DOM.
 */
function _colorFinal(v) {
  const n = parseFloat(v);
  if (isNaN(n))   return "var(--text-muted)";
  if (n < 6)      return "var(--xahni-red)";
  if (n >= 9)     return "var(--xahni-green)";
  return "var(--xahni-amber)";
}

/**
 * @interaction es-riesgo-bool
 * @scope profesor-helper-academic-legacy
 *
 * Given un alumno enriquecido (shape con `prom` y `asist`).
 * When un caller necesita un check binario rápido "¿este alumno está en
 *   riesgo?" (e.g., contar cuántos pintar en rojo, filtrar lista).
 * Then `prom < 6 || asist < 75`. Devuelve boolean.
 * Edge:
 *   - **Asimetría con `getProfDashData` `riesgo` campo**: este helper
 *     usa < 6 (reprobando estricto) mientras `getProfDashData` define
 *     riesgo como `prom < 7` (incluye regulares para que el profesor
 *     pueda atender la franja 6-7). Decisión consciente: dashboards usan
 *     el umbral suave; este helper legacy se mantiene en el duro.
 *   - Caller debe haber pre-poblado `asist` (DEMO data no siempre lo trae).
 *   - Helper LEGACY: código nuevo usa `_nivelRiesgo` para grado fino o
 *     `data.riesgo` (filtro del data-provider/dashboard).
 */
function _esRiesgo(a) {
  return a.prom < 6 || a.asist < 75;
}

/**
 * @interaction nivel-riesgo-categorico
 * @scope profesor-helper-academic-legacy
 *
 * Given un alumno enriquecido (shape con `prom` y `asist`).
 * When un caller pinta un chip / badge / fila con grado fino de riesgo
 *   (no solo bool sí/no).
 * Then 3-way categórico:
 *   - "alto" si prom < 5 OR asist < 65 (reprobando duro).
 *   - "medio" si prom < 6 OR asist < 75 (reprobando blando / regular bajo).
 *   - "ok" en otro caso.
 * Edge:
 *   - String literal apto para usar como sufijo de clase CSS
 *     (`.x-chip x-chip--${nivel}` con mapping ok→ok, medio→warn, alto→danger
 *     en el caller).
 *   - Mismos umbrales que `_esRiesgo` (6/75) en el bracket "medio";
 *     "alto" es más estricto (5/65).
 *   - Funciona en cascada con `_esRiesgo`: si `_esRiesgo===false` entonces
 *     siempre `_nivelRiesgo==="ok"`.
 *   - Helper LEGACY. Migración futura: campo computado `nivel_riesgo` en
 *     vista Supabase con misma lógica.
 */
function _nivelRiesgo(a) {
  if (a.prom < 5 || a.asist < 65) return "alto";
  if (a.prom < 6 || a.asist < 75) return "medio";
  return "ok";
}

/**
 * @interaction render-avatar-circular-pequeno
 * @scope profesor-helper-avatar-legacy
 *
 * Given iniciales `ini` (string, e.g., "JS"), nombre de color de
 *   `PROF_AV_COLOR` (e.g., "teal", "amber", "blue", etc.), tamaño `sz`
 *   en px opcional (default 30).
 * When un caller legacy del rol profesor (vistas pre-shell) necesita pintar
 *   un avatar circular pequeño con iniciales sobre un fondo coloreado a tono
 *   con la materia/alumno.
 * Then retorna HTML inline-styled `<div>`:
 *   - width/height = sz px, border-radius 50%
 *   - background = color con `22` suffix (alfa 0x22 ≈ 13%) sobre el token
 *   - color tipográfico = el token full
 *   - font-size proporcional a 37% del tamaño (Math.round)
 *   - font-family var(--font-mono), weight 700
 * Edge:
 *   - color desconocido → fallback `var(--xahni-teal)`.
 *   - **TRUNCATE manual**: no escapa `ini` (asume 2-3 chars no-HTML). Si el
 *     caller pasara HTML literal, sería un vector XSS — convención: SOLO se
 *     llama con `user.iniciales` o `id.slice(0,2).toUpperCase()` cementadas.
 *   - **Helper LEGACY** con estilos inline. Código nuevo debe usar
 *     `.x-list-row__avatar` (canónico .x-*) o `getAvatarDisplay()` del helper
 *     canonical para consistencia cross-rol con marcos + animaciones.
 *   - El sufijo hex `22` solo funciona en colores token que resuelven a hex
 *     (`#XXXXXX22`). Para tokens `rgb()` o `hsl()` rompería; los 7 valores
 *     de `PROF_AV_COLOR` apuntan a `var(--xahni-*)` que sí son hex.
 */
function _av(ini, color, sz) {
  const s  = sz || 30;
  const ac = PROF_AV_COLOR[color] || "var(--xahni-teal)";
  return `<div style="width:${s}px;height:${s}px;border-radius:50%;background:${ac}22;color:${ac};display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:${Math.round(s * 0.37)}px;font-weight:700;flex-shrink:0">${ini}</div>`;
}
