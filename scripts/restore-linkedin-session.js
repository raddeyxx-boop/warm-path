const fs = require("fs");
const path = require("path");
const { LINKEDIN_SESSION_PATH } = require("../config/linkedin-session");



console.log("[LINKEDIN_SESSION_RESTORE] started", {
  cwd: process.cwd(),
  configured_path: LINKEDIN_SESSION_PATH,
  has_base64: Boolean(process.env.LINKEDIN_SESSION_BASE64),
  base64_length: process.env.LINKEDIN_SESSION_BASE64?.length || 0
});

function restoreLinkedInSession() {
  const sessionBase64 = process.env.LINKEDIN_SESSION_BASE64;

  if (!sessionBase64) {
    console.log(
      "LINKEDIN_SESSION_BASE64 is not configured. Existing local session will be used if available."
    );
    return;
  }

  try {
    const sessionDirectory = path.dirname(LINKEDIN_SESSION_PATH);

    fs.mkdirSync(sessionDirectory, {
      recursive: true
    });

    const decodedSession = Buffer.from(
      sessionBase64.trim(),
      "base64"
    ).toString("utf8");

    const parsedSession = JSON.parse(decodedSession);

    if (
      !parsedSession ||
      !Array.isArray(parsedSession.cookies) ||
      !Array.isArray(parsedSession.origins)
    ) {
      throw new Error(
        "Decoded LinkedIn session does not have a valid Playwright storage-state structure."
      );
    }

    fs.writeFileSync(
      LINKEDIN_SESSION_PATH,
      JSON.stringify(parsedSession, null, 2),
      {
        encoding: "utf8",
        mode: 0o600
      }
    );

    console.log("LinkedIn session restored successfully.", {
      session_path: LINKEDIN_SESSION_PATH,
      cookies: parsedSession.cookies.length,
      origins: parsedSession.origins.length
    });
  } catch (error) {
    console.error("Failed to restore LinkedIn session.", {
      session_path: LINKEDIN_SESSION_PATH,
      reason: error instanceof Error ? error.message : String(error)
    });

    process.exit(1);
  }
}

restoreLinkedInSession();