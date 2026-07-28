const {
    HUMAN_BEHAVIOR_CONFIG
} = require("../utils/HumanBehaviorConfig");
const {
    selectRandomComment
} = require("../utils/CommentRandomizer");
const {
    openCommentSection
} = require("./CommentSectionOpener");
const { resilientClick } = require("../services/playwright-actions");

const COMMENT_EDITOR_SELECTORS = [
    '[contenteditable="true"]',
    '[role="textbox"]',
    '[contenteditable="plaintext-only"]',
    'div[data-placeholder*="comment" i]',
    'textarea'
].join(", ");

function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

async function pause(page, minMs, maxMs) {
    if (!page || page.isClosed()) {
        return;
    }

    await page.waitForTimeout(randomInt(minMs, maxMs)).catch(err => {
        console.log("Human pause skipped:", err.message);
    });
}

async function moveMouseNaturally(page) {
    const viewport = page.viewportSize();

    if (!viewport) {
        return;
    }

    const startX = randomInt(80, Math.max(100, viewport.width - 120));
    const startY = randomInt(90, Math.max(110, viewport.height - 120));
    const endX = randomInt(80, Math.max(100, viewport.width - 120));
    const endY = randomInt(90, Math.max(110, viewport.height - 120));
    const midX = Math.round((startX + endX) / 2 + randomInt(-140, 140));
    const midY = Math.round((startY + endY) / 2 + randomInt(-90, 90));
    const overshoot = Math.random() < 0.22;

    await page.mouse.move(startX, startY, {
        steps: randomInt(5, 12)
    }).catch(() => {});
    await page.mouse.move(midX, midY, {
        steps: randomInt(8, 18)
    }).catch(() => {});

    if (overshoot) {
        await page.mouse.move(
            endX + randomInt(-25, 25),
            endY + randomInt(-18, 18),
            {
                steps: randomInt(4, 10)
            }
        ).catch(() => {});
        await pause(page, 80, 220);
    }

    await page.mouse.move(endX, endY, {
        steps: randomInt(8, 20)
    }).catch(() => {});
    console.log("Mouse movement...");
}

async function safeHumanAction(label, action) {
    try {
        return await action();
    } catch (err) {
        console.log(`${label} skipped:`, err.message);
        return null;
    }
}

function randomScrollDistance(helpers) {
    const ranges = [
        [100, 250],
        [250, 450],
        [450, 700],
        [700, 1000]
    ];
    const selected = ranges[randomInt(0, ranges.length - 1)];
    const min = Math.max(helpers.scrollMinPx || 100, selected[0]);
    const max = Math.max(min, Math.min(helpers.scrollMaxPx || selected[1], selected[1]));

    return randomInt(min, max);
}

async function maybeHoverAmbientElement(page) {
    if (Math.random() > 0.28) {
        return;
    }

    const selectors = [
        "main img",
        "aside a",
        "nav a",
        "header a",
        "main button"
    ];
    const selector = selectors[randomInt(0, selectors.length - 1)];
    const candidates = page.locator(selector);
    const indices = Array.from({ length: Math.min(await candidates.count().catch(() => 0), 12) }, (_, index) => index)
        .sort(() => Math.random() - 0.5).slice(0, 6);

    for (const index of indices) {
        const candidate = candidates.nth(index);
        const box = await candidate.boundingBox().catch(() => null);

        if (!box || box.width < 12 || box.height < 12) {
            continue;
        }

        await candidate.hover({
            timeout: 1200
        }).catch(() => {});
        await pause(page, 350, 1400);
        return;
    }
}

async function getVisiblePost(page) {
    const posts = page.locator("main article, main [data-urn*='activity'], main [data-id*='urn:li:activity']");
    const count = Math.min(await posts.count(), 12);
    const visiblePosts = [];

    for (let i = 0; i < count; i++) {
        const post = posts.nth(i);
        const box = await post.boundingBox().catch(() => null);

        if (box && box.width > 280 && box.height > 120) {
            visiblePosts.push(post);
        }
    }

    if (!visiblePosts.length) {
        return null;
    }

    return visiblePosts[randomInt(0, visiblePosts.length - 1)];
}

async function getPostText(post) {
    return await post.innerText({
        timeout: 2000
    }).catch(() => "");
}

