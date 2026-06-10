let _PROF_EXA_FILTRO = "todos";  // "todos" | "activa" | "pendiente" | "cerrado" | "borrador"

function buildExamenesProf(panelId, materiaId) {
    if (typeof ExamenesData === "undefined") return;
    const panel = document.getElementById(panelId || "prof-hub-mat-panel-examenes");
    if (!panel) return;
    if (APP?.user?.tipo !== "profesor" && APP?.user?.tipo !== "administrador") return;
    const uid = APP.user.id;

    const mios = ExamenesData.listarMisExamenes(uid, materiaId);
    const now = new Date();
    const stats = ExamenesData.statsHeroProfesor(uid, materiaId);

    // Categorizar por estado actual
    const porEstado = { activos: [], pendientes: [], cerrados: [], borradores: [] };
    mios.forEach(ex => {
        const estado = ExamenesData.derivarEstado(ex);
        const tienePendientes = _tienePendientesCalificar(ex);
        if (estado === "borrador") {
            porEstado.borradores.push(ex);
        } else if (tienePendientes) {
            // Fix UX 2026-06-06: abiertos Y cerrados con abiertas pendientes
            // van a "Pendientes de calificar" (warn highlight) para no ocultar
            // trabajo pendiente del profesor cuando el examen sigue abierto.
            porEstado.pendientes.push(ex);
        } else if (estado === "abierto") {
            porEstado.activos.push(ex);
        } else if (estado === "cerrado") {
            porEstado.cerrados.push(ex);
        }
    });

    const counts = {
        todos: mios.length,
        activa: porEstado.activos.length,
        pendiente: porEstado.pendientes.length,
        cerrado: porEstado.cerrados.length,
        borrador: porEstado.borradores.length
    };

    const matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
        .find(m => m.id === materiaId)?.nombre || materiaId || "";

    panel.innerHTML = `
        <div class="x-page-head">
            <div>
                <div class="x-page-head__title">Mis <em>exámenes creados</em></div>
                <div class="x-page-head__subtitle">Tú creas · tú evalúas · alimentas la maestría de tu grupo</div>
            </div>
            <div class="x-page-head__actions">
                <button class="x-btn x-btn--primary" onclick="ExamenesProf.crear('${materiaId || ''}')">＋ Crear examen</button>
            </div>
        </div>

        <!-- Stats hero 4 cards creator-economy -->
        <div class="x-card" style="margin-bottom:18px;padding:22px;position:relative;overflow:hidden">
            <div aria-hidden="true" style="position:absolute;inset:0;background:linear-gradient(135deg,var(--xahni-cyan-dim) 0%,transparent 35%,transparent 65%,var(--xahni-amber-dim) 100%);opacity:0.4;pointer-events:none"></div>
            <div style="position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:24px">
                <div class="juegos-stub-stat">
                    <div class="juegos-stub-stat__icon" style="color:var(--accent-cyan-text)">🎓</div>
                    <div class="x-stat__label">Exámenes creados</div>
                    <div class="x-mono-sm" style="font-size:24px;color:var(--text-primary);font-weight:700">${stats.creados}</div>
                </div>
                <div class="juegos-stub-stat">
                    <div class="juegos-stub-stat__icon" style="color:var(--state-info)">📝</div>
                    <div class="x-stat__label">Respuestas recibidas</div>
                    <div class="x-mono-sm" style="font-size:24px;color:var(--text-primary);font-weight:700">${stats.respuestasRecibidas}</div>
                </div>
                <div class="juegos-stub-stat">
                    <div class="juegos-stub-stat__icon" style="color:${stats.pendientes > 0 ? 'var(--state-warn)' : 'var(--text-muted)'}">⏳</div>
                    <div class="x-stat__label">Pendientes calificar</div>
                    <div class="x-mono-sm" style="font-size:24px;color:${stats.pendientes > 0 ? 'var(--state-warn)' : 'var(--text-primary)'};font-weight:700">${stats.pendientes}</div>
                </div>
                <div class="juegos-stub-stat">
                    <div class="juegos-stub-stat__icon" style="color:var(--xahni-amber)">📊</div>
                    <div class="x-stat__label">Mastery distribuida</div>
                    <div class="x-mono-sm" style="font-size:24px;background:linear-gradient(90deg,var(--xahni-amber),var(--xahni-purple));-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:700">${stats.masteryDistribuida.toLocaleString()}</div>
                </div>
            </div>
        </div>

        <!-- Filter chips -->
        <div class="comp-filter-chips" style="margin-bottom:18px">
            ${_renderFilterChipProf("todos", "Todos", counts.todos)}
            ${_renderFilterChipProf("activa", "Activos", counts.activa)}
            ${_renderFilterChipProf("pendiente", "Pendientes", counts.pendiente)}
            ${_renderFilterChipProf("cerrado", "Cerrados", counts.cerrado)}
            ${_renderFilterChipProf("borrador", "Borradores", counts.borrador)}
        </div>

        <!-- 4 secciones (si _PROF_EXA_FILTRO === 'todos' o el filtro match) -->
        ${_renderSeccion("Activos", porEstado.activos, "activa", materiaId, now)}
        ${_renderSeccion("Pendientes de calificar", porEstado.pendientes, "pendiente", materiaId, now)}
        ${_renderSeccion("Cerrados", porEstado.cerrados, "cerrado", materiaId, now)}
        ${_renderSeccion("Borradores", porEstado.borradores, "borrador", materiaId, now)}
    `;
}

