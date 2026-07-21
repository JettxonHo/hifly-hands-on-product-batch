import { readFile } from "node:fs/promises";
import { findStep } from "./manifest.js";
import { findSensitiveKeys, isSensitiveKey } from "./sensitive.js";
import {
  assertStepPlaceholders,
  extractProducedVariables,
  substituteCaptureValue
} from "./step-runtime.js";

const DEFAULT_ALLOWED_HOSTS = new Set(["hiflyworks-api.lingverse.co"]);
const DEFAULT_UPLOAD_ALLOWED_HOSTS = new Set(["prod-metarium.oss-cn-shanghai.aliyuncs.com"]);
const DEFAULT_ARTIFACT_ALLOWED_HOSTS = new Set(["hfcdn.lingverse.co"]);
const PLACEHOLDER_TOKEN = /^\{\{[A-Za-z0-9_]+\}\}$/;
const TEMPLATE_PLACEHOLDER = /\{\{([A-Za-z0-9_]+)\}\}/g;
const SAFE_PRODUCED_NAMES = new Set([
  "product_image_id",
  "person_image_id",
  "goods_image_oss_key",
  "asset_id",
  "remote_id",
  "artifact_filename"
]);

function fail(code, message) {
  throw Object.assign(new Error(message || code), { code });
}

function placeholderNames(placeholders = []) {
  return placeholders.map((placeholder) => placeholder.replace(/^\{\{|\}\}$/g, ""));
}

function templatePlaceholderNames(value) {
  if (typeof value === "string") {
    const placeholders = [...value.matchAll(TEMPLATE_PLACEHOLDER)].map((match) => match[1]);
    if (value.replace(TEMPLATE_PLACEHOLDER, "").includes("{") || value.replace(TEMPLATE_PLACEHOLDER, "").includes("}")) {
      fail("CAPTURE_HTTP_UNDECLARED_PLACEHOLDER", "Request template contains malformed placeholder markers.");
    }
    return placeholders;
  }
  if (Array.isArray(value)) return value.flatMap(templatePlaceholderNames);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => [
      ...templatePlaceholderNames(key),
      ...templatePlaceholderNames(child)
    ]);
  }
  return [];
}

