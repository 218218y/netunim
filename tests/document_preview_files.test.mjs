import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createPreviewFilePlatform} from '../netunim-orders/document-bridge/preview-file-platform.mjs';
import {createDocumentPreview, BINARY_PREVIEW_MAX_BYTES, TEXT_PREVIEW_MAX_BYTES} from '../netunim-orders/document-bridge/preview-content.mjs';

async function fixture(t, bytes = 'synthetic') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'netunim-preview-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const fullPath = path.join(dir, 'example.pdf'); await fs.writeFile(fullPath, bytes);
  return {fullPath, dir, files: createPreviewFilePlatform()};
}

test('production preview rejects growth past 64 MiB after result metadata was captured', async t => {
  const {fullPath, files} = await fixture(t);
  const stat = await fs.stat(fullPath);
  const preview = createDocumentPreview({resolve: async () => ({mode: 'everything', officeKind: '', structuredKind: '', metadata: {
    fullPath, name: 'example.pdf', path: path.dirname(fullPath), extension: 'pdf', size: stat.size, isDirectory: false, modified: '',
  }}), files, indexedText: async () => null});
  const handle = await fs.open(fullPath, 'r+'); await handle.truncate(BINARY_PREVIEW_MAX_BYTES + 1); await handle.close();
  await assert.rejects(preview.file('opaque-result'), {code: 'PREVIEW_TOO_LARGE'});
  assert.equal((await fs.stat(fullPath)).size, BINARY_PREVIEW_MAX_BYTES + 1, 'preview does not alter the file');
});

test('growth after opened-handle stat is rejected with at most one lookahead byte', async t => {
  const {fullPath} = await fixture(t, '12345678');
  let readBytes = 0, closed = 0;
  const files = createPreviewFilePlatform({open: async (...args) => {
    const handle = await fs.open(...args);
    return {stat: async () => {
      const stat = await handle.stat(); await fs.appendFile(fullPath, '9012345'); return stat;
    }, read: async (...readArgs) => { const result = await handle.read(...readArgs); readBytes += result.bytesRead; return result; },
    close: async () => { closed++; await handle.close(); }};
  }});
  await assert.rejects(files.readBinary(fullPath, 8), {code: 'PREVIEW_TOO_LARGE'});
  assert.equal(readBytes, 9); assert.equal(closed, 1);
});

test('growth between partial reads cannot exceed the budget or return a partial binary success', async t => {
  const {fullPath} = await fixture(t, '12345678');
  let calls = 0, readBytes = 0, closed = 0;
  const files = createPreviewFilePlatform({open: async (...args) => {
    const handle = await fs.open(...args);
    return {stat: () => handle.stat(), read: async (buffer, offset, length, position) => {
      const result = await handle.read(buffer, offset, Math.min(3, length), position);
      readBytes += result.bytesRead;
      if (++calls === 1) await fs.appendFile(fullPath, 'extra-growth');
      return result;
    }, close: async () => { closed++; await handle.close(); }};
  }});
  await assert.rejects(files.readBinary(fullPath, 8), {code: 'PREVIEW_TOO_LARGE'});
  assert.equal(readBytes, 9); assert.equal(closed, 1);
});

test('empty and exact-budget binary files return all bytes, including short reads', async t => {
  const {fullPath, files} = await fixture(t, Buffer.alloc(0));
  assert.deepEqual(await files.readBinary(fullPath, 8), Buffer.alloc(0));
  await fs.writeFile(fullPath, '12345678');
  assert.equal((await files.readBinary(fullPath, 8)).toString(), '12345678');
  const short = createPreviewFilePlatform({open: async (...args) => {
    const handle = await fs.open(...args);
    return {stat: () => handle.stat(), read: (buffer, offset, length, position) => handle.read(buffer, offset, Math.min(2, length), position), close: () => handle.close()};
  }});
  assert.equal((await short.readBinary(fullPath, 8)).toString(), '12345678');
});

