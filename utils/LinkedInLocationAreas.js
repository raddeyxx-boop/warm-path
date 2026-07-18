const LINKEDIN_AREA_MAPPINGS = [
    {
        region: "greater bengaluru area",
        aliases: ["bengaluru metropolitan area", "greater bengaluru metropolitan area"],
        city: "bengaluru",
        state: "karnataka",
        country: "india"
    },
    {
        region: "greater chennai area",
        aliases: ["chennai metropolitan area", "greater chennai metropolitan area"],
        city: "chennai",
        state: "tamil nadu",
        country: "india"
    },
    {
        region: "greater hyderabad area",
        aliases: ["hyderabad metropolitan area", "greater hyderabad metropolitan area"],
        city: "hyderabad",
        state: "telangana",
        country: "india"
    },
    {
        region: "greater delhi area",
        aliases: ["delhi metropolitan area", "new delhi area", "new delhi metropolitan area"],
        city: "new delhi",
        state: "delhi",
        country: "india"
    },
    {
        region: "san francisco bay area",
        aliases: ["sf bay area", "greater san francisco bay area", "san francisco metropolitan area"],
        city: "san francisco",
        state: "california",
        country: "united states"
    },
    {
        region: "greater stockholm area",
        aliases: ["stockholm metropolitan area", "greater stockholm metropolitan area"],
        city: "stockholm",
        state: null,
        country: "sweden"
    },
    {
        region: "greater london area",
        aliases: ["london metropolitan area", "greater london metropolitan area"],
        city: "london",
        state: "england",
        country: "united kingdom"
    },
    {
        region: "new york city metropolitan area",
        aliases: ["greater new york city area", "greater new york area", "new york metropolitan area"],
        city: "new york",
        state: "new york",
        country: "united states"
    }
];

const LINKEDIN_AREA_LOOKUP = LINKEDIN_AREA_MAPPINGS.reduce((lookup, mapping) => {
    const aliases = [mapping.region, ...(mapping.aliases || [])];

    aliases.forEach(alias => {
        lookup[alias] = mapping;
    });

    return lookup;
}, {});

function getLinkedInAreaMapping(value) {
    return LINKEDIN_AREA_LOOKUP[value] || null;
}

module.exports = {
    LINKEDIN_AREA_MAPPINGS,
    getLinkedInAreaMapping
};
