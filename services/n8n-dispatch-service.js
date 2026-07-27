const { sendExtractionToN8n } = require("./n8n-webhook-client");
const { validateRelationshipEvidence } = require("../utils/FinalProfileSerializer");

async function persistDispatchStatus(supabase, ownerUserId, workflowRunId, values) {
    const { error } = await supabase.from("workflow_runs").update(values)
        .eq("id", workflowRunId).eq("owner_user_id", ownerUserId);
    if (error) throw error;
}

function buildWebhookPayload(result, searchHash, { cacheHit = false, cacheId = null } = {}) {
    if (!Array.isArray(result.connections)) throw new TypeError("Webhook connections must be an array.");
    if (!Array.isArray(result.candidates)) throw new TypeError("Webhook candidates must be an array.");
    if (result.connections === result.candidates && result.candidates.length > 0) {
        throw new Error("Payload integrity error: connections and candidates reference the same array.");
    }
    result.candidates.forEach((candidate, index) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
            throw new TypeError(`Webhook candidate at index ${index} must be an object.`);
        }
    });
    validateRelationshipEvidence(result.candidates);
    validateRelationshipEvidence(result.relationship_evidence.map((relationshipEvidence, index) => ({
        name: result.candidates[index]?.name || `index ${index}`,
        relationship_evidence: relationshipEvidence
    })));
    // Connections are raw mutual records; candidates are fully extracted/classified records.
    const connections = result.connections;
    const candidates = result.candidates;
    const idempotencyKey = `warm-path:${result.owner_user_id}:${result.workflow_run_id}:${result.search_request_id}:completed`;
    return {
        event: "warm_path.extraction.completed",
        version: "1.0",
        sent_at: new Date().toISOString(),
        owner_user_id: result.owner_user_id,
        workflow_run_id: result.workflow_run_id,
        search_request_id: result.search_request_id,
        normalized_search_key: searchHash || null,
        cache_hit: cacheHit,
        cache_id: cacheId,
        profiles: connections,
        connections,
        candidates,
        target: {
            requested_name: result.target?.name || null,
            linkedin_url: result.target?.linkedin_url || result.target?.url || null,
            current_company: result.target?.current_company || result.target?.company || null,
            location: result.target?.location || null,
            profile: result.target_profile
        },
        extraction: {
            target_profile: result.target_profile,
            connections,
            candidates,
            relationship_evidence: result.relationship_evidence,
            summary: result.extraction_summary,
            status: result.extraction_status
        },
        metadata: {
            source: cacheHit ? "warm-path-search-cache" : "warm-path-playwright",
            search_hash: searchHash || null,
            cache_hit: cacheHit,
            cache_id: cacheId,
            execution_started_at: result.started_at,
            execution_completed_at: result.completed_at,
            idempotency_key: idempotencyKey
        }
    };
}

async function dispatchCompletedExtraction({ supabase, result, searchHash, cacheHit = false, cacheId = null, send = sendExtractionToN8n }) {
    const now = new Date().toISOString();
    await persistDispatchStatus(supabase, result.owner_user_id, result.workflow_run_id, {
        n8n_dispatch_status: "dispatching", n8n_dispatch_started_at: now,
        n8n_dispatch_error: null, current_step: "dispatching_to_n8n", current_message: "Sending data to n8n...",
        progress_percent: 92, estimated_remaining_seconds: null
    });
    const payload = buildWebhookPayload(result, searchHash, { cacheHit, cacheId });
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    const requiredCandidateFields = [
        "company", "current_company", "position", "headline", "location", "about",
        "experience", "education", "skills", "technologies", "relationship_evidence"
    ];
    const candidateFieldPresenceSummary = Object.fromEntries(requiredCandidateFields.map(field => [
        field,
        payload.extraction.candidates.filter(candidate => {
            const value = candidate[field];
            return value !== undefined && value !== null && value !== "" &&
                (!Array.isArray(value) || value.length > 0);
        }).length
    ]));
    console.log("[N8N_PAYLOAD_VALIDATED]", {
        owner_user_id: result.owner_user_id, workflow_run_id: result.workflow_run_id,
        search_request_id: result.search_request_id, target_name: result.target?.name || null,
        connection_count: result.connections.length, candidate_count: result.candidates.length,
        payload_bytes: payloadBytes,
        first_candidate_fields: Object.keys(payload.extraction.candidates[0] || {}),
        relationship_evidence_fields: Object.keys(payload.extraction.candidates[0]?.relationship_evidence || {}),
        candidate_field_presence_summary: candidateFieldPresenceSummary
    });
    try {
        const response = await send({
            webhookUrl: process.env.N8N_EXTRACTION_WEBHOOK_URL,
            webhookSecret: process.env.N8N_WEBHOOK_SECRET || "",
            payload,
            timeoutMs: process.env.N8N_WEBHOOK_TIMEOUT_MS,
            maxRetries: process.env.N8N_WEBHOOK_MAX_RETRIES
        });
        await persistDispatchStatus(supabase, result.owner_user_id, result.workflow_run_id, {
            n8n_dispatch_status: "succeeded", n8n_dispatch_completed_at: new Date().toISOString(),
            n8n_execution_id: response.n8n_execution_id, n8n_dispatch_error: null,
            status: "processing", current_step: "processing_in_n8n", current_message: "Processing results...",
            progress_percent: 96, estimated_remaining_seconds: null
        });
        return response;
    } catch (error) {
        await persistDispatchStatus(supabase, result.owner_user_id, result.workflow_run_id, {
            n8n_dispatch_status: "failed", n8n_dispatch_completed_at: new Date().toISOString(),
            n8n_dispatch_error: String(error.message).slice(0, 500),
            current_step: "processing_failed", current_message: "Processing failed after extraction."
        });
        const dispatchError = new Error(`Processing failed after extraction: ${error.message}`);
        dispatchError.code = error.code || "N8N_DISPATCH_FAILED";
        dispatchError.cause = error;
        throw dispatchError;
    }
}

module.exports = { buildWebhookPayload, dispatchCompletedExtraction, persistDispatchStatus };
