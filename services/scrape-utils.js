const fs = require('fs');
const path = require('path');
const { sleep } = require('../utils/delay');

const CACHE_FOLDER = path.resolve(__dirname, '../data');
const BLOCKED_STATUS_CODES = new Set([401, 403, 429, 503, 999]);

function normalizeProfileUrl(url) {
  if (!url) {
    return '';
  }

  return String(url)
    .split('?')[0]
    .replace(/\/+$|^\s+|\s+$/g, '');
}

function cachePath(cacheName = 'profile-cache') {
  return path.resolve(CACHE_FOLDER, `${cacheName}.json`);
}

function loadCache(cacheName = 'profile-cache') {
  const filePath = cachePath(cacheName);

  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }

    const text = fs.readFileSync(filePath, 'utf8').trim();
    return text ? JSON.parse(text) : {};
  } catch (err) {
    console.warn(`Unable to load cache ${cacheName}:`, err.message);
    return {};
  }
}

function saveCache(cache, cacheName = 'profile-cache') {
  const filePath = cachePath(cacheName);

  try {
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.warn(`Unable to save cache ${cacheName}:`, err.message);
  }
}

function getCachedEntry(url, cache) {
  if (!url || !cache) {
    return null;
  }

  return cache[normalizeProfileUrl(url)] || null;
}

function setCachedEntry(url, entry, cache) {
  if (!url || !cache) {
    return;
  }

  cache[normalizeProfileUrl(url)] = entry;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function batchArray(items, batchSize = 5) {
  if (!Array.isArray(items) || batchSize <= 0) {
    return [];
  }

  const batches = [];

  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  return batches;
}

function isBlockedText(text = '') {
  if (!text) {
    return false;
  }

  const normalized = String(text).toLowerCase();

  return /rate limit|too many requests|access denied|blocked|abuse detection|temporarily unavailable|try again later|verify your identity|suspended|limited access|error 429|error 503|forbidden/i.test(normalized);
}

function isFatalError(err) {
  if (!err) {
    return false;
  }

  const message = String(err.message || '').toLowerCase();
  return isBlockedText(message) || /blocked|rate limit|access denied|forbidden|suspended/i.test(message);
}

async function withRetries(fn, options = {}) {
  const {
    retries = 3,
    initialDelay = 3000,
    maxDelay = 20000,
    factor = 2,
    onRetry = null
  } = options;

  let attempt = 0;
  let delay = initialDelay;

  while (true) {
    try {
      attempt += 1;
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || isFatalError(err)) {
        throw err;
      }

      if (typeof onRetry === 'function') {
        await onRetry(err, attempt, delay);
      }

      await sleep(delay, Math.min(delay + 1000, maxDelay));
      delay = Math.min(maxDelay, Math.round(delay * factor));
    }
  }
}

async function safeGoto(page, url, options = {}) {
  return await withRetries(
    async () => {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: options.timeout || 90000
      });

      const status = response ? response.status() : 0;

      if (BLOCKED_STATUS_CODES.has(status)) {
        const err = new Error('Blocked or rate-limited response: HTTP ' + status);
        err.blocked = true;
        err.status = status;
        throw err;
      }

      const bodyText = await page.locator('body').textContent();

      if (isBlockedText(bodyText)) {
        const err = new Error('Blocked or rate-limited page detected');
        err.blocked = true;
        throw err;
      }

      return response;
    },
    {
      retries: options.retries || 3,
      initialDelay: options.initialDelay || 3000,
      maxDelay: options.maxDelay || 20000,
      factor: options.factor || 2,
      onRetry: async (err, attempt, delay) => {
        console.log('Retry ' + attempt + ' for ' + url + ': ' + err.message + '; backing off for about ' + Math.round(delay / 1000) + 's');
      }
    }
  );
}

module.exports = {
  batchArray,
  getCachedEntry,
  isBlockedText,
  isFatalError,
  loadCache,
  normalizeProfileUrl,
  parsePositiveInteger,
  safeGoto,
  saveCache,
  setCachedEntry
};