const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const csvParser = require('csv-parser');
const {
    getCachedEntry,
    loadCache,
    normalizeProfileUrl,
    parsePositiveInteger
} = require('../services/scrape-utils');

const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const mutualsPath = path.join(dataDir, 'mutuals.json');
const rankedCsvPath = path.join(dataDir, 'ranked-mutuals.csv');
const runStatePath = path.join(dataDir, 'n8n-run-state.json');
const rankScriptPath = path.join(rootDir, 'scripts', 'rank-mutuals.js');

const port = Number.parseInt(process.env.N8N_PORT || process.env.PORT || '5679', 10);
const host = process.env.N8N_HOST || '127.0.0.1';
const callbackUrl = process.env.N8N_CALLBACK_URL || '';
const runTimeoutMs = Number.parseInt(process.env.N8N_RUN_TIMEOUT_MS || '180000', 10);
const minRunIntervalMs = parsePositiveInteger(process.env.N8N_MIN_RUN_INTERVAL_MS, 6 * 60 * 60 * 1000);
const maxUrlsPerRun = parsePositiveInteger(process.env.N8N_MAX_URLS_PER_RUN, 25);

let activeRun = null;

function sendJson(res, statusCode, body) {
    const json = JSON.stringify(body, null, 2);

    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(json)
    });

    res.end(json);
}

function readRequestJson(req) {
    return new Promise((resolve, reject) => {
        let body = '';

        req.on('data', chunk => {
            body += chunk;

            if (body.length > 1024 * 1024) {
                req.destroy();
                reject(new Error('Request body is too large.'));
            }
        });

        req.on('end', () => {
            if (!body.trim()) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error('Request body must be valid JSON.'));
            }
        });

        req.on('error', reject);
    });
}

function normalizeUrls(body) {
    const urls = Array.isArray(body.urls)
        ? body.urls
        : [body.url].filter(Boolean);

    return [
        ...new Set(
            urls
                .map(url => String(url || '').trim())
                .filter(url => url.startsWith('https://www.linkedin.com/in/'))
                .map(url => url.split('?')[0].replace(/\/$/, ''))
        )
    ];
}

function readJsonFile(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) {
            return fallback;
        }

        const text = fs.readFileSync(filePath, 'utf8').trim();
        return text ? JSON.parse(text) : fallback;
    } catch {
        return fallback;
    }
}

