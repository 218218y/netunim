function rowTime(row){const value=Date.parse(row?.saved_at||row?.savedAt||'');return Number.isFinite(value)?value:0}

export function buildBackupCatalog(rollingRows=[],periodicRows=[],{rollingLimit=4,periodicLimit=5,totalLimit=8}={}){
  const tagged=[
    ...(Array.isArray(rollingRows)?rollingRows:[]).slice(0,Math.max(0,rollingLimit)).map(row=>({...row,source:'rolling'})),
    ...(Array.isArray(periodicRows)?periodicRows:[]).slice(0,Math.max(0,periodicLimit)).map(row=>({...row,source:'periodic'})),
  ].sort((a,b)=>rowTime(b)-rowTime(a)||Number(b?.id||0)-Number(a?.id||0));
  const seen=new Set(),out=[];
  for(const row of tagged){
    const revision=Number(row?.revision||0),key=revision>0?`r:${revision}`:`${row.source}:${row?.id||''}`;
    if(seen.has(key))continue;seen.add(key);out.push(row);if(out.length>=Math.max(1,totalLimit))break;
  }
  return out;
}

function stableValue(value){
  if(Array.isArray(value))return value.map(stableValue);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableValue(value[key])]));
  return value;
}
export function backupValueEqual(a,b){return JSON.stringify(stableValue(a))===JSON.stringify(stableValue(b))}

function collectionAt(state,path){let value=state;for(const part of String(path||'').split('.'))value=value?.[part];return Array.isArray(value)?value:[]}
function valueAt(state,path){let value=state;for(const part of String(path||'').split('.'))value=value?.[part];return value}

export function diffEntityCollection(currentRows=[],targetRows=[]){
  const before=new Map((Array.isArray(currentRows)?currentRows:[]).map(row=>[String(row?.id||''),row]).filter(([id])=>id));
  const after=new Map((Array.isArray(targetRows)?targetRows:[]).map(row=>[String(row?.id||''),row]).filter(([id])=>id));
  let restored=0,removed=0,changed=0;
  for(const [id,row] of after){if(!before.has(id))restored++;else if(!backupValueEqual(before.get(id),row))changed++}
  for(const id of before.keys())if(!after.has(id))removed++;
  return {before:before.size,after:after.size,restored,removed,changed,totalChanges:restored+removed+changed};
}

export function summarizeBackupDiff(currentState,targetState,{collections=[],config=[]}={}){
  const rows=collections.map(item=>{const diff=diffEntityCollection(collectionAt(currentState,item.path),collectionAt(targetState,item.path));return {...item,...diff}}).filter(item=>item.totalChanges>0||item.before!==item.after);
  const settings=config.filter(item=>!backupValueEqual(valueAt(currentState,item.path),valueAt(targetState,item.path))).map(item=>({...item,changed:true}));
  return {rows,settings,totalChanges:rows.reduce((sum,row)=>sum+row.totalChanges,0)+settings.length};
}

export function backupSourceLabel(source){return source==='periodic'?'תקופתי':'לפני שינוי'}

export function backupPointKey(source,id){const safeSource=source==='periodic'?'periodic':'rolling',safeId=Number(id);if(!Number.isSafeInteger(safeId)||safeId<=0)throw new Error('מזהה הגיבוי אינו תקין');return `${safeSource}:${safeId}`}
