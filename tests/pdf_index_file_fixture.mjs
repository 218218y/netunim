import {documentBridgeSource} from './document_bridge_source.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createPdfIndexReader} from '../netunim-orders/document-bridge/pdf-index-reader.mjs';
import {createPdfIndexFilePlatform} from '../netunim-orders/document-bridge/pdf-index-file-platform.mjs';
import {createPdfIndexWriter} from '../netunim-orders/document-bridge/pdf-index-writer.mjs';
import {createPdfIndexWritePlatform} from '../netunim-orders/document-bridge/pdf-index-write-platform.mjs';
import {createFileLockOwner} from '../netunim-orders/document-bridge/file-lock-owner.mjs';
import {createFileLockPlatform} from '../netunim-orders/document-bridge/file-lock-platform.mjs';

export const snapshotRow = {fullPath: 'C:\\synthetic\\one.pdf', text: 'snapshot text', size: null, hasForm: true, extractorRevision: 1};
export const journalRow = {fullPath: 'C:\\synthetic\\two.pdf', text: 'journal text', size: 3, hasForm: true, formFields: [{pageNumber: 1, annotationIndex: 0, fieldKey: 'field', rect: [1, 2, 3, 4], values: ['journal text']}]};

export async function indexFixture(t, {ioHook = value => value, journal} = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'netunim-pdf-index-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const snapshotPath = path.join(dir, 'index.json'), journalPath = path.join(dir, 'index.jsonl');
  const snapshotBytes = JSON.stringify({schema: 1, entries: [snapshotRow], pending: null, pdfCount: 2, updatedAt: '2026-10-12T00:00:00Z'});
  const journalBytes = journal ?? JSON.stringify({op: 'upsert', entry: journalRow}) + '\n';
  await fs.writeFile(snapshotPath, snapshotBytes); await fs.writeFile(journalPath, journalBytes);
  const {source,ast:program}=documentBridgeSource();
  const names = new Set(['pdfIndexKey', 'pdfIndexFingerprint', 'normalizePdfFormField', 'normalizePdfFormFields', 'normalizePdfIndexEntry', 'serializePdfIndexEntry', 'publishPdfIndexCandidate', 'readPdfIndexFiles', 'loadPdfFormIndex', 'appendPdfIndexJournal', 'compactPdfFormIndex','remove','view']);
  const definitions = program.body.filter(node => node.type === 'FunctionDeclaration' && names.has(node.id.name));
  const variableNames = new Set(['pdfIndexFiles', 'pdfIndexReader', 'pdfIndexSignature', 'pdfIndexWriter']);
  const variables = program.body.filter(node => node.type === 'VariableDeclaration' && node.declarations.some(item => variableNames.has(item.id.name)));
  const io = ioHook(fs), invalidated = [], writes = [];
  const locks=createFileLockOwner({...createFileLockPlatform({root:dir}),clock:()=>performance.now(),wait:ms=>new Promise(resolve=>setTimeout(resolve,ms))});
  const context = {fs: io, path, PDF_FORM_INDEX_PATH: snapshotPath, PDF_FORM_INDEX_JOURNAL_PATH: journalPath, PDF_FORM_INDEX_LOCK_PATH: path.join(dir, 'lock'),
    createPdfIndexReader, createPdfIndexFilePlatform: options => createPdfIndexFilePlatform({...options, io}),
    createPdfIndexWriter,createPdfIndexWritePlatform:options=>{
      const files=createPdfIndexWritePlatform({...options,io});return {...files,replaceSnapshot:async text=>{writes.push(snapshotPath);await files.replaceSnapshot(text)},clearJournal:async()=>{writes.push(journalPath);await files.clearJournal()}};
    },
    pdfFormIndex: new Map([['c:\\known.pdf', {fullPath: 'C:\\known.pdf', text: 'last known good'}]]),
    previewTextCache: {invalidate: key => invalidated.push(key)},
    pdfFormIndexPending: 4, pdfFormIndexInventoryCount: 1, pdfFormIndexLastRefresh: 10, pdfFormIndexLoaded: true, pdfFormIndexSignature: 'known-signature',
    withFileLock: (lock, work) => locks.run(lock,work),
  };
  const production = vm.runInNewContext([...definitions.map(node => source.slice(node.start, node.end)), ...variables.map(node => source.slice(node.start, node.end)),
    '({read:readPdfIndexFiles,append:appendPdfIndexJournal,compact:compactPdfFormIndex,normalize:normalizePdfIndexEntry,load:loadPdfFormIndex,remove,view})'].join('\n'), context);
  context.runtime={isStopping:()=>context.shuttingDown||context.pdfMaintenanceStopRequested};
  context.pdfIndexRuntime={index:{load:production.load,entries:context.pdfFormIndex,view:()=>({pending:context.pdfFormIndexPending,pdfCount:context.pdfFormIndexInventoryCount}),publishPending:pending=>{context.pdfFormIndexPending=pending},append:(...args)=>context.appendPdfIndexJournal(...args),serialize:production.normalize,compact:production.compact},inventory:{rebuild:(...args)=>context.rebuildPdfFormIndexBacklog(...args)},remove:production.remove,view:production.view};
  // Serialization must retain the exact production wire shape, not normalization.
  context.pdfIndexRuntime.index.serialize=vm.runInNewContext('serializePdfIndexEntry',context);
  return {...production, context, snapshotPath, journalPath, snapshotBytes, journalBytes, invalidated, writes,
    capture: async () => [await fs.readFile(snapshotPath, 'utf8'), await fs.readFile(journalPath, 'utf8')],
    fresh: () => createPdfIndexReader({files: createPdfIndexFilePlatform({snapshotPath, journalPath}), normalizeEntry: production.normalize}).read()};
}
