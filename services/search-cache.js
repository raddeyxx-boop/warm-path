function cacheDecisionFromRow(row) {
    if (row?.result_code === "cache_hit") {
        return {
            hit: true,
            cacheId: row.cache_id || null,
            sourceWorkflowRunId: row.source_workflow_run_id || null,
            copiedCandidateCount: Number(row.copied_candidate_count) || 0,
            copiedTopCandidateCount: Number(row.copied_top_candidate_count) || 0
        };
    }

    return {
        hit: false,
        invalid: row?.result_code === "cache_invalid",
        cacheId: row?.cache_id || null
    };
}

async function upsertCompletedSearchCache(supabase, {
    normalizedSearchKey,
    sourceWorkflowRunId,
    candidateSnapshot
}) {
    const { data, error } = await supabase.rpc("upsert_completed_search_cache", {
        p_normalized_search_key: normalizedSearchKey,
        p_source_workflow_run_id: sourceWorkflowRunId,
        p_candidate_snapshot: candidateSnapshot
    });

    if (error) throw error;
    return data;
}

module.exports = { cacheDecisionFromRow, upsertCompletedSearchCache };
