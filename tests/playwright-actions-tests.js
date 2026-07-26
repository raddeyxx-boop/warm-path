const assert = require("assert");
const { resilientClick } = require("../services/playwright-actions");

function createLocator({ clickError = null, pressError = null, domError = null } = {}) {
    const calls = [];
    let clicks = 0;
    const page = { waitForTimeout: async () => {} };
    return {
        calls,
        page: () => page,
        waitFor: async () => calls.push("waitFor"),
        scrollIntoViewIfNeeded: async () => calls.push("scroll"),
        boundingBox: async () => ({ x: 10, y: 10, width: 100, height: 30 }),
        hover: async () => calls.push("hover"),
        click: async options => {
            calls.push(options.force ? "forceClick" : "click");
            clicks += 1;
            if (clicks === 1 && clickError) throw clickError;
        },
        focus: async () => calls.push("focus"),
        press: async () => {
            calls.push("press");
            if (pressError) throw pressError;
        },
        evaluate: async callback => {
            const source = callback.toString();
            if (source.includes("elementFromPoint")) return false;
            if (source.includes("getAttribute")) return { role: "button", type: "" };
            calls.push("domClick");
            if (domError) throw domError;
            return undefined;
        }
    };
}

async function run() {
    const normal = createLocator();
    assert.strictEqual(await resilientClick(normal, { context: "test.normal", delay: 1 }), "normal");
    assert.deepStrictEqual(normal.calls.slice(0, 4), ["waitFor", "scroll", "hover", "click"]);

    const intercepted = createLocator({ clickError: new Error("subtree intercepts pointer events") });
    assert.strictEqual(await resilientClick(intercepted, { context: "test.intercepted" }), "keyboard");
    assert.ok(intercepted.calls.indexOf("press") > intercepted.calls.indexOf("click"));
    assert.strictEqual(intercepted.calls.includes("forceClick"), false);

    const forced = createLocator({
        clickError: new Error("locator.click: Timeout exceeded"),
        pressError: new Error("not focusable"),
        domError: new Error("detached")
    });
    assert.strictEqual(await resilientClick(forced, { context: "test.force" }), "force");
    assert.strictEqual(forced.calls.at(-1), "forceClick");

    const fatal = createLocator({ clickError: new Error("Browser has been closed") });
    await assert.rejects(() => resilientClick(fatal, { context: "test.fatal" }), /Non-recoverable click failure/);
    console.log("Playwright action tests passed.");
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
