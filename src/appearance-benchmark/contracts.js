export const BENCHMARK_STORAGE_ALIAS = "HIFLY_APPEARANCE_BENCHMARK_V1";

export const BENCHMARK_LANES = Object.freeze({
  "macos-arm64-smoke": Object.freeze({ os: "darwin", architecture: "arm64" }),
  "linux-amd64-canonical": Object.freeze({ os: "linux", architecture: "amd64" })
});

export const RUNTIME_DIMENSIONS = Object.freeze([
  "form_geometry",
  "parts_connections",
  "color",
  "proportion",
  "packaging",
  "logo",
  "label_text"
]);

export const ANNOTATION_AXES = Object.freeze([
  "form_silhouette",
  "cap_pump_key_parts",
  "label_logo_text",
  "color_material",
  "local_structure_decoration",
  "internal_proportion_size_impression",
  "obvious_artifacts"
]);

export const AXIS_MAPPING_POLICY_VERSION = "d036-c3-v1";
export const AXIS_MAPPING_CONTENT_SHA256 = "1e5fc0362d70d9d3b9bd63ed858889de7a7cd3b5a922e013ae354d1224bf9470";
export const FROZEN_AXIS_MAPPINGS = Object.freeze({
  form_silhouette: Object.freeze(["form_geometry"]),
  cap_pump_key_parts: Object.freeze(["parts_connections", "packaging"]),
  label_logo_text: Object.freeze(["logo", "label_text"]),
  color_material: Object.freeze(["color"]),
  local_structure_decoration: Object.freeze(["form_geometry", "parts_connections", "packaging"]),
  internal_proportion_size_impression: Object.freeze(["proportion"]),
  obvious_artifacts: Object.freeze([])
});

export class AppearanceBenchmarkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AppearanceBenchmarkError";
    this.code = code;
  }
}
