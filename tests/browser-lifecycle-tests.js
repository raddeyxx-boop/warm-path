const assert = require("assert");
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const startBrowser = require("../services/browser");

class FakePage extends EventEmitter {
    constructor() { super(); this.closed = false; }
    isClosed() { return this.closed; }
    setDefaultTimeout() {}
    async evaluate() {
        return {
            innerWidth: 1280, innerHeight: 720, outerWidth: 1280, outerHeight: 800,
            screenWidth: 1920, screenHeight: 1080, availableWidth: 1920,
            availableHeight: 1040, deviceScaleFactor: 1
        };
    }
    viewportSize() { return null; }
}

class FakeContext extends EventEmitter {
    constructor(page) { super(); this.page = page; this.closed = false; }
    async newPage() { return this.page; }
}

class FakeBrowser extends EventEmitter {
    constructor(context) {
        super();
        this.context = context;
        this.connected = true;
        this.closeCalls = 0;
    }
    isConnected() { return this.connected; }
    async newContext() { return this.context; }
    async close() {
        this.closeCalls += 1;
        if (!this.connected) return;
        this.connected = false;
        this.context.closed = true;
        this.context.__warmPathClosed = true;
        this.context.page.closed = true;
        this.context.page.emit("close");
        this.context.emit("close");
        this.emit("disconnected");
    }
}

function fakeResources() {
    const page = new FakePage();
    const context = new FakeContext(page);
    const browser = new FakeBrowser(context);
    return { browser, context, page };
}

class AuthenticationPage extends EventEmitter {
    constructor({
        url = "https://www.linkedin.com/feed/",
        unauthenticatedUi = false,
        closeDuringVerification = false,
        shell = true,
        search = true,
        navigation = true,
        profileMenu = true
    } = {}) {
        super();
        this.currentUrl = url;
        this.unauthenticatedUi = unauthenticatedUi;
        this.closeDuringVerification = closeDuringVerification;
        this.shell = shell;
        this.search = search;
        this.navigation = navigation;
        this.profileMenu = profileMenu;
        this.closed = false;
    }
    isClosed() { return this.closed; }
    url() { return this.currentUrl; }
    setDefaultNavigationTimeout() {}
    async goto() { return null; }
    async waitForLoadState() {}
    locator(selector) {
        const page = this;
        const signIn = /session_key|session_password|sign-in|\/login/.test(selector);
        const authwall = /authwall/.test(selector);
        const captcha = /captcha/.test(selector);
        const securityVerification = /security-verification/.test(selector);
        const profile = /has-text|identity_profile_photo|profile/.test(selector);
        const navigation = /global-nav|mynetwork|messaging|notifications|aria-label\^="Home"/.test(selector);
        const search = /Search/.test(selector);
        const shell = selector === "main";
        const visible = signIn ? page.unauthenticatedUi
            : authwall || captcha || securityVerification ? false
            : profile ? page.profileMenu
                : navigation ? page.navigation
                    : search ? page.search
                        : shell ? page.shell
                            : true;
        return {
            first() { return this; },
            async count() { return visible ? 1 : 0; },
            async isVisible() { return visible; },
            async evaluate() { return true; }
        };
    }
    async waitForFunction() {
        if (this.closeDuringVerification) {
            this.closed = true;
            this.emit("close");
            throw new Error("page.waitForFunction: Target page, context or browser has been closed");
        }
        return true;
    }
}

