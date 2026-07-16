import { createDryRunHttpClient } from "./dry-run-http-client.js";
import { createMockHttpClient } from "./mock-http-client.js";

export const CAPTURE_HTTP_MODES = Object.freeze(["mock", "real_dry_run", "real_live"]);

function fail(code, message) {
  throw Object.assign(new Error(message || code), { code });
}

export function normalizeCaptureHttpMode(mode = "mock") {
  const value = mode || "mock";
  if (!CAPTURE_HTTP_MODES.includes(value)) {
    fail("CAPTURE_HTTP_MODE_INVALID", `Unsupported captureHttpMode: ${value}`);
  }
  return value;
}

export function createCaptureHttpClient({ mode = "mock", manifest } = {}) {
  const normalized = normalizeCaptureHttpMode(mode);
  if (normalized === "mock") return createMockHttpClient({ manifest });
  if (normalized === "real_dry_run") return createDryRunHttpClient({ manifest });
  fail("CAPTURE_HTTP_REAL_LIVE_DISABLED", "real_live is not implemented or authorized");
}
