const {
    HUMAN_BEHAVIOR_CONFIG
} = require("./HumanBehaviorConfig");

function cleanName(value) {
    return (value || "")
        .replace(/\s+/g, " ")
        .trim();
}

function nameParts(value) {
    return cleanName(value)
        .split(" ")
        .map(part => part.trim())
        .filter(Boolean);
}

function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function makeStrategy(type, label, query) {
    return {
        type,
        label,
        query: cleanName(query)
    };
}

function buildPartialQuery(parts) {
    if (!parts.length) {
        return "";
    }

    const first = parts[0];
    const minLength = Math.min(first.length, 3);
    const length = Math.max(minLength, Math.min(first.length, randomInt(minLength, first.length)));

    return first.slice(0, length);
}

function buildSearchStrategies(fullName) {
    const parts = nameParts(fullName);
    const [first, middle, ...rest] = parts;
    const last = rest.length ? rest[rest.length - 1] : middle;
    const strategies = [
        makeStrategy("full_name", "full name", parts.join(" "))
    ];

    if (first && middle) {
        strategies.push(makeStrategy("first_middle", "first + middle name", `${first} ${middle}`));
    }

    if (first) {
        strategies.push(makeStrategy("first_name", "first name", first));
    }

    if (first && last && last !== first) {
        strategies.push(makeStrategy("first_last", "first + last name", `${first} ${last}`));
    }

    if (first) {
        strategies.push(makeStrategy("partial", "partial name", buildPartialQuery(parts)));
    }

    return strategies.filter(strategy => strategy.query);
}

function weightedChoice(items, getWeight) {
    const weightedItems = items
        .map(item => ({
            item,
            weight: Math.max(0, Number(getWeight(item)) || 0)
        }))
        .filter(entry => entry.weight > 0);
    const totalWeight = weightedItems.reduce((total, entry) => total + entry.weight, 0);

    if (!weightedItems.length || totalWeight <= 0) {
        return items[0];
    }

    let cursor = Math.random() * totalWeight;

    for (const entry of weightedItems) {
        cursor -= entry.weight;

        if (cursor <= 0) {
            return entry.item;
        }
    }

    return weightedItems[weightedItems.length - 1].item;
}

function chooseSearchStrategy(fullName, config = HUMAN_BEHAVIOR_CONFIG, options = {}) {
    const strategies = buildSearchStrategies(fullName);
    const avoidType = options.avoidType || "";
    const selectableStrategies = strategies.length > 1
        ? strategies.filter(strategy => strategy.type !== avoidType)
        : strategies;
    const selected = weightedChoice(
        selectableStrategies,
        strategy => config.searchStrategyWeights[strategy.type]
    );

    return selected || fullNameSearchStrategy(fullName);
}

function fullNameSearchStrategy(fullName) {
    return makeStrategy("full_name", "full name", cleanName(fullName));
}

module.exports = {
    buildSearchStrategies,
    chooseSearchStrategy,
    cleanName,
    fullNameSearchStrategy,
    nameParts,
    weightedChoice
};
