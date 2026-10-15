import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { parse } from 'acorn';
import { createPdfPreviewOperation } from '../netunim-orders/document-bridge/pdf-preview-operation.mjs';
import { createPdfExtractionProcess } from '../netunim-orders/document-bridge/pdf-extraction-process.mjs';
import { indexFixture } from './pdf_index_file_fixture.mjs';
import { deferred, extracted, row } from './pdf_preview_fixture.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t, { read, append } = {}) {
  const disk = await indexFixture(t);
  await disk.read();
  const source = await fs.readFile(
      new URL('../netunim-orders/document-bridge/server.mjs', import.meta.url),
      'utf8'
    ),
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const definitions = ast.body.filter(
    node =>
      (node.type === 'FunctionDeclaration' &&
        [
          'supplementalPdfData',
          'invalidateResultPath',
          'prepareShutdown'
        ].includes(node.id.name)) ||
      (node.type === 'VariableDeclaration' &&
        node.declarations.some(item =>
          ['pdfPreviewOperation', 'pdfExtractionProcesses'].includes(
            item.id.name
          )
        ))
  );
  const logs = [],
    events = [],
    context = disk.context;
  const appendJournal = context.appendPdfIndexJournal;
  Object.assign(context, {
    createPdfPreviewOperation,
    createPdfExtractionProcess,
    APP_ROOT: path.dirname(disk.snapshotPath),
    RUNTIME_ROOT: 'synthetic',
    process: { execPath: process.execPath, pid: 10 },
    setTimeout,
    clearTimeout,
    createPdfExtractionPlatform: () => ({
      worker: {
        start: (request, callbacks) => {
          events.push(['start', request]);
          Promise.resolve().then(async () => {
            try {
              const result = read ? await read(request) : extracted;
              callbacks.output(JSON.stringify({ ok: true, result }));
              callbacks.close(0);
            } catch (error) {
              callbacks.error(error);
              callbacks.close(1);
            }
          });
          return {
            kill: () => {
              events.push(['kill']);
            }
          };
        }
      }
    }),
    PDF_FORM_DETECTION_REVISION: 2,
    PDF_FORM_SEARCH_TEXT_REVISION: 2,
    PDF_FORM_GEOMETRY_REVISION: 1,
    appendLog: async text => logs.push(text),
    trimPreviewText: text => ({ text, truncated: false }),
    appendPdfIndexJournal: async records => {
      if (append) await append(records);
      await appendJournal(records);
    },
    previewTextCache: { invalidate: () => {}, dispose: () => {} },
    documentResults: { invalidate: () => ['opaque'], dispose: () => {} },
    shuttingDown: false,
    documentSearch: { dispose: async () => {} },
    everythingSession: { dispose: async () => {} },
    everythingDiscovery: { dispose: async () => {} },
    everythingProcesses: { dispose: async () => {} },
    pdfMaintenanceOperation: { dispose: async () => {} },
    manualMaintenance: { dispose: async () => {} },
    nativePreviewSession: { dispose: async () => {} }
  });
  const api = vm.runInNewContext(
    definitions.map(node => source.slice(node.start, node.end)).join('\n') +
      '\n({read:supplementalPdfData,invalidate:invalidateResultPath,stop:prepareShutdown})',
    context
  );
  const file = path.join(path.dirname(disk.snapshotPath), 'preview.pdf');
  await fs.writeFile(file, 'synthetic');
  const stat = await fs.stat(file);
  return {
    ...disk,
    ...api,
    row: { ...row, fullPath: file },
    stat,
    logs,
    events
  };
}

test('actual server preview composition writes a replayable native index entry with validated anchors', async t => {
  const f = await fixture(t);
  assert.equal((await f.read(f.row, f.stat)).text, extracted.text);
  const recovered = await f.fresh(),
    entry = recovered.entries.get(f.row.fullPath.toLowerCase());
  assert.equal(entry.text, extracted.text);
  assert.equal(entry.formFields[0].fieldKey, extracted.formFields[0].fieldKey);
  await f.stop();
});

test('actual server retains both native index files when worker evidence is malformed', async t => {
  const f = await fixture(t, {
      read: async () => ({ ...extracted, hasForm: 'false' })
    }),
    before = await f.capture();
  assert.equal(await f.read(f.row, f.stat), null);
  assert.deepEqual(await f.capture(), before);
  assert.ok(f.logs.some(text => text.includes('PDF worker result is invalid')));
  await f.stop();
});

test('actual server shutdown joins the extraction child and suppresses its late journal write', async t => {
  const entered = deferred(),
    held = deferred(),
    f = await fixture(t, {
      read: async () => {
        entered.resolve();
        await held.promise;
        return extracted;
      }
    }),
    before = await f.capture();
  const reading = f.read(f.row, f.stat);
  await entered.promise;
  let done = false;
  const stopping = f.stop().then(() => {
    done = true;
  });
  await tick();
  assert.equal(done, false);
  assert.ok(f.events.some(event => event[0] === 'kill'));
  held.resolve();
  assert.equal(await reading, null);
  await stopping;
  assert.deepEqual(await f.capture(), before);
  assert.equal(done, true);
});

test('actual server file removal joins accepted journal publication before its durable remove record', async t => {
  const entered = deferred(),
    held = deferred(),
    f = await fixture(t, {
      append: async records => {
        if (records[0].op === 'upsert') {
          entered.resolve();
          await held.promise;
        }
      }
    });
  const reading = f.read(f.row, f.stat);
  await entered.promise;
  let done = false;
  const removing = f.invalidate(f.row.fullPath).then(() => {
    done = true;
  });
  await tick();
  assert.equal(done, false);
  held.resolve();
  await Promise.all([reading, removing]);
  const recovered = await f.fresh();
  assert.equal(recovered.entries.has(f.row.fullPath.toLowerCase()), false);
  const records = (await fs.readFile(f.journalPath, 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.equal(records.at(-1).op, 'remove');
  await f.stop();
});
