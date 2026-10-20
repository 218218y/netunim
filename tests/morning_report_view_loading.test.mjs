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
    const option = (key, value) => view.actions['morning-report-option']({dataset:{reportOption:key}, value, type:typeof value === 'boolean' ? 'checkbox' : 'text', checked:value === true});
    return {view, calls, action, option, busy, details, switchAccount};
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

test('local filters and manual numeric references never request data or change report totals', async t => {
    const f = fixture(t); await f.action('type', 'profit'); await f.action('load');
    f.action('detail', 'all');
    const count = f.calls.length;
    f.option('filter:minAmount', '118.01');
    assert.match(f.view.markup(), /מוצגים 0 מתוך 2/);
    f.option('filter:minAmount', '1.001');
    assert.match(f.view.markup(), /morning-report-warning/);
    f.option('filter:reset', '1'); assert.match(f.view.markup(), /מוצגים 2 מתוך 2/);
    f.option('official:reference', 'Synthetic reference'); f.option('official:value:profitCents', '-9');
    assert.doesNotMatch(f.view.markup(), /data-reconciliation-state="match"/);
    f.option('official:scope', true); f.option('official:basis:profitCents', true);
    assert.match(f.view.markup(), /data-reconciliation-state="match"/);
    assert.equal(f.calls.length, count);
    f.action('period', 'month'); assert.doesNotMatch(f.view.markup(), /Synthetic reference|morning-report-cards/);
});

test('comparison reads only on explicit action; cancellation allows a new comparison and blocks late results', async t => {
    const old = deferred(), fresh = deferred(); let comparisonRequests = 0;
    const f = fixture(t, async () => {
        if (f.calls.length > 1) await (++comparisonRequests === 1 ? old.promise : fresh.promise);
        return {};
    });
    await f.action('load'); assert.equal(f.calls.length, 1);
    const first = f.option('comparison:load', '1'); assert.equal(f.calls.length, 2);
    const signal = f.calls[1].signal; f.option('comparison:cancel', '1'); assert.equal(signal.aborted, true);
    const second = f.option('comparison:load', '1'); assert.equal(f.calls.length, 3);
    old.resolve(); assert.equal(await first, false);
    assert.match(f.view.markup(), /morning-report-comparison" aria-busy="true"/);
    fresh.resolve(); assert.equal(await second, true);
    assert.match(f.view.markup(), /morning-report-comparison-table/);
    f.option('filter:search', 'A'); assert.equal(f.calls.length, 3);
});

test('account switch cancels comparison and clears financial drafts before old completion', async t => {
    const held = deferred(); let comparison = false;
    const f = fixture(t, async () => { if (comparison) await held.promise; return {}; });
    await f.action('load'); f.option('official:reference', 'private-account-A'); comparison = true;
    const read = f.option('comparison:load', '1'), signal = f.calls.at(-1).signal;
    f.switchAccount('B'); assert.equal(signal.aborted, true);
    held.resolve(); assert.equal(await read, false);
    assert.doesNotMatch(f.view.markup(), /private-account-A|morning-report-cards|morning-report-comparison-table/);
});

test('display preferences persist only whitelisted nonfinancial settings', async t => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), writes = [];
    Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:{
        getItem:() => JSON.stringify({group:'quarter', report:'vat', showTrend:false, name:'injected-private-data'}),
        setItem:(key, value) => writes.push({key, value:JSON.parse(value)}),
    }});
    t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
    const f = fixture(t); await f.action('load');
    assert.match(f.view.markup(), /value="quarter" selected/);
    assert.doesNotMatch(f.view.markup(), /<figure class="morning-report-trend"/);
    f.option('official:reference', 'private-draft'); f.option('filter:search', 'private-client');
    assert.equal(writes.length, 0);
    f.option('display:trend', true);
    assert.deepEqual(writes, [{key:'morningReportViewPreferences', value:{version:1, group:'quarter', report:'vat', showTrend:true}}]);
});
