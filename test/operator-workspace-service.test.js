import assert from "node:assert/strict";
import test from "node:test";

import { createOperatorWorkspaceService } from "../src/operator-workspace/operator-workspace-service.js";

test("projects the exact current Product Content revision and leaves later stages unloaded", async () => {
  const calls = [];
  const service = createOperatorWorkspaceService({
    projectContentService: {
      async getProject(input) {
        calls.push(input);
        return {
          id: "project-a",
          name: "新品计划",
          products: [{
            id: "product-a",
            current_revision_id: "revision-a",
            revision: {
              id: "revision-a",
              organization_id: "org-a",
              project_id: "project-a",
              product_id: "product-a",
              status: "draft",
              product_name: "",
              asset_version_ids: [],
              selling_points: []
            }
          }]
        };
      }
    }
  });

  const result = await service.getWorkspace({
    organizationId: "org-a",
    actorMemberId: "member-a",
    projectId: "project-a",
    productId: "product-a",
    stage: "product_content"
  });

  assert.deepEqual(result, {
    project: { id: "project-a", name: "新品计划" },
    product: { id: "product-a", name: "", current_revision_id: "revision-a" },
    projection_version: 1,
    action_registry_version: 1,
    requested_stage: "product_content",
    render_mode: "workspace",
    recommended_stage: "product_content",
    recommended_action: { code: "review_product_blockers", stage: "product_content", kind: "focus" },
    stages: [
      {
        code: "product_content",
        implementation_status: "workspace",
        read_status: "ok",
        navigation_state: "current",
        business_status: "商品资料待完善",
        blocker_codes: ["PRODUCT_NAME_REQUIRED", "SELLING_POINT_REQUIRED", "IMAGE_REQUIRED"],
        current_object: { type: "product_revision", id: "revision-a" }
      },
      ...["copy", "avatar", "video_plan", "production"].map((code) => ({
        code,
        implementation_status: "legacy",
        read_status: "not_loaded",
        navigation_state: null,
        business_status: null,
        blocker_codes: [],
        current_object: null
      }))
    ]
  });
  assert.deepEqual(calls, [{
    organizationId: "org-a",
    actorMemberId: "member-a",
    projectId: "project-a"
  }]);
});

test("maps a missing exact project to the unified workspace not-found error", async () => {
  const service = createOperatorWorkspaceService({
    projectContentService: { async getProject() { return null; } }
  });

  await assert.rejects(
    service.getWorkspace({
      organizationId: "org-a",
      actorMemberId: "member-a",
      projectId: "missing-project",
      productId: "product-a",
      stage: "product_content"
    }),
    { code: "OPERATOR_WORKSPACE_NOT_FOUND" }
  );
});

test("surfaces a current Product Content authority failure as unavailable", async () => {
  const service = createOperatorWorkspaceService({
    projectContentService: {
      async getProject() {
        throw Object.assign(new Error("current revision read failed"), { code: "PRODUCT_REVISION_NOT_FOUND" });
      }
    }
  });

  await assert.rejects(
    service.getWorkspace({
      organizationId: "org-a",
      actorMemberId: "member-a",
      projectId: "project-a",
      productId: "product-a",
      stage: "product_content"
    }),
    { code: "OPERATOR_WORKSPACE_UNAVAILABLE" }
  );
});

test("derives the single Product Content action only from current persisted truth", async () => {
  const revision = {
    id: "revision-a",
    organization_id: "org-a",
    project_id: "project-a",
    product_id: "product-a",
    status: "draft",
    product_name: "完整商品",
    asset_version_ids: ["asset-a"],
    selling_points: [{ id: "point-a", text: "卖点", confirmed: true }]
  };
  const service = createOperatorWorkspaceService({
    projectContentService: {
      async getProject() {
        return {
          id: "project-a",
          name: "项目",
          products: [{ id: "product-a", current_revision_id: "revision-a", revision }]
        };
      }
    }
  });

  const draft = await service.getWorkspace({ organizationId: "org-a", actorMemberId: "member-a", projectId: "project-a", productId: "product-a" });
  assert.deepEqual(draft.recommended_action, { code: "mark_product_content_ready", stage: "product_content", kind: "command" });
  revision.status = "ready";
  const ready = await service.getWorkspace({ organizationId: "org-a", actorMemberId: "member-a", projectId: "project-a", productId: "product-a", stage: "product_content" });
  assert.deepEqual(ready.recommended_action, { code: "continue_to_copy", stage: "product_content", kind: "navigate" });
  assert.deepEqual(ready.stages[0].blocker_codes, []);
});

test("does not project a Product Content response when the authoritative project identity mismatches", async () => {
  const service = createOperatorWorkspaceService({
    projectContentService: {
      async getProject() {
        return {
          id: "different-project",
          organization_id: "org-a",
          name: "错误项目",
          products: [{
            id: "product-a",
            project_id: "different-project",
            current_revision_id: "revision-a",
            revision: {
              id: "revision-a",
              organization_id: "org-a",
              project_id: "different-project",
              product_id: "product-a",
              status: "draft",
              product_name: "商品",
              asset_version_ids: [],
              selling_points: []
            }
          }]
        };
      }
    }
  });

  await assert.rejects(
    service.getWorkspace({ organizationId: "org-a", actorMemberId: "member-a", projectId: "project-a", productId: "product-a" }),
    { code: "OPERATOR_WORKSPACE_NOT_FOUND" }
  );
});

