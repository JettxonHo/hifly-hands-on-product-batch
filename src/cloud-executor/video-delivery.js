import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { verifyExactAspectRatio } from "../execution-contracts/hifly-hands-on-product-evidence.js";

const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TOOL_OUTPUT_BYTES = 2 * 1024 * 1024;
const VIDEO_MEDIA_TYPE = "video/mp4";

const failure = (code) => Object.assign(new Error(code), { code });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeFilename(value) {
  const base = path.basename(clean(value).replaceAll("\\", "/")).replace(/[\u0000-\u001f\u007f]/g, "_");
  return base && base !== "." && base !== ".." ? base : "video.mp4";
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function parseRatio(value, fallback = { numerator: 1, denominator: 1, text: "1:1" }) {
  const text = clean(value);
  if (!text || text === "N/A" || text === "0:1") return fallback;
  const match = /^(\d+):(\d+)$/.exec(text);
  if (!match || Number(match[1]) < 1 || Number(match[2]) < 1) throw failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_PROBE_INVALID");
  return { numerator: Number(match[1]), denominator: Number(match[2]), text: `${Number(match[1])}:${Number(match[2])}` };
}

function rotationFor(stream) {
  const values = [stream?.tags?.rotate, ...(Array.isArray(stream?.side_data_list) ? stream.side_data_list.map((item) => item?.rotation) : [])]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== "");
  if (!values.length) return 0;
  const rotation = Number(values[0]);
  if (!Number.isFinite(rotation) || rotation % 90 !== 0) throw failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_ROTATION_INVALID");
  return ((rotation % 360) + 360) % 360;
}

function displayDimensions(stream) {
  const codedWidth = positiveInteger(stream?.width);
  const codedHeight = positiveInteger(stream?.height);
  if (!codedWidth || !codedHeight) throw failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_DIMENSIONS_INVALID");
  const sampleAspectRatio = parseRatio(stream?.sample_aspect_ratio, null);
  const displayAspectRatio = positiveNumber(stream?.display_aspect_ratio) ? null : parseRatio(stream?.display_aspect_ratio, null);
  const effectiveSampleAspectRatio = sampleAspectRatio || { numerator: 1, denominator: 1, text: "1:1" };
  const width = displayAspectRatio
    ? codedHeight * displayAspectRatio.numerator / displayAspectRatio.denominator
    : codedWidth * effectiveSampleAspectRatio.numerator / effectiveSampleAspectRatio.denominator;
  const height = codedHeight;
  if (!Number.isFinite(width) || width <= 0) throw failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_DIMENSIONS_INVALID");
  const rotationDegrees = rotationFor(stream);
  const rotated = rotationDegrees === 90 || rotationDegrees === 270;
  return {
    width: Math.max(1, Math.round(rotated ? height : width)),
    height: Math.max(1, Math.round(rotated ? width : height)),
    coded_width: codedWidth,
    coded_height: codedHeight,
    sample_aspect_ratio: sampleAspectRatio?.text || null,
    rotation_degrees: rotationDegrees
  };
}

function probeSummary(value) {
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_PROBE_INVALID"); }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.streams)) throw failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_PROBE_INVALID");
  const video = parsed.streams.find((stream) => stream?.codec_type === "video");
  if (!video) throw failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_VIDEO_REQUIRED");
  const dimensions = displayDimensions(video);
  const duration = positiveNumber(parsed.format?.duration) || positiveNumber(video.duration);
  if (!duration) throw failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_DURATION_INVALID");
  const formatName = clean(parsed.format?.format_name);
  if (!formatName || !formatName.split(",").includes("mp4") && !formatName.split(",").includes("mov")) {
    throw failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_FORMAT_INVALID");
  }
  return { ...dimensions, duration_seconds: duration, has_audio: parsed.streams.some((stream) => stream?.codec_type === "audio") };
}

function runCommand(command, args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      reject(failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_TOOL_UNAVAILABLE"));
      return;
    }
    let stdout = "";
    let outputBytes = 0;
    let timedOut = false;
    let outputTooLarge = false;
    const collect = (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_TOOL_OUTPUT_BYTES) {
        outputTooLarge = true;
        child.kill("SIGKILL");
        return;
      }
      stdout += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_TOOL_OUTPUT_BYTES) {
        outputTooLarge = true;
        child.kill("SIGKILL");
      }
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      reject(failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_TOOL_UNAVAILABLE"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_TOOL_TIMEOUT"));
      else if (outputTooLarge) reject(failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_TOOL_OUTPUT_LIMIT"));
      else if (code !== 0) reject(failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_TOOL_FAILED"));
      else resolve({ stdout });
    });
  });
}

function mediaFailure(error, fallback = "CLOUD_EXECUTOR_VIDEO_DELIVERY_FAILED") {
  if (typeof error?.code === "string" && error.code.startsWith("CLOUD_EXECUTOR_VIDEO_DELIVERY_")) return error;
  return failure(fallback);
}

