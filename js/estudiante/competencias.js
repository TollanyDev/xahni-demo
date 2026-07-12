// js/estudiante/competencias.js
// Slice Competencias beta C2 · 2026-06-06 · spec §5
// S3 torneos intra 2026-06-09: tab interno Intra|Inter + stats hero per-tab.
//
// Renderer panel top-level Competencias estudiante. Lee CompetenciasData.
// Compone: stats hero (per-tab) + tab Intra|Inter + grid + ranking + historial.

let _COMP_FILTRO_ACTUAL = "todos";  // "todos" | "activa" | "proxima" | "finalizada"
let _EST_COMP_MODO = "inter";        // "inter" | "intra" — S3 torneos intra
// (Toggle "Por grupo / Por carrera" eliminado 2026-06-09: el tab Intra/Inter
//  ya filtra el contexto y el toggle resultaba redundante.)

function buildCompetencias() {
    if (typeof CompetenciasData === "undefined") return;
    const panel = document.getElementById("hub-grupo-tab-competencias");
    if (!panel) return;
    if (APP?.user?.tipo !== "estudiante") return;
    const uid = APP.user.id;

    const torneos = CompetenciasData.listarTorneosMiGrupo(uid);
    const now = new Date();

    // Stats hero per-tab: inter usa CompetenciasData.statsHeroEstudiante, intra usa EstudianteTorneosIntra._statsHeroIntraAlumno
    const stats = _EST_COMP_MODO === "intra" && typeof EstudianteTorneosIntra !== "undefined"
        ? EstudianteTorneosIntra._statsHeroIntraAlumno(uid)
        : CompetenciasData.statsHeroEstudiante(uid);

    // Filter chips counts (solo aplica a inter)
    const counts = { todos: torneos.length, activa: 0, proxima: 0, finalizada: 0 };
    torneos.forEach(c => {
        const e = CompetenciasData.derivarEstado(c, now);
        counts[e] = (counts[e] || 0) + 1;
    });

    const filtradas = _COMP_FILTRO_ACTUAL === "todos"
        ? torneos
        : torneos.filter(c => CompetenciasData.derivarEstado(c, now) === _COMP_FILTRO_ACTUAL);

    // Stats hero HTML — diferente entre inter e intra
    let statsHeroHtml;
    if (_EST_COMP_MODO === "intra") {
        statsHeroHtml = `
        <div class="x-card" style="margin-bottom:18px;padding:22px">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:18px">
                <div class="juegos-stub-stat">
                    <div class="juegos-stub-stat__icon" style="color:var(--state-ok)">🏅</div>
                    <div class="x-stat__label">Torneos del grupo</div>
                    <div class="x-mono-sm" style="font-size:22px;color:var(--text-primary);font-weight:700">${stats.totalTorneos}</div>
                </div>
                <div class="juegos-stub-stat">
                    <div class="juegos-stub-stat__icon" style="color:var(--accent-cyan-text)">🎮</div>
                    <div class="x-stat__label">Participé en</div>
                    <div class="x-mono-sm" style="font-size:22px;color:var(--text-primary);font-weight:700">${stats.participados}</div>
                </div>
                <div class="juegos-stub-stat">
                    <div class="juegos-stub-stat__icon" style="color:var(--xahni-amber)">⭐</div>
                    <div class="x-stat__label">Mi mejor lugar</div>
                    <div class="x-mono-sm" style="font-size:22px;color:var(--text-primary);font-weight:700">${stats.mejorLugar ? stats.mejorLugar + "°" : "—"}</div>
                </div>
                <div class="juegos-stub-stat">
                    <div class="juegos-stub-stat__icon" style="color:var(--state-ok)">✨</div>
                    <div class="x-stat__label">XP ganada intra</div>
                    <div class="x-mono-sm" style="font-size:22px;color:var(--text-primary);font-weight:700">${stats.xpGanada > 0 ? "+" + stats.xpGanada : "—"}</div>
                </div>
            </div>
        </div>`;
    } else {
        statsHeroHtml = `
        <div class="x-card" style="margin-bottom:18px;padding:22px">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:18px">
                <div class="juegos-stub-stat">
                    <div class="juegos-stub-stat__icon" style="color:var(--state-ok)">🏆</div>
                    <div class="x-stat__label">Activos</div>
                    <div class="x-mono-sm" style="font-size:22px;color:var(--text-primary);font-weight:700">${stats.activos}</div>
                </div>
                <div class="juegos-stub-stat">
                    <div class="juegos-stub-stat__icon" style="color:var(--state-warn)">📅</div>
                    <div class="x-stat__label">Próximos</div>
                    <div class="x-mono-sm" style="font-size:22px;color:var(--text-primary);font-weight:700">${stats.proximos}</div>
                </div>
                <div class="juegos-stub-stat">
                    <div class="juegos-stub-stat__icon" style="color:var(--accent-cyan-text)">✓</div>
                    <div class="x-stat__label">Mis participaciones</div>
                    <div class="x-mono-sm" style="font-size:22px;color:var(--text-primary);font-weight:700">${stats.misParticipaciones}</div>
                </div>
                <div class="juegos-stub-stat">
                    <div class="juegos-stub-stat__icon" style="color:var(--xahni-amber)">⭐</div>
                    <div class="x-stat__label">Mi mejor lugar</div>
                    <div class="x-mono-sm" style="font-size:22px;color:var(--text-primary);font-weight:700">${stats.mejorLugar ? stats.mejorLugar + "°" : "—"}</div>
                </div>
            </div>
        </div>`;
    }

    panel.innerHTML = `
        <div class="x-page-head">
            <div>
                <div class="x-page-head__title">Competencias</div>
                <div class="x-page-head__subtitle">Compite y gana XP · inter-grupos e intra-grupo</div>
            </div>
        </div>

        <!-- Tab interno Intra | Inter — prominente (mismo pattern que profesor S2) -->
        <div style="display:flex;gap:8px;margin-bottom:14px;border-bottom:1px solid var(--border);padding-bottom:12px">
            <span class="x-chip ${_EST_COMP_MODO === 'inter' ? 'x-chip--active' : ''}"
                  onclick="competenciasEstSetModo('inter')"
                  style="font-size:15px;font-weight:600;padding:8px 18px;cursor:pointer;${_EST_COMP_MODO === 'inter' ? 'background:var(--brand-gradient);color:#fff;border-color:transparent;' : ''}">Inter · entre grupos</span>
            <span class="x-chip ${_EST_COMP_MODO === 'intra' ? 'x-chip--active' : ''}"
                  onclick="competenciasEstSetModo('intra')"
                  style="font-size:15px;font-weight:600;padding:8px 18px;cursor:pointer;${_EST_COMP_MODO === 'intra' ? 'background:var(--brand-gradient);color:#fff;border-color:transparent;' : ''}">Intra · dentro del grupo</span>
        </div>

        <!-- Stats hero (per-tab: inter o intra) -->
        ${statsHeroHtml}

        ${_EST_COMP_MODO === 'inter' ? `
        <!-- Filter chips (solo inter) -->
        <div class="comp-filter-chips">
            ${_renderFilterChip("todos", "Todos", counts.todos)}
            ${_renderFilterChip("activa", "Activos", counts.activa)}
            ${_renderFilterChip("proxima", "Próximos", counts.proxima)}
            ${_renderFilterChip("finalizada", "Finalizados", counts.finalizada)}
        </div>

        <!-- Grid torneos intergrupales -->
        <div id="competencias-grid" class="comp-grid">
            ${filtradas.length === 0
                ? `<div class="x-empty" style="grid-column:1/-1;padding:36px;text-align:center;color:var(--text-muted)">
                       <div style="font-size:32px;margin-bottom:8px">🏆</div>
                       <div>No hay torneos en esta categoría.</div>
                   </div>`
                : filtradas.map(c => _renderCompCardAlumno(c, uid, now)).join("")}
        </div>
        ` : `
        <!-- Grid torneos intragrupales (delegado a EstudianteTorneosIntra) -->
        <div class="comp-grid" id="est-comp-intra-grid"></div>
        `}

        <!-- Ranking destacado — espejo en ambos tabs. Sin toggle Por grupo/Por carrera:
             el tab Intra|Inter de arriba ya filtra el contexto. -->
        <div class="comp-ranking-block">
            <div class="x-page-head__title" style="font-size:17px;margin-bottom:10px">
                Ranking destacado ${_EST_COMP_MODO === 'intra' ? '· alumnos de mi grupo' : '· entre grupos'}
            </div>
            <div id="ranking-full">
                ${_EST_COMP_MODO === 'intra' ? _renderRankingDestacadoIntra(uid) : _renderRankingDestacado(uid)}
            </div>
        </div>

        <!-- Mi historial — espejo en ambos tabs -->
        <div class="comp-historial">
            <div class="x-page-head__title" style="font-size:17px;margin-bottom:10px">Mi historial</div>
            <div id="mis-competencias">
                ${_EST_COMP_MODO === 'intra' ? _renderHistorialIntra(uid) : _renderHistorial(uid)}
            </div>
        </div>
    `;

    // Si el modo es intra, delegar render al módulo especializado
    if (_EST_COMP_MODO === 'intra') {
        const intraGrid = document.getElementById("est-comp-intra-grid");
        if (intraGrid && typeof EstudianteTorneosIntra !== "undefined") {
            EstudianteTorneosIntra.renderAlumno(intraGrid);
        }
    }
}

