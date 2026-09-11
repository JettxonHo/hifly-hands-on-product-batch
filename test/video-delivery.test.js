import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createVideoDeliveryNormalizer } from "../src/cloud-executor/video-delivery.js";

const exec = promisify(execFile);
const FFMPEG = process.platform === "darwin" ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";
const FFPROBE = process.platform === "darwin" ? "/opt/homebrew/bin/ffprobe" : "ffprobe";

async function available(command) {
  try { await exec(command, ["-version"], { windowsHide: true }); return true; }
  catch { return false; }
}

async function syntheticVideo(root, { rotate = null, sampleAspectRatio = null, audio = true } = {}) {
  const output = path.join(root, rotate || sampleAspectRatio ? "source-transformed.mp4" : "source.mp4");
  const encodedOutput = rotate === null ? output : path.join(root, "source-base.mp4");
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=640x360:r=25"];
  if (audio) args.push("-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000");
  args.push("-t", "1", ...(audio ? ["-shortest"] : []));
  if (sampleAspectRatio) args.push("-vf", `setsar=${sampleAspectRatio.replace(":", "/")}`);
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", ...(audio ? ["-c:a", "aac"] : []));
  args.push("-movflags", "+faststart", encodedOutput);
  await exec(FFMPEG, args, { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  if (rotate !== null) {
    await exec(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-display_rotation:v:0", String(rotate), "-i", encodedOutput, "-c", "copy", output], {
      windowsHide: true, maxBuffer: 2 * 1024 * 1024
    });
  }
  return output;
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("normalizer creates an offline strict 1080x1920 delivery with audio and preserves the source bytes", async (t) => {
  if (!await available(FFMPEG) || !await available(FFPROBE)) { t.skip("ffmpeg/ffprobe unavailable"); return; }
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-video-delivery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = await syntheticVideo(root);
  const sourceBytes = await readFile(sourcePath);
  const normalizer = createVideoDeliveryNormalizer({ ffmpegPath: FFMPEG, ffprobePath: FFPROBE });

  const result = await normalizer.normalize({
    original: { bytes: sourceBytes, mediaType: "video/mp4", originalFilename: "source.mp4" }
  });

  assert.equal(result.original.media_type, "video/mp4");
  assert.equal(result.original.size, sourceBytes.length);
  assert.equal(result.original.checksum, sha256(sourceBytes));
  assert.equal(result.original.has_audio, true);
  assert.equal(result.delivery.media_type, "video/mp4");
  assert.equal(result.delivery.width, 1080);
  assert.equal(result.delivery.height, 1920);
  assert.equal(result.delivery.has_audio, true);
  assert.equal(result.delivery.checksum, sha256(result.delivery.bytes));
  assert.equal(result.delivery.size, result.delivery.bytes.length);
  assert.notEqual(result.delivery.checksum, result.original.checksum);
  assert.equal(result.evidence.some((item) => item.field === "final_video_aspect_ratio" && item.result === "FAIL_EXACT_MATCH"), true);
  assert.equal(result.evidence.some((item) => item.field === "delivery_video_aspect_ratio" && item.result === "PASS_EXACT_MATCH"), true);
  assert.deepEqual(await readFile(sourcePath), sourceBytes);
  assert.equal((await stat(sourcePath)).isFile(), true);
});

test("normalizer applies display rotation while keeping a strict delivery frame", async (t) => {
  if (!await available(FFMPEG) || !await available(FFPROBE)) { t.skip("ffmpeg/ffprobe unavailable"); return; }
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-video-delivery-display-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = await syntheticVideo(root, { rotate: 90 });
  const normalizer = createVideoDeliveryNormalizer({ ffmpegPath: FFMPEG, ffprobePath: FFPROBE });
  const result = await normalizer.normalize({ original: { bytes: await readFile(sourcePath), mediaType: "video/mp4", originalFilename: "rotated.mp4" } });

  assert.equal(result.original.rotation_degrees, 90);
  assert.equal(result.original.sample_aspect_ratio, "1:1");
  assert.equal(result.delivery.width * 16, result.delivery.height * 9);
  assert.equal(result.delivery.width, 1080);
  assert.equal(result.delivery.height, 1920);
});

test("normalizer rejects non-square source pixels before transcode", async (t) => {
  if (!await available(FFMPEG) || !await available(FFPROBE)) { t.skip("ffmpeg/ffprobe unavailable"); return; }
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-video-delivery-sar-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = await syntheticVideo(root, { sampleAspectRatio: "2:1" });
  const normalizer = createVideoDeliveryNormalizer({ ffmpegPath: FFMPEG, ffprobePath: FFPROBE });
  const sourceBytes = await readFile(sourcePath);

  await assert.rejects(() => normalizer.normalize({ original: { bytes: sourceBytes, mediaType: "video/mp4", originalFilename: "sar.mp4" } }),
    { code: "CLOUD_EXECUTOR_VIDEO_DELIVERY_SAR_UNSUPPORTED" });
});

test("normalizer rejects a source without a decodable audio track before delivery", async (t) => {
  if (!await available(FFMPEG) || !await available(FFPROBE)) { t.skip("ffmpeg/ffprobe unavailable"); return; }
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-video-delivery-no-audio-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = await syntheticVideo(root, { audio: false });
  const normalizer = createVideoDeliveryNormalizer({ ffmpegPath: FFMPEG, ffprobePath: FFPROBE });
  const sourceBytes = await readFile(sourcePath);

  await assert.rejects(() => normalizer.normalize({ original: { bytes: sourceBytes, mediaType: "video/mp4", originalFilename: "silent.mp4" } }),
    { code: "CLOUD_EXECUTOR_VIDEO_DELIVERY_AUDIO_REQUIRED" });
});

test("normalizer passes fixed argument arrays and cleans temporary files on tool failure", async () => {
  const calls = [];
  const tempRoots = [];
  const normalizer = createVideoDeliveryNormalizer({
    ffmpegPath: "ffmpeg-test",
    ffprobePath: "ffprobe-test",
    commandRunner: async (command, args) => {
      calls.push({ command, args: [...args] });
      if (command === "ffprobe-test") return { stdout: JSON.stringify({ streams: [{ codec_type: "video", width: 640, height: 360, sample_aspect_ratio: "1:1", duration: "1" }, { codec_type: "audio", duration: "1" }], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "1" } }), stderr: "" };
      throw Object.assign(new Error("tool failed"), { code: "E_TOOL" });
    },
    tempDirectoryFactory: async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "hifly-video-delivery-fake-"));
      tempRoots.push(root);
      return root;
    }
  });

  await assert.rejects(() => normalizer.normalize({ original: { bytes: Buffer.from("source"), mediaType: "video/mp4", originalFilename: "source.mp4" } }),
    { code: "CLOUD_EXECUTOR_VIDEO_DELIVERY_TRANSCODE_FAILED" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, "ffprobe-test");
  assert.equal(calls[1].command, "ffmpeg-test");
  assert.equal(calls[1].args.includes("-vf"), true);
  assert.equal(calls[1].args.some((value) => String(value).includes("1080:1920")), true);
  for (const root of tempRoots) await assert.rejects(() => access(root), { code: "ENOENT" });
});

test("normalizer preflight checks both media tools before a provider result is processed", async () => {
  const calls = [];
  const normalizer = createVideoDeliveryNormalizer({
    ffmpegPath: "ffmpeg-test", ffprobePath: "ffprobe-test",
    commandRunner: async (command, args) => { calls.push({ command, args: [...args] }); return { stdout: "version", stderr: "" }; }
  });

  assert.deepEqual(await normalizer.preflight(), { ffmpeg: true, ffprobe: true });
  assert.deepEqual(calls, [
    { command: "ffmpeg-test", args: ["-hide_banner", "-version"] },
    { command: "ffprobe-test", args: ["-hide_banner", "-version"] }
  ]);
});
