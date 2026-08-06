import { runAssetMigrations } from "../src/assets/postgres.js";
import { createIdentityPool } from "../src/identity/postgres.js";

const connectionString = process.env.DATABASE_URL || process.env.IDENTITY_DATABASE_URL;
const pool = createIdentityPool({ connectionString });
try {
  await runAssetMigrations(pool);
  console.log("Asset migrations applied.");
} finally {
  await pool.end();
}
