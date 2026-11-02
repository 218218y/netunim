import {createMorningRequest} from '../integrations/morning.js';
import {createMorningExpenseIntake} from '../domains/finance/morning-expense-intake.js';
import {createExpenseRequest} from '../integrations/morning-expenses.js';
import {validateExpenseFile, uploadExpenseFile} from '../platform/morning-expense-files.js';

// This entire composition is loaded only when its panel is first opened.
export function createFinanceMorningExpenses({auth, morningOperationScope, confirmDialog, dateEditorMarkup, toast, isActive, back}) {
  return createMorningExpenseIntake({request:createExpenseRequest({supaFetch:(...args) => auth.supaFetch(...args)}),
    captureRead:() => morningOperationScope.captureRead(), captureWrite:() => morningOperationScope.capture(),
    accountId:() => auth.getAccountScope()?.owner, subscribeAccountScope:listener => auth.subscribeAccountScope(listener),
    confirmDialog, dateEditorMarkup, toast, reportRequest:createMorningRequest({supaFetch:(...args)=>auth.supaFetch(...args),operationScope:morningOperationScope}).json, files:{validate:validateExpenseFile, upload:uploadExpenseFile,
      extract:async(file,options)=>(await import('../domains/finance/invoice-pdf.js')).extractInvoicePdf(file,options),
      split:async(file,pages,options)=>(await import('../domains/finance/invoice-pdf-split.js')).splitInvoicePdf(file,pages,options),
      recognize:async(extraction)=>(await import('../core/invoice-recognition.js')).recognizeInvoice(extraction)}, isActive, onBack:back});
}
