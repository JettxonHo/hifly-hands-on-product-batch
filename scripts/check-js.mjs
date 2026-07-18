import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["src", "scripts", "web"];
const extensions = new Set([".js", ".mjs"]);

const files = (await Promise.all(roots.map((root) => collect(root)))).flat().sort();

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Checked ${files.length} JavaScript file(s).`);

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collect(entryPath));
    } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }
  return files;
}
