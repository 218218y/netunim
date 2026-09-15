import {esc} from '../../core/values.js';
import {WAREHOUSE_LOCATIONS, inventoryCategoryName, inventorySearchMatch, normalizedWarehouseLocation, inventoryLocationStatsData, inventoryStockStatus} from './model.js';
import {num} from '../../core/money.js';

export function createDomainsInventoryView({warehouseUi, model, orderedInventoryCategoryNames, inventoryStats, inventoryCategoryGroups}){
function inventoryLocationOptions(value=''){const current=normalizedWarehouseLocation(value);return WAREHOUSE_LOCATIONS.map(x=>`<option value="${esc(x)}" ${x===current?'selected':''}>${esc(x)}</option>`).join('')}
function inventoryCategoryDatalist(){return `<datalist id="inventoryCategoryList">${orderedInventoryCategoryNames().filter(x=>x!=='ללא קטגוריה').map(x=>`<option value="${esc(x)}"></option>`).join('')}</datalist>`}

function stockCard(i,location=''){
  const balances=inventoryLocationStatsData(model.state,i.id),s=location?balances[location]:inventoryStats(i.id),status=inventoryStockStatus(i,inventoryStats(i.id));
  const selected=warehouseUi.warehouseBulkSelected.has(i.id),short=(location?[s]:Object.values(balances)).some(x=>x.available<0);
  const places=Object.values(balances).filter(x=>x.onHand||x.reserved||x.incoming);
  const button=(action,label)=>`<button class="btn small" data-action="${action}" data-click-arg0="${esc(i.id)}" data-click-arg1="${esc(location)}">${label}</button>`;
  return `<tr data-stock-bulk-id="${esc(i.id)}" data-warehouse-bulk-id="${esc(i.id)}" class="${short?'stock-short':''} ${selected?'bulk-selected-card':''}">
    <td class="stock-name-cell">${warehouseUi.warehouseBulkMode?`<input aria-label="בחר ${esc(i.name)}" class="bulk-check" data-stock-bulk-check data-warehouse-bulk-check type="checkbox" ${selected?'checked':''} data-action="toggle-warehouse-bulk-row" data-change="toggle-warehouse-bulk-row" data-click-arg0="${esc(i.id)}">`:''}<button class="stock-name-link" data-action="open-inventory-details" data-click-arg0="${esc(i.id)}">${esc(i.name)}</button><div class="source">${esc(inventoryCategoryName(i))}${i.sku?` · ${esc(i.sku)}`:''}</div></td>
    <td class="stock-location-cell">${location?esc(location):places.length?places.map(x=>`<span class="stock-location-chip">${esc(x.location)} <b>${num(x.onHand)}</b></span>`).join(' '):`<span class="source">${esc(i.defaultLocation||'לא ידוע')} · אין מלאי</span>`}</td>
    <td data-label="במחסן">${num(s.onHand)}</td><td data-label="שמור">${num(s.reserved)}</td><td data-label="פנוי" class="stock-available ${s.available<0?'badtext':'goodtext'}">${num(s.available)}</td><td data-label="בדרך" title="פנוי צפוי: ${num(s.projected)}">${num(s.incoming)}</td>
    <td><span class="badge ${short?'red':status.cls}">${short?'חוסר במחסן':status.label}</span></td>
    <td><div class="stock-actions">${s.incoming?button('open-stock-receive','קליטה'):status.needsOrder?button('open-inventory-event-modal','הזמן'):''}<details class="warehouse-menu"><summary aria-label="פעולות עבור ${esc(i.name)}" title="פעולות">⋯</summary><div class="warehouse-menu-content">${button('open-inventory-event-modal','הזמן מלאי')}${button('open-stock-receive','קליטה למחסן')}${button('open-inventory-event-modal-2','שמור ללקוח')}${button('open-stock-transfer','העברה בין מחסנים')}${button('open-stock-adjustment-modal','ספירת מלאי')}${button('open-inventory-item-modal','עריכת פריט')}${button('open-inventory-details','פרטים ותנועות')}</div></details></div></td></tr>`;
}

function stockTable(items,location=''){
  return `<div class="stock-table-wrap"><table class="inventory-table"><thead><tr><th scope="col">פריט</th><th scope="col">חלוקה למחסנים</th><th scope="col">במחסן</th><th scope="col">שמור</th><th scope="col">פנוי</th><th scope="col">בדרך</th><th scope="col">מצב הפריט</th><th scope="col">פעולות</th></tr></thead><tbody>${items.map(i=>stockCard(i,location)).join('')}</tbody></table></div>`;
}

function renderStockGrid(){
  const location=warehouseUi.inventoryLocation||'',filter=warehouseUi.inventoryFilter||'',grouping=warehouseUi.inventoryGrouping||'';
  const items=inventoryCategoryGroups().flatMap(g=>g.items).filter(i=>{
    if(!inventorySearchMatch(i,warehouseUi.warehouseSearch,model.state))return false;
    const balances=inventoryLocationStatsData(model.state,i.id),s=location?balances[location]:inventoryStats(i.id),status=inventoryStockStatus(i,inventoryStats(i.id));
    if(location&&!s.onHand&&!s.reserved&&!s.incoming&&!(Object.values(balances).every(x=>!x.onHand&&!x.reserved&&!x.incoming)&&normalizedWarehouseLocation(i.defaultLocation)===location))return false;
    if(filter==='short')return (location?[s]:Object.values(balances)).some(x=>x.available<0);
    if(filter==='low')return status.needsOrder;
    if(filter==='unknown')return !!(balances['לא ידוע'].onHand||balances['לא ידוע'].reserved||balances['לא ידוע'].incoming);
    return true;
  });
  const summary=`<div class="inventory-result-count">${items.length} פריטים${location?` · ${esc(location)}`:' · כל המחסנים'}${filter?' · סינון פעיל':''}</div>`;
  if(!items.length)return summary+'<div class="empty module-empty">לא נמצאו פריטים בתצוגה הזאת. אפשר לשנות את החיפוש או הסינון.</div>';
  if(grouping==='location'&&!location)return summary+WAREHOUSE_LOCATIONS.map(name=>{
    const rows=items.filter(i=>{const balances=inventoryLocationStatsData(model.state,i.id),s=balances[name];return s.onHand||s.reserved||s.incoming||(Object.values(balances).every(x=>!x.onHand&&!x.reserved&&!x.incoming)&&normalizedWarehouseLocation(i.defaultLocation)===name)});
    return rows.length?`<section class="stock-section"><h3>${esc(name)} <span class="source">${rows.length} פריטים</span></h3>${stockTable(rows,name)}</section>`:'';
  }).join('');
  if(grouping==='category')return summary+inventoryCategoryGroups().map(g=>{const rows=items.filter(i=>inventoryCategoryName(i)===g.name);return rows.length?`<section class="stock-section"><h3>${esc(g.name)}</h3>${stockTable(rows,location)}</section>`:''}).join('');
  return summary+stockTable(items,location);
}

function renderWarehouseLocations(){return renderStockGrid()}
return {inventoryLocationOptions,inventoryCategoryDatalist,stockCard,renderStockGrid,renderWarehouseLocations};
}
