import {esc} from '../../core/values.js';
import {normalizeExpenseSource,expenseSourceFields,compareExpenseSource,expenseSourceExpected} from '../../core/morning-expense-source.js';
import {ocrFileHash} from './morning-expense-ocr.js';
const labels={supplierTaxId:'מספר העוסק',number:'מספר החשבונית',documentType:'סוג המסמך',date:'תאריך החשבונית',
  netCents:'לפני מע״מ',vatCents:'מע״מ',grossCents:'סכום כולל',allocationNumber:'מספר הקצאה'};
export function createExpenseSourceSupport({files,request,capture,run,capabilities,selected,proposal,confirmDialog,activeOperation,isActive}) {
  let rows=[],page=0,error='',more=false,controller=null,revision=0,readRevision=0;
  function reset(){revision++;readRevision++;controller?.abort();controller=null;rows=[];page=0;error='';more=false;}
  async function prepare(expected,check,{existingMetadata=null,existingReview=null,afterCreation=false}={}){
    const source=selected();if(!source)return null;
    if(capabilities()?.sourceIntent!==true)throw Error('שירות ההוצאות טרם תומך במעקב עמיד אחר המקור. יש לרענן לאחר עדכון השירות.');
    controller?.abort();controller=new AbortController();const signal=controller.signal,epoch=revision;
    const current=()=>{check();if(epoch!==revision||signal.aborted||source!==selected())throw new DOMException('Aborted','AbortError');};
    const sha256=await ocrFileHash(source.file);current();
    const sourceFile=normalizeExpenseSource({sha256,size:source.file.size,contentType:source.type});
    if(existingMetadata){
      if(existingMetadata.sha256!==sha256||existingMetadata.size!==sourceFile.size||existingMetadata.contentType!==source.type)
        throw Error('הקובץ שנבחר אינו המקור שאושר ליצירת הוצאה זו. יש לבחור מחדש את אותו קובץ מקור.');
      if(existingReview)return {sourceFile,notice:''};
    }
    let found=proposal();
    if(!found?.proposal||found.hash!==sha256){
      found=null;
      if(source.type==='application/pdf'&&files.extract&&files.recognize){
        try{const extracted=await files.extract(source.file,{signal,check:current});current();found={proposal:await files.recognize(extracted)};current();}
        catch{current();}
      }
    }
    const fields=expenseSourceFields(found?.proposal),comparison=compareExpenseSource(fields,expected);
    const detail=`מספר ${expected.number}, תאריך ${expected.date}, עוסק ${expected.supplierTaxId}, סה״כ ${(expected.grossCents/100).toFixed(2)} ₪ ומע״מ ${(expected.vatCents/100).toFixed(2)} ₪`;
    let mode='extracted',reason='',notice='';
    if(!comparison.matched){
      mode='manual';reason='המקור נבדק ידנית מול פרטי החשבונית ואושר במפורש';
      notice=comparison.conflicts.length?`קיימת סתירה בזיהוי המקור: ${comparison.conflicts.map(key=>labels[key]).join(', ')}. `:
        'לא כל נתוני המקור אומתו בחילוץ אוטומטי. יש לבדוק את המסמך ידנית מול הפרטים. ';
      if(comparison.conflicts.length||afterCreation){
        const approved=await confirmDialog('בדיקה ידנית של התאמת המקור',`${notice}${detail}. יש לבחור מקור אחר אם הוא שייך לחשבונית אחרת. האם בדקת שהקובץ אכן מתאים להוצאה?`,
          {confirmText:'אשר התאמה לאחר בדיקה ידנית'});current();if(!approved)throw Error('התאמת המקור לא אושרה. לא נמסרה הרשאת העלאה.');
      }
    }
    return {sourceFile,sourceReview:{mode,fields,...(reason?{reason}:{})},notice};
  }
  function update(){if(!isActive())return;const target=document.querySelector('[data-expense-source-pending]');if(target)target.outerHTML=markup();}
  function refresh(append=false){
    if(!capabilities()?.sourceIntent)return false;
    const check=capture(),epoch=revision,read=++readRevision,next=append?page+1:0;
    return run(async()=>{
      try{
        const value=await request('source_pending',{page:next,expectedEnvironment:capabilities().environment},check);check();if(epoch!==revision||read!==readRevision)return false;
        if(!Array.isArray(value.items)||value.items.length>20||value.page!==next||value.pageSize!==20)throw Error('Invalid pending-source response');
        const found=value.items.filter(row=>typeof row.operationId==='string'&&row.sourceExpected===true);
        if(found.length!==value.items.length)throw Error('Invalid source operation');
        rows=append?[...new Map([...rows,...found].map(row=>[row.operationId,row])).values()]:found;page=next;more=found.length===20;error='';
      }catch{try{check();}catch{return false;}if(epoch===revision&&read===readRevision)error='לא ניתן לקרוא כרגע את רשימת ההשלמות. מזהי הפעולות נשארו בשרת.';}
      if(epoch===revision&&read===readRevision)update();return true;
    });
  }
  function markup(){
    if(!capabilities()?.sourceIntent)return '<div data-expense-source-pending></div>';
    return `<section class="morning-expense-source-pending" data-expense-source-pending>
      <h2>מקורות הדורשים השלמה או אימות</h2><p>פעולות שנשמרו בשרת ועדיין דורשות טיפול במקור · ${rows.length} מוצגות.</p>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="source-refresh">רענון ההשלמות</button>
      ${error?`<p role="alert">${esc(error)}</p>`:''}
      ${rows.length?`<ul>${rows.map(row=>`<li><span>${esc(row.intent?.supplierName||'ספק לבדיקה')} ·
        <bdi>${esc(row.intent?.number||'')}</bdi> · ${esc(row.intent?.date||'')} ·
        ${row.verified?'נוצרה הוצאה; המקור דורש טיפול':'הפעולה דורשת בדיקת מצב לפני המשך'}
        </span><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="source-resume"
        data-source-operation="${esc(row.operationId)}" ${activeOperation()&&activeOperation()!==row.operationId?'disabled':''}>פתיחה והשלמה</button></li>`).join('')}</ul>`:
        error?'<p>לא ניתן לאמת כרגע אם קיימות השלמות נוספות.</p>':'<p>לא נמצאו השלמות ממתינות בחיפוש זה.</p>'}
      ${more?'<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="source-more">השלמות נוספות</button>':''}
    </section>`;
  }
  function prepareOperation(result,check){
    if(!result?.intent?.supplierTaxId)throw Error('יש לבדוק את מצב היצירה כדי לקרוא מהשרת את כל פרטי ההוצאה לפני התאמת מקור.');
    const expected=expenseSourceExpected({...result.intent,supplier:{taxId:result.intent.supplierTaxId}});
    return prepare(expected,check,{existingMetadata:result.sourceMetadata,existingReview:result.sourceReview,afterCreation:true});
  }
  function receipt(result,busy,reason){
    if(!result?.sourceExpected)return '';
    return `<p class="morning-expense-notice" data-expense-source-state>${result.sourceVerified?
      'הקובץ נקרא ממורנינג וטביעתו תואמת למקור שאושר.':result.sourceException?'חריגה ידנית מתועדת: '+esc(result.sourceExceptionReason):
        'ההוצאה או הפעולה שמורות בשרת, אך המקור עדיין דורש העלאה או אימות. לאחר רענון יש לבחור מחדש את המקור המקורי.'}</p>
      ${result.verified&&result.sourcePending?`<details><summary>תיעוד חריגה אם לא ניתן להשלים את המקור</summary>
        <label>סיבת החריגה<input maxlength="250" data-expense-field="sourceReason" data-input="morning-expense-field" value="${esc(reason)}" ${busy?'disabled':''}></label>
        <button type="button" class="btn" data-action="morning-expense-write" data-expense-command="source-waive" ${busy?'disabled':''}>בדיקה ותיעוד החריגה</button></details>`:''}`;
  }
  return {prepare,prepareOperation,receipt,refresh,markup,reset,more:()=>refresh(true)};
}
