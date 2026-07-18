import { findStep } from "./manifest.js";
import {
  assertStepPlaceholders,
  extractProducedVariables,
  substituteCaptureValue
} from "./step-runtime.js";

function unresolvedPlaceholders(value) {
  const text = JSON.stringify(value);
  return text.match(/\{\{[A-Za-z0-9_]+\}\}/g) || [];
}

function placeholderNames(placeholders = []) {
  return placeholders.map((placeholder) => placeholder.replace(/^\{\{|\}\}$/g, ""));
}

function riskFlags(risk = {}) {
  const flags = [];
  if (risk.requires_auth === true) flags.push("auth_required");
  if (risk.may_consume_points === true) flags.push("may_consume_points");
  if (risk.replayability === "unknown") flags.push("replayability_unknown");
  if (risk.replayability === "api_unavailable") flags.push("api_unavailable");
  return flags;
}

function fail(code, message) {
  throw Object.assign(new Error(message || code), { code });
}

function requestTemplate(step) {
  const template = step.request_template || {};
  return {
    headers: template.headers ? { ...template.headers } : {},
    body: template.body === undefined ? null : structuredClone(template.body)
  };
}

export function createDryRunHttpClient({ manifest }) {
  if (!manifest || !Array.isArray(manifest.steps)) {
    throw new TypeError("createDryRunHttpClient requires a parsed manifest");
  }
  return {
    async request({ stepId, variables = {} }) {
      const step = findStep(manifest, stepId);
      if (!step) fail("CAPTURE_STEP_NOT_FOUND", `Unknown capture step: ${stepId}`);
      if (step.risk?.replayability === "api_unavailable") {
        fail("CAPTURE_HTTP_API_UNAVAILABLE", `Capture step is not replayable: ${stepId}`);
      }
      try {
        assertStepPlaceholders(step, variables);
      } catch (error) {
        if (error?.code === "CAPTURE_MISSING_VARIABLE") {
          fail("CAPTURE_HTTP_UNRESOLVED_PLACEHOLDER", error.message);
        }
        throw error;
      }
      const resolvedUrl = substituteCaptureValue(step.url_template, variables);
      const template = requestTemplate(step);
      const headers = substituteCaptureValue(template.headers, variables);
      const body = substituteCaptureValue(template.body, variables);
      const unresolved = unresolvedPlaceholders({ resolvedUrl, headers, body });
      if (unresolved.length > 0) {
        fail("CAPTURE_HTTP_UNRESOLVED_PLACEHOLDER", `Unresolved placeholders: ${unresolved.join(", ")}`);
      }
      const url = new URL(resolvedUrl);
      const responseBody = substituteCaptureValue(step.response.body, variables);
      const produced = extractProducedVariables(step.produces, responseBody);
      return {
        status: step.response.status,
        body: responseBody,
        produced,
        request_plan: {
          step_id: step.id,
          phase: step.phase,
          method: step.method,
          host: url.hostname,
          path: `${url.pathname}${url.search}`,
          url: url.href,
          headers,
          body,
          placeholders: placeholderNames(step.placeholders),
          risk_flags: riskFlags(step.risk)
        }
      };
    }
  };
}
