// A failed or moving page invalidates its entire source; never total a prefix.
export async function loadMorningReportSource({ request, source, fromDate, toDate, assertCurrent, progress = () => { } }) {
    let total = null, pages = null, environment = null, readAt = '';
    const items = [], ids = new Set();
    for (let page = 0; page < (pages ?? 1); page++) {
        assertCurrent();
        const result = await request('report_page', { source, fromDate, toDate, page }, assertCurrent);
        assertCurrent();
        if (result.version !== 1 ||
            result.source !== source ||
            result.fromDate !== fromDate ||
            result.toDate !== toDate ||
            result.page !== page ||
            result.pageSize !== 50 ||
            !Number.isSafeInteger(result.total) ||
            result.total < 0 ||
            !Number.isSafeInteger(result.pages) ||
            result.pages < 0 ||
            result.pages > 1000 ||
            result.pages !== Math.ceil(result.total / 50) &&
                !(result.total === 0 &&
                    result.pages === 1) ||
            !['production',
                'sandbox'].includes(result.environment) ||
            !Array.isArray(result.items) ||
            result.items.length !== Math.max(0, Math.min(50, result.total - page * 50)))
            throw new Error('תשובת הדוח אינה שלמה או אינה תקינה');
        if (total !== null && (result.total !== total || result.pages !== pages || result.environment !== environment))
            throw new Error('נתוני מורנינג השתנו במהלך הקריאה. יש לרענן את הדוח');
        total = result.total;
        pages = result.pages;
        environment = result.environment;
        readAt = result.readAt;
        if (typeof readAt !== 'string' || !Number.isFinite(Date.parse(readAt)))
            throw new Error('מועד קריאת הדוח אינו תקין');
        for (const item of result.items) {
            if (!item || typeof item.id !== 'string' || ids.has(item.id) || item.kind !== (source === 'documents' ? 'document' : 'expense') || !/^\d{4}-\d{2}-\d{2}$/.test(item.date))
                throw new Error('זוהתה כפילות או רשומה לא תקינה במהלך הקריאה. יש לרענן');
            ids.add(item.id);
            items.push(item);
        }
        progress({ source, loaded: items.length, total });
    }
    if (items.length !== total)
        throw new Error('חלק מהנתונים לא התקבלו ממורנינג');
    return { items, environment, readAt };
}
