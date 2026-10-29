import {expenseAmountSanity} from '../../core/morning-expense-amounts.js';
import {esc} from '../../core/values.js';
import {invoiceFormFields} from '../../core/invoice-field-review.js';

const fieldLabels = {number:'מספר חשבונית', date:'תאריך המסמך', net:'לפני מע״מ', vat:'מע״מ מהחשבונית', gross:'כולל מע״מ', description:'תיאור', allocationNumber:'מספר הקצאה, אם נדרש'};

// Field presentation owns adjacent descriptions, accessibility and navigation;
// accounting state and source evidence are supplied by the intake controller.
export function createExpenseFieldReview({host, visible:isVisible, reviewFields, warningsMarkup}) {
  const reviewLabels = {verified:'זוהה במסמך', review:'דורש בדיקה', missing:'לא זוהה', manual:'הושלם ידנית',
    not_required:'לפי פרטי המסמך אין צורך במספר הקצאה', not_applicable:''};
  function reviewSlot(name, field = reviewFields()[name]) {
    const visible = isVisible() && field.status !== 'not_applicable';
    const source = field.sources.some(item => item.page && item.quad?.length === 8);
    const detail=`${reviewLabels[field.status]}. ${name==='number'?'':field.detail||''}`;
    return `<span class="morning-expense-field-review" id="expense-review-${name}" data-expense-review-field="${name}" data-review-status="${field.status}" title="${esc(detail)}" ${visible?'':'hidden'}>
      <span class="morning-expense-sr-only">${esc(detail)}</span>
      ${source ? `<button type="button" data-action="morning-expense-command" data-expense-command="review-source" data-review-source="${field.sourceKey}" aria-label="${esc(fieldLabels[name]||'השדה')}: ${esc(detail)} למקור במסמך" title="${esc(detail)} למקור במסמך">⌖</button>` : '<span class="morning-expense-review-dot" aria-hidden="true">●</span>'}</span>`;
  }
  function updateReview() {
    const fields = reviewFields();
    for (const [name, field] of Object.entries(fields)) {
      const slot = host()?.querySelector(`[data-expense-review-field="${name}"]`); if (!slot) continue;
      slot.outerHTML = reviewSlot(name, field);
      const control = name === 'supplierId' ? host()?.querySelector('[data-expense-field="supplierQuery"]') : host()?.querySelector(`[data-expense-field="${name}"]`);
      const controls = name === 'date' ? host()?.querySelectorAll('.morning-expense-date input:not([type="hidden"]), .morning-expense-date fieldset') || [] : control ? [control] : [];
      for (const input of controls) {input.setAttribute('aria-describedby', `expense-review-${name}`); input.dataset.recognitionStatus = field.status;}
    }
    const warnings = host()?.querySelector('[data-expense-review-warnings]');
    if (warnings) warnings.outerHTML = warningsMarkup();
    const count = Object.values(fields).filter(field => ['missing','review'].includes(field.status)).length;
    const summary = host()?.querySelector('[data-expense-review-count]'); if (summary) summary.textContent = `${count} שדות לבדיקה או השלמה`;
  }
  function focusReview({preventScroll=false}={}) {
    const entries = Object.entries(reviewFields()).filter(([,field]) => ['missing','review'].includes(field.status));
    const current = document.activeElement?.dataset.datePart ? 'date' : document.activeElement?.dataset.expenseField;
    const index = entries.findIndex(([name]) => name === current || name === 'supplierId' && current === 'supplierQuery');
    const name = entries[(index + 1) % entries.length]?.[0];
    const control = name === 'supplierId' ? host()?.querySelector('[data-expense-field="supplierQuery"]') : name === 'date' ? host()?.querySelector('[data-date-part="day"]') : host()?.querySelector(`[data-expense-field="${name}"]`);
    control?.focus({preventScroll}); return !!control;
  }
  function textField(name, draft, disabled, type = 'text') {
    const attrs = disabled ? 'disabled' : '';
    return `<div class="morning-expense-review-input"><label><span class="morning-expense-field-label">${fieldLabels[name]}</span><input
      data-expense-field="${name}" data-${type === 'date' ? 'change' : 'input'}="morning-expense-field"
      type="${type}" ${name === 'number' ? 'maxlength="20"' : ''}
      ${['net', 'vat', 'gross'].includes(name) ? 'inputmode="decimal"' : ''}
      value="${esc(draft[name])}" ${attrs}></label>
      ${Object.hasOwn(invoiceFormFields, name) ? reviewSlot(name) : ''}</div>`;
  }

  return {slot:reviewSlot, update:updateReview, focus:focusReview, textField};
}

