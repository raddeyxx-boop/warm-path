function isDebugEnabled() {
    return /^(1|true|yes)$/i.test(process.env.DEBUG || "");
}

function debugLog(scope, message, details = undefined) {
    if (!isDebugEnabled()) {
        return;
    }

    if (details === undefined) {
        console.log(`[debug:${scope}] ${message}`);
        return;
    }

    console.log(`[debug:${scope}] ${message}`, details);
}

module.exports = {
    debugLog,
    isDebugEnabled
};
