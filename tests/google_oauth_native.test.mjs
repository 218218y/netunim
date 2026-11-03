import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createGoogleHttp} from '../netunim-orders/supabase/functions/_shared/google-http.js';
import {manualTimers} from './google_oauth_fixture.mjs';

for (const phase of ['headers', 'body']) test(`native Google transport ${phase} deadline closes the real HTTP connection`, async () => {
  const entered = Promise.withResolvers(), headers = Promise.withResolvers(), closed = Promise.withResolvers();
  const server = createServer((_request, response) => {
    response.on('close', closed.resolve);
    entered.resolve();
    if (phase === 'body') { response.writeHead(200, {'Content-Type':'application/json'}); response.write('{"access_token":'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const clock = manualTimers();
  const http = createGoogleHttp({...clock, fetchRequest:async (...args) => {
    const response = await fetch(...args); headers.resolve(); return response;
  }});
  try {
    const pending = http(`http://127.0.0.1:${server.address().port}/`, {});
    await entered.promise;
    if (phase === 'body') await headers.promise;
    clock.expire();
    await assert.rejects(pending, {kind:'timeout'});
    let guard;
    await Promise.race([closed.promise, new Promise((_, reject) => {
      guard = setTimeout(() => reject(Error('aborted HTTP connection did not close')), 2000);
    })]).finally(() => clearTimeout(guard));
    assert.equal(clock.timers.size, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
