// @ts-check
import {createRuntimeTaskOwner} from './runtime-task-owner.js';
/** @typedef {import('./backup-file-authority.js').BackupFileIntent} BackupFileIntent */
/** @typedef {import('./backup-file-authority.js').BackupFileAuthority} BackupFileAuthority */
/** @typedef {{name:string,size:number,text:()=>Promise<string>}} BackupFile */
/** @typedef {{assertCurrent:()=>true,signal:AbortSignal}} BackupFileScope */
/** @template T @typedef {(raw:string,file:BackupFile,scope:BackupFileScope)=>T|PromiseLike<T>} BackupReader */
/** @typedef {{document:()=>Document,urls:{create:(blob:Blob)=>string,revoke:(url:string)=>void},timers:{setTimeout:(run:()=>void,delay:number)=>number,clearTimeout:(id:number)=>void}}} BackupBrowserPlatform */
/**
 * @typedef {object} BackupBrowserResources
 * @property {(intent?:BackupFileIntent)=>BackupFileScope} capture
 * @property {<T>(accept:BackupReader<T>,maxBytes?:number)=>Promise<T|null>} choose
 * @property {<T>(file:BackupFile,accept:BackupReader<T>,maxBytes?:number)=>Promise<T|null>} read
 * @property {<T>(scope:BackupFileScope,command:()=>T|PromiseLike<T>)=>Promise<T|null>} run
 * @property {(blob:Blob,name:string,scope?:BackupFileScope)=>boolean} download
 * @property {{invalidate:()=>boolean,dispose:()=>boolean,isPending:()=>boolean,drain:()=>Promise<void>}} runtime
 */
/**
 * Native selection/read and download resources have one explicit lifetime.
 * Disposal cancels unaccepted input, fences late read publication, and leaves
 * accepted work in the drain until file reading/consumer cleanup really ends.
 * @param {{authority:{capture:(intent:BackupFileIntent)=>BackupFileAuthority},platform?:BackupBrowserPlatform}} ports
 * @returns {BackupBrowserResources}
 */
