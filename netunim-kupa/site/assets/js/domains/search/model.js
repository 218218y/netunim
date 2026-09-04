import {dateSearchAliases,normalizeSearchText} from '../../core/search.js';
import {creditMonthlyDetailData,creditDetailItemIdentity} from '../credit/model.js';
import {CREDIT_PROVIDER_LABELS} from '../credit/sync-feed.js';
import {bankTransactionIdentity} from '../bank/feed.js';

const GROUPS=[
  {key:'checks',label:"צ׳קים"},
  {key:'credit',label:'אשראי'},
  {key:'expenses',label:'הוצאות'},
  {key:'cash',label:'מזומן ומעשר'},
  {key:'bank',label:'בנק'},
  {key:'notes',label:'הערות וגיליון'}
];

export const normalizeKupaSearchText=normalizeSearchText;
function compact(value){return normalizeKupaSearchText(value).replace(/\s+/g,'')}
function join(values){return values.flat(Infinity).filter(v=>v!==undefined&&v!==null&&v!=='').join(' ')}
function searchText(values,dateValues=[]){const dates=dateValues.flatMap(dateSearchAliases),normalized=normalizeKupaSearchText(join([...values,...dateValues,...dates]));return `${normalized} ${normalized.replace(/\s+/g,'')}`.trim()}
function boolLabel(value,yes,no){return value===true?yes:value===false?no:''}

function checkEntries(state){return (Array.isArray(state.checks)?state.checks:[]).map(c=>({group:'checks',kind:'check',id:String(c.id),account:c.account==='ביתי'?'ביתי':'עסקי',context:c.name||'צ׳ק',badge:`צ׳ק ${c.account==='ביתי'?'ביתי':'עסקי'}`,title:c.name||'צ׳ק ללא שם',subtitle:[c.checkNumber?`מס׳ ${c.checkNumber}`:'',c.dueDate?`פירעון ${c.dueDate}`:'',c.note].filter(Boolean).join(' · '),amount:Number(c.amount||0),meta:[c.status,c.account].filter(Boolean),searchText:searchText([c.name,c.checkNumber,c.note,c.status,c.account,c.amount],[c.dueDate,c.depositDate,c.clearedDate,c.createdAt])}))}

function creditEntries(state){
  const detail=creditMonthlyDetailData(state),entries=[];
  for(const month of detail.months)for(const item of month.items){
    const total=item.source==='manual'?Number(item.record?.totalAmount||0):Number(item.series?.totalAmount||0),provider=item.source==='manual'?'תוספת ידנית':(CREDIT_PROVIDER_LABELS[item.provider]||item.provider||'מסונכרן');
    entries.push({group:'credit',kind:item.source==='manual'?'manual-credit':'synced-credit',id:creditDetailItemIdentity(item),monthKey:month.key,cardKey:item.creditAccountKey||'',context:item.card||'כרטיס אשראי',badge:provider,title:item.description||item.card||'עסקת אשראי',subtitle:[item.card,item.transactionDate?`עסקה ${item.transactionDate}`:'',item.date?`חיוב ${item.date}`:''].filter(Boolean).join(' · '),amount:Number(item.amount||0),meta:[item.account,item.ownerLabel,Number(item.totalParts)>1?`תשלום ${item.part}/${item.totalParts}`:'',total?`עסקה ${total}`:''].filter(Boolean),searchText:searchText([item.card,item.description,item.amount,total,item.part,item.totalParts,item.account,item.ownerLabel,provider,item.profileId,item.accountNumber],[item.transactionDate,item.date])});
  }
  return entries;
}

function expenseEntries(state){return (Array.isArray(state.expenses)?state.expenses:[]).map(x=>({group:'expenses',kind:'expense',id:String(x.id),context:x.account==='ביתי'?'חשבון ביתי':'חשבון עסקי',badge:'הוצאה',title:x.description||'הוצאה',subtitle:[x.type,x.recurring!==false?'חוזרת':'חד־פעמית',x.active===false?'לא פעילה':'פעילה'].filter(Boolean).join(' · '),amount:Number(x.amount||0),meta:[x.account].filter(Boolean),searchText:searchText([x.description,x.type,x.amount,x.account,boolLabel(x.recurring!==false,'חוזרת','חד פעמית'),boolLabel(x.active!==false,'פעילה','לא פעילה')],[x.date])}))}

function cashEntries(state){
  const build=(rows,kind,label)=>rows.map(x=>({group:'cash',kind,id:String(x.id),context:label,badge:label,title:x.description||x.type||label,subtitle:[x.type,x.note].filter(Boolean).join(' · '),amount:Number(x.amount||0),meta:[],searchText:searchText([x.description,x.type,x.note,x.amount,label],[x.date])}));
  return [...build(Array.isArray(state.cash)?state.cash:[],'cash-row','מזומן'),...build(Array.isArray(state.rights)?state.rights:[],'rights-row','מעשר')];
}

