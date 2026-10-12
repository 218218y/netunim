import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createPdfIndexFilePlatform} from '../netunim-orders/document-bridge/pdf-index-file-platform.mjs';
import {indexFixture} from './pdf_index_file_fixture.mjs';

test('production reader publishes one fully decoded native snapshot/journal and retires PDF match text', async t => {
  const f = await indexFixture(t); await f.read();
  assert.deepEqual([...f.context.pdfFormIndex.keys()], ['c:\\synthetic\\one.pdf', 'c:\\synthetic\\two.pdf']);
  assert.equal(f.context.pdfFormIndex.get('c:\\synthetic\\two.pdf').text, 'journal text');
  assert.equal(f.context.pdfFormIndex.get('c:\\synthetic\\one.pdf').detectionRevision, 1, 'historical extractor revision remains readable');
  assert.equal(f.context.pdfFormIndex.get('c:\\synthetic\\two.pdf').formFields[0].rect.length, 4);
  assert.equal(f.context.pdfFormIndexPending, 0); assert.equal(f.context.pdfFormIndexInventoryCount, 2);
  assert.ok(f.invalidated.includes('c:\\known.pdf')); assert.ok(f.invalidated.includes('c:\\synthetic\\two.pdf'));
  assert.deepEqual(await f.capture(), [f.snapshotBytes, f.journalBytes], 'read cannot rewrite persisted bytes');
});

test('native journal I/O failure retains the live projection, metadata, cache and every file byte', async t => {
  const f = await indexFixture(t, {ioHook: io => ({...io, readFile: async (file, ...args) => {
    if (file.endsWith('.jsonl')) throw Object.assign(new Error('injected journal fault'), {code: 'EIO'});
    return io.readFile(file, ...args);
  }})});
  const retained = f.context.pdfFormIndex.get('c:\\known.pdf');
  await assert.rejects(f.read(), {code: 'EIO'});
  assert.equal(f.context.pdfFormIndex.get('c:\\known.pdf'), retained); assert.equal(f.context.pdfFormIndex.size, 1);
  assert.equal(f.context.pdfFormIndexPending, 4); assert.equal(f.context.pdfFormIndexSignature, 'known-signature');
  assert.deepEqual(f.invalidated, []); assert.deepEqual(await f.capture(), [f.snapshotBytes, f.journalBytes]);
});

test('compaction cannot truncate a malformed journal or serialize its partial replay', async t => {
  const f = await indexFixture(t, {journal: '{"op":"upsert","entry":{"fullPath":"C:\\\\saved.pdf","text":"saved"}}\n{"op":'});
  await assert.rejects(f.compact(), {code: 'PDF_INDEX_JOURNAL_INVALID', lineNumber: 2});
  assert.deepEqual(await f.capture(), [f.snapshotBytes, f.journalBytes]); assert.deepEqual(f.writes, []);
  assert.equal(f.context.pdfFormIndex.get('c:\\known.pdf').text, 'last known good'); assert.deepEqual(f.invalidated, []);
});

test('compaction cannot erase an unread journal following a native I/O failure', async t => {
  const f = await indexFixture(t, {ioHook: io => ({...io, readFile: async (file, ...args) => {
    if (file.endsWith('.jsonl')) throw Object.assign(new Error('injected denial'), {code: 'EACCES'});
    return io.readFile(file, ...args);
  }})});
  await assert.rejects(f.compact(), {code: 'EACCES'});
  assert.deepEqual(await f.capture(), [f.snapshotBytes, f.journalBytes]); assert.deepEqual(f.writes, []);
});

test('signature change during native read leaves the prior publication intact', async t => {
  let changed = false;
  const f = await indexFixture(t, {ioHook: io => ({...io, readFile: async (file, ...args) => {
    const value = await io.readFile(file, ...args);
    if (file.endsWith('.jsonl') && !changed) { changed = true; await io.appendFile(file, '\n'); }
    return value;
  }})});
  await assert.rejects(f.read(), {code: 'PDF_INDEX_READ_CHANGED'});
  assert.equal(f.context.pdfFormIndex.get('c:\\known.pdf').text, 'last known good'); assert.deepEqual(f.invalidated, []);
  assert.equal(await fs.readFile(f.journalPath, 'utf8'), f.journalBytes + '\n', 'newer writer bytes are retained');
});

test('exact fixture restoration and fresh-reader replay preserve IDs, text and form geometry', async t => {
  const f = await indexFixture(t); await fs.appendFile(f.journalPath, '{broken');
  await assert.rejects(f.read(), {code: 'PDF_INDEX_JOURNAL_INVALID'});
  await fs.writeFile(f.journalPath, f.journalBytes); await f.read();
  const expected = [...f.context.pdfFormIndex.values()].map(row => JSON.stringify(row));
  const fresh = await f.fresh(); assert.deepEqual([...fresh.entries.values()].map(row => JSON.stringify(row)), expected);
  assert.deepEqual(await f.capture(), [f.snapshotBytes, f.journalBytes]);
  await f.compact(); const compacted = await f.fresh();
  assert.deepEqual([...compacted.entries.values()].map(row => JSON.stringify(row)), expected);
  assert.equal(JSON.parse(await fs.readFile(f.snapshotPath, 'utf8')).schema, 3); assert.equal(await fs.readFile(f.journalPath, 'utf8'), '');
});

test('only native ENOENT is a missing file; read and stat permission errors propagate', async () => {
  const missing = Object.assign(new Error('missing'), {code: 'ENOENT'});
  const absent = createPdfIndexFilePlatform({snapshotPath: 'snapshot', journalPath: 'journal', io: {readFile: async () => { throw missing; }, stat: async () => { throw missing; }}});
  assert.equal(await absent.readSnapshot(), null); assert.equal(await absent.readJournal(), null); assert.equal(await absent.signature(), 'missing|missing');
  const denied = Object.assign(new Error('denied'), {code: 'EACCES'});
  const unavailable = createPdfIndexFilePlatform({snapshotPath: 'snapshot', journalPath: 'journal', io: {readFile: async () => { throw denied; }, stat: async () => { throw denied; }}});
  await assert.rejects(unavailable.readSnapshot(), denied); await assert.rejects(unavailable.readJournal(), denied); await assert.rejects(unavailable.signature(), denied);
});
