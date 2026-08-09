import assert from "node:assert/strict";
import Fastify from "fastify";
import test from "node:test";

import { createLocalAgentBearerGuard, registerLocalAgentExecutionRoutes } from "../src/server/routes/local-agent-execution.js";
import { createCloudRequestSecurity } from "../src/server/request-security.js";
import { identityApp } from "./helpers/identity-world.js";

const ORGANIZATION_ID = "org-agent-api";
const AGENT_ID = "agent-api-1";
const TOKEN = "agent-api-secret";

function routeService() {
  const calls = [];
  return {
    calls,
    async claimTask(input) { calls.push(["claim", input]); return { attempt: { id: "attempt-1", executor_agent_id: input.executorAgentId }, replayed: false }; },
    async startTask(input) { calls.push(["start", input]); return { attempt: { id: input.attemptId, status: "running" }, replayed: false }; },
    async heartbeatTask(input) { calls.push(["heartbeat", input]); return { attempt: { id: input.attemptId, progress_phase: input.progressPhase }, replayed: false }; },
    async downloadPackage(input) { calls.push(["package", input]); return { body: Buffer.from("fake-package"), contentType: "application/zip" }; },
    async heartbeatAgent(input) { calls.push(["agent-heartbeat", input]); return { status: "online", replayed: false }; },
    async createCandidateUploadAuthorization(input) { calls.push(["candidate-authorize", input]); return { candidate: { id: "candidate-1" }, replayed: false }; },
    async uploadCandidateObject(input) { calls.push(["candidate-upload", input]); return { status: "uploaded", replayed: false }; },
    async completeCandidateUpload(input) { calls.push(["candidate-complete", input]); return { candidate: { id: input.candidateId, status: "uploaded" }, replayed: false }; },
    async submitReport(input) {
      calls.push(["report", input]);
      const report = { id: input.reportId, outcome: input.outcome };
      if (input.outcome === "requires_action" && input.reasonCode === "AVATAR_MAPPING_REQUIRED") {
        report.requires_action_reason = "人物映射缺失，需要人工补充后再执行。";
      }
      if (input.outcome === "failed" && input.errorCode === "LOCAL_EXECUTION_FAILED") {
        report.failure_stage = "local_executor";
        report.retryability = "not_retryable";
      }
      return { report, attempt: { id: input.attemptId }, replayed: false };
    }
  };
}

async function configuredApp(t) {
  const app = Fastify({ logger: false });
  const service = routeService();
  const guard = createLocalAgentBearerGuard({ enabled: true, organizationId: ORGANIZATION_ID, agentId: AGENT_ID, token: TOKEN });
  app.setErrorHandler((error, _request, reply) => reply.code(["INVALID_IDEMPOTENCY_KEY", "LOCAL_AGENT_PROGRESS_INVALID"].includes(error.code) ? 400 : 500).send({ error: error.code || "INTERNAL_ERROR" }));
  await registerLocalAgentExecutionRoutes(app, { service, guard, maxCandidateBytes: 1024 });
  t.after(() => app.close());
  return { app, service };
}

function headers({ token = TOKEN, idempotency = "api-key", contentType = "application/json" } = {}) {
  return { authorization: `Bearer ${token}`, "idempotency-key": idempotency, "content-type": contentType };
}

test("feature-off local-agent endpoint is not registered and does not invoke member identity", async (t) => {
  const { app } = await identityApp(t);
  const response = await app.inject({ method: "POST", url: "/api/agent/v1/tasks/claim", headers: { host: "app.test", "content-type": "application/json" }, payload: {} });
  assert.equal(response.statusCode, 404);
});

test("local-agent bearer guard is independent, controlled, and never echoes the token", async (t) => {
  const { app, service } = await configuredApp(t);
  const missing = await app.inject({ method: "POST", url: "/api/agent/v1/tasks/claim", headers: { "content-type": "application/json", "idempotency-key": "missing" }, payload: {} });
  assert.equal(missing.statusCode, 401);
  assert.deepEqual(missing.json(), { error: "LOCAL_AGENT_UNAUTHORIZED" });
  assert.equal(missing.body.includes(TOKEN), false);

  const wrong = await app.inject({ method: "POST", url: "/api/agent/v1/tasks/claim", headers: headers({ token: "wrong" }), payload: {} });
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.body.includes(TOKEN), false);

  const claimed = await app.inject({ method: "POST", url: "/api/agent/v1/tasks/claim", headers: headers(), payload: {} });
  assert.equal(claimed.statusCode, 201);
  assert.deepEqual(service.calls[0][1], { organizationId: ORGANIZATION_ID, executorAgentId: AGENT_ID, idempotencyKey: "api-key" });
  assert.equal(claimed.body.includes(TOKEN), false);
});

