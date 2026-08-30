import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
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

test("final work-verification migration preserves avatar_image after assets run first", async () => {
  const assetMigration = await readFile(new URL("../src/assets/migrations/002_p2_02_avatar_image_kind.sql", import.meta.url), "utf8");
  const migration = await readFile(new URL("../src/work-verification/migrations/003_preserve_avatar_image_kind.sql", import.meta.url), "utf8");
  assert.match(assetMigration, /CHECK \(kind IN \('product_image', 'avatar_image', 'work_video'\)\)/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS asset_assets_kind_check/);
  assert.match(migration, /CHECK \(kind IN \('product_image', 'avatar_image', 'work_video'\)\)/);
  assert.ok(PRODUCTION_MIGRATION_ORDER.indexOf("assets") < PRODUCTION_MIGRATION_ORDER.indexOf("artifactVerification"));
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
  assert.equal(packageJson.scripts["hifly:check"], "node --env-file-if-exists=.env scripts/check-hifly-api.mjs");
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
  const proxyBlock = serviceBlock(compose, "proxy");
  assert.match(proxyBlock, /PUBLIC_HOST:\s*\$\{PUBLIC_HOST:-pilot\.example\.invalid\}/);
  assert.match(proxyBlock, /^\s+NGINX_ENVSUBST_FILTER:\s+"\^PUBLIC_HOST\$"\s*$/m);
  assert.match(proxyBlock, /default\.conf\.template:ro/);
  assert.match(proxyBlock, /wget -q --spider http:\/\/127\.0\.0\.1:8080\/healthz/);
  assert.doesNotMatch(proxyBlock, /8080:8080/);

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
  assert.match(dockerignore, /^\.env$/m);
  assert.match(dockerignore, /^\.env\.\*$/m);
  assert.match(dockerignore, /^!\.env\.example$/m);

  const nginx = await readFile(new URL("../deploy/nginx/default.conf", import.meta.url), "utf8");
  assert.match(nginx, /listen 443 ssl;/);
  assert.match(nginx, /http2 on;/);
  assert.doesNotMatch(nginx, /listen 443 ssl http2/);
  assert.match(nginx, /proxy_pass http:\/\/app:3000/);
  assert.match(nginx, /proxy_set_header Host \$host/);
  assert.match(nginx, /client_max_body_size 128m/);
  assert.match(nginx, /listen 127\.0\.0\.1:8080;/);
  assert.match(nginx, /server_name 127\.0\.0\.1;/);
  assert.match(nginx, /server_name \$\{PUBLIC_HOST\};/);
  assert.match(nginx, /return 308 https:\/\/\$\{PUBLIC_HOST\}\$request_uri;/);
  assert.doesNotMatch(nginx, /return 30[127] https:\/\/\$host\$request_uri/);
  assert.match(nginx, /listen 80 default_server;/);
  assert.match(nginx, /listen 443 ssl default_server;/);
  assert.match(nginx, /return 444;/);
  assert.match(nginx, /Strict-Transport-Security[^\n]*max-age=31536000/);
  assert.doesNotMatch(nginx, /Strict-Transport-Security[^\n]*includeSubDomains/i);
  assert.doesNotMatch(nginx, /Strict-Transport-Security[^\n]*preload/i);
  assert.equal((nginx.match(/location = \/healthz/g) || []).length, 1, "public HTTP/HTTPS must not bypass trusted Host/Origin checks");

  const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(envExample, /DATABASE_URL=/);
  assert.match(envExample, /INITIAL_ADMIN_PASSWORD=/);
  assert.match(envExample, /HIFLY_API_TOKEN=/);
  assert.match(envExample, /LOCAL_AGENT_ENABLED=false/);
  assert.match(envExample, /LOCAL_AGENT_ID=/);
  assert.match(envExample, /LOCAL_AGENT_ORGANIZATION_ID=/);
  assert.match(envExample, /LOCAL_AGENT_TOKEN=/);
  assert.match(envExample, /LOCAL_AGENT_LEASE_MS=30000/);
  assert.match(envExample, /HTTP_PORT=80/);
  assert.match(envExample, /HTTPS_PORT=443/);
  assert.doesNotMatch(envExample, /postgresql:\/\/pilot:secret@/);
  assert.match(appBlock, /HIFLY_API_TOKEN:/);
  assert.match(appBlock, /^\s+COPY_GENERATION_PROVIDER:\s+\$\{COPY_GENERATION_PROVIDER:-phase1_controlled_test_double\}\s*$/m);
  assert.match(appBlock, /^\s+COPY_QUALITY_EVALUATOR:\s+\$\{COPY_QUALITY_EVALUATOR:-phase1_controlled_test_double\}\s*$/m);
  assert.match(appBlock, /^\s+COPY_QUALITY_REWRITER:\s+\$\{COPY_QUALITY_REWRITER:-phase1_controlled_test_double\}\s*$/m);
  assert.match(appBlock, /^\s+DEEPSEEK_API_KEY:\s+\$\{DEEPSEEK_API_KEY\}\s*$/m);
  assert.doesNotMatch(appBlock, /^\s+DEEPSEEK_API_KEY:\s+\$\{DEEPSEEK_API_KEY:-/m);
  assert.match(appBlock, /LOCAL_AGENT_ENABLED:/);
  assert.match(appBlock, /LOCAL_AGENT_ID:/);
  assert.match(appBlock, /LOCAL_AGENT_ORGANIZATION_ID:/);
  assert.match(appBlock, /LOCAL_AGENT_TOKEN:/);
  assert.match(appBlock, /LOCAL_AGENT_LEASE_MS:/);
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
});

test("daily database backup candidate is bounded, app-container-only, and non-destructive", async () => {
  const servicePath = new URL("../deploy/systemd/hifly-pilot-backup.service", import.meta.url);
  const timerPath = new URL("../deploy/systemd/hifly-pilot-backup.timer", import.meta.url);
  const scriptPath = new URL("../deploy/systemd/run-hifly-backup.sh", import.meta.url);
  const service = await readFile(servicePath, "utf8");
  const timer = await readFile(timerPath, "utf8");
  const script = await readFile(scriptPath, "utf8");

  assert.match(service, /^\[Unit\]/m);
  assert.match(service, /^After=docker\.service$/m);
  assert.doesNotMatch(service, /^(?:Requires|Wants|BindsTo)=/m, "timer must not pull Docker or restart containers");
  assert.doesNotMatch(service, /^ConditionPathExists=/m, "missing paths must fail the runner, not silently skip the timer");
  assert.match(service, /^WorkingDirectory=\/opt\/hifly-pilot$/m);
  assert.match(service, /^ExecStart=\/opt\/hifly-pilot\/deploy\/systemd\/run-hifly-backup\.sh$/m);
  assert.match(service, /^Type=oneshot$/m);
  assert.match(service, /^UMask=0077$/m);
  assert.match(service, /^NoNewPrivileges=true$/m);
  assert.match(service, /^TimeoutStartSec=900s$/m);

  assert.match(timer, /^OnCalendar=daily$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^RandomizedDelaySec=15m$/m);
  assert.match(timer, /^Unit=hifly-pilot-backup\.service$/m);

  assert.match(script, /^#!\/bin\/sh$/m);
  assert.match(script, /^set -eu$/m);
  assert.match(script, /backup_path="\/var\/backups\/hifly\/hifly-systemd-\$\(date -u \+%Y%m%dT%H%M%SZ\)-\$\$\.dump"/);
  assert.match(script, /docker compose[\s\S]*-f "?\/opt\/hifly-pilot\/docker-compose\.production\.yml"?[\s\S]*exec -T app sh -ceu/);
  assert.match(script, /umask 077[\s\S]*exec npm run db:backup -- --output "\$1"[\s\S]*backup "\$backup_path"/);
  assert.match(script, /docker compose[\s\S]*-f "?\/opt\/hifly-pilot\/docker-compose\.production\.yml"?[\s\S]*exec -T app pg_restore --list "\$backup_path"/);
  assert.doesNotMatch(script, /\b(?:find|ls|sort|sed|latest)\b|\/var\/backups\/hifly\/\*\.dump/);
  assert.doesNotMatch(script, /\b(?:rm|rmdir|delete|prune|upload|scp|rsync|curl|wget|pg_dump|psql)\b/i);
  assert.doesNotMatch(script, /(?:docker\s+cp|docker\s+push|DATABASE_URL|postgresql:\/\/)/i);
  if (process.platform !== "win32") assert.ok((await stat(scriptPath)).mode & 0o111, "backup runner must be executable");
});

test("daily backup runner stops on backup or validation failure and runs exactly two app execs on success", async (t) => {
  if (process.platform === "win32") {
    t.skip("runner contract requires a POSIX shell");
    return;
  }

  const runner = fileURLToPath(new URL("../deploy/systemd/run-hifly-backup.sh", import.meta.url));
  const fakeDockerSource = [
    "#!/bin/sh",
    "set -eu",
    "count=0",
    'if [ -f "$FAKE_DOCKER_COUNT" ]; then count="$(cat "$FAKE_DOCKER_COUNT")"; fi',
    "count=$((count + 1))",
    'printf "%s\\n" "$count" > "$FAKE_DOCKER_COUNT"',
    'printf "%s\\n" "$count" >> "$FAKE_DOCKER_LOG"',
    '[ "$1" = "compose" ]',
    '[ "$2" = "-p" ]',
    '[ "$3" = "hifly-pilot" ]',
    '[ "$4" = "-f" ]',
    '[ "$5" = "/opt/hifly-pilot/docker-compose.production.yml" ]',
    '[ "$6" = "exec" ]',
    '[ "$7" = "-T" ]',
    '[ "$8" = "app" ]',
    'if [ "$count" -eq 1 ]; then',
    '  [ "$9" = "sh" ]',
    '  [ "${10:-}" = "-ceu" ]',
    '  printf "%s" "${11:-}" | grep -F "umask 077" >/dev/null',
    "  printf \"%s\" \"${11:-}\" | grep -F 'exec npm run db:backup -- --output \"$1\"' >/dev/null",
    '  [ "${12:-}" = "backup" ]',
    '  backup_path="${13:-}"',
    '  case "$backup_path" in /var/backups/hifly/hifly-systemd-????????T??????Z-[0-9]*.dump) ;; *) exit 65 ;; esac',
    '  printf "%s\\n" "$backup_path" > "$FAKE_DOCKER_PATH"',
    '  exit "${FAKE_BACKUP_EXIT:-0}"',
    "fi",
    '[ "$9" = "pg_restore" ]',
    '[ "${10:-}" = "--list" ]',
    '[ "${11:-}" = "$(cat "$FAKE_DOCKER_PATH")" ]',
    'exit "${FAKE_VALIDATE_EXIT:-0}"'
  ].join("\n");

  async function run({ backupExit = 0, validateExit = 0 } = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), "hifly-backup-run-"));
    const fakeDocker = path.join(root, "docker");
    const countFile = path.join(root, "count");
    const logFile = path.join(root, "calls");
    const pathFile = path.join(root, "backup-path");
    try {
      await writeFile(fakeDocker, `${fakeDockerSource}\n`, "utf8");
      await chmod(fakeDocker, 0o755);
      const result = await new Promise((resolve, reject) => {
        const child = spawn(runner, [], {
          cwd: root,
          stdio: "ignore",
          env: {
            ...process.env,
            PATH: `${root}${path.delimiter}${process.env.PATH || ""}`,
            FAKE_DOCKER_COUNT: countFile,
            FAKE_DOCKER_LOG: logFile,
            FAKE_DOCKER_PATH: pathFile,
            FAKE_BACKUP_EXIT: String(backupExit),
            FAKE_VALIDATE_EXIT: String(validateExit)
          }
        });
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      const calls = (await readFile(logFile, "utf8")).trim().split("\n").filter(Boolean);
      return { ...result, calls };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  const backupFailure = await run({ backupExit: 17 });
  assert.equal(backupFailure.code, 17);
  assert.deepEqual(backupFailure.calls, ["1"], "validation must not run after backup failure");

  const validationFailure = await run({ validateExit: 23 });
  assert.equal(validationFailure.code, 23);
  assert.deepEqual(validationFailure.calls, ["1", "2"], "validation failure must still propagate after backup");

  const success = await run();
  assert.equal(success.code, 0);
  assert.deepEqual(success.calls, ["1", "2"], "a successful run has exactly backup and validation app execs");
});
