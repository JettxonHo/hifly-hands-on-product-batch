import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryManualExecutionRepository } from "../src/manual-execution/memory-manual-execution-repository.js";
import { createLocalAgentExecutionService } from "../src/local-agent-execution/local-agent-execution-service.js";

const ORGANIZATION_ID = "org-agent-test";
const AGENT_ID = "agent-test-1";
const PACKAGE_ID = "package-agent-1";
const ORDER_ID = "order-agent-1";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function createWorld() {
  let clock = Date.parse("2026-08-10T00:00:00.000Z");
  const repository = createMemoryManualExecutionRepository();
  const order = {
    id: ORDER_ID,
    organization_id: ORGANIZATION_ID,
    status: "waiting_for_executor",
    row_version: 1,
    product_id: "product-agent-1",
    video_plan_version_id: "plan-agent-1",
    input_snapshot: {
      video_plan_version: { id: "plan-agent-1" },
      approved_copy_snapshot: { copy_version_id: "copy-agent-1" },
      avatar_selection_snapshot: { avatar_asset_version_id: "avatar-agent-1" },
      production_config_snapshot: { mode: "fake" }
    }
  };
  const packageRecord = {
    id: PACKAGE_ID,
    organization_id: ORGANIZATION_ID,
    production_order_id: ORDER_ID,
    package_version: 1,
    manifest_hash: "manifest-agent-1",
    package_hash: "package-agent-1",
    status: "ready",
    storage_key: "manual-handoff/package-agent-1.zip",
    manifest: { accepted_media_types: ["video/mp4"] }
  };
  const orderPort = {
    async getOrderForAgent(input) {
      const { organizationId, orderId } = input;
      assert.equal(input.actorAgentId, AGENT_ID);
      return organizationId === ORGANIZATION_ID && orderId === ORDER_ID ? clone(order) : null;
    },
    async listOrdersForAgent(input) {
      assert.equal(input.actorAgentId, AGENT_ID);
      return input.organizationId === ORGANIZATION_ID ? [clone(order)] : [];
    },
    async transitionOrderForAgent({ organizationId, orderId, expectedRevision, fromStatuses, toStatus, at, actorMemberId, actorAgentId }) {
      assert.equal(actorMemberId, null);
      assert.equal(actorAgentId, AGENT_ID);
      if (organizationId !== ORGANIZATION_ID || orderId !== ORDER_ID || order.row_version !== expectedRevision || !fromStatuses.includes(order.status)) return null;
      order.status = toStatus;
      order.row_version += 1;
      order.updated_at = at;
      return clone(order);
    }
  };
  const packagePort = {
    async getPackageForAgent({ organizationId, packageId, agentId }) {
      assert.equal(agentId, AGENT_ID);
      return organizationId === ORGANIZATION_ID && packageId === PACKAGE_ID ? clone(packageRecord) : null;
    },
    async listPackagesForAgent({ organizationId, productionOrderId, agentId }) {
      assert.equal(agentId, AGENT_ID);
      return organizationId === ORGANIZATION_ID && productionOrderId === ORDER_ID ? [clone(packageRecord)] : [];
    },
    async downloadPackageForAgent({ organizationId, packageId, agentId }) {
      assert.equal(agentId, AGENT_ID);
      return organizationId === ORGANIZATION_ID && packageId === PACKAGE_ID ? { body: Buffer.from("package"), contentType: "application/zip", package: clone(packageRecord) } : null;
    }
  };
  const createService = () => createLocalAgentExecutionService({
    repository,
    orderPort,
    packagePort,
    organizationId: ORGANIZATION_ID,
    agentId: AGENT_ID,
    leaseMs: 10_000,
    now: () => clock
  });
  return {
    service: createService(),
    restart: createService,
    repository,
    order,
    packageRecord,
    advance(ms) { clock += ms; }
  };
}

