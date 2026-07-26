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

async function findValidSharedSearchCache(supabase, normalizedSearchKey, now = Date.now) {
    const { data, error } = await supabase
        .from("search_cache")
        .select("id,normalized_search_key,candidate_snapshot,profile_count,expires_at,source_workflow_run_id")
        .eq("normalized_search_key", normalizedSearchKey)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    if (!data) return { hit: false, invalid: false, row: null, profiles: [] };

    const profiles = Array.isArray(data.candidate_snapshot) ? data.candidate_snapshot : [];
    const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : null;
    const expired = expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= now());
    const invalid = profiles.length === 0 || expired;

    return {
        hit: !invalid,
        invalid,
        row: data,
        profiles: invalid ? [] : profiles
    };
}

async function upsertSharedSearchCache({
    supabase,
    normalizedSearchKey,
    ownerUserId,
    sourceWorkflowRunId,
    targetName,
    profiles,
    expiresAt,
    now = () => new Date()
}) {
    const key = String(normalizedSearchKey || "").trim();
    if (!key) throw new Error("normalizedSearchKey is required for shared cache persistence.");
    if (!Array.isArray(profiles) || profiles.length === 0) {
        throw new Error("A non-empty raw profile array is required for shared cache persistence.");
    }

    const timestamp = now();
    const updatedAt = timestamp.toISOString();
    const expiration = expiresAt
        ? new Date(expiresAt)
        : new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (!Number.isFinite(expiration.getTime()) || expiration.getTime() <= timestamp.getTime()) {
        throw new Error("Shared cache expiration must be a valid future date.");
    }

    const { data: existing, error: lookupError } = await supabase
        .from("search_cache")
        .select("id,created_at")
        .eq("normalized_search_key", key)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (lookupError) throw lookupError;

    const values = {
        owner_user_id: ownerUserId,
        normalized_search_key: key,
        source_workflow_run_id: sourceWorkflowRunId,
        candidate_snapshot: profiles,
        expires_at: expiration.toISOString(),
        updated_at: updatedAt,
        target_name: String(targetName || "").trim() || null,
        profile_count: profiles.length
    };

    if (existing?.id) {
        const { data, error } = await supabase
            .from("search_cache")
            .update(values)
            .eq("id", existing.id)
            .select("id")
            .single();
        if (error) throw error;
        return { action: "updated", id: data?.id || existing.id, profileCount: profiles.length };
    }

    const { data, error } = await supabase
        .from("search_cache")
        .insert({ ...values, created_at: updatedAt })
        .select("id")
        .single();
    if (error) throw error;
    return { action: "inserted", id: data?.id || null, profileCount: profiles.length };
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

module.exports = {
    cacheDecisionFromRow,
    findValidSharedSearchCache,
    upsertCompletedSearchCache,
    upsertSharedSearchCache
};
