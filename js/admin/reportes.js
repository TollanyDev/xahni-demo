// js/admin/reportes.js
// Stub visual del módulo Reportes globales admin (slice pre-c10 #9.E,
// 2026-05-27). Decisión D3 del roadmap: vista con cards de gráficos
// vacíos + filtros muertos + leyenda "Datos disponibles post-Supabase".
// Solo chrome, cero lógica funcional. El backend real entra post-Supabase.

const ADMIN_REPORTES_PLACEHOLDERS = [
    {
        titulo:   "Usuarios activos por mes",
        subtitulo:"Trend cross-rol",
        icono:    "📈",
        color:    "var(--xahni-blue)",
    },
    {
        titulo:   "Distribución de calificaciones",
        subtitulo:"Histograma por institución",
        icono:    "📊",
        color:    "var(--xahni-teal)",
    },
    {
        titulo:   "Tasas de entrega de tareas",
        subtitulo:"Por carrera × cuatrimestre",
        icono:    "📉",
        color:    "var(--xahni-amber)",
    },
    {
        titulo:   "Crecimiento de instituciones",
        subtitulo:"Acumulado año",
        icono:    "🌐",
        color:    "var(--xahni-purple)",
    },
];

/**
 * @interaction abrir-reportes-globales
 * @scope admin-reportes
 *
 * Given: admin navega a la vista Reportes globales
 * When:  showView("gestion-reportes") dispara INIT_MAP → buildReportesAdmin
 * Then:  el grid #admin-reportes-grid se rellena con 4 placeholder cards
 *        (cada una con icono + título + subtítulo + caja gráfica vacía +
 *        leyenda "Disponible post-Supabase"). Stub puro, sin interacción.
 * Edge:
 *   - container ausente → silent no-op (guard `if (!el) return`)
 */
function buildReportesAdmin() {
    const el = document.getElementById("admin-reportes-grid");
    if (!el) return;
    el.innerHTML = ADMIN_REPORTES_PLACEHOLDERS.map(p => `
        <div class="x-card" style="padding:18px;border-top:3px solid ${p.color}">
            <header style="display:flex;align-items:flex-start;gap:12px;margin-bottom:14px">
                <div style="width:40px;height:40px;border-radius:var(--r-md);background:${p.color}18;color:${p.color};display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">${p.icono}</div>
                <div style="flex:1;min-width:0">
                    <div style="font-size:14px;font-weight:600;color:var(--text-primary)">${p.titulo}</div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${p.subtitulo}</div>
                </div>
            </header>
            <div style="height:140px;border-radius:var(--r-md);background:var(--surface-2);border:1px dashed var(--border);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:var(--text-muted)">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" style="opacity:0.45">
                    <path d="M3 3v18h18"/>
                    <path d="M7 14l4-4 4 3 5-7"/>
                </svg>
                <span style="font-size:11px">Gráfico disponible post-Supabase</span>
            </div>
        </div>`).join("");
}
