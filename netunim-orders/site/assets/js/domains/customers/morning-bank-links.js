import {bankMorningEligibility,bankMorningPrefill} from '../finance/bank-morning.js';
import {createMorningBankLinkForm} from './morning-bank-link-form.js';
import {createMorningBankTransactionLinker} from './morning-bank-transaction-link.js';
import {morningBankTransactionPickerMarkup,renderMorningBankTransactionPicker,syncMorningBankTransactionSelection} from './morning-bank-transaction-picker.js';

// Private composition: scoped form access, existing Bank policy and presentation
// feed the strict workflow. No new Bank data path or financial writer is created.
export function createMorningBankLinks({session,catalog,source,editor,toast}){
  const form=createMorningBankLinkForm({
    source,
    fields:{get:session.field,query:selector=>session.root()?.querySelector(selector)||null,date:editor.date},
    payments:editor.payments,document:editor.document,
  });
  return createMorningBankTransactionLinker({
    session,catalog,form,
    policy:{eligible:row=>bankMorningEligibility(row,'business'),prefill:bankMorningPrefill},
    presentation:{
      panel:()=>morningBankTransactionPickerMarkup({loading:true}),
      exists:()=>!!session.field('morningBankTransactionRows'),query:()=>session.field('morningBankTransactionSearch')?.value||'',
      render:(rows,query,activeTransactionId)=>renderMorningBankTransactionPicker({rows,query,activeTransactionId,root:session.root()}),
      select:transaction=>{syncMorningBankTransactionSelection({transaction,root:session.root()})},
      blur:()=>{session.field('morningBankTransactionSearch')?.blur()},toast,
      error:error=>{console.error('Morning bank transaction picker archive refresh failed',error)},
    },
  });
}
