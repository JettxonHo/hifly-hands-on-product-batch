import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";

const REQUIRED_COLUMNS = ["sku", "product_name", "selling_points", "category", "image_path"];
const OPTIONAL_COLUMNS = [
  "person_image_path", "script", "avatar", "voice", "duration_seconds",
  "status", "retry_count", "output_path", "error_message",
];
const KNOWN_COLUMNS = new Set([...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]);
const DEFAULT_LIMITS = {
  maxTableBytes: 20 * 1024 * 1024,
  maxZipEntries: 2_000,
  maxZipUncompressedBytes: 100 * 1024 * 1024,
};

function issue(code, details = {}) {
  return { code, ...details };
}

function normalizeText(value) {
  return String(value ?? "").trim().normalize("NFC");
}

function skuKey(value) {
  return normalizeText(value).toLocaleLowerCase("und");
}

function inspectHeaders(rawHeaders) {
  const headers = rawHeaders.map(normalizeText);
  const seen = new Set();
  const errors = [];
  for (const [index, header] of headers.entries()) {
    if (!header) {
      errors.push(issue("EMPTY_HEADER", { column: index + 1 }));
    } else if (seen.has(header)) {
      errors.push(issue("DUPLICATE_HEADER", { column: index + 1, header }));
    }
    seen.add(header);
  }
  for (const column of REQUIRED_COLUMNS) {
    if (!seen.has(column)) errors.push(issue("MISSING_REQUIRED_HEADER", { header: column }));
  }
  return {
    headers,
    errors,
    unknownColumns: headers.filter((header) => header && !KNOWN_COLUMNS.has(header)),
  };
}

function cellValue(value, row, column, errors) {
  if (value && typeof value === "object" && "formula" in value) {
    if (!("result" in value) || value.result === undefined || value.result === null) {
      errors.push(issue("FORMULA_WITHOUT_CACHED_VALUE", { row, column }));
      return "";
    }
    return value.result;
  }
  if (value && typeof value === "object" && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join("");
  }
  if (value instanceof Date) return value.toISOString();
  return value ?? "";
}

function buildRows(records, headerInfo) {
  if (headerInfo.errors.length) return { rows: [], errors: headerInfo.errors };
  const rows = [];
  const errors = [];
  const skuRows = new Map();

  for (const record of records) {
    if (record.values.every((value) => normalizeText(value) === "")) continue;
    const row = {};
    for (const [index, header] of headerInfo.headers.entries()) {
      if (KNOWN_COLUMNS.has(header)) row[header] = normalizeText(record.values[index]);
    }
    row.sku = normalizeText(row.sku);
    const key = skuKey(row.sku);
    if (key) {
      if (skuRows.has(key)) {
        errors.push(issue("DUPLICATE_SKU", {
          row: record.rowNumber,
          sku: row.sku,
          firstRow: skuRows.get(key),
        }));
      } else {
        skuRows.set(key, record.rowNumber);
      }
    }
    rows.push(row);
  }
  return { rows, errors };
}

function inspectXlsxArchive(buffer, limits) {
  const minimumEocd = 22;
  const start = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - minimumEocd; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw Object.assign(new Error("Invalid XLSX archive"), { code: "INVALID_XLSX_ARCHIVE" });

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw Object.assign(new Error("ZIP64 XLSX is unsupported"), { code: "UNSUPPORTED_XLSX_ZIP64" });
  }
  if (entryCount > limits.maxZipEntries) {
    throw Object.assign(new Error("Too many XLSX entries"), { code: "XLSX_ENTRY_LIMIT" });
  }
  if (centralOffset + centralSize > buffer.length) {
    throw Object.assign(new Error("Invalid XLSX central directory"), { code: "INVALID_XLSX_ARCHIVE" });
  }

  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw Object.assign(new Error("Invalid XLSX entry"), { code: "INVALID_XLSX_ARCHIVE" });
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if ((flags & 0x1) !== 0) {
      throw Object.assign(new Error("Encrypted XLSX is unsupported"), { code: "ENCRYPTED_XLSX" });
    }
    if (/^(?:xl\/externalLinks\/|xl\/vbaProject\.bin$)/i.test(name)) {
      throw Object.assign(new Error("Unsafe XLSX content"), { code: "UNSAFE_XLSX_CONTENT" });
    }
    const normalizedName = name.replace(/\\/g, "/");
    if (
      name.includes("\\")
      || normalizedName.startsWith("/")
      || normalizedName.split("/").some((segment) => segment === "..")
    ) {
      throw Object.assign(new Error("Unsafe XLSX entry path"), { code: "UNSAFE_XLSX_ENTRY" });
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxZipUncompressedBytes) {
      throw Object.assign(new Error("XLSX expands beyond limit"), { code: "XLSX_EXPANSION_LIMIT" });
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
}

