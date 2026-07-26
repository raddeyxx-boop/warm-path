const { createClient } = require("@supabase/supabase-js");
const { rankCandidates } = require("./relationship-ranking");
const STAGES = {
  checking_cache: [5, 30, "Checking for cached searches..."], starting: [10, 20, "Preparing browser..."],
  searching_linkedin: [35, 1200, "Searching connections..."], finding_mutual_connections: [55, 600, "Collecting profiles..."],
  processing_profiles: [70, 480, "Processing LinkedIn profiles..."], ranking_candidates: [82, 240, "Ranking candidates..."],
  ai_analysis: [92, 120, "Running AI analysis..."], saving_results: [97, 30, "Saving candidates..."],
  completed: [100, 0, "Search completed successfully."], failed: [0, null, "Search failed."], cancelled: [0, null, "Search cancelled."]
};
async function updateWorkflowProgress(step, extra = {}) {
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: key, SUPABASE_ACCESS_TOKEN: token, WORKFLOW_RUN_ID: id, OWNER_USER_ID: owner, SEARCH_REQUEST_ID: searchId } = process.env;
  if (!url || !key || !token || !id || !owner) return;
  const client = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const [progress, estimate, message] = STAGES[step] || [0, null, step];
  const payload = { current_step: step, current_message: message, progress_percent: progress, estimated_remaining_seconds: estimate, ...extra };
  if (["completed", "failed", "cancelled"].includes(step)) payload.status = step;
  let workflowUpdate = client.from("workflow_runs").update(payload).eq("id", id).eq("owner_user_id", owner);
  if (["completed", "failed", "cancelled"].includes(step)) {
    workflowUpdate = workflowUpdate.in("status", ["queued", "running", "starting", "processing", "in_progress"]);
  }
  const { error } = await workflowUpdate;
  if (error) console.error("Workflow progress update failed:", error.code || error.message);
  if (["completed", "failed", "cancelled"].includes(step) && searchId) {
    const timestamps = step === "completed" ? { completed_at: new Date().toISOString() } : step === "failed" ? { failed_at: new Date().toISOString() } : {};
    const { error: searchError } = await client.from("search_requests").update({ status: step, ...timestamps })
      .eq("id", searchId).eq("owner_user_id", owner)
      .in("status", ["queued", "running", "starting", "processing", "in_progress"]);
    if (searchError) console.error("Search progress update failed:", searchError.code || searchError.message);
  }
}
async function cacheCompletedWorkflow(options = {}) {
  const startedAt = Date.now();
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: key, SUPABASE_ACCESS_TOKEN: token } = process.env;
  const workflowId = options.workflowId || process.env.WORKFLOW_RUN_ID;
  const searchHash = options.searchHash || process.env.SEARCH_HASH;
  const ownerUserId = options.ownerUserId || process.env.OWNER_USER_ID;
  const searchRequestId = options.searchRequestId || process.env.SEARCH_REQUEST_ID;
  if ((!options.client && (!url || !key || !token)) || !workflowId || !searchHash || !ownerUserId) return;
  const client = options.client || createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const [ranked, initialTop] = await Promise.all([
    client.from("ranked_candidates").select("*").eq("workflow_run_id", workflowId).eq("owner_user_id", ownerUserId),
    client.from("top_candidates").select("*").eq("workflow_run_id", workflowId).eq("owner_user_id", ownerUserId)
  ]);
  if (ranked.error || initialTop.error) throw ranked.error || initialTop.error;
  const controlled = new Set(["id", "owner_user_id", "workflow_run_id", "created_at", "updated_at"]);
  const clean = candidate => Object.fromEntries(Object.entries(candidate).filter(([field]) => !controlled.has(field)));
  let topRows = initialTop.data || [];
  if (!topRows.length && ranked.data?.length) {
    const owner = ownerUserId;
    const topPayload = rankCandidates(ranked.data).slice(0, 3).map(candidate => ({
      owner_user_id: owner, workflow_run_id: workflowId, search_request_id: searchRequestId,
      candidate_id: candidate.id, rank: candidate.rank, name: candidate.name,
      linkedin_url: candidate.linkedin_url, current_company: candidate.current_company,
      position: candidate.position, location: candidate.location, role: candidate.role,
      seniority: candidate.seniority, decision_power: candidate.decision_power,
      recommendation: candidate.recommendation, final_score: candidate.final_score,
      final_grade: candidate.final_grade, relationship_evidence: candidate.relationship_evidence,
      relationship_evidence_score: candidate.relationship_evidence_score,
      relationship_rank_score: candidate.relationship_evidence_score,
      relationship_label: candidate.relationship_label,
      relationship_strength: candidate.relationship_label,
      verified_evidence_count: candidate.verified_evidence_count,
      top_candidate_reason: candidate.top_candidate_reason,
      personalized_introduction: candidate.personalized_introduction
    }));
    const inserted = await client.from("top_candidates").insert(topPayload).select("*");
    if (inserted.error) throw inserted.error;
    topRows = inserted.data || [];
  }
  const snapshot = [
    ...(ranked.data || []).map(candidate => ({ table: "ranked_candidates", candidate: clean(candidate) })),
    ...topRows.map(candidate => ({ table: "top_candidates", candidate: clean(candidate) }))
  ];
  const { error } = await client.rpc("upsert_completed_search_cache", {
    p_normalized_search_key: searchHash, p_source_workflow_run_id: workflowId, p_candidate_snapshot: snapshot
  });
  if (error) throw error;
  console.log("Target search cache", {
    event: "refreshed", workflow_run_id: workflowId, owner_user_id: ownerUserId,
    ranked_candidate_count: (ranked.data || []).length, top_candidate_count: topRows.length,
    elapsed_ms: Date.now() - startedAt
  });
}
module.exports = { STAGES, cacheCompletedWorkflow, updateWorkflowProgress };
