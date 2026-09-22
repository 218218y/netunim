export function createFinanceStatusView({ui,currentSection,snapshot,headerContextMarkup,bankSyncPanelMarkup,creditSyncPanelMarkup,controller,renderKupa,renderedData}){
  function replacePanel(panel,markup,findNext=()=>document.getElementById(panel.id)){
    const key=element=>element.id||[element.tagName,element.name,element.dataset.input,element.dataset.change,element.dataset.changeArg0,element.dataset.changeArg1].join(':');
    const controls=new Map([...panel.querySelectorAll('input,select,textarea')].map(element=>[key(element),element]));
    const focused=document.activeElement,selection=focused?.selectionStart,selectionEnd=focused?.selectionEnd;
    panel.outerHTML=markup;
    for(const element of findNext()?.querySelectorAll('input,select,textarea')||[]){
      const previous=controls.get(key(element));if(!previous)continue;
      previous.disabled=element.disabled;element.replaceWith(previous);
    }
    if(focused?.isConnected&&controls.has(key(focused))){focused.focus({preventScroll:true});if(selection!==null&&selection!==undefined)focused.setSelectionRange?.(selection,selectionEnd)}
  }
  function refreshFinanceStatus(section){
    if(ui.currentView!=='kupa'||currentSection()!==section)return;
    const data=snapshot(),command=document.querySelector('[data-finance-command]');
    if(command)replacePanel(command,headerContextMarkup(data),()=>document.querySelector('[data-finance-command]'));
    const panel=document.getElementById(section==='bank'?'ordersBankSyncPanel':'ordersCreditSyncPanel');
    if(panel)replacePanel(panel,section==='bank'?bankSyncPanelMarkup(data,{open:ui.bankSyncOpen===true}):creditSyncPanelMarkup(data));
    document.getElementById('ordersBankCredentialsForm')?.addEventListener('submit',event=>event.preventDefault());
  }
  async function refreshFinanceOperation(section,start){
    const task=start();refreshFinanceStatus(section);
    try{return await task}finally{
      if(ui.currentView==='kupa'&&currentSection()===section){
        const data=snapshot(),lastRenderedData=renderedData();
        if(!controller.readSnapshot||!lastRenderedData||data.kupa!==lastRenderedData.kupa||data.bank!==lastRenderedData.bank)renderKupa();
        else refreshFinanceStatus(section);
      }
    }
  }
  return {refreshFinanceStatus,refreshFinanceOperation};
}