async function expandFirstPostIfNeeded(page, post, options = {}) {
    console.log('Searching "... more"...');
    const moreButton = post.locator('button[data-testid="expandable-text-button"]').first();
    const locateTimeoutMs = options.locateTimeoutMs || 3000;

    if (!(await moreButton.isVisible({ timeout: locateTimeoutMs }).catch(() => false))) {
        console.log("No expandable post found.");
        console.log('"... more" not found.');
        console.log("Skipping expansion.");
        return false;
    }

    await pause(page, options.waitBeforeClickMinMs || 500, options.waitBeforeClickMaxMs || 1500);
    await resilientClick(moreButton, {
        context: "HumanActivity.expandFirstPostIfNeeded",
        page,
        delay: randomInt(70, 180),
        timeout: 3000,
        pauseBeforeClick: () => pause(page, 300, 800)
    });

    await moreButton.waitFor({
        state: "hidden",
        timeout: 3000
    }).catch(() => {});
    await pause(page, 500, 1200);

    console.log("Expanded post.");
    return true;
}

async function readExpandedPostNaturally(page) {
    console.log("Reading post...");
    await moveMouseNaturally(page);
    await pause(page, 5000, 12000);
    await moveMouseNaturally(page);
}

function isProbablyEnglish(text) {
    const letters = text.match(/[A-Za-z]/g) || [];
    const nonAscii = text.match(/[^\x00-\x7F]/g) || [];
    const commonEnglishWords = text.match(
        /\b(the|and|for|with|this|that|you|your|from|about|what|how|why|learn|work|team|business|technology|product|career|leadership|engineering|ai|data)\b/gi
    ) || [];

    if (letters.length < 20) {
        return false;
    }

    return letters.length >= nonAscii.length * 3 && commonEnglishWords.length >= 2;
}

function isSuitableProfessionalPost(text) {
    const normalized = (text || "").replace(/\s+/g, " ").trim().toLowerCase();

    if (!isProbablyEnglish(normalized)) {
        return false;
    }

    const blockedPatterns = [
        /\b(we'?re|we are|i'?m|i am)\s+(hiring|looking for|recruiting)\b/i,
        /\b(job opening|open role|apply now|send your cv|send your resume|vacancy|hiring alert)\b/i,
        /\b(rest in peace|rip|memorial|passed away|funeral|condolences|in memory)\b/i,
        /\b(my wife|my husband|my son|my daughter|my baby|my family|anniversary|birthday|wedding)\b/i,
        /\b(election|politics|political|government|war|religion|religious|protest|conflict)\b/i,
        /\b(tragedy|death|died|illness|cancer|hospital|accident|victim|attack)\b/i
    ];

    if (blockedPatterns.some(pattern => pattern.test(normalized))) {
        return false;
    }

    const allowedPatterns = [
        /\b(professional|business|startup|company|customer|sales|marketing|operations)\b/i,
        /\b(technology|tech|software|engineering|developer|product|design|data|ai|automation|cloud|security)\b/i,
        /\b(leadership|management|strategy|innovation|learning|career|growth|education|mentor|team)\b/i,
        /\b(process|workflow|insight|framework|lesson|skill|performance|project|research)\b/i
    ];

    return allowedPatterns.some(pattern => pattern.test(normalized));
}

async function getSuitableVisiblePost(page) {
    const posts = page.locator("main article, main [data-urn*='activity'], main [data-id*='urn:li:activity']");
    const count = Math.min(await posts.count(), 20);
    const suitablePosts = [];

    for (let i = 0; i < count; i++) {
        const post = posts.nth(i);
        const box = await post.boundingBox().catch(() => null);

        if (!box || box.width <= 280 || box.height <= 120) {
            continue;
        }

        const text = await getPostText(post);

        if (isSuitableProfessionalPost(text)) {
            suitablePosts.push(post);
        }
    }

    if (!suitablePosts.length) {
        console.log("No suitable professional English post found for commenting.");
        return null;
    }

    return suitablePosts[randomInt(0, suitablePosts.length - 1)];
}

async function openRandomPost(page, post) {
    console.log("Opening random post...");

    await post.scrollIntoViewIfNeeded().catch(() => {});
    await pause(page, 500, 1200);

    const seeMoreButton = post.getByRole("button", {
        name: /see more|more/i
    }).first();

    if (await seeMoreButton.isVisible({ timeout: 1200 }).catch(() => false)) {
        await resilientClick(seeMoreButton, {
            context: "HumanActivity.openRandomPost", page,
            delay: randomInt(60, 150), timeout: 3000
        }).catch(error => console.log("Post expansion failed. Continuing to read:", error.message));
    }

    await pause(page, 1600, 3600);
}

