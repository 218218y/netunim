import test from 'node:test';
import assert from 'node:assert/strict';
import { createPdfPreviewOperation } from '../netunim-orders/document-bridge/pdf-preview-operation.mjs';
import {
  previewFixture,
  row,
  stat,
  cached,
  extracted,
  plain
} from './pdf_preview_fixture.mjs';

test('864 original/current PDF preview cases preserve warm/negative/legacy geometry policy, text, journals and fallback logs', async () => {
  let cases = 0;
  for (const hasForm of [true, false])
    for (const failed of [true, false])
      for (const detectionRevision of [0, 2])
        for (const searchTextRevision of [0, 2, 3])
          for (const geometryRevision of [0, 1])
            for (const formFields of [[], extracted.formFields])
              for (const fingerprint of ['current', 'size', 'time'])
                for (const outcome of ['form', 'negative', 'failure']) {
                  const entry = {
                    ...cached,
                    hasForm,
                    failed,
                    detectionRevision,
                    searchTextRevision,
                    geometryRevision,
                    formFields,
                    ...(fingerprint === 'size'
                      ? { size: 11 }
                      : fingerprint === 'time'
                        ? { fileMtimeMs: stat.mtimeMs - 1000 }
                        : {})
                  };
                  const options = {
                    entry,
                    ...(outcome === 'negative'
                      ? {
                          result: {
                            hasForm: false,
                            text: '',
                            formFields: [],
                            formFieldCount: 0
                          }
                        }
                      : outcome === 'failure'
                        ? {
                            read: async () => {
                              throw new Error('synthetic failure');
                            }
                          }
                        : {})
                  };
                  const old = previewFixture(options),
                    current = previewFixture(options),
                    owner = createPdfPreviewOperation(current.ports);
                  assert.deepEqual(
                    plain(await owner.read(row, stat)),
                    plain(await old.old.read(row, stat)),
                    JSON.stringify({
                      hasForm,
                      failed,
                      detectionRevision,
                      searchTextRevision,
                      geometryRevision,
                      formFields,
                      fingerprint,
                      outcome
                    })
                  );
                  assert.deepEqual(current.observation(), old.observation());
                  await owner.dispose();
                  cases++;
                }
  assert.equal(cases, 864);
});

test('uncached paths, timestamp fallback, inclusive one-second expiry and load/append errors retain original publication', async () => {
  for (const entry of [
    undefined,
    { ...cached, fileMtimeMs: 0 },
    { ...cached, fileMtimeMs: stat.mtimeMs - 999 },
    { ...cached, fileMtimeMs: stat.mtimeMs - 1000 }
  ])
    for (const phase of ['none', 'load', 'append']) {
      const options = {
          entry,
          ...(phase === 'none'
            ? {}
            : {
                [phase]: async () => {
                  throw new Error('synthetic failure');
                }
              })
        },
        old = previewFixture(options),
        current = previewFixture(options),
        owner = createPdfPreviewOperation(current.ports);
      const command = { ...row, name: '', relativePath: '', modified: '' };
      assert.deepEqual(
        plain(await owner.read(command, stat)),
        plain(await old.old.read(command, stat))
      );
      assert.deepEqual(current.observation(), old.observation());
      await owner.dispose();
    }
});
