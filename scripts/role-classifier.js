/**
 * ==========================================================
 * Warm Path Finder
 * Role Classifier v3
 * ----------------------------------------------------------
 * Purpose:
 * Classify LinkedIn profiles into professional departments
 * using deterministic keyword rules.
 *
 * Works in:
 * - Node.js scripts: require("./role-classifier")
 * - CLI: node scripts/role-classifier.js
 * - n8n Code node: paste this full file; it detects $input safely
 *
 * Outputs:
 * - role
 * - role_confidence
 * - role_reason
 * - role_matches
 * ==========================================================
 */

const DEFAULT_ROLE = "Other";

const ROLE_RULES = [
    {
        role: "Executive",
        priority: 100,
        confidence: 0.96,
        keywords: [
            "founder",
            "co founder",
            "co-founder",
            "chief executive officer",
            "chief technology officer",
            "chief operating officer",
            "chief financial officer",
            "chief people officer",
            "chief marketing officer",
            "chief revenue officer",
            "chief product officer",
            "ceo",
            "cto",
            "coo",
            "cfo",
            "cpo",
            "cmo",
            "cro",
            "president",
            "vice president",
            "vp",
            "board member",
            "managing director"
        ]
    },
    {
        role: "Management",
        priority: 94,
        confidence: 0.92,
        keywords: [
            "general manager",
            "engineering manager",
            "delivery manager",
            "program manager",
            "project manager",
            "people manager",
            "team manager",
            "manager",
            "head of",
            "department head",
            "team lead",
            "technical lead",
            "tech lead",
            "lead engineer",
            "lead developer",
            "practice lead"
        ]
    },
    {
        role: "HR",
        priority: 92,
        confidence: 0.94,
        keywords: [
            "human resources",
            "hr business partner",
            "hrbp",
            "hr executive",
            "hr manager",
            "hr specialist",
            "hr generalist",
            "recruiter",
            "technical recruiter",
            "talent acquisition",
            "talent partner",
            "people operations",
            "people partner",
            "people success",
            "employee relations",
            "learning and development",
            "l&d"
        ]
    },
    {
        role: "Business Development",
        priority: 91,
        confidence: 0.94,
        keywords: [
            "business development",
            "business developer",
            "business development executive",
            "business development manager",
            "business development representative",
            "business development associate",
            "business development specialist",
            "bde",
            "bdm",
            "partnerships",
            "strategic alliances",
            "sales development"
        ]
    },
    {
        role: "Finance",
        priority: 90,
        confidence: 0.94,
        keywords: [
            "accountant",
            "accounts executive",
            "accounts manager",
            "accounting",
            "finance",
            "financial analyst",
            "finance analyst",
            "auditor",
            "internal audit",
            "payroll",
            "gst",
            "tds",
            "tax",
            "treasury",
            "controller",
            "bookkeeper",
            "mis report",
            "form 16"
        ]
    },
    {
        role: "Product",
        priority: 88,
        confidence: 0.91,
        keywords: [
            "product manager",
            "product owner",
            "associate product manager",
            "product analyst",
            "product strategy",
            "product operations",
            "scrum master",
            "business analyst"
        ]
    },
    {
        role: "Engineering",
        priority: 86,
        confidence: 0.93,
        keywords: [
            "software engineer",
            "software developer",
            "junior software engineer",
            "senior software engineer",
            "programmer analyst",
            "application developer",
            "developer",
            "full stack",
            "full-stack",
            "frontend",
            "front end",
            "backend",
            "back end",
            "web developer",
            "mobile developer",
            "android developer",
            "ios developer",
            "react developer",
            "angular developer",
            "node.js",
            "node js",
            "mern",
            "mean",
            "devops",
            "cloud engineer",
            "platform engineer",
            "site reliability",
            "sre",
            "solutions architect",
            "software architect"
        ]
    },
    {
        role: "QA",
        priority: 85,
        confidence: 0.93,
        keywords: [
            "quality assurance",
            "qa engineer",
            "software qa",
            "qa analyst",
            "manual testing",
            "automation testing",
            "automation tester",
            "test engineer",
            "tester",
            "sdet",
            "playwright automation",
            "selenium",
            "stlc",
            "test case",
            "defect tracking"
        ]
    },
    {
        role: "Data",
        priority: 84,
        confidence: 0.92,
        keywords: [
            "data scientist",
            "data engineer",
            "data analyst",
            "analytics engineer",
            "machine learning",
            "ml engineer",
            "ai engineer",
            "artificial intelligence",
            "business intelligence",
            "bi developer",
            "power bi",
            "tableau",
            "data visualization",
            "data science"
        ]
    },
    {
        role: "Design",
        priority: 82,
        confidence: 0.9,
        keywords: [
            "ux designer",
            "ui designer",
            "ui ux",
            "ui/ux",
            "product designer",
            "graphic designer",
            "visual designer",
            "brand designer",
            "creative designer",
            "interaction designer",
            "designer",
            "figma"
        ]
    },
    {
        role: "Sales",
        priority: 80,
        confidence: 0.9,
        keywords: [
            "sales executive",
            "sales manager",
            "sales representative",
            "sales development",
            "bde",
            "bdm",
            "account executive",
            "account manager",
            "key account",
            "inside sales",
            "enterprise sales",
            "revenue",
            "partnerships",
            "sales"
        ]
    },
    {
        role: "Marketing",
        priority: 78,
        confidence: 0.9,
        keywords: [
            "digital marketing",
            "content marketing",
            "growth marketing",
            "performance marketing",
            "brand manager",
            "marketing manager",
            "marketing executive",
            "seo",
            "sem",
            "social media",
            "copywriter",
            "content writer",
            "campaign manager",
            "marketing"
        ]
    },
    {
        role: "Operations",
        priority: 76,
        confidence: 0.88,
        keywords: [
            "operations manager",
            "operation executive",
            "operations executive",
            "business operations",
            "administration",
            "administrator",
            "office manager",
            "facility manager",
            "process coordinator",
            "operations"
        ]
    },
    {
        role: "Customer Success",
        priority: 74,
        confidence: 0.88,
        keywords: [
            "customer success",
            "customer support",
            "client success",
            "client support",
            "support engineer",
            "technical support",
            "service desk",
            "help desk",
            "customer experience",
            "customer service"
        ]
    },
    {
        role: "Procurement",
        priority: 72,
        confidence: 0.86,
        keywords: [
            "procurement",
            "purchasing",
            "sourcing specialist",
            "strategic sourcing",
            "vendor management",
            "buyer",
            "purchase executive"
        ]
    },
    {
        role: "Supply Chain",
        priority: 70,
        confidence: 0.86,
        keywords: [
            "logistics",
            "supply chain",
            "warehouse",
            "inventory",
            "shipping",
            "dispatch",
            "transportation",
            "fleet"
        ]
    },
    {
        role: "Legal",
        priority: 68,
        confidence: 0.86,
        keywords: [
            "legal counsel",
            "legal advisor",
            "legal associate",
            "lawyer",
            "attorney",
            "compliance officer",
            "compliance manager",
            "contract management",
            "legal",
            "compliance"
        ]
    },
    {
        role: "Research",
        priority: 66,
        confidence: 0.84,
        keywords: [
            "research engineer",
            "research scientist",
            "research associate",
            "research analyst",
            "scientist",
            "r&d",
            "research"
        ]
    },
    {
        role: "Education",
        priority: 64,
        confidence: 0.84,
        keywords: [
            "teacher",
            "lecturer",
            "professor",
            "assistant professor",
            "instructor",
            "trainer",
            "corporate trainer",
            "faculty",
            "educator"
        ]
    },
    {
        role: "Student",
        priority: 40,
        confidence: 0.7,
        keywords: [
            "student",
            "intern",
            "trainee",
            "graduate",
            "fresher",
            "looking for opportunities"
        ]
    }
];

