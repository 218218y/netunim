import {esc, uid} from '../../core/values.js';
import {num, money, formatNullableMoney, wholeMoney} from '../../core/money.js';
import {dateFmt, monthLabel, todayISO} from '../../core/dates.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsBankView({model, session, checksSession, bankAsOfDate, bankDerivedCheckDeposits, bankCurrentBalance, bankNextCycleCommitments, bankLongTermPosition, bankProjectedThisMonth, sharedChecksHaveLocalWork, saveState, syncSharedChecksFromCloud, sharedChecksObservedSequence, toast}){
function renderBank(){
  const bank=bankCurrentBalance(),cycle=bankNextCycleCommitments(),after=bankProjectedThisMonth(),long=bankLongTermPosition(),cycleLabel=monthLabel(cycle.targetMonth);
  const targetExpenseRows=cycle.targetExpenseRows.sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
  const allRows=[...model.state.expenses].sort((a,b)=>(a.description||'').localeCompare(b.description||''));
  const autoDeposits=bankDerivedCheckDeposits();
  const staleTotal=cycle.elapsedCredit+cycle.elapsedExpenses;
  document.getElementById('content').innerHTML=`
  <div class="bank-balance-card">
    <div class="bank-entry">
      <label>עובר ושב בבנק — יתרה מעודכנת</label>
      <div class="bank-input-row"><input id="bankBalanceInput" type="number" step="1" inputmode="numeric" placeholder="הקלד יתרת עו״ש" value="${esc(bank===null?'':bank)}"><button class="btn primary" data-action="save-bank-balance">שמור צילום מצב</button></div>
      <small>${model.state.bank?.updatedAt?`צילום ידני אחרון: ${dateFmt(bankAsOfDate())} · ${new Date(model.state.bank.updatedAt).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}`:'היתרה טרם הוזנה.'}${autoDeposits.length?` · נוספו מאז אוטומטית ${autoDeposits.length} הפקדות צקים (${money(autoDeposits.reduce((a,x)=>a+x.amount,0))})`:''}</small>
    </div>
    <div class="bank-mini"><div class="bank-label">אשראי במחזור הקרוב</div><div class="bank-value">${money(cycle.nextCreditTotal)}</div><div class="muted">${cycle.nextCreditRows.length?`חיוב אחד קדימה לכל כרטיס · ${cycleLabel}`:'אין חיובי אשראי עתידיים'}</div></div>
    <div class="bank-mini"><div class="bank-label">הוצאות למחזור הקרוב</div><div class="bank-value">${money(targetExpenseRows.reduce((a,x)=>a+num(x.amount),0))}</div><div class="muted">הוצאות של ${esc(cycleLabel)} בלבד</div></div>
    <div class="bank-mini ${esc(after!==null&&after>=0?'positive':'warning')}"><div class="bank-label">עו״ש אחרי המחזור הקרוב</div><div class="bank-value">${formatNullableMoney(after)}</div><div class="muted">צילום יתרה פחות חיובים שעברו מאז + מחזור האשראי הבא</div></div>
  </div>
  ${staleTotal>0?`<div class="notice warn" style="margin-bottom:16px"><b>הצילום הידני של העו״ש ישן ביחס להיום.</b> לצורך חישוב נכון נגרעו גם חיובים שכבר עברו מאז הצילום בסך ${money(staleTotal)}. מומלץ לעדכן מדי פעם את היתרה לפי הבנק.</div>`:''}
  <div class="grid two">
    <section class="section"><div class="section-head"><div><h3>הוצאות מחזור ${esc(cycleLabel)}</h3></div><button class="btn primary" data-action="open-expense-modal">+ הוצאה חדשה</button></div><div style="overflow:auto"><table><thead><tr><th>תיאור</th><th>סכום</th><th>מועד</th><th>סוג</th><th>חוזרת</th><th></th></tr></thead><tbody>${targetExpenseRows.length?targetExpenseRows.map(r=>`<tr><td><b>${esc(r.description)}</b><div class="muted">${esc(r.account)}</div></td><td class="amount">${money(r.amount)}</td><td>${dateFmt(r.dueDate)}</td><td>${esc(r.type)}</td><td><span class="badge ${esc(r.recurring!==false?'green':'')}">${r.recurring!==false?'כל חודש':'חד־פעמית'}</span></td><td><button class="iconbtn" data-action="open-expense-modal-2" data-click-arg0="${esc(r.id)}">עריכה</button></td></tr>`).join(''):'<tr><td colspan="6"><div class="empty">אין הוצאות במחזור הזה.</div></td></tr>'}</tbody></table></div></section>
    <section class="section"><div class="section-head"><div><h3>חיובי האשראי הקרובים</h3></div></div><div class="section-body"><div class="alert-list">${cycle.nextCreditRows.length?cycle.nextCreditRows.map(x=>`<div class="alert" style="--c:#638f87"><div><b>${esc(x.card)} — ${money(x.amount)}</b><small>${dateFmt(x.date)} · תשלום ${esc(x.part)}/${esc(x.totalParts)} · ${esc(x.description)||'עסקת אשראי'}</small></div></div>`).join(''):'<div class="empty">אין חיובי אשראי עתידיים.</div>'}</div></div></section>
  </div>
  <section class="section" style="margin-top:16px"><div class="section-head"><div><h3>הגדרת הוצאות קבועות ונוספות</h3></div></div><div style="overflow:auto"><table><thead><tr><th>תיאור</th><th>חשבון</th><th>סכום</th><th>יום / תאריך בסיס</th><th>סוג</th><th>חוזרת</th><th>פעיל</th><th></th></tr></thead><tbody>${allRows.map(r=>`<tr><td><b>${esc(r.description)}</b></td><td>${esc(r.account)}</td><td class="amount">${money(r.amount)}</td><td>${dateFmt(r.date)}</td><td>${esc(r.type)}</td><td>${r.recurring!==false?'כן':'לא'}</td><td>${r.active?'כן':'לא'}</td><td><button class="iconbtn" data-action="open-expense-modal-2" data-click-arg0="${esc(r.id)}">עריכה</button></td></tr>`).join('')}</tbody></table></div></section>
  <div class="net-summary">
    <div class="net-mini"><span>עו״ש מעודכן</span><b>${formatNullableMoney(long.bank)}</b></div>
    <div class="net-mini"><span>כל האשראי שנותר</span><b>− ${money(long.credit)}</b></div>
    <div class="net-mini"><span>הוצאות חודש אחד</span><b>− ${money(long.expenses)}</b><small>${monthLabel(long.targetMonth)}</small></div>
    <div class="net-mini"><span>סה״כ קופה</span><b>+ ${money(long.kupa)}</b><small>מזומן + צקים שטרם הופקדו</small></div>
    <div class="net-total"><span>מאזן כולל נטו</span><b>${formatNullableMoney(long.net)}</b><small>עו״ש − כל האשראים העתידיים − חודש הוצאות + קופה</small></div>
  </div>`}

async function saveBankBalance(){const el=document.getElementById('bankBalanceInput');if(!el||el.value==='')return toast('יש להזין יתרת עו״ש');if(session.connectionMode==='supabase'){if(checksSession.sharedChecksBusy||sharedChecksHaveLocalWork())return toast('יש להמתין לסנכרון הצקים לפני צילום יתרת עו״ש חדש');const synced=await syncSharedChecksFromCloud({quiet:true,required:true});if(!synced||checksSession.sharedChecksBusy||sharedChecksHaveLocalWork())return toast('צילום היתרה נעצר: לא ניתן לאמת שהצקים מסונכרנים כרגע. נסה שוב לאחר שהענן מסונכרן.')}const observedSeq=sharedChecksObservedSequence();model.state.bank={...model.state.bank,currentBalance:wholeMoney(el.value),updatedAt:new Date().toISOString(),asOfDate:todayISO(),snapshotToken:uid('BANK'),snapshotSeq:observedSeq,adjustments:[]};saveState('יתרת העו״ש נשמרה כצילום מצב חדש')}


return { renderBank, saveBankBalance };
}
