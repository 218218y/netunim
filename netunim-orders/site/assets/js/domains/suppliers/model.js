export function supplierTxData(state,id){return state.transactions.filter(t=>t.supplierId===id).sort((a,b)=>Number(a.sequence||0)-Number(b.sequence||0))}

export function balanceRowsData(state,id){let bal=0;return supplierTxData(state,id).map(t=>{bal+=Number(t.credit||0)-Number(t.debit||0);return {t,balance:Math.round((bal+Number.EPSILON)*100)/100}})}

export function supplierBalanceData(state,id){const rows=balanceRowsData(state,id);return rows.length?rows.at(-1).balance:0}

export function validSupplierYear(value){const y=Number(value);return Number.isInteger(y)&&y>=2000&&y<=2100?y:null}

export function transactionWorkflowComplete(t){const flags=[t?.invoiceReceived,t?.signed,t?.supplied];return flags.every(v=>v==null)||flags.every(v=>v===true)}

export function supplierYearContextData(state,id){const rows=supplierTxData(state,id),yearById=new Map(),boundaries=[],segment=[];for(const t of rows){segment.push(t);const year=validSupplierYear(t.yearEnd);if(year!==null){boundaries.push({id:t.id,sequence:Number(t.sequence||0),year});segment.forEach(row=>yearById.set(row.id,year));segment.length=0}}const years=[...new Set(boundaries.map(b=>b.year))].sort((a,b)=>b-a),maxClosedYear=years.length?Math.max(...years):null,currentYear=maxClosedYear!==null?maxClosedYear+1:new Date().getFullYear(),carryOpen=rows.filter(t=>yearById.has(t.id)&&!transactionWorkflowComplete(t)).length;return{rows,yearById,boundaries,years,currentYear,carryOpen}}

export function supplierArchiveYearsData(state){return [...new Set(state.suppliers.flatMap(s=>supplierYearContextData(state,s.id).years))].sort((a,b)=>b-a)}

export function supplierPeriodTxData(state,id,yearView='current'){
  const ctx=supplierYearContextData(state,id);
  if(yearView==='all')return ctx.rows;
  if(yearView==='current')return ctx.rows.filter(t=>!ctx.yearById.has(t.id));
  const year=validSupplierYear(yearView);
  return year===null?ctx.rows.filter(t=>!ctx.yearById.has(t.id)):ctx.rows.filter(t=>ctx.yearById.get(t.id)===year);
}

export function supplierFinancialStatsData(state,id,yearView='current'){
  let debit=0,credit=0;const rows=supplierPeriodTxData(state,id,yearView);
  for(const t of rows){debit+=Number(t.debit||0);credit+=Number(t.credit||0)}
  const round=value=>Math.round((value+Number.EPSILON)*100)/100;
  debit=round(debit);credit=round(credit);
  return{debit,credit,net:round(credit-debit),txCount:rows.length};
}

export function totalStatsData(state){let debt=0,credit=0,pending=0,missing=0,hm=0;for(const s of state.suppliers){const b=supplierBalanceData(state,s.id);if(b<0)debt+=-b;else credit+=b}for(const t of state.transactions){if(t.supplied===false)pending++;if(t.invoiceReceived===false)missing++;if(t.hmIssued)hm++}return{debt,credit,pending,missing,hm,net:credit-debt}}

export function supplierSortValue(s){return Number.isFinite(Number(s?.sortOrder))?Number(s.sortOrder):999999}

export function orderedSuppliersData(state){return [...state.suppliers].sort((a,b)=>supplierSortValue(a)-supplierSortValue(b)||a.name.localeCompare(b.name,'he'))}
