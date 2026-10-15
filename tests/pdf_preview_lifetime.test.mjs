import test from 'node:test';
import assert from 'node:assert/strict';
import { createPdfPreviewOperation } from '../netunim-orders/document-bridge/pdf-preview-operation.mjs';
import {
  decodePdfExtractionResult,
  decodePdfExtractionResponse
} from '../netunim-orders/document-bridge/pdf-extraction-result.mjs';
import {
  previewFixture,
  row,
  stat,
  cached,
  extracted,
  field,
  deferred,
  plain
} from './pdf_preview_fixture.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('baseline reproduces late enrichment resurrecting an invalidated PDF; current invalidation fences it', async () => {
  for (const version of ['baseline', 'current']) {
    const entered = deferred(),
      held = deferred();
    const f = previewFixture({
      read: async () => {
        entered.resolve();
        await held.promise;
        return extracted;
      }
    });
    const owner =
      version === 'current' ? createPdfPreviewOperation(f.ports) : f.old;
    const reading = owner.read(row, stat);
    await entered.promise;
    let done = false;
    const removing =
      version === 'current'
        ? owner.invalidate(row.fullPath).then(() => {
            done = true;
          })
        : Promise.resolve().then(() => {
            done = true;
          });
    await tick();
    assert.equal(done, version === 'baseline');
    f.entries.delete(row.fullPath.toLowerCase());
    held.resolve();
    const result = await reading;
    await removing;
    assert.equal(
      f.entries.has(row.fullPath.toLowerCase()),
      version === 'baseline'
    );
    assert.equal(result === null, version === 'current');
    if (version === 'current') await owner.dispose();
  }
});

test('shutdown joins accepted load, extraction, journal publication and audit, fencing later work', async () => {
  for (const phase of ['load', 'read', 'append', 'audit']) {
    const entered = deferred(),
      held = deferred();
    let signal;
    const f = previewFixture({
      [phase]: async (_file, options) => {
        signal = options?.signal;
        entered.resolve();
        await held.promise;
        if (phase === 'read') return extracted;
      },
      ...(phase === 'audit'
        ? {
            read: async () => {
              throw new Error('synthetic failure');
            }
          }
        : {})
    });
    const owner = createPdfPreviewOperation(f.ports),
      reading = owner.read(row, stat);
    await entered.promise;
    let done = false;
    const stopping = owner.dispose().then(() => {
      done = true;
    });
    await tick();
    assert.equal(done, false);
    if (signal) assert.equal(signal.aborted, true);
    await assert.rejects(owner.read(row, stat), {
      code: 'PDF_PREVIEW_DISPOSED'
    });
    held.resolve();
    await Promise.all([reading, stopping]);
    assert.equal(done, true);
    assert.equal(
      f.events.filter(event => event[0] === 'append').length,
      phase === 'append' ? 1 : 0
    );
  }
  const f = previewFixture(),
    owner = createPdfPreviewOperation(f.ports),
    reading = owner.read(row, stat),
    rejected = assert.rejects(reading, { code: 'PDF_PREVIEW_DISPOSED' });
  await Promise.all([owner.dispose(), rejected]);
  assert.deepEqual(f.events, []);
});

test('file invalidation joins an admitted journal before removal and leaves other files active', async () => {
  const entered = deferred(),
    held = deferred(),
    f = previewFixture({
      append: async () => {
        entered.resolve();
        await held.promise;
      }
    }),
    owner = createPdfPreviewOperation(f.ports);
  const reading = owner.read(row, stat);
  await entered.promise;
  let done = false;
  const invalidating = owner.invalidate(row.fullPath.toUpperCase()).then(() => {
    done = true;
  });
  await tick();
  assert.equal(done, false);
  held.resolve();
  await Promise.all([reading, invalidating]);
  f.entries.delete(row.fullPath.toLowerCase());
  assert.equal(f.entries.size, 0);
  const next = { ...row, fullPath: 'C:\\synthetic\\other.pdf' };
  assert.ok(await owner.read(next, stat));
  assert.equal(f.entries.has(next.fullPath.toLowerCase()), true);
  await owner.dispose();
});

