import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentPreview, decodePreviewText, trimPreviewText, BINARY_PREVIEW_MAX_BYTES} from '../netunim-orders/document-bridge/preview-content.mjs';
import {officePreviewKind, structuredPreviewKind} from '../netunim-orders/document-bridge/lib.mjs';

function fixture({extension = 'pdf', mode = 'everything', size = 3, isDirectory = false, indexed = null} = {}) {
  const calls = [];
  const metadata = {name: `דוח.${extension}`, path: 'C:\\synthetic', fullPath: `C:\\synthetic\\דוח.${extension}`, extension, size, isDirectory, modified: '2026-10-12T00:00:00.000Z'};
  const ports = {resolve: async id => { calls.push(['resolve', id]); return {mode, metadata, officeKind: officePreviewKind(extension), structuredKind: structuredPreviewKind(extension)}; },
    files: {readText: async fullPath => { calls.push(['text', fullPath]); return {text: 'direct', truncated: false}; }, readBinary: async (fullPath, limit) => { calls.push(['binary', fullPath, limit]); return new Uint8Array([1, 2, 3]); }},
    indexedText: async fullPath => { calls.push(['indexed', fullPath]); return indexed; }};
  return {preview: createDocumentPreview(ports), calls, metadata, ports};
}

test('folder and supported PDF/image metadata do not read file bytes', async () => {
  for (const extension of ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']) {
    const f = fixture({extension}); const result = await f.preview.document('opaque');
    assert.equal(result.kind, 'binary'); assert.equal(result.source, 'file');
    assert.equal(result.name, f.metadata.name); assert.deepEqual(f.calls, [['resolve', 'opaque']]);
  }
  const folder = fixture({isDirectory: true}); assert.equal((await folder.preview.document('folder')).kind, 'folder');
  assert.deepEqual(folder.calls, [['resolve', 'folder']]);
});

test('Office filename previews remain native and content previews use existing structured kinds', async () => {
  for (const extension of ['docx', 'docm', 'dotx', 'dotm', 'xls', 'xlsx', 'xlsm', 'xlsb', 'xlt', 'xltx', 'xltm']) {
    const filename = fixture({extension}); const native = await filename.preview.document('opaque');
    assert.equal(native.kind, 'native'); assert.equal(native.source, 'windows-preview-handler'); assert.equal(filename.calls.length, 1);
    const content = fixture({extension, mode: 'content'}); const structured = await content.preview.document('opaque');
    assert.equal(structured.kind, 'structured'); assert.equal(structured.documentKind, structuredPreviewKind(extension)); assert.equal(content.calls.length, 1);
    assert.equal((await content.preview.file('opaque')).buffer.byteLength, 3);
    assert.deepEqual(content.calls.at(-1), ['binary', content.metadata.fullPath, BINARY_PREVIEW_MAX_BYTES]);
  }
});

test('nonstructured Office content falls back to indexed text then native preview', async () => {
  const f = fixture({extension: 'pptx', mode: 'content', indexed: {text: 'slides', truncated: true}});
  assert.equal((await f.preview.document('opaque')).source, 'office-text-fallback');
  const noText = fixture({extension: 'pptx', mode: 'content'});
  assert.equal((await noText.preview.document('opaque')).kind, 'native'); assert.equal(noText.calls.length, 2);
});

test('text formats read directly; other formats retain indexed or unavailable outcomes', async () => {
  const text = fixture({extension: 'txt'}); const result = await text.preview.document('opaque');
  assert.equal(result.text, 'direct'); assert.equal(result.source, 'file');
  assert.deepEqual(text.calls, [['resolve', 'opaque'], ['text', text.metadata.fullPath]]);
  const indexed = fixture({extension: 'custom', indexed: {text: 'indexed', truncated: false}});
  assert.equal((await indexed.preview.document('opaque')).source, 'everything-content');
  assert.equal((await fixture({extension: 'custom'}).preview.document('opaque')).reason, 'no-preview-handler');
  assert.equal((await fixture({size: BINARY_PREVIEW_MAX_BYTES + 1}).preview.document('opaque')).reason, 'too-large');
});

test('binary reads accept only opaque resolved supported regular files with the byte budget', async () => {
  const f = fixture(); const result = await f.preview.file('opaque-only');
  assert.deepEqual(result, {buffer: new Uint8Array([1, 2, 3]), mime: 'application/pdf', name: f.metadata.name});
  assert.deepEqual(f.calls, [['resolve', 'opaque-only'], ['binary', f.metadata.fullPath, BINARY_PREVIEW_MAX_BYTES]]);
  for (const [options, code] of [[{isDirectory: true}, 'PREVIEW_NOT_FILE'], [{extension: 'exe'}, 'PREVIEW_UNSUPPORTED'], [{size: BINARY_PREVIEW_MAX_BYTES + 1}, 'PREVIEW_TOO_LARGE']]) {
    const rejected = fixture(options); await assert.rejects(rejected.preview.file('opaque'), {code});
    assert.deepEqual(rejected.calls, [['resolve', 'opaque']]);
  }
});

test('resolution and file failures retain their code and never fall back to indexed content', async () => {
  const f = fixture(); const error = Object.assign(new Error('expired'), {code: 'RESULT_EXPIRED'});
  const resolution = createDocumentPreview({...f.ports, resolve: async () => { throw error; }});
  await assert.rejects(resolution.file('unknown'), error); await assert.rejects(resolution.document('unknown'), error);
  const failing = createDocumentPreview({...f.ports, files: {...f.ports.files, readBinary: async () => { throw Object.assign(new Error('growth'), {code: 'PREVIEW_TOO_LARGE'}); }}});
  await assert.rejects(failing.file('opaque'), {code: 'PREVIEW_TOO_LARGE'}); assert.equal(f.calls.length, 1);
});

test('text decoding preserves UTF-8/UTF-16 BOMs, Hebrew Windows-1255 and null/character limits', () => {
  assert.equal(decodePreviewText(Buffer.from('עברית', 'utf8')), 'עברית');
  assert.equal(decodePreviewText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('עברית')])), 'עברית');
  assert.equal(decodePreviewText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('עברית', 'utf16le')])), 'עברית');
  const be = Buffer.from('עברית', 'utf16le'); be.swap16();
  assert.equal(decodePreviewText(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), 'עברית');
  assert.equal(decodePreviewText(new Uint8Array([0xf9, 0xec, 0xe5, 0xed])), 'שלום');
  assert.deepEqual(trimPreviewText('a\u0000b'), {text: 'ab', truncated: false});
  const trimmed = trimPreviewText('a'.repeat(600001)); assert.equal(trimmed.text.length, 600000); assert.equal(trimmed.truncated, true);
});
