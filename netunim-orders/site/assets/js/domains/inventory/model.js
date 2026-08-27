import {num} from '../../core/money.js';

export const WAREHOUSE_LOCATIONS=['מחסן גדול','מקלט','מחסן קטן'];

export function inventoryCategoryNamesData(state){return [...new Set(state.inventoryItems.filter(x=>x.active!==false).map(inventoryCategoryName))]}

export function orderedInventoryCategoryNamesData(state){const names=inventoryCategoryNamesData(state),order=Array.isArray(state.inventoryCategoryOrder)?state.inventoryCategoryOrder:[],index=new Map(order.map((name,i)=>[name,i]));return [...names].sort((a,b)=>(index.has(a)?index.get(a):999999)-(index.has(b)?index.get(b):999999)||a.localeCompare(b,'he'))}

export function itemEventsData(state,itemId){return(state.inventoryEvents||[]).filter(e=>e.itemId===itemId)}

export function incomingRemaining(e){if(!e||e.type!=='order'||e.cancelledAt||e.receivedAt)return 0;const total=Math.max(0,Number(e.quantity||0)),received=Math.max(0,Number(e.receivedQuantity||0));return Math.max(0,total-received)}

export function inventoryStatsData(state,itemId){let onHand=0,incoming=0,reserved=0;for(const e of itemEventsData(state,itemId)){const q=Number(e.quantity||0);if(['opening','receive'].includes(e.type))onHand+=q;else if(e.type==='adjust')onHand+=q;else if(e.type==='pickup')onHand-=q;else if(e.type==='order')incoming+=incomingRemaining(e);else if(e.type==='reserve'){if(e.pickedAt)onHand-=q;else if(!e.releasedAt)reserved+=q}}return{onHand,reserved,incoming,available:onHand-reserved,projected:onHand-reserved+incoming}}

export function inventoryTotalsData(state){let onHand=0,reserved=0,incoming=0,available=0;for(const i of state.inventoryItems.filter(x=>x.active!==false)){const s=inventoryStatsData(state,i.id);onHand+=s.onHand;reserved+=s.reserved;incoming+=s.incoming;available+=s.available}return{onHand,reserved,incoming,available}}

export function inventoryCategoryName(i){return String(i?.category||'').trim()||'ללא קטגוריה'}

export function inventoryCategoryGroupsData(state){const groups=new Map();for(const i of state.inventoryItems.filter(x=>x.active!==false)){const name=inventoryCategoryName(i);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(i)}return orderedInventoryCategoryNamesData(state).filter(name=>groups.has(name)).map(name=>({name,items:groups.get(name).sort((a,b)=>a.name.localeCompare(b.name,'he'))}))}

export function inventorySearchMatch(i,q){return !q||`${i.name||''} ${i.category||''} ${i.defaultLocation||''} ${i.note||''}`.includes(q)}

export function inventoryGroupStatsData(state,items){return items.reduce((out,i)=>{const s=inventoryStatsData(state,i.id);out.onHand+=s.onHand;out.reserved+=s.reserved;out.available+=s.available;out.incoming+=s.incoming;return out},{onHand:0,reserved:0,available:0,incoming:0})}

export function recognizedWarehouseLocations(raw){raw=String(raw||'').replace(/\s+/g,' ');return WAREHOUSE_LOCATIONS.filter(name=>name==='מקלט'?/מקלט/.test(raw):name==='מחסן קטן'?/מחסן\s*קטן/.test(raw):/מחסן\s*גדול/.test(raw))}

export function inventoryLocationTextData(state,i){const values=[i?.defaultLocation||''];for(const e of itemEventsData(state,i?.id)){if(['opening','receive','adjust'].includes(e.type)){if(e.location)values.push(e.location);if(e.receivedLocation)values.push(e.receivedLocation)}}return values.filter(Boolean).join(' / ')}

export function inventoryItemLocationsData(state,i){const preferred=recognizedWarehouseLocations(i?.defaultLocation);if(preferred.length)return preferred;const physical=itemEventsData(state,i?.id).filter(e=>['opening','receive','adjust'].includes(e.type)).sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));for(const e of physical){const found=recognizedWarehouseLocations(e.receivedLocation||e.location);if(found.length)return found}return[]}

export function inventoryEventViewData(state,e){const item=state.inventoryItems.find(i=>i.id===e.itemId),q=Number(e.quantity||0),when=e.pickedAt||e.releasedAt||e.receivedAt||e.cancelledAt||e.updatedAt||e.createdAt||'';let label='תנועה',cls='',effect='';if(e.type==='opening'){label='יתרת פתיחה';cls='green';effect=`+${num(q)}`}else if(e.type==='receive'){label='קליטה למחסן';cls='green';effect=`+${num(q)}`}else if(e.type==='adjust'){label='התאמת מלאי';cls=q<0?'red':'green';effect=`${q>0?'+':''}${num(q)}`}else if(e.type==='order'){const received=Math.max(0,Number(e.receivedQuantity||0)),remaining=incomingRemaining(e);if(e.receivedAt){label='הזמנה שהתקבלה';cls='green';effect=num(q)}else if(e.cancelledAt){label=received>0?'יתרת הזמנה בוטלה':'הזמנה שבוטלה';cls='red';effect=received>0?`${num(received)} נקלטו`:'0'}else if(received>0){label='הזמנה בדרך · נקלט חלקית';cls='yellow';effect=`${num(remaining)} בדרך`}else{label='הזמנה בדרך';cls='yellow';effect=num(q)}}else if(e.type==='reserve'){if(e.pickedAt){label='נאסף ע״י לקוח';cls='green';effect=`-${num(q)}`}else if(e.releasedAt){label='שמירה בוטלה';cls='';effect='0'}else{label='שמור ללקוח';cls='yellow';effect='0'}}else if(e.type==='pickup'){label='איסוף (נתון ישן)';cls='green';effect=`-${num(q)}`}else if(e.type==='release'){label='ביטול שמירה (נתון ישן)';effect='0'}return{e,item,label,cls,effect,when}}
