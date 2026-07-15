import path from "node:path";
import { applyRpaCallback } from "../../rpa/callbacks.js";

export async function registerRpaCallbackRoutes(app, { batchRoot, store }) {
  app.post("/api/rpa/callback", async (request, reply) => {
    const body = request.body || {};
    const batch = await store.read(body.batch_id);
    const task = batch.items.find((item) => item.task_id === body.task_id);
    if (!task) {
      reply.code(404);
      return { error: "TASK_NOT_FOUND" };
    }
    const result = await applyRpaCallback({
      batchDirectory: path.join(batchRoot, body.batch_id),
      currentTask: task,
      callback: body,
      token: request.headers["x-rpa-callback-token"],
      requestIp: request.ip
    });
    return { ok: true, result };
  });
}
