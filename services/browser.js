const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { LINKEDIN_SESSION_PATH } = require("../config/linkedin-session");
const {
    cookieExpired,
    cookieValueHash,
    sessionFileDiagnostic,
    sessionStateDiagnostic,
    validateStorageState
} = require("./linkedin-session-state");

delete process.env.PWDEBUG;
delete process.env.PWDEBUGIMPL;

const SESSION_PATH = LINKEDIN_SESSION_PATH;
const LINKEDIN_FEED_URL = "https://www.linkedin.com/feed/";
const AUTHENTICATED_SEARCH_SELECTOR = [
    'input[aria-label*="Search" i]',
    'input[placeholder*="Search" i]',
    '[role="searchbox"][aria-label*="Search" i]'
].join(", ");
const AUTHENTICATED_NAV_SELECTOR = [
    "nav.global-nav",
    "header.global-nav",
    '[data-test-global-nav-link]',
    'a[href*="/feed/"]',
    'a[href*="/mynetwork"]',
    'a[href*="/jobs"]',
    'a[href*="/messaging"]',
    'a[href*="/notifications"]',
    'button[aria-label^="Home" i]'
].join(", ");
const PROFILE_MENU_SELECTOR = [
    'button:has-text("Me")',
    'button[aria-label*="profile" i]',
    '[data-control-name="identity_profile_photo"]'
].join(", ");

const SIGN_IN_FORM_SELECTOR = [
    'form[action*="login" i]',
    'input[name="session_key"]',
    'input[name="session_password"]',
    'a[href*="/login" i]',
    '[data-test-id*="sign-in" i]'
].join(", ");
const AUTHWALL_SELECTOR = '[class*="authwall" i]';
const CAPTCHA_SELECTOR = [
    '[id*="captcha" i]',
    'iframe[src*="captcha" i]'
].join(", ");
const SECURITY_VERIFICATION_SELECTOR = [
    '[class*="security-verification" i]',
    '[data-test-id*="security-verification" i]'
].join(", ");
const UNAUTHENTICATED_UI_SELECTOR = [
    SIGN_IN_FORM_SELECTOR,
    AUTHWALL_SELECTOR,
    CAPTCHA_SELECTOR,
    SECURITY_VERIFICATION_SELECTOR
].join(", ");
const AUTH_STABILITY_WINDOW_MS = 1200;

const DEFAULT_OPTIONS = {
    authCheck: true,
    navigationTimeout: 45000
};

function resolvePlaywrightHeadless(environment = process.env) {
    if (environment.PLAYWRIGHT_HEADLESS !== undefined) {
        return String(environment.PLAYWRIGHT_HEADLESS).trim().toLowerCase() === "true";
    }
    return environment.NODE_ENV === "production";
}

class LinkedInAuthenticationError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "LinkedInAuthenticationError";
        this.code = code;
        this.details = details;
    }
}

function isLinkedInAuthenticationError(error) {
    return error instanceof LinkedInAuthenticationError ||
        String(error?.code || "").startsWith("LINKEDIN_");
}

function safePageUrl(page, fallback = "") {
    try {
        return page && !page.isClosed() ? page.url() : fallback;
    } catch {
        return fallback;
    }
}

function browserResourceState(browser, context, page) {
    return {
        browser_exists: Boolean(browser),
        browser_connected: Boolean(browser && browser.isConnected()),
        context_exists: Boolean(context),
        context_closed: Boolean(context && context.__warmPathClosed),
        page_exists: Boolean(page),
        page_closed: Boolean(page && page.isClosed())
    };
}

function assertBrowserResources({ browser, context, page, startedAt, currentStep, lastSuccessfulAction }) {
    const state = browserResourceState(browser, context, page);
    const closedResources = [];
    if (!state.browser_exists) closedResources.push("browser_missing");
    else if (!state.browser_connected) closedResources.push("browser_disconnected");
    if (!state.context_exists) closedResources.push("context_missing");
    else if (state.context_closed) closedResources.push("context_closed");
    if (!state.page_exists) closedResources.push("page_missing");
    else if (state.page_closed) closedResources.push("page_closed");
    if (closedResources.length === 0) return state;

    throw new Error(
        "Browser lifecycle assertion failed: " +
        JSON.stringify({
            current_step: currentStep,
            closed_resources: closedResources,
            elapsed_ms: Date.now() - startedAt,
            last_successful_action: lastSuccessfulAction,
            ...state
        })
    );
}

