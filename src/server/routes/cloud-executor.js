import { timingSafeEqual } from "node:crypto";

import { READINESS_STATUSES } from "../../cloud-executor/control-plane.js";

const clean = (value) => typeof value === "string" ? value.trim() : "";
const readinessSet = new Set(READINESS_STATUSES);

function sameSecret(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function actor(request) {
  const identity = request.identity;
  return identity ? { organizationId: identity.organization.id, actorMemberId: identity.member.id, actorRole: identity.membership.role } : {};
}

export function createCloudExecutorBearerGuard({ enabled = false, organizationId, executorCloudId, token } = {}) {
  if (enabled !== true || !clean(organizationId) || !clean(executorCloudId) || !clean(token)) {
    throw new TypeError("complete cloud executor bearer configuration is required");
  }
  const configured = { organizationId: organizationId.trim(), executorCloudId: executorCloudId.trim(), token: token.trim() };
  return async function cloudExecutorBearerGuard(request, reply) {
    const header = request.headers.authorization;
    const value = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!value || !sameSecret(value, configured.token)) {
      reply.code(401).send({ error: "CLOUD_EXECUTOR_UNAUTHORIZED" });
      return;
    }
    request.cloudExecutor = { organizationId: configured.organizationId, executorCloudId: configured.executorCloudId };
  };
}

function heartbeatInput(request) {
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body : {};
  return {
    readinessStatus: Object.hasOwn(body, "readiness_status") ? body.readiness_status : body.readinessStatus,
    progressPhase: Object.hasOwn(body, "progress_phase") ? body.progress_phase : body.progressPhase
  };
}

export async function registerCloudExecutorRoutes(app, { controlPlane, internalGuard = null } = {}) {
  if (!controlPlane || typeof controlPlane.getStatus !== "function") throw new TypeError("cloud executor control plane is required");

  app.get("/api/cloud-executor/status", async (request) => controlPlane.getStatus(actor(request)));

  if (typeof internalGuard !== "function") return;
  app.post("/internal/cloud-executor/v1/heartbeat", { preHandler: internalGuard }, async (request, reply) => {
    const input = heartbeatInput(request);
    if (!readinessSet.has(input.readinessStatus) || (input.progressPhase !== undefined && input.progressPhase !== null && typeof input.progressPhase !== "string")) {
      reply.code(400).send({ error: "CLOUD_EXECUTOR_HEARTBEAT_INVALID" });
      return;
    }
    try {
      const result = await controlPlane.reportHeartbeat({ ...request.cloudExecutor, ...input });
      reply.code(200).send({ status: result.status, reported_at: result.reported_at });
    } catch (error) {
      const code = ["CLOUD_EXECUTOR_CONTEXT_REQUIRED", "CLOUD_EXECUTOR_READINESS_INVALID", "CLOUD_EXECUTOR_PROGRESS_INVALID"].includes(error?.code)
        ? error.code : "CLOUD_EXECUTOR_HEARTBEAT_INVALID";
      reply.code(400).send({ error: code });
    }
  });
}
