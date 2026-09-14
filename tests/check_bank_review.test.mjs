import assert from 'node:assert/strict';
import {applyCheckBankReview,checkBankReviewItems,checkBankReviewMarkup,checkBankStatusMarkup} from '../shared/check-bank-review.js';
import {createDomainsChecksEditor as ordersEditor} from '../netunim-orders/site/assets/js/domains/checks/editor.js';
import {createDomainsChecksEditor as kupaEditor} from '../netunim-kupa/site/assets/js/domains/checks/editor.js';
import {createUiAlertCenter} from '../netunim-orders/site/assets/js/ui/alert-center.js';

const sample=()=>({id:'c1',name:'<script>bad()</script>',account:'ביתי',amount:300,status:'הופקד - במעקב',dueDate:'2026-08-01',depositDate:'2026-08-03',bankMatch:{phase:'deposited',eventId:'17:deposited',transactionId:17,description:'הפק.שיק בסלולר',date:'2026-08-03',amount:1000,checkIds:['c1','c2'],previousStatus:'בקופה',previousDepositDate:null}});
{
  const c=sample();assert.equal(checkBankReviewItems([c]).length,1);
  const html=checkBankReviewMarkup([c]);assert.match(html,/קבוצה של 2 צ׳קים/);assert.match(html,/מאשר את ההתאמה/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
  assert.equal(checkBankReviewMarkup([c],'עסקי'),'');
  assert.equal(applyCheckBankReview([c],c.id,'stale-event','accept'),false);
  assert.equal(applyCheckBankReview([c],c.id,c.bankMatch.eventId,'accept'),true);
  assert.equal(checkBankReviewItems([c]).length,0);assert.equal(c.status,'הופקד - במעקב');
  assert.match(checkBankStatusMarkup(c),/ההתאמה אושרה/);
  c.bankMatch={...c.bankMatch,phase:'missing',eventId:'17:missing:later'};
  assert.equal(checkBankReviewItems([c]).length,1,'a new incident needs its own acknowledgement');
}
{
  const c=sample();assert.equal(applyCheckBankReview([c],c.id,c.bankMatch.eventId,'reject'),true);
  assert.equal(c.status,'בקופה');assert.equal(c.depositDate,null);assert.equal(c.bankAutomationDisabled,true);assert.equal(checkBankReviewItems([c]).length,0);
  const ambiguous={...sample(),bankMatch:{phase:'ambiguous',eventId:'a'}};
  assert.equal(applyCheckBankReview([ambiguous],ambiguous.id,'a','reject'),false);
  assert.doesNotMatch(checkBankReviewMarkup([ambiguous]),/מאשר את ההתאמה/);
}
{
  const c=sample();c.bankMatch={...c.bankMatch,phase:'missing',warning:'batch_missing',remainder:{kind:'reduced',originalAmount:1000,observedAmount:700,missingAmount:300,missingMembers:[{id:'c1',name:'Alice <unsafe>',amount:300,checkNumber:'123'}]}};
  const html=checkBankReviewMarkup([c]);
  assert.match(html,/Alice &lt;unsafe&gt;/);assert.match(html,/ההפקדה המקורית: 1000/);assert.match(html,/נותר מההפקדה: 700/);assert.match(html,/חסר: 300/);
  assert.doesNotMatch(html,/מאשר את ההתאמה/,'absence inferred from a group does not authorize clearance');
}
{
  const c=sample();c.bankMatch={...c.bankMatch,provisional:true,matchMethod:'number',bankItem:{checkNumber:'111',amount:300,bankNumber:'12',branchNumber:'100',accountNumber:'<unsafe>'}};
  const html=checkBankReviewMarkup([c]);
  assert.match(html,/התנועה עדיין ממתינה/);assert.match(html,/מספר השיק והסכום/);assert.match(html,/חשבון &lt;unsafe&gt;/);
  assert.match(html,/3 ימי עסקים בנקאיים נוספים/);assert.doesNotMatch(html,/6 ימים/);
  applyCheckBankReview([c],c.id,c.bankMatch.eventId,'accept');assert.match(checkBankStatusMarkup(c),/זיהוי ראשוני/);
  c.bankMatch={...c.bankMatch,eventId:'completed:new-evidence',provisional:false};
  assert.equal(checkBankReviewItems([c]).length,1,'Final evidence requires its own confirmation');
}
{
  const c=sample();c.bankMatch={phase:'unverified',eventId:'no-bank:c1',date:'2026-08-03',observedDate:'2026-08-05'};
  const html=checkBankReviewMarkup([c]);assert.match(html,/סומן הופקד ידנית/);assert.match(html,/סנכרון מלא מ־2026-08-05/);
  assert.doesNotMatch(html,/undefined|מאשר את ההתאמה/);
}
{
  const c={...sample(),status:'בקופה',bankMatch:{phase:'overdue',eventId:'due:one',date:'2026-08-03',observedDate:'2026-08-05'}};
  const center=createUiAlertCenter({model:{state:{checks:[c]}},financeSnapshot:()=>({})});
  assert.equal(center.currentAlerts('2026-08-05').length,1,'One check must not have duplicate due and bank absence cards');
  applyCheckBankReview([c],c.id,c.bankMatch.eventId,'accept');
  assert.equal(center.currentAlerts('2026-08-06').length,0,'Acknowledging unchanged absence must not resurrect the generic due warning');
  c.bankMatch={...c.bankMatch,phase:'missing',transactionId:17,eventId:'missing:new'};
  assert.match(checkBankReviewMarkup([c]),/נעלמה מתנועות הבנק/);
  assert.equal(center.currentAlerts('2026-08-06').length,1,'A new real disappearance remains visible');
}
for(const create of [ordersEditor,kupaEditor]){
  const c=sample(),model={state:{checks:[c]}},messages=[];
  const editor=create({model,scheduleCheckSave:m=>messages.push(m),saveChecksState:m=>messages.push(m)});
  assert.equal(editor.reviewCheckBank(c.id,c.bankMatch.eventId,'accept'),true);
  assert.equal(messages.length,1);
  assert.equal(editor.reviewCheckBank(c.id,c.bankMatch.eventId,'accept'),false,'duplicate click does not write twice');
}
{
  const center=createUiAlertCenter({model:{state:{checks:[sample()]}},financeSnapshot:()=>({})});
  assert.equal(center.currentAlerts()[0].kind,'check_bank','bank-derived check incidents join the Orders warning center');
}
console.log('PASS check bank review: escaped evidence, account filtering, batch explanation, incident-specific confirmation/rejection and both save queues');
