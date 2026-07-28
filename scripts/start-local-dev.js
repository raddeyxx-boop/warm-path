const { spawn, spawnSync } = require("child_process");
const readline = require("readline");
const {
  findListenerPid,
  inspectPort,
  readWindowsProcess
} = require("./start-playwright-server");

const POLL_INTERVAL_MS = 750;
const START_TIMEOUT_MS = 60000;
const HEALTH_INTERVAL_MS = 4000;
const HEALTH_FAILURE_LIMIT = 3;
const RESTART_LIMIT = 3;
const SHUTDOWN_GRACE_MS = 5000;
const OUTPUT_ERROR_HANDLER = Symbol.for("warmPath.outputErrorHandler");

const SERVICES = Object.freeze([
  {
    key: "playwright",
    label: "PLAYWRIGHT",
    name: "Playwright",
    port: 3000,
    url: "http://localhost:3000",
    healthUrl: "http://127.0.0.1:3000/health",
    npmArgs: ["start"],
    validate: response =>
      response.status >= 200 &&
      response.status < 300 &&
      response.json?.service === "warm-path-playwright-worker" &&
      response.json?.ok === true &&
      response.json?.listening === true
  },
  {
    key: "n8n",
    label: "N8N",
    name: "n8n",
    port: 5678,
    url: "http://localhost:5678",
    healthUrl: "http://127.0.0.1:5678/healthz",
    npmArgs: ["run", "n8n"],
    validate: response =>
      response.status >= 200 &&
      response.status < 300 &&
      response.json?.status === "ok"
  },
  {
    key: "frontend",
    label: "FRONTEND",
    name: "Frontend",
    port: 5173,
    url: "http://localhost:5173",
    healthUrl: "http://localhost:5173/login",
    healthUrls: [
      "http://localhost:5173/login",
      "http://127.0.0.1:5173/login",
      "http://[::1]:5173/login"
    ],
    npmArgs: ["run", "frontend", "--", "--strictPort"],
    validate: response =>
      response.status >= 200 &&
      response.status < 300 &&
      /text\/html/i.test(response.contentType) &&
      /<div\s+id=["']root["']><\/div>/i.test(response.text) &&
      /src=["']\/src\/main\.jsx(?:\?[^"']*)?["']/i.test(response.text)
  }
]);

class LocalDevError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "LocalDevError";
    Object.assign(this, details);
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function requestHealth(service, fetchImpl = fetch) {
  let lastError = null;
  for (const url of service.healthUrls || [service.healthUrl]) {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(2500)
      });
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      const result = {
        status: response.status,
        contentType: response.headers.get("content-type") || "",
        text,
        json
      };
      if (service.validate(result)) return { healthy: true, response: result, url };
      lastError = new Error(`Unexpected response from ${url}`);
    } catch (error) {
      lastError = error;
    }
  }
  return { healthy: false, error: lastError };
}

function getProcessDetails(port, dependencies = {}) {
  const findPid = dependencies.findListenerPid || findListenerPid;
  const readProcess = dependencies.readWindowsProcess || readWindowsProcess;
  const pid = findPid(port);
  return { pid, owner: readProcess(pid) };
}

function formatProcessOwner(owner, pid) {
  return [
    `PID: ${owner?.ProcessId || pid || "unknown"}`,
    `Executable: ${owner?.Name || "unknown"}`,
    `Command line: ${owner?.CommandLine || "unavailable"}`
  ].join("\n");
}

async function inspectService(service, dependencies = {}) {
  const healthCheck = dependencies.requestHealth || requestHealth;
  const portCheck = dependencies.inspectPort || inspectPort;
  const health = await healthCheck(service);
  if (health.healthy) {
    const process = getProcessDetails(service.port, dependencies);
    return { service, status: "REUSED", health, ...process };
  }
  const port = await portCheck(service.port);
  if (port.available) return { service, status: "MISSING", health };
  const process = getProcessDetails(service.port, dependencies);
  return { service, status: "CONFLICT", health, ...process };
}

