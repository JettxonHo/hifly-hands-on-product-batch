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

    const candidates = await this.waitForNewLatestWorks(before);
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
    const outputPath = path.join(destination ?? this.config.downloadDir, suggested);
    await download.saveAs(outputPath);

    return {
      artifact_id: candidates[0].remote_id ?? candidates[0].work_key,
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

  async waitForNewLatestWorks(before, timeout = this.config.batch.generationTimeoutMs) {
    const prior = new Set(before.map((work) => work.work_key));
    const startedAt = Date.now();
    let latestCandidates = [];

    while (Date.now() - startedAt < timeout) {
      const after = await this.listLatestWorks();
      latestCandidates = after.filter((work) => !prior.has(work.work_key));
      if (latestCandidates.length > 0) return latestCandidates;
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
    const latestPanel = this.page.locator(".auto-main-right").first();
    let button;

    if (target.remote_id) {
      const value = JSON.stringify(target.remote_id);
      const selectors = ["data-work-id", "data-task-id", "data-video-id", "data-id"].flatMap((attribute) => [
        `button.download[${attribute}=${value}]`,
        `[${attribute}=${value}] button.download`
      ]);
      button = latestPanel.locator(selectors.join(", ")).first();
    } else if (target.remote_url) {
      const link = latestPanel.locator(`a[href=${JSON.stringify(target.remote_url)}]`).first();
      const card = link.locator(
        "xpath=ancestor-or-self::*[@data-work-id or @data-task-id or @data-video-id or @data-id or self::li or self::article or contains(concat(' ', normalize-space(@class), ' '), ' work-item ') or contains(concat(' ', normalize-space(@class), ' '), ' card ')][1]"
      );
      button = card.locator("button.download").first();
    } else {
      throw new Error("A stable remote work identity is required for download");
    }

    await button.waitFor({ state: "visible", timeout });
    await button.click({ timeout, force: true });
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
    await this.openHandsOnModal();
    await this.captureStep(product, "modal-open");

    if (await this.hasGeneratedImageReady()) {
      await this.resetGeneratedHandsOnImage();
      await this.captureStep(product, "modal-reset");
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

    await this.uploadModalFile(
      this.config.hiflyUi.uploadProductText,
      resolveFromRoot(this.config, product.image_path)
    );

    await this.captureStep(product, "modal-ready");
    await this.clickModalGenerate();
    await this.captureStep(product, "modal-after-generate");
    await this.confirmGeneratedHandsOnImage();
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

  async uploadModalFile(label, filePath) {
    const timeout = this.config.batch.defaultTimeoutMs;
    const button = this.page.getByRole("button", {
      name: new RegExp(escapeRegExp(label))
    }).first();
    if (!await button.isVisible({ timeout: 1000 }).catch(() => false)) {
      if (await this.isHandsOnModalReadyForGenerate()) return;
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

  async resetGeneratedHandsOnImage() {
    const timeout = this.config.batch.defaultTimeoutMs;
    const dialog = this.dialogLocator();
    await this.clickModalEditButton(dialog, timeout);

    const uploadProductButton = dialog.getByRole("button", {
      name: new RegExp(escapeRegExp(this.config.hiflyUi.uploadProductText))
    }).first();
    try {
      await uploadProductButton.waitFor({ state: "visible", timeout });
    } catch (error) {
      if (await this.isHandsOnModalReadyForGenerate()) return;
      await this.clickModalEditFallback(dialog, timeout);
      if (await this.isHandsOnModalReadyForGenerate()) return;
      await uploadProductButton.waitFor({ state: "visible", timeout });
    }
    await this.page.waitForTimeout(500);
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
