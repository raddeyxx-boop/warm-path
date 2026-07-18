const fs = require("fs");
const path = require("path");

const {
    extractFeatures
} = require("./FeatureExtractor");

const {
    buildRelationshipEvidence
} = require("./Relationship-Evidence");

const {
    classifyProfile
} = require("./role-classifier");

const {
    classifySeniority
} = require("./Seniority-Classifier");

const {
    classifyDecisionPower
} = require("./DecisionPower-Classifier");

const {
    classifyHiringInfluence
} = require("./HiringInfluence-Classifier");

const {
    serializeFinalProfile
} = require("../utils/FinalProfileSerializer");
const {
    writeJsonAtomicSync
} = require("../utils/JsonFileStore");

const DATA_DIR = path.resolve(process.env.WARM_PATH_RUN_DIR || path.join(__dirname, "..", "data"));
const INPUT_PATH = path.join(DATA_DIR, "mutual-details.json");

const OUTPUT_PATH = path.join(DATA_DIR, "mutual-details-classified.json");

const TARGET_PATH = path.join(DATA_DIR, "target.json");



function classifyPipeline(profile, target) {

    let result = extractFeatures(profile);
    result = buildRelationshipEvidence(
    result,
    target
);

    result = classifyProfile(result);

    result = classifySeniority(result);

    result = classifyDecisionPower(result);

    result = classifyHiringInfluence(result);

    return serializeFinalProfile(result);

}

function normalizeProfileUrl(value) {
    try {
        const url = new URL(value || "", "https://www.linkedin.com");
        const match = url.pathname.match(/^\/in\/[^/]+\/?/i);

        if (!match) {
            return "";
        }

        return "https://www.linkedin.com" + match[0].replace(/\/?$/, "/");
    } catch (err) {
        return "";
    }
}

function dedupeProfiles(profiles) {
    const uniqueProfiles = new Map();

    for (const profile of profiles) {
        const normalizedUrl = normalizeProfileUrl(profile?.linkedin_url);

        if (!normalizedUrl) {
            continue;
        }

        uniqueProfiles.set(normalizedUrl, {
            ...profile,
            linkedin_url: normalizedUrl
        });
    }

    return [...uniqueProfiles.values()];
}

async function main() {

    if (!fs.existsSync(INPUT_PATH)) {
        throw new Error(
            "Input file not found: " + INPUT_PATH
        );
    }

    const profiles = JSON.parse(
        fs.readFileSync(INPUT_PATH, "utf8")
    );
    const target = JSON.parse(
    fs.readFileSync(TARGET_PATH, "utf8")
);

    if (!Array.isArray(profiles)) {
        throw new Error(
            "Input file must contain an array."
        );
    }

    if (!target || typeof target !== "object") {
        throw new Error("target.json must contain an object.");
    }

const dedupedProfiles = dedupeProfiles(profiles);
const classifiedProfiles = dedupedProfiles.map(profile =>
    classifyPipeline(profile, target)
);

writeJsonAtomicSync(OUTPUT_PATH, classifiedProfiles);

console.log(
    "Classified",
    classifiedProfiles.length,
    "profile(s)."
);

console.log(
    "Saved:",
    path.relative(process.cwd(), OUTPUT_PATH)
);

}

module.exports = {
    classifyPipeline,
    dedupeProfiles,
    normalizeProfileUrl
};
if (require.main === module) {
    main().catch(err => {
        console.error("Classification pipeline failed:");
       console.error(err);
        process.exitCode = 1;
    });
}
