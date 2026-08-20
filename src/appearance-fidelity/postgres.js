import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const migrationEntries = async () => (await readdir(MIGRATIONS_DIR)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();

export async function runAppearanceFidelityMigrations(pool) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("pool is required");
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [570090014]);
    await client.query("CREATE TABLE IF NOT EXISTS appearance_fidelity_schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const name of await migrationEntries()) {
      const version = Number(name.split("_", 1)[0]);
      if ((await client.query("SELECT 1 FROM appearance_fidelity_schema_migrations WHERE version=$1", [version])).rowCount) continue;
      await client.query("BEGIN");
      try {
        await client.query(await readFile(path.join(MIGRATIONS_DIR, name), "utf8"));
        await client.query("INSERT INTO appearance_fidelity_schema_migrations(version,name) VALUES ($1,$2)", [version, name]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [570090014]).catch(() => undefined);
    client.release();
  }
}

export async function assertAppearanceFidelitySchemaCurrent(pool) {
  const names = await migrationEntries();
  const expected = names.length ? Number(names.at(-1).split("_", 1)[0]) : 0;
  try {
    const result = await pool.query("SELECT max(version)::integer AS version FROM appearance_fidelity_schema_migrations");
    if ((result.rows[0]?.version ?? 0) !== expected) throw new Error("stale");
  } catch (cause) {
    throw Object.assign(new Error("APPEARANCE_FIDELITY_SCHEMA_NOT_READY"), { code: "APPEARANCE_FIDELITY_SCHEMA_NOT_READY", cause });
  }
}
