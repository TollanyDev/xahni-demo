// js/estudiante/examenes-est.js
// Slice Examenes beta E2 · 2026-06-06 · spec §5
//
// Builder del panel Examenes para estudiante. Renderea a #hub-panel-examenes
// (anidado en aprendizaje shell). 2 secciones: Por tomar / Pasados.

function buildExamenesEst(materiaId) {
    if (typeof ExamenesData === "undefined") return;
    const panel = document.getElementById("hub-panel-examenes");
    if (!panel) return;
    if (APP?.user?.tipo !== "estudiante") return;
    const uid = APP.user.id;

    const matId = materiaId || (typeof hubMateriaActiva !== "undefined" && hubMateriaActiva ? hubMateriaActiva.id : null);
    if (!matId) return;

    const porTomar = ExamenesData.listarExamenesPorTomar(uid, matId);
    const pasados = ExamenesData.listarExamenesPasados(uid, matId);

    const matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
        .find(m => m.id === matId)?.nombre || matId;

    panel.innerHTML = `
        <div class="x-page-head">
            <div>
                <div class="x-page-head__title">Mis <em>exámenes</em></div>
                <div class="x-page-head__subtitle">Tú tomas · tu profe corrige · alimentan tu maestría por materia</div>
            </div>
            <div class="x-page-head__actions">
                <span class="x-chip x-chip--info" style="display:inline-flex;align-items:center;gap:6px">
                    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M3 2h7l3 3v9H3z"/><path d="M10 2v3h3"/><path d="M5.5 8h5M5.5 11h3"/>
                    </svg>
                    Solo profesor + admin crean
                </span>
            </div>
        </div>

        <!-- Banner 3 tipos pregunta (chrome canónico) -->
        <div class="x-card" style="margin-bottom:18px;padding:20px;position:relative;overflow:hidden">
            <div aria-hidden="true" style="position:absolute;inset:0;background:linear-gradient(135deg,var(--xahni-blue-dim) 0%,transparent 40%,transparent 60%,var(--xahni-teal-dim) 100%);opacity:0.35;pointer-events:none"></div>
            <header style="position:relative;display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
                <span style="font-family:var(--font-display);font-size:16px;font-weight:600;color:var(--text-primary)">3 tipos de pregunta · combinables en un mismo examen</span>
            </header>
            <div style="position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px">
                <div class="examenes-stub-tipo">
                    <div class="examenes-stub-tipo__title" style="color:var(--accent-cyan-text);font-weight:600">Opción múltiple</div>
                    <div class="examenes-stub-tipo__desc" style="font-size:12px;color:var(--text-secondary);margin-top:4px">Marcas una respuesta entre varias. El sistema corrige al instante.</div>
                </div>
                <div class="examenes-stub-tipo">
                    <div class="examenes-stub-tipo__title" style="color:var(--xahni-amber);font-weight:600">Respuesta abierta</div>
                    <div class="examenes-stub-tipo__desc" style="font-size:12px;color:var(--text-secondary);margin-top:4px">Escribes tu respuesta. Tu profe la revisa y te pone nota — puede tardar.</div>
                </div>
                <div class="examenes-stub-tipo">
                    <div class="examenes-stub-tipo__title" style="color:var(--xahni-teal);font-weight:600">Concepto ↔ Definición</div>
                    <div class="examenes-stub-tipo__desc" style="font-size:12px;color:var(--text-secondary);margin-top:4px">Emparejas conceptos con sus definiciones. Cada par correcto suma.</div>
                </div>
            </div>
        </div>

        <!-- Sección Por tomar -->
        <div class="exa-section">
            <div class="exa-section__head">
                <span class="exa-section__title">Por tomar</span>
                <span class="exa-section__count">${porTomar.length} abierto${porTomar.length === 1 ? "" : "s"}</span>
            </div>
            <div class="exa-grid">
                ${porTomar.length === 0
                    ? `<div class="x-empty" style="grid-column:1/-1;padding:36px;text-align:center;color:var(--text-muted)">No hay exámenes por tomar ahora mismo · tu profesor te avisará cuando abra uno</div>`
                    : porTomar.map(ex => _renderCardActiva(ex)).join("")}
            </div>
        </div>

        <!-- Sección Pasados -->
        <div class="exa-section">
            <div class="exa-section__head">
                <span class="exa-section__title">Pasados</span>
                <span class="exa-section__count">${pasados.length} tomado${pasados.length === 1 ? "" : "s"}</span>
            </div>
            <div class="exa-grid">
                ${pasados.length === 0
                    ? `<div class="x-empty" style="grid-column:1/-1;padding:36px;text-align:center;color:var(--text-muted)">Aún no has tomado exámenes · cuando lo hagas aparecerán aquí con tu calificación</div>`
                    : pasados.map(ex => _renderCardPasado(ex, uid)).join("")}
            </div>
        </div>

        <!-- Footer banner -->
        <div class="x-card x-card--muted" style="margin-top:22px;padding:16px;text-align:center;font-size:12px;color:var(--text-muted)">
            Tus notas en exámenes alimentan tus <strong style="color:var(--xahni-amber)">mastery points</strong> por materia. Auto-save, timer y navegación entre preguntas vendrán con el sistema completo.
        </div>
    `;
}

