// ═══════════════════════════════════════════════════════════
// CORE · Horario de materia
// Helpers compartidos para presentar `materia.horario[]` al usuario.
//
// El JSON guarda un array plano de sesiones semanales:
//   [{ grupoId, dia, inicio, fin, salon }, ...]
//
// La UI necesita dos transformaciones que vivían duplicadas en
// data-provider.js, hub-aprendizaje.js y builders-core.js:
//   (a) FILTRAR por los grupos del usuario (el estudiante solo debe
//       ver el horario de su grupo; el profesor ve todos los suyos).
//   (b) AGRUPAR por día para no repetir "Lunes" cuando una materia
//       se imparte el mismo día en distinto horario por grupo.
//
// formatHorario(horario, userGrupos?)   → estructura agrupada por día
// formatHorarioText(horario, userGrupos?) → texto compacto para chips/tooltip
// ═══════════════════════════════════════════════════════════

const _DIA_ABBR = {
    lunes: "Lun", martes: "Mar", miercoles: "Mié", "miércoles": "Mié",
    jueves: "Jue", viernes: "Vie", sabado: "Sáb", "sábado": "Sáb", domingo: "Dom",
};

const _DIA_ORDEN = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

/**
 * @interaction dia-key
 * @scope core-helper-horario-internal
 *
 * Given un nombre de día en español (puede tener acentos, case mixto).
 * When formatHorario lo invoca para clave del Map de agrupación por día.
 * Then aplica normalización Unicode: lowercase + NFD decomposition + strip
 *   de combining marks (̀-ͯ). Resultado: "miércoles" → "miercoles",
 *   "Sábado" → "sabado".
 * Edge:
 *   - d null/undefined → "" (defensa).
 *   - Escape Unicode explícito ̀-ͯ para evitar dependencia del
 *     encoding del archivo (UTF-8 vs editor/git mergetools).
 *   - Limita normalización a Latin diacritics; otros scripts no aplican
 *     a XAHNI español.
 */
function _diaKey(d) {
    // Quita acentos para normalizar "miércoles" → "miercoles", "sábado" → "sabado".
    // ̀-ͯ = Unicode Combining Diacritical Marks.
    // Escape explícito para no depender del encoding del archivo (UTF-8) frente
    // a editores o git mergetools que puedan re-codificar caracteres literales.
    return (d || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Devuelve [{ dia, label, abbr, rangos: [{inicio, fin, salon, grupoId}] }]
// con los días ordenados lun→dom y los rangos de cada día ordenados por inicio.
// Si `userGrupos` es un array no vacío, se filtran las entradas por `grupoId`.
/**
 * @interaction format-horario
 * @scope core-helper-horario-canonical
 *
 * Given un array horario crudo (`[{grupoId, dia, inicio, fin, salon}]`) y
 *   userGrupos opcional (array de grupoIds para filtrado).
 * When un caller (`_materiaScheduleHTML`, `formatHorarioText`, hub-aprendizaje
 *   est/prof, data-provider) necesita el horario agrupado para render.
 * Then ejecuta secuencia:
 *   1. Filtra horario por userGrupos si aplica (estudiante: su grupo;
 *      profesor: todos los suyos).
 *   2. Agrupa por día normalizado (_diaKey) en un Map. Push rangos con
 *      {inicio, fin, salon, grupoId}.
 *   3. Sort rangos dentro de cada día por inicio asc (localeCompare).
 *   4. Sort días según _DIA_ORDEN (lun → dom).
 *   5. Map a output: {dia (original), label (capitalized), abbr
 *      (_DIA_ABBR), rangos}.
 * Edge:
 *   - horario null/undefined/no array/vacío → [].
 *   - userGrupos vacío o no-array → sin filtrado (todos).
 *   - Filtrado vacía el set → [].
 *   - Día desconocido (fuera de _DIA_ABBR/_DIA_ORDEN) → orden 99 (último) +
 *     abbr fallback al dia original.
 *   - dia null en rangos → label "—".
 *   - Resuelve "día duplicado" cross-grupo (misma materia distinto
 *     horario por grupo) agrupándolos en un solo objeto día.
 */
function formatHorario(horario, userGrupos) {
    if (!Array.isArray(horario) || !horario.length) return [];

    const filtrado = Array.isArray(userGrupos) && userGrupos.length
        ? horario.filter(h => userGrupos.includes(h.grupoId))
        : horario;
    if (!filtrado.length) return [];

    const porDia = new Map();
    filtrado.forEach(h => {
        const key = _diaKey(h.dia);
        if (!porDia.has(key)) porDia.set(key, { dia: h.dia, rangos: [] });
        porDia.get(key).rangos.push({
            inicio:  h.inicio  || "",
            fin:     h.fin     || "",
            salon:   h.salon   || "",
            grupoId: h.grupoId || "",
        });
    });

    porDia.forEach(d => d.rangos.sort((a, b) => (a.inicio || "").localeCompare(b.inicio || "")));

    return [...porDia.entries()]
        .sort((a, b) => {
            const ia = _DIA_ORDEN.indexOf(a[0]);
            const ib = _DIA_ORDEN.indexOf(b[0]);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        })
        .map(([_k, val]) => {
            const lower = (val.dia || "").toLowerCase();
            return {
                dia:    val.dia,
                label:  val.dia ? val.dia.charAt(0).toUpperCase() + val.dia.slice(1) : "—",
                abbr:   _DIA_ABBR[lower] || val.dia || "—",
                rangos: val.rangos,
            };
        });
}

// Texto compacto, multi-rango por día. Ej: "Lun 09:00-11:00 (Lab. 2) / 13:00-15:00 · Mié 09:00-11:00".
/**
 * @interaction format-horario-text
 * @scope core-helper-horario-canonical
 *
 * Given horario crudo + userGrupos opcional (mismo shape que formatHorario).
 * When un caller (chips/tooltip/hero card) necesita el horario como string
 *   compacto inline.
 * Then delega a formatHorario para agrupación + sort, luego mapea cada día
 *   a "{abbr} {rangos join /}" donde cada rango es "{inicio}-{fin}
 *   ({salon})?". Días unidos con " · ".
 * Edge:
 *   - Sin horario válido → "—".
 *   - Sin salon en rango → omite paréntesis.
 *   - Output ejemplo: "Lun 09:00-11:00 (Lab. 2) / 13:00-15:00 · Mié 09:00-11:00".
 */
function formatHorarioText(horario, userGrupos) {
    const grouped = formatHorario(horario, userGrupos);
    if (!grouped.length) return "—";
    return grouped.map(d => {
        const rangos = d.rangos
            .map(r => `${r.inicio}-${r.fin}${r.salon ? " (" + r.salon + ")" : ""}`)
            .join(" / ");
        return `${d.abbr} ${rangos}`;
    }).join(" · ");
}
