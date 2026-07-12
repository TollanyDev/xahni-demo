// ═══════════════════════════════════════════════════════════
// DATA PROVIDER · Estudiante
// Cruza DEMO_* y deriva todo lo que las vistas del estudiante
// necesitan a partir del id de usuario. No lee APP.user adentro;
// los builders pasan el uid explícitamente para que sea testeable.
// ═══════════════════════════════════════════════════════════

// Paleta de materias. `bg` (banner gradient) viene del helper compartido
// _materiaBgGrad(materiaId) en builders-core.js para que alumno y profesor
// vean el MISMO gradiente por materia (homogeneización visual entre roles).
const _MAT_PALETTE = [
    { color:"var(--xahni-cyan)",   hex:"#00d4ff", colorKey:"cyan",   emblema:"🛡️" },
    { color:"var(--xahni-teal)",   hex:"#00c6a7", colorKey:"teal",   emblema:"💻" },
    { color:"var(--xahni-amber)",  hex:"#f5a623", colorKey:"amber",  emblema:"🗄️" },
    { color:"var(--xahni-green)",  hex:"#22c55e", colorKey:"green",  emblema:"🌐" },
    { color:"var(--xahni-purple)", hex:"#8b2be2", colorKey:"purple", emblema:"🏗️" },
    { color:"var(--xahni-blue)",   hex:"#1b4fe4", colorKey:"blue",   emblema:"📘" },
];

/**
 * @interaction data-provider-helpers-internos
 * @scope estudiante-data-provider-helper-internal
 *
 * Given materiaId / profId / runtime check.
 * When cualquier getter público necesita paleta + nombre prof + guard DEMO.
 * Then 3 helpers combined:
 *   - `_materiaPalette(materiaId)`: lookup paleta rotativa (6 colores)
 *     + inyecta `bg` via `_materiaBgGrad` shared (homogeneización cross-rol).
 *     Defensive: idx -1 cae a 0; helper ausente cae a fallback gradient.
 *   - `_profesorNombre(profId)`: lookup en DEMO_USERS, "—" fallback.
 *   - `_hayDatos()`: bool DEMO_USERS array no-vacío. Guard inicial de
 *     todos los getters públicos.
 * Edge:
 *   - **Pattern `Object.assign({}, pal, {bg})`** preserva immutability del
 *     `_MAT_PALETTE` constante.
 *   - **`bg` shared cross-rol**: alumno + profesor ven MISMO gradient por
 *     materiaId (regla rectora homogeneización visual).
 *   - Funciones PURAS.
 *   - Helpers LOCALES.
 */
function _materiaPalette(materiaId) {
    const all = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : []);
    const idx = all.findIndex(m => m.id === materiaId);
    const pal = _MAT_PALETTE[(idx >= 0 ? idx : 0) % _MAT_PALETTE.length];
    // Inyecta el bg compartido por materiaId — _materiaBgGrad vive en builders-core.js.
    return Object.assign({}, pal, {
        bg: (typeof _materiaBgGrad === "function") ? _materiaBgGrad(materiaId) : `linear-gradient(135deg, ${pal.hex}, var(--xahni-blue))`,
    });
}

function _profesorNombre(profId) {
    const all = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []);
    return all.find(x => x.id === profId)?.nombre || "—";
}

function _hayDatos() {
    return typeof DEMO_USERS !== "undefined"
        && Array.isArray(DEMO_USERS)
        && DEMO_USERS.length > 0;
}

// ── Materias del alumno con métricas derivadas ──────────────
/**
 * @interaction get-materias-alumno
 * @scope estudiante-data-provider-public
 *
 * Given uid del alumno.
 * When `buildMaterias`, `_refreshMateriasData`, `getMateriasAlumno`
 *   cross-archivo (hub, dashboard, calificaciones).
 * Then itera `user.materias[]` y enriquece cada una con:
 *   - paleta + bg gradient + emblema + colorIdx.
 *   - prof nombre.
 *   - promedio (avg de calificaciones de entregas).
 *   - pct entregas (`entregas/total × 100`).
 *   - tareasMat + entregasMat (filtradas).
 *   - parciales heurísticos: split entregas calificadas en mitades
 *     (P1/P2/P3 null).
 *   - prestigioNivel (round prom/2 capped [1..5]).
 *   - logrosObtenidos (count cal ≥ 9).
 *   - horario FILTRADO por grupos del alumno.
 *   - periodo + periodoInfo via `resolverPeriodoMateria`.
 *   - alumnos count (sum miembros de grupos asignados).
 *   - activo bool (totalTareas > 0).
 * Edge:
 *   - **Twin con profesor `getProfMateriasData`** — misma estructura,
 *     filtros distintos por rol.
 *   - **Asimetría sin grupos[] en shape retornado** — alumno no expone
 *     (documentado en `_calMatGrupo` calificaciones cómo workaround).
 *   - **Heurística parciales P1/P2** simplista DEMO (split por fecha).
 *     P3 siempre null. Deuda post-Supabase: usar DEMO_PROGRESO_ESCALA.
 *   - **Horario filter cross-grupo** crítico: alumno solo ve sesiones
 *     de SUS grupos (no del profesor en otros grupos misma materia).
 *   - `creditos: 6` hardcoded — DEMO simplification. Deuda.
 *   - `filter(Boolean)` final descarta materias no encontradas en DEMO_MATERIAS.
 *   - Función PURA (no muta DEMO_*).
 */
