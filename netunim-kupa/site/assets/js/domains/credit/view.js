import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {dateFmt, todayISO, monthKey, monthLabel, addMonthsISO} from '../../core/dates.js';
import {creditMonthlyDetailData,CREDIT_DETAIL_HISTORY_MONTHS} from './model.js';
import {CREDIT_PROVIDER_LABELS,creditCardMappingKey,creditSyncSummary} from './sync-feed.js';

function syncDate(value){if(!value)return 'עדיין לא סונכרן';try{return new Intl.DateTimeFormat('he-IL',{dateStyle:'short',timeStyle:'short'}).format(new Date(value))}catch{return String(value)}}
function synchronizedCardKey(profileId,accountNumber){return `sync:${profileId}:${accountNumber}`}
function creditErrorRows(syncUi,summary){
  const rows=[...(Array.isArray(syncUi?.status?.lastErrors)?syncUi.status.lastErrors:[]),...(Array.isArray(summary?.sync?.errors)?summary.sync.errors:[])],seen=new Set(),out=[];
  for(const row of rows){const key=[row?.profileId,row?.provider,row?.code,row?.stage,row?.message,row?.at].map(x=>String(x||'')).join('|');if(seen.has(key))continue;seen.add(key);out.push(row)}
  return out.sort((a,b)=>(Date.parse(b?.at||'')||0)-(Date.parse(a?.at||'')||0));
}
function creditSyncHeadlineState(syncUi,summary){
  const errors=creditErrorRows(syncUi,summary),latestError=errors[0]||null,lastSync=syncUi?.status?.lastSyncAt||summary?.sync?.syncedAt||null;
  const errorAt=syncUi?.errorAt||latestError?.at||null,lastSyncTime=Date.parse(lastSync||'')||0,errorTime=Date.parse(errorAt||'')||0;
  if(syncUi?.busy)return {tone:'busy',icon:'↻',title:'מסנכרן',meta:'כעת'};
  if(syncUi?.error)return {tone:'error',icon:'!',title:'נכשל',meta:errorAt?syncDate(errorAt):'כעת'};
  if(errors.length){const partial=lastSyncTime&&(!errorTime||lastSyncTime>=errorTime-5000);return {tone:partial?'warn':'error',icon:'!',title:partial?'הושלם חלקית':'נכשל',meta:(partial?lastSync:errorAt)?syncDate(partial?lastSync:errorAt):'זמן לא זמין'};}
  if(lastSync)return {tone:'ok',icon:'✓',title:'הצליח',meta:syncDate(lastSync)};
  return {tone:'idle',icon:'•',title:'טרם סונכרן',meta:'מוכן להגדרה'};
}
function creditSyncHeadlineMarkup(state){return `<span class="credit-sync-state-icon" aria-hidden="true">${esc(state.icon)}</span><span class="credit-sync-state-copy"><b>${esc(state.title)}</b><small>${esc(state.meta)}</small></span>`}
function creditSyncDiagnosticsMarkup(syncUi,summary){
  const errors=creditErrorRows(syncUi,summary),rows=[];
  const localCovered=syncUi?.error&&errors.some(error=>String(syncUi.error).includes(String(error?.message||''))&&String(error?.message||'').length>0);
  if(syncUi?.error&&!localCovered)rows.push(`<div class="credit-sync-detail error"><b>הסנכרון האחרון נכשל</b><span>${esc(syncUi.error)}</span>${syncUi.errorAt?`<small>${esc(syncDate(syncUi.errorAt))}</small>`:''}</div>`);
  for(const error of errors){const label=error?.label||CREDIT_PROVIDER_LABELS[error?.provider]||error?.provider||'חברת אשראי',meta=[error?.code?`קוד: ${error.code}`:'',error?.stage?`שלב: ${error.stage}`:'',error?.httpStatus?`HTTP: ${error.httpStatus}`:'',error?.at?syncDate(error.at):''].filter(Boolean).join(' · ');rows.push(`<div class="credit-sync-detail error"><b>${esc(label)}</b><span>${esc(error?.message||'סנכרון האשראי נכשל')}</span>${meta?`<small>${esc(meta)}</small>`:''}</div>`)}
  return rows.join('');
}
function rowCardKey(row){
  if(row?.creditAccountKey)return row.creditAccountKey;
  if(row?.profileId&&row?.accountNumber)return synchronizedCardKey(row.profileId,row.accountNumber);
  if(row?.source==='manual'&&row?.card)return `manual:${row.card}`;
  return '';
}
function filterMatch(ui,row){
  const account=ui.creditAccountFilter||'all',provider=ui.creditProviderFilter||'all',card=ui.creditCardFilter||'all';
  if(account!=='all'&&row.account!==account)return false;
  if(provider!=='all'&&row.provider!==provider)return false;
  if(card!=='all'&&rowCardKey(row)!==card)return false;
  return true;
}
function summaryCard(row){return row.hidden?'כרטיסים מוסתרים':row.card}
function cardDisplayName(profile,account,mapping={}){return mapping.cardName||`${CREDIT_PROVIDER_LABELS[profile.provider]||profile.label} ••${String(account.accountNumber||'').slice(-4)}`}
function includedCardModels(summary){
  return summary.sync.profiles.flatMap(profile=>profile.accounts.map(account=>{
    const mapping=summary.sync.cardMappings[creditCardMappingKey(profile.profileId,account.accountNumber)]||{};
    return {
      profileId:profile.profileId,
      accountNumber:account.accountNumber,
      creditAccountKey:synchronizedCardKey(profile.profileId,account.accountNumber),
      provider:profile.provider,
      account:mapping.account||profile.defaultAccount||'עסקי',
      ownerLabel:profile.ownerLabel||'',
      name:cardDisplayName(profile,account,mapping),
      hidden:mapping.hidden===true,
      included:mapping.included===true,
    };
  })).filter(x=>x.included);
}
function primaryCardFilterMatch(ui,card){
  const account=ui.creditAccountFilter||'all';
  return account==='all'||card.account===account;
}
function providerFilterMarkup(ui,cards){
  const present=new Set(cards.map(x=>x.provider).filter(Boolean));
  const providers=['visaCal','max','isracard','amex'].filter(p=>present.has(p));
  const button=(value,label,count)=>`<button type="button" class="credit-filter-chip ${ui.creditProviderFilter===value?'active':''}" data-action="credit-provider-filter" data-click-arg0="${esc(value)}"><span>${esc(label)}</span><small>${esc(count)}</small></button>`;
  return `<div class="credit-filter-chip-row"><span class="credit-filter-label">חברת אשראי</span><div class="credit-filter-chips">${button('all','כל החברות',cards.length)}${providers.map(provider=>button(provider,CREDIT_PROVIDER_LABELS[provider]||provider,cards.filter(x=>x.provider===provider).length)).join('')}</div></div>`;
}
function cardFilterMarkup(ui,cards){
  const provider=ui.creditProviderFilter||'all';
  if(provider==='all')return '';
  const scoped=cards.filter(card=>!card.hidden&&card.provider===provider);
  if(!scoped.length)return '';
  return `<div class="credit-filter-chip-row"><span class="credit-filter-label">כרטיסים</span><div class="credit-filter-chips"><button type="button" class="credit-filter-chip ${ui.creditCardFilter==='all'?'active':''}" data-action="credit-card-filter" data-click-arg0="all"><span>כל הכרטיסים</span><small>${esc(scoped.length)}</small></button>${scoped.map(card=>`<button type="button" class="credit-filter-chip card ${ui.creditCardFilter===card.creditAccountKey?'active':''}" data-action="credit-card-filter" data-click-arg0="${esc(card.creditAccountKey)}"><span>${esc(card.name)}</span><small>${esc(card.account)}${card.ownerLabel?` · ${esc(card.ownerLabel)}`:''}</small></button>`).join('')}</div></div>`;
}

