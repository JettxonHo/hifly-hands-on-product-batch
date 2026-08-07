import { createIdentityPool } from "../src/identity/postgres.js";
import { runCopyGenerationMigrations } from "../src/copy-generation/postgres.js";

const pool = createIdentityPool({ connectionString: process.env.DATABASE_URL || process.env.IDENTITY_DATABASE_URL });
try {
  await runCopyGenerationMigrations(pool);
  console.log("Copy generation migrations applied.");
} finally {
  await pool.end();
}