export function createBackupBrowserResources({authority,platform={
  document:()=>globalThis.document,
  urls:{create:blob=>URL.createObjectURL(blob),revoke:url=>URL.revokeObjectURL(url)},
  timers:globalThis,
}}){
  const work=createRuntimeTaskOwner();
  let epoch=0,controller=new AbortController();
  /** @type {{cancel:()=>void}|null} */ let pending=null;
  /** @type {Map<string,{anchor:HTMLAnchorElement,timer:number|null}>} */ const downloads=new Map();
  function changed(){return Object.assign(new Error('פעולת קובץ הגיבוי בוטלה. יש לפתוח אותה מחדש.'),{code:'backup_file_scope_changed'})}
  /** @param {BackupFileIntent} [intent] @returns {BackupFileScope} */
  function capture(intent='restore'){
    if(!work.isActive())throw changed();
    const acceptedEpoch=epoch,proof=authority.capture(intent),signal=controller.signal;
    /** @returns {true} */ const assertCurrent=()=>{
      if(!work.isActive()||acceptedEpoch!==epoch||signal.aborted)throw changed();
      if(proof.assertCurrent()!==true)throw new TypeError('backup_file_authority_must_be_synchronous');
      return true;
    };
    assertCurrent();return {assertCurrent,signal};
  }
  /** @template T @param {BackupFile} file @param {BackupReader<T>} accept @param {number} maxBytes @param {BackupFileScope} scope @returns {Promise<T|null>} */
  async function readAccepted(file,accept,maxBytes,scope){
    scope.assertCurrent();
    if(!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isFinite(file.size)||file.size<0)throw new TypeError('backup_file_size_invalid');
    if(file.size>maxBytes)throw new Error('קובץ הגיבוי גדול מדי');
    let raw;
    try{raw=await file.text()}catch(error){
      if(!work.isActive()||scope.signal.aborted)return null;
      scope.assertCurrent();throw error;
    }
    if(!work.isActive()||scope.signal.aborted)return null;
    scope.assertCurrent();
    if(typeof raw!=='string')throw new TypeError('backup_file_text_required');
    try{
      const value=await accept(raw,file,scope);
      if(!work.isActive()||scope.signal.aborted)return null;
      // The accepted restore may legitimately advance its own local generation.
      // It owns commit/publication fences; retain only the resource lifetime here.
      return value;
    }catch(error){
      if(!work.isActive()||scope.signal.aborted)return null;
      scope.assertCurrent();throw error;
    }
  }
  /** @template T @param {BackupFile} file @param {BackupReader<T>} accept @param {number} [maxBytes] @returns {Promise<T|null>} */
  function read(file,accept,maxBytes=Number.MAX_SAFE_INTEGER){
    if(!work.isActive())return Promise.resolve(null);
    const scope=capture();return work.run(()=>readAccepted(file,accept,maxBytes,scope));
  }
  /** @template T @param {BackupFileScope} scope @param {()=>T|PromiseLike<T>} command @returns {Promise<T|null>} */
  function run(scope,command){
    if(!work.isActive())return Promise.resolve(null);
    scope.assertCurrent();
    return work.run(async()=>{
      try{
        const result=await command();
        if(!work.isActive()||scope.signal.aborted)return null;
        return result;
      }catch(error){
        if(!work.isActive()||scope.signal.aborted)return null;
        scope.assertCurrent();throw error;
      }
    });
  }
  /** @template T @param {BackupReader<T>} accept @param {number} [maxBytes] @returns {Promise<T|null>} */
  function choose(accept,maxBytes=Number.MAX_SAFE_INTEGER){
    if(!work.isActive()||pending)return Promise.resolve(null);
    const scope=capture();
    return work.run(()=>new Promise((resolve,reject)=>{
      const input=platform.document().createElement('input');input.type='file';input.accept='.json,application/json';input.hidden=true;
      let settled=false,reading=false;
      /** @param {T|null} value @param {unknown} [error] */
      function finish(value,error){
        if(settled)return;settled=true;
        input.removeEventListener('change',change);input.removeEventListener('cancel',cancel);input.remove();
        if(pending===ticket)pending=null;
        if(error!==undefined)reject(error);else resolve(value);
      }
      const cancel=()=>finish(null),ticket={cancel};
      function change(){
        if(settled||reading||!work.isActive())return;reading=true;
        const file=input.files?.[0];if(!file){finish(null);return}
        const accepted=work.run(async()=>{
          try{
            // Picker settlement releases its DOM resource. The accepted preview
            // retains the account/lifetime proof for a later restore command.
            const value=await readAccepted(file,(raw,selected)=>{if(settled)throw changed();return accept(raw,selected,scope)},maxBytes,scope);
            if(!settled)finish(value);
          }catch(error){if(!settled)finish(null,error)}
        });
        void accepted.catch(error=>{if(!settled)finish(null,error)});
      }
      pending=ticket;input.addEventListener('change',change);input.addEventListener('cancel',cancel);
      try{platform.document().body.appendChild(input);input.click()}catch(error){finish(null,error)}
    }));
  }
  /** @param {string} href */
  function release(href){
    const resource=downloads.get(href);if(!resource)return;
    downloads.delete(href);
    if(resource.timer!==null)platform.timers.clearTimeout(resource.timer);
    try{platform.urls.revoke(href)}finally{resource.anchor.remove()}
  }
  /** @param {Blob} blob @param {string} name @param {BackupFileScope} [scope] */
  function download(blob,name,scope=capture('download')){
    scope.assertCurrent();
    const anchor=platform.document().createElement('a'),href=platform.urls.create(blob),resource={anchor,timer:/** @type {number|null} */(null)};
    downloads.set(href,resource);anchor.href=href;anchor.download=name;
    try{
      platform.document().body.appendChild(anchor);anchor.click();
      if(downloads.has(href))resource.timer=platform.timers.setTimeout(()=>release(href),1000);
      return true;
    }catch(error){release(href);throw error}
  }
  function invalidate(){
    if(!work.isActive())return false;
    epoch++;controller.abort();controller=new AbortController();pending?.cancel();
    for(const href of [...downloads.keys()])release(href);
    return true;
  }
  function dispose(){if(!work.isActive())return false;invalidate();work.close();return true}
  return {capture,choose,read,run,download,runtime:{invalidate,dispose,isPending:()=>!!pending||work.isPending(),drain:work.drain}};
}
