const profile = {
    url: profileUrl,
    name: '',
    headline: '',
    location: '',
    about: '',
    company: '',
    status: 'unknown'
};

try {
    profile.name = (
        await page.locator('h1').first().textContent()
    )?.trim() || '';
} catch {}

try {
    profile.headline = (
        await page.locator('.text-body-medium').first().textContent()
    )?.trim() || '';
} catch {}

try {
    profile.location = (
        await page.locator('.text-body-small').first().textContent()
    )?.trim() || '';
} catch {}