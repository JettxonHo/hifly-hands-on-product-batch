import assert from "node:assert/strict";
import test from "node:test";

import { activateAdmin, identityApp, identityHeaders } from "./helpers/identity-world.js";
import { registerAppearanceFidelityRoutes } from "../src/server/routes/appearance-fidelity.js";

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
