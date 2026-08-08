import assert from "node:assert/strict";
import test from "node:test";

import { activateAdmin, identityApp, identityHeaders } from "./helpers/identity-world.js";

function serviceDouble() {
  const calls = [];
  const work = { id: "work-api", status: "available", delivery_status: "pending_review", current_inspection: { id: "inspection-api", status: "pending", revision: 1 }, inspection_history: [], deliveries: [], delivery_count: 0 };
  const service = {
    calls,
    async listWorks(input) { calls.push({ method: "listWorks", input }); return [work]; },
    async getWork(input) { calls.push({ method: "getWork", input }); return work; },
    async markDeliverable(input) { calls.push({ method: "markDeliverable", input }); return { inspection: { id: "inspection-passed", status: "passed" }, work, replayed: false }; },
    async requestRework(input) { calls.push({ method: "requestRework", input }); return { inspection: { id: "inspection-rework", status: "rework_required" }, work, replayed: false }; },
    async createDelivery(input) { calls.push({ method: "createDelivery", input }); return { delivery: { id: "delivery-api" }, work, replayed: false }; },
    async createDownloadAuthorization(input) { calls.push({ method: "download", input }); return { token: "short-token", expires_at: "2026-08-09T02:00:00.000Z" }; },
    async downloadObject(input) { calls.push({ method: "downloadObject", input }); return { body: Buffer.from("fake-video"), contentType: "video/mp4" }; }
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

  const passed = await enabled.app.inject({ method: "POST", url: "/api/works/work-api/inspections/pass",
    headers: { ...mutation, "idempotency-key": "pass-api" }, payload: { expected_inspection_id: "client-inspection" } });
  assert.equal(passed.statusCode, 201);
  assert.equal(service.calls.at(-1).input.actorMemberId, auth.body.member.id);
  assert.equal("expectedInspectionId" in service.calls.at(-1).input, true);

  const rework = await enabled.app.inject({ method: "POST", url: "/api/works/work-api/inspections/rework",
    headers: { ...mutation, "idempotency-key": "rework-api" }, payload: { category: "visual_quality", reason: "需要返工", target_upstream_stage: "video_plan" } });
  assert.equal(rework.statusCode, 201);
  assert.equal(service.calls.at(-1).input.targetUpstreamStage, "video_plan");

  const delivery = await enabled.app.inject({ method: "POST", url: "/api/works/work-api/deliveries",
    headers: { ...mutation, "idempotency-key": "delivery-api" }, payload: { delivery_method: "email", note: "发送" } });
  assert.equal(delivery.statusCode, 201);
  assert.equal(service.calls.at(-1).input.deliveryMethod, "email");

  const download = await enabled.app.inject({ method: "POST", url: "/api/works/work-api/download-authorizations", headers: mutation, payload: {} });
  assert.equal(download.statusCode, 201);
  assert.equal(download.json().download.url, "/api/works/work-api/downloads/short-token");
  const downloaded = await enabled.app.inject({ method: "GET", url: "/api/works/work-api/downloads/short-token", headers: read });
  assert.equal(downloaded.statusCode, 200);
  assert.equal(downloaded.headers["content-type"].startsWith("video/mp4"), true);
});

test("works routes keep validation and conflict errors distinguishable", async (t) => {
  const service = serviceDouble();
  service.requestRework = async () => { throw Object.assign(new Error("WORK_DELIVERY_REWORK_REASON_REQUIRED"), { code: "WORK_DELIVERY_REWORK_REASON_REQUIRED" }); };
  const enabled = await identityApp(t, { workDelivery: { enabled: true, service, worker: { autoStart: false } } });
  const auth = await activateAdmin(enabled.app);
  const mutation = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const response = await enabled.app.inject({ method: "POST", url: "/api/works/work-api/inspections/rework",
    headers: { ...mutation, "idempotency-key": "rework-invalid" }, payload: { category: "visual_quality", target_upstream_stage: "video_plan" } });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "WORK_DELIVERY_REWORK_REASON_REQUIRED");
});
