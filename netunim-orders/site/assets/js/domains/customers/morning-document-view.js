// @ts-check
/** @typedef {import('./morning-debt-application.js').ApplicationContext} DecisionContext */
/** @typedef {import('./morning-debt-application.js').FinancialSnapshot} FinancialSnapshot */
/** @typedef {{customerName?:unknown,amount?:unknown,orderNumber?:unknown,taxId?:unknown,email?:unknown,phone?:unknown,description?:unknown,remarks?:unknown}} MorningPrefill */
/** @typedef {{generation:number,kind:string,dates:{document:string,due:string},panels:{bankTransactions:string,bankDebts:string,debtUpdate:string,payments:string}}} FormPresentation */
/** @typedef {{state?:string|undefined,verified_at?:string|undefined,document_id?:unknown,document_number?:unknown,allocation_number?:unknown}} OperationPresentation */
// Inputs are readonly presentation data and ready markup from sibling views.
// This module has no model, DOM, time, persistence or provider authority.
/** @type {Readonly<Record<number,string>>} */
export const DOCUMENT_TYPES = Object.freeze({ 305: 'חשבונית מס', 320: 'חשבונית מס / קבלה', 400: 'קבלה' });
const DOCUMENT_TYPE_ORDER = Object.freeze([320, 305, 400]);
export const DEFAULT_DOCUMENT_TYPE = 320;
/** @param {unknown} type */
export function documentLabel(type) {
    return DOCUMENT_TYPES[Number(type)] || `מסמך ${Number(type) || ''}`;
}
/** @param {unknown} value @param {number} max */
function cleanText(value, max = 250) {
    return String(value ?? '').trim().slice(0, max);
}
/** @param {MorningPrefill} d @param {string} kind */
function defaultDescription(d, kind = 'standalone') {
    if (kind === 'standalone') return '';
    if (kind === 'bank') return cleanText(d?.description, 250) || `תקבול בנקאי מ${cleanText(d?.customerName, 120) || 'לקוח'}`;
    return `עבור ${cleanText(d?.customerName, 120) || 'לקוח'}`;
}
/** @param {{
 * format:{esc:(value:unknown)=>string,money:(value:number)=>string},
 * financial:{changes:(before:FinancialSnapshot|undefined,current:FinancialSnapshot)=>{payment:boolean,invoice:boolean,changed:boolean}}
 * }} ports */
