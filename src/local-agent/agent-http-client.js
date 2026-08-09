const PREFIX = "/api/agent/v1";
export const LOCAL_AGENT_CANDIDATE_MEDIA_TYPE = "video/mp4";
export const LOCAL_AGENT_PROGRESS_PHASES = Object.freeze([
  "started",
  "downloading_package",
  "compiling",
  "executing",
  "authorizing_candidate",
  "uploading_candidate",
  "reporting"
]);

export const LOCAL_AGENT_ENDPOINTS = Object.freeze({
  heartbeat: `${PREFIX}/heartbeat`,
  claim: `${PREFIX}/tasks/claim`,
  start: (attemptId) => `${PREFIX}/tasks/${encodeURIComponent(attemptId)}/start`,
  heartbeatTask: (attemptId) => `${PREFIX}/tasks/${encodeURIComponent(attemptId)}/heartbeat`,
  downloadPackage: (attemptId) => `${PREFIX}/tasks/${encodeURIComponent(attemptId)}/package`,
  authorizeCandidate: (attemptId) => `${PREFIX}/tasks/${encodeURIComponent(attemptId)}/candidate-authorizations`,
  uploadCandidate: (candidateId) => `${PREFIX}/candidate-uploads/${encodeURIComponent(candidateId)}`,
  completeCandidate: (attemptId, candidateId) => `${PREFIX}/tasks/${encodeURIComponent(attemptId)}/candidates/${encodeURIComponent(candidateId)}/complete`,
  report: (attemptId) => `${PREFIX}/tasks/${encodeURIComponent(attemptId)}/reports`
});

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clientError(code, status = null) {
  const error = new Error(code);
  error.code = code;
  if (status !== null) error.status = status;
  return error;
}

function requireKey(value) {
  const key = clean(value);
  if (!key || key.length > 128) throw clientError("INVALID_IDEMPOTENCY_KEY");
  return key;
}

function requireProgressPhase(value) {
  const phase = clean(value);
  if (!LOCAL_AGENT_PROGRESS_PHASES.includes(phase)) throw clientError("LOCAL_AGENT_PROGRESS_INVALID");
  return phase;
}

