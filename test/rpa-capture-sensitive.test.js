import test from "node:test";
import assert from "node:assert/strict";
import { isSensitiveKey, findSensitiveKeys } from "../src/rpa/capture/sensitive.js";

test("flags common secret header names case-insensitively", () => {
  assert.equal(isSensitiveKey("cookie"), true);
  assert.equal(isSensitiveKey("Set-Cookie"), true);
  assert.equal(isSensitiveKey("AUTHORIZATION"), true);
  assert.equal(isSensitiveKey("x-csrf-token"), true);
  assert.equal(isSensitiveKey("X-XSRF-TOKEN"), true);
});

test("does not flag ordinary business field names", () => {
  assert.equal(isSensitiveKey("image_id"), false);
  assert.equal(isSensitiveKey("work_id"), false);
  assert.equal(isSensitiveKey("status"), false);
  assert.equal(isSensitiveKey("content-type"), false);
});

test("flags keys whose names contain token/session/auth/ticket/sign/secret", () => {
  assert.equal(isSensitiveKey("session_id"), true);
  assert.equal(isSensitiveKey("access_token"), true);
  assert.equal(isSensitiveKey("sign"), true);
  assert.equal(isSensitiveKey("signature"), true);
  assert.equal(isSensitiveKey("ticket"), true);
});

test("findSensitiveKeys walks nested objects and arrays", () => {
  const hits = findSensitiveKeys(
    { steps: [{ request: { headers: { cookie: "x" } }, response: { body: { data: { access_token: "y" } } } }] },
    ""
  );
  assert.deepEqual(hits.sort(), ["steps[0].request.headers.cookie", "steps[0].response.body.data.access_token"].sort());
});
