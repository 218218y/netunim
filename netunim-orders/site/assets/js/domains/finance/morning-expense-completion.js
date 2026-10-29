// One financial operation, at most one delivered upload ticket, read-only
// reconciliation afterwards. Never mistake an opaque S3 response for success.
export async function completeExpenseSource({request, upload, prepare, selected, result, attempted, markAttempted, accept, check, progress,
  uploadEnabled, delays=[0,1000,2000,3000,5000,8000,10000,15000,20000,25000],
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  check();
  if (!result.verified) return false;
  if (result.sourceVerified || !result.sourceExpected && !selected) return true;
  const update=value=>{check();result={...result,...value};accept(result);};
  if(selected&&result.fileLinked&&!result.sourceVerified){
    const source=await prepare(check);check();
    update(await request('source_verify',{contentType:selected.type,size:selected.file.size,...source},check));
    if(result.sourceVerified)return true;
  }
  if (selected && !attempted && !result.fileLinked && ['not_started','prepared',undefined].includes(result.fileState)) {
    if (!uploadEnabled) throw Error('ההוצאה נשמרה, אך העלאת המקור כבויה. יש להשלים את המקור לאחר הפעלתה.');
    const source=await prepare(check);check();
    progress('ההוצאה נשמרה ואומתה. מצרף את מסמך המקור…');
    const ready=await request('upload_prepare',{contentType:selected.type,size:selected.file.size,...source},check);check();
    if (ready.alreadyLinked) {update(ready);return result.sourceVerified===true;}
    update({fileState:'prepared'});
    // Reserve uncertainty before requesting a signed form. Status can safely
    // release a preparation failure; a delivered ticket is never sent again.
    markAttempted();
    const ticket=await request('upload_ticket',{fileGeneration:ready.fileGeneration},check);check();update({fileState:'ticket_issued'});
    try {
      const sent=await upload(ticket,selected,check);check();
      if (sent?.accepted===true) {
        await request('upload_ack',{fileGeneration:ticket.fileGeneration},check);check();update({fileState:'file_accepted'});
      }
    } catch { check(); /* Lost transport/ack response: reconcile, never replay. */ }
  }
  progress('ההוצאה נשמרה. ממתין לקישור המקור ולאימות התאמת הקובץ במורנינג…');
  for (const delay of delays) {
    for (let left=delay;left>0;left-=250) {check();await sleep(Math.min(left,250));}
    check();
    try {
      update(await request('upload_status',{},check));
      if (result.sourceVerified===true) return true;
      if (result.sourceCheck==='mismatch') throw Error('expense_source_mismatch');
    } catch(error) {
      check();
      if (result.sourceCheck==='mismatch'||error.code==='expense_source_mismatch'||error.message==='expense_source_mismatch')
        throw Error('הקובץ במורנינג אינו תואם למקור שאושר. התהליך נעצר; לא תישלח העלאה נוספת.');
      // A bounded read failure must not trigger another write or erase recovery.
    }
  }
  progress(selected?'ההוצאה נשמרה; אימות המקור טרם הושלם. נשארנו בחשבונית זו. אפשר להמשיך את בדיקת המצב; אין לשמור או להעלות שוב.':
    'ההוצאה נקראה מהשרת. יש לבחור מחדש את קובץ המקור המקורי כדי להשלים את הצירוף והאימות.');
  return false;
}
