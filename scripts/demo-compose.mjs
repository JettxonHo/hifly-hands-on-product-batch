import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

import { getProjectRoot } from "../src/core/project-root.js";

export const DEMO_COMPOSE_PROJECT = "hifly-vsa-demo";
export const DEMO_COMPOSE_FILE = "docker-compose.demo.yml";
export const DEMO_DB_NAME = "hifly_vsa_demo";
export const DEMO_DB_USER = "hifly_demo";
export const DEMO_DB_PASSWORD = "demo-local-only";
export const DEFAULT_DEMO_DB_PORT = 55433;

export function demoDbPort(value = process.env.HIFLY_DEMO_DB_PORT) {
  const selected = value === undefined || value === "" ? DEFAULT_DEMO_DB_PORT : Number(value);
  if (!Number.isInteger(selected) || selected < 1 || selected > 65535) {
    throw new RangeError("HIFLY_DEMO_DB_PORT must be a valid TCP port");
  }
  return selected;
}

export function demoDatabaseUrl(port = demoDbPort()) {
  return `postgresql://${DEMO_DB_USER}:${DEMO_DB_PASSWORD}@127.0.0.1:${demoDbPort(port)}/${DEMO_DB_NAME}`;
}

async function isPortAvailable(port) {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      // Docker Desktop may reserve a host port through a wildcard proxy that
      // is not visible to a loopback-only bind probe on macOS.
      server.listen({ port }, resolve);
    });
    return true;
  } catch (error) {
    if (error?.code === "EADDRINUSE") return false;
    throw error;
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

export async function findAvailableDemoDbPort(startPort = DEFAULT_DEMO_DB_PORT) {
  const first = demoDbPort(startPort);
  for (let port = first; port <= 65535; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error("No local TCP port is available for the demo database");
}

export function composeArgs(args = []) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new TypeError("Docker Compose arguments must be strings");
  }
  return [
    "compose",
    "--project-name", DEMO_COMPOSE_PROJECT,
    "--file", DEMO_COMPOSE_FILE,
    ...args
  ];
}

export function runCompose(args, {
  root = getProjectRoot(),
  port = demoDbPort(),
  env = process.env,
  stdio = "inherit"
} = {}) {
  const cwd = path.resolve(root);
  return new Promise((resolve, reject) => {
    const child = spawn("docker", composeArgs(args), {
      cwd,
      env: { ...env, HIFLY_DEMO_DB_PORT: String(demoDbPort(port)) },
      stdio,
      shell: false
    });
    child.once("error", (error) => {
      reject(Object.assign(new Error(`Unable to run Docker Compose: ${error.message}`), {
        code: "DEMO_DOCKER_UNAVAILABLE",
        cause: error
      }));
    });
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve({ code, signal });
        return;
      }
      reject(Object.assign(new Error(`Docker Compose exited with ${signal || `code ${code}`}`), {
        code: "DEMO_DOCKER_COMMAND_FAILED",
        exitCode: code,
        signal
      }));
    });
  });
}
