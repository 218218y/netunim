import test from 'node:test';
import assert from 'node:assert/strict';
import {edgeFixture} from './edge_handler_fixture.mjs';
import {manualTimers, tick} from './google_oauth_fixture.mjs';

const id = '00000000-0000-4000-8000-000000000002';
test('Morning PDF keeps its deadline through the body and releases an aborted reader', async () => {
  const timers = manualTimers();
  let signal, stream;
  const f = await edgeFixture('morning-documents', {timers, fetch:async (_url, init) => {
    signal = init.signal;
    stream = new ReadableStream({start(controller) {
      controller.enqueue(new TextEncoder().encode('%PDF-1.4\n'));
      signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), {once:true});
    }});
    return new Response(stream);
  }});
  f.context.morningRequest = async () => ({he:'https://pdf.example.test/synthetic'});
  const pending = f.context.getDocumentPdf({document_id:id});
  await tick();
  assert.equal(timers.timers.size, 1, 'the deadline must remain active after headers');
  timers.expire();
  const response = await pending;
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, 'morning_document_pdf_failed');
  assert.equal(signal.aborted, true);
  assert.equal(stream.locked, false);
  assert.equal(timers.timers.size, 0);
});

test('Morning PDF completes valid reads and cancels declared/streamed excess without waiting for the sender', async () => {
  for (const kind of ['valid','declared','streamed']) {
    const timers = manualTimers();
    let cancelled = false;
    const stream = new ReadableStream({start(controller) {
      if (kind === 'valid') { controller.enqueue(new TextEncoder().encode('%PDF-1.4\nsynthetic')); controller.close(); }
      if (kind === 'streamed') controller.enqueue(new Uint8Array(20 * 1024 * 1024 + 1));
    }, cancel() { cancelled = true; return new Promise(() => {}); }});
    const f = await edgeFixture('morning-documents', {timers, fetch:async () => new Response(stream, {
      headers:kind === 'declared' ? {'Content-Length':String(20 * 1024 * 1024 + 1)} : {},
    })});
    f.context.morningRequest = async () => ({he:'https://pdf.example.test/synthetic'});
    const response = await f.context.getDocumentPdf({document_id:id});
    assert.equal(response.status, kind === 'valid' ? 200 : 413);
    assert.equal(timers.timers.size, 0);
    assert.equal(stream.locked, false);
    if (kind !== 'valid') assert.equal(cancelled, true);
    else { assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.match(await response.text(), /^%PDF-/); }
  }
});
