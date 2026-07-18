/**
 * ==========================================================
 * Warm Path Finder
 * Company Normalizer
 * ----------------------------------------------------------
 * Converts company names into a normalized form so that
 * equivalent legal names compare as the same company.
 * ==========================================================
 */
function normalizeCompany(company) {

    if (!company) {
        return "";
    }

    let normalized = company
        .toLowerCase()
        .replace(/^@+/, "")
        .replace(/&/g, " and ")
        .replace(/[.,]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

  const LEGAL_SUFFIXES = [

    " private limited",
    " private ltd",
    " pvt limited",
    " pvt ltd",
    " pvt",

    " limited",
    " ltd",

    " llc",
    " inc",

    " corporation",
    " corp",

    " company",

    " ab",
    " as",
    " oy",
    " bv",
    " gmbh",
    " plc"

];

let changed = true;

while (changed) {
    changed = false;

    for (const suffix of LEGAL_SUFFIXES) {

        if (normalized.endsWith(suffix)) {

            normalized = normalized.slice(
                0,
                -suffix.length
            ).trim();
            changed = true;

        }
    }
}

return normalized;

}

module.exports = {
    normalizeCompany
};
