import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {parse} from 'acorn';
import {createPdfIndexReader} from '../netunim-orders/document-bridge/pdf-index-reader.mjs';
import {createPdfIndexFilePlatform} from '../netunim-orders/document-bridge/pdf-index-file-platform.mjs';

export const snapshotRow = {fullPath: 'C:\\synthetic\\one.pdf', text: 'snapshot text', size: null, hasForm: true, extractorRevision: 1};
export const journalRow = {fullPath: 'C:\\synthetic\\two.pdf', text: 'journal text', size: 3, hasForm: true, formFields: [{pageNumber: 1, annotationIndex: 0, fieldKey: 'field', rect: [1, 2, 3, 4], values: ['journal text']}]};

export async function indexFixture(t, {ioHook = value => value, journal} = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'netunim-pdf-index-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const snapshotPath = path.join(dir, 'index.json'), journalPath = path.join(dir, 'index.jsonl');
  const snapshotBytes = JSON.stringify({schema: 1, entries: [snapshotRow], pending: null, pdfCount: 2, updatedAt: '2026-10-12T00:00:00Z'});
  const journalBytes = journal ?? JSON.stringify({op: 'upsert', entry: journalRow}) + '\n';
  await fs.writeFile(snapshotPath, snapshotBytes); await fs.writeFile(journalPath, journalBytes);
  const source = await fs.readFile(new URL('../netunim-orders/document-bridge/server.mjs', import.meta.url), 'utf8');
  const program = parse(source, {ecmaVersion: 'latest', sourceType: 'module'});
  const names = new Set(['pdfIndexKey', 'normalizePdfFormField', 'normalizePdfFormFields', 'normalizePdfIndexEntry', 'serializePdfIndexEntry', 'readPdfIndexFiles', 'compactPdfFormIndex']);
  const definitions = program.body.filter(node => node.type === 'FunctionDeclaration' && names.has(node.id.name));
  const variableNames = new Set(['pdfIndexFiles', 'pdfIndexReader', 'pdfIndexSignature']);
  const variables = program.body.filter(node => node.type === 'VariableDeclaration' && node.declarations.some(item => variableNames.has(item.id.name)));
  const io = ioHook(fs), invalidated = [], writes = [];
  const context = {fs: io, path, PDF_FORM_INDEX_PATH: snapshotPath, PDF_FORM_INDEX_JOURNAL_PATH: journalPath, PDF_FORM_INDEX_LOCK_PATH: path.join(dir, 'lock'), PDF_FORM_INDEX_SCHEMA: 3,
    createPdfIndexReader, createPdfIndexFilePlatform: options => createPdfIndexFilePlatform({...options, io}),
    pdfFormIndex: new Map([['c:\\known.pdf', {fullPath: 'C:\\known.pdf', text: 'last known good'}]]),
    previewTextCache: {invalidate: key => invalidated.push(key)},
    pdfFormIndexPending: 4, pdfFormIndexInventoryCount: 1, pdfFormIndexLastRefresh: 10, pdfFormIndexLoaded: true, pdfFormIndexSignature: 'known-signature',
    withFileLock: async (_lock, work) => work(),
    writeJsonFile: async (file, value) => { writes.push(file); await fs.writeFile(file, JSON.stringify(value)); },
  };
  const production = vm.runInNewContext([...definitions.map(node => source.slice(node.start, node.end)), ...variables.map(node => source.slice(node.start, node.end)),
    '({read:readPdfIndexFiles,compact:compactPdfFormIndex,normalize:normalizePdfIndexEntry})'].join('\n'), context);
  return {...production, context, snapshotPath, journalPath, snapshotBytes, journalBytes, invalidated, writes,
    capture: async () => [await fs.readFile(snapshotPath, 'utf8'), await fs.readFile(journalPath, 'utf8')],
    fresh: () => createPdfIndexReader({files: createPdfIndexFilePlatform({snapshotPath, journalPath}), normalizeEntry: production.normalize}).read()};
}
