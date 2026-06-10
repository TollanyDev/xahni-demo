// js/profesor/competencias.js
// Slice Competencias beta C3 · 2026-06-06 · spec §6
// S2 torneos intra 2026-06-09: tab interno Intra|Inter + dos botones crear.
// S2 polish 2026-06-09: botón único context-aware + tabs prominentes.
//
// Renderer panel top-level Competencias profesor (twin). Lee CompetenciasData.
// Stats hero creator-economy + grid mis torneos + mini ranking en cards activa.

let _PROF_COMP_FILTRO = "todos";
let _PROF_COMP_MODO = "inter"; // "inter" | "intra"

// ── Stats hero intra ──────────────────────────────────────────────────────
// Equivalente de CompetenciasData.statsHeroProfesor para torneos intragrupales.
// XP pasiva creator-economy no aplica al modelo intra (no hay distribución pasiva
// implementada en TorneosIntraData) → se muestra "—" con tooltip "pendiente cálculo".
function _statsHeroIntra(uid) {
    if (typeof TorneosIntraData === "undefined") {
        return { creados: 0, participacionesRecibidas: 0, xpPasivaGanada: null, topTorneo: null };
    }
    const mios = TorneosIntraData.getAll().filter(function(t) { return t.creadoPor === uid; });
    let participacionesRecibidas = 0;
    let topTorneo = null;
    let topPartic = -1;
    mios.forEach(function(t) {
        // Participantes únicos que jugaron: fila de ranking con jugo:true
        const ranking = t.ranking || [];
        const partic = ranking.filter(function(r) { return r.jugo; }).length;
        participacionesRecibidas += partic;
        if (partic > topPartic) {
            topPartic = partic;
            topTorneo = t;
        }
    });
    return {
        creados: mios.length,
        participacionesRecibidas: participacionesRecibidas,
        xpPasivaGanada: null, // deuda: creator-economy intra no implementada en S2
        topTorneo: topTorneo
    };
}

