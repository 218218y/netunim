import {createMorningVatSummary} from '../finance/morning-vat-summary.js';
import {expenseMoney} from '../finance/morning-expense-table.js';
import {expenseBimonth,expenseVatSummaryPeriod} from '../../core/morning-report-period.js';
import {esc} from '../../core/values.js';

export function createMorningHeaderVat({request,capture,run,isActive,todayISO}){
  let element=null,generation=0,environment='';
  const current=()=>element?.isConnected&&isActive(generation);
  const summary=createMorningVatSummary({request,run,render,capabilities:()=>({environment}),capture:()=>{
    const scope=capture(),owner=generation,target=element;
    return ()=>{scope();if(owner!==generation||target!==element||!current())throw new DOMException('Cancelled','AbortError');};
  }});
  function clear(){
    summary.reset();if(element){element.textContent='';element.hidden=true;element.removeAttribute('title');element.removeAttribute('aria-label');delete element.dataset.status;}
    environment='';
  }
  function reset(){clear();element=null;}
  function mount(heading,owner){
    reset();generation=owner;
    heading.insertAdjacentHTML('afterend','<span class="morning-modal-vat" data-morning-vat-summary role="status" aria-live="polite" hidden></span>');
    element=heading.nextElementSibling;
  }
  function render(){
    if(!current())return;
    const {periodKey,status,cents}=summary.snapshot();
    const label=status==='ready'&&cents<0?'מע״מ להחזר':'מע״מ לתשלום';
    const period=periodKey?expenseBimonth(periodKey+'-01').label:'';
    element.hidden=false;element.dataset.status=status;
    element.innerHTML=`<span>${label}: <bdi>${status==='ready'?esc(expenseMoney(Math.abs(cents))):'—'}</bdi></span>${period?` <small data-morning-vat-period>${esc(period)}</small>`:''}`;
    const message=status==='ready'?'':status==='loading'?'טוען סיכום מע״מ':'סיכום המע״מ אינו זמין';
    element.title=message?message+' · '+period:period;
    element.setAttribute('aria-label',element.textContent+(message?' · '+message:''));
  }
  function refresh(owner=generation){
    if(owner!==generation||!current()||!environment)return false;
    return summary.load(expenseVatSummaryPeriod(todayISO()));
  }
  function update(data,owner){
    if(owner!==generation||!current())return false;
    if(!data?.configured||data.available===false||!['production','sandbox'].includes(data.environment)){clear();return false;}
    environment=data.environment;return refresh(owner);
  }
  return {mount,update,refresh,reset,clear};
}
