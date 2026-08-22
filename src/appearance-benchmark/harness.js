import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  AppearanceBenchmarkError,
  RUNTIME_DIMENSIONS
} from "./contracts.js";
import { validateBenchmarkEnvironment } from "./environment-validator.js";

const ALLOWED_SMOKE_OPERATIONS = new Set(["decode_dimensions", "sha256"]);

export async function runBlindInference({
  storageAlias,
  manifestPath,
  environmentLockPath,
  operationsPolicyPath,
  lane,
  adapter,
  runId,
  outputPath,
  env = process.env,
  now = () => new Date()
}) {
  if (adapter !== "synthetic-contract-smoke") {
    fail("BENCHMARK_ADAPTER_DISABLED", "Only the synthetic contract smoke adapter is enabled");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(runId || "")) {
    fail("BENCHMARK_RUN_ID_INVALID", "The benchmark run identity is invalid");
  }

  const validation = await validateBenchmarkEnvironment({
    storageAlias,
    manifestPath,
    environmentLockPath,
    lane,
    env
  });
  const datasetRoot = env[`${storageAlias}_ROOT`];
  assertOutputOutsideControlledRoot(datasetRoot, outputPath);
  const manifest = await readJson(path.resolve(datasetRoot, manifestPath), "BENCHMARK_MANIFEST_INVALID");
  if (manifest.status !== "synthetic_fixture_only") {
    fail("BENCHMARK_REAL_DATA_NOT_AUTHORIZED", "This gate only permits synthetic fixture inference");
  }
  const policy = await readJson(operationsPolicyPath, "BENCHMARK_OPERATIONS_POLICY_INVALID");
  validateOperationsPolicy(policy);

  const sampleEvidence = manifest.samples.map((sample) => ({
    sample_id: sample.sample_id,
    source: projectImageIdentity(sample.source),
    candidate: projectImageIdentity(sample.candidate),
    operations: policy.allowed_operations.map((operation) => ({ operation, status: "recorded" }))
  }));
  const payload = {
    schema_version: 1,
    run_id: runId,
    run_status: "raw_evidence_only",
    created_at: now().toISOString(),
    lane,
    adapter,
    policy_version: policy.policy_version,
    accepted_thresholds: false,
    aggregate: "needs_review",
    runtime_dimensions: RUNTIME_DIMENSIONS.map((dimension) => ({ dimension, verdict: "unknown" })),
    samples: sampleEvidence
  };
  const envelope = { payload, payload_sha256: sha256(Buffer.from(JSON.stringify(payload))) };

  try {
    await writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code === "EEXIST") fail("BENCHMARK_RUN_DUPLICATE", "The benchmark run output already exists");
    fail("BENCHMARK_OUTPUT_WRITE_FAILED", "The benchmark raw Evidence could not be sealed");
  }

  return {
    status: "raw_evidence_sealed",
    run_id: runId,
    samples: validation.samples,
    aggregate: "needs_review"
  };
}

function assertOutputOutsideControlledRoot(root, outputPath) {
  const controlledRoot = path.resolve(root);
  const output = path.resolve(outputPath);
  if (output === controlledRoot || output.startsWith(`${controlledRoot}${path.sep}`)) {
    fail("BENCHMARK_OUTPUT_PATH_INVALID", "Benchmark Evidence cannot be written into the controlled dataset");
  }
}