function buildCompetenciasProfesor() {
    if (typeof CompetenciasData === "undefined") return;
    const panel = document.getElementById("prof-hub-grupo-tab-competencias");
    if (!panel) return;
    if (APP?.user?.tipo !== "profesor") return;
    const uid = APP.user.id;

    const mios = CompetenciasData.listarMisTorneos(uid);
    const now = new Date();
    // Stats hero dependen del modo activo (inter o intra)
    const stats = _PROF_COMP_MODO === "intra"
        ? _statsHeroIntra(uid)
        : CompetenciasData.statsHeroProfesor(uid);

    const counts = { todos: mios.length, activa: 0, proxima: 0, finalizada: 0 };
    mios.forEach(c => {
        const e = CompetenciasData.derivarEstado(c, now);
        counts[e] = (counts[e] || 0) + 1;
    });

    const filtradas = _PROF_COMP_FILTRO === "todos"
        ? mios
        : mios.filter(c => CompetenciasData.derivarEstado(c, now) === _PROF_COMP_FILTRO);

    // Para intra, el nombre del torneo se construye igual que en _renderIntraCard
    const topTorneoNom = stats.topTorneo
        ? (() => {
            const t = stats.topTorneo;
            // Inter: t.nombre directo. Intra: "Torneo intra · <materia>"
            const nom = t.nombre || (() => {
                const mat = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
                    .find(m => m.id === t.materiaId);
                return mat ? "Torneo intra · " + mat.nombre : "Torneo intragrupal";
            })();
            return nom.replace(/</g, "&lt;").substring(0, 28);
        })()
        : "—";

    panel.innerHTML = `
        <div class="x-page-head">
            <div>
                <div class="x-page-head__title">Mis <em>torneos</em></div>
                <div class="x-page-head__subtitle">Diseñados por ti · competidos por los grupos</div>
            </div>
            <div class="x-page-head__actions">
                <button class="x-btn x-btn--primary" onclick="profCompCrearAuto()">＋ Crear torneo</button>
            </div>
        </div>

        <!-- Tab interno Intra | Inter — prominente (mayor que filter chips) -->
        <div style="display:flex;gap:8px;margin-bottom:14px;border-bottom:1px solid var(--border);padding-bottom:12px">
            <span class="x-chip ${_PROF_COMP_MODO === 'inter' ? 'x-chip--active' : ''}"
                  onclick="competenciasProfSetModo('inter')"
                  style="font-size:15px;font-weight:600;padding:8px 18px;cursor:pointer;${_PROF_COMP_MODO === 'inter' ? 'background:var(--brand-gradient);color:#fff;border-color:transparent;' : ''}">Inter · entre grupos</span>
            <span class="x-chip ${_PROF_COMP_MODO === 'intra' ? 'x-chip--active' : ''}"
                  onclick="competenciasProfSetModo('intra')"
                  style="font-size:15px;font-weight:600;padding:8px 18px;cursor:pointer;${_PROF_COMP_MODO === 'intra' ? 'background:var(--brand-gradient);color:#fff;border-color:transparent;' : ''}">Intra · dentro del grupo</span>
        </div>

        <!-- Stats hero creator-economy -->
        <div class="x-card" style="margin-bottom:18px;padding:22px;position:relative;overflow:hidden">
            <div aria-hidden="true" style="position:absolute;inset:0;background:linear-gradient(135deg,var(--xahni-cyan-dim) 0%,transparent 35%,transparent 65%,var(--xahni-amber-dim) 100%);opacity:0.4;pointer-events:none"></div>
            <div style="position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:24px">
                <div class="juegos-stub-stat">
                    <div class="juegos-stub-stat__icon" style="color:var(--accent-cyan-text)">🏆</div>
                    <div class="x-stat__label">Torneos creados</div>
                    <div class="x-mono-sm" style="font-size:24px;color:var(--text-primary);font-weight:700">${stats.creados}</div>
                </div>
                <div class="juegos-stub-stat">
                    <div class="juegos-stub-stat__icon" style="color:var(--state-info)">👥</div>
                    <div class="x-stat__label">Participaciones recibidas</div>
                    <div class="x-mono-sm" style="font-size:24px;color:var(--text-primary);font-weight:700">${stats.participacionesRecibidas}</div>
                </div>
                <div class="juegos-stub-stat">
                    <div class="juegos-stub-stat__icon" style="color:var(--xahni-amber)">⭐</div>
                    <div class="x-stat__label">XP pasiva ganada</div>
                    ${stats.xpPasivaGanada !== null
                        ? `<div class="x-mono-sm" style="font-size:24px;background:linear-gradient(90deg,var(--xahni-amber),var(--xahni-purple));-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:700">${stats.xpPasivaGanada.toLocaleString()}</div>`
                        : `<div style="font-size:18px;font-weight:700;color:var(--text-muted)" title="XP pasiva creator-economy no aplica al modelo intragrupal">—</div>
                           <div style="font-size:10px;color:var(--text-muted)">sin datos · intra</div>`
                    }
                </div>
                <div class="juegos-stub-stat">
                    <div class="juegos-stub-stat__icon" style="color:var(--state-ok)">📊</div>
                    <div class="x-stat__label">Top torneo</div>
                    <div style="font-size:14px;color:var(--text-primary);font-weight:600">${topTorneoNom}</div>
                </div>
            </div>
        </div>

        ${_PROF_COMP_MODO === 'inter' ? `
        <!-- Filter chips (inter) -->
        <div class="comp-filter-chips">
            ${_renderFiltroChipProf("todos", "Todos", counts.todos)}
            ${_renderFiltroChipProf("activa", "Activos", counts.activa)}
            ${_renderFiltroChipProf("proxima", "Próximos", counts.proxima)}
            ${_renderFiltroChipProf("finalizada", "Finalizados", counts.finalizada)}
        </div>

        <!-- Grid torneos intergrupales -->
        <div class="comp-grid">
            ${filtradas.length === 0
                ? `<div class="x-empty" style="grid-column:1/-1;padding:36px;text-align:center;color:var(--text-muted)">
                       <div style="font-size:32px;margin-bottom:8px">🎯</div>
                       <div style="margin-bottom:14px">No hay torneos en esta categoría.</div>
                       <button class="x-btn x-btn--ghost" onclick="CrearTorneo.abrir()">＋ Crear intergrupal</button>
                   </div>`
                : filtradas.map(c => _renderCompCardProf(c, now)).join("")}
        </div>
        ` : `
        <!-- Grid torneos intragrupales (renderizado por ProfesorTorneosIntra) -->
        <div class="comp-grid" id="prof-comp-intra-grid"></div>
        `}

        <!-- Ranking destacado — espejo del estudiante. Sin toggle: el tab Intra/Inter ya filtra. -->
        <div class="comp-ranking-block">
            <div class="x-page-head__title" style="font-size:17px;margin-bottom:10px">
                Ranking destacado ${_PROF_COMP_MODO === 'intra' ? '· alumnos de los grupos' : '· entre grupos'}
            </div>
            <div id="prof-ranking-full">
                ${_PROF_COMP_MODO === 'intra' ? _renderRankingDestacadoProfIntra(uid) : _renderRankingDestacadoProf(uid)}
            </div>
        </div>
    `;

    // Si el modo es intra, delegar render al módulo especializado
    if (_PROF_COMP_MODO === 'intra') {
        const intraGrid = document.getElementById("prof-comp-intra-grid");
        if (intraGrid && typeof ProfesorTorneosIntra !== "undefined") {
            ProfesorTorneosIntra.renderProfesor(intraGrid);
        }
    }
}

