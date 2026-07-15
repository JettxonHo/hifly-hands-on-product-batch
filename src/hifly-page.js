import path from "node:path";
import { resolveFromRoot } from "./config.js";
import { timestampForFile } from "./logger.js";

export class HiflyHandsOnProductPage {
  constructor(page, config, logger) {
    this.page = page;
    this.config = config;
    this.logger = logger;
  }

  async openWorkbench() {
    await this.page.goto(this.config.hiflyWorkbenchUrl, { waitUntil: "domcontentloaded" });
    await this.page.waitForLoadState("networkidle", {
      timeout: this.config.batch.defaultTimeoutMs
    }).catch(() => {});
  }

  async enterHandsOnProductMode() {
    const ui = this.config.hiflyUi;
    if (this.config.handsOnProductUrl) {
      await this.page.goto(this.config.handsOnProductUrl, { waitUntil: "domcontentloaded" });
      await this.page.waitForLoadState("networkidle", {
        timeout: this.config.batch.defaultTimeoutMs
      }).catch(() => {});
      return;
    }

    if (ui.entryText) await this.clickByText(ui.entryText);
    if (ui.handsOnProductText) await this.clickByText(ui.handsOnProductText);
  }

  async fillProduct(product) {
    const ui = this.config.hiflyUi;

    await this.resetExistingUpload();
    await this.createHandsOnImage(product);
    await this.captureStep(product, "after-upload");

    await this.fillOptionalField(ui.productNameLabel, product.product_name, "product_name");
    await this.fillOptionalField(ui.sellingPointsLabel, product.selling_points, "selling_points");

    if (product.script && ui.scriptLabel) {
      await this.fillOptionalField(ui.scriptLabel, product.script, "script");
    }
  }

  async prepareAsset(product) {
    await this.openWorkbench();
    await this.enterHandsOnProductMode();
    await this.fillProduct(product);
    return { asset_id: `hifly-asset-${product.task_id || product.sku}` };
  }

  async submitVideo(product, { asset, checkpoint } = {}) {
    const before = await this.listLatestWorks();
    const observedAt = new Date().toISOString();
    await checkpoint?.({
      phase: "remote_submit_pre",
      evidence: {
        observed_at: observedAt,
        work_keys: before.map((work) => work.work_key),
        works: before
      }
    });

    await this.captureStep(product, "before-submit");
    await this.clickSubmitButton();
    await this.captureStep(product, "after-submit");
    await checkpoint?.({
      phase: "remote_submit_clicked",
      evidence: {
        observed_at: new Date().toISOString()
      }
    });

    const candidates = await this.waitForNewLatestWorks(before, { checkpoint });
    if (candidates.length === 1 && (candidates[0].remote_id || candidates[0].remote_url)) {
      return {
        status: "submitted",
        remoteEvidence: {
          evidence_source: "direct_submission",
          remote_id: candidates[0].remote_id,
          remote_url: candidates[0].remote_url,
          work_key: candidates[0].work_key,
          observed_at: new Date().toISOString()
        }
      };
    }

    return { status: "ambiguous", candidates };
  }

  async querySubmission(remoteEvidence) {
    const candidates = await this.matchLatestWorks(remoteEvidence);
    if (candidates.length > 1) return { status: "ambiguous", candidates };
    if (candidates.length === 0) return { status: "submitted", remoteEvidence };
    return {
      status: "ready",
      remoteEvidence: {
        ...remoteEvidence,
        candidate: candidates[0],
        last_observed_at: new Date().toISOString()
      }
    };
  }

  async reconcileSubmission(_product, checkpoint) {
    const evidence = checkpoint?.remote_evidence ?? checkpoint?.submit_checkpoint?.evidence ?? {};
    return { candidates: await this.matchLatestWorks(evidence) };
  }

  async downloadArtifact(remoteEvidence, destination) {
    const candidates = await this.matchLatestWorks(remoteEvidence);
    if (candidates.length !== 1) {
      const error = new Error("Could not uniquely match a remote work for download");
      error.code = "REMOTE_WORK_AMBIGUOUS";
      throw error;
    }

    const timeout = this.config.batch.generationTimeoutMs;
    const downloadPromise = this.page.waitForEvent("download", { timeout });
    await this.clickWorkDownload(candidates[0], timeout);
    const download = await downloadPromise;
    const suggested = download.suggestedFilename();
    const artifactId = candidates[0].remote_id ?? candidates[0].work_key;
    const outputName = `${timestampForFile()}-${sanitizeFileName(artifactId)}-${sanitizeFileName(suggested)}`;
    const outputPath = path.join(destination ?? this.config.downloadDir, outputName);
    await download.saveAs(outputPath);

    return {
      artifact_id: artifactId,
      relative_path: path.relative(this.config.__rootDir ?? process.cwd(), outputPath)
    };
  }

  async submitAndDownload(product) {
    const submitted = await this.submitVideo(product);
    if (submitted.status !== "submitted") throw new Error("Remote work could not be uniquely identified after submission");
    const artifact = await this.downloadArtifact(submitted.remoteEvidence, this.config.downloadDir);
    return path.join(this.config.__rootDir ?? process.cwd(), artifact.relative_path);
  }

