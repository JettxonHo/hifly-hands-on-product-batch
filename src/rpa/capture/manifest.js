import { readFile } from "node:fs/promises";
import { findSensitiveKeys } from "./sensitive.js";

export const CAPTURE_PHASES = Object.freeze(["asset_generation", "remote_submit", "remote_query", "download"]);
const PHASE_SET = new Set(CAPTURE_PHASES);

function fail(message) {
  throw Object.assign(new Error(message), { code: "INVALID_CAPTURE_MANIFEST" });
}

function asObject(input) {
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch {
      fail("manifest input string is not valid JSON");
    }
  }
  if (input && typeof input === "object") return input;
  fail("manifest input must be an object or JSON string");
}

function validateStep(step, index, seenIds) {
  if (!step || typeof step !== "object") fail(`steps[${index}] must be an object`);
  const { id, phase, method, url_template, response } = step;
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)) fail(`steps[${index}].id is invalid`);
  if (seenIds.has(id)) fail(`duplicate step id: ${id}`);
  seenIds.add(id);
  if (!PHASE_SET.has(phase)) fail(`unknown phase: ${phase}`);
  if (typeof method !== "string" || method.length === 0) fail(`steps[${index}].method must be a non-empty string`);
  if (typeof url_template !== "string" || url_template.length === 0) {
    fail(`steps[${index}].url_template must be a non-empty string`);
  }
  if (!response || typeof response !== "object") fail(`steps[${index}].response must be an object`);
  if (!Number.isInteger(response.status)) fail(`steps[${index}].response.status must be an integer`);
  if (response.body === undefined) fail(`steps[${index}].response.body is required`);
  if (step.placeholders !== undefined && !Array.isArray(step.placeholders)) {
    fail(`steps[${index}].placeholders must be an array`);
  }
  return {
    id,
    phase,
    method,
    url_template,
    placeholders: Array.isArray(step.placeholders) ? [...step.placeholders] : [],
    response: { status: response.status, body: structuredClone(response.body) },
    produces: step.produces && typeof step.produces === "object" ? { ...step.produces } : {}
  };
}

export function parseCaptureManifest(input) {
  const data = asObject(input);
  if (data.schema_version !== 1) fail("schema_version must be 1");
  if (data.sanitized !== true) fail("manifest must be sanitized before loading");
  if (!Array.isArray(data.steps) || data.steps.length === 0) fail("steps must be a non-empty array");

  const hits = findSensitiveKeys(data, "");
  if (hits.length > 0) fail(`manifest contains sensitive keys: ${hits.join(", ")}`);

  const seenIds = new Set();
  const steps = data.steps.map((step, index) => validateStep(step, index, seenIds));

  return Object.freeze({
    schema_version: 1,
    source: typeof data.source === "string" ? data.source : "",
    captured_at: typeof data.captured_at === "string" ? data.captured_at : null,
    sanitized: true,
    notes: typeof data.notes === "string" ? data.notes : null,
    steps: Object.freeze(steps)
  });
}

export async function loadCaptureManifest(filePath) {
  const raw = await readFile(filePath, "utf8");
  return parseCaptureManifest(JSON.parse(raw));
}

export function selectStepsByPhase(manifest, phase) {
  return manifest.steps.filter((step) => step.phase === phase);
}

export function findStep(manifest, stepId) {
  return manifest.steps.find((step) => step.id === stepId) ?? null;
}
