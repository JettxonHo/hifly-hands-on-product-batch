import { demoDbPort, runCompose } from "./demo-compose.mjs";

await runCompose(["down", "--volumes"], { port: demoDbPort() });
console.log("Local VSA demo database and its dedicated volume were removed.");
