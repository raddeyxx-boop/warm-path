const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP(
      'http://127.0.0.1:9222'
    );

    console.log('Connected to Chrome');

    const context = browser.contexts()[0];

    const page =
      context.pages()[0] || await context.newPage();

    await page.goto('https://www.linkedin.com/feed/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    console.log('Current URL:', page.url());

  } catch (err) {
    console.error(err);
  }
})();