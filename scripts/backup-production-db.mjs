import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  backupFilename,
  buildBackupCommand,
  resolveBackupFile,
  runDatabaseCommand
} from "../src/deployment/database-tools.js";

function argumentValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw Object.assign(new Error(`${name}_VALUE_REQUIRED`), { code: `${name.slice(2).toUpperCase()}_VALUE_REQUIRED` });
  return value;
}

export async function backupProductionDatabase({ env = process.env, args = process.argv.slice(2), run = runDatabaseCommand, now = new Date() } = {}) {
  const databaseUrl = env.DATABASE_URL;
  if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") throw Object.assign(new Error("DATABASE_URL_REQUIRED"), { code: "DATABASE_URL_REQUIRED" });
  const backupDir = env.BACKUP_DIR || "/var/backups/hifly";
  const outputFile = resolveBackupFile({ backupDir, outputFile: argumentValue(args, "--output") || backupFilename(now), now });
  await mkdir(path.dirname(outputFile), { recursive: true });
  await run(buildBackupCommand({ databaseUrl, outputFile }));
  console.log(`Database backup written: ${outputFile}`);
  return outputFile;
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) await backupProductionDatabase();
