import { main } from "../src/local-agent/local-agent-runner.js";
import { main as avatarMappingMain } from "../src/local-agent/avatar-mapping-cli.js";

try {
  const argv = process.argv.slice(2);
  const mappingCommand = ["avatar-map", "avatar-mapping", "avatar-mappings"].includes(argv[0]);
  const result = mappingCommand ? await avatarMappingMain({ argv: argv.slice(1) }) : await main({ argv });
  process.exitCode = result.exitCode;
} catch {
  console.error("LOCAL_EXECUTION_FAILED");
  process.exitCode = 1;
}