function assertDeclaredTemplatePlaceholders(step) {
  if (!Array.isArray(step.placeholders) || step.placeholders.some((placeholder) => typeof placeholder !== "string" || !PLACEHOLDER_TOKEN.test(placeholder))) {
    fail("CAPTURE_HTTP_INVALID_PLACEHOLDER", "Placeholder declarations must use the {{name}} format.");
  }
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

function hostAllowed(hostname, config) {
  const allowed = new Set(Array.isArray(config?.allowedHosts) ? config.allowedHosts : [...DEFAULT_ALLOWED_HOSTS]);
  return allowed.has(hostname);
}

function uploadHostAllowed(hostname, config) {
  const allowed = new Set(Array.isArray(config?.uploadAllowedHosts) ? config.uploadAllowedHosts : [...DEFAULT_UPLOAD_ALLOWED_HOSTS]);
  return allowed.has(hostname);
}

function artifactHostAllowed(hostname, config) {
  const allowed = new Set(Array.isArray(config?.artifactAllowedHosts) ? config.artifactAllowedHosts : [...DEFAULT_ARTIFACT_ALLOWED_HOSTS]);
  return allowed.has(hostname);
}

function runtimeHeadersForUrl(runtimeAuth, url) {
  return {
    ...(runtimeAuth?.headers && typeof runtimeAuth.headers === "object" ? runtimeAuth.headers : {}),
    ...(typeof runtimeAuth?.headersForUrl === "function" ? runtimeAuth.headersForUrl(url.href) : {})
  };
}

function hasAuthHeaders(headers) {
  return Boolean(headers && typeof headers === "object" && Object.keys(headers).length > 0);
}

function mergeRuntimeHeaders(headers, runtimeHeaders) {
  return {
    ...headers,
    ...runtimeHeaders
  };
}

function assertLiveGate({ config, context, step, url, runtimeHeaders }) {
  if (config?.enabled !== true) {
    fail("CAPTURE_HTTP_REAL_LIVE_DISABLED", "real_live is disabled.");
  }
  if (context?.allowRealLive !== true) {
    fail("CAPTURE_HTTP_REAL_LIVE_NOT_AUTHORIZED", "real_live requires explicit per-run authorization.");
  }
  if (step.risk?.may_consume_points === true && context?.acknowledgePointRisk !== true) {
    fail("CAPTURE_HTTP_POINT_RISK_NOT_ACKNOWLEDGED", "This capture step may consume Hifly points.");
  }
  if (!hostAllowed(url.hostname, config)) {
    fail("CAPTURE_HTTP_HOST_NOT_ALLOWED", `Host is not allowed for real_live: ${url.hostname}`);
  }
  if (step.risk?.requires_auth === true && !hasAuthHeaders(runtimeHeaders)) {
    fail("CAPTURE_HTTP_AUTH_REQUIRED", "This capture step requires runtime authentication for the target host.");
  }
}

function assertNoUnresolved(value) {
  const unresolved = templatePlaceholderNames(value).map((name) => `{{${name}}}`);
  if (unresolved.length > 0) {
    fail("CAPTURE_HTTP_UNRESOLVED_PLACEHOLDER", `Unresolved placeholders: ${unresolved.join(", ")}`);
  }
}

function hasAbsoluteLocalPath(value) {
  if (typeof value !== "string") return false;
  const candidate = value.trim();
  if (/^file:/i.test(candidate)) return true;
  if (/^https?:\/\//i.test(candidate)) return false;
  return /(?:^|[\s"'=,:])(?:\/+|\\+|[A-Za-z]:[\\/])/.test(candidate);
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

function assertNoSensitiveResolvedQueryKeys(url) {
  if ([...url.searchParams.keys()].some(isSensitiveKey)) {
    fail("CAPTURE_HTTP_SENSITIVE_TEMPLATE", "Resolved request URL contains sensitive query keys.");
  }
}

function assertSafeProducedVariables(produced) {
  for (const [name, value] of Object.entries(produced || {})) {
    if (!SAFE_PRODUCED_NAMES.has(name) || isSensitiveKey(name)) {
      fail("CAPTURE_HTTP_PRODUCES_UNSAFE", "Produced variables must use approved non-sensitive names.");
    }
    if (!["string", "number", "boolean"].includes(typeof value)) {
      fail("CAPTURE_HTTP_PRODUCES_UNSAFE", "Produced variables must be scalar values.");
    }
    const text = String(value);
    if (text.length > 512 || /^https?:\/\//i.test(text) || /^file:/i.test(text) || /[?&]/.test(text) || hasAbsoluteLocalPath(text)) {
      fail("CAPTURE_HTTP_PRODUCES_UNSAFE", "Produced variables must not contain URLs or signed query values.");
    }
  }
}

function normalizeUploadUrl(data = {}, config = {}) {
  const candidates = [data.safe_url, data.upload_url].filter((value) => typeof value === "string" && value.trim());
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "https:" && uploadHostAllowed(parsed.hostname, config)) return parsed.href;
      if (parsed.protocol === "http:" && parsed.hostname === "prod-metarium.oss-cn-shanghai-internal.aliyuncs.com") {
        parsed.protocol = "https:";
        parsed.hostname = "prod-metarium.oss-cn-shanghai.aliyuncs.com";
        if (uploadHostAllowed(parsed.hostname, config)) return parsed.href;
      }
    } catch {
      // Try the next candidate.
    }
  }
  fail("CAPTURE_HTTP_UPLOAD_URL_UNAVAILABLE", "Upload URL response did not include an allowed HTTPS upload URL.");
}

function shouldUploadProductImage(step, responseBody, variables) {
  return step.id === "upload_image_001" &&
    typeof variables.product_image_path === "string" &&
    responseBody?.data &&
    typeof responseBody.data === "object";
}

async function uploadProductImage({ step, responseBody, variables, transport, config }) {
  if (!shouldUploadProductImage(step, responseBody, variables)) return;
  const uploadUrl = normalizeUploadUrl(responseBody.data, config);
  let bytes;
  try {
    bytes = await readFile(variables.product_image_path);
  } catch {
    fail("CAPTURE_HTTP_UPLOAD_ARTIFACT_MISSING", "Product image file is unavailable for upload.");
  }
  const contentType = responseBody.data.content_type || step.request_template?.body?.content_type || "image/jpeg";
  const response = await transport.request({
    step: { ...step, id: `${step.id}:upload_object`, phase: step.phase },
    method: "PUT",
    url: uploadUrl,
    headers: { "content-type": contentType },
    body: bytes,
    timeoutMs: config.uploadTimeoutMs ?? config.timeoutMs ?? 30000,
    responseType: "empty"
  });
  if (response?.status < 200 || response?.status >= 300) {
    fail("CAPTURE_HTTP_UPLOAD_FAILED", "Product image upload returned a non-success status.");
  }
}

function latestListEntry(responseBody) {
  const list = responseBody?.data?.list;
  if (!Array.isArray(list)) return null;
  let latest = null;
  for (const entry of list) {
    if (!entry || typeof entry.create_time !== "number") continue;
    if (latest === null || entry.create_time > latest.create_time) latest = entry;
  }
  return latest;
}

function artifactListEntry(responseBody, remoteId) {
  const list = responseBody?.data?.list;
  if (!Array.isArray(list)) return null;
  return list.find((entry) => entry && String(entry.id) === String(remoteId)) || null;
}

function normalizeArtifactDownloadUrl(responseBody, variables, config) {
  const entry = artifactListEntry(responseBody, variables.remote_id);
  const artifactUrl = typeof entry?.url === "string" ? entry.url.trim() : "";
  if (!artifactUrl) return null;
  try {
    const parsed = new URL(artifactUrl);
    if (parsed.protocol === "https:" && artifactHostAllowed(parsed.hostname, config)) return parsed.href;
  } catch {
    // Fall through to the stable error below.
  }
  fail("CAPTURE_HTTP_ARTIFACT_URL_UNAVAILABLE", "Artifact list did not include an allowed HTTPS video URL.");
}

async function downloadArtifactFromList({ step, responseBody, variables, transport, config }) {
  if (step.phase !== "download" || responseBody?.code !== 0) return null;
  const artifactUrl = normalizeArtifactDownloadUrl(responseBody, variables, config);
  if (!artifactUrl) return null;
  const response = await transport.request({
    step: { ...step, id: `${step.id}:download_artifact`, phase: step.phase },
    method: "GET",
    url: artifactUrl,
    headers: { accept: "video/*,application/octet-stream;q=0.9,*/*;q=0.1" },
    body: null,
    timeoutMs: config.downloadTimeoutMs ?? config.timeoutMs ?? 30000
  });
  if (response?.status < 200 || response?.status >= 300) {
    fail("CAPTURE_HTTP_ARTIFACT_DOWNLOAD_FAILED", "Artifact download returned a non-success status.");
  }
  if (!response?.artifact?.bytes) {
    fail("CAPTURE_HTTP_ARTIFACT_MISSING", "Artifact download did not return video bytes.");
  }
  return response.artifact;
}

function producedWithMatchedArtifactFilename(step, responseBody, variables, produced) {
  if (step.phase !== "download" || !Object.hasOwn(produced || {}, "artifact_filename")) return produced;
  const entry = artifactListEntry(responseBody, variables.remote_id);
  if (!entry || typeof entry.title !== "string" || entry.title.trim() === "") return produced;
  return {
    ...produced,
    artifact_filename: entry.title.trim()
  };
}

function withoutUrls(value) {
  if (Array.isArray(value)) return value.map(withoutUrls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^url$/i.test(key) && !/_url$/i.test(key))
    .map(([key, child]) => [key, withoutUrls(child)]));
}

function publicResponseBody(step, responseBody) {
  if (!responseBody || typeof responseBody !== "object") return responseBody;
  if (step.id === "upload_image_001" && responseBody?.data && typeof responseBody.data === "object") {
    return {
      ...responseBody,
      data: {
        oss_key: responseBody.data.oss_key,
        content_type: responseBody.data.content_type
      }
    };
  }
  return withoutUrls(responseBody);
}

function bodyWithArtifactFilename(responseBody, artifact) {
  if (!artifact?.filename || responseBody?.artifact_filename) return responseBody;
  return {
    ...responseBody,
    artifact_filename: artifact.filename
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canRetryMissingProduces(step) {
  return step.method === "GET" && step.produces && Object.keys(step.produces).length > 0;
}

function canRetryArtifactList(step, responseBody) {
  return step.method === "GET" && step.phase === "download" && Array.isArray(responseBody?.data?.list);
}

function shouldRetryResponse(step) {
  return canRetryMissingProduces(step) || step.method === "GET" && step.phase === "download";
}

function assertDownloadListHasArtifactUrl(step, response, responseBody, variables, config) {
  if (!canRetryArtifactList(step, responseBody)) return;
  if (response?.artifact?.bytes) return;
  if (normalizeArtifactDownloadUrl(responseBody, variables, config) === null) {
    fail("CAPTURE_HTTP_ARTIFACT_MISSING", "Artifact list did not include the current video's downloadable URL yet.");
  }
}

async function requestWithProducesRetry({ step, request, variables, transport, config }) {
  const attempts = shouldRetryResponse(step) ? Math.max(1, Number(config.pollAttempts ?? 60)) : 1;
  const intervalMs = Math.max(0, Number(config.pollIntervalMs ?? 5000));
  let lastResponse = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await transport.request(request);
    if (response?.status < 200 || response?.status >= 300) {
      fail("CAPTURE_HTTP_STATUS_NOT_OK", "Live HTTP request returned a non-success status.");
    }
    const responseBody = response?.body ?? {};
    if (responseBody && typeof responseBody === "object" && responseBody.code !== undefined && responseBody.code !== 0) {
      fail("CAPTURE_HTTP_REMOTE_REJECTED", "Live HTTP request was rejected by the remote service.");
    }
    try {
      const produced = extractProducedVariables(step.produces, responseBody);
      // Discovery 1: a freshly submitted video may not have reached list[0] yet, so
      // prefer the newest entry by create_time over the positional list[0].id.
      if (produced.remote_id !== undefined) {
        const latest = latestListEntry(responseBody);
        if (latest && latest.id !== undefined && latest.id !== null) {
          produced.remote_id = latest.id;
        }
      }
      assertDownloadListHasArtifactUrl(step, response, responseBody, variables, config);
      return { response, responseBody, produced };
    } catch (error) {
      const retryable = error?.code === "CAPTURE_PRODUCES_MISSING" || error?.code === "CAPTURE_HTTP_ARTIFACT_MISSING";
      if (!retryable || !shouldRetryResponse(step) || attempt === attempts) {
        if (error?.code === "CAPTURE_PRODUCES_MISSING") {
          fail("CAPTURE_HTTP_MANIFEST_DRIFT", `Manifest drift on capture step "${step.id}": ${error.message} (transport already dispatched; remote API may have changed — re-capture).`);
        }
        throw error;
      }
      lastResponse = response;
      await wait(intervalMs);
    }
  }
  return { response: lastResponse, responseBody: lastResponse?.body ?? {}, produced: {} };
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
      assertNoSensitiveResolvedQueryKeys(url);
      assertUrlHasNoLocalPaths(url);
      assertNoLocalPaths(templateHeaders);
      assertNoLocalPaths(body);
      const runtimeHeaders = runtimeHeadersForUrl(runtimeAuth, url);
      assertLiveGate({ config, context, step, url, runtimeHeaders });
      const headers = mergeRuntimeHeaders(templateHeaders, runtimeHeaders);
      assertNoLocalPaths(headers);
      const request = {
        step,
        method: step.method,
        url: url.href,
        headers,
        body,
        timeoutMs: config.timeoutMs ?? 30000
      };
      const { response, responseBody, produced } = await requestWithProducesRetry({ step, request, variables, transport, config });
      await uploadProductImage({ step, responseBody, variables, transport, config });
      const listArtifact = response?.artifact ? null : await downloadArtifactFromList({ step, responseBody, variables, transport, config });
      const safeProduced = producedWithMatchedArtifactFilename(step, responseBody, variables, produced);
      assertSafeProducedVariables(safeProduced);
      const artifact = response?.artifact || listArtifact || null;
      const safeBody = publicResponseBody(step, bodyWithArtifactFilename(responseBody, artifact));
      return {
        status: response?.status ?? step.response.status,
        body: safeBody,
        artifact,
        produced: safeProduced,
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
