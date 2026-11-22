export function normalizeSearchText(value){return String(value??'').normalize('NFKD').replace(/[\u0591-\u05C7]/g,'').toLocaleLowerCase('he-IL').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ')}
function compactSearchText(value){return normalizeSearchText(value).replace(/\s+/g,'')}

function dateParts(value){
  const raw=String(value??'').trim();if(!raw)return null;
  const match=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let year,month,day;
  if(match){year=Number(match[1]);month=Number(match[2]);day=Number(match[3])}
  else{
    const parsed=new Date(raw);if(!Number.isFinite(parsed.getTime()))return null;
    year=parsed.getFullYear();month=parsed.getMonth()+1;day=parsed.getDate();
  }
  if(year<1000||month<1||month>12||day<1||day>31)return null;
  const probe=new Date(Date.UTC(year,month-1,day));
  if(probe.getUTCFullYear()!==year||probe.getUTCMonth()+1!==month||probe.getUTCDate()!==day)return null;
  return {year,month,day};
}

export function dateSearchAliases(value){
  const parts=dateParts(value);if(!parts)return [];
  const {year,month,day}=parts,yy=String(year).slice(-2),dd=String(day).padStart(2,'0'),mm=String(month).padStart(2,'0'),d=String(day),m=String(month),out=new Set([String(year),`${year}-${mm}-${dd}`,`${year}-${m}-${d}`]);
  for(const sep of ['-','.','/'])for(const dayPart of new Set([d,dd]))for(const monthPart of new Set([m,mm]))for(const yearPart of [yy,String(year)])out.add(`${dayPart}${sep}${monthPart}${sep}${yearPart}`);
  return [...out];
}

export function searchMatch(query,values=[],dateValues=[]){
  if(!normalizeSearchText(query))return true;
  return createPreparedSearchMatcher(query)(prepareSearchValues(values,dateValues));
}

export function prepareSearchValues(values=[],dateValues=[]){
  const hay=normalizeSearchText([...values,...dateValues,...dateValues.flatMap(dateSearchAliases)].filter(value=>value!==undefined&&value!==null).join(' '));
  return {hay,hayCompact:hay.replace(/\s+/g,''),words:hay.split(' ').filter(Boolean)};
}
export function createPreparedSearchMatcher(query){
  const q=normalizeSearchText(query),qCompact=compactSearchText(query),tokens=q.split(' ').filter(Boolean);
  return ({hay,hayCompact,words})=>{
  if(!q)return true;
  if(qCompact&&hayCompact.includes(qCompact))return true;
  return tokens.every(token=>/^\d{1,2}$/.test(token)?words.includes(token):(hay.includes(token)||hayCompact.includes(token)));
  };
}

export function dateInRange(value,from='',to=''){
  const parts=dateParts(value);if(!parts)return false;
  const key=`${parts.year}-${String(parts.month).padStart(2,'0')}-${String(parts.day).padStart(2,'0')}`;
  return (!from||key>=from)&&(!to||key<=to);
}


// Range comparisons use cents and absolute movement size: a 200 ILS debit and
// a 200 ILS credit both match 150–250. Blank bounds are independently open.
export function createAmountRangeMatcher(from='',to=''){
  const bound=text=>String(text??'').trim()===''?null:Number(String(text).replaceAll(',',''));
  const low=bound(from),high=bound(to);
  if(low===null&&high===null)return ()=>true;
  if(low!==null&&(!Number.isFinite(low)||low<0)||high!==null&&(!Number.isFinite(high)||high<0)||
    low!==null&&high!==null&&low>high)return ()=>false;
  const minimum=low===null?0:Math.round(low*100),maximum=high===null?Infinity:Math.round(high*100);
  return value=>{
    if(value===null||value===undefined||value==='')return false;
    const amount=Number(value);if(!Number.isFinite(amount))return false;
    const cents=Math.round(Math.abs(amount)*100);
    return cents>=minimum&&cents<=maximum;
  };
}

export function amountRangeMarkup({from='',to='',action='',fromAction=action+'-from',toAction=action+'-to',searchMarkup='',className='',escapeHtml}){
  const id='advanced-'+fromAction,anchor='--'+id,active=amountRangeActive(from,to);
  const input=(actionName,value,label)=>`<label>${label}<input type="number" min="0" step="1" inputmode="decimal" value="${escapeHtml(String(value??''))}" aria-label="סכום ${label} בשקלים" data-input="${escapeHtml(actionName)}" data-change="${escapeHtml(actionName)}"></label>`;
  const toggle=`<button type="button" class="movement-advanced-toggle ${active?'active':''}" popovertarget="${escapeHtml(id)}" style="anchor-name:${escapeHtml(anchor)}" aria-label="חיפוש מתקדם לפי סכום" title="חיפוש מתקדם לפי סכום">`+
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4"/></svg></button>';
  const panel=`<div id="${escapeHtml(id)}" popover class="movement-advanced-panel" style="position-anchor:${escapeHtml(anchor)}"><strong>חיפוש מתקדם</strong>`+
    `<div class="movement-amount-range" role="group" aria-label="טווח סכום בשקלים ללא סימן">${input(fromAction,from,'מ־')}${input(toAction,to,'עד')}</div>`+
    '<small>סכומים בשקלים, ללא סימן. שדה ריק אינו מגביל.</small></div>';
  return `<div class="movement-search ${escapeHtml(className)}">${searchMarkup}${toggle}${panel}</div>`;
}

function amountRangeActive(from,to){return !!(String(from??'').trim()||String(to??'').trim())}

// Range controls and text search share a render schedule per table. Existing
// result-only renderers leave the native popover and its focused input in place.
export function createAmountRangeSearch(ui,kind,scheduleSearch){
  const fromKey=`${kind}AmountFrom`,toKey=`${kind}AmountTo`,queryKey=`${kind}SearchValue`;
  function change(key,element){
    // Native number steppers can emit both input and change for the same value.
    if(element.validity?.badInput||element.value===String(ui[key]??''))return;
    ui[key]=element.value;
    const toggle=element.closest('.movement-search')?.querySelector('.movement-advanced-toggle');
    toggle?.classList.toggle('active',amountRangeActive(ui[fromKey],ui[toKey]));
    scheduleSearch(ui[queryKey],element);
  }
  return {from:element=>change(fromKey,element),to:element=>change(toKey,element)};
}
