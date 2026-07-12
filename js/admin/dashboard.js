// js/admin/dashboard.js

// Actualiza tarjetas-resumen del admin-panel (totales de usuarios y
// instituciones). Consolidado desde vista-admin/admin.js para que los
// módulos de gestión (usuarios, instituciones, materias, horarios)
// tengan un único punto de sincronización tras cualquier mutación.
// Los IDs `admin-panel-*` viven en el markup admin que se incorpora
// en Phase C/E; mientras tanto los `if (el)` guards mantienen no-op.
/**
 * @interaction actualizar-metricas-admin-panel
 * @scope admin-dashboard-metricas
 *
 * Given DOM admin panel con `#admin-panel-{usuarios,estudiantes,profesores,instituciones}`.
 * When módulo CRUD (usuarios/instituciones/etc) muta data + necesita sync KPIs.
 * Then:
 *   1. Resuelve conteos via `usuariosConteo` + `institucionesConteo`
 *      shared (defensive typeof).
 *   2. Update 4 elements con `toLocaleString` para separadores de miles.
 * Edge:
 *   - **Consolidado cross-módulo**: punto único de sync tras mutations.
 *   - **`if (el)` guards** mantienen no-op si DOM admin panel no montado
 *     (Phase C/E gradual rollout).
 *   - **Exportado window** implícito (consumer cross-archivo).
 *   - Función IMPURA (DOM).
 */
function _actualizarMetricasAdminPanel() {
    const cu = (typeof usuariosConteo === "function")
        ? usuariosConteo()
        : { total: 0, estudiantes: 0, profesores: 0, administradores: 0 };
    const ci = (typeof institucionesConteo === "function")
        ? institucionesConteo()
        : { total: 0 };

    const usuariosEl     = document.getElementById("admin-panel-usuarios");
    const estudiantesEl  = document.getElementById("admin-panel-estudiantes");
    const profesoresEl   = document.getElementById("admin-panel-profesores");
    const institucionesEl = document.getElementById("admin-panel-instituciones");

    if (usuariosEl)     usuariosEl.textContent     = cu.total.toLocaleString();
    if (estudiantesEl)  estudiantesEl.textContent  = cu.estudiantes.toLocaleString();
    if (profesoresEl)   profesoresEl.textContent   = cu.profesores.toLocaleString();
    if (institucionesEl) institucionesEl.textContent = ci.total.toLocaleString();
}

/**
 * @interaction build-admin-panel
 * @scope admin-dashboard-entrypoint
 *
 * Given DOM admin panel con `#admin-activity` + `#admin-stats`.
 * When admin entra al dashboard.
 * Then:
 *   1. Sync métricas via `_actualizarMetricasAdminPanel`.
 *   2. Build actividad reciente (12 entries hardcoded DEMO con `.x-list-row`
 *      pattern homogéneo con dashboards alumno/profesor).
 *   3. Build estado del sistema (4 stats hardcoded: PostgreSQL +
 *      Supabase Auth + Edge Functions + Storage) con `.x-progress`.
 * Edge:
 *   - **TODO hardcoded DEMO**: actividad reciente + stats sistema son fake.
 *     Deuda post-Supabase: tabla `actividad_sistema` + dashboard ops real.
 *   - **Pattern `.x-list-row` consistente** con alumno/profesor (cementado
 *     regla rectora homogeneización).
 *   - **Twin con dashboard profesor/estudiante** estructura visual.
 *   - **Exportado window** implícito (consumer navigation).
 *   - Función IMPURA (DOM masivo).
 */
function buildAdminPanel() {
    _actualizarMetricasAdminPanel();
    // Actividad reciente del sistema — patrón homogéneo con dashboard alumno/profesor (.x-list-row).
    const actEl = document.getElementById("admin-activity");
    if (actEl) {
        actEl.innerHTML = [
            { dot:"var(--state-ok)",     text:"<strong>María López</strong> se registró como Estudiante",                  time:"Hace 5min"   },
            { dot:"var(--xahni-cyan)",   text:"Admin <strong>Roberto Silva</strong> inició sesión",                        time:"Hace 18min"  },
            { dot:"var(--xahni-blue)",   text:"Institución <strong>Esc. Primaria Margarida Masa</strong> agregada",        time:"Hace 1h"     },
            { dot:"var(--xahni-teal)",   text:"Materia <strong>Cálculo Vectorial</strong> archivada por cierre de cohorte",time:"Hace 3h"     },
            { dot:"var(--state-warn)",   text:"Backup automático completado — 350 MB",                                     time:"02:00 AM"    },
            { dot:"var(--xahni-amber)",  text:"Exportación CSV de calificaciones — <strong>1,820 registros</strong>",      time:"Ayer 14:42"  },
            { dot:"var(--xahni-purple)", text:"Reporte mensual generado y enviado a asesores",                             time:"Ayer 18:00"  },
            { dot:"var(--state-danger)", text:"Usuario ID-345 suspendido por violación de términos",                       time:"Hace 2 días" },
            { dot:"var(--xahni-blue)",   text:"<strong>3 carreras</strong> reactivadas en Inst. Politécnico Querétaro",    time:"Hace 3 días" },
            { dot:"var(--state-ok)",     text:"Cambio de rol — <strong>Ana Torres</strong> ahora es Profesora",            time:"Hace 4 días" },
            { dot:"var(--xahni-purple)", text:"Mantenimiento programado de Edge Functions — sin downtime",                 time:"Hace 5 días" },
            { dot:"var(--state-danger)", text:"Usuario eliminado — <strong>ID-218</strong> tras solicitud de baja",        time:"Hace 6 días" },
        ].map(a => `
            <div class="x-list-row">
              <span class="x-list-row__dot" style="background:${a.dot}"></span>
              <div class="x-list-row__body">
                <div class="x-list-row__title">${a.text}</div>
                <div class="x-list-row__meta">${a.time}</div>
              </div>
            </div>`).join("");
    }

    // Estado del sistema — barras canónicas .x-progress.
    const statsEl = document.getElementById("admin-stats");
    if (statsEl) {
        statsEl.innerHTML = [
            { label:"Almacenamiento PostgreSQL",         val:"350 MB / 1 GB",    pct:35, color:"var(--xahni-blue)"   },
            { label:"Supabase Auth — usuarios activos",  val:"1,245 / 10,000",   pct:12, color:"var(--xahni-teal)"   },
            { label:"Edge Functions — invocaciones",     val:"48,200 / 125,000", pct:39, color:"var(--xahni-amber)"  },
            { label:"Storage — archivos",                val:"2.1 GB / 5 GB",    pct:42, color:"var(--xahni-purple)" },
        ].map(s => `
            <div>
                <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                    <span style="font-size:12px;color:var(--text-secondary)">${s.label}</span>
                    <span class="x-mono-sm">${s.val}</span>
                </div>
                <div class="x-progress"><div class="x-progress__fill" style="width:${s.pct}%;background:${s.color}"></div></div>
            </div>`).join("");
    }
}
