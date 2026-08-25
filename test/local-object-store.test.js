import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createLocalObjectStore } from "../src/assets/local-object-store.js";

const BODY = Buffer.from("local-object-store-body");

async function waitForFile(filePath, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

const CHILD_PUT_SCRIPT = String.raw`
  import { existsSync, writeFileSync } from "node:fs";
  import { createLocalObjectStore } from "./src/assets/local-object-store.js";

  const input = JSON.parse(process.argv[1]);
  const store = createLocalObjectStore({ root: input.root });
  await store.initialize();
  const metadata = input.pause
    ? {
        organizationId: "org-a",
        toJSON() {
          writeFileSync(input.readyPath, "ready");
          while (!existsSync(input.releasePath)) {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          }
          return { contentType: "image/png", organizationId: "org-a" };
        }
      }
    : { organizationId: "org-b" };
  try {
    await store.put({ key: input.key, body: Buffer.from(input.body, "base64"), contentType: "image/png", metadata });
    writeFileSync(input.resultPath, JSON.stringify({ status: "ok" }));
  } catch (error) {
    writeFileSync(input.resultPath, JSON.stringify({ status: "error", code: error.code || null, name: error.name }));
  }
`;

function spawnChildPut(input) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", CHILD_PUT_SCRIPT, JSON.stringify(input)], {
    cwd: process.cwd(),
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stderr }));
  });
  return { child, done };
}

test("local object store removes a body when metadata creation fails", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-local-object-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createLocalObjectStore({ root });
  await store.initialize();
  const key = "avatar/image.png";
  await assert.rejects(
    store.put({ key, body: BODY, contentType: "image/png", metadata: { organizationId: "org-a", invalid: 1n } }),
    TypeError
  );
  assert.equal(await store.get(key), null);
});

test("a restarted store repairs same-bytes body with truncated or invalid metadata", async (t) => {
  for (const [index, serialized] of ["{\"contentType\":\"image/png\"", "not-json"].entries()) {
    const root = await mkdtemp(path.join(os.tmpdir(), "hifly-local-object-store-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const key = `avatar/invalid-${index}.png`;
    const target = path.join(root, ...key.split("/"));
    const legacyMetadataTarget = `${target}.metadata.json`;
    const committedMetadataTarget = `${target}.metadata.v2.json`;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, BODY, { flag: "wx", mode: 0o600 });
    await writeFile(legacyMetadataTarget, serialized, { flag: "w" });

    const restarted = createLocalObjectStore({ root });
    await restarted.initialize();
    await restarted.put({ key, body: BODY, contentType: "image/png", metadata: { organizationId: "org-a" } });
    assert.equal(await readFile(legacyMetadataTarget, "utf8"), serialized);
    assert.match(await readFile(committedMetadataTarget, "utf8"), /"contentType":"image\/png"/);
    assert.deepEqual(await restarted.get(key), BODY);
    assert.deepEqual(await restarted.head(key), {
      size: BODY.length,
      contentType: "image/png",
      metadata: { contentType: "image/png", organizationId: "org-a" }
    });
  }
});

test("a restarted local object store repairs a body-only partial without deleting complete objects", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-local-object-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = "avatar/restart.png";
  const target = path.join(root, ...key.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, BODY, { flag: "wx", mode: 0o600 });

  const restarted = createLocalObjectStore({ root });
  await restarted.initialize();
  await restarted.put({ key, body: BODY, contentType: "image/png", metadata: { organizationId: "org-a" } });
  assert.deepEqual(await restarted.get(key), BODY);
  assert.deepEqual(await restarted.head(key), {
    size: BODY.length,
    contentType: "image/png",
    metadata: { contentType: "image/png", organizationId: "org-a" }
  });
});

test("a partial body with different bytes is not overwritten during recovery", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-local-object-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = "avatar/mismatch.png";
  const target = path.join(root, ...key.split("/"));
  const partial = Buffer.from("another-writer-body");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, partial, { flag: "wx", mode: 0o600 });

  const restarted = createLocalObjectStore({ root });
  await restarted.initialize();
  await assert.rejects(
    restarted.put({ key, body: BODY, contentType: "image/png", metadata: { organizationId: "org-a" } }),
    { code: "EEXIST" }
  );
  assert.deepEqual(await restarted.get(key), null);
  assert.deepEqual(await readFile(target), partial);
});

test("a complete same-key replay does not overwrite bytes or metadata", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-local-object-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createLocalObjectStore({ root });
  await store.initialize();
  const key = "avatar/replay.png";
  await store.put({ key, body: BODY, contentType: "image/png", metadata: { organizationId: "org-a" } });

  await assert.rejects(
    store.put({ key, body: Buffer.from("different"), contentType: "image/jpeg", metadata: { organizationId: "org-b" } }),
    { code: "EEXIST" }
  );
  assert.deepEqual(await store.get(key), BODY);
  assert.deepEqual(await store.head(key), {
    size: BODY.length,
    contentType: "image/png",
    metadata: { contentType: "image/png", organizationId: "org-a" }
  });
});

