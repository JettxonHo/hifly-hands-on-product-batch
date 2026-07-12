import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const PACKAGE_ENTRIES = Object.freeze([
  ".env.example",
  ".gitignore",
  "README.md",
  "config.example.json",
  "package.json",
  "package-lock.json",
  "assets/person_pool",
  "docs/ENVIRONMENT.md",
  "docs/SOP.md",
  "docs/新人培训使用手册.html",
  "products/products.csv",
  "products/商品信息表.xlsx",
  "scripts/check-js.mjs",
  "scripts/package-artifacts.mjs",
  "src",
  "test",
  "web"
]);

export const PACKAGE_EXCLUDES = Object.freeze([
  ".DS_Store",
  ".git",
  "node_modules",
  "workspace",
  "batches",
  "config.local.json",
  "playwright/.auth",
  "playwright/profile",
  "downloads",
  "logs",
  "outputs",
  "screenshots",
  "tmp"
]);

export async function packageArtifacts({
  root = process.cwd(),
  outputDir = "outputs/package",
  archivePath = "outputs/hifly-hands-on-product-batch.tar.gz",
  entries = PACKAGE_ENTRIES
} = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedOutputDir = path.resolve(resolvedRoot, outputDir);
  const resolvedArchivePath = path.resolve(resolvedRoot, archivePath);

  await fs.rm(resolvedOutputDir, { recursive: true, force: true });
  await fs.mkdir(resolvedOutputDir, { recursive: true });

  for (const entry of entries) {
    const from = path.resolve(resolvedRoot, entry);
    const to = path.join(resolvedOutputDir, entry);
    await copyEntry(from, to, resolvedRoot);
  }

  await fs.rm(resolvedArchivePath, { force: true });
  const result = spawnSync("tar", ["-czf", resolvedArchivePath, "-C", resolvedOutputDir, "."], {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    const error = new Error("Packaging archive failed");
    error.exitCode = result.status ?? 1;
    throw error;
  }

  return { outputDir: resolvedOutputDir, archivePath: resolvedArchivePath };
}

function relativeKey(root, value) {
  return path.relative(root, value).split(path.sep).join("/");
}

function excluded(root, value) {
  const key = relativeKey(root, value);
  return PACKAGE_EXCLUDES.some((pattern) => key === pattern || key.startsWith(`${pattern}/`));
}

async function copyEntry(from, to, root) {
  if (excluded(root, from) || path.basename(from) === ".DS_Store") return;

  const stat = await fs.stat(from);
  if (stat.isDirectory()) {
    await fs.mkdir(to, { recursive: true });
    const children = await fs.readdir(from);
    for (const child of children) {
      await copyEntry(path.join(from, child), path.join(to, child), root);
    }
    return;
  }

  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

function isDirectExecution() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) {
  try {
    const result = await packageArtifacts();
    console.log(`Packaged ${path.relative(process.cwd(), result.archivePath)}`);
  } catch (error) {
    console.error(error.message);
    process.exit(error.exitCode ?? 1);
  }
}
