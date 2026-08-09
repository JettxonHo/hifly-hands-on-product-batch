import { main } from "../src/local-agent/local-agent-runner.js";

try {
  const result = await main();
  process.exitCode = result.exitCode;
} catch {
  console.error("LOCAL_EXECUTION_FAILED");
  process.exitCode = 1;
}
