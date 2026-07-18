import { findStep } from "./manifest.js";
import {
  assertStepPlaceholders,
  extractProducedVariables,
  substituteCaptureValue
} from "./step-runtime.js";

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
      assertStepPlaceholders(step, variables);
      const body = substituteCaptureValue(step.response.body, variables);
      const produced = extractProducedVariables(step.produces, body);
      return { status: step.response.status, body, produced };
    }
  };
}
