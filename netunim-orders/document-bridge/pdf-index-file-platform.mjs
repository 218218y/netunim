import fs from 'node:fs/promises';

// Only a genuinely missing file is an empty bootstrap input. Permission, I/O,
// directory and other failures retain their native code and cannot authorize
// snapshot-only replay or later compaction of an unread journal.
export function createPdfIndexFilePlatform({snapshotPath, journalPath, io = fs}) {
  async function readText(file) {
    try { return await io.readFile(file, 'utf8'); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  }
  async function signaturePart(file) {
    let stat;
    try { stat = await io.stat(file); } catch (error) { if (error?.code === 'ENOENT') return 'missing'; throw error; }
    return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  }
  return {
    readSnapshot: () => readText(snapshotPath), readJournal: () => readText(journalPath),
    signature: async () => (await Promise.all([snapshotPath, journalPath].map(signaturePart))).join('|'),
  };
}
