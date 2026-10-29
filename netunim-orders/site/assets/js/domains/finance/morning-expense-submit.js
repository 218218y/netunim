import {normalizeExpenseInput} from '../../core/morning-expense-input.js';
import {expenseSourceExpected} from '../../core/morning-expense-source.js';

export async function approveExpenseDraft({draft,classification,supplier,operationId,today,capabilities,confirmDialog,check,
  currentSurface,preflight,prepareSource,verifySource,request,progress}){
  const snapshot=structuredClone(draft);
  snapshot.number=normalizeExpenseInput({operationId,expense:snapshot},today,{allowP:capabilities.pcnP===true}).number;
  if(!classification?.id)throw Error('יש לבחור סיווג מתוך ההצעות לפני שמירה.');
  // No remote work before this dialog. The source and editable fields have
  // already been visible side by side; repeat neither values nor a second form.
  const approved=await confirmDialog(capabilities.environment==='production'?'שמירת הוצאה בחשבון Morning האמיתי':'שמירת הוצאה ב־Sandbox',
    'האם בדקת את פרטי ההוצאה מול מסמך המקור וההוצאה מאושרת לשמירה?',{confirmText:'אישור ושמירה'});
  check();if(!approved||!currentSurface())return null;
  progress('checks','בודק את הפרטים ומוודא שאין כפילות…');
  await preflight(snapshot,supplier,check);check();
  if(capabilities.duplicateCheck){
    const duplicate=await request('duplicate_check',{operationId,expense:snapshot},check);check();
    if(duplicate.duplicate!==false)throw Error(duplicate.message||'לא ניתן לאשר שהחשבונית אינה כפולה. יש לבדוק לפני שמירה.');
  }
  progress('checks','מוודא שמסמך המקור מתאים להוצאה…');
  const source=await prepareSource(expenseSourceExpected({...snapshot,amount:snapshot.gross,supplier:{taxId:supplier.taxId}}),check);check();
  await verifySource(check);check();return {snapshot,source};
}
export async function approveSourceRetry({request,operationId,check,selected,confirmDialog}){
  let result=await request('operation_status',{operationId},check);check();
  result={...result,...await request('upload_status',{operationId},check)};check();
  if(result.fileLinked)return {result,retryGeneration:''};
  if(Date.parse(result.sourceRetryAt)>Date.now())throw Error('יש להמתין '+Math.ceil((Date.parse(result.sourceRetryAt)-Date.now())/1000)+' שניות לפקיעת ניסיון הצירוף הקודם. לאחר מכן אפשר לצרף מחדש את אותו מקור.');
  if(!selected)throw Error('יש לבחור מחדש את קובץ המקור המקורי של ההוצאה.');
  const approved=await confirmDialog('צירוף מחדש להוצאה הקיימת','ייבדק ויישלח אותו קובץ מקור בלבד לאותה הוצאה. לא תיווצר הוצאה נוספת. אם עיבוד קודם יסתיים באיחור, שתי המסירות יהיו של אותו קובץ לאותה הוצאה.',{confirmText:'צירוף אותו מקור בלבד'});
  check();return approved?{result,retryGeneration:result.sourceRetryGeneration}:null;
}
