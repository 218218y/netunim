import fs from 'node:fs/promises';
import path from 'node:path';
import { createFileTaskOwner } from './file-task-owner.mjs';
import {
  CREDIT_DIAGNOSTIC_MAX_BYTES,
  CREDIT_DIAGNOSTIC_FILE_COUNT,
  CREDIT_DIAGNOSTIC_RETENTION_MS,
  sanitizeCreditDiagnosticEvent,
} from './credit-diagnostic-model.mjs';
export function createCreditDiagnosticLog({
  directory,
  bridgeVersion = 0,
  contractVersion = 2,
  connectorVersion = 'israeli-bank-scrapers-6.10.0',
  maxBytes = CREDIT_DIAGNOSTIC_MAX_BYTES,
  fileCount = CREDIT_DIAGNOSTIC_FILE_COUNT,
  retentionMs = CREDIT_DIAGNOSTIC_RETENTION_MS,
} = {}) {
  const logPath = path.join(directory, 'credit-diagnostics.jsonl');
  const jobs = createFileTaskOwner();
  async function rotate() {
    let stat;
    try {
      stat = await fs.stat(logPath);
    } catch {
      return;
    }
    if (stat.size < maxBytes) return;
    for (let index = fileCount - 1; index >= 1; index--) {
      const source = index === 1 ? logPath : `${logPath}.${index - 1}`,
        target = `${logPath}.${index}`;
      try {
        await fs.rm(target, { force: true });
        await fs.rename(source, target);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
  async function prune(now = Date.now()) {
    for (let index = 0; index < fileCount; index++) {
      const file = index === 0 ? logPath : `${logPath}.${index}`;
      try {
        const stat = await fs.stat(file);
        if (now - stat.mtimeMs > retentionMs) await fs.rm(file, { force: true });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
  async function append(value) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await prune();
    await rotate();
    const event = sanitizeCreditDiagnosticEvent({
      ...value,
      bridgeVersion,
      contractVersion,
      connectorVersion: value?.connectorVersion || connectorVersion,
    });
    await fs.appendFile(logPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    await prune();
    return event;
  }
  function record(value) {
    return jobs.run(() => append(value)).catch(() => {});
  }

  async function summary({ limit = 100 } = {}) {
    const files = [
        logPath,
        ...Array.from({ length: fileCount - 1 }, (_, index) => `${logPath}.${index + 1}`),
      ],
      events = [];
    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf8');
        for (const line of content.split(/\r?\n/)) {
          if (!line.trim()) continue;
          try {
            events.push(sanitizeCreditDiagnosticEvent(JSON.parse(line)));
          } catch {}
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    return events
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100))));
  }
  return {
    record,
    summary: (options) => jobs.run(() => summary(options)),
    drain: jobs.drain,
    logPath,
  };
}
