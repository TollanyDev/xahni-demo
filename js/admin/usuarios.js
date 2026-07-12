// js/admin/usuarios.js

/**
 * @interaction usuarios-conteo-y-enrich
 * @scope admin-usuarios-helpers
 *
 * Given DEMO_USERS array global / objeto user.
 * When `_actualizarMetricasAdminPanel` necesita KPIs o `buildUsuarios`
 *   enriquece para render.
 * Then 2 helpers combined:
 *   - `usuariosConteo()`: agrega counts {total, estudiantes, profesores,
 *     administradores} via filter. Twin con `institucionesConteo`.
 *   - `_enrichUsuario(u)`: spread con defaults `estado:"Activo"` +
 *     `iniciales` derivadas del nombre.
 * Edge:
 *   - **`_enrichUsuario` deriva campos faltantes** (deuda demo aceptada
 *     §6/§10 docs/merges/2026-05-14).
 *   - **`iniciales` heurística**: primeras 2 palabras del nombre, primer
 *     char de cada.
 *   - Funciones PURAS.
 *   - Slice pre-c10 #9.A 2026-05-27.
 */
function usuariosConteo() {
    const all = Array.isArray(DEMO_USERS) ? DEMO_USERS : [];
    return {
        total:          all.length,
        estudiantes:    all.filter(u => u.tipo === "estudiante").length,
        profesores:     all.filter(u => u.tipo === "profesor").length,
        administradores: all.filter(u => u.tipo === "administrador").length,
    };
}

// Deriva los campos que el JSON canónico de usuarios no tiene aún (estado).
// Patrón aceptado como deuda demo en docs/merges/2026-05-14-merge-vista-admin-main.md §6/§10.
function _enrichUsuario(u) {
    return {
        ...u,
        estado: u.estado || "Activo",
        iniciales: u.iniciales || (u.nombre || "").split(" ").slice(0, 2).map(w => w[0] || "").join(""),
    };
}

const _USR_ROL_MAP = {
    estudiante:    { chip: "x-chip--ok",   av: "var(--xahni-teal)",   label: "estudiante" },
    profesor:      { chip: "x-chip--warn", av: "var(--xahni-amber)",  label: "profesor" },
    administrador: { chip: "x-chip--info", av: "var(--xahni-purple)", label: "admin" },
};

/**
 * @interaction build-usuarios
 * @scope admin-usuarios-render-tabla
 *
 * Given DEMO_USERS + DOM `#usuarios-tbody`.
 * When admin entra a tab Usuarios o tras CRUD mutation.
 * Then renderer tabla:
 *   1. Empty state si DEMO_USERS vacío.
 *   2. Map `_enrichUsuario` por defaults.
 *   3. Por row:
 *      - Avatar con `getAvatarDisplay` canonical fallback iniciales.
 *      - Nombre + email + chip rol (mapeado por `_USR_ROL_MAP`).
 *      - Nivel mono + chip estado (ok/danger).
 *      - 3 botones acción: Editar / Suspender|Reactivar / Eliminar 🗑.
 * Edge:
 *   - **`_USR_ROL_MAP` con 3 entradas** (estudiante/profesor/administrador)
 *     fallback estudiante.
 *   - **Botón Suspender/Reactivar bifurcado** por estado actual.
 *   - **`_escapeHtml` canonical** en nombre/email/estado.
 *   - **Avatar canonical Pilar 1** integrado.
 *   - Función IMPURA (DOM).
 */
function buildUsuarios() {
    const el = document.getElementById("usuarios-tbody");
    if (!el) return;
    if (!Array.isArray(DEMO_USERS) || DEMO_USERS.length === 0) {
        el.innerHTML = `<tr><td colspan="6"><div class="x-empty x-empty--inline"><div class="x-empty__title">Sin usuarios</div></div></td></tr>`;
        return;
    }

    const usuarios = DEMO_USERS.map(_enrichUsuario);
    el.innerHTML = usuarios.map(u => {
        const rol = _USR_ROL_MAP[u.tipo] || _USR_ROL_MAP.estudiante;
        const estadoChip = u.estado === "Activo" ? "x-chip--ok" : "x-chip--danger";
        return `
        <tr data-uid="${u.id}">
            <td class="name" data-label="Usuario">
                <div style="display:flex;align-items:center;gap:10px">
                    <div class="x-list-row__avatar" style="color:${rol.av};background:${rol.av}22;width:28px;height:28px;font-size:10px">${_escapeHtml((typeof getAvatarDisplay === 'function' ? getAvatarDisplay(u.id).fotoTexto : u.iniciales))}</div>
                    ${_escapeHtml(u.nombre)}
                </div>
            </td>
            <td data-label="Correo">${_escapeHtml(u.email)}</td>
            <td data-label="Rol"><span class="x-chip ${rol.chip}">${rol.label}</span></td>
            <td data-label="Nivel"><span class="x-mono-sm">Niv. ${u.nivel ?? 0}</span></td>
            <td data-label="Estado"><span class="x-chip ${estadoChip}">${_escapeHtml(u.estado)}</span></td>
            <td data-label="Acciones" class="x-cell-actions">
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                    <button class="x-btn x-btn--ghost" style="padding:5px 12px;font-size:11px"
                        onclick="editarUsuario('${u.id}')">Editar</button>
                    <button class="x-btn x-btn--ghost" style="padding:5px 10px;font-size:11px"
                        onclick="suspenderUsuario('${u.id}')">${u.estado === "Activo" ? "Suspender" : "Reactivar"}</button>
                    <button class="x-btn x-btn--ghost" style="padding:5px 10px;font-size:11px;color:var(--xahni-red)"
                        onclick="eliminarUsuario('${u.id}')" title="Eliminar usuario"><svg class="x-icon"><use href="#x-icon-trash"></use></svg></button>
                </div>
            </td>
        </tr>`;
    }).join("");
}

