import {esc} from '../../core/values.js';

// This controller belongs to one expense surface/account, never the global catalog.
export function createExpenseSupplierForm({request,capabilities,editable,capture,run,render,choose}){
  let opened=false,name='',taxId='',pending=false,notice='',revision=0;
  function reset(){revision++;opened=false;name='';taxId='';pending=false;notice='';}
  function open(){if(!editable()||!capabilities()?.createSupplier)return false;opened=true;render();document.querySelector('[data-expense-supplier-field="name"]')?.focus();return true;}
  function close(){if(!editable())return false;opened=false;render();return true;}
  function field(element){if(!editable()||pending)return false;if(element.dataset.expenseSupplierField==='name')name=element.value;else taxId=element.value;return true;}
  async function submit(){
    if(!editable()||!capabilities()?.createSupplier)return false;
    const input={name:name.trim(),taxId:taxId.trim()};
    if(!input.name||input.name.length>180||/[\p{Cc}\p{Cf}]/u.test(input.name)||!/^\d{9}$/.test(input.taxId)){
      notice='יש להזין שם ספק ומספר עוסק בן 9 ספרות.';render();return false;
    }
    const epoch=revision,base=capture(true),environment=capabilities().environment;
    const check=()=>{base();if(epoch!==revision)throw Error('מסך הוספת הספק השתנה.');};
    const result=await run(async()=>{
      // A lost browser response is uncertain too. Keep the form in lookup mode.
      const action=pending?'supplier_status':'create_supplier';pending=true;notice='בודק את הספק במורנינג…';render();
      try{
        const value=await request(action,{...input,expectedEnvironment:environment},check);check();
        if(value.verified===true){
          const item=value.item;
          if(!item?.id||item.taxId!==input.taxId||!item.name||item.active!==true||item.country!=='IL')throw Error('פרטי הספק שהתקבלו אינם תואמים.');
          reset();return {item,existing:value.existing===true};
        }
        pending=value.pending!==false;notice=value.message||'הספק עדיין לא אומת במורנינג. יש לבדוק שוב.';return false;
      }catch(error){
        check();
        // Only a structured rejection proves that creation did not reach Morning.
        if(error.status>=400&&error.status<500)pending=false;
        notice=error.message||'תוצאת הוספת הספק אינה ידועה. יש לבדוק שוב במורנינג.';return false;
      }
    });
    if(!result)return false;
    base();if(!editable())return false;
    return choose(result.item,result.existing);
  }
  function markup(disabled){
    if(!opened)return '';
    return `<fieldset class="morning-expense-supplier-create" ${disabled?'disabled':''} aria-label="הוספת ספק למורנינג">
      <legend>הוספת ספק חדש למורנינג</legend>
      <div class="morning-expense-pair"><label>שם הספק<input type="text" maxlength="180" autocomplete="organization" value="${esc(name)}" data-expense-supplier-field="name" data-input="morning-expense-field" ${pending?'readonly':''}></label>
      <label>מספר עוסק<input type="text" inputmode="numeric" maxlength="9" dir="ltr" value="${esc(taxId)}" data-expense-supplier-field="taxId" data-input="morning-expense-field" ${pending?'readonly':''}></label></div>
      <small>יתר הפרטים ייקבעו לפי ברירות המחדל של מורנינג. אם הספק כבר קיים, נבחר את הספק הקיים.</small>
      <p role="status">${esc(notice)}</p>
      <div class="morning-expense-toolbar"><button type="button" class="btn primary" data-action="morning-expense-command" data-expense-command="supplier-create">${pending?'בדיקת הספק במורנינג':'הוספת הספק למורנינג'}</button>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="supplier-close">סגירה</button></div></fieldset>`;
  }
  return {reset,open,close,field,submit,markup,hasWork:()=>pending||opened&&!!(name||taxId)};
}
