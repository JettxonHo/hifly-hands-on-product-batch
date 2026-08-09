import { createIdentityPool } from "../src/identity/postgres.js";
import { runManualExecutionMigrations } from "../src/manual-execution/postgres.js";

const connectionString = process.env.DATABASE_URL || process.env.IDENTITY_DATABASE_URL;
const pool = createIdentityPool({ connectionString });
try {
  await runManualExecutionMigrations(pool);
  console.log("Manual execution migrations applied.");
} finally {
  await pool.end();
}
