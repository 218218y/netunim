// Same approved file, same existing expense. Never invokes a financial write.
export async function relayExpenseSource({user,body,row,expense,ledger,command,now,send=globalThis.fetch}){
  const result=(status,data)=>({status,body:{ok:status<400,...data}}),file=body.file,metadata=row.source_metadata;
  if(!(file instanceof Blob)||!metadata||!row.source_review||file.size!==metadata.size||file.type!==metadata.contentType)
    return result(409,{code:'expense_source_mismatch',message:'יש לבחור את קובץ המקור המקורי של ההוצאה הקיימת.'});
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==metadata.sha256)return result(409,{code:'expense_source_mismatch',message:'טביעת הקובץ אינה תואמת למקור שאושר. לא נשלח קובץ.'});
  if(expense.url)return command('upload_status'); // Never replace an existing file.
  if(expense.status!==10)return result(409,{code:'invalid_expense_upload_target',message:'לא ניתן לצרף מקור להוצאה במצבה הנוכחי.'});
  if(!['not_started','prepared'].includes(row.file_state)){
    if(!body.retryGeneration||body.retryGeneration!==row.file_generation||!Number.isFinite(Date.parse(row.file_expires_at))||Date.parse(row.file_expires_at)>now())
      return result(409,{code:'morning_expense_upload_pending',message:'ניסיון קודם עדיין בבירור. אפשר לנסות צירוף מבוקר אחרי פקיעת ההרשאה, עם אותו מקור בלבד.'});
    // Explicit retry may deliver the identical bytes twice if an old provider
    // job arrives late. Both target the SAME expense and cannot create another
    // financial record or attach a different invoice. Consent and count persist.
    const retry={...row.source_review,retryCount:(row.source_review.retryCount||0)+1,retryConsentAt:new Date(now()).toISOString(),previousGeneration:row.file_generation};
    row=await ledger.fileTransition(user.id,row,{file_state:'not_started',source_review:retry});
    if(!row)return result(409,{code:'morning_expense_upload_pending',message:'פעולת המקור השתנתה בחלון אחר. יש לרענן מצב.'});
  }
  const prepared=await command('upload_prepare',{sourceFile:metadata,size:file.size,contentType:file.type});
  if(prepared.status!==200||prepared.body.alreadyLinked)return prepared;
  const ticket=await command('upload_ticket',{fileGeneration:prepared.body.fileGeneration});
  if(ticket.status!==200)return ticket;
  const form=new FormData();for(const [key,value] of Object.entries(ticket.body.fields))form.append(key,value);
  form.append('file',file,'source.'+({'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png'}[file.type]));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
  try{
    const response=await send(ticket.body.url,{method:'POST',body:form,credentials:'omit',redirect:'error',signal:controller.signal});
    if(response.status!==204)throw Error('source_not_accepted');
    const ack=await command('upload_ack',{fileGeneration:ticket.body.fileGeneration});
    if(ack.status!==200)return ack;
    return result(200,{...ack.body,ok:true,deliveryAccepted:true,fileLinked:false});
  }catch{
    return result(503,{code:'expense_source_delivery_unknown',message:'ההוצאה שמורה. לא ניתן עדיין לאמת מסירת מקור; מתבצע בירור ללא יצירה נוספת.',fileState:'ticket_issued'});
  }finally{clearTimeout(timer);}
}
