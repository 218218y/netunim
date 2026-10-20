import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createCloudAuth} from '../netunim-orders/site/assets/js/cloud/auth.js';
import {createMorningRequest} from '../netunim-orders/site/assets/js/integrations/morning.js';
import {loadMorningReportSource} from '../netunim-orders/site/assets/js/domains/finance/morning-report-loader.js';
import {createMorningReportCache} from '../netunim-orders/site/assets/js/domains/finance/morning-report-cache.js';

const noScopeChange = () => {};
const abortReason = () => new DOMException('Report cancelled', 'AbortError');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const selection = {source:'documents', fromDate:'2026-01-01', toDate:'2026-12-31'};
const row = id => ({kind:'document', id:String(id), date:'2026-01-10', payments:[{type:1, amountCents:100}]});
function page(body, total = 51) {
    return {...body, version:1, pageSize:50, total, pages:Math.ceil(total / 50), environment:'production',
        readAt:'2026-10-20T00:00:00Z', items:Array.from({length:Math.max(0, Math.min(50, total - body.page * 50))}, (_, index) => row(body.page * 50 + index))};
}
function authFixture(t, {expired = false} = {}) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map();
    Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:{getItem:key => values.get(key) || null,
        setItem:(key, value) => values.set(key, String(value)), removeItem:key => values.delete(key)}});
    t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
    const auth = createCloudAuth({});
    auth.saveSession({user:{id:'A'}, access_token:'fixture-A', refresh_token:'fixture-refresh', expires_at:expired ? 1 : 9999999999});
    return auth;
}
function client(auth) { return createMorningRequest({supaFetch:auth.supaFetch, operationScope:{captureRead:() => noScopeChange}}); }

test('already aborted authenticated and Morning reads never reach the network', async t => {
    const auth = authFixture(t), controller = new AbortController(), reason = abortReason(); let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ok:true}); });
    controller.abort(reason);
    await assert.rejects(auth.supaFetch('/functions/v1/fixture', {method:'POST', signal:controller.signal}), error => error === reason);
    await assert.rejects(client(auth).json('report_page', selection, noScopeChange, {signal:controller.signal}), error => error === reason);
    assert.equal(calls, 0);
});
test('caller abort reaches the actual fetch, keeps AbortError and never retries', async t => {
    const auth = authFixture(t), controller = new AbortController(), entered = deferred(), reason = abortReason(); let calls = 0, networkSignal;
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
        calls++; networkSignal = options.signal; entered.resolve();
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), {once:true}));
    });
    const pending = auth.supaFetch('/functions/v1/fixture', {method:'POST', networkRetry:true, signal:controller.signal});
    await entered.promise; controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
    assert.equal(networkSignal.aborted, true); assert.equal(calls, 1);
});
test('Morning cancellation also aborts a response body after headers arrived', async t => {
    const auth = authFixture(t), controller = new AbortController(), reason = abortReason(), entered = deferred(); let networkSignal;
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
        networkSignal = options.signal;
        const stream = new ReadableStream({start(body) {
            options.signal.addEventListener('abort', () => body.error(options.signal.reason), {once:true}); entered.resolve();
        }});
        return new Response(stream, {headers:{'Content-Type':'application/json'}});
    });
    const pending = client(auth).json('report_page', selection, noScopeChange, {signal:controller.signal});
    await entered.promise; await tick(); controller.abort(reason);
    await assert.rejects(pending, error => error === reason); assert.equal(networkSignal.aborted, true);
});
test('caller abort interrupts retry backoff without another network attempt', async t => {
    const auth = authFixture(t), controller = new AbortController(), reason = abortReason(); let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; throw new TypeError('Failed to fetch'); });
    const pending = auth.supaFetch('/functions/v1/fixture', {method:'POST', networkRetry:true, signal:controller.signal});
    await tick(); assert.equal(calls, 1); controller.abort(reason);
    await assert.rejects(pending, error => error === reason); assert.equal(calls, 1);
});
test('the transport timeout keeps its existing timeout error semantics', async t => {
    const auth = authFixture(t), timers = new Map(); let next = 0, entered = false;
    t.mock.method(globalThis, 'setTimeout', callback => { timers.set(++next, callback); return next; });
    t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
    t.mock.method(globalThis, 'fetch', async (_url, options) => { entered = true; return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), {once:true})); });
    const pending = auth.supaFetch('/functions/v1/fixture', {method:'POST', networkRetry:false});
    await tick(); assert.equal(entered, true); [...timers.values()][0]();
    await assert.rejects(pending, {code:'SUPABASE_NETWORK_TIMEOUT'}); assert.equal(timers.size, 0);
});
for (const boundary of ['session', '401']) test(`abort during ${boundary} refresh fences the later function request`, async t => {
    const auth = authFixture(t, {expired:boundary === 'session'}), controller = new AbortController(), entered = deferred(), release = deferred(), reason = abortReason(); let calls = 0;
    t.mock.method(globalThis, 'fetch', async url => {
        if (url.includes('/auth/v1/token')) { entered.resolve(); await release.promise; return Response.json({user:{id:'A'}, access_token:'fixture-new', refresh_token:'fixture-refresh', expires_in:3600}); }
        calls++; return new Response('', {status:401});
    });
    const pending = auth.supaFetch('/functions/v1/fixture', {method:'POST', signal:controller.signal});
    await entered.promise; controller.abort(reason); release.resolve();
    await assert.rejects(pending, error => error === reason); assert.equal(calls, boundary === 'session' ? 0 : 1);
});
test('an aborted request waiting for its request-scope adapter cannot send later', async t => {
    const auth = authFixture(t), controller = new AbortController(), entered = deferred(), release = deferred(), reason = abortReason(); let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ok:true}); });
    const pending = auth.supaFetch('/functions/v1/fixture', {method:'POST', signal:controller.signal, withRequestScope:async send => { entered.resolve(); await release.promise; return send(); }});
    await entered.promise; controller.abort(reason); release.resolve();
    await assert.rejects(pending, error => error === reason); assert.equal(calls, 0);
});
test('source reads forward cancellation and never publish a cancelled page prefix', async () => {
    const controller = new AbortController(), reason = abortReason(); let calls = 0, progress = 0;
    await assert.rejects(loadMorningReportSource({...selection, assertCurrent:noScopeChange, signal:controller.signal,
        progress:() => { progress++; }, request:async (_action, body, assertCurrent, options) => {
            calls++; assert.equal(options.signal, controller.signal); assertCurrent(); controller.abort(reason); return page(body);
        }}), error => error === reason);
    assert.equal(calls, 1); assert.equal(progress, 0);
});
test('oversized sources stop with an actionable limit and no accepted partial totals', async () => {
    let calls = 0, progress = 0;
    await assert.rejects(loadMorningReportSource({...selection, assertCurrent:noScopeChange, progress:() => { progress++; },
        request:async (_action, body) => { calls++; return page(body, 50_001); }}), {code:'morning_report_page_limit', maxPages:1000});
    assert.equal(calls, 1); assert.equal(progress, 0);
});
test('large complete sources retain all records and explicit completion metadata', async () => {
    let calls = 0;
    const result = await loadMorningReportSource({...selection, assertCurrent:noScopeChange,
        request:async (_action, body) => { calls++; return page(body, 20_001); }});
    assert.equal(result.complete, true); assert.equal(result.total, 20_001); assert.equal(result.items.length, 20_001);
    assert.equal(result.pagesRead, 401); assert.equal(calls, 401);
});

