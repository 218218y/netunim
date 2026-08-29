const GROUPS=[
  {key:'suppliers',label:'ספקים'},
  {key:'customers',label:'לקוחות'},
  {key:'service',label:'שירות'},
  {key:'checks',label:"צ'קים"},
  {key:'warehouse',label:'מחסן ומלאי'},
  {key:'notes',label:'הערות'}
];

const WAREHOUSE_EVENT_LABELS={opening:'יתרת פתיחה',order:'הזמנת מלאי',receive:'קליטה למחסן',adjust:'התאמת מלאי',reserve:'שמירה ללקוח',pickup:'איסוף',release:'ביטול שמירה'};
const WAREHOUSE_ORDER_LABELS={to_order:'להזמין',ordered:'הוזמן',direct:'הוזמן',arrived:'הגיע',picked:'נאסף'};

export function normalizeGlobalSearchText(value){
  return String(value??'').normalize('NFKD').replace(/[\u0591-\u05C7]/g,'').toLocaleLowerCase('he').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ')
}

function compactSearchText(value){return normalizeGlobalSearchText(value).replace(/\s+/g,'')}
function sourceValues(source){return source?[source.sheet,source.row]:[]}
function truthLabel(value,yes,no){return value===true?yes:value===false?no:''}
function joinText(values){return values.flat(Infinity).filter(v=>v!==undefined&&v!==null&&v!=='').join(' ')}
function entrySearchText(values){const normalized=normalizeGlobalSearchText(joinText(values));return `${normalized} ${normalized.replace(/\s+/g,'')}`.trim()}

function supplierEntries(state){
  const suppliers=Array.isArray(state.suppliers)?state.suppliers:[],transactions=Array.isArray(state.transactions)?state.transactions:[],supplierById=new Map(suppliers.map(s=>[s.id,s]));
  const entries=suppliers.map(s=>({group:'suppliers',kind:'supplier',id:s.id,context:s.name||'ספק',badge:'כרטיס ספק',title:s.name||'ספק ללא שם',subtitle:s.note||'פתיחת כרטיס הספק',meta:[],searchText:entrySearchText([s.name,s.note])}));
  for(const t of transactions){const supplier=supplierById.get(t.supplierId);if(!supplier)continue;const supplierName=supplier.name||'ספק',debit=Number(t.debit||0),credit=Number(t.credit||0),amount=debit||credit||0;entries.push({group:'suppliers',kind:'supplier-transaction',id:t.id,parentId:t.supplierId,context:supplierName,badge:'תנועת ספק',title:t.action||`תנועה ${t.sequence||''}`.trim(),subtitle:[t.supplyInfo,t.note].filter(Boolean).join(' · ')||`תנועה ${t.sequence||''}`.trim(),amount:amount||null,meta:[t.yearEnd?`סוף ${t.yearEnd}`:'',t.source?.row?`שורת מקור ${t.source.row}`:''].filter(Boolean),searchText:entrySearchText([supplierName,t.sequence,t.action,t.debit,t.credit,t.supplyInfo,t.note,t.yearEnd,...sourceValues(t.source),truthLabel(t.invoiceReceived,'חשבונית התקבלה','חסרה חשבונית'),truthLabel(t.signed,'חתום','לא חתום'),truthLabel(t.supplied,'סופק','לא סופק'),t.hmIssued?'חמ יצא':''])})}
  return entries
}

