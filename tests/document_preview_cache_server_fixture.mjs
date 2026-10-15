import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {parse} from 'acorn';
import {buildContentMatchInfo, normalizeSearchText, normalizeContentSearchOptions} from '../netunim-orders/document-bridge/lib.mjs';

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

// Exercise the production server's private read/invalidation wiring without
// starting its installed listener, Everything, maintenance or provider processes.
export async function serverFixture(t, {createPreviewTextCache} = {}) {
  const source = await fs.readFile(new URL('../netunim-orders/document-bridge/server.mjs', import.meta.url), 'utf8');
  const program = parse(source, {ecmaVersion: 'latest', sourceType: 'module'});
  const names = new Set(['prunePreviewTextCache', 'loadSearchablePreviewText', 'searchablePreviewText', 'previewMatches', 'invalidateResultPath']);
  const declarations = program.body.filter(node => node.type === 'FunctionDeclaration' && names.has(node.id.name));
  const cacheDeclaration = program.body.find(node => node.type === 'VariableDeclaration' && node.declarations.some(entry => entry.id.name === 'previewTextCache'));
  if (!cacheDeclaration || !declarations.some(node => node.id.name === 'searchablePreviewText')) throw new Error('missing production preview cache owner');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'netunim-preview-cache-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const fullPath = path.join(dir, 'synthetic.txt'); await fs.writeFile(fullPath, 'old');
  const row = {fullPath, query: 'old', mode: 'content', contentSearch: {}}, stat = await fs.stat(fullPath), firstStarted = deferred(), firstRelease = deferred();
  t.after(() => firstRelease.resolve());
  let reads = 0;
  const context = {
    createPreviewTextCache, PREVIEW_TEXT_CACHE_TTL_MS: 600000, PREVIEW_TEXT_CACHE_MAX: 24,
    documentExtension: () => 'txt', isTextPreview: () => true,
    resolveResult: async id => {
      if (id !== 'opaque') throw Object.assign(new Error('expired'), {code: 'RESULT_EXPIRED'});
      return {row, stat};
    },
    buildContentMatchInfo, normalizeSearchText, normalizeContentSearchOptions, BRIDGE_VERSION: 38, appendLog: async () => {},
    previewFiles: {readText: async () => {
      const call = ++reads, text = await fs.readFile(fullPath, 'utf8');
      if (call === 1) { firstStarted.resolve(); await firstRelease.promise; }
      return {text, truncated: false};
    }},
    pdfPreviewOperation: {invalidate: async () => {}}, documentResults: {invalidate: () => []}, pdfFormIndex: new Map(), loadPdfFormIndex: async () => {}, appendPdfIndexJournal: async () => {},
  };
  const functions = vm.runInNewContext([source.slice(cacheDeclaration.start, cacheDeclaration.end),
    ...declarations.map(node => source.slice(node.start, node.end)),
    '({read:searchablePreviewText,matches:previewMatches,invalidate:invalidateResultPath})'].join('\n'), context);
  return {...functions, row, stat, fullPath, firstStarted, firstRelease, reads: () => reads,
    replace: value => fs.writeFile(fullPath, value)};
}