test("projects the exact current CopyVersion while keeping QC and human approval independent", async () => {
  const revision = {
    id: "revision-a",
    organization_id: "org-a",
    project_id: "project-a",
    product_id: "product-a",
    status: "ready",
    product_name: "清透防晒乳",
    asset_version_ids: ["asset-a"],
    selling_points: [{ id: "point-a", text: "清爽", confirmed: true }]
  };
  const downstreamReads = { avatar: 0, videoPlan: 0, production: 0 };
  const service = createOperatorWorkspaceService({
    projectContentService: {
      async getProject() {
        return { id: "project-a", name: "夏日项目", products: [{ id: "product-a", current_revision_id: revision.id, revision }] };
      }
    },
    copyService: {
      async listCopyVersions(input) {
        assert.equal(input.productRevisionId, revision.id);
        return [{
          id: "copy-a", organization_id: "org-a", project_id: "project-a", product_id: "product-a",
          product_revision_id: revision.id, status: "frozen", version_number: 1, row_version: 2,
          body: "清爽不黏腻。", generation_job_id: "job-a"
        }];
      },
      async listGenerationJobs() { return [{ id: "job-a", status: "succeeded", copy_version_id: "copy-a", attempts: 1, max_attempts: 3 }]; }
    },
    qualityService: {
      async listQualityRuns() { return [{ id: "quality-a", copy_version_id: "copy-a", status: "succeeded", quality_result_id: "result-a", attempts: 1, max_attempts: 3 }]; },
      async getQualityRun() {
        return {
          quality_run: { id: "quality-a", copy_version_id: "copy-a", status: "succeeded", quality_result_id: "result-a", attempts: 1, max_attempts: 3 },
          quality_result: { id: "result-a", conclusion: "passed", effective_conclusion: "passed", current_valid: true },
          quality_findings: []
        };
      }
    },
    reviewService: {
      async getReviewState() {
        return { current_review: null, reviews: [], history: [], gate: { can_submit: true, can_approve: false, reasons: [] } };
      }
    },
    videoPlanService: { async getWorkspace() { downstreamReads.videoPlan += 1; } },
    productionService: { async getWorkspace() { downstreamReads.production += 1; } }
  });

  const result = await service.getWorkspace({
    organizationId: "org-a", actorMemberId: "member-a", projectId: "project-a", productId: "product-a", stage: "copy"
  });

  assert.equal(result.render_mode, "workspace");
  assert.equal(result.recommended_stage, "copy");
  assert.deepEqual(result.recommended_action, { code: "submit_copy_review", stage: "copy", kind: "command" });
  assert.deepEqual(result.stages[1], {
    code: "copy",
    implementation_status: "workspace",
    read_status: "ok",
    navigation_state: "current",
    business_status: "质检已通过，待提交人工审核",
    blocker_codes: ["HUMAN_REVIEW_REQUIRED"],
    current_object: { type: "copy_version", id: "copy-a" },
    current_copy_version_id: "copy-a",
    versions: [{ id: "copy-a", status: "frozen", version_number: 1, row_version: 2, body: "清爽不黏腻。", product_revision_id: "revision-a" }],
    generation: { current_job_id: "job-a", status: "succeeded", failure_code: null, attempts: 1, max_attempts: 3 },
    copy_version: { id: "copy-a", status: "frozen", version_number: 1, row_version: 2, body: "清爽不黏腻。", product_revision_id: "revision-a" },
    quality: { run_id: "quality-a", result_id: "result-a", status: "succeeded", attempts: 1, max_attempts: 3, conclusion: "passed", current_valid: true, invalidation_reason: null, findings: [] },
    human_review: { review_id: null, status: "not_submitted", row_version: null, can_submit: true, can_approve: false, reasons: [] }
  });
  assert.deepEqual(result.stages.slice(2).map(({ code, implementation_status, read_status }) => ({ code, implementation_status, read_status })), [
    { code: "avatar", implementation_status: "legacy", read_status: "not_loaded" },
    { code: "video_plan", implementation_status: "legacy", read_status: "not_loaded" },
    { code: "production", implementation_status: "legacy", read_status: "not_loaded" }
  ]);
  assert.deepEqual(downstreamReads, { avatar: 0, videoPlan: 0, production: 0 });
});

test("selects only an exact CopyVersion deep link from the current product revision", async () => {
  const copies = [
    { id: "copy-history", organization_id: "org-a", project_id: "project-a", product_id: "product-a", product_revision_id: "revision-a", status: "superseded", version_number: 1, row_version: 3, body: "历史文案" },
    { id: "copy-current", organization_id: "org-a", project_id: "project-a", product_id: "product-a", product_revision_id: "revision-a", status: "draft", version_number: 2, row_version: 1, body: "当前文案" }
  ];
  const service = createOperatorWorkspaceService({
    projectContentService: { async getProject() { return { id: "project-a", products: [{ id: "product-a", current_revision_id: "revision-a", revision: { id: "revision-a", organization_id: "org-a", project_id: "project-a", product_id: "product-a", status: "ready", product_name: "商品", asset_version_ids: ["asset-a"], selling_points: [{ text: "卖点", confirmed: true }] } }] }; } },
    copyService: { async listCopyVersions() { return copies; }, async listGenerationJobs() { return []; } },
    qualityService: { async listQualityRuns() { return []; }, async getQualityRun() { throw new Error("not reached"); } },
    reviewService: { async getReviewState() { return { current_review: null, gate: { can_submit: false, can_approve: false, reasons: [] } }; } }
  });

  const history = await service.getWorkspace({ organizationId: "org-a", actorMemberId: "member-a", actorRole: "admin", projectId: "project-a", productId: "product-a", stage: "copy", copyVersionId: "copy-history" });
  assert.equal(history.stages[1].current_object.id, "copy-history");
  assert.equal(history.stages[1].navigation_state, "history");
  assert.equal(history.stages[1].current_copy_version_id, "copy-current");
  assert.deepEqual(history.recommended_action, { code: "return_to_current_copy_version", stage: "copy", kind: "navigate" });

  await assert.rejects(
    service.getWorkspace({ organizationId: "org-a", actorMemberId: "member-a", projectId: "project-a", productId: "product-a", stage: "copy", copyVersionId: "copy-from-another-product" }),
    { code: "OPERATOR_WORKSPACE_NOT_FOUND" }
  );
});

