// Combine capability-owned action maps without silently replacing a handler.
export function markMutationActions(actions,domains){
  const seen=new Set();
  for(const [domain,names] of Object.entries(domains)){
    if(!domain||!Array.isArray(names))throw new TypeError(`Invalid mutation domain: ${domain}`);
    for(const name of names){
      const handler=actions[name];
      if(!Object.hasOwn(actions,name)||typeof handler!=='function'||seen.has(name)||handler.startupMutationDomain&&handler.startupMutationDomain!==domain)throw new Error(`Invalid mutation action: ${name}`);
      seen.add(name);
      Object.defineProperty(handler,'startupMutationDomain',{value:domain});
    }
  }
  return actions;
}

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
