const fs = require("fs");
const path = require("path");
const { writeJsonAtomicSync } = require("../utils/JsonFileStore");

function requireText(value, label) {
    const text = String(value || "").trim();
    if (!text) throw new Error(`${label} is required for the final extraction result.`);
    return text;
}

function buildFinalExtractionResult({ ownerUserId, workflowRunId, searchRequestId, target, connections, candidates }) {
    const owner = requireText(ownerUserId, "owner_user_id");
    const workflow = requireText(workflowRunId, "workflow_run_id");
    const search = requireText(searchRequestId, "search_request_id");
    if (!target || typeof target !== "object" || Array.isArray(target)) throw new Error("target is required for the final extraction result.");
    if (!Array.isArray(connections)) throw new Error("connections must be an array in the final extraction result.");
    if (!Array.isArray(candidates)) throw new Error("candidates must be an array in the final extraction result.");
    const completedAt = new Date().toISOString();
    return {
        owner_user_id: owner,
        workflow_run_id: workflow,
        search_request_id: search,
        target,
        target_profile: target,
        connections,
        candidates,
        relationship_evidence: candidates.map(candidate => candidate.relationship_evidence ?? null),
        extraction_summary: { connection_count: connections.length, candidate_count: candidates.length },
        extraction_status: "completed",
        started_at: target.createdAt || completedAt,
        completed_at: completedAt
    };
}

function assertResultContext(result, expected) {
    for (const field of ["owner_user_id", "workflow_run_id", "search_request_id"]) {
        if (String(result?.[field] || "") !== String(expected[field] || "")) {
            throw new Error(`Final extraction result ${field} does not match the authenticated workflow context.`);
        }
    }
    if (result.extraction_status !== "completed" || !Array.isArray(result.candidates) || !Array.isArray(result.connections)) {
        throw new Error("Final extraction result is incomplete or malformed.");
    }
    return result;
}

function writeFinalExtractionResult(filePath, result) {
    writeJsonAtomicSync(path.resolve(filePath), result);
    return path.resolve(filePath);
}

function readFinalExtractionResult(filePath, expected) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) throw new Error(`Playwright completed without final extraction result: ${resolved}`);
    return assertResultContext(JSON.parse(fs.readFileSync(resolved, "utf8")), expected);
}

module.exports = { assertResultContext, buildFinalExtractionResult, readFinalExtractionResult, writeFinalExtractionResult };
