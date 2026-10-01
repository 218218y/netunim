const POLL_MS=1800;

export function createDocumentIndexRefresh({bridge,button,status,onCompleted=()=>{}}){
  let open=false,busy=false,timer=null,current=null,startedHere=false,wasRunning=false;
  const available=()=>!!bridge?.supportsPdfIndexRefresh;
  const paired=()=>!!bridge?.localToken;
  function schedule(){clearTimeout(timer);timer=null;if(open&&current?.running)timer=setTimeout(()=>{void load()},POLL_MS)}
  function render(message=''){
    if(!button||!status)return;
    button.hidden=!available();status.hidden=!available()||!message;
    if(!available())return;
    const running=!!current?.running,stopping=!!current?.stopRequested;
    button.disabled=busy||!paired()||(running&&!current?.cancelable);
    button.classList.toggle('running',running);
    button.classList.toggle('stopping',stopping);
    button.setAttribute('aria-label',running&&current?.cancelable?'עצור רענון אינדקס PDF':'רענן אינדקס PDF עכשיו');
    button.title=!paired()?'חבר תחילה את Document Bridge במחשב זה':running?(current?.cancelable?'עצור את רענון ה-PDF שהופעל ידנית':'רענון PDF מתוזמן פועל כעת'):'בדוק כעת קובצי PDF חדשים או שהשתנו. Everything מעדכן את שאר אינדקס הקבצים אוטומטית.';
    const label=button.querySelector('span');if(label)label.textContent=running?(current?.cancelable?'עצור PDF':stopping?'עוצר PDF…':'מעדכן PDF…'):'רענן PDF';
    status.textContent=message;
  }
  function messageFor(data){
    if(data?.running){
      if(data.stopRequested)return 'מסיים את הקובץ הנוכחי ועוצר…';
      const progress=data.progress;
      if(Number.isFinite(Number(progress?.selected))&&Number(progress.selected)>0)return `PDF: ${Number(progress.processed)||0} מתוך ${Number(progress.selected)}`;
      return data.source==='scheduled'?'רענון מתוזמן פועל…':'בודק קובצי PDF שהשתנו…';
    }
    if(data?.lastError)return data.lastError;
    if(data?.lastRun?.aborted||data?.lastResult?.aborted&&startedHere)return 'רענון ה-PDF נעצר';
    if(!startedHere)return '';
    const result=data.lastRun||data.lastResult;
    if(!result)return 'הרענון הסתיים';
    const processed=Number(result.processed)||0,pending=Number(result.pending)||0;
    return `${processed?`נבדקו ${processed} קובצי PDF`:'לא נמצאו קובצי PDF חדשים'}${pending?` · ${pending} ממתינים להמשך`:''}`;
  }
  function accept(data){
    const finished=wasRunning&&!data?.running,manualFinished=finished&&current?.source==='manual';
    if(data?.running&&data.source==='scheduled')startedHere=false;
    current=data;wasRunning=!!data?.running;
    render(messageFor(data));schedule();
    if(manualFinished&&open&&startedHere&&!data?.lastError&&!data?.lastRun?.aborted)onCompleted();
  }
  async function load(){
    if(!open||!available()||!paired())return;
    try{accept(await bridge.pdfIndexStatus())}catch(error){current=null;render(error?.message||'לא ניתן לבדוק את מצב רענון ה-PDF');clearTimeout(timer);timer=null}
  }
  async function activate(){
    if(busy||!available()||!paired()||current?.running&&!current.cancelable)return;
    busy=true;render(messageFor(current));
    try{
      const stopping=!!current?.running;
      const data=stopping?await bridge.stopPdfIndex():await bridge.startPdfIndex();
      if(!stopping&&data?.source==='manual')startedHere=true;
      accept(data);
    }catch(error){render(error?.message||'רענון ה-PDF נכשל')}
    finally{busy=false;render(status?.textContent||'')}
  }
  function show(){open=true;render(messageFor(current));void load()}
  function hide(){open=false;clearTimeout(timer);timer=null}
  function bind(){button?.addEventListener('click',()=>{void activate()});render()}
  return {bind,show,hide,load};
}
