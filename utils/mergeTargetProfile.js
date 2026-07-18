const { normalizeNumericField } = require("./NumericNormalizer");

function cleanText(value) {
    return (value || "").toString().replace(/\s+/g, " ").trim();
}

function preferText(profileValue, targetValue) {
    return cleanText(profileValue) || cleanText(targetValue);
}

function preferArray(profileValue, targetValue) {
    if (Array.isArray(profileValue)) {
        return profileValue;
    }

    if (Array.isArray(targetValue)) {
        return targetValue;
    }

    return [];
}

function preferNumeric(profileValue, targetValue) {
    const normalizedProfileValue = normalizeNumericField(profileValue);

    if (normalizedProfileValue !== null) {
        return normalizedProfileValue;
    }

    return normalizeNumericField(targetValue);
}

function mergeTargetProfile(target = {}, profile = {}) {
    const currentCompany = preferText(
        profile.current_company,
        target.current_company || target.company
    );
    const company = preferText(
        profile.company,
        target.company || currentCompany
    ) || currentCompany;
    const education = preferArray(profile.education, target.education);

    return {
        name: preferText(profile.name, target.name),
        linkedin_url: preferText(profile.linkedin_url, target.linkedin_url || target.url),
        headline: preferText(profile.headline, target.headline),
        location: preferText(profile.location, target.location),
        about: preferText(profile.about, target.about),
        current_company: currentCompany || company,
        position: preferText(profile.position, target.position),
        followers: preferNumeric(profile.followers, target.followers),
        connections: preferNumeric(profile.connections, target.connections),
        experience: preferArray(profile.experience, target.experience),
        education,
        skills: preferArray(profile.skills, target.skills),
        createdAt: target.createdAt || new Date().toISOString(),
        url: preferText(target.url, profile.linkedin_url || profile.url)
    };
}

module.exports = {
    mergeTargetProfile
};
