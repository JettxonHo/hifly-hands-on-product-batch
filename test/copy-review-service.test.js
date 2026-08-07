import assert from "node:assert/strict";
import test from "node:test";

import { createCopyReviewService } from "../src/copy-review/copy-review-service.js";
import { createMemoryCopyReviewRepository } from "../src/copy-review/memory-copy-review-repository.js";

const org = "org-a";
const member = { organizationId: org, actorMemberId: "member-a", actorRole: "member" };
const admin = { organizationId: org, actorMemberId: "admin-a", actorRole: "admin" };

function world({ conclusion = "passed", effectiveConclusion = conclusion, approvalBarrier,
  approvalReturnBarrier } = {}) {
  let gateUnavailable = false;
  let copy = { id: "copy-a", organization_id: org, product_revision_id: "revision-a", author_member_id: "member-a",
    status: "frozen", row_version: 2 };
  let quality = { id: "quality-a", copy_version_id: copy.id, product_revision_id: "revision-a",
    profile_version: "profile-v1", rule_version: "rules-v1", conclusion, effective_conclusion: effectiveConclusion,
    current_valid: true, invalidation_reason: null };
  const copyService = { async getCopyVersion(input) {
    if (gateUnavailable) throw Object.assign(new Error("UPSTREAM_UNAVAILABLE"), { code: "UPSTREAM_UNAVAILABLE" });
    if (input.organizationId !== org || input.copyVersionId !== copy.id) throw Object.assign(new Error("COPY_VERSION_NOT_FOUND"), { code: "COPY_VERSION_NOT_FOUND" });
    return structuredClone(copy);
  } };
  const qualityService = { async getApprovalCandidate(input) {
    await copyService.getCopyVersion(input);
    return quality ? structuredClone(quality) : null;
  } };
  const repository = createMemoryCopyReviewRepository();
  const service = createCopyReviewService({ repository, copyService, qualityService, approvalBarrier,
    approvalReturnBarrier,
    now: (() => { let value = Date.parse("2026-08-07T08:00:00.000Z"); return () => value++; })() });
  return { repository, service,
    setCopy(next) { copy = { ...copy, ...next }; },
    setQuality(next) { quality = next === null ? null : { ...quality, ...next }; },
    setGateUnavailable(next = true) { gateUnavailable = next; } };
}

async function submit(ctx, idempotencyKey = "submit-1") {
  return ctx.service.submitReview({ ...member, copyVersionId: "copy-a", idempotencyKey });
}

test("passed QC remains separate from approval and submit creates a pending review", async () => {
  const ctx = world();
  const before = await ctx.service.getReviewState({ ...member, copyVersionId: "copy-a" });
  assert.equal(before.current_review, null);
  assert.equal(before.gate.can_submit, true);

  const result = await submit(ctx);
  assert.equal(result.current_review.status, "pending");
  assert.equal(result.current_review.author_member_id, "member-a");
  assert.equal(result.current_review.row_version, 1);
  assert.deepEqual(result.history.map((event) => event.to_status), ["pending"]);
});

test("submit and approve revalidate blocked, invalid, unresolved, and stale gates", async (t) => {
  for (const state of ["blocked", "invalid", "needs_review"]) await t.test(`cannot submit ${state}`, async () => {
    const ctx = world({ conclusion: state, effectiveConclusion: state });
    await assert.rejects(submit(ctx), { code: "COPY_REVIEW_GATE_BLOCKED" });
  });

  const ctx = world();
  const pending = await submit(ctx);
  ctx.setQuality({ current_valid: false, invalidation_reason: "quality_policy_changed" });
  await assert.rejects(ctx.service.approveReview({ ...admin, reviewId: pending.current_review.id,
    expectedRevision: 1, idempotencyKey: "approve-stale" }), { code: "COPY_REVIEW_GATE_BLOCKED" });

  for (const state of ["blocked", "invalid"]) await t.test(`cannot approve ${state}`, async () => {
    const decision = world();
    const submitted = await submit(decision);
    decision.setQuality({ conclusion: state, effective_conclusion: state });
    await assert.rejects(decision.service.approveReview({ ...admin, reviewId: submitted.current_review.id,
      expectedRevision: 1, idempotencyKey: `approve-${state}` }), { code: "COPY_REVIEW_GATE_BLOCKED" });
  });
});

test("admin decides, member is forbidden, and self review is recorded", async () => {
  const ctx = world();
  const pending = await submit(ctx);
  await assert.rejects(ctx.service.approveReview({ ...member, reviewId: pending.current_review.id,
    expectedRevision: 1, idempotencyKey: "member-approve" }), { code: "COPY_REVIEW_FORBIDDEN" });

  const approved = await ctx.service.approveReview({ ...admin, actorMemberId: "member-a",
    reviewId: pending.current_review.id, expectedRevision: 1, idempotencyKey: "self-approve" });
  assert.equal(approved.current_review.status, "approved");
  assert.equal(approved.current_review.reviewer_member_id, "member-a");
  assert.equal(approved.current_review.review_mode, "self_review");
});

