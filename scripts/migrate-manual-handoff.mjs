import { createIdentityPool } from "../src/identity/postgres.js";
import { runManualHandoffMigrations } from "../src/manual-handoff/postgres.js";

const pool = createIdentityPool({ connectionString: process.env.DATABASE_URL });
try { await runManualHandoffMigrations(pool); }
finally { await pool.end(); }
