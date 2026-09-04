import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {dateFmt, monthLabel} from '../../core/dates.js';
import {searchMatch} from '../../core/search.js';
import {localSearchMarkup} from '../../ui/search.js';

// Expense presentation is owned by the expenses domain and can be hosted by any page shell.
export function createDomainsExpensesView({model,ui,bankNextCycleCommitments,bankHomeNextCycleCommitments}){
function accountOf(row){return row?.account==='ביתי'?'ביתי':'עסקי'}
function expenseAccountLabel(account){return account==='ביתי'?'ביתיות':'עסקיות'}
function expenseMatches(row){const q=String(ui.expenseSearchValue||'').trim();return !q||searchMatch(q,[row.description,row.type,row.amount,row.account,row.recurring!==false?'חוזרת':'חד פעמית',row.active!==false?'פעילה':'לא פעילה'],[row.date,row.dueDate])}
function accountDivider(account,rows,colspan,detail=''){
  const total=rows.reduce((sum,row)=>sum+Number(row.amount||0),0),tone=account==='ביתי'?'home':'business';
  return `<tr class="expense-account-divider ${tone}"><td colspan="${colspan}"><div class="expense-account-divider-inner"><b>חשבון ${esc(account)}</b><span class="expense-account-divider-line" aria-hidden="true"></span><small>${detail?`${esc(detail)} · `:''}${rows.length} הוצאות · ${money(total)}</small></div></td></tr>`;
}
function cycleAccountRows(account,cycle){
  const all=[...(cycle?.targetExpenseRows||[])].filter(row=>accountOf(row)===account),rows=all.filter(expenseMatches).sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||'')||(a.description||'').localeCompare(b.description||'','he'));
  const detail=`מחזור ${monthLabel(cycle.targetMonth)}`;
  const empty=String(ui.expenseSearchValue||'').trim()&&all.length?'אין הוצאות בחשבון הזה המתאימות לחיפוש.':`אין הוצאות ${expenseAccountLabel(account)} במחזור הזה.`;
  const body=rows.length?rows.map(r=>`<tr data-expense-id="${esc(r.id)}"><td><b>${esc(r.description)}</b></td><td class="amount">${money(r.amount)}</td><td>${dateFmt(r.dueDate)}</td><td>${esc(r.type)}</td><td><span class="badge ${esc(r.recurring!==false?'green':'')}">${r.recurring!==false?'כל חודש':'חד־פעמית'}</span></td><td><button type="button" class="iconbtn" data-action="open-expense-modal-2" data-click-arg0="${esc(r.id)}">עריכה</button></td></tr>`).join(''):`<tr class="expense-account-empty"><td colspan="6"><div class="empty">${esc(empty)}</div></td></tr>`;
  return accountDivider(account,rows,6,detail)+body;
}
function configuredAccountRows(account,rows){
  const all=rows.filter(row=>accountOf(row)===account),accountRows=all.filter(expenseMatches);
  const empty=String(ui.expenseSearchValue||'').trim()&&all.length?'אין הגדרות הוצאה בחשבון הזה המתאימות לחיפוש.':`עדיין לא הוגדרו הוצאות ${expenseAccountLabel(account)}.`;
  const body=accountRows.length?accountRows.map(r=>`<tr data-expense-id="${esc(r.id)}"><td><b>${esc(r.description)}</b></td><td>${esc(accountOf(r))}</td><td class="amount">${money(r.amount)}</td><td>${dateFmt(r.date)}</td><td>${esc(r.type)}</td><td>${r.recurring!==false?'כן':'לא'}</td><td>${r.active?'כן':'לא'}</td><td><button type="button" class="iconbtn" data-action="open-expense-modal-2" data-click-arg0="${esc(r.id)}">עריכה</button></td></tr>`).join(''):`<tr class="expense-account-empty"><td colspan="8"><div class="empty">${esc(empty)}</div></td></tr>`;
  return accountDivider(account,accountRows,8)+body;
}
function expensesResultsMarkup(){
  const businessCycle=bankNextCycleCommitments(),homeCycle=bankHomeNextCycleCommitments();
  const allRows=[...model.state.expenses].sort((a,b)=>(a.description||'').localeCompare(b.description||'','he'));
  return `<section class="section"><div class="section-head"><div><h3>הוצאות לפי חשבון</h3><div class="muted">עסקי: ${esc(monthLabel(businessCycle.targetMonth))} · ביתי: ${esc(monthLabel(homeCycle.targetMonth))}</div></div><button type="button" class="btn primary" data-action="open-expense-modal">+ הוצאה חדשה</button></div><div class="table-scroll"><table class="expenses-account-table"><thead><tr><th>תיאור</th><th>סכום</th><th>מועד</th><th>סוג</th><th>חוזרת</th><th></th></tr></thead><tbody>${cycleAccountRows('עסקי',businessCycle)}${cycleAccountRows('ביתי',homeCycle)}</tbody></table></div></section>
    <section class="section" style="margin-top:16px"><div class="section-head"><div><h3>הגדרת הוצאות קבועות ונוספות</h3></div></div><div class="table-scroll"><table class="expenses-account-table"><thead><tr><th>תיאור</th><th>חשבון</th><th>סכום</th><th>יום / תאריך בסיס</th><th>סוג</th><th>חוזרת</th><th>פעיל</th><th></th></tr></thead><tbody>${configuredAccountRows('עסקי',allRows)}${configuredAccountRows('ביתי',allRows)}</tbody></table></div></section>`;
}
function expensesMarkup(){return `<div class="expenses-surface"><div class="view-search-row expenses-view-search">${localSearchMarkup({value:ui.expenseSearchValue||'',placeholder:'חיפוש בהוצאות לפי תיאור, סכום, סוג או חשבון…',label:'חיפוש בהוצאות',inputAction:'expense-search',className:'wide'})}</div><div id="expensesResults">${expensesResultsMarkup()}</div></div>`}
function setExpenseSearch(value){ui.expenseSearchValue=String(value||'');const region=document.getElementById('expensesResults');if(region)region.innerHTML=expensesResultsMarkup()}
return {expensesMarkup,setExpenseSearch,expenseMatches};
}
