import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { activateAdmin, identityApp, identityHeaders } from "./helpers/identity-world.js";
import { createMemoryWorkDeliveryRepository } from "../src/work-delivery/memory-work-delivery-repository.js";
import { createWorkDeliveryService } from "../src/work-delivery/work-delivery-service.js";

function serviceDouble() {
  const calls = [];
  const downloadBody = Buffer.from("fake-video");
  const downloadChecksum = createHash("sha256").update(downloadBody).digest("hex");
  const work = { id: "work-api", status: "available", delivery_status: "pending_review", current_inspection: { id: "inspection-api", status: "pending", revision: 1 }, inspection_history: [], deliveries: [], delivery_count: 0 };
  const service = {
    calls,
    async listWorks(input) { calls.push({ method: "listWorks", input }); return [work]; },
    async listWorksPage(input) { calls.push({ method: "listWorksPage", input }); return {
      works: [work], pagination: { page: 1, page_size: 6, total_items: 1, total_pages: 1 }, selected_work_id: input.anchorWorkId === work.id ? work.id : null
    }; },
    async getWork(input) { calls.push({ method: "getWork", input }); return work; },
    async markDeliverable(input) { calls.push({ method: "markDeliverable", input }); return { inspection: { id: "inspection-passed", status: "passed" }, work, replayed: false }; },
    async requestRework(input) { calls.push({ method: "requestRework", input }); return { inspection: { id: "inspection-rework", status: "rework_required" }, work, replayed: false }; },
    async createDelivery(input) { calls.push({ method: "createDelivery", input }); return { delivery: { id: "delivery-api" }, work, replayed: false }; },
    async createDownloadAuthorization(input) { calls.push({ method: "download", input }); return {
      token: "short-token", expires_at: "2026-08-09T02:00:00.000Z", original_filename: "成品视频.mp4",
      verified_content_type: "video/mp4", verified_size: downloadBody.length, verified_checksum_sha256: downloadChecksum
    }; },
    async downloadObject(input) { calls.push({ method: "downloadObject", input }); return {
      body: downloadBody, original_filename: "成品视频.mp4", verified_content_type: "video/mp4",
      verified_size: downloadBody.length, verified_checksum_sha256: downloadChecksum
    }; }
  };
  return service;
}

