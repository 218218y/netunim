import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPdfExtractionProcess } from '../netunim-orders/document-bridge/pdf-extraction-process.mjs';
import { createPdfExtractionPlatform } from '../netunim-orders/document-bridge/pdf-extraction-platform.mjs';
import { deferred } from './pdf_preview_fixture.mjs';
const script = fileURLToPath(
  new URL('./fixtures/pdf_extraction_worker.mjs', import.meta.url)
);
async function fixture(t, { worker = script, limits, args = [] } = {}) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'netunim-pdf-עברית-'));
  assert.equal(path.dirname(cwd), path.resolve(os.tmpdir()));
  const children = [],
    ready = deferred();
  const host = createPdfExtractionPlatform({
    executable: process.execPath,
    script: worker,
    cwd,
    spawnWorker: (file, values, options) => {
      const child = spawn(file, [...values, ...args], options);
      children.push(child);
      child.stdout.on('data', () => ready.resolve());
      return child;
    }
  });
  const owner = createPdfExtractionProcess(
    { ...host, runtime: { setTimeout, clearTimeout } },
    limits
  );
  t.after(async () => {
    await owner.dispose();
    await fs.rm(cwd, { recursive: true, force: true });
  });
  return { owner, children, ready, cwd };
}

test('native worker preserves Unicode paths, cwd and geometry-only input and joins actual close on timeout/overflow', async t => {
  const f = await fixture(t);
  const result = await f.owner.read('נתיב.pdf', { includePageText: false });
  assert.equal(result.text, `${f.cwd}|נתיב.pdf|false`);
  assert.equal(f.children[0].exitCode, 0);
  for (const [file, limits, message] of [
    ['hold', { timeoutMs: 80 }, /timed out/],
    ['overflow', { maxOutputChars: 100 }, /output too large/]
  ]) {
    const native = await fixture(t, { limits });
    await assert.rejects(native.owner.read(file), message);
    assert.ok(
      native.children[0].exitCode !== null ||
        native.children[0].signalCode !== null
    );
  }
});

test('native abort and shutdown return only after worker exit and a broken stdin pipe cannot crash the bridge', async t => {
  for (const mode of ['abort', 'dispose']) {
    const f = await fixture(t),
      controller = new AbortController();
    const reading = f.owner.read('hold', { signal: controller.signal });
    const rejected = assert.rejects(reading, {
      code: mode === 'abort' ? 'ABORT_ERR' : 'PDF_EXTRACTION_DISPOSED'
    });
    await f.ready.promise;
    const stopping = mode === 'abort' ? controller.abort() : f.owner.dispose();
    await Promise.all([rejected, stopping]);
    assert.ok(
      f.children[0].exitCode !== null || f.children[0].signalCode !== null
    );
  }
  const broken = await fixture(t, { args: ['--closed-input'] });
  await assert.rejects(broken.owner.read('x'.repeat(2 * 1024 * 1024)));
  assert.equal(broken.children.length, 1);
  assert.ok(
    broken.children[0].exitCode !== null ||
      broken.children[0].signalCode !== null
  );
  assert.equal(
    (await (await fixture(t)).owner.read('still alive')).hasForm,
    true
  );
});

test('native missing executable and malformed success responses reject without publishing guessed negative data', async t => {
  const f = await fixture(t);
  await assert.rejects(f.owner.read('malformed'), {
    code: 'PDF_EXTRACTION_RESULT_INVALID'
  });
  const owner = createPdfExtractionProcess({
    ...createPdfExtractionPlatform({
      executable: path.join(f.cwd, 'missing-node.exe'),
      script,
      cwd: f.cwd
    }),
    runtime: { setTimeout, clearTimeout }
  });
  await assert.rejects(owner.read('synthetic'), { code: 'ENOENT' });
  await owner.dispose();
});

test('the actual PDF.js subprocess decodes Hebrew AcroForm geometry, ordinary PDFs and password/corrupt failures', async t => {
  const worker = fileURLToPath(
      new URL(
        '../netunim-orders/document-bridge/pdf-extract-worker.mjs',
        import.meta.url
      )
    ),
    f = await fixture(t, { worker });
  const corpus = fileURLToPath(
    new URL('./fixtures/pdf-corpus/', import.meta.url)
  );
  for (const includePageText of [true, false]) {
    const result = await f.owner.read(
      path.join(corpus, 'acroform-hebrew-controls.pdf'),
      { includePageText }
    );
    assert.equal(result.hasForm, true);
    assert.ok(
      result.formFields.some(field => field.values.includes('שלום עולם'))
    );
    assert.ok(result.formFields.every(field => field.rect.length === 4));
  }
  assert.equal(
    (await f.owner.read(path.join(corpus, 'ordinary-text.pdf'))).hasForm,
    false
  );
  await assert.rejects(
    f.owner.read(path.join(corpus, 'password-protected.pdf')),
    /password/i
  );
  await assert.rejects(
    f.owner.read(path.join(corpus, 'corrupt-truncated.pdf'))
  );
  assert.ok(
    f.children.every(
      child => child.exitCode !== null || child.signalCode !== null
    )
  );
});
