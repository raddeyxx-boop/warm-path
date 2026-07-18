function parseBoolean(value, fallback) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }

    return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function parseInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);

    return Number.isFinite(parsed) ? parsed : fallback;
}

function randomInteger(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function parseProbability(value, fallback) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }

    const raw = String(value).trim();
    const parsed = raw.endsWith("%")
        ? Number.parseFloat(raw.slice(0, -1)) / 100
        : Number.parseFloat(raw);

    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(0, Math.min(1, parsed));
}

function parseSearchWeights(value, fallback) {
    if (!value) {
        return fallback;
    }

    try {
        return {
            ...fallback,
            ...JSON.parse(value)
        };
    } catch (err) {
        console.log("Warning: invalid SEARCH_STRATEGY_WEIGHTS. Using defaults.");
        return fallback;
    }
}

const DEFAULT_SEARCH_STRATEGY_WEIGHTS = {
    full_name: 25,
    first_middle: 20,
    first_name: 20,
    first_last: 20,
    partial: 15
};

const HUMAN_BEHAVIOR_CONFIG = {
    enableHumanActivity: parseBoolean(process.env.ENABLE_HUMAN_ACTIVITY, true),
    enableInitialHomeBrowsing: parseBoolean(process.env.ENABLE_INITIAL_HOME_BROWSING, true),
    initialHomeBrowsingDurationMs: parseInteger(
        process.env.INITIAL_HOME_BROWSING_DURATION,
        randomInteger(20000, 45000)
    ),
    minProfilesBeforeBreak: parseInteger(process.env.MIN_PROFILES_BEFORE_BREAK, 2),
    maxProfilesBeforeBreak: parseInteger(process.env.MAX_PROFILES_BEFORE_BREAK, 18),
    minSearchDelayMs: parseInteger(process.env.MIN_SEARCH_DELAY, 800),
    maxSearchDelayMs: parseInteger(process.env.MAX_SEARCH_DELAY, 2200),
    minSuggestionDelayMs: parseInteger(process.env.MIN_SUGGESTION_DELAY, 1000),
    maxSuggestionDelayMs: parseInteger(process.env.MAX_SUGGESTION_DELAY, 2500),
    minHomeBreakDurationMs: parseInteger(process.env.MIN_HOME_BREAK_DURATION, 20000),
    maxHomeBreakDurationMs: parseInteger(process.env.MAX_HOME_BREAK_DURATION, 60000),
    homeScrollDurationMs: parseInteger(process.env.HOME_SCROLL_DURATION, 30000),
    likeProbability: parseProbability(process.env.LIKE_PROBABILITY, 0.25),
    commentProbability: parseProbability(process.env.COMMENT_PROBABILITY, 1),
    profileVerificationThreshold: parseInteger(process.env.PROFILE_VERIFICATION_THRESHOLD, 95),
    recentCommentWindow: parseInteger(process.env.RECENT_COMMENT_WINDOW, 20),
    searchStrategyWeights: parseSearchWeights(
        process.env.SEARCH_STRATEGY_WEIGHTS,
        DEFAULT_SEARCH_STRATEGY_WEIGHTS
    )
};

if (HUMAN_BEHAVIOR_CONFIG.maxProfilesBeforeBreak < HUMAN_BEHAVIOR_CONFIG.minProfilesBeforeBreak) {
    HUMAN_BEHAVIOR_CONFIG.maxProfilesBeforeBreak = HUMAN_BEHAVIOR_CONFIG.minProfilesBeforeBreak;
}

if (HUMAN_BEHAVIOR_CONFIG.maxSearchDelayMs < HUMAN_BEHAVIOR_CONFIG.minSearchDelayMs) {
    HUMAN_BEHAVIOR_CONFIG.maxSearchDelayMs = HUMAN_BEHAVIOR_CONFIG.minSearchDelayMs;
}

if (HUMAN_BEHAVIOR_CONFIG.maxSuggestionDelayMs < HUMAN_BEHAVIOR_CONFIG.minSuggestionDelayMs) {
    HUMAN_BEHAVIOR_CONFIG.maxSuggestionDelayMs = HUMAN_BEHAVIOR_CONFIG.minSuggestionDelayMs;
}

if (HUMAN_BEHAVIOR_CONFIG.maxHomeBreakDurationMs < HUMAN_BEHAVIOR_CONFIG.minHomeBreakDurationMs) {
    HUMAN_BEHAVIOR_CONFIG.maxHomeBreakDurationMs = HUMAN_BEHAVIOR_CONFIG.minHomeBreakDurationMs;
}

module.exports = {
    DEFAULT_SEARCH_STRATEGY_WEIGHTS,
    HUMAN_BEHAVIOR_CONFIG,
    parseBoolean,
    parseInteger,
    parseProbability,
    parseSearchWeights,
    randomInteger
};