async function readBeforeCommenting(page) {
    console.log("Reading post before commenting...");
    await pause(page, 8000, 20000);
    await moveMouseNaturally(page);
}

async function maybeLikePost(page, post, config = HUMAN_BEHAVIOR_CONFIG) {
    if (config.allowPostEngagement === false || config.allowLikes === false) {
        console.log("Skipping like during read-only browsing session.");
        return false;
    }

    if (Math.random() > config.likeProbability) {
        console.log("Skipping like during this browsing session.");
        return false;
    }

    try {
        const likeButton = post.getByRole("button", {
            name: /^like\b/i
        }).first();

        if (!(await likeButton.isVisible({ timeout: 2500 }).catch(() => false))) {
            console.log("Like button not available for selected post.");
            return false;
        }

        const alreadyLiked = await likeButton.evaluate(button =>
            button.getAttribute("aria-pressed") === "true" ||
            /\bunlike\b/i.test(button.getAttribute("aria-label") || "")
        ).catch(() => false);

        if (alreadyLiked) {
            console.log("Post is already liked. Skipping like click.");
            return false;
        }

        await resilientClick(likeButton, {
            context: "HumanActivity.maybeLikePost", page,
            delay: randomInt(70, 190), timeout: 3000,
            pauseBeforeClick: () => pause(page, 300, 800)
        });
        console.log("Liked random post.");
        await pause(page, 650, 1400);
        return true;
    } catch (err) {
        console.log("Liking failed. Continuing browsing:", err.message);
        return false;
    }
}

async function typeComment(page, post, comment, options = {}) {
    let textbox = post.locator(COMMENT_EDITOR_SELECTORS).last();
    const timeoutMs = options.timeoutMs || 5000;

    if (!(await textbox.isVisible({ timeout: Math.min(timeoutMs, 2500) }).catch(() => false))) {
        textbox = page.locator(COMMENT_EDITOR_SELECTORS).last();
    }

    await textbox.waitFor({
        state: "visible",
        timeout: timeoutMs
    });
    await textbox.focus({ timeout: timeoutMs });
    if (!await textbox.evaluate(element => element === document.activeElement)) {
        await textbox.evaluate(element => element.focus());
    }

    for (const char of comment) {
        await page.keyboard.type(char, {
            delay: randomInt(25, 75)
        });
    }
}

async function submitComment(page, post) {
    const submitButton = post.getByRole("button", {
        name: /^(post|comment|send)$/i
    }).last();

    if (await submitButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await resilientClick(submitButton, {
            context: "HumanActivity.submitComment", page,
            delay: randomInt(60, 150), timeout: 3000
        });
        return true;
    }

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    return true;
}

async function verifyCommentSubmitted(page, comment) {
    await pause(page, 2000, 5000);

    const visibleComment = page.getByText(comment, {
        exact: true
    }).last();

    if (await visibleComment.isVisible({ timeout: 5000 }).catch(() => false)) {
        return true;
    }

    const activeEditorWithComment = page.locator([
        '[contenteditable="true"]',
        '[role="textbox"]',
        'textarea'
    ].join(", ")).filter({
        hasText: comment
    });

    return !(await activeEditorWithComment.first().isVisible({ timeout: 1000 }).catch(() => false));
}

async function commentOnHomeFeedPostAfterBrowsing(page, config = HUMAN_BEHAVIOR_CONFIG) {
    if (config.allowPostEngagement === false || config.allowComments === false) {
        console.log("Skipping initial Home Feed comment during read-only browsing session.");
        return false;
    }

    if (Math.random() > config.commentProbability) {
        console.log("Skipping initial Home Feed comment by probability.");
        return false;
    }

    try {
        console.log("Selecting visible Home Feed post after browsing...");
        const post = await getVisiblePost(page);

        if (!post) {
            console.log("No visible Home Feed post found for initial comment.");
            return false;
        }

        await post.scrollIntoViewIfNeeded().catch(() => {});
        await pause(page, 900, 1800);
        await expandFirstPostIfNeeded(page, post, {
            waitBeforeClickMinMs: 1000,
            waitBeforeClickMaxMs: 3000
        });
        await readExpandedPostNaturally(page);

        console.log("Opening comments...");

        if (!(await openCommentSection(page, post))) {
            console.log("Could not open comments for initial Home Feed post.");
            return false;
        }

        await pause(page, 1000, 3000);

        const comment = selectRandomComment({
            recentWindow: config.recentCommentWindow
        });

        console.log("Typing comment...");
        await typeComment(page, post, comment);
        await pause(page, 1000, 2000);

        if (!(await submitComment(page, post))) {
            console.log("Initial Home Feed comment submit button was not available.");
            return false;
        }

        if (await verifyCommentSubmitted(page, comment)) {
            console.log("Comment submitted successfully.");
            await pause(page, 3000, 7000);
            await moveMouseNaturally(page);
            return true;
        }

        console.log("Could not verify initial Home Feed comment submission.");
        return false;
    } catch (err) {
        console.log("Initial Home Feed comment failed. Continuing workflow:", err.message);
        return false;
    }
}

