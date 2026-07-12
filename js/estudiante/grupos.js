// ═══════════════════════════════════════════════════════════
// BUILDERS — Grupos v2
// Cards · Detalle · Prestigio · Personalización de materia
// Datos derivados en vivo desde DEMO_GRUPOS / DEMO_USERS / DEMO_TAREAS
// vía getGruposAlumno(uid) en data-provider.js
// ═══════════════════════════════════════════════════════════

// ── Estado de personalización por materia ──────────────────
const CUSTOM_STATE = {
    color:   "#00d4ff",
    emblema: "💻",
    marco:   "glow-cyan",
};

// ── Cache de la sesión: rehidrata desde getGruposAlumno() ──
let GRUPOS_DATA = [];

/**
 * @interaction refresh-grupos-data
 * @scope estudiante-grupos-data-sync
 *
 * Given APP.user activo.
 * When `buildGrupos` orquesta o `_refreshAprendizajeData` orchestrator
 *   cross-módulo invoca.
 * Then guard typeof + APP.user.id → reasign `GRUPOS_DATA = getGruposAlumno(uid)`.
 * Edge:
 *   - **Reasign total** (no diff incremental) — pattern legacy del módulo.
 *   - Helper LOCAL.
 *   - Función IMPURA (muta module-scope).
 *   - **Twin pattern** con `_refreshMateriasData` (mismo archivo del rol):
 *     ambos refrescan desde getXxxAlumno wrappers shared.
 */
function _refreshGruposData() {
    if (typeof getGruposAlumno === "function" && APP?.user?.id) {
        GRUPOS_DATA = getGruposAlumno(APP.user.id);
    }
}

// ── Logros que puede obtener un grupo ───────────────────────
const LOGROS_GRUPO_CATALOG = [
    { emoji:"⚡", nombre:"Primera semana",    color:"#00d4ff", tipo:"racha",       xp:50,  desbloqueado:true  },
    { emoji:"📝", nombre:"10 Quizzes",         color:"#1b4fe4", tipo:"quiz",        xp:80,  desbloqueado:true  },
    { emoji:"🏆", nombre:"Torneo ganado",       color:"#f5a623", tipo:"torneo",      xp:200, desbloqueado:true  },
    { emoji:"📚", nombre:"50 Tareas",           color:"#00c6a7", tipo:"tareas",      xp:120, desbloqueado:true  },
    { emoji:"🔥", nombre:"Racha 30 días",       color:"#e84040", tipo:"racha",       xp:150, desbloqueado:true  },
    { emoji:"🎯", nombre:"Precisión 95%",       color:"#a855f7", tipo:"rendimiento", xp:100, desbloqueado:false },
    { emoji:"🚀", nombre:"Proyecto destacado",  color:"#00d4ff", tipo:"proyecto",    xp:250, desbloqueado:false },
    { emoji:"💬", nombre:"100 Participaciones", color:"#22c55e", tipo:"social",      xp:90,  desbloqueado:false },
    { emoji:"👑", nombre:"Mejor grupo",         color:"#f5a623", tipo:"ranking",     xp:300, desbloqueado:false },
];

// ── Recompensas de prestigio ─────────────────────────────────
const PRESTIGE_RECOMPENSAS = [
    { emoji:"🎨", nombre:"Color neón",       nivel:1, desc:"Desbloquea colores especiales para la card" },
    { emoji:"✨", nombre:"Efecto glow",       nivel:1, desc:"Borde brillante en la card de materia"      },
    { emoji:"🌈", nombre:"Gradiente dorado",  nivel:2, desc:"Fondo gradiente premium para la card"       },
    { emoji:"🏅", nombre:"Emblema exclusivo", nivel:2, desc:"Emblemas especiales del grupo"              },
    { emoji:"💎", nombre:"Marco diamante",    nivel:3, desc:"Marco animado nivel diamante"               },
    { emoji:"🌟", nombre:"Partículas",        nivel:3, desc:"Partículas flotantes en la card"            },
    { emoji:"🔥", nombre:"Efecto fuego",      nivel:4, desc:"Animación de fuego en el borde"             },
    { emoji:"👑", nombre:"Corona de oro",     nivel:5, desc:"Emblema corona exclusivo nivel 5"           },
];

