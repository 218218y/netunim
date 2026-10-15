import test from 'node:test';
import assert from 'node:assert/strict';
import {
  previewFixture,
  row,
  stat,
  cached,
  extracted,
  plain
} from './pdf_preview_fixture.mjs';

test('before-change PDF preview policy distinguishes warm, negative, legacy geometry, changed and failed records', async () => {
  const warm = previewFixture({ entry: cached });
  assert.deepEqual(plain(await warm.old.read(row, stat)), {
    text: cached.text,
    truncated: false,
    formFields: extracted.formFields
  });
  assert.deepEqual(warm.events, [['load']]);
  const negative = previewFixture({
    entry: { ...cached, hasForm: false, text: '', formFields: [] }
  });
  assert.equal(await negative.old.read(row, stat), null);
  assert.deepEqual(negative.events, [['load']]);
  for (const entry of [
    undefined,
    { ...cached, geometryRevision: 0 },
    { ...cached, searchTextRevision: 1 },
    { ...cached, fileMtimeMs: stat.mtimeMs - 1000 },
    { ...cached, hasForm: false, failed: true, text: '', formFields: [] }
  ]) {
    const f = previewFixture({ entry });
    const result = await f.old.read(row, stat);
    assert.ok(result.text);
    assert.equal(f.events[1][0], 'extract');
    assert.equal(f.events[1][2].includePageText, entry?.geometryRevision !== 0);
    assert.equal(f.events[2][0], 'append');
  }
});

test('before-change extraction and journal faults fall back without publishing a candidate', async () => {
  for (const phase of ['load', 'read', 'append']) {
    const f = previewFixture({
      [phase]: async () => {
        throw new Error('synthetic failure');
      }
    });
    assert.equal(await f.old.read(row, stat), null);
    assert.equal(f.entries.size, 0);
    assert.equal(f.logs.length, 1);
  }
});
