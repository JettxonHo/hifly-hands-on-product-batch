import { findStep } from "./manifest.js";
import { findSensitiveKeys, isSensitiveKey } from "./sensitive.js";
import {
  assertStepPlaceholders,
  extractProducedVariables,
  substituteCaptureValue
} from "./step-runtime.js";

const DEFAULT_ALLOWED_HOSTS = new Set(["hiflyworks-api.lingverse.co"]);

function fail(code, message) {
  throw Object.assign(new Error(message || code), { code });
}

function placeholderNames(placeholders = []) {
  return placeholders.map((placeholder) => placeholder.replace(/^\{\{|\}\}$/g, ""));
}

function templatePlaceholderNames(value) {
  if (typeof value === "string") {
    return [...value.matchAll(/\{\{([^{}]*)\}\}/g)].map((match) => match[1]);
  }
  if (Array.isArray(value)) return value.flatMap(templatePlaceholderNames);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(templatePlaceholderNames);
  }
  return [];
}

function assertDeclaredTemplatePlaceholders(step) {
  const declared = new Set(placeholderNames(step.placeholders));
  const used = new Set(templatePlaceholderNames([
    step.url_template,
    step.request_template?.headers,
    step.request_template?.body,
    step.placeholders
  ]));
  const undeclared = [...used].filter((name) => !declared.has(name));
  if (undeclared.length > 0) {
    fail("CAPTURE_HTTP_UNDECLARED_PLACEHOLDER", `Undeclared placeholders: ${undeclared.join(", ")}`);
  }
}

function assertNoSensitiveTemplate(step) {
  const template = step.request_template || {};
  const sensitiveTemplateKeys = findSensitiveKeys({
    headers: template.headers,
    body: template.body
  });
  let url;
  try {
    url = new URL(step.url_template);
  } catch {
    fail("CAPTURE_HTTP_SENSITIVE_TEMPLATE", "Request template URL must be valid.");
  }
  const sensitiveQueryKeys = [...url.searchParams.keys()].filter(isSensitiveKey);
  if (sensitiveTemplateKeys.length > 0 || sensitiveQueryKeys.length > 0) {
    fail("CAPTURE_HTTP_SENSITIVE_TEMPLATE", "Request template contains sensitive keys.");
  }
}

function riskFlags(risk = {}) {
  const flags = [];
  if (risk.requires_auth === true) flags.push("auth_required");
  if (risk.may_consume_points === true) flags.push("may_consume_points");
  if (risk.replayability === "unknown") flags.push("replayability_unknown");
  if (risk.replayability === "api_unavailable") flags.push("api_unavailable");
  return flags;
}

function requestTemplate(step) {
  const template = step.request_template || {};
  return {
    headers: template.headers ? { ...template.headers } : {},
    body: template.body === undefined ? null : structuredClone(template.body)
  };
}

function hasRuntimeAuth(runtimeAuth) {
  return Boolean(
    runtimeAuth &&
    typeof runtimeAuth === "object" &&
    (
      runtimeAuth.headers && Object.keys(runtimeAuth.headers).length > 0 ||
      Array.isArray(runtimeAuth.cookies) && runtimeAuth.cookies.length > 0
    )
  );
}

function mergeRuntimeHeaders(headers, runtimeAuth) {
  return {
    ...headers,
    ...(runtimeAuth?.headers && typeof runtimeAuth.headers === "object" ? runtimeAuth.headers : {})
  };
}

function assertLiveGate({ config, context, step, url, runtimeAuth }) {
  if (config?.enabled !== true) {
    fail("CAPTURE_HTTP_REAL_LIVE_DISABLED", "real_live is disabled.");
  }
  if (context?.allowRealLive !== true) {
    fail("CAPTURE_HTTP_REAL_LIVE_NOT_AUTHORIZED", "real_live requires explicit per-run authorization.");
  }
  if (step.risk?.may_consume_points === true && context?.acknowledgePointRisk !== true) {
    fail("CAPTURE_HTTP_POINT_RISK_NOT_ACKNOWLEDGED", "This capture step may consume Hifly points.");
  }
  if (step.risk?.requires_auth === true && !hasRuntimeAuth(runtimeAuth)) {
    fail("CAPTURE_HTTP_AUTH_REQUIRED", "This capture step requires runtime authentication.");
  }
  const allowed = new Set(Array.isArray(config?.allowedHosts) ? config.allowedHosts : [...DEFAULT_ALLOWED_HOSTS]);
  if (!allowed.has(url.hostname)) {
    fail("CAPTURE_HTTP_HOST_NOT_ALLOWED", `Host is not allowed for real_live: ${url.hostname}`);
  }
}

