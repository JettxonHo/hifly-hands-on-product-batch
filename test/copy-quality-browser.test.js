import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

import { createAssetService } from "../src/assets/asset-service.js";
import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createControlledCopyProvider } from "../src/copy-generation/controlled-provider.js";
import { createMemoryCopyGenerationRepository } from "../src/copy-generation/memory-copy-generation-repository.js";
import { createControlledQualityEvaluator } from "../src/copy-quality/controlled-evaluator.js";
import { createMemoryCopyQualityRepository } from "../src/copy-quality/memory-copy-quality-repository.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD } from "./helpers/identity-world.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("copy quality workspace restores failures, resolves findings, rewrites, and remains usable at 390px", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-copy-quality-browser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(57600), host = `127.0.0.1:${port}`, origin = `http://${host}`;
  const organizationId = "org_quality_browser";
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, { organizationId, organizationName: "Quality Browser", adminEmail: ADMIN_EMAIL, adminDisplayName: "Quality Admin", adminTempPassword: ADMIN_TEMP_PASSWORD });
  const assetRepository = createMemoryAssetRepository(), objectStore = createMemoryObjectStore();
  const assetService = createAssetService({ repository: assetRepository, objectStore });
  const authorized = await assetService.createUploadAuthorization({ organizationId, actorMemberId: seeded.member.id, idempotencyKey: "quality-browser-asset", filename: "product.png", contentType: "image/png", size: PNG.length, checksumSha256: createHash("sha256").update(PNG).digest("hex") });
  await assetService.uploadObject({ organizationId, uploadToken: authorized.upload.token, body: PNG, contentType: "image/png" });
  await assetService.completeUpload({ organizationId, actorMemberId: seeded.member.id, uploadSessionId: authorized.upload_session_id, idempotencyKey: "quality-browser-complete" });
  await assetService.runNextVerificationJob();
  let evaluations = 0, produceStaleFinding = false;
  let qualityPolicy = { profileVersion: "commerce-cn-v1", ruleVersion: "rules-2026-08" };
  const evaluator = createControlledQualityEvaluator({ async evaluate() {
    evaluations += 1;
    if (produceStaleFinding) return { checks_complete: true, findings: [
      { code: "STALE_TONE_REVIEW", kind: "review", severity: "medium", title: "失效历史语气 Finding",
        matched_text: "体验最好", message: "请人工判断表达是否合适", evidence_reference: "copy:text:5-9",
        rule_source: "brand_policy", suggestion: "改为有事实依据的体验描述" }
    ] };
    if (evaluations === 1) throw Object.assign(new Error("controlled outage"), { code: "QUALITY_EVALUATOR_TEMPORARY_FAILURE" });
    if (evaluations === 2) return { checks_complete: true, findings: [
      { code: "TONE_REVIEW", kind: "review", severity: "medium", title: "语气待判断",
        matched_text: "全网最好", message: "请人工判断表达是否合适", evidence_reference: "copy:text:12-16",
        rule_source: "brand_policy", suggestion: "改为有事实依据的体验描述" },
      { code: "PRICE_REVIEW", kind: "review", severity: "high", title: "价格暗示",
        matched_text: "最低价", message: "请改写价格暗示", evidence_reference: "copy:text:20-23",
        rule_source: "platform_policy", suggestion: "删除无法验证的价格比较" }
    ] };
    return { checks_complete: true, findings: [] };
  } });
  const app = await buildApp({ root, executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } },
    assets: { enabled: true, repository: assetRepository, objectStore, worker: { autoStart: false } },
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort: assetService.assetReferencePort },
    copyGeneration: { enabled: true, repository: createMemoryCopyGenerationRepository(), provider: createControlledCopyProvider(), worker: { autoStart: false } },
    copyQuality: { enabled: true, repository: createMemoryCopyQualityRepository(), evaluator,
      profileResolver: { async resolve() { return { ...qualityPolicy }; } }, worker: { autoStart: false } }
  });
  const actor = { organizationId, actorMemberId: seeded.member.id };
  const project = await app.projectContent.service.createProject({ ...actor, idempotencyKey: "quality-browser-project", name: "质检项目" });
  const created = await app.projectContent.service.createProduct({ ...actor, projectId: project.id, idempotencyKey: "quality-browser-product", productName: "云朵抱枕" });
  let revision = await app.projectContent.service.saveRevision({ ...actor, productRevisionId: created.revision.id, expectedRevision: 1, productName: "云朵抱枕", sellingPoints: [{ text: "柔软亲肤" }], assetVersionIds: [authorized.asset_version.id] });
  revision = await app.projectContent.service.confirmSellingPoint({ ...actor, productRevisionId: revision.id, pointId: revision.selling_points[0].id, expectedRevision: revision.revision_number });
  revision = await app.projectContent.service.readyRevision({ ...actor, productRevisionId: revision.id, expectedRevision: revision.revision_number, idempotencyKey: "quality-browser-ready" });
  await app.copyGeneration.service.requestGeneration({ ...actor, productRevisionId: revision.id, intent: "product_recommendation", idempotencyKey: "quality-browser-copy" });
  await app.copyGeneration.worker.runNext();
  try { await app.listen({ host: "127.0.0.1", port }); } catch (error) { await app.close(); if (error.code === "EPERM") return t.skip("sandbox disallows local TCP listening"); throw error; }
  t.after(() => app.close());
  let browser;
  const systemChrome = process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  try { browser = await chromium.launch({ headless: true, executablePath: systemChrome }); } catch (error) { return t.skip(`system Chrome unavailable: ${error.message}`); }
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${origin}/login.html`); await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL); await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD); await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("Quality-Browser-Password-9!"); await page.getByRole("button", { name: "保存并进入工作台" }).click(); await page.waitForURL(`${origin}/`);
  await page.goto(`${origin}/copy.html?project=${project.id}&revision=${revision.id}`);
  await page.getByRole("button", { name: "开始质检" }).click();
  await page.getByText("质检中，可离开本页").waitFor();
  await app.copyQuality.worker.runNext();
  await page.getByText("质检未完成（技术原因）").waitFor();
  await page.getByRole("button", { name: "重新质检" }).click();
  await app.copyQuality.worker.runNext();
  await page.getByText("待人工判断（2 条）").waitFor();
  await page.getByText("命中文本：全网最好").waitFor();
  await page.getByText("规则来源：brand_policy").waitFor();
  await page.getByText("修复建议：改为有事实依据的体验描述").waitFor();
  await page.getByRole("button", { name: "接受并填写理由" }).first().click();
  const dialog = page.getByRole("dialog", { name: "接受 Finding" });
  await dialog.getByLabel("接受理由").fill("符合品牌自然分享语气");
  await dialog.getByRole("button", { name: "确认接受" }).click();
  await page.getByText("已接受（附理由）").waitFor();
  assert.equal(await page.getByRole("button", { name: "返回商品事实" }).count() > 0, true);
  assert.equal(await page.getByRole("button", { name: "人工修改" }).count() > 0, true);
  await page.getByRole("button", { name: "AI 改写" }).click();
  const rewriteDialog = page.getByRole("dialog", { name: "AI 改写文案" });
  await rewriteDialog.getByLabel("改写范围").selectOption("matched_text");
  await rewriteDialog.getByLabel("业务改写要求").fill("保留柔软亲肤卖点，改为可验证的体验表达");
  let rewriteRequests = 0;
  await page.route("**/api/copy-versions/*/rewrite-jobs", async (route) => {
    if (route.request().method() === "POST") {
      rewriteRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await route.continue();
  });
  await rewriteDialog.locator("form").evaluate((form) => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await assert.doesNotReject(() => rewriteDialog.getByRole("button", { name: "提交中…" }).waitFor());
  await page.getByText("AI 改写已排队，可离开或刷新页面。").waitFor();
  assert.equal(rewriteRequests, 1);
  await page.reload();
  await page.getByText(/AI 改写已排队|AI 正在改写/).waitFor();
  await app.copyQuality.rewriteWorker.runNext();
  await page.getByText("AI 改写已生成新版本，并已进入完整质检。").waitFor();
  await app.copyQuality.worker.runNext();
  await page.locator("#qualityConclusionText").getByText("质检通过", { exact: true }).waitFor();
  await page.getByText("尚未提交人工审核", { exact: true }).waitFor();
  await page.getByText("历史质检（1）").waitFor();
  await page.locator("#copyVersions").getByRole("button", { name: /v1.*已被替代/ }).click();
  await page.getByText("历史质检（2）").waitFor();
  await page.locator("#copyVersions").getByRole("button", { name: /v2.*已冻结/ }).click();
  await page.locator("#qualityConclusionText").getByText("质检通过", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /批准|提交审核/ }).count(), 0);
  produceStaleFinding = true;
  const latestCopy = (await app.copyGeneration.service.listCopyVersions({ ...actor,
    productRevisionId: revision.id })).find((value) => value.version_number === 2);
  await app.copyQuality.service.startQualityCheck({ ...actor, copyVersionId: latestCopy.id,
    expectedRevision: latestCopy.row_version, idempotencyKey: "quality-browser-stale-finding" });
  await app.copyQuality.worker.runNext();
  qualityPolicy = { profileVersion: "commerce-cn-v2", ruleVersion: "rules-2026-09" };
  await page.reload();
  await page.getByText("质检结论已失效：质检规则已更新，请重新完整质检。").waitFor();
  const staleFindings = page.locator("#findingList");
  await staleFindings.getByText("失效历史语气 Finding", { exact: true }).waitFor();
  assert.equal(await staleFindings.getByRole("button", {
    name: /接受并填写理由|返回商品事实|人工修改|AI 改写/
  }).count(), 0);
  qualityPolicy = { profileVersion: "commerce-cn-v1", ruleVersion: "rules-2026-08" };
  const currentDraft = await app.projectContent.service.saveRevision({ ...actor, productRevisionId: revision.id,
    expectedRevision: revision.revision_number, productName: "云朵抱枕待确认事实",
    sellingPoints: revision.selling_points, assetVersionIds: revision.asset_version_ids });
  assert.equal(currentDraft.status, "draft");
  await page.locator("#copyVersions").getByRole("button", { name: /v2.*已冻结/ }).click();
  await page.getByText("质检结论已失效：商品事实已有新版本，请重新确认后质检。").waitFor();
  if (process.env.A05_SCREENSHOT_DIR) {
    await mkdir(process.env.A05_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.A05_SCREENSHOT_DIR, "copy-quality-desktop.png"), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("质检结论已失效：商品事实已有新版本，请重新确认后质检。").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  if (process.env.A05_SCREENSHOT_DIR) {
    await page.screenshot({ path: path.join(process.env.A05_SCREENSHOT_DIR, "copy-quality-mobile.png"), fullPage: true });
  }
});
