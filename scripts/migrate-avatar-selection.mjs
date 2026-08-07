import { runAvatarSelectionMigrations } from "../src/avatar-selection/postgres.js";
import { createIdentityPool } from "../src/identity/postgres.js";

const pool = createIdentityPool({ connectionString: process.env.DATABASE_URL || process.env.IDENTITY_DATABASE_URL });
try {
  await runAvatarSelectionMigrations(pool);
  console.log("Avatar selection migrations applied.");
} finally {
  await pool.end();
}
