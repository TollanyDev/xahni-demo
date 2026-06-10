// js/core/data-service.js
// Capa de abstracción de datos. Ningún módulo accede a DEMO_* ni Firebase directamente.
//   APP_CONFIG.mode === 'demo' → DEMO_* en memoria (lectura desde data/demo/*.json al init)
//   APP_CONFIG.mode === 'prod' → Firestore + Firebase Auth + Firebase Storage
//
// En prod, init() también populano una vez los globals DEMO_* con los snapshots
// iniciales de Firestore para que los módulos legacy que aún leen DEMO_* directo
// (gestion.js, mismaterias.js, dashboard.js, etc.) sigan funcionando sin cambios.

const DataService = {
  get testMode() { return APP_CONFIG.mode === 'demo'; },
  get prodMode() { return APP_CONFIG.mode === 'prod'; },

  /**
   * @interaction data-service-init
   * @scope data-service-bootstrap
   *
   * Given el boot block en `index.html` corre tras parsear todos
   *   los scripts pero antes de cualquier acceso a `DEMO_*`.
   * When se invoca `await DataService.init()`.
   * Then bifurca por `APP_CONFIG.mode`:
   *   - demo → `_loadDemoData()` hace 18 fetch en paralelo a
   *     `data/demo/*.json` y pobla los globals (`DEMO_USERS`,
   *     `DEMO_MATERIAS`, ..., `DEMO_TOP3_MAESTRIA`).
   *   - prod → `initFirebase()` (debe estar definido en
   *     `firebase-init.js`), después `_hydrateGlobalsFromFirestore()`
   *     hace una lectura inicial y pobla los mismos globals para
   *     que módulos legacy (gestion.js, mismaterias.js, perfil.js)
   *     funcionen sin refactor, y finalmente `_watchAuthState()`
   *     suscribe `onAuthStateChanged` para rehidratar `APP.user`.
   * Edge:
   *   - modo ni demo ni prod → no-op silencioso (mode inválido).
   *   - fetch demo falla → la excepción propaga al caller y el boot
   *     bloquea (regresión a pantalla blanca; caller debe
   *     manejarlo).
   *   - Firebase SDK no cargado en prod → `initFirebase` o `_db()`
   *     lanzan al primer acceso. Defensa en profundidad: el catch
   *     queda en el caller.
   */
  async init() {
    if (this.testMode) {
      await _loadDemoData();
      return;
    }
    if (this.prodMode) {
      initFirebase();        // Inicializa Firebase si la config está lista
      _watchAuthState();     // onAuthStateChanged → APP.user + hidratación post-auth
      // NOTA: _hydrateGlobalsFromFirestore() ya NO se llama aquí.
      // Las rules `request.auth != null` rechazan reads sin sesión.
      // La hidratación ocurre dentro de _watchAuthState cuando user !== null
      // (login exitoso o sesión persistida).
    }
  },

  // ── Lectura ─────────────────────────────────────────────
  /**
   * @interaction get-user
   * @scope data-service-lectura
   *
   * Given una sesión activa (demo o prod) y un consumer necesita
   *   la copia más reciente del perfil del usuario actual.
   * When invoca `DataService.getUser()`.
   * Then retorna `Promise<userObj|null>`:
   *   - demo → resuelve con shallow copy de `APP.user` (`{...APP.user}`).
   *   - prod → lee `usuarios/{currentUser.uid}` de Firestore.
   * Edge:
   *   - prod sin sesión auth → retorna `Promise.resolve(null)`.
   *   - prod doc no existe → retorna null (no crash).
   *   - demo con `APP.user` null → retorna `{}` (spread de null da {});
   *     en práctica los callers garantizan sesión activa.
   *   - NO escucha cambios (no reactiva). Para reactive ver el patrón
   *     de los `on*` (no implementado para user porque APP.user es
   *     in-memory y los módulos leen directo).
   */
  getUser() {
    if (this.testMode) return Promise.resolve({ ...APP.user });
    if (this.prodMode) {
      const uid = firebase.auth().currentUser?.uid;
      if (!uid) return Promise.resolve(null);
      return _db().collection('usuarios').doc(uid).get()
        .then(s => s.exists ? { id: s.id, ...s.data() } : null);
    }
  },
  /**
   * @interaction get-materias
   * @scope data-service-lectura
   *
   * Given los globals `DEMO_MATERIAS` ya hidratados por `init()`.
   * When un consumer (gestion.js, mismaterias.js, perfil.js,
   *   hub-aprendizaje.js, etc.) pide el catálogo de materias.
   * Then retorna `Promise<Materia[]>` con shallow copy del array:
   *   - demo → `[...DEMO_MATERIAS]` (copia el array, no las entidades).
   *   - prod → `_coll('materias')` lee todos los docs y mapea con id.
   * Edge:
   *   - demo array vacío → retorna [].
   *   - prod permisos Firestore deniegan read → reject del get(); el
   *     caller debe `catch` (en práctica las reglas permiten read
   *     authenticated).
   *   - mutar las entidades del array retornado MUTA `DEMO_MATERIAS`
   *     en demo (shallow copy). Convención: tratar el retorno como
   *     read-only.
   */
  getMaterias() {
    if (this.testMode) return Promise.resolve([...DEMO_MATERIAS]);
    if (this.prodMode) return _coll('materias');
  },
  /**
   * @interaction get-grupos
   * @scope data-service-lectura
   *
   * Given `DEMO_GRUPOS` ya hidratado.
   * When un consumer pide el catálogo de grupos (hub-grupo,
   *   admin/grupos, profesor selector multi-grupo, etc.).
   * Then retorna `Promise<Grupo[]>` con shallow copy.
   * Edge:
   *   - mismo contrato shallow-copy que `getMaterias`.
   *   - grupos contienen `periodo` (slice periodo 2026-05-14) y
   *     campos gamificados — el caller decide qué consume.
   */
  getGrupos() {
    if (this.testMode) return Promise.resolve([...DEMO_GRUPOS]);
    if (this.prodMode) return _coll('grupos');
  },
  /**
   * @interaction get-tareas
   * @scope data-service-lectura
   *
   * Given `DEMO_TAREAS` hidratado y un consumer necesita el listado
   *   filtrado (hub-aprendizaje, tareas alumno, gestion profesor,
   *   calendar, etc.).
   * When invoca `DataService.getTareas({materiaId?, grupoId?, estado?})`.
   * Then retorna `Promise<Tarea[]>`:
   *   - demo → mapea `DEMO_TAREAS` a copias `{...t}` y aplica
   *     `_filtrarTareas`.
   *   - prod → query Firestore con `where('materiaId', '==', ...)`
   *     y/o `where('grupoId', '==', ...)`. El filtro `estado` se
   *     aplica en cliente (no indexado en Firestore).
   * Edge:
   *   - sin filtros → retorna todas las tareas (escalable en demo;
   *     en prod podría sobrescribir cuota si N alto, pre-pagination
   *     pendiente post-Supabase).
   *   - filtro `estado` requiere `APP.user.id` para calcular
   *     `entregado` por usuario (vía `effectiveDueDate` que respeta
   *     prórroga aprobada del uid actual — slice prórrogas-polish).
   *   - `effectiveDueDate` no cargado aún → fallback a
   *     `t.fechaEntrega` original.
   *   - estados válidos: "pendiente" (no entregado + no vencido),
   *     "entregada" (con entregas del uid), "tardia" (entrega
   *     después de vence), "vencida" (no entregado + vencido).
   */
  getTareas(filtros = {}) {
    if (this.testMode) {
      let r = DEMO_TAREAS.map(t => ({ ...t }));
      return Promise.resolve(_filtrarTareas(r, filtros));
    }
    if (this.prodMode) {
      let q = _db().collection('tareas');
      if (filtros.materiaId) q = q.where('materiaId', '==', filtros.materiaId);
      if (filtros.grupoId)   q = q.where('grupoId',   '==', filtros.grupoId);
      return q.get().then(snap => {
        const r = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return _filtrarTareas(r, filtros); // 'estado' se filtra en cliente
      });
    }
  },
  /**
   * @interaction get-examenes
   * @scope data-service-lectura
   *
   * Given filtros opcionales {materiaId, grupoId, profUid, estado}.
   * When un caller (examenes-est.js, examenes-prof.js) necesita listar
   *   examenes filtrados.
   * Then:
   *   - demo → filtra DEMO_EXAMENES en memoria por filtros opcionales.
   *   - prod → query collection('examenes') con where chained.
   *   Retorna Promise<Examen[]>.
   * Edge:
   *   - Sin filtros → retorna todos (mismo riesgo de pagination que getTareas).
   *   - filtros.estado en demo: cruza con DEMO_EXAMENES_ESTADOS override si existe.
   *   - prod: collectionGroup queries para respuestas/calificaciones requieren
   *     índices auto-creables via link en Console al primer fail.
   */
  getExamenes(filtros = {}) {
    if (this.testMode) {
      let lista = (typeof DEMO_EXAMENES !== 'undefined' ? DEMO_EXAMENES : []);
      if (filtros.materiaId) lista = lista.filter(e => e.materiaId === filtros.materiaId);
      if (filtros.grupoId)   lista = lista.filter(e => e.grupoId === filtros.grupoId);
      if (filtros.profUid)   lista = lista.filter(e => e.profUid === filtros.profUid);
      if (filtros.estado)    lista = lista.filter(e => e.estado === filtros.estado);
      return Promise.resolve(lista);
    }
    if (this.prodMode) {
      let q = _db().collection('examenes');
      if (filtros.materiaId) q = q.where('materiaId', '==', filtros.materiaId);
      if (filtros.grupoId)   q = q.where('grupoId', '==', filtros.grupoId);
      if (filtros.profUid)   q = q.where('profUid', '==', filtros.profUid);
      if (filtros.estado)    q = q.where('estado', '==', filtros.estado);
      return q.get().then(qs => {
        const out = [];
        qs.forEach(doc => out.push({ id: doc.id, ...doc.data() }));
        return out;
      });
    }
  },
  /**
   * @interaction save-examen
   * @scope data-service-escritura
   *
   * Given profesor crea/edita examen (wizard CrearExamen).
   * When invoca DataService.saveExamen(data).
   * Then:
   *   - demo → genera id 'ex' + Date.now() si no viene, push a DEMO_EXAMENES.
   *   - prod → collection('examenes').doc(id).set(payload, {merge:true}) si trae id;
   *     si no, .add() y retorna doc generado.
   *   Retorna Promise<Examen>.
   * Edge:
   *   - data.id presente → upsert (preserva subcollections respuestas/calificaciones).
   *   - data.id ausente → nuevo doc con auto-id Firestore.
   */
  saveExamen(data) {
    if (this.testMode) {
      const e = data.id
        ? Object.assign({}, data)
        : Object.assign({ id: 'ex' + Date.now() }, data);
      if (typeof DEMO_EXAMENES !== 'undefined') {
        const idx = DEMO_EXAMENES.findIndex(x => x.id === e.id);
        if (idx >= 0) DEMO_EXAMENES[idx] = e;
        else DEMO_EXAMENES.push(e);
      }
      return Promise.resolve(e);
    }
    if (this.prodMode) {
      const payload = Object.assign({}, data);
      if (payload.id) {
        const id = payload.id;
        delete payload.id;
        return _db().collection('examenes').doc(id).set(payload, { merge: true })
          .then(() => ({ id, ...payload }));
      }
      return _db().collection('examenes').add(payload)
        .then(ref => ({ id: ref.id, ...payload }));
    }
  },
  // Sweep 2026-06-08: eliminadas DataService.saveRespuestasExamen y
  // saveCalificacionExamen. Eran duplicadas de ExamenesData.setRespuestas y
  // setCalificacionAbierta + recalcularCalificacionFinal, sin callers en el
  // codebase. La persistencia real vive en js/shared/examenes-data.js que
  // dispatcha xahni:examenTomado / xahni:examenCalificado → firestore-sync.

  /**
   * @interaction get-recursos
   * @scope data-service-lectura
   *
   * Given `DEMO_RECURSOS` hidratado.
   * When un consumer pide recursos filtrados (hub-recursos alumno,
   *   recursos profesor, recursos por materia, etc.).
   * Then retorna `Promise<Recurso[]>` filtrado por `materiaId`
   *   y/o `tipo` (PDF/video/link/etc.):
   *   - demo → filter en memoria sobre shallow copy.
   *   - prod → query Firestore con where clauses.
   * Edge:
   *   - sin filtros → retorna todos (mismo riesgo que getTareas pre-pagination).
   *   - filtros excluyentes (combo que no matchea) → array vacío.
   *   - prod: requiere índice compuesto si filtran ambos campos
     (Firebase lo crea on-demand al primer fail).
   */
  getRecursos(filtros = {}) {
    if (this.testMode) {
      let r = [...DEMO_RECURSOS];
      if (filtros.materiaId) r = r.filter(x => x.materiaId === filtros.materiaId);
      if (filtros.tipo)      r = r.filter(x => x.tipo      === filtros.tipo);
      return Promise.resolve(r);
    }
    if (this.prodMode) {
      let q = _db().collection('recursos');
      if (filtros.materiaId) q = q.where('materiaId', '==', filtros.materiaId);
      if (filtros.tipo)      q = q.where('tipo',      '==', filtros.tipo);
      return q.get().then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }
  },
  /**
   * @interaction get-competencias
   * @scope data-service-lectura
   *
   * Given `DEMO_COMPETENCIAS` hidratado.
   * When un consumer pide el listado de competencias (vista
   *   competencias alumno/profesor, hub-grupo tab competencias).
   * Then retorna `Promise<Competencia[]>` filtrado por `materiaId`
   *   y/o `estado` (activa/finalizada/pausada).
   * Edge:
   *   - en vanilla el estado de competencias está mostly mockeado
     (stubs identitarios Slice #10). Post-Supabase: cada estado
     deriva de la lógica versus invertido (memoria
     `project_juegos_vs_competencias_mecanica`).
   *   - sin filtros → retorna todas. Stub vanilla hoy ~12 entries.
   */
  getCompetencias(filtros = {}) {
    if (this.testMode) {
      let r = [...DEMO_COMPETENCIAS];
      if (filtros.materiaId) r = r.filter(c => c.materiaId === filtros.materiaId);
      if (filtros.estado)    r = r.filter(c => c.estado    === filtros.estado);
      return Promise.resolve(r);
    }
    if (this.prodMode) {
      let q = _db().collection('competencias');
      if (filtros.materiaId) q = q.where('materiaId', '==', filtros.materiaId);
      if (filtros.estado)    q = q.where('estado',    '==', filtros.estado);
      return q.get().then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }
  },
  /**
   * @interaction get-usuarios
   * @scope data-service-lectura
   *
   * Given `DEMO_USERS` hidratado.
   * When un consumer necesita el catálogo completo de usuarios
   *   (admin/usuarios, perfil público cross-user, hub-grupo
   *   miembros, leaderboard, etc.).
   * Then retorna `Promise<Usuario[]>` con shallow copy.
   * Edge:
   *   - usuarios contienen `gamer` (Pilar 1: foto/marco/banner/título)
   *     + `puntos`/`nivel`/`racha` (XP) + `tipo` (rol) + relaciones
   *     (`grupoId`, `materiasIds`).
   *   - prod permissions: la regla típica deja read authenticated
   *     (necesario para perfil público y leaderboard). Para
   *     campos sensibles (email del alumno) post-Supabase
   *     aplicar RLS por rol.
   */
  getUsuarios() {
    if (this.testMode) return Promise.resolve([...DEMO_USERS]);
    if (this.prodMode) return _coll('usuarios');
  },
  /**
   * @interaction get-carreras
   * @scope data-service-lectura
   *
   * Given `DEMO_CARRERAS` hidratado.
   * When un consumer necesita catálogo de carreras (admin/carreras,
   *   selector materia, header grupo con "Carrera · Cuatri").
   * Then retorna `Promise<Carrera[]>` con shallow copy. Cada carrera
   *   tiene `clave`, `nombre`, `duracionMeses`, etc.
   * Edge:
   *   - admin puede CRUD carreras (saveCarrera/deleteCarrera) —
   *     getCarreras lee la versión hidratada del array.
   *   - sin carreras (seed vacío) → []. Hoy seed canonical tiene 6.
   */
  getCarreras() {
    if (this.testMode) return Promise.resolve([...DEMO_CARRERAS]);
    if (this.prodMode) return _coll('carreras');
  },
  /**
   * @interaction get-clasificaciones
   * @scope data-service-lectura
   *
   * Given `DEMO_CLASIFICACIONES` hidratado.
   * When admin/clasificaciones o materia con clasificacionId
   *   necesita el catálogo.
   * Then retorna `Promise<Clasificacion[]>`. Cada clasif tiene
   *   `tipo` ("troncoComun" | "especialidad") + `carreraIds[]`.
   * Edge:
   *   - reglas del modelo (slice 4.D): tipo=especialidad ⟹
   *     carreraIds.length === 1; tipo=troncoComun ⟹ ≥ 1.
   *     Validado en `saveClasificacion`, no aquí.
   */
  getClasificaciones() {
    if (this.testMode) return Promise.resolve([...DEMO_CLASIFICACIONES]);
    if (this.prodMode) return _coll('clasificaciones');
  },
  /**
   * @interaction get-juegos
   * @scope data-service-lectura
   *
   * Given `DEMO_JUEGOS` hidratado.
   * When un consumer necesita el listado de juegos creator-economy
   *   (vista juegos alumno/profesor stub, hub-materia tab juegos).
   * Then retorna `Promise<Juego[]>` opcionalmente filtrado por
   *   `materiaId` (parámetro positional, NO objeto filtros).
   * Edge:
   *   - en vanilla los juegos son stub identitario (Slice #10) — no
   *     se juegan. Post-Supabase: cuota 1/tema alumno, ilimitado
   *     profesor, creator-economy XP pasivo (memoria
   *     `project_juegos_vs_competencias_mecanica`).
   *   - sin `materiaId` → retorna todos.
   *   - `materiaId` que no matchea → array vacío.
   */
  getJuegos(materiaId) {
    if (this.testMode) {
      const r = materiaId ? DEMO_JUEGOS.filter(j => j.materiaId === materiaId) : [...DEMO_JUEGOS];
      return Promise.resolve(r);
    }
    if (this.prodMode) {
      let q = _db().collection('juegos');
      if (materiaId) q = q.where('materiaId', '==', materiaId);
      return q.get().then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }
  },
  /**
   * @interaction get-logros
   * @scope data-service-lectura
   *
   * Given `DEMO_LOGROS` hidratado.
   * When un consumer necesita el catálogo de logros desbloqueables
   *   (perfil tab Logros, modal logro desbloqueado, etc.).
   * Then retorna `Promise<Logro[]>` del catálogo COMPLETO. El
   *   parámetro `uid` se ignora actualmente en demo (todos
   *   comparten el mismo array de DEMO_LOGROS); en prod tampoco
   *   se filtra (devuelve toda la colección).
   * Edge:
   *   - el filtrado "logros DEL usuario uid" debe hacerlo el
   *     consumer (cruzar con `DEMO_USERS[uid].gamer.logros[]` o
   *     subcolección equivalente post-Supabase).
   *   - signature acepta uid por compat futura — hoy es no-op.
   */
  getLogros(uid) {
    if (this.testMode) return Promise.resolve([...DEMO_LOGROS]);
    if (this.prodMode) return _coll('logros');
  },
  /**
   * @interaction get-notificaciones
   * @scope data-service-lectura
   *
   * Given un usuario activo y `DEMO_NOTIFICACIONES` (dict by uid)
   *   está poblado.
   * When un consumer necesita las notificaciones del usuario
   *   (panel campana, vista resumen del dashboard, etc.).
   * Then retorna `Promise<Notif[]>`:
   *   - demo → lookup en `DEMO_NOTIFICACIONES[uid || APP.user?.id || 'est1']`
   *     con fallback a `est1` (defensa para vistas pre-login).
   *   - prod → query `usuarios/{uid}/notificaciones`
   *     orderBy(timestamp desc).limit(50).
   * Edge:
   *   - uid no provisto y sin sesión → fallback `est1` (demo).
   *     En prod retorna [] (sin uid no hay path).
   *   - uid sin entries → array vacío.
   *   - límite 50 hardcoded (matches `_NOTIF_MAX` del módulo
   *     `notificaciones.js`).
   *   - NO debe confundirse con `DEMO_NOTIFICACIONES` seed (cola
   *     persistida en localStorage `xahni_notificaciones` por usuario;
   *     ver `_loadNotificaciones` en `notificaciones.js`).
   */
  getNotificaciones(uid) {
    if (this.testMode) {
      const key = uid || APP.user?.id || 'est1';
      return Promise.resolve([...(DEMO_NOTIFICACIONES[key] || [])]);
    }
    if (this.prodMode) {
      const key = uid || APP.user?.id;
      if (!key) return Promise.resolve([]);
      return _db().collection('usuarios').doc(key).collection('notificaciones')
        .orderBy('timestamp', 'desc').limit(50).get()
        .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }
  },
  /**
   * @interaction get-mensajes
   * @scope data-service-lectura
   *
   * Given un `salaId` (formato `${materiaId}_${grupoId}` típicamente,
   *   e.g. `bd_ISC-3A`) y `DEMO_MENSAJES` poblado en `state.js`.
   * When un consumer abre el chat de la sala correspondiente.
   * Then retorna `Promise<Mensaje[]>` del array de mensajes:
   *   - demo → shallow copy de `DEMO_MENSAJES[salaId]` o [].
   *   - prod → subcolección `mensajes/{salaId}/items`
   *     orderBy(timestamp asc).limit(200).
   * Edge:
   *   - salaId inexistente → array vacío.
   *   - prod orden ASC vs demo orden de inserción (concordante:
   *     demo se popula en orden cronológico).
   *   - feature messaging es **deuda post-Supabase** — vanilla solo
   *     tiene seed para 4 salas (bd_ISC-3A, prog_ISC-3A, bd_ISC-3B,
   *     bd_ISW-3A). UI chat no está cableada activamente.
   */
  getMensajes(salaId) {
    if (this.testMode) return Promise.resolve([...(DEMO_MENSAJES[salaId] || [])]);
    if (this.prodMode) {
      return _db().collection('mensajes').doc(salaId).collection('items')
        .orderBy('timestamp', 'asc').limit(200).get()
        .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }
  },
  /**
   * @interaction get-leaderboard
   * @scope data-service-lectura
   *
   * Given DEMO_GRUPOS o DEMO_USERS hidratados.
   * When un consumer pinta una tabla de ranking (vista
   *   competencias profesor, dashboard, hub-grupo comparativa).
   * Then retorna `Promise<Entidad[]>` ordenada por `puntos` desc:
   *   - `scope === 'grupo'` → DEMO_GRUPOS / colección grupos.
   *   - cualquier otro valor → estudiantes (DEMO_USERS filtrado
   *     por `tipo === 'estudiante'`).
   * Edge:
   *   - demo ordena con `.sort` MUTATIVO sobre una shallow copy
     (no toca el array original).
   *   - prod aplica `limit(50)` para evitar leer toda la colección.
   *     Demo no limita — todos los grupos/alumnos seed.
   *   - reactivo equivalente: ver `onLeaderboard` (sesión 3c).
   */
  getLeaderboard(scope) {
    if (this.testMode) {
      if (scope === 'grupo')
        return Promise.resolve([...DEMO_GRUPOS].sort((a, b) => b.puntos - a.puntos));
      return Promise.resolve(
        DEMO_USERS.filter(u => u.tipo === 'estudiante').sort((a, b) => b.puntos - a.puntos)
      );
    }
    if (this.prodMode) {
      if (scope === 'grupo') {
        return _db().collection('grupos').orderBy('puntos', 'desc').limit(50).get()
          .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
      return _db().collection('usuarios').where('tipo', '==', 'estudiante')
        .orderBy('puntos', 'desc').limit(50).get()
        .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }
  },
  /**
   * @interaction get-grupo-stats
   * @scope data-service-lectura
   *
   * Given un `grupoId` (e.g. `ISC-3A`) y DEMO_GRUPOS hidratado.
   * When hub-grupo o cualquier consumer pide los stats del grupo
     puntual (Mi grupo tab, comparativa, etc.).
   * Then retorna `Promise<Grupo|null>` con shallow copy del objeto
     o null si no existe.
   * Edge:
   *   - grupoId no encontrado → null.
   *   - el objeto incluye `puntos`, `nivel`, `xpHistory`, `periodo`,
     `carreraId`, `cuatri`, y otros campos del shape DEMO_GRUPOS.
   *   - mutar el retorno NO muta el array (shallow copy del objeto).
   */
  getGrupoStats(grupoId) {
    if (this.testMode) {
      const g = DEMO_GRUPOS.find(x => x.id === grupoId);
      return Promise.resolve(g ? { ...g } : null);
    }
    if (this.prodMode) {
      return _db().collection('grupos').doc(grupoId).get()
        .then(s => s.exists ? { id: s.id, ...s.data() } : null);
    }
  },
  /**
   * @interaction get-escala
   * @scope data-service-lectura
   *
   * Given `DEMO_ESCALAS` hidratado (escalas de evaluación
     ponderadas por parcial × materia × grupo).
   * When un consumer (gestion profesor, calificaciones alumno,
     escala vista) pide la escala del parcial puntual.
   * Then retorna `Promise<Escala|null>`. El id compuesto es
     `${materiaId}_${grupoId}_${parcialNum}`. Devuelve **DEEP copy**
     de criterios (`criterios.map(c => ({...c}))`) además de shallow
     de la escala — protege contra mutación externa de los rubros.
   * Edge:
   *   - id no existe (escala no creada aún) → null. El UI debe
     ofrecer "Crear escala" en ese caso.
   *   - escalas son el motor del slice escala-rubros (memoria
     `project_escala_evaluacion_schema`). Si `criterios` está
     mal estructurado el `_calcCalFinal` puede devolver NaN.
   */
  getEscala(materiaId, grupoId, parcialNum) {
    if (this.testMode) {
      const id = `${materiaId}_${grupoId}_${parcialNum}`;
      const e  = DEMO_ESCALAS.find(x => x.id === id);
      return Promise.resolve(e ? { ...e, criterios: e.criterios.map(c => ({ ...c })) } : null);
    }
    if (this.prodMode) {
      const id = `${materiaId}_${grupoId}_${parcialNum}`;
      return _db().collection('escalas').doc(id).get()
        .then(s => s.exists ? { id: s.id, ...s.data() } : null);
    }
  },
  /**
   * @interaction get-progreso-escala
   * @scope data-service-lectura
   *
   * Given `DEMO_PROGRESO_ESCALA` hidratado (dict por key
     `${uid}_${escalaId}`).
   * When un consumer pide el progreso de UN alumno en UNA escala
     puntual (calificaciones alumno, gestion profesor por alumno).
   * Then retorna `Promise<Progreso|null>` con deep copy de criterios
     (`criterios.map(c => ({...c}))`).
   * Edge:
   *   - key inexistente → null.
   *   - cada criterio del progreso tiene `valorAuto` (calculado
     por el motor) y opcional `overrideProf` (manual del profe);
     `_calcCalFinal` prioriza el override si existe.
   *   - reactivo: ver `onProgresoEscala` (sesión 3c).
   */
  getProgresoEscala(uid, escalaId) {
    if (this.testMode) {
      const p = DEMO_PROGRESO_ESCALA[`${uid}_${escalaId}`];
      return Promise.resolve(p ? { ...p, criterios: p.criterios.map(c => ({ ...c })) } : null);
    }
    if (this.prodMode) {
      return _db().collection('progreso_escala').doc(`${uid}_${escalaId}`).get()
        .then(s => s.exists ? { id: s.id, ...s.data() } : null);
    }
  },
  /**
   * @interaction get-progreso-estudiante
   * @scope data-service-lectura
   *
   * Given `DEMO_PROGRESO_ESTUDIANTES` hidratado (dict by uid).
   * When un consumer pide el progreso global del alumno
     (perfil, dashboard estudiante, hub-aprendizaje resumen).
   * Then retorna `Promise<Progreso|null>` con shallow copy.
   * Edge:
   *   - uid sin entry → null.
   *   - el objeto contiene XP por materia, racha, logros
     desbloqueados, etc. — schema completo en `data/demo/progreso.json`.
   *   - prod: documento bajo `progreso_estudiantes/{uid}` sin el
     wrapper `{ id }` (`...s.data()` directo, NO `{id: s.id, ...}`).
     Difiere intencionalmente de otros getters porque el uid es
     la key.
   */
  getProgresoEstudiante(uid) {
    if (this.testMode) {
      const p = DEMO_PROGRESO_ESTUDIANTES[uid];
      return Promise.resolve(p ? { ...p } : null);
    }
    if (this.prodMode) {
      return _db().collection('progreso_estudiantes').doc(uid).get()
        .then(s => s.exists ? { ...s.data() } : null);
    }
  },

  // ── Escritura ────────────────────────────────────────────
  /**
   * @interaction save-recurso
   * @scope data-service-escritura
   *
   * Given el profesor llena el form de subir recurso (vista recursos
     profesor, hub-materia tab recursos) con metadata + opcional
     `archivo: File`.
   * When invoca `DataService.saveRecurso(data)`.
   * Then bifurca:
   *   - demo → genera `id: 'r' + Date.now()`, hace push a
     DEMO_RECURSOS, retorna `Promise<RecursoCreado>`.
   *   - prod → si `data.archivo` es File: sube a Storage en
     `recursos/${materiaId}/${timestamp}_${name}` y reemplaza
     `archivo` con la URL final; luego `collection('recursos').add()`
     con `fechaSubida` injectada si no venía.
   * Edge:
   *   - archivo NO es File (link/text) → preserva data sin upload.
   *   - Storage falla (CORS, permisos) → reject propagado al caller.
   *   - id colision con `Date.now()` en demo es astronomicamente
     improbable; en prod usa el id auto-gen de Firestore.
   */
  saveRecurso(data) {
    if (this.testMode) {
      const r = { id: 'r' + Date.now(), ...data };
      DEMO_RECURSOS.push(r);
      return Promise.resolve(r);
    }
    if (this.prodMode) {
      // Si data.archivo es un File, súbelo a Storage primero.
      const upload = data.archivo instanceof File
        ? _uploadFile(`recursos/${data.materiaId}/${Date.now()}_${data.archivo.name}`, data.archivo)
            .then(url => ({ ...data, archivo: undefined, url }))
        : Promise.resolve({ ...data });
      return upload.then(payload => {
        payload.fechaSubida = payload.fechaSubida || new Date().toISOString();
        return _db().collection('recursos').add(payload)
          .then(ref => ({ id: ref.id, ...payload }));
      });
    }
  },
  /**
   * @interaction save-tarea
   * @scope data-service-escritura
   *
   * Given el profesor crea o edita una tarea (modal Nueva tarea
     hub-materia profesor, gestion).
   * When invoca `DataService.saveTarea(data)` con el payload completo.
   * Then:
   *   - demo → genera `id: 't' + Date.now()`, hace push a
     DEMO_TAREAS con `entregas: []` por default si no venía.
   *   - prod → `collection('tareas').add(payload)` con el mismo
     `entregas: []` default.
   *   Retorna `Promise<TareaCreada>`.
   * Edge:
   *   - data ya con `entregas` (edición de tarea existente con
     entregas) → el spread `{ entregas: [], ...data }` PRESERVA las
     entregas existentes (el segundo overwrite gana).
   *   - este save SIEMPRE crea o sobrescribe — no implementa
     UPSERT por id. Edición de tarea pasa por
     `update`/`saveEntrega` para mutaciones puntuales (sin existe
     un saveTareaUpdate dedicado, pendiente cuando aparezca consumer).
   *   - prod: el id auto-gen de Firestore difiere del `t${ts}`
     demo — cualquier consumer que asuma formato `t...` debe
     re-checar post-Supabase.
   */
  saveTarea(data) {
    if (this.testMode) {
      const t = { id: 't' + Date.now(), entregas: [], ...data };
      DEMO_TAREAS.push(t);
      return Promise.resolve(t);
    }
    if (this.prodMode) {
      const payload = { entregas: [], ...data };
      return _db().collection('tareas').add(payload)
        .then(ref => ({ id: ref.id, ...payload }));
    }
  },
  /**
   * @interaction save-entrega
   * @scope data-service-escritura
   *
   * Given un alumno con sesión activa sube archivos a una tarea
     (modal entrega tarea, hub-aprendizaje).
   * When invoca `DataService.saveEntrega(tareaId, uid, archivos, comentario)`.
   * Then:
   *   - demo → busca la tarea, si existe upserts en `entregas[]` por
     uid (idx con `findIndex(e => e.uid === uid)`). Si existe entrega
     previa preserva su `calificacion` (no se pierde al re-entregar).
     Llama `_persistirEntregaLocal` si está cargado para snapshot a
     `localStorage` por uid (sobrevive refresh demo).
   *   - prod → sube cada `File` a Storage en
     `entregas/${tareaId}/${uid}/${name}` y reemplaza por
     `{nombre, url}`. Luego runs `runTransaction` sobre la tarea para
     actualizar `entregas[]` atomicamente.
   *   Retorna `Promise<void>`.
   * Edge:
   *   - archivos no Files (strings/objs ya con `{nombre, url}`) →
     `Promise.resolve(a)` los pasa intactos (re-entrega).
   *   - tarea no existe en demo → no-op (no crashea pero entrega
     se pierde silenciosamente — defensa contra IDs stale).
   *   - calificacion previa undefined → se persiste como `null`
     (`previa?.calificacion ?? null`).
   *   - comentario default `""` (no undefined).
   *   - Storage error o transaction conflict → reject propagado.
   */
  saveEntrega(tareaId, uid, archivos, comentario = "") {
    if (this.testMode) {
      const t = DEMO_TAREAS.find(x => x.id === tareaId);
      if (t) {
        t.entregas   = t.entregas || [];
        const idx    = t.entregas.findIndex(e => e.uid === uid);
        const previa = idx >= 0 ? t.entregas[idx] : null;
        const nueva  = {
          uid,
          fecha:        new Date().toISOString(),
          archivos,
          calificacion: previa?.calificacion ?? null,
          comentario:   comentario || "",
        };
        if (idx >= 0) t.entregas[idx] = nueva; else t.entregas.push(nueva);
        // Snapshot a localStorage para sobrevivir refresh en demo.
        if (typeof _persistirEntregaLocal === "function") {
          _persistirEntregaLocal(tareaId, {
            fecha:      nueva.fecha,
            archivos:   nueva.archivos,
            comentario: nueva.comentario,
          });
        }
      }
      return Promise.resolve();
    }
    if (this.prodMode) {
      // Si archivos son File[], subirlos a Storage. Si son strings/objs, conservarlos.
      const uploads = (archivos || []).map(a => {
        if (a instanceof File) {
          return _uploadFile(`entregas/${tareaId}/${uid}/${a.name}`, a)
            .then(url => ({ nombre: a.name, url }));
        }
        return Promise.resolve(a);
      });
      return Promise.all(uploads).then(archivosResolved => {
        const ref = _db().collection('tareas').doc(tareaId);
        return _db().runTransaction(tx => tx.get(ref).then(snap => {
          const data        = snap.data() || {};
          const entregasOld = data.entregas || [];
          const previa      = entregasOld.find(e => e.uid === uid);
          const nueva       = {
            uid,
            fecha:        new Date().toISOString(),
            archivos:     archivosResolved,
            calificacion: previa?.calificacion ?? null,
            comentario:   comentario || "",
          };
          const entregas = entregasOld.filter(e => e.uid !== uid);
          entregas.push(nueva);
          tx.update(ref, { entregas });
        }));
      });
    }
  },
  /**
   * @interaction save-points
   * @scope data-service-escritura
   *
   * Given un evento que premia XP a un usuario específico (puede
     ser distinto del usuario activo: profesor califica → alumno
     gana XP).
   * When un módulo invoca `DataService.savePoints(uid, amount, reason)`.
   * Then suma `amount` a `puntos` del usuario:
   *   - demo → si uid === `APP.user?.id`, también muta `APP.user.puntos`
     (mantiene UI sincronizada). Después busca el usuario en
     DEMO_USERS y muta `puntos` ahí.
   *   - prod → `update()` con `FieldValue.increment(amount)` (atómico
     en Firestore, evita races con writes concurrentes). Si uid ===
     APP.user?.id, también muta in-memory.
   * Edge:
   *   - uid no existe en DEMO_USERS (demo) → mutación in-memory de
     APP.user.puntos sigue, pero el DEMO_USERS no se toca. Inconsistencia
     transitoria menor.
   *   - `reason` no se persiste hoy (signature lo recibe pero no se
     escribe). Deuda: log de transacciones XP post-Supabase.
   *   - addXP en `state.js` es la API que dispara nivel-up + toasts;
     este `savePoints` es de bajo nivel y NO recalcula nivel.
   */
  savePoints(uid, amount, reason) {
    if (this.testMode) {
      if (uid === APP.user?.id) APP.user.puntos = (APP.user.puntos || 0) + amount;
      const u = DEMO_USERS.find(x => x.id === uid);
      if (u) u.puntos = (u.puntos || 0) + amount;
      return Promise.resolve();
    }
    if (this.prodMode) {
      const inc = firebase.firestore.FieldValue.increment(amount);
      return _db().collection('usuarios').doc(uid).update({ puntos: inc }).then(() => {
        if (uid === APP.user?.id) APP.user.puntos = (APP.user.puntos || 0) + amount;
      });
    }
  },
  /**
   * @interaction save-grupo-points
   * @scope data-service-escritura
   *
   * Given un evento que premia XP a un grupo (competencia ganada,
     proyecto colectivo, etc.).
   * When un módulo invoca `DataService.saveGrupoPoints(grupoId, amount, reason)`.
   * Then suma `amount` a `puntos` del grupo:
   *   - demo → mutación in-place sobre DEMO_GRUPOS.
   *   - prod → `FieldValue.increment(amount)` atómico.
   * Edge:
   *   - grupoId no existe en demo → no-op silencioso (defensa
     contra IDs stale).
   *   - `reason` no se persiste (mismo gap que savePoints).
   *   - NO recalcula el estado evolutivo del grupo (rookie →
     forming → ... → legendary). El helper `_getEstadoEvolutivo`
     en `hub-grupo.js` lo deriva en cada render.
   */
  saveGrupoPoints(grupoId, amount, reason) {
    if (this.testMode) {
      const g = DEMO_GRUPOS.find(x => x.id === grupoId);
      if (g) g.puntos = (g.puntos || 0) + amount;
      return Promise.resolve();
    }
    if (this.prodMode) {
      const inc = firebase.firestore.FieldValue.increment(amount);
      return _db().collection('grupos').doc(grupoId).update({ puntos: inc });
    }
  },
  /**
   * @interaction save-juego-completado
   * @scope data-service-escritura
   *
   * Given un alumno completa un juego (stub vanilla — no se juegan
     en vanilla, solo persiste el shape).
   * When invoca `DataService.saveJuegoCompletado(uid, juegoId, resultado)`.
   * Then:
   *   - demo → lazy-init `window._DEMO_JUEGOS_COMPLETADOS` como
     dict, persiste key `${uid}_${juegoId}` → `resultado`. NO
     persiste en localStorage (volátil, se pierde al refresh).
   *   - prod → `juegos_completados/{uid_juegoId}` set con
     `timestamp` injectado.
   *   Retorna `Promise<void>`.
   * Edge:
   *   - re-completar mismo juego → sobreescribe el resultado
     anterior (sin historial).
   *   - feature lógica es **post-Supabase** (creator-economy
     completa con cuota + XP pasivo al creador). Vanilla solo
     mantiene el endpoint para que la UI mock funcione.
   */
  saveJuegoCompletado(uid, juegoId, resultado) {
    if (this.testMode) {
      if (!window._DEMO_JUEGOS_COMPLETADOS) window._DEMO_JUEGOS_COMPLETADOS = {};
      window._DEMO_JUEGOS_COMPLETADOS[`${uid}_${juegoId}`] = resultado;
      return Promise.resolve();
    }
    if (this.prodMode) {
      return _db().collection('juegos_completados').doc(`${uid}_${juegoId}`)
        .set({ uid, juegoId, ...resultado, timestamp: new Date().toISOString() });
    }
  },
  /**
   * @interaction save-competencia-resultado
   * @scope data-service-escritura
   *
   * Given una competencia concluida (manualmente o por umbral
     de nota, según mecánica documentada en memoria
     `project_juegos_vs_competencias_mecanica`).
   * When invoca `DataService.saveCompetenciaResultado(competenciaId, resultados)`.
   * Then en demo muta DEMO_COMPETENCIAS in-place seteando
     `resultados` y `estado: 'finalizada'`. En prod hace `update`
     con esos mismos 2 campos.
   * Edge:
   *   - competenciaId no existe en demo → no-op silencioso.
   *   - retorna `Promise<void>` (no devuelve el objeto actualizado).
   *   - NO re-evalúa el versus invertido (lógica de quién gana es
     del caller). Este save solo persiste el resultado calculado.
   */
  saveCompetenciaResultado(competenciaId, resultados) {
    if (this.testMode) {
      const c = DEMO_COMPETENCIAS.find(x => x.id === competenciaId);
      if (c) { c.resultados = resultados; c.estado = 'finalizada'; }
      return Promise.resolve();
    }
    if (this.prodMode) {
      return _db().collection('competencias').doc(competenciaId)
        .update({ resultados, estado: 'finalizada' });
    }
  },
  /**
   * @interaction get-inscripciones-competencia
   * @scope data-service-lectura
   *
   * Given compId de un torneo activo o cerrado.
   * When invoca `DataService.getInscripcionesCompetencia(compId)`.
   * Then:
   *   - demo → escanea localStorage por keys `xahni:comp:attempts:{compId}:{uid}`
   *     y devuelve la lista de uids con ≥1 attempt (efectivamente inscritos).
   *   - prod → lee sub-coll `competencias/{compId}/inscripciones` y devuelve
   *     array de docs `{uid, inscritoEn}`.
   * Edge:
   *   - compId inexistente → array vacío.
   *   - Sub-coll vacía en prod → array vacío.
   */
  getInscripcionesCompetencia(compId) {
    if (this.testMode) {
      const prefix = `xahni:comp:attempts:${compId}:`;
      const inscritos = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.indexOf(prefix) === 0) {
            const uid = key.substring(prefix.length);
            inscritos.push({ uid: uid });
          }
        }
      } catch (e) { /* defensive */ }
      return Promise.resolve(inscritos);
    }
    if (this.prodMode) {
      return _db().collection('competencias').doc(compId)
        .collection('inscripciones').get()
        .then(qs => {
          const out = [];
          qs.forEach(doc => out.push(doc.data()));
          return out;
        });
    }
  },
  /**
   * @interaction get-intentos-competencia
   * @scope data-service-lectura
   *
   * Given compId + uid de alumno participante.
   * When invoca `DataService.getIntentosCompetencia(compId, uid)`.
   * Then:
   *   - demo → lee `xahni:comp:attempts:{compId}:{uid}` de localStorage
   *     (mismo shape que `CompetenciasData.getAttempts`).
   *   - prod → lee sub-coll `competencias/{compId}/intentos` filtrando
   *     por uid y devuelve array de `{uid, attemptN, score, fecha}`.
   * Edge:
   *   - Sin intentos → array vacío.
   *   - Máximo 3 intentos por uid (MAX_ATTEMPTS).
   */
  getIntentosCompetencia(compId, uid) {
    if (this.testMode) {
      try {
        const raw = localStorage.getItem(`xahni:comp:attempts:${compId}:${uid}`);
        return Promise.resolve(raw ? JSON.parse(raw) : []);
      } catch (e) {
        return Promise.resolve([]);
      }
    }
    if (this.prodMode) {
      return _db().collection('competencias').doc(compId)
        .collection('intentos').where('uid', '==', uid).get()
        .then(qs => {
          const out = [];
          qs.forEach(doc => out.push(doc.data()));
          out.sort((a, b) => (a.attemptN || 0) - (b.attemptN || 0));
          return out;
        });
    }
  },
  /**
   * @interaction save-notificacion
   * @scope data-service-escritura
   *
   * Given un evento del producto que merece notificar a un
     usuario específico (puede no ser el usuario activo: profe
     modifica calificación → alumno recibe notificación).
   * When un módulo invoca `DataService.saveNotificacion(uid, data)`.
   * Then:
   *   - demo → lazy-init `DEMO_NOTIFICACIONES[uid]`, hace `unshift`
     con `id: 'n' + Date.now()`, `leida: false`, `timestamp: now()`
     + spread del data del caller.
   *   - prod → `usuarios/{uid}/notificaciones.add()` con `leida: false`
     + `timestamp: now()` injectados.
   * Edge:
   *   - este `saveNotificacion` (data-service) NO debe confundirse
     con `agregarNotificacion` (notificaciones.js). Aquel persiste
     en localStorage del usuario activo; este escribe en el seed
     o en Firestore para OTRO usuario. Son flujos distintos por
     diseño.
   *   - NO se actualiza el badge del usuario destino (el badge se
     refresca en el siguiente `_actualizarBadge` que dispare otro
     evento).
   */
  saveNotificacion(uid, data) {
    if (this.testMode) {
      if (!DEMO_NOTIFICACIONES[uid]) DEMO_NOTIFICACIONES[uid] = [];
      DEMO_NOTIFICACIONES[uid].unshift({
        id: 'n' + Date.now(), ...data, leida: false, timestamp: new Date().toISOString(),
      });
      return Promise.resolve();
    }
    if (this.prodMode) {
      return _db().collection('usuarios').doc(uid).collection('notificaciones').add({
        ...data, leida: false, timestamp: new Date().toISOString(),
      });
    }
  },
  /**
   * @interaction save-escala
   * @scope data-service-escritura
   *
   * Given el profesor define o edita una escala de evaluación
     (slice escala-rubros · vista gestion profesor por materia/grupo/parcial).
   * When invoca `DataService.saveEscala(data)` con el shape completo.
   * Then:
   *   - demo → upsert por `id` (compuesto `materiaId_grupoId_parcialN`)
     con DEEP copy de criterios para que el array persistido no
     comparta referencia con el del caller.
   *   - prod → `escalas/{id}.set(data, {merge: true})`.
   * Edge:
   *   - escalas duplican criterios entre parciales por diseño (cada
     parcial tiene su escala propia). `copiarEscala` permite
     duplicar desde otra como template.
   *   - tiene que cumplir restricciones del modelo (rubros ponderados
     entre 100-120%, cap visible a 100% · memoria
     `project_escala_evaluacion_schema`).
   *   - cualquier override de calificación previo en
     PROGRESO_ESCALA queda intacto — esta función NO recalcula
     calFinal automáticamente.
   */
  saveEscala(data) {
    if (this.testMode) {
      const idx = DEMO_ESCALAS.findIndex(e => e.id === data.id);
      const copy = { ...data, criterios: data.criterios.map(c => ({ ...c })) };
      if (idx >= 0) DEMO_ESCALAS[idx] = copy; else DEMO_ESCALAS.push(copy);
      return Promise.resolve();
    }
    if (this.prodMode) {
      return _db().collection('escalas').doc(data.id).set(data, { merge: true });
    }
  },
  /**
   * @interaction update-override-criterio
   * @scope data-service-escritura
   *
   * Given un profesor decide manualmente sobrescribir el `valorAuto`
     de UN criterio de UN alumno (gestion → escala individual).
   * When invoca `updateOverrideCriterio(uid, escalaId, criterioId, valor)`.
   * Then:
   *   - demo → busca el progreso, set `overrideProf = valor` en el
     criterio, recalcula `calFinal` con `_calcCalFinal(p, escala)`
     y dispara `saveNotificacion(uid, ...)` informando al alumno.
   *   - prod → `runTransaction` que lee progreso + escala, aplica
     override, recalcula calFinal, set la transacción. Después
     del commit notifica al alumno.
   * Edge:
   *   - progreso no existe → demo no-op silencioso; prod retorna
     sin escribir (snap.exists check).
   *   - criterio no existe → mutación se omite (`c` undefined,
     guard `if (c)`).
   *   - escala referenciada por el progreso no existe → calFinal
     no se recalcula pero override sí se persiste (caso edge raro).
   *   - el override es por-criterio. Para sobrescribir la nota
     final completa ver `updateCalFinalOverride`.
   *   - la notif al alumno NO incluye el delta numérico (solo
     "Tu criterio fue modificado manualmente").
   */
  updateOverrideCriterio(uid, escalaId, criterioId, valor) {
    if (this.testMode) {
      const p = DEMO_PROGRESO_ESCALA[`${uid}_${escalaId}`];
      if (p) {
        const c = p.criterios.find(x => x.criterioId === criterioId);
        if (c) c.overrideProf = valor;
        const escala = DEMO_ESCALAS.find(e => e.id === escalaId);
        if (escala) p.calFinal = _calcCalFinal(p, escala);
        this.saveNotificacion(uid, {
          tipo: 'override', titulo: 'Criterio modificado por el profesor',
          cuerpo: `Tu criterio fue modificado manualmente`,
        });
      }
      return Promise.resolve();
    }
    if (this.prodMode) {
      const ref = _db().collection('progreso_escala').doc(`${uid}_${escalaId}`);
      return _db().runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const p   = snap.data();
        const c   = p.criterios.find(x => x.criterioId === criterioId);
        if (c) c.overrideProf = valor;
        const escalaSnap = await tx.get(_db().collection('escalas').doc(escalaId));
        if (escalaSnap.exists) p.calFinal = _calcCalFinal(p, escalaSnap.data());
        tx.set(ref, p);
      }).then(() => this.saveNotificacion(uid, {
        tipo: 'override', titulo: 'Criterio modificado por el profesor',
        cuerpo: 'Tu criterio fue modificado manualmente',
      }));
    }
  },
  /**
   * @interaction update-cal-final-override
   * @scope data-service-escritura
   *
   * Given un profesor decide sobrescribir TODA la calificación final
     del alumno en UNA escala (más drástico que override de criterio).
   * When invoca `updateCalFinalOverride(uid, escalaId, valor)`.
   * Then:
   *   - demo → set `p.calFinalOverride = valor` (NO `calFinal` directo
     — la lectura debe priorizar `calFinalOverride ?? calFinal`).
   *   - prod → `update({calFinalOverride: valor})`.
   *   Después notifica al alumno con "Tu calificación fue modificada
     por el profesor".
   * Edge:
   *   - progreso no existe (demo) → no-op silencioso.
   *   - este override coexiste con overrides por-criterio: en
     lectura ambos están y el caller decide cuál mostrar. Diseño
     actual: el calFinalOverride GANA sobre los recálculos de
     criterio.
   *   - NO valida rango (`valor` puede ser >10 o negativo). El
     UI debe validar antes del call.
   */
  updateCalFinalOverride(uid, escalaId, valor) {
    if (this.testMode) {
      const p = DEMO_PROGRESO_ESCALA[`${uid}_${escalaId}`];
      if (p) {
        p.calFinalOverride = valor;
        this.saveNotificacion(uid, {
          tipo: 'override', titulo: 'Calificación modificada manualmente',
          cuerpo: `Tu calificación fue modificada por el profesor`,
        });
      }
      return Promise.resolve();
    }
    if (this.prodMode) {
      return _db().collection('progreso_escala').doc(`${uid}_${escalaId}`)
        .update({ calFinalOverride: valor })
        .then(() => this.saveNotificacion(uid, {
          tipo: 'override', titulo: 'Calificación modificada manualmente',
          cuerpo: 'Tu calificación fue modificada por el profesor',
        }));
    }
  },
  /**
   * @interaction copiar-escala
   * @scope data-service-escritura
   *
   * Given un profesor tiene una escala ya configurada y quiere
     reusarla en otro parcial o grupo (botón "Copiar de..." en
     gestion → escala vacía).
   * When invoca `copiarEscala(escalaId, destGrupoId, destParcialNum)`.
   * Then:
   *   - demo → busca la escala fuente, construye una nueva con
     `id: ${materiaId}_${destGrupoId}_${destParcialNum}`, mismo
     `materiaId`, nuevo grupo + parcial, `guardado: false` (marca
     que requiere review del profe), deep copy de criterios.
     Upsert por id (overwrite si ya existía).
   *   - prod → lee escala fuente, set en nuevo id.
   *   Retorna `Promise<Escala|null>` con la copia (null si fuente
     no existe).
   * Edge:
   *   - fuente no existe → null.
   *   - destino ya existe → SE SOBREESCRIBE (no hay confirmación
     a nivel de service; la UI debe confirmar antes).
   *   - `materiaId` siempre copia de la fuente (NO permite cross-materia).
   *   - `guardado: false` señala al UI que es un draft hasta que
     el profe confirme.
   */
  copiarEscala(escalaId, destGrupoId, destParcialNum) {
    if (this.testMode) {
      const src = DEMO_ESCALAS.find(e => e.id === escalaId);
      if (!src) return Promise.resolve(null);
      const newId = `${src.materiaId}_${destGrupoId}_${destParcialNum}`;
      const copy  = { ...src, id: newId, grupoId: destGrupoId, parcialNum: destParcialNum, guardado: false, criterios: src.criterios.map(c => ({ ...c })) };
      const idx   = DEMO_ESCALAS.findIndex(e => e.id === newId);
      if (idx >= 0) DEMO_ESCALAS[idx] = copy; else DEMO_ESCALAS.push(copy);
      return Promise.resolve(copy);
    }
    if (this.prodMode) {
      return _db().collection('escalas').doc(escalaId).get().then(snap => {
        if (!snap.exists) return null;
        const src   = snap.data();
        const newId = `${src.materiaId}_${destGrupoId}_${destParcialNum}`;
        const copy  = { ...src, id: newId, grupoId: destGrupoId, parcialNum: destParcialNum, guardado: false };
        return _db().collection('escalas').doc(newId).set(copy).then(() => copy);
      });
    }
  },

  // ── Admin CRUD ───────────────────────────────────────────
  // Upsert por id; si data.id no viene, demo genera uno sintético.
  // Demo muta el array global in-place (Object.assign sobre la entidad
  // existente cuando hay match por id) para preservar la identidad
  // referencial — módulos legacy y enriquecedores pueden tener handles
  // directos al objeto. Devuelve copia con el id final resuelto.
  /**
   * @interaction save-usuario
   * @scope data-service-admin-crud
   *
   * Given el admin llena el modal Crear/Editar usuario (vista
     admin/usuarios) con shape completo (nombre, email, tipo, grupoId,
     materiasIds, etc.).
   * When invoca `DataService.saveUsuario(data)`.
   * Then upserts por `id`:
   *   - demo → `_upsertById(DEMO_USERS, data, () => 'u' + Date.now())`.
     Identidad referencial preservada en update (Object.assign in-place).
     Retorna shallow copy `{...out}` con el id final.
   *   - prod → genera id auto (`collection().doc().id`) si no viene,
     `set(payload, {merge: true})`.
   * Edge:
   *   - data sin `id` y sin email único → demo genera `u${ts}`, prod
     genera id Firestore.
   *   - update preserva referencia para módulos legacy que conserven
     handles al objeto (e.g. `_userById` cache, comparativas).
   *   - NO sincroniza relaciones bidireccionales (e.g. agregar usuario
     a grupo NO actualiza `DEMO_GRUPOS[g].alumnos[]`). El caller
     `js/admin/usuarios.js` lo hace explicitamente antes del save.
   *   - reactivar usuario eliminado en Auth (prod) requiere paso
     manual extra — deuda post-Supabase.
   */
  saveUsuario(data) {
    if (this.testMode) {
      const out = _upsertById(DEMO_USERS, data, () => 'u' + Date.now());
      return Promise.resolve({ ...out });
    }
    if (this.prodMode) {
      const id = data.id || _db().collection('usuarios').doc().id;
      const payload = { ...data, id };
      return _db().collection('usuarios').doc(id).set(payload, { merge: true })
        .then(() => payload);
    }
  },
  /**
   * @interaction delete-usuario
   * @scope data-service-admin-crud
   *
   * Given el admin confirmó eliminar un usuario en
     `admin/usuarios.js`.
   * When invoca `DataService.deleteUsuario(uid)`.
   * Then:
   *   - demo → `_removeById(DEMO_USERS, uid)` (splice por id,
     idempotente si no existe).
   *   - prod → `delete()` el doc en Firestore.
   * Edge:
   *   - uid inexistente → demo no-op silencioso; prod resuelve
     OK (Firestore tampoco crashea por delete missing).
   *   - hard delete sin recuperación. La integridad referencial
     (limpiar `grupoId` en relaciones) NO está implementada — es
     deuda admin pre-Supabase. Slice 4.B/4.C documenta la sincronía
     bidireccional canónica en `materias.js`.
   *   - Firebase Auth: el doc se borra pero la cuenta Auth NO. La
     cuenta sigue pudiendo loguearse — `_firebaseLogin` la rechaza
     en `auth/no-profile`. Deuda: borrar via Admin SDK post-Supabase.
   */
  deleteUsuario(uid) {
    if (this.testMode) {
      _removeById(DEMO_USERS, uid);
      return Promise.resolve();
    }
    if (this.prodMode) {
      return _db().collection('usuarios').doc(uid).delete();
    }
  },
  /**
   * @interaction save-institucion
   * @scope data-service-admin-crud
   *
   * Given el admin crea/edita una institución en
     `admin/instituciones.js`.
   * When invoca `DataService.saveInstitucion(data)`.
   * Then upsert por id:
   *   - demo → `_upsertById(DEMO_INSTITUCIONES, data, () => Date.now())`
     (id numérico generado sin prefijo, legacy del shape original).
     Retorna shallow copy con id final.
   *   - prod → `set(payload, {merge: true})`. Si data.id no viene
     usa id auto de Firestore convertido a String.
   * Edge:
   *   - el id se castea a String en prod (`String(id)`) pero demo
     puede tener number. Defensa: el lookup usa `String(x.id) === String(id)`.
   *   - sin guard de integridad referencial (carreras pueden
     referenciar institucionId sin validación cross). Deuda menor.
   */
  saveInstitucion(data) {
    if (this.testMode) {
      const out = _upsertById(DEMO_INSTITUCIONES, data, () => Date.now());
      return Promise.resolve({ ...out });
    }
    if (this.prodMode) {
      const id = data.id ?? _db().collection('instituciones').doc().id;
      const payload = { ...data, id };
      return _db().collection('instituciones').doc(String(id)).set(payload, { merge: true })
        .then(() => payload);
    }
  },
  /**
   * @interaction delete-institucion
   * @scope data-service-admin-crud
   *
   * Given el admin confirmó borrar una institución.
   * When invoca `DataService.deleteInstitucion(id)`.
   * Then `_removeById(DEMO_INSTITUCIONES, id)` (demo) o
     `delete()` (prod, con String cast del id).
   * Edge:
   *   - sin guard de integridad: si hay carreras o usuarios
     referenciando esta institución, las refs quedan colgando.
     Deuda menor pre-Supabase (a diferencia de `deleteCarrera` y
     `deleteClasificacion` que SÍ validan).
   *   - idempotente: id inexistente → no-op.
   */
  deleteInstitucion(id) {
    if (this.testMode) {
      _removeById(DEMO_INSTITUCIONES, id);
      return Promise.resolve();
    }
    if (this.prodMode) {
      return _db().collection('instituciones').doc(String(id)).delete();
    }
  },
  // Grupo: id string semántico (ej "ISC-3A"). Si el caller no provee id,
  // genera 'grp_' + timestamp. Mismo upsert in-place que el resto de admin
  // CRUD; preserva referencia para módulos que ya tengan handle al objeto.
  /**
   * @interaction save-grupo
   * @scope data-service-admin-crud
   *
   * Given el admin crea/edita un grupo (vista admin/grupos).
   * When invoca `DataService.saveGrupo(data)`.
   * Then upsert por id (string semántico tipo "ISC-3A" o autogen
     `grp_${ts}`):
   *   - demo → `_upsertById` preservando referencia.
   *   - prod → `set(payload, {merge: true})` con id String cast.
   * Edge:
   *   - el id semántico es preferible (`ISC-3A`, `LMI-2B`) — más
     legible cross-vista; autogen es fallback.
   *   - grupo trae `periodo` (slice 2026-05-14 movió período de
     materias a grupos), `carreraId`, `cuatri`, `puntos`,
     `xpHistory`, etc.
   *   - NO sincroniza materias.grupos[] ni usuarios.grupoId; el
     caller `js/admin/grupos.js` lo hace antes del save. Mismo
     patrón que materias.js (sync bidireccional manual).
   */
  saveGrupo(data) {
    if (this.testMode) {
      const out = _upsertById(DEMO_GRUPOS, data, () => 'grp_' + Date.now());
      return Promise.resolve({ ...out });
    }
    if (this.prodMode) {
      const db = _db();
      const id = data.id ?? db.collection('grupos').doc().id;
      const payload = { ...data, id };
      const grupoRef = db.collection('grupos').doc(String(id));
      const batch = db.batch();

      // 1. Set doc grupo
      batch.set(grupoRef, payload, { merge: true });

      // 2. Para cada uid en payload.miembros[]:
      //    - update usuarios/{uid}.grupoId = id (singular, módulos nuevos)
      //    - update usuarios/{uid}.grupos = [id] (array, módulos legacy
      //      hub-grupo._getGrupoId, _getMiembros que filtran grupos[].includes)
      //    - update usuarios/{uid}.materias = grupo.materias (propagación)
      //    Razón: hydrateOnLogin filtra examenes por user.materias. Sin la
      //    propagación, alumno asignado a grupo no ve sus exámenes (deuda
      //    descubierta en smoke prod 2026-06-06). Schema inconsistencia
      //    grupoId vs grupos[] cementada (legacy) — propagamos ambos hasta
      //    consolidación post-Supabase.
      const nuevosMiembros = Array.isArray(payload.miembros) ? payload.miembros : [];
      const materiasIds = Array.isArray(payload.materias) ? payload.materias : [];
      nuevosMiembros.forEach(uid => {
        const userRef = db.collection('usuarios').doc(String(uid));
        batch.update(userRef, {
          grupoId: String(id),
          grupos: [String(id)],
          materias: materiasIds.map(String)
        });
      });

      // 3. Para cada matId en payload.materias[]: update materias/{matId}.grupos arrayUnion id
      materiasIds.forEach(matId => {
        const matRef = db.collection('materias').doc(String(matId));
        batch.update(matRef, {
          grupos: firebase.firestore.FieldValue.arrayUnion(String(id))
        });
      });

      return batch.commit().then(() => payload);
    }
  },
  // Hard delete. La limpieza de sincronía bidireccional (materia.grupos[]
  // y usuario.grupoId) la hace el caller en js/admin/grupos.js ANTES de
  // invocar este método — mismo contrato que materias.js para
  // _syncGruposMateriasAdmin. En prod requerirá batched write Firestore
  // (deuda explícita, mirror de la ya documentada en saveMateria).
  /**
   * @interaction delete-grupo
   * @scope data-service-admin-crud
   *
   * Given el admin confirmó borrar un grupo.
   * When invoca `DataService.deleteGrupo(id)`.
   * Then `_removeById` (demo) o `delete()` (prod String cast).
   * Edge:
   *   - **Contrato explícito**: la limpieza de sincronía bidireccional
     (`materia.grupos[]` y `usuario.grupoId`) la hace el caller en
     `js/admin/grupos.js` ANTES de invocar. NO se valida aquí.
   *   - Mismo contrato que `deleteMateria` (sync manual).
   *   - prod: deuda batched write Firestore para que las
     mutaciones cross-colección sean atómicas. Mirror de la
     mencionada en `saveMateria`.
   *   - idempotente.
   */
  deleteGrupo(id) {
    if (this.testMode) {
      _removeById(DEMO_GRUPOS, id);
      return Promise.resolve();
    }
    if (this.prodMode) {
      const db = _db();
      const grupoRef = db.collection('grupos').doc(String(id));

      return grupoRef.get().then(snap => {
        if (!snap.exists) return;
        const data = snap.data() || {};
        const miembros = Array.isArray(data.miembros) ? data.miembros : [];
        const materiasIds = Array.isArray(data.materias) ? data.materias : [];

        const batch = db.batch();

        miembros.forEach(uid => {
          const userRef = db.collection('usuarios').doc(String(uid));
          batch.update(userRef, { grupoId: null });
        });

        materiasIds.forEach(matId => {
          const matRef = db.collection('materias').doc(String(matId));
          batch.update(matRef, {
            grupos: firebase.firestore.FieldValue.arrayRemove(String(id))
          });
        });

        batch.delete(grupoRef);

        return batch.commit();
      });
    }
  },
  // Carrera: id string semántico (ej "isc"). Si el caller no provee id,
  // genera uno desde clave (lowercased). Mismo upsert in-place que el
  // resto de admin CRUD; preserva referencia para módulos que ya tengan
  // handle al objeto.
  /**
   * @interaction save-carrera
   * @scope data-service-admin-crud
   *
   * Given el admin crea/edita una carrera en `admin/carreras.js`.
   * When invoca `DataService.saveCarrera(data)`.
   * Then upsert con id derivado:
   *   - demo → si data.id, usa data.id; sino `data.clave.toLowerCase()`
     (ej "ISC" → "isc"); fallback `car_${ts}` si no hay clave.
   *   - prod → mismo, con `String(id)` cast.
   * Edge:
   *   - el id semántico ("isc", "lmi") es preferido por legibilidad.
   *   - shape incluye `clave`, `nombre`, `duracionMeses`,
     `institucionId`.
   *   - sin guard de integridad referencial al guardar (acepta
     `institucionId` inexistente). Guard solo en delete.
   */
  saveCarrera(data) {
    if (this.testMode) {
      const out = _upsertById(DEMO_CARRERAS, data, () => String(data.clave || 'car_' + Date.now()).toLowerCase());
      return Promise.resolve({ ...out });
    }
    if (this.prodMode) {
      const id = data.id ?? (data.clave ? String(data.clave).toLowerCase() : _db().collection('carreras').doc().id);
      const payload = { ...data, id };
      return _db().collection('carreras').doc(String(id)).set(payload, { merge: true })
        .then(() => payload);
    }
  },
  // Guardia de integridad referencial (4.B): no permitir borrar carrera
  // con grupos referenciándola. En 4.D se extenderá para clasificaciones.
  // En prod la guardia es eventualmente consistente — lee el snapshot
  // hidratado de DEMO_GRUPOS, no Firestore directamente. Devuelve
  // Promise.reject con { code, refs, message } si la guardia falla;
  // el caller muestra mensaje en UI.
  /**
   * @interaction delete-carrera
   * @scope data-service-admin-crud
   *
   * Given el admin confirmó eliminar una carrera.
   * When invoca `DataService.deleteCarrera(id)`.
   * Then valida guard de integridad referencial PRIMERO (slice 4.B):
     filtra `DEMO_GRUPOS` por `carreraId === id`. Si encuentra
     referencias, devuelve `Promise.reject({code:'CARRERA_IN_USE',
     refs:[grupoIds], message:'No se puede eliminar: N grupo(s)...'})`.
     Sin referencias: `_removeById` (demo) o `delete()` (prod).
   * Edge:
   *   - el guard lee `DEMO_GRUPOS` hidratado (memoria). En prod
     es eventualmente consistente: si entre la lectura y el delete
     se crea un grupo nuevo referenciando, queda colgado. Mitigación
     post-Supabase: foreign key real + ON DELETE RESTRICT.
   *   - el caller debe `.catch(err)` y mostrar mensaje. Patrón
     cementado en sesión 3a (admin/carreras.js).
   *   - `refs[]` viene como array de ids — el caller puede listarlos
     al usuario.
   *   - idempotente cuando no hay refs (delete missing = OK).
   */
  deleteCarrera(id) {
    const refs = DEMO_GRUPOS.filter(g => String(g.carreraId) === String(id));
    if (refs.length > 0) {
      return Promise.reject({
        code: 'CARRERA_IN_USE',
        refs: refs.map(g => g.id),
        message: `No se puede eliminar: ${refs.length} grupo(s) referencian esta carrera`,
      });
    }
    if (this.testMode) {
      _removeById(DEMO_CARRERAS, id);
      return Promise.resolve();
    }
    if (this.prodMode) {
      return _db().collection('carreras').doc(String(id)).delete();
    }
  },
  // Clasificacion: id string semántico (ej "tcomun", "esp-isc"). Valida
  // reglas del modelo (4.D): tipo=especialidad ⟹ carreraIds.length === 1;
  // tipo=troncoComun ⟹ carreraIds.length >= 1. Devuelve Promise.reject con
  // {code, message} si la validación falla; el caller muestra mensaje UI.
  /**
   * @interaction save-clasificacion
   * @scope data-service-admin-crud
   *
   * Given el admin crea/edita una clasificación (tronco común o
     especialidad) en `admin/clasificaciones.js`.
   * When invoca `DataService.saveClasificacion(data)`.
   * Then valida shape rules del modelo (slice 4.D):
   *   - `tipo === 'especialidad'` ⟹ `carreraIds` debe ser array
     de longitud EXACTAMENTE 1. Sino `Promise.reject({code:
     'CLASIF_ESPECIALIDAD_INVALID'})`.
   *   - `tipo === 'troncoComun'` ⟹ `carreraIds` array longitud
     ≥ 1. Sino `Promise.reject({code: 'CLASIF_TRONCO_INVALID'})`.
   *   Pasa la validación → upsert por id (demo `_upsertById` con
     genId `clasif_${ts}`, prod `set({merge:true})`).
   * Edge:
   *   - Si `data.tipo` no es ni 'especialidad' ni 'troncoComun',
     pasa al upsert sin validar — tipo libre. Deuda menor (el UI
     restringe el selector pero el endpoint no).
   *   - validación es **pre-flight** antes de tocar el array (no
     hay rollback necesario).
   *   - el caller `.catch` y muestra mensaje UI. Patrón cementado
     en sesión 4.D.
   */
  saveClasificacion(data) {
    if (data.tipo === 'especialidad' && (!Array.isArray(data.carreraIds) || data.carreraIds.length !== 1)) {
      return Promise.reject({
        code: 'CLASIF_ESPECIALIDAD_INVALID',
        message: 'Una especialidad debe cubrir exactamente 1 carrera.',
      });
    }
    if (data.tipo === 'troncoComun' && (!Array.isArray(data.carreraIds) || data.carreraIds.length < 1)) {
      return Promise.reject({
        code: 'CLASIF_TRONCO_INVALID',
        message: 'Un tronco común debe cubrir al menos 1 carrera.',
      });
    }
    if (this.testMode) {
      const out = _upsertById(DEMO_CLASIFICACIONES, data, () => 'clasif_' + Date.now());
      return Promise.resolve({ ...out });
    }
    if (this.prodMode) {
      const id = data.id ?? _db().collection('clasificaciones').doc().id;
      const payload = { ...data, id };
      return _db().collection('clasificaciones').doc(String(id)).set(payload, { merge: true })
        .then(() => payload);
    }
  },
  // Guardia de integridad (regla 7 del spec 4.D): no permitir borrar una
  // clasificación con materias referenciándola. En prod la guardia es
  // eventualmente consistente — lee el snapshot hidratado de DEMO_MATERIAS.
  /**
   * @interaction delete-clasificacion
   * @scope data-service-admin-crud
   *
   * Given el admin confirmó eliminar una clasificación.
   * When invoca `DataService.deleteClasificacion(id)`.
   * Then valida guard de integridad (regla 7 del spec 4.D):
     filtra `DEMO_MATERIAS` por `clasificacionId === id`. Si hay
     refs → `Promise.reject({code:'CLASIF_IN_USE', refs:[matIds],
     message:'No se puede eliminar: N materia(s)...'})`. Sin refs:
     `_removeById` / `delete()`.
   * Edge:
   *   - mismo patrón que `deleteCarrera` (guard eventually consistent
     en prod, mitigación post-Supabase con FK real).
   *   - el caller `.catch` y muestra el mensaje del reject.
   *   - idempotente sin refs.
   */
  deleteClasificacion(id) {
    const refs = DEMO_MATERIAS.filter(m => String(m.clasificacionId) === String(id));
    if (refs.length > 0) {
      return Promise.reject({
        code: 'CLASIF_IN_USE',
        refs: refs.map(m => m.id),
        message: `No se puede eliminar: ${refs.length} materia(s) usan esta clasificación`,
      });
    }
    if (this.testMode) {
      _removeById(DEMO_CLASIFICACIONES, id);
      return Promise.resolve();
    }
    if (this.prodMode) {
      return _db().collection('clasificaciones').doc(String(id)).delete();
    }
  },
  // Materia incluye horario[] embebido — los slots de horarios admin se
  // persisten reescribiendo el array completo dentro de la materia, no via
  // método propio. Coherente con el modelo documental de Firestore.
  //
  // Validación 4.D (regla 3): el resultado mergeado debe tener
  // `clasificacionId`. Se valida sobre el resultado (no sobre `data`) para
  // que los partial-saves del estilo `{id, estado}` no rompan — el merge
  // preserva la clasificacionId previa.
  /**
   * @interaction save-materia
   * @scope data-service-admin-crud
   *
   * Given el admin crea/edita una materia o un módulo legacy hace
     partial-save (e.g. `{id, estado: 'archivada'}`).
   * When invoca `DataService.saveMateria(data)`.
   * Then dual-validación de `clasificacionId` (regla 3 del spec 4.D):
   *   - **Pre-flight**: si es create (no existe en DEMO_MATERIAS) Y
     `data.clasificacionId` no viene → `reject({code:'MATERIA_SIN_CLASIFICACION'})`
     SIN tocar el array.
   *   - **Post-flight**: tras upsert, si el resultado mergeado quedó
     sin clasificacionId (caso raro, defensa en profundidad) →
     `reject` con el mismo code.
   *   - Pasa ambas → upsert (`_upsertById` con genId `mat_${ts}`).
   *   Prod: `set(payload, {merge: true})`.
   * Edge:
   *   - partial-save de estado (`{id, estado}`) sobre materia existente
     funciona: el merge preserva `clasificacionId` previa.
   *   - `horario[]` embebido se persiste reescribiendo el array completo
     dentro de la materia (no hay endpoint propio). Coherente con
     modelo documental Firestore.
   *   - prod deuda: batched write para sync con grupos. Pendiente
     post-Supabase con FK.
   */
  saveMateria(data) {
    if (this.testMode) {
      // Pre-flight: si es create (id no existe en DEMO_MATERIAS) y data no
      // trae clasificacionId, rechazar sin tocar el array.
      const exists = data.id != null && DEMO_MATERIAS.some(m => String(m.id) === String(data.id));
      if (!exists && data.clasificacionId == null) {
        return Promise.reject({
          code: 'MATERIA_SIN_CLASIFICACION',
          message: 'Una materia debe tener clasificación asignada.',
        });
      }
      const out = _upsertById(DEMO_MATERIAS, data, () => 'mat_' + Date.now());
      if (out.clasificacionId == null) {
        // Post-flight: si el resultado mergeado quedó sin clasificacionId,
        // revertir conceptualmente (raro, defensa en profundidad).
        return Promise.reject({
          code: 'MATERIA_SIN_CLASIFICACION',
          message: 'Una materia debe tener clasificación asignada.',
        });
      }
      return Promise.resolve({ ...out });
    }
    if (this.prodMode) {
      const id = data.id || _db().collection('materias').doc().id;
      const payload = { ...data, id };
      return _db().collection('materias').doc(String(id)).set(payload, { merge: true })
        .then(() => payload);
    }
  },
  /**
   * @interaction delete-materia
   * @scope data-service-admin-crud
   *
   * Given el admin confirmó borrar una materia.
   * When invoca `DataService.deleteMateria(id)`.
   * Then `_removeById` (demo) o `delete()` (prod).
   * Edge:
   *   - sin guard de integridad referencial implementado (a
     diferencia de `deleteCarrera` y `deleteClasificacion`). Si
     hay tareas, recursos, escalas, grupos referenciando la
     materia, quedan colgando.
   *   - **Deuda admin pre-Supabase**: agregar guard que valida
     `DEMO_TAREAS`/`DEMO_RECURSOS`/`DEMO_ESCALAS`/`DEMO_GRUPOS`
     (vía `grupos.materiasIds[]`). Bloqueante 4 del slice admin
     tiene un track propio.
   *   - idempotente.
   */
  deleteMateria(id) {
    if (this.testMode) {
      _removeById(DEMO_MATERIAS, id);
      return Promise.resolve();
    }
    if (this.prodMode) {
      return _db().collection('materias').doc(String(id)).delete();
    }
  },

  // ── Tiempo real ──────────────────────────────────────────
  // demo: invoca callback una sola vez y devuelve un unsubscribe vacío
  // prod: usa onSnapshot y devuelve la función unsubscribe real
  /**
   * @interaction on-leaderboard
   * @scope data-service-realtime
   *
   * Given un consumer necesita reaccionar a cambios del leaderboard
     (dashboard ranking, competencias en vivo).
   * When invoca `DataService.onLeaderboard(scope, callback)`.
   * Then:
   *   - demo → llama `callback` UNA SOLA VEZ con `getLeaderboard(scope)`
     resuelto, devuelve `unsubscribe = () => {}`. NO reactivo.
   *   - prod → suscribe `onSnapshot` a la query (grupos o estudiantes
     por scope), llama `callback` en cada cambio Firestore. Retorna
     el `unsubscribe` real de Firestore.
   * Edge:
   *   - **Contrato dual divergente**: demo y prod tienen MISMA shape
     de retorno (function unsubscribe) pero MUY distinta semántica
     (1-shot vs reactivo). Consumers no deben asumir reactivo en
     demo — sus tests fallarán al migrar a prod si no consideran
     que las actualizaciones llegan después.
   *   - Llamar `unsubscribe()` en demo es no-op; en prod cancela
     el listener (importante para no leak en componentes que se
     destruyen).
   *   - límite 50 en prod (matches `getLeaderboard`).
   */
  onLeaderboard(scope, callback) {
    if (this.testMode) { this.getLeaderboard(scope).then(callback); return () => {}; }
    if (this.prodMode) {
      const q = scope === 'grupo'
        ? _db().collection('grupos').orderBy('puntos', 'desc').limit(50)
        : _db().collection('usuarios').where('tipo', '==', 'estudiante').orderBy('puntos', 'desc').limit(50);
      return q.onSnapshot(snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    }
  },
  /**
   * @interaction on-mensajes
   * @scope data-service-realtime
   *
   * Given un consumer abre el chat de una sala y necesita
     actualizaciones en vivo (feature chat post-Supabase).
   * When invoca `DataService.onMensajes(salaId, callback)`.
   * Then:
   *   - demo → llama callback UNA VEZ con `DEMO_MENSAJES[salaId]`,
     devuelve unsubscribe no-op.
   *   - prod → `onSnapshot` sobre `mensajes/{salaId}/items`
     orderBy(timestamp asc).limit(200). Callback en cada cambio.
   * Edge:
   *   - mismo contrato dual divergente que `onLeaderboard`.
   *   - feature chat sigue siendo deuda post-Supabase — el endpoint
     existe pero UI activa no.
   */
  onMensajes(salaId, callback) {
    if (this.testMode) { callback([...(DEMO_MENSAJES[salaId] || [])]); return () => {}; }
    if (this.prodMode) {
      return _db().collection('mensajes').doc(salaId).collection('items')
        .orderBy('timestamp', 'asc').limit(200)
        .onSnapshot(snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    }
  },
  /**
   * @interaction on-notificaciones
   * @scope data-service-realtime
   *
   * Given el panel de notificaciones abierto o el badge necesita
     reaccionar a nuevas notifs (feature realtime post-Supabase).
   * When invoca `DataService.onNotificaciones(uid, callback)`.
   * Then:
   *   - demo → callback UNA VEZ con `DEMO_NOTIFICACIONES[uid || APP.user?.id || 'est1']`,
     unsubscribe no-op.
   *   - prod → `onSnapshot` sobre `usuarios/{uid}/notificaciones`
     orderBy(timestamp desc).limit(50).
   * Edge:
   *   - uid no provisto + sin sesión → fallback `'est1'` (demo);
     en prod sin uid retorna `[]` callback inmediato + unsubscribe
     no-op.
   *   - **NO se usa actualmente**: hoy el panel notifs lee localStorage
     (`notificaciones.js`). Este endpoint es para migración futura
     post-Supabase cuando el panel pase a server-side.
   */
  onNotificaciones(uid, callback) {
    if (this.testMode) {
      const key = uid || APP.user?.id || 'est1';
      callback([...(DEMO_NOTIFICACIONES[key] || [])]);
      return () => {};
    }
    if (this.prodMode) {
      const key = uid || APP.user?.id;
      if (!key) { callback([]); return () => {}; }
      return _db().collection('usuarios').doc(key).collection('notificaciones')
        .orderBy('timestamp', 'desc').limit(50)
        .onSnapshot(snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    }
  },
   /**
   * @interaction on-competencia
   * @scope data-service-realtime
   *
   * Given un consumer entra al detalle de una competencia activa
     y necesita reaccionar a cambios (otros participantes
     completando, profesor cerrando, etc.).
   * When invoca `DataService.onCompetencia(id, callback)`.
   * Then:
   *   - demo → si la competencia existe llama callback UNA VEZ
     con shallow copy `{...c}`, unsubscribe no-op.
   *   - prod → `onSnapshot` sobre `competencias/{id}`. Callback
     en cada cambio del doc.
   * Edge:
   *   - competencia inexistente en demo → callback NO se llama
     y unsubscribe no-op. Consumer debe manejar el caso "comp no
     existe" antes de suscribirse.
   *   - prod: si el doc se borra el callback recibe `s.exists === false`
     pero el código actual NO maneja ese caso (solo llama si exists).
     Deuda menor.
   */
  onCompetencia(id, callback) {
    if (this.testMode) {
      const c = DEMO_COMPETENCIAS.find(x => x.id === id);
      if (c) callback({ ...c });
      return () => {};
    }
    if (this.prodMode) {
      return _db().collection('competencias').doc(id).onSnapshot(s => {
        if (s.exists) callback({ id: s.id, ...s.data() });
      });
    }
  },
  /**
   * @interaction on-progreso-escala
   * @scope data-service-realtime
   *
   * Given el alumno tiene abierta la vista de calificaciones de
     una escala y el profesor podría sobrescribir un criterio en
     vivo (slice escala-rubros).
   * When invoca `DataService.onProgresoEscala(uid, escalaId, callback)`.
   * Then:
   *   - demo → si el progreso existe llama callback UNA VEZ con
     deep copy criterios, unsubscribe no-op.
   *   - prod → `onSnapshot` sobre `progreso_escala/{uid_escalaId}`.
   * Edge:
   *   - progreso inexistente en demo → callback NO se llama.
   *   - mismo patrón "deep copy criterios" que `getProgresoEscala`
     (protege contra mutación accidental por el consumer).
   *   - importante para UX en producción: cuando el profe sobrescribe
     vía `updateOverrideCriterio`, el alumno ve el cambio sin refresh.
   *   - feature realtime activa solo en prod — demo es snapshot.
   */
  onProgresoEscala(uid, escalaId, callback) {
    if (this.testMode) {
      const p = DEMO_PROGRESO_ESCALA[`${uid}_${escalaId}`];
      if (p) callback({ ...p, criterios: p.criterios.map(c => ({ ...c })) });
      return () => {};
    }
    if (this.prodMode) {
      return _db().collection('progreso_escala').doc(`${uid}_${escalaId}`).onSnapshot(s => {
        if (s.exists) callback({ id: s.id, ...s.data() });
      });
    }
  },

  // Escribe un mensaje en una sala (uso futuro en chat). Existe una versión
  // demo simple; en prod escribe a la subcolección items.
  /**
   * @interaction save-mensaje
   * @scope data-service-escritura
   *
   * Given el usuario activo escribe en el input del chat de una sala
     (feature chat post-Supabase).
   * When invoca `DataService.saveMensaje(salaId, texto)`.
   * Then:
   *   - demo → lazy-init `DEMO_MENSAJES[salaId]`, push con
     `{id: 'm' + Date.now(), autorId: APP.user?.id || 'est1', texto,
     timestamp: now()}`. Retorna el mensaje creado.
   *   - prod → `mensajes/{salaId}/items.add({autorId, texto, timestamp})`
     con `autorId` derivado de `APP.user?.id || firebase.auth().currentUser?.uid`.
     Retorna `{id, ...mensaje}`.
   * Edge:
   *   - sin sesión activa en demo → autor `'est1'` fallback (defensa).
   *   - sin sesión en prod sin firebase.auth currentUser → `autorId`
     undefined; el mensaje persistirá con campo faltante. UI debe
     validar sesión antes de invocar.
   *   - **Pertenece a sección Escritura** (no Tiempo real) aunque
     vive cerca de `on*` en el archivo. Su scope refleja la
     naturaleza (escritura, no suscripción).
   *   - feature chat es deuda post-Supabase — el endpoint existe
     pero UI activa no.
   */
  saveMensaje(salaId, texto) {
    if (this.testMode) {
      if (!DEMO_MENSAJES[salaId]) DEMO_MENSAJES[salaId] = [];
      const m = {
        id: 'm' + Date.now(),
        autorId: APP.user?.id || 'est1',
        texto,
        timestamp: new Date().toISOString(),
      };
      DEMO_MENSAJES[salaId].push(m);
      return Promise.resolve(m);
    }
    if (this.prodMode) {
      const m = {
        autorId: APP.user?.id || firebase.auth().currentUser?.uid,
        texto,
        timestamp: new Date().toISOString(),
      };
      return _db().collection('mensajes').doc(salaId).collection('items').add(m)
        .then(ref => ({ id: ref.id, ...m }));
    }
  },
};

// ════════════════════════════════════════════════════════════════
// Helpers internos
// ════════════════════════════════════════════════════════════════

/**
 * @interaction _db
 * @scope data-service-helper-firebase
 *
 * Given modo prod activo y un método del DataService necesita
 *   acceso al cliente Firestore.
 * When cualquier rama `if (this.prodMode)` invoca `_db()`.
 * Then valida que `firebase` global esté definido (el SDK debe
 *   cargarse antes via `<script src="...firebase-app.js">` y
 *   `firebase-firestore.js` en `index.html`). Retorna
 *   `firebase.firestore()`.
 * Edge:
 *   - SDK no cargado → lanza `Error('[data-service] Firebase SDK no cargado.')`.
 *     El caller (todos los métodos prod) propaga el throw.
 *   - prefijo `[data-service]` consistente con otros logs del módulo.
 *   - en demo NUNCA se invoca (las ramas `this.testMode` returnan antes).
 */
function _db() {
  if (typeof firebase === 'undefined') {
    throw new Error('[data-service] Firebase SDK no cargado.');
  }
  return firebase.firestore();
}

// Lee una colección entera y la devuelve como array con el id incluido.
/**
 * @interaction _coll
 * @scope data-service-helper-firebase
 *
 * Given modo prod y un getter del DataService que lee colección
 *   entera (`getMaterias`, `getGrupos`, `getUsuarios`, etc.).
 * When invoca `_coll('nombre-coleccion')`.
 * Then ejecuta `_db().collection(name).get()` y mapea cada doc a
 *   `{id: d.id, ...d.data()}` — patrón canónico para inyectar el
 *   id del doc dentro del payload.
 * Edge:
 *   - colección vacía → retorna `[]`.
 *   - permisos denegados → reject propagado (caller debe `.catch`).
 *   - colecciones grandes (>1000 docs) → costoso en RU y latency.
 *     Pagination pendiente post-Supabase.
 *   - helper interno: NO exportado, solo usado dentro del DataService.
 */
function _coll(name) {
  return _db().collection(name).get()
    .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));
}

