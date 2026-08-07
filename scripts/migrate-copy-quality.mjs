import { createIdentityPool } from "../src/identity/postgres.js";
import { runCopyQualityMigrations } from "../src/copy-quality/postgres.js";

const pool = createIdentityPool({ connectionString: process.env.DATABASE_URL || process.env.IDENTITY_DATABASE_URL });
try {
  await runCopyQualityMigrations(pool);
  console.log("Copy quality migrations applied.");
} finally {
  await pool.end();
}