function _renderCardActiva(ex) {
    const titEsc = (ex.nombre || "").replace(/</g, "&lt;");
    const matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
        .find(m => m.id === ex.materiaId)?.nombre || ex.materiaId;
    const tiposMix = _resumenTipos(ex);
    return `
        <article class="exa-card activa" onclick="ExamenesEst.tomar('${ex.id}')">
            <div class="exa-card__head">
                <div>
                    <div class="exa-card__title">${titEsc}</div>
                    <div class="exa-card__meta">${matNom} · ${ex.parcial} · ${(ex.preguntas || []).length} preguntas (${tiposMix})</div>
                </div>
                <span class="x-chip x-chip--ok" style="font-size:10px">🟢 ABIERTO</span>
            </div>
            <div class="exa-card__meta">Mastery max: ${ex.masteryMax || 80} pts</div>
            <div class="exa-card__cta">Tomar examen →</div>
        </article>
    `;
}

function _renderCardPasado(ex, uid) {
    const titEsc = (ex.nombre || "").replace(/</g, "&lt;");
    const matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
        .find(m => m.id === ex.materiaId)?.nombre || ex.materiaId;
    const calif = ExamenesData.getCalificacion(ex.id, uid);
    const respuestas = ExamenesData.getRespuestas(ex.id, uid);

    if (!respuestas) {
        // No presentado (estado cerrado, sin respuestas)
        return `
            <article class="exa-card pasado--no-presentado" style="cursor:default">
                <div class="exa-card__head">
                    <div>
                        <div class="exa-card__title">${titEsc}</div>
                        <div class="exa-card__meta">${matNom} · ${ex.parcial}</div>
                    </div>
                    <span class="x-chip x-chip--danger" style="font-size:10px">❌ NO PRESENTADO</span>
                </div>
                <div class="exa-card__meta">Cerrado el ${_fmtFecha(ex.cerradoEn)} · 0/10 · +0 mastery</div>
            </article>
        `;
    }

    if (calif && calif.califFinal !== null) {
        // Calificado completo
        const masteryAplicado = calif.masteryAplicado || 0;
        const califClass = calif.califFinal >= 8 ? "exa-card__calif--ok"
                         : calif.califFinal >= 6 ? "" : "exa-card__calif--warn";
        return `
            <article class="exa-card pasado" onclick="ExamenesEst.verDetalle('${ex.id}')">
                <div class="exa-card__head">
                    <div>
                        <div class="exa-card__title">${titEsc}</div>
                        <div class="exa-card__meta">${matNom} · ${ex.parcial} · ${_fmtFecha(respuestas.tomadoEn)}</div>
                    </div>
                    <span class="x-chip x-chip--ok" style="font-size:10px">✅ CALIFICADO</span>
                </div>
                <div style="display:flex;align-items:baseline;gap:14px;margin-top:8px">
                    <div class="exa-card__calif ${califClass}">${calif.califFinal.toFixed(1)} / 10</div>
                    <div class="exa-card__mastery">↑ +${masteryAplicado} mastery</div>
                </div>
                <div class="exa-card__cta">Ver detalle →</div>
            </article>
        `;
    }

    // Pendiente: tomado pero abiertas sin calificar
    const partial = calif?.califParcial || 0;
    const abiertasPendientes = (ex.preguntas || []).filter(p => p.tipo === "abierta").length
        - ((calif?.abiertas || []).length);
    const masteryProvisional = ExamenesData.calcularMasteryGanado(ex, partial);
    return `
        <article class="exa-card pasado--pendiente" onclick="ExamenesEst.verDetalle('${ex.id}')">
            <div class="exa-card__head">
                <div>
                    <div class="exa-card__title">${titEsc}</div>
                    <div class="exa-card__meta">${matNom} · ${ex.parcial} · tomado ${_fmtFecha(respuestas.tomadoEn)}</div>
                </div>
                <span class="x-chip x-chip--warn" style="font-size:10px">⏳ ESPERANDO PROFE</span>
            </div>
            <div class="exa-card__meta">Parcial: <strong>${partial.toFixed(1)} / 10</strong> (multi+match) · ${abiertasPendientes} abierta${abiertasPendientes === 1 ? "" : "s"} pendiente${abiertasPendientes === 1 ? "" : "s"}</div>
            <div class="exa-card__meta">Mastery provisional: ~${masteryProvisional} pts (puede subir)</div>
            <div class="exa-card__cta">Ver detalle →</div>
        </article>
    `;
}