function customerEntries(state){
  const debts=(Array.isArray(state.customerDebts)?state.customerDebts:[]).map(d=>({group:'customers',kind:'customer-debt',id:d.id,context:d.customerName||'לקוח',badge:'חוב לקוח',title:d.customerName||'לקוח ללא שם',subtitle:[d.orderNumber?`הזמנה ${d.orderNumber}`:'',d.phone,d.note].filter(Boolean).join(' · ')||'כרטיס חוב',amount:Number(d.amount||0),meta:[d.paid?'שולם':'פתוח',d.invoiceIssued?'חשבונית יצאה':''].filter(Boolean),searchText:entrySearchText([d.customerName,d.orderNumber,d.phone,d.amount,d.note,...sourceValues(d.source),truthLabel(d.paid,'שולם','לא שולם'),truthLabel(d.supplied,'סופק','לא סופק'),truthLabel(d.invoiceIssued,'חשבונית יצאה','חסרה חשבונית')])}));
  const orders=(Array.isArray(state.customerOrders)?state.customerOrders:[]).map(o=>({group:'customers',kind:'customer-order',id:o.id,context:o.customerName||'לקוח',badge:'מעקב הזמנה',title:o.customerName||o.orderNumber||'הזמנה',subtitle:[o.orderNumber?`הזמנה ${o.orderNumber}`:'',o.note].filter(Boolean).join(' · ')||'מעקב הזמנה',meta:[o.mattressMarked?'מזרונים':'',o.sourceAttention?'דורש תשומת לב':''].filter(Boolean),searchText:entrySearchText([o.customerName,o.orderNumber,o.sourceMarkA,o.sourceMarkB,o.mattressRaw,o.note,...sourceValues(o.source),o.mattressMarked?'מזרונים':'',o.sourceAttention?'דורש תשומת לב':''])}));
  return [...debts,...orders]
}

function serviceEntries(state){return (Array.isArray(state.serviceCalls)?state.serviceCalls:[]).map(c=>({group:'service',kind:'service-call',id:c.id,context:c.customerName||'לקוח',badge:'קריאת שירות',title:c.customerName||'קריאת שירות',subtitle:[c.orderNumber?`הזמנה ${c.orderNumber}`:'',c.description,c.note].filter(Boolean).join(' · '),meta:[c.closed?'נסגרה':'פתוחה',c.nextFollowUp?`מעקב ${c.nextFollowUp}`:''].filter(Boolean),searchText:entrySearchText([c.customerName,c.orderNumber,c.phone,c.address,c.description,c.openedAt,c.nextFollowUp,c.assignee,c.note,c.closedAt,...sourceValues(c.source),c.followUp?'מעקב':'',c.sent?'נשלח':'',c.escalated?'הקפצה':'',c.closed?'נסגר':''])}))}

function checkEntries(state){return (Array.isArray(state.checks)?state.checks:[]).map(c=>({group:'checks',kind:'check',id:c.id,context:c.name||'לקוח',badge:"צ'ק",title:c.name||"צ'ק",subtitle:[c.checkNumber?`מס׳ ${c.checkNumber}`:'',c.dueDate?`פירעון ${c.dueDate}`:'',c.note].filter(Boolean).join(' · '),amount:Number(c.amount||0),meta:[c.status].filter(Boolean),searchText:entrySearchText([c.name,c.amount,c.dueDate,c.status,c.depositDate,c.clearedDate,c.checkNumber,c.note,c.createdAt])}))}

