/** @typedef {import('./kupa-cashflow-contracts.js').CashflowCalculation} Calculation */
import {creditCardAccountForDateData} from './credit-card-account.js';
import {creditBillingRowsData} from './credit-billing-cycles.js';
import {addDaysISO,addMonthsISO,isoDay,localTodayISO} from './kupa-cashflow-dates.js';

/** @type {Calculation['accountRole']} */
export function accountRole(value){return value==='ביתי'||value==='home'?'ביתי':'עסקי'}
/** @type {Calculation['creditCardKey']} */
export function creditCardKey(row){return row?.creditAccountKey||`manual:${row?.card||''}`}
/** @type {Calculation['creditRowKey']} */
export function creditRowKey(row){return `${String(row?.creditId||'')}|${Number(row?.part||1)}`}
/** @type {Calculation['bankFeedForAccount']} */
export function bankFeedForAccount(kupa,account){
  const role=accountRole(account),bank=kupa?.bank&&typeof kupa.bank==='object'?kupa.bank:{};
  if(role==='ביתי')return bank.homeFeed&&typeof bank.homeFeed==='object'?bank.homeFeed:null;
  if(bank.source==='manual')return null;
  return bank.feed&&typeof bank.feed==='object'?bank.feed:null;
}
/** @type {Calculation['bankTransactionDay']} */
function bankTransactionDay(row){return isoDay(row?.date)||isoDay(row?.processedDate)}
/** @type {Calculation['bankTransactionSearchText']} */
function bankTransactionSearchText(row){return [row?.description,row?.memo,row?.partyName,row?.partyHeadline,row?.messageHeadline,row?.messageDetail].map(value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,'').replace(/\s+/g,' ').trim()).join(' ')}
export const CREDIT_SETTLEMENT_MAX_HOLD_DAYS=2;
/** @type {Record<string,string[]>} */
const CREDIT_SETTLEMENT_MARKERS={
  // Explicit bank card identity takes precedence. Issuer aliases are fallback
  // evidence only when the bank provides no usable card identity.
  visaCal:['כאל','כרטיסי אשראי לישראל','כרטיסי אשראי ל'],
  max:['מקס איט פיננסי','מקס איט פיננסים','מקס','max'],
  isracard:['ישראכרט בע״מ','ישראכרט בע"מ','ישראכרט בעמ','ישראכרט','isracard'],
  amex:['אמריקן אקספרס','american express','amex','פרימיום אקספרס','premium express'],
};
/** @type {Calculation['providerHintsForRows']} */
function providerHintsForRows(rows){
  /** @type {Set<string>} */
  const providers=new Set();
  for(const row of rows){
    const provider=String(row?.provider||'').trim();if(provider)providers.add(provider);
    const card=String(row?.card||'').toLowerCase();
    if(card.includes('כאל')||card.includes(' cal'))providers.add('visaCal');
    if(card.includes('מקס')||card.includes('max'))providers.add('max');
    if(card.includes('ישראכרט')||card.includes('isracard'))providers.add('isracard');
    if(card.includes('אמריקן')||card.includes('american express')||card.includes('amex'))providers.add('amex');
  }
  return [...providers];
}
/** @type {Calculation['bankRowLooksLikeCreditSettlement']} */
function bankRowLooksLikeCreditSettlement(row,providers=[]){
  if(row?.status==='pending'||row?.presenceState==='missing')return false;
  const structuredProvider=String(settlementDetails(row)?.provider||'');
  if(structuredProvider&&providers.some(provider=>CREDIT_SETTLEMENT_MARKERS[provider])&&!providers.includes(structuredProvider))return false;
  if(structuredProvider&&providers.includes(structuredProvider))return true;
  const text=bankTransactionSearchText(row);
  if(!text)return false;
  const explicit=Object.keys(CREDIT_SETTLEMENT_MARKERS).filter(provider=>bankRowExplicitlyMatchesProvider(row,provider));
  if(explicit.length&&providers.some(provider=>CREDIT_SETTLEMENT_MARKERS[provider])&&!explicit.some(provider=>providers.includes(provider)))return false;
  if(text.includes('אשראי')||text.includes('credit card'))return true;
  return providers.some(provider=>bankRowExplicitlyMatchesProvider(row,provider));
}
/** @type {Calculation['bankRowExplicitlyMatchesProvider']} */
function bankRowExplicitlyMatchesProvider(row,provider){
  if(!provider||row?.status==='pending'||row?.presenceState==='missing')return false;
  const structuredProvider=String(settlementDetails(row)?.provider||'');if(structuredProvider)return structuredProvider===provider;
  const text=bankTransactionSearchText(row);if(!text)return false;
  // The truncated CAL legal name is common in bank feeds. Do not mistake a
  // generic phrase such as "credit cards for the month" for that institution.
  return (CREDIT_SETTLEMENT_MARKERS[provider]||[]).some(marker=>marker==='כרטיסי אשראי ל'?/כרטיסי אשראי ל(?=$|[\s.,:;])/u.test(text):text.includes(String(marker).toLowerCase()));
}
/** @type {Calculation['moneyCents']} */
export function moneyCents(value){const number=Number(value);return Math.round((Number.isFinite(number)?number:0)*100)}
/** @type {Calculation['cardSuffixForRows']} */
function cardSuffixForRows(rows){const suffixes=new Set(rows.map(row=>String(row?.accountNumber||'').replace(/\D/g,'').slice(-4)).filter(value=>value.length===4));return suffixes.size===1?suffixes.values().next().value||'':''}
/** @type {Calculation['bankTextHasCardSuffix']} */
function bankTextHasCardSuffix(row,suffix){if(!suffix)return false;return new RegExp(`(?:^|\\D)${suffix}(?:\\D|$)`).test(bankTransactionSearchText(row))}
/** @type {Calculation['explicitBankCardSuffixes']} */
function explicitBankCardSuffixes(row){const raw=settlementDetails(row)?.cardLast4s;/** @type {unknown[]} */ const values=Array.isArray(raw)?raw:[];return [...new Set(values.map(value=>String(value??'').trim()).filter(value=>/^\d{4}$/.test(value)))]}

