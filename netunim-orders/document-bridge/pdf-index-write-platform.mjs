import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createPdfIndexFilePlatform} from './pdf-index-file-platform.mjs';

export function createPdfIndexWritePlatform({snapshotPath, journalPath, io = fs}) {
  async function settle(handle, work) {
    let failure;
    try { await work(); } catch (error) { failure = error; }
    try { await handle.close(); } catch (cleanup) {
      throw Object.assign(new AggregateError(failure ? [failure, cleanup] : [cleanup], 'PDF index handle close failed'), {code: 'PDF_INDEX_WRITE_CLOSE_FAILED'});
    }
    if (failure) throw failure;
  }
  async function replace(file, text) {
    const temporary = `${file}.tmp-${randomUUID()}`;
    const handle = await io.open(temporary, 'wx', 0o600);
    try {
      await settle(handle, async () => { await handle.writeFile(text, 'utf8'); await handle.sync(); });
      await io.rename(temporary, file);
    } catch (error) {
      try { await io.unlink(temporary); } catch (cleanup) {
        if (cleanup.code !== 'ENOENT') throw new AggregateError([error, cleanup], 'PDF index temporary cleanup failed');
      }
      throw error;
    }
  }
  return {
    signature: createPdfIndexFilePlatform({snapshotPath, journalPath, io}).signature,
    async appendJournal(text) {
      const handle = await io.open(journalPath, 'a+', 0o600);
      await settle(handle, async () => {
        const {size} = await handle.stat(); let separator = '';
        if (size) {
          const byte = Buffer.alloc(1), {bytesRead} = await handle.read(byte, 0, 1, size - 1);
          if (bytesRead !== 1) throw Object.assign(new Error('PDF journal tail changed before append'), {code: 'PDF_INDEX_WRITE_CHANGED'});
          if (byte[0] !== 10) separator = '\n';
        }
        await handle.writeFile(separator + text, 'utf8'); await handle.sync();
      });
    },
    replaceSnapshot: text => replace(snapshotPath, text), clearJournal: () => replace(journalPath, ''),
  };
}