async function importCsv(filePath, buffer) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return { sheetName: null, rows: [], errors: [issue("INVALID_CSV_ENCODING")], unknownColumns: [] };
  }
  let records;
  try {
    records = parse(text, { bom: true, relax_column_count: true, skip_empty_lines: true });
  } catch {
    return { sheetName: null, rows: [], errors: [issue("INVALID_CSV")], unknownColumns: [] };
  }
  if (records.length === 0) {
    return { sheetName: null, rows: [], errors: [issue("EMPTY_TABLE")], unknownColumns: [] };
  }
  const headerInfo = inspectHeaders(records[0]);
  const data = records.slice(1).map((values, index) => ({ values, rowNumber: index + 2 }));
  const built = buildRows(data, headerInfo);
  return { sheetName: null, ...built, unknownColumns: headerInfo.unknownColumns };
}

async function importXlsx(buffer, limits) {
  try {
    inspectXlsxArchive(buffer, limits);
  } catch (error) {
    return { sheetName: null, rows: [], errors: [issue(error.code || "INVALID_XLSX")], unknownColumns: [] };
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer, { ignoreNodes: ["dataValidations"] });
  } catch {
    return { sheetName: null, rows: [], errors: [issue("INVALID_XLSX")], unknownColumns: [] };
  }
  const sheet = workbook.worksheets.find((candidate) => candidate.state === "visible");
  if (!sheet) {
    return { sheetName: null, rows: [], errors: [issue("NO_VISIBLE_WORKSHEET")], unknownColumns: [] };
  }
  const rawHeaders = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    rawHeaders[column - 1] = cell.value;
  });
  const headerInfo = inspectHeaders(rawHeaders);
  const formulaErrors = [];
  const records = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const values = headerInfo.headers.map((_, index) => cellValue(
      sheet.getRow(rowNumber).getCell(index + 1).value,
      rowNumber,
      index + 1,
      formulaErrors,
    ));
    records.push({ values, rowNumber });
  }
  if (formulaErrors.length) {
    return { sheetName: sheet.name, rows: [], errors: formulaErrors, unknownColumns: headerInfo.unknownColumns };
  }
  const built = buildRows(records, headerInfo);
  return { sheetName: sheet.name, ...built, unknownColumns: headerInfo.unknownColumns };
}

export async function importProductTable(filePath, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== ".csv" && extension !== ".xlsx") {
    return { sheetName: null, rows: [], errors: [issue("UNSUPPORTED_TABLE_TYPE")], unknownColumns: [] };
  }
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return { sheetName: null, rows: [], errors: [issue("TABLE_NOT_FOUND")], unknownColumns: [] };
  }
  if (!fileStat.isFile()) {
    return { sheetName: null, rows: [], errors: [issue("INVALID_TABLE_FILE")], unknownColumns: [] };
  }
  if (fileStat.size > limits.maxTableBytes) {
    return { sheetName: null, rows: [], errors: [issue("TABLE_TOO_LARGE")], unknownColumns: [] };
  }
  const buffer = await readFile(filePath);
  return extension === ".csv" ? importCsv(filePath, buffer) : importXlsx(buffer, limits);
}
