function safe(value,escapeHtml){return escapeHtml?escapeHtml(String(value??'')):String(value??'')}

export function creditDetailDisplayDate(row){return String(row?.date||row?.detailDisplayBillingDate||'').slice(0,10)}

export function creditDetailMonthIsPast(month,reference){
  return month.key!=='unassigned'&&month.items.length>0&&month.items.every(row=>{
    const date=creditDetailDisplayDate(row);
    return !!date&&(date<reference||row.bankSettlementState==='settled');
  });
}

export function creditDetailRangeMatch(row,from='',to=''){
  const date=creditDetailDisplayDate(row);
  return !!date&&(!from||date>=from)&&(!to||date<=to);
}

export function creditDateRangeMarkup({active=false,from='',to='',action,escapeHtml,dateEditorMarkup}){
  const input=(value,side,label)=>dateEditorMarkup('',value,{data:{'credit-date':side},compact:true,label});
  return `<details class="bank-date-filter credit-cycle-menu credit-date-filter ${active?'active':''}" data-dismiss-on-outside><summary class="credit-cycle-menu-trigger" aria-label="טווח תאריכי חיוב"><span><b>טווח תאריכים${active?' ✓':''}</b></span><span class="credit-cycle-menu-chevron" aria-hidden="true">⌄</span></summary><div class="bank-date-menu" data-menu-panel><div class="bank-date-range-card"><div class="bank-date-range-title">לפי תאריך החיוב</div><div class="bank-date-range-fields" data-menu-keep-open><div class="bank-date-range-field"><span>מ־</span>${input(from,'from','מתאריך חיוב')}</div><div class="bank-date-range-field"><span>עד</span>${input(to,'to','עד תאריך חיוב')}</div></div><div data-credit-date-error role="alert"></div><button type="button" class="btn primary bank-date-apply" data-action="${safe(action,escapeHtml)}" data-menu-keep-open>החל</button></div></div></details>`;
}

export function creditDateRangeFromControl(element){
  const panel=element.closest('[data-menu-panel]'),from=panel?.querySelector('[data-credit-date="from"]'),to=panel?.querySelector('[data-credit-date="to"]');
  if(!from||!to)return null;
  const error=panel.querySelector('[data-credit-date-error]');if(error)error.textContent='';
  for(const input of [from,to]){
    const editor=input.closest?.('[data-date-editor]'),parts=[...(editor?.querySelectorAll('[data-date-part]')||[])];
    if(parts.some(part=>part.value)&&!input.value){if(error)error.textContent='יש להשלים יום, חודש ושתי ספרות שנה תקינים';editor.classList.add('invalid');parts.find(part=>!part.value)?.focus();return null}
  }
  if(from.value&&to.value&&from.value>to.value){if(error)error.textContent='תאריך הסיום צריך להיות אחרי תאריך ההתחלה';return null}
  return {from:from.value,to:to.value};
}

// Only replace the detail region. Preserve numeric offsets, never "stick to
// bottom", when a filter changes the number of rows beneath the controls.
export function replaceCreditDetailMarkup(host,markup){
  if(!host)return;
  const positions=[];
  for(let node=host.parentElement;node;node=node.parentElement)positions.push({node,top:node.scrollTop,left:node.scrollLeft});
  host.outerHTML=markup;
  for(const {node,top,left} of positions){node.scrollTop=top;node.scrollLeft=left}
}


export function creditViewAllowsMonth(monthValue,view,currentMonth){
  const key=String(monthValue||''),current=String(currentMonth||'');
  if(!/^\d{4}-\d{2}$/.test(key)||!/^\d{4}-\d{2}$/.test(current)||key<current)return false;
  const selected=String(view||'rolling12');
  if(selected==='all')return true;
  if(/^\d{4}$/.test(selected))return key.startsWith(`${selected}-`);
  const [year,month]=key.split('-').map(Number),[currentYear,currentMonthNumber]=current.split('-').map(Number);
  return year*12+month<=currentYear*12+currentMonthNumber+11;
}

export function creditDetailChargeDay(row){
  const date=String(row?.date||row?.detailDisplayBillingDate||'').slice(0,10),day=Number(date.slice(8,10));
  if(!Number.isInteger(day))return '';
  if(day>=7&&day<=12)return '10';
  if(day>=13&&day<=18)return '15';
  return '';
}

export function creditDetailDayMatch(row,day){return day!=='10'&&day!=='15'||creditDetailChargeDay(row)===day}

export function creditDetailSelectionTotal(items=[]){
  let total=0,excluded=0;
  for(const item of items){
    const amount=Number(item?.amount),included=item?.includedInIlsTotal===true;
    if(included&&Number.isFinite(amount))total+=amount;
    else excluded++;
    if(item?.coverageIncomplete===true&&included)excluded++;
  }
  return {total:Math.round(total*100)/100,partial:excluded>0,excluded};
}

