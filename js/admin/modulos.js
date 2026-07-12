// js/admin/modulos.js

const ADMIN_MODULOS_DATA = [
    {
        icono:      "👥",
        nombre:     "Usuarios",
        total:      1245,
        detalle: [
            { label: "Estudiantes",     valor: 980,  color: "var(--xahni-teal)"   },
            { label: "Profesores",      valor: 240,  color: "var(--xahni-amber)"  },
            { label: "Administradores", valor: 25,   color: "var(--xahni-purple)" },
        ],
        accion:  "Gestionar",
        vista:   "gestion-usuarios",
        color:   "var(--xahni-blue)",
        tendencia: "+23 este mes",
        up: true,
    },
    {
        icono:      "📚",
        nombre:     "Materias",
        total:      48,
        detalle: [
            { label: "Activas",     valor: 42, color: "var(--xahni-green)"  },
            // 4.E: "Inactivas" → "Archivadas" para reflejar el enum nuevo.
            { label: "Archivadas",  valor: 4,  color: "var(--text-muted)"   },
            { label: "En riesgo",   valor: 2,  color: "var(--xahni-red)"    },
        ],
        accion:  "Ver materias",
        vista:   "gestion-materias",
        color:   "var(--xahni-teal)",
        tendencia: "+3 este cuatrimestre",
        up: true,
    },
    {
        icono:      "👨‍👩‍👧‍👦",
        nombre:     "Grupos",
        total:      36,
        detalle: [
            { label: "Activos",     valor: 30, color: "var(--xahni-green)"  },
            { label: "Inactivos",   valor: 4,  color: "var(--text-muted)"   },
            { label: "Nuevos",      valor: 2,  color: "var(--xahni-cyan)"   },
        ],
        accion:  "Ver grupos",
        vista:   "gestion-grupos",
        color:   "var(--xahni-purple)",
        tendencia: "→ Sin cambios",
        up: false,
    },
    {
        icono:      "🏫",
        nombre:     "Instituciones",
        total:      15,
        detalle: [
            { label: "Universidades", valor: 8, color: "var(--xahni-blue)"   },
            { label: "Preparatorias", valor: 5, color: "var(--xahni-amber)"  },
            { label: "Primarias",     valor: 2, color: "var(--xahni-teal)"   },
        ],
        accion:  "Administrar",
        vista:   "gestion-instituciones",
        color:   "var(--xahni-amber)",
        tendencia: "+1 este mes",
        up: true,
    },
    {
        icono:      "🏆",
        nombre:     "Competencias",
        total:      12,
        detalle: [
            { label: "Activas",     valor: 2,  color: "var(--xahni-green)"  },
            { label: "Próximas",    valor: 5,  color: "var(--xahni-amber)"  },
            { label: "Terminadas",  valor: 5,  color: "var(--text-muted)"   },
        ],
        accion:  "Ver torneos",
        // DEUDA post-TS+Next: vista "competencias" eliminada en C8b-C3
        // (vive en hub-grupo tab estudiante/profesor, no es accesible a admin).
        // Admin necesita una vista propia de competencias cuando el módulo se
        // diseñe en TS+Next+Supabase. Hoy silent no-op.
        vista:   "competencias",
        color:   "var(--xahni-cyan)",
        tendencia: "+2 programadas",
        up: true,
    },
    {
        icono:      "📁",
        nombre:     "Recursos",
        total:      318,
        detalle: [
            { label: "PDFs",    valor: 142, color: "var(--xahni-red)"    },
            { label: "Videos",  valor: 89,  color: "var(--xahni-blue)"   },
            { label: "Otros",   valor: 87,  color: "var(--text-muted)"   },
        ],
        accion:  "Ver recursos",
        // DEUDA post-TS+Next: admin debería tener un CRUD global de todos
        // los recursos subidos por alumnos y profesores cross-materia
        // cross-grupo. Vista "recursos" era la vista profesor standalone,
        // removida en cleanup 2026-05-24. Diseñar/implementar la vista
        // admin-recursos en TS+Next+Supabase. Hoy silent no-op.
        vista:   "recursos",
        color:   "var(--xahni-green)",
        tendencia: "+18 esta semana",
        up: true,
    },
];

