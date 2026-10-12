import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudTransport} from '../netunim-kupa/site/assets/js/cloud/transport.js';

function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; }
for (const method of ['readOrdersReadOnlyMeta', 'readOrdersReadOnlyCloud']) {
  test(`Orders read-only ${method} carries the caller guard and rechecks it after body parsing`, async () => {
    let current = true, options;
    const parsing = gate(), body = gate();
    const assertCurrent = () => { if (!current) throw Error('former login'); };
    const transport = createCloudTransport({session:{}, supaRest:async (_path, request) => {
      options = request;
      return {ok:true, async json() { parsing.resolve(); await body.promise; return [{revision:1, state:{}}]; }};
    }});
    const pending = transport[method]({assertCurrent});
    await parsing.promise;
    assert.equal(options.assertRequestScope, assertCurrent);
    current = false; body.resolve();
    await assert.rejects(pending, /former login/);
  });
}