function _tienePendientesCalificar(ex) {
    const abiertasIds = (ex.preguntas || []).filter(p => p.tipo === "abierta").map(p => p.id);
    if (abiertasIds.length === 0) return false;
    const users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []).filter(u => u.tipo === "estudiante");
    return users.some(u => {
        const resp = ExamenesData.getRespuestas(ex.id, u.id);
        if (!resp) return false;
        const calif = ExamenesData.getCalificacion(ex.id, u.id) || { abiertas: [] };
        const calificadas = (calif.abiertas || []).map(a => a.pregId);
        return abiertasIds.some(aid => !calificadas.includes(aid));
    });
}

function _renderFilterChipProf(value, label, count) {
    const active = _PROF_EXA_FILTRO === value;
    return `<span class="x-chip ${active ? "x-chip--active" : ""}" onclick="examenesProfSetFiltro('${value}')">${label} · ${count}</span>`;
}

function examenesProfSetFiltro(filtro) {
    _PROF_EXA_FILTRO = filtro;
    const matId = APP?.profHubMatActivo?.matId || null;
    buildExamenesProf("prof-hub-mat-panel-examenes", matId);
}
window.examenesProfSetFiltro = examenesProfSetFiltro;

function _renderSeccion(titulo, examenes, estado, materiaId, now) {
    // Si filtro activo no match con esta sección y filtro no es 'todos', omitir
    if (_PROF_EXA_FILTRO !== "todos" && _PROF_EXA_FILTRO !== estado) return "";
    if (examenes.length === 0) return "";
    return `
        <div class="exa-section">
            <div class="exa-section__head">
                <span class="exa-section__title">${titulo}</span>
                <span class="exa-section__count">${examenes.length}</span>
            </div>
            <div class="exa-grid">
                ${examenes.map(ex => _renderCardProf(ex, estado, now)).join("")}
            </div>
        </div>
    `;
}