  async clickByText(text, options = {}) {
    const timeout = options.timeout ?? this.config.batch.defaultTimeoutMs;
    const locator = this.page.getByText(text, { exact: false }).first();
    await locator.waitFor({ state: "visible", timeout });
    await locator.click({ timeout });
  }

  async captureStep(product, step) {
    if (!this.config.debug?.captureSteps) return;

    const screenshotPath = path.join(
      this.config.screenshotDir,
      `${timestampForFile()}-${product.sku || "unknown"}-${step}.png`
    );
    await this.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    this.logger.info("step_captured", {
      sku: product.sku,
      step,
      screenshotPath
    });
  }

  async fillByLabel(label, value) {
    const timeout = this.config.batch.defaultTimeoutMs;
    const byLabel = this.page.getByLabel(label, { exact: false }).first();
    const byPlaceholder = this.page.getByPlaceholder(label, { exact: false }).first();

    if (await byLabel.count()) {
      await byLabel.fill(value, { timeout });
      return;
    }

    if (await byPlaceholder.count()) {
      await byPlaceholder.fill(value, { timeout });
      return;
    }

    throw new Error(`Could not find input for label or placeholder: ${label}`);
  }

  async fillOptionalField(label, value, fieldName) {
    if (!label || !value) return;

    try {
      await this.fillByLabel(label, value);
    } catch (error) {
      if (this.config.behavior?.productFieldsRequired) throw error;
      this.logger.info("optional_field_skipped", {
        fieldName,
        label,
        reason: error.message
      });
    }
  }

  async waitForUploadToFinish() {
    const uploadingText = this.config.behavior?.uploadCompleteText;
    if (!uploadingText) return;

    await this.page.getByText(uploadingText, { exact: false }).waitFor({
      state: "hidden",
      timeout: this.config.batch.defaultTimeoutMs
    }).catch(() => {});

    await this.page.waitForTimeout(this.config.behavior?.postUploadWaitMs ?? 0);
  }

  async clickSubmitButton() {
    const timeout = this.config.batch.defaultTimeoutMs;
    const footerButton = this.page.locator("button.footer-btn").last();

    if (await footerButton.count()) {
      await footerButton.waitFor({ state: "visible", timeout });
      await footerButton.scrollIntoViewIfNeeded();
      const box = await footerButton.boundingBox();
      if (!box) throw new Error("Submit button has no bounding box.");
      await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await this.page.waitForTimeout(2000);
      await this.logVisibleMessages("after_outer_submit_click");
      return;
    }

    await this.clickByText(this.config.hiflyUi.submitText);
  }

