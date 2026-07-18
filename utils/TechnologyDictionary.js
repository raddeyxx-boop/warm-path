const TECHNOLOGY_CATEGORIES = {
    frontend: [
        "HTML", "CSS", "Sass", "SCSS", "Less", "JavaScript", "TypeScript", "React", "React.js",
        "Next.js", "Remix", "Angular", "AngularJS", "Vue", "Vue.js", "Nuxt", "Svelte", "SvelteKit",
        "SolidJS", "Qwik", "Astro", "jQuery", "Redux", "MobX", "Zustand", "Recoil", "RxJS",
        "Tailwind CSS", "Bootstrap", "Material UI", "MUI", "Chakra UI", "Ant Design", "Storybook",
        "Vite", "Webpack", "Rollup", "Parcel", "Babel", "ESBuild", "SWC", "Electron", "Tauri",
        "React Native", "Expo", "Flutter", "Dart", "Ionic", "Capacitor", "Cordova", "Three.js",
        "D3.js", "Chart.js", "Highcharts", "Mapbox", "Leaflet", "Framer Motion"
    ],
    backend: [
        "Node.js", "Express", "NestJS", "Fastify", "Koa", "Hapi", "AdonisJS", "Python", "Django",
        "Flask", "FastAPI", "Pyramid", "Celery", "Java", "Spring", "Spring Boot", "Hibernate",
        "Quarkus", "Micronaut", "Kotlin", "Ktor", "Scala", "Play Framework", "Akka", "C#",
        ".NET", ".NET Core", "ASP.NET", "ASP.NET MVC", "ASP.NET Web API", "Go", "Gin", "Echo",
        "Fiber", "Rust", "Actix", "Rocket", "Axum", "PHP", "Laravel", "Symfony", "CodeIgniter",
        "Ruby", "Ruby on Rails", "Sinatra", "Elixir", "Phoenix", "Erlang", "Clojure", "GraphQL",
        "Apollo", "REST", "gRPC", "tRPC", "WebSockets", "Socket.IO", "OpenAPI", "Swagger"
    ],
    databases: [
        "PostgreSQL", "MySQL", "MariaDB", "SQLite", "SQL Server", "Oracle", "MongoDB", "Redis",
        "Elasticsearch", "OpenSearch", "DynamoDB", "Cassandra", "ScyllaDB", "Couchbase", "CouchDB",
        "Neo4j", "ArangoDB", "InfluxDB", "TimescaleDB", "ClickHouse", "Snowflake", "BigQuery",
        "Redshift", "Databricks", "Apache Hive", "Apache HBase", "DuckDB", "Supabase", "Firebase",
        "Firestore", "Realm", "Prisma", "Sequelize", "TypeORM", "Mongoose", "Drizzle ORM",
        "Knex", "Entity Framework", "Dapper", "Liquibase", "Flyway", "Alembic"
    ],
    cloud: [
        "AWS", "Azure", "Google Cloud", "GCP", "Heroku", "Vercel", "Netlify", "Cloudflare",
        "DigitalOcean", "Linode", "Akamai", "Oracle Cloud", "IBM Cloud", "OpenStack", "VMware",
        "Kubernetes Engine", "Cloud Run", "App Engine", "Cloud Functions", "Lambda", "EC2", "S3",
        "RDS", "ECS", "EKS", "Fargate", "CloudFront", "Route 53", "IAM", "SQS", "SNS", "EventBridge",
        "Step Functions", "Glue", "Athena", "Kinesis", "API Gateway", "Cognito", "Secrets Manager",
        "Parameter Store", "AppSync", "Amplify", "Elastic Beanstalk", "Azure Functions",
        "Azure App Service", "Azure Kubernetes Service", "AKS", "Azure DevOps", "Azure SQL",
        "Azure Cosmos DB", "Azure Blob Storage", "Azure Service Bus", "Azure Event Hubs",
        "Azure Data Factory", "Azure Synapse", "Azure Key Vault", "Google Kubernetes Engine",
        "GKE", "Cloud SQL", "Cloud Storage", "Pub/Sub", "Dataflow", "Cloud Build", "Cloud Deploy",
        "Secret Manager", "Vertex AI", "Firebase Hosting"
    ],
    devops: [
        "Docker", "Kubernetes", "Helm", "Kustomize", "Terraform", "OpenTofu", "Pulumi", "Ansible",
        "Chef", "Puppet", "SaltStack", "Jenkins", "GitHub Actions", "GitLab CI", "CircleCI",
        "Travis CI", "TeamCity", "Bamboo", "Argo CD", "Flux", "Spinnaker", "Harness", "Tekton",
        "Prometheus", "Grafana", "Loki", "Tempo", "Jaeger", "Zipkin", "OpenTelemetry", "Datadog",
        "New Relic", "Splunk", "ELK", "Fluentd", "Fluent Bit", "Logstash", "Vault", "Consul",
        "Nomad", "Nginx", "Apache", "Traefik", "HAProxy", "Istio", "Linkerd", "Envoy"
    ],
    ai_ml: [
        "OpenAI", "ChatGPT", "Codex", "Claude", "Gemini", "Llama", "Mistral", "LangChain",
        "LangGraph", "LlamaIndex", "RAG", "Vector Database", "Embeddings", "Transformers",
        "PyTorch", "TensorFlow", "Keras", "Scikit-learn", "Pandas", "NumPy", "SciPy", "Matplotlib",
        "Seaborn", "XGBoost", "LightGBM", "CatBoost", "MLflow", "Kubeflow", "Airflow", "Dagster",
        "Prefect", "Hugging Face", "spaCy", "NLTK", "OpenCV", "YOLO", "Stable Diffusion",
        "Whisper", "Pinecone", "Weaviate", "Milvus", "Qdrant", "Chroma", "FAISS", "ONNX",
        "vLLM", "Ollama", "Ray", "Dask", "Jupyter", "Databricks ML"
    ],
    security: [
        "OAuth", "OIDC", "SAML", "JWT", "mTLS", "TLS", "SSL", "OWASP", "Snyk", "Dependabot",
        "Trivy", "Grype", "Anchore", "SonarQube", "Checkmarx", "Veracode", "Burp Suite", "ZAP",
        "Metasploit", "Nmap", "Wireshark", "HashiCorp Vault", "Keycloak", "Okta", "Auth0",
        "Microsoft Entra ID", "Active Directory", "LDAP", "SIEM", "SOAR", "CrowdStrike", "Sentinel",
        "Splunk Enterprise Security", "Wazuh", "Falco", "OPA", "Open Policy Agent", "Kyverno"
    ],
    testing: [
        "Playwright", "Selenium", "Cypress", "Puppeteer", "WebDriverIO", "Jest", "Vitest", "Mocha",
        "Chai", "Jasmine", "Testing Library", "JUnit", "TestNG", "NUnit", "xUnit", "Pytest",
        "Robot Framework", "Cucumber", "SpecFlow", "Postman", "Newman", "Insomnia", "SoapUI",
        "JMeter", "k6", "Gatling", "Locust", "Appium", "Detox", "Maestro", "SonarCloud"
    ],
    programming: [
        "C", "C++", "C#", "Java", "JavaScript", "TypeScript", "Python", "Ruby", "PHP", "Go",
        "Rust", "Kotlin", "Swift", "Objective-C", "Dart", "Scala", "Elixir", "Erlang", "Clojure",
        "F#", "R", "MATLAB", "Julia", "Perl", "Lua", "Groovy", "Bash", "PowerShell", "SQL",
        "PL/SQL", "T-SQL", "Haskell", "OCaml", "Visual Basic", "VB.NET", "Delphi", "Solidity"
    ],
    tooling: [
        "Git", "GitHub", "GitLab", "Bitbucket", "SVN", "Mercurial", "npm", "Yarn", "pnpm", "Bun",
        "Maven", "Gradle", "Ant", "Make", "CMake", "Ninja", "MSBuild", "NuGet", "Pip", "Poetry",
        "Pipenv", "Conda", "Bundler", "Composer", "Cargo", "Go Modules", "ESLint", "Prettier",
        "Stylelint", "Black", "Ruff", "Flake8", "Pylint", "EditorConfig", "Husky", "lint-staged"
    ],
    systems: [
        "Linux", "Ubuntu", "Debian", "Red Hat", "RHEL", "CentOS", "Fedora", "Alpine Linux",
        "Windows", "Windows Server", "macOS", "iOS", "Android", "Unix", "FreeBSD", "NixOS",
        "Networking", "TCP/IP", "DNS", "HTTP", "HTTPS", "HTTP/2", "HTTP/3", "QUIC", "WebRTC",
        "MQTT", "AMQP", "RabbitMQ", "Kafka", "Redpanda", "NATS", "ZeroMQ", "ActiveMQ", "Mosquitto"
    ]
};