function getMateriasAlumno(uid) {
    if (!uid || !_hayDatos()) return [];
    const user = DEMO_USERS.find(u => u.id === uid);
    if (!user || !Array.isArray(user.materias)) return [];

    const grupos    = user.grupos || [];
    const todas     = DEMO_MATERIAS || [];
    const tareasAll = DEMO_TAREAS   || [];
    const progreso  = (DEMO_PROGRESO_ESTUDIANTES || {})[uid] || {};
    const entregas  = progreso.tareasEntregadas || [];

    return user.materias.map(matId => {
        const m = todas.find(x => x.id === matId);
        if (!m) return null;
        const pal = _materiaPalette(matId);

        const tareasMat   = tareasAll.filter(t =>
            t.materiaId === matId && grupos.includes(t.grupoId)
        );
        const entregasMat = entregas.filter(e =>
            tareasMat.some(t => t.id === e.tareaId)
        );

        const calificaciones = entregasMat
            .map(e => e.calificacion)
            .filter(c => typeof c === "number");
        const promedio = calificaciones.length
            ? calificaciones.reduce((a, b) => a + b, 0) / calificaciones.length
            : 0;

        const totalTareas = tareasMat.length;
        const pct = totalTareas
            ? Math.round((entregasMat.length / totalTareas) * 100)
            : 0;

        const grupoCount = (m.grupos || []).reduce((s, gid) => {
            const g = (DEMO_GRUPOS || []).find(x => x.id === gid);
            return s + (g?.miembros?.length || 0);
        }, 0);

        // Parciales heurísticos: divide entregas calificadas en mitades por fecha
        const ordenadas = [...entregasMat]
            .filter(e => typeof e.calificacion === "number")
            .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
        const half     = Math.ceil(ordenadas.length / 2);
        const p1Vals   = ordenadas.slice(0, half).map(e => e.calificacion);
        const p2Vals   = ordenadas.slice(half).map(e => e.calificacion);
        const promArr  = arr => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : null;

        return {
            id:        m.id,
            nombre:    m.nombre,
            clave:     m.clave,
            clasificacionId: m.clasificacionId,
            prof:      _profesorNombre(m.profesorId),
            profesorId: m.profesorId,
            promedio,
            pct,
            creditos:  6,
            // Filtramos el horario a los grupos del alumno para que las cards y el
            // hub no muestren sesiones de grupos ajenos donde se imparte la misma
            // materia. Helper compartido: js/core/horario.js.
            horario:    Array.isArray(m.horario)
                ? m.horario.filter(h => grupos.includes(h.grupoId))
                : (m.horario || []),
            horarioStr: typeof formatHorarioText === "function"
                ? formatHorarioText(m.horario, grupos)
                : "—",
            alumnos:   grupoCount,
            emblema:   pal.emblema,
            bgGrad:    pal.bg,
            materiaColor: pal.hex,
            color:     pal.color,
            colorDim:  pal.color,
            colorKey:  pal.colorKey,
            colorIdx:  _MAT_PALETTE.indexOf(pal),
            parciales: [ promArr(p1Vals), promArr(p2Vals), null ],
            prestigioNivel:  Math.min(5, Math.max(1, Math.round(promedio / 2))),
            logrosObtenidos: calificaciones.filter(c => c >= 9).length,
            logrosTotal:     Math.max(totalTareas, 1),
            activo:          totalTareas > 0,
            tareasMat,
            entregasMat,
            periodo:     resolverPeriodoMateria(uid, m.id),
            periodoInfo: getPeriodoInfo(resolverPeriodoMateria(uid, m.id)),
        };
    }).filter(Boolean);
}

// ── Tareas del alumno con estado y calificación ────────────
/**
 * @interaction get-tareas-alumno
 * @scope estudiante-data-provider-public
 *
 * Given uid del alumno.
 * When tab Tareas + hub-inicio (count pendientes) + calendario builders.
 * Then itera DEMO_TAREAS filtradas por user.materias ∩ user.grupos:
 *   - paleta materia + matNombre.
 *   - entrega del alumno (lookup en t.entregas por uid).
 *   - **`effectiveDueDate(t, uid)` shared**: respeta prórroga aprobada
 *     del alumno (slice prórrogas-polish pre-c10 #4).
 *   - diasRestantes desde fecha efectiva.
 *   - estado: "entregada" | "vencida" | "pendiente".
 *   - cal: calificación o null.
 *   - pct visual (100/0/dias-based).
 * Edge:
 *   - **Twin asimetría con profesor `getProfDashData.tareas`**: alumno
 *     respeta prórroga personal; profesor ve fecha original.
 *   - **`pct` heurístico** para mostrar progreso ANTES de entregar:
 *     `100 - dias × 6` clamped [10, 95]. Decisión visual.
 *   - **`fechaIso` campo original** preservado (sin prórroga) — useful
 *     para mostrar "original" vs "efectiva" en UI futuro.
 *   - **`fechaEntregaUser`**: fecha de la entrega del alumno (no de
 *     vencimiento), o null si no entregó.
 *   - Función PURA.
 */
function getTareasAlumno(uid) {
    if (!uid || !_hayDatos()) return [];
    const user = DEMO_USERS.find(u => u.id === uid);
    if (!user) return [];
    const grupos   = user.grupos || [];
    const materias = user.materias || [];
    const todas    = DEMO_TAREAS || [];
    const ahora    = new Date();

    return todas
        .filter(t => materias.includes(t.materiaId) && grupos.includes(t.grupoId))
        .map(t => {
            const pal       = _materiaPalette(t.materiaId);
            const matNombre = (DEMO_MATERIAS || []).find(m => m.id === t.materiaId)?.nombre || t.materiaId;
            const entrega   = (t.entregas || []).find(e => e.uid === uid);
            // Slice prórrogas-polish (pre-c10 #4): fecha de entrega efectiva
            // respeta prórroga aprobada del alumno. diasRestantes y estado
            // se derivan de esta fecha, cubriendo cascada a builders-core
            // (que consume t.diasRestantes) y otros consumidores de TAREAS_DATA.
            const fechaEfectStr = (typeof effectiveDueDate === "function")
                ? effectiveDueDate(t, uid)
                : t.fechaEntrega;
            const fechaEnt  = new Date(fechaEfectStr);
            const dias      = Math.ceil((fechaEnt - ahora) / 86400000);
            const estado    = entrega ? "entregada"
                            : fechaEnt < ahora ? "vencida"
                            : "pendiente";
            const cal       = entrega?.calificacion ?? null;
            const pct       = estado === "entregada" ? 100
                            : estado === "vencida"   ? 0
                            : Math.max(10, Math.min(95, 100 - dias * 6));
            return {
                id:            t.id,
                titulo:        t.titulo,
                materia:       matNombre,
                materiaId:     t.materiaId,
                tipo:          "Tarea",
                estado,
                fecha:         fechaEnt.toLocaleDateString("es-MX", { day:"2-digit", month:"short", year:"numeric" }),
                fechaIso:      t.fechaEntrega,
                fechaEntregaDate: fechaEnt,
                fechaEntregaUser: entrega ? new Date(entrega.fecha) : null,
                diasRestantes: estado === "entregada" ? 0 : dias,
                pct,
                calificacion:  cal,
                desc:          "Entrega de " + t.titulo + " — " + matNombre + ".",
                color:         pal.color,
                colorHex:      pal.hex,
                colorKey:      pal.colorKey,
            };
        });
}

// ── Recursos del alumno (filtrados por materias) ────────────
/**
 * @interaction get-recursos-alumno
 * @scope estudiante-data-provider-public
 *
 * Given uid del alumno.
 * When tab Recursos del hub.
 * Then filter DEMO_RECURSOS por user.materias, enriquece con:
 *   - paleta materia + nombre.
 *   - prof nombre.
 *   - **size determinista derivado del id** (`(charCodeAt last % 9 + 1) × 0.7`).
 *     Estable cross-renders pero fake.
 *   - fechaObj.
 *   - flag `nuevo` si subido < 1 semana atrás.
 * Edge:
 *   - **`size` heurística**: DEMO_RECURSOS no tiene size real. Pattern
 *     "determinista pero fake" — mismo recurso siempre tiene el mismo size.
 *     Deuda post-Supabase: tamaño real de Storage.
 *   - **Ventana "nuevo" 7 días**.
 *   - **Twin con profesor `getProfMateriasData` recursos**: alumno
 *     filtra por sus materias; profesor por las que imparte.
 *   - Función PURA respecto a inputs.
 */
