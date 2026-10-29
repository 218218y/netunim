import {normalizeExpenseInput} from '../../core/morning-expense-input.js';
import {expenseSourceExpected} from '../../core/morning-expense-source.js';

export function validateExpenseDraft({draft,classification,operationId,today,capabilities}){
  const snapshot=structuredClone(draft);
  snapshot.number=normalizeExpenseInput({operationId,expense:snapshot},today,{allowP:capabilities.pcnP===true}).number;
  if(!classification?.id)throw Error('יש לבחור סיווג מתוך ההצעות לפני שמירה.');
  return snapshot;
}
export function expenseDraftProblem(options){
  const labels={supplierId:'ספק',classificationExpenseId:'סיווג',documentType:'סוג מסמך',number:'מספר חשבונית',date:'תאריך חשבונית',net:'סכום לפני מע״מ',vat:'מע״מ מהמקור',gross:'סכום כולל'};
  const missing=Object.entries(labels).filter(([key])=>options.draft[key]===null||options.draft[key]===undefined||String(options.draft[key]).trim()==='').map(([,label])=>label);
  if(missing.length)return 'יש להשלים לפני אישור: '+missing.join(', ')+'.';
  try{validateExpenseDraft({...options,operationId:'00000000-0000-4000-8000-000000000001'});return '';}
  catch(error){return ({expense_allocation_required:'יש להשלים מספר הקצאה מהמקור לפני אישור החשבונית.',invalid_expense_amounts:'לפני מע״מ ומע״מ חייבים להסתכם לסכום הכולל, בדיוק של אגורות.',invalid_expense_input:'יש לבדוק את מספר החשבונית, סוג המסמך והתאריכים.',invalid_expense_reporting_period:'יש לבדוק את תאריך החשבונית ותקופת הדיווח.',invalid_expense_p_number:'יש להשלים מספר חשבונית P תקין.'})[error.message]||'יש להשלים ולבדוק את הפרטים לפני אישור.';}
}
export async function prepareExpenseApproval({draft,classification,supplier,capabilities,today,eligibility,sendNow,paused,confirmDialog,check,prepareSource}){
  if(!capabilities.backgroundQueue||!capabilities.create||!capabilities.upload)throw Error('שליחת הוצאות ומקורות אינה זמינה כרגע.');
  if(sendNow&&paused)throw Error('השליחה הקודמת דורשת טיפול. אפשר להמשיך לבדוק ולסמן מסמכים כמאושרים בלי לשלוח אותם.');
  if(!eligibility.eligible||draft.pcnClassification==='P'&&!eligibility.p)throw Error(eligibility.reason||'יש לבדוק את ספק וסיווג P.');
  const snapshot=validateExpenseDraft({draft,classification,operationId:crypto.randomUUID(),today,capabilities});
  if(sendNow){
    const approved=await confirmDialog(capabilities.environment==='production'?'שמירת הוצאה בחשבון Morning האמיתי':'שמירת הוצאה ב־Sandbox',
      'האם בדקת את פרטי ההוצאה מול מסמך המקור וההוצאה מאושרת לשמירה?',{confirmText:'אישור ושמירה ברקע'});check();if(!approved)return null;
  }
  const source=await prepareSource(expenseSourceExpected({...snapshot,amount:snapshot.gross,supplier:{taxId:supplier.taxId}}),check);check();
  return {snapshot,source};
}
export async function approveExpenseDraft({draft,classification,supplier,operationId,today,capabilities,confirmDialog,check,
  currentSurface,preflight,prepareSource,verifySource,request,progress,approvedSnapshot=null}){
  const snapshot=validateExpenseDraft({draft,classification,operationId,today,capabilities});
  if(approvedSnapshot&&JSON.stringify(snapshot)!==JSON.stringify(approvedSnapshot))throw Error('פרטי ההוצאה השתנו מאז האישור. יש לבדוק ולאשר מחדש.');
  // No remote work before this dialog. The source and editable fields have
  // already been visible side by side; repeat neither values nor a second form.
  const approved=approvedSnapshot||await confirmDialog(capabilities.environment==='production'?'שמירת הוצאה בחשבון Morning האמיתי':'שמירת הוצאה ב־Sandbox',
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
