const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP(
    'http://127.0.0.1:9222'
  );

  const context = browser.contexts()[0];

  const cookies = await context.cookies();

  console.log(
    cookies.filter(c => c.domain.includes('linkedin'))
  );
})();