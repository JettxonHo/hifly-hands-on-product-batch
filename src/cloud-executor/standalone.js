import { createServer } from "node:http";

const READINESS_VALUES = new Set([
  "disabled",
  "fail_closed",
  "unconfigured",
  "requires_login",
  "storage_blocked",
  "available",
  "busy",
  "requires_action",
  "standby",
  "running",
  "halted",
  "starting"
]);

function safeReadiness(value) {
  return READINESS_VALUES.has(value) ? value : "requires_action";
}

function healthBody(processRuntime) {
  const config = processRuntime?.config || {};
  const runtime = processRuntime?.runtime || {};
  const readiness = safeReadiness(processRuntime?.startup?.status || runtime.status || "starting");
  const worker = runtime.worker
    ? runtime.worker.halted ? "halted" : runtime.worker.stopped ? "standby" : "running"
    : "standby";
  const claimEnabled = Boolean(runtime.service && runtime.status === "running" && config.enabled === true &&
    config.configured === true && ["fake", "playwright"].includes(config.mode) && !runtime.worker?.halted);
  return {
    status: "ok",
    runtime: "cloud_executor",
    readiness,
    worker,
    concurrency: config.worker?.concurrency === 1 ? 1 : 1,
    claim_enabled: claimEnabled
  };
}

export function createCloudExecutorHealthServer({ processRuntime, host = "127.0.0.1", port = 3001,
  serverFactory = createServer } = {}) {
  if (!processRuntime || typeof processRuntime !== "object") throw new TypeError("cloud executor process runtime is required");
  if (typeof serverFactory !== "function") throw new TypeError("serverFactory is required");
  let server = null;
  let listening = null;

  function respond(response, statusCode, body) {
    response.statusCode = statusCode;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify(body));
  }

  function create() {
    server = serverFactory((request, response) => {
      if (request.method === "GET" && request.url?.split("?", 1)[0] === "/healthz") {
        respond(response, 200, healthBody(processRuntime));
        return;
      }
      respond(response, 404, { error: "NOT_FOUND" });
    });
    server.on?.("clientError", (_error, socket) => socket.destroy());
    return server;
  }

  return {
    async listen() {
      if (listening) return listening;
      const selected = server || create();
      listening = new Promise((resolve, reject) => {
        const onError = (error) => { selected.off?.("listening", onListening); listening = null; reject(error); };
        const onListening = () => { selected.off?.("error", onError); resolve(); };
        selected.once("error", onError);
        selected.once("listening", onListening);
        selected.listen(port, host);
      });
      await listening;
    },
    address() { return server?.address?.() || null; },
    async close() {
      if (!server || !server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      listening = null;
    }
  };
}

export { healthBody };
