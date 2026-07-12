// js/shared/competencias-participar.js
// Slice Competencias beta C4 · 2026-06-06 · spec §8.1
//
// Modal participar con 3 estados condicionales (A: 0 attempts, B: 1-2, C: 3).
// Integra con abrirJuego() para iniciar el juego del torneo.
// Auto-registro de attempt en competencias-cierre.js listener.

const ParticiparTorneo = (() => {

    let _compId = null;

    function abrir(compId) {
        _compId = compId;
        const comp = _findComp(compId);
        if (!comp) return;
        if (typeof CompetenciasData === "undefined") return;
        const uid = APP?.user?.id;
        if (!uid) return;

        _renderEstado(comp, uid);
        if (typeof openModal === "function") openModal("modal-participar-comp");
    }

    function _findComp(compId) {
        if (typeof CompetenciasData === "undefined") return null;
        return CompetenciasData._allTorneos().find(c => c.id === compId);
    }

    function _renderEstado(comp, uid) {
        const matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
            .find(m => m.id === comp.materiaId)?.nombre || comp.materiaId;
        const attempts = CompetenciasData.getAttempts(comp.id, uid);
        const max = CompetenciasData.MAX_ATTEMPTS;

        document.getElementById("ptc-eyebrow").textContent = `📚 ${matNom} · ${(comp.tipo || 'quiz').toUpperCase()}`;
        document.getElementById("ptc-titulo").textContent = comp.nombre;

        const body = document.getElementById("ptc-body");
        const footer = document.getElementById("ptc-footer");

        if (attempts.length === 0) {
            // Estado A
            body.innerHTML = `
                <div style="font-size:14px;color:var(--text-primary)">El primer intento de ${max}.</div>
                <div style="font-size:13px;color:var(--text-secondary)">Mejor puntaje cuenta para tu grupo.</div>
                <div style="margin-top:8px;font-size:12px;color:var(--text-muted)">Mi grupo (${typeof _displayGrupoLabel === "function" ? _displayGrupoLabel(CompetenciasData._grupoIdDeUser(uid), 22) : CompetenciasData._grupoIdDeUser(uid)}): aún sin participaciones registradas.</div>
            `;
            footer.innerHTML = `
                <button class="x-btn x-btn--ghost" onclick="ParticiparTorneo.cerrar()">Cancelar</button>
                <button class="x-btn x-btn--primary" onclick="ParticiparTorneo.comenzar()">Comenzar →</button>
            `;
        } else if (attempts.length < max) {
            // Estado B
            const mejor = CompetenciasData.getMejorScore(comp.id, uid);
            const ranking = CompetenciasData.calcularRanking(comp).slice(0, 3);
            const grupoUid = CompetenciasData._grupoIdDeUser(uid);

            body.innerHTML = `
                <div style="font-size:14px;color:var(--text-primary)">Mis intentos: ${attempts.length} de ${max}</div>
                <div class="ptc-attempts-list">
                    ${attempts.map(a => `
                        <div class="ptc-attempt-row ${a.score === mejor ? "ptc-attempt-row--best" : ""}">
                            <span>Intento ${a.intento}:</span>
                            <span>${a.score} pts</span>
                            <span style="color:var(--text-muted)">${new Date(a.fecha).toLocaleDateString("es-MX",{day:"2-digit",month:"short"})}</span>
                        </div>
                    `).join("")}
                </div>
                <div style="font-size:13px;color:var(--text-primary)"><strong>Mi mejor: ${mejor} pts</strong></div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:8px">Ranking actual del torneo:</div>
                <div style="display:flex;flex-direction:column;gap:4px">
                    ${ranking.map(r => `
                        <div style="display:grid;grid-template-columns:22px 1fr auto;gap:8px;padding:4px 8px;background:${r.grupoId === grupoUid ? "var(--xahni-cyan-dim)" : "var(--surface-2)"};border-radius:var(--r-sm);font-size:12px">
                            <span style="font-weight:700;color:var(--accent-cyan-text)">${r.lugar}°</span>
                            <span>${typeof _displayGrupoLabel === "function" ? _displayGrupoLabel(r.grupoId, 16) : r.grupoId} ${r.grupoId === grupoUid ? "(mi grupo)" : ""}</span>
                            <span class="x-mono-sm">${r.puntaje} pts · ${r.participantes} part.</span>
                        </div>
                    `).join("")}
                </div>
            `;
            footer.innerHTML = `
                <button class="x-btn x-btn--ghost" onclick="ParticiparTorneo.cerrar()">Cerrar</button>
                <button class="x-btn x-btn--primary" onclick="ParticiparTorneo.volverIntentar()">Volver a intentar (${max - attempts.length}/${max}) →</button>
            `;
        } else {
            // Estado C — agotó
            const mejor = CompetenciasData.getMejorScore(comp.id, uid);
            const ranking = CompetenciasData.calcularRanking(comp).slice(0, 3);
            const grupoUid = CompetenciasData._grupoIdDeUser(uid);
            const diasCierre = Math.max(0, Math.ceil((new Date(comp.fechaFin) - new Date()) / 86400000));

            body.innerHTML = `
                <div style="font-size:14px;color:var(--text-primary);font-weight:600">Has agotado tus ${max} intentos</div>
                <div class="ptc-attempts-list">
                    ${attempts.map(a => `
                        <div class="ptc-attempt-row ${a.score === mejor ? "ptc-attempt-row--best" : ""}">
                            <span>Intento ${a.intento}:</span>
                            <span>${a.score} pts</span>
                            <span>${a.score === mejor ? "✓ mejor" : ""}</span>
                        </div>
                    `).join("")}
                </div>
                <div style="font-size:13px;color:var(--text-primary)"><strong>Mi aporte al grupo: ${mejor} pts</strong></div>
                <div style="font-size:12px;color:var(--text-muted)">Ranking actual: ${ranking[0] ? `${ranking[0].lugar}° ${typeof _displayGrupoLabel === "function" ? _displayGrupoLabel(ranking[0].grupoId, 14) : ranking[0].grupoId} · ${ranking[0].puntaje} pts` : "—"}</div>
                <div style="font-size:12px;color:var(--text-muted)">Cierre del torneo: en ${diasCierre} ${diasCierre === 1 ? "día" : "días"}</div>
            `;
            footer.innerHTML = `
                <button class="x-btn x-btn--primary" onclick="ParticiparTorneo.cerrar()">Cerrar</button>
            `;
        }
    }

    function comenzar() {
        if (!_compId) return;
        const comp = _findComp(_compId);
        if (!comp || !comp.juegoId) return;
        cerrar();
        if (typeof abrirJuego === "function") abrirJuego(comp.juegoId);
    }

    function volverIntentar() {
        comenzar();
    }

    function cerrar() {
        if (typeof closeModal === "function") closeModal("modal-participar-comp");
        _compId = null;
    }

    return {
        abrir: abrir,
        cerrar: cerrar,
        comenzar: comenzar,
        volverIntentar: volverIntentar
    };

})();
window.ParticiparTorneo = ParticiparTorneo;