function getRecursosAlumno(uid) {
    if (!uid || !_hayDatos()) return [];
    const user = DEMO_USERS.find(u => u.id === uid);
    if (!user) return [];
    const materias = user.materias || [];
    const all      = DEMO_RECURSOS || [];
    const ahora    = new Date();
    const semana   = 7 * 86400000;

    // Bug M3 2026-06-09: cargar set de recursos vistos del uid para
    // distinguir entre nuevo (no visto y reciente) vs visto/descargado.
    // El storage key está namespaced por uid (sweep 2026-06-08) pero el
    // valor puede ser id puro o composite legacy "uid::id" — soportar ambos.
    const vistosSet = new Set();
    try {
        const raw = localStorage.getItem(`xahni_recursos_vistos_${uid}`);
        if (raw) {
            const arr = JSON.parse(raw) || [];
            arr.forEach(item => {
                const parts = String(item).split("::");
                vistosSet.add(parts.length > 1 ? parts[1] : parts[0]);
            });
        }
    } catch (e) { /* defensive */ }

    return all
        .filter(r => materias.includes(r.materiaId))
        .map(r => {
            const pal       = _materiaPalette(r.materiaId);
            const matNombre = (DEMO_MATERIAS || []).find(m => m.id === r.materiaId)?.nombre || r.materiaId;
            const fechaObj  = new Date(r.fechaSubida);
            // Tamaño determinista derivado del id para mantener estabilidad entre cargas
            const last      = r.id.charCodeAt(r.id.length - 1);
            const sizeMb    = ((last % 9) + 1) * 0.7;
            const esReciente = (ahora - fechaObj) < semana;
            const estaVisto  = vistosSet.has(String(r.id));
            // profUid (canonical Firestore) con fallback a profesorId (seed legacy).
            const profId = r.profUid || r.profesorId;
            return {
                id:        r.id,
                nombre:    r.titulo,
                tipo:      r.tipo,
                materia:   matNombre,
                materiaId: r.materiaId,
                prof:      _profesorNombre(profId),
                size:      sizeMb.toFixed(1) + " MB",
                fecha:     fechaObj,
                nuevo:     esReciente && !estaVisto,
                visto:     estaVisto,
                color:     pal.colorKey,
            };
        });
}

// ── Racha del alumno (lee progreso.json, no APP.user.racha) ──
/**
 * @interaction get-racha-alumno
 * @scope estudiante-data-provider-public-racha
 *
 * Given uid del alumno.
 * When `_buildEstKPIs` (dashboard legacy) o builders del perfil
 *   muestran "racha actual" + "racha máxima".
 * Then lookup en DEMO_PROGRESO_ESTUDIANTES[uid] → `{actual, max}` con
 *   fallbacks 0.
 * Edge:
 *   - **Fuente: progreso.json (NO `APP.user.racha`)** — DEMO_PROGRESO_ESTUDIANTES
 *     es la fuente canonical de tracking gamer. Comentario inline lo
 *     explicita.
 *   - Sin progreso entry → `{actual: 0, max: 0}` defensive.
 *   - Función PURA.
 *   - Deuda post-Supabase: tabla `usuario_progreso.racha_*`.
 */
function getRachaAlumno(uid) {
    if (!uid || !_hayDatos()) return { actual: 0, max: 0 };
    // Bug 2026-06-09: antes leíamos `progreso.rachaActual` y `progreso.rachaMax`
    // como valores estáticos del JSON. Debería contar días consecutivos REALES
    // de actividad. Unimos fechas de jugadas (GamerState + progreso) + tareas
    // entregadas + competencias para detectar días con actividad, y calculamos
    // racha actual (secuencia desde hoy/ayer hacia atrás) + racha máxima
    // histórica.

    // Set de días únicos con actividad (YYYY-MM-DD UTC).
    const diasSet = new Set();
    const pushDia = (f) => {
        const d = new Date(f);
        if (isNaN(d.getTime())) return;
        diasSet.add(d.toISOString().slice(0, 10));
    };

    const gs = (typeof GamerState !== "undefined" && GamerState.get) ? GamerState.get(uid) : null;
    (gs?.jugadas || []).forEach(j => pushDia(j.fecha));

    const progreso = (DEMO_PROGRESO_ESTUDIANTES || {})[uid] || {};
    (progreso.tareasEntregadas || []).forEach(t => pushDia(t.fecha));
    (progreso.juegosJugados || []).forEach(j => pushDia(j.fecha));
    (progreso.competenciasParticipadas || []).forEach(c => pushDia(c.fecha));

    if (diasSet.size === 0) {
        // Fallback al JSON si no hay actividad detectable (compat seeds viejas).
        return {
            actual: progreso.rachaActual || 0,
            max:    progreso.rachaMax    || 0,
        };
    }

    const dias = Array.from(diasSet).sort();

    // Racha actual: secuencia consecutiva desde hoy/ayer hacia atrás.
    const hoy = new Date().toISOString().slice(0, 10);
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let actual = 0;
    let cursor = diasSet.has(hoy) ? hoy : (diasSet.has(ayer) ? ayer : null);
    if (cursor) {
        actual = 1;
        const cur = new Date(cursor);
        // Iterar hacia atrás día por día mientras siga habiendo actividad
        while (true) {
            cur.setUTCDate(cur.getUTCDate() - 1);
            const prevStr = cur.toISOString().slice(0, 10);
            if (diasSet.has(prevStr)) actual++;
            else break;
        }
    }

    // Racha máxima: iterar todos los días en orden cronológico y contar streaks.
    let max = 0;
    let current = 0;
    let prevDateStr = null;
    dias.forEach(d => {
        if (prevDateStr === null) {
            current = 1;
        } else {
            const prev = new Date(prevDateStr);
            prev.setUTCDate(prev.getUTCDate() + 1);
            const expected = prev.toISOString().slice(0, 10);
            current = (d === expected) ? current + 1 : 1;
        }
        if (current > max) max = current;
        prevDateStr = d;
    });

    return { actual, max };
}

