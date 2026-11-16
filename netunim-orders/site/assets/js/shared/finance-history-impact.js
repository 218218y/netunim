import {creditBillingRowsData} from './credit-billing-cycles.js';
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
export const sameHistoryValue=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
function settings(state){
  const sync=state.creditSync,entries=new Map();
  for(const [id,mapping] of Object.entries(sync.cardMappings||{}))for(const [field,value] of Object.entries(mapping||{}))entries.set(`כרטיס ${id} / ${field}`,value);
  for(const p of sync.profiles){
    for(const field of ['defaultAccount','provider','ownerLabel'])entries.set(`פרופיל ${p.profileId} / ${field}`,p[field]);
    for(const a of p.accounts){
      for(const field of ['balanceDate','balance','cardFrame','availableCredit','pendingStatus','pendingFetchedAt'])entries.set(`כרטיס ${p.profileId}:${a.accountNumber} / ${field}`,a[field]);
      for(const m of a.months||[])for(const field of ['providerSchemaVersion','tier','status','fetchStatus'])entries.set(`כרטיס ${p.profileId}:${a.accountNumber} חודש ${m.month} / ${field}`,m[field]);
    }
  }
  for(const field of ['version','mode','cardSortOrder'])entries.set(field,sync[field]);
  return entries;
}
const fieldLabels={included:'הכללה בחישוב',
  hidden:'הסתרה בתצוגה',
  account:'שיוך',
  accountTransitions:'היסטוריית שיוך',
  manualFrame:'מסגרת ידנית',
  cardName:'שם הכרטיס',
  defaultAccount:'שיוך ברירת מחדל',
  provider:'חברת האשראי',
  ownerLabel:'שם בעלים',
  balanceDate:'תאריך חיוב מהספק',
  balance:'יתרה מהספק',
  cardFrame:'מסגרת מהספק',
  availableCredit:'אשראי זמין מהספק',
  pendingStatus:'תקינות עסקאות ממתינות',
  pendingFetchedAt:'מועד קליטת ממתינות',
  version:'גרסת נתונים',
  mode:'מצב חישוב',
  cardSortOrder:'סדר כרטיסים'};
function settingLabel(path,states){
  const field=path.split(' / ').at(-1),prefix=path.slice(0,path.length-field.length);
  let label=prefix+(fieldLabels[field]||field);
  for(const state of states)for(const p of state.creditSync.profiles){
    const owner=[p.ownerLabel,p.label||p.provider].filter(Boolean).join(' · ');
    label=label.replace(`פרופיל ${p.profileId} /`,`פרופיל ${owner||'אשראי'} /`);
    for(const a of p.accounts)label=label.replace(`כרטיס ${p.profileId}:${a.accountNumber} `,`כרטיס ${owner} ••${a.accountNumber.slice(-4)} `);
  }
  return label;
}
/** Use the product engine on the same reference day. Finance restore only changes
 * synchronized Credit; manual Kupa rows are deliberately outside this projection. */
export function creditRestoreImpact(before,after,{asOf,projectCredit=value=>value}={}){
  const day=asOf||new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'}),groups=new Map();
  const empty=()=>({cents:0,count:0,unknown:0,incomplete:0,estimated:0});
  for(const [side,state] of [['before',before],['after',after]]){
    const creditSync=projectCredit(structuredClone(state.creditSync));
    for(const row of creditBillingRowsData({creditSync,credit:[]},{asOf:day,includeHidden:true})){
      const currency=row.isShekel?'ILS':row.displayCurrency||'לא ידוע';
      const key=JSON.stringify([row.date||'ללא חודש',row.account,currency,row.status==='pending',row.hidden]);
      if(!groups.has(key))groups.set(key,{date:row.date||'',month:row.billingMonth||'ללא חודש',account:row.account,currency,pending:row.status==='pending',hidden:row.hidden,before:empty(),after:empty()});
      const target=groups.get(key)[side];target.count++;
      // Use the engine's actual ILS contribution, including zero for a missing
      // conversion. Original foreign amounts are not billed shekel amounts.
      const amount=row.amount;
      if(Number.isFinite(amount))target.cents+=Math.round(amount*100);
      if(!row.includedInIlsTotal)target.unknown++;
      if(row.coverageIncomplete)target.incomplete++;
      if(row.amountEstimated||row.billingDateConfidence==='inferred')target.estimated++;
    }
  }
  const old=settings(before),next=settings(after),settingChanges=[];
  for(const path of new Set([...old.keys(),...next.keys()]))if(!sameHistoryValue(old.get(path),next.get(path)))settingChanges.push({path,label:settingLabel(path,[before,after]),before:old.get(path),after:next.get(path)});
  const calculated=[...groups.values()].sort((a,b)=>a.month.localeCompare(b.month)||a.account.localeCompare(b.account));
  return {asOf:day,scope:'synchronized-credit',settingChanges,calculated,calculatedChanged:calculated.some(row=>!sameHistoryValue(row.before,row.after))};
}
