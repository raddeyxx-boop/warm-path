const assert = require("node:assert/strict");
const test = require("node:test");
const {
  isWarmPathServer,
  parseWindowsListener
} = require("../scripts/start-playwright-server");

test("port detection reads the PID of the matching Windows listener", () => {
  const output = [
    "  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    1234",
    "  TCP    0.0.0.0:5173    0.0.0.0:0    LISTENING    5678"
  ].join("\r\n");

  assert.equal(parseWindowsListener(output, 3000), 1234);
  assert.equal(parseWindowsListener(output, 5173), 5678);
  assert.equal(parseWindowsListener(output, 5678), null);
});

test("only the verified Warm Path worker is reusable", () => {
  const warmPathHealth = {
    ok: true,
    body: { service: "warm-path-playwright-worker" }
  };

  assert.equal(
    isWarmPathServer(warmPathHealth, { CommandLine: "node -r dotenv/config server.js" }),
    true
  );
  assert.equal(
    isWarmPathServer(warmPathHealth, { CommandLine: "node -r dotenv/config scripts/start-playwright-server.js" }),
    true
  );
  assert.equal(
    isWarmPathServer(warmPathHealth, { CommandLine: "node unrelated-server.js" }),
    false
  );
  assert.equal(
    isWarmPathServer({ ok: true, body: { service: "other" } }, { CommandLine: "node server.js" }),
    false
  );
});
