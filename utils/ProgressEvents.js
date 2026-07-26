const STAGES = Object.freeze({
  initialized: [0, "Preparing search..."], queued: [5, "Queued for processing..."],starting_search: [10, "Starting search..."],
  linkedin_session_verified: [15, "LinkedIn session verified"], human_browsing: [25, "Browsing LinkedIn naturally..."],
  searching_target: [35, "Searching for target..."], target_profile_opened: [45, "Target profile opened"],
  extracting_target: [55, "Reading target profile..."], opening_connections: [62, "Opening connections..."],
  collecting_connections: [72, "Collecting connections..."], building_candidates: [82, "Building candidate matches..."],
  extraction_completed: [88, "Extraction completed"], dispatching_to_n8n: [92, "Sending data to n8n..."],
  processing_in_n8n: [96, "Processing results..."], completed: [100, "Completed"]
});
function emitProgress(stage, message, extra = {}) {
  const definition = STAGES[stage];
  if (!definition) throw new Error(`Unknown workflow progress stage: ${stage}`);
  const payload = { stage, percent: definition[0], message: message || definition[1], emitted_at: new Date().toISOString(), ...extra };
  console.log(`__WARM_PATH_PROGRESS__=${JSON.stringify(payload)}`);
  return payload;
}
module.exports = { STAGES, emitProgress };
