const uuid=value=>typeof value==='string'&&/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
export function createExpenseBatchRecovery(storage,owner,environment){
  if(!uuid(owner)||!['production','sandbox'].includes(environment))throw Error('invalid_expense_batch_scope');
  const prefix=`morningExpenseApproved:${environment}:${owner}:`;
  const valid=row=>row?.version===1&&uuid(row.operationId)&&/^[a-f0-9]{64}$/.test(row.sha256)&&['approved','queued','sending','attention'].includes(row.state);
  function get(id){
    if(!uuid(id))throw Error('invalid_expense_batch_operation');
    const raw=storage.getItem(prefix+id);if(!raw)return null;
    try{const row=JSON.parse(raw);if(raw.length<350&&valid(row)&&row.operationId===id)return row;}catch{/* Invalid local metadata is never a financial instruction. */}
    throw Error('מעקב השליחה המקומי אינו תקין. יש לבדוק את הפעולות הקיימות לפני שליחה נוספת.');
  }
  return {get,
    list:()=>{
      const rows=[];
      for(let n=0;n<storage.length;n++){const key=storage.key(n);if(key?.startsWith(prefix)){const row=get(key.slice(prefix.length));if(row)rows.push(row);}}
      return rows;
    },
    put:row=>{
      if(!valid(row))throw Error('invalid_expense_batch_operation');
      // Separate keys avoid replacing another tab's queue. No invoice fields,
      // filenames or PDF content are persisted. The server owns financial state.
      const value={version:1,operationId:row.operationId,sha256:row.sha256,state:row.state};
      storage.setItem(prefix+row.operationId,JSON.stringify(value));
      if(JSON.stringify(get(row.operationId))!==JSON.stringify(value))throw Error('לא ניתן לשמור את מעקב השליחה. דבר לא יישלח.');
    },
    remove:id=>{if(!uuid(id))throw Error('invalid_expense_batch_operation');storage.removeItem(prefix+id);if(storage.getItem(prefix+id)!==null)throw Error('לא ניתן לנקות את מעקב הפעולה. יש לבדוק את מצבה לפני המשך.');}
  };
}
