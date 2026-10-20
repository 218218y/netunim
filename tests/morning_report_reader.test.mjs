import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readMorningReportBundle} from '../netunim-orders/site/assets/js/domains/finance/morning-report-reader.js';
import {createMorningReportCache} from '../netunim-orders/site/assets/js/domains/finance/morning-report-cache.js';

const scope = () => {};
const selection = {fromDate:'2026-01-01', toDate:'2026-02-28'};
const item = (source, index, date = selection.fromDate) => ({kind:source === 'documents' ? 'document' : 'expense', id:`${source}-${index}`, date});
function page(body, {total = 1, environment = 'production', readAt = '2026-10-20T09:00:00Z'} = {}) {
    return {...body, version:1, pageSize:50, total, pages:Math.ceil(total / 50), environment, readAt,
        items:Array.from({length:Math.max(0, Math.min(50, total - body.page * 50))}, (_, index) => item(body.source, body.page * 50 + index, body.fromDate))};
}
function fixture({serve = () => ({}), cache = createMorningReportCache(), assertCurrent = () => {}} = {}) {
    const calls = [];
    const read = options => readMorningReportBundle({cache, scope, assertCurrent, ...selection, environment:'production',
        request:async (action, body, assertActive, requestOptions) => {
            assert.equal(action, 'report_page'); assertActive(); calls.push({...body, signal:requestOptions.signal});
            const result = await serve(body, requestOptions);
            return page(body, result);
        }, ...options});
    return {read, cache, calls};
}
const query = (source, environment = 'production') => ({source, ...selection, environment, assertScope:scope});