test("works routes are unavailable by default and enabled routes pass only server identity", async (t) => {
  const disabled = await identityApp(t);
  const disabledAuth = await activateAdmin(disabled.app);
  const disabledResponse = await disabled.app.inject({ method: "GET", url: "/api/works", headers: identityHeaders({ cookies: disabledAuth.cookies }) });
  assert.equal(disabledResponse.statusCode, 404);
  const disabledPage = await disabled.app.inject({ method: "GET", url: "/works.html", headers: identityHeaders({ cookies: disabledAuth.cookies }) });
  assert.equal(disabledPage.statusCode, 200);
  assert.equal(disabledPage.body.includes("作品库暂未开放"), true);
  assert.equal(disabledPage.body.includes('data-feature="works"'), false);

  const service = serviceDouble();
  const enabled = await identityApp(t, { workDelivery: { enabled: true, service, worker: { autoStart: false } } });
  const auth = await activateAdmin(enabled.app);
  const read = identityHeaders({ cookies: auth.cookies });
  const mutation = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  assert.equal((await enabled.app.inject({ method: "GET", url: "/api/runtime", headers: read })).json().worksEnabled, true);

  const list = await enabled.app.inject({ method: "GET", url: "/api/works?deliveryStatus=pending_review", headers: read });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().works[0].id, "work-api");
  assert.equal(service.calls[0].input.organizationId, "org_test");

  const page = await enabled.app.inject({ method: "GET", url: "/api/works?page=1&pageSize=6&projectId=project-a&deliveryStatus=pending_review&anchorWorkId=work-api", headers: read });
  assert.equal(page.statusCode, 200);
  assert.deepEqual(page.json().pagination, { page: 1, page_size: 6, total_items: 1, total_pages: 1 });
  assert.equal(page.json().selected_work_id, "work-api");
  assert.equal(service.calls.at(-1).method, "listWorksPage");
  assert.deepEqual({
    page: service.calls.at(-1).input.page,
    pageSize: service.calls.at(-1).input.pageSize,
    projectId: service.calls.at(-1).input.projectId,
    deliveryStatus: service.calls.at(-1).input.deliveryStatus,
    anchorWorkId: service.calls.at(-1).input.anchorWorkId
  }, { page: "1", pageSize: "6", projectId: "project-a", deliveryStatus: "pending_review", anchorWorkId: "work-api" });

  const missingPrecondition = await enabled.app.inject({ method: "POST", url: "/api/works/work-api/inspections/pass",
    headers: { ...mutation, "idempotency-key": "missing-precondition-api" }, payload: {} });
  assert.equal(missingPrecondition.statusCode, 400);
  assert.equal(missingPrecondition.json().error, "WORK_DELIVERY_INSPECTION_PRECONDITION_REQUIRED");
  const invalidPrecondition = await enabled.app.inject({ method: "POST", url: "/api/works/work-api/inspections/pass",
    headers: { ...mutation, "idempotency-key": "invalid-precondition-api" }, payload: { expected_inspection_id: " ", expected_revision: 0 } });
  assert.equal(invalidPrecondition.statusCode, 400);
  assert.equal(invalidPrecondition.json().error, "WORK_DELIVERY_INSPECTION_PRECONDITION_REQUIRED");

  const passed = await enabled.app.inject({ method: "POST", url: "/api/works/work-api/inspections/pass",
    headers: { ...mutation, "idempotency-key": "pass-api" }, payload: { expected_inspection_id: "client-inspection", expected_revision: 1 } });
  assert.equal(passed.statusCode, 201);
  assert.equal(service.calls.at(-1).input.actorMemberId, auth.body.member.id);
  assert.equal("expectedInspectionId" in service.calls.at(-1).input, true);

  const rework = await enabled.app.inject({ method: "POST", url: "/api/works/work-api/inspections/rework",
    headers: { ...mutation, "idempotency-key": "rework-api" }, payload: { category: "visual_quality", reason: "需要返工", target_upstream_stage: "video_plan", expected_inspection_id: "client-inspection", expected_revision: 1 } });
  assert.equal(rework.statusCode, 201);
  assert.equal(service.calls.at(-1).input.targetUpstreamStage, "video_plan");

  const delivery = await enabled.app.inject({ method: "POST", url: "/api/works/work-api/deliveries",
    headers: { ...mutation, "idempotency-key": "delivery-api" }, payload: { delivery_method: "email", note: "发送", expected_inspection_id: "client-inspection", expected_revision: 1 } });
  assert.equal(delivery.statusCode, 201);
  assert.equal(service.calls.at(-1).input.deliveryMethod, "email");

  const download = await enabled.app.inject({ method: "POST", url: "/api/works/work-api/download-authorizations", headers: mutation, payload: {} });
  assert.equal(download.statusCode, 201);
  assert.equal(download.json().download.url, "/api/works/work-api/downloads/short-token");
  assert.equal(download.json().download.expires_at, "2026-08-09T02:00:00.000Z");
  assert.deepEqual(download.json().download, {
    url: "/api/works/work-api/downloads/short-token",
    expires_at: "2026-08-09T02:00:00.000Z",
    filename: "成品视频.mp4",
    media_type: "video/mp4",
    size: 10,
    checksum_sha256: createHash("sha256").update("fake-video").digest("hex")
  });
  const downloaded = await enabled.app.inject({ method: "GET", url: "/api/works/work-api/downloads/short-token", headers: read });
  assert.equal(downloaded.statusCode, 200);
  assert.equal(downloaded.headers["content-type"].startsWith("video/mp4"), true);
  assert.match(downloaded.headers["content-disposition"], /^attachment; filename="download"; filename\*=UTF-8''/);
  assert.match(downloaded.headers["content-disposition"], /%E6%88%90%E5%93%81%E8%A7%86%E9%A2%91\.mp4$/);
  assert.equal(createHash("sha256").update(downloaded.rawPayload).digest("hex"), download.json().download.checksum_sha256);
});

