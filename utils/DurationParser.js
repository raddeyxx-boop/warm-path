const MONTHS = {
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12"
};

const EMPLOYMENT_LENGTH_PATTERN =
    "\\d+\\s+(?:yr|yrs|year|years|mo|mos|month|months)\\b" +
    "(?:\\s+\\d+\\s+(?:mo|mos|month|months)\\b)?";
const MONTH_TOKEN_PATTERN =
    "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|" +
    "jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|" +
    "nov(?:ember)?|dec(?:ember)?";
const CURRENT_TOKEN_PATTERN = "present|current(?:\\s+position)?|now|today";
const DATE_TOKEN_PATTERN =
    "(?:" +
    `(?:${MONTH_TOKEN_PATTERN})\\.?(?:\\s+|[-/])\\d{4}` +
    "|\\d{4}" +
    `|${CURRENT_TOKEN_PATTERN}` +
    ")";
const DATE_RANGE_PATTERN = new RegExp(
    `^\\s*(${DATE_TOKEN_PATTERN})\\s*(?:-|\\u2013|\\u2014|\\bto\\b)\\s*(${DATE_TOKEN_PATTERN})\\b`,
    "i"
);
const DATE_LIKE_PATTERN = new RegExp(DATE_TOKEN_PATTERN, "i");
const IGNORABLE_DURATION_LINE_PATTERN = new RegExp(
    `^(?:full-time|part-time|contract|internship|freelance|self-employed|temporary|apprenticeship|on-site|hybrid|remote|${EMPLOYMENT_LENGTH_PATTERN})$`,
    "i"
);

function cleanText(value) {
    return (value || "")
        .toString()
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function isCurrentEndDate(value) {
    return new RegExp(`^(?:${CURRENT_TOKEN_PATTERN})$`, "i").test(cleanText(value));
}

function currentMonthValue(now = new Date()) {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function parseMonthYear(value) {
    const text = cleanText(value)
        .replace(/\.$/, "")
        .toLowerCase();

    if (!text || isCurrentEndDate(text)) {
        return null;
    }

    if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(text)) {
        return text;
    }

    const monthYear = text.match(
        new RegExp(`^(${MONTH_TOKEN_PATTERN})\\.?(?:\\s+|[-/])(\\d{4})$`, "i")
    );

    if (monthYear) {
        const monthKey = monthYear[1].replace(/\.$/, "").toLowerCase();
        const month = MONTHS[monthKey] || MONTHS[monthKey.substring(0, 3)];

        return month ? `${monthYear[2]}-${month}` : null;
    }

    const yearOnly = text.match(/^(\d{4})$/);

    if (yearOnly) {
        return `${yearOnly[1]}-01`;
    }

    return null;
}

function normalizeDateValue(value) {
    const text = cleanText(value);

    if (!text || isCurrentEndDate(text)) {
        return null;
    }

    return parseMonthYear(text);
}

function cleanDurationText(value) {
    const text = cleanText(value)
        .replace(/(?:\u00c3\u201a\u00c2\u00b7|\u00c2\u00b7)/g, "\u00b7")
        .replace(/\s*(?:\u2013|\u2014)\s*/g, " - ");
    const range = text.match(DATE_RANGE_PATTERN);

    if (range) {
        return `${cleanText(range[1])} - ${cleanText(range[2])}`;
    }

    return text
        .replace(
            new RegExp(`\\s*(?:[\\u00b7\\u2022]|\\?)\\s*${EMPLOYMENT_LENGTH_PATTERN}\\s*$`, "i"),
            ""
        )
        .replace(/\s+(?:full-time|part-time|contract|freelance|internship|temporary|apprenticeship|self-employed)$/i, "")
        .trim();
}

function isIgnorableDurationLine(value) {
    return IGNORABLE_DURATION_LINE_PATTERN.test(cleanText(value));
}

function logDurationParseFailure(original, cleaned, error) {
    console.warn("[duration-parser] failed to parse duration", {
        original,
        cleaned,
        error
    });
}

function normalizeDurationObject(value) {
    const endText = cleanText(value?.end);
    const currentlyWorking = value?.currently_working === true ||
        isCurrentEndDate(endText);
    const start = normalizeDateValue(value?.start);
    const end = currentlyWorking ? null : normalizeDateValue(value?.end);

    if (value?.start && !start) {
        logDurationParseFailure(value, value?.start, "Unable to normalize object start date.");
    }

    if (currentlyWorking && !start) {
        logDurationParseFailure(value, value?.start, "Current duration object is missing a parsed start date.");
    }

    if (value?.end && !currentlyWorking && !end) {
        logDurationParseFailure(value, value?.end, "Unable to normalize object end date.");
    }

    return {
        start,
        end,
        currently_working: Boolean(currentlyWorking)
    };
}

function parseDurationRange(value) {
    if (value && typeof value === "object") {
        return normalizeDurationObject(value);
    }

    const original = cleanText(value);
    const text = cleanDurationText(original);

    if (!text || isIgnorableDurationLine(text)) {
        return {
            start: null,
            end: null,
            currently_working: false
        };
    }

    const range = text.match(DATE_RANGE_PATTERN);
    const startText = range ? range[1] : text;
    const endText = range ? range[2] : "";
    const start = parseMonthYear(startText);
    const currentlyWorking = isCurrentEndDate(endText);
    const end = currentlyWorking ? null : parseMonthYear(endText);

    if (!start && DATE_LIKE_PATTERN.test(text)) {
        logDurationParseFailure(original, text, "Unable to parse start date.");
    }

    if (start && endText && !currentlyWorking && !end && DATE_LIKE_PATTERN.test(endText)) {
        logDurationParseFailure(original, text, "Unable to parse end date.");
    }

    return {
        start,
        end,
        currently_working: Boolean(start && currentlyWorking)
    };
}

function monthDiff(startDate, endDate) {
    return ((endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12) +
        (endDate.getUTCMonth() - startDate.getUTCMonth());
}

function yearsFromDuration(duration, now = new Date()) {
    const parsedDuration = parseDurationRange(duration || {});

    if (!parsedDuration.start) {
        return 0;
    }

    const endValue = parsedDuration.end || currentMonthValue(now);
    const start = new Date(`${parsedDuration.start}-01T00:00:00Z`);
    const end = new Date(`${endValue}-01T00:00:00Z`);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return 0;
    }

    return Math.round((Math.max(0, monthDiff(start, end)) / 12) * 10) / 10;
}

module.exports = {
    parseMonthYear,
    isCurrentEndDate,
    currentMonthValue,
    cleanDurationText,
    isIgnorableDurationLine,
    parseDurationRange,
    yearsFromDuration
};
