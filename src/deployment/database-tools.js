import { spawn } from "node:child_process";
import path from "node:path";

function required(value, code) {
  if (typeof value !== "string" || value.trim() === "") {
    throw Object.assign(new Error(code), { code });
  }
  return value.trim();
}

function databaseConnection(databaseUrl) {
  const value = required(databaseUrl, "DATABASE_URL_REQUIRED");
  try {
    const parsed = new URL(value);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname) throw new Error("unsupported database URL");
    const password = parsed.password ? decodeURIComponent(parsed.password) : null;
    parsed.password = "";
    return {
      connectionString: parsed.toString(),
      env: password === null ? {} : { PGPASSWORD: password }
    };
  } catch {
    throw Object.assign(new Error("DATABASE_URL_INVALID"), { code: "DATABASE_URL_INVALID" });
  }
}

export function backupFilename(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("now must be a valid Date");
  return `hifly-${now.toISOString().replace(/[-:.]/g, "").replace(/\d{3}Z$/, "Z")}.dump`;
}

export function resolveBackupFile({ backupDir, outputFile = null, now = new Date() } = {}) {
  const directory = required(backupDir, "BACKUP_DIR_REQUIRED");
  const selected = outputFile || backupFilename(now);
  return path.isAbsolute(selected) ? path.resolve(selected) : path.resolve(directory, selected);
}

export function buildBackupCommand({ databaseUrl, outputFile } = {}) {
  const connection = databaseConnection(databaseUrl);
  return {
    command: "pg_dump",
    args: ["--format=custom", "--no-owner", "--file", required(outputFile, "BACKUP_FILE_REQUIRED"), connection.connectionString],
    env: connection.env
  };
}

export function buildRestoreCommand({ databaseUrl, inputFile, confirm = false } = {}) {
  if (confirm !== true) throw Object.assign(new Error("RESTORE_CONFIRMATION_REQUIRED"), { code: "RESTORE_CONFIRMATION_REQUIRED" });
  const connection = databaseConnection(databaseUrl);
  return {
    command: "pg_restore",
    args: ["--exit-on-error", "--clean", "--if-exists", "--no-owner", "--dbname", connection.connectionString, required(inputFile, "BACKUP_FILE_REQUIRED")],
    env: connection.env
  };
}

export function runDatabaseCommand({ command, args, env = {}, spawnImpl = spawn, stdio = "inherit" } = {}) {
  required(command, "DATABASE_COMMAND_REQUIRED");
  if (!Array.isArray(args) || args.some((value) => typeof value !== "string")) throw new TypeError("database command args must be strings");
  if (!env || typeof env !== "object" || Array.isArray(env) || Object.entries(env).some(([key, value]) => typeof key !== "string" || typeof value !== "string")) {
    throw new TypeError("database command env must be a string map");
  }
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { stdio, shell: false, env: { ...process.env, ...env } });
    child.once("error", (error) => reject(Object.assign(new Error(`Unable to run ${command}: ${error.message}`), { code: "DATABASE_COMMAND_UNAVAILABLE", cause: error })));
    child.once("close", (code, signal) => {
      if (code === 0) return resolve({ code, signal });
      reject(Object.assign(new Error(`${command} exited with ${signal || `code ${code}`}`), { code: "DATABASE_COMMAND_FAILED", exitCode: code, signal }));
    });
  });
}
