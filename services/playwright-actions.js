const POINTER_RECOVERY_PATTERN = /intercepts pointer events|not stable|detached|not attached|outside of the viewport|another element|timeout/i;

function actionLog(context, message, details = {}) {
    console.log(`[playwright-actions:${context}] ${message}`, details);
}

async function waitForLocatorStability(locator, timeout = 3000) {
    const deadline = Date.now() + timeout;
    let previous = null;
    while (Date.now() < deadline) {
        const box = await locator.boundingBox().catch(() => null);
        if (box && previous && Math.abs(box.x - previous.x) < 2 && Math.abs(box.y - previous.y) < 2 &&
            Math.abs(box.width - previous.width) < 2 && Math.abs(box.height - previous.height) < 2) return true;
        previous = box;
        await locator.page().waitForTimeout(120);
    }
    return false;
}

async function isLocatorCovered(locator) {
    return locator.evaluate(element => {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return true;
        const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
        const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && hit !== element && !element.contains(hit));
    }).catch(() => true);
}

async function keyboardActivate(locator) {
    const metadata = await locator.evaluate(element => ({
        role: element.getAttribute("role") || "",
        type: element.getAttribute("type") || ""
    }));
    const key = metadata.role === "checkbox" || metadata.type === "checkbox" ? "Space" : "Enter";
    await locator.focus({ timeout: 2000 });
    await locator.press(key, { timeout: 2000 });
}

async function resilientClick(locator, options = {}) {
    const context = options.context || "unknown-action";
    const timeout = options.timeout || 7000;
    const page = options.page || locator.page();
    await locator.waitFor({ state: "visible", timeout });
    await locator.scrollIntoViewIfNeeded({ timeout });
    if (!await waitForLocatorStability(locator, Math.min(timeout, 3000))) {
        actionLog(context, "Element did not fully settle; continuing with locator re-resolution.");
    }
    if (await isLocatorCovered(locator)) {
        actionLog(context, "Element center is covered; attempting normal click before recovery.");
    }
    await locator.hover({ timeout: Math.min(timeout, 2500) }).catch(error => {
        actionLog(context, "Hover failed; preserving click attempt.", { reason: error.message });
    });
    if (options.pauseBeforeClick) await options.pauseBeforeClick(page);
    try {
        await locator.click({ delay: options.delay, timeout });
        return "normal";
    } catch (error) {
        if (!POINTER_RECOVERY_PATTERN.test(error.message || "")) {
            throw new Error(`[${context}] Non-recoverable click failure: ${error.message}`, { cause: error });
        }
        actionLog(context, "Normal click failed.", { reason: error.message, recovery: "keyboard activation" });
    }
    try {
        await keyboardActivate(locator);
        return "keyboard";
    } catch (error) {
        actionLog(context, "Keyboard activation failed.", { reason: error.message, recovery: "DOM activation" });
    }
    try {
        await locator.evaluate(element => { element.focus(); element.click(); });
        return "dom";
    } catch (error) {
        actionLog(context, "DOM activation failed.", { reason: error.message, recovery: "last-resort force click" });
    }
    await locator.click({ delay: options.delay, timeout: Math.min(timeout, 3000), force: true });
    actionLog(context, "Force click succeeded as last resort.");
    return "force";
}

module.exports = { isLocatorCovered, resilientClick, waitForLocatorStability };
