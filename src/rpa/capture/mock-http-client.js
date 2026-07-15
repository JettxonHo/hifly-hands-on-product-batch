import { findStep } from "./manifest.js";

function substitute(value, variables) {
  if (typeof value === "string") {
    return value.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : match
    );
  }
  if (Array.isArray(value)) return value.map((entry) => substitute(entry, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, substitute(child, variables)]));
  }
  return value;
}

function extractProduced(produces, body) {
  const result = {};
  for (const [name, path] of Object.entries(produces || {})) {
    if (typeof path !== "string" || !path.startsWith("$response.body.")) {
      throw Object.assign(new Error(`unsupported produces path for ${name}: ${path}`), { code: "CAPTURE_PRODUCES_PATH" });
    }
    const segments = path.replace("$response.body.", "").split(".");
    let current = body;
    for (const segment of segments) {
      if (current == null || typeof current !== "object" || !(segment in current)) {
        throw Object.assign(new Error(`produces path not found for ${name}: ${path}`), { code: "CAPTURE_PRODUCES_MISSING" });
      }
      current = current[segment];
    }
    result[name] = current;
  }
  return result;
}

export function createMockHttpClient({ manifest }) {
  if (!manifest || !Array.isArray(manifest.steps)) {
    throw new TypeError("createMockHttpClient requires a parsed manifest");
  }
  return {
    async request({ stepId, variables = {} }) {
      const step = findStep(manifest, stepId);
      if (!step) {
        throw Object.assign(new Error(`Unknown capture step: ${stepId}`), { code: "CAPTURE_STEP_NOT_FOUND" });
      }
      for (const placeholder of step.placeholders) {
        const name = placeholder.replace(/^\{\{|\}\}$/g, "");
        if (!Object.prototype.hasOwnProperty.call(variables, name)) {
          throw Object.assign(new Error(`Missing variable for step ${stepId}: ${name}`), { code: "CAPTURE_MISSING_VARIABLE" });
        }
      }
      const body = substitute(step.response.body, variables);
      const produced = extractProduced(step.produces, body);
      return { status: step.response.status, body, produced };
    }
  };
}
