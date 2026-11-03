import test from 'node:test';
import assert from 'node:assert/strict';
import {GOOGLE_TEST_SCOPES, oauthFixture} from './google_oauth_fixture.mjs';

const credentials = {access_token:'new-access', refresh_token:'new-refresh', expires_in:3600, token_type:'Bearer', scope:GOOGLE_TEST_SCOPES};
for (const name of ['google-drive-oauth', 'google-calendar-oauth']) {
  test(`${name}: incomplete or malformed HTTP 200 token replies never become success`, async () => {
    for (const body of [{}, {error:'invalid_grant'}, {...credentials, access_token:''}, {...credentials, access_token:[]},
      {...credentials, expires_in:0}, {...credentials, expires_in:'3600'}, {...credentials, expires_in:null},
      {...credentials, refresh_token:[]}, {...credentials, scope:{}}, {...credentials, token_type:'MAC'}]) {
      const f = await oauthFixture(name, {fetch:async () => Response.json(body)});
      const response = await f.invoke('token');
      assert.equal(response.status, 502, JSON.stringify(body));
      assert.equal(f.writes.length, 0);
      assert.deepEqual(f.connection.value, f.old);
    }
  });
  test(`${name}: token rotation is successful only after storage confirms it`, async () => {
    const f = await oauthFixture(name, {fetch:async () => Response.json(credentials), dbError:(_table, mode) => mode === 'update'});
    const response = await f.invoke('token');
    assert.equal(response.status, 500);
    assert.deepEqual(f.connection.value, f.old);
    assert.equal((await response.json()).access_token, undefined);
  });
  test(`${name}: invalid grant preserves reconnect diagnostics and observes deletion errors`, async () => {
    for (const broken of [false, true]) {
      const f = await oauthFixture(name, {fetch:async () => Response.json({error:'invalid_grant'}, {status:400}),
        dbError:(_table, mode) => broken && mode === 'delete'});
      const response = await f.invoke('token');
      assert.equal(response.status, broken ? 500 : 409);
      if (!broken) assert.equal((await response.json()).reason, 'google_invalid_grant');
    }
  });
  test(`${name}: an old refresh cannot overwrite or delete replacement credentials`, async () => {
    for (const invalid of [false, true]) {
      let f;
      const replacement = {...credentials, google_account_id:'replacement-account', refresh_token:'replacement-refresh'};
      f = await oauthFixture(name, {fetch:async () => {
        f.connection.value = {...replacement};
        return invalid ? Response.json({error:'invalid_grant'}, {status:400}) : Response.json(credentials);
      }});
      const response = await f.invoke('token');
      assert.equal(response.status, 409);
      assert.equal((await response.json()).reason, 'connection_changed');
      assert.deepEqual(f.connection.value, replacement);
    }
  });
  test(`${name}: callback replaces verified credentials without revoking the new project grant`, async () => {
    let revoked = false;
    const f = await oauthFixture(name, {fetch:async url => {
      if (url.endsWith('/token')) return Response.json(credentials);
      if (url.endsWith('/revoke')) { revoked = true; return new Response(''); }
      return Response.json(name === 'google-drive-oauth' ? {user:{permissionId:'new-account'}} : {items:[{primary:true, id:'new-account'}]});
    }});
    const response = await f.callback();
    assert.equal(response.status, 303);
    assert.match(response.headers.get('Location'), /oauth=connected/);
    assert.equal(f.connection.value.google_account_id, 'new-account');
    assert.equal(f.connection.value.refresh_token, 'new-refresh');
    assert.equal(revoked, false, 'Google revocation invalidates project-wide grants, including replacement credentials');
  });
  test(`${name}: malformed account identities and failed upserts preserve the old connection`, async () => {
    for (const broken of ['identity', 'storage']) {
      const f = await oauthFixture(name, {fetch:async url => url.endsWith('/token') ? Response.json(credentials) :
        Response.json(name === 'google-drive-oauth' ? {user:{permissionId:[]}} : {items:[{primary:true, id:{}}]}),
      dbError:(_table, mode) => broken === 'storage' && mode === 'upsert'});
      if (broken === 'storage') f.context.googleAccountId = async () => 'verified-account';
      const response = await f.callback();
      assert.match(response.headers.get('Location'), /oauth=error/);
      assert.deepEqual(f.connection.value, f.old);
      assert.equal(f.requests.some(([url]) => url.endsWith('/revoke')), false);
    }
  });
}
