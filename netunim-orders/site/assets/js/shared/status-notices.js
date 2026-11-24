// One notification policy for both sites. Acknowledgement only closes the notice.
export function createStatusNotices({getToast,duration,document=globalThis.document,timers=globalThis}){
  const important=new Map();
  let timer,region;
  function clearNotice(id){
    const record=important.get(id);if(!record)return;
    record.element.remove();important.delete(id);
    if(!region.childElementCount){region.remove();region=null}
  }
  function toast(message,notice){
    if(!notice?.id){
      const element=getToast();if(!element)return;
      element.textContent=message;element.classList.add('show');
      timers.clearTimeout(timer);timer=timers.setTimeout(()=>element.classList.remove('show'),duration);return;
    }
    const id=notice.id,prior=important.get(id);
    if(prior?.message===message&&prior.severity===notice.severity)return;
    clearNotice(id);
    if(!region){region=document.createElement('aside');region.className='status-notices';region.setAttribute('aria-label','הודעות חשובות');document.body.append(region)}
    const element=document.createElement('section'),text=document.createElement('p');
    element.dataset.severity=notice.severity||'important';element.setAttribute('role',notice.severity==='critical'?'alert':'status');
    text.textContent=message;element.append(text);
    if(notice.actionLabel&&typeof notice.action==='function'){
      const button=document.createElement('button');button.type='button';button.textContent=notice.actionLabel;
      button.addEventListener('click',()=>{void Promise.resolve().then(notice.action).catch(()=>toast('לא ניתן לפתוח את הפעולה כרגע.'))});element.append(button);
    }
    const ack=document.createElement('button');ack.type='button';ack.textContent='קראתי';
    ack.addEventListener('click',()=>{element.hidden=true});element.append(ack);
    important.set(id,{message,severity:notice.severity,element});region.append(element);
  }
  const clearNotices=()=>{for(const id of important.keys())clearNotice(id)};
  return {toast,clearNotice,clearNotices};
}