function prefixStream(stream, label, target) {
  if (!stream) return null;
  if (!target[OUTPUT_ERROR_HANDLER]) {
    target.on("error", error => {
      if (error.code !== "EPIPE") throw error;
    });
    target[OUTPUT_ERROR_HANDLER] = true;
  }
  const lines = readline.createInterface({ input: stream });
  lines.on("line", line => {
    if (!target.destroyed) target.write(`[${label}] ${line}\n`);
  });
  return lines;
}

function launchService(service, dependencies = {}) {
  const spawnImpl = dependencies.spawn || spawn;
  const windows = (dependencies.platform || process.platform) === "win32";
  const command = windows ? "cmd.exe" : "npm";
  const args = windows
    ? ["/d", "/s", "/c", ["npm", ...service.npmArgs].join(" ")]
    : service.npmArgs;
  const child = spawnImpl(command, args, {
    cwd: dependencies.cwd || process.cwd(),
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const managed = {
    service,
    child,
    ownership: "owned",
    owned: true,
    pid: child.pid || null,
    command: `npm ${service.npmArgs.join(" ")}`,
    workingDirectory: dependencies.cwd || process.cwd(),
    startedAt: new Date().toISOString(),
    exitCode: null,
    exitSignal: null,
    stdoutLines: prefixStream(child.stdout, service.label, process.stdout),
    stderrLines: prefixStream(child.stderr, service.label, process.stderr)
  };
  child.once("exit", (code, signal) => {
    managed.exitCode = code;
    managed.exitSignal = signal;
  });
  return managed;
}

async function waitForHealthy(service, managed, dependencies = {}) {
  const healthCheck = dependencies.requestHealth || requestHealth;
  const wait = dependencies.delay || delay;
  const intervalMs = dependencies.pollIntervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = dependencies.timeoutMs ?? START_TIMEOUT_MS;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const health = await healthCheck(service);
    if (health.healthy) return health;
    if (managed.exitCode !== null || managed.exitSignal !== null) {
      throw new LocalDevError(
        `${service.name} exited before becoming healthy (exit code ${managed.exitCode ?? "none"}, signal ${managed.exitSignal || "none"}).`,
        { service, managed }
      );
    }
    await wait(intervalMs);
  }
  throw new LocalDevError(
    `${service.name} did not become healthy within ${timeoutMs}ms.`,
    { service, managed }
  );
}

function createRegistryEntry(inspection) {
  const reused = inspection.status === "REUSED";
  return {
    service: inspection.service,
    ownership: reused ? "reused" : "pending",
    owned: false,
    child: null,
    pid: inspection.pid || null,
    command: inspection.owner?.CommandLine || null,
    workingDirectory: null,
    detectedAt: reused ? new Date().toISOString() : null,
    startedAt: null,
    latestHealthState: reused ? "healthy" : "pending",
    lastSuccessfulHealthCheck: reused ? new Date().toISOString() : null,
    consecutiveFailures: 0,
    restartCount: 0,
    exitCode: null,
    exitSignal: null
  };
}

async function terminateOwnedProcess(entry, dependencies = {}) {
  const child = entry?.child;
  if (entry?.ownership !== "owned" || !child || child.exitCode !== null || !child.pid) return;
  const wait = dependencies.delay || delay;
  const graceMs = dependencies.graceMs ?? SHUTDOWN_GRACE_MS;
  const platform = dependencies.platform || process.platform;
  const spawnSyncImpl = dependencies.spawnSync || spawnSync;
  if (platform === "win32") {
    spawnSyncImpl("taskkill.exe", ["/PID", String(child.pid), "/T"], {
      windowsHide: true,
      stdio: "ignore"
    });
  } else {
    child.kill("SIGTERM");
  }
  const deadline = Date.now() + graceMs;
  while (child.exitCode === null && Date.now() < deadline) await wait(100);
  if (child.exitCode !== null) return;
  if (platform === "win32") {
    spawnSyncImpl("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore"
    });
  } else {
    child.kill("SIGKILL");
  }
}