// ── Historial de archivos del alumno ─────────────────────────
/**
 * @interaction get-historial-alumno
 * @scope estudiante-data-provider-public-historial
 *
 * Given uid del alumno.
 * When tab Historial del perfil.
 * Then itera `progreso.tareasEntregadas[]`:
 *   - Skip entregas sin `archivos[]` (sin archivos reales).
 *   - Por archivo: counter incremental + matNombre + paleta + entry
 *     `{nombre, materia, tipo, size, fecha, tarea}`.
 * Edge:
 *   - **Filter skip sin archivos** — convención DEMO: entregas pueden no
 *     tener archivos asociados (e.g., tarea de "participación").
 *   - **counter incremental** como id único (no UUID); aceptable para list
 *     keys sin re-sort.
 *   - `archivos[]` shape canonical con `{nombre, tipo, size}` strings.
 *   - Función PURA respecto a inputs.
 */
function getHistorialAlumno(uid) {
    if (!uid || !_hayDatos()) return [];
    const progreso = (DEMO_PROGRESO_ESTUDIANTES || {})[uid] || {};
    const entregas = progreso.tareasEntregadas || [];
    const out      = [];
    let counter    = 0;
    entregas.forEach(e => {
        const t   = (DEMO_TAREAS || []).find(x => x.id === e.tareaId) || {};
        const pal = _materiaPalette(t.materiaId);
        const matNombre = (DEMO_MATERIAS || []).find(m => m.id === t.materiaId)?.nombre || t.materiaId;
        const archivos  = e.archivos || [];
        if (!archivos.length) return; // sin archivos reales, no se muestra en historial
        archivos.forEach(arch => {
            counter++;
            out.push({
                id:      counter,
                nombre:  arch.nombre,
                materia: matNombre,
                tipo:    arch.tipo,
                size:    arch.size,
                fecha:   new Date(e.fecha),
                tarea:   t.titulo || e.tareaId,
                color:   pal.colorKey,
            });
        });
    });
    return out;
}

// ── Competencias del alumno ─────────────────────────────────
/**
 * @interaction get-competencias-alumno
 * @scope estudiante-data-provider-public-competencias
 *
 * Given uid del alumno.
 * When `_refreshCompetenciasData` (competencias.js) consumed.
 * Then:
 *   1. Filter competencias inscritas (intersección con user.grupos).
 *   2. Construye `historial[]` con lugar + resultado label + puntos
 *      + color medal.
 *   3. Retorna shape compuesto: `{todas, activas, proximas, finalizadas,
 *      historial}` con cada array filtrado por estado.
 * Edge:
 *   - **Empty shape consistente** cuando guard falla — caller sin null check.
 *   - **Lugar 1/2/3 emojis + colores hardcoded** (gold/silver/bronze + green
 *     default).
 *   - **`historial` incluye ACTIVA + FINALIZADA**: refleja "participaciones
 *     conocidas". Asimetría con `finalizadas` (solo finalizadas).
 *   - **`grupoUsr = grupos[0]`** — solo primer grupo; alumno multi-grupo
 *     puede ver resultados parciales. Deuda menor.
 *   - Función PURA.
 */
function getCompetenciasAlumno(uid) {
    const empty = { todas: [], activas: [], proximas: [], finalizadas: [], historial: [] };
    if (!uid || !_hayDatos()) return empty;
    const user = DEMO_USERS.find(u => u.id === uid);
    if (!user) return empty;
    const grupos = user.grupos || [];
    const all    = DEMO_COMPETENCIAS || [];

    const filtered = all.filter(c => (c.gruposInscritos || []).some(g => grupos.includes(g)));

    // Historial: competencias finalizadas con resultado del grupo del alumno
    const historial = filtered
        .filter(c => c.estado === "finalizada" || c.estado === "activa")
        .map(c => {
            const grupoUsr = grupos[0];
            const res      = c.resultados?.[grupoUsr];
            const lugar    = res?.lugar;
            const matNom   = (DEMO_MATERIAS || []).find(m => m.id === c.materiaId)?.nombre || c.materiaId;
            return {
                id:        c.id,
                nombre:    c.nombre,
                materia:   matNom,
                estado:    c.estado === "finalizada" ? "Completada" : "Activa",
                lugar,
                resultado: lugar === 1 ? "1er Lugar 🥇"
                         : lugar === 2 ? "2do Lugar 🥈"
                         : lugar === 3 ? "3er Lugar 🥉"
                         : lugar       ? `${lugar}° Lugar`
                         : c.estado === "activa" ? "En progreso" : "Participaste",
                puntos:    res ? `+${res.puntaje} pts` : "—",
                color:     lugar === 1 ? "#f5a623"
                         : lugar === 2 ? "#c0c0c0"
                         : lugar === 3 ? "#cd7f32"
                         : "#22c55e",
            };
        });

    return {
        todas:       filtered,
        activas:     filtered.filter(c => c.estado === "activa"),
        proximas:    filtered.filter(c => c.estado === "proxima"),
        finalizadas: filtered.filter(c => c.estado === "finalizada"),
        historial,
    };
}

/**
 * @interaction ranking-helpers-internos
 * @scope estudiante-data-provider-helper-ranking
 *
 * Given user / global state.
 * When `getRankingGrupo`/`getRankingCarrera` necesitan helpers.
 * Then 3 helpers combined:
 *   - `_carreraDelUser(user)`: extrae prefijo del primer grupo
 *     (ej. "ISC-A" → "ISC"). Decisión histórica: la carrera está
 *     codificada en el prefijo del grupo (no campo explícito).
 *   - `_puntajeMaxEstudiantes()`: max puntos cross-estudiantes, clamped
 *     a 1 (evita div-by-zero).
 *   - `_rankRow(u, idx, uid, max)`: construye row uniforme con pos, id,
 *     nombre, iniciales, pts, bar pct, grupo, flag esYo.
 * Edge:
 *   - **Prefijo grupo "ISC-A" pattern cementado**: convención del seed
 *     DEMO. Deuda menor: campo `carrera` explícito.
 *   - **`max` clamped a 1**: si todos los estudiantes tienen 0 puntos,
 *     todas las bars muestran 0%.
 *   - Funciones PURAS.
 *   - Helpers LOCALES.
 */
function _carreraDelUser(user) {
    const g = (user?.grupos || [])[0] || "";
    return g.split("-")[0];
}

function _puntajeMaxEstudiantes() {
    const list = (DEMO_USERS || []).filter(u => u.tipo === "estudiante");
    return Math.max(1, ...list.map(u => u.puntos || 0));
}

function _rankRow(u, idx, uid, max) {
    return {
        pos:       idx + 1,
        id:        u.id,
        nombre:    u.nombre,
        iniciales: u.iniciales,
        pts:       u.puntos || 0,
        bar:       Math.round(((u.puntos || 0) / max) * 100),
        grupo:     (u.grupos || [])[0] || "",
        esYo:      u.id === uid,
    };
}

