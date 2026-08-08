import { randomUUID } from "node:crypto";

export const PRODUCTION_ORDER_PURPOSES = [
  "first_production",
  "rework",
  "supplemental_version",
  "reproduction"
];

const clean = (value) => typeof value === "string" ? value.trim() : "";
const failure = (code, details = null) => Object.assign(new Error(code), { code, details });
const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]` :
  value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}` : JSON.stringify(value);

function validateActor(input) {
  if (!clean(input.organizationId) || !clean(input.actorMemberId)) {
    throw failure("PRODUCTION_ORDER_CONTEXT_REQUIRED");
  }
  if (!["member", "admin"].includes(input.actorRole)) throw failure("PRODUCTION_ORDER_FORBIDDEN");
}

function validateContext(input) {
  validateActor(input);
  if (!clean(input.productId)) throw failure("PRODUCTION_ORDER_CONTEXT_REQUIRED");
}

function validateKey(value) {
  if (!clean(value) || value.length > 128) throw failure("INVALID_IDEMPOTENCY_KEY");
}

function validatePurpose(value) {
  if (!PRODUCTION_ORDER_PURPOSES.includes(value)) throw failure("PRODUCTION_ORDER_PURPOSE_INVALID");
}

function publicEnvironment(online) {
  return { online: Boolean(online), status: online ? "online" : "offline", blocks_manual_creation: false };
}

function snapshotForOrder(resolved) {
  const plan = structuredClone(resolved.plan);
  const planReview = structuredClone(resolved.plan_review);
  const preflightResult = structuredClone(resolved.preflight_result);
  const upstream = structuredClone(plan.upstream_snapshot || {});
  return {
    video_plan_version: plan,
    plan_review: planReview,
    preflight_result: preflightResult,
    upstream_snapshot: upstream,
    approved_copy_snapshot: { copy_version_id: upstream.copy_version_id, product_revision_id: upstream.product_revision_id },
    avatar_selection_snapshot: { avatar_selection_id: upstream.avatar_selection_id, avatar_asset_version_id: upstream.avatar_asset_version_id },
    capability_config_snapshot: structuredClone(plan.capability_config_snapshot),
    output_instructions: plan.output_instructions
  };
}

function gateFromResolved(resolved, input) {
  if (!resolved) return { can_create: false, reasons: ["approved_plan_missing"] };
  if (resolved.plan?.organization_id !== input.organizationId || resolved.plan?.product_id !== input.productId) {
    throw failure("PRODUCTION_ORDER_PLAN_NOT_FOUND");
  }
  if (input.videoPlanVersionId && resolved.plan.id !== input.videoPlanVersionId) {
    throw failure("PRODUCTION_ORDER_PLAN_NOT_FOUND");
  }
  if (resolved.gate?.can_create === false || resolved.current_valid === false) {
    return { can_create: false, reasons: [...new Set(resolved.gate_reasons || resolved.gate?.reasons || ["approved_plan_missing"])] };
  }
  const reasons = [];
  if (resolved.plan.status !== "frozen") reasons.push("plan_not_frozen");
  if (resolved.plan_review?.status !== "approved") reasons.push("plan_review_not_approved");
  if (!["passed", "warning"].includes(resolved.preflight_result?.status)) reasons.push("preflight_not_reviewable");
  if (resolved.preflight_result?.invalidated_at) reasons.push("preflight_invalidated");
  if (resolved.current_valid !== true) reasons.push("approved_plan_missing");
  return { can_create: reasons.length === 0, reasons };
}