function warehouseEntries(state){
  const items=Array.isArray(state.inventoryItems)?state.inventoryItems:[],events=Array.isArray(state.inventoryEvents)?state.inventoryEvents:[],orders=Array.isArray(state.warehouseOrders)?state.warehouseOrders:[],itemById=new Map(items.map(i=>[i.id,i]));
  const itemEntries=items.map(i=>({group:'warehouse',kind:'inventory-item',id:i.id,context:i.category||'מלאי',badge:i.active===false?'פריט מלאי בארכיון':'פריט מלאי',title:i.name||'פריט ללא שם',subtitle:[i.category,i.defaultLocation,i.note].filter(Boolean).join(' · '),meta:[i.active===false?'בארכיון':'פעיל'],searchText:entrySearchText([i.name,i.category,i.defaultLocation,i.note,i.active===false?'ארכיון':'פעיל'])}));
  const eventEntries=events.map(e=>{const item=itemById.get(e.itemId),label=WAREHOUSE_EVENT_LABELS[e.type]||'תנועת מלאי';return{group:'warehouse',kind:'inventory-event',id:e.id,parentId:e.itemId,context:item?.name||'פריט לא ידוע',badge:label,title:e.customerName||item?.name||label,subtitle:[item?.name&&e.customerName?item.name:'',e.location,e.receivedLocation,e.note].filter(Boolean).join(' · ')||label,meta:[e.quantity!==undefined?`${e.quantity} יח׳`:'',e.createdAt?String(e.createdAt).slice(0,10):''].filter(Boolean),searchText:entrySearchText([item?.name,item?.category,e.customerName,e.quantity,e.location,e.receivedLocation,e.note,e.createdAt,e.updatedAt,e.receivedAt,e.pickedAt,e.releasedAt,e.cancelledAt,label])}});
  const orderEntries=orders.map(o=>({group:'warehouse',kind:'warehouse-order',id:o.id,context:o.customerName||'לקוח',badge:'הזמנת מחסן',title:o.customerName||'הזמנת מחסן',subtitle:[o.details,o.location,o.note].filter(Boolean).join(' · '),meta:[WAREHOUSE_ORDER_LABELS[o.status]||o.status,o.phone].filter(Boolean),searchText:entrySearchText([o.customerName,o.phone,o.details,o.location,o.note,WAREHOUSE_ORDER_LABELS[o.status],o.status,...sourceValues(o.source)])}));
  return [...itemEntries,...eventEntries,...orderEntries]
}

function noteEntries(state){return (Array.isArray(state.notes)?state.notes:[]).map(n=>({group:'notes',kind:'note',id:n.id,context:'הערות',badge:'פתק',title:String(n.content||'').trim().slice(0,70)||'פתק ללא תוכן',subtitle:String(n.content||'').trim().slice(70,190),meta:[n.updatedAt?String(n.updatedAt).slice(0,10):''].filter(Boolean),searchText:entrySearchText([n.content,n.createdAt,n.updatedAt])}))}

export function buildGlobalSearchEntries(state={}){return [...supplierEntries(state),...customerEntries(state),...serviceEntries(state),...checkEntries(state),...warehouseEntries(state),...noteEntries(state)].filter(entry=>entry.id!==undefined&&entry.id!==null&&entry.id!=='')}

function matchEntry(entry,queryCompact,tokens){
  const hay=entry.searchText||'',hayCompact=hay.replace(/\s+/g,'');
  if(queryCompact&&hayCompact.includes(queryCompact))return true;
  return tokens.every(token=>hay.includes(token)||hayCompact.includes(token))
}

function entryRank(entry,queryNormalized){
  const title=normalizeGlobalSearchText(entry.title),context=normalizeGlobalSearchText(entry.context),badge=normalizeGlobalSearchText(entry.badge);
  if(title===queryNormalized||context===queryNormalized)return 0;
  if(title.startsWith(queryNormalized)||context.startsWith(queryNormalized))return 1;
  if(title.includes(queryNormalized)||context.includes(queryNormalized))return 2;
  if(badge.includes(queryNormalized))return 3;
  return 4
}

export function searchGlobalData(state,query,{limitPerGroup=60}={}){
  const queryNormalized=normalizeGlobalSearchText(query),queryCompact=compactSearchText(query),tokens=queryNormalized.split(' ').filter(Boolean);
  if(!queryNormalized)return{query:'',total:0,groups:GROUPS.map(group=>({...group,total:0,items:[]}))};
  const matches=buildGlobalSearchEntries(state).filter(entry=>matchEntry(entry,queryCompact,tokens)).map((entry,index)=>({...entry,_rank:entryRank(entry,queryNormalized),_index:index}));
  const groups=GROUPS.map(group=>{const items=matches.filter(x=>x.group===group.key).sort((a,b)=>a._rank-b._rank||String(a.context||'').localeCompare(String(b.context||''),'he')||a._index-b._index);return{...group,total:items.length,items:items.slice(0,Math.max(1,limitPerGroup)).map(({_rank,_index,...item})=>item)}});
  return{query:queryNormalized,total:matches.length,groups}
}
