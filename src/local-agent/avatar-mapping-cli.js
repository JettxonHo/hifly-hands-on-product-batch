import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { EXIT_CODES } from "./errors.js";

const MAPPING_KEYS = ["avatar_asset_version_paths", "avatarMappings", "avatar_mappings", "mappings"];

function clean(value) { return typeof value === "string" ? value.trim() : ""; }

function mappingKey(config) {
  return MAPPING_KEYS.find((key) => config[key] && typeof config[key] === "object" && !Array.isArray(config[key])) || "avatar_asset_version_paths";
}

function assertVersionId(value) {
  const id = clean(value);
  if (!id || id.length > 256 || /[\u0000\r\n]/u.test(id)) throw new Error("AVATAR_MAPPING_ID_INVALID");
  return id;
}

function assertAbsolutePath(value) {
  const filePath = clean(value);
  if (!filePath || !path.isAbsolute(filePath) || filePath.includes("\u0000")) throw new Error("AVATAR_MAPPING_PATH_MUST_BE_ABSOLUTE");
  return filePath;
}

async function readConfig(configPath, { allowMissing = false } = {}) {
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid object");
    return parsed;
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return {};
    if (error?.code === "ENOENT") throw new Error("AVATAR_MAPPING_CONFIG_NOT_FOUND");
    throw new Error("AVATAR_MAPPING_CONFIG_INVALID");
  }
}

function mappingsFrom(config) {
  const value = config[mappingKey(config)];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, filePath]) => clean(id) && typeof filePath === "string" && clean(filePath)));
}

async function writeConfig(configPath, config) {
  const directory = path.dirname(configPath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, configPath);
}

export async function listAvatarMappings(configPath) {
  const config = await readConfig(configPath, { allowMissing: true });
  return mappingsFrom(config);
}

export async function setAvatarMapping(configPath, versionId, filePath) {
  const id = assertVersionId(versionId), absolutePath = assertAbsolutePath(filePath);
  const file = await stat(absolutePath).catch(() => null);
  if (!file?.isFile()) throw new Error("AVATAR_MAPPING_PATH_NOT_FILE");
  const config = await readConfig(configPath, { allowMissing: true });
  const key = mappingKey(config), mappings = mappingsFrom(config);
  config[key] = { ...mappings, [id]: absolutePath };
  await writeConfig(configPath, config);
  return { avatar_asset_version_id: id, path: absolutePath, config_path: configPath };
}

export async function removeAvatarMapping(configPath, versionId) {
  const id = assertVersionId(versionId);
  const config = await readConfig(configPath);
  const key = mappingKey(config), mappings = mappingsFrom(config);
  if (!Object.hasOwn(mappings, id)) throw new Error("AVATAR_MAPPING_NOT_FOUND");
  delete mappings[id]; config[key] = mappings;
  await writeConfig(configPath, config);
  return { avatar_asset_version_id: id, config_path: configPath };
}

function optionValue(argv, name) {
  const index = argv.findIndex((value) => value === name);
  if (index >= 0) return argv[index + 1] || "";
  return argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

function positionalArgs(argv) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--config") { index += 1; continue; }
    if (argv[index].startsWith("--config=")) continue;
    values.push(argv[index]);
  }
  return values;
}

export async function main({ argv = [], env = process.env, root = process.cwd(), logger = console } = {}) {
  const values = positionalArgs(argv), command = values[0] || "list";
  const configPath = path.resolve(optionValue(argv, "--config") || env.LOCAL_AGENT_AVATAR_MAPPING_FILE || path.join(root, "config.local-agent.json"));
  try {
    if (command === "set") {
      const result = await setAvatarMapping(configPath, values[1], values[2]);
      logger.log?.(JSON.stringify({ status: "ok", action: "set", ...result }));
      return { status: "ok", exitCode: EXIT_CODES.success, ...result };
    }
    if (command === "list") {
      const mappings = await listAvatarMappings(configPath);
      logger.log?.(JSON.stringify({ status: "ok", action: "list", config_path: configPath, avatar_asset_version_paths: mappings }));
      return { status: "ok", exitCode: EXIT_CODES.success, config_path: configPath, mappings };
    }
    if (command === "remove") {
      const result = await removeAvatarMapping(configPath, values[1]);
      logger.log?.(JSON.stringify({ status: "ok", action: "remove", ...result }));
      return { status: "ok", exitCode: EXIT_CODES.success, ...result };
    }
    throw new Error("AVATAR_MAPPING_COMMAND_INVALID");
  } catch (error) {
    logger.error?.(error.code || error.message || "AVATAR_MAPPING_COMMAND_FAILED");
    return { status: "failed", exitCode: EXIT_CODES.requiresAction, code: error.code || error.message };
  }
}
