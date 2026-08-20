import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMemoryAppearanceFidelityRepository } from "../src/appearance-fidelity/memory-appearance-fidelity-repository.js";
import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createMemoryAvatarSelectionRepository } from "../src/avatar-selection/memory-avatar-selection-repository.js";
import { createControlledCopyProvider } from "../src/copy-generation/controlled-provider.js";
import { createMemoryCopyGenerationRepository } from "../src/copy-generation/memory-copy-generation-repository.js";
import { createMemoryCopyQualityRepository } from "../src/copy-quality/memory-copy-quality-repository.js";
import { createMemoryCopyReviewRepository } from "../src/copy-review/memory-copy-review-repository.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { buildApp } from "../src/server/app.js";
import { registerAppearanceFidelityRoutes } from "../src/server/routes/appearance-fidelity.js";
import { createMemoryVideoPlanningRepository } from "../src/video-planning/memory-video-planning-repository.js";
import { activateAdmin, identityApp, identityHeaders, seededRepository, IDENTITY_HOST, IDENTITY_ORIGIN } from "./helpers/identity-world.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

const REQUEST = {
  id: "capture-request-1",
  status: "awaiting_authorization",
  row_version: 1,
  max_candidate_generations: 1,
  product_id: "product-1",
  product_revision_id: "revision-1",
  source_asset_version_id: "source-version-1",
  copy_version_id: "copy-version-1",
  copy_review_id: "copy-review-1",
  avatar_selection_id: "avatar-selection-1",
  avatar_asset_version_id: "avatar-version-1",
  video_plan_version_id: "plan-version-1",
  plan_review_id: "plan-review-1",
  preflight_result_id: "preflight-1",
  presentation_size_code: "small",
  requested_by_member_id: "member-requester",
  created_at: "2026-08-20T08:00:00.000Z",
  updated_at: "2026-08-20T08:00:00.000Z",
  status_history: [{ status: "awaiting_authorization", row_version: 1, at: "2026-08-20T08:00:00.000Z", private: "omit" }],
  organization_id: "private-org",
  idempotency_key: "private-key",
  private_field: "omit",
};

function serviceFor(calls) {
  const result = () => structuredClone(REQUEST);
  return {
    async createCaptureRequest(input) {
      calls.push(["create", input]);
      return { capture_request: result(), replayed: false, private_field: "omit" };
    },
    async listCaptureRequests(input) {
      calls.push(["list", input]);
      return { capture_requests: [result()], next_cursor: "next-capture", private_field: "omit" };
    },
    async getCaptureRequest(input) {
      calls.push(["exact", input]);
      return { capture_request: result(), private_field: "omit" };
    },
  };
}

function publicRequest() {
  const { organization_id: _organizationId, idempotency_key: _idempotencyKey, private_field: _privateField,
    status_history, ...request } = structuredClone(REQUEST);
  return { ...request, status_history: status_history.map(({ status, row_version, at }) => ({ status, row_version, at })) };
}

test("public capture request routes enforce identity and isolate the documented organization-safe envelope", async (t) => {
  const calls = [];
  const { app } = await identityApp(t);
  await app.register(registerAppearanceFidelityRoutes, { service: serviceFor(calls) });
  const auth = await activateAdmin(app);

  const anonymous = await app.inject({
    method: "GET",
    url: "/api/products/product-1/appearance-capture-requests",
    headers: identityHeaders(),
  });
  assert.equal(anonymous.statusCode, 401);

  const headers = {
    ...identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true }),
    "idempotency-key": "capture-public-1",
  };
  const created = await app.inject({
    method: "POST",
    url: "/api/products/product-1/appearance-capture-requests",
    headers,
    payload: {
      product_revision_id: "revision-1",
      source_asset_version_id: "source-version-1",
      copy_version_id: "copy-version-1",
      avatar_selection_id: "avatar-selection-1",
      video_plan_version_id: "plan-version-1",
      expected_workspace_revision: 12,
      organization_id: "forged-org",
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.deepEqual(created.json(), { capture_request: publicRequest(), replayed: false });
  assert.equal("organization_id" in created.json().capture_request, false);
  assert.equal("private_field" in created.json(), false);

  const listed = await app.inject({
    method: "GET",
    url: "/api/products/product-1/appearance-capture-requests?status=queued&limit=7&cursor=opaque%20cursor",
    headers: identityHeaders({ cookies: auth.cookies }),
  });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json(), { capture_requests: [publicRequest()], next_cursor: "next-capture" });

  const exact = await app.inject({
    method: "GET",
    url: "/api/appearance-capture-requests/capture-request-1",
    headers: identityHeaders({ cookies: auth.cookies }),
  });
  assert.equal(exact.statusCode, 200);
  assert.deepEqual(exact.json(), { capture_request: publicRequest() });

  const actorMemberId = auth.body.member.id;
  assert.deepEqual(calls, [
    ["create", {
      organizationId: "org_test",
      actorMemberId,
      productId: "product-1",
      productRevisionId: "revision-1",
      sourceAssetVersionId: "source-version-1",
      copyVersionId: "copy-version-1",
      avatarSelectionId: "avatar-selection-1",
      videoPlanVersionId: "plan-version-1",
      expectedWorkspaceRevision: 12,
      idempotencyKey: "capture-public-1",
    }],
    ["list", {
      organizationId: "org_test",
      actorMemberId,
      productId: "product-1",
      status: "queued",
      limit: "7",
      cursor: "opaque cursor",
    }],
    ["exact", { organizationId: "org_test", actorMemberId, requestId: "capture-request-1" }],
  ]);
});

