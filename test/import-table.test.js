import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";

import { importProductTable } from "../src/import/import-table.js";

const fixture = path.resolve("test/fixtures/products.csv");

async function tempFile(name, contents) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hifly-import-"));
  const filePath = path.join(dir, name);
  await writeFile(filePath, contents);
  return filePath;
}

async function workbookFile(setup) {
  const workbook = new ExcelJS.Workbook();
  await setup(workbook);
  const buffer = await workbook.xlsx.writeBuffer();
  return tempFile("products.xlsx", buffer);
}

test("imports UTF-8 BOM CSV, preserves leading zero SKU, and reports unknown columns", async () => {
  const result = await importProductTable(fixture);

  assert.equal(result.sheetName, null);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].sku, "00123");
  assert.equal(result.rows[0].product_name, "山野小青菜");
  assert.deepEqual(result.unknownColumns, ["extra_note"]);
  assert.equal("extra_note" in result.rows[0], false);
});

test("rejects duplicate CSV headers with a stable code", async () => {
  const filePath = await tempFile(
    "duplicate.csv",
    "sku,product_name,selling_points,category,image_path,sku\n001,A,B,C,A.png,002\n",
  );

  const result = await importProductTable(filePath);
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors[0].code, "DUPLICATE_HEADER");
});

test("rejects non-UTF-8 CSV instead of replacing invalid bytes", async () => {
  const filePath = await tempFile("invalid.csv", Buffer.from([0x73, 0x6b, 0x75, 0x0a, 0xff]));
  const result = await importProductTable(filePath);

  assert.equal(result.errors[0].code, "INVALID_CSV_ENCODING");
});

test("reads the first visible XLSX sheet", async () => {
  const filePath = await workbookFile(async (workbook) => {
    const hidden = workbook.addWorksheet("隐藏表", { state: "hidden" });
    hidden.addRow(["sku", "product_name", "selling_points", "category", "image_path"]);
    hidden.addRow(["BAD", "隐藏", "隐藏", "hidden", "bad.png"]);
    const visible = workbook.addWorksheet("商品信息");
    visible.addRow(["sku", "product_name", "selling_points", "category", "image_path"]);
    visible.addRow(["0007", "商品", "卖点", "beauty", "0007.png"]);
  });

  const result = await importProductTable(filePath);
  assert.equal(result.sheetName, "商品信息");
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].sku, "0007");
});

test("reports XLSX formulas without cached values", async () => {
  const filePath = await workbookFile(async (workbook) => {
    const sheet = workbook.addWorksheet("商品信息");
    sheet.addRow(["sku", "product_name", "selling_points", "category", "image_path"]);
    sheet.addRow(["SKU1", { formula: '"商品"' }, "卖点", "beauty", "SKU1.png"]);
  });

  const result = await importProductTable(filePath);
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors[0].code, "FORMULA_WITHOUT_CACHED_VALUE");
});

test("detects duplicate SKU using trim, NFC, and case-insensitive comparison", async () => {
  const filePath = await tempFile(
    "duplicates.csv",
    "sku,product_name,selling_points,category,image_path\nCafé,商品1,卖点,food,a.png\n café ,商品2,卖点,food,b.png\n",
  );

  const result = await importProductTable(filePath);
  assert.equal(result.rows.length, 2);
  assert.equal(result.errors.find((entry) => entry.code === "DUPLICATE_SKU")?.row, 3);
});

test("rejects unsupported table extensions", async () => {
  const filePath = await tempFile("products.xls", "not a workbook");
  const result = await importProductTable(filePath);

  assert.equal(result.errors[0].code, "UNSUPPORTED_TABLE_TYPE");
});

test("fails closed when an XLSX central-directory entry traverses directories", async () => {
  const filePath = await workbookFile(async (workbook) => {
    const sheet = workbook.addWorksheet("商品信息");
    sheet.addRow(["sku", "product_name", "selling_points", "category", "image_path"]);
    sheet.addRow(["SKU1", "商品", "卖点", "beauty", "SKU1.png"]);
  });
  const buffer = await import("node:fs/promises").then(({ readFile }) => readFile(filePath));
  const marker = Buffer.from("[Content_Types].xml");
  const index = buffer.indexOf(marker, Math.floor(buffer.length / 2));
  assert.notEqual(index, -1);
  Buffer.from("../evil-entry.xml  ").copy(buffer, index);
  const unsafePath = await tempFile("unsafe.xlsx", buffer);

  const result = await importProductTable(unsafePath);
  assert.equal(result.errors[0].code, "UNSAFE_XLSX_ENTRY");
});
