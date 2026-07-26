"use strict";

require("dotenv").config({ quiet: true });
const { createClient } = require("@supabase/supabase-js");
const { rankCandidates } = require("../utils/relationship-ranking");

function required(name) {
    const value = String(process.env[name] || "").trim();
    if (!value) throw new Error(`Missing required environment: ${name}`);
    return value;
}

function topRow(candidate, context) {
    const ai = candidate.ai_analysis || {};
    const evidence = candidate.relationship_evidence || ai.relationship_evidence || candidate.analysis?.relationship_evidence || {};
    return {
        owner_user_id: context.ownerUserId,
        workflow_run_id: context.workflowRunId,
        search_request_id: context.searchRequestId,
        rank: candidate.rank,
        final_score: candidate.final_score,
        final_grade: candidate.final_grade,
        name: candidate.name,
        linkedin_url: candidate.linkedin_url,
        current_company: candidate.current_company,
        position: candidate.position,
        location: candidate.location,
        role: candidate.role,
        seniority: candidate.seniority,
        decision_power: candidate.decision_power,
        hiring_influence: candidate.analysis?.hiring_influence || null,
        recommendation: candidate.recommendation,
        relationship_strength: candidate.relationship_label,
        personalized_introduction: candidate.personalized_introduction,
        relationship_evidence: evidence,
        top_candidate_reason: candidate.top_candidate_reason,
    };
}

async function main() {
    const ownerUserId = required("OWNER_USER_ID");
    const workflowRunId = required("WORKFLOW_RUN_ID");
    const apply = process.argv.includes("--apply");
    const client = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    const [workflow, search, ranked, existing] = await Promise.all([
        client.from("workflow_runs").select("id,owner_user_id,status").eq("id", workflowRunId).eq("owner_user_id", ownerUserId).maybeSingle(),
        client.from("search_requests").select("id").eq("workflow_run_id", workflowRunId).eq("owner_user_id", ownerUserId).maybeSingle(),
        client.from("ranked_candidates").select("*").eq("workflow_run_id", workflowRunId).eq("owner_user_id", ownerUserId),
        client.from("top_candidates").select("*").eq("workflow_run_id", workflowRunId).eq("owner_user_id", ownerUserId).order("rank"),
    ]);
    for (const result of [workflow, search, ranked, existing]) if (result.error) throw result.error;
    if (!workflow.data) throw new Error("The owner-scoped workflow does not exist.");
    if (!search.data?.id) throw new Error("The owner-scoped search request does not exist.");
    if ((ranked.data || []).length < 3) throw new Error("At least three owner-scoped candidates are required.");

    const rankedRows = rankCandidates(ranked.data);
    const selected = rankedRows.slice(0, 3);
    const payload = selected.map(candidate => topRow(candidate, {
        ownerUserId, workflowRunId, searchRequestId: search.data.id,
    }));
    console.log("[TOP_CANDIDATE_SOURCE]", { owner_user_id: ownerUserId, workflow_run_id: workflowRunId, candidate_count: rankedRows.length });
    selected.forEach(candidate => console.log("[RELATIONSHIP_RANK]", {
        candidate_id: candidate.id, relationship_score: candidate.relationship_evidence_score,
        evidence_count: candidate.verified_evidence_count, final_score: candidate.final_score, calculated_rank: candidate.rank,
    }));
    if (!apply) return console.log("Dry run only. Re-run with --apply to persist this owner/workflow-scoped result.");

    for (const candidate of rankedRows) {
        const aiAnalysis = { ...(candidate.ai_analysis || {}),
            relationship_evidence_score: candidate.relationship_evidence_score,
            relationship_label: candidate.relationship_label,
            verified_evidence_count: candidate.verified_evidence_count };
        const update = await client.from("ranked_candidates").update({ ai_analysis: aiAnalysis })
            .eq("id", candidate.id).eq("owner_user_id", ownerUserId).eq("workflow_run_id", workflowRunId);
        if (update.error) throw update.error;
    }

    const snapshot = existing.data || [];
    const deletion = await client.from("top_candidates").delete().eq("owner_user_id", ownerUserId).eq("workflow_run_id", workflowRunId);
    if (deletion.error) throw deletion.error;
    const insertion = await client.from("top_candidates").insert(payload).select("id,rank,name,owner_user_id,workflow_run_id");
    if (insertion.error) {
        if (snapshot.length) await client.from("top_candidates").insert(snapshot);
        throw insertion.error;
    }
    const summary = await client.from("workflow_runs").update({ top_candidates_count: insertion.data.length })
        .eq("owner_user_id", ownerUserId).eq("id", workflowRunId);
    if (summary.error) throw summary.error;
    console.log("[TOP_CANDIDATES_PERSISTED]", { owner_user_id: ownerUserId, workflow_run_id: workflowRunId,
        candidate_ids: selected.map(candidate => candidate.id), ranks: insertion.data.map(row => row.rank) });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
