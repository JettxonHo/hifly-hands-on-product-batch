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

export class AppearanceBenchmarkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AppearanceBenchmarkError";
    this.code = code;
  }
}
