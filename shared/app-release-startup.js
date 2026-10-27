// The app must not start its mutable module graph until a waiting, verified
// release has had a chance to become active. Never take over other live tabs.
const DEADLINE_MS=20000;

function settledWithin(promise){
  return new Promise(resolve=>{
    const timer=setTimeout(()=>resolve(null),DEADLINE_MS);
    Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value)},()=>{clearTimeout(timer);resolve(null)});
  });
}

async function awaitInstallation(worker){
  if(worker.state!=='installing')return;
  await new Promise(resolve=>{
    const finish=()=>{
      worker.removeEventListener('statechange',onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange=()=>{if(worker.state!=='installing')finish()};
    const timer=setTimeout(finish,DEADLINE_MS);
    worker.addEventListener('statechange',onChange);
    onChange();
  });
}

export async function mayStartApp({serviceWorker,location,makeChannel=()=>new MessageChannel()}){
  if(!serviceWorker)return true;
  const registration=await settledWithin(serviceWorker.register('./service-worker.js',{updateViaCache:'none'}));
  if(!registration||!serviceWorker.controller)return true;

  // register() alone does not guarantee a timely update check. An old active
  // worker refuses the new deployment's release tag and serves its old cache.
  await settledWithin(registration.update());
  if(registration.installing)await awaitInstallation(registration.installing);
  const waiting=registration.waiting;
  if(!waiting||waiting.state!=='installed')return true;

  const previous=serviceWorker.controller;
  let changed;
  const controllerChange=new Promise(resolve=>{
    changed=()=>resolve(serviceWorker.controller!==previous);
    serviceWorker.addEventListener('controllerchange',changed);
  });
  try{
    const permission=await settledWithin(new Promise(resolve=>{
      const channel=makeChannel();
      channel.port1.onmessage=event=>{
        channel.port1.close();
        resolve(event.data?.allowed===true);
      };
      waiting.postMessage({type:'netunim-activate-single-client'},[channel.port2]);
    }));
    if(permission!==true)return true; // Another tab may still be executing the old release.
    const activated=await settledWithin(controllerChange);
    if(activated!==true)return true;
    // A fresh document is mandatory: the HTML and the ESM graph must be from
    // the same release, even when a deployment changed the HTML structure.
    location.reload();
    return false;
  }finally{
    serviceWorker.removeEventListener('controllerchange',changed);
  }
}