function createBrowserLifecycle({ browser, context, page, startedAt = Date.now(), log = console.log }) {
    let cleanupStarted = false;
    let currentStep = "browser_startup";
    let lastSuccessfulAction = "browser resources created";
    let lastUrl = safePageUrl(page);
    let authenticationConfirmed = false;
    let loginChallengeObserved = false;

    const diagnostic = (event, details = {}) => log("[BROWSER_LIFECYCLE]", {
        event,
        timestamp: new Date().toISOString(),
        current_step: currentStep,
        elapsed_ms: Date.now() - startedAt,
        last_successful_action: lastSuccessfulAction,
        last_url: safePageUrl(page, lastUrl),
        authentication_confirmed: authenticationConfirmed,
        login_challenge_observed: loginChallengeObserved,
        ...browserResourceState(browser, context, page),
        ...details
    });

    browser.on("disconnected", () => diagnostic("browser_disconnected"));
    context.on("close", () => {
        context.__warmPathClosed = true;
        diagnostic("context_closed");
    });
    page.on("close", () => diagnostic("page_closed"));

    return {
        setStep(step, action = lastSuccessfulAction) {
            currentStep = step;
            lastSuccessfulAction = action;
            lastUrl = safePageUrl(page, lastUrl);
        },
        setAuthenticationState({ confirmed, challengeObserved, url } = {}) {
            if (typeof confirmed === "boolean") authenticationConfirmed = confirmed;
            if (typeof challengeObserved === "boolean") loginChallengeObserved = challengeObserved;
            if (url) lastUrl = url;
        },
        assertLive(step = currentStep, action = lastSuccessfulAction) {
            currentStep = step;
            lastSuccessfulAction = action;
            return assertBrowserResources({
                browser, context, page, startedAt, currentStep, lastSuccessfulAction
            });
        },
        async cleanup(reason) {
            if (cleanupStarted) return false;
            cleanupStarted = true;
            diagnostic("cleanup_started", { cleanup_reason: reason || "unspecified" });
            await browser.close();
            return true;
        },
        isCleanupStarted() {
            return cleanupStarted;
        }
    };
}

function assertSessionExists(sessionPath) {
    if (!fs.existsSync(sessionPath)) {
        throw new Error(
            "LinkedIn session file not found at " +
            sessionPath +
            ". Run `node scripts/login.js` to create a fresh session."
        );
    }
}

function readAndValidateSession(sessionPath) {
    let parsedSession;
    try {
        parsedSession = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    } catch {
        throw new LinkedInAuthenticationError(
            "LINKEDIN_SESSION_ARTIFACT_INVALID",
            authenticationMessage("LINKEDIN_SESSION_ARTIFACT_INVALID"),
            { session_path: sessionPath, reason: "Session file is not valid JSON." }
        );
    }

    try {
        return validateStorageState(parsedSession);
    } catch (error) {
        const code = error?.code || "LINKEDIN_SESSION_ARTIFACT_INVALID";
        throw new LinkedInAuthenticationError(
            code,
            authenticationMessage(code),
            {
                session_path: sessionPath,
                reason: error instanceof Error ? error.message : String(error),
                ...(error?.details || {})
            }
        );
    }
}

