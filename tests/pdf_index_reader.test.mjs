import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdfIndexReader} from '../netunim-orders/document-bridge/pdf-index-reader.mjs';

const row = (fullPath, text = 'retained') => ({fullPath, text});
const normalizeEntry = value => value;
function fixture({snapshot = {schema: 3, entries: []}, journal = '', signatures = ['stable', 'stable'], failure} = {}) {
  let signatureCalls = 0;
  return createPdfIndexReader({normalizeEntry, files: {
    readSnapshot: async () => { if (failure === 'snapshot') throw Object.assign(new Error('snapshot fault'), {code: 'EIO'}); return snapshot === null ? null : typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot); },
    readJournal: async () => { if (failure === 'journal') throw Object.assign(new Error('journal fault'), {code: 'EIO'}); return journal; },
    signature: async () => { if (failure === 'signature') throw Object.assign(new Error('stat fault'), {code: 'EACCES'}); return signatures[Math.min(signatureCalls++, signatures.length - 1)]; },
  }});
}

test('snapshot and ordered journal replay preserve IDs, updates and explicit removals', async () => {
  const snapshot = {schema: 3, entries: [row('C:\\A.pdf', 'base'), row('C:\\B.pdf')], pending: 2, pdfCount: 7, updatedAt: '2026-10-12T00:00:00Z'};
  const journal = [
    {op: 'upsert', entry: row('c:\\a.pdf', 'latest')}, {op: 'remove', fullPath: 'c:\\B.PDF'},
    {op: 'upsert', entry: row('C:\\C.pdf', 'new')}, {op: 'remove', fullPath: 'C:\\missing.pdf'},
  ].map(JSON.stringify).join('\n') + '\n';
  const result = await fixture({snapshot, journal}).read();
  assert.deepEqual([...result.entries.keys()], ['c:\\a.pdf', 'c:\\c.pdf']);
  assert.equal(result.entries.get('c:\\a.pdf').text, 'latest');
  assert.equal(result.pending, 2); assert.equal(result.pdfCount, 7); assert.equal(result.updatedAt, Date.parse(snapshot.updatedAt));
  assert.equal(result.signature, 'stable');
});

test('historical schemas, nullable/missing metadata, BOM and CRLF remain readable', async () => {
  for (const schema of [1, 2, 3, '3']) {
    const snapshot = '\uFEFF' + JSON.stringify({schema, entries: [row('C:\\old.pdf')], pending: null, pdfCount: null});
    const result = await fixture({snapshot, journal: '\uFEFF\r\n' + JSON.stringify({op: 'upsert', entry: row('C:\\new.pdf')}) + '\r\n'}).read();
    assert.equal(result.entries.size, 2); assert.equal(result.pending, 0); assert.equal(result.pdfCount, 0); assert.equal(result.updatedAt, 0);
  }
  const numeric = await fixture({snapshot: {schema: 3, entries: [], pending: '2', pdfCount: '7'}}).read();
  assert.equal(numeric.pending, 2); assert.equal(numeric.pdfCount, 7);
});

test('missing files bootstrap empty or replay an existing journal without a snapshot', async () => {
  const empty = await fixture({snapshot: null, journal: null}).read(); assert.equal(empty.entries.size, 0);
  const result = await fixture({snapshot: null, journal: JSON.stringify({op: 'upsert', entry: row('C:\\retained.pdf')})}).read();
  assert.equal(result.entries.get('c:\\retained.pdf').text, 'retained');
});

for (const snapshot of ['{', '', false, [], {schema: 4, entries: []}, {schema: true, entries: []}, {schema: [3], entries: []}, {schema: 3}, {schema: 3, entries: [null]}, {schema: 3, entries: [{fullPath: ''}]}, {schema: 3, entries: [{fullPath: 5}]}]) {
  test(`invalid snapshot shape rejects without normalization: ${JSON.stringify(snapshot)}`, async () => {
    await assert.rejects(fixture({snapshot}).read(), {code: 'PDF_INDEX_SNAPSHOT_INVALID'});
  });
}

test('malformed journal after valid operations fails with safe line diagnostics', async () => {
  const journal = JSON.stringify({op: 'upsert', entry: row('C:\\saved.pdf', 'PRIVATE_SYNTHETIC_CONTENT')}) + '\n{"op":';
  await assert.rejects(fixture({journal}).read(), error => {
    assert.equal(error.code, 'PDF_INDEX_JOURNAL_INVALID'); assert.equal(error.lineNumber, 2);
    assert.doesNotMatch(error.message, /PRIVATE_SYNTHETIC_CONTENT|saved\.pdf/); return true;
  });
});

for (const record of [null, [], {}, {op: 'future'}, {op: 'remove'}, {op: 'remove', fullPath: 3}, {op: 'upsert', entry: null}, {op: 'upsert', entry: {fullPath: ''}}]) {
  test(`invalid journal record fails closed: ${JSON.stringify(record)}`, async () => {
    await assert.rejects(fixture({journal: JSON.stringify(record)}).read(), {code: 'PDF_INDEX_JOURNAL_INVALID', lineNumber: 1});
  });
}

test('invalid count metadata cannot be normalized to a fictitious zero', async () => {
  for (const value of ['not a number', -1, 0.5, true, [], Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(fixture({snapshot: {schema: 3, entries: [], pending: value}}).read(), {code: 'PDF_INDEX_SNAPSHOT_INVALID'});
  }
});

test('I/O and signature errors retain their native classification', async () => {
  for (const failure of ['snapshot', 'journal', 'signature']) await assert.rejects(fixture({failure}).read(), {code: failure === 'signature' ? 'EACCES' : 'EIO'});
});

test('changed disk signature cannot certify the decoded candidate', async () => {
  await assert.rejects(fixture({signatures: ['before', 'after']}).read(), {code: 'PDF_INDEX_READ_CHANGED'});
});

test('a normalizer cannot silently discard or relocate a persisted entry', async () => {
  for (const normalize of [() => null, () => row('C:\\foreign.pdf')]) {
    const reader = createPdfIndexReader({files: {readSnapshot: async () => JSON.stringify({schema: 3, entries: [row('C:\\original.pdf')]}), readJournal: async () => null, signature: async () => 'stable'}, normalizeEntry: normalize});
    await assert.rejects(reader.read(), {code: 'PDF_INDEX_SNAPSHOT_INVALID'});
  }
});

test('reader rejects unbound ports before reading disk', () => {
  assert.throws(() => createPdfIndexReader({files: {}, normalizeEntry}), /pdf_index_reader_ports_required/);
});
