import { pathToFileURL } from "node:url";

import { createIdentityPool } from "../src/identity/postgres.js";
import { runProductionMigrations } from "../src/deployment/production-migrations.js";

function databasePoolMax(value = process.env.DATABASE_POOL_MAX) {
  const selected = value === undefined || value === "" ? 2 : Number(value);
  if (!Number.isInteger(selected) || selected < 1 || selected > 16) {
    throw new RangeError("DATABASE_POOL_MAX must be an integer between 1 and 16");
  }
  return selected;
}

function databaseSsl(env = process.env) {
  if (env.DATABASE_SSL !== "true") return false;
  return { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" };
}

export async function migrateProduction({ env = process.env, createPool = createIdentityPool, run = runProductionMigrations } = {}) {
  const databaseUrl = env.DATABASE_URL;
  if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
    throw Object.assign(new Error("DATABASE_URL_REQUIRED"), { code: "DATABASE_URL_REQUIRED" });
  }
  const pool = await createPool({
    connectionString: databaseUrl,
    max: databasePoolMax(env.DATABASE_POOL_MAX),
    ssl: databaseSsl(env)
  });
  try {
    return await run(pool, { onStep: (name) => console.log(`Production migration applied: ${name}`) });
  } finally {
    await pool.end();
  }
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) await migrateProduction();
