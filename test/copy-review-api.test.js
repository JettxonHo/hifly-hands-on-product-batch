import assert from "node:assert/strict";
import test from "node:test";

import { createControlledCopyProvider } from "../src/copy-generation/controlled-provider.js";
import { createMemoryCopyGenerationRepository } from "../src/copy-generation/memory-copy-generation-repository.js";
import { createMemoryCopyQualityRepository } from "../src/copy-quality/memory-copy-quality-repository.js";
import { createMemoryCopyReviewRepository } from "../src/copy-review/memory-copy-review-repository.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { activateAdmin, identityApp, identityHeaders, login } from "./helpers/identity-world.js";

const assetReferencePort = { async bindAvailableVersion(input) { return { reference: input }; } };

async function seedPassedCopy(app, auth, suffix = "") {
  const tag = suffix ? `-${suffix}` : "";
  const headers = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const project = (await app.inject({ method: "POST", url: "/api/projects", headers: { ...headers, "idempotency-key": `review-project${tag}` }, payload: { name: `审核项目${tag}` } })).json().project;
  const created = (await app.inject({ method: "POST", url: `/api/projects/${project.id}/products`, headers: { ...headers, "idempotency-key": `review-product${tag}` }, payload: { product_name: "云朵抱枕" } })).json();
  let revision = (await app.inject({ method: "PATCH", url: `/api/product-revisions/${created.revision.id}`, headers,
    payload: { expected_revision: 1, product_name: "云朵抱枕", selling_points: [{ text: "柔软亲肤" }], asset_version_ids: ["asset-1"] } })).json().revision;
  revision = (await app.inject({ method: "POST", url: `/api/product-revisions/${revision.id}/selling-points/${revision.selling_points[0].id}/confirm`, headers,
    payload: { expected_revision: revision.revision_number } })).json().revision;
  revision = (await app.inject({ method: "POST", url: `/api/product-revisions/${revision.id}/ready`, headers: { ...headers, "idempotency-key": `review-ready${tag}` },
    payload: { expected_revision: revision.revision_number } })).json().revision;
  await app.inject({ method: "POST", url: `/api/product-revisions/${revision.id}/copy-generations`, headers: { ...headers, "idempotency-key": `review-generate${tag}` }, payload: { intent: "product_recommendation" } });
  await app.copyGeneration.worker.runNext();
  const copy = (await app.inject({ method: "GET", url: `/api/product-revisions/${revision.id}/copy-versions`, headers: identityHeaders({ cookies: auth.cookies }) })).json().copy_versions[0];
  const started = await app.inject({ method: "POST", url: `/api/copy-versions/${copy.id}/quality-runs`, headers: { ...headers, "idempotency-key": `review-qc${tag}` }, payload: { expected_revision: copy.row_version } });
  await app.copyQuality.worker.runNext();
  return { copy: started.json().copy_version, revision, headers };
}

async function approveSeed(app, actor, seeded, suffix) {
  const submitted = await app.copyReview.service.submitReview({ ...actor, copyVersionId: seeded.copy.id,
    idempotencyKey: `coord-submit-${suffix}` });
  return app.copyReview.service.approveReview({ ...actor, actorRole: "admin",
    reviewId: submitted.current_review.id, expectedRevision: 1, idempotencyKey: `coord-approve-${suffix}` });
}

