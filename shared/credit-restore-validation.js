import {sameUnassignedEvidence} from './credit-month-integrity.js';
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const role=value=>['עסקי','ביתי','business','home'].includes(value);
const month=value=>typeof value==='string'&&/^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(value);
function day(value){
  if(typeof value!=='string')return false;
  const text=value.slice(0,10);if(!month(text.slice(0,7))||!/^\d{4}-\d{2}-\d{2}$/.test(text))return false;
  const date=new Date(text+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===text;
}
const money=value=>typeof value==='number'&&Number.isFinite(value)&&Number.isSafeInteger(Math.round(value*100));
// Retained providers also use currency symbols. Other symbols remain explicit,
// unconverted foreign money rather than being guessed to mean an ISO currency.
const currencyLabels=new Set(['₪','ש״ח','שח','ש"ח','$','€','£','¥','₽','₹','₩','₺','₴','₫','฿','R$']);
const currency=value=>typeof value==='string'&&(/^[A-Z]{3}$/.test(value)||currencyLabels.has(value));
const labels={invalid_profiles:'מבנה רשימת הפרופילים אינו תקין',
  invalid_profile:'זהות פרופיל חסרה או פגומה',
  duplicate_profile:'מזהה פרופיל מופיע יותר מפעם אחת',
  invalid_account:'זהות כרטיס חסרה או פגומה',
  duplicate_account:'כרטיס מופיע יותר מפעם אחת בפרופיל',
  invalid_list:'רשימת תנועות פגומה',
  invalid_month:'חודש חיוב לא תקין',
  duplicate_month:'חודש חיוב מופיע יותר מפעם אחת',
  invalid_transaction:'מבנה עסקה לא תקין',
  invalid_amount:'סכום כספי לא תקין',
  invalid_currency:'סכום ללא מטבע תקין',
  invalid_date:'תאריך לא תקין',
  invalid_status:'מצב עסקה לא תקין',
  invalid_installments:'פרטי תשלומים לא תקינים',
  ambiguous_billing_identity:'מזהה חיוב עמום עלול להיספר באופן שגוי',
  duplicate_placement:'מקור עסקה מופיע גם בחודש וגם ללא שיוך',
  invalid_mappings:'מבנה הגדרות הכרטיסים אינו תקין',
  invalid_mapping:'הגדרת כרטיס לא תקינה',
  invalid_transitions:'היסטוריית שיוך הכרטיס אינה תקינה',
  comparison_unavailable:'לא ניתן לחשב השוואה אמינה'};
export const creditRestoreIssueLabel=code=>labels[code]||'חריגת תקינות הדורשת בדיקה';
/** Inspect retained bytes without normalization, deletion or identity guessing.
 * Invalid versions remain readable/exportable; only ordinary restore is blocked. */
export function creditRestorePreflight(state){
  const issues=[],add=(code,path)=>issues.push({code,path}),sync=state?.creditSync;
  if(!object(sync)||!Array.isArray(sync.profiles))return {ok:false,issues:[{code:'invalid_profiles',path:'creditSync.profiles'}]};
  const profiles=new Set();
  for(const [pi,p] of sync.profiles.entries()){
    const pp=`profiles[${pi}]`;
    if(!object(p)||typeof p.profileId!=='string'||!p.profileId.trim()||!Array.isArray(p.accounts)){add('invalid_profile',pp);continue}
    if(profiles.has(p.profileId))add('duplicate_profile',pp);profiles.add(p.profileId);
    const accounts=new Set();
    for(const [ai,a] of p.accounts.entries()){
      const ap=`${pp}.accounts[${ai}]`;
      if(!object(a)||typeof a.accountNumber!=='string'||!a.accountNumber.trim()){add('invalid_account',ap);continue}
      if(accounts.has(a.accountNumber))add('duplicate_account',ap);accounts.add(a.accountNumber);
      for(const field of ['months','txns','unassignedTransactions','pendingTransactions','unassignedTransfers'])if(a[field]!==undefined&&!Array.isArray(a[field]))add('invalid_list',`${ap}.${field}`);
      if(a.balanceDate!=null&&a.balanceDate!==''&&!day(a.balanceDate))add('invalid_date',`${ap}.balanceDate`);
      const months=new Set(),assigned=[],unassigned=[],identities=new Set();
      const inspect=(rows,path,destination)=>{
        if(!Array.isArray(rows))return;
        for(const [ti,t] of rows.entries()){
          const tp=`${path}[${ti}]`;
          if(!object(t)){add('invalid_transaction',tp);continue}
          for(const field of ['originalAmount','chargedAmount']){
            if(t[field]!=null&&!money(t[field]))add('invalid_amount',`${tp}.${field}`);
            const currencyField=field.replace('Amount','Currency');
            if(t[field]!=null&&!currency(t[currencyField]))add('invalid_currency',`${tp}.${currencyField}`);
          }
          for(const field of ['date','processedDate'])if(t[field]!=null&&t[field]!==''&&!day(t[field]))add('invalid_date',`${tp}.${field}`);
          if(t.status!==undefined&&!['completed','pending'].includes(t.status))add('invalid_status',tp);
          if(t.installments!=null&&(!object(t.installments)||!Number.isSafeInteger(t.installments.number)||!Number.isSafeInteger(t.installments.total)||t.installments.number<1||t.installments.total<t.installments.number))add('invalid_installments',tp);
          if(t.id){
            const id=JSON.stringify([t.status==='pending',t.id,String(t.processedDate||'').slice(0,10),t.installments?.number??1]);
            if(identities.has(id))add('ambiguous_billing_identity',tp);identities.add(id);
          }
          destination.push(t);
        }
      };
      for(const [mi,m] of (Array.isArray(a.months)?a.months:[]).entries()){
        const mp=`${ap}.months[${mi}]`;
        if(!object(m)||!month(m.month)||!Array.isArray(m.transactions)){add('invalid_month',mp);continue}
        if(months.has(m.month))add('duplicate_month',mp);months.add(m.month);inspect(m.transactions,mp+'.transactions',assigned);
      }
      if(!a.months?.length){
        const legacy=[];inspect(Array.isArray(a.txns)?a.txns.filter(t=>t?.status==='pending'?!Object.hasOwn(a,'pendingTransactions'):t?.processedDate||!Object.hasOwn(a,'unassignedTransactions')):a.txns,ap+'.txns',legacy);
        for(const t of legacy)if(t.status!=='pending')(t.processedDate?assigned:unassigned).push(t);
      }
      inspect(a.unassignedTransactions,ap+'.unassignedTransactions',unassigned);
      inspect(a.pendingTransactions,ap+'.pendingTransactions',[]);
      if(unassigned.some(source=>assigned.some(tx=>sameUnassignedEvidence(source,tx))))add('duplicate_placement',ap);
    }
  }
  if(sync.cardMappings!==undefined&&!object(sync.cardMappings))add('invalid_mappings','cardMappings');
  for(const [key,m] of Object.entries(object(sync.cardMappings)?sync.cardMappings:{})){
    const path='cardMappings.'+key;
    if(!object(m)){add('invalid_mapping',path);continue}
    for(const field of ['included','hidden'])if(m[field]!==undefined&&typeof m[field]!=='boolean')add('invalid_mapping',path+'.'+field);
    if(m.account!==undefined&&!role(m.account))add('invalid_mapping',path+'.account');
    if(m.manualFrame!=null&&(!money(m.manualFrame)||m.manualFrame<0))add('invalid_amount',path+'.manualFrame');
    if(m.accountTransitions!==undefined&&!Array.isArray(m.accountTransitions))add('invalid_transitions',path);
    for(const t of Array.isArray(m.accountTransitions)?m.accountTransitions:[])if(!object(t)||!day(t.effectiveDate)||!role(t.fromAccount)||!role(t.toAccount)||t.fromAccount===t.toAccount)add('invalid_transitions',path);
  }
  return {ok:issues.length===0,issues};
}
