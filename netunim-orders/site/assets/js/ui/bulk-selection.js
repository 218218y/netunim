// Shared Windows-style range selection for bulk checkboxes.
// A normal click establishes the anchor. Shift-click applies the new checked
// state to every visible row between the anchor and the clicked row.
export function applyBulkRangeSelection({selected,orderedIds,id,checked,shiftKey=false,anchorId=null}){
  if(!(selected instanceof Set))throw new TypeError('selected must be a Set');
  const ids=[...new Set((orderedIds||[]).map(String).filter(Boolean))],target=String(id||'');
  if(!target||!ids.includes(target))return anchorId;
  const setValue=value=>{if(checked)selected.add(value);else selected.delete(value)};
  const anchor=anchorId==null?'':String(anchorId);
  // Row checkboxes deliberately expose both click and change. Click carries
  // Shift state; change preserves the existing DOM-event contract. A native
  // checkbox gesture emits both, so the second observation must be a no-op.
  if(!shiftKey&&selected.has(target)===!!checked)return anchorId;
  if(shiftKey&&anchor&&ids.includes(anchor)){
    const from=ids.indexOf(anchor),to=ids.indexOf(target),start=Math.min(from,to),end=Math.max(from,to);
    for(let index=start;index<=end;index+=1)setValue(ids[index]);
    return anchor;
  }
  setValue(target);
  return target;
}
