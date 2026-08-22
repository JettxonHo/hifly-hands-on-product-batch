import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

export async function createSyntheticBenchmarkFixture(root) {
  const datasetRoot = path.join(root, "dataset");
  const cacheRoot = path.join(root, "cache");
  const sourcePath = "pairs/sample-1/source.png";
  const candidatePath = "pairs/sample-1/candidate.png";

  await mkdir(path.join(datasetRoot, "pairs", "sample-1"), { recursive: true });
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(path.join(datasetRoot, sourcePath), PNG_1X1);
  await writeFile(path.join(datasetRoot, candidatePath), PNG_1X1);

  const image = {
    bytes: PNG_1X1.length,
    sha256: sha256(PNG_1X1),
    media_type: "image/png",
    encoded_width: 1,
    encoded_height: 1
  };
  const manifest = {
    schema_version: 1,
    dataset_id: "synthetic-appearance-contract",
    dataset_version: "v1",
    status: "synthetic_fixture_only",
    samples: [{
      sample_id: "sample-1",
      category: "allowed_variation",
      source: { path: sourcePath, ...image },
      candidate: { path: candidatePath, ...image }
    }]
  };
  await writeFile(
    path.join(datasetRoot, "dataset-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  const lock = {
    schema_version: 1,
    storage_alias: "HIFLY_APPEARANCE_BENCHMARK_V1",
    lanes: {
      "macos-arm64-smoke": {
        os: "darwin",
        architecture: "arm64",
        python: "3.11.16",
        dependency_lock_sha256: "a".repeat(64)
      },
      "linux-amd64-canonical": {
        os: "linux",
        architecture: "amd64",
        python: "3.11.16",
        oci_manifest_digest: `sha256:${"b".repeat(64)}`,
        dependency_lock_sha256: "c".repeat(64)
      }
    }
  };
  const lockPath = path.join(root, "environment-lock.json");
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const operationsPolicyPath = path.join(root, "operations-policy.json");
  await writeFile(operationsPolicyPath, `${JSON.stringify({
    schema_version: 1,
    policy_version: "synthetic-smoke-v1",
    accepted_thresholds: false,
    allowed_operations: ["decode_dimensions", "sha256"]
  }, null, 2)}\n`);

  const axisMappingPath = path.join(root, "axis-mapping.json");
  await writeFile(axisMappingPath, `${JSON.stringify({
    schema_version: 1,
    mapping_policy_version: "d036-c3-v1",
    mappings: {
      form_silhouette: ["form_geometry"],
      cap_pump_key_parts: ["parts_connections", "packaging"],
      label_logo_text: ["logo", "label_text"],
      color_material: ["color"],
      local_structure_decoration: ["form_geometry", "parts_connections", "packaging"],
      internal_proportion_size_impression: ["proportion"],
      obvious_artifacts: []
    }
  }, null, 2)}\n`);

  return { datasetRoot, cacheRoot, lockPath, operationsPolicyPath, axisMappingPath };
}

export async function createSyntheticHumanTruth(root) {
  const axes = [
    "form_silhouette",
    "cap_pump_key_parts",
    "label_logo_text",
    "color_material",
    "local_structure_decoration",
    "internal_proportion_size_impression",
    "obvious_artifacts"
  ];
  const annotation = {
    schema_version: 1,
    dataset_id: "synthetic-appearance-contract",
    dataset_version: "v1",
    pack_id: "synthetic-annotation-v1",
    status: "completed",
    samples: [{
      sample_id: "sample-1",
      axes: axes.map((axis) => ({
        axis,
        status: axis === "cap_pump_key_parts" ? "unsupported" : "supported",
        reason: "synthetic contract fixture",
        evidence_by_runtime_dimension: axis === "cap_pump_key_parts"
          ? { parts_connections: "synthetic evidence for parts only" }
          : {}
      }))
    }]
  };
  const annotationBytes = Buffer.from(`${JSON.stringify(annotation, null, 2)}\n`);
  const annotationPath = path.join(root, "annotation.json");
  await writeFile(annotationPath, annotationBytes);
  const review = {
    schema_version: 1,
    dataset_id: annotation.dataset_id,
    dataset_version: annotation.dataset_version,
    annotation_sha256: sha256(annotationBytes),
    status: "accepted",
    reviewer_role: "synthetic-reviewer",
    annotator_role: "synthetic-annotator"
  };
  const reviewPath = path.join(root, "review.json");
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
  return { annotationPath, reviewPath };
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
