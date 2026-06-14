const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const csvParser = require('csv-parser');

const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const mutualsPath = path.join(dataDir, 'mutuals.json');
const rankedCsvPath = path.join(dataDir, 'ranked-mutuals.csv');
const rankScriptPath = path.join(rootDir, 'scripts', 'rank-mutuals.js');

const port = Number.parseInt(process.env.N8N_PORT || process.env.PORT || '5679', 10);
const host = process.env.N8N_HOST || '127.0.0.1';
const callbackUrl = process.env.N8N_CALLBACK_URL || '';
const runTimeoutMs = Number.parseInt(process.env.N8N_RUN_TIMEOUT_MS || '180000', 10);

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

    if (urls.length > 0) {
        fs.writeFileSync(
            mutualsPath,
            JSON.stringify(urls, null, 2)
        );
    } else if (!fs.existsSync(mutualsPath)) {
        const error = new Error('Provide body.urls/body.url, or create data/mutuals.json first.');
        error.statusCode = 400;
        throw error;
    }

    const profileLimit =
        Number.parseInt(body.profileLimit || body.limit || '', 10);

    const startedAt = new Date().toISOString();
    const options = {
        profileLimit: Number.isInteger(profileLimit) && profileLimit > 0
            ? profileLimit
            : undefined
    };

    activeRun = {
        startedAt,
        urls: urls.length
    };

    try {
        const logs = await runRanker(options);
        const results = await readRankedCsv();

        const payload = {
            ok: true,
            startedAt,
            finishedAt: new Date().toISOString(),
            count: results.length,
            files: {
                mutuals: mutualsPath,
                rankedMutuals: rankedCsvPath
            },
            results,
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
                endpoints: [
                    'GET /health',
                    'POST /rank-mutuals'
                ]
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
    console.log('POST /rank-mutuals with {"urls":["https://www.linkedin.com/in/..."]}');
});
