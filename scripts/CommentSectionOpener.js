const fs = require("fs/promises");
const path = require("path");

const FAILURE_DIR = path.resolve(__dirname, "..", "debug", "comment-open-failures");
const EDITOR_SELECTORS = [
    'div[contenteditable="true"]',
    '[role="textbox"]',
    '[contenteditable="plaintext-only"]',
    'div[data-placeholder*="comment" i]',
    '[aria-label*="comment" i][contenteditable="true"]',
    'textarea[aria-label*="comment" i]',
    'textarea'
].join(", ");

function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

async function pause(page, minMs, maxMs) {
    await page.waitForTimeout(randomInt(minMs, maxMs));
}

async function smallMouseMovement(page) {
    const viewport = page.viewportSize();

    if (!viewport) {
        return;
    }

    await page.mouse.move(
        randomInt(80, Math.max(120, viewport.width - 120)),
        randomInt(90, Math.max(130, viewport.height - 120)),
        {
            steps: randomInt(8, 18)
        }
    );
}

async function resolvePostScope(page, postLocator) {
    if (postLocator) {
        return postLocator;
    }

    console.log("Warning: openCommentSection called without a post locator. Using first visible post.");
    return page.locator("main article, main [data-urn*='activity'], main [data-id*='urn:li:activity']").first();
}

async function findFirstVisible(locator, limit = 30, visibleTimeoutMs = 350) {
    const count = Math.min(await locator.count().catch(() => 0), limit);

    for (let i = 0; i < count; i++) {
        const candidate = locator.nth(i);

        if (await candidate.isVisible({ timeout: visibleTimeoutMs }).catch(() => false)) {
            return candidate;
        }
    }

    return null;
}

async function findVisibleButtonByMetadata(root, predicate, limit = 80, visibleTimeoutMs = 250) {
    const buttons = root.locator("button, [role='button']");
    const count = Math.min(await buttons.count().catch(() => 0), limit);

    for (let i = 0; i < count; i++) {
        const button = buttons.nth(i);

        if (!(await button.isVisible({ timeout: visibleTimeoutMs }).catch(() => false))) {
            continue;
        }

        const metadata = await button.evaluate(element => {
            const clean = value => (value || "").replace(/\s+/g, " ").trim().toLowerCase();
            const nearestActionText = clean(
                element.closest('[role="group"], section, footer, div')?.innerText || ""
            );
            const svgText = [...element.querySelectorAll("svg, svg *, title, use")]
                .map(node => [
                    node.getAttribute?.("aria-label"),
                    node.getAttribute?.("data-test-icon"),
                    node.getAttribute?.("href"),
                    node.getAttribute?.("xlink:href"),
                    node.id,
                    node.textContent
                ].filter(Boolean).join(" "))
                .join(" ");

            return {
                aria: clean(element.getAttribute("aria-label")),
                controlName: clean(element.getAttribute("data-control-name")),
                text: clean(element.innerText || element.textContent),
                svg: clean(svgText),
                actionText: nearestActionText,
                hasCommentSvg: Boolean(
                    element.querySelector('svg#comment-small, svg[id*="comment" i], svg[aria-label*="comment" i]')
                )
            };
        }).catch(() => null);

        if (metadata && predicate(metadata)) {
            return button;
        }
    }

    return null;
}

async function humanClickCommentButton(page, button, options = {}) {
    const hoverMinMs = options.hoverMinMs || 700;
    const hoverMaxMs = options.hoverMaxMs || 1800;
    const actionTimeoutMs = options.actionTimeoutMs || 3500;

    await button.waitFor({
        state: "visible",
        timeout: Math.min(actionTimeoutMs, 3000)
    });

    const box = await button.boundingBox();

    if (box) {
        await page.mouse.move(
            box.x + box.width * (0.35 + Math.random() * 0.3),
            box.y + box.height * (0.35 + Math.random() * 0.3),
            {
                steps: randomInt(12, 28)
            }
        );
    }

    console.log("Hovering...");
    await button.hover({
        timeout: Math.min(actionTimeoutMs, 2500)
    }).catch(() => {});
    console.log("Waiting...");
    await pause(page, hoverMinMs, hoverMaxMs);
    console.log("Clicking...");
    await button.click({
        delay: randomInt(70, 170),
        timeout: actionTimeoutMs
    });
    console.log("Comment button clicked.");
}

async function waitForCommentEditor(page, postLocator, timeoutMs = 4500) {
    console.log("Waiting for editor...");

    const scopedEditor = postLocator.locator(EDITOR_SELECTORS).last();

    if (await scopedEditor.isVisible({ timeout: timeoutMs }).catch(() => false)) {
        console.log("Editor detected.");
        return true;
    }

    const pageEditor = page.locator(EDITOR_SELECTORS).last();

    if (await pageEditor.isVisible({ timeout: Math.min(timeoutMs, 1500) }).catch(() => false)) {
        console.log("Editor detected.");
        return true;
    }

    return false;
}