/** Retained detail fields remain unknown until the selector inspects them.
 * @param {import('./kupa-cashflow-contracts.js').BankRow} row @returns {Record<string,unknown>|null} */
function settlementDetails(row){const value=row?.creditSettlementDetails;return value&&typeof value==='object'?/** @type {Record<string,unknown>} */(value):null}

/** Internal graph indexes come only from these same arrays. A broken index must
 * abort the calculation, never invent settlement evidence or a zero amount.
 * @template T @param {readonly T[]} rows @param {number} index @returns {T} */
export function requiredAt(rows,index){const value=rows[index];if(value===undefined)throw new RangeError('cashflow_internal_index');return value}
/** @type {Calculation['synchronizedProviderCardSuffixes']} */
function synchronizedProviderCardSuffixes(kupa,provider,account,reference=''){
  const role=accountRole(account),sync=kupa?.creditSync&&typeof kupa.creditSync==='object'&&!Array.isArray(kupa.creditSync)?kupa.creditSync:{},mappings=sync.cardMappings&&typeof sync.cardMappings==='object'&&!Array.isArray(sync.cardMappings)?sync.cardMappings:{};
  /** @type {Set<string>} */
  const suffixes=new Set();
  for(const profile of Array.isArray(sync.profiles)?sync.profiles:[]){
    if(String(profile?.provider||'')!==String(provider||''))continue;
    for(const card of Array.isArray(profile?.accounts)?profile.accounts:[]){
      const mapping=mappings[`${String(profile?.profileId||'').trim()}:${String(card?.accountNumber||'').trim()}`]||{};
      if(creditCardAccountForDateData(mapping,profile?.defaultAccount,reference)!==role)continue;
      const digits=String(card?.accountNumber||'').replace(/\D/g,''),suffix=digits.slice(-4);if(/^\d{4}$/.test(suffix))suffixes.add(suffix);
    }
  }
  return suffixes;
}
/** @type {Calculation['bankCardSuffixHint']} */
function bankCardSuffixHint(row){
  const details=settlementDetails(row);if(!details)return {suffix:'',source:''};
  const provider=String(details.provider||''),activity=Number(details.bankActivityTypeCode)||0;
  if(provider==='max'&&activity===515){const digits=String(details.permissionReference||'').replace(/\D/g,'');if(digits.length>=5)return {suffix:digits.slice(-4),source:'bank_permission_suffix_validated'}}
  if(provider==='isracard'&&activity===515){const text=[row?.messageDetail,row?.memo].map(value=>String(value||'')).join(' '),match=/(?:^|\s)מזהה\s*[:#-]?\s*(\d{4,})(?:\D|$)/u.exec(text);if(match)return {suffix:String(match[1]).slice(-4),source:'bank_identifier_suffix_validated'}}
  if((provider==='isracard'||provider==='amex')&&activity===491){const digits=String(details.issuerReference||'').replace(/\D/g,'');if(/^\d{4}$/.test(digits))return {suffix:digits,source:'legacy_bank_reference_validated'}}
  return {suffix:'',source:''};
}
/** @type {Calculation['validatedBankCardSuffixIdentity']} */
function validatedBankCardSuffixIdentity(kupa,row,account){
  const details=settlementDetails(row);if(!details)return null;
  const hint=bankCardSuffixHint(row);if(!hint.suffix)return null;
  const known=synchronizedProviderCardSuffixes(kupa,String(details.provider||''),account,bankTransactionDay(row));if(!known.has(hint.suffix))return null;
  return {last4s:[hint.suffix],source:hint.source,cards:[{last4:hint.suffix,card:''}]};
}
/** @type {Calculation['bankSettlementAccountCandidates']} */
function bankSettlementAccountCandidates(kupa,row,account,preparedBillingRows=null){
  const role=accountRole(account),provider=String(settlementDetails(row)?.provider||'').trim(),day=bankTransactionDay(row),value=moneyCents(row?.amount);
  if(!provider||!CREDIT_SETTLEMENT_MARKERS[provider]||!day||value>=0)return [];
  const sourceRows=Array.isArray(preparedBillingRows)?preparedBillingRows:creditBillingRowsData(kupa,{asOf:day,includeHidden:true});
  const earliest=addDaysISO(day,-CREDIT_SETTLEMENT_MAX_HOLD_DAYS),billingRows=sourceRows.filter(candidate=>candidate?.account===role&&candidate?.provider===provider&&candidate?.status!=='pending'&&candidate?.date&&candidate.date>=earliest&&candidate.date<=day&&['authoritative','issuer','known_cycle'].includes(candidate.billingDateConfidence));
  /** @type {Map<string,import('./kupa-cashflow-contracts.js').ReconciledRow[]>} */
  const byGroup=new Map();
  for(const candidate of billingRows){const key=settlementGroupKey(candidate,'card');const group=byGroup.get(key)||[];group.push(candidate);byGroup.set(key,group)}
  return [...byGroup.values()].map(rows=>({
    rows,due:String(rows[0]?.date||''),cardKey:creditCardKey(rows[0]),provider:String(rows[0]?.provider||''),suffix:cardSuffixForRows(rows),card:String(rows[0]?.card||''),
    known:rows.every(item=>item.includedInIlsTotal&&!item.coverageIncomplete&&item.amountStatus==='known_ils'),
    expected:-rows.reduce((sum,item)=>sum+moneyCents(item.amount),0),
  })).filter(group=>group.suffix&&group.expected<0);
}

// Display bank-native identities first. Only the display fallback may derive
// attribution from exact issuer-cycle amounts; those inferred suffixes must never
// be fed back into settlement as independent bank identity evidence.
/** @type {Calculation['bankCreditSettlementIdentityFromRows']} */
function bankCreditSettlementIdentityFromRows(kupa,row,account,preparedBillingRows=null){
  const details=settlementDetails(row);if(!details)return {last4s:[],source:'',cards:[]};
  const explicit=explicitBankCardSuffixes(row);
  if(explicit.length)return {last4s:explicit,source:'bank_detail_explicit',cards:explicit.map(last4=>({last4,card:''}))};
  const bankHint=validatedBankCardSuffixIdentity(kupa,row,account);if(bankHint)return bankHint;
  if(bankCardSuffixHint(row).suffix)return {last4s:[],source:'',cards:[]};
  const candidates=bankSettlementAccountCandidates(kupa,row,account,preparedBillingRows);if(!candidates.length)return {last4s:[],source:'',cards:[]};
  const value=moneyCents(row?.amount),legacyReference=/^\d{4}$/.test(String(details.issuerReference||''))?String(details.issuerReference):'';
  if(legacyReference){
    const matches=candidates.filter(group=>group.suffix===legacyReference&&group.known&&group.expected===value),keys=new Set(matches.map(group=>group.cardKey));
    if(keys.size===1&&matches.length)return {last4s:[legacyReference],source:'issuer_reference_exact_cycle',cards:[{last4:legacyReference,card:requiredAt(matches,0).card}]};
  }
  const known=candidates.filter(group=>group.known);if(!known.length||known.length>12)return {last4s:[],source:'',cards:[]};
  const solutions=[];
  for(let bits=1;bits<(1<<known.length);bits++){
    const selected=known.filter((_,index)=>bits&(1<<index));
    if(selected.some(group=>group.due!==requiredAt(selected,0).due))continue;
    if(selected.reduce((sum,group)=>sum+group.expected,0)!==value)continue;
    solutions.push(selected);
    if(solutions.length>1)break;
  }
  if(solutions.length!==1)return {last4s:[],source:'',cards:[]};
  const selected=requiredAt(solutions,0),last4s=[...new Set(selected.map(group=>group.suffix))];
  if(last4s.length!==selected.length)return {last4s:[],source:'',cards:[]};
  return {last4s,source:selected.length>1?'issuer_cycles_exact_aggregate':'issuer_cycle_exact',cards:selected.map(group=>({last4:group.suffix,card:group.card}))};
}

/** @type {Calculation['kupaBankCreditSettlementIdentityData']} */
export function kupaBankCreditSettlementIdentityData(kupa,row,account='עסקי'){
  return bankCreditSettlementIdentityFromRows(kupa,row,account);
}

// Rendering a bank table may include dozens or hundreds of rows. Build the issuer
// projection once and reuse it for every bank row instead of recalculating all
// synchronized card cycles per table row. Strong issuer billing dates are stable
// across the current projection, while each row still applies its own two-day
// settlement window and exact-cent ambiguity checks.
/** @type {Calculation['kupaBankCreditSettlementIdentitiesData']} */
export function kupaBankCreditSettlementIdentitiesData(kupa,rows=[],account='עסקי'){
  const list=Array.isArray(rows)?rows:[],preparedBillingRows=creditBillingRowsData(kupa,{asOf:localTodayISO(),includeHidden:true}),identities=new Map();
  for(const row of list)identities.set(row,bankCreditSettlementIdentityFromRows(kupa,row,account,preparedBillingRows));
  return identities;
}

/** @type {Calculation['settlementRowsForLatestElapsedCycle']} */
export function settlementRowsForLatestElapsedCycle(installments,start,reference){
  const latestByCard=new Map();
  for(const row of installments){
    if(!row?.date||row.date>=reference||row.date>=start)continue;
    const key=creditCardKey(row),current=latestByCard.get(key);
    if(!current||row.date>current)latestByCard.set(key,row.date);
  }
  return installments.filter(row=>row?.date&&latestByCard.get(creditCardKey(row))===row.date);
}
/** @type {Calculation['settlementGroupKey']} */
export function settlementGroupKey(row,level){
  const due=String(row?.date||'');
  if(level==='card')return `${due}|${creditCardKey(row)}`;
  if(level==='profile'){const profile=String(row?.profileId||'').trim();return profile?`${due}|${profile}`:`${due}|${creditCardKey(row)}`}
  if(level==='provider'){const provider=String(row?.provider||'').trim();return provider?`${due}|${provider}`:`${due}|${creditCardKey(row)}`}
  return due;
}
// Build all admissible claims before consuming any bank evidence. A claim can
// cover one card, an exact aggregate, or an exact split debit. Only cycles present
// in EVERY optimal disjoint explanation are settled. Ties never pick a card.
/** @type {Calculation['pendingBankSettlementGroupKeys']} */
export function pendingBankSettlementGroupKeys(kupa,bankRows,billingRows,account,reference){
  /** @type {Set<string>} */
  const keys=new Set();const role=accountRole(account),ref=isoDay(reference)||localTodayISO();
  for(const row of Array.isArray(bankRows)?bankRows:[]){
    const day=bankTransactionDay(row),value=moneyCents(row?.amount);
    if(row?.status!=='pending'||row?.presenceState==='missing'||!day||day>ref||value>=0||(row.currency&&row.currency!=='ILS'))continue;
    const explicit=explicitBankCardSuffixes(row),validated=explicit.length?{last4s:explicit}:validatedBankCardSuffixIdentity(kupa,row,role);
    const suffixes=[...new Set(validated?.last4s||[])];if(!suffixes.length)continue;
    const candidates=bankSettlementAccountCandidates(kupa,row,role,billingRows),matches=[];let safe=true;
    for(const suffix of suffixes){const found=candidates.filter(group=>group.suffix===suffix);if(found.length!==1){safe=false;break}matches.push(requiredAt(found,0))}
    if(!safe||!matches.length||matches.some(group=>!group.known)||new Set(matches.map(group=>group.due)).size!==1||matches.reduce((sum,group)=>sum+group.expected,0)!==value)continue;
    for(const group of matches)keys.add(settlementGroupKey(requiredAt(group.rows,0),'card'));
  }
  return keys;
}

/** @type {Calculation['unresolvedSettlementIndexes']} */
export function unresolvedSettlementIndexes(bankRows,candidates,reference,{monthlySettlement=false}={}){
  const unresolved=new Set(candidates.map((_,index)=>index)),groupMap=/** @type {Map<string,{key:string,rows:import('./kupa-cashflow-contracts.js').ReconciledRow[],indexes:number[]}>} */(new Map());
  for(const [index,row] of candidates.entries()){
    const key=settlementGroupKey(row,'card');
    const group=groupMap.get(key)||{key,rows:[],indexes:[]};
    group.rows.push(row);group.indexes.push(index);groupMap.set(key,group);
  }
  const groups=[...groupMap.values()].sort((a,b)=>a.key.localeCompare(b.key)).map(entry=>({...entry,due:'',card:'',providers:/** @type {string[]} */([]),suffix:'',known:false,expected:0,proven:false,next:''}));
  for(const group of groups){
    group.due=requiredAt(group.rows,0).date;group.card=creditCardKey(requiredAt(group.rows,0));
    group.providers=providerHintsForRows(group.rows);group.suffix=cardSuffixForRows(group.rows);
    group.known=group.rows.every(row=>row.includedInIlsTotal);
    group.expected=-group.rows.reduce((sum,row)=>sum+moneyCents(row.amount),0);
    group.proven=group.rows.some(row=>row.status!=='coverage_missing'&&['authoritative','issuer','known_cycle','manual'].includes(row.billingDateConfidence));
    group.next=groups.filter(other=>creditCardKey(requiredAt(other.rows,0))===group.card&&requiredAt(other.rows,0).date>group.due).map(other=>requiredAt(other.rows,0).date).sort()[0]||'';
  }
  /** @type {import('./kupa-cashflow-contracts.js').BankEvidence[]} */
  const banks=[];
  for(const row of bankRows){
    const day=bankTransactionDay(row),value=moneyCents(row.amount);
    if(!day||day>reference||!value||(row.currency&&row.currency!=='ILS'))continue;
    let eligible=groups.flatMap((group,index)=>day>=group.due&&day<(monthlySettlement?addMonthsISO(group.due,1):addDaysISO(group.due,CREDIT_SETTLEMENT_MAX_HOLD_DAYS))&&(!group.next||day<group.next)&&bankRowLooksLikeCreditSettlement(row,group.providers)?[index]:[]);
    const explicit=explicitBankCardSuffixes(row),hint=bankCardSuffixHint(row);
    const nativeSuffixes=explicit.length?explicit:hint.suffix?[hint.suffix]:[];
    let suffixMatches=[];
    if(nativeSuffixes.length){
      // Every bank-named card must identify exactly one eligible cycle. Unknown
      // cards, last-four collisions and partial groups cannot fall back to totals.
      const matches=nativeSuffixes.map(suffix=>eligible.filter(index=>requiredAt(groups,index).suffix===suffix));
      if(matches.some(indexes=>indexes.length!==1))continue;
      eligible=matches.flat();suffixMatches=eligible;
      if(eligible.some(index=>requiredAt(groups,index).due!==requiredAt(groups,requiredAt(eligible,0)).due))continue;
    }else{
      suffixMatches=eligible.filter(index=>bankTextHasCardSuffix(row,requiredAt(groups,index).suffix));
      if(suffixMatches.length)eligible=suffixMatches;
    }
    if(eligible.length)banks.push({row,value,eligible,suffixMatches,nativeIdentity:nativeSuffixes.length>0});
  }
  // Disjoint evidence components can be proved independently. The guard applies
  // only to a complex connected ambiguity, not to the user's total card count.
  const remainingBanks=new Set(banks.map((_,index)=>index));
  while(remainingBanks.size){
    const first=remainingBanks.values().next();if(first.done)break;const bankIndexes=new Set([first.value]);
    /** @type {Set<number>} */
    const cardIndexes=new Set();
    for(const bankIndex of bankIndexes){
      remainingBanks.delete(bankIndex);
      for(const cardIndex of requiredAt(banks,bankIndex).eligible){
        if(cardIndexes.has(cardIndex))continue;cardIndexes.add(cardIndex);
        for(const other of remainingBanks)if(requiredAt(banks,other).eligible.includes(cardIndex))bankIndexes.add(other);
      }
    }
    const cards=[...cardIndexes],localGroups=cards.map(index=>requiredAt(groups,index)),localBanks=[...bankIndexes].map(index=>({...requiredAt(banks,index),eligible:requiredAt(banks,index).eligible.map(card=>cards.indexOf(card)),suffixMatches:requiredAt(banks,index).suffixMatches.map(card=>cards.indexOf(card))}));
    for(const localIndex of provenSettlementGroupIndexes(localGroups,localBanks))for(const rowIndex of requiredAt(localGroups,localIndex).indexes)unresolved.delete(rowIndex);
  }
  return unresolved;
}

/** @type {Calculation['provenSettlementGroupIndexes']} */
function provenSettlementGroupIndexes(groups,banks){
  // Bounded exhaustive search; excess/complex evidence is unresolved, never guessed.
  if(!banks.length||banks.length>12||groups.length>12)return [];
  /** @type {Array<{banks:number,cards:number,score:[number,number,number]}>} */
  const claims=[];
  /** @param {number[]} indexes */
  const mask=indexes=>indexes.reduce((bits,index)=>bits|(1<<index),0);
  /** @param {number[]} bankIndexes @param {number[]} cardIndexes @param {0|1|2} rank */
  const add=(bankIndexes,cardIndexes,rank)=>claims.push({banks:mask(bankIndexes),cards:mask(cardIndexes),score:[rank===0?bankIndexes.length:0,rank===1?bankIndexes.length:0,rank===2?bankIndexes.length:0]});
  /** @param {number[]} indexes @param {(indexes:number[])=>void} visit */
  function subsets(indexes,visit){
    if(indexes.length>12)return;
    for(let bits=1;bits<(1<<indexes.length);bits++)visit(indexes.filter((_,i)=>bits&(1<<i)));
  }
  for(const [bankIndex,bank] of banks.entries()){
    const strong=bank.eligible.filter(index=>requiredAt(groups,index).proven&&bank.value<0);
    // Native identity outranks amount/provider inference. A bank-specified group
    // is indivisible, so one debit cannot settle only a convenient subset.
    if(bank.nativeIdentity){
      const exactRefund=bank.value>0&&bank.eligible.every(index=>requiredAt(groups,index).known)&&bank.eligible.reduce((sum,index)=>sum+requiredAt(groups,index).expected,0)===bank.value;
      if(strong.length===bank.eligible.length||exactRefund)add([bankIndex],bank.eligible,0);
      continue;
    }
    if(bank.suffixMatches.length===1&&strong.includes(requiredAt(bank.suffixMatches,0))){add([bankIndex],bank.suffixMatches,0);continue}
    if(bank.eligible.length===1&&strong.length===1&&requiredAt(groups,requiredAt(strong,0)).providers.some(provider=>bankRowExplicitlyMatchesProvider(bank.row,provider))){add([bankIndex],strong,1);continue}
    // Unknown amounts can equal any debit. They prevent uniqueness by amount.
    if(bank.eligible.some(index=>!requiredAt(groups,index).known))continue;
    subsets(bank.eligible,cardIndexes=>{
      if(cardIndexes.some(index=>requiredAt(groups,index).due!==requiredAt(groups,requiredAt(cardIndexes,0)).due))return;
      if(cardIndexes.length>1){const providers=cardIndexes.map(index=>String(requiredAt(requiredAt(groups,index).rows,0)?.provider||''));if(!CREDIT_SETTLEMENT_MARKERS[requiredAt(providers,0)]||providers.some(provider=>provider!==requiredAt(providers,0)))return}
      if(cardIndexes.reduce((sum,index)=>sum+requiredAt(groups,index).expected,0)===bank.value)add([bankIndex],cardIndexes,2);
    });
  }
  for(const [cardIndex,group] of groups.entries()){
    if(!group.known||!group.expected)continue;
    const bankIndexes=banks.flatMap((bank,index)=>!bank.nativeIdentity&&bank.eligible.includes(cardIndex)&&bank.eligible.every(i=>requiredAt(groups,i).known)&&Math.sign(bank.value)===Math.sign(group.expected)?[index]:[]);
    subsets(bankIndexes,indexes=>{if(indexes.length>1&&indexes.reduce((sum,index)=>sum+requiredAt(banks,index).value,0)===group.expected)add(indexes,[cardIndex],2)});
  }
  const byBank=banks.map((_,index)=>claims.filter(claim=>claim.banks&(1<<index)));
  /** @param {number} cards @param {number} usedBanks @param {number} anchors */
  function settledByElimination(cards,usedBanks,anchors){
    let settled=cards;
    for(const [bankIndex,bank] of banks.entries()){
      if(usedBanks&(1<<bankIndex)||bank.value>=0||bank.nativeIdentity)continue;
      const remaining=bank.eligible.filter(index=>!(cards&(1<<index)));
      if(remaining.length!==1)continue;
      const index=requiredAt(remaining,0),group=requiredAt(groups,index),provider=String(requiredAt(group.rows,0)?.provider||'');
      if(!group.proven||!CREDIT_SETTLEMENT_MARKERS[provider]||!bankRowExplicitlyMatchesProvider(bank.row,provider))continue;
      // An exact/strong match in this same issuer cycle must anchor elimination.
      // Do not infer settlement merely by counting provider debits and cards.
      if(!bank.eligible.some(other=>(anchors&(1<<other))&&requiredAt(groups,other).due===group.due&&requiredAt(requiredAt(groups,other).rows,0)?.provider===provider))continue;
      if(banks.filter((other,i)=>!(usedBanks&(1<<i))&&other.eligible.includes(index)).length!==1)continue;
      settled|=1<<index;
    }
    return settled;
  }
  let visits=0,overflow=false,guaranteed=0;
  /** @type {[number,number,number]|null} */
  let best=null;
  /** @type {Array<{cards:number,usedBanks:number}>} */
  let explanations=[];
  /** @param {[number,number,number]} a @param {[number,number,number]} b */
  const compare=(a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2];
  /** @param {number} remaining @param {number} cards @param {[number,number,number]} score @param {number} [usedBanks] */
  function search(remaining,cards,score,usedBanks=0){
    if(++visits>50000){overflow=true;return}
    if(!remaining){const comparison=best?compare(score,best):1;if(comparison>0){best=score;guaranteed=cards;explanations=[{cards,usedBanks}]}else if(comparison===0){guaranteed&=cards;explanations.push({cards,usedBanks})}return}
    const bit=remaining&-remaining,index=31-Math.clz32(bit);
    search(remaining^bit,cards,score,usedBanks);
    for(const claim of requiredAt(byBank,index)){
      if(overflow)return;
      if((remaining&claim.banks)!==claim.banks||(cards&claim.cards))continue;
      search(remaining^claim.banks,cards|claim.cards,[score[0]+claim.score[0],score[1]+claim.score[1],score[2]+claim.score[2]],usedBanks|claim.banks);
    }
  }
  search((1<<banks.length)-1,0,[0,0,0]);
  if(overflow)return [];
  // Only an independently guaranteed cycle may anchor elimination. Applying
  // elimination inside a tied assignment would incorrectly turn ambiguity
  // itself into proof (two equal cards, one exact and one different debit).
  const anchors=guaranteed;
  guaranteed=explanations.reduce((common,item)=>common&settledByElimination(item.cards,item.usedBanks,anchors),(1<<groups.length)-1);
  return groups.flatMap((_,index)=>guaranteed&(1<<index)?[index]:[]);
}
