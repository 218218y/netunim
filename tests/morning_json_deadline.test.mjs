import test from 'node:test';
import assert from 'node:assert/strict';
import {edgeFixture} from './edge_handler_fixture.mjs';
import {manualTimers, tick} from './google_oauth_fixture.mjs';

for (const kind of ['token','read','write']) test(`Morning ${kind}: stalled JSON body remains under the existing deadline`, async () => {
  const timers = manualTimers();
  let signal, stream;
  const f = await edgeFixture('morning-documents', {timers, env:{MORNING_CLIENT_ID:'test', MORNING_CLIENT_SECRET:'test'},
    fetch:async (url, init) => {
      if (kind !== 'token' && url.includes('/oauth/token')) return Response.json({access_token:'synthetic', expires_in:3600});
      signal = init.signal;
      stream = new ReadableStream({start(controller) {
        controller.enqueue(new TextEncoder().encode('{"partial":'));
        signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), {once:true});
      }});
      return new Response(stream, {headers:{'Content-Type':'application/json'}});
    }});
  const pending = kind === 'token' ? f.context.morningToken() : f.context.morningRequest('/documents', {method:kind === 'write' ? 'POST' : 'GET'}, false, false);
  // Attach rejection observation before firing the deadline.
  const result = pending.then(value => ({value}), error => ({error}));
  await tick();
  assert.equal(timers.timers.size, 1);
  timers.expire();
  const {error} = await result;
  assert.ok(error);
  if (kind === 'write') assert.equal(error.ambiguous, true);
  assert.equal(signal.aborted, true);
  assert.equal(timers.timers.size, 0);
  assert.equal(f.requests.length, kind === 'token' ? 1 : 2, 'no automatic retry after a stalled body');
});