// Upsert por id sobre un array demo, preservando la identidad referencial
// del objeto existente (Object.assign en lugar de reemplazo). Si el data
// entrante no trae id o el id no existe en el array, inserta con id sintético
// generado por `genId()`. Devuelve la entidad final (la referencia del array).
/**
 * @interaction _upsert-by-id
 * @scope data-service-helper-internal
 *
 * Given un array demo (DEMO_USUARIOS, DEMO_GRUPOS, ...) y un
 *   payload con o sin id.
 * When un método admin CRUD (saveUsuario, saveGrupo, ...) invoca
 *   `_upsertById(arr, data, genId)`.
 * Then:
 *   - Si `data.id` existe y matchea uno del array (compare via
 *     `String(x.id) === String(idIn)`, defensa contra mixed
 *     string/number ids): `Object.assign(arr[idx], data)` mutación
 *     IN-PLACE. La identidad referencial del objeto se PRESERVA
 *     (módulos legacy con handles directos al objeto siguen viendo
 *     el update).
 *   - Si no matchea o `data.id` undefined: push nuevo objeto con
 *     `id: data.id || genId()`.
 *   Retorna la entidad final (referencia del array, no copia).
 * Edge:
 *   - `genId` se invoca SOLO si `data.id == null` (insert nuevo).
 *     Cada entidad tiene su propio formato (`u_...`, `grp_...`,
 *     `mat_...`, etc.).
 *   - lookup String-safe: maneja ids numéricos (instituciones legacy)
 *     y strings semánticos (`ISC-3A`, `isc`) sin coerción explícita.
 *   - el caller hace `{...out}` shallow copy antes de exponer el
 *     retorno al UI (convención para evitar mutación accidental).
 *   - mutación in-place es **decisión consciente** vs reemplazo —
 *     justificada por consumers que cachean handles (memoria
 *     `feedback_consolidate_over_patch`).
 */