const ECOSYSTEM_SERVICES = {
    AWS: [
        "Lambda", "EC2", "S3", "RDS", "DynamoDB", "ECS", "EKS", "Fargate", "CloudFront", "Route 53",
        "IAM", "SQS", "SNS", "EventBridge", "Step Functions", "Glue", "Athena", "Kinesis", "API Gateway",
        "Cognito", "Secrets Manager", "CloudWatch", "CloudTrail", "CodeBuild", "CodePipeline", "CodeDeploy",
        "Elastic Beanstalk", "AppSync", "Amplify", "Redshift", "SageMaker", "Bedrock", "Elasticache",
        "Neptune", "DocumentDB", "MSK", "VPC", "WAF", "Shield", "GuardDuty", "Inspector", "Macie"
    ],
    Azure: [
        "Functions", "App Service", "AKS", "Container Apps", "DevOps", "Pipelines", "SQL Database",
        "Cosmos DB", "Blob Storage", "Service Bus", "Event Hubs", "Data Factory", "Synapse", "Key Vault",
        "Monitor", "Application Insights", "Logic Apps", "API Management", "Front Door", "CDN",
        "Virtual Machines", "Virtual Network", "Load Balancer", "Firewall", "Sentinel", "Defender",
        "Machine Learning", "OpenAI Service", "Cognitive Search", "Redis Cache", "Table Storage"
    ],
    GoogleCloud: [
        "Cloud Run", "Cloud Functions", "GKE", "Compute Engine", "Cloud Storage", "Cloud SQL", "Firestore",
        "Bigtable", "Spanner", "Pub/Sub", "Dataflow", "Dataproc", "Composer", "Cloud Build", "Cloud Deploy",
        "Secret Manager", "Vertex AI", "BigQuery", "Looker", "Cloud CDN", "Cloud Load Balancing",
        "Cloud Armor", "IAM", "VPC", "Cloud Scheduler", "Cloud Tasks", "Cloud Logging", "Cloud Monitoring"
    ]
};

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

