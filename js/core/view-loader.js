// js/core/view-loader.js
// Carga HTML de views/ con fetch() e inyecta en el contenedor del DOM.
// Requiere servidor HTTP local (no file://). Ver Plan 1 Task 1.

const ViewLoader = {
  _cache: {},

  async load(viewPath, sectionId) {
    if (this._cache[viewPath]) return;
    try {
      // Slice E 2026-06-01: cache:"no-store" + cache-buster para garantizar
      // versión fresca del HTML del view (problema observado: browser cacheó
      // dual-DOM viejo de aprendizaje.html tras colapsar gamer-on/off wrappers).
      const html = await fetch(viewPath + "?_=" + Date.now(), { cache: "no-store" }).then(r => {
        if (!r.ok) throw new Error(`ViewLoader: no se pudo cargar ${viewPath} (${r.status})`);
        return r.text();
      });
      const section = document.getElementById(sectionId);
      if (section) section.innerHTML = html;
      this._cache[viewPath] = true;
    } catch (err) {
      console.error(err);
    }
  },

  pathFor(viewId) {
    // C9: 'aprendizaje' branch by role — profesor tiene su propio shell
    // hub (views/profesor/aprendizaje.html). El cache de viewPath actúa
    // como separador automático: cada rol carga su archivo al primer hit.
    if (viewId === 'aprendizaje' && typeof APP !== 'undefined' && APP.user?.tipo === 'profesor') {
      return 'views/profesor/aprendizaje.html';
    }
    const MAP = {
      'dashboard':             'views/shared/dashboard.html',
      'aprendizaje':           'views/estudiante/aprendizaje.html',
      // C8b-B3: 'calificaciones-alumno' eliminado (trasplantado a hub-panel-calificaciones).
      // C8b-C3: 'competencias' eliminado (trasplantado a hub-panel-competencias).
      'tareas-alumno':         'views/estudiante/tareas.html',
      'recursos-alumno':       'views/estudiante/recursos.html',
      'grupos':                'views/estudiante/grupos.html',
      // 2026-05-24 cleanup: mappings standalone profesor removidos
      // (gestion-academica, mis-materias-prof, escala-evaluacion, tareas-prof,
      // recursos). Trasplantados al hub-materia profesor en C9. Los fragments
      // views/profesor/{gestion,escala,tareas,recursos}.html siguen vivos
      // pero son fetched directo por los dispatchers (gestionRender,
      // escalaRender, tareasProfRender, recursosProfRender), no por ViewLoader.
      'admin-panel':           'views/admin/dashboard.html',
      'gestion-usuarios':      'views/admin/usuarios.html',
      'modulos-admin':         'views/admin/modulos.html',
      'gestion-reportes':      'views/admin/reportes.html',
      'gestion-instituciones': 'views/admin/instituciones.html',
      'gestion-carreras':       'views/admin/carreras.html',
      'gestion-clasificaciones':'views/admin/clasificaciones.html',
      'gestion-grupos':         'views/admin/grupos.html',
      'gestion-materias':       'views/admin/materias.html',
      'gestion-horarios':      'views/admin/horarios.html',
      'perfil':                'views/shared/perfil.html',
      'configuracion':         'views/shared/configuracion.html',
      // C8b-D3: 'juegos' eliminado (trasplantado a hub-materia tab juegos).
    };
    return MAP[viewId] || null;
  },
};
