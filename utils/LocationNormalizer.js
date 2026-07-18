const { getLinkedInAreaMapping } = require("./LinkedInLocationAreas");

const COUNTRY_ALIASES = {
    india: "india",
    bharat: "india",
    usa: "united states",
    us: "united states",
    "u s": "united states",
    "u s a": "united states",
    "united states of america": "united states",
    uk: "united kingdom",
    "u k": "united kingdom",
    england: "united kingdom",
    sweden: "sweden",
    sverige: "sweden",
    germany: "germany",
    deutschland: "germany",
    canada: "canada",
    australia: "australia",
    singapore: "singapore",
    france: "france",
    netherlands: "netherlands",
    ireland: "ireland"
};

function cleanLocation(value) {
    return (value || "")
        .toString()
        .toLowerCase()
        .replace(/\u00a0/g, " ")
        .replace(/[()]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeCountry(value) {
    const cleaned = cleanLocation(value).replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

    return COUNTRY_ALIASES[cleaned] || cleaned || null;
}

function normalizeLocationPart(value) {
    const cleaned = cleanLocation(value)
        .replace(/[^a-z0-9\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    return cleaned || null;
}

function buildLocationObject(rawValue, city, state, country, region) {
    const normalizedCity = normalizeLocationPart(city);
    const normalizedState = normalizeLocationPart(state);
    const normalizedCountry = normalizeCountry(country);
    const normalizedRegion = normalizeLocationPart(region);

    return {
        raw: (rawValue || "").toString().trim(),
        city: normalizedCity,
        state: normalizedState,
        country: normalizedCountry,
        region: normalizedRegion,
        normalized: [normalizedCity, normalizedState, normalizedCountry]
            .filter(Boolean)
            .join(", ")
    };
}

function parseLocation(value) {
    const cleaned = cleanLocation(value);

    if (!cleaned) {
        return buildLocationObject(value, null, null, null, null);
    }

    const linkedInArea = getLinkedInAreaMapping(cleaned);

    if (linkedInArea) {
        return buildLocationObject(
            value,
            linkedInArea.city,
            linkedInArea.state,
            linkedInArea.country,
            linkedInArea.region
        );
    }

    const parts = cleaned
        .split(",")
        .map(normalizeLocationPart)
        .filter(Boolean);
    const country = parts.length > 0
        ? parts[parts.length - 1]
        : null;
    const city = parts[0] || "";
    const state = parts.length > 2
        ? parts[parts.length - 2]
        : null;

    return buildLocationObject(value, city, state, country, null);
}

function normalizeLocation(value) {
    return parseLocation(value).normalized;
}

function compareLocations(candidate, target) {
    const candidateLocation = parseLocation(candidate);
    const targetLocation = parseLocation(target);
    const sameCity = Boolean(
        candidateLocation.city &&
        targetLocation.city &&
        candidateLocation.city === targetLocation.city
    );
    const sameState = Boolean(
        candidateLocation.state &&
        targetLocation.state &&
        candidateLocation.state === targetLocation.state
    );
    const sameCountry = Boolean(
        candidateLocation.country &&
        targetLocation.country &&
        candidateLocation.country === targetLocation.country
    );

    return {
        same_city: sameCity,
        same_state: sameState,
        same_country: sameCountry,
        same_location: sameCity || sameState || sameCountry,
        candidate: candidateLocation,
        target: targetLocation
    };
}

module.exports = {
    normalizeLocation,
    parseLocation,
    compareLocations
};