function _renderFilterChip(value, label, count) {
    const active = _COMP_FILTRO_ACTUAL === value;
    return `<span class="x-chip ${active ? "x-chip--active" : ""}" onclick="competenciasSetFiltro('${value}')">${label} · ${count}</span>`;
}

function competenciasSetFiltro(filtro) {
    _COMP_FILTRO_ACTUAL = filtro;
    buildCompetencias();
}
window.competenciasSetFiltro = competenciasSetFiltro;

// S3 torneos intra: switch tab Inter|Intra (análogo a competenciasProfSetModo del profesor)
function competenciasEstSetModo(modo) {
    if (modo !== "inter" && modo !== "intra") return;
    _EST_COMP_MODO = modo;
    buildCompetencias();
}
window.competenciasEstSetModo = competenciasEstSetModo;

function _renderCompCardAlumno(comp, uid, now) {
    const estado = CompetenciasData.derivarEstado(comp, now);
    const ranking = CompetenciasData.calcularRanking(comp);
    const grupoUid = CompetenciasData._grupoIdDeUser(uid);
    const miEntry = ranking.find(r => r.grupoId === grupoUid);
    const attempts = CompetenciasData.getAttempts(comp.id, uid);
    const matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
        .find(m => m.id === comp.materiaId)?.nombre || comp.materiaId;
    const titEsc = (comp.nombre || "").replace(/</g, "&lt;");

    let onclick = "";
    let ctaTexto = "";
    let extraClass = "";
    let chipEstado = "";

    if (estado === "activa") {
        onclick = `onclick="ParticiparTorneo.abrir('${comp.id}')"`;
        ctaTexto = "Participar →";
        chipEstado = `<span class="x-chip x-chip--ok" style="font-size:10px">🟢 ACTIVA</span>`;
    } else if (estado === "proxima") {
        const dias = Math.ceil((new Date(comp.fechaInicio) - now) / 86400000);
        onclick = `onclick="showToast('Aún no inicia · empieza en ${dias} días', 'info')"`;
        ctaTexto = `Empieza en ${dias} días`;
        chipEstado = `<span class="x-chip x-chip--warn" style="font-size:10px">🟡 PRÓXIMA</span>`;
    } else { // finalizada
        onclick = `onclick="DetalleTorneo.abrir('${comp.id}', { contexto: 'estudiante' })"`;
        if (miEntry?.lugar === 1) {
            extraClass = "ganador";
            chipEstado = `<span class="x-chip" style="font-size:10px;background:var(--xahni-amber-dim);color:var(--xahni-amber)">🏆 GANASTE</span>`;
        } else {
            chipEstado = `<span class="x-chip x-chip--muted" style="font-size:10px">FINALIZADA</span>`;
        }
        ctaTexto = `Lugar ${miEntry?.lugar || "—"}° · Ver resultados →`;
    }

    const chipIa = (typeof _compEsIA === "function" && _compEsIA(comp))
        ? `<span class="x-chip-ia" title="Torneo basado en quiz generado por Gemini IA">✨ Gemini</span>`
        : "";
    return `
        <article class="comp-card ${estado} ${extraClass}" ${onclick}>
            <div class="comp-card__head">
                <div>
                    <div class="comp-card__title">${titEsc}</div>
                    <div class="comp-card__meta" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                        <span>${matNom} · ${(comp.tipo || 'quiz').toUpperCase()}</span>
                        ${chipIa}
                    </div>
                </div>
                ${chipEstado}
            </div>
            <div class="comp-card__metrics">
                <div><div class="x-stat__label" style="font-size:9px">Grupos</div><div class="x-mono-sm">${(comp.gruposInscritos || []).length}</div></div>
                <div><div class="x-stat__label" style="font-size:9px">Mi grupo</div><div class="x-mono-sm">${miEntry?.puntaje || 0} pts</div></div>
                ${estado === "activa"
                    ? `<div><div class="x-stat__label" style="font-size:9px">Intentos</div><div class="x-mono-sm">${attempts.length}/${CompetenciasData.MAX_ATTEMPTS}</div></div>`
                    : `<div><div class="x-stat__label" style="font-size:9px">Lugar</div><div class="x-mono-sm">${miEntry?.lugar || "—"}°</div></div>`}
            </div>
            <div class="comp-card__cta">${ctaTexto}</div>
        </article>
    `;
}

