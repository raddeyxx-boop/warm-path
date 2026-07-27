const LINKEDIN_COOKIE_DOMAIN = /^(?:\.)?(?:[a-z0-9-]+\.)*linkedin\.com$/i;
const COOKIE_DOMAIN = /^(?:\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

class LinkedInSessionStateError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "LinkedInSessionStateError";
        this.code = code;
        this.details = details;
    }
}

function isLinkedInCookie(cookie) {
    return LINKEDIN_COOKIE_DOMAIN.test(String(cookie?.domain || ""));
}

function cookieExpired(cookie, now = Date.now()) {
    return Number.isFinite(cookie?.expires) &&
        cookie.expires > 0 &&
        cookie.expires * 1000 <= now;
}

function invalid(message, details) {
    return new LinkedInSessionStateError(
        "LINKEDIN_SESSION_ARTIFACT_INVALID",
        message,
        details
    );
}

function validateStorageState(storageState, { now = Date.now() } = {}) {
    if (!storageState || typeof storageState !== "object" || Array.isArray(storageState)) {
        throw invalid("LinkedIn storage state must be a JSON object.");
    }
    if (!Array.isArray(storageState.cookies)) {
        throw invalid("LinkedIn storage state is missing the cookies array.");
    }
    if (!Array.isArray(storageState.origins)) {
        throw invalid("LinkedIn storage state is missing the origins array.");
    }

    storageState.cookies.forEach((cookie, index) => {
        const details = { cookie_index: index };
        if (!cookie || typeof cookie !== "object" || Array.isArray(cookie)) {
            throw invalid("LinkedIn storage state contains a non-object cookie.", details);
        }
        details.cookie_name = typeof cookie.name === "string" ? cookie.name : "(missing)";
        if (typeof cookie.name !== "string" || !cookie.name.trim()) {
            throw invalid("LinkedIn storage state contains a cookie without a name.", details);
        }
        if (typeof cookie.value !== "string") {
            throw invalid("LinkedIn storage state contains a cookie with a non-string value.", details);
        }
        if (typeof cookie.domain !== "string" || !COOKIE_DOMAIN.test(cookie.domain)) {
            throw invalid("LinkedIn storage state contains a cookie with an invalid domain.", details);
        }
        if (typeof cookie.path !== "string" || !cookie.path.startsWith("/")) {
            throw invalid("LinkedIn storage state contains a cookie with an invalid path.", details);
        }
        if (
            Object.prototype.hasOwnProperty.call(cookie, "expires") &&
            (!Number.isFinite(cookie.expires) || cookie.expires < -1)
        ) {
            throw invalid("LinkedIn storage state contains a cookie with an invalid expiry.", details);
        }
    });

    const linkedInCookies = storageState.cookies.filter(isLinkedInCookie);
    if (linkedInCookies.length === 0) {
        throw new LinkedInSessionStateError(
            "LINKEDIN_SESSION_COOKIE_MISSING",
            "LinkedIn storage state does not contain any LinkedIn-domain cookies."
        );
    }

    const liAt = linkedInCookies.find(cookie => cookie.name === "li_at");
    if (!liAt || !liAt.value) {
        throw new LinkedInSessionStateError(
            "LINKEDIN_SESSION_COOKIE_MISSING",
            "LinkedIn storage state does not contain a non-empty li_at cookie."
        );
    }
    if (cookieExpired(liAt, now)) {
        throw new LinkedInSessionStateError(
            "LINKEDIN_SESSION_COOKIE_EXPIRED",
            "The li_at cookie in LinkedIn storage state is already expired.",
            { cookie_name: "li_at", expires: liAt.expires }
        );
    }

    return storageState;
}

function safeStorageStateSummary(storageState, { now = Date.now() } = {}) {
    const cookies = Array.isArray(storageState?.cookies) ? storageState.cookies : [];
    const linkedInCookies = cookies.filter(isLinkedInCookie);
    return {
        cookies: cookies.length,
        origins: Array.isArray(storageState?.origins) ? storageState.origins.length : 0,
        linkedin_cookie_names: linkedInCookies.map(cookie => cookie.name).sort(),
        li_at_present: linkedInCookies.some(cookie =>
            cookie.name === "li_at" && Boolean(cookie.value)
        ),
        li_at_expired: linkedInCookies.some(cookie =>
            cookie.name === "li_at" && cookieExpired(cookie, now)
        )
    };
}

function writeStorageStateAtomic(destinationPath, storageState) {
    const sessionDirectory = path.dirname(destinationPath);
    const temporaryPath = path.join(
        sessionDirectory,
        `.${path.basename(destinationPath)}.${process.pid}.${Date.now()}.tmp`
    );

    fs.mkdirSync(sessionDirectory, { recursive: true });
    try {
        fs.writeFileSync(
            temporaryPath,
            JSON.stringify(storageState, null, 2),
            { encoding: "utf8", mode: 0o600, flag: "wx" }
        );
        fs.renameSync(temporaryPath, destinationPath);
    } catch (error) {
        fs.rmSync(temporaryPath, { force: true });
        throw error;
    }
}

module.exports = {
    LinkedInSessionStateError,
    cookieExpired,
    isLinkedInCookie,
    safeStorageStateSummary,
    validateStorageState,
    writeStorageStateAtomic
};
const fs = require("fs");
const path = require("path");