export function replaceExpenseSurface(target, markup, afterReplace) {
    const host = () => document.querySelector('[data-morning-expense-intake]');
    const focused = document.activeElement, name = focused?.dataset.expenseField, part = focused?.dataset.datePart;
    const selection = name && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
    const scroller = target.closest('.view-scroll'), top = scroller?.scrollTop, windowTop=window.scrollY, windowLeft=window.scrollX;
    const queueTop=target.querySelector('.morning-expense-queue')?.scrollTop;
    const pdf=target.querySelector('[data-invoice-pdf-viewport]'),pdfTop=pdf?.scrollTop,pdfLeft=pdf?.scrollLeft;
    const command=focused?.dataset.expenseCommand, index=focused?.dataset.expenseIndex;
    target.outerHTML = markup;
    afterReplace();
    const replacement = name ? host()?.querySelector(`[data-expense-field="${name}"]`) : part ? host()?.querySelector(`[data-date-part="${part}"]`) :
      ['choose-file','remove-file'].includes(command)?host()?.querySelector(`[data-expense-command="${command}"][data-expense-index="${index}"]`):null;
    if (replacement && !replacement.disabled && replacement.type !== 'hidden') {
      replacement.focus({preventScroll:true}); if (selection) replacement.setSelectionRange(...selection);
    }
    if (scroller && Number.isFinite(top)) scroller.scrollTop = top;
    const queue=host()?.querySelector('.morning-expense-queue');if(queue&&Number.isFinite(queueTop))queue.scrollTop=queueTop;
    const preview=host()?.querySelector('[data-invoice-pdf-viewport]');if(preview&&Number.isFinite(pdfTop)){preview.scrollTop=pdfTop;preview.scrollLeft=pdfLeft;}
    if(window.scrollY!==windowTop||window.scrollX!==windowLeft)window.scrollTo({top:windowTop,left:windowLeft,behavior:'instant'});
}

export function expenseSanityMessage(draft, rate) {
    const value=expenseAmountSanity(draft,rate);
    if(value.status==='inconsistent')return 'לפני מע״מ ומע״מ אינם מסתכמים לסכום הכולל. יש לבדוק את שלושת הסכומים מול המקור.';
    if(value.status!=='different_rate')return '';
    return `בדיקת סבירות: מע״מ לפי ${value.rate}% הוא ${(value.expectedVatCents/100).toFixed(2)} ₪, הפרש של ${
      (Math.abs(value.differenceCents)/100).toFixed(2)} ₪ מהסכום בטופס. ייתכנו שיעורים מעורבים או עיגולים. סכום המקור לא שונה.`;
  }

export const stateLabels = {reserved:'טרם נשלחה · אפשר לבטל בבטחה', cancelled:'בוטלה לפני שליחה', pending:'נשלחה · טרם אומתה', created_unverified:'נוצרה · אימות הפרטים ממתין', created:'נוצרה והפרטים אומתו', needs_reconciliation:'תוצאה לא ברורה · נדרש בירור ב־Morning', blocked:'הפעולה נחסמה · נדרש בירור'};

export const fileLabels = {not_started:'העלאה טרם התחילה', prepared:'הכנה הושלמה · אפשר להכין מחדש', upload_started:'הנפקת הרשאת העלאה בבדיקה', ticket_issued:'הרשאת העלאה נמסרה · נדרשת בדיקת קישור', file_accepted:'הקובץ התקבל לעיבוד · הקישור טרם אומת', file_linked:'Morning מציגה קובץ מצורף'};


export function expenseQueueMarkup(selected, items, disabled, status=()=> '') {
  const entries = items.map((item,index)=>({item,index}));
  if (!entries.length) return '';
  const attrs = disabled ? 'disabled' : '';
  return `<section class="morning-expense-queue-panel" aria-label="תור מסמכי המקור">
    <h3>תור מסמכי המקור · ${entries.length} קבצים</h3><ol class="morning-expense-queue">
    ${entries.map(({item, index}) => `<li>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="choose-file"
        data-expense-index="${index}" aria-pressed="${item === selected}" ${item===selected?'aria-current="true"':''} ${attrs}>${esc(item.name)}${status(item)?` <span class="morning-expense-approved">${esc(status(item))}</span>`:''}</button>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="remove-file"
        data-expense-index="${index}" aria-label="הסרת ${esc(item.name)} מהתור" ${attrs}>הסרה</button></li>`).join('')}
    </ol></section>`;
}