async function performInitialHomeFeedCommentSession(page, helpers, config = HUMAN_BEHAVIOR_CONFIG) {
    console.log("Starting initial browsing...");
    console.log("Initial Home Feed browsing must complete before any search.");

    await performHumanBrowsingSession(page, helpers, {
        ...config,
        allowPostEngagement: false,
        allowLikes: false,
        allowComments: false,
        likeProbability: 0,
        commentProbability: 0,
        requireVisibleScroll: true,
        completionLog: "Initial browsing complete."
    });

    console.log("Initial browsing complete. Preparing one Home Feed comment.");
    await commentOnHomeFeedPostAfterBrowsing(page, config);
    console.log("Initial Home Feed interaction complete.");
}

async function commentOnPost(page, post, config = HUMAN_BEHAVIOR_CONFIG) {
    if (config.allowPostEngagement === false || config.allowComments === false) {
        console.log("Skipping comment during read-only browsing session.");
        return false;
    }

    if (Math.random() > config.commentProbability) {
        console.log("Skipping comment during this browsing session.");
        return false;
    }

    try {
        console.log("Posting random comment...");

        const postText = await getPostText(post);

        if (!isSuitableProfessionalPost(postText)) {
            console.log("Selected post is not suitable for commenting. Skipping comment.");
            return false;
        }

        await post.scrollIntoViewIfNeeded().catch(() => {});
        await pause(page, 400, 1000);
        await readBeforeCommenting(page);

        if (!(await openCommentSection(page, post))) {
            console.log("Could not open comments for selected post.");
            return false;
        }

        await pause(page, 1000, 3000);

        const comment = selectRandomComment({
            recentWindow: config.recentCommentWindow
        });

        await typeComment(page, post, comment);
        await pause(page, 1000, 2000);
        await submitComment(page, post);
        console.log("Posted comment:");
        console.log(`"${comment}"`);
        await pause(page, 2000, 5000);
        return true;
    } catch (err) {
        console.log("Commenting failed. Skipping feed interaction:", err.message);
        return false;
    }
}

async function maybeCommentOnRandomPost(page, config = HUMAN_BEHAVIOR_CONFIG) {
    if (config.allowPostEngagement === false || config.allowComments === false) {
        console.log("Skipping random comment during read-only browsing session.");
        return false;
    }

    try {
        const post = await getSuitableVisiblePost(page);

        if (!post) {
            console.log("No suitable post available for commenting.");
            return false;
        }

        console.log("Selected random post...");
        await openRandomPost(page, post);

        return await commentOnPost(page, post, config);
    } catch (err) {
        console.log("Commenting failed. Skipping feed interaction:", err.message);
        return false;
    }
}

