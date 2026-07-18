export function substituteCaptureValue(value, variables) {
  if (typeof value === "string") {
    return value.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : match
    );
  }
  if (Array.isArray(value)) return value.map((entry) => substituteCaptureValue(entry, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, substituteCaptureValue(child, variables)])
    );
  }
  return value;
}

export function assertStepPlaceholders(step, variables) {
  for (const placeholder of step.placeholders || []) {
    const name = placeholder.replace(/^\{\{|\}\}$/g, "");
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      throw Object.assign(new Error(`Missing variable for step ${step.id}: ${name}`), {
        code: "CAPTURE_MISSING_VARIABLE"
      });
    }
  }
}

export function extractProducedVariables(produces, body) {
  const result = {};
  for (const [name, path] of Object.entries(produces || {})) {
    if (typeof path !== "string" || !path.startsWith("$response.body.")) {
      throw Object.assign(new Error(`unsupported produces path for ${name}: ${path}`), {
        code: "CAPTURE_PRODUCES_PATH"
      });
    }
    const segments = path.replace("$response.body.", "").split(".");
    let current = body;
    for (const segment of segments) {
      if (current == null || typeof current !== "object" || !(segment in current)) {
        throw Object.assign(new Error(`produces path not found for ${name}: ${path}`), {
          code: "CAPTURE_PRODUCES_MISSING"
        });
      }
      current = current[segment];
    }
    result[name] = current;
  }
  return result;
}