function _renderFiltroChipProf(value, label, count) {
    const active = _PROF_COMP_FILTRO === value;
    return `<span class="x-chip ${active ? "x-chip--active" : ""}" onclick="competenciasProfSetFiltro('${value}')">${label} · ${count}</span>`;
}

function competenciasProfSetFiltro(filtro) {
    _PROF_COMP_FILTRO = filtro;
    buildCompetenciasProfesor();
}
window.competenciasProfSetFiltro = competenciasProfSetFiltro;

function competenciasProfSetModo(modo) {
    if (modo !== "inter" && modo !== "intra") return;
    _PROF_COMP_MODO = modo;
    buildCompetenciasProfesor();
}
window.competenciasProfSetModo = competenciasProfSetModo;

// Bundle C 2026-06-09: detector compartido si la competencia recicla un quiz IA.
// Una competencia tiene comp.juegoId que apunta al quiz subyacente. Si ese quiz
// tiene origen='ia', la competencia hereda visualmente el chip Gemini.
function _compEsIA(comp) {
    if (!comp || !comp.juegoId) return false;
    // Buscar en seeds + user-created
    const seed = (typeof DEMO_JUEGOS !== "undefined" ? DEMO_JUEGOS : [])
        .find(j => j.id === comp.juegoId);
    if (seed && seed.origen === "ia") return true;
    if (typeof getUserJuegos === "function") {
        const user = getUserJuegos().find(j => j.id === comp.juegoId);
        if (user && user.origen === "ia") return true;
    }
    return false;
}
window._compEsIA = _compEsIA;

function _renderCompCardProf(comp, now) {
    const estado = CompetenciasData.derivarEstado(comp, now);
    const ranking = CompetenciasData.calcularRanking(comp);
    const matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
        .find(m => m.id === comp.materiaId)?.nombre || comp.materiaId;
    const titEsc = (comp.nombre || "").replace(/</g, "&lt;");
    const chipIa = _compEsIA(comp)
        ? `<span class="x-chip-ia" title="Torneo basado en quiz generado por Gemini IA">✨ Gemini</span>`
        : "";
    const totalPartic = ranking.reduce((s, r) => s + r.participantes, 0);
    const diasRestantes = Math.max(0, Math.ceil((new Date(comp.fechaFin) - now) / 86400000));

    let chipEstado, acciones;
    if (estado === "activa") {
        chipEstado = `<span class="x-chip x-chip--ok" style="font-size:10px">🟢 ACTIVA · ${diasRestantes}d</span>`;
        acciones = `
            <button class="x-btn x-btn--ghost x-btn--danger" style="font-size:11px;padding:4px 10px" onclick="event.stopPropagation();DetalleTorneo.cerrarAntes('${comp.id}')">Cerrar antes</button>
            <button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 10px" onclick="event.stopPropagation();DetalleTorneo.abrir('${comp.id}',{contexto:'profesor'})">Ver detalle →</button>
        `;
    } else if (estado === "proxima") {
        const diasInicio = Math.ceil((new Date(comp.fechaInicio) - now) / 86400000);
        chipEstado = `<span class="x-chip x-chip--warn" style="font-size:10px">🟡 EN ${diasInicio}d</span>`;
        acciones = `<button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 10px" onclick="event.stopPropagation();DetalleTorneo.abrir('${comp.id}',{contexto:'profesor'})">Ver detalle →</button>`;
    } else { // finalizada
        const ganadorId = ranking[0]?.grupoId || comp.ganadorGrupoId || null;
        const ganadorLabel = ganadorId
            ? (typeof _displayGrupoLabel === "function" ? _displayGrupoLabel(ganadorId, 18) : ganadorId)
            : "—";
        chipEstado = `<span class="x-chip" style="font-size:10px;background:var(--xahni-amber-dim);color:var(--xahni-amber)">🏆 ${ganadorLabel}</span>`;
        acciones = `<button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 10px" onclick="event.stopPropagation();DetalleTorneo.abrir('${comp.id}',{contexto:'profesor'})">Ver resultados →</button>`;
    }

    const miniRanking = estado === "activa" || estado === "finalizada"
        ? `<div class="comp-mini-ranking">
            ${ranking.slice(0, 3).map(r => `
                <div class="comp-mini-ranking__row">
                    <div class="comp-mini-ranking__lugar">${r.lugar}°</div>
                    <div>${typeof _displayGrupoLabel === "function" ? _displayGrupoLabel(r.grupoId, 12) : r.grupoId}</div>
                    <div class="comp-mini-ranking__pts">${r.puntaje} · ${r.participantes} part.</div>
                </div>
            `).join("")}
        </div>`
        : "";

    return `
        <article class="comp-card ${estado}" onclick="DetalleTorneo.abrir('${comp.id}',{contexto:'profesor'})" style="cursor:pointer">
            <div class="comp-card__head">
                <div>
                    <div class="comp-card__title">${titEsc}</div>
                    <div class="comp-card__meta" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                        <span>${matNom} · ${(comp.tipo || 'quiz').toUpperCase()} · ${(comp.gruposInscritos || []).length} grupos</span>
                        ${chipIa}
                    </div>
                </div>
                ${chipEstado}
            </div>
            ${miniRanking}
            <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--text-muted)">
                <span>${totalPartic} participaciones</span>
                <span style="display:flex;gap:6px">${acciones}</span>
            </div>
        </article>
    `;
}

