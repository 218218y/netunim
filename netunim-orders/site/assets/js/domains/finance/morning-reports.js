import { esc } from '../../core/values.js';
import { money } from '../../core/money.js';
import { checkTodayISO } from '../../core/dates.js';
import { createRuntimeTaskOwner } from '../../shared/runtime-task-owner.js';
import { buildMorningReport, REPORT_METHODS, REPORT_TYPES, reportPeriod, validReportDate, reportCsv, reportMetric } from './morning-report-model.js';
import { loadMorningReportSource } from './morning-report-loader.js';
import { createMorningReportCache } from './morning-report-cache.js';
const OFFICIAL = 'https://app.greeninvoice.co.il/business/accounting/reports';
const EXPENSE_STATUSES = {10:'אושרה לדוח', 20:'נכללת בדוח', 30:'נערכה מחדש · נתונים עדכניים', 40:'אושרה על ידי מייצג'};
const amount = value => Number.isSafeInteger(value) ? money(value / 100) : '—';
const rowOutputVat = row => reportMetric(row, 'outputVatCents');
const dateLabel = value => value?.length === 10 ? value.split('-').reverse().join('.') : value;
const bucketLabel = key => key.length === 7 ? new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(key + '-01T00:00:00Z')) : dateLabel(key);
const option = (value, title, current) => `<option value="${esc(value)}" ${String(value) === String(current) ? 'selected' : ''}>${esc(title)}</option>`;
export function createMorningReports({ request, captureRead, subscribeAccountScope = () => () => { }, media, dateEditorMarkup, isActive = () => true }) {
    const today = checkTodayISO(), tasks = createRuntimeTaskOwner(), cache = createMorningReportCache();
    const currentPart = Math.ceil(Number(today.slice(5, 7)) / 2);
    let options = { mode: 'bimonth', year: Number(today.slice(0, 4)), part:currentPart,
        ...reportPeriod('bimonth', today.slice(0, 4), currentPart), group: 'bimonth', report: 'receipts' };
    const periodLabel = key => {
        if (key.length !== 7 || !['bimonth', 'quarter'].includes(options.group)) return bucketLabel(key);
        const length = options.group === 'bimonth' ? 2 : 3, [year, month] = key.split('-').map(Number);
        const end = `${year}-${String(month + length - 1).padStart(2, '0')}`;
        return `${bucketLabel(key)} – ${bucketLabel(end)}`;
    };
    let expanded = false, busy = false, reading = false, generation = 0, loaded = null, acceptedScope = null, error = '', progressText = '', detail = '', detailPage = 0, expandedRecord = '';
    let activeRead = null, sourceEnvironment = '';
    function clear() {
        activeRead?.abort(); activeRead = null; generation++; busy = false; reading = false;
        loaded = null; acceptedScope = null; error = ''; progressText = ''; detail = ''; detailPage = 0; expandedRecord = ''; media?.cancelPending();
    }
    const unsubscribe = subscribeAccountScope(() => { cache.clear(); sourceEnvironment = ''; clear(); render(); });
    function ensureScope() { if (acceptedScope) {
        try {
            acceptedScope();
        }
        catch {
            cache.clear(); sourceEnvironment = ''; clear();
        }
    } }
    function report() { return loaded ? buildMorningReport({ ...loaded, ...options }) : null; }
    function render() {
        if (!isActive() || !tasks.isActive())
            return;
        const host = document.querySelector('[data-morning-reports]');
        if (host)
            host.outerHTML = markup();
    }
    function reportTypeControls() {
        return `<div class="morning-report-tabs" role="group" aria-label="סוג הדוח">${[['receipts', 'תקבולים ואמצעי תשלום'],
            ['profit', 'רווח והפסד ניהולי'], ['vat', 'סיכום מע״מ']].map(([key, label]) =>
            `<button type="button" class="btn ${key === options.report ? 'primary' : ''}" aria-pressed="${key === options.report}" data-action="morning-report-type" data-click-arg0="${key}">${label}</button>`).join('')}</div>`;
    }
    function controls() {
        const year = `<label>שנה<input type="number" min="2000" max="2099" value="${options.year}" data-change="morning-report-option" data-report-option="year">
      </label>`;
        const lengths = {month:1, bimonth:2, quarter:3, year:12}, span = lengths[options.mode] || 1;
        const monthName = month => new Intl.DateTimeFormat('he-IL', {month:'long', timeZone:'UTC'}).format(new Date(Date.UTC(2026, month - 1, 1)));
        const parts = Array.from({length:12 / span}, (_, i) => [i + 1,
            options.mode === 'quarter' ? `רבעון ${i + 1}` : options.mode === 'bimonth' ? `${monthName(i * 2 + 1)}–${monthName(i * 2 + 2)}` : monthName(i + 1)]);
        const dateField = (key, title) => `<label>${title}${dateEditorMarkup(`morningReport-${key}`, options[key],
            {label:title, compact:true, change:'morning-report-option', data:{'report-option':key}})}</label>`;
        const period = options.mode === 'custom' ? dateField('fromDate', 'מתאריך') + dateField('toDate', 'עד תאריך')
            : year + (options.mode !== 'year' ? `<label>${options.mode === 'month' ? 'חודש' : options.mode === 'bimonth' ? 'דו־חודש זוגי' : 'רבעון'}<select data-change="morning-report-option" data-report-option="part">${parts.map(([value, title]) => option(value, title, options.part)).join('')}</select>
      </label>` : '');
        return `<div class="morning-report-controls">
      <div class="morning-report-periods" role="group" aria-label="תקופת הדוח">${[['month',
                'חודש'],
            ['bimonth', 'דו־חודשי'],
            ['quarter',
                'רבעון'],
            ['year',
                'שנה'],
            ['custom',
                'טווח תאריכים']].map(([key, title]) => `<button type="button" class="btn ${options.mode === key ? 'primary' : ''}" aria-pressed="${options.mode === key}" data-action="morning-report-period" data-click-arg0="${key}">${title}</button>`).join('')}</div>
      <div class="morning-report-fields">${period}<label>הצגה לפי<select data-change="morning-report-option" data-report-option="group">${[['month',
                'חודשים'],
            ['bimonth', 'דו־חודש זוגי'],
            ['quarter', 'רבעונים'],
            ['day',
                'ימים'],
            ['year',
                'שנים']].map(([key, title]) => option(key, title, options.group)).join('')}</select>
      </label>
      <button type="button" class="btn primary" data-action="morning-report-load" ${busy || reading ? 'disabled' : ''}>${busy ? 'קורא ממורנינג…' : loaded ? 'רענון ממורנינג' : 'הצגת הדוח'}</button>${busy ? '<button type="button" class="btn" data-action="morning-report-cancel">ביטול טעינה</button>' : ''}</div>
      </div>${reportTypeControls()}`;
    }
    function reportColumns() {
        if (options.report === 'receipts') return [...Object.values(REPORT_METHODS), 'סכום קבלות'];
        if (options.report === 'vat') return ['מע״מ עסקאות', 'מע״מ תשומות מותר', 'הפרש לתשלום / להחזר'];
        return ['הכנסות לפני מע״מ', 'הוצאות לפני מע״מ', 'עלות הוצאות ניהולית', 'רווח / הפסד ניהולי'];
    }
    function reportComplete(scope) {
        return options.report === 'receipts' ? scope.receiptAmountComplete && scope.paymentBreakdownComplete
            : options.report === 'vat' ? scope.vatComplete : scope.profitComplete;
    }
    function bucketValues(r, b) {
        if (options.report === 'receipts') return [...Object.keys(REPORT_METHODS).map(key => reportMetric(b, 'methods', key)), reportMetric(b, 'receiptsCents')];
        const fields = options.report === 'vat' ? ['outputVatCents', 'inputVatCents', 'vatBalanceCents']
            : ['incomeCents', 'expensesCents', 'expenseCostCents', 'profitCents'];
        return fields.map(field => reportMetric(b, field));
    }
    function table(r) {
        const labels = reportColumns();
        function cells(bucket) {
            const values = bucketValues(r, bucket);
            return values.map((value, index) => `<td data-label="${esc(labels[index])}" class="morning-report-amount ${value < 0 ? 'negative' : ''}"><span>${esc(amount(value))}</span></td>`).join('');
        }
        return `<div class="morning-report-table-wrap">
      <table class="morning-report-table morning-report-summary-table ${options.report === 'receipts' ? 'morning-report-receipts-table' : ''}">
      <caption>${options.report === 'receipts' ? 'תקבולים לפי אמצעי תשלום' : options.report === 'vat' ? 'סיכום מע״מ ניהולי' : 'רווח והפסד ניהולי'} · ${dateLabel(r.fromDate)}–${dateLabel(r.toDate)}</caption>
      <thead>
      <tr>
      <th scope="col">תקופה</th>${labels.map(label => `<th scope="col">${label}</th>`).join('')}<th scope="col">פירוט</th>
      </tr>
      </thead>
      <tbody>${r.buckets.map(bucket => `<tr>
      <th scope="row"><span class="morning-report-period-label">${esc(periodLabel(bucket.key))}</span>${reportComplete(bucket) ? '' : '<small class="morning-report-missing">נתונים חסרים בתקופה</small>'}</th>${cells(bucket)}<td data-label="פירוט">
      <button type="button" class="btn small" data-action="morning-report-detail" data-click-arg0="${esc(bucket.key)}">${bucket.records.length} מסמכים</button>
      </td>
      </tr>`).join('') ||
            `<tr>
      <td colspan="${labels.length + 2}">אין נתונים בתקופה שנבחרה.</td>
      </tr>`}</tbody>
      <tfoot>
      <tr>
      <th scope="row">סה״כ${reportComplete(r.total) ? '' : ' · דורש השלמה'}</th>${cells(r.total)}<td data-label="פירוט">${r.records.length} מסמכים</td>
      </tr>
      </tfoot>
      </table>
      </div>`;
    }
    function recordFields(row) {
        const fields = [
            ['תאריך הדוח / חודש הדיווח', dateLabel(row.reportingDate || row.date)],
            ['תאריך מסמך המקור', dateLabel(row.sourceDocumentDate ?? row.documentDate) || 'לא נמסר'],
            ['נוצר במורנינג', row.createdAt || 'לא נמסר'], ['עודכן במורנינג', row.updatedAt || 'לא נמסר'],
            ['סוג / מספר', `${row.kind === 'expense' ? 'הוצאה' : REPORT_TYPES[row.type] || row.type} ${row.number}`],
            ['לקוח / ספק', row.name], ['תיאור', row.description || '—'], ['מטבע מקור', row.currency],
            ['אמצעי תשלום', Object.entries(row.methods).map(([key, value]) => `${REPORT_METHODS[key]}: ${amount(value)}`).join(' · ') || '—'],
            ['סכום כולל מע״מ בשקלים', amount(row.grossCents)],
            ...(['expense'].includes(row.kind) ? [['עלות הוצאה ניהולית', amount(reportMetric(row, 'expenseCostCents'))],
                ['מע״מ שאינו ניתן לקיזוז', amount(reportMetric(row, 'unrecoverableVatCents'))]] : []),
            ['מע״מ עסקאות', row.kind === 'document' ? amount(rowOutputVat(row)) : '—'],
            ['מע״מ תשומות מותר', row.kind === 'expense' ? amount(reportMetric(row, 'inputVatCents')) : '—'],
            ['סכום מוכר ממורנינג', row.kind === 'expense' ? amount(reportMetric(row, 'deductibleExpensesCents')) : '—'],
            ['סיווג', [row.category, row.categoryKey, row.categoryType == null ? '' : `סוג ${row.categoryType}`].filter(Boolean).join(' · ') || '—'],
            ...row.issues.map(item => ['נתון דורש השלמה', item.label]),
            ...(row.kind === 'expense' ? [['סטטוס במורנינג', EXPENSE_STATUSES[row.status] || String(row.status)]] : []),
        ];
        return `<tr class="morning-report-record-row"><td colspan="5"><dl class="morning-report-record-fields">${fields.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></td></tr>`;
    }
    function detailRows(r) {
        const edited = detail === 'edited-expenses', bucket = r.buckets.find(item => item.key === detail);
        if (!bucket && !edited)
            return '';
        const rows = (edited ? r.records.filter(row => row.kind === 'expense' && row.status === 30) : [...bucket.records]).sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
        detailPage = Math.min(detailPage, Math.max(0, Math.ceil(rows.length / 100) - 1));
        return `<section class="morning-report-details">
      <div class="morning-report-toolbar">
      <h3>${edited ? 'הוצאות שנערכו מחדש' : `מסמכי ${esc(periodLabel(detail))}`}</h3>
      <button type="button" class="btn small" data-action="morning-report-detail" data-click-arg0="">סגירת פירוט</button>
      </div>
      <div class="morning-report-table-wrap">
      <table class="morning-report-table morning-report-source-table">
      <caption>מסמכי המקור · ${rows.length} מסמכים · כל הנתונים זמינים בכפתור „כל הפרטים”</caption>
      <thead>
      <tr>${['תאריך הדוח', 'סוג / מספר', 'לקוח / ספק', 'סכום כולל מע״מ', 'פרטים ומסמך'].map(label => `<th scope="col">${label}</th>`).join('')}</tr>
      </thead>
      <tbody>${rows.slice(detailPage * 100, (detailPage + 1) * 100).map(row => `<tr>
      <td data-label="תאריך הדוח">${esc(dateLabel(row.date))}</td>
      <td data-label="סוג / מספר">${row.kind === 'expense' ? 'הוצאה' : esc(REPORT_TYPES[row.type] || row.type)} ${esc(row.number)}${row.kind === 'expense' && row.status === 30 ? '<small>נערכה מחדש · נכללת בחישוב</small>' : row.status === 4 ? '<small>בוטל; נכלל לצד מסמך הביטול</small>' : ''}</td>
      <td data-label="לקוח / ספק">${esc(row.name)}</td>
      <td data-label="סכום כולל מע״מ" class="morning-report-amount">${esc(amount(row.grossCents))}${row.issues.length ? '<small class="morning-report-missing">יש נתונים חסרים · ראו פרטים</small>' : ''}</td>
      <td data-label="פרטים ומסמך"><div class="morning-report-row-actions">
      <button type="button" class="btn small" data-action="morning-report-record" data-click-arg0="${esc(row.id)}" aria-expanded="${expandedRecord === row.id}">${expandedRecord === row.id ? 'סגירת פרטים' : 'כל הפרטים'}</button>
      ${row.kind === 'document' ? `<button type="button" class="btn small" data-action="morning-report-pdf" data-click-arg0="${esc(row.id)}">צפייה ב־PDF</button>` : '<a class="btn small" href="https://app.greeninvoice.co.il" target="_blank" rel="noopener noreferrer">במורנינג ↗</a>'}
      </div></td>
      </tr>${expandedRecord === row.id ? recordFields(row) : ''}`).join('') ||
            '<tr><td colspan="5">אין מסמכים בתקופה זו.</td></tr>'}</tbody>
      </table>
      </div>${rows.length > 100 ? `<div class="morning-report-toolbar">
      <button class="btn small" data-action="morning-report-detail-page" data-click-arg0="-1" ${detailPage === 0 ? 'disabled' : ''}>הקודם</button>
      <span>עמוד ${detailPage + 1} מתוך ${Math.ceil(rows.length / 100)}</span>
      <button class="btn small" data-action="morning-report-detail-page" data-click-arg0="1" ${(detailPage + 1) * 100 >= rows.length ? 'disabled' : ''}>הבא</button>
      </div>` : ''}</section>`;
    }
    function expenseBreakdown(r) {
        if (options.report !== 'profit' || !loaded.expenses) return '';
        const categories = new Map();
        for (const row of r.records.filter(item => item.kind === 'expense')) {
            const key = row.category || 'ללא סיווג', value = categories.get(key) || {count:0, net:0, vat:0, cost:0, unrecoverable:0, deductible:0,
                netKnown:true, vatKnown:true, costKnown:true, unrecoverableKnown:true, deductibleKnown:true};
            value.count++;
            for (const [field, target] of [['expensesCents', 'net'], ['inputVatCents', 'vat'], ['expenseCostCents', 'cost'],
                ['unrecoverableVatCents', 'unrecoverable'], ['deductibleExpensesCents', 'deductible']]) {
                const metric = reportMetric(row, field);
                const sum = value[target] + (metric ?? 0);
                value[target + 'Known'] &&= metric !== null && Number.isSafeInteger(sum);
                if (Number.isSafeInteger(sum)) value[target] = sum;
            }
            categories.set(key, value);
        }
        if (!categories.size) return '';
        return `<details class="morning-report-explanation"><summary>פירוט הוצאות לפי סיווגי מורנינג</summary>
          <p>הסכומים המוכרים ומע״מ התשומות מוצגים כפי שהתקבלו ממורנינג, ללא השלמת אחוזי הכרה באתר.</p>
          <div class="morning-report-table-wrap"><table class="morning-report-table morning-report-category-table"><thead><tr>
          ${['סיווג', 'מסמכים', 'לפני מע״מ', 'עלות ניהולית', 'מע״מ לא ניתן לקיזוז', 'מע״מ תשומות מותר', 'סכום מוכר ממורנינג'].map(label => `<th scope="col">${label}</th>`).join('')}
          </tr></thead><tbody>${[...categories].sort(([a], [b]) => a.localeCompare(b, 'he')).map(([key, value]) =>
            `<tr><th scope="row">${esc(key)}</th><td data-label="מסמכים">${value.count}</td><td data-label="לפני מע״מ">${amount(value.netKnown ? value.net : null)}</td>
            <td data-label="עלות ניהולית">${amount(value.costKnown ? value.cost : null)}</td><td data-label="מע״מ לא ניתן לקיזוז">${amount(value.unrecoverableKnown ? value.unrecoverable : null)}</td>
            <td data-label="מע״מ תשומות מותר">${amount(value.vatKnown ? value.vat : null)}</td><td data-label="סכום מוכר ממורנינג">${amount(value.deductibleKnown ? value.deductible : null)}</td></tr>`).join('')}
          </tbody></table></div></details>`;
    }
    function results(r) {
        const card = (label, value, sub = '') => `<article class="morning-report-card">
      <span>${label}</span>
      <strong>${esc(amount(value))}</strong>
      <small>${sub}</small>
      </article>`;
        return `<div class="morning-report-toolbar">
      <div>
      <span class="morning-report-badge ${reportComplete(r.total) ? '' : 'partial'}">${reportComplete(r.total) ? 'כל העמודים נקראו' : 'נתונים חלקיים'}</span>
      ${r.toDate >= today ? '<b class="morning-report-badge partial">תקופה פתוחה — נתוני ביניים</b>' : ''}
      ${Object.values(loaded.sourceResults || {}).some(source => source.cacheHit) ? '<span class="morning-report-badge">שימוש חוזר בקריאה מהדקה האחרונה</span>' : ''}
      <span class="morning-report-read-at"> נקרא ב־${esc(new Intl.DateTimeFormat('he-IL', { dateStyle: 'short',
            timeStyle: 'short',
            timeZone: 'Asia/Jerusalem' }).format(new Date(loaded.readAt)))}</span>${loaded.environment === 'sandbox' ? '<b class="morning-report-badge partial">סביבת בדיקה</b>' : ''}</div>
      <button type="button" class="btn small" data-action="morning-report-export">יצוא לאקסל (CSV)</button>
      </div>${r.issues.length ? `<div class="morning-report-warning" role="status">
      <b>הדוח דורש השלמה</b>
      <ul>${r.issues.map(item => `<li>${esc(item.label)}${item.count > 1 ? ` (${item.count})` : ''}</li>`).join('')}</ul>חוסר בנתון מסתיר רק את המדד והתקופה המושפעים. סכום כולל מוצג רק כשהנתונים הדרושים לו שלמים.</div>` : ''}
      ${r.notices.length ? `<div class="morning-report-notice" role="status">
      <b>נתונים עדכניים · ${r.notices[0].count} הוצאות נערכו מחדש</b>
      <p>ההוצאות נכללות ברווח ובהוצאות, ובסיכום המע״מ כאשר סכום התשומות המותר זמין, לפי חודש הדיווח והסכומים העדכניים במורנינג. הסטטוס אינו מציין שחסר סכום.
      יש להשוות מול הדוח הרשמי לתקופה, במיוחד אם כבר דווחה: הסכומים העדכניים עשויים להיות שונים מהדוח שהופק קודם.</p>
      <button type="button" class="btn small" data-action="morning-report-detail" data-click-arg0="edited-expenses">הצגת ההוצאות שנערכו מחדש (${r.notices[0].count})</button>
      <a href="${OFFICIAL}" target="_blank" rel="noopener noreferrer">לבדיקה מול הדוח במורנינג ↗</a></div>` : ''}
      ${loaded.expenses === null && options.report === 'receipts' ? '<p class="morning-report-note">הוצאות נטענות רק במעבר לרווח והפסד או למע״מ. התקבולים מבוססים על מסמכים בלבד.</p>' : ''}
      <div class="morning-report-cards">${card('הכנסות לפני מע״מ', reportMetric(r.total, 'incomeCents'), 'לפי מסמכי הכנסה')}${
        card('עלות הוצאות ניהולית', reportMetric(r.total, 'expenseCostCents'), 'כולל המע״מ שאינו ניתן לקיזוז; לפי חודש דיווח')}${
        card('רווח / הפסד ניהולי', r.profitCents, 'לפני התאמות מס ופחת')}${
        card('סכום קבלות כולל מע״מ', reportMetric(r.total, 'receiptsCents'), r.receiptAmountComplete ? r.receiptsComplete ? 'כולל ניכוי במקור; לפי תאריך מסמך' : 'סכום הקבלות ידוע; פירוט התשלום דורש השלמה' : 'חסר סכום קבלה; הסך הכולל אינו ידוע')}</div>
      ${options.report === 'profit' ? '<p class="morning-report-note">הוצאות לפני מע״מ מוצגות לניתוח. הרווח מחושב לפי עלות ההוצאה: סכום כולל פחות מע״מ תשומות שניתן לקזז, ולכן מע״מ שאינו ניתן לקיזוז נשאר בעלות. כולל רכישות שנרשמו כהוצאות; ללא התאמות מס ופחת.</p>' : ''}
      ${options.report === 'vat' ? `<div class="morning-report-note">מע״מ עסקאות בניכוי מע״מ התשומות המותר שמורנינג מספקת. ההוצאות משויכות לחודש הדיווח. סכום שלילי מציין עודף תשומות. זהו סיכום ניהולי לבדיקה מול הדוח הרשמי, ללא הפקה או הגשה של PCN874.</div>
      <div class="morning-report-cards">${card('מע״מ עסקאות', r.outputVatComplete ? r.total.outputVatCents : null)}${card('מע״מ תשומות מותר', r.inputVatComplete ? r.total.inputVatCents : null)}${card('הפרש לתשלום / להחזר', r.vatBalanceCents)}</div>` : ''}
      ${table(r)}${detailRows(r)}${expenseBreakdown(r)}`;
    }
    function markup() {
        ensureScope();
        const r = report();
        return `<section class="morning-reports" data-morning-reports>
      <div class="morning-report-heading">
      <button type="button" class="morning-report-trigger" data-action="morning-report-toggle" aria-expanded="${expanded}" aria-controls="morningReportBody">
      <span class="morning-report-logo" aria-hidden="true">m</span>
      <span>
      <b>דוחות מורנינג</b>
      <small>תקבולים לפי אמצעי תשלום · רווח והפסד · מע״מ</small>
      </span>
      <span aria-hidden="true">${expanded ? '⌃' : '⌄'}</span>
      </button>
      <a class="btn small" href="${OFFICIAL}" target="_blank" rel="noopener noreferrer">הדוחות הרשמיים במורנינג ↗</a>
      </div>
      <div id="morningReportBody" ${expanded ? '' : 'hidden'}>${controls()}<div class="morning-report-note">ההכנסות והתקבולים מוצגים לפי תאריך המסמך. ההוצאות לפי תאריך הדיווח במורנינג (היום הראשון בחודש), גם בטווח מותאם. בטווח שמתחיל באמצע חודש, הוצאות שדווחו בתחילת אותו חודש אינן נכללות.</div>
      <div class="morning-report-status" role="status" aria-live="polite">${esc(busy ? progressText ||
            'טוען את כל עמודי הדוח…' : reading ? 'ממתין לסיום הבקשה הקודמת…' : error)}</div>
      <div data-morning-report-output>${r ? results(r) : busy ? '' : '<div class="morning-report-empty">בחרו תקופה ולחצו על „הצגת הדוח” לקבלת נתוני העסק ממורנינג.</div>'}</div>
      <details class="morning-report-explanation">
      <summary>הפקת דוחות ודיווחים רשמיים במורנינג</summary>
      <p>במורנינג ניתן להפיק דוחות הכנסות, הוצאות, רווח והפסד, מע״מ, ספר תקבולים ותשלומים ו־PCN874. בחרו שם את התקופה הרצויה; לדיווח דו־חודשי בחרו למשל יולי–אוגוסט. בתיעוד ה־API הציבורי שנבדק אין פעולה להורדת הדוחות הרשמיים, ולכן האתר מציג נתונים ניהוליים ויצוא CSV.</p>
      <p>הפקת דוח הוצאות במורנינג משנה את סטטוס ההוצאות הכלולות למדווח וסוגרת אותן. היצוא והקריאה באתר אינם משנים סטטוס ואינם מגישים דיווח לרשויות.</p>
      <a class="btn small" href="${OFFICIAL}" target="_blank" rel="noopener noreferrer">פתיחת מסך הדוחות הרשמי ↗</a>
      <a href="https://www.greeninvoice.co.il/help-center/vat-report/" target="_blank" rel="noopener noreferrer">הוראות להפקת דוח מע״מ</a> · <a href="https://www.greeninvoice.co.il/help-center/annual-expenses-report/" target="_blank" rel="noopener noreferrer">הוראות להפקת דוח הוצאות</a>
      </details>
      <details class="morning-report-explanation">
      <summary>איך לקרוא את הדוחות</summary>
      <p>זהו דוח ניהולי מנתוני מורנינג. חשבוניות מס, חשבוניות מס/קבלה וזיכויים נכללים בהכנסות; קבלות נכללות בתקבולים, ובעסק פטור או עמותה גם בהכנסות. חשבוניות עצמיות אינן הכנסה. מסמך שבוטל נשמר בחישוב לצד מסמכי הזיכוי והקבלה השלילית, לפי התקופה של כל מסמך.</p>
      <p>הרווח הניהולי מחושב מהכנסות ללא מע״מ פחות עלות הוצאות: הסכום הכולל פחות מע״מ התשומות המותר ממורנינג. המע״מ שאינו ניתן לקיזוז נשאר בעלות. נתון תשומות חסר אינו נחשב אפס או ניכוי מלא. המדד כולל רכישות שנרשמו כהוצאות, ללא התאמות מס, הוצאות מוכרות או פחת; דוח מורנינג הרשמי עשוי להוציא רכוש קבוע מהחישוב.</p>
      <p>סיכום המע״מ מחושב מחודשי דיווח מלאים. מע״מ התשומות הוא הסכום המותר שמורנינג מחזירה, ולא כלל המע״מ בחשבוניות ההוצאה. כאשר סכום זה חסר או קיימות חשבוניות עצמיות, הפרש המע״מ אינו מוצג כהערכה מלאה. דו־חודש זוגי מציג ינואר–פברואר, מרץ–אפריל וכן הלאה.</p>
      <p>התקבולים כוללים מע״מ ומוצגים לפי מועד הקבלה. הם אינם יתרת מזומן או בנק: צ׳קים דחויים ואשראי טרם זיכוי אינם הפקדה בבנק. ניכוי במקור מוצג בנפרד ואינו כסף שהתקבל בקופה. מטבע זר מומר רק כשמורנינג מספקת סכום מקומי או שער מפורש.</p>
      </details>
      </div>
      </section>`;
    }
    function change(key, value) {
        if (!['year', 'part', 'fromDate', 'toDate', 'group'].includes(key))
            return false;
        if (key === 'group') {
            if (!['day', 'month', 'bimonth', 'quarter', 'year'].includes(value))
                return false;
            options.group = value;
            detail = '';
            detailPage = 0;
            render();
            return true;
        }
        const next = { ...options, [key]: ['year', 'part'].includes(key) ? Number(value) : value };
        try {
            if (next.mode !== 'custom')
                Object.assign(next, reportPeriod(next.mode, next.year, next.mode === 'year' ? 1 : next.part));
        }
        catch (failure) {
            error = failure.message;
            render();
            return false;
        }
        clear();
        options = next;
        if (next.mode === 'custom' && ['fromDate', 'toDate'].includes(key)) {
            // The common date editor commits valid intermediate keystrokes.
            // Keep its DOM/focus and let the explicit Load action validate it.
            document.querySelector('[data-morning-report-output]')?.replaceChildren();
            const status = document.querySelector('.morning-report-status');
            if (status) status.textContent = '';
            const button = document.querySelector('[data-action="morning-report-load"]');
            if (button) { button.disabled = reading; button.textContent = 'הצגת הדוח'; }
            return true;
        }
        render();
        return true;
    }
    function setPeriod(mode) {
        if (!['month', 'bimonth', 'quarter', 'year', 'custom'].includes(mode))
            return false;
        clear();
        options.mode = mode;
        if (mode !== 'custom') {
            const span = mode === 'bimonth' ? 2 : mode === 'quarter' ? 3 : mode === 'year' ? 12 : 1;
            options.part = Math.ceil(Number(today.slice(5, 7)) / span);
            options.group = mode === 'bimonth' ? 'bimonth' : 'month';
            Object.assign(options, reportPeriod(mode, options.year, mode === 'year' ? 1 : options.part));
        }
        render();
        return true;
    }
    function load({refresh = false} = {}) {
        if (!tasks.isActive())
            return Promise.resolve(false);
        if (options.mode === 'custom') {
            options.fromDate = document.getElementById('morningReport-fromDate')?.value ?? '';
            options.toDate = document.getElementById('morningReport-toDate')?.value ?? '';
        }
        if (!validReportDate(options.fromDate) || !validReportDate(options.toDate) || options.fromDate > options.toDate || options.toDate > String(Number(options.fromDate.slice(0, 4)) + 10) + options.fromDate.slice(4)) {
            clear();
            error = 'יש לבחור טווח תאריכים תקין של עד עשר שנים.';
            render();
            return Promise.resolve(false);
        }
        ensureScope();
        clear();
        if (refresh) cache.clear();
        let scope;
        try {
            scope = captureRead();
        }
        catch {
            error = 'יש להתחבר לחשבון הענן של העסק כדי לקרוא דוחות מורנינג.';
            render();
            return Promise.resolve(false);
        }
        const ticket = generation, selection = { ...options }, controller = new AbortController();
        activeRead = controller;
        const assertCurrent = () => { scope(); controller.signal.throwIfAborted(); if (!tasks.isActive() || !isActive() || ticket !== generation)
            throw new Error('report_cancelled'); };
        busy = true; reading = true;
        render();
        return tasks.run(async () => {
            try {
                const sources = selection.report === 'receipts' ? ['documents'] : ['documents', 'expenses'];
                const settled = await Promise.allSettled(sources.map(async source => {
                    const query = {source, fromDate:selection.fromDate, toDate:selection.toDate, environment:sourceEnvironment, assertScope:scope};
                    const cached = cache.read(query);
                    if (cached) return cached;
                    return loadMorningReportSource({ request, source, ...selection, assertCurrent, signal:controller.signal,
                        progress: ({ loaded: count, total, page, pages }) => {
                            assertCurrent(); progressText = `${source === 'documents' ? 'מסמכים' : 'הוצאות'}: ${count} מתוך ${total} · עמוד ${page} מתוך ${pages}`;
                            const status = document.querySelector('.morning-report-status');
                            if (status) status.textContent = progressText;
                        } });
                }));
                assertCurrent();
                const errors = [], data = { documents: null, expenses: null }, sourceResults = {};
                let environment = '', readAt = '';
                settled.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        if (environment && environment !== result.value.environment) {
                            cache.clear(); sourceEnvironment = '';
                            throw new Error('מקורות הדוח שייכים לסביבות מורנינג שונות');
                        }
                        environment = result.value.environment;
                        if (!readAt || result.value.readAt < readAt) readAt = result.value.readAt;
                        data[sources[index]] = result.value.items;
                        sourceResults[sources[index]] = result.value;
                    }
                    else
                        errors.push({ source: sources[index], message: `${sources[index] === 'documents' ? 'מסמכים' : 'הוצאות'}: ${result.reason?.message || 'הקריאה נכשלה'}` });
                });
                if (!environment)
                    throw new Error(errors.map(item => item.message).join(' · '));
                for (const source of sources) if (sourceResults[source] && !sourceResults[source].cacheHit)
                    cache.write({source, ...selection, ...sourceResults[source], assertScope:scope});
                sourceEnvironment = environment;
                loaded = { ...data, errors, environment, readAt, sourceResults };
                acceptedScope = scope;
                detail = '';
                detailPage = 0;
                return true;
            }
            catch (failure) {
                if (ticket === generation) {
                    loaded = null;
                    error = failure.message;
                }
                return false;
            }
            finally {
                if (activeRead === controller && ticket === generation) {
                    activeRead = null; reading = false; busy = false; render();
                }
            }
        });
    }
    function exportCsv() {
        ensureScope();
        const r = report();
        if (!r)
            return false;
        const values = b => bucketValues(r, b).map(value => value === null ? '' : value / 100);
        const rows = [['דוח ניהולי ממורנינג',
                reportComplete(r.total) ? 'כל העמודים נקראו; אינו דוח רשמי' : 'נתונים חלקיים',
                loaded.environment],
            ['מתאריך',
                r.fromDate,
                'עד תאריך',
                r.toDate],
            ['בסיס תאריכים',
                'הכנסות ותקבולים לפי מסמך; הוצאות לפי תאריך דיווח'],
            ['רווח ניהולי',
                'הכנסות ללא מע״מ פחות סכום הוצאות כולל בניכוי תשומות מותרות; לפני התאמות מס ופחת, כולל רכישות שנרשמו כהוצאות'],
            ...(r.toDate >= today ? [['מצב התקופה', 'תקופה פתוחה — נתוני ביניים']] : []),
            ...r.issues.map(item => ['חוסר בנתונים',
                item.label,
                item.count]),
            ...r.notices.map(item => ['הערה לנתונים העדכניים', item.label, item.count]),
            ...(r.notices.length ? [['התאמה לדיווח קודם', 'הוצאות שנערכו מחדש נכללות לפי הסכומים העדכניים; יש להשוות לדוח הרשמי שהופק או הוגש']] : []),
            ['תקופה',
                ...reportColumns()],
            ...r.buckets.map(b => [periodLabel(b.key),
                ...values(b)]),
            ['סה״כ',
                ...values(r.total)],
            [],
            ['מסמכי מקור'],
            ['מזהה מקור במורנינג',
                'תאריך הדוח',
                'תאריך מסמך המקור',
                'סוג',
                'מספר',
                'לקוח / ספק',
                'תיאור',
                'סכום כולל מע״מ (ש״ח)',
                'מטבע מקור', 'מע״מ עסקאות', 'מע״מ תשומות מותר', 'סכום מוכר ממורנינג', 'סיווג הוצאה', 'סטטוס במורנינג',
                'עלות הוצאה ניהולית', 'מע״מ לא ניתן לקיזוז', 'נוצר במורנינג', 'עודכן במורנינג', 'נתונים חסרים', 'קוד סיווג מקור'],
            ...r.records.map(row => [row.id,
                row.reportingDate || row.date,
                row.sourceDocumentDate ?? row.documentDate,
                row.kind === 'expense' ? 'הוצאה' : REPORT_TYPES[row.type],
                row.number,
                row.name,
                row.description,
                row.grossCents === null ? '' : row.grossCents / 100,
                row.currency, row.kind === 'document' && rowOutputVat(row) !== null ? row.outputVatCents / 100 : '',
                row.kind === 'expense' && reportMetric(row, 'inputVatCents') !== null ? row.inputVatCents / 100 : '',
                row.kind === 'expense' && reportMetric(row, 'deductibleExpensesCents') !== null ? row.deductibleExpensesCents / 100 : '',
                row.category || '', row.kind === 'expense' ? EXPENSE_STATUSES[row.status] || row.status : row.status,
                row.kind === 'expense' && reportMetric(row, 'expenseCostCents') !== null ? row.expenseCostCents / 100 : '',
                row.kind === 'expense' && reportMetric(row, 'unrecoverableVatCents') !== null ? row.unrecoverableVatCents / 100 : '',
                row.createdAt || '', row.updatedAt || '', row.issues.map(item => item.label).join(' · '), row.categoryKey || ''])];
        const url = URL.createObjectURL(new Blob([reportCsv(rows)], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `morning-${options.report}-${r.fromDate}-${r.toDate}.csv`;
        try { document.body.append(link); link.click(); }
        finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
        return true;
    }
    const actions = {
        'morning-report-toggle': () => { expanded = !expanded; render(); },
        'morning-report-period': element => setPeriod(element.dataset.clickArg0),
        'morning-report-option': element => change(element.dataset.reportOption, element.value),
        'morning-report-load': () => load({refresh:!!loaded}),
        'morning-report-cancel': () => { clear(); render(); },
        'morning-report-type': element => {
            if (!['receipts', 'profit', 'vat'].includes(element.dataset.clickArg0)) return;
            options.report = element.dataset.clickArg0;
            const required = options.report === 'receipts' ? ['documents'] : ['documents', 'expenses'];
            if (reading || loaded && required.some(source => loaded[source] === null)) return load();
            render();
        },
        'morning-report-detail': element => { detail = element.dataset.clickArg0; detailPage = 0; expandedRecord = ''; render(); },
        'morning-report-detail-page': element => { detailPage = Math.max(0, detailPage + Number(element.dataset.clickArg0)); expandedRecord = ''; render(); },
        'morning-report-record': element => { expandedRecord = expandedRecord === element.dataset.clickArg0 ? '' : element.dataset.clickArg0; render(); },
        'morning-report-export': exportCsv,
        'morning-report-pdf': element => { ensureScope(); if (!loaded?.documents?.some(row => row.id === element.dataset.clickArg0))
            return false; return media?.viewDocument(element.dataset.clickArg0); },
    };
    return { markup, actions, runtime: { isPending: () => tasks.isPending() || media?.isPending() === true,
            drain: async () => { await Promise.all([tasks.drain(), media?.drain()]); },
            dispose: () => { if (!tasks.close())
                return false; cache.clear(); clear(); unsubscribe(); media?.dispose(); return true; } } };
}
