/* js/shared/calificaciones-calc.js — fórmula cross-rol de calificación
   final por parcial. Consolida _calFinalParcial (estudiante) y provee
   wrapper multi-grupo para profesor (KPIs hub-grupo C9). Fuente de
   verdad: spec rector §3 punto 1 (3+ veces ⇒ canon).

   Prioridad de resolución: override > recompute desde criterios > stored
   > null. */
(function (root) {
  "use strict";

  // Ratio de un criterio del progreso. Firma idéntica a _calRatio
  // en js/estudiante/calificaciones.js (entry de progreso, no criterio).
  // entry = { criterioId, valorAuto, overrideProf } | null
  /**
   * @interaction cal-ratio
   * @scope shared-calificaciones-helper-internal
   *
   * Given un entry del progreso del alumno en un criterio
   *   (`{criterioId, valorAuto, overrideProf}`) o null.
   * When `calFinalDeEscalaYProgreso` itera criterios y necesita el ratio
   *   efectivo de cada uno (multiplicado por su pct).
   * Then prioridad de resolución:
   *   1. entry null → 0.
   *   2. overrideProf no null → overrideProf (profesor pisó valor).
   *   3. valorAuto no null → valorAuto (cálculo automático).
   *   4. Default → 0.
   * Edge:
   *   - Helper privado del IIFE (no expuesto en window). Consumed solo
   *     por calFinalDeEscalaYProgreso.
   *   - Firma idéntica a estudiante/calificaciones.js (consolidación
   *     pre-Supabase pendiente).
   *   - Ratio en escala 0–1 (NO 0–100).
   */
  function _calRatio(entry, criterio, ctx) {
    // overrideProf siempre prioritario
    if (entry && entry.overrideProf != null) return entry.overrideProf;
    // auto_examenes derivado en tiempo de cálculo (lectura localStorage)
    if (criterio && criterio.vinculo === "auto_examenes") {
      const auto = _autoExamenesValor(criterio, ctx);
      return auto != null ? auto : 0;
    }
    if (!entry) return 0;
    if (entry.valorAuto != null) return entry.valorAuto;
    return 0;
  }

  // Fórmula con escala + progreso ya cargados. Idéntica a
  // _calFinalParcial(esc, prog) en estudiante/calificaciones.js
  // (línea 105): override-first → recompute por criterios
  // (sum(pct × ratio) / 10) → stored calFinal → null.
  /**
   * @interaction cal-final-de-escala-y-progreso
   * @scope shared-calificaciones-canonical
   *
   * Given una escala (con criterios[]) + progreso del alumno (con
   *   criterios[] + opcional calFinalOverride/calFinal).
   * When un caller (vista escala alumno, gestion profesor, wrapper
   *   getCalFinalAlumnoMatParcial) necesita la calificación final del
   *   parcial con escala + progreso ya resueltos.
   * Then prioridad cascada (override-first):
   *   1. prog null → null (no entry).
   *   2. calFinalOverride no null → ese valor (override manual profesor).
   *   3. Sin escala válida (sin criterios) → prog.calFinal stored (legacy
   *      fallback) o null.
   *   4. Recompute: SUM(c.pct × _calRatio(progEntry)) / 10. Escala 0–10.
   * Edge:
   *   - Función PURA: no muta esc ni prog.
   *   - "/ 10" porque pct está en 0–100 y ratio en 0–1; div 10 lleva a
   *     escala 0–10 (asumiendo SUM(pct) = 100).
   *   - Extras (c.extra=true): contribuyen al sum (puede superar 100 si
   *     hay extras, pero el caller que muestra "100 cap" lo maneja).
   *   - Slice rector §3 punto 1: fórmula 3+ veces ⇒ canon. Origen
   *     estudiante/calificaciones.js:_calFinalParcial.
   *   - Deuda post-Supabase: vista Supabase materializada `calificaciones_view`.
   */
  function calFinalDeEscalaYProgreso(esc, prog, ctx) {
    if (!prog && !(esc && (esc.criterios || []).some(c => c.vinculo === "auto_examenes"))) return null;
    if (prog && prog.calFinalOverride != null) return prog.calFinalOverride;
    if (!esc || !Array.isArray(esc.criterios) || !esc.criterios.length) {
      return prog && prog.calFinal != null ? prog.calFinal : null;
    }
    let sum = 0;
    esc.criterios.forEach(c => {
      const e = (prog && prog.criterios || []).find(x => x.criterioId === c.id);
      sum += (c.pct || 0) * _calRatio(e, c, ctx);
    });
    return sum / 10;
  }

  // Wrapper para consumers profesor en contexto multi-grupo (KPIs hub).
  // escalaId canónico del demo: `${matId}_${grupoId}_${parcialNum}`.
  /**
   * @interaction get-cal-final-alumno-mat-parcial
   * @scope shared-calificaciones-canonical-cross-vista
   *
   * Given uid + matId + grupoId + parcialNum.
   * When un caller profesor (KPIs hub-grupo C9 cross-materias, gestion
   *   académica) necesita la calificación final por alumno sin pre-resolver
   *   escala/progreso.
   * Then resolución cascada:
   *   1. Construye escalaId = `${matId}_${grupoId}_${parcialNum}`.
   *   2. Lookup escala en DEMO_ESCALAS.
   *   3. Lookup progreso en `DEMO_PROGRESO_ESCALA[`${uid}_${escalaId}`]`.
   *   4. Delega a `calFinalDeEscalaYProgreso(esc, prog)`.
   * Edge:
   *   - DEMO_PROGRESO_ESCALA o DEMO_ESCALAS no cargados → null.
   *   - escalaId no existe en DEMO_ESCALAS → esc undefined → cae en
   *     branch "sin escala válida" del helper → null o calFinal stored.
   *   - prog no existe → null.
   *   - Key `${uid}_${escalaId}` cementado pattern para todas las
   *     entries de DEMO_PROGRESO_ESCALA.
   */
  function getCalFinalAlumnoMatParcial(uid, matId, grupoId, parcialNum) {
    if (typeof DEMO_PROGRESO_ESCALA === "undefined") return null;
    if (typeof DEMO_ESCALAS === "undefined") return null;
    const escalaId = `${matId}_${grupoId}_${parcialNum}`;
    const esc = (DEMO_ESCALAS || []).find(e => e.id === escalaId);
    const prog = DEMO_PROGRESO_ESCALA[`${uid}_${escalaId}`] || null;
    return calFinalDeEscalaYProgreso(esc, prog, { uid: uid, matId: matId, parcial: parcialNum });
  }

  root.getCalFinalAlumnoMatParcial = getCalFinalAlumnoMatParcial;
  root.calFinalDeEscalaYProgreso = calFinalDeEscalaYProgreso;

  // ── Matriz captura (Phase 3) ──────────────────────────────────────────────

  /**
   * Lookup auto-derived value para un criterio con vinculo="auto_examenes".
   * Lee la key persistida por examenes-data.aplicarARubroParcial al cierre
   * de cada examen. Retorna fracción 0–1 o null si no hay datos.
   *
   * Key shape: xahni:examenes:notaRubro:{uid}:{matId}:P{parcial}:{rubroId}
   * Value:     { promedio (escala 0–10), examenesCount, actualizadoEn }
   */
  function _autoExamenesValor(criterio, ctx) {
    if (!ctx || !ctx.uid || !ctx.matId || !ctx.parcial) return null;
    try {
      const key = "xahni:examenes:notaRubro:" + ctx.uid + ":" + ctx.matId
                + ":P" + ctx.parcial + ":" + criterio.id;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (entry == null || typeof entry.promedio !== "number") return null;
      // promedio guardado en escala 0–10; helpers usan fracción 0–1
      return entry.promedio / 10;
    } catch (e) { return null; }
  }

  /**
   * Lookup auto-derived value para vinculo="auto_tareas".
   * Calcula promedio (0–1) de calificaciones de tareas entregadas por el
   * alumno en la materia del ctx. DEMO_TAREAS no tiene campo `parcial`
   * explícito; deuda explícita: filtrar por fecha de entrega vs rangos
   * del parcial cuando el shape lo soporte. Por ahora promediamos todas
   * las tareas de la materia (aprox válida para el demo).
   */
  function _autoTareasValor(criterio, ctx) {
    if (!ctx || !ctx.uid || !ctx.matId) return null;
    if (typeof DEMO_TAREAS === "undefined" || !Array.isArray(DEMO_TAREAS)) return null;
    const uid = ctx.uid;
    const calificaciones = [];
    DEMO_TAREAS.forEach(t => {
      if (t.materiaId !== ctx.matId) return;
      const entrega = (t.entregas || []).find(e => e.uid === uid);
      if (!entrega) return;
      if (typeof entrega.calificacion !== "number") return;
      calificaciones.push(entrega.calificacion);
    });
    if (calificaciones.length === 0) return null;
    const avg = calificaciones.reduce((a, b) => a + b, 0) / calificaciones.length;
    // promedio en 0–10 → fracción 0–1
    return Math.max(0, Math.min(1, avg / 10));
  }

  /**
   * @interaction obtener-valor-criterio
   * @scope shared-calificaciones
   *
   * Given: criterio (de escalas.json) + objeto progreso del alumno en ese criterio
   *        (de progreso_escala.json criterios array entry) + ctx opcional
   *        {uid, matId, parcial} para resolver vinculo="auto_examenes" o "auto_tareas".
   * When:  se invoca para resolver el valor efectivo (fracción 0–1)
   * Then:  prioridad de resolución:
   *        1. overrideProf no null → ese valor (profesor pisó).
   *        2. vinculo="auto_examenes" + ctx → promedio examenes del parcial (0–1).
   *        3. vinculo="auto_tareas" + ctx → promedio tareas calificadas de la materia (0–1).
   *        4. valorAuto no null → ese valor (legacy pre-cached).
   *        5. 0.
   * Edge:
   *   - progreso null/undefined → 0 (a menos que vinculo auto + ctx → lookup directo).
   *   - auto_examenes sin datos (alumno no entregó examen) → 0.
   *   - auto_tareas sin entregas calificadas → 0.
   */
  function obtenerValorCriterio(criterio, progresoCriterio, ctx) {
    // overrideProf siempre gana, incluso sobre auto_examenes/auto_tareas
    if (progresoCriterio && progresoCriterio.overrideProf != null) {
      return Number(progresoCriterio.overrideProf);
    }
    // Vínculo auto_examenes derivado en tiempo de cálculo
    if (criterio && criterio.vinculo === "auto_examenes") {
      const auto = _autoExamenesValor(criterio, ctx);
      return auto != null ? auto : 0;
    }
    // Bug 2026-06-09: vinculo auto_tareas tampoco se derivaba en tiempo de
    // cálculo; el valor solo se reflejaba en escala si alguien pre-cacheaba
    // valorAuto en el progreso del alumno (que nunca pasaba). Ahora computa
    // promedio de tareas calificadas de la materia.
    if (criterio && criterio.vinculo === "auto_tareas") {
      const auto = _autoTareasValor(criterio, ctx);
      return auto != null ? auto : 0;
    }
    if (!progresoCriterio) return 0;
    if (progresoCriterio.valorAuto != null) return Number(progresoCriterio.valorAuto);
    return 0;
  }

  /**
   * @interaction calcular-parcial
   * @scope shared-calificaciones
   *
   * Given: criterios del parcial (array de la escala) + progreso de un alumno
   *        (objeto de progreso_escala, con .criterios[] y optional .calFinalOverride)
   * When:  se invoca calcularParcial(criterios, progresoAlumno)
   * Then:  retorna { bruto, final, breakdown }:
   *          bruto    = SUM(valorFrac × pct)   (puede superar 100 por extras)
   *          final    = MIN(100, bruto) / 10    (escala 0–10)
   *          breakdown= [{ criterioId, subtotal }]
   * Edge:
   *   - criterios vacío → { bruto: 0, final: 0, breakdown: [] }
   *   - calFinalOverride presente → final = calFinalOverride, override: true
   *   - progresoAlumno null → todos los criterios = 0
   */
  function calcularParcial(criterios, progresoAlumno, ctx) {
    if (!Array.isArray(criterios) || criterios.length === 0) {
      return { bruto: 0, final: 0, breakdown: [] };
    }
    const progMap = {};
    ((progresoAlumno && progresoAlumno.criterios) || []).forEach(function(p) {
      progMap[p.criterioId] = p;
    });

    let bruto = 0;
    const breakdown = criterios.map(function(c) {
      const valor    = obtenerValorCriterio(c, progMap[c.id], ctx);
      const subtotal = valor * (c.pct || 0);
      bruto += subtotal;
      return { criterioId: c.id, subtotal: subtotal };
    });

    // Override del parcial completo (legacy calFinalOverride)
    if (progresoAlumno && progresoAlumno.calFinalOverride != null) {
      return { bruto: bruto, final: Number(progresoAlumno.calFinalOverride), breakdown: breakdown, override: true };
    }
    var final = Math.min(100, bruto) / 10;
    return { bruto: bruto, final: final, breakdown: breakdown };
  }

  root.obtenerValorCriterio = obtenerValorCriterio;
  root.calcularParcial      = calcularParcial;

  // ── Agregada cross-parcial (Slice pre-c10 6a · 2026-05-26) ────────────────

  /**
   * @interaction cal-final-agregada-alumno
   * @scope shared-calificaciones
   *
   * Given: objeto alumno con `.progresoEscala` (map de parciales → progreso),
   *        donde cada progreso tiene `calFinal` y/o `calFinalOverride`.
   * When:  se invoca calFinalAgregadaAlumno(alumno) para mostrar la
   *        calificación final agregada (no de un parcial individual) en
   *        Gestión Académica del profesor o vista equivalente.
   * Then:  retorna la MEDIA aritmética de los calFinal de los parciales
   *        calificados del alumno (override-first cuando existe). Solo
   *        promedia parciales con calFinal numérico — los aún sin calcular
   *        no contribuyen ni cuentan en el denominador.
   * Edge:
   *   - alumno.progresoEscala undefined/null → null
   *   - sin parciales calificados → null
   *
   * Origen: extraído de js/profesor/gestion.js:_gestionCalFinal para
   * preparar reuso cross-rol post-migración. Sin auditoría cross-rol
   * todavía (decisión scope mínimo 2026-05-26).
   */
  function calFinalAgregadaAlumno(a) {
    const obj = (a && a.progresoEscala) || {};
    const vals = Object.values(obj)
        .map(function (p) { return p.calFinalOverride != null ? p.calFinalOverride : p.calFinal; })
        .filter(function (v) { return typeof v === "number"; });
    if (!vals.length) return null;
    return vals.reduce(function (s, v) { return s + v; }, 0) / vals.length;
  }

  root.calFinalAgregadaAlumno = calFinalAgregadaAlumno;
})(window);