test("projects the newest generation job from the repository newest-first contract", async () => {
  const service = createOperatorWorkspaceService({
    projectContentService: { async getProject() { return {
      id: "project-a", products: [{ id: "product-a", current_revision_id: "revision-a", revision: {
        id: "revision-a", organization_id: "org-a", project_id: "project-a", product_id: "product-a",
        status: "ready", product_name: "商品", asset_version_ids: ["asset-a"],
        selling_points: [{ text: "卖点", confirmed: true }]
      } }]
    }; } },
    copyService: {
      async listCopyVersions() { return []; },
      async listGenerationJobs() { return [
        { id: "job-new", status: "queued", attempts: 0, max_attempts: 3, created_at: "2026-08-24T02:00:00.000Z" },
        { id: "job-old", status: "failed", failure_code: "COPY_GENERATION_FAILED", attempts: 1, max_attempts: 3, created_at: "2026-08-24T01:00:00.000Z" }
      ]; }
    },
    qualityService: { async listQualityRuns() { return []; }, async getQualityRun() { throw new Error("not reached"); } },
    reviewService: { async getReviewState() { return { current_review: null, gate: { can_submit: false, can_approve: false, reasons: [] } }; } }
  });

  const workspace = await service.getWorkspace({
    organizationId: "org-a", actorMemberId: "member-a", projectId: "project-a", productId: "product-a", stage: "copy"
  });

  assert.equal(workspace.stages[1].generation.current_job_id, "job-new");
  assert.equal(workspace.stages[1].generation.status, "queued");
  assert.deepEqual(workspace.stages[1].blocker_codes, ["COPY_GENERATION_IN_PROGRESS"]);
  assert.equal(workspace.recommended_action, null);
});

test("projects the exact approved CopyVersion and Avatar workspace while leaving later stages unloaded", async () => {
  const revision = {
    id: "revision-a",
    organization_id: "org-a",
    project_id: "project-a",
    product_id: "product-a",
    status: "ready",
    product_name: "清透防晒乳",
    asset_version_ids: ["product-image-a"],
    selling_points: [{ id: "point-a", text: "清爽", confirmed: true }]
  };
  const approvedCopy = {
    id: "copy-approved",
    organization_id: "org-a",
    project_id: "project-a",
    product_id: "product-a",
    product_revision_id: revision.id,
    status: "frozen",
    version_number: 3,
    row_version: 2,
    body: "清爽不黏腻。"
  };
  const avatarWorkspace = {
    catalog_kind: "existing_only",
    provider_integration: false,
    recommendation: { primary_category: null, has_recommendations: true, recommended_count: 1, reason_code: "general_pool_fallback", reason: "使用通用人物。" },
    controlled_seed_notice: "受控预置。",
    resolved_copy_version_id: approvedCopy.id,
    copy_gate: { approved: true, reasons: [], copy_version_id: approvedCopy.id },
    catalog: [{ id: "avatar-a", display_name: "林小满", asset_version: { id: "avatar-version-a", version_number: 1, status: "available", preview_kind: "controlled_placeholder" }, gate: { can_confirm: true, reasons: [] } }],
    selection: {
      current_selection: { id: "selection-a", product_id: "product-a", copy_version_id: approvedCopy.id, asset_version_id: "avatar-version-a", version_number: 1, status: "confirmed", row_version: 1 },
      selection_revision: 1,
      current_valid: true,
      invalidation_reasons: [],
      history: []
    }
  };
  const calls = [];
  const service = createOperatorWorkspaceService({
    projectContentService: {
      async getProject() {
        return { id: "project-a", name: "夏日项目", products: [{ id: "product-a", current_revision_id: revision.id, revision }] };
      }
    },
    copyService: {
      async listCopyVersions(input) {
        calls.push({ kind: "copy", input });
        return [approvedCopy];
      }
    },
    reviewService: {
      async getReviewState(input) {
        calls.push({ kind: "review", input });
        return { current_review: { id: "review-a", status: "approved", copy_version_id: approvedCopy.id, product_revision_id: revision.id }, gate: { can_submit: false, can_approve: false, reasons: [] } };
      }
    },
    avatarService: {
      async getWorkspace(input) {
        calls.push({ kind: "avatar", input });
        return avatarWorkspace;
      }
    }
  });

  const result = await service.getWorkspace({
    organizationId: "org-a", actorMemberId: "member-a", actorRole: "admin",
    projectId: "project-a", productId: "product-a", stage: "avatar"
  });

  assert.equal(result.render_mode, "workspace");
  assert.equal(result.recommended_stage, "avatar");
  assert.deepEqual(result.recommended_action, { code: "continue_to_video_plan", stage: "avatar", kind: "navigate" });
  assert.deepEqual(result.stages[2], {
    code: "avatar",
    implementation_status: "workspace",
    read_status: "ok",
    navigation_state: "current",
    business_status: "人物已确认",
    blocker_codes: [],
    current_object: { type: "avatar_selection", id: "selection-a" },
    current_copy_version_id: "copy-approved",
    copy_version: {
      id: "copy-approved", status: "frozen", version_number: 3, row_version: 2,
      body: "清爽不黏腻。", product_revision_id: "revision-a"
    },
    avatar_workspace: avatarWorkspace
  });
  assert.deepEqual(result.stages.slice(3), [
    { code: "video_plan", implementation_status: "legacy", read_status: "not_loaded", navigation_state: null, business_status: null, blocker_codes: [], current_object: null },
    { code: "production", implementation_status: "legacy", read_status: "not_loaded", navigation_state: null, business_status: null, blocker_codes: [], current_object: null }
  ]);
  assert.deepEqual(calls, [
    { kind: "copy", input: { organizationId: "org-a", actorMemberId: "member-a", productRevisionId: "revision-a" } },
    { kind: "review", input: { organizationId: "org-a", actorMemberId: "member-a", copyVersionId: "copy-approved" } },
    { kind: "avatar", input: { organizationId: "org-a", actorMemberId: "member-a", actorRole: "admin", productId: "product-a", copyVersionId: "copy-approved" } }
  ]);
});