export function createDomainsCreditView({model, ui, pendingInstallments, syncBulkUi, bulkControls, bulkHeader, bulkCell,creditSyncUiState,refreshCreditBridgeStatus}){
function renderCredit(){
  const allFuture=pendingInstallments(),summary=creditSyncSummary(model.state),syncUi=creditSyncUiState(),includedCards=includedCardModels(summary);
  if(!['all','עסקי','ביתי'].includes(ui.creditAccountFilter))ui.creditAccountFilter='all';
  const filterCards=includedCards.filter(card=>primaryCardFilterMatch(ui,card));
  const availableProviders=new Set(filterCards.map(x=>x.provider));
  if(ui.creditProviderFilter!=='all'&&!availableProviders.has(ui.creditProviderFilter))ui.creditProviderFilter='all';
  const availableCardKeys=ui.creditProviderFilter==='all'
    ?new Set()
    :new Set(filterCards.filter(x=>!x.hidden&&x.provider===ui.creditProviderFilter).map(x=>x.creditAccountKey));
  if(ui.creditProviderFilter==='all'||(ui.creditCardFilter!=='all'&&!availableCardKeys.has(ui.creditCardFilter)))ui.creditCardFilter='all';

  const future=allFuture.filter(row=>filterMatch(ui,row));
  const businessFuture=future.filter(x=>x.account==='עסקי');
  const currentMonth=monthKey(todayISO()),currentYear=Number(currentMonth.slice(0,4));
  const futureYears=[...new Set(future.map(x=>x.date.slice(0,4)))].map(Number).filter(y=>Number.isFinite(y)&&y>=currentYear);
  const maxYear=Math.max(currentYear+1,...futureYears,currentYear),years=Array.from({length:maxYear-currentYear+1},(_,i)=>String(currentYear+i));
  if(!['rolling12','all',...years].includes(String(ui.creditView)))ui.creditView='rolling12';
  let monthKeys=[],forecastTitle='';
  if(ui.creditView==='rolling12'){monthKeys=Array.from({length:12},(_,i)=>monthKey(addMonthsISO(`${currentMonth}-01`,i)));forecastTitle='תחזית 12 חודשים קדימה'}
  else if(ui.creditView==='all'){monthKeys=[...new Set(future.map(x=>monthKey(x.date)).filter(Boolean))].sort();forecastTitle='כל חיובי האשראי העתידיים'}
  else{monthKeys=Array.from({length:12},(_,i)=>`${ui.creditView}-${String(i+1).padStart(2,'0')}`);forecastTitle=`תחזית ${ui.creditView}`}
  const months=monthKeys.map(k=>{const inst=future.filter(x=>monthKey(x.date)===k);return {k,inst,total:inst.reduce((a,x)=>a+x.amount,0)}}).filter(month=>Math.round(month.total*100)!==0);
  const maxForecast=Math.max(1,...months.map(x=>Math.abs(x.total)));
  const forecastRows=creditForecastColumns(months,maxForecast);

  const syncHeadline=creditSyncHeadlineState(syncUi,summary);
  const syncDiagnostics=creditSyncDiagnosticsMarkup(syncUi,summary);
  const localProfiles=Array.isArray(syncUi.status?.profiles)?syncUi.status.profiles:[];
  const localIds=new Set(localProfiles.map(p=>p.profileId));
  const cloudOnly=summary.sync.profiles.filter(p=>!localIds.has(p.profileId));
  const mappingRows=summary.sync.profiles.flatMap(profile=>profile.accounts.map(account=>creditMappingRow(profile,account,summary.sync.cardMappings)));
  const detailData=creditMonthlyDetailData(model.state),detailMonths=detailData.months.map(month=>{const items=month.items.filter(item=>filterMatch(ui,item));return {...month,items,total:items.reduce((sum,item)=>sum+item.amount,0)}}).filter(month=>month.items.length);
  const detailToday=todayISO(),nearestDetailMonth=detailMonths.find(month=>month.items.some(item=>item.date>=detailToday))?.key||detailMonths.at(-1)?.key||currentMonth;
  let detailFocus=ui.creditDetailFocus;
  if(!detailMonths.length){detailFocus=null;ui.creditDetailFocus=null}
  else{
    if(!detailFocus||!detailMonths.some(month=>month.key===detailFocus.monthKey))detailFocus={monthKey:nearestDetailMonth,cardKey:''};
    const selected=detailMonths.find(month=>month.key===detailFocus.monthKey);
    if(detailFocus.cardKey&&!selected?.items.some(item=>rowCardKey(item)===detailFocus.cardKey))detailFocus={monthKey:detailFocus.monthKey,cardKey:''};
    ui.creditDetailFocus=detailFocus;
  }
  const detailMonth=detailFocus?detailMonths.find(month=>month.key===detailFocus.monthKey):null;
  const detailItems=(detailMonth?.items||[]).filter(item=>!detailFocus?.cardKey||rowCardKey(item)===detailFocus.cardKey);
  const detailFocusLabel=detailFocus?.cardKey?summaryCard(detailMonth?.items.find(item=>rowCardKey(item)===detailFocus.cardKey)||{}):'';

  document.getElementById('content').innerHTML=`
    <section class="section credit-sync-section">
      <details class="credit-sync-settings">
        <summary class="credit-sync-toolbar">
          <span class="credit-sync-primary"><span class="credit-sync-disclosure-label">סינכרון <span class="credit-sync-chevron" aria-hidden="true">⌄</span></span></span>
          <span class="credit-sync-head-actions"><span class="credit-sync-headline ${syncHeadline.tone}">${creditSyncHeadlineMarkup(syncHeadline)}</span><button class="btn primary" type="button" data-action="refresh-credit-sync" ${syncUi.busy?'disabled':''}>${syncUi.busy?'מעדכן…':'רענן'}</button></span>
        </summary>
        <div class="credit-sync-settings-body">
          <div class="credit-sync-settings-top"><div><b>אפשרויות סינכרון אשראי</b><small>פירוט מלא של כשל מופיע כאן. חלון אבחון נפתח רק ברענון יזום.</small></div><button class="btn" type="button" data-action="refresh-credit-sync-interactive" ${syncUi.busy?'disabled':''}>רענן עם חלון אבחון</button></div>
          ${syncDiagnostics?`<div class="credit-sync-diagnostics">${syncDiagnostics}</div>`:''}
          <div class="credit-sync-mode-card"><div><b>מודל נתונים: סנכרון חברות האשראי + תוספות ידניות</b><small>״כלול״ קובע אם הכרטיס מופיע בדוחות האשראי. שיוך ״עסקי״ קובע אם החיובים שלו נכנסים לחישובי הקופה, העו״ש והמאזן; כרטיס ביתי נשאר גלוי בדוחות אך אינו נגרע מהקופה העסקית.</small></div><span class="badge blue">הפרדה מלאה</span></div>
          <div class="credit-sync-settings-grid">
            <div class="credit-sync-panel"><div class="credit-sync-panel-head"><b>חיבורים במחשב זה</b><span class="credit-profile-actions"><button class="btn" type="button" data-action="open-credit-connection">+ חיבור</button><button class="btn danger-soft" type="button" data-action="reset-credit-sync" ${syncUi.busy?'disabled':''}>איפוס מלא</button></span></div>
              ${localProfiles.length?localProfiles.map(p=>creditLocalProfileRow(p)).join(''):'<div class="empty compact">עדיין לא הוגדר חיבור אשראי במחשב זה.</div>'}
              ${cloudOnly.length?`<div class="credit-cloud-only"><b>חיבורים שסונכרנו ממחשב אחר</b>${cloudOnly.map(p=>`<div class="credit-profile-row"><span><b>${esc(p.label)}</b><small>${esc(CREDIT_PROVIDER_LABELS[p.provider]||p.provider)}${p.ownerLabel?` · ${esc(p.ownerLabel)}`:''}</small></span><button class="btn" type="button" data-action="open-credit-connection" data-click-arg0="${esc(p.profileId)}">הגדר גם במחשב זה</button></div>`).join('')}</div>`:''}
            </div>
            <div class="credit-sync-panel"><div class="credit-sync-panel-head"><b>שיוך כרטיסים</b><label class="credit-auto-toggle"><input type="checkbox" data-change="set-credit-auto-refresh" ${syncUi.autoEnabled?'checked':''}> עדכון אוטומטי פעם ביום</label></div>
              ${mappingRows.length?mappingRows.join(''):'<div class="empty compact">לא התקבלו עדיין כרטיסים. בצע סנכרון ראשון.</div>'}
            </div>
          </div>
          <div class="soft-note">כרטיס שלא סומן ״כלול״ נשאר רק באזור ההגדרות ואינו מעמיס על התחזית והדוחות. ״הסתר״ ממשיך להיות אפשרות תצוגה בלבד. פרטי הכניסה נשמרים מוצפנים רק ב‑Windows; נתוני הסנכרון והשיוכים נשמרים במצב הקופה ויכולים להישמר בענן.</div>
        </div>
      </details>
    </section>

    <div class="toolbar credit-filter-toolbar">
      <div class="credit-filter-primary">
        <div class="credit-filter-selects">
          <select aria-label="טווח תחזית אשראי" data-change="credit-view"><option value="rolling12" ${ui.creditView==='rolling12'?'selected':''}>12 חודשים קדימה</option><option value="all" ${ui.creditView==='all'?'selected':''}>כל השנים</option><optgroup label="לפי שנה">${years.map(y=>`<option value="${esc(y)}" ${ui.creditView===y?'selected':''}>${esc(y)}</option>`).join('')}</optgroup></select>
          <select aria-label="סינון עסקי או ביתי" data-change="credit-account-filter"><option value="all" ${ui.creditAccountFilter==='all'?'selected':''}>עסקי + ביתי</option><option value="עסקי" ${ui.creditAccountFilter==='עסקי'?'selected':''}>עסקי בלבד</option><option value="ביתי" ${ui.creditAccountFilter==='ביתי'?'selected':''}>ביתי בלבד</option></select>
        </div>
        <div class="credit-filter-stats"><span class="stat-pill">סה״כ: ${money(future.reduce((a,x)=>a+x.amount,0))}</span><span class="stat-pill business">מתוכם עסקי: ${money(businessFuture.reduce((a,x)=>a+x.amount,0))}</span>${bulkControls('credits')}<button class="btn primary" data-action="open-credit-modal">+ תוספת ידנית</button></div>
      </div>
      <div class="credit-filter-chip-stack">${providerFilterMarkup(ui,filterCards)}${cardFilterMarkup(ui,filterCards)}</div>
    </div>

    <section class="section credit-forecast-section"><div class="section-head"><div><h3>${esc(forecastTitle)}</h3></div></div><div class="section-body"><div class="credit-forecast-list">${forecastRows}</div></div></section>

    <section id="credit-active-transactions" class="section credit-detail-section" style="margin-top:16px"><div class="section-head credit-detail-section-head"><div><h3 title="מוצגים עד ${esc(CREDIT_DETAIL_HISTORY_MONTHS)} חודשים קודמים וכל החיובים העתידיים שהתקבלו מהחברות">עסקאות ותשלומים</h3></div>${creditDetailMonthTabs(detailMonths,detailFocus?.monthKey||'')}</div>${detailFocus?.cardKey?`<div class="credit-detail-focus"><span><b>${esc(detailFocusLabel)}</b><small>${esc(monthLabel(detailFocus.monthKey))} · מיקוד בכרטיס מתוך התחזית</small></span><button type="button" class="iconbtn" data-action="clear-credit-detail-focus" data-click-arg0="${esc(detailFocus.monthKey)}">כל הכרטיסים ×</button></div>`:''}<div class="credit-detail-table-wrap"><table class="credit-detail-table"><thead><tr>${bulkHeader('credits')}<th class="credit-detail-col-card">כרטיס</th><th class="credit-detail-col-description">תיאור</th><th class="credit-detail-col-transaction-date">תאריך עסקה</th><th class="credit-detail-col-charge">חיוב בחודש</th><th class="credit-detail-col-installment">תשלום</th><th class="credit-detail-col-total">סכום עסקה</th><th class="credit-detail-col-status">מצב</th><th class="credit-detail-col-actions"></th></tr></thead><tbody>${detailItems.length?detailItems.map(creditMonthlyDetailRow).join(''):`<tr><td colspan="${ui.bulkCollection==='credits'?9:8}"><div class="empty compact">${detailMonths.length?'אין עסקאות להצגה בחודש שנבחר.':`אין עסקאות ידועות בשלושת החודשים הקודמים או בחודשים העתידיים במסנן הנוכחי.`}</div></td></tr>`}</tbody></table></div></section>
    ${summary.hasData?renderSyncedAccounts(summary):''}`;

  syncBulkUi('credits');
  if(!syncUi.status&&!syncUi.busy)refreshCreditBridgeStatus({quiet:true}).then(status=>{if(ui.currentPage==='credit'&&status)renderCredit()}).catch(()=>{});
}

function creditLocalProfileRow(p){return `<div class="credit-profile-row"><span><b>${esc(p.label)}</b><small>${esc(CREDIT_PROVIDER_LABELS[p.provider]||p.provider)}${p.ownerLabel?` · ${esc(p.ownerLabel)}`:''} · ברירת מחדל ${esc(p.defaultAccount)}</small></span><span class="credit-profile-actions"><button class="btn" type="button" data-action="open-credit-connection" data-click-arg0="${esc(p.profileId)}">עריכה</button><button class="btn danger-soft" type="button" data-action="delete-credit-connection" data-click-arg0="${esc(p.profileId)}">מחיקה מהמחשב</button></span></div>`}
function creditMappingRow(profile,account,mappings){
  const key=creditCardMappingKey(profile.profileId,account.accountNumber),mapping=mappings[key]||{},included=mapping.included===true,hidden=mapping.hidden===true,accountClass=mapping.account||profile.defaultAccount||'עסקי',cardName=mapping.cardName||'';
  const calculationText=included?(accountClass==='עסקי'?'מוצג בדוחות · משפיע על הקופה':'מוצג בדוחות · לא משפיע על הקופה'):'זוהה בלבד';
  return `<div class="credit-mapping-row ${included?'included':'excluded'} ${hidden?'hidden-card':''}">
    <label class="credit-card-include"><input type="checkbox" data-change="set-credit-card-included" data-change-arg0="${esc(profile.profileId)}" data-change-arg1="${esc(account.accountNumber)}" ${included?'checked':''}><span>${included?'כלול':'לא כלול'}</span></label>
    <label class="credit-card-hide"><input type="checkbox" data-change="set-credit-card-hidden" data-change-arg0="${esc(profile.profileId)}" data-change-arg1="${esc(account.accountNumber)}" ${hidden?'checked':''}><span>${hidden?'מוסתר':'הסתר'}</span></label>
    <span><b>${esc(CREDIT_PROVIDER_LABELS[profile.provider]||profile.provider)} • ${esc(account.accountNumber||'כרטיס')}</b><small>${esc(profile.label)}${profile.ownerLabel?` · ${esc(profile.ownerLabel)}`:''} · ${esc(calculationText)}${hidden?' · מוסתר מהפירוט':''}</small></span>
    <select aria-label="שיוך חשבון" data-change="set-credit-card-account" data-change-arg0="${esc(profile.profileId)}" data-change-arg1="${esc(account.accountNumber)}"><option ${accountClass==='עסקי'?'selected':''}>עסקי</option><option ${accountClass==='ביתי'?'selected':''}>ביתי</option></select>
    <input aria-label="שם הכרטיס" data-change="set-credit-card-name" data-change-arg0="${esc(profile.profileId)}" data-change-arg1="${esc(account.accountNumber)}" value="${esc(cardName)}" placeholder="שם תצוגה (רשות)">
  </div>`
}

function renderSyncedAccounts(summary){
  const cardModels=summary.sync.profiles.flatMap(p=>p.accounts.map(a=>{
    const mapping=summary.sync.cardMappings[creditCardMappingKey(p.profileId,a.accountNumber)]||{},included=mapping.included===true,hidden=mapping.hidden===true,accountClass=mapping.account||p.defaultAccount,name=cardDisplayName(p,a,mapping);
    return {p,a,mapping,included,hidden,account:accountClass,ownerLabel:p.ownerLabel||'',name,provider:p.provider,profileId:p.profileId,accountNumber:a.accountNumber,creditAccountKey:synchronizedCardKey(p.profileId,a.accountNumber)};
  })).filter(x=>x.included&&!x.hidden&&filterMatch(ui,x));
  const cards=cardModels.map(({p,a,account,name})=>{const pending=a.txns.filter(tx=>tx.status==='pending').length;return `<article class="credit-live-card included"><div><b>${esc(name)}</b><small>${esc(p.label)}${p.ownerLabel?` · ${esc(p.ownerLabel)}`:''} · ${esc(account)} · <span class="credit-card-state on">כלול בדוחות</span></small></div><div class="credit-live-balance"><span>${a.balance===null?'יתרה/חיוב קרוב לא זמין':'חיוב/יתרה שהחברה החזירה'}</span><b>${a.balance===null?'—':money(Math.abs(a.balance))}</b></div>${creditFrameMarkup(a,p.provider)}<small>${a.txns.length} תנועות${pending?` · ${pending} ממתינות`:''}${a.balanceDate?` · נכון ל־${dateFmt(String(a.balanceDate).slice(0,10))}`:''}</small></article>`}).join('');
  return `<details class="section credit-collapsible-section credit-live-section" style="margin-top:16px"><summary class="credit-section-toggle"><span><b>נתונים חיים מחברות האשראי</b><small>${esc(cardModels.length)} כרטיסים כלולים במסנן · נתוני מסגרת, יתרה ותנועות גולמיות</small></span><span class="credit-toggle-chevron" aria-hidden="true">⌄</span></summary><div class="credit-collapsible-body"><div class="credit-live-grid">${cards||'<div class="empty compact">אין כרטיסים כלולים וגלויים במסנן הנוכחי.</div>'}</div></div></details>`
}
function creditFrameMarkup(account,provider){
  const frame=account.cardFrame,available=account.availableCredit;
  if(frame===null&&available===null)return '<div class="credit-live-frame unavailable"><span>מסגרת פנויה</span><b>לא נמסרה</b></div>';
  return `<div class="credit-live-frame"><span>${available!==null?`מסגרת פנויה${provider==='max'?' · נתון MAX':''}`:'מסגרת כוללת · פנויה לא נמסרה'}</span><b>${available!==null?money(available):money(frame)}</b>${available!==null&&frame!==null?`<small>מתוך ${money(frame)}</small>`:''}</div>`;
}
function creditDetailMonthTabs(months,selectedKey){
  if(!months.length)return '<div class="credit-detail-month-empty">אין חיובים להצגה</div>';
  const current=monthKey(todayISO());
  return `<div class="credit-detail-month-tabs" role="tablist" aria-label="בחירת חודש לעסקאות ותשלומים">${months.map(month=>{const timing=month.key<current?'past':month.key===current?'current':'future';return `<button type="button" role="tab" aria-selected="${month.key===selectedKey?'true':'false'}" class="credit-detail-month-tab ${month.key===selectedKey?'active':''} ${timing}" data-action="credit-detail-month" data-click-arg0="${esc(month.key)}"><span>${esc(monthLabel(month.key))}</span><b>${money(month.total)}</b></button>`}).join('')}</div>`;
}
function creditMonthlyDetailRow(item){return item.source==='manual'?manualMonthlyCreditRow(item):syncedMonthlyCreditRow(item)}
function chargeStatus(date){const today=todayISO();if(date<today)return {label:'חויב',cls:'blue'};if(date===today)return {label:'היום',cls:'green'};return {label:'עתידי',cls:'green'}}
function transactionDateCell(value){return value?dateFmt(String(value).slice(0,10)):'<span class="muted">לא נמסר</span>'}
function installmentCell(item){return Number(item.totalParts)>1?`<b>תשלום ${esc(item.part)}/${esc(item.totalParts)}</b>`:'<span class="muted">תשלום אחד</span>'}
function creditCardDetailCell(item,sourceLabel){
  const meta=[item.account,item.ownerLabel,sourceLabel].filter(Boolean).join(' · ');
  return `<td class="credit-detail-card" title="${esc(item.card)}"><b>${esc(item.card)}</b><small>${esc(meta)}</small></td>`;
}
function syncedBulkPlaceholder(){return ui.bulkCollection==='credits'?'<td class="bulk-check-col"></td>':''}
function syncedMonthlyCreditRow(item){
  const series=item.series,status=chargeStatus(item.date),partial=series.partial&&item.date>=todayISO();
  return `<tr class="credit-synced-detail-row">${syncedBulkPlaceholder()}${creditCardDetailCell(item,CREDIT_PROVIDER_LABELS[item.provider]||'מסונכרן')}<td class="credit-detail-description" title="${esc(item.description||'')}">${esc(item.description)||'—'}</td><td class="credit-detail-transaction-date">${transactionDateCell(item.transactionDate)}</td><td class="credit-detail-charge"><b>${dateFmt(item.date)}</b><div class="amount credit-month-charge-amount">${money(item.amount)}</div></td><td class="credit-detail-installment">${installmentCell(item)}</td><td class="amount credit-detail-total">${money(series.totalAmount)}</td><td class="credit-detail-status"><span class="badge ${esc(status.cls)}">${esc(status.label)}</span>${partial?'<div class="muted credit-detail-partial">אופק חלקי</div>':''}</td><td class="credit-detail-actions"></td></tr>`;
}
function manualMonthlyCreditRow(item){
  const record=item.record,status=chargeStatus(item.date);
  return `<tr data-bulk-collection="credits" data-bulk-id="${esc(record.id)}" class="${esc(ui.bulkSelected.has(record.id)?'bulk-selected-row':'')}">${bulkCell('credits',record.id)}${creditCardDetailCell(item,'תוספת ידנית')}<td class="credit-detail-description" title="${esc(item.description||'')}">${esc(item.description)||'—'}</td><td class="credit-detail-transaction-date">${transactionDateCell(item.transactionDate)}</td><td class="credit-detail-charge"><b>${dateFmt(item.date)}</b><div class="amount credit-month-charge-amount">${money(item.amount)}</div></td><td class="credit-detail-installment">${installmentCell(item)}</td><td class="amount credit-detail-total">${money(record.totalAmount)}</td><td class="credit-detail-status"><span class="badge ${esc(status.cls)}">${esc(status.label)}</span></td><td class="credit-detail-actions"><button class="iconbtn" data-action="open-credit-modal-2" data-click-arg0="${esc(record.id)}">עריכה</button></td></tr>`;
}
function creditForecastColumns(months,max){
  if(!months.length)return '<div class="empty">אין חיובי אשראי עתידיים.</div>';
  const split=Math.ceil(months.length/2),columns=[months.slice(0,split),months.slice(split)];
  return columns.filter(column=>column.length).map(column=>`<div class="credit-forecast-column">${column.map(month=>creditMonthRow(month,max)).join('')}</div>`).join('');
}
function creditMonthRow(m,max){
  const cur=monthKey(todayISO())===m.k,past=m.k<monthKey(todayISO()),groups=new Map();
  for(const row of m.inst){
    const card=summaryCard(row),account=row.hidden?'':row.account,owner=row.hidden?'':String(row.ownerLabel||''),cardKey=row.hidden?'':rowCardKey(row);
    const key=row.hidden?'hidden':(cardKey||`${card}\u0000${account}\u0000${owner}`),existing=groups.get(key)||{card,account,owner,cardKey,total:0};
    existing.total+=row.amount;groups.set(key,existing);
  }
  const pct=Math.max(2,Math.abs(m.total)/max*100);
  const detail=[...groups.values()].sort((a,b)=>String(a.card).localeCompare(String(b.card),'he')).map(item=>{
    const content=`<span><b>${esc(item.card)}</b>${item.account?`<small>${esc(item.account)}${item.owner?` · ${esc(item.owner)}`:''}</small>`:''}</span><strong>${money(item.total)}</strong>`;
    return item.cardKey?`<button type="button" class="credit-forecast-card credit-forecast-card-button" data-action="credit-detail-focus" data-click-arg0="${esc(m.k)}" data-click-arg1="${esc(item.cardKey)}">${content}</button>`:`<div class="credit-forecast-card">${content}</div>`;
  }).join('');
  return `<details class="credit-forecast-month ${cur?'current':''}"><summary><span class="credit-forecast-row"><b>${esc(monthLabel(m.k))}${cur?' <em>החודש</em>':past?' <em class="past">עבר</em>':''}</b><span class="bar"><i style="width:${esc(pct)}%"></i></span><span class="num">${money(m.total)}</span><span class="credit-toggle-chevron" aria-hidden="true">⌄</span></span></summary><div class="credit-forecast-breakdown">${detail||`<div class="muted">${past?'אין חיובים עתידיים':'אין חיובים'}</div>`}</div></details>`;
}
function creditMonthCard(m){return creditMonthRow(m,Math.max(1,Math.abs(m.total)))}
return {renderCredit,creditMonthCard};
}
