import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createDocumentPreview, BINARY_PREVIEW_MAX_BYTES} from '../netunim-orders/document-bridge/preview-content.mjs';
import {createPreviewFilePlatform} from '../netunim-orders/document-bridge/preview-file-platform.mjs';
import {createDocumentBridgeRoutes} from '../netunim-orders/document-bridge/http-routes.mjs';
import {createDocumentBridgeHttpHandler, documentBridgeErrorResponse} from '../netunim-orders/document-bridge/http-handler.mjs';
import {createDocumentBridgeClient} from '../shared/document-bridge-client.js';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'netunim-preview-http-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const fullPath = path.join(dir, 'דוח.pdf'), textPath = path.join(dir, 'עברית.txt');
  const bytes = Buffer.from([0, 1, 255, 65]); await fs.writeFile(fullPath, bytes); await fs.writeFile(textPath, 'שלום');
  const catalog = new Map();
  for (const [id, file, extension] of [['pdf-id', fullPath, 'pdf'], ['text-id', textPath, 'txt']]) {
    const stat = await fs.stat(file);
    catalog.set(id, {mode: 'everything', officeKind: '', structuredKind: '', metadata: {
      name: path.basename(file), path: dir, fullPath: file, extension, size: stat.size, isDirectory: false, modified: stat.mtime.toISOString(),
    }});
  }
  const preview = createDocumentPreview({resolve: async id => {
    const target = catalog.get(id);
    if (!target) throw Object.assign(new Error('opaque result expired'), {code: 'RESULT_EXPIRED'});
    return target;
  }, files: createPreviewFilePlatform(), indexedText: async () => null});
  const unused = async () => { throw new Error('unexpected unrelated command'); };
  const routes = createDocumentBridgeRoutes({
    service: {status: unused, warm: unused}, maintenance: {status: unused, start: unused, stop: unused},
    search: {selectFolder: unused, recent: unused, search: unused},
    preview: {...preview, matches: unused}, nativePreview: {open: unused, move: unused, hide: unused},
    files: {open: unused, reveal: unused, delete: unused}, shutdown: {prepare: unused, afterResponse: () => {}},
  });
  const origin = 'https://bargig-furniture.com';
  const handler = createDocumentBridgeHttpHandler({loadConfig: async () => ({allowedOrigins: [origin]}),
    readToken: async () => 'synthetic-pairing-token', routes, health: () => ({ok: true, version: 38}), appendLog: async () => {}});
  const server = http.createServer((req, res) => handler(req, res).catch(error => {
    res.writeHead(500, {'Content-Type': 'application/json'}); res.end(JSON.stringify(documentBridgeErrorResponse(error)));
  }));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = createDocumentBridgeClient({tokenStore: {get: () => 'synthetic-pairing-token', set: () => {}},
    fetchRequest: (url, options) => fetch(url.replace('http://127.0.0.1:8766', base), {...options, headers: {...options.headers, Origin: origin}}),
    timers: {setTimeout, clearTimeout}, createAbortController: () => new AbortController()});
  return {client, fullPath, bytes, base, origin};
}

test('actual files, preview policy, authenticated HTTP and canonical client preserve binary and Hebrew text', async t => {
  const f = await fixture(t);
  const metadata = await f.client.preview('pdf-id'); assert.equal(metadata.kind, 'binary'); assert.equal(metadata.name, 'דוח.pdf');
  const blob = await f.client.previewFile('pdf-id'); assert.equal(blob.type, 'application/pdf');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), f.bytes);
  const text = await f.client.preview('text-id'); assert.equal(text.kind, 'text'); assert.equal(text.text, 'שלום'); assert.equal(text.truncated, false);
});

test('growth after metadata returns classified oversized error through the real HTTP/client chain', async t => {
  const f = await fixture(t); assert.equal((await f.client.preview('pdf-id')).kind, 'binary');
  const handle = await fs.open(f.fullPath, 'r+'); await handle.truncate(BINARY_PREVIEW_MAX_BYTES + 1); await handle.close();
  await assert.rejects(f.client.previewFile('pdf-id'), error => error.code === 'PREVIEW_TOO_LARGE' && error.httpStatus === 503);
  assert.equal((await f.client.preview('text-id')).text, 'שלום', 'rejection does not poison later requests');
});

test('direct paths and missing authentication cannot bypass opaque preview resolution', async t => {
  const f = await fixture(t);
  await assert.rejects(f.client.previewFile(f.fullPath), error => error.code === 'RESULT_EXPIRED' && error.httpStatus === 410);
  const unauthenticated = await fetch(f.base + '/documents/preview-file', {method: 'POST', headers: {Origin: f.origin, 'Content-Type': 'application/json'}, body: JSON.stringify({id: 'pdf-id'})});
  assert.equal(unauthenticated.status, 401); assert.equal((await unauthenticated.json()).code, 'UNAUTHORIZED');
  assert.deepEqual(Buffer.from(await (await f.client.previewFile('pdf-id')).arrayBuffer()), f.bytes);
});
