import {clone} from '../core/values.js';
import {stableLegacyPositionId} from '../shared/data-invariants.js';

function existingId(row){
  if(!row||typeof row!=='object'||Array.isArray(row))return {invalid:true,id:null};
  if(!Object.hasOwn(row,'id'))return {invalid:false,id:null};
  if(typeof row.id!=='string'||!row.id.trim()||row.id!==row.id.trim())return {invalid:true,id:null};
  return {invalid:false,id:row.id};
}

function contentWithoutId(row){
  if(!row||typeof row!=='object'||Array.isArray(row))return row;
  const copy={...row};delete copy.id;return copy;
}

function sameLegacyContent(a,b){return JSON.stringify(contentWithoutId(a))===JSON.stringify(contentWithoutId(b))}

function unchangedCompatible(a,b){
  const ai=existingId(a),bi=existingId(b);
  if(ai.invalid||bi.invalid)return false;
  if(ai.id&&bi.id)return ai.id===bi.id;
  return sameLegacyContent(a,b);
}

function validateRows(rows,label){
  const seen=new Set(),conflicts=[];
  for(let index=0;index<rows.length;index++){
    const status=existingId(rows[index]);
    if(status.invalid){conflicts.push(`cards:migration:${label}:invalid-id:${index}`);continue}
    if(status.id&&seen.has(status.id))conflicts.push(`cards:migration:${label}:duplicate-id:${status.id}`);
    if(status.id)seen.add(status.id);
  }
  return conflicts;
}

function uniqueEmbedding(shorter,longer){
  const solutions=[];
  function visit(shortIndex,longIndex,mapping){
    if(solutions.length>1)return;
    if(shortIndex===shorter.length){solutions.push([...mapping]);return}
    const remaining=shorter.length-shortIndex;
    for(let index=longIndex;index<=longer.length-remaining;index++){
      if(!unchangedCompatible(shorter[shortIndex],longer[index]))continue;
      mapping.push(index);visit(shortIndex+1,index+1,mapping);mapping.pop();
      if(solutions.length>1)return;
    }
  }
  visit(0,0,[]);return solutions.length===1?solutions[0]:null;
}

function hasMovedIdentity(base,branch){
  for(let index=0;index<base.length;index++){
    if(unchangedCompatible(base[index],branch[index]))continue;
    const baseId=existingId(base[index]).id;
    for(let other=0;other<branch.length;other++){
      if(other===index)continue;
      const branchId=existingId(branch[other]).id;
      if(baseId&&branchId&&baseId===branchId)return true;
      if(sameLegacyContent(base[index],branch[other]))return true;
    }
  }
  return false;
}

function pairLineage(base,branch,label){
  const conflicts=[...validateRows(base,'base'),...validateRows(branch,label)],baseToBranch=new Map();
  if(conflicts.length)return {baseToBranch,unmatchedBase:[],unmatchedBranch:[],conflicts};
  if(base.length===branch.length){
    if(hasMovedIdentity(base,branch))conflicts.push(`cards:migration:${label}:ambiguous-reorder`);
    else for(let index=0;index<base.length;index++){
      const baseId=existingId(base[index]).id,branchId=existingId(branch[index]).id;
      if(baseId&&branchId&&baseId!==branchId)conflicts.push(`cards:migration:${label}:identity-mismatch:${index}`);
      else baseToBranch.set(index,index);
    }
  }else if(base.length>branch.length){
    const branchInBase=uniqueEmbedding(branch,base);
    if(!branchInBase)conflicts.push(`cards:migration:${label}:ambiguous-deletion`);
    else branchInBase.forEach((baseIndex,branchIndex)=>baseToBranch.set(baseIndex,branchIndex));
  }else{
    const baseInBranch=uniqueEmbedding(base,branch);
    if(!baseInBranch)conflicts.push(`cards:migration:${label}:ambiguous-addition`);
    else baseInBranch.forEach((branchIndex,baseIndex)=>baseToBranch.set(baseIndex,branchIndex));
  }
  const matchedBranch=new Set(baseToBranch.values());
  return {
    baseToBranch,
    unmatchedBase:base.map((_,index)=>index).filter(index=>!baseToBranch.has(index)),
    unmatchedBranch:branch.map((_,index)=>index).filter(index=>!matchedBranch.has(index)),
    conflicts,
  };
}

function chooseCanonicalId(rows,fallback,conflicts,detail){
  const ids=[...new Set(rows.map(row=>existingId(row).id).filter(Boolean))];
  if(ids.length>1){conflicts.push(`cards:migration:${detail}:multiple-embedded-ids`);return null}
  return ids[0]||fallback;
}

function assign(rows,index,id){rows[index]={...rows[index],id}}