const SOURCE_WEIGHTS = {
    position: 3.4,
    headline: 2.6,
    experience_titles: 2.2,
    skills: 1.6,
    about: 1.0,
    current_company: 0.2,
    company: 0.2
};

const ROLE_TIE_BREAKERS = [
    "Executive",
    "Business Development",
    "HR",
    "Finance",
    "Product",
    "QA",
    "Engineering",
    "Data",
    "Design",
    "Sales",
    "Marketing",
    "Management",
    "Operations",
    "Customer Success",
    "Procurement",
    "Supply Chain",
    "Legal",
    "Research",
    "Education",
    "Student",
    DEFAULT_ROLE
];

const NEGATIVE_PATTERNS = [
    /\blooking for\s+(?:a\s+)?(?:software|qa|data|sales|marketing|hr)\s+(?:role|job|opportunit)/i,
    /\bhiring\s+(?:software|qa|data|sales|marketing|hr)\b/i,
    /\brecruiting\s+(?:software|qa|data|sales|marketing|hr)\b/i
];

function cleanText(value) {
    return String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/[â€™]/g, "'")
        .replace(/[â€“â€”]/g, "-")
        .replace(/[•·]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeForMatch(value) {
    return cleanText(value)
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[|/()[\]{}:;,]+/g, " ")
        .replace(/[^\w.+#' -]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordRegex(keyword) {
    const normalized = normalizeForMatch(keyword);
    const flexible = escapeRegExp(normalized).replace(/\s+/g, "[\\s-]+");

    return new RegExp("(^|[^a-z0-9+#])" + flexible + "($|[^a-z0-9+#])", "i");
}

function buildSources(profile) {
    const experienceTitles = Array.isArray(profile.experience)
        ? profile.experience
            .map(item => cleanText(item && item.title))
            .filter(Boolean)
            .join(" ")
        : "";

    const skills = Array.isArray(profile.skills)
        ? profile.skills.map(cleanText).filter(Boolean).join(" ")
        : cleanText(profile.skills);

    return [
        { name: "position", text: cleanText(profile.position), weight: SOURCE_WEIGHTS.position },
        { name: "headline", text: cleanText(profile.headline), weight: SOURCE_WEIGHTS.headline },
        { name: "experience_titles", text: experienceTitles, weight: SOURCE_WEIGHTS.experience_titles },
        { name: "skills", text: skills, weight: SOURCE_WEIGHTS.skills },
        { name: "about", text: cleanText(profile.about), weight: SOURCE_WEIGHTS.about },
        { name: "current_company", text: cleanText(profile.current_company), weight: SOURCE_WEIGHTS.current_company },
        { name: "company", text: cleanText(profile.company), weight: SOURCE_WEIGHTS.company }
    ].filter(source => source.text);
}

function isNegativeContext(sourceText, keyword) {
    const normalized = normalizeForMatch(sourceText);

    if (!NEGATIVE_PATTERNS.some(pattern => pattern.test(normalized))) {
        return false;
    }

    return keywordRegex(keyword).test(normalized);
}

function getTieBreakerRank(role) {
    const index = ROLE_TIE_BREAKERS.indexOf(role);

    return index >= 0 ? index : ROLE_TIE_BREAKERS.length;
}

function scoreMatch(rule, keyword, source) {
    const keywordBonus = Math.min(normalizeForMatch(keyword).length / 60, 0.45);

    return rule.priority + source.weight + keywordBonus;
}

function compareMatches(a, b) {
    if (a.score !== b.score) {
        return b.score - a.score;
    }

    if (a.rule.priority !== b.rule.priority) {
        return b.rule.priority - a.rule.priority;
    }

    return getTieBreakerRank(a.rule.role) - getTieBreakerRank(b.rule.role);
}

function roleEvidenceScore(roleMatches) {
    if (!roleMatches.length) {
        return 0;
    }

    const sourceDiversity = new Set(roleMatches.map(match => match.source)).size;
    const keywordDiversity = new Set(roleMatches.map(match => match.keyword)).size;
    const topScore = roleMatches[0].score;
    const supportScore = Math.min(
        (roleMatches.length - 1) * 1.5 +
        sourceDiversity * 1.3 +
        keywordDiversity * 0.7,
        10
    );

    return topScore + supportScore;
}

function bestRoleFromMatches(matches) {
    const grouped = new Map();

    for (const match of matches) {
        if (!grouped.has(match.role)) {
            grouped.set(match.role, []);
        }

        grouped.get(match.role).push(match);
    }

    return [...grouped.entries()]
        .map(([role, roleMatches]) => ({
            role,
            matches: roleMatches.sort(compareMatches),
            score: roleEvidenceScore(roleMatches)
        }))
        .sort((a, b) => {
            if (a.score !== b.score) {
                return b.score - a.score;
            }

            return getTieBreakerRank(a.role) - getTieBreakerRank(b.role);
        })[0];
}

function findMatches(profile) {
    const sources = buildSources(profile || {});
    const matches = [];

    for (const rule of ROLE_RULES) {
        for (const keyword of rule.keywords) {
            const pattern = keywordRegex(keyword);

            for (const source of sources) {
                const normalizedSource = normalizeForMatch(source.text);

                if (!pattern.test(normalizedSource)) {
                    continue;
                }

                if (isNegativeContext(source.text, keyword)) {
                    continue;
                }

                matches.push({
                    role: rule.role,
                    keyword,
                    source: source.name,
                    score: scoreMatch(rule, keyword, source),
                    rule
                });
            }
        }
    }

    return matches.sort(compareMatches);
}

function confidenceFromMatch(match, allMatches) {
    if (!match) {
        return 0.3;
    }

    const sameRoleMatches = allMatches.filter(item => item.role === match.role);
    const sourceDiversity = new Set(sameRoleMatches.map(item => item.source)).size;
    const keywordDiversity = new Set(sameRoleMatches.map(item => item.keyword)).size;
    const supportBonus = Math.min(
        (sourceDiversity - 1) * 0.025 + (keywordDiversity - 1) * 0.015,
        0.08
    );

    return Math.min(0.99, Number((match.rule.confidence + supportBonus).toFixed(2)));
}

function classifyRole(profile) {
    const matches = findMatches(profile || {});
    const roleEvidence = bestRoleFromMatches(matches);
    const best = roleEvidence && roleEvidence.matches[0];

    if (!best) {
        return {
            role: DEFAULT_ROLE,
            role_confidence: 0.3,
            role_reason: "No matching keyword found",
            role_matches: []
        };
    }

    return {
        role: roleEvidence.role,
        role_confidence: confidenceFromMatch(best, matches),
        role_reason: 'Matched "' + best.keyword + '" in ' + best.source,
        role_matches: roleEvidence.matches
            .slice(0, 5)
            .map(match => match.keyword + " in " + match.source)
    };
}

function classifyProfile(profile) {
    return {
        ...(profile || {}),
        ...classifyRole(profile || {})
    };
}

function classifyProfiles(profiles) {
    if (!Array.isArray(profiles)) {
        return [];
    }

    return profiles.map(classifyProfile);
}

function classifyN8nItems(items) {
    return (Array.isArray(items) ? items : []).map(item => ({
        json: classifyProfile(item && item.json ? item.json : item)
    }));
}

async function runCli() {
    const fs = require("fs");
    const path = require("path");
    const {
        writeJsonAtomicSync
    } = require("../utils/JsonFileStore");
    const {
        serializeFinalProfiles,
        validateClassifiedCandidates
    } = require("../utils/FinalProfileSerializer");
    const inputPath = path.resolve(process.argv[2] || path.join("data", "mutual-details.json"));
    const outputPath = path.resolve(process.argv[3] || path.join("data", "mutual-details-classified.json"));

    if (!fs.existsSync(inputPath)) {
        throw new Error("Input file not found: " + inputPath);
    }

    const profiles = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    const classified = serializeFinalProfiles(classifyProfiles(profiles));

    validateClassifiedCandidates(classified);
    writeJsonAtomicSync(outputPath, classified);
    console.log("Classified " + classified.length + " profile(s).");
    console.log("Saved: " + path.relative(process.cwd(), outputPath));
}

if (typeof $input !== "undefined" && $input && typeof $input.all === "function") {
    module.exports = classifyN8nItems($input.all());
} else if (require.main === module) {
    runCli().catch(err => {
        console.error("Role classifier failed:", err.message);
        process.exitCode = 1;
    });
} else {
    module.exports = {
        ROLE_RULES,
        classifyRole,
        classifyProfile,
        classifyProfiles,
        classifyN8nItems
    };
}