const GENERATED_TECHNOLOGIES = unique(
    Object.entries(ECOSYSTEM_SERVICES).flatMap(([vendor, services]) =>
        services.flatMap(service => [
            `${vendor} ${service}`,
            `${vendor.replace("GoogleCloud", "Google Cloud")} ${service}`
        ])
    )
);

const ALL_TECHNOLOGIES = unique([
    ...Object.values(TECHNOLOGY_CATEGORIES).flat(),
    ...GENERATED_TECHNOLOGIES
]);

function normalizeTechnology(value) {
    return (value || "")
        .toString()
        .toLowerCase()
        .replace(/\.js\b/g, " js")
        .replace(/[^a-z0-9+#.\s/-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function technologyPattern(technology) {
    const escaped = normalizeTechnology(technology)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "\\s+");

    return new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, "i");
}

const TECHNOLOGY_INDEX = ALL_TECHNOLOGIES.map(name => ({
    name,
    normalized: normalizeTechnology(name),
    pattern: technologyPattern(name)
}));

function matchTechnologies(text) {
    const normalizedText = normalizeTechnology(text);

    return unique(
        TECHNOLOGY_INDEX
            .filter(item => item.pattern.test(normalizedText))
            .map(item => item.name)
    );
}

module.exports = {
    TECHNOLOGY_CATEGORIES,
    ALL_TECHNOLOGIES,
    matchTechnologies,
    normalizeTechnology
};
