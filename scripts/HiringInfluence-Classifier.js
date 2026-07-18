/**
 * ==========================================================
 * Warm Path Finder
 * Hiring Influence Classifier
 * ==========================================================
 */

const HIRING_RULES = [

    /* ===========================
       Very High
    =========================== */

    {
        level: "Very High",
        score: 100,
        keywords: [
            "founder",
            "co-founder",
            "ceo",
            "cto",
            "coo",
            "chief executive officer",
            "chief technology officer",
            "chief operating officer"
        ]
    },

    {
        level: "Very High",
        score: 95,
        keywords: [
            "talent acquisition",
            "head of talent",
            "head of recruitment",
            "recruitment manager"
        ]
    },

    /* ===========================
       High
    =========================== */

    {
        level: "High",
        score: 85,
        keywords: [
            "engineering manager",
            "hr manager",
            "people manager",
            "director",
            "vice president",
            "vp engineering",
            "vp hr"
        ]
    },

    /* ===========================
       Medium
    =========================== */

    {
        level: "Medium",
        score: 65,
        keywords: [
            "recruiter",
            "technical recruiter",
            "hr executive",
            "hr specialist",
            "team lead",
            "lead engineer",
            "project manager"
        ]
    },

    /* ===========================
       Low
    =========================== */

    {
        level: "Low",
        score: 25,
        keywords: [
            "software engineer",
            "developer",
            "accountant",
            "qa engineer",
            "designer",
            "data analyst"
        ]
    }

];

function classifyHiringInfluence(profile) {

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
        level: "Very Low",
        score: 10,
        confidence: 0.30,
        reason: "No hiring influence indicators found.",
        matches: [],
        total: 0
    };

    for (const rule of HIRING_RULES) {

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

        hiring_influence: best.level,

        hiring_influence_score: best.score,

        hiring_confidence: Number(
            best.confidence.toFixed(2)
        ),

        hiring_reason: best.reason,

        hiring_matches: best.matches

    };

}

module.exports = {
    classifyHiringInfluence
};