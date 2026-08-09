import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { demoDataRoot, runDemo } from "../scripts/demo.mjs";

test("demo data defaults to a persistent project-local ignored directory", () => {
  assert.equal(
    demoDataRoot({ env: {}, projectRoot: "/tmp/hifly-project" }),
    path.resolve("/tmp/hifly-project/.local-demo")
  );
});

test("demo runner starts the isolated database before migrations and server", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-demo-runner-"));
  const events = [];
  const pool = {
    async query() { return { rows: [{ ok: 1 }] }; },
    async end() { events.push("pool:end"); }
  };
  const started = { url: "http://127.0.0.1:4399", loginUrl: "http://127.0.0.1:4399/login.html" };
  try {
    const result = await runDemo({
      root,
      guiPort: 4399,
      dbPort: 55433,
      openBrowser: async () => {},
      compose: async (args) => {
        events.push(["compose", ...args]);
      },
      createPool: () => pool,
      migrations: async (receivedPool) => {
        assert.equal(receivedPool, pool);
        events.push("migrations");
      },
      server: async (options) => {
        events.push("server");
        assert.equal(options.databaseUrl, "postgresql://hifly_demo:demo-local-only@127.0.0.1:55433/hifly_vsa_demo");
        assert.equal(options.port, 4399);
        return started;
      }
    });

    assert.deepEqual(result, started);
    assert.deepEqual(events, [
      ["compose", "up", "-d"],
      "migrations",
      "pool:end",
      "server"
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
