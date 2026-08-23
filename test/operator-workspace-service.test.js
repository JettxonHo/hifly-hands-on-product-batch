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