// ── Colores personalizables (algunos requieren prestigio) ───
const CUSTOM_COLORS = [
    { color:"#00d4ff", label:"Cian",          nivel:0 },
    { color:"#1b4fe4", label:"Azul",          nivel:0 },
    { color:"#00c6a7", label:"Teal",          nivel:0 },
    { color:"#22c55e", label:"Verde",         nivel:0 },
    { color:"#f5a623", label:"Ámbar",         nivel:1 },
    { color:"#8b2be2", label:"Morado",        nivel:1 },
    { color:"#e84040", label:"Rojo",          nivel:2 },
    { color:"linear-gradient(135deg,#f5a623,#8b2be2)", label:"Gradiente dorado", nivel:3 },
];

const CUSTOM_EMBLEMAS = [
    { emoji:"💻", nivel:0 }, { emoji:"📐", nivel:0 }, { emoji:"📚", nivel:0 },
    { emoji:"🎓", nivel:0 }, { emoji:"⚡", nivel:1 }, { emoji:"🔥", nivel:1 },
    { emoji:"💎", nivel:2 }, { emoji:"👑", nivel:3 }, { emoji:"🌟", nivel:3 },
];

const CUSTOM_MARCOS = [
    { id:"ninguno",    label:"Sin marco",      nivel:0 },
    { id:"glow-cyan",  label:"Glow cian",       nivel:1 },
    { id:"glow-gold",  label:"Glow dorado",     nivel:2 },
    { id:"diamante",   label:"Diamante",        nivel:3 },
];

// Grupo actualmente abierto en el detalle (objeto extendido con miembrosLista/actividad)
let grupoActivo = null;

// ── buildGrupos ──────────────────────────────────────────────
/**
 * @interaction build-grupos
 * @scope estudiante-grupos-entrypoint
 *
 * Given DOM con `#grupos-grid` + GRUPOS_DATA hidratado.
 * When caller invoca tab Grupos.
 * Then:
 *   1. Refresh data.
 *   2. Empty state si sin grupos.
 *   3. Por grupo: `.grupo-card-v2` con CSS custom prop `--gc-color` +
 *      onclick `abrirDetalleGrupo`:
 *      - Banner mini con gradient + emblema + grid pattern.
 *      - Header nombre + materia + badge "Activo/Inactivo".
 *      - 5 prestige stars (filled ≤ prestigioNivel).
 *      - XP grupal track con label + porcentaje + custom-color fill.
 *      - Footer: count miembros + count logros (obtenidos/total).
 * Edge:
 *   - DOM target ausente → no-op.
 *   - **`Math.round(xpGrupal / xpMax × 100)` puede pasar 100%** si grupo
 *     ya alcanzó nivel siguiente — visual capped por CSS width.
 *   - **CSS custom prop pattern** consumed por `.grupo-xp-fill` y badges.
 *   - innerHTML masivo con strings dinámicos (DEMO controlado).
 *   - Función IMPURA (DOM).
 */
