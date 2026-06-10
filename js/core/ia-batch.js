// js/core/ia-batch.js
// Sweep 2026-06-09 (Temario+IA): generic batch lifecycle wrapper alrededor
// del SDK Google AI (@google/generative-ai). Reusable para futuras
// features IA (juegos por-tema, generar competencia, etc.).
//
// API:
//   IaBatch.generate({path, prompt, responseSchema, estilo, cap, extraFields})
//     → llama Gemini, valida shape, persiste a Firestore en path con
//       ideas[] + indiceActual=0 + lotesGeneradosCount=prev+1.
//     → throw "cap-reached" si lotesGeneradosCount >= cap.
//     → throw "AI model not available" si demo mode o sin API key.
//
//   IaBatch.getBatch(path) → Promise<batchDoc | null>
//   IaBatch.advance(path) → Promise<newIndex | null>
//   IaBatch.markPublicada(path, ideaIdx) → Promise<void>
//
// Path: array even-length de Firestore segments alternando coll/doc.
//   ej. ['materias', 'bd', 'iaSuggestions', 'uid-prof-1']
//   ej. ['materias', 'bd', 'iaJuegos', 'uid-prof-1_tema-xyz']
//
// Errores fail-open: getBatch / advance / markPublicada NO throws en
// errores de red — log warn + retornan null. Solo generate() throws
// (caller maneja con toast). Si generate() falla, lotesGeneradosCount
// NO se incrementa (la escritura solo ocurre tras éxito de Gemini).