function _renderCardProf(ex, estado, now) {
    const titEsc = (ex.nombre || "").replace(/</g, "&lt;");
    const matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
        .find(m => m.id === ex.materiaId)?.nombre || ex.materiaId;
    const tipoCounts = _resumenTiposProf(ex);
    const respuestasCount = _countRespuestas(ex);

    if (estado === "activa") {
        return `
            <article class="exa-card activa--prof" onclick="ExamenesProf.analytics('${ex.id}')">
                <div class="exa-card__head">
                    <div>
                        <div class="exa-card__title">${titEsc}</div>
                        <div class="exa-card__meta">${matNom} · ${ex.parcial} · ${(ex.preguntas || []).length} preguntas (${tipoCounts}) · Mastery max ${ex.masteryMax || 80}</div>
                    </div>
                    <span class="x-chip x-chip--ok" style="font-size:10px">🟢 ABIERTO · ${respuestasCount} respondieron</span>
                </div>
                <div class="exa-card__actions">
                    <button class="x-btn x-btn--ghost x-btn--danger" style="font-size:11px;padding:4px 10px" onclick="event.stopPropagation();ExamenesProf.cerrar('${ex.id}')">Cerrar examen</button>
                    <button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 10px" onclick="event.stopPropagation();ExamenesProf.analytics('${ex.id}')">Ver analytics →</button>
                </div>
            </article>
        `;
    }

    if (estado === "pendiente") {
        const pendientesCount = _countPendientesAbiertas(ex);
        // Fix UX 2026-06-06: detectar si el examen sigue ABIERTO o ya está cerrado
        // para decidir el chip + acciones. Si abierto, mostrar también botón [Cerrar examen].
        const estadoReal = ExamenesData.derivarEstado(ex);
        const sigueAbierto = estadoReal === "abierto";
        const chipText = sigueAbierto
            ? `🟢 ABIERTO · ⚠️ ${pendientesCount} abiertas pendientes`
            : `⚠️ PENDIENTE · ${pendientesCount} abiertas`;
        return `
            <article class="exa-card pendiente" onclick="ExamenesProf.calificar('${ex.id}')">
                <div class="exa-card__head">
                    <div>
                        <div class="exa-card__title">${titEsc}</div>
                        <div class="exa-card__meta">${matNom} · ${ex.parcial}${sigueAbierto ? ` · ${respuestasCount} respondieron` : ` · cerrado ${_fmtFechaProf(ex.cerradoEn)}`}</div>
                    </div>
                    <span class="x-chip x-chip--warn" style="font-size:10px">${chipText}</span>
                </div>
                <div class="exa-card__actions">
                    <button class="x-btn x-btn--primary" style="font-size:11px;padding:4px 10px" onclick="event.stopPropagation();ExamenesProf.calificar('${ex.id}')">Calificar ahora →</button>
                    ${sigueAbierto ? `<button class="x-btn x-btn--ghost x-btn--danger" style="font-size:11px;padding:4px 10px" onclick="event.stopPropagation();ExamenesProf.cerrar('${ex.id}')">Cerrar examen</button>` : ""}
                    <button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 10px" onclick="event.stopPropagation();ExamenesProf.analytics('${ex.id}')">Ver analytics →</button>
                </div>
            </article>
        `;
    }

    if (estado === "cerrado") {
        const promedio = _calcPromedio(ex);
        return `
            <article class="exa-card cerrado" onclick="ExamenesProf.analytics('${ex.id}')">
                <div class="exa-card__head">
                    <div>
                        <div class="exa-card__title">${titEsc}</div>
                        <div class="exa-card__meta">${matNom} · ${ex.parcial} · cerrado ${_fmtFechaProf(ex.cerradoEn)}</div>
                    </div>
                    <span class="x-chip x-chip--muted" style="font-size:10px">🔒 ${respuestasCount} alumnos · ${promedio.toFixed(1)}/10</span>
                </div>
                <div class="exa-card__cta">Ver analytics →</div>
            </article>
        `;
    }

    // borrador
    return `
        <article class="exa-card borrador" style="cursor:default">
            <div class="exa-card__head">
                <div>
                    <div class="exa-card__title">${titEsc}</div>
                    <div class="exa-card__meta">${matNom} · ${ex.parcial} · ${(ex.preguntas || []).length} preguntas</div>
                </div>
                <span class="x-chip x-chip--muted" style="font-size:10px">📝 BORRADOR</span>
            </div>
            <div class="exa-card__actions">
                <button class="x-btn x-btn--primary" style="font-size:11px;padding:4px 10px" onclick="ExamenesProf.abrir('${ex.id}')">Abrir ahora</button>
                <button class="x-btn x-btn--ghost" style="font-size:11px;padding:4px 10px" onclick="ExamenesProf.editar('${ex.id}')">Editar →</button>
                <button class="x-btn x-btn--ghost x-btn--danger" style="font-size:11px;padding:4px 10px" onclick="ExamenesProf.eliminar('${ex.id}')">Eliminar</button>
            </div>
        </article>
    `;
}

function _resumenTiposProf(ex) {
    const counts = { multi: 0, abierta: 0, match: 0 };
    (ex.preguntas || []).forEach(p => { counts[p.tipo] = (counts[p.tipo] || 0) + 1; });
    const parts = [];
    if (counts.multi > 0) parts.push(`${counts.multi}m`);
    if (counts.abierta > 0) parts.push(`${counts.abierta}a`);
    if (counts.match > 0) parts.push(`${counts.match}match`);
    return parts.join("·");
}

function _countRespuestas(ex) {
    const users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []).filter(u => u.tipo === "estudiante");
    return users.filter(u => ExamenesData.getRespuestas(ex.id, u.id) !== null).length;
}

function _countPendientesAbiertas(ex) {
    const abiertasIds = (ex.preguntas || []).filter(p => p.tipo === "abierta").map(p => p.id);
    if (abiertasIds.length === 0) return 0;
    const users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []).filter(u => u.tipo === "estudiante");
    let count = 0;
    users.forEach(u => {
        const resp = ExamenesData.getRespuestas(ex.id, u.id);
        if (!resp) return;
        const calif = ExamenesData.getCalificacion(ex.id, u.id) || { abiertas: [] };
        const calificadas = (calif.abiertas || []).map(a => a.pregId);
        count += abiertasIds.filter(aid => !calificadas.includes(aid)).length;
    });
    return count;
}

function _calcPromedio(ex) {
    const users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []).filter(u => u.tipo === "estudiante");
    let sumC = 0;
    let count = 0;
    users.forEach(u => {
        const calif = ExamenesData.getCalificacion(ex.id, u.id);
        if (calif && calif.califFinal !== null && calif.califFinal !== undefined) {
            sumC += calif.califFinal;
            count++;
        }
    });
    return count > 0 ? sumC / count : 0;
}

