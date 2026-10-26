import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createExpenseTransport} from '../netunim-orders/supabase/functions/morning-expenses/transport.js';

function fixture(statuses, {path = '/expenses/search', method = 'POST', retryAfter = '1'} = {}) {
  let calls = 0;
  const waits = [], request = createExpenseTransport({environment:'sandbox', clientId:'fixture', clientSecret:'fixture',
    now:() => Date.parse('2026-10-26T10:00:00Z'), sleep:async ms => {waits.push(ms);},
    fetch:async url => url.includes('/oauth/token') ? Response.json({access_token:'fixture', expires_in:3600}) :
      new Response(statuses[calls++] === 200 ? '{"items":[]}' : 'slow down', {status:statuses[calls - 1], headers:retryAfter === null ? {} : {'Retry-After':retryAfter}}),
  });
  return {run:() => request(path, {method}), calls:() => calls, waits};
}
test('safe searches honor bounded Retry-After even when a 429 response is not JSON', async () => {
  const f = fixture([429,429,200]); await f.run(); assert.equal(f.calls(), 3); assert.deepEqual(f.waits, [1000,1000]);
  const fallback = fixture([429,429,200], {retryAfter:null}); await fallback.run(); assert.deepEqual(fallback.waits, [500,1000]);
  const date = fixture([429,200], {retryAfter:'Mon, 26 Oct 2026 10:00:02 GMT'}); await date.run(); assert.deepEqual(date.waits, [2000]);
});
test('rate retries have a finite budget and never disregard long or malformed cooldowns', async () => {
  const f = fixture([429,429,429]); await assert.rejects(f.run(), error => error.status === 429); assert.equal(f.calls(), 3);
  for (const retryAfter of ['20','garbage','-1']) {
    const f = fixture([429,200], {retryAfter}); await assert.rejects(f.run()); assert.equal(f.calls(), 1); assert.equal(f.waits.length, 0);
  }
});
test('financial writes and unrecognized POST searches never replay after 429 or 401', async () => {
  for (const path of ['/expenses','/expenses/one/close','/unexpected/search']) for (const status of [429,401]) {
    const f = fixture([status,200], {path}); await assert.rejects(f.run()); assert.equal(f.calls(), 1); assert.equal(f.waits.length, 0);
  }
});
