import { createIdentityPool } from "../src/identity/postgres.js";
import { runVideoPlanningMigrations } from "../src/video-planning/postgres.js";

const pool = createIdentityPool({ connectionString: process.env.DATABASE_URL });
try { await runVideoPlanningMigrations(pool); }
finally { await pool.end(); }