test('receipts demand only documents; profit/VAT reuse completed documents and load missing expenses', async () => {
    const f = fixture();
    const receipts = await f.read({reportType:'receipts'});
    assert.deepEqual(f.calls.map(call => call.source), ['documents']);
    assert.equal(receipts.documents.length, 1); assert.equal(receipts.expenses, null); assert.deepEqual(receipts.errors, []);
    const profit = await f.read({reportType:'profit'});
    assert.deepEqual(f.calls.map(call => call.source), ['documents', 'expenses']);
    assert.equal(profit.sourceResults.documents.cacheHit, true); assert.equal(profit.expenses.length, 1);
    const vat = await f.read({reportType:'vat'}); assert.equal(f.calls.length, 2);
    assert.equal(vat.sourceResults.documents.cacheHit, true); assert.equal(vat.sourceResults.expenses.cacheHit, true);
});
test('source failures remain null, preserve complete other sources and never cache a failed prefix', async () => {
    const f = fixture({serve:body => {
        if (body.source === 'documents' && body.page) throw Object.assign(new Error('second page unavailable'), {code:'fixture_network_error'});
        return {total:body.source === 'documents' ? 51 : 1};
    }});
    const result = await f.read({reportType:'profit'});
    assert.equal(result.documents, null); assert.equal(result.expenses.length, 1);
    assert.deepEqual(result.errors, [{source:'documents', code:'fixture_network_error', message:'מסמכים: second page unavailable'}]);
    assert.equal(f.cache.read(query('documents')), null); assert.equal(f.cache.read(query('expenses')).items.length, 1);
    assert.equal(result.sourceResults.documents, undefined);
});
test('all requested sources failing rejects with source diagnostics instead of returning zero data', async () => {
    const f = fixture({serve:() => { throw new Error('Morning unavailable'); }});
    await assert.rejects(f.read({reportType:'profit'}), error => {
        assert.equal(error.code, 'morning_report_sources_unavailable'); assert.equal(error.errors.length, 2);
        assert.match(error.message, /מסמכים: Morning unavailable/); assert.match(error.message, /הוצאות: Morning unavailable/); return true;
    });
    assert.equal(f.cache.read(query('documents')), null); assert.equal(f.cache.read(query('expenses')), null);
});
test('empty successful sources remain known empty arrays rather than unavailable data', async () => {
    const f = fixture({serve:() => ({total:0})}), result = await f.read({reportType:'profit'});
    assert.deepEqual(result.documents, []); assert.deepEqual(result.expenses, []); assert.deepEqual(result.errors, []);
    assert.equal(result.sourceResults.documents.complete, true); assert.equal(result.sourceResults.expenses.complete, true);
});
test('unavailable expenses stay null while complete document receipts remain usable', async () => {
    const f = fixture({serve:body => { if (body.source === 'expenses') throw new Error('expenses unavailable'); return {}; }});
    const result = await f.read({reportType:'vat'});
    assert.equal(result.documents.length, 1); assert.equal(result.expenses, null);
    assert.equal(result.errors[0].source, 'expenses'); assert.equal(f.cache.read(query('expenses')), null);
    assert.equal(f.cache.read(query('documents')).items.length, 1);
});
test('mixed cached and fresh environments clear all cached data and expose a typed recoverable error', async () => {
    let environment = 'production'; const f = fixture({serve:() => ({environment})});
    await f.read({reportType:'receipts'}); environment = 'sandbox';
    await assert.rejects(f.read({reportType:'profit'}), {code:'morning_report_environment_mismatch'});
    assert.equal(f.cache.read(query('documents')), null); assert.equal(f.cache.read(query('expenses', 'sandbox')), null);
    const recovered = await f.read({reportType:'profit', environment:''});
    assert.equal(recovered.environment, 'sandbox'); assert.equal(recovered.documents.length, 1); assert.equal(recovered.expenses.length, 1);
    assert.deepEqual(f.calls.map(call => call.source), ['documents', 'expenses', 'documents', 'expenses']);
});
test('the bundle preserves the earliest original read timestamp, including cached source time', async () => {
    let later = false;
    const f = fixture({serve:body => ({readAt:body.source === 'expenses' || later ? '2026-10-20T09:05:00+00:00' : '2026-10-20T09:00:00Z'})});
    await f.read({reportType:'receipts'}); later = true;
    const result = await f.read({reportType:'profit'});
    assert.equal(result.readAt, '2026-10-20T09:00:00Z'); assert.equal(result.sourceResults.documents.readAt, result.readAt);
    assert.equal(result.sourceResults.expenses.readAt, '2026-10-20T09:05:00+00:00');
});
test('cached sources keep their fixed TTL and skip writes when reused', async () => {
    let now = 100, writes = 0;
    const cache = createMorningReportCache({now:() => now}), write = cache.write;
    cache.write = value => { writes++; return write(value); };
    const f = fixture({cache}); await f.read({reportType:'receipts'}); assert.equal(writes, 1);
    now += 30_000; await f.read({reportType:'receipts'}); assert.equal(writes, 1); assert.equal(f.calls.length, 1);
    now += 29_999; await f.read({reportType:'receipts'}); assert.equal(writes, 1);
    now++; await f.read({reportType:'receipts'}); assert.equal(writes, 2); assert.equal(f.calls.length, 2);
});
test('cache operations receive account scope, not the per-run guard', async () => {
    const runGuard = () => {}, seen = [], cache = createMorningReportCache(), read = cache.read, write = cache.write;
    cache.read = value => { seen.push(value.assertScope); return read(value); };
    cache.write = value => { seen.push(value.assertScope); return write(value); };
    const f = fixture({cache, assertCurrent:runGuard}); await f.read({reportType:'profit'});
    assert.equal(seen.length, 4); assert.ok(seen.every(assertion => assertion === scope));
});
test('cancellation reaches both active streams and never caches a cancelled result', async () => {
    const controller = new AbortController(), reason = new DOMException('cancelled', 'AbortError'); let active = 0;
    const f = fixture({serve:async (_body, options) => {
        active++; return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), {once:true}));
    }});
    const pending = f.read({reportType:'profit', signal:controller.signal}); assert.equal(active, 2); controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
    assert.equal(f.cache.read(query('documents')), null); assert.equal(f.cache.read(query('expenses')), null);
});
test('an already cancelled or obsolete run starts no network read', async () => {
    const controller = new AbortController(), reason = new DOMException('cancelled', 'AbortError'), f = fixture(); controller.abort(reason);
    await assert.rejects(f.read({signal:controller.signal}), error => error === reason); assert.equal(f.calls.length, 0);
    await assert.rejects(f.read({assertCurrent:() => { throw new Error('obsolete'); }}), /obsolete/); assert.equal(f.calls.length, 0);
});
test('a scope change during reading prevents publishing or caching another account continuation', async () => {
    let current = true;
    const accountScope = () => { if (!current) throw new Error('account changed'); };
    const f = fixture({serve:() => { current = false; return {}; }});
    await assert.rejects(f.read({reportType:'profit', scope:accountScope}), /account changed/);
    assert.equal(f.cache.read(query('documents')), null); assert.equal(f.cache.read(query('expenses')), null);
});
test('paging uses at most two parallel streams and forwards guarded source progress', async () => {
    let active = 0, maximum = 0; const progress = [];
    const f = fixture({serve:async body => {
        active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--;
        return {total:body.source === 'documents' ? 101 : 51};
    }});
    const result = await f.read({reportType:'profit', progress:value => progress.push(value)});
    assert.equal(maximum, 2); assert.equal(f.calls.length, 5); assert.equal(progress.length, 5);
    assert.equal(result.documents.length, 101); assert.equal(result.expenses.length, 51);
    assert.ok(progress.every(value => value.page >= 1 && value.page <= value.pages));
});
