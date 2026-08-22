import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ANNOTATION_AXES,
  AXIS_MAPPING_CONTENT_SHA256,
  AXIS_MAPPING_POLICY_VERSION,
  AppearanceBenchmarkError,
  FROZEN_AXIS_MAPPINGS,
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
  await assertOutputOutsideControlledRoot({ storageAlias, outputPath, env });
  const manifestBytes = await readRegularFile(
    path.resolve(datasetRoot, manifestPath),
    "BENCHMARK_MANIFEST_INVALID"
  );
  const manifest = parseJson(manifestBytes, "BENCHMARK_MANIFEST_INVALID");
  if (manifest.status !== "synthetic_fixture_only") {
    fail("BENCHMARK_REAL_DATA_NOT_AUTHORIZED", "This gate only permits synthetic fixture inference");
  }
  const policy = await readJson(operationsPolicyPath, "BENCHMARK_OPERATIONS_POLICY_INVALID");
  validateOperationsPolicy(policy);

  const sampleEvidence = manifest.samples.map((sample) => ({
    sample_id: sample.sample_id,
    source: projectImageIdentity(sample.source),
    candidate: projectImageIdentity(sample.candidate),
    operations: policy.allowed_operations.map((operation) => ({ operation, status: "recorded" })),
    runtime_dimensions: RUNTIME_DIMENSIONS.map((dimension) => ({
      dimension,
      verdict: "unknown",
      evidence_ref: `raw-evidence://${runId}/${sample.sample_id}/${dimension}`
    }))
  }));
  const payload = {
    schema_version: 1,
    run_id: runId,
    run_status: "raw_evidence_only",
    created_at: now().toISOString(),
    lane,
    adapter,
    policy_version: policy.policy_version,
    dataset: {
      storage_alias: storageAlias,
      manifest_relative_path: manifestPath.split("\\").join("/"),
      manifest_bytes: manifestBytes.length,
      manifest_sha256: sha256(manifestBytes),
      dataset_id: manifest.dataset_id,
      dataset_version: manifest.dataset_version,
      dataset_status: manifest.status
    },
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

export async function scoreSealedEvidence({
  rawEvidencePath,
  annotationPath,
  reviewPath,
  axisMappingPath,
  outputPath,
  env = process.env,
  now = () => new Date()
}) {
  const raw = await readJson(rawEvidencePath, "BENCHMARK_RAW_EVIDENCE_INVALID");
  if (!raw?.payload || raw.payload.run_status !== "raw_evidence_only" ||
      sha256(Buffer.from(JSON.stringify(raw.payload))) !== raw.payload_sha256) {
    fail("BENCHMARK_RAW_EVIDENCE_INVALID", "The benchmark raw Evidence seal is invalid");
  }
  validateRawEvidence(raw.payload);
  await assertOutputOutsideControlledRoot({
    storageAlias: raw.payload.dataset.storage_alias,
    outputPath,
    env
  });
  const annotationBytes = await readRegularFile(annotationPath, "BENCHMARK_ANNOTATION_INVALID");
  const annotation = parseJson(annotationBytes, "BENCHMARK_ANNOTATION_INVALID");
  const review = await readJson(reviewPath, "BENCHMARK_REVIEW_INVALID");
  const mapping = await readJson(axisMappingPath, "BENCHMARK_AXIS_MAPPING_INVALID");
  validateTruth(
    annotation,
    review,
    annotationBytes,
    raw.payload.dataset,
    raw.payload.samples.map((sample) => sample.sample_id)
  );
  const mappingPolicySha256 = validateAxisMapping(mapping);

  const rawSamples = new Map(raw.payload.samples.map((sample) => [sample.sample_id, sample]));
  const samples = annotation.samples.map((sample) => scoreSample({
    annotationSample: sample,
    rawSample: rawSamples.get(sample.sample_id),
    rawRunId: raw.payload.run_id,
    mapping,
    mappingPolicySha256
  }));
  const payload = {
    schema_version: 1,
    run_id: raw.payload.run_id,
    scored_at: now().toISOString(),
    dataset: raw.payload.dataset,
    raw_evidence_payload_sha256: raw.payload_sha256,
    mapping_policy_version: mapping.mapping_policy_version,
    mapping_policy_sha256: mappingPolicySha256,
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

function scoreSample({ annotationSample: sample, rawSample, rawRunId, mapping, mappingPolicySha256 }) {
  const atomicMappings = sample.axes.flatMap((entry) => {
    const targets = mapping.mappings[entry.axis];
    const effectiveTargets = targets.length === 0 ? [null] : targets;
    return effectiveTargets.map((runtimeDimension) => {
      const mappingEvidenceRef = runtimeDimension && targets.length === 1
        ? entry.evidence_ref
        : runtimeDimension
          ? entry.evidence_by_runtime_dimension?.[runtimeDimension] || null
          : null;
      const groundTruth = runtimeDimension === null || (targets.length > 1 && !mappingEvidenceRef)
        ? "unknown"
        : entry.status;
      const rawEvidenceRef = runtimeDimension
        ? rawSample.runtime_dimensions.find((item) => item.dimension === runtimeDimension)?.evidence_ref || null
        : null;
      return {
        mapping_record_id: `${sample.sample_id}:${entry.axis}:${runtimeDimension || "unmapped"}`,
        mapping_policy_version: mapping.mapping_policy_version,
        mapping_policy_sha256: mappingPolicySha256,
        annotation_axis: entry.axis,
        runtime_dimension: runtimeDimension,
        annotation_status: entry.status,
        annotation_reason_code: entry.reason_code,
        annotation_reason: entry.reason,
        annotation_evidence_ref: entry.evidence_ref,
        visibility_context: entry.visibility_context,
        mapping_evidence_ref: mappingEvidenceRef,
        ground_truth: groundTruth,
        raw_evidence_ref: rawEvidenceRef,
        raw_run_id: rawRunId,
        model_verdict: "unknown",
        comparison_outcome: "unknown"
      };
    });
  });
  const byAnnotationAxis = sample.axes.map((entry) => ({
    annotation_axis: entry.axis,
    ground_truth: entry.status,
    annotation_reason_code: entry.reason_code,
    annotation_reason: entry.reason,
    annotation_evidence_ref: entry.evidence_ref,
    visibility_context: entry.visibility_context,
    mapping_record_ids: atomicMappings
      .filter((record) => record.annotation_axis === entry.axis)
      .map((record) => record.mapping_record_id),
    model_verdict: "unknown",
    comparison_outcome: "unknown"
  }));
  const byRuntimeDimension = RUNTIME_DIMENSIONS.map((runtimeDimension) => {
    const records = atomicMappings.filter((record) => record.runtime_dimension === runtimeDimension);
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
      mapping_record_ids: records.map((record) => record.mapping_record_id),
      raw_evidence_refs: [...new Set(records.map((record) => record.raw_evidence_ref).filter(Boolean))]
    };
  });
  return {
    sample_id: sample.sample_id,
    atomic_mappings: atomicMappings,
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
  const dataset = payload?.dataset;
  if (payload?.schema_version !== 1 || payload?.accepted_thresholds !== false || payload?.aggregate !== "needs_review" ||
      dataset?.storage_alias !== "HIFLY_APPEARANCE_BENCHMARK_V1" ||
      typeof dataset?.manifest_relative_path !== "string" || !dataset.manifest_relative_path ||
      !Number.isSafeInteger(dataset?.manifest_bytes) || dataset.manifest_bytes < 1 ||
      !/^[a-f0-9]{64}$/.test(dataset?.manifest_sha256 || "") ||
      typeof dataset?.dataset_id !== "string" || !dataset.dataset_id ||
      typeof dataset?.dataset_version !== "string" || !dataset.dataset_version ||
      typeof dataset?.dataset_status !== "string" || !dataset.dataset_status ||
      !Array.isArray(dimensions) || dimensions.length !== RUNTIME_DIMENSIONS.length ||
      dimensions.some((entry, index) => entry?.dimension !== RUNTIME_DIMENSIONS[index] || entry.verdict !== "unknown") ||
      !Array.isArray(samples) || samples.length === 0 ||
      samples.some((sample) => typeof sample?.sample_id !== "string" || !sample.sample_id ||
        !validProjectedImageIdentity(sample.source) || !validProjectedImageIdentity(sample.candidate) ||
        !validRawRuntimeDimensions(sample.runtime_dimensions))) {
    fail("BENCHMARK_RAW_EVIDENCE_INVALID", "The benchmark raw Evidence payload is incomplete");
  }
  if (new Set(samples.map((sample) => sample.sample_id)).size !== samples.length) {
    fail("BENCHMARK_RAW_EVIDENCE_INVALID", "The benchmark raw Evidence sample identities are invalid");
  }
}

function validateTruth(annotation, review, annotationBytes, rawDataset, rawSampleIds) {
  const expectedAxes = ANNOTATION_AXES;
  const samples = annotation?.samples;
  if (annotation?.dataset_id !== rawDataset.dataset_id || annotation?.dataset_version !== rawDataset.dataset_version) {
    fail("BENCHMARK_DATASET_BINDING_MISMATCH", "Human truth does not match the raw Evidence dataset");
  }
  if (annotation?.pack_type !== "appearance_ground_truth" || annotation?.schema_version !== 1 ||
      annotation?.status !== "completed" || !Array.isArray(samples) ||
      samples.length !== rawSampleIds.length || samples.some((sample) =>
        typeof sample?.sample_id !== "string" || sample.annotation_version !== 1 ||
        !nonEmptyString(sample.annotated_at) || !Array.isArray(sample.axes) || sample.axes.length !== expectedAxes.length ||
        sample.axes.some((entry, index) => entry?.axis !== expectedAxes[index] ||
          !["supported", "unsupported", "unknown"].includes(entry.status) ||
          !nonEmptyString(entry.reason_code) || !nonEmptyString(entry.reason) || !nonEmptyString(entry.evidence_ref) ||
          !nonEmptyString(entry.visibility_context)))) {
    fail("BENCHMARK_ANNOTATION_INVALID", "The benchmark annotation pack is invalid");
  }
  const annotationIds = samples.map((sample) => sample.sample_id);
  if (annotationIds.some((sampleId, index) => sampleId !== rawSampleIds[index])) {
    fail("BENCHMARK_ANNOTATION_INVALID", "The benchmark annotation samples do not match the raw Evidence");
  }
  if (review?.pack_type !== "appearance_ground_truth_review" || review?.schema_version !== 1 ||
      review?.status !== "completed" || review?.review_status !== "accepted" ||
      review.annotation_pack_sha256 !== sha256(annotationBytes) ||
      review.dataset_id !== annotation.dataset_id || review.dataset_version !== annotation.dataset_version ||
      review.annotator_id !== annotation.annotator_id || !review.reviewer_id ||
      review.annotator_id === review.reviewer_id || annotation.model_output_was_hidden !== true ||
      review.model_output_was_hidden !== true || !nonEmptyString(review.reviewed_at)) {
    fail("BENCHMARK_REVIEW_INVALID", "The benchmark review binding is invalid");
  }
  validateReviewDecisions(review.sample_reviews, samples);
}

function validateReviewDecisions(sampleReviews, annotationSamples) {
  const statuses = new Set(["supported", "unsupported", "unknown"]);
  if (!Array.isArray(sampleReviews) || sampleReviews.length !== annotationSamples.length) {
    fail("BENCHMARK_REVIEW_INVALID", "The benchmark review decisions are incomplete");
  }
  for (const [sampleIndex, annotationSample] of annotationSamples.entries()) {
    const sampleReview = sampleReviews[sampleIndex];
    if (sampleReview?.sample_id !== annotationSample.sample_id || !Array.isArray(sampleReview.axes) ||
        sampleReview.axes.length !== ANNOTATION_AXES.length) {
      fail("BENCHMARK_REVIEW_INVALID", "The benchmark review sample binding is invalid");
    }
    for (const [axisIndex, annotationAxis] of annotationSample.axes.entries()) {
      const axisReview = sampleReview.axes[axisIndex];
      const statusMatch = axisReview?.annotator_status === axisReview?.reviewer_status;
      const matchingAccepted = statusMatch && axisReview?.decision === "accepted";
      const disagreementAccepted = !statusMatch && axisReview?.decision === "accept_annotation" &&
        nonEmptyString(axisReview.decision_note) && axisReview.decision_note.length >= 4;
      if (axisReview?.axis !== annotationAxis.axis || axisReview?.annotator_status !== annotationAxis.status ||
          !statuses.has(axisReview?.reviewer_status) || axisReview?.status_match !== statusMatch ||
          !nonEmptyString(axisReview?.reason_code) || !nonEmptyString(axisReview?.reason) ||
          !nonEmptyString(axisReview?.evidence_ref) || !nonEmptyString(axisReview?.visibility_context) ||
          (!matchingAccepted && !disagreementAccepted)) {
        fail("BENCHMARK_REVIEW_INVALID", "The benchmark review axis decision is unresolved or invalid");
      }
    }
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function validateAxisMapping(mapping) {
  const mappingIdentity = {
    mapping_policy_version: mapping?.mapping_policy_version,
    mappings: mapping?.mappings
  };
  const contentSha256 = sha256(Buffer.from(JSON.stringify(mappingIdentity)));
  const exactMappings = ANNOTATION_AXES.every((axis) =>
    Array.isArray(mapping?.mappings?.[axis]) &&
    JSON.stringify(mapping.mappings[axis]) === JSON.stringify(FROZEN_AXIS_MAPPINGS[axis]));
  if (mapping?.schema_version !== 1 || mapping?.mapping_policy_version !== AXIS_MAPPING_POLICY_VERSION ||
      mapping?.mapping_content_sha256 !== AXIS_MAPPING_CONTENT_SHA256 ||
      contentSha256 !== AXIS_MAPPING_CONTENT_SHA256 ||
      Object.keys(mapping?.mappings || {}).length !== ANNOTATION_AXES.length || !exactMappings) {
    fail("BENCHMARK_AXIS_MAPPING_INVALID", "The benchmark axis mapping is invalid");
  }
  return contentSha256;
}

function projectImageIdentity(image) {
  return {
    relative_path: image.relative_path,
    bytes: image.bytes,
    sha256: image.sha256,
    media_type: image.media_type,
    encoded_width: image.encoded_width,
    encoded_height: image.encoded_height
  };
}

function validProjectedImageIdentity(image) {
  return typeof image?.relative_path === "string" && image.relative_path &&
    Number.isSafeInteger(image.bytes) && image.bytes > 0 &&
    /^[a-f0-9]{64}$/.test(image.sha256 || "") &&
    ["image/png", "image/jpeg"].includes(image.media_type) &&
    Number.isSafeInteger(image.encoded_width) && image.encoded_width > 0 &&
    Number.isSafeInteger(image.encoded_height) && image.encoded_height > 0;
}

function validRawRuntimeDimensions(dimensions) {
  return Array.isArray(dimensions) && dimensions.length === RUNTIME_DIMENSIONS.length &&
    dimensions.every((entry, index) => entry?.dimension === RUNTIME_DIMENSIONS[index] &&
      entry.verdict === "unknown" && typeof entry.evidence_ref === "string" && entry.evidence_ref);
}

async function assertOutputOutsideControlledRoot({ storageAlias, outputPath, env }) {
  const root = env[`${storageAlias}_ROOT`];
  if (!root || typeof outputPath !== "string" || !outputPath) {
    fail("BENCHMARK_OUTPUT_PATH_INVALID", "Benchmark Evidence requires a controlled output path");
  }
  try {
    const [controlledRoot, outputParent] = await Promise.all([
      realpath(root),
      realpath(path.dirname(path.resolve(outputPath)))
    ]);
    const relativeParent = path.relative(controlledRoot, outputParent);
    const parentInsideRoot = relativeParent === "" ||
      (!path.isAbsolute(relativeParent) && relativeParent !== ".." && !relativeParent.startsWith(`..${path.sep}`));
    if (path.resolve(outputPath) === path.resolve(root) || parentInsideRoot) {
      fail("BENCHMARK_OUTPUT_PATH_INVALID", "Benchmark Evidence cannot be written into the controlled dataset");
    }
  } catch (error) {
    if (error instanceof AppearanceBenchmarkError) throw error;
    fail("BENCHMARK_OUTPUT_PATH_INVALID", "Benchmark Evidence output parent is unavailable or unsafe");
  }
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