function _resumenTipos(ex) {
    const counts = { multi: 0, abierta: 0, match: 0 };
    (ex.preguntas || []).forEach(p => { counts[p.tipo] = (counts[p.tipo] || 0) + 1; });
    const parts = [];
    if (counts.multi > 0) parts.push(`${counts.multi} multi`);
    if (counts.abierta > 0) parts.push(`${counts.abierta} abierta${counts.abierta === 1 ? "" : "s"}`);
    if (counts.match > 0) parts.push(`${counts.match} match`);
    return parts.join(" · ");
}

function _fmtFecha(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

// Public namespace
const ExamenesEst = {
    tomar(exId) {
        if (typeof confirmarCanonico === "function") {
            confirmarCanonico({
                icono: "📝",
                titulo: "¿Comenzar examen?",
                mensaje: "Es 1 solo intento. Una vez enviado no podrás modificar respuestas.",
                accionTexto: "Comenzar",
                tipo: "primary"
            }).then(confirmed => {
                if (confirmed && typeof ExamenesTomar === "object") {
                    ExamenesTomar.abrir(exId);
                }
            });
        } else if (typeof ExamenesTomar === "object") {
            ExamenesTomar.abrir(exId);
        }
    },
    verDetalle(exId) {
        // E7: invocar AnalyticsExamen.abrir(exId, { contexto: 'estudiante' })
        if (typeof AnalyticsExamen === "object" && typeof AnalyticsExamen.abrir === "function") {
            AnalyticsExamen.abrir(exId, { contexto: "estudiante" });
        } else if (typeof showToast === "function") {
            showToast("Detalle de examen — pendiente E7", "info");
        }
    }
};
window.ExamenesEst = ExamenesEst;
window.buildExamenesEst = buildExamenesEst;

// Reasignar hook hub-materia (sustituye stub E0)
window.hubMateriaRenderExamenes = function () {
    if (typeof hubMateriaActiva === "undefined" || !hubMateriaActiva) return;
    buildExamenesEst(hubMateriaActiva.id);
};

// Reactive re-render
document.addEventListener("xahni:examenAbierto", () => {
    const panel = document.getElementById("hub-panel-examenes");
    if (panel && panel.offsetParent !== null) buildExamenesEst();
});
document.addEventListener("xahni:examenCerrado", () => {
    const panel = document.getElementById("hub-panel-examenes");
    if (panel && panel.offsetParent !== null) buildExamenesEst();
});
document.addEventListener("xahni:examenTomado", () => {
    const panel = document.getElementById("hub-panel-examenes");
    if (panel && panel.offsetParent !== null) buildExamenesEst();
});
document.addEventListener("xahni:examenCalificado", () => {
    const panel = document.getElementById("hub-panel-examenes");
    if (panel && panel.offsetParent !== null) buildExamenesEst();
});
