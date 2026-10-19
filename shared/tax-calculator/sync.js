import {assertDocument,clone,same} from './contracts.js';
import {createTaxStore} from './store.js';
import {createTaxRemote} from './remote.js';

/** Independent CAS owner: pending intent is committed before every HTTP write. */
export function createTaxSync({accountScope,request,writable=()=>true,store=createTaxStore({decodeState:assertDocument}),onChange=()=>{},uuid=()=>crypto.randomUUID()}) {
  let binding=null,generation=0,records=new Map(),conflicts=new Map(),status='unloaded',error='',busy=null;
  let serial=Promise.resolve();
  function bind() {
    const live=accountScope();
    if(!binding||live.owner!==binding.owner||live.epoch!==binding.epoch){binding={...live};generation++;records=new Map();conflicts=new Map();busy=null;status='unloaded';error='';}
    return {...binding,generation};
  }
  function capture(edit=false) {
    const observed=bind();
    return ()=>{const live=bind();if(!observed.owner||live.owner!==observed.owner||live.epoch!==observed.epoch||live.generation!==observed.generation)throw new Error('חשבון הענן השתנה; פתח מחדש את המחשבון');if(edit&&!writable())throw new Error('העריכה זמינה בלשונית הראשית בלבד');};
  }
  const remote=createTaxRemote({request,capture,decodeState:assertDocument,equalState:same});
  function publish(next,err=''){status=next;error=err;onChange();}
  function enqueue(task){const accepted=serial.then(task);serial=accepted.catch(()=>{});return accepted;}
  function fresh(owner,name,state,base=null){return {owner,name,version:0,base,draft:clone(state),flight:null};}
  function current(name){bind();return clone(records.get(name)?.draft??null);}
  async function open(name,fallback) {
    const guard=capture(),scope=bind();guard();
    const cached=await store.read(scope.owner,name);guard();
    if(cached){records.set(name,cached);publish(cached.flight||!same(cached.draft,cached.base?.state)?'pending':'local');return clone(cached.draft);}
    publish('loading');
    try{
      const cloud=await remote.read(scope.owner,name);guard();
      const record=await store.update(scope.owner,name,existing=>existing??fresh(scope.owner,name,cloud?.state??assertDocument(name,fallback),cloud));guard();
      records.set(name,record);publish(cloud?'synced':'local');return clone(record.draft);
    }catch(e){guard();publish('error',e.message);throw e;}
  }
  function save(name,state,{restoreRevision=null}={}) {
    const guard=capture(true),scope=bind(),detached=assertDocument(name,state),observed=records.get(name);guard();
    if(!observed)throw new Error('יש לטעון את המסמך לפני עריכה');
    const expectedVersion=observed.version;
    return enqueue(async()=>{
      guard();
      const record=await store.update(scope.owner,name,existing=>{
        guard();if(!existing||existing.version!==expectedVersion&&!same(existing.draft,observed.draft))throw new Error('המסמך השתנה בלשונית אחרת; רענן לפני עריכה');
        return {...existing,draft:clone(detached),version:existing.version+1,restoreRevision};
      });guard();records.set(name,record);conflicts.delete(name);publish('pending');return clone(record.draft);
    }).catch(e=>{guard();publish('error',e.message);throw e;});
  }
  async function synchronize(name) {
    const guard=capture(true),scope=bind();guard();
    let record=await store.read(scope.owner,name);guard();if(!record)return;
    // A prior uncertain response must be replayed with its original operation ID.
    if(!record.flight){
      const cloud=await remote.read(scope.owner,name);guard();
      if(!same(record.draft,record.base?.state)&&cloud?.revision!==(record.base?.revision??undefined)){
        if(cloud||record.base){conflicts.set(name,{remote:cloud,local:clone(record.draft)});records.set(name,record);publish('conflict');return;}
      }
      if(same(record.draft,record.base?.state)){
        const updated=await store.update(scope.owner,name,existing=>{
          guard();if(!existing||existing.version!==record.version||existing.flight)return existing;
          return cloud?{...existing,base:cloud,draft:clone(cloud.state),version:existing.version+1}:existing;
        });guard();records.set(name,updated);publish('synced');return;
      }
      const flight={id:uuid(),expectedRevision:record.base?.revision??0,state:clone(record.draft),restoreRevision:record.restoreRevision??null};
      record=await store.update(scope.owner,name,existing=>{guard();if(!existing||existing.version!==record.version||existing.flight)throw new Error('המסמך השתנה לפני סנכרון; נדרש רענון');return {...existing,flight};});guard();
    }
    records.set(name,record);publish('syncing');
    const flight=clone(record.flight);
    try{
      const ack=await remote.write(scope.owner,name,flight);guard();
      const accepted=await store.update(scope.owner,name,existing=>{
        guard();if(!existing||existing.flight?.id!==flight.id)throw new Error('הפעולה הממתינה השתנתה; האישור נשמר בענן');
        return {...existing,base:ack,flight:null,restoreRevision:null,version:existing.version+1};
      });guard();records.set(name,accepted);conflicts.delete(name);publish(same(accepted.draft,ack.state)?'synced':'pending');
    }catch(e){
      guard();
      if(e.status===409){const cloud=await remote.read(scope.owner,name);guard();conflicts.set(name,{remote:cloud,local:clone(record.draft)});publish('conflict');}
      else {publish('offline',e.message);throw e;}
    }
  }
  function flush() {
    bind();if(busy)return busy;
    const guard=capture(true);guard();
    // Network flights never hold the local commit queue. A newer draft may be
    // durably committed while an earlier HTTP response is still outstanding.
    const work=(async()=>{await serial;guard();for(const name of [...records.keys()]){
      for(let round=0;round<3;round++){
        guard();if(conflicts.has(name))break;await synchronize(name);guard();
        const record=records.get(name);if(!record?.flight&&same(record?.draft,record?.base?.state))break;
      }
    }guard();return true;})();
    const observed=work.catch(e=>{guard();publish('offline',e.message);throw e;});
    busy=observed;observed.finally(()=>{if(busy===observed)busy=null;}).catch(()=>{});return observed;
  }
  async function resolve(name,choice) {
    const guard=capture(true),scope=bind(),conflict=conflicts.get(name);guard();if(!conflict)throw new Error('אין התנגשות פתוחה');
    const remoteHead=await remote.read(scope.owner,name);guard();
    if(choice==='remote'&&!remoteHead)throw new Error('לא נמצאה גרסת ענן לשחזור; העותק המקומי נשמר');
    if(!same(remoteHead,conflict.remote))throw new Error('הענן השתנה שוב; רענן את ההשוואה');
    const expected=records.get(name)?.version;
    const record=await store.update(scope.owner,name,existing=>{guard();if(!existing||existing.version!==expected)throw new Error('העותק המקומי השתנה');return {...existing,base:remoteHead,draft:clone(choice==='remote'?remoteHead?.state??existing.draft:existing.draft),flight:null,version:existing.version+1};});
    guard();records.set(name,record);conflicts.delete(name);publish(choice==='remote'?'synced':'pending');return clone(record.draft);
  }
  return {open,save,flush,resolve,current,capture,remote,
    reset(){generation++;binding=null;records=new Map();conflicts=new Map();publish('unloaded');},
    get state(){bind();const pending=[...records.values()].some(r=>r.flight||!same(r.draft,r.base?.state));return {status:conflicts.size?'conflict':pending&&!['offline','error','syncing','loading'].includes(status)?'pending':status,error,owner:binding?.owner,conflicts:clone(conflicts)};},
    drain:async()=>{await serial;if(busy)await busy.catch(()=>{});},
    dispose:async()=>{await serial;if(busy)await busy.catch(()=>{});await store.close();}};
}