/**
 * @interaction get-rankings-publicos
 * @scope estudiante-data-provider-public-ranking
 *
 * Given uid del alumno.
 * When `_refreshCompetenciasData` (competencias.js) consume ambos rankings.
 * Then 2 getters combined:
 *   - `getRankingGrupo(uid)`: filter estudiantes en `user.grupos[0]`,
 *     sort desc por puntos, map a row uniforme.
 *   - `getRankingCarrera(uid)`: filter estudiantes con misma `_carreraDelUser`,
 *     sort desc, map a row.
 * Edge:
 *   - **Solo primer grupo `user.grupos[0]`** (alumno multi-grupo ve solo
 *     su grupo principal). Deuda menor.
 *   - **Sort desc estable** (V8 TimSort) — empates mantienen orden DEMO_USERS.
 *   - Sin grupo / carrera → `[]`.
 *   - Funciones PURAS.
 *   - Deuda post-Supabase: vista materializada `ranking_grupo_view` con
 *     PARTITION BY grupo ORDER BY puntos DESC.
 */
function getRankingGrupo(uid) {
    if (!uid || !_hayDatos()) return [];
    const user = DEMO_USERS.find(u => u.id === uid);
    if (!user) return [];
    const grupo = (user.grupos || [])[0];
    if (!grupo) return [];
    const max = _puntajeMaxEstudiantes();
    return DEMO_USERS
        .filter(u => u.tipo === "estudiante" && (u.grupos || []).includes(grupo))
        .sort((a, b) => (b.puntos || 0) - (a.puntos || 0))
        .map((u, i) => _rankRow(u, i, uid, max));
}

function getRankingCarrera(uid) {
    if (!uid || !_hayDatos()) return [];
    const user = DEMO_USERS.find(u => u.id === uid);
    if (!user) return [];
    const carr = _carreraDelUser(user);
    const max  = _puntajeMaxEstudiantes();
    return DEMO_USERS
        .filter(u => u.tipo === "estudiante" && _carreraDelUser(u) === carr)
        .sort((a, b) => (b.puntos || 0) - (a.puntos || 0))
        .map((u, i) => _rankRow(u, i, uid, max));
}

// ── Datos del grupo principal del alumno ────────────────────
/**
 * @interaction get-grupo-alumno
 * @scope estudiante-data-provider-public-grupo
 *
 * Given uid del alumno.
 * When builders necesitan el objeto Grupo del primer grupo del alumno
 *   (hub-grupo, hub-calendario `_getGrupoActivo`).
 * Then lookup `user.grupos[0]` + DEMO_GRUPOS find → grupo o null.
 * Edge:
 *   - **Solo primer grupo** — consistente con pattern del rol.
 *   - Sin user / grupos vacío → null.
 *   - Función PURA.
 *   - **Twin EXACTO de `_getGrupoActivo`** estudiante hub-calendario IIFE
 *     (diferente fuente pero misma intención). Deuda consolidación menor.
 */
function getGrupoAlumno(uid) {
    if (!uid || !_hayDatos()) return null;
    const user = DEMO_USERS.find(u => u.id === uid);
    if (!user) return null;
    const gid  = (user.grupos || [])[0];
    if (!gid) return null;
    const g = (DEMO_GRUPOS || []).find(x => x.id === gid);
    return g || null;
}

// ── Tarjetas de grupo del alumno (una por materia inscrita) ──
/**
 * @interaction get-grupos-alumno
 * @scope estudiante-data-provider-public-grupos-cards
 *
 * Given uid del alumno.
 * When `_refreshGruposData` (grupos.js) consumed para tab Grupos.
 * Then itera user.materias, por cada:
 *   1. Busca grupo del usuario que curse esa materia (o fallback primer grupo).
 *   2. Construye card combinada `(grupo × materia)` con shape rico:
 *      - id compuesto `${grupoId}_${matId}`.
 *      - nombre: `"${grupo.nombre} · ${mat.nombre}"`.
 *      - paleta materia.
 *      - emblema (grupo override o paleta default).
 *      - **XP grupal** = `grupo.puntos` (NO alumno individual).
 *      - **Prestigio nivel**: round(grupo.nivel/2) capped [1,5].
 *      - **xpMax**: `prestigio × 1000 + 500` (con clamp xpGrupal + 100).
 *      - **activo**: alguna tarea en últimos 30 días.
 *      - bgGrad shared via paleta.
 *      - periodo + periodoInfo.
 * Edge:
 *   - **Lógica "una card por materia"**: aunque alumno pertenece a 1 grupo,
 *     cada materia genera una card (la materia ES el contexto del grupo).
 *     Comentario inline lo explicita.
 *   - **xpMax clamp `Math.max(xpMax, xpGrupal + 100)`**: alumno con XP
 *     excedente no muestra barra completa, asegura margen visual.
 *   - **logrosTotal = DEMO_LOGROS.length || 12**: fallback 12 si no hay
 *     catálogo cargado.
 *   - **`fechasRecientes` ventana 30 días** para flag activo.
 *   - Función PURA.
 */
function getGruposAlumno(uid) {
    if (!uid || !_hayDatos()) return [];
    const user = DEMO_USERS.find(u => u.id === uid);
    if (!user) return [];
    const userGrupos = (user.grupos || [])
        .map(gid => (DEMO_GRUPOS || []).find(g => g.id === gid))
        .filter(Boolean);
    if (!userGrupos.length) return [];

    const tareasAll = DEMO_TAREAS || [];
    const ahora     = new Date();
    const semana30  = 30 * 86400000;
    const logrosTot = (DEMO_LOGROS || []).length || 12;

    const cards = [];
    (user.materias || []).forEach(matId => {
        const mat = (DEMO_MATERIAS || []).find(m => m.id === matId);
        if (!mat) return;
        // Buscar el grupo del usuario que cursa esta materia
        const grupo = userGrupos.find(g => (g.materias || []).includes(matId)) || userGrupos[0];
        if (!grupo) return;

        const pal = _materiaPalette(matId);
        const tareasMat = tareasAll.filter(t => t.materiaId === matId && t.grupoId === grupo.id);
        const fechasRecientes = tareasMat.some(t => {
            const f = t.fechaEntrega ? new Date(t.fechaEntrega) : null;
            return f && (ahora - f) < semana30;
        });
        const xpGrupal = grupo.puntos || 0;
        const nivelGrupo = grupo.nivel || 1;
        const prestigio  = Math.min(5, Math.max(1, Math.round(nivelGrupo / 2)));
        const xpMax      = prestigio * 1000 + 500;
        const logrosObt  = (grupo.logros || []).length;
        const glow       = grupo.color || pal.hex;

        cards.push({
            id:              `${grupo.id}_${matId}`,
            grupoId:         grupo.id,
            materiaId:       matId,
            nombre:          `${grupo.nombre} · ${mat.nombre}`,
            materia:         mat.nombre,
            materiaColor:    glow,
            emblema:         grupo.emblema || pal.emblema,
            miembros:        (grupo.miembros || []).length,
            xpGrupal,
            xpMax:           Math.max(xpMax, xpGrupal + 100),
            prestigioNivel:  prestigio,
            activo:          fechasRecientes,
            logrosObtenidos: logrosObt,
            logrosTotal:     logrosTot,
            bgGrad:          pal.bg,
            glowColor:       glow,
            periodo:         grupo.periodo || null,
            periodoInfo:     getPeriodoInfo(grupo.periodo),
        });
    });

    return cards;
}

