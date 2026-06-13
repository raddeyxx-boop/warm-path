const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });

  const context = await browser.newContext({
    storageState: './sessions/linkedin.json'
  });

  const page = await context.newPage();

  await page.goto(
    'https://www.linkedin.com/feed/',
    {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    }
  );

  console.log('SUCCESS');
  console.log('URL:', page.url());
})();