async function run() {
    const { LINKEDIN_SESSION_PATH } = require("../config/linkedin-session");
    assert.strictEqual(startBrowser.SESSION_PATH, LINKEDIN_SESSION_PATH);
    assert.ok(path.isAbsolute(LINKEDIN_SESSION_PATH));
    const loginSource = fs.readFileSync(path.join(__dirname, "..", "scripts", "login.js"), "utf8");
    assert.match(loginSource, /LINKEDIN_SESSION_PATH/);

    const sessionPath = __filename;
    let resources = fakeResources();
    let launchOptions;
    let authenticationVerified = false;
    let session = await startBrowser({
        sessionPath,
        headless: false,
        slowMo: 999,
        launchOptions: {
            headless: false,
            devtools: true,
            slowMo: 999,
            args: ["--auto-open-devtools-for-tabs", "--remote-debugging-port=9222", "--start-maximized", "--disable-gpu"]
        },
        chromiumImpl: {
            launch: async options => {
                launchOptions = options;
                return resources.browser;
            }
        },
        authVerifier: async page => {
            authenticationVerified = true;
            assert.strictEqual(page.isClosed(), false);
        },
        lifecycleLog: () => {}
    });
    assert.strictEqual(launchOptions.headless, true);
    assert.strictEqual(launchOptions.devtools, false);
    assert.strictEqual("slowMo" in launchOptions, false);
    assert.deepStrictEqual(launchOptions.args, ["--disable-gpu"]);
    assert.strictEqual(authenticationVerified, true);
    assert.strictEqual(session.page.isClosed(), false);
    assert.strictEqual(session.browser.isConnected(), true);
    assert.strictEqual(session.lifecycle.isCleanupStarted(), false);
    session.lifecycle.assertLive("next_scraping_step", "authentication verification completed");
    assert.strictEqual(await session.cleanup("workflow_completed"), true);
    assert.strictEqual(resources.browser.closeCalls, 1);
    assert.strictEqual(await session.cleanup("duplicate_cleanup"), false);
    assert.strictEqual(resources.browser.closeCalls, 1);

    resources = fakeResources();
    await assert.rejects(() => startBrowser({
        sessionPath,
        chromiumImpl: { launch: async () => resources.browser },
        authVerifier: async () => { throw new Error("authentication rejected"); },
        lifecycleLog: () => {}
    }), /Browser startup failed: authentication rejected/);
    assert.strictEqual(resources.browser.closeCalls, 1);

    resources = fakeResources();
    const lifecycle = startBrowser.createBrowserLifecycle(resources);
    resources.page.closed = true;
    assert.throws(
        () => lifecycle.assertLive("before_target_search", "LinkedIn session verified"),
        error => /Browser lifecycle assertion failed/.test(error.message) &&
            /before_target_search/.test(error.message) &&
            /page_closed/.test(error.message) &&
            /LinkedIn session verified/.test(error.message)
    );

    const verify = startBrowser.assertLinkedInAuthenticated;
    let authResources = fakeResources();
    let authPage = new AuthenticationPage();
    authResources.page = authPage;
    authResources.context.page = authPage;
    const authLifecycle = startBrowser.createBrowserLifecycle(authResources);
    await verify(authPage, 45000, { browser: authResources.browser, lifecycle: authLifecycle });
    authLifecycle.assertLive("before_target_search", "authenticated verification completed");

    authResources = fakeResources();
    authPage = new AuthenticationPage({ profileMenu: false });
    await verify(authPage, 45000, { browser: authResources.browser, context: authResources.context });

    for (const rejectedUrl of ["https://www.linkedin.com/login", "https://www.linkedin.com/authwall"]) {
        authResources = fakeResources();
        authPage = new AuthenticationPage({ url: rejectedUrl });
        await assert.rejects(
            () => verify(authPage, 45000, { browser: authResources.browser, context: authResources.context }),
            error => error.code === "LINKEDIN_AUTH_REQUIRED"
        );
    }

    for (const challengeUrl of [
        "https://www.linkedin.com/checkpoint/challenge/",
        "https://www.linkedin.com/challenge/"
    ]) {
        authResources = fakeResources();
        authPage = new AuthenticationPage({ url: challengeUrl });
        await assert.rejects(
            () => verify(authPage, 45000, { browser: authResources.browser, context: authResources.context }),
            error => error.code === "LINKEDIN_CHALLENGE_REQUIRED"
        );
    }

    authResources = fakeResources();
    authPage = new AuthenticationPage({ unauthenticatedUi: true });
    await assert.rejects(
        () => verify(authPage, 45000, { browser: authResources.browser, context: authResources.context }),
        error => error.code === "LINKEDIN_AUTH_REQUIRED"
    );

    authResources = fakeResources();
    authPage = new AuthenticationPage({ shell: false, search: false, navigation: false });
    await assert.rejects(
        () => verify(authPage, 45000, { browser: authResources.browser, context: authResources.context }),
        error => error.code === "LINKEDIN_AUTH_INDICATORS_MISSING" &&
            /indicators could not be verified/i.test(error.message)
    );

    const authenticationLogs = [];
    authResources = fakeResources();
    authPage = new AuthenticationPage({ closeDuringVerification: true });
    authResources.page = authPage;
    authResources.context.page = authPage;
    const closingLifecycle = startBrowser.createBrowserLifecycle({
        ...authResources,
        log: (message, details) => authenticationLogs.push({ message, details })
    });
    const originalConsoleLog = console.log;
    const closingAuthenticationLogs = [];
    console.log = (...args) => closingAuthenticationLogs.push(args);
    await assert.rejects(
        () => verify(authPage, 45000, {
            browser: authResources.browser,
            context: authResources.context,
            lifecycle: closingLifecycle
        }),
        error => error.code === "LINKEDIN_PAGE_CLOSED_DURING_AUTH" &&
            /session is no longer active/i.test(error.message) &&
            error.details.page_closed === true &&
            error.details.context_closed === false &&
            error.details.browser_connected === true
    );
    console.log = originalConsoleLog;
    assert.strictEqual(
        closingAuthenticationLogs.some(args => args[0] === "LinkedIn session verified."),
        false
    );
    assert.strictEqual(
        authenticationLogs.find(entry => entry.details.event === "page_closed").details.authentication_confirmed,
        false
    );

    const browserSource = fs.readFileSync(path.join(__dirname, "..", "services", "browser.js"), "utf8");
    const successLogIndex = browserSource.indexOf('console.log("LinkedIn session verified.")');
    const authFunctionEnd = browserSource.indexOf("\\n}", successLogIndex);
    assert.ok(successLogIndex > 0);
    assert.strictEqual(
        browserSource.slice(successLogIndex, authFunctionEnd).includes("waitForTimeout"),
        false,
        "no page-bound wait may follow final authentication verification"
    );
    const pipelineSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
    const liveAssertionIndex = pipelineSource.indexOf(
        'session.lifecycle.assertLive("before_target_search", "startup helper returned a verified live page")'
    );
    const targetSearchIndex = pipelineSource.indexOf("await searchTarget(page);", liveAssertionIndex);
    assert.ok(liveAssertionIndex > 0, "the authenticated session must be asserted live before target search");
    assert.ok(targetSearchIndex > liveAssertionIndex, "a valid authenticated session must reach searchTarget(page)");

    console.log("Browser lifecycle tests passed.");
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