function writeJsonFile(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function readMutualUrls() {
    return readJsonFile(mutualsPath, [])
        .map(url => normalizeProfileUrl(url))
        .filter(Boolean);
}

function getCachedProfiles(urls) {
    const cache = loadCache('ranked-mutuals-cache');

    return urls
        .map(url => {
            const cached = getCachedEntry(url, cache);

            if (!cached) {
                return null;
            }

            const profile = {
                url: normalizeProfileUrl(cached.url || url),
                name: cached.name || '',
                headline: cached.headline || '',
                company: cached.company || '',
                location: cached.location || ''
            };

            return {
                ...profile,
                score: scoreCachedProfile(profile),
                source: 'cache'
            };
        })
        .filter(Boolean);
}

function scoreCachedProfile(profile) {
    let score = 0;
    const text = [
        profile.name,
        profile.headline,
        profile.company,
        profile.location
    ].join(' ').toLowerCase();

    if (text.includes('indpro')) score += 50;
    if (/manager|lead|director/.test(text)) score += 20;
    if (/founder|ceo/.test(text)) score += 25;
    if (/sales|marketing|business development|recruiter|talent acquisition/.test(text)) score += 10;
    if (/bengaluru|bangalore/.test(text)) score += 5;

    return score;
}

function summarizeForAnalysis(results, limit = 25) {
    return results
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(row => ({
            name: row.name || '',
            company: row.company || '',
            location: row.location || '',
            score: Number.parseInt(row.score || '0', 10) || 0,
            url: row.url || ''
        }));
}

function buildAnalysisPrompt(results) {
    const rows = summarizeForAnalysis(results, 15);

    return [
        'Analyze these cached LinkedIn warm-path candidates.',
        'Do not request more scraping. Work only from the provided stored fields.',
        'Return the strongest warm paths, why they rank well, and any manual follow-up questions.',
        '',
        JSON.stringify(rows, null, 2)
    ].join('\n');
}

function assertRunAllowed(force = false) {
    if (force) {
        return;
    }

    const state = readJsonFile(runStatePath, {});
    const lastStartedAt = Date.parse(state.lastStartedAt || '');

    if (!Number.isFinite(lastStartedAt)) {
        return;
    }

    const elapsed = Date.now() - lastStartedAt;

    if (elapsed < minRunIntervalMs) {
        const waitMinutes = Math.ceil((minRunIntervalMs - elapsed) / 60000);
        const error = new Error(`Recent scrape run found. Use cached analysis or retry in about ${waitMinutes} minute(s).`);
        error.statusCode = 429;
        throw error;
    }
}

function readRankedCsv() {
    return new Promise((resolve, reject) => {
        const results = [];

        if (!fs.existsSync(rankedCsvPath)) {
            resolve(results);
            return;
        }

        fs.createReadStream(rankedCsvPath)
            .pipe(csvParser())
            .on('data', row => {
                results.push({
                    name: row.name || '',
                    company: row.company || '',
                    location: row.location || '',
                    score: Number.parseInt(row.score || '0', 10) || 0,
                    url: row.url || ''
                });
            })
            .on('end', () => resolve(results))
            .on('error', reject);
    });
}

function runRanker(options) {
    const env = {
        ...process.env
    };

    if (options.profileLimit) {
        env.PROFILE_LIMIT = String(options.profileLimit);
    } else {
        delete env.PROFILE_LIMIT;
    }

    if (options.batchSize) {
        env.BATCH_SIZE = String(options.batchSize);
    } else {
        delete env.BATCH_SIZE;
    }

    return new Promise((resolve, reject) => {
        const logs = [];
        const child = spawn(process.execPath, [rankScriptPath], {
            cwd: rootDir,
            env,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        const timeout = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`rank-mutuals.js timed out after ${runTimeoutMs}ms`));
        }, runTimeoutMs);

        child.stdout.on('data', chunk => {
            const text = chunk.toString();
            process.stdout.write(text);
            logs.push(text);
        });

        child.stderr.on('data', chunk => {
            const text = chunk.toString();
            process.stderr.write(text);
            logs.push(text);
        });

        child.on('error', reject);

        child.on('close', code => {
            clearTimeout(timeout);

            if (code === 0) {
                resolve(logs.join(''));
                return;
            }

            reject(new Error(`rank-mutuals.js exited with code ${code}`));
        });
    });
}

async function postCallback(payload) {
    if (!callbackUrl) {
        return;
    }

    const response = await fetch(callbackUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`n8n callback failed: ${response.status} ${response.statusText}`);
    }
}