function buildGrupos() {
    _refreshGruposData();
    const el = document.getElementById("grupos-grid");
    if (!el) return;

    if (!GRUPOS_DATA.length) {
        el.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);font-size:13px">
            Aún no perteneces a ningún grupo de estudio.
        </div>`;
        return;
    }

    el.innerHTML = GRUPOS_DATA.map(g => {
        const pct = Math.round((g.xpGrupal / g.xpMax) * 100);
        const stars = Array.from({length: 5}, (_, i) =>
            `<span class="grupo-star ${i < g.prestigioNivel ? 'filled' : ''}">★</span>`
        ).join("");

        return `
        <div class="grupo-card-v2" style="--gc-color:${g.materiaColor}"
             onclick="abrirDetalleGrupo('${g.id}')">

            <!-- Mini banner -->
            <div class="grupo-card-banner">
                <div class="grupo-card-banner-bg" style="background:${g.bgGrad};opacity:.9"></div>
                <div class="grupo-card-banner-grid"></div>
                <div class="grupo-card-emblema">${g.emblema}</div>
            </div>

            <!-- Cuerpo -->
            <div class="grupo-card-body">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                    <div>
                        <div class="grupo-card-nombre">${g.nombre}</div>
                        <div class="grupo-card-materia">${g.materia}</div>
                    </div>
                    <span class="grupo-act-badge ${g.activo ? '' : 'inactivo'}">
                        ${g.activo ? '● Activo' : '○ Inactivo'}
                    </span>
                </div>

                <!-- Prestige stars -->
                <div style="display:flex;align-items:center;gap:8px">
                    <div class="grupo-card-stars">${stars}</div>
                    <span style="font-size:10px;color:var(--text-muted)">Prestigio Niv. ${g.prestigioNivel}</span>
                </div>

                <!-- XP grupal -->
                <div class="grupo-xp-wrap">
                    <span class="grupo-xp-label">${g.xpGrupal.toLocaleString()} XP</span>
                    <div class="grupo-xp-track">
                        <div class="grupo-xp-fill" style="width:${pct}%;--gc-color:${g.materiaColor}"></div>
                    </div>
                    <span class="grupo-xp-label">${g.xpMax.toLocaleString()}</span>
                </div>

                <!-- Footer -->
                <div class="grupo-card-footer">
                    <span style="font-size:11px;color:var(--text-muted)">
                        👥 ${g.miembros} miembros
                    </span>
                    <span style="font-size:11px;color:var(--text-muted)">
                        🏅 ${g.logrosObtenidos}/${g.logrosTotal} logros
                    </span>
                </div>
            </div>
        </div>`;
    }).join("");
}

// ── abrirDetalleGrupo ────────────────────────────────────────
/**
 * @interaction abrir-detalle-grupo
 * @scope estudiante-grupos-overlay
 *
 * Given id del grupo desde click en card.
 * When user click `.grupo-card-v2`.
 * Then:
 *   1. Guard APP.user.id falsy → no-op.
 *   2. Hidrata `grupoActivo` via `getGrupoCardDetalle(uid, id)` shared.
 *   3. Sin grupo → no-op.
 *   4. Swap visual: hide `#grupos-lista-panel`, show `#grupos-detalle-panel`.
 *   5. Update DOM elements: banner-bg cssText, emblema, nombre, materia.
 *   6. 5 prestige stars con drop-shadow para llenas, opacity 0.2 vacías.
 *   7. Dispara 5 sub-builds: stats + prestigio + logros + miembros + actividad.
 * Edge:
 *   - **Overlay swap-panel** (mismo pattern profesor hub-materia
 *     `profHubAbrirMateria`). Decisión histórica del shell.
 *   - `getGrupoCardDetalle` shared retorna shape extendido (miembrosLista
 *     + actividad + xpAporte por miembro).
 *   - **Exportado en window** (onclick inline).
 *   - Función IMPURA (DOM + state).
 */
function abrirDetalleGrupo(id) {
    if (!APP?.user?.id) return;
    grupoActivo = typeof getGrupoCardDetalle === "function"
        ? getGrupoCardDetalle(APP.user.id, id)
        : null;
    if (!grupoActivo) return;
    const g = grupoActivo;

    document.getElementById("grupos-lista-panel").style.display = "none";
    document.getElementById("grupos-detalle-panel").style.display = "block";

    // Banner
    const bannerBg = document.getElementById("grupo-det-banner-bg");
    if (bannerBg) bannerBg.style.cssText = `background:${g.bgGrad};position:absolute;inset:0`;

    document.getElementById("grupo-det-emblema").textContent = g.emblema;
    document.getElementById("grupo-det-nombre").textContent  = g.nombre;
    document.getElementById("grupo-det-materia").textContent = g.materia;

    // Stars
    const starsEl = document.getElementById("grupo-det-stars");
    if (starsEl) starsEl.innerHTML = Array.from({length:5}, (_,i) =>
        `<span style="font-size:20px;opacity:${i < g.prestigioNivel ? 1 : 0.2};filter:${i < g.prestigioNivel ? 'drop-shadow(0 0 6px #f5a623)' : 'none'}">★</span>`
    ).join("");

    // Stats
    buildGrupoStats(g);
    // Prestigio
    buildPrestigioSection(g);
    // Logros
    buildGrupoLogros(g);
    // Miembros
    buildGrupoMiembros(g);
    // Actividad
    buildGrupoActividad(g);
}

/**
 * @interaction cerrar-detalle-grupo
 * @scope estudiante-grupos-overlay
 *
 * Given overlay detalle abierto.
 * When user click "← Volver".
 * Then swap visual hide/show + reset `grupoActivo = null`.
 * Edge:
 *   - **NO resetea CUSTOM_STATE** (modal personalización) — siguiente
 *     apertura preserva. Decisión: cambios de color/emblema/marco
 *     persisten cross-sessions del modal hasta refresh.
 *   - **Exportado en window** (onclick inline).
 *   - Función IMPURA (DOM + state).
 */
function cerrarDetalleGrupo() {
    document.getElementById("grupos-detalle-panel").style.display = "none";
    document.getElementById("grupos-lista-panel").style.display  = "block";
    grupoActivo = null;
}

// ── buildGrupoStats ──────────────────────────────────────────
/**
 * @interaction build-grupo-stats
 * @scope estudiante-grupos-detalle-stats
 *
 * Given grupo `g` activo + DOM con `#grupo-det-stats`.
 * When `abrirDetalleGrupo` orquesta.
 * Then 4 stat-cards: Miembros / XP Grupal toLocaleString / Logros
 *   ("obtenidos/total") / Prestigio "Niv. N".
 * Edge:
 *   - DOM target ausente → no-op.
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM).
 */
function buildGrupoStats(g) {
    const el = document.getElementById("grupo-det-stats");
    if (!el) return;
    const stats = [
        { num: g.miembros,                              label: "Miembros"  },
        { num: g.xpGrupal.toLocaleString(),             label: "XP Grupal" },
        { num: g.logrosObtenidos + "/" + g.logrosTotal, label: "Logros"    },
        { num: "Niv. " + g.prestigioNivel,              label: "Prestigio" },
    ];
    el.innerHTML = stats.map(s => `
        <div class="grupo-stat-card">
            <div class="grupo-stat-num">${s.num}</div>
            <div class="grupo-stat-label">${s.label}</div>
        </div>`).join("");
}

// ── buildPrestigioSection ────────────────────────────────────
/**
 * @interaction build-prestigio-section
 * @scope estudiante-grupos-detalle-prestigio
 *
 * Given grupo `g` + 3 DOM targets (badge + xp-section + recompensas grid).
 * When `abrirDetalleGrupo` orquesta.
 * Then:
 *   1. Update badge "Nivel N".
 *   2. XP bar con label "Niv N → Niv N+1" + numbers `xp/xpMax` + fill pct
 *      + 5 milestones (0/25/50/75/100% con `.reached` si pct >= m) +
 *      texto "Faltan X XP para siguiente nivel".
 *   3. Recompensas grid: 8 items con bloqueada/desbloqueada por `r.nivel
 *      <= g.prestigioNivel`. Onclick toast contextual.
 * Edge:
 *   - **Milestones siempre 5 fijos** (0/25/50/75/100) — pattern UX.
 *   - **xpToNext clamped a 0** con `Math.max(0, ...)` — alumno con XP
 *     excedente muestra "Faltan 0 XP" (siguiente nivel ya alcanzado pero
 *     no auto-promoted; deuda menor).
 *   - **Recompensas onclick inline** con toasts cosmeticos (no persisten).
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM).
 */
function buildPrestigioSection(g) {
    const badgeEl = document.getElementById("grupo-prestige-nivel-badge");
    if (badgeEl) badgeEl.textContent = "Nivel " + g.prestigioNivel;

    // XP bar
    const xpEl = document.getElementById("prestige-xp-section");
    if (xpEl) {
        const pct = Math.round((g.xpGrupal / g.xpMax) * 100);
        const xpToNext = Math.max(0, g.xpMax - g.xpGrupal);
        xpEl.innerHTML = `
            <div class="prestige-nivel-row">
                <span class="prestige-nivel-label">Nivel ${g.prestigioNivel} → Nivel ${g.prestigioNivel + 1}</span>
                <span class="prestige-xp-numbers">${g.xpGrupal.toLocaleString()} / ${g.xpMax.toLocaleString()} XP</span>
            </div>
            <div class="prestige-xp-track">
                <div class="prestige-xp-fill" style="width:${pct}%"></div>
            </div>
            <div class="prestige-milestones">
                ${[0,25,50,75,100].map(m => `
                    <span class="prestige-milestone ${pct >= m ? 'reached' : ''}">${m}%</span>
                `).join("")}
            </div>
            <p style="font-size:11px;color:var(--text-muted);margin-top:8px">
                Faltan <strong style="color:var(--xahni-amber)">${xpToNext.toLocaleString()} XP</strong> para el siguiente nivel.
                Completa quizzes, tareas y torneos en grupo para avanzar.
            </p>`;
    }

    // Recompensas
    const recEl = document.getElementById("prestige-recompensas-grid");
    if (recEl) {
        recEl.innerHTML = PRESTIGE_RECOMPENSAS.map(r => {
            const desbloqueada = r.nivel <= g.prestigioNivel;
            return `
            <div class="prestige-recompensa-item ${desbloqueada ? 'desbloqueada' : 'bloqueada'}"
                 onclick="${desbloqueada ? `showToast('✅ ${r.nombre} disponible para usar', 'success')` : `showToast('🔒 Desbloquea Niv. ${r.nivel} para obtener esta recompensa', 'info')`}">
                <span class="prestige-rec-emoji">${r.emoji}</span>
                <div>
                    <div class="prestige-rec-nombre">${r.nombre}</div>
                    <div class="prestige-rec-nivel">${desbloqueada ? '✓ Obtenida' : 'Niv. ' + r.nivel}</div>
                </div>
            </div>`;
        }).join("");
    }
}

// ── buildGrupoLogros ─────────────────────────────────────────
/**
 * @interaction build-grupo-logros
 * @scope estudiante-grupos-detalle-logros
 *
 * Given grupo `g` + DOM con count y grid.
 * When `abrirDetalleGrupo` orquesta.
 * Then:
 *   1. Update count "obtenidos / total".
 *   2. Itera LOGROS_GRUPO_CATALOG (9 entries):
 *      - **Pattern sliding mask**: primeros N (= logrosObtenidos)
 *        marcados desbloqueados, resto bloqueados.
 *      - `.grupo-logro-item` con CSS custom prop `--gl-color` + onclick
 *        toast success (desbloqueado) o info (bloqueado).
 * Edge:
 *   - **Sliding mask asumption**: si el catálogo tiene 9 entries y el
 *     grupo tiene 5 logros, los PRIMEROS 5 se ven desbloqueados.
 *     Decisión DEMO simplista. Deuda post-Supabase: tabla `grupo_logros`
 *     con tracking real por evento.
 *   - **Cosméticos toasts** — no actions reales.
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM).
 */
function buildGrupoLogros(g) {
    const countEl = document.getElementById("grupo-logros-count");
    if (countEl) countEl.textContent = g.logrosObtenidos + " / " + g.logrosTotal;

    const el = document.getElementById("grupo-logros-grid");
    if (!el) return;

    // Marca como desbloqueados los primeros N logros (= logrosObtenidos)
    el.innerHTML = LOGROS_GRUPO_CATALOG.map((l, i) => {
        const desbloqueado = i < g.logrosObtenidos;
        return `
        <div class="grupo-logro-item ${desbloqueado ? 'desbloqueado' : 'bloqueado'}"
             style="--gl-color:${l.color}"
             onclick="${desbloqueado
                ? `showToast('🏅 ${l.nombre} — +${l.xp} XP grupal', 'success')`
                : `showToast('🔒 ${l.nombre}: completa más actividades en grupo', 'info')`}">
            <div class="grupo-logro-stripe" style="background:${l.color}"></div>
            <div class="grupo-logro-emoji">${l.emoji}</div>
            <div class="grupo-logro-nombre">${l.nombre}</div>
        </div>`;
    }).join("");
}

// ── buildGrupoMiembros ───────────────────────────────────────
/**
 * @interaction build-grupo-miembros
 * @scope estudiante-grupos-detalle-miembros
 *
 * Given grupo `g` con `miembrosLista[]` (ya sorted desc por xpAporte).
 * When `abrirDetalleGrupo` orquesta.
 * Then:
 *   1. Empty state si sin miembros.
 *   2. `colorMap` 7 entries por color paleta.
 *   3. `maxAporte = miembros[0].xpAporte` (top de la lista).
 *   4. Por miembro: ranking medal (🥇/🥈/🥉 o pos number) + avatar
 *      canonical con bg color + nombre + chip "tú" si esYo + XP aporte
 *      + bar relativa (`xpAporte / maxAporte × 100`).
 * Edge:
 *   - **Asumption: miembrosLista sorted desc** — proveedor `getGrupoCardDetalle`
 *     responsable de pre-sort.
 *   - **maxAporte clamped a 1** con Math.max para evitar div-by-zero.
 *   - **Avatar canonical `getAvatarDisplay(uid).fotoTexto`** con fallback
 *     a `m.iniciales` raw.
 *   - colorMap fallback `#1b4fe4` (azul brand) si color no en map.
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM).
 */
function buildGrupoMiembros(g) {
    const el = document.getElementById("grupo-miembros-list");
    if (!el) return;

    const miembros = (g.miembrosLista || []);
    if (!miembros.length) {
        el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px">Sin miembros registrados</div>`;
        return;
    }

    const colorMap = {
        teal:"#00c6a7", amber:"#f5a623", blue:"#1b4fe4", purple:"#8b2be2",
        green:"#22c55e", red:"#e84040", cyan:"#00d4ff",
    };
    const maxAporte = Math.max(1, miembros[0].xpAporte);
    const posClass  = p => p===1?"gold":p===2?"silver":p===3?"bronze":"";
    const medal     = p => p===1?"🥇":p===2?"🥈":p===3?"🥉":p;

    el.innerHTML = miembros.map((m, i) => `
        <div class="grupo-miembro-row">
            <div class="grupo-miembro-rank ${posClass(i+1)}">${medal(i+1)}</div>
            <div class="grupo-miembro-avatar" style="background:${colorMap[m.color] || '#1b4fe4'}">${(typeof getAvatarDisplay === 'function' && m.uid ? getAvatarDisplay(m.uid).fotoTexto : m.iniciales)}</div>
            <div class="grupo-miembro-info">
                <div class="grupo-miembro-nombre">
                    ${m.nombre}
                    ${m.esYo ? '<span class="yo-chip" style="margin-left:6px">tú</span>' : ''}
                </div>
                <div class="grupo-miembro-aporte">+${m.xpAporte} XP aportados</div>
            </div>
            <div class="grupo-miembro-xp-bar">
                <div class="grupo-miembro-xp-fill" style="width:${Math.round((m.xpAporte/maxAporte)*100)}%"></div>
            </div>
        </div>`).join("");
}

// ── buildGrupoActividad ──────────────────────────────────────
/**
 * @interaction build-grupo-actividad
 * @scope estudiante-grupos-detalle-actividad
 *
 * Given grupo `g` con `actividad[]` events.
 * When `abrirDetalleGrupo` orquesta.
 * Then:
 *   1. Empty state si sin actividad.
 *   2. Por evento: `.x-timeline-item` con CSS custom prop `--dot-color`
 *      + icon + texto + fecha relativa (`_fechaRelativa`).
 * Edge:
 *   - **`_fechaRelativa` cross-archivo** (helper shared) — chain dep.
 *   - Helper LOCAL.
 *   - Función IMPURA (DOM).
 */
function buildGrupoActividad(g) {
    const el = document.getElementById("grupo-actividad-list");
    if (!el) return;

    const eventos = (g.actividad || []);
    if (!eventos.length) {
        el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px">Sin actividad reciente en este grupo</div>`;
        return;
    }

    el.innerHTML = eventos.map(a => `
        <div class="x-timeline-item" style="--dot-color:${a.color}">
            <div class="x-timeline-item__text">${a.icon} ${a.text}</div>
            <div class="x-timeline-item__time">${_fechaRelativa(a.fecha)}</div>
        </div>`).join("");
}

// ── buildPersonalizarCard (modal) ────────────────────────────
/**
 * @interaction build-personalizar-card
 * @scope estudiante-grupos-modal-personalizar
 *
 * Given `grupoActivo` (con prestigioNivel) + DOM con 3 grids del modal.
 * When `modal-personalizar-card` openModal hook patched en modals.js.
 * Then 3 grids gated por nivel:
 *   1. **Color swatches** (8): bloqueado si `c.nivel > nivel`.
 *      onclick: locked → toast info; else `selectCustomColor`.
 *   2. **Emblemas** (9): mismo pattern lock + selectCustomEmblema.
 *   3. **Marcos** (4): mismo pattern + selectCustomMarco.
 *   4. **renderPreviewCard** dispara live preview.
 * Edge:
 *   - **`grupoActivo` null → nivel 0** (todo bloqueado excepto colores/
 *     emblemas/marcos nivel 0). Defensive.
 *   - **`CUSTOM_STATE` sticky cross-open**: selección persiste hasta cierre
 *     manual. Decisión UX: experimento iterativo.
 *   - **Asumption**: este se llama desde patched `openModal` (no callsite
 *     directo). Comentario inline lo explicita.
 *   - Función IMPURA (DOM masivo).
 *   - Helper LOCAL.
 */
function buildPersonalizarCard() {
    const nivel = grupoActivo ? grupoActivo.prestigioNivel : 0;

    // Color swatches
    const colorEl = document.getElementById("custom-color-grid");
    if (colorEl) {
        colorEl.innerHTML = CUSTOM_COLORS.map(c => {
            const locked = c.nivel > nivel;
            const sel    = CUSTOM_STATE.color === c.color;
            return `<div class="custom-color-swatch ${locked ? 'locked' : ''} ${sel ? 'selected' : ''}"
                style="background:${c.color}"
                title="${c.label} ${locked ? '(Niv. '+c.nivel+')' : ''}"
                onclick="${locked
                    ? `showToast('🔒 Desbloquea Niv. ${c.nivel} de prestigio', 'info')`
                    : `selectCustomColor('${c.color}')`}"></div>`;
        }).join("");
    }

    // Emblemas
    const embEl = document.getElementById("custom-emblema-grid");
    if (embEl) {
        embEl.innerHTML = CUSTOM_EMBLEMAS.map(e => {
            const locked = e.nivel > nivel;
            const sel    = CUSTOM_STATE.emblema === e.emoji;
            return `<button class="custom-emblema-btn ${locked ? 'locked' : ''} ${sel ? 'selected' : ''}"
                onclick="${locked
                    ? `showToast('🔒 Desbloquea Niv. ${e.nivel} de prestigio', 'info')`
                    : `selectCustomEmblema('${e.emoji}')`}">${e.emoji}</button>`;
        }).join("");
    }

    // Marcos
    const marcoEl = document.getElementById("custom-marco-grid");
    if (marcoEl) {
        marcoEl.innerHTML = CUSTOM_MARCOS.map(m => {
            const locked = m.nivel > nivel;
            const sel    = CUSTOM_STATE.marco === m.id;
            return `<button class="custom-marco-btn ${locked ? 'locked' : ''} ${sel ? 'selected' : ''}"
                onclick="${locked
                    ? `showToast('🔒 Desbloquea Niv. ${m.nivel} de prestigio', 'info')`
                    : `selectCustomMarco('${m.id}')`}">${m.label}</button>`;
        }).join("");
    }

    renderPreviewCard();
}

// ── Selectors para el personalizador ─────────────────────────
/**
 * @interaction select-custom-handlers
 * @scope estudiante-grupos-modal-handlers
 *
 * Given user click swatch / emblema btn / marco btn.
 * When dispara onclick inline.
 * Then 3 handlers que setean `CUSTOM_STATE.{color|emblema|marco}` +
 *   toggle `.selected` por matching (style.background / textContent /
 *   dataset.id) + re-render preview.
 * Edge:
 *   - **`selectCustomColor` matching por style.background string**:
 *     puede fallar si CSS normaliza el color (e.g., gradient string vs
 *     parsed). Aceptable para uso DEMO; deuda menor: usar data-color
 *     attribute.
 *   - **`selectCustomEmblema` matching por textContent.trim()**: depende
 *     del rendering del emoji.
 *   - **`selectCustomMarco` matching por dataset.id**: la única
 *     defensiva (markup debería tener `data-id` pero el render no lo
 *     setea explícitamente — deuda menor: el render usa label como
 *     textContent, NO setea dataset.id). Click handler funciona porque
 *     dataset.id es undefined igual para todos.
 *   - Exportados en window (onclicks inline).
 *   - Funciones IMPURAS (state + DOM).
 */
function selectCustomColor(color) {
    CUSTOM_STATE.color = color;
    document.querySelectorAll(".custom-color-swatch").forEach(el => {
        el.classList.toggle("selected", el.style.background === color);
    });
    renderPreviewCard();
}

function selectCustomEmblema(emoji) {
    CUSTOM_STATE.emblema = emoji;
    document.querySelectorAll(".custom-emblema-btn").forEach(el => {
        el.classList.toggle("selected", el.textContent.trim() === emoji);
    });
    renderPreviewCard();
}

function selectCustomMarco(id) {
    CUSTOM_STATE.marco = id;
    document.querySelectorAll(".custom-marco-btn").forEach(el => {
        el.classList.toggle("selected", el.dataset.id === id);
    });
    renderPreviewCard();
}

// ── renderPreviewCard ────────────────────────────────────────
/**
 * @interaction render-preview-card
 * @scope estudiante-grupos-modal-preview-live
 *
 * Given `grupoActivo` + `CUSTOM_STATE` actual + MATERIAS_DATA.
 * When user cambia color/emblema/marco en modal o `buildPersonalizarCard`
 *   init.
 * Then live preview:
 *   1. Lookup materia del grupo en MATERIAS_DATA (por id o nombre fallback).
 *   2. Sin materia → empty state.
 *   3. Build preview card con:
 *      - topbar color custom.
 *      - emblema custom + nombre + chip "Aprobada".
 *      - meta info (prof + horario).
 *      - progress bar avance con color custom.
 *      - promedio + créditos.
 *      - glow box-shadow si marco ≠ "ninguno".
 * Edge:
 *   - **Doble lookup defensive**: por id Y por nombre. Decisión: tolera
 *     drift seed donde grupo.materiaId ≠ materia.id pero nombres matchean.
 *   - **`mat.promedio ?? 0` fallback** + `Number().toFixed(1)` defensive
 *     (materia sin promedio cargado muestra "0.0").
 *   - Preview NO afecta materia real hasta `aplicarPersonalizacion`.
 *   - Función IMPURA (DOM).
 *   - Helper LOCAL.
 */
function renderPreviewCard() {
    const el = document.getElementById("preview-materia-card");
    if (!el) return;

    // Fuente: materia del grupo en personalización, derivada de getMateriasAlumno
    // (rehidratada en MATERIAS_DATA por js/estudiante/materias.js).
    let mat = null;
    if (grupoActivo && typeof MATERIAS_DATA !== "undefined") {
        mat = MATERIAS_DATA.find(m => m.id === grupoActivo.materiaId)
            || MATERIAS_DATA.find(m => m.nombre === grupoActivo.materia);
    }
    if (!mat) {
        el.style.cssText = "";
        el.innerHTML = `<div class="x-empty" style="padding:24px"><div class="x-empty__icon">📚</div><div class="x-empty__title">Sin materia activa</div></div>`;
        return;
    }

    const c = CUSTOM_STATE.color;
    const glow = CUSTOM_STATE.marco !== "ninguno"
        ? `box-shadow:0 0 0 2px ${c}, 0 0 16px ${c}40;`
        : "";

    el.style.cssText = glow;
    el.innerHTML = `
        <div class="mat-v2-topbar" style="background:${c}"></div>
        <div style="padding:12px 14px 6px;display:flex;align-items:flex-start;justify-content:space-between;gap:6px">
            <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:16px">${CUSTOM_STATE.emblema}</span>
                <div style="font-size:13px;font-weight:700;color:var(--text-primary)">${mat.nombre}</div>
            </div>
            <span class="x-chip x-chip--ok" style="font-size:9px;flex-shrink:0">Aprobada</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;padding:0 14px 8px">
            <span class="mat-v2-info-item">👨‍🏫 ${mat.prof}</span>
            <span class="mat-v2-info-item">🕐 ${mat.horarioStr || "—"}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:0 14px 4px">
            <span style="font-size:10px;color:var(--text-muted)">Avance</span>
            <span style="font-family:var(--font-mono);font-size:10px;color:${c}">${mat.pct}%</span>
        </div>
        <div class="progress-bar" style="height:5px;margin:0 14px 12px">
            <div class="progress-fill" style="width:${mat.pct}%;background:${c};border-radius:99px"></div>
        </div>
        <div style="display:flex;justify-content:space-between;padding:0 14px 14px">
            <div>
                <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase">Promedio</div>
                <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--xahni-green)">${Number(mat.promedio ?? 0).toFixed(1)}</div>
            </div>
            <div style="text-align:right">
                <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase">Créditos</div>
                <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--text-secondary)">${mat.creditos}</div>
            </div>
        </div>`;
}

// ── aplicarPersonalizacion ───────────────────────────────────
/**
 * @interaction aplicar-personalizacion
 * @scope estudiante-grupos-modal-submit
 *
 * Given user click "Aplicar" en modal.
 * When dispara handler.
 * Then:
 *   1. Close modal.
 *   2. Toast success contextual con nombre materia.
 *   3. **Persiste en MATERIAS_DATA**: setea `mat._customColor` +
 *      `mat._customEmblema` (NO `_customMarco` — deuda menor).
 *   4. `buildMaterias()` repaint tab Materias (visible al volver).
 * Edge:
 *   - **Persistencia in-memory only**: cambios viven hasta refresh o
 *     `_refreshMateriasData` (que reasigna MATERIAS_DATA desde provider,
 *     destruyendo los `_custom*`). Deuda post-Supabase: tabla
 *     `usuario_personalizacion_materia`.
 *   - **`_customMarco` NO persisted** — bug menor histórico (deuda anotada).
 *   - **Lookup por nombre** (no id) — consistente con renderPreviewCard
 *     defensive.
 *   - Sin materia encontrada → toast pero sin persist (silencioso).
 *   - **Exportado en window** (onclick inline modal).
 *   - Función IMPURA (DOM + MATERIAS_DATA + close modal + toast).
 */
function aplicarPersonalizacion() {
    closeModal("modal-personalizar-card");
    showToast("🎨 Personalización aplicada a tu card de " + (grupoActivo?.materia || "materia"), "success");

    // Actualizar el color en MATERIAS_DATA para que se refleje
    if (typeof MATERIAS_DATA !== "undefined" && grupoActivo) {
        const mat = MATERIAS_DATA.find(m => m.nombre === grupoActivo.materia);
        if (mat) {
            mat._customColor   = CUSTOM_STATE.color;
            mat._customEmblema = CUSTOM_STATE.emblema;
            buildMaterias();
        }
    }
}

// openModal se parchea en modals.js para inicializar buildPersonalizarCard
