import {esc} from '../../core/values.js';
import {num, money, formatNullableMoney} from '../../core/money.js';
import {dateFmt, monthLabel} from '../../core/dates.js';

export function createDomainsBankView({model, bankAsOfDate, bankCurrentBalance, bankNextCycleCommitments, bankLongTermPosition, bankProjectedThisMonth, bankBridgeUiState, refreshBankBridgeStatus}){
function bankSnapshotLabel(){
  if(!model.state.bank?.updatedAt)return 'היתרה טרם הוזנה.';
  const source=model.state.bank.source==='hapoalim'?'בנק הפועלים':'הזנה ידנית';
  const account=model.state.bank.sourceAccount?` · חשבון ${model.state.bank.sourceAccount}`:'';
  return `${source} · ${dateFmt(bankAsOfDate())} · ${new Date(model.state.bank.updatedAt).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}${account}`;
}

function bridgeStatusText(s){
  if(s.busy)return s.message||'מתבצע עדכון מול Bank Bridge…';
  if(!s.tokenConfigured)return 'החיבור המקומי עדיין לא הותאם למחשב זה.';
  if(s.upgradeRequired)return s.message||'נדרש לשדרג את Bank Bridge במחשב זה.';
  if(s.available===false)return s.lastError||'Bank Bridge המקומי אינו זמין.';
  if(s.available===true&&s.configured)return `Bank Bridge מחובר${s.branchNumber&&s.accountNumber?` · סניף ${s.branchNumber} · חשבון ${s.accountNumber}`:s.accountNumber?` · חשבון ${s.accountNumber}`:''}`;
  if(s.available===true)return 'Bank Bridge פעיל, אך עדיין לא נשמרו בו פרטי בנק הפועלים.';
  return s.message||'בודק את החיבור המקומי…';
}

function syncTimeLabel(value){
  if(!value)return 'טרם בוצע עדכון מוצלח מהבנק';
  const d=new Date(value);if(!Number.isFinite(d.getTime()))return 'זמן עדכון לא זמין';
  return `${d.toLocaleDateString('he-IL')} · ${d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}`;
}

function bankDateLabel(value){
  if(!value)return '—';
  const d=new Date(value);if(!Number.isFinite(d.getTime()))return '—';
  const weekday=['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'][d.getDay()]||'';
  const dd=String(d.getDate()).padStart(2,'0'),mm=String(d.getMonth()+1).padStart(2,'0'),yy=String(d.getFullYear()).slice(-2);
  return `${weekday} ${dd}/${mm}/${yy}`;
}

function bankSyncHeadlineState(s){
  const lastSync=s?.sharedLastSyncAt,account=s?.feed?.accountNumber||'';
  if(s?.busy)return {tone:'busy',icon:'↻',title:'מעדכן כעת מבנק הפועלים',meta:s.message||'ממתין לנתוני הבנק…'};
  if(s?.upgradeRequired)return {tone:'error',icon:'!',title:'נדרש עדכון ל-Bank Bridge',meta:s.message||'יש להריץ מחדש את מתקין ה-Bridge במחשב זה.'};
  if(s?.lastError){
    const stage=errorStageLabel(s.lastErrorStage);
    return {tone:'error',icon:'!',title:`העדכון האחרון נכשל${stage?` · ${stage}`:''}`,meta:`${s.lastErrorCode?`${s.lastErrorCode} · `:''}${s.lastError}${lastSync?` · הצלחה קודמת: ${syncTimeLabel(lastSync)}`:''}`};
  }
  if(s?.lastWarning&&lastSync)return {tone:'warn',icon:'!',title:'היתרה עודכנה · התנועות התקבלו חלקית',meta:`${syncTimeLabel(lastSync)}${account?` · ${account}`:''} · ${s.lastWarning}`};
  if(lastSync)return {tone:'ok',icon:'✓',title:'הסנכרון האחרון מהבנק הצליח',meta:`${syncTimeLabel(lastSync)}${account?` · ${account}`:''}`};
  if(!s?.tokenConfigured)return {tone:'idle',icon:'•',title:'סנכרון הבנק עדיין לא הוגדר',meta:'פתח את השורה להגדרת ה-Bridge והחשבון.'};
  if(s?.available===false)return {tone:'error',icon:'!',title:'Bank Bridge אינו זמין כרגע',meta:s.lastError||'בדוק שהשירות המקומי פועל.'};
  return {tone:'idle',icon:'•',title:'טרם בוצע סנכרון מוצלח מהבנק',meta:s?.configured?'אפשר ללחוץ „רענן עכשיו”.':'פתח את השורה והשלם את הגדרת החיבור.'};
}

function bankSyncHeadlineMarkup(s){
  const state=bankSyncHeadlineState(s);
  return `<span class="bank-sync-state-icon" aria-hidden="true">${esc(state.icon)}</span><span class="bank-sync-state-copy"><b>${esc(state.title)}</b><small>${esc(state.meta)}</small></span>`;
}

function errorStageLabel(stage){
  return ({browser:'פתיחת דפדפן',login:'התחברות',session:'הכנת שירותי הבנק',account:'בחירת חשבון',data:'קריאת נתוני החשבון',balance:'קריאת יתרה',transactions:'קריאת תנועות'}[stage]||'');
}

function bankAccountChoicesMarkup(accounts){
  const rows=Array.isArray(accounts)?accounts:[];
  if(!rows.length)return '';
  return `<div class="bank-account-choices"><div class="bank-account-choices-title"><b>החשבונות הפעילים שהבנק החזיר</b><small>בחר את החשבון הרצוי. הבחירה נשמרת רק ב-Bridge המקומי.</small></div><div class="bank-account-choice-list">${rows.map(row=>{
    const branch=String(row?.branchNumber||''),account=String(row?.accountNumber||''),bank=String(row?.bankNumber||'12');
    if(!branch||!account)return '';
    return `<button type="button" class="bank-account-choice" data-action="select-bank-bridge-account" data-click-arg0="${esc(branch)}" data-click-arg1="${esc(account)}"><span>סניף <b>${esc(branch)}</b></span><span>חשבון <b>${esc(account)}</b></span><small>מזהה API: ${esc(bank)}-${esc(branch)}-${esc(account)}</small></button>`;
  }).join('')}</div></div>`;
}

function bankBridgeDiagnosticsMarkup(s){
  const stage=errorStageLabel(s?.lastErrorStage);
  const error=s?.lastError?`<div class="bank-sync-detail error"><b>העדכון האחרון נכשל${stage?` בשלב: ${esc(stage)}`:''}</b><span>${esc(s.lastError)}</span>${s.lastErrorCode||s.lastErrorHttpStatus?`<small>${s.lastErrorCode?`קוד: ${esc(s.lastErrorCode)}`:''}${s.lastErrorCode&&s.lastErrorHttpStatus?' · ':''}${s.lastErrorHttpStatus?`HTTP מהבנק: ${esc(s.lastErrorHttpStatus)}`:''}</small>`:''}${s.availableAccounts?.length?'<small>פתח את הגדרות החיבור למטה כדי לבחור את החשבון המדויק.</small>':''}</div>`:'';
  const warning=s?.lastWarning?`<div class="bank-sync-detail warn"><b>היתרה נשמרה, אך קיימת אזהרת תנועות</b><span>${esc(s.lastWarning)}</span></div>`:'';
  return error+warning;
}

function bankChequeDetailsMarkup(row){
  if(!row?.cheque)return '';
  const details=row.checkDetails&&typeof row.checkDetails==='object'?row.checkDetails:{};
  const items=(Array.isArray(details.checkItems)?details.checkItems:[]).filter(item=>item&&Number(item.amount)>0&&(item.checkNumber||(item.bankNumber&&item.branchNumber&&item.accountNumber)));
  const numbers=[...new Set((Array.isArray(details.checkNumbers)?details.checkNumbers:[]).filter(x=>x&&x!=='0'))];
  const count=Number(details.checkCount);
  const facts=[];
  if(items.length>1)facts.push(`<span><b>שיקים בהפקדה:</b> ${esc(items.length)}</span>`);
  else if(Number.isFinite(count)&&count>1)facts.push(`<span><b>שיקים בהפקדה:</b> ${esc(Math.trunc(count))}</span>`);
  if(!items.length&&numbers.length)facts.push(`<span><b>מספרי שיקים:</b> ${numbers.map(x=>esc(x)).join(', ')}</span>`);
  if(row.bankReference&&row.bankReference!=='0')facts.push(`<span><b>אסמכתת הפקדה:</b> ${esc(row.bankReference)}</span>`);

  const table=items.length?`<div class="bank-cheque-items-wrap"><table class="bank-cheque-items"><thead><tr><th>בנק</th><th>סניף</th><th>חשבון</th><th>מס׳ שיק</th><th>סכום</th><th>מסמך</th></tr></thead><tbody>${items.map(item=>`<tr><td>${esc(item.bankNumber||'—')}</td><td>${esc(item.branchNumber||'—')}</td><td>${esc(item.accountNumber||'—')}</td><td class="bank-cheque-number">${esc(item.checkNumber||'—')}</td><td class="bank-cheque-amount">${money(Number(item.amount))}</td><td>${item.hasDocumentReference?'קיים בבנק':'—'}</td></tr>`).join('')}</tbody></table></div>`:'';
  const documentNote=!items.length&&details.hasDocumentReference?'<div class="bank-cheque-document-note">הבנק מציין שקיים מסמך/צילום עבור ההפקדה, אך כתובת המסמך אינה נשמרת בקופה.</div>':'';
  const warning=details.warning?`<div class="bank-cheque-detail-warning">${esc(details.warning)}</div>`:'';
  if(!facts.length&&!table&&!documentNote&&!warning)return '';
  return `<div class="bank-cheque-info">${facts.length?`<div class="bank-cheque-facts">${facts.join('')}</div>`:''}${table}${documentNote}${warning}</div>`;
}

function bankTransactionsMarkup(feed){
  const rows=feed?.transactions||[];
  const balance=Number(feed?.balance);
  const caption=`<div class="bank-transactions-caption"><div><b>תנועות בחשבון</b><small>${feed?.accountNumber?`חשבון ${esc(feed.accountNumber)} · `:''}${rows.length} תנועות · 30 הימים האחרונים</small></div>${Number.isFinite(balance)?`<div class="bank-current-balance"><span>יתרה נוכחית</span><b>${money(balance)}</b></div>`:''}</div>`;
  if(!feed)return `${caption}<div class="empty bank-feed-empty">לא בוצע עדיין סנכרון בנק שמכיל תנועות.</div>`;
  if(!rows.length)return `${caption}<div class="empty bank-feed-empty">לא התקבלו תנועות אחרונות בחלון הזמן שנבדק.${feed.transactionWarning?`<div class="bank-feed-warning">${esc(feed.transactionWarning)}</div>`:''}</div>`;
  const body=rows.map(row=>{
    const amount=Number(row.amount)||0,when=row.date||row.processedDate;
    const valueDate=row.processedDate&&row.processedDate!==row.date?bankDateLabel(row.processedDate):'';
    return `<tr class="${row.status==='pending'?'pending':''}">
      <td class="bank-transaction-date"><b>${esc(bankDateLabel(when))}</b>${valueDate?`<small>ערך ${esc(valueDate)}</small>`:''}</td>
      <td class="bank-transaction-description"><div><b>${esc(row.description||'תנועת בנק')}</b>${row.status==='pending'?'<span class="bank-transaction-pending">ממתינה</span>':''}</div>${row.memo?`<small>${esc(row.memo)}</small>`:''}${bankChequeDetailsMarkup(row)}</td>
      <td class="bank-transaction-money debit">${amount<0?money(Math.abs(amount)):''}</td>
      <td class="bank-transaction-money credit">${amount>0?money(amount):''}</td>
      <td class="bank-transaction-money balance-after">${row.balanceAfter!==null&&row.balanceAfter!==undefined&&row.balanceAfter!==''&&Number.isFinite(Number(row.balanceAfter))?money(Number(row.balanceAfter)):'—'}</td>
    </tr>`;
  }).join('');
  return `${caption}<div class="bank-transactions-table-wrap"><table class="bank-transactions-table"><thead><tr><th>תאריך</th><th>פעולה</th><th>חובה</th><th>זכות</th><th>יתרה לאחר תנועה</th></tr></thead><tbody>${body}</tbody></table></div>${feed.transactionWarning?`<div class="bank-feed-warning">${esc(feed.transactionWarning)}</div>`:''}`;
}

function updateBridgePanel(){
  const s=bankBridgeUiState(),headline=document.getElementById('bankSyncHeadline'),status=document.getElementById('bankBridgeStatus');
  if(headline){const state=bankSyncHeadlineState(s);headline.innerHTML=bankSyncHeadlineMarkup(s);headline.className=`bank-sync-headline ${state.tone}`}
  if(status){status.textContent=bridgeStatusText(s);status.className=`bank-sync-status ${s.available===false||s.lastError?'error':s.configured?'ok':''}`}
  const diagnostics=document.getElementById('bankBridgeDiagnostics');if(diagnostics)diagnostics.innerHTML=bankBridgeDiagnosticsMarkup(s);
  const choices=document.getElementById('bankBridgeAccountChoices');if(choices)choices.innerHTML=bankAccountChoicesMarkup(s.availableAccounts);
  const branch=document.getElementById('bankBranchNumberInput');if(branch&&document.activeElement!==branch&&!branch.value)branch.value=s.branchNumber||'';
  const account=document.getElementById('bankAccountNumberInput');if(account&&document.activeElement!==account&&!account.value)account.value=s.accountNumber||'';
  const refresh=document.querySelector('[data-action="refresh-bank-from-hapoalim"]');if(refresh)refresh.disabled=!!s.busy||!s.tokenConfigured||!!s.upgradeRequired;
  const auth=document.querySelector('[data-action="open-bank-auth"]');if(auth)auth.disabled=!!s.busy||!s.tokenConfigured||!!s.upgradeRequired;
  const remove=document.querySelector('[data-action="delete-bank-bridge-credentials"]');if(remove)remove.disabled=!!s.busy||!s.configured;
  const save=document.querySelector('[data-action="configure-bank-bridge"]');if(save)save.disabled=!!s.busy;
  const pair=document.querySelector('[data-action="save-bank-bridge-token"]');if(pair)pair.disabled=!!s.busy;
}

function renderBank(){
  const bank=bankCurrentBalance(),cycle=bankNextCycleCommitments(),after=bankProjectedThisMonth(),long=bankLongTermPosition(),cycleLabel=monthLabel(cycle.targetMonth);
  const targetExpenseRows=cycle.targetExpenseRows.sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
  const allRows=[...model.state.expenses].sort((a,b)=>(a.description||'').localeCompare(b.description||''));
  const bridgeUi=bankBridgeUiState(),feed=bridgeUi.feed;
  const staleTotal=cycle.elapsedCredit+cycle.elapsedExpenses;
  document.getElementById('content').innerHTML=`
  <div class="bank-balance-card">
    <div class="bank-entry">
      <label>עובר ושב בבנק — יתרה מעודכנת</label>
      <div class="bank-input-row"><input id="bankBalanceInput" type="number" step="1" inputmode="numeric" placeholder="הקלד יתרת עו״ש" value="${esc(bank===null?'':bank)}"><button type="button" class="btn primary" data-action="save-bank-balance">שמור צילום מצב</button></div>
      <small>${esc(bankSnapshotLabel())} · היתרה מוצגת ממקור הבנק בלבד; סטטוס צ׳קים אינו משנה אותה</small>
    </div>
    <div class="bank-mini"><div class="bank-label">אשראי עסקי במחזור הקרוב</div><div class="bank-value">${money(cycle.nextCreditTotal)}</div><div class="muted">${cycle.nextCreditRows.length?`חיוב אחד קדימה לכל כרטיס · ${cycleLabel}`:'אין חיובי אשראי עסקיים עתידיים'}</div></div>
    <div class="bank-mini"><div class="bank-label">הוצאות למחזור הקרוב</div><div class="bank-value">${money(targetExpenseRows.reduce((a,x)=>a+num(x.amount),0))}</div><div class="muted">הוצאות של ${esc(cycleLabel)} בלבד</div></div>
    <div class="bank-mini ${esc(after!==null&&after>=0?'positive':'warning')}"><div class="bank-label">עו״ש אחרי המחזור הקרוב</div><div class="bank-value">${formatNullableMoney(after)}</div><div class="muted">צילום יתרה פחות חיובים שעברו מאז + מחזור האשראי הבא</div></div>
  </div>
  <section class="section bank-sync-section">
    <details class="bank-sync-settings">
      <summary class="bank-sync-toolbar">
        <span id="bankSyncHeadline" class="bank-sync-headline ${bankSyncHeadlineState(bridgeUi).tone}">${bankSyncHeadlineMarkup(bridgeUi)}</span>
        <span class="bank-sync-head-actions">
          <button type="button" class="btn primary" data-action="refresh-bank-from-hapoalim" ${bridgeUi.busy||!bridgeUi.tokenConfigured?'disabled':''}>${bridgeUi.busy?'מעדכן…':'רענן עכשיו'}</button>
          <button type="button" class="btn" data-action="open-bank-auth" ${bridgeUi.busy||!bridgeUi.tokenConfigured?'disabled':''}>פתח אימות בבנק</button>
        </span>
        <span class="bank-sync-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="bank-sync-settings-body">
        <div id="bankBridgeDiagnostics">${bankBridgeDiagnosticsMarkup(bridgeUi)}</div>
        <div id="bankBridgeStatus" class="bank-sync-status ${bridgeUi.available===false||bridgeUi.lastError?'error':bridgeUi.configured?'ok':''}">${esc(bridgeStatusText(bridgeUi))}</div>
        <div id="bankBridgeAccountChoices">${bankAccountChoicesMarkup(bridgeUi.availableAccounts)}</div>
        <div class="bank-connection-forms">
          <form id="bankBridgePairForm" class="bank-sync-form bank-sync-pair-form" autocomplete="off">
            <div class="bank-sync-form-title">חיבור הדפדפן ל-Bridge במחשב הזה</div>
            <label><span>מפתח Bank Bridge</span><input id="bankBridgeTokenInput" name="bankBridgeToken" type="password" autocomplete="off" placeholder="הדבק את המפתח שהעתיקה ההתקנה"></label>
            <button type="button" class="btn" data-action="save-bank-bridge-token" ${bridgeUi.busy?'disabled':''}>שמור מפתח למחשב זה</button>
            <small>${bridgeUi.tokenConfigured?'מפתח מקומי כבר שמור בדפדפן הזה. אפשר להחליף אותו בהדבקת מפתח חדש.':'יש לבצע פעם אחת בכל מחשב/דפדפן.'}</small>
          </form>
          <form id="bankBridgeCredentialsForm" class="bank-sync-form bank-sync-credentials-form" autocomplete="off">
            <div class="bank-sync-form-title">פרטי בנק הפועלים — נשמרים רק ב-Windows</div>
            <div class="bank-sync-credential-grid">
              <label><span>קוד משתמש</span><input id="bankUserCodeInput" name="username" type="text" autocomplete="username" spellcheck="false" placeholder="קוד המשתמש לבנק"></label>
              <label><span>סיסמה</span><input id="bankPasswordInput" name="current-password" type="password" autocomplete="current-password" placeholder="הסיסמה נשלחת רק ל-Bridge המקומי"></label>
              <label><span>סניף</span><input id="bankBranchNumberInput" name="branchNumber" type="text" inputmode="numeric" autocomplete="off" placeholder="לדוגמה 123" value="${esc(bridgeUi.branchNumber||'')}"></label>
              <label><span>מספר חשבון</span><input id="bankAccountNumberInput" name="accountNumber" type="text" inputmode="numeric" autocomplete="off" placeholder="לדוגמה 456789" value="${esc(bridgeUi.accountNumber||'')}"></label>
            </div>
            <div class="bank-sync-form-actions"><button type="button" class="btn" data-action="configure-bank-bridge" ${bridgeUi.busy?'disabled':''}>שמור פרטי הפועלים במחשב</button><button type="button" class="btn danger-soft" data-action="delete-bank-bridge-credentials" ${bridgeUi.busy||!bridgeUi.configured?'disabled':''}>מחק פרטי התחברות</button></div>
            <small>כאשר יש כמה חשבונות, יש להזין גם סניף וגם חשבון. Bank Bridge בונה מזהה מדויק בפורמט 12-סניף-חשבון ולא מנחש לפי סיומת.</small>
          </form>
        </div>
        <div class="bank-sync-actions"><label class="bank-auto-toggle"><input type="checkbox" data-change="set-bank-auto-refresh" ${bridgeUi.autoEnabled?'checked':''}> <span>עדכון אוטומטי פעם ב־24 שעות</span></label></div>
        <div class="soft-note">„רענן עכשיו” משתמש בסשן השמור כל עוד הוא פעיל. „פתח אימות בבנק” נדרש רק כאשר הפועלים מבקש הזדהות מחדש. ההגדרות נשמרות מקומית במחשב, ואילו זמן הסנכרון והתנועות נשמרים במצב הקופה המשותף.</div>
      </div>
    </details>
    <div class="bank-transactions-region">${bankTransactionsMarkup(feed)}</div>
  </section>
  ${staleTotal>0?`<div class="notice warn" style="margin-bottom:16px"><b>צילום העו״ש ישן ביחס להיום.</b> לצורך חישוב נכון נגרעו גם חיובים שכבר עברו מאז הצילום בסך ${money(staleTotal)}. מומלץ לרענן את היתרה מהבנק.</div>`:''}
  <div class="grid two">
    <section class="section"><div class="section-head"><div><h3>הוצאות מחזור ${esc(cycleLabel)}</h3></div><button type="button" class="btn primary" data-action="open-expense-modal">+ הוצאה חדשה</button></div><div style="overflow:auto"><table><thead><tr><th>תיאור</th><th>סכום</th><th>מועד</th><th>סוג</th><th>חוזרת</th><th></th></tr></thead><tbody>${targetExpenseRows.length?targetExpenseRows.map(r=>`<tr><td><b>${esc(r.description)}</b><div class="muted">${esc(r.account)}</div></td><td class="amount">${money(r.amount)}</td><td>${dateFmt(r.dueDate)}</td><td>${esc(r.type)}</td><td><span class="badge ${esc(r.recurring!==false?'green':'')}">${r.recurring!==false?'כל חודש':'חד־פעמית'}</span></td><td><button type="button" class="iconbtn" data-action="open-expense-modal-2" data-click-arg0="${esc(r.id)}">עריכה</button></td></tr>`).join(''):'<tr><td colspan="6"><div class="empty">אין הוצאות במחזור הזה.</div></td></tr>'}</tbody></table></div></section>
    <section class="section"><div class="section-head"><div><h3>חיובי האשראי העסקיים הקרובים</h3></div></div><div class="section-body"><div class="alert-list">${cycle.nextCreditRows.length?cycle.nextCreditRows.map(x=>`<div class="alert" style="--c:#638f87"><div><b>${esc(x.card)} — ${money(x.amount)}</b><small>${dateFmt(x.date)} · תשלום ${esc(x.part)}/${esc(x.totalParts)} · ${esc(x.description)||'עסקת אשראי'}</small></div></div>`).join(''):'<div class="empty">אין חיובי אשראי עסקיים עתידיים.</div>'}</div></div></section>
  </div>
  <section class="section" style="margin-top:16px"><div class="section-head"><div><h3>הגדרת הוצאות קבועות ונוספות</h3></div></div><div style="overflow:auto"><table><thead><tr><th>תיאור</th><th>חשבון</th><th>סכום</th><th>יום / תאריך בסיס</th><th>סוג</th><th>חוזרת</th><th>פעיל</th><th></th></tr></thead><tbody>${allRows.map(r=>`<tr><td><b>${esc(r.description)}</b></td><td>${esc(r.account)}</td><td class="amount">${money(r.amount)}</td><td>${dateFmt(r.date)}</td><td>${esc(r.type)}</td><td>${r.recurring!==false?'כן':'לא'}</td><td>${r.active?'כן':'לא'}</td><td><button type="button" class="iconbtn" data-action="open-expense-modal-2" data-click-arg0="${esc(r.id)}">עריכה</button></td></tr>`).join('')}</tbody></table></div></section>
  <div class="net-summary">
    <div class="net-mini"><span>עו״ש מעודכן</span><b>${formatNullableMoney(long.bank)}</b></div>
    <div class="net-mini"><span>כל האשראי העסקי שנותר</span><b>− ${money(long.credit)}</b></div>
    <div class="net-mini"><span>הוצאות חודש אחד</span><b>− ${money(long.expenses)}</b><small>${monthLabel(long.targetMonth)}</small></div>
    <div class="net-mini"><span>סה״כ קופה</span><b>+ ${money(long.kupa)}</b><small>מזומן + צקים שטרם הופקדו</small></div>
    <div class="net-total"><span>מאזן כולל נטו</span><b>${formatNullableMoney(long.net)}</b><small>עו״ש − כל האשראים העסקיים העתידיים − חודש הוצאות + קופה</small></div>
  </div>`;
  updateBridgePanel();
  for(const formId of ['bankBridgePairForm','bankBridgeCredentialsForm']){
    document.getElementById(formId)?.addEventListener('submit',event=>event.preventDefault());
  }
  refreshBankBridgeStatus().then(updateBridgePanel).catch(()=>updateBridgePanel());
}

return {renderBank};
}