const IaBatch = (() => {

    function _isProd() {
        return typeof APP_CONFIG !== "undefined"
            && APP_CONFIG.mode === "prod"
            && typeof fbReady === "function"
            && fbReady();
    }

    function _pathToDoc(path) {
        if (!Array.isArray(path) || path.length < 2 || path.length % 2 !== 0) {
            throw new Error("IaBatch path must be even-length array of segments");
        }
        let ref = fbDb();
        for (let i = 0; i < path.length; i += 2) {
            ref = ref.collection(path[i]).doc(path[i + 1]);
        }
        return ref;
    }

    /**
     * @interaction iabatch-get
     * @scope core-ia-batch-read
     *
     * Given path Firestore segments.
     * When caller necesita estado actual del batch.
     * Then async lee el doc; retorna data() o null si no existe.
     *   Errores de red → log warn + retorna null (no throw).
     */
    async function getBatch(path) {
        if (!_isProd()) return null;
        try {
            const snap = await _pathToDoc(path).get();
            return snap.exists ? _migrateShape(snap.data()) : null;
        } catch (e) {
            console.warn("[IaBatch] getBatch fail", path, e);
            return null;
        }
    }

    /**
     * @interaction iabatch-migrate-shape
     * @scope core-ia-batch-internal
     *
     * Backward-compat: docs viejos tienen {ideas, indiceActual, lotesGeneradosCount}.
     * Docs nuevos (cap presente) tienen {lotes: [{ideas, estilo, generadoEn}],
     * loteActual, indiceActual}. Esta función normaliza al shape nuevo
     * cuando lee. Solo mutación in-memory; persistencia ocurre en próximo write.
     */
    function _migrateShape(data) {
        if (!data) return null;
        if (Array.isArray(data.lotes)) return data; // ya en shape nuevo
        if (Array.isArray(data.ideas)) {
            // Shape viejo → convertir
            const migrated = Object.assign({}, data, {
                lotes: [{
                    ideas: data.ideas,
                    estilo: data.estilo || null,
                    generadoEn: data.generadoEn || null
                }],
                loteActual: 0,
                indiceActual: data.indiceActual || 0
            });
            delete migrated.ideas;
            delete migrated.lotesGeneradosCount;
            return migrated;
        }
        return data;
    }

    /**
     * @interaction iabatch-generate
     * @scope core-ia-batch-write
     *
     * Given opts {path, prompt, responseSchema, estilo, cap?, extraFields?}.
     * When caller pide nuevo batch (initial o regeneración).
     * Then:
     *   1. Read prev doc; migra shape viejo si aplica.
     *   2. Si cap definido y lotes.length >= cap → throw "cap-reached".
     *   3. await geminiModel() → throw si null.
     *   4. model.generateContent con responseMimeType=json + responseSchema.
     *   5. Parse JSON; valida {ideas: [...]}; throw SyntaxError/Error si malformado.
     *   6. Si cap definido: append nuevo lote a lotes[]. loteActual = N-1.
     *      Si cap NO definido (temario): sobrescribe con shape simple legacy
     *      (sin lotes[]) para preservar la UX de "regenerar reemplaza".
     *   7. set(payload, {merge:false}) — limpia campos antiguos del shape vieja
     *      cuando migramos a shape nuevo.
     * Edge:
     *   - merge:false significa que campos no incluidos en payload se borran;
     *     OK aquí porque iaBatch docs solo contienen los campos del batch.
     *   - extraFields permite caller persistir metadata extra (temaTitulo, etc.).
     *   - En error post-Gemini (parse/validate/set), NO se incrementa lotes
     *     porque la write nunca ocurrió.
     */
    async function generate(opts) {
        if (!_isProd()) {
            throw new Error("AI model not available");
        }
        const { path, prompt, responseSchema, estilo, cap, extraFields } = opts;
        const docRef = _pathToDoc(path);

        // Read prev + migrate shape si aplica
        let prev = null;
        try {
            const snap = await docRef.get();
            prev = snap.exists ? _migrateShape(snap.data()) : null;
        } catch (e) { /* defensive */ }

        const prevLotes = (prev && Array.isArray(prev.lotes)) ? prev.lotes : [];
        if (typeof cap === "number" && prevLotes.length >= cap) {
            throw new Error("cap-reached");
        }

        // Get Gemini model
        const model = await geminiModel();
        if (!model) {
            throw new Error("AI model not available");
        }

        // Observabilidad IA 2026-06-09: log structured per-call para post-deploy
        // review. Prefijo [ia-metric] para fácil grep en consola/logs.
        const _tStart = Date.now();
        const _uid = (typeof APP !== "undefined" && APP.user) ? APP.user.id : "anon";
        const _pathStr = path.join("/");
        console.log("[ia-metric] start", { uid: _uid, path: _pathStr, estilo, cap });

        let result;
        try {
            result = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: responseSchema
                }
            });
        } catch (e) {
            console.log("[ia-metric] error", { uid: _uid, path: _pathStr, ms: Date.now() - _tStart, err: String(e && e.message || e).slice(0, 120) });
            throw e;
        }
        const _ms = Date.now() - _tStart;
        const text = result.response.text();
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            console.log("[ia-metric] parse-fail", { uid: _uid, path: _pathStr, ms: _ms });
            throw new SyntaxError("Gemini returned non-JSON: " + text.slice(0, 200));
        }
        if (!parsed || !Array.isArray(parsed.ideas) || parsed.ideas.length === 0) {
            throw new Error("Gemini response missing ideas[] array");
        }
        console.log("[ia-metric] ok", { uid: _uid, path: _pathStr, ms: _ms, ideas: parsed.ideas.length });

        let payload;
        if (typeof cap === "number") {
            // Shape nuevo con lotes acumulados
            const nuevoLote = {
                ideas: parsed.ideas,
                estilo: estilo || null,
                generadoEn: new Date().toISOString()  // string ISO (serverTs en arrays no funciona bien)
            };
            const lotes = prevLotes.concat([nuevoLote]);
            payload = {
                lotes,
                loteActual: lotes.length - 1, // recién generado = el último
                indiceActual: 0,
                modelo: "gemini-2.5-flash-lite",
                actualizadoEn: fbServerTs()
            };
        } else {
            // Shape simple sin cap (temario): regenerar reemplaza
            payload = {
                ideas: parsed.ideas,
                indiceActual: 0,
                estilo: estilo || null,
                generadoEn: fbServerTs(),
                modelo: "gemini-2.5-flash-lite"
            };
        }

        // Caller-provided extra fields
        if (extraFields && typeof extraFields === "object") {
            Object.keys(extraFields).forEach(k => {
                payload[k] = extraFields[k];
            });
        }
        // Preserve existing metadata
        if (prev) {
            ["temaTitulo", "temaId"].forEach(k => {
                if (prev[k] != null && payload[k] == null) payload[k] = prev[k];
            });
        }

        // merge:false para limpiar campos de shape viejo cuando migramos
        await docRef.set(payload, { merge: false });
        return payload;
    }

    /**
     * @interaction iabatch-advance
     * @scope core-ia-batch-write
     *
     * Given path.
     * When caller necesita avanzar el cursor a la siguiente idea.
     * Then incrementa indiceActual (clamp a ideas.length - 1) y persiste.
     *   Retorna nuevo índice o null si no existe doc.
     */
    async function advance(path) {
        if (!_isProd()) return null;
        try {
            const docRef = _pathToDoc(path);
            const snap = await docRef.get();
            if (!snap.exists) return null;
            const data = _migrateShape(snap.data());
            const ideasArr = data.lotes
                ? (data.lotes[data.loteActual || 0] || {}).ideas || []
                : (data.ideas || []);
            const max = ideasArr.length - 1;
            const next = Math.min((data.indiceActual || 0) + 1, max);
            await docRef.update({ indiceActual: next });
            return next;
        } catch (e) {
            console.warn("[IaBatch] advance fail", path, e);
            return null;
        }
    }

    /**
     * @interaction iabatch-set-indice
     * @scope core-ia-batch-write
     *
     * Given path + indice arbitrario.
     * When caller necesita navegar a una idea especifica (no solo avanzar).
     * Then persiste indiceActual clamp a [0, ideas.length-1]. Retorna el
     *   indice efectivamente seteado o null si no existe doc.
     */
    async function setIndice(path, n) {
        if (!_isProd()) return null;
        try {
            const docRef = _pathToDoc(path);
            const snap = await docRef.get();
            if (!snap.exists) return null;
            const data = _migrateShape(snap.data());
            const ideasArr = data.lotes
                ? (data.lotes[data.loteActual || 0] || {}).ideas || []
                : (data.ideas || []);
            const max = ideasArr.length - 1;
            const next = Math.max(0, Math.min(n, max));
            await docRef.update({ indiceActual: next });
            return next;
        } catch (e) {
            console.warn("[IaBatch] setIndice fail", path, n, e);
            return null;
        }
    }

    /**
     * @interaction iabatch-set-lote-actual
     * @scope core-ia-batch-write
     *
     * Given path + loteIdx (0..lotes.length-1).
     * When caller alterna entre lotes (botón "Lote anterior" / "Lote siguiente").
     * Then update loteActual + reset indiceActual=0. Solo aplica si shape nuevo
     *   (con lotes[]). Si shape viejo (sin cap), no-op.
     */
    async function setLoteActual(path, loteIdx) {
        if (!_isProd()) return null;
        try {
            const docRef = _pathToDoc(path);
            const snap = await docRef.get();
            if (!snap.exists) return null;
            const data = _migrateShape(snap.data());
            if (!Array.isArray(data.lotes)) return null;
            const max = data.lotes.length - 1;
            const next = Math.max(0, Math.min(loteIdx, max));
            await docRef.update({ loteActual: next, indiceActual: 0 });
            return next;
        } catch (e) {
            console.warn("[IaBatch] setLoteActual fail", path, loteIdx, e);
            return null;
        }
    }

    /**
     * @interaction iabatch-mark-publicada
     * @scope core-ia-batch-write
     *
     * Given path + ideaIdx.
     * When caller publica una idea como entidad oficial (ej. quiz).
     * Then mark ideas[ideaIdx].publicada = true (preserva historial; NO
     *   elimina del array para que el profe pueda ver "ya publicada").
     *   NO consume cap.
     */
    async function markPublicada(path, ideaIdx) {
        if (!_isProd()) return;
        try {
            const docRef = _pathToDoc(path);
            const snap = await docRef.get();
            if (!snap.exists) return;
            const data = _migrateShape(snap.data());
            if (Array.isArray(data.lotes)) {
                // Shape nuevo: marcar idea en el lote actual
                const loteIdx = data.loteActual || 0;
                const lotes = data.lotes.map((lote, li) => {
                    if (li !== loteIdx) return lote;
                    const newIdeas = (lote.ideas || []).map((item, i) =>
                        i === ideaIdx ? Object.assign({}, item, { publicada: true }) : item
                    );
                    return Object.assign({}, lote, { ideas: newIdeas });
                });
                await docRef.update({ lotes });
            } else {
                // Shape simple legacy (temario): marcar en ideas[]
                const ideas = (data.ideas || []).map((item, i) =>
                    i === ideaIdx ? Object.assign({}, item, { publicada: true }) : item
                );
                await docRef.update({ ideas });
            }
        } catch (e) {
            console.warn("[IaBatch] markPublicada fail", path, ideaIdx, e);
        }
    }

    /**
     * @interaction iabatch-query-pool-tema
     * @scope core-ia-batch-read-pool
     *
     * Given matId + temaId.
     * When alumno necesita ver todas las ideas IA del pool de un tema
     *   (lotes del profesor + lotes IA de otros alumnos del mismo grupo).
     * Then query a la sub-coll iaJuegos del materia filtrado por temaId,
     *   colapsa todos los lotes de todos los owners en una lista plana de
     *   {ideaJson, ownerUid, esProfesor, loteIdx, ideaIdx, batchPath},
     *   ignora las ya publicadas. Retorna array (orden estable por owner
     *   + lote + idea).
     * Edge:
     *   - tema sin actividad IA → retorna [].
     *   - Firestore puede sugerir crear índice compuesto (materiaId+temaId);
     *     la sub-coll evita ese índice porque la query es scoped al doc materia.
     */
    async function queryPoolPorTema(matId, temaId, profesorUid, tipo) {
        if (!_isProd()) return [];
        try {
            const qs = await fbDb().collection("materias").doc(matId)
                .collection("iaJuegos")
                .where("temaId", "==", temaId)
                .get();
            const pool = [];
            qs.forEach(doc => {
                const data = _migrateShape(doc.data());
                // Filtrar por tipo si se pasó. Si data.tipo undefined, asumir quiz (legacy).
                const docTipo = data.tipo || "quiz";
                if (tipo && tipo !== docTipo) return;
                // ownerUid es el prefijo del docId antes del _temaId
                const docId = doc.id;
                const sepIdx = docId.indexOf("_" + temaId);
                const ownerUid = sepIdx > 0 ? docId.slice(0, sepIdx) : docId;
                const lotes = Array.isArray(data.lotes) ? data.lotes : [];
                lotes.forEach((lote, loteIdx) => {
                    (lote.ideas || []).forEach((idea, ideaIdx) => {
                        if (idea.publicada) return;
                        pool.push({
                            idea,
                            ownerUid,
                            esProfesor: ownerUid === profesorUid,
                            loteIdx,
                            ideaIdx,
                            tipo: docTipo,
                            batchPath: ["materias", matId, "iaJuegos", docId]
                        });
                    });
                });
            });
            return pool;
        } catch (e) {
            console.warn("[IaBatch] queryPoolPorTema fail", matId, temaId, e);
            return [];
        }
    }

    /**
     * @interaction iabatch-count-quizzes-alumno
     * @scope core-ia-batch-cap-validation
     *
     * Given alumUid + matId + parcial (string "P1"|"P2"|"P3"|null) + origen ("ia"|"manual").
     * When validar cap antes de publicar.
     * Then query juegosUserCreated con creadoPor=alumUid + materiaId=matId
     *   + origen=origen + (opcional) parcial=parcial. Retorna count.
     * Edge:
     *   - parcial=null → no filtra por parcial (cuenta total).
     *   - quizzes sin parcial field se ignoran si parcial != null.
     */
    async function countQuizzesAlumno(alumUid, matId, parcial, origen) {
        if (!_isProd()) return 0;
        try {
            let q = fbDb().collection("juegosUserCreated")
                .where("creadoPor", "==", alumUid)
                .where("materiaId", "==", matId);
            if (origen === "ia") q = q.where("origen", "==", "ia");
            // origen "manual" = sin campo origen (los wizards no lo setean)
            const qs = await q.get();
            let count = 0;
            qs.forEach(doc => {
                const d = doc.data();
                if (origen === "manual" && d.origen === "ia") return;
                if (parcial && d.parcial !== parcial) return;
                count++;
            });
            return count;
        } catch (e) {
            console.warn("[IaBatch] countQuizzesAlumno fail", e);
            return 0;
        }
    }

    return {
        getBatch,
        generate,
        advance,
        setIndice,
        setLoteActual,
        markPublicada,
        queryPoolPorTema,
        countQuizzesAlumno,
        _isProd
    };
})();
window.IaBatch = IaBatch;