function chargeDayButtonsMarkup({action,contextKey='',selectedDay='all',escapeHtml}){
  const context=contextKey?`data-click-arg0="${safe(contextKey,escapeHtml)}" data-click-arg1=`:'data-click-arg0=';
  return `<span class="credit-charge-day-stack" role="group" aria-label="סינון לפי מועד חיוב"><button type="button" class="credit-charge-day ${selectedDay==='10'?'active':''}" data-action="${safe(action,escapeHtml)}" ${context}"10" aria-pressed="${selectedDay==='10'}">10</button><button type="button" class="credit-charge-day ${selectedDay==='15'?'active':''}" data-action="${safe(action,escapeHtml)}" ${context}"15" aria-pressed="${selectedDay==='15'}">15</button></span>`;
}

function cycleSelectorMarkup({month,active,selectedDay,formatMoney,formatMonth,escapeHtml,monthAction,monthDayAction,header=false,timing=''}){
  const key=String(month?.key||''),uncertain=key==='unassigned',label=uncertain?'מחזור לא ודאי':formatMonth(key),amount=uncertain?`${month?.items?.length||0} עסקאות`:`${formatMoney(Number(month?.total)||0)}${month?.partial?' · חלקי':''}`;
  return `<span class="credit-cycle-selector ${header?'credit-cycle-selector-header ':''}${timing?`${timing} `:''}${active?'active ':''}${header?'credit-cycle-selector-history past':''}"><button type="button" class="credit-cycle-main credit-detail-month-tab" data-action="${safe(monthAction,escapeHtml)}" data-click-arg0="${safe(key,escapeHtml)}" aria-pressed="${active?'true':'false'}"><span>${safe(label,escapeHtml)}</span><b>${safe(amount,escapeHtml)}</b></button>${chargeDayButtonsMarkup({action:monthDayAction,contextKey:key,selectedDay:active?selectedDay:'all',escapeHtml})}</span>`;
}

export function creditUpcomingSelectorMarkup({active,selectedDay,total,formatMoney,escapeHtml,upcomingAction,upcomingDayAction}){
  return `<span class="credit-cycle-selector credit-cycle-selector-header ${active?'active':''}"><button type="button" class="credit-cycle-main credit-upcoming-toggle ${active?'active':''}" data-action="${safe(upcomingAction,escapeHtml)}" aria-pressed="${active?'true':'false'}"><span>החיוב הקרוב</span><b>${safe(formatMoney(Number(total)||0),escapeHtml)}</b></button>${chargeDayButtonsMarkup({action:upcomingDayAction,selectedDay:active?selectedDay:'all',escapeHtml})}</span>`;
}

function creditCycleMenuMarkup({months=[],selectedKey='',selectedDay='all',formatMoney,formatMonth,escapeHtml,monthAction,monthDayAction,label,ariaLabel,reverse=false,className=''}){
  if(!months.length)return '';
  const selected=months.find(month=>month.key===selectedKey),selectedLabel=selected?(selected.key==='unassigned'?'מחזור לא ודאי':formatMonth(selected.key)):'',selectedMeta=selected?`${selectedLabel}${selectedDay==='10'||selectedDay==='15'?` · ${selectedDay}`:''}`:'';
  const ordered=reverse?months.slice().reverse():months.slice();
  return `<details class="credit-cycle-menu ${className} ${selected?'active':''}" data-dismiss-on-outside><summary class="credit-cycle-menu-trigger" aria-label="${safe(ariaLabel,escapeHtml)}"><span><b>${safe(label,escapeHtml)}</b>${selectedMeta?`<small>${safe(selectedMeta,escapeHtml)}</small>`:''}</span><span class="credit-cycle-menu-chevron" aria-hidden="true">⌄</span></summary><div class="credit-cycle-menu-popover" data-menu-panel><div class="credit-cycle-menu-popover-title"><b>${safe(label,escapeHtml)}</b><small>בחר חודש או מועד חיוב</small></div><div class="credit-cycle-menu-list">${ordered.map(month=>cycleSelectorMarkup({month,active:month.key===selectedKey,selectedDay,formatMoney,formatMonth,escapeHtml,monthAction,monthDayAction,header:true})).join('')}</div></div></details>`;
}

export function creditHistoryMenuMarkup(options){return creditCycleMenuMarkup({...options,label:'חיובים קודמים',ariaLabel:'בחירת חיובים קודמים',reverse:true,className:'credit-history-menu'})}
export function creditFutureMenuMarkup(options){return creditCycleMenuMarkup({...options,label:'חיובים הבאים',ariaLabel:'בחירת חיובים הבאים',reverse:false,className:'credit-future-menu'})}

export function creditDetailChargeHeadingMarkup(items,formatMoney,escapeHtml){
  const {total,partial}=creditDetailSelectionTotal(items);
  return `<span class="credit-detail-charge-heading"><span>חיוב בחודש</span><small>סה״כ ${safe(formatMoney(total),escapeHtml)}${partial?' · חלקי':''}</small></span>`;
}
