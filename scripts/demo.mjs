import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { getProjectRoot } from "../src/core/project-root.js";
import { startDemoServer } from "../src/server/demo-start.js";
import { runDemoMigrations } from "./demo-migrations.mjs";
import {
  demoDatabaseUrl,
  demoDbPort,
  findAvailableDemoDbPort,
  runCompose
} from "./demo-compose.mjs";

const DEFAULT_DEMO_GUI_PORT = 4317;

function localGuiPort(value) {
  const selected = value === undefined || value === "" ? DEFAULT_DEMO_GUI_PORT : Number(value);
  if (!Number.isInteger(selected) || selected < 1 || selected > 65535) {
    throw new RangeError("HIFLY_DEMO_GUI_PORT must be a valid TCP port");
  }
  return selected;
}

export async function waitForDemoDatabase(pool, { timeoutMs = 60_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw Object.assign(new Error("Demo PostgreSQL did not become ready in time"), {
    code: "DEMO_DATABASE_NOT_READY",
    cause: lastError
  });
}

export function demoDataRoot({ root, env = process.env, projectRoot = getProjectRoot() } = {}) {
  return path.resolve(root || env.HIFLY_DEMO_DATA_DIR || path.join(projectRoot, ".local-demo"));
}

export async function runDemo({
  root,
  guiPort = localGuiPort(process.env.HIFLY_DEMO_GUI_PORT),
  dbPort = process.env.HIFLY_DEMO_DB_PORT ? demoDbPort() : null,
  openBrowser = null,
  compose = runCompose,
  createPool = null,
  findDbPort = findAvailableDemoDbPort,
  migrations = runDemoMigrations,
  server = startDemoServer
} = {}) {
  const dataRoot = demoDataRoot({ root });
  await mkdir(dataRoot, { recursive: true });
  const selectedDbPort = dbPort ?? await findDbPort();
  const databaseUrl = demoDatabaseUrl(selectedDbPort);

  await compose(["up", "-d"], { port: selectedDbPort });
  const poolFactory = createPool || (await import("../src/identity/postgres.js")).createIdentityPool;
  const pool = poolFactory({ connectionString: databaseUrl });
  try {
    await waitForDemoDatabase(pool);
    await migrations(pool, {
      onStep: (name) => console.log(`Demo migration applied: ${name}`)
    });
  } finally {
    await pool.end();
  }

  let browserOpener = openBrowser;
  if (!browserOpener) browserOpener = (await import("open")).default;
  return server({
    root: dataRoot,
    databaseUrl,
    port: guiPort,
    openBrowser: browserOpener
  });
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) await runDemo();
