import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputPath = "products/商品信息表.xlsx";

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("商品信息");
sheet.showGridLines = false;

const headers = [
  "sku",
  "product_name",
  "selling_points",
  "image_path",
  "script",
  "avatar",
  "voice",
  "duration_seconds",
  "status",
  "retry_count",
  "output_path",
  "error_message"
];

const sample = [
  "SKU001",
  "示例小青菜",
  "根系完整；叶片厚实；清炒清甜",
  "products/images/SKU001.png",
  "最近买菜最怕不新鲜？这个小青菜我真的会回购。根系完整，叶片厚实，清炒也很嫩。",
  "",
  "",
  20,
  "pending",
  0,
  "",
  ""
];

sheet.getRange("A1:L1").values = [headers];
sheet.getRange("A2:L2").values = [sample];

const title = sheet.getRange("A1:L1");
title.format.fill = { color: "#E8EEF8" };
title.format.font = { color: "#111827", bold: true };
title.format.rowHeight = 28;

const body = sheet.getRange("A2:L50");
body.format.borders = { preset: "insideHorizontal", style: "thin", color: "#E5E7EB" };
body.format.wrapText = true;
body.format.verticalAlignment = "top";

sheet.getRange("A:A").format.columnWidth = 14;
sheet.getRange("B:B").format.columnWidth = 22;
sheet.getRange("C:C").format.columnWidth = 36;
sheet.getRange("D:D").format.columnWidth = 32;
sheet.getRange("E:E").format.columnWidth = 48;
sheet.getRange("F:G").format.columnWidth = 18;
sheet.getRange("H:J").format.columnWidth = 15;
sheet.getRange("K:L").format.columnWidth = 32;
sheet.freezePanes.freezeRows(1);

sheet.dataValidations.add({
  range: "I2:I500",
  rule: { type: "list", values: ["pending", "running", "downloaded", "failed", "needs_review"] }
});

const notes = workbook.worksheets.add("填写说明");
notes.showGridLines = false;
notes.getRange("A1:D1").values = [["字段", "是否必填", "说明", "示例"]];
notes.getRange("A2:D13").values = [
  ["sku", "是", "唯一商品编号，用于命名成片和追踪失败任务。", "SKU001"],
  ["product_name", "是", "产品名称，建议简短。", "示例小青菜"],
  ["selling_points", "是", "核心卖点，建议用中文分号分隔。", "根系完整；叶片厚实；清炒清甜"],
  ["image_path", "是", "商品图片路径，建议放在 products/images/。", "products/images/SKU001.png"],
  ["script", "否", "口播脚本；为空时后续由文案模块生成。", "这个小青菜我真的会回购。"],
  ["avatar", "否", "飞影数字人配置，留空使用默认值。", ""],
  ["voice", "否", "声音配置，留空使用默认值。", ""],
  ["duration_seconds", "否", "视频时长，建议 15-25 秒。", "20"],
  ["status", "是", "任务状态，新任务填 pending。", "pending"],
  ["retry_count", "否", "失败重试次数。", "0"],
  ["output_path", "否", "下载后的视频路径。", ""],
  ["error_message", "否", "失败原因。", ""]
];

notes.getRange("A1:D1").format.fill = { color: "#E8EEF8" };
notes.getRange("A1:D1").format.font = { color: "#111827", bold: true };
notes.getRange("A:D").format.wrapText = true;
notes.getRange("A:A").format.columnWidth = 20;
notes.getRange("B:B").format.columnWidth = 12;
notes.getRange("C:C").format.columnWidth = 48;
notes.getRange("D:D").format.columnWidth = 32;
notes.freezePanes.freezeRows(1);

await fs.mkdir("products", { recursive: true });
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);

const inspect = await workbook.inspect({
  kind: "sheet,table",
  tableMaxRows: 4,
  tableMaxCols: 12,
  maxChars: 3000
});
console.log(inspect.ndjson);
console.log(`Saved ${outputPath}`);
