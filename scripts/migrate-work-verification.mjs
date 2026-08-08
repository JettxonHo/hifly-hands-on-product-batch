import { createIdentityPool } from "../src/identity/postgres.js";
import { runWorkVerificationMigrations } from "../src/work-verification/postgres.js";

const pool = createIdentityPool({ connectionString: process.env.DATABASE_URL });
try { await runWorkVerificationMigrations(pool); }
finally { await pool.end(); }
