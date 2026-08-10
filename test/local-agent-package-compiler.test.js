import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildManualHandoffZip } from "../src/manual-handoff/manual-handoff-package-store.js";
import {
  compilePackageToBatchItem,
  extractHandoffPackage,
  loadAvatarMappings
} from "../src/local-agent/package-compiler.js";

const PRODUCT_BYTES = Buffer.from("product-image");

function manifest(overrides = {}) {
  return {
    package_id: "package-1",
    package_version: 1,
    organization_id: "org-1",
    production_order_id: "order-1",
    product_id: "product-1",
    avatar_asset_version_id: "avatar-version-1",
    product_revision: {
      id: "revision-1",
      status: "ready",
      product_name: "Alpha",
      sku: "SKU-1",
      selling_points: "Useful",
      category: "beauty",
      asset_version_ids: ["product-version-1"]
    },
    copy_snapshot: {
      copy_version_id: "copy-1",
      copy_body: "先展示商品，再说明体验。"
    },
    avatar_snapshot: {
      avatar_asset_version_id: "avatar-version-1",
      display_name: "Ava",
      source_type: "seeded"
    },
    video_plan_snapshot: {
      id: "plan-1",
      output_instructions: "竖版口播"
    },
    asset_references: [{
      asset_id: "product-asset-1",
      asset_version_id: "product-version-1",
      role: "product_image",
      media_type: "image/png",
      retrieval_mode: "embedded"
    }],
    ...overrides
  };
}

async function packageZip(value, entries = []) {
  return buildManualHandoffZip([
    { name: "manifest.json", body: JSON.stringify(value) },
    { name: "assets/product-version-1", body: PRODUCT_BYTES },
    ...entries
  ]);
}

function unsafeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const body = Buffer.from(entry.body);
    const local = Buffer.alloc(30 + name.length + body.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    body.copy(local, 30 + name.length);
    localParts.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length;
  }
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, eocd]);
}

test("loads avatar_asset_version_id mappings from a JSON config and compiles one batch item", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-agent-compiler-test-"));
  const avatarPath = path.join(root, "avatar.png");
  const configPath = path.join(root, "avatars.json");
  await mkdir(path.join(root, "assets"), { recursive: true });
  await writeFile(avatarPath, "avatar-image");
  await writeFile(path.join(root, "assets", "product-version-1"), PRODUCT_BYTES);
  await writeFile(configPath, JSON.stringify({ avatar_asset_version_paths: { "avatar-version-1": avatarPath } }));

  try {
    const mappings = await loadAvatarMappings(configPath);
    const item = await compilePackageToBatchItem({
      manifest: manifest(),
      extractionRoot: root,
      avatarMappings: mappings,
      taskId: "task-order-1"
    });

    assert.equal(item.task_id, "task-order-1");
    assert.equal(item.sku, "SKU-1");
    assert.equal(item.product_name, "Alpha");
    assert.equal(item.script, "先展示商品，再说明体验。");
    assert.equal(item.image_path, path.join(root, "assets", "product-version-1.png"));
    assert.deepEqual(await readFile(item.image_path), PRODUCT_BYTES);
    assert.equal(item.resolved_person_image_path, avatarPath);
    assert.equal(item.resolved_person_source, "local_agent_mapping");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing avatar mapping is reported before an executor can receive a batch item", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-agent-compiler-test-"));
  await mkdir(path.join(root, "assets"), { recursive: true });
  await writeFile(path.join(root, "assets", "product-version-1"), PRODUCT_BYTES);
  try {
    await assert.rejects(
      () => compilePackageToBatchItem({ manifest: manifest(), extractionRoot: root, avatarMappings: {} }),
      { code: "AVATAR_MAPPING_REQUIRED" }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("multiple declared products are rejected as an unsupported local-agent package", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-agent-compiler-test-"));
  const avatarPath = path.join(root, "avatar.png");
  await writeFile(avatarPath, "avatar-image");
  try {
    await assert.rejects(
      () => compilePackageToBatchItem({
        manifest: manifest({ items: [{ product_id: "product-1" }, { product_id: "product-2" }] }),
        extractionRoot: root,
        avatarMappings: { "avatar-version-1": avatarPath }
      }),
      { code: "PACKAGE_ITEM_COUNT_UNSUPPORTED" }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("package extraction rejects Zip Slip entries without writing outside the extraction root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-agent-compiler-test-"));
  const extractionRoot = path.join(root, "package");
  const outsidePath = path.join(root, "outside.txt");
  await mkdir(extractionRoot, { recursive: true });
  const zip = unsafeStoredZip([
    { name: "manifest.json", body: JSON.stringify(manifest()) },
    { name: "../outside.txt", body: "must-not-write" }
  ]);

  try {
    await assert.rejects(
      () => extractHandoffPackage(zip, extractionRoot),
      { code: "LOCAL_AGENT_ZIP_SLIP" }
    );
    await assert.rejects(() => access(outsidePath));
    await assert.rejects(() => access(path.join(extractionRoot, "outside.txt")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("safe package extraction writes only package-relative files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-agent-compiler-test-"));
  const extractionRoot = path.join(root, "package");
  await mkdir(extractionRoot, { recursive: true });
  const zip = await packageZip(manifest(), [{ name: "notes/input.txt", body: "local-only" }]);

  try {
    const extracted = await extractHandoffPackage(zip, extractionRoot);
    assert.equal(extracted.manifest.package_id, "package-1");
    assert.deepEqual(await readFile(path.join(extractionRoot, "notes", "input.txt"), "utf8"), "local-only");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
