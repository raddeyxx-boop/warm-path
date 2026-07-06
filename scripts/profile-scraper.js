async function scrapeProfile(page) {


  const profile = await page.evaluate(() => {

    const getText = (selector) =>
      document.querySelector(selector)?.innerText?.trim() || '';

    const name =
      getText('h1');

    const headline =
      getText('.text-body-medium');

    const location =
      getText('.text-body-small.inline');

    const aboutSection =
      document.querySelector('#about');

    const about =
      aboutSection?.parentElement?.innerText || '';

   return {
  name,
  headline,
  location,
  about,
  title: document.title,
  h1Count: document.querySelectorAll("h1").length,
  bodyLength: document.body.innerText.length
};
  });

  return profile;
}

module.exports = { scrapeProfile };