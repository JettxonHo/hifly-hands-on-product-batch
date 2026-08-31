import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

async function loadResolver(randomUUID = () => "generated-video-plan-key") {
  const source = await readFile(new URL("../web/video-plan-create-idempotency.js", import.meta.url), "utf8");
  const context = { crypto: { randomUUID }, Headers };
  vm.runInNewContext(source, context, { filename: "video-plan-create-idempotency.js" });
  return context.HiflyVideoPlanCreateIdempotency;
}

function roundtripsAsIdempotencyHeader(value) {
  try {
    return new Headers({ "idempotency-key": value }).get("idempotency-key") === value;
  } catch (_error) {
    return false;
  }
}

test("video plan create idempotency resolver preserves supplied keys and generates an ordinary UUID fallback", async () => {
  const resolver = await loadResolver(() => "generated-video-plan-key");
  const generated = resolver.resolve(undefined);
  assert.equal(generated, "generated-video-plan-key");
  assert.equal(typeof generated, "string");
  assert.ok(generated.trim().length > 0 && generated.length <= 128, "Generated key must be nonblank and within the key limit");
  assert.equal(resolver.resolve(null), "generated-video-plan-key");
  assert.equal(resolver.resolve(""), "generated-video-plan-key");
  assert.equal(resolver.resolve("K1"), "K1");
  assert.equal(resolver.resolve(`x${"y".repeat(127)}`), `x${"y".repeat(127)}`);
  const runtimeHeaderInvalid = [" K1 ", "\tK1", "K1\t", "K1\n", "K1\r", "K1\u0000", "你好"]
    .filter((value) => !roundtripsAsIdempotencyHeader(value));
  assert.ok(runtimeHeaderInvalid.length > 0, "The runtime must identify at least one non-round-trippable header value");
  for (const value of runtimeHeaderInvalid) {
    assert.throws(() => resolver.resolve(value), /VIDEO_PLAN_CREATE_IDEMPOTENCY_KEY_INVALID/);
  }
});

test("video plan create idempotency resolver rejects invalid keys synchronously", async () => {
  const resolver = await loadResolver();
  for (const value of ["   ", "\t\n", 42, {}, [], `x${"y".repeat(128)}`]) {
    assert.throws(() => resolver.resolve(value), /VIDEO_PLAN_CREATE_IDEMPOTENCY_KEY_INVALID/);
  }
});

test("video plan create idempotency resolver validates generated fallback before a request can start", async () => {
  for (const generated of ["   ", `x${"y".repeat(128)}`, 42, null, " K1 ", "K1\u0000"]) {
    const resolver = await loadResolver(() => generated);
    let requests = 0;
    const fakeFetch = () => { requests += 1; };
    const create = () => {
      const key = resolver.resolve(undefined);
      return fakeFetch(`/api/products/product-a/video-plans`, { headers: { "idempotency-key": key } });
    };
    assert.throws(create, /VIDEO_PLAN_CREATE_IDEMPOTENCY_KEY_INVALID/);
    assert.equal(requests, 0, "Invalid generated fallback must abort before request dispatch");
  }
});
