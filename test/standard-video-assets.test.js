import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildPrompt,
  buildScript,
  generateStandardVideoAssets,
  parseSellingPoints
} from "../src/core/standard-video-assets.js";

test("parseSellingPoints accepts Chinese and ASCII separators", () => {
  assert.deepEqual(parseSellingPoints("根系完整；叶片厚实,清炒清甜\n第四条"), [
    "根系完整",
    "叶片厚实",
    "清炒清甜"
  ]);
});

test("buildScript uses provided script when present", () => {
  assert.equal(
    buildScript({ script: "客户确认过的脚本。" }),
    "客户确认过的脚本。"
  );
});

test("buildScript creates a standard single-video script from product fields", () => {
  const script = buildScript({
    product_name: "山野小青菜",
    selling_points: "根系完整；叶片厚实；清炒清甜",
    category: "fresh_food"
  });

  assert.match(script, /山野小青菜/);
  assert.match(script, /根系完整/);
  assert.match(script, /叶片厚实/);
  assert.match(script, /清炒清甜/);
  assert.match(script, /收藏看看/);
});

test("buildPrompt creates split-screen Hifly prompt with negative prompt", () => {
  const prompt = buildPrompt({
    product_name: "云感保湿乳",
    selling_points: "清爽不黏；换季保湿",
    category: "beauty"
  });

  assert.match(prompt, /竖屏9:16/);
  assert.match(prompt, /左右分屏/);
  assert.match(prompt, /云感保湿乳/);
  assert.match(prompt, /清爽不黏、换季保湿/);
  assert.match(prompt, /负面提示词/);
});

test("generateStandardVideoAssets writes scripts prompts and qc report", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hifly-assets-"));
  try {
    const result = await generateStandardVideoAssets({
      outputRoot: path.join(root, "outputs"),
      products: [
        {
          sku: "SKU/001",
          product_name: "山野小青菜",
          selling_points: "根系完整；叶片厚实；清炒清甜",
          category: "fresh_food",
          duration_seconds: "20",
          status: "pending"
        },
        {
          sku: "SKU002",
          product_name: "跳过商品",
          selling_points: "卖点",
          category: "snacks",
          status: "downloaded"
        }
      ]
    });

    assert.equal(result.count, 1);
    assert.equal(result.assets.length, 1);
    assert.equal(fs.existsSync(result.assets[0].scriptPath), true);
    assert.equal(fs.existsSync(result.assets[0].promptPath), true);
    assert.equal(fs.existsSync(result.qcReportPath), true);
    assert.match(fs.readFileSync(result.qcReportPath, "utf8"), /pending_qc/);
    assert.match(path.basename(result.assets[0].scriptPath), /SKU_001_山野小青菜_standard_script\.txt/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
