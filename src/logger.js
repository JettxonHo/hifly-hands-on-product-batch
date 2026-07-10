import fs from "node:fs";
import path from "node:path";

export class BatchLogger {
  constructor(config) {
    this.logFile = path.join(config.logDir, `batch-${timestampForFile()}.jsonl`);
  }

  info(event, payload = {}) {
    this.write("info", event, payload);
  }

  error(event, payload = {}) {
    this.write("error", event, payload);
  }

  write(level, event, payload) {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      ...payload
    });
    fs.appendFileSync(this.logFile, `${line}\n`);
    console.log(`[${level}] ${event}`, payload);
  }
}

export function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