export function createProductionOrderService({ repository, planPort, inputSnapshotPort, agentReadinessPort = { async isOnline() { return false; } }, now = Date.now } = {}) {
  if (!repository?.getReceipt || !repository?.createOrder || !repository?.listOrders || !repository?.getOrder) {
    throw new TypeError("production order repository is required");
  }
  if (!planPort?.resolveCurrentApprovedPlan) throw new TypeError("current approved plan port is required");
  if (!inputSnapshotPort?.freezeForOrder) throw new TypeError("production order input snapshot port is required");
  const timestamp = () => new Date(now()).toISOString();
  const receiptKey = (input) => `${input.organizationId}:${input.actorMemberId}:production-order:create:${input.idempotencyKey}`;

  async function environment(input) {
    let online = false;
    try { online = await agentReadinessPort.isOnline(input) === true; } catch { online = false; }
    return publicEnvironment(online);
  }

  async function resolveGate(input) {
    const resolved = await planPort.resolveCurrentApprovedPlan({
      organizationId: input.organizationId,
      actorMemberId: input.actorMemberId,
      actorRole: input.actorRole,
      productId: input.productId,
      videoPlanVersionId: input.videoPlanVersionId || null
    });
    return { resolved, gate: gateFromResolved(resolved, input) };
  }

  async function createProductionOrder(input) {
    validateContext(input);
    validatePurpose(input.executionPurpose);
    validateKey(input.idempotencyKey);
    const fingerprint = stableJson({ product_id: input.productId, video_plan_version_id: input.videoPlanVersionId || null,
      execution_purpose: input.executionPurpose });
    const key = receiptKey(input);
    const prior = await repository.getReceipt(key, fingerprint);
    if (prior) {
      const existing = await repository.getOrder(input.organizationId, prior.order_id);
      if (!existing) throw failure("PRODUCTION_ORDER_NOT_FOUND");
      return { order: existing, replayed: true, execution_environment: await environment(input) };
    }

    const { resolved, gate } = await resolveGate(input);
    if (!resolved || !gate.can_create) throw failure("PRODUCTION_ORDER_PLAN_GATE_BLOCKED", gate.reasons);
    const at = timestamp();
    const order = {
      id: randomUUID(),
      organization_id: input.organizationId,
      product_id: input.productId,
      video_plan_version_id: resolved.plan.id,
      execution_purpose: input.executionPurpose,
      status: "waiting_for_executor",
      row_version: 1,
      input_snapshot: { ...snapshotForOrder(resolved), ...await inputSnapshotPort.freezeForOrder({ ...input, resolved }) },
      created_by_member_id: input.actorMemberId,
      created_at: at,
      updated_at: at,
      status_history: [
        { status: "draft", at },
        { status: "ready", at },
        { status: "waiting_for_executor", at }
      ]
    };
    const auditEvents = ["created", "ready", "waiting_for_executor"].map((transition) => ({
      id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId,
      event_type: `production_order.${transition}`, production_order_id: order.id,
      metadata: { execution_purpose: order.execution_purpose, status: transition === "created" ? "draft" : transition === "ready" ? "ready" : "waiting_for_executor" },
      created_at: at
    }));
    const outboxEvent = {
      id: randomUUID(), organization_id: input.organizationId, event_type: "production_order.created",
      aggregate_id: order.id, payload: { order_id: order.id, product_id: order.product_id,
        video_plan_version_id: order.video_plan_version_id, execution_purpose: order.execution_purpose,
        status: order.status, status_chain: order.status_history.map((item) => item.status), input_snapshot: order.input_snapshot },
      created_at: at, published_at: null
    };
    const saved = await repository.createOrder({ receiptKey: key, fingerprint, order, auditEvents, outboxEvent });
    return { order: saved.order, replayed: saved.replayed, execution_environment: await environment(input) };
  }

  async function listOrders(input) {
    validateContext(input);
    return repository.listOrders(input.organizationId, input.productId);
  }

  async function getOrder(input) {
    validateActor(input);
    if (!clean(input.orderId)) throw failure("PRODUCTION_ORDER_NOT_FOUND");
    const order = await repository.getOrder(input.organizationId, input.orderId);
    if (!order) throw failure("PRODUCTION_ORDER_NOT_FOUND");
    return order;
  }

  async function getWorkspace(input) {
    validateContext(input);
    const [{ resolved, gate }, orders, executionEnvironment] = await Promise.all([
      resolveGate(input),
      repository.listOrders(input.organizationId, input.productId),
      environment(input)
    ]);
    const selected = input.orderId ? orders.find((order) => order.id === input.orderId) || null : orders.at(-1) || null;
    return {
      current_plan: resolved?.plan || null,
      current_plan_review: resolved?.plan_review || null,
      current_preflight_result: resolved?.preflight_result || null,
      gate,
      execution_environment: executionEnvironment,
      orders,
      selected_order: selected
    };
  }

  return { createProductionOrder, listOrders, getOrder, getWorkspace, resolveCurrentApprovedPlan: resolveGate };
}
