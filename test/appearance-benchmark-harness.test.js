import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  createSyntheticBenchmarkFixture,
  createSyntheticHumanTruth
} from "./helpers/appearance-benchmark-fixture.js";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "scripts", "appearance-benchmark.mjs");
const lane = process.platform === "darwin" && process.arch === "arm64"
  ? "macos-arm64-smoke"
  : process.platform === "linux" && process.arch === "x64"
    ? "linux-amd64-canonical"
    : null;

test("blind synthetic inference seals raw Evidence without reading truth or producing passed", async (t) => {
  if (!lane) return t.skip("This runtime is not an accepted benchmark lane");
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hifly-appearance-infer-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const fixture = await createSyntheticBenchmarkFixture(temporaryRoot);
  const output = path.join(temporaryRoot, "raw-evidence.json");

  const result = spawnSync(process.execPath, [
    cli,
    "infer",
    "--storage-alias=HIFLY_APPEARANCE_BENCHMARK_V1",
    "--manifest=dataset-manifest.json",
    `--environment-lock=${fixture.lockPath}`,
    `--operations-policy=${fixture.operationsPolicyPath}`,
    `--lane=${lane}`,
    "--adapter=synthetic-contract-smoke",
    "--run-id=synthetic-run-1",
    `--output=${output}`
  ], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HIFLY_APPEARANCE_BENCHMARK_V1_ROOT: fixture.datasetRoot }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: "raw_evidence_sealed",
    run_id: "synthetic-run-1",
    samples: 1,
    aggregate: "needs_review"
  });
  const evidence = JSON.parse(await readFile(output, "utf8"));
  assert.equal(evidence.payload.run_status, "raw_evidence_only");
  assert.equal(evidence.payload.aggregate, "needs_review");
  assert.ok(evidence.payload.runtime_dimensions.every((entry) => entry.verdict === "unknown"));
  assert.equal(JSON.stringify(evidence).includes("passed"), false);
  assert.equal(JSON.stringify(evidence).includes("annotation"), false);
  assert.match(evidence.payload_sha256, /^[a-f0-9]{64}$/);
});

test("scoring preserves annotation axes and runtime dimensions without copying one-to-many truth", async (t) => {
  if (!lane) return t.skip("This runtime is not an accepted benchmark lane");
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hifly-appearance-score-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const fixture = await createSyntheticBenchmarkFixture(temporaryRoot);
  const truth = await createSyntheticHumanTruth(temporaryRoot);
  const rawEvidence = path.join(temporaryRoot, "raw-evidence.json");
  const scoredOutput = path.join(temporaryRoot, "scored-evidence.json");
  const env = { ...process.env, HIFLY_APPEARANCE_BENCHMARK_V1_ROOT: fixture.datasetRoot };
  const inference = spawnSync(process.execPath, [
    cli, "infer",
    "--storage-alias=HIFLY_APPEARANCE_BENCHMARK_V1",
    "--manifest=dataset-manifest.json",
    `--environment-lock=${fixture.lockPath}`,
    `--operations-policy=${fixture.operationsPolicyPath}`,
    `--lane=${lane}`,
    "--adapter=synthetic-contract-smoke",
    "--run-id=synthetic-score-run-1",
    `--output=${rawEvidence}`
  ], { cwd: root, encoding: "utf8", env });
  assert.equal(inference.status, 0, inference.stderr);

  const result = spawnSync(process.execPath, [
    cli, "score",
    `--raw-evidence=${rawEvidence}`,
    `--annotation=${truth.annotationPath}`,
    `--review=${truth.reviewPath}`,
    `--axis-mapping=${fixture.axisMappingPath}`,
    `--output=${scoredOutput}`
  ], { cwd: root, encoding: "utf8", env });

  assert.equal(result.status, 0, result.stderr);
  const scored = JSON.parse(await readFile(scoredOutput, "utf8"));
  const sample = scored.payload.samples[0];
  assert.equal(sample.by_annotation_axis.length, 7);
  assert.equal(sample.by_runtime_dimension.length, 7);
  assert.equal(sample.by_runtime_dimension.some((entry) => entry.runtime_dimension === "obvious_artifacts"), false);
  assert.equal(
    sample.by_runtime_dimension.find((entry) => entry.runtime_dimension === "parts_connections").ground_truth,
    "unsupported"
  );
  assert.equal(
    sample.by_runtime_dimension.find((entry) => entry.runtime_dimension === "packaging").ground_truth,
    "unknown"
  );
  assert.equal(scored.payload.aggregate, "needs_review");
  assert.equal(JSON.stringify(scored).includes('"passed"'), false);
});

