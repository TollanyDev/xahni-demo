// js/profesor/crear-vf.js
// Slice Juegos beta A1 · 2026-06-05 · spec §5.3
//
// IIFE wizard CrearVF. API consistente con CrearQuiz para predictabilidad.
// Persiste en xahni:juegos:userCreated con shape canonical (tipo:'vf').

const CrearVF = (() => {
    const MAX_AFIRMACIONES = 15;
    const MIN_AFIRMACIONES = 3;
    let _state = null;

    function _nuevaAfirmacion() {
        return { id: "a" + Date.now() + Math.floor(Math.random() * 1000), texto: "", esVerdadera: null };
    }

    function _findMateria(materiaId) {
        if (typeof DEMO_MATERIAS === "undefined") return null;
        return (DEMO_MATERIAS || []).find(m => m.id === materiaId) || null;
    }

    function _actualizarSubmit() {
        const btn = document.getElementById("cv-submit");
        if (!btn) return;
        btn.disabled = !_validar();
    }

    function _validar() {
        if (!_state) return false;
        if (!_state.nombre || !_state.nombre.trim()) return false;
        if (_state.afirmaciones.length < MIN_AFIRMACIONES) return false;
        for (const a of _state.afirmaciones) {
            if (!a.texto || !a.texto.trim()) return false;
            if (a.esVerdadera === null || typeof a.esVerdadera === "undefined") return false;
        }
        return true;
    }

    function abrir(materiaId, temaId) {
        const mat = _findMateria(materiaId);
        _state = {
            materiaId,
            temaId: temaId || null,
            nombre: "",
            afirmaciones: [_nuevaAfirmacion(), _nuevaAfirmacion(), _nuevaAfirmacion()],
            idxActivo: 0
        };
        // Eyebrow
        const eyebrow = document.getElementById("cv-materia-eyebrow");
        if (eyebrow) eyebrow.textContent = "📚 " + (mat ? mat.nombre : "");
        // Input nombre reset
        const input = document.getElementById("cv-nombre");
        if (input) input.value = "";
        render();
        if (typeof openModal === "function") openModal("modal-crear-vf");
        _actualizarSubmit();
    }

    function irA(idx) {
        if (!_state) return;
        if (idx < 0 || idx >= _state.afirmaciones.length) return;
        _state.idxActivo = idx;
        render();
    }

    function setNombre(v) {
        if (!_state) return;
        _state.nombre = v;
        _actualizarSubmit();
    }

    function setCampo(idx, campo, v) {
        if (!_state || !_state.afirmaciones[idx]) return;
        _state.afirmaciones[idx][campo] = v;
        _actualizarSubmit();
    }

    function setCorrecta(idx, esVerdadera) {
        if (!_state || !_state.afirmaciones[idx]) return;
        _state.afirmaciones[idx].esVerdadera = esVerdadera;
        render();
        _actualizarSubmit();
    }

    function agregarAfirmacion() {
        if (!_state || _state.afirmaciones.length >= MAX_AFIRMACIONES) return;
        _state.afirmaciones.push(_nuevaAfirmacion());
        // Ir a la afirmación recién agregada.
        _state.idxActivo = _state.afirmaciones.length - 1;
        render();
    }

    function removerAfirmacion(idx) {
        if (!_state || _state.afirmaciones.length <= 1) return;
        _state.afirmaciones.splice(idx, 1);
        // Si eliminamos la activa o una previa, ajustar idxActivo.
        if (_state.idxActivo >= _state.afirmaciones.length) {
            _state.idxActivo = _state.afirmaciones.length - 1;
        }
        render();
        _actualizarSubmit();
    }

    function render() {
        const container = document.getElementById("cv-afirmaciones-container");
        if (!container || !_state) return;
        const total = _state.afirmaciones.length;
        const idx = _state.idxActivo || 0;
        const a = _state.afirmaciones[idx];
        if (!a) { container.innerHTML = ""; return; }
        const puedeEliminar = total > 1;
        container.innerHTML = `
            <div class="cw-nav">
                <button class="cw-nav__btn" type="button"
                        ${idx === 0 ? "disabled" : ""}
                        onclick="CrearVF.irA(${idx - 1})">← Anterior</button>
                <span class="cw-nav__counter">Afirmación <strong>${idx + 1}</strong> de ${total}</span>
                <button class="cw-nav__btn" type="button"
                        ${idx === total - 1 ? "disabled" : ""}
                        onclick="CrearVF.irA(${idx + 1})">Siguiente →</button>
            </div>
            <div class="cw-item">
                <div class="cw-item__head">
                    <span class="cw-item__label">Afirmación ${idx + 1}</span>
                    ${puedeEliminar ? `<button class="cw-item-delete" type="button" onclick="CrearVF.removerAfirmacion(${idx})" aria-label="Eliminar afirmación">✕</button>` : ""}
                </div>
                <textarea class="cv-textarea" placeholder="Escribe una afirmación clara"
                          oninput="CrearVF.setCampo(${idx}, 'texto', this.value)">${a.texto.replace(/</g, "&lt;")}</textarea>
                <div class="cv-afirmacion__binario">
                    <span>¿Es verdadera?</span>
                    <button class="x-btn ${a.esVerdadera === true ? 'x-btn--primary' : 'x-btn--ghost'}" type="button"
                            onclick="CrearVF.setCorrecta(${idx}, true)">✓ Verdadero</button>
                    <button class="x-btn ${a.esVerdadera === false ? 'x-btn--primary' : 'x-btn--ghost'}" type="button"
                            onclick="CrearVF.setCorrecta(${idx}, false)">✗ Falso</button>
                </div>
            </div>
        `;
    }

    function guardar() {
        if (!_validar() || !_state) return;
        const uid = (typeof APP !== "undefined" && APP.user) ? APP.user.id : "anon";
        const juego = {
            id: "user_" + uid + "_" + Date.now(),
            nombre: _state.nombre.trim(),
            tipo: "vf",
            materiaId: _state.materiaId,
            creadoPor: uid,
            afirmaciones: _state.afirmaciones.map(a => ({
                id: a.id,
                texto: a.texto.trim(),
                esVerdadera: a.esVerdadera
            })),
            creadoEn: new Date().toISOString()
        };
        try {
            const raw = localStorage.getItem("xahni:juegos:userCreated") || "[]";
            const arr = JSON.parse(raw);
            arr.push(juego);
            localStorage.setItem("xahni:juegos:userCreated", JSON.stringify(arr));
            if (typeof showToast === "function") showToast(`✓ V/F "${juego.nombre}" creado`, "ok");
            try {
                document.dispatchEvent(new CustomEvent("xahni:juegoCreado", { detail: { juego } }));
            } catch (e) { /* defensive */ }
            cerrar();
            // Re-render panel actual si está visible
            if (typeof renderPanelJuegosActual === "function") renderPanelJuegosActual();
        } catch (e) {
            console.error("[CrearVF] guardar fail:", e);
            if (typeof showToast === "function") showToast("Error al guardar", "danger");
        }
    }

    function cerrar() {
        if (typeof closeModal === "function") closeModal("modal-crear-vf");
        _state = null;
    }

    return {
        abrir, render, guardar, cerrar, irA,
        setNombre, setCampo, setCorrecta,
        agregarAfirmacion, removerAfirmacion,
        _MAX_AFIRMACIONES: MAX_AFIRMACIONES
    };
})();
window.CrearVF = CrearVF;