/**
 * @interaction get-grupo-card-detalle
 * @scope estudiante-data-provider-public-detalle
 *
 * Given uid + cardId compuesto `${grupoId}_${matId}`.
 * When `abrirDetalleGrupo` (grupos.js) consumed.
 * Then:
 *   1. Resuelve card desde `getGruposAlumno(uid)`.
 *   2. Construye `miembrosLista` con XP aportado heurístico
 *      `(prom × 45) + (entregas × 12)`. Sort desc por aporte.
 *   3. Construye `actividad[]` con últimas 5 entregas calificadas
 *      ordenadas desc por fecha + color por umbral cal.
 *   4. Retorna `{...card, miembrosLista, actividad}`.
 * Edge:
 *   - **XP aportado heurístico**: `prom × 45 + entregas × 12` — fórmula
 *     DEMO arbitraria. Decisión visual. Deuda post-Supabase.
 *   - **Color por umbral cal**: amber sin nota / green ≥9 / teal ≥6 / red < 6.
 *   - **icon trofeo 🏆 si cal ≥ 9**, else 📝.
 *   - **innerHTML inline en `text`** con `<strong>` + cal/10 si presente.
 *     DEMO controlado.
 *   - **Avatar paleta rotativa 7 colors** por idx (no por color real del user).
 *   - Función PURA.
 */
function getGrupoCardDetalle(uid, cardId) {
    const cards = getGruposAlumno(uid);
    const card  = cards.find(c => c.id === cardId);
    if (!card) return null;

    const grupo  = (DEMO_GRUPOS  || []).find(g => g.id === card.grupoId);
    const tareas = (DEMO_TAREAS  || []).filter(t =>
        t.materiaId === card.materiaId && t.grupoId === card.grupoId
    );

    // Miembros con XP aportado (proxy: promedio × 45 + entregas × 12)
    const miembrosLista = (grupo?.miembros || []).map((mid, idx) => {
        const u = DEMO_USERS.find(x => x.id === mid);
        const entregas = tareas.flatMap(t => t.entregas || []).filter(e => e.uid === mid);
        const cals = entregas.map(e => e.calificacion).filter(c => typeof c === "number");
        const prom = cals.length ? cals.reduce((a, b) => a + b, 0) / cals.length : 0;
        const aporte = Math.round(prom * 45 + entregas.length * 12);
        const palAv = ["teal","amber","blue","purple","green","red","cyan"][idx % 7];
        return {
            uid:       mid,
            nombre:    u?.nombre || mid,
            iniciales: u?.iniciales || mid.slice(0, 2).toUpperCase(),
            color:     palAv,
            xpAporte:  aporte,
            esYo:      mid === uid,
        };
    }).sort((a, b) => b.xpAporte - a.xpAporte);

    // Actividad reciente: últimas entregas calificadas en este grupo/materia
    const actividad = tareas
        .flatMap(t => (t.entregas || []).map(e => ({ tarea: t, entrega: e })))
        .filter(({ entrega }) => entrega.fecha)
        .sort((a, b) => new Date(b.entrega.fecha) - new Date(a.entrega.fecha))
        .slice(0, 5)
        .map(({ tarea, entrega }) => {
            const u = DEMO_USERS.find(x => x.id === entrega.uid);
            const cal = entrega.calificacion;
            const color = cal == null
                ? "var(--xahni-amber)"
                : cal >= 9 ? "var(--xahni-green)"
                : cal >= 6 ? "var(--xahni-teal)"
                : "var(--xahni-red)";
            return {
                color,
                icon:  cal != null && cal >= 9 ? "🏆" : "📝",
                text:  `<strong>${u?.nombre || entrega.uid}</strong> entregó "${tarea.titulo}"${cal != null ? ` — ${cal}/10` : ""}`,
                fecha: new Date(entrega.fecha),
            };
        });

    return { ...card, miembrosLista, actividad };
}

// ── Comparativa yo vs grupo (% por materia) ─────────────────
/**
 * @interaction get-comparativa-alumno
 * @scope estudiante-data-provider-public-perfil
 *
 * Given uid del alumno.
 * When perfil-gamificacion `buildComparativaGrupo` consumed.
 * Then:
 *   1. Resuelve `compañeros` (estudiantes en mismo grupo).
 *   2. Por cada materia del alumno:
 *      - **`getMateriasAlumno` RECURSIVO** por cada compañero (caro pero
 *        simple).
 *      - promGrupo = avg de promedios > 0 de compañeros.
 *      - Retorna `{materia, yo: prom × 10, grupo: promGrupo × 10, color}`.
 * Edge:
 *   - **PERF OPS(N×M×K)**: N compañeros × M materias × K entregas. Aceptable
 *     DEMO; deuda post-Supabase: vista materializada con AVG OVER PARTITION.
 *   - **Multiplicador × 10** para escalar a "%" (0-100) — convención visual.
 *   - **Filter `> 0`** descarta sin promedio (no contamina avg).
 *   - Función PURA respecto a inputs.
 */
function getComparativaAlumno(uid) {
    if (!uid || !_hayDatos()) return [];
    const user = DEMO_USERS.find(u => u.id === uid);
    if (!user) return [];
    const grupo = (user.grupos || [])[0];
    if (!grupo) return [];

    const compañeros = DEMO_USERS.filter(u =>
        u.tipo === "estudiante" && (u.grupos || []).includes(grupo)
    );

    const misMat = getMateriasAlumno(uid);
    return misMat.map(m => {
        // Promedio del grupo en esta materia
        const promediosGrupo = compañeros.map(c => {
            const matsC = getMateriasAlumno(c.id);
            const found = matsC.find(x => x.id === m.id);
            return found?.promedio || 0;
        }).filter(v => v > 0);
        const promGrupo = promediosGrupo.length
            ? promediosGrupo.reduce((a, b) => a + b, 0) / promediosGrupo.length
            : 0;
        return {
            materia: m.nombre,
            yo:      Math.round(m.promedio * 10),
            grupo:   Math.round(promGrupo * 10),
            color:   m.materiaColor,
        };
    });
}