function _upsertById(arr, data, genId) {
  const idIn = data.id;
  const idx  = idIn != null ? arr.findIndex(x => String(x.id) === String(idIn)) : -1;
  if (idx >= 0) {
    Object.assign(arr[idx], data);
    return arr[idx];
  }
  const nuevo = { ...data, id: idIn != null ? idIn : genId() };
  arr.push(nuevo);
  return nuevo;
}

// Splice por id (string-safe). Idempotente: si no encuentra, no-op.
/**
 * @interaction _remove-by-id
 * @scope data-service-helper-internal
 *
 * Given un array demo y un id a eliminar.
 * When un método admin delete (deleteUsuario, deleteGrupo, ...)
 *   invoca `_removeById(arr, id)`.
 * Then `findIndex` con compare String-safe (`String(x.id) === String(id)`),
 *   y si encuentra `splice(idx, 1)` mutando in-place.
 * Edge:
 *   - id inexistente → idx === -1 → no-op (idempotente, no crashea).
 *   - mismo lookup String-safe que `_upsertById` (maneja
 *     ids mixtos number/string).
 *   - NO valida integridad referencial — eso lo hace el caller
 *     antes de invocar (ver `deleteCarrera`, `deleteClasificacion`).
 */
function _removeById(arr, id) {
  const idx = arr.findIndex(x => String(x.id) === String(id));
  if (idx >= 0) arr.splice(idx, 1);
}

