function cleanText(value) {
    return String(value ?? "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeNumericField(value) {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === "number") {
        return Number.isFinite(value) ? Math.round(value) : null;
    }

    const text = cleanText(value).toLowerCase();

    if (!text) {
        return null;
    }

    const match = text.match(/([\d,.]+)\s*([km])?\+?/i);

    if (!match) {
        return null;
    }

    let count = Number(match[1].replace(/,/g, ""));

    if (!Number.isFinite(count)) {
        return null;
    }

    if (match[2] === "k") {
        count *= 1000;
    }

    if (match[2] === "m") {
        count *= 1000000;
    }

    return Math.round(count);
}

function isNullableNumber(value) {
    return value === null || (typeof value === "number" && Number.isFinite(value));
}

module.exports = {
    normalizeNumericField,
    isNullableNumber
};