test("fails closed when Avatar returns a workspace bound to a different CopyVersion", async () => {
  const revision = {
    id: "revision-a", organization_id: "org-a", project_id: "project-a", product_id: "product-a", status: "ready",
    product_name: "商品", asset_version_ids: ["product-image-a"], selling_points: [{ text: "卖点", confirmed: true }]
  };
  const copy = {
    id: "copy-approved", organization_id: "org-a", project_id: "project-a", product_id: "product-a",
    product_revision_id: revision.id, status: "frozen", version_number: 1, row_version: 1, body: "文案"
  };
  const service = createOperatorWorkspaceService({
    projectContentService: { async getProject() { return { id: "project-a", products: [{ id: "product-a", current_revision_id: revision.id, revision }] }; } },
    copyService: { async listCopyVersions() { return [copy]; } },
    reviewService: { async getReviewState() { return { current_review: { id: "review-a", status: "approved", copy_version_id: copy.id }, gate: { reasons: [] } }; } },
    avatarService: { async getWorkspace() {
      return { resolved_copy_version_id: "copy-from-another-revision", copy_gate: { approved: true, reasons: [], copy_version_id: "copy-from-another-revision" }, catalog: [], selection: { current_selection: null } };
    } }
  });

  await assert.rejects(
    service.getWorkspace({ organizationId: "org-a", actorMemberId: "member-a", actorRole: "admin", projectId: "project-a", productId: "product-a", stage: "avatar" }),
    { code: "OPERATOR_WORKSPACE_NOT_FOUND" }
  );
});

test("preserves a same-product AvatarSelection invalidated by a newer approved CopyVersion", async () => {
  const revision = {
    id: "revision-a", organization_id: "org-a", project_id: "project-a", product_id: "product-a", status: "ready",
    product_name: "商品", asset_version_ids: ["product-image-a"], selling_points: [{ text: "卖点", confirmed: true }]
  };
  const copy = (id, version) => ({
    id, organization_id: "org-a", project_id: "project-a", product_id: "product-a",
    product_revision_id: revision.id, status: "frozen", version_number: version, row_version: 1, body: `文案 ${version}`
  });
  const oldCopy = copy("copy-old", 1);
  const currentCopy = copy("copy-current", 2);
  const currentSelection = {
    id: "selection-old-copy", product_id: "product-a", copy_version_id: oldCopy.id,
    asset_version_id: "avatar-version-a", status: "confirmed", row_version: 1
  };
  let selectionProductId = "product-a";
  const laterStageReads = { videoPlan: 0, production: 0 };
  const service = createOperatorWorkspaceService({
    projectContentService: { async getProject() {
      return { id: "project-a", organization_id: "org-a", products: [{ id: "product-a", current_revision_id: revision.id, revision }] };
    } },
    copyService: { async listCopyVersions() { return [oldCopy, currentCopy]; } },
    reviewService: { async getReviewState({ copyVersionId }) {
      return { current_review: { id: `review-${copyVersionId}`, status: copyVersionId === currentCopy.id ? "approved" : "revoked",
        copy_version_id: copyVersionId, product_revision_id: revision.id }, gate: { reasons: [] } };
    } },
    avatarService: { async getWorkspace({ copyVersionId }) {
      assert.equal(copyVersionId, currentCopy.id);
      return {
        resolved_copy_version_id: currentCopy.id,
        copy_gate: { approved: true, reasons: [], copy_version_id: currentCopy.id },
        catalog: [],
        selection: { current_selection: { ...currentSelection, product_id: selectionProductId }, selection_revision: 1, current_valid: false,
          invalidation_reasons: ["copy_version_changed"], history: [{ ...currentSelection, product_id: selectionProductId }] }
      };
    } },
    videoPlanningService: { async getWorkspace() { laterStageReads.videoPlan += 1; throw new Error("Stage 4 must not be read"); } },
    productionService: { async getWorkspace() { laterStageReads.production += 1; throw new Error("Stage 5 must not be read"); } }
  });

  const result = await service.getWorkspace({ organizationId: "org-a", actorMemberId: "member-a", actorRole: "admin",
    projectId: "project-a", productId: "product-a", stage: "avatar" });

  assert.equal(result.stages[2].business_status, "人物选择已失效");
  assert.equal(result.stages[2].current_copy_version_id, currentCopy.id);
  assert.equal(result.stages[2].current_object.id, currentSelection.id);
  assert.equal(result.stages[2].avatar_workspace.selection.current_valid, false);
  assert.deepEqual(result.stages[2].avatar_workspace.selection.invalidation_reasons, ["copy_version_changed"]);
  assert.deepEqual(result.recommended_action, { code: "select_avatar", stage: "avatar", kind: "focus" });
  assert.deepEqual(result.stages.slice(3).map(({ code, read_status }) => ({ code, read_status })), [
    { code: "video_plan", read_status: "not_loaded" },
    { code: "production", read_status: "not_loaded" }
  ]);
  assert.deepEqual(laterStageReads, { videoPlan: 0, production: 0 });

  selectionProductId = "product-from-another-context";
  await assert.rejects(service.getWorkspace({ organizationId: "org-a", actorMemberId: "member-a", actorRole: "admin",
    projectId: "project-a", productId: "product-a", stage: "avatar" }), { code: "OPERATOR_WORKSPACE_NOT_FOUND" });
});

test("does not treat an unapproved draft CopyVersion as the Avatar upstream", async () => {
  const revision = {
    id: "revision-a", organization_id: "org-a", project_id: "project-a", product_id: "product-a", status: "ready",
    product_name: "商品", asset_version_ids: ["product-image-a"], selling_points: [{ text: "卖点", confirmed: true }]
  };
  const draft = {
    id: "copy-draft", organization_id: "org-a", project_id: "project-a", product_id: "product-a",
    product_revision_id: revision.id, status: "draft", version_number: 1, row_version: 1, body: "未批准文案"
  };
  const service = createOperatorWorkspaceService({
    projectContentService: { async getProject() { return { id: "project-a", products: [{ id: "product-a", current_revision_id: revision.id, revision }] }; } },
    copyService: { async listCopyVersions() { return [draft]; } },
    avatarService: { async getWorkspace() {
      return { resolved_copy_version_id: draft.id, copy_gate: { approved: true, reasons: [], copy_version_id: draft.id }, catalog: [], selection: { current_selection: null } };
    } }
  });

  await assert.rejects(
    service.getWorkspace({ organizationId: "org-a", actorMemberId: "member-a", actorRole: "admin", projectId: "project-a", productId: "product-a", stage: "avatar" }),
    { code: "OPERATOR_WORKSPACE_NOT_FOUND" }
  );
});