function ensureAssignedIdsUnique(rows,label,conflicts){
  const seen=new Set();
  for(const row of rows){
    const id=existingId(row).id;
    if(id&&seen.has(id))conflicts.push(`cards:migration:${label}:assigned-id-collision:${id}`);
    if(id)seen.add(id);
  }
}

function stateCards(source){return Array.isArray(source?.cards)?source.cards:[]}
function hasLegacyCards(source){return stateCards(source).some(row=>!existingId(row).id)}

export function migrateLegacyCardPair(baseState,branchState,{branchLabel='local'}={}){
  const base=clone(baseState||{}),branch=clone(branchState||{}),baseCards=stateCards(base),branchCards=stateCards(branch);
  const hadLegacyIdentity=hasLegacyCards(base)||hasLegacyCards(branch),pair=pairLineage(baseCards,branchCards,branchLabel),conflicts=[...pair.conflicts];
  if(conflicts.length)return {base,branch,conflicts,localDeletedIds:[],hadLegacyIdentity};
  for(let baseIndex=0;baseIndex<baseCards.length;baseIndex++){
    const branchIndex=pair.baseToBranch.get(baseIndex),members=[baseCards[baseIndex]];
    if(branchIndex!==undefined)members.push(branchCards[branchIndex]);
    const id=chooseCanonicalId(members,stableLegacyPositionId('CARD',baseIndex),conflicts,`base:${baseIndex}`);
    if(!id)continue;assign(baseCards,baseIndex,id);if(branchIndex!==undefined)assign(branchCards,branchIndex,id);
  }
  for(const branchIndex of pair.unmatchedBranch){
    const id=chooseCanonicalId([branchCards[branchIndex]],stableLegacyPositionId(`CARD-${branchLabel.toUpperCase()}`,branchIndex),conflicts,`${branchLabel}:${branchIndex}`);
    if(id)assign(branchCards,branchIndex,id);
  }
  ensureAssignedIdsUnique(baseCards,'base',conflicts);ensureAssignedIdsUnique(branchCards,branchLabel,conflicts);
  base.cards=baseCards;branch.cards=branchCards;
  const localDeletedIds=hadLegacyIdentity&&!conflicts.length?pair.unmatchedBase.map(index=>baseCards[index].id):[];
  return {base,branch,conflicts,localDeletedIds,hadLegacyIdentity};
}

export function migrateLegacyCards3Way(baseState,localState,remoteState){
  const base=clone(baseState||{}),local=clone(localState||{}),remote=clone(remoteState||{});
  const baseCards=stateCards(base),localCards=stateCards(local),remoteCards=stateCards(remote);
  const localHadLegacy=hasLegacyCards(base)||hasLegacyCards(local),localPair=pairLineage(baseCards,localCards,'local'),remotePair=pairLineage(baseCards,remoteCards,'remote');
  const conflicts=[...localPair.conflicts,...remotePair.conflicts];
  if(conflicts.length)return {base,local,remote,conflicts,localDeletedIds:[]};
  for(let baseIndex=0;baseIndex<baseCards.length;baseIndex++){
    const localIndex=localPair.baseToBranch.get(baseIndex),remoteIndex=remotePair.baseToBranch.get(baseIndex),members=[baseCards[baseIndex]];
    if(localIndex!==undefined)members.push(localCards[localIndex]);
    if(remoteIndex!==undefined)members.push(remoteCards[remoteIndex]);
    const id=chooseCanonicalId(members,stableLegacyPositionId('CARD',baseIndex),conflicts,`base:${baseIndex}`);
    if(!id)continue;assign(baseCards,baseIndex,id);if(localIndex!==undefined)assign(localCards,localIndex,id);if(remoteIndex!==undefined)assign(remoteCards,remoteIndex,id);
  }
  for(const [rows,pair,label] of [[localCards,localPair,'local'],[remoteCards,remotePair,'remote']])for(const index of pair.unmatchedBranch){
    const id=chooseCanonicalId([rows[index]],stableLegacyPositionId(`CARD-${label.toUpperCase()}`,index),conflicts,`${label}:${index}`);
    if(id)assign(rows,index,id);
  }
  ensureAssignedIdsUnique(baseCards,'base',conflicts);ensureAssignedIdsUnique(localCards,'local',conflicts);ensureAssignedIdsUnique(remoteCards,'remote',conflicts);
  base.cards=baseCards;local.cards=localCards;remote.cards=remoteCards;
  const localDeletedIds=localHadLegacy&&!conflicts.length?localPair.unmatchedBase.map(index=>baseCards[index].id):[];
  return {base,local,remote,conflicts,localDeletedIds};
}

export function legacyCardMigrationConflict(conflicts){
  return {kind:'legacy-card-migration-conflict',conflicts:[...new Set(conflicts)].sort()};
}