  async listLatestWorks() {
    const latestPanel = this.page.locator(".auto-main-right").first();
    const buttons = latestPanel.locator("button.download");
    const works = await buttons.evaluateAll((nodes) => nodes.map((button, index) => {
      const card = button.closest("[data-work-id], [data-task-id], [data-id], li, article, .work-item, .card") || button.parentElement;
      const attributes = ["data-work-id", "data-task-id", "data-video-id", "data-id"];
      const remoteId = attributes.map((name) => card?.getAttribute(name) || button.getAttribute(name)).find(Boolean) || null;
      const link = card?.querySelector("a[href]") || button.closest("a[href]");
      const remoteUrl = link?.getAttribute("href") || null;
      const label = (card?.textContent || button.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      const workKey = remoteId || remoteUrl || `${index}:${label}`;
      return { index, remote_id: remoteId, remote_url: remoteUrl, label, work_key: workKey };
    }));
    return dedupeWorks(works);
  }

  async waitForNewLatestWorks(before, { timeout = this.config.batch.generationTimeoutMs, checkpoint } = {}) {
    const prior = new Set(before.map((work) => work.work_key));
    const startedAt = Date.now();
    let latestCandidates = [];
    let lastCheckpointAt = 0;

    while (Date.now() - startedAt < timeout) {
      const after = await this.listLatestWorks();
      latestCandidates = after.filter((work) => !prior.has(work.work_key));
      if (latestCandidates.length > 0) return latestCandidates;
      if (Date.now() - lastCheckpointAt > 30000) {
        lastCheckpointAt = Date.now();
        await checkpoint?.({
          phase: "remote_submit_wait",
          evidence: {
            observed_at: new Date().toISOString(),
            elapsed_ms: Date.now() - startedAt,
            known_work_count: after.length,
            candidate_count: latestCandidates.length
          }
        });
      }
      await this.page.waitForTimeout(5000);
    }

    return latestCandidates;
  }

  async matchLatestWorks(remoteEvidence = {}) {
    const works = await this.listLatestWorks();
    const target = remoteEvidence.candidate ?? remoteEvidence;
    if (target.remote_id) return works.filter((work) => work.remote_id === target.remote_id);
    if (target.remote_url) return works.filter((work) => work.remote_url === target.remote_url);
    return [];
  }

  async clickWorkDownload(work, timeout) {
    await this.page.getByText("最新作品", { exact: false }).first().waitFor({ state: "visible", timeout });
    const target = work.candidate ?? work;
    if (!target.remote_id && !target.remote_url && !target.work_key) {
      throw new Error("A stable remote work identity is required for download");
    }

    await this.ensureSafeWorkDownloadClicker();
    const result = await this.page.evaluate((expected) => {
      return window.__hiflyClickSafeWorkDownload(expected);
    }, {
      remote_id: target.remote_id ?? null,
      remote_url: target.remote_url ?? null,
      work_key: target.work_key ?? null
    });

    this.logger.info("download_button_resolution", result);
    if (!result.clicked) {
      const error = new Error(`Could not find a safe download button: ${result.reason}`);
      error.code = "DOWNLOAD_BUTTON_NOT_FOUND";
      error.evidence = result;
      throw error;
    }
  }

  async ensureSafeWorkDownloadClicker() {
    await this.page.evaluate(installSafeWorkDownloadClicker);
  }

  async uploadFile(label, filePath) {
    const timeout = this.config.batch.defaultTimeoutMs;

    const chooser = await this.openFileChooser(label, timeout).catch(() => null);
    if (chooser) {
      await chooser.setFiles(filePath);
      return;
    }

    const fileInput = this.page.locator("input[type='file']").last();
    if (await fileInput.count()) {
      await fileInput.setInputFiles(filePath, { timeout });
      return;
    }

    throw new Error("Could not find a file upload control.");
  }

  async logVisibleMessages(event) {
    const messages = await this.page.locator("body *").evaluateAll((nodes) => {
      return nodes
        .map((node) => {
          const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return {
            text,
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity
          };
        })
        .filter((item) => item.text)
        .filter((item) => item.display !== "none" && item.visibility !== "hidden" && item.opacity !== "0")
        .filter((item) => /请|失败|上传|积分|生成|创作|消耗|成功|错误|异常|排队|任务|作品|下载/.test(item.text))
        .slice(0, 40);
    }).catch((error) => [{ text: error.message }]);

    this.logger.info(event, { messages });
  }

  async createHandsOnImage(product) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.openHandsOnModal();
      await this.captureStep(product, attempt === 0 ? "modal-open" : "modal-retry-open");

      if (await this.hasGeneratedImageReady()) {
        await this.resetAndReopenHandsOnModal(product);
      }

      const personImagePath = product.__resolved_person_image_path || product.person_image_path;

      if (personImagePath) {
        await this.uploadModalFile(
          this.config.hiflyUi.uploadPersonText,
          resolveFromRoot(this.config, personImagePath)
        );
      } else if (
        this.config.behavior?.useRecommendedPersonWhenMissing
        && this.config.personPool?.fallbackToRecommended !== false
      ) {
        await this.selectRecommendedPerson();
      }

      const staleProductSrc = await this.captureProductImageSrc();

      await this.uploadModalFile(
        this.config.hiflyUi.uploadProductText,
        resolveFromRoot(this.config, product.image_path),
        { required: true }
      );

      await this.verifyProductImageReplaced(staleProductSrc, product);
      await this.captureStep(product, "modal-ready");

      if (await this.hasGeneratedImageReady()) {
        this.logger.info("generated_modal_ready_before_generate", {
          sku: product?.sku,
          attempt
        });
        if (attempt === 0) {
          await this.resetAndReopenHandsOnModal(product);
          continue;
        }
        await this.dumpModalDomSnapshot(product);
        throw new Error("generated hands-on image appeared before clicking generate; refusing to confirm a possible stale asset");
      }

      await this.clickModalGenerate();
      await this.captureStep(product, "modal-after-generate");
      await this.confirmGeneratedHandsOnImage();
      return;
    }
  }

  async resetAndReopenHandsOnModal(product) {
    await this.resetGeneratedHandsOnImage(product);
    await this.captureStep(product, "modal-reset");
    // clearResidual 删残留图会关闭"手持商品图"弹窗、回到外层页面；
    // 重新打开一个干净的上传界面（残留已删），才能看到"上传商品"按钮。
    await this.openHandsOnModal();
    await this.captureStep(product, "modal-reopen");
    if (await this.hasGeneratedImageReady()) {
      await this.dumpModalDomSnapshot(product);
      throw new Error("stale generated image persists after reset+reopen; clearResidual did not remove it");
    }
  }

  async openHandsOnModal() {
    const timeout = this.config.batch.defaultTimeoutMs;
    if (await this.hasGeneratedImageReady()) return;

    await this.uploadButton().waitFor({ state: "visible", timeout });
    await this.uploadButton().click({ timeout, force: true });
    await this.page.waitForTimeout(1000);
    if (await this.hasGeneratedImageReady()) return;

    const uploadProductButton = this.page.getByRole("button", {
      name: new RegExp(escapeRegExp(this.config.hiflyUi.uploadProductText))
    }).first();

    await uploadProductButton.waitFor({ state: "visible", timeout }).catch(async (error) => {
      if (await this.hasGeneratedImageReady()) return;
      if (await this.isHandsOnModalReadyForGenerate()) return;
      throw error;
    });
  }

  async uploadModalFile(label, filePath, options = {}) {
    const required = options.required === true;
    const timeout = this.config.batch.defaultTimeoutMs;
    const button = this.page.getByRole("button", {
      name: new RegExp(escapeRegExp(label))
    }).first();
    if (!await button.isVisible({ timeout: 1000 }).catch(() => false)) {
      // 兜底：上传入口可能是图标“+”按钮（getByRole 按文字匹配不到），直接用隐藏的 input[type=file] 上传
      const fileInput = this.page.locator("input[type='file']").last();
      if (await fileInput.count().catch(() => 0)) {
        await fileInput.setInputFiles(filePath, { timeout });
        await this.page.waitForTimeout(this.config.behavior?.postUploadWaitMs ?? 0);
        return;
      }
      const ready = await this.isHandsOnModalReadyForGenerate().catch(() => false);
      if (required) {
        throw new Error(
          `Required upload "${label}" is not visible (modal ready=${ready}) and no input[type=file] fallback.`
          + " Refusing to skip: the modal may still hold a stale product image."
        );
      }
      if (ready) return;
      await button.waitFor({ state: "visible", timeout });
    }
    const chooserPromise = this.page.waitForEvent("filechooser", { timeout });
    await button.click({ timeout });
    const chooser = await chooserPromise;
    await chooser.setFiles(filePath);
    await this.page.waitForTimeout(this.config.behavior?.postUploadWaitMs ?? 0);
  }

  async selectRecommendedPerson() {
    const timeout = this.config.batch.defaultTimeoutMs;
    const dialog = this.dialogLocator();
    const personRecommendation = dialog.locator("img[src*='rec_']").first();
    await personRecommendation.waitFor({ state: "visible", timeout });
    await personRecommendation.click({ timeout });
    await this.page.waitForTimeout(800);
  }

  async clickModalGenerate() {
    const timeout = this.config.batch.defaultTimeoutMs;
    const dialog = this.dialogLocator();
    const generateButton = dialog.getByRole("button", {
      name: new RegExp(escapeRegExp(this.config.hiflyUi.modalSubmitText))
    }).last();
    await generateButton.waitFor({ state: "visible", timeout });
    await generateButton.click({ timeout, force: true });
  }

  async confirmGeneratedHandsOnImage() {
    const timeout = this.config.batch.generationTimeoutMs;
    await this.waitForGeneratedHandsOnImage(timeout);
    await this.clickModalConfirm(timeout);
  }

  async waitForGeneratedHandsOnImage(timeout = this.config.batch.generationTimeoutMs) {
    const startedAt = Date.now();
    let lastLoggedAt = 0;
    while (Date.now() - startedAt < timeout) {
      if (await this.hasGeneratedImageReady()) return;
      if (Date.now() - lastLoggedAt > 10000) {
        lastLoggedAt = Date.now();
        const state = await this.inspectVisibleGeneratedModalState();
        this.logger.info("generated_modal_wait_state", {
          elapsedMs: Date.now() - startedAt,
          visible: state.visible,
          ready: state.ready,
          textPreview: state.text?.slice?.(0, 120) ?? "",
          buttonTexts: state.buttonTexts,
          imageCount: state.imageSources?.length ?? 0,
          imagePreview: state.imageSources?.slice?.(0, 5) ?? []
        });
      }
      await this.page.waitForTimeout(2000);
    }

    throw new Error(`Timed out waiting for generated hands-on image after ${timeout}ms`);
  }

  async resetGeneratedHandsOnImage(product) {
    const timeout = this.config.batch.defaultTimeoutMs;
    const dialog = this.dialogLocator();
    await this.clickModalEditButton(dialog, timeout);
    await this.captureStep(product, "after-reset-edit");
    await this.dumpModalDomSnapshot(product);

    const uploadProductButton = this.page.getByRole("button", {
      name: new RegExp(escapeRegExp(this.config.hiflyUi.uploadProductText))
    }).first();

    // 点“重新编辑”后残留图可能仍占着商品图槽位，“上传商品”按钮被换成 图片+垃圾桶，
    // 先尝试清除残留图，让空槽重新露出上传按钮。
    if (!await uploadProductButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await this.clearResidualModalImages(product);
    }

    try {
      await uploadProductButton.waitFor({ state: "visible", timeout });
    } catch (error) {
      await this.captureStep(product, "reset-upload-not-visible");
      await this.dumpModalDomSnapshot(product);
      throw new Error(
        "resetGeneratedHandsOnImage clicked 重新编辑 but the product upload button did not become visible"
        + " (even after clearing residual images)."
        + " Inspect screenshots/*-after-reset-edit.png and logs modal_dom_snapshot."
      );
    }
    await this.page.waitForTimeout(500);
  }

  // 诊断：把当前页面所有可见 modal 的结构 + 所有按钮的 accessible name + 图片 src 落盘。
  // 这是判定“重新编辑后真实 DOM”的决定性证据，不消耗积分（仅在 reset 阶段调用）。
  async dumpModalDomSnapshot(product) {
    if (typeof this.page.evaluate !== "function") return;
    await this.ensureVisibleModalInspector().catch(() => {});
    const snapshot = await this.page.evaluate(() => {
      const state = window.__hiflyGetVisibleHandsOnModalState?.() ?? {};
      const allButtons = Array.from(document.querySelectorAll("button"))
        .map((b) => ({
          text: (b.innerText || b.textContent || "").replace(/\s+/g, "").slice(0, 40),
          ariaLabel: b.getAttribute("aria-label"),
          visible: b.getBoundingClientRect().width > 0
        }))
        .filter((b) => b.text || b.ariaLabel)
        .slice(0, 60);
      return {
        visibleModalFound: Boolean(state.element),
        modalText: (state.text || "").slice(0, 600),
        modalButtonTexts: state.buttonTexts || [],
        modalImageSources: (state.imageSources || []).slice(0, 12),
        allModalCount: document.querySelectorAll(".ant-modal, [role='dialog']").length,
        sampleButtons: allButtons
      };
    }).catch(() => null);
    this.logger.info("modal_dom_snapshot", { sku: product?.sku, snapshot });
  }

  // 清除弹窗内残留的商品/人物图，让上传按钮重新露出。选择器基于截图推断，全部带兜底。
  async clearResidualModalImages(product) {
    const timeout = this.config.batch.defaultTimeoutMs;
    let scope = this.dialogLocator();
    if (!await scope.isVisible({ timeout: 1000 }).catch(() => false)) {
      // “重新编辑”后 dialogLocator 的 '手持商品图' 文本过滤可能失效，退回到任意可见弹窗
      scope = this.page.locator(".ant-modal:visible, [role='dialog']:visible").last();
    }

    // 方案A：点弹窗底部“重置”按钮，一次清空
    const resetText = this.config.hiflyUi?.modalResetText || "重置";
    const resetBtn = scope.getByRole("button", { name: new RegExp(escapeRegExp(resetText)) }).first();
    if (await resetBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await resetBtn.click({ timeout, force: true }).catch(() => {});
      await this.page.waitForTimeout(1000);
      await this.captureStep(product, "after-modal-reset-clear");
      return;
    }

    // 方案B：逐个点图片槽的删除图标（倒序，避免索引漂移）。不含 .anticon-close——那是弹窗关闭×，不是删除图。
    const trashBtns = scope.locator(
      "[class*='delete'], [class*='trash'], .anticon-delete, button:has(svg[class*='delete'])"
    );
    const count = await trashBtns.count().catch(() => 0);
    for (let i = count - 1; i >= 0; i -= 1) {
      await trashBtns.nth(i).click({ timeout, force: true }).catch(() => {});
      await this.page.waitForTimeout(400);
    }
    if (count > 0) await this.captureStep(product, "after-modal-trash-clear");
  }

  // 抓弹窗内右侧商品图的 src（排除 rec_ 推荐人物）。用于上传前后对比验证。
  async captureProductImageSrc() {
    if (typeof this.page.evaluate !== "function") return null;
    await this.ensureVisibleModalInspector().catch(() => {});
    return this.page.evaluate(() => {
      const state = window.__hiflyGetVisibleHandsOnModalState?.();
      if (!state?.element) return null;
      const imgs = Array.from(state.element.querySelectorAll("img"))
        .filter((img) => {
          const rect = img.getBoundingClientRect();
          const src = img.currentSrc || img.src || "";
          return rect.width > 0 && rect.height > 0 && !src.includes("rec_");
        })
        .map((img) => ({
          src: img.currentSrc || img.src || "",
          naturalWidth: img.naturalWidth,
          x: img.getBoundingClientRect().x
        }))
        .sort((a, b) => b.x - a.x);
      const target = imgs[0];
      return target ? { src: target.src, naturalWidth: target.naturalWidth } : null;
    }).catch(() => null);
  }

  // 安全网：上传后强制验证右侧商品图确实被替换/加载。如果残留图没换，在上传阶段就抛错，
  // 流程停在这里、不会走到“立即生成”（消耗积分）。这是防白菜被错误生成的最后防线。
  async verifyProductImageReplaced(staleSrc, product) {
    const current = await this.captureProductImageSrc();
    await this.captureStep(product, "product-verify");
    if (!current) {
      throw new Error(`product image not found in modal after upload, sku=${product?.sku}`);
    }
    if (!current.naturalWidth || current.naturalWidth === 0) {
      throw new Error(`product image not loaded after upload (naturalWidth=0), sku=${product?.sku}`);
    }
    // blob: 每次上传都不同；非 blob 且 src 未变 = 残留图没被替换
    if (staleSrc && current.src && current.src === staleSrc.src && !String(current.src).startsWith("blob:")) {
      throw new Error(
        `product image NOT replaced after upload (stale src persists), sku=${product?.sku}, src=${current.src}`
      );
    }
  }

  async clickModalEditButton(dialog, timeout = this.config.batch.defaultTimeoutMs) {
    const editText = dialog.getByText(/重新编辑|重\s*新\s*编\s*辑/).first();
    if (await editText.isVisible({ timeout: 1000 }).catch(() => false)) {
      await editText.click({ timeout, force: true }).catch(async () => {
        const box = await editText.boundingBox();
        if (!box) throw new Error("Edit text has no bounding box.");
        await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      });
      return;
    }

    await this.clickModalEditFallback(dialog, timeout);
  }

  async clickModalEditFallback(dialog, timeout = this.config.batch.defaultTimeoutMs) {
    await dialog.waitFor({ state: "visible", timeout });
    const box = await dialog.boundingBox();
    if (!box) throw new Error("Hands-on modal has no bounding box for edit fallback.");
    await this.page.mouse.click(box.x + box.width * 0.42, box.y + box.height - 43);
  }

  async hasGeneratedImageReady() {
    const visibleState = await this.inspectVisibleGeneratedModalState();
    if (visibleState.ready) return true;
    if (visibleState.visible) return false;

    const confirmPattern = /确\s*认/;
    const dialog = this.dialogLocator();
    const confirmText = dialog.getByText(confirmPattern).last();
    if (await confirmText.isVisible().catch(() => false)) return true;

    if (await dialog.getByText("再次生成", { exact: false }).last().isVisible().catch(() => false)) {
      return true;
    }

    const state = await this.inspectGeneratedModalState(dialog);
    if (state.ready) return true;

    return false;
  }

  async inspectGeneratedModalState(dialog) {
    return dialog.evaluate((element) => {
      const normalize = (value) => String(value || "").replace(/\s+/g, "");
      const text = normalize(element.innerText || element.textContent || "");
      const querySelectorAll = element.querySelectorAll?.bind(element) ?? (() => []);
      const buttonTexts = Array.from(querySelectorAll("button"))
        .map((button) => normalize(button.innerText || button.textContent || button.getAttribute("aria-label")))
        .filter(Boolean);
      const imageSources = Array.from(querySelectorAll("img"))
        .map((image) => image.currentSrc || image.src || image.getAttribute("src") || "")
        .filter(Boolean);

      const hasReadyActions = text.includes("再次生成") &&
        text.includes("重新编辑") &&
        text.includes("确认");
      const hasUploadActions = text.includes("上传人物") ||
        text.includes("上传商品") ||
        text.includes("立即生成");
      const hasGeneratedImage = imageSources.some((source) => {
        const filename = source.split("?")[0].split("/").pop() || "";
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|webp)$/i.test(filename);
      });

      return {
        ready: hasReadyActions || (hasGeneratedImage && !hasUploadActions),
        text,
        buttonTexts,
        imageSources
      };
    }).catch(() => ({
      ready: false,
      text: "",
      buttonTexts: [],
      imageSources: []
    }));
  }

  async isHandsOnModalReadyForGenerate() {
    const submitText = this.config.hiflyUi?.modalSubmitText;
    if (!submitText) return false;
    const dialog = this.dialogLocator();
    const generateButton = dialog.getByRole("button", {
      name: new RegExp(escapeRegExp(submitText))
    }).last();
    return generateButton.isVisible().catch(() => false);
  }

  async clickModalConfirm(timeout = this.config.batch.defaultTimeoutMs) {
    if (await this.clickVisibleModalConfirmByDom(timeout)) return;

    const dialog = this.dialogLocator();
    await dialog.waitFor({ state: "visible", timeout });
    const clickedConfirm = await this.clickModalConfirmButton(dialog, timeout).catch(() => false);
    if (!clickedConfirm) {
      await this.clickModalConfirmFallback(dialog, timeout);
    }

    await this.page.waitForTimeout(800);
    if (await dialog.isVisible().catch(() => false)) {
      await this.clickModalConfirmFallback(dialog, timeout);
    }

    await dialog.waitFor({ state: "hidden", timeout });
    await this.page.locator(".ant-modal-mask").last().waitFor({
      state: "hidden",
      timeout
    }).catch(() => {});
    await this.page.waitForTimeout(this.config.behavior?.postConfirmWaitMs ?? 0);
  }

  async inspectVisibleGeneratedModalState() {
    if (typeof this.page.evaluate !== "function") {
      return {
        ready: false,
        visible: false,
        text: "",
        buttonTexts: [],
        imageSources: []
      };
    }

    await this.ensureVisibleModalInspector();
    return this.page.evaluate(() => {
      const { element: _element, ...state } = window.__hiflyGetVisibleHandsOnModalState();
      return state;
    }).catch(() => ({
      ready: false,
      visible: false,
      text: "",
      buttonTexts: [],
      imageSources: []
    }));
  }

  async clickVisibleModalConfirmByDom(timeout = this.config.batch.defaultTimeoutMs) {
    if (typeof this.page.evaluate !== "function") return false;

    await this.ensureVisibleModalInspector();
    const clicked = await this.page.evaluate(() => {
      const state = window.__hiflyGetVisibleHandsOnModalState();
      if (!state.ready || !state.buttonTexts.length) return false;
      const buttons = Array.from(state.element.querySelectorAll("button"));
      const normalize = (value) => String(value || "").replace(/\s+/g, "");
      const confirmButton = buttons.find((button) => normalize(button.innerText || button.textContent).includes("确认")) ||
        buttons.at(-1);
      confirmButton?.click();
      return Boolean(confirmButton);
    }).catch(() => false);

    if (!clicked) return false;

    await this.page.waitForFunction(() => {
      return !window.__hiflyGetVisibleHandsOnModalState?.().visible;
    }, null, { timeout }).catch(() => {});
    await this.page.waitForTimeout(this.config.behavior?.postConfirmWaitMs ?? 0);
    return true;
  }

  async ensureVisibleModalInspector() {
    await this.page.evaluate(() => {
      window.__hiflyGetVisibleHandsOnModalState = () => {
        const normalize = (value) => String(value || "").replace(/\s+/g, "");
        const candidates = Array.from(document.querySelectorAll(".ant-modal, [role='dialog']"));
        const element = candidates.find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          const style = window.getComputedStyle(candidate);
          const text = normalize(candidate.innerText || candidate.textContent || "");
          return rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0" &&
            text.includes("手持商品图");
        });

        if (!element) {
          return {
            ready: false,
            visible: false,
            text: "",
            buttonTexts: [],
            imageSources: []
          };
        }

        const text = normalize(element.innerText || element.textContent || "");
        const buttonTexts = Array.from(element.querySelectorAll("button"))
          .map((button) => normalize(button.innerText || button.textContent || button.getAttribute("aria-label")))
          .filter(Boolean);
        const imageSources = Array.from(element.querySelectorAll("img"))
          .map((image) => image.currentSrc || image.src || image.getAttribute("src") || "")
          .filter(Boolean);
        const hasReadyActions = text.includes("再次生成") &&
          text.includes("重新编辑") &&
          text.includes("确认");
        const hasUploadActions = text.includes("上传人物") ||
          text.includes("上传商品") ||
          text.includes("立即生成");
        const hasGeneratedImage = imageSources.some((source) => {
          const filename = source.split("?")[0].split("/").pop() || "";
          return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|webp)$/i.test(filename);
        });

        return {
          ready: hasReadyActions || (hasGeneratedImage && !hasUploadActions),
          visible: true,
          text,
          buttonTexts,
          imageSources,
          element
        };
      };
    }).catch(() => {});
  }

  async clickModalConfirmFallback(dialog, timeout = this.config.batch.defaultTimeoutMs) {
    const footerConfirm = dialog.locator?.(".ant-modal-footer button, button").filter?.({
      hasText: /确\s*认/
    }).last?.();
    if (footerConfirm && await footerConfirm.isVisible({ timeout: 1000 }).catch(() => false)) {
      await this.clickLocatorAndVerifyDialog(footerConfirm, dialog, timeout);
      return true;
    }

    const box = await dialog.boundingBox();
    if (!box) throw new Error("Confirm dialog has no bounding box.");
    await this.page.mouse.click(box.x + box.width - 86, box.y + box.height - 43);
    return true;
  }

  async clickModalConfirmButton(dialog, timeout = this.config.batch.defaultTimeoutMs) {
    const confirmText = this.config.hiflyUi?.modalConfirmText || "确认";
    const confirmPattern = new RegExp(escapeRegExp(confirmText).split("").join("\\s*"));
    const roleButton = dialog.getByRole("button", { name: confirmPattern }).last();
    if (await roleButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await this.clickLocatorAndVerifyDialog(roleButton, dialog, timeout);
      return true;
    }

    const textButton = dialog.getByText(confirmPattern).last();
    if (await textButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await this.clickLocatorAndVerifyDialog(textButton, dialog, timeout);
      return true;
    }

    const fallbackButton = dialog.locator("button").last();
    await this.clickLocatorAndVerifyDialog(fallbackButton, dialog, timeout);
    return true;
  }

  async clickLocatorAndVerifyDialog(locator, dialog, timeout = this.config.batch.defaultTimeoutMs) {
    const box = await locator.boundingBox().catch(() => null);
    await locator.click({ timeout, force: true });
    await this.page.waitForTimeout(300);
    if (await dialog.isVisible().catch(() => false)) {
      if (!box) return;
      await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
  }

  async resetExistingUpload() {
    if (!this.config.behavior?.resetUploadBeforeEachProduct) return;

    await this.closeHandsOnModalIfOpen();

    const uploadCard = this.page.locator(".controls-panel").locator("xpath=.//*[contains(normalize-space(.), '手持商品图')]/ancestor::*[contains(@class, 'controls-panel')][1]");
    const fallbackBox = await uploadCard.boundingBox().catch(() => null);

    if (!fallbackBox) return;

    const deleteButton = uploadCard.locator("button").filter({
      has: uploadCard.locator("svg, .anticon, [class*='delete'], [class*='trash']")
    }).first();
    if (await deleteButton.isVisible().catch(() => false)) {
      await deleteButton.click({ force: true }).catch(async () => {
        await this.page.mouse.click(fallbackBox.x + fallbackBox.width - 82, fallbackBox.y + 96);
      });
    } else {
      await this.page.mouse.click(fallbackBox.x + fallbackBox.width - 82, fallbackBox.y + 96).catch(() => {});
    }

    await this.page.waitForTimeout(500);
    await this.reloadHandsOnProductMode();
    await this.uploadButton().waitFor({
      state: "visible",
      timeout: this.config.batch.defaultTimeoutMs
    }).catch(() => {});
  }

  async reloadHandsOnProductMode() {
    if (this.config.handsOnProductUrl) {
      await this.page.goto(this.config.handsOnProductUrl, { waitUntil: "domcontentloaded" });
      await this.page.waitForLoadState("networkidle", {
        timeout: this.config.batch.defaultTimeoutMs
      }).catch(() => {});
    } else {
      await this.page.reload({ waitUntil: "domcontentloaded" });
      await this.page.waitForLoadState("networkidle", {
        timeout: this.config.batch.defaultTimeoutMs
      }).catch(() => {});
    }
    await this.closeHandsOnModalIfOpen();
  }

  async closeHandsOnModalIfOpen() {
    const dialog = this.dialogLocator();
    if (!await dialog.isVisible().catch(() => false)) return;

    await this.page.keyboard?.press?.("Escape").catch(() => {});
    await dialog.waitFor({
      state: "hidden",
      timeout: this.config.batch.defaultTimeoutMs
    }).catch(async () => {
      const box = await dialog.boundingBox().catch(() => null);
      if (box) await this.page.mouse.click(box.x + box.width - 36, box.y + 28).catch(() => {});
    });
    await this.page.locator(".ant-modal-mask").last().waitFor({
      state: "hidden",
      timeout: this.config.batch.defaultTimeoutMs
    }).catch(() => {});
  }

  async openFileChooser(label, timeout) {
    const uploadText = this.uploadButton(label);
    const chooserPromise = this.page.waitForEvent("filechooser", { timeout });

    if (await uploadText.count()) {
      await uploadText.click({ timeout });
    } else {
      const uploadCard = this.page.locator(".controls-panel").locator("text=手持商品图").first();
      await uploadCard.click({ timeout });
    }

    return chooserPromise;
  }

  uploadButton(label = this.config.hiflyUi.uploadLabel) {
    const escaped = escapeRegExp(label);
    return this.page.getByRole("button", { name: new RegExp(escaped) }).first();
  }

  dialogLocator() {
    return this.page.locator(".ant-modal:visible, [role='dialog']:visible").filter({
      hasText: "手持商品图"
    }).last();
  }
}

