// js/shared/temario.js
// Sweep 2026-06-09 (Temario+IA): data layer + render layer del Tab Temario.
//
// Shape canonical del temario (vive como campo `temario` dentro del doc
// materia, hidratado por _hydrateGlobalsFromFirestore existente):
//   {
//     unidades: [{
//       id: "u-xxxxx",
//       titulo: string,
//       estado: "pendiente" | "en-curso" | "visto",
//       subtemas: [{
//         id: "s-xxxxx",
//         titulo: string,
//         descripcion: string,
//         estado: "pendiente" | "en-curso" | "visto"
//       }]
//     }],
//     actualizadoEn: ISO string,
//     actualizadoPor: uid
//   }
//
// Render layer (TemarioRender) en task 6-7 — append abajo.

const TemarioData = (() => {

    const SAVE_DEBOUNCE_MS = 500;
    const _saveTimers = {}; // matId → setTimeout handle

    function _genId(prefix) {
        return prefix + "-" + Math.random().toString(36).slice(2, 9);
    }

    function _getMateria(matId) {
        if (typeof DEMO_MATERIAS === "undefined") return null;
        return DEMO_MATERIAS.find(m => m.id === matId) || null;
    }

    function _getTemario(matId) {
        const m = _getMateria(matId);
        if (!m) return { unidades: [] };
        if (!m.temario || !Array.isArray(m.temario.unidades)) {
            m.temario = { unidades: [] };
        }
        return m.temario;
    }

    /**
     * @interaction temariodata-save-debounced
     * @scope shared-temario-persist
     *
     * Given matId del temario mutado.
     * When cualquier CRUD method termina.
     * Then debounce 500ms; al disparar:
     *   1. Actualiza temario.actualizadoEn + actualizadoPor.
     *   2. En prod, write a Firestore materias.doc(matId).update({temario}).
     *   3. Dispatcha xahni:temarioActualizado para renderers reactivos.
     * Edge:
     *   - Demo mode: solo dispatcha (no persistencia), DEMO_MATERIAS ya mutado in-memory.
     */
    function _saveDebounced(matId) {
        clearTimeout(_saveTimers[matId]);
        _saveTimers[matId] = setTimeout(() => {
            const m = _getMateria(matId);
            if (!m) return;
            const uid = (typeof APP !== "undefined" && APP.user) ? APP.user.id : null;
            m.temario.actualizadoEn = new Date().toISOString();
            m.temario.actualizadoPor = uid;
            if (typeof APP_CONFIG !== "undefined"
                && APP_CONFIG.mode === "prod"
                && typeof fbDb === "function") {
                try {
                    fbDb().collection("materias").doc(matId).update({
                        temario: m.temario
                    });
                } catch (e) {
                    console.warn("[TemarioData] persist fail", e);
                }
            }
            try {
                document.dispatchEvent(new CustomEvent("xahni:temarioActualizado", {
                    detail: { matId, temario: m.temario }
                }));
            } catch (_) { /* defensive */ }
        }, SAVE_DEBOUNCE_MS);
    }

    // ── PUBLIC API · CRUD UNIDADES ────────────────────────────────

    function getTemario(matId) {
        return _getTemario(matId);
    }

    function addUnidad(matId, titulo) {
        const t = _getTemario(matId);
        t.unidades.push({
            id: _genId("u"),
            titulo: titulo || "Nueva unidad",
            estado: "pendiente",
            subtemas: []
        });
        _saveDebounced(matId);
    }

    function updateUnidad(matId, unidadId, patch) {
        const t = _getTemario(matId);
        const u = t.unidades.find(x => x.id === unidadId);
        if (!u) return;
        Object.assign(u, patch);
        _saveDebounced(matId);
    }

    function deleteUnidad(matId, unidadId) {
        const t = _getTemario(matId);
        t.unidades = t.unidades.filter(x => x.id !== unidadId);
        _saveDebounced(matId);
    }

    function reorderUnidad(matId, unidadId, direction) {
        // direction: -1 (up) | +1 (down)
        const t = _getTemario(matId);
        const idx = t.unidades.findIndex(x => x.id === unidadId);
        if (idx < 0) return;
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= t.unidades.length) return;
        const [item] = t.unidades.splice(idx, 1);
        t.unidades.splice(newIdx, 0, item);
        _saveDebounced(matId);
    }

    function setEstadoUnidad(matId, unidadId, estado) {
        updateUnidad(matId, unidadId, { estado });
    }

    // ── PUBLIC API · CRUD SUBTEMAS ────────────────────────────────

    function addSubtema(matId, unidadId, titulo, descripcion) {
        const t = _getTemario(matId);
        const u = t.unidades.find(x => x.id === unidadId);
        if (!u) return;
        u.subtemas = u.subtemas || [];
        u.subtemas.push({
            id: _genId("s"),
            titulo: titulo || "Nuevo subtema",
            descripcion: descripcion || "",
            estado: "pendiente"
        });
        _saveDebounced(matId);
    }

    function updateSubtema(matId, unidadId, subtemaId, patch) {
        const t = _getTemario(matId);
        const u = t.unidades.find(x => x.id === unidadId);
        if (!u) return;
        const s = (u.subtemas || []).find(x => x.id === subtemaId);
        if (!s) return;
        Object.assign(s, patch);
        _saveDebounced(matId);
    }

    function deleteSubtema(matId, unidadId, subtemaId) {
        const t = _getTemario(matId);
        const u = t.unidades.find(x => x.id === unidadId);
        if (!u) return;
        u.subtemas = (u.subtemas || []).filter(x => x.id !== subtemaId);
        _saveDebounced(matId);
    }

    function reorderSubtema(matId, unidadId, subtemaId, direction) {
        const t = _getTemario(matId);
        const u = t.unidades.find(x => x.id === unidadId);
        if (!u || !Array.isArray(u.subtemas)) return;
        const idx = u.subtemas.findIndex(x => x.id === subtemaId);
        if (idx < 0) return;
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= u.subtemas.length) return;
        const [item] = u.subtemas.splice(idx, 1);
        u.subtemas.splice(newIdx, 0, item);
        _saveDebounced(matId);
    }

    function setEstadoSubtema(matId, unidadId, subtemaId, estado) {
        updateSubtema(matId, unidadId, subtemaId, { estado });
    }

    // ── PUBLIC API · IA ───────────────────────────────────────────

    /**
     * @interaction temariodata-replace
     * @scope shared-temario-ia-apply
     *
     * Given matId + unidades (incoming from IA suggestion; sin IDs).
     * When user aplica una sugerencia IA.
     * Then reemplaza completamente el temario.unidades. Genera IDs frescos
     *   para cada unidad y subtema. Todos arrancan estado=pendiente.
     */
    function replaceTemario(matId, unidades) {
        const m = _getMateria(matId);
        if (!m) return;
        const normalizedUnidades = (unidades || []).map(u => ({
            id: _genId("u"),
            titulo: u.titulo || "Unidad",
            estado: "pendiente",
            subtemas: (u.subtemas || []).map(s => ({
                id: _genId("s"),
                titulo: s.titulo || "Subtema",
                descripcion: s.descripcion || "",
                estado: "pendiente"
            }))
        }));
        m.temario = { unidades: normalizedUnidades };
        _saveDebounced(matId);
    }

    return {
        getTemario,
        addUnidad, updateUnidad, deleteUnidad, reorderUnidad,
        setEstadoUnidad,
        addSubtema, updateSubtema, deleteSubtema, reorderSubtema,
        setEstadoSubtema,
        replaceTemario
    };
})();
window.TemarioData = TemarioData;

