import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import {
  DEMO_COMPOSE_PROJECT,
  composeArgs,
  demoDatabaseUrl,
  findAvailableDemoDbPort
} from "../scripts/demo-compose.mjs";

test("demo compose commands are isolated and reset is an explicit operation", () => {
  assert.equal(DEMO_COMPOSE_PROJECT, "hifly-vsa-demo");
  assert.deepEqual(composeArgs(["up", "-d"]), [
    "compose", "--project-name", "hifly-vsa-demo", "--file", "docker-compose.demo.yml", "up", "-d"
  ]);
  assert.deepEqual(composeArgs(["down"]), [
    "compose", "--project-name", "hifly-vsa-demo", "--file", "docker-compose.demo.yml", "down"
  ]);
  assert.deepEqual(composeArgs(["down", "--volumes"]), [
    "compose", "--project-name", "hifly-vsa-demo", "--file", "docker-compose.demo.yml", "down", "--volumes"
  ]);
  assert.match(demoDatabaseUrl(55433), /^postgresql:\/\/hifly_demo:.*@127\.0\.0\.1:55433\/hifly_vsa_demo$/);
  assert.notEqual(demoDatabaseUrl(55433), "postgresql://hifly_test:local-test-only@127.0.0.1:55432/hifly_identity_test");
});

test("demo database automatically skips an occupied default port", async (t) => {
  const occupied = net.createServer();
  await new Promise((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen({ port: 0 }, resolve);
  });
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  const address = occupied.address();
  assert.equal(typeof address, "object");
  const selected = await findAvailableDemoDbPort(address.port);
  assert.notEqual(selected, address.port);
  assert.ok(selected > address.port);
});
