import {num} from '../../core/money.js';

export const WAREHOUSE_LOCATIONS=['מחסן קטן','מחסן גדול','מקלט','לא ידוע'];

export function inventoryCategoryNamesData(state){return [...new Set(state.inventoryItems.filter(x=>x.active!==false).map(inventoryCategoryName))]}

export function orderedInventoryCategoryNamesData(state){const names=inventoryCategoryNamesData(state),order=Array.isArray(state.inventoryCategoryOrder)?state.inventoryCategoryOrder:[],index=new Map(order.map((name,i)=>[name,i]));return [...names].sort((a,b)=>(index.has(a)?index.get(a):999999)-(index.has(b)?index.get(b):999999)||a.localeCompare(b,'he'))}

export function itemEventsData(state,itemId){return(state.inventoryEvents||[]).filter(e=>e.itemId===itemId)}

export function incomingRemaining(e){if(!e||e.type!=='order'||e.cancelledAt||e.receivedAt)return 0;const total=Math.max(0,Number(e.quantity||0)),received=Math.max(0,Number(e.receivedQuantity||0));return Math.max(0,total-received)}

export function inventoryStatsData(state,itemId){let onHand=0,incoming=0,reserved=0;for(const e of itemEventsData(state,itemId)){const q=Number(e.quantity||0);if(['opening','receive'].includes(e.type))onHand+=q;else if(e.type==='adjust')onHand+=q;else if(e.type==='pickup')onHand-=q;else if(e.type==='order')incoming+=incomingRemaining(e);else if(e.type==='reserve'){if(e.pickedAt)onHand-=q;else if(!e.releasedAt)reserved+=q}}return{onHand,reserved,incoming,available:onHand-reserved,projected:onHand-reserved+incoming}}

export function inventoryTotalsData(state){let onHand=0,reserved=0,incoming=0,available=0;for(const i of state.inventoryItems.filter(x=>x.active!==false)){const s=inventoryStatsData(state,i.id);onHand+=s.onHand;reserved+=s.reserved;incoming+=s.incoming;available+=s.available}return{onHand,reserved,incoming,available}}

export function inventoryCategoryName(i){return String(i?.category||'').trim()||'ללא קטגוריה'}

export function inventoryCategoryGroupsData(state){const groups=new Map();for(const i of state.inventoryItems.filter(x=>x.active!==false)){const name=inventoryCategoryName(i);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(i)}return orderedInventoryCategoryNamesData(state).filter(name=>groups.has(name)).map(name=>({name,items:groups.get(name).sort((a,b)=>a.name.localeCompare(b.name,'he'))}))}

export function inventorySearchMatch(i,q,state){const events=state?itemEventsData(state,i.id):[];return inventoryTextMatch([i.name,i.category,i.sku,i.defaultLocation,i.note,...events.flatMap(e=>[e.id,e.customerName,e.location,e.fromLocation,e.toLocation,e.note,e.supplier,e.reference])],q)}

export function inventoryTextMatch(values,q){return values.filter(Boolean).join(' ').toLocaleLowerCase().includes(String(q||'').trim().toLocaleLowerCase())}

// A missing/ambiguous historical location stays unallocated. Never infer it from a
// mutable item default: editing catalog metadata must not move physical stock.
export function inventoryEventLocation(e){const locations=recognizedWarehouseLocations(e?.location);return locations.length===1?locations[0]:'לא ידוע'}

export function inventoryEventLocationEffects(e){
  if(e.type==='transfer')return [[normalizedWarehouseLocation(e.fromLocation),-Number(e.quantity||0)],[normalizedWarehouseLocation(e.toLocation),Number(e.quantity||0)]];
  return [[inventoryEventLocation(e),inventoryEventOnHandEffect(e)]];
}

export function inventoryLocationStatsData(state,itemId){
  const rows=Object.fromEntries(WAREHOUSE_LOCATIONS.map(location=>[location,{location,onHand:0,reserved:0,incoming:0,available:0,projected:0}]));
  for(const e of itemEventsData(state,itemId)){
    for(const [location,quantity] of inventoryEventLocationEffects(e))rows[location].onHand+=quantity;
    const row=rows[inventoryEventLocation(e)];
    if(e.type==='order')row.incoming+=incomingRemaining(e);
    if(e.type==='reserve'&&!e.pickedAt&&!e.releasedAt)row.reserved+=Number(e.quantity||0);
  }
  for(const row of Object.values(rows)){row.available=row.onHand-row.reserved;row.projected=row.available+row.incoming}
  return rows;
}

export function inventoryCanArchiveData(state,itemId){return Object.values(inventoryLocationStatsData(state,itemId)).every(s=>s.onHand===0&&s.incoming===0&&s.reserved===0)}

export function inventoryStockStatus(i,s){
  const min=Math.max(0,Number(i.minStock)||0),target=Math.max(min,Number(i.targetStock)||0);
  const needsOrder=s.projected<min,short=s.available<0;
  return {short,needsOrder,suggested:needsOrder?Math.max(0,target-s.projected):0,label:short?'חוסר':needsOrder?'מתחת למינימום':s.incoming>0?'בדרך':'תקין',cls:short?'red':needsOrder?'yellow':'green'};
}