/**
 * @interaction build-perfil-modulos-admin
 * @scope admin-modulos-render-grid
 *
 * Given DOM con `#admin-modulos-grid` + `ADMIN_MODULOS_DATA` global.
 * When admin entra a tab Modulos del perfil.
 * Then grid de cards `.x-card` (1 por módulo) con:
 *   - Header icon coloreado + nombre + tendencia + número grande total.
 *   - Detalle: `.x-list-row` por rubro de desglose con barra
 *     `.x-progress` + valor + pct.
 *   - Botón CTA action → `showView(m.vista)` + toast.
 * Edge:
 *   - **TODO hardcoded DEMO**: ADMIN_MODULOS_DATA fijo con stats fake +
 *     tendencias hardcoded. Deuda post-Supabase: agregar vista estadística
 *     materializada por módulo.
 *   - **`m.detalle.pct` recalculado client-side** con `Math.round(valor/
 *     total × 100)`. Aceptable DEMO.
 *   - **Composición canónica `.x-card` + `.x-list-row` + `.x-progress`**
 *     sin clases bespoke admin-mod-* (regla rectora homogeneización).
 *   - DOM target ausente → no-op.
 *   - **Exportado window** implícito (consumer perfil-public.js).
 *   - Función IMPURA (DOM masivo).
 */
function buildPerfilModulosAdmin() {
    const el = document.getElementById("admin-modulos-grid");
    if (!el) return;

    // Card canónica .x-card con cabecera (icono color + nombre/tendencia + número grande),
    // barras .x-progress por rubro de desglose, y botón .x-btn--ghost de acción.
    // Sin clases bespoke admin-mod-*.
    el.innerHTML = ADMIN_MODULOS_DATA.map(m => {
        const detalleHtml = m.detalle.map(d => {
            const pct = Math.round((d.valor / (m.total || 1)) * 100);
            return `
            <div class="x-list-row" style="padding:7px 0">
                <span style="font-size:11px;color:var(--text-secondary);min-width:90px;flex-shrink:0">${d.label}</span>
                <div class="x-progress" style="flex:1">
                    <div class="x-progress__fill" style="width:${pct}%;background:${d.color}"></div>
                </div>
                <span class="x-mono-sm" style="color:${d.color};font-weight:700;min-width:42px;text-align:right">${d.valor.toLocaleString()}</span>
                <span class="x-mono-sm" style="color:var(--text-muted);min-width:38px;text-align:right">${pct}%</span>
            </div>`;
        }).join("");

        const trendColor = m.up ? "var(--state-ok)" : "var(--text-muted)";
        const trendIco   = m.up ? "↑" : "→";

        return `
        <div class="x-card" style="padding:18px;border-top:3px solid ${m.color}">
            <header style="display:flex;align-items:flex-start;gap:12px;margin-bottom:14px">
                <div style="width:40px;height:40px;border-radius:var(--r-md);background:${m.color}18;color:${m.color};display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">${m.icono}</div>
                <div style="flex:1;min-width:0">
                    <div style="font-size:14px;font-weight:600;color:var(--text-primary)">${m.nombre}</div>
                    <div style="font-size:11px;color:${trendColor};margin-top:2px">${trendIco} ${m.tendencia}</div>
                </div>
                <div class="x-stat__num" style="font-size:28px;color:${m.color};line-height:1;flex-shrink:0">${m.total.toLocaleString()}</div>
            </header>
            <div style="display:flex;flex-direction:column;gap:2px;margin-bottom:12px">
                ${detalleHtml}
            </div>
            <button class="x-btn x-btn--ghost" style="width:100%;justify-content:center"
                onclick="showView('${m.vista}');showToast('Abriendo módulo ${m.nombre}','info')">
                ${m.accion} →
            </button>
        </div>`;
    }).join("");
}
