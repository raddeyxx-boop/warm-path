function cleanText(value) {
    return (value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function uniqueValues(values) {
    const seen = new Set();
    const unique = [];

    for (const value of values) {
        const cleaned = cleanText(value);
        const key = cleaned.toLowerCase();

        if (!cleaned || seen.has(key)) {
            continue;
        }

        seen.add(key);
        unique.push(cleaned);
    }

    return unique;
}

module.exports = {
    cleanText,
    uniqueValues
};
