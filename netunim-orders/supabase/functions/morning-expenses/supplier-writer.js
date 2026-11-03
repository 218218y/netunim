import {expensePage,expenseSupplier} from './service.js';
import {expenseWriteAccess} from './write-access.js';

export function supplierInput(body){
  const name=typeof body?.name==='string'?body.name.trim():'',taxId=typeof body?.taxId==='string'?body.taxId.trim():'';
  if(!name||name.length>180||/[\p{Cc}\p{Cf}]/u.test(name)||!/^\d{9}$/.test(taxId))throw Error('invalid_supplier_input');
  return {name,taxId};
}
const reply=(status,body)=>({status,body:{ok:status<400,...body}});
export function createSupplierWriter({request,ledger,environment,enabled=false,writeIds=()=>'',productionUserId=''}){
  const authorized=user=>expenseWriteAccess(user,environment,writeIds(),productionUserId);
  const allowed=user=>enabled===true&&authorized(user);
  async function find(taxId){
    const rows=[],ids=new Set();let total=null,pages=1;
    for(let page=0;page<pages;page++){
      // Omitting active is documented to include inactive suppliers as well.
      const result=expensePage(await request('/suppliers/search',{method:'POST',body:JSON.stringify({taxId,page:page+1,pageSize:50})}),page,expenseSupplier);
      if(result.pages>4||total!==null&&total!==result.total||result.items.some(row=>row.taxId!==taxId||ids.has(row.id)))throw Error('invalid_supplier_directory');
      total=result.total;pages=result.pages;
      for(const row of result.items){ids.add(row.id);rows.push(row);}
    }
    if(rows.length>1)throw Error('supplier_identity_ambiguous');
    if(!rows.length)return null;
    const supplier=expenseSupplier(await request('/suppliers/'+rows[0].id,{method:'GET'}));
    if(supplier.id!==rows[0].id||supplier.taxId!==taxId)throw Error('invalid_supplier_directory');
    if(!supplier.active)throw Error('supplier_inactive');
    if(supplier.country!=='IL')throw Error('supplier_country');
    return supplier;
  }
  return {allowed,async handle(user,body){
    const statusOnly=body.action==='supplier_status';
    if(!(statusOnly?authorized(user):allowed(user)))return reply(403,{code:'morning_supplier_forbidden',message:'אין הרשאה להוספת ספק בחשבון Morning זה.'});
    let attempted=false;
    try{
      const input=supplierInput(body);
      const existing=await find(input.taxId);
      if(existing){
        if(await ledger.get(input.taxId)){
          if(!await ledger.verify(input.taxId,existing.id))throw Error('morning_supplier_storage_failed');
        }
        return reply(200,{item:existing,existing:true,verified:true});
      }
      let row=await ledger.get(input.taxId);
      if(statusOnly||row&&row.state!=='reserved')return reply(202,{verified:false,pending:!!row,code:'morning_supplier_pending',message:row?'תוצאת הוספת הספק עדיין בבדיקה. יש לבדוק שוב או להשלים בירור במורנינג; לא נשלחת בקשת יצירה נוספת.':'הספק עדיין לא נמצא במורנינג.'});
      if(!row)row=await ledger.reserve(user.id,input)||await ledger.get(input.taxId);
      if(!row)throw Error('morning_supplier_storage_failed');
      // Persist BEFORE the POST; even a timeout or a cold restart cannot replay it.
      const claimed=await ledger.claim(input.taxId);
      if(!claimed)return reply(202,{verified:false,pending:true,code:'morning_supplier_pending',message:'הוספת הספק כבר בטיפול. יש לבדוק שוב את הספק במורנינג.'});
      attempted=true;
      const created=expenseSupplier(await request('/suppliers',{method:'POST',body:JSON.stringify({name:claimed.name,taxId:input.taxId})}));
      const item=expenseSupplier(await request('/suppliers/'+created.id,{method:'GET'}));
      if(item.id!==created.id||item.taxId!==input.taxId||item.name!==claimed.name||!item.active||item.country!=='IL')throw Error('invalid_supplier_created');
      if(!await ledger.verify(input.taxId,item.id))throw Error('morning_supplier_storage_failed');
      return reply(200,{item,existing:false,verified:true});
    }catch(error){
      const messages={invalid_supplier_input:'יש להזין שם ספק עד 180 תווים ומספר עוסק בן 9 ספרות.',supplier_identity_ambiguous:'קיימים מספר ספקים עם מספר העוסק הזה. יש להסדיר אותם במורנינג לפני בחירה.',supplier_inactive:'ספק עם מספר עוסק זה כבר קיים ואינו פעיל. יש להפעילו במורנינג.',supplier_country:'ספק עם מספר עוסק זה כבר קיים ומדינתו אינה ישראל. יש לבדוק את פרטיו במורנינג.'};
      if(messages[error.message])return reply(error.message==='invalid_supplier_input'?400:409,{code:error.message,message:messages[error.message]});
      if(attempted)return reply(202,{verified:false,pending:true,code:'morning_supplier_pending',message:'בקשת ההוספה נשלחה אך תוצאתה טרם אומתה. יש לבדוק שוב את הספק במורנינג; הבקשה לא תישלח אוטומטית פעם נוספת.'});
      return reply(502,{code:'morning_supplier_unavailable',message:'לא ניתן לבדוק את ספריית הספקים כעת. יש לנסות שוב.'});
    }
  }};
}
