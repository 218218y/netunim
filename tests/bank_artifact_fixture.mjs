import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBridgeArtifacts } from '../netunim-kupa/bank-bridge/bridge-artifacts.mjs';

export const gate = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
export async function artifactFixture(t, { files = fs } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'netunim artifact owner '));
  t.after(async () => {
    const absolute = path.resolve(directory);
    assert.ok(
      absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(absolute).startsWith('netunim artifact owner ')
    );
    await fs.rm(absolute, { recursive: true, force: true });
  });
  const diagnosticDirectory = path.join(directory, 'diagnostics');
  const names = {
    META_FILE: path.join(directory, 'status.json'),
    CREDIT_META_FILE: path.join(directory, 'credit-card-status.json'),
    BANK_DIAGNOSTIC_FILE: path.join(diagnosticDirectory, 'bank-latest.json'),
    CREDIT_DATA_DIAGNOSTIC_FILE: path.join(diagnosticDirectory, 'credit-data-latest.json'),
    LEGACY_BANK_CHEQUE_DIAGNOSTIC_FILE: path.join(diagnosticDirectory, 'bank-cheque-latest.json'),
  };
  const api = createBridgeArtifacts({ directory, files });
  return { api, directory, diagnosticDirectory, names };
}
