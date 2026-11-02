import test from 'node:test';
import assert from 'node:assert/strict';
import {edgeFixture} from './edge_handler_fixture.mjs';
import {readJsonBodyBounded} from '../netunim-orders/supabase/functions/_shared/http-input.js';

const names = ['morning-documents', 'google-drive-oauth', 'google-calendar-oauth'];
const request = (body, headers = {'Content-Type':'application/json'}) => new Request('https://example.supabase.co/functions/v1/test', {
  method:'POST', headers:{Authorization:'Bearer test', ...headers}, body, duplex:'half',
});
for (const name of names) {
  test(`${name}: JSON is byte bounded across chunks even without an honest length`, async () => {
    for (const length of [null, '1', '9999999']) {
      const f = await edgeFixture(name);
      let cancelled = false;
      const body = new ReadableStream({start(controller) {
        controller.enqueue(new TextEncoder().encode('{"action":"test","padding":"'));
        for (let i = 0; i < 18; i++) controller.enqueue(new Uint8Array(16384).fill(65));
        // Intentionally leave open: rejection must cancel rather than wait for EOF.
      }, cancel() { cancelled = true; }});
      const headers = {'Content-Type':'application/json'};
      if (length !== null) headers['Content-Length'] = length;
      const response = await f.handler(request(body, headers));
      assert.equal(response.status, 413);
      assert.equal((await response.json()).code, 'request_too_large');
      assert.equal(cancelled, true);
      assert.equal(body.locked, false);
      assert.equal(f.operations.length + f.requests.length, 0);
    }
  });
  test(`${name}: malformed JSON, non-object input and media types fail before dispatch`, async () => {
    const f = await edgeFixture(name);
    for (const body of ['{', '', 'null', '[]', '"status"', '42', new Uint8Array([0xff])]) {
      const response = await f.handler(request(body));
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, 'invalid_json_body');
    }
    for (const headers of [{}, {'Content-Type':'text/plain'}, {'Content-Type':'application/jsonp'}]) {
      const response = await f.handler(request('{}', headers));
      assert.equal(response.status, 415);
    }
    assert.equal(f.operations.length + f.requests.length, 0);
  });
  test(`${name}: valid UTF-8 split across chunks still reaches the existing dispatcher`, async () => {
    const f = await edgeFixture(name);
    const bytes = new TextEncoder().encode('{"action":"unknown","name":"שלום"}');
    const body = new ReadableStream({start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    }});
    const response = await f.handler(request(body, {'Content-Type':'Application/JSON; charset=utf-8'}));
    assert.equal(response.status, 400);
    assert.match((await response.json()).code, /unknown_action$/);
    assert.equal(body.locked, false);
  });
  test(`${name}: authentication remains before any input read`, async () => {
    const f = await edgeFixture(name, {user:null});
    const req = {method:'POST', url:'https://example.supabase.co/test', headers:new Headers(),
      get body() { assert.fail('anonymous body read'); }};
    assert.equal((await f.handler(req)).status, 401);
  });
}

test('the limit counts encoded bytes exactly and releases failed readers', async () => {
  const text = '{"name":"שלום"}', bytes = new TextEncoder().encode(text);
  assert.deepEqual(await readJsonBodyBounded(request(text), bytes.length), {name:'שלום'});
  await assert.rejects(readJsonBodyBounded(request(text), bytes.length - 1), {status:413});
  const body = new ReadableStream({pull(controller) { controller.error(new Error('broken upload')); }});
  await assert.rejects(readJsonBodyBounded(request(body), 100), {status:400, code:'invalid_json_body'});
  assert.equal(body.locked, false);
});

test('a slow cancellation cannot hold an oversized request open', async () => {
  const body = new ReadableStream({start(controller) { controller.enqueue(new Uint8Array(20)); },
    cancel() { return new Promise(() => {}); }});
  await assert.rejects(readJsonBodyBounded(request(body), 10), {status:413});
  assert.equal(body.locked, false);
});
