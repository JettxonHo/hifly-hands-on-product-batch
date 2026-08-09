import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { restoreProductionDatabase } from "../scripts/restore-production-db.mjs";

import {
  PRODUCTION_MIGRATION_ORDER,
  runProductionMigrations
} from "../src/deployment/production-migrations.js";
import {
  buildBackupCommand,
  buildRestoreCommand,
  backupFilename,
  runDatabaseCommand
} from "../src/deployment/database-tools.js";

function serviceBlock(compose, name) {
  return compose.match(new RegExp(`\\n  ${name}:[\\s\\S]*?(?=\\n  [a-z][a-z0-9-]*:|\\nvolumes:|$)`))?.[0] || "";
}

test("production migrations run every A01-A14 schema in dependency order", async () => {
  const calls = [];
  const steps = PRODUCTION_MIGRATION_ORDER.map((name) => ({
    name,
    async run() { calls.push(name); }
  }));

  const applied = await runProductionMigrations({ connection: "test-double" }, { steps });

  assert.deepEqual(applied, PRODUCTION_MIGRATION_ORDER);
  assert.deepEqual(calls, [
    "identity",
    "assets",
    "projectContent",
    "copyGeneration",
    "copyQuality",
    "copyReview",
    "avatarSelection",
    "videoPlanning",
    "productionOrders",
    "manualHandoff",
    "manualExecution",
    "artifactVerification",
    "workDelivery"
  ]);
});

test("database backup and restore commands require explicit paths and restore confirmation", () => {
  const outputFile = "/var/backups/hifly/hifly-20260809T010203Z.dump";
  const backup = buildBackupCommand({
    databaseUrl: "postgresql://pilot:secret@postgres:5432/hifly_pilot",
    outputFile
  });
  assert.deepEqual(backup, {
    command: "pg_dump",
    args: ["--format=custom", "--no-owner", "--file", outputFile, "postgresql://pilot@postgres:5432/hifly_pilot"],
    env: { PGPASSWORD: "secret" }
  });
  assert.doesNotMatch(backup.args.join(" "), /secret/);

  assert.throws(
    () => buildRestoreCommand({ databaseUrl: "postgresql://pilot:secret@postgres:5432/hifly_pilot", inputFile: outputFile }),
    { code: "RESTORE_CONFIRMATION_REQUIRED" }
  );
  const restore = buildRestoreCommand({
    databaseUrl: "postgresql://pilot:secret@postgres:5432/hifly_pilot",
    inputFile: outputFile,
    confirm: true
  });
  assert.deepEqual(restore, {
    command: "pg_restore",
    args: ["--exit-on-error", "--clean", "--if-exists", "--no-owner", "--dbname", "postgresql://pilot@postgres:5432/hifly_pilot", outputFile],
    env: { PGPASSWORD: "secret" }
  });
  assert.doesNotMatch(restore.args.join(" "), /secret/);
  assert.equal(backupFilename(new Date("2026-08-09T01:02:03.000Z")), "hifly-20260809T010203Z.dump");
});

test("database command runner merges controlled environment without putting credentials in argv", async () => {
  const child = new EventEmitter();
  let spawnOptions;
  const result = runDatabaseCommand({
    command: "pg_dump",
    args: ["postgresql://pilot@postgres:5432/hifly_pilot"],
    env: { PGPASSWORD: "secret" },
    stdio: "ignore",
    spawnImpl: (_command, _args, options) => {
      spawnOptions = options;
      queueMicrotask(() => child.emit("close", 0, null));
      return child;
    }
  });
  await result;
  assert.equal(spawnOptions.env.PGPASSWORD, "secret");
  assert.equal(spawnOptions.shell, false);
});

test("restore CLI requires confirmation and does not print DATABASE_URL", async () => {
  const databaseUrl = "postgresql://pilot:secret@postgres:5432/hifly_pilot";
  const logs = [];
  const originalLog = console.log;
  console.log = (...values) => logs.push(values.join(" "));
  try {
    await restoreProductionDatabase({
      env: { DATABASE_URL: databaseUrl },
      args: ["--input", "/var/backups/hifly/pilot.dump", "--confirm"],
      run: async (command) => {
        assert.equal(command.command, "pg_restore");
        assert.equal(command.args.includes(databaseUrl), false);
        assert.doesNotMatch(command.args.join(" "), /secret/);
        assert.equal(command.env.PGPASSWORD, "secret");
      }
    });
  } finally {
    console.log = originalLog;
  }
  assert.doesNotMatch(logs.join("\n"), /postgresql:\/\/pilot:secret@/);
});

test("production package and container contracts are explicit and isolated", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["start:production"], "node src/server/production-start.js");
  assert.equal(packageJson.scripts["migrate:production"], "node scripts/migrate-production.mjs");
  assert.equal(packageJson.scripts["db:backup"], "node scripts/backup-production-db.mjs");
  assert.equal(packageJson.scripts["db:restore"], "node scripts/restore-production-db.mjs");

  const compose = await readFile(new URL("../docker-compose.production.yml", import.meta.url), "utf8");
  assert.match(compose, /services:\s*\n\s+app:/);
  assert.match(compose, /\n\s+postgres:/);
  assert.match(compose, /\n\s+proxy:/);
  const appBlock = serviceBlock(compose, "app");
  const postgresBlock = serviceBlock(compose, "postgres");
  assert.match(appBlock, /expose:\s*\n\s+- "3000"/);
  assert.doesNotMatch(appBlock, /\n\s+ports:/);
  assert.doesNotMatch(postgresBlock, /\n\s+ports:/);
  assert.match(compose, /\$\{HTTP_PORT:-80\}:80/);
  assert.match(compose, /\$\{HTTPS_PORT:-443\}:443/);
  assert.match(compose, /image: nginx:1\.30\.4-alpine/);
  assert.doesNotMatch(compose, /nginx:1\.27-alpine/);
  assert.match(postgresBlock, /image: postgres:15-alpine/);
  assert.match(compose, /\$\{POSTGRES_PASSWORD:\?POSTGRES_PASSWORD_REQUIRED\}/);
  assert.doesNotMatch(compose, /POSTGRES_PASSWORD:-/);
  assert.match(compose, /hifly_pilot_data/);
  assert.match(compose, /hifly_pilot_backups/);
  assert.match(compose, /healthcheck:/);
  assert.match(compose, /mem_limit:/);

  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /FROM node:22-slim/);
  assert.match(dockerfile, /postgresql-client/);
  assert.match(dockerfile, /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /USER node/);
  assert.doesNotMatch(dockerfile, /playwright install/i);

  const dockerignore = await readFile(new URL("../.dockerignore", import.meta.url), "utf8");
  assert.match(dockerignore, /node_modules/);
  assert.match(dockerignore, /config\.local\.json/);
  assert.match(dockerignore, /batches/);

  const nginx = await readFile(new URL("../deploy/nginx/default.conf", import.meta.url), "utf8");
  assert.match(nginx, /listen 443 ssl;/);
  assert.match(nginx, /http2 on;/);
  assert.doesNotMatch(nginx, /listen 443 ssl http2/);
  assert.match(nginx, /proxy_pass http:\/\/app:3000/);
  assert.match(nginx, /proxy_set_header Host \$host/);
  assert.match(nginx, /client_max_body_size 128m/);

  const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(envExample, /DATABASE_URL=/);
  assert.match(envExample, /INITIAL_ADMIN_PASSWORD=/);
  assert.match(envExample, /HTTP_PORT=80/);
  assert.match(envExample, /HTTPS_PORT=443/);
  assert.doesNotMatch(envExample, /postgresql:\/\/pilot:secret@/);
});
