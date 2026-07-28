const net = require("net");
const { execFileSync } = require("child_process");

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const HEALTH_URL = `http://localhost:${PORT}/health`;

function inspectPort(port = PORT) {
  return new Promise((resolve, reject) => {
    if (process.platform === "win32" && findListenerPid(port)) {
      resolve({ available: false });
      return;
    }
    const probe = net.createServer();
    probe.unref();
    probe.once("error", error => {
      if (error.code === "EADDRINUSE") return resolve({ available: false });
      return reject(error);
    });
    probe.listen(port, HOST, () => {
      probe.close(error => {
        if (error) return reject(error);
        return resolve({ available: true });
      });
    });
  });
}

function parseWindowsListener(output, port = PORT) {
  const suffix = `:${port}`;
  for (const line of String(output || "").split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (
      columns.length >= 5 &&
      columns[0].toUpperCase() === "TCP" &&
      columns[1].endsWith(suffix) &&
      columns[3].toUpperCase() === "LISTENING"
    ) {
      const pid = Number(columns[4]);
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
  }
  return null;
}

function findListenerPid(port = PORT) {
  if (process.platform !== "win32") return null;
  try {
    const output = execFileSync("netstat.exe", ["-ano"], {
      encoding: "utf8",
      windowsHide: true
    });
    return parseWindowsListener(output, port);
  } catch {
    return null;
  }
}

function readWindowsProcess(pid) {
  if (process.platform !== "win32" || !pid) return null;
  const command = [
    `$process = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"`,
    "if ($process) {",
    "$process | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress",
    "}"
  ].join("; ");
  try {
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8", windowsHide: true }
    ).trim();
    return output ? JSON.parse(output) : null;
  } catch {
    return null;
  }
}

async function readHealth(url = HEALTH_URL) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, body };
  } catch {
    return { ok: false, body: null };
  }
}

function isWarmPathServer(health, processInfo) {
  return health?.ok === true &&
    health.body?.service === "warm-path-playwright-worker" &&
    (
      !processInfo?.CommandLine ||
      /(?:^|[\s"'\\/])(?:server|start-playwright-server)\.js(?:$|[\s"'])/i
        .test(processInfo.CommandLine)
    );
}

function printProcess(processInfo, pid) {
  console.log(`PID: ${processInfo?.ProcessId || pid || "unknown"}`);
  console.log(`Executable: ${processInfo?.Name || "unknown"}`);
  console.log(`Command line: ${processInfo?.CommandLine || "unavailable"}`);
}

async function start() {
  const portState = await inspectPort();
  if (!portState.available) {
    const pid = findListenerPid();
    const processInfo = readWindowsProcess(pid);
    const health = await readHealth();

    if (isWarmPathServer(health, processInfo)) {
      console.log(`Playwright server is already running on port ${PORT}.`);
      printProcess(processInfo, pid);
      console.log("Reusing existing server.");
      console.log("Playwright running");
      console.log(`http://localhost:${PORT}`);
      return;
    }

    console.error(`Port ${PORT} is already in use by another process.`);
    printProcess(processInfo, pid);
    console.error(`Stop that process before running dev:all.`);
    process.exitCode = 1;
    return;
  }

  const { installProcessHandlers, startServer } = require("../server");
  const server = startServer();
  installProcessHandlers(server);
  server.once("listening", () => {
    console.log("Playwright running");
    console.log(`http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  start().catch(error => {
    console.error("Unable to start the Playwright server:", error);
    process.exitCode = 1;
  });
}

module.exports = {
  findListenerPid,
  inspectPort,
  isWarmPathServer,
  parseWindowsListener,
  readHealth,
  readWindowsProcess,
  start
};
