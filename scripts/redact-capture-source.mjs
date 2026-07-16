// 脱敏抓包原始步骤，产出可入库的 capture manifest 与脱敏报告。
// 离线工具：不访问网络，不读浏览器登录态。完整流程见 docs/rpa/capture-runbook.md。
import { readFile, writeFile } from "node:fs/promises";
import { redactCaptureSource } from "../src/rpa/capture/redact.js";
import { parseCaptureManifest } from "../src/rpa/capture/manifest.js";

function usage() {
  return [
    "用法: node scripts/redact-capture-source.mjs <raw-steps.json> [--out=<manifest.json>] [--report=<report.json>]",
    "",
    "  raw-steps.json  人工整理的原始抓包步骤 { source, captured_at, steps[] }，可含敏感头/字段",
    "  --out           脱敏后 manifest 写入路径；缺省则输出到 stdout",
    "  --report        脱敏报告（被删敏感项路径列表）写入路径；缺省则只把摘要打印到 stderr",
    "",
    "本工具不解析 HAR：原始 HAR 必须先按 runbook 人工整理成 raw-steps 结构。"
  ].join("\n");
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq === -1) flags[arg.slice(2)] = true;
      else flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const inputPath = positional[0];

if (!inputPath || flags.help) {
  console.error(usage());
  process.exit(inputPath ? 0 : 1);
}

let raw;
try {
  raw = JSON.parse(await readFile(inputPath, "utf8"));
} catch (err) {
  console.error(`无法读取或解析输入文件 ${inputPath}: ${err.message}`);
  process.exit(1);
}

let result;
try {
  result = redactCaptureSource(raw);
} catch (err) {
  console.error(`脱敏失败: ${err.message}`);
  process.exit(1);
}

// 双重保险：脱敏产物必须能通过 manifest 门禁（敏感键二次扫描）。
try {
  parseCaptureManifest(result.sanitized);
} catch (err) {
  console.error(`脱敏产物未通过门禁，仍存在敏感残留: ${err.message}`);
  console.error("请人工检查 raw-steps 后重试，不要把未过门禁的产物入库。");
  process.exit(2);
}

const manifestJson = `${JSON.stringify(result.sanitized, null, 2)}\n`;
if (flags.out) {
  await writeFile(flags.out, manifestJson, "utf8");
  console.error(`已写入脱敏 manifest: ${flags.out}`);
} else {
  process.stdout.write(manifestJson);
}

const count = result.report.removed.length;
if (flags.report) {
  await writeFile(flags.report, `${JSON.stringify(result.report, null, 2)}\n`, "utf8");
  console.error(`已写入脱敏报告: ${flags.report}`);
}
console.error(`脱敏完成：删除 ${count} 个敏感项${count ? "（路径见 report）" : ""}。`);
