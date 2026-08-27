

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsSuppliersCommands({supplierTx}){
function resequenceSupplier(id,ordered=null){const rows=ordered||supplierTx(id);rows.forEach((t,i)=>t.sequence=i+1);return rows}

function insertTransactionAfter(row,supplierId,afterId=null){const ordered=supplierTx(supplierId).filter(t=>t.id!==row.id);if(afterId){const idx=ordered.findIndex(t=>t.id===afterId);if(idx>=0)ordered.splice(idx+1,0,row);else ordered.push(row)}else ordered.push(row);resequenceSupplier(supplierId,ordered)}

function moveTransactionAfter(row,supplierId,afterId=null){const ordered=supplierTx(supplierId).filter(t=>t.id!==row.id);if(afterId===null){ordered.unshift(row)}else{const idx=ordered.findIndex(t=>t.id===afterId);if(idx<0)return false;ordered.splice(idx+1,0,row)}resequenceSupplier(supplierId,ordered);return true}

return { resequenceSupplier, insertTransactionAfter, moveTransactionAfter };
}
