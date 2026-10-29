import {esc} from '../../core/values.js';
import {expenseDraftProblem} from './morning-expense-submit.js';

export function expenseFormMarkup({model,review,reporting,dateEditorMarkup}){
  const {disabled,draft,supplier,eligibility,catalog,favorites,expenses,today,selected,ocrActive,localBlocked,sanity,rate,warnings,approvedCount,batchPaused,approved,supplierMarkup}=model;
  const attrs=disabled?'disabled':'';
  const problem=expenseDraftProblem({draft,classification:expenses.find(row=>row.id===draft.classificationExpenseId)?.classification,today,capabilities:catalog.capabilities});
  const unavailable=disabled||ocrActive||localBlocked||!catalog.capabilities.create||selected&&!catalog.capabilities.upload||!eligibility.eligible||draft.pcnClassification==='P'&&(!catalog.capabilities.pcnP||!eligibility.p);
    const option = (value, label, current, unavailable = false) => `<option value="${esc(value)}" ${String(current) === String(value) ? 'selected' : ''} ${unavailable ? 'disabled' : ''}>${esc(label)}</option>`;
  return `
      <div class="morning-expense-supplier-row"><div class="morning-expense-supplier-field">${supplierMarkup}${review.slot('supplierId')}</div>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="favorite" ${disabled || !supplier ? 'disabled' : ''}>${favorites.some(row => row.id === draft.supplierId) ? 'הסרה מהמועדפים' : 'הוספה למועדפים שלי'}</button></div>
      ${supplier && !eligibility.eligible ? `<small>${esc(eligibility.reason)}</small>` : ''}
      ${favorites.length ? `<div class="morning-expense-toolbar">${favorites.map(row => `<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="use-favorite" data-expense-supplier="${esc(row.id)}" ${attrs}>${esc(row.name)}</button>`).join('')}</div>` : ''}
      <div class="morning-expense-pair morning-expense-classification"><label>סיווג מהוצאות קיימות<select data-expense-field="classificationExpenseId" data-change="morning-expense-field" ${attrs}>${option('', 'בחר סיווג', draft.classificationExpenseId)}${catalog.classifications.map(row => option(row.sourceExpenseId, row.title, expenses.find(item => item.id === draft.classificationExpenseId)?.classification?.id === row.id ? row.sourceExpenseId : '')).join('')}</select></label>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="more-classifications" ${disabled || catalog.expensePage.page + 1 >= catalog.expensePage.pages || catalog.expensePage.page >= 19 ? 'disabled' : ''}>חיפוש סיווגים בהוצאות נוספות</button></div>
      <small>הצעות מתוך ${catalog.expenses.length} הוצאות בטווח ${esc(catalog.fromDate)}–${esc(catalog.toDate)}. הרשימה אינה קטלוג מלא. אחוזי ההכרה מנוהלים ב־Morning.</small>
      <div class="morning-expense-reporting">${reporting.markup(disabled)}
      <div class="morning-expense-review-input"><label><span class="morning-expense-field-label">סוג מסמך</span><select data-expense-field="documentType" data-change="morning-expense-field" ${attrs}>${option('', 'בחר סוג מסמך', draft.documentType)}${option(305, 'חשבונית מס', draft.documentType)}${option(330, 'חשבונית זיכוי', draft.documentType)}${option(320, 'חשבונית מס קבלה', draft.documentType)}</select></label>${review.slot('documentType')}</div>
      <label>סוג דיווח<select data-expense-field="pcnClassification" data-change="morning-expense-field" ${attrs}>${option('T', 'רגיל · T', draft.pcnClassification)}${option('P', 'חשבונית P', draft.pcnClassification)}</select></label></div>
      ${draft.pcnClassification === 'P' ? `<p class="morning-expense-notice">${catalog.capabilities.pcnP ? 'חשבונית P: הספק וסיווג P מאומתים בשמירה. המע״מ נשאר לפי מסמך המקור ומספר החשבונית מושלם לתשע ספרות.' : 'חשבונית P: המע״מ נשאר לפי מסמך המקור. קליטת P באתר טרם הופעלה לחשבון זה.'}</p>` : ''}
      <div class="morning-expense-pair morning-expense-invoice">${review.textField('number', draft, disabled)}<div class="morning-expense-date"><span>תאריך החשבונית</span><fieldset ${attrs}>
      ${dateEditorMarkup('morningExpenseDate', draft.date, {label:'תאריך החשבונית', compact:true, maxDate:today,
        change:'morning-expense-field', data:{'expense-field':'date'}})}</fieldset>${review.slot('date')}</div></div>
      <input type="hidden" data-expense-field="reportingDate" value="${esc(draft.reportingDate)}">
      <div class="morning-expense-amounts">${review.textField('net', draft, disabled)}${review.textField('vat', draft, disabled)}${review.textField('gross', draft, disabled)}</div>
      <p class="morning-expense-notice" data-expense-sanity ${sanity?'':'hidden'}>${esc(sanity)}</p>
      <small>הקלדת סה״כ מחשבת לפני מע״מ ומע״מ לפי ${rate}%. אפשר לתקן לפי מסמך המקור. זיכוי מוקלד בסכומים חיוביים.</small>
      <div class="morning-expense-pair">${review.textField('description', draft, disabled)}${review.textField('allocationNumber', draft, disabled)}</div>
      ${selected ? '<div class="morning-expense-toolbar"><span data-expense-review-count></span><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="review-next">לשדה הבא לבדיקה</button></div>' : ''}
      <div class="morning-expense-toolbar"><button type="button" class="btn primary" data-action="morning-expense-save"
        ${catalog.capabilities.backgroundQueue&&selected?'data-expense-approve-control="save"':''}
        ${unavailable||catalog.capabilities.backgroundQueue&&selected&&(problem||batchPaused)?'disabled':''}>
        ${ocrActive ? 'טיוטת OCR · יש לאשר במורנינג' : selected?'שמירת ההוצאה וה־PDF ומעבר לבאה':catalog.capabilities.environment === 'production' ? 'בדיקה ושמירת הוצאה ב־Morning' : 'בדיקה ושמירה ב־Sandbox'}</button>
        ${selected&&catalog.capabilities.backgroundQueue?`<button type="button" class="btn" data-action="morning-expense-batch-mark" data-expense-approve-control="mark" ${unavailable||problem?'disabled':''}>סמן אישור ומעבר להוצאה הבאה</button>
          ${approved?'<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="batch-unmark">ביטול סימון האישור</button>':''}
          ${approvedCount?`<button type="button" class="btn" data-action="morning-expense-batch-send" ${disabled||batchPaused?'disabled':''}>שמירת כל ההוצאות המאושרות (${approvedCount})</button>`:''}`:''}</div>
      ${selected&&catalog.capabilities.backgroundQueue?`<p class="morning-expense-notice" data-expense-approval-problem role="alert" ${problem?'':'hidden'}>${esc(problem)}</p>`:''}
      ${warnings}`;
}