function _renderRankingDestacado(uid) {
    // Agrupa puntajes por grupo en torneos activos + finalizados del estudiante.
    // - Activos:    CompetenciasData.calcularRanking (live de attempts).
    // - Finalizados: comp.resultados persistidos al cerrar.
    // Toggle "Por carrera" eliminado 2026-06-09: los tabs Intra|Inter ya filtran
    // el contexto, así que mostrar siempre el agrupado por grupo es más directo.
    const torneos = CompetenciasData.listarTorneosMiGrupo(uid)
        .filter(c => {
            const e = CompetenciasData.derivarEstado(c);
            return e === "activa" || e === "finalizada";
        });
    if (torneos.length === 0) {
        return `<div class="x-empty" style="padding:18px;text-align:center;color:var(--text-muted)">Sin torneos aún · participa para empezar</div>`;
    }
    const acumPorGrupo = {};
    torneos.forEach(c => {
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
    const rows = Object.keys(acumPorGrupo).map(k => ({ key: k, puntaje: acumPorGrupo[k] }))
        .sort((a, b) => b.puntaje - a.puntaje);
    const miKey = CompetenciasData._grupoIdDeUser(uid);

    return `<div class="comp-ranking-list">
        ${rows.slice(0, 6).map((r, i) => `
            <div class="comp-ranking-row ${r.key === miKey ? "comp-ranking-row--mio" : ""}">
                <div style="font-weight:700;color:var(--accent-cyan-text)">${i + 1}°</div>
                <div>${typeof _displayGrupoLabel === "function" ? _displayGrupoLabel(r.key, 22) : r.key} ${r.key === miKey ? "<span class='x-chip x-chip--ok' style='font-size:9px;margin-left:6px'>Mi grupo</span>" : ""}</div>
                <div class="x-mono-sm">${r.puntaje} pts</div>
            </div>
        `).join("")}
    </div>`;
}

// ── Ranking destacado intra: alumnos de mi grupo agregando aciertos en torneos
// intra (abiertos + finalizados). Usa TorneosIntraData.computarRanking para
// torneos abiertos (no tienen ranking persistido hasta cerrar).
function _renderRankingDestacadoIntra(uid) {
    if (typeof TorneosIntraData === "undefined") {
        return `<div class="x-empty" style="padding:18px;text-align:center;color:var(--text-muted)">Sin datos intra</div>`;
    }
    const users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []);
    const miUser = users.find(u => u.id === uid);
    const grupoId = miUser?.grupos?.[0] || null;
    if (!grupoId) {
        return `<div class="x-empty" style="padding:18px;text-align:center;color:var(--text-muted)">Sin grupo asignado</div>`;
    }
    const grupos = (typeof DEMO_GRUPOS !== "undefined" ? DEMO_GRUPOS : []);
    const miembros = grupos.find(g => g.id === grupoId)?.miembros || [];

    const torneos = TorneosIntraData.getAll().filter(t => {
        if (t.grupoId !== grupoId) return false;
        const e = TorneosIntraData.derivarEstado(t);
        return e === "abierto" || e === "finalizada";
    });
    if (torneos.length === 0) {
        return `<div class="x-empty" style="padding:18px;text-align:center;color:var(--text-muted)">Sin torneos intra todavía · espera al primero del grupo</div>`;
    }

    // Acumular aciertos por alumno (suma del mejor de cada torneo).
    const acumPorAlumno = {};
    torneos.forEach(t => {
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
        return `<div class="x-empty" style="padding:18px;text-align:center;color:var(--text-muted)">Nadie ha jugado todavía · sé el primero</div>`;
    }

    return `<div class="comp-ranking-list">
        ${rows.slice(0, 6).map((r, i) => {
            const u = users.find(x => x.id === r.key);
            const nombre = u ? (u.nombre || r.key) : r.key;
            const nombreEsc = String(nombre).replace(/</g, "&lt;");
            const esMio = r.key === uid;
            return `
            <div class="comp-ranking-row ${esMio ? "comp-ranking-row--mio" : ""}">
                <div style="font-weight:700;color:var(--accent-cyan-text)">${i + 1}°</div>
                <div>${nombreEsc} ${esMio ? "<span class='x-chip x-chip--ok' style='font-size:9px;margin-left:6px'>yo</span>" : ""}</div>
                <div class="x-mono-sm">${r.aciertos} ac</div>
            </div>`;
        }).join("")}
    </div>`;
}

function _renderHistorial(uid) {
    const torneos = CompetenciasData.listarTorneosMiGrupo(uid)
        .filter(c => CompetenciasData.derivarEstado(c) === "finalizada")
        .sort((a, b) => new Date(b.fechaFin) - new Date(a.fechaFin));
    if (torneos.length === 0) {
        return `<div class="x-empty" style="padding:18px;text-align:center;color:var(--text-muted)">Sin torneos finalizados todavía</div>`;
    }
    const grupoUid = CompetenciasData._grupoIdDeUser(uid);
    return torneos.slice(0, 8).map(c => {
        const r = c.resultados?.[grupoUid];
        const xp = r ? CompetenciasData.xpPorLugar(r.lugar) : 0;
        const fecha = new Date(c.fechaFin).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
        const lugarChip = r?.lugar === 1 ? "🏆" : "";
        return `<div class="comp-historial-row">
            <div class="comp-historial-row__fecha">${fecha}</div>
            <div class="comp-historial-row__nombre">${lugarChip} ${(c.nombre || "").replace(/</g, "&lt;")}</div>
            <div class="comp-historial-row__resultado">${r?.lugar || "—"}° · +${xp} XP</div>
        </div>`;
    }).join("");
}

// ── Historial intra: torneos intragrupales finalizados de mi grupo con mi
// lugar + XP ganada (vía TorneosIntraData.getXpDistribucion).
function _renderHistorialIntra(uid) {
    if (typeof TorneosIntraData === "undefined") {
        return `<div class="x-empty" style="padding:18px;text-align:center;color:var(--text-muted)">Sin datos intra</div>`;
    }
    const users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []);
    const miUser = users.find(u => u.id === uid);
    const grupoId = miUser?.grupos?.[0] || null;
    if (!grupoId) {
        return `<div class="x-empty" style="padding:18px;text-align:center;color:var(--text-muted)">Sin grupo asignado</div>`;
    }
    const materias = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : []);
    const torneos = TorneosIntraData.getAll()
        .filter(t => t.grupoId === grupoId && TorneosIntraData.derivarEstado(t) === "finalizada")
        .sort((a, b) => (b.cerradoEn || 0) - (a.cerradoEn || 0));
    if (torneos.length === 0) {
        return `<div class="x-empty" style="padding:18px;text-align:center;color:var(--text-muted)">Sin torneos intra finalizados todavía</div>`;
    }
    return torneos.slice(0, 8).map(t => {
        const matNom = materias.find(m => m.id === t.materiaId)?.nombre || t.materiaId;
        const tituloRaw = (t.nombre && t.nombre.trim()) ? t.nombre.trim() : ("Torneo intra · " + matNom);
        const tituloEsc = String(tituloRaw).replace(/</g, "&lt;");
        const miRow = (t.ranking || []).find(r => r.uid === uid);
        const fechaMs = t.cerradoEn || 0;
        const fecha = fechaMs ? new Date(fechaMs).toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) : "—";
        let lugarLabel = "—";
        let xp = 0;
        if (miRow && miRow.jugo) {
            lugarLabel = miRow.lugar + "°";
            const xpDist = TorneosIntraData.getXpDistribucion(t.ranking || [], TorneosIntraData.XP_BASE_DEFAULT);
            xp = xpDist[uid] || 0;
        }
        const lugarChip = miRow?.lugar === 1 ? "🏆" : "";
        return `<div class="comp-historial-row">
            <div class="comp-historial-row__fecha">${fecha}</div>
            <div class="comp-historial-row__nombre">${lugarChip} ${tituloEsc}</div>
            <div class="comp-historial-row__resultado">${lugarLabel} · +${xp} XP</div>
        </div>`;
    }).join("");
}

