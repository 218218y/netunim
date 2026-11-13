import test from 'node:test';
import assert from 'node:assert/strict';
import {GOOGLE_TEST_SCOPES, oauthFixture} from './google_oauth_fixture.mjs';

for (const name of ['google-drive-oauth', 'google-calendar-oauth']) {
  const credentials = {access_token:'new-access', refresh_token:'new-refresh', expires_in:3600, scope:GOOGLE_TEST_SCOPES};
  const account = name === 'google-drive-oauth' ? {user:{permissionId:'new-account'}} : {items:[{primary:true, id:'new-account'}]};

  test(`${name}: a consumed state authorizes exactly one concurrent callback`, async () => {
    let readers = 0, release;
    const bothRead = new Promise(resolve => { release = resolve; });
    const f = await oauthFixture(name, {fetch:async url => Response.json(url.endsWith('/token') ? credentials : account),
      beforeQuery:async (table, mode) => {
        if (table.endsWith('_states') && mode === 'select') {
          if (++readers === 2) release();
          await bothRead;
        }
      }});
    const replies = await Promise.all([f.callback(), f.callback()]);
    assert.deepEqual(replies.map(r => r.status).sort(), [303, 400]);
    assert.equal(f.requests.filter(([url]) => url.endsWith('/token')).length, 1);
    assert.equal(f.writes.filter(row => row.mode === 'upsert').length, 1);
    assert.equal((await f.callback()).status, 400, 'consumed state cannot be replayed');
  });

  test(`${name}: failed state consumption cannot contact Google or replace a connection`, async () => {
    const f = await oauthFixture(name, {dbError:(table, mode) => table.endsWith('_states') && mode === 'delete'});
    assert.equal((await f.callback()).status, 500);
    assert.equal(f.requests.length, 0);
    assert.deepEqual(f.connection.value, f.old);
    assert.ok(f.state.value, 'failed delete retains the state');
  });

  test(`${name}: an unrotated late refresh cannot publish a disconnected or replaced credential`, async () => {
    for (const replacement of [null, {refresh_token:'replacement-refresh', google_account_id:'replacement-account'}]) {
      let f;
      f = await oauthFixture(name, {fetch:async () => {
        f.connection.value = replacement;
        return Response.json({access_token:'late-access', expires_in:3600, scope:GOOGLE_TEST_SCOPES});
      }});
      const response = await f.invoke('token');
      assert.equal(response.status, 409);
      assert.equal((await response.json()).reason, 'connection_changed');
      assert.deepEqual(f.connection.value, replacement);
      assert.equal(f.writes.length, 0);
    }
  });

  test(`${name}: failed current-connection verification cannot publish a token`, async () => {
    let reads = 0;
    const f = await oauthFixture(name, {fetch:async () => Response.json({access_token:'new-access', expires_in:3600, scope:GOOGLE_TEST_SCOPES}),
      dbError:(table, mode) => table.endsWith('_connections') && mode === 'select' && ++reads === 2});
    const response = await f.invoke('token');
    assert.equal(response.status, 500);
    assert.equal((await response.json()).access_token, undefined);
    assert.deepEqual(f.connection.value, f.old);
  });

  test(`${name}: disconnect finishing after replacement cannot delete the replacement`, async () => {
    for (const result of ['success', 'timeout']) {
      let release;
      const f = await oauthFixture(name, {fetch:() => new Promise(resolve => { release = resolve; })});
      const pending = f.invoke('disconnect');
      await f.waitForRequests();
      const replacement = {refresh_token:'replacement-refresh', google_account_id:'replacement-account'};
      f.connection.value = {...replacement};
      if (result === 'timeout') f.clock.expire(); else release(new Response(''));
      const response = await pending;
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
      assert.deepEqual(f.connection.value, replacement);
      assert.equal(f.clock.timers.size, 0);
    }
  });

  test(`${name}: disconnect of an absent connection still invalidates pending intent without calling Google`, async () => {
    const f = await oauthFixture(name);
    f.connection.value = null;
    assert.deepEqual(await (await f.invoke('disconnect')).json(), {ok:true, revocation:'not_needed'});
    assert.equal(f.requests.length, 0);
    assert.equal(f.intent.value, null);
    assert.equal(f.writes.length, 1);
  });
}
