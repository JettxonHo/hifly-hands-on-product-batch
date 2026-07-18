import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateProducts } from "../src/core/product-validation.js";

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hifly-validation-"));
  const config = {
    __rootDir: root,
    behavior: { useRecommendedPersonWhenMissing: true },
    personPool: {
      enabled: true,
      rootDir: "assets/person_pool",
      defaultCategory: "default",
      fallbackToRecommended: true,
      allowedExtensions: [".jpg", ".jpeg", ".png"]
    }
  };

  return {
    root,
    config,
    batchPaths: { root },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
  };
}

test("validation returns field errors without exiting", () => {
  const fixture = createFixture();
  try {
    const result = validateProducts({
      products: [{
        sku: "A",
        product_name: "",
        selling_points: "gentle formula",
        category: "beauty",
        image_path: "missing.png",
        status: "pending",
        __rowNumber: 2
      }],
      config: fixture.config,
      batchPaths: fixture.batchPaths
    });

    assert.equal(result.valid, false);
    assert.deepEqual(result.errors.map((error) => error.code), [
      "PRODUCT_NAME_REQUIRED",
      "IMAGE_NOT_FOUND"
    ]);
    assert.equal(result.errors[0].row, 2);
    assert.equal(result.errors[0].field, "product_name");
  } finally {
    fixture.cleanup();
  }
});

test("validation returns normalized items and warnings for a valid product", () => {
  const fixture = createFixture();
  try {
    fs.writeFileSync(path.join(fixture.root, "product.png"), "fixture");
    const source = {
      sku: " A ",
      product_name: " Serum ",
      selling_points: " Gentle formula ",
      category: " Beauty ",
      image_path: "product.png",
      status: "pending",
      __rowNumber: 2
    };

    const result = validateProducts({
      products: [source],
      config: fixture.config,
      batchPaths: fixture.batchPaths
    });

    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.deepEqual(result.items, [source]);
    assert.deepEqual(result.warnings, []);
  } finally {
    fixture.cleanup();
  }
});

test("validation reports missing required columns once", () => {
  const fixture = createFixture();
  try {
    const result = validateProducts({
      products: [{ sku: "A", __rowNumber: 2 }],
      config: fixture.config,
      batchPaths: fixture.batchPaths
    });

    assert.deepEqual(
      result.errors.filter((error) => error.code === "MISSING_COLUMN").map((error) => error.field),
      ["product_name", "selling_points", "category", "image_path", "status"]
    );
  } finally {
    fixture.cleanup();
  }
});

test("validation rejects empty category and status values", () => {
  const fixture = createFixture();
  try {
    fs.writeFileSync(path.join(fixture.root, "product.png"), "fixture");
    const result = validateProducts({
      products: [{
        sku: "A",
        product_name: "Serum",
        selling_points: "Gentle formula",
        category: " ",
        image_path: "product.png",
        status: "",
        __rowNumber: 2
      }],
      config: fixture.config,
      batchPaths: fixture.batchPaths
    });

    assert.deepEqual(result.errors.map((error) => error.code), [
      "CATEGORY_REQUIRED",
      "STATUS_REQUIRED"
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("provided_script strategy requires script before execution", () => {
  const fixture = createFixture();
  try {
    fs.writeFileSync(path.join(fixture.root, "product.png"), "fixture");
    const result = validateProducts({
      products: [{
        sku: "A",
        product_name: "Alpha",
        selling_points: "One",
        category: "toy",
        image_path: "product.png",
        status: "pending",
        script: ""
      }],
      config: fixture.config,
      batchPaths: fixture.batchPaths,
      options: { script_strategy: "provided_script" }
    });

    assert.equal(result.valid, false);
    assert.equal(result.errors[0].code, "SCRIPT_REQUIRED");
  } finally {
    fixture.cleanup();
  }
});

test("validation accepts a resolved fixed-upload person when fallbacks are disabled", () => {
  const fixture = createFixture();
  try {
    fs.writeFileSync(path.join(fixture.root, "product.png"), "fixture");
    fixture.config.personPool.enabled = false;
    fixture.config.personPool.fallbackToRecommended = false;
    fixture.config.behavior.useRecommendedPersonWhenMissing = false;

    const result = validateProducts({
      products: [{
        sku: "A",
        product_name: "Alpha",
        selling_points: "One",
        category: "toy",
        image_path: "product.png",
        status: "pending",
        resolved_person_source: "fixed_upload",
        resolved_person_image_path: path.join(fixture.root, "fixed-person.png")
      }],
      config: fixture.config,
      batchPaths: fixture.batchPaths
    });

    assert.equal(result.valid, true);
    assert.equal(result.errors.some((error) => error.code === "PERSON_IMAGE_UNAVAILABLE"), false);
  } finally {
    fixture.cleanup();
  }
});
