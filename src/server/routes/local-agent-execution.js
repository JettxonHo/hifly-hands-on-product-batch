import { timingSafeEqual } from "node:crypto";

import { DEFAULT_MAX_CANDIDATE_BYTES, validateLocalAgentProgressPhase } from "../../local-agent-execution/local-agent-execution-service.js";

const PREFIX = "/api/agent/v1/";

const clean = (value) => typeof value === "string" ? value.trim() : "";

function sameSecret(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function idempotencyKey(request) {
  const value = clean(request.headers["idempotency-key"]);
  if (!value || value.length > 128) {
    throw Object.assign(new Error("INVALID_IDEMPOTENCY_KEY"), { code: "INVALID_IDEMPOTENCY_KEY" });
  }
  return value;
}

function agentInput(request) {
  const identity = request.localAgent;
  return { organizationId: identity.organizationId, executorAgentId: identity.agentId };
}

function contentType(request) {
  return String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
}

export function createLocalAgentBearerGuard({ enabled = false, organizationId, agentId, token } = {}) {
  if (enabled !== true || !clean(organizationId) || !clean(agentId) || !clean(token)) {
    throw new TypeError("complete local agent bearer configuration is required");
  }
  const configured = { organizationId: organizationId.trim(), agentId: agentId.trim(), token: token.trim() };
  return async function localAgentBearerGuard(request, reply) {
    const header = request.headers.authorization;
    const value = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!value || !sameSecret(value, configured.token)) {
      reply.code(401).send({ error: "LOCAL_AGENT_UNAUTHORIZED" });
      return;
    }
    request.localAgent = { organizationId: configured.organizationId, agentId: configured.agentId };
  };
}

export async function registerLocalAgentExecutionRoutes(app, { service, guard, maxCandidateBytes = DEFAULT_MAX_CANDIDATE_BYTES }) {
  if (!service || typeof guard !== "function") throw new TypeError("local agent routes require service and guard");
  if (!app.hasContentTypeParser?.("video/mp4")) {
    app.addContentTypeParser("video/mp4", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  }
  const route = (options) => ({ ...options, preHandler: guard });

  app.post(`${PREFIX}heartbeat`, route({ handler: async (request, reply) => {
    const result = await service.heartbeatAgent({ ...agentInput(request), idempotencyKey: idempotencyKey(request) });
    reply.code(200).send(result);
  }}));

  app.post(`${PREFIX}tasks/claim`, route({ handler: async (request, reply) => {
    const result = await service.claimTask({ ...agentInput(request), idempotencyKey: idempotencyKey(request) });
    reply.code(result.replayed ? 200 : 201).send(result);
  }}));

  app.post(`${PREFIX}tasks/:attemptId/start`, route({ handler: async (request, reply) => {
    const result = await service.startTask({ ...agentInput(request), attemptId: request.params.attemptId, idempotencyKey: idempotencyKey(request) });
    reply.code(result.replayed ? 200 : 200).send(result);
  }}));

  app.post(`${PREFIX}tasks/:attemptId/heartbeat`, route({ handler: async (request, reply) => {
    const body = request.body || {};
    const progressPhase = Object.hasOwn(body, "progress_phase") ? body.progress_phase : body.progressPhase;
    if (progressPhase !== undefined) validateLocalAgentProgressPhase(progressPhase);
    const result = await service.heartbeatTask({ ...agentInput(request), attemptId: request.params.attemptId,
      progressPhase, idempotencyKey: idempotencyKey(request) });
    reply.code(200).send(result);
  }}));

  app.get(`${PREFIX}tasks/:attemptId/package`, route({ handler: async (request, reply) => {
    const result = await service.downloadPackage({ ...agentInput(request), attemptId: request.params.attemptId });
    reply.type(result.contentType).header("Cache-Control", "no-store")
      .header("Content-Disposition", `attachment; filename="local-agent-${request.params.attemptId}.zip"`)
      .send(result.body);
  }}));

  app.post(`${PREFIX}tasks/:attemptId/candidate-authorizations`, route({ handler: async (request, reply) => {
    const body = request.body || {};
    const result = await service.createCandidateUploadAuthorization({ ...agentInput(request), attemptId: request.params.attemptId,
      role: body.role, originalFilename: body.original_filename || body.originalFilename,
      mediaType: body.media_type || body.mediaType, size: body.size, checksum: body.checksum,
      idempotencyKey: idempotencyKey(request) });
    reply.code(result.replayed ? 200 : 201).send(result);
  }}));

  app.put(`${PREFIX}candidate-uploads/:candidateId`, route({ bodyLimit: maxCandidateBytes, handler: async (request, reply) => {
    const result = await service.uploadCandidateObject({ ...agentInput(request), candidateId: request.params.candidateId,
      body: request.body, contentType: contentType(request), idempotencyKey: idempotencyKey(request) });
    reply.code(200).send(result);
  }}));

  app.post(`${PREFIX}tasks/:attemptId/candidates/:candidateId/complete`, route({ handler: async (request, reply) => {
    const result = await service.completeCandidateUpload({ ...agentInput(request), attemptId: request.params.attemptId,
      candidateId: request.params.candidateId, idempotencyKey: idempotencyKey(request) });
    reply.code(200).send(result);
  }}));

  app.post(`${PREFIX}tasks/:attemptId/reports`, route({ handler: async (request, reply) => {
    const body = request.body || {};
    const result = await service.submitReport({ ...agentInput(request), attemptId: request.params.attemptId,
      reportId: body.report_id || body.reportId, outcome: body.outcome,
      primaryCandidateId: body.primary_candidate_id || body.primaryCandidateId,
      reasonCode: body.reason_code || body.reasonCode, errorCode: body.error_code || body.errorCode,
      idempotencyKey: idempotencyKey(request) });
    reply.code(result.replayed ? 200 : 201).send(result);
  }}));
}

export { PREFIX };