export async function scoreSealedEvidence({
  rawEvidencePath,
  annotationPath,
  reviewPath,
  axisMappingPath,
  outputPath,
  now = () => new Date()
}) {
  const raw = await readJson(rawEvidencePath, "BENCHMARK_RAW_EVIDENCE_INVALID");
  if (!raw?.payload || raw.payload.run_status !== "raw_evidence_only" ||
      sha256(Buffer.from(JSON.stringify(raw.payload))) !== raw.payload_sha256) {
    fail("BENCHMARK_RAW_EVIDENCE_INVALID", "The benchmark raw Evidence seal is invalid");
  }
  validateRawEvidence(raw.payload);
  const annotationBytes = await readRegularFile(annotationPath, "BENCHMARK_ANNOTATION_INVALID");
  const annotation = parseJson(annotationBytes, "BENCHMARK_ANNOTATION_INVALID");
  const review = await readJson(reviewPath, "BENCHMARK_REVIEW_INVALID");
  const mapping = await readJson(axisMappingPath, "BENCHMARK_AXIS_MAPPING_INVALID");
  validateTruth(annotation, review, annotationBytes, raw.payload.samples.map((sample) => sample.sample_id));
  validateAxisMapping(mapping);

  const samples = annotation.samples.map((sample) => scoreSample(sample, mapping));
  const payload = {
    schema_version: 1,
    run_id: raw.payload.run_id,
    scored_at: now().toISOString(),
    mapping_policy_version: mapping.mapping_policy_version,
    aggregate: "needs_review",
    samples
  };
  const envelope = { payload, payload_sha256: sha256(Buffer.from(JSON.stringify(payload))) };
  try {
    await writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code === "EEXIST") fail("BENCHMARK_RUN_DUPLICATE", "The benchmark scored output already exists");
    fail("BENCHMARK_OUTPUT_WRITE_FAILED", "The benchmark scored Evidence could not be sealed");
  }
  return {
    status: "scored_evidence_sealed",
    run_id: raw.payload.run_id,
    aggregate: "needs_review"
  };
}

function scoreSample(sample, mapping) {
  const byAnnotationAxis = sample.axes.map((entry) => ({
    annotation_axis: entry.axis,
    ground_truth: entry.status,
    model_verdict: "unknown",
    comparison_outcome: "unknown"
  }));
  const byRuntimeDimension = RUNTIME_DIMENSIONS.map((runtimeDimension) => {
    const records = [];
    for (const axis of sample.axes) {
      const targets = mapping.mappings[axis.axis];
      if (!targets.includes(runtimeDimension)) continue;
      const groundTruth = targets.length === 1
        ? axis.status
        : (axis.evidence_by_runtime_dimension?.[runtimeDimension] ? axis.status : "unknown");
      records.push({ annotation_axis: axis.axis, ground_truth: groundTruth });
    }
    const groundTruth = records.some((entry) => entry.ground_truth === "unsupported")
      ? "unsupported"
      : records.some((entry) => entry.ground_truth === "unknown") || records.length === 0
        ? "unknown"
        : "supported";
    return {
      runtime_dimension: runtimeDimension,
      ground_truth: groundTruth,
      model_verdict: "unknown",
      comparison_outcome: "unknown",
      mappings: records
    };
  });
  return {
    sample_id: sample.sample_id,
    by_annotation_axis: byAnnotationAxis,
    by_runtime_dimension: byRuntimeDimension
  };
}

function validateOperationsPolicy(policy) {
  if (policy?.schema_version !== 1 || typeof policy.policy_version !== "string" ||
      policy.accepted_thresholds !== false || !Array.isArray(policy.allowed_operations) ||
      policy.allowed_operations.length === 0 ||
      policy.allowed_operations.some((operation) => !ALLOWED_SMOKE_OPERATIONS.has(operation))) {
    fail("BENCHMARK_OPERATIONS_POLICY_INVALID", "The benchmark operations policy is invalid or unregistered");
  }
}

function validateRawEvidence(payload) {
  const dimensions = payload?.runtime_dimensions;
  const samples = payload?.samples;
  if (payload?.schema_version !== 1 || payload?.accepted_thresholds !== false || payload?.aggregate !== "needs_review" ||
      !Array.isArray(dimensions) || dimensions.length !== RUNTIME_DIMENSIONS.length ||
      dimensions.some((entry, index) => entry?.dimension !== RUNTIME_DIMENSIONS[index] || entry.verdict !== "unknown") ||
      !Array.isArray(samples) || samples.length === 0 ||
      samples.some((sample) => typeof sample?.sample_id !== "string" || !sample.sample_id)) {
    fail("BENCHMARK_RAW_EVIDENCE_INVALID", "The benchmark raw Evidence payload is incomplete");
  }
  if (new Set(samples.map((sample) => sample.sample_id)).size !== samples.length) {
    fail("BENCHMARK_RAW_EVIDENCE_INVALID", "The benchmark raw Evidence sample identities are invalid");
  }
}