test('shrinking between stat and read returns actual bytes, without uninitialized padding', async t => {
  const {fullPath} = await fixture(t, '12345678');
  const files = createPreviewFilePlatform({open: async (...args) => {
    const handle = await fs.open(...args);
    return {stat: async () => { const stat = await handle.stat(); await fs.truncate(fullPath, 2); return stat; },
      read: (...readArgs) => handle.read(...readArgs), close: () => handle.close()};
  }});
  assert.equal((await files.readBinary(fullPath, 8)).toString(), '12');
});

test('text reads use the opened file rather than stale search size', async t => {
  const {fullPath, files} = await fixture(t, 'expanded עברית');
  assert.deepEqual(await files.readText(fullPath), {text: 'expanded עברית', truncated: false});
});

test('text that shrinks after stat is not falsely marked truncated', async t => {
  const {fullPath} = await fixture(t, Buffer.alloc(TEXT_PREVIEW_MAX_BYTES + 1, 65));
  const files = createPreviewFilePlatform({open: async (...args) => {
    const handle = await fs.open(...args);
    return {stat: async () => { const stat = await handle.stat(); await fs.truncate(fullPath, 3); return stat; },
      read: (...readArgs) => handle.read(...readArgs), close: () => handle.close()};
  }});
  assert.deepEqual(await files.readText(fullPath), {text: 'AAA', truncated: false});
});

test('text byte and character budgets disclose truncation without returning the lookahead', async t => {
  const {fullPath, files} = await fixture(t, Buffer.alloc(TEXT_PREVIEW_MAX_BYTES + 1, 65));
  const data = await files.readText(fullPath);
  assert.equal(data.text.length, 600000); assert.equal(data.truncated, true);
  await fs.writeFile(fullPath, Buffer.alloc(TEXT_PREVIEW_MAX_BYTES, 0));
  assert.deepEqual(await files.readText(fullPath), {text: '', truncated: false});
});

for (const failure of ['stat', 'read', 'oversize', 'non-file']) {
  test(`opened preview handle closes on ${failure}`, async () => {
    let closed = 0, reads = 0;
    const failureError = Object.assign(new Error('injected'), {code: 'EIO'});
    const files = createPreviewFilePlatform({open: async () => ({
      stat: async () => { if (failure === 'stat') throw failureError; return {size: failure === 'oversize' ? 9 : 3, isFile: () => failure !== 'non-file'}; },
      read: async () => { reads++; throw failureError; }, close: async () => { closed++; },
    })});
    await assert.rejects(files.readBinary('synthetic', 8), {code: failure === 'oversize' ? 'PREVIEW_TOO_LARGE' : failure === 'non-file' ? 'PREVIEW_NOT_FILE' : 'EIO'});
    assert.equal(closed, 1); assert.equal(reads, failure === 'read' ? 1 : 0);
  });
}

test('invalid budgets fail before opening a file', async () => {
  let opened = 0;
  const files = createPreviewFilePlatform({open: async () => { opened++; throw new Error('must not open'); }});
  for (const value of [0, -1, NaN, Infinity, 1.5, '8']) await assert.rejects(files.readBinary('synthetic', value), /document_preview_byte_budget_required/);
  assert.equal(opened, 0);
});

test('repeated failed and successful previews leave no held file handles', async t => {
  const {fullPath} = await fixture(t, 'synthetic');
  let opened = 0, closed = 0;
  const files = createPreviewFilePlatform({open: async (...args) => {
    const handle = await fs.open(...args); opened++;
    return {stat: () => handle.stat(), read: (...readArgs) => handle.read(...readArgs), close: async () => { await handle.close(); closed++; }};
  }});
  for (let cycle = 0; cycle < 100; cycle++) {
    await assert.rejects(files.readBinary(fullPath, 3), {code: 'PREVIEW_TOO_LARGE'});
    assert.equal((await files.readBinary(fullPath, 9)).toString(), 'synthetic');
    assert.equal(closed, opened, 'each completed request closes its own native handle');
    await fs.rename(fullPath, fullPath + '.moved'); await fs.rename(fullPath + '.moved', fullPath);
  }
  assert.equal(opened, 200); assert.equal(closed, 200);
});
