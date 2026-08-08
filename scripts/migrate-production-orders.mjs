import { createIdentityPool } from "../src/identity/postgres.js";
import { runProductionOrderMigrations } from "../src/production-orders/postgres.js";

const pool = createIdentityPool({ connectionString: process.env.DATABASE_URL });
try { await runProductionOrderMigrations(pool); }
finally { await pool.end(); }
