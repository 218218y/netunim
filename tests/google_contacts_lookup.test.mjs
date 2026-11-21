import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTACTS_TEST_SCOPES, oauthFixture} from './google_oauth_fixture.mjs';

const env = {GOOGLE_CONTACTS_CLIENT_ID:'fixture.apps.googleusercontent.com', GOOGLE_CONTACTS_CLIENT_SECRET:'fixture-secret'};
const access = {access_token:'access', expires_in:3600, scope:CONTACTS_TEST_SCOPES};
const person = (displayName, ...emails) => ({person:{names:[{displayName}], emailAddresses:emails.map(value => ({value}))}});
const fixture = options => oauthFixture('google-contacts-oauth', {env, ...options});

test('contacts OAuth verifies consent and account before replacing the grant', async () => {
  let granted = CONTACTS_TEST_SCOPES.split(' ')[0];
  const f = await fixture({fetch:async url => url.endsWith('/token')
    ? Response.json({...access, scope:granted, refresh_token:'new-refresh'})
    : Response.json({email:'account@example.test', email_verified:true})});
  assert.equal((await f.callback()).status, 400);
  assert.equal((await f.callback()).status, 400);
  assert.deepEqual(f.connection.value, f.old);
  const start = await (await f.invoke('start')).json();
  const consent = new URL(start.authorize_url);
  assert.equal(consent.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(consent.searchParams.get('scope'), `openid email ${CONTACTS_TEST_SCOPES}`);
  granted = CONTACTS_TEST_SCOPES;
  assert.equal((await f.callback(consent.searchParams.get('state'))).status, 200);
  const receipt = await (await f.invoke('status')).json();
  assert.equal(receipt.account, 'account@example.test');
  assert.notEqual(receipt.grant, f.old.grant_id);
  assert.deepEqual(Object.keys(receipt).sort(), ['account', 'grant', 'reconnect']);
  assert.equal((await f.invoke('disconnect')).status, 200);
  assert.equal(f.connection.value, null);
  assert.ok(f.requests.every(([url]) => !url.includes('/revoke')));
});

test('People lookups warm both sources and return minimized, deduplicated addresses', async () => {
  const f = await fixture({fetch:async url => {
    if (url.endsWith('/token')) return Response.json(access);
    const {searchParams, pathname} = new URL(url);
    assert.equal(searchParams.get('readMask'), 'names,emailAddresses');
    if (!searchParams.get('query')) return Response.json({});
    assert.equal(searchParams.get('query'), 'customer@example.test');
    const results = pathname.includes('otherContacts')
      ? [person('Other', 'Customer@example.test', 'other@example.test')]
      : [person('Contact', 'wrong', 'alt@example.test', 'customer@example.test')];
    return Response.json({results});
  }});
  const {grant_id:grant} = f.old;
  assert.deepEqual((await (await f.invoke('prepare', {grant})).json()).results, []);
  const response = await f.invoke('search', {query:'customer@example.test', grant});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {grant, missing:[], results:[
    {name:'Contact', email:'customer@example.test', sources:['contacts', 'other']},
    {name:'Contact', email:'alt@example.test', sources:['contacts']},
    {name:'Other', email:'other@example.test', sources:['other']},
  ]});
});

test('contacts requests report partial failure and fence an in-flight search after unlink', async () => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let hold = false;
  const f = await fixture({fetch:async url => {
    if (url.endsWith('/token')) return Response.json(access);
    if (url.includes('otherContacts')) return Response.json({error:{}}, {status:503});
    if (hold) { entered.resolve(); await release.promise; }
    return Response.json({results:[person('Contact', 'customer@example.test')]});
  }});
  const fields = {query:'customer', grant:f.old.grant_id};
  assert.deepEqual((await (await f.invoke('search', fields)).json()).missing, ['other']);
  hold = true;
  const pending = f.invoke('search', fields);
  await entered.promise;
  assert.equal((await f.invoke('disconnect')).status, 200);
  release.resolve();
  assert.deepEqual(await (await pending).json(), {code:'contacts_connection_changed'});
});

test('search checks grant, input and quota before calling Google', async () => {
  const f = await fixture({rateLimited:true});
  assert.equal((await f.invoke('search', {query:'a', grant:f.old.grant_id})).status, 400);
  assert.equal((await f.invoke('search', {query:'customer', grant:'10000000-0000-4000-8000-000000000000'})).status, 409);
  assert.equal((await f.invoke('search', {query:'customer', grant:f.old.grant_id})).status, 429);
  assert.equal(f.requests.length, 0);
});