async function stopOwnedChildren(registry, dependencies = {}) {
  await Promise.allSettled(
    registry.filter(entry => entry.ownership === "owned")
      .map(entry => terminateOwnedProcess(entry, dependencies))
  );
}

async function prepareServices(services = SERVICES, dependencies = {}) {
  const inspect = dependencies.inspectService || inspectService;
  const inspections = [];
  for (const service of services) inspections.push(await inspect(service, dependencies));
  const conflict = inspections.find(item => item.status === "CONFLICT");
  if (conflict) {
    throw new LocalDevError(
      `[PORT_CONFLICT]\nservice: ${conflict.service.name}\nport: ${conflict.service.port}\n${formatProcessOwner(conflict.owner, conflict.pid)}\nreason: Port is occupied by a process that failed service validation.`,
      { inspection: conflict }
    );
  }
  return inspections;
}

async function ownEntry(entry, dependencies = {}) {
  const launch = dependencies.launchService || launchService;
  const waitUntilHealthy = dependencies.waitForHealthy || waitForHealthy;
  const managed = launch(entry.service, dependencies);
  Object.assign(entry, managed, {
    ownership: "owned",
    owned: true,
    latestHealthState: "starting",
    consecutiveFailures: 0
  });
  await waitUntilHealthy(entry.service, entry, dependencies);
  entry.latestHealthState = "healthy";
  entry.lastSuccessfulHealthCheck = new Date().toISOString();
  console.log(`[OWNED] ${entry.service.name} healthy at ${entry.service.url} (PID ${entry.pid || "unknown"})`);
  return entry;
}

async function startMissingServices(inspections, dependencies = {}) {
  const registry = inspections.map(createRegistryEntry);
  try {
    for (const entry of registry) {
      if (entry.ownership === "reused") {
        console.log(`[REUSED] ${entry.service.name} at ${entry.service.url} (PID ${entry.pid || "unknown"}); monitoring enabled.`);
      } else {
        console.log(`[${entry.service.label}] Not running; starting...`);
        await ownEntry(entry, dependencies);
      }
    }
    return registry;
  } catch (error) {
    await stopOwnedChildren(registry, dependencies);
    throw error;
  }
}

function printSummary(registry) {
  console.log("\nWarm Path Finder local environment\n");
  for (const entry of registry) {
    console.log(entry.service.name);
    console.log(`  URL: ${entry.service.url}`);
    console.log(`  Status: ${entry.latestHealthState}`);
    console.log(`  Ownership: ${entry.ownership}`);
    console.log(`  PID: ${entry.pid || "unknown"}\n`);
  }
  console.log("All services are ready.");
  console.log("Press Ctrl+C to stop owned services.");
}

async function restartEntry(entry, reason, dependencies = {}) {
  const portCheck = dependencies.inspectPort || inspectPort;
  const healthCheck = dependencies.requestHealth || requestHealth;
  const restartLimit = dependencies.restartLimit ?? RESTART_LIMIT;
  if (entry.restartCount >= restartLimit) {
    throw new LocalDevError(
      `[RESTART] ${entry.service.name} reached restart limit ${restartLimit}.`,
      { entry }
    );
  }
  const health = await healthCheck(entry.service);
  if (health.healthy) {
    entry.latestHealthState = "healthy";
    entry.lastSuccessfulHealthCheck = new Date().toISOString();
    entry.consecutiveFailures = 0;
    return;
  }
  const port = await portCheck(entry.service.port);
  if (!port.available) {
    const process = getProcessDetails(entry.service.port, dependencies);
    throw new LocalDevError(
      `[PORT_CONFLICT]\nservice: ${entry.service.name}\nport: ${entry.service.port}\n${formatProcessOwner(process.owner, process.pid)}\nreason: Service became unhealthy and its port is occupied by an unverified process.`,
      { entry }
    );
  }
  entry.restartCount += 1;
  console.error(`[RESTART] ${entry.service.name}; reason: ${reason}; attempt: ${entry.restartCount}/${restartLimit}`);
  await ownEntry(entry, dependencies);
}

