import nativeFiles from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createJsonArtifactOwner } from './json-artifact-owner.mjs';

function emptyBankStatus() {
  return {
    lastScrapeAt: null,
    lastError: '',
    lastErrorAt: null,
    lastErrorCode: '',
    lastErrorStage: '',
    lastErrorHttpStatus: 0,
    lastWarning: '',
    lastWarningCode: '',
    lastWarningStage: '',
    lastWarningHttpStatus: 0,
    lastAvailableAccounts: [],
    lastAccountRole: '',
    browserPath: '',
    sessionUrl: '',
  };
}
function emptyCreditStatus() {
  return { lastSyncAt: null, lastErrors: [] };
}

// Four fixed namespaces expose documents; callers never receive file paths or
// permission to write the pairing token, encrypted vault or provider identities.
export function createBridgeArtifacts({
  directory,
  files = nativeFiles,
  stamp = () => `${process.pid}.${randomUUID()}`,
}) {
  if (typeof directory !== 'string' || !directory || typeof stamp !== 'function')
    throw new Error('bridge_artifact_ports_required');
  function artifact(primary, { legacy = [], fallback = null } = {}) {
    const paths = [primary, ...legacy].map((relative) => path.join(directory, relative)),
      file = paths[0];
    const owner = createJsonArtifactOwner({
      files: {
        async read() {
          for (const candidate of paths) {
            try {
              return JSON.parse(await files.readFile(candidate, 'utf8'));
            } catch (error) {
              if (fallback) return fallback();
              if (error?.code !== 'ENOENT') throw error;
            }
          }
          return null;
        },
        async write(text) {
          await files.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
          const temporary = `${file}.${stamp()}.tmp`;
          try {
            await files.writeFile(temporary, text, { encoding: 'utf8', mode: 0o600 });
            await files.rename(temporary, file);
          } finally {
            await files.rm(temporary, { force: true }).catch(() => {});
          }
        },
        async clear() {
          const results = await Promise.allSettled(
            paths.map((candidate) => files.rm(candidate, { force: true }))
          );
          const failure = results.find((result) => result.status === 'rejected');
          if (failure) throw failure.reason;
        },
      },
    });
    return owner;
  }
  const bankStatus = artifact('status.json', { fallback: emptyBankStatus });
  const creditStatus = artifact('credit-card-status.json', { fallback: emptyCreditStatus });
  const bankData = artifact(path.join('diagnostics', 'bank-latest.json'), {
    legacy: [path.join('diagnostics', 'bank-cheque-latest.json')],
  });
  const creditData = artifact(path.join('diagnostics', 'credit-data-latest.json'));
  const diagnostic = (owner) =>
    Object.freeze({
      read: owner.read,
      write: (payload) => (payload ? owner.write(payload) : Promise.resolve()),
      clear: owner.clear,
    });
  return Object.freeze({
    bankMeta: Object.freeze({ read: bankStatus.read, write: bankStatus.update }),
    creditMeta: Object.freeze({
      read: creditStatus.read,
      write: creditStatus.update,
      clear: creditStatus.clear,
    }),
    bankDiagnostic: diagnostic(bankData),
    creditData: diagnostic(creditData),
    drain: async () => {
      await Promise.all([
        bankStatus.drain(),
        creditStatus.drain(),
        bankData.drain(),
        creditData.drain(),
      ]);
    },
  });
}
