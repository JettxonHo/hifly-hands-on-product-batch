import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { createSyntheticBenchmarkFixture } from "./helpers/appearance-benchmark-fixture.js";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "scripts", "appearance-benchmark.mjs");
const lane = process.platform === "darwin" && process.arch === "arm64"
  ? "macos-arm64-smoke"
  : process.platform === "linux" && process.arch === "x64"
    ? "linux-amd64-canonical"
    : null;

test("validator accepts a C4-shaped synthetic dataset only as a synthetic contract", async (t) => {
  if (!lane) return t.skip("This runtime is not an accepted benchmark lane");
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hifly-appearance-env-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const fixture = await createSyntheticBenchmarkFixture(temporaryRoot);

  const result = spawnSync(process.execPath, [
    cli,
    "validate-environment",
    "--storage-alias=HIFLY_APPEARANCE_BENCHMARK_V1",
    "--manifest=dataset-manifest.json",
    `--environment-lock=${fixture.lockPath}`,
    `--lane=${lane}`
  ], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      HIFLY_APPEARANCE_BENCHMARK_V1_ROOT: fixture.datasetRoot
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: "synthetic_contract_validated",
    storage_alias: "HIFLY_APPEARANCE_BENCHMARK_V1",
    lane,
    samples: 1
  });
});

test("validator cannot promote an arbitrary formatted lock to a real validated environment", async (t) => {
  if (!lane) return t.skip("This runtime is not an accepted benchmark lane");
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hifly-appearance-fake-lock-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const fixture = await createSyntheticBenchmarkFixture(temporaryRoot);
  const lock = JSON.parse(await readFile(fixture.lockPath, "utf8"));
  lock.validation_mode = "environment_evidence_complete";
  await writeFile(fixture.lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const result = spawnSync(process.execPath, [
    cli,
    "validate-environment",
    "--storage-alias=HIFLY_APPEARANCE_BENCHMARK_V1",
    "--manifest=dataset-manifest.json",
    `--environment-lock=${fixture.lockPath}`,
    `--lane=${lane}`
  ], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HIFLY_APPEARANCE_BENCHMARK_V1_ROOT: fixture.datasetRoot }
  });

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).error.code, "BENCHMARK_ENVIRONMENT_LOCK_INVALID");
});

test("validator fails closed when the controlled dataset contains an unregistered file", async (t) => {
  if (!lane) return t.skip("This runtime is not an accepted benchmark lane");
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hifly-appearance-extra-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const fixture = await createSyntheticBenchmarkFixture(temporaryRoot);
  await writeFile(path.join(fixture.datasetRoot, "unregistered.txt"), "not in manifest\n");

  const result = spawnSync(process.execPath, [
    cli,
    "validate-environment",
    "--storage-alias=HIFLY_APPEARANCE_BENCHMARK_V1",
    "--manifest=dataset-manifest.json",
    `--environment-lock=${fixture.lockPath}`,
    `--lane=${lane}`
  ], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HIFLY_APPEARANCE_BENCHMARK_V1_ROOT: fixture.datasetRoot }
  });

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).error.code, "BENCHMARK_DATASET_EXTRA_FILE");
});

test("validator rejects symlinks and exact-byte hash drift without exposing local paths", async (t) => {
  if (!lane) return t.skip("This runtime is not an accepted benchmark lane");
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hifly-appearance-drift-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const fixture = await createSyntheticBenchmarkFixture(temporaryRoot);
  const manifest = JSON.parse(await readFile(path.join(fixture.datasetRoot, "dataset-manifest.json"), "utf8"));
  const source = path.join(fixture.datasetRoot, manifest.samples[0].source.relative_path);
  const linked = path.join(fixture.datasetRoot, "pairs", "sample-1", "linked.png");
  await symlink(source, linked);

  const args = [
    cli,
    "validate-environment",
    "--storage-alias=HIFLY_APPEARANCE_BENCHMARK_V1",
    "--manifest=dataset-manifest.json",
    `--environment-lock=${fixture.lockPath}`,
    `--lane=${lane}`
  ];
  const run = () => spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HIFLY_APPEARANCE_BENCHMARK_V1_ROOT: fixture.datasetRoot }
  });

  const linkedResult = run();
  assert.equal(linkedResult.status, 1);
  assert.equal(JSON.parse(linkedResult.stderr).error.code, "BENCHMARK_DATASET_SYMLINK");
  assert.doesNotMatch(linkedResult.stderr, new RegExp(temporaryRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  await rm(linked);
  await writeFile(source, Buffer.from("not the registered image"));
  const driftResult = run();
  assert.equal(driftResult.status, 1);
  assert.equal(JSON.parse(driftResult.stderr).error.code, "BENCHMARK_IMAGE_IDENTITY_MISMATCH");
});

test("repository artifact evidence remains fail closed while license and dependency locks are blocked", async (t) => {
  if (!lane) return t.skip("This runtime is not an accepted benchmark lane");
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hifly-appearance-blocked-lock-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const fixture = await createSyntheticBenchmarkFixture(temporaryRoot);
  const blockedLock = path.join(root, "config", "appearance-benchmark", "environment-lock.v1.json");

  const result = spawnSync(process.execPath, [
    cli,
    "validate-environment",
    "--storage-alias=HIFLY_APPEARANCE_BENCHMARK_V1",
    "--manifest=dataset-manifest.json",
    `--environment-lock=${blockedLock}`,
    `--lane=${lane}`
  ], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HIFLY_APPEARANCE_BENCHMARK_V1_ROOT: fixture.datasetRoot }
  });

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).error.code, "BENCHMARK_ENVIRONMENT_LOCK_INVALID");
});
