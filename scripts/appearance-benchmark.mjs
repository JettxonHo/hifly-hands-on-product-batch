import { pathToFileURL } from "node:url";

import { AppearanceBenchmarkError } from "../src/appearance-benchmark/contracts.js";
import { validateBenchmarkEnvironment } from "../src/appearance-benchmark/environment-validator.js";
import { runBlindInference, scoreSealedEvidence } from "../src/appearance-benchmark/harness.js";

export async function runAppearanceBenchmarkCli({ argv = process.argv.slice(2), env = process.env } = {}) {
  const [command, ...options] = argv;
  const flags = parseFlags(options);
  if (command === "validate-environment") {
    requireOnly(flags, ["storage-alias", "manifest", "environment-lock", "lane"]);
    return validateBenchmarkEnvironment({
      storageAlias: flags["storage-alias"],
      manifestPath: flags.manifest,
      environmentLockPath: flags["environment-lock"],
      lane: flags.lane,
      env
    });
  }
  if (command === "infer") {
    requireOnly(flags, [
      "storage-alias", "manifest", "environment-lock", "operations-policy", "lane", "adapter", "run-id", "output"
    ]);
    return runBlindInference({
      storageAlias: flags["storage-alias"],
      manifestPath: flags.manifest,
      environmentLockPath: flags["environment-lock"],
      operationsPolicyPath: flags["operations-policy"],
      lane: flags.lane,
      adapter: flags.adapter,
      runId: flags["run-id"],
      outputPath: flags.output,
      env
    });
  }
  if (command === "score") {
    requireOnly(flags, ["raw-evidence", "annotation", "review", "axis-mapping", "output"]);
    return scoreSealedEvidence({
      rawEvidencePath: flags["raw-evidence"],
      annotationPath: flags.annotation,
      reviewPath: flags.review,
      axisMappingPath: flags["axis-mapping"],
      outputPath: flags.output
    });
  }
  throw new AppearanceBenchmarkError("BENCHMARK_COMMAND_INVALID", "The benchmark command is not allowed");
}

function parseFlags(values) {
  const flags = {};
  for (const value of values) {
    const match = /^--([a-z0-9-]+)=(.+)$/.exec(value);
    if (!match || Object.hasOwn(flags, match[1])) {
      throw new AppearanceBenchmarkError("BENCHMARK_ARGUMENT_INVALID", "A benchmark argument is invalid");
    }
    flags[match[1]] = match[2];
  }
  return flags;
}

function requireOnly(flags, names) {
  const expected = new Set(names);
  if (Object.keys(flags).length !== expected.size || names.some((name) => !flags[name]) ||
      Object.keys(flags).some((name) => !expected.has(name))) {
    throw new AppearanceBenchmarkError("BENCHMARK_ARGUMENT_INVALID", "The benchmark arguments are incomplete or not allowed");
  }
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) {
  try {
    const result = await runAppearanceBenchmarkCli();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof AppearanceBenchmarkError ? error.code : "BENCHMARK_INTERNAL_ERROR";
    const message = error instanceof AppearanceBenchmarkError ? error.message : "The benchmark command failed";
    process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`);
    process.exitCode = 1;
  }
}