async function monitorService(entry, dependencies = {}) {
  const healthCheck = dependencies.requestHealth || requestHealth;
  const failureLimit = dependencies.healthFailureLimit ?? HEALTH_FAILURE_LIMIT;
  const childExited = entry.ownership === "owned" &&
    (entry.exitCode !== null || entry.exitSignal !== null);
  const health = await healthCheck(entry.service);
  if (health.healthy) {
    entry.latestHealthState = "healthy";
    entry.lastSuccessfulHealthCheck = new Date().toISOString();
    entry.consecutiveFailures = 0;
    if (childExited) {
      entry.ownership = "reused";
      entry.owned = false;
      entry.child = null;
      const process = getProcessDetails(entry.service.port, dependencies);
      entry.pid = process.pid;
      entry.command = process.owner?.CommandLine || null;
      console.log(`[REUSED] ${entry.service.name} child exited, but a verified service remains available.`);
    }
    return;
  }
  entry.consecutiveFailures += 1;
  entry.latestHealthState = "degraded";
  if (!childExited && entry.consecutiveFailures < failureLimit) return;
  console.error(
    `[SERVICE_UNHEALTHY]\nservice: ${entry.service.name}\nurl: ${entry.service.healthUrl}\nownership: ${entry.ownership}\npid: ${entry.pid || "unknown"}\nconsecutive_failures: ${entry.consecutiveFailures}`
  );
  await restartEntry(
    entry,
    childExited
      ? `child exited (code ${entry.exitCode ?? "none"}, signal ${entry.exitSignal || "none"})`
      : `${entry.consecutiveFailures} failed health checks`,
    dependencies
  );
}

async function monitor(registry, dependencies = {}) {
  const wait = dependencies.delay || delay;
  const interval = dependencies.healthIntervalMs ?? HEALTH_INTERVAL_MS;
  let cycles = 0;
  while (dependencies.maxMonitorCycles === undefined || cycles < dependencies.maxMonitorCycles) {
    await wait(interval);
    for (const entry of registry) await monitorService(entry, dependencies);
    cycles += 1;
  }
}

function installShutdownHandlers(registry, dependencies = {}) {
  let shuttingDown = false;
  const exit = dependencies.exit || (code => process.exit(code));
  const shutdown = async (signal, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[SHUTDOWN] ${signal} received. Stopping owned services only.`);
    await stopOwnedChildren(registry, dependencies);
    console.log("[SHUTDOWN] Reused services were left running.");
    exit(exitCode);
  };
  const sigint = () => void shutdown("SIGINT", 0);
  const sigterm = () => void shutdown("SIGTERM", 0);
  process.once("SIGINT", sigint);
  process.once("SIGTERM", sigterm);
  return { shutdown, remove: () => {
    process.removeListener("SIGINT", sigint);
    process.removeListener("SIGTERM", sigterm);
  }};
}

async function main(dependencies = {}) {
  console.log("[DEV_ORCHESTRATOR] Checking local services...");
  const inspections = await prepareServices(SERVICES, dependencies);
  const registry = await startMissingServices(inspections, dependencies);
  printSummary(registry);
  const handlers = installShutdownHandlers(registry, dependencies);
  try {
    await monitor(registry, dependencies);
  } catch (error) {
    console.error(`[DEV_ORCHESTRATOR] ${error.message}`);
    await handlers.shutdown("ORCHESTRATOR_FAILURE", 1);
  } finally {
    handlers.remove();
  }
  return registry;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[DEV_ORCHESTRATOR] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  HEALTH_FAILURE_LIMIT,
  LocalDevError,
  RESTART_LIMIT,
  SERVICES,
  createRegistryEntry,
  formatProcessOwner,
  inspectService,
  installShutdownHandlers,
  launchService,
  main,
  monitor,
  monitorService,
  ownEntry,
  prepareServices,
  printSummary,
  requestHealth,
  restartEntry,
  startMissingServices,
  stopOwnedChildren,
  terminateOwnedProcess,
  waitForHealthy
};
