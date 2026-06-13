const { chromium } = require('playwright');

(async () => {
  const context = await chromium.launchPersistentContext(
    'C:\\Users\\3iwa\\AppData\\Local\\Microsoft\\Edge\\User Data',
    {
      channel: 'msedge',
      headless: false,
      args: ['--profile-directory=Default']
    }
  );

  const page = context.pages()[0] || await context.newPage();

  console.log('Starting URL:', page.url());

  await page.goto('https://www.linkedin.com/feed/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  console.log('Final URL:', page.url());

  await page.waitForTimeout(10000);
})();