/**
 * @interaction _upload-file
 * @scope data-service-helper-firebase
 *
 * Given modo prod y un método de Escritura recibe un `File` que
 *   debe subir a Storage (saveRecurso con archivo, saveEntrega con
 *   archivos de entrega).
 * When invoca `_uploadFile(path, file)`.
 * Then sube el archivo a `firebase.storage().ref().child(path)`,
 *   espera al complete y retorna `Promise<downloadURL>` (string URL
 *   pública con token de acceso).
 * Edge:
 *   - permisos Storage denegados → reject del put.
 *   - archivo grande → progreso NO se reporta (signature simple).
 *     Deuda: si UX requiere progress bar, refactor a callback
 *     `onProgress`. Por ahora UI muestra spinner indeterminado.
 *   - cuota Storage llena → reject.
 *   - en demo NUNCA se invoca (los métodos prod-only lo usan).
 */
function _uploadFile(path, file) {
  const ref = firebase.storage().ref().child(path);
  return ref.put(file).then(() => ref.getDownloadURL());
}

// Filtra un array de tareas por estado (lógica idéntica a la versión demo).
/**
 * @interaction _filtrar-tareas
 * @scope data-service-helper-internal
 *
 * Given un array de tareas (post-fetch en prod o copy en demo)
 *   y los filtros del caller.
 * When `getTareas(filtros)` lo invoca para aplicar filter en
 *   memoria — necesario porque el filtro `estado` no se mapea
 *   a query Firestore (lógica derivada).
 * Then aplica en orden: `materiaId`, `grupoId`, y luego el filter
 *   semántico de `estado`:
 *   - **pendiente**: NO entregado + `effectiveDueDate >= now`.
 *   - **entregada**: tiene entrega del uid actual.
 *   - **tardia**: entregada + alguna entrega después del `effectiveDueDate`.
 *   - **vencida**: NO entregado + `effectiveDueDate < now`.
 *   - default → todas.
 *   `effectiveDueDate(t, uid)` (slice prórrogas-polish) respeta
 *   prórroga aprobada del uid actual; fallback a `t.fechaEntrega`
 *   si helper no cargado.
 * Edge:
 *   - sin filtros → retorna `arr` sin tocar.
 *   - `APP.user.id` undefined (sesión expirada) → `uid` undefined
 *     y los filtros entregadas/tardias devuelven false. Defensa.
 *   - tarea sin `entregas` (recién creada) → `(t.entregas || [])`
 *     defensa null.
 *   - estado desconocido → cae al default `return true` (no filtra).
 *   - el `vence` se calcula POR-tarea (puede diferir por uid debido
 *     a prórrogas). En prod query Firestore solo filtra materia/grupo;
 *     estado se filtra client-side igual.
 */
