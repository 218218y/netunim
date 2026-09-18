// Keeps a small LRU of detached, already-rendered views. A view is reusable only
// while both its data revision and its UI-state key still match the render that
// produced it. Detached DOM preserves event handlers without retaining duplicate
// live IDs in the document.
export function createCleanViewCache({container,dataRevision=()=>'',viewStateKey=()=>'',cacheable=()=>true,maxEntries=3}={}){
  const entries=new Map();
  let activeKey=null,activeRevision='',activeStateKey='';
  const host=()=>typeof container==='function'?container():container;
  const stamp=value=>String(value??'');
  const currentRevision=key=>stamp(dataRevision(key));
  const currentStateKey=key=>stamp(viewStateKey(key));

  function trim(){
    const limit=Math.max(0,Number(maxEntries)||0);
    while(entries.size>limit)entries.delete(entries.keys().next().value);
  }

  function markRendered(key){
    if(key===undefined||key===null)return;
    activeKey=String(key);activeRevision=currentRevision(activeKey);activeStateKey=currentStateKey(activeKey);entries.delete(activeKey);
  }

  function detachActive(){
    const target=host();if(!target||activeKey===null)return;
    const key=activeKey,canCache=!!cacheable(key),revision=activeRevision,stateKey=activeStateKey;
    activeKey=null;activeRevision='';activeStateKey='';
    entries.delete(key);
    // A domain may have rerendered itself directly without going through the
    // navigation wrapper. In that case the old stamp no longer proves that the
    // attached DOM matches the current state, so discard it instead of caching it.
    if(!canCache||revision!==currentRevision(key)||stateKey!==currentStateKey(key)){target.replaceChildren();return}
    const fragment=(target.ownerDocument||globalThis.document)?.createDocumentFragment?.();
    if(!fragment){target.replaceChildren();return}
    while(target.firstChild)fragment.appendChild(target.firstChild);
    entries.set(key,{fragment,revision,stateKey});trim();
  }

  function activate(key){
    key=String(key);
    if(activeKey===key)return false;
    detachActive();
    const target=host();if(!target)return false;
    const cached=entries.get(key);
    if(!cached||!cacheable(key)||cached.revision!==currentRevision(key)||cached.stateKey!==currentStateKey(key)){
      if(cached)entries.delete(key);
      target.replaceChildren();
      return false;
    }
    target.replaceChildren(cached.fragment);entries.delete(key);
    activeKey=key;activeRevision=cached.revision;activeStateKey=cached.stateKey;
    return true;
  }

  function invalidate(key){if(key===undefined||key===null)entries.clear();else entries.delete(String(key))}
  function clear(){entries.clear();activeKey=null;activeRevision='';activeStateKey='';const target=host();target?.replaceChildren?.()}
  function cachedKeys(){return [...entries.keys()]}

  return {activate,markRendered,invalidate,clear,cachedKeys};
}
