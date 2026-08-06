import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

// Phase-1 password hashing uses Node's built-in scrypt (no external dependency).
// Production may substitute a managed secret/KMS-backed verifier later (D-026);
// the stored format is intentionally self-describing so the parameters can evolve.
//
// Stored format: "scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>"
// Passwords are NEVER logged, NEVER placed into AuditEvent payloads, and NEVER
// returned by any API. Only password.py-style verification is exposed.

const DEFAULT_N = 16384;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const KEY_LEN = 32;
const PREFIX = "scrypt";
const MAX_N = 1 << 15;
const MAX_R = 8;
const MAX_P = 2;

function scrypt(password, salt, N, r, p, keylen) {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, { N, r, p, maxmem: 96 * 1024 * 1024 }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

function validatePlain(plain) {
  if (typeof plain !== "string" || plain.length === 0) {
    throw Object.assign(new Error("INVALID_PASSWORD"), { code: "INVALID_PASSWORD" });
  }
  if (plain.length > 1024) {
    throw Object.assign(new Error("PASSWORD_TOO_LONG"), { code: "PASSWORD_TOO_LONG" });
  }
}

export async function hashPassword(plain, { N = DEFAULT_N, r = DEFAULT_R, p = DEFAULT_P } = {}) {
  validatePlain(plain);
  if (!validParameters(N, r, p)) throw Object.assign(new Error("INVALID_SCRYPT_PARAMETERS"), { code: "INVALID_SCRYPT_PARAMETERS" });
  const salt = randomBytes(16);
  const derived = await scrypt(Buffer.from(plain, "utf8"), salt, N, r, p, KEY_LEN);
  return `${PREFIX}$${N}$${r}$${p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(plain, stored) {
  if (typeof stored !== "string" || typeof plain !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (!validParameters(N, r, p)) return false;
  if (salt.length === 0 || expected.length !== KEY_LEN) return false;
  try {
    const derived = await scrypt(Buffer.from(plain, "utf8"), salt, N, r, p, KEY_LEN);
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function validParameters(N, r, p) {
  return Number.isInteger(N) && N >= 2 && N <= MAX_N && (N & (N - 1)) === 0
    && Number.isInteger(r) && r >= 1 && r <= MAX_R
    && Number.isInteger(p) && p >= 1 && p <= MAX_P;
}

// Minimal strength gate for the first-login password change. Phase-1 only
// enforces a sane floor; the enterprise policy can be tightened later without
// changing the storage format.
export function meetsNewPasswordPolicy(plain) {
  return typeof plain === "string" && plain.length >= 8 && plain.length <= 1024;
}
