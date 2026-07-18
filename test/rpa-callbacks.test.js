import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyRpaCallback } from "../src/rpa/callbacks.js";
import {
  clearRpaCallbackTokens,
  registerRpaCallbackToken
} from "../src/rpa/callback-token-registry.js";
import { readRpaState, writeRpaState } from "../src/rpa/rpa-state.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "rpa-callback-"));
  const batchDirectory = path.join(root, "batch-1");
  await mkdir(batchDirectory, { recursive: true });
  const task = { task_id: "task-1", execution_key: "key-1", status: "asset_confirmed" };
  await writeRpaState(batchDirectory, "task-1", { callback_token: "token-1", status: "asset_confirmed" });
  registerRpaCallbackToken({
    batchDirectory,
    taskId: task.task_id,
    executionKey: task.execution_key,
    token: "token-1"
  });
  return { root, batchDirectory, task };
}

test.afterEach(() => clearRpaCallbackTokens());

test("accepts valid submitted callback and writes rpa state", async () => {
  const f = await fixture();
  try {
    const result = await applyRpaCallback({
      batchDirectory: f.batchDirectory,
      currentTask: f.task,
      token: "token-1",
      requestIp: "127.0.0.1",
      callback: {
        schema_version: 1,
        batch_id: "batch-1",
        task_id: "task-1",
        execution_key: "key-1",
        status: "submitted",
        phase: "remote_submit",
        remote_evidence: { evidence_source: "yingdao_rpa", remote_id: "632410", work_key: "632410" }
      }
    });
    assert.equal(result.accepted, true);
    assert.equal((await readRpaState(f.batchDirectory, "task-1")).status, "submitted");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects wrong token, remote source, and stale execution key", async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => applyRpaCallback({
      batchDirectory: f.batchDirectory,
      currentTask: f.task,
      token: "wrong",
      requestIp: "127.0.0.1",
      callback: { schema_version: 1, batch_id: "batch-1", task_id: "task-1", execution_key: "key-1", status: "submitted" }
    }), /Invalid RPA callback token/);
    await assert.rejects(() => applyRpaCallback({
      batchDirectory: f.batchDirectory,
      currentTask: f.task,
      token: "token-1",
      requestIp: "10.0.0.8",
      callback: { schema_version: 1, batch_id: "batch-1", task_id: "task-1", execution_key: "key-1", status: "submitted" }
    }), /localhost/);
    await assert.rejects(() => applyRpaCallback({
      batchDirectory: f.batchDirectory,
      currentTask: f.task,
      token: "token-1",
      requestIp: "127.0.0.1",
      callback: { schema_version: 1, batch_id: "batch-1", task_id: "task-1", execution_key: "old", status: "submitted" }
    }), /execution_key/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("duplicate callback is idempotent and older callback does not regress", async () => {
  const f = await fixture();
  try {
    const submitted = {
      schema_version: 1,
      batch_id: "batch-1",
      task_id: "task-1",
      execution_key: "key-1",
      status: "submitted",
      phase: "remote_submit",
      remote_evidence: { evidence_source: "yingdao_rpa", remote_id: "632410", work_key: "632410" }
    };
    await applyRpaCallback({ batchDirectory: f.batchDirectory, currentTask: f.task, token: "token-1", requestIp: "::1", callback: submitted });
    const duplicate = await applyRpaCallback({ batchDirectory: f.batchDirectory, currentTask: f.task, token: "token-1", requestIp: "::1", callback: submitted });
    assert.equal(duplicate.duplicate, true);
    const older = await applyRpaCallback({
      batchDirectory: f.batchDirectory,
      currentTask: { ...f.task, status: "submitted" },
      token: "token-1",
      requestIp: "::1",
      callback: { ...submitted, status: "asset_confirmed", phase: "asset_generation" }
    });
    assert.equal(older.accepted, false);
    assert.equal((await readRpaState(f.batchDirectory, "task-1")).status, "submitted");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("ignores illegal forward jumps without changing callback state", async () => {
  const f = await fixture();
  try {
    const result = await applyRpaCallback({
      batchDirectory: f.batchDirectory,
      currentTask: f.task,
      token: "token-1",
      requestIp: "127.0.0.1",
      callback: {
        schema_version: 1,
        batch_id: "batch-1",
        task_id: "task-1",
        execution_key: "key-1",
        status: "completed"
      }
    });

    assert.equal(result.accepted, false);
    assert.equal(result.ignored, true);
    assert.equal((await readRpaState(f.batchDirectory, "task-1")).status, "asset_confirmed");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects artifact paths outside the batch directory", async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => applyRpaCallback({
      batchDirectory: f.batchDirectory,
      currentTask: f.task,
      token: "token-1",
      requestIp: "127.0.0.1",
      callback: {
        schema_version: 1,
        batch_id: "batch-1",
        task_id: "task-1",
        execution_key: "key-1",
        status: "submitted",
        artifact: { relative_path: "../outside.mp4" }
      }
    }), /safe batch-relative path/);
    assert.equal((await readRpaState(f.batchDirectory, "task-1")).status, "asset_confirmed");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects a persisted callback token that is not active in this process", async () => {
  const f = await fixture();
  try {
    clearRpaCallbackTokens();
    await assert.rejects(() => applyRpaCallback({
      batchDirectory: f.batchDirectory,
      currentTask: f.task,
      token: "token-1",
      requestIp: "127.0.0.1",
      callback: {
        schema_version: 1,
        batch_id: "batch-1",
        task_id: "task-1",
        execution_key: "key-1",
        status: "submitted"
      }
    }), /active RPA callback session/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("completed callback requires an existing regular batch-local artifact", async () => {
  const f = await fixture();
  try {
    const submitted = {
      schema_version: 1,
      batch_id: "batch-1",
      task_id: "task-1",
      execution_key: "key-1",
      status: "submitted"
    };
    await applyRpaCallback({ batchDirectory: f.batchDirectory, currentTask: f.task, token: "token-1", requestIp: "::1", callback: submitted });

    for (const artifact of [
      null,
      { artifact_id: "", relative_path: "downloads/video.mp4" },
      { artifact_id: "video-1", relative_path: "downloads/missing.mp4" },
      { artifact_id: "video-1", relative_path: "downloads/video.mp4", local_path: "/tmp/video.mp4" }
    ]) {
      await assert.rejects(() => applyRpaCallback({
        batchDirectory: f.batchDirectory,
        currentTask: { ...f.task, status: "submitted" },
        token: "token-1",
        requestIp: "::1",
        callback: { ...submitted, status: "completed", artifact }
      }), /valid existing artifact/);
    }

    const outside = path.join(f.root, "outside.mp4");
    const linked = path.join(f.batchDirectory, "linked.mp4");
    await writeFile(outside, "video");
    await symlink(outside, linked);
    await assert.rejects(() => applyRpaCallback({
      batchDirectory: f.batchDirectory,
      currentTask: { ...f.task, status: "submitted" },
      token: "token-1",
      requestIp: "::1",
      callback: {
        ...submitted,
        status: "completed",
        artifact: { artifact_id: "video-1", relative_path: "linked.mp4" }
      }
    }), /valid existing artifact/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("terminal callback revokes its token and rejects later duplicates", async () => {
  const f = await fixture();
  try {
    const artifactPath = path.join(f.batchDirectory, "downloads", "video.mp4");
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, "video");
    const completed = {
      schema_version: 1,
      batch_id: "batch-1",
      task_id: "task-1",
      execution_key: "key-1",
      status: "completed",
      artifact: { artifact_id: "video-1", relative_path: "downloads/video.mp4" }
    };
    await writeRpaState(f.batchDirectory, "task-1", { status: "submitted" });

    const result = await applyRpaCallback({
      batchDirectory: f.batchDirectory,
      currentTask: { ...f.task, status: "submitted" },
      token: "token-1",
      requestIp: "127.0.0.1",
      callback: completed
    });
    assert.equal(result.accepted, true);
    await assert.rejects(() => applyRpaCallback({
      batchDirectory: f.batchDirectory,
      currentTask: { ...f.task, status: "completed" },
      token: "token-1",
      requestIp: "127.0.0.1",
      callback: completed
    }), /active RPA callback session/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
