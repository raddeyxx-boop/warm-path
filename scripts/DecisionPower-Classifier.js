/**
 * ==========================================================
 * Warm Path Finder
 * Decision Power Classifier
 * ----------------------------------------------------------
 * Determines how much authority a professional has to make
 * hiring, technical or business decisions.
 * ==========================================================
 */

const DECISION_RULES = [

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
            "chief",
            "owner",
            "president"
        ]
    },

    /* ===========================
       High
    =========================== */

    {
        level: "High",
        score: 80,
        keywords: [
            "vice president",
            "vp",
            "director",
            "head of",
            "engineering manager",
            "product manager",
            "hr manager",
            "operations manager",
            "finance manager"
        ]
    },

    /* ===========================
       Medium
    =========================== */

    {
        level: "Medium",
        score: 55,
        keywords: [
            "manager",
            "team lead",
            "technical lead",
            "lead engineer",
            "lead developer",
            "project manager",
            "senior manager"
        ]
    },

    /* ===========================
       Low
    =========================== */

    {
        level: "Low",
        score: 20,
        keywords: [
            "software engineer",
            "developer",
            "accountant",
            "qa engineer",
            "designer",
            "analyst",
            "specialist"
        ]
    },

    /* ===========================
       Very Low
    =========================== */

    {
        level: "Very Low",
        score: 5,
        keywords: [
            "intern",
            "trainee",
            "graduate",
            "assistant"
        ]
    }

];

function classifyDecisionPower(profile) {

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
        score: 5,
        confidence: 0.30,
        reason: "No decision authority indicators found.",
        matches: [],
        total: 0
    };

    for (const rule of DECISION_RULES) {

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

                confidence: Math.min(
                    0.99,
                    0.60 + total / 250
                ),

                reason: matches.length
                    ? `Matched "${matches[0]}"`
                    : "Rule matched",

                matches,

                total

            };

        }

    }

    return {

        ...profile,

        decision_power: best.level,

        decision_power_score: best.score,

        decision_power_confidence: Number(
            best.confidence.toFixed(2)
        ),

        decision_reason: best.reason,

        decision_matches: best.matches

    };

}

module.exports = {
    classifyDecisionPower
};