test("request changes and manual revoke require a reason", async () => {
  const ctx = world();
  const pending = await submit(ctx);
  await assert.rejects(ctx.service.requestChanges({ ...admin, reviewId: pending.current_review.id,
    expectedRevision: 1, reason: " ", idempotencyKey: "changes-empty" }), { code: "COPY_REVIEW_REASON_REQUIRED" });
  const changed = await ctx.service.requestChanges({ ...admin, reviewId: pending.current_review.id,
    expectedRevision: 1, reason: "补充适用人群说明", idempotencyKey: "changes-ok" });
  assert.equal(changed.current_review.status, "changes_requested");
  assert.equal(changed.history.at(-1).reason, "补充适用人群说明");

  const next = await submit(ctx, "submit-2");
  const approved = await ctx.service.approveReview({ ...admin, reviewId: next.current_review.id,
    expectedRevision: 1, idempotencyKey: "approve-2" });
  await assert.rejects(ctx.service.revokeReview({ ...admin, reviewId: approved.current_review.id,
    expectedRevision: 2, reason: "", idempotencyKey: "revoke-empty" }), { code: "COPY_REVIEW_REASON_REQUIRED" });
});

test("same idempotency payload replays, conflicting payload and concurrent revision conflict", async () => {
  const ctx = world();
  const pending = await submit(ctx);
  const input = { ...admin, reviewId: pending.current_review.id, expectedRevision: 1,
    reason: "需要更准确", idempotencyKey: "decision-key" };
  const first = await ctx.service.requestChanges(input);
  const replay = await ctx.service.requestChanges(input);
  assert.equal(replay.current_review.row_version, first.current_review.row_version);
  await assert.rejects(ctx.service.requestChanges({ ...input, reason: "另一个理由" }), { code: "IDEMPOTENCY_CONFLICT" });

  const next = await submit(ctx, "submit-next");
  const results = await Promise.allSettled([
    ctx.service.approveReview({ ...admin, reviewId: next.current_review.id, expectedRevision: 1, idempotencyKey: "race-a" }),
    ctx.service.requestChanges({ ...admin, reviewId: next.current_review.id, expectedRevision: 1,
      reason: "并发修改", idempotencyKey: "race-b" })
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected")[0].reason.code, "COPY_REVIEW_CONFLICT");
});

test("idempotent command receipts replay before dynamic gates", async () => {
  const submittedWorld = world();
  const submitted = await submit(submittedWorld, "submit-replay");
  submittedWorld.setGateUnavailable();
  const submitReplay = await submit(submittedWorld, "submit-replay");
  assert.equal(submitReplay.current_review.status, "pending");

  const approvedWorld = world();
  const pendingApproval = await submit(approvedWorld, "submit-for-approval");
  const approvalInput = { ...admin, reviewId: pendingApproval.current_review.id,
    expectedRevision: 1, idempotencyKey: "approve-replay" };
  const approved = await approvedWorld.service.approveReview(approvalInput);
  approvedWorld.setQuality({ current_valid: false, invalidation_reason: "quality_policy_changed" });
  const approvalReplay = await approvedWorld.service.approveReview(approvalInput);
  assert.equal(approvalReplay.current_review.status, approved.current_review.status);
  await assert.rejects(approvedWorld.service.approveReview({ ...approvalInput, expectedRevision: 2 }),
    { code: "IDEMPOTENCY_CONFLICT" });

  const changesWorld = world();
  const pendingChanges = await submit(changesWorld, "submit-for-changes");
  const changesInput = { ...admin, reviewId: pendingChanges.current_review.id, expectedRevision: 1,
    reason: "补充证据", idempotencyKey: "changes-replay" };
  await changesWorld.service.requestChanges(changesInput);
  changesWorld.setGateUnavailable();
  const changesReplay = await changesWorld.service.requestChanges(changesInput);
  assert.equal(changesReplay.current_review.status, "changes_requested");

  const revokedWorld = world();
  const pendingRevoke = await submit(revokedWorld, "submit-for-revoke");
  const approvedRevoke = await revokedWorld.service.approveReview({ ...admin, reviewId: pendingRevoke.current_review.id,
    expectedRevision: 1, idempotencyKey: "approve-for-revoke" });
  const revokeInput = { ...admin, reviewId: approvedRevoke.current_review.id, expectedRevision: 2,
    reason: "人工撤销", idempotencyKey: "revoke-replay" };
  await revokedWorld.service.revokeReview(revokeInput);
  revokedWorld.setGateUnavailable();
  const revokeReplay = await revokedWorld.service.revokeReview(revokeInput);
  assert.equal(revokeReplay.current_review.status, "revoked");
});

test("approval performs a final authoritative recheck before returning", async () => {
  let releaseApproval;
  let barrierEntered;
  const entered = new Promise((resolve) => { barrierEntered = resolve; });
  const release = new Promise((resolve) => { releaseApproval = resolve; });
  const ctx = world({ approvalBarrier: async () => { barrierEntered(); await release; } });
  const pending = await submit(ctx, "submit-race");
  const input = { ...admin, reviewId: pending.current_review.id, expectedRevision: 1,
    idempotencyKey: "approve-race" };
  const approving = ctx.service.approveReview(input);
  await entered;
  ctx.setQuality({ current_valid: false, invalidation_reason: "quality_policy_changed" });
  releaseApproval();
  const result = await approving;
  assert.equal(result.current_review.status, "revoked");
  assert.deepEqual(result.history.map((item) => item.to_status), ["pending", "approved", "revoked"]);
  const replay = await ctx.service.approveReview(input);
  assert.equal(replay.current_review.status, "revoked");
});

test("approval projection revocation also updates the approval receipt", async () => {
  let invalidateAfterFinalGate;
  const ctx = world({ approvalReturnBarrier: async () => invalidateAfterFinalGate() });
  invalidateAfterFinalGate = () => ctx.setQuality({ current_valid: false,
    invalidation_reason: "quality_policy_changed" });
  const pending = await submit(ctx, "submit-projection-race");
  const input = { ...admin, reviewId: pending.current_review.id, expectedRevision: 1,
    idempotencyKey: "approve-projection-race" };

  const first = await ctx.service.approveReview(input);
  assert.equal(first.current_review.status, "revoked");
  assert.equal(first.history.filter((item) => item.to_status === "revoked").length, 1);

  const replay = await ctx.service.approveReview(input);
  assert.equal(replay.current_review.status, "revoked");
  assert.equal(replay.history.filter((item) => item.to_status === "revoked").length, 1);
});

test("related upstream drift appends revoke once; unrelated metadata does not", async () => {
  const ctx = world();
  const pending = await submit(ctx);
  await ctx.service.approveReview({ ...admin, reviewId: pending.current_review.id,
    expectedRevision: 1, idempotencyKey: "approve" });

  ctx.setCopy({ display_name: "仅展示名变化" });
  let state = await ctx.service.getReviewState({ ...member, copyVersionId: "copy-a" });
  assert.equal(state.current_review.status, "approved");

  ctx.setCopy({ status: "superseded" });
  state = await ctx.service.getReviewState({ ...member, copyVersionId: "copy-a" });
  assert.equal(state.current_review.status, "revoked");
  assert.equal(state.history.at(-1).reason_code, "copy_version_superseded");
  const again = await ctx.service.getReviewState({ ...member, copyVersionId: "copy-a" });
  assert.equal(again.history.filter((event) => event.to_status === "revoked").length, 1);
});

test("a replacement QC result revokes the approval even when it also passed", async () => {
  const ctx = world();
  const pending = await submit(ctx);
  await ctx.service.approveReview({ ...admin, reviewId: pending.current_review.id,
    expectedRevision: 1, idempotencyKey: "approve-before-new-result" });
  ctx.setQuality({ id: "quality-new-passed" });
  const state = await ctx.service.getReviewState({ ...member, copyVersionId: "copy-a" });
  assert.equal(state.current_review.status, "revoked");
  assert.equal(state.current_review.revoke_reason_code, "quality_result_replaced");
});

test("a changed current ProductRevision persists an approval revocation", async () => {
  const ctx = world();
  const pending = await submit(ctx);
  await ctx.service.approveReview({ ...admin, reviewId: pending.current_review.id,
    expectedRevision: 1, idempotencyKey: "approve-before-facts" });
  ctx.setQuality({ current_valid: false, invalidation_reason: "product_revision_changed" });
  const state = await ctx.service.getReviewState({ ...member, copyVersionId: "copy-a" });
  assert.equal(state.current_review.status, "revoked");
  assert.equal(state.current_review.revoke_reason_code, "product_revision_changed");
});

test("revoked approval never restores and a fresh valid cycle creates a new HumanReview", async () => {
  const ctx = world();
  const first = await submit(ctx);
  await ctx.service.approveReview({ ...admin, reviewId: first.current_review.id,
    expectedRevision: 1, idempotencyKey: "approve-first" });
  ctx.setQuality({ current_valid: false, invalidation_reason: "quality_policy_changed" });
  const revoked = await ctx.service.getReviewState({ ...member, copyVersionId: "copy-a" });
  assert.equal(revoked.current_review.status, "revoked");

  ctx.setQuality({ id: "quality-b", profile_version: "profile-v2", rule_version: "rules-v2",
    current_valid: true, invalidation_reason: null });
  const second = await submit(ctx, "submit-second-cycle");
  assert.notEqual(second.current_review.id, first.current_review.id);
  assert.equal(second.current_review.status, "pending");
  assert.equal(second.reviews.length, 2);
  assert.equal(second.reviews[0].status, "revoked");
});

test("current approved gate is reusable by downstream services", async () => {
  const ctx = world();
  let gate = await ctx.service.getCurrentApprovedGate({ ...member, copyVersionId: "copy-a" });
  assert.equal(gate.approved, false);
  const pending = await submit(ctx);
  await ctx.service.approveReview({ ...admin, reviewId: pending.current_review.id,
    expectedRevision: 1, idempotencyKey: "approve-gate" });
  gate = await ctx.service.getCurrentApprovedGate({ ...member, copyVersionId: "copy-a" });
  assert.equal(gate.approved, true);
  assert.equal(gate.review_id, pending.current_review.id);
});
