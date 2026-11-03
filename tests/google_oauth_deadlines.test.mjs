import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleHttp} from '../netunim-orders/supabase/functions/_shared/google-http.js';
import {oauthFixture, manualTimers, tick} from './google_oauth_fixture.mjs';

for (const name of ['google-drive-oauth', 'google-calendar-oauth']) {
  for (const phase of ['headers', 'body']) test(`${name}: ${phase} timeout aborts once and preserves the connection`, async () => {
    let signal, cancelled = false;
    const f = await oauthFixture(name, {fetch:async (_url, init) => {
      signal = init.signal;
      if (phase === 'headers') return new Promise(() => {});
      return new Response(new ReadableStream({start(controller) { controller.enqueue(new TextEncoder().encode('{"access_token":')); }, cancel() { cancelled = true; }}));
    }});
    const pending = f.invoke('token');
    await tick();
    assert.equal(f.clock.timers.size, 1);
    f.clock.expire();
    const response = await pending;
    assert.equal(response.status, 504);
    assert.equal((await response.json()).reason, 'timeout');
    assert.equal(signal.aborted, true);
    if (phase === 'body') assert.equal(cancelled, true);
    assert.equal(f.clock.timers.size, 0);
    assert.equal(f.requests.length, 1);
    assert.equal(f.writes.length, 0);
    assert.deepEqual(f.connection.value, f.old);
  });
  test(`${name}: explicit later refresh can succeed without automatic retry`, async () => {
    let failing = true;
    const f = await oauthFixture(name, {fetch:async () => {
      if (failing) throw new Error('network unavailable');
      return Response.json({access_token:'new-access', expires_in:3600});
    }});
    let response = await f.invoke('token');
    assert.equal(response.status, 502);
    assert.equal((await response.json()).reason, 'network');
    assert.equal(f.requests.length, 1);
    failing = false;
    response = await f.invoke('token');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).access_token, 'new-access');
    assert.equal(f.requests.length, 2);
    assert.equal(f.clock.timers.size, 0);
  });
  test(`${name}: account timeout never publishes a newly connected session`, {timeout:10000}, async () => {
    const accountEntered = Promise.withResolvers();
    const f = await oauthFixture(name, {fetch:async url => {
      if (url.endsWith('/token')) return Response.json({access_token:'new-access', refresh_token:'new-refresh', expires_in:3600});
      accountEntered.resolve();
      return new Promise(() => {});
    }});
    const pending = f.callback();
    // State hashing uses WebCrypto's worker pool. Inject expiry only once the
    // account request has actually started, regardless of hashing/scheduling.
    await accountEntered.promise;
    assert.equal(f.clock.timers.size, 1);
    f.clock.expire();
    const response = await pending;
    assert.equal(response.status, 303);
    assert.match(response.headers.get('Location'), /oauth=error/);
    assert.match(response.headers.get('Location'), /google_timeout/);
    assert.equal(f.writes.some(row => row.mode === 'upsert'), false);
    assert.deepEqual(f.connection.value, f.old);
    assert.equal(f.clock.timers.size, 0);
  });
  test(`${name}: revoke timeout permits local unlink but never claims confirmed revocation`, async () => {
    const f = await oauthFixture(name, {fetch:async () => new Promise(() => {})});
    const pending = f.invoke('disconnect');
    await tick(); f.clock.expire();
    const response = await pending;
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {ok:true, revocation:'unconfirmed'});
    assert.equal(f.connection.value, null);
    assert.equal(f.requests.length, 1);
    assert.equal(f.clock.timers.size, 0);
  });
}

test('Google HTTP errors stay distinct from network/protocol errors and always clear deadlines', async () => {
  for (const [response, expected] of [
    [Response.json({error:'invalid_grant'}, {status:400}), {kind:'http', code:'invalid_grant', status:400}],
    [new Response('provider outage', {status:503}), {kind:'http', status:503}],
    [new Response('invalid json'), {kind:'response'}],
    [Response.json(null), {kind:'response'}],
  ]) {
    const clock = manualTimers();
    const http = createGoogleHttp({...clock, fetchRequest:async () => response});
    await assert.rejects(http('https://google.test', {}), expected);
    assert.equal(clock.timers.size, 0);
    assert.equal(response.body.locked, false);
  }
});

test('Google response caps cancel oversized streamed bodies and late headers are disposed', async () => {
  let cancelled = false;
  const body = new ReadableStream({start(c) { c.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; }});
  const http = createGoogleHttp({fetchRequest:async () => new Response(body)});
  await assert.rejects(http('https://google.test', {}), {kind:'response', code:'google_response_too_large'});
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
  const clock = manualTimers();
  let release;
  const delayed = createGoogleHttp({...clock, fetchRequest:() => new Promise(resolve => { release = resolve; })});
  const pending = delayed('https://google.test', {});
  clock.expire();
  await assert.rejects(pending, {kind:'timeout'});
  let disposed = false;
  release(new Response(new ReadableStream({cancel() { disposed = true; }})));
  await tick();
  assert.equal(disposed, true);
  assert.equal(clock.timers.size, 0);
});