function _filtrarTareas(arr, filtros) {
  let r = arr;
  if (filtros.materiaId) r = r.filter(t => t.materiaId === filtros.materiaId);
  if (filtros.grupoId)   r = r.filter(t => t.grupoId   === filtros.grupoId);
  if (filtros.estado) {
    const now = new Date();
    const uid = APP.user?.id;
    r = r.filter(t => {
      // Slice prórrogas-polish (pre-c10 #4): "vence" respeta prórroga
      // aprobada del uid actual via effectiveDueDate. Si no hay prórroga
      // o el helper no está cargado, fallback a t.fechaEntrega original.
      const fechaEfect = (typeof effectiveDueDate === "function")
          ? effectiveDueDate(t, uid)
          : t.fechaEntrega;
      const vence     = new Date(fechaEfect);
      const entregado = (t.entregas || []).some(e => e.uid === uid);
      switch (filtros.estado) {
        case 'pendiente': return !entregado && vence >= now;
        case 'entregada': return entregado;
        case 'tardia':    return entregado && (t.entregas || []).some(e => new Date(e.fecha) > vence);
        case 'vencida':   return !entregado && vence < now;
        default:          return true;
      }
    });
  }
  return r;
}

// Calcula calFinal ponderado (sin criterios extra, valores en escala 0-1, resultado en 0-10)
/**
 * @interaction _calc-cal-final
 * @scope data-service-helper-internal
 *
 * Given un progreso de escala (`DEMO_PROGRESO_ESCALA[uid_escalaId]`)
 *   y la escala correspondiente (`DEMO_ESCALAS.find(e.id === escalaId)`).
 * When `updateOverrideCriterio` muta un override y necesita
 *   recalcular el `calFinal` agregado.
 * Then itera los criterios NO-extra de la escala. Por cada uno
 *   resuelve el valor del progreso: prioriza `overrideProf` (manual
 *   del profe) sobre `valorAuto` (motor); si ninguno, 0. Multiplica
 *   por `c.pct` (peso del criterio en %), suma todo, divide entre 10
 *   para obtener escala 0-10.
 *   Fórmula: `Σ (valor × pct) / 10`.
 * Edge:
 *   - criterios `extra: true` (bonus) NO entran al cálculo agregado.
 *     Se muestran aparte en el UI como "puntos extra".
 *   - criterio en escala sin match en progreso → val = 0 (alumno
 *     no ha hecho ese rubro aún).
 *   - escala sin criterios → divide 0 / 10 = 0.
 *   - pct sumando >100 (slice escala-rubros permite 100-120%) → el
 *     resultado puede superar 10. El UI debe capar visualmente a 10.
 *   - NO toca `calFinalOverride` (es el override total del profe);
 *     ese valor sobreescribe el calFinal calculado al MOMENTO DE LA
 *     LECTURA, no aquí.
 */
