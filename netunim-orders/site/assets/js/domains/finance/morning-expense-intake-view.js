import {esc} from '../../core/values.js';
import {expenseFormMarkup,expenseEnvironmentNotice} from './morning-expense-form-view.js';
import {expenseOperationMarkup} from './morning-expense-operation-view.js';
import {expenseQueueMarkup} from './morning-expense-review-view.js';

export function createExpenseIntakeView(readModel) {
  return function markup() {
    const {busy,operationId,environmentChanged,expanded,completionNotice,reporting,catalog,draft,eligibilityFor,
      message,progress,ocr,batch,sources,recent,history,local,pdfPreview,selected,previewUrl,fileAttempted,queue,fileNotice,
      supplierPicker,supplierForm,favorites,sourceExpenses,sanityMessage,vatRate,review,dateEditorMarkup,result,sourceReason,fileQueue,reconciliationId} = readModel();
    const disabled = busy || !!operationId || environmentChanged;

    const {today} = reporting.choices();
    const supplier = catalog?.suppliers.find(row => row.id === draft.supplierId);
    const eligibility = eligibilityFor(supplier);
    return `<section class="morning-expense-intake" data-morning-expense-intake data-keydown="morning-expense-keyboard" data-paste="morning-expense-paste" dir="rtl">
      ${expanded ? `<header class="morning-expense-heading"><h1>קליטת הוצאות ב־Morning</h1><button type="button" class="btn" data-action="morning-expense-back">חזרה למאזן ודוחות</button></header>` : `<button type="button" class="morning-expense-trigger" data-action="morning-expense-toggle" aria-expanded="false"><b>קליטת הוצאות ב־Morning</b><span>←</span></button>`}
      ${expanded&&completionNotice?`<p class="morning-expense-notice" role="status" data-expense-completed>${esc(completionNotice)}</p>`:''}
      ${expanded ? `<div class="morning-expense-content"><div class="morning-expense-toolbar">
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="load" ${busy ? 'disabled' : ''}>${catalog ? 'רענון ספקים וסיווגים' : busy ? 'טוען ספקים וסיווגים…' : 'ניסיון טעינה נוסף'}</button>
      <a href="${catalog?.capabilities.environment === 'sandbox' ? 'https://app.sandbox.d.greeninvoice.co.il' : 'https://app.greeninvoice.co.il'}" target="_blank" rel="noopener noreferrer">פתיחת Morning</a></div>
      ${expenseEnvironmentNotice(catalog?.capabilities) ? `<p class="morning-expense-notice">${esc(expenseEnvironmentNotice(catalog?.capabilities))}</p>` : ''}${ocr.markup()}
      <p class="morning-expense-status" role="status" aria-live="polite" data-expense-message>${esc(busy ? 'הפעולה מתבצעת…' : message)}</p>
      ${!catalog?.capabilities.backgroundQueue?progress.markup():''}
      ${catalog ? `<div class="morning-expense-workspace"><div class="morning-expense-fields">
      <h2 class="morning-expense-panel-title">פרטי ההוצאה</h2>
      ${!operationId ? expenseFormMarkup({model:{disabled,busy,draft,supplierMarkup:supplierPicker.markup(disabled),supplierCreateMarkup:supplierForm.markup(disabled),
        supplier,eligibility,catalog,favorites,expenses:sourceExpenses(),today,selected,ocrActive:ocr.active(),localBlocked:local.blocked(),
        sanity:sanityMessage(),rate:vatRate(),warnings:local.warningsMarkup(supplier?.taxId,draft),approvedCount:batch.count(),batchPaused:batch.paused(),
        approved:batch.label(selected)==='מאושרת לשליחה'},review,reporting,dateEditorMarkup}) : ''}
      ${expenseOperationMarkup({operationId,result,busy,queueLength:queue.length,reconciliationId})}
      ${sources.receipt(result,busy,sourceReason)}
      ${result?.verified&&result.sourcePending&&result.sourceRetryGeneration?`<button type="button" class="btn" data-action="morning-expense-write" data-expense-command="source-retry" ${busy?'disabled':''}>צירוף המקור מחדש לאותה הוצאה</button>`:''}
      </div><div class="morning-expense-source ${selected?'':'morning-expense-source-empty'}" data-drop="morning-expense-drop" data-dragover="morning-expense-dragover">
      <h2 class="morning-expense-panel-title">מסמך המקור</h2>
      <label class="morning-expense-drop ${selected?'compact':''}"><span>בחירת קובצי מקור · גרירה או הדבקה</span>${selected?'':'<span class="morning-expense-drop-hint">בחרו חשבוניות להצגה ולזיהוי לצד הטופס</span>'}<input type="file" aria-label="בחירת קובצי מקור להוצאה" ${operationId?'':'multiple'} accept="application/pdf,image/jpeg,image/png"
        data-change="morning-expense-files" ${busy||environmentChanged||fileAttempted&&!result?.sourcePending||operationId&&!result?.verified?'disabled':''}></label>
      <small>PDF, JPG או PNG עד 20MB לקובץ · הקבצים נשארים בזיכרון עד להעלאה. ${queue.length ? `${queue.length} נוספים בתור` : ''}</small>
      <p class="morning-expense-notice" role="status" data-expense-file-notice ${fileNotice?'':'hidden'}>${esc(fileNotice)}</p>
      ${local.markup()}
      ${selected ? `<b>${esc(selected.name)}</b>${selected.type === 'application/pdf' ? pdfPreview.markup() : `<img src="${esc(previewUrl)}" alt="חשבונית מקור לבדיקה">`}` : '<p>בחר קובץ להצגתו לצד השדות.</p>'}
      ${expenseQueueMarkup(selected, fileQueue.items(selected,queue), disabled || fileAttempted, batch.label)}
      ${result?.verified&&result.sourcePending ? `<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="file-status" ${busy?'disabled':''}>המשך בדיקה והשלמת המקור</button>`:''}</div></div>${batch.markup(disabled)}${catalog.capabilities.backgroundQueue?progress.markup():''}${sources.markup()}${recent.markup()}${history.markup()}` : ''}</div>` : ''}</section>`;
  };
}
