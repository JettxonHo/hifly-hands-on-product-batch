import fs from "node:fs";
import path from "node:path";

const DEFAULT_CONFIG = "config.local.json";
const EXAMPLE_CONFIG = "config.example.json";

export function loadConfig(configPath = process.env.HIFLY_CONFIG || DEFAULT_CONFIG) {
  const resolvedPath = fs.existsSync(configPath) ? configPath : EXAMPLE_CONFIG;
  const raw = fs.readFileSync(resolvedPath, "utf8");
  const config = JSON.parse(raw);

  config.__configPath = resolvedPath;
  config.__rootDir = process.cwd();
  ensureDirectory(config.downloadDir);
  ensureDirectory(config.logDir);
  ensureDirectory(config.screenshotDir);
  ensureDirectory(path.dirname(config.browser.profileDir));

  return config;
}

export function resolveFromRoot(config, relativeOrAbsolutePath) {
  if (!relativeOrAbsolutePath) return "";
  return path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(config.__rootDir, relativeOrAbsolutePath);
}

export function ensureDirectory(dirPath) {
  if (!dirPath) return;
  fs.mkdirSync(dirPath, { recursive: true });
}
