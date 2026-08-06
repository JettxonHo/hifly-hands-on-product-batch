import { createIdentityPool } from "../src/identity/postgres.js";
import { runProjectContentMigrations } from "../src/project-content/postgres.js";

const pool = createIdentityPool({ connectionString: process.env.DATABASE_URL || process.env.IDENTITY_DATABASE_URL });
try {
  await runProjectContentMigrations(pool);
  console.log("Project content migrations applied.");
} finally {
  await pool.end();
}
