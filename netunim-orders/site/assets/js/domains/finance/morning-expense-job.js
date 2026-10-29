import {validateExpenseDraft} from './morning-expense-submit.js';
import {completeExpenseSource} from './morning-expense-completion.js';

// Own one approved snapshot and one File. No reference to the editable form,
// selected PDF, shared result or current operation is allowed in this pipeline.
export async function executeExpenseJob(job,{request,check,capabilities,today,upload,progress,financial,
  sourceCompletion=completeExpenseSource}){
  const send=(action,body={},guard=check)=>request(action,{operationId:job.operationId,expectedEnvironment:capabilities.environment,...body},guard);
  const snapshot=validateExpenseDraft({draft:job.snapshot,classification:job.saved.classification?.classification,
    operationId:job.operationId,today,capabilities});
  if(!capabilities.create||!capabilities.upload)throw Error('שמירה או צירוף מקור כבויים כרגע. המסמך נשאר למעקב ולא נשלח.');
  check();progress('checks','בודק את פרטי ההוצאה ואת מסמך המקור…');
  if(!capabilities.duplicateCheck||!capabilities.sourceIntent||!capabilities.ocrFileGuard)throw Error('יש לרענן לאחר עדכון שירות בדיקות ההוצאות.');
  const supplier=(await send('get_supplier',{id:snapshot.supplierId})).item;check();
  if(supplier?.id!==job.saved.supplier?.id||supplier?.taxId!==job.saved.supplier?.taxId||!supplier?.active)throw Error('פרטי הספק השתנו מאז האישור. יש לבדוק ולאשר מחדש.');
  const classification=(await send('get_expense',{id:snapshot.classificationExpenseId})).item;check();
  if(classification?.id!==snapshot.classificationExpenseId||classification.status===100||classification.classification?.id!==job.saved.classification?.classification?.id)throw Error('סיווג ההוצאה השתנה מאז האישור. יש לבדוק ולאשר מחדש.');
  const ocr=await send('ocr_lookup',{sha256:job.source.sourceFile.sha256});check();
  if(ocr.hasOcrOperation!==false)throw Error('לקובץ קיימת סריקת Morning או שלא ניתן לאמת זאת. השליחה נעצרה למניעת כפילות.');
  const duplicate=await send('duplicate_check',{expense:snapshot});check();
  if(duplicate.duplicate!==false)throw Error(duplicate.message||'קיימת הוצאה זהה או שלא ניתן לשלול כפילות.');
  progress('create','שומר את ההוצאה במורנינג ומאמת את פרטיה…');
  // Sending metadata was durably recorded by the scheduler before this call.
  // A rejected/lost response NEVER causes a second financial POST.
  job.result=await send('create',{expense:snapshot,sourceFile:job.source.sourceFile,sourceReview:job.source.sourceReview});check();
  if(!job.result.verified)throw Error('תוצאת יצירת ההוצאה טרם אומתה. יש לבדוק מצב; לא תישלח יצירה נוספת.');
  financial(job.result);check();
  let lastMessage='';
  const complete=await sourceCompletion({request:send,upload,prepare:async guard=>{guard();return job.source;},
    selected:job.item,result:job.result,attempted:false,markAttempted:()=>{check();job.fileAttempted=true;},
    accept:value=>{check();job.result=value;},check,progress:(text,stage='verify')=>{lastMessage=text;progress(stage,text);},
    uploadEnabled:capabilities.upload,relay:capabilities.sourceRelay});check();
  if(!complete||job.result.sourceVerified!==true)throw Error(lastMessage||'ההוצאה נוצרה אך צירוף המקור או אימותו טרם הושלמו. יש להמשיך בבדיקת מצב.');
  return job.result;
}