function _fmtFechaProf(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

// Public namespace
const ExamenesProf = {
    crear(materiaId) {
        if (typeof CrearExamen === "object" && typeof CrearExamen.abrir === "function") {
            CrearExamen.abrir(materiaId);
        } else if (typeof showToast === "function") {
            showToast("Wizard crear examen — pendiente E6", "info");
        }
    },
    abrir(exId) {
        // Borrador → abierto, sin confirmación (no destructivo)
        ExamenesData.toggleEstado(exId, "abierto");
    },
    cerrar(exId) {
        if (typeof confirmarCanonico === "function") {
            confirmarCanonico({
                icono: "🔒",
                titulo: "Cerrar examen ahora",
                mensaje: "Los alumnos que no hayan tomado el examen NO podrán hacerlo después.",
                accionTexto: "Cerrar",
                tipo: "danger"
            }).then(confirmed => {
                if (confirmed) ExamenesData.toggleEstado(exId, "cerrado");
            });
        } else if (confirm("Cerrar examen ahora — los alumnos que no hayan tomado NO podrán hacerlo después")) {
            ExamenesData.toggleEstado(exId, "cerrado");
        }
    },
    calificar(exId) {
        if (typeof CalificarExamen === "object" && typeof CalificarExamen.abrir === "function") {
            CalificarExamen.abrir(exId);
        } else if (typeof showToast === "function") {
            showToast("Dashboard calificar — pendiente E5", "info");
        }
    },
    analytics(exId) {
        if (typeof AnalyticsExamen === "object" && typeof AnalyticsExamen.abrir === "function") {
            AnalyticsExamen.abrir(exId, { contexto: "profesor" });
        } else if (typeof showToast === "function") {
            showToast("Analytics — pendiente E7", "info");
        }
    },
    detalleByAlumno(exId) {
        if (typeof AnalyticsExamen === "object" && typeof AnalyticsExamen.abrir === "function") {
            AnalyticsExamen.abrir(exId, { contexto: "profesor", tab: "alumno" });
        }
    },
    editar(exId) {
        if (typeof CrearExamen === "object" && typeof CrearExamen.abrir === "function") {
            CrearExamen.abrir(null, { editarId: exId });
        } else if (typeof showToast === "function") {
            showToast("Editar (wizard) — pendiente E6", "info");
        }
    },
    eliminar(exId) {
        if (typeof confirmarCanonico === "function") {
            confirmarCanonico({
                icono: "🗑️",
                titulo: "Eliminar borrador",
                mensaje: "El borrador se eliminará permanentemente.",
                accionTexto: "Eliminar",
                tipo: "danger"
            }).then(confirmed => {
                if (confirmed && ExamenesData.eliminarBorrador(exId)) {
                    if (typeof showToast === "function") showToast("✓ Borrador eliminado", "ok");
                    const matId = APP?.profHubMatActivo?.matId || null;
                    buildExamenesProf("prof-hub-mat-panel-examenes", matId);
                }
            });
        }
    }
};
window.ExamenesProf = ExamenesProf;
window.buildExamenesProf = buildExamenesProf;

// Hook reasignado (sustituye stub E0)
window.profHubMatRenderExamenes = function(panelId, matId) {
    buildExamenesProf(panelId, matId);
};

// Reactive listeners
document.addEventListener("xahni:examenAbierto", () => {
    const panel = document.getElementById("prof-hub-mat-panel-examenes");
    if (panel && panel.offsetParent !== null) {
        buildExamenesProf("prof-hub-mat-panel-examenes", APP?.profHubMatActivo?.matId || null);
    }
});
document.addEventListener("xahni:examenCerrado", () => {
    const panel = document.getElementById("prof-hub-mat-panel-examenes");
    if (panel && panel.offsetParent !== null) {
        buildExamenesProf("prof-hub-mat-panel-examenes", APP?.profHubMatActivo?.matId || null);
    }
});
document.addEventListener("xahni:examenTomado", () => {
    const panel = document.getElementById("prof-hub-mat-panel-examenes");
    if (panel && panel.offsetParent !== null) {
        buildExamenesProf("prof-hub-mat-panel-examenes", APP?.profHubMatActivo?.matId || null);
    }
});
document.addEventListener("xahni:examenCalificado", () => {
    const panel = document.getElementById("prof-hub-mat-panel-examenes");
    if (panel && panel.offsetParent !== null) {
        buildExamenesProf("prof-hub-mat-panel-examenes", APP?.profHubMatActivo?.matId || null);
    }
});
