import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { tokens } from './bank_policy_ast_fixture.mjs';

export const baseline = JSON.parse(
  fs.readFileSync(
    new URL('./fixtures/pdf-preview-policy.json', import.meta.url),
    'utf8'
  )
);
for (const entry of Object.values(baseline.functions)) assertHash(entry);
function assertHash(entry) {
  if (
    createHash('sha256').update(tokens(entry.source)).digest('hex') !==
    entry.tokenHash
  )
    throw new Error('PDF preview baseline changed');
}
export const plain = value => JSON.parse(JSON.stringify(value));
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export const field = {
  pageNumber: 1,
  annotationIndex: 0,
  fieldKey: 'id:1',
  fieldName: 'name',
  fieldType: 'Tx',
  rect: [1, 2, 3, 4],
  values: ['תוכן'],
  multiLine: false
};
export const extracted = {
  hasForm: true,
  text: 'page and form content',
  formFieldCount: 1,
  formFields: [field]
};
export const row = {
  fullPath: 'C:\\synthetic\\preview.pdf',
  name: 'preview.pdf',
  relativePath: 'C:\\synthetic',
  modified: '2026-10-15T12:00:00.000Z',
  size: 10,
  extension: 'pdf',
  attributes: ''
};
export const stat = {
  size: 10,
  mtimeMs: Date.parse(row.modified),
  mtime: new Date(row.modified)
};
export const cached = {
  ...row,
  fingerprint: '10:' + row.modified,
  fileMtimeMs: stat.mtimeMs,
  detectionRevision: 2,
  searchTextRevision: 2,
  geometryRevision: 1,
  hasForm: true,
  text: 'cached content',
  formFields: [field],
  formFieldCount: 1,
  failed: false,
  error: '',
  retryAfter: '',
  retryCount: 0,
  rootId: 'everything',
  rootLabel: 'Everything'
};
export function previewFixture(options = {}) {
  const events = [],
    logs = [],
    entries = new Map(
      options.entry ? [[row.fullPath.toLowerCase(), plain(options.entry)]] : []
    );
  const context = {
    path,
    PDF_FORM_DETECTION_REVISION: 2,
    PDF_FORM_SEARCH_TEXT_REVISION: 2,
    PDF_FORM_GEOMETRY_REVISION: 1,
    pdfFormIndex: entries,
    pdfIndexKey: file => file.toLowerCase(),
    pdfIndexFingerprint: value =>
      `${Number(value.size) || 0}:${String(value.modified || '')}`,
    serializePdfIndexEntry: plain,
    trimPreviewText: text => ({ text: String(text), truncated: false }),
    loadPdfFormIndex: async () => {
      events.push(['load']);
      if (options.load) await options.load();
    },
    extractPdfOnDemand: async (file, input) => {
      events.push([
        'extract',
        file,
        { includePageText: input.includePageText }
      ]);
      if (options.read) return options.read(file, input);
      return plain(options.result ?? extracted);
    },
    appendPdfIndexJournal: async records => {
      events.push(['append', plain(records)]);
      if (options.append) await options.append(records);
      for (const { entry } of records)
        entries.set(entry.fullPath.toLowerCase(), entry);
    },
    appendLog: async message => {
      logs.push(message);
      if (options.audit) await options.audit(message);
    }
  };
  const definitions = [
    'normalizePdfFormField',
    'normalizePdfFormFields',
    'serializePdfIndexEntry',
    'supplementalPdfData'
  ]
    .map(name => baseline.functions[name].source)
    .join('\n');
  const old = vm.runInNewContext(
    definitions +
      '\n({read:supplementalPdfData,fields:normalizePdfFormFields,serialize:serializePdfIndexEntry})',
    context
  );
  context.serializePdfIndexEntry = old.serialize;
  const ports = {
    index: {
      load: context.loadPdfFormIndex,
      get: key => entries.get(key),
      append: entry =>
        context.appendPdfIndexJournal([
          { op: 'upsert', entry: context.serializePdfIndexEntry(entry) }
        ])
    },
    extraction: { read: context.extractPdfOnDemand },
    paths: { basename: path.win32.basename, dirname: path.win32.dirname },
    presentation: { trim: context.trimPreviewText, fields: old.fields },
    policy: {
      detectionRevision: 2,
      searchTextRevision: 2,
      geometryRevision: 1
    },
    audit: { write: context.appendLog }
  };
  return {
    old,
    ports,
    context,
    entries,
    events,
    logs,
    observation: () => plain({ events, logs, entries: [...entries] })
  };
}
