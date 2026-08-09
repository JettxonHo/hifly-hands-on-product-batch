import { pathToFileURL } from "node:url";

import { buildRestoreCommand, runDatabaseCommand } from "../src/deployment/database-tools.js";

function argumentValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw Object.assign(new Error(`${name}_VALUE_REQUIRED`), { code: `${name.slice(2).toUpperCase()}_VALUE_REQUIRED` });
  return value;
}

export async function restoreProductionDatabase({ env = process.env, args = process.argv.slice(2), run = runDatabaseCommand } = {}) {
  const databaseUrl = env.DATABASE_URL;
  if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") throw Object.assign(new Error("DATABASE_URL_REQUIRED"), { code: "DATABASE_URL_REQUIRED" });
  const inputFile = argumentValue(args, "--input") || env.BACKUP_FILE;
  const command = buildRestoreCommand({ databaseUrl, inputFile, confirm: args.includes("--confirm") });
  await run(command);
  console.log(`Database restore completed from: ${inputFile}`);
  return inputFile;
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) await restoreProductionDatabase();
