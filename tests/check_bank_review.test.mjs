import assert from 'node:assert/strict';
import {applyCheckBankReview,checkBankReviewItems,checkBankReviewMarkup,checkBankStatusMarkup,checkBankActivityMarkup,checkBankFrontImageMarkup,removableCheckBankEvents} from '../shared/check-bank-review.js';
import {checkFutureTotalData,checkMonthSummaryMarkup} from '../shared/check-summary.js';
import {createDomainsChecksEditor as ordersEditor} from '../netunim-orders/site/assets/js/domains/checks/editor.js';
import {createDomainsChecksEditor as kupaEditor} from '../netunim-kupa/site/assets/js/domains/checks/editor.js';
import {createUiAlertCenter} from '../netunim-orders/site/assets/js/ui/alert-center.js';

const sample=()=>({id:'c1',name:'<script>bad()</script>',account:'ביתי',amount:300,status:'הופקד - במעקב',dueDate:'2026-08-01',depositDate:'2026-08-03',bankMatch:{phase:'deposited',eventId:'17:deposited',transactionId:17,description:'הפק.שיק בסלולר',date:'2026-08-03',amount:1000,checkIds:['c1','c2'],previousStatus:'בקופה',previousDepositDate:null}});
{
  const c=sample();c.bankMatch.autoConfirmed=true;c.bankHistory=[{...c.bankMatch}];
  assert.match(checkBankActivityMarkup([c]),/אישור והסרת ההודעה/);
  c.bankHistory.unshift({...c.bankMatch,eventId:'old-proposal',autoConfirmed:false});
  assert.equal(removableCheckBankEvents(c,{bulk:true}).length,2,'A fully confirmed deposit can remove its old proposal in the same bulk action');
  c.bankHistory.shift();
  const match=structuredClone(c.bankMatch);
  assert.equal(applyCheckBankReview([c],c.id,JSON.stringify([match.eventId]),'remove'),true);
  assert.deepEqual(c.bankMatch,match);assert.equal(c.status,'הופקד - במעקב');assert.equal(c.bankHistory.length,0);
  assert.match(checkBankActivityMarkup([c]),/בבנק \(0 צ׳קים\)/);assert.deepEqual(c.bankHistoryDismiss,[match.eventId]);
  c.bankMatch={...match,phase:'missing',eventId:'new'};c.bankHistory=[c.bankMatch];
  assert.equal(applyCheckBankReview([c],c.id,'["new"]','remove'),false);
  assert.equal(removableCheckBankEvents(c,{bulk:true}).length,0);assert.equal(checkBankReviewItems([c]).length,1);
  applyCheckBankReview([c],c.id,'new','accept');assert.equal(applyCheckBankReview([c],c.id,'["new"]','remove'),true);
  const rows=[{amount:4000,status:'הופקד - במעקב'},{amount:4230,status:'בקופה'}];
  assert.equal(checkFutureTotalData(rows),4230);
  const html=checkMonthSummaryMarkup(rows,String);assert.match(html,/שהופקד · 4000/);assert.match(html,/עתידי · 4230/);assert.doesNotMatch(html,/8230/);
}
{
  const c=sample();c.bankHistory=[{...c.bankMatch}];c.bankMatch={...c.bankMatch,eventId:'17:auto',autoConfirmed:true};
  const html=checkBankActivityMarkup([c]);assert.match(html,/בבנק \(צ׳ק אחד\)/);assert.doesNotMatch(html,/התבקש אישור התאמה בעבר/);assert.match(html,/אושרה אוטומטית/);
  assert.equal(checkBankReviewItems([c]).length,0,'Historical review request does not remain an active alert');
  c.bankHistory=[{...c.bankMatch}];assert.match(checkBankActivityMarkup([c]),/בבנק \(צ׳ק אחד\)/,'New certainty and its history are one cheque group');
  c.bankHistory=[{...c.bankMatch,eventId:'17:pending',provisional:true},{...c.bankMatch},{...c.bankMatch,phase:'missing',eventId:'17:missing'}];
  c.bankMatch={...c.bankMatch,eventId:'17:reappeared'};
  const grouped=checkBankActivityMarkup([c]);assert.match(grouped,/בבנק \(צ׳ק אחד\)/,'All activity for one cheque is one top-level group');assert.equal((grouped.match(/check-bank-activity-timeline/g)||[]).length,1);assert.match(grouped,/נעלמה מתנועות הבנק/,'A disappearance remains a meaningful milestone inside the cheque timeline');
  const b={checkNumber:'00111',amount:300,bankNumber:'12'},m={...c.bankMatch,bankItem:b,accountRole:'home',accountKey:'home'};
  const row={id:'17',date:'2026-09-15',checkDetails:{checkItems:[{checkNumber:'222',amount:700,imageFrontKey:'b'.repeat(64)},{...b,imageFrontKey:'a'.repeat(64)}]}};
  const context={bank:{homeFeed:{accountNumber:'home',transactions:[row]}},now:()=>Date.parse('2026-09-16T12:00:00Z')};
  assert.match(checkBankFrontImageMarkup(m,context),new RegExp('a'.repeat(64)));assert.doesNotMatch(checkBankFrontImageMarkup(m,context),new RegExp('b'.repeat(64)));
  assert.match(checkBankFrontImageMarkup(m,{...context,imageAction:'view-orders-bank-cheque-image'}),/view-orders-bank-cheque-image/);
  assert.equal(checkBankFrontImageMarkup({...m,accountKey:'other'},context),'');
  assert.equal(checkBankFrontImageMarkup({...m,transactionId:18},context),'');
  assert.equal(checkBankFrontImageMarkup({...m,bankItem:{...b,amount:700}},context),'');
  assert.match(checkBankFrontImageMarkup(m,{...context,now:()=>Date.parse('2027-01-01')}),new RegExp('a'.repeat(64)),'The extended 183-day window keeps this September cheque image available in January');
  assert.equal(checkBankFrontImageMarkup(m,{...context,now:()=>Date.parse('2027-03-17')}),'','The image disappears exactly when the 183-day retention window expires');
  row.checkDetails.checkItems.push({...b,imageFrontKey:'c'.repeat(64)});assert.equal(checkBankFrontImageMarkup(m,context),'','Conflicting individual items never pick an image');
}
{
  const c=sample();c.bankMatch={...c.bankMatch,autoConfirmed:true,matchMethod:'number',bankItem:{checkNumber:'111',amount:300}};
  assert.equal(checkBankReviewItems([c]).length,0,'Server-confirmed exact evidence is not an alert');
  assert.equal(checkBankReviewMarkup([c]),'');assert.match(checkBankStatusMarkup(c),/אושרה אוטומטית/);
  c.bankHistory=[{...c.bankMatch,recordedAt:'2026-08-03T12:00:00Z',checkName:c.name,checkAmount:300}];
  let html=checkBankActivityMarkup([c],'ביתי');assert.match(html,/הודעות ופעולות אוטומטיות בבנק \(צ׳ק אחד\)/);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|מאשר את ההתאמה|role="status"/);
  assert.match(html,/ההתאמה שגויה/,'A quiet current association can still be inspected and rejected');
  c.bankMatch={...c.bankMatch,phase:'cleared',eventId:'17:cleared'};
  assert.equal(checkBankReviewItems([c]).length,0,'Routine settlement is a notification, not a warning');
  html=checkBankActivityMarkup([c],'ביתי');assert.match(html,/בבנק \(צ׳ק אחד\)/);assert.match(html,/סומן נפרע/);assert.match(html,/מהלך המעקב בצ׳ק/);assert.doesNotMatch(html,/ההתאמה שגויה/,'Historical associations cannot reject the current state');
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
  const c=sample();
  c.bankMatch={...c.bankMatch,eventId:'pending-reference:4463455',transactionId:101,description:'הפק שיק-ע.ישיר',amount:300,date:'2026-09-20',provisional:true,provisionalReference:true,bankReference:'4463455',autoConfirmed:false,matchMethod:'number',bankItem:{checkNumber:'4463455',amount:300,bankNumber:'',branchNumber:'',accountNumber:''}};
  c.checkNumber='4463455';
  assert.equal(checkBankReviewItems([c]).length,0,'A strict pending-reference match is an informational automatic action, not a warning');
  assert.equal(checkBankReviewMarkup([c]),'','Pending reference identity must never ask for manual confirmation in the alert area');
  const center=createUiAlertCenter({model:{state:{checks:[c]}},financeSnapshot:()=>({})});
  assert.equal(center.currentAlerts('2026-09-20').length,0,'A strict pending-reference match must suppress both bank-review and generic due-date warnings');
  assert.match(checkBankStatusMarkup(c),/ממתין לאימות סופי/);
  let html=checkBankActivityMarkup([c],'ביתי');
  assert.match(html,/זוהתה הפקדה ממתינה לפי מספר הצ׳ק/);assert.match(html,/זיהוי זמני/);assert.match(html,/אין צורך באישור ידני/);
  assert.doesNotMatch(html,/מאשר את ההתאמה|נדרש אישור ידני/);
  assert.match(html,/ההתאמה שגויה/,'The informational activity remains rejectable if the bank association is actually wrong');
  const pending={...c.bankMatch,recordedAt:'2026-09-20T01:00:00Z',checkName:c.name,checkAmount:c.amount,checkNumber:c.checkNumber,checkAccount:c.account};
  c.bankHistory=[pending];
  c.bankMatch={...c.bankMatch,eventId:'final:501',transactionId:501,description:'הפק.שיק במכונה',date:'2026-09-22',provisional:false,provisionalReference:false,autoConfirmed:true,bankReference:'-1',bankItem:{...c.bankMatch.bankItem,bankNumber:'17',branchNumber:'725',accountNumber:'13807'}};
  html=checkBankActivityMarkup([c],'ביתי');
  assert.match(html,/הודעות ופעולות אוטומטיות בבנק \(צ׳ק אחד\)/,'Final structured evidence upgrades the same cheque activity instead of presenting two unrelated deposits');
  assert.doesNotMatch(html,/זוהתה הפקדה ממתינה לפי מספר הצ׳ק|עדכונים קודמים להפקדה/,'Superseded provisional evidence is omitted from the user-facing timeline');assert.match(html,/אושרה אוטומטית/);
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
  const make=(id,name,events,current)=>({id,name,account:'עסקי',amount:500,status:current.phase==='cleared'?'נפרע':'הופקד - במעקב',checkNumber:id,bankHistory:events,bankMatch:current});
  const overdue=(id,name)=>({phase:'overdue',eventId:`${id}:overdue`,date:'2026-09-19',observedDate:'2026-09-19',recordedAt:'2026-09-19T09:00:00Z',checkName:name,checkAmount:500,checkNumber:id,checkAccount:'עסקי'});
  const pending=(id,name)=>({phase:'deposited',eventId:`${id}:pending`,transactionId:Number(id),accountKey:'business',date:'2026-09-20',recordedAt:'2026-09-20T09:00:00Z',description:'הפק שיק-ע.ישיר',amount:500,provisional:true,provisionalReference:true,bankItem:{checkNumber:id,amount:500},checkName:name,checkAmount:500,checkNumber:id,checkAccount:'עסקי'});
  const cleared={phase:'cleared',eventId:'400:cleared',transactionId:400,accountKey:'business',date:'2026-09-19',recordedAt:'2026-09-19T11:00:00Z',checkName:'גלניר שכירות',checkAmount:500,checkNumber:'400',checkAccount:'עסקי'};
  const deposit={phase:'deposited',eventId:'400:deposit',transactionId:400,accountKey:'business',date:'2026-09-15',recordedAt:'2026-09-15T11:00:00Z',description:'הפקדה',amount:500,autoConfirmed:true,checkName:'גלניר שכירות',checkAmount:500,checkNumber:'400',checkAccount:'עסקי'};
  const checks=[['101','רוזין'],['102','עמרם'],['103',"ג'מוס"]].map(([id,name])=>{const p=pending(id,name);return make(id,name,[overdue(id,name),p],p)});
  checks.push(make('400','גלניר שכירות',[deposit,cleared],cleared));
  const html=checkBankActivityMarkup(checks);
  assert.match(html,/בבנק \(4 צ׳קים\)/,'Eight raw milestones across four cheques render as four top-level activity groups');
  assert.equal((html.match(/class="check-bank-activity-item"/g)||[]).length,4);
  assert.match(html,/רוזין/);assert.match(html,/הגיע מועד ההפקדה/);assert.match(html,/ממתין לאימות סופי/);assert.match(html,/סומן נפרע/);
}
{
  const checks=Array.from({length:60},(_,i)=>{const c=sample(),event={...c.bankMatch,eventId:`history:${i}`,phase:'cleared',recordedAt:`2026-08-${String(i%28+1).padStart(2,'0')}`};return {...c,id:`c${i}`,name:`Cheque ${i}`,bankMatch:event,bankHistory:[event]}});
  assert.equal((checkBankActivityMarkup(checks).match(/class="check-bank-activity-item"/g)||[]).length,25);
  const floating=checkBankActivityMarkup(checks,null,0,{}, {floatingMenu:true});
  assert.match(floating,/<details class="section check-bank-activity" data-dismiss-on-outside>/,'Header activity opts into the shared outside-dismiss controller');
  assert.match(floating,/<div class="section-body" data-menu-panel>/,'Header activity exposes its popup panel to the shared floating-menu controller');
  assert.doesNotMatch(checkBankActivityMarkup(checks),/data-dismiss-on-outside|data-menu-panel/,'Inline activity remains an ordinary disclosure section');
  assert.equal((checkBankActivityMarkup(checks,null,2).match(/class="check-bank-activity-item"/g)||[]).length,10);
  assert.match(checkBankActivityMarkup(checks,null,999),/עמוד 3 מתוך 3/);
  assert.equal(checks[0].bankHistory.length,1,'Pagination/groups must not mutate stored history');
  const c=sample();applyCheckBankReview([c],c.id,c.bankMatch.eventId,'accept');
  assert.equal(applyCheckBankReview([c],c.id,c.bankMatch.eventId,'reject'),true,'A reviewed current association can still be rejected from history');
}
console.log('PASS check bank review: escaped evidence, account filtering, quiet automation history, pagination, incident-specific confirmation/rejection and both save queues');
