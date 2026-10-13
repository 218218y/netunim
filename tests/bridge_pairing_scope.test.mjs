import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgePairingScope } from '../shared/bridge-pairing-scope.js';
test('pairing authority is inert and rejects observed device generations without exposing tokens', () => {
  let token = 'private-A',
    reads = 0;
  const scope = createBridgePairingScope({
    readToken: () => {
      reads++;
      return token;
    },
  });
  assert.equal(reads, 0);
  const first = scope.capture();
  first();
  token = 'private-B';
  const second = scope.capture();
  token = 'private-A';
  scope.capture();
  for (const guard of [first, second])
    assert.throws(
      guard,
      (error) =>
        error.code === 'BRIDGE_PAIRING_SCOPE_CHANGED' && !error.message.includes('private-')
    );
});
test('unavailable token storage and disposal fence captured permits with sanitized errors', () => {
  let blocked = false;
  const scope = createBridgePairingScope({
      readToken: () => {
        if (blocked) throw Error('private storage detail');
        return 'private-A';
      },
    }),
    guard = scope.capture();
  blocked = true;
  assert.throws(
    guard,
    (error) => error.code === 'BRIDGE_PAIRING_SCOPE_CHANGED' && !error.message.includes('private')
  );
  blocked = false;
  assert.throws(guard);
  const fresh = scope.capture();
  fresh();
  assert.equal(scope.dispose(), true);
  assert.equal(scope.dispose(), false);
  assert.throws(fresh);
  assert.throws(scope.capture);
});
test('pairing authority never grants permission for absent or non-text device identity', () => {
  for (const token of ['', null, undefined, false, 0, {}])
    assert.throws(
      () => createBridgePairingScope({ readToken: () => token }).capture(),
      (error) => error.code === 'BRIDGE_PAIRING_SCOPE_CHANGED'
    );
  assert.throws(() => createBridgePairingScope({}), /reader_required/);
});
