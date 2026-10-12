// @ts-check

/** @typedef {{kind:'mirror'|'snapshot'|'preserve',forceBackup:boolean}} FolderWriteCommand */
/** @typedef {{isCurrent:()=>boolean,begin:()=>boolean}} FolderWriteScope */

/**
 * Serializes the working file and its safety copies. Only adjacent, unstarted
 * mirrors may coalesce; explicit snapshots are ordered barriers.
 * @template Target, Payload
 * @param {{readTarget:()=>Target|null,clonePayload:(payload:Payload)=>Payload,
 * canStart:()=>boolean,write:(target:Target,payload:Payload,command:FolderWriteCommand,scope:FolderWriteScope)=>Promise<boolean>,
 * onError:(error:unknown)=>void}} ports
 */
export function createFolderWriteRuntime({readTarget,clonePayload,canStart,write,onError}){
  const ports={readTarget,clonePayload,canStart,write,onError};
  for(const name of /** @type {const} */ (['readTarget','clonePayload','canStart','write','onError'])){
    if(typeof ports?.[name]!=='function')throw new TypeError(`folder_write_${name}_required`);
  }
  /** @typedef {{target:Target,payload:Payload,command:FolderWriteCommand,epoch:number,complete:Array<(result:boolean)=>void>}} Job */
  /** @type {Job[]} */
  const queue=[];
  /** @type {Promise<void>|null} */
  let current=null;
  let active=true,epoch=0;
  /** @param {Job} job */
  function isCurrent(job){return active&&job.epoch===epoch&&ports.readTarget()===job.target&&ports.canStart()}
  async function process(){
    while(queue.length){
      const job=queue.shift();if(!job)continue;
      let result=false,started=false;
      try{
        if(isCurrent(job))result=await ports.write(job.target,job.payload,job.command,{
          isCurrent:()=>isCurrent(job),
          // Accepted file effects finish verification and safety copies on the
          // captured target, even after selection or ownership changes.
          begin:()=>started||(started=isCurrent(job)),
        });
      }catch(error){try{ports.onError(error)}catch{/* Diagnostic failure must not strand accepted receipts. */}}
      for(const complete of job.complete)complete(result);
    }
  }
  /** @param {Payload} payload @param {FolderWriteCommand} command @returns {Promise<boolean>} */
  function submit(payload,command){
    if(!active||!ports.canStart())return Promise.resolve(false);
    const target=ports.readTarget();if(target===null)return Promise.resolve(false);
    const captured=ports.clonePayload(payload);
    /** @type {Promise<boolean>} */
    const completion=new Promise(resolve=>{
      const last=queue.at(-1);
      if(command.kind==='mirror'&&last?.command.kind==='mirror'&&last.target===target&&last.epoch===epoch){
        last.payload=captured;last.command.forceBackup ||= command.forceBackup;last.complete.push(resolve);
      }else queue.push({target,payload:captured,command:{...command},epoch,complete:[resolve]});
    });
    start();
    return completion;
  }
  function start(){
    if(current)return;
    current=Promise.resolve().then(process).finally(()=>{
      current=null;
      // A receipt consumer may enqueue while process is completing.
      if(queue.length)start();
    });
  }
  function cancelPending(){
    epoch++;
    for(const job of queue.splice(0))for(const complete of job.complete)complete(false);
  }
  async function drain(){while(current)await current}
  function dispose(){if(!active)return false;active=false;cancelPending();return true}
  return {
    /** @param {Payload} payload @param {boolean} [forceBackup] */
    mirror:(payload,forceBackup=false)=>submit(payload,{kind:'mirror',forceBackup}),
    /** @param {Payload} payload @param {boolean} [forceBackup] */
    snapshot:(payload,forceBackup=false)=>submit(payload,{kind:'snapshot',forceBackup}),
    /** @param {Payload} payload */
    preserve:payload=>submit(payload,{kind:'preserve',forceBackup:false}),
    cancelPending,drain,dispose,isPending:()=>!!current,isActive:()=>active,
  };
}
