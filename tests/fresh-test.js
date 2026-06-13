const { chromium } = require('playwright');

(async () => {
  const context = await chromium.launchPersistentContext(
    './linkedin-profile',
    {
      headless: false
    }
  );

  const page = context.pages()[0] || await context.newPage();

  await page.goto('https://www.linkedin.com/login');
})();