function validateTruth(annotation, review, annotationBytes, rawSampleIds) {
  const expectedAxes = [
    "form_silhouette",
    "cap_pump_key_parts",
    "label_logo_text",
    "color_material",
    "local_structure_decoration",
    "internal_proportion_size_impression",
    "obvious_artifacts"
  ];
  const samples = annotation?.samples;
  if (annotation?.schema_version !== 1 || annotation?.status !== "completed" || !Array.isArray(samples) ||
      samples.length !== rawSampleIds.length || samples.some((sample) =>
        typeof sample?.sample_id !== "string" || !Array.isArray(sample.axes) || sample.axes.length !== expectedAxes.length ||
        sample.axes.some((entry, index) => entry?.axis !== expectedAxes[index] ||
          !["supported", "unsupported", "unknown"].includes(entry.status)))) {
    fail("BENCHMARK_ANNOTATION_INVALID", "The benchmark annotation pack is invalid");
  }
  const annotationIds = samples.map((sample) => sample.sample_id);
  if (annotationIds.some((sampleId, index) => sampleId !== rawSampleIds[index])) {
    fail("BENCHMARK_ANNOTATION_INVALID", "The benchmark annotation samples do not match the raw Evidence");
  }
  if (review?.schema_version !== 1 || review?.status !== "accepted" ||
      review.annotation_sha256 !== sha256(annotationBytes) ||
      review.dataset_id !== annotation.dataset_id || review.dataset_version !== annotation.dataset_version ||
      !review.annotator_role || !review.reviewer_role || review.annotator_role === review.reviewer_role) {
    fail("BENCHMARK_REVIEW_INVALID", "The benchmark review binding is invalid");
  }
}

function validateAxisMapping(mapping) {
  const expectedAxes = new Set([
    "form_silhouette",
    "cap_pump_key_parts",
    "label_logo_text",
    "color_material",
    "local_structure_decoration",
    "internal_proportion_size_impression",
    "obvious_artifacts"
  ]);
  if (mapping?.schema_version !== 1 || typeof mapping.mapping_policy_version !== "string" ||
      !mapping.mappings || Object.keys(mapping.mappings).length !== expectedAxes.size ||
      Object.keys(mapping.mappings).some((axis) => !expectedAxes.has(axis)) ||
      Object.values(mapping.mappings).some((targets) => !Array.isArray(targets) || targets.some((target) => !RUNTIME_DIMENSIONS.includes(target))) ||
      mapping.mappings.obvious_artifacts.length !== 0) {
    fail("BENCHMARK_AXIS_MAPPING_INVALID", "The benchmark axis mapping is invalid");
  }
}

function projectImageIdentity(image) {
  return {
    bytes: image.bytes,
    sha256: image.sha256,
    media_type: image.media_type,
    encoded_width: image.encoded_width,
    encoded_height: image.encoded_height
  };
}

async function readJson(filename, code) {
  try {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) fail(code, "A benchmark JSON input is not a regular file");
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error instanceof AppearanceBenchmarkError) throw error;
    fail(code, "A benchmark JSON input is unavailable or invalid");
  }
}

async function readRegularFile(filename, code) {
  try {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) fail(code, "A benchmark input is not a regular file");
    return await readFile(filename);
  } catch (error) {
    if (error instanceof AppearanceBenchmarkError) throw error;
    fail(code, "A benchmark input is unavailable");
  }
}

function parseJson(bytes, code) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(code, "A benchmark JSON input is invalid");
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(code, message) {
  throw new AppearanceBenchmarkError(code, message);
}
