import { createIdentityPool, runIdentityMigrations } from "../src/identity/postgres.js";

const connectionString = process.env.DATABASE_URL || process.env.IDENTITY_DATABASE_URL;
const pool = createIdentityPool({ connectionString });
try {
  await runIdentityMigrations(pool);
  console.log("Identity migrations applied.");
} finally {
  await pool.end();
}