function bankEntries(state){
  const build=(feed,role)=>{const account=feed?.accountNumber||'',label=role==='home'?'חשבון ביתי':'חשבון עסקי';return (Array.isArray(feed?.transactions)?feed.transactions:[]).map((row,index)=>{const locator=String(row.id||row.bankSerial||row.bankReference||row.description||'').trim();return {group:'bank',kind:'bank-transaction',id:bankTransactionIdentity(row,role,index),role,searchHint:locator,context:account?`${label} ${account}`:label,badge:row.status==='pending'?'תנועת בנק ממתינה':'תנועת בנק',title:row.description||'תנועת בנק',subtitle:[row.memo,row.partyName,row.bankReference?`אסמכתא ${row.bankReference}`:''].filter(Boolean).join(' · '),amount:Number(row.amount||0),meta:[row.balanceAfter!==null&&row.balanceAfter!==undefined?`יתרה ${row.balanceAfter}`:''].filter(Boolean),searchText:searchText([row.description,row.memo,row.partyName,row.partyHeadline,row.messageHeadline,row.messageDetail,row.amount,row.balanceAfter,row.bankReference,row.bankSerial,row.id,row.status,account,JSON.stringify(row.checkDetails||{})],[row.date,row.processedDate])}})};
  return [...build(state.bank?.feed,'business'),...build(state.bank?.homeFeed,'home')];
}

function noteEntries(state){
  const notes=(Array.isArray(state.notes)?state.notes:[]).map(n=>({group:'notes',kind:'note',id:String(n.id),context:'הערות',badge:'פתק',title:String(n.content||'').trim().slice(0,76)||'פתק ללא תוכן',subtitle:String(n.content||'').trim().slice(76,190),meta:[],searchText:searchText([n.content],[n.createdAt,n.updatedAt])}));
  const sheet=state.notesSheet&&typeof state.notesSheet==='object'?state.notesSheet:{columns:[],rows:[]},columns=Array.isArray(sheet.columns)?sheet.columns:[];
  const rows=(Array.isArray(sheet.rows)?sheet.rows:[]).map((row,index)=>{const values=columns.map(c=>row.cells?.[c.id]??''),filled=values.filter(v=>String(v).trim()),preview=filled.slice(0,3).join(' · ');return {group:'notes',kind:'sheet-row',id:String(row.id),context:'גיליון',badge:`שורה ${index+1}`,title:preview||`שורה ${index+1}`,subtitle:filled.slice(3,7).join(' · '),meta:[],searchText:searchText(values,[row.createdAt,row.updatedAt])}});
  return [...notes,...rows];
}

export function buildKupaGlobalSearchEntries(state={}){return [...checkEntries(state),...creditEntries(state),...expenseEntries(state),...cashEntries(state),...bankEntries(state),...noteEntries(state)].filter(x=>x.id)}
function matchEntry(entry,queryCompact,tokens){const hay=entry.searchText||'',hayCompact=hay.replace(/\s+/g,'');if(queryCompact&&hayCompact.includes(queryCompact))return true;return tokens.every(token=>hay.includes(token)||hayCompact.includes(token))}
function rank(entry,query){const title=normalizeKupaSearchText(entry.title),context=normalizeKupaSearchText(entry.context),badge=normalizeKupaSearchText(entry.badge);if(title===query||context===query)return 0;if(title.startsWith(query)||context.startsWith(query))return 1;if(title.includes(query)||context.includes(query))return 2;if(badge.includes(query))return 3;return 4}
export function searchKupaGlobalData(state,query,{limitPerGroup=60}={}){const normalized=normalizeKupaSearchText(query),queryCompact=compact(query),tokens=normalized.split(' ').filter(Boolean);if(!normalized)return {query:'',total:0,groups:GROUPS.map(g=>({...g,total:0,items:[]}))};const matches=buildKupaGlobalSearchEntries(state).filter(x=>matchEntry(x,queryCompact,tokens)).map((x,index)=>({...x,_rank:rank(x,normalized),_index:index}));const groups=GROUPS.map(g=>{const items=matches.filter(x=>x.group===g.key).sort((a,b)=>a._rank-b._rank||String(a.context||'').localeCompare(String(b.context||''),'he')||a._index-b._index);return {...g,total:items.length,items:items.slice(0,Math.max(1,limitPerGroup)).map(({_rank,_index,...item})=>item)}});return {query:normalized,total:matches.length,groups}}