function _calcCalFinal(progreso, escala) {
  return escala.criterios
    .filter(c => !c.extra)
    .reduce((sum, c) => {
      const pc  = progreso.criterios.find(x => x.criterioId === c.id);
      const val = pc ? (pc.overrideProf ?? pc.valorAuto ?? 0) : 0;
      return sum + val * c.pct;
    }, 0) / 10;
}

// ── Demo init: lee data/demo/*.json y populano los globals ──────
/**
 * @interaction _load-demo-data
 * @scope data-service-helper-internal
 *
 * Given modo demo (`APP_CONFIG.mode === 'demo'`) y `DataService.init()`
 *   acaba de invocar.
 * When `init()` lo `await`s.
 * Then hace **18 fetch en paralelo** a `data/demo/*.json` (usuarios,
 *   grupos, materias, tareas, recursos, juegos, competencias, escalas,
 *   progreso_escala, progreso, logros, instituciones, carreras,
 *   clasificaciones, slots-catalog, asistencias, maestria, top3-maestria)
 *   con `Promise.all`. Después asigna cada respuesta a su global
 *   correspondiente (DEMO_USUARIOS, DEMO_GRUPOS, ...). Para maestria
 *   y top3-maestria también espeja a `window.*` (necesario para
 *   helpers cross-vista que leen via `window.DEMO_MAESTRIA`).
 * Edge:
 *   - cualquier fetch falla (404, parse error) → la promesa
 *     rechaza, propagado al caller. **El boot bloquea** (regresión
 *     a pantalla blanca). Mitigación menor: `asistencias.json` y
 *     `maestria.json` y `top3-maestria.json` tienen `.catch(() => fallback)`
 *     porque fueron añadidos en slices posteriores y pueden faltar
 *     en seeds viejos.
 *   - `maestria.json` wrap `j.data || {}` porque el JSON tiene shape
 *     `{data: {uid_mat: {...}}}` (no es array plano como el resto).
 *   - **REQUIERE servidor HTTP local** (no funciona con `file://`).
 *     Memoria: `python -m http.server 8000` desde la raíz.
 *   - el orden de asignación tras Promise.all es estable — no hay
 *     races porque todas las respuestas ya llegaron.
 */
