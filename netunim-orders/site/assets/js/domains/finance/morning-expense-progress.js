import {esc} from '../../core/values.js';
const stages=[['checks','בדיקת פרטים וכפילויות'],['create','שמירת ההוצאה ואימותה'],['upload','צירוף מסמך המקור'],['verify','אימות הקישור והקובץ']];
export function createExpenseProgress({host,isActive}){
  let stage='',text='',timer=null,started=0;
  function reset(){clearInterval(timer);timer=null;stage='';text='';started=0;}
  function markup(){
    if(!stage)return '<div data-expense-progress hidden></div>';
    const index=stages.findIndex(([key])=>key===stage);
    return `<section class="morning-expense-progress" data-expense-progress aria-label="התקדמות קליטת הוצאה" aria-busy="true">
      <div class="morning-expense-progress-line"><span class="morning-expense-spinner" aria-hidden="true"></span><strong role="status" aria-live="polite">${esc(text)}</strong>
      <small data-expense-elapsed>חלפו ${Math.floor((Date.now()-started)/1000)} שניות</small></div>
      <ol>${stages.map(([key,label],n)=>`<li ${n===index?'aria-current="step"':''} class="${n<index?'done':n===index?'current':''}">${n<index?'✓':n+1} · ${label}</li>`).join('')}</ol>
      <small>אין צורך ללחוץ שוב. אפשר להמשיך לעיין במסמך בזמן הבדיקה.</small></section>`;
  }
  function show(key,value,{reveal=true}={}){
    if(!isActive())return;const first=!stage;stage=key;text=value;
    if(!started)started=Date.now();
    const target=host()?.querySelector('[data-expense-progress]');if(target)target.outerHTML=markup();
    if(reveal&&first)host()?.querySelector('[data-expense-progress]')?.scrollIntoView({block:'start',behavior:'instant'});
    if(!timer)timer=setInterval(()=>{for(const el of host()?.querySelectorAll('[data-expense-elapsed]')||[])el.textContent=`חלפו ${Math.floor((Date.now()-started)/1000)} שניות`;},1000);
  }
  return {show,markup,reset};
}
