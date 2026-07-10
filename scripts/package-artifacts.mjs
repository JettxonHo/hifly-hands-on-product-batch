import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const outputDir = "outputs/package";
const archivePath = "outputs/hifly-hands-on-product-batch.tar.gz";

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

const entries = [
  ".env.example",
  ".gitignore",
  "README.md",
  "config.example.json",
  "package.json",
  "assets",
  "docs",
  "products/products.csv",
  "products/商品信息表.xlsx",
  "scripts",
  "src"
];

for (const entry of entries) {
  await copyEntry(entry, path.join(outputDir, entry));
}

await fs.rm(archivePath, { force: true });
const result = spawnSync("tar", ["-czf", archivePath, "-C", outputDir, "."], {
  stdio: "inherit"
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Packaged ${archivePath}`);

async function copyEntry(from, to) {
  if (path.basename(from) === ".DS_Store") return;

  const stat = await fs.stat(from);
  if (stat.isDirectory()) {
    await fs.mkdir(to, { recursive: true });
    const children = await fs.readdir(from);
    for (const child of children) {
      await copyEntry(path.join(from, child), path.join(to, child));
    }
    return;
  }

  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}
