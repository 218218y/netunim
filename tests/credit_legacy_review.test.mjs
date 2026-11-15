import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsCreditEditor} from '../netunim-kupa/site/assets/js/domains/credit/editor.js';
import {creditBillingRowsData} from '../shared/credit-billing-cycles.js';
test('legacy comparison requires an explicit decision; archive preserves source and restores financial contribution on reversal',t=>{
  const record={id:'manual',legacyReviewRequired:true,card:'Card',account:'עסקי',transactionDate:'2026-11-01',firstChargeDate:'2026-11-20',totalAmount:100,installments:1,active:true,sourceEvidence:{retained:'original'}};
  const model={state:{credits:[record]}},messages=[],writes=[];
  const values={cAccount:'עסקי',cOwner:'',cCard:'Card',cDesc:'manual',cTx:'2026-11-01',cTotal:'100',cParts:'1',cFirst:'2026-11-20',cActive:'כן',cNote:'',cArchiveNote:''};
  const nodes=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{value}]));nodes.cArchived={checked:true};nodes.cReviewed={checked:false};
  const old=globalThis.document;t.after(()=>{globalThis.document=old});globalThis.document={getElementById:id=>nodes[id]};
  const editor=createDomainsCreditEditor({model,armModalDraftGuard(){},modal(){},nextChargeDate(){},deleteRecord(){},saveState:(_,options)=>writes.push(options),toast:value=>messages.push(value),closeModal(){},dateEditorMarkup(){},setDateValue(){},renderCredit(){}});
  const total=()=>creditBillingRowsData(model.state,{asOf:'2026-11-15'}).filter(row=>row.source==='manual').reduce((sum,row)=>sum+row.amount,0);
  assert.equal(total(),100);editor.saveCredit('manual');assert.equal(writes.length,0);assert.equal(total(),100);
  nodes.cArchiveNote.value='הוחלף בחיוב מנפיק לאחר השוואה';editor.saveCredit('manual');assert.equal(writes.length,0,'unchecked comparison was accepted');
  nodes.cReviewed.checked=true;editor.saveCredit('manual');assert.equal(writes.length,1);assert.equal(total(),0);
  assert.deepEqual(model.state.credits[0].sourceEvidence,record.sourceEvidence);assert.equal(model.state.credits[0].id,'manual');assert.equal(model.state.credits[0].totalAmount,100);
  nodes.cArchived.checked=false;nodes.cArchiveNote.value='החיוב הידני נדרש בחישוב';editor.saveCredit('manual');assert.equal(total(),100);assert.equal(writes.length,2);
});
