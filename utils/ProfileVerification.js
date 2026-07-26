function cleanText(value) {
    return (value || "")
        .toString()
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeText(value) {
    return cleanText(value).toLowerCase();
}

function fieldMatches(left, right) {
    const normalizedLeft = normalizeText(left);
    const normalizedRight = normalizeText(right);

    return Boolean(
        normalizedLeft &&
        normalizedRight &&
        (
            normalizedLeft === normalizedRight ||
            normalizedLeft.includes(normalizedRight) ||
            normalizedRight.includes(normalizedLeft)
        )
    );
}

function scoreTextField(label, suggestionText, expectedValue, points) {
    if (!fieldMatches(suggestionText, expectedValue)) {
        return null;
    }

    return {
        label,
        points
    };
}

function employmentFromHeadline(headline) {
    const cleaned = cleanText(headline);
    const match = cleaned.match(/^(.+?)\s+at\s+(.+)$/i);

    return match
        ? { position: cleanText(match[1]), company: cleanText(match[2]) }
        : { position: "", company: "" };
}

function expectedProfileFields(profile = {}) {
    const headlineEmployment = employmentFromHeadline(profile.headline);

    return {
        name: profile.name,
        company: profile.company || profile.current_company || headlineEmployment.company,
        headline: profile.headline,
        location: profile.location,
        position: profile.position || headlineEmployment.position
    };
}

function scoreProfileFields(suggestionText, fields) {
    const definitions = [
        ["name", fields.name, 20],
        ["company", fields.company, 30],
        ["headline", fields.headline, 25],
        ["location", fields.location, 15],
        ["position", fields.position, 20]
    ];
    const available = {};
    const matched = {};
    const matches = [];

    for (const [label, value, points] of definitions) {
        available[label] = Boolean(value);
        matched[label] = fieldMatches(suggestionText, value);

        if (matched[label]) {
            matches.push(scoreTextField(label, suggestionText, value, points));
        }
    }

    return {
        score: matches.reduce((total, match) => total + match.points, 0),
        reasons: matches.map(match => `${match.label} +${match.points}`),
        checked: available,
        matched
    };
}

function scoreProfileSuggestion(suggestion, expectedProfile, options = {}) {
    const normalizeProfileUrl = options.normalizeProfileUrl || (value => value || "");
    const threshold = options.threshold || 95;
    const expectedUrl = normalizeProfileUrl(
        expectedProfile.linkedin_url || expectedProfile.url || ""
    );
    const suggestionUrl = normalizeProfileUrl(suggestion.href || "");
    const suggestionText = cleanText(suggestion.text);
    const fields = expectedProfileFields(expectedProfile);
    const fieldScore = scoreProfileFields(suggestionText, fields);
    const reasons = [];
    let score = 0;
    const exactUrl = Boolean(expectedUrl && suggestionUrl && suggestionUrl === expectedUrl);

    if (exactUrl) {
        score += 100;
        reasons.push("exact LinkedIn URL +100");
    }

    score += fieldScore.score;
    reasons.push(...fieldScore.reasons);
    score = Math.min(100, score);

    return {
        score,
        threshold,
        verified: score >= threshold && (!expectedUrl || exactUrl),
        exactUrl,
        suggestionUrl,
        expectedUrl,
        suggestionText,
        fieldChecks: fieldScore.checked,
        fieldMatches: fieldScore.matched,
        reasons
    };
}

function scoreToPercent(score) {
    return `${Math.round(score)}%`;
}

module.exports = {
    cleanText,
    employmentFromHeadline,
    expectedProfileFields,
    fieldMatches,
    normalizeText,
    scoreProfileFields,
    scoreProfileSuggestion,
    scoreToPercent
};