test("Fidelity-B command, candidate, and download routes preserve role, CSRF, and private-data boundaries", async (t) => {
  const calls = [];
  const candidate = {
    id: "candidate-1",
    capture_request_id: REQUEST.id,
    product_id: REQUEST.product_id,
    product_revision_id: REQUEST.product_revision_id,
    source_asset_version_id: REQUEST.source_asset_version_id,
    candidate_asset_version_id: "candidate-version-1",
    media_type: "image/png",
    size: 4,
    checksum_sha256: "a".repeat(64),
    provider: "hifly",
    created_at: REQUEST.created_at,
    provider_reference: { private: true },
    reference_fingerprint: "private-fingerprint",
    object_key: "private/object-key",
  };
  const service = {
    async authorizeCaptureRequest(input) { calls.push(["authorize", input]); return { capture_request: { ...REQUEST, status: "queued", row_version: 2 }, replayed: false }; },
    async cancelCaptureRequest(input) { calls.push(["cancel", input]); return { capture_request: { ...REQUEST, status: "cancelled", row_version: 2 }, replayed: false }; },
    async listCandidates(input) { calls.push(["candidate-list", input]); return { candidates: [candidate], next_cursor: null }; },
    async getCandidate(input) {
      calls.push(["candidate-exact", input]);
      return {
        candidate,
        candidate_state: { candidate_id: candidate.id, state: "available", row_version: 1, reason_code: null, observed_at: REQUEST.created_at, updated_at: REQUEST.created_at, private: true },
        provider_reference_status: { id: "observation-1", candidate_id: candidate.id, status: "available", observed_at: REQUEST.created_at, valid_until: REQUEST.created_at, expired: true, reason_code: null, method: "private", reference_fingerprint: "private" },
      };
    },
    async createCandidateDownloadAuthorization(input) {
      calls.push(["download-authorize", input]);
      return { token: "download-token-1", expires_at: "2026-08-20T08:05:00.000Z", filename: "候选\r\nInjected: yes.png", media_type: "image/png", size: 4, checksum_sha256: "a".repeat(64) };
    },
    async downloadCandidateObject(input) {
      calls.push(["download", input]);
      return { body: Buffer.from([0x89, 0x50, 0x4e, 0x47]), filename: "候选\r\nInjected: yes.png", media_type: "image/png", size: 4, checksum_sha256: "a".repeat(64) };
    },
  };
  const { app } = await identityApp(t);
  await app.register(registerAppearanceFidelityRoutes, { service });
  const auth = await activateAdmin(app);
  const mutationHeaders = {
    ...identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true }),
    "idempotency-key": "appearance-command-1",
  };

  const noCsrf = await app.inject({
    method: "POST",
    url: `/api/appearance-capture-requests/${REQUEST.id}/authorize`,
    headers: { ...identityHeaders({ cookies: auth.cookies }), "content-type": "application/json", "idempotency-key": "blocked" },
    payload: { expected_revision: 1, max_candidate_generations: 1 },
  });
  assert.equal(noCsrf.statusCode, 403);

  const authorized = await app.inject({ method: "POST", url: `/api/appearance-capture-requests/${REQUEST.id}/authorize`, headers: mutationHeaders,
    payload: { expected_revision: 1, max_candidate_generations: 1 } });
  assert.equal(authorized.statusCode, 202, authorized.body);
  const cancelled = await app.inject({ method: "POST", url: `/api/appearance-capture-requests/${REQUEST.id}/cancel`, headers: mutationHeaders,
    payload: { expected_revision: 1 } });
  assert.equal(cancelled.statusCode, 200, cancelled.body);

  const listed = await app.inject({ method: "GET", url: `/api/products/${REQUEST.product_id}/appearance-candidates?state=available&limit=1`,
    headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(listed.statusCode, 200);
  assert.equal(JSON.stringify(listed.json()).includes("private"), false);
  const exact = await app.inject({ method: "GET", url: `/api/appearance-candidates/${candidate.id}`,
    headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(exact.statusCode, 200);
  assert.equal(JSON.stringify(exact.json()).includes("fingerprint"), false);
  assert.equal(JSON.stringify(exact.json()).includes("method"), false);

  const grant = await app.inject({ method: "POST", url: `/api/appearance-candidates/${candidate.id}/download-authorizations`,
    headers: identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true }), payload: {} });
  assert.equal(grant.statusCode, 201, grant.body);
  assert.equal(Object.hasOwn(grant.json().download, "token"), false);
  const downloaded = await app.inject({ method: "GET", url: grant.json().download.url,
    headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(downloaded.statusCode, 200);
  assert.equal(downloaded.headers["content-type"], "image/png");
  assert.equal(downloaded.headers["content-disposition"].includes("\r"), false);
  assert.equal(downloaded.headers["content-disposition"].includes("\n"), false);
  assert.match(downloaded.headers["content-disposition"], /filename\*=UTF-8''/);
  assert.deepEqual(downloaded.rawPayload, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  assert.equal(calls[0][1].actorRole, "admin");
  assert.equal(calls[1][1].actorRole, "admin");
  assert.equal(calls.every(([, input]) => input.organizationId === "org_test"), true);
});

test("default buildApp wiring reads a verified product image without a Provider call", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-appearance-build-app-"));
  const identityRepository = await seededRepository();
  const assetRepository = createMemoryAssetRepository();
  const objectStore = createMemoryObjectStore();
  const providerCalls = { generate: 0, observe: 0 };
  let sourceAssetVersionId;
  const upstream = {
    current_valid: true,
    workspace_revision: 12,
    product_id: "product-default-wiring",
    product_revision_id: "revision-default-wiring",
    source_asset_version_ids: [],
    copy_version_id: "copy-default-wiring",
    copy_review_id: "copy-review-default-wiring",
    avatar_selection_id: "avatar-selection-default-wiring",
    avatar_asset_version_id: "avatar-version-default-wiring",
    video_plan_version_id: "plan-default-wiring",
    plan_review_id: "plan-review-default-wiring",
    preflight_result_id: "preflight-default-wiring",
    presentation_size_code: "small",
  };
  const app = await buildApp({
    root,
    executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [IDENTITY_HOST], trustedOrigins: [IDENTITY_ORIGIN], cookieSecure: false, seed: { enabled: false } },
    assets: { enabled: true, repository: assetRepository, objectStore, worker: { autoStart: false } },
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository() },
    copyGeneration: { enabled: true, repository: createMemoryCopyGenerationRepository(), provider: createControlledCopyProvider(), worker: { autoStart: false } },
    copyQuality: { enabled: true, repository: createMemoryCopyQualityRepository(), worker: { autoStart: false } },
    copyReview: { enabled: true, repository: createMemoryCopyReviewRepository() },
    avatarSelection: { enabled: true, repository: createMemoryAvatarSelectionRepository() },
    videoPlanning: { enabled: true, repository: createMemoryVideoPlanningRepository(), worker: { autoStart: false }, agentReadinessPort: { async isOnline() { return false; } } },
    appearanceFidelity: {
      enabled: true,
      repository: createMemoryAppearanceFidelityRepository(),
      upstreamPort: { async resolveCurrent() { return { ...upstream, source_asset_version_ids: [sourceAssetVersionId] }; } },
      providerAdapter: {
        async generateCandidate() { providerCalls.generate += 1; throw new Error("PROVIDER_MUST_NOT_RUN"); },
        async observeReference() { providerCalls.observe += 1; throw new Error("PROVIDER_MUST_NOT_RUN"); },
      },
      worker: { autoStart: false },
    },
  });
  t.after(() => app.close());
  const auth = await activateAdmin(app);
  const source = await app.assets.service.createUploadAuthorization({
    organizationId: "org_test",
    actorMemberId: auth.body.member.id,
    idempotencyKey: "default-wiring-source",
    filename: "source.png",
    contentType: "image/png",
    size: PNG.length,
    checksumSha256: createHash("sha256").update(PNG).digest("hex"),
  });
  sourceAssetVersionId = source.asset_version.id;
  await app.assets.service.uploadObject({ organizationId: "org_test", uploadToken: source.upload.token, body: PNG, contentType: "image/png" });
  await app.assets.service.completeUpload({ organizationId: "org_test", actorMemberId: auth.body.member.id,
    uploadSessionId: source.upload_session_id, idempotencyKey: "default-wiring-source-complete" });
  await app.assets.service.runNextVerificationJob();

  const response = await app.inject({
    method: "POST",
    url: "/api/products/product-default-wiring/appearance-capture-requests",
    headers: {
      ...identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true }),
      "idempotency-key": "default-wiring-capture",
    },
    payload: {
      product_revision_id: upstream.product_revision_id,
      source_asset_version_id: sourceAssetVersionId,
      copy_version_id: upstream.copy_version_id,
      avatar_selection_id: upstream.avatar_selection_id,
      video_plan_version_id: upstream.video_plan_version_id,
      expected_workspace_revision: upstream.workspace_revision,
    },
  });

  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().capture_request.status, "awaiting_authorization");
  assert.equal(response.json().capture_request.source_asset_version_id, sourceAssetVersionId);
  assert.deepEqual(providerCalls, { generate: 0, observe: 0 });
});
