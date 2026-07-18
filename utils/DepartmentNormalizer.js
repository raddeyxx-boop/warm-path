const DEPARTMENT_RULES = [
    {
        value: "ai",
        terms: ["artificial intelligence", " ai ", "machine intelligence", "prompt engineer", "agentic"]
    },
    {
        value: "ml",
        terms: ["machine learning", "deep learning", "ml engineer", "data scientist", "computer vision", "nlp"]
    },
    {
        value: "data",
        terms: ["data engineer", "data analyst", "analytics", "business intelligence", "bi developer", "etl"]
    },
    {
        value: "security",
        terms: ["security", "cyber", "infosec", "soc analyst", "penetration", "iam"]
    },
    {
        value: "infrastructure",
        terms: ["infrastructure", "platform", "site reliability", "sre", "cloud engineer", "systems engineer"]
    },
    {
        value: "business development",
        terms: ["business development", "business developer", "business development executive", "business development manager", "bde", "bdm"]
    },
    {
        value: "backend",
        terms: ["backend", "back end", "api", "server side", "node.js", "java developer", "dotnet", ".net"]
    },
    {
        value: "frontend",
        terms: ["frontend", "front end", "ui developer", "react", "angular", "vue", "web developer"]
    },
    {
        value: "software",
        terms: ["software", "engineer", "developer", "programmer", "full stack", "fullstack", "qa", "test automation"]
    },
    {
        value: "finance",
        terms: ["finance", "account", "accountant", "tax", "payroll", "audit", "mis"]
    },
    {
        value: "hr",
        terms: ["hr", "human resources", "recruit", "talent acquisition", "people operations"]
    },
    {
        value: "operations",
        terms: ["operations", "supply chain", "logistics", "delivery", "program manager", "project manager"]
    },
    {
        value: "marketing",
        terms: ["marketing", "seo", "content", "brand", "growth marketing", "digital marketing"]
    },
    {
        value: "sales",
        terms: ["sales", "account executive", "partnership", "revenue"]
    },
    {
        value: "legal",
        terms: ["legal", "counsel", "compliance", "contract"]
    },
    {
        value: "support",
        terms: ["support", "helpdesk", "service desk", "technical support"]
    },
    {
        value: "customer success",
        terms: ["customer success", "customer experience", "client success", "customer support"]
    },
    {
        value: "product",
        terms: ["product manager", "product owner", "product designer", "product"]
    },
    {
        value: "design",
        terms: ["design", "ux", "ui/ux", "user experience", "user interface"]
    }
];

function normalizeDepartment(value) {
    if (!value) {
        return "";
    }

    const normalized = ` ${value
        .toString()
        .toLowerCase()
        .replace(/[^a-z0-9+#.\s/-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()} `;

    for (const rule of DEPARTMENT_RULES) {
        if (rule.terms.some(term => normalized.includes(` ${term} `) || normalized.includes(term))) {
            return rule.value;
        }
    }

    return normalized.trim();
}

module.exports = {
    normalizeDepartment,
    DEPARTMENT_RULES
};
