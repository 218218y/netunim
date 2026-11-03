import test from 'node:test';
import assert from 'node:assert/strict';
import {oauthFixture, GOOGLE_TEST_SCOPES} from './google_oauth_fixture.mjs';

for (const name of ['google-drive-oauth', 'google-calendar-oauth']) {
  const credentials = {access_token:'new-access', refresh_token:'new-refresh', expires_in:3600, scope:GOOGLE_TEST_SCOPES};
  const account = name.includes('drive') ? {user:{permissionId:'new-account'}} : {items:[{primary:true, id:'new-account'}]};
  for (const connected of [false, true]) test(`${name}: disconnect fences an admitted callback (connected=${connected})`, async () => {
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    const f = await oauthFixture(name, {fetch:async url => {
      if (url.endsWith('/token')) return Response.json(credentials);
      if (url.endsWith('/revoke')) return new Response('');
      entered.resolve(); await release.promise; return Response.json(account);
    }});
    if (!connected) f.connection.value = null;
    const pending = f.callback();
    await entered.promise;
    assert.equal((await f.invoke('disconnect')).status, 200);
    release.resolve();
    const result = await pending;
    assert.match(result.headers.get('Location'), /oauth=error/);
    assert.equal(f.connection.value, null);
    assert.equal((await f.callback()).status, 400);
  });
  test(`${name}: newer start fences an older callback before and after new account publication`, async () => {
    for (const publishNew of [false, true]) {
      const entered = Promise.withResolvers(), release = Promise.withResolvers();
      let accounts = 0;
      const f = await oauthFixture(name, {fetch:async url => {
        if (url.endsWith('/token')) return Response.json({...credentials, refresh_token:'refresh-'+accounts});
        if (++accounts === 1) { entered.resolve(); await release.promise; }
        return Response.json(account);
      }});
      const pending = f.callback();
      await entered.promise;
      const start = await (await f.invoke('start')).json();
      assert.ok(start.authorize_url);
      if (publishNew) assert.match((await f.callback(new URL(start.authorize_url).searchParams.get('state'))).headers.get('Location'), /oauth=connected/);
      const before = structuredClone(f.connection.value);
      release.resolve();
      assert.match((await pending).headers.get('Location'), /oauth=error/);
      assert.deepEqual(f.connection.value, before);
    }
  });
  test(`${name}: publication failure preserves the existing connection and consumes the state`, async () => {
    const f = await oauthFixture(name, {fetch:async url => Response.json(url.endsWith('/token') ? credentials : account),
      dbError:(_table, mode) => mode === 'upsert'});
    assert.match((await f.callback()).headers.get('Location'), /oauth=error/);
    assert.deepEqual(f.connection.value, f.old);
    assert.equal((await f.callback()).status, 400);
  });
  for (const phase of ['callback', 'token']) test(`${name}: ${phase} requires actual scopes including absent and reduced replies`, async () => {
    const partial = name.includes('drive') ? 'https://www.googleapis.com/auth/drive.file' : 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
    for (const scope of [undefined, partial]) {
      const f = await oauthFixture(name, {fetch:async url => Response.json(url.endsWith('/token') ? {...credentials, scope} : account)});
      const response = phase === 'callback' ? await f.callback() : await f.invoke('token');
      if (phase === 'callback') assert.match(response.headers.get('Location'), /oauth=error/);
      else { assert.equal(response.status, 409); assert.equal((await response.json()).access_token, undefined); }
      assert.deepEqual(f.connection.value, f.old);
      assert.equal(f.requests.filter(([url]) => !url.endsWith('/token')).length, 0);
    }
  });
}