test("does not project a CopyVersion when Avatar approval is accompanied by blocking reasons", async () => {
  const revision = {
    id: "revision-a", organization_id: "org-a", project_id: "project-a", product_id: "product-a", status: "ready",
    product_name: "商品", asset_version_ids: ["product-image-a"], selling_points: [{ text: "卖点", confirmed: true }]
  };
  const copy = {
    id: "copy-approved", organization_id: "org-a", project_id: "project-a", product_id: "product-a",
    product_revision_id: revision.id, status: "frozen", version_number: 1, row_version: 1, body: "文案"
  };
  const service = createOperatorWorkspaceService({
    projectContentService: { async getProject() { return { id: "project-a", products: [{ id: "product-a", current_revision_id: revision.id, revision }] }; } },
    copyService: { async listCopyVersions() { return [copy]; } },
    avatarService: { async getWorkspace() {
      return { resolved_copy_version_id: copy.id, copy_gate: { approved: true, reasons: ["copy_version_changed"], copy_version_id: copy.id }, catalog: [], selection: { current_selection: null } };
    } }
  });

  const result = await service.getWorkspace({ organizationId: "org-a", actorMemberId: "member-a", actorRole: "admin", projectId: "project-a", productId: "product-a", stage: "avatar" });
  assert.equal(result.stages[2].current_copy_version_id, null);
  assert.equal(result.stages[2].copy_version, null);
  assert.deepEqual(result.recommended_action, { code: "return_to_copy", stage: "avatar", kind: "navigate" });
});

test("selects the newest approved CopyVersion for Avatar when a revision has approval history", async () => {
  const revision = {
    id: "revision-a", organization_id: "org-a", project_id: "project-a", product_id: "product-a", status: "ready",
    product_name: "商品", asset_version_ids: ["product-image-a"], selling_points: [{ text: "卖点", confirmed: true }]
  };
  const copy = (id, version) => ({ id, organization_id: "org-a", project_id: "project-a", product_id: "product-a",
    product_revision_id: revision.id, status: "frozen", version_number: version, row_version: 1, body: `文案${version}` });
  const copies = [copy("copy-old", 1), copy("copy-new", 2)];
  const service = createOperatorWorkspaceService({
    projectContentService: { async getProject() { return { id: "project-a", products: [{ id: "product-a", current_revision_id: revision.id, revision }] }; } },
    copyService: { async listCopyVersions() { return copies; } },
    reviewService: { async getReviewState({ copyVersionId }) { return { current_review: { id: `review-${copyVersionId}`, status: "approved", copy_version_id: copyVersionId }, gate: { reasons: [] } }; } },
    avatarService: { async getWorkspace(input) {
      assert.equal(input.copyVersionId, "copy-new");
      return { resolved_copy_version_id: "copy-new", copy_gate: { approved: true, reasons: [], copy_version_id: "copy-new" }, catalog: [], selection: { current_selection: null } };
    } }
  });

  const result = await service.getWorkspace({ organizationId: "org-a", actorMemberId: "member-a", actorRole: "admin", projectId: "project-a", productId: "product-a", stage: "avatar" });
  assert.equal(result.stages[2].current_copy_version_id, "copy-new");
  assert.equal(result.stages[2].copy_version.version_number, 2);
});

test("fails closed for unknown or wrong-stage Avatar recommended actions", async () => {
  const revision = {
    id: "revision-a", organization_id: "org-a", project_id: "project-a", product_id: "product-a", status: "ready",
    product_name: "商品", asset_version_ids: ["product-image-a"], selling_points: [{ text: "卖点", confirmed: true }]
  };
  const copy = {
    id: "copy-approved", organization_id: "org-a", project_id: "project-a", product_id: "product-a",
    product_revision_id: revision.id, status: "frozen", version_number: 1, row_version: 1, body: "文案"
  };
  for (const recommendedAction of [
    { code: "unknown_avatar_action", stage: "avatar", kind: "navigate" },
    { code: "continue_to_video_plan", stage: "copy", kind: "navigate" },
    { code: "continue_to_video_plan", stage: "avatar", kind: "command" }
  ]) {
    const service = createOperatorWorkspaceService({
      projectContentService: { async getProject() { return { id: "project-a", products: [{ id: "product-a", current_revision_id: revision.id, revision }] }; } },
      copyService: { async listCopyVersions() { return [copy]; } },
      reviewService: { async getReviewState() { return { current_review: { id: "review-a", status: "approved", copy_version_id: copy.id }, gate: { reasons: [] } }; } },
      avatarService: { async getWorkspace() {
        return { resolved_copy_version_id: copy.id, copy_gate: { approved: true, reasons: [], copy_version_id: copy.id }, recommended_action: recommendedAction,
          catalog: [], selection: { current_selection: null, selection_revision: 0, current_valid: false, invalidation_reasons: [], history: [] } };
      } }
    });

    const result = await service.getWorkspace({ organizationId: "org-a", actorMemberId: "member-a", actorRole: "admin", projectId: "project-a", productId: "product-a", stage: "avatar" });
    assert.equal(result.recommended_action, null);
  }
});

test("projects Avatar read errors as workspace error without stale Avatar object or action", async () => {
  const revision = {
    id: "revision-a", organization_id: "org-a", project_id: "project-a", product_id: "product-a", status: "ready",
    product_name: "商品", asset_version_ids: ["product-image-a"], selling_points: [{ text: "卖点", confirmed: true }]
  };
  const copy = {
    id: "copy-approved", organization_id: "org-a", project_id: "project-a", product_id: "product-a",
    product_revision_id: revision.id, status: "frozen", version_number: 1, row_version: 1, body: "文案"
  };
  const service = createOperatorWorkspaceService({
    projectContentService: { async getProject() { return { id: "project-a", products: [{ id: "product-a", current_revision_id: revision.id, revision }] }; } },
    copyService: { async listCopyVersions() { return [copy]; } },
    reviewService: { async getReviewState() { return { current_review: { id: "review-a", status: "approved", copy_version_id: copy.id }, gate: { reasons: [] } }; } },
    avatarService: { async getWorkspace() { throw new Error("avatar read failed"); } }
  });

  const result = await service.getWorkspace({ organizationId: "org-a", actorMemberId: "member-a", actorRole: "admin", projectId: "project-a", productId: "product-a", stage: "product_content" });
  assert.deepEqual(result.stages[2], {
    code: "avatar",
    implementation_status: "workspace",
    read_status: "error",
    navigation_state: null,
    business_status: null,
    blocker_codes: [],
    current_object: null
  });
  assert.equal(result.stages[2].copy_version, undefined);
  assert.equal(result.stages[2].avatar_workspace, undefined);
  assert.notEqual(result.recommended_action, null);
});

