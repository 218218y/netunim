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
  // Compact punctuation and spaces WITHIN a field (phone, amount, date),
  // but never merge digits from different fields into a fabricated number.
  const fields=[...values,...dateValues,...dateValues.flatMap(dateSearchAliases)]
    .filter(value=>value!==undefined&&value!==null)
    .map(normalizeSearchText).filter(Boolean);
  const hay=fields.join(' ');
  return {hay,hayCompact:fields.map(value=>value.replace(/\s+/g,'')).join('\0'),words:hay.split(' ').filter(Boolean)};
}
export function createPreparedSearchMatcher(query){
  const q=normalizeSearchText(query),qCompact=compactSearchText(query),tokens=q.split(' ').filter(Boolean);
  return ({hay,hayCompact,words})=>{
  if(!q)return true;
  if(qCompact&&hayCompact.includes(qCompact))return true;
  return tokens.every(token=>/^\d{1,2}$/.test(token)?words.includes(token):(hay.includes(token)||hayCompact.includes(token)));
  };
}

// Grouped amounts, dates, and installment pairs remain single query terms.
const financialTerms=/(?:₪\s*|[+-]\s*)?[+-]?\d{1,3}(?:[, \u00a0\u202f]\d{3})+(?:\.\d{1,2})?(?=$|[\s),;])|₪\s*[+-]?\d+(?:\.\d{1,2})?(?=$|[\s),;])|\S+/g;
const dateTerm=/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/;
const isoDateTerm=/^\d{4}-\d{1,2}-\d{1,2}$/;
const financialFormatMarks=/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function monetaryCents(value){
  if(typeof value!=='number'&&(typeof value!=='string'||!value.trim()))return null;
  const cents=Math.round(Math.abs(Number(value))*100);
  return Number.isSafeInteger(cents)?cents:null;
}
function referenceDigits(value){
  const raw=String(value??'').trim();
  return /^\d+(?:[\s-]+\d+)*$/.test(raw)?raw.replace(/[\s-]/g,''):'';
}
function visibleNumbers(value){
  return (String(value??'').match(/\d{1,3}(?:,\d{3})+(?!\d)|\d+/g)||[]).map(number=>number.replaceAll(',',''));
}
function identifierNumbers(value){
  const digits=referenceDigits(value);
  return digits?[digits]:visibleNumbers(value);
}
function financialDateParts(dates){return dates.map(dateParts).filter(Boolean)}
function financialText(texts,identifiers){return [...texts,...identifiers].map(normalizeSearchText).filter(Boolean).join('\0')}

export function prepareFinancialSearchFields(fields){
  const {amounts=[],identifiers=[],texts=[],dates=[]}=fields;
  return {...fields,prepared:{
    cents:amounts.map(monetaryCents).filter(value=>value!==null),
    references:identifiers.flatMap(identifierNumbers),
    numbers:texts.flatMap(visibleNumbers),
    dates:financialDateParts(dates),
    text:financialText(texts,identifiers),
  }};
}

function financialTermMatcher(token){
  const parts=token.match(dateTerm);
  const dayFirst=parts&&Number(parts[1])>=1&&Number(parts[1])<=31&&Number(parts[2])>=1&&Number(parts[2])<=12?parts:null;
  if(dayFirst||isoDateTerm.test(token)){
    const keyed=dayFirst?{day:Number(dayFirst[1]),month:Number(dayFirst[2]),year:Number(dayFirst[3])}:dateParts(token);
    const short=dayFirst?.[3].length===2;
    return ({dates=[],prepared})=>!!keyed&&(prepared?.dates??financialDateParts(dates)).some(({day,month,year})=>
      day===keyed.day&&month===keyed.month&&(short?year%100:year)===keyed.year);
  }
  if(/^\d+\/\d+$/.test(token))return fields=>fields.installment===token;
  if(/^\d{1,2}:\d{2}$/.test(token))return fields=>fields.time===token.padStart(5,'0');

  const raw=token.replace(/[\s₪,]/g,'');
  const amount=/^[+-]?\d+(?:\.\d{1,2})?$/.test(raw)&&!/^0\d/.test(raw);
  const cents=amount?monetaryCents(raw):null;
  const whole=raw.match(/^[+-]?(\d+)(?:\.0{1,2})?$/)?.[1]||'';
  const reference=whole||referenceDigits(token);
  if(cents!==null||reference){
    return ({amounts=[],identifiers=[],texts=[],dates=[],prepared})=>
      (cents!==null&&(prepared?prepared.cents.includes(cents):amounts.some(value=>monetaryCents(value)===cents)))||
      (!!reference&&(prepared?prepared.references.some(value=>value.includes(reference)):
        identifiers.some(value=>identifierNumbers(value).some(number=>number.includes(reference)))))||
      (!!reference&&(prepared?prepared.numbers.some(value=>value.includes(reference)):
        texts.some(value=>visibleNumbers(value).some(number=>number.includes(reference)))))||
      (/^\d{4}$/.test(whole)&&(prepared?.dates??financialDateParts(dates)).some(date=>date.year===Number(whole)));
  }
  const words=normalizeSearchText(token).split(' ').filter(Boolean);
  if(!words.length)return null;
  return ({texts=[],identifiers=[],prepared})=>{
    const text=prepared?.text??financialText(texts,identifiers);
    return words.every(word=>text.includes(word));
  };
}
export function createFinancialSearchMatcher(query){
  const tokens=String(query??'').normalize('NFKC').replace(financialFormatMarks,'').replace(/\u2212/g,'-').match(financialTerms)||[];
  const terms=tokens.map(token=>financialTermMatcher(token.replace(/^\(+|[),;]+$/g,''))).filter(Boolean);
  return fields=>terms.every(match=>match(fields));
}
// The same business semantics apply in Kupa and Orders. A record's technical
// UUID is deliberately excluded: it isn't a searchable fact in the table.
export function creditTransactionSearchFields(row,providerLabels={},precompute=true){
  const pending=row?.status==='pending',unknown=row?.amountStatus==='unknown_amount'||row?.amountSource==='unknown',
    installment=!pending&&row?.totalParts>1?`${row.part}/${row.totalParts}`:'',
    original=row?.source==='credit_unknown'||unknown?row?.originalAmount:row?.series?.totalAmount??row?.totalAmount;
  const fields={
    amounts:[row?.includedInIlsTotal!==false&&row?.amountSource!=='issuer_not_billed' ? row?.amount:null,
      original,row?.originalAmount,unknown?null:row?.displayAmount],
    identifiers:[row?.issuerReference,...(installment?[row.part,row.totalParts]:[])],
    installment,time:row?.transactionTime,
    texts:[row?.card,row?.account,row?.ownerLabel,row?.description,row?.displayCurrency,row?.originalCurrency,row?.provider,
      pending?'ממתינה אישור':installment?'תשלום':'תשלום אחד',
      row?.source==='manual'?'תוספת ידנית':'מסונכרן',row?.coverageIncomplete?'כיסוי חסר':'',
      unknown?'סכום חסר':'',row?.foreignCurrency?'מט״ח':'',providerLabels[row?.provider]||''],
    dates:[row?.transactionDate,row?.date],
  };
  return precompute?prepareFinancialSearchFields(fields):fields;
}
export function createCreditTransactionSearchMatcher(query,providerLabels={}){
  const match=createFinancialSearchMatcher(query);
  return row=>match(row?.search||creditTransactionSearchFields(row,providerLabels,false));
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