/**
 * @interaction prof-comp-crear-auto
 * @scope profesor-competencias-context-aware-create
 *
 * Given tab Intra|Inter activo (variable _PROF_COMP_MODO).
 * When profesor click "＋ Crear torneo" (botón único).
 * Then abre wizard intergrupal (Inter) o intragrupal (Intra) según modo activo.
 */
function profCompCrearAuto() {
    if (_PROF_COMP_MODO === "intra") {
        if (typeof ProfesorTorneosIntraWizard !== "undefined") {
            ProfesorTorneosIntraWizard.abrir();
        }
    } else {
        if (typeof CrearTorneo !== "undefined") {
            CrearTorneo.abrir();
        }
    }
}
window.profCompCrearAuto = profCompCrearAuto;

// ── Ranking destacado (profesor inter): agrega puntajes por grupo entre los
// torneos intergrupales creados por este profesor (activos + finalizados).
// Sin highlight de "mi grupo" — el profesor no compite, observa los grupos.
function _renderRankingDestacadoProf(uid) {
    if (typeof CompetenciasData === "undefined") {
        return `<div class="x-empty" style="padding:18px;text-align:center;color:var(--text-muted)">Sin datos</div>`;
    }
    const mios = CompetenciasData.listarMisTorneos(uid).filter(c => {
        const e = CompetenciasData.derivarEstado(c);
        return e === "activa" || e === "finalizada";
    });
    if (mios.length === 0) {
        return `<div class="x-empty" style="padding:18px;text-align:center;color:var(--text-muted)">Sin torneos activos/finalizados todavía</div>`;
    }
    const acumPorGrupo = {};
    mios.forEach(c => {
        const estado = CompetenciasData.derivarEstado(c);
        let ranking;
        if (estado === "finalizada" && c.resultados && Object.keys(c.resultados).length > 0) {
            ranking = Object.keys(c.resultados).map(grupoId => ({
                grupoId: grupoId,
                puntaje: c.resultados[grupoId].puntaje || 0
            }));
        } else {
            ranking = CompetenciasData.calcularRanking(c);
        }
        ranking.forEach(r => {
            if (!r.grupoId) return;
            acumPorGrupo[r.grupoId] = (acumPorGrupo[r.grupoId] || 0) + r.puntaje;
        });
    });
    const rows = Object.keys(acumPorGrupo)
        .map(k => ({ key: k, puntaje: acumPorGrupo[k] }))
        .sort((a, b) => b.puntaje - a.puntaje);

    if (rows.length === 0 || rows.every(r => r.puntaje === 0)) {
        return `<div class="x-empty" style="padding:18px;text-align:center;color:var(--text-muted)">Aún sin participaciones · espera a que los grupos jueguen</div>`;
    }

    return `<div class="comp-ranking-list">
        ${rows.slice(0, 6).map((r, i) => `
            <div class="comp-ranking-row">
                <div style="font-weight:700;color:var(--accent-cyan-text)">${i + 1}°</div>
                <div>${typeof _displayGrupoLabel === "function" ? _displayGrupoLabel(r.key, 22) : r.key}</div>
                <div class="x-mono-sm">${r.puntaje} pts</div>
            </div>
        `).join("")}
    </div>`;
}