export function sanitizeFileName(value) {
  return String(value || "untitled")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function dedupeWorks(works) {
  const seen = new Set();
  const unique = [];
  for (const work of works) {
    if (!work.work_key || seen.has(work.work_key)) continue;
    seen.add(work.work_key);
    unique.push(work);
  }
  return unique;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function installSafeWorkDownloadClicker() {
  window.__hiflyClickSafeWorkDownload = (expected) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" &&
        style.visibility !== "hidden" && style.opacity !== "0";
    };

    const norm = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const tokenText = (element) => norm([
      element.innerText,
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("class"),
      element.getAttribute("data-icon"),
      element.querySelector("svg use")?.getAttribute("href"),
      element.querySelector("svg use")?.getAttribute("xlink:href"),
      element.querySelector("img")?.getAttribute("alt"),
      element.querySelector("img")?.getAttribute("src"),
      element.innerHTML
    ].filter(Boolean).join(" "));

    const isDangerButton = (button) => /删除|delete|trash|remove|del-|icon-delete/i.test(tokenText(button));
    const isDownloadButton = (button) => /下载|download|icon-download|anticon-download|cloud-download|arrow-down/i.test(tokenText(button));
    const workIdentity = (card, index) => {
      const attributes = ["data-work-id", "data-task-id", "data-video-id", "data-id"];
      const remoteId = attributes
        .map((name) => card?.getAttribute(name) || card?.querySelector(`[${name}]`)?.getAttribute(name))
        .find(Boolean) || null;
      const link = card?.querySelector("a[href]");
      const remoteUrl = link?.getAttribute("href") || null;
      const label = norm(card?.textContent);
      return {
        remote_id: remoteId,
        remote_url: remoteUrl,
        work_key: remoteId || remoteUrl || `${index}:${label}`,
        label
      };
    };

    const panel = document.querySelector(".auto-main-right");
    if (!panel) return { clicked: false, reason: "latest panel not found" };

    const rawCards = Array.from(panel.querySelectorAll(
      "[data-work-id], [data-task-id], [data-video-id], [data-id], li, article, .work-item, .card, .ant-card"
    )).filter((card) => visible(card) && card.querySelector("button, a"));
    const cards = rawCards.length ? rawCards : Array.from(panel.children).filter((card) => visible(card));

    const inspected = [];
    for (const [index, card] of cards.entries()) {
      const identity = workIdentity(card, index);
      const matches = expected.remote_id
        ? identity.remote_id === expected.remote_id
        : expected.remote_url
          ? identity.remote_url === expected.remote_url
          : identity.work_key === expected.work_key;
      if (!matches) continue;

      const actions = Array.from(card.querySelectorAll("button, a[href]")).filter(visible);
      const summaries = actions.map((action, actionIndex) => ({
        actionIndex,
        text: norm(action.innerText || action.textContent),
        ariaLabel: action.getAttribute("aria-label"),
        title: action.getAttribute("title"),
        className: action.getAttribute("class"),
        html: norm(action.innerHTML).slice(0, 160),
        isDanger: isDangerButton(action),
        isDownload: isDownloadButton(action)
      }));
      inspected.push({ identity, actions: summaries });

      const downloadButton = actions.find((action) => isDownloadButton(action) && !isDangerButton(action));
      if (!downloadButton) continue;

      downloadButton.click();
      return { clicked: true, identity, action: summaries[actions.indexOf(downloadButton)] };
    }

    return { clicked: false, reason: "safe download button not found", inspected };
  };
}
