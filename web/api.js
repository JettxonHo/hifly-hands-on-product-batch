(function () {
  let session = null;

  async function parseResponse(response) {
    const type = response.headers.get("content-type") || "";
    const payload = type.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const code = typeof payload === "object" && payload ? payload.error : response.statusText;
      const error = new Error(code || "REQUEST_FAILED");
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function ensureSession() {
    if (session) return session;
    const payload = await parseResponse(await fetch("/api/session", { credentials: "same-origin" }));
    session = { token: payload.token, headerName: payload.headerName };
    return session;
  }

  async function request(path, options) {
    const current = await ensureSession();
    const headers = new Headers(options?.headers || {});
    if (options?.body && !(options.body instanceof FormData) && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    if (["POST", "PUT", "PATCH", "DELETE"].includes((options?.method || "GET").toUpperCase())) {
      headers.set(current.headerName, current.token);
    }
    return parseResponse(await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin"
    }));
  }

  window.HiflyApi = {
    ensureSession,
    getRuntime: () => request("/api/runtime"),
    getBatches: () => request("/api/batches"),
    createBatch: (payload = {}) => request("/api/batches", {
      method: "POST",
      body: JSON.stringify(typeof payload === "string" ? { batchId: payload } : payload)
    }),
    importBatch: (formData, options = {}) => {
      if (options.person_strategy !== undefined) formData.append("person_strategy", options.person_strategy);
      if (options.script_strategy !== undefined) formData.append("script_strategy", options.script_strategy);
      if (options.capture?.enabled === true) formData.append("capture_enabled", "true");
      return request("/api/imports", { method: "POST", body: formData });
    },
    retryBatch: ({ batchId, allowUnknown = false }) => request(`/api/batches/${encodeURIComponent(batchId)}/retry`, {
      method: "POST",
      body: JSON.stringify({ confirm: true, ...(allowUnknown ? { allowUnknown: true } : {}) })
    }),
    extractCapture: (batchId) => request(`/api/batches/${encodeURIComponent(batchId)}/capture/extract`, {
      method: "POST",
      body: JSON.stringify({})
    }),
    redactCapture: (batchId) => request(`/api/batches/${encodeURIComponent(batchId)}/capture/redact`, {
      method: "POST",
      body: JSON.stringify({})
    }),
    replayCapture: (batchId) => request(`/api/batches/${encodeURIComponent(batchId)}/capture/replay`, {
      method: "POST",
      body: JSON.stringify({})
    }),
    startExecution: ({ batchId, idempotencyKey }) => request("/api/executions", {
      method: "POST",
      body: JSON.stringify({ batchId, idempotencyKey, confirm: true })
    })
  };
}());