export function createMorningDocumentView({ format: { esc, money }, financial: { changes: morningFinancialChanges } }) {
    /** @param {{id:unknown}} d @returns {string} */
    function morningDocumentButton(d) {
        return `<button class="icon-btn morning-document-button" title="הפק מסמך ב-Morning" aria-label="הפק מסמך ב-Morning" data-action="open-morning-document" data-click-arg0="${esc(d.id)}"><span aria-hidden="true">▤</span></button>`;
    }
    /** @param {Pick<FinancialSnapshot,'paymentApplied'|'invoiceApplied'>} progress @returns {string} */
    function morningDebtUpdateMarkup(progress) {
        const existing = [];
        if (progress.paymentApplied > 0)
            existing.push(`בחוב כבר רשום תשלום בסך ${money(progress.paymentApplied)}`);
        if (progress.invoiceApplied > 0)
            existing.push(`בחוב כבר רשום סכום חשבוניות בסך ${money(progress.invoiceApplied)}`);
        return `<div id="morningDebtUpdatePanel" class="morning-form-card morning-debt-update-panel">
    <div class="morning-section-title"><span>עדכון החוב המקומי לאחר אימות</span><small>הבחירה כאן אינה נשלחת ל-Morning</small></div>
    <div class="morning-debt-update-options">
      <label id="morningApplyPaymentOption" class="morning-debt-update-option"><input id="morningApplyPayment" type="checkbox" checked><span><b>זקוף כתשלום לחוב</b><small>הסכום המאומת יקוזז מיתרת התשלום בלבד</small></span></label>
      <label id="morningApplyInvoiceOption" class="morning-debt-update-option"><input id="morningApplyInvoice" type="checkbox" checked><span><b>זקוף כחשבונית לחוב</b><small>הסכום המאומת יקוזז מיתרת החשבונית בלבד</small></span></label>
    </div>
    <div class="morning-debt-update-warning"><b>מניעת רישום כפול:</b> אם התשלום או החשבונית כבר נרשמו ידנית בחוב, או שסכום החוב כבר הוקטן ידנית בעקבותיהם, בטל את הסימון המתאים.${existing.length ? `<br><strong>${esc(existing.join(' · '))}</strong>` : ''}</div>
  </div>`;
    }
    /** @param {MorningPrefill} d @param {number} type @param {FormPresentation} view @returns {string} */
    function morningFormMarkup(d, type, { kind, generation, dates, panels }) {
        const standalone = kind === 'standalone', bank = kind === 'bank';
        const amountValue = Number(d?.amount);
        const amountInput = Number.isFinite(amountValue) && amountValue > 0 ? amountValue.toFixed(2) : '';
        const formHint = standalone ? 'הזן את פרטי הלקוח והמסמך. המסמך אינו יוצר חוב ואינו תלוי ברשומת חוב.' : bank ? 'הפרטים מולאו מתנועת הבנק. תקבולים שמקורם בבנק נשמרים כנתוני מקור; בהפקדת כמה צ׳קים אפשר להסיר צ׳ק שאינו שייך למסמך ולהוסיף תקבולים נוספים.' : 'הפרטים נלקחים מהחוב וניתנים לעריכה לפני ההפקה';
        const allowedTypes = bank ? [320, 400] : DOCUMENT_TYPE_ORDER;
        return `<div class="morning-document-dialog" data-morning-generation="${generation}">
    <div id="morningRecoveryDecision" hidden></div>
    <div class="morning-type-picker" role="group" aria-label="סוג מסמך">
      ${allowedTypes.map(value => { const label = DOCUMENT_TYPES[value]; return `<label class="morning-type-option"><input type="radio" name="morningDocumentType" value="${value}" data-change="morning-document-type" ${Number(value) === Number(type) ? 'checked' : ''}><span><b>${esc(label)}</b><small>${Number(value) === 305 ? 'חיוב ללא תקבול' : Number(value) === 320 ? 'חשבונית ותקבול במסמך אחד' : 'תקבול כנגד חשבונית/חיוב'}</small></span></label>`; }).join('')}
    </div>
    ${panels.bankTransactions}${panels.bankDebts}<div id="morningDebtUpdateHost">${panels.debtUpdate}</div>
    <div class="morning-form-card">
      <div class="morning-section-title"><span>פרטי המסמך</span><small>${formHint}</small></div>
      <div class="form-grid morning-document-fields">
        <div class="field morning-client-name-field"><label>שם לקוח</label><input id="morningClientName" maxlength="160" value="${esc(d.customerName || '')}"></div>
        <div class="field morning-document-amount-field"><label>סכום כולל מע״מ</label><input id="morningAmount" class="number-input" data-input="morning-document-amount" type="number" min="0" step="1" value="${esc(amountInput)}" placeholder="0.00"></div>
        <div class="field morning-order-field"><label>מספר הזמנה <small>(רשות)</small></label><input id="morningOrderNumber" maxlength="80" value="${esc(d.orderNumber || '')}"></div>
        <div class="field morning-client-tax-field"><label>ת.ז / מספר עוסק <small>(רשות)</small></label><input id="morningClientTaxId" inputmode="numeric" maxlength="9" value="${esc(d.taxId || '')}"></div>
        <div class="field morning-document-date-field"><label>תאריך מסמך</label>${dates.document}</div>
        <div class="field morning-due-date-field" data-document-kind="305"><label>לתשלום עד <small>(רשות)</small></label>${dates.due}</div>
        <div class="field morning-client-email-field"><label>אימייל <small>(רשות · שליחה אוטומטית ללקוח)</small></label><input id="morningClientEmail" type="email" maxlength="180" value="${esc(d.email || '')}"></div>
        <div class="field morning-client-phone-field"><label>טלפון <small>(רשות)</small></label><input id="morningClientPhone" inputmode="tel" maxlength="50" value="${esc(d.phone || '')}"></div>
        <div class="field full morning-description-field"><label>תיאור במסמך</label><input id="morningDescription" maxlength="250" value="${esc(d.description || defaultDescription(d, kind))}"></div>
        <div class="field full morning-remarks-field"><label>הערות במסמך <small>(רשות)</small></label><textarea id="morningRemarks" maxlength="500" rows="2" placeholder="הערה שתופיע במסמך ב-Morning">${esc(d.remarks || '')}</textarea></div>
      </div>
      <div class="morning-allocation-note"><b>חשבוניות ישראל</b><span>Morning מטפלת במספר הקצאה אוטומטית כאשר החיבור לרשות המסים פעיל והמסמך עומד בתנאים. לא בכל חשבונית נדרש מספר; ללקוח עסקי חשוב להזין מספר עוסק / ח.פ.</span></div>
    </div>
    ${panels.payments}
    <div id="morningLinkedDocumentPanel" class="morning-form-card" hidden><div class="morning-section-title"><span>קישור לחשבונית מס קיימת</span><small>בקבלה ניתן לקשר לחשבונית שהופקה קודם</small></div><div class="field"><label>חשבונית לקישור <small>(רשות)</small></label><select id="morningLinkedDocument"><option value="">ללא קישור</option></select><button class="btn small" data-action="morning-invoice-picker">חפש חשבונית ב-Morning</button><div id="morningInvoicePicker" hidden></div></div></div>
    <div id="morningPreviewBox" class="morning-preview-box" hidden><div class="morning-preview-head"><b>תצוגה מקדימה</b><span id="morningPreviewNote">הקובץ עדיין לא הופק רשמית</span></div><iframe id="morningPreviewFrame" title="תצוגה מקדימה של מסמך Morning"></iframe></div>
    <div id="morningOperationResult" aria-live="polite"></div><button class="btn small" data-action="morning-reconcile">בדוק מצב הפקה</button>
  </div>`;
    }
    /** @returns {string} */
    function morningFormFoot() { return `<button class="btn primary" data-action="morning-create" disabled>הפק מסמך רשמי</button><button class="btn" data-action="morning-preview">תצוגה מקדימה</button><button class="btn" data-action="close-modal">סגור</button>`; }
    /** @param {DecisionContext} context @param {FinancialSnapshot} current @param {FinancialSnapshot} displayedCurrent @returns {string} */
    function morningRecoveryDecisionMarkup(context, current, displayedCurrent = current) {
        const changes = morningFinancialChanges(context.financialSnapshot, current), saved = context.resolution;
        const reviewed = saved && !morningFinancialChanges(saved.financialSnapshot, current).changed;
        const summary = /** @param {FinancialSnapshot|undefined} value */ /** @param {FinancialSnapshot|undefined} value */ value => value ? `סכום החוב: ${money(value.amount)} · שולם: ${money(value.paymentApplied)} (${value.paymentComplete ? 'מלא' : 'לא מלא'}) · חשבוניות: ${money(value.invoiceApplied)} (${value.invoiceComplete ? 'מלא' : 'לא מלא'})` : 'לא נשמר צילום מצב בניסיון ההפקה הישן. נדרש אישור מפורש.';
        const option = /** @param {string} kind @param {string} label @param {boolean} supported @param {boolean} checked */ (kind, label, supported, checked) => supported ? `<label class="morning-debt-update-option"><input id="morningRecovery${kind}" type="checkbox" data-change="morning-recovery-choice" ${checked ? 'checked' : ''}><span>${label}</span></label>` : '';
        return `<section class="morning-form-card"><h4>נדרשת הכרעה לפני עדכון החוב</h4><p>${esc(documentLabel(context.type))} בסך <b>${money(context.amount)}</b>. ייתכן שהתשלום או החשבונית כבר נרשמו ממחשב אחר. אין זקיפה אוטומטית לפי סכומים.</p><p><b>בזמן ההפקה:</b> ${summary(context.financialSnapshot)}</p><p><b>המצב הנוכחי לאחר סנכרון:</b> ${summary(displayedCurrent)}</p><div class="morning-debt-update-options">${option('Payment', 'זקוף כתשלום', context.type !== 305, reviewed ? saved.applyPayment : context.applyPayment && !changes.payment)}${option('Invoice', 'זקוף כחשבונית', context.type !== 400, reviewed ? saved.applyInvoice : context.applyInvoice && !changes.invoice)}</div><p>בצד שהשתנה הסימון כבוי כברירת מחדל. סמן אותו רק אם מסמך Morning מייצג סכום נוסף שעדיין לא נרשם. הבחירות נשמרות; זקיפה תבוצע רק לאחר אישור מפורש ורענון ענן מוצלח.</p><button class="btn primary" data-action="morning-recovery-confirm">אשר את הבחירות ועדכן את החוב</button><p id="morningRecoveryChoiceStatus" role="status"></p></section>`;
    }
    /** @param {OperationPresentation|null} op @returns {string|null} */
    function morningOperationMarkup(op) {
        if (op?.state === 'reserved') {
            return '<div class="morning-form-card"><b>פעולת ההפקה נרשמה בשרת אך טרם נשלחה ל-Morning</b><span>לא שולחים מחדש מתוך הטופס המשוחזר. לחץ „בדוק מצב הפקה” כדי לבטל את ההזמנה המוקדמת בבטחה ואז להפיק מחדש.</span></div>';
        }
        if (op?.state === 'created_unverified') {
            return `<div class="morning-form-card"><b>Morning החזירה מזהה למסמך ${esc(op.document_number || '')}, אך האימות החוזר עדיין לא הושלם</b><span>לא מפיקים שוב. יש ללחוץ „בדוק מצב הפקה”.</span></div>`;
        }
        if (op?.state !== 'created' || !op?.verified_at)
            return null;
        return `<div class="morning-form-card"><b>המסמך הופק ואומת ב-Morning ${esc(op.document_number || '')}</b><span class="morning-allocation">מספר הקצאה: ${esc(op.allocation_number || '—')}</span><button class="btn small" data-action="morning-open-document" data-click-arg0="${esc(op.document_id)}">צפה</button></div>`;
    }
    return { documentButton: morningDocumentButton, foot: morningFormFoot, form: morningFormMarkup, debt: morningDebtUpdateMarkup, decision: morningRecoveryDecisionMarkup, operation: morningOperationMarkup };
}
