const fs = require("fs");
const { LINKEDIN_SESSION_PATH } = require("../config/linkedin-session");
const {
  safeStorageStateSummary,
  validateStorageState,
  writeStorageStateAtomic
} = require("../services/linkedin-session-state");

console.log("[LINKEDIN_SESSION_RESTORE] started", {
  cwd: process.cwd(),
  configured_path: LINKEDIN_SESSION_PATH,
  has_base64: Boolean(process.env.LINKEDIN_SESSION_BASE64)
});

function restoreLinkedInSession() {
  const sessionBase64 = process.env.LINKEDIN_SESSION_BASE64;

  if (!sessionBase64) {
    console.log("[LINKEDIN_SESSION_RESTORE]", {
      status: "skipped",
      reason: "environment_not_configured",
      session_path: LINKEDIN_SESSION_PATH,
      local_session_exists: fs.existsSync(LINKEDIN_SESSION_PATH)
    });
    return;
  }

  try {
    const decodedSession = Buffer.from(
      sessionBase64.trim(),
      "base64"
    ).toString("utf8");

    const parsedSession = validateStorageState(JSON.parse(decodedSession));

    writeStorageStateAtomic(LINKEDIN_SESSION_PATH, parsedSession);

    console.log("[LINKEDIN_SESSION_RESTORE]", {
      status: "restored",
      session_path: LINKEDIN_SESSION_PATH,
      ...safeStorageStateSummary(parsedSession)
    });
  } catch (error) {
    console.error("[LINKEDIN_SESSION_RESTORE]", {
      status: "failed",
      code: error?.code || "LINKEDIN_SESSION_ARTIFACT_INVALID",
      session_path: LINKEDIN_SESSION_PATH,
      reason: error instanceof Error ? error.message : String(error)
    });

    process.exit(1);
  }
}

restoreLinkedInSession();