test("copy review API separates member submission from admin decisions and restores history", async (t) => {
  const reviewRepository = createMemoryCopyReviewRepository();
  const { app, repository: identityRepository } = await identityApp(t, {
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort },
    copyGeneration: { enabled: true, repository: createMemoryCopyGenerationRepository(), provider: createControlledCopyProvider(), worker: { autoStart: false } },
    copyQuality: { enabled: true, repository: createMemoryCopyQualityRepository(), worker: { autoStart: false } },
    copyReview: { enabled: true, repository: reviewRepository }
  });
  const admin = await activateAdmin(app);
  const seeded = await seedPassedCopy(app, admin);

  const memberCreated = (await app.inject({ method: "POST", url: "/api/identity/members", headers: seeded.headers,
    payload: { email: "reviewer-member@example.test", display_name: "Review Member", role: "member" } })).json();
  const member = await login(app, { email: "reviewer-member@example.test", password: memberCreated.temporary_password });
  await app.inject({ method: "POST", url: "/api/auth/change-password", headers: identityHeaders({ cookies: member.cookies, csrf: member.csrf, mutation: true }),
    payload: { new_password: "Member-Permanent-Password-9!" } });
  const memberMutation = identityHeaders({ cookies: member.cookies, csrf: member.csrf, mutation: true });

  assert.equal((await app.inject({ method: "GET", url: `/api/copy-versions/${seeded.copy.id}/review`, headers: identityHeaders() })).statusCode, 401);
  const submitted = await app.inject({ method: "POST", url: `/api/copy-versions/${seeded.copy.id}/reviews`,
    headers: { ...memberMutation, "idempotency-key": "api-submit" }, payload: {} });
  assert.equal(submitted.statusCode, 201);
  assert.equal(submitted.json().current_review.status, "pending");
  assert.equal("organization_id" in submitted.json().current_review, false);

  const forbidden = await app.inject({ method: "POST", url: `/api/copy-reviews/${submitted.json().current_review.id}/approve`,
    headers: { ...memberMutation, "idempotency-key": "api-member-approve" }, payload: { expected_revision: 1 } });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.json().error, "COPY_REVIEW_FORBIDDEN");

  const approved = await app.inject({ method: "POST", url: `/api/copy-reviews/${submitted.json().current_review.id}/approve`,
    headers: { ...seeded.headers, "idempotency-key": "api-admin-approve" }, payload: { expected_revision: 1 } });
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.json().current_review.status, "approved");
  assert.equal(approved.json().current_review.review_mode, "standard");

  const restored = await app.inject({ method: "GET", url: `/api/copy-versions/${seeded.copy.id}/review`,
    headers: identityHeaders({ cookies: member.cookies }) });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().current_review.status, "approved");
  assert.deepEqual(restored.json().history.map((event) => event.to_status), ["pending", "approved"]);
  assert.ok((await reviewRepository.listAuditEvents()).some((event) => event.event_type === "copy.review_approved"));

  await seedInitialAdmin(identityRepository, { organizationId: "org_review_other", organizationName: "Other Review",
    adminEmail: "review-other@example.test", adminDisplayName: "Other Admin", adminTempPassword: "Temporary-Other-9!" });
  const other = await login(app, { email: "review-other@example.test", password: "Temporary-Other-9!" });
  await app.inject({ method: "POST", url: "/api/auth/change-password",
    headers: identityHeaders({ cookies: other.cookies, csrf: other.csrf, mutation: true }), payload: { new_password: "Other-Permanent-Password-9!" } });
  const crossOrg = await app.inject({ method: "GET", url: `/api/copy-versions/${seeded.copy.id}/review`,
    headers: identityHeaders({ cookies: other.cookies }) });
  assert.equal(crossOrg.statusCode, 404);
  assert.equal(crossOrg.json().error, "COPY_VERSION_NOT_FOUND");
});

test("upstream commands proactively append review invalidation without a review read", async (t) => {
  const reviewRepository = createMemoryCopyReviewRepository();
  const { app } = await identityApp(t, {
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort },
    copyGeneration: { enabled: true, repository: createMemoryCopyGenerationRepository(), provider: createControlledCopyProvider(), worker: { autoStart: false } },
    copyQuality: { enabled: true, repository: createMemoryCopyQualityRepository(), worker: { autoStart: false } },
    copyReview: { enabled: true, repository: reviewRepository }
  });
  const auth = await activateAdmin(app);
  const actor = { organizationId: "org_test", actorMemberId: auth.body.member.id };

  const qualitySeed = await seedPassedCopy(app, auth, "quality");
  const qualityApproval = await approveSeed(app, actor, qualitySeed, "quality");
  await app.copyQuality.service.startQualityCheck({ ...actor, copyVersionId: qualitySeed.copy.id,
    expectedRevision: qualitySeed.copy.row_version, idempotencyKey: "coord-new-quality" });
  await app.copyQuality.worker.runNext();
  assert.equal((await reviewRepository.getReview("org_test", qualityApproval.current_review.id)).status, "approved");
  assert.equal((await reviewRepository.listReviews("org_test", qualitySeed.copy.id)).length, 1,
    "quality start must not auto-create a child review");

  const copySeed = await seedPassedCopy(app, auth, "copy");
  const copyApproval = await approveSeed(app, actor, copySeed, "copy");
  const childCopy = await app.copyGeneration.service.editCopyVersion({ ...actor, copyVersionId: copySeed.copy.id,
    expectedRevision: copySeed.copy.row_version, body: `${copySeed.copy.body}\n补充一句`, idempotencyKey: "coord-edit-copy" });
  await app.copyGeneration.service.freezeCopyVersion({ ...actor, copyVersionId: childCopy.id,
    expectedRevision: childCopy.row_version, idempotencyKey: "coord-freeze-copy" });
  assert.equal((await reviewRepository.getReview("org_test", copyApproval.current_review.id)).status, "revoked");

  const revisionSeed = await seedPassedCopy(app, auth, "revision");
  const revisionApproval = await approveSeed(app, actor, revisionSeed, "revision");
  await app.projectContent.service.saveRevision({ ...actor, productRevisionId: revisionSeed.revision.id,
    expectedRevision: revisionSeed.revision.revision_number, productName: revisionSeed.revision.product_name,
    productDescription: "新的商品事实", sellingPoints: revisionSeed.revision.selling_points,
    assetVersionIds: revisionSeed.revision.asset_version_ids });
  assert.equal((await reviewRepository.getReview("org_test", revisionApproval.current_review.id)).status, "revoked");
});