/**
 * @interaction suspender-usuario
 * @scope admin-usuarios
 *
 * Given: admin viendo la tabla de usuarios; un usuario tiene estado='Activo' o 'Inactivo'
 * When:  click en botón "Suspender" (si Activo) o "Reactivar" (si Inactivo)
 * Then:  toggle de estado vía DataService.saveUsuario (preserva resto de campos);
 *        re-renderea la tabla; toast confirmando la acción
 * Edge:
 *   - usuario no encontrado → toast error, no-op
 *   - acción reversible — no requiere modal de confirmación
 */
async function suspenderUsuario(uid) {
    const u = (DEMO_USERS || []).find(x => x.id === uid);
    if (!u) { showToast("Usuario no encontrado", "error"); return; }
    const enriched = _enrichUsuario(u);
    const nuevoEstado = enriched.estado === "Activo" ? "Inactivo" : "Activo";
    await DataService.saveUsuario({ ...u, estado: nuevoEstado });
    buildUsuarios();
    showToast(`${u.nombre} ${nuevoEstado === "Inactivo" ? "suspendido" : "reactivado"}`, "success");
}

/**
 * @interaction eliminar-usuario
 * @scope admin-usuarios
 *
 * Given: admin viendo la tabla de usuarios; uid de usuario a eliminar
 * When:  click en botón 🗑
 * Then:  abre modal-confirmar genérico (confirmarCanonico) con copy explícito;
 *        si admin confirma: DataService.deleteUsuario + re-render tabla + toast
 * Edge:
 *   - usuario no encontrado → toast error
 *   - admin intenta eliminarse a sí mismo → bloquear con toast (safety guard)
 *   - confirmarCanonico no disponible → fallback a window.confirm
 *   - cancelar (Escape/overlay/botón Cancelar) → no-op
 */
async function eliminarUsuario(uid) {
    const u = (DEMO_USERS || []).find(x => x.id === uid);
    if (!u) { showToast("Usuario no encontrado", "error"); return; }
    if (APP.user && APP.user.id === uid) {
        showToast("No puedes eliminar tu propia cuenta", "error");
        return;
    }
    let ok;
    if (typeof confirmarCanonico === "function") {
        ok = await confirmarCanonico({
            titulo:      "Eliminar usuario",
            mensaje:     `Se eliminará "${_escapeHtml(u.nombre)}" del sistema. Esta acción no se puede deshacer. Si solo quieres bloquear el acceso temporalmente, usa "Suspender" en su lugar.`,
            accionTexto: "Eliminar",
            tipo:        "danger",
            icono:       "🗑",
        });
    } else {
        ok = window.confirm(`¿Eliminar usuario "${u.nombre}"? Esta acción no se puede deshacer.`);
    }
    if (!ok) return;
    await DataService.deleteUsuario(uid);
    buildUsuarios();
    showToast(`Usuario "${u.nombre}" eliminado`, "success");
}

/**
 * @interaction editar-usuario
 * @scope admin-usuarios-modal-editar
 *
 * Given uid + DOM modal `modal-editar-usuario` con 6 inputs.
 * When admin click "Editar" en row.
 * Then:
 *   1. Lookup u. Sin → toast error.
 *   2. Prepobla 6 inputs (id + nombre + email + tipo + nivel + estado).
 *   3. openModal canonical.
 * Edge:
 *   - **`_enrichUsuario` para estado fallback** (DEMO sin campo explícito).
 *   - **Exportado window** (onclick inline tabla).
 *   - Función IMPURA.
 */
function editarUsuario(uid) {
    const u = (DEMO_USERS || []).find(x => x.id === uid);
    if (!u) { showToast("Usuario no encontrado", "error"); return; }
    document.getElementById("edit-usr-id").value     = u.id;
    document.getElementById("edit-usr-nombre").value = u.nombre || "";
    document.getElementById("edit-usr-email").value  = u.email  || "";
    document.getElementById("edit-usr-tipo").value   = u.tipo   || "estudiante";
    document.getElementById("edit-usr-nivel").value  = u.nivel  ?? 1;
    document.getElementById("edit-usr-estado").value = _enrichUsuario(u).estado;
    openModal("modal-editar-usuario");
}