async function _loadDemoData() {
  const base = 'data/demo/';
  const [usuarios, grupos, materias, tareas, recursos, juegos,
         competencias, escalas, progresoEscala, progreso, logros,
         instituciones, carreras, clasificaciones, slotsCatalog, asistencias,
         maestria, top3Maestria, notifSeed, calendarioEventos, examenes,
         temarioSeed, torneosSeed] =
    await Promise.all([
      fetch(base + 'usuarios.json').then(r => r.json()),
      fetch(base + 'grupos.json').then(r => r.json()),
      fetch(base + 'materias.json').then(r => r.json()),
      fetch(base + 'tareas.json').then(r => r.json()),
      fetch(base + 'recursos.json').then(r => r.json()),
      fetch(base + 'juegos.json').then(r => r.json()),
      fetch(base + 'competencias.json').then(r => r.json()),
      fetch(base + 'escalas.json').then(r => r.json()),
      fetch(base + 'progreso_escala.json').then(r => r.json()),
      fetch(base + 'progreso.json').then(r => r.json()),
      fetch(base + 'logros.json').then(r => r.json()),
      fetch(base + 'instituciones.json').then(r => r.json()),
      fetch(base + 'carreras.json').then(r => r.json()),
      fetch(base + 'clasificaciones.json').then(r => r.json()),
      fetch(base + 'slots-catalog.json').then(r => r.json()),
      fetch(base + 'asistencias.json').then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(base + 'maestria.json').then(r => r.json()).then(j => j.data || {}).catch(() => ({})),
      fetch(base + 'top3-maestria.json').then(r => r.json()).then(j => j.data || {}).catch(() => ({})),
      fetch(base + 'notificaciones-seed.json').then(r => r.json()).then(j => j.data || {}).catch(() => ({})),
      fetch(base + 'calendario-eventos.json').then(r => r.json()).then(j => j.data || {}).catch(() => ({})),
      fetch(base + 'examenes.json').then(r => r.ok ? r.json() : []).catch(() => []),
      // Sweep 2026-06-09 (Temario+IA): seed temario por-materia (opcional)
      fetch(base + 'temario.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
      // slice torneos intragrupales 2026-06-09
      fetch(base + 'torneos-intra.json').then(r => r.ok ? r.json() : []).catch(() => []),
    ]);

  DEMO_USERS                = usuarios;
  DEMO_GRUPOS               = grupos;
  DEMO_MATERIAS             = materias;
  // Sweep 2026-06-09 (Temario+IA): merge seed temario por-materia
  if (temarioSeed && typeof temarioSeed === "object") {
    Object.keys(temarioSeed).forEach(matId => {
      const m = DEMO_MATERIAS.find(x => x.id === matId);
      if (m) m.temario = temarioSeed[matId];
    });
  }
  DEMO_TAREAS               = tareas;
  DEMO_RECURSOS             = recursos;
  DEMO_JUEGOS               = juegos;
  DEMO_EXAMENES             = examenes;  // slice examenes beta 2026-06-06
  DEMO_COMPETENCIAS         = competencias;
  DEMO_ESCALAS              = escalas;
  DEMO_PROGRESO_ESCALA      = progresoEscala;
  DEMO_PROGRESO_ESTUDIANTES = progreso;
  DEMO_LOGROS               = logros;
  DEMO_INSTITUCIONES        = instituciones;
  DEMO_CARRERAS             = carreras;
  DEMO_CLASIFICACIONES      = clasificaciones;
  DEMO_SLOTS_CATALOG        = slotsCatalog;
  DEMO_ASISTENCIAS          = asistencias;
  DEMO_MAESTRIA             = maestria;
  window.DEMO_MAESTRIA      = maestria;
  DEMO_TOP3_MAESTRIA        = top3Maestria;
  window.DEMO_TOP3_MAESTRIA = top3Maestria;
  DEMO_NOTIFICACIONES_SEED        = notifSeed;
  window.DEMO_NOTIFICACIONES_SEED = notifSeed;
  DEMO_CALENDARIO_EVENTOS         = calendarioEventos;
  window.DEMO_CALENDARIO_EVENTOS  = calendarioEventos;
  DEMO_TORNEOS_INTRA              = torneosSeed;
}

// ── Prod init: snapshot inicial de Firestore que populano DEMO_* ──
// Muchos módulos legacy (gestion.js, mismaterias.js, perfil.js…) leen los
// globals DEMO_* directo. Para no refactorizar todo, en prod hacemos una
// sola lectura inicial y rellenamos esos globals — equivalente al fetch
// demo, pero desde Firestore. A partir de ahí, las nuevas vistas que pasen
// por DataService.get* tendrán datos frescos.
/**
 * @interaction _hydrate-globals-from-firestore
 * @scope data-service-helper-firebase
 *
 * Given modo prod y `init()` ya invocó `initFirebase()`.
 * When `init()` lo `await`s.
 * Then en paralelo lee 12 colecciones (usuarios, grupos, materias,
 *   tareas, recursos, juegos, competencias, escalas, logros,
 *   instituciones, carreras, clasificaciones) y mapea cada doc con
 *   `{id: d.id, ...d.data()}`. Para `progreso_escala` y
 *   `progreso_estudiantes` (que son dicts por id compuesto) usa
 *   `Object.fromEntries(pesc.map(d => [d.id, d]))` para mantener
 *   la estructura de dict en memoria. Asigna a los globals
 *   DEMO_USUARIOS, ..., DEMO_PROGRESO_ESCALA, DEMO_PROGRESO_ESTUDIANTES.
 * Edge:
 *   - **Es lectura ONE-SHOT al boot**, no reactiva. Los módulos
 *     legacy que leen DEMO_* directo NO ven cambios posteriores
 *     hasta refresh o re-hidratación manual.
 *   - mitigación: nuevas vistas usan `DataService.get*` / `on*`
 *     que sí van fresh contra Firestore.
 *   - falla de red en alguna colección → reject propagado al
 *     caller, el boot bloquea (mismo riesgo que `_loadDemoData`).
 *   - NO incluye slots-catalog, asistencias, maestria, top3-maestria
 *     (son colecciones nuevas, deuda menor: agregar al snapshot prod
 *     o crear con seed inicial post-Supabase).
 */
async function _hydrateGlobalsFromFirestore() {
  const db = firebase.firestore();
  const snap = name => db.collection(name).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() })));

  const [usuarios, grupos, materias, tareas, recursos, juegos,
         competencias, escalas, logros, instituciones, carreras, clasificaciones] = await Promise.all([
    snap('usuarios'), snap('grupos'), snap('materias'), snap('tareas'),
    snap('recursos'), snap('juegos'), snap('competencias'), snap('escalas'),
    snap('logros'), snap('instituciones'), snap('carreras'), snap('clasificaciones'),
  ]);

  // progreso_escala y progreso_estudiantes son dicts por id compuesto
  const [pesc, pest] = await Promise.all([
    snap('progreso_escala'),
    snap('progreso_estudiantes'),
  ]);
  const progresoEscalaDict = Object.fromEntries(pesc.map(d => [d.id, d]));
  const progresoEstDict    = Object.fromEntries(pest.map(d => [d.id, d]));

  DEMO_USERS                = usuarios;
  DEMO_GRUPOS               = grupos;
  DEMO_MATERIAS             = materias;
  DEMO_TAREAS               = tareas;
  DEMO_RECURSOS             = recursos;
  DEMO_JUEGOS               = juegos;
  DEMO_COMPETENCIAS         = competencias;
  DEMO_ESCALAS              = escalas;
  DEMO_LOGROS               = logros;
  DEMO_INSTITUCIONES        = instituciones;
  DEMO_CARRERAS             = carreras;
  DEMO_CLASIFICACIONES      = clasificaciones;
  DEMO_PROGRESO_ESCALA      = progresoEscalaDict;
  DEMO_PROGRESO_ESTUDIANTES = progresoEstDict;
}

