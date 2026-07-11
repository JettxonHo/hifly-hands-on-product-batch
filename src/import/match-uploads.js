import path from "node:path";

function normalizeValue(value) {
  return String(value ?? "").trim().normalize("NFC");
}

function comparisonKey(value) {
  return normalizeValue(value).toLocaleLowerCase("und");
}

function isPlainLogicalName(value) {
  if (!value || path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    return false;
  }
  return !value.includes("/") && !value.includes("\\") && value !== "." && value !== "..";
}

function imageUploads(uploads) {
  return uploads.filter((upload) => upload?.kind === "image" && upload.logical_name && upload.artifact_id);
}

function error(code, rowIndex, sku, details = {}) {
  return { code, row: rowIndex + 2, sku, ...details };
}

export function matchUploads(rows, uploads) {
  const available = imageUploads(Array.isArray(uploads) ? uploads : []);
  const candidates = [];
  const errors = [];

  for (const [rowIndex, sourceRow] of (Array.isArray(rows) ? rows : []).entries()) {
    const sku = normalizeValue(sourceRow?.sku);
    const explicitName = normalizeValue(sourceRow?.image_path);
    let matches;

    if (!sku) {
      errors.push(error("MISSING_SKU", rowIndex, sku));
      continue;
    }

    if (explicitName) {
      if (!isPlainLogicalName(explicitName)) {
        errors.push(error("INVALID_EXPLICIT_IMAGE_NAME", rowIndex, sku));
        continue;
      }
      const key = comparisonKey(explicitName);
      matches = available.filter((upload) => comparisonKey(upload.logical_name) === key);
      if (matches.length === 0) {
        errors.push(error("EXPLICIT_PRODUCT_IMAGE_NOT_FOUND", rowIndex, sku, { logical_name: explicitName }));
        continue;
      }
    } else {
      const key = comparisonKey(sku);
      matches = available.filter((upload) => {
        const stem = path.parse(normalizeValue(upload.logical_name)).name;
        return comparisonKey(stem) === key;
      });
      if (matches.length === 0) {
        errors.push(error("PRODUCT_IMAGE_NOT_FOUND", rowIndex, sku));
        continue;
      }
    }

    if (matches.length > 1) {
      errors.push(error("AMBIGUOUS_PRODUCT_IMAGE", rowIndex, sku, {
        candidates: matches.map((match) => match.logical_name).sort(),
      }));
      continue;
    }

    const match = matches[0];
    candidates.push({
      ...sourceRow,
      sku,
      image_path: match.logical_name,
      product_image_artifact_id: match.artifact_id,
      __matchRowIndex: rowIndex,
    });
  }

  const usage = new Map();
  for (const candidate of candidates) {
    const id = candidate.product_image_artifact_id;
    usage.set(id, (usage.get(id) || 0) + 1);
  }
  const items = [];
  for (const candidate of candidates) {
    const { __matchRowIndex: rowIndex, ...item } = candidate;
    if (usage.get(item.product_image_artifact_id) > 1) {
      errors.push(error("UPLOAD_REUSED_BY_MULTIPLE_ITEMS", rowIndex, item.sku, {
        artifact_id: item.product_image_artifact_id,
      }));
    } else {
      items.push(item);
    }
  }

  errors.sort((left, right) => left.row - right.row);
  return { items, errors };
}