async function handleRankMutuals(body) {
    if (activeRun) {
        const error = new Error('A rank-mutuals run is already active.');
        error.statusCode = 409;
        throw error;
    }

    const urls = normalizeUrls(body);
    const force = body.force === true;
    const refresh = body.refresh === true;
    const cacheOnly = body.cacheOnly === true;
    const batchSize = parsePositiveInteger(body.batchSize, 3);
    const requestedLimit = parsePositiveInteger(body.profileLimit || body.limit, maxUrlsPerRun);
    const profileLimit = Math.min(requestedLimit, maxUrlsPerRun);

    if (urls.length > 0) {
        writeJsonFile(mutualsPath, urls);
    } else if (!fs.existsSync(mutualsPath)) {
        const error = new Error('Provide body.urls/body.url, or create data/mutuals.json first.');
        error.statusCode = 400;
        throw error;
    }

    const sourceUrls = urls.length > 0 ? urls : readMutualUrls();
    const cachedProfiles = getCachedProfiles(sourceUrls);
    const cachedUrlSet = new Set(cachedProfiles.map(profile => normalizeProfileUrl(profile.url)));
    const missingUrls = refresh
        ? sourceUrls
        : sourceUrls.filter(url => !cachedUrlSet.has(normalizeProfileUrl(url)));

    if (cacheOnly || missingUrls.length === 0) {
        const results = summarizeForAnalysis(cachedProfiles);

        const payload = {
            ok: true,
            mode: 'analysis_only',
            count: results.length,
            skippedScrape: true,
            missingCount: missingUrls.length,
            files: {
                rankedMutualsCache: path.join(dataDir, 'ranked-mutuals-cache.json')
            },
            analysisPrompt: buildAnalysisPrompt(results),
            results
        };

        await postCallback(payload);

        return payload;
    }

    assertRunAllowed(force);

    const urlsForRun = missingUrls.slice(0, profileLimit);
    writeJsonFile(mutualsPath, urlsForRun);

    const startedAt = new Date().toISOString();
    const options = {
        profileLimit,
        batchSize
    };

    activeRun = {
        startedAt,
        urls: urlsForRun.length
    };

    try {
        writeJsonFile(runStatePath, {
            lastStartedAt: startedAt,
            requestedUrls: sourceUrls.length,
            scrapedUrls: urlsForRun.length
        });

        const logs = await runRanker(options);
        const results = await readRankedCsv();
        const cachedAfterRun = getCachedProfiles(sourceUrls);

        const payload = {
            ok: true,
            mode: 'scraped_missing_then_analyzed',
            startedAt,
            finishedAt: new Date().toISOString(),
            count: cachedAfterRun.length || results.length,
            scrapedCount: urlsForRun.length,
            cachedCount: cachedProfiles.length,
            files: {
                mutuals: mutualsPath,
                rankedMutuals: rankedCsvPath,
                rankedMutualsCache: path.join(dataDir, 'ranked-mutuals-cache.json')
            },
            analysisPrompt: buildAnalysisPrompt(cachedAfterRun.length ? cachedAfterRun : results),
            results: summarizeForAnalysis(cachedAfterRun.length ? cachedAfterRun : results),
            logs
        };

        await postCallback(payload);

        return payload;
    } catch (err) {
        const payload = {
            ok: false,
            startedAt,
            finishedAt: new Date().toISOString(),
            error: err.message
        };

        await postCallback(payload).catch(callbackErr => {
            payload.callbackError = callbackErr.message;
        });

        throw Object.assign(err, { payload });
    } finally {
        activeRun = null;
    }
}

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);

        if (req.method === 'GET' && url.pathname === '/health') {
            sendJson(res, 200, {
                ok: true,
                activeRun,
                minRunIntervalMs,
                maxUrlsPerRun,
                endpoints: [
                    'GET /health',
                    'GET /ranked-mutuals',
                    'POST /analyze-mutuals',
                    'POST /rank-mutuals'
                ]
            });
            return;
        }

        if (req.method === 'GET' && url.pathname === '/ranked-mutuals') {
            const results = await readRankedCsv();
            sendJson(res, 200, {
                ok: true,
                count: results.length,
                results: summarizeForAnalysis(results)
            });
            return;
        }

        if (req.method === 'POST' && url.pathname === '/analyze-mutuals') {
            const body = await readRequestJson(req);
            const urls = normalizeUrls(body);
            const sourceUrls = urls.length > 0 ? urls : readMutualUrls();
            const cachedProfiles = getCachedProfiles(sourceUrls);
            const csvResults = cachedProfiles.length > 0 ? [] : await readRankedCsv();
            const results = summarizeForAnalysis(cachedProfiles.length > 0 ? cachedProfiles : csvResults);

            sendJson(res, 200, {
                ok: true,
                mode: 'analysis_only',
                count: results.length,
                analysisPrompt: buildAnalysisPrompt(results),
                results
            });
            return;
        }

        if (req.method === 'POST' && url.pathname === '/rank-mutuals') {
            const body = await readRequestJson(req);
            const payload = await handleRankMutuals(body);
            sendJson(res, 200, payload);
            return;
        }

        sendJson(res, 404, {
            ok: false,
            error: 'Not found.'
        });
    } catch (err) {
        sendJson(res, err.statusCode || 500, err.payload || {
            ok: false,
            error: err.message
        });
    }
});

server.listen(port, host, () => {
    console.log(`n8n integration server listening at http://${host}:${port}`);
    console.log('POST /analyze-mutuals to analyze stored results without scraping.');
    console.log('POST /rank-mutuals with {"urls":["https://www.linkedin.com/in/..."],"refresh":false}');
});