test("projects exact VideoPlan preflight truth without treating it as human approval or reading Production", async () => {
  const revision = {
    id: "revision-a", organization_id: "org-a", project_id: "project-a", product_id: "product-a", status: "ready",
    product_name: "清透防晒乳", asset_version_ids: ["product-image-a"], selling_points: [{ text: "清爽", confirmed: true }]
  };
  const copy = {
    id: "copy-approved", organization_id: "org-a", project_id: "project-a", product_id: "product-a",
    product_revision_id: revision.id, status: "frozen", version_number: 2, row_version: 1, body: "清爽防晒文案"
  };
  const selection = {
    id: "selection-confirmed", product_id: "product-a", copy_version_id: copy.id,
    asset_version_id: "avatar-version-a", status: "confirmed", row_version: 2
  };
  let productionReads = 0;
  const service = createOperatorWorkspaceService({
    projectContentService: {
      async getProject() {
        return { id: "project-a", name: "夏日计划", products: [{ id: "product-a", current_revision_id: revision.id, revision }] };
      }
    },
    copyService: { async listCopyVersions() { return [copy]; } },
    reviewService: {
      async getReviewState() {
        return { current_review: { id: "copy-review-a", status: "approved", copy_version_id: copy.id }, gate: { reasons: [] } };
      }
    },
    avatarService: {
      async getWorkspace() {
        return {
          resolved_copy_version_id: copy.id,
          copy_gate: { approved: true, reasons: [], copy_version_id: copy.id },
          catalog: [],
          selection: { current_selection: selection, selection_revision: 2, current_valid: true, invalidation_reasons: [], history: [selection] }
        };
      }
    },
    videoPlanningService: {
      async getWorkspace(input) {
        assert.equal(input.productId, "product-a");
        assert.equal(input.planId, "plan-a");
        return {
          current_plan: {
            id: "plan-a", organization_id: "org-a", product_id: "product-a", version_number: 1,
            status: "frozen", row_version: 2, output_instructions: "竖版口播",
            presentation_size_code: "small",
            upstream_snapshot: {
              product_revision_id: revision.id, copy_version_id: copy.id,
              avatar_selection_id: selection.id, avatar_asset_version_id: selection.asset_version_id
            },
            capability_config_snapshot: { snapshot_version: "cap-v1", verified_capabilities: [{ code: "mandarin", evidence_reference: "evidence-a" }] }
          },
          head_revision: 1,
          versions: [{ id: "plan-a", organization_id: "org-a", product_id: "product-a", version_number: 1, status: "frozen", row_version: 2 }],
          preflight: {
            current_run: { id: "run-a", organization_id: "org-a", video_plan_version_id: "plan-a", status: "succeeded", input_snapshot: { private: true } },
            current_result: { id: "result-a", organization_id: "org-a", video_plan_version_id: "plan-a", preflight_run_id: "run-a", status: "passed", groups: {} },
            history: []
          },
          review: { current_review: null, history: [], gate: { can_submit: true, can_decide: false, reasons: [] } },
          production_order_available: false,
          production_order_notice: "创建生产工单尚未开放。"
        };
      }
    },
    productionService: {
      async getWorkspace() {
        productionReads += 1;
        throw new Error("Stage 5 must remain unread");
      }
    }
  });

  const result = await service.getWorkspace({
    organizationId: "org-a", actorMemberId: "member-a", actorRole: "admin",
    projectId: "project-a", productId: "product-a", stage: "video_plan", planId: "plan-a"
  });

  assert.equal(result.render_mode, "workspace");
  assert.equal(result.recommended_stage, "video_plan");
  assert.deepEqual(result.recommended_action, { code: "submit_video_plan_review", stage: "video_plan", kind: "command" });
  const stage = result.stages[3];
  assert.equal(stage.implementation_status, "workspace");
  assert.equal(stage.read_status, "ok");
  assert.equal(stage.business_status, "预检已通过，待提交人工审核");
  assert.deepEqual(stage.blocker_codes, ["VIDEO_PLAN_HUMAN_REVIEW_REQUIRED"]);
  assert.deepEqual(stage.current_object, { type: "video_plan", id: "plan-a" });
  assert.equal(stage.video_plan_workspace.current_plan.id, "plan-a");
  assert.equal(stage.video_plan_workspace.preflight.current_result.status, "passed");
  assert.equal(stage.video_plan_workspace.human_review.current_review, null);
  assert.equal(JSON.stringify(stage).includes("organization_id"), false);
  assert.equal(JSON.stringify(stage).includes("input_snapshot"), false);
  assert.deepEqual(result.stages[4], {
    code: "production", implementation_status: "legacy", read_status: "not_loaded", navigation_state: null,
    business_status: null, blocker_codes: [], current_object: null
  });
  assert.equal(productionReads, 0);
});

