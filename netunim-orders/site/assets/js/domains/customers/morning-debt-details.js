import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {customerDebtProgressData} from '../../shared/customer-debt-progress.js';

const noteLabels={note:'הערה',urgency:'הערת דחוף לטיפול'};
const readNote=(debt,key)=>String((key==='urgency'?debt?.urgency?.note:debt?.note)??'').replace(/\r\n?/g,'\n');

function noteMarkup(debt,key){
  const label=noteLabels[key],id=`morningDebtNote-${key}`,note=readNote(debt,key);
  const button=(action,text,attributes='')=>
    `<button type="button" class="btn small" data-action="${action}" data-click-arg0="${key}" ${attributes}>${text}</button>`;
  return `<section class="morning-debt-note">
    <label for="${id}">${label}</label>
    <textarea id="${id}" rows="2" readonly data-no-draft-guard data-input="morning-debt-note-draft" data-input-arg0="${key}">
${esc(note)}</textarea>
    <div class="morning-debt-note-actions">
      ${button('morning-debt-note-copy','העתק',note?'':'disabled')}
      <div data-debt-note-view>
        ${button('morning-debt-note-edit','ערוך')}${key==='urgency'?button('morning-debt-note-remove','הסר סימון'):''}
      </div>
      <div data-debt-note-edit hidden>${button('morning-debt-note-save','שמור')}${button('morning-debt-note-cancel','ביטול')}</div>
    </div>
  </section>`;
}

export function morningDebtDetailsMarkup(debt){
  if(!debt)return '';
  const progress=customerDebtProgressData(debt);
  return `<aside class="morning-debt-aside" aria-label="פרטי החוב">
    <div class="morning-section-title"><span>פרטי החוב</span></div>
    <div class="morning-debt-identity"><b>${esc(debt.customerName||'')}</b><b class="money">${money(debt.amount)}</b></div>
    ${progress.paymentPartial?`<small>יתרה לתשלום <b class="money">${money(progress.remainingPayment)}</b></small>`:''}
    ${noteMarkup(debt,'note')}
    ${debt.urgency?noteMarkup(debt,'urgency'):''}
  </aside>`;
}

export function createMorningDebtDetails({host,debt,canMutate,notes={},onChange,toast}){
  const input=key=>Object.hasOwn(noteLabels,key)?host()?.querySelector(`#morningDebtNote-${key}`):null;
  const editing=()=>host()?.querySelector('textarea:not([readonly])');
  const dirty=()=>host()?.querySelector('textarea:not([data-no-draft-guard])');

  function withoutNoteDraft(markSaved){
    const field=dirty();
    if(!field)return markSaved?.();
    field.setAttribute('data-no-draft-guard','');
    try{return markSaved?.()}finally{field.removeAttribute('data-no-draft-guard')}
  }

  function refresh(key){
    const container=host();
    if(!container)return;
    container.innerHTML=morningDebtDetailsMarkup(debt());
    if(!key)return;
    const section=input(key)?.closest('.morning-debt-note');
    (section||container).querySelector('[data-action="morning-debt-note-edit"]')?.focus({preventScroll:true});
  }

  function draft(key){
    const field=input(key);
    if(!field||field.readOnly)return;
    field.toggleAttribute('data-no-draft-guard',field.value===field.defaultValue);
    field.closest('.morning-debt-note').querySelector('[data-action="morning-debt-note-copy"]').disabled=!field.value;
  }

  function edit(key){
    const field=input(key);
    if(!field||!canMutate())return;
    if(editing()&&editing()!==field)return toast('יש לשמור או לבטל את עריכת ההערה הפתוחה');
    const section=field.closest('.morning-debt-note');
    section.querySelector('[data-debt-note-view]').hidden=true;
    section.querySelector('[data-debt-note-edit]').hidden=false;
    field.readOnly=false;
    field.focus();
  }

  async function copy(key){
    const field=input(key);
    if(!field?.value)return;
    try{
      await navigator.clipboard.writeText(field.value);
      if(input(key)===field)toast('ההערה הועתקה');
    }catch{
      if(input(key)!==field)return;
      field.select();
      toast('ההערה מסומנת להעתקה');
    }
  }

  function save(key,remove=false){
    const field=input(key),record=debt();
    if(!field||!record||!canMutate())return;
    if(remove?(key!=='urgency'||!record.urgency):field.readOnly)return;
    if(editing()&&editing()!==field)return toast('יש לשמור או לבטל את עריכת ההערה הפתוחה');
    if(readNote(record,key)!==field.defaultValue)return toast('ההערה בחוב השתנתה. אפשר להעתיק את הטקסט ולבטל את העריכה כדי לטעון אותה מחדש.');
    const changed=key==='urgency'
      ?notes.updateUrgency?.(record,remove?null:field.value.trim())
      :notes.updateNote?.(record,field.value.trim());
    refresh(key);
    if(changed)onChange();
  }

  function command(action,key){
    switch(action){
      case 'edit': return edit(key);
      case 'copy': return copy(key);
      case 'save': return save(key);
      case 'cancel': return refresh(key);
      case 'remove': return save(key,true);
      case 'draft': return draft(key);
    }
  }

  return {markup:()=>morningDebtDetailsMarkup(debt()),refresh,command,withoutNoteDraft,
    hasDraft:()=>!!dirty()};
}
