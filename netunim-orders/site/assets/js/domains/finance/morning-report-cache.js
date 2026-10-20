const SOURCES = new Set(['documents', 'expenses']);
const ENVIRONMENTS = new Set(['production', 'sandbox']);
const bounded = (value, fallback, maximum) => Number.isFinite(value) ? Math.max(0, Math.min(Math.floor(value), maximum)) : fallback;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

// This cache never persists financial records. Every entry retains the actual
// login/storage assertion that authorized its complete source read.
export function createMorningReportCache({now = Date.now, ttlMs = 60_000, maxEntries = 8, maxRecords = 20_000} = {}) {
    const entries = new Map();
    const lifetime = bounded(ttlMs, 60_000, 300_000);
    const entryLimit = bounded(maxEntries, 8, 8), recordLimit = bounded(maxRecords, 20_000, 20_000);
    let records = 0;
    function clear() { entries.clear(); records = 0; }
    function remove(key) {
        const entry = entries.get(key);
        if (entry) { records -= entry.value.items.length; entries.delete(key); }
    }
    function keyOf({source, fromDate, toDate, environment}) {
        return SOURCES.has(source) && ENVIRONMENTS.has(environment) && validDate(fromDate) && validDate(toDate) && fromDate <= toDate
            ? `${environment}|${source}|${fromDate}|${toDate}` : '';
    }
    function assertCaller(assertScope) {
        try {
            if (typeof assertScope !== 'function') throw new TypeError('morning_report_cache_scope_required');
            assertScope();
        }
        catch (error) { clear(); throw error; }
    }
    function prune(at) {
        for (const [key, entry] of entries) {
            if (!Number.isFinite(at) || at < entry.savedAt || at - entry.savedAt >= lifetime) remove(key);
        }
    }
    function read(query) {
        assertCaller(query.assertScope);
        prune(now());
        const key = keyOf(query), entry = entries.get(key);
        if (!entry) return null;
        try { entry.assertScope(); }
        catch { clear(); return null; }
        entries.delete(key); entries.set(key, entry);
        return {...structuredClone(entry.value), cacheHit:true};
    }
    function write(value) {
        assertCaller(value.assertScope);
        const key = keyOf(value), at = now();
        prune(at);
        if (!key || value.cacheHit === true || value.complete !== true || !Array.isArray(value.items) || value.items.length > recordLimit ||
            !lifetime || !entryLimit || !Number.isFinite(at) || typeof value.readAt !== 'string' || !Number.isFinite(Date.parse(value.readAt))) return false;
        const snapshot = structuredClone({items:value.items, environment:value.environment, readAt:value.readAt,
            complete:true, total:value.items.length, pagesRead:value.pagesRead});
        // An environment switch invalidates all data from the previous server
        // environment, including otherwise matching date/source keys.
        for (const [oldKey, entry] of entries) {
            try { entry.assertScope(); }
            catch { clear(); break; }
            if (entry.value.environment !== value.environment) remove(oldKey);
        }
        remove(key);
        while (entries.size && (entries.size >= entryLimit || records + snapshot.items.length > recordLimit)) remove(entries.keys().next().value);
        entries.set(key, {value:snapshot, savedAt:at, assertScope:value.assertScope}); records += snapshot.items.length;
        return true;
    }
    return {read, write, clear};
}