const cachedSource = (overrides = {}) => ({...selection, items:[row(1)], environment:'production', readAt:'2026-10-20T00:00:00Z',
    complete:true, pagesRead:1, assertScope:noScopeChange, ...overrides});
test('cache copies both writes and reads, preserving the original read timestamp', () => {
    const cache = createMorningReportCache(), source = cachedSource();
    assert.equal(cache.write(source), true); source.items[0].payments[0].amountCents = 900;
    const first = cache.read(source); assert.equal(first.cacheHit, true); assert.equal(first.readAt, source.readAt);
    assert.equal(first.items[0].payments[0].amountCents, 100); first.items[0].payments[0].amountCents = 800; first.items.push(row(2));
    assert.equal(cache.read(source).items.length, 1); assert.equal(cache.read(source).items[0].payments[0].amountCents, 100);
    assert.equal(cache.read({...source, environment:undefined}), null); cache.clear(); assert.equal(cache.read(source), null);
});
test('cache expiration is short, bounded and invalidated on a clock rollback', () => {
    let now = 100;
    const source = cachedSource(), cache = createMorningReportCache({now:() => now}); cache.write(source);
    now += 59_999; assert.ok(cache.read(source)); now++; assert.equal(cache.read(source), null);
    cache.write(source); now--; assert.equal(cache.read(source), null);
    const bounded = createMorningReportCache({now:() => now, ttlMs:99_999_999}); bounded.write(source);
    now += 300_000; assert.equal(bounded.read(source), null);
});
test('reusing a cached response cannot extend its original expiry time', () => {
    let now = 100;
    const source = cachedSource(), cache = createMorningReportCache({now:() => now}); cache.write(source);
    now += 30_000;
    const reused = cache.read(source); assert.equal(reused.cacheHit, true);
    assert.equal(cache.write({...source, ...reused}), false);
    now += 30_000; assert.equal(cache.read(source), null);
});
test('cache isolates the actual account epoch and fails closed on a rejected caller', () => {
    let epoch = 1;
    const assertion = () => { const observed = epoch; return () => { if (epoch !== observed) throw new Error('account changed'); }; };
    const cache = createMorningReportCache(), source = cachedSource({assertScope:assertion()}); cache.write(source);
    epoch++; const current = {...source, assertScope:assertion()}; assert.equal(cache.read(current), null);
    cache.write(current); assert.throws(() => cache.read({...current, assertScope:() => { throw new Error('unreadable'); }}), /unreadable/);
    assert.equal(cache.read(current), null);
});
test('cache keys source, exact range and environment; an environment change evicts previous data', () => {
    const cache = createMorningReportCache(), source = cachedSource(); cache.write(source);
    assert.equal(cache.read({...source, source:'expenses'}), null);
    assert.equal(cache.read({...source, toDate:'2026-11-30'}), null);
    assert.equal(cache.read({...source, environment:'sandbox'}), null);
    const sandbox = {...source, environment:'sandbox'}; cache.write(sandbox);
    assert.equal(cache.read(source), null); assert.ok(cache.read(sandbox));
});
test('cache bounds retained records and entries, evicts least recently used, rejects incomplete sources', () => {
    const cache = createMorningReportCache({maxEntries:2, maxRecords:3});
    const a = cachedSource(), b = cachedSource({fromDate:'2026-02-01'}), c = cachedSource({fromDate:'2026-03-01'});
    cache.write(a); cache.write(b); cache.read(a); cache.write(c);
    assert.equal(cache.read(b), null); assert.ok(cache.read(a)); assert.ok(cache.read(c));
    const many = cachedSource({items:[row(1), row(2), row(3), row(4)]}); assert.equal(cache.write(many), false);
    assert.equal(cache.write({...a, complete:false}), false);
    cache.write({...b, items:[row(1), row(2), row(3)]}); assert.equal(cache.read(a), null); assert.equal(cache.read(c), null); assert.equal(cache.read(b).items.length, 3);
    assert.equal(createMorningReportCache({ttlMs:0}).write(a), false);
});
