// js/shared/string-compare.js
// Slice Juegos beta · 2026-06-05 · spec §6.2
//
// Algoritmo de similitud de strings para comparar respuesta alumno vs
// reverso del creador en flashcards. Funciones puras sin side effects.
// Similitud final = max(Levenshtein normalizado, Jaccard tokens).

const StringCompare = (() => {

    function _normalize(s) {
        return (s || "")
            .toLowerCase()
            .trim()
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[^\w\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function _levenshteinNorm(a, b) {
        const al = a.length, bl = b.length;
        if (al === 0) return bl === 0 ? 1 : 0;
        if (bl === 0) return 0;
        const dp = Array.from({ length: al + 1 }, (_, i) => {
            const row = new Array(bl + 1).fill(0);
            row[0] = i;
            return row;
        });
        for (let j = 1; j <= bl; j++) dp[0][j] = j;
        for (let i = 1; i <= al; i++) {
            for (let j = 1; j <= bl; j++) {
                dp[i][j] = a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
        return 1 - dp[al][bl] / Math.max(al, bl);
    }

    function _jaccardTokens(a, b) {
        const sa = new Set(a.split(" ").filter(Boolean));
        const sb = new Set(b.split(" ").filter(Boolean));
        if (sa.size === 0 && sb.size === 0) return 1;
        let inter = 0;
        sa.forEach(t => { if (sb.has(t)) inter++; });
        const union = sa.size + sb.size - inter;
        return union === 0 ? 0 : inter / union;
    }

    function calcSimilarity(respuesta, reverso) {
        const a = _normalize(respuesta);
        const b = _normalize(reverso);
        if (!a || !b) return 0;
        if (a.length <= 3 || b.length <= 3) return a === b ? 1 : 0;
        return Math.max(_levenshteinNorm(a, b), _jaccardTokens(a, b));
    }

    function similarityToNivel(sim) {
        if (sim >= 0.91) return "la_sabia";
        if (sim >= 0.60) return "mas_o_menos";
        return "no_la_sabia";
    }

    function nivelPuntos(nivel) {
        if (nivel === "la_sabia") return 10;
        if (nivel === "mas_o_menos") return 5;
        return 0;
    }

    return {
        calcSimilarity,
        similarityToNivel,
        nivelPuntos,
        _normalize,
        _levenshteinNorm,
        _jaccardTokens
    };
})();
