import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {dateFmt, monthLabel} from '../../core/dates.js';

// Expense presentation is owned by the expenses domain and can be hosted by any page shell.
export function createDomainsExpensesView({model, bankNextCycleCommitments}){
function expensesMarkup(){
  const cycle=bankNextCycleCommitments(),cycleLabel=monthLabel(cycle.targetMonth);
  const targetExpenseRows=[...cycle.targetExpenseRows].sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
  const allRows=[...model.state.expenses].sort((a,b)=>(a.description||'').localeCompare(b.description||''));
  return `<div class="expenses-surface">
    <section class="section"><div class="section-head"><div><h3>הוצאות מחזור ${esc(cycleLabel)}</h3></div><button type="button" class="btn primary" data-action="open-expense-modal">+ הוצאה חדשה</button></div><div class="table-scroll"><table><thead><tr><th>תיאור</th><th>סכום</th><th>מועד</th><th>סוג</th><th>חוזרת</th><th></th></tr></thead><tbody>${targetExpenseRows.length?targetExpenseRows.map(r=>`<tr><td><b>${esc(r.description)}</b><div class="muted">${esc(r.account)}</div></td><td class="amount">${money(r.amount)}</td><td>${dateFmt(r.dueDate)}</td><td>${esc(r.type)}</td><td><span class="badge ${esc(r.recurring!==false?'green':'')}">${r.recurring!==false?'כל חודש':'חד־פעמית'}</span></td><td><button type="button" class="iconbtn" data-action="open-expense-modal-2" data-click-arg0="${esc(r.id)}">עריכה</button></td></tr>`).join(''):'<tr><td colspan="6"><div class="empty">אין הוצאות במחזור הזה.</div></td></tr>'}</tbody></table></div></section>
    <section class="section" style="margin-top:16px"><div class="section-head"><div><h3>הגדרת הוצאות קבועות ונוספות</h3></div></div><div class="table-scroll"><table><thead><tr><th>תיאור</th><th>חשבון</th><th>סכום</th><th>יום / תאריך בסיס</th><th>סוג</th><th>חוזרת</th><th>פעיל</th><th></th></tr></thead><tbody>${allRows.length?allRows.map(r=>`<tr><td><b>${esc(r.description)}</b></td><td>${esc(r.account)}</td><td class="amount">${money(r.amount)}</td><td>${dateFmt(r.date)}</td><td>${esc(r.type)}</td><td>${r.recurring!==false?'כן':'לא'}</td><td>${r.active?'כן':'לא'}</td><td><button type="button" class="iconbtn" data-action="open-expense-modal-2" data-click-arg0="${esc(r.id)}">עריכה</button></td></tr>`).join(''):'<tr><td colspan="8"><div class="empty">עדיין לא הוגדרו הוצאות.</div></td></tr>'}</tbody></table></div></section>
  </div>`;
}
return {expensesMarkup};
}
