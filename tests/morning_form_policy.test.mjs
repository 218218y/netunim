import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createMorningDocumentView} from '../netunim-orders/site/assets/js/domains/customers/morning-document-view.js';
import {esc} from '../netunim-orders/site/assets/js/core/values.js';
import {money} from '../netunim-orders/site/assets/js/core/money.js';
import {morningFinancialChanges} from '../netunim-orders/site/assets/js/domains/customers/morning-debt-recovery.js';
const {form:morningFormMarkup,debt:morningDebtUpdateMarkup,decision:morningRecoveryDecisionMarkup,foot:morningFormFoot,documentButton:morningDocumentButton,operation:morningOperationMarkup}=createMorningDocumentView({format:{esc,money},financial:{changes:morningFinancialChanges}});
import {morningFormPolicyCases} from './morning_form_policy_cases.mjs';
import {declaration} from './bank_policy_ast_fixture.mjs';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/morning-form-policy.json',import.meta.url),'utf8'));
test('207 form, allocation defaults and verified-operation views preserve the immutable presentation policy',()=>{
  const outputs=morningFormPolicyCases({form:(prefill,type,kind)=>{
    const documentDate=String(prefill.date??'').trim().slice(0,10)||'2026-10-14';
    const form=morningFormMarkup(prefill,type,{generation:7,kind,dates:{document:`<date id="morningDocumentDate" value="${documentDate}"/>`,due:'<date id="morningDueDate" value=""/>'},panels:{bankTransactions:'<bank-transaction/>',bankDebts:'<bank-debt/>',debtUpdate:morningDebtUpdateMarkup({paymentApplied:0,invoiceApplied:0}),payments:'<payments/>'}});
    // The Chromium form test covers the new controls. Preserve the archived
    // projection for the existing recipient input and every financial field.
    return form.replace(/<section id="morningEmailLookup"[\s\S]*?<\/section>\n        /, '')
      .replace(/(<div class="field morning-client-email-field">)\s*<label for="morningClientEmail">([^<]*(?:<small>[^<]*<\/small>)?)<\/label>\s*<div class="morning-email-field-row">\s*(<input id="morningClientEmail" type="email") dir="ltr"([^>]*>)\s*<button[^>]*>[^<]*<\/button>\s*<\/div>\s*<\/div>/, '$1<label>$2</label>$3$4</div>');
  },debt:morningDebtUpdateMarkup,decision:morningRecoveryDecisionMarkup,foot:morningFormFoot,button:morningDocumentButton,operation:morningOperationMarkup});
  assert.equal(outputs.length,baseline.cases);assert.equal(createHash('sha256').update(JSON.stringify(outputs)).digest('hex'),baseline.digest,'presentation drift from '+baseline.commit);
});
test('the readonly presentation module has no raw model, DOM, provider, clock or persistence ports',()=>{
  const source=readFileSync(new URL('../netunim-orders/site/assets/js/domains/customers/morning-document-view.js',import.meta.url),'utf8');
  assert.equal(declaration(source,'createMorningDocumentView').params[0].properties.length,2);
  for(const name of ['customerDebts','localStorage','document.query','request.json','commitSave','setTimeout','new Date','currentField','captureScope','markModalDraftSaved'])assert.equal(source.includes(name),false);
});