/**
 * @interaction guardar-usuario
 * @scope admin-usuarios-modal-submit
 *
 * Given user en modal con 6 inputs editados.
 * When click "Guardar".
 * Then async pipeline:
 *   1. Lee uid del input hidden.
 *   2. Lookup u. Sin → toast error.
 *   3. Lee 6 campos con fallbacks defensive (preserva original si vacío).
 *   4. **`parseInt nivel` con isNaN guard** preserva original si inválido.
 *   5. Deriva iniciales del nombre nuevo.
 *   6. **`await DataService.saveUsuario({...})`** — persistencia centralizada
 *      (Bloqueante 2, 2026-05-15).
 *   7. close modal + toast + buildUsuarios.
 * Edge:
 *   - **Upsert demo preserva identidad referencial**; prod escribe Firestore
 *     con merge.
 *   - **`trim() || u.field` fallback** evita guardar string vacío.
 *   - **Exportado window** (onclick inline modal).
 *   - Función IMPURA (DataService + DOM).
 */
async function guardarUsuario() {
    const uid = document.getElementById("edit-usr-id").value;
    const u = (DEMO_USERS || []).find(x => x.id === uid);
    if (!u) { showToast("Usuario no encontrado", "error"); return; }

    const nombre = document.getElementById("edit-usr-nombre").value.trim() || u.nombre;
    const email  = document.getElementById("edit-usr-email").value.trim()  || u.email;
    const tipo   = document.getElementById("edit-usr-tipo").value;
    const nivelInput = parseInt(document.getElementById("edit-usr-nivel").value, 10);
    const nivel  = isNaN(nivelInput) ? u.nivel : nivelInput;
    const estado = document.getElementById("edit-usr-estado").value;
    const iniciales = (nombre || "").split(" ").slice(0, 2).map(w => w[0] || "").join("");

    await DataService.saveUsuario({ id: uid, nombre, email, tipo, nivel, estado, iniciales });

    closeModal("modal-editar-usuario");
    showToast(`Usuario ${nombre} actualizado`, "success");
    buildUsuarios();
}

/**
 * @interaction crear-usuario-admin
 * @scope admin-usuarios-create
 *
 * Given admin clickea "Crear usuario" en modal-nuevo-usuario con form lleno
 *   (nombre, email, password, tipo estudiante|profesor).
 * When form submit dispara este handler.
 * Then:
 *   1. Limpia error inline previo.
 *   2. Lee nombre, email, password, tipo del form (#nu-tipo es select).
 *   3. Valida campos requeridos (HTML5 required + chequeo defensivo).
 *   4. Llama crearUsuarioConAuth({email, password, nombre, tipo}).
 *      - En demo mode: fallback a DataService.saveUsuario directo.
 *      - En prod mode: secondary Firebase app crea Auth user sin desloguear admin.
 *   5. Si OK: cierra modal, toast success, refresh tabla via buildUsuarios.
 *   6. Si error: muestra mensaje inline en #nu-error (modal NO se cierra).
 * Edge:
 *   - auth/email-already-in-use → mensaje user-friendly.
 *   - auth/weak-password → mensaje user-friendly.
 *   - auth/invalid-email → mensaje user-friendly.
 *   - Slice G2 sprint-entrega-jun8 2026-06-06.
 */
async function crearUsuarioAdmin() {
    const errorEl = document.getElementById("nu-error");
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ""; }

    const nombre = document.getElementById("nu-nombre").value.trim();
    const email = document.getElementById("nu-email").value.trim();
    const password = document.getElementById("nu-password").value;
    const tipo = document.getElementById("nu-tipo").value;

    if (!nombre || !email || !password) {
        if (errorEl) {
            errorEl.textContent = "Completa todos los campos.";
            errorEl.hidden = false;
        }
        return;
    }

    try {
        const created = await crearUsuarioConAuth({ email, password, nombre, tipo });
        closeModal("modal-nuevo-usuario");
        if (typeof showToast === "function") {
            showToast(`Usuario ${created.nombre || nombre} creado correctamente.`, "success");
        }
        // Reset form para próximo uso
        const form = document.getElementById("form-nuevo-usuario");
        if (form) form.reset();
        // Refresh tabla
        if (typeof buildUsuarios === "function") {
            buildUsuarios();
        } else if (typeof AdminUsuarios !== "undefined" && AdminUsuarios.render) {
            AdminUsuarios.render();
        }
    } catch (e) {
        if (errorEl) {
            let msg = e.message || "Error desconocido al crear usuario.";
            if (e.code === "auth/email-already-in-use") {
                msg = "Ya existe una cuenta con ese email.";
            } else if (e.code === "auth/weak-password") {
                msg = "Password muy débil. Usa al menos 6 caracteres.";
            } else if (e.code === "auth/invalid-email") {
                msg = "Email inválido.";
            }
            errorEl.textContent = msg;
            errorEl.hidden = false;
        }
    }
}
window.crearUsuarioAdmin = crearUsuarioAdmin;
