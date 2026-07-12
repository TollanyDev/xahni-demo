// js/shared/competencias-detalle.js
// Slice Competencias beta C5 · 2026-06-06 · spec §8.2
//
// Modal detalle torneo con variantes contexto.
// Profesor: ranking + participaciones por grupo collapsible + cerrar antes.
// Estudiante (finalizada): ranking + mi resultado.

const DetalleTorneo = (() => {

    let _compId = null;
    let _contexto = "estudiante";
    let _gruposExpandidos = {};

    function abrir(compId, opts) {
        opts = opts || {};
        _compId = compId;
        _contexto = opts.contexto || "estudiante";
        _gruposExpandidos = {};

        const comp = _findComp(compId);
        if (!comp) return;

        _render(comp);
        if (typeof openModal === "function") openModal("modal-detalle-comp");
    }

    function _findComp(compId) {
        if (typeof CompetenciasData === "undefined") return null;
        return CompetenciasData._allTorneos().find(c => c.id === compId);
    }

    function _render(comp) {
        const matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
            .find(m => m.id === comp.materiaId)?.nombre || comp.materiaId;
        const now = new Date();
        const estado = CompetenciasData.derivarEstado(comp, now);
        const ranking = CompetenciasData.calcularRanking(comp);

        const statusLabel = estado === "activa"
            ? `Activa · ${Math.max(0, Math.ceil((new Date(comp.fechaFin) - now) / 86400000))} días restantes`
            : estado === "proxima"
              ? `Próxima · empieza ${new Date(comp.fechaInicio).toLocaleDateString("es-MX")}`
              : `Finalizada · ${new Date(comp.cerradoEn || comp.fechaFin).toLocaleDateString("es-MX")}`;

        document.getElementById("dtc-eyebrow").textContent = `${matNom} · ${(comp.tipo || 'quiz').toUpperCase()} · ${(comp.gruposInscritos || []).length} grupos · ${statusLabel}`;
        document.getElementById("dtc-titulo").textContent = `${estado === "finalizada" ? "🏆 " : ""}${comp.nombre}`;

        const body = document.getElementById("dtc-body");

        let html = `
            <div>
                <div class="dtc-section-titulo">Ranking ${estado === "finalizada" ? "final" : "actual"}</div>
                ${ranking.length === 0
                    ? `<div style="color:var(--text-muted);font-size:13px;padding:12px;text-align:center">Sin grupos en este torneo.</div>`
                    : ranking.map(r => {
                        const avg = r.participantes > 0 ? (r.puntaje / r.participantes).toFixed(1) : "—";
                        return `
                            <div class="dtc-ranking-row">
                                <div style="font-weight:700;color:var(--accent-cyan-text)">${r.lugar}°</div>
                                <div>${typeof _displayGrupoLabel === "function" ? _displayGrupoLabel(r.grupoId) : r.grupoId}</div>
                                <div class="x-mono-sm">${r.puntaje} pts</div>
                                <div style="color:var(--text-muted);font-size:11px">${r.participantes} part. · avg ${avg}</div>
                            </div>
                        `;
                    }).join("")}
            </div>
        `;

        // Profesor: participaciones por grupo collapsible
        if (_contexto === "profesor") {
            html += `<div>
                <div class="dtc-section-titulo">Participaciones por grupo</div>
                ${ranking.map((r, idx) => _renderGrupoCollapsible(comp, r, idx === 0)).join("")}
            </div>`;
        }

        body.innerHTML = html;

        // Footer
        const footer = document.getElementById("dtc-footer");
        if (_contexto === "profesor" && estado === "activa") {
            footer.innerHTML = `
                <button class="x-btn x-btn--ghost x-btn--danger" onclick="DetalleTorneo.cerrarAntes('${comp.id}')">Cerrar antes</button>
                <button class="x-btn x-btn--primary" onclick="DetalleTorneo.cerrar()">Cerrar</button>
            `;
        } else {
            footer.innerHTML = `<button class="x-btn x-btn--primary" onclick="DetalleTorneo.cerrar()">Cerrar</button>`;
        }
    }

    function _renderGrupoCollapsible(comp, rankingRow, expandedDefault) {
        const expanded = _gruposExpandidos[rankingRow.grupoId] !== undefined
            ? _gruposExpandidos[rankingRow.grupoId]
            : expandedDefault;
        if (_gruposExpandidos[rankingRow.grupoId] === undefined) {
            _gruposExpandidos[rankingRow.grupoId] = expanded;
        }
        const grupos = (typeof DEMO_GRUPOS !== "undefined" ? DEMO_GRUPOS : []);
        const grupo = grupos.find(g => g.id === rankingRow.grupoId);
        const alumnos = grupo?.miembros || [];

        // Build sorted alumnos by best score desc
        const conAttempts = alumnos.map(uid => {
            const attempts = CompetenciasData.getAttempts(comp.id, uid);
            const best = attempts.length > 0 ? Math.max.apply(null, attempts.map(a => a.score)) : null;
            return { uid: uid, attempts: attempts.length, best: best };
        }).filter(a => a.attempts > 0)
          .sort((a, b) => (b.best || 0) - (a.best || 0));

        const arrow = expanded ? "▼" : "▷";

        return `
            <div class="dtc-grupo-collapsible">
                <div class="dtc-grupo-collapsible__head" onclick="DetalleTorneo._toggleGrupo('${rankingRow.grupoId}')">
                    <span>${arrow} ${typeof _displayGrupoLabel === "function" ? _displayGrupoLabel(rankingRow.grupoId, 18) : rankingRow.grupoId} (${rankingRow.participantes} participantes)</span>
                    <span style="color:var(--text-muted);font-size:11px">${rankingRow.puntaje} pts</span>
                </div>
                <div class="dtc-grupo-collapsible__body ${expanded ? "" : "collapsed"}">
                    ${conAttempts.length === 0
                        ? `<div style="color:var(--text-muted);padding:8px">Sin participaciones registradas</div>`
                        : conAttempts.map(a => {
                            const user = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []).find(u => u.id === a.uid);
                            return `
                                <div class="dtc-alumno-row">
                                    <span>• ${user?.nombre || a.uid}</span>
                                    <span class="x-mono-sm">${a.best} pts (${a.attempts} intento${a.attempts === 1 ? "" : "s"})</span>
                                </div>
                            `;
                        }).join("")}
                </div>
            </div>
        `;
    }

    function _toggleGrupo(grupoId) {
        _gruposExpandidos[grupoId] = !_gruposExpandidos[grupoId];
        const comp = _findComp(_compId);
        if (comp) _render(comp);
    }

    function cerrarAntes(compId) {
        if (typeof confirmarCanonico !== "function") {
            // Fallback simple confirm
            if (confirm("Cerrar este torneo ahora distribuirá XP por lugar. No se puede deshacer.")) {
                _ejecutarCerrarAntes(compId);
            }
            return;
        }
        // Signature canonical: retorna Promise<boolean>, accionTexto (no textoAceptar).
        confirmarCanonico({
            icono: "⚠️",
            titulo: "Cerrar torneo ahora",
            mensaje: "Distribuirá XP por lugar a los participantes. No se puede deshacer.",
            accionTexto: "Cerrar ahora",
            tipo: "danger"
        }).then(confirmed => {
            if (confirmed) _ejecutarCerrarAntes(compId);
        });
    }

    async function _ejecutarCerrarAntes(compId) {
        // Bug crítico 2026-06-09: failsafe pre-cierre. Rehidratar attempts del
        // torneo desde Firestore para que cerrarTorneo / calcularRanking vea
        // los intentos cross-device de TODOS los alumnos, no solo los del propio
        // dispositivo del cerrador.
        if (typeof window.firestoreRehydrateAttemptsCompetencia === "function") {
            try { await window.firestoreRehydrateAttemptsCompetencia(compId); }
            catch (e) { /* defensive */ }
        }
        const ok = CompetenciasData.cerrarTorneo(compId, "manual");
        if (ok && typeof showToast === "function") {
            showToast(`✓ Torneo cerrado · XP distribuido`, "ok");
        }
        cerrar();
    }

    function cerrar() {
        if (typeof closeModal === "function") closeModal("modal-detalle-comp");
        _compId = null;
        _gruposExpandidos = {};
    }

    return {
        abrir: abrir,
        cerrar: cerrar,
        cerrarAntes: cerrarAntes,
        _toggleGrupo: _toggleGrupo
    };

})();
window.DetalleTorneo = DetalleTorneo;
