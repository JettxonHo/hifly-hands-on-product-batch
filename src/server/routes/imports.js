import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { importProductTable } from "../../import/import-table.js";
import { matchUploads } from "../../import/match-uploads.js";
import { validateScriptStrategy } from "../../core/script-strategy.js";
import { storeUpload } from "../upload-service.js";
import { assertBatchId, normalizeBatchStrategies, publicBatch } from "./batches.js";

function importError(code, statusCode = 400) {
  return Object.assign(new Error(code), { code, statusCode });
}

function safeStorageName(value) {
  return typeof value === "string" && /^[0-9a-f-]{36}\.(?:jpg|jpeg|png|csv|xlsx)$/.test(value);
}

function publicUpload(record) {
  return {
    artifact_id: record.artifact_id,
    logical_name: record.logical_name,
    storage_name: record.storage_name,
    extension: record.extension,
    kind: record.kind,
    size: record.size
  };
}

async function storeMultipartUpload(part, batchDirectory, uploadLimits) {
  if (part.fieldname !== "file" && part.fieldname !== "files" && part.fieldname !== "fixed_person_file") {
    part.file.resume();
    throw importError("INVALID_UPLOAD_FIELD");
  }
  const upload = await storeUpload(part.file, {
    filename: part.filename,
    declaredMime: part.mimetype
  }, { root: batchDirectory, uploadsDir: path.join(batchDirectory, "uploads"), limits: uploadLimits });
  return publicUpload(upload);
}

function makeItems(matches) {
  return matches.map((item) => ({
    ...item,
    task_id: `task-${randomUUID()}`,
    status: "pending",
    confirmed_at: null,
    execution_key: null
  }));
}

function personPathIssues(rows) {
  return rows.flatMap((row, index) => {
    if (!row?.person_image_path && !row?.resolved_person_image_path) return [];
    return [{
      code: "PERSON_IMAGE_PATH_NOT_ALLOWED",
      row: index + 2,
      sku: row?.sku ?? ""
    }];
  });
}

async function cleanupUploads(batchDirectory, uploads) {
  await Promise.all((uploads ?? []).map((upload) =>
    rm(path.join(batchDirectory, "uploads", upload.storage_name), { force: true }).catch(() => {})
  ));
}

export async function registerImportRoutes(app, { batchRoot, store, uploadLimits = null }) {
  app.post("/api/imports", async (request, reply) => {
    let batchId = null;
    let batchDirectory = null;
    const newUploads = [];
    const metadata = {};
    let fixedPersonUpload = null;

    try {
      for await (const part of request.parts()) {
        if (part.type === "field") {
          if (part.fieldname === "batchId") {
            if (batchId !== null || typeof part.value !== "string") throw importError("INVALID_IMPORT_FIELDS");
            batchId = assertBatchId(part.value);
            await store.read(batchId);
            batchDirectory = path.join(batchRoot, batchId);
            await mkdir(path.join(batchDirectory, "uploads"), { recursive: true, mode: 0o700 });
            continue;
          }
          if (part.fieldname === "person_strategy") metadata.person_strategy = part.value;
          else if (part.fieldname === "script_strategy") metadata.script_strategy = part.value;
          else throw importError("INVALID_IMPORT_FIELDS");
          continue;
        }
        if (!batchId || !batchDirectory) {
          part.file.resume();
          throw importError("BATCH_ID_MUST_PRECEDE_FILES");
        }
        if (part.fieldname === "fixed_person_file" && fixedPersonUpload) {
          part.file.resume();
          throw importError("EXACTLY_ONE_FIXED_PERSON_FILE");
        }
        const upload = await storeMultipartUpload(part, batchDirectory, uploadLimits);
        newUploads.push(upload);
        if (part.fieldname === "fixed_person_file") {
          if (upload.kind !== "image") throw importError("FIXED_PERSON_FILE_MUST_BE_IMAGE");
          fixedPersonUpload = upload;
        }
      }

      if (!batchId || newUploads.length === 0) throw importError("IMPORT_FILES_REQUIRED");
      const tables = newUploads.filter((upload) => upload.kind === "table");
      if (tables.length !== 1) throw importError("EXACTLY_ONE_TABLE_REQUIRED");

      const table = tables[0];
      if (!safeStorageName(table.storage_name)) throw importError("UNSAFE_TABLE_REFERENCE");
      const parsed = await importProductTable(path.join(batchDirectory, "uploads", table.storage_name));
      const current = await store.read(batchId);
      const strategies = normalizeBatchStrategies({ ...current, ...metadata });
      if (fixedPersonUpload && strategies.person_strategy !== "fixed_upload") {
        throw importError("FIXED_PERSON_FILE_REQUIRES_FIXED_UPLOAD");
      }
      if (strategies.person_strategy === "fixed_upload" && !fixedPersonUpload) {
        throw importError("FIXED_PERSON_FILE_REQUIRED");
      }
      const proposedUploads = [...(Array.isArray(current.uploads) ? current.uploads : []), ...newUploads];
      const matches = matchUploads(parsed.rows, proposedUploads.filter((upload) => upload !== fixedPersonUpload));
      const scriptIssues = parsed.rows.flatMap((row, index) =>
        validateScriptStrategy(row, strategies.script_strategy, index + 2)
      );
      const issues = [...parsed.errors, ...personPathIssues(parsed.rows), ...scriptIssues, ...matches.errors];
      if (issues.length > 0) {
        await cleanupUploads(batchDirectory, newUploads);
        reply.code(422);
        return { errors: issues, unknownColumns: parsed.unknownColumns };
      }

      const batch = await store.update(batchId, (value) => {
        if (value.items?.length > 0) throw importError("BATCH_ALREADY_IMPORTED", 409);
        return {
          ...value,
          status: "pending",
          ...strategies,
          ...(fixedPersonUpload ? { fixed_person_image_artifact_id: fixedPersonUpload.artifact_id } : {}),
          uploads: [...(Array.isArray(value.uploads) ? value.uploads : []), ...newUploads],
          artifacts: [
            ...(Array.isArray(value.artifacts) ? value.artifacts : []),
            ...newUploads.map((upload) => ({
              artifact_id: upload.artifact_id,
              relative_path: `uploads/${upload.storage_name}`
            }))
          ],
          items: makeItems(matches.items),
          import_summary: {
            table_artifact_id: table.artifact_id,
            row_count: matches.items.length,
            unknown_columns: parsed.unknownColumns
          }
        };
      });
      return { batch: publicBatch(batch) };
    } catch (error) {
      if (batchDirectory) await cleanupUploads(batchDirectory, newUploads);
      throw error;
    }
  });
}
