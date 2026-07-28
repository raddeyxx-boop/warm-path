const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LocalDevError,
  SERVICES,
  inspectService,
  installShutdownHandlers,
  monitorService,
  prepareServices,
  requestHealth,
  startMissingServices,
  stopOwnedChildren,
  waitForHealthy
} = require("../scripts/start-local-dev");

function service(key) {
  return SERVICES.find(item => item.key === key);
}

function inspection(key, status) {
  return { service: service(key), status };
}

function managedFor(targetService, overrides = {}) {
  return {
    service: targetService,
    owned: true,
    exitCode: null,
    exitSignal: null,
    child: {
      pid: 100,
      exitCode: null,
      kill() {}
    },
    ...overrides
  };
}

test("service-specific health checks validate Playwright, n8n, and Vite", async () => {
  const responses = new Map([
    [service("playwright").healthUrl, new Response(JSON.stringify({
      ok: true,
      listening: true,
      service: "warm-path-playwright-worker"
    }), { status: 200, headers: { "content-type": "application/json" } })],
    [service("n8n").healthUrl, new Response('{"status":"ok"}', {
      status: 200,
      headers: { "content-type": "application/json" }
    })],
    [service("frontend").healthUrl, new Response(
      '<div id="root"></div><script type="module" src="/src/main.jsx"></script>',
      { status: 200, headers: { "content-type": "text/html" } }
    )]
  ]);

  for (const targetService of SERVICES) {
    const result = await requestHealth(
      targetService,
      async url => responses.get(url)
    );
    assert.equal(result.healthy, true, targetService.name);
  }
});

test("all missing services are launched exactly once", async () => {
  const launched = [];
  const inspections = SERVICES.map(targetService => ({
    service: targetService,
    status: "MISSING"
  }));
  await startMissingServices(inspections, {
    launchService(targetService) {
      launched.push(targetService.key);
      return managedFor(targetService);
    },
    async waitForHealthy() {}
  });
  assert.deepEqual(launched, ["playwright", "n8n", "frontend"]);
});

test("healthy Playwright is reused without a duplicate launch", async () => {
  const launched = [];
  await startMissingServices([
    inspection("playwright", "REUSED"),
    inspection("n8n", "MISSING"),
    inspection("frontend", "MISSING")
  ], {
    launchService(targetService) {
      launched.push(targetService.key);
      return managedFor(targetService);
    },
    async waitForHealthy() {}
  });
  assert.deepEqual(launched, ["n8n", "frontend"]);
});

test("healthy n8n is reused and frontend remains managed", async () => {
  const launched = [];
  const children = await startMissingServices([
    inspection("playwright", "MISSING"),
    inspection("n8n", "REUSED"),
    inspection("frontend", "MISSING")
  ], {
    launchService(targetService) {
      launched.push(targetService.key);
      return managedFor(targetService);
    },
    async waitForHealthy() {}
  });
  assert.deepEqual(launched, ["playwright", "frontend"]);
  assert.equal(children.some(item => item.service.key === "frontend"), true);
});

test("healthy frontend is reused without launching Vite", async () => {
  const launched = [];
  await startMissingServices([
    inspection("playwright", "MISSING"),
    inspection("n8n", "MISSING"),
    inspection("frontend", "REUSED")
  ], {
    launchService(targetService) {
      launched.push(targetService.key);
      return managedFor(targetService);
    },
    async waitForHealthy() {}
  });
  assert.deepEqual(launched, ["playwright", "n8n"]);
});

test("all healthy services are reused and no process is launched", async () => {
  let launchCount = 0;
  const children = await startMissingServices(
    SERVICES.map(targetService => ({ service: targetService, status: "REUSED" })),
    {
      launchService() {
        launchCount += 1;
      }
    }
  );
  assert.equal(launchCount, 0);
  assert.equal(children.length, 3);
  assert.equal(children.every(item => item.ownership === "reused"), true);
});

for (const key of ["playwright", "n8n", "frontend"]) {
  test(`an unrelated process on the ${key} port fails safely`, async () => {
    await assert.rejects(
      prepareServices([service(key)], {
        async inspectService(targetService) {
          return {
            service: targetService,
            status: "CONFLICT",
            owner: {
              ProcessId: 4321,
              Name: "unrelated.exe",
              CommandLine: "unrelated.exe --serve"
            }
          };
        }
      }),
      error =>
        error instanceof LocalDevError &&
        error.message.includes(`port: ${service(key).port}`) &&
        error.message.includes("PID: 4321") &&
        error.message.includes("unrelated.exe")
    );
  });
}