test("orders VideoPlan recommendations from exact plan, preflight, review, and history truth", async () => {
  const revision = {
    id: "revision-plan", organization_id: "org-a", project_id: "project-a", product_id: "product-a", status: "ready",
    product_name: "商品", asset_version_ids: ["product-image"], selling_points: [{ text: "卖点", confirmed: true }]
  };
  const copy = {
    id: "copy-approved", organization_id: "org-a", project_id: "project-a", product_id: "product-a",
    product_revision_id: revision.id, status: "frozen", version_number: 1, row_version: 1, body: "文案"
  };
  const selection = {
    id: "selection-confirmed", product_id: "product-a", copy_version_id: copy.id,
    asset_version_id: "avatar-version", status: "confirmed", row_version: 1
  };
  const plan = {
    id: "plan-current", organization_id: "org-a", product_id: "product-a", version_number: 2,
    status: "draft", row_version: 1, output_instructions: "制作说明", presentation_size_code: "smart_fit",
    upstream_snapshot: { product_revision_id: revision.id, copy_version_id: copy.id,
      avatar_selection_id: selection.id, avatar_asset_version_id: selection.asset_version_id },
    capability_config_snapshot: { snapshot_version: "cap-v1", verified_capabilities: [{ code: "mandarin", evidence_reference: "evidence" }] }
  };
  const historical = { ...plan, id: "plan-old", version_number: 1, status: "superseded" };
  let videoWorkspace = {
    current_plan: plan, head_revision: 2, versions: [historical, plan],
    preflight: { current_run: null, current_result: null, history: [] },
    review: { current_review: null, history: [], gate: { can_submit: false, can_decide: false, reasons: ["plan_not_frozen"] } }
  };
  const service = createOperatorWorkspaceService({
    projectContentService: { async getProject() { return { id: "project-a", products: [{ id: "product-a", current_revision_id: revision.id, revision }] }; } },
    copyService: { async listCopyVersions() { return [copy]; } },
    reviewService: { async getReviewState() { return { current_review: { id: "copy-review", status: "approved", copy_version_id: copy.id }, gate: { reasons: [] } }; } },
    avatarService: { async getWorkspace() { return { resolved_copy_version_id: copy.id,
      copy_gate: { approved: true, reasons: [], copy_version_id: copy.id }, catalog: [],
      selection: { current_selection: selection, selection_revision: 1, current_valid: true, invalidation_reasons: [], history: [selection] } }; } },
    videoPlanningService: { async getWorkspace() { return structuredClone(videoWorkspace); } },
    productionService: { async getWorkspace() { throw new Error("Production must remain unread"); } }
  });
  const read = (planId = null) => service.getWorkspace({ organizationId: "org-a", actorMemberId: "member-a", actorRole: "admin",
    projectId: "project-a", productId: "product-a", stage: "video_plan", ...(planId ? { planId } : {}) });

  assert.equal((await read()).recommended_action.code, "run_video_plan_preflight");

  videoWorkspace.preflight.current_run = { id: "run-a", organization_id: "org-a", status: "queued", video_plan_version_id: plan.id };
  assert.equal((await read()).recommended_action, null);

  videoWorkspace.preflight.current_run = { id: "run-a", organization_id: "org-a", status: "failed", video_plan_version_id: plan.id, failure_code: "TEMPORARY" };
  assert.equal((await read()).recommended_action.code, "retry_video_plan_preflight");

  videoWorkspace.current_plan = { ...plan, status: "frozen", row_version: 2 };
  videoWorkspace.versions[1] = videoWorkspace.current_plan;
  videoWorkspace.preflight.current_run = { id: "run-b", organization_id: "org-a", status: "succeeded", video_plan_version_id: plan.id };
  videoWorkspace.preflight.current_result = { id: "result-a", organization_id: "org-a", status: "warning", video_plan_version_id: plan.id,
    preflight_run_id: "run-b", groups: {} };
  videoWorkspace.review.gate = { can_submit: true, can_decide: false, reasons: [] };
  assert.equal((await read()).recommended_action.code, "submit_video_plan_review");

  videoWorkspace.review.current_review = { id: "review-a", organization_id: "org-a", video_plan_version_id: plan.id, status: "pending", row_version: 1 };
  videoWorkspace.review.history = [videoWorkspace.review.current_review];
  videoWorkspace.review.gate = { can_submit: false, can_decide: true, reasons: ["review_pending"] };
  assert.equal((await read()).recommended_action.code, "approve_video_plan_review");

  videoWorkspace.preflight.current_result = { ...videoWorkspace.preflight.current_result, status: "invalidated" };
  videoWorkspace.review.gate = { can_submit: false, can_decide: true, reasons: ["preflight_not_reviewable"] };
  assert.equal((await read()).stages[3].business_status, "视频方案预检已失效");
  assert.equal((await read()).recommended_action.code, "derive_video_plan_draft");

  videoWorkspace.preflight.current_result = { ...videoWorkspace.preflight.current_result, status: "blocked" };
  assert.equal((await read()).stages[3].business_status, "视频方案预检未通过");
  assert.equal((await read()).recommended_action.code, "derive_video_plan_draft");

  videoWorkspace.preflight.current_result = null;
  videoWorkspace.preflight.current_run = { id: "run-c", organization_id: "org-a", status: "running", video_plan_version_id: plan.id };
  assert.equal((await read()).stages[3].business_status, "正在进行视频方案预检");
  assert.equal((await read()).recommended_action, null);

  videoWorkspace.preflight.current_run = { id: "run-b", organization_id: "org-a", status: "succeeded", video_plan_version_id: plan.id };
  videoWorkspace.preflight.current_result = { id: "result-a", organization_id: "org-a", status: "warning", video_plan_version_id: plan.id,
    preflight_run_id: "run-b", groups: {} };
  videoWorkspace.review.gate = { can_submit: false, can_decide: true, reasons: ["review_pending"] };

  videoWorkspace.review.current_review = { ...videoWorkspace.review.current_review, status: "approved", row_version: 2 };
  videoWorkspace.review.history = [videoWorkspace.review.current_review];
  assert.equal((await read()).recommended_action.code, "continue_to_production");

  videoWorkspace.review.current_review = { ...videoWorkspace.review.current_review, status: "changes_requested", row_version: 2 };
  videoWorkspace.review.history = [videoWorkspace.review.current_review];
  assert.equal((await read()).recommended_action.code, "derive_video_plan_draft");

  for (const code of ["toString", "constructor", "__proto__"]) {
    videoWorkspace.current_plan = plan;
    videoWorkspace.versions = [historical, plan];
    videoWorkspace.preflight = { current_run: null, current_result: null, history: [] };
    videoWorkspace.review = { current_review: null, history: [], gate: { can_submit: false, can_decide: false, reasons: ["plan_not_frozen"] } };
    videoWorkspace.recommended_action = { code };
    assert.equal((await read()).recommended_action, null, `${code} must not resolve through Object.prototype`);
  }
  delete videoWorkspace.recommended_action;

  videoWorkspace.current_plan = historical;
  videoWorkspace.preflight = { current_run: null, current_result: null, history: [] };
  videoWorkspace.review = { current_review: null, history: [], gate: { can_submit: false, can_decide: false, reasons: ["plan_not_frozen"] } };
  assert.equal((await read(historical.id)).recommended_action.code, "return_to_current_video_plan");
});