window.buildCompetencias = buildCompetencias;

// Re-render reactivo
document.addEventListener("xahni:torneoActualizado", () => {
    const panel = document.getElementById("hub-grupo-tab-competencias");
    if (panel && panel.offsetParent !== null) buildCompetencias();
});
document.addEventListener("xahni:torneoTerminado", () => {
    const panel = document.getElementById("hub-grupo-tab-competencias");
    if (panel && panel.offsetParent !== null) buildCompetencias();
});
// S3: re-render cuando se crea o termina un torneo intragrupal
document.addEventListener("xahni:torneoIntraCreado", () => {
    const panel = document.getElementById("hub-grupo-tab-competencias");
    if (panel && panel.offsetParent !== null && _EST_COMP_MODO === "intra") buildCompetencias();
});
document.addEventListener("xahni:torneoIntraTerminado", () => {
    const panel = document.getElementById("hub-grupo-tab-competencias");
    if (panel && panel.offsetParent !== null) buildCompetencias();
});

// Wiring hub-grupo dispatch — sustituye buildAlumnoCompetenciasPanel del sprint legacy
// El tab hubGrupoSwitchTab('competencias') llama window.hubGrupoRenderCompetencias.
window.hubGrupoRenderCompetencias = function () {
    buildCompetencias();
};