test("inspection does not reuse a listening port after a failed health check", async () => {
  const result = await inspectService(service("n8n"), {
    async requestHealth() {
      return { healthy: false };
    },
    async inspectPort() {
      return { available: false };
    },
    findListenerPid() {
      return 99;
    },
    readWindowsProcess() {
      return { ProcessId: 99, Name: "node.exe", CommandLine: "node fake.js" };
    }
  });
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.pid, 99);
});

test("a child exit before health reports its service and exit code", async () => {
  const managed = managedFor(service("frontend"), { exitCode: 7 });
  await assert.rejects(
    waitForHealthy(service("frontend"), managed, {
      async requestHealth() {
        return { healthy: false };
      },
      async delay() {},
      timeoutMs: 20,
      pollIntervalMs: 1
    }),
    /Frontend exited before becoming healthy \(exit code 7/
  );
});

test("cleanup terminates owned children and leaves reused services untouched", async () => {
  const signals = [];
  const owned = managedFor(service("playwright"));
  owned.ownership = "owned";
  owned.child.kill = signal => {
    signals.push(signal);
    owned.child.exitCode = 0;
  };
  const reused = {
    service: service("n8n"),
    owned: false,
    child: {
      pid: 200,
      exitCode: null,
      kill() {
        throw new Error("reused process must not be stopped");
      }
    }
  };

  await stopOwnedChildren([owned, reused], {
    platform: "linux",
    async delay() {},
    graceMs: 10
  });
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.equal(reused.child.exitCode, null);
});

test("one transient health failure does not restart a service", async () => {
  const entry = {
    ...managedFor(service("playwright")),
    ownership: "owned",
    consecutiveFailures: 0,
    restartCount: 0
  };
  let launches = 0;
  await monitorService(entry, {
    async requestHealth() {
      return { healthy: false };
    },
    launchService() {
      launches += 1;
    },
    healthFailureLimit: 3
  });
  assert.equal(entry.consecutiveFailures, 1);
  assert.equal(entry.latestHealthState, "degraded");
  assert.equal(launches, 0);
});

test("an owned child exit starts a bounded replacement", async () => {
  const entry = {
    ...managedFor(service("playwright"), { exitCode: 7 }),
    ownership: "owned",
    consecutiveFailures: 0,
    restartCount: 0
  };
  let launches = 0;
  await monitorService(entry, {
    async requestHealth() {
      return { healthy: false };
    },
    async inspectPort() {
      return { available: true };
    },
    launchService(targetService) {
      launches += 1;
      return managedFor(targetService);
    },
    async waitForHealthy() {}
  });
  assert.equal(launches, 1);
  assert.equal(entry.restartCount, 1);
  assert.equal(entry.ownership, "owned");
  assert.equal(entry.latestHealthState, "healthy");
});

test("a reused service disappearance starts a replacement when its port is free", async () => {
  const entry = {
    service: service("n8n"),
    ownership: "reused",
    owned: false,
    child: null,
    pid: 222,
    consecutiveFailures: 2,
    restartCount: 0,
    exitCode: null,
    exitSignal: null
  };
  let launches = 0;
  await monitorService(entry, {
    async requestHealth() {
      return { healthy: false };
    },
    async inspectPort() {
      return { available: true };
    },
    launchService(targetService) {
      launches += 1;
      return managedFor(targetService);
    },
    async waitForHealthy() {},
    healthFailureLimit: 3
  });
  assert.equal(launches, 1);
  assert.equal(entry.ownership, "owned");
});

test("restart limit prevents an infinite restart loop", async () => {
  const entry = {
    service: service("frontend"),
    ownership: "owned",
    owned: true,
    child: null,
    consecutiveFailures: 3,
    restartCount: 3,
    exitCode: 1,
    exitSignal: null
  };
  await assert.rejects(
    monitorService(entry, {
      async requestHealth() {
        return { healthy: false };
      },
      restartLimit: 3
    }),
    /reached restart limit 3/
  );
});

test("shutdown stops owned services and preserves reused services", async () => {
  const signals = [];
  const owned = {
    ...managedFor(service("frontend")),
    ownership: "owned"
  };
  owned.child.kill = signal => {
    signals.push(signal);
    owned.child.exitCode = 0;
  };
  const reused = {
    service: service("n8n"),
    ownership: "reused",
    child: null
  };
  let exitCode = null;
  const handlers = installShutdownHandlers([owned, reused], {
    platform: "linux",
    async delay() {},
    exit(code) {
      exitCode = code;
    }
  });
  await handlers.shutdown("TEST", 0);
  handlers.remove();
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.equal(exitCode, 0);
  assert.equal(reused.child, null);
});
