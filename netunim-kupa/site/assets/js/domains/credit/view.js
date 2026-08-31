import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {dateFmt, todayISO, monthKey, monthLabel, addMonthsISO} from '../../core/dates.js';
import {rawCreditSchedule,creditProgress,creditDetailPartitionsData,CREDIT_DETAIL_HISTORY_DAYS} from './model.js';
import {CREDIT_PROVIDER_LABELS,creditCardMappingKey,creditSyncSummary} from './sync-feed.js';

function syncDate(value){if(!value)return 'עדיין לא סונכרן';try{return new Intl.DateTimeFormat('he-IL',{dateStyle:'short',timeStyle:'short'}).format(new Date(value))}catch{return String(value)}}
function uniqueOwners(model,summary){return [...new Set([...summary.sync.profiles.map(p=>p.ownerLabel),...(model.state.credits||[]).map(cr=>cr.ownerLabel)].map(x=>String(x||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'he'))}
function synchronizedCardKey(profileId,accountNumber){return `sync:${profileId}:${accountNumber}`}
function rowCardKey(row){return row?.creditAccountKey||(row?.profileId&&row?.accountNumber?synchronizedCardKey(row.profileId,row.accountNumber):'')}
function filterMatch(ui,row){
  const account=ui.creditAccountFilter||'all',owner=ui.creditOwnerFilter||'all',provider=ui.creditProviderFilter||'all',card=ui.creditCardFilter||'all';
  if(account!=='all'&&row.account!==account)return false;
  if(owner!=='all'&&String(row.ownerLabel||'')!==owner)return false;
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
  const account=ui.creditAccountFilter||'all',owner=ui.creditOwnerFilter||'all';
  if(account!=='all'&&card.account!==account)return false;
  if(owner!=='all'&&String(card.ownerLabel||'')!==owner)return false;
  return true;
}
function providerFilterMarkup(ui,cards){
  const present=new Set(cards.map(x=>x.provider).filter(Boolean));
  const providers=['visaCal','max','isracard','amex'].filter(p=>present.has(p));
  const button=(value,label,count)=>`<button type="button" class="credit-filter-chip ${ui.creditProviderFilter===value?'active':''}" data-action="credit-provider-filter" data-click-arg0="${esc(value)}"><span>${esc(label)}</span><small>${esc(count)}</small></button>`;
  return `<div class="credit-filter-chip-row"><span class="credit-filter-label">חברת אשראי</span><div class="credit-filter-chips">${button('all','כל החברות',cards.length)}${providers.map(provider=>button(provider,CREDIT_PROVIDER_LABELS[provider]||provider,cards.filter(x=>x.provider===provider).length)).join('')}</div></div>`;
}
function cardFilterMarkup(ui,cards){
  const scoped=cards.filter(card=>!card.hidden&&(ui.creditProviderFilter==='all'||card.provider===ui.creditProviderFilter));
  if(!scoped.length)return '';
  return `<div class="credit-filter-chip-row"><span class="credit-filter-label">כרטיסים</span><div class="credit-filter-chips"><button type="button" class="credit-filter-chip ${ui.creditCardFilter==='all'?'active':''}" data-action="credit-card-filter" data-click-arg0="all"><span>כל הכרטיסים</span><small>${esc(scoped.length)}</small></button>${scoped.map(card=>`<button type="button" class="credit-filter-chip card ${ui.creditCardFilter===card.creditAccountKey?'active':''}" data-action="credit-card-filter" data-click-arg0="${esc(card.creditAccountKey)}"><span>${esc(card.name)}</span><small>${esc(card.account)}${card.ownerLabel?` · ${esc(card.ownerLabel)}`:''}</small></button>`).join('')}</div></div>`;
}

export function createDomainsCreditView({model, ui, pendingInstallments, syncBulkUi, bulkControls, bulkHeader, bulkCell,creditSyncUiState,refreshCreditBridgeStatus}){
function renderCredit(){
  const allFuture=pendingInstallments(),summary=creditSyncSummary(model.state),syncUi=creditSyncUiState(),owners=uniqueOwners(model,summary),includedCards=includedCardModels(summary);
  if(!['all','עסקי','ביתי'].includes(ui.creditAccountFilter))ui.creditAccountFilter='all';
  if(ui.creditOwnerFilter!=='all'&&!owners.includes(ui.creditOwnerFilter))ui.creditOwnerFilter='all';
  const filterCards=includedCards.filter(card=>primaryCardFilterMatch(ui,card));
  const availableProviders=new Set(filterCards.map(x=>x.provider));
  if(ui.creditProviderFilter!=='all'&&!availableProviders.has(ui.creditProviderFilter))ui.creditProviderFilter='all';
  const availableCardKeys=new Set(filterCards.filter(x=>!x.hidden&&(ui.creditProviderFilter==='all'||x.provider===ui.creditProviderFilter)).map(x=>x.creditAccountKey));
  if(ui.creditCardFilter!=='all'&&!availableCardKeys.has(ui.creditCardFilter))ui.creditCardFilter='all';

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
  const months=monthKeys.map(k=>{const inst=future.filter(x=>monthKey(x.date)===k);return {k,inst,total:inst.reduce((a,x)=>a+x.amount,0)}});
  const maxForecast=Math.max(1,...months.map(x=>Math.abs(x.total)));
  const forecastRows=creditForecastColumns(months,maxForecast);

  const statusClass=syncUi.busy?'busy':syncUi.error?'error':summary.sync.errors.length?'warn':summary.hasData?'ok':'';
  const statusTitle=syncUi.busy?'מסנכרן חברות אשראי…':syncUi.error?'סנכרון האשראי נכשל':summary.sync.errors.length?'הסנכרון האחרון הושלם חלקית':summary.hasData?'נתוני חברות האשראי זמינים':'חיבור אוטומטי לחברות האשראי';
  const statusSub=syncUi.error?syncUi.error:summary.sync.errors.length?summary.sync.errors.map(e=>`${e.label||e.provider}: ${e.message}`).join(' · '):`עדכון אחרון: ${syncDate(summary.sync.syncedAt)}`;
  const localProfiles=Array.isArray(syncUi.status?.profiles)?syncUi.status.profiles:[];
  const localIds=new Set(localProfiles.map(p=>p.profileId));
  const cloudOnly=summary.sync.profiles.filter(p=>!localIds.has(p.profileId));
  const mappingRows=summary.sync.profiles.flatMap(profile=>profile.accounts.map(account=>creditMappingRow(profile,account,summary.sync.cardMappings)));
  const detailPartitions=creditDetailPartitionsData(model.state),detailItems=detailPartitions.active.filter(item=>filterMatch(ui,item)),historyItems=detailPartitions.history.filter(item=>filterMatch(ui,item));

  document.getElementById('content').innerHTML=`
    <section class="section credit-sync-section">
      <details class="credit-sync-settings">
        <summary class="credit-sync-toolbar">
          <div class="credit-sync-headline ${statusClass}"><span class="credit-sync-state-icon">${syncUi.busy?'↻':syncUi.error?'!':summary.sync.errors.length?'!':summary.hasData?'✓':'◌'}</span><span class="credit-sync-state-copy"><b>${esc(statusTitle)}</b><small>${esc(statusSub)}</small></span></div>
          <div class="credit-sync-head-actions"><button class="btn primary" type="button" data-action="refresh-credit-sync">רענן אשראי עכשיו</button><button class="btn" type="button" data-action="refresh-credit-sync-interactive">רענן עם חלון אבחון</button></div><span class="credit-sync-chevron">⌄</span>
        </summary>
        <div class="credit-sync-settings-body">
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
      <div class="credit-filter-selects">
        <select aria-label="טווח תחזית אשראי" data-change="credit-view"><option value="rolling12" ${ui.creditView==='rolling12'?'selected':''}>12 חודשים קדימה</option><option value="all" ${ui.creditView==='all'?'selected':''}>כל השנים</option><optgroup label="לפי שנה">${years.map(y=>`<option value="${esc(y)}" ${ui.creditView===y?'selected':''}>${esc(y)}</option>`).join('')}</optgroup></select>
        <select aria-label="סינון עסקי או ביתי" data-change="credit-account-filter"><option value="all" ${ui.creditAccountFilter==='all'?'selected':''}>עסקי + ביתי</option><option value="עסקי" ${ui.creditAccountFilter==='עסקי'?'selected':''}>עסקי בלבד</option><option value="ביתי" ${ui.creditAccountFilter==='ביתי'?'selected':''}>ביתי בלבד</option></select>
        <select aria-label="סינון לפי בעל כרטיס" data-change="credit-owner-filter"><option value="all" ${ui.creditOwnerFilter==='all'?'selected':''}>כל בעלי הכרטיסים</option>${owners.map(owner=>`<option value="${esc(owner)}" ${ui.creditOwnerFilter===owner?'selected':''}>${esc(owner)}</option>`).join('')}</select>
      </div>
      <div class="credit-filter-stats"><span class="stat-pill">סה״כ במסנן: ${money(future.reduce((a,x)=>a+x.amount,0))}</span><span class="stat-pill business">מתוכם עסקי: ${money(businessFuture.reduce((a,x)=>a+x.amount,0))}</span>${bulkControls('credits')}<button class="btn primary" data-action="open-credit-modal">+ תוספת ידנית</button></div>
      <div class="credit-filter-chip-stack">${providerFilterMarkup(ui,filterCards)}${cardFilterMarkup(ui,filterCards)}</div>
    </div>

    <section class="section credit-forecast-section"><div class="section-head"><div><h3>${esc(forecastTitle)}</h3><p>אותו מבנה קומפקטי של לוח הבקרה: חודש, חיווי יחסי וסכום. לחיצה על חודש פותחת פירוט לפי הכרטיסים שלו.</p></div></div><div class="section-body"><div class="credit-forecast-list">${forecastRows}</div></div></section>

    <section class="section credit-detail-section" style="margin-top:16px"><div class="section-head"><div><h3>עסקאות ותשלומים פעילים</h3><p>המסננים למעלה חלים גם כאן. מוצגות רק עסקאות שנותר בהן חיוב עתידי; עסקאות שהסתיימו עוברות להיסטוריה.</p></div></div><div style="overflow:auto"><table><thead><tr>${bulkHeader('credits')}<th>כרטיס</th><th>תיאור</th><th>סכום כולל</th><th>התקדמות</th><th>תשלום הבא</th><th>יתרה עתידית</th><th>מצב</th><th></th></tr></thead><tbody>${detailItems.length?detailItems.map(item=>item.source==='manual'?manualCreditRow(item.record):syncedCreditRow(item.series)).join(''):`<tr><td colspan="9"><div class="empty compact">אין עסקאות פעילות להצגה במסנן הנוכחי.</div></td></tr>`}</tbody></table></div></section>

    ${creditHistoryMarkup(historyItems,detailPartitions.olderCount)}
    ${creditMonthlySummaryDetails(future)}
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
function creditMonthlySummaryDetails(rows){
  const total=rows.reduce((sum,row)=>sum+row.amount,0);
  return `<details class="section credit-collapsible-section credit-month-summary-section" style="margin-top:16px"><summary class="credit-section-toggle"><span><b>סיכום חודשי לפי כרטיס</b><small>${rows.length?`לפי המסנן הפעיל · סה״כ ${money(total)}`:'אין חיובים עתידיים במסנן הנוכחי'}</small></span><span class="credit-toggle-chevron" aria-hidden="true">⌄</span></summary><div class="credit-collapsible-body">${creditMonthlySummaryMarkup(rows)}</div></details>`;
}
function creditMonthlySummaryMarkup(rows){
  if(!rows.length)return '<div class="soft-note credit-empty-note">אין חיובים עתידיים במסנן הנוכחי.</div>';
  const months=[...new Set(rows.map(r=>monthKey(r.date)).filter(Boolean))].sort(),cards=[...new Set(rows.map(summaryCard).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'he'));
  const by=new Map(),cardTotals=new Map(cards.map(c=>[c,0]));let grand=0;
  for(const row of rows){const mk=monthKey(row.date),card=summaryCard(row),key=`${mk}\u0000${card}`;by.set(key,(by.get(key)||0)+row.amount);cardTotals.set(card,(cardTotals.get(card)||0)+row.amount);grand+=row.amount}
  return `<div class="credit-month-summary"><div class="credit-month-summary-scroll"><table><thead><tr><th>חודש</th>${cards.map(card=>`<th>${esc(card)}</th>`).join('')}<th>סה״כ חודש</th></tr></thead><tbody>${months.map(m=>{let total=0;const cells=cards.map(card=>{const v=by.get(`${m}\u0000${card}`)||0;total+=v;return `<td class="amount">${v?money(v):'—'}</td>`}).join('');return `<tr><th>${esc(monthLabel(m))}</th>${cells}<td class="amount total">${money(total)}</td></tr>`}).join('')}</tbody><tfoot><tr><th>סה״כ לכרטיס</th>${cards.map(card=>`<td class="amount">${money(cardTotals.get(card)||0)}</td>`).join('')}<td class="amount total">${money(grand)}</td></tr></tfoot></table></div></div>`;
}
function creditHistoryMarkup(items,olderCount){
  if(!items.length&&!olderCount)return '';
  const rows=items.map(item=>item.source==='manual'?manualCreditRow(item.record,{historical:true}):syncedCreditRow(item.series,{historical:true})).join('');
  return `<details class="section credit-history-section" style="margin-top:16px"><summary><span><b>היסטוריית עסקאות שהסתיימו · ${esc(CREDIT_DETAIL_HISTORY_DAYS)} ימים</b><small>${esc(items.length)} עסקאות במסנן הנוכחי${olderCount?` · ${esc(olderCount)} רשומות ישנות יותר נשמרות במקור ואינן מוצגות`:''}</small></span><span aria-hidden="true">⌄</span></summary><div style="overflow:auto"><table><thead><tr>${bulkHeader('credits')}<th>כרטיס</th><th>תיאור</th><th>סכום כולל</th><th>התקדמות</th><th>חיוב אחרון</th><th>יתרה עתידית</th><th>מצב</th><th></th></tr></thead><tbody>${rows||`<tr><td colspan="9"><div class="empty compact">אין עסקאות שהסתיימו ב־${esc(CREDIT_DETAIL_HISTORY_DAYS)} הימים האחרונים במסנן הנוכחי.</div></td></tr>`}</tbody></table></div></details>`;
}
function syncedCreditRow(series,{historical=false}={}){
  const pct=series.totalParts?Math.min(100,(series.completedCount/series.totalParts)*100):0,status=series.complete?'הסתיים':series.partial?'אופק חלקי':'פעיל',showCompleted=Number(series.totalParts)>1;
  return `<tr class="credit-synced-detail-row"><td></td><td><b>${esc(series.card)}</b><div class="muted">${esc(series.account)}${series.ownerLabel?` · ${esc(series.ownerLabel)}`:''} · ${esc(CREDIT_PROVIDER_LABELS[series.provider]||'מסונכרן')}</div></td><td>${esc(series.description)||'—'}</td><td class="amount">${money(series.totalAmount)}</td><td><div class="credit-progress"><b>${historical?'הושלמו':'נותרו'} ${esc(historical?series.completedCount:series.remainingCount)} מתוך ${esc(series.totalParts)}</b><div class="progress-mini"><div class="progress-track"><i style="width:${esc(pct)}%"></i></div>${showCompleted?`<div class="muted" style="margin-top:4px">בוצעו ${esc(series.completedCount)}</div>`:''}</div></div></td><td>${historical?(series.lastChargeDate?dateFmt(series.lastChargeDate):'—'):series.next?`${dateFmt(series.next.date)}<div class="muted">תשלום ${esc(series.next.part)}/${esc(series.next.totalParts)} · ${money(series.next.amount)}</div>`:series.remainingCount?'<span class="muted">לא התקבל תשלום עתידי באופק הסנכרון</span>':'—'}</td><td class="amount">${series.partial?'<span class="muted">לפחות </span>':''}${money(series.remainingAmount)}</td><td><span class="badge ${esc(status==='פעיל'?'green':status==='הסתיים'?'blue':'')}">${esc(status)}</span></td><td></td></tr>`
}
function manualCreditRow(cr,{historical=false}={}){const p=creditProgress(cr),schedule=rawCreditSchedule(cr),completedCount=historical?schedule.length:p.completedCount,pct=cr.installments?Math.min(100,(completedCount/cr.installments)*100):0,status=!cr.active?'לא פעיל':p.complete?'הסתיים':'פעיל',last=schedule.at(-1)?.date||'',showCompleted=Number(cr.installments)>1;return `<tr data-bulk-collection="credits" data-bulk-id="${esc(cr.id)}" class="${esc(ui.bulkSelected.has(cr.id)?'bulk-selected-row':'')}">${bulkCell('credits',cr.id)}<td><b>${esc(cr.card)}</b><div class="muted">${esc(cr.account)}${cr.ownerLabel?` · ${esc(cr.ownerLabel)}`:''} · תוספת ידנית</div></td><td>${esc(cr.description)||'—'}</td><td class="amount">${money(cr.totalAmount)}</td><td><div class="credit-progress"><b>${historical?'הושלמו':'נותרו'} ${esc(historical?completedCount:p.remainingCount)} מתוך ${esc(cr.installments)}</b><div class="progress-mini"><div class="progress-track"><i style="width:${esc(pct)}%"></i></div>${showCompleted?`<div class="muted" style="margin-top:4px">בוצעו ${esc(completedCount)}</div>`:''}</div></div></td><td>${historical?(last?dateFmt(last):'—'):p.next?`${dateFmt(p.next.date)}<div class="muted">תשלום ${esc(p.next.part)}/${esc(p.next.totalParts)} · ${money(p.next.amount)}</div>`:'—'}</td><td class="amount">${money(p.remainingAmount)}</td><td><span class="badge ${esc(status==='פעיל'?'green':status==='הסתיים'?'blue':'')}">${esc(status)}</span></td><td><button class="iconbtn" data-action="open-credit-modal-2" data-click-arg0="${esc(cr.id)}">עריכה</button></td></tr>`}
function creditForecastColumns(months,max){
  if(!months.length)return '<div class="empty">אין חיובי אשראי עתידיים.</div>';
  const split=Math.ceil(months.length/2),columns=[months.slice(0,split),months.slice(split)];
  return columns.filter(column=>column.length).map(column=>`<div class="credit-forecast-column">${column.map(month=>creditMonthRow(month,max)).join('')}</div>`).join('');
}
function creditMonthRow(m,max){
  const cur=monthKey(todayISO())===m.k,past=m.k<monthKey(todayISO()),groups=new Map();
  for(const row of m.inst){const card=summaryCard(row),account=row.hidden?'':row.account,owner=row.hidden?'':String(row.ownerLabel||''),key=`${card}\u0000${account}\u0000${owner}`,existing=groups.get(key)||{card,account,owner,total:0};existing.total+=row.amount;groups.set(key,existing)}
  const pct=Math.max(2,Math.abs(m.total)/max*100);
  const detail=[...groups.values()].sort((a,b)=>String(a.card).localeCompare(String(b.card),'he')).map(item=>`<div class="credit-forecast-card"><span><b>${esc(item.card)}</b>${item.account?`<small>${esc(item.account)}${item.owner?` · ${esc(item.owner)}`:''}</small>`:''}</span><strong>${money(item.total)}</strong></div>`).join('');
  return `<details class="credit-forecast-month ${cur?'current':''}"><summary><span class="credit-forecast-row"><b>${esc(monthLabel(m.k))}${cur?' <em>החודש</em>':past?' <em class="past">עבר</em>':''}</b><span class="bar"><i style="width:${esc(pct)}%"></i></span><span class="num">${money(m.total)}</span><span class="credit-toggle-chevron" aria-hidden="true">⌄</span></span></summary><div class="credit-forecast-breakdown">${detail||`<div class="muted">${past?'אין חיובים עתידיים':'אין חיובים'}</div>`}</div></details>`;
}
function creditMonthCard(m){return creditMonthRow(m,Math.max(1,Math.abs(m.total)))}
return {renderCredit,creditMonthCard};
}
