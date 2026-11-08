import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGoogleCredentialVault, GoogleCredentialError} from '../netunim-orders/supabase/functions/_shared/google-credentials.js';
import {GOOGLE_TEST_ENV, GOOGLE_TEST_SCOPES, oauthFixture} from './google_oauth_fixture.mjs';

const project = 'https://example.supabase.co';
const context = {service:'calendar', ownerId:'test-owner'};
const keyringJson = JSON.stringify({test:Buffer.alloc(32, 7).toString('base64'), next:Buffer.alloc(32, 9).toString('base64')});
const vault = (extra = {}) => createGoogleCredentialVault({keyringJson, activeKeyId:'test', audience:project, ...extra});
test('AES-GCM binds credentials to project, owner, service, key ID and authenticated ciphertext', async () => {
  const v = vault(), sealed = await v.seal('synthetic-refresh', context);
  assert.match(sealed, /^ngc1\.test\./);
  assert.equal(await v.open(sealed, context), 'synthetic-refresh');
  assert.notEqual(await v.seal('synthetic-refresh', context), sealed, 'fresh random IV per encryption');
  for (const badContext of [{...context, ownerId:'another-owner'}, {...context, service:'drive'}, {}]) {
    await assert.rejects(v.open(sealed, badContext), GoogleCredentialError);
  }
  await assert.rejects(vault({audience:'https://another.supabase.co'}).open(sealed, context), GoogleCredentialError);
  const parts = sealed.split('.');
  for (const bad of [sealed.slice(0, -2), sealed.replace('.test.', '.next.'),
    [...parts.slice(0, 3), (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1)].join('.'),
    'ngc2.bad-envelope', 'ngc1.test.invalid.invalid', 'plaintext-refresh']) {
    await assert.rejects(v.open(bad, context), GoogleCredentialError);
  }
});
test('key rotation reads retained keys and requests rewrapping; invalid or absent configuration fails closed', async () => {
  const old = await vault().seal('synthetic-refresh', context), rotated = vault({activeKeyId:'next'});
  assert.equal(await rotated.open(old, context), 'synthetic-refresh');
  assert.equal(rotated.needsRewrap(old), true);
  assert.equal(rotated.needsRewrap(await rotated.seal('synthetic-refresh', context)), false);
  for (const config of [{keyringJson:''}, {activeKeyId:'absent'}, {keyringJson:'[]'},
    {keyringJson:JSON.stringify({test:'short'})}, {audience:''}]) assert.throws(() => vault(config), GoogleCredentialError);
  const compatibility = vault({allowLegacy:true});
  assert.equal(await compatibility.open('legacy-refresh', context), 'legacy-refresh');
  await assert.rejects(compatibility.open('ngc1.corrupted', context), GoogleCredentialError);
});
test('server-only PKCE verifiers satisfy S256 and change with state, service, owner, project and redirect', async () => {
  const v = vault(), state = v.newState(), redirect = project + '/functions/v1/google-calendar-oauth/callback';
  const proof = await v.proof(state, context, redirect);
  assert.match(proof.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(proof.challenge, createHash('sha256').update(proof.verifier).digest('base64url'));
  assert.deepEqual(await v.proof(state, context, redirect), proof);
  for (const changed of [await v.proof(v.newState(), context, redirect),
    await v.proof(state, {...context, service:'drive'}, redirect), await v.proof(state, {...context, ownerId:'other'}, redirect),
    await vault({audience:'https://another.supabase.co'}).proof(state, context, redirect), await v.proof(state, context, redirect + '/other')]) {
    assert.notEqual(changed.verifier, proof.verifier);
  }
  await assert.rejects(v.proof('legacy-state', context, redirect), GoogleCredentialError);
});

for (const name of ['google-drive-oauth', 'google-calendar-oauth']) {
  const credentials = {access_token:'synthetic-access', refresh_token:'synthetic-refresh', expires_in:3600, scope:GOOGLE_TEST_SCOPES};
  const account = name.includes('drive') ? {user:{permissionId:'verified-account'}} : {items:[{primary:true, id:'verified-account'}]};
  test(`${name}: the actual handler sends the matching server-only PKCE proof and stores ciphertext`, async () => {
    let authorization;
    const f = await oauthFixture(name, {fetch:async (url, init) => {
      if (!url.endsWith('/token')) return Response.json(account);
      const params = new URLSearchParams(init.body);
      const verifier = params.get('code_verifier');
      assert.equal(createHash('sha256').update(verifier).digest('base64url'), authorization.searchParams.get('code_challenge'));
      assert.equal(params.get('grant_type'), 'authorization_code');
      assert.equal(params.get('redirect_uri'), project + `/functions/v1/${name}/callback`);
      return Response.json(credentials);
    }});
    const start = await f.invoke('start');
    assert.equal(start.status, 200);
    authorization = new URL((await start.json()).authorize_url);
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorization.searchParams.has('code_verifier'), false);
    assert.equal(f.state.value.code_verifier, undefined);
    const response = await f.callback(authorization.searchParams.get('state'));
    assert.match(response.headers.get('Location'), /oauth=connected/);
    assert.match(f.connection.value.refresh_token, /^ngc1\./);
    assert.equal(await f.vault.open(f.connection.value.refresh_token, f.credentialContext), credentials.refresh_token);
    assert.equal((await f.callback(authorization.searchParams.get('state'))).status, 400);
  });
  test(`${name}: foreign/preview origins are denied before any external or database action`, async () => {
    const f = await oauthFixture(name);
    for (const origin of ['https://evil.example', 'https://preview.bargig-orders.pages.dev', 'http://localhost:3000', 'null']) {
      for (const action of ['start', 'token', 'disconnect']) {
        const r = await f.handler(new Request(project, {method:'POST', headers:{Origin:origin, Authorization:'Bearer test'}, body:JSON.stringify({action})}));
        assert.equal(r.status, 403);
        assert.equal(r.headers.has('Access-Control-Allow-Origin'), false);
      }
      assert.equal((await f.handler(new Request(project, {method:'OPTIONS', headers:{Origin:origin}}))).status, 403);
    }
    assert.equal(f.requests.length, 0);
    assert.equal(f.writes.length, 0);
    assert.deepEqual(f.connection.value, f.old);
    const allowed = await f.handler(new Request(project, {method:'OPTIONS', headers:{Origin:'https://bargig-furniture.com'}}));
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://bargig-furniture.com');
    assert.equal(allowed.headers.get('Vary'), 'Origin');
  });
  test(`${name}: malformed, wrong-owner and missing-key credentials never reach Google`, async () => {
    for (const kind of ['corrupted', 'wrong-owner', 'missing-key', 'legacy']) {
      const f = await oauthFixture(name, {env:kind === 'missing-key' ? {GOOGLE_OAUTH_TOKEN_KEYS:''} : {}});
      if (kind === 'corrupted') f.connection.value = {...f.old, refresh_token:'ngc1.corrupted'};
      if (kind === 'wrong-owner') f.connection.value = {...f.old, refresh_token:await f.vault.seal('stolen', {...f.credentialContext, ownerId:'another-owner'})};
      if (kind === 'legacy') f.connection.value = {...f.old, refresh_token:'plaintext-refresh'};
      const before = structuredClone(f.connection.value);
      assert.equal((await f.invoke('token')).status, 503);
      assert.equal(f.requests.length, 0);
      assert.deepEqual(f.connection.value, before);
      const unlinked = await f.invoke('disconnect');
      assert.deepEqual(await unlinked.json(), {ok:true, revocation:'unconfirmed'});
      assert.equal(f.connection.value, null);
      assert.equal(f.requests.length, 0);
    }
  });
  for (const migration of ['legacy', 'old-key']) test(`${name}: ${migration} migration uses a confirmed compare-and-set before publishing access`, async () => {
    for (const replace of [false, true]) {
      const f = await oauthFixture(name, {env:migration === 'legacy' ? {GOOGLE_OAUTH_ALLOW_LEGACY_TOKENS:'true'} :
        {GOOGLE_OAUTH_TOKEN_KEYS:keyringJson, GOOGLE_OAUTH_TOKEN_ACTIVE_KEY:'next'}, fetch:async (_url, init) => {
        assert.equal(new URLSearchParams(init.body).get('refresh_token'), 'old-refresh');
        if (replace) f.connection.value = {...f.old, refresh_token:'replacement'};
        return Response.json({...credentials, refresh_token:undefined});
      }});
      if (migration === 'legacy') f.connection.value = {...f.old, refresh_token:'old-refresh'};
      const response = await f.invoke('token');
      assert.equal(response.status, replace ? 409 : 200);
      if (replace) assert.equal(f.connection.value.refresh_token, 'replacement');
      else {
        const reader = migration === 'legacy' ? f.vault : vault({activeKeyId:'next'});
        assert.equal(await reader.open(f.connection.value.refresh_token, f.credentialContext), 'old-refresh');
        assert.equal(reader.needsRewrap(f.connection.value.refresh_token), false);
      }
    }
  });
}