test('invalidation stops a queued load and cancels only its own concurrent path', async () => {
  const queued = previewFixture(),
    owner = createPdfPreviewOperation(queued.ports),
    reading = owner.read(row, stat),
    rejected = assert.rejects(reading, { code: 'PDF_PREVIEW_DISPOSED' });
  await Promise.all([owner.invalidate(row.fullPath), rejected]);
  assert.deepEqual(queued.events, []);
  await owner.dispose();
  const a = deferred(),
    b = deferred(),
    entered = deferred(),
    signals = new Map();
  let started = 0;
  const f = previewFixture({
      read: async (file, options) => {
        signals.set(file, options.signal);
        if (++started === 2) entered.resolve();
        await (file === row.fullPath ? a.promise : b.promise);
        return extracted;
      }
    }),
    active = createPdfPreviewOperation(f.ports),
    other = { ...row, fullPath: 'C:\\synthetic\\other.pdf' };
  const first = active.read(row, stat),
    second = active.read(other, stat);
  await entered.promise;
  const removing = active.invalidate(row.fullPath);
  assert.equal(signals.get(row.fullPath).aborted, true);
  assert.equal(signals.get(other.fullPath).aborted, false);
  a.resolve();
  await removing;
  assert.equal(await first, null);
  b.resolve();
  assert.ok(await second);
  assert.equal(f.entries.has(other.fullPath.toLowerCase()), true);
  await active.dispose();
});

test('malformed and contradictory worker evidence never replaces historical positive or negative entries', async () => {
  const malformed = [
    null,
    [],
    {},
    { ...extracted, hasForm: 'false' },
    { ...extracted, hasForm: false },
    { ...extracted, formFieldCount: '1' },
    { ...extracted, formFieldCount: 0 },
    { ...extracted, text: 1 },
    { ...extracted, text: '' },
    { ...extracted, formFields: [{}] },
    ...[
      'pageNumber',
      'annotationIndex',
      'fieldKey',
      'fieldName',
      'fieldType',
      'rect',
      'values',
      'multiLine'
    ].map(key => ({ ...extracted, formFields: [{ ...field, [key]: null }] })),
    { ...extracted, formFields: [{ ...field, rect: [1, 2, 3, NaN] }] },
    { ...extracted, formFields: [{ ...field, values: ['text', false] }] },
    { ...extracted, formFields: [{ ...field, pageNumber: 1.5 }] },
    { ...extracted, formFields: [{ ...field, annotationIndex: -1 }] }
  ];
  for (const value of malformed) {
    assert.throws(() => decodePdfExtractionResult(value), {
      code: 'PDF_EXTRACTION_RESULT_INVALID'
    });
    for (const entry of [
      { ...cached, geometryRevision: 0 },
      { ...cached, hasForm: false, failed: true, formFields: [], text: '' }
    ]) {
      const f = previewFixture({ entry, read: async () => value }),
        before = plain([...f.entries]),
        owner = createPdfPreviewOperation(f.ports);
      assert.equal(await owner.read(row, stat), null);
      assert.deepEqual(plain([...f.entries]), before);
      assert.equal(
        f.events.some(event => event[0] === 'append'),
        false
      );
      assert.match(f.logs[0], /PDF worker result is invalid/);
      await owner.dispose();
    }
  }
});

test('wire decoding requires explicit success, successful exit and independent typed copies of every anchor', () => {
  const value = plain(extracted),
    decoded = decodePdfExtractionResult(value);
  assert.deepEqual(
    decodePdfExtractionResponse(
      JSON.stringify({ ok: true, result: value }),
      '',
      0
    ),
    extracted
  );
  assert.deepEqual(decoded, extracted);
  value.formFields[0].rect[0] = 999;
  value.formFields[0].values.push('late');
  assert.deepEqual(decoded, extracted);
  for (const response of [
    { ok: 'true', result: extracted },
    { ok: false, error: {} },
    [],
    null,
    { result: extracted }
  ])
    assert.throws(
      () => decodePdfExtractionResponse(JSON.stringify(response), '', 0),
      { code: 'PDF_EXTRACTION_RESULT_INVALID' }
    );
  assert.throws(
    () =>
      decodePdfExtractionResponse(
        JSON.stringify({ ok: true, result: extracted }),
        'failed exit',
        1
      ),
    /exited 1: failed exit/
  );
  assert.throws(
    () => decodePdfExtractionResponse('{', '', 0),
    /PDF worker exited 0:/
  );
  assert.throws(
    () =>
      decodePdfExtractionResponse(
        JSON.stringify({ ok: false, error: 'No password given' }),
        '',
        1
      ),
    /No password given/
  );
  assert.deepEqual(
    decodePdfExtractionResult({
      hasForm: false,
      text: '',
      formFieldCount: 0,
      formFields: []
    }),
    { hasForm: false, text: '', formFieldCount: 0, formFields: [] }
  );
});