export function createVideoDeliveryNormalizer({ ffmpegPath = "ffmpeg", ffprobePath = "ffprobe", commandRunner = runCommand,
  tempDirectoryFactory = async (prefix) => mkdtemp(path.join(os.tmpdir(), prefix)), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof commandRunner !== "function") throw new TypeError("commandRunner is required");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("timeoutMs must be positive");

  async function probe(filePath) {
    let result;
    try {
      result = await commandRunner(ffprobePath, ["-protocol_whitelist", "file,pipe", "-hide_banner", "-loglevel", "error", "-print_format", "json", "-show_streams", "-show_format", filePath], { timeoutMs });
    } catch (error) {
      throw mediaFailure(error, "CLOUD_EXECUTOR_VIDEO_DELIVERY_PROBE_FAILED");
    }
    return probeSummary(result?.stdout);
  }

  async function preflight() {
    for (const command of [ffmpegPath, ffprobePath]) {
      try {
        await commandRunner(command, ["-hide_banner", "-version"], { timeoutMs });
      } catch (error) {
        throw mediaFailure(error, "CLOUD_EXECUTOR_VIDEO_DELIVERY_PREFLIGHT_FAILED");
      }
    }
    return { ffmpeg: true, ffprobe: true };
  }

  async function normalize({ original } = {}) {
    if (!original || !Buffer.isBuffer(original.bytes) || original.bytes.length < 1 || clean(original.mediaType) !== VIDEO_MEDIA_TYPE) {
      throw failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_INPUT_INVALID");
    }
    let temporaryRoot;
    try {
      temporaryRoot = await tempDirectoryFactory("hifly-video-delivery-");
      const sourcePath = path.join(temporaryRoot, "original.mp4");
      const deliveryPath = path.join(temporaryRoot, "delivery.mp4");
      await writeFile(sourcePath, original.bytes, { flag: "wx", mode: 0o600 });
      const source = await probe(sourcePath);
      if (!source.has_audio) throw failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_AUDIO_REQUIRED");
      if (source.sample_aspect_ratio !== "1:1") throw failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_SAR_UNSUPPORTED");

      const filter = `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${TARGET_WIDTH}:${TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
      try {
        // FFmpeg enables metadata autorotation by default. Leaving this option
        // implicit keeps the command compatible with both 6.1 (HAS_ARG) and 9.
        await commandRunner(ffmpegPath, ["-protocol_whitelist", "file,pipe", "-hide_banner", "-loglevel", "error", "-y", "-threads", "2", "-filter_threads", "2", "-i", sourcePath,
          "-map", "0:v:0", "-map", "0:a:0?", "-vf", filter, "-c:v", "libx264", "-preset", "medium", "-crf", "18",
          "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-map_metadata", "-1", deliveryPath], { timeoutMs });
      } catch (error) {
        throw mediaFailure(error, "CLOUD_EXECUTOR_VIDEO_DELIVERY_TRANSCODE_FAILED");
      }

      const deliveryBytes = await readFile(deliveryPath).catch(() => { throw failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_OUTPUT_MISSING"); });
      if (!Buffer.isBuffer(deliveryBytes) || deliveryBytes.length < 1) throw failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_OUTPUT_INVALID");
      await chmod(deliveryPath, 0o600).catch(() => undefined);
      const delivery = await probe(deliveryPath);
      if (delivery.width !== TARGET_WIDTH || delivery.height !== TARGET_HEIGHT || delivery.sample_aspect_ratio !== "1:1" || delivery.rotation_degrees !== 0) {
        throw failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_DIMENSIONS_INVALID");
      }
      if (!delivery.has_audio) throw failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_AUDIO_INVALID");
      const durationTolerance = Math.max(0.25, source.duration_seconds * 0.02);
      if (Math.abs(delivery.duration_seconds - source.duration_seconds) > durationTolerance) {
        throw failure("CLOUD_EXECUTOR_VIDEO_DELIVERY_DURATION_MISMATCH");
      }

      const originalFilename = safeFilename(original.originalFilename);
      const originalRatioEvidence = verifyExactAspectRatio({ width: source.width, height: source.height, expected: "9:16",
        field: "final_video_aspect_ratio", evidenceSource: "generated_artifact_natural_dimensions",
        verificationStage: "post_final_video", paidBoundary: "after_paid_action_2" });
      const deliveryRatioEvidence = verifyExactAspectRatio({ width: delivery.width, height: delivery.height, expected: "9:16",
        field: "delivery_video_aspect_ratio", evidenceSource: "generated_artifact_natural_dimensions",
        verificationStage: "post_final_video", paidBoundary: "after_paid_action_2" });
      return {
        original: { bytes: original.bytes, media_type: VIDEO_MEDIA_TYPE, original_filename: originalFilename,
          size: original.bytes.length, checksum: sha256(original.bytes), ...source },
        delivery: { bytes: deliveryBytes, media_type: VIDEO_MEDIA_TYPE, original_filename: originalFilename,
          size: deliveryBytes.length, checksum: sha256(deliveryBytes), ...delivery },
        evidence: [originalRatioEvidence, deliveryRatioEvidence]
      };
    } catch (error) {
      throw mediaFailure(error);
    } finally {
      if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return { normalize, preflight };
}

export const createVideoDelivery = createVideoDeliveryNormalizer;
