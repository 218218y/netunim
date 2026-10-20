import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createMorningReports} from '../netunim-orders/site/assets/js/domains/finance/morning-reports.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
function fixture(t, serve = () => ({})) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', {configurable:true, value:{querySelector:() => null, getElementById:() => null}});
    const calls = [], account = {owner:'A', epoch:1}; let listener = null;
    const view = createMorningReports({
        dateEditorMarkup:(id, value) => `<input id="${id}" value="${value}">`,
        captureRead:() => {
            const {owner, epoch} = account;
            return () => { if (account.owner !== owner || account.epoch !== epoch) throw new Error('account changed'); };
        },
        subscribeAccountScope:callback => { listener = callback; return () => { listener = null; }; },
        request:async (action, body, assertCurrent, options) => {
            assert.equal(action, 'report_page'); assertCurrent();
            const call = {...body, owner:account.owner, signal:options.signal}; calls.push(call);
            const supplied = await serve(call), marker = supplied.marker || account.owner;
            const common = {id:`${body.source}-${marker}`, number:'123', type:body.source === 'documents' ? 320 : 305,
                date:body.fromDate, reportingDate:body.fromDate, sourceDocumentDate:body.fromDate, documentDate:body.fromDate,
                status:10, currency:'ILS', name:`source-${marker}`, description:'fixture', grossCents:11_800, vatCents:1800};
            const item = body.source === 'documents' ? {...common, kind:'document', status:0, selfInvoice:false, businessType:1,
                payments:[{type:3, amountCents:11_800}]} : {...common, kind:'expense', deductibleVatCents:900, deductibleCents:10_000,
                category:'fixture', categoryKey:'fixture'};
            return {ok:true, version:1, ...body, pageSize:50, total:1, pages:1, environment:supplied.environment || 'production',
                readAt:new Date(Date.now()).toISOString(), items:[item]};
        },
    });
    t.after(() => {
        view.runtime.dispose();
        if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document;
    });
    const action = (name, value) => view.actions[`morning-report-${name}`]({dataset:{clickArg0:value}});
    const busy = () => /data-action="morning-report-load"[^>]*disabled/.test(view.markup());
    const details = () => { action('detail', calls.at(-1).fromDate.slice(0, 7)); return view.markup(); };
    const switchAccount = owner => { account.owner = owner; account.epoch++; listener?.(); };
    return {view, calls, action, busy, details, switchAccount};
}