// ── Ranking destacado (profesor intra): agrega aciertos por alumno entre todos
// los torneos intragrupales creados por este profesor (abiertos + finalizados).
// Acumula partidas en vivo cuando el ranking aún no se persistió.
function _renderRankingDestacadoProfIntra(uid) {
    if (typeof TorneosIntraData === "undefined") {
        return `<div class="x-empty" style="padding:18px;text-align:center;color:var(--text-muted)">Sin datos intra</div>`;
    }
    const torneos = TorneosIntraData.getAll().filter(t => {
        if (t.creadoPor !== uid) return false;
        const e = TorneosIntraData.derivarEstado(t);
        return e === "abierto" || e === "finalizada";
    });
    if (torneos.length === 0) {
        return `<div class="x-empty" style="padding:18px;text-align:center;color:var(--text-muted)">Sin torneos intra activos/finalizados todavía</div>`;
    }
    const grupos = (typeof DEMO_GRUPOS !== "undefined" ? DEMO_GRUPOS : []);
    const users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []);

    const acumPorAlumno = {};
    torneos.forEach(t => {
        const miembros = grupos.find(g => g.id === t.grupoId)?.miembros || [];
        let ranking;
        if (t.cerradoEn && t.ranking && t.ranking.length > 0) {
            ranking = t.ranking;
        } else {
            const partidas = TorneosIntraData.getPartidasTorneo(t.id);
            ranking = TorneosIntraData.computarRanking(t, partidas, miembros);
        }
        ranking.forEach(r => {
            if (!r.uid) return;
            acumPorAlumno[r.uid] = (acumPorAlumno[r.uid] || 0) + (r.aciertos || 0);
        });
    });

    const rows = Object.keys(acumPorAlumno)
        .map(k => ({ key: k, aciertos: acumPorAlumno[k] }))
        .sort((a, b) => b.aciertos - a.aciertos);

    if (rows.length === 0 || rows.every(r => r.aciertos === 0)) {
        return `<div class="x-empty" style="padding:18px;text-align:center;color:var(--text-muted)">Nadie ha jugado todavía</div>`;
    }

    return `<div class="comp-ranking-list">
        ${rows.slice(0, 6).map((r, i) => {
            const u = users.find(x => x.id === r.key);
            const nombre = u ? (u.nombre || r.key) : r.key;
            const nombreEsc = String(nombre).replace(/</g, "&lt;");
            return `
            <div class="comp-ranking-row">
                <div style="font-weight:700;color:var(--accent-cyan-text)">${i + 1}°</div>
                <div>${nombreEsc}</div>
                <div class="x-mono-sm">${r.aciertos} ac</div>
            </div>`;
        }).join("")}
    </div>`;
}

window.buildCompetenciasProfesor = buildCompetenciasProfesor;

document.addEventListener("xahni:torneoActualizado", () => {
    const panel = document.getElementById("prof-hub-grupo-tab-competencias");
    if (panel && panel.offsetParent !== null) buildCompetenciasProfesor();
});
document.addEventListener("xahni:torneoTerminado", () => {
    const panel = document.getElementById("prof-hub-grupo-tab-competencias");
    if (panel && panel.offsetParent !== null) buildCompetenciasProfesor();
});
document.addEventListener("xahni:torneoCreado", () => {
    const panel = document.getElementById("prof-hub-grupo-tab-competencias");
    if (panel && panel.offsetParent !== null) buildCompetenciasProfesor();
});

// Wiring hub-grupo dispatch — sustituye el render del sprint legacy
// El tab profHubGrupoSwitchTab('competencias') llama window.profHubRenderCompetencias.
window.profHubRenderCompetencias = function () {
    buildCompetenciasProfesor();
};