function createStrategies(root, options = {}) {
    const candidateLimit = options.candidateLimit || 30;
    const metadataCandidateLimit = options.metadataCandidateLimit || 80;
    const visibleTimeoutMs = options.visibleProbeTimeoutMs || 350;

    return [
        {
            number: 1,
            selector: 'role=button[name=/comment/i], [aria-label*="Comment"]',
            find: async () => {
                const roleButton = await findFirstVisible(
                    root.getByRole("button", {
                        name: /comment/i
                    }),
                    candidateLimit,
                    visibleTimeoutMs
                );

                if (roleButton) {
                    return roleButton;
                }

                return await findFirstVisible(
                    root.locator('button[aria-label*="Comment" i], [role="button"][aria-label*="Comment" i]'),
                    candidateLimit,
                    visibleTimeoutMs
                );
            }
        },
        {
            number: 2,
            selector: "current-post action buttons with visible text Comment",
            find: async () => await findVisibleButtonByMetadata(
                root,
                metadata => {
                    const hasCommentText = /\bcomment\b/i.test([
                        metadata.text,
                        metadata.aria
                    ].join(" "));
                    const looksLikeActionBar = /\blike\b/i.test(metadata.actionText) &&
                        /(\brepost\b|\bsend\b)/i.test(metadata.actionText);

                    return hasCommentText && looksLikeActionBar;
                },
                metadataCandidateLimit,
                visibleTimeoutMs
            )
        },
        {
            number: 3,
            selector: 'button containing svg#comment-small or svg[id*="comment"]',
            find: async () => {
                const svgButton = await findFirstVisible(root.locator([
                    'button:has(svg#comment-small)',
                    '[role="button"]:has(svg#comment-small)',
                    'button:has(svg[id*="comment" i])',
                    '[role="button"]:has(svg[id*="comment" i])',
                    'button:has(svg[aria-label*="comment" i])',
                    '[role="button"]:has(svg[aria-label*="comment" i])'
                ].join(", ")), candidateLimit, visibleTimeoutMs);

                if (svgButton) {
                    return svgButton;
                }

                return await findVisibleButtonByMetadata(
                    root,
                    metadata => metadata.hasCommentSvg || /\bcomment\b/i.test(metadata.svg),
                    metadataCandidateLimit,
                    visibleTimeoutMs
                );
            }
        },
        {
            number: 4,
            selector: "stable role/aria/data-control-name/visible text comment controls",
            find: async () => {
                const stableAttributeButton = await findFirstVisible(root.locator([
                    'button[data-control-name*="comment" i]',
                    '[role="button"][data-control-name*="comment" i]',
                    'button[aria-label*="Comment on" i]',
                    '[role="button"][aria-label*="Comment on" i]'
                ].join(", ")), candidateLimit, visibleTimeoutMs);

                if (stableAttributeButton) {
                    return stableAttributeButton;
                }

                return await findVisibleButtonByMetadata(
                    root,
                    metadata => /\bcomment\b/i.test([
                        metadata.text,
                        metadata.aria,
                        metadata.controlName
                    ].join(" ")),
                    metadataCandidateLimit,
                    visibleTimeoutMs
                );
            }
        }
    ];
}

async function captureFailureArtifacts(page, postLocator, attempts) {
    try {
        await fs.mkdir(FAILURE_DIR, {
            recursive: true
        });

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const basePath = path.join(FAILURE_DIR, "comment-open-" + timestamp);
        const postHtml = await postLocator.evaluate(element => element.outerHTML).catch(() => "");
        const pageHtml = await page.content().catch(() => "");
        const payload = {
            url: page.url(),
            attempts,
            capturedAt: new Date().toISOString(),
            postHtml,
            pageHtmlPath: basePath + ".page.html",
            postHtmlPath: basePath + ".post.html"
        };

        await page.screenshot({
            path: basePath + ".png",
            fullPage: true
        }).catch(() => {});
        await fs.writeFile(basePath + ".json", JSON.stringify(payload, null, 2), "utf8");
        await fs.writeFile(basePath + ".page.html", pageHtml, "utf8");
        await fs.writeFile(basePath + ".post.html", postHtml, "utf8");

        console.log("Captured comment failure artifacts:", basePath);
    } catch (err) {
        console.log("Could not capture comment failure artifacts:", err.message);
    }
}

async function openCommentSection(page, postLocator, options = {}) {
    const postScope = await resolvePostScope(page, postLocator);
    const strategies = createStrategies(postScope, options);
    const attempts = [];
    const maxTotalMs = options.maxTotalMs || 0;
    const startedAt = Date.now();
    const maxStrategies = options.maxStrategies || strategies.length;
    const editorTimeoutMs = options.editorTimeoutMs || 4500;
    const shouldCaptureFailure = options.captureFailure !== false;

    console.log("Searching for Comment button...");

    for (const strategy of strategies.slice(0, maxStrategies)) {
        if (maxTotalMs && Date.now() - startedAt >= maxTotalMs) {
            attempts.push({
                strategy: strategy.number,
                selector: strategy.selector,
                result: "time-budget-exceeded"
            });
            break;
        }

        console.log(`Trying strategy ${strategy.number}...`);

        if (strategy.number > 1) {
            await smallMouseMovement(page).catch(() => {});
            await pause(page, 500, 1200).catch(() => {});
        }

        try {
            const button = await strategy.find();

            if (!button) {
                attempts.push({
                    strategy: strategy.number,
                    selector: strategy.selector,
                    result: "button-not-found"
                });
                console.log(`Strategy ${strategy.number} failed.`);
                continue;
            }

            console.log("Comment button found.");
            await humanClickCommentButton(page, button, options);

            if (await waitForCommentEditor(page, postScope, editorTimeoutMs)) {
                attempts.push({
                    strategy: strategy.number,
                    selector: strategy.selector,
                    result: "editor-detected"
                });
                console.log("Comment section opened successfully.");
                return true;
            }

            attempts.push({
                strategy: strategy.number,
                selector: strategy.selector,
                result: "editor-not-detected"
            });
            console.log(`Strategy ${strategy.number} failed.`);
        } catch (err) {
            attempts.push({
                strategy: strategy.number,
                selector: strategy.selector,
                result: "error",
                error: err.message
            });
            console.log(`Strategy ${strategy.number} failed:`, err.message);
        }
    }

    console.log("Failed to open comment section.");
    if (shouldCaptureFailure) {
        await captureFailureArtifacts(page, postScope, attempts);
    }
    return false;
}

module.exports = {
    openCommentSection
};
