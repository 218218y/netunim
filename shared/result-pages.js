// UI-only pagination. Totals and persistence continue to consume all records.
export function createResultPages({ui,action,size=150}){
  ui.resultPages??={};
  function page(rows,name,key,{id=row=>row.id,target='',limit=size}={}){
    let state=ui.resultPages[name];
    if(!state||state.key!==key)state=ui.resultPages[name]={key,index:0,total:0};
    state.total=Math.max(1,Math.ceil(rows.length/limit));
    if(target){const index=rows.findIndex(row=>String(id(row))===String(target));if(index>=0)state.index=Math.floor(index/limit)}
    state.index=Math.max(0,Math.min(state.index,state.total-1));
    const offset=state.index*limit;
    const button=(delta,label,disabled)=>`<button class="btn small" type="button" data-action="${action}" data-click-arg0="${name}" data-click-arg1="${delta}" ${disabled?'disabled':''}>${label}</button>`;
    const controls=state.total>1?`<nav class="result-pages" aria-label="עמודי תוצאות">${button(-1,'הקודם',!state.index)}<span>עמוד ${state.index+1} מתוך ${state.total} · ${rows.length} רשומות</span>${button(1,'הבא',state.index>=state.total-1)}</nav>`:'';
    return {rows:rows.slice(offset,offset+limit),controls};
  }
  function move(name,delta){const state=ui.resultPages[name];if(!state||![-1,1].includes(Number(delta)))return false;const next=Math.max(0,Math.min(state.total-1,state.index+Number(delta)));if(next===state.index)return false;state.index=next;return true}
  function focus(name,delta){
    // Keep keyboard navigation on the pager after replacing its result region.
    const buttons=[...(globalThis.document?.querySelectorAll?.('[data-action="'+action+'"]')||[])].filter(button=>button.dataset.clickArg0===name);
    const button=buttons.find(button=>button.dataset.clickArg1===String(delta)&&!button.disabled)||buttons.find(button=>!button.disabled);
    button?.focus({preventScroll:true});
  }
  return {page,move,focus};
}
