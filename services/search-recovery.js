const { createServiceSupabaseClient } = require("./supabase-server");

async function recoverAbandonedSearches(options = {}) {
    const createClient =
        options.createServiceSupabaseClient || createServiceSupabaseClient;

    const logger = options.logger || console;
    const client = createClient();

    const { data, error } = await client.rpc(
        "recover_abandoned_searches_on_backend_start"
    );

    if (error) {
        const recoveryError = new Error(
            error.message || "Backend startup recovery failed."
        );

        recoveryError.code = error.code || "RECOVERY_RPC_FAILED";
        recoveryError.details = error.details || null;
        recoveryError.hint = error.hint || null;

        throw recoveryError;
    }

    const recoveredSearches = Array.isArray(data) ? data : [];
    const recoveredCount = recoveredSearches.length;

    logger.log("[Recovery] Backend startup recovery completed.", {
        recovered_count: recoveredCount,
    });

    return recoveredSearches;
}

module.exports = {
    recoverAbandonedSearches,
};
