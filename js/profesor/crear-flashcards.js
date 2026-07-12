// js/profesor/crear-flashcards.js
// Slice Juegos beta A1 · 2026-06-05 · spec §5.4

const CrearFlashcards = (() => {
    const MAX_TARJETAS = 20;
    const MIN_TARJETAS = 5;
    let _state = null;

    function _nuevaTarjeta() {
        return { id: "t" + Date.now() + Math.floor(Math.random() * 1000), anverso: "", reverso: "" };
    }

    function _findMateria(materiaId) {
        if (typeof DEMO_MATERIAS === "undefined") return null;
        return (DEMO_MATERIAS || []).find(m => m.id === materiaId) || null;
    }

    function _actualizarSubmit() {
        const btn = document.getElementById("cf-submit");
        if (!btn) return;
        btn.disabled = !_validar();
    }

    function _validar() {
        if (!_state) return false;
        if (!_state.nombre || !_state.nombre.trim()) return false;
        if (_state.tarjetas.length < MIN_TARJETAS) return false;
        for (const t of _state.tarjetas) {
            if (!t.anverso || !t.anverso.trim()) return false;
            if (!t.reverso || !t.reverso.trim()) return false;
        }
        return true;
    }

    function abrir(materiaId, temaId) {
        const mat = _findMateria(materiaId);
        _state = {
            materiaId,
            temaId: temaId || null,
            nombre: "",
            tarjetas: Array.from({ length: MIN_TARJETAS }, () => _nuevaTarjeta()),
            idxActivo: 0
        };
        const eyebrow = document.getElementById("cf-materia-eyebrow");
        if (eyebrow) eyebrow.textContent = "📚 " + (mat ? mat.nombre : "");
        const input = document.getElementById("cf-nombre");
        if (input) input.value = "";
        render();
        if (typeof openModal === "function") openModal("modal-crear-flashcards");
        _actualizarSubmit();
    }

    function irA(idx) {
        if (!_state) return;
        if (idx < 0 || idx >= _state.tarjetas.length) return;
        _state.idxActivo = idx;
        render();
    }

    function setNombre(v) {
        if (!_state) return;
        _state.nombre = v;
        _actualizarSubmit();
    }

    function setCampo(idx, campo, v) {
        if (!_state || !_state.tarjetas[idx]) return;
        if (campo !== "anverso" && campo !== "reverso") return;
        _state.tarjetas[idx][campo] = v;
        _actualizarSubmit();
    }

    function agregarTarjeta() {
        if (!_state || _state.tarjetas.length >= MAX_TARJETAS) return;
        _state.tarjetas.push(_nuevaTarjeta());
        // Ir a la tarjeta recién agregada.
        _state.idxActivo = _state.tarjetas.length - 1;
        render();
    }

    function removerTarjeta(idx) {
        if (!_state || _state.tarjetas.length <= 1) return;
        _state.tarjetas.splice(idx, 1);
        // Ajustar idxActivo si era el última o posterior.
        if (_state.idxActivo >= _state.tarjetas.length) {
            _state.idxActivo = _state.tarjetas.length - 1;
        }
        render();
        _actualizarSubmit();
    }

    function render() {
        const container = document.getElementById("cf-tarjetas-container");
        if (!container || !_state) return;
        const total = _state.tarjetas.length;
        const idx = _state.idxActivo || 0;
        const t = _state.tarjetas[idx];
        if (!t) { container.innerHTML = ""; return; }
        const puedeEliminar = total > 1;
        container.innerHTML = `
            <div class="cw-nav">
                <button class="cw-nav__btn" type="button"
                        ${idx === 0 ? "disabled" : ""}
                        onclick="CrearFlashcards.irA(${idx - 1})">← Anterior</button>
                <span class="cw-nav__counter">Tarjeta <strong>${idx + 1}</strong> de ${total}</span>
                <button class="cw-nav__btn" type="button"
                        ${idx === total - 1 ? "disabled" : ""}
                        onclick="CrearFlashcards.irA(${idx + 1})">Siguiente →</button>
            </div>
            <div class="cw-item">
                <div class="cw-item__head">
                    <span class="cw-item__label">Tarjeta ${idx + 1}</span>
                    ${puedeEliminar ? `<button class="cw-item-delete" type="button" onclick="CrearFlashcards.removerTarjeta(${idx})" aria-label="Eliminar tarjeta">✕</button>` : ""}
                </div>
                <div class="cf-tarjeta__cuerpo">
                    <div class="cf-tarjeta__col">
                        <label>Anverso</label>
                        <textarea placeholder="Concepto a memorizar"
                                  oninput="CrearFlashcards.setCampo(${idx}, 'anverso', this.value)">${t.anverso.replace(/</g, "&lt;")}</textarea>
                    </div>
                    <div class="cf-tarjeta__col">
                        <label>Reverso</label>
                        <textarea placeholder="Definición / respuesta"
                                  oninput="CrearFlashcards.setCampo(${idx}, 'reverso', this.value)">${t.reverso.replace(/</g, "&lt;")}</textarea>
                    </div>
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
            tipo: "flashcards",
            materiaId: _state.materiaId,
            creadoPor: uid,
            tarjetas: _state.tarjetas.map(t => ({
                id: t.id,
                anverso: t.anverso.trim(),
                reverso: t.reverso.trim()
            })),
            creadoEn: new Date().toISOString()
        };
        try {
            const raw = localStorage.getItem("xahni:juegos:userCreated") || "[]";
            const arr = JSON.parse(raw);
            arr.push(juego);
            localStorage.setItem("xahni:juegos:userCreated", JSON.stringify(arr));
            if (typeof showToast === "function") showToast(`✓ Flashcards "${juego.nombre}" creado`, "ok");
            try {
                document.dispatchEvent(new CustomEvent("xahni:juegoCreado", { detail: { juego } }));
            } catch (e) { /* defensive */ }
            cerrar();
            if (typeof renderPanelJuegosActual === "function") renderPanelJuegosActual();
        } catch (e) {
            console.error("[CrearFlashcards] guardar fail:", e);
            if (typeof showToast === "function") showToast("Error al guardar", "danger");
        }
    }

    function cerrar() {
        if (typeof closeModal === "function") closeModal("modal-crear-flashcards");
        _state = null;
    }

    return {
        abrir, render, guardar, cerrar, irA,
        setNombre, setCampo,
        agregarTarjeta, removerTarjeta,
        _MAX_TARJETAS: MAX_TARJETAS
    };
})();
window.CrearFlashcards = CrearFlashcards;