function endpointUrl(baseUrl, endpoint) {
  return new URL(endpoint, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

export function createLocalAgentHttpClient({ baseUrl, token, fetchImpl = globalThis.fetch, logger = null } = {}) {
  const normalizedBaseUrl = clean(baseUrl);
  const bearerToken = clean(token);
  if (!normalizedBaseUrl || !bearerToken || typeof fetchImpl !== "function") throw new TypeError("local agent HTTP configuration is required");
  let parsed;
  try {
    parsed = new URL(normalizedBaseUrl);
  } catch {
    throw new TypeError("local agent base URL is invalid");
  }
  if (!(["https:", "http:"].includes(parsed.protocol)) || parsed.username || parsed.password || (parsed.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname))) {
    throw new TypeError("local agent base URL must use HTTPS");
  }

  async function request({ operation, method, endpoint, idempotencyKey = null, headers = {}, body = undefined, responseType = "json" }) {
    const requestHeaders = {
      authorization: `Bearer ${bearerToken}`,
      accept: responseType === "binary" ? "application/zip" : "application/json",
      ...headers
    };
    if (idempotencyKey !== null) requestHeaders["idempotency-key"] = requireKey(idempotencyKey);
    let requestBody = body;
    if (body !== undefined && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
      requestHeaders["content-type"] = "application/json";
      requestBody = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetchImpl(endpointUrl(normalizedBaseUrl, endpoint), { method, headers: requestHeaders, body: requestBody });
    } catch {
      throw clientError("LOCAL_AGENT_HTTP_UNAVAILABLE");
    }
    logger?.info?.("local_agent_http", { operation, status: Number(response?.status) || 0 });
    if (!response?.ok) throw clientError("LOCAL_AGENT_HTTP_FAILED", Number(response?.status) || 0);
    if (responseType === "binary") {
      if (typeof response.arrayBuffer !== "function") throw clientError("LOCAL_AGENT_HTTP_INVALID_RESPONSE");
      return Buffer.from(await response.arrayBuffer());
    }
    if (response.status === 204 || typeof response.json !== "function") return {};
    let value;
    try {
      value = await response.json();
    } catch {
      throw clientError("LOCAL_AGENT_HTTP_INVALID_RESPONSE");
    }
    if (!value || typeof value !== "object") throw clientError("LOCAL_AGENT_HTTP_INVALID_RESPONSE");
    return value;
  }

  return {
    async heartbeat({ idempotencyKey }) {
      return request({ operation: "heartbeat", method: "POST", endpoint: LOCAL_AGENT_ENDPOINTS.heartbeat, idempotencyKey, body: {} });
    },
    async claim({ idempotencyKey }) {
      return request({ operation: "claim", method: "POST", endpoint: LOCAL_AGENT_ENDPOINTS.claim, idempotencyKey, body: {} });
    },
    async start({ attemptId, idempotencyKey }) {
      return request({ operation: "start", method: "POST", endpoint: LOCAL_AGENT_ENDPOINTS.start(attemptId), idempotencyKey, body: {} });
    },
    async heartbeatTask({ attemptId, progressPhase, idempotencyKey }) {
      const phase = requireProgressPhase(progressPhase);
      return request({ operation: "heartbeat_task", method: "POST", endpoint: LOCAL_AGENT_ENDPOINTS.heartbeatTask(attemptId), idempotencyKey,
        body: { progress_phase: phase } });
    },
    async downloadPackage({ attemptId }) {
      return { body: await request({ operation: "download_package", method: "GET", endpoint: LOCAL_AGENT_ENDPOINTS.downloadPackage(attemptId), responseType: "binary" }), contentType: "application/zip" };
    },
    async authorizeCandidate({ attemptId, role, originalFilename, mediaType, size, checksum, idempotencyKey }) {
      return request({ operation: "authorize_candidate", method: "POST", endpoint: LOCAL_AGENT_ENDPOINTS.authorizeCandidate(attemptId), idempotencyKey,
        body: { role, original_filename: originalFilename, media_type: mediaType, size, checksum } });
    },
    async uploadCandidate({ attemptId, candidateId, body, mediaType, idempotencyKey }) {
      if (!clean(attemptId) || !clean(candidateId)) throw clientError("LOCAL_AGENT_CANDIDATE_BINDING_REQUIRED");
      if (mediaType !== LOCAL_AGENT_CANDIDATE_MEDIA_TYPE) throw clientError("LOCAL_AGENT_MEDIA_TYPE_UNSUPPORTED");
      return request({ operation: "upload_candidate", method: "PUT", endpoint: LOCAL_AGENT_ENDPOINTS.uploadCandidate(candidateId), idempotencyKey,
        headers: { "content-type": LOCAL_AGENT_CANDIDATE_MEDIA_TYPE }, body });
    },
    async completeCandidate({ attemptId, candidateId, idempotencyKey }) {
      if (!clean(attemptId) || !clean(candidateId)) throw clientError("LOCAL_AGENT_CANDIDATE_BINDING_REQUIRED");
      return request({ operation: "complete_candidate", method: "POST", endpoint: LOCAL_AGENT_ENDPOINTS.completeCandidate(attemptId, candidateId), idempotencyKey,
        body: {} });
    },
    async report({ attemptId, reportId, outcome, primaryCandidateId = null, errorCode = null, failureStage = null, operatorNote = null, idempotencyKey }) {
      return request({ operation: "report", method: "POST", endpoint: LOCAL_AGENT_ENDPOINTS.report(attemptId), idempotencyKey,
        body: {
          report_id: reportId,
          outcome,
          primary_candidate_id: primaryCandidateId,
          error_code: errorCode,
          error_category: errorCode,
          failure_stage: failureStage,
          reason_code: outcome === "requires_action" ? errorCode : null,
          operator_note: operatorNote
        } });
    }
  };
}

export function createLocalAgentHttpClientFromEnv({ env = process.env, fetchImpl = globalThis.fetch, logger = null } = {}) {
  return createLocalAgentHttpClient({
    baseUrl: env.LOCAL_AGENT_BASE_URL || env.LOCAL_AGENT_API_BASE_URL || env.LOCAL_AGENT_URL,
    token: env.LOCAL_AGENT_TOKEN,
    fetchImpl,
    logger
  });
}
