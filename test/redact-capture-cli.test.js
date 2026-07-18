import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(import.meta.url), "../..");
const cli = path.join(root, "scripts", "redact-capture-source.mjs");

const RAW = {
  source: "hifly_goods",
  captured_at: "2026-07-16T00:00:00Z",
  steps: [
    {
      id: "upload_product_image",
      phase: "asset_generation",
      method: "POST",
      url_template: "https://hifly.cc/api/goods/upload?sign=abc",
      placeholders: ["{{product_image_path}}"],
      request: { headers: { "content-type": "multipart/form-data", cookie: "sid=x", authorization: "Bearer t" } },
      response: {
        status: 200,
        headers: { "set-cookie": "sid=y" },
        body: { code: 0, data: { image_id: "img-1", access_token: "secret" } }
      },
      produces: { product_image_id: "$response.body.data.image_id" }
    }
  ]
};

async function withTmp(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "redact-cli-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
}

test("redacts raw steps to stdout and exits 0", async () => {
  await withTmp(async (dir) => {
    const input = path.join(dir, "raw.json");
    await writeFile(input, JSON.stringify(RAW));
    const res = run([input]);
    assert.equal(res.status, 0, res.stderr);
    const manifest = JSON.parse(res.stdout);
    assert.equal(manifest.sanitized, true);
    assert.equal(manifest.steps[0].response.body.data.access_token, undefined);
    assert.equal(manifest.steps[0].response.body.data.image_id, "img-1");
    assert.equal(manifest.steps[0].url_template, "https://hifly.cc/api/goods/upload");
    assert.match(res.stderr, /敏感项/);
  });
});

test("writes manifest and report files when --out/--report given", async () => {
  await withTmp(async (dir) => {
    const input = path.join(dir, "raw.json");
    const out = path.join(dir, "manifest.json");
    const report = path.join(dir, "report.json");
    await writeFile(input, JSON.stringify(RAW));
    const res = run([input, `--out=${out}`, `--report=${report}`]);
    assert.equal(res.status, 0, res.stderr);
    const manifest = JSON.parse(await readFile(out, "utf8"));
    assert.equal(manifest.schema_version, 1);
    assert.equal(manifest.steps[0].response.headers, undefined);
    const rep = JSON.parse(await readFile(report, "utf8"));
    assert.ok(rep.removed.some((p) => p.includes("access_token")));
    assert.ok(rep.removed.some((p) => p.includes("cookie")));
    // 报告只含路径，不含被删的敏感值
    assert.equal(JSON.stringify(rep).includes("secret"), false);
    assert.equal(JSON.stringify(rep).includes("Bearer t"), false);
  });
});

test("missing input arg prints usage and exits 1", () => {
  const res = run([]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /用法/);
});

test("nonexistent input file exits 1", () => {
  const res = run([path.join(tmpdir(), "redact-cli-not-here.json")]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /无法读取/);
});
