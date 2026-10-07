// Combine capability-owned action maps without silently replacing a handler.
export function composeActionRegistry(packs){
  const actions=Object.create(null),owners=new Map(),packNames=new Set();
  for(const pack of packs){
    const {name,actions:entries}=pack||{};
    if(typeof name!=='string'||!name.trim()||packNames.has(name))throw new Error(`Invalid or duplicate action pack: ${name}`);
    if(!entries||typeof entries!=='object'||Array.isArray(entries))throw new TypeError(`Invalid actions for pack: ${name}`);
    packNames.add(name);
    for(const [action,handler] of Object.entries(entries)){
      if(!action.trim()||typeof handler!=='function')throw new TypeError(`Invalid UI action in ${name}: ${action}`);
      if(owners.has(action))throw new Error(`Duplicate UI action ${action}: ${owners.get(action)} and ${name}`);
      if(handler.startupMutationDomain!==undefined&&(typeof handler.startupMutationDomain!=='string'||!handler.startupMutationDomain))throw new TypeError(`Invalid mutation domain for ${action}`);
      actions[action]=handler;
      owners.set(action,name);
    }
  }
  return Object.freeze(actions);
}
