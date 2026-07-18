/**
 * ==========================================================
 * Warm Path Finder
 * Seniority Classifier
 * ----------------------------------------------------------
 * Determines professional seniority using deterministic rules.
 * ==========================================================
 */

const SENIORITY_RULES = [

    /* ===========================
       Executive
    =========================== */

    {
        level: "Executive",
        score: 100,
        keywords: [
            "founder",
            "co-founder",
            "ceo",
            "cto",
            "coo",
            "chief",
            "president"
        ]
    },

    /* ===========================
       Director
    =========================== */

    {
        level: "Director",
        score: 90,
        keywords: [
            "director",
            "vice president",
            "vp",
            "head of"
        ]
    },

    /* ===========================
       Manager
    =========================== */

    {
        level: "Manager",
        score: 75,
        keywords: [
            "manager",
            "team lead",
            "technical lead",
            "lead engineer",
            "lead developer",
            "project manager",
            "engineering manager"
        ]
    },

    /* ===========================
       Senior
    =========================== */

    {
        level: "Senior",
        score: 60,
        keywords: [
            "senior",
            "sr.",
            "principal",
            "staff engineer",
            "architect"
        ]
    },

    /* ===========================
       Mid
    =========================== */

    {
        level: "Mid",
        score: 40,
        keywords: [
            "engineer",
            "developer",
            "analyst",
            "accountant",
            "designer",
            "consultant",
            "specialist"
        ]
    },

    /* ===========================
       Junior
    =========================== */

    {
        level: "Junior",
        score: 20,
        keywords: [
            "junior",
            "associate",
            "assistant",
            "graduate",
            "intern",
            "trainee"
        ]
    }

];

function classifySeniority(profile) {

    const fields = [
        {
            name: "position",
            text: (profile.position || "").toLowerCase(),
            weight: 100
        },
        {
            name: "headline",
            text: (profile.headline || "").toLowerCase(),
            weight: 70
        },
        {
            name: "about",
            text: (profile.about || "").toLowerCase(),
            weight: 25
        }
    ];

    let best = {
        level: "Junior",
        score: 20,
        confidence: 0.30,
        reason: "No seniority indicators found.",
        matches: [],
        total: 0
    };

    for (const rule of SENIORITY_RULES) {

        let total = 0;
        const matches = [];

        for (const field of fields) {

            for (const keyword of rule.keywords) {

                if (field.text.includes(keyword.toLowerCase())) {

                    total += field.weight;

                    matches.push(
                        `${keyword} in ${field.name}`
                    );

                }

            }

        }

        if (total > best.total) {

            best = {

                level: rule.level,

                score: rule.score,

                confidence:
                    Math.min(
                        0.99,
                        0.60 + total / 250
                    ),

                reason:
                    matches.length
                        ? `Matched "${matches[0]}"`
                        : "Rule matched",

                matches,

                total

            };

        }

    }

    return {

        ...profile,

        seniority: best.level,

        seniority_score: best.score,

        seniority_confidence: Number(
            best.confidence.toFixed(2)
        ),

        seniority_reason: best.reason,

        seniority_matches: best.matches

    };

}

module.exports = {
    classifySeniority
};