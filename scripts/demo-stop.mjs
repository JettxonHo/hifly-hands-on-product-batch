import { demoDbPort, runCompose } from "./demo-compose.mjs";

await runCompose(["down"], { port: demoDbPort() });
console.log("Local VSA demo database stopped; its named volume was retained.");