async function performHumanBrowsingSession(page, helpers, config = HUMAN_BEHAVIOR_CONFIG) {
    const sessionDuration = config.homeScrollDurationMs;
    const started = Date.now();
    let commentAttempted = false;
    let likeAttempted = false;
    let passivePostOpened = false;
    const readOnly = config.allowPostEngagement === false;
    const inlineFeedCommenting = config.allowInlineFeedCommenting === true;
    let visibleScrollCount = 0;

    console.log("Starting human browsing session...");
    console.log("[HUMAN_SCROLL] Helper: performHumanBrowsingSession");
    console.log("[HUMAN_SCROLL] Step range:",
        `${helpers.scrollMinPx || 100}-${helpers.scrollMaxPx || 400}px`);
    console.log("[HUMAN_SCROLL] Pause range: 800-2500ms");
    console.log("[HUMAN_SCROLL] Reading pause: 5000-12000ms");
    if (readOnly) {
        console.log("Read-only browsing session: likes and comments disabled.");
    }
    if (!config.skipOpenHome) {
        await helpers.openLinkedInHome(page);
    }

    await pause(page, 2000, 5000);
    await safeHumanAction("Initial home mouse movement", () => moveMouseNaturally(page));
    await safeHumanAction("Initial ambient hover", () => maybeHoverAmbientElement(page));

    if (Math.random() < 0.35) {
        console.log("Pausing before scrolling...");
        await pause(page, 2500, 6500);
    }

    await page.locator("main article, main [data-urn*='activity'], main [data-id*='urn:li:activity']").first().waitFor({
        state: "visible",
        timeout: 12000
    }).catch(() => {});

    console.log("Home loaded.");
    console.log("Scrolling home feed...");

    while (Date.now() - started < sessionDuration) {
        await safeHumanAction("Mouse movement", () => moveMouseNaturally(page));
        await safeHumanAction("Ambient hover", () => maybeHoverAmbientElement(page));
        console.log("Scrolling feed...");
        const scrollResult = await helpers.scrollPage(
            page,
            randomScrollDistance(helpers)
        );

        if (
            scrollResult &&
            Number.isFinite(scrollResult.beforeTop) &&
            Number.isFinite(scrollResult.afterTop) &&
            scrollResult.beforeTop !== scrollResult.afterTop
        ) {
            visibleScrollCount += 1;
        }

        if (
            scrollResult &&
            Number.isFinite(scrollResult.beforeTop) &&
            Number.isFinite(scrollResult.afterTop) &&
            scrollResult.beforeTop === scrollResult.afterTop
        ) {
            console.log("Feed scroll did not move. Trying mouse wheel fallback...");
            await page.mouse.wheel(0, randomInt(helpers.scrollMinPx, helpers.scrollMaxPx)).catch(() => {});
        }

        console.log("Reading posts...");
        await pause(page, 800, 2500);

        if (Math.random() < 0.18) {
            console.log("Reading a post...");
            await pause(page, 5000, 12000);
        }

        if (Math.random() < 0.08) {
            console.log("Idle pause...");
            await pause(page, 8000, 20000);
        }

        if (
            (!likeAttempted || !passivePostOpened || (inlineFeedCommenting && !commentAttempted)) &&
            Date.now() - started > sessionDuration * 0.25
        ) {
            const post = await getVisiblePost(page);

            if (post) {
                passivePostOpened = true;
                console.log("Selected random post...");
                await openRandomPost(page, post);
            }

            if (post && !likeAttempted) {
                likeAttempted = true;
                await maybeLikePost(page, post, config);
            }

            if (inlineFeedCommenting && post && !commentAttempted) {
                commentAttempted = true;
                const suitablePost = await getSuitableVisiblePost(page);

                if (suitablePost) {
                    console.log("Selected suitable post for commenting...");
                    await openRandomPost(page, suitablePost);
                    await commentOnPost(page, suitablePost, config);
                } else {
                    console.log("No suitable post found. Skipping comment for this browsing session.");
                }
            }

            console.log("Returning to feed...");
            await pause(page, 800, 1800);
        }

        if (inlineFeedCommenting && !commentAttempted && Date.now() - started > sessionDuration * 0.55) {
            commentAttempted = true;
            await maybeCommentOnRandomPost(page, config);
        }

        if (Math.random() < 0.18) {
            await helpers.scrollPage(page, -randomInt(50, 250));
            await pause(page, 800, 2500);
        }

        if (Math.random() < 0.2) {
            await pause(page, 1200, 4200);
        }
    }

    await pause(page, 1600, 3600);
    if (config.requireVisibleScroll && visibleScrollCount === 0) {
        console.log("Warning: human browsing session completed without visible feed scrolling.");
    }

    console.log(config.completionLog || "Returning to scraping...");
}

module.exports = {
    commentOnHomeFeedPostAfterBrowsing,
    commentOnPost,
    getVisiblePost,
    getSuitableVisiblePost,
    isProbablyEnglish,
    isSuitableProfessionalPost,
    maybeLikePost,
    maybeCommentOnRandomPost,
    openCommentSection,
    openRandomPost,
    performInitialHomeFeedCommentSession,
    performHumanBrowsingSession
};