// ═════════════════════════════════════════════════════════════════
// RENDER LAYER (TemarioRender)
// ═════════════════════════════════════════════════════════════════

const TemarioRender = (() => {

    const ESTADO_LABEL = {
        "pendiente": "Pendiente",
        "en-curso":  "En curso",
        "visto":     "Visto"
    };
    const ESTADO_CLASS = {
        "pendiente": "x-temario-chip--pendiente",
        "en-curso":  "x-temario-chip--en-curso",
        "visto":     "x-temario-chip--visto"
    };

    function _esc(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function _chipEstadoReadonly(estado) {
        const cls = ESTADO_CLASS[estado] || ESTADO_CLASS.pendiente;
        const lbl = ESTADO_LABEL[estado] || ESTADO_LABEL.pendiente;
        return `<span class="x-temario-chip ${cls}">${lbl}</span>`;
    }

    /**
     * @interaction temariorender-alumno
     * @scope shared-temario-render-alumno
     *
     * Given containerId DOM + matId.
     * When tab Temario activate (estudiante) o evento de re-render.
     * Then render read-only del temario: unidades + subtemas con chips
     *   de estado color-coded. Empty state si no hay unidades.
     */
    function renderAlumno(containerId, matId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const t = TemarioData.getTemario(matId);
        if (!t.unidades || !t.unidades.length) {
            container.innerHTML = `
                <div class="x-empty x-empty--inline" style="padding:32px 16px">
                    <div class="x-empty__icon">📚</div>
                    <div class="x-empty__title">Tu profesor aún no ha publicado el temario</div>
                    <div class="x-empty__sub">Cuando esté disponible, lo verás aquí.</div>
                </div>`;
            return;
        }
        const html = t.unidades.map((u, ui) => {
            const subs = (u.subtemas || []).map(s => {
                const puedeGenerarSub = (s.estado === "en-curso" || s.estado === "visto" || u.estado === "en-curso" || u.estado === "visto");
                const tituloSubEsc = _esc(s.titulo).replace(/'/g, "\\'");
                return `
                <div class="x-temario-subtema">
                    <div class="x-temario-subtema__head">
                        <span class="x-temario-subtema__titulo">${_esc(s.titulo)}</span>
                        ${_chipEstadoReadonly(s.estado)}
                    </div>
                    ${s.descripcion ? `<div class="x-temario-subtema__desc">${_esc(s.descripcion)}</div>` : ""}
                    ${puedeGenerarSub
                        ? `<div class="x-temario-actions"><button class="x-btn x-btn--ghost x-btn--sm"
                              onclick="TemarioIaModal.openGenerarJuegoAlumno('${matId}','${s.id}','${tituloSubEsc}')">💡 Generar juego (IA)</button></div>`
                        : ""}
                </div>`;
            }).join("");
            const puedeGenerarUnidad = (u.estado === "en-curso" || u.estado === "visto");
            const tituloUEsc = _esc(u.titulo).replace(/'/g, "\\'");
            return `
                <div class="x-temario-unidad">
                    <div class="x-temario-unidad__head">
                        <div class="x-temario-unidad__numero">Unidad ${ui + 1}</div>
                        <div class="x-temario-unidad__titulo">${_esc(u.titulo)}</div>
                        ${_chipEstadoReadonly(u.estado)}
                    </div>
                    <div class="x-temario-unidad__body">
                        ${subs || `<div class="x-empty__sub">Sin subtemas todavía.</div>`}
                        ${puedeGenerarUnidad
                            ? `<div class="x-temario-actions"><button class="x-btn x-btn--ghost x-btn--sm"
                                  onclick="TemarioIaModal.openGenerarJuegoAlumno('${matId}','${u.id}','${tituloUEsc}')">💡 Generar juego (IA)</button></div>`
                            : ""}
                    </div>
                </div>
            `;
        }).join("");
        container.innerHTML = `<div class="x-temario">${html}</div>`;
    }

    function _chipEstadoClickable(estado, onclickAttr) {
        const cls = ESTADO_CLASS[estado] || ESTADO_CLASS.pendiente;
        const lbl = ESTADO_LABEL[estado] || ESTADO_LABEL.pendiente;
        return `<span class="x-temario-chip is-clickable ${cls}" ${onclickAttr}>${lbl}</span>`;
    }

    /**
     * @interaction temariorender-profesor
     * @scope shared-temario-render-profesor
     *
     * Given containerId + matId.
     * When tab Temario activate (profesor) o evento de re-render.
     * Then render full CRUD:
     *   - Header con "Sugerir con IA" + "+ Añadir unidad".
     *   - Cada unidad contenteditable, chip estado clickeable, reorder + delete.
     *   - Cada subtema contenteditable (titulo + descripcion), chip estado, delete.
     *   - Botón "Generar juego" en items con estado en-curso o visto.
     * Edge: usa onclick inline → handlers en window.TemarioProfHandlers.
     */
    function renderProfesor(containerId, matId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const t = TemarioData.getTemario(matId);

        const unidadesHtml = (t.unidades || []).map((u, ui) => {
            const subsHtml = (u.subtemas || []).map(s => {
                const puedeGenerarSub = (s.estado === "en-curso" || s.estado === "visto" || u.estado === "en-curso" || u.estado === "visto");
                const tituloEscaped = _esc(s.titulo).replace(/'/g, "\\'");
                return `
                <div class="x-temario-subtema" data-subtema-id="${s.id}">
                    <div class="x-temario-subtema__head">
                        <span class="x-temario-subtema__titulo" contenteditable="true"
                              onblur="TemarioProfHandlers.editSubtema('${matId}','${u.id}','${s.id}',this.textContent)">${_esc(s.titulo)}</span>
                        ${_chipEstadoClickable(s.estado,
                            `onclick="TemarioProfHandlers.cycleEstadoSubtema('${matId}','${u.id}','${s.id}')"`)}
                        <button class="x-btn x-btn--icon x-btn--danger" title="Eliminar"
                                onclick="TemarioProfHandlers.deleteSubtema('${matId}','${u.id}','${s.id}')">🗑</button>
                    </div>
                    <div class="x-temario-subtema__desc" contenteditable="true"
                         onblur="TemarioProfHandlers.editSubtemaDesc('${matId}','${u.id}','${s.id}',this.textContent)"
                         data-placeholder="Descripción breve…">${_esc(s.descripcion)}</div>
                    ${puedeGenerarSub
                        ? `<div class="x-temario-actions"><button class="x-btn x-btn--ghost x-btn--sm"
                              onclick="TemarioIaModal.openGenerarJuego('${matId}','${s.id}','${tituloEscaped}')">💡 Generar juego</button></div>`
                        : ""}
                </div>`;
            }).join("");

            const puedeGenerarUnidad = (u.estado === "en-curso" || u.estado === "visto");
            const tituloUEscaped = _esc(u.titulo).replace(/'/g, "\\'");
            return `
                <div class="x-temario-unidad" data-unidad-id="${u.id}">
                    <div class="x-temario-unidad__head">
                        <div class="x-temario-unidad__numero">Unidad ${ui + 1}</div>
                        <div class="x-temario-unidad__titulo" contenteditable="true"
                             onblur="TemarioProfHandlers.editUnidad('${matId}','${u.id}',this.textContent)">${_esc(u.titulo)}</div>
                        ${_chipEstadoClickable(u.estado,
                            `onclick="TemarioProfHandlers.cycleEstadoUnidad('${matId}','${u.id}')"`)}
                        <div class="x-temario-unidad__actions">
                            <button class="x-btn x-btn--icon" title="Subir"
                                    onclick="TemarioProfHandlers.moveUnidad('${matId}','${u.id}',-1)">⬆</button>
                            <button class="x-btn x-btn--icon" title="Bajar"
                                    onclick="TemarioProfHandlers.moveUnidad('${matId}','${u.id}',1)">⬇</button>
                            <button class="x-btn x-btn--icon x-btn--danger" title="Eliminar"
                                    onclick="TemarioProfHandlers.deleteUnidad('${matId}','${u.id}')">🗑</button>
                        </div>
                    </div>
                    <div class="x-temario-unidad__body">
                        ${subsHtml || `<div class="x-empty__sub">Sin subtemas todavía.</div>`}
                        <div class="x-temario-actions">
                            <button class="x-btn x-btn--ghost x-btn--sm"
                                    onclick="TemarioProfHandlers.addSubtema('${matId}','${u.id}')">+ Añadir subtema</button>
                            ${puedeGenerarUnidad
                                ? `<button class="x-btn x-btn--ghost x-btn--sm"
                                      onclick="TemarioIaModal.openGenerarJuego('${matId}','${u.id}','${tituloUEscaped}')">💡 Generar juego</button>`
                                : ""}
                        </div>
                    </div>
                </div>`;
        }).join("");

        container.innerHTML = `
            <div class="x-temario-header">
                <button class="x-btn x-btn--primary x-btn--sm"
                        onclick="TemarioIaModal.openSugerirTemario('${matId}')">💡 Sugerir con IA</button>
                <button class="x-btn x-btn--ghost x-btn--sm"
                        onclick="TemarioProfHandlers.addUnidad('${matId}')">+ Añadir unidad</button>
            </div>
            <div class="x-temario">${unidadesHtml || `
                <div class="x-empty x-empty--inline" style="padding:32px 16px">
                    <div class="x-empty__icon">📚</div>
                    <div class="x-empty__title">Aún no hay temario</div>
                    <div class="x-empty__sub">Empieza con "+ Añadir unidad" o usa "💡 Sugerir con IA".</div>
                </div>`}</div>
        `;
    }

    // Re-render reactivo cuando TemarioData cambia.
    // El caller (hub wiring) marca el panel con data-temario-panel + data-current-matid.
    document.addEventListener("xahni:temarioActualizado", (e) => {
        const detail = e.detail || {};
        document.querySelectorAll('[data-temario-panel]').forEach(panel => {
            if (panel.dataset.currentMatid === detail.matId) {
                const rol = panel.dataset.temarioPanel; // 'alumno' | 'profesor'
                if (rol === "profesor") renderProfesor(panel.id, detail.matId);
                else renderAlumno(panel.id, detail.matId);
            }
        });
    });

    return {
        renderAlumno,
        renderProfesor
    };
})();
window.TemarioRender = TemarioRender;

// ═════════════════════════════════════════════════════════════════
// HANDLERS GLOBALES (onclick inline del render profesor)
// ═════════════════════════════════════════════════════════════════

window.TemarioProfHandlers = {
    addUnidad(matId) {
        TemarioData.addUnidad(matId, "Nueva unidad");
    },
    editUnidad(matId, uid, val) {
        TemarioData.updateUnidad(matId, uid, { titulo: (val || "").trim() || "Unidad sin título" });
    },
    deleteUnidad(matId, uid) {
        if (confirm("¿Eliminar esta unidad y todos sus subtemas?")) {
            TemarioData.deleteUnidad(matId, uid);
        }
    },
    moveUnidad(matId, uid, dir) {
        TemarioData.reorderUnidad(matId, uid, dir);
    },
    cycleEstadoUnidad(matId, uid) {
        const t = TemarioData.getTemario(matId);
        const u = t.unidades.find(x => x.id === uid);
        if (!u) return;
        const cycle = ["pendiente", "en-curso", "visto"];
        const next = cycle[(cycle.indexOf(u.estado) + 1) % cycle.length];
        TemarioData.setEstadoUnidad(matId, uid, next);
    },
    addSubtema(matId, uid) {
        TemarioData.addSubtema(matId, uid, "Nuevo subtema", "");
    },
    editSubtema(matId, uid, sid, val) {
        TemarioData.updateSubtema(matId, uid, sid, { titulo: (val || "").trim() || "Subtema sin título" });
    },
    editSubtemaDesc(matId, uid, sid, val) {
        TemarioData.updateSubtema(matId, uid, sid, { descripcion: (val || "").trim() });
    },
    deleteSubtema(matId, uid, sid) {
        if (confirm("¿Eliminar este subtema?")) {
            TemarioData.deleteSubtema(matId, uid, sid);
        }
    },
    cycleEstadoSubtema(matId, uid, sid) {
        const t = TemarioData.getTemario(matId);
        const u = t.unidades.find(x => x.id === uid);
        if (!u) return;
        const s = (u.subtemas || []).find(x => x.id === sid);
        if (!s) return;
        const cycle = ["pendiente", "en-curso", "visto"];
        const next = cycle[(cycle.indexOf(s.estado) + 1) % cycle.length];
        TemarioData.setEstadoSubtema(matId, uid, sid, next);
    }
};
