import assert from 'node:assert/strict';
import {applyCheckBankReview,checkBankReviewItems,checkBankReviewMarkup,checkBankStatusMarkup,checkBankActivityMarkup,checkBankFrontImageMarkup} from '../shared/check-bank-review.js';
import {createDomainsChecksEditor as ordersEditor} from '../netunim-orders/site/assets/js/domains/checks/editor.js';
import {createDomainsChecksEditor as kupaEditor} from '../netunim-kupa/site/assets/js/domains/checks/editor.js';
import {createUiAlertCenter} from '../netunim-orders/site/assets/js/ui/alert-center.js';

const sample=()=>({id:'c1',name:'<script>bad()</script>',account:'ביתי',amount:300,status:'הופקד - במעקב',dueDate:'2026-08-01',depositDate:'2026-08-03',bankMatch:{phase:'deposited',eventId:'17:deposited',transactionId:17,description:'הפק.שיק בסלולר',date:'2026-08-03',amount:1000,checkIds:['c1','c2'],previousStatus:'בקופה',previousDepositDate:null}});
{
  const c=sample();c.bankHistory=[{...c.bankMatch}];c.bankMatch={...c.bankMatch,eventId:'17:auto',autoConfirmed:true};
  const html=checkBankActivityMarkup([c]);assert.match(html,/בבנק \(1\)/);assert.match(html,/התבקש אישור התאמה בעבר/);
  assert.equal(checkBankReviewItems([c]).length,0,'Historical review request does not remain an active alert');
  c.bankHistory=[{...c.bankMatch}];assert.match(checkBankActivityMarkup([c]),/בבנק \(1\)/,'New certainty and its history are one event');
  c.bankHistory=[{...c.bankMatch,eventId:'17:pending',provisional:true},{...c.bankMatch},{...c.bankMatch,phase:'missing',eventId:'17:missing'}];
  c.bankMatch={...c.bankMatch,eventId:'17:reappeared'};
  assert.match(checkBankActivityMarkup([c]),/בבנק \(3\)/,'Disappearance breaks deposit grouping and remains independently visible');
  const b={checkNumber:'00111',amount:300,bankNumber:'12'},m={...c.bankMatch,bankItem:b,accountRole:'home',accountKey:'home'};
  const row={id:'17',date:'2026-09-15',checkDetails:{checkItems:[{checkNumber:'222',amount:700,imageFrontKey:'b'.repeat(64)},{...b,imageFrontKey:'a'.repeat(64)}]}};
  const context={bank:{homeFeed:{accountNumber:'home',transactions:[row]}},now:()=>Date.parse('2026-09-16T12:00:00Z')};
  assert.match(checkBankFrontImageMarkup(m,context),new RegExp('a'.repeat(64)));assert.doesNotMatch(checkBankFrontImageMarkup(m,context),new RegExp('b'.repeat(64)));
  assert.match(checkBankFrontImageMarkup(m,{...context,imageAction:'view-orders-bank-cheque-image'}),/view-orders-bank-cheque-image/);
  assert.equal(checkBankFrontImageMarkup({...m,accountKey:'other'},context),'');
  assert.equal(checkBankFrontImageMarkup({...m,transactionId:18},context),'');
  assert.equal(checkBankFrontImageMarkup({...m,bankItem:{...b,amount:700}},context),'');
  assert.equal(checkBankFrontImageMarkup(m,{...context,now:()=>Date.parse('2027-01-01')}),'');
  row.checkDetails.checkItems.push({...b,imageFrontKey:'c'.repeat(64)});assert.equal(checkBankFrontImageMarkup(m,context),'','Conflicting individual items never pick an image');
}
{
  const c=sample();c.bankMatch={...c.bankMatch,autoConfirmed:true,matchMethod:'number',bankItem:{checkNumber:'111',amount:300}};
  assert.equal(checkBankReviewItems([c]).length,0,'Server-confirmed exact evidence is not an alert');
  assert.equal(checkBankReviewMarkup([c]),'');assert.match(checkBankStatusMarkup(c),/אושרה אוטומטית/);
  c.bankHistory=[{...c.bankMatch,recordedAt:'2026-08-03T12:00:00Z',checkName:c.name,checkAmount:300}];
  let html=checkBankActivityMarkup([c],'ביתי');assert.match(html,/הודעות ופעולות אוטומטיות בבנק \(1\)/);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|מאשר את ההתאמה|role="status"/);
  assert.match(html,/ההתאמה שגויה/,'A quiet current association can still be inspected and rejected');
  c.bankMatch={...c.bankMatch,phase:'cleared',eventId:'17:cleared'};
  assert.equal(checkBankReviewItems([c]).length,0,'Routine settlement is a notification, not a warning');
  html=checkBankActivityMarkup([c],'ביתי');assert.match(html,/בבנק \(2\)/);assert.match(html,/סומן נפרע/);assert.doesNotMatch(html,/ההתאמה שגויה/,'Historical associations cannot reject the current state');
  for(const phase of ['returned','missing']){
    c.bankMatch={...c.bankMatch,phase,eventId:'17:'+phase};assert.equal(checkBankReviewItems([c]).length,1,'Adverse incidents remain actionable even after certain matching');
  }
  c.bankMatch={...c.bankMatch,phase:'deposited',warning:'possible_return'};assert.equal(checkBankReviewItems([c]).length,1,'Warnings always override a previous certainty flag');
  assert.doesNotMatch(checkBankActivityMarkup([c],'עסקי'),/&lt;script&gt;/,'Activity respects account selection');
}
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
  const originalDepositDate=c.depositDate;
  (editor.markCheckCleared||editor.markCleared)(c.id);
  assert.equal(c.depositDate,originalDepositDate,'Manual clearance preserves the actual bank deposit date');
  const manual={...sample(),id:'manual',status:'בקופה',bankMatch:undefined,depositDate:null};model.state.checks.push(manual);
  assert.equal((editor.markCheckDeposited||editor.markDeposited)(manual.id),true);
  assert.equal(manual.status,'הופקד - במעקב');assert.notEqual(manual.bankAutomationDisabled,true,'The actual manual-deposit action leaves automatic tracking enabled');
}
{
  const center=createUiAlertCenter({model:{state:{checks:[sample()]}},financeSnapshot:()=>({})});
  assert.equal(center.currentAlerts()[0].kind,'check_bank','bank-derived check incidents join the Orders warning center');
}
{
  const c=sample();c.bankHistory=Array.from({length:60},(_,i)=>({...c.bankMatch,eventId:`history:${i}`,phase:'cleared',recordedAt:`2026-08-${String(i%28+1).padStart(2,'0')}`}));
  assert.equal((checkBankActivityMarkup([c]).match(/class="check-bank-activity-item"/g)||[]).length,25);
  assert.equal((checkBankActivityMarkup([c],null,2).match(/class="check-bank-activity-item"/g)||[]).length,11);
  assert.match(checkBankActivityMarkup([c],null,999),/עמוד 3 מתוך 3/);
  assert.equal(c.bankHistory.length,60,'Pagination must retain all stored events');
  applyCheckBankReview([c],c.id,c.bankMatch.eventId,'accept');
  assert.equal(applyCheckBankReview([c],c.id,c.bankMatch.eventId,'reject'),true,'A reviewed current association can still be rejected from history');
}
console.log('PASS check bank review: escaped evidence, account filtering, quiet automation history, pagination, incident-specific confirmation/rejection and both save queues');
