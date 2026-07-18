import fs from "node:fs";
import path from "node:path";

const DEFAULT_CONFIG = "config.local.json";
const EXAMPLE_CONFIG = "config.example.json";

export function loadConfig(configPath = process.env.HIFLY_CONFIG || DEFAULT_CONFIG) {
  const requestedPath = path.resolve(configPath);
  const fallbackPath = path.join(path.dirname(requestedPath), EXAMPLE_CONFIG);
  const resolvedPath = fs.existsSync(requestedPath) ? requestedPath : fallbackPath;
  const raw = fs.readFileSync(resolvedPath, "utf8");
  const config = JSON.parse(raw);
  const rootDir = path.dirname(resolvedPath);

  config.__configPath = resolvedPath;
  config.__rootDir = rootDir;
  ensureDirectory(resolveFromRoot(config, config.downloadDir));
  ensureDirectory(resolveFromRoot(config, config.logDir));
  ensureDirectory(resolveFromRoot(config, config.screenshotDir));
  ensureDirectory(path.dirname(resolveFromRoot(config, config.browser.profileDir)));

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
