// js/profesor/examenes-calificar.js
// Slice Examenes beta E5 · 2026-06-06 · spec §8.3
//
// Dashboard cross-alumno cross-pregunta para calificar abiertas pendientes.
// Queue ordenado por alumno → pregunta. Auto-next al guardar.
// Al calificar la ÚLTIMA abierta del alumno: aplicar mastery + escala +
// emit xahni:examenCalificado.

const CalificarExamen = (() => {

    let _state = null;

    function _esc(s) {
        return (s || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function _buildQueue(examen) {
        // Para cada alumno con respuestas + abiertas sin calificar → push items
        const abiertas = (examen.preguntas || []).filter(p => p.tipo === "abierta");
        if (abiertas.length === 0) return [];
        const users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : [])
            .filter(u => u.tipo === "estudiante");
        const queue = [];
        users.forEach(u => {
            const resp = ExamenesData.getRespuestas(examen.id, u.id);
            if (!resp) return;
            const calif = ExamenesData.getCalificacion(examen.id, u.id) || { abiertas: [] };
            const yaCalificadas = (calif.abiertas || []).map(a => a.pregId);
            abiertas.forEach(p => {
                if (yaCalificadas.includes(p.id)) return;
                const respuestaTxt = (resp.respuestas || {})[p.id] || "";
                if (typeof respuestaTxt === "string" && respuestaTxt.trim().length === 0) {
                    // Sin respuesta — auto-calificar 0% y NO incluir en queue manual
                    return;
                }
                queue.push({
                    uid: u.id,
                    alumnoNombre: u.nombre || u.id,
                    pregId: p.id,
                    pregTexto: p.texto,
                    valor: p.valor || 1,
                    respuesta: respuestaTxt
                });
            });
        });
        return queue;
    }

    function abrir(exId) {
        if (typeof ExamenesData === "undefined") return;
        const examen = ExamenesData._allExamenes().find(e => e.id === exId);
        if (!examen) return;

        const queue = _buildQueue(examen);

        _state = {
            examen: examen,
            queue: queue,
            queueIdx: 0,
            totalCalificadas: 0,
            initial: queue.length
        };

        const matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
            .find(m => m.id === examen.materiaId)?.nombre || examen.materiaId;
        const eyebrowEl = document.getElementById("cef-eyebrow");
        if (eyebrowEl) eyebrowEl.textContent = `📚 ${matNom} · ${examen.parcial}`;
        const titEl = document.getElementById("cef-titulo");
        if (titEl) titEl.textContent = `Calificar: ${examen.nombre}`;
        const subEl = document.getElementById("cef-subtitle");
        if (subEl) subEl.textContent = `${queue.length} abiertas sin calificar`;

        _render();
        if (typeof openModal === "function") openModal("modal-calificar-examen");
    }

    function _render() {
        if (!_state) return;
        const bodyEl = document.getElementById("cef-body");
        if (!bodyEl) return;

        // Update progress
        const progEl = document.getElementById("cef-footer-progress");
        if (progEl) progEl.textContent = `${_state.totalCalificadas}/${_state.initial} calificadas`;

        if (_state.queueIdx >= _state.queue.length) {
            bodyEl.innerHTML = `
                <div class="cef-empty">
                    <div style="font-size:48px;margin-bottom:12px">🎉</div>
                    <div style="font-size:16px;font-weight:600;color:var(--text-primary);margin-bottom:8px">¡Calificación completa!</div>
                    <div style="font-size:13px;color:var(--text-secondary)">Has terminado de calificar todas las abiertas pendientes.</div>
                </div>
            `;
            return;
        }

        const item = _state.queue[_state.queueIdx];
        bodyEl.innerHTML = `
            <div class="cef-item">
                <div class="cef-item__head">
                    <div class="cef-item__alumno">${_esc(item.alumnoNombre)}</div>
                    <div class="cef-item__valor">VALOR ${item.valor} pts</div>
                </div>
                <div class="cef-item__pregunta">"${_esc(item.pregTexto)}"</div>
                <div class="cef-item__respuesta">${_esc(item.respuesta)}</div>
                <div class="cef-item__form">
                    <div class="cef-item__porcentaje">
                        <label for="cef-input-pct">Tu calificación</label>
                        <input type="number" id="cef-input-pct" min="0" max="100" step="1" placeholder="0-100" value="">
                    </div>
                    <div class="cef-item__comentario">
                        <label for="cef-input-comentario">Comentario opcional</label>
                        <textarea id="cef-input-comentario" placeholder="Feedback al alumno…"></textarea>
                    </div>
                    <button class="x-btn x-btn--primary" onclick="CalificarExamen.guardar()">Guardar y siguiente →</button>
                </div>
            </div>
        `;
    }

    function guardar() {
        if (!_state) return;
        const item = _state.queue[_state.queueIdx];
        if (!item) return;

        const inputPct = document.getElementById("cef-input-pct");
        const inputComentario = document.getElementById("cef-input-comentario");
        if (!inputPct) return;

        const pct = parseInt(inputPct.value, 10);
        if (isNaN(pct) || pct < 0 || pct > 100) {
            if (typeof showToast === "function") {
                showToast("Ingresa una calificación entre 0 y 100", "warn");
            }
            inputPct.focus();
            return;
        }
        const comentario = (inputComentario?.value || "").trim();

        // Persistir
        ExamenesData.setCalificacionAbierta(_state.examen.id, item.uid, item.pregId, pct, comentario);

        // Recalcular — chequea si todas abiertas del alumno ya están calificadas
        const calif = ExamenesData.recalcularCalificacionFinal(_state.examen.id, item.uid);

        // Si califFinal !== null → última abierta de este alumno → aplicar mastery + escala + emit
        if (calif && calif.califFinal !== null) {
            ExamenesData.aplicarMastery(item.uid, _state.examen, calif.califFinal);
            ExamenesData.aplicarARubroParcial(item.uid, _state.examen, calif.califFinal);
            const masteryGanado = ExamenesData.calcularMasteryGanado(_state.examen, calif.califFinal);
            try {
                document.dispatchEvent(new CustomEvent("xahni:examenCalificado", {
                    detail: {
                        exId: _state.examen.id,
                        uid: item.uid,
                        califFinal: calif.califFinal,
                        masteryGanado: masteryGanado
                    }
                }));
            } catch (e) { /* defensive */ }
        }

        _state.totalCalificadas++;
        _state.queueIdx++;
        _render();

        if (typeof showToast === "function") {
            const msg = (calif && calif.califFinal !== null)
                ? `✓ Alumno completado · ${calif.califFinal.toFixed(1)}/10`
                : `✓ Calificada (faltan ${_state.queue.length - _state.queueIdx})`;
            showToast(msg, "ok");
        }
    }

    function cerrar() {
        if (typeof closeModal === "function") closeModal("modal-calificar-examen");
        _state = null;
    }

    return {
        abrir, cerrar, guardar
    };
})();
window.CalificarExamen = CalificarExamen;