test("local agent claims, starts, and heartbeats one leased task with an explicit agent identity", async () => {
  const world = createWorld();

  const claimed = await world.service.claimTask({ idempotencyKey: "agent-claim-1" });
  assert.equal(claimed.replayed, false);
  assert.equal(claimed.attempt.executor_type, "local_agent");
  assert.equal(claimed.attempt.executor_agent_id, AGENT_ID);
  assert.equal(claimed.attempt.operator_id, null);
  assert.equal(claimed.attempt.status, "claimed");
  assert.equal(world.order.status, "claimed");

  const started = await world.service.startTask({ attemptId: claimed.attempt.id, idempotencyKey: "agent-start-1" });
  assert.equal(started.attempt.status, "running");
  assert.equal(started.attempt.operator_id, null);
  assert.equal(started.attempt.executor_agent_id, AGENT_ID);
  assert.equal(started.attempt.progress_phase, "started");

  world.advance(2_000);
  const heartbeated = await world.service.heartbeatTask({ attemptId: claimed.attempt.id, idempotencyKey: "agent-heartbeat-1", progressPhase: "uploading" });
  assert.equal(heartbeated.attempt.status, "running");
  assert.equal(heartbeated.attempt.progress_phase, "uploading");
  assert.equal(heartbeated.attempt.heartbeat_at, "2026-08-10T00:00:02.000Z");
  assert.equal(heartbeated.attempt.lease_expires_at, "2026-08-10T00:00:12.000Z");
});

test("local agent package download uses the internal package port and no member identity", async () => {
  const world = createWorld();
  const claimed = await world.service.claimTask({ idempotencyKey: "agent-claim-package" });
  const downloaded = await world.service.downloadPackage({ attemptId: claimed.attempt.id });
  assert.deepEqual(downloaded.body, Buffer.from("package"));
  assert.equal(downloaded.contentType, "application/zip");
  assert.equal(Object.hasOwn(downloaded, "upload_token"), false);
});

test("expired local agent attempts record their actual previous status and agent actor", async () => {
  const world = createWorld();
  const claimed = await world.service.claimTask({ idempotencyKey: "agent-claim-expiry" });
  world.advance(11_000);
  await assert.rejects(() => world.service.startTask({ attemptId: claimed.attempt.id, idempotencyKey: "agent-start-expiry" }), { code: "LOCAL_AGENT_LEASE_EXPIRED" });
  const transitions = await world.repository.listStatusTransitions(ORGANIZATION_ID);
  const expiry = transitions.at(-1);
  assert.equal(expiry.from_status, "claimed");
  assert.equal(expiry.to_status, "requires_action");
  assert.equal(expiry.actor_member_id, null);
  assert.equal(expiry.actor_agent_id, AGENT_ID);
});

test("agent restart poll expires its own stale lease without auto-claiming", async () => {
  const world = createWorld();
  const claimed = await world.service.claimTask({ idempotencyKey: "agent-claim-restart" });
  await world.service.startTask({ attemptId: claimed.attempt.id, idempotencyKey: "agent-start-restart" });

  world.advance(11_000);
  const restartedService = world.restart();
  const polled = await restartedService.claimTask({ idempotencyKey: "agent-poll-restart" });

  assert.deepEqual(polled, { attempt: null, replayed: false });
  assert.equal(world.order.status, "requires_action");
  const attempts = await world.repository.listAttempts(ORGANIZATION_ID, ORDER_ID);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].id, claimed.attempt.id);
  assert.equal(attempts[0].status, "requires_action");
  const transitions = await world.repository.listStatusTransitions(ORGANIZATION_ID);
  const expiry = transitions.at(-1);
  assert.equal(expiry.from_status, "running");
  assert.equal(expiry.to_status, "requires_action");
  assert.equal(expiry.actor_agent_id, AGENT_ID);
});

test("agent heartbeat rejects uncontrolled progress phases", async () => {
  const world = createWorld();
  const claimed = await world.service.claimTask({ idempotencyKey: "agent-claim-progress" });

  await assert.rejects(
    () => world.service.heartbeatTask({ attemptId: claimed.attempt.id, idempotencyKey: "agent-heartbeat-invalid", progressPhase: "Bad-Phase" }),
    { code: "LOCAL_AGENT_PROGRESS_INVALID" }
  );
});

test("agent online heartbeat drives bounded readiness without an attempt", async () => {
  const world = createWorld();

  assert.equal(await world.service.isOnline({ organizationId: ORGANIZATION_ID }), false);
  const first = await world.service.heartbeatAgent({ idempotencyKey: "agent-online-1" });
  assert.equal(first.replayed, false);
  assert.equal(first.status, "online");
  assert.equal(await world.service.isOnline({ organizationId: ORGANIZATION_ID }), true);

  const replay = await world.service.heartbeatAgent({ idempotencyKey: "agent-online-1" });
  assert.equal(replay.replayed, true);
  world.advance(10_001);
  assert.equal(await world.service.isOnline({ organizationId: ORGANIZATION_ID }), false);
});