// ── Trofeos derivados de competencias finalizadas ───────────
/**
 * @interaction get-trofeos-alumno
 * @scope estudiante-data-provider-public-perfil
 *
 * Given uid del alumno.
 * When perfil-gamificacion `buildTrofeos` consumed.
 * Then itera competencias finalizadas con resultado del grupo:
 *   - emoji medal (🥇🥈🥉🎖️).
 *   - rareza string ("legendario"/"epico"/"raro"/"comun").
 *   - glow color hex por lugar.
 *   - gradiente CSS pre-built.
 *   - desc compuesto "{materia} · {lugar}° lugar con {pts} pts".
 *   - pts label "+N XP".
 *   - fechaStr corto "mes año".
 * Edge:
 *   - **Solo competencias finalizadas con resultados del grupo del alumno**.
 *   - **Sort opinable**: oro al inicio (`-1`) else `1` — pero JS sort no
 *     respeta el `-1` consistente. Resultado: agrupa oros al inicio
 *     aproximadamente. Pattern simplista DEMO. Deuda menor.
 *   - **Rareza/glow hardcoded por lugar** — no respeta pts.
 *   - Función PURA.
 */
function getTrofeosAlumno(uid) {
    if (!uid || !_hayDatos()) return [];
    const user = DEMO_USERS.find(u => u.id === uid);
    if (!user) return [];
    const grupo = (user.grupos || [])[0];
    if (!grupo) return [];

    // Bug M1 2026-06-09: usar _allTorneos() en lugar de DEMO_COMPETENCIAS raw.
    // _allTorneos mergea seeds + userCreated + cerrados override, así que captura
    // torneos cerrados por el propio alumno (que viven en localStorage) y los
    // cerrados cross-device por el profesor (que viven en seeds tras hydrate).
    // Filtrar también con derivarEstado para detectar cerradoEn aunque el campo
    // estado no esté actualizado (caso documentos Firestore con shape parcial).
    // Fallback adicional: algunos torneos terminan con c.resultados={} (persistencia
    // defectuosa cuando el cierre ocurrió antes de que calcularRanking persistiera).
    // Si el shape persistido no tiene mi grupo, computar ranking en vivo desde
    // attempts y derivar lugar/puntaje sobre la marcha.
    const all = (typeof CompetenciasData !== "undefined" && CompetenciasData._allTorneos)
        ? CompetenciasData._allTorneos()
        : (DEMO_COMPETENCIAS || []);
    const _esFinal = (c) => (typeof CompetenciasData !== "undefined" && CompetenciasData.derivarEstado)
        ? CompetenciasData.derivarEstado(c) === "finalizada"
        : c.estado === "finalizada";
    return all
        .filter(c => _esFinal(c) && (c.gruposInscritos || []).includes(grupo))
        .map(c => {
            // Bug 2026-06-09: el trofeo NO se gana solo por estar en el grupo.
            // El alumno debe haber participado en el torneo (al menos un
            // attempt registrado). Sin este filtro, todos los alumnos del
            // grupo ganador recibían el mismo set de trofeos aunque no
            // hubieran jugado, dando la impresión de que los logros estaban
            // compartidos entre todos.
            const attemptsMios = (typeof CompetenciasData !== "undefined" && CompetenciasData.getAttempts)
                ? CompetenciasData.getAttempts(c.id, uid)
                : [];
            if (!attemptsMios || attemptsMios.length === 0) return null;

            let lugar = c.resultados?.[grupo]?.lugar;
            let pts = c.resultados?.[grupo]?.puntaje;
            if (lugar == null && typeof CompetenciasData !== "undefined" && CompetenciasData.calcularRanking) {
                const ranking = CompetenciasData.calcularRanking(c);
                const mio = ranking.find(r => r.grupoId === grupo);
                if (mio) { lugar = mio.lugar; pts = mio.puntaje; }
            }
            if (lugar == null) return null;
            const matNom = (DEMO_MATERIAS || []).find(m => m.id === c.materiaId)?.nombre || c.materiaId;
            const rareza = lugar === 1 ? "legendario"
                         : lugar === 2 ? "epico"
                         : lugar === 3 ? "raro"
                         : "comun";
            const glow   = lugar === 1 ? "#f5a623"
                         : lugar === 2 ? "#c0c0c0"
                         : lugar === 3 ? "#cd7f32"
                         : "#7a9bc4";
            const fechaStr = new Date(c.fechaFin).toLocaleDateString("es-MX", { month:"short", year:"numeric" });
            return {
                emoji:     lugar === 1 ? "🥇" : lugar === 2 ? "🥈" : lugar === 3 ? "🥉" : "🎖️",
                nombre:    c.nombre,
                desc:      `${matNom} · ${lugar}° lugar grupal con ${pts} pts.`,
                fecha:     fechaStr,
                pts:       `+${pts} XP`,
                rareza,
                gradiente: `linear-gradient(135deg,${glow}30,${glow}10)`,
                glowColor: glow,
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.glowColor === "#f5a623" ? -1 : 1);
}

// ── Logros desbloqueados del alumno ─────────────────────────
/**
 * @interaction get-logros-alumno
 * @scope estudiante-data-provider-public-perfil
 *
 * Given uid del alumno.
 * When perfil-gamificacion `buildLogros` consumed.
 * Then map DEMO_LOGROS entero a shape UI:
 *   - emoji ← l.icono.
 *   - rareza: "epico" si grupal, "comun" individual.
 *   - color: amber grupal / cyan individual.
 *   - desbloqueado: `!!l.desbloqueadoPor[uid]`.
 *   - descripcion preservada.
 * Edge:
 *   - **Retorna TODOS los logros del catálogo** (no solo desbloqueados).
 *     El flag `desbloqueado` permite UI gated.
 *   - **Rareza solo 2 estados** ("epico" / "comun") — pattern simplista DEMO.
 *     Deuda menor: mapping fino por nivel.
 *   - Función PURA.
 */
function getLogrosAlumno(uid) {
    if (!uid || typeof DEMO_LOGROS === "undefined" || !Array.isArray(DEMO_LOGROS)) return [];
    // Sprint 2026-06-08 D4: el flag `desbloqueado` se deriva EXCLUSIVAMENTE
    // del runtime GamerState (localStorage `xahni:gamer:<uid>`). El seed
    // `desbloqueadoPor` del JSON queda como dato histórico/visual para perfil
    // público de otros alumnos que aún no migran a runtime.
    const runtimeUnlocked = (typeof GamerState !== "undefined")
        ? new Set(GamerState.get(uid).insignias || [])
        : new Set();
    return DEMO_LOGROS.map(l => ({
        emoji:        l.icono,
        nombre:       l.nombre,
        rareza:       l.tipo === "grupal" ? "epico" : "comun",
        color:        l.tipo === "grupal" ? "#f5a623" : "#00d4ff",
        desbloqueado: runtimeUnlocked.has(l.id),
        descripcion:  l.descripcion,
    }));
}

// ── Actividad reciente derivada de progreso[uid] ────────────
/**
 * @interaction get-actividad-alumno
 * @scope estudiante-data-provider-public-perfil
 *
 * Given uid del alumno.
 * When perfil-gamificacion `buildPerfilActividadEst` consumed.
 * Then unifica 3 fuentes de eventos del progreso:
 *   1. `tareasEntregadas`: tipo "tarea" + icon ✅ + cal/10 si presente.
 *   2. `juegosJugados`: tipo "juego" + icon 🎮 + puntaje.
 *   3. `competenciasParticipadas`: tipo "competencia" + medal por posición.
 *   Sort desc por fecha (más reciente primero).
 * Edge:
 *   - **`<strong>` inline en text** (HTML render) — convención DEMO controlada.
 *   - **3 tipos color distintos**: teal tarea / cyan juego / amber competencia.
 *   - Función PURA respecto a inputs.
 *   - Sin progreso → `[]`.
 *   - Deuda post-Supabase: vista materializada `actividad_unificada_view`
 *     con UNION ALL.
 */
function getActividadAlumno(uid) {
    if (!uid || !_hayDatos()) return [];
    const progreso = (DEMO_PROGRESO_ESTUDIANTES || {})[uid] || {};
    const eventos  = [];

    (progreso.tareasEntregadas || []).forEach(e => {
        const t      = (DEMO_TAREAS || []).find(x => x.id === e.tareaId);
        const matNom = (DEMO_MATERIAS || []).find(m => m.id === t?.materiaId)?.nombre || "";
        eventos.push({
            tipo:  "tarea",
            fecha: new Date(e.fecha),
            icon:  "✅",
            color: "var(--xahni-teal)",
            text:  `Entregaste <strong>${t?.titulo || e.tareaId}</strong>${matNom ? ` · ${matNom}` : ""}${typeof e.calificacion === "number" ? ` (${e.calificacion}/10)` : ""}`,
        });
    });

    (progreso.juegosJugados || []).forEach(j => {
        const jg = (DEMO_JUEGOS || []).find(x => x.id === j.juegoId);
        eventos.push({
            tipo:  "juego",
            fecha: new Date(j.fecha),
            icon:  "🎮",
            color: "var(--xahni-cyan)",
            text:  `Jugaste <strong>${jg?.nombre || j.juegoId}</strong> — ${j.puntaje} pts`,
        });
    });

    (progreso.competenciasParticipadas || []).forEach(c => {
        const comp = (DEMO_COMPETENCIAS || []).find(x => x.id === c.competenciaId);
        eventos.push({
            tipo:  "competencia",
            fecha: new Date(c.fecha),
            icon:  c.posicion === 1 ? "🥇" : c.posicion === 2 ? "🥈" : c.posicion === 3 ? "🥉" : "🏆",
            color: "var(--xahni-amber)",
            text:  `Participaste en <strong>${comp?.nombre || c.competenciaId}</strong>${c.posicion ? ` — ${c.posicion}° lugar` : ""}`,
        });
    });

    // Bug 2026-06-09: incluir también jugadas runtime de GamerState (las
    // jugadas reales del demo y prod, persistidas en localStorage por uid).
    // Sin esto, getActividadGrupo retornaba 0 porque los miembros del grupo
    // smoke no tienen entries en DEMO_PROGRESO_ESTUDIANTES (solo en runtime).
    // Dedup por (juegoId, fecha) contra los seeds para evitar duplicación.
    const seedJuegoKeys = new Set();
    (progreso.juegosJugados || []).forEach(j => {
        seedJuegoKeys.add(`${j.juegoId}|${(new Date(j.fecha)).toISOString().slice(0, 19)}`);
    });
    if (typeof GamerState !== "undefined" && GamerState.get) {
        const gs = GamerState.get(uid);
        (gs?.jugadas || []).forEach(j => {
            const fecha = new Date(j.fecha || j.fechaIso || Date.now());
            if (isNaN(fecha.getTime())) return;
            const key = `${j.juegoId}|${fecha.toISOString().slice(0, 19)}`;
            if (seedJuegoKeys.has(key)) return; // ya en seeds
            // Resolver nombre del juego desde seeds o user-created
            const jgSeed = (DEMO_JUEGOS || []).find(x => x.id === j.juegoId);
            let jgUser = null;
            if (!jgSeed) {
                try { jgUser = (JSON.parse(localStorage.getItem("xahni:juegos:userCreated") || "[]")).find(x => x.id === j.juegoId); }
                catch (e) { /* defensive */ }
            }
            const jgNom = (jgSeed || jgUser)?.nombre || j.juegoId;
            eventos.push({
                tipo:  "juego",
                fecha,
                icon:  "🎮",
                color: "var(--xahni-cyan)",
                text:  `Jugaste <strong>${jgNom}</strong>${typeof j.puntaje === "number" ? ` — ${j.puntaje} pts` : ""}`,
            });
        });
    }

    return eventos.sort((a, b) => b.fecha - a.fecha);
}

// ── Actividad reciente del GRUPO (agrega miembros) ───────────
/**
 * Given grupoId.
 * When _buildActividadRecienteHtml del tab Mi grupo lo consume.
 * Then itera todos los miembros del grupo y agrega sus actividades
 *   (getActividadAlumno por uid), enriqueciendo con el nombre del autor.
 *   Ordena desc por fecha y devuelve top N.
 * Edge:
 *   - grupoId falsy o DEMO_GRUPOS ausente → [].
 *   - Función pura.
 */
function getActividadGrupo(grupoId, limit) {
    if (!grupoId || !_hayDatos()) return [];
    const grupos = (typeof DEMO_GRUPOS !== "undefined" ? DEMO_GRUPOS : []);
    const grupo = grupos.find(g => g.id === grupoId);
    if (!grupo) return [];
    const miembros = grupo.miembros || grupo.alumnos || [];
    const max = typeof limit === "number" ? limit : 8;
    const eventos = [];
    miembros.forEach(uid => {
        const u = (DEMO_USERS || []).find(x => x.id === uid);
        const nom = u?.nombre || uid;
        const acts = (typeof getActividadAlumno === "function") ? getActividadAlumno(uid) : [];
        acts.forEach(a => {
            eventos.push({
                tipo:   a.tipo,
                fecha:  a.fecha,
                icon:   a.icon,
                color:  a.color,
                autor:  nom,
                autorUid: uid,
                // texto enriquecido con el autor (no asume que es "yo")
                text:   a.text.replace(/^(Entregaste|Jugaste|Participaste en)/,
                                       (m) => `<strong>${nom}</strong> ${m === 'Entregaste' ? 'entregó' : m === 'Jugaste' ? 'jugó' : 'participó en'}`)
            });
        });
    });
    return eventos
        .sort((a, b) => b.fecha - a.fecha)
        .slice(0, max);
}