export function inventoryTransferProblem(state,itemId,from,to,quantity){
  if(!state.inventoryItems.some(i=>i.id===itemId&&i.active!==false))return 'הפריט אינו פעיל';
  if(!WAREHOUSE_LOCATIONS.includes(from)||!WAREHOUSE_LOCATIONS.includes(to)||from===to)return 'יש לבחור מחסן מקור ומחסן יעד שונים';
  if(!Number.isSafeInteger(quantity)||quantity<=0)return 'יש להזין כמות שלמה וחיובית';
  const s=inventoryLocationStatsData(state,itemId)[from];
  if(quantity>Math.max(0,Math.min(s.onHand,s.available)))return 'אין מספיק מלאי פנוי במחסן המקור. יש לבטל או לשנות שמירות לפני ההעברה';
  return '';
}

export function inventoryGroupStatsData(state,items){return items.reduce((out,i)=>{const s=inventoryStatsData(state,i.id);out.onHand+=s.onHand;out.reserved+=s.reserved;out.available+=s.available;out.incoming+=s.incoming;return out},{onHand:0,reserved:0,available:0,incoming:0})}

export function recognizedWarehouseLocations(raw){raw=String(raw||'').replace(/\s+/g,' ').trim();if(!raw)return[];if(raw==='לא ידוע')return['לא ידוע'];return WAREHOUSE_LOCATIONS.filter(name=>name!=='לא ידוע'&&(name==='מקלט'?/מקלט/.test(raw):name==='מחסן קטן'?/מחסן\s*קטן/.test(raw):/מחסן\s*גדול/.test(raw)))}

export function normalizedWarehouseLocation(raw){return recognizedWarehouseLocations(raw)[0]||'לא ידוע'}

export function inventoryLocationTextData(state,i){const values=[i?.defaultLocation||''];for(const e of itemEventsData(state,i?.id)){if(['opening','receive','adjust'].includes(e.type)){if(e.location)values.push(e.location);if(e.receivedLocation)values.push(e.receivedLocation)}}return values.filter(Boolean).join(' / ')}

export function inventoryItemLocationsData(state,i){const locations=Object.values(inventoryLocationStatsData(state,i?.id)).filter(s=>s.onHand!==0||s.reserved!==0||s.incoming!==0).map(s=>s.location);return locations.length?locations:[normalizedWarehouseLocation(i?.defaultLocation)]}

export function inventoryEventIsActive(e){return!!(e&&(e.type==='order'?incomingRemaining(e)>0:e.type==='reserve'&&!e.pickedAt&&!e.releasedAt))}

export function inventoryEventOnHandEffect(e){if(!e)return 0;const q=Number(e.quantity||0);if(['opening','receive','adjust'].includes(e.type))return q;if(e.type==='pickup')return-q;if(e.type==='reserve'&&e.pickedAt)return-q;return 0}

export function inventoryHistoryDeletePlan(state,ids){
  const selected=new Set((ids||[]).map(String)),events=(state?.inventoryEvents||[]).filter(e=>selected.has(String(e.id))),blocked=events.filter(inventoryEventIsActive),deletable=blocked.length?[]:events,effects=new Map(),locationEffects=new Map();
  for(const e of deletable){
    if(!e.itemId)continue;
    const effect=inventoryEventOnHandEffect(e);if(effect)effects.set(e.itemId,(effects.get(e.itemId)||0)+effect);
    for(const [location,quantity] of inventoryEventLocationEffects(e)){
      if(!quantity)continue;
      if(!locationEffects.has(e.itemId))locationEffects.set(e.itemId,new Map());
      const locations=locationEffects.get(e.itemId);locations.set(location,(locations.get(location)||0)+quantity);
    }
  }
  return {blockedIds:blocked.map(e=>e.id),deletableIds:deletable.map(e=>e.id),effects,locationEffects};
}

export function inventoryEventViewData(state,e){const item=state.inventoryItems.find(i=>i.id===e.itemId),q=Number(e.quantity||0),when=e.pickedAt||e.releasedAt||e.receivedAt||e.cancelledAt||e.updatedAt||e.createdAt||'';let label='תנועה',cls='',effect='';if(e.type==='opening'){label='יתרת פתיחה';cls='green';effect=`+${num(q)}`}else if(e.type==='receive'){label='קליטה למחסן';cls='green';effect=`+${num(q)}`}else if(e.type==='adjust'){label=e.historyCompaction?'יתרת מעבר':'התאמת מלאי';cls=q<0?'red':'green';effect=`${q>0?'+':''}${num(q)}`}else if(e.type==='order'){const received=Math.max(0,Number(e.receivedQuantity||0)),remaining=incomingRemaining(e);if(e.receivedAt){label='הזמנה שהתקבלה';cls='green';effect=num(q)}else if(e.cancelledAt){label=received>0?'יתרת הזמנה בוטלה':'הזמנה שבוטלה';cls='red';effect=received>0?`${num(received)} נקלטו`:'0'}else if(received>0){label='הזמנה בדרך · נקלט חלקית';cls='yellow';effect=`${num(remaining)} בדרך`}else{label='הזמנה בדרך';cls='yellow';effect=num(q)}}else if(e.type==='reserve'){if(e.pickedAt){label='נאסף ע״י לקוח';cls='green';effect=`-${num(q)}`}else if(e.releasedAt){label='שמירה בוטלה';cls='';effect='0'}else{label='שמור ללקוח';cls='yellow';effect='0'}}else if(e.type==='transfer'){label='העברה בין מחסנים';effect=`${num(q)} · ${e.fromLocation} ← ${e.toLocation}`}else if(e.type==='pickup'){label='איסוף (נתון ישן)';cls='green';effect=`-${num(q)}`}else if(e.type==='release'){label='ביטול שמירה (נתון ישן)';effect='0'}return{e,item,label,cls,effect,when}}