test("local-agent mutations require Idempotency-Key and package download is a bearer-only binary route", async (t) => {
  const { app, service } = await configuredApp(t);
  const missingKey = await app.inject({ method: "POST", url: "/api/agent/v1/tasks/attempt-1/start", headers: headers({ idempotency: "" }), payload: {} });
  assert.equal(missingKey.statusCode, 400);
  assert.deepEqual(missingKey.json(), { error: "INVALID_IDEMPOTENCY_KEY" });

  const started = await app.inject({ method: "POST", url: "/api/agent/v1/tasks/attempt-1/start", headers: headers({ idempotency: "start-key" }), payload: {} });
  assert.equal(started.statusCode, 200);
  assert.equal(service.calls.at(-1)[1].organizationId, ORGANIZATION_ID);
  assert.equal(service.calls.at(-1)[1].executorAgentId, AGENT_ID);

  const invalidProgress = await app.inject({ method: "POST", url: "/api/agent/v1/tasks/attempt-1/heartbeat", headers: headers({ idempotency: "invalid-progress-key" }), payload: { progress_phase: "Bad-Phase" } });
  assert.equal(invalidProgress.statusCode, 400);
  assert.deepEqual(invalidProgress.json(), { error: "LOCAL_AGENT_PROGRESS_INVALID" });
  assert.equal(service.calls.some(([operation, input]) => operation === "heartbeat" && input.idempotencyKey === "invalid-progress-key"), false);

  const heartbeat = await app.inject({ method: "POST", url: "/api/agent/v1/tasks/attempt-1/heartbeat", headers: headers({ idempotency: "heartbeat-key" }), payload: { progress_phase: "running" } });
  assert.equal(heartbeat.statusCode, 200);
  assert.equal(service.calls.at(-1)[0], "heartbeat");

  const downloaded = await app.inject({ method: "GET", url: "/api/agent/v1/tasks/attempt-1/package", headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(downloaded.statusCode, 200);
  assert.equal(downloaded.headers["content-type"].startsWith("application/zip"), true);
  assert.equal(downloaded.body, "fake-package");
  assert.equal(downloaded.body.includes(TOKEN), false);
});

test("local-agent result routes require bearer identity and expose only controlled result seams", async (t) => {
  const { app, service } = await configuredApp(t);
  const common = headers({ idempotency: "result-key" });
  const online = await app.inject({ method: "POST", url: "/api/agent/v1/heartbeat", headers: common, payload: {} });
  assert.equal(online.statusCode, 200);
  assert.equal(service.calls.at(-1)[0], "agent-heartbeat");

  const authorization = await app.inject({ method: "POST", url: "/api/agent/v1/tasks/attempt-1/candidate-authorizations", headers: headers({ idempotency: "authorize-key" }),
    payload: { role: "primary_video", original_filename: "result.mp4", media_type: "video/mp4", size: 4, checksum: "a".repeat(64) } });
  assert.equal(authorization.statusCode, 201);
  assert.equal(service.calls.at(-1)[0], "candidate-authorize");

  const uploaded = await app.inject({ method: "PUT", url: "/api/agent/v1/candidate-uploads/candidate-1", headers: { ...common, "content-type": "video/mp4" }, payload: Buffer.from("fake") });
  assert.equal(uploaded.statusCode, 200);
  assert.equal(service.calls.at(-1)[0], "candidate-upload");

  const complete = await app.inject({ method: "POST", url: "/api/agent/v1/tasks/attempt-1/candidates/candidate-1/complete", headers: headers({ idempotency: "complete-key" }), payload: {} });
  assert.equal(complete.statusCode, 200);
  assert.equal(service.calls.at(-1)[0], "candidate-complete");

  const report = await app.inject({ method: "POST", url: "/api/agent/v1/tasks/attempt-1/reports", headers: headers({ idempotency: "report-key" }),
    payload: { report_id: "a0000000-0000-4000-8000-000000000009", outcome: "completed", primary_candidate_id: "candidate-1" } });
  assert.equal(report.statusCode, 201);
  assert.equal(service.calls.at(-1)[0], "report");
  assert.equal(report.body.includes(TOKEN), false);

  const controlled = await app.inject({ method: "POST", url: "/api/agent/v1/tasks/attempt-1/reports", headers: headers({ idempotency: "controlled-report-key" }),
    payload: { report_id: "a0000000-0000-4000-8000-000000000013", outcome: "requires_action",
      reason_code: "AVATAR_MAPPING_REQUIRED", message: "untrusted remote detail" } });
  assert.equal(controlled.statusCode, 201);
  assert.equal(controlled.json().report.requires_action_reason, "人物映射缺失，需要人工补充后再执行。");
  assert.equal(controlled.body.includes("untrusted remote detail"), false);
});

test("cloud request security permits only the exact Agent MP4 upload path", async (t) => {
  const app = Fastify({ logger: false });
  app.addContentTypeParser("video/mp4", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.addHook("onRequest", createCloudRequestSecurity({ trustedHosts: ["pilot.test"], trustedOrigins: ["https://pilot.test"] }).onRequest);
  app.put("/api/agent/v1/candidate-uploads/candidate-1", async (request) => ({ size: request.body.length }));
  app.put("/api/agent/v1/not-an-upload", async () => ({ ok: true }));
  t.after(() => app.close());

  const accepted = await app.inject({ method: "PUT", url: "/api/agent/v1/candidate-uploads/candidate-1", headers: {
    host: "pilot.test", "content-type": "video/mp4"
  }, payload: Buffer.from("fake") });
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(accepted.json(), { size: 4 });

  const rejectedType = await app.inject({ method: "PUT", url: "/api/agent/v1/candidate-uploads/candidate-1", headers: {
    host: "pilot.test", "content-type": "video/webm"
  }, payload: Buffer.from("fake") });
  assert.equal(rejectedType.statusCode, 415);

  const rejectedPath = await app.inject({ method: "PUT", url: "/api/agent/v1/not-an-upload", headers: {
    host: "pilot.test", "content-type": "video/mp4"
  }, payload: Buffer.from("fake") });
  assert.equal(rejectedPath.statusCode, 415);
});
