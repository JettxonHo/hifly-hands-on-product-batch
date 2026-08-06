import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Pool } = pg;
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

async function migrationEntries() {
  return (await readdir(MIGRATIONS_DIR)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
}

function requireConnectionString(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw Object.assign(new Error("IDENTITY_DATABASE_URL_REQUIRED"), { code: "IDENTITY_DATABASE_URL_REQUIRED" });
  }
  return value;
}

export function createIdentityPool({ connectionString, max = 5, ssl = false } = {}) {
  return new Pool({ connectionString: requireConnectionString(connectionString), max, ssl });
}

export async function runIdentityMigrations(pool) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("pool is required");
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [570057001]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS identity_schema_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const entries = await migrationEntries();
    for (const name of entries) {
      const version = Number(name.split("_", 1)[0]);
      const applied = await client.query("SELECT 1 FROM identity_schema_migrations WHERE version = $1", [version]);
      if (applied.rowCount > 0) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, name), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO identity_schema_migrations(version, name) VALUES ($1, $2)",
          [version, name]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [570057001]).catch(() => undefined);
    client.release();
  }
}

export async function assertIdentitySchemaCurrent(pool) {
  const entries = await migrationEntries();
  const expected = entries.length ? Number(entries.at(-1).split("_", 1)[0]) : 0;
  try {
    const result = await pool.query("SELECT max(version)::integer AS version FROM identity_schema_migrations");
    if ((result.rows[0]?.version ?? 0) !== expected) throw new Error("stale");
  } catch (cause) {
    throw Object.assign(new Error("IDENTITY_SCHEMA_NOT_READY"), { code: "IDENTITY_SCHEMA_NOT_READY", cause });
  }
}

export async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
