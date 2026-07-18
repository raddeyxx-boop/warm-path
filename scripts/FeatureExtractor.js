/**
 * ==========================================================
 * Warm Path Finder
 * Feature Extractor
 * ----------------------------------------------------------
 * Extracts deterministic features from a LinkedIn profile.
 * ==========================================================
 */

function extractFeatures(profile) {

    const has_about =
        Boolean(
            profile.about &&
            profile.about.trim()
        );

const has_location =
    Boolean(
        profile.location &&
        profile.location.trim()
    );

const has_company =
    Boolean(
        profile.current_company &&
        profile.current_company.trim()
    );

    const experience_count =
    Array.isArray(profile.experience)
        ? profile.experience.length
        : 0;

const education_count =
    Array.isArray(profile.education)
        ? profile.education.length
        : 0;

const skill_count =
    Array.isArray(profile.skills)
        ? profile.skills.length
        : 0;

return {

    ...profile,

    has_about,

    has_location,

    has_company,

    experience_count,

    education_count,

    skill_count,

};

}

module.exports = {
    extractFeatures
};
