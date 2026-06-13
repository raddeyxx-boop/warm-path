const fs = require('fs');

async function collectProfileInfo(page) {

    const text = await page.locator('main').textContent();

    return {
        headline: text.substring(0, 500)
    };
}

async function collectPostLinks(page) {

    const links = await page.locator('a').evaluateAll(
        els => els
            .map(a => a.href)
            .filter(h =>
                h.includes('/posts/') ||
                h.includes('/activity/')
            )
    );

    return [...new Set(links)];
}

module.exports = {
    collectProfileInfo,
    collectPostLinks
};