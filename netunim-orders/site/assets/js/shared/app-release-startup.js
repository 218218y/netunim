// The app must not start its mutable module graph until a waiting, verified
// release has had a chance to become active. Never take over other live tabs.
const DEADLINE_MS=20000;

function createDeadline(timers){
  const end=timers.now()+DEADLINE_MS;
  const remaining=()=>Math.max(0,end-timers.now());
  function wait(promise){
    return new Promise(resolve=>{
      const timer=timers.setTimeout(()=>resolve(null),remaining());
      Promise.resolve(promise).then(value=>{timers.clearTimeout(timer);resolve(value)},()=>{timers.clearTimeout(timer);resolve(null)});
    });
  }
  return {wait,remaining};
}

async function awaitInstallation(worker,wait){
  if(worker.state!=='installing')return;
  let onChange;
  try{
    await wait(new Promise(resolve=>{
      onChange=()=>{if(worker.state!=='installing')resolve()};
      worker.addEventListener('statechange',onChange);
      onChange();
    }));
  }finally{worker.removeEventListener('statechange',onChange)}
}

export async function mayStartApp({serviceWorker,location,makeChannel=()=>new MessageChannel(),onBlocked=()=>{},
  timers={now:()=>performance.now(),setTimeout:(fn,delay)=>setTimeout(fn,delay),clearTimeout:id=>clearTimeout(id)}}){
  if(!serviceWorker)return true;
  const {wait,remaining}=createDeadline(timers);
  const previous=serviceWorker.controller;
  let changed,channel;
  const controllerChange=new Promise(resolve=>{
    changed=()=>resolve(serviceWorker.controller!==previous);
    serviceWorker.addEventListener('controllerchange',changed);
  });
  const reload=()=>{location.reload();return false};
  const blocked=()=>{try{onBlocked()}catch{/* The startup gate must remain closed. */}return false};
  const awaitController=async()=>{
    if(serviceWorker.controller!==previous)return reload();
    await wait(controllerChange);
    return serviceWorker.controller!==previous?reload():blocked();
  };
  try{
    const registration=await wait((async()=>serviceWorker.register('./service-worker.js',{updateViaCache:'none'}))());
    if(previous&&serviceWorker.controller!==previous)return reload();
    if(!registration||!previous)return true;
    if(registration.active&&registration.active!==previous)return await awaitController();
    // Keep the explicit freshness check, but every phase shares one deadline.
    await wait((async()=>registration.update())());
    if(serviceWorker.controller!==previous)return reload();
    if(registration.active&&registration.active!==previous)return await awaitController();
    if(registration.installing)await awaitInstallation(registration.installing,wait);
    if(serviceWorker.controller!==previous)return reload();
    if(registration.active&&registration.active!==previous)return await awaitController();
    const waiting=registration.waiting;
    if(!waiting||waiting.state!=='installed'||!remaining())return true;
    const permission=await wait(new Promise(resolve=>{
      channel=makeChannel();
      channel.port1.onmessage=event=>{
        resolve(event.data?.allowed===true?true:event.data?.allowed===false?false:null);
      };
      waiting.postMessage({type:'netunim-activate-single-client'},[channel.port2]);
    }));
    if(serviceWorker.controller!==previous)return reload();
    if(permission===false)return true; // Another live tab explicitly denied takeover.
    // Once sent, a takeover may finish late. Ambiguity cannot authorize imports.
    if(permission!==true)return blocked();
    return await awaitController();
  }finally{
    channel?.port1.close();
    channel?.port2.close();
    serviceWorker.removeEventListener('controllerchange',changed);
  }
}

export function showAppReleaseBlocked({document,location}){
  const panel=document.createElement('main'),heading=document.createElement('h1');
  const detail=document.createElement('p'),retry=document.createElement('button');
  panel.setAttribute('role','alert');
  heading.textContent='עדכון המערכת טרם הושלם';
  detail.textContent='יש לרענן את הדף כדי להשלים את פתיחת המערכת. הנתונים המקומיים נשמרו.';
  retry.type='button';retry.textContent='רענון הדף';
  retry.addEventListener('click',()=>location.reload());
  panel.append(heading,detail,retry);document.body.replaceChildren(panel);retry.focus();
}
