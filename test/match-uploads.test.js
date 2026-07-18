import test from "node:test";
import assert from "node:assert/strict";

import { matchUploads } from "../src/import/match-uploads.js";

function upload(logicalName, artifactId = logicalName) {
  return {
    artifact_id: artifactId,
    logical_name: logicalName,
    kind: "image",
  };
}

test("matches an explicit uploaded logical name before SKU fallback", () => {
  const result = matchUploads(
    [{ sku: "SKU001", image_path: "hero.png" }],
    [upload("SKU001.jpg"), upload("hero.png", "hero-id")],
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.items[0].product_image_artifact_id, "hero-id");
  assert.equal(result.items[0].image_path, "hero.png");
});

test("matches SKU filename stems with trim NFC and case-insensitive comparison", () => {
  const decomposed = "Cafe\u0301-001";
  const result = matchUploads(
    [{ sku: `  ${decomposed}  `, image_path: "" }],
    [upload("CAFÉ-001.JPG", "image-id")],
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.items[0].sku, "Café-001");
  assert.equal(result.items[0].product_image_artifact_id, "image-id");
});

test("preserves leading zeroes in SKU values", () => {
  const result = matchUploads(
    [{ sku: "00123", image_path: "" }],
    [upload("00123.png", "leading-zero")],
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.items[0].sku, "00123");
  assert.equal(result.items[0].product_image_artifact_id, "leading-zero");
});

test("two extensions for one SKU are ambiguous", () => {
  const result = matchUploads(
    [{ sku: "SKU001", image_path: "" }],
    [upload("SKU001.jpg"), upload("sku001.png")],
  );

  assert.equal(result.items.length, 0);
  assert.equal(result.errors[0].code, "AMBIGUOUS_PRODUCT_IMAGE");
});

test("explicit paths cannot address files outside the current upload manifest", () => {
  const result = matchUploads(
    [{ sku: "SKU001", image_path: "/tmp/SKU001.png" }],
    [upload("SKU001.png")],
  );

  assert.equal(result.items.length, 0);
  assert.equal(result.errors[0].code, "INVALID_EXPLICIT_IMAGE_NAME");
});

test("missing explicit uploaded names fail closed without SKU fallback", () => {
  const result = matchUploads(
    [{ sku: "SKU001", image_path: "missing.png" }],
    [upload("SKU001.png")],
  );

  assert.equal(result.items.length, 0);
  assert.equal(result.errors[0].code, "EXPLICIT_PRODUCT_IMAGE_NOT_FOUND");
});

test("one uploaded image cannot be assigned to multiple rows", () => {
  const result = matchUploads(
    [
      { sku: "SKU001", image_path: "shared.png" },
      { sku: "SKU002", image_path: "shared.png" },
    ],
    [upload("shared.png", "shared-id")],
  );

  assert.equal(result.items.length, 0);
  assert.deepEqual(result.errors.map((entry) => entry.code), [
    "UPLOAD_REUSED_BY_MULTIPLE_ITEMS",
    "UPLOAD_REUSED_BY_MULTIPLE_ITEMS",
  ]);
});
