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
    avatarService: { async getWorkspace() { downstreamReads.avatar += 1; } },
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
