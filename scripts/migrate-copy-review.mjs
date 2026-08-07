import { createIdentityPool } from "../src/identity/postgres.js";
import { runCopyReviewMigrations } from "../src/copy-review/postgres.js";

const pool = createIdentityPool({ connectionString: process.env.DATABASE_URL || process.env.IDENTITY_DATABASE_URL });
try {
  await runCopyReviewMigrations(pool);
  console.log("Copy review migrations applied.");
} finally {
  await pool.end();
}