function isLinkedInLoginUrl(url) {
    return /\/(?:login|checkpoint|challenge|uas\/login|authwall|signin|security-verification|captcha)(?:[/?#]|$)/i
        .test(String(url || ""));
}

function authenticationMessage(code) {
    if (code === "LINKEDIN_AUTH_INDICATORS_MISSING") {
        return "LinkedIn opened, but the authenticated page indicators could not be verified.";
    }
    if (code === "LINKEDIN_CHALLENGE_REQUIRED") {
        return "LinkedIn requires a security verification. Complete it in LinkedIn before retrying the search.";
    }
    if (code === "LINKEDIN_SESSION_ARTIFACT_MISSING") {
        return "The saved LinkedIn session could not be loaded. Sign in through the supported login flow before retrying.";
    }
    if (code === "LINKEDIN_SESSION_ARTIFACT_INVALID") {
        return "The saved LinkedIn session is invalid. Create and deploy a fresh session before retrying.";
    }
    if (code === "LINKEDIN_SESSION_COOKIE_MISSING") {
        return "The saved LinkedIn session is missing its required authentication cookie. Sign in again before retrying.";
    }
    if (code === "LINKEDIN_SESSION_COOKIE_EXPIRED") {
        return "The saved LinkedIn session cookie has expired. Sign in again before retrying.";
    }
    return "Your LinkedIn session is no longer active. Open LinkedIn, sign in again, and retry the search.";
}

function authenticationFailure(page, browser, context, lifecycle, code, lastUrl, challengeObserved = false, evidence = {}) {
    const state = browserResourceState(browser, context, page);
    lifecycle?.setAuthenticationState({
        confirmed: false,
        challengeObserved,
        url: safePageUrl(page, lastUrl)
    });
    return new LinkedInAuthenticationError(
        code,
        authenticationMessage(code),
        {
            last_url: safePageUrl(page, lastUrl),
            page_closed: state.page_closed,
            context_closed: state.context_closed,
            browser_connected: state.browser_connected,
            lifecycle_step: "linkedin_authentication",
            last_successful_action: "LinkedIn feed navigation completed",
            authentication_evidence: evidence
        }
    );
}

function authenticationConfirmedByEvidence(evidence) {
    const authenticatedEvidenceCount = [
        evidence.authenticated_shell_found,
        evidence.search_input_found,
        evidence.authenticated_navigation_found,
        evidence.profile_menu_found
    ].filter(Boolean).length;
    const negativeAuthState =
        evidence.sign_in_form_found ||
        evidence.authwall_found ||
        evidence.checkpoint_found ||
        evidence.challenge_found ||
        evidence.captcha_found ||
        evidence.security_verification_found ||
        isLinkedInLoginUrl(evidence.current_url);

    return evidence.safe_url &&
        evidence.authenticated_shell_found &&
        authenticatedEvidenceCount >= 2 &&
        !negativeAuthState &&
        !evidence.page_closed &&
        evidence.browser_connected;
}

function redirectChain(response) {
    const urls = [];
    let request = response?.request?.();
    while (request) {
        urls.unshift(request.url());
        request = request.redirectedFrom();
    }
    return urls;
}

async function logLinkedInFirstResponse(response, requestedUrl, page) {
    const headers = response?.allHeaders
        ? await response.allHeaders().catch(() => ({}))
        : response?.headers?.() || {};
    console.log("[LINKEDIN_FIRST_RESPONSE]", {
        requested_url: requestedUrl,
        response_url: response?.url?.() || null,
        status: response?.status?.() ?? null,
        redirect_chain: redirectChain(response),
        set_cookie_header_present: Boolean(headers["set-cookie"]),
        final_url: safePageUrl(page)
    });
}

async function visibleState(page, selector) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    return {
        count,
        visible: count > 0 && await locator.first().isVisible().catch(() => false)
    };
}

async function collectLinkedInAuthEvidence(page, browser) {
    const currentUrl = safePageUrl(page);
    const [
        shell, search, navigation, profileMenu, signInForm,
        authwall, captcha, securityVerification
    ] = await Promise.all([
        visibleState(page, "main"),
        visibleState(page, AUTHENTICATED_SEARCH_SELECTOR),
        visibleState(page, AUTHENTICATED_NAV_SELECTOR),
        visibleState(page, PROFILE_MENU_SELECTOR),
        visibleState(page, SIGN_IN_FORM_SELECTOR),
        visibleState(page, AUTHWALL_SELECTOR),
        visibleState(page, CAPTCHA_SELECTOR),
        visibleState(page, SECURITY_VERIFICATION_SELECTOR)
    ]);
    return {
        current_url: currentUrl,
        safe_url: currentUrl.includes("linkedin.com") && !isLinkedInLoginUrl(currentUrl),
        authenticated_shell_found: shell.visible,
        search_input_found: search.visible,
        authenticated_navigation_found: navigation.visible,
        profile_menu_found: profileMenu.visible,
        sign_in_form_found: signInForm.visible,
        authwall_found: authwall.visible,
        checkpoint_found: /\/checkpoint(?:[/?#]|$)/i.test(currentUrl),
        challenge_found: /\/challenge(?:[/?#]|$)/i.test(currentUrl),
        captcha_found: captcha.visible || /\/captcha(?:[/?#]|$)/i.test(currentUrl),
        security_verification_found: securityVerification.visible ||
            /\/security-verification(?:[/?#]|$)/i.test(currentUrl),
        page_closed: Boolean(page && page.isClosed()),
        browser_connected: Boolean(browser && browser.isConnected()),
        selector_counts: {
            authenticated_shell: shell.count,
            search_input: search.count,
            authenticated_navigation: navigation.count,
            profile_menu: profileMenu.count,
            sign_in_form: signInForm.count,
            authwall: authwall.count,
            captcha: captcha.count,
            security_verification: securityVerification.count
        }
    };
}

async function assertLinkedInAuthenticated(
    page,
    navigationTimeout,
    { browser, context, lifecycle, sessionCookieEvidence } = {}
) {
    page.setDefaultNavigationTimeout(navigationTimeout);

    console.log("====================================");
    console.log("STEP 2");
    console.log("Opening LinkedIn...");
    console.log("====================================");
    const navigationStartedAt = Date.now();
    const targetUrl = LINKEDIN_FEED_URL;
    const firstResponse = await page.goto(LINKEDIN_FEED_URL, {
        waitUntil: "domcontentloaded"
    });
    await logLinkedInFirstResponse(firstResponse, targetUrl, page);

    console.log("Current URL:", page.url());
    console.log("Target URL:", targetUrl);
    console.log("Navigation successful:", page.url().includes("linkedin.com"));
    console.log("Time taken:", `${Date.now() - navigationStartedAt}ms`);

    console.log("====================================");
    console.log("STEP 3");
    console.log("Verifying LinkedIn session...");
    console.log("Expected condition: a stable authenticated app shell with no negative authentication state.");
    console.log("====================================");

    await page.waitForLoadState("networkidle", {
        timeout: 1000
    }).catch(error => console.log("[browser.js:assertLinkedInAuthenticated] Network did not become idle; continuing with app-shell checks.", {
        reason: error.message
    }));

    let currentUrl = safePageUrl(page, targetUrl);
    let evidence = await collectLinkedInAuthEvidence(page, browser);
    evidence.session_cookie = sessionCookieEvidence;
    console.log("[LINKEDIN_AUTH_CONDITIONS]", evidence);

    if (evidence.checkpoint_found || evidence.challenge_found || evidence.captcha_found ||
        evidence.security_verification_found) {
        throw authenticationFailure(
            page, browser, context, lifecycle, "LINKEDIN_CHALLENGE_REQUIRED", currentUrl, true, evidence
        );
    }

    if (evidence.sign_in_form_found || evidence.authwall_found ||
        /\/(?:login|uas\/login|authwall|signin)(?:[/?#]|$)/i.test(currentUrl)) {
        throw authenticationFailure(
            page, browser, context, lifecycle, "LINKEDIN_AUTH_REQUIRED", currentUrl, false, evidence
        );
    }
    if (evidence.page_closed || !evidence.browser_connected) {
        throw authenticationFailure(
            page, browser, context, lifecycle, "LINKEDIN_PAGE_CLOSED_DURING_AUTH", currentUrl, false, evidence
        );
    }
    if (!authenticationConfirmedByEvidence(evidence)) {
        throw authenticationFailure(
            page, browser, context, lifecycle, "LINKEDIN_AUTH_INDICATORS_MISSING", currentUrl, false, evidence
        );
    }

    try {
        await page.waitForFunction(
            ({ searchSelector, navSelector, profileSelector, unauthenticatedSelector, stabilityWindowMs }) => {
                const url = window.location.href;
                const forbiddenUrl = /\/(?:login|checkpoint|challenge|uas\/login|authwall|signin|security-verification|captcha)(?:[/?#]|$)/i
                    .test(url);
                const authenticated = !forbiddenUrl &&
                    document.visibilityState === "visible" &&
                    Boolean(document.querySelector("main")) &&
                    Boolean(
                        document.querySelector(searchSelector) ||
                        document.querySelector(navSelector) ||
                        document.querySelector(profileSelector)
                    ) &&
                    !document.querySelector(unauthenticatedSelector);
                if (!authenticated) {
                    window.__warmPathAuthenticatedSince = 0;
                    return false;
                }
                if (!window.__warmPathAuthenticatedSince) {
                    window.__warmPathAuthenticatedSince = performance.now();
                    return false;
                }
                return performance.now() - window.__warmPathAuthenticatedSince >= stabilityWindowMs;
            },
            {
                searchSelector: AUTHENTICATED_SEARCH_SELECTOR,
                navSelector: AUTHENTICATED_NAV_SELECTOR,
                profileSelector: PROFILE_MENU_SELECTOR,
                unauthenticatedSelector: UNAUTHENTICATED_UI_SELECTOR,
                stabilityWindowMs: AUTH_STABILITY_WINDOW_MS
            },
            { timeout: 8000, polling: 100 }
        );
        currentUrl = safePageUrl(page, currentUrl);
        if (page.isClosed() || browser && !browser.isConnected()) {
            throw authenticationFailure(page, browser, context, lifecycle, "LINKEDIN_PAGE_CLOSED_DURING_AUTH", currentUrl);
        }
        if (isLinkedInLoginUrl(currentUrl)) {
            evidence = await collectLinkedInAuthEvidence(page, browser);
            evidence.session_cookie = sessionCookieEvidence;
            const challengeObserved = evidence.checkpoint_found || evidence.challenge_found ||
                evidence.captcha_found || evidence.security_verification_found;
            throw authenticationFailure(
                page,
                browser,
                context,
                lifecycle,
                challengeObserved ? "LINKEDIN_CHALLENGE_REQUIRED" : "LINKEDIN_AUTH_REQUIRED",
                currentUrl,
                challengeObserved,
                evidence
            );
        }
        evidence = await collectLinkedInAuthEvidence(page, browser);
        evidence.session_cookie = sessionCookieEvidence;
        const challengeObserved = evidence.checkpoint_found || evidence.challenge_found ||
            evidence.captcha_found || evidence.security_verification_found;
        if (challengeObserved) {
            throw authenticationFailure(
                page, browser, context, lifecycle, "LINKEDIN_CHALLENGE_REQUIRED", currentUrl, true, evidence
            );
        }
        if (evidence.sign_in_form_found || evidence.authwall_found ||
            /\/(?:login|uas\/login|authwall|signin)(?:[/?#]|$)/i.test(evidence.current_url)) {
            throw authenticationFailure(
                page, browser, context, lifecycle, "LINKEDIN_AUTH_REQUIRED", currentUrl, false, evidence
            );
        }
        if (!authenticationConfirmedByEvidence(evidence)) {
            throw authenticationFailure(
                page,
                browser,
                context,
                lifecycle,
                evidence.page_closed || !evidence.browser_connected
                    ? "LINKEDIN_PAGE_CLOSED_DURING_AUTH"
                    : "LINKEDIN_AUTH_INDICATORS_MISSING",
                currentUrl,
                false,
                evidence
            );
        }
    } catch (error) {
        if (isLinkedInAuthenticationError(error)) throw error;
        const pageClosed = !page || page.isClosed();
        const browserDisconnected = browser && !browser.isConnected();
        if (!pageClosed && !browserDisconnected) {
            evidence = await collectLinkedInAuthEvidence(page, browser);
            evidence.session_cookie = sessionCookieEvidence;
            currentUrl = evidence.current_url || currentUrl;
        }
        const challengeObserved = evidence.checkpoint_found || evidence.challenge_found ||
            evidence.captcha_found || evidence.security_verification_found;
        const confirmedSignIn = evidence.sign_in_form_found || evidence.authwall_found ||
            /\/(?:login|uas\/login|authwall|signin)(?:[/?#]|$)/i.test(currentUrl);
        throw authenticationFailure(
            page,
            browser,
            context,
            lifecycle,
            pageClosed || browserDisconnected
                ? "LINKEDIN_PAGE_CLOSED_DURING_AUTH"
                : challengeObserved
                    ? "LINKEDIN_CHALLENGE_REQUIRED"
                    : confirmedSignIn
                        ? "LINKEDIN_AUTH_REQUIRED"
                : "LINKEDIN_AUTH_INDICATORS_MISSING",
            currentUrl,
            challengeObserved,
            evidence
        );
    }

    lifecycle?.setAuthenticationState({ confirmed: true, challengeObserved: false, url: currentUrl });
    console.log("LinkedIn session verified.");
}

async function startBrowser(options = {}) {
    const config = {
        ...DEFAULT_OPTIONS,
        ...options
    };

    const sessionPath = path.resolve(config.sessionPath || SESSION_PATH);

    let browser;
    let lifecycle;
    const startedAt = Date.now();

    try {
        try {
            assertSessionExists(sessionPath);
        } catch (error) {
            throw new LinkedInAuthenticationError(
                "LINKEDIN_SESSION_ARTIFACT_MISSING",
                authenticationMessage("LINKEDIN_SESSION_ARTIFACT_MISSING"),
                { session_path: sessionPath, reason: error.message }
            );
        }
        const loadedState = readAndValidateSession(sessionPath);
        const loadFile = sessionFileDiagnostic(sessionPath);
        console.log("[SESSION_PATH_DIAGNOSTIC]", {
            save_path: LINKEDIN_SESSION_PATH,
            load_path: sessionPath,
            save_path_absolute: path.resolve(LINKEDIN_SESSION_PATH),
            load_path_absolute: loadFile.path_absolute,
            paths_match: path.resolve(LINKEDIN_SESSION_PATH) === loadFile.path_absolute,
            file_exists: loadFile.file_exists,
            file_size: loadFile.file_size,
            file_modified_at: loadFile.file_modified_at
        });
        console.log("[SESSION_STATE_DIAGNOSTIC]", sessionStateDiagnostic(loadedState));
        const launchOptions = config.launchOptions || {};
        const {
            headless: configuredHeadless,
            devtools: ignoredDevtools,
            slowMo: ignoredSlowMo,
            args: configuredLaunchArgs,
            ...safeLaunchOptions
        } = launchOptions;
        const headless = configuredHeadless ??
            config.headless ??
            resolvePlaywrightHeadless(config.environment || process.env);
        const safeConfiguredLaunchArgs = (configuredLaunchArgs || [])
            .filter(argument => !/^--(?:auto-open-devtools-for-tabs|remote-debugging|window-size|window-position|start-maximized)/i.test(argument));
        const browserLaunchArgs = headless
            ? safeConfiguredLaunchArgs
            : [...safeConfiguredLaunchArgs, "--start-maximized"];
        const viewport = headless
            ? { width: 1440, height: 900 }
            : null;

        const chromiumImpl = config.chromiumImpl || chromium;
        console.log("[CONTEXT_CONFIGURATION_DIAGNOSTIC]", {
            source: "index",
            browser_type: "chromium",
            channel: config.channel || null,
            headless,
            executable_path: safeLaunchOptions.executablePath || null,
            user_agent: config.contextOptions?.userAgent || null,
            viewport,
            locale: config.contextOptions?.locale || null,
            timezone_id: config.contextOptions?.timezoneId || null,
            proxy_configured: Boolean(safeLaunchOptions.proxy || config.contextOptions?.proxy),
            storage_state_path: sessionPath,
            persistent_context: false,
            launch_args: browserLaunchArgs
        });
        browser = await chromiumImpl.launch({
            ...safeLaunchOptions,
            ...(config.channel ? { channel: config.channel } : {}),
            headless,
            devtools: false,
            args: browserLaunchArgs
        });
        const browserProcessPid =
            browser?._connection?._transport?._proc?.pid ??
            browser?._impl?._browserProcess?.pid ??
            null;
        console.log(`Browser PID: ${browserProcessPid || "unavailable"}`);
        const context = await browser.newContext({
            ...(config.contextOptions || {}),
            storageState: sessionPath,
            viewport
        });
        console.log("Context created");

        const diagnosticLog = config.lifecycleLog || console.log;
        let linkedInCookies;
        let cookieInspectionError;
        try {
            linkedInCookies = await context.cookies("https://www.linkedin.com");
        } catch {
            linkedInCookies = null;
            cookieInspectionError = "Unable to inspect context cookies.";
        }
        const requiredCookieNames = ["li_at"];
        const requiredCookiesFound = requiredCookieNames.filter(name =>
            linkedInCookies?.some(cookie => cookie.name === name && Boolean(cookie.value))
        );
        const requiredCookiesMissing = requiredCookieNames.filter(name =>
            linkedInCookies && !linkedInCookies.some(cookie =>
                cookie.name === name && Boolean(cookie.value)
            )
        );
        const liAt = linkedInCookies?.find(cookie =>
            cookie.name === "li_at" && Boolean(cookie.value)
        );
        const sessionCookieEvidence = {
            cookie_inspection_succeeded: Boolean(linkedInCookies),
            required_cookie_present_before_navigation: Boolean(liAt),
            required_cookie_expired_before_navigation: Boolean(liAt && cookieExpired(liAt))
        };
        console.log("[SESSION_BEFORE_NAVIGATION]", {
            context_cookie_count: linkedInCookies?.length ?? null,
            linkedin_cookie_count: linkedInCookies?.length ?? null,
            li_at_present: Boolean(liAt),
            li_at_expired: Boolean(liAt && cookieExpired(liAt)),
            li_at_hash: cookieValueHash(liAt),
            current_url: "about:blank"
        });

        let sessionFileSize = 0;
        try {
            sessionFileSize = fs.statSync(sessionPath).size;
        } catch {
            sessionFileSize = 0;
        }
        try {
            diagnosticLog("[LINKEDIN_SESSION_DIAGNOSTIC]", {
                session_path: sessionPath,
                session_file_exists: fs.existsSync(sessionPath),
                session_file_size: sessionFileSize,
                cookie_inspection_succeeded: Boolean(linkedInCookies),
                cookie_inspection_error: cookieInspectionError || null,
                total_linkedin_cookies: linkedInCookies?.length ?? null,
                cookie_names: linkedInCookies?.map(cookie => cookie.name).sort() || [],
                required_cookies_found: requiredCookiesFound,
                required_cookies_missing: requiredCookiesMissing,
                cookie_metadata: linkedInCookies?.map(cookie => ({
                    name: cookie.name,
                    domain: cookie.domain,
                    path: cookie.path,
                    expires: cookie.expires,
                    expired: cookieExpired(cookie),
                    secure: cookie.secure,
                    httpOnly: cookie.httpOnly,
                    sameSite: cookie.sameSite,
                    has_value: Boolean(cookie.value)
                })) || []
            });
        } catch {
            // Diagnostics must not determine whether a valid session can proceed.
        }

        if (linkedInCookies && !liAt) {
            throw new LinkedInAuthenticationError(
                "LINKEDIN_SESSION_COOKIE_MISSING",
                authenticationMessage("LINKEDIN_SESSION_COOKIE_MISSING"),
                { session_path: sessionPath, ...sessionCookieEvidence }
            );
        }
        if (cookieExpired(liAt)) {
            throw new LinkedInAuthenticationError(
                "LINKEDIN_SESSION_COOKIE_EXPIRED",
                authenticationMessage("LINKEDIN_SESSION_COOKIE_EXPIRED"),
                {
                    session_path: sessionPath,
                    cookie_name: "li_at",
                    expires: liAt.expires,
                    ...sessionCookieEvidence
                }
            );
        }

        const page = await context.newPage();
        console.log("Page created");
        console.log("Navigating to LinkedIn...");
        page.setDefaultTimeout(config.navigationTimeout);
        lifecycle = createBrowserLifecycle({
            browser,
            context,
            page,
            startedAt,
            log: config.lifecycleLog || console.log
        });

        if (config.authCheck) {
            lifecycle.setStep(
                "linkedin_authentication",
                `${headless ? "headless" : "headed"} browser initialized`
            );
            await (config.authVerifier || assertLinkedInAuthenticated)(
                page,
                config.navigationTimeout,
                { browser, context, lifecycle, sessionCookieEvidence }
            );
        }

        lifecycle.assertLive(
            "post_authentication_handoff",
            config.authCheck ? "LinkedIn session verified" : "browser page created"
        );
        return {
            browser,
            context,
            page,
            lifecycle,
            cleanup: reason => lifecycle.cleanup(reason)
        };
    } catch (err) {
        if (lifecycle) {
            await lifecycle.cleanup("browser_startup_failed").catch(() => {});
        } else if (browser) {
            await browser.close().catch(() => {});
        }

        if (isLinkedInAuthenticationError(err)) throw err;
        throw new Error("Browser startup failed: " + err.message);
    }
}

module.exports = startBrowser;
module.exports.SESSION_PATH = SESSION_PATH;
module.exports.resolvePlaywrightHeadless = resolvePlaywrightHeadless;
module.exports.assertBrowserResources = assertBrowserResources;
module.exports.browserResourceState = browserResourceState;
module.exports.createBrowserLifecycle = createBrowserLifecycle;
module.exports.assertLinkedInAuthenticated = assertLinkedInAuthenticated;
module.exports.isLinkedInLoginUrl = isLinkedInLoginUrl;
module.exports.LinkedInAuthenticationError = LinkedInAuthenticationError;
module.exports.collectLinkedInAuthEvidence = collectLinkedInAuthEvidence;
module.exports.authenticationConfirmedByEvidence = authenticationConfirmedByEvidence;
