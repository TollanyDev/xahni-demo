// js/profesor/competencias-crear.js
// Slice Competencias beta C6 · 2026-06-06 · spec §7
//
// CrearTorneo wizard mixto:
// - Tab "Mis juegos": lista juegos creados por el profesor + radio select
// - Tab "Crear nuevo": handoff a CrearSelector + re-abre con state preservado

const CrearTorneo = (() => {

    let _state = null;
    let _stateBuffer = null;  // preservar entre handoffs con CrearSelector

    function abrir(materiaId, opts) {
        opts = opts || {};
        const uid = APP?.user?.id;
        if (!uid || APP.user.tipo !== "profesor") return;

        if (opts.preserveBuffer && _stateBuffer) {
            _state = _stateBuffer;
            _stateBuffer = null;
        } else {
            // Si no se pasó materiaId, usar la del primer juego del profesor
            const matInicial = materiaId || _materiaPorDefault(uid);
            _state = {
                materiaId: matInicial,
                nombre: "",
                juegoId: null,
                gruposInscritos: [],
                fechaInicio: _defaultFechaInicio(),
                fechaFin: _defaultFechaFin(),
                tabActivo: "mis-juegos"
            };
        }

        _render();
        if (typeof openModal === "function") openModal("modal-crear-torneo");
        _actualizarSubmit();
    }

    function _materiaPorDefault(uid) {
        // Si el profe tiene materias, retorna la primera
        const users = (typeof DEMO_USERS !== "undefined" ? DEMO_USERS : []);
        const u = users.find(x => x.id === uid);
        return (u?.materias || [])[0] || "bd";
    }

    function _defaultFechaInicio() {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(8, 0, 0, 0);
        return d.toISOString().slice(0, 16);
    }

    function _defaultFechaFin() {
        const d = new Date();
        d.setDate(d.getDate() + 5);
        d.setHours(23, 59, 0, 0);
        return d.toISOString().slice(0, 16);
    }

    function _render() {
        const body = document.getElementById("ctn-body");
        if (!body || !_state) return;

        const matNom = (typeof DEMO_MATERIAS !== "undefined" ? DEMO_MATERIAS : [])
            .find(m => m.id === _state.materiaId)?.nombre || _state.materiaId;
        document.getElementById("ctn-eyebrow").textContent = `📚 ${matNom}`;

        const grupos = (typeof DEMO_GRUPOS !== "undefined" ? DEMO_GRUPOS : [])
            .filter(g => (g.materias || []).includes(_state.materiaId));

        body.innerHTML = `
            <div class="ctn-field">
                <span class="ctn-field__label">Nombre del torneo</span>
                <input type="text" class="ctn-input" placeholder="Ej. Quiz Triggers Final" value="${_state.nombre.replace(/"/g, "&quot;")}" oninput="CrearTorneo.setNombre(this.value)">
            </div>

            <div class="ctn-field">
                <span class="ctn-field__label">Juego del torneo</span>
                <div class="ctn-tabs">
                    <div class="ctn-tab ${_state.tabActivo === 'mis-juegos' ? 'ctn-tab--active' : ''}" onclick="CrearTorneo.switchTab('mis-juegos')">Mis juegos</div>
                    <div class="ctn-tab ${_state.tabActivo === 'crear-nuevo' ? 'ctn-tab--active' : ''}" onclick="CrearTorneo.switchTab('crear-nuevo')">Crear nuevo</div>
                </div>
                ${_state.tabActivo === 'mis-juegos' ? _renderTabMisJuegos() : _renderTabCrearNuevo()}
            </div>

            <div class="ctn-field">
                <span class="ctn-field__label">Grupos inscritos (mínimo 2)</span>
                <div class="ctn-grupos-checkboxes">
                    ${grupos.length === 0
                        ? `<div style="color:var(--text-muted);font-size:12px">Sin grupos en esta materia</div>`
                        : grupos.map(g => `
                            <label>
                                <input type="checkbox" ${_state.gruposInscritos.includes(g.id) ? "checked" : ""} onchange="CrearTorneo.toggleGrupo('${g.id}')">
                                <span>${typeof _displayGrupoLabel === "function" ? _displayGrupoLabel(g.id, 28) : g.id}</span>
                            </label>
                        `).join("")}
                </div>
            </div>

            <div class="ctn-field">
                <span class="ctn-field__label">Fechas</span>
                <div class="ctn-fechas">
                    <div>
                        <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Inicio</div>
                        <input type="datetime-local" class="ctn-input" value="${_state.fechaInicio}" onchange="CrearTorneo.setFecha('fechaInicio', this.value)">
                    </div>
                    <div>
                        <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Cierre</div>
                        <input type="datetime-local" class="ctn-input" value="${_state.fechaFin}" onchange="CrearTorneo.setFecha('fechaFin', this.value)">
                    </div>
                </div>
            </div>
        `;
    }

    function _renderTabMisJuegos() {
        const uid = APP.user.id;
        const juegos = (typeof DEMO_JUEGOS !== "undefined" ? DEMO_JUEGOS : [])
            .concat(_getUserCreatedJuegos())
            .filter(j => j.materiaId === _state.materiaId && j.creadoPor === uid);
        if (juegos.length === 0) {
            return `<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center">
                Sin juegos creados en esta materia. Usa el tab "Crear nuevo".
            </div>`;
        }
        return `<div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto">
            ${juegos.map(j => {
                const chipIa = j.origen === "ia"
                    ? `<span class="x-chip-ia" title="Juego generado por Gemini IA" style="margin-left:6px">✨ Gemini</span>`
                    : "";
                return `
                <div class="ctn-juego-row ${_state.juegoId === j.id ? 'ctn-juego-row--selected' : ''}" onclick="CrearTorneo.setJuego('${j.id}')">
                    <input type="radio" name="ctn-juego" ${_state.juegoId === j.id ? "checked" : ""}>
                    <div>
                        <div style="font-size:13px;font-weight:600;display:flex;align-items:center;flex-wrap:wrap">
                            <span>${(j.nombre || "").replace(/</g, "&lt;")}</span>${chipIa}
                        </div>
                        <div style="font-size:11px;color:var(--text-muted)">${j.tipo.toUpperCase()} · ${_countItems(j)} items</div>
                    </div>
                </div>
            `;}).join("")}
        </div>`;
    }

    function _renderTabCrearNuevo() {
        return `<div style="padding:18px;text-align:center;background:var(--surface-2);border-radius:var(--r-sm)">
            <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">
                Crea un juego nuevo desde el flujo estándar. Tus datos del torneo se preservan.
            </div>
            <button class="x-btn x-btn--primary" onclick="CrearTorneo._handoffCrearJuego()">＋ Abrir creador de juego</button>
        </div>`;
    }

    function _countItems(j) {
        if (j.tipo === "quiz") return (j.preguntas || []).length;
        if (j.tipo === "vf") return (j.afirmaciones || []).length;
        if (j.tipo === "flashcards") return (j.tarjetas || []).length;
        return 0;
    }

    function _getUserCreatedJuegos() {
        try { return JSON.parse(localStorage.getItem("xahni:juegos:userCreated") || "[]"); }
        catch (e) { return []; }
    }

    function _handoffCrearJuego() {
        // Preservar state + cerrar + abrir CrearSelector
        _stateBuffer = Object.assign({}, _state);
        cerrar({ preserveState: true });
        if (typeof CrearSelector !== "undefined" && typeof CrearSelector.abrir === "function") {
            CrearSelector.abrir(_state.materiaId);
        }
    }

    function setNombre(v) {
        if (!_state) return;
        _state.nombre = v;
        _actualizarSubmit();
    }

    function setJuego(juegoId) {
        if (!_state) return;
        _state.juegoId = juegoId;
        _render();
        _actualizarSubmit();
    }

    function toggleGrupo(grupoId) {
        if (!_state) return;
        const idx = _state.gruposInscritos.indexOf(grupoId);
        if (idx >= 0) _state.gruposInscritos.splice(idx, 1);
        else _state.gruposInscritos.push(grupoId);
        _actualizarSubmit();
    }

    function setFecha(campo, valor) {
        if (!_state) return;
        if (campo !== "fechaInicio" && campo !== "fechaFin") return;
        _state[campo] = valor;
        _actualizarSubmit();
    }

    function switchTab(tabName) {
        if (!_state) return;
        if (tabName !== "mis-juegos" && tabName !== "crear-nuevo") return;
        if (tabName === "crear-nuevo") {
            _handoffCrearJuego();
            return;
        }
        _state.tabActivo = tabName;
        _render();
    }

    function _validar() {
        if (!_state) return false;
        if (!_state.nombre || !_state.nombre.trim()) return false;
        if (!_state.juegoId) return false;
        if (_state.gruposInscritos.length < 2) return false;
        const ini = new Date(_state.fechaInicio);
        const fin = new Date(_state.fechaFin);
        if (isNaN(ini.getTime()) || isNaN(fin.getTime())) return false;
        if (ini >= fin) return false;
        if (fin <= new Date()) return false;
        return true;
    }

    function _actualizarSubmit() {
        const btn = document.getElementById("ctn-submit");
        if (btn) btn.disabled = !_validar();
    }

    function guardar() {
        if (!_validar() || !_state) return;
        const uid = APP.user.id;
        const juego = _findJuego(_state.juegoId);
        const torneo = {
            id: "comp_user_" + uid + "_" + Date.now(),
            nombre: _state.nombre.trim(),
            materiaId: _state.materiaId,
            tipo: juego?.tipo || "quiz",
            juegoId: _state.juegoId,
            gruposInscritos: _state.gruposInscritos.slice(),
            estado: "proxima",
            fechaInicio: new Date(_state.fechaInicio).toISOString(),
            fechaFin: new Date(_state.fechaFin).toISOString(),
            cerradoEn: null,
            resultados: {},
            creadoPor: uid
        };
        try {
            const raw = localStorage.getItem("xahni:comp:userCreatedTorneos") || "[]";
            const arr = JSON.parse(raw);
            arr.push(torneo);
            localStorage.setItem("xahni:comp:userCreatedTorneos", JSON.stringify(arr));
            // Append a DEMO runtime para visibility inmediata
            if (typeof DEMO_COMPETENCIAS !== "undefined") DEMO_COMPETENCIAS.push(torneo);
            if (typeof showToast === "function") {
                showToast(`✓ Torneo "${torneo.nombre}" creado · ${torneo.gruposInscritos.length} grupos`, "ok");
            }
            try {
                document.dispatchEvent(new CustomEvent("xahni:torneoCreado", { detail: { torneo: torneo } }));
            } catch (err) { /* defensive */ }
            cerrar();
        } catch (e) {
            console.error("[CrearTorneo] guardar fail:", e);
            if (typeof showToast === "function") showToast("Error al crear torneo", "danger");
        }
    }

    function _findJuego(juegoId) {
        const seeds = (typeof DEMO_JUEGOS !== "undefined" ? DEMO_JUEGOS : []);
        const user = _getUserCreatedJuegos();
        return seeds.concat(user).find(j => j.id === juegoId);
    }

    function cerrar(opts) {
        opts = opts || {};
        if (typeof closeModal === "function") closeModal("modal-crear-torneo");
        if (!opts.preserveState) _state = null;
    }

    // Listener para re-abrir después de que se crea un juego
    document.addEventListener("xahni:juegoCreado", e => {
        if (_stateBuffer) {
            const juegoNuevo = e.detail?.juego;
            if (juegoNuevo && juegoNuevo.id) {
                _stateBuffer.juegoId = juegoNuevo.id;
                _stateBuffer.tabActivo = "mis-juegos";
            }
            abrir(null, { preserveBuffer: true });
        }
    });

    return {
        abrir: abrir,
        cerrar: cerrar,
        setNombre: setNombre,
        setJuego: setJuego,
        toggleGrupo: toggleGrupo,
        setFecha: setFecha,
        switchTab: switchTab,
        guardar: guardar,
        _handoffCrearJuego: _handoffCrearJuego
    };

})();
window.CrearTorneo = CrearTorneo;