test("blind inference cannot write its sealed output inside the controlled dataset", async (t) => {
  if (!lane) return t.skip("This runtime is not an accepted benchmark lane");
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hifly-appearance-readonly-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const fixture = await createSyntheticBenchmarkFixture(temporaryRoot);
  const output = path.join(fixture.datasetRoot, "forbidden-output.json");

  const result = spawnSync(process.execPath, [
    cli, "infer",
    "--storage-alias=HIFLY_APPEARANCE_BENCHMARK_V1",
    "--manifest=dataset-manifest.json",
    `--environment-lock=${fixture.lockPath}`,
    `--operations-policy=${fixture.operationsPolicyPath}`,
    `--lane=${lane}`,
    "--adapter=synthetic-contract-smoke",
    "--run-id=synthetic-readonly-run",
    `--output=${output}`
  ], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HIFLY_APPEARANCE_BENCHMARK_V1_ROOT: fixture.datasetRoot }
  });

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).error.code, "BENCHMARK_OUTPUT_PATH_INVALID");
});

test("blind inference rejects annotation visibility, unregistered operations, and duplicate runs", async (t) => {
  if (!lane) return t.skip("This runtime is not an accepted benchmark lane");
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hifly-appearance-negative-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const fixture = await createSyntheticBenchmarkFixture(temporaryRoot);
  const output = path.join(temporaryRoot, "raw-evidence.json");
  const baseArgs = [
    cli, "infer",
    "--storage-alias=HIFLY_APPEARANCE_BENCHMARK_V1",
    "--manifest=dataset-manifest.json",
    `--environment-lock=${fixture.lockPath}`,
    `--operations-policy=${fixture.operationsPolicyPath}`,
    `--lane=${lane}`,
    "--adapter=synthetic-contract-smoke",
    "--run-id=synthetic-negative-run",
    `--output=${output}`
  ];
  const env = { ...process.env, HIFLY_APPEARANCE_BENCHMARK_V1_ROOT: fixture.datasetRoot };
  const annotationVisible = spawnSync(process.execPath, [...baseArgs, "--annotation=forbidden.json"], {
    cwd: root, encoding: "utf8", env
  });
  assert.equal(annotationVisible.status, 1);
  assert.equal(JSON.parse(annotationVisible.stderr).error.code, "BENCHMARK_ARGUMENT_INVALID");

  const invalidPolicy = JSON.parse(await readFile(fixture.operationsPolicyPath, "utf8"));
  invalidPolicy.allowed_operations.push("video_decode");
  await writeFile(fixture.operationsPolicyPath, `${JSON.stringify(invalidPolicy, null, 2)}\n`);
  const unregisteredOperation = spawnSync(process.execPath, baseArgs, { cwd: root, encoding: "utf8", env });
  assert.equal(unregisteredOperation.status, 1);
  assert.equal(JSON.parse(unregisteredOperation.stderr).error.code, "BENCHMARK_OPERATIONS_POLICY_INVALID");

  invalidPolicy.allowed_operations = ["decode_dimensions", "sha256"];
  await writeFile(fixture.operationsPolicyPath, `${JSON.stringify(invalidPolicy, null, 2)}\n`);
  const first = spawnSync(process.execPath, baseArgs, { cwd: root, encoding: "utf8", env });
  assert.equal(first.status, 0, first.stderr);
  const duplicate = spawnSync(process.execPath, baseArgs, { cwd: root, encoding: "utf8", env });
  assert.equal(duplicate.status, 1);
  assert.equal(JSON.parse(duplicate.stderr).error.code, "BENCHMARK_RUN_DUPLICATE");
});

test("scoring rejects sealed but incomplete raw Evidence", async (t) => {
  if (!lane) return t.skip("This runtime is not an accepted benchmark lane");
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hifly-appearance-partial-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const fixture = await createSyntheticBenchmarkFixture(temporaryRoot);
  const truth = await createSyntheticHumanTruth(temporaryRoot);
  const rawEvidence = path.join(temporaryRoot, "raw-evidence.json");
  const output = path.join(temporaryRoot, "scored-evidence.json");
  const payload = {
    schema_version: 1,
    run_id: "partial-run",
    run_status: "raw_evidence_only",
    accepted_thresholds: false,
    aggregate: "needs_review",
    runtime_dimensions: [],
    samples: []
  };
  await writeFile(rawEvidence, `${JSON.stringify({
    payload,
    payload_sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex")
  }, null, 2)}\n`);

  const result = spawnSync(process.execPath, [
    cli, "score",
    `--raw-evidence=${rawEvidence}`,
    `--annotation=${truth.annotationPath}`,
    `--review=${truth.reviewPath}`,
    `--axis-mapping=${fixture.axisMappingPath}`,
    `--output=${output}`
  ], { cwd: root, encoding: "utf8" });

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).error.code, "BENCHMARK_RAW_EVIDENCE_INVALID");
});
