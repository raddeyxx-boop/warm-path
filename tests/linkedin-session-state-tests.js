const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
    cookieExpired,
    isLinkedInCookie,
    safeStorageStateSummary,
    validateStorageState,
    writeStorageStateAtomic
} = require("../services/linkedin-session-state");
const {
    shouldRestoreLinkedInSession
} = require("../scripts/restore-linkedin-session");

const NOW = 2_000_000_000_000;

function state(cookieOverrides = {}) {
    return {
        cookies: [{
            name: "li_at",
            value: "test-secret-value",
            domain: ".linkedin.com",
            path: "/",
            expires: NOW / 1000 + 3600,
            httpOnly: true,
            secure: true,
            sameSite: "None",
            ...cookieOverrides
        }],
        origins: []
    };
}

function rejectsCode(storageState, code) {
    assert.throws(
        () => validateStorageState(storageState, { now: NOW }),
        error => error.code === code
    );
}

validateStorageState(state(), { now: NOW });
validateStorageState(state({ expires: -1 }), { now: NOW });
validateStorageState(state({ expires: 0 }), { now: NOW });
rejectsCode({ origins: [] }, "LINKEDIN_SESSION_ARTIFACT_INVALID");
rejectsCode({ cookies: [] }, "LINKEDIN_SESSION_ARTIFACT_INVALID");
rejectsCode({ cookies: [null], origins: [] }, "LINKEDIN_SESSION_ARTIFACT_INVALID");
rejectsCode({
    cookies: [{ ...state().cookies[0], name: "JSESSIONID" }],
    origins: []
}, "LINKEDIN_SESSION_COOKIE_MISSING");
rejectsCode(state({ value: "" }), "LINKEDIN_SESSION_COOKIE_MISSING");
rejectsCode(state({ expires: NOW / 1000 - 1 }), "LINKEDIN_SESSION_COOKIE_EXPIRED");
rejectsCode(state({ expires: "2000003600" }), "LINKEDIN_SESSION_ARTIFACT_INVALID");
rejectsCode(state({ expires: Number.NaN }), "LINKEDIN_SESSION_ARTIFACT_INVALID");
rejectsCode(state({ expires: Number.POSITIVE_INFINITY }), "LINKEDIN_SESSION_ARTIFACT_INVALID");
assert.strictEqual(cookieExpired(state({ expires: -1 }).cookies[0], NOW), false);
assert.strictEqual(cookieExpired(state({ expires: 0 }).cookies[0], NOW), false);
assert.strictEqual(cookieExpired(state({ expires: NOW / 1000 }).cookies[0], NOW), true);

for (const domain of [
    ".linkedin.com",
    "linkedin.com",
    "www.linkedin.com",
    "subdomain.linkedin.com"
]) {
    assert.strictEqual(isLinkedInCookie({ domain }), true, domain);
    validateStorageState(state({ domain }), { now: NOW });
}
for (const domain of [
    "evil-linkedin.com",
    "linkedin.com.example.com",
    "notlinkedin.com"
]) {
    assert.strictEqual(isLinkedInCookie({ domain }), false, domain);
    rejectsCode(state({ domain }), "LINKEDIN_SESSION_COOKIE_MISSING");
}

const summary = safeStorageStateSummary(state(), { now: NOW });
assert.deepStrictEqual(summary.linkedin_cookie_names, ["li_at"]);
assert.strictEqual(summary.li_at_present, true);
assert.strictEqual(summary.li_at_expired, false);
assert.strictEqual(JSON.stringify(summary).includes("test-secret-value"), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(summary, "value"), false);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "warm-path-session-test-"));
const destinationPath = path.join(temporaryDirectory, "linkedin.json");
try {
    fs.writeFileSync(destinationPath, "existing-valid-file", "utf8");
    writeStorageStateAtomic(destinationPath, state());
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(destinationPath, "utf8")), state());
    assert.deepStrictEqual(
        fs.readdirSync(temporaryDirectory).filter(name => name.endsWith(".tmp")),
        []
    );
} finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

assert.strictEqual(
    shouldRestoreLinkedInSession({ LINKEDIN_SESSION_BASE64: "configured" }),
    false,
    "local development must preserve the local session by default"
);
assert.strictEqual(
    shouldRestoreLinkedInSession({
        LINKEDIN_SESSION_BASE64: "configured",
        RESTORE_LINKEDIN_SESSION_FROM_BASE64: "true"
    }),
    true
);
assert.strictEqual(
    shouldRestoreLinkedInSession({
        LINKEDIN_SESSION_BASE64: "configured",
        LINKEDIN_SESSION_RESTORE: "true"
    }),
    true
);

console.log("LinkedIn session-state tests passed.");
