import {esc} from '../../core/values.js';
import {stateLabels,fileLabels} from './morning-expense-review-view.js';

export function expenseOperationMarkup({operationId,result,busy,queueLength,reconciliationId}){
  return `      ${operationId ? `<div class="morning-expense-toolbar"><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="next"
        ${busy||result?.sourcePending||!result?.verified&&!['not_found','cancelled'].includes(result?.state)?'disabled':''}>${queueLength?'לחשבונית הבאה בתור':'קליטת הוצאה נוספת'}</button></div>` : ''}
      ${operationId ? `<div class="morning-expense-operation"><b>${esc(stateLabels[result?.state] || 'מצב הפעולה טרם אומת')}</b><small>מזהה פעולה: <bdi>${esc(operationId)}</bdi></small><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="status" ${busy ? 'disabled' : ''}>בדיקת מצב היצירה</button>
      ${result?.expenseId ? `<small>מזהה הוצאה ב־Morning: <bdi>${esc(result.expenseId)}</bdi></small>` : ''}
      ${result?.intent ? `<p data-expense-receipt><strong>${result.verified ? 'פרטי ההוצאה שאומתו' : 'פרטי הבקשה המקורית'}</strong>
      ${esc(result.intent.supplierName)} · ${result.intent.documentType === 330 ? 'זיכוי' : 'חשבונית'} ${esc(result.intent.number)} · תאריך ${esc(result.intent.date)} · דיווח ${esc(result.intent.reportingDate?.slice(0, 7))} · סה״כ ${esc(result.intent.amount)} ₪ · מע״מ ${esc(result.intent.vat)} ₪</p>` : '<p>פרטי הפעולה ייקראו מיומן השרת בבדיקת מצב. אין להזין את החשבונית מחדש.</p>'}
      ${result?.state === 'reserved' ? `<button type="button" class="btn" data-action="morning-expense-write" data-expense-command="cancel" ${busy ? 'disabled' : ''}>ביטול בטוח לפני שליחה</button>` : ''}
      ${['pending', 'needs_reconciliation'].includes(result?.state) ? `<label>מזהה הוצאה קיימת לבדיקה מול Morning<input data-expense-field="reconciliationId" data-input="morning-expense-field" value="${esc(reconciliationId)}" ${busy ? 'disabled' : ''}></label><button type="button" class="btn" data-action="morning-expense-write" data-expense-command="reconcile" ${busy ? 'disabled' : ''}>בדיקת התאמה ושחזור</button>` : ''}
      <span>קובץ מקור: ${result?.fileLinked ? fileLabels.file_linked : fileLabels[result?.fileState] || 'טרם אומת'} · אישור ודיווח נבדקים ב־Morning</span></div>` : ''}
`;
}
