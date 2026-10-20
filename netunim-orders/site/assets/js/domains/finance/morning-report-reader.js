import {loadMorningReportSource} from './morning-report-loader.js';

const sourceLabel = source => source === 'documents' ? 'מסמכים' : 'הוצאות';

// One complete source can remain useful when another fails. A failed source
// stays null, and neither cancellation nor a mixed environment may be cached.
export async function readMorningReportBundle({request, cache, scope, assertCurrent, environment = '',
    fromDate, toDate, reportType = 'receipts', signal, progress = () => {}}) {
    if ([request, scope, assertCurrent, cache?.read, cache?.write, cache?.clear].some(port => typeof port !== 'function'))
        throw new TypeError('morning_report_reader_ports_required');
    if (!['receipts', 'profit', 'vat'].includes(reportType)) throw new TypeError('morning_report_reader_type_invalid');
    const assertActive = () => { scope(); assertCurrent(); signal?.throwIfAborted(); };
    assertActive();
    const sources = reportType === 'receipts' ? ['documents'] : ['documents', 'expenses'];
    const settled = await Promise.allSettled(sources.map(async source => {
        assertActive();
        const cached = cache.read({source, fromDate, toDate, environment, assertScope:scope});
        assertActive();
        if (cached) return cached;
        return loadMorningReportSource({request, source, fromDate, toDate, assertCurrent:assertActive, signal,
            progress:value => { assertActive(); progress(value); }});
    }));
    assertActive();
    const result = {documents:null, expenses:null, errors:[], environment:'', readAt:'', sourceResults:{}};
    settled.forEach((outcome, index) => {
        const source = sources[index];
        if (outcome.status === 'rejected') {
            result.errors.push({source, code:typeof outcome.reason?.code === 'string' ? outcome.reason.code : 'morning_report_source_failed',
                message:`${sourceLabel(source)}: ${outcome.reason?.message || 'הקריאה נכשלה'}`});
            return;
        }
        const value = outcome.value;
        if (result.environment && result.environment !== value.environment) {
            cache.clear();
            throw Object.assign(new Error('מקורות הדוח שייכים לסביבות מורנינג שונות'), {code:'morning_report_environment_mismatch'});
        }
        result.environment = value.environment;
        if (!result.readAt || Date.parse(value.readAt) < Date.parse(result.readAt)) result.readAt = value.readAt;
        result[source] = value.items;
        result.sourceResults[source] = value;
    });
    if (!result.environment) throw Object.assign(new Error(result.errors.map(error => error.message).join(' · ')),
        {code:'morning_report_sources_unavailable', errors:result.errors});
    assertActive();
    for (const source of sources) {
        const value = result.sourceResults[source];
        if (value && !value.cacheHit) cache.write({source, fromDate, toDate, ...value, assertScope:scope});
    }
    assertActive();
    return result;
}