test("works download content disposition cannot inject headers through a verified filename", async (t) => {
  const service = serviceDouble();
  service.downloadObject = async () => ({
    body: Buffer.from("safe"), original_filename: "季度\r\nX-Injected: yes\\\"'()*.mp4",
    verified_content_type: "video/mp4", verified_size: 4,
    verified_checksum_sha256: createHash("sha256").update("safe").digest("hex")
  });
  const enabled = await identityApp(t, { workDelivery: { enabled: true, service, worker: { autoStart: false } } });
  const auth = await activateAdmin(enabled.app);
  const response = await enabled.app.inject({ method: "GET", url: "/api/works/work-api/downloads/short-token",
    headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-injected"], undefined);
  assert.equal(/[\r\n]/.test(response.headers["content-disposition"]), false);
  assert.match(response.headers["content-disposition"], /filename="download"/);
  assert.match(response.headers["content-disposition"], /filename\*=UTF-8''%E5%AD%A3%E5%BA%A6X-Injected%3A%20yes_%22%27%28%29%2A\.mp4$/);
});

test("a work download URL cannot consume another work's authorization token", async (t) => {
  const body = Buffer.from("exact-work-download");
  const checksum = createHash("sha256").update(body).digest("hex");
  const works = ["a", "b"].map((suffix) => ({ id: `work-download-${suffix}`, organization_id: "org_test",
    production_order_id: `order-download-${suffix}`, product_id: `product-download-${suffix}`, status: "available",
    primary_asset_version_id: `asset-download-${suffix}`, primary_output_media_type: "video/mp4",
    primary_output_size: body.length, primary_output_checksum: checksum,
    created_at: "2026-08-09T00:00:00.000Z", updated_at: "2026-08-09T00:00:00.000Z" }));
  let downloadCalls = 0;
  const service = createWorkDeliveryService({
    repository: createMemoryWorkDeliveryRepository(),
    workPort: {
      async listWorks() { return works.map((work) => structuredClone(work)); },
      async getWork(organizationId, workId) {
        return structuredClone(works.find((work) => work.organization_id === organizationId && work.id === workId) || null);
      }
    },
    assetPort: {
      async createDownloadAuthorization({ assetVersionId }) {
        return { token: `token-${assetVersionId}`, expires_at: "2026-08-09T02:00:00.000Z", asset_version_id: assetVersionId,
          original_filename: "video.mp4", verified_content_type: "video/mp4", verified_size: body.length,
          verified_checksum_sha256: checksum };
      },
      async downloadObject() {
        downloadCalls += 1;
        return { body, original_filename: "video.mp4", verified_content_type: "video/mp4",
          verified_size: body.length, verified_checksum_sha256: checksum };
      }
    },
    now: () => Date.parse("2026-08-09T01:00:00.000Z")
  });
  const enabled = await identityApp(t, { workDelivery: { enabled: true, service } });
  const auth = await activateAdmin(enabled.app);
  const read = identityHeaders({ cookies: auth.cookies });
  const mutation = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const authorization = await enabled.app.inject({ method: "POST", url: "/api/works/work-download-a/download-authorizations",
    headers: mutation, payload: {} });
  assert.equal(authorization.statusCode, 201);
  const token = authorization.json().download.url.split("/").at(-1);

  const crossed = await enabled.app.inject({ method: "GET", url: `/api/works/work-download-b/downloads/${token}`, headers: read });
  assert.equal(crossed.statusCode, 404);
  assert.equal(crossed.json().error, "DOWNLOAD_AUTHORIZATION_NOT_FOUND");
  assert.equal(downloadCalls, 0);
  const exact = await enabled.app.inject({ method: "GET", url: `/api/works/work-download-a/downloads/${token}`, headers: read });
  assert.equal(exact.statusCode, 200);
  assert.equal(downloadCalls, 1);
});

test("works routes keep validation and conflict errors distinguishable", async (t) => {
  const service = serviceDouble();
  service.requestRework = async () => { throw Object.assign(new Error("WORK_DELIVERY_REWORK_REASON_REQUIRED"), { code: "WORK_DELIVERY_REWORK_REASON_REQUIRED" }); };
  const enabled = await identityApp(t, { workDelivery: { enabled: true, service, worker: { autoStart: false } } });
  const auth = await activateAdmin(enabled.app);
  const mutation = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const response = await enabled.app.inject({ method: "POST", url: "/api/works/work-api/inspections/rework",
    headers: { ...mutation, "idempotency-key": "rework-invalid" }, payload: { category: "visual_quality", target_upstream_stage: "video_plan", expected_inspection_id: "client-inspection", expected_revision: 1 } });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "WORK_DELIVERY_REWORK_REASON_REQUIRED");
});

test("works API enforces stale inspection preconditions and replays the same command", async (t) => {
  const work = { id: "work-api-real", organization_id: "org_test", status: "available", production_order_id: "order-api-real",
    primary_output_media_type: "video/mp4", primary_output_size: 42 };
  const workPort = {
    async listWorks(organizationId) { return organizationId === work.organization_id ? [structuredClone(work)] : []; },
    async getWork(organizationId, workId) { return organizationId === work.organization_id && workId === work.id ? structuredClone(work) : null; }
  };
  const service = createWorkDeliveryService({ repository: createMemoryWorkDeliveryRepository(), workPort, now: () => Date.parse("2026-08-09T01:00:00.000Z") });
  const enabled = await identityApp(t, { workDelivery: { enabled: true, service } });
  const auth = await activateAdmin(enabled.app);
  const read = identityHeaders({ cookies: auth.cookies });
  const mutation = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const list = await enabled.app.inject({ method: "GET", url: "/api/works", headers: read });
  const pending = list.json().works[0].current_inspection;
  const payload = { idempotency_key: "api-replay", expected_inspection_id: pending.id, expected_revision: pending.revision };
  const first = await enabled.app.inject({ method: "POST", url: "/api/works/work-api-real/inspections/pass", headers: { ...mutation, "idempotency-key": payload.idempotency_key }, payload });
  assert.equal(first.statusCode, 201);
  const replay = await enabled.app.inject({ method: "POST", url: "/api/works/work-api-real/inspections/pass", headers: { ...mutation, "idempotency-key": payload.idempotency_key }, payload });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().replayed, true);
  const passed = first.json().inspection;
  const rework = await enabled.app.inject({ method: "POST", url: "/api/works/work-api-real/inspections/rework", headers: { ...mutation, "idempotency-key": "api-rework" },
    payload: { category: "visual_quality", reason: "需要上游重新制作", target_upstream_stage: "video_plan", expected_inspection_id: passed.id, expected_revision: passed.revision } });
  assert.equal(rework.statusCode, 201);
  const blockedPass = await enabled.app.inject({ method: "POST", url: "/api/works/work-api-real/inspections/pass", headers: { ...mutation, "idempotency-key": "api-pass-after-rework" },
    payload: { expected_inspection_id: rework.json().inspection.id, expected_revision: rework.json().inspection.revision } });
  assert.equal(blockedPass.statusCode, 422);
  assert.equal(blockedPass.json().error, "WORK_DELIVERY_REWORK_BLOCKED");
  const unchanged = await enabled.app.inject({ method: "GET", url: "/api/works/work-api-real", headers: read });
  assert.equal(unchanged.json().work.current_inspection.status, "rework_required");
  assert.equal(unchanged.json().work.inspection_history.length, 3);
  const stale = await enabled.app.inject({ method: "POST", url: "/api/works/work-api-real/inspections/rework", headers: { ...mutation, "idempotency-key": "api-stale" },
    payload: { category: "visual_quality", reason: "过期检查", target_upstream_stage: "video_plan", expected_inspection_id: pending.id, expected_revision: pending.revision } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error, "WORK_DELIVERY_INSPECTION_CONFLICT");

  for (const url of [
    "/api/works?page=0&pageSize=6",
    "/api/works?page=1&pageSize=5",
    "/api/works?page=1&pageSize=6&deliveryStatus=surprise"
  ]) {
    const invalid = await enabled.app.inject({ method: "GET", url, headers: read });
    assert.equal(invalid.statusCode, 400, url);
    assert.equal(["WORK_DELIVERY_PAGINATION_INVALID", "WORK_DELIVERY_FILTER_INVALID"].includes(invalid.json().error), true, url);
  }
});