function assertNoUnresolved(value) {
  const text = JSON.stringify(value);
  const unresolved = text.match(/\{\{[^{}]*\}\}/g) || [];
  if (unresolved.length > 0) {
    fail("CAPTURE_HTTP_UNRESOLVED_PLACEHOLDER", `Unresolved placeholders: ${unresolved.join(", ")}`);
  }
}

function hasAbsoluteLocalPath(value) {
  return typeof value === "string" && (
    /file:\/+/i.test(value) ||
    /(?:^|[\s"'=,:])\/(?!\/)/.test(value) ||
    /(?:^|[\s"'=,:])(?:[A-Za-z]:[\\/]|\\{1,2}(?=[^\\/\s]))/.test(value)
  );
}

function assertNoLocalPaths(value) {
  if (typeof value === "string") {
    if (hasAbsoluteLocalPath(value)) {
      fail("CAPTURE_HTTP_LOCAL_PATH_FORBIDDEN", "Request values must not contain absolute local paths.");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertNoLocalPaths(entry);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) assertNoLocalPaths(entry);
  }
}

function assertUrlHasNoLocalPaths(url) {
  for (const value of url.searchParams.values()) assertNoLocalPaths(value);
}

export function createDisabledLiveTransport() {
  return {
    async request() {
      fail("CAPTURE_HTTP_REAL_LIVE_DISABLED", "No real_live transport is configured.");
    }
  };
}

export function createRealLiveHttpClient({
  manifest,
  config = {},
  runtimeAuth = null,
  transport = createDisabledLiveTransport()
} = {}) {
  if (!manifest || !Array.isArray(manifest.steps)) {
    throw new TypeError("createRealLiveHttpClient requires a parsed manifest");
  }
  if (!transport || typeof transport.request !== "function") {
    throw new TypeError("real_live transport must provide request()");
  }
  return {
    async request({ stepId, variables = {}, context = {} }) {
      const step = findStep(manifest, stepId);
      if (!step) fail("CAPTURE_STEP_NOT_FOUND", `Unknown capture step: ${stepId}`);
      if (step.risk?.replayability === "api_unavailable") {
        fail("CAPTURE_HTTP_API_UNAVAILABLE", `Capture step is not replayable: ${stepId}`);
      }
      assertDeclaredTemplatePlaceholders(step);
      assertNoSensitiveTemplate(step);
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
      const templateHeaders = substituteCaptureValue(template.headers, variables);
      const body = substituteCaptureValue(template.body, variables);
      assertNoUnresolved({ resolvedUrl, templateHeaders, body });
      const url = new URL(resolvedUrl);
      assertUrlHasNoLocalPaths(url);
      assertNoLocalPaths(templateHeaders);
      assertNoLocalPaths(body);
      assertLiveGate({ config, context, step, url, runtimeAuth });
      const headers = mergeRuntimeHeaders(templateHeaders, runtimeAuth);
      const response = await transport.request({
        step,
        method: step.method,
        url: url.href,
        headers,
        body,
        timeoutMs: config.timeoutMs || 30000
      });
      const responseBody = response?.body ?? {};
      const produced = extractProducedVariables(step.produces, responseBody);
      return {
        status: response?.status ?? step.response.status,
        body: responseBody,
        produced,
        request_plan: {
          step_id: step.id,
          phase: step.phase,
          method: step.method,
          host: url.hostname,
          path: `${url.pathname}${url.search}`,
          url: url.href,
          headers: templateHeaders,
          body,
          placeholders: placeholderNames(step.placeholders),
          risk_flags: riskFlags(step.risk)
        }
      };
    }
  };
}