test("fails closed when VideoPlan run, result, or review is not bound to the exact selected plan", async () => {
  const revision = {
    id: "revision-plan-binding", organization_id: "org-a", project_id: "project-a", product_id: "product-a", status: "ready",
    product_name: "商品", asset_version_ids: ["product-image"], selling_points: [{ text: "卖点", confirmed: true }]
  };
  const copy = {
    id: "copy-approved", organization_id: "org-a", project_id: "project-a", product_id: "product-a",
    product_revision_id: revision.id, status: "frozen", version_number: 1, row_version: 1, body: "文案"
  };
  const selection = {
    id: "selection-confirmed", product_id: "product-a", copy_version_id: copy.id,
    asset_version_id: "avatar-version", status: "confirmed", row_version: 1
  };
  const plan = {
    id: "plan-selected", organization_id: "org-a", product_id: "product-a", version_number: 1,
    status: "frozen", row_version: 2, output_instructions: "制作说明", presentation_size_code: "smart_fit",
    upstream_snapshot: { product_revision_id: revision.id, copy_version_id: copy.id,
      avatar_selection_id: selection.id, avatar_asset_version_id: selection.asset_version_id },
    capability_config_snapshot: { snapshot_version: "cap-v1", verified_capabilities: [{ code: "mandarin", evidence_reference: "evidence" }] }
  };
  let mismatched = {
    current_plan: plan, head_revision: 1, versions: [plan],
    preflight: {
      current_run: { id: "run-other", organization_id: "org-a", video_plan_version_id: "plan-other", status: "succeeded" },
      current_result: { id: "result-other", organization_id: "org-a", video_plan_version_id: "plan-other", preflight_run_id: "run-other", status: "passed", groups: {} },
      history: []
    },
    review: { current_review: null, history: [], gate: { can_submit: true, can_decide: false, reasons: [] } }
  };
  const service = createOperatorWorkspaceService({
    projectContentService: { async getProject() { return { id: "project-a", products: [{ id: "product-a", current_revision_id: revision.id, revision }] }; } },
    copyService: { async listCopyVersions() { return [copy]; } },
    reviewService: { async getReviewState() { return { current_review: { id: "copy-review", status: "approved", copy_version_id: copy.id }, gate: { reasons: [] } }; } },
    avatarService: { async getWorkspace() { return { resolved_copy_version_id: copy.id,
      copy_gate: { approved: true, reasons: [], copy_version_id: copy.id }, catalog: [],
      selection: { current_selection: selection, selection_revision: 1, current_valid: true, invalidation_reasons: [], history: [selection] } }; } },
    videoPlanningService: { async getWorkspace() { return structuredClone(mismatched); } }
  });
  const read = () => service.getWorkspace({ organizationId: "org-a", actorMemberId: "member-a", actorRole: "admin",
    projectId: "project-a", productId: "product-a", stage: "video_plan", planId: plan.id });

  await assert.rejects(read(), { code: "OPERATOR_WORKSPACE_NOT_FOUND" });
  mismatched.preflight = { current_run: null, current_result: null, history: [] };
  mismatched.review.current_review = { id: "review-missing-binding", organization_id: "org-a", status: "pending", row_version: 1 };
  mismatched.review.history = [mismatched.review.current_review];
  await assert.rejects(read(), { code: "OPERATOR_WORKSPACE_NOT_FOUND" });

  mismatched = { current_plan: { ...plan }, head_revision: 1, versions: [{ ...plan }],
    preflight: { current_run: { id: "run-selected", organization_id: "org-a", video_plan_version_id: plan.id, status: "succeeded" },
      current_result: { id: "result-selected", organization_id: "org-a", video_plan_version_id: plan.id,
        preflight_run_id: "run-other", status: "passed", groups: {} }, history: [] },
    review: { current_review: null, history: [], gate: { can_submit: true, can_decide: false, reasons: [] } } };
  await assert.rejects(read(), { code: "OPERATOR_WORKSPACE_NOT_FOUND" });

  for (const mutate of [
    (value) => { delete value.current_plan.id; },
    (value) => { delete value.current_plan.organization_id; },
    (value) => { delete value.current_plan.product_id; },
    (value) => { value.versions = []; },
    (value) => { delete value.versions[0].organization_id; }
  ]) {
    mismatched = { current_plan: { ...plan }, head_revision: 1, versions: [{ ...plan }],
      preflight: { current_run: null, current_result: null, history: [] },
      review: { current_review: null, history: [], gate: { can_submit: false, can_decide: false, reasons: [] } } };
    mutate(mismatched);
    await assert.rejects(read(), { code: "OPERATOR_WORKSPACE_NOT_FOUND" });
  }
});

test("fails visible when VideoPlan truth cannot be read and never retains a plan action", async () => {
  const revision = {
    id: "revision-a", organization_id: "org-a", project_id: "project-a", product_id: "product-a", status: "ready",
    product_name: "商品", asset_version_ids: ["image"], selling_points: [{ text: "卖点", confirmed: true }]
  };
  const service = createOperatorWorkspaceService({
    projectContentService: { async getProject() { return { id: "project-a", products: [{ id: "product-a", current_revision_id: revision.id, revision }] }; } },
    videoPlanningService: { async getWorkspace() { throw Object.assign(new Error("read failed"), { secret: "must-not-leak" }); } },
    productionService: { async getWorkspace() { throw new Error("Production must remain unread"); } }
  });

  await assert.rejects(service.getWorkspace({ organizationId: "org-a", actorMemberId: "member-a", actorRole: "admin",
    projectId: "project-a", productId: "product-a", stage: "video_plan" }), { code: "OPERATOR_WORKSPACE_UNAVAILABLE" });

  const productStage = await service.getWorkspace({ organizationId: "org-a", actorMemberId: "member-a", actorRole: "admin",
    projectId: "project-a", productId: "product-a", stage: "product_content" });
  assert.deepEqual(productStage.stages[3], {
    code: "video_plan", implementation_status: "workspace", read_status: "error", navigation_state: null,
    business_status: null, blocker_codes: [], current_object: null
  });
  assert.equal(productStage.recommended_action.stage, "product_content");
});
