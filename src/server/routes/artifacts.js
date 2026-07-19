import path from "node:path";
import { lstat, readFile, realpath } from "node:fs/promises";

import { assertBatchId } from "./batches.js";

function isSafeRelativePath(value) {
  return typeof value === "string" && value.length > 0 &&
    !path.isAbsolute(value) && !path.win32.isAbsolute(value) &&
    !value.split(/[\\/]+/).some((part) => part === "" || part === "..");
}

function contained(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function safeAsciiAttachmentName(filename) {
  const fallback = filename
    .replace(/[\r\n"]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/[/\\]/g, "_");
  return fallback && fallback !== "." && fallback !== ".." ? fallback : "artifact.bin";
}

function attachmentDisposition(relativePath) {
  const filename = path.basename(relativePath) || "artifact.bin";
  return `attachment; filename="${safeAsciiAttachmentName(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function registerArtifactRoutes(app, { batchRoot, store }) {
  app.get("/api/artifacts/:batchId/:artifactId", async (request, reply) => {
    const batchId = assertBatchId(request.params.batchId);
    const artifactId = request.params.artifactId;
    const batch = await store.read(batchId);
    const artifact = batch.artifacts?.find((candidate) => candidate.artifact_id === artifactId);
    if (!artifact || !isSafeRelativePath(artifact.relative_path)) {
      throw Object.assign(new Error("Artifact not found"), { code: "ARTIFACT_NOT_FOUND" });
    }

    const batchDirectory = path.join(batchRoot, batchId);
    const candidatePath = path.resolve(batchDirectory, artifact.relative_path);
    if (!contained(batchDirectory, candidatePath)) {
      throw Object.assign(new Error("Artifact not found"), { code: "ARTIFACT_NOT_FOUND" });
    }
    const [realBatchDirectory, realArtifactPath, info] = await Promise.all([
      realpath(batchDirectory), realpath(candidatePath), lstat(candidatePath)
    ]);
    if (!contained(realBatchDirectory, realArtifactPath) || info.isSymbolicLink() || !info.isFile()) {
      throw Object.assign(new Error("Artifact not found"), { code: "ARTIFACT_NOT_FOUND" });
    }

    reply
      .type("application/octet-stream")
      .header("content-disposition", attachmentDisposition(artifact.relative_path));
    return readFile(realArtifactPath);
  });
}