test('initial receipts read documents only; profit requests only missing expenses and VAT reuses both', async t => {
    const f = fixture(t);
    assert.match(f.view.markup(), /data-action="morning-report-type" data-click-arg0="profit"/);
    assert.equal(f.calls.length, 0);
    assert.equal(await f.action('load'), true);
    assert.deepEqual(f.calls.map(call => call.source), ['documents']);
    assert.match(f.view.markup(), /morning-report-cards/); assert.equal(f.busy(), false);
    assert.equal(await f.action('type', 'profit'), true);
    assert.deepEqual(f.calls.map(call => call.source), ['documents', 'expenses']);
    await f.action('type', 'vat'); assert.equal(f.calls.length, 2);
    assert.match(f.view.markup(), /הפרש לתשלום \/ להחזר/);
});
test('profit can be selected before loading and reads both required sources once', async t => {
    const f = fixture(t);
    await f.action('type', 'profit'); assert.equal(f.calls.length, 0);
    assert.equal(await f.action('load'), true);
    assert.deepEqual(f.calls.map(call => call.source).sort(), ['documents', 'expenses']);
});
test('revisiting the same range reuses complete sources; manual refresh bypasses cache', async t => {
    const f = fixture(t);
    await f.action('type', 'profit'); await f.action('load'); assert.equal(f.calls.length, 2);
    f.action('period', 'bimonth'); assert.equal(await f.action('load'), true); assert.equal(f.calls.length, 2);
    assert.equal(await f.action('load'), true); assert.equal(f.calls.length, 4);
    assert.equal(f.calls.filter(call => call.source === 'documents').length, 2);
    assert.equal(f.calls.filter(call => call.source === 'expenses').length, 2);
});
test('cancel permits a new read immediately; late old completion cannot unlock or publish over it', async t => {
    const old = deferred(), fresh = deferred(); let attempt = 0;
    const f = fixture(t, async () => { const number = ++attempt; await (number === 1 ? old.promise : fresh.promise); return {marker:number === 1 ? 'old' : 'fresh'}; });
    const first = f.action('load'); assert.equal(f.calls.length, 1); assert.equal(f.busy(), true);
    const oldSignal = f.calls[0].signal; f.action('cancel');
    assert.equal(oldSignal.aborted, true); assert.equal(f.busy(), false); assert.equal(f.view.runtime.isPending(), true);
    const second = f.action('load'); assert.equal(f.calls.length, 2); assert.equal(f.busy(), true);
    old.resolve(); assert.equal(await first, false);
    assert.equal(f.busy(), true); assert.doesNotMatch(f.view.markup(), /morning-report-cards|source-old/);
    fresh.resolve(); assert.equal(await second, true); assert.equal(f.busy(), false);
    assert.match(f.details(), /source-fresh/); assert.doesNotMatch(f.view.markup(), /source-old/);
    await f.view.runtime.drain(); assert.equal(f.view.runtime.isPending(), false);
});
test('account switch clears accepted data, cache and old continuations before a new account reads', async t => {
    const old = deferred(); let hold = false;
    const f = fixture(t, async call => { if (hold && call.owner === 'A') await old.promise; return {marker:call.owner}; });
    await f.action('load'); assert.match(f.details(), /source-A/);
    hold = true; const former = f.action('load'); assert.equal(f.calls.length, 2);
    f.switchAccount('B'); assert.doesNotMatch(f.view.markup(), /morning-report-cards|source-A/);
    assert.equal(f.calls[1].signal.aborted, true);
    assert.equal(await f.action('load'), true); assert.equal(f.calls.length, 3);
    assert.match(f.details(), /source-B/);
    old.resolve(); assert.equal(await former, false); assert.doesNotMatch(f.view.markup(), /source-A/);
    assert.match(f.view.markup(), /source-B/);
});
test('mixed cached and fresh environments fail closed and a retry recovers with fresh matching sources', async t => {
    let environment = 'production'; const f = fixture(t, () => ({environment}));
    await f.action('load'); environment = 'sandbox';
    assert.equal(await f.action('type', 'profit'), false);
    assert.deepEqual(f.calls.map(call => call.source), ['documents', 'expenses']);
    assert.doesNotMatch(f.view.markup(), /morning-report-cards/);
    assert.match(f.view.markup(), /מקורות הדוח שייכים לסביבות מורנינג שונות/);
    assert.equal(await f.action('load'), true);
    assert.deepEqual(f.calls.map(call => call.source), ['documents', 'expenses', 'documents', 'expenses']);
    assert.match(f.view.markup(), /morning-report-cards/);
    assert.doesNotMatch(f.view.markup(), /מקורות הדוח שייכים לסביבות מורנינג שונות/);
});
test('same-range reuse expires at exactly 60 seconds and does not renew cache lifetime', async t => {
    let now = Date.UTC(2026, 9, 20, 9);
    t.mock.method(Date, 'now', () => now);
    const f = fixture(t); await f.action('load'); assert.equal(f.calls.length, 1);
    const revisit = async () => { f.action('period', 'bimonth'); assert.equal(await f.action('load'), true); };
    now += 30_000; await revisit(); assert.equal(f.calls.length, 1);
    now += 29_999; await revisit(); assert.equal(f.calls.length, 1);
    now++; await revisit(); assert.equal(f.calls.length, 2);
});
