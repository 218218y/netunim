// @ts-check

/**
 * @template T
 * @param {{key:string,initial:T|null,decode:(value:unknown)=>T|null,
 * storage:()=>Pick<Storage,'getItem'|'setItem'>,
 * mirror:{read:()=>Promise<unknown>,write:(value:T)=>Promise<unknown>,remove:()=>Promise<unknown>},
 * report?:(error:unknown)=>void}} ports
 */
export function createAuthSessionPersistence({key,initial,decode,storage,mirror,report=error=>console.error('auth session mirror',error)}){
  let cached=initial;
  let loaded=initial!==null;
  let generation=0;
  /** @type {Promise<void>|null} */
  let pending=null;

  /** @param {string|null} raw */
  function parse(raw){
    try{return decode(JSON.parse(raw||'null'))}catch{return null}
  }

  function reread(){
    generation++;
    loaded=true;
    try{cached=parse(storage().getItem(key))}catch{cached=null}
    return cached;
  }

  function load(){return loaded?cached:reread()}

  /** @param {T|null} value */
  function enqueueMirror(value){
    const write=()=>value===null?mirror.remove():mirror.write(value);
    // One owner orders every write/delete, even after a previous cleanup fails.
    // The synchronous local record remains authoritative while this drains.
    const work=pending?pending.then(write):Promise.resolve().then(write);
    pending=work.then(()=>{},error=>{report(error)});
  }

  /** @param {T|null} value */
  function store(value){
    // Capture before awaiting or publishing: callers cannot mutate a queued token.
    const raw=JSON.stringify(value);
    const captured=parse(raw);
    if(value!==null&&captured===null)throw new Error('cloud_session_invalid');
    generation++;
    loaded=true;
    cached=null;
    try{
      // JSON null is a durable logout tombstone, not a missing migration record.
      // A failed or late IDB delete can never override it on the next startup.
      storage().setItem(key,raw);
    }catch(cause){
      // Revoke this instance, but never report durable logout/login as successful.
      throw Object.assign(new Error('לא ניתן לשמור את מצב ההתחברות במחשב. יש לאפשר אחסון ולנסות שוב.'),{code:'cloud_session_persistence_failed',cause});
    }
    cached=captured;
    enqueueMirror(captured);
  }

  async function restore(){
    // Only installations with no local record may migrate the historical mirror.
    // Unreadable/malformed storage fails closed instead of reviving credentials.
    const current=load();
    if(current)return current;
    let raw;
    try{raw=storage().getItem(key)}catch{return null}
    if(raw!==null)return null;
    const observed=generation;
    let value;
    try{value=decode(await mirror.read())}catch(error){report(error);return null}
    if(generation!==observed)return load();
    try{raw=storage().getItem(key)}catch{return null}
    if(raw!==null)return reread();
    if(value!==null)store(value);
    return load();
  }

  return {load,reread,restore,store,drain:()=>pending||Promise.resolve()};
}