// onAuthStateChanged: si Firebase persiste la sesión, rehidrata APP.user
// directo desde usuarios/{uid} sin pasar por el formulario de login.
/**
 * @interaction _watch-auth-state
 * @scope data-service-helper-firebase
 *
 * Given modo prod, `initFirebase` y `_hydrateGlobalsFromFirestore`
 *   ya completaron.
 * When `init()` lo invoca al final.
 * Then suscribe `firebase.auth().onAuthStateChanged`. Cuando cambia
 *   el estado:
 *   - Si `user` falsy (logout o sesión expirada) → no-op (espera a
 *     que handleLogin o el ciclo natural decida).
 *   - Si `APP.user.id === user.uid` → no-op (ya hidratado por
 *     `handleLogin`, no re-cargar redundantemente).
 *   - Si Firebase persiste sesión de un refresh anterior → lee
 *     `usuarios/{uid}` y setea `APP.user`. Si `loadDashboard` está
 *     cargado, entra al dashboard saltándose el form.
 * Edge:
 *   - doc usuarios no existe (race entre signup y creación de perfil)
 *     → no actualiza APP.user, no entra al dashboard. UI queda en
 *     auth screen como si fuera login fresh.
 *   - error de red al leer perfil → log a console + no-update.
 *   - **NO se ejecuta en demo** — `_tryRestoreSession` en `auth.js`
 *     es el equivalente.
 *   - el listener vive **todo el ciclo de vida de la app**; no hay
 *     unsubscribe (intencional).
 */
function _watchAuthState() {
  let _hydrated = false;
  firebase.auth().onAuthStateChanged(async user => {
    if (!user) {
      // Sesión terminada (logout) → reset hydration flag para próximo login
      _hydrated = false;
      return;
    }

    // Hidratar globals UNA VEZ por sesión auth
    if (!_hydrated) {
      try {
        await _hydrateGlobalsFromFirestore();
        _hydrated = true;
      } catch (err) {
        console.error('[data-service] Error hidratando globals post-auth:', err);
        // No abortar: handleLogin puede continuar con DEMO_* arrays vacíos
        // y los handlers prodMode leen Firestore directo según necesidad.
      }
    }

    // Sweep 2026-06-08: hidratar SIEMPRE las colecciones separadas
    // (kudos, userPrefs, replays, notaRubro, entregas, historialExtra,
    // recursosVistos) cuando hay user. Antes del sweep esto vivía
    // dentro del bloque "rehidratar APP.user" que solo corría cuando
    // APP.user.id != user.uid; con eso, los refreshes con sesión persistida
    // saltaban la hidratación de los nuevos paths. La llamada es idempotente
    // (write-back a localStorage) — safe disparar también cuando APP.user
    // ya estaba hidratado por handleLogin.
    if (typeof firestoreHydrateOnLogin === 'function') {
      firestoreHydrateOnLogin(user.uid).catch(() => {});
    }

    if (APP.user && APP.user.id === user.uid) return; // ya hidratado por handleLogin
    try {
      const snap = await firebase.firestore().collection('usuarios').doc(user.uid).get();
      if (snap.exists) {
        APP.user = { id: snap.id, ...snap.data() };
        if (typeof loadDashboard === 'function') loadDashboard();
      }
    } catch (err) {
      console.error('[data-service] Error rehidratando sesión:', err);
    }
  });
}
