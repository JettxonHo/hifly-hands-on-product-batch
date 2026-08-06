import test from "node:test";
import assert from "node:assert/strict";

import { hashPassword, verifyPassword, meetsNewPasswordPolicy } from "../src/identity/password.js";

test("hashPassword produces a scrypt-prefixed verifier distinct from the plain value", async () => {
  const hash = await hashPassword("correct horse battery");
  assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/);
  assert.equal(hash.includes("correct horse"), false);
});

test("verifyPassword accepts the correct password and rejects a wrong one (constant-time)", async () => {
  const hash = await hashPassword("S3cret-Pass!");
  assert.equal(await verifyPassword("S3cret-Pass!", hash), true);
  assert.equal(await verifyPassword("wrong", hash), false);
  assert.equal(await verifyPassword("", hash), false);
});

test("verifyPassword returns false for a malformed stored value instead of throwing", async () => {
  assert.equal(await verifyPassword("x", "not-a-real-hash"), false);
  assert.equal(await verifyPassword("x", "scrypt$bad$data"), false);
  assert.equal(await verifyPassword("x", null), false);
  assert.equal(await verifyPassword("x", `scrypt$1048576$64$64$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(32).toString("base64")}`), false);
});

test("hashPassword rejects empty / oversized input", async () => {
  await assert.rejects(() => hashPassword(""), (err) => err.code === "INVALID_PASSWORD");
  await assert.rejects(() => hashPassword("x".repeat(2000)), (err) => err.code === "PASSWORD_TOO_LONG");
});

test("meetsNewPasswordPolicy enforces a minimal length floor", () => {
  assert.equal(meetsNewPasswordPolicy("short"), false);
  assert.equal(meetsNewPasswordPolicy("longenough"), true);
  assert.equal(meetsNewPasswordPolicy(""), false);
});

test("two hashes of the same password differ (random salt)", async () => {
  const a = await hashPassword("same-pw");
  const b = await hashPassword("same-pw");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("same-pw", a), true);
  assert.equal(await verifyPassword("same-pw", b), true);
});
