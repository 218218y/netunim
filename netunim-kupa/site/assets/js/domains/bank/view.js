import {esc} from '../../core/values.js';
import {num, money, formatNullableMoney} from '../../core/money.js';
import {dateFmt, monthLabel} from '../../core/dates.js';

export function createDomainsBankView({model,ui,bankAsOfDate,bankCurrentBalance,bankNextCycleCommitments,bankLongTermPosition,bankProjectedThisMonth,bankBridgeUiState,refreshBankBridgeStatus}){
function bankSnapshotLabel(){
  if(!model.state.bank?.updatedAt)return 'היתרה העסקית טרם הוזנה.';
  const source=model.state.bank.source==='hapoalim'?'בנק הפועלים':'הזנה ידנית';
  const account=model.state.bank.sourceAccount?` · חשבון עסקי ${model.state.bank.sourceAccount}`:'';
  return `${source} · ${dateFmt(bankAsOfDate())} · ${new Date(model.state.bank.updatedAt).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}${account}`;
}

function accountLabel(branch,account){return branch&&account?`סניף ${branch} · חשבון ${account}`:account?`חשבון ${account}`:''}
function bridgeStatusText(s){
  if(s.busy)return s.message||'מתבצע עדכון מול Bank Bridge…';
  if(!s.tokenConfigured)return 'החיבור המקומי עדיין לא הותאם למחשב זה.';
  if(s.upgradeRequired)return s.message||'נדרש לשדרג את Bank Bridge במחשב זה.';
  if(s.available===false)return s.lastError||'Bank Bridge המקומי אינו זמין.';
  if(s.available===true&&s.configured){
    const business=accountLabel(s.businessBranchNumber||s.branchNumber,s.businessAccountNumber||s.accountNumber),home=accountLabel(s.homeBranchNumber,s.homeAccountNumber);
    return `Bank Bridge מחובר${business?` · עסקי: ${business}`:''}${home?` · ביתי: ${home}`:' · חשבון ביתי טרם הוגדר'}`;
  }
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

function bankSearchMatch(query,values){const q=String(query||'').trim().toLocaleLowerCase('he-IL');if(!q)return true;return values.map(value=>String(value??'')).join(' ').toLocaleLowerCase('he-IL').includes(q)}
function bankRowMatchesSearch(row,query){return bankSearchMatch(query,[row?.date,row?.processedDate,bankDateLabel(row?.date||row?.processedDate),row?.description,row?.memo,row?.amount,row?.balanceAfter,row?.bankReference,row?.status,JSON.stringify(row?.checkDetails||{})])}

function bankSyncHeadlineState(s){
  const lastSync=s?.sharedLastSyncAt,lastFailure=s?.lastErrorAt;
  if(s?.busy)return {tone:'busy',icon:'↻',title:'מסנכרן',meta:'כעת'};
  if(s?.upgradeRequired)return {tone:'error',icon:'!',title:'נדרש עדכון',meta:`Bridge v${String(s.bridgeVersion||'?')}`};
  if(s?.lastError)return {tone:'error',icon:'!',title:'נכשל',meta:lastFailure?syncTimeLabel(lastFailure):'זמן הכשל לא זמין'};
  if(s?.lastWarning&&lastSync)return {tone:'warn',icon:'!',title:'הושלם חלקית',meta:syncTimeLabel(lastSync)};
  if(lastSync)return {tone:'ok',icon:'✓',title:'הצליח',meta:syncTimeLabel(lastSync)};
  if(!s?.tokenConfigured)return {tone:'idle',icon:'•',title:'טרם הוגדר',meta:'לחץ להגדרה'};
  if(s?.available===false)return {tone:'error',icon:'!',title:'לא זמין',meta:lastFailure?syncTimeLabel(lastFailure):'Bridge מקומי'};
  return {tone:'idle',icon:'•',title:'טרם סונכרן',meta:s?.configured?'מוכן לרענון':'נדרשת הגדרה'};
}

function bankSyncHeadlineMarkup(s){
  const state=bankSyncHeadlineState(s);
  return `<span class="bank-sync-state-icon" aria-hidden="true">${esc(state.icon)}</span><span class="bank-sync-state-copy"><b>${esc(state.title)}</b><small>${esc(state.meta)}</small></span>`;
}

function errorStageLabel(stage){
  return ({browser:'פתיחת דפדפן',login:'התחברות',session:'הכנת שירותי הבנק',account:'בחירת חשבון',data:'קריאת נתוני החשבון',balance:'קריאת יתרה',transactions:'קריאת תנועות'}[stage]||'');
}

function bankAccountChoicesMarkup(accounts,role=''){
  const rows=Array.isArray(accounts)?accounts:[],targetRole=role==='home'?'home':'business';
  if(!rows.length)return '';
  const roleLabel=targetRole==='home'?'הביתי':'העסקי';
  return `<div class="bank-account-choices"><div class="bank-account-choices-title"><b>החשבונות הפעילים שהבנק החזיר</b><small>בחר את החשבון ${roleLabel}. הבחירה נשמרת רק ב-Bridge המקומי.</small></div><div class="bank-account-choice-list">${rows.map(row=>{
    const branch=String(row?.branchNumber||''),account=String(row?.accountNumber||''),bank=String(row?.bankNumber||'12');
    if(!branch||!account)return '';
    return `<button type="button" class="bank-account-choice" data-action="select-bank-bridge-account" data-click-arg0="${esc(targetRole)}" data-click-arg1="${esc(branch)}" data-click-arg2="${esc(account)}"><span>סניף <b>${esc(branch)}</b></span><span>חשבון <b>${esc(account)}</b></span><small>מזהה API: ${esc(bank)}-${esc(branch)}-${esc(account)}</small></button>`;
  }).join('')}</div></div>`;
}

function bankBridgeDiagnosticsMarkup(s){
  const stage=errorStageLabel(s?.lastErrorStage),role=s?.accountSelectionRole==='home'?'הביתי':s?.accountSelectionRole==='business'?'העסקי':'';
  const error=s?.lastError?`<div class="bank-sync-detail error"><b>העדכון האחרון נכשל${stage?` בשלב: ${esc(stage)}`:''}${role?` · החשבון ${role}`:''}</b><span>${esc(s.lastError)}</span>${s.lastErrorCode||s.lastErrorHttpStatus?`<small>${s.lastErrorCode?`קוד: ${esc(s.lastErrorCode)}`:''}${s.lastErrorCode&&s.lastErrorHttpStatus?' · ':''}${s.lastErrorHttpStatus?`HTTP מהבנק: ${esc(s.lastErrorHttpStatus)}`:''}</small>`:''}${s.availableAccounts?.length?'<small>פתח את הגדרות החיבור למטה כדי לבחור את החשבון המדויק.</small>':''}</div>`:'';
  const homePartial=s?.lastWarning&&s?.accountSelectionRole==='home'&&s?.lastWarningCode;
  const warning=s?.lastWarning?homePartial?`<div class="bank-sync-detail warn"><b>החשבון העסקי נשמר; החשבון הביתי לא עודכן${s.lastWarningStage?` בשלב: ${esc(errorStageLabel(s.lastWarningStage))}`:''}</b><span>${esc(s.lastWarning)}</span><small>קוד: ${esc(s.lastWarningCode)}${s.lastWarningHttpStatus?` · HTTP מהבנק: ${esc(s.lastWarningHttpStatus)}`:''}</small>${s.availableAccounts?.length?'<small>בחר למטה את החשבון הביתי המדויק מתוך החשבונות הפעילים שהבנק החזיר.</small>':''}</div>`:`<div class="bank-sync-detail warn"><b>היתרות נשמרו, אך קיימת אזהרה לגבי התנועות</b><span>${esc(s.lastWarning)}</span></div>`:'';
  return error+warning;
}

function bankChequeDetailsMarkup(row){
  if(!row?.cheque)return '';
  const details=row.checkDetails&&typeof row.checkDetails==='object'?row.checkDetails:{};
  const items=(Array.isArray(details.checkItems)?details.checkItems:[]).filter(item=>item&&Number(item.amount)>0&&(item.checkNumber||(item.bankNumber&&item.branchNumber&&item.accountNumber)));
  const numbers=[...new Set((Array.isArray(details.checkNumbers)?details.checkNumbers:[]).filter(x=>x&&x!=='0'))];
  const count=Number(details.checkCount),facts=[];
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

function bankTransactionsTableMarkup(feed,role){
  const allRows=feed?.transactions||[],query=ui.bankSearchValue||'',rows=query.trim()?allRows.filter(row=>bankRowMatchesSearch(row,query)):allRows,balance=Number(feed?.balance),roleLabel=role==='home'?'הביתי':'העסקי';
  const countLabel=query.trim()?`${rows.length} מתוך ${allRows.length} תנועות`:`${rows.length} תנועות`;
  const available=feed?.availableBalance===null||feed?.availableBalance===undefined?null:Number(feed.availableBalance),limit=feed?.creditLimit===null||feed?.creditLimit===undefined?null:Number(feed.creditLimit);
  const balanceFacts=[Number.isFinite(balance)?`<div class="bank-current-balance"><span>יתרת עו״ש ${roleLabel}</span><b>${money(balance)}</b></div>`:'',Number.isFinite(available)?`<div class="bank-current-balance"><span>יתרה זמינה למשיכה</span><b>${money(available)}</b></div>`:'',Number.isFinite(limit)&&limit>0?`<div class="bank-current-balance"><span>מסגרת אשראי</span><b>${money(limit)}</b></div>`:''].filter(Boolean).join('');
  const caption=`<div class="bank-transactions-caption"><div><b>תנועות בחשבון ${roleLabel}</b><small>${feed?.accountNumber?`חשבון ${esc(feed.accountNumber)} · `:''}${countLabel} · הארכיון נשמר בענן; מוצג חלון אחרון</small></div><div class="bank-balance-facts">${balanceFacts}</div></div>`;
  if(!feed)return `${caption}<div class="empty bank-feed-empty">${role==='home'?'החשבון הביתי עדיין לא סונכרן. הגדר אותו בחיבור לבנק ולחץ „רענן”.':'לא בוצע עדיין סנכרון בנק שמכיל תנועות.'}</div>`;
  if(!rows.length)return `${caption}<div class="empty bank-feed-empty">${query.trim()&&allRows.length?'אין תנועות המתאימות לחיפוש.':'לא התקבלו תנועות אחרונות בחלון הזמן שנבדק.'}${feed.transactionWarning?`<div class="bank-feed-warning">${esc(feed.transactionWarning)}</div>`:''}</div>`;
  const body=rows.map(row=>{
    const amount=Number(row.amount)||0,when=row.date||row.processedDate;
    const valueDate=row.processedDate&&row.processedDate!==row.date?bankDateLabel(row.processedDate):'';
    return `<tr class="${row.status==='pending'?'pending':''}"><td class="bank-transaction-date"><b>${esc(bankDateLabel(when))}</b>${valueDate?`<small>ערך ${esc(valueDate)}</small>`:''}</td><td class="bank-transaction-description"><div><b>${esc(row.description||'תנועת בנק')}</b>${row.status==='pending'?'<span class="bank-transaction-pending">ממתינה</span>':''}</div>${row.memo?`<small>${esc(row.memo)}</small>`:''}${bankChequeDetailsMarkup(row)}</td><td class="bank-transaction-money debit">${amount<0?money(Math.abs(amount)):''}</td><td class="bank-transaction-money credit">${amount>0?money(amount):''}</td><td class="bank-transaction-money balance-after">${row.balanceAfter!==null&&row.balanceAfter!==undefined&&row.balanceAfter!==''&&Number.isFinite(Number(row.balanceAfter))?money(Number(row.balanceAfter)):'—'}</td></tr>`;
  }).join('');
  return `${caption}<div class="bank-transactions-table-wrap"><table class="bank-transactions-table"><thead><tr><th>תאריך</th><th>פעולה</th><th>חובה</th><th>זכות</th><th>יתרה לאחר תנועה</th></tr></thead><tbody>${body}</tbody></table></div>${feed.transactionWarning?`<div class="bank-feed-warning">${esc(feed.transactionWarning)}</div>`:''}`;
}

function bankAccountTabsMarkup(){
  const active=ui.bankAccountView==='home'?'home':'business';
  return `<span class="bank-account-tabs bank-sync-account-tabs" role="tablist" aria-label="בחירת חשבון לתצוגה"><button type="button" role="tab" aria-selected="${active==='business'}" class="bank-account-tab ${active==='business'?'active':''}" data-action="set-bank-account-view" data-click-arg0="business">חשבון עסקי</button><button type="button" role="tab" aria-selected="${active==='home'}" class="bank-account-tab ${active==='home'?'active':''}" data-action="set-bank-account-view" data-click-arg0="home">חשבון ביתי</button></span>`;
}

function bankTransactionsMarkup(s=bankBridgeUiState()){
  const active=ui.bankAccountView==='home'?'home':'business',feed=active==='home'?s.homeFeed:s.feed;
  return bankTransactionsTableMarkup(feed,active);
}

function syncBankAccountTabs(){
  const active=ui.bankAccountView==='home'?'home':'business';
  document.querySelectorAll('[data-action="set-bank-account-view"]').forEach(button=>{
    const selected=button.dataset.clickArg0===active;
    button.classList.toggle('active',selected);button.setAttribute('aria-selected',String(selected));
  });
}

function setBankAccountView(role){
  ui.bankAccountView=role==='home'?'home':'business';syncBankAccountTabs();
  const region=document.querySelector('.bank-transactions-region');if(region)region.innerHTML=bankTransactionsMarkup();
}
function setBankSearch(value){ui.bankSearchValue=String(value||'');const region=document.querySelector('.bank-transactions-region');if(region)region.innerHTML=bankTransactionsMarkup()}
function toggleBankSyncOptions(){ui.bankSyncOpen=!ui.bankSyncOpen;const panel=document.getElementById('bankSyncPanel'),button=document.getElementById('bankSyncHeadline');if(panel)panel.hidden=!ui.bankSyncOpen;if(button){button.classList.toggle('open',ui.bankSyncOpen);button.setAttribute('aria-expanded',String(ui.bankSyncOpen))}}

function updateBridgePanel(){
  const s=bankBridgeUiState(),headline=document.getElementById('bankSyncHeadline'),status=document.getElementById('bankBridgeStatus');
  if(headline){const state=bankSyncHeadlineState(s);headline.innerHTML=`${bankSyncHeadlineMarkup(s)}<span class="bank-sync-chevron" aria-hidden="true">⌄</span>`;headline.className=`bank-sync-toggle ${state.tone} ${ui.bankSyncOpen?'open':''}`;headline.setAttribute('aria-expanded',String(ui.bankSyncOpen))}
  if(status){status.textContent=bridgeStatusText(s);status.className=`bank-sync-status ${s.available===false||s.lastError?'error':s.configured?'ok':''}`}
  const diagnostics=document.getElementById('bankBridgeDiagnostics');if(diagnostics)diagnostics.innerHTML=bankBridgeDiagnosticsMarkup(s);
  const choices=document.getElementById('bankBridgeAccountChoices');if(choices)choices.innerHTML=bankAccountChoicesMarkup(s.availableAccounts,s.accountSelectionRole);
  for(const [id,value] of [['bankBusinessBranchNumberInput',s.businessBranchNumber||s.branchNumber],['bankBusinessAccountNumberInput',s.businessAccountNumber||s.accountNumber],['bankHomeBranchNumberInput',s.homeBranchNumber],['bankHomeAccountNumberInput',s.homeAccountNumber]]){const input=document.getElementById(id);if(input&&document.activeElement!==input&&!input.value)input.value=value||''}
  const refresh=document.querySelector('[data-action="refresh-bank-from-hapoalim"]');if(refresh)refresh.disabled=!!s.busy||!s.tokenConfigured||!!s.upgradeRequired;
  const auth=document.querySelector('[data-action="open-bank-auth"]');if(auth)auth.disabled=!!s.busy||!s.tokenConfigured||!!s.upgradeRequired;
  const remove=document.querySelector('[data-action="delete-bank-bridge-credentials"]');if(remove)remove.disabled=!!s.busy||!s.configured;
  const save=document.querySelector('[data-action="configure-bank-bridge"]');if(save)save.disabled=!!s.busy;
  const pair=document.querySelector('[data-action="save-bank-bridge-token"]');if(pair)pair.disabled=!!s.busy;
  syncBankAccountTabs();
  const region=document.querySelector('.bank-transactions-region');if(region)region.innerHTML=bankTransactionsMarkup(s);
}

function renderBank(){
  const bank=bankCurrentBalance(),cycle=bankNextCycleCommitments(),after=bankProjectedThisMonth(),long=bankLongTermPosition(),cycleLabel=monthLabel(cycle.targetMonth);
  const targetExpenseRows=cycle.targetExpenseRows.sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
  const allRows=[...model.state.expenses].sort((a,b)=>(a.description||'').localeCompare(b.description||''));
  const bridgeUi=bankBridgeUiState(),staleTotal=cycle.elapsedCredit+cycle.elapsedExpenses;
  document.getElementById('content').innerHTML=`
  <div class="bank-balance-card">
    <div class="bank-entry">
      <label>עובר ושב עסקי בבנק — היתרה לחישובי הקופה</label>
      <div class="bank-input-row"><input id="bankBalanceInput" type="number" step="1" inputmode="numeric" placeholder="הקלד יתרת עו״ש עסקי" value="${esc(bank===null?'':bank)}"><button type="button" class="btn primary" data-action="save-bank-balance">שמור צילום מצב</button></div>
      <small>${esc(bankSnapshotLabel())} · רק החשבון העסקי נכנס לחישובי הקופה; החשבון הביתי הוא לצפייה בלבד</small>
    </div>
    <div class="bank-mini"><div class="bank-label">אשראי עסקי במחזור הקרוב</div><div class="bank-value">${money(cycle.nextCreditTotal)}</div><div class="muted">${cycle.nextCreditRows.length?`חיוב אחד קדימה לכל כרטיס · ${cycleLabel}`:'אין חיובי אשראי עסקיים עתידיים'}</div></div>
    <div class="bank-mini"><div class="bank-label">הוצאות למחזור הקרוב</div><div class="bank-value">${money(targetExpenseRows.reduce((a,x)=>a+num(x.amount),0))}</div><div class="muted">הוצאות של ${esc(cycleLabel)} בלבד</div></div>
    <div class="bank-mini ${esc(after!==null&&after>=0?'positive':'warning')}"><div class="bank-label">עו״ש עסקי אחרי המחזור הקרוב</div><div class="bank-value">${formatNullableMoney(after)}</div><div class="muted">צילום יתרה עסקית פחות חיובים שעברו מאז + מחזור האשראי הבא</div></div>
  </div>
  <section class="section bank-sync-section">
    <div class="bank-command-row">
      <div class="bank-view-tools">${bankAccountTabsMarkup()}<input class="bank-search" type="search" value="${esc(ui.bankSearchValue||'')}" placeholder="חיפוש בתנועות המוצגות…" aria-label="חיפוש בתנועות הבנק המוצגות" data-input="bank-search"></div>
      <div class="bank-sync-quick-actions"><button id="bankSyncHeadline" type="button" class="bank-sync-toggle ${bankSyncHeadlineState(bridgeUi).tone} ${ui.bankSyncOpen?'open':''}" data-action="toggle-bank-sync-options" aria-expanded="${ui.bankSyncOpen===true}" aria-controls="bankSyncPanel">${bankSyncHeadlineMarkup(bridgeUi)}<span class="bank-sync-chevron" aria-hidden="true">⌄</span></button><button type="button" class="btn primary bank-sync-refresh" data-action="refresh-bank-from-hapoalim" ${bridgeUi.busy||!bridgeUi.tokenConfigured||bridgeUi.upgradeRequired?'disabled':''}>${bridgeUi.busy?'מעדכן…':'רענן'}</button></div>
    </div>
    <div id="bankSyncPanel" class="bank-sync-settings-body" ${ui.bankSyncOpen?'':'hidden'}>
      <div class="bank-sync-settings-top"><div><b>אפשרויות סינכרון</b><small>פתח אימות רק כשהבנק דורש הזדהות מחדש; פירוט מלא של כשל מופיע כאן.</small></div><div class="bank-sync-panel-actions"><button type="button" class="btn" data-action="open-bank-auth" ${bridgeUi.busy||!bridgeUi.tokenConfigured||bridgeUi.upgradeRequired?'disabled':''}>פתח אימות בבנק</button></div></div>
      <div id="bankBridgeDiagnostics">${bankBridgeDiagnosticsMarkup(bridgeUi)}</div>
      <div id="bankBridgeStatus" class="bank-sync-status ${bridgeUi.available===false||bridgeUi.lastError?'error':bridgeUi.configured?'ok':''}">${esc(bridgeStatusText(bridgeUi))}</div>
      <div id="bankBridgeAccountChoices">${bankAccountChoicesMarkup(bridgeUi.availableAccounts,bridgeUi.accountSelectionRole)}</div>
      <div class="bank-connection-forms">
        <form id="bankBridgePairForm" class="bank-sync-form bank-sync-pair-form" autocomplete="off">
          <div class="bank-sync-form-title">חיבור הדפדפן ל-Bridge במחשב הזה</div>
          <label><span>מפתח Bank Bridge</span><input id="bankBridgeTokenInput" name="bankBridgeToken" type="password" autocomplete="off" placeholder="הדבק את המפתח שהעתיקה ההתקנה"></label>
          <button type="button" class="btn" data-action="save-bank-bridge-token" ${bridgeUi.busy?'disabled':''}>שמור מפתח למחשב זה</button>
          <small>${bridgeUi.tokenConfigured?'מפתח מקומי כבר שמור בדפדפן הזה. אפשר להחליף אותו בהדבקת מפתח חדש.':'יש לבצע פעם אחת בכל מחשב/דפדפן.'}</small>
        </form>
        <form id="bankBridgeCredentialsForm" class="bank-sync-form bank-sync-credentials-form" autocomplete="off">
          <div class="bank-sync-form-title">פרטי בנק הפועלים — התחברות אחת, שני חשבונות</div>
          <div class="bank-sync-login-grid"><label><span>קוד משתמש</span><input id="bankUserCodeInput" name="username" type="text" autocomplete="username" spellcheck="false" placeholder="קוד המשתמש לבנק"></label><label><span>סיסמה</span><input id="bankPasswordInput" name="current-password" type="password" autocomplete="current-password" placeholder="הסיסמה נשלחת רק ל-Bridge המקומי"></label></div>
          <div class="bank-account-config-grid">
            <fieldset class="bank-account-config business"><legend>חשבון עסקי — מקור הקופה</legend><label><span>סניף עסקי</span><input id="bankBusinessBranchNumberInput" name="businessBranchNumber" type="text" inputmode="numeric" autocomplete="off" placeholder="לדוגמה 123" value="${esc(bridgeUi.businessBranchNumber||bridgeUi.branchNumber||'')}"></label><label><span>מספר חשבון עסקי</span><input id="bankBusinessAccountNumberInput" name="businessAccountNumber" type="text" inputmode="numeric" autocomplete="off" placeholder="לדוגמה 456789" value="${esc(bridgeUi.businessAccountNumber||bridgeUi.accountNumber||'')}"></label><small>רק יתרת החשבון הזה מעדכנת את צילום העו״ש ואת חישובי הקופה.</small></fieldset>
            <fieldset class="bank-account-config home"><legend>חשבון ביתי — לצפייה בלבד</legend><label><span>סניף ביתי</span><input id="bankHomeBranchNumberInput" name="homeBranchNumber" type="text" inputmode="numeric" autocomplete="off" placeholder="אותו סניף או סניף אחר" value="${esc(bridgeUi.homeBranchNumber||'')}"></label><label><span>מספר חשבון ביתי</span><input id="bankHomeAccountNumberInput" name="homeAccountNumber" type="text" inputmode="numeric" autocomplete="off" placeholder="מספר החשבון הביתי" value="${esc(bridgeUi.homeAccountNumber||'')}"></label><small>היתרה והתנועות נשמרות לתצוגה בלבד ואינן משתתפות באף חישוב עסקי.</small></fieldset>
          </div>
          <div class="bank-sync-form-actions"><button type="button" class="btn" data-action="configure-bank-bridge" ${bridgeUi.busy?'disabled':''}>שמור פרטי הפועלים ושני החשבונות</button><button type="button" class="btn danger-soft" data-action="delete-bank-bridge-credentials" ${bridgeUi.busy||!bridgeUi.configured?'disabled':''}>מחק פרטי התחברות</button></div>
          <small>ה-Bridge משתמש במזהה מלא בנק 12 + סניף + מספר חשבון לכל אחד מהחשבונות. ברענון אחד הוא נכנס פעם אחת לבנק, מאמת ששני החשבונות קיימים, ורק אז קורא את שניהם.</small>
        </form>
      </div>
      <div class="bank-sync-actions"><label class="bank-auto-toggle"><input type="checkbox" data-change="set-bank-auto-refresh" ${bridgeUi.autoEnabled?'checked':''}> <span>עדכון אוטומטי של שני החשבונות פעם ב־4 שעות</span></label></div>
      <div class="soft-note">„רענן” מעדכן את העסקי והביתי באותו סשן בנק. אם החשבון הביתי לא הוגדר, מתעדכן רק העסקי. „פתח אימות בבנק” נדרש רק כשהפועלים מבקש הזדהות מחדש. פרטי ההתחברות נשמרים מוצפנים ורק במחשב המקומי; נתוני החשבונות נשמרים במאגר סינכרון פיננסי נפרד, ותנועות הבנק מתמזגות לארכיון ייעודי שאינו נכלל בגיבויי הקופה.</div>
    </div>
    <div class="bank-transactions-region">${bankTransactionsMarkup(bridgeUi)}</div>
  </section>
  ${staleTotal>0?`<div class="notice warn" style="margin-bottom:16px"><b>צילום העו״ש העסקי ישן ביחס להיום.</b> לצורך חישוב נכון נגרעו גם חיובים שכבר עברו מאז הצילום בסך ${money(staleTotal)}. מומלץ לרענן את היתרה מהבנק.</div>`:''}
  <div class="grid two">
    <section class="section"><div class="section-head"><div><h3>הוצאות מחזור ${esc(cycleLabel)}</h3></div><button type="button" class="btn primary" data-action="open-expense-modal">+ הוצאה חדשה</button></div><div style="overflow:auto"><table><thead><tr><th>תיאור</th><th>סכום</th><th>מועד</th><th>סוג</th><th>חוזרת</th><th></th></tr></thead><tbody>${targetExpenseRows.length?targetExpenseRows.map(r=>`<tr><td><b>${esc(r.description)}</b><div class="muted">${esc(r.account)}</div></td><td class="amount">${money(r.amount)}</td><td>${dateFmt(r.dueDate)}</td><td>${esc(r.type)}</td><td><span class="badge ${esc(r.recurring!==false?'green':'')}">${r.recurring!==false?'כל חודש':'חד־פעמית'}</span></td><td><button type="button" class="iconbtn" data-action="open-expense-modal-2" data-click-arg0="${esc(r.id)}">עריכה</button></td></tr>`).join(''):'<tr><td colspan="6"><div class="empty">אין הוצאות במחזור הזה.</div></td></tr>'}</tbody></table></div></section>
    <section class="section"><div class="section-head"><div><h3>חיובי האשראי העסקיים הקרובים</h3></div></div><div class="section-body"><div class="alert-list">${cycle.nextCreditRows.length?cycle.nextCreditRows.map(x=>`<div class="alert" style="--c:#638f87"><div><b>${esc(x.card)} — ${money(x.amount)}</b><small>${dateFmt(x.date)} · תשלום ${esc(x.part)}/${esc(x.totalParts)} · ${esc(x.description)||'עסקת אשראי'}</small></div></div>`).join(''):'<div class="empty">אין חיובי אשראי עסקיים עתידיים.</div>'}</div></div></section>
  </div>
  <section class="section" style="margin-top:16px"><div class="section-head"><div><h3>הגדרת הוצאות קבועות ונוספות</h3></div></div><div style="overflow:auto"><table><thead><tr><th>תיאור</th><th>חשבון</th><th>סכום</th><th>יום / תאריך בסיס</th><th>סוג</th><th>חוזרת</th><th>פעיל</th><th></th></tr></thead><tbody>${allRows.map(r=>`<tr><td><b>${esc(r.description)}</b></td><td>${esc(r.account)}</td><td class="amount">${money(r.amount)}</td><td>${dateFmt(r.date)}</td><td>${esc(r.type)}</td><td>${r.recurring!==false?'כן':'לא'}</td><td>${r.active?'כן':'לא'}</td><td><button type="button" class="iconbtn" data-action="open-expense-modal-2" data-click-arg0="${esc(r.id)}">עריכה</button></td></tr>`).join('')}</tbody></table></div></section>
  <div class="net-summary"><div class="net-mini"><span>עו״ש עסקי מעודכן</span><b>${formatNullableMoney(long.bank)}</b></div><div class="net-mini"><span>כל האשראי העסקי שנותר</span><b>− ${money(long.credit)}</b></div><div class="net-mini"><span>הוצאות חודש אחד</span><b>− ${money(long.expenses)}</b><small>${monthLabel(long.targetMonth)}</small></div><div class="net-mini"><span>סה״כ קופה</span><b>+ ${money(long.kupa)}</b><small>מזומן + צקים שטרם הופקדו</small></div><div class="net-total"><span>מאזן כולל נטו</span><b>${formatNullableMoney(long.net)}</b><small>עו״ש עסקי − כל האשראים העסקיים העתידיים − חודש הוצאות + קופה</small></div></div>`;
  updateBridgePanel();
  for(const formId of ['bankBridgePairForm','bankBridgeCredentialsForm'])document.getElementById(formId)?.addEventListener('submit',event=>event.preventDefault());
  refreshBankBridgeStatus().then(updateBridgePanel).catch(()=>updateBridgePanel());
}

return {renderBank,setBankAccountView,setBankSearch,toggleBankSyncOptions};
}