test("same-key concurrent puts have one complete winner and never delete its bytes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-local-object-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stores = Array.from({ length: 32 }, () => createLocalObjectStore({ root }));
  await Promise.all(stores.map((store) => store.initialize()));
  const key = "avatar/concurrent.png";
  const attempts = await Promise.allSettled(stores.map((store, index) => store.put({
    key,
    body: BODY,
    contentType: "image/png",
    metadata: { organizationId: `org-${index}` }
  })));

  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((result) => result.status === "rejected" && result.reason?.code === "EEXIST").length, 31);
  const winner = stores[0];
  assert.deepEqual(await winner.get(key), BODY);
  assert.equal((await winner.head(key)).contentType, "image/png");
});

test("independent Node stores publish one same-key winner without deleting it", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-local-object-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = "avatar/child-concurrent.png";
  const readyPath = path.join(root, "child-ready");
  const releasePath = path.join(root, "child-release");
  const firstResultPath = path.join(root, "child-first-result");
  const secondResultPath = path.join(root, "child-second-result");
  const input = { root, key, body: BODY.toString("base64") };
  const first = spawnChildPut({ ...input, pause: true, readyPath, releasePath, resultPath: firstResultPath });
  let second;
  try {
    await waitForFile(readyPath);
    second = spawnChildPut({ ...input, pause: false, readyPath, releasePath, resultPath: secondResultPath });
    await waitForFile(secondResultPath);
    const secondResult = JSON.parse(await readFile(secondResultPath, "utf8"));
    assert.equal(secondResult.status, "ok");
    await writeFile(releasePath, "release");
    await waitForFile(firstResultPath);
    const secondProcess = await second.done;
    assert.equal(secondProcess.code, 0, secondProcess.stderr);
    const firstProcess = await first.done;
    assert.equal(firstProcess.code, 0, firstProcess.stderr);
    const results = [secondResult, JSON.parse(await readFile(firstResultPath, "utf8"))];
    assert.equal(results.filter((result) => result.status === "ok").length, 1);
    assert.equal(results.filter((result) => result.status === "error").length, 1);

    const finalStore = createLocalObjectStore({ root });
    assert.deepEqual(await finalStore.get(key), BODY);
    assert.equal((await finalStore.head(key)).contentType, "image/png");
  } finally {
    await writeFile(releasePath, "release").catch(() => undefined);
    await Promise.allSettled([first.done, second?.done].filter(Boolean));
  }
});

test("independent stores serialize same-bytes repair of invalid metadata", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-local-object-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = "avatar/child-invalid-repair.png";
  const target = path.join(root, ...key.split("/"));
  const metadataTarget = `${target}.metadata.json`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, BODY, { flag: "wx", mode: 0o600 });
  await writeFile(metadataTarget, "{\"contentType\":\"image/png\"", { flag: "wx", mode: 0o600 });
  const readyPath = path.join(root, "repair-ready");
  const releasePath = path.join(root, "repair-release");
  const firstResultPath = path.join(root, "repair-first-result");
  const secondResultPath = path.join(root, "repair-second-result");
  const input = { root, key, body: BODY.toString("base64") };
  const first = spawnChildPut({ ...input, pause: true, readyPath, releasePath, resultPath: firstResultPath });
  let second;
  try {
    await waitForFile(readyPath);
    second = spawnChildPut({ ...input, pause: false, readyPath, releasePath, resultPath: secondResultPath });
    await waitForFile(secondResultPath);
    const secondResult = JSON.parse(await readFile(secondResultPath, "utf8"));
    assert.equal(secondResult.status, "ok");
    await writeFile(releasePath, "release");
    await waitForFile(firstResultPath);
    const firstResult = JSON.parse(await readFile(firstResultPath, "utf8"));
    assert.equal([firstResult, secondResult].filter((result) => result.status === "ok").length, 1);
    assert.equal(await readFile(metadataTarget, "utf8"), "{\"contentType\":\"image/png\"");
    assert.match(await readFile(`${target}.metadata.v2.json`, "utf8"), /"contentType":"image\/png"/);
    const finalStore = createLocalObjectStore({ root });
    assert.deepEqual(await finalStore.get(key), BODY);
    assert.equal((await finalStore.head(key)).contentType, "image/png");
  } finally {
    await writeFile(releasePath, "release").catch(() => undefined);
    await Promise.allSettled([first.done, second?.done].filter(Boolean));
  }
});
