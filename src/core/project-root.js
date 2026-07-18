import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function getProjectRoot() {
  return ROOT;
}

export function resolveProjectPath(...segments) {
  return path.join(ROOT, ...segments);
}
